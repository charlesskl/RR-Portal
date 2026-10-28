"""Inert PR1027 one-service Indo full-image release draft.
No host checkout, shared config changes, database restore/reset or business API writes.
Only new private PostgreSQL clone accepts a restore; live DB is read-only evidence.
Final reviewed source pins must be bound before independent review and execution.
"""
import contextlib,copy,datetime,hashlib,importlib.util,io,json,os,pathlib,re,shutil,stat,subprocess,sys,tarfile,time,uuid,xml.etree.ElementTree as ET
import urllib.error,urllib.request,urllib.parse
ROOT=pathlib.Path('/opt/rr-portal')
ARCHIVE_ROOT=ROOT/'deploy/backups/pr1027-indo-20261028'
ACTIVE_OUT=None
BASE='9d942c021e3d307e89ad1a8ea1a2425199fced1b'
HOST_BASE='4b3d8f3e319e41dcc8720d759e1af0726a2b2381'
HEAD='4329101451da6ddaa11a332c399ee688c7a4d463'
APP_TREE='dae5c9ad28df33f723fc36a9c698d957272ce06d'
EXPECTED_TARGET='fd32ce653647474acf8c6c8e7aa84dfd11854bfc'
EXPECTED_TREE='200f94d735d9cc1bdb0aa9412973db4524d180dd'
REVIEWED_PATHS=('src/IndoShipping.Api/Controllers/OutboundController.cs', 'src/IndoShipping.Api/Controllers/ShipmentsController.cs', 'src/IndoShipping.Api/Features/Purchasing/ShipmentPurchaseBasis.cs', 'tests/IndoShipping.Api.Tests/ShipmentOutboundLinkTests.cs', 'web/src/pages/ShipmentsPage.tsx', 'web/src/utils/customsExport.ts', 'web/src/utils/shipmentConsolidation.test.ts', 'web/src/utils/shipmentConsolidation.ts', 'web/src/utils/shipmentMergedEditor.test.ts', 'web/src/utils/shipmentOutboundLink.ts', 'web/src/utils/shipmentOutboundLinkFlow.test.ts', 'web/src/utils/shipmentOutboundPullFlow.test.ts', 'web/src/utils/shipmentOutboundRemaining.test.ts', 'web/src/utils/shipmentOutboundRemaining.ts', 'web/src/utils/shipmentPurchase.test.ts', 'web/src/utils/shipmentPurchase.ts', 'web/src/utils/shipmentPurchaseBasisFlow.test.ts', 'web/src/utils/shipmentPurchaseExport.test.ts')
TARGET=''
TREE=''
PHASE=''
EXECUTE=False
PREPARED_SHA256=''
DEPLOY_SHA256=''
BRANCH='refs/heads/ops/pr-1027-20261028-indo'
APP='apps/印尼小组/印尼走货明细'
SERVICE='indo-shipping'
SERVICES=(SERVICE,)
ALIAS='rr-portal-indo-shipping:latest'
ACCEPTED_BACKEND_IMAGE='sha256:ba2a99c9ff21311e22ede4f5ce46a49ffbcd298c77845681e3a9c881d6f157d2'
ACCEPTED_DURABLE_IMAGE='sha256:7a1a2d6ce470ef66fcb83cc2c5216ffe6748915e0a48938c92540438c61a7a4d'
ACCEPTED_OLD_APP_TREE='739379a23f7372485e5e1665f922ffe45d4baebf'
STARTUP_FILES=('db/postgres_schema.sql','src/IndoShipping.Api/Program.cs','src/IndoShipping.Api/Features/Bootstrap/ProductionSeeder.cs','src/IndoShipping.Api/Features/Bootstrap/DataMigrations.cs','src/IndoShipping.Infrastructure/Persistence/DatabaseCompatibility.cs','src/IndoShipping.Api/DeploymentSecrets.cs','src/IndoShipping.Api/Features/Bootstrap/ScheduleCustomerSchema.cs','src/IndoShipping.Api/Features/Bootstrap/PurchasePricePrecision.cs')
TEMPLATES=('template-customs.xlsx','template-customs-rri.xlsx','template-customs-rrm.xlsx')
DEPS={'release-data-ops-library.py':'ff9138a1d5bfed1b10077112da6ebcda2d65240f583e2d0e12ce1325cfbaafd5','release-data-library.py':'d63168fd3057f4f2aba2d93f9fab31d2d65c6dd0f3234877d71fcff1e04e62b9','qc-source-library.py':'4745c90f126cf46106b0f170a3ebc6b24ccb64c0e963e427d13308d5cb5b54f5','portable-pdb-library.py':'cf66f655a1e166491c4da67da0824f42ac8cdae3f844044cb5d8f7233ba105c5','batch-host-config-library.py':'bd1842dc6847f3e0e5c0c38374c3604791f66d1c94dc651457607dc338f38ff1'}
L=None;OPS=None;Q=None;H=None
SERIAL=0
STAGE='entry'
RECOVERY={}
KEYRING_DEST='/home/app/.aspnet'
KEYRING_MAX=2*1024*1024
KEYRING_OWNER=(1654,1654)

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
 need(ACTIVE_OUT is not None,'private-command-archive-required-before-execution')
 base=ACTIVE_OUT/('%03d'%SERIAL)
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

def git(*args):return run(['git','-c','core.hooksPath=/dev/null',*args])

def load(name):
 p=pathlib.Path(__file__).with_name(name);need(p.is_file()and not p.is_symlink()and sha(p.read_bytes())==DEPS[name],'reviewed-library-'+name)
 s=importlib.util.spec_from_file_location(name.replace('.','_'),p);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m

def image(image_id):
 need(re.fullmatch('sha256:[a-f0-9]{64}',image_id or''),'immutable-image-id')
 r=json.loads(run(['docker','image','inspect',image_id]))[0];need(r['Id']==image_id,'same-image-id');return r

def compose_build_labels(service,old_image):
 need(service in SERVICES,'known-build-label-service');labels=old_image['Config'].get('Labels')or{};need(type(labels)is dict,'old-image-label-map');result=[]
 for key in('com.docker.compose.project','com.docker.compose.service','com.docker.compose.version'):
  if key not in labels:continue
  value=labels[key];need(type(value)is str,'public-compose-build-label-string')
  valid=value=='rr-portal'if key.endswith('.project')else value==service if key.endswith('.service')else re.fullmatch(r'v?[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}(?:[-+][A-Za-z0-9][A-Za-z0-9.-]{0,31})?',value)is not None
  need(valid,'fixed-public-compose-build-label');result+=['--label',key+'='+value]
 return result

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

def compose_args(overlay):return ['docker','compose','--project-name','rr-portal','--project-directory',str(ROOT),'--env-file',str(ARCHIVE_ROOT/'environment.private'),'-f',str(ROOT/'docker-compose.cloud.yml'),'-f',str(overlay)]

def gate_on(service):
 p=ROOT/'deploy/maintenance/services'/service;need(p.parent.is_dir()and not p.parent.is_symlink(),'existing-maintenance-directory');fd=os.open(p,os.O_CREAT|os.O_EXCL|os.O_WRONLY|os.O_NOFOLLOW,0o600)
 owned=None
 try:
  s=os.fstat(fd);owned=(p,s.st_dev,s.st_ino)
  with os.fdopen(fd,'wb')as f:fd=None;f.flush();os.fsync(f.fileno())
  need(p.is_file()and not p.is_symlink()and(p.stat().st_dev,p.stat().st_ino)==owned[1:],'owned-gate-stable');return owned
 except BaseException:
  try:
   if owned is None:RECOVERY['gateCreationFailedWithoutInodeProofFlagRetained']=True
   else:
    current=p.lstat()
    if stat.S_ISREG(current.st_mode)and(current.st_dev,current.st_ino)==owned[1:]:p.unlink();RECOVERY['ownGateCreationFailureCleaned']=True
    else:RECOVERY['gateCreationFailureReplacedFlagRetained']=True
  except FileNotFoundError:RECOVERY['ownGateCreationFailureAlreadyAbsent']=True
  except BaseException as e:RECOVERY.update(gateCreationFailureCleanupUnproven=True,gateCreationCleanupErrorType=type(e).__name__)
  raise
 finally:
  if fd is not None:os.close(fd)

