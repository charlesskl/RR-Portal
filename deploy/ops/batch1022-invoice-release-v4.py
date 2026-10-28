"""Inert, one-shot addition of the reviewed browser-only Xingxin invoice app.

Only root may bind the exact revision and prior phase seals. No existing service
is recreated, no environment or business storage is changed, and no portal-wide
maintenance switch is used. A timeout is reconciled read-only, never replayed.
"""
import copy, datetime, hashlib, io, ipaddress, json, os, pathlib, re, stat
import subprocess, sys, tarfile, time, urllib.error, urllib.parse, urllib.request

EXECUTE = True
TARGET = 'e63786d1157a29f0bbb7e8ca3e89e4c2c9163fe5'
TREE = '09d82c97bd7ee6290f0c511f372f2d1c81203a29'
PHASE = 'prepare'
PREPARED_SHA256 = ''
DEPLOY_SHA256 = ''
EXISTING_VERIFY_SHA256 = '44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a'
EXISTING_TARGET = 'daa878ce6ed661d9b84288e7869b37e9118ce5bc'
EXISTING_TREE = '05f17716f3cb93a7c3d06d2c604d5a4948fb8374'
EXISTING_ARCHIVE_PATH = '/opt/rr-portal/deploy/backups/batch-1015-1019-1022-20261028-existing-v4'
BASE = '4b3d8f3e319e41dcc8720d759e1af0726a2b2381'
APP = 'apps/业务部/兴信大陆发票系统'
APP_TREE = '6b2b403938304d323a59505d59fd9d1d25427ba6'
EXPECTED_EXISTING_TARGET = 'daa878ce6ed661d9b84288e7869b37e9118ce5bc'
EXPECTED_EXISTING_TREE = '05f17716f3cb93a7c3d06d2c604d5a4948fb8374'
BRANCH = 'refs/heads/ops/batch-1015-1019-1022-20261028'
ROOT = pathlib.Path('/opt/rr-portal')
ARCHIVE_ROOT = ROOT / 'deploy/backups/batch-1015-1019-1022-20261028-invoice-v4'
SERVICE = 'xingxin-invoice'
ALIAS = 'rr-portal-xingxin-invoice:latest'
CSP = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'self';"
SHARED = {'frontend/index.cloud.html': '/usr/share/nginx/html/index.html',
          'nginx/nginx.cloud.conf': '/etc/nginx/nginx.conf'}
CONFIG = ('docker-compose.cloud.yml', *SHARED)
OUT = None
SERIAL = 0
STAGE = 'entry'
AMBIGUOUS = False
FDS = {}
WROTE = set()


def need(value, label):
    global STAGE
    if not value:
        STAGE = label
        raise RuntimeError('INVOICE_RELEASE_REJECTED')


def enc(value):
    return json.dumps(value, ensure_ascii=True, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()


def sha(value):
    return hashlib.sha256(value).hexdigest()


def pin(value, width=64):
    return type(value) is str and re.fullmatch('[a-f0-9]{%d}' % width, value) is not None


def private(path, value):
    raw = value if type(value) is bytes else enc(value)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'wb') as stream:
        stream.write(raw); stream.flush(); os.fsync(stream.fileno())


def metadata(path):
    need(not path.is_symlink() and (path.is_file() or path.is_dir()), 'regular-file-or-directory')
    value = path.stat()
    return {'uid': value.st_uid, 'gid': value.st_gid, 'mode': stat.S_IMODE(value.st_mode)}



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


def call(args, label, timeout=180, mutating=False):
    global SERIAL, AMBIGUOUS
    SERIAL += 1
    stem = '%03d-%s' % (SERIAL, label)
    try:
        result = subprocess.run(args, cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                timeout=timeout, env=dict(os.environ, COMPOSE_BAKE='false', COMPOSE_PARALLEL_LIMIT='1'))
    except subprocess.TimeoutExpired as error:
        AMBIGUOUS = AMBIGUOUS or mutating
        private(OUT / (stem + '.stdout.private'), error.stdout or b'')
        private(OUT / (stem + '.stderr.private'), error.stderr or b'')
        need(False, 'command-timeout-' + label)
    private(OUT / (stem + '.stdout.private'), result.stdout)
    private(OUT / (stem + '.stderr.private'), result.stderr)
    need(result.returncode == 0 and len(result.stdout) <= 128 * 1024 ** 2, 'command-' + label)
    return result.stdout


def git(*args):
    return call(['git', *args], 'git-read')


def read(path):
    need(path.is_file() and not path.is_symlink(), 'regular-sealed-evidence')
    return json.loads(path.read_bytes())


def manifest(directory):
    entries = list(directory.rglob('*'))
    need(len(entries) < 100000 and all(not p.is_symlink() and (p.is_file() or p.is_dir()) for p in entries), 'bounded-regular-evidence')
    return {str(p.relative_to(directory)): sha(p.read_bytes()) for p in entries if p.is_file()
            and p.name not in {'manifest.json', 'result.private.json'}}


