"""Read-only delivery diagnostics for the portal's own application sender."""
import datetime
import hashlib
import json
import re
import subprocess
from pathlib import Path

def execute(*cmd, data=None):
    return subprocess.run(cmd,input=data,text=True,capture_output=True,timeout=30)

def main():
    private=Path('/opt/prohouse/private/client-invitations')
    expected=json.loads((private/'smtp-sender.json').read_text())
    app=execute('docker','ps','-q','--filter','publish=3302').stdout.strip()
    mail='prohouse-poczta-mailserver-1'
    read=execute('docker','exec',app,'cat','/run/secrets/prohouse-panel-invitations.json')
    if read.returncode: raise RuntimeError('Brak konfiguracji nadawcy w działającym kontenerze')
    s=json.loads(read.stdout)
    print('LIVE_SETTINGS_MATCH',s['PORTAL_SMTP_PASS']==expected['pass'] and s['PORTAL_SMTP_USER']==expected['user'])
    print('SENDER_CONFIG_CREATED',datetime.datetime.fromtimestamp((private/'smtp-sender.json').stat().st_mtime,datetime.timezone.utc).isoformat())
    auth=execute('docker','exec','-i',mail,'sh','-c',"""
IFS= read -r pass || exit 3
account=/tmp/docker-mailserver/postfix-accounts.cf
printf 'ACCOUNT_CONFIG_UPDATED '; stat -c %y "$account"
entry=$(awk -F'|' -v a="$1" 'tolower($1)==a{print $2}' "$account")
test -n "$entry" || { echo SENDER_MISSING; exit 0; }
doveadm pw -t "$entry" -p "$pass" >/dev/null 2>&1 && echo CONFIG_PASSWORD_MATCH || echo CONFIG_PASSWORD_DIFFERS
doveadm auth test "$1" "$pass" >/dev/null 2>&1 && echo DOVECOT_AUTH_OK || echo DOVECOT_AUTH_REJECTED
""",'sh',expected['user'],data=expected['pass']+'\n')
    print(auth.stdout.strip())
    js="""
const s=JSON.parse(require('fs').readFileSync('/run/secrets/prohouse-panel-invitations.json'));
const port=Number(s.PORTAL_SMTP_PORT);
require('nodemailer').createTransport({host:s.PORTAL_SMTP_HOST,port,secure:port===465,requireTLS:port!==465,
 auth:{user:s.PORTAL_SMTP_USER,pass:s.PORTAL_SMTP_PASS},connectionTimeout:8000,socketTimeout:10000}).verify()
 .then(()=>console.log('LIVE_SMTP_OK')).catch(e=>console.log('LIVE_SMTP_FAILED',e.code,e.responseCode));
"""
    print(execute('docker','exec',app,'node','-e',js).stdout.strip())
    raw=execute('docker','logs','--since','2h',mail)
    lines=[l for l in (raw.stdout+raw.stderr).splitlines() if ('passwd-file('+expected['user']+',') in l and 'Password mismatch' in l]
    if lines:
        m=re.search(r'SHA1 of given password: ([0-9a-f]+)',lines[-1])
        if m: print('REJECTED_PASSWORD_MATCHES_EXPECTED',hashlib.sha1(expected['pass'].encode()).hexdigest().startswith(m[1]))
    print('DONE')
if __name__=='__main__':main()
