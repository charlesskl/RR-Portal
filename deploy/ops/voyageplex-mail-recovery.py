"""LOCAL DRAFT: private backup, bounded authorized catch-up, independent audit.

Not executable until the reviewed source/artifact pins below are frozen. Never
restore, restart, change settings/roles, reset a cursor, or print mail/credentials.
Each manually dispatched continuation retains a separate immutable receipt.
"""
import base64
import collections
import contextlib
import datetime as dt
import hashlib
import ipaddress
import json
import os
import pathlib
import re
import secrets
import select
import shutil
import signal
import sqlite3
import stat
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

os.umask(0o077)
ROOT = pathlib.Path('/opt/rr-portal')
APP = pathlib.Path('apps/船务部/VoyagePlex船务协同系统')
DATA = ROOT / APP / 'data-runtime'
DB = DATA / 'voyageplex.db'
FIRST_BACKUP = ROOT / 'deploy/backups/voyageplex-mail-recovery-20261019'
FIRST_RESULT_SHA256 = '5c90d5251fbb212364dee9b1059fb6d76feafd617cce576bb0254bc389b442a5'
FIRST_SEAL_SHA256 = 'c9af2383c41e4bf0652a02c13c39480f4d35d65bedb18b7ffa1ee35e1baa639c'
SECOND_BACKUP = ROOT / 'deploy/backups/voyageplex-mail-recovery-20261019-complete-v2'
SECOND_RESULT_SHA256 = '53b23b3ee4a877d944a790495626e2856dca54156c6e6b88a1998e8f99f7b8c9'
SECOND_SEAL_SHA256 = 'eb4e551634673c28a1ea3a351ff4cc2205ea58e342b6f6e05f838aaf5bb5e6fa'
BACKUP = ROOT / 'deploy/backups/voyageplex-mail-recovery-20261019-complete-v3'
RUNS = BACKUP.with_name(BACKUP.name + '-runs')
BRANCH = 'refs/heads/ops/voyageplex-mail-recovery-20261019'
BASE = '4932408a0375058b781b9a9c050d4eef65f8728b'
KEY = 'VOYAGEPLEX_HUADENG_MAILBOXES_JSON'
OWNERS = {2: ('tan123', 'lisa666tan@163.com'), 3: ('秦湘柳', 'hyt9833@163.com'),
          5: ('莫秀珍', '13768947334@163.com'), 6: ('麦淳恩', '13471221956@163.com')}
ADMIN = 2
# Root freezes these only after the final independent application review/build.
FINAL_PIN_FROZEN = True
SECONDARY_TASK_API_GUARD_PIN_FROZEN = True
SECONDARY_GUARD_PREVIOUS_RUN = RUNS/'recover-39201444781'
PARTIAL_RECONCILIATION = ROOT/'deploy/backups/voyageplex-partial-run-39201444781-reconciliation-20261019'
PARTIAL_RECONCILIATION_RESULT_SHA256 = '4425c4fcd1521c1dc2cf0acfbf485289c50448cec9d90a2f9a1b260b27179fe4'  # Freeze only the separately reviewed failed-partial reconciliation.
PARTIAL_RECONCILIATION_SEAL_SHA256 = '8d8971d9f4f2167b904d2d88408f8301ada44eec983ca6b6c8c5e277e9ec052d'
_PARTIAL_VERIFICATION = None
DEPLOYED_HEAD = 'f853c7a2ec47f3cff11e456f874218d2324ad217'
SOURCE_FILES = {
    "apps/\u8239\u52a1\u90e8/VoyagePlex\u8239\u52a1\u534f\u540c\u7cfb\u7edf/server/VoyagePlex.Api/Program.cs": "7c0f70a9be50529362ae1922e685d535be9279e6d54d706b27a890fd18f2d76e",
    "apps/\u8239\u52a1\u90e8/VoyagePlex\u8239\u52a1\u534f\u540c\u7cfb\u7edf/server/VoyagePlex.Api/Services/MailboxSyncService.cs": "1bc773ea8ffccfad8b000c9e0997d7e57e88528f4060d8a5bbfe0c67bc0ec432",
    "apps/\u8239\u52a1\u90e8/VoyagePlex\u8239\u52a1\u534f\u540c\u7cfb\u7edf/server/VoyagePlex.Api/Services/EmailParserClient.cs": "b226f830b65d061c29da996b7384a7597d89f0cf36a1eb8f3d9d970dbfdd8824",
    "apps/\u8239\u52a1\u90e8/VoyagePlex\u8239\u52a1\u534f\u540c\u7cfb\u7edf/server/VoyagePlex.Api/Services/ServerMailboxConfiguration.cs": "24985cac1ea3e80b3f23e51f0926f0c3372123a1590ba93087d30265870b55a4",
    "apps/\u8239\u52a1\u90e8/VoyagePlex\u8239\u52a1\u534f\u540c\u7cfb\u7edf/server/VoyagePlex.Api/Data/AppDbContext.cs": "d1ecb504b20d431a4a229b32757a47f99e6efd859011d5c714fdec0100547f00",
    "apps/\u8239\u52a1\u90e8/VoyagePlex\u8239\u52a1\u534f\u540c\u7cfb\u7edf/server/VoyagePlex.Api/VoyagePlex.Api.csproj": "faf8094592160f6a187a9eef395031ff70c68ac2a13ad4b0c6f5f9b6c5ccb313",
    "apps/\u8239\u52a1\u90e8/VoyagePlex\u8239\u52a1\u534f\u540c\u7cfb\u7edf/Dockerfile.api": "6dea36116bdffd3ae8fdb6d39050786b4ac89b2c2620738c264df7035fc017a9",
    "apps/\u8239\u52a1\u90e8/VoyagePlex\u8239\u52a1\u534f\u540c\u7cfb\u7edf/services/email-parser/app/main.py": "a77bada52192c5d66a9709bb4363bb96dbce869e922f70b8a59d3ff67da7d7f5",
    "apps/\u8239\u52a1\u90e8/VoyagePlex\u8239\u52a1\u534f\u540c\u7cfb\u7edf/services/email-parser/app/mailbox.py": "4707664cb2a158c76f5df639972b3d7c475cead0f1297d0b8c52b125dbed267e",
    "apps/\u8239\u52a1\u90e8/VoyagePlex\u8239\u52a1\u534f\u540c\u7cfb\u7edf/services/email-parser/app/mail_worker.py": "ad1f81f485198261b5625e1f96b7017644624dd80ba65d4011f65ac558b21d7e",
    "apps/\u8239\u52a1\u90e8/VoyagePlex\u8239\u52a1\u534f\u540c\u7cfb\u7edf/services/email-parser/requirements.txt": "a4c21a5b044539deec682a8a98c37ae97b953a344ea8a5bb659ba32454966daa",
    "apps/\u8239\u52a1\u90e8/VoyagePlex\u8239\u52a1\u534f\u540c\u7cfb\u7edf/services/email-parser/Dockerfile": "098b11980f4589e84d25d9691a97ba2676c0bc27c337e3cd74d97cefb74918b9",
    "apps/\u8239\u52a1\u90e8/VoyagePlex\u8239\u52a1\u534f\u540c\u7cfb\u7edf/services/email-parser/app/eml.py": "72a1d04812db00f8ba78a8ce5deb9ac49e60b89cadd81a8f8f44cf8eb94aca28",
    "apps/\u8239\u52a1\u90e8/VoyagePlex\u8239\u52a1\u534f\u540c\u7cfb\u7edf/services/email-parser/app/attachments.py": "6a89728651cc4bb94d91ff44d92aef5a8fa0df32e034139584db7ee6a1e40bfb",
    "apps/\u8239\u52a1\u90e8/VoyagePlex\u8239\u52a1\u534f\u540c\u7cfb\u7edf/services/email-parser/app/factory_workbook.py": "5abfac2c34798bb7184a41efb1387bbe26be275bea4e2d8ceec853737a473723",
    "apps/\u8239\u52a1\u90e8/VoyagePlex\u8239\u52a1\u534f\u540c\u7cfb\u7edf/services/email-parser/app/product_workbook.py": "059b21360bca7fbabd9e48602ff22a6ee73bfd854d5f7e534c9d571d82190b5a",
    "apps/\u8239\u52a1\u90e8/VoyagePlex\u8239\u52a1\u534f\u540c\u7cfb\u7edf/services/email-parser/app/readonly_workbook.py": "76a8da4c34a6a8f04fa95e6e86cb38cbe1a618c9ef82f9bcadf4a726e7006602",
    "apps/\u8239\u52a1\u90e8/VoyagePlex\u8239\u52a1\u534f\u540c\u7cfb\u7edf/services/email-parser/app/spreadsheets.py": "173eb4fc2fa82519834f5f74958e1df900933ecccde4b21f4879284341dd5d89"
}
PARSER_FILES = {
    "/app/app/main.py": "a77bada52192c5d66a9709bb4363bb96dbce869e922f70b8a59d3ff67da7d7f5",
    "/app/app/mailbox.py": "4707664cb2a158c76f5df639972b3d7c475cead0f1297d0b8c52b125dbed267e",
    "/app/app/mail_worker.py": "ad1f81f485198261b5625e1f96b7017644624dd80ba65d4011f65ac558b21d7e",
    "/app/app/eml.py": "72a1d04812db00f8ba78a8ce5deb9ac49e60b89cadd81a8f8f44cf8eb94aca28",
    "/app/app/attachments.py": "6a89728651cc4bb94d91ff44d92aef5a8fa0df32e034139584db7ee6a1e40bfb",
    "/app/app/factory_workbook.py": "5abfac2c34798bb7184a41efb1387bbe26be275bea4e2d8ceec853737a473723",
    "/app/app/product_workbook.py": "059b21360bca7fbabd9e48602ff22a6ee73bfd854d5f7e534c9d571d82190b5a",
    "/app/app/readonly_workbook.py": "76a8da4c34a6a8f04fa95e6e86cb38cbe1a618c9ef82f9bcadf4a726e7006602",
    "/app/app/spreadsheets.py": "173eb4fc2fa82519834f5f74958e1df900933ecccde4b21f4879284341dd5d89"
}
API_DLL_SHA256 = ''  # optional independent reviewed artifact; absent is explicitly not byte-source proof
EXPECTED_LIMITS = {'voyageplex-api': 768 * 1024**2, 'voyageplex-parser': 512 * 1024**2,
                   'voyageplex-web': 1024**3}
COMPLETED_BACKUP_RESULT_SHA256 = '9d39903386dfb6a7cc9b45e8ac6680b066cd292c9fa189f9f4141487c046e0d7'
COMPLETED_BACKUP_SEAL_SHA256 = '503d90340baa23ceb49d66275541e05a615293ec019ea0521e8b026e82ade0d3'
MAX_RUNS = 64
SAFE_CODES = set()


class CheckError(Exception):
    pass


def require(condition, code):
    SAFE_CODES.add(code)
    if not condition:
        raise CheckError(code)


def encoded(value):
    return json.dumps(value, ensure_ascii=True, sort_keys=True, separators=(',', ':')).encode()


def sha(value):
    return hashlib.sha256(value).hexdigest()