def sealed(directory, digest, phase, target, tree):
    need(pin(digest) and directory.is_dir() and not directory.is_symlink()
         and stat.S_IMODE(directory.stat().st_mode) == 0o700, 'sealed-private-directory')
    need(sha((directory / 'manifest.json').read_bytes()) == digest, 'exact-prior-manifest')
    need(read(directory / 'manifest.json') == manifest(directory), 'complete-prior-byte-seals')
    result = read(directory / 'result.private.json')
    if directory.parent == ARCHIVE_ROOT:
        claims = read(directory / 'phase-claims.private.json')
        need(result == dict(claims, manifestSHA256=digest), 'own-phase-result-linked-to-sealed-claims')
    need(result.get('success') is True and result.get('phase') == phase and result.get('base') == BASE
         and result.get('target') == target and result.get('tree') == tree
         and result.get('manifestSHA256') == digest, 'successful-bound-prior-phase')
    return result


def existing_gate():
    need(EXISTING_TARGET == EXPECTED_EXISTING_TARGET and EXISTING_TREE == EXPECTED_EXISTING_TREE, 'reviewed-existing-target')
    directory = pathlib.Path(EXISTING_ARCHIVE_PATH)
    need(directory.is_absolute() and '..' not in directory.parts and directory.parent == ROOT / 'deploy/backups'
         and re.fullmatch('batch-1015-1019-1022-20261028-existing(?:-v[2-9][0-9]?)?', directory.name), 'root-bound-private-existing-archive')
    result = sealed(directory / 'verify', EXISTING_VERIFY_SHA256, 'verify', EXISTING_TARGET, EXISTING_TREE)
    need(result.get('bothSourceOverlaysAndDurableTagsVerified') is True
         and result.get('verificationReadOnly') is True, 'both-existing-services-verified-first')
    git('merge-base', '--is-ancestor', EXISTING_TARGET, TARGET)


def runtime():
    ids = call(['docker', 'ps', '-aq', '--no-trunc'], 'runtime-ids').decode().split()
    need(0 < len(ids) < 1000 and len(ids) == len(set(ids)), 'bounded-unique-container-ids')
    records = json.loads(call(['docker', 'inspect', *ids], 'runtime-inspect'))
    return {row['Id']: runtime_record(row) for row in records}


def runtime_record(row):
    return {'image': row['Image'], 'config': row['Config'], 'hostConfig': row['HostConfig'],
            'mounts': sorted(row['Mounts'], key=enc), 'started': row['State']['StartedAt'],
            'running': row['State']['Running'], 'oom': row['State']['OOMKilled'],
            'restarts': row['RestartCount'], 'health': row['State'].get('Health', {}).get('Status')}


def service(records, name, absent=False):
    rows = [(cid, row) for cid, row in records.items()
            if (row['config'].get('Labels') or {}).get('com.docker.compose.project') == 'rr-portal'
            and (row['config'].get('Labels') or {}).get('com.docker.compose.service') == name]
    need(len(rows) == (0 if absent else 1), 'unique-service-' + name)
    return None if absent else rows[0]


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


def dirty_inventory(backup=False):
    raw = git('status', '--porcelain=v1', '-z', '--untracked-files=no')
    rows = raw.split(b'\0')
    need(rows[-1] == b'' and len(rows) == 5, 'same-four-original-tracked-dirty-paths')
    changed = {name.decode() for name in git('diff', '--name-only', '-z', BASE, TARGET).split(b'\0') if name}
    result = {}
    for index, entry in enumerate(rows[:-1]):
        need(len(entry) > 3 and entry[:2] in {b' M', b'M ', b'MM'}, 'only-existing-regular-modifications')
        name = entry[3:].decode()
        need(not pathlib.PurePosixPath(name).is_absolute() and '..' not in pathlib.PurePosixPath(name).parts
             and name not in changed, 'dirty-paths-outside-whole-reviewed-release')
        record, data = file_record(ROOT / name)
        result[name] = dict(record, status=entry[:2].decode())
        if backup: private(OUT / ('dirty-%02d.private' % index), data)
    staged = git('diff', '--cached', '--binary')
    if backup: private(OUT / 'original-staged-diff.private', staged)
    return {'files': result, 'stagedDiffSHA256': sha(staged)}


def compose(path, overlay=None):
    args = ['docker', 'compose', '-p', 'rr-portal', '--project-directory', str(ROOT),
            '--env-file', str(ROOT / '.env.cloud.production'), '-f', str(path)]
    return [*args, '-f', str(overlay)] if overlay else args


def semantic_compose(old, new):
    need(type(old) is dict and type(new) is dict and SERVICE not in old.get('services', {}), 'new-service-not-in-old-compose')
    remainder = copy.deepcopy(new)
    svc = remainder.get('services', {}).pop(SERVICE, None)
    need(remainder == old and type(svc) is dict, 'only-one-added-service-all-other-compose-semantics-exact')
    need(set(svc) <= {'build', 'expose', 'healthcheck', 'mem_limit', 'memswap_limit', 'restart', 'logging', 'networks'}, 'static-service-only-known-fields')
    need(svc.get('build') == {'context': str(ROOT / APP), 'dockerfile': 'Dockerfile'}
         and svc.get('expose') == ['80'] and svc.get('restart') == 'unless-stopped'
         and set(svc.get('networks', {})) == {'platform-net'}, 'reviewed-static-service-build-network')
    need(str(svc.get('mem_limit')) in {'134217728', '128m'} and str(svc.get('memswap_limit')) in {'134217728', '128m'}, 'static-memory-limits')
    need(svc.get('healthcheck', {}).get('test') == ['CMD', 'wget', '--spider', '-q', 'http://127.0.0.1/health'], 'reviewed-health-command')
    return svc


