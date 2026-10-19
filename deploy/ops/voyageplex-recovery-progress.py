"""Unexecuted fixed read-only deployment progress probe. No raw argv/env/logs."""
import hashlib
import collections
import json
import os
import pathlib
import re
import select
import sqlite3
import subprocess
import time

ROOT = pathlib.Path('/opt/rr-portal')
EXPECTED_HEAD = '4ec24b7b6d25836ee4ee702b57324764a856b83f'
UPDATE_SCRIPT_SHA256 = '65691c767b5228287ff905d0a273ddd8cf6acdca8aacf7ff023a734f3de4ed21'
DEADLINE = time.monotonic() + 38
LIB_COMMIT = 'c94ea2e93f6ea81e24d409a188ff6fed31b35b07'
LIB_SHA = '59cec17eb70984e9b3b628c3c461f01cbf3358c1ffc46fe1c9a761a8c0d4b5ac'
ATTEMPTS = ROOT / 'deploy/backups/voyageplex-mail-recovery-20261019-complete-v3-runs/recover-39201444781/retry-attempts'
TOOLS = {'docker', 'docker-compose', 'buildkitd', 'buildkit-runc', 'buildctl',
         'node', 'npm', 'npm ci', 'npm run build', 'dotnet', 'apt', 'apt-get',
         'apk', 'wget', 'curl', 'git', 'gzip', 'tar', 'pg_dump', 'python',
         'python3', 'python3.11', 'python3.12', 'bash', 'sh'}


def emit(section, value):
    line = json.dumps({'section': section, 'data': value}, ensure_ascii=True,
                      separators=(',', ':'), sort_keys=True, allow_nan=False)
    if len(line.encode()) > 6000:
        raise ValueError()
    print(line, flush=True)


def read(path, cap=4096):
    with path.open('rb') as source:
        value = source.read(cap + 1)
    if len(value) > cap:
        raise ValueError()
    return value


def command(args, seconds=7, cap=32768):
    end = min(DEADLINE, time.monotonic() + seconds)
    process = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    output = bytearray()
    try:
        while True:
            remaining = end - time.monotonic()
            if remaining <= 0 or not select.select([process.stdout], [], [], remaining)[0]:
                return None
            block = os.read(process.stdout.fileno(), min(4096, cap - len(output) + 1))
            if not block:
                process.wait(timeout=max(.01, end - time.monotonic()))
                return bytes(output) if process.returncode == 0 else None
            output.extend(block)
            if len(output) > cap:
                return None
    finally:
        if process.poll() is None:
            process.kill()  # Diagnostic CLI only; never signal an application.
        process.wait(timeout=1)
        process.stdout.close()


def state():
    path = ROOT / 'deploy/.deploy-state'
    value = {'exists': path.is_file(), 'phase': None}
    if value['exists']:
        if path.is_symlink():
            raise ValueError()
        raw = read(path, 128).decode('ascii', 'replace').strip()
        value['phase'] = raw if raw in {'pulling', 'analyze', 'cleanup', 'directories', 'backup', 'deploy'} else 'unknown'
    head = command(['git', '-C', str(ROOT), 'rev-parse', 'HEAD'], seconds=5, cap=128)
    value['headMatchesExpectedDeployment'] = bool(head and head.decode('ascii', 'replace').strip() == EXPECTED_HEAD)
    emit('deployment', value)


def containers():
    template = ('{"id":{{json .Id}},"image":{{json .Image}},"status":{{json .State.Status}},'
                '"running":{{json .State.Running}},"restartCount":{{.RestartCount}},'
                '"oomKilled":{{json .State.OOMKilled}},'
                '"health":{{if .State.Health}}{{json .State.Health.Status}}{{else}}"none"{{end}}}')
    for service in ['voyageplex-web', 'voyageplex-api', 'voyageplex-parser']:
        raw = command(['docker', 'inspect', '--format', template, 'rr-portal-' + service + '-1'])
        result = {'service': service, 'available': False}
        if raw is not None:
            data = json.loads(raw)
            if (re.fullmatch('[a-f0-9]{64}', str(data.get('id', ''))) and
                    re.fullmatch('sha256:[a-f0-9]{64}', str(data.get('image', ''))) and
                    data.get('status') in {'created', 'running', 'paused', 'restarting', 'removing', 'exited', 'dead'} and
                    data.get('health') in {'none', 'starting', 'healthy', 'unhealthy'} and
                    type(data.get('restartCount')) is int and type(data.get('running')) is bool and
                    type(data.get('oomKilled')) is bool):
                result.update(data)
                result['available'] = True
        emit('container', result)