def file_sha(path):
    digest = hashlib.sha256()
    with path.open('rb') as source:
        for block in iter(lambda: source.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def write_new(path, value):
    with path.open('xb') as out:
        out.write(encoded(value))
        out.flush()
        os.fsync(out.fileno())
    path.chmod(0o600)


def read_json(path):
    require(not path.is_symlink() and path.is_file(), 'PRIVATE_FILE_REQUIRED')
    return json.loads(path.read_bytes())


def emit(value):
    # Safe result schema only; large receipts are independently reassemblable.
    raw = encoded(value)
    if len(raw) <= 5800:
        print(raw.decode(), flush=True)
        return
    data = base64.b64encode(raw).decode()
    digest = sha(raw)
    parts = [data[i:i + 4800] for i in range(0, len(data), 4800)]
    for i, part in enumerate(parts):
        print(encoded({'kind': 'result-part', 'sha256': digest, 'index': i,
                       'count': len(parts), 'base64': part}).decode(), flush=True)


def command(args, seconds=30, cap=524288, stdin=None):
    """Private bounded streams. Only a diagnostic CLI client may be terminated."""
    end = time.monotonic() + seconds
    require(stdin is None or len(stdin) <= 16384, 'COMMAND_INPUT_LIMIT')
    process = subprocess.Popen(args, stdin=subprocess.PIPE if stdin is not None else subprocess.DEVNULL,
                               stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    buffers = {process.stdout: bytearray(), process.stderr: bytearray()}
    try:
        if stdin is not None:
            process.stdin.write(stdin)
            process.stdin.close()
        active = set(buffers)
        while active:
            remaining = end - time.monotonic()
            require(remaining > 0, 'COMMAND_TIMEOUT')
            ready, _, _ = select.select(list(active), [], [], remaining)
            require(bool(ready), 'COMMAND_TIMEOUT')
            for stream in ready:
                block = os.read(stream.fileno(), min(65536, cap - len(buffers[stream]) + 1))
                if not block:
                    active.remove(stream)
                else:
                    buffers[stream].extend(block)
                    require(len(buffers[stream]) <= cap, 'COMMAND_OUTPUT_LIMIT')
        process.wait(timeout=max(.1, end - time.monotonic()))
        require(process.returncode == 0, 'COMMAND_FAILED')
        return bytes(buffers[process.stdout])
    finally:
        if process.poll() is None:
            process.kill()
        process.wait(timeout=3)
        for stream in buffers:
            stream.close()
        if process.stdin is not None and not process.stdin.closed:
            process.stdin.close()


def connect(path=DB, writable=False):
    require(not path.is_symlink() and stat.S_ISREG(path.stat().st_mode), 'REGULAR_DATABASE_REQUIRED')
    # Non-live paths here are completed private online-backup copies, never a
    # live database. immutable avoids WAL/SHM creation when reading those copies.
    suffix = '?mode=rw' if writable else '?mode=ro' if path == DB else '?mode=ro&immutable=1'
    db = sqlite3.connect(path.as_uri() + suffix, uri=True, timeout=10)
    db.row_factory = sqlite3.Row
    if not writable:
        db.execute('PRAGMA query_only=ON')
    return contextlib.closing(db)


def q(name):
    return '"' + name.replace('"', '""') + '"'


def typed(value):
    if value is None:
        return ['null', None]
    if isinstance(value, bytes):
        return ['blob', base64.b64encode(value).decode()]
    if type(value) is int:
        return ['integer', str(value)]
    if type(value) is float:
        return ['real', value.hex()]
    return ['text', value]


def table_snapshot(path):
    """Full typed row hashes, primary keys and projected hashes remain private."""
    result = {}
    with connect(path) as db:
        db.execute('BEGIN')
        schema = [list(row) for row in db.execute(
            "SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name")]
        for (name,) in db.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").fetchall():
            info = list(db.execute('PRAGMA table_info(' + q(name) + ')'))
            columns = [row['name'] for row in info]
            keys = [row['name'] for row in sorted(info, key=lambda row: row['pk']) if row['pk']]
            rows = {}
            for row in db.execute('SELECT * FROM ' + q(name)):
                values = {column: typed(row[column]) for column in columns}
                key = encoded([values[column] for column in keys]).decode() if keys else sha(encoded(values))
                require(key not in rows, 'UNIQUE_TYPED_ROW_KEYS_REQUIRED')
                projected = {k: v for k, v in values.items() if k not in {'MessageCount', 'UpdatedAt'}}
                rows[key] = {'sha256': sha(encoded(values)), 'stableContactSHA256': sha(encoded(projected)),
                             'company': row['Company'] if 'Company' in columns else None,
                             'owner': row['MailOwnerId'] if 'MailOwnerId' in columns else None,
                             'status': row['Status'] if name == 'ImportEmailItems' else None,
                             'mailboxItem': bool(row['MailboxKey']) if name == 'ImportEmailItems' else None}
            result[name] = {'columns': columns, 'keys': keys, 'rows': rows}
        db.rollback()
    return {'schema': schema, 'tables': result}


def online_backup(destination):
    started = dt.datetime.now(dt.timezone.utc).isoformat()
    end = time.monotonic() + 120
    def progress(*_):
        require(time.monotonic() < end, 'SQLITE_BACKUP_TIMEOUT')
    with connect() as source, contextlib.closing(sqlite3.connect(destination)) as target:
        source.backup(target, pages=128, progress=progress, sleep=.02)
    destination.chmod(0o600)
    with connect(destination) as check:
        require(check.execute('PRAGMA integrity_check').fetchone()[0] == 'ok', 'SQLITE_INTEGRITY_CHECK')
    return {'startedAtUtc': started, 'finishedAtUtc': dt.datetime.now(dt.timezone.utc).isoformat(),
            'method': 'SQLite-online-backup-API', 'committedWALIncluded': True,
            'transactionConsistentSQLiteSnapshot': True, 'integrityCheckOK': True}


def file_manifest(directory):
    files = {}
    for path in sorted(directory.rglob('*')):
        require(not path.is_symlink(), 'SYMLINKS_FORBIDDEN')
        if path.is_dir():
            continue
        require(path.is_file(), 'SPECIAL_FILES_FORBIDDEN')
        files[path.relative_to(directory).as_posix()] = file_sha(path)
    return files


def seal(directory):
    write_new(directory / 'seal.json', file_manifest(directory))


def verify_seal(directory):
    expected = read_json(directory / 'seal.json')
    actual = file_manifest(directory)
    actual.pop('seal.json', None)
    require(actual == expected, 'SEALED_RESULT_OR_BACKUP_CHANGED')


def prior_failure():
    verify_seal(FIRST_BACKUP)
    require(file_sha(FIRST_BACKUP / 'first-result.json') == FIRST_RESULT_SHA256 and
            file_sha(FIRST_BACKUP / 'seal.json') == FIRST_SEAL_SHA256, 'EXACT_ORIGINAL_FAILURE_RECEIPT_REQUIRED')
    result = read_json(FIRST_BACKUP / 'first-result.json')
    require(result.get('mode') == 'backup' and result.get('failed') is True and
            result.get('failedCheck') == 'UNEXPECTED_ADDITIONAL_SQLITE_DATABASE', 'EXPECTED_ORIGINAL_BACKUP_FAILURE_REQUIRED')
    verify_seal(SECOND_BACKUP)
    require(file_sha(SECOND_BACKUP / 'first-result.json') == SECOND_RESULT_SHA256 and
            file_sha(SECOND_BACKUP / 'seal.json') == SECOND_SEAL_SHA256, 'EXACT_SECOND_FAILURE_RECEIPT_REQUIRED')
    second = read_json(SECOND_BACKUP / 'first-result.json')
    require(second.get('mode') == 'backup' and second.get('failed') is True and
            second.get('failedCheck') == 'HISTORICAL_SQLITE_LIVE_COMPANION_FORBIDDEN', 'EXPECTED_SECOND_BACKUP_FAILURE_REQUIRED')
    return [{'resultPath': str(FIRST_BACKUP / 'first-result.json'), 'resultSHA256': FIRST_RESULT_SHA256,
             'sealSHA256': FIRST_SEAL_SHA256, 'failedCheck': 'UNEXPECTED_ADDITIONAL_SQLITE_DATABASE', 'preserved': True},
            {'resultPath': str(SECOND_BACKUP / 'first-result.json'), 'resultSHA256': SECOND_RESULT_SHA256,
             'sealSHA256': SECOND_SEAL_SHA256, 'failedCheck': 'HISTORICAL_SQLITE_LIVE_COMPANION_FORBIDDEN', 'preserved': True}]


HISTORICAL_NAME = r'voyageplex\.db\.before-(company|daily-mail|personal-mail)-([0-9]{14})-[a-f0-9]{32}\.db'


def historical_set(path):
    """Hash/stat the entire exact DB + optional WAL/SHM/journal set, without opening SQLite."""
    result = {}
    for suffix in ['', '-wal', '-shm', '-journal']:
        member = path.with_name(path.name + suffix)
        require(not member.is_symlink(), 'HISTORICAL_SQLITE_SYMLINK_FORBIDDEN')
        if not member.exists():
            require(bool(suffix), 'HISTORICAL_DATABASE_REQUIRED')
            continue
        before = member.stat()
        require(stat.S_ISREG(before.st_mode), 'HISTORICAL_SQLITE_REGULAR_FILES_REQUIRED')
        require(before.st_size <= 10 * 1024**3, 'HISTORICAL_SQLITE_MEMBER_BOUND')
        digest = file_sha(member)
        after = member.stat()
        stamp = lambda value: (value.st_ino, value.st_size, value.st_mtime_ns, value.st_ctime_ns,
                               stat.S_IMODE(value.st_mode), value.st_uid, value.st_gid)
        require(stamp(before) == stamp(after), 'HISTORICAL_SQLITE_SET_CHANGED')
        result[member.name] = {'stamp': list(stamp(before)), 'sha256': digest}
    require(sum(value['stamp'][1] for value in result.values()) <= 20 * 1024**3,
            'HISTORICAL_SQLITE_SET_BOUND')
    # Detect companions appearing/disappearing while individual members were read.
    actual = {path.with_name(path.name + suffix).name for suffix in ['', '-wal', '-shm', '-journal']
              if path.with_name(path.name + suffix).exists() or path.with_name(path.name + suffix).is_symlink()}
    require(set(result) == actual, 'HISTORICAL_SQLITE_SET_CHANGED')
    return result


def copy_historical_set(path, destination):
    before = historical_set(path)
    for name in before:
        shutil.copyfile(path.with_name(name), destination / name)
        (destination / name).chmod(0o600)
        require(file_sha(destination / name) == before[name]['sha256'], 'HISTORICAL_SQLITE_COPY_HASH_MISMATCH')
    require(historical_set(path) == before, 'HISTORICAL_SQLITE_SET_CHANGED')
    # SQLite may alter SHM locks/reader marks even in normal read-only mode.
    # Open only an expendable duplicate, never the retained raw backup.
    with tempfile.TemporaryDirectory(prefix='history-wal-validation-', dir=destination.parent) as temp:
        validation = pathlib.Path(temp)
        for name in before:
            shutil.copyfile(destination / name, validation / name)
        until = time.monotonic() + 30
        with contextlib.closing(sqlite3.connect((validation / path.name).as_uri() + '?mode=ro', uri=True, timeout=5)) as copied:
            copied.execute('PRAGMA query_only=ON')
            copied.set_progress_handler(lambda: 1 if time.monotonic() > until else 0, 1000)
            require(copied.execute('PRAGMA integrity_check').fetchall() == [('ok',)], 'HISTORICAL_SQLITE_WAL_INTEGRITY_CHECK')
            counts = {name: copied.execute('SELECT COUNT(*) FROM ' + q(name)).fetchone()[0]
                      for (name,) in copied.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()}
    require(historical_set(path) == before, 'HISTORICAL_SQLITE_SET_CHANGED')
    require(all(file_sha(destination / name) == value['sha256'] for name, value in before.items()),
            'RETAINED_HISTORICAL_RAW_SET_UNCHANGED')
    result = {}
    for name, value in before.items():
        stamp = value['stamp']
        result[name] = {'mode': stamp[4], 'uid': stamp[5], 'gid': stamp[6], 'size': stamp[1],
                        'mtimeNs': stamp[2], 'kind': 'file', 'sha256': value['sha256'],
                        'historicalSQLiteRawSetMember': True}
    result[path.name].update({'historicalSQLiteIndividuallyVerified': True,
                             'historicalSQLiteValidationMode': 'separate-duplicate-normal-ro-with-WAL',
                             'historicalSQLiteLogicalTableCounts': counts,
                             'historicalSQLiteCompanionCount': len(before) - 1})
    return result


def backup_files(destination):
    """SQLite logical snapshot replaces its live DB/WAL/SHM originals; all other files copied."""
    require(DATA.resolve() == DATA and DATA.is_dir(), 'FIXED_DATA_DIRECTORY_REQUIRED')
    destination.mkdir(mode=0o700)
    metadata = {}
    companions = {'voyageplex.db', 'voyageplex.db-wal', 'voyageplex.db-shm', 'voyageplex.db-journal'}
    count = total = 0
    for path in sorted(DATA.rglob('*')):
        require(not path.is_symlink(), 'DATA_SYMLINK_FORBIDDEN')
        rel = path.relative_to(DATA)
        if rel.as_posix() in metadata:
            continue  # A historical group already copied this exact companion.
        before = path.stat()
        require(stat.S_ISREG(before.st_mode) or stat.S_ISDIR(before.st_mode), 'DATA_SPECIAL_FILE_FORBIDDEN')
        metadata[rel.as_posix()] = {'mode': stat.S_IMODE(before.st_mode), 'uid': before.st_uid,
                                   'gid': before.st_gid, 'size': before.st_size, 'mtimeNs': before.st_mtime_ns,
                                   'kind': 'directory' if path.is_dir() else 'sqlite-companion' if rel.as_posix() in companions else 'file'}
        if path.is_dir():
            (destination / rel).mkdir(mode=0o700)
            continue
        if rel.as_posix() in companions:
            continue
        count += 1
        total += before.st_size
        require(count <= 100000 and total <= 20 * 1024**3, 'DATA_BACKUP_BOUND')
        historical = re.fullmatch(HISTORICAL_NAME, rel.as_posix())
        require(re.fullmatch(HISTORICAL_NAME + r'-(wal|shm|journal)', rel.as_posix()) is None,
                'ORPHAN_HISTORICAL_SQLITE_COMPANION_FORBIDDEN')
        if historical:
            # Only the three exact application-generated top-level name shapes.
            require(dt.datetime.strptime(historical[2], '%Y%m%d%H%M%S').strftime('%Y%m%d%H%M%S') == historical[2],
                    'VALID_HISTORICAL_SQLITE_TIMESTAMP_REQUIRED')
        with path.open('rb') as source:
            is_sqlite = source.read(16) == b'SQLite format 3\x00'
            require(not is_sqlite or historical is not None, 'UNEXPECTED_ADDITIONAL_SQLITE_DATABASE')
            require(not historical or is_sqlite, 'HISTORICAL_SQLITE_HEADER_REQUIRED')
        if historical:
            group = copy_historical_set(path, destination)
            count += len(group) - 1
            total += sum(item['size'] for item in group.values()) - before.st_size
            require(count <= 100000 and total <= 20 * 1024**3, 'DATA_BACKUP_BOUND')
            metadata.update(group)
            continue
        (destination / rel).parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        shutil.copyfile(path, destination / rel)
        (destination / rel).chmod(0o600)
        after = path.stat()
        require((before.st_ino, before.st_size, before.st_mtime_ns) ==
                (after.st_ino, after.st_size, after.st_mtime_ns), 'FILE_CHANGED_DURING_COPY')
        metadata[rel.as_posix()]['sha256'] = file_sha(destination / rel)
        require(metadata[rel.as_posix()]['sha256'] == file_sha(path), 'FILE_COPY_HASH_MISMATCH')
        final = path.stat()
        require((before.st_ino, before.st_size, before.st_mtime_ns) ==
                (final.st_ino, final.st_size, final.st_mtime_ns), 'FILE_CHANGED_DURING_COPY')
    return metadata


def runtime():
    private, safe = {}, {}
    for service in EXPECTED_LIMITS:
        value = json.loads(command(['docker', 'inspect', 'rr-portal-' + service + '-1']))[0]
        labels = value['Config'].get('Labels') or {}
        require(value['Name'] == '/rr-portal-' + service + '-1' and
                labels.get('com.docker.compose.project') == 'rr-portal' and
                labels.get('com.docker.compose.service') == service, 'CONTAINER_IDENTITY')
        require(re.fullmatch('[a-f0-9]{64}', value['Id']) is not None, 'CONTAINER_ID_FORMAT')
        image = json.loads(command(['docker', 'image', 'inspect', 'rr-portal-' + service]))[0]
        value['currentImageTagMatches'] = image['Id'] == value['Image']
        private[service] = value
        safe[service] = {'id': value['Id'], 'image': value['Image'], 'running': value['State']['Running'],
                         'health': value['State'].get('Health', {}).get('Status', 'absent'),
                         'restarts': value['RestartCount'], 'oomKilled': value['State'].get('OOMKilled', False),
                         'memoryLimitBytes': value['HostConfig']['Memory'],
                         'expectedLimit': value['HostConfig']['Memory'] == EXPECTED_LIMITS[service],
                         'currentImageTagMatches': value['currentImageTagMatches']}
    mounts = [m for m in private['voyageplex-api']['Mounts'] if m['Destination'] == '/app/data']
    require(len(mounts) == 1 and mounts[0]['Type'] == 'bind' and pathlib.Path(mounts[0]['Source']) == DATA,
            'API_DATA_BIND_REQUIRED')
    return private, safe


def settings_and_bindings(path=DB):
    result = {}
    with connect(path) as db:
        db.execute('BEGIN')
        for owner, (username, address) in OWNERS.items():
            rows = db.execute('SELECT Id,Username,Role,CompanyAccess,IsActive,MailboxAddress FROM Users WHERE Id=? OR Username=?',
                              (owner, username)).fetchall()
            require(len(rows) == 1, 'EXACT_USER_BINDING_REQUIRED')
            user = dict(rows[0])
            require(user == {'Id': owner, 'Username': username, 'Role': 'admin' if owner == 2 else 'shipping',
                             'CompanyAccess': 'Xingxin' if owner == 2 else 'Huadeng', 'IsActive': 1,
                             'MailboxAddress': address}, 'APPROVED_USER_SCOPE_UNCHANGED')
            setting = db.execute('SELECT * FROM MailSystemSettings WHERE Id=?', (1000 + owner,)).fetchone()
            state = db.execute('SELECT * FROM MailSyncStates WHERE Id=?', (1000 + owner,)).fetchone()
            require(setting is not None and state is not None, 'FOUR_EXISTING_SETTINGS_AND_CURSORS_REQUIRED')
            start = str(setting['StartDate'])
            require(dt.date.fromisoformat(start).isoformat() == start, 'CANONICAL_START_DATE_REQUIRED')
            require(state['Address'] == address and type(state['LastUid']) is int and state['LastUid'] >= 0,
                    'CURSOR_BINDING_REQUIRED')
            result[owner] = {'user': user, 'setting': dict(setting), 'state': dict(state)}
        db.rollback()
    return result


def configuration(api, bindings):
    env = dict(item.split('=', 1) for item in api['Config']['Env'] if '=' in item)
    entries = json.loads(env.get(KEY, 'null'))
    require(isinstance(entries, list) and len(entries) == 4, 'FOUR_RUNTIME_MAILBOX_ENTRIES_REQUIRED')
    mapped = {}
    for item in entries:
        require(isinstance(item, dict) and set(item) == {'username', 'address', 'authCode', 'host', 'folder'},
                'EXACT_MAILBOX_FIELDS_REQUIRED')
        require(all(isinstance(v, str) for v in item.values()), 'MAILBOX_FIELDS_MUST_BE_STRINGS')
        require(item['username'] not in mapped and bool(item['authCode'].strip()) and len(item['authCode']) <= 1024,
                'UNIQUE_CONFIGURED_MAILBOX_REQUIRED')
        mapped[item['username']] = item
    flags = []
    for owner, (username, address) in OWNERS.items():
        item = mapped.get(username)
        require(item is not None and item['address'] == address and item['host'] == 'imap.163.com'
                and item['folder'] == 'INBOX', 'RUNTIME_CONFIGURATION_MAPPING_REQUIRED')
        identity = sha(json.dumps({'address': address, 'host': 'imap.163.com', 'folder': 'INBOX'},
                                 separators=(',', ':')).encode()).upper()
        require(bindings[owner]['state']['MailboxIdentity'] == identity, 'EXISTING_IDENTITY_MUST_MATCH')
        flags.append({'owner': owner, 'username': username, 'address': address, 'runtimeBindingMatches': True,
                      'identityMatchesExistingCursor': True, 'authCodePresent': True})
    envpath = ROOT / '.env.cloud.production'
    require(not envpath.is_symlink() and envpath.is_file(), 'PRIVATE_ENV_REGULAR_FILE_REQUIRED')
    lines = [line.strip().split('=', 1)[1] for line in envpath.read_text().splitlines()
             if line.strip().startswith(KEY + '=')]
    require(len(lines) == 1, 'ONE_PRIVATE_ENV_VALUE_REQUIRED')
    configured = lines[0]
    if configured[:1] in {'"', "'"}:
        require(configured[-1:] == configured[:1], 'ENV_QUOTES_MATCH')
        configured = configured[1:-1]
    require(json.loads(configured) == entries, 'PRIVATE_ENV_AND_RUNNING_VALUE_MATCH')
    return mapped, flags


def service_base(runtime_info, service, port):
    networks = runtime_info[service]['NetworkSettings']['Networks']
    values = [v['IPAddress'] for k, v in networks.items() if k == 'rr-portal_platform-net' and v.get('IPAddress')]
    require(len(values) == 1 and ipaddress.ip_address(values[0]).is_private, 'FIXED_DOCKER_NETWORK_REQUIRED')
    return 'http://' + values[0] + ':' + str(port)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *_):
        return None


def http(base, route, token=None, owner=None, post=False, timeout=10, status_only=False, body=None):
    headers = {'Content-Type': 'application/json'}
    if token is not None:
        cookie = 'voyageplex_session=' + token + '; voyageplex_company=Huadeng'
        if owner is not None:
            cookie += '; voyageplex_mail_owner=' + str(owner)
        headers['Cookie'] = cookie
    request = urllib.request.Request(base + route, headers=headers, data=encoded(body if body is not None else {}) if post else None,
                                     method='POST' if post else 'GET')
    def expired(*_):
        require(False, 'HTTP_HARD_TIMEOUT')
    previous = signal.signal(signal.SIGALRM, expired)
    signal.setitimer(signal.ITIMER_REAL, timeout)
    try:
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
        with opener.open(request, timeout=timeout) as response:
            if status_only:
                return response.status, {}
            raw = response.read(4 * 1024**2 + 1)
            require(len(raw) <= 4 * 1024**2, 'HTTP_RESPONSE_LIMIT')
            return response.status, json.loads(raw) if raw else {}
    except urllib.error.HTTPError as error:
        # Error bodies may contain credentials, parser text or mail metadata.
        error.close()
        return error.code, {}
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
        signal.signal(signal.SIGALRM, previous)


def source_and_health(private, safe):
    require(FINAL_PIN_FROZEN and SECONDARY_TASK_API_GUARD_PIN_FROZEN and re.fullmatch('[a-f0-9]{40}', DEPLOYED_HEAD) is not None
            and bool(SOURCE_FILES) and bool(PARSER_FILES)
            and (not API_DLL_SHA256 or re.fullmatch('[a-f0-9]{64}', API_DLL_SHA256) is not None),
            'FINAL_REVIEWED_PIN_NOT_FROZEN')
    require(command(['git', '-C', str(ROOT), 'rev-parse', 'HEAD']).decode().strip() == DEPLOYED_HEAD,
            'DEPLOYED_HEAD_MATCH')
    for rel, digest in SOURCE_FILES.items():
        path = ROOT / rel
        require(not path.is_symlink() and path.is_file() and file_sha(path) == digest, 'DEPLOYED_SOURCE_FILE_MATCH')
    for path, digest in PARSER_FILES.items():
        require(path.startswith('/app/app/') and '..' not in pathlib.PurePosixPath(path).parts, 'PINNED_PARSER_PATH')
        actual = command(['docker', 'exec', private['voyageplex-parser']['Id'], 'sha256sum', path]).decode().split()[0]
        require(actual == digest, 'RUNNING_PARSER_SOURCE_MATCH')
    actual = command(['docker', 'exec', private['voyageplex-api']['Id'], 'sha256sum', '/app/VoyagePlex.Api.dll']).decode().split()[0]
    require(re.fullmatch('[a-f0-9]{64}', actual) is not None, 'RUNNING_API_ARTIFACT_HASH_SHAPE')
    baseline = read_json(BACKUP / 'runtime-baseline.private.json')
    original_image = baseline.get('services', {}).get('voyageplex-api', {}).get('image')
    original_dll = baseline.get('apiDLLSHA256')
    running_image = private['voyageplex-api']['Image']
    require(isinstance(original_image, str) and re.fullmatch('sha256:[a-f0-9]{64}', original_image) is not None
            and isinstance(original_dll, str) and re.fullmatch('[a-f0-9]{64}', original_dll) is not None
            and isinstance(running_image, str) and re.fullmatch('sha256:[a-f0-9]{64}', running_image) is not None,
            'BASELINE_AND_RUNNING_API_ARTIFACT_HASH_SHAPES')
    require(running_image != original_image and actual != original_dll, 'API_IMAGE_AND_DLL_MUST_CHANGE_SINCE_BACKUP')
    require_new_api_since_first(running_image,actual,first_recovery()['runtimeBefore'])
    require_new_api_since_secondary_guard(running_image,actual,secondary_guard_previous_runtime())
    if API_DLL_SHA256:
        require(actual == API_DLL_SHA256, 'RUNNING_REVIEWED_API_ARTIFACT_MATCH')
    for service, port, path in [('voyageplex-api', 5088, '/api/health'), ('voyageplex-parser', 8091, '/health')]:
        code, _ = http(service_base(private, service, port), path)
        require(code == 200 and safe[service]['running'] and safe[service]['health'] == 'healthy'
                and safe[service]['expectedLimit'] and safe[service]['currentImageTagMatches'], 'SERVICE_HEALTH_AND_RESOURCES')
    resource = {}
    for service in ['voyageplex-api', 'voyageplex-parser']:
        raw = command(['docker', 'stats', '--no-stream', '--format', '{{.CPUPerc}}|{{.MemPerc}}|{{.PIDs}}',
                       private[service]['Id']]).decode().strip()
        match = re.fullmatch(r'([0-9]+(?:\.[0-9]+)?)%\|([0-9]+(?:\.[0-9]+)?)%\|([0-9]+)', raw)
        require(match is not None, 'RESOURCE_METRIC_SHAPE')
        resource[service] = {'cpuPercent': float(match[1]), 'memoryPercent': float(match[2]), 'pids': int(match[3])}
    for line in pathlib.Path('/proc/meminfo').read_text().splitlines():
        match = re.fullmatch(r'(MemTotal|MemAvailable|SwapTotal|SwapFree):\s+([0-9]+) kB', line)
        if match:
            resource[match[1] + 'KiB'] = int(match[2])
    revision = (private['voyageplex-api']['Config'].get('Labels') or {}).get('org.opencontainers.image.revision')
    require(revision is None or revision == DEPLOYED_HEAD, 'PRESENT_API_OCI_REVISION_MUST_MATCH_DEPLOYED_HEAD')
    return {'deployedHead': DEPLOYED_HEAD, 'sourceFilesMatch': True, 'parserImageSourceMatches': True,
            'apiPublishedDLLSHA256': actual, 'apiIndependentReviewedArtifactMatches': True if API_DLL_SHA256 else None,
            'apiImageChangedSinceBackup': True, 'apiImageAndDLLChangedSinceFirstFailedRecovery':True, 'apiImageAndDLLChangedSincePreSecondaryGuardV2':True, 'apiPublishedDLLChangedSinceBackup': True,
            'apiBinarySourceByteProofAvailable': bool(API_DLL_SHA256),
            'apiSourceProvenanceUsesDeployWorkflowAndBehaviorWhenArtifactPinAbsent': not bool(API_DLL_SHA256),
            'apiOCIRevisionPresent': revision is not None, 'apiOCIRevisionMatchesExpected': revision == DEPLOYED_HEAD if revision else None,
            'hooksApplicable': False, 'services': safe, 'resources': resource}


IMAP_CODE = r'''
import datetime as d, imaplib, json, re, signal, ssl, sys
def alarm(*_): raise TimeoutError()
signal.signal(signal.SIGALRM,alarm);signal.alarm(145)
c=None;r={'complete':False,'uidValidity':None,'search':[],'eligible':[],'excluded':[],'unknown':[],'failureType':None}
try:
 p=json.load(sys.stdin);start=d.date.fromisoformat(p['start']);a=p['address'];s=p['authCode']
 if a not in {'lisa666tan@163.com','hyt9833@163.com','13768947334@163.com','13471221956@163.com'}: raise ValueError()
 c=imaplib.IMAP4_SSL('imap.163.com',993,ssl_context=ssl.create_default_context(),timeout=20)
 if c.login(a,s)[0]!='OK': raise ValueError()
 if b'ID' not in c.capabilities and 'ID' not in c.capabilities:raise ValueError()
 imaplib.Commands.setdefault('ID',('AUTH',))
 if c._simple_command('ID','("name" "VoyagePlex" "version" "1.0" "vendor" "VoyagePlex")')[0]!='OK': raise ValueError()
 if c.select('INBOX',readonly=True)[0]!='OK': raise ValueError()
 v=c.response('UIDVALIDITY')[1]
 if len(v)!=1 or not re.fullmatch(rb'[0-9]{1,10}',v[0]):raise ValueError()
 r['uidValidity']=int(v[0])
 if not 0<r['uidValidity']<=4294967295:raise ValueError()
 months=('Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec')
 since=start-d.timedelta(days=1);criterion='%02d-%s-%04d'%(since.day,months[since.month-1],since.year)
 status,parts=c.uid('SEARCH',None,'SINCE',criterion)
 if status!='OK' or len(parts)!=1 or len(parts[0])>1048576:raise ValueError()
 tokens=parts[0].split()
 if len(tokens)>50000 or any(not re.fullmatch(rb'[0-9]{1,10}',v) for v in tokens):raise ValueError()
 r['search']=sorted(int(v) for v in tokens)
 if len(set(r['search']))!=len(tokens) or any(not 0<v<=4294967295 for v in r['search']):raise ValueError()
 for offset in range(0,len(r['search']),100):
  wanted=r['search'][offset:offset+100];found={}
  status,parts=c.uid('FETCH',','.join(map(str,wanted)),'(UID INTERNALDATE RFC822.SIZE)')
  if status=='OK':
   if sum(len(v) for v in parts if isinstance(v,bytes))>65536:raise ValueError()
   for value in parts:
    if not isinstance(value,bytes):continue
    uid=re.search(rb'\bUID ([0-9]{1,10})\b',value);date=re.search(rb'\bINTERNALDATE "([^"\r\n]{1,40})"',value)
    if uid and date:
     number=int(uid[1])
     if number not in wanted or number in found:raise ValueError()
     try:found[number]=d.datetime.strptime(date[1].decode('ascii').strip(),'%d-%b-%Y %H:%M:%S %z').astimezone(d.timezone(d.timedelta(hours=8))).date()
     except (ValueError,UnicodeError):pass
  for uid in wanted:
   r['unknown' if uid not in found else 'eligible' if found[uid]>=start else 'excluded'].append(uid)
 r['complete']=not r['unknown']
except Exception as e:
 r['failureType']=type(e).__name__ if type(e).__name__ in {'TimeoutError','ValueError','error','abort','readonly','OSError','SSLError','gaierror'} else 'Other'
finally:
 if c is not None:
  try:c.sock.close()
  except Exception:pass
 signal.alarm(0);print(json.dumps(r,separators=(',',':')))
'''


def candidates(private, entries, bindings):
    result = {}
    for owner, (username, address) in OWNERS.items():
        # Host child avoids adding memory to the unhealthy parser's 512 MiB cgroup.
        raw = command([sys.executable, '-c', IMAP_CODE],
                      seconds=155, cap=4 * 1024**2, stdin=encoded({'address': address,
                      'authCode': entries[username]['authCode'], 'start': bindings[owner]['setting']['StartDate']}))
        value = json.loads(raw)
        require(isinstance(value, dict) and set(value) == {'complete', 'uidValidity', 'search', 'eligible', 'excluded', 'unknown', 'failureType'},
                'IMAP_PRIVATE_RESULT_SHAPE')
        for kind in ['search', 'eligible', 'excluded', 'unknown']:
            require(isinstance(value[kind], list) and len(value[kind]) <= 50000 and
                    all(type(v) is int and 0 < v <= 4294967295 for v in value[kind]) and
                    value[kind] == sorted(set(value[kind])), 'IMAP_UID_LIST_SHAPE')
        require(set(value['search']) == set(value['eligible']) | set(value['excluded']) | set(value['unknown'])
                and len(value['search']) == len(value['eligible']) + len(value['excluded']) + len(value['unknown']),
                'IMAP_UID_PARTITION')
        require(value['complete'] is True and not value['unknown'] and value['failureType'] is None,
                'IMAP_COMPLETE_METADATA_SEARCH_REQUIRED')
        require(value['uidValidity'] == bindings[owner]['state']['UidValidity'], 'UIDVALIDITY_MUST_MATCH_STORED_CURSOR')
        result[str(owner)] = value
    return result


def candidate_summary(value):
    return [{'owner': int(owner), 'searchCount': len(item['search']), 'eligibleCount': len(item['eligible']),
             'excludedBeforeExistingStartDateCount': len(item['excluded']), 'unknownMetadataCount': len(item['unknown']),
             'uidValidity': item['uidValidity']} for owner, item in value.items()]


@contextlib.contextmanager
def sessions(ids, cleanup_receipt=None):
    """Only approved existing users; token is memory-only and expires after 25 min."""
    tokens, hashes = {}, []
    if cleanup_receipt is not None:
        cleanup_receipt['temporarySessionsCleaned'] = False
    try:
        with connect(writable=True) as db:
            db.execute('BEGIN IMMEDIATE')
            now = dt.datetime.utcnow()
            for owner in ids:
                require(owner in OWNERS, 'ONLY_APPROVED_SESSION_USERS')
                user = db.execute('SELECT IsActive,Role FROM Users WHERE Id=?', (owner,)).fetchone()
                require(user is not None and user['IsActive'] == 1 and
                        user['Role'] == ('admin' if owner == ADMIN else 'shipping'), 'ACTIVE_ORIGINAL_SESSION_ROLE_REQUIRED')
                raw = secrets.token_bytes(32)
                token = base64.b64encode(raw).decode()
                digest = sha(raw).upper()
                db.execute('INSERT INTO UserSessions (UserId,TokenHash,CreatedAt,ExpiresAt) VALUES (?,?,?,?)',
                           (owner, digest, now.isoformat(), (now + dt.timedelta(minutes=25)).isoformat()))
                hashes.append(digest)
                tokens[owner] = token
            db.commit()
        yield tokens
    finally:
        try:
            if hashes:
                with connect(writable=True) as db:
                    db.execute('BEGIN IMMEDIATE')
                    for digest in hashes:
                        db.execute('DELETE FROM UserSessions WHERE TokenHash=?', (digest,))
                    db.commit()
                    require(all(db.execute('SELECT COUNT(*) FROM UserSessions WHERE TokenHash=?', (v,)).fetchone()[0] == 0
                                for v in hashes), 'TEMPORARY_SESSION_CLEANUP_REQUIRED')
            if cleanup_receipt is not None:
                cleanup_receipt['temporarySessionsCleaned'] = True
        finally:
            tokens.clear()


def uid_coverage(path, original, current, bindings):
    result = []
    with connect(path) as db:
        for owner, (_, address) in OWNERS.items():
            before = original[str(owner)]
            now = current[str(owner)]
            state = bindings[owner]['state']
            require(now['uidValidity'] == before['uidValidity'] == state['UidValidity'], 'COVERAGE_UIDVALIDITY_UNCHANGED')
            prefix = 'Huadeng:%d:%s:%s:%d:' % (owner, state['MailboxIdentity'], address, state['UidValidity'])
            seen, samples, failed, duplicate = set(), [], 0, 0
            failed_uids, duplicate_uids = set(), set()
            for row in db.execute("SELECT Id,MailboxKey,Status FROM ImportEmailItems WHERE Company='Huadeng' AND MailOwnerId=? AND MailboxKey<>''", (owner,)):
                key = row['MailboxKey']
                if key.startswith(prefix) and re.fullmatch('[0-9]{1,10}', key[len(prefix):]):
                    uid = int(key[len(prefix):])
                    require(uid not in seen, 'UNIQUE_OWNER_UID_REQUIRED')
                    seen.add(uid)
                    if len(samples) < 1:
                        samples.append(row['Id'])
                    failed += row['Status'] == 'failed'
                    duplicate += row['Status'] in {'duplicate', 'duplicate_confirmed'}
                    if row['Status'] == 'failed':
                        failed_uids.add(uid)
                    if row['Status'] in {'duplicate', 'duplicate_confirmed'}:
                        duplicate_uids.add(uid)
            original_set, current_set = set(before['eligible']), set(now['eligible'])
            missing_original, missing_current = original_set - seen, current_set - seen
            result.append({'owner': owner, 'originalEligibleCount': len(original_set), 'originalCoveredCount': len(original_set & seen),
                           'originalMissingCount': len(missing_original), 'currentEligibleCount': len(current_set),
                           'currentCoveredCount': len(current_set & seen), 'currentMissingCount': len(missing_current),
                           'newCurrentEligibleUIDCount': len(current_set - original_set),
                           'originalUIDsNoLongerInCurrentSearch': len(original_set - current_set),
                           'missingAtOrBelowCursorCount': sum(uid <= state['LastUid'] for uid in missing_original | missing_current),
                           'failedRecordsTotal': failed, 'duplicateRecordsTotal': duplicate,
                           'originalEligibleFailedRecords': len(original_set & failed_uids),
                           'currentEligibleFailedRecords': len(current_set & failed_uids),
                           'currentEligibleDuplicateRecords': len(current_set & duplicate_uids),
                           'coverageDoesNotMeanSuccessfulParsing': True,
                           'lastUid': state['LastUid'], 'cursorId': state['Id'], 'cursorErrorPresent': bool(state['LastError']),
                           '_sample': samples[0] if samples else None})
    return result


def compare_tables(before, after):
    result = []
    require(before['schema'] == after['schema'], 'DATABASE_SCHEMA_UNCHANGED')
    for table, old in before['tables'].items():
        require(table in after['tables'], 'ORIGINAL_TABLE_RETAINED')
        new = after['tables'][table]
        oldrows, newrows = old['rows'], new['rows']
        removed = set(oldrows) - set(newrows)
        added = set(newrows) - set(oldrows)
        changed = {key for key in set(oldrows) & set(newrows) if oldrows[key]['sha256'] != newrows[key]['sha256']}
        contact_only = table == 'MailContacts' and not removed and all(
            oldrows[key]['stableContactSHA256'] == newrows[key]['stableContactSHA256'] for key in changed)
        expected_scope = lambda row: row['company'] == 'Huadeng' and row['owner'] in OWNERS
        scoped_additions = all(expected_scope(newrows[key]) for key in added)
        scoped_changes = all(expected_scope(newrows[key]) for key in changed)
        original_retained = not removed and not changed
        result.append({'table': table, 'before': len(oldrows), 'after': len(newrows), 'added': len(added),
                       'removed': len(removed), 'changed': len(changed), 'originalRowsIdentical': original_retained,
                       'expectedCategory': 'mail-items-new-only' if table == 'ImportEmailItems' else
                       'mail-batches-new-only' if table == 'ImportBatches' else
                       'contacts-message-count-and-time' if table == 'MailContacts' else
                       'sync-cursors-report-separately' if table == 'MailSyncStates' else
                       'ephemeral-session-and-sequence' if table in {'UserSessions', 'sqlite_sequence'} else 'unchanged-required',
                       'onlyContactCounterAndTimestampChanged': contact_only})
        result[-1].update({'allAddedRowsAreFourTargetOwners': scoped_additions,
                           'allChangedRowsAreFourTargetOwners': scoped_changes})
    return result


def compare_files(directory):
    baseline = read_json(BACKUP / 'data-files.private.json')
    current, missing, changed = {}, 0, 0
    for path in sorted(DATA.rglob('*')):
        require(not path.is_symlink(), 'CURRENT_DATA_SYMLINK_FORBIDDEN')
        if path.is_dir():
            continue
        require(path.is_file(), 'CURRENT_DATA_SPECIAL_FILE_FORBIDDEN')
        rel = path.relative_to(DATA).as_posix()
        if rel in {'voyageplex.db', 'voyageplex.db-wal', 'voyageplex.db-shm', 'voyageplex.db-journal'}:
            continue
        current[rel] = file_sha(path)
    old = {name: value['sha256'] for name, value in baseline.items() if value['kind'] == 'file'}
    missing = len(set(old) - set(current))
    changed = sum(old[name] != current[name] for name in set(old) & set(current))
    write_new(directory / 'current-data-files.private.json', current)
    return {'originalNonDatabaseFiles': len(old), 'currentNonDatabaseFiles': len(current),
            'originalMissing': missing, 'originalByteChanges': changed,
            'newFiles': len(set(current) - set(old)), 'allOriginalFileBytesPreserved': missing == changed == 0,
            'comparisonScope': 'regular-file-presence-and-byte-SHA256-only',
            'permissionsOwnershipAndTimestampsCompared': False}



def new_mail_counts(before, after, path=None):
    old = before['tables']['ImportEmailItems']['rows']
    new = after['tables']['ImportEmailItems']['rows']
    result = []
    for owner in OWNERS:
        rows = [new[key] for key in set(new) - set(old)
                if new[key]['company'] == 'Huadeng' and new[key]['owner'] == owner and new[key]['mailboxItem']]
        result.append({'owner': owner, 'newDatabaseMailRecords': len(rows),
                       'newFailedRecords': sum(row['status'] == 'failed' for row in rows),
                       'newDuplicateRecords': sum(row['status'] in {'duplicate', 'duplicate_confirmed'} for row in rows),
                       'newParsedRecords': sum(row['status'] in {'pending', 'confirmed'} for row in rows),
                       'newUnknownStatusRecords': sum(row['status'] not in {'pending', 'confirmed', 'failed', 'duplicate', 'duplicate_confirmed'} for row in rows),
                       'newFailureKinds': {}})
    if path is not None:
        allowed = {'metadata', 'message_size', 'body_read', 'parse_memory', 'parse_timeout',
                   'parse_result_size', 'parse_process', 'parse_cancelled'}
        require(after['tables']['ImportEmailItems']['keys'] == ['Id'], 'MAIL_ITEM_ID_KEY_REQUIRED')
        with connect(path) as db:
            for owner_result in result:
                counts = collections.Counter()
                for row in db.execute("SELECT Id,ResultJson FROM ImportEmailItems WHERE Company='Huadeng' AND MailOwnerId=? AND Status='failed' AND MailboxKey<>''", (owner_result['owner'],)):
                    key = encoded([typed(row['Id'])]).decode()
                    if key not in new or key in old:
                        continue  # Existing failed baseline rows are not new failures.
                    try:
                        raw = row['ResultJson']
                        value = json.loads(raw) if isinstance(raw, str) and len(raw) <= 2 * 1024**2 else {}
                        kind = value.get('failure_kind') if isinstance(value, dict) else None
                    except (ValueError, TypeError):
                        kind = None
                    counts[kind if isinstance(kind, str) and kind in allowed else 'other'] += 1
                owner_result['newFailureKinds'] = dict(sorted(counts.items()))
    return result


def original_user_fields(path):
    # Full typed values stay private; exclude exactly the three authorized test results.
    fields = {'MailboxTestStatus', 'MailboxTestedAt', 'MailboxTestConfigurationKey'}
    result = {}
    with connect(path) as db:
        for row in db.execute('SELECT * FROM Users'):
            values = {key: typed(row[key]) for key in row.keys() if key not in fields}
            result[str(row['Id'])] = sha(encoded(values))
    return result


def compare_original_users(directory):
    before = original_user_fields(BACKUP / 'baseline.sqlite3')
    after = original_user_fields(directory / 'current.sqlite3')
    with connect(BACKUP / 'baseline.sqlite3') as db:
        old = {str(row['Id']): sha(encoded({key: typed(row[key]) for key in row.keys()})) for row in db.execute('SELECT * FROM Users')}
    with connect(directory / 'current.sqlite3') as db:
        new = {str(row['Id']): sha(encoded({key: typed(row[key]) for key in row.keys()})) for row in db.execute('SELECT * FROM Users')}
    changed = {key for key in set(old) & set(new) if old[key] != new[key]}
    return {'allNonTestTypedUserFieldsIdentical': before == after,
            'onlyFourTargetUsersHaveAnyRowChanges': changed <= {str(owner) for owner in OWNERS},
            'fullUserRowsIdentical': old == new, 'changedUserRows': len(changed),
            'expectedCategory': 'mailbox-test-fields-only-target-users',
            'excludedFields': ['MailboxTestConfigurationKey', 'MailboxTestStatus', 'MailboxTestedAt']}


def mailbox_tests(base, token, directory, label):
    tests = []
    for owner in OWNERS:
        item = {'owner': owner, 'status': None, 'connected': False, 'testedAtUtc': None, 'safeExceptionType': None}
        try:
            code, value = http(base, '/api/users/' + str(owner) + '/mailbox-test', token, post=True, timeout=60)
            item['status'] = code
            item['connected'] = code == 200 and isinstance(value, dict) and value.get('connected') is True
            tested = value.get('testedAt') if isinstance(value, dict) else None
            if isinstance(tested, str) and re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.[0-9]{1,9})?Z', tested):
                # The format is fixed by .NET; validate the calendar without relying on Python 3.9 nano parsing.
                dt.datetime.strptime(tested[:19], '%Y-%m-%dT%H:%M:%S')
                item['testedAtUtc'] = tested
        except Exception as error:
            item['safeExceptionType'] = type(error).__name__ if type(error).__name__ in {'CheckError', 'TimeoutError', 'HTTPError', 'URLError', 'OSError', 'ValueError'} else 'Other'
        tests.append(item)
        write_new(directory / (label + '-owner-' + str(owner) + '.json'), item)
    return {'phase': label, 'mailboxes': tests, 'allFourConnected': all(item['connected'] for item in tests),
            'perTestHardTimeoutSeconds': 60, 'rawMessagesOrErrorsPrinted': False}


