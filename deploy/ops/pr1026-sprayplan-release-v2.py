"""Inert draft: one-service SprayPlan release with exact line-name upgrade only.

No host checkout/shared configuration edits or database restore. Production data
is never passed to seed/capacity/rename scripts. Unknown lifecycle is not retried.
V2 first proves the prior private probe HTTP health and missing metadata before
cleaning only that owned probe; the production source remains the reviewed merge.
"""
import contextlib, copy, datetime, hashlib, importlib.util, io, json, os, pathlib, re, shutil, sqlite3, stat
import subprocess, sys, tarfile, time, urllib.error, urllib.request, uuid, shlex
ROOT = pathlib.Path('/opt/rr-portal')
ARCHIVE_ROOT = ROOT / 'deploy/backups/pr1026-sprayplan-20261028-v2'
FAILED_PREPARE = ROOT / 'deploy/backups/pr1026-sprayplan-20261028/prepare'
FAILED_MANIFEST_SHA256 = 'bd71d6e128475775527dc95c763677986dd64f6a076a1550e2be20d387dc90f9'
FAILED_RESULT_SHA256 = '3aca881a07925108d56193f06514928f40a0f357c94f5a1ebee294e4250489f0'
OUT = None
ACTIVE_OUT = None
BASE = 'cd0118ff0ed5f2eeed8bec039e346ae7e0466df7'
HOST_BASE = '4b3d8f3e319e41dcc8720d759e1af0726a2b2381'
HEAD = '935dc348e08c2a6c02afbd9366f320865bdac9b1'
APP_TREE = '61de8aae3fe757f15ce3c9ab1f7b7bd1e81d7eda'
EXPECTED_TARGET = 'a68dcec89d58d21f7b178787d664dd36fa44336b'
EXPECTED_TREE = '3fcd2bdb40269d43a8f788a3e51b133637e64d67'
BRANCH = 'refs/heads/ops/pr-1026-20261028-sprayplan'
TARGET = 'a68dcec89d58d21f7b178787d664dd36fa44336b'
TREE = '3fcd2bdb40269d43a8f788a3e51b133637e64d67'
PHASE = 'verify'
EXECUTE = True
PREPARED_SHA256 = '8a11f0085bcbb1064ef0c623cc6981c88be50b5ad7a51435a0908ef471adc71f'
DEPLOY_SHA256 = 'c9c8bbf74760905ef120a6058b1912bcb28be98f23b2f4da863c914d3e75bb03'
APP = 'apps/喷油部/喷油排期系统'
SERVICES = ('sprayplan',)
SERVICE = 'sprayplan'
ALIAS = 'rr-portal-sprayplan:latest'
ACCEPTED_OLD_IMAGE = 'sha256:4391097e3c20113a6ebcb85b4661f27e1f810a9b18da0ee50aa9459830e7ccc7'
ACCEPTED_OLD_APP_TREE = '0def42680cf359661a55eb1af120c817d0cfa834'
DEPS = {'pr1012-compose-library-v2.py':'bbf49ca20451f5c503bc807f71590dca8f20061590d0e78300551f302c386027',
        'pr1012-data-library.py':'b937a93ac5d08ba93bb684270e3d05d13d58dc6ecf90af5e1306aec30cec0eb3',
        'release-data-library.py':'d63168fd3057f4f2aba2d93f9fab31d2d65c6dd0f3234877d71fcff1e04e62b9'}
CODE_FILES = ('docker-entrypoint.sh','next.config.mjs','prisma/schema.prisma','.next/BUILD_ID','.next/required-server-files.json',
              'server/SprayPlan.Api/appsettings.json','server/SprayPlan.Api/publish/SprayPlan.Api.dll',
              'server/SprayPlan.Api/publish/SprayPlan.Api.deps.json','server/SprayPlan.Api/publish/SprayPlan.Api.runtimeconfig.json')
REVIEWED_PATHS = ('prisma/rename-lines.ts','prisma/schema.prisma','prisma/seed.ts','prisma/setup-line-capacity.ts',
                 'server/SprayPlan.Api.Tests/Basic/LineNamesUpgradeTests.cs','server/SprayPlan.Api/Data/LineNamesUpgrade.cs',
                 'server/SprayPlan.Api/Program.cs','src/app/basic/BasicDataManager.tsx','src/lib/line.ts','tests/unit/prisma/renameLines.test.ts')
UPGRADE_SQL = """UPDATE production_lines
SET name = CASE craftType WHEN '手喷' THEN 'A拉：手喷' ELSE 'B拉：自动喷' END
WHERE factoryId = 'XINGXIN' AND (
    (craftType = '手喷' AND name IN ('B拉', 'B拉：手喷')) OR
    (craftType = '自动喷' AND name IN ('A拉', 'A拉：自动喷'))
);"""
C = None
D = None
L = None
SERIAL = 0
STAGE = 'entry'
RECOVERY = {}

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
 p=subprocess.run(args,input=data,stdout=subprocess.PIPE,stderr=subprocess.PIPE,cwd=ROOT,timeout=timeout)
 if ACTIVE_OUT is not None:
  private(ACTIVE_OUT/('%03d.stdout.private'%SERIAL),p.stdout);private(ACTIVE_OUT/('%03d.stderr.private'%SERIAL),p.stderr)
 need(p.returncode==0,'command-'+pathlib.Path(args[0]).name);return p.stdout


def git(*args):return run(['git','-c','core.hooksPath=/dev/null',*args])


def load(name):
 p=pathlib.Path(__file__).with_name(name);need(p.is_file()and not p.is_symlink()and sha(p.read_bytes())==DEPS[name],'reviewed-library-'+name)
 s=importlib.util.spec_from_file_location(name.replace('.','_'),p);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m


