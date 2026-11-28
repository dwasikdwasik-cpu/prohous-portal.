import os, sqlite3, hashlib, hmac, secrets, time, re, sys, smtplib, ssl
from datetime import datetime, date
from zoneinfo import ZoneInfo
from email.message import EmailMessage
from http.cookies import SimpleCookie
from urllib.parse import parse_qs
from html import escape
from contextlib import closing

DB=os.getenv('DATABASE','data/polecenia.db')
os.makedirs(os.path.dirname(os.path.abspath(DB)),exist_ok=True)
ADMIN=os.getenv('ADMIN_EMAIL')
URL='https://polecenia.prohous.pl'
states=['Nowy klient','Oferta wysłana','Klient się zastanawia','Oferta przyjęta','Oferta odrzucona']
def now(): return datetime.now(ZoneInfo('Europe/Warsaw'))
def day(): return now().date().isoformat()
def db():
    c=sqlite3.connect(DB,timeout=30)
    c.row_factory=sqlite3.Row
    return c
def password(p,s): return hashlib.scrypt(p.encode(),salt=s.encode(),n=16384,r=8,p=1).hex()
def account(c,name,email,p,admin=0):
    if len(p)<12 or not re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+',email): raise ValueError('Podaj poprawny e-mail i hasło o długości minimum 12 znaków.')
    salt=secrets.token_hex(16)
    c.execute('insert into users values(null,?,?,?,?,?)',(name,email.lower(),salt,password(p,salt),admin))
def init():
    with closing(db()) as c, c:
        c.executescript("""
        create table if not exists users(id integer primary key,name text,email text unique,salt text,pw text,admin integer);
        create table if not exists sessions(token text primary key,uid integer,expires real,csrf text);
        create table if not exists tasks(id integer primary key,uid integer,title text,due text,done text);
        create table if not exists clients(id integer primary key,uid integer,name text,contact text,notes text,status text,follow text,reason text);
        create table if not exists history(id integer primary key,uid integer,stamp text,msg text);
        create table if not exists mail(k text primary key,recipient text,body text,sent integer default 0);
        create table if not exists reasons(task integer,day text,reason text,unique(task,day));
        """)
        if not c.execute('select 1 from users').fetchone():
            account(c,'Damian',os.environ['ADMIN_EMAIL'],os.environ['ADMIN_PASSWORD'],1)
            account(c,'Karolina',os.environ['STAFF_EMAIL'],os.environ['KAROLINA_PASSWORD'])
def log(c,uid,msg): c.execute('insert into history values(null,?,?,?)',(uid,now().isoformat(timespec='seconds'),msg))
def queue(c,key,to,msg): c.execute('insert or ignore into mail(k,recipient,body) values(?,?,?)',(key,to,msg))
def schedule(c):
    today=day()
    if now().hour<8:return
    for t in c.execute('select t.*,u.email from tasks t join users u on u.id=t.uid where done is null'):
        queue(c,f"task/{t['id']}/{today}",t['email'],'Otwarte polecenie: '+t['title']+' | Termin: '+t['due'])
        if t['due']<=today and now().hour>=16 and not c.execute('select 1 from reasons where task=? and day=?',(t['id'],today)).fetchone():
            queue(c,f"missing/{t['id']}/{today}",ADMIN,'Brak wyjaśnienia do godz. 16:00: '+t['title']+' — '+t['email'])
    for r in c.execute('select c.*,u.email from clients c join users u on u.id=c.uid where follow between ? and ? and status not in (?,?)',('0001',today,*states[-2:])):
        queue(c,f"client/{r['id']}/{today}",r['email'],'Termin kontaktu z klientem: '+r['name']+' — '+r['contact'])