def successful_prior_mailbox_tests():
    if not RUNS.exists():
        return None
    for path in sorted(RUNS.iterdir()):
        if not (path / 'seal.json').is_file():
            continue  # The current exclusive run is not sealed yet.
        if path==SECONDARY_GUARD_PREVIOUS_RUN:
            partial_previous_archive()
            continue  # Failed historical partial run is not a new-version connection receipt.
        verify_seal(path)
        result = read_json(path / 'first-result.json')
        test = result.get('mailboxTestsBeforeRecovery')
        if (result.get('mode') == 'recover' and result.get('runtimeBefore', {}).get('deployedHead') == DEPLOYED_HEAD
                and isinstance(test, dict) and test.get('allFourConnected') is True):
            rows = test.get('mailboxes', [])
            if ({row.get('owner') for row in rows} == set(OWNERS) and len(rows) == 4
                    and all(row.get('status') == 200 and row.get('connected') is True for row in rows)):
                return {'run': path.name, 'resultSHA256': file_sha(path / 'first-result.json'),
                        'sealSHA256': file_sha(path / 'seal.json')}
    return None


def owner_failed_count(owner):
    with connect() as db:
        return db.execute("SELECT COUNT(*) FROM ImportEmailItems WHERE Company='Huadeng' AND MailOwnerId=? AND MailboxKey<>'' AND Status='failed'", (owner,)).fetchone()[0]


