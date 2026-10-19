"""DRAFT ONLY: original six failed records, private snapshot, read-only analysis.

No .env, IMAP/HTTP/API/session/credential access or business/container changes.
Only a new exclusive private evidence directory and SQLite backup are written.
"""
import collections
import hashlib
import json
import os
import pathlib
import re
import signal
import sqlite3
import subprocess
import time

ROOT = pathlib.Path('/opt/rr-portal')
BACKUP = ROOT / 'deploy/backups/voyageplex-mail-recovery-20261019-complete-v3'
OUTPUT = ROOT / 'deploy/backups/voyageplex-original-failed-audit-20261019'
BRANCH = 'refs/heads/ops/voyageplex-maildiag-20261019'
LIB_COMMIT = 'c94ea2e93f6ea81e24d409a188ff6fed31b35b07'
LIB_SHA = '59cec17eb70984e9b3b628c3c461f01cbf3358c1ffc46fe1c9a761a8c0d4b5ac'
SQL_PATH = 'deploy/ops/voyageplex-original-failed-audit.sql'
SQL_SHA = 'ea20cf46add894e685250fa763528b4fd3097ab5c2eb3b48c08af0f922d69e17'
RESULT_SHA = '9d39903386dfb6a7cc9b45e8ac6680b066cd292c9fa189f9f4141487c046e0d7'
SEAL_SHA = '503d90340baa23ceb49d66275541e05a615293ec019ea0521e8b026e82ade0d3'
OWNERS = (2, 3, 5, 6)
EXPECTED_COUNTS = {2: 2, 3: 2, 5: 2, 6: 0}
FAILURES = {'metadata', 'message_size', 'body_read', 'parse_memory', 'parse_timeout',
            'parse_result_size', 'parse_process', 'parse_cancelled',
            'all_business_attachments_unparseable', 'other'}
FLAGS = {'received_on_or_after_oct08', 'original_start_unchanged', 'stored_received_date_consistent',
         'identityMatching', 'originalTypedRowUnchanged', 'originalBatchTypedRowUnchanged', 'apiHandlingEligible'}
OPTIONAL_FLAGS = {'noSecondaryTaskReference', 'uidInOriginalEligibleCandidates', 'uidInCurrentEligibleCandidates'}


def require(condition):
    if not condition:
        raise ValueError()


def git_bytes(ref, path, cap):
    require(re.fullmatch('[a-f0-9]{40}', ref) is not None)
    value = subprocess.run(['git', '-C', str(ROOT), 'show', ref + ':' + path],
                           stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=10)
    require(value.returncode == 0 and len(value.stdout) <= cap)
    return value.stdout


def library():
    raw = git_bytes(LIB_COMMIT, 'deploy/ops/voyageplex-mail-recovery.py', 262144)
    require(hashlib.sha256(raw).hexdigest() == LIB_SHA)
    lib = {'__name__': 'reviewed_readonly_library'}
    exec(compile(raw, 'reviewed-recovery-library', 'exec'), lib)
    require(lib['BACKUP'] == BACKUP)
    return lib


def guards(lib):
    lib['prior_failure']()
    lib['verify_seal'](BACKUP)
    require(lib['file_sha'](BACKUP / 'first-result.json') == RESULT_SHA and
            lib['file_sha'](BACKUP / 'seal.json') == SEAL_SHA)
    result = lib['read_json'](BACKUP / 'first-result.json')
    require(result.get('mode') == 'backup' and result.get('backupComplete') is True and
            result.get('source') == '4932408a0375058b781b9a9c050d4eef65f8728b' and
            result.get('privateBackupId') == BACKUP.name)


def runtime_receipt(lib):
    # During deployment either container may briefly disappear/change. Capture
    # what was observed; HEAD is not a precondition or byte-source image proof.
    result = {'headAvailable': False, 'apiAvailable': False}
    try:
        head = lib['command'](['git', '-C', str(ROOT), 'rev-parse', 'HEAD'], seconds=5, cap=128).decode().strip()
        require(re.fullmatch('[a-f0-9]{40}', head) is not None)
        result.update({'headAvailable': True, 'head': head})
    except Exception:
        pass
    try:
        template = '{"id":{{json .Id}},"name":{{json .Name}},"image":{{json .Image}},"running":{{json .State.Running}}}'
        value = json.loads(lib['command'](['docker', 'inspect', '--format', template, 'rr-portal-voyageplex-api-1'],
                                          seconds=5, cap=4096))
        require(set(value) == {'id', 'name', 'image', 'running'} and
                re.fullmatch('[a-f0-9]{64}', value['id']) is not None and
                value['name'] == '/rr-portal-voyageplex-api-1' and
                re.fullmatch('sha256:[a-f0-9]{64}', value['image']) is not None and type(value['running']) is bool)
        result.update({'apiAvailable': True, 'apiContainerId': value['id'],
                       'apiImage': value['image'], 'apiRunning': value['running']})
    except Exception:
        pass
    return result


