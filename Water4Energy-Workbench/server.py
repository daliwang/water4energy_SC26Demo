#!/usr/bin/env python3
"""Water4Energy workbench: dependency-free local web server and scoped VISTA proxy.

Python 3.9+. Does not start VISTA, handle credentials, or submit jobs on startup.
"""
import argparse
import concurrent.futures
import errno
import hashlib
import http.client
import ipaddress
import json
import mimetypes
import os
from pathlib import Path
import re
import socket
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, quote, unquote, urlsplit
import webbrowser

APP_ROOT = Path(__file__).resolve().parent
VERSION = "0.15.1"
MAX_BODY = 64 * 1024 * 1024
DEFAULT_CONFIG = {"backend_url": "http://127.0.0.1:8001", "project": "Water4Energy-TVA-agent-loop"}
PROJECT_PATTERN = re.compile(r"[A-Za-z0-9_ .-]{2,80}\Z")
SESSION = r"[0-9a-fA-F-]{36}"


def workbench_identity(root):
    """Opaque identity for this folder and backend/release build, never its path."""
    root = Path(root).resolve()
    digest = hashlib.sha256((str(root) + "\n" + VERSION).encode("utf-8"))
    for name in ("server.py", "MANIFEST.sha256"):
        try:
            digest.update((root / name).read_bytes())
        except OSError:
            digest.update(("missing:" + name).encode("ascii"))
    return digest.hexdigest()


def connection_identity(config):
    return hashlib.sha256(json.dumps(config, sort_keys=True).encode("utf-8")).hexdigest()


def valid_backend(value):
    """Allow literal loopback HTTP endpoints only, with no redirect following."""
    if not isinstance(value, str):
        raise ValueError("Backend URL must be text.")
    parsed = urlsplit(value)
    if parsed.scheme != "http" or parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path not in ("", "/"):
        raise ValueError("Use a local HTTP backend such as http://127.0.0.1:8001.")
    host = parsed.hostname
    try:
        loopback = host == "localhost" or ipaddress.ip_address(host).is_loopback
        port = parsed.port or 80
    except (ValueError, TypeError):
        raise ValueError("The VISTA backend must use localhost or a loopback IP address.")
    if not loopback or not 1 <= port <= 65535:
        raise ValueError("The VISTA backend must use a loopback address and a valid port.")
    return "http://{}:{}".format("[{}]".format(host) if ":" in host else host, port)