def source_guard(head):
    need(git('rev-parse', 'HEAD').decode().strip() == head, 'exact-host-source-head')
    need(git('rev-parse', TARGET + '^{tree}').decode().strip() == TREE
         and git('rev-parse', TARGET + ':' + APP).decode().strip() == APP_TREE, 'reviewed-full-tree-and-app-subtree')
    git('merge-base', '--is-ancestor', BASE, TARGET)


def source_context():
    archive = git('-c', 'tar.umask=0022', 'archive', '--format=tar', TARGET, '--', APP)
    private(OUT / 'source.private.tar', archive)
    context = OUT / 'source'; context.mkdir(mode=0o700)
    inventory = {}
    with tarfile.open(fileobj=io.BytesIO(archive)) as tf:
        for member in tf.getmembers():
            path = pathlib.PurePosixPath(member.name)
            need(not path.is_absolute() and '..' not in path.parts and (member.isdir() or member.isfile()), 'regular-reviewed-source-archive')
            destination = context.joinpath(*path.parts)
            if member.isdir(): destination.mkdir(mode=0o700, parents=True, exist_ok=True); continue
            need(member.size <= 64 * 1024 ** 2, 'bounded-source-file')
            destination.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
            data = tf.extractfile(member).read(); private(destination, data)
            need(member.mode in {0o644, 0o755}, 'only-reviewed-git-regular-file-modes')
            # Vite copies public file modes. Keep templates readable by the
            # nginx worker; the enclosing evidence/context directories stay 0700.
            os.chmod(destination, member.mode)
            need(data == git('show', TARGET + ':' + member.name), 'every-build-input-exact-git-blob')
            inventory[str(path.relative_to(APP))] = {'bytes': len(data), 'sha256': sha(data)}
    need(1 < len(inventory) <= 1000 and 'Dockerfile' in inventory and 'package-lock.json' in inventory, 'complete-static-build-context')
    private(OUT / 'source-inventory.private.json', inventory)
    return context / APP, inventory


def webroot(image_or_cid, running=False):
    args = ['docker', 'exec', image_or_cid, 'tar', '-C', '/usr/share/nginx/html', '-cf', '-', '.'] if running else [
        'docker', 'run', '--rm', '--network', 'none', '--entrypoint', 'tar', image_or_cid,
        '-C', '/usr/share/nginx/html', '-cf', '-', '.']
    raw = call(args, 'running-webroot' if running else 'candidate-webroot', mutating=not running)
    result = {}
    with tarfile.open(fileobj=io.BytesIO(raw)) as tf:
        for member in tf.getmembers():
            path = pathlib.PurePosixPath(member.name)
            need(not path.is_absolute() and '..' not in path.parts and (member.isdir() or member.isfile()), 'regular-static-webroot')
            if member.isdir(): continue
            need(member.size <= 16 * 1024 ** 2, 'bounded-static-file')
            data = tf.extractfile(member).read()
            result[str(path)] = {'bytes': len(data), 'sha256': sha(data)}
    need('index.html' in result and 1 < len(result) < 1000, 'complete-index-and-static-inventory')
    return result


def candidate_nginx_test(nginx, target_conf):
    mounts = []
    for value in nginx[1]['mounts']:
        need(value['Type'] == 'bind' and value['RW'] is False, 'gateway-only-known-readonly-binds')
        source = target_conf if value['Destination'] == '/etc/nginx/nginx.conf' else pathlib.Path(value['Source'])
        need(',' not in str(source) and ',' not in value['Destination'], 'safe-fixed-bind-arguments')
        mounts += ['--mount', 'type=bind,src=' + str(source) + ',dst=' + value['Destination'] + ',readonly']
    call(['docker', 'run', '--rm', '--network', 'none', '--entrypoint', 'nginx', *mounts,
          nginx[1]['image'], '-t'], 'candidate-gateway-syntax', mutating=True)


