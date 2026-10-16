"""Offline fixed diagnostic safety tests; synthetic rows/files, no live requests."""
import copy
import importlib.util
import io
import json
import os
import pathlib
import subprocess
import sys
import tarfile
import tempfile
import unittest
from unittest.mock import patch

MODULE=pathlib.Path(__file__).resolve().parents[1]/'internal-quote-934-diagnose.py'
spec=importlib.util.spec_from_file_location('diag934',MODULE)
diag=importlib.util.module_from_spec(spec);spec.loader.exec_module(diag)


def copy_data(table,ids=(3,7),columns=None):
    columns=columns or sorted(diag.COPY_COLUMNS[table])
    rows=[]
    for identifier in ids:
        rows.append(b'\t'.join(str(identifier).encode() if column=='id' else b'private \\t \\n \\\\ field' for column in columns))
    return ('COPY internal_quote.'+table+' ('+', '.join(columns)+') FROM stdin;\n').encode()+b'\n'.join(rows)+b'\n\\.\n'


class CopyTests(unittest.TestCase):
    def test_all_three_exact_copy_headers_return_only_ids_with_escaped_private_fields(self):
        for table in diag.COPY_COLUMNS:
            self.assertEqual([3,7],diag.parse_copy_ids(copy_data(table,(7,3)),table))
            raw=copy_data(table).replace(b'COPY internal_quote.'+table.encode(),b'COPY "internal_quote"."'+table.encode()+b'"')
            self.assertEqual([3,7],diag.parse_copy_ids(raw,table))
    def test_id_column_location_is_parsed_and_not_assumed_first(self):
        for table in diag.COPY_COLUMNS:
            columns=sorted(diag.COPY_COLUMNS[table]-{'id'})+['id']
            self.assertEqual([3,7],diag.parse_copy_ids(copy_data(table,columns=columns),table))
    def test_missing_duplicate_extra_wrong_header_incomplete_copy_fail(self):
        raw=copy_data('quotes')
        values=[b'',raw.replace(b'\\.\n',b''),raw+raw,raw.replace(b'internal_quote.quotes',b'public.quotes'),
                raw.replace(b'internal_quote.quotes',b'internal_quote.audit_log'),raw.replace(b'created_at,',b'extra,'),
                raw.replace(b'created_at,',b'id,')]
        for value in values:
            with self.subTest(value=value[:50]),self.assertRaises(RuntimeError):diag.parse_copy_ids(value,'quotes')
    def test_bad_duplicate_null_negative_bool_like_and_overflow_ids_fail(self):
        for ids in ((3,3),('\\N',),('0',),('-1',),('+1',),('True',),('2147483648',),('1e3',),('\\x31',)):
            with self.subTest(ids=ids),self.assertRaises(RuntimeError):diag.parse_copy_ids(copy_data('audit_log',ids),'audit_log')
    def test_missing_extra_fields_and_output_limit_fail(self):
        raw=copy_data('audit_log')
        for value in (raw.replace(b'\tprivate',b'private',1),raw.replace(b'\tprivate',b'\textra\tprivate',1)):
            with self.assertRaises(RuntimeError):diag.parse_copy_ids(value,'audit_log')
        with patch.object(diag,'MAX_RESTORE_BYTES',2),self.assertRaises(RuntimeError):diag.parse_copy_ids(raw,'audit_log')
    def test_pg_restore_is_explicit_stdout_without_database_or_sql_execution(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=pathlib.Path(temporary);(root/'internal_quote.dump').write_bytes(b'private synthetic archive')
            before={'tables':{table:{'rows':2} for table in diag.COPY_COLUMNS}}
            for table in diag.COPY_COLUMNS:
                with patch.object(diag.ops,'cid',return_value='a'*64),patch.object(diag,'bounded_command',return_value=copy_data(table)) as command:
                    self.assertEqual([3,7],diag.baseline_ids(root,before,table))
                args=command.call_args.args[0]
                self.assertEqual(['docker','exec','-i','a'*64,'pg_restore','--data-only','--no-owner','--no-privileges','--schema=internal_quote','--table='+table,'--file=-'],args)
                self.assertFalse(any(value.startswith(('--dbname','-d')) for value in args[5:]))


class SqlTests(unittest.TestCase):
    def test_all_original_rows_use_server_full_row_sorted_multiset_hash_only(self):
        for table in diag.COPY_COLUMNS:
            sql=diag.table_details_sql(table,[7,3],[2,8])
            self.assertIn("to_jsonb(r)::text,'UTF8'",sql);self.assertIn("string_agg(row_hash,'' ORDER BY row_hash)",sql)
            self.assertIn('id=ANY(ARRAY[3,7]::integer[])',sql);self.assertIn('WHERE NOT (id=ANY(',sql)
            self.assertNotRegex(sql,r'\b(?:INSERT|UPDATE|DELETE|TRUNCATE|CREATE|DROP|COPY)\b')
            self.assertNotIn('to_jsonb(r)-',sql);self.assertNotIn("'actor'",sql);self.assertNotIn("'detail'",sql)
    def test_timestamps_are_server_utc_and_exact_premerge_deploy_thresholds(self):
        for table in ('quotes','audit_log'):
            sql=diag.table_details_sql(table,[1],[1]);self.assertIn("AT TIME ZONE 'UTC'",sql)
            self.assertIn(diag.MERGED_AT,sql);self.assertIn(diag.DEPLOY_STARTED_AT,sql)
        sections=diag.table_details_sql('quote_sections',[1],[8,2])
        self.assertIn('parentQuoteCreatedAtEvidence',sections);self.assertIn('NOT (q.id=ANY(ARRAY[2,8]::integer[]))',sections)
        self.assertIn('allAddedSectionsBelongToNewQuotes',sections)
    def test_unsafe_tables_or_ids_are_rejected(self):
        for table,ids in [('users',[1]),('quotes',[True]),('audit_log',[1,1]),('quotes',[-1]),('quotes',['1);DROP TABLE users'])]:
            with self.assertRaises(RuntimeError):diag.table_details_sql(table,ids,[1])
    def test_empty_original_id_set_is_safe_and_not_a_guess_at_sequence(self):
        sql=diag.table_details_sql('quotes',[],[])
        self.assertIn('id=ANY(ARRAY[]::integer[])',sql)
        self.assertNotIn('max(id)',sql.lower())


class PrivateCommandTests(unittest.TestCase):
    def command(self,code,limit=1024):
        with tempfile.TemporaryDirectory() as temporary,patch.object(diag.ops,'ROOT',pathlib.Path(temporary)):
            return diag.bounded_command([sys.executable,'-c',code],limit=limit)
    def test_private_stderr_is_drained_and_never_returned(self):
        self.assertEqual(b'safe',self.command("import sys;sys.stderr.write('private actor');sys.stdout.write('safe')"))
    def test_failed_or_oversized_command_refused(self):
        for code,limit in [("print('x'*200)",10),("import sys;sys.stderr.write('private');sys.exit(1)",1024)]:
            with self.assertRaises(RuntimeError):self.command(code,limit)


class UploadTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.root=pathlib.Path(self.temp.name);self.uploads=self.root/'uploads';self.uploads.mkdir()
        (self.uploads/'private-original.bin').write_bytes(b'original bytes');(self.uploads/'nested').mkdir();(self.uploads/'nested/a.bin').write_bytes(b'nested original')
        with patch.object(diag.ops,'UPLOAD_ROOT',self.uploads):self.before={'uploads':diag.ops.upload_inventory(self.root/'uploads.tar')}
        self.original=diag.original_uploads(self.root,self.before)
    def tearDown(self):self.temp.cleanup()
    def check(self):
        with patch.object(diag.ops,'UPLOAD_ROOT',self.uploads):return diag.upload_snapshot(self.original)
    def test_all_original_archive_members_are_hashed_without_extracting(self):
        result=self.check()['result'];self.assertTrue(result['originalUploadContentsUnchanged']);self.assertEqual(2,result['originalUploadFilesPresent'])
        self.assertEqual(0,result['newUploadFiles']);self.assertNotIn('private-original',json.dumps(result));self.assertNotIn('sha256',json.dumps(result))
    def test_one_new_294_byte_file_keeps_originals_and_exposes_only_aggregate_time_size(self):
        new=self.uploads/'private-new.bin';new.write_bytes(b'x'*294);os.utime(new,ns=(1700000000123456789,1700000000123456789))
        result=self.check()['result'];self.assertTrue(result['originalUploadContentsUnchanged']);self.assertEqual(1,result['newUploadFiles']);self.assertEqual(294,result['newUploadBytes'])
        self.assertEqual('2023-11-14T22:13:20.123456789Z',result['mtimeMinUtc']);self.assertTrue(result['mtimeAllPrecedeMerge'])
        self.assertNotIn('private-new',json.dumps(result));self.assertIn('neither proves',result['timestampEvidenceLimit'])
    def test_original_mutation_or_deletion_is_never_exempted(self):
        path=self.uploads/'private-original.bin';path.write_bytes(b'changed')
        self.assertFalse(self.check()['result']['originalUploadContentsUnchanged']);path.unlink()
        self.assertFalse(self.check()['result']['originalUploadContentsUnchanged']);self.assertEqual(1,self.check()['result']['originalUploadFilesPresent'])
    def test_symlink_directory_file_or_fifo_is_refused(self):
        for name,make in [('link',lambda p:p.symlink_to(self.root/'uploads.tar')),('dir',lambda p:p.symlink_to(self.root,target_is_directory=True)),('fifo',os.mkfifo)]:
            path=self.uploads/name;make(path)
            try:
                with self.assertRaises(RuntimeError):self.check()
            finally:path.unlink()
    def test_archive_manifest_tamper_fails(self):
        changed=copy.deepcopy(self.before);changed['uploads']['sha256']='bad'
        with self.assertRaises(RuntimeError):diag.original_uploads(self.root,changed)
    def test_utc_nanoseconds_are_not_rounded(self):
        self.assertEqual('2023-11-14T22:13:20.123456789Z',diag.utc_ns(1700000000123456789))


class DiagnosisTests(unittest.TestCase):
    def fixture(self):
        before={'tables':{table:{'rows':1,'sha256':table} for table in diag.ops.REQUIRED_TABLES},'userIdentitySha256':'identity'}
        live=copy.deepcopy(before)
        for table in diag.COPY_COLUMNS:live['tables'][table]={'rows':2,'sha256':'added'}
        live['tables']['users']['sha256']='login-statistics'
        details={table:{'originalRows':1,'originalFullRowSha256':table,'addedRows':1} for table in diag.COPY_COLUMNS}
        uploads={'result':{'originalUploadContentsUnchanged':True,'newUploadFiles':1,'newUploadBytes':294},'inventory':{},'times':[]}
        return before,live,details,uploads
    def check(self,mutate=None,unstable=False):
        before,live,details,uploads=self.fixture()
        if mutate:mutate(before,live,details,uploads)
        final=copy.deepcopy(live)
        if unstable:final['tables']['audit_log']['sha256']='changed-during-diagnosis'
        with patch.object(diag.ops,'latest_backup',return_value=(pathlib.Path('/private'),before)),patch.object(diag.ops,'source_commit',return_value=diag.TARGET),patch.object(diag.ops,'tested_source_guard'),patch.object(diag,'baseline_ids',return_value=[1]),patch.object(diag,'original_uploads',return_value={}),patch.object(diag,'database_snapshot',return_value=(live,details)),patch.object(diag,'upload_snapshot',return_value=uploads),patch.object(diag.ops,'audit',return_value=final):
            return diag.diagnose()
    def test_original_strict_false_is_preserved_and_no_private_fields_are_output(self):
        result=self.check();self.assertTrue(result['diagnosisInvariantsPassed']);self.assertTrue(result['originalStrictVerificationRemainsFailed'])
        self.assertFalse(result['strictChecksExempted']);self.assertFalse(result['databaseRestorePerformed']);self.assertFalse(result['actorOrRequestIdentityAttributionProven'])
        self.assertNotIn('originalFullRowSha256',json.dumps(result));self.assertEqual(38894533661,result['originalStrictRunId'])
        self.assertIn('does not prove section creation',result['sectionTimestampEvidenceLimit'])
    def test_original_table_mutation_missing_rows_other_table_or_identity_change_remains_false(self):
        changes=[lambda b,l,d,u:d['quotes'].update(originalFullRowSha256='changed'),lambda b,l,d,u:d['quote_sections'].update(originalRows=0),
                 lambda b,l,d,u:l['tables']['ref_tables'].update(sha256='changed'),lambda b,l,d,u:l.update(userIdentitySha256='changed'),
                 lambda b,l,d,u:u['result'].update(originalUploadContentsUnchanged=False)]
        for change in changes:
            with self.subTest(change=change):self.assertFalse(self.check(change)['diagnosisInvariantsPassed'])
    def test_new_activity_during_diagnostic_is_disclosed_without_retry(self):
        result=self.check(unstable=True);self.assertFalse(result['diagnosticReadWindowStable']);self.assertFalse(result['diagnosisInvariantsPassed'])


class FixedWorkflowTests(unittest.TestCase):
    def test_original_strict_helper_pin_and_tests_are_unchanged_since_failed_run(self):
        root=MODULE.parents[2]
        for relative in ['deploy/ops/internal-quote-934.py','deploy/ops/internal-quote-934-source.json','deploy/ops/tests/test_internal_quote_934.py']:
            self.assertEqual(subprocess.check_output(['git','show','19c84a1dcc856e2bb9a02ecca73243918521d2b0:'+relative],cwd=root),(root/relative).read_bytes())
    def test_exact_branch_backup_target_fingerprint_and_serialization_are_kept(self):
        workflow=(MODULE.parents[2]/'.github/workflows/indo-diag.yml').read_text()
        guard=f'[[ "$IQ_OPS_TARGET" = {diag.TARGET} && "$IQ_OPS_BACKUP" = {diag.BACKUP} ]] || exit 1'
        self.assertEqual(2,workflow.count(guard));self.assertIn('group: deploy-cloud',workflow);self.assertIn('fingerprint: ${{ env.CLOUD_HOST_FINGERPRINT }}',workflow)
        self.assertIn('git show "$IQ_OPS_REF:deploy/ops/internal-quote-934-diagnose.py"',workflow)
        self.assertNotIn('docker compose up',workflow)
    def test_diagnose_mode_validation_is_fixed_and_rejects_other_target_backup(self):
        workflow=(MODULE.parents[2]/'.github/workflows/indo-diag.yml').read_text();block=workflow.split('        run: |\n',1)[1].split('\n      - name:',1)[0]
        script='\n'.join(line[10:] if line.startswith('          ') else line for line in block.splitlines())
        env=dict(os.environ,CLOUD_HOST_FINGERPRINT='SHA256:'+'a'*43,IQ_OPS_BRANCH='refs/heads/ops/internal-quote-934-20261016',IQ_OPS_REF='a'*40,IQ_OPS_MODE='diagnose',IQ_OPS_BEFORE=diag.BEFORE,IQ_OPS_TARGET=diag.TARGET,IQ_OPS_BACKUP=diag.BACKUP)
        self.assertEqual(0,subprocess.run(['bash','-c',script],env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE).returncode)
        for change in [{'IQ_OPS_TARGET':'b'*40},{'IQ_OPS_BACKUP':diag.BACKUP.replace('093057','093058')},{'IQ_OPS_BEFORE':'a'*40},{'IQ_OPS_BRANCH':'refs/heads/main'}]:
            self.assertNotEqual(0,subprocess.run(['bash','-c',script],env=dict(env,**change),stdout=subprocess.PIPE,stderr=subprocess.PIPE).returncode)
    def test_main_rejects_wrong_mode_target_before_or_backup_without_work(self):
        good=['diag.py','diagnose',diag.BEFORE,diag.TARGET,diag.BACKUP,'source.json']
        for index in (1,2,3,4):
            args=good[:];args[index]='unapproved'
            with patch.object(sys,'argv',args),patch.object(diag,'diagnose') as action,self.assertRaises(RuntimeError):diag.main()
            action.assert_not_called()


if __name__=='__main__':unittest.main()
