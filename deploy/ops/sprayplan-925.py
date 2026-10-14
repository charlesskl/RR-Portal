"""PR925 private SQLite backups and read-only checks; no restart, login or business writes."""
import base64
import datetime
import hashlib
import hmac
import io
import ipaddress
import json
import os
import pathlib
import re
import sqlite3
import stat
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = pathlib.Path('/opt/rr-portal')
APP = 'apps/喷油部/喷油排期系统'
BACKUPS = ROOT / 'deploy/backups'
BEFORE = 'dfc6e4dd807bd5b5e8b2f1e2e883499590f5f890'
SERVICES = {'sprayplan': ('data', 'storage'), 'sprayplan-test': ('data-test', 'storage-test')}
CORE = ('nginx', 'core', 'db', 'redis', 'printlink')
REQUIRED = {'users', 'products', 'product_parts', 'orders', 'order_part_qtys', 'production_lines',
            'machines', 'production_plans', 'holidays', 'craft_aliases', 'equipment_kinds',
            'inventory_moves', 'inbound_applications'}
CONFIG = ('docker-compose.cloud.yml', APP + '/Dockerfile', APP + '/docker-entrypoint.sh',
          APP + '/next.config.mjs', APP + '/prisma/schema.prisma',
          APP + '/server/SprayPlan.Api/Program.cs', APP + '/server/SprayPlan.Api/Data/AppDbContext.cs',
          APP + '/server/SprayPlan.Api/Services/JwtService.cs', APP + '/server/SprayPlan.Api/appsettings.json',
          APP + '/server/SprayPlan.Api/Features/Auth/AuthController.cs',
          APP + '/server/SprayPlan.Api/Features/Users/UsersController.cs')
COMPOSE = ['docker', 'compose', '-f', 'docker-compose.cloud.yml', '--env-file', '.env.cloud.production']
LIMIT_FILES, LIMIT_BYTES, LIMIT_FILE = 20000, 2 * 1024**3, 64 * 1024**2
FAILED = 'entrypoint'
ALLOWED_BASES = {'http://127.0.0.1/'}


def require(value, label):
    global FAILED
    FAILED = label
    if not value:
        raise RuntimeError('SPRAYPLAN_925_CHECK_FAILED')


def run(args, data=None, timeout=180, check='commandSucceeded'):
    global FAILED
    FAILED = check
    value = subprocess.run(args, input=data, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                           cwd=ROOT, timeout=timeout)
    require(value.returncode == 0, check)
    return value.stdout


def canonical(value):
    # Typed encoding distinguishes integers, IEEE-754 precision, text, bytes and NULL.
    if value is None:
        return ['null']
    if type(value) is int:
        return ['int', str(value)]
    if type(value) is float:
        return ['float', value.hex()]
    if isinstance(value, bytes):
        return ['bytes', base64.b64encode(value).decode()]
    require(isinstance(value, str), 'supportedSqliteValueType')
    return ['text', value]


def digest(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=True, separators=(',', ':')).encode()).hexdigest()


def file_hash(path):
    require(path.is_file() and not path.is_symlink(), 'regularNonSymlinkFile')
    sha = hashlib.sha256()
    with path.open('rb') as source:
        for block in iter(lambda: source.read(1024**2), b''):
            sha.update(block)
    return sha.hexdigest()


def q(name):
    require(isinstance(name, str) and '\x00' not in name, 'sqliteIdentifier')
    return '"' + name.replace('"', '""') + '"'


def readonly(path, immutable=False):
    require(path.is_file() and not path.is_symlink(), 'sqliteSourceExists')
    uri = path.resolve().as_uri() + '?mode=ro' + ('&immutable=1' if immutable else '')
    connection = sqlite3.connect(uri, uri=True, timeout=10)
    connection.execute('PRAGMA query_only=ON')
    return connection


def online_backup(source, target):
    # SQLite's backup API reads committed WAL pages; never copy a live DB main file alone.
    require(not target.exists() and not target.is_symlink(), 'newPrivateSnapshotFile')
    started = time.monotonic()
    def progress(status, remaining, total):
        require(time.monotonic() - started < 180, 'sqliteSnapshotTimeout')
    with readonly(source) as src:
        with sqlite3.connect(target) as dest:
            src.backup(dest, pages=256, progress=progress, sleep=0.05)
    target.chmod(0o600)
    return sqlite_audit(target)


def sqlite_audit(path):
    with readonly(path, immutable=True) as db:
        require(db.execute('PRAGMA integrity_check').fetchall() == [('ok',)], 'sqliteSnapshotIntegrity')
        schema = db.execute("SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name").fetchall()
        tables = sorted(row[1] for row in schema if row[0] == 'table')
        require(REQUIRED <= set(tables), 'requiredSqliteTablesPresent')
        result = {}
        for name in tables:
            columns = db.execute('PRAGMA table_info(' + q(name) + ')').fetchall()
            # Sorted fixed-size hashes retain duplicate-row multiplicity without exposing any row.
            hashes = sorted(digest([canonical(v) for v in row])
                            for row in db.execute('SELECT * FROM ' + q(name)))
            result[name] = {'rows': len(hashes), 'sha256': hashlib.sha256(''.join(hashes).encode()).hexdigest(),
                            'columnsSha256': digest(columns)}
        foreign_keys = db.execute('PRAGMA foreign_key_check').fetchall()
        return {'tables': result, 'schemaSha256': digest(schema), 'foreignKeyCheckSha256': digest(foreign_keys),
                'foreignKeyViolations': len(foreign_keys), 'userVersion': db.execute('PRAGMA user_version').fetchone()[0],
                'applicationId': db.execute('PRAGMA application_id').fetchone()[0],
                'digestMethod': 'sha256-sorted-typed-full-row-multiset'}


def cid(service):
    require(service in set(SERVICES) | set(CORE), 'knownService')
    value = run(COMPOSE + ['ps', '-a', '-q', service], check='resolveContainer:' + service).decode().strip()
    require(bool(re.fullmatch(r'[a-f0-9]{12,64}', value)), 'oneContainerPerService')
    return value


def inspect(identifier):
    return json.loads(run(['docker', 'inspect', identifier], check='readContainerMetadata'))[0]


