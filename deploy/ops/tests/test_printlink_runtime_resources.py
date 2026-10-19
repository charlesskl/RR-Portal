import importlib.util
import pathlib
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

SOURCE=pathlib.Path(__file__).resolve().parents[1]/'printlink-runtime-resources.py'
spec=importlib.util.spec_from_file_location('printlink_resources',SOURCE)
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)


class ResourceDiagnosisTests(unittest.TestCase):
    def test_argv_classifies_only_fixed_roles_and_never_returns_argv(self):
        self.assertEqual(m.classify_argv(b'/usr/local/bin/node\0cloud/server.mjs\0'),'cloud-server')
        self.assertEqual(m.classify_argv(b'node\0start.mjs\0--cloud-only\0'),'platform-parent')
        self.assertEqual(m.classify_argv(b'node\0-\0'),'possible-node-stdin-diagnostic-source-unprovable')
        self.assertEqual(m.classify_argv(b'node\0--secret=my-password\0'),'other-node-argv-withheld')
        self.assertEqual(m.classify_argv(b'node\0-e\0some secret string\0'),'other-node-argv-withheld')

    def test_raw_log_secrets_are_never_in_summary(self):
        raw=(b'2026-10-19T06:00:00Z FATAL ERROR password=supersecret\n'
             b'2026-10-19T06:01:00Z JavaScript heap out of memory token=private-token\n')
        result=m.log_summary(raw,False)
        self.assertEqual(result['tokens']['FATAL ERROR'],1)
        self.assertEqual(result['tokens']['JavaScript heap out of memory'],1)
        self.assertNotIn('supersecret',str(result));self.assertNotIn('private-token',str(result))
        self.assertEqual(result['lastTimestamp'],'2026-10-19T06:01:00Z')

    def test_command_hard_output_cap_and_stderr_merge(self):
        m.DEADLINE=time.monotonic()+8
        with tempfile.TemporaryDirectory()as d,patch.object(m,'ROOT',pathlib.Path(d)):
            data,truncated=m.command([sys.executable,'-c',"import sys;sys.stderr.write('a'*10000);sys.stderr.flush()"],cap=100,merge_stderr=True)
        self.assertTrue(truncated);self.assertEqual(data,b'a'*100)

    def test_command_deadline_only_stops_own_cli(self):
        m.DEADLINE=time.monotonic()+8
        with tempfile.TemporaryDirectory()as d,patch.object(m,'ROOT',pathlib.Path(d)):
            with self.assertRaisesRegex(RuntimeError,'READ_ONLY_CLI_TIMEOUT'):
                m.command([sys.executable,'-c','import time;time.sleep(5)'],timeout=.05)

    def test_process_summary_keeps_stdin_diagnostic_identity_uncertain(self):
        row={'pid':1,'ppid':0,'state':'R','utimeTicks':2,'stimeTicks':1,'threads':1,
             'startTimeTicks':10,'rssKiB':1024,'swapKiB':0,'wchan':'0',
             'role':'possible-node-stdin-diagnostic-source-unprovable'}
        result=m.summarize_processes([row],[{**row,'utimeTicks':7}])
        self.assertFalse(result['stdinDiagnosticIdentityProven'])
        self.assertEqual(result['selectedProcesses'][0]['cpuTicksDuringSample'],5)

    def test_thread_identity_reuse_does_not_invent_cpu_delta(self):
        old={1:{'pid':1,'tid':1,'role':'cloud-server','state':'R','cpuTicks':5,'startTimeTicks':2,'wchan':'0'}}
        new={1:{**old[1],'startTimeTicks':3,'cpuTicks':2}}
        self.assertIsNone(m.summarize_threads(old,new)[0]['cpuTicksDuringSample'])

    def test_no_container_exec_restart_print_or_database_mutations(self):
        source=SOURCE.read_text()
        for value in ['docker exec','docker restart','docker compose','INSERT INTO','UPDATE ','DELETE ','/environ']:
            self.assertNotIn(value,source)


if __name__=='__main__':unittest.main()