def require_existing_admin_mail_scope():
    # The application middleware would create a missing global Huadeng setting.
    # Fail before authenticated requests instead of causing such an implicit write.
    with connect() as db:
        require(db.execute('SELECT COUNT(*) FROM MailSystemSettings WHERE Id=2').fetchone()[0] == 1,
                'EXISTING_GLOBAL_HUADENG_SETTING_REQUIRED')


def mark_user_test_category(comparison):
    for row in comparison:
        if row['table'] == 'Users':
            row['expectedCategory'] = 'mailbox-test-fields-only-target-users'


def all_new_parsed_or_duplicate(counts):
    return all(row['newFailedRecords'] == 0 and row['newUnknownStatusRecords'] == 0 for row in counts)


def retain_snapshot(directory):
    write_new(directory / 'sqlite-snapshot.private.json', online_backup(directory / 'current.sqlite3'))
    value = table_snapshot(directory / 'current.sqlite3')
    write_new(directory / 'typed-tables.private.json', value)
    return value


def permission_checks(base, coverage, cleanup_receipt=None):
    results = []
    with connect() as db:
        supervisors = db.execute("SELECT COUNT(*) FROM Users WHERE IsActive=1 AND Role='supervisor' AND CompanyAccess='Huadeng'").fetchone()[0]
    with sessions([ADMIN, 3, 5, 6], cleanup_receipt) as tokens:
        code, accounts = http(base, '/api/mail/accounts', tokens[ADMIN])
        require(code == 200 and {v['id'] for v in accounts['accounts']} >= set(OWNERS), 'ADMIN_EXISTING_SCOPE')
        for owner in OWNERS:
            code, selected = http(base, '/api/mail/accounts', tokens[ADMIN], owner)
            require(code == 200 and selected['selectedOwnerId'] == owner, 'ADMIN_OWNER_SELECTION')
        for owner in [3, 5, 6]:
            sample = next(row['_sample'] for row in coverage if row['owner'] == owner)
            other = next(row for row in coverage if row['owner'] != owner and row['_sample'] is not None)
            code, own = http(base, '/api/mail/accounts', tokens[owner], other['owner'])
            require(code == 200 and own['selectedOwnerId'] == owner and [v['id'] for v in own['accounts']] == [owner],
                    'SHIPPING_FORGED_OWNER_IGNORED')
            require(sample is not None, 'OWN_MAIL_SAMPLE_REQUIRED')
            owncode, _ = http(base, '/api/imports/email/mailbox/items/' + str(sample), tokens[owner], status_only=True)
            othercode, _ = http(base, '/api/imports/email/mailbox/items/' + str(other['_sample']), tokens[owner], other['owner'], status_only=True)
            require(owncode == 200 and othercode == 404, 'SHIPPING_OWN_200_OTHER_404')
            results.append({'owner': owner, 'ownMail': owncode, 'otherOwnerMail': othercode, 'forgedOwnerIgnored': True})
    return {'adminExistingScope': True, 'shipping': results, 'temporarySessionsCleaned': True,
            'activeHuadengSupervisors': supervisors, 'supervisorSessionExercised': False,
            'extraSupervisorAccountsOutsideConfiguredFourNotExercised': supervisors > 0,
            'configuredFourMailboxRoles': {'admin': 1, 'shipping': 3, 'supervisor': 0}}



# Fixed failed-recovery checkpoint; the original complete-v3 baseline stays authoritative.
FIRST_RECOVERY = RUNS / 'recover-39198686144'
FIRST_RECOVERY_RESULT = 'aa88dc5797310138945fb7d6f911ec596ea09b7de72f5cfbefd875095c6fa6e9'
FIRST_RECOVERY_SEAL = 'c2b28a5452189e4246a70d9818933f0dfc14ff0cb7539b460f365faf44e8efb4'
RETRY_FIELDS = {'FileName','MailSubject','MailSender','ShipmentMode','WorkCategory','ClassificationConfidence',
    'ClassificationSource','NeedsClassificationReview','BusinessFingerprint','Fingerprint','Status',
    'DuplicateOfItemId','ResultJson','Error'}


