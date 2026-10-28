"""V7 one-shot reconciliation of a completed start; never replay the quote deploy.

No DB restore/reset, env edits, account changes, host Git checkout or merge. A failure
leaves its evidence and its owned service gate in place; it never retries lifecycle.
"""
import contextlib, copy, datetime, hashlib, importlib.util, json, os, pathlib, re
import shutil, sqlite3, stat, subprocess, sys, time, urllib.error, urllib.parse, urllib.request

ROOT = pathlib.Path('/opt/rr-portal')
BASE = '4b3d8f3e319e41dcc8720d759e1af0726a2b2381'
EXPECTED_TARGET = 'daa878ce6ed661d9b84288e7869b37e9118ce5bc'
EXPECTED_TREE = '05f17716f3cb93a7c3d06d2c604d5a4948fb8374'
EXPECTED_INSPECTION = '2d8b48851b11bd6df06a30c256eb758e8ad138eba195d249a104b331a9e2bdde'
FIXED_PREPARED_SHA256 = 'ceb7e412e444fb2d8f0dbc20726f87d7871cfff3ec8053cb730efb8b95828c11'
FAILED_QUOTE_MANIFEST_SHA256 = '4bcbc83caa8b18860b1c01edb87d25919ee60ee60d696740d5e899fabde6d8b6'
FAILED_QUOTE_RESULT_SHA256 = '78f55646f575e166cf4d372a0e96eb6ce8aaad026548e2832bb592459ff80221'
QUOTE_EVENT_SINCE = '2026-10-28T01:19:59Z'
QUOTE_FAILED_UNTIL = '2026-10-28T01:22:55.302198+00:00'
BRANCH = 'refs/heads/ops/batch-1015-1019-1022-20261028'
ARCHIVE_ROOT = ROOT / 'deploy/backups/batch-1015-1019-1022-20261028-existing-v4'
INSPECTION = ROOT / 'deploy/backups/batch-1015-1019-1022-20261028-inspect'
EXECUTE = False
TARGET = ''
TREE = ''
PHASE = ''
PREPARED_SHA256 = ''
INSPECTION_SHA256 = ''
QUOTE_DEPLOY_SHA256 = ''
PAIJI_DEPLOY_SHA256 = ''
APPS = {'internal-quote': 'apps/业务部/内部报价系统', 'paiji': 'apps/生产部/注塑啤机排产系统'}
CODE = {
    'internal-quote': {'backend/services/parseHardwareSheet.js': '/app/backend/services/parseHardwareSheet.js',
                       'frontend/mixed-sku.js': '/app/frontend/mixed-sku.js', 'frontend/quote.html': '/app/frontend/quote.html'},
    'paiji': {'server/services/excelExporter.js': '/app/services/excelExporter.js'},
}
STARTUP = {'internal-quote': {'package.json': '/app/package.json', 'backend/server.js': '/app/backend/server.js',
             'backend/db/index.js': '/app/backend/db/index.js', 'backend/db/postgres.js': '/app/backend/db/postgres.js',
             'backend/db/schema.postgres.sql': '/app/backend/db/schema.postgres.sql',
             'backend/db/accountSeed.js': '/app/backend/db/accountSeed.js', 'backend/db/account-seed.csv': '/app/backend/db/account-seed.csv'},
           'paiji': {'server/package-lock.json': '/app/package-lock.json', 'server/app.js': '/app/app.js',
                     'server/db/init.js': '/app/db/init.js', 'server/db/connection.js': '/app/db/connection.js',
                     'server/routes/auth.js': '/app/routes/auth.js'}}
MOUNTS = {'internal-quote': {'/app/backend/legacy-data': APPS['internal-quote'] + '/backend/data',
                            '/app/backend/uploads': APPS['internal-quote'] + '/backend/uploads'},
          'paiji': {'/app/data': APPS['paiji'] + '/data', '/app/uploads': APPS['paiji'] + '/uploads'}}
MOUNT_RW = {'internal-quote': {'/app/backend/legacy-data': False, '/app/backend/uploads': True},
            'paiji': {'/app/data': True, '/app/uploads': True}}
DEPS = {'release-data-ops-library.py': 'ff9138a1d5bfed1b10077112da6ebcda2d65240f583e2d0e12ce1325cfbaafd5',
        'release-data-library.py': 'd63168fd3057f4f2aba2d93f9fab31d2d65c6dd0f3234877d71fcff1e04e62b9'}
STAGE = 'entry'
OUT = None
L = None
O = None


def need(value, label):
    global STAGE
    if not value:
        STAGE = label
        raise RuntimeError('EXISTING_RELEASE_REJECTED')


def enc(value):
    return json.dumps(value, ensure_ascii=True, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()


def sha(value):
    return hashlib.sha256(value).hexdigest()


def pin(value, width=64):
    return type(value) is str and re.fullmatch('[a-f0-9]{%d}' % width, value) is not None


def private(path, value):
    raw = value if type(value) is bytes else enc(value)
    fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'wb') as stream:
        stream.write(raw)
        stream.flush()
        os.fsync(stream.fileno())


def run(args, data=None, timeout=180):
    result = subprocess.run(args, input=data, stdout=subprocess.PIPE, stderr=subprocess.PIPE, cwd=ROOT, timeout=timeout)
    need(result.returncode == 0 and len(result.stdout) <= 64 * 1024 ** 2, 'bounded-command')
    return result.stdout


def operation(args, label, timeout=300):
    # Exactly one attempt, with stdout/stderr retained privately even on failure.
    with (OUT / (label + '.private.log')).open('xb') as stream:
        result = subprocess.run(args, stdout=stream, stderr=subprocess.STDOUT, cwd=ROOT, timeout=timeout)
    need(result.returncode == 0, 'operation-' + label)


