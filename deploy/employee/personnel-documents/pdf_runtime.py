"""Install the pinned standalone Mozilla renderer and bind the personnel preview to it."""
import datetime
import fcntl
import hashlib
import io
import os
import re
import shutil
import subprocess
import tarfile
import tempfile
import urllib.request
from pathlib import Path

from patch import HERE, once

PUBLIC = Path('/opt/prohouse-employee/public')
VERSION = '5.6.205'
ROOT = '/assets/employee-pdfjs-'+VERSION
MANIFEST = '03b5b907f0d4f8958c73bb2d12fafbdea8be36f5346b2d1f48cb1cd31a6ca5fc'
SCRIPTS = {'legacy/build/pdf.min.mjs':'pdf.min.mjs','legacy/build/pdf.worker.min.mjs':'pdf.worker.min.mjs','LICENSE':'LICENSE'}
RESOURCE_DIRS = ('cmaps','standard_fonts','wasm','iccs')


def target(name):
    if name in SCRIPTS:
        return SCRIPTS[name]
    parts=name.split('/')
    if len(parts)==2 and parts[0] in RESOURCE_DIRS and re.fullmatch(r'[\w.-]+',parts[1]) and not parts[1].startswith('.'):
        return name
    return None


def digest(records):
    h=hashlib.sha256()
    for name in sorted(records):
        h.update(name.encode()+b'\0'+hashlib.sha256(records[name]).digest())
    return h.hexdigest()


def ensure_renderer():
    folder=PUBLIC/ROOT[1:]
    if folder.exists():
        entries={k:(folder/v).read_bytes() for k,v in SCRIPTS.items()}
        for d in RESOURCE_DIRS:
            for p in (folder/d).iterdir():
                if p.is_file():entries[d+'/'+p.name]=p.read_bytes()
        if digest(entries)!=MANIFEST:raise ValueError('Niezgodna suma plików PDF.js na serwerze.')
        return
    url='https://registry.npmjs.org/pdfjs-dist/-/pdfjs-dist-'+VERSION+'.tgz'
    with urllib.request.urlopen(url,timeout=45) as response:
        raw=response.read(64*1024*1024)
    entries={}
    with tarfile.open(fileobj=io.BytesIO(raw),mode='r:gz') as archive:
        for member in archive:
            if not member.isfile() or not member.name.startswith('package/'):continue
            name=member.name[len('package/'):]
            if target(name):
                if name in entries or member.size>12*1024*1024:raise ValueError('Nieoczekiwany plik w pakiecie PDF.js.')
                entries[name]=archive.extractfile(member).read()
    if digest(entries)!=MANIFEST:raise ValueError('Pobrane zasoby PDF.js różnią się od sprawdzonej wersji.')
    with tempfile.TemporaryDirectory(dir=folder.parent) as temp:
        stage=Path(temp)/'renderer';stage.mkdir(mode=0o755)
        for name,content in entries.items():
            p=stage/target(name)
            p.parent.mkdir(parents=True,exist_ok=True)
            p.parent.chmod(0o755);p.write_bytes(content);p.chmod(0o644)
        stage.rename(folder)


def write(path, data):
    with tempfile.NamedTemporaryFile(dir=path.parent,delete=False) as f:
        f.write(data.encode())
    os.chmod(f.name,0o644)
    os.replace(f.name,path)


def repair():
    ensure_renderer()
    index,worker=PUBLIC/'index.html',PUBLIC/'sw.js'
    html,sw=index.read_text(),worker.read_text()
    entry=re.search(r'<script[^>]*\btype="module"[^>]*\bsrc="(/assets/[\w.-]+\.js)"',html)
    if not entry:raise ValueError('Brak modułu startowego.')
    old_path=entry[1]
    src=(PUBLIC/old_path[1:]).read_text()
    first=src.index('function PersonnelDialog(')
    end=src.index('function ProhousePersonnel(',first)
    src=src[:first]+(HERE/'dialog.js').read_text()+'\n'+src[end:]
    suffix=hashlib.sha256(src.encode()).hexdigest()[:14]
    js_url='/assets/employee-doc-view-'+suffix+'.js'
    pdf_url=ROOT+'/pdf.min.mjs'
    worker_url=ROOT+'/pdf.worker.min.mjs'
    if old_path==js_url and worker_url in sw and pdf_url in sw:
        print('Zgodny podgląd PDF jest już aktywny.');return
    new_html=once(html,old_path,js_url)
    new_sw=once(sw,old_path,js_url)
    new_sw=re.sub(r'"/assets/pdf-doc-view-[0-9a-f]+\.js",','',new_sw)
    for url in (worker_url,pdf_url):
        if url not in new_sw:
            new_sw=once(new_sw,'const STATIC=[','const STATIC=["'+url+'",')
    old_cache=re.search(r"""const CACHE\s*=\s*['"]([^'"]+)['"]""",sw)[1]
    new_sw=once(new_sw,old_cache,'prohouse-shell-doc-view-'+suffix)
    backup=Path('/opt/prohouse/backups')/datetime.datetime.now(datetime.timezone.utc).strftime('personnel-pdf-%Y%m%d-%H%M%S-%f')
    backup.mkdir(mode=0o700,parents=True)
    shutil.copy2(index,backup/'index.html');shutil.copy2(worker,backup/'sw.js')
    write(PUBLIC/js_url[1:],src)
    subprocess.run(['docker','exec','prohouse-employee','node','--check','/app/public'+js_url],check=True)
    try:
        write(worker,new_sw);write(index,new_html)
    except BaseException:
        write(worker,sw);write(index,html);raise
    print('Zainstalowano zgodny czytnik PDF. Kopia:',backup)


if __name__=='__main__':
    with open('/run/lock/prohouse-personnel-install','w') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX)
        repair()
