"""User-priority Indo static release with host source checkout explicitly deferred.

prepare builds only the Vite stage and a durable derivative image; no live files change.
deploy copies immutable assets, atomically replaces index, and verifies before tagging.
No backend/container restart, SQL writes, maintenance flag, or mailbox operations.
"""
import datetime, hashlib, io, json, os, pathlib, re, shutil, stat, subprocess, sys, tarfile, time, urllib.request, urllib.error, urllib.parse

ROOT = pathlib.Path('/opt/rr-portal')
OUT = ROOT / 'deploy/backups/pr1023-priority-20261028'
APP = 'apps/印尼小组/印尼走货明细'
BASE = 'e63786d1157a29f0bbb7e8ca3e89e4c2c9163fe5'
HOST_BASE = '4b3d8f3e319e41dcc8720d759e1af0726a2b2381'
EXPECTED_BASE = 'e63786d1157a29f0bbb7e8ca3e89e4c2c9163fe5'
EXPECTED_HEAD = 'f80e98a04525341645eea1c1007cc088d66c72be'
EXPECTED_TREE = '7fe125a9a0c74096b40b15a12a18b54258aa040c'
OLD = '4b3d8f3e319e41dcc8720d759e1af0726a2b2381'
LIVE_IMAGE = 'sha256:ba2a99c9ff21311e22ede4f5ce46a49ffbcd298c77845681e3a9c881d6f157d2'
STATIC_BASE_IMAGE = 'sha256:ba2a99c9ff21311e22ede4f5ce46a49ffbcd298c77845681e3a9c881d6f157d2'
BRANCH = 'refs/heads/ops/pr-1023-20261028-static'
HEAD = 'f80e98a04525341645eea1c1007cc088d66c72be'
TARGET = '09b09cbf21b2dfb8518c58860fa33237d2123ed5'
APP_TREE = '739379a23f7372485e5e1665f922ffe45d4baebf'
TREE = '7fe125a9a0c74096b40b15a12a18b54258aa040c'
EXPECTED_APP_TREE = '739379a23f7372485e5e1665f922ffe45d4baebf'
EXPECTED_WEB_TREE = '58bb3719b912ffd69b4c3c36b2c2e46856a7eb1d'
OLD_APP_TREE = '8786d6f9143405a6fedca1a239529c01322dddc3'
BACKEND_TREE = 'b1f546bb7beb4eeb4c6f4e099b2768e5b75cbf25'
TEMPLATES = ('template-customs.xlsx', 'template-customs-rri.xlsx', 'template-customs-rrm.xlsx')
TEMPLATE_PROOFS = {'template-customs.xlsx': (144045, '24ea412592b3b656a872950c8a3985813fb3dd647c26df495bc882791e9bcaf6'),
                   'template-customs-rri.xlsx': (43375953, 'cb37324b0b4d659d55a8b2ddf012f0b6bbef8b1ee7f368448b3e0ad0fff23647'),
                   'template-customs-rrm.xlsx': (835559, '21fa65679165883c8ed9f100af96c581d79a35da9644464548c765e10f1d2984')}
PHASE = 'prepare'
EXECUTE = True
PREPARED_SHA256 = ''
PUBLIC = 'http://127.0.0.1/indo-shipping/'
STAGE = 'entry'
SERIAL = 0
COMPOSE_TAG = 'rr-portal-indo-shipping:latest'
RECOVERY = {}

def need(v, label):
    global STAGE
    STAGE = label
    if not v: raise RuntimeError(label)

def enc(v): return json.dumps(v, sort_keys=True, ensure_ascii=True, separators=(',', ':')).encode()
def sha(v): return hashlib.sha256(v).hexdigest()
def run(args, data=None, timeout=180):
    global STAGE, SERIAL
    STAGE = 'command-' + pathlib.Path(args[0]).name; SERIAL += 1
    p = subprocess.run(args, input=data, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout, cwd=ROOT)
    if OUT.is_dir():
        private(OUT / ('%s-%03d.stdout.private' % (PHASE, SERIAL)), p.stdout)
        private(OUT / ('%s-%03d.stderr.private' % (PHASE, SERIAL)), p.stderr)
    need(p.returncode == 0, 'command-' + pathlib.Path(args[0]).name)
    return p.stdout

def private(path, data):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'wb') as f: f.write(data); f.flush(); os.fsync(f.fileno())

def git(*args): return run(['git', '-C', str(ROOT), '-c', 'core.hooksPath=/dev/null', *args])

def safe_relative(name):
    p = pathlib.PurePosixPath(name)
    return type(name) is str and bool(name) and str(p) == name and not p.is_absolute() and '..' not in p.parts and '\\' not in name and all(ord(c) >= 32 for c in name)

def target_unchanged(before, after, cid):
    need(cid in before and cid in after and before[cid] == after[cid], 'same-target-runtime-without-restart')

