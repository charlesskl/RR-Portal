"""Synthetic read-only diagnosis tests. No live requests or database restores."""
import copy
import importlib.util
import json
import pathlib
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

MODULE = pathlib.Path(__file__).resolve().parents[1] / 'internal-quote-929-audit.py'
spec = importlib.util.spec_from_file_location('internal_quote_929_audit', MODULE)
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)


def copy_data(ids=(3,7), columns='id, quote_id, dept, actor, action, detail, at'):
    rows = [str(value).encode()+b'\t19\tsales\tprivate actor\tview\tprivate \\t text \\n escaped\t2026-10-16 00:24:00+00' for value in ids]
    return b'-- pg_restore SQL output; never executed\nCOPY internal_quote.audit_log ('+columns.encode()+b') FROM stdin;\n'+b'\n'.join(rows)+b'\n\\.\n-- end\n'


class CopyParserTests(unittest.TestCase):
    def test_extracts_only_exact_integer_ids_with_escaped_business_fields(self):
        self.assertEqual([3,7],audit.parse_audit_copy_ids(copy_data()))
        self.assertEqual([3,7],audit.parse_audit_copy_ids(copy_data((7,3))))
        quoted=copy_data().replace(b'COPY internal_quote.audit_log',b'COPY "internal_quote"."audit_log"').replace(b'(id,',b'("id",')
        self.assertEqual([3,7],audit.parse_audit_copy_ids(quoted))
    def test_id_column_is_located_by_header_not_assumed_first(self):
        data=b'COPY internal_quote.audit_log (quote_id, id, dept, actor, action, detail, at) FROM stdin;\n19\t7\tsales\tprivate\tview\tprivate\t2026-10-16\n\\.\n'
        self.assertEqual([7],audit.parse_audit_copy_ids(data))
    def test_copy_block_must_be_single_complete_and_expected_schema_table(self):
        source=copy_data()
        cases=[b'',source.replace(b'\\.\n',b''),source+source,
               source.replace(b'internal_quote.audit_log',b'other.audit_log'),
               source.replace(b'internal_quote.audit_log',b'internal_quote.users'),
               source.replace(b'COPY internal_quote',b'COPY public.internal_quote')]
        for value in cases:
            with self.subTest(value=value[:80]),self.assertRaises(RuntimeError):audit.parse_audit_copy_ids(value)
    def test_missing_extra_duplicate_and_malformed_columns_are_rejected(self):
        for columns in ('id, quote_id, dept, actor, action, detail',
                        'id, quote_id, dept, actor, action, detail, at, extra',
                        'id, quote_id, dept, actor, action, detail, id',
                        'id, quote_id, dept, actor, action, detail, ""at'):
            with self.subTest(columns=columns),self.assertRaises(RuntimeError):audit.parse_audit_copy_ids(copy_data(columns=columns))
    def test_duplicate_noninteger_null_negative_zero_overflow_and_escaped_ids_rejected(self):
        for ids in ((3,3),('\\N',),('0',),('-1',),('+1',),('1e3',),('2147483648',),('99999999999',),('\\x31',)):
            with self.subTest(ids=ids),self.assertRaises(RuntimeError):audit.parse_audit_copy_ids(copy_data(ids))
    def test_missing_and_extra_fields_or_raw_newlines_are_rejected(self):
        for data in (copy_data().replace(b'\t19\t',b'\t'),copy_data().replace(b'\tsales\t',b'\textra\tsales\t'),copy_data().replace(b'private actor',b'private\nactor')):
            with self.assertRaises(RuntimeError):audit.parse_audit_copy_ids(data)
    def test_restore_output_is_bounded(self):
        with patch.object(audit,'MAX_RESTORE_BYTES',3),self.assertRaises(RuntimeError):audit.parse_audit_copy_ids(copy_data())
    def test_dump_reader_never_passes_a_database_or_executes_dump_sql(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=pathlib.Path(temporary);(root/'internal_quote.dump').write_bytes(b'synthetic archive')
            with patch.object(audit.ops,'cid',return_value='a'*64),patch.object(audit,'bounded_command',return_value=copy_data()) as command:
                ids=audit.baseline_audit_ids(root,{'tables':{'audit_log':{'rows':2}}})
                self.assertEqual([3,7],ids)
                args=command.call_args.args[0]
                self.assertIn('--schema=internal_quote',args);self.assertIn('--table=audit_log',args)
                self.assertFalse(any(value.startswith(('--dbname','-d','--file','-f')) for value in args[5:]))
            with patch.object(audit.ops,'cid',return_value='a'*64),patch.object(audit,'bounded_command',return_value=copy_data()),self.assertRaises(RuntimeError):
                audit.baseline_audit_ids(root,{'tables':{'audit_log':{'rows':3}}})


class SqlTests(unittest.TestCase):
    def test_subset_hash_uses_all_postgres_row_fields_and_sorted_multiset(self):
        sql=audit.audit_details_sql([7,3])
        self.assertIn('id=ANY(ARRAY[3,7]::integer[])',sql)
        self.assertIn("to_jsonb(r)::text,'UTF8'",sql)
        self.assertIn("string_agg(row_hash,'' ORDER BY row_hash)",sql)
        self.assertIn('WHERE NOT (id=ANY(',sql)
        self.assertNotRegex(sql,r'\b(?:INSERT|UPDATE|DELETE|TRUNCATE|CREATE|DROP|COPY)\b')
        self.assertNotIn("to_jsonb(r)-",sql)
    def test_unsafe_missing_duplicate_and_boolean_id_sets_rejected(self):
        for ids in ([],[1,1],[True],[-1],[2147483648],['1);DROP TABLE users']):
            with self.subTest(ids=ids),self.assertRaises(RuntimeError):audit.audit_details_sql(ids)


class BoundedPrivateReadTests(unittest.TestCase):
    def run_private(self,code,limit=1024):
        with tempfile.TemporaryDirectory() as temporary,patch.object(audit.ops,'ROOT',pathlib.Path(temporary)):
            return audit.bounded_command([sys.executable,'-c',code],limit=limit)
    def test_stdout_captured_and_stderr_drained_without_revealing_it(self):
        value=self.run_private("import sys;sys.stderr.write('synthetic-private-error');sys.stdout.write('safe fixture')")
        self.assertEqual(b'safe fixture',value)
    def test_output_limits_and_failed_commands_are_rejected(self):
        for code,limit in (("print('x'*100)",10),("import sys;sys.stderr.write('private');sys.exit(1)",1024)):
            with self.assertRaises(RuntimeError):self.run_private(code,limit)


class NginxCorrelationTests(unittest.TestCase):
    def line(self,quote=19,at='2026-10-16T00:24:00.700000000Z',method='GET',status=200,path=None):
        path=path or f'/internal-quote/api/quotes/{quote}'
        return f'{at} 192.0.2.1 - - [16/Oct/2026:08:24:00 +0800] "{method} {path} HTTP/1.1" {status} 300 "private referer" "private user agent" rt=0.200\n'.encode()
    def event(self,quote=19,at='2026-10-16T00:24:00.600000+00:00'):
        return {'quoteId':quote,'at':at,'action':'view'}
    def test_precise_time_route_query_matches_but_never_claims_actor_identity(self):
        requests=audit.nginx_requests(self.line(path='/internal-quote/api/quotes/19?source=normal'))
        evidence=audit.correlate([self.event()],requests)
        self.assertTrue(evidence['allEventsHaveDistinctSuccessfulGetRouteAndTimeMatches'])
        self.assertFalse(evidence['identityAttributionProven'])
        for private in ('192.0.2.1','private referer','private user agent','quoteId','/quotes/19'):
            self.assertNotIn(private,json.dumps(evidence))
    def test_other_routes_methods_statuses_ids_and_times_cannot_match(self):
        cases=[self.line(method='POST'),self.line(status=401),self.line(path='/internal-quote/api/quotes/19/audit-log'),
               self.line(path='/internal-quote/api/verifications/19'),self.line(quote=20),self.line(at='2026-10-16T00:25:00Z')]
        for data in cases:
            with self.subTest(data=data):
                self.assertEqual(0,audit.correlate([self.event()],audit.nginx_requests(data))['matchingViewEvents'])
    def test_one_http_request_cannot_explain_duplicate_audit_events(self):
        evidence=audit.correlate([self.event(),self.event()],audit.nginx_requests(self.line()))
        self.assertEqual(1,evidence['matchingViewEvents'])
        self.assertFalse(evidence['allEventsHaveDistinctSuccessfulGetRouteAndTimeMatches'])
    def test_two_distinct_requests_can_explain_two_events_without_exposing_rows(self):
        requests=audit.nginx_requests(self.line()+self.line(quote=20))
        evidence=audit.correlate([self.event(),self.event(quote=20)],requests)
        self.assertEqual(2,evidence['matchingViewEvents'])
    def test_missing_logs_or_empty_events_are_not_fabricated_matches(self):
        self.assertEqual(0,audit.correlate([self.event()],[])['matchingViewEvents'])
        self.assertFalse(audit.correlate([],[])['allEventsHaveDistinctSuccessfulGetRouteAndTimeMatches'])


class DiagnosisOutputTests(unittest.TestCase):
    def fixture(self):
        tables={name:{'rows':1,'sha256':name} for name in audit.ops.REQUIRED_TABLES}
        tables['audit_log']={'rows':2930,'sha256':'original-audit-full-row-hash'}
        before={'tables':tables}
        live=copy.deepcopy(before);live['tables']['audit_log']={'rows':2934,'sha256':'current-full-row-hash'}
        strict={'verified':False,'failedCheck':'businessFullRowHashesPreserved','deploymentChecksPassed':True,
                'uploadsUnchanged':True,'readOnlyProbeWindowDatabaseStable':True,
                'tableCounts':{name:row['rows'] for name,row in live['tables'].items()}}
        details={'originalRows':2930,'originalFullRowSha256':'original-audit-full-row-hash','addedRows':4,
                 'newActionCounts':{'view':4},'newActorHashes':[{'sha256':'a'*64,'events':4,'matchesExistingUser':True}],
                 'onlyViewEvents':True,'allActorsMatchExistingUsers':True,
                 'privateEvents':[{'quoteId':500+i,'at':f'2026-10-16T00:24:0{i}+00:00','action':'view'} for i in range(4)]}
        return before,live,strict,details
    def check(self,mutate=None):
        before,live,strict,details=self.fixture()
        if mutate:mutate(before,live,strict,details)
        with patch.object(audit.ops,'latest_backup',return_value=(pathlib.Path('/private'),before)),patch.object(audit,'baseline_audit_ids',return_value=list(range(2930))),patch.object(audit.ops,'verify',return_value=strict),patch.object(audit,'audit_snapshot',return_value=(live,details)),patch.object(audit.ops,'audit',return_value=live),patch.object(audit.ops,'cid',return_value='a'*64),patch.object(audit,'bounded_command',return_value=b''):
            return audit.diagnose()
    def test_keeps_strict_failure_and_discloses_only_aggregates(self):
        result=self.check()
        self.assertTrue(result['diagnosisInvariantsPassed']);self.assertFalse(result['strictVerification']['verified'])
        self.assertTrue(result['originalStrictVerificationRemainsFailed'])
        self.assertTrue(result['onlyAuditLogAdditionsObserved']);self.assertTrue(result['allNewEventsPrecedeMerge'])
        self.assertFalse(result['consistentWithExistingAuthenticatedQuoteViewRoute'])
        self.assertFalse(result['readActivityExplained'])
        for private in ('quoteId','privateEvents','"500"','originalFullRowSha256'):
            self.assertNotIn(private,json.dumps(result))
    def test_old_row_mutation_missing_rows_or_other_table_change_fails_diagnosis(self):
        for mutation in (lambda b,l,s,d:d.update(originalFullRowSha256='changed'),
                         lambda b,l,s,d:d.update(originalRows=2929),
                         lambda b,l,s,d:l['tables']['quotes'].update(sha256='changed')):
            result=self.check(mutation);self.assertFalse(result['diagnosisInvariantsPassed'])
    def test_more_than_four_additions_are_reported_without_changing_initial_observation(self):
        def extra(b,l,s,d):
            d['privateEvents'].append({'quoteId':999,'at':'2026-10-16T00:35:00+00:00','action':'view'})
            d['addedRows']=5;d['newActionCounts']={'view':5}
            l['tables']['audit_log']['rows']=2935;s['tableCounts']['audit_log']=2935
        result=self.check(extra)
        self.assertEqual(5,result['newAuditRows']);self.assertEqual(4,result['initialStrictNewAuditRows'])
        self.assertFalse(result['newAuditRowsEqualInitialStrictObservation'])
        self.assertFalse(result['allNewEventsPrecedeMerge'])
    def test_non_view_events_are_not_labeled_as_normal_quote_browsing(self):
        result=self.check(lambda b,l,s,d:d.update(onlyViewEvents=False,newActionCounts={'view':3,'edit':1}))
        self.assertFalse(result['allNewEventsAreViews'])
        self.assertFalse(result['consistentWithExistingAuthenticatedQuoteViewRoute'])
    def test_read_activity_explained_requires_integrity_views_actors_and_distinct_http_matches(self):
        matches={'allEventsHaveDistinctSuccessfulGetRouteAndTimeMatches':True,'identityAttributionProven':False}
        with patch.object(audit,'correlate',return_value=matches):
            result=self.check();self.assertTrue(result['readActivityExplained'])
            for mutation in (lambda b,l,s,d:d.update(originalRows=2929),
                             lambda b,l,s,d:d.update(onlyViewEvents=False),
                             lambda b,l,s,d:d.update(allActorsMatchExistingUsers=False)):
                self.assertFalse(self.check(mutation)['readActivityExplained'])


class FixedWorkflowTests(unittest.TestCase):
    def test_original_strict_helper_and_pin_are_identical_to_failed_verify_run(self):
        root=MODULE.parents[2]
        for name in ('internal-quote-929.py','internal-quote-929-source.json'):
            relative='deploy/ops/'+name
            frozen=subprocess.check_output(['git','show','74716f5bf245e306a7ea02100e1202ba12f26545:'+relative],cwd=root)
            self.assertEqual(frozen,(root/relative).read_bytes())
        self.assertEqual(audit.SOURCE_PIN_SHA256,audit.ops.file_hash(MODULE.with_name('internal-quote-929-source.json')))
    def test_diagnosis_has_exact_target_and_backup_guards_in_both_execution_locations(self):
        workflow=(MODULE.parents[2]/'.github/workflows/indo-diag.yml').read_text()
        guard=f'[[ "$IQ_OPS_TARGET" = {audit.TARGET} && "$IQ_OPS_BACKUP" = {audit.BACKUP} ]] || exit 1'
        self.assertEqual(2,workflow.count(guard))
        self.assertIn('group: deploy-cloud',workflow)
        self.assertIn('fingerprint: ${{ env.CLOUD_HOST_FINGERPRINT }}',workflow)
        self.assertIn('appleboy/ssh-action@0ff4204d59e8e51228ff73bce53f80d53301dee2',workflow)
    def test_main_rejects_unapproved_mode_target_backup_or_before(self):
        good=['audit.py','diagnose-audit',audit.BEFORE,audit.TARGET,audit.BACKUP,'source.json']
        for index in (1,2,3,4):
            args=good[:];args[index]='unapproved'
            with patch.object(sys,'argv',args),patch.object(audit,'diagnose') as diagnose,self.assertRaises(RuntimeError):audit.main()
            diagnose.assert_not_called()


if __name__=='__main__':unittest.main()
