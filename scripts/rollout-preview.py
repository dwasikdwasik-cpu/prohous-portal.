"""Apply the two files of the invoice preview fix to the currently running Compose portal."""
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile

RELEASE = "5ecd63811bc4577befb366ce569af5cb94f8db03"
before = {
    "app/DocumentPreview.tsx": "723ab6300904b3229a70392978ba4af1b716f469",
    "scripts/prepare-invoice-ocr.mjs": "b33b8df12fe144ae2ea7a6be3fafc55c6c8bcc61",
}
after = {
    "app/DocumentPreview.tsx": "9d350ba1153f4c11bf6d6340d484f0faa8c3bdc3",
    "scripts/prepare-invoice-ocr.mjs": "57d486d41444501d56734992b30f784b96c157e9",
}

def output(*args, **kwargs):
    return subprocess.check_output(args, text=True, **kwargs).strip()

def require(condition, message):
    if not condition:
        raise SystemExit(message)

def blob_hash(data):
    return hashlib.sha1(b"blob " + str(len(data)).encode() + b"\0" + data).hexdigest()

def replace_bytes(path, data):
    stat = path.stat()
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as temp:
        temp.write(data)
        os.fchmod(temp.fileno(), stat.st_mode & 0o7777)
        os.fchown(temp.fileno(), stat.st_uid, stat.st_gid)
        temp_path = temp.name
    os.replace(temp_path, path)

def main():
    require(len(sys.argv) >= 2, "Pass the active portal container ID and optional Compose environment files.")
    root = Path.cwd().resolve()
    src = Path(__file__).resolve().parent.parent
    lock = open("/run/lock/prohouse-invoice-preview.lock", "a")
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    old = json.loads(output("docker", "inspect", sys.argv[1]))[0]
    labels = old["Config"]["Labels"]
    service = labels["com.docker.compose.service"]
    require(service == "portal" and old["State"]["Running"], "Expected the running portal service.")
    current_image = old["Config"]["Image"]
    require(":" in current_image, "Could not determine the previous release tag.")
    old_tag = current_image.rsplit(":", 1)[1]
    new_tag = "preview-" + RELEASE[:12]
    files = [Path(i) for i in labels["com.docker.compose.project.config_files"].split(",")]
    require(all(p.is_relative_to(root) for p in files), "Compose files belong to a different application directory.")
    work = Path(labels["com.docker.compose.project.working_dir"])
    candidates = [Path(p) for p in sys.argv[2:]]
    if not candidates:
        candidates = [Path(p) for p in labels.get("com.docker.compose.project.environment_file", "").split(",") if p]
    compose = ["docker", "compose", "-p", labels["com.docker.compose.project"]]
    for p in candidates:
        require(p.is_file(), "Missing Compose environment file: " + str(p))
        compose += ["--env-file", str(p.resolve())]
    for p in files:
        compose += ["-f", str(p)]
    def cli(*args, tag=old_tag, **options):
        env = dict(os.environ, PORTAL_RELEASE=tag)
        return subprocess.run([*compose, *args], check=True, cwd=work, env=env, **options)
    cfg = json.loads(cli("config", "--format", "json", capture_output=True).stdout)["services"][service]
    require(cfg["image"] == current_image, "Resolved image differs from the running image.")
    require(Path(cfg["build"]["context"]).resolve() == root, "Unexpected Docker build context.")
    running_env = dict(s.split("=", 1) for s in old["Config"]["Env"])
    mismatches = [k for k,v in cfg.get("environment", {}).items() if running_env.get(k) != v]
    require(not mismatches, "Compose/runtime environment differences: " + ", ".join(mismatches))
    config_ports = {(str(p.get("target")) + "/" + p.get("protocol","tcp"), p.get("host_ip") or "", str(p.get("published"))) for p in cfg["ports"]}
    live_ports = {(k,b.get("HostIp",""),b["HostPort"]) for k,v in old["HostConfig"]["PortBindings"].items() for b in v or []}
    require(live_ports == config_ports, "Published ports differ from the running service.")
    for volume in cfg.get("volumes", []):
        if volume.get("type") == "bind":
            require(any(m["Type"] == "bind" and m["Source"] == volume["source"] and m["Destination"] == volume["target"] and m["RW"] == (not volume.get("read_only", False)) for m in old["Mounts"]), "Bind mounts differ from the running service.")
    original, replacement = {}, {}
    for name in before:
        original[name] = (root / name).read_bytes()
        replacement[name] = subprocess.check_output(["git", "-C", str(src), "show", RELEASE + ":" + name])
        require(blob_hash(original[name]) == before[name], "Unexpected source revision: " + name)
        require(blob_hash(replacement[name]) == after[name], "Unexpected replacement revision: " + name)
    backup = Path(tempfile.mkdtemp(prefix="prohouse-invoice-preview-", dir="/var/tmp"))
    print("Backup and private build log:", backup, flush=True)
    for name in before:
        p = backup / name
        p.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(root / name, p)
    metadata = {"previous_image": current_image, "previous_image_id": old["Image"], "new_release": new_tag}
    (backup / "release.json").write_text(json.dumps(metadata))
    changed, activating = [], False
    try:
        for name in before:
            replace_bytes(root / name, replacement[name])
            changed.append(name)
        with (backup / "build.log").open("w") as log:
            print("Building portal", flush=True)
            cli("build", service, tag=new_tag, stdout=log, stderr=subprocess.STDOUT)
        require(output("docker", "inspect", "--format", "{{.State.Running}}", old["Id"]) == "true", "The running service changed during the build.")
        print("Activating portal and checking container health", flush=True)
        activating = True
        cli("up", "-d", "--no-deps", "--no-build", "--wait", "--wait-timeout", "120", service, tag=new_tag)
        container = cli("ps", "-q", service, tag=new_tag, capture_output=True, text=True).stdout.strip()
        status = json.loads(output("docker", "inspect", container))[0]
        require(status["Config"]["Image"].endswith(":" + new_tag) and status["State"]["Health"]["Status"] == "healthy", "New release is not healthy.")
    except BaseException:
        for name in changed:
            replace_bytes(root / name, original[name])
        if activating:
            cli("up", "-d", "--no-deps", "--no-build", "--wait", "--wait-timeout", "120", service)
        raise
    for path in set([*candidates, work / ".env", root / ".env"]):
        if not path.is_file():
            continue
        data = path.read_bytes()
        pattern = rb"(?m)^(PORTAL_RELEASE\s*=\s*)([\"']?)" + re.escape(old_tag.encode()) + rb"\2([ \t]*(?:\#.*)?\r?)$"
        updated, n = re.subn(pattern, lambda m:m[1]+m[2]+new_tag.encode()+m[2]+m[3], data)
        if n == 1:
            shutil.copy2(path, backup / ("env-" + hashlib.sha256(str(path).encode()).hexdigest()[:12]))
            replace_bytes(path, updated)
    print("Healthy portal release:", new_tag, flush=True)

if __name__ == "__main__":
    try:
        main()
    except subprocess.CalledProcessError as error:
        if error.stderr and "config" in error.cmd:
            msg = error.stderr.decode() if isinstance(error.stderr, bytes) else str(error.stderr)
            print("Missing interpolation settings:", ", ".join(sorted(set(re.findall(r"variable ([A-Za-z_][A-Za-z_0-9]*)", msg)))), file=sys.stderr)
        raise SystemExit("Command failed: " + str(error.returncode))
