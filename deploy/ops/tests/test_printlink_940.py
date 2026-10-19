"""Offline adversarial tests; no production access or live business operations."""
import contextlib
import datetime
import http.server
import threading
import importlib.util
import io
import json
import os
import pathlib
import re
import sqlite3
import shutil
import tarfile
import subprocess
import tempfile
import unittest
from unittest.mock import patch
from unittest import mock

HELPER = pathlib.Path(__file__).parents[1]/'printlink-940.py'
spec = importlib.util.spec_from_file_location('printlink940',HELPER)
ops = importlib.util.module_from_spec(spec); spec.loader.exec_module(ops)


class BackupTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.root = pathlib.Path(self.temp.name)
        self.tree = self.root/'runtime'; self.tree.mkdir(); (self.tree/'orders').mkdir()
        self.open_databases = []
        self.addCleanup(lambda:[db.close() for db in self.open_databases])
        for name in ['orders/printlink.sqlite','production.sqlite']:
            db = sqlite3.connect(self.tree/name)
            db.execute('PRAGMA journal_mode=WAL')
            db.execute('CREATE TABLE business(id INTEGER, value TEXT, bytes BLOB, number REAL)')
            db.execute('INSERT INTO business VALUES(1,?,?,?)',('original',b'\x00\xff',0.25)); db.commit()
            self.open_databases.append(db)
        (self.tree/'stations.json').write_bytes(b'{"token":"private-station-secret"}\n')
        (self.tree/'orders/uploads').mkdir(); (self.tree/'orders/uploads/image.bin').write_bytes(bytes(range(256)))
        (self.tree/'product-files').mkdir(); (self.tree/'product-files/object.stl').write_bytes(b'raw\x00product\xff')
        (self.tree/'.platform-lock').mkdir(mode=0o700)
        owner=self.tree/'.platform-lock/owner.json'
        owner.write_text('{"pid":7,"purpose":"platform","created":"2026-10-19T07:00:01.000Z"}')
        owner.chmod(0o600)
        self.now=datetime.datetime(2026,10,19,7,5,tzinfo=datetime.timezone.utc)
        self.supervisor_started=datetime.datetime(2026,10,19,7,0,0,500000,tzinfo=datetime.timezone.utc)
        self.lifecycle={'createdAt':'2026-10-19T06:59:59.123456789Z','startedAt':'2026-10-19T07:00:00.000000000Z'}
        os.utime(owner,(self.now.timestamp(),datetime.datetime(2026,10,19,7,0,1,tzinfo=datetime.timezone.utc).timestamp()))
        self.lock_proof=ops.validate_platform_lock(self.tree,7,self.lifecycle,self.supervisor_started,self.now)

    def test_wal_consistent_backup_includes_committed_pages(self):
        self.assertTrue((self.tree/'production.sqlite-wal').stat().st_size>0)
        out=self.root/'snapshots'; out.mkdir()
        baseline=ops.sqlite_snapshots(self.tree,out)
        self.assertEqual(ops.sqlite_snapshots(out),baseline)
        with sqlite3.connect(out/'production.sqlite') as db:
            self.assertEqual(db.execute('SELECT value,bytes FROM business').fetchone(),('original',b'\x00\xff'))
        self.assertEqual((out/'production.sqlite').stat().st_mode & 0o777,0o600)

    def test_same_count_updated_row_is_detected(self):
        before=ops.sqlite_snapshots(self.tree)
        db=self.open_databases[1]; db.execute("UPDATE business SET value='changed'"); db.commit()
        after=ops.sqlite_snapshots(self.tree)
        self.assertEqual(before['production.sqlite']['tables']['business']['rows'],after['production.sqlite']['tables']['business']['rows'])
        self.assertNotEqual(before,after)

    def test_duplicate_multiset_and_sqlite_types_are_preserved(self):
        before=ops.sqlite_snapshots(self.tree)
        db=self.open_databases[1]; db.execute('INSERT INTO business SELECT * FROM business'); db.commit()
        after=ops.sqlite_snapshots(self.tree)
        self.assertEqual(after['production.sqlite']['tables']['business']['rows'],2)
        self.assertNotEqual(before,after)
        self.assertNotEqual(ops.sqlite_value(1),ops.sqlite_value(1.0))
        self.assertNotEqual(ops.sqlite_value('1'),ops.sqlite_value(b'1'))

    def test_schema_change_is_detected_even_with_same_rows(self):
        before=ops.sqlite_snapshots(self.tree)
        db=self.open_databases[0]; db.execute('CREATE INDEX business_by_value ON business(value)'); db.commit()
        self.assertNotEqual(before,ops.sqlite_snapshots(self.tree))

    def test_additional_sqlite_without_extension_is_discovered(self):
        db=sqlite3.connect(self.tree/'extra-state'); db.execute('CREATE TABLE cursor(v TEXT)');db.commit();db.close()
        self.assertIn('extra-state',ops.sqlite_snapshots(self.tree))

    def test_invalid_sqlite_extension_and_symlink_are_rejected(self):
        file=self.tree/'invalid.db';file.write_bytes(b'not sqlite')
        with self.assertRaises(RuntimeError):ops.discover_databases(self.tree)
        file.unlink(); (self.tree/'bad-link').symlink_to('/etc/passwd')
        with self.assertRaises(RuntimeError):ops.tree_inventory(self.tree)

    def test_raw_archive_retains_every_original_byte_including_wal_lock(self):
        archive=self.root/'raw.tar'; rows=ops.tree_inventory(self.tree,archive)
        ops.verify_archive(archive,rows)
        paths={row['path'] for row in rows}
        self.assertTrue({'stations.json','orders/uploads/image.bin','product-files/object.stl',
          'production.sqlite','production.sqlite-wal','.platform-lock/owner.json'}<=paths)
        self.assertEqual(archive.stat().st_mode&0o777,0o600)

    def test_same_size_file_mutation_is_detected(self):
        before=ops.tree_inventory(self.tree)
        (self.tree/'product-files/object.stl').write_bytes(b'NEW\x00product\xff')
        self.assertNotEqual(before,ops.tree_inventory(self.tree))

    def test_archive_tamper_and_omitted_entry_are_detected(self):
        archive=self.root/'raw.tar'; rows=ops.tree_inventory(self.tree,archive)
        with self.assertRaises(RuntimeError):ops.verify_archive(archive,rows[:-1])
        content=bytearray(archive.read_bytes()); index=content.find(bytes(range(256)))
        self.assertGreaterEqual(index,0);content[index]^=1;archive.write_bytes(content)
        with self.assertRaises(RuntimeError):ops.verify_archive(archive,rows)

    def test_only_actual_sqlite_physical_family_and_lock_are_nonportable(self):
        rows=ops.tree_inventory(self.tree); names=ops.discover_databases(self.tree)
        kept={row['path'] for row in ops.durable_inventory(rows,names,self.lock_proof)}
        self.assertNotIn('production.sqlite-wal',kept);self.assertNotIn('.platform-lock/owner.json',kept)
        self.assertIn('stations.json',kept);self.assertIn('orders/uploads/image.bin',kept)
        (self.tree/'.platform-lockevil').write_bytes(b'important')
        self.assertIn('.platform-lockevil',{r['path'] for r in ops.durable_inventory(ops.tree_inventory(self.tree),names,self.lock_proof)})

    def test_cross_database_atomicity_is_not_claimed(self):
        self.assertIn("'crossDatabaseAtomicSnapshotClaimed':False",HELPER.read_text())

    def test_safe_relative_rejects_traversal_alias_absolute_and_controls(self):
        for path in ['../x','/x','x/../y','x//y','./x','x\ny']:
            self.assertFalse(ops.safe_relative(path),path)
        self.assertTrue(ops.safe_relative('中文目录/a.json'))

    def test_generated_columns_and_full_xinfo_are_in_row_and_metadata_hashes(self):
        db=self.open_databases[1]
        db.execute("CREATE TABLE generated(a INTEGER,b TEXT GENERATED ALWAYS AS ('v'||a) VIRTUAL,c INTEGER GENERATED ALWAYS AS(a*2) STORED)")
        db.execute('INSERT INTO generated(a) VALUES(3)');db.commit()
        audit=ops.sqlite_audit(db)['tables']['generated']
        xinfo=db.execute('PRAGMA table_xinfo(generated)').fetchall()
        self.assertEqual([row[6] for row in xinfo],[0,2,3])
        self.assertEqual(audit['columnsSha256'],ops.digest(xinfo))
        full_row=ops.digest([ops.sqlite_value(v) for v in [3,'v3',6]])
        self.assertEqual(audit['sha256'],ops.raw_hash(full_row.encode()))
        self.assertNotEqual(audit['columnsSha256'],ops.digest(db.execute('PRAGMA table_info(generated)').fetchall()))

    def test_virtual_table_hidden_columns_are_explicitly_hashed(self):
        db=self.open_databases[1]
        db.execute('CREATE VIRTUAL TABLE hidden_search USING fts5(value)')
        db.execute("INSERT INTO hidden_search(value) VALUES('searchable')");db.commit()
        class RecordingConnection:
            selected_rows=None
            selected_sql=None
            def execute(self,sql):
                cursor=db.execute(sql)
                if sql=='SELECT "value","hidden_search","rank" FROM "hidden_search"':
                    self.selected_rows=cursor.fetchall();self.selected_sql=sql
                    return iter(self.selected_rows)
                return cursor
        recording=RecordingConnection()
        audit=ops.sqlite_audit(recording)['tables']['hidden_search']
        columns=db.execute('PRAGMA table_xinfo(hidden_search)').fetchall()
        self.assertEqual([row[6] for row in columns],[0,1,1])
        self.assertEqual(recording.selected_sql,'SELECT "value","hidden_search","rank" FROM "hidden_search"')
        self.assertTrue(all(len(row)==3 for row in recording.selected_rows))
        # The FTS hidden table-name value is a per-query cursor token, so inspect
        # this exact cursor's rows instead of assuming another SELECT is equal.
        hashes=sorted(ops.digest([ops.sqlite_value(v) for v in row]) for row in recording.selected_rows)
        self.assertEqual(audit['sha256'],ops.raw_hash(''.join(hashes).encode()))
        visible=db.execute('SELECT * FROM hidden_search').fetchall()
        self.assertNotEqual(audit['sha256'],ops.raw_hash(''.join(sorted(ops.digest([ops.sqlite_value(v) for v in row]) for row in visible)).encode()))

    def test_system_sequence_and_analyze_tables_are_not_omitted(self):
        db=self.open_databases[1]
        db.execute('CREATE TABLE automatic(id INTEGER PRIMARY KEY AUTOINCREMENT,value TEXT)')
        db.execute("INSERT INTO automatic(value) VALUES('one')");db.execute('ANALYZE');db.commit()
        before=ops.sqlite_audit(db)
        self.assertIn('sqlite_sequence',before['tables']);self.assertIn('sqlite_stat1',before['tables'])
        db.execute("UPDATE sqlite_sequence SET seq=77 WHERE name='automatic'");db.commit()
        after=ops.sqlite_audit(db)
        self.assertEqual(before['tables']['sqlite_sequence']['rows'],after['tables']['sqlite_sequence']['rows'])
        self.assertNotEqual(before['tables']['sqlite_sequence']['sha256'],after['tables']['sqlite_sequence']['sha256'])
        db.execute("UPDATE sqlite_stat1 SET stat='123' WHERE tbl='automatic'");db.commit()
        self.assertNotEqual(after['tables']['sqlite_stat1'],ops.sqlite_audit(db)['tables']['sqlite_stat1'])

    def test_unknown_lock_files_and_directories_never_get_ignored(self):
        unexpected=self.tree/'.platform-lock/business.json';unexpected.write_text('{"products":[1]}')
        with self.assertRaises(RuntimeError):ops.validate_platform_lock(self.tree,7,self.lifecycle,self.supervisor_started,self.now)
        with self.assertRaises(RuntimeError):ops.durable_inventory(ops.tree_inventory(self.tree),ops.discover_databases(self.tree),self.lock_proof)
        unexpected.unlink();(self.tree/'.platform-lock/nested').mkdir()
        with self.assertRaises(RuntimeError):ops.validate_platform_lock(self.tree,7,self.lifecycle,self.supervisor_started,self.now)

    def test_lock_pid_purpose_shape_and_supervisor_start_must_match(self):
        file=self.tree/'.platform-lock/owner.json'
        original=json.loads(file.read_text())
        for owner in [{**original,'pid':8},{**original,'purpose':'backup'},{**original,'business':1},
                      {**original,'created':'2026-10-19T06:00:00.000Z'},
                      {**original,'created':'2026-10-19T07:04:59.000Z'}]:
            file.write_text(json.dumps(owner));file.chmod(0o600)
            with self.assertRaises(RuntimeError):ops.validate_platform_lock(self.tree,7,self.lifecycle,self.supervisor_started,self.now)
        file.write_text(json.dumps(original));file.chmod(0o600)
        with self.assertRaises(RuntimeError):ops.validate_platform_lock(self.tree,7,self.lifecycle,self.supervisor_started+datetime.timedelta(minutes=2),self.now)

    def test_legitimate_recreate_lock_is_validated_separately_and_raw_bytes_retained(self):
        before=ops.durable_inventory(ops.tree_inventory(self.tree),ops.discover_databases(self.tree),self.lock_proof)
        owner=self.tree/'.platform-lock/owner.json'
        owner.write_text('{"pid":23,"purpose":"platform","created":"2026-10-19T07:05:00.000Z"}');owner.chmod(0o600)
        os.utime(owner,(self.now.timestamp(),self.now.timestamp()))
        lifecycle={'createdAt':'2026-10-19T07:04:59.000Z','startedAt':'2026-10-19T07:04:59.900Z'}
        proof=ops.validate_platform_lock(self.tree,23,lifecycle,self.now,self.now)
        self.assertNotEqual(proof['ownerSha256'],self.lock_proof['ownerSha256'])
        self.assertEqual(before,ops.durable_inventory(ops.tree_inventory(self.tree),ops.discover_databases(self.tree),proof))
        archive=self.root/'recreated-raw.tar';rows=ops.tree_inventory(self.tree,archive);ops.verify_archive(archive,rows)
        self.assertIn(proof['ownerSha256'],[row.get('sha256') for row in rows])

    def test_lock_bytes_cannot_be_excluded_with_stale_or_missing_proof(self):
        rows=ops.tree_inventory(self.tree);names=ops.discover_databases(self.tree)
        with self.assertRaises(RuntimeError):ops.durable_inventory(rows,names,{})
        with self.assertRaises(RuntimeError):ops.durable_inventory(rows,names,{**self.lock_proof,'ownerSha256':'0'*64})



