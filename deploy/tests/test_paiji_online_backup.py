"""Exercise the real backup code on a committed WAL database through a fake Docker.

No daemon, production database, workflow dispatch, or network is used.
"""
import hashlib
import json
import os
from pathlib import Path
import shutil
import sqlite3
import stat
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
SERVER = ROOT / 'apps/生产部/注塑啤机排产系统/server'
NODE = shutil.which('node') or '/Users/fovo/erp-tools/node/bin/node'
SCRIPT = ROOT / 'deploy/paiji-online-backup.sh'


class PaijiOnlineBackupTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name)
        self.bin = self.path / 'bin'
        self.bin.mkdir()
        self.db_path = self.path / 'live.db'
        self.db = sqlite3.connect(self.db_path)
        self.addCleanup(self.db.close)
        self.db.execute('PRAGMA journal_mode=WAL')
        self.db.execute('PRAGMA wal_autocheckpoint=0')
        self.db.execute('CREATE TABLE orders(id INTEGER PRIMARY KEY, quantity INTEGER)')
        self.db.execute('INSERT INTO orders VALUES(1, 123)')
        self.db.commit()
        # The committed row is still in WAL, so copying only live.db would fail.
        self.assertGreater(Path(str(self.db_path) + '-wal').stat().st_size, 0)
        docker = self.bin / 'docker'
        docker.write_text('''#!/usr/bin/env python3
import json, os, pathlib, shutil, subprocess, sys, tempfile
p = pathlib.Path(os.environ['FIXTURE_DIR'])
args = sys.argv[1:]
with (p / 'calls').open('a') as f: f.write(json.dumps(args) + '\\n')
if args[0] == 'compose':
    assert args == ['compose','-f','docker-compose.cloud.yml','--env-file','.env.cloud.production','ps','-q','paiji']
    print('a'*64 if not os.environ.get('DUPLICATE') else 'a'*64+'\\n'+'b'*64)
elif args[0] == 'inspect':
    assert args[1:] == ['-f','{{.State.Running}}','a'*64]
    print('true')
elif args[:3] == ['exec','a'*64,'mktemp']:
    print(tempfile.mkdtemp(prefix='paiji-online-backup.', dir='/tmp'))
elif args[:4] == ['exec','-i','a'*64,'node']:
    assert args[4] == '-'
    code = sys.stdin.read().replace("'/app/data/paiji.db'", json.dumps(str(p/'live.db')))
    if os.environ.get('FAIL_BACKUP'): sys.exit(7)
    result = subprocess.run([os.environ['FIXTURE_NODE'],'-',args[5]],input=code,text=True,cwd=os.environ['FIXTURE_SERVER'])
    sys.exit(result.returncode)
elif args[0] == 'cp':
    assert args[1].startswith('a'*64+':/tmp/paiji-online-backup.')
    shutil.copyfile(args[1].split(':',1)[1], args[2])
    if os.environ.get('CORRUPT_COPY'): pathlib.Path(args[2]).write_bytes(b'corrupt')
elif args[:4] == ['exec','a'*64,'rm','-rf']:
    assert args[4] == '--' and args[5].startswith('/tmp/paiji-online-backup.')
    shutil.rmtree(args[5])
else: raise AssertionError('unexpected Docker operation')
''')
        docker.chmod(0o755)
        self.env = {**os.environ, 'INSTALL_DIR': str(self.path), 'FIXTURE_DIR': str(self.path),
                    'FIXTURE_NODE': NODE, 'FIXTURE_SERVER': str(SERVER),
                    'PATH': str(self.bin) + os.pathsep + os.environ.get('PATH', '')}

    def run_backup(self, **extra):
        return subprocess.run(['bash', str(SCRIPT)], env={**self.env, **extra}, capture_output=True, text=True)

    def test_committed_wal_rows_integrity_hash_and_private_permissions(self):
        before = self.db.execute('SELECT * FROM orders').fetchall()
        result = self.run_backup()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        manifests = list((self.path / 'deploy/backups/paiji').glob('*/manifest.json'))
        self.assertEqual(len(manifests), 1)
        manifest = json.loads(manifests[0].read_text())
        snapshot = manifests[0].parent / 'paiji.db'
        self.assertEqual(manifest['counts']['orders'], 1)
        self.assertEqual(manifest['sha256'], hashlib.sha256(snapshot.read_bytes()).hexdigest())
        with sqlite3.connect(snapshot.as_uri() + '?mode=ro&immutable=1', uri=True) as copied:
            self.assertEqual(copied.execute('SELECT * FROM orders').fetchall(), before)
            self.assertEqual(copied.execute('PRAGMA integrity_check').fetchall(), [('ok',)])
        self.assertEqual(self.db.execute('SELECT * FROM orders').fetchall(), before)
        for path in (manifests[0], snapshot):
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
        self.assertEqual(stat.S_IMODE(manifests[0].parent.stat().st_mode), 0o700)
        calls = [json.loads(line) for line in (self.path / 'calls').read_text().splitlines()]
        self.assertFalse(any('up' in call or 'restart' in call for call in calls))

    def test_online_backup_failure_is_fatal_without_raw_copy(self):
        result = self.run_backup(FAIL_BACKUP='1')
        self.assertNotEqual(result.returncode, 0)
        calls = [json.loads(line) for line in (self.path / 'calls').read_text().splitlines()]
        self.assertFalse(any(call[0] == 'cp' for call in calls))
        self.assertEqual(self.db.execute('SELECT quantity FROM orders').fetchall(), [(123,)])

    def test_corrupted_host_copy_is_rejected(self):
        self.assertNotEqual(self.run_backup(CORRUPT_COPY='1').returncode, 0)

    def test_multiple_containers_are_rejected_before_backup(self):
        result = self.run_backup(DUPLICATE='1')
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse((self.path / 'deploy').exists())

    def test_deployment_gate_precedes_container_recreate(self):
        deploy = (ROOT / 'deploy/update-server.sh').read_text()
        gate = deploy.index('bash "$INSTALL_DIR/deploy/paiji-online-backup.sh"')
        self.assertLess(gate, deploy.index('save_state "deploy"'))
        self.assertIn('[[ " ${AFFECTED_SERVICES[*]} " == *" paiji "* ]]', deploy[:gate])
        self.assertNotIn('|| true', deploy[gate:gate + 100])


if __name__ == '__main__':
    unittest.main()