def core_state():
    result = {}
    for service in CORE:
        identifier = cid(service)
        value = inspect(identifier)
        state = value['State']
        result[service] = {'containerId': identifier, 'startedAt': state['StartedAt'],
                           'restartCount': value['RestartCount'], 'running': state['Running'],
                           'status': state['Status'], 'health': state.get('Health', {}).get('Status', 'none'),
                           'oomKilled': state['OOMKilled']}
    return result


def core_healthy(value):
    return set(value) == set(CORE) and all(v['running'] and v['status'] == 'running'
                                         and v['health'] in ('none', 'healthy') for v in value.values())


def app_context(service):
    identifier = cid(service)
    value = inspect(identifier)
    require(value['State']['Running'] and value['State'].get('Health', {}).get('Status') == 'healthy',
            'applicationHealthy:' + service)
    mounts = {m['Destination']: m for m in value['Mounts']}
    require(set(mounts) == {'/app/data', '/app/server/SprayPlan.Api/storage'}, 'exactApplicationMounts')
    data_name, storage_name = SERVICES[service]
    for destination, name in [('/app/data', data_name), ('/app/server/SprayPlan.Api/storage', storage_name)]:
        m = mounts[destination]
        expected = ROOT / APP / name
        require(m['Type'] == 'bind' and m['RW'] and pathlib.Path(m['Source']) == expected
                and expected.is_dir() and not expected.is_symlink(), 'persistentApplicationMount:' + service)
    env = dict(item.split('=', 1) for item in value['Config']['Env'])
    require(env.get('NEXT_PUBLIC_BASE_PATH') == '/' + service and env.get('DATA_PATH') == '/app/data'
            and env.get('DOTNET_API_URL') == 'http://127.0.0.1:5080', 'expectedRuntimeRouting:' + service)
    require(env.get('SPRAYPLAN_DB_PATH', '/app/data/sprayplan.db') == '/app/data/sprayplan.db', 'expectedDatabasePath')
    root = ROOT / APP / data_name
    db = root / 'sprayplan.db'
    require(db.is_file() and not db.is_symlink() and db.stat().st_size > 0, 'existingDatabasePreventsSeed')
    secret = env.get('JWT_SECRET')
    if not secret:
        secret_path = root / 'jwt-secret'
        require(secret_path.is_file() and not secret_path.is_symlink(), 'existingJwtSecretPreventsGeneration')
        secret = secret_path.read_text().rstrip('\n')
    require(isinstance(secret, str) and len(secret.encode()) >= 32, 'existingStrongJwtSecret')
    networks = value['NetworkSettings']['Networks']
    addresses = [n['IPAddress'] for name, n in networks.items() if name.endswith('platform-net')]
    require(len(addresses) == 1 and ipaddress.ip_address(addresses[0]).is_private, 'privateApplicationNetwork')
    ALLOWED_BASES.add('http://' + addresses[0] + ':8400/' + service)
    return identifier, db, env, secret


PROCESS_ENV = r"""
const fs=require('fs'),crypto=require('crypto');let result={};
const hash=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
for(const id of fs.readdirSync('/proc').filter(v=>/^\d+$/.test(v))){
 try{const cmd=fs.readFileSync('/proc/'+id+'/cmdline','utf8').replace(/\0/g,' ');
 let kind=cmd.startsWith('dotnet publish/SprayPlan.Api.dll')?'api':cmd.startsWith('next-server ')?'web':null;
 if(kind){if(result[kind])throw Error('duplicate');const env=fs.readFileSync('/proc/'+id+'/environ','utf8').split('\0').filter(Boolean).sort();
 const host=env.filter(v=>v.startsWith('HOSTNAME='));if(host.length>1)process.exit(3);
 result[kind]={completeSha256:hash(env),withoutHostnameSha256:hash(env.filter(v=>!v.startsWith('HOSTNAME='))),hostname:host.length?host[0].slice(9):null};}}
 catch(e){if(e.message==='duplicate')process.exit(1);}
}if(Object.keys(result).length!==2)process.exit(2);process.stdout.write(JSON.stringify(result));
"""


def runtime(service):
    identifier, db, env, secret = app_context(service)
    value = inspect(identifier)
    process = json.loads(run(['docker', 'exec', identifier, 'node', '-e', PROCESS_ENV], check='readRuntimeProcessEnvironments:' + service))
    require(set(process) == {'api', 'web'} and all(set(v) == {'completeSha256', 'withoutHostnameSha256', 'hostname'}
            and re.fullmatch('[a-f0-9]{64}', v['completeSha256'])
            and re.fullmatch('[a-f0-9]{64}', v['withoutHostnameSha256']) for v in process.values()),
            'bothRuntimeProcessEnvironments')
    # Secret material is used only in memory. Complete envs are digested, never logged or saved.
    for host_name, container_name in [(APP + '/docker-entrypoint.sh', '/app/docker-entrypoint.sh'),
                                      (APP + '/next.config.mjs', '/app/next.config.mjs'),
                                      (APP + '/server/SprayPlan.Api/appsettings.json', '/app/server/SprayPlan.Api/appsettings.json')]:
        require(run(['docker', 'exec', identifier, 'cat', container_name], check='readStartupConfiguration:' + service) == (ROOT / host_name).read_bytes(),
                'runtimeStartupConfigurationMatchesSource')
    return {'configEnvSha256': digest(sorted(value['Config']['Env'])), 'processEnvironments': process,
            'containerId': identifier,
            'containerHostname': value['Config']['Hostname'], 'explicitHostnameConfigured': 'HOSTNAME' in env,
            'secretSha256': hashlib.sha256(secret.encode()).hexdigest(), 'issuer': env.get('JWT_ISSUER', 'sprayplan'),
            'imageId': value['Image'], 'healthy': True}


