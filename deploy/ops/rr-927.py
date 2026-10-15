"""PR927 private JSON/file snapshots and read-only checks. Never deploys or calls write APIs."""
import datetime
import hashlib
import json
import os
import pathlib
import re
import shutil
import stat
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

ROOT = pathlib.Path('/opt/rr-portal')
APP = 'apps/工程部/工程啤办单'
BEFORE = '87844f57efe1b3387c9a18b51f4736489d01be98'
CORE = ('nginx', 'core', 'db', 'redis', 'printlink')
SERVICE = 'rr-production'
SHA = r'[a-f0-9]{40}'
BACKUP_RE = r'/opt/rr-portal/deploy/backups/rr-pre-927-[0-9]{8}T[0-9]{12}Z'
ASSETS = ('server.js', 'public/assembly.html', 'public/engineering.html',
          'public/supervisor.html', 'public/manager.html')
TYPES = ('injection', 'slush', 'spray', 'assembly')
COMPOSE = ['docker', 'compose', '-f', 'docker-compose.cloud.yml', '--env-file', '.env.cloud.production']
FAILED = 'arguments'
PUBLIC_DIAGNOSTICS = {}
LIMIT_FILE, LIMIT_TOTAL, LIMIT_FILES = 64 * 1024**2, 2 * 1024**3, 20000


def require(value, label):
    global FAILED
    FAILED = label
    if not value:
        raise RuntimeError('RR_927_CHECK_FAILED')


def run(args, data=None):
    # Capture all command output: neither Docker metadata, credentials nor business rows reach logs.
    environment = dict(os.environ, GIT_OPTIONAL_LOCKS='0')
    process = subprocess.run(args, input=data, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                             cwd=ROOT, env=environment, timeout=90)
    require(process.returncode == 0, 'readCommandSucceeded')
    return process.stdout


def git(*args):
    return run(['git', '-c', 'core.fsmonitor=false', '-c', 'core.quotepath=false', *args])


def sha(value):
    return hashlib.sha256(value).hexdigest()


def logical(value):
    return sha(json.dumps(value, sort_keys=True, ensure_ascii=True, separators=(',', ':'),
                          allow_nan=False).encode())


def read_regular(path):
    before_path = path.lstat()
    require(stat.S_ISREG(before_path.st_mode) and before_path.st_size <= LIMIT_FILE, 'regularFileSizeLimit')
    flags = os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK
    with os.fdopen(os.open(path, flags), 'rb') as handle:
        before = os.fstat(handle.fileno())
        require(stat.S_ISREG(before.st_mode) and before.st_size <= LIMIT_FILE
                and (before_path.st_dev, before_path.st_ino) == (before.st_dev, before.st_ino),
                'sameRegularFileOpened')
        value = handle.read(LIMIT_FILE + 1)
        after = os.fstat(handle.fileno())
    after_path = path.lstat()
    def version(info):
        return info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns
    require(version(before_path) == version(before) == version(after) == version(after_path)
            and len(value) == before.st_size,
            'fileStableWhileRead')
    return value


def inventory(directory):
    require(directory.is_dir() and not directory.is_symlink(), 'dataDirectoryExists')
    result = {'directories': [], 'files': {}}
    total = 0
    for parent, directories, files in os.walk(directory, followlinks=False):
        for name in sorted(directories):
            path = pathlib.Path(parent) / name
            require(path.is_dir() and not path.is_symlink(), 'dataDirectoriesNoSymlinks')
            result['directories'].append(path.relative_to(directory).as_posix())
        for name in sorted(files):
            path = pathlib.Path(parent) / name
            value = read_regular(path)
            total += len(value)
            require(total <= LIMIT_TOTAL and len(result['files']) < LIMIT_FILES, 'dataInventoryLimits')
            result['files'][path.relative_to(directory).as_posix()] = {'bytes': len(value), 'sha256': sha(value)}
    result['directories'].sort()
    require('data.json' in result['files'], 'existingJsonDatabase')
    return result


def private_json(path, value):
    with path.open('x', encoding='utf-8') as handle:
        os.chmod(path, 0o600)
        json.dump(value, handle, ensure_ascii=True, sort_keys=True, allow_nan=False)