class AppState:
    def __init__(self, root=APP_ROOT, backend_url=None, project=None, persist=True):
        self.root = Path(root)
        self.public = self.root / "public"
        self.config_file = self.root / ".local" / "config.json"
        self.lock = threading.RLock()
        self.persist = persist
        self.status_cache = None
        self.status_at = 0
        self.skills_cache = None
        self.skills_at = 0
        self.knowledge_cache = None
        self.knowledge_at = 0
        self.instance_id = workbench_identity(self.root)
        self.config = dict(DEFAULT_CONFIG)
        try:
            saved = json.loads(self.config_file.read_text(encoding="utf-8"))
            self.config.update(self.validate(saved))
        except (OSError, ValueError, TypeError):
            pass
        if backend_url:
            self.config["backend_url"] = valid_backend(backend_url)
        if project:
            self.config.update(self.validate({"project": project}))

    @staticmethod
    def validate(payload):
        if not isinstance(payload, dict) or set(payload) - {"backend_url", "project"}:
            raise ValueError("Only backend_url and project can be configured.")
        output = {}
        if "backend_url" in payload:
            output["backend_url"] = valid_backend(payload["backend_url"])
        if "project" in payload:
            project = payload["project"]
            if not isinstance(project, str) or not PROJECT_PATTERN.fullmatch(project) or project in ("..", "."):
                raise ValueError("Project names must be 2–80 letters, digits, spaces, dots, hyphens or underscores.")
            output["project"] = project
        return output

    def snapshot(self):
        with self.lock:
            return dict(self.config)

    def update(self, payload):
        validated = self.validate(payload)
        with self.lock:
            updated = dict(self.config, **validated)
            if self.persist:
                self.config_file.parent.mkdir(parents=True, exist_ok=True)
                temporary = self.config_file.with_suffix(".tmp")
                temporary.write_text(json.dumps(updated, indent=2) + "\n", encoding="utf-8")
                os.chmod(str(temporary), 0o600)
                temporary.replace(self.config_file)
            self.config = updated
            self.status_cache = None
            self.skills_cache = None
            self.knowledge_cache = None
            return dict(updated)

    def request_json(self, path, timeout=5, config=None):
        config = config or self.snapshot()
        target = urlsplit(config["backend_url"])
        connection = http.client.HTTPConnection(target.hostname, target.port, timeout=timeout)
        try:
            connection.request("GET", path, headers={"Accept": "application/json"})
            response = connection.getresponse()
            data = response.read(2 * 1024 * 1024)
            if response.status >= 300:
                return response.status, None
            return response.status, json.loads(data)
        finally:
            connection.close()

    def status(self, fresh=False):
        with self.lock:
            if not fresh and self.status_cache and time.monotonic() - self.status_at < 15:
                return dict(self.status_cache)
        config = self.snapshot()
        result = dict(config, app="tva-workbench", version=VERSION, connected=False,
                      project_found=False, skills=[], resources=[], detail="Open VISTA to connect its local backend.")
        defaults = [{"id": key, "name": name, "state": "unknown", "message": "Connect VISTA to check availability.", "checked_at": None, "planned": False}
                    for key, name in (("odo", "Odo"), ("frontier", "Frontier"), ("lux", "Lux"))]
        try:
            status, project = self.request_json("/projects/" + quote(config["project"], safe=""), timeout=3, config=config)
            result["connected"] = status < 500
            result["project_found"] = status == 200 and isinstance(project, dict)
            if result["project_found"]:
                result["skills"] = project.get("skills", [])
                result["detail"] = "Connected to the selected VISTA project. Cluster readiness does not verify a TVA job environment."
            else:
                result["detail"] = "VISTA responded, but this project was not found. Check the project name in Connection."
            try:
                # A nonsecret endpoint specifically intended for resource-status displays.
                resource_status, resources = self.request_json("/settings/hpc-status", timeout=6, config=config)
                if resource_status == 200 and isinstance(resources, dict):
                    indexed = {r.get("cluster"): r for r in resources.get("clusters", []) if isinstance(r, dict)}
                    for item in defaults:
                        source = indexed.get(item["id"])
                        if source:
                            item["state"] = source.get("state", "unknown")
                            item["checked_at"] = source.get("checked_at")
                            checks = source.get("checks", {})
                            failures = [x.get("message", "") for x in checks.values() if isinstance(x, dict) and not x.get("ok", True)]
                            item["message"] = " ".join(failures) or "VISTA reports this resource ready. TVA workflow compatibility must be checked separately."
            except (OSError, ValueError, http.client.HTTPException):
                for item in defaults:
                    item["message"] = "Resource status is unavailable. Check Resources in VISTA."
        except (OSError, ValueError, http.client.HTTPException):
            pass
        result["resources"] = defaults + [{"id": "ccsi", "name": "CCSI GPU node", "state": "planned", "message": "Planned resource. A VISTA adapter, node details and credentials are still needed.", "checked_at": None, "planned": True}]
        with self.lock:
            if config == self.config:
                self.status_cache, self.status_at = result, time.monotonic()
        return result

    def knowledge(self, fresh=False):
        """Read readiness only for KB slugs attached to this selected project."""
        with self.lock:
            if not fresh and self.knowledge_cache and time.monotonic() - self.knowledge_at < 15:
                return dict(self.knowledge_cache)
        config = self.snapshot()
        result = {"project": config["project"], "connected": False, "project_found": False,
                  "count": None, "ready_count": None, "all_ready": None, "knowledge_bases": [],
                  "detail": "Open VISTA to inspect this project's knowledge bases."}
        try:
            code, project = self.request_json("/projects/" + quote(config["project"], safe=""), timeout=3, config=config)
            result["connected"] = code < 500
            result["project_found"] = code == 200 and isinstance(project, dict)
            if not result["project_found"]:
                result["detail"] = "The selected project is unavailable. Check Connection settings."
            elif not isinstance(project.get("knowledge_bases"), list) or not all(isinstance(x, str) for x in project["knowledge_bases"]):
                result["detail"] = "VISTA did not expose a supported project knowledge-base attachment list. Readiness is unknown."
            else:
                slugs = list(dict.fromkeys(project["knowledge_bases"]))
                result["count"] = len(slugs)

                def read_knowledge(slug):
                    item = {"slug": slug, "name": slug, "build_status": "unknown", "last_built_at": None,
                            "detail_available": False, "documents": [], "document_count": None, "ready": None}
                    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,127}", slug):
                        return item
                    try:
                        status, payload = self.request_json("/knowledge-bases/" + quote(slug, safe=""), timeout=5, config=config)
                        if status != 200 or not isinstance(payload, dict) or payload.get("slug") != slug:
                            return item
                        item.update(detail_available=True, name=str(payload.get("name") or slug)[:200],
                                    last_built_at=payload.get("last_built_at")[:64] if isinstance(payload.get("last_built_at"), str) else None)
                        status = payload.get("build_status")
                        item["build_status"] = status if status in ("pending", "ready", "stale", "failed") else "unknown"
                        publications = payload.get("publications")
                        if isinstance(publications, list):
                            complete = True
                            for publication in publications:
                                if not isinstance(publication, dict) or not isinstance(publication.get("filename"), str) or not publication["filename"] or "\x00" in publication["filename"]:
                                    complete = False
                                    continue
                                filename = publication["filename"].replace("\\", "/").split("/")[-1][:512]
                                index_status = publication.get("index_status")
                                item["documents"].append({"filename": filename,
                                    "title": str(publication.get("title") or filename)[:300],
                                    "index_status": index_status if index_status in ("unindexed", "queued", "indexing", "indexed", "failed") else "unknown"})
                            item["document_count"] = len(item["documents"]) if complete else None
                            if complete and item["build_status"] != "unknown":
                                progress = payload.get("index_progress")
                                indexing = isinstance(progress, dict) and progress.get("phase") not in (None, "done")
                                item["ready"] = bool(item["documents"]) and item["build_status"] == "ready" and not indexing and all(d["index_status"] == "indexed" for d in item["documents"])
                    except (OSError, ValueError, TypeError, http.client.HTTPException):
                        pass
                    return item

                if slugs:
                    with concurrent.futures.ThreadPoolExecutor(max_workers=min(4, len(slugs))) as executor:
                        result["knowledge_bases"] = list(executor.map(read_knowledge, slugs))
                result["ready_count"] = sum(kb["ready"] is True for kb in result["knowledge_bases"])
                readiness = [kb["ready"] for kb in result["knowledge_bases"]]
                result["all_ready"] = False if not readiness or False in readiness else None if None in readiness else True
                result["detail"] = ("No knowledge bases are attached to this project." if not slugs else
                                    "{} of {} attached knowledge bases have a Ready index and indexed documents. This does not verify the required demo source coverage.".format(result["ready_count"], len(slugs)))
        except (OSError, ValueError, TypeError, http.client.HTTPException):
            pass
        with self.lock:
            if config == self.config:
                self.knowledge_cache, self.knowledge_at = result, time.monotonic()
        return result

    def skills(self, fresh=False):
        """Read only skills actually loaded in the selected project, never the hub."""
        with self.lock:
            if not fresh and self.skills_cache and time.monotonic() - self.skills_at < 15:
                return dict(self.skills_cache)
        config = self.snapshot()
        result = {"project": config["project"], "connected": False,
                  "project_found": False, "count": None, "skills": [],
                  "detail": "Open VISTA to inspect the skills loaded in this TVA project."}
        try:
            code, project = self.request_json("/projects/" + quote(config["project"], safe=""), timeout=3, config=config)
            result["connected"] = code < 500
            result["project_found"] = code == 200 and isinstance(project, dict)
            if not result["project_found"]:
                result["detail"] = "VISTA responded, but the selected project was not found. Check Connection settings."
            else:
                # Preserve the project's declared order and deduplicate slugs.
                names = list(dict.fromkeys(name for name in project.get("skills", []) if isinstance(name, str)))
                result["count"] = len(names)

                def read_skill(name):
                    item = {"name": name, "description": "Skill details are unavailable.",
                            "body": "", "hpc_jobs": [], "loaded": True,
                            "detail_available": False, "bundled": False}
                    # Slugs cannot alter the detail request's route. No global list is read.
                    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,127}", name):
                        return item
                    try:
                        status, payload = self.request_json("/skills/" + quote(name, safe=""), timeout=5, config=config)
                        if status == 200 and isinstance(payload, dict) and payload.get("name") == name:
                            item.update(description=str(payload.get("description") or "No description provided."),
                                        body=str(payload.get("body") or ""),
                                        hpc_jobs=[job for job in payload.get("hpc_jobs", []) if isinstance(job, str)],
                                        detail_available=True, bundled=bool(payload.get("bundled", False)))
                    except (OSError, ValueError, TypeError, http.client.HTTPException):
                        pass
                    return item

                if names:
                    with concurrent.futures.ThreadPoolExecutor(max_workers=min(4, len(names))) as executor:
                        result["skills"] = list(executor.map(read_skill, names))
                missing = sum(not item["detail_available"] for item in result["skills"])
                result["detail"] = ("{} loaded skill{} in {}. ".format(len(names), "" if len(names) == 1 else "s", config["project"]) +
                                    ("{} detail record{} unavailable; loaded names are still counted.".format(missing, " is" if missing == 1 else "s are") if missing else
                                     "The count reflects VISTA project configuration; it does not certify workflow execution."))
        except (OSError, ValueError, TypeError, http.client.HTTPException):
            pass
        with self.lock:
            if config == self.config:
                self.skills_cache, self.skills_at = result, time.monotonic()
        return result


