"""LOCAL DRAFT: read-only evidence for the exact interrupted recovery run.

Never seals, repairs, removes or writes anything in the old run or application.
An external receipt records failedPartial; it cannot turn the old run green.
"""
import ast
import collections
import contextlib
import datetime as dt
import hashlib
import json
import os
import pathlib
import re
import signal
import sqlite3
import stat
import subprocess
import time

ROOT = pathlib.Path('/opt/rr-portal')
PROC = pathlib.Path('/proc')
BACKUPS = ROOT / 'deploy/backups'
BACKUP = BACKUPS / 'voyageplex-mail-recovery-20261019-complete-v3'
RUN = BACKUPS / 'voyageplex-mail-recovery-20261019-complete-v3-runs/recover-39201444781'
CONTROL = BACKUPS / 'voyageplex-controlled-sigint-39201444781-20261019'
OUTPUT = BACKUPS / 'voyageplex-partial-run-39201444781-reconciliation-20261019'
BRANCH = 'refs/heads/ops/voyageplex-maildiag-20261019'
LIB_COMMIT = 'c94ea2e93f6ea81e24d409a188ff6fed31b35b07'
LIB_SHA = '59cec17eb70984e9b3b628c3c461f01cbf3358c1ffc46fe1c9a761a8c0d4b5ac'
SOURCE_COMMIT = '8b3fd8e7a876e6669d7615f3a09748ef0e9ffddc'
SOURCE_SHA = 'a903ff10d5041b521808b022ed111aaf8bf22c196f0e547a8d713577f9063c9f'
EXPECTED_HEAD = '4ec24b7b6d25836ee4ee702b57324764a856b83f'
EXPECTED_ENV = {'MAIL_RECOVERY_SHA': SOURCE_COMMIT,
                'MAIL_RECOVERY_BRANCH': 'refs/heads/ops/voyageplex-mail-recovery-20261019',
                'MAIL_RECOVERY_RUN_ID': '39201444781', 'MAIL_RECOVERY_ATTEMPT': '1', 'MAIL_RECOVERY_MODE': 'recover'}
CONTROL_RESULT_SHA = '9b14a8330a68955b20c12db98f0b3f16f67f1f6ed826c11e6cb148f566b629a0'
CONTROL_SEAL_SHA = '35b6d388bf6f38ec22f54235156a87128307659af5faa4d9e112adfb9053126a'
SEALED = [
    ('voyageplex-mail-recovery-20261019', '5c90d5251fbb212364dee9b1059fb6d76feafd617cce576bb0254bc389b442a5', 'c9af2383c41e4bf0652a02c13c39480f4d35d65bedb18b7ffa1ee35e1baa639c'),
    ('voyageplex-mail-recovery-20261019-complete-v2', '53b23b3ee4a877d944a790495626e2856dca54156c6e6b88a1998e8f99f7b8c9', 'eb4e551634673c28a1ea3a351ff4cc2205ea58e342b6f6e05f838aaf5bb5e6fa'),
    ('voyageplex-mail-recovery-20261019-complete-v3', '9d39903386dfb6a7cc9b45e8ac6680b066cd292c9fa189f9f4141487c046e0d7', '503d90340baa23ceb49d66275541e05a615293ec019ea0521e8b026e82ade0d3'),
    ('voyageplex-mail-recovery-20261019-complete-v3-runs/recover-39198686144', 'aa88dc5797310138945fb7d6f911ec596ea09b7de72f5cfbefd875095c6fa6e9', 'c2b28a5452189e4246a70d9818933f0dfc14ff0cb7539b460f365faf44e8efb4')]
DEADLINE = time.monotonic() + 480
STAMP_CACHE = {}


def require(value):
    if not value: raise ValueError()


def check_time():
    require(time.monotonic() < DEADLINE)


def stamp(path):
    value = path.lstat()
    require(stat.S_ISREG(value.st_mode))
    return [value.st_ino, value.st_size, value.st_mtime_ns, value.st_ctime_ns,
            stat.S_IMODE(value.st_mode), value.st_uid, value.st_gid]


