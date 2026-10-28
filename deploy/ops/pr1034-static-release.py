"""Inert PR1034 Indo frontend-only hot publication and durable static derivative.
Same original CID/backend compiled at705; no SQL, keyring access, restart or host checkout.
All final application pins remain blank until source review finishes.
"""
import contextlib,copy,datetime,hashlib,importlib.util,io,json,os,pathlib,re,shutil,stat,subprocess,sys,tarfile,time,urllib.request,urllib.error,urllib.parse
ROOT=pathlib.Path('/opt/rr-portal')
ARCHIVE_ROOT=ROOT/'deploy/backups/pr1034-indo-static-20261028'
OUT=None
PREPARE_OUT=ARCHIVE_ROOT/'prepare'
BASE='70590f6d0dc1c691cfcc7c6b85c67e4a3574e571'
EXPECTED_BASE=BASE
BACKEND_REVISION=BASE
HOST_BASE='f22fbffa1789234fe1c78bf776f4dcb3fe867d0c'
OLD=BASE
SOURCE_APP_TREE='e61f7499901c28f52607285c65d0c1ff6d5fad05'
HEAD='3017009ddf2a3dd570adb3a960274de2f990187e'
APP_TREE='6a52ba4b36d30895b8cbfd43c51ac5a8fad349cf'
EXPECTED_TARGET='f22fbffa1789234fe1c78bf776f4dcb3fe867d0c'
EXPECTED_TREE='97f1a01c37dc8c1219b1af0b56cc1c8e2854d1eb'
REVIEWED_PATHS=('web/src/components/ShipmentImport.tsx', 'web/src/components/ShipmentSheetTable.tsx', 'web/src/pages/ShipmentsPage.tsx', 'web/src/utils/customsExport.ts', 'web/src/utils/shipmentConsolidationSave.test.ts', 'web/src/utils/shipmentDates.ts', 'web/src/utils/shipmentDeclaration.test.ts', 'web/src/utils/shipmentDeclaration.ts', 'web/src/utils/shipmentDeclarationSaveValidation.test.ts', 'web/src/utils/shipmentDeclarationSaveValidation.ts', 'web/src/utils/shipmentFreezePanes.test.ts', 'web/src/utils/shipmentImport.ts', 'web/src/utils/shipmentImportedHs.test.ts', 'web/src/utils/shipmentInvoice.ts', 'web/src/utils/shipmentSheet.test.ts', 'web/src/utils/shipmentSheet.ts', 'web/src/utils/shipmentSheetNavigation.test.ts', 'web/src/utils/shipmentSheetNavigation.ts', 'web/src/utils/supplierDocuments.test.ts')
REVIEWED_PATH_COUNT=19
TARGET=''
TREE=''
PHASE=''
EXECUTE=False
PREPARED_SHA256=''
DEPLOY_SHA256=''
BRANCH='refs/heads/ops/pr-1034-20261028-indo-static'
APP='apps/印尼小组/印尼走货明细'
SERVICE='indo-shipping'
LIVE_IMAGE='sha256:79c441c8c2df6d6df6fcc475e865535c3ed5c4e884e56bcb1a2a772c5163b0a9'
STATIC_BASE_IMAGE=LIVE_IMAGE
EXPECTED_LIVE_CID='58a9bc0a94611e21a4d8987edd85857fa3f53521ca649bafa3a166890cf3eb2a'
COMPOSE_TAG='rr-portal-indo-shipping:latest'
TEMPLATES=('template-customs.xlsx','template-customs-rri.xlsx','template-customs-rrm.xlsx')
TEMPLATE_PROOFS={'template-customs.xlsx':(144045,'24ea412592b3b656a872950c8a3985813fb3dd647c26df495bc882791e9bcaf6'),'template-customs-rri.xlsx':(43375953,'cb37324b0b4d659d55a8b2ddf012f0b6bbef8b1ee7f368448b3e0ad0fff23647'),'template-customs-rrm.xlsx':(835559,'21fa65679165883c8ed9f100af96c581d79a35da9644464548c765e10f1d2984')}
PUBLIC='http://127.0.0.1/indo-shipping/'
DEPS={'release-data-ops-library.py':'ff9138a1d5bfed1b10077112da6ebcda2d65240f583e2d0e12ce1325cfbaafd5','release-data-library.py':'d63168fd3057f4f2aba2d93f9fab31d2d65c6dd0f3234877d71fcff1e04e62b9','qc-source-library.py':'4745c90f126cf46106b0f170a3ebc6b24ccb64c0e963e427d13308d5cb5b54f5','portable-pdb-library.py':'cf66f655a1e166491c4da67da0824f42ac8cdae3f844044cb5d8f7233ba105c5','batch-host-config-library.py':'bd1842dc6847f3e0e5c0c38374c3604791f66d1c94dc651457607dc338f38ff1'}
L=None;OPS=None;Q=None;H=None
SERIAL=0
STAGE='entry'
RECOVERY={}

