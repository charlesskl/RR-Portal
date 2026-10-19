"""PR941: private backup / one read-only verification / retained-result transport.

No business CRUD, login, restore, container recreation or service signals. SQLite
online copies replace the exact physical database and WAL/SHM/journal companions
in the restorable directory. Each DB is individually consistent, not cross-DB
atomic. Auxiliary request logs remain part of full static equality.
"""
import base64
import collections
import contextlib
import datetime
import hashlib
import json
import math
import os
import pathlib
import re
import sqlite3
import stat
import subprocess
import sys
import tarfile
import urllib.error
import urllib.parse
import urllib.request

ROOT = pathlib.Path('/opt/rr-portal')
PREFIX = 'apps/PMC跟仓管/加工厂月度评审管理制度/'
BASE = '1c295d6418a64a1610b9075acd4da2a38d875328'
BACKUPS = ROOT / 'deploy/backups'
SERVICES = {'factory-review': 'pb_data', 'factory-review-test': 'pb_data_test'}
COMPOSE = ['docker', 'compose', '-f', 'docker-compose.cloud.yml', '--env-file', '.env.cloud.production']
CONFIG = ['docker-compose.cloud.yml', 'nginx/nginx.cloud.conf', 'deploy/update-server.sh',
          'deploy/service-maintenance.sh', '.github/workflows/deploy.yml', PREFIX + 'Dockerfile', PREFIX + '.dockerignore']
MAX_FILES = 100000
MAX_BYTES = 32 * 1024 ** 3
MAX_FILE = 8 * 1024 ** 3
PIN = {}
FAILED = 'entrypoint'
RESULT_DIRECTORY = None
FIRST_FAILED_BACKUP = '/opt/rr-portal/deploy/backups/factory-review-pre-941-20261019T023133028210Z'
FIRST_FAILED_RESULT_SHA256 = '8ab1ca4bc84b60df59b5aaf21ea14119de4fd42ce95ddfb251396a2ee900c91d'
BACKUP_ATTEMPT = {'number': 1, 'secondAttempt': False, 'priorFailure': None}


def require(value, label):
    global FAILED
    FAILED = label
    if not value:
        raise RuntimeError('FACTORY_REVIEW_941_OPS_FAILED')


def encoded(value):
    return json.dumps(value, ensure_ascii=True, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()


def sha(value):
    return hashlib.sha256(value).hexdigest()


def digest(value):
    return sha(encoded(value))


def run(args, data=None):
    result = subprocess.run(args, input=data, stdout=subprocess.PIPE, stderr=subprocess.PIPE, cwd=ROOT, timeout=180)
    require(result.returncode == 0, 'privateCommandSucceeded')
    return result.stdout


def safe_path(value):
    path = pathlib.PurePosixPath(value)
    return bool(value) and not path.is_absolute() and str(path) == value and all(p not in {'', '.', '..'} for p in path.parts) and not any(ord(c) < 32 for c in value)


def private_write(path, content):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'wb') as stream:
        stream.write(content)
        stream.flush()
        os.fsync(stream.fileno())


def file_hash(path):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, 'rb') as stream:
        before = os.fstat(stream.fileno())
        require(stat.S_ISREG(before.st_mode) and before.st_size <= MAX_FILE, 'boundedRegularFile')
        value = hashlib.sha256()
        for block in iter(lambda: stream.read(1024 ** 2), b''):
            value.update(block)
        after = os.fstat(stream.fileno())
        require((before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns) ==
                (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns), 'fileStableDuringRead')
        return value.hexdigest()


def transport(result):
    """Every emitted line <=6000 bytes; original result bytes remain recoverable."""
    content = encoded(result)
    require(len(content) <= 4 * 1024 ** 2, 'boundedSafeResult')
    payload = base64.b64encode(content).decode('ascii')
    chunks = [payload[i:i + 5000] for i in range(0, len(payload), 5000)]
    for index, chunk in enumerate(chunks):
        line = encoded({'kind': 'result-part', 'part': index + 1, 'total': len(chunks),
                        'fullSha256': sha(content), 'encoding': 'base64', 'data': chunk})
        require(len(line) <= 6000, 'boundedTransportLine')
        print(line.decode(), flush=True)
    print(encoded({'kind': 'result-receipt', 'bytes': len(content), 'fullSha256': sha(content),
                   'parts': len(chunks), 'mode': result['mode'], 'resultPath': result['resultPath']}).decode(), flush=True)


def cell(value):
    if value is None:
        return ['null']
    if isinstance(value, bytes):
        return ['blob', value.hex()]
    if type(value) is int:
        return ['integer', str(value)]
    if type(value) is float:
        require(math.isfinite(value), 'finiteSQLiteReal')
        return ['real', value.hex()]
    require(type(value) is str, 'SQLiteScalarType')
    return ['text', value]


def quote(value):
    return '"' + value.replace('"', '""') + '"'


def audit(connection):
    require(connection.execute('PRAGMA integrity_check').fetchall() == [('ok',)], 'SQLiteIntegrity')
    require(not connection.execute('PRAGMA foreign_key_check').fetchall(), 'SQLiteForeignKeys')
    schema = connection.execute('SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name').fetchall()
    tables = {}
    for kind, name, _, _ in schema:
        if kind != 'table':
            continue
        columns = connection.execute('PRAGMA table_xinfo(' + quote(name) + ')').fetchall()
        require(columns and all(len(c) == 7 and c[6] != 1 for c in columns), 'CompletePersistentSQLiteColumns')
        rows = connection.execute('SELECT ' + ','.join(quote(c[1]) for c in columns) + ' FROM ' + quote(name))
        hashes = sorted(digest([cell(v) for v in row]) for row in rows)
        tables[name] = {'rows': len(hashes), 'sha256': sha(''.join(hashes).encode()), 'columnsSha256': digest(columns)}
    return {'schema': schema, 'schemaSha256': digest(schema), 'tables': tables}


