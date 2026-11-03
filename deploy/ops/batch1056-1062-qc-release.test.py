"""Synthetic pure-helper checks; never imports or invokes the release entry point."""
import ast
import hashlib
import importlib.util
import json
import os
import pathlib
import re
import stat
import sqlite3
import subprocess
import tarfile
import tempfile
import types
import unittest

DRAFT = pathlib.Path(__file__).with_name('batch1056-1062-qc-release.py')
NODE = pathlib.Path('/Users/fovo/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node')
SOURCE = ast.parse(DRAFT.read_text())


def extracted_helpers(code_root):
    selected = {'need', 'enc', 'sha', 'code_bind_manifest', 'candidate_image_growth', 'remaining_capacity'}
    definitions = [node for node in SOURCE.body if isinstance(node, ast.FunctionDef) and node.name in selected]
    assert len(definitions) == len(selected)
    env = {'pathlib': pathlib, 'hashlib': hashlib, 'json': json, 'os': os, 'stat': stat,
           'CODE_ROOT': code_root, 'CODE': ('app.js', 'server/server.js'),
           'budget_contract': lambda: {'imageGrowthUpperBytes': 8}, 'STAGE': 'test'}
    exec(compile(ast.Module(body=definitions, type_ignores=[]), str(DRAFT) + ':helpers-only', 'exec'), env)
    return env


def literal(name):
    node = next(node for node in SOURCE.body if isinstance(node, ast.Assign) and
                any(isinstance(target, ast.Name) and target.id == name for target in node.targets))
    return ast.literal_eval(node.value)


class BundleCopyTests(unittest.TestCase):
    def helpers(self):
        names = {'need', 'pin', 'copy_bundle', 'stopped_check', 'scratch'}
        nodes = [n for n in SOURCE.body if isinstance(n, ast.FunctionDef) and n.name in names]
        self.assertEqual(len(nodes), len(names))
        env = {'re': re, 'STAGE': 'synthetic-entry', 'TARGET': '1' * 40,
               'CODE': literal('DIFF_CODE') + literal('CORRECTION_CODE')}
        exec(compile(ast.Module(body=nodes, type_ignores=[]), 'copy-bundle-only', 'exec'), env)
        return env

    def test_copy_uses_exact_stdin_tar_destination_without_archive_owner_remapping(self):
        env = self.helpers(); calls = []; patch = b'synthetic reviewed tar bytes'
        env['run'] = lambda args, data=None: calls.append((args, data))
        env['copy_bundle']('a' * 64, patch)
        self.assertEqual(calls, [(['docker', 'cp', '-', 'a' * 64 + ':/app'], patch)])

    def test_invalid_container_or_nonbytes_empty_payload_is_rejected_before_copy(self):
        env = self.helpers(); calls = []
        env['run'] = lambda *args: calls.append(args)
        for cid, patch in [('a' * 63, b'x'), ('a' * 64 + ':/other', b'x'),
                           ('a' * 64, b''), ('a' * 64, 'text'), ('a' * 64, bytearray(b'x'))]:
            with self.subTest(cid=cid, kind=type(patch).__name__), self.assertRaises(RuntimeError):
                env['copy_bundle'](cid, patch)
        self.assertEqual(calls, [])

    def scratch_fixture(self, *, fail_readback=False, fail_cleanup=False):
        env = self.helpers(); cid = 'a' * 64; image = 'sha256:' + 'b' * 64; calls = []
        metadata = {'sha256': 'c' * 64, 'bytes': 12, 'uid': 0, 'gid': 0,
                    'mode': 0o755, 'mtime': 1793714952}
        expected = {name: dict(metadata) for name in env['CODE']}
        row = {'Image': image, 'State': {'Pid': 0, 'Running': False, 'StartedAt': '0001-01-01'},
               'Mounts': [], 'HostConfig': {'NetworkMode': 'none'},
               'Config': {'Labels': {'io.rr-portal.qc1056-1062-scratch': env['TARGET']}}}
        env['memory'] = lambda args: [row]
        env['copied_file'] = lambda *args: (b'', dict(metadata, uid=100) if fail_readback else dict(metadata))
        def run(args, data=None):
            calls.append((args, data)); env['STAGE'] = 'synthetic-command-output'
            if args[:2] == ['docker', 'create']: return cid.encode()
            if args[:2] == ['docker', 'rm'] and fail_cleanup:
                env['need'](False, 'synthetic-cleanup-failure')
            return b''
        env['run'] = run
        return env, cid, image, calls, expected

    def test_scratch_and_deploy_both_use_the_shared_copy_function(self):
        env, cid, image, calls, expected = self.scratch_fixture()
        env['scratch'](image, b'synthetic tar', expected)
        self.assertEqual([call for call in calls if call[0][:2] == ['docker', 'cp']],
                         [(['docker', 'cp', '-', cid + ':/app'], b'synthetic tar')])
        self.assertEqual(calls[-1][0], ['docker', 'rm', cid])
        for name in ('scratch', 'deploy'):
            node = next(n for n in SOURCE.body if isinstance(n, ast.FunctionDef) and n.name == name)
            copies = [n for n in ast.walk(node) if isinstance(n, ast.Call) and
                      isinstance(n.func, ast.Name) and n.func.id == 'copy_bundle']
            self.assertEqual(len(copies), 1, name)
            self.assertNotIn("'cp'", ast.unparse(node), name)

    def test_all_six_metadata_fields_remain_exact_for_every_payload_file(self):
        env = self.helpers(); cid = 'a' * 64
        metadata = {'sha256': 'c' * 64, 'bytes': 12, 'uid': 0, 'gid': 0,
                    'mode': 0o755, 'mtime': 1793714952}
        expected = {name: dict(metadata) for name in env['CODE']}
        env['copied_file'] = lambda *args: (b'', dict(metadata))
        env['stopped_check'](cid, expected)
        for name in env['CODE']:
            for field in metadata:
                changed = dict(metadata); changed[field] = 'd' * 64 if field == 'sha256' else metadata[field] + 1
                env['copied_file'] = lambda actual_cid, actual_name: (b'', changed if actual_name == name else dict(metadata))
                with self.subTest(name=name, field=field), self.assertRaisesRegex(RuntimeError, '^stopped-source-bytes-owner-mode-readback$'):
                    env['stopped_check'](cid, expected)

    def test_successful_owned_scratch_cleanup_preserves_original_failure_stage(self):
        env, cid, image, calls, expected = self.scratch_fixture(fail_readback=True)
        with self.assertRaisesRegex(RuntimeError, '^stopped-source-bytes-owner-mode-readback$'):
            env['scratch'](image, b'synthetic tar', expected)
        self.assertEqual(env['STAGE'], 'stopped-source-bytes-owner-mode-readback')
        self.assertEqual(calls[-1][0], ['docker', 'rm', cid])

    def test_cleanup_failure_keeps_its_own_failure_and_stage(self):
        env, cid, image, calls, expected = self.scratch_fixture(fail_readback=True, fail_cleanup=True)
        with self.assertRaisesRegex(RuntimeError, '^synthetic-cleanup-failure$'):
            env['scratch'](image, b'synthetic tar', expected)
        self.assertEqual(env['STAGE'], 'synthetic-cleanup-failure')
        self.assertEqual(calls[-1][0], ['docker', 'rm', cid])


class CodeBindGuardTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='synthetic-qc-code-guard-')
        self.addCleanup(self.temp.cleanup)
        self.root = pathlib.Path(self.temp.name).resolve()
        (self.root / 'server').mkdir()
        (self.root / 'app.js').write_text('/* synthetic frontend */')
        (self.root / 'server/server.js').write_text('/* synthetic backend */')
        self.env = extracted_helpers(self.root)

    def reject(self):
        with self.assertRaises((RuntimeError, FileNotFoundError)):
            self.env['code_bind_manifest']()

    def test_dangling_payload_symlink_is_rejected(self):
        (self.root / 'app.js').unlink()
        (self.root / 'app.js').symlink_to(self.root / 'missing-target')
        self.reject()

    def test_existing_payload_symlink_is_rejected(self):
        (self.root / '.private-file').write_text('synthetic private value')
        (self.root / 'app.js').unlink()
        (self.root / 'app.js').symlink_to(self.root / '.private-file')
        self.reject()

    def test_payload_directory_is_rejected(self):
        (self.root / 'app.js').unlink()
        (self.root / 'app.js').mkdir()
        self.reject()

    def test_payload_hardlink_is_rejected(self):
        os.link(self.root / 'app.js', self.root / '.private-hardlink')
        self.reject()

    def test_symlinked_payload_parent_is_rejected(self):
        (self.root / 'server/server.js').unlink()
        (self.root / 'server').rmdir()
        (self.root / 'other-directory').mkdir()
        (self.root / 'server').symlink_to(self.root / 'other-directory', target_is_directory=True)
        self.reject()

    def test_nonpayload_private_link_is_hashed_and_preserved_without_following(self):
        (self.root / '.private-link').symlink_to('synthetic-missing-target')
        (self.root / 'data').mkdir()
        (self.root / 'data/excluded-business-sample').write_text('synthetic data must not be scanned')
        first = self.env['code_bind_manifest']()
        second = self.env['code_bind_manifest']()
        self.assertEqual(first, second)
        key = hashlib.sha256(b'.private-link').hexdigest()
        entry = first['entries'][key]
        self.assertEqual(entry['type'], 'symlink')
        self.assertEqual(entry['targetSHA256'], hashlib.sha256(b'synthetic-missing-target').hexdigest())
        self.assertNotIn('publicPath', entry)
        self.assertNotIn('synthetic-missing-target', json.dumps(first))
        self.assertNotIn(hashlib.sha256(b'data/excluded-business-sample').hexdigest(), first['entries'])
        self.assertFalse(first['dataSubtreeTraversed'])


class ImageGrowthGuardTests(unittest.TestCase):
    def setUp(self):
        self.env = extracted_helpers(pathlib.Path('/unused-synthetic-path'))

    def test_exact_positive_increment_at_bound_is_accepted(self):
        self.assertEqual(self.env['candidate_image_growth']({'Size': 100}, {'Size': 108}),
                         {'baseBytes': 100, 'candidateBytes': 108, 'incrementBytes': 8, 'upperBytes': 8})

    def test_overgrowth_equal_or_smaller_image_is_rejected(self):
        for size in [109, 100, 99]:
            with self.subTest(size=size), self.assertRaises(RuntimeError):
                self.env['candidate_image_growth']({'Size': 100}, {'Size': size})

    def test_noninteger_or_nonpositive_sizes_are_rejected(self):
        for old, new in [(True, 108), (100, True), (100.0, 108), (100, 108.0), ('100', 108),
                         (100, '108'), (0, 108), (100, 0), (-1, 7), (None, 108)]:
            with self.subTest(old=old, new=new), self.assertRaises(RuntimeError):
                self.env['candidate_image_growth']({'Size': old}, {'Size': new})


