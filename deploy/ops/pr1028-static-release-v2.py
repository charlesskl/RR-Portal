"""INERT DRAFT: three-file Quote static hotpatch; no SQL, restart or host checkout.

R2 retains the same reviewed source/runtime pins and must be independently reviewed
before root binds its fresh controller hashes and explicitly activates a phase. A failed/ambiguous deployment
retains its private stage; it never automatically replays a rename or image tag.
"""
import base64, datetime, hashlib, io, json, os, pathlib, re, stat, subprocess, sys, tarfile, time, urllib.error, urllib.parse, urllib.request
ROOT = pathlib.Path('/opt/rr-portal')
OUT = ROOT / 'deploy/backups/pr1028-static-20261028-r2'
APP = 'apps/业务部/内部报价系统'
HOST_BASE = '4b3d8f3e319e41dcc8720d759e1af0726a2b2381'
BASE = '14f2dfcc6b9a189242fc4e56ed71864cd484ff3b'
HEAD = 'd05dc7e64452cba5819175d308c44f7dd0e97b94'
APP_TREE = 'aaf69e70b10080217e3ad6acadf699086cf172ae'
EXPECTED_TARGET = 'dc7d673dfe1d441e97550c6c7d42901b3e0322ff'
EXPECTED_TREE = 'd2df5b3aa81e745e87dac33058841af1f289b6ab'
LIVE_IMAGE = 'sha256:adf5b723ca5f8edae60a0a0f12a3828b8cd488a99eeee6405b61092805620294'
STATIC_BASE_IMAGE = 'sha256:04f1bf65edcffd6e27a396a4712c8600d4762860311da066613afa7adadf0988'
COMPILED_SOURCE = 'daa878ce6ed661d9b84288e7869b37e9118ce5bc'
TARGET = 'dc7d673dfe1d441e97550c6c7d42901b3e0322ff'
TREE = 'd2df5b3aa81e745e87dac33058841af1f289b6ab'
PHASE = 'deploy'
PREPARED_SHA256 = '23f1d81cfc0c380f5671a9e787c25bbb97668d2733ed9feaefd392c8c26ff887'
DEPLOY_SHA256 = ''
EXECUTE = True
BRANCH = 'refs/heads/ops/pr-1028-r2-20261028-static'
SERVICE = 'internal-quote'
COMPOSE_TAG = 'rr-portal-internal-quote:latest'
PUBLIC = 'http://127.0.0.1/internal-quote/'
ORDER = ('workbench.js', 'quote.html', 'verification.html')
BACKEND_SOURCE_PATHS = ('package.json', 'backend/server.js', 'backend/db/index.js', 'backend/db/postgres.js', 'backend/db/schema.postgres.sql', 'backend/db/accountSeed.js', 'backend/db/account-seed.csv', 'backend/services/parseHardwareSheet.js')
REVIEWED_APP_TREE = 'aaf69e70b10080217e3ad6acadf699086cf172ae'
REVIEWED_FILES = {'quote.html': 'a7266bfe645fa89abc6b2df79e48d99f0b3bd8f52fa5958c5c55efc638f90a12', 'verification.html': '1e3326b2c9c21613eec21afe77ed165f1f29bbb7c9df58640d0e15bef9da92d2', 'workbench.js': 'c5110ee8edb596e0be15bbcd5c1406f92e1624ab06bd75a3920b13407ab75296'}
STAGE = 'entry'
SERIAL = 0

def need(v, label):
    global STAGE
    STAGE = label
    if not v: raise RuntimeError(label)
def enc(v): return json.dumps(v, sort_keys=True, ensure_ascii=True, separators=(',', ':'), allow_nan=False).encode()
def sha(v): return hashlib.sha256(v).hexdigest()
def pin(v, n=64): return type(v) is str and re.fullmatch('[a-f0-9]{%d}' % n, v) is not None
def image_pin(v): return type(v) is str and re.fullmatch('sha256:[a-f0-9]{64}', v) is not None
def private(path, data):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'wb') as f: f.write(data); f.flush(); os.fsync(f.fileno())
def run(args, data=None, timeout=180):
    global SERIAL, STAGE
    STAGE = 'command-' + pathlib.Path(args[0]).name; SERIAL += 1
    # Captures are private and are retained on timeout. No raw output is printed.
    prefix = OUT / ('%s-%03d' % (PHASE, SERIAL)); paths = [str(prefix) + '.stdout.private', str(prefix) + '.stderr.private']
    fds = [os.open(p, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600) for p in paths]
    with os.fdopen(fds[0], 'wb') as stdout, os.fdopen(fds[1], 'wb') as stderr:
        p = subprocess.Popen(args, stdin=subprocess.PIPE if data is not None else subprocess.DEVNULL, stdout=stdout, stderr=stderr, cwd=ROOT)
        try: p.communicate(data, timeout=timeout)
        except BaseException:
            p.kill(); p.communicate(); stdout.flush(); stderr.flush(); os.fsync(stdout.fileno()); os.fsync(stderr.fileno()); raise
        stdout.flush(); stderr.flush(); os.fsync(stdout.fileno()); os.fsync(stderr.fileno())
    need(p.returncode == 0, 'command-' + pathlib.Path(args[0]).name)
    need(pathlib.Path(paths[0]).stat().st_size <= 512 * 1024**2, 'bounded-private-command-output')
    return pathlib.Path(paths[0]).read_bytes()