def process_stat(pid, uptime, ticks):
    path = pathlib.Path('/proc') / str(pid)
    comm = read(path / 'comm', 64).decode('utf-8', 'replace').strip()
    fields = read(path / 'stat').rsplit(b')', 1)[1].split()
    ppid = int(fields[1])
    elapsed = max(0., uptime - int(fields[19]) / ticks)
    cpu = (int(fields[11]) + int(fields[12])) / ticks
    return {'pid': pid, 'ppid': ppid, 'comm': comm, 'elapsedSeconds': round(elapsed, 1),
            'cpuLifetimePercent': round(cpu / elapsed * 100, 2) if elapsed > 0 else 0.}


def argv(pid):
    # Private classification only. These strings are never returned or printed.
    return [part.decode('utf-8', 'strict') for part in read(pathlib.Path('/proc') / str(pid) / 'cmdline', 4096).split(b'\0') if part]


def parent_is_update_server(pid, uptime, ticks):
    visited = set()
    while pid > 1 and pid not in visited and len(visited) < 24 and time.monotonic() < DEADLINE:
        visited.add(pid)
        try:
            item = process_stat(pid, uptime, ticks)
            if item['comm'] in {'bash', 'sh'}:
                for value in argv(pid)[1:6]:
                    # workflow writes the exact reviewed script to GNU mktemp's
                    # random /tmp/tmp.* path; identify it by bytes, not its name.
                    if value == str(ROOT / 'deploy/update-server.sh') or re.fullmatch(r'/tmp/tmp\.[A-Za-z0-9]{6,32}', value):
                        path = pathlib.Path(value)
                        if not path.is_symlink() and hashlib.sha256(read(path, 131072)).hexdigest() == UPDATE_SCRIPT_SHA256:
                            return True
            pid = item['ppid']
        except (OSError, ValueError, IndexError, UnicodeError):
            return False
    return False


def sqlite_source(pid):
    parts = argv(pid)
    if len(parts) != 4 or pathlib.PurePosixPath(parts[0]).name not in {'python3', 'python', 'python3.11', 'python3.12'} or parts[1] != '-':
        return None
    source = pathlib.PurePosixPath(parts[2])
    destination = pathlib.PurePosixPath(parts[3])
    if not source.is_absolute():
        if pathlib.Path(os.readlink(pathlib.Path('/proc') / str(pid) / 'cwd')) != ROOT:
            return None
        source = pathlib.PurePosixPath(ROOT) / source
    if (source.suffix != '.db' or '..' in source.parts or
            not source.is_relative_to(pathlib.PurePosixPath(ROOT / 'apps')) or
            destination.parent != pathlib.PurePosixPath(ROOT / 'deploy/backups')):
        return None
    value = source.relative_to(ROOT).as_posix()
    if len(value) > 512 or any(ord(char) < 32 or ord(char) == 127 for char in value):
        return None
    return value