def need(v,label):
 global STAGE
 STAGE=label
 if not v:raise RuntimeError(label)

def enc(v):return json.dumps(v,sort_keys=True,separators=(',',':'),ensure_ascii=True,allow_nan=False).encode()

def sha(v):return hashlib.sha256(v).hexdigest()

def private(p,v):
 fd=os.open(p,os.O_CREAT|os.O_EXCL|os.O_WRONLY|os.O_NOFOLLOW,0o600)
 with os.fdopen(fd,'wb')as f:f.write(v if type(v)is bytes else enc(v));f.flush();os.fsync(f.fileno())

def run(args,data=None,timeout=180):
 global SERIAL,STAGE
 SERIAL+=1;STAGE='command-'+pathlib.Path(args[0]).name
 need(OUT is not None,'private-command-archive-required-before-execution')
 base=OUT/('%03d'%SERIAL)
 private(base.with_suffix('.command.private.json'),{'program':pathlib.Path(args[0]).name,'timeout':timeout})
 # Direct child output is retained even when subprocess.run times out or fails.
 # No argv or environment is written to command metadata or public receipts.
 with contextlib.ExitStack()as stack:
  stdout=stack.enter_context(os.fdopen(os.open(base.with_suffix('.stdout.private'),os.O_CREAT|os.O_EXCL|os.O_RDWR|os.O_NOFOLLOW,0o600),'w+b'))
  stderr=stack.enter_context(os.fdopen(os.open(base.with_suffix('.stderr.private'),os.O_CREAT|os.O_EXCL|os.O_RDWR|os.O_NOFOLLOW,0o600),'w+b'))
  try:p=subprocess.run(args,input=data,stdout=stdout,stderr=stderr,cwd=ROOT,timeout=timeout)
  finally:
   for stream in(stdout,stderr):stream.flush();os.fsync(stream.fileno())
  need(p.returncode==0,'command-'+pathlib.Path(args[0]).name)
  stdout.seek(0);return stdout.read()

def load(name):
 p=pathlib.Path(__file__).with_name(name);need(p.is_file()and not p.is_symlink()and sha(p.read_bytes())==DEPS[name],'reviewed-library-'+name)
 s=importlib.util.spec_from_file_location(name.replace('.','_'),p);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m

def pin(value, width=64):
    return type(value) is str and re.fullmatch('[a-f0-9]{%d}' % width, value) is not None

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
                             'restarts': row['RestartCount'], 'pid': row['State']['Pid'], 'running': row['State']['Running'],
                             'oom': row['State']['OOMKilled'], 'health': row['State'].get('Health', {}).get('Status')}
    return values

def service(records, name):
    found = [(cid, value) for cid, value in records.items()
             if (value['config'].get('Labels') or {}).get('com.docker.compose.project') == 'rr-portal'
             and (value['config'].get('Labels') or {}).get('com.docker.compose.service') == name]
    need(len(found) == 1, 'unique-fixed-service-' + name)
    return found[0]

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
    # No persistent inode comparison here: these are type/owner/mode records, not persistent inode seals.
    # This release never checks out or changes shared host config.
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

