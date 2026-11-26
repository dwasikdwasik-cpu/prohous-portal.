"""Install HR-scoped administrator lookup and invitation form. Never sends mail."""
import datetime
import fcntl
import hashlib
import os
import re
import shutil
import subprocess
import tempfile
import time
import urllib.request
from pathlib import Path

HERE=Path(__file__).resolve().parent
APP=Path('/opt/prohouse-employee')
EDGES=Path('/opt/prohouse-backend/docker/volumes/functions')
MODULES=('attendance','advances','personnel','certificates','onboarding')
RPC_NAMES=('absences','admin_days','advances','attendance','bailiff','cash','certificates','documents','employee_password',
           'employee_pay','employee_state','leave','login_notices','onboarding','payroll','payroll_bulk','personnel','personnel_files','reset_all_passwords')
VIEW='public.prohouse_workforce_profiles'

def db(sql):
    return subprocess.run(['docker','exec','-i','supabase-db','psql','-XAtq','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres'],
        input=sql,text=True,check=True,stdout=subprocess.PIPE).stdout.strip()

def replace_one(s,old,new):
    if s.count(old)!=1:raise ValueError('Sprawdź integrację aktualnej wersji: '+old)
    return s.replace(old,new,1)

def proxy(src):
    if "'staff-activation':" in src:return src
    marker='const handlers=Object.fromEntries('
    # Object.fromEntries is extended after initialization to preserve all live handlers.
    start=src.index(marker)
    end=src.index(');',start)+2
    return src[:end]+"\nObject.assign(handlers,{'staff-activation':(await import('./api/staff-activation.mjs')).default});\n"+src[end:]

def edge(src):
    if '/rest/v1/prohouse_workforce_profiles?id=eq.' in src:return src
    return replace_one(src,'/rest/v1/profiles?id=eq.','/rest/v1/prohouse_workforce_profiles?id=eq.')

def write(path,data):
    with tempfile.NamedTemporaryFile(dir=path.parent,mode='wb',delete=False) as f:f.write(data)
    os.chmod(f.name,0o644)
    os.replace(f.name,path)

def install():
    import json
    import sys
    cfg=APP/'api/staff-office-settings.json'
    if len(sys.argv)==3:
        email,copy=(s.strip().lower() for s in sys.argv[1:])
        if any(not re.fullmatch(r'[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,63}',x) for x in (email,copy)):
            raise ValueError('Niepoprawny adres logowania lub kopii.')
        settings=json.dumps({'email':email,'copy':copy}).encode()
    elif cfg.is_file():
        settings=cfg.read_bytes()
    else:raise ValueError('Podaj adres biura oraz adres kopii jako argumenty instalatora.')

    targets={APP/'api/staff-activation.mjs':(HERE/'activation.mjs').read_bytes(),
             APP/'public/aktywacja-kadry.html':(HERE/'aktywacja-kadry.html').read_bytes()}
    targets[cfg]=settings
    server=APP/'server.mjs'
    targets[server]=proxy(server.read_text()).encode()
    edges=[EDGES/('prohouse-'+name)/'index.ts' for name in MODULES]
    for p in edges:targets[p]=edge(p.read_text()).encode()
    names=','.join("'prohouse_"+name+"_api'" for name in RPC_NAMES)
    ids=db("select oid from pg_proc where pronamespace='public'::regnamespace and proname in ("+names+") and pronargs=2 and proargtypes='3802 2950'::oidvector order by oid").splitlines()
    if not ids:raise ValueError('Brak funkcji panelu pracownika.')
    forward=[];reverse=[]
    for oid in ids:
        if not oid.isdecimal():raise ValueError('Nierozpoznana funkcja.')
        s=db('select pg_get_functiondef('+oid+');')
        if re.search(r'(?i)\b(?:update|into|delete from)\s+public\.profiles\b',s):
            raise ValueError('Funkcja zmienia wspólny profil; sprawdź zakres przed wdrożeniem: '+oid)
        patched=re.sub(r'(?i)\b(from|join)\s+public\.profiles\b',lambda m:m[1]+' '+VIEW,s)
        if s!=patched:
            if db(f"select prosecdef and (has_function_privilege('anon',{oid},'execute') or has_function_privilege('authenticated',{oid},'execute')) from pg_proc where oid={oid}")=='t':
                raise ValueError('Funkcja publiczna z uprawnieniami właściciela wymaga osobnego sprawdzenia: '+oid)
            forward.append(patched);reverse.append(s)
    backup=Path('/opt/prohouse/backups')/datetime.datetime.now(datetime.timezone.utc).strftime('staff-office-%Y%m%d-%H%M%S-%f')
    backup.mkdir(mode=0o700,parents=True)
    prior={p:p.read_bytes() if p.exists() else None for p in targets}
    for p,data in prior.items():
        if data is not None:(backup/(p.parent.name+'-'+p.name)).write_bytes(data)
    def batch(parts):return 'begin;\n'+'\n'.join(q.rstrip(';')+';' for q in parts)+"\nnotify pgrst,'reload schema';\ncommit;"
    (backup/'restore-functions.sql').write_text(batch(reverse))
    sql=(HERE/'access.sql').read_text()
    db(batch([sql,*forward]).replace('commit;','rollback;'))
    db(batch([sql,*forward]))
    try:
        for p,data in targets.items():
            if data!=prior[p]:write(p,data)
        subprocess.run(['docker','exec','prohouse-employee','node','--check','/app/server.mjs'],check=True)
        for name in ('supabase-edge-functions','prohouse-employee'):
            subprocess.run(['docker','restart',name],check=True,stdout=subprocess.DEVNULL)
        for attempt in range(40):
            try:
                with urllib.request.urlopen('http://127.0.0.1:3001/aktywacja-kadry.html',timeout=2) as r:
                    if hashlib.sha256(r.read()).digest()==hashlib.sha256(targets[APP/'public/aktywacja-kadry.html']).digest():break
            except OSError:pass
            time.sleep(1)
        else:raise RuntimeError('Nie można potwierdzić publikacji formularza.')
        if db("select has_table_privilege('authenticated','public.prohouse_workforce_profiles','select') or has_table_privilege('anon','public.prohouse_workforce_profiles','select')")!='f':
            raise RuntimeError('Zakres dostępu do widoku nieprawidłowy.')
    except BaseException:
        for p,data in prior.items():
            if data is None:p.unlink(missing_ok=True)
            else:write(p,data)
        db(batch(reverse))
        for name in ('supabase-edge-functions','prohouse-employee'):subprocess.run(['docker','restart',name],check=True)
        raise
    print('Gotowy formularz aktywacji i administracja wyłącznie w Centrum Pracownika.')

if __name__=='__main__':
    with open('/run/lock/prohouse-personnel-install','a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX);install()
