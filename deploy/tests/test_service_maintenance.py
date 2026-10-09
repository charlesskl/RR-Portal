"""Behavioral regressions for isolated deployments and the production nginx config.

NGINX_BIN=/path/to/nginx python3 -m unittest discover -s deploy/tests -v
All flags, mock containers and HTTP services are local temporary fixtures.
"""
import base64
import contextlib
import json
import os
from pathlib import Path
import re
import shutil
import socket
import subprocess
import tempfile
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.error import HTTPError
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[2]
NGINX = os.environ.get('NGINX_BIN') or shutil.which('nginx')
BASH_MAJOR = int(subprocess.check_output(['bash', '-c', 'echo ${BASH_VERSINFO[0]}'], text=True))


class DeploymentTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name)
        self.flags = self.path / 'flags' / 'services'
        self.flags.mkdir(parents=True)
        self.states = self.path / 'states.json'
        self.states.write_text(json.dumps({'paiji': 'running/0/unless-stopped/healthy'}))
        docker = self.path / 'docker'
        docker.write_text('''#!/usr/bin/env python3
import json, os, pathlib, sys
p = pathlib.Path(os.environ['FIXTURE_DIR'])
a = sys.argv[1:]
with (p / 'calls').open('a') as f: f.write(json.dumps(a) + '\\n')
if a[0] == 'inspect':
    print(json.loads((p / 'states.json').read_text()).get(a[-1], 'restarting/1/unless-stopped/none'))
elif 'config' in a:
    if '--format' in a: print((p / 'compose.json').read_text())
    else: print(os.environ['FIXTURE_SERVICES'])
elif 'ps' in a:
    if a[0] == 'ps' and '--filter' not in a: print('rr-portal-internal-quote-1')
    elif a[-1] in json.loads((p / 'states.json').read_text()): print(a[-1])
elif 'build' in a:
    # Building must leave the old system accessible.
    key = os.environ.get('EXPECTED_KEY', a[-1])
    assert not (p / 'flags/services' / key).exists(), 'maintenance started during build'
    if os.environ.get('FAIL_BUILD') == '1': sys.exit(2)
elif 'up' in a:
    key = os.environ.get('EXPECTED_KEY', a[-1])
    if a[-1] not in ('db', 'redis', 'nginx', 'autoheal'):
        assert (p / 'flags/services' / key).exists(), 'missing scoped maintenance flag'
        if os.environ.get('FULL_SCRIPT') == '1':
            assert [x.name for x in (p / 'flags/services').iterdir()] == [key], 'previous system still blocked'
    assert not (p / 'flags/ON').exists(), 'global maintenance flag created'
    assert '--no-deps' in a and '--no-build' in a
    if os.environ.get('FAIL_UP') == '1': sys.exit(3)
''')
        docker.chmod(0o755)

    def run_shell(self, command, services='paiji', **env):
        script = '''set -euo pipefail
COMPOSE_FILE=fixture.yml
ENV_FILE=fixture.env
MAINT_FLAG_DIR="$FIXTURE_DIR/flags"
MAINT_COMPOSE_SERVICES="$FIXTURE_SERVICES"
source "$FIXTURE_HELPER"
ensure_service_base_images() { :; }
''' + command
        return subprocess.run(['bash', '-c', script], text=True, capture_output=True, env={
            **os.environ, 'PATH': str(self.path) + os.pathsep + os.environ['PATH'],
            'FIXTURE_DIR': str(self.path), 'FIXTURE_SERVICES': services,
            'FIXTURE_HELPER': str(ROOT / 'deploy/service-maintenance.sh'),
            'MAINT_HEALTH_TIMEOUT_SECONDS': '0', 'MAINT_DNS_GRACE_SECONDS': '0', **env,
        })

    def test_build_failure_does_not_enable_maintenance(self):
        result = self.run_shell('deploy_service paiji 1', FAIL_BUILD='1')
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(list(self.flags.iterdir()), [])

    def test_recreate_failure_keeps_only_affected_system_flag(self):
        result = self.run_shell('deploy_service paiji 1', FAIL_UP='1')
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual([p.name for p in self.flags.iterdir()], ['paiji'])

    def test_successful_deployment_clears_its_flag(self):
        result = self.run_shell('deploy_service paiji 1', MAINT_HEALTH_TIMEOUT_SECONDS='2')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(list(self.flags.iterdir()), [])
        calls = [json.loads(line) for line in (self.path / 'calls').read_text().splitlines()]
        self.assertLess(next(i for i, a in enumerate(calls) if 'build' in a),
                        next(i for i, a in enumerate(calls) if 'up' in a))

    def test_health_timeout_is_scoped(self):
        result = self.run_shell('deploy_service paiji 0')
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual([p.name for p in self.flags.iterdir()], ['paiji'])

    def test_no_healthcheck_does_not_hide_a_restarting_container(self):
        for state, ready in [('restarting/1/unless-stopped/none', False),
                             ('exited/0/unless-stopped/none', False),
                             ('running/0/unless-stopped/none', True),
                             ('exited/0/no/none', True)]:
            with self.subTest(state=state):
                self.states.write_text(json.dumps({'paiji': state}))
                result = self.run_shell('service_is_ready paiji')
                self.assertEqual(result.returncode == 0, ready)

    def test_group_flag_waits_for_all_containers(self):
        services = 'qc-plan-api\nqc-plan-web'
        self.states.write_text(json.dumps({'qc-plan-api': 'running/0/unless-stopped/healthy',
                                          'qc-plan-web': 'running/0/unless-stopped/unhealthy'}))
        result = self.run_shell('maintenance_on qc-plan-api; maintenance_off qc-plan-api', services)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue((self.flags / 'qc-plan').exists())
        self.states.write_text(json.dumps({'qc-plan-api': 'running/0/unless-stopped/healthy',
                                          'qc-plan-web': 'running/0/unless-stopped/healthy'}))
        result = self.run_shell('recover_maintenance_flags', services)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse((self.flags / 'qc-plan').exists())

    def test_recovery_preserves_an_unhealthy_flag_and_other_systems(self):
        self.states.write_text(json.dumps({'paiji': 'running/0/unless-stopped/unhealthy',
                                          'peise': 'running/0/unless-stopped/healthy'}))
        (self.flags / 'paiji').touch()
        (self.flags / 'peise').touch()
        result = self.run_shell('recover_maintenance_flags', 'paiji\npeise')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual([p.name for p in self.flags.iterdir()], ['paiji'])


    @unittest.skipUnless(BASH_MAJOR >= 4, 'full server script requires Bash 4+; covered on Linux CI')
    def test_full_compose_rollout_is_sequential_and_has_named_services(self):
        install = self.path / 'install'
        (install / 'deploy').mkdir(parents=True)
        (install / 'apps').mkdir()
        (install / 'plugins').mkdir()
        (install / '.env.cloud.production').write_text('INTERNAL_QUOTE_SESSION_SECRET=fixture\n')
        (install / 'docker-compose.cloud.yml').write_text('services: {}\n')
        shutil.copy(ROOT / 'deploy/service-maintenance.sh', install / 'deploy')
        script = (ROOT / 'deploy/update-server.sh').read_text().replace(
            'INSTALL_DIR="/opt/rr-portal"', 'INSTALL_DIR="' + str(install) + '"')
        (install / 'deploy/update-server.sh').write_text(script)
        self.states.write_text(json.dumps({svc: 'running/0/unless-stopped/healthy'
                                          for svc in ['db', 'paiji', 'peise', 'nginx']}))
        (self.path / 'compose.json').write_text(json.dumps({'services': {
            'db': {}, 'paiji': {'depends_on': {'db': {}}}, 'peise': {}, 'nginx': {},
        }}))
        git = self.path / 'git'
        git.write_text("#!/usr/bin/env python3\nimport sys\na=sys.argv[1:]\n"
                       "if 'rev-parse' in a: print('before' if a[-1] == 'before' else 'after')\n"
                       "elif 'diff' in a: print('docker-compose.cloud.yml')\n")
        git.chmod(0o755)
        curl = self.path / 'curl'
        curl.write_text('#!/usr/bin/env bash\nexit 0\n')
        curl.chmod(0o755)
        # Share the server fixture's maintenance path with the fake docker assertions.
        shutil.rmtree(install / 'deploy' / 'maintenance', ignore_errors=True)
        (install / 'deploy' / 'maintenance').symlink_to(self.path / 'flags', target_is_directory=True)
        result = self.run_shell('bash "' + str(install / 'deploy/update-server.sh') + '"',
                                'db\npaiji\npeise\nnginx', BEFORE_COMMIT='before', FULL_SCRIPT='1', MAINT_HEALTH_TIMEOUT_SECONDS='2')
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        calls = [json.loads(line) for line in (self.path / 'calls').read_text().splitlines()]
        updates = [a for a in calls if 'up' in a]
        self.assertEqual([a[-1] for a in updates], ['db', 'peise', 'paiji', 'nginx'])
        self.assertTrue(all('--no-deps' in a and '--no-build' in a for a in updates))
        self.assertEqual(list(self.flags.iterdir()), [])


