"""Inert, one-shot exporter-only Paiji release; no host checkout or shared edits.

Only the original Paiji container is stopped/started once. Evidence is never
restored, failures never replay lifecycle, and only its own service gate clears.
"""
import contextlib, copy, datetime, hashlib, importlib.util, io, json, os, pathlib, re
import shutil, sqlite3, stat, subprocess, sys, tarfile, time, urllib.error, urllib.request

EXECUTE = True
TARGET = 'cd0118ff0ed5f2eeed8bec039e346ae7e0466df7'
TREE = 'af334ea27a30dfaa2640019a8c17ed57f58640be'
PHASE = 'verify'
PREPARED_SHA256 = 'd244e0dbe727fafa3eb91d85cb9983f5efe4691e71e397a84e47b3660108b225'
DEPLOY_SHA256 = '32e1fc79c9c5d602c7bc4cab994d7783b7155319d6e9bd3cbf34e71a43d7b923'
BASE = '09b09cbf21b2dfb8518c58860fa33237d2123ed5'
HEAD = '0f14aaf6bce77b7c144ff2dd4587d57f55fedca8'
EXPECTED_TARGET = 'cd0118ff0ed5f2eeed8bec039e346ae7e0466df7'
EXPECTED_TREE = 'af334ea27a30dfaa2640019a8c17ed57f58640be'
APP_TREE = '53df629ae2aa1d5ffc87b35dda9f4584f82c98d7'
HOST_BASE = '4b3d8f3e319e41dcc8720d759e1af0726a2b2381'
LIVE_IMAGE = 'sha256:c5de9315a5aacf08b0ee6f94935624061977f816144d9f374b50f01f1a8f2a1f'
DURABLE_BASE = 'sha256:9300a35e6ebc9b169da188965dbd1bd08d18a34dcb39cd0c5accfa5484d600d3'
OLD_CODE_SHA256 = '6303ee79f45c017378672859a500930b17de7bff2e99684e471de6e838f0b490'
APP = 'apps/生产部/注塑啤机排产系统'
EXPORTER = 'server/services/excelExporter.js'
TEST = 'server/tests/scheduleExcelExport.test.js'
DESTINATION = '/app/services/excelExporter.js'
STARTUP = {'server/package-lock.json': '/app/package-lock.json', 'server/app.js': '/app/app.js',
           'server/db/init.js': '/app/db/init.js', 'server/db/connection.js': '/app/db/connection.js',
           'server/routes/auth.js': '/app/routes/auth.js', 'server/routes/export.js': '/app/routes/export.js'}
ROOT = pathlib.Path('/opt/rr-portal')
ARCHIVE_ROOT = ROOT / 'deploy/backups/pr1024-paiji-20261028'
BRANCH = 'refs/heads/ops/pr-1024-20261028-paiji'
ALIAS = 'rr-portal-paiji:latest'
GATE = ROOT / 'deploy/maintenance/services/paiji'
DEPS = {'release-data-ops-library.py': 'ff9138a1d5bfed1b10077112da6ebcda2d65240f583e2d0e12ce1325cfbaafd5',
        'release-data-library.py': 'd63168fd3057f4f2aba2d93f9fab31d2d65c6dd0f3234877d71fcff1e04e62b9'}
OUT = None
L = None
O = None
STAGE = 'entry'

def need(value, label):
    global STAGE
    if not value:
        STAGE = label
        raise RuntimeError('PAIJI_1024_RELEASE_REJECTED')


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


def manifest(directory):
    entries = sorted(directory.rglob('*'))
    need(len(entries) <= 100000 and all(not p.is_symlink() and (p.is_file() or p.is_dir()) for p in entries), 'regular-bounded-evidence-tree')
    return {str(p.relative_to(directory)): L.file_hash(p) for p in entries if p.is_file()}


def utc_ns(value):
    need(type(value) is str and len(value) <= 40, 'bounded-utc-time')
    match = re.fullmatch(r'(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?(?:Z|\+00:00)', value)
    need(match is not None, 'explicit-nanosecond-utc-time')
    parsed = datetime.datetime.fromisoformat(match[1] + '+00:00')
    delta = parsed - datetime.datetime(1970, 1, 1, tzinfo=datetime.timezone.utc)
    return (delta.days * 86400 + delta.seconds) * 1000000000 + int((match[2] or '').ljust(9, '0'))


def bind_source_type_record(value):
    kinds = ((stat.S_ISREG, 'REG'), (stat.S_ISDIR, 'DIR'), (stat.S_ISSOCK, 'SOCK'),
             (stat.S_ISFIFO, 'FIFO'), (stat.S_ISCHR, 'CHR'), (stat.S_ISBLK, 'BLK'), (stat.S_ISLNK, 'LNK'))
    kind = next((name for test, name in kinds if test(value.st_mode)), None)
    need(kind is not None, 'bind-source-unsupported-file-type')
    result = {'type': kind, 'uid': value.st_uid, 'gid': value.st_gid, 'mode': stat.S_IMODE(value.st_mode)}
    if kind in {'CHR', 'BLK'}:
        result.update(deviceMajor=os.major(value.st_rdev), deviceMinor=os.minor(value.st_rdev))
    return result