def load(name):
    path = pathlib.Path(__file__).with_name(name)
    need(path.is_file() and not path.is_symlink() and sha(path.read_bytes()) == DEPS[name], 'dependency-pin')
    spec = importlib.util.spec_from_file_location(name.replace('.', '_'), path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def initialize():
    global L, O
    for name, digest in DEPS.items():
        path = pathlib.Path(__file__).with_name(name)
        need(path.is_file() and not path.is_symlink() and sha(path.read_bytes()) == digest, 'all-dependency-pins-before-import')
    L = load('release-data-library.py')
    O = load('release-data-ops-library.py')
    L.databases = O.database_names
    O.L, O.ROOT, O.run, O.SCHEMAS, O.NEW_COLUMNS = L, ROOT, run, ('internal_quote',), {}


def read(path):
    need(path.is_file() and not path.is_symlink(), 'regular-private-evidence')
    return json.loads(path.read_bytes())


def metadata(path):
    need(not path.is_symlink() and (path.is_file() or path.is_dir()), 'regular-metadata')
    st = path.stat()
    return {'uid': st.st_uid, 'gid': st.st_gid, 'mode': stat.S_IMODE(st.st_mode)}


def runtime():
    ids = run(['docker', 'ps', '-aq', '--no-trunc']).decode().split()
    need(0 < len(ids) < 1000 and len(ids) == len(set(ids)), 'bounded-unique-runtime')
    records = json.loads(run(['docker', 'inspect', *ids]))
    values = {}
    for row in records:
        values[row['Id']] = {'image': row['Image'], 'config': row['Config'], 'hostConfig': row['HostConfig'],
                             'mounts': sorted(row['Mounts'], key=enc), 'started': row['State']['StartedAt'],
                             'restarts': row['RestartCount'], 'running': row['State']['Running'],
                             'oom': row['State']['OOMKilled'], 'health': row['State'].get('Health', {}).get('Status')}
    return values


def service(records, name):
    found = [(cid, value) for cid, value in records.items()
             if (value['config'].get('Labels') or {}).get('com.docker.compose.project') == 'rr-portal'
             and (value['config'].get('Labels') or {}).get('com.docker.compose.service') == name]
    need(len(found) == 1, 'unique-fixed-service-' + name)
    return found[0]


def env_files():
    values = {}
    for directory, dirs, files in os.walk(ROOT):
        dirs[:] = [name for name in dirs if name not in {'.git', 'node_modules', 'backups'}]
        for name in files:
            if name == '.env' or name.startswith('.env.'):
                path = pathlib.Path(directory) / name
                need(path.is_file() and not path.is_symlink() and path.stat().st_size <= 4 * 1024 ** 2, 'regular-bounded-env')
                values[str(path.relative_to(ROOT))] = dict(metadata(path), sha256=L.file_hash(path))
    need('.env.cloud.production' in values, 'production-env-present')
    return values


def source(name, row, revision):
    proof = {}
    for relative, destination in {**CODE[name], **STARTUP[name]}.items():
        raw = run(['docker', 'exec', '--user', '0', row[0], 'cat', destination])
        expected = run(['git', 'show', revision + ':' + APPS[name] + '/' + relative])
        need(raw == expected, 'exact-runtime-source-' + name)
        stats = run(['docker', 'exec', '--user', '0', row[0], 'stat', '-c', '%u:%g:%a', destination]).decode().strip()
        need(re.fullmatch('[0-9]+:[0-9]+:[0-7]{3,4}', stats) is not None, 'runtime-code-owner-mode')
        proof[relative] = {'sha256': sha(raw), 'metadata': stats}
    return proof


def host_guard():
    need(run(['git', 'rev-parse', 'HEAD']).decode().strip() == BASE, 'host-head-kept-at-base')
    need(run(['git', 'rev-parse', TARGET + '^{tree}']).decode().strip() == TREE, 'actual-target-tree')
    run(['git', 'merge-base', '--is-ancestor', BASE, TARGET])
    for name, app in APPS.items():
        names = [p for p in run(['git', 'diff', '--name-only', '-z', BASE, TARGET, '--', app]).decode().split('\0') if p]
        production = {p[len(app) + 1:] for p in names if '/tests/' not in p}
        need(production == set(CODE[name]), 'only-fixed-production-code-' + name)
        for relative in STARTUP[name]:
            need(run(['git', 'show', BASE + ':' + app + '/' + relative]) ==
                 run(['git', 'show', TARGET + ':' + app + '/' + relative]), 'startup-code-unchanged-' + name)


def persistent_roots(name, row):
    mounts = row[1]['mounts']
    if name == 'paiji':
        values = row[1]['config']['Env']
        environment = dict(value.split('=', 1) for value in values)
        need(len(environment) == len(values) and environment.get('DATA_PATH') == '/app/data', 'actual-paiji-data-path')
    need(len(mounts) == len(MOUNTS[name]), 'only-expected-storage-mounts')
    for destination, relative in MOUNTS[name].items():
        found = [m for m in mounts if m['Destination'] == destination]
        need(len(found) == 1 and found[0]['Type'] == 'bind' and found[0]['Source'] == str(ROOT / relative)
             and found[0]['RW'] is MOUNT_RW[name][destination], 'fixed-persistent-bind')
    return {destination: ROOT / relative for destination, relative in MOUNTS[name].items()}


def quote_storage_guard(records):
    def environment(name):
        values = service(records, name)[1]['config']['Env']
        result = dict(v.split('=', 1) for v in values)
        need(len(result) == len(values), 'unique-configured-env-keys')
        return result
    actual, db = environment('internal-quote'), environment('db')
    url = urllib.parse.urlsplit(actual.get('DATABASE_URL', ''))
    need(actual.get('DB_DRIVER') != 'sqlite' and (actual.get('DB_SCHEMA') or 'internal_quote') == 'internal_quote'
         and actual.get('LEGACY_SQLITE_FILE') == '/app/backend/legacy-data/data.db'
         and url.scheme in {'postgres', 'postgresql'} and url.hostname == 'db' and (url.port or 5432) == 5432
         and urllib.parse.unquote(url.path) == '/' + (db.get('POSTGRES_DB') or 'rrportal')
         and urllib.parse.unquote(url.username or '') == (db.get('POSTGRES_USER') or 'rrportal')
         and not url.query and not url.fragment, 'actual-configured-quote-postgres-and-legacy-roots')


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, response, code, message, headers, newurl):
        return None


def http_status(path):
    need(path in {'/', '/internal-quote/', '/internal-quote/health', '/internal-quote/api/auth/me',
                  '/paiji/', '/paiji/health', '/paiji/api/auth/verify'}, 'fixed-credential-free-get')
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    request = urllib.request.Request('http://127.0.0.1' + path, headers={'User-Agent': 'RR-Portal-scoped-readonly-probe'})
    try:
        response = opener.open(request, timeout=15)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        response.read(131072)
        return response.status


def entry_probe(name, maintained=False):
    own_api = '/internal-quote/api/auth/me' if name == 'internal-quote' else '/paiji/api/auth/verify'
    other = 'paiji' if name == 'internal-quote' else 'internal-quote'
    statuses = {path: http_status(path) for path in ('/', '/' + name + '/health', own_api, '/' + other + '/health', '/' + name + '/')}
    need(statuses['/'] in {200, 401} and statuses['/' + other + '/health'] == 200, 'portal-and-other-service-stay-available')
    need(statuses['/' + name + '/health'] == (503 if maintained else 200)
         and statuses[own_api] == (503 if maintained else 401)
         and statuses['/' + name + '/'] in ({503} if maintained else {200, 401}), 'actual-single-service-maintenance-entry-isolation')
    return statuses


