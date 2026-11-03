"""INERT account-only operator. No service lifecycle, image, source, Git, or environment writes."""
import hashlib
import json
import os
import pathlib
import secrets
import selectors
import stat
import subprocess
import sys
import time
from account_transaction import SCOPE, SCOPE_SHA256, capabilities, digest, encode, plan, require

EXECUTE = True
BRANCH = 'refs/heads/codex/ops-engineering-admin-access-20261103'
BASE = pathlib.Path('/opt/rr-portal/deploy/backups/engineering-admin-access-2-20261103')
MODES = ('diagnose', 'maintain', 'verify', 'reconcile')
EXPECTED_CONTAINERS = 46


def durable_write(path, value):
    """Never replace/replay evidence; file and containing directory synced before ACK."""
    raw = encode(value)
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW
    fd = os.open(path, flags, 0o600)
    with os.fdopen(fd, 'wb') as stream:
        stream.write(raw)
        stream.flush()
        os.fsync(stream.fileno())
    dfd = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(dfd)
    finally:
        os.close(dfd)
    return hashlib.sha256(raw).hexdigest()


def read_private(path):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, 'rb') as stream:
        info = os.fstat(stream.fileno())
        require(stat.S_ISREG(info.st_mode) and info.st_uid == os.getuid()
                and stat.S_IMODE(info.st_mode) == 0o600 and info.st_size <= 2 * 1024**2,
                'unsafe_evidence_file')
        return json.loads(stream.read())


def private_directory(path, fresh):
    if fresh:
        path.mkdir(mode=0o700)
    info = path.lstat()
    require(stat.S_ISDIR(info.st_mode) and info.st_uid == os.getuid()
            and stat.S_IMODE(info.st_mode) == 0o700, 'unsafe_private_directory')


def command(args, limit=16 * 1024**2):
    run = subprocess.run(args, capture_output=True, timeout=35)
    require(run.returncode == 0 and len(run.stdout) <= limit and len(run.stderr) <= 1024**2,
            'runtime_command_failed')
    return run.stdout


def runtime_profile():
    ids = command(['docker', 'ps', '-aq', '--no-trunc']).decode().split()
    require(len(ids) == len(set(ids)) == EXPECTED_CONTAINERS, 'unexpected_container_count')
    rows = json.loads(command(['docker', 'inspect', *ids]))
    require({r['Id'] for r in rows} == set(ids), 'incomplete_runtime_profile')
    cores = [r for r in rows if (r['Config'].get('Labels') or {}).get('com.docker.compose.project') == 'rr-portal'
             and (r['Config'].get('Labels') or {}).get('com.docker.compose.service') == 'core']
    require(len(cores) == 1 and cores[0]['State']['Running'] is True
            and cores[0]['State'].get('Health', {}).get('Status') == 'healthy', 'core_not_unique_healthy')
    # Raw inspect output is transient only: configuration/environment values never reach evidence or logs.
    safe = {r['Id']: {'image': r['Image'], 'configSHA256': digest(r['Config']),
                     'hostConfigSHA256': digest(r['HostConfig']),
                     'mountsSHA256': digest(sorted(r['Mounts'], key=encode)),
                     'pid': r['State']['Pid'], 'startedAt': r['State']['StartedAt'],
                     'status': r['State']['Status'], 'running': r['State']['Running'],
                     'paused': r['State'].get('Paused'), 'restarting': r['State'].get('Restarting'),
                     'dead': r['State'].get('Dead'), 'exitCode': r['State'].get('ExitCode'),
                     'oomKilled': r['State'].get('OOMKilled'), 'restarts': r['RestartCount'],
                     'health': r['State'].get('Health', {}).get('Status')} for r in rows}
    return {'containers': safe, 'coreId': cores[0]['Id'], 'count': len(safe)}