def bind_stat_signature(value):
    return (value.st_dev, value.st_ino, value.st_uid, value.st_gid, value.st_mode, value.st_rdev)


def bind_source_metadata(path):
    # Inspect object metadata only. Sockets/FIFOs/devices are never opened;
    # symlink text and the resolved target metadata are retained privately.
    try:
        before = path.lstat()
    except FileNotFoundError:
        need(False, 'bind-source-missing')
    except OSError:
        need(False, 'bind-source-metadata-unavailable')
    result = bind_source_type_record(before)
    if result['type'] == 'LNK':
        try:
            text = os.readlink(path)
            raw = os.fsencode(text)
            need(0 < len(raw) <= 4096, 'bounded-bind-symlink-text')
            resolved = path.resolve(strict=True)
            target_before = resolved.lstat()
        except FileNotFoundError:
            need(False, 'bind-source-symlink-target-missing')
        except (OSError, RuntimeError):
            need(False, 'bind-source-symlink-resolution-unavailable')
        target = bind_source_type_record(target_before)
        need(target['type'] != 'LNK', 'bind-source-resolved-target-is-not-a-link')
        result.update(linkText=text, linkBytes=len(raw), linkTextSHA256=sha(raw),
                      resolvedPath=str(resolved), resolvedTarget=target)
        try:
            need(os.readlink(path) == text and bind_stat_signature(resolved.lstat()) == bind_stat_signature(target_before),
                 'stable-bind-symlink-text-and-resolved-target')
        except OSError:
            need(False, 'bind-source-symlink-changed-during-read')
    try:
        after = path.lstat()
    except OSError:
        need(False, 'bind-source-changed-during-metadata-read')
    need(bind_stat_signature(after) == bind_stat_signature(before), 'stable-bind-source-object-during-metadata-read')
    # No persistent inode comparison here: the reviewed Git fast-forward may
    # replace shared config host paths. Their live mounted FDs have own seals.
    return result


def actual_auth_source_record(records):
    nginx = service(records, 'nginx')
    found = [mount for mount in nginx[1]['mounts']
             if mount.get('Destination') == '/etc/nginx/.htpasswd']
    need(len(found) == 1 and found[0].get('Type') == 'bind' and found[0].get('RW') is False,
         'one-actual-readonly-gateway-auth-bind')
    path = pathlib.Path(found[0]['Source'])
    need(path.is_absolute() and '..' not in path.parts and len(os.fsencode(path)) <= 4096, 'bounded-absolute-actual-auth-source')
    link_metadata = bind_source_metadata(path)
    need(link_metadata['type'] in {'REG', 'LNK'}, 'actual-auth-source-must-resolve-to-regular-file')
    try:
        resolved = path.resolve(strict=True)
    except (OSError, RuntimeError):
        need(False, 'actual-auth-source-resolution-unavailable')
    need(bind_source_type_record(resolved.lstat())['type'] == 'REG', 'actual-auth-resolved-target-must-be-regular')
    record, _ = file_record(resolved)
    need(bind_source_metadata(path) == link_metadata, 'actual-auth-bind-link-metadata-still-exact-after-content-record')
    return {'sourcePath': str(path), 'sourceMetadata': link_metadata, 'resolvedPath': str(resolved), 'file': record}


def bind_source_type_summary(protected):
    result = {}
    for value in protected['allBindRootOwnerModes'].values():
        kind = value['type']
        if kind == 'LNK': kind += '->' + value['resolvedTarget']['type']
        result[kind] = result.get(kind, 0) + 1
    return result


def file_record(path):
    need(path.is_file() and not path.is_symlink() and path.stat().st_size <= 8 * 1024 ** 2, 'bounded-regular-host-file')
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        before = os.fstat(fd); chunks = []
        while True:
            chunk = os.read(fd, 1024 ** 2)
            if not chunk: break
            chunks.append(chunk); need(sum(map(len, chunks)) <= 8 * 1024 ** 2, 'bounded-host-read')
        raw = b''.join(chunks); after = os.fstat(fd)
        keys = lambda s: (s.st_dev, s.st_ino, s.st_uid, s.st_gid, s.st_mode, s.st_size, s.st_mtime_ns, s.st_ctime_ns)
        need(keys(before) == keys(after) == keys(path.stat()) and len(raw) == before.st_size, 'stable-host-file-read')
        return dict(metadata(path), sha256=sha(raw)), raw
    finally:
        os.close(fd)


def protected_inventory(records):
    envs = {}
    for parent, directories, files in os.walk(ROOT):
        directories[:] = [n for n in directories if n not in {'.git', 'node_modules', 'backups'}]
        for name in files:
            if name == '.env' or name.startswith('.env.'):
                path = pathlib.Path(parent) / name
                envs[str(path.relative_to(ROOT))] = file_record(path)[0]
    need('.env.cloud.production' in envs and len(envs) <= 1000, 'bounded-all-env-files')
    mounts = {}
    for row in records.values():
        for mount in row['mounts']:
            if mount['Type'] == 'bind':
                path = pathlib.Path(mount['Source'])
                record = bind_source_metadata(path)
                need(str(path) not in mounts or mounts[str(path)] == record, 'consistent-repeated-bind-source-metadata')
                mounts[str(path)] = record
    auth = actual_auth_source_record(records)
    return {'envFiles': envs, 'allBindRootOwnerModes': mounts, 'htpasswd': auth,
            'maintenance': maintenance_inventory()}