def image_id(name, optional=False):
    p = subprocess.run(['docker', 'image', 'inspect', name], stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=30, cwd=ROOT)
    if optional and p.returncode != 0:
        need(b'No such image:' in p.stderr or b'No such object:' in p.stderr, 'only-known-absent-local-image')
        return None
    need(p.returncode == 0, 'local-image-inspect'); rows = json.loads(p.stdout)
    need(len(rows) == 1 and re.fullmatch('sha256:[a-f0-9]{64}', rows[0]['Id']), 'one-immutable-local-image')
    return rows[0]['Id']

def scratch_create(image):
    config = json.loads(run(['docker', 'image', 'inspect', image]))[0]; need(config['Id'] == image and not config['Config'].get('Volumes'), 'scratch-image-without-volumes')
    cid = run(['docker', 'create', '--network', 'none', '--restart', 'no', '--log-driver', 'none', '--entrypoint', '/bin/true', image]).decode().strip()
    need(re.fullmatch('[a-f0-9]{64}', cid), 'own-full-scratch-id')
    return cid

def scratch_remove(cid, image):
    r = json.loads(run(['docker', 'inspect', cid]))[0]
    need(r['Id'] == cid and r['Image'] == image and not r['State']['Running'] and r['State']['Pid'] == 0 and r['State']['StartedAt'].startswith('0001-') and not r['Mounts'] and r['HostConfig']['NetworkMode'] == 'none', 'remove-only-own-never-started-scratch')
    run(['docker', 'rm', cid])

def extract_source(blob, dest):
    # Manual regular-only extraction works on server Python 3.10 as well as 3.12.
    with tarfile.open(fileobj=io.BytesIO(blob)) as archive:
        members = archive.getmembers(); need(len(members) <= 10000, 'bounded-source-archive')
        names = set(); total = 0
        for member in members:
            name = member.name.rstrip('/'); need(safe_relative(name) and name not in names, 'unique-safe-source-path'); names.add(name)
            need(member.isdir() or member.isfile(), 'only-regular-source-files-and-directories')
            need((member.isdir() and (name == APP or APP.startswith(name + '/') or name.startswith(APP + '/'))) or (member.isfile() and name.startswith(APP + '/')), 'source-archive-app-only')
            total += member.size; need(member.size <= 64 * 1024**2 and total <= 256 * 1024**2, 'bounded-source-archive-bytes')
        for member in members:
            p = dest / member.name
            if member.isdir(): p.mkdir(mode=0o755, parents=True, exist_ok=True)
            else:
                p.parent.mkdir(mode=0o755, parents=True, exist_ok=True)
                data = archive.extractfile(member).read(); need(len(data) == member.size, 'complete-source-member')
                private(p, data); p.chmod(member.mode & 0o755)

def index_metadata(cid):
    value = run(['docker', 'exec', '--user', '0', cid, 'stat', '-c', '%f|%u|%g|%a|%Y|%s', '/app/wwwroot/index.html']).decode().strip()
    need(re.fullmatch('[a-f0-9]+[|][0-9]+[|][0-9]+[|][0-7]+[|][0-9]+[|][0-9]+', value), 'typed-index-metadata')
    kind, uid, gid, mode, mtime, size = value.split('|')
    need(stat.S_ISREG(int(kind, 16)) and int(mode, 8) == 0o644, 'regular-readable-index')
    return {'uid': int(uid), 'gid': int(gid), 'mode': int(mode, 8), 'mtime': int(mtime), 'size': int(size)}

def static_plan(old, new):
    need(new.get('index.html') != old.get('index.html'), 'new-frontend-entry')
    need(all(name in old and name in new and old[name] == new[name] for name in TEMPLATES), 'all-three-original-templates-unchanged')
    need(all(n == 'index.html' or (n in old and h == old[n]) or (n not in old and n.startswith('assets/')) for n, h in new.items()), 'only-new-assets-and-index-no-existing-resource-overwrite')
    additions = sorted(n for n in new if n != 'index.html' and n not in old)
    need(all(str(pathlib.PurePosixPath(n).parent) == 'assets' for n in additions), 'flat-vite-asset-layout-before-any-live-write')
    return additions

def remote_index(cid):
    blob = run(['docker', 'exec', '--user', '0', cid, 'cat', '/app/wwwroot/index.html'])
    need(len(blob) <= 1024**2, 'bounded-observed-index'); return sha(blob)