def gate_assert(owned):
 p,dev,ino=owned;st=p.lstat();need(stat.S_ISREG(st.st_mode)and not p.is_symlink()and(st.st_dev,st.st_ino)==(dev,ino)and stat.S_IMODE(st.st_mode)==0o600 and st.st_size==0,'only-owned-empty-private-service-gate')

def gate_off(owned):gate_assert(owned);owned[0].unlink()

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
                             'restarts': row['RestartCount'], 'running': row['State']['Running'],
                             'oom': row['State']['OOMKilled'], 'health': row['State'].get('Health', {}).get('Status')}
    return values

def service(records, name):
    found = [(cid, value) for cid, value in records.items()
             if (value['config'].get('Labels') or {}).get('com.docker.compose.project') == 'rr-portal'
             and (value['config'].get('Labels') or {}).get('com.docker.compose.service') == name]
    need(len(found) == 1, 'unique-fixed-service-' + name)
    return found[0]

def manifest(directory):
    entries = sorted(directory.rglob('*'))
    need(len(entries) <= 100000 and all(not p.is_symlink() and (p.is_file() or p.is_dir()) for p in entries), 'regular-bounded-evidence-tree')
    return {str(p.relative_to(directory)): L.file_hash(p) for p in entries if p.is_file()}

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

def runtime_others_exact(before,after,old_id=None,new_id=None):
 old=dict(before);new=dict(after)
 if old_id is not None:need(old.pop(old_id,None) is not None and new.pop(new_id,None) is not None,'only-formal-indo-cid-replaced')
 need(old==new,'every-other-container-including-test-unchanged')

def image_id(value):
 rows=json.loads(run(['docker','image','inspect',value]));need(len(rows)==1,'one-local-image-or-alias');return rows[0]['Id']

def envmap(values):
 need(type(values)is list and len(values)<1000,'bounded-literal-environment');result={}
 for item in values:
  need(type(item)is str and '='in item,'literal-env-entry');key,value=item.split('=',1)
  need(re.fullmatch('[A-Za-z_][A-Za-z0-9_]*',key)and key not in result,'unique-env-key');result[key]=value
 return result

def initialize():
 global L,OPS,Q,H
 for n,h in DEPS.items():
  p=pathlib.Path(__file__).with_name(n);need(p.is_file()and not p.is_symlink()and sha(p.read_bytes())==h,'all-dependencies-pinned-before-import')
 L=load('release-data-library.py');OPS=load('release-data-ops-library.py');Q=load('qc-source-library.py');H=load('batch-host-config-library.py')
 OPS.L=L;OPS.ROOT=ROOT;OPS.SCHEMAS=('indo_shipping',);OPS.NEW_COLUMNS={};OPS.run=run
 Q.OPS=OPS;Q.PDB=load('portable-pdb-library.py');Q.ROOT=ROOT;Q.OUT=ACTIVE_OUT;Q.BASE=BASE
 def qrun(args,data=None,timeout=180):Q.COUNTER+=1;return run(args,data,timeout)
 Q.run=qrun

def one(healthy=True):
 records=runtime();cid,_=service(records,SERVICE);r=json.loads(run(['docker','inspect',cid]))[0]
 need(r['Id']==cid and r['Mounts']==[],'one-unmounted-indo-service')
 if healthy:need(r['State']['Running']and not r['State']['OOMKilled']and r['State'].get('Health',{}).get('Status')=='healthy','formal-indo-healthy')
 return r

def process_environment(cid):
 raw=run(['docker','exec',cid,'cat','/proc/1/environ']);need(raw.endswith(b'\0'),'complete-pid1-environment')
 value=envmap([x.decode()for x in raw.split(b'\0')if x]);need(value.pop('HOSTNAME',None)==cid[:12],'only-automatic-process-hostname');return value

def database(records):
 cid,_=service(records,'db');r=json.loads(run(['docker','inspect',cid]))[0]
 need(r['Id']==cid and r['State']['Running']and not r['State']['OOMKilled']and r['State'].get('Health',{}).get('Status')=='healthy','existing-postgres-healthy')
 return r

def db_guard(r,db):
 a=envmap(r['Config']['Env']);d=envmap(db['Config']['Env']);p=process_environment(r['Id'])
 need(a.get('DB_NAME')==(d.get('POSTGRES_DB')or'rrportal')and a.get('DB_USER')==(d.get('POSTGRES_USER')or'rrportal')and a.get('DB_PASSWORD')==d.get('POSTGRES_PASSWORD')and a.get('DB_SCHEMA','indo_shipping')=='indo_shipping','existing-db-connection')
 keys=('DB_NAME','DB_USER','DB_PASSWORD','DB_SCHEMA','INDO_SHIPPING_JWT_KEY_B64','INDO_SHIPPING_ADMIN_PASSWORD_B64')
 need(all(p.get(k)==a.get(k)for k in keys)and bool(a.get('INDO_SHIPPING_JWT_KEY_B64'))and bool(a.get('INDO_SHIPPING_ADMIN_PASSWORD_B64')),'existing-persistent-auth-and-db-env')
 return {'configuredEnvironmentSHA256':sha(enc(a)),'processEnvironmentSHA256':sha(enc(p))}

def source_check():
 need(all(pin(v,40)for v in(BASE,HOST_BASE,HEAD,TARGET,TREE,APP_TREE))and TARGET==EXPECTED_TARGET and TREE==EXPECTED_TREE and 0<len(REVIEWED_PATHS)<=30,'final-reviewed-source-bound')
 need(git('symbolic-ref','--short','HEAD').decode().strip()=='main'and git('rev-parse','HEAD').decode().strip()==HOST_BASE,'host-source-kept-at-4b')
 git('fetch','--no-write-fetch-head','origin','+refs/heads/main:refs/remotes/origin/main')
 need(git('rev-parse','origin/main').decode().strip()==TARGET and git('rev-parse',TARGET+'^{tree}').decode().strip()==TREE and git('rev-parse',HEAD+'^{tree}').decode().strip()==TREE and git('rev-parse',TARGET+':'+APP).decode().strip()==APP_TREE,'exact-reviewed-target-and-tree')
 changed={n.decode()for n in git('diff','--name-only','-z',BASE,TARGET).split(b'\0')if n}
 need(len(REVIEWED_PATHS)==len(set(REVIEWED_PATHS))and changed=={APP+'/'+n for n in REVIEWED_PATHS},'only-final-reviewed-indo-paths')
 need(git('rev-parse',BASE+':'+APP).decode().strip()==ACCEPTED_OLD_APP_TREE,'logical-base-still-accepted-1023-app')
 for n in('Dockerfile','.dockerignore',*STARTUP_FILES,'src/IndoShipping.Api/Auth','src/IndoShipping.Domain/Auth','src/IndoShipping.Infrastructure/Auth','web/package.json','web/package-lock.json'):
  need(git('rev-parse',HOST_BASE+':'+APP+'/'+n)==git('rev-parse',TARGET+':'+APP+'/'+n),'unchanged-startup-schema-auth-dependencies')
 script=git('show',TARGET+':'+APP+'/db/postgres_schema.sql')
 need(script.count(b'INSERT INTO "Users" ("Username", "PasswordHash", "DisplayName", "Userbqrpower", "Usereditpower")')==1 and script.count(b'ON CONFLICT ("Username") DO NOTHING;')==1,'one-existing-bootstrap-admin-conflict-insert')
 need(b'await command.ExecuteNonQueryAsync();'in git('show',TARGET+':'+APP+'/src/IndoShipping.Infrastructure/Persistence/DatabaseCompatibility.cs'),'existing-schema-executed-once-per-start')

