"""Exercise portable setup against an isolated fake VISTA, never the live backend."""
from __future__ import annotations

import base64
import copy
from email import policy
from email.parser import BytesParser
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import importlib.util
import io
import json
import os
from pathlib import Path
import shlex
import shutil
import subprocess
import sys
import tempfile
import threading
import unittest
from urllib.parse import unquote, urlsplit
from zipfile import ZipFile


PACKAGE = Path(__file__).resolve().parents[1]
PROJECT = "Water4Energy-TVA-agent-loop"
SLUG = "water4energy-tva-demo-2019"
OWNER = "water4energy-local-replay-20261112"
SKILLS = (
    "lab-literature", "lab-download", "lab-ledger", "lab-board",
    "lab-design", "lab-show-command", "lab-realize", "downscale-scorecard",
)


def load_setup_module():
    spec = importlib.util.spec_from_file_location("portable_setup_under_test", PACKAGE / "portable_setup.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")


def make_fixture(root):
    """Small fixture with the same installer contracts as the shipping payload."""
    backend = root / "backend"
    template = {
        "project": {
            "name": PROJECT,
            "description": "Pinned Water4Energy saved-evidence demonstration.",
            "system_prompt": "Use only the pinned replay references. Never submit a job.",
            "skills": [], "knowledge_bases": [],
            "tools": ["view", "run_bash", "create_file", "display_file", "rag_search"],
            "usage_limits": {"request_limit": 35},
        },
        "knowledge_base": {
            "slug": SLUG, "name": "Water4Energy demo lead sources",
            "description": "Pinned local demonstration sources.", "project": PROJECT,
        },
        "skill_owner": OWNER,
    }
    write_json(backend / "project.json", template)
    write_json(backend / "source-provenance.json", [])
    (backend / "sources").mkdir()
    for index, name in enumerate(SKILLS):
        folder = backend / "skills" / name
        folder.mkdir(parents=True)
        metadata = {"setup-owner": OWNER, "mode": "saved-file-replay"}
        body = "# " + name + "\n\nRead only the bundled saved evidence.\n"
        (folder / "SKILL.md").write_text(
            "---\nname: " + name + "\ndescription: " + json.dumps("Replay " + name)
            + "\nallowed_tools: view run_bash display_file\nmetadata: "
            + json.dumps(metadata) + "\n---\n\n" + body, encoding="utf-8")
    for index in range(6):
        path = backend / "lead-documents" / ("source_" + str(index) + ".md")
        path.parent.mkdir(exist_ok=True)
        path.write_text("# Pinned source " + str(index) + "\n\nOriginal saved evidence.\n", encoding="utf-8")
    png = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aP1sAAAAASUVORK5CYII=")
    files = {"evidence_" + str(i) + ".json": json.dumps({"record": i}).encode() for i in range(19)}
    files.update({
        "w4e-april-temperature.png": png,
        "w4e-april-precipitation.png": png,
        "w4e-april-runoff-receipt.png": png,
        "w4e-trial0-20190419-tp.png": png,
        "tva-demo-20190416-20190422.json": json.dumps({
            "schema_version": 1, "example_only": False,
            "case": {"start": "2019-04-16", "end": "2019-04-22", "issued": "2019-04-15"},
            "panels": {},
        }).encode(),
    })
    with ZipFile(backend / "evidence.zip", "w") as archive:
        for name, data in files.items():
            archive.writestr(name, data)
    write_json(backend / "evidence-manifest.json", {name: hashlib.sha256(data).hexdigest() for name, data in files.items()})


def multipart_parts(content_type, body):
    message = BytesParser(policy=policy.default).parsebytes(
        ("Content-Type: " + content_type + "\r\nMIME-Version: 1.0\r\n\r\n").encode() + body)
    parts = []
    for item in message.iter_parts():
        parts.append((item.get_param("name", header="content-disposition"),
                      item.get_filename(), item.get_payload(decode=True)))
    return parts


def skill_detail(folder):
    text = (folder / "SKILL.md").read_text(encoding="utf-8")
    front, body = text.split("---", 2)[1:]
    values = {}
    for line in front.splitlines():
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        value = value.strip()
        if value.startswith(("{", '"', "[")):
            value = json.loads(value)
        values[key] = value
    return dict(values, id="skill-" + folder.name, body=body.strip(), hpc_jobs=[])