def git(*a): return run(['git', '-C', str(ROOT), '-c', 'core.hooksPath=/dev/null', *a])
def safe_relative(n):
    return type(n) is str and bool(n) and str(pathlib.PurePosixPath(n)) == n and not n.startswith('/') and '..' not in pathlib.PurePosixPath(n).parts and '\\' not in n and all(ord(c) >= 32 for c in n)
def image_record(name):
    v = json.loads(run(['docker', 'image', 'inspect', name])); need(len(v) == 1 and image_pin(v[0]['Id']), 'one-local-immutable-image'); return v[0]
def image_id(name): return image_record(name)['Id']
def host_files():
    need(git('rev-parse', 'HEAD').decode().strip() == HOST_BASE and git('symbolic-ref', '--short', 'HEAD').decode().strip() == 'main', 'host-source-remains-deferred-main-base')
    git('diff', '--cached', '--quiet')
    shared = ['docker-compose.cloud.yml', 'frontend/index.cloud.html', 'nginx/nginx.cloud.conf', 'deploy/update-server.sh', 'deploy/service-maintenance.sh']
    dirty = [p for p in git('diff', '--name-only', '-z').decode().split('\0') if p]
    need(len(dirty) == len(set(dirty)) == 4 and not any(p == APP or p.startswith(APP + '/') for p in dirty), 'four-original-dirty-files-outside-quote')
    result = {}
    for name in sorted(set(['.env.cloud.production', *shared, *dirty])):
        p = ROOT / name; need(safe_relative(name) and not p.is_symlink() and p.is_file() and p.stat().st_size <= 8 * 1024**2, 'bounded-regular-preserved-host-file')
        data = p.read_bytes(); st = p.stat()
        if name in shared: need(data == git('show', HOST_BASE + ':' + name), 'shared-config-still-physical-host-base')
        result[name] = {'sha256': sha(data), 'uid': st.st_uid, 'gid': st.st_gid, 'mode': stat.S_IMODE(st.st_mode)}
    return result

def metadata(path):
    need(not path.is_symlink() and (path.is_file() or path.is_dir()), 'regular-metadata')
    v = path.stat(); return {'uid': v.st_uid, 'gid': v.st_gid, 'mode': stat.S_IMODE(v.st_mode)}

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
    found_services = [row for row in records.values() if (row['config'].get('Labels') or {}).get('com.docker.compose.project') == 'rr-portal' and (row['config'].get('Labels') or {}).get('com.docker.compose.service') == 'nginx']
    need(len(found_services) == 1, 'one-existing-nginx-auth-service')
    nginx = (None, found_services[0])
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


def runtime(row):
    return {'image': row['Image'], 'started': row['State']['StartedAt'], 'restartCount': row['RestartCount'], 'running': row['State']['Running'], 'pid': row['State']['Pid'], 'oom': row['State']['OOMKilled'], 'config': sha(enc(dict(row['Config'], Env=sorted(row['Config'].get('Env') or [])))), 'hostConfig': sha(enc(row['HostConfig'])), 'mounts': sha(enc(sorted(row['Mounts'], key=enc)))}
def inventory():
    ids = run(['docker', 'ps', '-aq', '--no-trunc']).decode().split(); need(len(ids) == len(set(ids)) and 1 <= len(ids) <= 100, 'bounded-complete-container-inventory')
    rows = json.loads(run(['docker', 'inspect', *sorted(ids)])); need({r['Id'] for r in rows} == set(ids), 'complete-actual-inspected-inventory')
    targets = [r for r in rows if (r['Config'].get('Labels') or {}).get('com.docker.compose.project') == 'rr-portal' and (r['Config'].get('Labels') or {}).get('com.docker.compose.service') == SERVICE]
    need(len(targets) == 1, 'unique-formal-quote-service'); r = targets[0]
    need(r['Image'] == LIVE_IMAGE and r['State']['Running'] and not r['State']['OOMKilled'] and r['State'].get('Health', {}).get('Status') == 'healthy', 'accepted-actual-live-quote-image-healthy')
    expected = {'/app/backend/legacy-data': (str(ROOT / APP / 'backend/data'), False), '/app/backend/uploads': (str(ROOT / APP / 'backend/uploads'), True)}
    need(len(r['Mounts']) == 2, 'only-two-existing-quote-business-binds')
    for m in r['Mounts']:
        need(m['Type'] == 'bind' and m['Destination'] in expected and (m['Source'], m['RW']) == expected[m['Destination']], 'exact-existing-quote-bind-source-access')
        p = pathlib.Path(m['Source']); need(p.is_dir() and not p.is_symlink(), 'regular-existing-business-bind-directory')
    private(OUT / ('%s-inventory-%03d.private.json' % (PHASE, SERIAL)), enc(rows))
    full = {v['Id']: {'config': v['Config'], 'mounts': sorted(v['Mounts'], key=enc)} for v in rows}
    return r, {'containers': {v['Id']: runtime(v) for v in rows}, 'protected': protected_inventory(full)}