def consistent_copy(source, destination):
    # JSON writes use rename; images may be edited separately. Accept only an unchanged full-tree window.
    require(not destination.exists(), 'newSnapshotDestination')
    for attempt in range(3):
        try:
            before = inventory(source)
            destination.mkdir(mode=0o700)
            for name in before['directories']:
                (destination / name).mkdir(mode=0o700, parents=True, exist_ok=True)
            for name in before['files']:
                path = destination / name
                with path.open('xb') as handle:
                    os.chmod(path, 0o600)
                    handle.write(read_regular(source / name))
            require(before == inventory(destination) == inventory(source), 'consistentFullDataSnapshot')
            data = json.loads(read_regular(destination / 'data.json'))
            require(isinstance(data, dict), 'jsonDatabaseObject')
            return before, data
        except (OSError, ValueError, RuntimeError):
            if destination.exists():
                shutil.rmtree(destination)
            if attempt == 2:
                raise
            time.sleep(0.15)


STARTUP_AUDIT = r"""
const fs = require('fs');
const {original, seed, source} = JSON.parse(fs.readFileSync(0, 'utf8'));
const data = structuredClone(original);
const effects = {missingPins:0, sprayCompletionBackfills:0, missingCollections:0,
 seedMaterialsToAdd:0, missingExchangeRate:0, missingAuthObjects:0,
 pendingClientInitialization:0, pendingClientRewrite:0};
const initializers = [...source.matchAll(/\(\s*function\s*([A-Za-z_$][\w$]*)?\s*\(/g)].map(m=>m[1]).sort();
if (JSON.stringify(initializers) !== JSON.stringify(['backfillSprayCompletedDate','initClients','initPins'])) throw Error('startupCoverage');
const stable = v => JSON.stringify(v && typeof v === 'object' ? (Array.isArray(v) ? v.map(v=>JSON.parse(stable(v))) : Object.fromEntries(Object.keys(v).sort().map(k=>[k,JSON.parse(stable(v[k]))]))) : v);
const norm = s => String(s||'').toLowerCase().replace(/[０-９]/g,c=>String.fromCharCode(c.charCodeAt(0)-0xFEE0)).replace(/度/g,'°').replace(/[\s\-\(\)（）_]/g,'');
if (!data.material_prices || data.material_prices.length === 0) {
 data.material_prices = seed.slice(); effects.seedMaterialsToAdd = seed.length;
} else if (seed.length) {
 const existing = new Set(data.material_prices.map(p=>norm(p.material)));
 for (const p of seed) if (!existing.has(norm(p.material))) { data.material_prices.push(p); effects.seedMaterialsToAdd++; }
}
for (const key of ['material_requisitions','assembly_orders','assembly_items','assembly_users']) {
 if (!data[key]) { data[key] = []; effects.missingCollections++; }
}
if (typeof data.exchange_rate_rmb_to_hkd !== 'number' || !(data.exchange_rate_rmb_to_hkd > 0)) {
 data.exchange_rate_rmb_to_hkd = 1.08; effects.missingExchangeRate++;
}
for (const field of ['auth_pins','auth_pins_must_change']) {
 if (!data[field]) { data[field] = {}; effects.missingAuthObjects++; }
 for (const role of ['supervisors','manager']) if (!data[field][role]) {
  data[field][role] = {}; effects.missingAuthObjects++;
 }
}
for (const [role,variable] of [['supervisors','ALL_SUPERVISORS'],['manager','ALL_MANAGERS']]) {
 const match = source.match(new RegExp('const '+variable+'\\s*=\\s*(\\[[^;]+\\]);'));
 if (!match) throw Error('startupSource');
 for (const name of JSON.parse(match[1].replace(/'/g,'"'))) if (!data.auth_pins[role][name]) effects.missingPins++;
}
for (const order of data.spray_orders||[]) {
 if (order.status !== '已完成' || order.completed_date) continue;
 const times = (data.spray_items||[]).filter(i=>i.order_id===order.id).flatMap(i=>[i.progress_at,...Object.values(i.process_status||{}).filter(Boolean).map(p=>p.done_at)].filter(Boolean)).map(t=>+new Date(t)).filter(t=>!isNaN(t));
 if (times.length) effects.sprayCompletionBackfills++;
}
const clientMatch = source.match(/const DEFAULT_CLIENTS\s*=\s*(\[[^;]+\]);/);
if (!clientMatch) throw Error('startupClientsSource');
const defaultClients = JSON.parse(clientMatch[1].replace(/'/g,'"'));
if (!data.clients) {
 data.clients = defaultClients.slice(); effects.pendingClientInitialization++;
} else if (data.clients.length < defaultClients.length) {
 data.clients = [...new Set([...data.clients, ...defaultClients])]; effects.pendingClientRewrite++;
}
// The client length branch calls saveData even if Set union leaves the logical values unchanged.
effects.otherLogicalStartupChanges = stable(data) !== stable(original) ? 1 : 0;
console.log(JSON.stringify(effects));
"""