def storage(name, row, label, with_dump=True):
    directory = OUT / label
    directory.mkdir(mode=0o700)
    result = {'roots': {}}
    for index, (destination, tree) in enumerate(sorted(persistent_roots(name, row).items())):
        part = directory / str(index)
        part.mkdir(mode=0o700)
        copies = part / 'sqlite'
        copies.mkdir(mode=0o700)
        names = O.database_names(tree)
        databases = L.snapshots(tree, copies)
        files = L.non_database_inventory(tree, names, part / 'files.tar')
        physical = set(names) | {n + suffix for n in names for suffix in ('-wal', '-shm', '-journal')}
        owners = {'.': metadata(tree), **{str(p.relative_to(tree)): metadata(p) for p in sorted(tree.rglob('*'))
                                        if str(p.relative_to(tree)) not in physical}}
        result['roots'][destination] = {'sqlite': databases, 'files': files, 'ownership': owners,
                                       'databaseMetadata': {n: metadata(tree / n) for n in names}, 'index': index}
        # Complete raw cold-file archive is evidence only; it is never restored.
        if with_dump:
            L.non_database_inventory(tree, [], part / 'raw-tree.tar')
    if name == 'internal-quote':
        dbid, _ = service(runtime(), 'db')
        result['postgres'] = O.pg_capture(dbid, directory, with_dump)['internal_quote']
        result['startupGuard'] = quote_guard(dbid)
    private(directory / 'capture.private.json', result)
    return result, directory


def quote_guard(dbid):
    # Reject a full day before the existing 30-day purge boundary as well.
    sql = """BEGIN READ ONLY; SET LOCAL search_path=internal_quote,public;
SELECT json_build_object(
'users',(SELECT count(*) FROM users),'quotes',(SELECT count(*) FROM quotes),'departments',(SELECT count(*) FROM departments),
'purgeRisk',(SELECT count(*) FROM quotes WHERE deleted_at < CURRENT_TIMESTAMP - INTERVAL '29 days'),
'migrations',(SELECT count(*) FROM app_migrations WHERE key IN ('qingxi_material_prices_20260819','retire_heyuan_factory_20260819','configured_accounts_20260831_v1')),
'missingSections',(SELECT count(*) FROM quotes q CROSS JOIN departments d WHERE NOT EXISTS(SELECT 1 FROM quote_sections s WHERE s.quote_id=q.id AND s.dept=d.code)),
'missingManagers',(SELECT count(*) FROM factory_material_price_control c WHERE c.manager_user_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM factory_material_price_managers m WHERE m.factory_code=c.factory_code AND m.user_id=c.manager_user_id)),
'missingUserFactories',(SELECT count(*) FROM users u WHERE NOT EXISTS(SELECT 1 FROM user_factories f WHERE f.user_id=u.id AND f.factory_code=u.factory_code)),
'factoryMismatch',(SELECT count(*) FROM (VALUES ('qingxi','清溪',1,1),('heyuan','河源',2,0)) v(code,name_cn,sort_order,active) WHERE NOT EXISTS(SELECT 1 FROM factories f WHERE f.code=v.code AND f.name_cn=v.name_cn AND f.sort_order=v.sort_order AND f.active=v.active)),
'departmentMismatch',(SELECT count(*) FROM (VALUES ('sales','业务',1),('engineering','工程/业务',2),('electronic','电子部',3),('molding','啤机部',4),('painting','喷油部',5),('slush','搪胶',6),('sewing','车缝',7),('assembly','装配部',8)) v(code,name_cn,sort_order) WHERE NOT EXISTS(SELECT 1 FROM departments d WHERE d.code=v.code AND d.name_cn=v.name_cn AND d.sort_order=v.sort_order)),
'missingRefs',(SELECT count(*) FROM (VALUES ('material_prices'),('machine_prices')) v(key) WHERE NOT EXISTS(SELECT 1 FROM ref_tables r WHERE r.key=v.key)),
'missingFactoryRefs',(SELECT count(*) FROM (VALUES ('qingxi'),('heyuan')) f(code) CROSS JOIN (VALUES ('material_prices'),('machine_prices'),('costing_basis')) v(key) WHERE NOT EXISTS(SELECT 1 FROM factory_ref_tables r WHERE r.factory_code=f.code AND r.key=v.key)));
COMMIT;
"""
    raw = run(['docker', 'exec', '-i', dbid, 'sh', '-c',
               'exec psql -X -q -At -v ON_ERROR_STOP=1 -U "${POSTGRES_USER:-rrportal}" -d "${POSTGRES_DB:-rrportal}"'], sql.encode())
    value = json.loads(raw)
    need(value['users'] > 0 and value['migrations'] == 3 and value['departments'] >= 8
         and all(v == 0 for k, v in value.items() if k not in {'users', 'migrations', 'quotes', 'departments'}), 'quote-no-startup-data-or-permission-changes')
    return value


def sequences(path):
    with contextlib.closing(L.connect(path, True)) as connection:
        return dict(connection.execute('SELECT name,seq FROM sqlite_sequence ORDER BY name'))


def sqlite_restart_compare(before, after, old_path, new_path):
    a, b = copy.deepcopy(before), copy.deepcopy(after)
    old, new = sequences(old_path), sequences(new_path)
    need(set(old) == set(new) and new['machines'] - old['machines'] == 108
         and all(new[k] == old[k] for k in old if k != 'machines'), 'only-known-machine-sequence-consumption')
    a['tables'].pop('sqlite_sequence')
    b['tables'].pop('sqlite_sequence')
    need(a == b, 'all-sqlite-rows-schema-permissions-exact')


def rehearse_paiji(capture, directory, image):
    root = capture['roots']['/app/data']
    need('paiji.db' in root['sqlite'], 'primary-actual-paiji-database-present')
    original = directory / str(root['index']) / 'sqlite' / 'paiji.db'
    scratch = OUT / ('paiji-rehearsal-' + PHASE)
    scratch.mkdir(mode=0o700)
    shutil.copy2(original, scratch / 'paiji.db')
    probe = 'rr-batch1022-v4-paiji-rehearsal-' + PHASE
    # Unique create, start once, inspect exit, then remove this owned stopped probe.
    operation(['docker', 'create', '--name', probe, '--network', 'none', '--user', '0', '--mount',
               'type=bind,source=' + str(scratch) + ',target=/app/data', '--entrypoint', 'node', image,
               '-e', "require('/app/db/init').initDatabase();require('/app/db/connection').close();"], 'rehearsal-create')
    operation(['docker', 'start', '-a', probe], 'rehearsal-start')
    record = json.loads(run(['docker', 'inspect', probe]))[0]
    private(OUT / 'rehearsal-container.private.json', record)
    need(record['State']['Status'] == 'exited' and record['State']['ExitCode'] == 0
         and record['HostConfig']['NetworkMode'] == 'none' and record['Image'] == image, 'isolated-old-image-init-succeeded')
    after = L.snapshots(scratch)
    sqlite_restart_compare(root['sqlite']['paiji.db'], after['paiji.db'], original, scratch / 'paiji.db')
    operation(['docker', 'rm', probe], 'rehearsal-remove-owned-stopped-probe')