def decoded_path(path):
    value = unquote(path)
    if unquote(value) != value or "\\" in value or "\x00" in value:
        raise ValueError("Invalid path encoding.")
    if any(part in (".", "..") for part in value.split("/")):
        raise ValueError("Relative path components are not allowed.")
    return value


def allowed_proxy_path(method, raw_path, project):
    parsed = urlsplit(raw_path)
    path = decoded_path(parsed.path)
    prefix = "/projects/" + project
    if path == prefix:
        allowed = method == "GET"
    elif not path.startswith(prefix + "/"):
        allowed = False
    else:
        suffix = path[len(prefix):]
        rules = {
            "GET": [r"/chat-sessions", r"/chat-session", r"/chat-runs/status", r"/models", r"/(?:uploads|outputs)", r"/(?:uploads|outputs)/.+", r"/chat-sessions/" + SESSION + r"/displayed-files", r"/chat-sessions/" + SESSION + r"/run/events"],
            "POST": [r"/chat-sessions", r"/agent/run", r"/uploads", r"/elicitation", r"/reports(?:/generate)?", r"/mcp/call", r"/chat-sessions/" + SESSION + r"/run/stop"],
            "PUT": [r"/chat-session"],
        }
        allowed = any(re.fullmatch(pattern, suffix) for pattern in rules.get(method, []))
    if not allowed:
        return None
    # Re-encode the canonical path so unicode, spaces and # cannot alter the target.
    canonical = quote(path, safe="/")
    return canonical + ("?" + parsed.query if parsed.query else "")


class WorkbenchHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "TVAWorkbench/" + VERSION

    @property
    def app(self):
        return self.server.app

    def log_message(self, fmt, *args):
        # Request bodies, prompts, backend URLs and response bodies are never logged.
        if self.server.verbose:
            sys.stderr.write("TVA: {} {}\n".format(self.command, args[1] if len(args) > 1 else ""))

    def safe_request(self, mutating=False):
        host = self.headers.get("Host", "")
        expected_port = self.server.server_address[1]
        allowed_hosts = {"127.0.0.1:{}".format(expected_port), "localhost:{}".format(expected_port)}
        if host not in allowed_hosts:
            self.json_response(403, {"detail": "This app accepts local requests only."})
            return False
        origin = self.headers.get("Origin")
        if origin and origin not in {"http://" + h for h in allowed_hosts}:
            self.json_response(403, {"detail": "Cross-origin requests are not allowed."})
            return False
        fetch_site = self.headers.get("Sec-Fetch-Site")
        if mutating and fetch_site in ("cross-site", "same-site") and not origin:
            self.json_response(403, {"detail": "Cross-origin changes are not allowed."})
            return False
        return True

    def base_headers(self):
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Cache-Control", "no-store")

    def json_response(self, code, data):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.base_headers()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def read_body(self):
        if self.headers.get("Transfer-Encoding"):
            raise ValueError("Chunked request uploads are not supported.")
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            raise ValueError("Invalid request length.")
        if not 0 <= length <= MAX_BODY:
            raise ValueError("Files and request bodies must be 64 MiB or smaller.")
        return self.rfile.read(length)

    def do_GET(self):
        if not self.safe_request():
            return
        path = urlsplit(self.path).path
        if path == "/api/health":
            self.json_response(200, {"app": "tva-workbench", "version": VERSION,
                                     "instance_id": self.app.instance_id,
                                     "connection_id": connection_identity(self.app.snapshot())})
        elif path == "/api/workbench-assets":
            assets = {}
            directory = (self.app.public / "assets").resolve()
            for key, names in {
                "video": ["water4energy-workbench-90s.mp4"],
                "captions": ["water4energy-workbench-90s.vtt"],
                "scoreMap": ["water4energy-april-2019-score.png", "water4energy-april-2019-score.jpg"],
            }.items():
                for name in names:
                    candidate = directory / name
                    try:
                        resolved = candidate.resolve()
                        resolved.relative_to(directory)
                        if not candidate.is_symlink() and resolved.is_file() and resolved.stat().st_size:
                            assets[key] = "/assets/" + name
                            break
                    except (OSError, ValueError):
                        continue
            self.json_response(200, assets)
        elif path == "/api/config":
            self.json_response(200, self.app.snapshot())
        elif path == "/api/status":
            query = parse_qs(urlsplit(self.path).query)
            self.json_response(200, self.app.status(fresh=query.get("fresh", [""])[0] in ("1", "true")))
        elif path == "/api/skills":
            query = parse_qs(urlsplit(self.path).query)
            self.json_response(200, self.app.skills(fresh=query.get("fresh", [""])[0] in ("1", "true")))
        elif path == "/api/knowledge":
            query = parse_qs(urlsplit(self.path).query)
            self.json_response(200, self.app.knowledge(fresh=query.get("fresh", [""])[0] in ("1", "true")))
        elif path.startswith("/api/vista/"):
            self.proxy()
        elif path.startswith("/api/"):
            self.json_response(404, {"detail": "Unknown Workbench endpoint."})
        else:
            self.static(path)

    def do_POST(self):
        self.mutate()

    def do_PUT(self):
        self.mutate()

    def mutate(self):
        if not self.safe_request(mutating=True):
            return
        path = urlsplit(self.path).path
        try:
            body = self.read_body()
            if path == "/api/config":
                self.json_response(200, self.app.update(json.loads(body)))
            elif path.startswith("/api/vista/"):
                self.proxy(body)
            else:
                self.json_response(404, {"detail": "Unknown Workbench endpoint."})
        except (ValueError, UnicodeDecodeError) as exc:
            self.json_response(400, {"detail": str(exc)})
        except OSError:
            self.json_response(500, {"detail": "Cannot save the local connection configuration. Check folder permissions."})

    def static(self, path):
        try:
            relative = decoded_path(path).lstrip("/") or "index.html"
            resolved = (self.app.public / relative).resolve()
            resolved.relative_to(self.app.public.resolve())
            if not resolved.is_file():
                self.json_response(404, {"detail": "File not found."})
                return
            size = resolved.stat().st_size
            self.send_response(200)
            self.base_headers()
            self.send_header("Content-Type", mimetypes.guess_type(str(resolved))[0] or "application/octet-stream")
            self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'")
            self.send_header("Content-Length", str(size))
            self.end_headers()
            with resolved.open("rb") as source:
                while True:
                    block = source.read(64 * 1024)
                    if not block:
                        break
                    self.wfile.write(block)
        except (ValueError, OSError):
            self.json_response(404, {"detail": "File not found."})

    def proxy(self, body=None):
        config = self.app.snapshot()
        raw_path = self.path[len("/api/vista"):]
        try:
            target_path = allowed_proxy_path(self.command, raw_path, config["project"])
        except ValueError as exc:
            self.json_response(400, {"detail": str(exc)})
            return
        if not target_path:
            self.json_response(403, {"detail": "This endpoint is outside the selected TVA project or is not supported by this wrapper."})
            return
        if target_path.split("?")[0].endswith("/mcp/call"):
            try:
                payload = json.loads(body or b"{}")
                if payload.get("name") not in ("get_hpc_job_status", "get_hpc_job_outputs"):
                    raise ValueError("Only job-status and job-output calls are allowed directly. Use the agent for execution.")
            except (ValueError, AttributeError) as exc:
                self.json_response(400, {"detail": str(exc)})
                return
        endpoint = urlsplit(config["backend_url"])
        connection = http.client.HTTPConnection(endpoint.hostname, endpoint.port, timeout=120)
        committed = False
        try:
            request_headers = {"Accept": self.headers.get("Accept", "application/json")}
            if self.headers.get("Content-Type"):
                request_headers["Content-Type"] = self.headers["Content-Type"]
            connection.request(self.command, target_path, body=body, headers=request_headers)
            response = connection.getresponse()
            if 300 <= response.status < 400:
                response.read()
                self.json_response(502, {"detail": "VISTA returned a redirect; the local adapter does not follow redirects."})
                return
            self.send_response(response.status)
            self.base_headers()
            content_type = response.getheader("Content-Type", "application/octet-stream")
            self.send_header("Content-Type", content_type)
            for header in ("Content-Disposition", "Content-Security-Policy"):
                value = response.getheader(header)
                if value:
                    self.send_header(header, value)
            self.send_header("Connection", "close")
            if "text/event-stream" in content_type:
                self.send_header("X-Accel-Buffering", "no")
            self.end_headers()
            committed = True
            self.close_connection = True
            while True:
                block = response.read1(16 * 1024)
                if not block:
                    break
                self.wfile.write(block)
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            pass  # The backend owns a live turn; closing this watcher does not cancel it.
        except (OSError, http.client.HTTPException):
            if not committed:
                self.json_response(502, {"detail": "Cannot reach the local VISTA backend. Open VISTA and check Connection."})
        finally:
            connection.close()