def read(path, cap=65536):
    stamp(path)
    with path.open('rb') as source: value = source.read(cap + 1)
    require(len(value) <= cap)
    return value


def json_read(path, cap=65536):
    return json.loads(read(path, cap))


def file_hash(path):
    before = stamp(path)
    digest = hashlib.sha256()
    with path.open('rb') as source:
        for block in iter(lambda: source.read(1024**2), b''):
            check_time(); digest.update(block)
    require(stamp(path) == before)
    STAMP_CACHE[str(path)] = before
    return {'size': before[1], 'sha256': digest.hexdigest()}


def walk(directory):
    def failed(error): raise error
    return os.walk(directory, followlinks=False, onerror=failed)


def tree_manifest(directory):
    require(not directory.is_symlink() and directory.is_dir())
    result = {}; total = 0
    for parent, directories, files in walk(directory):
        check_time()
        for name in directories:
            require(not (pathlib.Path(parent) / name).is_symlink())
        for name in sorted(files):
            path = pathlib.Path(parent) / name
            total += path.lstat().st_size
            require(len(result) < 10000 and total <= 20 * 1024**3)
            result[path.relative_to(directory).as_posix()] = file_hash(path)
    return result


def metadata_unchanged(directory, manifest):
    require(not directory.is_symlink() and directory.is_dir())
    names = set()
    for parent, directories, files in walk(directory):
        check_time()
        require(all(not (pathlib.Path(parent) / name).is_symlink() for name in directories))
        for name in files:
            path = pathlib.Path(parent) / name
            names.add(path.relative_to(directory).as_posix())
            require(stamp(path) == STAMP_CACHE.get(str(path)))
    require(names == set(manifest))
    return True


def verify_manifest_seal(directory, manifest):
    expected = json_read(directory / 'seal.json', 16 * 1024**2)
    actual = {name: value['sha256'] for name, value in manifest.items() if name != 'seal.json'}
    require(expected == actual)


def sealed_guard(directory, result_sha, seal_sha):
    manifest = tree_manifest(directory)
    verify_manifest_seal(directory, manifest)
    require(manifest['first-result.json']['sha256'] == result_sha and manifest['seal.json']['sha256'] == seal_sha)
    return manifest


def git_bytes(ref, path, cap=262144):
    require(re.fullmatch('[a-f0-9]{40}', ref) is not None)
    value = subprocess.run(['git', '-C', str(ROOT), 'show', ref + ':' + path],
                           stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=10)
    require(value.returncode == 0 and len(value.stdout) <= cap)
    return value.stdout


def libraries():
    raw = git_bytes(LIB_COMMIT, 'deploy/ops/voyageplex-mail-recovery.py')
    require(hashlib.sha256(raw).hexdigest() == LIB_SHA)
    lib = {'__name__': 'reviewed_readonly_library'}
    exec(compile(raw, 'reviewed-readonly-library', 'exec'), lib)
    source = git_bytes(SOURCE_COMMIT, 'deploy/ops/voyageplex-mail-recovery.py')
    require(hashlib.sha256(source).hexdigest() == SOURCE_SHA)
    pins = {}
    for node in ast.parse(source).body:
        if isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name):
            if node.targets[0].id in {'DEPLOYED_HEAD', 'SOURCE_FILES'}:
                pins[node.targets[0].id] = ast.literal_eval(node.value)
    require(pins.get('DEPLOYED_HEAD') == EXPECTED_HEAD and isinstance(pins.get('SOURCE_FILES'), dict))
    return lib, pins