def initialize():
 global L,OPS,Q,H
 for n,h in DEPS.items():
  p=pathlib.Path(__file__).with_name(n);need(p.is_file()and not p.is_symlink()and sha(p.read_bytes())==h,'all-dependencies-pinned-before-import')
 L=load('release-data-library.py');OPS=load('release-data-ops-library.py');Q=load('qc-source-library.py');H=load('batch-host-config-library.py')
 OPS.L=L;OPS.ROOT=ROOT;OPS.SCHEMAS=('indo_shipping',);OPS.NEW_COLUMNS={};OPS.run=run
 Q.OPS=OPS;Q.PDB=load('portable-pdb-library.py');Q.ROOT=ROOT;Q.OUT=OUT;Q.BASE=BASE
 def qrun(args,data=None,timeout=180):Q.COUNTER+=1;return run(args,data,timeout)
 Q.run=qrun

def git(*args): return run(['git', '-C', str(ROOT), '-c', 'core.hooksPath=/dev/null', *args])

def safe_relative(name):
    p = pathlib.PurePosixPath(name)
    return type(name) is str and bool(name) and str(p) == name and not p.is_absolute() and '..' not in p.parts and '\\' not in name and all(ord(c) >= 32 for c in name)

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
    cid = run(['docker', 'create', '--network', 'none', '--restart', 'no', '--log-driver', 'none', '--label', 'io.rr-portal.pr1034-scratch='+PHASE, '--entrypoint', '/bin/true', image]).decode().strip()
    need(re.fullmatch('[a-f0-9]{64}', cid), 'own-full-scratch-id')
    return cid

def scratch_remove(cid, image):
    r = json.loads(run(['docker', 'inspect', cid]))[0]
    need(r['Id'] == cid and r['Image'] == image and not r['State']['Running'] and r['State']['Pid'] == 0 and r['State']['StartedAt'].startswith('0001-') and not r['Mounts'] and (r['Config'].get('Labels') or {}).get('io.rr-portal.pr1034-scratch')==PHASE and r['HostConfig']['NetworkMode'] == 'none', 'remove-only-own-never-started-scratch')
    run(['docker', 'rm', cid])

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

def extract_source(dest):
 dest.mkdir(mode=0o700);total=0;seen=set()
 with tarfile.open(fileobj=io.BytesIO(git('archive',TARGET,APP)))as t:
  for m in t.getmembers():
   n=m.name.rstrip('/');need(L.safe_path(n)and n not in seen and(m.isdir()or m.isfile()),'safe-regular-source-archive');seen.add(n);total+=m.size
   need(total<=512*1024**2 and m.size<=128*1024**2 and(n==APP or n.startswith(APP+'/')or m.isdir()and APP.startswith(n+'/')),'bounded-app-only-source')
   need(m.isdir()or not pathlib.PurePosixPath(n).name.startswith('.env')or pathlib.PurePosixPath(n).name.endswith(('.example','.sample')),'no-environment-file-in-context')
   relative=n[len(APP)+1:]if n.startswith(APP+'/')else''
   need(m.isdir()or not any(relative.startswith(x+'/')for x in('data','data-test','storage','storage-test'))or relative.endswith('/.gitkeep'),'no-runtime-data-in-context')
   p=dest/n
   if m.isdir():p.mkdir(mode=0o755,parents=True,exist_ok=True)
   else:p.parent.mkdir(mode=0o755,parents=True,exist_ok=True);private(p,t.extractfile(m).read());p.chmod(m.mode&0o755)

def target_unchanged(before,after,cid):
 need(cid in before and cid in after and before==after,'every-original-runtime-including-test-no-pid-start-config-env-change')