class GuardTests(unittest.TestCase):
    def test_final_pin_empty_fails_before_any_production_or_backup_operation(self):
        with tempfile.TemporaryDirectory() as folder:
            pin=pathlib.Path(folder)/'pin.json';pin.write_text(json.dumps({'finalPinFrozen':False}))
            with patch.object(ops,'backup') as backup,patch.object(ops,'run') as command:
                with self.assertRaises(RuntimeError):ops.main(['backup',ops.PRE_DEPLOY_COMMIT,ops.PRE_DEPLOY_COMMIT,'',str(pin)])
                self.assertEqual(ops.FAILED_CHECK,'finalSourcePinEmptyFailClosed')
                backup.assert_not_called();command.assert_not_called()

    def test_cli_failure_does_not_echo_private_path_or_error_body(self):
        with tempfile.TemporaryDirectory() as folder:
            pin=pathlib.Path(folder)/'unfrozen.json'
            pin.write_text('{"finalPinFrozen":false}')
            output=subprocess.run(['python3',str(HELPER),'backup',ops.PRE_DEPLOY_COMMIT,ops.PRE_DEPLOY_COMMIT,'',str(pin)],capture_output=True,text=True)
        self.assertEqual(output.returncode,1)
        self.assertNotIn('private-station-secret',output.stdout+output.stderr)
        self.assertEqual(json.loads(output.stdout)['failedCheck'],'finalSourcePinEmptyFailClosed')

    def test_five_protected_services_exclude_target(self):
        self.assertEqual(ops.PROTECTED_SERVICES,['nginx','core','db','redis','internal-quote'])
        self.assertNotIn('printlink',ops.PROTECTED_SERVICES)
        self.assertEqual(len(ops.GLOBAL_HEALTH),25);self.assertEqual(len(ops.PUBLIC_SAMPLE),14);self.assertEqual(ops.PUBLIC_SAMPLE['/printlink-health'],401)

    def test_manifest_includes_complete_tested_application_and_exact_changes(self):
        p=ops.APP_PREFIX+'shared/business-sync.cjs'; head='a'*40
        manifest={'finalPinFrozen':True,'reviewedHead':head,'files':{p:'b'*64},'applicationFiles':{p:'b'*64}}
        with patch.object(ops,'TESTED_SOURCE',manifest),patch.object(ops,'source_files',return_value={p:'b'*64}),patch.object(ops,'run',return_value=(p+'\0').encode()),patch.object(ops,'file_hash',return_value='b'*64):
            self.assertEqual(ops.tested_source_guard(head,True),{p:'b'*64})
        with patch.object(ops,'TESTED_SOURCE',manifest),patch.object(ops,'source_files',return_value={p:'b'*64}),patch.object(ops,'run',return_value=b'core/app.py\0'):
            with self.assertRaises(RuntimeError):ops.tested_source_guard(head,True)
        with patch.object(ops,'TESTED_SOURCE',manifest),patch.object(ops,'source_files',return_value={p:'c'*64}):
            with self.assertRaises(RuntimeError):ops.tested_source_guard(head,True)

    def test_no_business_write_or_deployment_commands_are_present(self):
        source=HELPER.read_text()
        for forbidden in ["'INSERT ","'UPDATE ","'DELETE ","'DROP ","'restart'","'up'","'kill'",'businessSync(',"method='POST'",'sessions VALUES','randomBytes']:
            self.assertNotIn(forbidden,source)
        self.assertIn("'?mode=ro'",source)

    def test_branch_workflow_enforces_branch_fingerprint_and_serial_deploy_group(self):
        workflow=(HELPER.parents[2]/'.github/workflows/indo-diag.yml').read_text()
        self.assertEqual(workflow.count('refs/heads/ops/printlink-940-20261019'),2)
        self.assertIn('group: deploy-cloud',workflow);self.assertIn('cancel-in-progress: false',workflow)
        self.assertIn('fingerprint: ${{ env.CLOUD_HOST_FINGERPRINT }}',workflow)
        self.assertIn('^SHA256:[A-Za-z0-9+/]{43}=?$',workflow)
        self.assertIn('$(git rev-parse origin/ops/printlink-940-20261019)',workflow)
        self.assertNotIn('workflow_run:',workflow);self.assertNotIn('push:',workflow)

    def test_runtime_five_core_no_false_target_unchanged_claim(self):
        source=HELPER.read_text()
        self.assertIn("'targetPrintlinkRecreated'",source)
        self.assertIn("'allOtherContainersUnchanged'",source)
        self.assertNotIn("'coreContainersUnchanged'",source)


    def test_active_business_delta_is_retained_as_strict_failure_without_recovery(self):
        with tempfile.TemporaryDirectory() as folder:
            directory=pathlib.Path(folder)
            target='a'*40
            old={'containerId':'b'*64,'imageId':'sha256:'+'c'*64}
            fresh={'containerId':'d'*64,'imageId':'sha256:'+'e'*64}
            protected={name:{'running':True,'status':'running','oomKilled':False,'health':'healthy'} for name in ops.PROTECTED_SERVICES}
            runtime={'lifecycle':fresh,'configEnvironmentSha256':'env','processEnvironmentSha256':{'cloud':'same'},'mounts':[],'platformLock':{'validated':True}}
            baseline={'sqlite':{'production.sqlite':{'tables':{'business_sync_state':{'rows':1,'sha256':'before'}}}},
              'durableInventory':[],'runtime':{**runtime,'lifecycle':old},'otherContainers':protected,'nginx':{},'configuration':{}}
            after={'production.sqlite':{'tables':{'business_sync_state':{'rows':1,'sha256':'active-bridge-change'}}}}
            with contextlib.ExitStack() as stack:
                mocks={'selected_backup':(directory,baseline),'git_commit':target,'tested_source_guard':{},
                  'runtime_context':('app',directory,runtime,{}),'sqlite_snapshots':after,'tree_inventory':[],
                  'other_containers':protected,'nginx_material':{},'actual_runtime_files':33,
                  'read_only_probes':{'passed':True},'production_readiness':{'passed':True},'durable_inventory':[],'file_hash':'same','configuration':{}}
                for name,value in mocks.items():stack.enter_context(patch.object(ops,name,return_value=value))
                command=stack.enter_context(patch.object(ops,'run'))
                result=ops.verify(target,'unused')
                command.assert_not_called()
            self.assertFalse(result['strictVerificationPassed'])
            self.assertFalse(result['checks']['everyTableAndFullRowUnchanged'])
            self.assertTrue(result['checks']['targetPrintlinkRecreated'])
            retained=json.loads((directory/'verify-first-result.json').read_text())
            self.assertFalse(retained['strictVerificationPassed'])
            self.assertFalse(retained['automaticRestoreOrRecreatePerformed'])
            self.assertFalse(retained['conflictChoicesSubmitted'])
            self.assertFalse(retained['stockOrProductIdsChangedByOperator'])
            self.assertEqual(retained['changedDatabases'],['production.sqlite'])

    def test_verify_replay_rejected_before_reading_manifest_or_probing(self):
        with tempfile.TemporaryDirectory() as folder,patch.object(ops,'BACKUPS',pathlib.Path(folder)):
            directory=pathlib.Path(folder)/'printlink-pre-940-20261019T000000000000Z'
            directory.mkdir(mode=0o700)
            (directory/'verify-first-result.json').write_text('{"strictVerificationPassed":false}')
            with self.assertRaises(RuntimeError):ops.selected_backup(str(directory))
            self.assertEqual(ops.FAILED_CHECK,'firstVerificationAlreadyRetainedDoNotRerun')

    def test_printlink_nginx_location_inherits_server_authentication(self):
        source=(HELPER.parents[2]/'nginx/nginx.cloud.conf').read_text()
        self.assertIn('        auth_basic "RR Portal";',source)
        self.assertIn('        auth_basic_user_file /etc/nginx/.htpasswd;',source)
        location=source.split('        location = /printlink-health {',1)[1].split('}',1)[0]
        self.assertNotIn('auth_basic off',location)
        self.assertIn('proxy_pass http://$ups/api/health;',location)
        self.assertEqual(ops.PUBLIC_SAMPLE['/printlink-health'],401)

    def assert_read_only_probe_contract(self,nginx_status,direct_status):
        with tempfile.TemporaryDirectory() as folder:
            app=pathlib.Path(folder);public=app/'cloud/public';public.mkdir(parents=True)
            for name in ops.STATIC.values():(public/name).write_bytes(('fixture:'+name).encode())
            def fake_get(url):
                local='http://127.0.0.1';cloud=local+':3100'
                if url==local+'/printlink-health':return nginx_status,b''
                if url==cloud+'/api/health':return direct_status,b'{"ok":true}'
                if url.startswith(cloud):
                    path=url[len(cloud):]
                    if path in ops.STATIC:return 200,(public/ops.STATIC[path]).read_bytes()
                    if path in {'/api/me','/api/users','/api/orders','/api/platform/business-sync'}:return 401,b''
                    raise AssertionError(url)
                path=url[len(local):]
                if path in ops.PUBLIC_SAMPLE:return ops.PUBLIC_SAMPLE[path],b''
                if path in ops.GLOBAL_HEALTH:return 200,b''
                raise AssertionError(url)
            with patch.object(ops,'APP',app),patch.object(ops,'get',side_effect=fake_get):return ops.read_only_probes()

    def test_nginx_authentication_401_and_direct_service_health_200_are_separate(self):
        result=self.assert_read_only_probe_contract(401,200)
        self.assertTrue(result['passed']);self.assertTrue(result['nginxPrintlinkAuthenticationBoundary'])
        self.assertTrue(result['cloudHealth']);self.assertNotIn('nginxPrintlinkHealth',result)
        self.assertEqual(len(result['globalHealth']),25);self.assertEqual(len(result['publicSamples']),14)
        row=next(row for row in result['publicSamples'] if row['path']=='/printlink-health')
        self.assertEqual(row,{'path':'/printlink-health','expected':401,'status':401})

    def test_anonymous_nginx_200_or_failed_direct_health_cannot_pass(self):
        bypass=self.assert_read_only_probe_contract(200,200)
        self.assertFalse(bypass['passed']);self.assertFalse(bypass['nginxPrintlinkAuthenticationBoundary'])
        unhealthy=self.assert_read_only_probe_contract(401,503)
        self.assertFalse(unhealthy['passed']);self.assertTrue(unhealthy['nginxPrintlinkAuthenticationBoundary'])
        self.assertFalse(unhealthy['cloudHealth'])

    def test_source_manifest_freeze_lifecycle_is_explicit(self):
        pin=json.loads(HELPER.with_name('printlink-940-source.json').read_text())
        self.assertEqual(set(pin),{'finalPinFrozen','reviewedHead','files','applicationFiles'})
        self.assertIs(type(pin['finalPinFrozen']),bool)
        if pin['finalPinFrozen']:
            self.assertRegex(pin['reviewedHead'],r'^[a-f0-9]{40}$')
            self.assertTrue(pin['files']);self.assertTrue(pin['applicationFiles'])
        else:
            self.assertIsNone(pin['reviewedHead']);self.assertEqual(pin['files'],{})
            self.assertEqual(pin['applicationFiles'],{})