def processes():
    uptime = float(read(pathlib.Path('/proc/uptime'), 128).split()[0])
    ticks = os.sysconf('SC_CLK_TCK')
    tools, backups, examined = [], [], 0
    for path in pathlib.Path('/proc').iterdir():
        if not path.name.isdigit() or time.monotonic() >= DEADLINE:
            continue
        examined += 1
        if examined > 4096:
            break
        try:
            item = process_stat(int(path.name), uptime, ticks)
            if item['comm'] not in TOOLS:
                continue
            tools.append(item)
            if item['comm'] in {'python', 'python3', 'python3.11', 'python3.12'}:
                source = sqlite_source(item['pid'])
                if source is not None:
                    backups.append({**item, 'classification': 'sqlite-online-backup-command-shape',
                                    'sourceRelativeAppDatabase': source,
                                    'parentChainIsReviewedUpdateServer': parent_is_update_server(item['ppid'], uptime, ticks)})
        except (OSError, ValueError, IndexError, UnicodeError):
            continue
    for offset in range(0, min(len(tools), 100), 20):
        emit('buildToolProcesses', {'items': tools[offset:offset + 20], 'cpuIsLifetimeAverage': True})
    for item in backups[:20]:
        emit('sqliteBackupCandidate', item)
    emit('processSummary', {'examined': examined, 'whitelistedToolCount': len(tools),
                            'toolOutputLimitedTo': 100, 'sqliteBackupCandidates': len(backups),
                            'sqliteCandidateOutputLimitedTo': 20, 'rawArgumentsOrEnvironmentPrinted': False})


def resources():
    memory = {}
    for line in read(pathlib.Path('/proc/meminfo'), 16384).decode().splitlines():
        match = re.fullmatch(r'(MemTotal|MemAvailable|SwapTotal|SwapFree):\s+([0-9]+) kB', line)
        if match:
            memory[match[1] + 'KiB'] = int(match[2])
    disk = os.statvfs(ROOT)
    emit('resources', {'memory': memory, 'diskTotalBytes': disk.f_blocks * disk.f_frsize,
                       'diskAvailableBytes': disk.f_bavail * disk.f_frsize,
                       'diskFreeInodes': disk.f_favail})


def safe_time(value):
    return value if isinstance(value, str) and re.fullmatch(r'\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.[0-9]{1,9})?Z?', value) else None


class JsonObject(list):
    pass


class JsonInteger(str):
    pass


def valid_task_sources(raw):
    # Count container depth before json.loads; preserve duplicate object keys
    # and numeric token kinds instead of accepting substring/id coercion.
    depth, quoted, escaped = 0, False, False
    for char in raw:
        if quoted:
            if escaped: escaped = False
            elif char == '\\': escaped = True
            elif char == '"': quoted = False
        elif char == '"': quoted = True
        elif char in '[{':
            depth += 1
            if depth > 8: return False
        elif char in ']}':
            depth -= 1
            if depth < 0: return False
    def invalid_constant(_): raise ValueError()
    try:
        value = json.loads(raw, object_pairs_hook=JsonObject, parse_int=JsonInteger,
                           parse_float=str, parse_constant=invalid_constant)
        if type(value) is not list: return False
        for item in value:
            if type(item) is not JsonObject: return False
            ids = [v for key, v in item if key == 'id']
            if len(ids) != 1 or type(ids[0]) is not JsonInteger: return False
            token = ids[0]
            if not re.fullmatch('[1-9][0-9]{0,18}', token) or int(token) > 9223372036854775807: return False
        return True
    except (ValueError, TypeError, RecursionError):
        return False


