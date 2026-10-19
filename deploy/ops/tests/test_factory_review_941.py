"""Offline-only contracts: synthetic SQLite, files and captured stdout."""
import base64
import contextlib
import datetime
import importlib.util
import io
import json
import pathlib
import sqlite3
import shutil
import tempfile
import unittest
from unittest.mock import patch

MODULE = pathlib.Path(__file__).parents[1] / 'factory-review-941.py'
spec = importlib.util.spec_from_file_location('factory_review_941', MODULE)
ops = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ops)


class Contracts(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = pathlib.Path(self.temporary.name)
        self.previous_pin = ops.PIN
        self.previous_backups = ops.BACKUPS
        self.previous_attempt = ops.BACKUP_ATTEMPT

    def tearDown(self):
        ops.PIN = self.previous_pin
        ops.BACKUPS = self.previous_backups
        ops.BACKUP_ATTEMPT = self.previous_attempt
        self.temporary.cleanup()

    def database(self, name='data.db'):
        path = self.root / name
        with sqlite3.connect(path) as connection:
            connection.executescript('CREATE TABLE sample (id INTEGER PRIMARY KEY, value); INSERT INTO sample VALUES (1, 1);')
        return path

    def migration_fixture(self):
        old, new = self.root / 'before.db', self.root / 'after.db'
        old.unlink(missing_ok=True)
        new.unlink(missing_ok=True)
        now = datetime.datetime.now(datetime.timezone.utc)
        created = (now - datetime.timedelta(seconds=1)).isoformat().replace('+00:00', 'Z')
        started = (now - datetime.timedelta(seconds=2)).isoformat().replace('+00:00', 'Z')
        with sqlite3.connect(old) as connection:
            connection.executescript('CREATE TABLE users(id TEXT PRIMARY KEY,role TEXT,permissions TEXT);'
                                    'INSERT INTO users VALUES ("existing","buyer","protected");'
                                    'CREATE TABLE _collections(id TEXT PRIMARY KEY,name TEXT,fields TEXT,indexes TEXT,options TEXT,created TEXT,updated TEXT,listRule TEXT);'
                                    'CREATE TABLE _migrations(file TEXT PRIMARY KEY,applied INTEGER);'
                                    'INSERT INTO _migrations VALUES ("old.js",1);')
            connection.execute('INSERT INTO _collections VALUES(?,?,?,?,?,?,?,?)', ('factoryid', 'factories', '[]', '[]', '{}', created, created, 'old rule'))
        shutil.copyfile(old, new)
        with sqlite3.connect(new) as connection:
            connection.executescript('CREATE TABLE quality_patrols(id TEXT PRIMARY KEY,factory TEXT);'
                                    'CREATE UNIQUE INDEX patrol_idx ON quality_patrols(factory);'
                                    'CREATE VIEW quality_patrol_access AS SELECT id FROM users;')
            for identifier, name in [('patrolid', 'quality_patrols'), ('accessid', 'quality_patrol_access')]:
                connection.execute('INSERT INTO _collections VALUES(?,?,?,?,?,?,?,?)', (identifier, name, '[]', '[]', '{}', created, created, 'protected new rule'))
            connection.execute('INSERT INTO _migrations VALUES(?,?)', ('new.js', int(now.timestamp() * 1000000)))
            old_objects = {tuple(r) for r in sqlite3.connect(old).execute('SELECT type,name,tbl_name,sql FROM sqlite_master')}
            objects = [dict(zip(['type', 'name', 'tbl_name', 'sql'], r)) for r in connection.execute('SELECT type,name,tbl_name,sql FROM sqlite_master') if tuple(r) not in old_objects]
        ops.PIN = {'addedSchemaObjects': objects, 'migrationFiles': ['new.js'], 'newBusinessTables': ['quality_patrols'],
                   'newCollections': {name: {'id': identifier, 'name': name, 'fields': [], 'indexes': [], 'options': {}, 'listRule': 'protected new rule'}
                                      for identifier, name in [('patrolid', 'quality_patrols'), ('accessid', 'quality_patrol_access')]}}
        return old, new, started

    def compare_migration(self, old, new, started):
        with sqlite3.connect(old) as before, sqlite3.connect(new) as after:
            return ops.migration_comparison(old, new, ops.audit(before), ops.audit(after), started)

    def test_migration_exact_positive_and_all_old_business_rows_preserved(self):
        old, new, started = self.migration_fixture()
        result = self.compare_migration(old, new, started)
        self.assertTrue(result['passed'], result)
        self.assertEqual(result['changedExistingTables'], ['_collections', '_migrations'])

    def test_migration_rejects_same_count_permission_changes_and_unauthorized_schema(self):
        mutations = ['UPDATE users SET permissions="changed"',
                     'UPDATE _collections SET listRule="weakened" WHERE name="factories"',
                     'UPDATE _collections SET listRule="weakened" WHERE name="quality_patrols"',
                     'UPDATE _collections SET id="different" WHERE name="quality_patrols"',
                     'UPDATE _collections SET created="2001-01-01 00:00:00Z" WHERE name="quality_patrols"',
                     'UPDATE _migrations SET applied=1 WHERE file="new.js"',
                     'INSERT INTO _migrations VALUES("unexpected.js",1)',
                     'CREATE TABLE unexpected(id TEXT)',
                     'INSERT INTO quality_patrols VALUES("unexplained business record","factoryid")']
        for mutation in mutations:
            with self.subTest(mutation=mutation):
                old, new, started = self.migration_fixture()
                with sqlite3.connect(new) as connection:
                    connection.execute(mutation)
                self.assertFalse(self.compare_migration(old, new, started)['passed'])

    def test_backup_attempt_is_single_use_and_original_receipt_is_preserved(self):
        ops.BACKUPS = self.root
        first = ops.create_backup_directory()
        receipt = (self.root / 'factory-review-941-first-backup-attempt.json').read_bytes()
        with self.assertRaises(RuntimeError):
            ops.create_backup_directory()
        self.assertTrue(first.is_dir())
        self.assertEqual(receipt, (self.root / 'factory-review-941-first-backup-attempt.json').read_bytes())

    def original_fixed_failure(self):
        ops.BACKUPS = self.root
        original = self.root / pathlib.Path(ops.FIRST_FAILED_BACKUP).name
        original.mkdir(mode=0o700)
        result = {'automaticRecoveryPerformed': False, 'businessWritesPerformed': False,
                  'errorType': 'RuntimeError', 'failed': True, 'failedCheck': 'everyPublicAssetMatchesActualContainer',
                  'mode': 'backup', 'resultPath': ops.FIRST_FAILED_BACKUP + '/backup-first-result.json',
                  'sourceCommit': ops.BASE, 'strictAllChecksPassed': False}
        self.assertEqual(ops.sha(ops.encoded(result)), ops.FIRST_FAILED_RESULT_SHA256)
        ops.private_write(original / 'backup-first-result.json', ops.encoded(result))
        ops.private_write(original / 'private-material', b'private bytes remain unchanged')
        ops.seal(original)
        marker = self.root / 'factory-review-941-first-backup-attempt.json'
        ops.private_write(marker, ops.encoded({'backup': ops.FIRST_FAILED_BACKUP, 'sourceCommit': ops.BASE}))
        return original, marker

    def test_exact_authorized_second_backup_preserves_original_and_cannot_run_third(self):
        original, marker = self.original_fixed_failure()
        before = {str(p): p.read_bytes() for p in [marker, *original.iterdir()] if p.is_file()}
        second = ops.create_backup_directory()
        self.assertTrue(second.is_dir())
        self.assertNotEqual(second, original)
        self.assertEqual(ops.BACKUP_ATTEMPT['number'], 2)
        self.assertIs(ops.BACKUP_ATTEMPT['priorFailure']['remainsFailed'], True)
        self.assertEqual(ops.BACKUP_ATTEMPT['priorFailure']['resultSha256'], ops.FIRST_FAILED_RESULT_SHA256)
        second_marker = self.root / 'factory-review-941-second-backup-attempt.json'
        second_bytes = second_marker.read_bytes()
        with self.assertRaises(FileExistsError):
            ops.create_backup_directory()
        self.assertEqual(second_marker.read_bytes(), second_bytes)
        self.assertEqual(before, {str(p): p.read_bytes() for p in [marker, *original.iterdir()] if p.is_file()})

    def test_second_backup_rejects_changed_first_marker_or_receipt_even_if_resealed(self):
        original, marker = self.original_fixed_failure()
        original_marker = marker.read_bytes()
        marker.write_bytes(ops.encoded({'backup': '/different/failure', 'sourceCommit': ops.BASE}))
        with self.assertRaises(RuntimeError):
            ops.create_backup_directory()
        marker.write_bytes(original_marker)
        receipt = original / 'backup-first-result.json'
        changed = json.loads(receipt.read_bytes())
        changed['failedCheck'] = 'unrelatedFailure'
        receipt.write_bytes(ops.encoded(changed))
        (original / 'manifest.json').unlink()
        ops.seal(original)
        with self.assertRaises(RuntimeError):
            ops.create_backup_directory()
        self.assertFalse((self.root / 'factory-review-941-second-backup-attempt.json').exists())

    def test_second_backup_rejects_original_seal_tamper_and_loose_permissions(self):
        original, marker = self.original_fixed_failure()
        material = original / 'private-material'
        material.write_bytes(b'changed sealed material')
        with self.assertRaises(RuntimeError):
            ops.create_backup_directory()
        material.write_bytes(b'private bytes remain unchanged')
        marker.chmod(0o644)
        with self.assertRaises(RuntimeError):
            ops.create_backup_directory()
        self.assertFalse((self.root / 'factory-review-941-second-backup-attempt.json').exists())

    def test_pin_fail_closed_before_any_production_command(self):
        pin = self.root / 'pin.json'
        pin.write_text('{"finalPinFrozen":false}')
        with patch.object(ops, 'run', side_effect=AssertionError('must not run')), self.assertRaises(RuntimeError):
            ops.main(['backup', ops.BASE, ops.BASE, '', str(pin)])

    def test_typed_precision_blobs_and_negative_zero(self):
        self.assertNotEqual(ops.cell(1), ops.cell(1.0))
        self.assertNotEqual(ops.cell(0.0), ops.cell(-0.0))
        self.assertNotEqual(ops.cell(b'x'), ops.cell('x'))
        self.assertNotEqual(ops.cell(0.12345678901234566), ops.cell(0.12345678901234568))
        with self.assertRaises(RuntimeError):
            ops.cell(float('inf'))

    def test_database_full_multiset_detects_type_edit_without_count_change(self):
        path = self.database()
        with sqlite3.connect(path) as connection:
            before = ops.audit(connection)
            connection.execute('UPDATE sample SET value=1.0')
            after = ops.audit(connection)
        self.assertEqual(before['tables']['sample']['rows'], after['tables']['sample']['rows'])
        self.assertNotEqual(before['tables']['sample']['sha256'], after['tables']['sample']['sha256'])

    def test_snapshot_includes_committed_wal_and_preserves_original_bytes(self):
        path = self.database()
        auxiliary = self.root / 'auxiliary.db'
        with sqlite3.connect(auxiliary) as connection:
            connection.execute('CREATE TABLE logs (id INTEGER PRIMARY KEY)')
        writer = sqlite3.connect(path)
        writer.execute('PRAGMA journal_mode=WAL')
        writer.execute('INSERT INTO sample VALUES (2,?)', (b'committed wal',))
        writer.commit()
        output = self.root.parent / (self.root.name + '-copies')
        try:
            # SQLite read locks may update SHM; committed main/WAL data must not.
            before = {str(p): ops.sha(p.read_bytes()) for p in self.root.iterdir() if p.is_file() and not p.name.endswith('-shm')}
            audit = ops.snapshots(self.root, output)
            self.assertEqual(audit['data.db']['tables']['sample']['rows'], 2)
            self.assertEqual(ops.snapshots(output, immutable=True), audit)
            self.assertEqual(before, {str(p): ops.sha(p.read_bytes()) for p in self.root.iterdir() if p.is_file() and not p.name.endswith('-shm')})
            with contextlib.closing(ops.connect(path)) as reader:
                writer.execute('INSERT INTO sample VALUES (3,3)')
                writer.commit()
                self.assertEqual(ops.audit(reader)['tables']['sample']['rows'], 2)
                with self.assertRaises(sqlite3.OperationalError):
                    reader.execute('DELETE FROM sample')
        finally:
            writer.close()
            import shutil
            shutil.rmtree(output, ignore_errors=True)

    def test_archive_includes_unknown_settings_and_photos_but_not_exact_db_companions(self):
        self.database()
        (self.root / 'data.db-wal').write_bytes(b'evidence only')
        (self.root / 'storage').mkdir()
        (self.root / 'storage/photo-name-secret.png').write_bytes(b'photo')
        (self.root / 'settings').write_bytes(b'secret settings')
        target = self.root.parent / (self.root.name + '.tar')
        try:
            value = ops.non_database_inventory(self.root, ['data.db'], target)
            self.assertEqual({v['path'] for v in value}, {'storage', 'storage/photo-name-secret.png', 'settings'})
            ops.verify_archive(target, value)
            self.assertEqual(target.stat().st_mode & 0o777, 0o600)
            (self.root / 'storage/photo-name-secret.png').write_bytes(b'different')
            after = ops.non_database_inventory(self.root, ['data.db'])
            delta = ops.safe_files_delta(value, after)
            self.assertFalse(delta['unchanged'])
            self.assertEqual(delta['modifiedEntries'], 1)
            self.assertNotIn('photo-name-secret', json.dumps(delta))
        finally:
            target.unlink(missing_ok=True)

    def test_symlinks_and_non_sqlite_db_extension_are_rejected(self):
        self.database()
        (self.root / 'link').symlink_to(self.root / 'data.db')
        with self.assertRaises(RuntimeError):
            ops.non_database_inventory(self.root, ['data.db'])
        (self.root / 'link').unlink()
        (self.root / 'unknown.db').write_bytes(b'not sqlite')
        with self.assertRaises(RuntimeError):
            ops.databases(self.root)

    def test_transport_reassembles_large_original_bytes_and_all_lines_bounded(self):
        value = {'mode': 'verify', 'resultPath': '/private/first-result.json', 'checks': {'failed': False},
                 'many': [{'name': 'schema_%d' % n, 'hash': 'a' * 64} for n in range(1500)]}
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            ops.transport(value)
        lines = output.getvalue().splitlines()
        self.assertTrue(all(len(line.encode()) <= 6000 for line in lines))
        decoded = [json.loads(line) for line in lines]
        receipt = decoded.pop()
        self.assertEqual([p['part'] for p in decoded], list(range(1, len(decoded) + 1)))
        raw = base64.b64decode(''.join(p['data'] for p in decoded), validate=True)
        self.assertEqual(raw, ops.encoded(value))
        self.assertEqual(ops.sha(raw), receipt['fullSha256'])
        self.assertEqual(len(raw), receipt['bytes'])
        self.assertEqual(len(decoded), receipt['parts'])

    def fake_public_routes(self, service, corrupted=None):
        prefix = '/' + service + '/'
        index, script = b'<html>current container index</html>', b'const current = true;'
        visited = []
        def fake_run(arguments, data=None):
            if arguments == ops.COMPOSE + ['ps', '-q', service]:
                return b'container-id\n'
            if arguments[-5:] == ['find', '/pb/pb_public', '-type', 'f', '-print0']:
                return b'/pb/pb_public/index.html\0/pb/pb_public/assets/app.js\0'
            if arguments[-2:] == ['cat', '/pb/pb_public/index.html']:
                return index
            if arguments[-2:] == ['cat', '/pb/pb_public/assets/app.js']:
                return script
            raise AssertionError('Unexpected container read')
        def fake_get(path):
            visited.append(path)
            if path == prefix + 'index.html':
                return 301, b''  # Real PocketBase route: Location: /
            if path in {prefix, prefix + 'quality-patrol'}:
                return 200, b'wrong index' if corrupted == path else index
            if path == prefix + 'assets/app.js':
                return 200, b'wrong script' if corrupted == path else script
            if path == prefix + 'health':
                return 200, b'{}'
            if path in {prefix + '_/', prefix + 'api/collections/_superusers/records'}:
                return 404, b''
            if path in {prefix + 'api/collections/orders/records?perPage=1', prefix + 'api/collections/quality_patrols/records?perPage=1'}:
                return 200, b'{"totalItems":0,"items":[]}'
            raise AssertionError('Unexpected public read')
        return fake_run, fake_get, visited

    def test_pocketbase_index_redirect_uses_prefixed_root_for_both_services_before_and_after(self):
        for service in ops.SERVICES:
            for deployed in [False, True]:
                with self.subTest(service=service, deployed=deployed):
                    run, get, visited = self.fake_public_routes(service)
                    with patch.object(ops, 'run', side_effect=run), patch.object(ops, 'get', side_effect=get):
                        result = ops.probes(service, deployed)
                    self.assertTrue(result['passed'])
                    self.assertEqual(result['publicFilesVerified'], 2)
                    self.assertNotIn('/' + service + '/index.html', visited)
                    self.assertIn('/' + service + '/', visited)
                    self.assertIn('/' + service + '/assets/app.js', visited)
                    if deployed:
                        self.assertIn('/' + service + '/quality-patrol', visited)

    def test_index_root_and_all_other_assets_still_require_exact_container_bytes(self):
        for service in ops.SERVICES:
            prefix = '/' + service + '/'
            for corrupted in [prefix, prefix + 'assets/app.js']:
                with self.subTest(service=service, corrupted=corrupted):
                    run, get, _ = self.fake_public_routes(service, corrupted)
                    with patch.object(ops, 'run', side_effect=run), patch.object(ops, 'get', side_effect=get), self.assertRaises(RuntimeError):
                        ops.probes(service, True)
                    self.assertEqual(ops.FAILED, 'everyPublicAssetMatchesActualContainer')
            run, get, _ = self.fake_public_routes(service, prefix + 'quality-patrol')
            with patch.object(ops, 'run', side_effect=run), patch.object(ops, 'get', side_effect=get):
                self.assertFalse(ops.probes(service, True)['passed'])

    def test_private_outputs_never_overwrite_first_attempt(self):
        output = self.root / 'first-result.json'
        ops.private_write(output, b'original failure')
        with self.assertRaises(FileExistsError):
            ops.private_write(output, b'green retry')
        self.assertEqual(output.read_bytes(), b'original failure')
        self.assertEqual(output.stat().st_mode & 0o777, 0o600)

    def test_only_documented_auxiliary_log_database_is_volatile(self):
        before = {'data.db': {'rows': 1}, 'auxiliary.db': {'rows': 1}, 'unknown.db': {'rows': 1}}
        after = {**before, 'auxiliary.db': {'rows': 2}}
        self.assertTrue(ops.non_log_databases_equal(before, after))
        after['unknown.db'] = {'rows': 2}
        self.assertFalse(ops.non_log_databases_equal(before, after))
        after = {**before, 'data.db': {'rows': 2}}
        self.assertFalse(ops.non_log_databases_equal(before, after))

    def test_operational_status_retains_full_static_false_and_never_excludes_business_or_restart(self):
        checks = {'factory-review:fullSQLiteStaticEquality': False, 'factory-review:SQLiteStaticDuringProbes': False,
                  'factory-review:businessDatabasesStableDuringProbes': True, 'allOtherContainersUnchangedSinceBackup': True}
        self.assertTrue(ops.operational_checks(checks))
        self.assertFalse(all(checks.values()))
        checks['allOtherContainersUnchangedSinceBackup'] = False
        self.assertFalse(ops.operational_checks(checks))
        checks['allOtherContainersUnchangedSinceBackup'] = True
        checks['factory-review:businessDatabasesStableDuringProbes'] = False
        self.assertFalse(ops.operational_checks(checks))

    def test_collection_metadata_normalisation_does_not_remove_authorization_or_photo_protection(self):
        row = {'id': 'new', 'name': 'quality_patrols', 'created': 'synthetic', 'updated': 'synthetic',
               'fields': '[{"name":"factory","collectionId":"factoryid"},{"name":"photos","protected":true}]',
               'indexes': '[]', 'options': '{}', 'listRule': 'exact rule', 'deleteRule': None}
        result = ops.collection_metadata(row, {'factoryid': 'factories'})
        self.assertEqual(result['fields'][0]['collectionId'], '$collection:factories')
        self.assertTrue(result['fields'][1]['protected'])
        self.assertEqual(result['listRule'], 'exact rule')
        self.assertIsNone(result['deleteRule'])
        self.assertNotIn('created', result)

    def test_retained_error_result_is_read_without_production_or_database_reads(self):
        ops.BACKUPS = self.root
        original = self.root / 'factory-review-pre-941-20261019T123456000000Z'
        original.mkdir(mode=0o700)
        result = {'mode': 'backup', 'failed': True, 'sourceCommit': ops.BASE,
                  'resultPath': str(original / 'backup-first-result.json'), 'strictAllChecksPassed': False}
        ops.private_write(original / 'backup-first-result.json', ops.encoded(result))
        ops.seal(original)
        with patch.object(ops, 'run', side_effect=AssertionError('no production read')), patch.object(ops, 'connect', side_effect=AssertionError('no database read')):
            self.assertEqual(ops.retained_result(ops.BASE, str(original)), result)
        ops.private_write(original / 'extra', b'extra')
        # A changed original first result is rejected even if otherwise valid JSON.
        (original / 'backup-first-result.json').write_bytes(b'{}')
        with self.assertRaises(RuntimeError):
            ops.retained_result(ops.BASE, str(original))

    def test_exact_workflow_boundaries_are_present(self):
        workflow = MODULE.parents[2] / '.github/workflows/indo-diag.yml'
        text = workflow.read_text()
        self.assertEqual(text.count('refs/heads/ops/factory-review-941-20261019'), 2)
        self.assertEqual(text.count('fingerprint: ${{ env.CLOUD_HOST_FINGERPRINT }}'), 1)
        self.assertIn('group: deploy-cloud', text)
        self.assertIn('cancel-in-progress: false', text)
        self.assertNotIn('docker compose', text)
        self.assertNotIn('docker logs', text)


if __name__ == '__main__':
    unittest.main()