def worker():
    while True:
        try:
            with closing(db()) as c,c:
                schedule(c)
            with closing(db()) as c:
                for m in c.execute('select * from mail where sent=0 order by rowid').fetchall():
                    if m['k'].startswith('task/') and c.execute('select done from tasks where id=?',(m['k'].split('/')[1],)).fetchone()[0]:
                        with c:c.execute('update mail set sent=2 where k=?',(m['k'],))
                        continue
                    msg=EmailMessage()
                    msg['From']=os.environ['SMTP_FROM']
                    msg['To']=m['recipient']
                    msg['Subject']='ProHouse • '+m['body'].split(':')[0][:70]
                    msg.set_content(m['body']+'\n\nOtwórz panel: '+URL)
                    ctx=ssl.create_default_context()
                    port=int(os.getenv('SMTP_PORT','465'))
                    with (smtplib.SMTP_SSL(os.environ['SMTP_HOST'],port,context=ctx,timeout=20) if port==465 else smtplib.SMTP(os.environ['SMTP_HOST'],port,timeout=20)) as smtp:
                        if port!=465:smtp.starttls(context=ctx)
                        smtp.login(os.environ['SMTP_USER'],os.environ['SMTP_PASSWORD'])
                        smtp.send_message(msg)
                    with c:c.execute('update mail set sent=1 where k=?',(m['k'],))
        except Exception as err:print('Błąd obsługi poczty:',type(err).__name__,flush=True)
        time.sleep(60)
def E(v):return escape(str(v or ''),quote=True)
def inp(name,label,typ='text',v='',req=True):
    return f'<label>{label}<input name="{name}" type="{typ}" value="{E(v)}" maxlength="2000" {"required" if req else ""}></label>'
def choices(name,label,rows,current=''):
    return '<label>'+label+'<select name="'+name+'">'+''.join(f'<option value="{E(k)}" {"selected" if str(k)==str(current) else ""}>{E(v)}</option>' for k,v in rows)+'</select></label>'
def form(action,fields,button,token):
    return f'<form method="post"><input type="hidden" name="action" value="{action}"><input type="hidden" name="csrf" value="{token}">{fields}<button>{button}</button></form>'
def hidden(i):return f'<input type="hidden" name="id" value="{i}">'
def validdate(v):
    date.fromisoformat(v)
    return v
def act(c,u,a,p):
    uid=u['id']
    def val(k):
        s=p.get(k,'').strip()
        if not s:raise ValueError('Uzupełnij wymagane pola.')
        return s
    if a=='user' and u['admin']:account(c,val('name'),val('email'),val('pw'));return
    if a=='task' and u['admin']:
        person=c.execute('select * from users where id=?',(val('uid'),)).fetchone()
        if not person:raise ValueError('Wybierz pracownika.')
        title=val('title')
        i=c.execute('insert into tasks values(null,?,?,?,null)',(person['id'],title,validdate(val('due')))).lastrowid
        queue(c,'new/'+str(i),person['email'],'Nowe polecenie: '+title+' | Termin: '+p['due'])
        log(c,uid,'Zlecono '+person['name']+' pracę: '+title)
        return
    if a in ('done','reason'):
        t=c.execute('select * from tasks where id=? and uid=? and done is null',(val('id'),uid)).fetchone()
        if not t:raise ValueError('Polecenie jest już zamknięte lub niedostępne.')
        if a=='done':
            c.execute('update tasks set done=? where id=?',(now().isoformat(timespec='minutes'),t['id']))
            log(c,uid,'Potwierdzono wykonanie: '+t['title'])
        else:
            reason=val('reason')
            c.execute('insert or replace into reasons values(?,?,?)',(t['id'],day(),reason))
            msg='Powód niewykonania: '+t['title']+' — '+reason
            log(c,uid,msg)
            queue(c,secrets.token_hex(16),ADMIN,u['name']+' | '+msg)
        return
    if a=='client':
        status=val('status')
        if status not in states:raise ValueError('Wybierz status.')
        values=(val('name'),val('contact'),p.get('notes',''),status,validdate(p['follow']) if p.get('follow') else '',val('reason') if status==states[-1] else '')
        owner=uid
        if p.get('id'):
            r=c.execute('select * from clients where id=?',(p['id'],)).fetchone()
            if not r or (r['uid']!=uid and not u['admin']):raise ValueError('Brak dostępu.')
            owner=r['uid']
            c.execute('update clients set name=?,contact=?,notes=?,status=?,follow=?,reason=? where id=?',(*values,p['id']))
        else:c.execute('insert into clients values(null,?,?,?,?,?,?,?)',(owner,*values))
        log(c,uid,'Zapisano klienta '+values[0]+' • '+status+(' • '+values[-1] if values[-1] else ''))
        return
    raise ValueError('Brak dostępu.')