def proof(image_or_cid,revision,candidate=False):
 value=Q.service_source_proof(SERVICE,{'id':image_or_cid},revision=revision,candidate=candidate)
 need(value['reviewedSourceMatch']is True,'full-dotnet-pdb-and-copied-runtime-source-match');return value

def public_files(cid,candidate=False):return Q.container_files(cid,'/app',['wwwroot'],candidate)

def file_digests(values):return {n:{'bytes':len(b),'sha256':sha(b)}for n,b in values.items()}

def old_source(r):
 need(r['Image']==ACCEPTED_BACKEND_IMAGE and image_id(ALIAS)==ACCEPTED_DURABLE_IMAGE,'fresh-last-accepted-backend-and-durable-alias')
 live=proof(r['Id'],HOST_BASE);accepted=proof(ACCEPTED_DURABLE_IMAGE,HOST_BASE,True)
 need(live==accepted,'actual-backend-and-whole-static-graph-match-durable-1023-image')
 return live

def ensure_build_space():
 value=json.loads(run(['docker','info','--format','{{json .DockerRootDir}}']));need(type(value)is str and value.startswith('/')and len(value)<4096,'bounded-docker-root')
 v=os.statvfs(value);free=v.f_bavail*v.f_frsize;private(ACTIVE_OUT/'docker-space.private.json',{'root':value,'available':free});run(['docker','system','df'])
 need(free>=4*1024**3,'four-gib-required-no-prune-or-other-cleanup');return free

def image_contract(old,new):
 need(old['Architecture']==new['Architecture']=='amd64'and old['Os']==new['Os']=='linux','same-platform')
 for k in('Cmd','Entrypoint','User','WorkingDir','Healthcheck','ExposedPorts','Volumes','StopSignal','Shell','ArgsEscaped','StopTimeout'):
  need(old['Config'].get(k)==new['Config'].get(k),'same-image-default-'+k.lower())
 a,b=envmap(old['Config'].get('Env')or[]),envmap(new['Config'].get('Env')or[]);need(set(a)==set(b),'same-image-env-keys')
 for k in a:
  need(a[k]==b[k]or k in{'DOTNET_VERSION','ASPNET_VERSION'}and re.fullmatch('8[.]0[.][0-9]{1,4}',a[k])and re.fullmatch('8[.]0[.][0-9]{1,4}',b[k]),'only-dotnet8-patch-image-default-delta')
 need((new['Config'].get('Labels')or{}).get('org.opencontainers.image.revision')==TARGET,'new-image-source-label')

def static_union(built,oldraw,oldproof):
 old=public_files(oldraw['Id']);fresh=public_files(built,True)
 need(file_digests(old)==oldproof['compiledArtifactInventory'],'actual-old-static-graph-sealed')
 for name in TEMPLATES:
  key='wwwroot/'+name;blobs=[git('show',ref+':'+APP+'/web/public/'+name)for ref in(HOST_BASE,BASE,TARGET)]
  need(blobs[0]==blobs[1]==blobs[2]==old.get(key),'three-templates-exact-old-base-target')
  need(key not in fresh or fresh[key]==old[key],'candidate-template-not-conflicting')
  fresh[key]=old[key]
 need(all(n=='wwwroot/index.html'or n in old and old[n]==b or n not in old and n.startswith('wwwroot/assets/')for n,b in fresh.items()),'old-public-resources-never-overwritten-except-index')
 union=dict(old,**fresh);need(1<len(union)<=1000 and sum(map(len,union.values()))<=128*1024**2,'bounded-complete-old-and-new-public-graph')
 folder=ACTIVE_OUT/'static-context';folder.mkdir(mode=0o700)
 for n,b in union.items():
  need(L.safe_path(n)and n.startswith('wwwroot/'),'public-only-static-context');p=folder/n;p.parent.mkdir(mode=0o755,parents=True,exist_ok=True);private(p,b);p.chmod(0o644)
 tag='rr-portal-indo-shipping:pr1027-built-'+TARGET[:12];need(image_id(tag)==built,'unchanged-private-built-base-tag')
 private(folder/'Dockerfile',('FROM '+tag+'\nCOPY --chown=app:app wwwroot/ /app/wwwroot/\n').encode())
 candidate_tag='rr-portal-indo-shipping:pr1027-'+TARGET[:12];run(['docker','build','--pull=false','-t',candidate_tag,str(folder)],timeout=300);candidate=image_id(candidate_tag)
 a,b=image(built),image(candidate);left,right=dict(a['Config']),dict(b['Config']);left.pop('Image',None);right.pop('Image',None)
 need(left==right and b['RootFS']['Layers'][:len(a['RootFS']['Layers'])]==a['RootFS']['Layers'],'static-layer-retains-whole-built-backend-and-runtime')
 value=proof(candidate,TARGET,True);need(value['compiledArtifactInventory']==file_digests(union),'durable-image-whole-static-union-readback')
 return candidate,value

def literal_overlay(old,candidate):
 literal=envmap(old['Config']['Env']);need(set(envmap(image(candidate)['Config'].get('Env')or[]))<=set(literal),'all-new-image-env-defaults-covered-by-original')
 value={'services':{SERVICE:{'image':candidate,'pull_policy':'never','environment':{k:v.replace('$','$$')for k,v in literal.items()}}}}
 # JSON itself cannot express !override; all original literal keys cover defaults,
 # so merging with the unchanged host service yields exactly the sealed map.
 path=ARCHIVE_ROOT/'indo-compose.private.json';private(path,value);rendered_check(path,candidate,literal)
 return path,literal

def rendered_check(path,candidate,literal):
 config=json.loads(run(compose_args(path)+['config','--format','json']));s=config['services'][SERVICE]
 need(s['image']==candidate and s['environment']==literal,'rendered-immutable-image-and-literal-env');return config

def protected(records,own=False):
 value=protected_inventory(records)
 if own:need(value['maintenance'].pop('services/'+SERVICE,None)is not None,'exclude-only-owned-indo-marker')
 return value

def http(relative='',headers=None):
 need(not relative.startswith('/')and '..'not in pathlib.PurePosixPath(relative).parts and '?'not in relative and '#'not in relative,'fixed-readonly-public-relative-path')
 class NoRedirect(urllib.request.HTTPRedirectHandler):
  def redirect_request(self,*a,**k):return None
 opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),NoRedirect())
 req=urllib.request.Request('http://127.0.0.1/indo-shipping/'+urllib.parse.quote(relative,safe='/'),headers={'Host':'8.148.146.194','Cache-Control':'no-cache',**(headers or{})})
 try:
  with opener.open(req,timeout=20)as r:
   b=r.read(64*1024**2+1);need(len(b)<=64*1024**2,'bounded-public-response');return r.status,dict(r.headers),b
 except urllib.error.HTTPError as e:
  try:return e.code,dict(e.headers),e.read(8192)
  finally:e.close()

def public(files,old_headers=None):
 status,headers,body=http();need(status==200 and sha(body)==files['wwwroot/index.html']['sha256'],'public-index-exact')
 for n,v in files.items():
  if n.startswith('wwwroot/assets/')or n.removeprefix('wwwroot/')in TEMPLATES:
   code,_,b=http(n.removeprefix('wwwroot/'));need(code==200 and len(b)==v['bytes']and sha(b)==v['sha256'],'all-old-and-new-static-resources-exact')
 for path in('api/purchase','api/outbound','api/shipments','api/users/me'):
  need(http(path)[0]==401,'anonymous-business-api-rejected')
 need(http('api/health')[0]==200,'public-api-health')
 if old_headers:
  for k,h in(('etag','If-None-Match'),('last-modified','If-Modified-Since')):
   code,_,b=http(headers={h:old_headers[k]});need(code==200 and sha(b)==files['wwwroot/index.html']['sha256'],'old-cache-validator-revalidated')
 return {'index200':True,'health200':True,'allStaticResourcesExact':True,'threeTemplatesExact':True,'anonymousBusiness401':True}

