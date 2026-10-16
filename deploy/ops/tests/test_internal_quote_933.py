"""Offline operations tests. Synthetic files, real Git, mocked GET only; no live writes."""
import copy
import decimal
import hashlib
import importlib.util
import json
import os
import pathlib
import subprocess
import tempfile
import unittest
from unittest.mock import patch

MODULE = pathlib.Path(__file__).resolve().parents[1] / 'internal-quote-933.py'
spec = importlib.util.spec_from_file_location('internal_quote_ops_933', MODULE)
ops = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ops)


class CanonicalTests(unittest.TestCase):
    def test_high_precision_decimal_never_rounds(self):
        first = decimal.Decimal('1234567890123456789012345678901234567890.123456789')
        second = decimal.Decimal('1234567890123456789012345678901234567890.123456788')
        self.assertNotEqual(ops.digest_rows([first]),ops.digest_rows([second]))
        self.assertEqual(ops.digest_rows([decimal.Decimal('1.2000')]),ops.digest_rows([decimal.Decimal('1.2')]))

    def test_multiset_keeps_duplicates_and_scalar_types(self):
        self.assertEqual(ops.digest_rows([{'a':1},{'a':2}]),ops.digest_rows([{'a':2},{'a':1}]))
        self.assertNotEqual(ops.digest_rows([1,1]),ops.digest_rows([1]))
        self.assertEqual(5,len(set(ops.digest_rows([v]) for v in (None,False,0,'0',[]))))

    def test_nonfinite_and_unrecognized_objects_rejected(self):
        for value in (decimal.Decimal('Infinity'),decimal.Decimal('NaN'),object()):
            with self.subTest(kind=type(value).__name__),self.assertRaises(RuntimeError): ops.canonical(value)

    def test_all_tables_are_discovered_beyond_required_and_bad_identifiers_rejected(self):
        names = list(ops.REQUIRED_TABLES)+['new_future_table']
        self.assertIn('new_future_table',ops.table_names(names))
        for bad in (names+['x;DROP TABLE users'],names+['users'],['users']):
            with self.assertRaises(RuntimeError):ops.table_names(bad)
        sql = ops.audit_sql(names)
        self.assertIn('BEGIN' if False else 'to_jsonb(r)::text',sql)
        self.assertIn('internal_quote."new_future_table"',sql)


class StartupTests(unittest.TestCase):
    def good(self):
        value = {'existingUsersPreventSeedAndLegacyMigration':True,'configuredAccountSeedApplied':True,
                 'qingxiMaterialPriceMigrationApplied':True,'heyuanRetirementMigrationApplied':True}
        for key in ('expiredRecycleQuotes','knownFactoriesWouldChange','knownDepartmentsWouldChange',
                    'missingQuoteSections','missingDefaultUserFactoryScope','missingGlobalReferenceTables',
                    'missingFactoryReferenceTables','missingMaterialPriceManagerLinks'):value[key]=0
        return value

    def test_every_known_startup_effect_fails_closed(self):
        good=self.good()
        self.assertTrue(all(v for v,_ in ops.startup_safety_checks(good)))
        for key in good:
            bad=copy.deepcopy(good);bad[key]=False if type(good[key]) is bool else 1
            with self.subTest(key=key):self.assertFalse(all(v for v,_ in ops.startup_safety_checks(bad)))

    def test_missing_extra_and_wrong_type_checks_rejected(self):
        bad=self.good();bad.pop('expiredRecycleQuotes')
        extra=self.good();extra['unreviewedEffect']=0
        wrong=self.good();wrong['expiredRecycleQuotes']=False
        for value in (bad,extra,wrong):
            with self.assertRaises(RuntimeError):ops.startup_safety_checks(value)

    def test_actual_startup_source_is_unchanged_since_reviewed_922(self):
        root=MODULE.parents[2]
        for relative in ('backend/db/postgres.js','backend/db/accountSeed.js','backend/db/schema.postgres.sql'):
            path=ops.APP_PREFIX+relative
            before=subprocess.check_output(['git','show','d88df26f489dd87141b8f02021eb7001096f04d2:'+path],cwd=root)
            current=(root/path).read_bytes()
            self.assertEqual(before,current)