def compare_capture(name, before, after, old_dir, new_dir):
    a, b = copy.deepcopy(before), copy.deepcopy(after)
    if name == 'paiji':
        old, new = a['roots']['/app/data'], b['roots']['/app/data']
        sqlite_restart_compare(old['sqlite']['paiji.db'], new['sqlite']['paiji.db'],
                               old_dir / str(old['index']) / 'sqlite/paiji.db', new_dir / str(new['index']) / 'sqlite/paiji.db')
        old['sqlite']['paiji.db']['tables'].pop('sqlite_sequence')
        new['sqlite']['paiji.db']['tables'].pop('sqlite_sequence')
    else:
        old, new = a['postgres'], b['postgres']
        need(old['sequenceStateStableDuringCapture'] and new['sequenceStateStableDuringCapture'], 'stable-postgres-sequences')
        n = before['startupGuard']['quotes'] * before['startupGuard']['departments']
        sequence = 'quote_sections_id_seq'
        need(old['sequenceStates'][sequence]['called'] is True and new['sequenceStates'][sequence]['called'] is True
             and int(new['sequenceStates'][sequence]['lastValue']) - int(old['sequenceStates'][sequence]['lastValue']) == n, 'only-quote-section-one-startup-sequence-increment')
        old['sequenceStates'][sequence] = new['sequenceStates'][sequence]
    need(a == b, 'all-other-full-data-auth-schema-storage-exact')


def manifest(directory):
    entries = sorted(directory.rglob('*'))
    need(len(entries) <= 100000 and all(not p.is_symlink() and (p.is_file() or p.is_dir()) for p in entries), 'regular-bounded-evidence-tree')
    return {str(p.relative_to(directory)): L.file_hash(p) for p in entries if p.is_file()}


def host_files(expected):
    for name, value in expected.items():
        path = ROOT / name
        need(dict(metadata(path), sha256=L.file_hash(path)) == value, 'all-original-host-config-files-preserved')


def prepared():
    directory = ARCHIVE_ROOT / 'prepare'
    path = directory / 'manifest.json'
    need(pin(PREPARED_SHA256) and L.file_hash(path) == PREPARED_SHA256, 'exact-prepared-manifest')
    values = read(path)
    need(all(not p.is_symlink() for p in directory.rglob('*')), 'no-prepared-evidence-symlinks')
    actual = {str(p.relative_to(directory)): p for p in directory.rglob('*') if p.is_file()
              and p.name not in {'manifest.json', 'result.private.json'}}
    need(set(actual) == set(values) and all(not p.is_symlink() and L.file_hash(p) == values[n] for n, p in actual.items()), 'all-prepared-evidence-and-code-seals')
    value = read(directory / 'prepared.private.json')
    need(value['target'] == TARGET and value['tree'] == TREE, 'prepared-source-bound')
    return value


def sealed_deployment(name, digest):
    phase = 'finalize-internal-quote' if name == 'internal-quote' else 'deploy-' + name
    directory = ARCHIVE_ROOT / ('finalize-internal-quote-v7' if name == 'internal-quote' else phase)
    need(pin(digest) and L.file_hash(directory / 'manifest.json') == digest, 'exact-successful-deploy-manifest')
    values = read(directory / 'manifest.json')
    need(all(not p.is_symlink() for p in directory.rglob('*')), 'no-deploy-evidence-symlinks')
    actual = {str(p.relative_to(directory)): p for p in directory.rglob('*') if p.is_file()
              and p.name not in {'manifest.json', 'result.private.json'}}
    need(set(actual) == set(values) and all(not p.is_symlink() and L.file_hash(p) == values[n] for n, p in actual.items()), 'all-prior-deploy-evidence-seals')
    value = read(directory / 'result.private.json')
    need(value.get('success') is True and value.get('phase') == phase and value.get('base') == BASE
         and value.get('target') == TARGET and value.get('tree') == TREE and value.get('manifestSHA256') == digest,
         'prior-single-deploy-success-bound')
    return value


def local_base_tag(name, image):
    need(name in APPS and re.fullmatch('sha256:[a-f0-9]{64}', image) is not None, 'fixed-original-local-image')
    tag = 'rr-portal-' + name + ':batch1022-v4-base-' + image.split(':', 1)[1]
    existing = run(['docker', 'image', 'ls', '--filter', 'reference=' + tag, '--no-trunc', '--format', '{{.ID}}'])
    need(not existing.strip(), 'fresh-unique-task-local-base-tag')
    operation(['docker', 'tag', image, tag], name + '-local-base-tag')
    actual = json.loads(run(['docker', 'image', 'inspect', tag]))
    need(len(actual) == 1 and actual[0]['Id'] == image, 'unique-local-base-tag-equals-original-immutable-image')
    return tag


def prepare():
    need(not PREPARED_SHA256, 'prepare-has-no-prior-prepare-pin')
    inspection = read(INSPECTION / 'result.private.json')
    need(pin(INSPECTION_SHA256) and sha(enc(inspection)) == INSPECTION_SHA256 and inspection['success'] is True
         and inspection['base'] == BASE, 'exact-successful-original-inventory')
    before = runtime()
    private(OUT / 'prepare-runtime-before.private.json', before)
    environment_before = env_files()
    private(OUT / 'prepare-env-before.private.json', environment_before)
    quote_storage_guard(before)
    startup_preflight = quote_guard(service(before, 'db')[0])
    host_files(inspection['hostFiles'])
    result = {'target': TARGET, 'tree': TREE, 'runtime': before, 'envFiles': environment_before, 'hostFiles': inspection['hostFiles'],
              'quoteStartupPreflight': startup_preflight, 'services': {}}
    for name in APPS:
        row = service(before, name)
        need(row[0] == inspection['targets'][name]['id'] and row[1]['image'] == inspection['targets'][name]['image'], 'same-original-inspected-service')
        proof = source(name, row, BASE)
        persistent_roots(name, row)
        context = OUT / (name + '-build')
        context.mkdir(mode=0o700)
        base_tag = local_base_tag(name, row[1]['image'])
        dockerfile = ['FROM ' + base_tag]
        code = {}
        for index, (relative, destination) in enumerate(CODE[name].items()):
            raw = run(['git', 'show', TARGET + ':' + APPS[name] + '/' + relative])
            uid, gid, mode = proof[relative]['metadata'].split(':')
            file = context / ('code' + str(index))
            private(file, raw)
            os.chmod(file, int(mode, 8))
            dockerfile.append('COPY --chown=' + uid + ':' + gid + ' ' + file.name + ' ' + destination)
            code[relative] = {'sha256': sha(raw), 'metadata': proof[relative]['metadata'], 'contextName': file.name}
        private(context / 'Dockerfile', ('\n'.join(dockerfile) + '\n').encode())
        tag = 'rr-portal-' + name + ':batch1022-v4-' + TARGET[:12]
        operation(['docker', 'build', '--network=none', '--pull=false', '-t', tag, str(context)], name + '-build', 900)
        candidate = json.loads(run(['docker', 'image', 'inspect', tag]))[0]
        base = json.loads(run(['docker', 'image', 'inspect', row[1]['image']]))[0]
        keys = ('Cmd', 'Entrypoint', 'Env', 'User', 'WorkingDir', 'Healthcheck', 'ExposedPorts', 'Labels', 'Volumes', 'StopSignal')
        need(all(candidate['Config'].get(k) == base['Config'].get(k) for k in keys)
             and candidate['RootFS']['Layers'][:len(base['RootFS']['Layers'])] == base['RootFS']['Layers'], 'durable-candidate-inherits-original-runtime')
        result['services'][name] = {'container': row[0], 'oldImage': row[1]['image'], 'candidateImage': candidate['Id'], 'localBaseTag': base_tag, 'code': code, 'baseProof': proof}
    paiji = service(before, 'paiji')
    captured, directory = storage('paiji', paiji, 'paiji-online-rehearsal', False)
    rehearse_paiji(captured, directory, paiji[1]['image'])
    after = runtime()
    private(OUT / 'prepare-runtime-after.private.json', after)
    environment_after = env_files()
    private(OUT / 'prepare-env-after.private.json', environment_after)
    need(after == before, 'prepare-keeps-all-original-containers')
    need(environment_after == result['envFiles'], 'prepare-keeps-all-original-env')
    private(OUT / 'prepared.private.json', result)
    return {'candidateImages': {n: v['candidateImage'] for n, v in result['services'].items()}, 'allOriginalRuntimeAndEnvPreserved': True}