def create_server(port=8765, root=APP_ROOT, backend_url=None, project=None, persist=True, verbose=False):
    server = ThreadingHTTPServer(("127.0.0.1", port), WorkbenchHandler)
    server.daemon_threads = True
    server.app = AppState(root, backend_url, project, persist)
    server.verbose = verbose
    return server


def existing_workbench(port, instance_id, config_id):
    """Reuse this exact copy/configuration; never open an unrelated app/copy."""
    if isinstance(port, bool) or not isinstance(port, int) or not 1 <= port <= 65535:
        return False
    connection = http.client.HTTPConnection("127.0.0.1", port, timeout=2)
    try:
        connection.request("GET", "/api/health")
        response = connection.getresponse()
        data = json.loads(response.read(4096))
        return (response.status == 200 and isinstance(data, dict) and
                data.get("app") == "tva-workbench" and data.get("version") == VERSION and
                data.get("instance_id") == instance_id and data.get("connection_id") == config_id)
    except (OSError, ValueError, http.client.HTTPException):
        return False
    finally:
        connection.close()


def remembered_port(root, preferred_port, instance_id):
    try:
        record = json.loads((Path(root) / ".local" / "instance.json").read_text(encoding="utf-8"))
        port = record["port"]
        if (record.get("version") == VERSION and record.get("instance_id") == instance_id and
                record.get("preferred_port") == preferred_port and not isinstance(port, bool) and
                isinstance(port, int) and 1 <= port <= 65535):
            return port
    except (OSError, ValueError, TypeError, KeyError):
        pass
    return None