def candidate_http_test(image, files):
    lines = ['set -eu', 'nginx -t', 'nginx', "printf 'INVOICE_HEALTH_JSON='",
             'wget -qO- http://127.0.0.1/health', "printf '\\n'"]
    for index, (name, value) in enumerate(sorted(files.items())):
        temporary = '/tmp/invoice-static-%04d' % index
        url = 'http://127.0.0.1/' + urllib.parse.quote(name)
        lines += ["wget -qO '" + temporary + "' '" + url + "'",
                  "test \"$(wc -c < '" + temporary + "')\" = '" + str(value['bytes']) + "'",
                  "test \"$(sha256sum '" + temporary + "' | cut -d' ' -f1)\" = '" + value['sha256'] + "'"]
    lines.append('echo CANDIDATE_STATIC_OK')
    script = OUT / 'candidate-static-probe.private.sh'
    private(script, ('\n'.join(lines) + '\n').encode())
    need(',' not in str(script), 'safe-probe-bind-path')
    raw = call(['docker', 'run', '--rm', '--network', 'none', '--entrypoint', 'sh', '--mount',
                'type=bind,src=' + str(script) + ',dst=/run/invoice-static-probe.sh,readonly', image,
                '/run/invoice-static-probe.sh'], 'candidate-all-static-http', mutating=True)
    observed = raw.decode().splitlines()
    health = [line.split('=', 1)[1] for line in observed if line.startswith('INVOICE_HEALTH_JSON=')]
    need(len(health) == 1 and json.loads(health[0]) == {'status': 'ok', 'service': SERVICE}
         and observed.count('CANDIDATE_STATIC_OK') == 1, 'candidate-all-http-bytes-and-worker-permissions')