def process_environment_comparison(before, after):
    def automatic(value):
        return value['explicitHostnameConfigured'] is False and isinstance(value['containerHostname'], str) \
            and bool(re.fullmatch('[a-f0-9]{64}', value['containerId'])) \
            and value['containerHostname'] == value['containerId'][:12] and all(p['hostname'] == value['containerHostname']
                for p in value['processEnvironments'].values())
    auto = automatic(before) and automatic(after)
    key = 'withoutHostnameSha256' if auto else 'completeSha256'
    protected = all(before['processEnvironments'][p][key] == after['processEnvironments'][p][key] for p in ('api', 'web'))
    complete = all(before['processEnvironments'][p]['completeSha256'] == after['processEnvironments'][p]['completeSha256']
                   for p in ('api', 'web'))
    return {'protectedProcessEnvironmentsPreserved': protected, 'completeProcessEnvironmentsIdentical': complete,
            'automaticHostnameLifecycleValidated': auto, 'comparisonScope': 'all-process-env-except-verified-docker-hostname'
            if auto else 'all-process-env', 'beforeHostname': before['containerHostname'], 'afterHostname': after['containerHostname'],
            'beforeCompleteProcessHashes': {p: before['processEnvironments'][p]['completeSha256'] for p in ('api', 'web')},
            'afterCompleteProcessHashes': {p: after['processEnvironments'][p]['completeSha256'] for p in ('api', 'web')}}


def file_inventory(service, archive=None):
    rows, total = [], 0
    tar = tarfile.open(archive, 'x') if archive else None
    try:
        for name in SERVICES[service]:
            root = ROOT / APP / name
            require(root.is_dir() and not root.is_symlink(), 'mountedFileRoot')
            for directory, dirs, files in os.walk(root, followlinks=False):
                parent = pathlib.Path(directory)
                require(not parent.is_symlink() and all(not (parent / d).is_symlink() for d in dirs),
                        'noSymlinkDirectories')
                for filename in sorted(files):
                    if name == SERVICES[service][0] and parent == root and filename in {
                        'sprayplan.db', 'sprayplan.db-wal', 'sprayplan.db-shm', 'sprayplan.db-journal'}:
                        continue
                    path = parent / filename
                    require(not path.is_symlink(), 'noSymlinkFiles')
                    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
                    with os.fdopen(fd, 'rb') as source:
                        before = os.fstat(source.fileno())
                        require(stat.S_ISREG(before.st_mode) and before.st_size <= LIMIT_FILE, 'regularFileSizeLimit')
                        content = source.read(before.st_size + 1)
                        after = os.fstat(source.fileno())
                        require(len(content) == before.st_size and (before.st_ino, before.st_size, before.st_mtime_ns)
                                == (after.st_ino, after.st_size, after.st_mtime_ns), 'mountedFileStable')
                    require(not content.startswith(b'SQLite format 3\x00'), 'noUnaccountedLiveSqliteFiles')
                    total += len(content)
                    require(total <= LIMIT_BYTES and len(rows) < LIMIT_FILES, 'mountedFileInventoryLimits')
                    relative = name + '/' + str(path.relative_to(root))
                    rows.append({'path': relative, 'bytes': len(content), 'sha256': hashlib.sha256(content).hexdigest()})
                    if tar:
                        info = tarfile.TarInfo(relative)
                        info.size, info.mode, info.mtime = len(content), stat.S_IMODE(before.st_mode), int(before.st_mtime)
                        tar.addfile(info, io.BytesIO(content))
        return {'files': len(rows), 'bytes': total, 'sha256': digest(sorted(rows, key=lambda r: r['path']))}
    finally:
        if tar:
            tar.close()
            pathlib.Path(archive).chmod(0o600)


def validate_archive(path, expected):
    rows, total = [], 0
    with tarfile.open(path, 'r') as tar:
        members = tar.getmembers()
        require(len(members) == expected['files'] and len(members) <= LIMIT_FILES, 'archiveFileCount')
        require(len({m.name for m in members}) == len(members), 'archiveNoDuplicatePaths')
        for m in members:
            name = pathlib.PurePosixPath(m.name)
            require(m.isfile() and not name.is_absolute() and '..' not in name.parts and 0 <= m.size <= LIMIT_FILE,
                    'archiveRegularSafeMembers')
            total += m.size
            require(total <= LIMIT_BYTES, 'archiveTotalLimit')
            with tar.extractfile(m) as source:
                content = source.read(m.size + 1)
            require(len(content) == m.size, 'archiveContentSize')
            rows.append({'path': m.name, 'bytes': m.size, 'sha256': hashlib.sha256(content).hexdigest()})
    require({'files': len(rows), 'bytes': total, 'sha256': digest(sorted(rows, key=lambda r: r['path']))} == expected,
            'archiveContentMatchesInventory')


def private_file(path):
    require(path.is_file() and not path.is_symlink() and path.stat().st_mode & 0o077 == 0, 'privateFilePermissions')


def configuration():
    return {name: file_hash(ROOT / name) for name in CONFIG}


def archive_configuration(path, expected):
    with tarfile.open(path, 'x') as tar:
        for name in CONFIG:
            content = (ROOT / name).read_bytes()
            require(hashlib.sha256(content).hexdigest() == expected[name], 'configurationStableForBackup')
            info = tarfile.TarInfo(name)
            info.size, info.mode = len(content), 0o600
            tar.addfile(info, io.BytesIO(content))
    path.chmod(0o600)
    validate_configuration_archive(path, expected)


def validate_configuration_archive(path, expected):
    with tarfile.open(path, 'r') as tar:
        members = tar.getmembers()
        require(len(members) == len(CONFIG) and {m.name for m in members} == set(CONFIG), 'configurationArchiveInventory')
        for member in members:
            require(member.isfile() and 0 <= member.size <= LIMIT_FILE, 'configurationArchiveMember')
            with tar.extractfile(member) as source:
                content = source.read(member.size + 1)
            require(len(content) == member.size and hashlib.sha256(content).hexdigest() == expected[member.name],
                    'configurationArchiveContent')


def source_commit(ref='HEAD'):
    require(ref in ('HEAD', 'origin/main'), 'knownSourceRef')
    value = run(['git', 'rev-parse', ref], check='readSourceRevision:' + ref).decode().strip()
    require(bool(re.fullmatch('[a-f0-9]{40}', value)), 'validSourceCommit')
    return value


