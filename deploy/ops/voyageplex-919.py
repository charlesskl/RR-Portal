"""Private online backup and read-only verification; never login, sync or write business data."""
import datetime
import hashlib
import json
import os
import pathlib
import re
import shutil
import sqlite3
import subprocess
import sys
import urllib.error
import urllib.request

os.umask(0o077)
ROOT = pathlib.Path('/opt/rr-portal')
DATA = ROOT / 'apps/船务部/VoyagePlex船务协同系统/data-runtime'
BACKUPS = ROOT / 'deploy/backups'
SERVICES = ['voyageplex-web', 'voyageplex-api', 'voyageplex-parser']
STABLE = ['Users', 'ShipmentTasks', 'FactoryMappings', 'ExportTemplates',
          'InspectionMappings', 'ProductInfos', 'ProductNameMappings', 'MailSystemSettings']
OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))
CHECK_LABELS = {'CHECK_FAILED', 'STABLE_BUSINESS_TABLES', 'USER_IDENTITY', 'EMAIL_OWNERSHIP',
                'SERVER_ENV', 'CONTAINER_HEALTH', 'CONTAINER_IMAGES', 'CONTAINER_CONFIG',
                'MAILBOX_CURSORS', 'API_HEALTH', 'PARSER_HEALTH', 'PUBLIC_API_HEALTH',
                'ANONYMOUS_USERS', 'ANONYMOUS_SHIPMENTS', 'PARSER_SOURCE', 'POLICY_VERSION',
                'API_SYMBOL', 'MAIN_REVISION'}

def require(condition, label='CHECK_FAILED'):
    if not condition:
        raise RuntimeError(label if label in CHECK_LABELS else 'CHECK_FAILED')

def run(arguments):
    result = subprocess.run(arguments, cwd=ROOT, stdout=subprocess.PIPE,
                            stderr=subprocess.DEVNULL, timeout=90)
    require(result.returncode == 0)
    return result.stdout

def digest(value):
    return hashlib.sha256(value).hexdigest()

