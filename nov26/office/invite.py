"""Issue and send the authorized invitation on the employee VPS, once per invitation."""
import datetime as dt
import fcntl
import hashlib
import json
import os
import re
import smtplib
import ssl
import subprocess
import tempfile
import urllib.request
import uuid
from email.message import EmailMessage
from email.utils import make_msgid, formatdate

from install import HERE, db
from pathlib import Path

settings=json.loads(Path('/opt/prohouse-employee/api/staff-office-settings.json').read_text())
EMAIL=settings['email']
COPY=settings['copy']
for address in (EMAIL,COPY):
    if not re.fullmatch(r'[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,63}',address):raise ValueError('Niepoprawny adres.')
BASE='https://praca.prohous.pl'
PRIVATE=Path('/opt/prohouse/private/payroll-office-invite')
STATE=PRIVATE/'delivery.json'
API='http://127.0.0.1:8000/auth/v1'

def auth_env():
    raw=subprocess.check_output(['docker','inspect','-f','{{json .Config.Env}}','supabase-auth'],text=True)
    return dict(line.split('=',1) for line in json.loads(raw) if '=' in line)

def save(state):
    with tempfile.NamedTemporaryFile(dir=PRIVATE,mode='w',delete=False) as f:
        json.dump(state,f);f.flush();os.fsync(f.fileno())
    os.replace(f.name,STATE)

def prepare(env):
    key=env.get('SUPABASE_SERVICE_ROLE_KEY')
    if not key:
        raw=subprocess.check_output(['docker','inspect','-f','{{json .Config.Env}}','supabase-edge-functions'],text=True)
        key=dict(v.split('=',1) for v in json.loads(raw) if '=' in v)['SUPABASE_SERVICE_ROLE_KEY']
    old=db("select id::text||'|'||(email_confirmed_at is not null)::text from auth.users where lower(email)='"+EMAIL+"';")
    if old and not re.fullmatch(r'[0-9a-f-]{36}\|(true|false)',old):raise ValueError('Nie można jednoznacznie ustalić konta.')
    kind='recovery' if old.endswith('|true') else 'invite'
    payload=json.dumps({'type':kind,'email':EMAIL}).encode()
    req=urllib.request.Request(API+'/admin/generate_link',data=payload,headers={'Content-Type':'application/json','apikey':key,'Authorization':'Bearer '+key})
    with urllib.request.urlopen(req,timeout=20) as r:reply=json.load(r)
    token=reply.get('email_otp') or reply.get('properties',{}).get('email_otp')
    user=reply.get('user',reply)
    who=str(uuid.UUID(user['id']))
    if user.get('email','').lower()!=EMAIL or (old and not old.startswith(who+'|')) or not token or not re.fullmatch(r'\d{6,10}',token):
        raise ValueError('Usługa nie potwierdziła właściciela i kodu zaproszenia.')
    now=dt.datetime.now(dt.timezone.utc)
    state={'id':who,'kind':kind,'code':token,'created':now.isoformat(),
           'expires':(now+dt.timedelta(seconds=int(env.get('GOTRUE_MAILER_OTP_EXP','3600')))).isoformat(),
           'code_mail':'pending','invitation':'pending','code_id':make_msgid(domain='prohous.pl'),'invite_id':make_msgid(domain='prohous.pl')}
    save(state);return state

def mail(server,sender,subject,body,to,cc,msgid,state,field):
    msg=EmailMessage()
    msg['From']=sender;msg['To']=to
    if cc:msg['Cc']=', '.join(cc)
    msg['Subject']=subject;msg['Date']=formatdate(localtime=True);msg['Message-ID']=msgid
    msg.set_content(body)
    # Keep explicit per-recipient acceptance if the SMTP server partially accepts the envelope.
    recipients=[to,*cc]
    accepted=state.get(field+'_accepted',[])
    missing=[r for r in recipients if r not in accepted]
    if not missing:return
    state[field]='sending';save(state)
    try:refused=server.send_message(msg,from_addr=sender,to_addrs=missing)
    except smtplib.SMTPRecipientsRefused:
        state[field]='pending';save(state);raise
    accepted.extend(r for r in missing if r not in refused)
    state[field+'_accepted']=accepted
    state[field]='pending' if refused else 'sent'
    save(state)
    if refused:raise RuntimeError('Serwer poczty odrzucił co najmniej jeden adres.')