def first_recovery():
    verify_seal(FIRST_RECOVERY)
    require(file_sha(FIRST_RECOVERY/'first-result.json') == FIRST_RECOVERY_RESULT and
            file_sha(FIRST_RECOVERY/'seal.json') == FIRST_RECOVERY_SEAL, 'FIXED_FIRST_RECOVERY_RECEIPT_REQUIRED')
    value = read_json(FIRST_RECOVERY/'first-result.json')
    require(value.get('mode') == 'recover' and value.get('success') is False and
            value.get('runtimeBefore',{}).get('deployedHead') == '53f482f4b71fc0fd4c6696e9ec4b2058e6a342bc',
            'FIRST_FAILED_RECOVERY_MUST_REMAIN_FAILURE')
    return value


def require_new_api_since_first(image,dll,runtime_before):
    oldimage=runtime_before.get('services',{}).get('voyageplex-api',{}).get('image')
    olddll=runtime_before.get('apiPublishedDLLSHA256')
    require(isinstance(oldimage,str) and re.fullmatch('sha256:[a-f0-9]{64}',oldimage) is not None and
        isinstance(olddll,str) and re.fullmatch('[a-f0-9]{64}',olddll) is not None and
        image!=oldimage and dll!=olddll,'API_IMAGE_AND_DLL_MUST_CHANGE_SINCE_FIRST_FAILED_RECOVERY')


def partial_previous_archive(force_full=False):
    # The interrupted run is never sealed or repaired by this helper. Its exact
    # retained bytes are bound by a separate failed-partial reconciliation.
    # Hash all those bytes at invocation start and end; between those passes,
    # validate the same inode/size/mtime/ctime/mode/owner set. This cache covers
    # archive byte validation only, never any retry's typed transition proof.
    global _PARTIAL_VERIFICATION
    require(SECONDARY_TASK_API_GUARD_PIN_FROZEN and
        re.fullmatch('[a-f0-9]{64}',PARTIAL_RECONCILIATION_RESULT_SHA256) is not None and
        re.fullmatch('[a-f0-9]{64}',PARTIAL_RECONCILIATION_SEAL_SHA256) is not None,
        'FAILED_PARTIAL_RECONCILIATION_PINS_REQUIRED')
    require(file_sha(PARTIAL_RECONCILIATION/'first-result.json')==PARTIAL_RECONCILIATION_RESULT_SHA256 and
        file_sha(PARTIAL_RECONCILIATION/'seal.json')==PARTIAL_RECONCILIATION_SEAL_SHA256,
        'EXACT_EXTERNAL_FAILED_PARTIAL_RECEIPT_REQUIRED')
    def stamps():
        require(not SECONDARY_GUARD_PREVIOUS_RUN.is_symlink() and SECONDARY_GUARD_PREVIOUS_RUN.is_dir(),
            'REGULAR_FIXED_PARTIAL_RUN_REQUIRED')
        values={}
        for path in sorted(SECONDARY_GUARD_PREVIOUS_RUN.rglob('*')):
            require(not path.is_symlink(),'PARTIAL_RUN_SYMLINK_FORBIDDEN')
            if path.is_dir():continue
            value=path.stat()
            require(stat.S_ISREG(value.st_mode),'PARTIAL_RUN_REGULAR_FILES_ONLY')
            values[path.relative_to(SECONDARY_GUARD_PREVIOUS_RUN).as_posix()]=[
                value.st_ino,value.st_size,value.st_mtime_ns,value.st_ctime_ns,
                stat.S_IMODE(value.st_mode),value.st_uid,value.st_gid]
        require(len(values)<=10000,'PARTIAL_RUN_FILE_COUNT_BOUND')
        return values
    before=stamps()
    if _PARTIAL_VERIFICATION is not None:
        require(before==_PARTIAL_VERIFICATION['stamps'],'PARTIAL_RUN_METADATA_CHANGED_DURING_INVOCATION')
        if not force_full:
            return _PARTIAL_VERIFICATION
    verify_seal(PARTIAL_RECONCILIATION)
    value=read_json(PARTIAL_RECONCILIATION/'first-result.json')
    require(value.get('reconciliationComplete') is True and value.get('failedPartial') is True and
        value.get('success') is False and value.get('allMailboxRecoveryVerified') is False and
        value.get('oldRunReclassifiedAsSuccess') is False and value.get('businessWrites') is False and
        value.get('oldEvidenceWrites') is False and value.get('apiOrIMAPCalls') is False and
        value.get('process',{}).get('helperAbsent') is True and
        value.get('immutableOriginalFullAndFirstSealsVerified') is True and
        value.get('oldTreesMetadataStableAfterSingleStreamingHash') is True and
        value.get('fullOldByteHashPasses')==1 and value.get('sealedSuccessfulSteps')==6 and
        value.get('runtimeStableDuringCapture') is True and
        value.get('canSupportSeparatelyReviewedNarrowPartialRunException') is True,
        'EXPLICIT_FAILED_PARTIAL_RECONCILIATION_REQUIRED')
    observed=value.get('runtimeBefore',{})
    require(observed==value.get('runtimeAfter') and observed.get('head')=='4ec24b7b6d25836ee4ee702b57324764a856b83f' and
        observed.get('headMatches4ec') is True and observed.get('sourcePinsMatch4ec') is True and
        observed.get('apiRunning') is True and observed.get('apiHealth')=='healthy' and
        re.fullmatch('sha256:[a-f0-9]{64}',observed.get('apiImage','')) is not None and
        re.fullmatch('[a-f0-9]{64}',observed.get('apiDLLSHA256','')) is not None,
        'EXTERNAL_OBSERVED_PRE_GUARD_4EC_RUNTIME_REQUIRED')
    manifest_path=PARTIAL_RECONCILIATION/'partial-file-manifest.private.json'
    require(file_sha(manifest_path)==value.get('oldPartialManifestSHA256'),'EXACT_PARTIAL_MANIFEST_REQUIRED')
    manifest=read_json(manifest_path)
    require(isinstance(manifest,dict) and set(manifest)==set(before),'EXACT_PARTIAL_RUN_FILE_SET_REQUIRED')
    for name,item in manifest.items():
        require(isinstance(item,dict) and set(item)=={'size','sha256'} and
            type(item['size']) is int and item['size']==before[name][1] and
            re.fullmatch('[a-f0-9]{64}',item['sha256']) is not None and
            file_sha(SECONDARY_GUARD_PREVIOUS_RUN/name)==item['sha256'],
            'EXACT_PARTIAL_RUN_BYTE_MANIFEST_REQUIRED')
    require(stamps()==before,'PARTIAL_RUN_CHANGED_DURING_BYTE_VERIFICATION')
    attempts=value.get('attempts',[])
    require(isinstance(attempts,list) and len(attempts)==7 and
        [entry.get('step') for entry in attempts]==list(range(1,8)) and
        all(entry.get('sealed') is True and entry.get('passed') is True and
            entry.get('responseRecoveredExactlyOne') is True for entry in attempts[:6]) and
        attempts[6].get('passed') is not True,
        'SIX_SEALED_SUCCESSES_AND_UNSUCCESSFUL_SEVENTH_REQUIRED')
    facts=value.get('step7TypedFacts',{})
    require(facts.get('targetBeforeAndAfterTypedEqual') is True and
        facts.get('targetAfterAndCurrentTypedEqual') is True and
        facts.get('allCursorsBeforeAndAfterTypedEqual') is True,
        'PARTIAL_SEVENTH_NO_TARGET_OR_CURSOR_TRANSITION_REQUIRED')
    _PARTIAL_VERIFICATION={'result':value,'manifest':manifest,'stamps':before}
    return _PARTIAL_VERIFICATION


def partial_attempt_receipt(path):
    proof=partial_previous_archive();prefix=path.relative_to(SECONDARY_GUARD_PREVIOUS_RUN).as_posix()+'/'
    members={name[len(prefix):]:item['sha256'] for name,item in proof['manifest'].items() if name.startswith(prefix)}
    require(path.name in {'attempt-%04d'%i for i in range(1,8)} and 'attempt.private.json' in members,
        'FIXED_PARTIAL_RETRY_RESERVATION_REQUIRED')
    if 'seal.json' in members:
        expected=read_json(path/'seal.json');actual=dict(members);actual.pop('seal.json')
        require(expected==actual,'PARTIAL_SEALED_STEP_MUST_MATCH_FULL_BYTE_MANIFEST')
    else:
        require(path.name=='attempt-0007','ONLY_SEVENTH_PARTIAL_STEP_MAY_LACK_SEAL')
    if 'result.json' in members:
        receipt=read_json(path/'result.json')
        require(isinstance(receipt,dict),'PARTIAL_RESULT_OBJECT_REQUIRED')
    else:
        require(path.name=='attempt-0007','ONLY_SEVENTH_PARTIAL_STEP_MAY_LACK_RESULT')
        receipt={'passed':False,'attempted':None,'transportOrResponseOutcomeUncertain':True,
                 'reconciledPartialReservationOnly':True}
    require(path.name!='attempt-0007' or receipt.get('passed') is not True,
        'PARTIAL_SEVENTH_MUST_NEVER_BE_INFERRED_SUCCESSFUL')
    return receipt


def secondary_guard_previous_runtime():
    observed=partial_previous_archive()['result']['runtimeBefore']
    # This is a sealed observation taken after the failed run, before deploying
    # the secondary-source guard; it is not reconstructed historical memory.
    return {'deployedHead':observed['head'],'apiPublishedDLLSHA256':observed['apiDLLSHA256'],
            'services':{'voyageplex-api':{'image':observed['apiImage']}},
            'provenance':'external-observation-after-interrupted-run-before-guard-deployment'}


def require_new_api_since_secondary_guard(image,dll,previous):
    oldimage=previous.get('services',{}).get('voyageplex-api',{}).get('image')
    olddll=previous.get('apiPublishedDLLSHA256')
    require(isinstance(oldimage,str) and re.fullmatch('sha256:[a-f0-9]{64}',oldimage) is not None and
        isinstance(olddll,str) and re.fullmatch('[a-f0-9]{64}',olddll) is not None and
        image!=oldimage and dll!=olddll,'NEW_API_IMAGE_AND_DLL_WITH_SECONDARY_TASK_TRANSACTION_GUARD_REQUIRED')


def rows_by_id(db, table, columns=None):
    projection='*' if columns is None else ','.join(q(column) for column in columns)
    return {r['Id']: dict(r) for r in db.execute('SELECT '+projection+' FROM '+q(table))}


def full_row_by_id(db,table,item_id):
    row=db.execute('SELECT * FROM '+q(table)+' WHERE Id=?',(item_id,)).fetchone()
    return dict(row) if row is not None else None


def row_hash_index(db,table):
    # Exactly one full typed-row scan. Only IDs/digests survive each iteration;
    # ResultJson, BLOBs and every other source field remain covered by the hash.
    result={}
    for row in db.execute('SELECT * FROM '+q(table)):
        require(row['Id'] not in result,'UNIQUE_HASH_INDEX_IDS_REQUIRED')
        result[row['Id']]=row_sha(dict(row))
    return result


def preserved_mail_hashes(before,after,allowed):
    old=row_hash_index(before,'ImportEmailItems');new=row_hash_index(after,'ImportEmailItems')
    passed=all(key in new and (key in allowed or digest==new[key]) for key,digest in old.items())
    for key in set(old)&set(allowed):
        row=full_row_by_id(before,'ImportEmailItems',key);now=full_row_by_id(after,'ImportEmailItems',key)
        passed=bool(passed and now is not None and set(row)==set(now) and
            all(typed(row[k])==typed(now[k]) for k in row if k not in RETRY_FIELDS))
    return passed,old,new


def preserved_batch_counters(before,after,changes):
    expected=row_hash_index(before,'ImportBatches');actual=row_hash_index(after,'ImportBatches')
    for key,count in changes.items():
        row=full_row_by_id(before,'ImportBatches',key)
        if row is None:return False
        row['FailedCount']-=count;row['ParsedCount']+=count
        expected[key]=row_sha(row)
    return all(key in actual and digest==actual[key] for key,digest in expected.items())


def failed_request_rows_unchanged(before,after):
    passed=True
    for table in ['ImportEmailItems','ImportBatches','MailSyncStates']:
        old=row_hash_index(before,table);new=row_hash_index(after,table)
        matched=old==new if table=='MailSyncStates' else all(key in new and digest==new[key] for key,digest in old.items())
        passed=bool(passed and matched)
    return passed


def row_sha(row):
    return sha(encoded({key:typed(value) for key,value in row.items()}))


def received_date(value):
    require(isinstance(value,str) and len(value)<=64, 'BOUNDED_RECEIVED_DATE_REQUIRED')
    value = re.sub(r'(\.\d{6})\d+',r'\1',value)
    parsed = dt.datetime.fromisoformat(value.replace('Z','+00:00'))
    require(parsed.tzinfo is not None, 'RECEIVED_DATE_ZONE_REQUIRED')
    return parsed.astimezone(dt.timezone(dt.timedelta(hours=8))).date().isoformat()


def retry_candidate(db, item, bindings):
    owner=item['MailOwnerId']
    if item['Company']!='Huadeng' or owner not in OWNERS or item['Status']!='failed':return False
    if (item['HandlingStatus']!='Pending' or item['HandlingOutcome']!='' or item['WorkNote']!='' or
        item['ReviewedAt'] is not None or str(item['ClassificationSource']).casefold()=='manual'):return False
    try:
        if json.loads(item['TaskIdsJson'])!=[]:return False
        if db.execute('SELECT COUNT(*) FROM ShipmentTasks WHERE SourceImportItemId=?',(item['Id'],)).fetchone()[0]:return False
        for task in db.execute("SELECT SourceEmailsJson FROM ShipmentTasks WHERE Company='Huadeng'"):
            raw=task['SourceEmailsJson']
            if not isinstance(raw,str) or len(raw.encode())>2097152:return False
            refs=json.loads(raw)
            if not isinstance(refs,list) or any(not isinstance(r,dict) or type(r.get('id')) is not int or r['id']<=0 for r in refs):return False
            if any(r['id']==item['Id'] for r in refs):return False
        batch=db.execute('SELECT * FROM ImportBatches WHERE Id=?',(item['ImportBatchId'],)).fetchone()
        if batch is None or (batch['Kind'],batch['Status'],batch['Company'],batch['MailOwnerId'])!=('Email','PendingConfirmation','Huadeng',owner):return False
        state=bindings[owner]['state'];address=OWNERS[owner][1]
        if type(state['UidValidity']) is not int or not 1<=state['UidValidity']<=4294967295:return False
        prefix='Huadeng:%d:%s:%s:%d:'%(owner,state['MailboxIdentity'],address,state['UidValidity'])
        key=item['MailboxKey'];segment=key[len(prefix):] if key.startswith(prefix) else ''
        if not re.fullmatch('[1-9][0-9]{0,9}',segment) or not 0<int(segment)<=min(4294967295,state['LastUid']):return False
        if not (item['MailReceivedDate']==received_date(item['MailReceivedAt'])>=bindings[owner]['setting']['StartDate']):return False
        return True
    except (ValueError,TypeError,CheckError):return False


