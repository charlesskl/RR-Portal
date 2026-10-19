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
DEPLOYED_HEAD = '53f482f4b71fc0fd4c6696e9ec4b2058e6a342bc'
SOURCE_FILES = {
    "apps/\u8239\u52a1\u90e8/VoyagePlex\u8239\u52a1\u534f\u540c\u7cfb\u7edf/server/VoyagePlex.Api/Program.cs": "49032d0113e32a718cd5d67a8115dd23c7b84567d00dc4be4e861bf061204d23",
    "apps/\u8239\u52a1\u90e8/VoyagePlex\u8239\u52a1\u534f\u540c\u7cfb\u7edf/server/VoyagePlex.Api/Services/MailboxSyncService.cs": "ccf8ee214a302fb939450cdb350420047c6e32da4091946f22490a79eec81b37",
    "apps/\u8239\u52a1\u90e8/VoyagePlex\u8239\u52a1\u534f\u540c\u7cfb\u7edf/server/VoyagePlex.Api/Services/EmailParserClient.cs": "90346ecbe62d6591bec40b6a4f56e529b539e7e087e126d594bf08485dcd9831",
    "apps/\u8239\u52a1\u90e8/VoyagePlex\u8239\u52a1\u534f\u540c\u7cfb\u7edf/server/VoyagePlex.Api/Services/ServerMailboxConfiguration.cs": "24985cac1ea3e80b3f23e51f0926f0c3372123a1590ba93087d30265870b55a4",
    "apps/\u8239\u52a1\u90e8/VoyagePlex\u8239\u52a1\u534f\u540c\u7cfb\u7edf/server/VoyagePlex.Api/Data/AppDbContext.cs": "d1ecb504b20d431a4a229b32757a47f99e6efd859011d5c714fdec0100547f00",
    "apps/\u8239\u52a1\u90e8/VoyagePlex\u8239\u52a1\u534f\u540c\u7cfb\u7edf/server/VoyagePlex.Api/VoyagePlex.Api.csproj": "faf8094592160f6a187a9eef395031ff70c68ac2a13ad4b0c6f5f9b6c5ccb313",
    "apps/\u8239\u52a1\u90e8/VoyagePlex\u8239\u52a1\u534f\u540c\u7cfb\u7edf/Dockerfile.api": "6dea36116bdffd3ae8fdb6d39050786b4ac89b2c2620738c264df7035fc017a9",
    "apps/\u8239\u52a1\u90e8/VoyagePlex\u8239\u52a1\u534f\u540c\u7cfb\u7edf/services/email-parser/app/main.py": "37f22c5ac2fc3b22f4d93e5085b08d2046f91c5cbf2def0ea233ac2385429408",
    "apps/\u8239\u52a1\u90e8/VoyagePlex\u8239\u52a1\u534f\u540c\u7cfb\u7edf/services/email-parser/app/mailbox.py": "d52ca6140ce7231c64d277fb9b8d5d5c1103847d7d08348f5aeb288ad3daa4df",
    "apps/\u8239\u52a1\u90e8/VoyagePlex\u8239\u52a1\u534f\u540c\u7cfb\u7edf/services/email-parser/app/mail_worker.py": "ce2ffce53b81224a636d6bc15a1789b7744f0246043b8dc431b7f46a92383407",
    "apps/\u8239\u52a1\u90e8/VoyagePlex\u8239\u52a1\u534f\u540c\u7cfb\u7edf/services/email-parser/requirements.txt": "a4c21a5b044539deec682a8a98c37ae97b953a344ea8a5bb659ba32454966daa",
    "apps/\u8239\u52a1\u90e8/VoyagePlex\u8239\u52a1\u534f\u540c\u7cfb\u7edf/services/email-parser/Dockerfile": "098b11980f4589e84d25d9691a97ba2676c0bc27c337e3cd74d97cefb74918b9"
}
PARSER_FILES = {
    "/app/app/main.py": "37f22c5ac2fc3b22f4d93e5085b08d2046f91c5cbf2def0ea233ac2385429408",
    "/app/app/mailbox.py": "d52ca6140ce7231c64d277fb9b8d5d5c1103847d7d08348f5aeb288ad3daa4df",
    "/app/app/mail_worker.py": "ce2ffce53b81224a636d6bc15a1789b7744f0246043b8dc431b7f46a92383407"
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


def http(base, route, token=None, owner=None, post=False, timeout=10, status_only=False):
    headers = {'Content-Type': 'application/json'}
    if token is not None:
        cookie = 'voyageplex_session=' + token + '; voyageplex_company=Huadeng'
        if owner is not None:
            cookie += '; voyageplex_mail_owner=' + str(owner)
        headers['Cookie'] = cookie
    request = urllib.request.Request(base + route, headers=headers, data=b'{}' if post else None,
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
    require(FINAL_PIN_FROZEN and re.fullmatch('[a-f0-9]{40}', DEPLOYED_HEAD) is not None
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
            'apiImageChangedSinceBackup': True, 'apiPublishedDLLChangedSinceBackup': True,
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
    result['auditPassed'] = all(result[k] for k in ['settingsAndConfiguredIdentityFieldsUnchanged', 'allOriginalEligibleUIDsCovered',
        'allCurrentEligibleUIDsCoveredAtSearch', 'fourIndependentCursors', 'noCursorErrors', 'unchangedOtherBusinessTables',
        'existingMailRowsRetained', 'existingContactsOnlyCounterAndTimestampChanged',
        'mailAndContactAdditionsOnlyTargetOwners', 'contactUpdatesOnlyTargetOwners',
        'allConfiguredFourRoleChecksCompleted', 'fourParserConnectionsPassedBeforeAndAfterRecovery',
        'allOriginalUserFieldsPreservedExceptAuthorizedTests']) and result['files']['allOriginalFileBytesPreserved']
    result['auditPassedScope'] = 'UID archival coverage, original data preservation, live connection and existing access controls'
    result['recoveryFullyVerified'] = result['auditPassed'] and result['allNewMessagesParsedOrRecognizedDuplicate']



def main():
    require(len(sys.argv) == 2 and sys.argv[1] in {'backup', 'recover', 'audit'}, 'FIXED_MODE_REQUIRED')
    mode = sys.argv[1]
    run_id = os.environ.get('MAIL_RECOVERY_RUN_ID', '')
    require(os.environ.get('MAIL_RECOVERY_BRANCH') == BRANCH and os.environ.get('MAIL_RECOVERY_ATTEMPT') == '1'
            and re.fullmatch('[1-9][0-9]{5,19}', run_id) is not None, 'FIXED_WORKFLOW_FIRST_ATTEMPT_REQUIRED')
    if mode != 'backup':
        require(FINAL_PIN_FROZEN, 'FINAL_REVIEWED_PIN_NOT_FROZEN')
    original = None
    prior_receipts = []
    if mode == 'backup':
        retained_failure = prior_failure()
        directory = BACKUP
    else:
        original = selected_backup()
        RUNS.mkdir(mode=0o700, exist_ok=True)
        require(not RUNS.is_symlink() and len(list(RUNS.iterdir())) < MAX_RUNS, 'BOUNDED_CONTINUATIONS_REQUIRED')
        for prior in RUNS.iterdir():
            require(prior.is_dir() and not prior.is_symlink(), 'PRIOR_RUN_DIRECTORY_REQUIRED')
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
                             result.get('allBatchResponsesSucceeded', False) if mode == 'recover' else True)
        result['allMailboxRecoveryVerified'] = result.get('recoveryFullyVerified', False)
    except BaseException as error:
        result['failed'] = True
        result['failedCheck'] = str(error) if isinstance(error, CheckError) and str(error) in SAFE_CODES else 'REDACTED_OPERATION_FAILURE'
        result['exceptionType'] = type(error).__name__ if type(error).__name__ in {
            'CheckError', 'TimeoutError', 'OperationalError', 'IntegrityError', 'URLError', 'HTTPError', 'ValueError', 'OSError'} else 'Other'
    finally:
        write_new(directory / 'first-result.json', result)
        seal(directory)
        if mode == 'backup':
            prior_failure()  # Original files, receipt and full seal must remain unchanged.
        if mode != 'backup':
            verify_seal(BACKUP)
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