def remember_instance(root, preferred_port, port, instance_id):
    try:
        path = Path(root) / ".local" / "instance.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_suffix(".tmp")
        temporary.write_text(json.dumps({"version": VERSION, "instance_id": instance_id,
                                         "preferred_port": preferred_port, "port": port}) + "\n", encoding="utf-8")
        os.chmod(str(temporary), 0o600)
        temporary.replace(path)
    except OSError:
        print("This folder cannot remember its local port. The app still works at its printed address.", file=sys.stderr)


def forget_instance(root, port, instance_id):
    path = Path(root) / ".local" / "instance.json"
    try:
        record = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(record, dict) and record.get("port") == port and record.get("instance_id") == instance_id:
            path.unlink()
    except (OSError, ValueError, TypeError):
        pass


def prepare_server(port=8765, root=APP_ROOT, backend_url=None, project=None, verbose=False):
    """Return (new server or None, actual port); None means an exact copy exists.

    --port is a preferred loopback port. An occupied port, including an explicit
    one, falls back to an OS-assigned port; no existing process is stopped.
    """
    expected = AppState(root, backend_url, project, persist=False)
    config_id = connection_identity(expected.snapshot())
    if port:
        saved = remembered_port(root, port, expected.instance_id)
        if saved and existing_workbench(saved, expected.instance_id, config_id):
            return None, saved
    try:
        server = create_server(port, root=root, backend_url=backend_url, project=project, verbose=verbose)
    except OSError as exc:
        if exc.errno != errno.EADDRINUSE:
            raise
        if existing_workbench(port, expected.instance_id, config_id):
            return None, port
        server = create_server(0, root=root, backend_url=backend_url, project=project, verbose=verbose)
        print("Port {} is occupied. Starting this Workbench copy on an available local port.".format(port))
    actual_port = server.server_address[1]
    remember_instance(root, port, actual_port, server.app.instance_id)
    return server, actual_port