# Fixed read-only hash program: no business data/credentials are emitted or copied.
# Exclusions are exact backend business directories, never a general user-controlled glob.
CODE_PROBE = r'''const fs=require('fs'),path=require('path'),crypto=require('crypto');
const h=b=>crypto.createHash('sha256').update(b).digest('hex');
function tree(root,omit=[]){let a=[],bytes=0;function walk(p,n){let s=fs.lstatSync(p),v={n,uid:s.uid,gid:s.gid,mode:s.mode&4095};
if(s.isSymbolicLink()){v.type='link';v.target=fs.readlinkSync(p);}else if(s.isDirectory()){v.type='dir';a.push(v);for(let x of fs.readdirSync(p).sort()){if(n===''&&omit.includes(x))continue;walk(path.join(p,x),n?n+'/'+x:x);}return;}else if(s.isFile()){v.type='file';v.size=s.size;bytes+=s.size;v.sha256=h(fs.readFileSync(p));}else throw Error('unsupported-code-kind');a.push(v);if(a.length>100000||bytes>1024**3)throw Error('bounded-code');}
if(!fs.existsSync(root))return {absent:true};walk(root,'');return {sha256:h(JSON.stringify(a)),entries:a.length,bytes};}
console.log(JSON.stringify({backend:tree('/app/backend',['data','legacy-data','uploads','data.db','data.db-shm','data.db-wal']),nodeModules:tree('/app/node_modules'),package:tree('/app/package.json'),lock:tree('/app/package-lock.json')}));'''

def code_probe(cid):
    v = json.loads(run(['docker', 'exec', '--user', '0', cid, 'node', '-e', CODE_PROBE], timeout=180)); validate_code(v); return v
def validate_code(v):
    need(type(v) is dict and set(v) == {'backend', 'nodeModules', 'package', 'lock'}, 'fixed-code-signature-roots')
    for name, row in v.items():
        need((name == 'lock' and row == {'absent': True}) or (type(row) is dict and pin(row.get('sha256')) and 1 <= row.get('entries', 0) <= 100000 and 0 <= row.get('bytes', -1) <= 1024**3), 'typed-code-signature')

def tool_probe(image):
    # Own, stateless tool only: no ports, env-file, application startup or production mounts.
    cidfile = OUT / ('%s-tool-%03d.cid.private' % (PHASE, SERIAL))
    raw = run(['docker', 'run', '--rm', '--cidfile', str(cidfile), '--read-only', '--network', 'none', '--restart', 'no', '--log-driver', 'none', '--label', 'io.rr-portal.pr1028-r2-tool=' + TARGET, '--entrypoint', 'node', image, '-e', CODE_PROBE], timeout=180)
    v = json.loads(raw); validate_code(v); return v

def scratch_create(image):
    need(not image_record(image)['Config'].get('Volumes'), 'scratch-and-tool-image-without-volumes')
    cid = run(['docker', 'create', '--network', 'none', '--restart', 'no', '--log-driver', 'none', '--label', 'io.rr-portal.pr1028-r2-scratch=' + TARGET, '--entrypoint', '/bin/true', image]).decode().strip()
    need(pin(cid), 'own-full-never-started-scratch-cid'); return cid

def scratch_remove(cid, image):
    r = json.loads(run(['docker', 'inspect', cid]))[0]
    need(r['Id'] == cid and r['Image'] == image and not r['State']['Running'] and r['State']['Pid'] == 0 and r['State']['StartedAt'].startswith('0001-') and not r['Mounts'] and r['HostConfig']['NetworkMode'] == 'none' and (r['Config'].get('Labels') or {}).get('io.rr-portal.pr1028-r2-scratch') == TARGET, 'remove-only-own-never-started-unmounted-scratch')
    run(['docker', 'rm', cid])

def unpack_frontend(blob):
    result = {}; bodies = {}; total = 0
    with tarfile.open(fileobj=io.BytesIO(blob)) as archive:
        members = archive.getmembers(); need(1 <= len(members) <= 4000, 'bounded-full-frontend-archive')
        for m in members:
            name = m.name.rstrip('/'); need(name == 'frontend' or name.startswith('frontend/'), 'frontend-only-capture')
            n = name[len('frontend/'): ] if name != 'frontend' else ''
            need((not n or safe_relative(n)) and n not in result and (m.isdir() or m.isfile()), 'regular-unique-safe-frontend-path')
            need(m.uid >= 0 and m.gid >= 0 and m.mode & 0o7000 == 0 and m.mode & 0o022 == 0 and (m.isdir() or m.mode & 0o444), 'bounded-nonwritable-readable-static-metadata')
            row = {'kind': 'dir' if m.isdir() else 'file', 'uid': m.uid, 'gid': m.gid, 'mode': m.mode & 0o777, 'mtime': int(m.mtime)}
            if m.isfile():
                total += m.size; need(0 <= m.size <= 64 * 1024**2 and total <= 256 * 1024**2, 'bounded-static-public-bytes')
                body = archive.extractfile(m).read(); need(len(body) == m.size, 'complete-static-tar-member'); bodies[n] = body; row.update(size=m.size, sha256=sha(body))
            result[n] = row
    need(result.get('', {}).get('kind') == 'dir' and all(result.get(n, {}).get('kind') == 'file' for n in ORDER), 'three-existing-entry-files-and-root')
    for n in result:
        if n: need(str(pathlib.PurePosixPath(n).parent) == '.' or result.get(str(pathlib.PurePosixPath(n).parent), {}).get('kind') == 'dir', 'all-static-parent-directories-present')
    return result, bodies