def bind_record(cid, relative, destination, descriptor=None):
    fd = descriptor if descriptor is not None else os.open(ROOT / relative, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        value = os.fstat(fd)
        need(stat.S_ISREG(value.st_mode) and value.st_size <= 8 * 1024 ** 2, 'bounded-gateway-bind-file')
        raw = os.pread(fd, value.st_size + 1, 0)
        parts = call(['docker', 'exec', cid, 'stat', '-c', '%i:%u:%g:%a', destination], 'bound-file-stat').decode().strip().split(':')
        need(len(parts) == 4 and all(re.fullmatch('[0-9]+', item) for item in parts), 'numeric-gateway-bind-stat')
        need([int(parts[0]), int(parts[1]), int(parts[2]), int(parts[3], 8)] == [value.st_ino, value.st_uid, value.st_gid, stat.S_IMODE(value.st_mode)], 'host-fd-and-mounted-file-inode-owner-mode-exact')
        body = call(['docker', 'exec', cid, 'cat', destination], 'bound-file-bytes')
        need(body == raw, 'host-fd-and-mounted-file-bytes-exact')
        return {'inode': value.st_ino, 'uid': value.st_uid, 'gid': value.st_gid, 'mode': stat.S_IMODE(value.st_mode), 'sha256': sha(raw)}
    finally:
        if descriptor is None: os.close(fd)


def prepared():
    sealed(ARCHIVE_ROOT / 'prepare', PREPARED_SHA256, 'prepare', TARGET, TREE)
    value = read(ARCHIVE_ROOT / 'prepare/prepared.private.json')
    need(value['target'] == TARGET and value['tree'] == TREE and value['appTree'] == APP_TREE
         and value['existingVerifySHA256'] == EXISTING_VERIFY_SHA256
         and value['existingArchivePath'] == EXISTING_ARCHIVE_PATH, 'exact-prepared-source-and-prior-verification')
    return value


def prepare():
    need(not PREPARED_SHA256 and not DEPLOY_SHA256, 'prepare-no-prior-phase-pins')
    source_guard(BASE)
    need(not (ROOT / APP).exists(), 'new-app-host-source-not-preinstalled')
    before = runtime(); need(len(before) == 46, 'original-forty-six-containers'); service(before, SERVICE, True)
    nginx = service(before, 'nginx')
    protected = protected_inventory(before); dirty = dirty_inventory(True)
    need('services/' + SERVICE not in protected['maintenance'], 'no-preexisting-new-service-maintenance-gate')
    configs = {}
    for index, name in enumerate(CONFIG):
        record, data = file_record(ROOT / name)
        need(data == git('show', BASE + ':' + name), 'original-shared-config-exact-base')
        private(OUT / ('config-%d-before.private' % index), data)
        target = git('show', TARGET + ':' + name)
        private(OUT / ('config-%d-target.private' % index), target)
        configs[name] = {'before': record, 'targetSHA256': sha(target), 'index': index}
    private(OUT / 'production-environment-backup.private', file_record(ROOT / '.env.cloud.production')[1])
    auth_record, auth_bytes = file_record(pathlib.Path(protected['htpasswd']['resolvedPath']))
    need(auth_record == protected['htpasswd']['file'], 'same-actual-auth-bytes-before-private-backup')
    private(OUT / 'gateway-auth-backup.private', auth_bytes)
    old = json.loads(call([*compose(ROOT / CONFIG[0]), 'config', '--format', 'json'], 'old-compose'))
    new = json.loads(call([*compose(OUT / 'config-0-target.private'), 'config', '--format', 'json'], 'target-compose'))
    semantic_compose(old, new)
    context, sources = source_context()
    tag = 'rr-portal-xingxin-invoice:batch1022-' + TARGET[:12]
    call(['docker', 'build', '--label', 'org.opencontainers.image.revision=' + TARGET, '-t', tag, str(context)], 'build-static-app', timeout=1200, mutating=True)
    image = json.loads(call(['docker', 'image', 'inspect', tag], 'candidate-image'))[0]
    need(re.fullmatch('sha256:[a-f0-9]{64}', image['Id']) and image['Os'] == 'linux' and image['Architecture'] == 'amd64'
         and image['Config'].get('Labels', {}).get('org.opencontainers.image.revision') == TARGET
         and not image['Config'].get('Volumes'), 'immutable-reviewed-static-image')
    files = webroot(image['Id'])
    need(call(['docker', 'run', '--rm', '--network', 'none', '--entrypoint', 'cat', image['Id'],
               '/etc/nginx/conf.d/default.conf'], 'candidate-app-nginx-config', mutating=True)
         == git('show', TARGET + ':' + APP + '/nginx.conf'), 'candidate-app-nginx-config-exact-reviewed-source')
    for name, value in sources.items():
        if name.startswith('public/'):
            need(files.get(name[len('public/'):]) == value, 'all-six-public-templates-in-image-exact')
    candidate_http_test(image['Id'], files)
    candidate_nginx_test(nginx, OUT / 'config-2-target.private')
    binds = {name: bind_record(nginx[0], name, destination) for name, destination in SHARED.items()}
    need(runtime() == before and protected_inventory(before) == protected and dirty_inventory() == dirty, 'prepare-preserves-runtime-env-bind-permissions-and-dirty-files')
    source_guard(BASE)
    overlay = {'services': {SERVICE: {'image': image['Id'], 'pull_policy': 'never'}}}
    private(OUT / 'image-overlay.private.json', overlay)
    value = {'target': TARGET, 'tree': TREE, 'appTree': APP_TREE, 'existingVerifySHA256': EXISTING_VERIFY_SHA256,
             'existingArchivePath': EXISTING_ARCHIVE_PATH,
             'runtime': before, 'protected': protected, 'dirty': dirty, 'configs': configs, 'binds': binds,
             'networkName': nginx[1]['hostConfig']['NetworkMode'],
             'oldCompose': old, 'newCompose': new, 'image': image['Id'], 'imageConfig': image['Config'], 'webroot': files}
    private(OUT / 'prepared.private.json', value)
    return {'image': image['Id'], 'staticFiles': len(files), 'allOriginal46ContainersAndConfigUnchanged': True, 'candidateSyntaxAndHealthPassed': True, 'bindSourceTypes': bind_source_type_summary(protected)}


def write_fd(fd, data):
    offset = 0
    while offset < len(data):
        size = os.pwrite(fd, data[offset:], offset); need(size > 0, 'complete-config-write'); offset += size
    os.ftruncate(fd, len(data)); os.fsync(fd)


def healthy(cid):
    deadline = time.monotonic() + 180
    while time.monotonic() < deadline:
        row = json.loads(call(['docker', 'inspect', cid], 'new-service-health'))[0]
        need(row['RestartCount'] == 0 and not row['State']['OOMKilled'], 'new-service-no-restart-or-oom')
        if row['State']['Running'] and row['State'].get('Health', {}).get('Status') == 'healthy': return row
        time.sleep(3)
    need(False, 'new-service-health-timeout')


def new_contract(row, value):
    need(row['Image'] == value['image'] and row['Config']['Image'] == value['image'] and row['Mounts'] == []
         and row['Config']['Env'] == value['imageConfig'].get('Env') and row['RestartCount'] == 0, 'new-static-image-env-no-volumes')
    host = row['HostConfig']
    need(not host.get('Privileged') and not host.get('Binds') and not host.get('PortBindings')
         and not host.get('Devices') and not host.get('CapAdd') and host.get('Memory') == 134217728
         and host.get('MemorySwap') == 134217728 and host.get('RestartPolicy', {}).get('Name') == 'unless-stopped', 'new-static-host-contract')
    need(host.get('NetworkMode') == value['networkName'] and set(row['NetworkSettings']['Networks']) == {value['networkName']}, 'only-existing-platform-network')
    labels = row['Config'].get('Labels') or {}
    need(labels.get('com.docker.compose.project') == 'rr-portal' and labels.get('com.docker.compose.service') == SERVICE
         and labels.get('org.opencontainers.image.revision') == TARGET, 'new-static-compose-and-revision-labels')
    need(webroot(row['Id'], True) == value['webroot'], 'running-static-files-exact-prepared-image')
    need(call(['docker', 'exec', row['Id'], 'cat', '/etc/nginx/conf.d/default.conf'], 'running-app-nginx-config')
         == git('show', TARGET + ':' + APP + '/nginx.conf'), 'running-app-nginx-config-exact-reviewed-source')


def request(host, path):
    need(ipaddress.ip_address(host).is_private and path.startswith('/') and '..' not in path, 'fixed-private-readonly-http')
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *args, **kwargs): return None
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    req = urllib.request.Request('http://' + host + path, method='GET', headers={'Host': '8.148.146.194', 'Cache-Control': 'no-cache'})
    try:
        with opener.open(req, timeout=15) as response:
            raw = response.read(16 * 1024 ** 2 + 1); need(len(raw) <= 16 * 1024 ** 2, 'bounded-static-response')
            return response.status, raw, dict(response.headers)
    except urllib.error.HTTPError as error:
        return error.code, error.read(8192), dict(error.headers)