def inventory():
    records = []
    for service in ('indo-shipping', 'db'):
        ids = run(['docker', 'ps', '-aq', '--no-trunc', '--filter', 'label=com.docker.compose.project=rr-portal', '--filter', 'label=com.docker.compose.service=' + service]).decode().split()
        need(len(ids) == 1 and re.fullmatch('[a-f0-9]{64}', ids[0]), 'one-known-target-' + service)
        inspected = json.loads(run(['docker', 'inspect', ids[0]])); need(len(inspected) == 1 and inspected[0]['Id'] == ids[0], 'same-inspected-' + service); records.append(inspected[0])
    r = records[0]
    need(r['State']['Running'] and not r['State']['OOMKilled'] and r['State'].get('Health', {}).get('Status') == 'healthy', 'indo-running-healthy')
    need(r['Image'] == LIVE_IMAGE and not r['Mounts'], 'expected-live-backend-image-no-mounts')
    rows = {v['Id']: {'image': v['Image'], 'started': v['State']['StartedAt'], 'restartCount': v['RestartCount'], 'running': v['State']['Running'], 'pid': v['State']['Pid'], 'config': sha(enc(dict(v['Config'], Env=sorted(v['Config'].get('Env') or [])))), 'hostConfig': sha(enc(v['HostConfig'])), 'mounts': sha(enc(sorted(v['Mounts'], key=enc)))} for v in records}
    return r, rows, records

def host_files():
    result = {}
    shared = ['docker-compose.cloud.yml', 'frontend/index.cloud.html', 'nginx/nginx.cloud.conf',
              'deploy/update-server.sh', 'deploy/service-maintenance.sh']
    dirty = [name for name in git('diff', '--name-only', '-z').decode().split(chr(0)) if name]
    need(len(dirty) == len(set(dirty)) == 4, 'same-four-existing-host-dirty-paths')
    names = ['.env.cloud.production', *shared, *dirty]
    git('diff', '--cached', '--quiet')
    for name in sorted(set(names)):
        need(safe_relative(name), 'safe-preserved-host-path')
        p = ROOT / name
        need(not p.is_symlink() and p.is_file(), 'regular-preserved-host-file')
        body = p.read_bytes()
        if name in shared:
            need(body == git('show', HOST_BASE + ':' + name), 'all-shared-config-bytes-still-host-base')
        value = p.stat()
        result[name] = {'sha256': sha(body), 'mode': stat.S_IMODE(value.st_mode), 'uid': value.st_uid, 'gid': value.st_gid}
    return result


def files(folder):
    result = {}; total = 0
    for p in sorted(folder.rglob('*')):
        need(not p.is_symlink() and (p.is_dir() or p.is_file()), 'regular-static-files-only')
        if p.is_file():
            name = p.relative_to(folder).as_posix(); size = p.stat().st_size; total += size
            need(safe_relative(name) and size <= 64 * 1024**2 and total <= 256 * 1024**2, 'bounded-safe-static-files')
            result[name] = sha(p.read_bytes())
    need('index.html' in result and len(result) < 1000, 'bounded-static-manifest')
    return result

def copy_web(cid, name):
    dest = OUT / name; dest.mkdir(mode=0o700)
    run(['docker', 'cp', cid + ':/app/wwwroot/.', str(dest)])
    files(dest)
    return dest

def preserve_templates(old, prepared, old_manifest):
    # Dockerignore excludes the two factory templates. Restore only absent files
    # after all three OLD/BASE/TARGET immutable Git blobs and live backups agree.
    proofs = {}; missing = []
    for name in TEMPLATES:
        expected_size, expected_sha = TEMPLATE_PROOFS[name]; source = APP + '/web/public/' + name
        blobs, sizes = [], []
        for ref in (OLD, BASE, TARGET):
            entry = git('ls-tree', '-z', ref, '--', source)
            match = re.fullmatch(b'100644 blob ([a-f0-9]{40})\t' + re.escape(source.encode()) + b'\0', entry)
            need(match is not None, 'regular-reviewed-template-git-blob'); blobs.append(match[1].decode())
            size = git('cat-file', '-s', ref + ':' + source).decode().strip()
            need(size.isdigit(), 'typed-template-blob-size'); sizes.append(int(size))
        need(len(set(blobs)) == 1 and sizes == [expected_size] * 3, 'old-base-target-template-blob-and-size-identical')
        body = git('show', OLD + ':' + source)
        need(len(body) == expected_size and sha(body) == expected_sha
             and hashlib.sha1(b'blob ' + str(len(body)).encode() + b'\0' + body).hexdigest() == blobs[0], 'template-git-size-sha256-and-blob-id-exact')
        backup = old / name
        need(backup.is_file() and not backup.is_symlink() and backup.stat().st_size == expected_size
             and sha(backup.read_bytes()) == old_manifest.get(name) == expected_sha, 'live-old-template-equals-three-pinned-git-sources')
        dest = prepared / name
        need(not dest.is_symlink(), 'prepared-template-not-symlink')
        if dest.exists():
            need(dest.is_file() and dest.stat().st_size == expected_size and sha(dest.read_bytes()) == expected_sha, 'fresh-dist-template-cannot-conflict')
        else: missing.append(name)
        proofs[name] = {'blob': blobs[0], 'size': expected_size, 'sha256': expected_sha, 'restoredMissingDistFile': not dest.exists()}
    # All proofs precede any copy; never replace a Vite output or an existing asset.
    for name in missing:
        dest = prepared / name; private(dest, (old / name).read_bytes()); dest.chmod(0o644)
        need(sha(dest.read_bytes()) == TEMPLATE_PROOFS[name][1], 'restored-template-copy-exact')
    return proofs

