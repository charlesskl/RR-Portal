"""INERT read-only profile 9. No activation, server access or credentials at import.

The pinned old collector retains its source/runtime/database-metadata probes.
Config/Env-bearing command output stays bounded in memory; only the six fixed
safe quote-helper outputs are archived verbatim. Captures never truncate/delete
stored bytes. Reaching a capture bound conservatively fails as incomplete.
"""
import hashlib, importlib.util, json, math, os, pathlib, re, selectors, signal, stat, subprocess, sys, time

ROOT = pathlib.Path('/opt/rr-portal')
OUT = ROOT / 'deploy/backups/batch1056-1060-preflight-9-20261103'
BASE = '90f2fa661c923c4d3144ba21d22789b38553638b'
BRANCH = 'refs/heads/codex/ops-batch1056-1060-20261103'
OLD_NAME = 'batch1056-1060-preflight.py'
OLD_SHA256 = 'a96ec5f90534459315a3752db5621d9aad9cb9a967731073547cc2441d45306c'
EXECUTE = True
MAX_ARCHIVE = 4 * 1024**2
FINAL_RESERVE = 512 * 1024
SUCCESS_RESULT_MAX = 448 * 1024
FAILURE_RESULT_MAX = 64 * 1024
META_MARGIN = 64 * 1024
P_CAPTURE_MAX = 512 * 1024
MEMORY_STDOUT_MAX = 16 * 1024**2
MEMORY_STDERR_MAX = 64 * 1024
BLOCK = 4096
MIN_FINAL_AVAILABLE = 292 * 1024**2
MIN_FINAL_FREE = 8627683328
MIN_ENTRY_AVAILABLE = 306184192 + MAX_ARCHIVE
MIN_ENTRY_FREE = 8627683328 + MAX_ARCHIVE
PSQL = 'exec psql -X -q -At -v ON_ERROR_STOP=1 -U "${POSTGRES_USER:-rrportal}" -d "${POSTGRES_DB:-rrportal}"'
CAPACITY_SQL = "BEGIN READ ONLY; SELECT json_build_object('internalQuoteRelationBytes',COALESCE((SELECT sum(pg_total_relation_size(c.oid)) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='internal_quote' AND c.relkind IN('r','m','p')),0),'databaseBytes',pg_database_size(current_database())); ROLLBACK;"

def enc(value): return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=True, allow_nan=False).encode()
def sha(body): return hashlib.sha256(body).hexdigest()
def align(size):
    if type(size) is not int or size < 0: raise RuntimeError('invalid-allocation-size')
    return (size + BLOCK - 1) // BLOCK * BLOCK
def need(value, label):
    if not value: raise RuntimeError(label)
def disk_space(root):
    value = os.statvfs(root)
    return {'available': value.f_bavail * value.f_frsize, 'free': value.f_bfree * value.f_frsize}