def get(url, cookie=None):
    require(any(url == base or url.startswith(base + ('/' if not base.endswith('/') else ''))
                for base in ALLOWED_BASES), 'validatedLocalGetOnly')
    headers = {'Cookie': cookie} if cookie else {}
    request = urllib.request.Request(url, headers=headers, method='GET')
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, req, fp, code, msg, headers, newurl):
            return None
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    try:
        with opener.open(request, timeout=60) as response:
            body = response.read(32 * 1024**2 + 1)
            require(len(body) <= 32 * 1024**2, 'boundedReadOnlyApiResponse')
            return response.status, body
    except urllib.error.HTTPError as error:
        body = error.read(32 * 1024**2 + 1)
        require(len(body) <= 32 * 1024**2, 'boundedReadOnlyApiErrorResponse')
        return error.code, body


def issue_cookie(user, secret, issuer, factory):
    def b64(value):
        return base64.urlsafe_b64encode(value).decode().rstrip('=')
    role_claim = 'http://schemas.microsoft.com/ws/2008/06/identity/claims/role'
    claims = {'iss': issuer, 'userId': str(user['id']), 'username': user['username'], role_claim: user['role'],
              'factoryId': user['factoryId'], 'exp': int(time.time()) + 90}
    unsigned = b64(b'{"alg":"HS256","typ":"JWT"}') + '.' + b64(json.dumps(claims, separators=(',', ':')).encode())
    token = unsigned + '.' + b64(hmac.new(secret.encode(), unsigned.encode(), hashlib.sha256).digest())
    return 'sprayplan_session=' + token + '; sprayplan_factory=' + factory


def api_audit(service, snapshot, deployed=False):
    identifier, db, env, secret = app_context(service)
    with readonly(snapshot, immutable=True) as connection:
        connection.row_factory = sqlite3.Row
        users = [dict(u) for u in connection.execute('SELECT id,username,role,factoryId,isActive FROM users')]
        admins = [u for u in users if u['role'] == 'admin' and u['isActive']]
        require(bool(admins), 'existingActiveAdmin')
        admin = min(admins, key=lambda u: u['id'])
        factories = ('XINGXIN', 'HUADENG')
        result = {'adminFactoriesVerified': [], 'ordinaryFactoriesVerified': [], 'ordinaryUnavailable': [],
                  'unauthenticatedDenied': False, 'orderFilterVerified': False, 'businessWritesPerformed': False}
        network = inspect(identifier)['NetworkSettings']['Networks']
        address = next(n['IPAddress'] for name, n in network.items() if name.endswith('platform-net'))
        prefix = 'http://' + address + ':8400/' + service
        status, body = get('http://127.0.0.1/' + service + '/api/health')
        require(status == 200, 'publicHealth:' + service)
        status, body = get('http://127.0.0.1/' + service + '/api/orders')
        require(status == 401, 'gatewayBasicAuthenticationRequired:' + service)
        result['gatewayBasicAuthenticationRequired'] = True
        result['publicBusinessAndAssetsAuthenticated'] = False
        status, body = get(prefix + '/api/orders')
        require(status == 401, 'unauthenticatedApiDenied:' + service)
        result['unauthenticatedDenied'] = True
        for factory in factories:
            candidates = [u for u in users if u['role'] != 'admin' and u['isActive'] and u['factoryId'] == factory]
            identities = [('admin', admin)]
            if candidates:
                identities.append(('ordinary', min(candidates, key=lambda u: u['id'])))
            else:
                result['ordinaryUnavailable'].append(factory)
            for kind, user in identities:
                cookie = issue_cookie(user, secret, env.get('JWT_ISSUER', 'sprayplan'), factory)
                try:
                    for endpoint, table in [('/api/orders', 'orders'), ('/api/lines', 'production_lines')]:
                        expected = {r[0] for r in connection.execute('SELECT id FROM ' + q(table) + ' WHERE factoryId=?', (factory,))}
                        status, body = get(prefix + endpoint, cookie)
                        require(status == 200, kind + 'ReadStatus:' + service + endpoint)
                        rows = json.loads(body)
                        require(isinstance(rows, list) and {r['id'] for r in rows} == expected
                                and len(rows) == len(expected), kind + 'ExactFactoryIsolation:' + service + endpoint)
                    status, body = get(prefix + '/api/users', cookie)
                    require(status == (200 if kind == 'admin' else 403), kind + 'UserManagementPermission:' + service)
                    if kind == 'admin':
                        visible = json.loads(body)
                        require({r['id'] for r in visible} == {u['id'] for u in users}, 'adminUsersComplete')
                    status, body = get(prefix + '/api/orders/overview', cookie)
                    overview = json.loads(body)
                    require(status == 200 and isinstance(overview, list), kind + 'OrderOverviewRead:' + service)
                    if deployed:
                        verify_deployed_read_features(connection, factory, prefix, cookie, overview, service)
                        result['remainingQuantityAndPlanEligibilityVerified'] = True
                    day = datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%d')
                    status, body = get(prefix + '/api/schedule/overview?from=' + day + '&to=' + day, cookie)
                    require(status == 200 and isinstance(json.loads(body).get('plans'), list), kind + 'ScheduleOverviewRead:' + service)
                    if deployed:
                        status, body = get(prefix + '/api/schedule/overview?from=' + day + '&to=' + day + '&orderId=2147483647', cookie)
                        require(status == 200 and json.loads(body)['plans'] == [], 'nonexistentOrderFilterIsEmpty:' + service)
                        plan = connection.execute('SELECT p.orderId,MIN(p.planDate),MAX(p.planDate) FROM production_plans p '
                                                  'JOIN orders o ON o.id=p.orderId AND o.factoryId=p.factoryId '
                                                  'WHERE p.factoryId=? AND p.deletedAt IS NULL GROUP BY p.orderId ORDER BY p.orderId LIMIT 1',
                                                  (factory,)).fetchone()
                        if plan:
                            # Prisma stores DateTime as exact Unix milliseconds in SQLite.
                            dates = [datetime.datetime.fromtimestamp(v / 1000, datetime.timezone.utc).strftime('%Y-%m-%d')
                                     for v in (plan[1], plan[2])]
                            status, body = get(prefix + '/api/schedule/overview?from=' + dates[0] + '&to=' + dates[1]
                                               + '&orderId=' + str(plan[0]), cookie)
                            rows = json.loads(body).get('plans')
                            expected = {r[0] for r in connection.execute('SELECT p.id FROM production_plans p '
                                'JOIN orders o ON o.id=p.orderId AND o.factoryId=p.factoryId WHERE p.factoryId=? '
                                'AND p.orderId=? AND p.deletedAt IS NULL', (factory, plan[0]))}
                            require(status == 200 and isinstance(rows, list) and {r['id'] for r in rows} == expected
                                    and all(r['orderId'] == plan[0] for r in rows), 'existingOrderFilterExact:' + service)
                            verify_plan_eligibility(connection, rows, service)
                        result['orderFilterVerified'] = True
                    result[kind + 'FactoriesVerified'].append(factory)
                finally:
                    del cookie
        return result