def public_proof(row, value):
    addresses = [network.get('IPAddress') for network in row['NetworkSettings']['Networks'].values()]
    need(len(addresses) == 1 and addresses[0] and ipaddress.ip_address(addresses[0]).is_private, 'one-private-app-network')
    for name, expected in value['webroot'].items():
        code, data, _ = request(addresses[0], '/' + urllib.parse.quote(name))
        need(code == 200 and {'bytes': len(data), 'sha256': sha(data)} == expected, 'all-direct-static-files-exact')
    code, data, headers = request('127.0.0.1', '/xingxin-invoice/health')
    need(code == 200 and json.loads(data) == {'status': 'ok', 'service': SERVICE}, 'public-new-health')
    for path in ['/xingxin-invoice/', *['/xingxin-invoice/' + urllib.parse.quote(name) for name in value['webroot']]]:
        code, _, headers = request('127.0.0.1', path)
        lowered = {key.lower(): val for key, val in headers.items()}
        need(code == 401 and lowered.get('www-authenticate') == 'Basic realm="RR Portal"'
             and lowered.get('content-security-policy') == CSP, 'pages-assets-templates-protected-with-existing-csp')
    for path in ('/nginx-health', '/internal-quote/health', '/paiji/health', '/indo-shipping/api/health'):
        need(request('127.0.0.1', path)[0] == 200, 'portal-and-existing-health-kept-available')
    need(request('127.0.0.1', '/xingxin-invoice')[0] == 301, 'bare-path-redirect')
    need(request('127.0.0.1', '/')[0] == 401, 'portal-original-auth-challenge-no-maintenance')
    return {'newHealth': 200, 'protectedStatic': 401, 'portalOriginalAuth': 401, 'allStaticFiles': len(value['webroot']),
            'otherHealthChecks': 4, 'authenticatedProductionRequests': 0}


def final_guard(value, cid):
    after = runtime()
    need(set(after) == set(value['runtime']) | {cid} and all(after[key] == item for key, item in value['runtime'].items()), 'all-original46-containers-completely-unchanged')
    need(protected_inventory(value['runtime']) == value['protected'] and dirty_inventory() == value['dirty'], 'env-auth-maintenance-bind-owners-and-original-dirty-files-exact')
    for name, contract in value['configs'].items():
        record, _ = file_record(ROOT / name)
        need(record == dict(contract['before'], sha256=contract['targetSHA256']), 'host-reviewed-config-bytes-owner-mode')
    source_guard(TARGET)
    return after


def deploy():
    need(not DEPLOY_SHA256, 'deploy-has-no-own-prior-deploy-pin')
    value = prepared(); source_guard(BASE)
    need(runtime() == value['runtime'] and protected_inventory(value['runtime']) == value['protected']
         and dirty_inventory() == value['dirty'], 'same-prepared-existing-runtime-and-config')
    nginx = service(value['runtime'], 'nginx')
    for name, destination in SHARED.items():
        fd = os.open(ROOT / name, os.O_RDWR | os.O_NOFOLLOW); FDS[name] = fd
        need(bind_record(nginx[0], name, destination, fd) == value['binds'][name], 'same-original-bind-inode-before-source-fast-forward')
    for name, contract in value['configs'].items():
        need(file_record(ROOT / name)[0] == contract['before'], 'all-prepared-host-config-before')
    candidate_nginx_test(nginx, ARCHIVE_ROOT / 'prepare/config-2-target.private')
    rendered = json.loads(call([*compose(ARCHIVE_ROOT / 'prepare/config-0-target.private'), 'config', '--format', 'json'], 'pre-ff-target-compose'))
    need(rendered == value['newCompose'], 'candidate-config-last-preflight')
    call(['git', 'merge', '--ff-only', TARGET], 'source-fast-forward', mutating=True)
    source_guard(TARGET)
    need(dirty_inventory() == value['dirty'], 'source-fast-forward-preserves-original-dirty-files')
    overlay = ARCHIVE_ROOT / 'prepare/image-overlay.private.json'
    args = compose(ROOT / CONFIG[0], overlay)
    effective = json.loads(call([*args, 'config', '--format', 'json'], 'effective-compose'))
    expected = copy.deepcopy(value['newCompose']); expected['services'][SERVICE].update(image=value['image'], pull_policy='never')
    need(effective == expected, 'image-only-overlay-all-other-effective-service-configs-exact')
    need(runtime() == value['runtime'], 'no-existing-lifecycle-before-new-service-create')
    call([*args, 'up', '-d', '--no-deps', '--no-build', '--pull', 'never', SERVICE], 'create-only-new-static-service', timeout=180, mutating=True)
    current = runtime(); cid, _ = service(current, SERVICE)
    row = healthy(cid); new_contract(row, value)
    need(set(current) == set(value['runtime']) | {cid} and all(current[k] == v for k, v in value['runtime'].items()), 'only-one-new-service-created')
    # git may replace host path inodes. Existing mounts continue referencing the
    # exact original descriptors; write through them, then verify both views.
    for name, destination in SHARED.items():
        contract = value['configs'][name]
        raw = (ARCHIVE_ROOT / ('prepare/config-%d-target.private' % contract['index'])).read_bytes()
        need(sha(raw) == contract['targetSHA256'] and (ROOT / name).read_bytes() == raw, 'exact-ff-target-config-before-fd-write')
        observed = bind_record(nginx[0], name, destination, FDS[name])
        need(observed == dict(value['binds'][name], sha256=observed['sha256'])
             and observed['sha256'] in {value['binds'][name]['sha256'], contract['targetSHA256']}, 'same-original-mounted-inode-before-owned-config-write')
        WROTE.add(name); write_fd(FDS[name], raw)
        proof = bind_record(nginx[0], name, destination, FDS[name])
        need(proof == dict(value['binds'][name], sha256=sha(raw)), 'same-mounted-inode-new-reviewed-bytes')
    call(['docker', 'exec', nginx[0], 'nginx', '-t'], 'live-gateway-syntax')
    call(['docker', 'exec', nginx[0], 'nginx', '-s', 'reload'], 'graceful-gateway-reload', mutating=True)
    # Only readiness/HTTP reads repeat; no lifecycle or signal is retried.
    deadline = time.monotonic() + 45
    while time.monotonic() < deadline:
        if request('127.0.0.1', '/xingxin-invoice/health')[0] == 200: break
        time.sleep(2)
    need(final_guard(value, cid)[cid] == runtime_record(row), 'single-new-start-no-later-lifecycle')
    proof = public_proof(row, value)
    private(OUT / 'deployed.private.json', {'container': cid, 'image': value['image'], 'runtime': runtime(),
            'preparedSHA256': PREPARED_SHA256, 'mountedBindings': {name: bind_record(nginx[0], name, dest, FDS[name]) for name, dest in SHARED.items()}})
    return {'newContainer': cid, 'image': value['image'], 'allOriginal46ContainersAndEnvironmentUnchanged': True,
            'gatewayGracefulReloadOnly': True, 'portalMaintenanceEnabled': False, 'businessDataWrites': False, 'public': proof}


