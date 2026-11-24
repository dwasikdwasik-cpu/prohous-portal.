"""Deploy only invitation and trash changes to the portal serving klient.prohous.pl."""
import sys
sys.path.pop(0)
import fcntl
import json
import os
import re
import shutil
import subprocess
import tempfile
import time
import urllib.request
from pathlib import Path

BASE='c88c633508be785b860f5853fac8f86e511757d3'
SOURCE=Path(__file__).resolve().parents[2]
MIG='supabase/migrations/20261124193000_client_panel_invitations.sql'
NEW=['app/ClientInvitations.tsx','app/EmptyDocumentTrash.tsx','app/api/admin/client-invitations/route.ts',
     'app/api/client-invitations/route.ts','app/zaproszenie/page.tsx','lib/panel-invitations.ts',MIG]
def out(*cmd,**kw):
    return subprocess.check_output(cmd,text=True,**kw).strip()
def must(condition,message):
    if not condition: raise RuntimeError(message)
def info(name):return json.loads(out('docker','inspect',name))[0]
def variables(container):return dict(s.split('=',1) for s in container['Config']['Env'])
def baseline(path):return subprocess.check_output(['git','-C',SOURCE,'show',BASE+':'+path])
def replacement(text,old,new):
    must(text.count(old)==1,'Nie można bezpiecznie dopasować fragmentu: '+old[:55])
    return text.replace(old,new,1)
def merged(root,path):
    local=(root/path).read_bytes()
    new=(SOURCE/path).read_bytes()
    base=baseline(path)
    if local==base:return new
    if path=='app/page.tsx':
        s=local.decode()
        for anchor,end in [('import AccountSettings','import AccountSettings'),("{tab==='admin'&&admin&&<>{selected&&<CameraPanel",'{selected&&<CameraPanel'),('<summary>Kosz ({trashed.length})</summary>','</summary>')]:
            if anchor=='import AccountSettings':
                mod=new.decode().split('import ClientInvitations',1)[1].split(end,1)[0]
                s=replacement(s,anchor,'import ClientInvitations'+mod+anchor)
            elif end.startswith('{selected'):
                mod=new.decode().split("{tab==='admin'&&admin&&<>",1)[1].split(end,1)[0]
                s=replacement(s,anchor,"{tab==='admin'&&admin&&<>"+mod+end)
            else:
                mod=new.decode().split(anchor,1)[1].split('<p className=',1)[0]
                s=replacement(s,anchor,anchor+mod)
        return s.encode()
    if path in ('package.json','package-lock.json'):
        current=json.loads(local);old=json.loads(base);updated=json.loads(new)
        def add_changes(dst,b,a):
            for k in a:
                if k not in b:
                    must(k not in dst or dst[k]==a[k],'Konflikt zależności npm: '+k)
                    dst[k]=a[k]
                elif a[k]!=b[k]:
                    must(isinstance(a[k],dict) and k in dst,'Konflikt sekcji npm: '+k)
                    add_changes(dst[k],b[k],a[k])
        add_changes(current,old,updated)
        return (json.dumps(current,indent=2,ensure_ascii=False)+'\n').encode()
    # Three-way merge preserves additions to previews and document downloads on the VPS.
    with tempfile.TemporaryDirectory() as d:
        p=Path(d)/'base';p.write_bytes(base)
        r=subprocess.run(['git','merge-file','-p',root/path,p,SOURCE/path],capture_output=True)
        must(r.returncode==0,'Konflikt pliku '+path)
        return r.stdout

def sql(query):
    r=subprocess.run(['docker','exec','-i','supabase-db','psql','-X','-qAt','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres'],input=query,text=True,capture_output=True)
    must(r.returncode==0,'Błąd bazy: '+r.stderr[:750])
    return r.stdout.strip()