class Budget:
    def __init__(self, root, filesystem, space=disk_space):
        self.root, self.filesystem, self.space = pathlib.Path(root), pathlib.Path(filesystem), space
        self.final_used = 0
    def allocated(self):
        if not self.root.exists(): return 0
        need(not self.root.is_symlink() and self.root.is_dir(), 'real-owned-profile-directory')
        paths = [self.root, *self.root.iterdir()]
        need(len(paths) <= 256, 'bounded-own-evidence-entry-count')
        total = 0
        for path in paths:
            info = path.lstat()
            need(not stat.S_ISLNK(info.st_mode) and (path == self.root or stat.S_ISREG(info.st_mode)), 'regular-flat-owned-evidence-only')
            total += info.st_blocks * 512
        return total
    def check(self, growth, final=False, check_space=True):
        need(type(growth) is int and growth >= 0, 'typed-growth')
        reserve = FINAL_RESERVE - self.final_used - (growth if final else 0)
        need(reserve >= 0, 'final-result-reserve-not-consumed')
        need(self.allocated() + growth + reserve + META_MARGIN <= MAX_ARCHIVE, 'archive-four-mib-with-final-and-metadata-reserve')
        if check_space:
            current = self.space(self.filesystem)
            need(current['available'] >= MIN_FINAL_AVAILABLE + growth + reserve + META_MARGIN and current['free'] >= MIN_FINAL_FREE + growth + reserve + META_MARGIN, 'retain-final-disk-reserves-before-write')
    def reserve_capture(self):
        # Two regular files together consume at most cap + one rounding block.
        self.check(P_CAPTURE_MAX + BLOCK)
    def write(self, name, body, final=False, maximum=None, captured=False, failure=False):
        need(type(name) is str and re.fullmatch(r'[A-Za-z0-9_.-]+', name) and name not in ('.', '..'), 'fixed-private-evidence-name')
        need(type(body) is bytes and (maximum is None or len(body) <= maximum), 'bounded-complete-private-body')
        growth = align(len(body))
        self.check(growth, final=final, check_space=not (captured or failure))
        path = self.root / name
        fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_NOFOLLOW, 0o600)
        try:
            view = memoryview(body)
            while view:
                written = os.write(fd, view)
                need(written > 0, 'complete-private-write')
                view = view[written:]
            os.fsync(fd)
        finally:
            os.close(fd)
        if final: self.final_used += growth
        need(self.allocated() + FINAL_RESERVE - self.final_used + META_MARGIN <= MAX_ARCHIVE, 'actual-allocation-still-retains-final-reserve')
        return {'file': name, 'bytes': len(body), 'sha256': sha(body)}
    def final_check(self):
        need(self.allocated() <= MAX_ARCHIVE, 'final-actual-allocation-four-mib')
        value = self.space(self.filesystem)
        need(value['available'] >= MIN_FINAL_AVAILABLE and value['free'] >= MIN_FINAL_FREE, 'final-disk-reserves-before-success-wire')
        return {'allocatedBytes': self.allocated(), **value}

