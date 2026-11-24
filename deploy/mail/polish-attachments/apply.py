"""Apply only the mail spelling and attachment-export changes to the existing webmail code."""
from pathlib import Path
import datetime, fcntl, hashlib, os, re, shutil, subprocess, tempfile, sys

HERE=Path(__file__).resolve().parent
ROOT=Path('/opt/prohouse-poczta')


def replace(s,old,new):
    if s.count(old)!=1:raise ValueError('Nie rozpoznano wersji przy '+old[:65])
    return s.replace(old,new,1)


def build(root):
    result={}
    def changed(file,fn):result[file]=fn((root/file).read_text())
    def html(s):
        s=replace(s,'<input name="subject" required maxlength="250">','<input name="subject" lang="pl" spellcheck="true" required maxlength="250">')
        s=replace(s,'<textarea name="text"','<textarea lang="pl" spellcheck="true" name="text"')
        t=s.index('<textarea lang="pl" spellcheck="true" name="text"')
        end=s.index('</label>',s.index('</textarea>',t))+len('</label>')
        s=s[:end]+('<div class="polish-mail-check"><button type="button" class="text-button" id="polish-spelling-check">Sprawdź pisownię</button>'
          '<span id="polish-spelling-status" role="status"></span><div id="polish-spelling-words"></div></div>')+s[end:]
        badge=re.search(r'<span\b[^>]*\bid="selection-count"[^>]*>[^<]*</span>',s)
        if not badge:raise ValueError('Brak licznika zaznaczeń w skrzynce.')
        s=replace(s,badge[0],badge[0]+'<button type="button" class="secondary" id="download-selected-files" disabled>Pobierz załączniki (ZIP)</button><span id="attachment-export-status" role="status"></span>')
        tag=hashlib.sha256((HERE/'polish-mail.js').read_bytes()).hexdigest()[:12]
        return replace(s,'</head>',f'<script src="/polish-mail.js?v={tag}" defer></script></head>')
    changed('public/index.html',html)
    changed('server.mjs',lambda s:"import {attachPolishMail} from './polish-mail.mjs';\n"+replace(s,'attachAdvanced({app,', 'attachPolishMail({app,session,account,db,imap,folder,data});\nattachAdvanced({app,'))
    changed('mail-render.mjs',lambda s:replace(replace(s,'{attachmentId=null,onAttachment=null}={}', '{attachmentId=null,onAttachment=null,onEachAttachment=null}={}'), 'if(id===attachmentId&&onAttachment)onAttachment(part,record);else part.content.resume();','if(onEachAttachment)onEachAttachment(part,record,id);else if(id===attachmentId&&onAttachment)onAttachment(part,record);else part.content.resume();'))
    changed('Dockerfile',lambda s:replace(replace(s,'ca-certificates','ca-certificates hunspell hunspell-pl zip unzip'),'COPY --chown=node:node public ./public','COPY --chown=node:node polish-mail.mjs ./\nCOPY --chown=node:node public ./public'))
    result['polish-mail.mjs']=(HERE/'polish-mail.mjs').read_text()
    result['public/polish-mail.js']=(HERE/'polish-mail.js').read_text()
    return result


def run(*args,cwd=ROOT):
    return subprocess.run(args,cwd=cwd,check=True)


def main():
    local=len(sys.argv)>2 and sys.argv[1]=='--package'
    root=Path(sys.argv[2]).resolve() if local else ROOT
    if not local:
        deploy_lock=open('/run/lock/prohouse-poczta-polish-zip.lock','a')
        fcntl.flock(deploy_lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        # A live checkout may already contain a prior revision of this add-on.
        if (root/'polish-mail.mjs').exists():raise ValueError('Aktualizacja jest już obecna. Sprawdź jej wersję przed ponowieniem.')
    files=build(root)
    if local:
        for name,body in files.items():(root/name).write_text(body)
        return
    backup=Path('/opt/prohouse/backups')/datetime.datetime.now(datetime.timezone.utc).strftime('mail-polish-zip-%Y%m%d-%H%M%S-%f')
    def output(*args):return subprocess.check_output(args,cwd=root,text=True).strip()
    container=output('docker','compose','ps','-q','panel')
    old_image=output('docker','inspect','--format','{{.Image}}',container)
    old_tag=output('docker','inspect','--format','{{.Config.Image}}',container)
    switching=False
    backup.mkdir(parents=True,mode=0o700)
    old={}
    for name in files:
        p=root/name
        if p.exists():
            b=backup/name;b.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(p,b);old[name]=b
    try:
        for name,body in files.items():
            with tempfile.NamedTemporaryFile(dir=(root/name).parent,mode='w',delete=False) as f:f.write(body)
            os.chmod(f.name,0o644);os.replace(f.name,root/name)
        run('docker','compose','build','panel')
        fixture=backup/'verify-polish-mail.mjs'
        shutil.copyfile(HERE/'verify.mjs',fixture)
        fixture.chmod(0o644)
        run('docker','compose','run','--no-deps','--rm','-T','--entrypoint','node','-v',str(fixture)+':/app/verify-polish-mail.mjs:ro','panel','/app/verify-polish-mail.mjs')
        switching=True
        run('docker','compose','up','-d','--no-deps','--no-build','panel')
        run('python3','-c',"""import time,urllib.request
for n in range(30):
 try:
  with urllib.request.urlopen('http://127.0.0.1:3085/',timeout=2) as r:
   if b'download-selected-files' in r.read():break
 except OSError:pass
 time.sleep(1)
else:raise RuntimeError('Panel nie potwierdził nowej wersji.')""")
    except BaseException:
        for name in files:
            if name in old:shutil.copy2(old[name],root/name)
            else:(root/name).unlink(missing_ok=True)
        run('docker','image','tag',old_image,old_tag)
        if switching:run('docker','compose','up','-d','--no-deps','--no-build','panel')
        raise
    print('MAIL_POLISH_ZIP_DEPLOYED',backup)


if __name__=='__main__':main()