class RemainingCapacityTests(unittest.TestCase):
    def setUp(self):
        self.env = extracted_helpers(pathlib.Path('/unused-synthetic-path'))
        self.mib = 1024 ** 2
        self.budget = {'ordinaryReserveBytes': 256 * self.mib,
                       'physicalReserveBytes': 8 * 1024 ** 3,
                       'imageGrowthUpperBytes': 8 * self.mib,
                       'overlayStageUpperBytes': 4 * self.mib,
                       'coldBackupUpperBytes': 16 * self.mib,
                       'evidenceUpperBytes': 16 * self.mib}

    def test_allocated_archive_is_not_reserved_twice(self):
        for allocated, ordinary in [(0, 300), (4, 296), (12, 288), (36, 264)]:
            with self.subTest(allocated=allocated):
                result = self.env['remaining_capacity'](self.budget, allocated * self.mib)
                self.assertEqual(result['ordinary'], ordinary * self.mib)
                self.assertEqual(result['physical'], 8 * 1024 ** 3 + (ordinary - 256) * self.mib)

    def test_invalid_allocation_or_exceeded_archive_bound_is_rejected(self):
        for used in [-1, True, 1.0, '1', None, 36 * self.mib + 1]:
            with self.subTest(used=used), self.assertRaises(RuntimeError):
                self.env['remaining_capacity'](self.budget, used)


class EmbeddedQuietProbeTests(unittest.TestCase):
    def test_actual_probe_counts_an_active_connection_and_ignores_terminal_or_other_ports(self):
        probe = literal('QUIET_PROBE')
        fixture = ('  sl  local_address rem_address st\n'
                   '   0: 0100007F:0D48 0100007F:A001 01\n'
                   '   1: 00000000:0D48 00000000:0000 0A\n'
                   '   2: 0100007F:0D48 0100007F:A002 06\n'
                   '   3: 0100007F:0D48 0100007F:A003 07\n'
                   '   4: 0100007F:0050 0100007F:A004 01\n')
        script = '''const vm=require('node:vm'),assert=require('node:assert/strict');
let result;const fixtures=JSON.parse(process.argv[1]);
vm.runInNewContext(fixtures.probe,{require(name){assert.equal(name,'fs');return{readFileSync(file,encoding){
assert.equal(encoding,'utf8');return file==='/proc/net/tcp'?fixtures.tcp:'sl local_address rem_address st\\n';}};},
console:{log(value){result=JSON.parse(value);}}});assert.equal(result.connections,1);'''
        result = subprocess.run([str(NODE), '-e', script, json.dumps({'probe': probe, 'tcp': fixture})],
                                capture_output=True, text=True, timeout=10)
        self.assertEqual(result.returncode, 0, result.stderr)


