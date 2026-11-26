"""Aktualizacja aktywnego panelu klienta ProHouse."""
from pathlib import Path
from urllib.request import urlopen,Request
from urllib.error import HTTPError
import datetime,hashlib,json,os,re,shutil,subprocess,tempfile,time,fcntl
here=Path(__file__).resolve().parent
src=Path('/opt/prohouse-scan-upload')
env=Path('/opt/prohouse/private/scan-upload.env')
container='prohouse-scan-upload-portal-1'
def execute(*args):
    return subprocess.check_output(args,text=True).strip()
def db(statement):
    return subprocess.check_output(['docker','exec','-i','supabase-db','psql','-XAtq','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres'],input=statement,text=True)
def write(file,content):
    file.parent.mkdir(exist_ok=True,parents=True)
    with tempfile.NamedTemporaryFile(dir=file.parent,delete=False) as tmp:tmp.write(content)
    os.chmod(tmp.name,0o600 if file==env else 0o644)
    os.replace(tmp.name,file)
def status(path,method='GET'):
    try:
        with urlopen(Request('http://127.0.0.1:3302'+path,method=method),timeout=4) as res:return res.status
    except HTTPError as e:return e.code
    except OSError:return 0
def patch(source):
    def once(anchor,before,after=''):
        nonlocal source
        if source.count(anchor)!=1:raise ValueError('Sprawdź miejsce integracji: '+anchor)
        source=source.replace(anchor,before+anchor+after)
    once("import {db,configured}","import {DesignerPanel,DesignerAssignments} from './DesignerPanel';\n")
    once("{mode==='register'&&<label>Imię i nazwisko",'''{mode==='register'&&<label>Rodzaj konta<select name="signup_kind" defaultValue="client"><option value="client">Klient</option><option value="designer">Projektant</option></select></label>}''')
    once("full_name:f.get('full_name')",'',",signup_kind:f.get('signup_kind')==='designer'?'designer':'client'")
    once('return <div className="app">',"if(!previewClientId&&profile?.role==='designer') return <DesignerPanel profile={profile}/>;\n ")
    once('<section className="panel"><details><summary>Konta klientów i wykonawców',"{profile?.role==='admin'&&!previewClientId&&<DesignerAssignments/>}")
    source=source.replace("if(profile?.status!=='approved'||invoiceClerk)return","if(profile?.status!=='approved'||profile?.role==='designer'||invoiceClerk)return")
    return source

def main():
    lock=open('/run/lock/prohouse-designer-release','a')
    fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    labels=json.loads(execute('docker','inspect','-f','{{json .Config.Labels}}',container))
    assert labels['com.docker.compose.project']=='prohouse-scan-upload' and labels['com.docker.compose.service']=='portal'
    compose=['docker','compose','-p',labels['com.docker.compose.project'],'--env-file',str(env)]
    for config in labels['com.docker.compose.project.config_files'].split(','):
        assert Path(config).resolve().is_relative_to(src)
        compose+=['-f',config]
    def up():subprocess.run(compose+['up','-d','--no-build','--no-deps','portal'],cwd=src,check=True)
    page=src/'app/page.tsx';component=src/'app/DesignerPanel.jsx';route=src/'app/api/designer-project/route.js'
    initial=page.read_text()
    if "from './DesignerPanel'" in initial:updated=initial
    else:updated=patch(initial)
    targets={page:updated.encode(),component:(here/'DesignerPanel.jsx').read_bytes(),route:(here/'route.js').read_bytes()}
    # Merge these changes into newer portal releases without replacing intervening edits.
    if "from './DesignerPanel'" in initial:
        for path, name in ((component,'DesignerPanel.jsx'),(route,'route.js')):
            content=path.read_bytes()
            if content==targets[path]:continue
            with tempfile.TemporaryDirectory() as tmp:
                dest=Path(tmp)/path.relative_to(src)
                dest.parent.mkdir(parents=True,exist_ok=True)
                dest.write_bytes(content)
                patchfile=here/'folders'/(name+'.patch')
                args=['git','apply','--ignore-space-change',str(patchfile)]
                if subprocess.run(args+['--check'],cwd=tmp,capture_output=True).returncode==0:
                    subprocess.run(args,cwd=tmp,check=True)
                elif subprocess.run(args+['--reverse','--check'],cwd=tmp,capture_output=True).returncode:
                    raise ValueError('Różnica w aktualnym pliku '+name+' wymaga scalenia.')
                targets[path]=dest.read_bytes()
    targets[src/'app/ProjectFolders.jsx']=(here/'folders/ProjectFolders.jsx').read_bytes()
    migration=(here/'folders/folders.sql').read_text()
    if db("select to_regprocedure('public.designer_workspace()') is null").strip()=='t':
        raise ValueError('Wymagany zainstalowany podstawowy moduł projektanta.')
    release='designer-'+hashlib.sha256(b''.join(targets.values())+migration.encode()).hexdigest()[:12]
    new_env,count=re.subn(rb'^PORTAL_RELEASE=.*$',b'PORTAL_RELEASE='+release.encode(),env.read_bytes(),flags=re.M)
    if count!=1:raise ValueError('Nie rozpoznano wersji wdrożenia.')
    targets[env]=new_env
    prior={path:(path.read_bytes() if path.is_file() else None) for path in targets}
    backup=Path('/opt/prohouse/backups')/datetime.datetime.now(datetime.timezone.utc).strftime('designer-%Y%m%d-%H%M%S-%f')
    backup.mkdir(parents=True,mode=0o700)
    for path,content in prior.items():
        if content is not None:shutil.copy2(path,backup/path.name)
    db("begin;"+migration+"\nrollback;")
    try:
        for path,content in targets.items():write(path,content)
        subprocess.run(compose+['build','portal'],check=True,cwd=src)
        db("begin;"+migration+"\nnotify pgrst,'reload schema';commit;")
        up()
        for attempt in range(60):
            if status('/')==200 and status('/api/designer-project','POST')==401 and status('/api/employee-investments')==401:break
            time.sleep(1)
        else:raise RuntimeError('Kontrola działania portalu nie powiodła się.')
    except BaseException:
        for path,content in prior.items():
            if content is None:path.unlink(missing_ok=True)
            else:write(path,content)
        up()
        raise
    print('PORTAL READY '+release,flush=True)
if __name__=='__main__':main()