def capture(cid, name):
    raw = run(['docker', 'cp', cid + ':/app/frontend', '-']); private(OUT / (name + '.tar.private'), raw); return unpack_frontend(raw)
def stable_manifest(v): return {n: {k: x for k, x in r.items() if k != 'mtime'} for n, r in v.items()}
def static_plan(old, replacements, mtime):
    need(set(replacements) == set(ORDER) and all(type(b) is bytes and sha(b) == REVIEWED_FILES[n] for n, b in replacements.items()), 'exact-three-reviewed-public-replacements')
    new = json.loads(json.dumps(old))
    for n in ORDER:
        need(old[n]['kind'] == 'file' and old[n]['sha256'] != sha(replacements[n]), 'three-changed-existing-regular-files')
        need(old[n]['uid'] >= 0 and old[n]['gid'] >= 0 and old[n]['mode'] == 0o644, 'known-existing-entry-owner-and-readable-mode')
        new[n].update(size=len(replacements[n]), sha256=sha(replacements[n]), mtime=mtime)
    need(all(new[n] == r for n, r in old.items() if n not in ORDER) and set(new) == set(old), 'all-other-static-files-templates-and-graph-preserved')
    return new

def backend_source_proof(cid):
    result = {}
    for name in BACKEND_SOURCE_PATHS:
        expected = git('show', COMPILED_SOURCE + ':' + APP + '/' + name)
        need(expected == git('show', BASE + ':' + APP + '/' + name) == git('show', TARGET + ':' + APP + '/' + name), 'accepted-backend-source-path-unchanged-in-logical-base-and-target')
        actual = run(['docker', 'exec', '--user', '0', cid, 'cat', '/app/' + name])
        need(sha(actual) == sha(expected), 'actual-backend-startup-and-previous-patch-match-accepted-source')
        result[name] = sha(actual)
    return result

def source_check():
    need(all(pin(v, 40) for v in (BASE, HEAD, APP_TREE, EXPECTED_TARGET, EXPECTED_TREE, TARGET, TREE, COMPILED_SOURCE)) and APP_TREE == REVIEWED_APP_TREE and TARGET == EXPECTED_TARGET and TREE == EXPECTED_TREE and image_pin(LIVE_IMAGE) and image_pin(STATIC_BASE_IMAGE), 'all-final-review-source-runtime-pins-required')
    git('fetch', 'origin', 'main')
    need(git('rev-parse', 'refs/remotes/origin/main').decode().strip() == TARGET and git('rev-parse', TARGET + '^{tree}').decode().strip() == TREE and git('rev-parse', TARGET + ':' + APP).decode().strip() == APP_TREE, 'exact-reviewed-main-object-without-checkout')
    need(git('merge-base', '--is-ancestor', BASE, TARGET) == b'' and git('merge-base', '--is-ancestor', HEAD, TARGET) == b'', 'reviewed-head-base-in-target-history')
    changes = [p for p in git('diff', '--name-only', '-z', BASE, TARGET, '--', APP).decode().split('\0') if p]
    allowed = {APP + '/' + n for n in ('frontend/quote.html', 'frontend/verification.html', 'frontend/workbench.js', 'tests/mixed-supplier-header-lifecycle.test.js', 'tests/section-save-queue.test.js', 'tests/shared-supplier-import.test.js')}
    need(set(changes) == allowed, 'reviewed-six-path-app-scope-no-backend-package-config-change')
    for n in ORDER:
        path = APP + '/frontend/' + n
        need(git('ls-tree', TARGET, '--', path).decode().startswith('100644 blob ') and sha(git('show', TARGET + ':' + path)) == REVIEWED_FILES[n], 'exact-reviewed-regular-frontend-source')

def http(name='', headers=None, version=None):
    need(name in ('', 'health', 'api/auth/me') or safe_relative(name), 'safe-local-quote-get-path')
    need(version is None or (name == 'workbench.js' and version == '20261028-supplier-material-update'), 'only-reviewed-cache-bust-query')
    url = PUBLIC + urllib.parse.quote(name, safe='/') + ('' if version is None else '?v=' + version)
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *args, **kwargs): return None
    req = urllib.request.Request(url, headers={'Cache-Control': 'no-cache', **(headers or {})})
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    try:
        with opener.open(req, timeout=20) as r: code, hdr, body = r.status, dict(r.headers), r.read(64 * 1024**2 + 1)
    except urllib.error.HTTPError as e: code, hdr, body = e.code, dict(e.headers), e.read(64 * 1024**2 + 1)
    need(len(body) <= 64 * 1024**2, 'bounded-anonymous-static-get'); return code, {k.lower(): v for k, v in hdr.items()}, body