class InertScopeAndBudgetTests(unittest.TestCase):
    def helpers(self):
        names={'need','enc','sha','pin','budget_contract','test_manifest_contract','remaining_capacity'}
        nodes=[n for n in SOURCE.body if isinstance(n,ast.FunctionDef)and n.name in names]
        e={'hashlib':hashlib,'json':json,'re':re,'STAGE':'synthetic',
           'CAPACITY_BUDGET':literal('CAPACITY_BUDGET'),'CAPACITY_BUDGET_SHA256':'','PROFILE_RESULT_SHA256':'',
           'TEST_FILES':{},'REQUIRED_TEST_FILES':literal('REQUIRED_TEST_FILES'),'EXPECTED_NATIVE_TESTS':None}
        exec(compile(ast.Module(body=nodes,type_ignores=[]),'new-qc-guards-only','exec'),e)
        return e

    def budget(self,e,**changes):
        budget=dict(literal('CAPACITY_BUDGET'),approved=True,profileFileSHA256='1'*64)
        budget.update(changes);e.update(CAPACITY_BUDGET=budget,PROFILE_RESULT_SHA256='1'*64,CAPACITY_BUDGET_SHA256=e['sha'](e['enc'](budget)))
        return budget

    def test_new_archive_is_distinct_and_all_final_bindings_are_inert(self):
        # Binding source pins is distinct from authorizing an execution. This
        # local review must remain inert in every supported release phase.
        self.assertIs(literal('EXECUTE'),False)
        phase=literal('PHASE');self.assertIn(phase,('', 'prepare','deploy','verify'))
        archive=next(n for n in SOURCE.body if isinstance(n,ast.Assign)and any(isinstance(t,ast.Name)and t.id=='ARCHIVE'for t in n.targets))
        self.assertEqual(ast.literal_eval(archive.value.right),'deploy/backups/batch1056-1062-qc-20261103-3')
        self.assertEqual(set(literal('REVIEWED_HEADS')),{'1056','1057','1058','1062'})
        e=self.helpers()
        if not phase:
            for name in('HOST_BASE','BASE','TARGET','TREE','APP_TREE','PROFILE_PATH','PROFILE_RESULT_SHA256','PROFILE_VALUE_SHA256',
                        'CID','QC_BACKUP_ID','LIVE_IMAGE','BASE_IMAGE','ALIAS_IMAGE','LIVE_SOURCE_SHA256','DIRTY_SHA256','PREPARED_SHA256','DEPLOY_SHA256','CAPACITY_BUDGET_SHA256'):
                self.assertEqual(literal(name),'',name)
            self.assertIsNone(literal('EXPECTED_CONTAINER_COUNT'));self.assertIsNone(literal('EXPECTED_NATIVE_TESTS'));self.assertIsNone(literal('DIRTY_PATH_COUNT'))
            self.assertEqual(literal('REVIEWED_FILES'),{});self.assertEqual(literal('TEST_FILES'),{});self.assertEqual(literal('REVIEWED_PATHS'),())
            self.assertEqual(literal('REVIEWED_HEADS')['1062'],'')
            with self.assertRaises(RuntimeError):e['budget_contract']()
            return
        for name in('HOST_BASE','BASE','TARGET','TREE','APP_TREE'):
            self.assertTrue(e['pin'](literal(name),40),name)
        self.assertTrue(all(e['pin'](head,40)for head in literal('REVIEWED_HEADS').values()))
        for name in('CID','QC_BACKUP_ID','LIVE_SOURCE_SHA256','PROFILE_RESULT_SHA256','PROFILE_VALUE_SHA256','DIRTY_SHA256','CAPACITY_BUDGET_SHA256'):
            self.assertTrue(e['pin'](literal(name)),name)
        self.assertNotEqual(literal('CID'),literal('QC_BACKUP_ID'))
        for name in('LIVE_IMAGE','BASE_IMAGE','ALIAS_IMAGE'):
            self.assertRegex(literal(name),r'^sha256:[a-f0-9]{64}$')
        self.assertEqual(literal('BASE_IMAGE'),literal('ALIAS_IMAGE'))
        self.assertEqual(literal('PROFILE_PATH'),'/opt/rr-portal/deploy/backups/batch1056-1060-preflight-9-20261103/result.private.json')
        self.assertEqual(literal('EXPECTED_CONTAINER_COUNT'),47)
        self.assertEqual(literal('EXPECTED_NATIVE_TESTS'),339)
        self.assertIs(type(literal('DIRTY_PATH_COUNT')),int);self.assertGreaterEqual(literal('DIRTY_PATH_COUNT'),0)
        code=literal('DIFF_CODE')+literal('CORRECTION_CODE')
        self.assertEqual(set(literal('REVIEWED_FILES')),set(code))
        self.assertTrue(all(e['pin'](digest)for digest in literal('REVIEWED_FILES').values()))
        reviewed=literal('REVIEWED_PATHS')
        self.assertTrue(reviewed);self.assertEqual(len(reviewed),len(set(reviewed)))
        self.assertTrue(all(re.fullmatch(r'[A-Za-z0-9_./-]+',name)and '..'not in name.split('/')for name in reviewed))
        self.assertTrue(set(literal('DIFF_CODE'))<=set(reviewed))
        e.update(CAPACITY_BUDGET_SHA256=literal('CAPACITY_BUDGET_SHA256'),PROFILE_RESULT_SHA256=literal('PROFILE_RESULT_SHA256'),
                 TEST_FILES=literal('TEST_FILES'),EXPECTED_NATIVE_TESTS=literal('EXPECTED_NATIVE_TESTS'))
        self.assertEqual(e['budget_contract'](),literal('CAPACITY_BUDGET'))
        self.assertEqual(set(e['test_manifest_contract']()),set(literal('REQUIRED_TEST_FILES')))
        for name,required in(('PREPARED_SHA256',phase in('deploy','verify')),('DEPLOY_SHA256',phase=='verify')):
            self.assertTrue(e['pin'](literal(name))if required else literal(name)=='',name)

    def test_explicit_eleven_file_scope_includes_auth_index_and_unchanged_three_repairs(self):
        diff=literal('DIFF_CODE');correction=literal('CORRECTION_CODE')
        self.assertEqual(set(diff),{'ai-ocr.js','app.js','qc-backend.js','mobile.css','server/server.js','report_export.js','index.html','server/auth.js'})
        self.assertEqual(set(correction),{'dev-server.js','package.json','server/extract-seed.js'})
        self.assertEqual(len(diff+correction),len(set(diff+correction)));self.assertEqual(len(diff+correction),11)

    def test_own_archive_root_rejects_link_or_nonprivate_mode_before_phase_files(self):
        with tempfile.TemporaryDirectory(prefix='synthetic-new-qc-archive-')as temp:
            root=pathlib.Path(temp).resolve();archive=root/'own-archive';archive.mkdir(mode=0o700)
            nodes=[n for n in SOURCE.body if isinstance(n,ast.FunctionDef)and n.name in('need','archive_root_contract')]
            e={'ARCHIVE':archive,'stat':stat,'STAGE':'synthetic'}
            exec(compile(ast.Module(body=nodes,type_ignores=[]),'archive-contract-only','exec'),e)
            e['archive_root_contract']();archive.chmod(0o755)
            with self.assertRaises(RuntimeError):e['archive_root_contract']()
            archive.chmod(0o700);link=root/'not-the-own-directory';link.symlink_to(archive,target_is_directory=True);e['ARCHIVE']=link
            with self.assertRaises(RuntimeError):e['archive_root_contract']()

    def test_original_36mib_bounds_and_fresh_profile9_contract_are_retained(self):
        e=self.helpers();b=self.budget(e);self.assertEqual(e['budget_contract'](),b)
        self.assertEqual(b['ordinaryReserveBytes'],256*1024**2);self.assertEqual(b['physicalReserveBytes'],8*1024**3)
        self.assertEqual([b[n]for n in('imageGrowthUpperBytes','overlayStageUpperBytes','coldBackupUpperBytes','evidenceUpperBytes')],[4*1024**2,4*1024**2,16*1024**2,12*1024**2])
        self.assertEqual(b['dataRootUpperBytes'],4*1024**2);self.assertEqual(b['databaseUpperCount'],13)
        self.assertEqual(e['remaining_capacity'](b,0),{'ordinary':306184192,'physical':8627683328})
        self.assertEqual(e['remaining_capacity'](b,32*1024**2),{'ordinary':260*1024**2,'physical':8*1024**3+4*1024**2})
        profile=next(n for n in SOURCE.body if isinstance(n,ast.FunctionDef)and n.name=='profile_check')
        self.assertIn('batch1056-1060-preflight-9-20261103',{n.value for n in ast.walk(profile)if isinstance(n,ast.Constant)and isinstance(n.value,str)})

    def test_resealed_lower_reserves_or_cold_underestimate_are_rejected(self):
        for change in({'ordinaryReserveBytes':256*1024**2-1},{'physicalReserveBytes':8*1024**3-1},
                       {'coldBackupUpperBytes':16*1024**2-1},{'databaseUpperCount':12},{'imageGrowthUpperBytes':True},
                       {'ordinaryRequiredBytes':306184191},{'physicalRequiredBytes':8627683327}):
            with self.subTest(change=change):
                e=self.helpers();self.budget(e,**change)
                with self.assertRaises(RuntimeError):e['budget_contract']()

    def test_all_thirteen_tests_including_layout_sessions_rotation_grounding_are_required(self):
        e=self.helpers();files={n:'2'*64 for n in e['REQUIRED_TEST_FILES']};e.update(TEST_FILES=files,EXPECTED_NATIVE_TESTS=287)
        self.assertEqual(e['test_manifest_contract'](),tuple(sorted(files)))
        self.assertEqual(len(files),13)
        for name in('frontend-ocr-rotation.test.js','server/ocr-grounding.test.js','server/ocr-delivery-columns.test.js','server/session-store.test.js'):
            self.assertIn(name,files)
        for missing in('frontend-ocr-rotation.test.js','server/ocr-grounding.test.js','server/record-sync.test.js','server/ocr-delivery-columns.test.js','server/session-store.test.js'):
            e['TEST_FILES']={n:h for n,h in files.items()if n!=missing}
            with self.subTest(missing=missing),self.assertRaises(RuntimeError):e['test_manifest_contract']()
        e['TEST_FILES']=dict(files,**{'unreviewed.test.js':'2'*64})
        with self.assertRaises(RuntimeError):e['test_manifest_contract']()
        e['TEST_FILES']=files
        for count in(None,0,-1,True,287.0):
            e['EXPECTED_NATIVE_TESTS']=count
            with self.subTest(count=count),self.assertRaises(RuntimeError):e['test_manifest_contract']()


