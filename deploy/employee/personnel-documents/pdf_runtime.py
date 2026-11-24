"""Keep the PDF chunk on the active application entry instead of booting a second React root."""
import datetime
import hashlib
import os
import re
import shutil
import subprocess
import tempfile
from pathlib import Path

from patch import once

PUBLIC = Path('/opt/prohouse-employee/public')


def prepare(source, renderer, old_pdf):
    first = re.match(r"""(import\{[^;\n]+\}from)(["'`])(\./[\w.-]+\.js)\2;""",renderer)
    if not first or not first[3].startswith(('./index-','./employee-')):
        raise ValueError('Nie rozpoznano zależności modułu PDF od punktu startowego panelu.')
    tag = hashlib.sha256(('personnel-pdf-2\0'+source+'\0'+renderer).encode()).hexdigest()[:14]
    js_name = 'employee-doc-view-'+tag+'.js'
    pdf_name = 'pdf-doc-view-'+tag+'.js'
    head = renderer[:first.start(3)]+'./'+js_name+renderer[first.end(3):]
    source = once(source, "import('./"+old_pdf+"')", "import('./"+pdf_name+"')")
    return js_name, source, pdf_name, head


def write(path, data):
    with tempfile.NamedTemporaryFile(dir=path.parent,delete=False) as f:
        f.write(data.encode())
    os.chmod(f.name,0o644)
    os.replace(f.name,path)


def repair():
    index,worker=PUBLIC/'index.html',PUBLIC/'sw.js'
    html,sw=index.read_text(),worker.read_text()
    entry=re.search(r'<script[^>]*\btype="module"[^>]*\bsrc="(/assets/[\w.-]+\.js)"',html)
    if not entry:raise ValueError('Brak modułu startowego.')
    old_path=entry[1]
    src=(PUBLIC/old_path[1:]).read_text()
    viewed=re.search(r"""const \[pdf,bytes\]=await Promise\.all\(\[import\('\./([\w.-]+\.js)'\)""",src)
    if not viewed:raise ValueError('Brak oczekiwanego podglądu kartoteki.')
    old_pdf=viewed[1]
    renderer=(PUBLIC/'assets'/old_pdf).read_text()
    if old_pdf.startswith('pdf-doc-view-') and ('from"./'+Path(old_path).name+'"') in renderer[:200]:
        print('Podgląd PDF jest już połączony z bieżącym panelem.')
        return
    js_name,new_src,pdf_name,new_pdf=prepare(src,renderer,old_pdf)
    js_url='/assets/'+js_name
    pdf_url='/assets/'+pdf_name
    new_html=once(html,old_path,js_url)
    new_sw=once(sw,old_path,js_url)
    new_sw=once(new_sw,'const STATIC=[','const STATIC=["'+pdf_url+'",')
    old_cache=re.search(r"""const CACHE\s*=\s*['"]([^'"]+)['"]""",sw)[1]
    new_sw=once(new_sw,old_cache,'prohouse-shell-'+js_name[:-3])
    backup=Path('/opt/prohouse/backups')/datetime.datetime.now(datetime.timezone.utc).strftime('personnel-pdf-%Y%m%d-%H%M%S-%f')
    backup.mkdir(mode=0o700,parents=True)
    shutil.copy2(index,backup/'index.html');shutil.copy2(worker,backup/'sw.js')
    for url, content in ((js_url,new_src),(pdf_url,new_pdf)):
        write(PUBLIC/url[1:],content)
        subprocess.run(['docker','exec','prohouse-employee','node','--check','/app/public'+url],check=True)
    try:
        write(worker,new_sw)
        write(index,new_html)
    except BaseException:
        write(worker,sw);write(index,html)
        raise
    print('Podgląd PDF używa aktualnego panelu. Kopia:',backup)


if __name__=='__main__':
    import fcntl
    with open('/run/lock/prohouse-personnel-install','w') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX)
        repair()
