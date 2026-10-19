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
import sqlite3
import subprocess
import tempfile
import unittest
from unittest.mock import patch

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


if __name__=='__main__':unittest.main()