class QcSqliteClassificationTests(unittest.TestCase):
    def load(self,name):
        spec=importlib.util.spec_from_file_location('synthetic_'+name.replace('.','_'),DRAFT.with_name(name))
        module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module

    def create_db(self,path,label):
        with sqlite3.connect(path)as db:
            db.execute('CREATE TABLE synthetic(id INTEGER PRIMARY KEY,label TEXT,quantity INTEGER)')
            db.execute('INSERT INTO synthetic VALUES(1,?,?)',(label,7))

    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix='synthetic-qc-active-history-');self.addCleanup(self.temp.cleanup)
        self.root=pathlib.Path(self.temp.name).resolve();self.data=self.root/'data';self.data.mkdir(mode=0o700)
        self.companies=literal('COMPANIES');self.backups={}
        for company in self.companies:
            folder=self.data/company;folder.mkdir(mode=0o700)
            self.create_db(folder/'qc.db','active-'+company)
            backup=folder/'qc.db.bak.20260910-152122';self.create_db(backup,'historical-'+company)
            backup.chmod(0o640);os.utime(backup,ns=(1700000000000000000,1700000000000000000))
            self.backups[str(backup.relative_to(self.data))]=hashlib.sha256(backup.read_bytes()).hexdigest()
        (self.data/'sessions.json').write_text('{"version":1,"sessions":[]}')
        self.ops=self.load('release-data-ops-library.py');self.lib=self.load('release-data-library.py')
        libraries={'release-data-ops-library.py':self.ops,'release-data-library.py':self.lib,'pr1035-quote-preflight.py':types.SimpleNamespace()}
        names={'need','enc','sha','pin','setup','qc_database_names','data_estimate','data_metadata'}
        definitions=[n for n in SOURCE.body if isinstance(n,ast.FunctionDef)and n.name in names]
        self.env={'pathlib':pathlib,'hashlib':hashlib,'json':json,'re':re,'stat':stat,'ROOT':self.root,'OUT':self.root/'unused-output',
                  'DATA_ROOT':self.data,'COMPANIES':self.companies,'LEGACY_SQLITE_BACKUPS':self.backups,'O_DATABASE_NAMES':None,
                  'load':lambda name:libraries[name],'run':lambda *a,**kw:self.fail('No subprocess may run in SQLite classifier tests'),'STAGE':'synthetic'}
        exec(compile(ast.Module(body=definitions,type_ignores=[]),'actual-classifier-and-setup','exec'),self.env)
        self.original_scanner=self.ops.database_names;self.env['setup']()

    def classified(self):return self.env['qc_database_names'](self.data)

    def test_production_history_pins_are_exactly_the_thirteen_observed_paths(self):
        pins=literal('LEGACY_SQLITE_BACKUPS')
        self.assertEqual(set(pins),{c+'/qc.db.bak.20260910-152122'for c in self.companies})
        self.assertTrue(all(re.fullmatch('[a-f0-9]{64}',value)for value in pins.values()))
        self.assertEqual(pins['dg-xingxin/qc.db.bak.20260910-152122'],'3f87c024e94f313e223fe72cbf9e1100ac3d69742c17c629db56cab9869babb8')

    def test_both_library_entry_points_share_wrapper_and_total_bytes_still_include_history(self):
        self.assertIs(self.env['O_DATABASE_NAMES'],self.original_scanner)
        self.assertIs(self.ops.database_names,self.env['qc_database_names']);self.assertIs(self.lib.databases,self.env['qc_database_names'])
        self.assertEqual(len(self.original_scanner(self.data)),26)
        self.assertEqual(self.classified(),sorted(c+'/qc.db'for c in self.companies))
        estimate=self.env['data_estimate']()
        self.assertEqual(estimate['databases'],13);self.assertEqual(estimate['regularFiles'],27)
        self.assertEqual(estimate['bytes'],sum(p.stat().st_size for p in self.data.rglob('*')if p.is_file()))

    def test_actual_sqlite_capture_audits_thirteen_active_dbs_and_archives_every_historical_byte(self):
        before=self.env['data_metadata'](self.classified());original_connect=self.lib.connect
        def no_historical_sql_open(path,*args,**kw):
            self.assertNotIn('.bak.',str(path));return original_connect(path,*args,**kw)
        self.lib.connect=no_historical_sql_open
        result=self.ops.sqlite_capture('qc',self.data,self.root/'cold-capture')
        self.assertEqual(set(result['sqlite']),{c+'/qc.db'for c in self.companies})
        self.assertEqual(len(result['sqlite']),13)
        for name,audit in result['sqlite'].items():
            self.assertEqual(audit['tables']['synthetic']['rows'],1)
            with sqlite3.connect((self.root/'cold-capture/sqlite'/name).as_uri()+'?mode=ro',uri=True)as db:
                self.assertEqual(db.execute('SELECT label,quantity FROM synthetic').fetchone(),('active-'+name.split('/')[0],7))
        files={row['path']:row for row in result['files']}
        self.assertTrue(set(self.backups)<=set(files));self.assertIn('sessions.json',files)
        with tarfile.open(self.root/'cold-capture/files.tar','r')as archive:
            for name,digest in self.backups.items():
                member=archive.getmember(name);self.assertTrue(member.isfile());self.assertFalse(member.islnk())
                body=archive.extractfile(member).read();self.assertEqual(body,(self.data/name).read_bytes())
                self.assertEqual(hashlib.sha256(body).hexdigest(),digest);self.assertEqual(files[name]['sha256'],digest)
                self.assertEqual(member.mode,0o640)
        self.assertEqual(self.env['data_metadata'](self.classified()),before)
        historical={row['path']:row for row in before if row['path']in self.backups}
        self.assertEqual(len(historical),13)
        for name,row in historical.items():
            meta=(self.data/name).stat();self.assertEqual(row['type'],'file');self.assertEqual(row['sha256'],self.backups[name])
            self.assertEqual([row[k]for k in('uid','gid','mode','mtimeNs')],[meta.st_uid,meta.st_gid,0o640,1700000000000000000])

    def test_unknown_sqlite_with_an_arbitrary_or_hidden_extension_is_rejected(self):
        for name in ['unknown.payload','.hidden-sqlite']:
            path=self.data/name;self.create_db(path,'unknown')
            with self.subTest(name=name),self.assertRaises(RuntimeError):self.classified()
            path.unlink()

    def test_missing_changed_or_corrupt_history_is_never_silently_excluded(self):
        name=next(iter(self.backups));path=self.data/name;body=path.read_bytes()
        for change in ['missing','modified','corrupt']:
            if change=='missing':path.unlink()
            else:path.write_bytes(body+b'changed'if change=='modified'else b'no SQLite header')
            with self.subTest(change=change),self.assertRaises(RuntimeError):self.classified()
            path.write_bytes(body)

    def test_historical_hardlink_is_rejected_before_a_tar_or_snapshot_is_created(self):
        name=next(iter(self.backups));path=self.data/name;path.unlink();os.link(path.with_name('qc.db'),path)
        with self.assertRaisesRegex(RuntimeError,'regular-single-link'):self.classified()
        self.assertFalse((self.root/'cold-capture').exists())

    def test_missing_active_or_nonfixed_root_is_rejected(self):
        path=self.data/self.companies[0]/'qc.db';path.unlink()
        with self.assertRaises(RuntimeError):self.classified()
        with self.assertRaisesRegex(RuntimeError,'fixed-qc-root'):self.env['qc_database_names'](self.root)