def inventory():
 rows=runtime();cid,row=service(rows,SERVICE);r=json.loads(run(['docker','inspect',cid]))[0]
 need(cid==EXPECTED_LIVE_CID and r['Id']==cid and r['Image']==LIVE_IMAGE and not r['Mounts'],'fresh-last-successful-indo-full-image-and-cid')
 need(r['State']['Running']and not r['State']['OOMKilled']and r['State'].get('Health',{}).get('Status')=='healthy','formal-indo-still-healthy')
 service(rows,'db');return r,rows,rows

def backend_proof(identity,candidate=False):
 value=Q.service_source_proof(SERVICE,{'id':identity},revision=BACKEND_REVISION,candidate=candidate)
 need(value['reviewedSourceMatch']is True,'actual-six-dll-pdb-and-db-seed-source-match-705');return value

def same_backend(left,right):
 ignored={'compiledArtifactInventory','compiledArtifactInventorySHA256'}
 need(set(left)==set(right)and {k:v for k,v in left.items()if k not in ignored}=={k:v for k,v in right.items()if k not in ignored},'whole-backend-pdb-copied-data-source-proof-exact')

def source_check():
 need(all(pin(v,40)for v in(BASE,BACKEND_REVISION,HOST_BASE,HEAD,TARGET,TREE,APP_TREE))and BASE==EXPECTED_BASE==BACKEND_REVISION and TARGET==EXPECTED_TARGET and TREE==EXPECTED_TREE,'all-final-reviewed-frontend-source-pins')
 need(git('symbolic-ref','--short','HEAD').decode().strip()=='main'and git('rev-parse','HEAD').decode().strip()==HOST_BASE,'physical-host-kept-at-reviewed-host-baseline')
 git('fetch','--no-write-fetch-head','origin','+refs/heads/main:refs/remotes/origin/main')
 need(git('rev-parse','origin/main').decode().strip()==TARGET and git('rev-parse',TARGET+'^{tree}').decode().strip()==TREE and git('rev-parse',BASE+':'+APP).decode().strip()==SOURCE_APP_TREE,'exact-main-tree-and-last-deployed-E61-app')
 need(git('rev-parse',TARGET+':'+APP).decode().strip()==APP_TREE==git('rev-parse',HEAD+':'+APP).decode().strip(),'reviewed-frontend-app-tree');git('merge-base','--is-ancestor',HEAD,TARGET)
 changed={p.decode()for p in git('diff','--name-only','-z',BASE,TARGET,'--',APP).split(b'\0')if p}
 need(len(REVIEWED_PATHS)==len(set(REVIEWED_PATHS))==REVIEWED_PATH_COUNT and changed=={APP+'/'+p for p in REVIEWED_PATHS}and all(p.startswith('web/')and p.endswith(('.ts','.tsx'))for p in REVIEWED_PATHS),'exact-nineteen-reviewed-frontend-only-paths')
 for name in('src','db','seed','Dockerfile','.dockerignore','web/package.json','web/package-lock.json'):
  need(git('rev-parse',BACKEND_REVISION+':'+APP+'/'+name)==git('rev-parse',TARGET+':'+APP+'/'+name),'unchanged-entire-backend-db-seed-build-and-dependencies')

def ensure_build_space():
 value=json.loads(run(['docker','info','--format','{{json .DockerRootDir}}']));need(type(value)is str and value.startswith('/')and len(value)<4096,'bounded-docker-root');s=os.statvfs(value);available=s.f_bavail*s.f_frsize
 private(OUT/'docker-space.private.json',{'root':value,'available':available});need(available>=4*1024**3,'four-gib-free-no-prune');return available

