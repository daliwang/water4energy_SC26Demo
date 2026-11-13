"""Source checkouts must never install or start a backend implicitly."""
import contextlib
import hashlib
import importlib.util
import io
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import launch_workbench


class SourceLauncherTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix='w4e-source-launcher-')
        self.addCleanup(temporary.cleanup)
        self.root = (Path(temporary.name) / 'Source checkout with spaces').resolve()
        self.root.mkdir()
        (self.root / 'server.py').write_text('# fake interface server\n')
        self.manifest()

    def manifest(self, paths=('server.py',)):
        (self.root / 'MANIFEST.sha256').write_text(''.join(
            hashlib.sha256((self.root / name).read_bytes()).hexdigest() + '  ' + name + '\n'
            for name in paths))

    def run_launcher(self, args, server=None):
        self.output = io.StringIO()
        loader = mock.Mock()
        spec = types.SimpleNamespace(loader=loader)
        server = server or mock.Mock()
        server.main.return_value = 0
        with mock.patch.object(launch_workbench.importlib.util, 'spec_from_file_location', return_value=spec), \
                mock.patch.object(launch_workbench.importlib.util, 'module_from_spec', return_value=server), \
                contextlib.redirect_stdout(self.output):
            result = launch_workbench.main(args, root=self.root)
        return result, server

    def test_source_checkout_opens_interface_without_backend_calls(self):
        with mock.patch.object(launch_workbench, 'Setup') as setup, \
                mock.patch.object(launch_workbench, 'ensure_backend') as ensure, \
                mock.patch.object(launch_workbench, 'start_vista') as start:
            result, server = self.run_launcher([
                '--backend-url', 'http://127.0.0.1:8123', '--port', '0', '--no-browser'])
        self.assertEqual(result, 0)
        setup.assert_not_called()
        ensure.assert_not_called()
        start.assert_not_called()
        server.main.assert_called_once_with([
            '--port', '0', '--backend-url', 'http://127.0.0.1:8123',
            '--project', 'Water4Energy-TVA-agent-loop', '--no-browser'], root=self.root)
        self.assertIn('source checkout', self.output.getvalue())
        self.assertIn('existing local VISTA project', self.output.getvalue())
        self.assertFalse((self.root / '.local').exists())

    def test_source_setup_only_exits_nonzero_without_backend_calls(self):
        with mock.patch.object(launch_workbench, 'Setup') as setup, \
                mock.patch.object(launch_workbench, 'ensure_backend') as ensure:
            result, server = self.run_launcher(['--setup-only'])
        self.assertEqual(result, 1)
        setup.assert_not_called()
        ensure.assert_not_called()
        server.main.assert_not_called()
        self.assertIn('no private backend payload', self.output.getvalue())

    def test_unmanifested_local_payload_is_rejected_before_any_backend_call(self):
        (self.root / 'backend').mkdir()
        (self.root / 'backend/project.json').write_text('{"project": {}}')
        with mock.patch.object(launch_workbench, 'Setup') as setup, \
                mock.patch.object(launch_workbench, 'ensure_backend') as ensure:
            result, server = self.run_launcher(['--setup-only'])
        self.assertEqual(result, 1)
        setup.assert_not_called()
        ensure.assert_not_called()
        server.main.assert_not_called()
        self.assertIn('not covered by this package manifest', self.output.getvalue())
        self.assertIn('authorized full combined ZIP launcher', self.output.getvalue())

    def test_manifested_payload_retains_verified_setup_path(self):
        (self.root / 'backend').mkdir()
        (self.root / 'backend/project.json').write_text('{"project": {}}')
        self.manifest(('server.py', 'backend/project.json'))
        with mock.patch.object(launch_workbench, 'Setup') as setup, \
                mock.patch.object(launch_workbench, 'ensure_backend') as ensure:
            result, server = self.run_launcher(['--setup-only'])
        self.assertEqual(result, 0)
        setup.return_value.validate_local.assert_called_once_with()
        setup.return_value.run.assert_called_once_with()
        ensure.assert_called_once()
        server.main.assert_not_called()

    def test_build_without_payload_does_not_rewrite_metadata(self):
        spec = importlib.util.spec_from_file_location('source_release_builder', ROOT / 'tools/build_release.py')
        builder = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(builder)
        metadata = self.root / 'BUNDLE.json'
        metadata.write_text('{"distribution":"source-checkout"}\n')
        before = metadata.read_bytes()
        with mock.patch.object(builder, 'ROOT', self.root), self.assertRaisesRegex(ValueError, 'public source checkout'):
            builder.build(self.root / 'output')
        self.assertEqual(metadata.read_bytes(), before)
        self.assertFalse((self.root / 'output').exists())


if __name__ == '__main__':
    unittest.main()