class FailedCapacityWitnessTests(unittest.TestCase):
    def setUp(self):
        names={'need','capacity_witness','remaining_capacity','free_check'}
        nodes=[n for n in SOURCE.body if isinstance(n,ast.FunctionDef)and n.name in names]
        self.b=literal('CAPACITY_BUDGET');self.data={'bytes':1837078,'databases':13,'privatePathNeverExported':'secret'}
        fake_path=lambda value:types.SimpleNamespace(is_absolute=lambda:True,read_text=lambda:'MemAvailable: 8586264 kB\n')
        self.env={'STAGE':'synthetic','budget_contract':lambda:self.b,'pathlib':types.SimpleNamespace(Path=fake_path),'re':re,
            'memory':lambda *args:'/synthetic/docker','os':types.SimpleNamespace(statvfs=lambda root:types.SimpleNamespace(f_bavail=314368000,f_bfree=9115664384,f_frsize=1)),
            'allocation':lambda folder:1708032,'ARCHIVE':None,'data_estimate':lambda:self.data,'time':types.SimpleNamespace(time_ns=lambda:123),'CAPACITY_BUDGET_SHA256':'1'*64,'LAST_CAPACITY_WITNESS':None}
        exec(compile(ast.Module(body=nodes,type_ignores=[]),'actual-free-check-with-synthetic-measurements','exec'),self.env)

    def test_current_exact_numbers_pass_with_thirteen_active_without_lowering_any_bound(self):
        value=self.env['free_check']();w=self.env['LAST_CAPACITY_WITNESS']
        self.assertTrue(w['passed']);self.assertTrue(all(w['checks'].values()))
        self.assertEqual(value['minimumOrdinaryBytes'],304476160);self.assertEqual(value['minimumPhysicalBytes'],8625975296)
        self.assertEqual(w['activeDatabaseUpperCount'],13);self.assertNotIn('privatePathNeverExported',json.dumps(w))

    def test_original_twenty_six_count_failure_has_numeric_witness_attached_by_real_except_statement(self):
        self.data['databases']=26
        with self.assertRaisesRegex(RuntimeError,'actual-qc-space'):self.env['free_check']()
        witness=self.env['LAST_CAPACITY_WITNESS'];self.assertFalse(witness['passed'])
        self.assertEqual([k for k,v in witness['checks'].items()if not v],['activeDatabaseCount'])
        self.assertEqual(witness['activeDatabases'],26);self.assertEqual(witness['activeDatabaseUpperCount'],13)
        main=next(n for n in SOURCE.body if isinstance(n,ast.FunctionDef)and n.name=='main')
        handler=next(n for n in main.body if isinstance(n,ast.Try)).handlers[0]
        attach=next(n for n in handler.body if isinstance(n,ast.If)and any(isinstance(x,ast.Constant)and x.value=='failedCapacityWitness'for x in ast.walk(n)))
        self.env['v']={};exec(compile(ast.Module(body=[attach],type_ignores=[]),'actual-failure-attachment','exec'),self.env)
        self.assertEqual(self.env['v']['failedCapacityWitness'],witness)
        self.data['databases']=13;self.env['free_check']();self.env['v']={}
        exec(compile(ast.Module(body=[attach],type_ignores=[]),'no-stale-success-witness','exec'),self.env)
        self.assertEqual(self.env['v'],{})

    def test_each_capacity_failure_is_identified_by_safe_numeric_boolean_fields(self):
        remaining=self.env['remaining_capacity'](self.b,1708032)
        base=[self.b,self.data,remaining,314368000,9115664384,8792334336,1708032]
        for failed in ['dataBytes','activeDatabaseCount','ordinary','physical','memory','archiveAllocation']:
            args=list(base);args[1]=dict(self.data)
            if failed=='dataBytes':args[1]['bytes']=self.b['dataRootUpperBytes']+1
            if failed=='activeDatabaseCount':args[1]['databases']=14
            if failed=='ordinary':args[3]=remaining['ordinary']-1
            if failed=='physical':args[4]=remaining['physical']-1
            if failed=='memory':args[5]=self.b['minimumMemAvailableBytes']-1
            if failed=='archiveAllocation':args[6]=sum(self.b[k]for k in('overlayStageUpperBytes','coldBackupUpperBytes','evidenceUpperBytes'))+1
            witness=self.env['capacity_witness'](*args)
            with self.subTest(failed=failed):
                self.assertFalse(witness['passed']);self.assertEqual([k for k,v in witness['checks'].items()if not v],[failed])
                self.assertTrue(all(type(v)is int for k,v in witness.items()if k not in('checks','passed')))