class ProductionReadinessTests(unittest.TestCase):
    def probe(self,response=None,ready=True,allow_unauth=False,extra_process=False):
        self.requests=[]
        fixture_secret='private-internal-token-never-print-123456789'
        if response is None:response={'active':'qingxi','lastSuccess':'2026-10-19T07:00:00.000Z','conflicts':[{'signature':'a'*64,'cloud':'PRIVATE BUSINESS CONTENT'}]}
        outer=self
        class Handler(http.server.BaseHTTPRequestHandler):
            def log_message(self,*args):pass
            def do_POST(self):
                body=self.rfile.read(int(self.headers.get('Content-Length','0')))
                outer.requests.append((self.path,body,self.headers.get('X-Internal-Token') is not None))
                authorized=self.headers.get('X-Internal-Token')==fixture_secret
                if not authorized and not allow_unauth:code,payload=401,b'Internal service'
                elif not ready:code,payload=503,b'{"error":"not ready"}'
                else:code,payload=200,json.dumps(response).encode()
                self.send_response(code);self.end_headers();self.wfile.write(payload)
        server=http.server.ThreadingHTTPServer(('127.0.0.1',0),Handler)
        thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        try:
            with tempfile.TemporaryDirectory() as folder:
                proc=pathlib.Path(folder)/'proc';production=proc/'42';production.mkdir(parents=True)
                (production/'cmdline').write_bytes(b'node\0production/server.js\0')
                (production/'environ').write_bytes(('INTERNAL_TOKEN='+fixture_secret+'\0BUSINESS_SYNC_STATION=qingxi\0PRODUCTION_PORT=3102\0').encode())
                if extra_process:
                    other=proc/'43';other.mkdir();(other/'cmdline').write_bytes(b'node\0production/server.js\0')
                script=ops.PRODUCTION_READINESS_SCRIPT.replace("const proc='/proc';",'const proc='+json.dumps(str(proc))+';')
                script=script.replace("const endpoint='http://127.0.0.1:3102/bridge/business-sync';",'const endpoint='+json.dumps('http://127.0.0.1:'+str(server.server_port)+'/bridge/business-sync')+';')
                result=subprocess.run(['node','-e',script],capture_output=True,text=True,timeout=20)
                self.assertEqual(result.returncode,0,result.stderr)
                self.assertNotIn(fixture_secret,result.stdout+result.stderr)
                self.assertNotIn('PRIVATE BUSINESS CONTENT',result.stdout+result.stderr)
                with patch.object(ops,'run',return_value=result.stdout.encode()):return ops.production_readiness('fake-container')
        finally:server.shutdown();server.server_close();thread.join(timeout=2)

    def test_actual_status_and_unauthenticated_boundary_are_required_without_payload_output(self):
        result=self.probe()
        self.assertTrue(result['passed']);self.assertEqual(result['conflictsCount'],1)
        self.assertEqual(result['conflictSignaturesSha256'],ops.raw_hash(json.dumps(['a'*64],separators=(',',':')).encode()))
        self.assertEqual(self.requests,[('/bridge/business-sync',b'{"action":"status"}',True),('/bridge/business-sync',b'{"action":"status"}',False)])

    def test_cloud_health_does_not_make_unready_production_pass(self):
        result=self.probe(ready=False)
        self.assertFalse(result['passed']);self.assertFalse(result['statusShapeValid'])

    def test_unauthenticated_internal_access_causes_strict_failure(self):
        result=self.probe(allow_unauth=True)
        self.assertFalse(result['passed']);self.assertEqual(result['unauthenticatedStatus'],200)

    def test_active_station_mismatch_and_malformed_signature_are_rejected(self):
        result=self.probe(response={'active':'another','conflicts':[]})
        self.assertFalse(result['passed']);self.assertFalse(result['activeMatchesProcessEnvironment'])
        result=self.probe(response={'active':'qingxi','conflicts':[{'signature':'unsafe'}]})
        self.assertFalse(result['passed']);self.assertFalse(result['statusShapeValid'])

    def test_duplicate_production_process_does_not_choose_arbitrary_credentials(self):
        result=self.probe(extra_process=True)
        self.assertFalse(result['passed']);self.assertEqual(self.requests,[])

    def test_actual_business_status_branch_has_no_business_writes(self):
        app=HELPER.parents[2]/'apps/工程部/3D打印协同平台'
        script=r'''const create=require(process.argv[1]);let mutations=0,reads=0,loads=0,writes=0;
const store={exec(){mutations++;},prepare(sql){if(!sql.startsWith('SELECT value FROM business_sync_state'))throw Error('unexpected statement');return {get(){reads++;return {value:JSON.stringify({lastSuccess:'time',conflicts:[]})};}};}};
const status=create(store,{load(){loads++;throw Error();},write(){writes++;throw Error();}});mutations=0;
const value=status({action:'status'});if(!Array.isArray(value.conflicts))throw Error();
process.stdout.write(JSON.stringify({mutations,reads,loads,writes}));'''
        result=subprocess.run(['node','-e',script,str(app/'production/business-sync.cjs')],capture_output=True,text=True,timeout=10)
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertEqual(json.loads(result.stdout),{'mutations':0,'reads':1,'loads':0,'writes':0})

    def test_real_startup_guard_distinguishes_definition_from_invocation(self):
        app=HELPER.parents[2]/'apps/工程部/3D打印协同平台'
        with patch.object(ops,'APP',app):facts=ops.startup_source_facts()
        self.assertTrue(facts['repairCorruptedDataDefinedButNotInvoked'])
        self.assertTrue(facts['ensureItemIdsInvokedInListenCallback'])
        with tempfile.TemporaryDirectory() as folder:
            fake=pathlib.Path(folder);(fake/'production').mkdir()
            (fake/'production/server.js').write_text((app/'production/server.js').read_text()+'\nrepairCorruptedData(loadData());\n')
            with patch.object(ops,'APP',fake):
                with self.assertRaises(RuntimeError):ops.startup_source_facts()


class DiagnosticTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.root=pathlib.Path(self.temp.name);self.live=self.root/'live';self.private=self.root/'private'
        (self.live/'orders').mkdir(parents=True);(self.private/'sqlite-snapshots/orders').mkdir(parents=True)
        self.database='orders/printlink.sqlite';self.live_file=self.live/self.database
        self.private_file=self.private/'sqlite-snapshots'/self.database

    def build(self,ddl,rows,insert):
        with contextlib.closing(sqlite3.connect(self.private_file)) as db:
            db.executescript(ddl);db.executemany(insert,rows);db.commit()
            self.original=ops.sqlite_audit(db)
            with contextlib.closing(sqlite3.connect(self.live_file)) as live:db.backup(live)
        self.writer=sqlite3.connect(self.live_file);self.writer.execute('PRAGMA journal_mode=WAL')
        self.writer.execute('PRAGMA user_version=0');self.writer.commit()
        self.addCleanup(self.writer.close)

    def read(self):
        with contextlib.ExitStack() as stack:
            connection=ops.diagnostic_connections(self.live,self.private,[self.database],stack)[self.database]
            return ops.diagnostic_database_delta(connection,self.database,self.original)

    def test_added_deleted_modified_and_all_column_counts(self):
        self.build('CREATE TABLE t(id INTEGER PRIMARY KEY,value TEXT,number)',[(1,'old',1),(2,'remove',2)],'INSERT INTO t VALUES(?,?,?)')
        self.writer.execute("UPDATE t SET value='new',number=1.0 WHERE id=1")
        self.writer.execute('DELETE FROM t WHERE id=2');self.writer.execute("INSERT INTO t VALUES(3,'added',3)");self.writer.commit()
        value=self.read()['tables']['t']
        self.assertEqual((value['added'],value['deleted'],value['modified']),(1,1,1))
        self.assertEqual(value['changedColumnCounts'],{'id':0,'value':1,'number':1})

    def test_nocase_rtrim_and_ieee_values_do_not_hide_differences(self):
        self.build('CREATE TABLE t(id INTEGER PRIMARY KEY,nocase TEXT COLLATE NOCASE,trimmed TEXT COLLATE RTRIM,value)',
          [(1,'alpha','text ',1.0)],'INSERT INTO t VALUES(?,?,?,?)')
        self.writer.execute('UPDATE t SET nocase=?,trimmed=?,value=?',('ALPHA','text',1.0+2**-52));self.writer.commit()
        value=self.read()['tables']['t'];self.assertEqual(value['modified'],1)
        self.assertEqual(value['changedColumnCounts'],{'id':0,'nocase':1,'trimmed':1,'value':1})
        self.assertEqual(ops.diagnostic_cell_equal(0.0,-0.0),0)
        self.assertEqual(ops.diagnostic_cell_equal(1,1.0),0)
        self.assertEqual(ops.diagnostic_cell_equal(b'1','1'),0)
        self.assertEqual(ops.diagnostic_cell_equal(None,''),0)

    def test_primary_key_type_or_case_change_is_added_and_deleted(self):
        self.build('CREATE TABLE typed(pk PRIMARY KEY,value);CREATE TABLE folded(pk TEXT COLLATE NOCASE PRIMARY KEY,value);',
          [(1,'same')],'INSERT INTO typed VALUES(?,?)')
        self.writer.execute("INSERT INTO folded VALUES('alpha','same')");self.writer.commit()
        # Add the same baseline row before the private image is used immutably.
        with contextlib.closing(sqlite3.connect(self.private_file)) as db:
            db.execute("INSERT INTO folded VALUES('alpha','same')");db.commit();self.original=ops.sqlite_audit(db)
        self.writer.execute('UPDATE typed SET pk=1.0');self.writer.execute("UPDATE folded SET pk='ALPHA'");self.writer.commit()
        result=self.read()
        for name in ['typed','folded']:
            self.assertEqual((result['tables'][name]['added'],result['tables'][name]['deleted'],result['tables'][name]['modified']),(1,1,0))

    def test_composite_primary_key_without_rowid_and_generated_columns(self):
        self.build('CREATE TABLE t(a TEXT,b INTEGER,v INTEGER,doubled INTEGER GENERATED ALWAYS AS(v*2) STORED,PRIMARY KEY(a,b)) WITHOUT ROWID',
          [('x',1,2)],'INSERT INTO t(a,b,v) VALUES(?,?,?)')
        self.writer.execute('UPDATE t SET v=3');self.writer.execute("INSERT INTO t(a,b,v) VALUES('y',2,4)");self.writer.commit()
        value=self.read()['tables']['t'];self.assertEqual((value['added'],value['deleted'],value['modified']),(1,0,1))
        self.assertEqual(value['changedColumnCounts'],{'a':0,'b':0,'v':1,'doubled':1})

    def test_null_primary_keys_preserve_duplicate_multiset_without_false_modified_count(self):
        self.build('CREATE TABLE t(pk TEXT PRIMARY KEY,value)',[(None,'duplicate'),(None,'duplicate')],'INSERT INTO t VALUES(?,?)')
        self.writer.execute("UPDATE t SET value='new' WHERE rowid=1");self.writer.commit()
        value=self.read()['tables']['t']
        self.assertEqual((value['added'],value['deleted']),(1,1));self.assertIsNone(value['modified'])
        self.assertTrue(value['modifiedCountIndeterminateWithoutStableKey'])
        self.assertEqual(value['changedColumnCounts'],{'pk':None,'value':None})

    def test_real_h_column_cannot_capture_fingerprint_grouping_alias(self):
        self.build('CREATE TABLE t(h TEXT,value)',[('shared','first'),('shared','second'),('shared','second')],'INSERT INTO t VALUES(?,?)')
        self.writer.execute("UPDATE t SET value='third' WHERE rowid=1");self.writer.execute("DELETE FROM t WHERE rowid=3");self.writer.commit()
        value=self.read()['tables']['t'];self.assertEqual((value['added'],value['deleted']),(1,2))
        self.assertIsNone(value['modified']);self.assertFalse(value['rowsUnchanged'])

    def test_empty_and_identical_nokey_tables_are_compared_as_multisets(self):
        self.build('CREATE TABLE empty(value);CREATE TABLE t(value)',[(b'\x00\xff',),(b'\x00\xff',)],'INSERT INTO t VALUES(?)')
        tables=self.read()['tables'];self.assertTrue(tables['empty']['rowsUnchanged']);self.assertTrue(tables['t']['rowsUnchanged'])
        self.assertEqual((tables['t']['added'],tables['t']['deleted']),(0,0))

    def test_schema_index_or_trigger_change_stops_row_pairing_without_leaking_sql(self):
        self.build('CREATE TABLE t(id INTEGER PRIMARY KEY,value TEXT)',[(1,'sentinel-private-content')],'INSERT INTO t VALUES(?,?)')
        self.writer.execute('CREATE INDEX changed_index ON t(value)');self.writer.commit()
        value=self.read();self.assertFalse(value['comparisonComplete']);self.assertTrue(value['tableRowMatchingSkippedBecauseSchemaChanged'])
        self.assertEqual(value['schema']['addedObjects'],[{'type':'index','name':'changed_index'}])
        self.assertNotIn('sentinel-private-content',json.dumps(value));self.assertNotIn('CREATE INDEX',json.dumps(value))

    def test_system_sequence_is_compared_and_not_filtered(self):
        self.build('CREATE TABLE t(id INTEGER PRIMARY KEY AUTOINCREMENT,value)',[('one',)],'INSERT INTO t(value) VALUES(?)')
        self.writer.execute("UPDATE sqlite_sequence SET seq=77 WHERE name='t'");self.writer.commit()
        value=self.read()['tables']['sqlite_sequence'];self.assertFalse(value['rowsUnchanged'])
        self.assertEqual((value['added'],value['deleted']),(1,1));self.assertIsNone(value['modified'])

    def test_nonpersistent_fts_hidden_columns_fail_closed(self):
        connection=sqlite3.connect(':memory:');self.addCleanup(connection.close)
        connection.execute('CREATE VIRTUAL TABLE searching USING fts5(value)')
        with self.assertRaises(RuntimeError):ops.diagnostic_schema(connection,'main')
        self.assertEqual(ops.FAILED_CHECK,'diagnosticNonPersistentVirtualHiddenColumnsNotComparable')

    def test_live_snapshot_is_pinned_across_external_wal_commit_and_private_files_never_change(self):
        self.build('CREATE TABLE t(id INTEGER PRIMARY KEY,value)',[(1,'before')],'INSERT INTO t VALUES(?,?)')
        private_bytes=self.private_file.read_bytes();before_entries=sorted(str(p.relative_to(self.private)) for p in self.private.rglob('*'))
        with contextlib.ExitStack() as stack:
            connection=ops.diagnostic_connections(self.live,self.private,[self.database],stack)[self.database]
            self.writer.execute("UPDATE t SET value='after'");self.writer.commit()
            first=ops.diagnostic_database_delta(connection,self.database,self.original)
            self.assertTrue(first['tables']['t']['rowsUnchanged'])
            for schema in ['main','baseline']:
                with self.assertRaises(sqlite3.OperationalError):connection.execute('INSERT INTO '+schema+".t VALUES(2,'forbidden')")
        self.assertEqual(self.read()['tables']['t']['modified'],1)
        self.assertEqual(self.private_file.read_bytes(),private_bytes)
        self.assertEqual(sorted(str(p.relative_to(self.private)) for p in self.private.rglob('*')),before_entries)

    def test_only_whitelisted_valid_timestamps_are_emitted_without_ids_or_contents(self):
        secret='private-token-and-record-id'
        self.build('CREATE TABLE collector_events(id TEXT PRIMARY KEY,station TEXT,received TEXT)',
          [(secret,'private-station','2026-10-19T01:00:00.000Z')],'INSERT INTO collector_events VALUES(?,?,?)')
        self.writer.execute('INSERT INTO collector_events VALUES(?,?,?)',('new-private-id','private-station','2026-10-19T02:00:00.000Z'));self.writer.commit()
        value=self.read();text=json.dumps(value);self.assertNotIn(secret,text);self.assertNotIn('new-private-id',text);self.assertNotIn('private-station',text)
        ranges=value['tables']['collector_events']['timeRanges']['addedCurrent']['received']
        self.assertEqual(ranges,{'rowsInScope':1,'validTimeValues':1,'minimumUtc':'2026-10-19T02:00:00.000000Z','maximumUtc':'2026-10-19T02:00:00.000000Z'})
        self.assertIsNone(ops.diagnostic_time('private-token','iso'))
        self.assertIsNone(ops.diagnostic_time('1800-01-01T00:00:00Z','iso'))

    def test_original_strict_false_seal_is_read_only_and_tampering_is_rejected(self):
        self.build('CREATE TABLE t(id INTEGER PRIMARY KEY,value)',[(1,'private-value')],'INSERT INTO t VALUES(?,?)')
        second=sqlite3.connect(self.live/'production.sqlite');self.addCleanup(second.close)
        second.execute('PRAGMA journal_mode=WAL')
        second.execute('CREATE TABLE snapshot(id INTEGER PRIMARY KEY,value)');second.execute("INSERT INTO snapshot VALUES(1,'private-state')");second.commit()
        backups=self.root/'backups';backups.mkdir(mode=0o700)
        directory=backups/'printlink-pre-940-20261019T011955726437Z';directory.mkdir(mode=0o700)
        audits=ops.sqlite_snapshots(self.live,directory/'sqlite-snapshots')
        for name in audits:
            self.assertEqual((directory/'sqlite-snapshots'/(name+'-wal')).stat().st_size,0)
            self.assertEqual((directory/'sqlite-snapshots'/(name+'-shm')).stat().st_size,32768)
        raw=ops.tree_inventory(self.live,directory/'runtime-raw.tar')
        before={'deployment':'PR940','sourceCommit':ops.PRE_DEPLOY_COMMIT,'strictVerificationPassed':False,
          'checks':{'allLogicalSQLiteDataStable':False,'sourceStable':True},'rawInventory':raw,
          'sqlite':audits}
        (directory/'baseline.json').write_text(json.dumps(before))
        for name in ['env.before','runtime.private.json','nginx.configuration']:(directory/name).write_text('private-token-never-output')
        for entry in directory.rglob('*'):entry.chmod(0o700 if entry.is_dir() else 0o600)
        ops.seal(directory)
        original={str(file.relative_to(directory)):file.read_bytes() for file in directory.rglob('*') if file.is_file()}
        with patch.object(ops,'BACKUPS',backups),patch.object(ops,'DIAGNOSTIC_BACKUP_PATH',str(directory)):
            _,retained,seal=ops.diagnostic_private_backup(str(directory))
            self.assertIs(retained['strictVerificationPassed'],False)
            self.assertNotIn('private-token-never-output',json.dumps(seal))
            proof=ops.diagnostic_snapshot_proof(directory,retained['sqlite'])
            for name in audits:
                self.assertEqual(proof[name],{'filesBytes':{name:(directory/'sqlite-snapshots'/name).stat().st_size,name+'-wal':0,name+'-shm':32768},
                  'immutableMainMatchesCompleteOriginalTypedAudit':True})
            self.assertEqual({str(file.relative_to(directory)):file.read_bytes() for file in directory.rglob('*') if file.is_file()},original)
            unknown=directory/'sqlite-snapshots/production.sqlite-extra';unknown.write_bytes(b'not-a-sidecar');unknown.chmod(0o600)
            manifest=json.loads(original['manifest.json']);manifest['sqlite-snapshots/production.sqlite-extra']=ops.file_hash(unknown)
            (directory/'manifest.json').write_text(json.dumps(manifest))
            with self.assertRaises(RuntimeError):ops.diagnostic_private_backup(str(directory))
            self.assertEqual(ops.FAILED_CHECK,'diagnosticExactOriginalSQLiteSnapshotFiles')
            unknown.unlink();(directory/'manifest.json').write_bytes(original['manifest.json'])
            (directory/'env.before').write_bytes(b'tampered')
            with self.assertRaises(RuntimeError):ops.diagnostic_private_backup(str(directory))
            self.assertEqual((directory/'manifest.json').read_bytes(),original['manifest.json'])

    def test_sealed_snapshot_nonempty_wal_is_never_ignored(self):
        self.build('CREATE TABLE t(id INTEGER PRIMARY KEY,value)',[(1,'before')],'INSERT INTO t VALUES(?,?)')
        writer=sqlite3.connect(self.private_file);self.addCleanup(writer.close)
        writer.execute('PRAGMA journal_mode=WAL');writer.execute("UPDATE t SET value='after' WHERE id=1");writer.commit()
        self.assertGreater((self.private_file.parent/(self.private_file.name+'-wal')).stat().st_size,0)
        with contextlib.closing(sqlite3.connect(self.private_file.as_uri()+'?mode=ro&immutable=1',uri=True)) as main:
            immutable_audit=ops.sqlite_audit(main)
        committed_audit=ops.sqlite_audit(writer)
        self.assertEqual(immutable_audit['schemaSha256'],committed_audit['schemaSha256'])
        self.assertEqual(immutable_audit['tables']['t']['rows'],committed_audit['tables']['t']['rows'])
        self.assertEqual(immutable_audit['tables']['t']['columnsSha256'],committed_audit['tables']['t']['columnsSha256'])
        self.assertNotEqual(immutable_audit,committed_audit)
        original={str(file.relative_to(self.private)):file.read_bytes() for file in self.private.rglob('*') if file.is_file()}
        with self.assertRaises(RuntimeError):ops.diagnostic_snapshot_proof(self.private,{self.database:committed_audit})
        self.assertEqual(ops.FAILED_CHECK,'diagnosticSealedSnapshotsHaveNoNonemptyWAL')
        self.assertEqual({str(file.relative_to(self.private)):file.read_bytes() for file in self.private.rglob('*') if file.is_file()},original)

    def test_immutable_snapshot_complete_typed_audit_rejects_same_count_content_change(self):
        self.build('CREATE TABLE t(id INTEGER PRIMARY KEY,value)',[(1,1)],'INSERT INTO t VALUES(?,?)')
        with contextlib.closing(sqlite3.connect(self.private_file)) as db:
            db.execute('UPDATE t SET value=1.0 WHERE id=1');db.commit()
            changed=ops.sqlite_audit(db)
        self.assertEqual(changed['schemaSha256'],self.original['schemaSha256'])
        self.assertEqual(changed['tables']['t']['rows'],self.original['tables']['t']['rows'])
        self.assertEqual(changed['tables']['t']['columnsSha256'],self.original['tables']['t']['columnsSha256'])
        self.assertNotEqual(changed,self.original)
        original=self.private_file.read_bytes()
        with self.assertRaises(RuntimeError):ops.diagnostic_snapshot_proof(self.private,{self.database:self.original})
        self.assertEqual(ops.FAILED_CHECK,'diagnosticImmutableMainMatchesCompleteOriginalTypedAudit')
        self.assertEqual(self.private_file.read_bytes(),original)

    def test_modified_and_deleted_timestamp_ranges_use_only_changed_rows(self):
        self.build('CREATE TABLE collector_events(id TEXT PRIMARY KEY,station TEXT,received TEXT)',
          [('modified-private','station','2026-10-19T01:00:00Z'),('deleted-private','station','2026-10-19T02:00:00Z')],
          'INSERT INTO collector_events VALUES(?,?,?)')
        self.writer.execute("UPDATE collector_events SET received='2026-10-19T03:00:00Z' WHERE id='modified-private'")
        self.writer.execute("DELETE FROM collector_events WHERE id='deleted-private'");self.writer.commit()
        value=self.read()['tables']['collector_events'];self.assertEqual((value['added'],value['deleted'],value['modified']),(0,1,1))
        ranges=value['timeRanges'];self.assertEqual(ranges['deletedBefore']['received']['minimumUtc'],'2026-10-19T02:00:00.000000Z')
        self.assertEqual(ranges['modifiedBefore']['received']['maximumUtc'],'2026-10-19T01:00:00.000000Z')
        self.assertEqual(ranges['modifiedCurrent']['received']['maximumUtc'],'2026-10-19T03:00:00.000000Z')
        self.assertNotIn('modified-private',json.dumps(value));self.assertNotIn('deleted-private',json.dumps(value))

    def test_fixed_diagnostic_mode_rejects_wrong_backup_and_keeps_verify_gate(self):
        with patch.object(ops,'diagnose') as diagnose:
            with self.assertRaises(RuntimeError):ops.main(['diagnose',ops.PRE_DEPLOY_COMMIT,ops.PRE_DEPLOY_COMMIT,'/opt/rr-portal/deploy/backups/another',str(HELPER.with_name('printlink-940-source.json'))])
            diagnose.assert_not_called()
        import ast
        original=subprocess.check_output(['git','show','HEAD:deploy/ops/printlink-940.py'],cwd=HELPER.parents[2],text=True)
        current=HELPER.read_text()
        def functions(source):return {node.name:ast.get_source_segment(source,node) for node in ast.parse(source).body if isinstance(node,ast.FunctionDef)}
        old,new=functions(original),functions(current)
        for name in ['selected_backup','backup','verify']:self.assertEqual(old[name],new[name],name)

    def test_both_workflow_gates_accept_only_fixed_first_failure_diagnosis(self):
        workflow=(HELPER.parents[2]/'.github/workflows/indo-diag.yml').read_text()
        scripts=[]
        for label,indent in [('run',10),('script',12)]:
            match=re.search(r'^\s*'+label+r': \|\n((?:^ {'+str(indent)+r'}.*\n|^\n)+)',workflow,re.M)
            self.assertIsNotNone(match)
            script='\n'.join(line[indent:] for line in match[1].splitlines())
            scripts.append(script.split('cd /opt/rr-portal',1)[0])
        env={**os.environ,'CLOUD_HOST_FINGERPRINT':'SHA256:'+'A'*43,
          'PRINTLINK_OPS_BRANCH':'refs/heads/ops/printlink-940-20261019','PRINTLINK_OPS_REF':'a'*40,
          'PRINTLINK_OPS_MODE':'diagnose','PRINTLINK_OPS_BEFORE':ops.PRE_DEPLOY_COMMIT,
          'PRINTLINK_OPS_TARGET':ops.PRE_DEPLOY_COMMIT,'PRINTLINK_OPS_BACKUP':ops.DIAGNOSTIC_BACKUP_PATH}
        for script in scripts:
            for mode in ['diagnose','context']:
                selected={**env,'PRINTLINK_OPS_MODE':mode}
                result=subprocess.run(['bash','-c',script],env=selected,capture_output=True)
                self.assertEqual(result.returncode,0)
                for changed in [{'PRINTLINK_OPS_BACKUP':ops.DIAGNOSTIC_BACKUP_PATH+'x'},
                  {'PRINTLINK_OPS_TARGET':'b'*40},{'PRINTLINK_OPS_BRANCH':'refs/heads/main'},
                  {'PRINTLINK_OPS_MODE':'restore'}]:
                    rejected=subprocess.run(['bash','-c',script],env={**selected,**changed},capture_output=True)
                    self.assertNotEqual(rejected.returncode,0)

    def test_diagnostic_json_does_not_relabel_original_false_as_passed(self):
        source=HELPER.read_text();import ast
        tree=ast.parse(source);function=next(node for node in tree.body if isinstance(node,ast.FunctionDef) and node.name=='diagnose')
        text=ast.get_source_segment(source,function)
        self.assertIn("'originalStrictVerificationPassed':False",text)
        self.assertIn("'deploymentAuthorizedByThisResult':False",text)
        self.assertNotIn('private_write(',text);self.assertNotIn('production_readiness(',text);self.assertNotIn('read_only_probes(',text)