class EnvironmentTests(unittest.TestCase):
    def setUp(self):
        self.image={'NODE_VERSION':'22.20.0','YARN_VERSION':'1.22.22'}
        self.values=dict(self.image,SESSION_SECRET='synthetic-private-key',DATABASE_URL='postgresql://offline/fixture',DB_SCHEMA='internal_quote',PATH='/usr/bin',TZ='Asia/Shanghai')

    def check(self,values=None,image=None,process=False,hostname=None):
        values=self.values if values is None else values
        return ops.protected_environment([k+'='+v for k,v in values.items()],image or self.image,process,hostname)

    def test_only_actual_image_inherited_public_node22_versions_can_change(self):
        before=self.check()
        image=dict(self.image,NODE_VERSION='22.21.0')
        after=self.check(dict(self.values,NODE_VERSION='22.21.0'),image)
        self.assertNotEqual(before[0],after[0]);self.assertEqual(before[1],after[1]);self.assertNotEqual(before[2],after[2])
        for values,image in ((dict(self.values,NODE_VERSION='24.1.0'),dict(self.image,NODE_VERSION='24.1.0')),
                             (dict(self.values,NODE_VERSION='22.21.0'),self.image)):
            with self.assertRaises(RuntimeError):self.check(values,image)

    def test_secret_paths_schema_timezone_and_unknown_environment_changes_remain_protected(self):
        baseline=self.check()[1]
        for key,val in {'SESSION_SECRET':'different','DATABASE_URL':'postgresql://other/db','DB_SCHEMA':'other',
                        'PATH':'/tmp','TZ':'UTC','NEW_UNKNOWN_KEY':'new'}.items():
            with self.subTest(key=key):self.assertNotEqual(baseline,self.check(dict(self.values,**{key:val}))[1])

    def test_process_hostname_exception_requires_actual_automatic_hostname(self):
        first=self.check(dict(self.values,HOSTNAME='a'*12),process=True,hostname='a'*12)
        second=self.check(dict(self.values,HOSTNAME='b'*12),process=True,hostname='b'*12)
        self.assertEqual(first[1],second[1]);self.assertNotEqual(first[0],second[0])
        with self.assertRaises(RuntimeError):self.check(dict(self.values,HOSTNAME='custom'),process=True,hostname='b'*12)

    def test_duplicate_keys_rejected(self):
        with self.assertRaises(RuntimeError):ops.protected_environment(['NODE_VERSION=22.20.0','NODE_VERSION=22.20.0'],self.image)

    def test_actual_nginx_protects_bound_config_and_authorization_without_output(self):
        calls=[]
        def read(args):calls.append(args);return b'synthetic-private-auth' if args[-1].endswith('.htpasswd') else b'actual-nginx-config'
        with patch.object(ops,'cid',return_value='a'*64),patch.object(ops,'run',side_effect=read):result=ops.nginx_protected()
        self.assertEqual({'actualConfig','actualAuthorization'},set(result))
        self.assertEqual(['/etc/nginx/nginx.conf','/etc/nginx/.htpasswd'],[v[-1] for v in calls])
        self.assertNotIn('synthetic-private-auth',json.dumps(result))

    def test_each_core_running_health_and_oom_checked(self):
        good={'State':{'Running':True,'OOMKilled':False,'Health':{'Status':'healthy'},'StartedAt':'2026-10-16T00:00:00Z'},'RestartCount':2}
        with patch.object(ops,'cid',return_value='a'*64),patch.object(ops,'inspect',return_value=good):
            result=ops.core_containers();self.assertEqual(5,len(result));self.assertTrue(all(v['restartCount']==2 for v in result.values()))
        for state in (dict(good['State'],Running=False),dict(good['State'],OOMKilled=True),dict(good['State'],Health={'Status':'unhealthy'})):
            with patch.object(ops,'cid',return_value='a'*64),patch.object(ops,'inspect',return_value=dict(good,State=state)),self.assertRaises(RuntimeError):ops.core_containers()


class FileArchiveTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix='iq933-offline-');self.root=pathlib.Path(self.temp.name)
        self.uploads=self.root/'uploads';self.uploads.mkdir();(self.uploads/'photo.jpg').write_bytes(b'actual-image-fixture')
        (self.uploads/'nested').mkdir();(self.uploads/'nested/detail.txt').write_bytes(b'original attachment')
        self.legacy=self.root/'legacy';self.legacy.mkdir();(self.legacy/'data.db').write_bytes(b'offline synthetic legacy db')
    def tearDown(self):self.temp.cleanup()

    def test_real_upload_and_legacy_archives_validate_and_bytes_change_detected(self):
        with patch.object(ops,'UPLOAD_ROOT',self.uploads):
            before=ops.upload_inventory(self.root/'uploads.tar');ops.validate_upload_archive(self.root/'uploads.tar',before)
            self.assertEqual(2,before['files']);self.assertEqual(0, (self.root/'uploads.tar').stat().st_mode&0o077)
            (self.uploads/'photo.jpg').write_bytes(b'changed-image-fixture');self.assertNotEqual(before,ops.upload_inventory())
        legacy=ops.upload_inventory(self.root/'legacy.tar',self.legacy);ops.validate_upload_archive(self.root/'legacy.tar',legacy)
        self.assertEqual(1,legacy['files'])

    def test_symlink_file_or_directory_and_fifo_are_refused_without_blocking(self):
        for name,make in (('link',lambda p:p.symlink_to(self.legacy/'data.db')),
                          ('dir',lambda p:p.symlink_to(self.legacy,target_is_directory=True)),('fifo',lambda p:os.mkfifo(p))):
            p=self.uploads/name;make(p)
            try:
                with self.subTest(kind=name),self.assertRaises(RuntimeError):ops.upload_inventory(tree=self.uploads)
            finally:p.unlink()

    def test_file_count_and_file_size_limits_are_enforced(self):
        for key,val in (('MAX_UPLOAD_FILES',1),('MAX_UPLOAD_FILE_BYTES',1),('MAX_UPLOAD_BYTES',1)):
            with patch.object(ops,key,val),self.assertRaises(RuntimeError):ops.upload_inventory(tree=self.uploads)

    def test_archive_manifest_mismatch_is_rejected(self):
        expected=ops.upload_inventory(self.root/'archive.tar',self.uploads);expected['files']+=1
        with self.assertRaises(RuntimeError):ops.validate_upload_archive(self.root/'archive.tar',expected)


class SourcePinTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix='iq933-source-');self.root=pathlib.Path(self.temp.name)
        self.path=ops.APP_PREFIX+'backend/services/fixture.js';self.file=self.root/self.path;self.file.parent.mkdir(parents=True)
        self.git('init','-q');self.git('config','user.email','offline@example.invalid');self.git('config','user.name','Offline Test')
        self.file.write_bytes(b'original');self.git('add',self.path);self.git('commit','-qm','before');self.before=self.git('rev-parse','HEAD').decode().strip()
        self.file.write_bytes(b'reviewed');self.git('add',self.path);self.git('commit','-qm','target');self.target=self.git('rev-parse','HEAD').decode().strip()
        self.manifest={'reviewedHead':'f'*40,'files':{self.path:hashlib.sha256(b'reviewed').hexdigest()}}
    def tearDown(self):self.temp.cleanup()
    def git(self,*args):return subprocess.check_output(['git',*args],cwd=self.root,stderr=subprocess.DEVNULL)
    def check(self,manifest=None):
        with patch.object(ops,'ROOT',self.root),patch.object(ops,'PRE_DEPLOY_COMMIT',self.before),patch.object(ops,'TESTED_SOURCE',manifest or self.manifest):return ops.tested_source_guard(self.target)

    def test_real_git_blob_and_checkout_exactly_match_tested_head(self):
        result=self.check();self.assertTrue(result['allChangedPathsPinned']);self.assertEqual(1,result['testedFiles'])
    def test_empty_or_missing_manifest_fails_closed(self):
        for manifest in ({'reviewedHead':None,'files':{}},{'reviewedHead':'f'*40,'files':{}},{'reviewedHead':'wrong','files':self.manifest['files']}):
            with self.assertRaises(RuntimeError):self.check(manifest)
    def test_wrong_source_hash_and_actual_checkout_drift_are_refused(self):
        bad=copy.deepcopy(self.manifest);bad['files'][self.path]='0'*64
        with self.assertRaises(RuntimeError):self.check(bad)
        self.file.write_bytes(b'unreviewed disk')
        with self.assertRaises(RuntimeError):self.check()
    def test_extra_manifest_entry_unrelated_app_data_and_path_traversal_are_refused(self):
        for path in ('unrelated/fixture.js',ops.APP_PREFIX+'backend/data/business.db',ops.APP_PREFIX+'../secret',ops.APP_PREFIX+'frontend/line\nname'):
            bad=copy.deepcopy(self.manifest);bad['files'][path]='0'*64
            with self.subTest(path=path),self.assertRaises(RuntimeError):self.check(bad)
    def test_actual_runtime_source_uses_non_quoted_git_inventory_and_container_hashes(self):
        calls=[]
        def execute(args,data=None):
            if args[:3]==['docker','exec','-i']:
                calls.append(args);self.assertEqual(['backend/services/fixture.js'],json.loads(data));return json.dumps({'backend/services/fixture.js':hashlib.sha256(self.file.read_bytes()).hexdigest()}).encode()
            return subprocess.check_output(args,cwd=self.root,stderr=subprocess.DEVNULL)
        with patch.object(ops,'ROOT',self.root),patch.object(ops,'run',side_effect=execute):proof=ops.source_runtime_files('a'*64,self.target)
        self.assertTrue(proof['allActualRuntimeFilesMatchSource']);self.assertEqual(1,len(calls))


