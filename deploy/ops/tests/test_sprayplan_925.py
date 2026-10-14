"""Offline real SQLite and mocked GET tests: no Docker, SSH, login or production access."""
import base64
import contextlib
import copy
import hashlib
import hmac
import importlib.util
import io
import json
import pathlib
import sqlite3
import subprocess
import tempfile
import unittest
from unittest.mock import patch

MODULE = pathlib.Path(__file__).resolve().parents[1] / 'sprayplan-925.py'
spec = importlib.util.spec_from_file_location('sprayplan_ops_925', MODULE)
ops = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ops)


class OpsTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='sprayplan-925-offline-')
        self.root = pathlib.Path(self.temporary.name)
        self.db = self.root / 'fixture.db'
        self.secret = 'offline-only-test-key-not-an-account-secret-' * 2
        self.users = [{'id': 1, 'username': 'fake-admin', 'role': 'admin', 'factoryId': 'ALL', 'isActive': 1},
                      {'id': 2, 'username': 'fake-clerk', 'role': 'clerk', 'factoryId': 'XINGXIN', 'isActive': 1},
                      {'id': 3, 'username': 'fake-manager', 'role': 'manager', 'factoryId': 'HUADENG', 'isActive': 1}]
        with sqlite3.connect(self.db) as db:
            for table in ops.REQUIRED - {'users', 'orders', 'production_lines', 'production_plans', 'order_part_qtys'}:
                db.execute('CREATE TABLE ' + ops.q(table) + '(id INTEGER)')
            db.execute('CREATE TABLE users(id INTEGER,username TEXT,role TEXT,factoryId TEXT,isActive INTEGER)')
            db.executemany('INSERT INTO users VALUES(:id,:username,:role,:factoryId,:isActive)', self.users)
            db.execute('CREATE TABLE orders(id INTEGER,factoryId TEXT,status TEXT,pendingProduct INTEGER)')
            db.executemany('INSERT INTO orders VALUES(?,?,?,?)', [(10, 'XINGXIN', 'scheduled', 0),
                (20, 'HUADENG', 'completed', 0), (30, 'XINGXIN', 'scheduled', 1)])
            db.execute('CREATE TABLE production_lines(id INTEGER,factoryId TEXT)')
            db.executemany('INSERT INTO production_lines VALUES(?,?)', [(10, 'XINGXIN'), (20, 'HUADENG')])
            db.execute('CREATE TABLE order_part_qtys(id INTEGER,orderId INTEGER,partName TEXT,qty INTEGER)')
            db.executemany('INSERT INTO order_part_qtys VALUES(?,?,?,?)',
                [(1, 10, 'A', 20), (2, 10, 'B', 20), (3, 20, 'A', 8), (4, 30, 'A', 50)])
            db.execute('CREATE TABLE production_plans(id INTEGER,orderId INTEGER,planDate INTEGER,factoryId TEXT,deletedAt INTEGER,'
                       'status TEXT,goodQty INTEGER,inboundQty INTEGER,reportedQty INTEGER,partName TEXT,stepNo INTEGER)')
            db.executemany('INSERT INTO production_plans VALUES(?,?,?,?,?,?,?,?,?,?,?)',
                [(100, 10, 1791936000000, 'XINGXIN', None, 'planned', None, None, None, 'A', 1),
                 (101, 10, 1791936000000, 'XINGXIN', None, 'planned', 5, None, None, 'A', 1),
                 (102, 10, 1791936000000, 'XINGXIN', None, 'recorded', 3, 0, 0, 'B', 1),
                 (200, 20, 1791936000000, 'HUADENG', None, 'planned', None, None, None, 'A', 1)])

    def tearDown(self):
        self.temporary.cleanup()

    def decode(self, cookie):
        parts = dict(v.split('=', 1) for v in cookie.split('; '))
        token = parts['sprayplan_session']
        first, payload, signature = token.split('.')
        expected = base64.urlsafe_b64encode(hmac.new(self.secret.encode(), (first + '.' + payload).encode(), hashlib.sha256).digest()).decode().rstrip('=')
        self.assertEqual(expected, signature)
        claims = json.loads(base64.urlsafe_b64decode(payload + '=' * (-len(payload) % 4)))
        self.assertEqual('sprayplan', claims['iss'])
        self.assertIsInstance(claims['exp'], int)
        return claims, parts['sprayplan_factory']

    def fake_get(self, url, cookie=None):
        if url.startswith('http://127.0.0.1/'):
            return (200, b'{"ok":true}') if url.endswith('/api/health') else (401, b'{}')
        if not cookie:
            return 401, b'{}'
        claims, factory = self.decode(cookie)
        role = claims['http://schemas.microsoft.com/ws/2008/06/identity/claims/role']
        if role != 'admin':
            factory = claims['factoryId']
        identity = next(u for u in self.users if str(u['id']) == claims['userId'])
        self.assertEqual(identity['role'], role)
        self.assertEqual(identity['factoryId'], claims['factoryId'])
        if url.endswith('/api/users'):
            return (200, json.dumps(self.users).encode()) if role == 'admin' else (403, b'{}')
        if '/api/schedule/overview?' in url:
            if 'orderId=2147483647' in url:
                return 200, b'{"lines":[],"plans":[]}'
            rows = [{'id': 100, 'orderId': 10, 'canReschedule': True},
                    {'id': 101, 'orderId': 10, 'canReschedule': False},
                    {'id': 102, 'orderId': 10, 'canReschedule': False}] if factory == 'XINGXIN' \
                    else [{'id': 200, 'orderId': 20, 'canReschedule': False}]
            return 200, json.dumps({'lines': [], 'plans': rows}).encode()
        if url.endswith('/api/orders/overview'):
            return 200, json.dumps([{'id': 10, 'inProductionRemainingQty': 17}, {'id': 30, 'inProductionRemainingQty': 50}]
                                    if factory == 'XINGXIN' else [{'id': 20, 'inProductionRemainingQty': 8}]).encode()
        if url.endswith('/api/dashboard'):
            return 200, json.dumps({'inProductionQty': 17 if factory == 'XINGXIN' else 0}).encode()
        if url.endswith('/api/plans'):
            return 200, json.dumps([{'id': 100, 'canReschedule': True}, {'id': 101, 'canReschedule': False},
                    {'id': 102, 'canReschedule': False}] if factory == 'XINGXIN'
                    else [{'id': 200, 'canReschedule': False}]).encode()
        rows = ([{'id': 10}, {'id': 30}] if url.endswith('/api/orders') else [{'id': 10}]) \
               if factory == 'XINGXIN' else [{'id': 20}]
        return 200, json.dumps(rows).encode()

    @contextlib.contextmanager
    def api_mocks(self, getter=None):
        with patch.object(ops, 'app_context', return_value=('a' * 64, self.db, {'JWT_ISSUER': 'sprayplan'}, self.secret)), \
             patch.object(ops, 'inspect', return_value={'NetworkSettings': {'Networks': {'rr-portal_platform-net': {'IPAddress': '172.22.0.2'}}}}), \
             patch.object(ops, 'get', side_effect=getter or self.fake_get):
            yield

    def test_actual_user_cookies_preserve_roles_and_each_factory(self):
        with self.api_mocks():
            result = ops.api_audit('sprayplan', self.db, deployed=True)
        self.assertEqual(['XINGXIN', 'HUADENG'], result['adminFactoriesVerified'])
        self.assertEqual(['XINGXIN', 'HUADENG'], result['ordinaryFactoriesVerified'])
        self.assertTrue(result['orderFilterVerified'])
        self.assertFalse(result['publicBusinessAndAssetsAuthenticated'])
        self.assertFalse(result['businessWritesPerformed'])

    def test_live_user_management_privilege_leak_is_rejected(self):
        def leak(url, cookie=None):
            status, body = self.fake_get(url, cookie)
            return (200, b'[]') if url.endswith('/api/users') and status == 403 else (status, body)
        with self.api_mocks(leak), self.assertRaises(RuntimeError):
            ops.api_audit('sprayplan', self.db)
        self.assertIn('ordinaryUserManagementPermission', ops.FAILED)

    def test_other_factory_order_leak_is_rejected(self):
        def leak(url, cookie=None):
            status, body = self.fake_get(url, cookie)
            return (200, b'[{"id":10},{"id":20}]') if cookie and url.endswith('/api/orders') else (status, body)
        with self.api_mocks(leak), self.assertRaises(RuntimeError):
            ops.api_audit('sprayplan', self.db)
        self.assertIn('ExactFactoryIsolation', ops.FAILED)

    def test_duplicate_visible_rows_are_rejected(self):
        def duplicate(url, cookie=None):
            status, body = self.fake_get(url, cookie)
            return (200, b'[{"id":10},{"id":10}]') if cookie and url.endswith('/api/orders') else (status, body)
        with self.api_mocks(duplicate), self.assertRaises(RuntimeError):
            ops.api_audit('sprayplan', self.db)

    def test_missing_active_admin_is_rejected_without_creating_one(self):
        with sqlite3.connect(self.db) as db:
            db.execute('UPDATE users SET isActive=0 WHERE id=1')
        with self.api_mocks(), self.assertRaises(RuntimeError):
            ops.api_audit('sprayplan', self.db)
        self.assertEqual('existingActiveAdmin', ops.FAILED)

    def test_absent_staff_is_reported_without_claiming_staff_success(self):
        with sqlite3.connect(self.db) as db:
            db.execute('DELETE FROM users WHERE id=3')
        self.users = [u for u in self.users if u['id'] != 3]
        with self.api_mocks():
            result = ops.api_audit('sprayplan', self.db)
        self.assertEqual(['HUADENG'], result['ordinaryUnavailable'])
        self.assertEqual(['XINGXIN'], result['ordinaryFactoriesVerified'])

    def test_read_only_permissions_probe_does_not_modify_sqlite(self):
        before = ops.sqlite_audit(self.db)
        with self.api_mocks():
            ops.api_audit('sprayplan-test', self.db, deployed=True)
        self.assertEqual(before, ops.sqlite_audit(self.db))

    def test_order_filter_ignoring_order_id_is_rejected(self):
        def ignored(url, cookie=None):
            status, body = self.fake_get(url, cookie)
            return (200, b'{"plans":[{"id":100,"orderId":10}]}') if 'orderId=2147483647' in url else (status, body)
        with self.api_mocks(ignored), self.assertRaises(RuntimeError):
            ops.api_audit('sprayplan', self.db, deployed=True)
        self.assertIn('nonexistentOrderFilterIsEmpty', ops.FAILED)

    def test_wrong_dashboard_count_is_rejected_even_when_schema_looks_valid(self):
        def wrong(url, cookie=None):
            status, body = self.fake_get(url, cookie)
            return (200, b'{"inProductionQty":67}') if url.endswith('/api/dashboard') else (status, body)
        with self.api_mocks(wrong), self.assertRaises(RuntimeError):
            ops.api_audit('sprayplan', self.db, deployed=True)
        self.assertIn('compiledBackendDashboardRemainingQuantityExact', ops.FAILED)

    def test_actual_zero_or_completed_order_plan_cannot_be_reported_reschedulable(self):
        def wrong(url, cookie=None):
            status, body = self.fake_get(url, cookie)
            if url.endswith('/api/plans'):
                rows = json.loads(body)
                rows[-1]['canReschedule'] = True
                return status, json.dumps(rows).encode()
            return status, body
        with self.api_mocks(wrong), self.assertRaises(RuntimeError):
            ops.api_audit('sprayplan', self.db, deployed=True)
        self.assertIn('compiledBackendPlanEligibilityExact', ops.FAILED)

    def test_multi_part_quantity_uses_complete_sets_and_counts_all_steps(self):
        with sqlite3.connect(self.db) as connection:
            self.assertEqual(17, ops.remaining_quantity(connection, 10))
            connection.execute('INSERT INTO production_plans VALUES(103,10,1791936000000,"XINGXIN",NULL,"recorded",1,NULL,NULL,"A",2)')
            self.assertEqual(19, ops.remaining_quantity(connection, 10))
            connection.execute('UPDATE production_plans SET deletedAt=1 WHERE id=103')
            self.assertEqual(17, ops.remaining_quantity(connection, 10))

    def test_foreign_factory_actuals_do_not_reduce_this_factory_remaining_quantity(self):
        with sqlite3.connect(self.db) as connection:
            connection.execute('INSERT INTO production_plans VALUES(900,10,1791936000000,"HUADENG",NULL,"recorded",100,NULL,NULL,"B",1)')
            self.assertEqual(17, ops.remaining_quantity(connection, 10))

    def test_factory_hidden_owner_is_ineligible(self):
        with sqlite3.connect(self.db) as connection:
            connection.execute('INSERT INTO production_plans VALUES(900,10,1791936000000,"HUADENG",NULL,"planned",NULL,NULL,NULL,"A",1)')
            ops.verify_plan_eligibility(connection, [{'id': 900, 'canReschedule': False}], 'sprayplan')
            with self.assertRaises(RuntimeError):
                ops.verify_plan_eligibility(connection, [{'id': 900, 'canReschedule': True}], 'sprayplan')

    def test_deployed_read_probe_matches_required_owner_join_factory_visibility(self):
        with sqlite3.connect(self.db) as connection:
            # API Include(Order) uses an inner join to the filtered order table.
            connection.execute('INSERT INTO production_plans VALUES(900,10,1791936000000,"HUADENG",NULL,"planned",NULL,NULL,NULL,"A",1)')
            connection.execute('INSERT INTO production_plans VALUES(901,20,1791936000000,"XINGXIN",NULL,"recorded",100,NULL,NULL,"A",1)')
        before = ops.sqlite_audit(self.db)
        with self.api_mocks():
            result = ops.api_audit('sprayplan', self.db, deployed=True)
        self.assertTrue(result['orderFilterVerified'])
        self.assertTrue(result['remainingQuantityAndPlanEligibilityVerified'])
        self.assertEqual(before, ops.sqlite_audit(self.db))

    def test_deployed_api_leaking_plan_with_hidden_owner_is_rejected(self):
        with sqlite3.connect(self.db) as connection:
            connection.execute('INSERT INTO production_plans VALUES(900,10,1791936000000,"HUADENG",NULL,"planned",NULL,NULL,NULL,"A",1)')
        def leak(url, cookie=None):
            status, body = self.fake_get(url, cookie)
            if cookie and url.endswith('/api/plans'):
                claims, factory = self.decode(cookie)
                if factory == 'HUADENG':
                    rows = json.loads(body)
                    rows.append({'id': 900, 'canReschedule': False})
                    return status, json.dumps(rows).encode()
            return status, body
        with self.api_mocks(leak), self.assertRaises(RuntimeError):
            ops.api_audit('sprayplan', self.db, deployed=True)
        self.assertIn('compiledBackendAllPlansFactoryComplete', ops.FAILED)

    def test_urls_outside_validated_local_bases_are_rejected(self):
        for url in ['https://example.org/', 'http://127.0.0.1.evil.example/', 'http://172.22.0.2:8400/sprayplan/api/orders']:
            with self.subTest(url=url), self.assertRaises(RuntimeError):
                ops.get(url, 'private-cookie-do-not-send')

    def runtime_fixture(self, image):
        return {'configEnvSha256': 'e' * 64, 'processEnvironments': {p: {'completeSha256': 'f' * 64,
                'withoutHostnameSha256': 'f' * 64, 'hostname': 'test-host'} for p in ('api', 'web')},
                'containerHostname': 'test-host', 'containerId': 'a' * 64, 'explicitHostnameConfigured': False,
                'secretSha256': 's' * 64, 'issuer': 'sprayplan', 'imageId': image, 'healthy': True}

    def verify_fixture(self, api_failure=False):
        archive = self.root / 'backup'
        archive.mkdir()
        (archive / 'env.before').write_bytes(b'offline-env')
        (self.root / '.env.cloud.production').write_bytes(b'offline-env')
        audit = ops.sqlite_audit(self.db)
        files = {'files': 2, 'bytes': 80, 'sha256': 'x' * 64}
        cores = {s: {'containerId': 'a' * 64, 'startedAt': 'before', 'restartCount': 13,
                     'running': True, 'status': 'running', 'health': 'healthy', 'oomKilled': False} for s in ops.CORE}
        core_now = copy.deepcopy(cores)
        core_now['printlink']['restartCount'] = 14
        before = {'coreLifecycle': cores, 'configurationFiles': {'configuration': 'k' * 64},
                  'services': {s: {'database': audit, 'files': files, 'runtime': self.runtime_fixture('old-image')}
                               for s in ops.SERVICES}}
        def api(service, snapshot, deployed):
            if api_failure and service == 'sprayplan':
                ops.FAILED = 'offlinePermissionFailure'
                raise RuntimeError('private-credential-must-not-be-output')
            return {'businessWritesPerformed': False}
        with patch.object(ops, 'ROOT', self.root), patch.object(ops, 'selected_backup', return_value=(archive, before)), \
             patch.object(ops, 'source_commit', return_value='a' * 40), patch.object(ops, 'core_state', return_value=core_now), \
             patch.object(ops, 'configuration', return_value=before['configurationFiles']), \
             patch.object(ops, 'run', side_effect=lambda args, **kwargs: (ops.APP + '/src/mock.ts\n').encode() if '--name-only' in args else b''), \
             patch.object(ops, 'snapshot_now', return_value=(self.db, audit)), \
             patch.object(ops, 'runtime', return_value=self.runtime_fixture('new-image')), \
             patch.object(ops, 'file_inventory', return_value=files), patch.object(ops, 'api_audit', side_effect=api), \
             patch.object(ops, 'frontend_audit', return_value={'allDirectApplicationStaticAssetsMatchContainer': True}):
            return ops.verify('verify', 'a' * 40, str(archive))

    def test_core_restart_keeps_both_database_results_but_fails_strict_verification(self):
        result, passed = self.verify_fixture()
        self.assertFalse(passed)
        self.assertFalse(result['checks']['coreLifecyclePreserved'])
        self.assertEqual(set(ops.SERVICES), set(result['services']))
        self.assertTrue(all(s['checks']['allTablesPreserved'] for s in result['services'].values()))

    def test_one_permission_probe_failure_keeps_both_data_results_and_redacts_exception(self):
        result, passed = self.verify_fixture(api_failure=True)
        self.assertFalse(passed)
        self.assertEqual(set(ops.SERVICES), set(result['services']))
        self.assertTrue(result['services']['sprayplan-test']['checks']['readOnlyApiChecksPassed'])
        text = json.dumps(result)
        self.assertNotIn('private-credential', text)
        self.assertIn('offlinePermissionFailure', text)

    def test_inexact_or_missing_backup_arguments_fail_before_any_operation(self):
        cases = [[], ['backup', 'b' * 40, ops.BEFORE, ''], ['backup', ops.BEFORE, 'a' * 40, ''],
                 ['verify', ops.BEFORE, 'a' * 40, ''], ['verify', ops.BEFORE, ops.BEFORE, '/tmp/private']]
        with patch.object(ops, 'backup') as backup, patch.object(ops, 'verify') as verify:
            for case in cases:
                with self.subTest(case=case), self.assertRaises(RuntimeError):
                    ops.main(case)
            backup.assert_not_called()
            verify.assert_not_called()


class PreflightGitTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='sprayplan-preflight-offline-')
        self.root = pathlib.Path(self.temporary.name)
        self.app = self.root / ops.APP
        self.app.mkdir(parents=True)
        self.source = self.app / 'source.txt'
        self.source.write_bytes(b'private-source-content-not-in-diagnostic-output\nsecond-line\n')
        self.source.chmod(0o644)
        self.keep = self.app / 'data/.gitkeep'
        self.keep.parent.mkdir()
        self.keep.write_bytes(b'\n')
        self.keep.chmod(0o644)
        self.git('init', '-q')
        self.git('config', 'user.name', 'Offline Test')
        self.git('config', 'user.email', 'offline@example.invalid')
        self.git('config', 'core.fileMode', 'true')
        self.git('add', '--', ops.APP)
        self.git('commit', '-qm', 'isolated fixture')
        self.before = self.git('rev-parse', 'HEAD').decode().strip()
        self.git('update-ref', 'refs/remotes/origin/main', self.before)

    def tearDown(self):
        self.temporary.cleanup()

    def git(self, *args):
        return subprocess.run(['git', *args], cwd=self.root, stdout=subprocess.PIPE,
                              stderr=subprocess.PIPE, check=True).stdout

    def preflight(self):
        with patch.object(ops, 'ROOT', self.root), patch.object(ops, 'BEFORE', self.before):
            return ops.preflight()

    def test_clean_repo_has_no_tracked_differences_and_no_writes(self):
        before = self.source.read_bytes()
        index = (self.root / '.git/index').read_bytes()
        result = self.preflight()
        self.assertTrue(result['trackedApplicationSourceClean'])
        self.assertEqual([], result['trackedDifferences'])
        self.assertFalse(result['applicationCheckoutWritesPerformed'])
        self.assertEqual(index, (self.root / '.git/index').read_bytes())
        self.assertEqual(before, self.source.read_bytes())

    def test_placeholder_mode_only_is_reported_without_restoring_mode(self):
        self.keep.chmod(0o777)
        index = (self.root / '.git/index').read_bytes()
        result = self.preflight()
        row, = result['trackedDifferences']
        self.assertEqual('data/.gitkeep', row['path'])
        self.assertEqual('100644', row['headGitMode'])
        self.assertEqual('100755', row['diskGitMode'])
        self.assertEqual('0777', row['diskPermissions'])
        self.assertTrue(row['onlyModeChange'])
        self.assertFalse(row['onlyLineEndingChange'])
        self.assertEqual(row['headSha256'], row['diskSha256'])
        self.assertEqual(1, row['headBytes'])
        self.assertEqual(1, row['diskBytes'])
        self.assertEqual(0o777, self.keep.stat().st_mode & 0o777)
        self.assertEqual(index, (self.root / '.git/index').read_bytes())

    def test_content_difference_is_hashed_but_never_printed(self):
        self.source.write_bytes(b'private-changed-content-must-not-be-shown\n')
        result = self.preflight()
        row, = result['trackedDifferences']
        self.assertFalse(row['onlyModeChange'])
        self.assertFalse(row['onlyLineEndingChange'])
        self.assertNotEqual(row['headSha256'], row['diskSha256'])
        self.assertNotIn('private-source-content', json.dumps(result))
        self.assertNotIn('private-changed-content', json.dumps(result))

    def test_crlf_only_is_distinguished_from_content_and_mode_changes(self):
        self.source.write_bytes(self.source.read_bytes().replace(b'\n', b'\r\n'))
        row, = self.preflight()['trackedDifferences']
        self.assertTrue(row['onlyLineEndingChange'])
        self.assertFalse(row['onlyModeChange'])
        self.source.chmod(0o755)
        row, = self.preflight()['trackedDifferences']
        self.assertFalse(row['onlyLineEndingChange'])
        self.assertFalse(row['onlyModeChange'])

    def test_deleted_source_has_only_head_hash_and_missing_disk(self):
        self.source.unlink()
        row, = self.preflight()['trackedDifferences']
        self.assertEqual('D', row['changeType'])
        self.assertEqual('missing', row['diskKind'])
        self.assertIsNotNone(row['headSha256'])
        self.assertIsNone(row['diskSha256'])

    def test_placeholder_content_difference_is_hashed_and_backup_still_rejects_it(self):
        self.keep.write_bytes(b'private-data-must-not-be-an-allowed-placeholder')
        result = self.preflight()
        row, = result['trackedDifferences']
        self.assertFalse(row['onlyModeChange'])
        self.assertNotEqual(row['headSha256'], row['diskSha256'])
        self.assertNotIn('private-data-must-not', json.dumps(result))
        with patch.object(ops, 'ROOT', self.root), patch.object(ops, 'BEFORE', self.before):
            with self.assertRaises(RuntimeError):
                ops.backup()
        self.assertEqual('trackedApplicationSourceClean', ops.FAILED)

    def test_env_directory_gitkeep_does_not_bypass_tracked_source_scope(self):
        private = self.app / '.env-private/.gitkeep'
        private.parent.mkdir()
        private.write_bytes(b'')
        self.git('add', '--', str(private.relative_to(self.root)))
        with self.assertRaises(RuntimeError):
            self.preflight()
        self.assertEqual('trackedSourceOnly', ops.FAILED)

    def test_other_private_directory_gitkeep_is_not_treated_as_source_placeholder(self):
        private = self.app / 'uploads/customer/.gitkeep'
        private.parent.mkdir(parents=True)
        private.write_bytes(b'')
        self.git('add', '--', str(private.relative_to(self.root)))
        with self.assertRaises(RuntimeError):
            self.preflight()
        self.assertEqual('trackedSourceOnly', ops.FAILED)

    def test_staged_addition_is_tracked_but_untracked_business_and_other_apps_are_ignored(self):
        added = self.app / 'added.ts'
        added.write_text('private-added-source')
        self.git('add', '--', str(added.relative_to(self.root)))
        (self.app / 'data/customer-records.db').write_bytes(b'private-business-data')
        (self.root / 'outside.txt').write_text('private-other-app')
        self.git('add', '--', 'outside.txt')
        row, = self.preflight()['trackedDifferences']
        self.assertEqual('added.ts', row['path'])
        self.assertEqual('A', row['changeType'])
        self.assertIsNone(row['headSha256'])
        self.assertIsNotNone(row['diskSha256'])

    def test_symlink_type_change_hashes_target_only_without_reading_outside_file(self):
        outside = self.root / 'outside-secret'
        outside.write_bytes(b'private-external-secret-not-readable')
        self.source.unlink()
        self.source.symlink_to(outside)
        row, = self.preflight()['trackedDifferences']
        self.assertEqual('T', row['changeType'])
        self.assertEqual('symlink-target-only', row['diskKind'])
        self.assertEqual(hashlib.sha256(bytes(str(outside), 'utf-8')).hexdigest(), row['diskSha256'])
        self.assertNotEqual(hashlib.sha256(outside.read_bytes()).hexdigest(), row['diskSha256'])

    def test_preflight_main_requires_exact_before_target_and_empty_backup(self):
        with patch.object(ops, 'preflight') as preflight:
            for target, backup in [('a' * 40, ''), (ops.BEFORE, '/tmp/old-backup')]:
                with self.assertRaises(RuntimeError):
                    ops.main(['preflight', ops.BEFORE, target, backup])
            preflight.assert_not_called()


if __name__ == '__main__':
    unittest.main()