class AuthPolicyContractTests(unittest.TestCase):
    OLD_SIGNATURE='function createSessions({ now = Date.now, lifetime = 12 * 60 * 60 * 1000 } = {}) {\n'
    NEW_SIGNATURE='function createSessions({ now = Date.now, lifetime = 12 * 60 * 60 * 1000, storeFile = null } = {}) {\n'
    PREFIX=("'use strict';\nconst crypto = require('node:crypto');\n\n"
            "const MENUS = ['records'];\nconst COLUMNS = ['v','e'];\n"
            "function permissions(user) { return user.perms; }\n"
            "function publicUser(user) { return {username:user.username}; }\n"
            "function hashPassword(value) { return crypto.scryptSync(value,'salt',32); }\n"
            "function checkPassword(value,stored) { return value === stored; }\n"
            "function validJSONRequest(req) { return req.headers.origin; }\n")
    EXPORT='module.exports = { MENUS, COLUMNS, permissions, publicUser, hashPassword, checkPassword, validJSONRequest, createSessions };\n'

    def setUp(self):
        nodes=[n for n in SOURCE.body if isinstance(n,ast.FunctionDef)and n.name in('need','auth_policy_contract')]
        self.env={'STAGE':'synthetic'}
        exec(compile(ast.Module(body=nodes,type_ignores=[]),'auth-policy-only','exec'),self.env)
        self.old=(self.PREFIX+self.OLD_SIGNATURE+'  return {};\n}\n'+self.EXPORT).encode()
        prefix=self.PREFIX.replace("const crypto = require('node:crypto');\n", "const crypto = require('node:crypto');\nconst fs     = require('node:fs');\nconst path   = require('node:path');\n")
        self.new=(prefix+self.NEW_SIGNATURE+'  const state = new Map();\n  return {storage:storeFile,state};\n}\n'+self.EXPORT).encode()

    def check(self,new=None):return self.env['auth_policy_contract'](self.old,self.new if new is None else new)

    def test_only_exact_storage_imports_and_session_factory_implementation_are_allowed(self):
        result=self.check();self.assertTrue(result['permissionPolicyUnchanged'])
        self.assertTrue(result['sessionFactorySeparatelyHashPinned']);self.assertTrue(result['requiredSessionStoreTests'])
        changed=self.new.replace(b'return {storage:storeFile,state};',b'return {storage:storeFile,revoked:state};')
        self.assertEqual(self.check(changed),result)

    def test_any_permission_public_user_password_request_or_export_policy_change_is_rejected(self):
        for old,new in [(b"['records']",b"['records','users']"),(b"['v','e']",b"['v','e','a']"),
                        (b'return user.perms;',b'return true;'),(b'{username:user.username}',b'{username:user.username,password:user.password}'),
                        (b"crypto.scryptSync(value,'salt',32)",b"crypto.scryptSync(value,'salt',16)"),
                        (b'return value === stored;',b'return true;'),(b'return req.headers.origin;',b'return true;'),
                        (b'validJSONRequest, createSessions };',b'validJSONRequest, createSessions, bypass:true };')]:
            with self.subTest(policy=old),self.assertRaises(RuntimeError):self.check(self.new.replace(old,new))

    def test_extra_import_signature_or_top_level_statement_cannot_hide_in_factory_exception(self):
        for body in [self.new.replace(b"const fs     = require('node:fs');\n",b''),
                     self.new.replace(b"const fs     = require('node:fs');\n",b"const fs     = require('node:fs');\n"*2),
                     self.new.replace(b"const fs     = require('node:fs');\n",b"const fs     = require('node:fs');\nconst os = require('node:os');\n"),
                     self.new.replace(b'storeFile = null',b'storeFile = null, bypass = true'),
                     self.new.replace(b'module.exports = ',b'permissions = () => true;\nmodule.exports = '),
                     self.new.replace(b'module.exports = ',b'function bypass() { return true;\n}\nmodule.exports = ')]:
            with self.subTest(body=body),self.assertRaises(RuntimeError):self.check(body)