def utc_ns(value):
    need(type(value) is str and len(value) <= 40, 'bounded-utc-time')
    match = re.fullmatch(r'(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?(?:Z|\+00:00)', value)
    need(match is not None, 'explicit-nanosecond-utc-time')
    parsed = datetime.datetime.fromisoformat(match[1] + '+00:00')
    delta = parsed - datetime.datetime(1970, 1, 1, tzinfo=datetime.timezone.utc)
    return (delta.days * 86400 + delta.seconds) * 1000000000 + int((match[2] or '').ljust(9, '0'))


def single_start_runtime(old, new, since, until, expected_old_restarts):
    need(old['restarts'] == expected_old_restarts and new['restarts'] == 0
         and old['started'] != new['started'] and utc_ns(since) <= utc_ns(new['started']) <= utc_ns(until)
         and all(old[k] == new[k] for k in old if k not in {'started', 'restarts'})
         and new['running'] is True and new['oom'] is False and new['health'] == 'healthy',
         'same-container-exact-single-manual-start-and-counter-reset')


def stable_operation_file(path, maximum):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        first = os.fstat(fd)
        need(stat.S_ISREG(first.st_mode) and first.st_uid == 0 and first.st_gid == 0
             and stat.S_IMODE(first.st_mode) == 0o600 and first.st_nlink == 1
             and 0 < first.st_size <= maximum and first.st_ctime_ns == first.st_mtime_ns, 'private-single-link-operation-proof-file')
        raw = os.read(fd, maximum + 1)
        last, named = os.fstat(fd), path.lstat()
        def record(v):
            return {'device': v.st_dev, 'inode': v.st_ino, 'uid': v.st_uid, 'gid': v.st_gid,
                    'mode': stat.S_IMODE(v.st_mode), 'links': v.st_nlink, 'bytes': v.st_size,
                    'mtimeNs': v.st_mtime_ns, 'ctimeNs': v.st_ctime_ns}
        need(record(first) == record(last) == record(named) and len(raw) == first.st_size,
             'stable-operation-proof-descriptor-and-name')
        return dict(record(first), sha256=sha(raw)), raw
    finally:
        os.close(fd)


def single_operation_log_proof(cid, started, since, completed_until, directory, sealed_files=None):
    need(pin(cid) and directory.is_dir() and not directory.is_symlink(), 'fixed-single-operation-container-and-directory')
    names = {'stop': 'internal-quote-stop.private.log', 'start': 'internal-quote-start.private.log'} if directory.name == 'deploy-internal-quote' else {
             'stop': 'paiji-stop.private.log', 'start': 'paiji-start.private.log'}
    need(directory in {ARCHIVE_ROOT / 'deploy-internal-quote', OUT} and (directory.name == 'deploy-internal-quote' or PHASE == 'deploy-paiji'),
         'only-original-quote-or-current-paiji-operation-proof')
    names.update(coldBefore='cold-before/capture.private.json', coldAfter='cold-after-start/capture.private.json')
    records = {}
    recognized_stop_warning = False
    for label, relative in names.items():
        record, raw = stable_operation_file(directory / relative, 128 if label in {'stop', 'start'} else 8 * 1024 ** 2)
        if sealed_files is not None:
            need(relative in sealed_files and record['sha256'] == sealed_files[relative], 'original-operation-proof-file-still-byte-sealed')
        if label in {'stop', 'start'}:
            exact = (cid + chr(10)).encode()
            warning = b'Flag --time has been deprecated, use --timeout instead' + bytes([10])
            recognized = label == 'stop' and raw == warning + exact
            need(raw == exact or recognized, 'single-successful-command-output-is-exact-container-id')
            recognized_stop_warning = recognized_stop_warning or recognized
        records[relative] = record
    start_path = directory / names['start']
    birth_raw = run(['env', 'TZ=UTC', 'stat', '--format=%w', '--', str(start_path)]).decode().strip()
    birth_match = re.fullmatch(r'([0-9]{4}-[0-9]{2}-[0-9]{2}) ([0-9]{2}:[0-9]{2}:[0-9]{2})(?:[.]([0-9]{1,9}))? [+]0000', birth_raw)
    need(birth_match is not None, 'actual-filesystem-birthtime-required-no-guess')
    birth = utc_ns(birth_match[1] + 'T' + birth_match[2] + ('.' + birth_match[3] if birth_match[3] else '') + 'Z')
    # Metadata is newly observed, not a field of the original SHA-only manifest.
    # Exact inode/type/owner/mode/bytes/hash are checked again after GNU stat.
    need(stable_operation_file(start_path, 128)[0] == records[names['start']], 'same-start-log-inode-after-birthtime-read')
    start, stop = records[names['start']], records[names['stop']]
    cold_before, cold_after = records[names['coldBefore']], records[names['coldAfter']]
    first, last, process_start = utc_ns(since), utc_ns(completed_until), utc_ns(started)
    need(first <= stop['mtimeNs'] <= cold_before['mtimeNs'] <= birth <= process_start <= start['mtimeNs']
         <= cold_after['mtimeNs'] <= last and 0 <= start['mtimeNs'] - birth <= 90 * 1000000000,
         'exact-completed-single-start-log-and-cold-capture-nanosecond-timeline')
    proof = {'directory': str(directory), 'files': records, 'startLogBirthNs': birth, 'containerStartedNs': process_start,
             'since': since, 'completedUntil': completed_until,
             'operationLogMetadataWasNotOriginallySealed': True, 'onlyCurrentMetadataCASClaimed': True,
             'recognizedStopTimeoutDeprecationWarning': recognized_stop_warning}
    private(OUT / 'single-start-operation-log-proof.private.json', proof)
    return proof


def same_operation_proof(proof):
    if proof is None: return
    directory = pathlib.Path(proof['directory'])
    for relative, expected in proof['files'].items():
        need(stable_operation_file(directory / relative, 128 if relative.endswith('-stop.private.log') or relative.endswith('-start.private.log') else 8 * 1024 ** 2)[0] == expected,
             'same-current-operation-proof-inode-metadata-and-bytes-before-mutation')


