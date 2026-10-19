"""DRAFT: one SIGINT to the exact stalled recovery helper; never an app signal.

Requires separate root authorization and current stage evidence before dispatch.
No API/IMAP/database/configuration writes; only new private evidence is written.
"""
import hashlib
import json
import os
import pathlib
import re
import signal
import time
from datetime import datetime, timezone

ROOT = pathlib.Path('/opt/rr-portal')
RUN = ROOT / 'deploy/backups/voyageplex-mail-recovery-20261019-complete-v3-runs/recover-39201444781'
OUTPUT = ROOT / 'deploy/backups/voyageplex-controlled-sigint-39201444781-20261019'
SOURCE_SHA = 'a903ff10d5041b521808b022ed111aaf8bf22c196f0e547a8d713577f9063c9f'
EXPECTED_ENV = {'MAIL_RECOVERY_SHA': '8b3fd8e7a876e6669d7615f3a09748ef0e9ffddc',
                'MAIL_RECOVERY_BRANCH': 'refs/heads/ops/voyageplex-mail-recovery-20261019',
                'MAIL_RECOVERY_RUN_ID': '39201444781', 'MAIL_RECOVERY_ATTEMPT': '1', 'MAIL_RECOVERY_MODE': 'recover'}
DEADLINE = time.monotonic() + 120


def require(value):
    if not value: raise ValueError()


def read(path, cap):
    require(not path.is_symlink() and path.is_file())
    with path.open('rb') as source: value = source.read(cap + 1)
    require(len(value) <= cap)
    return value


def write_new(path, value):
    with path.open('xb') as out:
        out.write(json.dumps(value, sort_keys=True, separators=(',', ':')).encode()); out.flush(); os.fsync(out.fileno())
    path.chmod(0o600)


def start_ticks(proc):
    fields = read(proc / 'stat', 4096).rsplit(b')', 1)[1].split()
    require(fields[0] in {b'R', b'S', b'D'} and int(fields[19]) > 0)
    return int(fields[19])


def candidate(proc):
    before = start_ticks(proc)
    parts = read(proc / 'cmdline', 8192).split(b'\0')
    if parts[-1:] == [b'']: parts.pop()
    require(len(parts) == 3 and pathlib.PurePosixPath(parts[0].decode()).name == 'python3' and parts[2] == b'recover')
    source = pathlib.Path(parts[1].decode())
    require(re.fullmatch(r'/tmp/mail-recovery\.[A-Za-z0-9]{6}/run\.py', str(source)) is not None and
            not source.parent.is_symlink() and source.resolve() == source and hashlib.sha256(read(source, 262144)).hexdigest() == SOURCE_SHA)
    env = {}
    for item in read(proc / 'environ', 65536).split(b'\0'):
        key, separator, value = item.partition(b'=')
        if separator and key.decode('ascii', 'ignore') in EXPECTED_ENV:
            name = key.decode('ascii'); require(name not in env); env[name] = value.decode()
    require(env == EXPECTED_ENV and before == start_ticks(proc))
    values = dict(re.findall(r'^(SigIgn|SigCgt):\s+([0-9A-Fa-f]+)$', read(proc / 'status', 16384).decode(), re.M))
    require(set(values) == {'SigIgn', 'SigCgt'})
    return {'pid': int(proc.name), 'startTicks': before,
            'sigintExpected': not bool(int(values['SigIgn'], 16) & 2) and bool(int(values['SigCgt'], 16) & 2)}


def phase():
    attempts = RUN / 'retry-attempts'
    require(not RUN.is_symlink() and not attempts.is_symlink() and attempts.is_dir() and not (RUN / 'seal.json').exists())
    paths = list(attempts.iterdir()); require(len(paths) <= 5000)
    require(all(not item.is_symlink() and item.is_dir() and re.fullmatch('attempt-[0-9]{4}', item.name) for item in paths))
    require(all(not (item / 'seal.json').is_symlink() for item in paths))
    pending = [item for item in paths if not (item / 'seal.json').exists()]
    require(len(pending) == 1 and pending[0].name == 'attempt-0007')
    step = pending[0]; require(not (step / 'result.json').is_symlink() and not (step / 'result.json').exists())
    proofs = []
    for prefix in ['before', 'after']:
        db = step / (prefix + '.sqlite3'); metadata = step / (prefix + '-snapshot.private.json')
        raw = read(metadata, 2048); value = json.loads(raw)
        keys = {'startedAtUtc', 'finishedAtUtc', 'method', 'committedWALIncluded', 'transactionConsistentSQLiteSnapshot', 'integrityCheckOK'}
        require(set(value) == keys and value['method'] == 'SQLite-online-backup-API' and
                all(value[key] is True for key in keys - {'startedAtUtc', 'finishedAtUtc', 'method'}))
        dates = [datetime.fromisoformat(value[key].replace('Z', '+00:00')) for key in ['startedAtUtc', 'finishedAtUtc']]
        require(all(item.utcoffset() == timezone.utc.utcoffset(item) for item in dates) and dates[0] <= dates[1])
        require(not db.is_symlink() and db.is_file())
        with db.open('rb') as source: require(source.read(16) == b'SQLite format 3\0')
        for suffix in ['-wal', '-shm', '-journal']:
            member = db.with_name(db.name + suffix)
            require(not member.is_symlink() and (not member.exists() or member.stat().st_size == 0))
        stat = db.stat(); proofs.append((hashlib.sha256(raw).hexdigest(), stat.st_ino, stat.st_size, stat.st_mtime_ns))
    return proofs