def run():
    import yaml
    os.umask(0o077)
    lock=open('/run/lock/prohouse-client-invitations.lock','a')
    fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    active=info(out('docker','ps','-q','--filter','publish=3302')); labels=active['Config']['Labels']
    project=labels['com.docker.compose.project'];service=labels['com.docker.compose.service']
    must(project=='prohouse-scan-upload' and service=='portal','Nieoczekiwana usługa portalu')
    files=[Path(p) for p in labels['com.docker.compose.project.config_files'].split(',')]
    envfiles=[Path(p) for p in labels['com.docker.compose.project.environment_file'].split(',') if p]
    prefix=['docker','compose','-p',project]
    for p in envfiles:prefix+=['--env-file',str(p)]
    for p in files:prefix+=['-f',str(p)]
    old_cfg=json.loads(out(*prefix,'config','--format','json'))
    config=old_cfg['services'][service]
    old_image=active['Config']['Image']
    must(config['image']==old_image,'Obraz zapisany w Compose różni się od aktywnego')
    root=Path(config['build']['context'])
    must(root==Path('/opt/prohouse-scan-upload'),'Nieoczekiwany katalog źródłowy')
    live_env=variables(active)
    must(all(live_env.get(k)==str(v) for k,v in config.get('environment',{}).items()),'Niezgodne ustawienia aktywnego kontenera')
    print('Sprawdzono aktywny projekt i konfigurację.',flush=True)
    outputs={}
    for name in NEW:
        dest=root/name;data=(SOURCE/name).read_bytes()
        must(not dest.exists() or dest.read_bytes()==data,'Istnieją inne zmiany: '+name)
        outputs[dest]=data
    for name in ['app/page.tsx','app/api/document/[id]/route.ts','lib/client-preview.mjs','package.json','package-lock.json']:
        outputs[root/name]=merged(root,name)
    # Preserve the existing authorization predicates before installing our additive policy.
    def compact(s):return ''.join(s.lower().split()).rstrip(';')
    for func,filename in [('public.can_access_investment(uuid)','20261106103736_investment_trash.sql'),('private.client_finance_visible(uuid,text)','20261106104532_client_financial_visibility.sql')]:
        old=(SOURCE/'supabase/migrations'/filename).read_text().split('function '+func.split('(')[0]+'(',1)[1].split('$$',2)[1]
        actual=sql("select prosrc from pg_proc where oid='"+func+"'::regprocedure;")
        must(compact(old)==compact(actual),'Istnieją dodatkowe reguły uprawnień: '+func)
    must(sql("select to_regprocedure('private.start_portal_document_removal(uuid,text)') is not null and to_regclass('private.portal_invitations') is null;")=='t','Sprawdź stan migracji i mechanizmu usuwania')
    auth=variables(info('supabase-auth')); gateway=variables(info('supabase-envoy'))
    settings={'SUPABASE_URL':'http://supabase-envoy:8000','SUPABASE_SERVICE_ROLE_KEY':gateway['SERVICE_ROLE_KEY']}
    for dst,src in [('HOST','HOST'),('PORT','PORT'),('USER','USER'),('PASS','PASS'),('FROM','ADMIN_EMAIL')]:
        settings['PORTAL_SMTP_'+dst]=auth['GOTRUE_SMTP_'+src]
    must(all(settings.values()),'Brakuje konfiguracji poczty lub autoryzacji')
    private=Path('/opt/prohouse/private/client-invitations')
    private.mkdir(mode=0o700,exist_ok=True); secret=private/'settings.json'
    uid=int(out('docker','exec',active['Id'],'id','-u'))
    gid=int(out('docker','exec',active['Id'],'id','-g'))
    mount='/run/secrets/prohouse-panel-invitations.json'
    release=out('git','-C',SOURCE,'rev-parse','--short=12','HEAD')
    new_image=old_image.rsplit(':',1)[0]+':panel-'+release
    overlay=files[-1]
    doc=yaml.safe_load(overlay.read_text())
    portal=doc['services'][service]
    portal['image']=new_image
    portal.setdefault('volumes',[]).append({'type':'bind','source':str(secret),'target':mount,'read_only':True})
    # SMTP on the VPS uses a split DNS hostname and an existing isolated mail network.
    mail_net='ph_auth_smtp'
    if mail_net in info('supabase-auth')['NetworkSettings']['Networks'] and mail_net not in active['NetworkSettings']['Networks']:
        nets=portal.setdefault('networks',{})
        if isinstance(nets,list):nets.append(mail_net)
        else:nets[mail_net]={}
        doc.setdefault('networks',{})[mail_net]={'external':True,'name':mail_net}
    outputs[overlay]=yaml.safe_dump(doc,sort_keys=False,allow_unicode=True).encode()
    backup=Path(tempfile.mkdtemp(prefix='panel-invitations-',dir='/opt/prohouse/backups'))
    print('Kopia i dziennik:',backup,flush=True)
    saved={};started=False;applied=False
    def save(path,data,mode=None):
        previous=None
        if path.exists():
            previous=backup/str(path).lstrip('/');previous.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(path,previous)
        saved[path]=previous
        path.parent.mkdir(parents=True,exist_ok=True)
        with tempfile.NamedTemporaryFile(dir=path.parent,delete=False) as f:
            f.write(data);tmp=Path(f.name)
        if previous:shutil.copystat(previous,tmp)
        else:os.chmod(tmp,mode or 0o644)
        os.replace(tmp,path)
    def restore():
        for path,previous in reversed(list(saved.items())):
            if previous:shutil.copy2(previous,path)
            else:path.unlink(missing_ok=True)
    try:
        save(secret,json.dumps(settings).encode(),0o400);os.chown(secret,uid,gid)
        for p,data in outputs.items():save(p,data)
        new_cfg=json.loads(out(*prefix,'config','--format','json'))
        expected=json.loads(json.dumps(old_cfg['services']))
        exp=expected[service];now=new_cfg['services'][service]
        exp['image']=new_image
        volumes=[m for m in now['volumes'] if m['target']==mount]
        must(len(volumes)==1 and volumes[0]['source']==str(secret) and volumes[0].get('read_only'),'Nieprawidłowe podłączenie ustawień')
        exp['volumes']=sorted([*exp.get('volumes',[]),*volumes],key=lambda x:x['target'])
        now['volumes']=sorted(now['volumes'],key=lambda x:x['target'])
        if mail_net in now['networks']:exp.setdefault('networks',{})[mail_net]=now['networks'][mail_net]
        must(expected==new_cfg['services'],'Wykryto dodatkowe zmiany usług Compose')
        print('Budowanie obrazu portalu.',flush=True)
        with (backup/'build.log').open('w') as log:subprocess.run([*prefix,'build',service],stdout=log,stderr=subprocess.STDOUT,check=True)
        must(info(active['Id'])['State']['Running'],'Podczas budowania zmieniła się aktywna usługa')
        # Check authenticated SMTP and the internal Auth admin route without sending a message or creating a user.
        verifier="""
const fs=require('fs'),nodemailer=require('nodemailer');
const s=JSON.parse(fs.readFileSync('/run/secrets/prohouse-panel-invitations.json'));
(async()=>{
 const r=await fetch(s.SUPABASE_URL+'/auth/v1/admin/users/00000000-0000-4000-8000-000000000000',{headers:{apikey:s.SUPABASE_SERVICE_ROLE_KEY,Authorization:'Bearer '+s.SUPABASE_SERVICE_ROLE_KEY}});
 if(r.status!==404)throw Error('Auth '+r.status);
 const port=Number(s.PORTAL_SMTP_PORT);
 await nodemailer.createTransport({host:s.PORTAL_SMTP_HOST,port,secure:port===465,requireTLS:port!==465,auth:{user:s.PORTAL_SMTP_USER,pass:s.PORTAL_SMTP_PASS},connectionTimeout:10000,socketTimeout:12000}).verify();
 console.log('AUTH_SMTP_OK');
})().catch(e=>{console.error(e.code||e.message.slice(0,45));process.exit(1)});
"""
        with (backup/'preflight.log').open('w') as log:subprocess.run([*prefix,'run','--rm','--no-deps','-T','--entrypoint','node',service,'-e',verifier],stdout=log,stderr=subprocess.STDOUT,check=True)
        print('Połączenia Auth i SMTP sprawdzone.',flush=True)
        sql('begin;\n'+(SOURCE/MIG).read_text()+"\nnotify pgrst,'reload schema';commit;")
        applied=True;print('Migracja zakończona.',flush=True)
        started=True
        subprocess.run([*prefix,'up','-d','--no-deps','--no-build','--wait','--wait-timeout','120',service],check=True)
        req=urllib.request.Request('http://127.0.0.1:3302/zaproszenie',headers={'Host':'klient.prohous.pl'})
        with urllib.request.urlopen(req,timeout=12) as r:must('Zaproszenie do panelu' in r.read().decode(),'Brak strony zaproszenia')
        print('PANEL_INVITATIONS_DEPLOYED',new_image,flush=True)
    except BaseException:
        restore()
        if started:subprocess.run([*prefix,'up','-d','--no-deps','--no-build','--wait','--wait-timeout','120',service],check=True)
        if applied:print('Poprzednia wersja aplikacji przywrócona. Migracja addytywna zachowana.',flush=True)
        raise
if __name__=='__main__':run()