def public_check(manifest, old_headers=None):
    checked = 0
    for n, row in manifest.items():
        if row['kind'] != 'file': continue
        code, _, body = http(n); need(code == 200 and sha(body) == row['sha256'], 'complete-public-static-union-exact'); checked += 1
    if old_headers is not None:
        for n in ORDER:
            for key, header in (('etag', 'If-None-Match'), ('last-modified', 'If-Modified-Since')):
                code, _, body = http(n, {header: old_headers[n][key]}); need(code == 200 and sha(body) == manifest[n]['sha256'], 'old-validator-gets-reviewed-new-bytes')
    if old_headers is not None:
        code, _, body = http('workbench.js', version='20261028-supplier-material-update'); need(code == 200 and sha(body) == manifest['workbench.js']['sha256'], 'reviewed-html-cache-bust-url-gets-new-workbench')
    need(http('health')[0] == 200 and http('api/auth/me')[0] == 401, 'quote-health200-existing-anonymous-auth401')
    return {'allPublicFiles200AndExact': checked, 'oldConditionalRequests200AndExact': old_headers is not None, 'health200': True, 'auth401': True}

def metadata_script():
    return r'''const fs=require('fs'),path=require('path');const m=JSON.parse(fs.readFileSync('/tmp/pr1028-static-r2-metadata.json','utf8'));for(const [n,v] of Object.entries(m)){const p=path.join('/app/frontend',n);let s=fs.lstatSync(p);if(s.isSymbolicLink()||!(s.isFile()||s.isDirectory()))throw Error('kind');fs.chownSync(p,v.uid,v.gid);fs.chmodSync(p,v.mode);fs.utimesSync(p,v.mtime,v.mtime);}fs.unlinkSync('/tmp/pr1028-static-r2-metadata.json');'''

def temporary_build_root(original_user):
    # Docker/OCI absent or empty User means its inherited default. Never replace
    # that metadata with a guessed UID or normalize None to an empty string.
    if original_user is None or original_user == '': return False
    need(type(original_user) is str and 1 <= len(original_user) <= 129, 'safe-single-token-image-user')
    parts = original_user.split(':'); need(len(parts) in (1, 2), 'safe-image-user-and-optional-group')
    for part in parts:
        need(re.fullmatch(r'(?:[0-9]{1,10}|[A-Za-z_][A-Za-z0-9_.-]{0,63})', part) is not None, 'safe-oci-name-or-numeric-id')
        if part.isdecimal(): need(int(part) <= 4294967294, 'bounded-oci-numeric-id')
    # Explicit known root UID/name is already privileged; preserve its spelling.
    return parts[0] not in ('0', 'root')

def static_image_recipe(base_alias, original_user):
    need(re.fullmatch(r'rrportal-quote-pr1028-r2-base:[a-f0-9]{64}', base_alias) is not None and pin(TARGET, 40) and pin(APP_TREE, 40), 'fixed-private-base-alias-and-source-labels')
    elevate = temporary_build_root(original_user)
    recipe = 'FROM ' + base_alias + '\nCOPY frontend/ /app/frontend/\nCOPY metadata.json /tmp/pr1028-static-r2-metadata.json\n'
    if elevate: recipe += 'USER 0\n'
    recipe += 'RUN node -e ' + __import__('shlex').quote(metadata_script()) + '\n'
    if elevate: recipe += 'USER ' + original_user + '\n'
    return recipe + 'LABEL io.rr-portal.quote-static-tree="' + APP_TREE + '" io.rr-portal.quote-static-target="' + TARGET + '"\n'

def derivative_config_exact(base_config, derivative_config):
    a, b = dict(base_config), dict(derivative_config); before_labels = a.pop('Labels', None) or {}; after_labels = b.pop('Labels', None) or {}; a.pop('Image', None); b.pop('Image', None)
    need(a == b and after_labels == dict(before_labels, **{'io.rr-portal.quote-static-tree': APP_TREE, 'io.rr-portal.quote-static-target': TARGET}), 'backend-startup-env-and-compiled-source-labels-unchanged')

def build_derivative(manifest, bodies):
    base = image_record(STATIC_BASE_IMAGE); need(not base['Config'].get('Volumes'), 'trusted-stateless-build-base'); temporary_build_root(base['Config'].get('User'))
    context = OUT / 'public-image-context'; context.mkdir(mode=0o700); web = context / 'frontend'; web.mkdir(mode=0o755)
    for n, row in sorted(manifest.items(), key=lambda p: (len(pathlib.PurePosixPath(p[0]).parts), p[0])):
        if not n: continue
        p = web / n
        if row['kind'] == 'dir': p.mkdir(mode=0o755)
        else: private(p, bodies[n]); p.chmod(0o644)
    private(context / 'metadata.json', enc(manifest)); (context / 'metadata.json').chmod(0o644)
    base_alias = 'rrportal-quote-pr1028-r2-base:' + STATIC_BASE_IMAGE.split(':')[1]
    # This named reference is private to this revision; never overwrite a foreign tag.
    observed = subprocess.run(['docker', 'image', 'inspect', base_alias], cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=30)
    need(observed.returncode != 0 or json.loads(observed.stdout)[0]['Id'] == STATIC_BASE_IMAGE, 'own-base-alias-not-reassigned')
    if observed.returncode != 0: need(b'No such image:' in observed.stderr or b'No such object:' in observed.stderr, 'only-known-absent-own-alias')
    run(['docker', 'tag', STATIC_BASE_IMAGE, base_alias])
    # No backend/data/env/log/source archive can enter this public-only context.
    recipe = static_image_recipe(base_alias, base['Config'].get('User'))
    private(context / 'Dockerfile', recipe.encode()); (context / 'Dockerfile').chmod(0o644)
    tag = 'rrportal-quote-pr1028-r2:' + TARGET
    run(['docker', 'build', '--network', 'none', '--pull=false', '-t', tag, str(context)], timeout=300)
    derivative = image_record(tag)
    need(derivative['Architecture'] == base['Architecture'] and derivative['Os'] == base['Os'] and derivative['RootFS']['Layers'][:len(base['RootFS']['Layers'])] == base['RootFS']['Layers'], 'derivative-inherits-accepted-base-layers-platform')
    derivative_config_exact(base['Config'], derivative['Config'])
    scratch = scratch_create(derivative['Id'])
    try: actual, _ = capture(scratch, 'durable-frontend-readback')
    finally: scratch_remove(scratch, derivative['Id'])
    need(actual == manifest and tool_probe(derivative['Id']) == tool_probe(STATIC_BASE_IMAGE), 'durable-full-static-union-metadata-and-backend-packages-exact')
    return tag, derivative['Id']