def row_hash(manifest, table, row_id, lib):
    target = manifest['tables'][table]
    require(target['keys'] == ['Id'])
    key = lib['encoded']([lib['typed'](row_id)]).decode()
    value = target['rows'].get(key)
    return value['sha256'] if value is not None else None


def original_candidates(value, validity):
    require(isinstance(value, dict) and value.get('complete') is True and
            type(value.get('uidValidity')) is int and value.get('uidValidity') == validity and
            value.get('failureType') is None and value.get('unknown') == [])
    items = value.get('eligible')
    require(isinstance(items, list) and len(items) <= 50000 and
            all(type(uid) is int and 0 < uid <= 4294967295 for uid in items) and items == sorted(set(items)))
    return json.dumps(items, separators=(',', ':'))


def parameters(lib, current_tables):
    baseline_tables = lib['read_json'](BACKUP / 'typed-tables.private.json')
    candidates = lib['read_json'](BACKUP / 'candidates.private.json')
    same, batch_same, private, params = {}, {}, [], {}
    with lib['connect'](BACKUP / 'baseline.sqlite3') as db:
        db.execute('BEGIN')
        rows = db.execute("SELECT Id,MailOwnerId,MailboxKey,ImportBatchId FROM ImportEmailItems "
                          "WHERE Company='Huadeng' AND MailOwnerId IN (2,3,5,6) AND Status='failed' AND MailboxKey<>'' "
                          "ORDER BY MailOwnerId,Id LIMIT 7").fetchall()
        require(len(rows) == 6 and dict(collections.Counter(row['MailOwnerId'] for row in rows)) ==
                {owner: count for owner, count in EXPECTED_COUNTS.items() if count})
        prefixes = {}
        for owner in OWNERS:
            state = db.execute('SELECT Address,MailboxIdentity,UidValidity FROM MailSyncStates WHERE Id=?', (1000 + owner,)).fetchone()
            user = db.execute('SELECT Username,MailboxAddress FROM Users WHERE Id=?', (owner,)).fetchone()
            require(state is not None and user is not None and
                    (user['Username'], user['MailboxAddress']) == lib['OWNERS'][owner] and
                    state['Address'] == user['MailboxAddress'] and
                    re.fullmatch('[A-F0-9]{64}', state['MailboxIdentity']) is not None and
                    type(state['UidValidity']) is int and 0 < state['UidValidity'] <= 4294967295)
            prefix = 'Huadeng:%d:%s:%s:%d:' % (owner, state['MailboxIdentity'], state['Address'], state['UidValidity'])
            prefixes[owner] = prefix
            params['p' + str(owner)] = prefix
            params['e' + str(owner)] = original_candidates(candidates[str(owner)], state['UidValidity'])
            # No fresh IMAP/network probe and no current candidate receipt was
            # authorized. Preserve unknown explicitly instead of inventing it.
            params['n' + str(owner)] = None
        for row in rows:
            item_id, owner, key, batch_id = row
            before = row_hash(baseline_tables, 'ImportEmailItems', item_id, lib)
            after = row_hash(current_tables, 'ImportEmailItems', item_id, lib)
            batch_before = row_hash(baseline_tables, 'ImportBatches', batch_id, lib)
            batch_after = row_hash(current_tables, 'ImportBatches', batch_id, lib)
            require(before is not None and batch_before is not None)
            same[str(item_id)] = before == after
            batch_same[str(item_id)] = batch_before == batch_after
            suffix = key[len(prefixes[owner]):] if key.startswith(prefixes[owner]) else ''
            uid = int(suffix) if re.fullmatch('[1-9][0-9]{0,9}', suffix) and int(suffix) <= 4294967295 else None
            private.append({'id': item_id, 'owner': owner, 'uid': uid, 'batchId': batch_id,
                            'beforeSHA256': before, 'currentSHA256': after,
                            'beforeBatchSHA256': batch_before, 'currentBatchSHA256': batch_after})
        db.rollback()
    params['same'] = json.dumps(same, separators=(',', ':'))
    params['batch_same'] = json.dumps(batch_same, separators=(',', ':'))
    return params, private, baseline_tables['schema'] == current_tables['schema']