def connect(path, immutable=False):
    connection = sqlite3.connect(path.as_uri() + '?mode=ro' + ('&immutable=1' if immutable else ''), uri=True, timeout=15)
    connection.execute('PRAGMA query_only=ON')
    connection.execute('BEGIN')
    connection.execute('SELECT count(*) FROM sqlite_master').fetchone()
    return connection


def databases(tree):
    names = []
    for path in sorted(tree.rglob('*')):
        require(not path.is_symlink() and (path.is_file() or path.is_dir()), 'regularPrivateTreeEntries')
        if not path.is_file():
            continue
        with path.open('rb') as stream:
            header = stream.read(16)
        if header == b'SQLite format 3\0':
            names.append(str(path.relative_to(tree)))
        else:
            require(path.suffix.lower() not in {'.db', '.sqlite', '.sqlite3'}, 'databaseExtensionHasSQLiteHeader')
    require({'data.db', 'auxiliary.db'} <= set(names), 'bothPocketBaseDatabasesPresent')
    return names


def snapshots(tree, destination=None, immutable=False):
    result = {}
    with contextlib.ExitStack() as stack:
        # Pin all transactions first, but make no cross-database atomic claim.
        connections = {name: stack.enter_context(contextlib.closing(connect(tree / name, immutable))) for name in databases(tree)}
        for name, connection in connections.items():
            result[name] = audit(connection)
            if destination:
                path = destination / name
                path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
                require(not path.exists(), 'newPrivateSnapshot')
                with contextlib.closing(sqlite3.connect(path)) as copy:
                    connection.backup(copy)
                    require(audit(copy) == result[name], 'onlineBackupMatchesPinnedSnapshot')
                path.chmod(0o600)
                with contextlib.closing(connect(path, True)) as sealed:
                    require(audit(sealed) == result[name], 'closedSnapshotImmutableMainContainsCompleteWALCopy')
    return result


def non_database_inventory(tree, names, archive=None):
    physical = set(names) | {name + suffix for name in names for suffix in ['-wal', '-shm', '-journal']}
    result, total = [], 0
    with contextlib.ExitStack() as stack:
        tar = stack.enter_context(tarfile.open(archive, 'x')) if archive else None
        for path in sorted(tree.rglob('*')):
            name = str(path.relative_to(tree))
            require(safe_path(name) and not path.is_symlink(), 'safePrivateTreeEntry')
            metadata = path.lstat()
            require(stat.S_ISREG(metadata.st_mode) or stat.S_ISDIR(metadata.st_mode), 'regularPrivateTreeEntry')
            if name in physical:
                require(stat.S_ISREG(metadata.st_mode), 'databaseCompanionsAreRegularFiles')
                continue
            row = {'path': name, 'directory': path.is_dir(), 'mode': stat.S_IMODE(metadata.st_mode)}
            if path.is_dir():
                if tar:
                    info = tarfile.TarInfo(name)
                    info.type, info.mode = tarfile.DIRTYPE, row['mode']
                    tar.addfile(info)
            else:
                total += metadata.st_size
                require(total <= MAX_BYTES, 'boundedPrivateTreeBytes')
                row.update(bytes=metadata.st_size, sha256=file_hash(path))
                if tar:
                    # Check again after tar's own read; do not certify a raced attachment.
                    tar.add(path, arcname=name, recursive=False)
                    require(file_hash(path) == row['sha256'], 'archivedAttachmentStable')
            result.append(row)
            require(len(result) <= MAX_FILES, 'boundedPrivateTreeEntries')
    if archive:
        archive.chmod(0o600)
        verify_archive(archive, result)
    return result


def verify_archive(path, expected):
    found, total = [], 0
    with tarfile.open(path, 'r') as tar:
        for member in tar:
            require(safe_path(member.name) and (member.isfile() or member.isdir()), 'safePrivateArchiveMember')
            row = {'path': member.name, 'directory': member.isdir(), 'mode': member.mode}
            if member.isfile():
                total += member.size
                require(member.size <= MAX_FILE and total <= MAX_BYTES, 'boundedPrivateArchiveMember')
                stream, hasher, size = tar.extractfile(member), hashlib.sha256(), 0
                for chunk in iter(lambda: stream.read(1024 ** 2), b''):
                    hasher.update(chunk)
                    size += len(chunk)
                require(size == member.size, 'completePrivateArchiveMember')
                row.update(bytes=size, sha256=hasher.hexdigest())
            found.append(row)
            require(len(found) <= MAX_FILES, 'boundedPrivateArchiveEntries')
    require(found == expected, 'allPrivateArchiveEntriesAndBytesVerified')


def git(ref='HEAD'):
    require(ref in {'HEAD', 'origin/main'}, 'fixedSourceRef')
    value = run(['git', 'rev-parse', ref]).decode().strip()
    require(bool(re.fullmatch('[a-f0-9]{40}', value)), 'exactSourceCommit')
    return value


def source_inventory(commit):
    names = run(['git', 'ls-tree', '-r', '--name-only', '-z', commit, '--', PREFIX]).decode().strip('\0').split('\0')
    require(names and all(n.startswith(PREFIX) and safe_path(n) for n in names), 'safeApplicationSourceInventory')
    return {name: sha(run(['git', 'show', commit + ':' + name])) for name in names}