def process_facts():
    manifest = sealed_guard(CONTROL, CONTROL_RESULT_SHA, CONTROL_SEAL_SHA)
    target = json_read(CONTROL / 'target.private.json')
    require(set(target) == {'pid', 'startTicks', 'sigintExpected'} and type(target['pid']) is int and
            type(target['startTicks']) is int and target['pid'] > 1 and target['startTicks'] > 0)
    original_present = False; matches = []; scanned = 0
    for proc in PROC.iterdir():
        check_time(); scanned += 1; require(scanned <= 4096)
        if not proc.name.isdigit(): continue
        possible = False
        try:
            fields = read(proc / 'stat', 4096).rsplit(b')', 1)[1].split()
            ticks = int(fields[19])
            if int(proc.name) == target['pid'] and ticks == target['startTicks']:
                original_present = True
            argv = read(proc / 'cmdline', 8192).split(b'\0')
            if argv[-1:] == [b'']: argv.pop()
            if not (len(argv) == 3 and pathlib.PurePosixPath(argv[0].decode()).name == 'python3' and argv[2] == b'recover' and
                    re.fullmatch(rb'/tmp/mail-recovery\.[A-Za-z0-9]{6}/run\.py', argv[1])): continue
            possible = True
            env = {}
            for item in read(proc / 'environ', 65536).split(b'\0'):
                key, separator, value = item.partition(b'=')
                if separator and key.decode('ascii', 'ignore') in EXPECTED_ENV:
                    key = key.decode('ascii'); require(key not in env); env[key] = value.decode()
            if env != EXPECTED_ENV: continue
            source_match = None
            try: source_match = hashlib.sha256(read(pathlib.Path(argv[1].decode()), 262144)).hexdigest() == SOURCE_SHA
            except (OSError, ValueError): pass
            matches.append({'pid': int(proc.name), 'startTicks': ticks, 'sourceBytesMatch': source_match})
        except (FileNotFoundError, ProcessLookupError): continue
        except PermissionError: raise ValueError()
        except (OSError, ValueError, UnicodeError, IndexError):
            # A matching former PID remains unsafe even if its metadata cannot
            # be read. Other process races are not candidate evidence.
            require(not possible and int(proc.name) != target['pid'])
    private = {'formerTarget': target, 'sameRunMatches': matches}
    safe = {'formerHelperIdentityPresent': original_present, 'matchingRunHelpers': len(matches),
            'helperAbsent': not original_present and not matches, 'fullProcessScanCompleted': True}
    require(metadata_unchanged(CONTROL, manifest))
    return safe, private


def runtime(lib, pins):
    value = {'head': None, 'headMatches4ec': False, 'sourcePinsMatch4ec': False, 'apiAvailable': False}
    head = lib['command'](['git', '-C', str(ROOT), 'rev-parse', 'HEAD'], seconds=5, cap=128).decode().strip()
    require(re.fullmatch('[a-f0-9]{40}', head) is not None)
    value.update({'head': head, 'headMatches4ec': head == EXPECTED_HEAD})
    matches = {}
    for name, expected in pins['SOURCE_FILES'].items():
        require(name.startswith('apps/船务部/VoyagePlex船务协同系统/') and '..' not in pathlib.PurePosixPath(name).parts and
                re.fullmatch('[a-f0-9]{64}', expected) is not None)
        matches[name] = file_hash(ROOT / name)['sha256'] == expected
    value['sourcePinsMatch4ec'] = all(matches.values())
    template = '{"id":{{json .Id}},"name":{{json .Name}},"image":{{json .Image}},"running":{{json .State.Running}},"health":{{if .State.Health}}{{json .State.Health.Status}}{{else}}"absent"{{end}}}'
    api = json.loads(lib['command'](['docker', 'inspect', '--format', template, 'rr-portal-voyageplex-api-1'], seconds=5, cap=4096))
    require(set(api) == {'id', 'name', 'image', 'running', 'health'} and api['name'] == '/rr-portal-voyageplex-api-1' and
            re.fullmatch('[a-f0-9]{64}', api['id']) is not None and re.fullmatch('sha256:[a-f0-9]{64}', api['image']) is not None and
            type(api['running']) is bool and api['health'] in {'absent', 'starting', 'healthy', 'unhealthy'})
    dll = lib['command'](['docker', 'exec', api['id'], 'sha256sum', '/app/VoyagePlex.Api.dll'], seconds=10, cap=256).decode().split()
    require(len(dll) == 2 and re.fullmatch('[a-f0-9]{64}', dll[0]) is not None and dll[1] == '/app/VoyagePlex.Api.dll')
    value.update({'apiAvailable': True, 'apiContainerId': api['id'], 'apiImage': api['image'], 'apiRunning': api['running'],
                  'apiHealth': api['health'], 'apiDLLSHA256': dll[0], 'apiDLLByteSourceProofAvailable': False})
    return value, matches