def startup_effects(data, seed, source):
    # Node's own Date/normalization semantics avoid false positives from Python date parsing.
    payload = json.dumps({'original': data, 'seed': seed, 'source': source}, allow_nan=False).encode()
    return json.loads(run(['docker', 'exec', '-i', cid(SERVICE), 'node', '-e', STARTUP_AUDIT], payload))


def image_references(data, files):
    missing = 0
    for order in data.get('assembly_orders', []):
        names = list(order.get('images') or [])
        names.extend(item['image'] for item in data.get('assembly_items', [])
                     if item.get('order_id') == order.get('id') and item.get('image'))
        for name in names:
            relative = pathlib.PurePosixPath('assembly-images') / str(order['id']) / str(name)
            require('..' not in relative.parts and not pathlib.PurePosixPath(str(name)).is_absolute(),
                    'safeExistingImageReferences')
            missing += relative.as_posix() not in files
    return missing


def cid(service):
    require(service in (*CORE, SERVICE), 'fixedService')
    identifier = run(COMPOSE + ['ps', '-a', '-q', service]).decode().strip()
    require(re.fullmatch(r'[a-f0-9]{12,64}', identifier), 'singleExistingContainer')
    return identifier


def inspect(service):
    return json.loads(run(['docker', 'inspect', cid(service)]))[0]


def lifecycle(value):
    state = value['State']
    return {'containerId': value['Id'], 'startedAt': state['StartedAt'],
            'restartCount': value['RestartCount'], 'running': state['Running'],
            'health': state.get('Health', {}).get('Status', 'none'), 'oomKilled': state['OOMKilled']}


def core_state():
    return {service: lifecycle(inspect(service)) for service in CORE}


def healthy(value):
    return all(v['running'] and not v['oomKilled'] and v['health'] in ('healthy', 'none') for v in value.values())


def runtime():
    value = inspect(SERVICE)
    require(healthy({SERVICE: lifecycle(value)}) and value['State']['Health']['Status'] == 'healthy',
            'applicationHealthy')
    mounts = value['Mounts']
    require(len(mounts) == 1 and mounts[0]['Type'] == 'bind' and mounts[0]['RW']
            and mounts[0]['Destination'] == '/app/data'
            and pathlib.Path(mounts[0]['Source']) == ROOT / APP / 'data', 'expectedPersistentBindMount')
    env = dict(entry.split('=', 1) for entry in value['Config']['Env'])
    require(env.get('PORT', '3000') == '3000' and env.get('BASE_PATH') == '/rr'
            and env.get('DATA_PATH', '/app/data') == '/app/data', 'defaultProductionRoutingAndDataPath')
    # Protect app-consumed settings only: base-image NODE_VERSION/YARN_VERSION changes are normal.
    protected = {name: env.get(name, default) for name, default in
                 [('PORT', '3000'), ('BASE_PATH', '/rr'), ('DATA_PATH', '/app/data'),
                  ('PIN_SALT', 'rr-production-pin-salt-2026')]}
    return {'lifecycle': lifecycle(value), 'imageId': value['Image'],
            'applicationConfigSha256': logical(protected), 'mountsSha256': logical(mounts)}