def issue():
    with urllib.request.urlopen(BASE+'/aktywacja-kadry.html',timeout=15) as r:
        if hashlib.sha256(r.read()).digest()!=hashlib.sha256((HERE/'aktywacja-kadry.html').read_bytes()).digest():raise ValueError('Formularz aktywacji nie jest opublikowany.')
    with urllib.request.urlopen(BASE+'/',timeout=15) as r:html=r.read().decode()
    asset=re.search(r'<script[^>]*type="module"[^>]*src="(/assets/[\w.-]+\.js)"',html)[1]
    with urllib.request.urlopen(BASE+asset,timeout=30) as r:
        if 'Wszyscy pracownicy (jeden PDF)' not in r.read().decode():raise ValueError('Brak wdrożonego eksportu PDF.')
    state=json.loads(STATE.read_text()) if STATE.exists() else None
    if state and state['invitation']=='sent':print('Wiadomość i kopia przyjęte wcześniej przez SMTP.');return
    if state and 'sending' in (state['invitation'],state['code_mail']):raise RuntimeError('Niepewny wynik poprzedniej wysyłki. Sprawdź dziennik poczty po Message-ID przed ponowieniem.')
    env=auth_env()
    host=env['GOTRUE_SMTP_HOST'];port=int(env.get('GOTRUE_SMTP_PORT','587'))
    sender=env['GOTRUE_SMTP_ADMIN_EMAIL']
    if not sender.lower().endswith('@prohous.pl'):raise ValueError('Sprawdź adres nadawcy ProHouse.')
    tls=ssl.create_default_context()
    server=smtplib.SMTP_SSL(host,port,context=tls,timeout=25) if port==465 else smtplib.SMTP(host,port,timeout=25)
    with server:
        if port!=465:server.starttls(context=tls)
        if env.get('GOTRUE_SMTP_USER'):server.login(env['GOTRUE_SMTP_USER'],env['GOTRUE_SMTP_PASS'])
        if state and dt.datetime.now(dt.timezone.utc)>=dt.datetime.fromisoformat(state['expires']):
            raise RuntimeError('Kod wygasł. Wymagane ponowienie zaproszenia.')
        state=state or prepare(env)
        who=str(uuid.UUID(state['id']))
        if db("select count(*) from public.profiles p join auth.users u on u.id=p.id where p.id='"+who+"' and lower(u.email)='"+EMAIL+"' and p.status in ('pending','approved');")!='1':
            raise ValueError('Profil biura wymaga sprawdzenia przed nadaniem dostępu.')
        db("insert into attendance_private.office_admins(user_id,email) values ('"+who+"','"+EMAIL+"') on conflict(user_id) do nothing;")
        if db("select count(*) from attendance_private.office_admins where user_id='"+who+"' and email='"+EMAIL+"';")!='1':
            raise ValueError('Nie potwierdzono zakresu konta.')
        link=BASE+'/aktywacja-kadry.html'+('?typ=recovery' if state['kind']=='recovery' else '')
        if state['code_mail']!='sent':
            mail(server,sender,'ProHouse | Jednorazowy kod do Centrum Pracownika',
                'Dzień dobry,\n\nkod dla biura kadr i płac: '+state['code']+'\n\nFormularz: '+link+
                '\nKod służy do ustawienia własnego hasła. Prosimy zachować go dla siebie.\n\nProHouse Sp. z o.o.',
                EMAIL,[],state['code_id'],state,'code_mail')
        mail(server,sender,'Zaproszenie dla biura kadr i płac | Centrum Pracownika ProHouse',
            (HERE/'zaproszenie.txt').read_text().format(activation_url=link,email=EMAIL),EMAIL,[COPY],state['invite_id'],state,'invitation')
        state.pop('code',None);save(state)
        print('SMTP przyjął kod dla biura oraz zaproszenie do '+EMAIL+' z kopią do '+COPY+'.')
if __name__=='__main__':
    os.umask(0o077);PRIVATE.mkdir(mode=0o700,parents=True,exist_ok=True)
    with (PRIVATE/'send.lock').open('a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX);issue()
