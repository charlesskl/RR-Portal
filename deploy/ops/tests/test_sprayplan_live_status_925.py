"""Read-only status fixtures; no real Docker, SSH, deployment or business data access."""
import ast
import contextlib
import io
import json
import pathlib
import subprocess
import tempfile
import textwrap
import types
import unittest
from unittest.mock import patch

WORKFLOW = pathlib.Path(__file__).resolve().parents[3] / '.github/workflows/sprayplan-runtime-inspect.yml'
TEXT = WORKFLOW.read_text()
STATUS_TEXT = TEXT.split('      - name: Diagnose exact previous environment hashes', 1)[0]
BODY = textwrap.dedent(TEXT.split("            python3 - <<'PY'\n", 1)[1].split('            PY\n', 1)[0])
ops = types.ModuleType('live_status_925')
exec(compile(BODY, str(WORKFLOW), 'exec'), ops.__dict__)


class LiveStatusTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='sprayplan-live-status-fixture-')
        self.directory = pathlib.Path(self.temporary.name)
        self.proc = self.directory / 'proc'
        self.proc.mkdir()
        (self.proc / 'net').mkdir()
        (self.proc / 'meminfo').write_text('MemTotal: 2000 kB\nMemAvailable: 1234 kB\n')
        self.write_network(100, 50)
        self.write_process(1, 'node', 10, 3, 100)
        self.write_process(2, 'unknown-private-process', 0, 0, 100)
        self.commands = []

    def tearDown(self):
        self.temporary.cleanup()

    def write_network(self, rx, tx, name='private-interface-do-not-print'):
        fields = [rx, 0, 0, 0, 0, 0, 0, 0, tx, 0, 0, 0, 0, 0, 0, 0]
        (self.proc / 'net/dev').write_text('Inter-| Receive | Transmit\nface | bytes | bytes\n' + name + ': ' + ' '.join(map(str, fields)) + '\n')

    def write_process(self, pid, comm, user, system, born):
        directory = self.proc / str(pid)
        directory.mkdir(exist_ok=True)
        (directory / 'comm').write_text(comm + '\n')
        fields = ['0'] * 30
        fields[0], fields[11], fields[12], fields[19] = 'R', str(user), str(system), str(born)
        (directory / 'stat').write_text(str(pid) + ' (' + comm + ') ' + ' '.join(fields))
        (directory / 'cmdline').write_text('private-arguments-never-read')
        (directory / 'environ').write_text('private-env-never-read')

    def metadata(self, service):
        return {'containerId': ('a' if service == 'sprayplan' else 'b') * 64,
                'createdAt': '2026-10-14T12:34:00.123Z', 'startedAt': '2026-10-14T12:35:00Z',
                'running': True, 'status': 'running', 'health': 'healthy', 'imageId': 'sha256:' + 'c' * 64,
                'restartCount': 0, 'oomKilled': False}

    def fake_run(self, args, **kwargs):
        self.commands.append((args, kwargs))
        if args == ['git', 'rev-parse', 'HEAD']:
            body = (ops.TARGET + '\n').encode()
        else:
            self.assertEqual(['docker', 'inspect', '--format'], args[:3])
            self.assertNotIn('Config', args[3]); self.assertNotIn('Log', args[3]); self.assertNotIn('NetworkSettings', args[3])
            service = 'sprayplan-test' if args[-1].endswith('sprayplan-test-1') else 'sprayplan'
            body = json.dumps(self.metadata(service)).encode()
        self.assertEqual(subprocess.PIPE, kwargs['stdout'])
        self.assertEqual(subprocess.PIPE, kwargs['stderr'])
        self.assertEqual('0', kwargs['env']['GIT_OPTIONAL_LOCKS'])
        return subprocess.CompletedProcess(args, 0, body, b'private-stderr-never-output')

    def observe(self, pause=None, runner=None):
        with patch.object(ops.subprocess, 'run', side_effect=runner or self.fake_run):
            return ops.observation(self.proc, self.directory, pause or (lambda seconds: None))

    def test_real_proc_style_fixture_produces_only_safe_counts_cpu_and_network_deltas(self):
        def pause(seconds):
            self.assertEqual(2, seconds)
            self.write_network(160, 90)
            self.write_process(1, 'node', 15, 5, 100)
        report = self.observe(pause)
        self.assertTrue(report['source']['matchesTarget'])
        self.assertEqual(1, report['knownHostProcessClasses']['counts']['node'])
        self.assertEqual(7, report['knownHostProcessClasses']['cpuTicksDeltaSameProcesses']['node'])
        self.assertEqual(60, report['network']['rxBytesDelta'])
        self.assertEqual(40, report['network']['txBytesDelta'])
        self.assertEqual(1234 * 1024, report['memory']['availableBytes'])
        body = json.dumps(report)
        for value in ['private-', 'cmdline', 'environ', '192.0.2.1']:
            self.assertNotIn(value, body)
        for name in ['businessRowsRead', 'configEnvironmentRead', 'logsRead', 'sourceWritesPerformed', 'containerChangesPerformed', 'causeInferred']:
            self.assertFalse(report[name])

    def test_nonzero_and_timeout_stderr_stdout_and_arguments_never_escape(self):
        for failure in [subprocess.CompletedProcess(['private-arg'], 1, b'private-output', b'private-error'),
                        subprocess.TimeoutExpired(['private-arg'], 1, output=b'private-output', stderr=b'private-error')]:
            with self.subTest(kind=type(failure).__name__):
                def run(args, **kwargs):
                    if isinstance(failure, Exception):
                        raise failure
                    return failure
                report = self.observe(runner=run)
                self.assertFalse(report['source']['complete'])
                self.assertTrue(all(not row['complete'] for row in report['containers'].values()))
                self.assertNotIn('private-', json.dumps(report))

    def test_known_build_package_process_titles_are_classified_without_printing_titles(self):
        self.write_process(3, 'npm ci', 1, 0, 100)
        self.write_process(4, 'npm run build', 1, 0, 100)
        self.write_process(5, 'apt-get', 1, 0, 100)
        report = self.observe()
        self.assertEqual(3, report['knownHostProcessClasses']['counts']['node'])
        self.assertEqual(1, report['knownHostProcessClasses']['counts']['package'])
        self.assertNotIn('npm ci', json.dumps(report))

    def test_unsafe_container_fields_or_extras_are_unknown_not_logged(self):
        for key in ['status', 'imageId', 'createdAt', 'extra-private-environment']:
            with self.subTest(field=key):
                row = self.metadata('sprayplan'); row[key] = 'private-value-never-print'
                with patch.object(ops, 'command', return_value=json.dumps(row).encode()):
                    result = ops.container('sprayplan')
                self.assertEqual({'complete': False, 'metadata': None}, result)

    def test_missing_or_malformed_host_observation_is_unknown(self):
        (self.proc / 'meminfo').write_text('private-not-memory')
        (self.proc / 'net/dev').write_text('private-not-network')
        (self.proc / '1/stat').write_text('private-malformed-stat')
        report = self.observe()
        self.assertFalse(report['memory']['complete']); self.assertIsNone(report['memory']['availableBytes'])
        self.assertFalse(report['network']['complete']); self.assertIsNone(report['network']['rxBytesDelta'])
        self.assertFalse(report['knownHostProcessClasses']['complete']); self.assertIsNone(report['knownHostProcessClasses']['counts'])
        self.assertNotIn('private-', json.dumps(report))

    def test_changed_network_devices_or_counter_reset_and_process_reuse_are_unknown(self):
        def pause(seconds):
            self.write_network(1, 2, name='new-private-interface')
            self.write_process(1, 'node', 1, 1, 200)
        report = self.observe(pause)
        self.assertFalse(report['network']['complete']); self.assertIsNone(report['network']['rxBytesDelta'])
        self.assertIsNone(report['knownHostProcessClasses']['cpuTicksDeltaSameProcesses'])
        self.write_network(100, 50)
        report = self.observe(lambda seconds: self.write_network(1, 2))
        self.assertFalse(report['network']['complete'])

    def test_only_fixed_target_and_independent_concurrency_are_allowed(self):
        self.assertIn('group: sprayplan-deployment-status-925', TEXT)
        self.assertNotIn('group: deploy-cloud', TEXT)
        self.assertIn('appleboy/ssh-action@0ff4204d59e8e51228ff73bce53f80d53301dee2', TEXT)
        self.assertIn('fingerprint: ${{ env.CLOUD_HOST_FINGERPRINT }}', TEXT)
        for forbidden in ['git fetch', 'git show', 'git checkout', 'docker exec', 'docker compose', 'docker restart', 'kill ', 'ps -', '/environ', '/cmdline', '/api/', 'sqlite']:
            self.assertNotIn(forbidden, STATUS_TEXT)
        namespace = {'__name__': '__main__'}
        output = io.StringIO()
        with patch.dict(ops.os.environ, {'SPRAY_STATUS_TARGET': 'invalid-private-target'}), contextlib.redirect_stdout(output):
            with self.assertRaises(SystemExit) as error:
                exec(compile(BODY, 'status-fixture', 'exec'), namespace)
        self.assertEqual(1, error.exception.code)
        self.assertEqual({'error': 'INVALID_FIXED_TARGET', 'readOnly': True}, json.loads(output.getvalue()))

    def test_embedded_code_has_no_file_writes_or_shell_subprocess(self):
        for node in ast.walk(ast.parse(BODY)):
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute):
                self.assertNotIn(node.func.attr, ['write_text', 'write_bytes', 'mkdir', 'unlink', 'chmod', 'remove', 'system', 'kill'])
                if node.func.attr == 'run':
                    self.assertFalse(any(k.arg == 'shell' and getattr(k.value, 'value', None) for k in node.keywords))


if __name__ == '__main__':
    unittest.main()