def descriptor_record(fd):
    first = os.fstat(fd)
    need(stat.S_ISREG(first.st_mode) and first.st_size <= 8 * 1024 ** 2, 'bounded-rollback-descriptor')
    data = os.pread(fd, first.st_size + 1, 0)
    last = os.fstat(fd)
    keys = lambda s: (s.st_dev, s.st_ino, s.st_uid, s.st_gid, s.st_mode, s.st_size, s.st_mtime_ns, s.st_ctime_ns)
    need(keys(first) == keys(last) and len(data) == first.st_size, 'stable-rollback-descriptor-read')
    return {'device': first.st_dev, 'inode': first.st_ino, 'uid': first.st_uid, 'gid': first.st_gid,
            'mode': stat.S_IMODE(first.st_mode), 'sha256': sha(data)}


def recover_own_configs():
    if PHASE != 'deploy' or not WROTE: return {'attempted': False}
    if AMBIGUOUS: return {'attempted': False, 'ambiguousMutationReadOnlyReconciliationRequired': True}
    value = read(ARCHIVE_ROOT / 'prepare/prepared.private.json')
    nginx = service(value['runtime'], 'nginx')
    host_fds, originals = {}, {}

    def validate(name):
        contract = value['configs'][name]
        accepted = {contract['before']['sha256'], contract['targetSHA256']}
        mounted = bind_record(nginx[0], name, SHARED[name], FDS[name])
        need(mounted == dict(value['binds'][name], sha256=mounted['sha256'])
             and mounted['sha256'] in accepted, 'rollback-mounted-view-still-only-original-or-own-target')
        host = descriptor_record(host_fds[name])
        path = ROOT / name
        need(not path.is_symlink() and path.is_file(), 'rollback-host-path-still-regular')
        current = path.stat()
        need((current.st_dev, current.st_ino) == (host['device'], host['inode'])
             and all(host[key] == contract['before'][key] for key in ('uid', 'gid', 'mode'))
             and host['sha256'] in accepted, 'rollback-host-view-still-only-original-or-own-target')
        return host

    try:
        # Validate both retained mounted descriptors AND both current host paths
        # before the first recovery write. A foreign edit must never be overwritten.
        for name in SHARED:
            contract = value['configs'][name]
            old = (ARCHIVE_ROOT / ('prepare/config-%d-before.private' % contract['index'])).read_bytes()
            need(sha(old) == contract['before']['sha256'], 'rollback-original-config-byte-seal')
            originals[name] = old
            host_fds[name] = os.open(ROOT / name, os.O_RDWR | os.O_NOFOLLOW)
        for name in SHARED: validate(name)
        for name in SHARED:
            host = validate(name)
            write_fd(FDS[name], originals[name])
            mounted = os.fstat(FDS[name])
            if (host['device'], host['inode']) != (mounted.st_dev, mounted.st_ino):
                # Use the already checked descriptor, never reopen a replaceable path.
                current = descriptor_record(host_fds[name])
                need(current == host, 'rollback-host-descriptor-unchanged-before-own-write')
                write_fd(host_fds[name], originals[name])
            restored = validate(name)
            need(restored['sha256'] == value['configs'][name]['before']['sha256']
                 and bind_record(nginx[0], name, SHARED[name], FDS[name]) == value['binds'][name],
                 'rollback-both-original-views-restored')
    finally:
        for fd in host_fds.values(): os.close(fd)
    call(['docker', 'exec', nginx[0], 'nginx', '-t'], 'rollback-gateway-syntax')
    call(['docker', 'exec', nginx[0], 'nginx', '-s', 'reload'], 'rollback-one-graceful-reload', mutating=True)
    return {'attempted': True, 'onlyOwnSharedFilesRestored': sorted(SHARED), 'headNotReset': True,
            'targetHeadWithOwnedRecoveryDirtyFiles': True, 'newServiceRetainedForDiagnosis': True, 'businessDataRestoredOrReset': False}