def derivative_contract(base_image,derivative):
 need(derivative['Architecture']==base_image['Architecture']and derivative['Os']==base_image['Os']and derivative['RootFS']['Layers'][:len(base_image['RootFS']['Layers'])]==base_image['RootFS']['Layers'],'derivative-retains-whole-base-layers-and-platform')
 before,after=dict(base_image['Config']),dict(derivative['Config']);left=before.pop('Labels',None)or{};right=after.pop('Labels',None)or{};before.pop('Image',None);after.pop('Image',None)
 need(before==after and right==dict(left,**{'org.opencontainers.image.revision':TARGET,'io.rr-portal.backend-image':LIVE_IMAGE,'io.rr-portal.frontend-app-tree':APP_TREE}),'full-config-including-exact-user-and-only-explicit-static-labels')

def prepare():
    need(git('symbolic-ref', '--short', 'HEAD').decode().strip() == 'main' and git('rev-parse', 'HEAD').decode().strip() == HOST_BASE, 'unchanged-canonical-priority-host-base')
    r, rows, records = inventory(); preserved = host_files(); protection=protected_inventory(rows); ensure_build_space()
    prior_alias=image_id(COMPOSE_TAG); need(prior_alias==STATIC_BASE_IMAGE,'fresh-original-durable-canonical-alias'); original_proof=backend_proof(r['Id']); accepted_proof=backend_proof(STATIC_BASE_IMAGE,True); need(original_proof==accepted_proof,'whole-live-backend-and-static-graph-equal-known79c')
    private(OUT / 'runtime.private.json', enc(records)); private(OUT / 'environment.private', (ROOT / '.env.cloud.production').read_bytes())
    old = copy_web(r['Id'], 'old-wwwroot'); old_manifest = files(old); old_meta = index_metadata(r['Id'])
    status, headers, body = http()
    need(status == 200 and sha(body) == old_manifest['index.html'], 'live-old-index-matches-backup')
    src = OUT / 'source'
    extract_source(src)
    build_tag = 'rrportal-indo-pr1034-frontend:' + TARGET
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
    base_alias = 'rrportal-indo-pr1034-backend:' + STATIC_BASE_IMAGE.split(':')[1]
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
    durable_tag = 'rrportal-indo-pr1034:' + TARGET
    run(['docker', 'build', '--pull=false', '-t', durable_tag, str(image_context)], timeout=300)
    derivative = json.loads(run(['docker', 'image', 'inspect', durable_tag]))[0]; image = derivative['Id']
    need(image_id(base_alias)==STATIC_BASE_IMAGE,'frozen-local-base-alias-still-exact'); derivative_contract(base_image,derivative)
    # Read back the durable image to prove it contains the whole old+new dependency graph.
    scratch = scratch_create(image)
    try: image_web = copy_web(scratch, 'image-verified-wwwroot')
    finally: scratch_remove(scratch, image)
    need(files(image_web) == files(merged), 'durable-image-static-files-exact')
    _, after, _ = inventory(); target_unchanged(rows, after, r['Id']); need(host_files() == preserved and protected_inventory(after)==protection, 'prepare-host-env-bind-auth-maintenance-preserved')
    service = json.loads(run(['docker', 'compose', '-p', 'rr-portal', '-f', str(ROOT / 'docker-compose.cloud.yml'), '--env-file', str(ROOT / '.env.cloud.production'), 'config', '--format', 'json']))['services']['indo-shipping']
    need(type(service.get('build')) is dict and service['build'].get('dockerfile', 'Dockerfile') == 'Dockerfile' and service.get('image') in (None, 'rr-portal-indo-shipping', COMPOSE_TAG), 'known-compose-build-service-and-default-image-tag')
    old_headers = {k.lower(): v for k, v in headers.items() if k.lower() in ('etag', 'last-modified')}; need(set(old_headers) == {'etag', 'last-modified'}, 'both-old-index-cache-validators-recorded')
    derived_proof=backend_proof(image,True); same_backend(original_proof,derived_proof); need({n.removeprefix('wwwroot/'):v['sha256']for n,v in derived_proof['compiledArtifactInventory'].items()}==files(merged),'durable-full-proof-static-union-exact')
    need(image_id(COMPOSE_TAG)==prior_alias,'original-canonical-alias-unchanged-through-prepare')
    data = {'base': BASE, 'hostBase': HOST_BASE, 'sourceCheckoutDeferredToReviewedHostBaseline': True, 'target': TARGET, 'tree': TREE, 'head': HEAD, 'appTree': APP_TREE, 'container': r['Id'], 'runtime': rows, 'hostFiles': preserved, 'oldManifest': old_manifest, 'newManifest': new_manifest, 'templateProofs': template_proofs, 'newAssets': additions, 'oldHeaders': old_headers, 'oldIndexMetadata': old_meta, 'composeTag': COMPOSE_TAG, 'composeTagBefore': prior_alias, 'originalContainerImageName': r['Config']['Image'], 'durableTag': durable_tag, 'durableImage': image, 'imageContextManifest': files(merged), 'oldProof': original_proof, 'protected': protection, 'compiledBackendRevision': BACKEND_REVISION}
    private(OUT / 'prepared.private.json', enc(data))
    return {'durableImage': image, 'newFileCount': len(new_manifest), 'databaseReadOrWritten': False, 'runtimeNotRestarted': True, 'liveRuntimeUnchanged': True,
            'hostSourceHead': HOST_BASE, 'logicalPrBase': BASE, 'sourceCheckoutDeferredToReviewedHostBaseline': True}