def query(lib, sql, params):
    with lib['connect'](BACKUP / 'baseline.sqlite3') as db:
        uri = (OUTPUT / 'current.sqlite3').as_uri() + '?mode=ro&immutable=1'
        db.execute('ATTACH DATABASE ? AS current', (uri,))
        until = time.monotonic() + 15
        db.set_progress_handler(lambda: 1 if time.monotonic() > until else 0, 1000)
        db.execute('BEGIN')
        result = [dict(row) for row in db.execute(sql, params)]
        db.rollback()
    expected = {'owner', 'original_status', 'current_status', 'failureKind'} | FLAGS | OPTIONAL_FLAGS
    require(len(result) == 6 and dict(collections.Counter(row['owner'] for row in result)) ==
            {owner: count for owner, count in EXPECTED_COUNTS.items() if count})
    for row in result:
        require(set(row) == expected and row['original_status'] == 'failed' and row['failureKind'] in FAILURES and
                row['current_status'] in {'failed', 'pending', 'confirmed', 'duplicate', 'duplicate_confirmed', 'missing', 'other'})
        require(all(type(row[key]) is int and row[key] in (0, 1) for key in FLAGS))
        require(all(row[key] is None or type(row[key]) is int and row[key] in (0, 1) for key in OPTIONAL_FLAGS))
    return result


def main():
    require(os.environ.get('MAILDIAG_BRANCH') == BRANCH and os.environ.get('MAILDIAG_ATTEMPT') == '1')
    ref = os.environ.get('MAILDIAG_REF', '')
    sql = git_bytes(ref, SQL_PATH, 32768)
    require(hashlib.sha256(sql).hexdigest() == SQL_SHA)
    lib = library()
    guards(lib)
    os.umask(0o077)
    OUTPUT.mkdir(mode=0o700)  # Fixed, exclusive; an earlier attempt can never be replaced.
    result = {'readOnlyAudit': True, 'businessWrites': False, 'mailboxOrNetworkCalls': False,
              'runtimeBefore': runtime_receipt(lib), 'completed': False,
              'currentCandidateEvidenceAvailable': False, 'currentCandidateMemberIsUnknown': True,
              'retryAuthorizedByThisAudit': False, 'priorResultsPreserved': False}
    try:
        lib['write_new'](OUTPUT / 'source.private.json', {'ref': ref, 'sqlSHA256': SQL_SHA,
                                                        'libraryCommit': LIB_COMMIT, 'librarySHA256': LIB_SHA})
        destination = OUTPUT / 'current.sqlite3'
        with destination.open('xb'):
            pass
        destination.chmod(0o600)
        lib['write_new'](OUTPUT / 'sqlite-snapshot.private.json', lib['online_backup'](destination))
        current = lib['table_snapshot'](destination)
        lib['write_new'](OUTPUT / 'typed-tables.private.json', current)
        params, private, schema_same = parameters(lib, current)
        lib['write_new'](OUTPUT / 'original-six.private.json', private)
        rows = query(lib, sql.decode('utf-8'), params)
        result.update({'completed': True, 'databaseSchemaMatchesBaseline': schema_same,
                       'originalFailedCount': 6, 'observations': rows,
                       'potentiallyEligibleForSeparateReview': sum(all(row[key] == 1 for key in
                            FLAGS | {'noSecondaryTaskReference', 'uidInOriginalEligibleCandidates'}) for row in rows)})
    except Exception:
        result['safeFailure'] = 'REDACTED_ORIGINAL_FAILED_AUDIT_FAILURE'
    finally:
        result['runtimeAfter'] = runtime_receipt(lib)
        result['runtimeSnapshotStableDuringCapture'] = (result['runtimeBefore']['headAvailable'] and
                result['runtimeBefore']['apiAvailable'] and result['runtimeBefore'] == result['runtimeAfter'])
        try:
            guards(lib)
            result['priorResultsPreserved'] = True
        except Exception:
            result['completed'] = False
            result['safeFailure'] = 'ORIGINAL_SEALED_EVIDENCE_NOT_VERIFIED'
        lib['write_new'](OUTPUT / 'first-result.json', result)
        lib['seal'](OUTPUT)
        lib['emit'](result)
        lib['emit']({'kind': 'receipt', 'resultPath': str(OUTPUT / 'first-result.json'),
                     'resultSHA256': lib['file_sha'](OUTPUT / 'first-result.json'),
                     'sealSHA256': lib['file_sha'](OUTPUT / 'seal.json')})
    return 0 if result['completed'] else 1


if __name__ == '__main__':
    def interrupted(*_):
        raise TimeoutError()
    signal.signal(signal.SIGTERM, interrupted)
    try:
        raise SystemExit(main())
    except Exception:
        print('{"failed":true,"reason":"REDACTED_ORIGINAL_FAILED_AUDIT_SETUP_FAILURE","businessWrites":false}', flush=True)
        raise SystemExit(1)