def source_guard(target, deployed):
    require(PIN.get('finalPinFrozen') is True, 'finalPinMustBeFrozen')
    require(bool(re.fullmatch('[a-f0-9]{40}', str(PIN.get('reviewedHead')))), 'reviewedHeadPinned')
    require(all(isinstance(PIN.get(key), dict) and PIN[key] and all(n.startswith(PREFIX) and safe_path(n) and isinstance(h, str) and re.fullmatch('[a-f0-9]{64}', h) for n, h in PIN[key].items()) for key in ['applicationFiles', 'changedFiles']), 'boundedApplicationPathsAndExactDigests')
    require(run(['git', 'rev-parse', 'refs/remotes/origin/pr-941-reviewed']).decode().strip() == PIN['reviewedHead'], 'fetchedFixedPR941HeadMatchesReviewedPin')
    require(source_inventory(PIN['reviewedHead']) == PIN['applicationFiles'], 'reviewedCompleteSourceMatchesPin')
    changed = run(['git', 'diff', '--name-only', '-z', BASE, PIN['reviewedHead']]).decode().strip('\0').split('\0')
    require(set(changed) == set(PIN['changedFiles']) and all(PIN['applicationFiles'].get(n) == h for n, h in PIN['changedFiles'].items()), 'allChangedPathsPinned')
    actual = source_inventory(target)
    if deployed:
        require(actual == PIN['applicationFiles'], 'deployedCompleteApplicationMatchesReviewedPin')
        changed = run(['git', 'diff', '--name-only', '-z', BASE, target]).decode().strip('\0').split('\0')
        require(set(changed) == set(PIN['changedFiles']), 'deployedChangedPathsExactlyPinned')
    require(all(file_hash(ROOT / n) == h for n, h in actual.items()), 'completeCheckoutMatchesGit')
    require(git() == git('origin/main') == target, 'exactCurrentAndRemoteMain')
    return actual


def inspect(identifier):
    result = json.loads(run(['docker', 'inspect', identifier]))
    require(len(result) == 1, 'uniqueContainerInspection')
    return result[0]


def lifecycle(value):
    state = value['State']
    return {'containerId': value['Id'], 'imageId': value['Image'], 'createdAt': value['Created'],
            'startedAt': state['StartedAt'], 'restartCount': value['RestartCount'], 'status': state['Status'],
            'running': state['Running'], 'oomKilled': state['OOMKilled'], 'health': state.get('Health', {}).get('Status', 'none')}


def other_containers():
    values = {}
    for identifier in run(['docker', 'ps', '-a', '-q', '--no-trunc', '--filter', 'label=com.docker.compose.project=rr-portal']).decode().split():
        value = inspect(identifier)
        service = value['Config']['Labels'].get('com.docker.compose.service')
        require(service and service not in values, 'oneContainerPerProtectedService')
        if service not in SERVICES:
            values[service] = lifecycle(value)
    require({'nginx', 'core', 'db', 'redis', 'printlink'} <= set(values), 'coreProtectedContainersPresent')
    return values


def runtime(service, files, target, deployed):
    identifier = run(COMPOSE + ['ps', '-a', '-q', service]).decode().strip()
    require(bool(re.fullmatch('[a-f0-9]{64}', identifier)), 'oneTargetContainer')
    value = inspect(identifier)
    expected_tree = ROOT / PREFIX / SERVICES[service]
    mounts = [{'type': m['Type'], 'source': m['Source'], 'destination': m['Destination'], 'rw': m['RW']} for m in value['Mounts']]
    selected = [m for m in mounts if m['destination'] == '/pb/pb_data']
    require(len(selected) == 1 and selected[0] == {'type': 'bind', 'source': str(expected_tree), 'destination': '/pb/pb_data', 'rw': True}, 'exactPersistentBindMount')
    require(expected_tree.is_dir() and not expected_tree.is_symlink(), 'actualPersistentDataDirectory')
    environment = value['Config']['Env']
    mapped = dict(item.split('=', 1) for item in environment)
    require(len(mapped) == len(environment), 'uniqueTargetEnvironment')
    require(value['HostConfig']['Memory'] == 512 * 1024 ** 2 and value['HostConfig']['MemorySwap'] == 512 * 1024 ** 2, 'unchanged512MiBNoSwapBudget')
    if deployed:
        image = json.loads(run(['docker', 'image', 'inspect', value['Image']]))[0]
        require(image['Config'].get('Labels', {}).get('org.opencontainers.image.revision') == target, 'actualImageRevisionMatchesDeployment')
    require(b'0.39.6' in run(['docker', 'exec', identifier, '/pb/pocketbase', '--version']), 'actualPocketBaseVersion')
    runtime_files = {name: h for name, h in files.items() if name[len(PREFIX):].startswith(('pb_hooks/', 'pb_migrations/'))}
    for name, expected in runtime_files.items():
        result = run(['docker', 'exec', identifier, 'sha256sum', '/pb/' + name[len(PREFIX):]]).decode().split()[0]
        require(result == expected, 'everyRuntimeHookAndMigrationMatchesSource')
    state = lifecycle(value)
    require(state['running'] and state['status'] == 'running' and not state['oomKilled'] and state['health'] == 'healthy', 'targetContainerHealthy')
    return expected_tree, {'lifecycle': state, 'mounts': mounts, 'environmentSha256': digest(sorted(environment)),
                           'runtimeFilesVerified': len(runtime_files)}, mapped, value