def dashboard(c,u,token,q):
    users={r['id']:r['name'] for r in c.execute('select * from users order by name')}
    admin=u['admin']
    uid=u['id']
    def F(a,f,b):return form(a,f,b,token)
    def card(s):return '<article>'+s+'</article>'
    view=q.get('view','tasks')
    out='<header><strong>PROHOUSE</strong><span>'+E(u['name'])+'</span>'+F('logout','','Wyloguj')+'</header><main><nav>'+''.join('<a href="?view='+k+'">'+v+'</a>' for k,v in [('tasks','Polecenia'),('clients','Klienci'),('history','Dziennik pracy')]+([('team','Zespół')] if admin else []))+'</nav>'
    if view=='team' and admin:
        return out+'<h1>Zespół</h1>'+card(F('user',inp('name','Imię i nazwisko')+inp('email','E-mail','email')+inp('pw','Hasło początkowe (min. 12 znaków)','password'),'Dodaj pracownika'))+''.join(card(E(r['name'])+' · '+E(r['email'])) for r in c.execute('select * from users'))
    if view=='history':
        d=validdate(q.get('day',day()))
        who=q.get('person','') if admin else str(uid)
        return out+'<h1>Dziennik pracy</h1><form><input type="hidden" name="view" value="history">'+inp('day','Dzień','date',d)+(choices('person','Pracownik',[('','Cały zespół'),*users.items()],who) if admin else '')+'<button>Pokaż</button></form>'+(''.join(card('<b>'+E(users[r['uid']])+'</b> · '+E(r['stamp'][11:16])+'<p>'+E(r['msg'])+'</p>') for r in c.execute('select * from history where substr(stamp,1,10)=? and (?="" or uid=?) order by id desc',(d,who,who))) or '<p>Brak wpisów w wybranym dniu.</p>')
    if view=='clients':
        def cf(r):
            return F('client',(hidden(r['id']) if r else '')+inp('name','Klient',v=r.get('name'))+inp('contact','Telefon lub e-mail',v=r.get('contact'))+'<label>Oczekiwania i uwagi<textarea name="notes">'+E(r.get('notes'))+'</textarea></label>'+choices('status','Status oferty',[(s,s) for s in states],r.get('status'))+inp('follow','Ponowny kontakt','date',r.get('follow'),False)+inp('reason','Powód odrzucenia (wymagany przy odmowie)',v=r.get('reason'),req=False),'Zapisz klienta')
        out+='<h1>Klienci i oferty</h1><details><summary>Dodaj klienta</summary>'+cf({})+'</details>'
        for r in c.execute('select * from clients where ? or uid=? order by follow="",follow,name',(admin,uid)):
            out+=card('<small>'+E(users[r['uid']])+'</small><h2>'+E(r['name'])+'</h2>'+E(r['status'])+' · '+E(r['contact'])+'<p>'+E(r['notes'])+'</p><p>'+E(r['reason'])+'</p>Kontakt: '+E(r['follow'] or 'bez terminu')+'<details><summary>Aktualizuj kartę</summary>'+cf(dict(r))+'</details>')
        return out
    out+='<h1>Polecenia pracowników</h1>'
    if admin:out+='<details><summary>Zleć pracę</summary>'+F('task',choices('uid','Pracownik',users.items())+inp('title','Co należy wykonać?')+inp('due','Termin wykonania','date',day()),'Przydziel polecenie')+'</details>'
    tasks=c.execute('select * from tasks where ? or uid=? order by done is not null,due,id desc',(admin,uid)).fetchall()
    for t in tasks:
        s='<small>'+E(users[t['uid']])+' · termin '+E(t['due'])+'</small><h2>'+E(t['title'])+'</h2>'
        if t['done']:s+='Wykonano · '+E(t['done'][:16].replace('T',' '))
        else:
            s+=('Po terminie' if t['due']<day() else 'Do wykonania')
            r=c.execute('select * from reasons where task=? order by day desc limit 1',(t['id'],)).fetchone()
            if r:s+='<p>Wyjaśnienie ('+E(r['day'])+'): '+E(r['reason'])+'</p>'
            if t['uid']==uid:s+=F('done',hidden(t['id']),'Potwierdzam wykonanie')+F('reason',hidden(t['id'])+inp('reason','Dlaczego praca nie została wykonana?'),'Przekaż powód Damianowi')
        out+=card(s)
    return out if tasks else out+'<p>Brak przydzielonych poleceń.</p>'
