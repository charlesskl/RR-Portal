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
import time
import urllib.error
import urllib.request

os.umask(0o077)
ROOT = pathlib.Path('/opt/rr-portal')
APP = pathlib.Path('apps/船务部/VoyagePlex船务协同系统')
DATA = ROOT / APP / 'data-runtime'
DB = DATA / 'voyageplex.db'
BACKUP = ROOT / 'deploy/backups/voyageplex-mail-recovery-20261019'
RUNS = BACKUP.with_name(BACKUP.name + '-runs')
BRANCH = 'refs/heads/ops/voyageplex-mail-recovery-20261019'
BASE = '4932408a0375058b781b9a9c050d4eef65f8728b'
KEY = 'VOYAGEPLEX_HUADENG_MAILBOXES_JSON'
OWNERS = {2: ('tan123', 'lisa666tan@163.com'), 3: ('秦湘柳', 'hyt9833@163.com'),
          5: ('莫秀珍', '13768947334@163.com'), 6: ('麦淳恩', '13471221956@163.com')}
ADMIN = 2
# Root freezes these only after the final independent application review/build.
FINAL_PIN_FROZEN = False
DEPLOYED_HEAD = ''
SOURCE_FILES = {}  # repository-relative source path -> reviewed SHA256
PARSER_FILES = {}  # /app/app/... -> corresponding reviewed SHA256
API_DLL_SHA256 = ''  # optional independent reviewed artifact; absent is explicitly not byte-source proof
EXPECTED_LIMITS = {'voyageplex-api': 768 * 1024**2, 'voyageplex-parser': 512 * 1024**2,
                   'voyageplex-web': 1024**3}
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
        with path.open('rb') as source:
            require(source.read(16) != b'SQLite format 3\x00', 'UNEXPECTED_ADDITIONAL_SQLITE_DATABASE')
        (destination / rel).parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        shutil.copyfile(path, destination / rel)
        (destination / rel).chmod(0o600)
        after = path.stat()
        require((before.st_ino, before.st_size, before.st_mtime_ns) ==
                (after.st_ino, after.st_size, after.st_mtime_ns), 'FILE_CHANGED_DURING_COPY')
        metadata[rel.as_posix()]['sha256'] = file_sha(destination / rel)
        require(metadata[rel.as_posix()]['sha256'] == file_sha(path), 'FILE_COPY_HASH_MISMATCH')
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
    return {'deployedHead': DEPLOYED_HEAD, 'sourceFilesMatch': True, 'parserImageSourceMatches': True,
            'apiPublishedDLLSHA256': actual, 'apiIndependentReviewedArtifactMatches': True if API_DLL_SHA256 else None,
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
def sessions(ids):
    """Only approved existing users; token is memory-only and expires after 25 min."""
    tokens, hashes = {}, []
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
        if hashes:
            with connect(writable=True) as db:
                db.execute('BEGIN IMMEDIATE')
                for digest in hashes:
                    db.execute('DELETE FROM UserSessions WHERE TokenHash=?', (digest,))
                db.commit()
                require(all(db.execute('SELECT COUNT(*) FROM UserSessions WHERE TokenHash=?', (v,)).fetchone()[0] == 0
                            for v in hashes), 'TEMPORARY_SESSION_CLEANUP_REQUIRED')
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
            for row in db.execute("SELECT Id,MailboxKey,Status FROM ImportEmailItems WHERE Company='Huadeng' AND MailOwnerId=? AND MailboxKey<>''", (owner,)):
                key = row['MailboxKey']
                if key.startswith(prefix) and re.fullmatch('[0-9]{1,10}', key[len(prefix):]):
                    uid = int(key[len(prefix):])
                    require(uid not in seen, 'UNIQUE_OWNER_UID_REQUIRED')
                    seen.add(uid)
                    if len(samples) < 1:
                        samples.append(row['Id'])
                    failed += row['Status'] == 'failed'
                    duplicate += row['Status'] == 'duplicate'
            original_set, current_set = set(before['eligible']), set(now['eligible'])
            missing_original, missing_current = original_set - seen, current_set - seen
            result.append({'owner': owner, 'originalEligibleCount': len(original_set), 'originalCoveredCount': len(original_set & seen),
                           'originalMissingCount': len(missing_original), 'currentEligibleCount': len(current_set),
                           'currentCoveredCount': len(current_set & seen), 'currentMissingCount': len(missing_current),
                           'newCurrentEligibleUIDCount': len(current_set - original_set),
                           'originalUIDsNoLongerInCurrentSearch': len(original_set - current_set),
                           'missingAtOrBelowCursorCount': sum(uid <= state['LastUid'] for uid in missing_original | missing_current),
                           'failedRecordsTotal': failed, 'duplicateRecordsTotal': duplicate,
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
            'newFiles': len(set(current) - set(old)), 'allOriginalFileBytesPreserved': missing == changed == 0}


def new_mail_counts(before, after):
    old = before['tables']['ImportEmailItems']['rows']
    new = after['tables']['ImportEmailItems']['rows']
    result = []
    for owner in OWNERS:
        rows = [new[key] for key in set(new) - set(old)
                if new[key]['company'] == 'Huadeng' and new[key]['owner'] == owner and new[key]['mailboxItem']]
        result.append({'owner': owner, 'newDatabaseMailRecords': len(rows),
                       'newFailedRecords': sum(row['status'] == 'failed' for row in rows),
                       'newDuplicateRecords': sum(row['status'] == 'duplicate' for row in rows)})
    return result


def retain_snapshot(directory):
    write_new(directory / 'sqlite-snapshot.private.json', online_backup(directory / 'current.sqlite3'))
    value = table_snapshot(directory / 'current.sqlite3')
    write_new(directory / 'typed-tables.private.json', value)
    return value


def permission_checks(base, coverage):
    results = []
    with connect() as db:
        supervisors = db.execute("SELECT COUNT(*) FROM Users WHERE IsActive=1 AND Role='supervisor' AND CompanyAccess='Huadeng'").fetchone()[0]
    with sessions([ADMIN, 3, 5, 6]) as tokens:
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
            'supervisorFollowupRequired': supervisors > 0,
            'configuredFourMailboxRoles': {'admin': 1, 'shipping': 3, 'supervisor': 0}}


def selected_backup():
    verify_seal(BACKUP)
    result = read_json(BACKUP / 'first-result.json')
    require(result.get('mode') == 'backup' and result.get('backupComplete') is True, 'SUCCESSFUL_ORIGINAL_BACKUP_REQUIRED')
    return read_json(BACKUP / 'bindings.private.json'), read_json(BACKUP / 'candidates.private.json'), read_json(BACKUP / 'typed-tables.private.json')


def backup(directory, result):
    require(command(['git', '-C', str(ROOT), 'rev-parse', 'HEAD']).decode().strip() == BASE, 'PREDEPLOY_BASE_REQUIRED')
    private, safe = runtime()
    write_new(directory / 'sqlite-snapshot.private.json', online_backup(directory / 'baseline.sqlite3'))
    bindings = settings_and_bindings(directory / 'baseline.sqlite3')
    entries, flags = configuration(private['voyageplex-api'], bindings)
    write_new(directory / 'typed-tables.private.json', table_snapshot(directory / 'baseline.sqlite3'))
    write_new(directory / 'data-files.private.json', backup_files(directory / 'data-files'))
    write_new(directory / 'bindings.private.json', bindings)
    old_dll = command(['docker', 'exec', private['voyageplex-api']['Id'], 'sha256sum', '/app/VoyagePlex.Api.dll']).decode().split()[0]
    require(re.fullmatch('[a-f0-9]{64}', old_dll) is not None, 'OLD_DLL_HASH_SHAPE')
    write_new(directory / 'runtime-baseline.private.json', {'services': safe, 'apiDLLSHA256': old_dll})
    candidate = candidates(private, entries, bindings)
    write_new(directory / 'candidates.private.json', candidate)
    result.update({'source': BASE, 'backupComplete': True, 'sqliteOnlineBackup': True,
                   'allNonSQLiteFilesPrivatelyCopied': True, 'databaseAndFilesAreNotOneAtomicSnapshot': True,
                   'candidateMetadataExecutionLocation': 'server-host-independent-standard-library-child',
                   'candidateSearchDoesNotRepeatParserNetworkConnectivityProof': True,
                   'bindings': flags, 'candidates': candidate_summary(candidate), 'services': safe})


def recover(directory, result, original_bindings, original_candidates, original_tables):
    deadline = time.monotonic() + 18 * 60
    private, safe = runtime()
    result['runtimeBefore'] = source_and_health(private, safe)
    bindings = settings_and_bindings()
    entries, flags = configuration(private['voyageplex-api'], bindings)
    require(all(bindings[owner]['setting'] == original_bindings[str(owner)]['setting'] and
                bindings[owner]['user'] == original_bindings[str(owner)]['user'] for owner in OWNERS), 'SETTINGS_AND_USERS_UNCHANGED')
    base = service_base(private, 'voyageplex-api', 5088)
    result['bindings'] = flags
    result['ownerRuns'] = []
    result['temporarySessionsCleaned'] = False
    # One small batch per owner per round prevents the first mailbox monopolizing this continuation.
    stopped = set()
    try:
        with sessions([ADMIN]) as tokens:
            while time.monotonic() < deadline - 160 and len(stopped) < len(OWNERS):
                for owner in OWNERS:
                    if owner in stopped or time.monotonic() >= deadline - 160:
                        continue
                    prior = settings_and_bindings()[owner]['state']['LastUid']
                    # A transport timeout aborts this continuation; no overlapping follow-up POST.
                    code, value = http(base, '/api/imports/email/mailbox/sync', tokens[ADMIN], owner, post=True, timeout=150)
                    require(isinstance(value, dict), 'SYNC_RESPONSE_OBJECT_REQUIRED')
                    after = settings_and_bindings()[owner]['state']['LastUid']
                    imported = value.get('imported')
                    blocked = value.get('blockedUid')
                    require(imported is None or type(imported) is int and 0 <= imported <= 5, 'SMALL_BATCH_RESPONSE_REQUIRED')
                    item = {'owner': owner, 'status': code, 'imported': imported, 'cursorBefore': prior, 'cursorAfter': after,
                            'blockedUIDPresent': blocked is not None, 'errorPresent': bool(value.get('error')),
                            'configured': value.get('configured') is True}
                    result['ownerRuns'].append(item)
                    write_new(directory / ('batch-%04d.json' % len(result['ownerRuns'])), item)
                    require(after >= prior, 'CURSOR_MUST_NOT_REGRESS')
                    if code != 200 or value.get('configured') is not True or value.get('error') or blocked is not None:
                        stopped.add(owner)
                    elif imported == 0 and after == prior:
                        stopped.add(owner)
        result['temporarySessionsCleaned'] = True
        result['recoveryRunFinished'] = True
    finally:
        # Retain actual committed state even after timeout, blocked UID or cleanup failure.
        snapshot = retain_snapshot(directory)
        result['databaseComparison'] = compare_tables(original_tables, snapshot)
        result['newDatabaseMailRecordsSinceBackup'] = new_mail_counts(original_tables, snapshot)
        result['files'] = compare_files(directory)
        write_new(directory / 'bindings-after.private.json', settings_and_bindings(directory / 'current.sqlite3'))
        _, result['runtimeAfter'] = runtime()
        result['runBudgetSeconds'] = 18 * 60
        result['continuationMayBeRequired'] = True
        result['independentCandidateCoverageAuditStillRequired'] = True
        result['reportedImportedAcrossBatches'] = sum(v['imported'] or 0 for v in result['ownerRuns'])
        result['fullStaticIdentity'] = all(r['added'] == r['removed'] == r['changed'] == 0 for r in result['databaseComparison'])


def audit(directory, result, original_bindings, original_candidates, original_tables):
    private, safe = runtime()
    result['runtime'] = source_and_health(private, safe)
    bindings = settings_and_bindings()
    entries, flags = configuration(private['voyageplex-api'], bindings)
    current = candidates(private, entries, bindings)
    write_new(directory / 'current-candidates.private.json', current)
    snapshot = retain_snapshot(directory)
    saved_bindings = settings_and_bindings(directory / 'current.sqlite3')
    write_new(directory / 'bindings.private.json', saved_bindings)
    coverage = uid_coverage(directory / 'current.sqlite3', original_candidates, current, saved_bindings)
    result['permissions'] = permission_checks(service_base(private, 'voyageplex-api', 5088), coverage)
    for row in coverage:
        row.pop('_sample', None)
    result['coverage'] = coverage
    result['originalCandidates'] = candidate_summary(original_candidates)
    result['currentCandidates'] = candidate_summary(current)
    result['bindings'] = flags
    result['databaseComparison'] = compare_tables(original_tables, snapshot)
    result['newDatabaseMailRecordsSinceBackup'] = new_mail_counts(original_tables, snapshot)
    result['files'] = compare_files(directory)
    result['settingsAndUsersUnchanged'] = all(
        bindings[owner]['setting'] == original_bindings[str(owner)]['setting'] and
        bindings[owner]['user'] == original_bindings[str(owner)]['user'] for owner in OWNERS)
    result['allOriginalEligibleUIDsCovered'] = all(row['originalMissingCount'] == 0 for row in coverage)
    result['allCurrentEligibleUIDsCoveredAtSearch'] = all(row['currentMissingCount'] == 0 for row in coverage)
    result['fourIndependentCursors'] = len({row['cursorId'] for row in coverage}) == 4
    result['noCursorErrors'] = all(not row['cursorErrorPresent'] for row in coverage)
    result['allRequiredExistingRoleChecksCompleted'] = not result['permissions']['supervisorFollowupRequired']
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
    result['auditPassed'] = all(result[k] for k in ['settingsAndUsersUnchanged', 'allOriginalEligibleUIDsCovered',
        'allCurrentEligibleUIDsCoveredAtSearch', 'fourIndependentCursors', 'noCursorErrors', 'unchangedOtherBusinessTables',
        'existingMailRowsRetained', 'existingContactsOnlyCounterAndTimestampChanged',
        'mailAndContactAdditionsOnlyTargetOwners', 'contactUpdatesOnlyTargetOwners',
        'allRequiredExistingRoleChecksCompleted']) and result['files']['allOriginalFileBytesPreserved']


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
        result['success'] = result.get('auditPassed', mode != 'audit')
        result['allMailboxRecoveryVerified'] = result.get('auditPassed', False)
    except BaseException as error:
        result['failed'] = True
        result['failedCheck'] = str(error) if isinstance(error, CheckError) and str(error) in SAFE_CODES else 'REDACTED_OPERATION_FAILURE'
        result['exceptionType'] = type(error).__name__ if type(error).__name__ in {
            'CheckError', 'TimeoutError', 'OperationalError', 'IntegrityError', 'URLError', 'HTTPError', 'ValueError', 'OSError'} else 'Other'
    finally:
        write_new(directory / 'first-result.json', result)
        seal(directory)
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
        # Preflight failure may occur before an exclusive receipt directory exists.
        emit({'failed': True, 'phase': 'preflight', 'reason': 'REDACTED_PREFLIGHT_FAILURE',
              'noRecoveryPostIssuedByThisPreflight': True})
        sys.exit(1)