def private_context():
    result = {'envSha256': file_hash(ROOT / '.env.cloud.production'),
              'configuration': {name: file_hash(ROOT / name) for name in CONFIG}}
    nginx_id = run(COMPOSE + ['ps', '-q', 'nginx']).decode().strip()
    material = {'configuration': run(['docker', 'exec', nginx_id, 'nginx', '-T'])}
    paths = set(re.findall(rb'^\s*auth_basic_user_file\s+([^;\s]+)\s*;', material['configuration'], re.M))
    require(paths, 'actualNginxAuthorizationFiles')
    for index, name in enumerate(sorted(paths)):
        path = name.decode()
        require(path.startswith('/etc/nginx/') and '..' not in pathlib.PurePosixPath(path).parts and '$' not in path, 'fixedActualNginxAuthorizationPath')
        material['authorization-' + str(index)] = run(['docker', 'exec', nginx_id, 'cat', path])
    result['nginx'] = {k: sha(v) for k, v in material.items()}
    return result, material


def startup_checks(snapshot, environment):
    with contextlib.closing(connect(snapshot, True)) as connection:
        email = environment.get('FACTORY_REVIEW_ADMIN_EMAIL', '').strip()
        password = environment.get('FACTORY_REVIEW_ADMIN_PASSWORD', '')
        admin = bool(email) and len(password) >= 12 and connection.execute('SELECT count(*) FROM users WHERE email=?', (email,)).fetchone()[0] == 1
        applied = {row[0] for row in connection.execute('SELECT file FROM _migrations')}
        base_migrations = {pathlib.PurePosixPath(n).name for n in source_inventory(BASE) if n.startswith(PREFIX + 'pb_migrations/') and n.endswith('.js')}
        existing_names = {row[0] for row in connection.execute('SELECT name FROM _collections')}
        schema_names = {row[0] for row in connection.execute('SELECT name FROM sqlite_master')}
        checks = {'existingAdminPreventsHealthSeedWrite': admin, 'allPriorApplicationMigrationsAlreadyApplied': base_migrations <= applied,
                  'newMigrationNotApplied': not set(PIN['migrationFiles']) & applied,
                  'newCollectionsAbsent': not set(PIN['newCollections']) & existing_names,
                  'newSchemaObjectsAbsent': not {r['name'] for r in PIN['addedSchemaObjects']} & schema_names}
        return {'checks': checks, 'passed': all(checks.values())}


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


HTTP = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())


def get(path):
    require(path.startswith('/factory-review/') or path.startswith('/factory-review-test/'), 'fixedFactoryReadOnlyHttpPath')
    try:
        with HTTP.open('http://127.0.0.1' + path, timeout=15) as response:
            body = response.read(16 * 1024 ** 2 + 1)
            require(len(body) <= 16 * 1024 ** 2, 'boundedPublicAssetBody')
            return response.status, body
    except urllib.error.HTTPError as error:
        return error.code, b''


def probes(service, deployed):
    identifier = run(COMPOSE + ['ps', '-q', service]).decode().strip()
    prefix = '/' + service + '/'
    checks = {}
    for suffix, status in [('health', 200), ('_/', 404), ('api/collections/_superusers/records', 404)]:
        checks[suffix] = get(prefix + suffix)[0] == status
    checks['anonymousBusinessListHasNoRecords'] = False
    status, body = get(prefix + 'api/collections/' + ('quality_patrols' if deployed else 'orders') + '/records?perPage=1')
    if status == 200:
        data = json.loads(body)
        checks['anonymousBusinessListHasNoRecords'] = data.get('totalItems') == 0 and data.get('items') == []
    elif status in {401, 403}:
        checks['anonymousBusinessListHasNoRecords'] = True
    files = run(['docker', 'exec', identifier, 'find', '/pb/pb_public', '-type', 'f', '-print0']).decode().strip('\0').split('\0')
    require(files and len(files) <= 512 and all(n.startswith('/pb/pb_public/') and safe_path(n[len('/pb/pb_public/'):]) for n in files), 'boundedActualPublicAssetInventory')
    total, hashes = 0, {}
    for name in sorted(files):
        relative = name[len('/pb/pb_public/'):]
        content = run(['docker', 'exec', identifier, 'cat', name])
        total += len(content)
        require(total <= 64 * 1024 ** 2, 'boundedTotalPublicAssets')
        # PocketBase redirects index.html to '/' (301), which would lose the
        # reverse-proxy prefix. Compare the actual index bytes at the SPA root.
        status, body = get(prefix if relative == 'index.html' else prefix + urllib.parse.quote(relative, safe='/'))
        hashes[relative] = sha(content)
        require(status == 200 and sha(body) == hashes[relative], 'everyPublicAssetMatchesActualContainer')
    require('index.html' in hashes, 'actualPublicIndexExists')
    status, body = get(prefix + ('quality-patrol' if deployed else ''))
    checks['spaEntryMatchesActualContainer'] = status == 200 and sha(body) == hashes['index.html']
    return {'checks': checks, 'passed': all(checks.values()), 'publicFilesVerified': len(hashes), 'assetInventorySha256': digest(hashes)}


def collection_metadata(row, names):
    # Collection/field IDs and all authorization rules stay exact. Only actual
    # migration timestamps are validated separately against the deployment time.
    result = {k: v for k, v in row.items() if k not in {'created', 'updated'}}
    for key in ['fields', 'indexes', 'options']:
        if isinstance(result.get(key), str):
            result[key] = json.loads(result[key])
    def replace(value):
        if isinstance(value, dict):
            return {k: ('$collection:' + names[v] if k == 'collectionId' and v in names else replace(v)) for k, v in value.items()}
        if isinstance(value, list):
            return [replace(v) for v in value]
        return value
    return replace(result)


def typed_rows(connection, table):
    columns = [c[1] for c in connection.execute('PRAGMA table_xinfo(' + quote(table) + ')')]
    return collections.Counter(digest([cell(v) for v in row]) for row in connection.execute('SELECT ' + ','.join(quote(c) for c in columns) + ' FROM ' + quote(table)))