def maintenance_inventory():
    parent = ROOT / 'deploy/maintenance'
    need(parent.is_dir() and not parent.is_symlink(), 'existing-maintenance-directory')
    values = {}
    for path in [parent, *sorted(parent.rglob('*'))]:
        relative = str(path.relative_to(parent))
        values[relative] = dict(metadata(path), directory=path.is_dir())
        if path.is_file(): values[relative]['sha256'] = sha(path.read_bytes())
    need(len(values) < 1000, 'bounded-maintenance-inventory')
    return values


def git(*args):
    return run(['git', *args])


def operation(args, label, data=None, timeout=300):
    # One attempt only. Persist exact command output and command-time bounds.
    began = time.time_ns(); result = None
    try:
        with (OUT / (label + '.private.log')).open('xb') as stream:
            result = subprocess.run(args, input=data, stdout=stream, stderr=subprocess.STDOUT, cwd=ROOT, timeout=timeout)
    finally:
        ended = time.time_ns()
        record = {'beganNs': began, 'endedNs': ended, 'returncode': None if result is None else result.returncode,
                  'outputSHA256': L.file_hash(OUT / (label + '.private.log'))}
        private(OUT / (label + '.operation.private.json'), record)
    need(result is not None and result.returncode == 0, 'single-operation-' + label)
    return record


def host_files():
    shared = ['docker-compose.cloud.yml', 'frontend/index.cloud.html', 'nginx/nginx.cloud.conf',
              'deploy/update-server.sh', 'deploy/service-maintenance.sh']
    dirty = [n for n in git('diff', '--name-only', '-z').decode().split(chr(0)) if n]
    need(len(dirty) == len(set(dirty)) == 4, 'same-four-original-host-dirty-paths')
    git('diff', '--cached', '--quiet')
    result = {}
    for name in sorted(set(shared + dirty + ['.env.cloud.production'])):
        need(L.safe_path(name), 'safe-fixed-host-file')
        value, body = file_record(ROOT / name)
        if name in shared: need(body == git('show', HOST_BASE + ':' + name), 'all-five-shared-files-at-host-base')
        result[name] = value
    return result


def source_check():
    git('fetch', '--no-write-fetch-head', 'origin', '+refs/heads/main:refs/remotes/origin/main')
    need(git('rev-parse', 'refs/remotes/origin/main').decode().strip() == TARGET, 'current-main-is-fixed-reviewed-target')
    need(TARGET == EXPECTED_TARGET and TREE == EXPECTED_TREE and git('rev-parse', 'HEAD').decode().strip() == HOST_BASE,
         'explicit-deferred-host-head-and-fixed-target')
    need(git('rev-parse', TARGET + '^{tree}').decode().strip() == TREE
         and git('rev-parse', TARGET + ':' + APP).decode().strip() == APP_TREE
         and git('rev-parse', HEAD + '^{tree}').decode().strip() == TREE, 'reviewed-merged-tree-and-app-tree')
    names = {v.decode() for v in git('diff', '--name-only', '-z', BASE, TARGET).split(bytes([0])) if v}
    need(names == {APP + '/' + EXPORTER, APP + '/' + TEST}, 'exact-two-reviewed-paths')
    need(sha(git('show', BASE + ':' + APP + '/' + EXPORTER)) == OLD_CODE_SHA256, 'known-current-exporter-base')
    for relative in STARTUP:
        need(git('show', BASE + ':' + APP + '/' + relative) == git('show', TARGET + ':' + APP + '/' + relative),
             'all-startup-and-readonly-export-route-unchanged')


def source(row, revision):
    values = {}
    for relative, destination in {EXPORTER: DESTINATION, **STARTUP}.items():
        kind = run(['docker', 'exec', '--user', '0', row[0], 'stat', '-c', '%F:%h', destination]).decode().strip()
        resolved = run(['docker', 'exec', '--user', '0', row[0], 'readlink', '-f', destination]).decode().strip()
        need(kind == 'regular file:1' and resolved == destination, 'fixed-regular-unlinked-source-path')
        body = run(['docker', 'exec', '--user', '0', row[0], 'cat', destination])
        need(body == git('show', revision + ':' + APP + '/' + relative), 'exact-actual-runtime-source')
        owner = run(['docker', 'exec', '--user', '0', row[0], 'stat', '-c', '%u:%g:%a', destination]).decode().strip()
        need(re.fullmatch('[0-9]+:[0-9]+:[0-7]{3,4}', owner) is not None, 'typed-runtime-owner-mode')
        if relative == EXPORTER: need(owner == '0:0:644', 'exporter-root-owner-mode-before-and-after')
        values[relative] = {'sha256': sha(body), 'metadata': owner}
    return values


