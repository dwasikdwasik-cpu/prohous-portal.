"""Install the ProHouse orders theme on the existing production HTML."""
import datetime
import fcntl
import hashlib
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile

HERE = Path(__file__).resolve().parent
PUBLIC = Path("/opt/prohouse-orders/public")
HOST = "www.zamowieniapro.pl"
LINK = re.compile(r'<link\s+rel="stylesheet"\s+data-prohouse-orders="theme"\s+href="[^"]+">\n?')


def theme_files():
    css = (HERE / "orders.css").read_bytes()
    photo = (HERE.parent / "hero.webp").read_bytes()
    if photo[:4] != b"RIFF" or photo[8:12] != b"WEBP":
        raise ValueError("Invalid portal photograph")
    version = hashlib.sha256(css + photo).hexdigest()[:12]
    return "prohouse-zamowienia-" + version, {"orders.css": css, "wnetrze.webp": photo}


def patch_html(html, folder):
    expected = ('id="app"', 'src="/app.js', 'href="/style.css', "Zamówienia materiałów")
    if not all(marker in html for marker in expected) or html.count("</head>") != 1:
        raise ValueError("Unrecognized orders application")
    cleaned = LINK.sub("", html)
    if 'data-prohouse-orders' in cleaned:
        raise ValueError("Unexpected orders theme link")
    link = f'<link rel="stylesheet" data-prohouse-orders="theme" href="/{folder}/orders.css">\n'
    return cleaned.replace("</head>", link + "</head>")


def stage_assets(root, folder, files):
    target = root / folder
    if target.exists():
        if any((target / name).read_bytes() != data for name, data in files.items()):
            raise ValueError("Existing versioned assets have different content")
        return
    with tempfile.TemporaryDirectory(dir=root) as work:
        stage = Path(work)
        for name, data in files.items():
            path = stage / name
            path.write_bytes(data)
            path.chmod(0o644)
        stage.chmod(0o755)
        stage.rename(target)


def replace(path, data):
    stat = path.stat()
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as output:
        temp = Path(output.name)
        try:
            output.write(data)
            output.flush()
            os.fchown(output.fileno(), stat.st_uid, stat.st_gid)
            os.fchmod(output.fileno(), stat.st_mode & 0o7777)
            os.fsync(output.fileno())
            temp.replace(path)
        finally:
            temp.unlink(missing_ok=True)


def fetch(path):
    return subprocess.check_output([
        "curl", "--noproxy", "*", "--resolve", f"{HOST}:443:127.0.0.1",
        "-fsS", "--max-time", "12", f"https://{HOST}{path}"
    ])


def deploy():
    index = PUBLIC / "index.html"
    original = index.read_bytes()
    if fetch("/").strip() != original.strip():
        raise ValueError("The live orders domain serves a different entry file")
    folder, files = theme_files()
    updated = patch_html(original.decode(), folder).encode()
    stage_assets(PUBLIC, folder, files)
    for name, content in files.items():
        if fetch(f"/{folder}/{name}") != content:
            raise ValueError(f"The orders domain did not serve {name} correctly")
    if original == updated:
        print("VERIFIED", HOST, folder)
        return
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    backup = Path("/opt/prohouse/backups") / ("orders-appearance-" + stamp)
    backup.mkdir(mode=0o700, parents=True)
    shutil.copy2(index, backup / "index.html")
    if index.read_bytes() != original or (backup / "index.html").read_bytes() != original:
        raise RuntimeError("The entry file changed while preparing the release")
    replace(index, updated)
    try:
        if fetch("/").strip() != updated.strip():
            raise RuntimeError("Production did not return the updated HTML")
    except BaseException:
        if index.read_bytes() == updated:
            replace(index, original)
        raise
    print("VERIFIED", HOST, folder, "BACKUP", backup)


if __name__ == "__main__":
    with open("/run/lock/prohouse-orders-appearance.lock", "a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        deploy()