def task_sources_preflight(db):
    count = db.execute("SELECT COUNT(*) FROM ShipmentTasks WHERE Company='Huadeng'").fetchone()[0]
    result = {'taskCount': count, 'examinedRows': 0, 'structureRowsChecked': 0, 'invalidStructureRows': 0,
              'nullRows': 0, 'maxProjectedUtf16Chars': 0, 'totalProjectedUtf16Chars': 0,
              'perRowBudgetPassed': True, 'totalBudgetPassed': True, 'taskCountBudgetPassed': count <= 10000,
              'allRowsExamined': False, 'allTaskSourcesWouldPassGuard': False,
              'scope': 'all-Huadeng-owners', 'maxDepth': 8, 'sqlProjectionChars': 65537}
    if count <= 10000:
        for raw, in db.execute("SELECT substr(SourceEmailsJson,1,65537) FROM ShipmentTasks WHERE Company='Huadeng' LIMIT 10001"):
            if time.monotonic() >= DEADLINE: break
            result['examinedRows'] += 1
            if not isinstance(raw, str):
                result['nullRows'] += 1
                result['invalidStructureRows'] += 1
                continue
            length = len(raw.encode('utf-16-le', errors='surrogatepass')) // 2
            result['maxProjectedUtf16Chars'] = max(result['maxProjectedUtf16Chars'], length)
            result['totalProjectedUtf16Chars'] += length
            if length > 65536:
                result['perRowBudgetPassed'] = False
                break
            if result['totalProjectedUtf16Chars'] > 4 * 1024 * 1024:
                result['totalBudgetPassed'] = False
                break
            result['structureRowsChecked'] += 1
            result['invalidStructureRows'] += not valid_task_sources(raw)
        result['allRowsExamined'] = result['examinedRows'] == count
    result['allTaskSourcesWouldPassGuard'] = bool(result['allRowsExamined'] and result['perRowBudgetPassed'] and
        result['totalBudgetPassed'] and result['taskCountBudgetPassed'] and not result['invalidStructureRows'])
    emit('taskSourcesPreflight', result)


def safe_retry_result(value):
    required = {'owner', 'status', 'responseRecoveredExactlyOne', 'passed', 'attempted'}
    optional = {'safeFailure', 'transition', 'transportOrResponseOutcomeUncertain', 'failedRequestOriginalRowsAndAllCursorsUnchanged'}
    transitions = {'onlyAllowedTargetTypedFieldsChanged', 'parsedMetadataAndFingerprintPassed',
                  'otherExistingMailRowsIdentical', 'batchCountersAndAllOtherBatchFieldsPassed',
                  'allCursorFieldsUnchangedDuringRetry', 'passed'}
    if not isinstance(value, dict) or not required <= set(value) or set(value) - required - optional: raise ValueError()
    if type(value['owner']) is not int or value['owner'] not in {2, 3, 5, 6}: raise ValueError()
    if value['status'] is not None and (type(value['status']) is not int or not 100 <= value['status'] <= 599): raise ValueError()
    if any(type(value[key]) is not bool for key in ['responseRecoveredExactlyOne', 'passed', 'attempted']): raise ValueError()
    if 'safeFailure' in value and value['safeFailure'] != 'RETRY_REQUEST_OR_PRECONDITION_FAILED': raise ValueError()
    for key in optional - {'safeFailure', 'transition'}:
        if key in value and type(value[key]) is not bool: raise ValueError()
    if 'transition' in value and (not isinstance(value['transition'], dict) or set(value['transition']) != transitions or
                                 any(type(item) is not bool for item in value['transition'].values())): raise ValueError()
    return value


