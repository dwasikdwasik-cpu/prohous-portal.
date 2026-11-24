"""Apply only the personnel changes to the current VPS release."""
import datetime
import fcntl
import hashlib
import os
import re
import shutil
import subprocess
import tempfile
from pathlib import Path

from patch import HERE, backend, frontend, once
from pdf_runtime import repair

APP = Path('/opt/prohouse-employee')
PUBLIC = APP/'public'
EDGE = Path('/opt/prohouse-backend/docker/volumes/functions/prohouse-personnel/index.ts')
PROXY = APP/'api/personnel.mjs'


def db(sql):
    return subprocess.run(['docker','exec','-i','supabase-db','psql','-XqAt','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres'],
                          input=sql,text=True,capture_output=False,stdout=subprocess.PIPE,check=True).stdout.strip()


def atomic(path, data):
    with tempfile.NamedTemporaryFile(dir=path.parent,mode='wb',delete=False) as f:
        f.write(data)
    os.chmod(f.name,0o644)
    os.replace(f.name,path)


def restart(name):
    subprocess.run(['docker','restart',name],check=True,stdout=subprocess.DEVNULL)


def install():
    index, sw = PUBLIC/'index.html', PUBLIC/'sw.js'
    html, old_sw = index.read_text(), sw.read_text()
    entry = re.search(r'<script[^>]*\btype="module"[^>]*\bsrc="(/assets/[\w.-]+\.js)"',html)
    if not entry:
        raise ValueError('Nie rozpoznano modułu aplikacji.')
    old_asset = entry[1]
    src = (PUBLIC/old_asset[1:]).read_text()
    if 'function PersonnelFilePreview(' in src and 'function confirmAction(doc,op)' in src:
        if 'prohouse_personnel_files_api' in EDGE.read_text() and "'document_delete'" in PROXY.read_text():
            print('Aktualizacja kartoteki jest już zainstalowana.')
            return
        raise ValueError('Wymagane sprawdzenie częściowo wdrożonej aktualizacji.')
    new_src = frontend(src)
    proxy, edge = backend(PROXY.read_text(), EDGE.read_text())
    css = (HERE/'dialog.css').read_text()
    tag = hashlib.sha256((new_src+css+edge+proxy).encode()).hexdigest()[:14]
    asset = '/assets/employee-documents-'+tag+'.js'
    style = '/assets/employee-documents-'+tag+'.css'
    next_html = once(once(html,old_asset,asset),'</head>',f'<link rel="stylesheet" href="{style}"></head>')
    next_sw = once(old_sw, old_asset, asset)
    cache = re.search(r"""const CACHE\s*=\s*['"]([^'"]+)['"]""",next_sw)[1]
    next_sw = once(once(next_sw,cache,'prohouse-shell-documents-'+tag),'const STATIC=[','const STATIC=["'+style+'",')
    # Identify the table through the original function plus its known document columns.
    table = db("""select format('%I.%I',n.nspname,c.relname)
      from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where c.relkind='r' and n.nspname not in ('information_schema','pg_catalog','storage')
      and position(lower(n.nspname||'.'||c.relname) in lower(pg_get_functiondef('public.prohouse_personnel_api(jsonb,uuid)'::regprocedure)))>0
      and (select count(*) from pg_attribute a where a.attrelid=c.oid and not a.attisdropped
        and a.attname in ('id','state','employee_id','filename','mime','size_bytes'))=6;""")
    if not re.fullmatch(r'[a-z_][a-z_0-9]*\.[a-z_][a-z_0-9]*',table):
        raise ValueError('Nie udało się jednoznacznie ustalić tabeli dokumentów kartoteki.')
    sql = (HERE/'actions.sql').read_text().replace('__DOCUMENT_TABLE__',table)
    check = (HERE/'db-check.sql').read_text().replace('__DOCUMENT_TABLE__',table)
    sql = 'begin;\n'+sql+'\nsavepoint doc_test;\nset local role service_role;\n'+check+'\nrollback to doc_test;\ncommit;'
    backup = Path('/opt/prohouse/backups')/datetime.datetime.now(datetime.timezone.utc).strftime('personnel-documents-%Y%m%d-%H%M%S-%f')
    backup.mkdir(parents=True,mode=0o700)
    touched = {p:p.read_bytes() for p in (index,sw,PROXY,EDGE)}
    for p,name in ((index,'index.html'),(sw,'sw.js'),(PROXY,'personnel.mjs'),(EDGE,'edge.ts')):
        shutil.copy2(p,backup/name)
    atomic(PUBLIC/asset[1:],new_src.encode())
    atomic(PUBLIC/style[1:],css.encode())
    subprocess.run(['docker','exec','prohouse-employee','node','--check','/app/public'+asset],check=True)
    db(sql)  # Additive schema. No real document is changed by installation.
    try:
        atomic(EDGE,edge.encode())
        restart('supabase-edge-functions')
        atomic(PROXY,proxy.encode())
        restart('prohouse-employee')
        atomic(sw,next_sw.encode())
        atomic(index,next_html.encode())
    except BaseException:
        for p,data in touched.items():
            atomic(p,data)
        restart('supabase-edge-functions')
        restart('prohouse-employee')
        raise
    print('Zainstalowano zmiany w kartotece. Próba bazy została wycofana. Kopia kodu:',backup)


if __name__=='__main__':
    with open('/run/lock/prohouse-personnel-install','w') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX)
        install()
        repair()