def http(path='', headers=None):
    need(not path.startswith('/') and '..' not in pathlib.PurePosixPath(path).parts and '?' not in path and '#' not in path, 'fixed-relative-public-route')
    req = urllib.request.Request(PUBLIC + urllib.parse.quote(path, safe='/'), headers={'Cache-Control': 'no-cache', **(headers or {})})
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *args, **kwargs): return None
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    try:
        with opener.open(req, timeout=20) as r:
            body = r.read(64 * 1024**2 + 1); need(len(body) <= 64 * 1024**2, 'bounded-public-static-response')
            return r.status, dict(r.headers), body
    except urllib.error.HTTPError as e:
        try: return e.code, dict(e.headers), e.read(1024)
        finally: e.close()

def source_check():
    need(all(re.fullmatch('[a-f0-9]{40}', value or '') for value in (BASE, HEAD, TARGET, TREE, APP_TREE))
         and BASE == EXPECTED_BASE and HEAD == EXPECTED_HEAD and TREE == EXPECTED_TREE and OLD == HOST_BASE, 'bound-priority-source')
    need(git('symbolic-ref', '--short', 'HEAD').decode().strip() == 'main'
         and git('rev-parse', 'HEAD').decode().strip() == HOST_BASE, 'canonical-host-head-kept-at-pre-invoice-base')
    need(git('merge-base', HOST_BASE, BASE).decode().strip() == HOST_BASE, 'host-base-is-ancestor-of-logical-pr-base')
    git('fetch', '--no-write-fetch-head', 'origin', '+refs/heads/main:refs/remotes/origin/main')
    need(git('rev-parse', 'origin/main').decode().strip() == TARGET and git('rev-parse', TARGET + '^{tree}').decode().strip() == TREE, 'exact-merged-main-tree')
    need(git('rev-parse', TARGET + ':' + APP).decode().strip() == APP_TREE == EXPECTED_APP_TREE == git('rev-parse', HEAD + ':' + APP).decode().strip(), 'reviewed-app-tree')
    need(git('rev-parse', BASE + ':' + APP).decode().strip() == OLD_APP_TREE == git('rev-parse', OLD + ':' + APP).decode().strip(), 'accepted-pr1021-old-app-tree')
    need(all(git('rev-parse', ref + ':' + APP + '/src').decode().strip() == BACKEND_TREE for ref in (OLD, BASE, TARGET, HEAD)), 'accepted-pr1021-backend-tree-unchanged')
    need(all(git('rev-parse', ref + ':' + APP + '/web').decode().strip() == EXPECTED_WEB_TREE for ref in (TARGET, HEAD)), 'reviewed-web-tree')
    changed = git('diff', '--name-only', '-z', BASE, TARGET).decode().rstrip('\0').split('\0')
    expected = {APP + '/web/src/' + name for name in ('components/ShipmentNumberCell.tsx', 'components/ShipmentSheetTable.tsx', 'pages/ShipmentsPage.tsx',
                'utils/shipmentConsolidationSave.test.ts', 'utils/shipmentMergedEditor.test.ts', 'utils/shipmentMergedEditor.ts', 'utils/shipmentSheetFlow.test.ts')}
    need(set(changed) == expected, 'exact-seven-reviewed-frontend-files')

