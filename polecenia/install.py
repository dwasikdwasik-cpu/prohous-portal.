"""Stage Polecenia on the VPS without publishing an HTTP endpoint."""
import os
import secrets
import subprocess
import urllib.request
from pathlib import Path

target = Path('/opt/prohouse-polecenia')
target.mkdir(mode=0o750, exist_ok=True)
os.chdir(target)
base = 'https://raw.githubusercontent.com/dwasikdwasik-cpu/prohous-portal./d3a5d538fba26e38a5bae9937ae09a879231e8f6/polecenia/'
for name in ('app.py', 'compose.yaml', 'Dockerfile', '.env.example', 'README.md'):
    if not Path(name).exists():
        with urllib.request.urlopen(base + name, timeout=15) as response:
            Path(name).write_bytes(response.read())
config = Path('.env')
if not config.exists():
    import sys
    if len(sys.argv) != 4:
        raise SystemExit('Usage: stage.py ADMIN_LOGIN STAFF_LOGIN EMAIL_DOMAIN')
    domain = sys.argv[3]
    values = {
        'ADMIN_EMAIL': sys.argv[1] + '@' + domain,
        'STAFF_EMAIL': sys.argv[2] + '@' + domain,
        'ADMIN_PASSWORD': secrets.token_urlsafe(30),
        'KAROLINA_PASSWORD': secrets.token_urlsafe(30),
    }
    fd = os.open(config, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    with os.fdopen(fd, 'w') as secret:
        for key, value in values.items():
            secret.write(f'{key}={value}\n')
subprocess.run(['docker', 'compose', 'up', '-d', '--build', 'panel'], check=True)