def nginx_protected():
    nginx = cid('nginx')
    return {name: sha(run(['docker', 'exec', nginx, 'cat', path])) for name, path in
            [('actualConfig', '/etc/nginx/nginx.conf'), ('actualAuthorization', '/etc/nginx/.htpasswd')]}


def source_guard(expected):
    actual = git('rev-parse', 'HEAD').decode().strip()
    require(actual == expected == git('rev-parse', 'origin/main').decode().strip(), 'exactServerMainSha')
    # Production data (including tracked seed/.gitkeep permission drift) is protected by the full manifest.
    # It must not make a read-only code check mistake historical chmod for a code change.
    excluded_data = ':(exclude)' + APP + '/data'
    require(not git('diff', '--no-ext-diff', '--no-textconv', '--name-only', 'HEAD', '--', APP,
                    excluded_data, 'docker-compose.cloud.yml', 'nginx/nginx.cloud.conf'),
            'cleanTrackedDeploymentSource')
    require(not git('ls-files', '--others', '--exclude-standard', '--', APP, excluded_data),
            'noUntrackedApplicationSource')
    return actual


def deployment_scope(target):
    require(re.fullmatch(SHA, target), 'exactTargetSha')
    git('merge-base', '--is-ancestor', BEFORE, target)
    changed = git('diff', '--name-only', BEFORE, target).decode().splitlines()
    require(changed and all(path.startswith(APP + '/') and '/data/' not in path for path in changed),
            'onlyRequestedApplicationChanged')


HTTP_AUDIT = r"""
const fs = require('fs'), crypto = require('crypto');
const hash = b => crypto.createHash('sha256').update(b).digest('hex');
const stable = v => JSON.stringify(v && typeof v === 'object' ? (Array.isArray(v) ? v.map(v=>JSON.parse(stable(v))) : Object.fromEntries(Object.keys(v).sort().map(k=>[k,JSON.parse(stable(v[k]))]))) : v);
(async () => {
 const disk = JSON.parse(fs.readFileSync('/app/data/data.json'));
 const assets = {};
 for (const name of ['assembly.html','engineering.html','supervisor.html','manager.html']) {
   const response = await fetch('http://127.0.0.1:3000/'+name, {redirect:'error'});
   if (response.status !== 200) throw Error('asset');
   const body = Buffer.from(await response.arrayBuffer());
   assets[name] = {sha256:hash(body), noCache:(response.headers.get('cache-control')||'').includes('no-store'),
     quoteState:body.toString().includes('待报价')};
 }
 const api = {};
 for (const type of ['injection','slush','spray','assembly']) {
   const response = await fetch('http://127.0.0.1:3000/api/'+type, {redirect:'error'});
   if (response.status !== 200) throw Error('api');
   const actual = await response.json();
   const expected = disk[type+'_orders'].map(o=>({...o, items:disk[type+'_items'].filter(i=>i.order_id===o.id).sort((a,b)=>a.sort_order-b.sort_order)})).sort((a,b)=>b.id-a.id);
   api[type] = {count:actual.length, fullOrdersAndItemsMatch:stable(actual)===stable(expected)};
 }
 const stats = await fetch('http://127.0.0.1:3000/api/stats', {redirect:'error'});
 if (stats.status !== 200) throw Error('stats');
 const body = await stats.json();
 const statsMatch = ['injection','slush','spray','assembly'].every(t=>body[t]?.total===disk[t+'_orders'].length);
 console.log(JSON.stringify({assets,api,statsMatch}));
})().catch(()=>{ console.log(JSON.stringify({failed:true})); process.exitCode=1; });
"""


def http_status(path):
    require(path in ('/rr/health', '/rr/assembly.html', '/rr/engineering.html',
                     '/rr/supervisor.html', '/rr/manager.html', '/rr/api/assembly'),
            'fixedReadOnlyHttpRoute')
    try:
        with urllib.request.urlopen('http://127.0.0.1' + path, timeout=10) as response:
            # Public health payload only; never return HTML/API bodies to logs.
            return response.status, response.read(1024) if path == '/rr/health' else b''
    except urllib.error.HTTPError as error:
        return error.code, b''


