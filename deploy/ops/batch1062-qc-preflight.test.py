"""Pure local tests: private temporary files and our own subprocess groups only."""
import contextlib, hashlib, importlib.util, io, json, pathlib, signal, sys, tempfile, unittest
from unittest import mock

PATH = pathlib.Path(__file__).with_name('batch1062-qc-preflight.py')
SPEC = importlib.util.spec_from_file_location('qc1062_profile9_tests', PATH)
M = importlib.util.module_from_spec(SPEC); SPEC.loader.exec_module(M)
SAFE = ['docker','ps','-aq','--no-trunc','--filter','label=com.docker.compose.project=rr-portal','--filter','label=com.docker.compose.service=db']
HUGE = lambda _root: {'available': 1024**4, 'free': 1024**4}

class Profile9Tests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='qc1062-profile9-')
        self.root = pathlib.Path(self.temp.name)
        self.addCleanup(self.temp.cleanup)
    def budget(self, space=HUGE): return M.Budget(self.root, self.root, space=space)
    def child(self, code, **kw): return M.capture([sys.executable,'-c',code],cwd=self.root,**kw)
    def archive(self, record):
        collector=M.Collector();collector.budget=self.budget()
        with mock.patch.object(M,'capture',return_value=record):
            with self.assertRaises(RuntimeError):collector.safe_command(SAFE)
        for kind in ['stdout','stderr']:
            self.assertEqual((self.root/('command-01.'+kind+'.private')).read_bytes(),record[kind])
            self.assertEqual(collector.records[0][kind+'Archive']['sha256'],hashlib.sha256(record[kind]).hexdigest())
        return collector

    def test_stderr_hard_limit_keeps_every_captured_byte_and_kills_only_own_group(self):
        real_kill=M.os.killpg
        with mock.patch.object(M.os,'killpg',wraps=real_kill)as kill:
            record=self.child("import os,time;os.write(2,b'E'*100000);time.sleep(10)",timeout=2,stdout_limit=32768,stderr_limit=32768,combined_limit=32768)
        self.assertTrue(record['captureIncomplete']);self.assertTrue(record['limitReached'])
        self.assertTrue(record['ownProcessGroupTerminated']);self.assertEqual(record['combinedBytes'],32768)
        self.assertEqual(record['stderr'],b'E'*32768)
        self.assertTrue(kill.call_args_list)
        self.assertTrue(all(call.args[0]==record['ownProcessId'] and call.args[1]in(signal.SIGTERM,signal.SIGKILL)for call in kill.call_args_list))
        collector=self.archive(record)
        with mock.patch.object(M,'OUT',self.root),contextlib.redirect_stdout(io.StringIO()):collector.terminal_failure(RuntimeError('capture-limit'))
        failure=json.loads((self.root/'failure.private.json').read_bytes())
        self.assertFalse(failure['success']);self.assertTrue(failure['captureIncomplete'])
        self.assertEqual((self.root/'command-01.stderr.private').read_bytes(),b'E'*32768)

    def test_timeout_retains_both_streams_and_never_reports_complete_capture(self):
        record=self.child("import os,time;os.write(1,b'before-timeout');os.write(2,b'error-before-timeout');time.sleep(10)",timeout=.5)
        self.assertTrue(record['timedOut']);self.assertTrue(record['captureIncomplete']);self.assertTrue(record['ownProcessGroupTerminated'])
        self.assertEqual(record['stdout'],b'before-timeout');self.assertEqual(record['stderr'],b'error-before-timeout')
        self.archive(record)

    def test_nonzero_exit_preserves_complete_binary_stdout_and_stderr(self):
        record=self.child("import os;os.write(1,b'\\x00OUT\\xff');os.write(2,b'ERR\\x00');raise SystemExit(7)")
        self.assertFalse(record['captureIncomplete']);self.assertEqual(record['returnCode'],7)
        self.assertEqual(record['stdout'],b'\x00OUT\xff');self.assertEqual(record['stderr'],b'ERR\x00')
        self.archive(record)

    def test_success_preserves_both_outputs_and_original_caller_stdout_limit(self):
        record=self.child("import os;os.write(1,b'OK');os.write(2,b'warning')",stdout_limit=128)
        self.assertFalse(record['captureIncomplete']);self.assertEqual(record['returnCode'],0)
        collector=M.Collector();collector.budget=self.budget()
        with mock.patch.object(M,'capture',return_value=record)as capture:
            self.assertEqual(collector.safe_command(SAFE,limit=4096),b'OK')
            self.assertEqual(capture.call_args.args[3],4096)
        self.assertEqual((self.root/'command-01.stdout.private').read_bytes(),b'OK')
        self.assertEqual((self.root/'command-01.stderr.private').read_bytes(),b'warning')

    def test_full_47_inspect_stays_memory_only_and_can_exceed_safe_capture_size(self):
        record=self.child("import os;os.write(1,b'X'*583260)",stdout_limit=M.MEMORY_STDOUT_MAX)
        self.assertFalse(record['captureIncomplete']);self.assertEqual(record['stdoutBytes'],583260)
        collector=M.Collector()
        with mock.patch.object(M,'capture',return_value=record)as capture:
            self.assertEqual(len(collector.memory_command(['docker','inspect','fixed'],limit=8*1024**2)),583260)
            self.assertEqual(capture.call_args.args[3],8*1024**2)
        self.assertEqual(list(self.root.iterdir()),[])
        self.assertNotIn('stdout',collector.records[0]);self.assertFalse(collector.records[0]['rawPrivatelyArchived'])

    def test_exact_aligned_capacity_refuses_before_capture_or_mutation(self):
        budget=self.budget();used=budget.allocated()
        available=M.MAX_ARCHIVE-used-M.FINAL_RESERVE-M.META_MARGIN
        available=available//M.BLOCK*M.BLOCK
        budget.check(available)
        with self.assertRaises(RuntimeError):budget.check(available+M.BLOCK)
        sentinel=self.root/'retained.private';sentinel.write_bytes(b'unchanged')
        collector=M.Collector();collector.budget=budget
        with mock.patch.object(budget,'allocated',return_value=M.MAX_ARCHIVE-M.FINAL_RESERVE-M.META_MARGIN),mock.patch.object(M,'capture')as capture:
            with self.assertRaises(RuntimeError):collector.safe_command(SAFE)
            capture.assert_not_called()
            with self.assertRaises(RuntimeError):budget.write('rejected.private',b'x')
        self.assertEqual(sentinel.read_bytes(),b'unchanged');self.assertFalse((self.root/'rejected.private').exists())

    def test_whitelist_rejects_raw_configuration_environment_and_unreviewed_sql(self):
        collector=M.Collector();collector.budget=self.budget()
        for args,data in [(['docker','inspect','a'*64],None),(['env'],None),(['docker','exec','-i','a'*64,'sh','-c',M.PSQL],b'SELECT password FROM users;')]:
            with mock.patch.object(M,'capture')as capture:
                with self.assertRaises(RuntimeError):collector.safe_command(args,data=data)
                capture.assert_not_called()
        self.assertEqual(list(self.root.iterdir()),[])

    def test_final_failure_reserve_preserves_written_success_and_prevents_success_wire(self):
        space={'available':1024**4,'free':1024**4}
        collector=M.Collector();collector.budget=self.budget(lambda _root:dict(space));collector.safe_calls=6
        value={'success':True,'allRuntime':{str(i):{}for i in range(47)},'qcData':{'databases':13}}
        with mock.patch.object(M,'OUT',self.root):
            collector.private('result.private.json',value)
            original=(self.root/'result.private.json').read_bytes()
            space['available']=M.MIN_FINAL_AVAILABLE-1
            with mock.patch.object(M,'emit')as emit:
                with self.assertRaises(RuntimeError):collector.wire(value)
                emit.assert_not_called()
            with contextlib.redirect_stdout(io.StringIO()):collector.terminal_failure(RuntimeError('post-result-space'))
        self.assertEqual((self.root/'result.private.json').read_bytes(),original)
        failure=json.loads((self.root/'failure.private.json').read_bytes())
        self.assertFalse(failure['success']);self.assertTrue(failure['previousResultPreserved'])
        self.assertLessEqual(collector.budget.final_used,M.FINAL_RESERVE);self.assertLessEqual(collector.budget.allocated(),M.MAX_ARCHIVE)

    def test_inert_entry_and_old_collector_remain_unchanged(self):
        self.assertFalse(M.EXECUTE)
        with mock.patch.object(M,'load_old')as load,mock.patch.object(M,'capture')as capture:
            with self.assertRaises(RuntimeError):M.main()
            load.assert_not_called();capture.assert_not_called()
        old=PATH.with_name(M.OLD_NAME)
        self.assertEqual(hashlib.sha256(old.read_bytes()).hexdigest(),M.OLD_SHA256)

if __name__=='__main__':unittest.main()