class ReadOnlyHttpTests(unittest.TestCase):
    def test_mutating_get_quote_detail_and_arbitrary_path_are_never_requested(self):
        for path in ('/api/quotes/1','/api/quotes/1/audit-log','/api/unknown'):
            with patch.object(ops,'get') as getter,self.assertRaises(RuntimeError):ops.get_json('http://172.22.0.2:3211',path,'synthetic-cookie')
            getter.assert_not_called()

    def test_nonauthorized_urls_and_remote_hosts_are_refused(self):
        for url in ('https://evil.example/','http://evil.example/','http://127.0.0.1.evil.example/'):
            with self.assertRaises(RuntimeError):ops.get(url,'synthetic-cookie')



class SummaryFeatureTests(unittest.TestCase):
    def setUp(self):
        self.columns = [dict(code=key,name=key,format='percent',header_style={'fill':'FFFF00','color':'000000','owner':'','owner_fill':'FFFF00'},share_amounts=[amount]) for key,amount in {
            'total_profit_before_tax_rate':'total_profit_before_tax',
            'total_gross_after_tax_rate':'total_gross_after_tax',
            'total_profit_after_tax_rate':'total_profit_after_tax'}.items()]
        self.values={'production_amount':decimal.Decimal('30')}
        for column in self.columns:
            self.values[column['share_amounts'][0]]=decimal.Decimal('7')
            self.values[column['code']]=decimal.Decimal('0.23333333333333334')
        self.summary={'summary_columns':copy.deepcopy(self.columns),'rows':[{'summary_values':self.values}]}
        self.pin={'expectedSummaryColumns':self.columns}
    def check(self,summary=None,pin=None):
        with patch.object(ops,'TESTED_SOURCE',self.pin if pin is None else pin):
            return ops.summary_features(self.summary if summary is None else summary)
    def test_all_columns_exact_and_all_three_rates_accept_only_float_roundoff(self):
        proof=self.check()
        self.assertTrue(proof['summaryHeaderStylesVerified']);self.assertTrue(proof['summaryProfitRatesVerified'])
        self.assertEqual(1,proof['summaryRowsVerified']);self.assertEqual(0,proof['summaryZeroProductionRowsVerified'])
    def test_zero_production_requires_each_total_rate_zero(self):
        self.values['production_amount']=0
        for column in self.columns:self.values[column['code']]=0
        self.assertEqual(1,self.check()['summaryZeroProductionRowsVerified'])
        self.values[self.columns[-1]['code']]=decimal.Decimal('0.2')
        with self.assertRaises(RuntimeError):self.check()
        self.assertEqual('summaryThreeProfitRateFormulas',ops.FAILED_CHECK)
    def test_wrong_color_missing_column_and_extra_column_are_rejected(self):
        for modify in (lambda s:s['summary_columns'][0]['header_style'].update(color='FF0000'),
                       lambda s:s['summary_columns'].pop(),
                       lambda s:s['summary_columns'].append(dict(code='unreviewed'))):
            bad=copy.deepcopy(self.summary);modify(bad)
            with self.assertRaises(RuntimeError):self.check(bad)
    def test_wrong_amount_mapping_and_any_wrong_row_rate_are_rejected(self):
        bad=copy.deepcopy(self.columns);bad[0]['share_amounts']=['wrong_amount']
        with self.assertRaises(RuntimeError):self.check(dict(self.summary,summary_columns=bad),dict(expectedSummaryColumns=bad))
        for column in self.columns:
            bad=copy.deepcopy(self.summary);bad['rows'][0]['summary_values'][column['code']]=decimal.Decimal('0.25')
            with self.subTest(rate=column['code']),self.assertRaises(RuntimeError):self.check(bad)
    def test_missing_pin_missing_value_nonfinite_and_boolean_are_rejected(self):
        with self.assertRaises(RuntimeError):self.check(pin={})
        for value in (None,True,decimal.Decimal('NaN'),decimal.Decimal('Infinity')):
            bad=copy.deepcopy(self.summary);bad['rows'][0]['summary_values']['production_amount']=value
            with self.subTest(value=str(value)),self.assertRaises(RuntimeError):self.check(bad)