def persistent_roots(row):
    mounts = row[1]['mounts']; env = row[1]['config']['Env']; environment = dict(v.split('=', 1) for v in env)
    need(len(environment) == len(env) and environment.get('DATA_PATH') == '/app/data', 'actual-paiji-data-path')
    expected = {'/app/data': ROOT / APP / 'data', '/app/uploads': ROOT / APP / 'uploads'}
    need(len(mounts) == len(expected), 'only-two-original-paiji-binds')
    for destination, path in expected.items():
        found = [m for m in mounts if m['Destination'] == destination]
        need(len(found) == 1 and found[0]['Type'] == 'bind' and found[0]['Source'] == str(path)
             and found[0]['RW'] is True, 'fixed-original-paiji-storage-bind')
    return expected


def storage(row, label, raw=False):
    directory = OUT / label; directory.mkdir(mode=0o700); result = {'roots': {}}
    for index, (destination, tree) in enumerate(sorted(persistent_roots(row).items())):
        part = directory / str(index); part.mkdir(mode=0o700); copies = part / 'sqlite'; copies.mkdir(mode=0o700)
        names = O.database_names(tree); databases = L.snapshots(tree, copies)
        files = L.non_database_inventory(tree, names, part / 'files.tar')
        physical = set(names) | {n + s for n in names for s in ('-wal', '-shm', '-journal')}
        owners = {'.': metadata(tree), **{str(p.relative_to(tree)): metadata(p) for p in sorted(tree.rglob('*'))
                                        if str(p.relative_to(tree)) not in physical}}
        result['roots'][destination] = {'sqlite': databases, 'files': files, 'ownership': owners,
                                       'databaseMetadata': {n: metadata(tree / n) for n in names}, 'index': index}
        if raw: L.non_database_inventory(tree, [], part / 'raw-tree.tar')
    need(sum(len(r['sqlite']) for r in result['roots'].values()) == 3
         and 'paiji.db' in result['roots']['/app/data']['sqlite'], 'all-three-actual-sqlite-databases')
    private(directory / 'capture.private.json', result)
    return result, directory


def compare_capture(before, after, old_dir, new_dir):
    a, b = copy.deepcopy(before), copy.deepcopy(after)
    old, new = a['roots']['/app/data'], b['roots']['/app/data']
    sqlite_restart_compare(old['sqlite']['paiji.db'], new['sqlite']['paiji.db'],
                           old_dir / str(old['index']) / 'sqlite/paiji.db', new_dir / str(new['index']) / 'sqlite/paiji.db')
    old['sqlite']['paiji.db']['tables'].pop('sqlite_sequence'); new['sqlite']['paiji.db']['tables'].pop('sqlite_sequence')
    need(a == b, 'all-three-databases-full-business-auth-schema-and-files-exact')


def image_id(name):
    values = json.loads(run(['docker', 'image', 'inspect', name]))
    need(len(values) == 1 and re.fullmatch('sha256:[a-f0-9]{64}', values[0]['Id']), 'one-local-immutable-image')
    return values[0]['Id']


def readback(cid, expected):
    raw = run(['docker', 'cp', cid + ':' + DESTINATION, '-'])
    with tarfile.open(fileobj=io.BytesIO(raw), mode='r:') as archive:
        rows = archive.getmembers()
        need(len(rows) == 1 and rows[0].isreg() and rows[0].name == 'excelExporter.js'
             and rows[0].uid == rows[0].gid == 0 and rows[0].mode == 0o644, 'stopped-copy-exact-single-root-owned-file')
        need(archive.extractfile(rows[0]).read() == expected, 'stopped-copy-exact-exporter-bytes')
    return {'sha256': sha(expected), 'uid': 0, 'gid': 0, 'mode': 0o644, 'tarSHA256': sha(raw)}


def exporter_tar(body):
    result = io.BytesIO()
    with tarfile.open(fileobj=result, mode='w', format=tarfile.USTAR_FORMAT) as archive:
        member = tarfile.TarInfo('excelExporter.js'); member.size = len(body); member.uid = member.gid = 0; member.mode = 0o644
        archive.addfile(member, io.BytesIO(body))
    return result.getvalue()


def copy_exporter(cid, body, label):
    # No -a: Moby copyUIDGID=true would apply Config.User rather than these tar IDs.
    operation(['docker', 'cp', '-', cid + ':/app/services/'], label, exporter_tar(body))
    proof = readback(cid, body); private(OUT / (label + '-readback.private.json'), proof); return proof


def isolated_run(image, label, arguments, mounts=(), before_start=None):
    name = 'rr-pr1024-' + PHASE + '-' + label
    operation(['docker', 'create', '--name', name, '--network', 'none', '--user', '0', *mounts,
               '--entrypoint', 'node', image, *arguments], label + '-create')
    record = json.loads(run(['docker', 'inspect', name]))[0]
    need(record['State']['Status'] == 'created' and record['Image'] == image
         and record['HostConfig']['NetworkMode'] == 'none', 'never-started-owned-isolated-probe')
    if before_start: before_start(record['Id'])
    operation(['docker', 'start', '-a', name], label + '-run', timeout=300)
    final = json.loads(run(['docker', 'inspect', name]))[0]
    need(final['Id'] == record['Id'] and final['State']['Status'] == 'exited'
         and final['State']['ExitCode'] == 0, 'isolated-probe-exited-successfully')
    operation(['docker', 'rm', name], label + '-remove')