class Channel:
    def __init__(self, process):
        self.process = process
        self.buffer = b''
        self.selector = selectors.DefaultSelector()
        self.selector.register(process.stdout, selectors.EVENT_READ)

    def send(self, value):
        self.process.stdin.write(encode(value) + b'\n')
        self.process.stdin.flush()

    def receive(self):
        deadline = time.monotonic() + 45
        while b'\n' not in self.buffer:
            require(time.monotonic() < deadline, 'container_protocol_timeout')
            events = self.selector.select(max(0, deadline - time.monotonic()))
            require(bool(events), 'container_protocol_timeout')
            chunk = os.read(self.process.stdout.fileno(), 65536)
            require(bool(chunk), 'container_protocol_ended')
            self.buffer += chunk
            require(len(self.buffer) <= 1024**2, 'container_protocol_too_large')
        line, self.buffer = self.buffer.split(b'\n', 1)
        value = json.loads(line)
        require(type(value) is dict, 'bad_container_protocol')
        return value


def run_core(mode, cid, phase, diagnose=None):
    source = pathlib.Path(__file__).with_name('account_transaction.py').read_text()
    process = subprocess.Popen(['docker', 'exec', '-i', cid, 'python', '-B', '-c', source],
                               stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    channel = Channel(process)
    sent_commit_ack = False
    result = None
    try:
        payload = {'mode': mode, 'scopeSHA256': SCOPE_SHA256}
        if mode == 'maintain':
            payload.update(expectedSnapshotSHA256=digest(diagnose['snapshot']),
                           diagnoseSHA256=digest(diagnose), nonce=secrets.token_hex(32))
        channel.send(payload)
        event = channel.receive()
        if mode == 'maintain' and event.get('event') == 'backup':
            backup = event['backup']
            require(event['backupSHA256'] == digest(backup)
                    and backup['before'] == diagnose['snapshot'] and backup['scopeSHA256'] == SCOPE_SHA256
                    and backup['diagnoseSHA256'] == digest(diagnose) and backup['nonce'] == payload['nonce']
                    and backup['proposal'] == plan(backup['before']['public']), 'unexpected_backup')
            backup_hash = durable_write(phase / 'before-and-plan.private.json', backup)
            require(backup_hash == event['backupSHA256'], 'backup_digest_mismatch')
            durable_write(phase / 'backup-ack.private.json', {'backupSHA256': backup_hash,
                          'scopeSHA256': SCOPE_SHA256, 'nonce': payload['nonce']})
            channel.send({'event': 'backup_ack', 'backupSHA256': backup_hash,
                          'nonce': payload['nonce'], 'scopeSHA256': SCOPE_SHA256})
            event = channel.receive()
            if event.get('event') == 'prepared':
                prepared = event['prepared']
                require(event['preparedSHA256'] == digest(prepared)
                        and prepared['backupSHA256'] == backup_hash
                        and prepared['beforeSHA256'] == digest(backup['before'])
                        and prepared['nonce'] == payload['nonce'], 'unexpected_prepared')
                from account_transaction import check_after
                check_after(backup['before'], prepared['after'], backup['proposal'])
                require(prepared['proposal'] == backup['proposal']
                        and prepared['updateCount'] == int(backup['proposal']['changed']), 'unexpected_update_count')
                durable_write(phase / 'prepared.private.json', prepared)
                commit_ack = {'event': 'commit_ack', 'preparedSHA256': digest(prepared),
                              'backupSHA256': backup_hash, 'nonce': payload['nonce'], 'scopeSHA256': SCOPE_SHA256}
                durable_write(phase / 'commit-intent.private.json', commit_ack)
                # Runtime must still equal fresh diagnosis immediately before allowing COMMIT.
                require(runtime_profile() == diagnose['runtime'], 'runtime_changed_before_commit')
                sent_commit_ack = True
                channel.send(commit_ack)
                event = channel.receive()
        require(event.get('event') == 'result' and type(event.get('success')) is bool, 'missing_final_result')
        result = event
        durable_write(phase / 'container-result.private.json', result)
        process.stdin.close()
        code = process.wait(timeout=15)
        require(code == 0 if result['success'] else code != 0, 'unexpected_container_exit')
        return result
    except Exception:
        # Closing input before COMMIT ACK makes the transaction roll back. After the ACK, outcome is unknown.
        if not process.stdin.closed:
            process.stdin.close()
        if not sent_commit_ack:
            try:
                process.wait(timeout=12)
            except subprocess.TimeoutExpired:
                # No COMMIT ACK was sent; terminate only this docker-exec client, never a service container.
                process.terminate()
                process.wait(timeout=5)
        raise
    finally:
        channel.selector.close()


def summarize(snapshot):
    public = snapshot['public']
    return {'targetId': public['id'], 'username': public['username'], 'department': public['department'],
            'roleAdminPreserved': public['role'] == 'admin', 'active': public['is_active'],
            'capabilities': capabilities(public), 'snapshotSHA256': digest(snapshot),
            'nonAllowlistedSHA256': snapshot['nonAllowlistedSHA256']}


def wire(value):
    raw = encode(value)
    parts = [raw[i:i+900] for i in range(0, len(raw), 900)]
    digits = lambda h: [int(x, 16) for x in h]
    number = lambda n: digits(format(n, 'x'))
    h = hashlib.sha256(raw).hexdigest()
    for i, part in enumerate(parts, 1):
        print(json.dumps([0, number(i), number(len(parts)), number(len(raw)), digits(h), digits(part.hex())], separators=(',', ':')))
    print(json.dumps([1, number(len(parts)), number(len(raw)), digits(h)], separators=(',', ':')))


def main():
    mode = sys.argv[1] if len(sys.argv) == 2 else ''
    value = {'phase': mode, 'service': 'core', 'success': False, 'scopeSHA256': SCOPE_SHA256,
             'workflowInactive': True, 'rawPasswordOrPasswordHashReturned': False, 'passwordChangedByThisOperation': False,
             'configurationWrites': False, 'lifecycleWrites': False, 'sourceWrites': False,
             'accountWriteScope': 'users.id=1 only', 'mutationOutcome': 'not_attempted'}
    phase = None
    before = None
    stage = 'guard'
    try:
        require(EXECUTE is True and mode in MODES and os.environ.get('RELEASE_BRANCH') == BRANCH
                and os.environ.get('RELEASE_MODE') == mode and os.environ.get('RELEASE_ATTEMPT') == '1'
                and os.environ.get('ACCOUNT_SCOPE_SHA256') == SCOPE_SHA256, 'execution_guard')
        stage = 'private_phase'
        if not BASE.exists():
            BASE.mkdir(mode=0o700)
        private_directory(BASE, False)
        candidate_phase = BASE / (mode + '-attempt1')
        private_directory(candidate_phase, True)
        phase = candidate_phase
        durable_write(phase / 'intent.private.json', {'mode': mode, 'scope': SCOPE,
                      'scopeSHA256': SCOPE_SHA256, 'attempt': 1})
        stage = 'runtime_before'
        before = runtime_profile()
        durable_write(phase / 'runtime-before.private.json', before)
        diagnose = None
        if mode != 'diagnose':
            diagnose = read_private(BASE / 'diagnose-attempt1' / 'diagnose.private.json')
            require(digest(diagnose) == os.environ.get('ACCOUNT_DIAGNOSE_SHA256'), 'diagnose_pin_mismatch')
            require(diagnose['scopeSHA256'] == SCOPE_SHA256 and diagnose['runtime'] == before,
                    'stale_diagnose_runtime')
        stage = 'core_' + mode
        result = run_core(mode, before['coreId'], phase, diagnose)
        value['mutationOutcome'] = result['mutationOutcome']
        value['updateCount'] = result.get('updateCount', 0)
        require(result['success'], 'container_transaction_refused')
        stage = 'runtime_after'
        after = runtime_profile()
        durable_write(phase / 'runtime-after.private.json', after)
        value.update(all46RuntimeUnchanged=before == after,
                     coreRuntimeUnchanged=before['containers'][before['coreId']] == after['containers'].get(before['coreId']),
                     runtimeSHA256=digest(after), coreIdSHA256=digest(after['coreId']))
        require(before == after, 'runtime_changed')
        snapshot = result['snapshot']
        value.update(summarize(snapshot))
        if mode == 'diagnose':
            record = {'scopeSHA256': SCOPE_SHA256, 'snapshot': snapshot, 'runtime': after}
            pin = durable_write(phase / 'diagnose.private.json', record)
            proposal = plan(snapshot['public'])
            value.update(diagnoseSHA256=pin, oldDepartment=snapshot['public']['department'],
                         proposedDepartment=proposal['department'], grantsToAppend=proposal['appended'],
                         changeRequired=proposal['changed'], accountWrites=False)
        elif mode == 'maintain':
            backup = read_private(phase / 'before-and-plan.private.json')
            value.update(oldDepartment=backup['before']['public']['department'],
                         grantsAppended=backup['proposal']['appended'],
                         allExistingGrantsAndOrderPreserved=snapshot['public']['permissions'] == backup['proposal']['permissions'],
                         allOtherTargetFieldsPreserved=snapshot['nonAllowlistedSHA256'] == backup['before']['nonAllowlistedSHA256'],
                         backupSHA256=result['backupSHA256'], preparedSHA256=result['preparedSHA256'],
                         accountWrites=bool(result['updateCount']))
        else:
            maintain = BASE / 'maintain-attempt1'
            backup = read_private(maintain / 'before-and-plan.private.json')
            prepared_path = maintain / 'prepared.private.json'
            prepared = read_private(prepared_path) if prepared_path.exists() else None
            current_before = snapshot == backup['before']
            current_after = prepared is not None and snapshot == prepared['after']
            value.update(currentMatchesBefore=current_before, currentMatchesPreparedAfter=current_after,
                         accountWrites=False, automaticRetry=False, automaticRollback=False)
            if mode == 'verify':
                receipt = read_private(maintain / 'container-result.private.json')
                require(receipt['success'] and receipt['mutationOutcome'] in ('committed', 'committed_noop')
                        and current_after, 'verification_mismatch')
        value['success'] = True
    except Exception as exc:
        from account_transaction import Refusal
        value.update(errorType=type(exc).__name__, errorCode=str(exc) if isinstance(exc, Refusal) else 'redacted_failure', stage=stage)
        if phase is not None and (phase / 'commit-intent.private.json').exists() and value['mutationOutcome'] == 'not_attempted':
            value['mutationOutcome'] = 'unknown'
        if phase is not None and before is not None:
            try:
                failure_runtime = runtime_profile()
                durable_write(phase / 'runtime-failure.private.json', failure_runtime)
                value.update(all46RuntimeUnchanged=before == failure_runtime,
                             coreRuntimeUnchanged=before['containers'][before['coreId']] == failure_runtime['containers'].get(before['coreId']),
                             runtimeSHA256=digest(failure_runtime))
            except Exception:
                value['failureRuntimeProofUnavailable'] = True
        if phase is not None:
            try:
                durable_write(phase / 'failure.private.json', value)
            except Exception:
                pass
    value['resultSHA256'] = digest(value)
    if phase is not None:
        try:
            durable_write(phase / 'receipt.private.json', value)
        except Exception:
            value['success'] = False
            value.pop('resultSHA256', None)
            value.update(errorType='EvidenceWriteFailure', stage='receipt_write')
            value['resultSHA256'] = digest(value)
    wire(value)
    return 0 if value['success'] else 1


if __name__ == '__main__':
    sys.exit(main())