def capture(args, data=None, timeout=120, stdout_limit=MEMORY_STDOUT_MAX, stderr_limit=MEMORY_STDERR_MAX, combined_limit=None, cwd=ROOT):
    """Bounded nonblocking capture. Never writes raw bytes to any file itself."""
    need(type(args) is list and args and all(type(x) is str for x in args), 'typed-command')
    need(data is None or type(data) is bytes and len(data) <= MEMORY_STDOUT_MAX, 'bounded-command-input')
    need(type(stdout_limit) is int and 0 < stdout_limit <= MEMORY_STDOUT_MAX and type(stderr_limit) is int and 0 < stderr_limit <= P_CAPTURE_MAX, 'typed-command-byte-limits')
    need(type(timeout) in (int, float) and math.isfinite(timeout) and 0 < timeout <= 180, 'bounded-command-timeout')
    combined_limit = stdout_limit + stderr_limit if combined_limit is None else combined_limit
    need(type(combined_limit) is int and 0 < combined_limit <= MEMORY_STDOUT_MAX + P_CAPTURE_MAX, 'typed-combined-limit')
    buffers = {'stdout': bytearray(), 'stderr': bytearray()}
    result = {'returnCode': None, 'timedOut': False, 'limitReached': False, 'captureIncomplete': False, 'ownProcessGroupTerminated': False, 'launchErrorType': None,
        'stdoutLimitBytes':stdout_limit,'stderrLimitBytes':stderr_limit,'combinedLimitBytes':combined_limit}
    process = None
    selector = selectors.DefaultSelector()
    try:
        process = subprocess.Popen(args, stdin=subprocess.PIPE if data else subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            cwd=cwd, start_new_session=True, env=dict(os.environ, GIT_OPTIONAL_LOCKS='0', GIT_TERMINAL_PROMPT='0'))
        result['ownProcessId'] = process.pid
        for kind, stream in [('stdout', process.stdout), ('stderr', process.stderr)]:
            os.set_blocking(stream.fileno(), False); selector.register(stream, selectors.EVENT_READ, kind)
        pending = memoryview(data or b'')
        if pending:
            os.set_blocking(process.stdin.fileno(), False); selector.register(process.stdin, selectors.EVENT_WRITE, 'stdin')
        deadline = time.monotonic() + timeout
        while selector.get_map():
            if time.monotonic() >= deadline:
                result.update(timedOut=True, captureIncomplete=True); break
            events = selector.select(min(.05, max(0, deadline - time.monotonic())))
            for key, _ in events:
                kind = key.data
                if kind == 'stdin':
                    try: count = os.write(key.fd, pending[:16384])
                    except BlockingIOError: continue
                    except BrokenPipeError:
                        result.update(captureIncomplete=True, inputIncomplete=True); break
                    pending = pending[count:]
                    if not pending: selector.unregister(key.fileobj); key.fileobj.close()
                    continue
                limit = stdout_limit if kind == 'stdout' else stderr_limit
                room = min(limit - len(buffers[kind]), combined_limit - sum(map(len, buffers.values())))
                if room <= 0:
                    result.update(limitReached=True, captureIncomplete=True); break
                try: body = os.read(key.fd, min(16384, room))
                except BlockingIOError: continue
                if not body: selector.unregister(key.fileobj); continue
                buffers[kind].extend(body)
                # No byte beyond the limit is read or discarded. At an exact
                # bound, fail conservatively rather than guessing that EOF came.
                if len(buffers[kind]) == limit or sum(map(len, buffers.values())) == combined_limit:
                    result.update(limitReached=True, captureIncomplete=True); break
            if result['captureIncomplete']: break
        if not result['captureIncomplete']:
            try: process.wait(timeout=max(.001, deadline - time.monotonic()))
            except subprocess.TimeoutExpired: result.update(timedOut=True, captureIncomplete=True)
    except Exception as error:
        result.update(launchErrorType=type(error).__name__, captureIncomplete=True)
    finally:
        if process is not None:
            if result['captureIncomplete']:
                result['ownProcessGroupTerminated'] = True
                try: os.killpg(process.pid, signal.SIGTERM)
                except ProcessLookupError: pass
                try: process.wait(timeout=.2)
                except subprocess.TimeoutExpired: pass
                # Descendants may retain pipes even after the leader exits.
                try: os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError: pass
            try: process.wait(timeout=1)
            except subprocess.TimeoutExpired: result['captureIncomplete'] = True
            result['returnCode'] = process.returncode
            for stream in (process.stdin, process.stdout, process.stderr):
                if stream is not None and not stream.closed: stream.close()
        selector.close()
    for kind in ('stdout', 'stderr'):
        body = bytes(buffers[kind]); result[kind] = body
        result[kind + 'Bytes'] = len(body); result[kind + 'SHA256'] = sha(body)
    result['combinedBytes'] = result['stdoutBytes'] + result['stderrBytes']
    return result

def capture_summary(record): return {key: value for key, value in record.items() if key not in ('stdout', 'stderr')}