def rehearse(capture, directory, image, label):
    # Copy all three DBs, never any live storage or credentials, to this isolated init probe.
    mounts = []
    for destination, root in capture['roots'].items():
        scratch = OUT / (label + '-' + str(root['index'])); scratch.mkdir(mode=0o700)
        original = directory / str(root['index']) / 'sqlite'
        for name in root['sqlite']:
            target = scratch / name; target.parent.mkdir(mode=0o700, parents=True, exist_ok=True); shutil.copy2(original / name, target)
        mounts += ['--mount', 'type=bind,source=' + str(scratch) + ',target=' + destination]
    isolated_run(image, label, ['-e', "require('/app/db/init').initDatabase();require('/app/db/connection').close();"], mounts)
    for destination, root in capture['roots'].items():
        scratch = OUT / (label + '-' + str(root['index'])); after = L.snapshots(scratch)
        old = copy.deepcopy(root['sqlite']); new = copy.deepcopy(after)
        if destination == '/app/data':
            original = directory / str(root['index']) / 'sqlite/paiji.db'
            sqlite_restart_compare(old['paiji.db'], new['paiji.db'], original, scratch / 'paiji.db')
            old['paiji.db']['tables'].pop('sqlite_sequence'); new['paiji.db']['tables'].pop('sqlite_sequence')
        need(old == new, 'isolated-init-preserves-all-three-db-content-except-known-sequence')


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, response, code, message, headers, newurl): return None


def public_probe(maintained=False):
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect()); values = {}
    for path, expected in {'/': {200, 401}, '/paiji/health': {503 if maintained else 200},
                           '/paiji/api/auth/verify': {503 if maintained else 401},
                           '/internal-quote/health': {200}, '/indo-shipping/api/health': {200}}.items():
        try: response = opener.open('http://127.0.0.1' + path, timeout=15)
        except urllib.error.HTTPError as error: response = error
        with response: response.read(131072); values[path] = response.status
        need(values[path] in expected, 'only-paiji-maintained-all-neighbors-available')
    return values