def first_failed_ids():
    first_recovery()
    with connect(FIRST_RECOVERY/'current.sqlite3') as db:
        db.execute('ATTACH DATABASE ? AS baseline',((BACKUP/'baseline.sqlite3').as_uri()+'?mode=ro&immutable=1',))
        rows=db.execute("SELECT i.Id,i.MailOwnerId FROM ImportEmailItems i LEFT JOIN baseline.ImportEmailItems b ON i.Id=b.Id WHERE b.Id IS NULL AND i.Company='Huadeng' AND i.MailOwnerId IN(2,3,5,6) AND i.MailboxKey<>'' AND i.Status='failed'").fetchall()
    require(len(rows)==5 and dict(collections.Counter(r['MailOwnerId'] for r in rows))=={2:1,3:2,5:1,6:1},
            'EXACT_FIRST_FIVE_NEW_FAILURES_REQUIRED')
    return {r['Id'] for r in rows}


def freeze_retry_plan(directory):
    plan=directory/'frozen-retry-plan';plan.mkdir(mode=0o700)
    write_new(plan/'snapshot.private.json',online_backup(plan/'current.sqlite3'))
    bindings=settings_and_bindings(plan/'current.sqlite3');first=first_failed_ids()
    selected=[];excluded=collections.Counter()
    with connect(plan/'current.sqlite3') as db:
        db.execute('ATTACH DATABASE ? AS baseline',((BACKUP/'baseline.sqlite3').as_uri()+'?mode=ro&immutable=1',))
        for row in db.execute("SELECT i.* FROM ImportEmailItems i LEFT JOIN baseline.ImportEmailItems b ON i.Id=b.Id WHERE b.Id IS NULL AND i.Company='Huadeng' AND i.MailOwnerId IN(2,3,5,6) AND i.MailboxKey<>'' AND i.Status='failed' ORDER BY i.MailOwnerId,i.Id"):
            item=dict(row)
            if retry_candidate(db,item,bindings):
                selected.append({'id':item['Id'],'owner':item['MailOwnerId'],'rowSHA256':row_sha(item),'firstFive':item['Id'] in first})
            else:excluded[item['MailOwnerId']]+=1
    proof,originals,approved,_,_=original_retry_proof(plan/'current.sqlite3')
    require(proof['passed'],'EXACT_ORIGINAL_BASELINE_OR_SEALED_AFTER_STATE_REQUIRED')
    with connect(plan/'current.sqlite3') as db:
        for item_id,item in originals.items():
            if item_id in approved:continue
            row=db.execute('SELECT * FROM ImportEmailItems WHERE Id=?',(item_id,)).fetchone()
            if row is not None and row_sha(dict(row))==item['beforeSHA256'] and retry_candidate(db,dict(row),bindings):
                selected.append({'id':item_id,'owner':item['owner'],'rowSHA256':item['beforeSHA256'],
                    'firstFive':False,'authorizedOriginal':True})
            else:excluded[item['owner']]+=1
    selected.sort(key=lambda item:(item['owner'],not item.get('authorizedOriginal',False),item['id']))
    require(len(selected)<=5000,'BOUNDED_FROZEN_RETRY_LIST_REQUIRED')
    write_new(plan/'items.private.json',selected);write_new(plan/'excluded.private.json',dict(excluded));seal(plan)
    return selected,excluded


def retry_attempt_history():
    records=[]
    for parent in RUNS.iterdir():
        if not parent.is_dir() or parent.is_symlink():continue
        attempts=parent/'retry-attempts'
        if not attempts.exists():continue
        require(not attempts.is_symlink(),'REGULAR_RETRY_ATTEMPT_DIRECTORY_REQUIRED')
        for path in sorted(attempts.iterdir()):
            require(path.is_dir() and not path.is_symlink(),'REGULAR_RETRY_RECEIPT_REQUIRED')
            if parent==SECONDARY_GUARD_PREVIOUS_RUN:
                receipt=partial_attempt_receipt(path)
            else:
                verify_seal(path);receipt=read_json(path/'result.json')
            reserved=read_json(path/'attempt.private.json')
            require(type(reserved.get('id')) is int and reserved.get('owner') in OWNERS and
                    re.fullmatch('[a-f0-9]{40}',reserved.get('head','')) is not None,'FIXED_RETRY_RECEIPT_SHAPE')
            reserved['_afterSnapshot']=path/'after.sqlite3'
            records.append((reserved,receipt))
    require(len(records)<=5000,'BOUNDED_RETRY_RECEIPT_HISTORY_REQUIRED')
    return records


def retry_transition(before_path,after_path,item_id):
    with connect(before_path) as before,connect(after_path) as after:
        old=row_hash_index(before,'ImportEmailItems');new=row_hash_index(after,'ImportEmailItems')
        row=full_row_by_id(before,'ImportEmailItems',item_id);now=full_row_by_id(after,'ImportEmailItems',item_id)
        stable=row is not None and now is not None and set(row)==set(now) and all(
            typed(row[k])==typed(now[k]) for k in row if k not in RETRY_FIELDS)
        parsed=False
        if stable:
            try:
                value=json.loads(now['ResultJson']) if len(now['ResultJson'])<=2*1024**2 else {}
                parsed=(row['Status']=='failed' and now['Status'] in {'pending','duplicate'} and now['Error']=='' and
                    value.get('status')=='parsed' and type(value.get('mailbox_uid')) is int and
                    str(value['mailbox_uid'])==row['MailboxKey'].rsplit(':',1)[1] and
                    received_date(value.get('mailbox_received_at'))==row['MailReceivedDate'] and
                    utc_date(value.get('mailbox_received_at'))==utc_date(row['MailReceivedAt']) and
                    value.get('fingerprint')==now['Fingerprint'] and bool(now['Fingerprint']) and
                    (not row['Fingerprint'] or row['Fingerprint']==now['Fingerprint']))
            except (ValueError,TypeError,AttributeError,CheckError):pass
        other_items=all(key in new and digest==new[key] for key,digest in old.items() if key!=item_id)
        batch_ok=bool(stable and preserved_batch_counters(before,after,{row['ImportBatchId']:1})) if row is not None else False
        cursor_same=row_hash_index(before,'MailSyncStates')==row_hash_index(after,'MailSyncStates')
    return {'onlyAllowedTargetTypedFieldsChanged':bool(stable),'parsedMetadataAndFingerprintPassed':bool(parsed),
            'otherExistingMailRowsIdentical':other_items,'batchCountersAndAllOtherBatchFieldsPassed':bool(batch_ok),
            'allCursorFieldsUnchangedDuringRetry':cursor_same,
            'passed':bool(stable and parsed and other_items and batch_ok and cursor_same)}


def retry_new_failures(directory,result,base,token,deadline,plan,excluded):
    verify_seal(directory/'frozen-retry-plan')
    attempts=directory/'retry-attempts';attempts.mkdir(mode=0o700)
    history=retry_attempt_history();seen={(x['head'],x['id']) for x,_ in history};stopped=set(excluded)
    result['retryRuns']=[]
    for index,item in enumerate(plan,1):
        owner=item['owner']
        if (DEPLOYED_HEAD,item['id']) in seen:stopped.add(owner);continue
        if owner in stopped:continue
        if time.monotonic()>=deadline-580:
            stopped.add(owner);continue
        step=attempts/('attempt-%04d'%index);step.mkdir(mode=0o700)
        receipt={'owner':owner,'status':None,'responseRecoveredExactlyOne':False,'passed':False,'attempted':False}
        abort_post=False
        # Reserve once before any request. A crash must never silently reissue it.
        write_new(step/'attempt.private.json',{**item,'head':DEPLOYED_HEAD})
        try:
            write_new(step/'before-snapshot.private.json',online_backup(step/'before.sqlite3'))
            bindings=settings_and_bindings(step/'before.sqlite3')
            with connect(step/'before.sqlite3') as db:
                row=db.execute('SELECT * FROM ImportEmailItems WHERE Id=?',(item['id'],)).fetchone()
                unchanged=row is not None and row_sha(dict(row))==item['rowSHA256'] and retry_candidate(db,dict(row),bindings)
            require(unchanged,'FROZEN_RETRY_ROW_MUST_BE_UNCHANGED_AND_UNHANDLED')
            # Re-read immediately before the POST; C# additionally rechecks under its transaction.
            with connect() as db:
                live=db.execute('SELECT * FROM ImportEmailItems WHERE Id=?',(item['id'],)).fetchone()
                require(live is not None and row_sha(dict(live))==item['rowSHA256'] and retry_candidate(db,dict(live),bindings),'LIVE_RETRY_ROW_HASH_AND_TASK_SCOPE_MATCH')
            receipt['attempted']=True
            code,value=http(base,'/api/imports/email/mailbox/retry-failed',token,owner,post=True,timeout=330,body={'itemIds':[item['id']]})
            require(isinstance(value,dict),'RETRY_RESPONSE_OBJECT_REQUIRED')
            receipt['status']=code
            receipt['responseRecoveredExactlyOne']=(code==200 and isinstance(value,dict) and
                all(type(value.get(k)) is int for k in ['requested','recovered','stillFailed']) and
                value.get('requested')==1 and value.get('recovered')==1 and value.get('stillFailed')==0 and
                value.get('recoveredItemIds')==[item['id']])
        except Exception as error:
            receipt['safeFailure']='RETRY_REQUEST_OR_PRECONDITION_FAILED'
            abort_post=receipt['attempted']
            receipt['transportOrResponseOutcomeUncertain']=abort_post
        finally:
            try:
                write_new(step/'after-snapshot.private.json',online_backup(step/'after.sqlite3'))
                if receipt['responseRecoveredExactlyOne']:
                    receipt['transition']=retry_transition(step/'before.sqlite3',step/'after.sqlite3',item['id'])
                    receipt['passed']=receipt['transition']['passed']
                elif (step/'before.sqlite3').is_file():
                    with connect(step/'before.sqlite3') as before,connect(step/'after.sqlite3') as after:
                        receipt['failedRequestOriginalRowsAndAllCursorsUnchanged']=failed_request_rows_unchanged(before,after)
            finally:
                write_new(step/'result.json',receipt);seal(step)
        result['retryRuns'].append(receipt)
        require(not abort_post,'RETRY_POST_UNCERTAIN_ABORT_ALL_FURTHER_POSTS')
        if not receipt['passed']:stopped.add(owner)
    attempted_now={r['owner'] for r in result['retryRuns'] if not r['passed']}
    completed_count=sum(r['passed'] for r in result['retryRuns'])
    result['retryPlan']={'eligible':len(plan),'excludedUnsafeOrHandled':sum(excluded.values()),
                        'excludedByOwner':dict(excluded),'firstCheckpointNewFailures':5,
                        'candidateListFrozenBeforeAnyRetry':True,'originalBaselineRetryScope':'exact-six-sealed-original-probe-only',
                        'deferredOrUnsuccessfulFrozenItems':len(plan)-completed_count}
    result['allRetryResponsesSucceeded']=not excluded and completed_count==len(plan) and all(r['passed'] for r in result['retryRuns'])
    verify_seal(directory/'frozen-retry-plan')
    return stopped|attempted_now


def checkpoint_preservation(path):
    first=first_failed_ids();history=retry_attempt_history()
    approved={r['id'] for r,v in history if v.get('passed') is True}
    with connect(FIRST_RECOVERY/'current.sqlite3') as before,connect(path) as after:
        allowed=(first|set(original_retry_targets()))&approved
        stable,old,new=preserved_mail_hashes(before,after,allowed)
        exact_after=True
        for reserved,receipt in history:
            if not receipt.get('passed'):continue
            with connect(reserved['_afterSnapshot']) as saved:
                saved_row=full_row_by_id(saved,'ImportEmailItems',reserved['id'])
                exact_after=bool(exact_after and saved_row is not None and reserved['id'] in new and
                    row_sha(saved_row)==new[reserved['id']])
        first_rows={key:full_row_by_id(before,'ImportEmailItems',key) for key in first}
        current_first={key:full_row_by_id(after,'ImportEmailItems',key) for key in first}
        tracked={str(owner):{'originalFirstFailed':sum(first_rows[i]['MailOwnerId']==owner for i in first),
            'nowParsedOrDuplicate':sum(current_first[i] is not None and current_first[i]['Status'] in {'pending','duplicate'} and i in approved and first_rows[i]['MailOwnerId']==owner for i in first)} for owner in OWNERS}
        counts=collections.Counter(full_row_by_id(before,'ImportEmailItems',i)['ImportBatchId'] for i in allowed if i in old)
        batch_ok=preserved_batch_counters(before,after,counts)
    return {'firstFiveTrackedByOwner':tracked,'allFirstCheckpointMailRowsRetainedWithOnlySealedRetryChanges':stable,
            'firstCheckpointBatchChangesExactlySealedRetryCounts':batch_ok,
            'sealedSuccessfulRetryRowsStillMatchExactAfterSnapshots':exact_after,
            'originalFailedRecoveryRemainsFailure':True,'passed':stable and batch_ok and exact_after}


def normalize_email(value):
    match=re.search(r'[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}',value or '',re.I)
    return (match.group(0) if match else value or '').strip().lower()


def bindings_start(db,owner):
    row=db.execute('SELECT StartDate FROM MailSystemSettings WHERE Id=?',(1000+owner,)).fetchone()
    return row[0] if row is not None else '9999-12-31'


def utc_date(value):
    value=re.sub(r'(\.\d{6})\d+',r'\1',value)
    parsed=dt.datetime.fromisoformat(value.replace('Z','+00:00'))
    return parsed.replace(tzinfo=dt.timezone.utc) if parsed.tzinfo is None else parsed.astimezone(dt.timezone.utc)