def utc_timestamp(value):
    require(isinstance(value, str) and bool(re.fullmatch(r'\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z', value)), 'validUTCTimestamp')
    return datetime.datetime.fromisoformat(value.replace(' ', 'T').replace('Z', '+00:00'))


def migration_comparison(before_path, current_path, before, current, started_at=None):
    old_schema = {(r[0], r[1]): list(r) for r in before['schema']}
    new_schema = {(r[0], r[1]): list(r) for r in current['schema']}
    expected = {(r['type'], r['name']): [r['type'], r['name'], r['tbl_name'], r['sql']] for r in PIN['addedSchemaObjects']}
    checks = {'onlyExpectedSchemaObjectsAdded': new_schema == {**old_schema, **expected},
              'everyExistingBusinessTableFullRowsPreserved': True, 'oldSystemMetadataRowsPreserved': True,
              'newCollectionMetadataExpected': True, 'onlyExpectedMigrationsAdded': True,
              'newBusinessTablesEmpty': all(current['tables'].get(t, {}).get('rows') == 0 for t in PIN['newBusinessTables'])}
    changed = []
    for name, value in before['tables'].items():
        if current['tables'].get(name) != value:
            changed.append(name)
            if name not in {'_collections', '_migrations'}:
                checks['everyExistingBusinessTableFullRowsPreserved'] = False
    with contextlib.closing(connect(before_path, True)) as old, contextlib.closing(connect(current_path, True)) as new:
        for name in ['_collections', '_migrations']:
            old_rows, new_rows = typed_rows(old, name), typed_rows(new, name)
            checks['oldSystemMetadataRowsPreserved'] &= not bool(old_rows - new_rows)
        new.row_factory = sqlite3.Row
        collections_now = [dict(row) for row in new.execute('SELECT * FROM _collections')]
        old_names = {r[0] for r in old.execute('SELECT name FROM _collections')}
        added = [row for row in collections_now if row['name'] not in old_names]
        names = {r['id']: r['name'] for r in collections_now}
        checks['newCollectionMetadataExpected'] = {r['name']: collection_metadata(r, names) for r in added} == PIN['newCollections']
        lower = utc_timestamp(started_at) - datetime.timedelta(seconds=1) if started_at else datetime.datetime(2000, 1, 1, tzinfo=datetime.timezone.utc)
        upper = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(seconds=1)
        checks['newCollectionTimestampsMatchMigrationWindow'] = all(r['created'] == r['updated'] and lower <= utc_timestamp(r['created']) <= upper for r in added)
        old_migrations = {r[0] for r in old.execute('SELECT file FROM _migrations')}
        new_migrations = {r[0] for r in new.execute('SELECT file FROM _migrations')}
        checks['onlyExpectedMigrationsAdded'] = new_migrations == old_migrations | set(PIN['migrationFiles']) and current['tables']['_migrations']['rows'] - before['tables']['_migrations']['rows'] == len(PIN['migrationFiles'])
        applied = [r['applied'] for r in new.execute('SELECT file,applied FROM _migrations') if r['file'] in set(PIN['migrationFiles'])]
        # PocketBase stores _migrations.applied in Unix microseconds (0.39.6).
        checks['newMigrationTimestampsMatchDeploymentWindow'] = len(applied) == len(PIN['migrationFiles']) and all(type(v) is int and lower.timestamp() <= v / 1000000 <= upper.timestamp() for v in applied)
        checks['newSystemRowCountsExpected'] = current['tables']['_collections']['rows'] - before['tables']['_collections']['rows'] == len(PIN['newCollections'])
    return {'checks': checks, 'passed': all(checks.values()), 'changedExistingTables': changed,
            'newBusinessTableCounts': {t: current['tables'].get(t, {}).get('rows') for t in PIN['newBusinessTables']}}


def seal(directory):
    private_write(directory / 'manifest.json', encoded({str(p.relative_to(directory)): file_hash(p) for p in sorted(directory.rglob('*')) if p.is_file()}))


def selected_backup(value):
    directory = pathlib.Path(value)
    require(directory.parent == BACKUPS and bool(re.fullmatch('factory-review-pre-941-[0-9]{8}T[0-9]{12}Z', directory.name)), 'exactPrivateBackupPath')
    require(directory.is_dir() and not directory.is_symlink() and stat.S_IMODE(directory.stat().st_mode) == 0o700, 'privateBackupDirectory')
    entries = list(directory.rglob('*'))
    require(all(not p.is_symlink() and (p.is_dir() or p.is_file()) and p.stat().st_mode & 0o077 == 0 for p in entries), 'allBackupEntriesPrivateAndRegular')
    manifest = json.loads((directory / 'manifest.json').read_bytes())
    actual = {str(p.relative_to(directory)) for p in entries if p.is_file() and p != directory / 'manifest.json'}
    require(set(manifest) == actual and 'baseline.json' in actual, 'completeOriginalSealedBackupInventory')
    require(all(safe_path(n) and re.fullmatch('[a-f0-9]{64}', h) and file_hash(directory / n) == h for n, h in manifest.items()), 'originalBackupSealIntact')
    before = json.loads((directory / 'baseline.json').read_bytes())
    require(before['sourceCommit'] == BASE and before['backupComplete'] is True, 'completeValidOriginalBackup')
    for service, value in before['services'].items():
        verify_archive(directory / service / 'non-database.tar', value['files'])
        require(snapshots(directory / service / 'sqlite', immutable=True) == value['sqlite'], 'retainedAllTableSnapshotsMatchBaseline')
    return directory, before