class ContextTests(unittest.TestCase):
    def lifecycle(self,**changes):
        return {'containerId':'a'*64,'imageId':'sha256:'+'b'*64,'startedAt':'2026-10-18T01:00:00.123456789Z',
          'createdAt':'2026-10-18T01:00:00Z','restartCount':0,'running':True,'status':'running',
          'oomKilled':False,'health':'healthy',**changes}

    def test_context_delta_reports_only_whitelisted_lifecycle_changes(self):
        before={'core':self.lifecycle(),'removed':self.lifecycle()}
        current={'core':self.lifecycle(health='unhealthy'),'added':self.lifecycle(restartCount=2)}
        result=ops.context_lifecycle_delta(before,current)
        self.assertEqual(result['addedServices'],['added']);self.assertEqual(result['removedServices'],['removed'])
        self.assertEqual(result['lifecycleDifferences']['core'],{'health':{'before':'healthy','current':'unhealthy'}})
        self.assertEqual(set(result['lifecycleDifferences']['added']),set(self.lifecycle()))
        self.assertEqual(before['core']['health'],'healthy')
        for invalid in [{'core':{**self.lifecycle(),'Config':{'Env':['PRIVATE_TOKEN']}}},
          {'unsafe service':self.lifecycle()},{'core':self.lifecycle(health='PRIVATE_TOKEN')},
          {'core':self.lifecycle(containerId='PRIVATE_TOKEN')},{'core':self.lifecycle(containerId=int('1'*64))},
          {'core':self.lifecycle(restartCount=True)}]:
            with self.assertRaises(RuntimeError):ops.context_lifecycle_delta(before,invalid)

    def run_context(self,changed_seal=False,changed_context=False,changed_source=False):
        before={'otherContainers':{'core':self.lifecycle()},'strictVerificationPassed':False}
        current={'core':self.lifecycle(health='unhealthy')};seal={'files':'original-private-seal'}
        with contextlib.ExitStack() as stack:
            source=stack.enter_context(patch.object(ops,'git_commit',side_effect=[ops.PRE_DEPLOY_COMMIT,ops.PRE_DEPLOY_COMMIT,
              'c'*40 if changed_source else ops.PRE_DEPLOY_COMMIT,ops.PRE_DEPLOY_COMMIT]))
            stack.enter_context(patch.object(ops,'tested_source_guard',return_value={}))
            private=stack.enter_context(patch.object(ops,'diagnostic_private_backup',side_effect=[(pathlib.Path(ops.DIAGNOSTIC_BACKUP_PATH),before,seal),
              (pathlib.Path(ops.DIAGNOSTIC_BACKUP_PATH),before,{'files':'changed'} if changed_seal else seal)]))
            stack.enter_context(patch.object(ops,'other_containers',side_effect=[current,
              {'core':self.lifecycle(health='starting')} if changed_context else current]))
            for name in ['sqlite_audit','diagnostic_snapshot_proof','diagnostic_database_delta','actual_runtime_files',
              'runtime_context','read_only_probes','production_readiness','private_write','run']:
                stack.enter_context(patch.object(ops,name,side_effect=AssertionError('forbidden context operation: '+name)))
            result=ops.context(ops.PRE_DEPLOY_COMMIT,ops.DIAGNOSTIC_BACKUP_PATH)
            self.assertEqual(private.call_count,2);self.assertIs(before['strictVerificationPassed'],False)
            self.assertFalse(result['originalStrictVerificationPassed']);self.assertFalse(result['deploymentAuthorizedByThisResult'])
            self.assertFalse(result['businessWritesPerformed']);self.assertFalse(result['originalBackupFilesWritten'])
            return result

    def test_context_comparison_difference_is_a_fact_and_preserves_original_failure(self):
        result=self.run_context()
        self.assertTrue(result['contextComplete']);self.assertFalse(result['currentMatchesOriginalOtherContainers'])
        self.assertEqual(result['otherContainerLifecycleDelta']['changedServices'],['core'])
        self.assertEqual(result['otherContainerLifecycleDelta']['lifecycleDifferences']['core'],
          {'health':{'before':'healthy','current':'unhealthy'}})
        for options,check in [({'changed_seal':True},'originalPrivateSealAndFilesUnchanged'),
          ({'changed_context':True},'allOtherContainersStableDuringContext'),
          ({'changed_source':True},'sourceStillExactPreDeployMain')]:
            rejected=self.run_context(**options)
            self.assertFalse(rejected['contextComplete']);self.assertFalse(rejected['checks'][check])

    def test_context_main_requires_exact_mode_arguments_and_pin_bytes(self):
        pin=str(HELPER.with_name('printlink-940-source.json'))
        with patch.object(ops,'context',return_value={'contextComplete':True,'originalStrictVerificationPassed':False}) as context:
            for mode,before,target,path in [('unknown',ops.PRE_DEPLOY_COMMIT,ops.PRE_DEPLOY_COMMIT,ops.DIAGNOSTIC_BACKUP_PATH),
              ('context','d'*40,ops.PRE_DEPLOY_COMMIT,ops.DIAGNOSTIC_BACKUP_PATH),
              ('context',ops.PRE_DEPLOY_COMMIT,'d'*40,ops.DIAGNOSTIC_BACKUP_PATH),
              ('context',ops.PRE_DEPLOY_COMMIT,ops.PRE_DEPLOY_COMMIT,ops.DIAGNOSTIC_BACKUP_PATH+'x')]:
                with self.assertRaises(RuntimeError):ops.main([mode,before,target,path,pin])
            with tempfile.TemporaryDirectory() as folder:
                altered=pathlib.Path(folder)/'pin.json';altered.write_bytes(pathlib.Path(pin).read_bytes()+b'\n')
                with self.assertRaises(RuntimeError):ops.main(['context',ops.PRE_DEPLOY_COMMIT,ops.PRE_DEPLOY_COMMIT,ops.DIAGNOSTIC_BACKUP_PATH,str(altered)])
            context.assert_not_called()
            with contextlib.redirect_stdout(io.StringIO()) as output:
                self.assertEqual(ops.main(['context',ops.PRE_DEPLOY_COMMIT,ops.PRE_DEPLOY_COMMIT,ops.DIAGNOSTIC_BACKUP_PATH,pin]),0)
            self.assertFalse(json.loads(output.getvalue())['originalStrictVerificationPassed'])

    def test_existing_backup_verify_and_diagnosis_function_bodies_are_unchanged(self):
        import ast
        old=subprocess.check_output(['git','show','HEAD:deploy/ops/printlink-940.py'],cwd=HELPER.parents[2],text=True)
        def functions(source):return {node.name:ast.get_source_segment(source,node) for node in ast.parse(source).body if isinstance(node,ast.FunctionDef)}
        previous,current=functions(old),functions(HELPER.read_text())
        for name in ['selected_backup','backup','verify','diagnose','diagnostic_private_backup','diagnostic_snapshot_proof']:
            self.assertEqual(previous[name],current[name],name)