def prepare():
    need(not OUT.exists() and not OUT.is_symlink(), 'one-fresh-prepare'); OUT.mkdir(mode=0o700)
    need(git('symbolic-ref', '--short', 'HEAD').decode().strip() == 'main' and git('rev-parse', 'HEAD').decode().strip() == HOST_BASE, 'unchanged-canonical-priority-host-base')
    source_check(); r, rows, records = inventory(); preserved = host_files()
    need(image_id(COMPOSE_TAG) == STATIC_BASE_IMAGE, 'accepted-pr1021-full-future-recreation-image')
    private(OUT / 'runtime.private.json', enc(records)); private(OUT / 'environment.private', (ROOT / '.env.cloud.production').read_bytes())
    old = copy_web(r['Id'], 'old-wwwroot'); old_manifest = files(old); old_meta = index_metadata(r['Id'])
    status, headers, body = http()
    need(status == 200 and sha(body) == old_manifest['index.html'], 'live-old-index-matches-backup')
    dbs = [x for x in records if (x['Config'].get('Labels') or {}).get('com.docker.compose.project') == 'rr-portal' and (x['Config'].get('Labels') or {}).get('com.docker.compose.service') == 'db']
    need(len(dbs) == 1 and dbs[0]['State']['Running'], 'existing-postgres')
    dump = run(['docker', 'exec', dbs[0]['Id'], 'sh', '-c', 'exec pg_dump -Fc --no-owner --no-acl --schema=indo_shipping -U "${POSTGRES_USER:-rrportal}" -d "${POSTGRES_DB:-rrportal}"'], timeout=120)
    need(dump[:5] == b'PGDMP', 'valid-readonly-indo-dump'); private(OUT / 'indo_shipping.dump', dump)
    src = OUT / 'source'; src.mkdir(mode=0o700)
    extract_source(git('-c', 'tar.umask=0022', 'archive', TARGET, APP), src)
    build_tag = 'rrportal-indo-pr1023-frontend:' + TARGET
    run(['docker', 'build', '--target', 'frontend', '--build-arg', 'VITE_BASE_PATH=/indo-shipping/', '-t', build_tag, str(src / APP)], timeout=1500)
    frontend_image = image_id(build_tag); scratch = scratch_create(frontend_image)
    try:
        prepared = OUT / 'prepared-wwwroot'; prepared.mkdir(mode=0o700)
        run(['docker', 'cp', scratch + ':/src/web/dist/.', str(prepared)])
    finally: scratch_remove(scratch, frontend_image)
    template_proofs = preserve_templates(old, prepared, old_manifest)
    new_manifest = files(prepared)
    additions = static_plan(old_manifest, new_manifest)
    # Equal length avoids the narrow sendfile window using the previous index's length.
    need((prepared / 'index.html').stat().st_size == (old / 'index.html').stat().st_size, 'equal-index-byte-length')
    # Isolate the daemon context: no runtime/env/dump/log/backup can enter it.
    image_context = OUT / 'image-context'; image_context.mkdir(mode=0o700)
    merged = image_context / 'wwwroot'; shutil.copytree(old, merged); shutil.copytree(prepared, merged, dirs_exist_ok=True)
    base_alias = 'rrportal-indo-pr1023-backend:' + STATIC_BASE_IMAGE.split(':')[1]
    previous_alias = image_id(base_alias, optional=True); need(previous_alias in (None, STATIC_BASE_IMAGE), 'own-base-alias-not-reassigned')
    run(['docker', 'tag', STATIC_BASE_IMAGE, base_alias]); need(image_id(base_alias) == STATIC_BASE_IMAGE, 'frozen-local-build-base')
    base_image = json.loads(run(['docker', 'image', 'inspect', STATIC_BASE_IMAGE]))[0]
    base_scratch = scratch_create(STATIC_BASE_IMAGE)
    try: base_web = copy_web(base_scratch, 'base-image-wwwroot')
    finally: scratch_remove(base_scratch, STATIC_BASE_IMAGE)
    need(files(base_web) == old_manifest, 'live-original-static-files-match-pinned-immutable-image')
    dockerfile = ('FROM ' + base_alias + '\nCOPY --chown=app:app wwwroot/ /app/wwwroot/\nLABEL org.opencontainers.image.revision="' + TARGET + '" io.rr-portal.backend-image="' + LIVE_IMAGE + '" io.rr-portal.frontend-app-tree="' + APP_TREE + '"\n').encode()
    private(image_context / 'Dockerfile', dockerfile)
    need(all(p == image_context / 'Dockerfile' or p == merged or merged in p.parents for p in image_context.rglob('*')), 'public-only-derivative-build-context')
    durable_tag = 'rrportal-indo-pr1023:' + TARGET
    run(['docker', 'build', '--pull=false', '-t', durable_tag, str(image_context)], timeout=300)
    derivative = json.loads(run(['docker', 'image', 'inspect', durable_tag]))[0]; image = derivative['Id']
    need(image_id(base_alias) == STATIC_BASE_IMAGE and derivative['Architecture'] == base_image['Architecture'] and derivative['Os'] == base_image['Os'] and derivative['RootFS']['Layers'][:len(base_image['RootFS']['Layers'])] == base_image['RootFS']['Layers'], 'derivative-retains-actual-base-layers-and-platform')
    before_config, after_config = dict(base_image['Config']), dict(derivative['Config']); before_labels = before_config.pop('Labels', None) or {}; after_labels = after_config.pop('Labels', None) or {}
    before_config.pop('Image', None); after_config.pop('Image', None)  # Builder parent metadata, not a runtime instruction.
    need(before_config == after_config and after_labels == dict(before_labels, **{'org.opencontainers.image.revision': TARGET, 'io.rr-portal.backend-image': LIVE_IMAGE, 'io.rr-portal.frontend-app-tree': APP_TREE}), 'derivative-only-static-files-and-explicit-source-labels')
    # Read back the durable image to prove it contains the whole old+new dependency graph.
    scratch = scratch_create(image)
    try: image_web = copy_web(scratch, 'image-verified-wwwroot')
    finally: scratch_remove(scratch, image)
    need(files(image_web) == files(merged), 'durable-image-static-files-exact')
    _, after, _ = inventory(); target_unchanged(rows, after, r['Id']); need(host_files() == preserved, 'prepare-host-files-preserved')
    service = json.loads(run(['docker', 'compose', '-p', 'rr-portal', '-f', str(ROOT / 'docker-compose.cloud.yml'), '--env-file', str(ROOT / '.env.cloud.production'), 'config', '--format', 'json']))['services']['indo-shipping']
    need(type(service.get('build')) is dict and service['build'].get('dockerfile', 'Dockerfile') == 'Dockerfile' and service.get('image') in (None, 'rr-portal-indo-shipping', COMPOSE_TAG), 'known-compose-build-service-and-default-image-tag')
    old_headers = {k.lower(): v for k, v in headers.items() if k.lower() in ('etag', 'last-modified')}; need(set(old_headers) == {'etag', 'last-modified'}, 'both-old-index-cache-validators-recorded')
    data = {'base': BASE, 'hostBase': HOST_BASE, 'sourceCheckoutDeferredToPendingInvoice': True, 'target': TARGET, 'tree': TREE, 'head': HEAD, 'appTree': APP_TREE, 'container': r['Id'], 'runtime': rows, 'hostFiles': preserved, 'oldManifest': old_manifest, 'newManifest': new_manifest, 'templateProofs': template_proofs, 'newAssets': additions, 'oldHeaders': old_headers, 'oldIndexMetadata': old_meta, 'composeTag': COMPOSE_TAG, 'composeTagBefore': image_id(COMPOSE_TAG, optional=True), 'originalContainerImageName': r['Config']['Image'], 'durableTag': durable_tag, 'durableImage': image, 'imageContextManifest': files(merged), 'dumpSHA256': sha(dump)}
    private(OUT / 'prepared.private.json', enc(data))
    return {'preparedSHA256': sha(enc(data)), 'durableImage': image, 'newFileCount': len(new_manifest), 'databaseDumpReadOnly': True, 'liveRuntimeUnchanged': True,
            'hostSourceHead': HOST_BASE, 'logicalPrBase': BASE, 'sourceCheckoutDeferredToPendingInvoice': True}