def retry_attempts_progress():
    result = {'runId': '39201444781', 'parentSealRequired': False, 'attemptDirectoryPresent': False,
              'sealedVerified': 0, 'passed': 0, 'notPassed': 0, 'pendingUnsealed': 0,
              'unverified': 0, 'invalidSafeSchema': 0, 'scanComplete': False, 'budgetLimited': False}
    if not ATTEMPTS.exists():
        result['scanComplete'] = True
        emit('retryAttemptProgress', result)
        return
    if ATTEMPTS.is_symlink() or not ATTEMPTS.is_dir(): raise ValueError()
    result['attemptDirectoryPresent'] = True
    paths = []
    for path in ATTEMPTS.iterdir():
        if time.monotonic() >= DEADLINE - 3 or len(paths) >= 5000:
            result['budgetLimited'] = True
            break
        if re.fullmatch('attempt-[0-9]{4}', path.name) and not path.is_symlink() and path.is_dir(): paths.append(path)
    else:
        result['scanComplete'] = True
    code = command(['git', '-C', str(ROOT), 'show', LIB_COMMIT + ':deploy/ops/voyageplex-mail-recovery.py'], seconds=4, cap=262144)
    if code is None or hashlib.sha256(code).hexdigest() != LIB_SHA:
        result['unverified'] = len(paths)
        emit('retryAttemptProgress', result)
        return
    lib = {'__name__': 'reviewed_seal_reader'}
    exec(compile(code, 'reviewed-seal-reader', 'exec'), lib)
    items = []
    for index, path in enumerate(sorted(paths)):
        if time.monotonic() >= DEADLINE - 3:
            result['budgetLimited'] = True
            result['unverified'] += len(paths) - index
            break
        if not (path / 'seal.json').exists():
            result['pendingUnsealed'] += 1
            continue
        try:
            # Same SHA semantics as the reviewed helper, with a deadline inside
            # large SQLite-file hashing. Private maps are hashed, never parsed.
            def bounded_sha(member):
                digest = hashlib.sha256()
                with member.open('rb') as source:
                    while True:
                        if time.monotonic() >= DEADLINE - 3: raise TimeoutError()
                        block = source.read(1024 * 1024)
                        if not block: return digest.hexdigest()
                        digest.update(block)
            def seal_json(member):
                if member != path / 'seal.json' or member.is_symlink(): raise ValueError()
                return json.loads(read(member, 16384))
            lib['file_sha'], lib['read_json'] = bounded_sha, seal_json
            lib['verify_seal'](path)
            raw = read(path / 'result.json', 16384)
            if hashlib.sha256(raw).hexdigest() != seal_json(path / 'seal.json').get('result.json'): raise ValueError()
        except Exception:
            result['unverified'] += 1  # May still be sealing; never call this a failed retry.
            if time.monotonic() >= DEADLINE - 3: result['budgetLimited'] = True
            continue
        result['sealedVerified'] += 1
        try:
            value = safe_retry_result(json.loads(raw))
        except (ValueError, TypeError):
            result['invalidSafeSchema'] += 1
            continue
        result['passed' if value['passed'] else 'notPassed'] += 1
        items.append(value)
        if len(items) == 8:
            emit('sealedRetryAttempts', {'runId': '39201444781', 'items': items})
            items = []
    if items: emit('sealedRetryAttempts', {'runId': '39201444781', 'items': items})
    emit('retryAttemptProgress', result)


