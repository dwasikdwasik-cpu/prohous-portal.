"""Apply the mail frontend theme to the installed application and active panel image."""
import datetime
import fcntl
import hashlib
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import time

HERE = Path(__file__).resolve().parent
PROJECT = Path("/opt/prohouse-poczta")
HOST = "panel.prohous.pl"
LINK = re.compile(r'<link rel="stylesheet" data-prohouse-mail="theme" href="[^"]+">\n?')


def run(*cmd, cwd=PROJECT):
    return subprocess.check_output(cmd, cwd=cwd)


def fetch(path):
    return run("curl", "--noproxy", "*", "--resolve", f"{HOST}:443:127.0.0.1",
               "--max-time", "8", "-fsS", "-H", "Cache-Control: no-cache", f"https://{HOST}{path}")


def patch_html(content, prefix):
    html = content.decode()
    expected = ['id="login-form"', 'id="mail-view"', 'src="/app.js', 'href="/style.css', 'Poczta firmowa']
    if not all(marker in html for marker in expected) or html.count("</head>") != 1:
        raise ValueError("Unrecognized mail shell")
    cleaned = LINK.sub("", html)
    if "data-prohouse-mail" in cleaned:
        raise ValueError("Unrecognized theme link")
    tag = f'<link rel="stylesheet" data-prohouse-mail="theme" href="/{prefix}/mail.css">\n'
    return cleaned.replace("</head>", tag + "</head>").encode()


def stage_assets(root, folder, files):
    target = root / folder
    if target.exists():
        if any((target / name).read_bytes() != data for name, data in files.items()):
            raise RuntimeError("Versioned asset mismatch")
        return
    with tempfile.TemporaryDirectory(dir=root) as tmp:
        stage = Path(tmp)
        for name, data in files.items():
            path = stage / name
            path.write_bytes(data)
            path.chmod(0o644)
        stage.chmod(0o755)
        stage.rename(target)


def replace(path, data):
    stat = path.stat()
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as f:
        temp = Path(f.name)
        try:
            f.write(data)
            f.flush()
            os.fchown(f.fileno(), stat.st_uid, stat.st_gid)
            os.fchmod(f.fileno(), stat.st_mode & 0o7777)
            os.fsync(f.fileno())
            temp.replace(path)
        finally:
            temp.unlink(missing_ok=True)


def live_matches(page, folder, assets):
    try:
        return (fetch("/").strip() == page.strip()
                and all(fetch(f"/{folder}/{name}") == data for name, data in assets.items()))
    except subprocess.CalledProcessError:
        return False


def wait_live(page, folder, assets):
    for attempt in range(25):
        if live_matches(page, folder, assets):
            return
        if attempt < 24:
            time.sleep(1)
    raise RuntimeError("Published mail HTML or assets failed verification")


def swap_panel():
    run("docker", "compose", "up", "-d", "--no-deps", "--no-build", "--pull", "never", "panel")


def inspect_panel(container, template):
    return run("docker", "inspect", "--format", template, container).decode().strip()


def deploy():
    css = (HERE / "mail.css").read_bytes()
    photo = (HERE.parent / "hero.webp").read_bytes()
    if photo[:4] != b"RIFF" or photo[8:12] != b"WEBP":
        raise ValueError("Invalid interior photo")
    version = hashlib.sha256(css + photo).hexdigest()[:12]
    folder = "prohouse-poczta-" + version
    assets = {"mail.css": css, "wnetrze.webp": photo}
    index = PROJECT / "public" / "index.html"
    old_source = index.read_bytes()
    old_live = fetch("/")
    new_source, new_live = [patch_html(page, folder) for page in (old_source, old_live)]
    if old_source == new_source and live_matches(new_live, folder, assets):
        print("VERIFIED", HOST, version)
        return
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    backup = Path("/opt/prohouse/backups") / ("mail-appearance-" + stamp)
    backup.mkdir(mode=0o700, parents=True)
    shutil.copy2(index, backup / "index-source.html")
    (backup / "index-live.html").write_bytes(old_live)
    container = run("docker", "compose", "ps", "-q", "panel").decode().strip()
    if not container or "\n" in container:
        raise RuntimeError("Active mail panel container not identified")
    with tempfile.TemporaryDirectory() as temp:
        work = Path(temp)
        active = work / "index.html"
        run("docker", "cp", f"{container}:/app/public/index.html", str(active))
        if active.read_bytes().strip() != old_live.strip():
            raise RuntimeError("The live domain serves another entry file")
        stage_assets(index.parent, folder, assets)
        mounts = inspect_panel(container, '{{range .Mounts}}{{println .Destination}}{{end}}').splitlines()
        mounted = any(m in ("/app", "/app/public", "/app/public/index.html") for m in mounts)
        old_image = inspect_panel(container, "{{.Image}}")
        image_tag = inspect_panel(container, "{{.Config.Image}}")
        build_tag = "prohouse-mail-theme:" + version
        if mounted:
            if old_source.strip() != old_live.strip():
                raise RuntimeError("The public directory mount differs from the source")
            if not all(fetch(f"/{folder}/{name}") == data for name, data in assets.items()):
                raise RuntimeError("Source assets are not served from the selected mount")
        else:
            if not re.fullmatch(r"[a-z0-9][a-z0-9._/:\-]*", image_tag) or image_tag.startswith("sha256:"):
                raise RuntimeError("Unsupported panel image tag")
            base_tag = "prohouse-mail-before-theme:" + old_image.removeprefix("sha256:")[:16]
            run("docker", "tag", old_image, base_tag)
            (backup / "image.txt").write_text(f"{old_image}\n{image_tag}\n{base_tag}\n")
            active.write_bytes(new_live)
            active.chmod(0o644)
            stage_assets(work, folder, assets)
            (work / "Dockerfile").write_text(f"FROM {base_tag}\nCOPY index.html /app/public/index.html\nCOPY {folder}/ /app/public/{folder}/\n")
            run("docker", "build", "--network=none", "--pull=false", "-t", build_tag, ".", cwd=work)
        if index.read_bytes() != old_source or run("docker", "compose", "ps", "-q", "panel").decode().strip() != container:
            raise RuntimeError("Mail deployment changed while preparing theme")
        image_swapped = False
        try:
            replace(index, new_source)
            if not mounted:
                run("docker", "tag", build_tag, image_tag)
                image_swapped = True
                swap_panel()
            wait_live(new_live, folder, assets)
        except BaseException:
            if index.read_bytes() == new_source:
                replace(index, old_source)
            if image_swapped:
                run("docker", "tag", old_image, image_tag)
                swap_panel()
            raise
        print("VERIFIED", HOST, version, "BACKUP", backup)


if __name__ == "__main__":
    with open("/run/lock/prohouse-mail-appearance.lock", "a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        deploy()