def deploy():
    global RECOVERY
    need(OUT.is_dir() and not OUT.is_symlink() and stat.S_IMODE(OUT.stat().st_mode) == 0o700 and re.fullmatch('[a-f0-9]{64}', PREPARED_SHA256 or ''), 'private-prepared-archive-and-bound-checksum')
    raw = (OUT / 'prepared.private.json').read_bytes(); need(sha(raw) == PREPARED_SHA256, 'exact-prepared-evidence')
    p = json.loads(raw); need(p['base'] == BASE and p['hostBase'] == HOST_BASE and p['sourceCheckoutDeferredToPendingInvoice'] is True and p['target'] == TARGET and p['tree'] == TREE and p['head'] == HEAD and p['appTree'] == APP_TREE, 'prepared-source')
    source_check(); r, rows, _ = inventory(); need(r['Id'] == p['container'] and host_files() == p['hostFiles'], 'unchanged-prepared-live-target-and-host-files'); target_unchanged(p['runtime'], rows, r['Id'])
    need(files(OUT / 'old-wwwroot') == p['oldManifest'] and files(OUT / 'prepared-wwwroot') == p['newManifest'], 'sealed-old-and-new-static-files')
    need(static_plan(p['oldManifest'], p['newManifest']) == p['newAssets'] and (OUT / 'prepared-wwwroot/index.html').stat().st_size == p['oldIndexMetadata']['size'], 'sealed-add-only-plan-and-equal-index-length')
    need(files(copy_web(r['Id'], 'preapply-wwwroot')) == p['oldManifest'], 'no-live-static-drift')
    need(image_id(p['durableTag']) == p['durableImage'] and p['composeTag'] == COMPOSE_TAG and image_id(COMPOSE_TAG, optional=True) == p['composeTagBefore'], 'durable-image-and-future-compose-tag-pin')
    need(index_metadata(r['Id']) == p['oldIndexMetadata'], 'same-old-index-metadata-before-write')
    index_time = max(int(time.time()), p['oldIndexMetadata']['mtime'] + 2)
    need(index_time <= int(time.time()) + 3, 'no-unbounded-future-index-cache-time')
    while int(time.time()) < index_time: time.sleep(0.1)
    private(OUT / 'deploy.reservation', enc({'target': TARGET, 'utc': datetime.datetime.now(datetime.timezone.utc).isoformat()}))
    stage = '/app/.pr1023-priority-static-' + TARGET
    next_index, old_index = stage + '/new/index.html', stage + '/old-index'
    index_attempted = False; tag_attempted = False
    try:
        # No extraction into served paths. The private stage contains public files only.
        run(['docker', 'exec', '--user', '0', r['Id'], 'sh', '-c', 'set -eu; test ! -e "$1"; test ! -L "$1"; mkdir -m 700 "$1"; mkdir -m 700 "$1/new"', '_', stage])
        run(['docker', 'cp', str(OUT / 'prepared-wwwroot') + '/.', r['Id'] + ':' + stage + '/new'])
        run(['docker', 'cp', str(OUT / 'old-wwwroot/index.html'), r['Id'] + ':' + old_index])
        paths = [stage + '/new/' + n for n in sorted(p['newManifest'])] + [old_index]
        run(['docker', 'exec', '--user', '0', r['Id'], 'sh', '-c', 'set -eu; owner=$1; shift; for f do test -f "$f"; test ! -L "$f"; chown "$owner" "$f"; chmod 644 "$f"; done', '_', '%d:%d' % (p['oldIndexMetadata']['uid'], p['oldIndexMetadata']['gid']), *paths])
        sums = run(['docker', 'exec', '--user', '0', r['Id'], 'sha256sum', '--', *paths]).decode().splitlines()
        expected = {stage + '/new/' + n: h for n, h in p['newManifest'].items()}; expected[old_index] = p['oldManifest']['index.html']
        need(len(sums) == len(expected) and {line.split('  ', 1)[1]: line.split('  ', 1)[0] for line in sums} == expected, 'all-staged-static-and-rollback-bytes-exact')
        for n in p['newAssets']:
            destination = '/app/wwwroot/' + n; parent = str(pathlib.PurePosixPath(destination).parent)
            # ln has exclusive destination creation; an existing asset is never truncated.
            run(['docker', 'exec', '--user', '0', r['Id'], 'sh', '-c', 'set -eu; test -d /app/wwwroot/assets; test ! -L /app/wwwroot/assets; test "$3" = /app/wwwroot/assets; ln -- "$1" "$2"', '_', stage + '/new/' + n, destination, parent])
        need(remote_index(r['Id']) == p['oldManifest']['index.html'], 'old-index-still-exact-before-commit')
        run(['docker', 'exec', '--user', '0', r['Id'], 'touch', '-d', '@' + str(index_time), next_index])
        index_attempted = True
        run(['docker', 'exec', '--user', '0', r['Id'], 'mv', '-fT', next_index, '/app/wwwroot/index.html'])
        checks = verify_public(p)
        _, after, _ = inventory(); target_unchanged(rows, after, r['Id']); need(host_files() == p['hostFiles'], 'no-host-config-change')
        # The newer logical main contains pending invoice shared configuration.
        # Publish only the reviewed Indo frontend; do not checkout that main.
        need(git('rev-parse', 'HEAD').decode().strip() == HOST_BASE and host_files() == p['hostFiles'],
             'host-source-kept-at-base-and-all-shared-config-preserved')
        need(image_id(COMPOSE_TAG, optional=True) == p['composeTagBefore'], 'future-compose-tag-unchanged-before-commit')
        tag_attempted = True
        run(['docker', 'tag', p['durableImage'], p['composeTag']])
        need(image_id(COMPOSE_TAG) == p['durableImage'], 'durable-future-compose-tag-committed')
        need(git('rev-parse', 'HEAD').decode().strip() == HOST_BASE and host_files() == p['hostFiles'], 'post-tag-host-source-and-config-still-deferred')
        private(OUT / 'deployed.private.json', enc({'target': TARGET, 'frontendVersion': TARGET, 'hostSourceHead': HOST_BASE,
                'logicalPrBase': BASE, 'sourceCheckoutDeferredToPendingInvoice': True, 'hostSourceCheckoutPerformed': False, 'runtime': after, 'checks': checks, 'liveBackendImage': LIVE_IMAGE, 'durableImageForFutureRecreate': p['durableImage'], 'rollbackStageRetained': stage, 'utc': datetime.datetime.now(datetime.timezone.utc).isoformat()}))
        # No fallible cleanup after the commit receipt; retain only our public rollback stage.
        return {'frontendVersion': TARGET, 'liveBackendImage': LIVE_IMAGE, 'durableImage': p['durableImage'], 'runtimeNotRestarted': True, 'otherContainersNotOperated': True, 'configurationUnchanged': True, 'checks': checks, 'logicalPrBase': BASE, 'hostSourceHead': HOST_BASE,
                'sourceCheckoutDeferredToPendingInvoice': True, 'hostSourceCheckoutPerformed': False}
    except BaseException:
        failure_stage = STAGE
        RECOVERY = {'indexCommitAttempted': index_attempted, 'tagCommitAttempted': tag_attempted, 'automaticRetryPerformed': False, 'newAssetsRetainedForInFlightClients': True,
                    'sourceCheckoutDeferredToPendingInvoice': True, 'hostSourceCheckoutPerformed': False}
        try:
            current, current_rows, _ = inventory(); need(current['Id'] == r['Id'], 'only-original-container-recovery'); target_unchanged(rows, current_rows, r['Id'])
            observed = remote_index(r['Id']); RECOVERY['observedIndexIsOld'] = observed == p['oldManifest']['index.html']; RECOVERY['observedIndexIsNew'] = observed == p['newManifest']['index.html']
            if index_attempted and observed == p['newManifest']['index.html']:
                rollback_time = max(int(time.time()), index_time + 2)
                run(['docker', 'exec', '--user', '0', r['Id'], 'touch', '-d', '@' + str(rollback_time), old_index])
                try: run(['docker', 'exec', '--user', '0', r['Id'], 'mv', '-fT', old_index, '/app/wwwroot/index.html'])
                except (subprocess.TimeoutExpired, RuntimeError): pass
                RECOVERY['oldIndexRestored'] = remote_index(r['Id']) == p['oldManifest']['index.html']
            else: RECOVERY['oldIndexRestored'] = observed == p['oldManifest']['index.html']
            if tag_attempted:
                actual = image_id(COMPOSE_TAG, optional=True)
                need(actual in (p['durableImage'], p['composeTagBefore']), 'no-unknown-tag-overwrite-during-recovery')
                if actual == p['durableImage']:
                    if p['composeTagBefore'] is None: run(['docker', 'image', 'rm', '--no-prune', COMPOSE_TAG])
                    else: run(['docker', 'tag', p['composeTagBefore'], COMPOSE_TAG])
                RECOVERY['oldComposeTagRestored'] = image_id(COMPOSE_TAG, optional=True) == p['composeTagBefore']
            RECOVERY['serverGitHead'] = git('rev-parse', 'HEAD').decode().strip()
            RECOVERY['sourceHeadNeverReset'] = True
            RECOVERY['hostHeadObservedAtExpectedBase'] = RECOVERY['serverGitHead'] == HOST_BASE
        except BaseException as error: RECOVERY.update(recoveryUnproven=True, recoveryExceptionType=type(error).__name__)
        private(OUT / 'failed-deploy-recovery.private.json', enc(RECOVERY))
        globals()['STAGE'] = failure_stage
        raise

