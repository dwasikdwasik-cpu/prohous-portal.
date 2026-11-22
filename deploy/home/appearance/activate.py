"""Install the client portal's branded frontend on its existing Nginx virtual host."""
from pathlib import Path
import argparse
import datetime
import fcntl
import hashlib
import os
import re
import shutil
import subprocess
import tempfile
import time
import urllib.request

RELEASE = "20261122"
PREFIX = "/prohouse-wyglad/" + RELEASE + "/"
ASSETS = ("theme.css", "theme.js", "hero.webp")
ORIGIN_IMAGE = "https://www.prohous.pl/assets/hero-salon-kuchnia-20261108.webp"
MARK = "prohouse-appearance-" + RELEASE

def atomic_replace(path, value):
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as out:
        tmp = Path(out.name)
        try:
            out.write(value)
            out.flush()
            os.fsync(out.fileno())
            shutil.copystat(path, tmp)
            st = path.stat()
            os.chown(tmp, st.st_uid, st.st_gid)
            tmp.replace(path)
        finally:
            tmp.unlink(missing_ok=True)

def patch_config(original, host, asset_dir):
    # This deployment only touches the existing plain reverse-proxy root location.
    expression = r"\blocation\s+/\s*\{\s*proxy_pass\s+(https?://[^;{}\s]+);\s*\}"
    matches = list(re.finditer(expression, original))
    if len(matches) != 1:
        raise ValueError("Expected a single plain reverse-proxy root location. No changes made.")
    match = matches[0]
    server_start = original.rfind("server {", 0, match.start())
    if server_start < 0:
        raise ValueError("Could not resolve virtual host.")
    before = original[server_start + len("server {"):match.start()]
    # Drop sibling location blocks to copy only inherited, server-scope headers.
    while re.search(r"\{[^{}]*\}", before):
        before = re.sub(r"\blocation\s+[^{}]*\{[^{}]*\}", "", before)
        if "{" in before or "}" in before:
            raise ValueError("Unexpected nested host configuration.")
    if not re.search(r"\bserver_name\s+" + re.escape(host) + r"\s*;", before):
        raise ValueError("Selected configuration does not serve the specified host.")
    headers = re.findall(r"\bproxy_set_header\s+[^;{}]+;", before)
    if not any(re.match(r"proxy_set_header\s+Host\s", h,re.I) for h in headers):
        raise ValueError("Could not confirm inherited Host header.")
    if any(re.match(r"proxy_set_header\s+Accept-Encoding\s", h,re.I) for h in headers):
        raise ValueError("Existing encoding policy needs review.")
    types = ("text/css", "application/javascript", "image/webp")
    static = [f"location = {PREFIX}{name} {{ alias {asset_dir}/{name}; default_type {mime}; }}" for name,mime in zip(ASSETS,types)]
    tags = f'<link rel="stylesheet" href="{PREFIX}theme.css"><script defer src="{PREFIX}theme.js"></script>'
    replacement = '\n# ' + MARK + '\n' + '\n'.join(static) + '\nlocation / {\n'
    replacement += '\n'.join(headers) + '\nproxy_set_header Accept-Encoding "";\n'
    replacement += f"sub_filter_once on;\nsub_filter '</head>' '{tags}</head>';\nproxy_pass {match.group(1)};\n}}\n"
    return original[:match.start()] + replacement + original[match.end():]

def stylesheet_url(asset_dir):
    revision = hashlib.sha256((asset_dir / "theme.css").read_bytes()).hexdigest()[:16]
    return f"{PREFIX}theme.css?v={revision}"

def revalidate_document(configuration, asset_dir):
    href = r'href="' + re.escape(PREFIX) + r'theme\.css(?:\?v=[0-9a-f]+)?"'
    configuration, count = re.subn(href, f'href="{stylesheet_url(asset_dir)}"', configuration)
    if count == 0:
        raise ValueError("Missing portal stylesheet.")
    # HTML needs a fresh response even when a visitor presents the old app ETag.
    marker = "# prohouse-document-revalidation"
    if marker in configuration:
        return configuration
    pos = configuration.index("# " + MARK)
    match = re.search(r"location / \{([^{}]*)\}", configuration[pos:])
    if not match or "sub_filter_once on;" not in match.group(1):
        raise ValueError("Expected branded portal proxy location.")
    location = match.group(1)
    policy = ('\nproxy_set_header If-None-Match "";\nproxy_set_header If-Modified-Since "";'
              '\nproxy_hide_header ETag;\nproxy_hide_header Last-Modified;'
              '\nproxy_hide_header Cache-Control;\nif_modified_since off;\nexpires -1;\n')
    next_location = marker + "\nlocation = / {" + policy + location + "}\n"
    offset = pos + match.start()
    return configuration[:offset] + next_location + configuration[offset:]

