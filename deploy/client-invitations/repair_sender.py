"""Reconcile only the portal-owned SMTP account with the running application's credential."""
import datetime
import fcntl
import json
import os
from pathlib import Path
import subprocess
import time

from sender import ADDRESS,MAIL

def run(args,stdin=None):
    return subprocess.run(args,input=stdin,text=True,capture_output=True,timeout=25)

def main():
    os.umask(0o077)
    lock=open('/run/lock/prohouse-client-invitations.lock','a')
    fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    private=Path('/opt/prohouse/private/client-invitations')
    app=run(['docker','ps','-q','--filter','publish=3302']).stdout.strip()
    live=json.loads(run(['docker','exec',app,'cat','/run/secrets/prohouse-panel-invitations.json']).stdout)
    saved=json.loads((private/'smtp-sender.json').read_text())
    if not (live['PORTAL_SMTP_USER']==saved['user']==live['PORTAL_SMTP_FROM']==ADDRESS and live['PORTAL_SMTP_PASS']==saved['pass']):
        raise RuntimeError('Niespójna tożsamość nadawcy. Przerwano przed zmianą.')
    def mail(script,data=None):
        return run(['docker','exec','-i',MAIL,'sh','-c',script,'sh',ADDRESS],data)
    record="""awk -F'|' -v a="$1" 'tolower($1)==a{print $0}' /tmp/docker-mailserver/postfix-accounts.cf"""
    records=mail(record).stdout.splitlines()
    if len(records)!=1 or records[0].split('|',1)[0]!=ADDRESS:raise RuntimeError('Nie znaleziono jednego konta aplikacji.')
    previous=records[0].split('|',1)[1]
    check="""IFS= read -r pw || exit 2
entry=$(awk -F'|' -v a="$1" 'tolower($1)==a{print $2}' /tmp/docker-mailserver/postfix-accounts.cf)
doveadm pw -t "$entry" -u "$1" -p "$pw" >/dev/null 2>&1"""
    password=saved['pass']+'\n'
    if mail(check,password).returncode:
        backup=private/('sender-verifier-'+datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ'))
        with backup.open('x') as f:f.write(previous+'\n')
        update=mail('IFS= read -r pw && exec setup email update "$1" "$pw"',password)
        if update.returncode or mail(check,password).returncode:raise RuntimeError('Błąd zapisu danych dedykowanego nadawcy.')
        print('SENDER_CONFIG_RECONCILED',flush=True)
    verifier="""
const s=JSON.parse(require('fs').readFileSync('/run/secrets/prohouse-panel-invitations.json','utf8'));
const p=Number(s.PORTAL_SMTP_PORT);
require('nodemailer').createTransport({host:s.PORTAL_SMTP_HOST,port:p,secure:p===465,requireTLS:p!==465,auth:{user:s.PORTAL_SMTP_USER,pass:s.PORTAL_SMTP_PASS},connectionTimeout:7000,socketTimeout:9000}).verify().then(()=>console.log('verified')).catch(e=>{console.log(e.code||'failed');process.exitCode=1});
"""
    for n in range(8):
        if n in (0,3):
            mail('doveadm auth cache flush "$1" >/dev/null 2>&1 || true')
        test=run(['docker','exec',app,'node','-e',verifier])
        if test.returncode==0 and test.stdout.strip()=='verified':
            print('LIVE_SENDER_VERIFIED',flush=True);return
        time.sleep(4)
    raise RuntimeError('Nie potwierdzono logowania z aktywnego kontenera.')
if __name__=='__main__':main()