class Backend(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b'other system available')

    do_POST = do_GET

    def log_message(self, *args):
        pass


@unittest.skipUnless(NGINX, 'set NGINX_BIN to run real nginx integration tests')
class NginxTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.path = Path(cls.tmp.name)
        (cls.path / 'logs').mkdir()
        cls.flags = cls.path / 'maintenance/services'
        cls.flags.mkdir(parents=True)
        cls.html = cls.path / 'html'
        cls.html.mkdir()
        (cls.html / 'index.html').write_text('portal available')
        (cls.html / 'favicon.png').write_bytes(b'favicon')
        shutil.copy(ROOT / 'frontend/maintenance.html', cls.html)
        (cls.path / 'htpasswd').write_text('test:{PLAIN}password\n')
        cls.backend = ThreadingHTTPServer(('127.0.0.1', 0), Backend)
        threading.Thread(target=cls.backend.serve_forever, daemon=True).start()
        with contextlib.closing(socket.socket()) as sock:
            sock.bind(('127.0.0.1', 0))
            cls.port = sock.getsockname()[1]
        source = (ROOT / 'nginx/nginx.cloud.conf').read_text()
        source = source.replace('worker_processes auto;', 'worker_processes 1;')
        mime = cls.path / 'mime.types'
        mime.write_text('types { text/html html; image/png png; }\n')
        source = source.replace('include       mime.types;', 'include "' + str(mime) + '";')
        source = source.replace('listen 80;', f'listen 127.0.0.1:{cls.port};')
        source = source.replace('/var/log/nginx', str(cls.path))
        source = source.replace('/var/cache/nginx/rr', str(cls.path / 'cache'))
        source = source.replace('/etc/nginx/.htpasswd', str(cls.path / 'htpasswd'))
        source = source.replace('/etc/nginx/maintenance', str(cls.path / 'maintenance'))
        source = source.replace('/usr/share/nginx/html', str(cls.html))
        source = re.sub(r'set \$ups "[^"\n]+";', f'set $ups "127.0.0.1:{cls.backend.server_port}";', source)
        cls.config = cls.path / 'nginx.conf'
        cls.config.write_text(source)
        cls.command = [str(NGINX), '-p', str(cls.path) + '/', '-c', str(cls.config)]
        result = subprocess.run(cls.command + ['-t'], capture_output=True, text=True)
        if result.returncode:
            cls.backend.shutdown()
            cls.tmp.cleanup()
            raise AssertionError(result.stderr)
        subprocess.run(cls.command, check=True, capture_output=True)
        for _ in range(40):
            try:
                if cls.fetch('/nginx-health')[0] == 200:
                    break
            except OSError:
                time.sleep(.05)
        else:
            raise AssertionError('nginx did not start')

    @classmethod
    def tearDownClass(cls):
        subprocess.run(cls.command + ['-s', 'quit'], capture_output=True)
        cls.backend.shutdown()
        cls.backend.server_close()
        cls.tmp.cleanup()

    def setUp(self):
        for p in self.flags.iterdir():
            p.unlink()
        (self.path / 'maintenance/ON').unlink(missing_ok=True)

    @classmethod
    def fetch(cls, path, auth=True, method='GET'):
        headers = {'Authorization': 'Basic ' + base64.b64encode(b'test:password').decode()} if auth else {}
        req = Request(f'http://127.0.0.1:{cls.port}' + path, headers=headers, method=method)
        try:
            response = urlopen(req, timeout=3)
        except HTTPError as error:
            response = error
        with response:
            return response.status, response.read().decode(), response.headers

    def test_single_system_does_not_block_portal_or_sibling(self):
        (self.flags / 'paiji').touch()
        for path in ['/', '/index.html', '/favicon.png', '/nginx-health', '/peise/health', '/qc/api/health']:
            with self.subTest(path=path):
                self.assertEqual(self.fetch(path)[0], 200)
        status, body, headers = self.fetch('/paiji/', auth=False)
        self.assertEqual(status, 503)
        self.assertIn('当前系统升级维护中', body)
        self.assertIn('返回门户', body)
        self.assertEqual(headers['Retry-After'], '60')
        self.assertIn('no-store', headers['Cache-Control'])
        self.assertEqual(self.fetch('/paiji/api/orders', auth=False, method='POST')[0], 503)
        (self.flags / 'paiji').unlink()
        self.assertEqual(self.fetch('/paiji/')[0], 200)

    def test_legacy_global_flag_is_ignored(self):
        (self.path / 'maintenance/ON').touch()
        for path in ['/', '/nginx-health', '/paiji/', '/peise/health']:
            self.assertEqual(self.fetch(path)[0], 200, path)

    def test_group_routes_bare_paths_assets_and_normalized_uris(self):
        cases = {
            'rr-production': ['/rr', '/rr/api/orders', '/api/injection', '/api/material-prices'],
            'qc': ['/qc', '/qc/api/health', '/q%63/assets/app.js'],
            'qc-plan': ['/qc-plan', '/qc-plan/api/health', '/qc-plan/_next/static/test.js'],
            'voyageplex': ['/voyageplex', '/voyageplex/api/auth/me'],
            'shipping-management': ['/shipping', '/shipping/api/orders'],
            'cpg': ['/cpg', '/cpg/health'],
            'c-store': ['/c-store', '/c-store/health'],
            'erp': ['/erp', '/erp/health'],
            'core': ['/api/auth/login', '/api/admin/users', '/api/plugins', '/health'],
            'quality-portal': ['/portal', '/portal/'],
            'factory-review-test': ['/factory-review-test/health'],
            'sprayplan-test': ['/sprayplan-test/api/health'],
        }
        for key, paths in cases.items():
            with self.subTest(key=key):
                (self.flags / key).touch()
                for path in paths:
                    self.assertEqual(self.fetch(path, auth=False)[0], 503, path)
                self.assertEqual(self.fetch('/')[0], 200)
                self.assertEqual(self.fetch('/peise/health')[0], 200)
                (self.flags / key).unlink()

    def test_route_prefixes_do_not_bleed_into_other_systems(self):
        for key, sibling in [('qc', '/qc-plan/api/health'), ('huadeng', '/huadeng-maorong/health'),
                             ('sprayplan', '/sprayplan-test/api/health'),
                             ('factory-review', '/factory-review-test/health'), ('cpg', '/c-store/health')]:
            with self.subTest(key=key):
                (self.flags / key).touch()
                self.assertEqual(self.fetch(sibling)[0], 200)
                (self.flags / key).unlink()

    def test_every_routed_application_remains_isolated(self):
        cases = {
            'zouhuo': '/zouhuo/', 'figure-mold-cost-system': '/figure-mold-cost-system/',
            'automation-equipment': '/automation-equipment/', 'gongcheng-ziliao': '/gongcheng-ziliao/',
            'jiangping': '/jiangping/', 'toyqms': '/toyqms/', 'qc-report': '/qc-report/',
            'qa-weekly-report': '/qa-weekly-report/', 'production-plan': '/production-plan/',
            'zuru-order-system': '/zuru-order-system/', 'baojia': '/baojia/',
            'internal-quote': '/internal-quote/', 'tomy-paiqi': '/tomy-paiqi/',
            'liwenjuan': '/liwenjuan/', 'zuru-master-schedule': '/zuru-master/',
            'hy-schedule-system': '/hy-schedule/', 'huadeng': '/huadeng/',
            'huadeng-maorong': '/huadeng-maorong/', 'indo-shipping': '/indo-shipping/',
        }
        for key, path in cases.items():
            with self.subTest(key=key):
                (self.flags / key).touch()
                self.assertEqual(self.fetch(path, auth=False)[0], 503)
                self.assertEqual(self.fetch('/')[0], 200)
                self.assertEqual(self.fetch('/paiji/')[0], 200)
                (self.flags / key).unlink()


if __name__ == '__main__':
    unittest.main()