def single_start_events(cid, since, until, completed_until=None, started=None, operation_directory=None, sealed_files=None):
    first, last = utc_ns(since), utc_ns(until)
    need(first < last, 'positive-fixed-event-window')
    raw = run(['docker', 'events', '--since', since, '--until', until, '--filter', 'type=container',
               '--filter', 'container=' + cid, '--format', '{{json .}}'])
    need(len(raw) <= 8 * 1024 ** 2, 'bounded-private-event-stream')
    private(OUT / 'single-start-events.raw.private', raw)
    rows = [json.loads(line) for line in raw.splitlines() if line.strip()]
    need(len(rows) < 10000, 'bounded-container-event-count')
    private(OUT / 'single-start-events.private.json', {'since': since, 'until': until, 'completedUntil': completed_until, 'events': rows})
    parsed = []
    forbidden = {'create', 'destroy', 'restart', 'oom', 'pause', 'unpause', 'update', 'rename'}
    boundary = utc_ns(completed_until) if completed_until is not None else last
    need(first < boundary <= last, 'fixed-completed-event-boundary')
    for row in rows:
        need(type(row) is dict and row.get('Type') == 'container'
             and row.get('Actor', {}).get('ID') == cid and type(row.get('timeNano')) is int,
             'exact-event-container-and-timestamp')
        action, stamp = row.get('Action'), row['timeNano']
        need(type(action) is str and first <= stamp <= last and action not in forbidden,
             'no-extra-container-lifecycle-or-restart')
        if action == 'kill':
            need(str(row.get('Actor', {}).get('Attributes', {}).get('signal')) in {'15', 'SIGTERM'},
                 'only-one-graceful-stop-signal')
        if action in {'die', 'stop', 'start', 'kill'}:
            need(stamp <= boundary, 'no-observed-later-container-lifecycle')
        parsed.append((action, stamp))
    need([stamp for _, stamp in parsed] == sorted(stamp for _, stamp in parsed), 'ordered-container-event-stream')
    selected = {action: [stamp for name, stamp in parsed if name == action] for action in ('die', 'stop', 'start', 'kill')}
    need(all(len(stamps) <= 1 for stamps in selected.values()), 'no-observed-repeated-lifecycle-even-when-history-incomplete')
    complete = all(len(selected[action]) == 1 for action in ('die', 'stop', 'start'))
    if complete:
        need(max(selected['die'][0], selected['stop'][0]) < selected['start'][0]
             and (not selected['kill'] or selected['kill'][0] <= selected['die'][0]), 'completed-single-stop-before-start')
        return {'mode': 'complete-events', 'completeLifecycleEventsObserved': True,
                'die': 1, 'stop': 1, 'start': 1, 'laterLifecycle': 0, 'automaticRestart': 0}, None
    # Docker retains only a bounded daemon-global event ring. Missing historical
    # records alone may use this precise same-operation proof; conflicts never do.
    need(started is not None and operation_directory is not None, 'missing-events-require-exact-operation-log-proof')
    process_start = utc_ns(started)
    need(all(stamp <= process_start for name in ('die', 'stop', 'kill') for stamp in selected[name])
         and all(process_start <= stamp <= boundary for stamp in selected['start']), 'no-observed-event-conflicts-with-current-start')
    proof = single_operation_log_proof(cid, started, since, completed_until or until, operation_directory, sealed_files)
    need(all(stamp <= proof['files'][('internal-quote-start.private.log' if operation_directory.name == 'deploy-internal-quote' else 'paiji-start.private.log')]['mtimeNs'] for stamp in selected['start']),
         'observed-start-must-still-be-original-command-window')
    return {'mode': 'bounded-single-operation-log-window', 'completeLifecycleEventsObserved': False,
            'observedLifecycleCounts': {name: len(stamps) for name, stamps in selected.items()},
            'originalSingleStartInOperationLogWindow': True, 'noConflictingObservedLifecycle': True,
            'operationLogMetadataWasNotOriginallySealed': True,
            'recognizedStopTimeoutDeprecationWarning': proof['recognizedStopTimeoutDeprecationWarning']}, proof


def current_gate_record(path):
    parent = path.parent.stat()
    need(path.parent.is_dir() and not path.parent.is_symlink() and parent.st_uid == 0
         and not (stat.S_IMODE(parent.st_mode) & 0o022), 'root-owned-unwritable-service-gate-parent')
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        before = os.fstat(fd)
        need(stat.S_ISREG(before.st_mode) and before.st_uid == 0 and before.st_gid == 0
             and stat.S_IMODE(before.st_mode) == 0o600 and before.st_size == 0 and os.read(fd, 1) == b'',
             'current-empty-v4-mode-private-service-gate')
        after, named = os.fstat(fd), path.lstat()
        keys = lambda v: (v.st_dev, v.st_ino, v.st_uid, v.st_gid, v.st_mode, v.st_size, v.st_mtime_ns, v.st_ctime_ns)
        need(keys(before) == keys(after) == keys(named), 'stable-current-service-gate-inode')
        return {'device': before.st_dev, 'inode': before.st_ino, 'uid': before.st_uid, 'gid': before.st_gid,
                'mode': stat.S_IMODE(before.st_mode), 'size': 0, 'sha256': sha(b''),
                'mtimeNs': before.st_mtime_ns, 'ctimeNs': before.st_ctime_ns}
    finally:
        os.close(fd)


def failed_quote_evidence():
    directory = ARCHIVE_ROOT / 'deploy-internal-quote'
    path = directory / 'manifest.json'
    need(L.file_hash(path) == FAILED_QUOTE_MANIFEST_SHA256 and not directory.is_symlink(), 'fixed-failed-quote-manifest')
    values = read(path)
    entries = list(directory.rglob('*'))
    need(len(entries) < 100000 and all(not p.is_symlink() and (p.is_file() or p.is_dir()) for p in entries), 'regular-complete-failed-quote-evidence')
    actual = {str(p.relative_to(directory)): p for p in entries if p.is_file() and p.name not in {'manifest.json', 'result.private.json'}}
    need(set(actual) == set(values) and all(L.file_hash(p) == values[n] for n, p in actual.items()), 'all-failed-quote-evidence-byte-seals')
    result = read(directory / 'result.private.json')
    need(sha(enc(result)) == FAILED_QUOTE_RESULT_SHA256 and result.get('success') is False
         and result.get('phase') == 'deploy-internal-quote' and result.get('base') == BASE
         and result.get('target') == TARGET and result.get('tree') == TREE
         and result.get('manifestSHA256') == FAILED_QUOTE_MANIFEST_SHA256
         and result.get('stage') == 'same-container-only-single-start-changed'
         and result.get('utc') == QUOTE_FAILED_UNTIL and result.get('noAutomaticRecoveryOrRepeat') is True,
         'fixed-actual-failed-quote-result-and-only-expected-guard')
    return directory