def verify_public(p):
    status, headers, body = http(); need(status == 200 and sha(body) == p['newManifest']['index.html'], 'new-public-index-exact')
    for name, expected_hash in dict(p['oldManifest'], **p['newManifest']).items():
        if name.startswith('assets/') or name in TEMPLATES:
            code, _, content = http(name); need(code == 200 and sha(content) == expected_hash, 'all-old-and-new-assets-public-exact')
    for key, request_header in (('etag', 'If-None-Match'), ('last-modified', 'If-Modified-Since')):
        code, _, content = http(headers={request_header: p['oldHeaders'][key]}); need(code == 200 and sha(content) == p['newManifest']['index.html'], 'old-browser-cache-revalidated-' + key)
    code, _, content = http('purchase'); need(code == 200 and sha(content) == p['newManifest']['index.html'], 'spa-fallback-new-index-without-provider-restart')
    code, _, _ = http('api/health'); need(code == 200, 'backend-health')
    code, _, _ = http('api/purchase'); need(code == 401, 'anonymous-purchase-protected')
    return {'index200': True, 'allOldAndNewAssets200AndExact': True, 'allThreeTemplates200AndExact': True, 'oldConditionalRequests200': True, 'spaFallback200': True, 'health200': True, 'anonymousPurchase401': True}

