"""Integrate project folders into the currently running client portal."""
import datetime
import fcntl
import hashlib
import json
import os
import re
import shutil
import subprocess
import tempfile
from pathlib import Path
from urllib.request import urlopen

REPO = Path(__file__).resolve().parents[1]
ROOT = Path('/opt/prohouse-scan-upload')
MIGRATION = 'supabase/migrations/20261126190000_investment_project_folders.sql'
COMPONENT = 'app/InvestmentProjectFolders.tsx'


def integrate(page):
    if "from './InvestmentProjectFolders'" in page:
        if not all(x in page for x in ('projectFileRow', 'project_folder_id', 'uploadForm={projectUploadForm}')):
            raise ValueError('Niekompletna wcześniejsza integracja folderów.')
        return page

    def once(old, new):
        nonlocal page
        if page.count(old) != 1:
            raise ValueError('Nie rozpoznano miejsca integracji: ' + old[:70])
        page = page.replace(old, new, 1)

    once('import {db,configured}', "import InvestmentProjectFolders from './InvestmentProjectFolders';\nimport {db,configured}")
    once('function projectUploadForm(){', "function projectUploadForm(folderId=''){")
    once('<input type="hidden" name="upload_category" value="projekty"/>',
         '<input type="hidden" name="upload_category" value="projekty"/><input type="hidden" name="project_folder_id" value={folderId}/>')
    once('investment_id:investmentId,title:(installer?', """investment_id:investmentId,...(category==='projekty'&&f.get('project_folder_id')?{project_folder_id:String(f.get('project_folder_id'))}:{}),title:(installer?""")
    anchor = "{tab==='projects'&&<>"
    start = page.index(anchor)
    end = page.index('</section></>}', start) + len('</section></>}')
    section = page[start:end]
    row_start = section.index('projectFiles.map(d=>') + len('projectFiles.map(d=>')
    row_end = section.index('):<Empty', row_start)
    row = section[row_start:row_end]
    if not row.startswith('<div') or not row.endswith('</div>') or 'openDoc(d,true)' not in row:
        raise ValueError('Nie rozpoznano wiersza dokumentu.')
    once('function projectUploadForm(', 'function projectFileRow(d:Row){return '+row+'}\n function projectUploadForm(')
    old_form = '{admin&&<><h3>Dodaj pliki projektu</h3>{projectUploadForm()}</>}'
    list_start = '</section><section className="panel"><div className="section-head"><h2>Pliki projektowe</h2>'
    if section.count(old_form) != 1 or section.count(list_start) != 1:
        raise ValueError('Zmieniono sekcję projektów. Wymagane scalenie.')
    managed = """<InvestmentProjectFolders key={selected} investment={selected} documents={projectFiles} busy={busy} uploadForm={projectUploadForm} renderFile={projectFileRow} refresh={refresh}/>"""
    new_section = section.replace(old_form, '').replace('projectFiles.map(d=>'+row+')', 'projectFiles.map(projectFileRow)')
    new_section = new_section.replace(list_start, '</section>{admin&&selected?'+managed+':'+list_start.removeprefix('</section>'))
    once(section, new_section.removesuffix('</section></>}')+'</section>}</>}')
    return page


def output(*args):
    return subprocess.check_output(args, text=True).strip()


def sql(statement):
    return subprocess.check_output(
        ['docker','exec','-i','supabase-db','psql','-XAtq','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres'],
        input=statement, text=True).strip()


def db_installed():
    return sql("select to_regclass('public.investment_project_folders') is not null;") == 't'


def atomic(path, content, mode):
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as tmp:
        tmp.write(content)
    os.chmod(tmp.name, mode)
    os.replace(tmp.name, path)


def main():
    lock = open('/run/lock/prohouse-designer-release', 'a')
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    container = 'prohouse-scan-upload-portal-1'
    labels = json.loads(output('docker','inspect','-f','{{json .Config.Labels}}', container))
    if (labels['com.docker.compose.project'], labels['com.docker.compose.service']) != ('prohouse-scan-upload','portal'):
        raise RuntimeError('Nie rozpoznano aktywnej usługi.')
    env = Path('/opt/prohouse/private/scan-upload.env')
    compose = ['docker','compose','-p','prohouse-scan-upload','--env-file',str(env)]
    for item in labels['com.docker.compose.project.config_files'].split(','):
        if not Path(item).resolve().is_relative_to(ROOT):
            raise ValueError('Nie rozpoznano konfiguracji.')
        compose.extend(['-f',item])
    page = ROOT/'app/page.tsx'
    targets = {page:integrate(page.read_text()).encode(), ROOT/COMPONENT:(REPO/COMPONENT).read_bytes(),
               ROOT/MIGRATION:(REPO/MIGRATION).read_bytes()}
    migration = targets[ROOT/MIGRATION].decode()
    existing = db_installed()
    if existing and (not (ROOT/MIGRATION).is_file() or (ROOT/MIGRATION).read_text() != migration):
        raise RuntimeError('Istniejąca migracja wymaga sprawdzenia.')
    check = (REPO/'deploy/check-investment-project-folders.sql').read_text()
    sql('begin;\n' + ('' if existing else migration) + '\n' + check + '\nrollback;')
    print('FOLDER_TESTS_OK', flush=True)
    release = 'project-folders-' + hashlib.sha256(b''.join(targets.values())).hexdigest()[:12]
    content, count = re.subn(rb'^PORTAL_RELEASE=.*$', b'PORTAL_RELEASE='+release.encode(), env.read_bytes(), flags=re.M)
    if count != 1:
        raise RuntimeError('Nie rozpoznano aktualnej wersji.')
    targets[env] = content
    old_container = output('docker','inspect','-f','{{.Id}}',container)
    timestamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%d-%H%M%S-%f')
    backup = Path('/opt/prohouse/backups') / ('project-folders-'+timestamp)
    backup.mkdir(mode=0o700)
    prior = {}
    def up():
        subprocess.run(compose+['up','-d','--no-build','--no-deps','--wait','--wait-timeout','120','portal'], cwd=ROOT, check=True)
    switched = False
    try:
        for path, data in targets.items():
            old = path.read_bytes() if path.exists() else None
            if old == data: continue
            saved = backup/path.name if old is not None else None
            if saved: shutil.copy2(path, saved)
            prior[path] = saved
            atomic(path, data, path.stat().st_mode & 0o777 if saved else 0o644)
        subprocess.run(compose+['build','portal'], cwd=ROOT, check=True)
        if output('docker','inspect','-f','{{.Id}}',container) != old_container:
            raise RuntimeError('Zmieniła się aktywna wersja portalu.')
        if not existing:
            sql("begin;\n"+migration+"\nnotify pgrst,'reload schema';\ncommit;")
        switched = True
        up()
        with urlopen('https://klient.prohous.pl/api/health', timeout=20) as response:
            if response.status != 200: raise RuntimeError('Błąd kontroli dostępności portalu.')
        actual = output('docker','inspect','-f','{{.Config.Image}}',container)
        if not actual.endswith(':'+release):
            raise RuntimeError('Nie potwierdzono wersji aplikacji.')
    except BaseException:
        for path, saved in reversed(list(prior.items())):
            if path == ROOT/MIGRATION and switched: continue
            if saved: shutil.copy2(saved, path)
            else: path.unlink(missing_ok=True)
        if switched: up()
        raise
    print('FOLDERS_READY', release, flush=True)


if __name__ == '__main__':
    main()