class Collector:
    def __init__(self):
        self.budget = None; self.module = None; self.records = []; self.safe_calls = 0
        self.result_written = None; self.wire_emitted = False; self.sql = {CAPACITY_SQL.encode()}
    def remember(self, record, archived=False):
        summary = capture_summary(record); summary['rawPrivatelyArchived'] = archived
        self.records.append(summary); return summary
    def failed(self, record):
        return record['captureIncomplete'] or record['returnCode'] != 0
    def ensure_success(self, record):
        if self.failed(record):
            if self.module is not None: self.module.STAGE = 'readonly-command-capture-incomplete' if record['captureIncomplete'] else 'readonly-command-nonzero'
            raise RuntimeError('readonly-command-failed')
    def memory_command(self, args, data=None, timeout=120, limit=MEMORY_STDOUT_MAX):
        need(type(limit) is int and 0 < limit <= MEMORY_STDOUT_MAX, 'original-caller-memory-limit')
        record = capture(args, data, timeout, limit, MEMORY_STDERR_MAX)
        self.remember(record); self.ensure_success(record); return record['stdout']
    def safe_scope(self, args, data):
        if type(args) is not list or not all(type(x) is str for x in args): return False
        cid = lambda value: type(value) is str and re.fullmatch('[a-f0-9]{64}', value)
        if len(args) == 8 and args[:7] == ['docker','ps','-aq','--no-trunc','--filter','label=com.docker.compose.project=rr-portal','--filter']:
            return args[7] in ['label=com.docker.compose.service=nginx','label=com.docker.compose.service=db'] and data is None
        if len(args) == 5 and args[:4] == ['docker','inspect','--format','{{json .Mounts}}']:
            return bool(cid(args[4])) and data is None
        return len(args) == 7 and args[:3] == ['docker','exec','-i'] and bool(cid(args[3])) and args[4:] == ['sh','-c',PSQL] and type(data) is bytes and data in self.sql
    def safe_command(self, args, limit=8*1024**2, data=None, timeout=90):
        need(self.safe_scope(args, data), 'fixed-safe-command-output-only-no-config-env-or-credential-body')
        need(type(limit) is int and limit > 0, 'positive-safe-stdout-limit')
        self.budget.reserve_capture()   # Refuse before launch if full capture cannot fit.
        record = capture(args, data, timeout, min(limit, P_CAPTURE_MAX), P_CAPTURE_MAX, P_CAPTURE_MAX)
        self.safe_calls += 1
        prefix = 'command-%02d' % self.safe_calls
        summary = self.remember(record, archived=True)
        try:
            for kind in ('stdout','stderr'):
                summary[kind + 'Archive'] = self.budget.write(prefix + '.' + kind + '.private', record[kind], captured=True)
        except Exception:
            summary.update(archiveIncomplete=True, captureIncomplete=True)
            raise
        self.ensure_success(record); return record['stdout']
    def private(self, name, value):
        if name != 'result.private.json':
            return self.budget.write(name, enc(value))
        value.pop('resultSHA256', None)
        value.update(profileArchiveUpperBytes=MAX_ARCHIVE, finalReserveBytes=FINAL_RESERVE, metadataMarginBytes=META_MARGIN,
            captureIncomplete=any(row['captureIncomplete'] for row in self.records), commandCaptures=self.records,
            rawConfigOrEnvExported=False, safeRawOutputOnly=True)
        if value['captureIncomplete']: value['success'] = False
        if value.get('success'):
            need(len(value['allRuntime']) == 47 and value['qcData']['databases'] == 13 and self.safe_calls == 6, 'all47-two-qc-targets-13db-and-fixed-six-safe-captures')
        value['resultSHA256'] = sha(enc(value)); body = enc(value)
        self.budget.write(name, body, final=True, maximum=SUCCESS_RESULT_MAX, failure=not value.get('success'))
        self.result_written = (name, sha(body))
    def wire(self, value):
        need(self.result_written is not None and sha((OUT / self.result_written[0]).read_bytes()) == self.result_written[1], 'complete-result-on-disk-before-wire')
        body = enc(value); inner = dict(value); inner.pop('resultSHA256', None)
        need(len(body) <= FINAL_RESERVE and sha(body) == self.result_written[1] and sha(enc(inner)) == value.get('resultSHA256'), 'wire-exact-complete-disk-result-with-selfhash-at-most512k')
        if value.get('success'): self.budget.final_check()
        emit(value); self.wire_emitted = True
    def terminal_failure(self, error):
        reason = error.args[0] if error.args and type(error.args[0]) is str and re.fullmatch(r'[A-Za-z0-9_.-]{1,160}', error.args[0]) else None
        value = {'phase':'diagnose','mode':'diagnose','success':False,'readOnly':True,'sourceBaseline':BASE,
            'errorType':type(error).__name__,'stage':reason or getattr(self.module,'STAGE','entry'),
            'captureIncomplete':any(row['captureIncomplete'] for row in self.records),'commandCaptures':self.records,
            'previousResultPreserved':self.result_written is not None,'rawConfigOrEnvExported':False,
            'plaintextCredentialsWritten':False,'businessWrites':False,'lifecycleWrites':False,'configWrites':False}
        value['resultSHA256'] = sha(enc(value)); body = enc(value)
        need(len(body) <= FAILURE_RESULT_MAX, 'bounded-complete-terminal-failure')
        if self.budget is not None and OUT.is_dir() and not OUT.is_symlink():
            self.budget.write('failure.private.json', body, final=True, maximum=FAILURE_RESULT_MAX, failure=True)
        emit(value); self.wire_emitted = True