def wait_healthy(cid):
 deadline=time.monotonic()+150;since=None
 while time.monotonic()<deadline:
  r=json.loads(run(['docker','inspect',cid]))[0];need(r['Id']==cid and not r['State']['OOMKilled'],'same-target-no-oom')
  if r['State']['Running']and r['State'].get('Health',{}).get('Status')=='healthy':
   if since is None:since=time.monotonic()
   if time.monotonic()-since>=5:return r
  else:since=None
  time.sleep(2)
 need(False,'same-candidate-healthy-before-any-open')

def ancestor_metadata(cid):
 result={}
 for p,owner in(('/home',(0,0)),('/home/app',KEYRING_OWNER)):
  raw=run(['docker','exec','--user','0',cid,'stat','-c','%f|%a|%u|%g|%s','--',p],timeout=20).decode().strip();need(re.fullmatch('[0-9a-f]+[|][0-7]+[|][0-9]+[|][0-9]+[|][0-9]+',raw)is not None,'bounded-ancestor-metadata');a,b,c,d,e=raw.split('|');bits=int(a,16);value={'mode':int(b,8),'uid':int(c),'gid':int(d)};need(stat.S_ISDIR(bits)and value==dict(mode=0o755,uid=owner[0],gid=owner[1]),'fixed-real-existing-home-ancestor-mode-owner');result[p]=value
 return{'metadata':result,'observedUTC':datetime.datetime.now(datetime.timezone.utc).isoformat(),'observationKind':'running-pre-stop-stat'}

def validate_keyring_tar(blob):
 need(type(blob)is bytes and 0<len(blob)<=KEYRING_MAX,'bounded-private-keyring-tar');entries={};total=0
 with tarfile.open(fileobj=io.BytesIO(blob),mode='r:')as archive:
  for member in archive:
   n=member.name.rstrip('/');need(L.safe_path(n)and n not in entries and not member.issym()and not member.islnk()and(member.isdir()or member.isfile()),'safe-unique-regular-keyring-tar-members');need((member.uid,member.gid)==KEYRING_OWNER,'original-keyring-owner');value={'mode':member.mode,'uid':member.uid,'gid':member.gid,'kind':'directory'if member.isdir()else'file','bytes':member.size}
   if member.isdir():need(n in{'.aspnet','.aspnet/DataProtection-Keys'}and member.mode==0o755 and member.size==0,'only-existing-keyring-directories')
   else:
    match=re.fullmatch(r'\.aspnet/DataProtection-Keys/key-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.xml',n);need(match is not None and member.mode==0o600 and 0<member.size<=65536,'only-bounded-private-data-protection-key-files');data=archive.extractfile(member).read();total+=len(data);need(len(data)==member.size and total<=1024*1024 and b'<!DOCTYPE'not in data.upper()and b'<!ENTITY'not in data.upper(),'complete-bounded-key-file-no-dtd-or-entity');document=ET.fromstring(data);need(document.tag=='key'and str(uuid.UUID(document.attrib.get('id','')))==match[1]and document.attrib.get('version')=='1','canonical-data-protection-key-identity');value['sha256']=sha(data)
   entries[n]=value
 need({'.aspnet','.aspnet/DataProtection-Keys'}<=set(entries)and 1<=sum(v['kind']=='file'for v in entries.values())<=16 and len(entries)<=18,'complete-existing-keyring-with-bounded-count');return entries

def capture_keyring(cid,path,ancestor_ref):
 need(type(ancestor_ref)is dict and ancestor_ref.get('observationKind')=='running-pre-stop-stat'and set(ancestor_ref.get('metadata',{}))=={'/home','/home/app'},'explicit-pre-stop-ancestor-reference');blob=run(['docker','cp','-a',cid+':'+KEYRING_DEST,'-'],timeout=45);private(path/'keyring.private.tar',blob);entries=validate_keyring_tar(blob);return{'tarSHA256':sha(blob),'entries':entries,'ancestors':ancestor_ref['metadata'],'ancestorObservationUTC':ancestor_ref['observedUTC'],'ancestorObservationKind':'running-pre-stop-stat-not-fresh-closed'}

def replay_keyring(value,path):
 p=path/'keyring.private.tar';need(p.is_file()and not p.is_symlink()and stat.S_IMODE(p.stat().st_mode)==0o600 and sha(p.read_bytes())==value['tarSHA256']and validate_keyring_tar(p.read_bytes())==value['entries'],'sealed-full-keyring-tar-bytes-mode-owner-and-shape');need(value['ancestorObservationKind']=='running-pre-stop-stat-not-fresh-closed'and value['ancestors']=={'/home':{'mode':0o755,'uid':0,'gid':0},'/home/app':{'mode':0o755,'uid':1654,'gid':1654}},'sealed-pre-stop-ancestor-metadata')

def startup_checks_sql(tables):
 disabled='$2a$11$m559Cb68j1R4cHfTHJ5tV.z3oeYQyjPGL/mIlkhdltC70AnKNsLyi'
 legacy='''NOT EXISTS (SELECT 1 FROM indo_shipping.users old LEFT JOIN indo_shipping."Users" current ON current."Username"=old.username WHERE current."Id" IS NULL OR current."PasswordHash"='%s')'''%disabled if'users'in tables else'TRUE'
 query='''BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SET LOCAL statement_timeout='30s';
 SELECT jsonb_build_object(
 'adminAlreadyConfigured',EXISTS(SELECT 1 FROM indo_shipping."Users" WHERE "Username"='admin' AND "PasswordHash"<>'%s'),
 'legacyAccountsAlreadyMigrated',%s,
 'oneTimeMigrationsApplied',(SELECT COUNT(*)=3 FROM indo_shipping.settings WHERE key IN ('data_migration:2026-08-13-replace-hs-dictionary-v1','data_migration:2026-08-15-backfill-translations-v1','data_migration:2026-09-05-backfill-supplier-dictionary-v1')AND value='applied'),
 'toolMigrationApplied',EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='indo_shipping.tool_materials'::regclass AND conname='tool_materials_kind_v2_check'),
 'supplierProfilesAlreadyFilled',NOT EXISTS(SELECT 1 FROM indo_shipping.dict_supplier WHERE trim(COALESCE(customs_company,''))=''AND COALESCE(NULLIF(trim(full_name),''),trim(keyword))<>''),
 'purchasePrecisionAlreadyApplied',EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='indo_shipping'AND table_name='po_items'AND column_name='price'AND data_type='numeric'AND numeric_precision=22 AND numeric_scale=8),
 'purchaseMergeColumnsPresent',(SELECT count(*)=8 FROM information_schema.columns WHERE table_schema='indo_shipping'AND((table_name='purchase_orders'AND column_name IN('merged_into_id','merge_revision'))OR(table_name='po_items'AND column_name IN('source_po_no','source_order_date','source_delivery_date','delivery_date_override','has_delivery_date_override'))OR(table_name='po_receipts'AND column_name='spare_qty'))),
 'scheduleCustomerMigrationAlreadyApplied',EXISTS(SELECT 1 FROM pg_attribute a JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid='indo_shipping.schedules'::regclass AND a.attname='customer'AND NOT a.attisdropped AND a.atttypid='text'::regtype AND a.attnotnull AND pg_get_expr(d.adbin,d.adrelid)=$pr1021$'TOMY'::text$pr1021$)AND EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='indo_shipping'AND tablename='schedules'AND indexname='ix_schedules_customer_week'AND indexdef='CREATE UNIQUE INDEX ix_schedules_customer_week ON indo_shipping.schedules USING btree (customer, week_label)')AND NOT EXISTS(SELECT 1 FROM pg_index WHERE indrelid='indo_shipping.schedules'::regclass AND indisunique AND indnatts=1 AND indkey[0]=(SELECT attnum FROM pg_attribute WHERE attrelid='indo_shipping.schedules'::regclass AND attname='week_label')),
 'scheduleHistoryAlreadyCaptured',NOT EXISTS(SELECT 1 FROM indo_shipping.schedules s LEFT JOIN LATERAL(SELECT rows_hash,acknowledged FROM indo_shipping.material_tracking_history WHERE schedule_id=s.id ORDER BY id DESC LIMIT 1)h ON TRUE WHERE h.rows_hash IS NULL OR h.rows_hash<>md5(COALESCE(s.raw_rows::text,'[]'))OR(NOT h.acknowledged AND EXISTS(SELECT 1 FROM indo_shipping.settings completed WHERE completed.key='material_tracking_completed_schedules'AND completed.value::jsonb->>s.id::text=h.rows_hash)))); COMMIT;'''%(disabled,legacy)
 return query.split("SET LOCAL statement_timeout='30s';",1)[1].rsplit('; COMMIT;',1)[0].strip().removesuffix(';')