def remaining_quantity(connection, order_id):
    # Independent relational oracle: each logical part must finish every recorded step;
    # complete-set quantity is bounded by the least complete required part.
    order = connection.execute('SELECT factoryId FROM orders WHERE id=?', (order_id,)).fetchone()
    require(order is not None, 'remainingQuantityExistingOrder')
    factory = order[0]
    demands = connection.execute('SELECT partName,SUM(qty) FROM order_part_qtys WHERE orderId=? GROUP BY partName',
                                 (order_id,)).fetchall()
    if not demands:
        return 0
    completions = []
    for name, demand in demands:
        counts = [row[0] for row in connection.execute('SELECT SUM(COALESCE(goodQty,0)) FROM production_plans '
                  'WHERE orderId=? AND partName=? AND factoryId=? AND deletedAt IS NULL GROUP BY stepNo', (order_id, name, factory))]
        completions.append(min(demand, min(counts)) if counts else 0)
    return max(0, max(row[1] for row in demands) - min(completions))


def verify_plan_eligibility(connection, rows, service):
    require(isinstance(rows, list), 'planEligibilityArray:' + service)
    for row in rows:
        plan = connection.execute('SELECT p.deletedAt,p.status,p.goodQty,p.inboundQty,p.reportedQty,o.status '
                                  'FROM production_plans p LEFT JOIN orders o ON o.id=p.orderId AND o.factoryId=p.factoryId WHERE p.id=?',
                                  (row['id'],)).fetchone()
        require(plan is not None, 'existingPlanForEligibility:' + service)
        expected = plan[0] is None and plan[1] != 'recorded' and all(v is None for v in plan[2:5]) \
            and plan[5] is not None and plan[5] not in ('completed', 'archived')
        require(type(row.get('canReschedule')) is bool and row['canReschedule'] == expected,
                'compiledBackendPlanEligibilityExact:' + service)


def verify_deployed_read_features(connection, factory, prefix, cookie, overview, service):
    orders = connection.execute('SELECT id,status,pendingProduct FROM orders WHERE factoryId=?', (factory,)).fetchall()
    remaining = {order[0]: remaining_quantity(connection, order[0]) for order in orders}
    require({r['id'] for r in overview} == set(remaining) and len(overview) == len(remaining), 'orderOverviewFactoryComplete')
    require(all(type(r.get('inProductionRemainingQty')) is int and r['inProductionRemainingQty'] == remaining[r['id']]
                for r in overview), 'compiledBackendRemainingQuantityExact:' + service)
    expected_total = sum(remaining[o[0]] for o in orders if o[1] in ('scheduled', 'in_production') and not o[2])
    status, body = get(prefix + '/api/dashboard', cookie)
    dashboard = json.loads(body)
    require(status == 200 and type(dashboard.get('inProductionQty')) is int and dashboard['inProductionQty'] == expected_total,
            'compiledBackendDashboardRemainingQuantityExact:' + service)
    status, body = get(prefix + '/api/plans', cookie)
    rows = json.loads(body)
    expected = {r[0] for r in connection.execute('SELECT p.id FROM production_plans p JOIN orders o '
        'ON o.id=p.orderId AND o.factoryId=p.factoryId WHERE p.factoryId=? AND p.deletedAt IS NULL', (factory,))}
    require(status == 200 and isinstance(rows, list) and len(rows) == len(expected) and {r['id'] for r in rows} == expected,
            'compiledBackendAllPlansFactoryComplete:' + service)
    verify_plan_eligibility(connection, rows, service)


ASSET_INFO = r"""
const fs=require('fs'),path=require('path'),crypto=require('crypto');let rows=[];
function walk(root){for(const e of fs.readdirSync(root,{withFileTypes:true})){const p=path.join(root,e.name);if(e.isDirectory())walk(p);else if(e.isFile()&&/\.(js|css)$/.test(p))rows.push({path:p.slice('/app/.next/static/'.length),bytes:fs.statSync(p).size,sha256:crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')});}}
walk('/app/.next/static');const assembly=fs.readFileSync('/app/server/SprayPlan.Api/publish/SprayPlan.Api.dll');
const features=Object.fromEntries(['PlanDateRules','CanReschedule','HasActuals','Reschedule','InProductionRemainingQty'].map(name=>[name,assembly.includes(Buffer.from(name))]));
process.stdout.write(JSON.stringify({buildId:fs.readFileSync('/app/.next/BUILD_ID','utf8').trim(),assets:rows,compiledFeatures:features,assemblySha256:crypto.createHash('sha256').update(assembly).digest('hex')}));
"""


def frontend_audit(service):
    identifier = cid(service)
    info = json.loads(run(['docker', 'exec', identifier, 'node', '-e', ASSET_INFO], check='readCompiledAssets:' + service))
    require(isinstance(info['assets'], list) and bool(info['assets']), 'builtStaticAssetsPresent')
    require(set(info['compiledFeatures']) == {'PlanDateRules', 'CanReschedule', 'HasActuals', 'Reschedule', 'InProductionRemainingQty'}
            and all(value is True for value in info['compiledFeatures'].values()), 'compiledBackendNewFeatureSymbolsPresent')
    network = inspect(identifier)['NetworkSettings']['Networks']
    address = next(n['IPAddress'] for name, n in network.items() if name.endswith('platform-net'))
    for asset in info['assets']:
        path = pathlib.PurePosixPath(asset['path'])
        require(not path.is_absolute() and '..' not in path.parts and asset['bytes'] >= 0, 'safeStaticAssetPath')
        status, body = get('http://' + address + ':8400/' + service + '/_next/static/' + urllib.parse.quote(asset['path'], safe='/'))
        require(status == 200 and len(body) == asset['bytes'] and hashlib.sha256(body).hexdigest() == asset['sha256'],
                'directApplicationAssetMatchesBuiltContainer:' + service)
    return {'buildId': info['buildId'], 'assetFiles': len(info['assets']), 'assetsSha256': digest(info['assets']),
            'allDirectApplicationStaticAssetsMatchContainer': True, 'publicAssetsAuthenticated': False,
            'compiledBackendNewFeatureSymbolsPresent': True, 'assemblySha256': info['assemblySha256']}


