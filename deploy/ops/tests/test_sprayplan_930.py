"""Offline real SQLite and mocked GET tests: no Docker, SSH, login or production access."""
import base64
import contextlib
import copy
import hashlib
import hmac
import importlib.util
import io
import json
import os
import pathlib
import sqlite3
import subprocess
import tarfile
import tempfile
import unittest
from unittest.mock import patch

MODULE = pathlib.Path(__file__).resolve().parents[1] / 'sprayplan-930.py'
spec = importlib.util.spec_from_file_location('sprayplan_ops_930', MODULE)
ops = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ops)


class OpsTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='sprayplan-930-offline-')
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
        return {'configEnvSha256': 'e' * 64, 'protectedConfigEnvSha256': 'e' * 64,
                'imageInheritedVersionMetadataValidated': True, 'publicVersionMetadata': {'DOTNET_VERSION': '8.0.1', 'ASPNET_VERSION': '8.0.1'}, 'processEnvironments': {p: {'completeSha256': 'f' * 64,
                'withoutHostnameSha256': 'f' * 64, 'protectedSha256': 'f' * 64, 'withoutVersionMetadataSha256': 'f' * 64, 'hostname': 'test-host'} for p in ('api', 'web')},
                'containerHostname': 'test-host', 'containerId': 'a' * 64, 'explicitHostnameConfigured': False,
                'secretSha256': 's' * 64, 'issuer': 'sprayplan', 'imageId': image, 'healthy': True}

    def verify_fixture(self, api_failure=False, nginx_failure=False):
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
        before = {'coreLifecycle': cores, 'nginxProtected': {'config': 'x'}, 'configurationFiles': {'configuration': 'k' * 64},
                  'trackedSourceMetadata': [],
                  'historicalSqliteArchiveMetadata': {s: {'sqliteCandidates': []} for s in ops.SERVICES},
                  'services': {s: {'database': audit, 'files': files, 'runtime': self.runtime_fixture('old-image')}
                               for s in ops.SERVICES}}
        def api(service, snapshot, deployed):
            if api_failure and service == 'sprayplan':
                ops.FAILED = 'offlinePermissionFailure'
                raise RuntimeError('private-credential-must-not-be-output')
            return {'businessWritesPerformed': False}
        with patch.object(ops, 'ROOT', self.root), patch.object(ops, 'selected_backup', return_value=(archive, before)), \
             patch.object(ops, 'tested_source_guard', return_value={'allDeployedGitBlobsAndCheckoutFilesMatchFinalTestedSource': True}), \
             patch.object(ops, 'source_commit', return_value='a' * 40), patch.object(ops, 'core_state', return_value=core_now), \
             patch.object(ops, 'configuration', return_value=before['configurationFiles']), \
             patch.object(ops, 'nginx_protected', return_value={'config': 'different'} if nginx_failure else before['nginxProtected']), \
             patch.object(ops, 'tracked_application_source_guard', return_value=[]), \
             patch.object(ops, 'static_sqlite_archive_guard', return_value=before['historicalSqliteArchiveMetadata']), \
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

    def test_actual_nginx_authorization_change_fails_strict_after_both_data_results(self):
        result, passed = self.verify_fixture(nginx_failure=True)
        self.assertFalse(passed)
        self.assertFalse(result['checks']['actualNginxConfigurationAndAuthorizationPreserved'])
        self.assertEqual(set(ops.SERVICES), set(result['services']))
        self.assertTrue(all(s['checks']['allTablesPreserved'] for s in result['services'].values()))


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
        self.storage_keep = self.app / 'storage/pdf/.gitkeep'
        self.storage_keep.parent.mkdir(parents=True)
        self.storage_keep.write_bytes(b'\n')
        self.storage_keep.chmod(0o644)
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
        with patch.object(ops, 'ROOT', self.root), patch.object(ops, 'BEFORE', self.before), \
             patch.object(ops, 'extra_sqlite_candidate_metadata', return_value={}):
            return ops.preflight()

    def source_guard(self):
        with patch.object(ops, 'ROOT', self.root):
            return ops.tracked_application_source_guard()

    def permitted_markers(self):
        self.keep.chmod(0o777)
        self.storage_keep.chmod(0o777)

    def test_source_guard_preserves_exact_observed_marker_modes_and_git_index(self):
        self.assertEqual([], self.source_guard())
        self.permitted_markers()
        index = (self.root / '.git/index').read_bytes()
        changes = self.source_guard()
        self.assertEqual({'data/.gitkeep', 'storage/pdf/.gitkeep'}, {r['path'] for r in changes})
        self.assertEqual(changes, self.source_guard())
        self.assertEqual(index, (self.root / '.git/index').read_bytes())
        self.assertEqual(0o777, self.keep.stat().st_mode & 0o777)
        self.assertEqual(0o777, self.storage_keep.stat().st_mode & 0o777)

    def test_source_guard_rejects_extra_executable_source_mode(self):
        self.permitted_markers()
        self.source.chmod(0o755)
        with self.assertRaises(RuntimeError):
            self.source_guard()
        self.assertEqual('trackedApplicationSourceClean', ops.FAILED)

    def test_source_guard_rejects_code_content_changes_with_valid_markers(self):
        self.permitted_markers()
        self.source.write_bytes(b'private-code-change')
        with self.assertRaises(RuntimeError):
            self.source_guard()
        self.assertEqual('trackedApplicationSourceClean', ops.FAILED)

    def test_source_guard_rejects_marker_permission_drift(self):
        self.permitted_markers()
        self.source_guard()
        self.keep.chmod(0o775)
        with self.assertRaises(RuntimeError):
            self.source_guard()
        self.assertEqual('trackedApplicationSourceClean', ops.FAILED)

    def test_source_guard_rejects_marker_content_changes_with_valid_modes(self):
        self.permitted_markers()
        self.keep.write_bytes(b'\r\n')
        with self.assertRaises(RuntimeError):
            self.source_guard()
        self.assertEqual('trackedApplicationSourceClean', ops.FAILED)

    def test_source_guard_rejects_marker_type_change(self):
        self.permitted_markers()
        self.keep.unlink()
        self.keep.symlink_to(self.source)
        with self.assertRaises(RuntimeError):
            self.source_guard()
        self.assertEqual('trackedApplicationSourceClean', ops.FAILED)

    def test_source_guard_rejects_incomplete_observed_marker_pair(self):
        self.keep.chmod(0o777)
        with self.assertRaises(RuntimeError):
            self.source_guard()
        self.assertEqual('trackedApplicationSourceClean', ops.FAILED)

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


class SqliteCandidateTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='sprayplan-candidates-offline-')
        self.root = pathlib.Path(self.temporary.name)
        self.handles = []
        for data, storage in ops.SERVICES.values():
            (self.root / ops.APP / data).mkdir(parents=True)
            (self.root / ops.APP / storage).mkdir(parents=True)
            self.database(self.root / ops.APP / data / 'sprayplan.db')

    def tearDown(self):
        for db in self.handles:
            db.close()
        self.temporary.cleanup()

    def database(self, path):
        path.parent.mkdir(parents=True, exist_ok=True)
        with sqlite3.connect(path) as db:
            db.execute('CREATE TABLE private_fixture(id INTEGER,value TEXT)')
            db.execute('INSERT INTO private_fixture VALUES(1,"private-row-never-output")')
        db.close()
        return path

    def context(self, service):
        path = self.root / ops.APP / ops.SERVICES[service][0] / 'sprayplan.db'
        return 'a' * 64, path, {}, 'private-jwt-never-output'

    def inspect(self, host=None, container=None):
        with patch.object(ops, 'ROOT', self.root), patch.object(ops, 'app_context', side_effect=self.context), \
             patch.object(ops, 'host_candidate_fds', side_effect=lambda identities: (host or {'complete': True, 'found': []})
                          if identities else {'complete': True, 'found': []}), \
             patch.object(ops, 'run', return_value=json.dumps(container or {'complete': True, 'found': []}).encode()):
            return ops.extra_sqlite_candidate_metadata()

    def static_fixture(self):
        expected = {}
        for service, (data, storage) in ops.SERVICES.items():
            name = 'sprayplan.db.bak.20261015-130000'
            path = self.database(self.root / ops.APP / data / name)
            expected[service] = {name: (path.stat().st_size, hashlib.sha256(path.read_bytes()).hexdigest())}
        return expected, self.inspect()

    def archive_guard(self, expected, metadata):
        with patch.object(ops, 'OBSERVED_SQLITE_ARCHIVES', expected), \
             patch.object(ops, 'extra_sqlite_candidate_metadata', return_value=metadata):
            return ops.static_sqlite_archive_guard()

    def test_archive_guard_accepts_only_complete_observed_static_metadata(self):
        expected, metadata = self.static_fixture()
        self.assertEqual(metadata, self.archive_guard(expected, metadata))
        self.assertNotIn('private-row', json.dumps(metadata))

    def test_archive_guard_rejects_missing_extra_and_unknown_database_inventory(self):
        expected, metadata = self.static_fixture()
        for change in ('missing', 'extra', 'unknown'):
            value = copy.deepcopy(metadata)
            rows = value['sprayplan']['sqliteCandidates']
            if change == 'missing':
                rows.clear()
            elif change == 'extra':
                row = copy.deepcopy(rows[0]); row['relativePath'] = 'sprayplan.db.bak.20261015-140000'; rows.append(row)
            else:
                rows[0].pop('relativePath'); rows[0]['pathSha256'] = 'b' * 64
            with self.subTest(change=change), self.assertRaises(RuntimeError):
                self.archive_guard(expected, value)

    def test_archive_guard_rejects_changed_bytes_hash_mount_and_unsafe_occupancy(self):
        expected, metadata = self.static_fixture()
        cases = [('bytes', 1), ('sha256', 'b' * 64), ('mountName', 'storage'), ('service', 'sprayplan-test'),
                 ('integrityCheckOk', False), ('sameAsLivePrimaryFile', True), ('hostFdProbeComplete', False),
                 ('containerFdProbeComplete', False), ('hostOpenFileDescriptorFound', True),
                 ('containerOpenFileDescriptorFound', None), ('exists', False)]
        for key, changed in cases:
            value = copy.deepcopy(metadata)
            value['sprayplan']['sqliteCandidates'][0][key] = changed
            with self.subTest(key=key), self.assertRaises(RuntimeError):
                self.archive_guard(expected, value)
        for ending in ('-wal', '-shm', '-journal'):
            value = copy.deepcopy(metadata)
            value['sprayplan']['sqliteCandidates'][0]['sidecars'][ending] = {'exists': True, 'bytes': 0, 'sha256': 'c' * 64}
            with self.subTest(sidecar=ending), self.assertRaises(RuntimeError):
                self.archive_guard(expected, value)

    def test_file_archive_preserves_verified_database_bytes_and_excludes_live_primary(self):
        expected, metadata = self.static_fixture()
        rows = self.archive_guard(expected, metadata)['sprayplan']['sqliteCandidates']
        path = self.root / ops.APP / 'data' / rows[0]['relativePath']
        original = path.read_bytes()
        archive = self.root / 'files.tar'
        with patch.object(ops, 'ROOT', self.root), patch.object(ops, 'OBSERVED_SQLITE_ARCHIVES', expected):
            inventory = ops.file_inventory('sprayplan', archive, rows)
            ops.validate_archive(archive, inventory)
            with self.assertRaises(RuntimeError):
                ops.file_inventory('sprayplan')
        with tarfile.open(archive) as tar:
            self.assertEqual(['data/' + rows[0]['relativePath']], tar.getnames())
            self.assertEqual(original, tar.extractfile(tar.getmembers()[0]).read())
        self.assertEqual(original, path.read_bytes())

    def test_file_archive_rejects_database_changes_after_metadata_verification(self):
        expected, metadata = self.static_fixture()
        rows = self.archive_guard(expected, metadata)['sprayplan']['sqliteCandidates']
        path = self.root / ops.APP / 'data' / rows[0]['relativePath']
        db = sqlite3.connect(path)
        db.execute('INSERT INTO private_fixture VALUES(2,"private-changed-row")'); db.commit(); db.close()
        with patch.object(ops, 'ROOT', self.root), patch.object(ops, 'OBSERVED_SQLITE_ARCHIVES', expected):
            with self.assertRaises(RuntimeError):
                ops.file_inventory('sprayplan', sqlite_archives=rows)
        self.assertEqual('noUnaccountedLiveSqliteFiles', ops.FAILED)

    def test_file_archive_rejects_new_sidecars_after_metadata_verification(self):
        expected, metadata = self.static_fixture()
        rows = self.archive_guard(expected, metadata)['sprayplan']['sqliteCandidates']
        path = self.root / ops.APP / 'data' / rows[0]['relativePath']
        pathlib.Path(str(path) + '-wal').write_bytes(b'private-wal')
        with patch.object(ops, 'ROOT', self.root), patch.object(ops, 'OBSERVED_SQLITE_ARCHIVES', expected):
            with self.assertRaises(RuntimeError):
                ops.file_inventory('sprayplan', sqlite_archives=rows)
        self.assertEqual('noUnaccountedLiveSqliteFiles', ops.FAILED)

    def test_file_archive_rejects_unobserved_database_even_if_known_files_are_valid(self):
        expected, metadata = self.static_fixture()
        rows = self.archive_guard(expected, metadata)['sprayplan']['sqliteCandidates']
        self.database(self.root / ops.APP / 'data' / 'sprayplan.db.bak.20261015-140000')
        with patch.object(ops, 'ROOT', self.root), patch.object(ops, 'OBSERVED_SQLITE_ARCHIVES', expected):
            with self.assertRaises(RuntimeError):
                ops.file_inventory('sprayplan', sqlite_archives=rows)
        self.assertEqual('noUnaccountedLiveSqliteFiles', ops.FAILED)

    def test_known_timestamp_snapshot_only_exposes_metadata_and_not_business_rows(self):
        path = self.database(self.root / ops.APP / 'data/sprayplan.db.snapshot.20261015-130000')
        original = path.read_bytes()
        result = self.inspect()
        row, = result['sprayplan']['sqliteCandidates']
        self.assertEqual('sprayplan.db.snapshot.20261015-130000', row['relativePath'])
        self.assertEqual('timestamp-named-snapshot-candidate', row['category'])
        self.assertTrue(row['integrityCheckOk'])
        self.assertEqual('main-file-immutable-ignores-sidecars', row['integrityScope'])
        self.assertFalse(row['inactiveStatusProven'])
        self.assertFalse(row['hostOpenFileDescriptorFound'])
        self.assertNotIn('private-row', json.dumps(result))
        self.assertNotIn('private-jwt', json.dumps(result))
        self.assertEqual(original, path.read_bytes())

    def test_unknown_sensitive_filename_and_invalid_timestamp_are_hashed_not_echoed(self):
        names = ['customer-A-private-orders-2026.sqlite', 'sprayplan.db.bak.20261399-250000']
        for name in names:
            self.database(self.root / ops.APP / 'storage' / name)
        rows = self.inspect()['sprayplan']['sqliteCandidates']
        self.assertEqual(2, len(rows))
        self.assertTrue(all(row['category'] == 'unknown-sqlite-path' and 'relativePath' not in row for row in rows))
        text = json.dumps(rows)
        self.assertNotIn('customer-A', text)
        self.assertNotIn('20261399', text)
        self.assertEqual({hashlib.sha256(n.encode()).hexdigest() for n in names}, {r['pathSha256'] for r in rows})

    def test_candidate_wal_is_reported_but_immutable_check_never_checkpoints_it(self):
        path = self.database(self.root / ops.APP / 'data-test/sprayplan.db.bak.20261015-130100')
        db = sqlite3.connect(path)
        self.handles.append(db)
        db.execute('PRAGMA journal_mode=WAL')
        db.execute('PRAGMA wal_autocheckpoint=0')
        db.execute('INSERT INTO private_fixture VALUES(2,"private-wal-row")')
        db.commit()
        before = {ending: pathlib.Path(str(path) + ending).read_bytes() for ending in ('-wal', '-shm')}
        row, = self.inspect(host={'complete': True, 'found': [0]})['sprayplan-test']['sqliteCandidates']
        self.assertTrue(row['sidecars']['-wal']['exists'])
        self.assertTrue(row['sidecars']['-shm']['exists'])
        self.assertTrue(row['hostOpenFileDescriptorFound'])
        self.assertFalse(row['inactiveStatusProven'])
        self.assertEqual(before, {ending: pathlib.Path(str(path) + ending).read_bytes() for ending in ('-wal', '-shm')})

    def test_live_primary_and_sidecars_and_non_sqlite_files_are_excluded(self):
        live = self.root / ops.APP / 'data/sprayplan.db'
        for ending in ('-wal', '-shm', '-journal'):
            pathlib.Path(str(live) + ending).write_bytes(b'SQLite format 3\x00private-not-readable')
        (live.parent / 'not-a-database.pdf').write_bytes(b'%PDF private document')
        self.assertEqual([], self.inspect()['sprayplan']['sqliteCandidates'])

    def test_symlink_candidate_is_rejected_without_following_outside_database(self):
        outside = self.database(self.root / 'outside.sqlite')
        (self.root / ops.APP / 'data/linked.sqlite').symlink_to(outside)
        with self.assertRaises(RuntimeError):
            self.inspect()
        self.assertEqual('sqliteCandidateNoSymlinkFiles', ops.FAILED)

    def test_nonregular_fifo_is_rejected_before_opening_or_blocking(self):
        os.mkfifo(self.root / ops.APP / 'data/private-pipe')
        with self.assertRaises(RuntimeError):
            self.inspect()
        self.assertEqual('candidateScanRegularFile', ops.FAILED)

    def test_fifo_sidecar_is_rejected_by_regular_file_guard_without_opening(self):
        candidate = self.database(self.root / ops.APP / 'data/sprayplan.db.snapshot.20261015-130000')
        os.mkfifo(str(candidate) + '-wal')
        with self.assertRaises(RuntimeError):
            self.inspect()
        self.assertEqual('sqliteCandidateRegularFile', ops.FAILED)

    def test_fd_probe_unavailable_is_unknown_not_false(self):
        self.database(self.root / ops.APP / 'data/sprayplan.db.bak.20261015-130000')
        row, = self.inspect(host={'complete': False, 'found': []}, container={'complete': False, 'found': []})['sprayplan']['sqliteCandidates']
        self.assertIsNone(row['hostOpenFileDescriptorFound'])
        self.assertIsNone(row['containerOpenFileDescriptorFound'])
        self.assertFalse(row['hostFdProbeComplete'])
        self.assertFalse(row['containerFdProbeComplete'])

    def test_host_fd_probe_matches_inode_and_reports_all_hardlink_candidates(self):
        path = self.database(self.root / 'candidate.sqlite')
        metadata = path.stat()
        identity = (str(metadata.st_dev), str(metadata.st_ino))
        proc = self.root / 'fake-proc'
        descriptors = proc / '1234/fd'
        descriptors.mkdir(parents=True)
        (descriptors / '3').symlink_to(path)
        self.assertEqual({'complete': True, 'found': [0, 1]}, ops.host_candidate_fds([identity, identity], proc))
        self.assertEqual({'complete': False, 'found': []}, ops.host_candidate_fds([identity], self.root / 'missing-proc'))

    def test_candidate_hardlink_to_live_primary_is_flagged_without_raw_inode_output(self):
        source = self.root / ops.APP / 'data/sprayplan.db'
        alias = source.parent / 'sprayplan.db.snapshot.20261015-130000'
        os.link(source, alias)
        row, = self.inspect()['sprayplan']['sqliteCandidates']
        self.assertTrue(row['sameAsLivePrimaryFile'])
        self.assertFalse(row['inactiveStatusProven'])
        self.assertNotIn('st_ino', json.dumps(row))
        self.assertNotIn('st_dev', json.dumps(row))