def safe_fragment(path):
    if not path.exists():
        require(not path.is_symlink()); return {'present': False}
    value = json_read(path, 4 * 1024**2)
    require(isinstance(value, dict))
    result = {'present': True}
    for key in ['attempted', 'passed', 'responseRecoveredExactlyOne', 'failed', 'success', 'temporarySessionsCleaned',
                'failedRequestOriginalRowsAndAllCursorsUnchanged', 'transportOrResponseOutcomeUncertain']:
        if key in value:
            require(type(value[key]) is bool); result[key] = value[key]
    if 'status' in value:
        require(value['status'] is None or type(value['status']) is int and 100 <= value['status'] <= 599)
        result['status'] = value['status']
    if 'exceptionType' in value:
        result['exceptionType'] = value['exceptionType'] if value['exceptionType'] in {
            'CheckError', 'TimeoutError', 'OperationalError', 'IntegrityError', 'URLError', 'HTTPError', 'ValueError', 'OSError', 'Other'} else 'Other'
    for key in ['failedCheck', 'safeFailure']:
        if key in value:
            result[key] = value[key] if value[key] in {'WORKFLOW_TERMINATION_REQUESTED', 'REDACTED_OPERATION_FAILURE',
                'RETRY_REQUEST_OR_PRECONDITION_FAILED', 'RETRY_POST_UNCERTAIN_ABORT_ALL_FURTHER_POSTS'} else 'OTHER_REDACTED_FAILURE'
    return result


def retained_runtime():
    path = RUN / 'first-result.json'
    if not path.exists(): return None
    value = json_read(path, 4 * 1024**2).get('runtimeBefore')
    if not isinstance(value, dict): return None
    head, dll = value.get('deployedHead'), value.get('apiPublishedDLLSHA256')
    image = value.get('services', {}).get('voyageplex-api', {}).get('image')
    require(re.fullmatch('[a-f0-9]{40}', str(head)) is not None and
            re.fullmatch('[a-f0-9]{64}', str(dll)) is not None and re.fullmatch('sha256:[a-f0-9]{64}', str(image)) is not None)
    return {'deployedHead': head, 'apiPublishedDLLSHA256': dll, 'apiImage': image,
            'unsealedHistoricalFragment': not (RUN / 'seal.json').exists()}


def closed_snapshot(path):
    stamp(path)
    for suffix in ['-wal', '-shm', '-journal']:
        other = path.with_name(path.name + suffix)
        require(not other.is_symlink() and (not other.exists() or stamp(other)[1] == 0))
    with contextlib.closing(sqlite3.connect(path.as_uri() + '?mode=ro&immutable=1', uri=True)) as db:
        db.execute('PRAGMA query_only=ON')
        db.set_progress_handler(lambda: 1 if time.monotonic() >= DEADLINE else 0, 1000)
        require(db.execute('PRAGMA integrity_check').fetchone()[0] == 'ok')


def snapshot_metadata(path):
    value = json_read(path, 2048)
    keys = {'startedAtUtc', 'finishedAtUtc', 'method', 'committedWALIncluded', 'transactionConsistentSQLiteSnapshot', 'integrityCheckOK'}
    require(set(value) == keys and value['method'] == 'SQLite-online-backup-API' and
            all(value[key] is True for key in keys - {'startedAtUtc', 'finishedAtUtc', 'method'}))
    dates = [parse_date(value[key]) for key in ['startedAtUtc', 'finishedAtUtc']]
    require(dates[0] <= dates[1])
    return value


