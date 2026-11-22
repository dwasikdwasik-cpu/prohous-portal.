"""Apply the two PDF preview changes to an existing portal Compose deployment."""
from pathlib import Path
from urllib.request import urlopen
import datetime
import fcntl
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time

def run(*args, **kwargs):
    return subprocess.check_output(args, text=True, **kwargs).strip()

def atomic(path, data):
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as new:
        new.write(data)
        new.flush()
        os.fsync(new.fileno())
    try:
        shutil.copystat(path, new.name)
        os.chown(new.name, path.stat().st_uid, path.stat().st_gid)
        os.replace(new.name, path)
    finally:
        Path(new.name).unlink(missing_ok=True)

def check(port, release):
    for attempt in range(65):
        try:
            for route in ("/", "/ocr/pdf.preview.worker.min.mjs"):
                with urlopen("http://127.0.0.1:" + port + route, timeout=3) as res:
                    if res.status != 200:
                        raise ValueError("HTTP error")
                    if route.endswith(".mjs") and b"pdf.js" not in res.read(30000).lower() and "javascript" not in (res.headers.get("content-type") or ""):
                        raise ValueError("Unexpected PDF worker")
            if run("docker", "inspect", "-f", "{{.State.Health.Status}}", container) == "healthy":
                print("PORTAL PDF READY", release, flush=True)
                return
        except (OSError, ValueError, subprocess.CalledProcessError):
            pass
        time.sleep(1)
    raise RuntimeError("Portal startup or PDF worker verification failed")

def deploy():
    labels = json.loads(run("docker","inspect","-f","{{json .Config.Labels}}",container))
    if labels.get("com.docker.compose.service") != "portal":
        raise ValueError("Selected service is not the portal")
    project = labels["com.docker.compose.project"]
    files = [Path(s).resolve(strict=True) for s in labels["com.docker.compose.project.config_files"].split(",")]
    ready_port = re.fullmatch(r"127\.0\.0\.1:(\d+)", run("docker","port",container,"3000/tcp"))
    if not ready_port:
        raise ValueError("Expected an existing loopback-bound portal")
    port = ready_port.group(1)
    src = next(root for root in files[0].parents if (root/"app/DocumentPreview.tsx").is_file())
    if not all(path.is_relative_to(src) for path in files):
        raise ValueError("Unexpected configuration roots")
    compose = ["docker","compose","--project-name",project,"--env-file",str(env_file)]
    for path in files:
        compose.extend(["-f",str(path)])
    original_env = env_file.read_bytes()
    release = "preview-"+run("git","-C",str(here),"rev-parse","--short=12","HEAD")
    new_env, count = re.subn(rb"(?m)^PORTAL_RELEASE=[^\r\n]+",b"PORTAL_RELEASE="+release.encode(),original_env)
    if count != 1:
        raise ValueError("Cannot resolve existing PORTAL_RELEASE")
    source_files = ["app/DocumentPreview.tsx", "scripts/prepare-invoice-ocr.mjs"]
    from_commit = "c88c633508be785b860f5853fac8f86e511757d3"
    patch = subprocess.check_output(["git","-C",str(here),"diff","--no-ext-diff",from_commit,"HEAD","--",*source_files])
    originals = {src / path: (src/path).read_bytes() for path in source_files}
    subprocess.run(["git","apply","--check","-"],cwd=src,input=patch,check=True)
    backup = env_file.parent.parent / "backups" / ("invoice-preview-" + datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%S%f"))
    backup.mkdir(mode=0o700, parents=True)
    for path in [*originals,env_file]:
        shutil.copy2(path,backup/path.name)
    print("BUILDING PDF PREVIEW", flush=True)
    switched = False
    try:
        subprocess.run(["git","apply","-"],cwd=src,input=patch,check=True)
        with (backup/"build.log").open("w") as log:
            result = subprocess.run([*compose,"build","portal"],cwd=src,env={**os.environ,"PORTAL_RELEASE":release},stdout=log,stderr=subprocess.STDOUT)
        if result.returncode:
            raise RuntimeError("Portal build failed. Log: " + str(backup/"build.log"))
        current_image = run("docker","inspect","-f","{{.Config.Image}}",container)
        if env_file.read_bytes()!=original_env or not current_image.endswith(":"+re.search(rb"(?m)^PORTAL_RELEASE=([^\r\n]+)",original_env).group(1).decode()):
            raise RuntimeError("Release changed while building")
        atomic(env_file,new_env)
        switched = True
        subprocess.run([*compose,"up","-d","--no-build","--no-deps","portal"],cwd=src,check=True)
        if not run("docker","inspect","-f","{{.Config.Image}}",container).endswith(":"+release):
            raise RuntimeError("Unexpected portal image")
        check(port,release)
    except BaseException:
        for path, data in originals.items():
            atomic(path,data)
        if switched:
            atomic(env_file,original_env)
            subprocess.run([*compose,"up","-d","--no-build","--no-deps","portal"],cwd=src,check=True)
        raise

if __name__ == "__main__":
    here = Path(__file__).resolve().parent
    container, env_path = sys.argv[1:]
    env_file = Path(env_path).resolve(strict=True)
    with open("/run/lock/prohouse-pdf-preview","a") as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        deploy()