class WorkflowInputTests(unittest.TestCase):
    def setUp(self):
        self.workflow=(MODULE.parents[2]/'.github/workflows/indo-diag.yml').read_text()
        block=self.workflow.split('        run: |\n',1)[1].split('\n      - name:',1)[0]
        self.script='\n'.join(line[10:] if line.startswith('          ') else line for line in block.splitlines())
        self.environment=dict(os.environ,CLOUD_HOST_FINGERPRINT='SHA256:'+'a'*43,
                              IQ_OPS_BRANCH='refs/heads/ops/internal-quote-933-20261016',
                              IQ_OPS_REF='a'*40,IQ_OPS_MODE='backup',
                              IQ_OPS_BEFORE=ops.PRE_DEPLOY_COMMIT,IQ_OPS_TARGET=ops.PRE_DEPLOY_COMMIT,IQ_OPS_BACKUP='')
    def run_block(self,**values):
        return subprocess.run(['bash','-c',self.script],env=dict(self.environment,**values),stdout=subprocess.PIPE,stderr=subprocess.PIPE).returncode
    def test_exact_backup_and_verify_inputs_are_accepted(self):
        self.assertEqual(0,self.run_block())
        self.assertEqual(0,self.run_block(IQ_OPS_MODE='verify',IQ_OPS_TARGET='b'*40,
                         IQ_OPS_BACKUP='/opt/rr-portal/deploy/backups/internal-quote-pre-933-20261016T010203123456Z'))
    def test_wrong_branch_before_fingerprint_mode_sha_and_backup_path_are_rejected(self):
        for values in ({'IQ_OPS_BRANCH':'refs/heads/main'},{'IQ_OPS_BEFORE':'c'*40},
                       {'CLOUD_HOST_FINGERPRINT':''},{'IQ_OPS_MODE':'deploy'},
                       {'IQ_OPS_REF':'$(echo unsafe)'},{'IQ_OPS_TARGET':'c'*40},
                       {'IQ_OPS_BACKUP':'/tmp/not-allowed'}):
            with self.subTest(values=values):self.assertNotEqual(0,self.run_block(**values))
    def test_verify_cannot_reuse_before_or_other_pr_backup(self):
        for values in ({'IQ_OPS_TARGET':ops.PRE_DEPLOY_COMMIT,'IQ_OPS_BACKUP':'/opt/rr-portal/deploy/backups/internal-quote-pre-933-20261016T010203123456Z'},
                       {'IQ_OPS_TARGET':'b'*40,'IQ_OPS_BACKUP':'/opt/rr-portal/deploy/backups/internal-quote-pre-931-20261016T010203123456Z'}):
            self.assertNotEqual(0,self.run_block(IQ_OPS_MODE='verify',**values))
    def test_execution_is_serialized_pinned_and_never_deploys(self):
        self.assertIn('group: deploy-cloud',self.workflow);self.assertIn('cancel-in-progress: false',self.workflow)
        self.assertIn('fingerprint: ${{ env.CLOUD_HOST_FINGERPRINT }}',self.workflow)
        self.assertIn('appleboy/ssh-action@0ff4204d59e8e51228ff73bce53f80d53301dee2',self.workflow)
        self.assertIn('git show "$IQ_OPS_REF:deploy/ops/internal-quote-933.py"',self.workflow)
        for prohibited in ('docker compose up','git pull','git checkout','git reset','curl ','rm -rf /opt'):
            self.assertNotIn(prohibited,self.workflow)


