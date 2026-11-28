"""Configure the dedicated HTTPS virtual host for Polecenia."""
from pathlib import Path
import subprocess

domain = 'polecenia.prohous.pl'
address = '87.106.147.249'
root = Path('/var/www/polecenia-acme')
site = Path('/etc/nginx/sites-enabled/prohouse-polecenia')
marker = '# Managed by Polecenia deployment\n'
http = f"""
server {{
    listen 80;
    server_name {domain};
    location /.well-known/acme-challenge/ {{ root {root}; }}
    location / {{ return 308 https://$host$request_uri; }}
}}
"""
cert = Path('/etc/letsencrypt/live') / domain
https = f"""
limit_req_zone $binary_remote_addr zone=polecenia_login:10m rate=30r/m;
server {{
    listen 443 ssl;
    server_name {domain};
    ssl_certificate {cert}/fullchain.pem;
    ssl_certificate_key {cert}/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    client_max_body_size 64k;
    location / {{
        limit_req zone=polecenia_login burst=20 nodelay;
        limit_req_status 429;
        proxy_pass http://127.0.0.1:18754;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto https;
    }}
}}
"""

def run(*args):
    subprocess.run(args, check=True)

def apply(config):
    old = site.read_text() if site.exists() else None
    if old is not None and not old.startswith(marker):
        raise SystemExit('Refusing to overwrite an existing virtual host.')
    if old == marker + config:
        return
    site.write_text(marker + config)
    try:
        run('nginx', '-t')
        run('systemctl', 'reload', 'nginx')
    except subprocess.CalledProcessError:
        if old is None:
            site.unlink()
        else:
            site.write_text(old)
        raise

authoritative = subprocess.check_output(
    ['dig', '+short', '@dns.home.pl', domain, 'A'], text=True
)
if address not in authoritative.splitlines():
    raise SystemExit('DNS has not switched to the VPS yet.')
root.mkdir(parents=True, exist_ok=True)
if not (cert / 'fullchain.pem').exists():
    apply(http)
    run('certbot', 'certonly', '--webroot', '-w', str(root), '-d', domain, '--non-interactive')
apply(http + https)
run('curl', '--fail', '--silent', '--show-error', '--output', '/dev/null',
    '--resolve', f'{domain}:443:{address}', '--write-out', 'HTTPS %{http_code}\\n', f'https://{domain}/')