def manifest(directory):
 values=sorted(directory.rglob('*'));need(len(values)<=100000 and all(not p.is_symlink()and(p.is_file()or p.is_dir())for p in values),'regular-bounded-private-evidence');return {str(p.relative_to(directory)):sha(p.read_bytes())for p in values if p.is_file()}

def sealed(phase,digest):
 directory=ARCHIVE_ROOT/phase;need(pin(digest)and sha((directory/'manifest.json').read_bytes())==digest,'sealed-successful-phase-manifest');actual=manifest(directory);actual.pop('manifest.json',None);actual.pop('result.private.json',None);need(actual==read(directory/'manifest.json'),'all-prior-private-evidence-byte-seals')
 result=read(directory/'result.private.json');need(result['success']is True and result['phase']==phase and result['base']==BASE and result['head']==HEAD and result['target']==TARGET and result['tree']==TREE and result['appTree']==APP_TREE and result['manifestSHA256']==digest,'source-bound-successful-prior-phase');return directory,result

def load_prepared():
 directory,_=sealed('prepare',PREPARED_SHA256);p=read(directory/'prepared.private.json');need(p['base']==BASE and p['target']==TARGET and p['tree']==TREE and p['head']==HEAD and p['appTree']==APP_TREE and p['hostBase']==HOST_BASE,'prepared-exact-source-and-host');return p