PG_DETAILS_SELECT="SELECT jsonb_build_object(\n'schema', (SELECT jsonb_build_object('name',nspname,'owner',nspowner::regrole::text,'acl',nspacl::text) FROM pg_namespace WHERE nspname='indo_shipping'),\n'objects',COALESCE((SELECT jsonb_agg(jsonb_build_object('name',c.relname,'kind',c.relkind,'owner',c.relowner::regrole::text,'acl',c.relacl::text,'rls',c.relrowsecurity,'forceRls',c.relforcerowsecurity,'persistence',c.relpersistence) ORDER BY c.relname,c.relkind) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='indo_shipping'),'[]'),\n'constraintFlags',COALESCE((SELECT jsonb_agg(jsonb_build_object('table',c.relname,'name',x.conname,'definition',pg_get_constraintdef(x.oid),'type',x.contype,'validated',x.convalidated,'deferrable',x.condeferrable,'deferred',x.condeferred,'local',x.conislocal,'inheritCount',x.coninhcount,'noInherit',x.connoinherit) ORDER BY c.relname,x.conname) FROM pg_constraint x JOIN pg_class c ON c.oid=x.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='indo_shipping'),'[]'))"

def writable_layer_guard(lines,keyring,static_names):
 need(type(lines)is list and len(lines)<=1000 and type(static_names)is set,'bounded-original-writable-layer');directories={str(p)for n in static_names for p in pathlib.PurePosixPath(n).parents if str(p)!='.'}
 for line in lines:
  match=re.fullmatch(r'([ACD]) (/[^\r\n]+)',line);need(match is not None,'canonical-diff-line');action,p=match[1],match[2]
  if p=='/tmp'or p.startswith('/tmp/'):continue
  if p in{'/home','/home/app','/app','/app/wwwroot','/app/wwwroot/assets'}:need(action=='C','only-known-existing-ancestor-metadata');continue
  relative=p[len('/home/app/'):]if p.startswith('/home/app/')else''
  if action in{'A','C'}and relative in keyring['entries']:continue
  if action in{'A','C'}and p.removeprefix('/app/')in(static_names|directories)and p.startswith('/app/wwwroot/'):continue
  stage=re.fullmatch(r'/app/\.(?:pr(?:1007|1016|1020)-static-[a-f0-9]{40}|pr1023-priority-static-09b09cbf21b2dfb8518c58860fa33237d2123ed5)(?:/(.*))?',p)
  if stage and action in{'A','C'}:
   tail=stage[1]or'';need(tail in{'','new','old-index'}or tail.startswith('new/')and 'wwwroot/'+tail[4:]in(static_names|directories),'only-verified-public-prior-static-stage');continue
  need(False,'unbacked-writable-path-outside-keys-static-and-tmp')

def live_layer_guard(r,snapshot,files):
 lines=run(['docker','diff',r['Id']]).decode().splitlines();private(ACTIVE_OUT/('writable-layer-'+str(SERIAL)+'.private.json'),lines)
 writable_layer_guard(lines,snapshot['keyring'],set(files))
 return {'allWritableDataBackedByPGOrKeyringOrPublicGraph':True}


def pg_capture(db,directory):
 directory.mkdir(mode=0o700);original=OPS.pg_table_sql
 def query(schema,tables):
  need(schema=='indo_shipping'and not {'__startupChecks','__postgresDetails'}&set(tables),'only-full-indo-schema-evidence')
  sql=original(schema,tables).strip().removesuffix(';')
  return "SELECT captured.value || jsonb_build_object('__startupChecks',("+startup_checks_sql(tables)+"),'__postgresDetails',("+PG_DETAILS_SELECT+")) FROM ("+sql+") captured(value);\n"
 OPS.pg_table_sql=query
 try:value=OPS.pg_capture(db,directory,True)['indo_shipping']
 finally:OPS.pg_table_sql=original
 value['startupChecks']=value['tables'].pop('__startupChecks');value['postgresDetails']=value['tables'].pop('__postgresDetails')
 need(value['sequenceStateStableDuringCapture']is True and all(v is True for v in value['startupChecks'].values())and 'users'not in value['tables']and value['tables']['Users']['rows']>0,'all-existing-startup-guards-satisfied')
 need(OPS.NEW_COLUMNS=={}and all(x['sha256']==x['originalColumnsSHA256']for x in value['tables'].values()),'all-actual-row-columns-included-no-projection')
 value['startupSourceSHA256']={n:sha(git('show',TARGET+':'+APP+'/'+n))for n in STARTUP_FILES}
 value['dumpSHA256']=L.file_hash(directory/'indo_shipping.dump');private(directory/'postgres.private.json',value);return value

def sequence_value(v):
 need(type(v)is dict and set(v)=={'lastValue','called'}and type(v['called'])is bool and type(v['lastValue'])is str and re.fullmatch('-?(?:0|[1-9][0-9]{0,19})',v['lastValue']),'typed-sequence-state');return int(v['lastValue'])

def compare_pg(a,b,started):
 need(type(started)is bool and a['sequenceStateStableDuringCapture']is b['sequenceStateStableDuringCapture']is True,'stable-bracketed-non-mvcc-sequences')
 for k in('tables','schema','postgresDetails','startupChecks','startupSourceSHA256'):
  need(a[k]==b[k],'all-full-rows-ids-schema-owner-acl-rls-and-startup-source-identical')
 left,right=a['sequenceStates'],b['sequenceStates'];need(type(left)is dict and set(left)==set(right)and 'Users_Id_seq'in left,'full-sequence-inventory')
 definitions={x['name']:x for x in a['schema']['sequences']};need(len(definitions)==len(a['schema']['sequences'])and set(definitions)==set(left),'exact-complete-sequence-definitions')
 d=definitions['Users_Id_seq'];fixed={'name':'Users_Id_seq','type':'integer','start':'1','increment':'1','min':'1','max':'2147483647','cache':'1','cycle':False,'ownedByTable':'Users','ownedByColumn':'Id','dependencyType':'i'}
 need(all(d.get(k)==v for k,v in fixed.items()),'one-fixed-existing-admin-identity-sequence')
 before=sequence_value(left['Users_Id_seq']);expected=copy.deepcopy(left)
 if started:
  predicted=before+1 if left['Users_Id_seq']['called']else before
  need(1<=predicted<=2147483647,'predicted-single-nextval-no-wrap')
  expected['Users_Id_seq']={'lastValue':str(predicted),'called':True}
 for name in left:sequence_value(left[name]);sequence_value(right[name])
 need(right==expected,'only-predicted-single-admin-conflict-nextval-no-reset-no-extra-gap')
 return {'allRowsIDsSchemaOwnersACLRLSAuthExact':True,'allOtherSequencesExact':True,'usersSequenceSingleStartupConsumption':started,
         'usersSequenceNumericDelta':sequence_value(right['Users_Id_seq'])-before,'sequenceResetPerformed':False,'sequenceEvidenceIndependentlyBracketedNotMVCC':True}

