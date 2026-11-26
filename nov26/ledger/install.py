"""Extend the currently deployed employee ledger without replacing other modules."""
import datetime
import fcntl
import hashlib
import os
import re
import shutil
import subprocess
import tempfile
from pathlib import Path

HERE=Path(__file__).resolve().parent
PUBLIC=Path('/opt/prohouse-employee/public')

def one(source,old,new):
    if source.count(old)!=1:
        raise ValueError('Wymagane scalenie wersji ewidencji: '+old[:65])
    return source.replace(old,new,1)

def patch(src):
    if 'async function PHAllLedgers(' in src:
        return src
    signature='function PHLedgerPDF(employee, month, days, rawManual, manual, registered, absences, index)'
    src=one(src,signature,signature[:-1]+', collectPages)')
    start=src.index(signature[:-1]);end=src.index('\n}',start)
    block=src[start:end]
    block=one(block,'return PHPDFDocument({','return PHPDFDocument({collectPages,')
    src=src[:start]+block+src[end:]
    sig='async function PHPDFDocument({title,subtitle,headers,widths,rows,summary,note,filename})'
    src=one(src,sig,sig.replace('filename','filename,collectPages'))
    marker='const pdf=PHImagesPDF(pages,W,H)'
    src=one(src,marker,'if (collectPages) { for (const page of pages) collectPages.push(page); return; }\n '+marker)
    marker='(0,F.jsx)(PHPDFButton,{build:()=>PHLedgerPDF(S,l,T,rawManual,w,C,r,limitIndex)'
    button="(0,F.jsx)(PHPDFButton,{build:()=>PHAllLedgers(e,l,T,n,t,r,limitIndex),label:'Wszyscy pracownicy (jeden PDF)',disabled:!e.length||!l||!limitIndex}),"
    return one(src,marker,button+marker)+'\n'+(HERE/'combined.js').read_text()

def write(path,content):
    with tempfile.NamedTemporaryFile(dir=path.parent,mode='w',delete=False) as f:
        f.write(content)
    os.chmod(f.name,0o644)
    os.replace(f.name,path)

def install():
    html=(PUBLIC/'index.html').read_text()
    sw=(PUBLIC/'sw.js').read_text()
    old=re.search(r'<script[^>]*type="module"[^>]*src="(/assets/[\w.-]+\.js)"',html)[1]
    source=(PUBLIC/old[1:]).read_text()
    new=patch(source)
    if new==source:
        print('Zbiorczy PDF jest już dostępny.');return
    tag=hashlib.sha256(new.encode()).hexdigest()[:14]
    asset='/assets/employee-ledger-all-'+tag+'.js'
    new_html=one(html,old,asset)
    cache=re.search(r"""const CACHE\s*=\s*['"]([^'"]+)['"]""",sw)[1]
    new_sw=one(one(sw,old,asset),cache,'prohouse-staff-'+tag)
    backup=Path('/opt/prohouse/backups')/datetime.datetime.now(datetime.timezone.utc).strftime('ledger-all-%Y%m%d-%H%M%S-%f')
    backup.mkdir(parents=True,mode=0o700)
    for name in ('index.html','sw.js'):shutil.copy2(PUBLIC/name,backup/name)
    write(PUBLIC/asset[1:],new)
    subprocess.run(['docker','exec','prohouse-employee','node','--check','/app/public'+asset],check=True)
    try:
        write(PUBLIC/'sw.js',new_sw)
        write(PUBLIC/'index.html',new_html)
    except BaseException:
        write(PUBLIC/'sw.js',sw)
        write(PUBLIC/'index.html',html)
        raise
    print('Gotowy zbiorczy PDF: '+asset)

if __name__=='__main__':
    with open('/run/lock/prohouse-personnel-install','a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX)
        install()
