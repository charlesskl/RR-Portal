import contextlib
import importlib.util
import io
import json
import pathlib
import unittest
from unittest.mock import patch

SOURCE=pathlib.Path(__file__).resolve().parents[1]/'printlink-current-diagnosis.py'
spec=importlib.util.spec_from_file_location('printlink_diagnosis',SOURCE)
mod=importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)


class PrintLinkDiagnosisTests(unittest.TestCase):
    def test_inspect_drops_all_secret_config_and_raw_log_output(self):
        item={'Id':'a'*64,'Image':'sha256:'+'b'*64,'RestartCount':0,
              'Config':{'Env':['SECRET=do-not-print']},
              'State':{'Status':'running','StartedAt':'2026-10-19T00:00:00Z',
                       'FinishedAt':'','OOMKilled':False,'ExitCode':0,
                       'Health':{'Status':'healthy','Log':[{'Start':'a','End':'b',
                       'ExitCode':0,'Output':'secret authorization token'}]}},
              'NetworkSettings':{'Ports':{'3100/tcp':[{'HostIp':'0.0.0.0','HostPort':'3100'}]}}}
        with patch.object(mod,'run',return_value=json.dumps([item]).encode()):
            result=mod.inspect('printlink')
        encoded=json.dumps(result)
        self.assertNotIn('do-not-print',encoded)
        self.assertNotIn('authorization',encoded)
        self.assertEqual(result['healthChecks'],[{'start':'a','end':'b','exitCode':0}])

    def test_head_change_stops_before_reading_runtime_or_executing_commands(self):
        out=io.StringIO()
        with patch.object(mod,'run',return_value=b'0'*40+b'\n') as runner,contextlib.redirect_stdout(out):
            self.assertEqual(mod.main(),1)
        result=json.loads(out.getvalue())
        self.assertFalse(result['completed'])
        self.assertEqual(result['failureCode'],'PRODUCTION_HEAD_CHANGED')
        self.assertEqual(runner.call_count,1)

    def test_unexpected_exception_text_never_reaches_stdout(self):
        out=io.StringIO()
        with patch.object(mod,'run',side_effect=RuntimeError('password=secret-value')),contextlib.redirect_stdout(out):
            self.assertEqual(mod.main(),1)
        self.assertNotIn('secret-value',out.getvalue())
        self.assertEqual(json.loads(out.getvalue())['failureCode'],'RuntimeError')

    def test_sqlite_and_postgres_transactions_are_read_only(self):
        self.assertIn('{readOnly:true}',mod.PRINTLINK_JS)
        self.assertIn('PRAGMA query_only=ON;BEGIN',mod.PRINTLINK_JS)
        self.assertIn('SET TRANSACTION READ ONLY',mod.CORE_PY)
        for code in [mod.PRINTLINK_JS,mod.CORE_PY]:
            self.assertNotIn('INSERT INTO',code)
            self.assertNotIn('UPDATE ',code)
            self.assertNotIn('DELETE ',code)
            self.assertNotIn('writeFile',code)

    def test_helper_has_no_logs_restart_or_compose_mutation(self):
        source=SOURCE.read_text()
        for command in ['docker logs','docker restart','docker compose','os.kill','unlink(']:
            self.assertNotIn(command,source)


if __name__=='__main__':
    unittest.main()