def file_hash(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest() if hasattr(hashlib, 'file_digest') else digest(stream.read())

def canonical(value):
    return json.dumps(value, ensure_ascii=True, sort_keys=True, separators=(',', ':'),
                      default=lambda data: {'bytesSha256': digest(data)} if isinstance(data, bytes) else None).encode()

def quote(identifier):
    return '"' + identifier.replace('"', '""') + '"'

def connect(path):
    return sqlite3.connect(path.resolve().as_uri() + '?mode=ro', uri=True, timeout=20)

def audit(path):
    with connect(path) as connection:
        connection.execute('BEGIN')
        require(connection.execute('PRAGMA quick_check').fetchone()[0] == 'ok')
        names = [row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")]
        counts = {name: connection.execute('SELECT COUNT(*) FROM ' + quote(name)).fetchone()[0] for name in names}
        require(all(table in names for table in STABLE + ['ImportEmailItems', 'MailSyncStates']))
        stable = {}
        for table in STABLE:
            rows = list(connection.execute('SELECT * FROM ' + quote(table)))
            stable[table] = digest(canonical(sorted(digest(canonical(list(row))) for row in rows)))
        ownership = {str(row[0]): digest(canonical(list(row[1:]))) for row in connection.execute('SELECT Id,Company,MailOwnerId,MailboxKey FROM ImportEmailItems')}
        users = list(connection.execute('SELECT Id,Username,Role,CompanyAccess,IsActive,MailboxAddress,PasswordHash FROM Users ORDER BY Id'))
        require({2, 3, 5, 6} <= {row[0] for row in users})
        cursors = {str(row[0]): list(row[1:]) for row in connection.execute('SELECT Id,Address,UidValidity,LastUid,MailboxIdentity,ConfigurationKey FROM MailSyncStates')}
        return {'counts': counts, 'stable': stable, 'owners': ownership,
                'userIdentity': digest(canonical(users)), 'cursors': cursors}

def stable_differences(snapshot, live):
    differences = {}
    with connect(snapshot) as old, connect(live) as current:
        old.execute('BEGIN')
        current.execute('BEGIN')
        for table in STABLE:
            schema = list(old.execute('PRAGMA table_info(' + quote(table) + ')'))
            columns = [row[1] for row in schema]
            primary = [columns.index(row[1]) for row in sorted(schema, key=lambda row: row[5]) if row[5]]
            require(bool(primary))
            def indexed(connection):
                return {canonical([row[index] for index in primary]): list(row)
                        for row in connection.execute('SELECT * FROM ' + quote(table))}
            before, after = indexed(old), indexed(current)
            common = set(before) & set(after)
            changed = [key for key in common if before[key] != after[key]]
            added, removed = len(set(after) - set(before)), len(set(before) - set(after))
            if changed or added or removed:
                changed_columns = sorted({name for key in changed for index, name in enumerate(columns)
                                          if before[key][index] != after[key][index]})
                differences[table] = {'rowsAdded': added, 'rowsRemoved': removed,
                                      'rowsChanged': len(changed), 'changedColumns': changed_columns}
                if table == 'Users':
                    differences[table]['onlyLoginTimestampsChanged'] = not added and not removed and set(changed_columns) <= {'LastLoginAt', 'UpdatedAt'}
    return differences

def concurrent_confirmed_tasks(snapshot, live, directory):
    started = datetime.datetime.strptime(directory.name.removeprefix('voyageplex-pre-919-'), '%Y%m%dT%H%M%S%fZ').replace(tzinfo=datetime.timezone.utc)
    def utc(value):
        text = re.sub(r'(\.\d{6})\d+', r'\1', str(value).replace('Z', '+00:00'))
        date = datetime.datetime.fromisoformat(text)
        return date.replace(tzinfo=datetime.timezone.utc) if date.tzinfo is None else date
    accepted = 0
    with connect(snapshot) as old, connect(live) as current:
        old.execute('BEGIN')
        current.execute('BEGIN')
        old_ids = {row[0] for row in old.execute('SELECT Id FROM ShipmentTasks')}
        for identifier, created, company, sources in current.execute('SELECT Id,CreatedAt,Company,SourceEmailsJson FROM ShipmentTasks'):
            if identifier in old_ids:
                continue
            require(utc(created) > started, 'STABLE_BUSINESS_TABLES')
            linked = False
            for source in json.loads(sources):
                if source.get('relation') != '创建来源':
                    continue
                record = current.execute('SELECT Status,HandlingStatus,HandlingOutcome,TaskIdsJson,ReviewedAt,Company FROM ImportEmailItems WHERE Id=?', (source.get('id'),)).fetchone()
                if record and record[0] in {'confirmed', 'duplicate_confirmed'} and record[1] == 'Processed' and record[2] == 'Task' and identifier in json.loads(record[3]) and record[4] and utc(record[4]) > started and record[5] == company:
                    linked = True
            require(linked, 'STABLE_BUSINESS_TABLES')
            accepted += 1
    return accepted

def containers():
    result = {}
    for service in SERVICES:
        info = json.loads(run(['docker', 'inspect', 'rr-portal-' + service + '-1']))[0]
        env = dict(value.split('=', 1) for value in info['Config']['Env'] if '=' in value)
        protected = {key: value for key, value in env.items() if key == 'SSO_SECRET' or key.startswith(('VOYAGEPLEX_', 'MAIL_', 'Auth__', 'ConnectionStrings__', 'EmailParser__', 'CORE_SSO'))}
        result[service] = {'image': info['Image'], 'configDigest': digest(canonical(protected)),
                           'health': info['State'].get('Health', {}).get('Status'),
                           'ip': next(value['IPAddress'] for value in info['NetworkSettings']['Networks'].values() if value.get('IPAddress'))}
    return result

def get(url):
    try:
        with OPENER.open(url, timeout=15) as response:
            return response.status, response.read()
    except urllib.error.HTTPError as error:
        return error.code, b''

def backup():
    directory = BACKUPS / ('voyageplex-pre-919-' + datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ'))
    directory.mkdir(parents=True, mode=0o700)
    destination = directory / 'data-runtime'
    destination.mkdir(mode=0o700)
    with connect(DATA / 'voyageplex.db') as source, sqlite3.connect(destination / 'voyageplex.db') as target:
        source.backup(target)
    # Database journals are excluded: online backup already contains a consistent snapshot.
    for path in DATA.rglob('*'):
        require(not path.is_symlink())
        copied = destination / path.relative_to(DATA)
        if path.is_dir():
            copied.mkdir(parents=True, exist_ok=True, mode=0o700)
        elif path.is_file() and path.name not in {'voyageplex.db', 'voyageplex.db-wal', 'voyageplex.db-shm'}:
            copied.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            shutil.copyfile(path, copied)
            copied.chmod(0o600)
    (destination / 'voyageplex.db').chmod(0o600)
    shutil.copyfile(ROOT / '.env.cloud.production', directory / 'env.before')
    (directory / 'env.before').chmod(0o600)
    baseline = audit(destination / 'voyageplex.db')
    baseline['containers'] = containers()
    baseline['envDigest'] = file_hash(directory / 'env.before')
    (directory / 'baseline.json').write_bytes(canonical(baseline))
    manifest = {str(path.relative_to(directory)): file_hash(path) for path in directory.rglob('*') if path.is_file()}
    (directory / 'manifest.json').write_bytes(canonical(manifest))
    return {'backup': str(directory), 'onlineSnapshotVerified': True,
            'tableCounts': baseline['counts'], 'privateRecoveryFiles': len(manifest),
            'businessWritesPerformed': False, 'credentialsChanged': False}

def verify():
    directory = sorted(BACKUPS.glob('voyageplex-pre-919-*'))[-1]
    require(not directory.is_symlink() and directory.stat().st_mode & 0o077 == 0)
    manifest = json.loads((directory / 'manifest.json').read_bytes())
    require({'baseline.json', 'env.before', 'data-runtime/voyageplex.db'} <= set(manifest))
    for name, expected in manifest.items():
        path = directory / name
        require(path.resolve().is_relative_to(directory.resolve()) and path.is_file()
                and not path.is_symlink() and path.stat().st_mode & 0o077 == 0 and file_hash(path) == expected)
    before = json.loads((directory / 'baseline.json').read_bytes())
    current = audit(DATA / 'voyageplex.db')
    actual = containers()
    unchanged = [table for table in STABLE if before['stable'][table] == current['stable'][table]]
    added_confirmed_tasks = 0
    if len(unchanged) != len(STABLE):
        differences = stable_differences(directory / 'data-runtime/voyageplex.db', DATA / 'voyageplex.db')
        print(json.dumps({'stableTableDifferences': differences,
                          'userIdentityAndPermissionsSame': before['userIdentity'] == current['userIdentity']}, ensure_ascii=True))
        if set(differences) == {'ShipmentTasks'} and differences['ShipmentTasks']['rowsRemoved'] == 0 and differences['ShipmentTasks']['rowsChanged'] == 0:
            added_confirmed_tasks = concurrent_confirmed_tasks(directory / 'data-runtime/voyageplex.db', DATA / 'voyageplex.db', directory)
            require(added_confirmed_tasks == differences['ShipmentTasks']['rowsAdded'], 'STABLE_BUSINESS_TABLES')
    require(len(unchanged) == len(STABLE) or (len(unchanged) == len(STABLE) - 1 and added_confirmed_tasks > 0), 'STABLE_BUSINESS_TABLES')
    require(before['userIdentity'] == current['userIdentity'], 'USER_IDENTITY')
    require(all(current['owners'].get(key) == value for key, value in before['owners'].items()), 'EMAIL_OWNERSHIP')
    require(file_hash(ROOT / '.env.cloud.production') == before['envDigest'], 'SERVER_ENV')
    require(all(actual[key]['health'] == 'healthy' for key in SERVICES), 'CONTAINER_HEALTH')
    require(all(actual[key]['image'] != before['containers'][key]['image'] for key in SERVICES), 'CONTAINER_IMAGES')
    require(all(actual[key]['configDigest'] == before['containers'][key]['configDigest'] for key in SERVICES), 'CONTAINER_CONFIG')
    for key, values in before['cursors'].items():
        after = current['cursors'].get(key)
        require(after is not None and values[0] == after[0] and values[4] == after[4]
                and values[3] == after[3] and (values[1] != after[1] or int(after[2]) >= int(values[2])), 'MAILBOX_CURSORS')
    api = 'http://' + actual['voyageplex-api']['ip'] + ':5088'
    parser = 'http://' + actual['voyageplex-parser']['ip'] + ':8091'
    require(get(api + '/api/health')[0] == 200, 'API_HEALTH')
    require(get(parser + '/health')[0] == 200, 'PARSER_HEALTH')
    require(get('http://127.0.0.1/voyageplex/api/health')[0] == 200, 'PUBLIC_API_HEALTH')
    require(get(api + '/api/users')[0] == 401, 'ANONYMOUS_USERS')
    require(get(api + '/api/shipments')[0] == 401, 'ANONYMOUS_SHIPMENTS')
    app = 'apps/船务部/VoyagePlex船务协同系统'
    for file in ['app/parsing_policy.py', 'app/main.py']:
        reviewed = run(['git', 'show', 'HEAD:' + app + '/services/email-parser/' + file])
        deployed = run(['docker', 'exec', 'rr-portal-voyageplex-parser-1', 'cat', '/app/' + file])
        require(digest(reviewed) == digest(deployed), 'PARSER_SOURCE')
    policy = json.loads(run(['docker', 'exec', 'rr-portal-voyageplex-parser-1', 'python', '-c',
                            'import json;from app.parsing_policy import POLICY_VERSION,RULES;print(json.dumps({"version":POLICY_VERSION,"rules":len(RULES)}))']))
    require(policy['version'] == '2026-10-13.3', 'POLICY_VERSION')
    require(b'WarehouseSoRules' in run(['docker', 'exec', 'rr-portal-voyageplex-api-1', 'cat', '/app/VoyagePlex.Api.dll']), 'API_SYMBOL')
    commit = run(['git', 'rev-parse', 'HEAD']).decode().strip()
    require(commit == run(['git', 'rev-parse', 'origin/main']).decode().strip(), 'MAIN_REVISION')
    return {'verified': True, 'sourceCommit': commit, 'backup': str(directory),
            'stableBusinessTablesPreserved': unchanged, 'originalUserIdentityAndPermissionsPreserved': True,
            'allOriginalShipmentTaskRowsPreserved': True, 'concurrentConfirmedTasksAdded': added_confirmed_tasks,
            'existingEmailOwnershipPreserved': True, 'independentMailboxCursorsPreserved': True,
            'serverAndContainerConfigurationPreserved': True, 'allThreeImagesUpdatedAndHealthy': True,
            'parserSourceMatchesCurrentMain': True, 'policyVersion': policy['version'],
            'apiWarehouseSoRulesDeployed': True, 'anonymousApiDenied': True,
            'tableCounts': current['counts'], 'businessWritesPerformed': False,
            'credentialsChanged': False, 'historicalTasksRecalculated': False}

if __name__ == '__main__':
    try:
        require(len(sys.argv) == 2 and sys.argv[1] in {'backup', 'verify'})
        print(json.dumps(backup() if sys.argv[1] == 'backup' else verify(), ensure_ascii=True))
    except Exception as error:
        label = str(error) if isinstance(error, RuntimeError) and str(error) in CHECK_LABELS else 'UNEXPECTED'
        print(json.dumps({'failed': True, 'safeError': 'VOYAGEPLEX_919_OPS_FAILED', 'failedCheck': label}))
        sys.exit(1)