def deploy():
    global RECOVERY
    p=load_prepared()
    source_check(); r, rows, _ = inventory(); need(r['Id'] == p['container'] and host_files() == p['hostFiles'], 'unchanged-prepared-live-target-and-host-files'); target_unchanged(p['runtime'], rows, r['Id'])
    need(files(PREPARE_OUT / 'old-wwwroot') == p['oldManifest'] and files(PREPARE_OUT / 'prepared-wwwroot') == p['newManifest'], 'sealed-old-and-new-static-files')
    need(static_plan(p['oldManifest'], p['newManifest']) == p['newAssets'] and (PREPARE_OUT / 'prepared-wwwroot/index.html').stat().st_size == p['oldIndexMetadata']['size'], 'sealed-add-only-plan-and-equal-index-length')
    need(files(copy_web(r['Id'], 'preapply-wwwroot')) == p['oldManifest'], 'no-live-static-drift')
    need(image_id(p['durableTag']) == p['durableImage'] and p['composeTag'] == COMPOSE_TAG and image_id(COMPOSE_TAG, optional=True) == p['composeTagBefore'], 'durable-image-and-future-compose-tag-pin')
    need(index_metadata(r['Id']) == p['oldIndexMetadata'] and backend_proof(r['Id'])==p['oldProof'] and protected_inventory(rows)==p['protected'], 'same-old-index-full-proof-env-auth-before-write')
    index_time = max(int(time.time()), p['oldIndexMetadata']['mtime'] + 2)
    need(index_time <= int(time.time()) + 3, 'no-unbounded-future-index-cache-time')
    while int(time.time()) < index_time: time.sleep(0.1)
    private(OUT / 'deploy.reservation', enc({'target': TARGET, 'utc': datetime.datetime.now(datetime.timezone.utc).isoformat()}))
    stage = '/app/.pr1034-static-' + TARGET
    next_index, old_index = stage + '/new/index.html', stage + '/old-index'
    index_attempted = False; tag_attempted = False
    try:
        # No extraction into served paths. The private stage contains public files only.
        run(['docker', 'exec', '--user', '0', r['Id'], 'sh', '-c', 'set -eu; test ! -e "$1"; test ! -L "$1"; mkdir -m 700 "$1"; mkdir -m 700 "$1/new"', '_', stage])
        run(['docker', 'cp', str(PREPARE_OUT / 'prepared-wwwroot') + '/.', r['Id'] + ':' + stage + '/new'])
        run(['docker', 'cp', str(PREPARE_OUT / 'old-wwwroot/index.html'), r['Id'] + ':' + old_index])
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
        checks = verify_public(p); after_proof=backend_proof(r['Id']); same_backend(p['oldProof'],after_proof); need({n.removeprefix('wwwroot/'):v['sha256']for n,v in after_proof['compiledArtifactInventory'].items()}==dict(p['oldManifest'],**p['newManifest']),'actual-static-union-with-identical-backend')
        _, after, _ = inventory(); target_unchanged(rows, after, r['Id']); need(host_files() == p['hostFiles'] and protected_inventory(after)==p['protected'], 'no-host-env-auth-bind-maintenance-change')
        # Keep the independently observed and reviewed host source baseline.
        # Publish only the reviewed Indo frontend; perform no host checkout.
        need(git('rev-parse', 'HEAD').decode().strip() == HOST_BASE and host_files() == p['hostFiles'],
             'host-source-kept-at-base-and-all-shared-config-preserved')
        need(image_id(COMPOSE_TAG, optional=True) == p['composeTagBefore'], 'future-compose-tag-unchanged-before-commit')
        tag_attempted = True
        run(['docker', 'tag', p['durableImage'], p['composeTag']])
        need(image_id(COMPOSE_TAG) == p['durableImage'], 'durable-future-compose-tag-committed')
        need(git('rev-parse', 'HEAD').decode().strip() == HOST_BASE and host_files() == p['hostFiles'], 'post-tag-host-source-and-config-still-deferred')
        private(OUT / 'deployed.private.json', enc({'target': TARGET, 'frontendVersion': TARGET, 'hostSourceHead': HOST_BASE,
                'logicalPrBase': BASE, 'sourceCheckoutDeferredToReviewedHostBaseline': True, 'hostSourceCheckoutPerformed': False, 'runtime': after, 'checks': checks, 'liveBackendImage': LIVE_IMAGE, 'durableImageForFutureRecreate': p['durableImage'], 'rollbackStageRetained': stage, 'utc': datetime.datetime.now(datetime.timezone.utc).isoformat()}))
        # No fallible cleanup after the commit receipt; retain only our public rollback stage.
        return {'frontendVersion': TARGET, 'liveBackendImage': LIVE_IMAGE, 'durableImage': p['durableImage'], 'runtimeNotRestarted': True, 'databaseReadOrWritten': False, 'otherContainersNotOperated': True, 'configurationUnchanged': True, 'checks': checks, 'logicalPrBase': BASE, 'hostSourceHead': HOST_BASE,
                'sourceCheckoutDeferredToReviewedHostBaseline': True, 'hostSourceCheckoutPerformed': False}
    except BaseException:
        failure_stage = STAGE
        RECOVERY = {'indexCommitAttempted': index_attempted, 'tagCommitAttempted': tag_attempted, 'automaticRetryPerformed': False, 'newAssetsRetainedForInFlightClients': True,
                    'sourceCheckoutDeferredToReviewedHostBaseline': True, 'hostSourceCheckoutPerformed': False}
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

