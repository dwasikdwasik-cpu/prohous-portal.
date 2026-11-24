"""Check the live routes and keep subsequent releases selectable via PORTAL_RELEASE."""
import json
import os
import re
import shutil
import subprocess
import tempfile
import urllib.error
import urllib.request
from pathlib import Path
from rollout import out,info,must

def check():
    os.umask(0o077)
    active=info(out('docker','ps','-q','--filter','publish=3302'))
    labels=active['Config']['Labels']; service=labels['com.docker.compose.service']
    image=active['Config']['Image'];repo,tag=image.rsplit(':',1)
    must(service=='portal' and tag.startswith('panel-') and active['State']['Health']['Status']=='healthy','Brak aktywnego wydania panelu.')
    def post(path,body,status):
        req=urllib.request.Request('https://klient.prohous.pl'+path,data=json.dumps(body).encode(),headers={'Content-Type':'application/json'})
        try:r=urllib.request.urlopen(req,timeout=15)
        except urllib.error.HTTPError as e:r=e
        with r:must(r.status==status and 'error' in json.load(r),'Nieoczekiwana odpowiedź '+path+' '+str(r.status))
    post('/api/admin/client-invitations',{'action':'list'},401)
    post('/api/client-invitations',{'action':'check','token':'0'*64},410)
    print('PUBLIC_INVITATION_ROUTES_OK',flush=True)
    files=[Path(p) for p in labels['com.docker.compose.project.config_files'].split(',')]
    envs=[Path(p) for p in labels['com.docker.compose.project.environment_file'].split(',') if p]
    cmd=['docker','compose','-p',labels['com.docker.compose.project']]
    for p in envs:cmd+=['--env-file',str(p)]
    for p in files:cmd+=['-f',str(p)]
    def config():return json.loads(out(*cmd,'config','--format','json'))['services']
    old=config();must(old[service]['image']==image,'Konfiguracja obrazu zmieniła się.')
    p=files[-1];src=p.read_text()
    needle='image: '+image
    if needle not in src:return
    must(src.count(needle)==1,'Niejednoznaczna konfiguracja obrazu.')
    envfile=envs[-1];text=envfile.read_text(); regex=r'(?m)^PORTAL_RELEASE=[^\n]*$'
    updated=re.sub(regex,'PORTAL_RELEASE='+tag,text) if re.search(regex,text) else text.rstrip('\n')+'\nPORTAL_RELEASE='+tag+'\n'
    backup=Path(tempfile.mkdtemp(prefix='panel-release-config-',dir='/opt/prohouse/backups'))
    shutil.copy2(p,backup/'compose.yaml');shutil.copy2(envfile,backup/'release.env')
    try:
        p.write_text(src.replace(needle,'image: '+repo+':${PORTAL_RELEASE:?}'))
        envfile.write_text(updated)
        current=config()
        for name,c in current.items():
            if 'PORTAL_RELEASE' in c.get('environment',{}):
                must(c['environment']['PORTAL_RELEASE']==tag,'Niewłaściwe oznaczenie wydania')
                c['environment']['PORTAL_RELEASE']=old[name]['environment']['PORTAL_RELEASE']
        must(old==current,'Niezgodna konfiguracja po aktualizacji oznaczenia wydania')
    except BaseException:
        shutil.copy2(backup/'compose.yaml',p);shutil.copy2(backup/'release.env',envfile)
        raise
    print('RELEASE_SELECTOR_OK',flush=True)
if __name__=='__main__':check()