def activate_configuration(config, original, updated, host, dest):
    backups=Path("/var/backups/prohouse-appearance")
    backups.mkdir(mode=0o700,parents=True,exist_ok=True)
    stamp=datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    backup=backups/(config.name+"-"+stamp)
    shutil.copy2(config,backup)
    if config.read_bytes()!=original:
        raise RuntimeError("Configuration changed during installation.")
    atomic_replace(config,updated)
    try:
        subprocess.run(["nginx","-t"],check=True)
        subprocess.run(["systemctl","reload","nginx"],check=True)
        check_live(host,dest)
    except BaseException:
        if config.read_bytes()==updated:
            atomic_replace(config,original)
            subprocess.run(["nginx","-t"],check=True)
            subprocess.run(["systemctl","reload","nginx"],check=True)
        raise
    print("VERIFIED",RELEASE,"BACKUP",backup)

def check_live(host, asset_dir):
    def fetch(path):
        return subprocess.check_output(["curl","--noproxy","*","--resolve",f"{host}:443:127.0.0.1","--max-time","8","-fsS","https://"+host+path],stderr=subprocess.DEVNULL)
    for _ in range(10):
        try:
            html=fetch("/").decode()
            if html.count(stylesheet_url(asset_dir)) != 1 or html.count(PREFIX+"theme.js") != 1:
                raise ValueError("Theme markers missing")
            for name in ASSETS:
                if hashlib.sha256(fetch(PREFIX+name)).digest() != hashlib.sha256((asset_dir/name).read_bytes()).digest():
                    raise ValueError("Unexpected asset " + name)
            return
        except (OSError,ValueError,subprocess.CalledProcessError):
            time.sleep(.6)
    raise RuntimeError("Could not verify the updated HTML and brand assets.")

def main():
    args=argparse.ArgumentParser()
    args.add_argument("configuration",type=Path)
    args.add_argument("hostname")
    opts=args.parse_args()
    config=opts.configuration.resolve(strict=True)
    if not config.is_file() or not re.fullmatch(r"[a-z0-9.-]+",opts.hostname):
        raise ValueError("Invalid configuration or hostname.")
    src=Path(__file__).resolve().parent
    with open("/run/lock/prohouse-appearance.lock","a") as lock:
        fcntl.flock(lock,fcntl.LOCK_EX)
        old=config.read_bytes()
        dest=Path("/var/www/prohouse-wyglad")/RELEASE
        if MARK in old.decode():
            updated=revalidate_document(old.decode(),dest).encode()
            if updated!=old:
                activate_configuration(config,old,updated,opts.hostname,dest)
            else:
                check_live(opts.hostname,dest)
                print("VERIFIED", RELEASE)
            return
        new=revalidate_document(patch_config(old.decode(),opts.hostname,dest),src).encode()
        subprocess.run(["nginx","-t"],check=True)
        dest.parent.mkdir(mode=0o755,parents=True,exist_ok=True)
        with tempfile.TemporaryDirectory(dir=dest.parent) as tmp:
            stage=Path(tmp)
            for name in ASSETS[:2]:
                shutil.copyfile(src/name,stage/name)
            if (src/"hero.webp").is_file():
                shutil.copyfile(src/"hero.webp",stage/"hero.webp")
            else:
                with urllib.request.urlopen(ORIGIN_IMAGE,timeout=30) as req:
                    (stage/"hero.webp").write_bytes(req.read(5000000))
            image=(stage/"hero.webp").read_bytes()
            if image[:4]!=b'RIFF' or image[8:12]!=b'WEBP' or len(image)<10000 or len(image)!=int.from_bytes(image[4:8],"little")+8:
                raise ValueError("Invalid hero image.")
            for p in stage.iterdir(): p.chmod(0o644)
            if dest.exists():
                if not all((dest/n).is_file() and (dest/n).read_bytes()==(stage/n).read_bytes() for n in ASSETS):
                    raise ValueError("Different files already exist for this release.")
            else:
                stage.chmod(0o755)
                os.rename(stage,dest)
        activate_configuration(config,old,new,opts.hostname,dest)

if __name__=="__main__":
    main()