def snapshot_now(service, directory):
    identifier, source, env, secret = app_context(service)
    target = directory / (service + '.db')
    audit = online_backup(source, target)
    return target, audit


def git_readonly(args, label):
    # Avoid optional index/stat-cache writes and configured external diff/fsmonitor hooks.
    global FAILED
    FAILED = label
    environment = dict(os.environ)
    environment['GIT_OPTIONAL_LOCKS'] = '0'
    value = subprocess.run(['git', '-c', 'core.fsmonitor=false', '-c', 'core.quotepath=false'] + args,
                           stdout=subprocess.PIPE, stderr=subprocess.PIPE, cwd=ROOT,
                           env=environment, timeout=60)
    require(value.returncode == 0, label)
    return value.stdout


def tracked_source_diff():
    raw = git_readonly(['diff', '--no-ext-diff', '--no-textconv', '--no-renames', '--raw', '-z',
                        '--abbrev=40', 'HEAD', '--', APP], 'readOnlyTrackedSourceDiff')
    records = raw.split(b'\x00')
    require(records[-1] == b'' and (len(records) - 1) % 2 == 0, 'trackedDiffRawStructure')
    changes = []
    for i in range(0, len(records) - 1, 2):
        fields = records[i].decode('ascii').split()
        require(len(fields) == 5 and fields[0].startswith(':'), 'trackedDiffRawFields')
        old_mode, new_mode, old_blob, new_blob, status = fields[0][1:], *fields[1:]
        require(re.fullmatch('[0-7]{6}', old_mode) and re.fullmatch('[0-7]{6}', new_mode)
                and re.fullmatch('[a-f0-9]{40}', old_blob) and re.fullmatch('[a-f0-9]{40}', new_blob)
                and status in ('A', 'D', 'M', 'T', 'U'), 'trackedDiffMetadata')
        name = records[i + 1].decode('utf-8')
        pure = pathlib.PurePosixPath(name)
        require(name.startswith(APP + '/') and not pure.is_absolute() and '..' not in pure.parts,
                'trackedDiffApplicationScope')
        # Runtime/private files are never inspected; the two tracked placeholders are source metadata.
        relative = pure.relative_to(APP)
        placeholder = str(relative) in {'data/.gitkeep', 'storage/pdf/.gitkeep'}
        require(not any(part.startswith('.env') for part in relative.parts)
                and (not any(part in ('data', 'data-test', 'storage', 'storage-test', 'uploads', 'instance')
                             for part in relative.parts[:-1]) or placeholder), 'trackedSourceOnly')
        require(not relative.name.endswith(('.db', '.sqlite', '.sqlite3', '.db-wal', '.db-shm')), 'noTrackedBusinessDatabase')
        head = None
        if old_mode not in ('000000', '160000'):
            head = git_readonly(['cat-file', 'blob', old_blob], 'readOnlyHeadBlob')
            require(len(head) <= LIMIT_FILE, 'trackedHeadBlobSizeLimit')
        file = ROOT / pure
        require(all(not parent.is_symlink() for parent in file.parents if parent != ROOT and ROOT in parent.parents),
                'trackedSourceNoSymlinkAncestors')
        content, disk_mode, permissions, kind = None, None, None, 'missing'
        try:
            metadata = file.lstat()
        except FileNotFoundError:
            metadata = None
        if metadata is not None:
            permissions = format(stat.S_IMODE(metadata.st_mode), '04o')
            if stat.S_ISLNK(metadata.st_mode):
                content = os.fsencode(os.readlink(file))
                disk_mode, kind = '120000', 'symlink-target-only'
            elif stat.S_ISREG(metadata.st_mode):
                require(metadata.st_size <= LIMIT_FILE, 'trackedDiskFileSizeLimit')
                fd = os.open(file, os.O_RDONLY | os.O_NOFOLLOW)
                with os.fdopen(fd, 'rb') as source:
                    before = os.fstat(source.fileno())
                    content = source.read(before.st_size + 1)
                    after = os.fstat(source.fileno())
                require(len(content) == before.st_size and (before.st_ino, before.st_size, before.st_mtime_ns, before.st_mode)
                        == (after.st_ino, after.st_size, after.st_mtime_ns, after.st_mode), 'trackedDiskFileStable')
                disk_mode = '100755' if before.st_mode & stat.S_IXUSR else '100644'
                kind = 'regular'
            else:
                kind = 'other-type-content-not-read'
        same_content = head is not None and content is not None and head == content
        text_line_endings_only = False
        if head is not None and content is not None and head != content and b'\x00' not in head + content:
            try:
                head.decode('utf-8'); content.decode('utf-8')
                normalize = lambda value: value.replace(b'\r\n', b'\n').replace(b'\r', b'\n')
                text_line_endings_only = normalize(head) == normalize(content)
            except UnicodeDecodeError:
                pass
        changes.append({'path': str(relative), 'changeType': status, 'headGitMode': old_mode,
            'diffGitMode': new_mode, 'diskGitMode': disk_mode, 'diskPermissions': permissions, 'diskKind': kind,
            'headBytes': len(head) if head is not None else None,
            'diskBytes': len(content) if content is not None else None,
            'headSha256': hashlib.sha256(head).hexdigest() if head is not None else None,
            'diskSha256': hashlib.sha256(content).hexdigest() if content is not None else None,
            'onlyModeChange': same_content and old_mode != disk_mode,
            'onlyLineEndingChange': text_line_endings_only and old_mode == disk_mode})
    return sorted(changes, key=lambda row: row['path'])