def safe_database_summary(value):
    return {db: {'schemaSha256': data['schemaSha256'], 'tables': data['tables']} for db, data in value.items()}


def safe_files_delta(before, after):
    old, new = {r['path']: r for r in before}, {r['path']: r for r in after}
    return {'unchanged': old == new, 'addedEntries': len(new.keys() - old.keys()), 'deletedEntries': len(old.keys() - new.keys()),
            'modifiedEntries': sum(old[n] != new[n] for n in old.keys() & new.keys()), 'beforeSha256': digest(before), 'afterSha256': digest(after)}


def non_log_databases_equal(before, after):
    # Only auxiliary.db is the documented PocketBase request-log database.
    # Unknown additional databases remain protected with full typed equality.
    return {k: v for k, v in before.items() if k != 'auxiliary.db'} == {k: v for k, v in after.items() if k != 'auxiliary.db'}


def operational_checks(checks):
    # These independent full-static assertions are always reported unchanged.
    # Expected migration rows and auxiliary HTTP logs can make them false; no
    # business/static-file/environment/lifecycle assertion is excluded here.
    excluded = {service + ':' + name for service in SERVICES for name in
                ['fullSQLiteStaticEquality', 'SQLiteStaticDuringProbes']}
    return all(value for name, value in checks.items() if name not in excluded)