def initialize():
 global C,D,L
 for n,h in DEPS.items():
  p=pathlib.Path(__file__).with_name(n);need(p.is_file()and not p.is_symlink()and sha(p.read_bytes())==h,'all-library-pins-before-import')
 C=load('pr1012-compose-library-v2.py');D=load('pr1012-data-library.py');L=load('release-data-library.py')


def env(r):return C.environment(r['Config'].get('Env')or[])


def one(service,healthy=True):
 need(service in SERVICES,'only-two-services')
 ids=run(['docker','ps','-aq','--no-trunc','--filter','label=com.docker.compose.project=rr-portal','--filter','label=com.docker.compose.service='+service]).decode().split();need(len(ids)==1,'unique-service-'+service)
 r=json.loads(run(['docker','inspect',ids[0]]))[0];C.mounts(service,r,str(ROOT))
 if healthy:need(r['State']['Running']and not r['State']['OOMKilled']and r['State'].get('Health',{}).get('Status')=='healthy','healthy-'+service)
 return r


def image(image_id):
 need(re.fullmatch('sha256:[a-f0-9]{64}',image_id or''),'immutable-image-id')
 r=json.loads(run(['docker','image','inspect',image_id]))[0];need(r['Id']==image_id,'same-image-id');return r


def contract(r):return {'id':r['Id'],'image':r['Image'],'config':sha(enc(r['Config'])),'host':sha(enc(r['HostConfig'])),'mounts':sha(enc(sorted(r['Mounts'],key=enc)))}


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


def code_file(cid,path):
 blob=run(['docker','cp',cid+':/app/'+path,'-'])
 with tarfile.open(fileobj=io.BytesIO(blob))as t:
  rows=t.getmembers();need(len(rows)==1 and rows[0].isfile()and rows[0].size<=64*1024**2,'one-bounded-code-file');raw=t.extractfile(rows[0]).read();need(len(raw)==rows[0].size,'complete-code-file');return raw


def code_proof(cid):return {p:sha(code_file(cid,p))for p in CODE_FILES}


def scratch_proof(image_id,service):
 folder=ACTIVE_OUT/(service+'-scratch-'+image_id.split(':',1)[1][:12]);folder.mkdir(mode=0o700);mounts={}
 for name,dest in(('data','/app/data'),('storage','/app/server/SprayPlan.Api/storage')):
  p=folder/name;p.mkdir(mode=0o700);mounts[dest]=str(p)
 token=uuid.uuid4().hex;args=['docker','create','--network','none','--restart','no','--log-driver','none','--label','io.rr-portal.pr1018-release='+token,'--entrypoint','/bin/true']
 for dest,src in mounts.items():args+=['--mount','type=bind,src='+src+',dst='+dest]
 cid=run(args+[image_id]).decode().strip();need(re.fullmatch('[a-f0-9]{64}',cid),'full-owned-scratch-id')
 try:return code_proof(cid)
 finally:
  r=json.loads(run(['docker','inspect',cid]))[0];s=r['State'];actual={m['Destination']:m for m in r['Mounts']}
  need(r['Id']==cid and r['Image']==image_id and(r['Config'].get('Labels')or{}).get('io.rr-portal.pr1018-release')==token and not s['Running']and s['Pid']==0 and s['StartedAt'].startswith('0001-')and r['HostConfig']['NetworkMode']=='none','only-own-neverstarted-scratch')
  need(set(actual)==set(mounts)and all(actual[d]['Type']=='bind'and actual[d]['Source']==p and actual[d]['RW']for d,p in mounts.items())and all(not list(pathlib.Path(p).iterdir())for p in mounts.values()),'only-own-empty-scratch-binds')
  run(['docker','rm',cid])