def observe(expected, require_quote):
    context = runtime()
    identifier = cid(SERVICE)
    hashes = {}
    for name in ASSETS:
        actual_bytes = run(['docker', 'exec', identifier, 'cat', '/app/' + name])
        actual = sha(actual_bytes)
        wanted = sha(git('show', expected + ':' + APP + '/' + name))
        require(actual == wanted, 'runningReviewedSource:' + name)
        if require_quote and name == 'server.js':
            source = actual_bytes.decode()
            require(re.search(r'''app\.post\(['"]/api/assembly/:id/quote['"]''', source)
                    and 'nextUpdatedAt' in source and 'validateAssemblyOrder' in source
                    and 'expected_updated_at' in source,
                    'reviewedAtomicQuoteEndpointAndGuards')
        if require_quote and name == 'public/assembly.html':
            require(b'expected_updated_at' in actual_bytes and b'/quote' in actual_bytes,
                    'actualQuoteVersionPayload')
        hashes[name] = actual
    audit = json.loads(run(['docker', 'exec', identifier, 'node', '-e', HTTP_AUDIT]))
    require(audit.get('statsMatch') and all(v['fullOrdersAndItemsMatch'] for v in audit['api'].values()),
            'readOnlyApiFullOrdersAndItems')
    for name, asset in audit['assets'].items():
        require(asset['sha256'] == hashes['public/' + name] and asset['noCache'], 'actualHttpHtmlMatchesSource')
        if require_quote:
            require(asset['quoteState'], 'newQuoteStatusInActualHtml')
    status, body = http_status('/rr/health')
    require(status == 200 and json.loads(body).get('service') == SERVICE, 'nginxActualApplicationHealth')
    require(all(http_status(path)[0] == 401 for path in
                ('/rr/assembly.html', '/rr/engineering.html', '/rr/supervisor.html',
                 '/rr/manager.html', '/rr/api/assembly')), 'nginxAuthorizationStillRequired')
    return context, {'publicSourceHashes': hashes, 'readOnlyApi': audit, 'nginxHealthAndAuthPassed': True}


def data_audit(directory):
    manifest = inventory(directory)
    data = json.loads(read_regular(directory / 'data.json'))
    require(isinstance(data, dict), 'jsonDatabaseObject')
    for kind in TYPES:
        require(isinstance(data.get(kind + '_orders'), list) and isinstance(data.get(kind + '_items'), list),
                'existingBusinessCollections')
    missing = image_references(data, manifest['files'])
    require(missing == 0, 'allReferencedImagesExist')
    return manifest, data


def preflight(destination=None):
    source_guard(BEFORE)
    core = core_state()
    require(healthy(core), 'healthyFreshCoreBaseline')
    protected = nginx_protected()
    context, public = observe(BEFORE, False)
    data_dir = ROOT / APP / 'data'
    if destination is None:
        with tempfile.TemporaryDirectory(prefix='rr-927-private-') as temporary:
            manifest, data = consistent_copy(data_dir, pathlib.Path(temporary) / 'data')
    else:
        manifest, data = consistent_copy(data_dir, destination / 'data')
    seed = json.loads(read_regular(data_dir / 'default-material-prices.json'))
    effects = startup_effects(data, seed, git('show', BEFORE + ':' + APP + '/server.js').decode())
    PUBLIC_DIAGNOSTICS['startupEffects'] = effects
    require(not any(effects.values()), 'noStartupDataOrPinMigrationPending')
    require(image_references(data, manifest['files']) == 0, 'allReferencedImagesExist')
    require(manifest == inventory(data_dir), 'backupWindowDataStable')
    require(core == core_state() and protected == nginx_protected() and context == runtime(),
            'freshBaselineWindowStable')
    source_guard(BEFORE)
    result = {'beforeCommit': BEFORE, 'core': core, 'nginxProtected': protected, 'runtime': context,
              'manifest': manifest, 'jsonLogicalSha256': logical(data),
              'authorizationSha256': logical({k: data.get(k) for k in ('auth_pins', 'auth_pins_must_change', 'assembly_users')}),
              'startupEffects': effects}
    if destination:
        private_json(destination / 'manifest.json', result)
    public.update({'startupEffects': effects, 'fileCount': len(manifest['files']),
                   'orderCounts': {t: len(data[t + '_orders']) for t in TYPES}, 'coreHealthyAndStable': True})
    return public