CSS="""*{box-sizing:border-box}body{margin:0;background:#f6f4ef;color:#202322;font:16px/1.5 system-ui}header,main{padding:1.2rem max(5vw,calc((100vw - 960px)/2))}header{background:#191c1b;color:#fff;display:flex;gap:1rem;align-items:center}header strong{letter-spacing:.12em;margin-right:auto}header form{margin:0}main{padding-bottom:4rem}nav{display:flex;gap:1.2rem;flex-wrap:wrap;padding:1rem 0;border-bottom:1px solid #c7c2b7}a,summary{color:#292b29;font-weight:650}h1{font:normal clamp(32px,6vw,56px) Georgia,serif;margin:.6em 0}h2{font-size:22px;margin:.3em 0}article,details,main>form{background:white;border:1px solid #ddd8ce;padding:1rem;margin:.8rem 0;border-radius:8px}article{overflow-wrap:anywhere}summary,button{cursor:pointer}form{display:grid;gap:.6rem;margin-top:.8rem}label{display:grid;gap:.2rem}input,select,textarea,button{font:inherit;padding:.55rem;border:1px solid #bab8af;border-radius:5px;min-width:0}button{justify-self:start;background:#202322;color:white;padding:.55rem 1rem}small{color:#645e54}"""
def app(env,start):
    cookies=SimpleCookie()
    cookies.load(env.get('HTTP_COOKIE',''))
    sid=cookies['session'].value if 'session' in cookies else ''
    headers=[('Cache-Control','no-store'),('X-Frame-Options','DENY'),('Referrer-Policy','same-origin')]
    def redirect():
        headers.append(('Location',env.get('PATH_INFO','/')+('?' + env['QUERY_STRING'] if env.get('QUERY_STRING') else '')))
        start('303 See Other',headers)
        return [b'']
    def parse(s):return {k:v[0] for k,v in parse_qs(s,max_num_fields=25).items()}
    with closing(db()) as c:
        try:
            u=c.execute('select u.*,s.csrf from sessions s join users u on u.id=s.uid where token=? and expires>?',(sid,time.time())).fetchone()
            if env['REQUEST_METHOD']=='POST':
                size=int(env.get('CONTENT_LENGTH') or 0)
                if size>32000:raise ValueError('Formularz jest zbyt długi.')
                p=parse(env['wsgi.input'].read(size).decode())
                a=p.get('action')
                with c:
                    c.execute('begin immediate')
                    if a=='login' and not u:
                        if env.get('HTTP_ORIGIN',URL)!=URL:raise ValueError('Niepoprawne źródło formularza.')
                        row=c.execute('select * from users where email=?',(p.get('email','').lower().strip(),)).fetchone()
                        digest=password(p.get('pw',''),row['salt'] if row else 'dummy')
                        if not row or not hmac.compare_digest(digest,row['pw']):raise ValueError('Błędny adres e-mail lub hasło.')
                        sid=secrets.token_urlsafe(32)
                        c.execute('delete from sessions where expires<?',(time.time(),))
                        c.execute('insert into sessions values(?,?,?,?)',(sid,row['id'],time.time()+43200,secrets.token_hex(24)))
                        headers.append(('Set-Cookie','session='+sid+'; Path=/; Secure; HttpOnly; SameSite=Strict'))
                    elif not u or not hmac.compare_digest(p.get('csrf',''),u['csrf']):raise ValueError('Sesja wygasła. Odśwież stronę.')
                    elif a=='logout':c.execute('delete from sessions where token=?',(sid,))
                    else:act(c,u,a,p)
                return redirect()
            if u:body=dashboard(c,u,u['csrf'],parse(env.get('QUERY_STRING','')))
            else:body='<header><strong>PROHOUSE</strong></header><main><h1>Panel poleceń</h1>'+form('login',inp('email','Firmowy e-mail','email')+inp('pw','Hasło','password'),'Zaloguj się','')
            status='200 OK'
        except (ValueError,sqlite3.IntegrityError) as err:
            body='<main><h1>Sprawdź formularz</h1><p>'+E('Ten e-mail jest już przypisany do konta.' if isinstance(err,sqlite3.IntegrityError) else str(err))+'</p><a href="/">Wróć do panelu</a>'
            status='400 Bad Request'
    start(status,headers+[('Content-Type','text/html; charset=utf-8')])
    return [('<!doctype html><html lang="pl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Polecenia • ProHouse</title><style>'+CSS+'</style>'+body+'</main></html>').encode()]
if __name__=='__main__':
    init()
    if sys.argv[1:] == ['worker']:worker()