# A single fixed Node program performs the small staging/atomic publication sequence.
# The only served destinations are hard-coded; a JSON payload cannot choose new paths.
STAGE_NODE = r'''const fs=require('fs'),crypto=require('crypto');const p=JSON.parse(fs.readFileSync(0,'utf8'));const names=['workbench.js','quote.html','verification.html'];const h=b=>crypto.createHash('sha256').update(b).digest('hex');
if(!/^\/app\/\.pr1028-static-r2-[a-f0-9]{40}$/.test(p.stage)||Object.keys(p.files).sort().join('|')!==[...names].sort().join('|'))throw Error('scope');
let root=fs.lstatSync('/app/frontend');if(!root.isDirectory()||root.isSymbolicLink())throw Error('root');
function check(n,v){let s=fs.lstatSync('/app/frontend/'+n);if(!s.isFile()||s.isSymbolicLink()||s.uid!==v.uid||s.gid!==v.gid||(s.mode&4095)!==v.mode||h(fs.readFileSync('/app/frontend/'+n))!==v.sha256)throw Error('old-static-cas');}
for(let n of names)check(n,p.files[n].old);
fs.mkdirSync(p.stage,{mode:448});fs.mkdirSync(p.stage+'/new',{mode:448});fs.mkdirSync(p.stage+'/old',{mode:448});
for(let n of names){let v=p.files[n],b=Buffer.from(v.body,'base64');if(h(b)!==v.next.sha256)throw Error('new-bytes');for(let [d,data,m] of [['old',fs.readFileSync('/app/frontend/'+n),v.old],['new',b,v.next]]){let f=fs.openSync(p.stage+'/'+d+'/'+n,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,m.mode);try{fs.writeFileSync(f,data);fs.fchownSync(f,m.uid,m.gid);fs.fchmodSync(f,m.mode);fs.futimesSync(f,m.mtime,m.mtime);fs.fsyncSync(f);}finally{fs.closeSync(f);}}}
console.log(JSON.stringify({staged:true,files:names}));'''
PUBLISH_NODE = r'''const fs=require('fs'),crypto=require('crypto');const p=JSON.parse(fs.readFileSync(0,'utf8'));const names=['workbench.js','quote.html','verification.html'];const h=b=>crypto.createHash('sha256').update(b).digest('hex');if(!/^\/app\/\.pr1028-static-r2-[a-f0-9]{40}$/.test(p.stage)||Object.keys(p.files).sort().join('|')!==[...names].sort().join('|'))throw Error('scope');
let root=fs.lstatSync('/app/frontend'),stage=fs.lstatSync(p.stage);if(!root.isDirectory()||root.isSymbolicLink()||!stage.isDirectory()||stage.isSymbolicLink()||stage.uid!==0||(stage.mode&4095)!==448)throw Error('root-stage');
for(let n of names){let v=p.files[n],s=fs.lstatSync('/app/frontend/'+n),t=fs.lstatSync(p.stage+'/new/'+n);if(!s.isFile()||s.isSymbolicLink()||s.uid!==v.old.uid||s.gid!==v.old.gid||(s.mode&4095)!==v.old.mode||h(fs.readFileSync('/app/frontend/'+n))!==v.old.sha256||!t.isFile()||t.isSymbolicLink()||t.uid!==v.next.uid||t.gid!==v.next.gid||(t.mode&4095)!==v.next.mode||Math.floor(t.mtimeMs/1000)!==v.next.mtime||h(fs.readFileSync(p.stage+'/new/'+n))!==v.next.sha256)throw Error('publication-cas');}
// Workbench is backward-compatible with both old HTMLs; HTMLs always follow it.
for(let n of names){fs.renameSync(p.stage+'/new/'+n,'/app/frontend/'+n);let fd=fs.openSync('/app/frontend','r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
console.log(JSON.stringify({published:true,order:names}));'''