class EmbeddedNativeManifestTests(unittest.TestCase):
    def test_actual_native_dispatch_has_exactly_one_auth_source_and_both_new_required_tests(self):
        nodes=[n for n in SOURCE.body if isinstance(n,ast.FunctionDef)and n.name in('need','enc','sha','native_tests')]
        body=b'// synthetic test only';digest=hashlib.sha256(body).hexdigest();calls=[]
        code=literal('DIFF_CODE')+literal('CORRECTION_CODE')
        env={'STAGE':'synthetic','hashlib':hashlib,'json':json,'CODE':code,
             'TEST_FILES':{name:digest for name in literal('REQUIRED_TEST_FILES')},'TARGET':'1'*40,
             'APP':'synthetic-app','EXPECTED_NATIVE_TESTS':333,'NATIVE_TEST':literal('NATIVE_TEST'),
             'git':lambda *args:body,'run':lambda args,data,timeout:calls.append((args,json.loads(data),timeout))}
        exec(compile(ast.Module(body=nodes,type_ignores=[]),'native-dispatch-only','exec'),env)
        result=env['native_tests']('synthetic-image')
        self.assertEqual(len(calls),1);args,data,timeout=calls[0]
        self.assertEqual(data['sources'],list(code)+['sso.js']);self.assertEqual(len(set(data['sources'])),12)
        self.assertEqual(data['sources'].count('server/auth.js'),1);self.assertEqual(len(data['files']),13)
        self.assertIn('server/ocr-delivery-columns.test.js',data['files']);self.assertIn('server/session-store.test.js',data['files'])
        self.assertEqual(timeout,240);self.assertEqual(result['tests'],333);self.assertFalse(result['productionMountsOrCredentialsUsed'])

    def execute(self,missing_index=False,invalid_source=False,duplicate_auth=False,skips=0):
        # Run the actual embedded harness in a VM with fully synthetic fs/child
        # surfaces. Neither the harness nor its mocked child touches disk/network.
        names=literal('REQUIRED_TEST_FILES');sources=list(literal('DIFF_CODE')+literal('CORRECTION_CODE'))+['sso.js']
        if missing_index:sources.remove('index.html')
        if invalid_source:sources[0]='../private-file'
        if duplicate_auth:sources[0]='server/auth.js'
        fixture={'probe':literal('NATIVE_TEST'),'names':names,'sources':sources,'skips':skips}
        script=r'''const vm=require('node:vm'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const fixture=JSON.parse(process.argv[1]),body=Buffer.from('// synthetic test only'),files=Object.fromEntries(fixture.names.map(n=>[n,{body:body.toString('base64'),sha256:crypto.createHash('sha256').update(body).digest('hex')}]));
const data={files,sources:fixture.sources,expected:287},writes=[],readSources=[];let spawned=false,removed=false,error=null;
const fs={readFileSync(name){if(name===0)return JSON.stringify(data);assert.ok(name.startsWith('/app/'));readSources.push(name);return Buffer.from('// synthetic reviewed source');},
mkdtempSync(){return '/synthetic/native';},mkdirSync(){},writeFileSync(name){writes.push(name);},rmSync(){removed=true;}};
try{vm.runInNewContext(fixture.probe,{Buffer,process:{execPath:'/synthetic/node',env:{PATH:'/synthetic-bin'}},require(name){if(name==='fs')return fs;if(name==='path')return path;if(name==='os')return{tmpdir(){return '/synthetic';}};if(name==='crypto')return crypto;if(name==='child_process')return{spawnSync(executable,args,options){spawned=true;assert.equal(executable,'/synthetic/node');assert.deepEqual(Array.from(args.slice(2)),Object.keys(files).sort());assert.equal(options.env.DATA_PATH,'/synthetic/native/data');assert.equal(options.env.QC_BAILIAN_API_KEY,'');return{status:0,stdout:'# tests 287\n# pass 287\n# fail 0\n# skipped '+fixture.skips+'\n',stderr:''};}};throw Error('unexpected module '+name);}});}catch(e){error=e.message;}
if(fixture.sources.length!==12||new Set(fixture.sources).size!==12||fixture.sources.some(n=>n.includes('..'))){assert.ok(error);assert.equal(spawned,false);}else if(fixture.skips){assert.equal(error,'native-test-count-or-skip');}else{assert.equal(error,null);assert.ok(spawned);assert.ok(readSources.includes('/app/index.html'));assert.ok(readSources.includes('/app/report_export.js'));assert.equal(readSources.filter(n=>n==='/app/server/auth.js').length,1);assert.ok(writes.includes('/synthetic/native/frontend-ocr-rotation.test.js'));assert.ok(writes.includes('/synthetic/native/server/ocr-grounding.test.js'));assert.ok(writes.includes('/synthetic/native/server/ocr-delivery-columns.test.js'));assert.ok(writes.includes('/synthetic/native/server/session-store.test.js'));assert.equal(readSources.length,12);}assert.equal(removed,true);'''
        result=subprocess.run([str(NODE),'-e',script,json.dumps(fixture)],capture_output=True,text=True,timeout=10,env={'PATH':'/usr/bin:/bin'})
        self.assertEqual(result.returncode,0,result.stderr)

    def test_actual_harness_copies_twelve_unique_sources_and_invokes_thirteen_tests(self):self.execute()
    def test_missing_index_or_unsafe_source_fails_before_child_run(self):
        self.execute(missing_index=True);self.execute(invalid_source=True);self.execute(duplicate_auth=True)
    def test_skipped_native_test_fails_required_count(self):self.execute(skips=1)


if __name__ == '__main__':
    unittest.main()