def parse_date(value):
    require(isinstance(value, str) and len(value) <= 64)
    date = dt.datetime.fromisoformat(re.sub(r'(\.\d{6})\d+', r'\1', value).replace('Z', '+00:00'))
    require(date.tzinfo is not None)
    return date.astimezone(dt.timezone.utc)


def sessions_evidence(lib, current):
    plan = RUN / 'frozen-retry-plan/current.sqlite3'
    first = RUN / 'retry-attempts/attempt-0001/before.sqlite3'
    def rows(path):
        with lib['connect'](path) as db:
            return {row['Id']: dict(row) for row in db.execute('SELECT * FROM UserSessions')}
    old, created, now = rows(plan), rows(first), rows(current)
    added = [row for key, row in created.items() if key not in old]
    row_hash = lambda row: hashlib.sha256(lib['encoded']({key: lib['typed'](value) for key, value in row.items()})).hexdigest()
    old_retained = all(key in created and row_hash(row) == row_hash(created[key]) for key, row in old.items())
    identified = False
    if len(added) == 1 and added[0].get('UserId') == 2 and old_retained:
        item = added[0]
        start = parse_date(str(item['CreatedAt']) + 'Z' if not re.search(r'(Z|[+-][0-9]{2}:[0-9]{2})$', str(item['CreatedAt'])) else str(item['CreatedAt']))
        end = parse_date(str(item['ExpiresAt']) + 'Z' if not re.search(r'(Z|[+-][0-9]{2}:[0-9]{2})$', str(item['ExpiresAt'])) else str(item['ExpiresAt']))
        plan_time = snapshot_metadata(RUN / 'frozen-retry-plan/snapshot.private.json')
        first_time = snapshot_metadata(RUN / 'retry-attempts/attempt-0001/before-snapshot.private.json')
        identified = ((end - start).total_seconds() == 1500 and parse_date(plan_time['finishedAtUtc']) <= start <= parse_date(first_time['finishedAtUtc']) and
                      isinstance(item.get('TokenHash'), str) and re.fullmatch('[A-F0-9]{64}', item['TokenHash']) is not None)
    present = None; expired = None
    if identified:
        matching = [row for row in now.values() if row.get('TokenHash') == added[0]['TokenHash']]
        require(len(matching) <= 1)
        present = bool(matching)
        expired = end <= dt.datetime.now(dt.timezone.utc)
    private = {'preSessionRows': old, 'firstStepSessionRows': created, 'currentSessionRows': now,
               'identifiedCreatedSession': added[0] if identified else None}
    safe = {'exactOwnSessionIdentifiedFromRetainedSequence': identified, 'createdSessionCandidates': len(added),
            'ownSessionPresentInCurrentSnapshot': present, 'ownSessionExpiredAtObservation': expired,
            'ownSessionRemovalObserved': None if not identified else not present, 'sessionDeletionActorProven': False,
            'expiryDoesNotProveDeletion': True, 'sessionsChangedByProbe': False}
    return safe, private


def compare_step(lib, before_path, after_path, current_path, target):
    states = []
    for path in [before_path, after_path, current_path]:
        with lib['connect'](path) as db:
            row = db.execute('SELECT * FROM ImportEmailItems WHERE Id=?', (target['id'],)).fetchone()
            require(row is not None)
            row = dict(row)
            cursors = [dict(item) for item in db.execute('SELECT * FROM MailSyncStates ORDER BY Id')]
            states.append({'targetSHA256': hashlib.sha256(lib['encoded']({key: lib['typed'](value) for key, value in row.items()})).hexdigest(),
                           'target': row, 'cursors': cursors})
    cursor_hashes = [hashlib.sha256(lib['encoded']([{key: lib['typed'](value) for key, value in row.items()}
                      for row in state['cursors']])).hexdigest() for state in states]
    return {'targetBeforeAndAfterTypedEqual': states[0]['targetSHA256'] == states[1]['targetSHA256'],
            'targetAfterAndCurrentTypedEqual': states[1]['targetSHA256'] == states[2]['targetSHA256'],
            'allCursorsBeforeAndAfterTypedEqual': cursor_hashes[0] == cursor_hashes[1],
            'currentCursorsCanAdvanceByBackgroundSync': True}, states