def evidence(name, expected):
    need(pin(expected), 'bound-prior-evidence-seal'); raw = (OUT / name).read_bytes(); need(sha(raw) == expected, 'exact-sealed-prior-evidence'); p = json.loads(raw)
    need(p['base'] == BASE and p['head'] == HEAD and p['target'] == TARGET and p['tree'] == TREE and p['appTree'] == APP_TREE and p['hostBase'] == HOST_BASE, 'prior-evidence-exact-source'); return p

def prepare():
    need(not OUT.exists() and not OUT.is_symlink(), 'fresh-private-prepare-only'); OUT.mkdir(mode=0o700)
    source_check(); preserved = host_files(); row, before = inventory(); need(image_id(COMPOSE_TAG) == STATIC_BASE_IMAGE, 'accepted-durable-canonical-alias')
    base = image_record(STATIC_BASE_IMAGE); need(not base['Config'].get('Volumes'), 'base-tool-and-scratch-have-no-declared-volumes')
    # Prior hotpatch images may retain an older/absent OCI revision label. Preserve
    # that label verbatim; accepted logical source is proven from actual code bytes.
    labels = base['Config'].get('Labels') or {}; startup_proof = backend_source_proof(row['Id'])
    live_code = code_probe(row['Id']); base_code = tool_probe(STATIC_BASE_IMAGE); need(live_code == base_code, 'live-backend-startup-node-packages-equal-immutable-durable-base')
    old, bodies = capture(row['Id'], 'old-actual-frontend'); scratch = scratch_create(STATIC_BASE_IMAGE)
    try: base_front, _ = capture(scratch, 'base-image-frontend')
    finally: scratch_remove(scratch, STATIC_BASE_IMAGE)
    need(stable_manifest(old) == stable_manifest(base_front), 'entire-live-original-frontend-equals-canonical-base-bytes-owner-mode')
    old_headers = {}
    for n in ORDER:
        need(sha(git('show', BASE + ':' + APP + '/frontend/' + n)) == old[n]['sha256'], 'actual-old-entry-matches-reviewed-logical-base')
        code, headers, body = http(n); need(code == 200 and sha(body) == old[n]['sha256'], 'three-old-public-entries-match-private-backup')
        old_headers[n] = {k: headers[k] for k in ('etag', 'last-modified') if k in headers}; need(len(old_headers[n]) == 2, 'both-old-cache-validators')
    public_check(old)
    replacements = {n: git('show', TARGET + ':' + APP + '/frontend/' + n) for n in ORDER}
    mtime = max(int(time.time()), max(old[n]['mtime'] for n in ORDER) + 2); need(mtime <= int(time.time()) + 3, 'no-unbounded-future-cache-time')
    new = static_plan(old, replacements, mtime); bodies.update(replacements)
    tag, image = build_derivative(new, bodies)
    current, after = inventory(); need(current['Id'] == row['Id'] and before == after and host_files() == preserved and image_id(COMPOSE_TAG) == STATIC_BASE_IMAGE and code_probe(row['Id']) == live_code, 'prepare-all-live-runtime-config-code-preserved')
    p = {'base': BASE, 'head': HEAD, 'target': TARGET, 'tree': TREE, 'appTree': APP_TREE, 'hostBase': HOST_BASE, 'container': row['Id'], 'runtime': before, 'hostFiles': preserved, 'code': live_code, 'oldManifest': old, 'newManifest': new, 'oldHeaders': old_headers, 'durableTag': tag, 'durableImage': image, 'previousAliasImage': STATIC_BASE_IMAGE, 'compiledSourceUnchanged': COMPILED_SOURCE, 'backendSourceProof': startup_proof, 'baseImageRevisionLabelPreserved': labels.get('org.opencontainers.image.revision')}
    private(OUT / 'prepared.private.json', enc(p))
    return {'preparedSHA256': sha(enc(p)), 'durableImage': image, 'liveImage': LIVE_IMAGE, 'compiledSourceUnchanged': COMPILED_SOURCE, 'staticFileCount': sum(v['kind'] == 'file' for v in new.values()), 'runtimeNotRestarted': True, 'databaseReadOrWritten': False, 'allOtherStaticFilesPreserved': True}

def verify_current(p, name):
    row, rows = inventory(); need(row['Id'] == p['container'] and rows == p['runtime'] and host_files() == p['hostFiles'] and code_probe(row['Id']) == p['code'], 'same-container-all-runtime-env-binds-host-and-backend-packages-unchanged')
    actual, _ = capture(row['Id'], name); need(stable_manifest(actual) == stable_manifest(p['newManifest']) and all(actual[n]['mtime'] == p['newManifest'][n]['mtime'] for n in ORDER), 'actual-entire-static-union-owner-mode-and-new-cache-times-exact')
    return row, public_check(actual, p['oldHeaders'])

