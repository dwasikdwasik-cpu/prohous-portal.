"""Provision a dedicated application sender on the company's existing mail server."""
import json
import os
from pathlib import Path
import secrets
import subprocess
import time

ADDRESS='zaproszenia@prohous.pl'
MAIL='prohouse-poczta-mailserver-1'
def sender_settings(private):
    state=private/'smtp-sender.json'
    exists_command="""test -r /tmp/docker-mailserver/postfix-accounts.cf || exit 3
awk -F'|' -v email="$1" 'tolower($1)==email {found=1} END{exit !found}' /tmp/docker-mailserver/postfix-accounts.cf"""
    def existing():
        check=subprocess.run(['docker','exec',MAIL,'sh','-c',exists_command,'sh',ADDRESS],capture_output=True)
        if check.returncode not in (0,1):raise RuntimeError('Nie można odczytać stanu nadawcy poczty.')
        return check.returncode==0
    if state.exists():
        saved=json.loads(state.read_text())
        if saved.get('user')!=ADDRESS:raise RuntimeError('Niespójny nadawca panelu')
    else:
        if existing():raise RuntimeError('Adres nadawcy jest już zajęty. Zachowano jego dotychczasowe dane.')
        alias=subprocess.run(['docker','exec',MAIL,'sh','-c',
         """test ! -e /tmp/docker-mailserver/postfix-virtual.cf || ! awk -v email="$1" 'tolower($1)==email{found=1} END{exit !found}' /tmp/docker-mailserver/postfix-virtual.cf""",
         'sh',ADDRESS],capture_output=True)
        if alias.returncode:raise RuntimeError('Adres nadawcy jest już aliasem.')
        saved={'user':ADDRESS,'pass':secrets.token_urlsafe(36)}
        with state.open('x') as f:json.dump(saved,f)
        os.chmod(state,0o600)
    if not existing():
        # Supply the positional password expected by DMS from a private pipe inside the mail container.
        created=subprocess.run(['docker','exec','-i',MAIL,'sh','-c','IFS= read -r pw && exec setup email add "$1" "$pw"','sh',ADDRESS],
         input=saved['pass']+'\n',text=True,capture_output=True,timeout=20)
        if created.returncode or not existing():
            diagnostic=(created.stdout+' '+created.stderr).lower()
            reason=next((k for k in ['read-only','already','permission denied','password','not supported','ldap'] if k in diagnostic),'setup')
            raise RuntimeError('Dodawanie nadawcy: '+reason+', kod '+str(created.returncode))
    return saved