def classified_mail_changes(path):
    """Classify measured differences, retaining strict-scope booleans elsewhere."""
    original_proof,_,_,original_sender_delta,required_original_senders=original_retry_proof(path)
    with connect(BACKUP/'baseline.sqlite3') as before,connect(path) as after:
        columns=['Id','Company','MailOwnerId','ImportBatchId','MailboxKey','MailReceivedDate','MailReceivedAt','MailSender','Status']
        old=rows_by_id(before,'ImportEmailItems',columns);new=rows_by_id(after,'ImportEmailItems',columns)
        oldb=rows_by_id(before,'ImportBatches');newb=rows_by_id(after,'ImportBatches')
        oldc=rows_by_id(before,'MailContacts');newc=rows_by_id(after,'MailContacts')
        states=rows_by_id(after,'MailSyncStates');start=after.execute('SELECT StartDate FROM MailSystemSettings WHERE Id=1').fetchone()[0]
        additions=[r for key,r in new.items() if key not in old];scoped=collections.Counter();unclassified=0
        for row in additions:
            owner=row['MailOwnerId'];scope=(row['Company'],owner);state=states.get(1000+owner if row['Company']=='Huadeng' else 1)
            valid=state is not None and (scope[0]=='Huadeng' and owner in OWNERS or scope==('Xingxin',0))
            if valid:
                prefix=('Huadeng:%d:%s:'%(owner,state['MailboxIdentity']) if scope[0]=='Huadeng' else '')+state['Address']+':'+str(state['UidValidity'])+':'
                uid=row['MailboxKey'][len(prefix):] if row['MailboxKey'].startswith(prefix) else ''
                batch=newb.get(row['ImportBatchId'])
                try:valid=(re.fullmatch('[1-9][0-9]{0,9}',uid) is not None and int(uid)<=state['LastUid'] and
                    row['MailReceivedDate']==received_date(row['MailReceivedAt']) and
                    batch is not None and (batch['Kind'],batch['Company'],batch['MailOwnerId'])==('Email',*scope))
                except (ValueError,TypeError,CheckError):valid=False
                valid=bool(valid and row['MailReceivedDate']>=(bindings_start(after,owner) if scope[0]=='Huadeng' else start))
            if valid:scoped['targetHuadeng' if scope[0]=='Huadeng' else 'concurrentXingxinShared']+=1
            else:unclassified+=1
        batch_ok=True
        for key,row in newb.items():
            if key in oldb:continue
            children=[r for r in new.values() if r['ImportBatchId']==key]
            batch_ok=bool(batch_ok and children and all(r['Company']==row['Company'] and r['MailOwnerId']==row['MailOwnerId'] and r['MailboxKey'] for r in children)
                and row['Kind']=='Email' and row['Status']=='PendingConfirmation' and row['TotalCount']==len(children)
                and row['FailedCount']==sum(r['Status']=='failed' for r in children)
                and row['ParsedCount']==sum(r['Status']!='failed' for r in children))
        def sender_counts(rows,company,owner,date_start=None):
            return collections.Counter(normalize_email(r['MailSender']) for r in rows if r['Company']==company and
                r['MailOwnerId']==owner and r['MailboxKey'] and (date_start is None or r['MailReceivedDate']>=date_start) and normalize_email(r['MailSender']))
        huadeng={owner:sender_counts(additions,'Huadeng',owner) for owner in OWNERS}
        # Startup's case-insensitive dictionary recomputes only existing eligible
        # Xingxin sender groups. Ambiguous old counters are not waived.
        xold=sender_counts(old.values(),'Xingxin',0,start);xnew=sender_counts(new.values(),'Xingxin',0,start)
        exact_contacts=collections.Counter((r['Company'],r['MailOwnerId'],r['Email']) for r in newc.values())
        required_huadeng={(owner,email) for owner,counts in huadeng.items() for email in counts}|required_original_senders
        missing_huadeng=sum(exact_contacts[('Huadeng',owner,email)]!=1 for owner,email in required_huadeng)
        xcontacts=[r['Email'] for r in newc.values() if (r['Company'],r['MailOwnerId'])==('Xingxin',0)]
        # ASCII addresses have the same case equality here as OrdinalIgnoreCase.
        # Do not silently merge case-colliding or unproven Unicode groups.
        xfolded=collections.Counter(email.lower() for email in xcontacts if email.isascii())
        xcase_ambiguities=sum(count>1 for count in xfolded.values())+sum(not email.isascii() for email in xcontacts)
        missing_xingxin=sum(not email.isascii() or xfolded[email]!=1 for email in xnew)
        group_coverage=missing_huadeng==missing_xingxin==xcase_ambiguities==0
        retained=not(set(oldc)-set(newc));stable=True;equations=True;unattributed=0;time_bounds=True
        lower=utc_date(read_json(BACKUP/'sqlite-snapshot.private.json')['startedAtUtc']);upper=dt.datetime.now(dt.timezone.utc)
        for key,row in newc.items():
            prior=oldc.get(key);scope=(row['Company'],row['MailOwnerId']);email=row['Email']
            if prior is None:
                internal=email.rsplit('@',1)[-1].strip().lower() in {'hanson2.com','royalregent.net'}
                stable=bool(stable and email==normalize_email(email) and row['DefaultCategory']=='Unclassified' and
                    row['ContactType']==('Internal' if internal else 'Unknown') and row['IsConfirmed']==int(internal))
            if prior is None or row['UpdatedAt']!=prior['UpdatedAt'] or row['MessageCount']!=prior['MessageCount']:
                try:time_bounds=bool(time_bounds and lower<=utc_date(row['UpdatedAt'])<=upper)
                except (ValueError,TypeError):time_bounds=False
            if prior is not None:
                stable=bool(stable and all(typed(prior[k])==typed(row[k]) for k in row if k not in {'MessageCount','UpdatedAt'}))
            if scope[0]=='Huadeng' and scope[1] in OWNERS:
                expected=(prior['MessageCount'] if prior else 0)+huadeng[scope[1]][email]+original_sender_delta[(scope[1],email)]
                if prior is None and email not in huadeng[scope[1]] and (scope[1],email) not in required_original_senders:unattributed+=1
            elif scope==('Xingxin',0) and email.lower() in xold:
                expected=xnew[email.lower()]
            elif scope==('Xingxin',0) and prior is None and email.lower() in xnew:
                expected=xnew[email.lower()]
            elif prior is not None:
                expected=prior['MessageCount']
                if row['MessageCount']!=expected or row['UpdatedAt']!=prior['UpdatedAt']:unattributed+=1
            else:
                expected=None;unattributed+=1
            equations=bool(equations and expected is not None and row['MessageCount']==expected)
        return {'newMailCategories':dict(scoped),'unclassifiedNewMailCount':unclassified,
                'newBatchCountersMatchActualChildren':batch_ok,'originalContactsRetained':retained,
                'contactStableTypedFieldsIdentical':stable,'contactCounterEquationPassed':equations,'exactOriginalSixSenderDeltasIncluded':True,
                'unattributedContactChanges':unattributed,'requiredSenderGroupsHaveUniqueContacts':group_coverage,
                'missingOrNonuniqueHuadengContactGroups':missing_huadeng,'missingOrNonuniqueXingxinContactGroups':missing_xingxin,
                'xingxinCaseAmbiguityOrUnprovenGroups':xcase_ambiguities,'contactTimestampWindowPassed':time_bounds,'actorProven':False,
                'classificationDescribesCompatibleBehaviorNotConfirmedActor':True,
                'passed':unclassified==0 and batch_ok and retained and stable and equations and time_bounds and group_coverage and unattributed==0}


# This exact read-only receipt independently established eligibility of six
# original rows. It never replaces or mutates the complete-v3 baseline.
ORIGINAL_AUDIT = ROOT/'deploy/backups/voyageplex-original-failed-audit-20261019'
ORIGINAL_AUDIT_RESULT = '795823c64977b4e5a2f1982b9fca786bcccb44a4650a0b027edf7efadebef1bf'
ORIGINAL_AUDIT_SEAL = '934987cac44e39834a80ff54c1555ffeb9b87d9a89e91354f60c544f11998025'


def original_retry_targets():
    verify_seal(ORIGINAL_AUDIT)
    require(file_sha(ORIGINAL_AUDIT/'first-result.json')==ORIGINAL_AUDIT_RESULT and
        file_sha(ORIGINAL_AUDIT/'seal.json')==ORIGINAL_AUDIT_SEAL,'EXACT_ORIGINAL_SIX_READONLY_PROBE_REQUIRED')
    evidence=read_json(ORIGINAL_AUDIT/'first-result.json');observations=evidence.get('observations',[])
    gates={'apiHandlingEligible','identityMatching','noSecondaryTaskReference','originalBatchTypedRowUnchanged',
        'originalTypedRowUnchanged','original_start_unchanged','received_on_or_after_oct08',
        'stored_received_date_consistent','uidInOriginalEligibleCandidates'}
    require(evidence.get('completed') is True and evidence.get('priorResultsPreserved') is True and
        evidence.get('databaseSchemaMatchesBaseline') is True and evidence.get('originalFailedCount')==6 and
        len(observations)==6 and dict(collections.Counter(r.get('owner') for r in observations))=={2:2,3:2,5:2} and
        all(all(type(r.get(g)) is int and r[g]==1 for g in gates) and r.get('current_status')=='failed' and
            r.get('uidInCurrentEligibleCandidates') is None for r in observations),'SIX_PROBE_GATES_REQUIRED')
    items=read_json(ORIGINAL_AUDIT/'original-six.private.json')
    require(isinstance(items,list) and len(items)==6 and len({r.get('id') for r in items})==6 and
        dict(collections.Counter(r.get('owner') for r in items))=={2:2,3:2,5:2},'EXACT_SIX_PRIVATE_IDENTITIES_REQUIRED')
    with connect(BACKUP/'baseline.sqlite3') as db:
        for item in items:
            require(type(item.get('id')) is int and item['id']>0 and type(item.get('uid')) is int and
                0<item['uid']<=4294967295,'PRIVATE_ORIGINAL_ID_AND_UID_REQUIRED')
            row=db.execute('SELECT * FROM ImportEmailItems WHERE Id=?',(item['id'],)).fetchone()
            batch=db.execute('SELECT * FROM ImportBatches WHERE Id=?',(item.get('batchId'),)).fetchone()
            require(row is not None and batch is not None and row['Status']=='failed' and row['Company']=='Huadeng' and
                row['MailOwnerId']==item['owner'] and row['ImportBatchId']==item['batchId'] and
                row['MailboxKey'].rsplit(':',1)[-1]==str(item['uid']) and
                row_sha(dict(row))==item.get('beforeSHA256')==item.get('currentSHA256') and
                row_sha(dict(batch))==item.get('beforeBatchSHA256')==item.get('currentBatchSHA256'),
                'PROBE_PRIVATE_MAP_MUST_MATCH_COMPLETE_BASELINE_ROWS')
    return {item['id']:item for item in items}


def original_retry_proof(path):
    targets=original_retry_targets();history=retry_attempt_history();approved={};deltas=collections.Counter();required=set()
    for reserved,receipt in history:
        if reserved['id'] not in targets or receipt.get('passed') is not True:continue
        item_id=reserved['id'];require(item_id not in approved,'ORIGINAL_ID_MAY_HAVE_ONLY_ONE_SEALED_SUCCESS')
        require(reserved.get('authorizedOriginal') is True and reserved['owner']==targets[item_id]['owner'],
                'ONLY_EXPLICITLY_AUTHORIZED_ORIGINAL_PLAN_MAY_PROVE_SUCCESS')
        before_path=reserved['_afterSnapshot'].with_name('before.sqlite3')
        require(retry_transition(before_path,reserved['_afterSnapshot'],item_id)['passed'],
                'ORIGINAL_SUCCESS_REQUIRES_INDEPENDENT_FULL_TRANSITION_PROOF')
        with connect(before_path) as before,connect(reserved['_afterSnapshot']) as after:
            old=dict(before.execute('SELECT * FROM ImportEmailItems WHERE Id=?',(item_id,)).fetchone())
            new=dict(after.execute('SELECT * FROM ImportEmailItems WHERE Id=?',(item_id,)).fetchone())
        require(row_sha(old)==targets[item_id]['beforeSHA256'],'ORIGINAL_RETRY_MUST_START_FROM_EXACT_BASELINE_ROW')
        approved[item_id]=new
        old_sender,new_sender=normalize_email(old['MailSender']),normalize_email(new['MailSender']);owner=old['MailOwnerId']
        if old_sender!=new_sender:
            if old_sender:deltas[(owner,old_sender)]-=1
            if new_sender:deltas[(owner,new_sender)]+=1
        if new_sender:required.add((owner,new_sender))
    with connect(BACKUP/'baseline.sqlite3') as before,connect(path) as after:
        stable,old,new=preserved_mail_hashes(before,after,set(approved))
        all_success_rows_match=all(item_id in new and new[item_id]==row_sha(row) for item_id,row in approved.items())
        changes=collections.Counter(targets[item_id]['batchId'] for item_id in approved)
        batch_ok=preserved_batch_counters(before,after,changes)
    public={'exactAuthorizedOriginalCount':6,'recoveredOriginalCount':len(approved),
        'recoveredOriginalCountsByOwner':dict(collections.Counter(targets[i]['owner'] for i in approved)),
        'remainingOriginalCount':6-len(approved),'allOtherOriginalTypedMailFieldsIdentical':stable,
        'originalBatchChangesExactlyAuthorizedRetryCounts':batch_ok,
        'successfulOriginalRowsMatchSealedAfterSnapshots':all_success_rows_match,
        'originalFullRowIdentityIntentionallyNotClaimed':True,
        'passed':stable and batch_ok and all_success_rows_match}
    return public,targets,approved,deltas,required


def selected_backup():
    prior_failure()  # First and second failed backups remain immutable evidence.
    verify_seal(BACKUP)
    require(file_sha(BACKUP / 'first-result.json') == COMPLETED_BACKUP_RESULT_SHA256 and
            file_sha(BACKUP / 'seal.json') == COMPLETED_BACKUP_SEAL_SHA256,
            'EXACT_COMPLETED_V3_BACKUP_RECEIPT_REQUIRED')
    result = read_json(BACKUP / 'first-result.json')
    require(result.get('mode') == 'backup' and result.get('backupComplete') is True and
            result.get('source') == BASE and result.get('privateBackupId') == BACKUP.name,
            'SUCCESSFUL_ORIGINAL_BACKUP_REQUIRED')
    return read_json(BACKUP / 'bindings.private.json'), read_json(BACKUP / 'candidates.private.json'), read_json(BACKUP / 'typed-tables.private.json')


def backup(directory, result):
    require(command(['git', '-C', str(ROOT), 'rev-parse', 'HEAD']).decode().strip() == BASE, 'PREDEPLOY_BASE_REQUIRED')
    private, safe = runtime()
    write_new(directory / 'sqlite-snapshot.private.json', online_backup(directory / 'baseline.sqlite3'))
    bindings = settings_and_bindings(directory / 'baseline.sqlite3')
    entries, flags = configuration(private['voyageplex-api'], bindings)
    write_new(directory / 'typed-tables.private.json', table_snapshot(directory / 'baseline.sqlite3'))
    files = backup_files(directory / 'data-files')
    write_new(directory / 'data-files.private.json', files)
    write_new(directory / 'bindings.private.json', bindings)
    old_dll = command(['docker', 'exec', private['voyageplex-api']['Id'], 'sha256sum', '/app/VoyagePlex.Api.dll']).decode().split()[0]
    require(re.fullmatch('[a-f0-9]{64}', old_dll) is not None, 'OLD_DLL_HASH_SHAPE')
    write_new(directory / 'runtime-baseline.private.json', {'services': safe, 'apiDLLSHA256': old_dll})
    candidate = candidates(private, entries, bindings)
    write_new(directory / 'candidates.private.json', candidate)
    result.update({'source': BASE, 'backupComplete': True, 'sqliteOnlineBackup': True,
                   'allNonSQLiteFilesPrivatelyCopied': True, 'databaseAndFilesAreNotOneAtomicSnapshot': True,
                   'historicalSQLiteFilesIndividuallyVerified': True, 'independentDatabasesAreNotOneAtomicSnapshot': True,
                   'historicalSQLiteFileCount': sum(item.get('historicalSQLiteIndividuallyVerified') is True for item in files.values()),
                   'candidateMetadataExecutionLocation': 'server-host-independent-standard-library-child',
                   'candidateSearchDoesNotRepeatParserNetworkConnectivityProof': True,
                   'bindings': flags, 'candidates': candidate_summary(candidate), 'services': safe})