def deploy():
    source_check(); p = evidence('prepared.private.json', PREPARED_SHA256); row, rows = inventory()
    need(row['Id'] == p['container'] and rows == p['runtime'] and host_files() == p['hostFiles'] and code_probe(row['Id']) == p['code'], 'prepared-entire-runtime-host-code-no-drift')
    old, _ = capture(row['Id'], 'preapply-frontend'); need(old == p['oldManifest'] and image_id(COMPOSE_TAG) == p['previousAliasImage'] and image_id(p['durableTag']) == p['durableImage'], 'exact-original-static-and-unmodified-future-alias')
    bodies = {n: git('show', TARGET + ':' + APP + '/frontend/' + n) for n in ORDER}; need(static_plan(old, bodies, p['newManifest'][ORDER[0]]['mtime']) == p['newManifest'], 'sealed-only-three-file-plan')
    payload = {'stage': '/app/.pr1028-static-r2-' + TARGET, 'files': {n: {'old': old[n], 'next': p['newManifest'][n], 'body': base64.b64encode(bodies[n]).decode()} for n in ORDER}}
    private(OUT / 'deploy.reservation.private.json', enc({'target': TARGET, 'container': row['Id']}))
    need(json.loads(run(['docker', 'exec', '-i', '--user', '0', row['Id'], 'node', '-e', STAGE_NODE], data=enc(payload))) == {'staged': True, 'files': list(ORDER)}, 'private-owned-new-and-rollback-files-staged')
    while int(time.time()) < p['newManifest'][ORDER[0]]['mtime']: time.sleep(.1)
    # Any failure after this marker requires read-only reconciliation; never replay it.
    private(OUT / 'publication-attempted.private.json', enc({'stage': payload['stage'], 'order': list(ORDER), 'automaticReplay': False}))
    need(json.loads(run(['docker', 'exec', '-i', '--user', '0', row['Id'], 'node', '-e', PUBLISH_NODE], data=enc(payload))) == {'published': True, 'order': list(ORDER)}, 'three-known-static-paths-atomic-file-publication')
    _, checks = verify_current(p, 'after-publish-frontend')
    need(image_id(COMPOSE_TAG) == p['previousAliasImage'], 'future-canonical-alias-cas-before-commit')
    private(OUT / 'alias-attempted.private.json', enc({'old': p['previousAliasImage'], 'new': p['durableImage'], 'automaticReplay': False}))
    run(['docker', 'tag', p['durableImage'], COMPOSE_TAG]); need(image_id(COMPOSE_TAG) == p['durableImage'], 'durable-future-recreate-alias-promoted')
    deployed = {k: p[k] for k in ('base', 'head', 'target', 'tree', 'appTree', 'hostBase')}; deployed.update(preparedSHA256=PREPARED_SHA256, durableImage=p['durableImage'], previousAliasImage=p['previousAliasImage'], rollbackStageRetained=payload['stage'], checks=checks)
    private(OUT / 'deployed.private.json', enc(deployed))
    return {'preparedSHA256': PREPARED_SHA256, 'deployEvidenceSHA256': sha(enc(deployed)), 'durableImage': p['durableImage'], 'liveImage': LIVE_IMAGE, 'runtimeNotRestarted': True, 'databaseReadOrWritten': False, 'checks': checks, 'hostSourceCheckoutPerformed': False, 'compiledSourceUnchanged': COMPILED_SOURCE}

def verify():
    source_check(); p = evidence('prepared.private.json', PREPARED_SHA256); d = evidence('deployed.private.json', DEPLOY_SHA256)
    need(d['preparedSHA256'] == PREPARED_SHA256 and d['durableImage'] == p['durableImage'] and image_id(COMPOSE_TAG) == p['durableImage'], 'successful-deploy-prepare-chain-and-durable-alias')
    _, checks = verify_current(p, 'verify-frontend')
    return {'preparedSHA256': PREPARED_SHA256, 'deployEvidenceSHA256': DEPLOY_SHA256, 'durableImage': p['durableImage'], 'liveImage': LIVE_IMAGE, 'runtimeNotRestarted': True, 'databaseReadOrWritten': False, 'hostSourceCheckoutPerformed': False, 'compiledSourceUnchanged': COMPILED_SOURCE, 'checks': checks}

def main():
    need(EXECUTE is True and sys.argv[1:] == [PHASE] and PHASE in ('prepare', 'deploy', 'verify'), 'inert-canonical-helper')
    need(os.environ.get('RELEASE_BRANCH') == BRANCH and os.environ.get('RELEASE_ATTEMPT') == '1' and os.environ.get('RELEASE_MODE') == PHASE, 'fixed-first-attempt-scoped-transport')
    os.umask(0o077); result = {'phase': PHASE, 'base': BASE, 'head': HEAD, 'target': TARGET, 'tree': TREE, 'appTree': APP_TREE, 'hostBase': HOST_BASE, 'hostSourceCheckoutPerformed': False, 'success': False}
    try: result.update({'prepare': prepare, 'deploy': deploy, 'verify': verify}[PHASE]()); result['success'] = True
    except Exception as e: result.update(errorType=type(e).__name__, stage=STAGE, automaticMutationReplay=False, retainedPrivateEvidence=True)
    result['utc'] = datetime.datetime.now(datetime.timezone.utc).isoformat(); result['resultSHA256'] = sha(enc(result))
    result['sha256Wire'] = {k: [int(c, 16) for c in (v[7:] if v.startswith('sha256:') else v)] for k, v in result.items() if type(v) is str and re.fullmatch('(?:sha256:)?[a-f0-9]{64}|[a-f0-9]{40}', v)}
    print(json.dumps(result, sort_keys=True), flush=True); return 0 if result['success'] else 1
if __name__ == '__main__': sys.exit(main())