class RuntimeMetadata930Tests(unittest.TestCase):
    def runtime(self, patch_number=0, hostname=None, **changes):
        identifier = ('a' if patch_number == 0 else 'b') * 64
        hostname = hostname or identifier[:12]
        env = {'DOTNET_VERSION': '8.0.' + str(patch_number), 'ASPNET_VERSION': '8.0.' + str(patch_number),
               'JWT_SECRET': 'offline-secret-never-print', 'SPRAYPLAN_DB_PATH': '/app/data/sprayplan.db',
               'Jwt__Issuer': 'sprayplan', 'TZ': 'Asia/Shanghai', 'PATH': '/usr/bin'}
        env.update(changes)
        versions = {k: env[k] for k in ops.VERSION_KEYS}
        def process_hash(values):
            return hashlib.sha256(json.dumps(sorted(k + '=' + v for k, v in values.items()),
                ensure_ascii=False, separators=(',', ':')).encode()).hexdigest()
        proc = dict(env, HOSTNAME=hostname)
        row = {'completeSha256': process_hash(proc),
               'withoutHostnameSha256': process_hash({k:v for k,v in proc.items() if k != 'HOSTNAME'}),
               'withoutVersionMetadataSha256': process_hash({k:v for k,v in proc.items() if k not in ops.VERSION_KEYS}),
               'protectedSha256': process_hash({k:v for k,v in proc.items() if k not in ops.VERSION_KEYS and k != 'HOSTNAME'}),
               'hostname': hostname, 'versionMetadata': versions}
        return {'containerId': identifier, 'containerHostname': hostname, 'explicitHostnameConfigured': False,
                'imageInheritedVersionMetadataValidated': True, 'publicVersionMetadata': versions,
                'processEnvironments': {p: copy.deepcopy(row) for p in ('api', 'web')},
                'protectedConfigEnvSha256': ops.digest(sorted(k + '=' + v for k,v in env.items() if k not in ops.VERSION_KEYS))}

    def test_public_dotnet8_metadata_and_automatic_hostname_changes_preserve_full_protected_environment(self):
        before, after = self.runtime(), self.runtime(1)
        result = ops.process_environment_comparison(before, after)
        self.assertTrue(result['protectedProcessEnvironmentsPreserved'])
        self.assertTrue(result['imageInheritedVersionMetadataValidated'])
        self.assertTrue(result['automaticHostnameLifecycleValidated'])
        self.assertTrue(result['publicVersionMetadataChanged'])
        self.assertFalse(result['completeProcessEnvironmentsIdentical'])
        self.assertEqual(before['protectedConfigEnvSha256'], after['protectedConfigEnvSha256'])

    def test_any_secret_path_issuer_timezone_or_unknown_environment_change_is_rejected(self):
        for key, value in {'JWT_SECRET':'different-offline-secret','SPRAYPLAN_DB_PATH':'/tmp/other.db',
                           'Jwt__Issuer':'other','TZ':'UTC','PATH':'/tmp','NEW_UNKNOWN_KEY':'value',
                           'NODE_VERSION':'99.0.0'}.items():
            with self.subTest(key=key):
                before, after = self.runtime(), self.runtime(1, **{key:value})
                self.assertFalse(ops.process_environment_comparison(before, after)['protectedProcessEnvironmentsPreserved'])
                self.assertNotEqual(before['protectedConfigEnvSha256'], after['protectedConfigEnvSha256'])

    def test_explicit_or_unproven_hostname_is_never_exempted(self):
        cases = [self.runtime(1, hostname='custom-host'), self.runtime(1)]
        cases[1]['explicitHostnameConfigured'] = True
        for after in cases:
            with self.subTest(hostname=after['containerHostname']):
                result = ops.process_environment_comparison(self.runtime(), after)
                self.assertFalse(result['automaticHostnameLifecycleValidated'])
                self.assertFalse(result['protectedProcessEnvironmentsPreserved'])

    def test_unchanged_process_hashes_pass_even_with_fixed_explicit_hostname(self):
        before = self.runtime(hostname='same-explicit-host')
        after = copy.deepcopy(before)
        for row in (before, after):
            row['explicitHostnameConfigured'] = True
        result = ops.process_environment_comparison(before, after)
        self.assertTrue(result['protectedProcessEnvironmentsPreserved'])
        self.assertFalse(result['automaticHostnameLifecycleValidated'])
        self.assertTrue(result['completeProcessEnvironmentsIdentical'])

    def test_each_process_is_compared_independently(self):
        after = self.runtime(1)
        after['processEnvironments']['web']['protectedSha256'] = '0' * 64
        self.assertFalse(ops.process_environment_comparison(self.runtime(), after)['protectedProcessEnvironmentsPreserved'])

    def test_unvalidated_image_inheritance_never_passes(self):
        after = self.runtime(1)
        after['imageInheritedVersionMetadataValidated'] = False
        self.assertFalse(ops.process_environment_comparison(self.runtime(), after)['protectedProcessEnvironmentsPreserved'])

    def test_inherited_versions_require_exact_image_container_and_both_process_agreement(self):
        versions = {'DOTNET_VERSION':'8.0.13','ASPNET_VERSION':'8.0.13'}
        process = {p:{'versionMetadata':dict(versions)} for p in ('api','web')}
        self.assertEqual(versions, ops.inherited_versions(versions, versions, process))
        for generation in ('container','image','api','web'):
            c, i, p = dict(versions), dict(versions), copy.deepcopy(process)
            if generation == 'container': c['DOTNET_VERSION'] = '8.0.14'
            elif generation == 'image': i['ASPNET_VERSION'] = '8.0.14'
            else: p[generation]['versionMetadata']['DOTNET_VERSION'] = '8.0.14'
            with self.subTest(generation=generation), self.assertRaises(RuntimeError):
                ops.inherited_versions(c,i,p)

    def test_public_version_scope_is_fixed_to_valid_dotnet8_metadata(self):
        for value in ('9.0.0','8.1.0','8.0.01','8.0.-1','8.0.1;secret',None,8):
            versions = {'DOTNET_VERSION':value,'ASPNET_VERSION':'8.0.1'}
            with self.subTest(value=value), self.assertRaises(RuntimeError):
                ops.inherited_versions(versions, versions, {p:{'versionMetadata':versions} for p in ('api','web')})

    def test_unknown_or_missing_process_version_fields_are_rejected(self):
        versions = {'DOTNET_VERSION':'8.0.1','ASPNET_VERSION':'8.0.1'}
        for metadata in ({'DOTNET_VERSION':'8.0.1'}, dict(versions, NEW_UNKNOWN_KEY='secret')):
            with self.subTest(keys=tuple(metadata)), self.assertRaises(RuntimeError):
                ops.inherited_versions(versions, versions, {p:{'versionMetadata':metadata} for p in ('api','web')})

    def test_actual_nginx_checks_are_only_bound_read_only_container_gets(self):
        calls = []
        def read(args, **kwargs):
            calls.append(args)
            return b'private-auth-material' if args[-1].endswith('.htpasswd') else b'private-configuration'
        with patch.object(ops, 'cid', return_value='a'*64), patch.object(ops, 'run', side_effect=read):
            result = ops.nginx_protected()
        self.assertEqual({'actualConfig','actualAuthorization'},set(result))
        self.assertEqual(hashlib.sha256(b'private-auth-material').hexdigest(),result['actualAuthorization'])
        self.assertEqual([['docker','exec','a'*64,'cat','/etc/nginx/nginx.conf'],
                          ['docker','exec','a'*64,'cat','/etc/nginx/.htpasswd']],calls)
        self.assertNotIn('private-auth-material', json.dumps(result))