def emit(value):
    raw = enc(value); need(len(raw) <= FINAL_RESERVE, 'wire-full-result-bound')
    nib = lambda item: [int(c,16) for c in (format(item,'x') if type(item) is int else item)]
    parts = [raw[i:i+1024] for i in range(0,len(raw),1024)]; digest = nib(sha(raw))
    for index, body in enumerate(parts): print(enc([0,nib(index+1),nib(len(parts)),nib(len(raw)),digest,nib(body.hex())]).decode(), flush=True)
    print(enc([1,nib(len(parts)),nib(len(raw)),digest]).decode(), flush=True)

def load_old():
    path = pathlib.Path(__file__).with_name(OLD_NAME)
    need(path.is_file() and not path.is_symlink() and sha(path.read_bytes()) == OLD_SHA256, 'pinned-original-preflight8-no-edits')
    spec = importlib.util.spec_from_file_location('batch1062_original_readonly', path)
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module); return module

def main():
    need(EXECUTE is True and sys.argv[1:] == ['diagnose'] and os.environ.get('RELEASE_BRANCH') == BRANCH and os.environ.get('RELEASE_MODE') == 'diagnose' and os.environ.get('RELEASE_ATTEMPT') == '1', 'inert-explicit-first-readonly-profile9')
    need(OUT.parent.is_dir() and not any(p.is_symlink() for p in (OUT.parent,*OUT.parent.parents)) and not OUT.exists(), 'new-owned-profile9-never-replayed')
    collector = Collector()
    try:
        root = json.loads(collector.memory_command(['docker','info','--format','{{json .DockerRootDir}}'],limit=65536))
        need(type(root) is str and pathlib.Path(root).is_absolute(), 'actual-docker-filesystem')
        need(os.stat(OUT.parent).st_dev == os.stat(root).st_dev and os.statvfs(OUT.parent).f_frsize == BLOCK == os.statvfs(root).f_frsize, 'archive-and-docker-share-reviewed-4096-byte-filesystem')
        space = disk_space(root)
        need(space['available'] >= MIN_ENTRY_AVAILABLE and space['free'] >= MIN_ENTRY_FREE, 'four-mib-growth-plus-fresh-entry-reserves')
        collector.budget = Budget(OUT, root)
        old = load_old(); collector.module = old
        need(old.BASE == BASE, 'unchanged-source-baseline90f2')
        old.OUT = OUT; old.EXECUTE = True; old.command = collector.memory_command; old.private = collector.private
        original_load, original_containers = old.load, old.containers
        def load(name):
            module = original_load(name)
            if name == 'pr1035-quote-preflight.py':
                collector.sql.add(module.QUOTE_SQL.encode()); module.command = collector.safe_command
            else:
                module.command = lambda args, timeout=90, limit=8*1024**2: collector.memory_command(args,timeout=timeout,limit=limit)
                module.wire = collector.wire
            return module
        def containers():
            value = original_containers(); old.need(len(value[0]) == 47, 'all47-original-runtime-containers'); return value
        old.load = load; old.containers = containers
        return old.main()
    except Exception as error:
        collector.terminal_failure(error); return 1

if __name__ == '__main__': sys.exit(main())