def open_browser(url):
    try:
        opened = webbrowser.open_new_tab(url)
    except Exception:
        opened = False
    if not opened:
        print("The browser did not open automatically. Open this address: " + url, file=sys.stderr)
    return opened


def main(argv=None, root=APP_ROOT):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=int(os.environ.get("TVA_PORT", "8765")),
                        help="Preferred local port; an occupied port falls back to an available port.")
    parser.add_argument("--backend-url", default=os.environ.get("TVA_VISTA_URL"))
    parser.add_argument("--project", default=os.environ.get("TVA_PROJECT"))
    parser.add_argument("--no-browser", action="store_true")
    parser.add_argument("--verbose", action="store_true")
    args = parser.parse_args(argv)
    if not 0 <= args.port <= 65535:
        parser.error("--port must be between 0 and 65535")
    try:
        server, port = prepare_server(args.port, root=root, backend_url=args.backend_url,
                                      project=args.project, verbose=args.verbose)
    except (OSError, ValueError) as exc:
        print("Cannot start Water4Energy workbench: {}".format(exc), file=sys.stderr)
        return 1
    url = "http://127.0.0.1:{}".format(port)
    print("Water4Energy workbench " + VERSION, flush=True)
    print("Folder: " + str(Path(root).resolve()), flush=True)
    print("Open " + url, flush=True)
    if server is None:
        print("This Workbench copy is already running.")
        if not args.no_browser:
            open_browser(url)
        return 0
    print("Keep this window open. Press Ctrl+C to stop. VISTA runs separately.")
    timer = None
    if not args.no_browser:
        timer = threading.Timer(0.5, open_browser, args=(url,))
        timer.daemon = True
        timer.start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nWater4Energy workbench stopped. VISTA jobs, if any, are managed separately.")
    finally:
        if timer:
            timer.cancel()
        server.server_close()
        forget_instance(root, port, server.app.instance_id)
    return 0


if __name__ == "__main__":
    sys.exit(main())