def capture(r,db,directory,ancestor=None):
 directory.mkdir(mode=0o700)
 if r['State']['Running']:ancestor=ancestor_metadata(r['Id'])
 need(ancestor is not None,'explicit-running-reference-before-stop')
 result={'postgres':pg_capture(db,directory/'postgres'),'keyring':capture_keyring(r['Id'],directory,ancestor),'observedUTC':datetime.datetime.now(datetime.timezone.utc).isoformat()}
 private(directory/'capture.private.json',result);return result

def compare_capture(a,b,started):
 need(a['keyring']['entries']==b['keyring']['entries']and a['keyring']['ancestors']==b['keyring']['ancestors'],'all-data-protection-key-bytes-modes-owners-paths-exact')
 return dict(compare_pg(a['postgres'],b['postgres'],started),dataProtectionKeyringExact=True)

def never_started(r):
 s=r['State'];return not s['Running']and s.get('Status')=='created'and s.get('Pid')==0 and s.get('StartedAt','').startswith('0001-')and not s['OOMKilled']and r['RestartCount']==0

def restore_keys(cid,closed,directory,label):
 replay_keyring(closed['keyring'],directory);r=json.loads(run(['docker','inspect',cid]))[0];need(never_started(r),'key-copy-only-before-first-candidate-start')
 run(['docker','cp','-a','-',cid+':/home/app'],(directory/'keyring.private.tar').read_bytes(),45)
 out=ACTIVE_OUT/label;out.mkdir(mode=0o700);ref={'observationKind':'running-pre-stop-stat','metadata':closed['keyring']['ancestors'],'observedUTC':closed['keyring']['ancestorObservationUTC']}
 value=capture_keyring(cid,out,ref);need(value['entries']==closed['keyring']['entries']and value['ancestors']==closed['keyring']['ancestors'],'readback-restored-private-keyring-exact')
 need(json.loads(run(['docker','inspect',cid]))[0]==r,'candidate-still-never-started-after-key-copy');private(out/'proof.private.json',value);return value

def clone_startup(closed,directory,candidate,environment,original_db):
 # Only these two fresh owned containers ever join this internal network.
 token=uuid.uuid4().hex;label='io.rr-portal.pr1027-clone';network='pr1027-'+token;root=ACTIVE_OUT/'clone-startup';root.mkdir(mode=0o700)
 run(['docker','network','create','--internal','--label',label+'='+token,network]);net=json.loads(run(['docker','network','inspect',network]))[0]
 need(net['Internal']is True and (net.get('Labels')or{}).get(label)==token and not net['Containers'],'fresh-owned-internal-network')
 nenv=envmap(original_db['Config'].get('Env')or[]);user=nenv.get('POSTGRES_USER')or'rrportal';name=nenv.get('POSTGRES_DB')or'rrportal'
 need(all(re.fullmatch('[A-Za-z_][A-Za-z0-9_]{0,62}',x)for x in(user,name))and bool(nenv.get('POSTGRES_PASSWORD')),'bounded-original-private-clone-db-identity')
 mounts=[m for m in original_db['Mounts']if m['Destination']=='/var/lib/postgresql/data'];need(len(mounts)==1,'known-pgdata-mount-root')
 pgdata=root/'pgdata';pgdata.mkdir(mode=0o700)
 pg_env={'POSTGRES_USER':user,'POSTGRES_DB':name,'POSTGRES_PASSWORD':nenv['POSTGRES_PASSWORD']}
 pg_env_path=root/'postgres.env.private';env_file(pg_env_path,pg_env)
 pg=run(['docker','create','--network',network,'--network-alias','db','--label',label+'='+token,'--restart','no','--env-file',str(pg_env_path),'--mount','type=bind,src='+str(pgdata)+',dst=/var/lib/postgresql/data',original_db['Image']]).decode().strip();need(pin(pg,64),'owned-full-clone-postgres-id')
 api=None;created={'db':pg}
 def owned(cid,img,expected_mounts):
  r=json.loads(run(['docker','inspect',cid]))[0]
  need(r['Id']==cid and r['Image']==img and (r['Config'].get('Labels')or{}).get(label)==token and r['HostConfig']['RestartPolicy']['Name']=='no'and not r['HostConfig'].get('PortBindings'),'only-owned-unpublished-clone')
  need(set(r['NetworkSettings']['Networks'])=={network}and r['HostConfig']['NetworkMode']==network,'clone-only-owned-internal-network')
  if expected_mounts:need('db'in(r['NetworkSettings']['Networks'][network].get('Aliases')or[]),'private-postgres-has-only-required-db-alias')
  actual={m['Destination']:(m['Type'],m['Source'],m['RW'])for m in r['Mounts']};need(actual==expected_mounts,'only-owned-clone-mounts');return r
 pg_mount={'/var/lib/postgresql/data':('bind',str(pgdata),True)};owned(pg,original_db['Image'],pg_mount)
 run(['docker','start',pg]);deadline=time.monotonic()+90
 while True:
  p=subprocess.run(['docker','exec',pg,'pg_isready','-U',user,'-d',name],stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=10)
  if p.returncode==0:break
  need(time.monotonic()<deadline,'private-postgres-ready');time.sleep(2)
 # This is the sole restore and its target is the proven fresh private CID.
 owned(pg,original_db['Image'],pg_mount)
 run(['docker','exec','-i',pg,'pg_restore','--exit-on-error','--username',user,'--dbname',name],(directory/'postgres/indo_shipping.dump').read_bytes(),300)
 restored=pg_capture(pg,root/'restored-before');compare_pg(closed['postgres'],restored,False)
 api_env=root/'api.env.private';env_file(api_env,environment)
 api=run(['docker','create','--network',network,'--label',label+'='+token,'--restart','no','--env-file',str(api_env),candidate]).decode().strip();need(pin(api,64),'owned-full-clone-api-id');created['api']=api
 r=owned(api,candidate,{});need(never_started(r),'private-api-created-once-before-start')
 restore_keys(api,closed,directory,'clone-restored-keyring');run(['docker','start',api]);wait_healthy(api)
 after=capture(json.loads(run(['docker','inspect',api]))[0],pg,root/'after-start');counts=compare_capture(closed,after,True)
 # Record both identities and logs before cleaning only these owned resources.
 for name,cid in created.items():
  img=original_db['Image']if name=='db'else candidate;m=pg_mount if name=='db'else{}
  private(root/(name+'-inspect.private.json'),owned(cid,img,m));private(root/(name+'-logs.private'),run(['docker','logs',cid]))
 net=json.loads(run(['docker','network','inspect',network]))[0];need(set(net['Containers'])==set(created.values())and net['Internal']is True,'internal-clone-network-has-only-two-owned-cids')
 for name in('api','db'):
  cid=created[name];owned(cid,original_db['Image']if name=='db'else candidate,pg_mount if name=='db'else{})
  run(['docker','stop','--timeout','30',cid],timeout=60);run(['docker','rm',cid])
 net=json.loads(run(['docker','network','inspect',network]))[0];need(not net['Containers']and net['Internal']is True and(net.get('Labels')or{}).get(label)==token,'only-own-empty-clone-network-before-remove');run(['docker','network','rm',network])
 return dict(counts,actualCandidateStartupOnPrivatePostgresClone=True,ownedCloneCleaned=True,productionDatabaseRestorePerformed=False)

