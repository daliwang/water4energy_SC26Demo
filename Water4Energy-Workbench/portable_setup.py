"""Install this package's project through the local VISTA API, without an LLM."""
from pathlib import Path
import hashlib
import io
import json
import mimetypes
import re
import shlex
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
import zipfile

PROJECT = 'Water4Energy-TVA-agent-loop'
SLUG = 'water4energy-tva-demo-2019'
SKILLS = {'lab-literature', 'lab-download', 'lab-ledger', 'lab-board',
          'lab-design', 'lab-show-command', 'lab-realize', 'downscale-scorecard'}
VERSION = '0.15.1'


class SetupError(RuntimeError):
    pass


def local_api(value):
    parsed = urllib.parse.urlsplit(value)
    try:
        port = parsed.port or 80
    except ValueError as error:
        raise SetupError('The VISTA address needs a valid local port.') from error
    if (parsed.scheme != 'http' or parsed.hostname not in {'localhost', '127.0.0.1', '::1'}
            or parsed.username or parsed.password or parsed.path not in {'', '/'}
            or parsed.query or parsed.fragment or not 1 <= port <= 65535):
        raise SetupError('Use a local VISTA address such as http://127.0.0.1:8001.')
    return value.rstrip('/')


class NoRedirects(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, response, code, message, headers, url):
        return None


def multipart(fields, files):
    boundary = 'w4e-' + uuid.uuid4().hex
    chunks = []
    for key, value in fields:
        chunks.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{key}"\r\n\r\n{value}\r\n'.encode())
    for key, name, data in files:
        kind = mimetypes.guess_type(name)[0] or 'application/octet-stream'
        chunks.extend([f'--{boundary}\r\nContent-Disposition: form-data; name="{key}"; filename="{name}"\r\nContent-Type: {kind}\r\n\r\n'.encode(), data, b'\r\n'])
    chunks.append(f'--{boundary}--\r\n'.encode())
    return b''.join(chunks), 'multipart/form-data; boundary=' + boundary


def load(path):
    return json.loads(path.read_text(encoding='utf-8'))


def digest(data):
    return hashlib.sha256(data).hexdigest()


