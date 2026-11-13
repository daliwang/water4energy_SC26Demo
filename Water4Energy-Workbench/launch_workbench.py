"""One entry point for the Mac interface and its local VISTA project setup."""
from pathlib import Path
import argparse
import hashlib
import importlib.util
import os
import platform
import shutil
import subprocess
import sys
import time

from portable_setup import Setup, SetupError, local_api, VERSION

ROOT = Path(__file__).resolve().parent


def verify_package(root):
    manifest = root / 'MANIFEST.sha256'
    if not manifest.is_file():
        raise SetupError('The package manifest is missing. Extract the complete ZIP again.')
    for line in manifest.read_text(encoding='utf-8').splitlines():
        sha, relative = line.split('  ', 1)
        path = root / relative
        if (Path(relative).is_absolute() or '..' in Path(relative).parts or path.is_symlink()
                or not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest() != sha):
            raise SetupError('Package verification failed: ' + relative + '. Extract the complete ZIP again.')


def verify_backend_payload(root):
    """A local payload is installable only with its complete package manifest."""
    if (root / 'backend').is_symlink() or not (root / 'backend').is_dir():
        raise SetupError('The local backend payload must be a regular folder. Use the authorized full combined ZIP launcher for backend setup.')
    listed = {line.split('  ', 1)[1] for line in
              (root / 'MANIFEST.sha256').read_text(encoding='utf-8').splitlines()}
    payload = []
    for path in (root / 'backend').rglob('*'):
        relative = path.relative_to(root)
        if '__pycache__' in relative.parts or path.suffix == '.pyc' or path.name == '.DS_Store':
            continue
        if path.is_symlink():
            raise SetupError('The local backend payload contains a link. Use the authorized full combined ZIP launcher for backend setup.')
        if path.is_file():
            payload.append(relative.as_posix())
    if ('backend/project.json' not in payload or not set(payload).issubset(listed)):
        raise SetupError('The local backend payload is not covered by this package manifest. Use the authorized full combined ZIP launcher for backend setup; this source checkout can connect to that existing VISTA project afterward.')


def backend_available(setup):
    try:
        status, body = setup.raw('/openapi.json', timeout=2)
        return status == 200
    except SetupError:
        return False


def start_vista(root):
    """Use VISTA's supported launcher, never start internal services separately."""
    candidates = [Path('/Applications/VISTA/VISTA.app'),
                  Path.home() / 'Applications/VISTA/VISTA.app',
                  Path('/Applications/VISTA.app'), Path.home() / 'Applications/VISTA.app']
    specified = os.environ.get('W4E_VISTA_INSTALL')
    if specified:
        candidates.insert(0, Path(specified).expanduser() / 'VISTA.app')
    if platform.system() == 'Darwin':
        for app in candidates:
            if app.is_dir():
                result = subprocess.run(['/usr/bin/open', '-a', str(app)], check=False)
                if result.returncode == 0:
                    return True
    cli_candidates = [Path(specified).expanduser() / 'vista'] if specified else []
    installed = shutil.which('vista')
    if installed:
        cli_candidates.append(Path(installed))
    cli_candidates += [Path('/Applications/VISTA/vista'), Path.home() / 'Applications/VISTA/vista']
    for launcher in cli_candidates:
        if launcher.is_file() and os.access(launcher, os.X_OK):
            local = root / '.local'
            local.mkdir(exist_ok=True)
            with (local / 'vista-startup.log').open('ab') as log:
                subprocess.Popen([str(launcher)], stdout=log, stderr=log, start_new_session=True)
            return True
    return False


def ensure_backend(setup, root, may_start=True):
    if backend_available(setup):
        return
    if not may_start or not start_vista(root):
        raise SetupError('VISTA is not running. Install/open VISTA on this laptop, then double-click this same launcher again. The interface can still be reviewed now.')
    print('Opening VISTA. First startup can take a few minutes…', flush=True)
    deadline = time.monotonic() + setup.timeout
    while time.monotonic() < deadline:
        if backend_available(setup):
            return
        time.sleep(min(2, max(.01, deadline - time.monotonic())))
    raise SetupError('VISTA is still starting or needs attention. Keep its window open, resolve its startup message, then run this launcher again.')


def main(argv=None, root=ROOT):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--backend-url', default=os.environ.get('TVA_VISTA_URL', 'http://127.0.0.1:8001'))
    parser.add_argument('--port', type=int, default=8765)
    parser.add_argument('--no-browser', action='store_true')
    parser.add_argument('--no-start-vista', action='store_true')
    parser.add_argument('--setup-only', action='store_true')
    parser.add_argument('--setup-timeout', type=float, default=180)
    args = parser.parse_args(argv)
    root = Path(root).resolve()
    try:
        api = local_api(args.backend_url)
        if not 0 <= args.port <= 65535 or args.setup_timeout < 0:
            raise SetupError('Use a local port from 0 through 65535 and a nonnegative setup timeout.')
        verify_package(root)
    except (OSError, ValueError, SetupError) as error:
        print('Cannot open the package: ' + str(error), flush=True)
        return 1

    has_payload = (root / 'backend').exists()
    distribution = 'combined Mac package 1' if has_payload else 'source checkout'
    print('Water4Energy workbench · v' + VERSION + ' · ' + distribution, flush=True)
    print('Folder: ' + str(root), flush=True)
    ready = False
    if not has_payload:
        print('Source checkout: connecting to your existing local VISTA project without changing its setup.', flush=True)
        print('Open VISTA separately for live chat. Private skills and saved evidence are not included in this public repository.', flush=True)
        print('For first-time backend setup, use the authorized full combined ZIP launcher, then reopen this source checkout. Private backend files are ignored by Git.', flush=True)
        if args.setup_only:
            print('Cannot prepare the backend: this source checkout has no private backend payload.', flush=True)
            return 1
    else:
        try:
            verify_backend_payload(root)
            setup = Setup(root, api=api, timeout=args.setup_timeout)
            # Validate local files before opening VISTA or touching its project.
            setup.validate_local()
            ensure_backend(setup, root, may_start=not args.no_start_vista)
            setup.run()
            ready = True
        except (OSError, ValueError, SetupError) as error:
            print('\nBackend setup needs attention: ' + str(error), flush=True)
            print('Unknown or locally edited projects, global skills, and differing evidence are preserved. Verified known backend versions may be upgraded with a local backup.', flush=True)
            if not args.setup_only:
                print('Opening the interface for review. Live chat and saved figures require successful backend setup.\n', flush=True)
        except KeyboardInterrupt:
            print('\nSetup stopped. Open this same launcher to resume.', flush=True)
            return 130
    if args.setup_only:
        return 0 if ready else 1

    # Pin this copy to its setup target, rather than reuse another folder's tab.
    spec = importlib.util.spec_from_file_location('water4energy_interface_server', root / 'server.py')
    server = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(server)
    flags = ['--port', str(args.port), '--backend-url', api, '--project', 'Water4Energy-TVA-agent-loop']
    if args.no_browser:
        flags.append('--no-browser')
    return server.main(flags, root=root)


if __name__ == '__main__':
    sys.exit(main())