def preflight():
    require(source_commit() == source_commit('origin/main') == BEFORE, 'preflightExactPreDeployMain')
    changes = tracked_source_diff()
    require(tracked_source_diff() == changes and source_commit() == source_commit('origin/main') == BEFORE,
            'readOnlyPreflightWindowStable')
    return {'mode': 'preflight', 'sourceCommit': BEFORE, 'trackedApplicationSourceClean': not changes,
            'trackedDifferences': changes, 'diagnosticComplete': True, 'sourceContentsPrinted': False,
            'applicationCheckoutWritesPerformed': False, 'businessWritesPerformed': False, 'serviceRestartsPerformed': False}


def tracked_application_source_guard():
    changes = tracked_source_diff()
    # PR925 preflight independently confirmed these two directory markers have only
    # historical chmod 0777 drift. Preserve their permissions; all code content,
    # executable source modes and every other tracked path remain strict.
    marker_hash = hashlib.sha256(b'\n').hexdigest()
    expected = {'changeType': 'M', 'headGitMode': '100644', 'diffGitMode': '100755',
                'diskGitMode': '100755', 'diskPermissions': '0777', 'diskKind': 'regular',
                'headBytes': 1, 'diskBytes': 1, 'headSha256': marker_hash, 'diskSha256': marker_hash,
                'onlyModeChange': True, 'onlyLineEndingChange': False}
    require(not changes or (len(changes) == 2
            and {row['path'] for row in changes} == {'data/.gitkeep', 'storage/pdf/.gitkeep'}
            and all({key: value for key, value in row.items() if key != 'path'} == expected for row in changes)),
            'trackedApplicationSourceClean')
    return changes