def verify():
    value = prepared()
    deployed = sealed(ARCHIVE_ROOT / 'deploy', DEPLOY_SHA256, 'deploy', TARGET, TREE)
    detail = read(ARCHIVE_ROOT / 'deploy/deployed.private.json'); cid = detail['container']
    need(detail['preparedSHA256'] == PREPARED_SHA256 and detail['image'] == value['image']
         and deployed.get('newContainer') == cid, 'exact-successful-single-deploy-chain')
    current = final_guard(value, cid)
    need(current[cid] == detail['runtime'][cid], 'same-deployed-new-service-no-further-lifecycle')
    row = healthy(cid); new_contract(row, value)
    nginx = service(value['runtime'], 'nginx')
    for name, destination in SHARED.items():
        need(call(['docker', 'exec', nginx[0], 'cat', destination], 'verify-mounted-target') == git('show', TARGET + ':' + name), 'final-mounted-target-bytes')
        current_stat = call(['docker', 'exec', nginx[0], 'stat', '-c', '%i:%u:%g:%a', destination], 'verify-mounted-inode').decode().strip()
        b = detail['mountedBindings'][name]
        need(current_stat == '%d:%d:%d:%o' % (b['inode'], b['uid'], b['gid'], b['mode']), 'retained-original-bind-inode-owner-mode')
    proof = public_proof(row, value)
    call(['docker', 'image', 'tag', value['image'], ALIAS], 'promote-new-static-canonical-alias', mutating=True)
    need(json.loads(call(['docker', 'image', 'inspect', ALIAS], 'canonical-alias'))[0]['Id'] == value['image'], 'exact-new-static-canonical-alias')
    need(final_guard(value, cid) == current, 'verification-changes-no-live-container')
    return {'newContainer': cid, 'image': value['image'], 'sourceAndStaticAndRoutingVerified': True,
            'allOriginal46ContainersEnvAuthAndBindPermissionsPreserved': True, 'public': proof, 'businessDataWrites': False}


def main():
    global OUT
    need(EXECUTE is True and pin(TARGET, 40) and pin(TREE, 40) and PHASE in {'prepare', 'deploy', 'verify'}
         and sys.argv[1:] == [PHASE] and os.environ.get('RELEASE_BRANCH') == BRANCH
         and os.environ.get('RELEASE_MODE') == PHASE and os.environ.get('RELEASE_ATTEMPT') == '1', 'inert-exact-first-phase')
    os.umask(0o077)
    need(ARCHIVE_ROOT.parent.is_dir() and not ARCHIVE_ROOT.parent.is_symlink(), 'existing-backup-parent')
    ARCHIVE_ROOT.mkdir(mode=0o700, exist_ok=True)
    need(not ARCHIVE_ROOT.is_symlink() and stat.S_IMODE(ARCHIVE_ROOT.stat().st_mode) == 0o700, 'private-own-release-parent')
    OUT = ARCHIVE_ROOT / PHASE
    need(not OUT.exists() and not OUT.is_symlink(), 'one-shot-own-phase')
    OUT.mkdir(mode=0o700)
    result = {'phase': PHASE, 'base': BASE, 'target': TARGET, 'tree': TREE, 'success': False}
    try:
        existing_gate()
        result.update(prepare() if PHASE == 'prepare' else deploy() if PHASE == 'deploy' else verify())
        result['success'] = True
    except Exception as error:
        result.update(errorType=type(error).__name__, stage=STAGE, ambiguousMutation=AMBIGUOUS, noMutationReplay=True)
        try: result['recovery'] = recover_own_configs()
        except Exception as recovery_error: result['recovery'] = {'attempted': True, 'errorType': type(recovery_error).__name__, 'stage': STAGE, 'furtherMutationStopped': True}
        try: private(OUT / 'failure-runtime-readonly.private.json', runtime())
        except Exception: result['failureReconciliationUnavailable'] = True
    finally:
        for fd in FDS.values(): os.close(fd)
        FDS.clear()
    result['utc'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    private(OUT / 'phase-claims.private.json', result)
    private(OUT / 'manifest.json', manifest(OUT))
    result['manifestSHA256'] = sha((OUT / 'manifest.json').read_bytes())
    private(OUT / 'result.private.json', result)
    result['resultSHA256'] = sha(enc(result))
    print(json.dumps(result, sort_keys=True), flush=True)
    return 0 if result['success'] else 1


if __name__ == '__main__':
    sys.exit(main())
