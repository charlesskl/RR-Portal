"""Private online backup and read-only verification; never login, sync or write business data."""
import datetime
import hashlib
import json
import os
import pathlib
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

def require(condition):
    if not condition:
        raise RuntimeError('CHECK_FAILED')

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
    require(len(unchanged) == len(STABLE) and before['userIdentity'] == current['userIdentity'])
    require(all(current['owners'].get(key) == value for key, value in before['owners'].items()))
    require(file_hash(ROOT / '.env.cloud.production') == before['envDigest'])
    require(all(actual[key]['health'] == 'healthy' and actual[key]['image'] != before['containers'][key]['image']
                and actual[key]['configDigest'] == before['containers'][key]['configDigest'] for key in SERVICES))
    for key, values in before['cursors'].items():
        after = current['cursors'].get(key)
        require(after is not None and values[0] == after[0] and values[4] == after[4]
                and values[3] == after[3] and (values[1] != after[1] or int(after[2]) >= int(values[2])))
    api = 'http://' + actual['voyageplex-api']['ip'] + ':5088'
    parser = 'http://' + actual['voyageplex-parser']['ip'] + ':8091'
    require(get(api + '/api/health')[0] == 200 and get(parser + '/health')[0] == 200)
    require(get('http://127.0.0.1/voyageplex/api/health')[0] == 200)
    require(get(api + '/api/users')[0] == 401 and get(api + '/api/shipments')[0] == 401)
    app = 'apps/船务部/VoyagePlex船务协同系统'
    for file in ['app/parsing_policy.py', 'app/main.py']:
        reviewed = run(['git', 'show', 'HEAD:' + app + '/services/email-parser/' + file])
        deployed = run(['docker', 'exec', 'rr-portal-voyageplex-parser-1', 'cat', '/app/' + file])
        require(digest(reviewed) == digest(deployed))
    policy = json.loads(run(['docker', 'exec', 'rr-portal-voyageplex-parser-1', 'python', '-c',
                            'import json;from app.parsing_policy import POLICY_VERSION,RULES;print(json.dumps({"version":POLICY_VERSION,"rules":len(RULES)}))']))
    require(policy['version'] == '2026-10-13.3')
    require(b'WarehouseSoRules' in run(['docker', 'exec', 'rr-portal-voyageplex-api-1', 'cat', '/app/VoyagePlex.Api.dll']))
    commit = run(['git', 'rev-parse', 'HEAD']).decode().strip()
    require(commit == run(['git', 'rev-parse', 'origin/main']).decode().strip())
    return {'verified': True, 'sourceCommit': commit, 'backup': str(directory),
            'stableBusinessTablesPreserved': unchanged, 'originalUserIdentityAndPermissionsPreserved': True,
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
    except Exception:
        print(json.dumps({'failed': True, 'safeError': 'VOYAGEPLEX_919_OPS_FAILED'}))
        sys.exit(1)