def finalize_internal_quote():
    need(PREPARED_SHA256 == FIXED_PREPARED_SHA256, 'only-original-successful-v4-prepare')
    value = prepared()
    failed = failed_quote_evidence()
    host_files(value['hostFiles'])
    before = runtime()
    private(OUT / 'finalize-runtime-before.private.json', before)
    environment = env_files()
    private(OUT / 'finalize-env-before.private.json', environment)
    need(len(before) == len(value['runtime']) == 46 and set(before) == set(value['runtime']), 'same-forty-six-original-containers')
    row = service(before, 'internal-quote')
    contract = value['services']['internal-quote']
    need(row[0] == contract['container'] and row[1]['image'] == contract['oldImage'], 'same-original-quote-container-and-image')
    now = datetime.datetime.now(datetime.timezone.utc).isoformat()
    single_start_runtime(value['runtime'][row[0]], row[1], QUOTE_EVENT_SINCE, QUOTE_FAILED_UNTIL, 2)
    need(all(before[c] == value['runtime'][c] for c in before if c != row[0]), 'all-forty-five-other-original-containers-exact')
    need(environment == value['envFiles'], 'all-original-env-files-exact-before-finalize')
    events, operation_proof = single_start_events(row[0], QUOTE_EVENT_SINCE, now, QUOTE_FAILED_UNTIL,
            row[1]['started'], failed, read(failed / 'manifest.json'))
    old_dir, after_dir = failed / 'cold-before', failed / 'cold-after-start'
    old, after = read(old_dir / 'capture.private.json'), read(after_dir / 'capture.private.json')
    compare_capture('internal-quote', old, after, old_dir, after_dir)
    current, _ = storage('internal-quote', row, 'current-before-finalize', False)
    need(current == after, 'all-current-data-auth-schema-storage-exact-sealed-after-start')
    proof = source('internal-quote', row, TARGET)
    expected = copy.deepcopy(contract['baseProof'])
    for relative, code in contract['code'].items(): expected[relative]['sha256'] = code['sha256']
    need(proof == expected, 'all-finalize-live-code-owner-mode-and-startup-source-exact')
    candidate = json.loads(run(['docker', 'image', 'inspect', contract['candidateImage']]))[0]
    base = json.loads(run(['docker', 'image', 'inspect', contract['oldImage']]))[0]
    keys = ('Cmd', 'Entrypoint', 'Env', 'User', 'WorkingDir', 'Healthcheck', 'ExposedPorts', 'Labels', 'Volumes', 'StopSignal')
    need(candidate['Id'] == contract['candidateImage'] and base['Id'] == contract['oldImage']
         and all(candidate['Config'].get(k) == base['Config'].get(k) for k in keys)
         and candidate['RootFS']['Layers'][:len(base['RootFS']['Layers'])] == base['RootFS']['Layers'],
         'sealed-existing-candidate-still-inherits-original-runtime')
    alias = 'rr-portal-internal-quote:latest'
    need(json.loads(run(['docker', 'image', 'inspect', alias]))[0]['Id'] == contract['oldImage'], 'quote-alias-not-yet-promoted')
    gate = ROOT / 'deploy/maintenance/services/internal-quote'
    gate_proof = current_gate_record(gate)
    private(OUT / 'current-gate-before-finalize.private.json', {'currentGate': gate_proof,
            'originalV4GateInodeWasNotPersisted': True, 'onlyCurrentInodeCASClaimed': True})
    private(OUT / 'still-maintained-entry-proof.private.json', entry_probe('internal-quote', True))
    # Every evidence, data, source, event, runtime and ownership check precedes
    # the only promotion and removal. Never stop, start, copy or replay deploy.
    need(runtime() == before and env_files() == environment, 'finalize-runtime-and-env-still-exact-before-mutation')
    host_files(value['hostFiles'])
    need(current_gate_record(gate) == gate_proof, 'same-current-sealed-gate-before-promotion')
    same_operation_proof(operation_proof)
    operation(['docker', 'tag', contract['candidateImage'], alias], 'finalize-promote-existing-reviewed-candidate')
    need(json.loads(run(['docker', 'image', 'inspect', alias]))[0]['Id'] == contract['candidateImage'], 'finalize-canonical-tag-exact')
    need(runtime() == before and env_files() == environment and current_gate_record(gate) == gate_proof,
         'same-current-sealed-gate-runtime-env-before-clear')
    same_operation_proof(operation_proof)
    gate.unlink()
    private(OUT / 'restored-entry-proof.private.json', entry_probe('internal-quote'))
    return {'service': 'internal-quote', 'sameContainer': row[0], 'liveImage': contract['oldImage'],
            'durableImage': contract['candidateImage'], 'allOtherContainersAndEnvExact': True,
            'allBusinessAuthRowsAndSchemaPreserved': True, 'allowedSequenceEffect': 'quoteCount*departmentCount',
            'originalFailedDeployManifestSHA256': FAILED_QUOTE_MANIFEST_SHA256,
            'originalFailedDeployResultSHA256': FAILED_QUOTE_RESULT_SHA256,
            'sameSingleManualStartConfirmed': events, 'originalV4GateInodeWasNotPersisted': True,
            'onlyCurrentGateInodeCASClaimed': True, 'lifecycleAndCodeCopyReplayed': False}

def healthy(cid):
    deadline = time.monotonic() + 180
    while time.monotonic() < deadline:
        row = json.loads(run(['docker', 'inspect', cid]))[0]
        if row['State']['Running'] and not row['State']['OOMKilled'] and row['State'].get('Health', {}).get('Status') == 'healthy':
            return
        time.sleep(3)
    need(False, 'same-container-healthy-timeout')