class FakeVista:
    def __init__(self, root):
        self.root = root
        self.template = json.loads((root / "backend" / "project.json").read_text())
        self.project = None
        self.kb = None
        self.skills = {}
        self.skill_files = {}
        self.other_projects = []
        self.uploads = {}
        self.outputs = {}
        self.requests = []
        self.index_fails = False
        self.replace_fail_after = None
        self.replacement_count = 0
        self.has_credential = True
        self.expected_evidence = {}
        with ZipFile(root / "backend" / "evidence.zip") as archive:
            self.expected_evidence = {name: archive.read(name) for name in archive.namelist()}

    def matching_project(self):
        return dict(copy.deepcopy(self.template["project"]), id="11111111-2222-4333-8444-555555555555")

    def matching_kb(self):
        return dict(copy.deepcopy(self.template["knowledge_base"]), id="66666666-7777-4888-8999-000000000000",
                    publications=[], build_status="ready", pdfs_dir="/fake/kb", rag_db_path="/fake/rag")

    def start(self):
        fixture = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def reply(self, data, code=200):
                raw = data if isinstance(data, bytes) else json.dumps(data).encode()
                self.send_response(code)
                self.send_header("Content-Type", "application/octet-stream" if isinstance(data, bytes) else "application/json")
                self.send_header("Content-Length", str(len(raw)))
                self.end_headers()
                self.wfile.write(raw)

            def do_GET(self):
                path = unquote(urlsplit(self.path).path)
                fixture.requests.append(("GET", path, None))
                if path == "/openapi.json":
                    return self.reply({"openapi": "3.1.0", "info": {"title": "VISTA Backend", "version": "0.2.4"},
                                       "paths": {"/projects": {}, "/skills/import/upload": {}, "/knowledge-bases": {}, "/settings/inference": {}}})
                if path == "/settings/inference":
                    return self.reply({"provider": "custom", "model": "custom:demo-model", "has_credential": fixture.has_credential})
                if path == "/projects/" + PROJECT:
                    return self.reply(fixture.project if fixture.project is not None else {"detail": "Not found"}, 200 if fixture.project is not None else 404)
                if path == "/projects":
                    return self.reply(([fixture.project] if fixture.project else []) + fixture.other_projects)
                if path == "/knowledge-bases/" + SLUG:
                    return self.reply(fixture.kb if fixture.kb is not None else {"detail": "Not found"}, 200 if fixture.kb is not None else 404)
                if path.startswith("/skills/"):
                    name = path.rsplit("/", 1)[-1]
                    return self.reply(fixture.skills.get(name, {"detail": "Not found"}), 200 if name in fixture.skills else 404)
                if path == "/projects/" + PROJECT + "/outputs":
                    return self.reply([{"name": name, "size": len(data), "created": "2026-11-12T00:00:00Z", "modified": "2026-11-12T00:00:00Z"} for name, data in fixture.outputs.items()])
                if path.startswith("/projects/" + PROJECT + "/outputs/"):
                    name = path.split("/outputs/", 1)[1]
                    return self.reply(fixture.outputs.get(name, {"detail": "Not found"}), 200 if name in fixture.outputs else 404)
                return self.reply({"detail": "Unexpected route " + path}, 404)

            def do_POST(self):
                self.mutate("POST")

            def do_PUT(self):
                self.mutate("PUT")

            def mutate(self, method):
                path = unquote(urlsplit(self.path).path)
                raw = self.rfile.read(int(self.headers.get("Content-Length", "0")))
                content_type = self.headers.get("Content-Type", "")
                data = multipart_parts(content_type, raw) if content_type.startswith("multipart/") else json.loads(raw or b"{}")
                fixture.requests.append((method, path, data))
                if method == "POST" and path == "/projects":
                    fixture.project = dict(data, id="11111111-2222-4333-8444-555555555555")
                    return self.reply(fixture.project, 201)
                if method == "PUT" and path == "/projects/" + PROJECT:
                    fixture.project.update(data)
                    return self.reply(fixture.project)
                if method == "POST" and path == "/knowledge-bases":
                    fixture.kb = dict(data, id="66666666-7777-4888-8999-000000000000", publications=[], build_status="pending", pdfs_dir="/fake/kb", rag_db_path="/fake/rag")
                    if data.get("project") == PROJECT:
                        fixture.project["knowledge_bases"] = [SLUG]
                    return self.reply(fixture.kb, 201)
                if method == "POST" and path == "/skills/import/upload":
                    paths = [value.decode() for field, _, value in data if field == "paths"]
                    files = [value for field, _, value in data if field == "files"]
                    text = files[paths.index("SKILL.md")].decode()
                    front, body = text.split("---", 2)[1:]
                    values = {}
                    for line in front.splitlines():
                        if ":" in line:
                            key, value = line.split(":", 1)
                            value = value.strip()
                            values[key] = json.loads(value) if value.startswith(("{", '"', "[")) else value
                    name = values["name"]
                    item = dict(values, id="skill-" + name, body=body.strip(), hpc_jobs=[])
                    fixture.skills[name] = item
                    fixture.skill_files[name] = dict(zip(paths, files))
                    if any(field == "project" and value.decode() == PROJECT for field, _, value in data):
                        fixture.project["skills"] = list(dict.fromkeys(fixture.project["skills"] + [name]))
                    return self.reply(item, 201)
                if method == "POST" and path == "/knowledge-bases/" + SLUG + "/publications":
                    for field, name, value in data:
                        if field == "files":
                            fixture.kb["publications"].append({"filename": name, "has_pdf": True, "size": len(value),
                                "index_status": "failed" if fixture.index_fails else "indexed", "index_error": "Fixture index failed" if fixture.index_fails else None})
                    fixture.kb["build_status"] = "failed" if fixture.index_fails else "ready"
                    return self.reply(fixture.kb, 201)
                if method == "POST" and path == "/projects/" + PROJECT + "/uploads":
                    names = []
                    for field, name, value in data:
                        if field == "files":
                            fixture.uploads[name] = value
                            names.append(name)
                    return self.reply(names)
                if method == "POST" and path == "/projects/" + PROJECT + "/mcp/call":
                    if data.get("name") != "run_bash":
                        return self.reply({"isError": True, "content": [{"type": "text", "text": "Unexpected tool"}]})
                    sandbox = fixture.root / ".fake-sandbox"
                    if sandbox.exists():
                        shutil.rmtree(sandbox)
                    uploads = sandbox / "data/uploads"
                    output = sandbox / "data/output"
                    uploads.mkdir(parents=True)
                    output.mkdir(parents=True)
                    for name, value in fixture.uploads.items():
                        (uploads / name).write_bytes(value)
                    for name, value in fixture.outputs.items():
                        path = output / name
                        path.parent.mkdir(parents=True, exist_ok=True)
                        path.write_bytes(value)
                    for name in (fixture.project or {}).get("skills", []):
                        files = fixture.skill_files.get(name)
                        if files is None:
                            folder = fixture.root / "backend/skills" / name
                            files = {p.relative_to(folder).as_posix(): p.read_bytes() for p in folder.rglob("*") if p.is_file()}
                        for relative, value in files.items():
                            path = sandbox / "skills" / name / relative
                            path.parent.mkdir(parents=True, exist_ok=True)
                            path.write_bytes(value)
                    command = shlex.split(data["arguments"]["command"])
                    if command[:2] != ["python3", "-c"] or len(command) != 3:
                        return self.reply({"isError": True, "content": [{"type": "text", "text": "Unexpected shell command"}]})
                    script = command[2].replace("/mnt/data", str(sandbox / "data")).replace("/mnt/skills", str(sandbox / "skills"))
                    result = subprocess.run([sys.executable, "-c", script], capture_output=True, text=True, timeout=30)
                    fixture.outputs = {p.relative_to(output).as_posix(): p.read_bytes() for p in output.rglob("*") if p.is_file()}
                    return self.reply({"isError": result.returncode != 0, "content": [{"type": "text", "text": result.stdout + result.stderr}]})
                if method == "POST" and path == "/projects/" + PROJECT + "/skills/from-output":
                    if fixture.replace_fail_after is not None and fixture.replacement_count >= fixture.replace_fail_after:
                        return self.reply({"detail": "Simulated interrupted upgrade"}, 503)
                    prefix = data["folder"] + "/"
                    files = {name[len(prefix):]: value for name, value in fixture.outputs.items() if name.startswith(prefix)}
                    folder = fixture.root / ".fake-sandbox/data/output" / data["folder"]
                    item = skill_detail(folder)
                    fixture.skills[item["name"]] = item
                    fixture.skill_files[item["name"]] = files
                    fixture.replacement_count += 1
                    return self.reply(item, 201)
                return self.reply({"detail": "Unexpected mutation " + path}, 404)

        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()
        self.url = "http://127.0.0.1:" + str(self.httpd.server_port)
        return self

    def close(self):
        self.httpd.shutdown()
        self.httpd.server_close()
        self.thread.join(timeout=2)


class PortableSetupTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="w4e-install-test-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name) / "Extracted Water4Energy"
        self.root.mkdir()
        real_root = os.environ.get("W4E_BUNDLE_TEST_ROOT")
        if real_root:
            shutil.copytree(Path(real_root) / "backend", self.root / "backend")
        else:
            make_fixture(self.root)
        self.module = load_setup_module()
        self.fake = FakeVista(self.root).start()
        self.addCleanup(self.fake.close)
        self.messages = []

    def run_setup(self, timeout=2):
        return self.module.Setup(self.root, self.fake.url, timeout=timeout,
                                 printer=lambda message, **kwargs: self.messages.append(message)).run()

    def assert_no_agent_or_job(self):
        for method, path, _ in self.fake.requests:
            self.assertNotIn("/agent/", path)
            self.assertNotIn("/jobs", path)
            self.assertNotEqual(path, "/settings", "Installer must not read or alter credential settings")

    def test_fresh_setup_imports_indexes_stages_and_reports(self):
        report = self.run_setup()
        self.assertTrue(report["backend_ready"])
        self.assertTrue(report["model_configured"])
        self.assertEqual(report["agent_turns_started"], 0)
        self.assertEqual(report["hpc_jobs_submitted"], 0)
        self.assertEqual(set(self.fake.project["skills"]), set(SKILLS))
        self.assertEqual(self.fake.project["knowledge_bases"], [SLUG])
        self.assertEqual(len(self.fake.kb["publications"]), len(list((self.root / 'backend/lead-documents').iterdir())))
        self.assertEqual(self.fake.outputs, self.fake.expected_evidence)
        self.assert_no_agent_or_job()

    def test_rerun_does_not_reimport_reupload_or_restamp_evidence(self):
        self.run_setup()
        self.fake.requests.clear()
        report = self.run_setup()
        self.assertTrue(report["backend_ready"])
        self.assertFalse([path for method, path, _ in self.fake.requests if method == "POST"])
        self.assertEqual(self.fake.outputs, self.fake.expected_evidence)
        self.assert_no_agent_or_job()

    def test_owned_existing_skill_is_attached_to_fresh_project(self):
        name = SKILLS[0]
        self.fake.skills[name] = skill_detail(self.root / "backend" / "skills" / name)
        self.run_setup()
        self.assertIn(name, self.fake.project["skills"])
        imports = [data for method, path, data in self.fake.requests if path == "/skills/import/upload"]
        self.assertEqual(len(imports), len(SKILLS) - 1)

    def test_matching_project_without_local_state_is_safely_adopted(self):
        self.fake.project = self.fake.matching_project()
        original_id = self.fake.project["id"]
        report = self.run_setup()
        self.assertTrue(report["backend_ready"])
        self.assertEqual(self.fake.project["id"], original_id)
        self.assertFalse([path for method, path, _ in self.fake.requests if method == "POST" and path == "/projects"])
        self.assertEqual(set(self.fake.project["skills"]), set(SKILLS))

    def test_api_expanded_usage_limit_defaults_are_compatible(self):
        self.fake.project = self.fake.matching_project()
        self.fake.project["usage_limits"].update({
            "tool_calls_limit": None, "input_tokens_limit": None,
            "output_tokens_limit": None, "total_tokens_limit": None,
            "count_tokens_before_request": False,
        })
        report = self.run_setup()
        self.assertTrue(report["backend_ready"])
        self.assertEqual(self.fake.project["usage_limits"]["request_limit"], 35)
        self.assert_no_agent_or_job()

    def test_foreign_project_is_refused_without_overwrite(self):
        self.fake.project = self.fake.matching_project()
        self.fake.project["system_prompt"] = "A different owner's existing project"
        original = copy.deepcopy(self.fake.project)
        with self.assertRaises(self.module.SetupError):
            self.run_setup()
        self.assertEqual(self.fake.project, original)
        self.assertFalse([path for method, path, _ in self.fake.requests if method != "GET"])

    def test_foreign_global_skill_is_not_replaced(self):
        name = SKILLS[0]
        self.fake.skills[name] = skill_detail(self.root / "backend" / "skills" / name)
        self.fake.skills[name]["metadata"]["setup-owner"] = "another-owner"
        original = copy.deepcopy(self.fake.skills[name])
        with self.assertRaises(self.module.SetupError):
            self.run_setup()
        self.assertEqual(self.fake.skills[name], original)
        self.assertNotIn(name, (self.fake.project or {}).get("skills", []))

    def test_owned_but_edited_skill_is_not_silently_replaced(self):
        name = SKILLS[0]
        self.fake.skills[name] = skill_detail(self.root / "backend" / "skills" / name)
        self.fake.skills[name]["body"] += "\nA local scientific change."
        original = copy.deepcopy(self.fake.skills[name])
        with self.assertRaises(self.module.SetupError):
            self.run_setup()
        self.assertEqual(self.fake.skills[name], original)

    def test_foreign_knowledge_base_is_not_attached_or_changed(self):
        self.fake.kb = self.fake.matching_kb()
        self.fake.kb["description"] = "A different owner's existing knowledge base"
        original = copy.deepcopy(self.fake.kb)
        with self.assertRaises(self.module.SetupError):
            self.run_setup()
        self.assertEqual(self.fake.kb, original)
        self.assertNotIn(SLUG, (self.fake.project or {}).get("knowledge_bases", []))

    def test_failed_index_is_not_reported_ready(self):
        self.fake.index_fails = True
        with self.assertRaises(self.module.SetupError):
            self.run_setup()
        self.assertFalse([path for method, path, _ in self.fake.requests if path.endswith("/mcp/call")])

    def test_different_existing_evidence_is_not_overwritten(self):
        name = next(iter(self.fake.expected_evidence))
        self.fake.outputs[name] = b"Different pre-existing scientific result"
        with self.assertRaises(self.module.SetupError):
            self.run_setup()
        self.assertEqual(self.fake.outputs[name], b"Different pre-existing scientific result")

    def test_missing_model_credential_keeps_backend_ready_and_reports_requirement(self):
        self.fake.has_credential = False
        report = self.run_setup()
        self.assertTrue(report["backend_ready"])
        self.assertFalse(report["model_configured"])
        self.assert_no_agent_or_job()

    def test_tampered_evidence_is_rejected_before_api_mutation(self):
        manifest = self.root / "backend" / "evidence-manifest.json"
        data = json.loads(manifest.read_text())
        data[next(iter(data))] = "0" * 64
        write_json(manifest, data)
        with self.assertRaises(self.module.SetupError):
            self.run_setup()
        self.assertFalse([path for method, path, _ in self.fake.requests if method != "GET"])

    def prepare_real_copier(self, name):
        """Use the generated copier verbatim, changing only its sandbox mount path."""
        self.run_setup()
        calls = [data for method, path, data in self.fake.requests if path.endswith("/mcp/call")]
        self.assertEqual(len(calls), 1)
        arguments = shlex.split(calls[0]["arguments"]["command"])
        self.assertEqual(arguments[:2], ["python3", "-c"])
        self.assertEqual(len(arguments), 3)
        sandbox = Path(self.temporary.name) / name
        uploads = sandbox / "data" / "uploads"
        uploads.mkdir(parents=True)
        for upload_name, data in self.fake.uploads.items():
            (uploads / upload_name).write_bytes(data)
        output = sandbox / "data" / "output"
        output.mkdir()
        script = arguments[2].replace("/mnt/data", str(sandbox / "data"))
        return script, output

    def run_real_copier(self, script):
        return subprocess.run([sys.executable, "-c", script],
                              capture_output=True, text=True, timeout=20)

    def test_generated_copier_preserves_identical_file_timestamps(self):
        script, output = self.prepare_real_copier("Copier sandbox with spaces")
        first_name, first_bytes = next(iter(self.fake.expected_evidence.items()))
        existing = output / first_name
        existing.write_bytes(first_bytes)
        os.utime(existing, ns=(1_600_000_000_123_456_789, 1_600_000_000_123_456_789))
        before = existing.stat().st_mtime_ns
        result = self.run_real_copier(script)
        self.assertEqual(result.returncode, 0, result.stderr)
        summary = json.loads(result.stdout)
        self.assertEqual(summary["copied"], len(self.fake.expected_evidence) - 1)
        self.assertEqual(summary["verified"], len(self.fake.expected_evidence))
        self.assertEqual(existing.stat().st_mtime_ns, before)
        self.assertEqual({p.name: p.read_bytes() for p in output.iterdir()}, self.fake.expected_evidence)
        timestamps = {p.name: p.stat().st_mtime_ns for p in output.iterdir()}
        rerun = self.run_real_copier(script)
        self.assertEqual(rerun.returncode, 0, rerun.stderr)
        self.assertEqual(json.loads(rerun.stdout)["copied"], 0)
        self.assertEqual({p.name: p.stat().st_mtime_ns for p in output.iterdir()}, timestamps)

    def test_generated_copier_refuses_conflict_before_any_new_write(self):
        script, output = self.prepare_real_copier("Conflicting copier sandbox")
        # Put the conflict last so a copier that writes incrementally would be caught.
        name = list(self.fake.expected_evidence)[-1]
        conflict = output / name
        conflict.write_bytes(b"Existing different scientific evidence")
        timestamp = conflict.stat().st_mtime_ns
        result = self.run_real_copier(script)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Output conflict", result.stderr)
        self.assertEqual([p.name for p in output.iterdir()], [name])
        self.assertEqual(conflict.read_bytes(), b"Existing different scientific evidence")
        self.assertEqual(conflict.stat().st_mtime_ns, timestamp)

    def install_legacy_fixture(self, version='0.13.1'):
        """Populate a real old install without relying on this folder's local state."""
        backend = self.root / 'backend'
        slug = 'v' + version.replace('.', '')
        migration_path = backend / 'migrations' / (slug + '.json')
        vault = backend / 'migrations' / (slug + '-original-files.zip')
        if not migration_path.exists():
            migration_path.parent.mkdir(exist_ok=True)
            project = copy.deepcopy(self.fake.template['project'])
            project['system_prompt'] = 'Previous Water4Energy replay policy ' + version + '.'
            migration = {'version': version, 'project': project, 'skills': {}}
            with ZipFile(vault, 'w') as archive:
                for name in SKILLS:
                    folder = backend / 'skills' / name
                    files = {p.relative_to(folder).as_posix(): p.read_bytes() for p in folder.rglob('*') if p.is_file()}
                    text = files['SKILL.md'].decode()
                    front = text.split('---', 2)[1]
                    metadata = json.loads(next(line.split(':', 1)[1].strip() for line in front.splitlines() if line.startswith('metadata:')))
                    metadata['replay-version'] = version
                    front = '\n'.join('metadata: ' + json.dumps(metadata) if line.startswith('metadata:') else line for line in front.splitlines()) + '\n'
                    files['SKILL.md'] = ('---' + front + '---\n\n# Legacy ' + version + ' ' + name + '\n\nPrevious saved-file reader.\n').encode()
                    files['scripts/replay.py'] = ('print("old saved-file replay ' + version + '")\n').encode()
                    body = files['SKILL.md'].decode().split('---', 2)[2].strip()
                    migration['skills'][name] = {'metadata': metadata, 'body_sha256': hashlib.sha256(body.encode()).hexdigest(),
                        'files': {relative: hashlib.sha256(value).hexdigest() for relative, value in files.items()}}
                    for relative, value in files.items():
                        archive.writestr(name + '/' + relative, value)
            migration['original_files_archive_sha256'] = hashlib.sha256(vault.read_bytes()).hexdigest()
            write_json(migration_path, migration)
        migration = json.loads(migration_path.read_text())
        self.fake.project = dict(copy.deepcopy(migration['project']), id='11111111-2222-4333-8444-555555555555',
                                 skills=list(SKILLS), knowledge_bases=[SLUG])
        self.fake.kb = self.fake.matching_kb()
        old_docs = migration.get('lead_documents')
        if old_docs is None:
            old_docs = [p.name for p in (backend / 'lead-documents').iterdir()
                        if p.name != 'TVA_demo_answer_guide.md' and '0140' not in p.name and 'HEADWATER_demo' not in p.name]
        self.fake.kb['publications'] = [{'filename': name, 'index_status': 'indexed'} for name in old_docs]
        with ZipFile(vault) as archive:
            for name, old in migration['skills'].items():
                files = {}
                for relative, sha in old['files'].items():
                    key = name + '/' + relative
                    entry = migration.get('original_file_entries', {}).get(key, key)
                    value = archive.read(entry) if entry in archive.namelist() else (backend / 'skills' / name / relative).read_bytes()
                    self.assertEqual(hashlib.sha256(value).hexdigest(), sha)
                    files[relative] = value
                legacy = self.root / '.legacy-source' / version / name
                legacy.mkdir(parents=True, exist_ok=True)
                (legacy / 'SKILL.md').write_bytes(files['SKILL.md'])
                self.fake.skills[name] = skill_detail(legacy)
                self.fake.skill_files[name] = files
        old_evidence = migration.get('evidence', self.fake.expected_evidence)
        self.fake.outputs = {name: self.fake.expected_evidence[name] for name in old_evidence}
        self.fake.outputs['user-result.csv'] = b'week,inflow\n2019-04-16,12\n'
        return migration

    def test_known_v0131_upgrade_replaces_complete_owned_skill_folders_and_backs_up(self):
        migration = self.install_legacy_fixture()
        original_id = self.fake.project['id']
        report = self.run_setup()
        self.assertEqual(report['upgraded_from'], '0.13.1')
        self.assertEqual(self.fake.project['id'], original_id)
        self.assertEqual(self.fake.project['system_prompt'], self.fake.template['project']['system_prompt'])
        for name in SKILLS:
            folder = self.root / 'backend/skills' / name
            wanted = {p.relative_to(folder).as_posix(): p.read_bytes() for p in folder.rglob('*') if p.is_file()}
            self.assertEqual(self.fake.skill_files[name], wanted)
        replacements = [data for method, path, data in self.fake.requests if path.endswith('/skills/from-output')]
        self.assertEqual(len(replacements), 8)
        self.assertTrue(all(data['replace'] is True for data in replacements))
        self.assertEqual(self.fake.outputs['user-result.csv'], b'week,inflow\n2019-04-16,12\n')
        self.assertFalse(any(name.startswith('w4e-v' + self.module.VERSION.replace('.', '') + '-') and '/' in name for name in self.fake.outputs))
        backups = list((self.root / '.local/upgrade-backups').glob('*/original-skills.zip'))
        self.assertEqual(len(backups), 1)
        with ZipFile(backups[0]) as archive:
            for name, old in migration['skills'].items():
                for relative, sha in old['files'].items():
                    self.assertEqual(hashlib.sha256(archive.read(name + '/' + relative)).hexdigest(), sha)
        self.fake.requests.clear()
        self.run_setup()
        self.assertFalse([path for method, path, _ in self.fake.requests if method != 'GET'])
        self.assert_no_agent_or_job()

    def test_old_skill_with_local_script_change_is_preserved_before_policy_upgrade(self):
        self.install_legacy_fixture()
        name = SKILLS[0]
        self.fake.skill_files[name]['scripts/replay.py'] += b'\n# A local scientific change\n'
        before = copy.deepcopy(self.fake.project)
        with self.assertRaises(self.module.SetupError):
            self.run_setup()
        self.assertEqual(self.fake.project, before)
        self.assertFalse([path for method, path, _ in self.fake.requests if method == 'PUT' or path.endswith('/skills/from-output')])
        self.assertTrue(self.fake.skill_files[name]['scripts/replay.py'].endswith(b'# A local scientific change\n'))

    def test_shared_legacy_global_skill_is_preserved_before_any_replacement(self):
        self.install_legacy_fixture()
        self.fake.other_projects = [{'name': 'Other-science-project', 'skills': [SKILLS[0]]}]
        with self.assertRaises(self.module.SetupError):
            self.run_setup()
        self.assertFalse([path for method, path, _ in self.fake.requests if method != 'GET'])

    def test_partial_known_upgrade_can_resume_without_replacing_finished_skill(self):
        self.install_legacy_fixture()
        name = SKILLS[0]
        folder = self.root / 'backend/skills' / name
        self.fake.skills[name] = skill_detail(folder)
        self.fake.skill_files[name] = {p.relative_to(folder).as_posix(): p.read_bytes() for p in folder.rglob('*') if p.is_file()}
        report = self.run_setup()
        self.assertEqual(report['upgraded_from'], '0.13.1')
        replacements = [data for method, path, data in self.fake.requests if path.endswith('/skills/from-output')]
        self.assertEqual(len(replacements), 7)
        self.assertFalse(any('-' + name + '-' in data['folder'] for data in replacements))

    def test_known_v0132_upgrade_preserves_evidence_and_backs_up_every_old_file(self):
        migration = self.install_legacy_fixture('0.13.2')
        original_outputs = dict(self.fake.outputs)
        original_id = self.fake.project['id']
        report = self.run_setup()
        self.assertEqual(report['upgraded_from'], '0.13.2')
        self.assertEqual(report['upgrade_sources'], ['0.13.2'])
        self.assertEqual(self.fake.project['id'], original_id)
        self.assertEqual(report['interface_version'], self.module.VERSION)
        for name, data in original_outputs.items():
            self.assertEqual(self.fake.outputs[name], data)
        replacements = [data for method, path, data in self.fake.requests if path.endswith('/skills/from-output')]
        self.assertEqual(len(replacements), 8)
        self.assertTrue(all(data['folder'].startswith('w4e-v' + self.module.VERSION.replace('.', '') + '-') for data in replacements))
        backups = list((self.root / '.local/upgrade-backups').glob('v0132-*/original-skills.zip'))
        self.assertEqual(len(backups), 1)
        with ZipFile(backups[0]) as archive:
            for name, old in migration['skills'].items():
                for relative, sha in old['files'].items():
                    self.assertEqual(hashlib.sha256(archive.read(name + '/' + relative)).hexdigest(), sha)
        self.fake.requests.clear()
        self.run_setup()
        self.assertFalse([path for method, path, _ in self.fake.requests if method != 'GET'])
        self.assert_no_agent_or_job()

    def test_v0132_extra_local_file_is_preserved_before_policy_upgrade(self):
        self.install_legacy_fixture('0.13.2')
        name = SKILLS[0]
        self.fake.skill_files[name]['local-science-note.txt'] = b'A local change to preserve.'
        project = copy.deepcopy(self.fake.project)
        with self.assertRaises(self.module.SetupError):
            self.run_setup()
        self.assertEqual(self.fake.project, project)
        self.assertFalse([path for method, path, _ in self.fake.requests if method == 'PUT' or path.endswith('/skills/from-output')])
        self.assertEqual(self.fake.skill_files[name]['local-science-note.txt'], b'A local change to preserve.')

    def test_v0132_partial_upgrade_with_current_policy_resumes_seven_old_skills(self):
        self.install_legacy_fixture('0.13.2')
        self.fake.project.update({key: copy.deepcopy(self.fake.template['project'][key])
                                  for key in ['system_prompt', 'description', 'tools', 'usage_limits']})
        name = SKILLS[0]
        folder = self.root / 'backend/skills' / name
        self.fake.skills[name] = skill_detail(folder)
        self.fake.skill_files[name] = {p.relative_to(folder).as_posix(): p.read_bytes() for p in folder.rglob('*') if p.is_file()}
        report = self.run_setup()
        self.assertEqual(report['upgraded_from'], '0.13.2')
        replacements = [data for method, path, data in self.fake.requests if path.endswith('/skills/from-output')]
        self.assertEqual(len(replacements), 7)
        self.assertFalse(any('-' + name + '-' in data['folder'] for data in replacements))

    def test_mixed_known_v0131_and_v0132_skills_get_separate_complete_backups(self):
        first = self.install_legacy_fixture('0.13.1')
        first_skills = copy.deepcopy(self.fake.skills)
        first_files = copy.deepcopy(self.fake.skill_files)
        second = self.install_legacy_fixture('0.13.2')
        for name in SKILLS[:4]:
            self.fake.skills[name] = first_skills[name]
            self.fake.skill_files[name] = first_files[name]
        report = self.run_setup()
        self.assertEqual(report['upgrade_sources'], ['0.13.1', '0.13.2'])
        backups = list((self.root / '.local/upgrade-backups').glob('*/original-skills.zip'))
        self.assertEqual(len(backups), 2)
        for path in backups:
            version = '0.13.1' if path.parent.name.startswith('v0131-') else '0.13.2'
            baseline = first if version == '0.13.1' else second
            names = SKILLS[:4] if version == '0.13.1' else SKILLS[4:]
            with ZipFile(path) as archive:
                for name in names:
                    for relative, sha in baseline['skills'][name]['files'].items():
                        self.assertEqual(hashlib.sha256(archive.read(name + '/' + relative)).hexdigest(), sha)
        self.assert_no_agent_or_job()

    def test_v0140_backend_from_v0140_or_v0141_interface_has_complete_backup_and_idempotence(self):
        migration = self.install_legacy_fixture('0.14.0')
        original_outputs = dict(self.fake.outputs)
        self.fake.outputs['w4e-v0140-headwater-history.csv'] = b'date,record\n2026-10-26,saved ledger\n'
        report = self.run_setup()
        self.assertEqual(report['upgrade_sources'], ['0.14.0'])
        self.assertEqual(report['interface_version'], self.module.VERSION)
        self.assertEqual(self.fake.replacement_count, 8)
        for name, data in original_outputs.items():
            self.assertEqual(self.fake.outputs[name], data)
        self.assertEqual(self.fake.outputs['w4e-v0140-headwater-history.csv'], b'date,record\n2026-10-26,saved ledger\n')
        backups = list((self.root / '.local/upgrade-backups').glob('v0140-*/original-skills.zip'))
        self.assertEqual(len(backups), 1)
        with ZipFile(backups[0]) as archive:
            for name, old in migration['skills'].items():
                for relative, sha in old['files'].items():
                    self.assertEqual(hashlib.sha256(archive.read(name + '/' + relative)).hexdigest(), sha)
        self.fake.requests.clear()
        self.run_setup()
        self.assertFalse([path for method, path, _ in self.fake.requests if method != 'GET'])
        self.assert_no_agent_or_job()

    def test_v0140_interruption_resumes_without_replacing_finished_skills_or_original_backup(self):
        migration = self.install_legacy_fixture('0.14.0')
        self.fake.replace_fail_after = 2
        with self.assertRaises(self.module.SetupError):
            self.run_setup()
        self.assertEqual(self.fake.replacement_count, 2)
        backup = next((self.root / '.local/upgrade-backups').glob('v0140-*/original-skills.zip'))
        saved_backup = backup.read_bytes()
        with ZipFile(backup) as archive:
            self.assertEqual(len(archive.namelist()), sum(len(old['files']) for old in migration['skills'].values()))
        self.fake.replace_fail_after = None
        self.fake.requests.clear()
        report = self.run_setup()
        self.assertEqual(report['upgraded_from'], '0.14.0')
        self.assertEqual(self.fake.replacement_count, 8)
        self.assertEqual(len([path for method, path, _ in self.fake.requests if path.endswith('/skills/from-output')]), 6)
        self.assertEqual(backup.read_bytes(), saved_backup)
        self.assert_no_agent_or_job()

    def test_v0140_local_file_change_is_refused_before_policy_upgrade(self):
        self.install_legacy_fixture('0.14.0')
        name = SKILLS[0]
        self.fake.skill_files[name]['scripts/replay.py'] += b'\n# Locally edited reader\n'
        project = copy.deepcopy(self.fake.project)
        with self.assertRaises(self.module.SetupError):
            self.run_setup()
        self.assertEqual(self.fake.project, project)
        self.assertFalse([path for method, path, _ in self.fake.requests if method == 'PUT' or path.endswith('/skills/from-output')])
        self.assertTrue(self.fake.skill_files[name]['scripts/replay.py'].endswith(b'# Locally edited reader\n'))

    def test_v0140_shared_global_skill_is_not_replaced(self):
        self.install_legacy_fixture('0.14.0')
        self.fake.other_projects = [{'name': 'Another research project', 'skills': [SKILLS[0]]}]
        with self.assertRaises(self.module.SetupError):
            self.run_setup()
        self.assertFalse([path for method, path, _ in self.fake.requests if method != 'GET'])

    def test_v0140_resume_refuses_damaged_original_backup(self):
        self.install_legacy_fixture('0.14.0')
        self.fake.replace_fail_after = 1
        with self.assertRaises(self.module.SetupError):
            self.run_setup()
        backup = next((self.root / '.local/upgrade-backups').glob('v0140-*/original-skills.zip'))
        backup.write_bytes(b'Damaged local backup; preserve for inspection')
        self.fake.replace_fail_after = None
        self.fake.requests.clear()
        with self.assertRaises(self.module.SetupError):
            self.run_setup()
        self.assertEqual(self.fake.replacement_count, 1)
        self.assertEqual(backup.read_bytes(), b'Damaged local backup; preserve for inspection')
        self.assertFalse([path for method, path, _ in self.fake.requests if method == 'PUT' or path.endswith('/skills/from-output')])

    def test_three_known_backend_versions_and_current_skills_can_resume_together(self):
        versions = {}
        for version in ['0.13.1', '0.13.2', '0.14.0']:
            self.install_legacy_fixture(version)
            versions[version] = (copy.deepcopy(self.fake.skills), copy.deepcopy(self.fake.skill_files))
        expected = {'0.13.1': SKILLS[:2], '0.13.2': SKILLS[2:4], '0.14.0': SKILLS[4:7]}
        for version, names in expected.items():
            skills, files = versions[version]
            for name in names:
                self.fake.skills[name] = skills[name]
                self.fake.skill_files[name] = files[name]
        current = SKILLS[7]
        folder = self.root / 'backend/skills' / current
        self.fake.skills[current] = skill_detail(folder)
        self.fake.skill_files[current] = {p.relative_to(folder).as_posix(): p.read_bytes() for p in folder.rglob('*') if p.is_file()}
        report = self.run_setup()
        self.assertEqual(report['upgrade_sources'], ['0.13.1', '0.13.2', '0.14.0'])
        self.assertEqual(self.fake.replacement_count, 7)
        backups = list((self.root / '.local/upgrade-backups').glob('*/original-skills.zip'))
        self.assertEqual(len(backups), 3)
        for backup in backups:
            version = next(version for version in expected if backup.parent.name.startswith('v' + version.replace('.', '') + '-'))
            with ZipFile(backup) as archive:
                self.assertEqual({name.split('/', 1)[0] for name in archive.namelist()}, set(expected[version]))
                for key in archive.namelist():
                    name, relative = key.split('/', 1)
                    self.assertEqual(archive.read(key), versions[version][1][name][relative])
        self.assert_no_agent_or_job()


if __name__ == "__main__":
    unittest.main()
