"""Publish the ProHouse visual theme to the employee portal static frontend."""
import datetime
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import time

HERE = Path(__file__).resolve().parent
WEBROOT = Path("/opt/prohouse-employee/public")
HOST = "praca.prohous.pl"
FILES = ("index.html", "sw.js")
THEME_LINK = r'<link\b[^>]*\bdata-prohouse-work="theme"[^>]*>'
ASSET_PATH = re.compile(r"^/assets/prohouse-praca-[0-9a-f]{12}/(?:praca\.css|praca-wnetrze\.webp)$")


def theme_files():
    css = (HERE / "praca.css").read_bytes()
    image_path = HERE / "praca-wnetrze.webp"
    if not image_path.exists():
        image_path = HERE.parent / "hero.webp"
    image = image_path.read_bytes()
    if image[:4] != b"RIFF" or image[8:12] != b"WEBP" or len(image) < 10000:
        raise ValueError("Invalid portal photograph.")
    release = hashlib.sha256(css + image).hexdigest()[:12]
    folder = f"/assets/prohouse-praca-{release}/"
    return release, {folder+"praca.css": css, folder+"praca-wnetrze.webp": image}


def patch_sources(html, worker, release, paths):
    if ('id="root"' not in html or 'praco' not in html.lower() or '/assets/' not in html or
            html.lower().count('</head>') != 1):
        raise ValueError("Unrecognized employee portal HTML.")
    if len(re.findall(THEME_LINK, html)) > 1:
        raise ValueError("Unexpected duplicate theme links.")
    html = re.sub(THEME_LINK + r'\n?', '', html)
    style = next(p for p in paths if p.endswith(".css"))
    html = html.replace("</head>", f'<link rel="stylesheet" data-prohouse-work="theme" href="{style}">\n</head>')
    cache_pattern = r"(\bconst\s+CACHE\s*=\s*)(['\"])(prohouse-shell-[^'\"]+)\2"
    cache = re.search(cache_pattern, worker)
    static = re.search(r"(\bconst\s+STATIC\s*=\s*)(\[[^\]]*\])", worker)
    if not cache or not static:
        raise ValueError("Unrecognized portal service worker.")
    previous = json.loads(static[2])
    if not isinstance(previous,list) or '/index.html' not in previous:
        raise ValueError("Unrecognized offline asset list.")
    static_urls = [path for path in previous if not ASSET_PATH.fullmatch(path)] + list(paths)
    worker = worker[:static.start(2)] + json.dumps(static_urls, ensure_ascii=False, separators=(',',':')) + worker[static.end(2):]
    def version(match):
        cache_name = re.sub(r'-wyglad-[0-9a-f]{12}$', '', match[3])
        return f'{match[1]}{match[2]}{cache_name}-wyglad-{release}{match[2]}'
    return html, re.sub(cache_pattern, version, worker, count=1)


def atomic_replace(path, value):
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as output:
        temp = Path(output.name)
    try:
        temp.write_bytes(value)
        stat = path.stat()
        os.chown(temp, stat.st_uid, stat.st_gid)
        temp.chmod(stat.st_mode & 0o7777)
        temp.replace(path)
    finally:
        temp.unlink(missing_ok=True)


def fetch(path):
    return subprocess.check_output([
        'curl', '--noproxy', '*', '--resolve', f'{HOST}:443:127.0.0.1',
        '-fsS', '--max-time', '10', 'https://'+HOST+path
    ])


def install_assets(root, files):
    dst = root / next(iter(files)).lstrip('/')
    asset_dir = dst.parent
    names = {Path(path).name:data for path,data in files.items()}
    if asset_dir.exists():
        if any((asset_dir/n).read_bytes() != data for n,data in names.items()):
            raise ValueError("A different asset already exists in this version.")
        return
    with tempfile.TemporaryDirectory(dir=asset_dir.parent) as working:
        stage = Path(working)
        for name,data in names.items():
            (stage/name).write_bytes(data)
            (stage/name).chmod(0o644)
        stage.chmod(0o755)
        stage.rename(asset_dir)


def deploy():
    release, assets = theme_files()
    original = {name:(WEBROOT/name).read_bytes() for name in FILES}
    if fetch('/sw.js')!=original['sw.js'] or fetch('/').strip()!=original['index.html'].strip():
        raise ValueError("Production entry points differ from the selected directory.")
    html, worker = patch_sources(*(original[n].decode() for n in FILES), release, assets)
    updated = {'index.html':html.encode(), 'sw.js':worker.encode()}
    install_assets(WEBROOT, assets)
    if any(fetch(path) != data for path,data in assets.items()):
        raise ValueError("Theme assets are not served by the employee domain.")
    if original == updated:
        print("VERIFIED", HOST, release)
        return
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    backup = Path('/opt/prohouse/backups') / ('employee-appearance-'+stamp)
    backup.mkdir(mode=0o700, parents=True)
    for name in FILES:
        shutil.copy2(WEBROOT/name,backup/name)
    if any((WEBROOT/n).read_bytes()!=original[n] for n in FILES):
        raise RuntimeError("Deployment files changed during preparation.")
    changed=[]
    try:
        for name in FILES:
            atomic_replace(WEBROOT/name,updated[name])
            changed.append(name)
        for _ in range(4):
            if fetch('/').strip()==updated['index.html'].strip() and fetch('/sw.js')==updated['sw.js']:
                print("VERIFIED", HOST, release, "BACKUP", backup)
                return
            time.sleep(.5)
        raise RuntimeError("Public landing page or offline shell did not update.")
    except BaseException:
        for name in reversed(changed):
            if (WEBROOT/name).read_bytes()==updated[name]:
                atomic_replace(WEBROOT/name,original[name])
        raise


if __name__ == '__main__':
    with open('/run/lock/prohouse-employee-appearance.lock','a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX)
        deploy()