def create_backup_directory():
    global BACKUP_ATTEMPT
    BACKUPS.mkdir(mode=0o700, parents=True, exist_ok=True)
    require(not BACKUPS.is_symlink(), 'regularPrivateBackupRoot')
    directory = BACKUPS / ('factory-review-pre-941-' + datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ'))
    first = BACKUPS / 'factory-review-941-first-backup-attempt.json'
    marker = first
    BACKUP_ATTEMPT = {'number': 1, 'secondAttempt': False, 'priorFailure': None}
    if first.exists() or first.is_symlink():
        # One explicitly authorized second backup after the fixed index-route
        # diagnostic error. Preserve the first lock, receipt and sealed files.
        require(not first.is_symlink() and first.is_file() and stat.S_IMODE(first.stat().st_mode) == 0o600 and first.stat().st_size <= 4096, 'privateOriginalBackupAttemptMarker')
        require(json.loads(first.read_bytes()) == {'backup': FIRST_FAILED_BACKUP, 'sourceCommit': BASE}, 'secondBackupOnlyAfterExactFirstAttempt')
        original = BACKUPS / pathlib.Path(FIRST_FAILED_BACKUP).name
        require(original.is_dir() and not original.is_symlink() and stat.S_IMODE(original.stat().st_mode) == 0o700, 'privateOriginalFailedBackupDirectory')
        entries = list(original.rglob('*'))
        require(all(not p.is_symlink() and (p.is_file() or p.is_dir()) and p.stat().st_mode & 0o077 == 0 for p in entries), 'originalFailedBackupEntriesRemainPrivate')
        manifest_path = original / 'manifest.json'
        require(manifest_path.is_file() and manifest_path.stat().st_size <= 4 * 1024 ** 2, 'boundedOriginalFailedBackupManifest')
        manifest = json.loads(manifest_path.read_bytes())
        actual = {str(p.relative_to(original)) for p in entries if p.is_file() and p != manifest_path}
        require(set(manifest) == actual and 'backup-first-result.json' in actual, 'completeOriginalFailureSealInventory')
        require(all(safe_path(n) and isinstance(h, str) and re.fullmatch('[a-f0-9]{64}', h) and file_hash(original / n) == h for n, h in manifest.items()), 'allOriginalFailureSealedBytesUnchanged')
        receipt = original / 'backup-first-result.json'
        require(file_hash(receipt) == FIRST_FAILED_RESULT_SHA256, 'exactOriginalFailureReceiptBytes')
        failed = json.loads(receipt.read_bytes())
        require(failed.get('mode') == 'backup' and failed.get('failed') is True and failed.get('sourceCommit') == BASE and failed.get('failedCheck') == 'everyPublicAssetMatchesActualContainer', 'exactOriginalFailureScope')
        marker = BACKUPS / 'factory-review-941-second-backup-attempt.json'
        BACKUP_ATTEMPT = {'number': 2, 'secondAttempt': True, 'priorFailure': {'backup': FIRST_FAILED_BACKUP,
            'resultSha256': FIRST_FAILED_RESULT_SHA256, 'failedCheck': failed['failedCheck'], 'remainsFailed': True}}
    private_write(marker, encoded({'backup': str(directory), 'sourceCommit': BASE, **({'priorFailure': BACKUP_ATTEMPT['priorFailure']} if BACKUP_ATTEMPT['number'] == 2 else {})}))
    directory.mkdir(mode=0o700)
    return directory


def backup(target):
    global RESULT_DIRECTORY
    require(target == BASE, 'backupOnlyAtBase')
    files = source_guard(target, False)
    directory = create_backup_directory()
    RESULT_DIRECTORY = directory
    print(encoded({'kind': 'backup-started', 'backup': str(directory), 'businessWritesPerformed': False}).decode(), flush=True)
    context, nginx = private_context()
    private_write(directory / 'env.before', (ROOT / '.env.cloud.production').read_bytes())
    for name, content in nginx.items():
        private_write(directory / ('nginx.' + name), content)
    others = other_containers()
    baseline, public, checks = {}, {}, {}
    for service in SERVICES:
        part = directory / service
        part.mkdir(mode=0o700)
        tree, runtime_now, environment, private = runtime(service, files, target, False)
        sqlite = snapshots(tree, part / 'sqlite')
        private_write(part / 'sqlite-audit.json', encoded(sqlite))
        startup = startup_checks(part / 'sqlite/data.db', environment)
        private_write(part / 'runtime.private.json', encoded(private))
        inventory = non_database_inventory(tree, sqlite, part / 'non-database.tar')
        # Health is allowed only after proving its account-creation branch inert.
        require(startup['passed'], 'readOnlyBootstrapAndMigrationPreflight')
        probe = probes(service, False)
        final_sqlite = snapshots(tree)
        final_files = non_database_inventory(tree, final_sqlite)
        checks[service + ':fullSQLiteStaticEquality'] = sqlite == final_sqlite
        checks[service + ':businessDatabasesStable'] = non_log_databases_equal(sqlite, final_sqlite)
        checks[service + ':durableFilesStaticEquality'] = inventory == final_files
        checks[service + ':runtimeStable'] = runtime(service, files, target, False)[1] == runtime_now
        checks[service + ':readOnlyProbesPassed'] = probe['passed']
        baseline[service] = {'sqlite': sqlite, 'files': inventory, 'runtime': runtime_now, 'startup': startup}
        public[service] = {'sqlite': safe_database_summary(sqlite), 'finalSQLite': safe_database_summary(final_sqlite),
                           'fileEntries': len(inventory), 'fileDelta': safe_files_delta(inventory, final_files), 'runtime': runtime_now, 'startup': startup, 'probes': probe}
    checks['otherContainersStable'] = other_containers() == others
    checks['privateConfigurationStable'] = private_context()[0] == context
    checks['sourceStable'] = git() == git('origin/main') == target
    before = {'sourceCommit': target, 'backupComplete': True, 'strictStaticChecksPassed': all(checks.values()),
              'checks': checks, 'services': baseline, 'otherContainers': others, 'context': context, 'backupAttempt': BACKUP_ATTEMPT}
    private_write(directory / 'baseline.json', encoded(before))
    result = {'mode': 'backup', 'backup': str(directory), 'resultPath': str(directory / 'backup-first-result.json'),
              'sourceCommit': target, 'backupComplete': True, 'backupAttempt': BACKUP_ATTEMPT, 'preflightChecksPassed': operational_checks(checks),
              'strictStaticChecksPassed': all(checks.values()), 'checks': checks,
              'services': public, 'otherContainersBefore': others, 'otherContainersAfter': other_containers(),
              'sqliteSnapshotsIndividuallyConsistent': True, 'crossDatabaseAtomicClaimed': False,
              'businessWritesPerformed': False, 'credentialsChanged': False, 'containerRecreated': False}
    private_write(directory / 'backup-first-result.json', encoded(result))
    seal(directory)
    return result


def verify(target, path):
    global RESULT_DIRECTORY
    original, before = selected_backup(path)
    require(target != BASE, 'verificationRequiresNewDeployment')
    directory = original.with_name(original.name.replace('pre-941-', 'verify-941-'))
    # O_EXCL lock is the immutable first-attempt boundary, even after an exception.
    directory.mkdir(mode=0o700)
    RESULT_DIRECTORY = directory
    private_write(directory / 'first-attempt.lock', encoded({'target': target, 'backup': path}))
    files = source_guard(target, True)
    others, context = other_containers(), private_context()[0]
    result_services, checks = {}, {}
    for service in SERVICES:
        part = directory / service
        part.mkdir(mode=0o700)
        tree, runtime_now, environment, private = runtime(service, files, target, True)
        private_write(part / 'runtime.private.json', encoded(private))
        current = snapshots(tree, part / 'sqlite')
        private_write(part / 'sqlite-audit.json', encoded(current))
        inventory = non_database_inventory(tree, current)
        private_write(part / 'non-database-inventory.json', encoded(inventory))
        with contextlib.closing(connect(part / 'sqlite/data.db', True)) as connection:
            email = environment.get('FACTORY_REVIEW_ADMIN_EMAIL', '').strip()
            require(bool(email) and len(environment.get('FACTORY_REVIEW_ADMIN_PASSWORD', '')) >= 12 and connection.execute('SELECT count(*) FROM users WHERE email=?', (email,)).fetchone()[0] == 1, 'healthBootstrapRemainsInert')
        prior = before['services'][service]
        migration = migration_comparison(original / service / 'sqlite/data.db', part / 'sqlite/data.db', prior['sqlite']['data.db'], current['data.db'], runtime_now['lifecycle']['startedAt'])
        probe = probes(service, True)
        final_sqlite = snapshots(tree)
        delta = safe_files_delta(prior['files'], inventory)
        checks[service + ':fullSQLiteStaticEquality'] = current == prior['sqlite']
        checks[service + ':migrationAndBusinessPreservation'] = migration['passed']
        checks[service + ':allOriginalFilesIdentical'] = delta['unchanged']
        checks[service + ':SQLiteStaticDuringProbes'] = current == final_sqlite
        checks[service + ':businessDatabasesStableDuringProbes'] = non_log_databases_equal(current, final_sqlite)
        checks[service + ':filesStaticDuringProbes'] = inventory == non_database_inventory(tree, final_sqlite)
        checks[service + ':environmentUnchanged'] = runtime_now['environmentSha256'] == prior['runtime']['environmentSha256']
        checks[service + ':mountsUnchanged'] = runtime_now['mounts'] == prior['runtime']['mounts']
        checks[service + ':containerRecreated'] = runtime_now['lifecycle']['containerId'] != prior['runtime']['lifecycle']['containerId']
        checks[service + ':imageChanged'] = runtime_now['lifecycle']['imageId'] != prior['runtime']['lifecycle']['imageId']
        checks[service + ':runtimeStableDuringProbe'] = runtime(service, files, target, True)[1] == runtime_now
        checks[service + ':readOnlyProbesPassed'] = probe['passed']
        result_services[service] = {'migration': migration, 'currentSQLite': safe_database_summary(current), 'finalSQLite': safe_database_summary(final_sqlite),
                                    'fileDelta': delta, 'beforeRuntime': prior['runtime'], 'afterRuntime': runtime_now, 'probes': probe}
    after_others = other_containers()
    checks['allOtherContainersUnchangedSinceBackup'] = after_others == before['otherContainers']
    checks['otherContainersStableDuringProbes'] = after_others == others
    checks['privateEnvironmentNginxAndConfigurationPreserved'] = context == before['context']
    checks['privateContextStableDuringProbe'] = private_context()[0] == context
    checks['sourceStable'] = git() == git('origin/main') == target
    # Full equality must remain false for an expected migration or live logs.
    result = {'mode': 'verify', 'backup': path, 'resultPath': str(directory / 'first-result.json'), 'sourceCommit': target,
              'originalBackupStrictStaticChecksPassed': before['strictStaticChecksPassed'],
              'strictAllChecksPassed': all(checks.values()), 'deploymentChecksPassed': operational_checks(checks),
              'checks': checks, 'services': result_services,
              'otherContainersBefore': before['otherContainers'], 'otherContainersAtVerification': others, 'otherContainersAfter': after_others,
              'businessWritesPerformed': False, 'credentialsChanged': False, 'automaticRecoveryPerformed': False,
              'productionAuthenticatedPermissionsTested': False, 'productionBusinessCrudTested': False}
    private_write(directory / 'first-result.json', encoded(result))
    seal(directory)
    return result


def retained_result(target, path):
    original = pathlib.Path(path)
    require(original.parent == BACKUPS and bool(re.fullmatch('factory-review-pre-941-[0-9]{8}T[0-9]{12}Z', original.name)), 'fixedRetainedBackupPath')
    directory = original if target == BASE else original.with_name(original.name.replace('pre-941-', 'verify-941-'))
    require(directory.is_dir() and not directory.is_symlink() and stat.S_IMODE(directory.stat().st_mode) == 0o700, 'retainedResultPrivateDirectory')
    result_file = directory / ('backup-first-result.json' if target == BASE else 'first-result.json')
    require(result_file.is_file() and not result_file.is_symlink() and stat.S_IMODE(result_file.stat().st_mode) == 0o600 and result_file.stat().st_size <= 4 * 1024 ** 2, 'retainedPrivateBoundedResult')
    content = result_file.read_bytes()
    manifest = json.loads((directory / 'manifest.json').read_bytes())
    require(manifest.get(result_file.name) == sha(content), 'retainedFirstResultMatchesSeal')
    result = json.loads(content)
    require(result.get('sourceCommit') == target and result.get('resultPath') == str(result_file), 'retainedExactOriginalResult')
    # No production reads and no first-result edits in this mode.
    return result


def main(arguments):
    global PIN
    require(len(arguments) == 5, 'exactFiveArguments')
    mode, before, target, path, pin = arguments
    require(mode in {'backup', 'verify', 'result'} and before == BASE and bool(re.fullmatch('[a-f0-9]{40}', target)), 'fixedModeAndSourceArguments')
    require((mode == 'backup' and target == BASE and not path) or (mode in {'verify', 'result'} and bool(re.fullmatch('/opt/rr-portal/deploy/backups/factory-review-pre-941-[0-9]{8}T[0-9]{12}Z', path))), 'modeSpecificBackupArguments')
    PIN = json.loads(pathlib.Path(pin).read_bytes())
    require(PIN.get('finalPinFrozen') is True and PIN.get('addedSchemaObjects') and PIN.get('newCollections') and PIN.get('migrationFiles'), 'finalPinCompleteBeforeAnyProductionRead')
    os.umask(0o077)
    result = backup(target) if mode == 'backup' else verify(target, path) if mode == 'verify' else retained_result(target, path)
    transport(result)
    # An honest full-static false does not invalidate a completed portable backup.
    return 0 if mode in {'backup', 'result'} else (0 if result['deploymentChecksPassed'] else 1)


if __name__ == '__main__':
    try:
        sys.exit(main(sys.argv[1:]))
    except Exception as error:
        result = {'mode': sys.argv[1] if len(sys.argv) > 1 and sys.argv[1] in {'backup', 'verify', 'result'} else 'invalid',
                  'failed': True, 'failedCheck': FAILED, 'errorType': type(error).__name__ if type(error).__name__ in {'RuntimeError', 'ValueError', 'KeyError', 'TypeError', 'FileNotFoundError', 'OperationalError', 'FileExistsError'} else 'Other',
                  'sourceCommit': sys.argv[3] if len(sys.argv) > 3 and re.fullmatch('[a-f0-9]{40}', sys.argv[3]) else None,
                  'resultPath': str(RESULT_DIRECTORY / ('first-result.json' if len(sys.argv) > 1 and sys.argv[1] == 'verify' else 'backup-first-result.json')) if RESULT_DIRECTORY else '',
                  'strictAllChecksPassed': False, 'businessWritesPerformed': False, 'automaticRecoveryPerformed': False}
        if result['mode'] == 'backup':
            result['backupAttempt'] = BACKUP_ATTEMPT
        if RESULT_DIRECTORY:
            output = pathlib.Path(result['resultPath'])
            if not output.exists():
                private_write(output, encoded(result))
                if not (RESULT_DIRECTORY / 'manifest.json').exists():
                    seal(RESULT_DIRECTORY)
        transport(result)
        sys.exit(1)
