"""Deploy client roster and preview changes to klient.prohous.pl."""
import fcntl
import json
import os
import re
import shutil
import subprocess
import tempfile
import urllib.request
from pathlib import Path

source=Path(__file__).resolve().parents[1]
base='b6d0532081a8ac944eb152c185b762afc99303e9'
migration='supabase/migrations/20261125220000_client_panel_people.sql'
previous_migration='supabase/migrations/20261124193000_client_panel_invitations.sql'
app_files=['app/ClientInvitations.tsx','app/api/admin/client-invitations/route.ts','app/page.tsx']


def output(*args):
    return subprocess.check_output(args,text=True).strip()


def require(value,message):
    if not value:
        raise RuntimeError(message)


def integrate(root,name):
    live=root/name
    with tempfile.TemporaryDirectory() as work:
        baseline=Path(work)/'baseline'
        baseline.write_bytes(subprocess.check_output(['git','-C',source,'show',f'{base}:{name}']))
        desired=source/name
        if live.read_bytes()==desired.read_bytes():
            return desired.read_bytes()
        merged=subprocess.run(['git','merge-file','-p',live,baseline,desired],capture_output=True)
        if merged.returncode==0:
            return merged.stdout
        require(name=='app/page.tsx','Konflikt w aktywnym pliku '+name)
        page=live.read_text()
        old=baseline.read_text().splitlines()
        new=desired.read_text().splitlines()
        # Preserve production edits elsewhere on the long management JSX line.
        import difflib
        for op,i,j,k,l in difflib.SequenceMatcher(None,old,new,autojunk=False).get_opcodes():
            if op=='equal':
                continue
            require(op=='replace' and j-i==l-k,'Nie można dopasować pliku portalu')
            for bef,aft in zip(old[i:j],new[k:l]):
                if page.count(bef)==1:
                    page=page.replace(bef,aft,1)
                    continue
                require('<ClientInvitations ' in bef,'Konflikt integracji portalu')
                for pattern in (r'<ClientInvitations .*?/>',r'onClick=\{\(\)=>setClientPreviewId\(c\.id\)\}'):
                    before=re.search(pattern,bef)
                    after=re.search(pattern,aft) if pattern.startswith('<') else None
                    require(before is not None and page.count(before[0])==1,'Brak oczekiwanego fragmentu zarządzania')
                    page=page.replace(before[0],after[0] if after else 'onClick={()=>setClientPreview({clientId:c.id})}',1)
        return page.encode()


def schema_status():
    previous=(source/previous_migration).read_text()
    wanted=(source/migration).read_text()
    definitions=[
        ('private.reset_panel_members()', 'private.reset_panel_members'),
        ('private.manage_panel_invites(text,uuid,text,text,text)', 'private.manage_panel_invites'),
    ]
    def compact(body):return ''.join(body.split())
    def body(text,name):return compact(text.split('function '+name+'(',1)[1].split('$$',2)[1])
    current=[]
    for signature,name in definitions:
        live=compact(sql(f"select prosrc from pg_proc where oid=to_regprocedure('{signature}');"))
        require(live in (body(previous,name),body(wanted,name)),
                'Rozbieżność definicji w bazie '+name)
        current.append(live==body(wanted,name))
    require(all(current) or not any(current),'Migracja jest tylko częściowo zastosowana')
    return all(current)


def sql(statement):
    p=subprocess.run(['docker','exec','-i','supabase-db','psql','-X','-qAt','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres'],input=statement,text=True,capture_output=True)
    require(p.returncode==0,p.stderr[:1000])
    return p.stdout.strip()