def env_file(path,value):
 need(all(type(k)is str and re.fullmatch('[A-Za-z_][A-Za-z0-9_]*',k)and type(v)is str and '\n'not in v and '\r'not in v and '\0'not in v for k,v in value.items()),'safe-private-literal-clone-env-file')
 private(path,(''.join(k+'='+v+'\n'for k,v in value.items())).encode())
def runtime_check(old,new,recipe,created=False):
 need(old['Mounts']==new['Mounts']==[]and new['Image']==recipe['image']and new['Id']!=old['Id']and new['RestartCount']==0,'only-indo-recreated-with-immutable-candidate')
 need(not new['State']['OOMKilled']and(never_started(new)if created else new['State']['Running']and new['State'].get('Health',{}).get('Status')=='healthy'),'created-before-first-start-or-healthy-after')
 a,b=copy.deepcopy(old['Config']),copy.deepcopy(new['Config']);left=a.pop('Labels')or{};right=b.pop('Labels')or{}
 for k in('Image','Hostname','Env'):a.pop(k,None);b.pop(k,None)
 need(a==b and envmap(new['Config']['Env'])==recipe['environment'],'complete-runtime-config-and-literal-env-preserved')
 need(new['Config']['Hostname']==new['Id'][:12]and old['Config']['Hostname']==old['Id'][:12],'only-automatic-hostname')
 x,y=copy.deepcopy(old['HostConfig']),copy.deepcopy(new['HostConfig'])
 for z in(x,y):
  if z.get('OomKillDisable')in(None,False):z['OomKillDisable']=False
 need(H.same_host_config(x,y),'whole-hostconfig-resources-ports-security-preserved')
 metadata={'com.docker.compose.project.config_files':str(ROOT/'docker-compose.cloud.yml')+','+recipe['overlay'],'com.docker.compose.project.environment_file':str(ARCHIVE_ROOT/'environment.private')}
 need(all(right.get(k)==v for k,v in metadata.items()),'new-compose-invocation-metadata-bound')
 permitted={'com.docker.compose.config-hash','com.docker.compose.image','com.docker.compose.version','com.docker.compose.replace','org.opencontainers.image.revision',*metadata}
 need({k:v for k,v in left.items()if k not in permitted}=={k:v for k,v in right.items()if k not in permitted}and right.get('org.opencontainers.image.revision')==TARGET,'only-known-compose-and-revision-label-changes')
 need(right.get('com.docker.compose.image')==recipe['image'],'runtime-compose-image-label-exact')
 if not created:
  need(process_environment(new['Id'])==recipe['processEnvironment'],'complete-original-process-environment-preserved')
  need(proof(new['Id'],TARGET)==recipe['proof'],'actual-running-pdb-source-and-static-graph-equal-prepared')

def sealed(phase,digest):
 directory=ARCHIVE_ROOT/phase;need(pin(digest)and L.file_hash(directory/'manifest.json')==digest,'prior-phase-manifest-seal')
 actual=manifest(directory);actual.pop('manifest.json',None);actual.pop('result.private.json',None)
 need(actual==read(directory/'manifest.json'),'every-prior-private-evidence-file-byte-exact')
 result=read(directory/'result.private.json');need(result.get('success')is True and result.get('phase')==phase and result.get('target')==TARGET and result.get('tree')==TREE and result.get('appTree')==APP_TREE and result.get('head')==HEAD and result.get('manifestSHA256')==digest,'successful-prior-source-bound-phase')
 return directory,result

def prepared():
 directory,_=sealed('prepare',PREPARED_SHA256);p=read(directory/'prepared.private.json')
 need(p['target']==TARGET and p['tree']==TREE and p['appTree']==APP_TREE and p['hostBase']==HOST_BASE,'prepared-source-contract')
 need(host_files()==p['hostFiles']and L.file_hash(ARCHIVE_ROOT/'environment.private')==p['environmentFileSHA256'],'host-files-and-private-env-still-exact');return p

def request(path):
 need(path.startswith('/')and'..'not in pathlib.PurePosixPath(path.split('?')[0]).parts,'fixed-readonly-probe')
 class NoRedirect(urllib.request.HTTPRedirectHandler):
  def redirect_request(self,*a,**k):return None
 opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),NoRedirect())
 try:
  with opener.open(urllib.request.Request('http://127.0.0.1'+path,headers={'Cache-Control':'no-cache'}),timeout=20)as r:r.read(1024*1024);return r.status
 except urllib.error.HTTPError as e:
  try:e.read(1024*1024);return e.code
  finally:e.close()

def public_neighbors():
 values={p:request(p)for p in('/','/paiji/health','/internal-quote/health','/sprayplan/api/health','/sprayplan-test/api/health')}
 need(values['/']in(200,401)and all(v==200 for k,v in values.items()if k!='/'),'all-other-public-systems-still-available');return values

def prepare():
 need(not PREPARED_SHA256 and not DEPLOY_SHA256,'prepare-no-prior-seals')
 before=runtime();r=one();db=database(before);guard=db_guard(r,db);old=image(r['Image']);oldproof=old_source(r)
 hosts=host_files();protection=protected(before);private(ARCHIVE_ROOT/'environment.private',(ROOT/'.env.cloud.production').read_bytes())
 private(ACTIVE_OUT/'current-runtime.private.json',before);private(ACTIVE_OUT/'protected.private.json',protection);private(ACTIVE_OUT/'original-indo.private.json',r);private(ACTIVE_OUT/'original-postgres.private.json',db)
 free=ensure_build_space();public_neighbors();public(oldproof['compiledArtifactInventory']);_,headers,_=http();old_headers={k.lower():v for k,v in headers.items()if k.lower()in('etag','last-modified')};need(set(old_headers)=={'etag','last-modified'},'both-original-index-cache-validators')
 source=ACTIVE_OUT/'source';extract_source(source);tag='rr-portal-indo-shipping:pr1027-built-'+TARGET[:12]
 run(['docker','build','--label','org.opencontainers.image.revision='+TARGET]+compose_build_labels(SERVICE,old)+['--build-arg','VITE_BASE_PATH=/indo-shipping/','-t',tag,str(source/APP)],timeout=1800)
 built=image_id(tag);image_contract(old,image(built));proof(built,TARGET,True);candidate,candidate_proof=static_union(built,r,oldproof);image_contract(old,image(candidate))
 overlay,literal=literal_overlay(r,candidate);online_dir=ACTIVE_OUT/'online-before';online=capture(r,db['Id'],online_dir);live_layer_guard(r,online,oldproof['compiledArtifactInventory'])
 clone=clone_startup(online,online_dir,candidate,literal,db)
 after=runtime();runtime_others_exact(before,after);need(protected(after)==protection and host_files()==hosts and db_guard(one(),database(after))==guard,'prepare-original-runtime-env-auth-host-unchanged')
 value={'target':TARGET,'tree':TREE,'appTree':APP_TREE,'hostBase':HOST_BASE,'runtime':before,'oldRuntime':r,'oldDatabase':db,'oldProof':oldproof,'hostFiles':hosts,'protected':protection,'priorAlias':ACCEPTED_DURABLE_IMAGE,'oldHeaders':old_headers,'guard':guard,'onlineClone':clone,'environmentFileSHA256':L.file_hash(ARCHIVE_ROOT/'environment.private'),
        'service':{'image':candidate,'builtImage':built,'overlay':str(overlay),'overlaySHA256':L.file_hash(overlay),'environment':literal,'processEnvironment':process_environment(r['Id']),'proof':candidate_proof}}
 private(ACTIVE_OUT/'prepared.private.json',value)
 return {'durableImage':candidate,'liveBackendImage':r['Image'],'candidateRealPostgresCloneStartupVerified':True,'liveLifecycleChanged':False,'allOriginalContainersUnchanged':True,'bindTypes':bind_source_type_summary(protection),'availableDockerBytes':free,'buildCachePruned':False}