def gate_record():
    fd = os.open(GATE, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        value = os.fstat(fd); named = GATE.lstat()
        need(stat.S_ISREG(value.st_mode) and value.st_uid == value.st_gid == 0
             and stat.S_IMODE(value.st_mode) == 0o600 and value.st_nlink == 1 and value.st_size == 0
             and (value.st_dev, value.st_ino) == (named.st_dev, named.st_ino), 'owned-empty-private-service-gate')
        return {'device': value.st_dev, 'inode': value.st_ino, 'uid': value.st_uid, 'gid': value.st_gid,
                'mode': stat.S_IMODE(value.st_mode), 'links': value.st_nlink, 'bytes': value.st_size}
    finally: os.close(fd)


def protected(records, own_gate=False):
    value = protected_inventory(records)
    if own_gate: need(value['maintenance'].pop('services/paiji', None) is not None, 'only-owned-gate-excluded')
    return value


def exact_runtime(before, after, cid=None, start=None):
    need(set(before) == set(after), 'all-original-containers-only')
    for key in before:
        if key != cid: need(before[key] == after[key], 'all-other-containers-unchanged')
        else:
            old, new = before[key], after[key]
            need(start is not None and new['started'] != old['started'] and new['restarts'] == 0
                 and start['beganNs'] <= utc_ns(new['started']) <= start['endedNs']
                 and all(old[k] == new[k] for k in old if k not in {'started', 'restarts'})
                 and new['running'] and not new['oom'] and new['health'] == 'healthy', 'same-container-one-manual-start')


def live_export(row, capture, directory):
    root = capture['roots']['/app/data']; path = directory / str(root['index']) / 'sqlite/paiji.db'
    with contextlib.closing(L.connect(path, True)) as connection:
        found = connection.execute("SELECT s.id FROM schedules s WHERE EXISTS (SELECT 1 FROM schedule_items i WHERE i.schedule_id=s.id AND (COALESCE(i.quantity_needed,0)<=0 OR COALESCE(i.accumulated,0)<i.quantity_needed)) ORDER BY s.id DESC LIMIT 1").fetchone()
    if found is None: return {'actualNonemptyScheduleAvailable': False, 'liveReadonlyExportVerified': False, 'syntheticSixExportsVerified': True}
    need(type(found[0]) is int and found[0] > 0, 'actual-existing-private-schedule-selection')
    fetch = "const http=require('http');const id=" + str(found[0]) + ";http.get({host:'127.0.0.1',port:process.env.PORT||3000,path:'/api/export/'+id},r=>{let n=0;if(r.statusCode!==200){r.resume();process.exitCode=1;return;}r.on('data',b=>{n+=b.length;if(n>33554432)process.exit(2);process.stdout.write(b);});}).on('error',()=>process.exit(3));"
    body = run(['docker', 'exec', '--user', '0', row[0], 'node', '-e', fetch], timeout=90)
    need(body[:2] == b'PK' and len(body) <= 32 * 1024 ** 2, 'actual-process-returned-bounded-xlsx')
    private(OUT / 'actual-readonly-export.private.xlsx', body)
    check = """const X=require('exceljs');const b=[];process.stdin.on('data',x=>b.push(x));process.stdin.on('end',async()=>{try{const w=new X.Workbook();await w.xlsx.load(Buffer.concat(b));let rows=0,white=true,header=true,orange=true,red=true,oc=0,rc=0;for(const s of w.worksheets){for(let c=1;c<=25;c++)header=header&&s.getRow(3).getCell(c).fill.fgColor?.argb==='FFD9E1F2';s.eachRow((r,n)=>{if(n<4||r.height!==22||r.getCell(2).isMerged||!Number.isFinite(r.getCell(12).value))return;rows++;for(let c=1;c<=25;c++){const f=r.getCell(c).fill.fgColor?.argb;white=white&&(f==='FFFFFFFF'||(c===11&&f==='FFFFC000'));}if(Number(r.getCell(11).value)>0){oc++;orange=orange&&r.getCell(11).fill.fgColor?.argb==='FFFFC000';}if(r.getCell(19).value){rc++;red=red&&r.getCell(19).font.color?.argb==='FFFF0000'&&r.getCell(19).font.bold===true;}});}if(!rows||!white||!header||!orange||!red)process.exitCode=4;process.stdout.write(JSON.stringify({worksheets:w.worksheets.length,dataRows:rows,white,header,orange,red,orangeCells:oc,redCells:rc}));}catch{process.exitCode=5;}});"""
    result = json.loads(run(['docker', 'exec', '-i', '--user', '0', row[0], 'node', '-e', check], body, timeout=90))
    return dict(result, actualNonemptyScheduleAvailable=True, liveReadonlyExportVerified=True, xlsxSHA256=sha(body))


def seal(phase, digest):
    directory = ARCHIVE_ROOT / phase
    need(pin(digest) and L.file_hash(directory / 'manifest.json') == digest, 'exact-prior-phase-manifest')
    values = read(directory / 'manifest.json'); actual = manifest(directory)
    actual.pop('manifest.json', None); actual.pop('result.private.json', None)
    need(values == actual, 'every-prior-private-file-byte-sealed')
    result = read(directory / 'result.private.json')
    need(result.get('success') is True and result.get('phase') == phase and result.get('base') == BASE
         and result.get('head') == HEAD and result.get('target') == TARGET and result.get('tree') == TREE
         and result.get('appTree') == APP_TREE and result.get('manifestSHA256') == digest, 'successful-prior-source-bound-phase')
    return directory, result


def prepared():
    directory, _ = seal('prepare', PREPARED_SHA256)
    return read(directory / 'prepared.private.json')


def prepare():
    need(not PREPARED_SHA256 and not DEPLOY_SHA256, 'prepare-has-no-prior-slots')
    before = runtime(); row = service(before, 'paiji'); preserved = protected(before); host = host_files()
    need(row[1]['image'] == LIVE_IMAGE and row[1]['running'] and row[1]['health'] == 'healthy' and not row[1]['oom'], 'known-live-healthy-original-paiji')
    proof = source(row, BASE); persistent_roots(row); need(image_id(ALIAS) == DURABLE_BASE, 'known-durable-local-canonical-base')
    private(OUT / 'original-auth.private.backup', pathlib.Path(preserved['htpasswd']['resolvedPath']).read_bytes())
    private(OUT / 'runtime-before.private.json', before); private(OUT / 'protected-before.private.json', preserved)
    context = OUT / 'build'; context.mkdir(mode=0o700)
    code = git('show', TARGET + ':' + APP + '/' + EXPORTER); private(context / 'excelExporter.js', code); os.chmod(context / 'excelExporter.js', 0o644)
    base_tag = 'rr-portal-paiji:pr1024-base-' + TARGET[:12]
    need(not run(['docker', 'image', 'ls', '--filter', 'reference=' + base_tag, '--format', '{{.ID}}']).strip(), 'fresh-local-named-base-tag')
    operation(['docker', 'tag', DURABLE_BASE, base_tag], 'local-base-tag'); need(image_id(base_tag) == DURABLE_BASE, 'local-base-image-pinned')
    private(context / 'Dockerfile', ('FROM ' + base_tag + chr(10) + 'COPY --chown=0:0 excelExporter.js ' + DESTINATION + chr(10)).encode())
    tag = 'rr-portal-paiji:pr1024-' + TARGET[:12]
    operation(['docker', 'build', '--network=none', '--pull=false', '-t', tag, str(context)], 'candidate-build', timeout=900)
    candidate = json.loads(run(['docker', 'image', 'inspect', tag]))[0]; base = json.loads(run(['docker', 'image', 'inspect', DURABLE_BASE]))[0]
    keys = ('Cmd', 'Entrypoint', 'Env', 'User', 'WorkingDir', 'Healthcheck', 'ExposedPorts', 'Labels', 'Volumes', 'StopSignal')
    need(all(candidate['Config'].get(k) == base['Config'].get(k) for k in keys) and len(candidate['RootFS']['Layers']) == len(base['RootFS']['Layers']) + 1
         and candidate['RootFS']['Layers'][:-1] == base['RootFS']['Layers'], 'exporter-only-layer-inherits-durable-base-config')
    test = OUT / 'scheduleExcelExport.test.js'; private(test, git('show', TARGET + ':' + APP + '/' + TEST))
    isolated_run(candidate['Id'], 'six-xlsx-tests', ['--test', '/app/tests/scheduleExcelExport.test.js'],
                 ['--mount', 'type=bind,source=' + str(test) + ',target=/app/tests/scheduleExcelExport.test.js,readonly'],
                 lambda cid: copy_exporter(cid, code, 'scratch-owner-copy'))
    tap = (OUT / 'six-xlsx-tests-run.private.log').read_bytes()
    need(all(re.search(pattern, tap, re.M) is not None for pattern in (rb'^# tests 6$', rb'^# pass 6$', rb'^# fail 0$')), 'six-actual-candidate-xlsx-roundtrip-tests-passed')
    captured, directory = storage(row, 'online-baseline'); rehearse(captured, directory, candidate['Id'], 'online-init-rehearsal')
    exact_runtime(before, runtime()); need(protected(runtime()) == preserved and host_files() == host, 'prepare-preserves-all-original-runtime-config-auth')
    value = {'runtime': before, 'protected': preserved, 'hostFiles': host, 'container': row[0], 'source': proof,
             'candidateImage': candidate['Id'], 'codeSHA256': sha(code), 'durableBase': DURABLE_BASE,
             'hostBase': HOST_BASE, 'target': TARGET, 'tree': TREE}
    private(OUT / 'prepared.private.json', value)
    return {'candidateImage': candidate['Id'], 'syntheticSixExportsVerified': True, 'allOriginalRuntimeConfigAuthPreserved': True,
            'bindTypes': bind_source_type_summary(preserved)}


def deploy():
    p = prepared(); need(not DEPLOY_SHA256, 'deploy-no-prior-deployment-slot')
    before = runtime(); row = service(before, 'paiji')
    need(before == p['runtime'] and protected(before) == p['protected'] and host_files() == p['hostFiles']
         and row[0] == p['container'] and source(row, BASE) == p['source'] and image_id(ALIAS) == DURABLE_BASE, 'unchanged-prepared-live-service-config-auth-and-alias')
    need(GATE.parent.is_dir() and not GATE.parent.is_symlink() and not GATE.exists() and not GATE.is_symlink(), 'fresh-single-service-gate')
    private(GATE, b''); gate = gate_record(); private(OUT / 'owned-gate.private.json', gate)
    private(OUT / 'maintenance-entry.private.json', public_probe(True)); time.sleep(60)
    need(runtime() == before and gate_record() == gate and protected(before, True) == p['protected']
         and host_files() == p['hostFiles'], 'drained-original-runtime-config-auth-still-exact')
    stop = operation(['docker', 'stop', '--timeout', '30', row[0]], 'paiji-stop', timeout=60)
    need((OUT / 'paiji-stop.private.log').read_bytes() == (row[0] + chr(10)).encode(), 'one-stop-exact-container-id')
    stopped = json.loads(run(['docker', 'inspect', row[0]]))[0]
    need(stopped['State']['Running'] is False and not stopped['State']['OOMKilled'], 'same-original-container-fully-stopped')
    cold, old_dir = storage(row, 'cold-before', True); rehearse(cold, old_dir, p['candidateImage'], 'cold-init-rehearsal')
    code = git('show', TARGET + ':' + APP + '/' + EXPORTER); need(sha(code) == p['codeSHA256'], 'prepared-exporter-bytes-exact')
    copy_exporter(row[0], code, 'live-exporter-only-copy')
    start = operation(['docker', 'start', row[0]], 'paiji-start', timeout=60)
    need((OUT / 'paiji-start.private.log').read_bytes() == (row[0] + chr(10)).encode(), 'one-start-exact-container-id')
    current = None
    for _ in range(30):
        current = runtime()
        if service(current, 'paiji')[1]['health'] == 'healthy': break
        time.sleep(2)
    exact_runtime(before, current, row[0], start)
    need(source(service(current, 'paiji'), TARGET) == dict(p['source'], **{EXPORTER: {'sha256': p['codeSHA256'], 'metadata': '0:0:644'}}), 'all-source-bytes-owner-mode-and-startup-exact')
    after, new_dir = storage(row, 'startup-after', True); compare_capture(cold, after, old_dir, new_dir)
    actual = live_export(row, after, new_dir); private(OUT / 'actual-export-summary.private.json', actual)
    after_export, export_dir = storage(row, 'after-readonly-export'); need(after_export == after, 'actual-live-export-does-not-write-business-or-auth')
    need(host_files() == p['hostFiles'] and protected(current, True) == p['protected'] and runtime() == current
         and gate_record() == gate and image_id(ALIAS) == DURABLE_BASE, 'all-protection-and-owned-gate-before-canonical-promotion')
    operation(['docker', 'tag', p['candidateImage'], ALIAS], 'promote-durable-image')
    need(image_id(ALIAS) == p['candidateImage'] and gate_record() == gate and runtime() == current
         and host_files() == p['hostFiles'] and protected(current, True) == p['protected'], 'same-owned-gate-after-single-alias-promotion')
    GATE.unlink(); private(OUT / 'restored-entry.private.json', public_probe())
    private(OUT / 'runtime-after.private.json', current)
    return {'sameContainer': row[0], 'liveBackendImage': LIVE_IMAGE, 'durableImage': p['candidateImage'], 'actualExport': actual,
            'allThreeDatabasesBusinessAuthSchemaPreserved': True, 'allowedStartupSequence': 'machines+108',
            'configuredAuthEnvPreserved': True, 'memoryOnlyPasswordChangesNotCaptured': True,
            'noHostCheckoutSharedConfigEditOrAutomaticLifecycleReplay': True, 'singleStartWindow': start}


def verify():
    p = prepared(); _, deployed = seal('deploy', DEPLOY_SHA256)
    before = runtime(); row = service(before, 'paiji'); prior = read(ARCHIVE_ROOT / 'deploy/runtime-after.private.json')
    need(before == prior and row[0] == p['container'] and row[1]['image'] == LIVE_IMAGE, 'same-successful-deployed-runtime')
    source(row, TARGET); need(protected(before) == p['protected'] and host_files() == p['hostFiles']
         and image_id(ALIAS) == p['candidateImage'] and not GATE.exists() and not GATE.is_symlink(), 'final-source-config-auth-alias-and-clear-gate')
    # Business data may legitimately change after the gate cleared. This is not a
    # cross-user-time DB equality assertion; the GET is verified read-only in deploy.
    captured, directory = storage(row, 'current-readonly-selection'); actual = live_export(row, captured, directory)
    private(OUT / 'verified-entry.private.json', public_probe())
    need(runtime() == before and protected(before) == p['protected'] and host_files() == p['hostFiles'], 'verification-preserves-current-runtime-and-config')
    return {'verificationReadOnly': True, 'actualExport': actual, 'durableImage': p['candidateImage'],
            'businessEqualityCheckedOnlyDuringOwnMaintenance': True, 'memoryOnlyPasswordChangesNotCaptured': True}


def main():
    global OUT
    need(EXECUTE is True and PHASE in {'prepare', 'deploy', 'verify'} and sys.argv[1:] == [PHASE]
         and os.environ.get('RELEASE_BRANCH') == BRANCH and os.environ.get('RELEASE_MODE') == PHASE
         and os.environ.get('RELEASE_ATTEMPT') == '1', 'inert-exact-first-phase')
    os.umask(0o077); initialize()
    need(ARCHIVE_ROOT.parent.is_dir() and not ARCHIVE_ROOT.parent.is_symlink(), 'existing-private-backup-parent')
    ARCHIVE_ROOT.mkdir(mode=0o700, exist_ok=True)
    need(not ARCHIVE_ROOT.is_symlink() and stat.S_IMODE(ARCHIVE_ROOT.stat().st_mode) == 0o700, 'private-task-parent')
    OUT = ARCHIVE_ROOT / PHASE; need(not OUT.exists() and not OUT.is_symlink(), 'one-shot-phase-reservation'); OUT.mkdir(mode=0o700)
    result = {'phase': PHASE, 'base': BASE, 'head': HEAD, 'target': TARGET, 'tree': TREE, 'appTree': APP_TREE,
              'hostBase': HOST_BASE, 'sourceCheckoutDeferredToPendingInvoice': True, 'success': False}
    try:
        source_check(); result.update({'prepare': prepare, 'deploy': deploy, 'verify': verify}[PHASE]()); result['success'] = True
    except Exception as error:
        result.update(errorType=type(error).__name__, stage=STAGE, noAutomaticRecoveryOrRepeat=True)
    result['utc'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    private(OUT / 'manifest.json', manifest(OUT)); result['manifestSHA256'] = L.file_hash(OUT / 'manifest.json')
    if result['success'] and PHASE == 'prepare': result['preparedSHA256'] = result['manifestSHA256']
    if result['success'] and PHASE == 'deploy': result['deployEvidenceSHA256'] = result['manifestSHA256']
    private(OUT / 'result.private.json', result); result['resultSHA256'] = sha(enc(result))
    result['sha256Wire'] = {k: [int(c, 16) for c in (v.split(':', 1)[1] if v.startswith('sha256:') else v)] for k, v in result.items()
                          if type(v) is str and re.fullmatch('(?:sha256:)?[a-f0-9]{64}|[a-f0-9]{40}', v)}
    print(json.dumps(result, sort_keys=True), flush=True)
    return 0 if result['success'] else 1


if __name__ == '__main__': sys.exit(main())