def verify(directory, target):
    require(directory.is_dir() and not directory.is_symlink() and directory.stat().st_mode & 0o077 == 0,
            'privateExistingBackup')
    before = json.loads(read_regular(directory / 'manifest.json'))
    require(before['beforeCommit'] == BEFORE, 'backupBaselineSha')
    # Verify the backup itself before trusting its stored evidence.
    backup_manifest, backup_data = data_audit(directory / 'data')
    require(backup_manifest == before['manifest'] and logical(backup_data) == before['jsonLogicalSha256'],
            'privateBackupIntact')
    source_guard(target)
    deployment_scope(target)
    core = core_state()
    protected = nginx_protected()
    manifest, data = data_audit(ROOT / APP / 'data')
    try:
        context, public = observe(target, True)
        public['readOnlySmokeChecksPassed'] = True
    except Exception:
        context, public = None, {'readOnlySmokeChecksPassed': False, 'smokeFailedCheck': FAILED}
    checks = {'fullDataFileHashesPreserved': manifest == before['manifest'],
              'completeJsonValuesPreserved': logical(data) == before['jsonLogicalSha256'],
              'authorizationDataPreserved': logical({k: data.get(k) for k in ('auth_pins', 'auth_pins_must_change', 'assembly_users')}) == before['authorizationSha256'],
              'applicationConfigurationPreserved': bool(context) and context['applicationConfigSha256'] == before['runtime']['applicationConfigSha256'],
              'persistentMountPreserved': bool(context) and context['mountsSha256'] == before['runtime']['mountsSha256'],
              'actualNginxConfigAndAuthorizationPreserved': protected == before['nginxProtected'],
              'fiveCoreLifecyclesPreserved': core == before['core'], 'fiveCoreHealthy': healthy(core),
              'applicationRebuilt': bool(context) and context['imageId'] != before['runtime']['imageId'],
              'readOnlySmokeChecksPassed': public['readOnlySmokeChecksPassed'],
              'verificationWindowStable': bool(context) and core == core_state() and context == runtime()
               and protected == nginx_protected() and manifest == inventory(ROOT / APP / 'data')}
    try:
        checks['finalExactSourceVersion'] = source_guard(target) == target
    except Exception:
        checks['finalExactSourceVersion'] = False
    public.update({'checks': checks, 'targetCommit': target, 'backup': str(directory),
                   'fileCount': len(manifest['files']), 'passed': all(checks.values())})
    return public


def main(args):
    require(len(args) == 4, 'argumentCount')
    mode, before, target, path = args
    require(mode in ('preflight', 'backup', 'verify') and before == BEFORE and re.fullmatch(SHA, target),
            'exactArguments')
    os.umask(0o077)
    if mode in ('preflight', 'backup'):
        require(target == BEFORE and not path, 'backupExactBaselineArguments')
        directory = None
        if mode == 'backup':
            parent = ROOT / 'deploy/backups'
            parent.mkdir(exist_ok=True)
            require(not parent.is_symlink(), 'backupRootNoSymlink')
            stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
            directory = parent / ('rr-pre-927-' + stamp)
            directory.mkdir(mode=0o700)
        result = preflight(directory)
        result.update({'mode': mode, 'passed': True})
        if directory:
            result['backup'] = str(directory)
    else:
        require(target != BEFORE and re.fullmatch(BACKUP_RE, path), 'verifyExactBackupArguments')
        result = verify(pathlib.Path(path), target)
    result.update({'businessWritesPerformed': False, 'serviceRestartsPerformed': False})
    print(json.dumps(result, ensure_ascii=True, sort_keys=True))
    return 0 if result['passed'] else 1


if __name__ == '__main__':
    try:
        sys.exit(main(sys.argv[1:]))
    except Exception:
        # Deliberately omit exceptions, subprocess output and filenames from private data.
        print(json.dumps({'error': 'RR_927_CHECK_FAILED', 'failedCheck': FAILED,
                          'safeDiagnostics': PUBLIC_DIAGNOSTICS,
                          'businessWritesPerformed': False, 'serviceRestartsPerformed': False}))
        sys.exit(1)