ACTIVE_TEST_PAYLOAD=json.dumps({'state':'RUNNING','progress':60,'connected':True,'sourceMachine':'1'})
ACTIVE_TEST_NEW_PAYLOAD=json.dumps({'state':'IDLE','progress':0,'connected':False,'sourceMachine':'1'})


class ActiveTests(unittest.TestCase):
    def setUp(self):
        self.old_umask=os.umask(0o077)
        self.tmp=tempfile.TemporaryDirectory(prefix='printlink-940-active-synthetic-')
        self.root=pathlib.Path(self.tmp.name)
        self.baseline=self.root/'original';self.live=self.root/'live'
        self.baseline.mkdir(mode=0o700);self.live.mkdir(mode=0o700)
        names=['orders/printlink.sqlite','production.sqlite']
        self.audit={}
        for name in names:
            file=self.baseline/'sqlite-snapshots'/name
            file.parent.mkdir(mode=0o700,parents=True,exist_ok=True)
            with contextlib.closing(sqlite3.connect(file)) as db:
                db.execute('CREATE TABLE business(id TEXT PRIMARY KEY,payload TEXT)')
                db.execute("INSERT INTO business VALUES ('preserve','original')")
                db.execute('CREATE TABLE '+('users' if name.startswith('orders/') else 'snapshot')+'(id TEXT PRIMARY KEY,value TEXT)')
                db.execute('INSERT INTO '+('users' if name.startswith('orders/') else 'snapshot')+" VALUES ('identity','original')")
                if name.startswith('orders/'):
                    db.executescript('CREATE TABLE collector_events(id TEXT PRIMARY KEY,station TEXT NOT NULL,received TEXT NOT NULL);'
                      'CREATE TABLE collector_devices(station TEXT,machine TEXT,payload TEXT NOT NULL,observed TEXT NOT NULL,PRIMARY KEY(station,machine));'
                      'CREATE TABLE collector_stations(id TEXT PRIMARY KEY,last_seen TEXT,sequence INTEGER DEFAULT 0);')
                    db.execute("INSERT INTO collector_stations VALUES ('station','2026-10-19T01:00:00.000Z',1)")
                    db.execute("INSERT INTO collector_events VALUES ('original','station','2026-10-19T01:00:00.000Z')")
                    db.execute("INSERT INTO collector_devices VALUES ('station','1',?,'2026-10-18T01:00:00.000Z')",(ACTIVE_TEST_PAYLOAD,))
                db.commit();self.audit[name]=ops.sqlite_audit(db)
            target=self.live/name;target.parent.mkdir(mode=0o700,parents=True,exist_ok=True);shutil.copy2(file,target)
        self.before={'deployment':'PR940','sourceCommit':ops.PRE_DEPLOY_COMMIT,'strictVerificationPassed':False,
                     'checks':{'allLogicalSQLiteDataStable':False,'allOtherChecks':True},'sqlite':self.audit,'rawInventory':[]}
        for name,data in {'baseline.json':ops.encoded(self.before),'runtime.private.json':b'{}','env.before':b'synthetic',
                          'nginx.configuration':b'synthetic'}.items():
            ops.private_write(self.baseline/name,data)
        with tarfile.open(self.baseline/'runtime-raw.tar','w'):pass
        ops.seal(self.baseline)
        self.seal=(self.baseline/'manifest.json').read_bytes()
        self.saved=(ops.BACKUPS,ops.DIAGNOSTIC_BACKUP_PATH)
        ops.BACKUPS=self.root;ops.DIAGNOSTIC_BACKUP_PATH=str(self.baseline)

    def tearDown(self):
        ops.BACKUPS,ops.DIAGNOSTIC_BACKUP_PATH=self.saved
        self.tmp.cleanup();os.umask(self.old_umask)

    def sql(self,statement,parameters=(),database='orders/printlink.sqlite'):
        with contextlib.closing(sqlite3.connect(self.live/database)) as db:
            db.execute(statement,parameters);db.commit()

    def telemetry(self):
        self.sql("INSERT INTO collector_events VALUES ('new','station','2026-10-19T02:00:00.000Z')")
        # MAX allows an unchanged sequence; offline observations may predate backup.
        self.sql("UPDATE collector_stations SET last_seen='2026-10-19T02:00:00.001Z'")
        self.sql("UPDATE collector_devices SET payload=?,observed='2026-10-18T02:00:00.000Z'",(ACTIVE_TEST_NEW_PAYLOAD,))

    def snapshot(self,name='current',probe=None,audit=None):
        return ops.active_read_snapshot(self.live,self.baseline,self.audit,self.root/name,probe,audit)

    def test_only_three_telemetry_tables_pass_and_original_seal_unchanged(self):
        self.telemetry();current,delta,gates,_=self.snapshot()
        self.assertNotEqual(current,self.audit)
        self.assertTrue(all(v['passed'] for v in gates.values()))
        self.assertEqual(delta['orders/printlink.sqlite']['tables']['collector_events']['added'],1)
        final,_,_,pairwise=self.snapshot('final',self.root/'current',current)
        self.assertEqual(final,current);self.assertTrue(all(v['passed'] for v in pairwise.values()))
        self.assertEqual((self.baseline/'manifest.json').read_bytes(),self.seal)
        self.assertEqual(ops.diagnostic_private_backup(str(self.baseline))[1],self.before)
        self.assertFalse((self.baseline/'verify-first-result.json').exists())

    def test_forbidden_deltas(self):
        cases=[
          ('cloud-business',"UPDATE business SET payload='changed'",(), 'orders/printlink.sqlite'),
          ('production-snapshot',"UPDATE business SET payload='changed'",(), 'production.sqlite'),
          ('cloud-permission',"UPDATE users SET value='administrator'",(), 'orders/printlink.sqlite'),
          ('actual-snapshot',"UPDATE snapshot SET value='changed stock/product/conflict'",(), 'production.sqlite'),
          ('schema',"ALTER TABLE business ADD COLUMN hidden TEXT",(), 'orders/printlink.sqlite'),
          ('delete-old-event',"DELETE FROM collector_events WHERE id='original'",(), 'orders/printlink.sqlite'),
          ('modify-old-event',"UPDATE collector_events SET received='2026-10-19T01:00:00.001Z' WHERE id='original'",(), 'orders/printlink.sqlite'),
          ('event-pk',"UPDATE collector_events SET id='changed' WHERE id='original'",(), 'orders/printlink.sqlite'),
          ('station-pk',"UPDATE collector_stations SET id='changed'",(), 'orders/printlink.sqlite'),
          ('device-pk',"UPDATE collector_devices SET machine='2'",(), 'orders/printlink.sqlite'),
          ('null-device-pk',"UPDATE collector_devices SET machine=NULL",(), 'orders/printlink.sqlite'),
          ('sequence-backward',"UPDATE collector_stations SET sequence=0",(), 'orders/printlink.sqlite'),
          ('station-time-backward',"UPDATE collector_stations SET last_seen='2026-10-18T01:00:00.000Z'",(), 'orders/printlink.sqlite'),
          ('device-time-backward',"UPDATE collector_devices SET observed='2026-10-17T01:00:00.000Z'",(), 'orders/printlink.sqlite'),
          ('offset-time',"UPDATE collector_devices SET observed='2026-10-18T02:00:00+02:00'",(), 'orders/printlink.sqlite'),
          ('same-time-payload-change',"UPDATE collector_devices SET observed='2026-10-18T01:00:00.000Z'",(), 'orders/printlink.sqlite'),
          ('unknown-station',"UPDATE collector_events SET station='unknown' WHERE id='new'",(), 'orders/printlink.sqlite'),
          ('no-new-event',"DELETE FROM collector_events WHERE id='new'",(), 'orders/printlink.sqlite'),
          ('future-observation',"UPDATE collector_devices SET observed='2026-10-19T03:00:00.000Z'",(), 'orders/printlink.sqlite'),
        ]
        original_live=self.root/'original-live';shutil.copytree(self.live,original_live)
        for label,sql,args,database in cases:
            with self.subTest(label=label):
                shutil.rmtree(self.live);shutil.copytree(original_live,self.live)
                self.telemetry();self.sql(sql,args,database)
                with self.assertRaises(Exception):self.snapshot(label)
                evidence=self.root/label/'sqlite-snapshots'/database
                self.assertTrue(evidence.is_file())
                report=json.loads(evidence.with_name(evidence.name+'.audit-delta.json').read_bytes())
                with contextlib.closing(sqlite3.connect(evidence.as_uri()+'?mode=ro&immutable=1',uri=True)) as copy:
                    self.assertEqual(ops.sqlite_audit(copy),report['audit'])

    def test_invalid_payloads(self):
        invalid=[
          'null','[]','{}',
          '{"state":"IDLE","progress":0,"progress":1,"connected":true}',
          '{"state":"IDLE","progress":NaN,"connected":true}',
          '{"state":"IDLE","progress":Infinity,"connected":true}',
          json.dumps({'state':'IDLE','progress':True,'connected':True}),
          json.dumps({'state':'IDLE','progress':101,'connected':True}),
          json.dumps({'state':'BAD','progress':0,'connected':True}),
          json.dumps({'state':'IDLE','progress':0,'connected':1}),
          json.dumps({'state':'IDLE','progress':0,'connected':True,'inventory':0}),
          json.dumps({'state':'IDLE','progress':0,'connected':True,'name':{'nested':1}}),
          json.dumps({'state':'IDLE','progress':0,'connected':True,'name':'😀'*129}),
          json.dumps({'state':'IDLE','progress':0,'connected':True,'nozzleTemp':10000001}),
          json.dumps({'state':'IDLE','progress':0,'connected':True,'remainingTime':False}),
        ]
        for value in invalid:
            with self.subTest(value=value):
                with self.assertRaises(Exception):ops.active_payload(value)

    def test_current_new_event_cannot_disappear_by_final(self):
        self.telemetry();audit,_,_,_=self.snapshot()
        self.sql("DELETE FROM collector_events WHERE id='new'")
        # Still legal vs original alone, but forbidden vs current pinned evidence.
        self.sql("UPDATE collector_stations SET last_seen='2026-10-19T01:00:00.000Z'")
        self.sql("UPDATE collector_devices SET payload=?,observed='2026-10-18T01:00:00.000Z'",(ACTIVE_TEST_PAYLOAD,))
        with self.assertRaises(Exception):self.snapshot('final',self.root/'current',audit)

    def test_failure_retained_exclusively_and_original_first_result_untouched(self):
        # Corrupt original seal content, then show the failed first attempt survives.
        (self.baseline/'env.before').write_bytes(b'changed')
        with self.assertRaises(Exception):ops.verify_active('f'*40,str(self.baseline))
        result_dir=self.root/ops.ACTIVE_RESULT_NAME;result=(result_dir/'first-result.json').read_bytes()
        self.assertFalse(json.loads(result)['activeVerificationPassed'])
        self.assertFalse(json.loads(result)['strictVerificationPassed'])
        with self.assertRaises(FileExistsError):ops.verify_active('f'*40,str(self.baseline))
        self.assertEqual((result_dir/'first-result.json').read_bytes(),result)
        self.assertEqual((self.baseline/'manifest.json').read_bytes(),self.seal)
        self.assertFalse((self.baseline/'verify-first-result.json').exists())

    def test_other_container_change_keeps_overall_false_but_reports_data_protection(self):
        lifecycle={'containerId':'old','imageId':'old-image','running':True,'status':'running','oomKilled':False,'health':'healthy'}
        old_runtime={'configEnvironmentSha256':'same','processEnvironmentSha256':{},'mounts':[],
                     'platformLock':{},'lifecycle':lifecycle}
        new_runtime={**old_runtime,'lifecycle':{**lifecycle,'containerId':'new','imageId':'new-image'}}
        old_others={name:{**lifecycle,'restartCount':0} for name in ops.PROTECTED_SERVICES+['voyageplex']}
        new_others={**old_others,'voyageplex':{**old_others['voyageplex'],'restartCount':1}}
        self.before.update({'runtime':old_runtime,'otherContainers':old_others,'durableInventory':[],
                            'nginx':{'configuration':ops.raw_hash(b'synthetic')},'configuration':{'same':'same'}})
        (self.baseline/'baseline.json').write_bytes(ops.encoded(self.before))
        (self.baseline/'manifest.json').unlink();ops.seal(self.baseline)
        original_manifest=(self.baseline/'manifest.json').read_bytes()
        (self.root/'.env.cloud.production').write_bytes(b'synthetic')
        self.telemetry();target='f'*40
        replacements={'ROOT':self.root,'git_commit':lambda *args:target,'tested_source_guard':lambda *args:{},
          'runtime_context':lambda:('synthetic',self.live,new_runtime,{}),'tree_inventory':lambda *args:[],
          'durable_inventory':lambda rows,*args:rows,'other_containers':lambda:new_others,
          'nginx_material':lambda:{'configuration':b'synthetic'},'actual_runtime_files':lambda *args:0,
          'read_only_probes':lambda:{'passed':True},'production_readiness':lambda *args:{'passed':True},
          'configuration':lambda:{'same':'same'}}
        with mock.patch.multiple(ops,**replacements):result=ops.verify_active(target,str(self.baseline))
        self.assertTrue(result['targetDataPreservationPassed'])
        self.assertFalse(result['activeVerificationPassed'])
        self.assertFalse(result['strictVerificationPassed'])
        self.assertFalse(result['checks']['allOtherContainersUnchanged'])
        self.assertEqual(set(result['otherContainerLifecycleDelta']),{'voyageplex'})
        self.assertEqual((self.baseline/'manifest.json').read_bytes(),original_manifest)
        self.assertFalse((self.baseline/'verify-first-result.json').exists())


