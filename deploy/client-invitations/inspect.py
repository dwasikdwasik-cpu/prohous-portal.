import json
import re
import subprocess
from pathlib import Path

def out(*args):
    return subprocess.check_output(args,text=True).strip()

def container(name):
    return json.loads(out('docker','inspect',name))[0]

def env_for(info):
    return dict(x.split('=',1) for x in info['Config']['Env'])

if __name__=='__main__':
    info=container(out('docker','ps','-q','--filter','publish=3302'))
    labels=info['Config']['Labels']
    print('APP',info['Name'],info['Config']['Image'])
    for k in ['working_dir','config_files','environment_file']:
        print(k, labels.get('com.docker.compose.project.'+k,''))
    for name in [info['Id'],'supabase-auth','supabase-envoy','supabase-db']:
        c=container(name)
        env=env_for(c)
        print(c['Name'],','.join(c['NetworkSettings']['Networks']),','.join(k for k,v in env.items() if v and re.search('SMTP|SERVICE_ROLE|SUPABASE_URL|ANON_KEY',k)))
    src=Path('/opt/prohouse-scan-upload')
    for p in (src/'app/page.tsx',src/'app/api/document/[id]/route.ts',src/'lib/client-preview.mjs'):
        print('file',p,p.exists())
        if p.exists() and p.name=='page.tsx':
            s=p.read_text()
            for needle in ['<summary>Kosz (', 'async function permanentlyRemove(', "tab==='admin'&&admin&&<>",'import AccountSettings','async function api(']:
                i=s.find(needle); print('anchor',i,s[i:i+140] if i>=0 else '')
    auth=env_for(container('supabase-auth'))
    print('SMTP', 'configured' if auth.get('GOTRUE_SMTP_HOST') else 'absent','port',auth.get('GOTRUE_SMTP_PORT','?'))
