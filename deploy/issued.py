"""Publish the issued-invoice module to the existing klient.prohous.pl Compose service."""
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
migration='supabase/migrations/20261124215000_prohouse_issued_invoices.sql'
feature_files=['app/IssuedInvoices.tsx','app/IssuedInvoices.module.css',migration]

def output(*args):
    return subprocess.check_output(args,text=True).strip()

def require(value,message):
    if not value:
        raise RuntimeError(message)

def integrate_original(page):
    dashboard='{client&&selected&&<IssuedInvoices key={selected} investmentId={selected} investmentName={inv?.name||\'\'} previewClient={previewClientId}/>}'
    management="{financeAdmin&&selected&&<IssuedInvoices key={selected} investmentId={selected} investmentName={inv?.name||''} manage/>}"
    imports="import IssuedInvoices from './IssuedInvoices';\n"
    if imports in page:
        require((dashboard in page or "{tab==='overview'&&"+dashboard[1:] in page) and management in page,'Niepełna integracja modułu w portalu')
        return page
    for anchor,insert in [('import ClientInvitations',imports),("{tab==='admin'&&admin&&<>",None)]:
        require(page.count(anchor)==1,'Nie znaleziono miejsca w aktualnym panelu: '+anchor)
        page=page.replace(anchor,(insert+anchor) if insert else anchor+management)
    navigation=[("overview:'Pulpit',","overview:'Pulpit',issued:'Wystawione faktury za Prohouse',"),
                ("Object.entries(labels).filter(([k])=>","Object.entries(labels).filter(([k])=>k==='issued'?financeAdmin:"),
                ("{tab==='logins'&&admin&&<LoginHistory/>}", "{tab==='issued'&&financeAdmin&&selected&&<IssuedInvoices key={selected} investmentId={selected} investmentName={inv?.name||''} manage/>}\n {tab==='logins'&&admin&&<LoginHistory/>}")]
    for needle,replacement in navigation:
        require(page.count(needle)==1,'Nie znaleziono pozycji w nawigacji: '+needle)
        page=page.replace(needle,replacement)
    anchor='<div className="two-col"><section className="panel"><div className="section-head"><h2>Ostatnie dokumenty'
    if page.count(anchor)==1:
        return page.replace(anchor,dashboard+anchor)
    anchor="{tab==='zdjecia'&&!employee&&"
    require(page.count(anchor)==1,'Nie znaleziono sekcji pulpitu klienta')
    return page.replace(anchor,"{tab==='overview'&&"+dashboard[1:]+'\n '+anchor)


def integrate(page):
    visible_section = """{(tab==='overview'||tab==='issued')&&(client||financeAdmin)&&selected&&<IssuedInvoices key={selected} investmentId={selected} investmentName={inv?.name||''} manage={financeAdmin} previewClient={previewClientId}/>}"""
    if visible_section in page:
        return page
    page=integrate_original(page)
    previous = "{client&&selected&&<IssuedInvoices key={selected} investmentId={selected} investmentName={inv?.name||''} previewClient={previewClientId}/>}"
    fallback = "{tab==='overview'&&"+previous[1:]
    needle=fallback if fallback in page else previous
    def once(old,new):
        nonlocal page
        require(page.count(old)==1,'Nie można dopasować widoku faktur w aktywnym panelu: '+old[:70])
        page=page.replace(old,new,1)
    once(needle,'')
    once("{tab==='issued'&&financeAdmin&&selected&&<IssuedInvoices key={selected} investmentId={selected} investmentName={inv?.name||''} manage/>}", visible_section)
    once("k==='issued'?financeAdmin:", "k==='issued'?(financeAdmin||client):")
    once("const labels:Record<string,string>=", "const portalLabels:Record<string,string>=")
    once(" const [availableBalance,setAvailableBalance]", """ const labels:Record<string,string>={...portalLabels,issued:client?'Faktury od ProHouse':portalLabels.issued};
 useEffect(()=>{
  if(profile?.status==='approved'&&(financeAdmin||client)&&new URLSearchParams(window.location.search).get('widok')==='faktury-prohouse')setTab('issued');
 },[profile?.id,profile?.status,financeAdmin,client]);
 const [availableBalance,setAvailableBalance]""")
    return page

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
    release='issued-'+output('git','-C',source,'log','-1','--format=%h','--',*feature_files,'app/page.tsx')
    image=old_image.rsplit(':',1)[0]+':'+release
    expected_sql=sql("select to_regprocedure('private.has_client_panel(uuid,uuid)') is not null, to_regprocedure('public.prohouse_invoice_history(uuid,uuid)') is not null;")
    require(expected_sql in ('t|f','t|t'),'Brak obsługi przypisanych klientów')
    page=root/'app/page.tsx'
    changes={page:integrate(page.read_text()).encode()}
    for name in feature_files:
        dest=root/name
        content=(source/name).read_bytes()
        require(not dest.exists() or dest.read_bytes()==content,'Istnieje inna wersja '+name)
        changes[dest]=content
    if expected_sql=='t|t':
        require((root/migration).exists() and (root/migration).read_bytes()==changes[root/migration],'Sprawdź wersję istniejącej migracji')
    if old_image==image and expected_sql=='t|t':
        require(all(p.exists() and p.read_bytes()==v for p,v in changes.items()),'Rozbieżność wydania')
        print('ISSUED_ALREADY_DEPLOYED',image,flush=True);return
    env=envs[-1]
    existing=env.read_text()
    pattern=r'(?m)^PORTAL_RELEASE=[^\n]*$'
    require(len(re.findall(pattern,existing))==1,'Brak selektora aktywnej wersji panelu')
    changes[env]=re.sub(pattern,'PORTAL_RELEASE='+release,existing).encode()
    backup=Path(tempfile.mkdtemp(prefix='issued-invoices-',dir='/opt/prohouse/backups'))
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
        print('ISSUED_BUILD_OK',flush=True)
        require(output('docker','ps','-q','--filter','publish=3302')==active_id,'Zmieniła się aktywna usługa')
        if expected_sql=='t|f':
            sql('begin;\n'+(source/migration).read_text()+"\nnotify pgrst,'reload schema';commit;")
        print('ISSUED_SCHEMA_READY',flush=True)
        switched=True
        subprocess.run([*cmd,'up','-d','--no-deps','--no-build','--wait','--wait-timeout','120',service],check=True)
        with urllib.request.urlopen('https://klient.prohous.pl/api/health',timeout=20) as r:require(r.status==200,'Test dostępności portalu nie powiódł się')
        latest=json.loads(output('docker','inspect',output('docker','ps','-q','--filter','publish=3302')))[0]
        require(latest['Config']['Image']==image and latest['State']['Health']['Status']=='healthy','Nie potwierdzono nowego obrazu')
        print('ISSUED_DEPLOYED',image,flush=True)
    except BaseException:
        for path,prior in reversed(list(saved.items())):
            if prior:shutil.copy2(prior,path)
            else:path.unlink(missing_ok=True)
        if switched:subprocess.run([*cmd,'up','-d','--no-deps','--no-build','--wait','--wait-timeout','120',service],check=True)
        raise

if __name__=='__main__':run()