class ActiveRoutingTests(unittest.TestCase):
    def test_main_active_exit_uses_overall_active_result_and_retains_strict_false(self):
        pin=str(HELPER.with_name('printlink-940-source.json'));target='1c295d6418a64a1610b9075acd4da2a38d875328'
        with contextlib.ExitStack() as stack:
            for name in ['backup','verify','diagnose','context']:
                stack.enter_context(patch.object(ops,name,side_effect=AssertionError('wrong mode route: '+name)))
            active=stack.enter_context(patch.object(ops,'verify_active'))
            for passed in [False,True]:
                active.return_value={'mode':'verify-active','activeVerificationPassed':passed,
                  'targetDataPreservationPassed':True,'strictVerificationPassed':False,'originalStrictVerificationPassed':False}
                with contextlib.redirect_stdout(io.StringIO()) as output:
                    status=ops.main(['verify-active',ops.PRE_DEPLOY_COMMIT,target,ops.DIAGNOSTIC_BACKUP_PATH,pin])
                self.assertEqual(status,0 if passed else 1)
                result=json.loads(output.getvalue());self.assertFalse(result['strictVerificationPassed'])
                self.assertFalse(result['originalStrictVerificationPassed']);self.assertTrue(result['targetDataPreservationPassed'])
                active.assert_called_with(target,ops.DIAGNOSTIC_BACKUP_PATH)

    def test_main_active_rejects_nonfixed_arguments_and_changed_pin_bytes(self):
        pin=str(HELPER.with_name('printlink-940-source.json'));target='1c295d6418a64a1610b9075acd4da2a38d875328'
        with patch.object(ops,'verify_active') as active:
            for mode,before,commit,path in [('unknown',ops.PRE_DEPLOY_COMMIT,target,ops.DIAGNOSTIC_BACKUP_PATH),
              ('verify-active','d'*40,target,ops.DIAGNOSTIC_BACKUP_PATH),
              ('verify-active',ops.PRE_DEPLOY_COMMIT,ops.PRE_DEPLOY_COMMIT,ops.DIAGNOSTIC_BACKUP_PATH),
              ('verify-active',ops.PRE_DEPLOY_COMMIT,'not-a-sha',ops.DIAGNOSTIC_BACKUP_PATH),
              ('verify-active',ops.PRE_DEPLOY_COMMIT,'f'*40,ops.DIAGNOSTIC_BACKUP_PATH),
              ('verify-active',ops.PRE_DEPLOY_COMMIT,target,ops.DIAGNOSTIC_BACKUP_PATH+'x'),
              ('verify-active',ops.PRE_DEPLOY_COMMIT,target,'')]:
                with self.assertRaises(RuntimeError):ops.main([mode,before,commit,path,pin])
            with tempfile.TemporaryDirectory() as folder:
                altered=pathlib.Path(folder)/'pin.json';altered.write_bytes(pathlib.Path(pin).read_bytes()+b'\n')
                with self.assertRaises(RuntimeError):ops.main(['verify-active',ops.PRE_DEPLOY_COMMIT,target,ops.DIAGNOSTIC_BACKUP_PATH,str(altered)])
            active.assert_not_called()

    def test_both_workflow_gates_require_active_fixed_backup_and_deployed_target(self):
        workflow=(HELPER.parents[2]/'.github/workflows/indo-diag.yml').read_text()
        self.assertIn('options: [backup, verify, diagnose, context, verify-active]',workflow)
        env={**os.environ,'CLOUD_HOST_FINGERPRINT':'SHA256:'+'A'*43,
          'PRINTLINK_OPS_BRANCH':'refs/heads/ops/printlink-940-20261019','PRINTLINK_OPS_REF':'a'*40,
          'PRINTLINK_OPS_MODE':'verify-active','PRINTLINK_OPS_BEFORE':ops.PRE_DEPLOY_COMMIT,
          'PRINTLINK_OPS_TARGET':'1c295d6418a64a1610b9075acd4da2a38d875328','PRINTLINK_OPS_BACKUP':ops.DIAGNOSTIC_BACKUP_PATH}
        for label,indent in [('run',10),('script',12)]:
            match=re.search(r'^\s*'+label+r': \|\n((?:^ {'+str(indent)+r'}.*\n|^\n)+)',workflow,re.M)
            self.assertIsNotNone(match)
            script='\n'.join(line[indent:] for line in match[1].splitlines()).split('cd /opt/rr-portal',1)[0]
            result=subprocess.run(['bash','-c',script],env=env,capture_output=True)
            self.assertEqual(result.returncode,0)
            for changed in [{'PRINTLINK_OPS_TARGET':ops.PRE_DEPLOY_COMMIT},{'PRINTLINK_OPS_TARGET':'not-a-sha'},
              {'PRINTLINK_OPS_TARGET':'f'*40},
              {'PRINTLINK_OPS_BEFORE':'d'*40},{'PRINTLINK_OPS_BACKUP':ops.DIAGNOSTIC_BACKUP_PATH+'x'},
              {'PRINTLINK_OPS_BACKUP':''},{'PRINTLINK_OPS_MODE':'verify_active'},
              {'PRINTLINK_OPS_BRANCH':'refs/heads/main'}]:
                rejected=subprocess.run(['bash','-c',script],env={**env,**changed},capture_output=True)
                self.assertNotEqual(rejected.returncode,0)


if __name__=='__main__':unittest.main()