def run():
    os.umask(0o077)
    lock=open('/run/lock/prohouse-client-invitations.lock','a')
    fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    active_id=output('docker','ps','-q','--filter','publish=3302')
    active=json.loads(output('docker','inspect',active_id))[0]
    labels=active['Config']['Labels']
    service=labels['com.docker.compose.service']
    project=labels['com.docker.compose.project']
    require((project,service)==('prohouse-scan-upload','portal'),'Nieoczekiwany projekt Compose')
    cmd=['docker','compose','-p',project]
    envs=[Path(p) for p in labels['com.docker.compose.project.environment_file'].split(',') if p]
    for env in envs: cmd+=['--env-file',str(env)]
    for name in labels['com.docker.compose.project.config_files'].split(','): cmd+=['-f',name]
    def config():return json.loads(output(*cmd,'config','--format','json'))['services']
    old=config()
    root=Path(old[service]['build']['context'])
    require(root==Path('/opt/prohouse-scan-upload') and old[service]['image']==active['Config']['Image'],'Konfiguracja różni się od działającego panelu')
    old_image=old[service]['image']
    require(envs,'Brak konfiguracji wersji')
    version=output('git','-C',source,'rev-parse','--short=12','HEAD')
    release='access-'+version
    image=old_image.rsplit(':',1)[0]+':'+release
    migrated=schema_status()
    changes={root/name:integrate(root,name) for name in app_files}
    migration_file=root/migration
    migration_bytes=(source/migration).read_bytes()
    require(not migration_file.exists() or migration_file.read_bytes()==migration_bytes,
            'Istnieje inna wersja migracji')
    changes[migration_file]=migration_bytes
    if old_image==image and migrated:
        require(all(p.exists() and p.read_bytes()==v for p,v in changes.items()),'Rozbieżność wydania')
        print('ACCESS_ALREADY_DEPLOYED',image,flush=True);return
    env=envs[-1]
    existing=env.read_text()
    pattern=r'(?m)^PORTAL_RELEASE=[^\n]*$'
    require(len(re.findall(pattern,existing))==1,'Brak selektora aktywnej wersji panelu')
    changes[env]=re.sub(pattern,'PORTAL_RELEASE='+release,existing).encode()
    backup=Path(tempfile.mkdtemp(prefix='client-panel-access-',dir='/opt/prohouse/backups'))
    print('Kopia i dziennik budowania:',backup,flush=True)
    saved={};switched=False
    try:
        for path,data in changes.items():
            if path.exists() and path.read_bytes()==data:continue
            prior=None
            if path.exists():
                prior=backup/str(path).lstrip('/');prior.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(path,prior)
            saved[path]=prior;path.parent.mkdir(parents=True,exist_ok=True)
            with tempfile.NamedTemporaryFile(dir=path.parent,delete=False) as f:f.write(data);tmp=Path(f.name)
            if prior:shutil.copystat(prior,tmp)
            else:tmp.chmod(0o644)
            os.replace(tmp,path)
        updated=config()
        require(updated[service]['image']==image,'Nie wybrano nowego obrazu')
        updated[service]['image']=old_image
        for name,c in updated.items():
            if c.get('environment',{}).get('PORTAL_RELEASE')==release and 'PORTAL_RELEASE' in old[name].get('environment',{}):
                c['environment']['PORTAL_RELEASE']=old[name]['environment']['PORTAL_RELEASE']
        require(updated==old,'Wykryto inną zmianę w konfiguracji usług')
        with (backup/'build.log').open('w') as log:
            subprocess.run([*cmd,'build',service],stdout=log,stderr=subprocess.STDOUT,check=True)
        print('ACCESS_BUILD_OK',flush=True)
        require(output('docker','ps','-q','--filter','publish=3302')==active_id,'Zmieniła się aktywna usługa')
        if not migrated:
            sql('begin;\n'+(source/migration).read_text()+"\nnotify pgrst,'reload schema';commit;")
        print('ACCESS_SCHEMA_READY',flush=True)
        switched=True
        subprocess.run([*cmd,'up','-d','--no-deps','--no-build','--wait','--wait-timeout','120',service],check=True)
        with urllib.request.urlopen('https://klient.prohous.pl/api/health',timeout=20) as r:require(r.status==200,'Test dostępności portalu nie powiódł się')
        with urllib.request.urlopen('https://klient.prohous.pl/zaproszenie',timeout=20) as r:
            require(r.status==200,'Strona zaproszeń jest niedostępna')
        from urllib.error import HTTPError
        try:
            probe=urllib.request.Request('https://klient.prohous.pl/api/admin/client-invitations',
                                        b'{}',{'Content-Type':'application/json'})
            with urllib.request.urlopen(probe,timeout=20):pass
        except HTTPError as e:
            require(e.code==401,'Endpoint administracyjny nie zwrócił oczekiwanego kodu')
        else:
            raise RuntimeError('Endpoint administracyjny nie odrzucił żądania bez sesji')
        require(schema_status(),'Nie potwierdzono migracji')
        latest=json.loads(output('docker','inspect',output('docker','ps','-q','--filter','publish=3302')))[0]
        require(latest['Config']['Image']==image and latest['State']['Health']['Status']=='healthy','Nie potwierdzono nowego obrazu')
        print('ACCESS_DEPLOYED',image,flush=True)
    except BaseException:
        for path,prior in reversed(list(saved.items())):
            if prior:shutil.copy2(prior,path)
            else:path.unlink(missing_ok=True)
        if switched:subprocess.run([*cmd,'up','-d','--no-deps','--no-build','--wait','--wait-timeout','120',service],check=True)
        raise

if __name__=='__main__':run()