def emit(section, value):
    line = json.dumps({'section': section, 'data': value}, sort_keys=True, separators=(',', ':'))
    require(len(line.encode()) <= 6000)
    print(line, flush=True)


def main():
    require(os.environ.get('MAILDIAG_BRANCH') == BRANCH and os.environ.get('MAILDIAG_ATTEMPT') == '1' and
            re.fullmatch('[a-f0-9]{40}', os.environ.get('MAILDIAG_REF', '')) is not None)
    lib, pins = libraries()
    os.umask(0o077); OUTPUT.mkdir(mode=0o700)
    result = {'reconciliationComplete': False, 'failedPartial': True, 'success': False,
              'allMailboxRecoveryVerified': False, 'oldRunReclassifiedAsSuccess': False,
              'businessWrites': False, 'oldEvidenceWrites': False, 'apiOrIMAPCalls': False,
              'observedPriorWorkflowExitStatus': 137, 'exitStatusSource': 'reviewed-GitHub-Actions-log',
              'exitStatusIndependentlyVerifiedByProbe': False}
    old_manifests = {}
    try:
        proc, proc_private = process_facts(); result['process'] = proc
        lib['write_new'](OUTPUT / 'process.private.json', proc_private)
        before_runtime, source_matches = runtime(lib, pins); result['runtimeBefore'] = before_runtime
        lib['write_new'](OUTPUT / 'source-pins.private.json', {'commit': SOURCE_COMMIT, 'sourceSHA256': SOURCE_SHA,
                         'expectedHead': EXPECTED_HEAD, 'pins': pins, 'workingTreeMatches': source_matches,
                         'reconciliationSource': os.environ['MAILDIAG_REF']})
        step = RUN / 'retry-attempts/attempt-0007'
        result['step7'] = safe_fragment(step / 'result.json')
        result['parentFragment'] = safe_fragment(RUN / 'first-result.json')
        result['retainedParentRuntimeBefore'] = retained_runtime()
        result['originalParentSealPresent'] = (RUN / 'seal.json').exists()
        emit('preflight', {'process': proc, 'runtime': before_runtime, 'step7': result['step7'],
                          'parentFragment': result['parentFragment'], 'parentSealPresent': result['originalParentSealPresent']})
        require(proc['helperAbsent'])
        partial = tree_manifest(RUN); old_manifests[str(RUN)] = partial
        lib['write_new'](OUTPUT / 'partial-file-manifest.private.json', partial)
        result['originalParentFullSealVerified'] = False
        if 'seal.json' in partial:
            verify_manifest_seal(RUN, partial)
            result['originalParentFullSealVerified'] = True
        attempts = RUN / 'retry-attempts'
        require({path.name for path in attempts.iterdir()} == {'attempt-%04d' % i for i in range(1, 8)})
        receipts = []
        for index in range(1, 8):
            directory = attempts / ('attempt-%04d' % index)
            prefix = directory.relative_to(RUN).as_posix() + '/'
            manifest = {name[len(prefix):]: value for name, value in partial.items() if name.startswith(prefix)}
            sealed = 'seal.json' in manifest
            if sealed: verify_manifest_seal(directory, manifest)
            fragment = safe_fragment(directory / 'result.json')
            if index <= 6: require(sealed and fragment.get('passed') is True and fragment.get('responseRecoveredExactlyOne') is True)
            receipt = {'step': index, 'sealed': sealed, **fragment}
            receipts.append(receipt)
        result['attempts'] = receipts
        result['sealedSuccessfulSteps'] = sum(item['sealed'] and item.get('passed') is True for item in receipts)
        result['step7'] = receipts[-1]
        for name, result_sha, seal_sha in SEALED:
            directory = BACKUPS / name
            old_manifests[str(directory)] = sealed_guard(directory, result_sha, seal_sha)
        result['immutableOriginalFullAndFirstSealsVerified'] = True
        plan = RUN / 'frozen-retry-plan'
        prefix = 'frozen-retry-plan/'
        verify_manifest_seal(plan, {name[len(prefix):]: value for name, value in partial.items() if name.startswith(prefix)})
        for prefix in ['before', 'after']:
            snapshot_metadata(step / (prefix + '-snapshot.private.json'))
            closed_snapshot(step / (prefix + '.sqlite3'))
        current = OUTPUT / 'current.sqlite3'
        with current.open('xb'): pass
        current.chmod(0o600)
        lib['write_new'](OUTPUT / 'current-snapshot.private.json', lib['online_backup'](current))
        for label, path in [('step7-before', step / 'before.sqlite3'), ('step7-after', step / 'after.sqlite3'), ('current', current)]:
            check_time()
            typed = lib['table_snapshot'](path)
            lib['write_new'](OUTPUT / (label + '-typed-tables.private.json'), typed)
        target = json_read(step / 'attempt.private.json')
        require(type(target.get('id')) is int and target.get('owner') in {2, 3, 5, 6} and target.get('head') == EXPECTED_HEAD)
        comparison, comparison_private = compare_step(lib, step / 'before.sqlite3', step / 'after.sqlite3', current, target)
        lib['write_new'](OUTPUT / 'step7-comparison.private.json', {'reservation': target, 'states': comparison_private})
        result['step7TypedFacts'] = comparison
        session_safe, session_private = sessions_evidence(lib, current)
        lib['write_new'](OUTPUT / 'sessions.private.json', session_private); result['sessions'] = session_safe
        after_runtime, _ = runtime(lib, pins); result['runtimeAfter'] = after_runtime
        result['runtimeStableDuringCapture'] = before_runtime == after_runtime
        result['oldTreesMetadataStableAfterSingleStreamingHash'] = all(metadata_unchanged(pathlib.Path(name), manifest)
            for name, manifest in old_manifests.items())
        result['oldPartialManifestSHA256'] = file_hash(OUTPUT / 'partial-file-manifest.private.json')['sha256']
        result['fullOldByteHashPasses'] = 1
        result['reconciliationComplete'] = True
        result['canSupportSeparatelyReviewedNarrowPartialRunException'] = (
            result['runtimeStableDuringCapture'] and before_runtime['headMatches4ec'] and before_runtime['sourcePinsMatch4ec'])
    except Exception:
        result['safeFailure'] = 'PARTIAL_RUN_RECONCILIATION_INCOMPLETE'
    finally:
        signal.alarm(0)
        lib['write_new'](OUTPUT / 'first-result.json', result)
        lib['seal'](OUTPUT)
        emit('result', result)
        emit('receipt', {'resultSHA256': lib['file_sha'](OUTPUT / 'first-result.json'),
                         'sealSHA256': lib['file_sha'](OUTPUT / 'seal.json')})
    return 0 if result['reconciliationComplete'] else 1


if __name__ == '__main__':
    def interrupted(*_): raise TimeoutError()
    signal.signal(signal.SIGTERM, interrupted)
    signal.signal(signal.SIGALRM, interrupted)
    signal.alarm(480)
    try: raise SystemExit(main())
    except Exception:
        print('{"failedPartial":true,"success":false,"safeFailure":"PARTIAL_RECONCILIATION_SETUP_OR_RECEIPT_FAILURE"}', flush=True)
        raise SystemExit(1)