class StrictVerificationResultTests(unittest.TestCase):
    """Exercise full result/exit decision with synthetic protected production state."""
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix='iq933-verify-');self.directory=pathlib.Path(self.temp.name)
        self.environment=self.directory/'env.before';self.environment.write_bytes(b'synthetic-private-environment')
        self.runtime={'protectedEnvSha256':'env','processProtectedEnvSha256':'process','mounts':[],
                      'imageId':'after','configEnvSha256':'complete','publicVersionMetadata':{}}
        self.current={'tables':{table:{'rows':1,'sha256':'unchanged'} for table in ops.REQUIRED_TABLES},
                      'userIdentitySha256':'identity','startupChecks':{}}
        self.api={'quoteListDigest':'quotes','customerListDigest':'customers','identityDigest':'identity',
                  'adminReadsVerified':True,'quotes':1,'users':1,'existingStaffIsolationVerified':True,
                  'summaryShareMetadataVerified':True,'summaryHeaderStylesVerified':True,
                  'summaryProfitRateMetadataVerified':True,'summaryProfitRatesVerified':True,
                  'summaryRowsVerified':1,'summaryZeroProductionRowsVerified':0}
        self.uploads={'files':2,'bytes':20,'sha256':'uploads'}
        self.before=copy.deepcopy(self.current)
        self.before.update(runtime=dict(self.runtime,imageId='before'),actualNginx={'config':'same'},
                           coreContainers={'five':'same'},configurationFiles={'startup':'same'},
                           uploads=self.uploads,legacy={'files':0},sourceCommit=ops.PRE_DEPLOY_COMMIT,
                           api={key:self.api[key] for key in ('quoteListDigest','customerListDigest','identityDigest','adminReadsVerified','quotes','users','existingStaffIsolationVerified')})
    def tearDown(self):self.temp.cleanup()
    def verify(self,final=None,uploads=None):
        stack=[]
        from contextlib import ExitStack
        with ExitStack() as context:
            for name,value in {'TARGET_COMMIT':'e'*40}.items():context.enter_context(patch.object(ops,name,value))
            for name,value in {'latest_backup':(self.directory,self.before),'source_commit':'e'*40,
                               'tested_source_guard':{'allChangedPathsPinned':True},'run':b'',
                               'app_context':('a'*64,'http://172.22.0.2:3211'),'runtime_config':self.runtime,
                               'nginx_protected':{'config':'same'},'core_containers':{'five':'same'},
                               'configuration_files':{'startup':'same'},'private_env_file':self.environment,
                               'api_audit':self.api,'runtime_and_frontend_files':{'allActualRuntimeFilesMatchSource':True}}.items():
                context.enter_context(patch.object(ops,name,return_value=value))
            context.enter_context(patch.object(ops,'audit',side_effect=[self.current,self.current if final is None else final]))
            context.enter_context(patch.object(ops,'upload_inventory',side_effect=[self.uploads if uploads is None else uploads,{'files':0}]))
            context.enter_context(patch.object(ops,'get',side_effect=[(200,b'{"status":"ok"}'),(200,b''),(401,b''),(401,b''),(401,b'')]))
            return ops.verify()
    def test_all_protected_fields_identical_produces_true(self):
        result=self.verify();self.assertTrue(result['verified']);self.assertTrue(result['deploymentChecksPassed'])
    def test_audit_or_business_table_delta_remains_false_without_exemption(self):
        for table in ('audit_log','quotes'):
            original=copy.deepcopy(self.current)
            self.current['tables'][table]['sha256']='changed'
            result=self.verify();self.assertFalse(result['verified']);self.assertTrue(result['deploymentChecksPassed'])
            self.assertEqual([table],result['changedTables']);self.assertEqual('businessFullRowHashesPreserved',result['failedCheck'])
            self.current=original
    def test_upload_change_and_probe_window_change_remain_false(self):
        result=self.verify(uploads=dict(self.uploads,sha256='changed'));self.assertFalse(result['verified'])
        self.assertEqual('uploadContentPreserved',result['failedCheck'])
        final=copy.deepcopy(self.current);final['tables']['quotes']['sha256']='changed-during-probe'
        result=self.verify(final);self.assertFalse(result['verified']);self.assertFalse(result['readOnlyProbeWindowDatabaseStable'])
        self.assertEqual('readOnlyProbeWindowDatabaseStable',result['failedCheck'])
    def test_user_permission_delta_cannot_have_deployment_checks_pass(self):
        self.current['tables']['user_perms']['sha256']='changed'
        result=self.verify();self.assertFalse(result['verified']);self.assertFalse(result['deploymentChecksPassed'])
        self.assertFalse(result['usersAndPermissionsPreserved'])


if __name__=='__main__':unittest.main()