def recovery_snapshot():
    live = ROOT / 'apps/船务部/VoyagePlex船务协同系统/data-runtime/voyageplex.db'
    baseline = ROOT / 'deploy/backups/voyageplex-mail-recovery-20261019-complete-v3/baseline.sqlite3'
    if live.is_symlink() or baseline.is_symlink() or not live.is_file() or not baseline.is_file():
        raise ValueError()
    db = sqlite3.connect(live.as_uri() + '?mode=ro', uri=True, timeout=3)
    try:
        db.execute('PRAGMA query_only=ON')
        db.set_progress_handler(lambda: 1 if time.monotonic() > DEADLINE else 0, 1000)
        db.execute('ATTACH DATABASE ? AS baseline', (baseline.as_uri() + '?mode=ro&immutable=1',))
        db.execute('BEGIN')
        old = {r[0]: r[1:] for r in db.execute("SELECT MailOwnerId,COUNT(*),SUM(Status='failed'),SUM(Status IN ('duplicate','duplicate_confirmed')) FROM baseline.ImportEmailItems WHERE Company='Huadeng' AND MailOwnerId IN (2,3,5,6) AND MailboxKey<>'' GROUP BY MailOwnerId")}
        current = {r[0]: r[1:] for r in db.execute("""SELECT i.MailOwnerId,COUNT(*),SUM(i.Status='failed'),SUM(i.Status IN ('duplicate','duplicate_confirmed')),MAX(i.MailReceivedDate),
          SUM(b.Id IS NULL),SUM(b.Id IS NULL AND i.Status='failed') FROM main.ImportEmailItems i
          LEFT JOIN baseline.ImportEmailItems b ON b.Id=i.Id WHERE i.Company='Huadeng' AND i.MailOwnerId IN (2,3,5,6) AND i.MailboxKey<>'' GROUP BY i.MailOwnerId""")}
        states = {r[0]-1000:r[1:] for r in db.execute("""SELECT s.Id,s.LastUid,s.LastSuccessAt,CASE WHEN s.LastError<>'' THEN 1 ELSE 0 END,
          t.SyncEnabled,t.SyncIntervalMinutes,u.MailboxTestStatus,u.MailboxTestedAt FROM main.MailSyncStates s
          JOIN main.MailSystemSettings t ON t.Id=s.Id JOIN main.Users u ON u.Id=s.Id-1000 WHERE s.Id IN (1002,1003,1005,1006)""")}
        allowed = {'metadata','message_size','body_read','parse_memory','parse_timeout','parse_result_size','parse_process','parse_cancelled'}
        failures = {owner:collections.Counter() for owner in [2,3,5,6]}
        for owner, raw in db.execute("""SELECT i.MailOwnerId,CASE WHEN length(CAST(i.ResultJson AS BLOB))<=2097152 THEN i.ResultJson ELSE NULL END
          FROM main.ImportEmailItems i LEFT JOIN baseline.ImportEmailItems b ON b.Id=i.Id
          WHERE i.Company='Huadeng' AND i.MailOwnerId IN (2,3,5,6) AND i.MailboxKey<>'' AND i.Status='failed' AND b.Id IS NULL"""):
            try:
                value = json.loads(raw) if isinstance(raw,str) else {}
                kind = value.get('failure_kind') if isinstance(value,dict) else None
            except (ValueError,TypeError):
                kind = None
            failures[owner][kind if isinstance(kind,str) and kind in allowed else 'other'] += 1
        for owner in [2,3,5,6]:
            a, b, c = old.get(owner, (0,0,0)), current.get(owner, (0,0,0,None,0,0)), states.get(owner)
            date = b[3] if isinstance(b[3], str) and re.fullmatch(r'\d{4}-\d{2}-\d{2}', b[3]) else None
            value = {'owner':owner,'mailCount':b[0],'failedCount':b[1],'duplicateCount':b[2],'latestReceivedDate':date,
                     'baselineMailCount':a[0],'baselineFailedCount':a[1],'netMailChangeSinceBaseline':b[0]-a[0],
                     'newMailRecordsSinceBaseline':b[4],'newFailedRecordsSinceBaseline':b[5],
                     'newFailureKindsSinceBaseline':dict(sorted(failures[owner].items())),'cursorAvailable':c is not None}
            if c is not None:
                value.update({'lastUid':c[0],'lastSuccessAtUtc':safe_time(c[1]),'syncErrorPresent':bool(c[2]),'syncEnabled':bool(c[3]),
                              'syncIntervalMinutes':c[4],'mailboxTestStatus':c[5] if c[5] in {'Connected','Failed'} else 'Other','mailboxTestedAtUtc':safe_time(c[6])})
            emit('mailboxProgress', value)
        task_sources_preflight(db)
        db.rollback()
    finally:
        db.close()


def parser_stats():
    raw = command(['docker','stats','--no-stream','--format','{{.CPUPerc}}|{{.MemPerc}}|{{.PIDs}}','rr-portal-voyageplex-parser-1'], cap=128)
    match = re.fullmatch(r'([0-9]+(?:\.[0-9]+)?)%\|([0-9]+(?:\.[0-9]+)?)%\|([0-9]+)', raw.decode('ascii','replace').strip()) if raw is not None else None
    emit('parserResources', {'available':match is not None, **({'cpuPercent':float(match[1]),'memoryPercent':float(match[2]),'pids':int(match[3])} if match else {})})


if __name__ == '__main__':
    try:
        state()
        containers()
        recovery_snapshot()
        retry_attempts_progress()
        parser_stats()
        processes()
        resources()
        emit('scope', {'readOnly': True, 'rawLogsOrEnvironmentRead': False,
                        'commandsPrivatelyClassifiedOnlyForFixedBackupAndReviewedParentScript': True,
                        'elapsedSeconds': round(time.monotonic() - (DEADLINE - 38), 2)})
    except Exception:
        emit('failure', {'readOnly': True, 'reason': 'REDACTED_DIAGNOSTIC_FAILURE'})
        raise SystemExit(1)