def parent_receipt():
    seal, result = RUN / 'seal.json', RUN / 'first-result.json'
    if not seal.exists() or not result.exists(): return {'parentSealPresent': False}
    try:
        seal_bytes, result_bytes = read(seal, 4 * 1024**2), read(result, 4 * 1024**2)
        manifest = json.loads(seal_bytes)
        bound = isinstance(manifest, dict) and manifest.get('first-result.json') == hashlib.sha256(result_bytes).hexdigest()
        return {'parentSealPresent': True, 'parentReceiptBoundToSeal': bound,
                'parentResultSHA256': hashlib.sha256(result_bytes).hexdigest(),
                'parentSealSHA256': hashlib.sha256(seal_bytes).hexdigest(), 'fullParentArchiveVerified': False}
    except (OSError, ValueError): return {'parentSealPresent': False}


def discover():
    matches, complete = [], False
    for index, proc in enumerate(pathlib.Path('/proc').iterdir()):
        if index >= 4096 or time.monotonic() >= DEADLINE - 95: break
        if not proc.name.isdigit(): continue
        try: matches.append(candidate(proc))
        except (OSError, ValueError, KeyError, UnicodeError, IndexError): pass
    else: complete = True
    return matches, complete


def main():
    require(os.environ.get('MAILDIAG_BRANCH') == 'refs/heads/ops/voyageplex-maildiag-20261019' and
            os.environ.get('MAILDIAG_ATTEMPT') == '1' and re.fullmatch('[a-f0-9]{40}', os.environ.get('MAILDIAG_REF', '')))
    os.umask(0o077); OUTPUT.mkdir(mode=0o700)
    result = {'signalSent': False, 'matchingHelpers': 0, 'stageConfirmed': False, 'sigintExpected': False,
              'onlyOneSIGINTAuthorized': True, 'applicationSignals': False, 'businessWrites': False, 'pending': False}
    try:
        matches, complete = discover()
        result['processScanComplete'] = complete
        result['matchingHelpers'] = len(matches)
        require(complete and len(matches) == 1)
        original = matches[0]; result['sigintExpected'] = original['sigintExpected']
        require(original['sigintExpected'])
        proof = phase(); result['stageConfirmed'] = True
        write_new(OUTPUT / 'target.private.json', original)
        # Recheck identity, handler, all snapshot stamps and absence of result
        # immediately before signalling. No PID/group or signal escalation path.
        require(candidate(pathlib.Path('/proc') / str(original['pid'])) == original and phase() == proof)
        require(start_ticks(pathlib.Path('/proc') / str(original['pid'])) == original['startTicks'])
        os.kill(original['pid'], signal.SIGINT)
        result['signalSent'] = True
        until = min(DEADLINE - 5, time.monotonic() + 90)
        while time.monotonic() < until:
            receipt = parent_receipt()
            if receipt.get('parentReceiptBoundToSeal'):
                result.update(receipt); break
            time.sleep(.5)
        else:
            result.update(parent_receipt()); result['pending'] = True
    except Exception:
        result['safeFailure'] = 'CONTROLLED_SIGNAL_PRECONDITION_OR_OBSERVATION_NOT_SATISFIED'
        result['pending'] = bool(result['signalSent'])
    finally:
        write_new(OUTPUT / 'first-result.json', result)
        seal = {path.name: hashlib.sha256(read(path, 65536)).hexdigest() for path in OUTPUT.iterdir()}
        write_new(OUTPUT / 'seal.json', seal)
        print(json.dumps(result, separators=(',', ':')), flush=True)
        print(json.dumps({'kind': 'receipt', 'resultSHA256': seal['first-result.json'],
                          'sealSHA256': hashlib.sha256(read(OUTPUT / 'seal.json', 65536)).hexdigest()}, separators=(',', ':')), flush=True)


if __name__ == '__main__':
    try: main()
    except Exception:
        print('{"signalSent":false,"safeFailure":"CONTROLLED_SIGNAL_SETUP_REFUSED"}', flush=True)
        raise SystemExit(1)