def deploy(name):
    need(name == 'paiji', 'only-not-yet-deployed-paiji-may-enter-lifecycle')
    event_since = datetime.datetime.now(datetime.timezone.utc).isoformat()
    private(OUT / 'single-start-window.private.json', {'since': event_since})
    value = prepared()
    host_files(value['hostFiles'])
    before, environment = runtime(), env_files()
    quote_storage_guard(before)
    quote_guard(service(before, 'db')[0])
    row = service(before, name)
    contract = value['services'][name]
    need(row[0] == contract['container'] and row[1]['image'] == contract['oldImage']
         and all(row[1][k] == value['runtime'][row[0]][k] for k in ('config', 'hostConfig', 'mounts')), 'same-original-container-config-image')
    source(name, row, BASE)
    entry_probe(name)
    gate = ROOT / 'deploy/maintenance/services' / name
    need(gate.parent.is_dir() and not gate.parent.is_symlink() and not gate.exists(), 'owned-new-single-service-gate')
    fd = os.open(gate, os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_NOFOLLOW, 0o644)
    os.close(fd)
    gate_stat = gate.stat()
    gated = entry_probe(name, True)
    private(OUT / 'live-maintenance-entry-proof.private.json', gated)
    time.sleep(60)
    operation(['docker', 'stop', '--time', '30', row[0]], name + '-stop', 90)
    stopped = json.loads(run(['docker', 'inspect', row[0]]))[0]
    need(not stopped['State']['Running'], 'exact-original-writer-stopped')
    cold, cold_dir = storage(name, row, 'cold-before', True)
    if name == 'paiji':
        rehearse_paiji(cold, cold_dir, row[1]['image'])
    for relative, destination in CODE[name].items():
        code = contract['code'][relative]
        file = ARCHIVE_ROOT / 'prepare' / (name + '-build') / code['contextName']
        need(L.file_hash(file) == code['sha256'], 'exact-reviewed-copy-bytes')
        uid, gid, mode = code['metadata'].split(':')
        # Preserve the original file's owner and mode for docker cp --archive.
        owned = OUT / ('copy-' + code['contextName'])
        shutil.copyfile(file, owned)
        os.chmod(owned, int(mode, 8))
        os.chown(owned, int(uid), int(gid))
        operation(['docker', 'cp', '--archive', str(owned), row[0] + ':' + destination], 'copy-' + code['contextName'])
    operation(['docker', 'start', row[0]], name + '-start', 90)
    healthy(row[0])
    proof = source(name, row, TARGET)
    expected = copy.deepcopy(contract['baseProof'])
    for relative, code in contract['code'].items():
        expected[relative]['sha256'] = code['sha256']
    need(proof == expected, 'all-live-code-owner-mode-and-startup-source-exact')
    after, after_dir = storage(name, row, 'cold-after-start', False)
    compare_capture(name, cold, after, cold_dir, after_dir)
    current = runtime()
    need(set(current) == set(before) and all(current[c] == before[c] for c in before if c != row[0]), 'every-other-container-exact')
    old, new = before[row[0]], current[row[0]]
    event_until = datetime.datetime.now(datetime.timezone.utc).isoformat()
    single_start_runtime(old, new, event_since, event_until, 1)
    event_proof, operation_proof = single_start_events(row[0], event_since, event_until,
            started=new['started'], operation_directory=OUT)
    need(env_files() == environment == value['envFiles'], 'all-env-files-remain-exact')
    host_files(value['hostFiles'])
    same_operation_proof(operation_proof)
    need(runtime() == current and env_files() == environment, 'paiji-no-later-runtime-or-env-change-before-promotion')
    operation(['docker', 'tag', contract['candidateImage'], 'rr-portal-' + name + ':latest'], 'promote-durable-canonical-image')
    need(json.loads(run(['docker', 'image', 'inspect', 'rr-portal-' + name + ':latest']))[0]['Id'] == contract['candidateImage'], 'canonical-tag-pinned-to-reviewed-candidate')
    need((gate.stat().st_dev, gate.stat().st_ino) == (gate_stat.st_dev, gate_stat.st_ino), 'same-owned-maintenance-inode')
    same_operation_proof(operation_proof)
    need(runtime() == current and env_files() == environment, 'paiji-no-later-runtime-or-env-change-before-clear')
    gate.unlink()
    private(OUT / 'restored-entry-proof.private.json', entry_probe(name))
    return {'service': name, 'sameContainer': row[0], 'liveImage': row[1]['image'], 'durableImage': contract['candidateImage'],
            'allOtherContainersAndEnvExact': True, 'allBusinessAuthRowsAndSchemaPreserved': True,
            'allowedSequenceEffect': 'quoteCount*departmentCount' if name == 'internal-quote' else 'machines+108',
            'paijiMemoryOnlyPasswordChangesCannotSurviveAnExistingRestart': name == 'paiji',
            'sameSingleManualStartConfirmed': event_proof}


def verify():
    value = prepared()
    host_files(value['hostFiles'])
    before = runtime()
    expected_seals = {'internal-quote': QUOTE_DEPLOY_SHA256, 'paiji': PAIJI_DEPLOY_SHA256}
    for name in APPS:
        sealed_deployment(name, expected_seals[name])
        row = service(before, name)
        need(row[0] == value['services'][name]['container'] and row[1]['image'] == value['services'][name]['oldImage']
             and row[1]['running'] and row[1]['health'] == 'healthy' and not row[1]['oom'], 'same-final-healthy-original-container')
        source(name, row, TARGET)
        entry_probe(name)
        need(not (ROOT / 'deploy/maintenance/services' / name).exists(), 'single-service-gate-cleared')
        need(json.loads(run(['docker', 'image', 'inspect', 'rr-portal-' + name + ':latest']))[0]['Id'] == value['services'][name]['candidateImage'], 'durable-canonical-image-retained')
    need(env_files() == value['envFiles'], 'final-env-exact')
    target_ids = {service(before, name)[0] for name in APPS}
    need(set(before) == set(value['runtime']) and all(before[c] == value['runtime'][c] for c in before if c not in target_ids)
         and runtime() == before, 'final-every-other-original-container-exact')
    return {'bothSourceOverlaysAndDurableTagsVerified': True, 'verificationReadOnly': True,
            'runtimeProcessMemoryPasswordsWereNotCapturedOrModified': True}


def main():
    global OUT
    need(EXECUTE is True and TARGET == EXPECTED_TARGET and TREE == EXPECTED_TREE
         and INSPECTION_SHA256 == EXPECTED_INSPECTION and PREPARED_SHA256 == FIXED_PREPARED_SHA256
         and PHASE in {'finalize-internal-quote', 'deploy-paiji', 'verify'}
         and sys.argv[1:] == [PHASE] and os.environ.get('RELEASE_BRANCH') == BRANCH
         and os.environ.get('RELEASE_MODE') == PHASE and os.environ.get('RELEASE_ATTEMPT') == '1', 'inert-exact-first-phase')
    os.umask(0o077)
    initialize()
    need(ARCHIVE_ROOT.parent.is_dir() and not ARCHIVE_ROOT.parent.is_symlink(), 'existing-private-backup-parent')
    ARCHIVE_ROOT.mkdir(mode=0o700, exist_ok=True)
    need(not ARCHIVE_ROOT.is_symlink() and stat.S_IMODE(ARCHIVE_ROOT.stat().st_mode) == 0o700, 'private-batch-parent')
    OUT = ARCHIVE_ROOT / ('finalize-internal-quote-v7' if PHASE == 'finalize-internal-quote' else PHASE)
    need(not OUT.exists() and not OUT.is_symlink(), 'single-phase-reservation')
    OUT.mkdir(mode=0o700)
    result = {'phase': PHASE, 'base': BASE, 'target': TARGET, 'tree': TREE, 'success': False}
    try:
        host_guard()
        result.update(finalize_internal_quote() if PHASE == 'finalize-internal-quote' else verify() if PHASE == 'verify' else deploy('paiji'))
        result['success'] = True
    except Exception as error:
        result.update(errorType=type(error).__name__, stage=STAGE, noAutomaticRecoveryOrRepeat=True)
    result['utc'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    private(OUT / 'manifest.json', manifest(OUT))
    result['manifestSHA256'] = L.file_hash(OUT / 'manifest.json')
    private(OUT / 'result.private.json', result)
    result['resultSHA256'] = sha(enc(result))
    print(json.dumps(result, sort_keys=True), flush=True)
    return 0 if result['success'] else 1


if __name__ == '__main__':
    sys.exit(main())