def verify():
 p=load_prepared();directory,_=sealed('deploy',DEPLOY_SHA256);receipt=read(directory/'deployed.private.json');r,rows,_=inventory();need(rows==receipt['runtime']and host_files()==p['hostFiles']and protected_inventory(rows)==p['protected']and image_id(COMPOSE_TAG)==p['durableImage'],'same-live-cid-all-runtime-env-auth-host-and-durable-image')
 observed=backend_proof(r['Id']);same_backend(p['oldProof'],observed);need({n.removeprefix('wwwroot/'):v['sha256']for n,v in observed['compiledArtifactInventory'].items()}==dict(p['oldManifest'],**p['newManifest']),'final-live-static-union-and-backend705-exact');checks=verify_public(p)
 return {'runtimeNotRestarted':True,'databaseReadOrWritten':False,'durableImage':p['durableImage'],'liveBackendImage':r['Image'],'public':checks,'verificationReadOnly':True,'hostSourceCheckoutPerformed':False}

def main():
 global OUT
 need(EXECUTE is True and PHASE in('prepare','deploy','verify')and sys.argv[1:]==[PHASE]and os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_MODE')==PHASE and os.environ.get('RELEASE_ATTEMPT')=='1','inert-first-scoped-static-release')
 os.umask(0o077);need(ARCHIVE_ROOT.parent.is_dir()and not ARCHIVE_ROOT.parent.is_symlink(),'existing-private-backup-root');ARCHIVE_ROOT.mkdir(mode=0o700,exist_ok=True);need(not ARCHIVE_ROOT.is_symlink()and stat.S_IMODE(ARCHIVE_ROOT.stat().st_mode)==0o700,'private-task-archive');OUT=ARCHIVE_ROOT/PHASE;need(not OUT.exists()and not OUT.is_symlink(),'one-phase-attempt');OUT.mkdir(mode=0o700);initialize()
 result={'phase':PHASE,'base':BASE,'head':HEAD,'target':TARGET,'tree':TREE,'appTree':APP_TREE,'hostBase':HOST_BASE,'compiledBackendRevision':BACKEND_REVISION,'sourceCheckoutDeferredToReviewedHostBaseline':True,'hostSourceCheckoutPerformed':False,'success':False}
 if PHASE in('deploy','verify'):result['preparedSHA256']=PREPARED_SHA256
 if PHASE=='verify':result['deployEvidenceSHA256']=DEPLOY_SHA256
 try:source_check();result.update({'prepare':prepare,'deploy':deploy,'verify':verify}[PHASE]());result['success']=True
 except Exception as e:result.update(errorType=type(e).__name__,stage=STAGE,noAutomaticDispatchOrLifecycleRetry=True,recovery=RECOVERY)
 result['utc']=datetime.datetime.now(datetime.timezone.utc).isoformat();private(OUT/'manifest.json',manifest(OUT));result['manifestSHA256']=sha((OUT/'manifest.json').read_bytes())
 if result['success']and PHASE=='prepare':result['preparedSHA256']=result['manifestSHA256']
 if result['success']and PHASE=='deploy':result['deployEvidenceSHA256']=result['manifestSHA256']
 private(OUT/'result.private.json',result);result['resultSHA256']=sha(enc(result));result['sha256Wire']={k:[int(c,16)for c in(v.split(':',1)[1]if v.startswith('sha256:')else v)]for k,v in result.items()if type(v)is str and re.fullmatch('(?:sha256:)?[a-f0-9]{64}|[a-f0-9]{40}',v)};print(json.dumps(result,sort_keys=True),flush=True);return 0 if result['success']else 1

if __name__=='__main__':sys.exit(main())