class Setup:
    def __init__(self, root, api='http://127.0.0.1:8001', timeout=180, printer=print):
        self.root = Path(root).resolve()
        self.backend = self.root / 'backend'
        self.api = local_api(api)
        self.timeout = timeout
        self.print = printer
        self.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirects())

    def raw(self, path, data=None, method='GET', content_type='application/json', timeout=90):
        if data is not None and not isinstance(data, bytes):
            data = json.dumps(data).encode()
        request = urllib.request.Request(self.api + path, data=data, method=method,
                                         headers={'Content-Type': content_type} if data is not None else {})
        try:
            with self.opener.open(request, timeout=timeout) as response:
                return response.status, response.read()
        except urllib.error.HTTPError as error:
            return error.code, error.read()
        except (urllib.error.URLError, OSError) as error:
            raise SetupError('Cannot reach local VISTA at ' + self.api + '. Open VISTA and try the launcher again.') from error

    def request(self, path, data=None, method='GET', content_type='application/json'):
        status, body = self.raw(path, data, method, content_type)
        try:
            result = json.loads(body) if body else None
        except (ValueError, UnicodeDecodeError) as error:
            raise SetupError('VISTA returned an unsupported response for ' + path) from error
        return status, result

    @staticmethod
    def require(status, expected, label):
        if status != expected:
            raise SetupError(f'{label} failed (HTTP {status}). Check VISTA and rerun this launcher; existing items are preserved.')

    def validate_local(self):
        template = load(self.backend / 'project.json')
        if template['project']['name'] != PROJECT or template['knowledge_base']['slug'] != SLUG:
            raise SetupError('The bundled project identity is invalid. Extract the complete ZIP again.')
        folders = {p.name: p for p in (self.backend / 'skills').iterdir() if p.is_dir()}
        if set(folders) != SKILLS:
            raise SetupError('The bundle must contain all eight Water4Energy skills.')
        for record in load(self.backend / 'source-provenance.json'):
            relative = Path(record['repo']) / record['path']
            if relative.is_absolute() or '..' in relative.parts:
                raise SetupError('Invalid source path in the package.')
            if digest((self.backend / 'sources' / relative).read_bytes()) != record['sha256']:
                raise SetupError('Source verification failed: ' + str(relative))
        expected = load(self.backend / 'evidence-manifest.json')
        with zipfile.ZipFile(self.backend / 'evidence.zip') as archive:
            if len(archive.namelist()) != len(expected) or set(archive.namelist()) != set(expected):
                raise SetupError('The saved evidence archive is incomplete.')
            for name, sha in expected.items():
                if not re.fullmatch(r'[A-Za-z0-9._-]+', name) or name in {'.', '..'}:
                    raise SetupError('Invalid evidence filename in the package.')
                if digest(archive.read(name)) != sha:
                    raise SetupError('Evidence verification failed: ' + name)
        return template, folders, expected

    def check_project(self, project, wanted):
        for key in ['description', 'system_prompt']:
            if project.get(key) != wanted.get(key):
                raise SetupError('An existing Water4Energy-TVA-agent-loop project differs from this bundle. It was preserved. Review it in VISTA before importing.')
        # VISTA expands omitted optional UsageLimits fields to null/false.
        actual_limits = {k: v for k, v in (project.get('usage_limits') or {}).items() if v is not None and v is not False}
        wanted_limits = {k: v for k, v in (wanted.get('usage_limits') or {}).items() if v is not None and v is not False}
        if (actual_limits != wanted_limits or set(project.get('tools', [])) != set(wanted['tools'])
                or not set(project.get('skills', [])).issubset(SKILLS)
                or not set(project.get('knowledge_bases', [])).issubset({SLUG})):
            raise SetupError('The existing Water4Energy project has different tools, skills or sources. It was preserved.')

    def check_skill(self, skill, folder, owner):
        front, body = (folder / 'SKILL.md').read_text(encoding='utf-8').split('---', 2)[1:]
        body = body.strip()
        metadata = json.loads(next(line.split(':', 1)[1].strip() for line in front.splitlines() if line.startswith('metadata:')))
        if (metadata.get('setup-owner') != owner or skill.get('metadata') != metadata
                or skill.get('body', '').strip() != body or skill.get('hpc_jobs')):
            raise SetupError('An existing skill differs from this bundle: ' + folder.name + '. It was preserved; no global skills are replaced.')

    def migration(self):
        """Retained for callers inspecting the original v0.13.1 baseline."""
        path = self.backend / 'migrations/v0131.json'
        return load(path) if path.is_file() else None

    def migrations(self):
        known = {}
        for path in sorted((self.backend / 'migrations').glob('v*.json')):
            baseline = load(path)
            version = baseline.get('version', '')
            if not re.fullmatch(r'[0-9]+\.[0-9]+\.[0-9]+', version) or version == VERSION or version in known:
                raise SetupError('The bundled upgrade baselines are invalid. Extract the complete ZIP again.')
            known[version] = baseline
        return known

    @staticmethod
    def baseline_list(migrations):
        if not migrations:
            return []
        if 'skills' in migrations:  # Compatibility with an individual known baseline.
            return [migrations]
        return sorted(migrations.values(), key=lambda b: tuple(map(int, b['version'].split('.'))), reverse=True)

    def project_version(self, project, wanted, migrations):
        try:
            self.check_project(project, wanted)
            return VERSION
        except SetupError:
            for baseline in self.baseline_list(migrations):
                try:
                    self.check_project(project, baseline['project'])
                    return baseline['version']
                except SetupError:
                    continue
            raise SetupError('The existing Water4Energy project is neither this version nor a known original version. It was preserved.')

    def skill_version(self, skill, folder, owner, migrations):
        try:
            self.check_skill(skill, folder, owner)
            return VERSION
        except SetupError:
            for baseline in self.baseline_list(migrations):
                old = baseline.get('skills', {}).get(folder.name)
                if (old and skill.get('metadata') == old['metadata'] and not skill.get('hpc_jobs')
                        and not skill.get('bundled') and digest(skill.get('body', '').strip().encode()) == old['body_sha256']):
                    return baseline['version']
            raise SetupError('An existing skill has local changes or an unknown version: ' + folder.name + '. It was preserved.')

    def call_local_tool(self, script, marker):
        status, result = self.request('/projects/' + PROJECT + '/mcp/call',
                                      {'name': 'run_bash', 'arguments': {'command': 'python3 -c ' + shlex.quote(script)}}, 'POST')
        self.require(status, 200, 'Checking the project sandbox')
        text = '\n'.join(str(c.get('text', '')) for c in result.get('content', []))
        if result.get('isError') or marker not in text:
            raise SetupError('The project sandbox could not verify the owned skill files. No unknown or edited skill is replaced. Check VISTA scientific tools and retry.')
        return result

    def preflight_upgrade(self, project, upgrade_names, migration):
        if not upgrade_names:
            return
        if not project or not set(upgrade_names).issubset(project.get('skills', [])):
            raise SetupError('Older global demo skills exist without their matching project mounts. They were preserved. Open the original Water4Energy project before upgrading.')
        status, projects = self.request('/projects')
        self.require(status, 200, 'Checking shared skill use')
        if not isinstance(projects, list):
            raise SetupError('VISTA could not verify whether another project uses the older demo skills.')
        if any(p.get('name') != PROJECT and set(p.get('skills', [])).intersection(upgrade_names) for p in projects):
            raise SetupError('Another project also uses an older demo skill. It was preserved; upgrade a reviewed project copy before replacing shared skills.')
        # A resumed install can contain known skills from different old versions.
        expected = {name: (migration if 'skills' in migration else migration[name])['skills'][name]['files'] for name in upgrade_names}
        script = '''from pathlib import Path
import hashlib
for name, expected in EXPECTED.items():
    root = Path('/mnt/skills') / name
    found = {}
    for path in root.rglob('*'):
        relative = path.relative_to(root)
        if '__pycache__' in relative.parts or path.name == '.DS_Store' or path.suffix == '.pyc':
            continue
        assert not path.is_symlink(), 'Skill contains a link: ' + name + '/' + str(relative)
        if path.is_file():
            found[relative.as_posix()] = hashlib.sha256(path.read_bytes()).hexdigest()
    assert found == expected, 'Skill has local file changes: ' + name
print('W4E_SKILL_PREFLIGHT_OK')
'''
        self.call_local_tool('EXPECTED = ' + repr(expected) + '\n' + script, 'W4E_SKILL_PREFLIGHT_OK')

    def backup_upgrade(self, project, skills, migration):
        """Reconstruct the verified old files, excluding all settings/credentials."""
        version_slug = 'v' + migration['version'].replace('.', '')
        target = self.root / '.local/upgrade-backups' / (version_slug + '-' + digest(json.dumps({'api': self.api, 'id': project['id']}, sort_keys=True).encode())[:16])
        target.mkdir(parents=True, exist_ok=True)
        vault = self.backend / 'migrations' / (version_slug + '-original-files.zip')
        if digest(vault.read_bytes()) != migration['original_files_archive_sha256']:
            raise SetupError('The original skill backup vault failed verification.')
        backup = target / 'original-skills.zip'
        if not backup.exists():
            temporary = backup.with_suffix('.tmp')
            try:
                with zipfile.ZipFile(vault) as originals, zipfile.ZipFile(temporary, 'w', zipfile.ZIP_DEFLATED) as output:
                    for name in sorted(skills):
                        old = migration['skills'][name]
                        for relative, sha in old['files'].items():
                            key = name + '/' + relative
                            entry = migration.get('original_file_entries', {}).get(key, key)
                            data = originals.read(entry) if entry in originals.namelist() else (self.backend / 'skills' / name / relative).read_bytes()
                            if digest(data) != sha:
                                raise SetupError('Cannot reconstruct the original skill backup: ' + key)
                            output.writestr(key, data)
                temporary.replace(backup)
            finally:
                if temporary.exists():
                    temporary.unlink()
        # A resumed upgrade must still have complete, valid originals for
        # every remaining old skill. Validate the entire existing archive too:
        # a damaged backup is not permission to continue replacing files.
        try:
            with zipfile.ZipFile(backup) as archive:
                entries = archive.namelist()
                if len(entries) != len(set(entries)):
                    raise SetupError('The original skill backup contains duplicate files.')
                backed_up = {}
                for key in entries:
                    name, relative = key.split('/', 1)
                    original = migration['skills'].get(name, {}).get('files', {})
                    if relative not in original or digest(archive.read(key)) != original[relative]:
                        raise SetupError('The original skill backup failed verification: ' + key)
                    backed_up.setdefault(name, set()).add(relative)
                if any(files != set(migration['skills'][name]['files']) for name, files in backed_up.items()):
                    raise SetupError('The original skill backup is incomplete.')
                if not set(skills).issubset(backed_up):
                    raise SetupError('The original skill backup does not contain every skill still needing an upgrade.')
        except (ValueError, OSError, zipfile.BadZipFile) as error:
            raise SetupError('The original skill backup could not be verified. It was preserved.') from error
        snapshot = target / 'original-project-and-skills.json'
        if not snapshot.exists():
            snapshot.write_text(json.dumps({'project': project, 'skills': skills, 'version': migration['version']}, indent=2) + '\n', encoding='utf-8')
        return target

    def replace_skill(self, name, folder, owner):
        """Use VISTA's supported full-folder replacement, never a body-only patch."""
        data = io.BytesIO()
        files = {p.relative_to(folder).as_posix(): p.read_bytes() for p in folder.rglob('*') if p.is_file()}
        with zipfile.ZipFile(data, 'w', zipfile.ZIP_DEFLATED) as archive:
            for relative, content in sorted(files.items()):
                archive.writestr(relative, content)
        content = data.getvalue()
        file_hashes = {n: digest(b) for n, b in files.items()}
        stage_name = 'w4e-v' + VERSION.replace('.', '') + '-' + name + '-' + digest(json.dumps(file_hashes, sort_keys=True).encode())[:12]
        payload, kind = multipart([], [('files', stage_name + '.zip', content)])
        status, uploads = self.request('/projects/' + PROJECT + '/uploads', payload, 'POST', kind)
        self.require(status, 200, 'Staging ' + name)
        if not isinstance(uploads, list) or len(uploads) != 1 or not re.fullmatch(r'[A-Za-z0-9._-]+', uploads[0]):
            raise SetupError('VISTA returned an unsupported skill upload name.')
        script = '''from pathlib import Path
import hashlib, zipfile
source = Path('/mnt/data/uploads') / UPLOAD
target = Path('/mnt/data/output') / STAGE
assert hashlib.sha256(source.read_bytes()).hexdigest() == ARCHIVE_SHA, 'Skill archive changed'
assert not target.is_symlink(), 'Stage is a link'
if target.exists():
    found = set()
    for path in target.rglob('*'):
        assert not path.is_symlink(), 'Stage contains a link'
        if path.is_file():
            found.add(path.relative_to(target).as_posix())
    assert found.issubset(EXPECTED), 'Stage contains unknown files'
with zipfile.ZipFile(source) as archive:
    assert len(archive.namelist()) == len(EXPECTED) and set(archive.namelist()) == set(EXPECTED), 'Unexpected skill files'
    for name, sha in EXPECTED.items():
        relative = Path(name)
        assert not relative.is_absolute() and '..' not in relative.parts, 'Invalid skill filename'
        assert hashlib.sha256(archive.read(name)).hexdigest() == sha, 'Skill source changed'
        path = target / relative
        assert not path.is_symlink(), 'Stage contains a link'
        assert not path.exists() or (path.is_file() and hashlib.sha256(path.read_bytes()).hexdigest() == sha), 'Stage conflict'
    for name in EXPECTED:
        path = target / name
        if not path.exists():
            path.parent.mkdir(parents=True, exist_ok=True)
            with path.open('xb') as output:
                output.write(archive.read(name))
print('W4E_SKILL_STAGED')
'''
        header = 'UPLOAD = ' + repr(uploads[0]) + '\nSTAGE = ' + repr(stage_name) + '\nARCHIVE_SHA = ' + repr(digest(content)) + '\nEXPECTED = ' + repr(file_hashes) + '\n'
        self.call_local_tool(header + script, 'W4E_SKILL_STAGED')
        status, skill = self.request('/projects/' + PROJECT + '/skills/from-output', {'folder': stage_name, 'replace': True}, 'POST')
        self.require(status, 201, 'Upgrading ' + name)
        self.check_skill(skill, folder, owner)
        cleanup = '''from pathlib import Path
import hashlib, shutil
target = Path('/mnt/data/output') / STAGE
assert target.is_dir() and not target.is_symlink(), 'Invalid setup stage'
found = {}
for path in target.rglob('*'):
    assert not path.is_symlink(), 'Setup stage contains a link'
    if path.is_file():
        found[path.relative_to(target).as_posix()] = hashlib.sha256(path.read_bytes()).hexdigest()
assert found == EXPECTED, 'Setup stage changed; preserving it'
shutil.rmtree(target)
print('W4E_SKILL_STAGE_CLEANED')
'''
        self.call_local_tool('STAGE = ' + repr(stage_name) + '\nEXPECTED = ' + repr(file_hashes) + '\n' + cleanup, 'W4E_SKILL_STAGE_CLEANED')

    def check_kb(self, kb, wanted):
        if any(kb.get(key) != wanted[key] for key in ['name', 'description']):
            raise SetupError('An existing knowledge base uses the demo name with different content. It was preserved.')

    def attach(self):
        status, project = self.request('/projects/' + PROJECT)
        self.require(status, 200, 'Reading the project')
        if set(project['skills']) != SKILLS or set(project['knowledge_bases']) != {SLUG}:
            fields = {key: project.get(key) for key in ['name', 'description', 'system_prompt', 'skills', 'knowledge_bases', 'tools', 'forum_repo_url', 'usage_limits']}
            fields.update(skills=sorted(SKILLS), knowledge_bases=[SLUG])
            status, project = self.request('/projects/' + PROJECT, fields, 'PUT')
            self.require(status, 200, 'Attaching the demo skills and source index')
        return project

    def wait_for_index(self, filenames):
        deadline = time.monotonic() + self.timeout
        while True:
            status, kb = self.request('/knowledge-bases/' + SLUG)
            self.require(status, 200, 'Reading source index')
            publications = {p['filename']: p for p in kb.get('publications', [])}
            failed = [name for name in filenames if publications.get(name, {}).get('index_status') == 'failed']
            if failed:
                raise SetupError('VISTA could not index: ' + ', '.join(failed) + '. Review indexing in VISTA, then rerun the launcher.')
            if (all(publications.get(name, {}).get('index_status') == 'indexed' for name in filenames)
                    and kb.get('build_status') == 'ready'):
                return len(filenames)
            if time.monotonic() >= deadline:
                raise SetupError('The source index is still preparing. Keep VISTA open and rerun the launcher when indexing finishes.')
            self.print(f'  Waiting for VISTA to finish indexing {len(filenames)} source documents…', flush=True)
            time.sleep(min(2, max(.01, deadline - time.monotonic())))

    def evidence_status(self, expected):
        status, listing = self.request('/projects/' + PROJECT + '/outputs')
        self.require(status, 200, 'Reading saved evidence')
        present = {f['name'] for f in listing}
        missing = []
        for name, sha in expected.items():
            if name not in present:
                missing.append(name)
                continue
            status, body = self.raw('/projects/' + PROJECT + '/outputs/' + name)
            self.require(status, 200, 'Reading ' + name)
            if digest(body) != sha:
                raise SetupError('An existing output differs from the package: ' + name + '. It was preserved. Use a reviewed project copy before replacing evidence.')
        return missing

    def stage_evidence(self, expected):
        if not self.evidence_status(expected):
            return
        payload, kind = multipart([], [('files', 'water4energy-saved-evidence.zip', (self.backend / 'evidence.zip').read_bytes())])
        status, names = self.request('/projects/' + PROJECT + '/uploads', payload, 'POST', kind)
        self.require(status, 200, 'Staging the evidence archive')
        if not isinstance(names, list) or len(names) != 1 or not re.fullmatch(r'[A-Za-z0-9._-]+', names[0]):
            raise SetupError('VISTA returned an unsupported upload filename.')
        # Runs only a standard-library file copier in the project's existing sandbox.
        # Verify every member and every destination before writing anything. Existing
        # byte-identical files are not touched, preserving saved display timestamps.
        script = '''from pathlib import Path
import hashlib, json, zipfile
src = Path('/mnt/data/uploads') / UPLOAD
out = Path('/mnt/data/output')
assert hashlib.sha256(src.read_bytes()).hexdigest() == ARCHIVE_SHA, 'Archive hash mismatch'
with zipfile.ZipFile(src) as archive:
    assert len(archive.namelist()) == len(EXPECTED) and set(archive.namelist()) == set(EXPECTED), 'Unexpected archive files'
    for name, sha in EXPECTED.items():
        assert Path(name).name == name and name not in ('.', '..'), 'Invalid filename'
        data = archive.read(name)
        assert hashlib.sha256(data).hexdigest() == sha, 'Invalid source: ' + name
        dst = out / name
        assert not dst.is_symlink(), 'Output is a link: ' + name
        assert not dst.exists() or (dst.is_file() and hashlib.sha256(dst.read_bytes()).hexdigest() == sha), 'Output conflict: ' + name
    out.mkdir(parents=True, exist_ok=True)
    count = 0
    for name, sha in EXPECTED.items():
        dst = out / name
        if not dst.exists():
            with dst.open('xb') as target:
                target.write(archive.read(name))
            count += 1
print(json.dumps({'copied': count, 'verified': len(EXPECTED), 'jobs_submitted': 0}))
'''
        header = 'UPLOAD = ' + repr(names[0]) + '\nARCHIVE_SHA = ' + repr(digest((self.backend / 'evidence.zip').read_bytes())) + '\nEXPECTED = ' + repr(expected) + '\n'
        status, result = self.request('/projects/' + PROJECT + '/mcp/call',
                                      {'name': 'run_bash', 'arguments': {'command': 'python3 -c ' + shlex.quote(header + script)}}, 'POST')
        self.require(status, 200, 'Copying the saved project evidence')
        if result.get('isError') or self.evidence_status(expected):
            raise SetupError('VISTA could not copy the saved evidence. Check its scientific-tools sandbox, then rerun this launcher.')

    def run(self):
        self.print('1/4 Verifying the included sources and saved figures…', flush=True)
        template, folders, evidence = self.validate_local()
        migrations = self.migrations()
        # Check all global-name conflicts before creating or attaching anything.
        status, schema = self.request('/openapi.json')
        self.require(status, 200, 'Checking local VISTA')
        if not {'/projects', '/skills/import/upload', '/knowledge-bases'}.issubset(schema.get('paths', {})):
            raise SetupError('This local service is not a compatible VISTA backend.')
        status, project = self.request('/projects/' + PROJECT)
        if status not in {200, 404}:
            self.require(status, 200, 'Checking the project')
        project_version = self.project_version(project, template['project'], migrations) if status == 200 else None
        create_project = status == 404
        status, kb = self.request('/knowledge-bases/' + SLUG)
        if status not in {200, 404}:
            self.require(status, 200, 'Checking the source index')
        if status == 200:
            self.check_kb(kb, template['knowledge_base'])
        create_kb = status == 404
        existing_skills = set()
        upgrade_names = []
        old_skills = {}
        old_versions = {}
        for name, folder in sorted(folders.items()):
            status, skill = self.request('/skills/' + name)
            if status == 200:
                version = self.skill_version(skill, folder, template['skill_owner'], migrations)
                if version != VERSION:
                    upgrade_names.append(name)
                    old_skills[name] = skill
                    old_versions[name] = version
                existing_skills.add(name)
            elif status != 404:
                self.require(status, 200, 'Checking ' + name)
        if not create_project:
            self.evidence_status(evidence)
        baselines = {name: migrations[version] for name, version in old_versions.items()}
        self.preflight_upgrade(project if not create_project else None, upgrade_names, baselines)
        upgrade_sources = set(old_versions.values())
        if project_version and project_version != VERSION:
            upgrade_sources.add(project_version)
        for version in sorted(upgrade_sources):
            group = {name: old_skills[name] for name in old_skills if old_versions[name] == version}
            backup = self.backup_upgrade(project, group, migrations[version])
            self.print('Verified v' + version + ' upgrade; local backup: ' + str(backup), flush=True)

        self.print('2/4 Preparing the Water4Energy project and eight skills…', flush=True)
        if create_project:
            status, project = self.request('/projects', template['project'], 'POST')
            self.require(status, 201, 'Creating the dedicated demo project')
        elif project_version != VERSION:
            fields = {key: project.get(key) for key in ['name', 'description', 'system_prompt', 'skills', 'knowledge_bases', 'tools', 'forum_repo_url', 'usage_limits']}
            fields.update({key: template['project'][key] for key in ['description', 'system_prompt', 'tools', 'usage_limits']})
            status, project = self.request('/projects/' + PROJECT, fields, 'PUT')
            self.require(status, 200, 'Upgrading the owned demo project')
        if create_kb:
            status, kb = self.request('/knowledge-bases', template['knowledge_base'], 'POST')
            self.require(status, 201, 'Creating the demo source index')
        for name, folder in sorted(folders.items()):
            if name in upgrade_names:
                self.replace_skill(name, folder, template['skill_owner'])
                continue
            if name in existing_skills:
                continue
            files = sorted(p for p in folder.rglob('*') if p.is_file())
            fields = [('project', PROJECT)] + [('paths', p.relative_to(folder).as_posix()) for p in files]
            payload, kind = multipart(fields, [('files', p.name, p.read_bytes()) for p in files])
            status, skill = self.request('/skills/import/upload', payload, 'POST', kind)
            self.require(status, 201, 'Importing ' + name)
            self.check_skill(skill, folder, template['skill_owner'])
        self.attach()

        docs = sorted(p for p in (self.backend / 'lead-documents').iterdir() if p.is_file())
        self.print(f'3/4 Preparing the {len(docs)}-document source index…', flush=True)
        existing = {p['filename'] for p in kb.get('publications', [])}
        new_docs = [p for p in docs if p.name not in existing]
        if new_docs:
            payload, kind = multipart([], [('files', p.name, p.read_bytes()) for p in new_docs])
            status, result = self.request('/knowledge-bases/' + SLUG + '/publications', payload, 'POST', kind)
            self.require(status, 201, 'Uploading the lead documents')
        indexed = self.wait_for_index([p.name for p in docs])

        self.print('4/4 Loading and checking the saved April figures…', flush=True)
        self.stage_evidence(evidence)
        status, inference = self.request('/settings/inference')  # This endpoint never returns secrets.
        model_configured = status == 200 and bool(inference.get('has_credential') and inference.get('model'))
        report = {'bundle_revision': 1, 'interface_version': VERSION, 'project': PROJECT,
                  'backend_url': self.api, 'skills_loaded': len(folders), 'indexed_documents': indexed,
                  'evidence_files': len(evidence), 'backend_ready': True, 'model_configured': model_configured,
                  'model_access_tested': False, 'agent_turns_started': 0, 'hpc_jobs_submitted': 0,
                  'upgraded_from': ', '.join(sorted(upgrade_sources)) if upgrade_sources else None,
                  'upgrade_sources': sorted(upgrade_sources)}
        local = self.root / '.local'
        local.mkdir(exist_ok=True)
        (local / 'setup-receipt.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
        self.print(f'Water4Energy setup complete: {len(folders)} skills, {indexed} indexed sources and saved April evidence.', flush=True)
        if not model_configured:
            self.print('For live chat, select a model and enter your own credentials in VISTA Settings. Then return here. No credentials are included in this ZIP.', flush=True)
        return report
