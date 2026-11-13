"""Build the complete Mac workbench ZIP; no network access or account state."""
from pathlib import Path
import argparse
import hashlib
import json
import re
import subprocess
import sys
import zipfile

ROOT = Path(__file__).resolve().parents[1]


def build(output):
    # The public checkout deliberately omits the private research payload. Fail
    # before rewriting metadata or claiming to have built a combined package.
    if not (ROOT / 'backend' / 'project.json').is_file():
        raise ValueError('Cannot build an all-in-one package from this public source checkout: supply an authorized backend payload locally first.')
    sys.path.insert(0, str(ROOT))
    from portable_setup import Setup
    Setup(ROOT).validate_local()
    version = re.search(r'^VERSION = "([0-9.]+)"', (ROOT / 'server.py').read_text(), re.M).group(1)
    metadata = {'product': 'Water4Energy workbench', 'interface_version': version,
                'bundle_revision': 1, 'platform': 'macOS', 'project': 'Water4Energy-TVA-agent-loop',
                'launcher': 'Start TVA Workbench.command',
                'requires': 'Installed VISTA; recipient configures own model credentials',
                'source_tag': 'v' + version}
    (ROOT / 'BUNDLE.json').write_text(json.dumps(metadata, indent=2) + '\n', encoding='utf-8')
    listed = subprocess.check_output(['git', '-C', str(ROOT), 'ls-files', '--cached', '--others', '--exclude-standard', '-z']).decode().split('\0')
    # backend/ stays ignored even when an authorized local combined build uses it.
    listed += [path.relative_to(ROOT).as_posix() for path in (ROOT / 'backend').rglob('*') if path.is_file()]
    excluded = {'.git', '.local', '__pycache__', '.DS_Store', '.pytest_cache', '.venv', 'node_modules'}
    files = []
    for name in sorted(set(listed) - {'', 'MANIFEST.sha256'}):
        path = ROOT / name
        if any(part in excluded for part in Path(name).parts) or path.suffix == '.pyc' or not path.is_file():
            continue
        if path.is_symlink():
            raise ValueError('Links are not packaged: ' + name)
        files.append(path)
    if ROOT / 'BUNDLE.json' not in files:
        files.append(ROOT / 'BUNDLE.json')
    for name in ['Start TVA Workbench.command', 'start.sh']:
        (ROOT / name).chmod(0o755)
    manifest = ROOT / 'MANIFEST.sha256'
    manifest.write_text(''.join(hashlib.sha256(path.read_bytes()).hexdigest() + '  ' + path.relative_to(ROOT).as_posix() + '\n' for path in sorted(files)), encoding='utf-8')
    files.append(manifest)
    output = Path(output).resolve()
    output.mkdir(parents=True, exist_ok=True)
    archive = output / ('Water4Energy-Workbench-v' + version + '-All-in-One-Mac.zip')
    with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED) as bundle:
        for path in sorted(files):
            bundle.write(path, Path('TVA-Workbench') / path.relative_to(ROOT))
    with zipfile.ZipFile(archive) as bundle:
        assert bundle.testzip() is None
        for line in bundle.read('TVA-Workbench/MANIFEST.sha256').decode().splitlines():
            sha, name = line.split('  ', 1)
            assert hashlib.sha256(bundle.read('TVA-Workbench/' + name)).hexdigest() == sha, name
        assert bundle.getinfo('TVA-Workbench/Start TVA Workbench.command').external_attr >> 16 & 0o111
        assert len([n for n in bundle.namelist() if n.endswith('.command')]) == 1
        assert not any('/.local/' in n or '/.git/' in n or n.endswith('configured-state.json') for n in bundle.namelist())
        for required in ['backend/evidence.zip', 'backend/project.json', 'portable_setup.py', 'launch_workbench.py']:
            assert 'TVA-Workbench/' + required in bundle.namelist(), required
    sha = hashlib.sha256(archive.read_bytes()).hexdigest()
    archive.with_suffix('.zip.sha256').write_text(sha + '  ' + archive.name + '\n')
    result = {'archive': str(archive), 'version': version, 'files': len(files), 'bytes': archive.stat().st_size,
              'sha256': sha, 'integrity_verified': True, 'mac_launcher_count': 1}
    (output / 'BUILD_RECEIPT.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', default=str(ROOT.parent / 'water4energy-release'))
    build(parser.parse_args().output)