def main():
    need(EXECUTE is True and sys.argv[1:] == [PHASE] and PHASE in ('prepare', 'deploy'), 'inert-phase-gate')
    need(os.environ.get('RELEASE_BRANCH') == BRANCH and os.environ.get('RELEASE_ATTEMPT') == '1' and os.environ.get('RELEASE_MODE') == PHASE, 'fixed-branch-first-attempt-phase')
    os.umask(0o077)
    result = {'phase': PHASE, 'base': BASE, 'target': TARGET, 'tree': TREE, 'head': HEAD, 'appTree': APP_TREE, 'success': False}
    try:
        result.update(prepare() if PHASE == 'prepare' else deploy()); result['success'] = True
    except Exception as e:
        result.update(errorType=type(e).__name__, stage=STAGE)
        if RECOVERY: result['failedDeployRecovery'] = RECOVERY
    result['utc'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    result['resultSHA256'] = sha(enc(result))
    # Nibbles remain machine verifiable even when GitHub masks a short secret substring.
    result['sha256Wire'] = {k: [int(c, 16) for c in (v.split(':', 1)[1] if v.startswith('sha256:') else v)] for k, v in result.items() if type(v) is str and re.fullmatch('(?:sha256:)?[a-f0-9]{64}|[a-f0-9]{40}', v)}
    print(json.dumps(result, sort_keys=True), flush=True)
    return 0 if result['success'] else 1

if __name__ == '__main__': sys.exit(main())
