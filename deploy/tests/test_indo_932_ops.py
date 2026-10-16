"""Offline failure-injection tests for PR932's private/read-only deployment gates."""
import copy
import decimal
import hashlib
import importlib.util
import io
import contextlib
import json
import pathlib
import tempfile
import unittest
from unittest import mock

SPEC = importlib.util.spec_from_file_location('indo_932', pathlib.Path(__file__).parents[1] / 'ops/indo-932.py')
ops = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(ops)
SHA = lambda content: hashlib.sha256(content).hexdigest()
SOURCE = ops.APP_PATH + 'src/IndoShipping.Api/Controllers/DictionariesController.cs'


class OpsTests(unittest.TestCase):
    def setUp(self):
        self.runtime = {'env': ['DB_PASSWORD=private-example', 'DB_NAME=rrportal', 'DOTNET_VERSION=8.0.1',
                                'ASPNET_VERSION=8.0.1'], 'image': 'sha256:' + 'a' * 64, 'mounts': [],
                        'startedAt': '2026-10-15T01:00:00Z', 'restartCount': 0, 'running': True,
                        'health': 'healthy', 'oomKilled': False}
        self.files = {'index.html': b'<script type="module" src="/indo-shipping/assets/index-a.js"></script>',
                      'assets/index-a.js': b'console.log("synthetic fixture")',
                      'assets/ProductsPage-b.js': b'export const fixture = true;',
                      'assets/index-a.css': b'body{color: black}'}
        self.expected = {name: SHA(content) for name, content in self.files.items()}
        self.manifest_patch = mock.patch.multiple(ops, PIN={'reviewedHead': 'b' * 40},
            EXPECTED_RUNTIME_DOCUMENTS={name: {'src/' + name + '/fixture.cs': SHA(b'fixture')} for name in ops.ASSEMBLIES},
            EXPECTED_DIST=self.expected,
                                                  EXPECTED_SOURCE_BLOBS={SOURCE: SHA(b'reviewed source')})
        self.manifest_patch.start()
        self.addCleanup(self.manifest_patch.stop)

    def runtime_read(self, values):
        with mock.patch.object(ops, 'run', return_value=json.dumps(values).encode()):
            return ops.runtime_config('a' * 64)

    def static_run(self, args, data=None):
        if args[3] == 'find':
            return '\n'.join('/app/wwwroot/' + key for key in self.files if key.startswith('assets/')).encode()
        return self.files[args[-1][len('/app/wwwroot/'):]]

    def static_get(self, url, token=None):
        relative = url.removeprefix('http://127.0.0.1/indo-shipping/') or 'index.html'
        return 200, self.files[relative]

    def test_all_table_inventory_and_all_columns_in_database_digest(self):
        tables = sorted(ops.REQUIRED_TABLES | {'new_business_table'})
        sql = ops.audit_sql(tables)
        self.assertIn('to_jsonb(r)', sql)
        self.assertIn('COUNT(*)', sql)
        self.assertIn("string_agg(row_hash,'' ORDER BY row_hash)", sql)
        for name in tables:
            self.assertIn('indo_shipping."' + name + '" r', sql)
        self.assertNotIn('DISTINCT', sql)

    def test_table_names_reject_injection_missing_and_duplicate(self):
        good = list(ops.REQUIRED_TABLES)
        for bad in [good + ['users;drop table'], good[:-1], good + [good[0]]]:
            with self.assertRaises(RuntimeError):
                ops.table_names(bad)

    def test_decimal_hash_has_no_28_digit_rounding(self):
        a = decimal.Decimal('0.123456789012345678901234567890123456789')
        b = decimal.Decimal('0.123456789012345678901234567890123456788')
        self.assertNotEqual(ops.digest_rows([a]), ops.digest_rows([b]))
        self.assertEqual(ops.digest_rows([decimal.Decimal('1.000')]), ops.digest_rows([1]))

    def test_full_row_multiset_keeps_duplicates_and_ignores_row_order(self):
        a, b = {'nested': [None, True, {'value': '甲'}]}, {'value': 2}
        self.assertEqual(ops.digest_rows([a, b]), ops.digest_rows([b, a]))
        self.assertNotEqual(ops.digest_rows([a, b]), ops.digest_rows([a, a, b]))

    def test_environment_order_does_not_change_configuration(self):
        before = self.runtime_read(self.runtime)
        after = copy.deepcopy(self.runtime)
        after['env'].reverse()
        self.assertEqual(before, self.runtime_read(after))
        self.assertNotIn('private-example', json.dumps(before))

    def test_application_environment_difference_is_protected(self):
        before = self.runtime_read(self.runtime)
        after = copy.deepcopy(self.runtime)
        after['env'][0] = 'DB_PASSWORD=changed'
        self.assertNotEqual(before['configEnvSha256'], self.runtime_read(after)['configEnvSha256'])

    def test_only_two_runtime_version_labels_may_differ(self):
        before = self.runtime_read(self.runtime)
        after = copy.deepcopy(self.runtime)
        after['env'][-2:] = ['DOTNET_VERSION=8.0.2', 'ASPNET_VERSION=8.0.2']
        current = self.runtime_read(after)
        self.assertEqual(before['configEnvSha256'], current['configEnvSha256'])
        self.assertNotEqual(before['completeEnvSha256'], current['completeEnvSha256'])

    def test_mount_or_unhealthy_or_oom_is_rejected(self):
        for field, value in [('mounts', [{'Destination': '/app/data'}]), ('health', 'unhealthy'),
                             ('oomKilled', True), ('running', False)]:
            payload = copy.deepcopy(self.runtime)
            payload[field] = value
            with self.assertRaises(RuntimeError):
                self.runtime_read(payload)

    def test_duplicate_environment_key_rejected(self):
        self.runtime['env'].append('DB_NAME=other')
        with self.assertRaises(RuntimeError):
            self.runtime_read(self.runtime)

    def test_core_baseline_keeps_existing_restart_count_and_detects_change(self):
        state = {'running': True, 'status': 'running', 'startedAt': '2026-10-15T01:00:00Z',
                 'restartCount': 13, 'oomKilled': False, 'health': 'healthy'}
        with mock.patch.object(ops, 'cid', side_effect=lambda name: name), \
             mock.patch.object(ops, 'run', side_effect=lambda args: json.dumps(state).encode()):
            before = ops.core_containers()
            state['restartCount'] = 14
            self.assertNotEqual(before, ops.core_containers())
        self.assertEqual(set(before), set(ops.CORE_SERVICES))

    def test_expected_manifest_must_be_pinned(self):
        with mock.patch.object(ops, 'EXPECTED_DIST', {}), self.assertRaises(RuntimeError):
            ops.validate_expected_manifest()
        with mock.patch.object(ops, 'EXPECTED_SOURCE_BLOBS', {}), self.assertRaises(RuntimeError):
            ops.validate_expected_manifest()

    def test_every_static_asset_and_index_matches_http_and_reviewed_build(self):
        with mock.patch.object(ops, 'run', side_effect=self.static_run), \
             mock.patch.object(ops, 'get', side_effect=self.static_get):
            result = ops.frontend_audit('app')
        self.assertEqual(result['assetHashes'], self.expected)
        self.assertTrue(result['reviewedBuildMatched'])
        self.assertEqual(result['versionedAssets'], 3)

    def test_http_stale_asset_is_rejected(self):
        def stale(url, token=None):
            if url.endswith('ProductsPage-b.js'):
                return 200, b'old stale code'
            return self.static_get(url)
        with mock.patch.object(ops, 'run', side_effect=self.static_run), \
             mock.patch.object(ops, 'get', side_effect=stale), self.assertRaises(RuntimeError):
            ops.frontend_audit('app')
        self.assertEqual(ops.FAILED_CHECK, 'servedAssetMatchesActualContainer')

    def test_wrong_build_or_extra_asset_is_rejected(self):
        self.files['assets/extra.js'] = b'old extra code'
        with mock.patch.object(ops, 'run', side_effect=self.static_run), \
             mock.patch.object(ops, 'get', side_effect=self.static_get), self.assertRaises(RuntimeError):
            ops.frontend_audit('app')
        self.assertEqual(ops.FAILED_CHECK, 'allActualAssetsMatchReviewedProductionBuild')

    def test_backup_frontend_can_record_old_build_without_accepting_it_as_reviewed(self):
        with mock.patch.object(ops, 'EXPECTED_DIST', {}), \
             mock.patch.object(ops, 'run', side_effect=self.static_run), \
             mock.patch.object(ops, 'get', side_effect=self.static_get):
            result = ops.frontend_audit('app', check_expected=False)
        self.assertFalse(result['reviewedBuildMatched'])

    def test_source_inventory_and_reviewed_blob_are_exact(self):
        def read(args, data=None):
            if args[:3] == ['git', 'diff', '--name-only']:
                return (SOURCE + '\0').encode()
            if args[:2] == ['git', 'show']:
                return b'fixture' if args[-1].endswith('/fixture.cs') else b'reviewed source'
            if args[:4] == ['git', 'ls-tree', '-r', '-z']:
                if args[-1] == ops.APP_PATH + 'src/':
                    return ''.join(ops.APP_PATH + 'src/' + name + '/fixture.cs\0' for name in ops.ASSEMBLIES).encode()
                return (SOURCE + '\0').encode()
            return b''
        with mock.patch.object(ops, 'source_commit', return_value='a' * 40), \
             mock.patch.object(ops, 'run', side_effect=read):
            ops.checkout_source_proof('a' * 40, deployed=True)
            with mock.patch.object(ops, 'EXPECTED_SOURCE_BLOBS', {SOURCE: SHA(b'wrong source')}), \
                 self.assertRaises(RuntimeError):
                ops.checkout_source_proof('a' * 40, deployed=True)
        self.assertEqual(ops.FAILED_CHECK, 'exactReviewedSourceBlobs')

    def test_private_backup_manifest_detects_tampered_authorization(self):
        with tempfile.TemporaryDirectory() as tmp:
            backups = pathlib.Path(tmp)
            directory = backups / 'indo-pre-932-20261016T010000123456Z'
            directory.mkdir(mode=0o700)
            baseline = {'schema': 'indo_shipping', 'consistentExportedSnapshot': True, 'deploymentLabel': 'PR932',
                        'runtime': {}, 'backendArtifacts': dict.fromkeys(ops.ASSEMBLIES, {}),
                        'coreContainers': dict.fromkeys(ops.CORE_SERVICES, {}),
                        'sourceCommit': 'a' * 40, 'startupBusinessWritesGuardPassed': True,
                        'tables': dict.fromkeys(ops.REQUIRED_TABLES, {}),
                        'digestMethod': 'sha256-sorted-full-row-multiset'}
            payload = {'baseline.json': json.dumps(baseline).encode(), 'indo_shipping.dump': b'private dump',
                       'env.before': b'private environment', 'nginx.conf': b'private config',
                       'nginx.htpasswd': b'private authorization'}
            manifest = {name: SHA(content) for name, content in payload.items()}
            for name, content in {**payload, 'manifest.json': json.dumps(manifest).encode()}.items():
                (directory / name).write_bytes(content)
                (directory / name).chmod(0o600)
            with mock.patch.multiple(ops, BACKUPS=backups, BACKUP_PATH=str(directory), PHASE='932',
                                     BEFORE_COMMIT='a' * 40):
                self.assertEqual(ops.selected_backup()[0], directory)
                (directory / 'nginx.htpasswd').write_bytes(b'tampered')
                with self.assertRaises(RuntimeError):
                    ops.selected_backup()

    def startup_run(self, checks):
        calls = []
        def read(args, data=None):
            calls.append((args, data))
            if data:
                return json.dumps(checks).encode()
            if args[:2] == ['docker', 'inspect']:
                return b'[]'
            if args[:2] == ['docker', 'exec']:
                return b'absent'
            raise AssertionError('Unexpected command')
        return calls, read

    def test_every_pending_startup_business_write_is_rejected(self):
        fields = ['adminAlreadyConfigured', 'legacyAccountsAlreadyMigrated', 'oneTimeMigrationsApplied',
                  'toolMigrationApplied', 'supplierProfilesAlreadyFilled', 'scheduleHistoryAlreadyCaptured']
        for pending in fields:
            checks = {key: key != pending for key in fields}
            calls, read = self.startup_run(checks)
            with self.subTest(pending=pending), mock.patch.object(ops, 'sql_command', return_value=['psql']), \
                 mock.patch.object(ops, 'run', side_effect=read), contextlib.redirect_stdout(io.StringIO()), \
                 self.assertRaises(RuntimeError):
                ops.startup_guard('app', list(ops.REQUIRED_TABLES))
            self.assertEqual(len(calls), 1)
            self.assertIn(b'READ ONLY', calls[0][1])
            self.assertEqual(ops.FAILED_CHECK, 'startupWouldNotChangeBusinessOrAccounts')

    def test_startup_check_allows_no_seed_and_uses_read_only_sql(self):
        fields = ['adminAlreadyConfigured', 'legacyAccountsAlreadyMigrated', 'oneTimeMigrationsApplied',
                  'toolMigrationApplied', 'supplierProfilesAlreadyFilled', 'scheduleHistoryAlreadyCaptured']
        calls, read = self.startup_run(dict.fromkeys(fields, True))
        with mock.patch.object(ops, 'sql_command', return_value=['psql']), \
             mock.patch.object(ops, 'run', side_effect=read):
            self.assertTrue(ops.startup_guard('app', list(ops.REQUIRED_TABLES)))
        sql = calls[0][1].decode()
        self.assertIn('material_tracking_completed_schedules', sql)
        self.assertIn('customs_company', sql)
        self.assertNotIn('INSERT ', sql)
        self.assertNotIn('UPDATE ', sql)
        self.assertNotIn('DELETE ', sql)

    def test_missing_runtime_source_manifest_rejected(self):
        with mock.patch.object(ops, 'EXPECTED_RUNTIME_DOCUMENTS', {}), self.assertRaises(RuntimeError):
            ops.validate_expected_manifest()

    def test_runtime_artifact_bounds_and_private_fixed_filename(self):
        for invalid in ('../.env.cloud.production', 'other.dll'):
            with self.assertRaises(RuntimeError):
                ops.runtime_artifact_bytes('app', invalid)
        for size in (b'0', b'33554433', b'not-size'):
            with mock.patch.object(ops, 'run', return_value=size), self.assertRaises(RuntimeError):
                ops.runtime_artifact_bytes('app', 'IndoShipping.Api.dll')
        with mock.patch.object(ops, 'run', side_effect=[b'7', b'short']), self.assertRaises(RuntimeError):
            ops.runtime_artifact_bytes('app', 'IndoShipping.Api.dll')

    def test_backend_baseline_is_all_three_private_runtime_fingerprints(self):
        with mock.patch.object(ops, 'runtime_artifact_bytes', side_effect=lambda app, filename: filename.encode()):
            result = ops.backend_artifacts('app')
        self.assertEqual(set(result), set(ops.ASSEMBLIES))
        self.assertTrue(all(set(value) == {'dllSha256', 'pdbSha256'} for value in result.values()))
        self.assertTrue(all(len(value['dllSha256']) == 64 for value in result.values()))



if __name__ == '__main__':
    unittest.main()