def backup():
    os.umask(0o077)
    require(source_commit() == source_commit('origin/main') == BEFORE, 'backupExactPreDeployMain')
    source_metadata = tracked_application_source_guard()
    BACKUPS.mkdir(parents=True, exist_ok=True)
    require(not BACKUPS.is_symlink(), 'privateBackupRoot')
    directory = BACKUPS / ('sprayplan-pre-925-' + datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ'))
    directory.mkdir(mode=0o700)
    configs, core = configuration(), core_state()
    require(core_healthy(core), 'coreBaselineHealthy')
    envfile = ROOT / '.env.cloud.production'
    require(envfile.is_file() and not envfile.is_symlink(), 'privateProductionEnvironmentExists')
    (directory / 'env.before').write_bytes(envfile.read_bytes())
    (directory / 'env.before').chmod(0o600)
    archive_configuration(directory / 'configuration.tar', configs)
    baseline = {'sourceCommit': BEFORE, 'deploymentLabel': 'PR925', 'services': {}, 'configurationFiles': configs,
                'trackedSourceMetadata': source_metadata,
                'coreLifecycle': core, 'onlineSqliteBackupApi': True, 'businessWritesPerformed': False}
    for service in SERVICES:
        snapshot, audit = snapshot_now(service, directory)
        current_runtime = runtime(service)
        files = file_inventory(service, directory / (service + '.tar'))
        validate_archive(directory / (service + '.tar'), files)
        api = api_audit(service, snapshot)
        with tempfile.TemporaryDirectory(prefix='sprayplan-925-check-') as temporary:
            _, stable = snapshot_now(service, pathlib.Path(temporary))
        require(stable == audit and file_inventory(service) == files and runtime(service) == current_runtime,
                'baselineDataAndConfigurationStable:' + service)
        baseline['services'][service] = {'database': audit, 'files': files, 'runtime': current_runtime, 'api': api}
    require(core_state() == core and configuration() == configs and file_hash(envfile) == file_hash(directory / 'env.before')
            and source_commit() == source_commit('origin/main') == BEFORE
            and tracked_application_source_guard() == source_metadata, 'completeBaselineStable')
    (directory / 'baseline.json').write_text(json.dumps(baseline, ensure_ascii=True))
    (directory / 'baseline.json').chmod(0o600)
    names = ['baseline.json', 'env.before', 'configuration.tar'] + [s + ext for s in SERVICES for ext in ('.db', '.tar')]
    manifest = {name: file_hash(directory / name) for name in names}
    (directory / 'manifest.json').write_text(json.dumps(manifest))
    (directory / 'manifest.json').chmod(0o600)
    return {'backup': str(directory), 'sourceCommit': BEFORE, 'privateArchivesVerified': True,
            'onlineSqliteBackupApi': True, 'startupSafetyChecksPassed': True,
            'allowedPlaceholderModeDifferences': source_metadata,
            'services': {s: {'tableCounts': {n: t['rows'] for n, t in b['database']['tables'].items()},
                            'attachmentFiles': b['files']['files'], 'attachmentBytes': b['files']['bytes'],
                            'api': b['api']} for s, b in baseline['services'].items()},
            'coreLifecycle': core, 'businessWritesPerformed': False, 'serviceRestartsPerformed': False}


def selected_backup(path):
    directory = pathlib.Path(path)
    require(directory.parent == BACKUPS and re.fullmatch(r'sprayplan-pre-925-[0-9]{8}T[0-9]{12}Z', directory.name),
            'explicitPrivateBackupPath')
    require(BACKUPS.is_dir() and not BACKUPS.is_symlink() and directory.is_dir() and not directory.is_symlink()
            and directory.stat().st_mode & 0o077 == 0, 'privateBackupDirectoryPermissions')
    private_file(directory / 'manifest.json')
    manifest = json.loads((directory / 'manifest.json').read_text())
    names = {'baseline.json', 'env.before', 'configuration.tar'} | {s + ext for s in SERVICES for ext in ('.db', '.tar')}
    require(set(manifest) == names, 'exactBackupManifestInventory')
    for name, expected in manifest.items():
        private_file(directory / name)
        require(file_hash(directory / name) == expected, 'privateBackupManifestMatches')
    baseline = json.loads((directory / 'baseline.json').read_text())
    require(baseline['sourceCommit'] == BEFORE and baseline['deploymentLabel'] == 'PR925'
            and baseline['onlineSqliteBackupApi'] is True and set(baseline['services']) == set(SERVICES)
            and set(baseline['configurationFiles']) == set(CONFIG), 'exactBackupBaseline')
    validate_configuration_archive(directory / 'configuration.tar', baseline['configurationFiles'])
    for service in SERVICES:
        require(sqlite_audit(directory / (service + '.db')) == baseline['services'][service]['database'],
                'restorableSqliteSnapshotMatchesBaseline')
        validate_archive(directory / (service + '.tar'), baseline['services'][service]['files'])
    return directory, baseline


def verify(mode, target, path):
    directory, before = selected_backup(path)
    actual = source_commit()
    run(['git', 'merge-base', '--is-ancestor', BEFORE, target], check='deploymentSourceAncestry')
    changed = run(['git', '-c', 'core.quotepath=false', 'diff', '--name-only', BEFORE, target], check='deploymentChangedPaths').decode().splitlines()
    require(bool(changed) and all(name.startswith(APP + '/') for name in changed), 'deploymentOnlyRequestedApplication')
    source_metadata = tracked_application_source_guard()
    core = core_state()
    initial_config = configuration()
    initial_env = file_hash(ROOT / '.env.cloud.production')
    checks = {'exactSourceVersion': actual == target == source_commit('origin/main'),
              'trackedPlaceholderModesPreserved': source_metadata == before['trackedSourceMetadata'],
              'configurationFilesPreserved': initial_config == before['configurationFiles'],
              'productionEnvironmentPreserved': initial_env == file_hash(directory / 'env.before'),
              'coreLifecyclePreserved': core == before['coreLifecycle'], 'coreHealthy': core_healthy(core)}
    services, observed = {}, {}
    # Do not fail early on an unrelated core restart: both data snapshots and permissions remain reported.
    for service in SERVICES:
        with tempfile.TemporaryDirectory(prefix='sprayplan-925-verify-') as temporary:
            snapshot, audit = snapshot_now(service, pathlib.Path(temporary))
            previous = before['services'][service]
            current = runtime(service)
            mounted_files = file_inventory(service)
            observed[service] = (audit, current, mounted_files)
            environment = process_environment_comparison(previous['runtime'], current)
            flags = {'allTablesPreserved': audit == previous['database'],
                     'allMountedFilesPreserved': mounted_files == previous['files'],
                     'completeConfigEnvPreserved': current['configEnvSha256'] == previous['runtime']['configEnvSha256'],
                     'protectedProcessEnvironmentsPreserved': environment['protectedProcessEnvironmentsPreserved'],
                     'jwtSecretAndIssuerPreserved': current['secretSha256'] == previous['runtime']['secretSha256']
                     and current['issuer'] == previous['runtime']['issuer'], 'rebuiltImageChanged': current['imageId'] != previous['runtime']['imageId']}
            api, frontend = None, None
            try:
                api = api_audit(service, snapshot, deployed=True)
                flags['readOnlyApiChecksPassed'] = True
            except Exception:
                flags['readOnlyApiChecksPassed'] = False
                api = {'error': 'READ_ONLY_API_CHECK_FAILED', 'failedCheck': FAILED}
            try:
                frontend = frontend_audit(service)
                flags['directApplicationStaticAssetsVerified'] = True
            except Exception:
                flags['directApplicationStaticAssetsVerified'] = False
                frontend = {'error': 'STATIC_ASSET_CHECK_FAILED', 'failedCheck': FAILED}
            services[service] = {'checks': flags, 'tableCounts': {n: t['rows'] for n, t in audit['tables'].items()},
                                 'attachmentFiles': previous['files']['files'], 'api': api, 'frontend': frontend,
                                 'processEnvironmentComparison': environment}
    for service in SERVICES:
        with tempfile.TemporaryDirectory(prefix='sprayplan-925-final-') as temporary:
            _, final_audit = snapshot_now(service, pathlib.Path(temporary))
        previous_audit, previous_runtime, previous_files = observed[service]
        services[service]['checks'].update({'databaseVerificationWindowStable': final_audit == previous_audit,
            'completeRuntimeVerificationWindowStable': runtime(service) == previous_runtime,
            'mountedFilesVerificationWindowStable': file_inventory(service) == previous_files})
    final_core = core_state()
    checks.update({'coreVerificationWindowStable': final_core == core, 'finalCoreHealthy': core_healthy(final_core),
                   'trackedSourceMetadataVerificationWindowStable': tracked_application_source_guard() == source_metadata,
                   'sourceVerificationWindowStable': source_commit() == source_commit('origin/main') == actual,
                   'environmentVerificationWindowStable': file_hash(ROOT / '.env.cloud.production') == initial_env,
                   'configurationVerificationWindowStable': configuration() == initial_config})
    passed = all(checks.values()) and all(all(s['checks'].values()) for s in services.values())
    return {'sourceCommit': actual, 'targetCommit': target, 'backup': str(directory), 'checks': checks,
            'services': services, 'coreBefore': before['coreLifecycle'], 'coreNow': final_core,
            'strictVerificationPassed': passed, 'diagnosticComplete': True,
            'businessWritesPerformed': False, 'serviceRestartsPerformed': False}, passed


def main(args):
    require(len(args) == 4, 'argumentCount')
    mode, before, target, path = args
    require(mode in ('backup', 'verify', 'diagnose', 'preflight') and before == BEFORE and re.fullmatch('[a-f0-9]{40}', target),
            'exactArguments')
    if mode == 'preflight':
        require(target == BEFORE and not path, 'preflightExactTarget')
        print(json.dumps(preflight(), ensure_ascii=True))
        return 0
    if mode == 'backup':
        require(target == BEFORE and not path, 'backupExactTarget')
        print(json.dumps(backup(), ensure_ascii=True))
        return 0
    require(target != BEFORE and bool(path), 'verificationExactTargetAndBackup')
    result, passed = verify(mode, target, path)
    print(json.dumps(result, ensure_ascii=True))
    return 0 if passed or mode == 'diagnose' else 1


if __name__ == '__main__':
    try:
        sys.exit(main(sys.argv[1:]))
    except Exception:
        # Exceptions, SQL, URLs, rows and container stderr can contain private values.
        print(json.dumps({'error': 'SPRAYPLAN_925_OPS_FAILED', 'failedCheck': FAILED,
                          'businessWritesPerformed': False, 'serviceRestartsPerformed': False}))
        sys.exit(1)