def guard(service,r):
 mounts=C.mounts(service,r,str(ROOT));e=env(r);data=pathlib.Path(next(m['source']for m in mounts if m['target']=='/app/data'));storage=pathlib.Path(next(m['source']for m in mounts if m['target'].endswith('/storage')))
 need(data.is_dir()and storage.is_dir()and not data.is_symlink()and not storage.is_symlink(),'existing-both-bind-roots')
 need(e.get('DATA_PATH')=='/app/data'and e.get('SPRAYPLAN_DB_PATH','/app/data/sprayplan.db')=='/app/data/sprayplan.db'and e.get('NEXT_PUBLIC_BASE_PATH')=='/'+service and e.get('DOTNET_API_URL')=='http://127.0.0.1:5080','existing-database-and-api-routing')
 db=data/'sprayplan.db';need(db.is_file()and not db.is_symlink()and db.stat().st_size>0,'existing-db-prevents-seed')
 with db.open('rb')as f:need(f.read(16)==b'SQLite format 3\0','existing-valid-main-db')
 with contextlib.closing(L.connect(db,False))as conn:
  need(conn.execute('PRAGMA quick_check').fetchone()[0]=='ok','healthy-main-sqlite');tables={x[0]for x in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")};need({'users','orders','production_plans'}<=tables,'existing-business-auth-schema')
  need(conn.execute('SELECT count(*) FROM users').fetchone()[0]>0 and conn.execute("SELECT count(*) FROM users WHERE role='admin' AND isActive=1 AND length(passwordHash)>0").fetchone()[0]>0,'existing-active-admin-no-seed')
 secret=e.get('JWT_SECRET');p=data/'jwt-secret';filemeta=None;filehash=None
 if p.exists():
  need(p.is_file()and not p.is_symlink(),'existing-regular-jwt-file');a=p.stat();raw=p.read_bytes();b=p.stat();need((a.st_ino,a.st_size,a.st_mtime_ns)==(b.st_ino,b.st_size,b.st_mtime_ns),'stable-jwt-file');filemeta={'mode':stat.S_IMODE(a.st_mode),'uid':a.st_uid,'gid':a.st_gid};filehash=sha(raw)
  if not secret:secret=raw.rstrip(b'\n').decode()
 need(type(secret)is str and len(secret.encode())>=32,'existing-strong-authoritative-jwt-key')
 return {'effectiveKeySHA256':sha(secret.encode()),'fileSHA256':filehash,'fileMetadata':filemeta,'issuer':e.get('JWT_ISSUER')or'sprayplan','databaseExisting':True,'startupSeedAndKeyGenerationBlocked':True}


def compose_args(overlay):return ['docker','compose','--project-name','rr-portal','--project-directory',str(ROOT),'--env-file',str(ARCHIVE_ROOT/'environment.private'),'-f',str(ROOT/'docker-compose.cloud.yml'),'-f',str(overlay)]


def rendered_check(service,path,overlay):
 r=json.loads(run(compose_args(path)+['config','--format','json']));return C.validate_rendered(service,r,overlay)


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


def paths(s):return ['/'+s,'/'+s+'/api/health','/'+s+'/api/orders']


def probes(s):return {p:request(p)for p in paths(s)}


def internal_health(cid,service):
 script="Promise.all([fetch('http://127.0.0.1:8400/"+service+"/api/health',{redirect:'manual'}),fetch('http://127.0.0.1:5080/api/orders',{redirect:'manual'})]).then(async r=>{await Promise.all(r.map(x=>x.arrayBuffer()));if(r[0].status!==200||r[1].status!==401)process.exit(2);console.log(JSON.stringify({next:r[0].status,dotnet:r[1].status}))}).catch(()=>process.exit(3))"
 return json.loads(run(['docker','exec',cid,'node','-e',script],timeout=30))


def wait_healthy(service,cid):
 deadline=time.monotonic()+120;since=None
 while time.monotonic()<deadline:
  r=one(service,False);need(r['Id']==cid,'same-new-container')
  if r['State']['Running']and not r['State']['OOMKilled']and r['State'].get('Health',{}).get('Status')=='healthy':
   if since is None:since=time.monotonic()
   if time.monotonic()-since>=5:internal_health(cid,service);return r
  else:since=None
  time.sleep(2)
 raise RuntimeError('target-not-healthy')


def runtime_check(service,old,new,recipe):
 need(new['Image']==recipe['image'],'exact-candidate-runtime-image');need(C.mounts(service,new,str(ROOT))==C.mounts(service,old,str(ROOT)),'same-both-bind-definitions');need(env(new)==recipe['environment'],'all-protected-env-exact')
 a,b=dict(old['Config']),dict(new['Config'])
 for k in('Image','Hostname','Env','Labels'):a.pop(k,None);b.pop(k,None)
 need(a==b,'runtime-user-command-workingdir-health-exact')
 a,b=dict(old['HostConfig']),dict(new['HostConfig'])
 for k in('Binds','Mounts','ContainerIDFile'):a.pop(k,None);b.pop(k,None)
 need(a==b,'runtime-resources-restart-ports-security-exact')
 labels_a,labels_b=old['Config'].get('Labels')or{},new['Config'].get('Labels')or{};allowed={'com.docker.compose.config-hash','com.docker.compose.image','com.docker.compose.version','com.docker.compose.replace','org.opencontainers.image.revision'}
 expected_overlay=str(ARCHIVE_ROOT/(service+'-compose.private.json'));need(recipe['overlay']==expected_overlay,'fixed-service-private-compose-overlay')
 metadata={'com.docker.compose.project.config_files':str(ROOT/'docker-compose.cloud.yml')+','+expected_overlay,'com.docker.compose.project.environment_file':str(ARCHIVE_ROOT/'environment.private')}
 need(all(labels_b.get(k)==v for k,v in metadata.items()),'exact-new-compose-invocation-metadata');allowed|=set(metadata)
 need({k:v for k,v in labels_a.items()if k not in allowed}=={k:v for k,v in labels_b.items()if k not in allowed},'all-other-runtime-labels-exact')
 hostname=old['Config'].get('Hostname');need(new['Config'].get('Hostname')==(new['Id'][:12]if hostname==old['Id'][:12]else hostname),'only-automatic-hostname-changes')
 need(code_proof(new['Id'])==recipe['code'],'new-next-and-dotnet-code-exact')


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
 p,dev,ino=owned;need(p.is_file()and not p.is_symlink()and(p.stat().st_dev,p.stat().st_ino)==(dev,ino),'only-owned-service-gate')


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
 need(all(re.fullmatch('[a-f0-9]{40}',v or '') for v in (TARGET,TREE,HEAD,APP_TREE))
      and TARGET==EXPECTED_TARGET and TREE==EXPECTED_TREE,'final-reviewed-source-bound')
 git('fetch','--no-write-fetch-head','origin','+refs/heads/main:refs/remotes/origin/main')
 need(git('rev-parse','origin/main').decode().strip()==TARGET and git('rev-parse',TARGET+'^{tree}').decode().strip()==TREE
      and git('rev-parse',HEAD+'^{tree}').decode().strip()==TREE and git('rev-parse',TARGET+':'+APP).decode().strip()==APP_TREE,'exact-reviewed-source-tree')
 need(git('rev-parse','HEAD').decode().strip()==HOST_BASE,'host-checkout-kept-at-4b')
 changed={n.decode() for n in git('diff','--name-only','-z',BASE,TARGET).split(bytes([0])) if n}
 need(changed=={APP+'/'+n for n in REVIEWED_PATHS},'only-ten-reviewed-app-paths')
 need(git('rev-parse',BASE+':'+APP).decode().strip()==ACCEPTED_OLD_APP_TREE,'old-app-tree-matches-last-sprayplan-release')
 for name in ('Dockerfile','docker-entrypoint.sh','server/SprayPlan.Api/appsettings.json'):
  need(git('show',BASE+':'+APP+'/'+name)==git('show',TARGET+':'+APP+'/'+name),'startup-seed-and-settings-unchanged')
 raw=git('show',TARGET+':'+APP+'/server/SprayPlan.Api/Data/LineNamesUpgrade.cs').decode()
 found=re.search('ExecuteSqlRawAsync[(]"""(.*?)"""[)]',raw,re.S)
 need(found is not None and ' '.join(found[1].split())==' '.join(UPGRADE_SQL.split()),'exact-reviewed-line-name-sql')
 # Prisma schema change is a comment only; never run db push against live data.
 def uncomment(raw):return bytes([10]).join(line.split(b'//',1)[0].rstrip() for line in raw.splitlines())
 need(uncomment(git('show',BASE+':'+APP+'/prisma/schema.prisma'))==uncomment(git('show',TARGET+':'+APP+'/prisma/schema.prisma')),'prisma-structural-schema-identical')


def capture(r,directory,closed=True):
 directory.mkdir(mode=0o700);result={}
 for mount in C.mounts(SERVICE,r,str(ROOT)):
  label='data' if mount['target']=='/app/data' else 'storage'
  result[label]=D.capture(SERVICE,pathlib.Path(mount['source']),directory/label,closed,L,root_label=label)
 need('sprayplan.db' in result['data']['sqlite'],'actual-existing-primary-db-in-dynamic-set')
 return result


def clone_capture(before,directory,label):
 root=ACTIVE_OUT/label;root.mkdir(mode=0o700);paths={}
 for part,value in before.items():
  dest=root/part;dest.mkdir(mode=0o700);paths[part]=dest
  with tarfile.open(directory/part/'other-files.tar') as archive:
   members={m.name:m for m in archive.getmembers()}
   need(set(members)=={item['path'] for item in value['files']},'complete-private-clone-file-set')
   for item in value['files']:
    name=item['path'];member=members[name];need(L.safe_path(name) and (member.isdir() if item['directory'] else member.isfile()),'safe-clone-files-only')
    path=dest/name
    if item['directory']:path.mkdir(mode=0o700,parents=True,exist_ok=True)
    else:path.parent.mkdir(mode=0o700,parents=True,exist_ok=True);private(path,archive.extractfile(member).read())
  for name,meta in value['databaseMetadata'].items():
   need(L.safe_path(name),'safe-clone-db-name');path=dest/name;path.parent.mkdir(mode=0o700,parents=True,exist_ok=True)
   shutil.copyfile(directory/part/'sqlite'/name,path)
   os.chown(path,meta['uid'],meta['gid']);os.chmod(path,meta['mode'])
  for item in sorted(value['files'],key=lambda v:len(pathlib.PurePosixPath(v['path']).parts),reverse=True):
   path=dest/item['path'];os.chown(path,item['uid'],item['gid']);os.chmod(path,item['mode'])
  meta=value['rootMetadata'];os.chown(dest,meta['uid'],meta['gid']);os.chmod(dest,meta['mode'])
 return root,paths


def expected_names(before,directory,label):
 root,paths=clone_capture(before,directory,label);path=paths['data']/'sprayplan.db'
 old=before['data']['sqlite']['sprayplan.db']
 with contextlib.closing(sqlite3.connect(path)) as db:
  columns=[r[1] for r in db.execute('PRAGMA table_info(production_lines)')]
  need({'id','name','factoryId','craftType'}<=set(columns),'typed-line-name-upgrade-schema')
  indices={n:columns.index(n) for n in ('id','name','factoryId','craftType')}
  rows=list(db.execute('SELECT * FROM production_lines ORDER BY id'));predicted=[];count=0
  for row in rows:
   item=list(row);name=item[indices['name']];craft=item[indices['craftType']]
   if item[indices['factoryId']]=='XINGXIN':
    if craft=='手喷' and name in ('B拉','B拉：手喷'):item[indices['name']]='A拉：手喷';count+=1
    elif craft=='自动喷' and name in ('A拉','A拉：自动喷'):item[indices['name']]='B拉：自动喷';count+=1
   predicted.append(tuple(item))
  cursor=db.execute(UPGRADE_SQL);need(cursor.rowcount==count,'exact-predicted-eligible-line-count');db.commit()
  need(list(db.execute('SELECT * FROM production_lines ORDER BY id'))==predicted,'only-predicted-line-name-by-id-and-all-columns')
  audit=D.sqlite_audit(db,L);a,b=copy.deepcopy(old),copy.deepcopy(audit)
  a['tables'].pop('production_lines');b['tables'].pop('production_lines')
  need(a==b,'sql-no-schema-sequence-auth-or-other-table-effects')
  need(db.execute(UPGRADE_SQL).rowcount==0,'second-line-name-upgrade-is-noop');db.commit()
  need(D.sqlite_audit(db,L)==audit,'second-upgrade-has-no-persistent-effects')
 expected=copy.deepcopy(before);expected['data']['sqlite']['sprayplan.db']=audit
 private(ACTIVE_OUT/(label+'-expected.private.json'),expected)
 return expected,count


def compare_expected(expected,after,require_closed=True):
 result={name:D.compare(expected[name],after[name]) for name in ('data','storage')}
 need(all(v['preserved'] and (v['deploymentAttributionPermitted'] or not require_closed) for v in result.values()),'all-persistent-data-exact-except-predicted-main-line-names')
 return result


def clone_startup(before,directory,candidate,environment,label):
 # The actual entrypoint starts Next and .NET on isolated cloned mounts only.
 root,paths=clone_capture(before,directory,label)
 env_path=root/'runtime.env.private';need(all(not any(c in k+v for c in ('\n','\r')) for k,v in environment.items()),'single-line-private-probe-env')
 private(env_path,(''.join(k+'='+v+chr(10) for k,v in sorted(environment.items()))).encode())
 token=uuid.uuid4().hex
 health_script="Promise.all([fetch('http://127.0.0.1:8400/sprayplan/api/health',{redirect:'manual',signal:AbortSignal.timeout(5000)}),fetch('http://127.0.0.1:5080/api/orders',{redirect:'manual',signal:AbortSignal.timeout(5000)})]).then(async r=>{await Promise.all(r.map(x=>x.arrayBuffer()));if(r[0].status!==200||r[1].status!==401)process.exit(2);}).catch(()=>process.exit(3));"
 args=['docker','create','--network','none','--restart','no','--health-cmd','node -e '+shlex.quote(health_script),
       '--health-interval','2s','--health-timeout','8s','--health-retries','30','--health-start-period','10s',
       '--label','io.rr-portal.pr1026-probe='+token,'--env-file',str(env_path)]
 for part,destination in (('data','/app/data'),('storage','/app/server/SprayPlan.Api/storage')):
  args+=['--mount','type=bind,source='+str(paths[part])+',target='+destination]
 cid=run(args+[candidate]).decode().strip();need(re.fullmatch('[a-f0-9]{64}',cid),'owned-private-startup-probe-id')
 run(['docker','start',cid]);healthy=False
 for _ in range(90):
  record=json.loads(run(['docker','inspect',cid]))[0]
  need(record['Id']==cid and record['Image']==candidate and record['HostConfig']['NetworkMode']=='none'
       and (record['Config'].get('Labels')or{}).get('io.rr-portal.pr1026-probe')==token,'same-owned-private-startup-probe')
  if record['State'].get('Health',{}).get('Status')=='healthy':healthy=True;break
  if not record['State']['Running']:break
  time.sleep(2)
 need(healthy,'real-candidate-private-clone-startup-healthy');internal_health(cid,SERVICE)
 run(['docker','stop','--timeout','30',cid],timeout=60)
 record=json.loads(run(['docker','inspect',cid]))[0]
 need(record['State']['Running'] is False and record['Id']==cid and record['Image']==candidate,'owned-clone-stopped-before-audit')
 after={name:D.capture(SERVICE,path,root/('capture-'+name),True,L,root_label=name) for name,path in paths.items()}
 # The capture's physical roots are clones, so normalize those provenance fields
 # only for logical comparison; the raw clone captures stay in private evidence.
 for name in after:after[name]['sourceRoot']=before[name]['sourceRoot']
 expected,count=expected_names(before,directory,label+'-sql-reference');compare_expected(expected,after,False)
 run(['docker','rm',cid]);return {'renamedLines':count,'actualCloneStartupComparedToIndependentSQL':True}


def runtime_others_exact(before,after,old_id=None,new_id=None):
 old=dict(before);new=dict(after)
 if old_id is not None:need(old.pop(old_id,None) is not None and new.pop(new_id,None) is not None,'only-formal-sprayplan-cid-replaced')
 need(old==new,'every-other-container-including-test-unchanged')


def protected(records,own=False):
 result=protected_inventory(records)
 if own:need(result['maintenance'].pop('services/sprayplan',None) is not None,'only-owned-formal-gate-excluded')
 return result


def public_neighbors():
 result={p:request(p) for p in ('/','/paiji/health','/indo-shipping/api/health','/internal-quote/health','/sprayplan-test/api/health')}
 need(result['/'] in (200,401) and all(v==200 for p,v in result.items() if p!='/'),'portal-paiji-indo-quote-and-spray-test-available')
 return result


def write_phase_seal(value):
 private(ACTIVE_OUT/'manifest.json',manifest(ACTIVE_OUT));value['manifestSHA256']=L.file_hash(ACTIVE_OUT/'manifest.json')


def sealed(phase,digest):
 directory=ARCHIVE_ROOT/phase;need(pin(digest) and L.file_hash(directory/'manifest.json')==digest,'exact-prior-phase-manifest')
 actual=manifest(directory);actual.pop('manifest.json',None);actual.pop('result.private.json',None)
 need(actual==read(directory/'manifest.json'),'all-prior-private-evidence-seals')
 result=read(directory/'result.private.json')
 need(result.get('success') is True and result.get('phase')==phase and result.get('target')==TARGET
      and result.get('tree')==TREE and result.get('appTree')==APP_TREE and result.get('head')==HEAD
      and result.get('manifestSHA256')==digest,'successful-source-bound-prior-phase')
 return directory,result


def prepared():
 directory,_=sealed('prepare',PREPARED_SHA256);p=read(directory/'prepared.private.json')
 need(p['target']==TARGET and p['tree']==TREE and p['appTree']==APP_TREE and p['hostBase']==HOST_BASE,'exact-prepared-source-contract')
 need(host_files()==p['hostFiles'] and L.file_hash(ARCHIVE_ROOT/'environment.private')==p['environmentFileSHA256'],'host-files-and-private-env-kept-before-each-phase');return p


def cleanup_failed_private_probe():
 # Only this formerly created private probe may be stopped/removed. Old static
 # logs/manifest remain sealed; its two mounted clone trees are mutable evidence.
 raw=file_record(FAILED_PREPARE/'manifest.json')[1];need(sha(raw)==FAILED_MANIFEST_SHA256,'exact-original-failed-prepare-manifest')
 entries=json.loads(raw);logged=set();images=set();drift=[]
 for name,digest in entries.items():
  need(L.safe_path(name) and pin(digest),'safe-original-failed-evidence-name')
  path=FAILED_PREPARE/name;need(not any(p.is_symlink() for p in (path,*path.parents)),'original-failed-evidence-has-no-link-components')
  mutable=name.startswith(('online-clone-startup/data/','online-clone-startup/storage/'))
  try:matches=L.file_hash(path)==digest
  except (OSError,RuntimeError):matches=False
  if mutable:
   if not matches:drift.append(name)
   continue
  need(matches,'original-static-failed-evidence-still-exact')
  if not re.fullmatch('[0-9]{3}[.]stdout[.]private',name) or path.stat().st_size>4*1024**2:continue
  value=path.read_bytes()
  if re.fullmatch(b'[a-f0-9]{64}\n',value):logged.add(value.decode().strip())
  try:record=json.loads(value)
  except (ValueError,UnicodeError):continue
  if type(record)is list:
   for item in record:
    if type(item)is dict and re.fullmatch('sha256:[a-f0-9]{64}',str(item.get('Id',''))) and (item.get('Config',{}).get('Labels')or{}).get('org.opencontainers.image.revision')==TARGET:images.add(item['Id'])
 result=json.loads(file_record(FAILED_PREPARE/'result.private.json')[1])
 need(sha(enc(result))==FAILED_RESULT_SHA256 and result.get('success') is False and result.get('target')==TARGET
      and result.get('stage')=='real-candidate-private-clone-startup-healthy','exact-original-failed-receipt-before-own-probe-cleanup')
 actual={str(p.relative_to(FAILED_PREPARE)) for p in FAILED_PREPARE.rglob('*') if p.is_file() and p.name not in ('manifest.json','result.private.json')}
 need(all(n.startswith(('online-clone-startup/data/','online-clone-startup/storage/')) for n in actual.symmetric_difference(entries))
      and all(not p.is_symlink() for p in FAILED_PREPARE.rglob('*')),'only-original-mounted-clone-files-may-drift')
 mutable_inventory={}
 for name in sorted(actual):
  if not name.startswith(('online-clone-startup/data/','online-clone-startup/storage/')):continue
  path=FAILED_PREPARE/name;record={'metadata':metadata(path),'originalSealSHA256':entries.get(name)}
  try:record['currentSHA256']=L.file_hash(path)
  except (OSError,RuntimeError) as error:record['currentHashUnavailableType']=type(error).__name__
  mutable_inventory[name]=record
  if record.get('currentSHA256')!=entries.get(name):drift.append(name)
 private(ACTIVE_OUT/'original-mutable-clone-before-cleanup.private.json',mutable_inventory)
 ids=run(['docker','ps','-aq','--no-trunc','--filter','label=io.rr-portal.pr1026-probe']).decode().split()
 need(len(ids)==1 and ids[0] in logged,'one-original-own-probe-from-sealed-create-output')
 old=json.loads(run(['docker','inspect',ids[0]]))[0];cid=old['Id'];mounts=old['Mounts']
 expected={'/app/data':str(FAILED_PREPARE/'online-clone-startup/data'),'/app/server/SprayPlan.Api/storage':str(FAILED_PREPARE/'online-clone-startup/storage')}
 need(cid==ids[0] and old['Image'] in images and old['HostConfig']['NetworkMode']=='none'
      and re.fullmatch('[a-f0-9]{32}',(old['Config'].get('Labels')or{}).get('io.rr-portal.pr1026-probe',''))
      and len(mounts)==2 and {m['Destination'] for m in mounts}==set(expected)
      and all(m['Type']=='bind' and m['Source']==expected[m['Destination']] and m['RW'] is True for m in mounts),'only-original-owned-candidate-with-private-clone-binds')
 private(ACTIVE_OUT/'original-failed-probe-before-cleanup.private.json',old)
 run(['docker','logs','--timestamps','--tail','2000',cid])
 need(old['State']['Running'] is True and not old['State']['OOMKilled']
      and not old['Config'].get('Healthcheck') and 'Health' not in old['State'],'original-probe-running-without-health-definition-or-state')
 http=internal_health(cid,SERVICE)
 need(http=={'next':200,'dotnet':401},'original-private-probe-http-is-healthy-before-any-cleanup')
 diagnosis={'missingHealthDefinition':True,'next200':True,'dotnet401':True}
 private(ACTIVE_OUT/'original-failed-probe-http-diagnosis.private.json',diagnosis)
 stopped=False
 if old['State']['Running']:
  run(['docker','stop','--timeout','30',cid],timeout=60);stopped=True
 current=json.loads(run(['docker','inspect',cid]))[0]
 need(current['Id']==cid and current['Image']==old['Image'] and not current['State']['Running']
      and current['Config']==old['Config'] and sorted(current['Mounts'],key=enc)==sorted(mounts,key=enc),'same-owned-probe-stopped-once-before-removal')
 run(['docker','rm',cid])
 need(sha(file_record(FAILED_PREPARE/'manifest.json')[1])==FAILED_MANIFEST_SHA256
      and all(L.file_hash(FAILED_PREPARE/name)==digest for name,digest in entries.items()
              if not name.startswith(('online-clone-startup/data/','online-clone-startup/storage/'))),'original-static-evidence-exact-after-own-probe-cleanup')
 private(ACTIVE_OUT/'old-clone-mutable-drift.private.json',sorted(set(drift)))
 return {'originalFailedPrivateProbeRemoved':True,'originalProbeStoppedOnce':stopped,'oldStaticEvidencePreserved':True,'oldMutableCloneCheckpointPossible':True,'mutableCloneFilesDrifted':len(set(drift)),'clonePreflightDiagnosis':diagnosis}


def prepare():
 need(not PREPARED_SHA256 and not DEPLOY_SHA256,'prepare-only-blank-prior-seals')
 cleanup=cleanup_failed_private_probe()
 before=runtime();r=one(SERVICE);old=image(r['Image']);accepted=image(ACCEPTED_OLD_IMAGE)
 need(image_id(ALIAS)==r['Image'],'fresh-current-canonical-alias-matches-actual-service')
 live=code_proof(r['Id']);need(live==scratch_proof(ACCEPTED_OLD_IMAGE,SERVICE),'actual-old-next-dotnet-code-equals-accepted-last-release')
 C.image_contract(accepted,old,BASE);guarded=guard(SERVICE,r);hosts=host_files();protection=protected(before);start_probes=probes(SERVICE);internal_health(r['Id'],SERVICE)
 need(start_probes=={'/sprayplan':401,'/sprayplan/api/health':200,'/sprayplan/api/orders':401},'original-public-authorization-state')
 private(ARCHIVE_ROOT/'environment.private',(ROOT/'.env.cloud.production').read_bytes())
 private(ACTIVE_OUT/'current-runtime.private.json',before);private(ACTIVE_OUT/'protected.private.json',protection)
 source=ACTIVE_OUT/'source';extract_source(source);tag='rr-portal-sprayplan:pr1026-'+TARGET[:12]
 run(['docker','build','--label','org.opencontainers.image.revision='+TARGET]+compose_build_labels(SERVICE,old)+['--build-arg','NEXT_PUBLIC_BASE_PATH=/sprayplan','--tag',tag,str(source/APP)],timeout=1800)
 candidate=json.loads(run(['docker','image','inspect',tag]))[0];C.image_contract(old,candidate,TARGET)
 overlay=C.literal_overlay(SERVICE,r,old,candidate,TARGET,str(ROOT));overlay_path=ARCHIVE_ROOT/(SERVICE+'-compose.private.json');private(overlay_path,overlay);rendered_check(SERVICE,overlay_path,overlay)
 proof=scratch_proof(candidate['Id'],SERVICE)
 need(proof['server/SprayPlan.Api/appsettings.json']==live['server/SprayPlan.Api/appsettings.json']==sha(git('show',TARGET+':'+APP+'/server/SprayPlan.Api/appsettings.json')),'unchanged-exact-settings')
 environment=C.preserved_environment(r,old,candidate,TARGET)
 captured_dir=ACTIVE_OUT/'online-before';captured=capture(r,captured_dir,False)
 clone=clone_startup(captured,captured_dir,candidate['Id'],environment,'online-clone-startup')
 after=runtime();runtime_others_exact(before,after);need(protected(after)==protection and host_files()==hosts,'prepare-keeps-original-runtime-auth-env-and-config')
 value={'target':TARGET,'tree':TREE,'appTree':APP_TREE,'hostBase':HOST_BASE,'runtime':before,'oldRuntime':r,'hostFiles':hosts,'protected':protection,
        'service':{'image':candidate['Id'],'tag':tag,'overlay':str(overlay_path),'overlaySHA256':sha(enc(overlay)),'environment':environment,'code':proof,'guard':guarded},
        'priorAlias':r['Image'],'probes':start_probes,'onlineClone':clone,'environmentFileSHA256':L.file_hash(ARCHIVE_ROOT/'environment.private')}
 private(ACTIVE_OUT/'prepared.private.json',value)
 return {'durableImage':candidate['Id'],'liveBackendImage':r['Image'],'candidateRealCloneStartupVerified':True,'liveLifecycleChanged':False,
         'discoveredSQLiteFiles':sum(len(x['sqlite']) for x in captured.values()),'bindTypes':bind_source_type_summary(protection),'priorPrivateProbeCleanup':cleanup,'clonePreflightDiagnosis':cleanup['clonePreflightDiagnosis'],'ownedFailedProbeCleaned':True}


def image_id(value):
 rows=json.loads(run(['docker','image','inspect',value]));need(len(rows)==1,'one-local-image-or-alias');return rows[0]['Id']


def deploy():
 p=prepared();need(not DEPLOY_SHA256,'deploy-no-prior-deploy-slot');old=one(SERVICE);recipe=p['service']
 before=runtime();need(before==p['runtime'] and contract(old)==contract(p['oldRuntime']) and protected(before)==p['protected']
                     and guard(SERVICE,old)==recipe['guard'] and image_id(ALIAS)==p['priorAlias'],'same-prepared-live-formal-service')
 overlay_path=pathlib.Path(recipe['overlay']);need(sha(overlay_path.read_bytes())==recipe['overlaySHA256'],'private-literal-overlay-still-exact')
 rendered_check(SERVICE,overlay_path,read(overlay_path));image(recipe['image']);owned=gate_on(SERVICE)
 need(all(v==503 for v in probes(SERVICE).values()),'only-formal-service-ingress-gated');public_neighbors();time.sleep(60)
 need(runtime()==before and protected(before,True)==p['protected'] and host_files()==p['hostFiles'],'drained-runtime-config-auth-still-exact')
 run(['docker','stop','--timeout','30',old['Id']],timeout=60);stopped=one(SERVICE,False)
 need(stopped['Id']==old['Id'] and not stopped['State']['Running'],'original-formal-service-stopped-once')
 need(guard(SERVICE,stopped)==recipe['guard'],'cold-authoritative-jwt-and-db-preserved')
 cold_dir=ACTIVE_OUT/'cold-before';cold=capture(stopped,cold_dir)
 expected,count=expected_names(cold,cold_dir,'cold-expected')
 # The target was already tested on a complete clone during prepare. Re-derive
 # exact expected rows from this fresh cold snapshot, never edit the live DB.
 gate_assert(owned);need(protected(before,True)==p['protected'] and host_files()==p['hostFiles'],'gate-config-and-auth-before-recreate')
 run(compose_args(overlay_path)+['up','-d','--no-deps','--no-build','--pull','never','--force-recreate',SERVICE],timeout=240)
 new=one(SERVICE,False);need(new['Id']!=old['Id'] and new['Image']==recipe['image'],'only-new-formal-candidate-container')
 new=wait_healthy(SERVICE,new['Id']);runtime_check(SERVICE,old,new,recipe);need(guard(SERVICE,new)==recipe['guard'],'same-effective-auth-key-and-admin-after-start')
 after_dir=ACTIVE_OUT/'startup-after';after=capture(new,after_dir);comparisons=compare_expected(expected,after)
 current=runtime();runtime_others_exact(before,current,old['Id'],new['Id'])
 need(protected(current,True)==p['protected'] and host_files()==p['hostFiles'],'all-env-auth-bind-metadata-and-host-files-preserved')
 time.sleep(11);internal_health(new['Id'],SERVICE);public_neighbors();gate_assert(owned)
 need(image_id(ALIAS)==p['priorAlias'],'prior-alias-unchanged-before-promotion');run(['docker','tag',recipe['image'],ALIAS]);need(image_id(ALIAS)==recipe['image'],'formal-canonical-image-exact')
 need(runtime()==current and protected(current,True)==p['protected'] and host_files()==p['hostFiles'],'all-protection-still-exact-before-opening')
 private(ACTIVE_OUT/'successful-runtime.private.json',current);private(ACTIVE_OUT/'data-comparisons.private.json',comparisons)
 gate_off(owned)
 try:
  public=probes(SERVICE);need(public==p['probes'],'formal-next-api-auth-state-restored')
 except BaseException:
  # Re-close only this service using a fresh O_EXCL inode after an open check
  # fails; never replace/remove another operator's marker or repeat lifecycle.
  try:gate_on(SERVICE)
  except BaseException:pass
  raise
 return {'newContainer':new['Id'],'durableImage':recipe['image'],'priorBackendImage':old['Image'],'publishedRevision':TARGET,'renamedLines':count,
         'onlyExpectedMainDatabaseLineNamesChanged':True,'allOtherDatabaseRowsAuthFilesOwnersExact':True,'testAndAllOtherContainersUnchanged':True,
         'bothNextAndDotnetVerified':True,'maintenanceCleared':True,'public':public,'databaseRestoreOrMigrationScriptRun':False}


def verify():
 p=prepared();directory,result=sealed('deploy',DEPLOY_SHA256);r=one(SERVICE);recipe=p['service'];current=runtime()
 need(current==read(directory/'successful-runtime.private.json') and r['Id']==result['newContainer'],'same-successful-runtime-after-open')
 runtime_check(SERVICE,p['oldRuntime'],r,recipe);need(guard(SERVICE,r)==recipe['guard'],'final-auth-key-and-existing-admin')
 need(protected(current)==p['protected'] and host_files()==p['hostFiles'] and image_id(ALIAS)==recipe['image'],'final-env-auth-source-and-alias-protection')
 gate=ROOT/'deploy/maintenance/services/sprayplan';need(not gate.exists() and not gate.is_symlink(),'formal-maintenance-cleared')
 internal_health(r['Id'],SERVICE);public=probes(SERVICE);need(public==p['probes'],'final-formal-public-authorization');neighbors=public_neighbors()
 return {'verificationReadOnly':True,'frontendAndBackendSourceRevision':TARGET,'durableImage':recipe['image'],'public':public,'neighbors':neighbors,
         'businessEqualityCheckedOnlyDuringOwnMaintenance':True,'hostSourceKeptAtPriorBase':True}


def main():
 global ACTIVE_OUT,OUT
 need(EXECUTE is True and PHASE in ('prepare','deploy','verify') and sys.argv[1:]==[PHASE],'inert-first-phase')
 need(os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_MODE')==PHASE and os.environ.get('RELEASE_ATTEMPT')=='1','first-exact-branch-attempt')
 os.umask(0o077);initialize();need(ARCHIVE_ROOT.parent.is_dir() and not ARCHIVE_ROOT.parent.is_symlink(),'existing-private-backup-parent')
 ARCHIVE_ROOT.mkdir(mode=0o700,exist_ok=True);need(not ARCHIVE_ROOT.is_symlink() and stat.S_IMODE(ARCHIVE_ROOT.stat().st_mode)==0o700,'private-task-archive')
 ACTIVE_OUT=ARCHIVE_ROOT/PHASE;need(not ACTIVE_OUT.exists() and not ACTIVE_OUT.is_symlink(),'single-attempt-phase');ACTIVE_OUT.mkdir(mode=0o700);OUT=ACTIVE_OUT
 result={'phase':PHASE,'base':BASE,'head':HEAD,'target':TARGET,'tree':TREE,'appTree':APP_TREE,'hostBase':HOST_BASE,
         'sourceCheckoutDeferredToPendingInvoice':True,'success':False}
 try:source_check();result.update({'prepare':prepare,'deploy':deploy,'verify':verify}[PHASE]());result['success']=True
 except Exception as error:result.update(errorType=type(error).__name__,stage=STAGE,noAutomaticRecoveryOrLifecycleRetry=True)
 result['utc']=datetime.datetime.now(datetime.timezone.utc).isoformat();write_phase_seal(result)
 if result['success'] and PHASE=='prepare':result['preparedSHA256']=result['manifestSHA256']
 if result['success'] and PHASE=='deploy':result['deployEvidenceSHA256']=result['manifestSHA256']
 private(ACTIVE_OUT/'result.private.json',result);result['resultSHA256']=sha(enc(result))
 result['sha256Wire']={k:[int(c,16) for c in (v.split(':',1)[1] if v.startswith('sha256:') else v)] for k,v in result.items() if type(v)is str and re.fullmatch('(?:sha256:)?[a-f0-9]{64}|[a-f0-9]{40}',v)}
 print(json.dumps(result,sort_keys=True),flush=True);return 0 if result['success'] else 1


if __name__=='__main__':sys.exit(main())