def recover(directory, result, original_bindings, original_candidates, original_tables):
    deadline = time.monotonic() + 18 * 60
    private, safe = runtime()
    result['runtimeBefore'] = source_and_health(private, safe)
    bindings = settings_and_bindings()
    entries, flags = configuration(private['voyageplex-api'], bindings)
    require_existing_admin_mail_scope()
    require(all(bindings[owner]['setting'] == original_bindings[str(owner)]['setting'] and
                bindings[owner]['user'] == original_bindings[str(owner)]['user'] for owner in OWNERS), 'SETTINGS_AND_USERS_UNCHANGED')
    base = service_base(private, 'voyageplex-api', 5088)
    result['bindings'] = flags
    plan,excluded=freeze_retry_plan(directory)
    result['ownerRuns'] = []
    result['temporarySessionsCleaned'] = False
    result['allBatchResponsesSucceeded'] = False
    # One small batch per owner per round prevents the first mailbox monopolizing this continuation.
    stopped = set()
    try:
        with sessions([ADMIN], result) as tokens:
            prior_test = successful_prior_mailbox_tests()
            if prior_test is None:
                result['mailboxTestsBeforeRecovery'] = mailbox_tests(base, tokens[ADMIN], directory, 'before-recovery')
                require(result['mailboxTestsBeforeRecovery']['allFourConnected'], 'ALL_FOUR_RUNNING_PARSER_TESTS_BEFORE_RECOVERY_REQUIRED')
            else:
                result['preRecoveryMailboxTestReceipt'] = prior_test
            stopped.update(retry_new_failures(directory,result,base,tokens[ADMIN],deadline,plan,excluded))
            while time.monotonic() < deadline - 340 and len(stopped) < len(OWNERS):
                for owner in OWNERS:
                    if owner in stopped or time.monotonic() >= deadline - 340:
                        continue
                    prior = settings_and_bindings()[owner]['state']['LastUid']
                    prior_failed = owner_failed_count(owner)
                    # A transport timeout aborts this continuation; no overlapping follow-up POST.
                    code, value = http(base, '/api/imports/email/mailbox/sync', tokens[ADMIN], owner, post=True, timeout=330)
                    require(isinstance(value, dict), 'SYNC_RESPONSE_OBJECT_REQUIRED')
                    after = settings_and_bindings()[owner]['state']['LastUid']
                    new_failed = max(0, owner_failed_count(owner) - prior_failed)
                    imported = value.get('imported')
                    blocked = value.get('blockedUid')
                    require(imported is None or type(imported) is int and 0 <= imported <= 5, 'SMALL_BATCH_RESPONSE_REQUIRED')
                    require(blocked is None or type(blocked) is int and 0 < blocked <= 4294967295,
                            'BLOCKED_UID_MUST_BE_UINT32_INTEGER')
                    blocked_guard = blocked is None or after < blocked
                    batch_success = (code == 200 and value.get('configured') is True and
                                     imported is not None and not value.get('error') and blocked is None and new_failed == 0)
                    item = {'owner': owner, 'status': code, 'imported': imported, 'cursorBefore': prior, 'cursorAfter': after,
                            'blockedUIDPresent': blocked is not None, 'errorPresent': bool(value.get('error')),
                            'configured': value.get('configured') is True, 'blockedCursorGuardPassed': blocked_guard,
                            'newFailedDuringBatchInterval': new_failed, 'batchSucceeded': batch_success}
                    result['ownerRuns'].append(item)
                    write_new(directory / ('batch-%04d.json' % len(result['ownerRuns'])), item)
                    # Exact blocked UID stays in the private receipt, never the public aggregate.
                    if blocked is not None:
                        write_new(directory / ('blocked-%04d.private.json' % len(result['ownerRuns'])), {'owner': owner, 'blockedUid': blocked})
                    require(after >= prior, 'CURSOR_MUST_NOT_REGRESS')
                    require(blocked_guard, 'CURSOR_MUST_STAY_BEFORE_BLOCKED_UID')
                    if not batch_success:
                        stopped.add(owner)
                    elif imported == 0 and after == prior:
                        stopped.add(owner)
        result['temporarySessionsCleaned'] = True
        result['recoveryRunFinished'] = True
        result['allBatchResponsesSucceeded'] = bool(result['ownerRuns']) and all(row['batchSucceeded'] for row in result['ownerRuns'])
    finally:
        # Retain actual committed state even after timeout, blocked UID or cleanup failure.
        snapshot = retain_snapshot(directory)
        result['databaseComparison'] = compare_tables(original_tables, snapshot)
        result['authorizedOriginalFailedRetries']=original_retry_proof(directory/'current.sqlite3')[0]
        result['firstRecoveryCheckpointPreservation']=checkpoint_preservation(directory/'current.sqlite3')
        result['classifiedMailChanges']=classified_mail_changes(directory/'current.sqlite3')
        mark_user_test_category(result['databaseComparison'])
        result['userPreservation'] = compare_original_users(directory)
        result['newDatabaseMailRecordsSinceBackup'] = new_mail_counts(original_tables, snapshot, directory / 'current.sqlite3')
        result['allNewMessagesParsedOrRecognizedDuplicate'] = all_new_parsed_or_duplicate(result['newDatabaseMailRecordsSinceBackup'])
        result['files'] = compare_files(directory)
        write_new(directory / 'bindings-after.private.json', settings_and_bindings(directory / 'current.sqlite3'))
        _, result['runtimeAfter'] = runtime()
        result['runBudgetSeconds'] = 18 * 60
        result['perPostHardTimeoutSeconds'] = 330
        result['remainingRunTimeRequiredBeforePostSeconds'] = 340
        result['continuationMayBeRequired'] = True
        result['independentCandidateCoverageAuditStillRequired'] = True
        result['reportedImportedAcrossBatches'] = sum(v['imported'] or 0 for v in result['ownerRuns'])
        result['fullStaticIdentity'] = all(r['added'] == r['removed'] == r['changed'] == 0 for r in result['databaseComparison'])



def audit(directory, result, original_bindings, original_candidates, original_tables):
    private, safe = runtime()
    result['runtime'] = source_and_health(private, safe)
    bindings = settings_and_bindings()
    entries, flags = configuration(private['voyageplex-api'], bindings)
    require_existing_admin_mail_scope()
    base = service_base(private, 'voyageplex-api', 5088)
    result['preRecoveryMailboxTestReceipt'] = successful_prior_mailbox_tests()
    with sessions([ADMIN], result) as tokens:
        result['mailboxTestsAfterRecovery'] = mailbox_tests(base, tokens[ADMIN], directory, 'after-recovery')
    current = candidates(private, entries, bindings)
    write_new(directory / 'current-candidates.private.json', current)
    snapshot = retain_snapshot(directory)
    saved_bindings = settings_and_bindings(directory / 'current.sqlite3')
    write_new(directory / 'bindings.private.json', saved_bindings)
    coverage = uid_coverage(directory / 'current.sqlite3', original_candidates, current, saved_bindings)
    result['permissions'] = permission_checks(service_base(private, 'voyageplex-api', 5088), coverage, result)
    for row in coverage:
        row.pop('_sample', None)
    result['coverage'] = coverage
    result['originalCandidates'] = candidate_summary(original_candidates)
    result['currentCandidates'] = candidate_summary(current)
    result['bindings'] = flags
    result['databaseComparison'] = compare_tables(original_tables, snapshot)
    mark_user_test_category(result['databaseComparison'])
    result['userPreservation'] = compare_original_users(directory)
    result['newDatabaseMailRecordsSinceBackup'] = new_mail_counts(original_tables, snapshot, directory / 'current.sqlite3')
    result['allNewMessagesParsedOrRecognizedDuplicate'] = all_new_parsed_or_duplicate(result['newDatabaseMailRecordsSinceBackup'])
    result['files'] = compare_files(directory)
    result['authorizedOriginalFailedRetries']=original_retry_proof(directory/'current.sqlite3')[0]
    result['firstRecoveryCheckpointPreservation']=checkpoint_preservation(directory/'current.sqlite3')
    result['classifiedMailChanges']=classified_mail_changes(directory/'current.sqlite3')
    result['settingsAndConfiguredIdentityFieldsUnchanged'] = all(
        bindings[owner]['setting'] == original_bindings[str(owner)]['setting'] and
        bindings[owner]['user'] == original_bindings[str(owner)]['user'] for owner in OWNERS)
    result['allOriginalEligibleUIDsCovered'] = all(row['originalMissingCount'] == 0 for row in coverage)
    result['allCurrentEligibleUIDsCoveredAtSearch'] = all(row['currentMissingCount'] == 0 for row in coverage)
    result['fourIndependentCursors'] = len({row['cursorId'] for row in coverage}) == 4
    result['noCursorErrors'] = all(not row['cursorErrorPresent'] for row in coverage)
    result['allConfiguredFourRoleChecksCompleted'] = (result['permissions']['adminExistingScope'] and
        {row['owner'] for row in result['permissions']['shipping']} == {3, 5, 6})
    result['fourParserConnectionsPassedBeforeAndAfterRecovery'] = (
        result['preRecoveryMailboxTestReceipt'] is not None and result['mailboxTestsAfterRecovery']['allFourConnected'])
    result['allOriginalUserFieldsPreservedExceptAuthorizedTests'] = (
        result['userPreservation']['allNonTestTypedUserFieldsIdentical'] and
        result['userPreservation']['onlyFourTargetUsersHaveAnyRowChanges'])
    result['unchangedOtherBusinessTables'] = all(
        row['added'] == row['removed'] == row['changed'] == 0 for row in result['databaseComparison']
        if row['expectedCategory'] == 'unchanged-required')
    result['existingMailRowsRetained'] = all(row['originalRowsIdentical'] for row in result['databaseComparison']
        if row['table'] in {'ImportEmailItems', 'ImportBatches'})
    result['existingContactsOnlyCounterAndTimestampChanged'] = all(row['onlyContactCounterAndTimestampChanged']
        for row in result['databaseComparison'] if row['table'] == 'MailContacts')
    result['mailAndContactAdditionsOnlyTargetOwners'] = all(row['allAddedRowsAreFourTargetOwners']
        for row in result['databaseComparison'] if row['table'] in {'ImportEmailItems', 'ImportBatches', 'MailContacts'})
    result['contactUpdatesOnlyTargetOwners'] = all(row['allChangedRowsAreFourTargetOwners']
        for row in result['databaseComparison'] if row['table'] == 'MailContacts')
    result['fullStaticIdentity'] = all(row['added'] == row['removed'] == row['changed'] == 0 for row in result['databaseComparison'])
    result['strictTargetOnlyScopeChecksPassed']=result['mailAndContactAdditionsOnlyTargetOwners'] and result['contactUpdatesOnlyTargetOwners']
    result['classifiedMailChangesPassed']=result['classifiedMailChanges']['passed']
    result['firstRecoveryCheckpointPassed']=result['firstRecoveryCheckpointPreservation']['passed']
    result['authorizedOriginalFailedRetriesVerified']=result['authorizedOriginalFailedRetries']['passed']
    result['allSixAuthorizedOriginalFailuresRecovered']=result['authorizedOriginalFailedRetries']['recoveredOriginalCount']==6
    result['auditPassed'] = all(result[k] for k in ['settingsAndConfiguredIdentityFieldsUnchanged', 'allOriginalEligibleUIDsCovered',
        'allCurrentEligibleUIDsCoveredAtSearch', 'fourIndependentCursors', 'noCursorErrors', 'unchangedOtherBusinessTables',
        'authorizedOriginalFailedRetriesVerified', 'existingContactsOnlyCounterAndTimestampChanged',
        'classifiedMailChangesPassed', 'firstRecoveryCheckpointPassed',
        'allConfiguredFourRoleChecksCompleted', 'fourParserConnectionsPassedBeforeAndAfterRecovery',
        'allOriginalUserFieldsPreservedExceptAuthorizedTests']) and result['files']['allOriginalFileBytesPreserved']
    result['auditPassedScope'] = 'UID archival coverage, original data preservation, live connection and existing access controls'
    result['recoveryFullyVerified'] = result['auditPassed'] and result['allNewMessagesParsedOrRecognizedDuplicate'] and result['allSixAuthorizedOriginalFailuresRecovered']



def main():
    require(len(sys.argv) == 2 and sys.argv[1] in {'backup', 'recover', 'audit'}, 'FIXED_MODE_REQUIRED')
    mode = sys.argv[1]
    run_id = os.environ.get('MAIL_RECOVERY_RUN_ID', '')
    require(os.environ.get('MAIL_RECOVERY_BRANCH') == BRANCH and os.environ.get('MAIL_RECOVERY_ATTEMPT') == '1'
            and re.fullmatch('[1-9][0-9]{5,19}', run_id) is not None, 'FIXED_WORKFLOW_FIRST_ATTEMPT_REQUIRED')
    if mode != 'backup':
        require(FINAL_PIN_FROZEN and SECONDARY_TASK_API_GUARD_PIN_FROZEN, 'FINAL_REVIEWED_PIN_NOT_FROZEN')
    original = None
    prior_receipts = []
    if mode == 'backup':
        retained_failure = prior_failure()
        directory = BACKUP
    else:
        original = selected_backup()
        first_recovery()
        original_retry_targets()
        RUNS.mkdir(mode=0o700, exist_ok=True)
        require(not RUNS.is_symlink() and len(list(RUNS.iterdir())) < MAX_RUNS, 'BOUNDED_CONTINUATIONS_REQUIRED')
        for prior in RUNS.iterdir():
            require(prior.is_dir() and not prior.is_symlink(), 'PRIOR_RUN_DIRECTORY_REQUIRED')
            if prior==SECONDARY_GUARD_PREVIOUS_RUN:
                partial_previous_archive(force_full=True)
                prior_receipts.append({'run':prior.name,'failedPartial':True,
                    'externalReconciliationResultSHA256':PARTIAL_RECONCILIATION_RESULT_SHA256,
                    'externalReconciliationSealSHA256':PARTIAL_RECONCILIATION_SEAL_SHA256})
            else:
                verify_seal(prior)
                prior_receipts.append({'run': prior.name, 'sealSHA256': file_sha(prior / 'seal.json'),
                                       'resultSHA256': file_sha(prior / 'first-result.json')})
        directory = RUNS / (mode + '-' + run_id)
    directory.mkdir(mode=0o700)  # O_EXCL equivalent: never repeat or overwrite this run.
    result = {'mode': mode, 'runId': run_id, 'privateBackupId': BACKUP.name,
              'resultPath': str(directory / 'first-result.json'), 'priorResultsPreserved': True,
              'sessionLifetimeMinutes': 25, 'cursorOrSettingsWrittenByOps': False,
              'containersOrConfigurationChangedByOps': False, 'secretsOrMailContentPrinted': False,
              'success': False, 'allMailboxRecoveryVerified': False,
              'priorContinuationReceipts': sorted(prior_receipts, key=lambda v: v['run'])}
    if mode == 'backup':
        result['priorFailures'] = retained_failure
    def terminate(*_):
        require(False, 'WORKFLOW_TERMINATION_REQUESTED')
    old_handler = signal.signal(signal.SIGTERM, terminate)
    try:
        if mode == 'backup':
            backup(directory, result)
        elif mode == 'recover':
            recover(directory, result, *original)
        else:
            audit(directory, result, *original)
        result['success'] = (result.get('recoveryFullyVerified', False) if mode == 'audit' else
                             (result.get('allBatchResponsesSucceeded', False) and result.get('allRetryResponsesSucceeded',False)) if mode == 'recover' else True)
        result['allMailboxRecoveryVerified'] = result.get('recoveryFullyVerified', False)
    except BaseException as error:
        result['failed'] = True
        result['failedCheck'] = str(error) if isinstance(error, CheckError) and str(error) in SAFE_CODES else 'REDACTED_OPERATION_FAILURE'
        result['exceptionType'] = type(error).__name__ if type(error).__name__ in {
            'CheckError', 'TimeoutError', 'OperationalError', 'IntegrityError', 'URLError', 'HTTPError', 'ValueError', 'OSError'} else 'Other'
    finally:
        try:
            if mode == 'backup':
                prior_failure()
            else:
                verify_seal(BACKUP)
                first_recovery()
                original_retry_targets()
                partial_previous_archive(force_full=True)
                result['partialArchiveBytesVerifiedAtStartAndFinish'] = True
            result['finalRetainedEvidenceVerified'] = True
        except BaseException:
            result['finalRetainedEvidenceVerified'] = False
            result['partialArchiveBytesVerifiedAtStartAndFinish'] = False
            result['success'] = False
            result['allMailboxRecoveryVerified'] = False
            result['recoveryFullyVerified'] = False
            result['failed'] = True
            result['failedCheck'] = 'FINAL_RETAINED_EVIDENCE_VERIFICATION_FAILED'
        write_new(directory / 'first-result.json', result)
        seal(directory)
        emit(result)
        emit({'kind': 'receipt', 'mode': mode, 'runId': run_id, 'resultPath': result['resultPath'],
              'resultSHA256': file_sha(directory / 'first-result.json'), 'sealSHA256': file_sha(directory / 'seal.json'),
              'originalBackupSealSHA256': file_sha(BACKUP / 'seal.json')})
        signal.signal(signal.SIGTERM, old_handler)
    return 0 if result['success'] else 1


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception:
        # Setup or receipt finalization can fail before or after recovery requests.
        emit({'failed': True, 'phase': 'setup-or-receipt-failure', 'reason': 'REDACTED_SETUP_OR_RECEIPT_FAILURE'})
        sys.exit(1)