def deploy():
 p=prepared();need(not DEPLOY_SHA256,'deploy-no-prior-deploy-seal');r=one();before=runtime();db=database(before);recipe=p['service']
 need(before==p['runtime']and r['Id']==p['oldRuntime']['Id']and db['Id']==p['oldDatabase']['Id']and protected(before)==p['protected']and db_guard(r,db)==p['guard']and image_id(ALIAS)==p['priorAlias'],'same-prepared-original-contract')
 overlay=pathlib.Path(recipe['overlay']);need(L.file_hash(overlay)==recipe['overlaySHA256'],'private-literal-overlay-still-exact');rendered_check(overlay,recipe['image'],recipe['environment'])
 owned=gate_on(SERVICE);need(http()[0]==503 and http('api/health')[0]==503,'only-indo-ingress-gated');public_neighbors();time.sleep(60)
 need(runtime()==before and protected(before,True)==p['protected']and host_files()==p['hostFiles'],'drained-original-runtime-config-and-auth-exact')
 ancestors=ancestor_metadata(r['Id']);private(ACTIVE_OUT/'last-running-ancestors.private.json',ancestors)
 run(['docker','stop','--timeout','30',r['Id']],timeout=60);stopped=one(False);need(stopped['Id']==r['Id']and not stopped['State']['Running'],'only-original-indo-writer-stopped-once')
 cold_dir=ACTIVE_OUT/'cold-before';cold=capture(stopped,db['Id'],cold_dir,ancestors);live_layer_guard(stopped,cold,p['oldProof']['compiledArtifactInventory'])
 gate_assert(owned);need(protected(before,True)==p['protected']and host_files()==p['hostFiles'],'cold-host-env-auth-protection')
 # Recreate stopped, copy back sealed keyring, then start this new CID exactly once.
 run(compose_args(overlay)+['up','--no-start','--force-recreate','--no-build','--no-deps','--pull','never',SERVICE],timeout=180)
 created=one(False);runtime_check(r,created,recipe,True);private(ACTIVE_OUT/'created-before-start.private.json',created)
 runtime_others_exact(before,runtime(),r['Id'],created['Id']);restore_keys(created['Id'],cold,cold_dir,'formal-restored-keyring')
 prestart=pg_capture(db['Id'],ACTIVE_OUT/'prestart-postgres');compare_pg(cold['postgres'],prestart,False)
 gate_assert(owned);need(never_started(json.loads(run(['docker','inspect',created['Id']]))[0]),'only-one-first-start-new-candidate')
 run(['docker','start',created['Id']],timeout=60);new=wait_healthy(created['Id']);runtime_check(r,new,recipe)
 after_dir=ACTIVE_OUT/'startup-after';after=capture(new,db['Id'],after_dir);live_layer_guard(new,after,recipe['proof']['compiledArtifactInventory']);comparisons=compare_capture(cold,after,True)
 now=runtime();runtime_others_exact(before,now,r['Id'],new['Id']);need(protected(now,True)==p['protected']and host_files()==p['hostFiles']and db_guard(new,database(now))==p['guard'],'all-other-runtime-env-auth-and-host-files-unchanged')
 time.sleep(11);wait_healthy(new['Id']);public_neighbors();gate_assert(owned)
 need(image_id(ALIAS)==p['priorAlias'],'prior-durable-alias-still-observed-value');run(['docker','tag',recipe['image'],ALIAS]);need(image_id(ALIAS)==recipe['image'],'new-durable-alias-exact')
 need(runtime()==now and protected(now,True)==p['protected']and host_files()==p['hostFiles'],'all-guards-still-exact-before-open')
 private(ACTIVE_OUT/'successful-runtime.private.json',now);private(ACTIVE_OUT/'data-comparisons.private.json',comparisons);gate_off(owned)
 try:public_result=public(recipe['proof']['compiledArtifactInventory'],p['oldHeaders'])
 except BaseException:
  try:gate_on(SERVICE)
  except BaseException:pass
  raise
 return {'newContainer':new['Id'],'durableImage':recipe['image'],'priorBackendImage':r['Image'],'publishedRevision':TARGET,'maintenanceCleared':True,'public':public_result,'allExistingRowsIDsSchemaPermissionsAndKeysPreserved':True,'usersSequenceExactSingleStartupConsumption':True,'allOtherContainersIncludingPostgresAndTestUnchanged':True,'productionDatabaseRestorePerformed':False,'hostSourceCheckoutPerformed':False}

def verify():
 p=prepared();directory,result=sealed('deploy',DEPLOY_SHA256);r=one();recipe=p['service'];current=runtime()
 need(current==read(directory/'successful-runtime.private.json')and r['Id']==result['newContainer'],'same-successful-runtime-after-open')
 runtime_check(p['oldRuntime'],r,recipe);need(protected(current)==p['protected']and host_files()==p['hostFiles']and image_id(ALIAS)==recipe['image']and db_guard(r,database(current))==p['guard'],'final-auth-env-host-and-durable-alias-exact')
 gate=ROOT/'deploy/maintenance/services'/SERVICE;need(not gate.exists()and not gate.is_symlink(),'own-service-maintenance-cleared')
 value=public(recipe['proof']['compiledArtifactInventory']);neighbors=public_neighbors()
 return {'verificationReadOnly':True,'durableImage':recipe['image'],'frontendAndBackendSourceRevision':TARGET,'public':value,'businessEqualityCheckedOnlyDuringOwnedMaintenance':True,'hostSourceKeptAtPriorBase':True}

def main():
 global ACTIVE_OUT
 need(EXECUTE is True and PHASE in('prepare','deploy','verify')and sys.argv[1:]==[PHASE],'inert-first-phase')
 need(os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_MODE')==PHASE and os.environ.get('RELEASE_ATTEMPT')=='1','first-exact-branch-attempt')
 os.umask(0o077);need(ARCHIVE_ROOT.parent.is_dir()and not ARCHIVE_ROOT.parent.is_symlink(),'existing-private-backup-parent');ARCHIVE_ROOT.mkdir(mode=0o700,exist_ok=True)
 need(not ARCHIVE_ROOT.is_symlink()and stat.S_IMODE(ARCHIVE_ROOT.stat().st_mode)==0o700,'private-task-archive');ACTIVE_OUT=ARCHIVE_ROOT/PHASE
 need(not ACTIVE_OUT.exists()and not ACTIVE_OUT.is_symlink(),'single-attempt-phase');ACTIVE_OUT.mkdir(mode=0o700);initialize()
 result={'phase':PHASE,'base':BASE,'head':HEAD,'target':TARGET,'tree':TREE,'appTree':APP_TREE,'hostBase':HOST_BASE,'sourceCheckoutDeferredToPendingInvoice':True,'success':False}
 try:source_check();result.update({'prepare':prepare,'deploy':deploy,'verify':verify}[PHASE]());result['success']=True
 except Exception as e:result.update(errorType=type(e).__name__,stage=STAGE,noAutomaticRecoveryOrLifecycleRetry=True)
 result['utc']=datetime.datetime.now(datetime.timezone.utc).isoformat();private(ACTIVE_OUT/'manifest.json',manifest(ACTIVE_OUT));result['manifestSHA256']=L.file_hash(ACTIVE_OUT/'manifest.json')
 if result['success']and PHASE=='prepare':result['preparedSHA256']=result['manifestSHA256']
 if result['success']and PHASE=='deploy':result['deployEvidenceSHA256']=result['manifestSHA256']
 private(ACTIVE_OUT/'result.private.json',result);result['resultSHA256']=sha(enc(result))
 result['sha256Wire']={k:[int(c,16)for c in(v.split(':',1)[1]if v.startswith('sha256:')else v)]for k,v in result.items()if type(v)is str and re.fullmatch('(?:sha256:)?[a-f0-9]{64}|[a-f0-9]{40}',v)}
 print(json.dumps(result,sort_keys=True),flush=True);return 0 if result['success']else 1

if __name__=='__main__':sys.exit(main())