class TestedSource930Tests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='spray-source930-')
        self.root = pathlib.Path(self.temp.name)
        self.name = ops.APP + '/server/fixture.cs'
        self.path = self.root / self.name
        self.path.parent.mkdir(parents=True)
        self.git('init', '-q')
        self.git('config', 'user.email', 'offline@example.invalid')
        self.git('config', 'user.name', 'Offline Test')
        self.path.write_bytes(b'original code')
        self.git('add', self.name)
        self.git('commit', '-qm', 'before')
        self.before = self.git('rev-parse', 'HEAD').decode().strip()
        self.path.write_bytes(b'reviewed code')
        self.git('add', self.name)
        self.git('commit', '-qm', 'target')
        self.target = self.git('rev-parse', 'HEAD').decode().strip()
        self.manifest = {'reviewedHead':'f'*40, 'files':{self.name:hashlib.sha256(b'reviewed code').hexdigest()}}

    def tearDown(self):
        self.temp.cleanup()

    def git(self, *args):
        return subprocess.check_output(['git',*args], cwd=self.root, stderr=subprocess.DEVNULL)

    def check(self, manifest=None):
        with patch.object(ops, 'ROOT', self.root), patch.object(ops, 'BEFORE', self.before), \
             patch.object(ops, 'TESTED_SOURCE', self.manifest if manifest is None else manifest):
            return ops.tested_source_guard(self.target)

    def test_exact_git_blob_and_checkout_match_final_tested_source(self):
        proof = self.check()
        self.assertTrue(proof['allChangedPathsPinned'])
        self.assertTrue(proof['allDeployedGitBlobsAndCheckoutFilesMatchFinalTestedSource'])
        self.assertEqual(1, proof['testedFiles'])

    def test_unpinned_or_partial_final_manifest_fails_closed(self):
        for manifest in ({'reviewedHead':None, 'files':{}}, {'reviewedHead':'f'*40, 'files':{}},
                         {'reviewedHead':'f'*40}, {'reviewedHead':'invalid','files':self.manifest['files']}):
            with self.subTest(fields=tuple(manifest)), self.assertRaises(RuntimeError):
                self.check(manifest)

    def test_changed_git_blob_cannot_pass_using_unreviewed_hash(self):
        manifest = copy.deepcopy(self.manifest)
        manifest['files'][self.name] = hashlib.sha256(b'original code').hexdigest()
        with self.assertRaises(RuntimeError): self.check(manifest)
        self.assertEqual('deployedGitBlobMatchesFinalTestedSource',ops.FAILED)

    def test_changed_actual_checkout_is_rejected_even_with_matching_git_blob(self):
        self.path.write_bytes(b'unreviewed disk edit')
        with self.assertRaises(RuntimeError): self.check()
        self.assertEqual('actualCheckoutMatchesFinalTestedSource',ops.FAILED)

    def test_symlink_actual_checkout_is_rejected_without_following_it(self):
        outside=self.root/'outside-secret'; outside.write_bytes(b'reviewed code')
        self.path.unlink(); self.path.symlink_to(outside)
        with self.assertRaises(RuntimeError): self.check()
        self.assertEqual('regularNonSymlinkFile',ops.FAILED)

    def test_missing_or_extra_source_manifest_entry_is_rejected(self):
        extra = copy.deepcopy(self.manifest)
        extra['files'][ops.APP+'/server/unreviewed.cs'] = 'a'*64
        with self.assertRaises(RuntimeError): self.check(extra)
        self.assertEqual('allChangedPathsExactlyMatchFinalTestedManifest',ops.FAILED)

    def test_changed_extra_application_or_business_data_path_is_rejected(self):
        for name in ('unrelated-app/fixture.cs',ops.APP+'/data/fixture.json'):
            with self.subTest(name=name):
                file=self.root/name;file.parent.mkdir(parents=True,exist_ok=True);file.write_bytes(b'forbidden')
                self.git('add',name);self.git('commit','-qm','extra')
                self.target=self.git('rev-parse','HEAD').decode().strip()
                with self.assertRaises(RuntimeError): self.check()
                self.assertEqual('allChangedPathsExactlyMatchFinalTestedManifest',ops.FAILED)

    def test_pinned_inventory_cannot_include_traversal_unrelated_apps_or_persistent_data(self):
        for name in ('../secret', 'unrelated-app/fixture.cs', ops.APP+'/../secret', ops.APP+'/data/fixture.json',
                     ops.APP+'/storage-test/attachment',ops.APP+'/file\nname'):
            with self.subTest(name=name), self.assertRaises(RuntimeError):
                self.check({'reviewedHead':'f'*40,'files':{name:'a'*64}})
            self.assertEqual('safePinnedTestedSourceInventory',ops.FAILED)


if __name__ == '__main__':
    unittest.main()
