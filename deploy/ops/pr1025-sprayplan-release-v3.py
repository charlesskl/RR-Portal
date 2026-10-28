"""Inert draft: one-service SprayPlan release with additive empty materials schema only.

No host checkout/shared configuration edits or database restore. Production data
is never passed to seed/capacity/rename scripts. Unknown lifecycle is not retried.
Source constants remain unbound until the final application review and merge.
The existing orders, schedules, production results and auth rows stay unchanged.
"""
import contextlib, copy, datetime, hashlib, importlib.util, io, json, os, pathlib, re, shutil, sqlite3, stat
import subprocess, sys, tarfile, time, urllib.error, urllib.request, uuid, shlex, textwrap
ROOT = pathlib.Path('/opt/rr-portal')
ARCHIVE_ROOT = ROOT / 'deploy/backups/pr1025-sprayplan-20261028-v3'
OUT = None
ACTIVE_OUT = None
BASE = 'a68dcec89d58d21f7b178787d664dd36fa44336b'
HOST_BASE = '4b3d8f3e319e41dcc8720d759e1af0726a2b2381'
HEAD = 'f169b7a7fb72363cc8bf683a463808c6701c4a29'
APP_TREE = 'f905bfb09adc691dffc5cccaf94366dd4bc86d7e'
EXPECTED_TARGET = '9d942c021e3d307e89ad1a8ea1a2425199fced1b'
EXPECTED_TREE = 'cca7cc28b67067460dde16c66efb08d0b0c882b5'
BRANCH = 'refs/heads/ops/pr-1025-r3-20261028-sprayplan'
TARGET = '9d942c021e3d307e89ad1a8ea1a2425199fced1b'
TREE = 'cca7cc28b67067460dde16c66efb08d0b0c882b5'
PHASE = 'prepare'
EXECUTE = True
PREPARED_SHA256 = ''
DEPLOY_SHA256 = ''
APP = 'apps/喷油部/喷油排期系统'
SERVICES = ('sprayplan',)
SERVICE = 'sprayplan'
ALIAS = 'rr-portal-sprayplan:latest'
ACCEPTED_OLD_IMAGE = 'sha256:7bf8fd2e48be3a07979fb9bd91016f31d759452ecf290dd4e20b4a3e5994b8e2'
ACCEPTED_OLD_APP_TREE = '61de8aae3fe757f15ce3c9ab1f7b7bd1e81d7eda'
DEPS = {'pr1012-compose-library-v2.py':'bbf49ca20451f5c503bc807f71590dca8f20061590d0e78300551f302c386027',
        'pr1012-data-library.py':'b937a93ac5d08ba93bb684270e3d05d13d58dc6ecf90af5e1306aec30cec0eb3',
        'release-data-library.py':'d63168fd3057f4f2aba2d93f9fab31d2d65c6dd0f3234877d71fcff1e04e62b9'}
CODE_FILES = ('docker-entrypoint.sh','next.config.mjs','prisma/schema.prisma','.next/BUILD_ID','.next/required-server-files.json',
              'server/SprayPlan.Api/appsettings.json','server/SprayPlan.Api/publish/SprayPlan.Api.dll',
              'server/SprayPlan.Api/publish/SprayPlan.Api.deps.json','server/SprayPlan.Api/publish/SprayPlan.Api.runtimeconfig.json')
REVIEWED_PATHS = ('README.md', 'playwright.order-parts.config.ts', 'prisma/migrations/20261028000000_add_order_materials/migration.sql', 'prisma/schema.prisma', 'server/SprayPlan.Api.Tests/Materials/MaterialReadinessTests.cs', 'server/SprayPlan.Api.Tests/Materials/MaterialSchemaTests.cs', 'server/SprayPlan.Api/Data/AppDbContext.cs', 'server/SprayPlan.Api/Entities/OrderMaterial.cs', 'server/SprayPlan.Api/Features/Materials/MaterialsController.cs', 'server/SprayPlan.Api/Features/Plans/PlanDtos.cs', 'server/SprayPlan.Api/Features/Plans/PlansController.cs', 'server/SprayPlan.Api/Features/Schedule/MonthlyDtos.cs', 'server/SprayPlan.Api/Features/Schedule/ScheduleController.cs', 'server/SprayPlan.Api/Features/Schedule/UrgentController.cs', 'server/SprayPlan.Api/Program.cs', 'server/SprayPlan.Api/Services/DemandScheduleAdjustment.cs', 'server/SprayPlan.Api/Services/MaterialReflow.cs', 'server/SprayPlan.Api/Services/MaterialReflowWorker.cs', 'server/SprayPlan.Api/Services/MaterialSchema.cs', 'src/app/orders/[id]/OrderDetailEditor.tsx', 'src/app/schedule/MaterialReadinessDialog.tsx', 'src/app/schedule/ScheduleOverview.tsx', 'tests/browser/material-readiness.spec.ts')
MATERIAL_SCHEMA_SHA256 = 'fc82d7c729ac657eddb94fdd49b7da82e1a177451e9046752667bbe2bec1ff4f'
MATERIAL_WORKER_SHA256 = '6ebde66199ec26639b441e85cca1d9a64dccd921bfe32382a6b6af7fe9cb488d'
MATERIAL_SQL = """CREATE TABLE IF NOT EXISTS order_materials (
  id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  factoryId TEXT NOT NULL DEFAULT 'XINGXIN', orderId INTEGER NOT NULL, partName TEXT NOT NULL,
  arrivedQty INTEGER NOT NULL DEFAULT 0, expectedDate BIGINT, actualDate BIGINT, remark TEXT,
  source TEXT NOT NULL DEFAULT 'manual', autoScheduleEnabled INTEGER NOT NULL DEFAULT 1, version INTEGER NOT NULL DEFAULT 0,
  updatedAt BIGINT NOT NULL, updatedBy TEXT NOT NULL, lastReflowDate BIGINT,
  configuration TEXT NOT NULL DEFAULT '[]', history TEXT NOT NULL DEFAULT '[]',
  CONSTRAINT order_materials_orderId_fkey FOREIGN KEY (orderId) REFERENCES orders(id) ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS order_materials_factoryId_orderId_partName_key ON order_materials(factoryId, orderId, partName);"""
MATERIAL_INDEX = 'order_materials_factoryId_orderId_partName_key'
MATERIAL_COLUMNS = (('id','INTEGER',1,None,1),('factoryId','TEXT',1,"'XINGXIN'",0),('orderId','INTEGER',1,None,0),
 ('partName','TEXT',1,None,0),('arrivedQty','INTEGER',1,'0',0),('expectedDate','BIGINT',0,None,0),
 ('actualDate','BIGINT',0,None,0),('remark','TEXT',0,None,0),('source','TEXT',1,"'manual'",0),
 ('autoScheduleEnabled','INTEGER',1,'1',0),('version','INTEGER',1,'0',0),('updatedAt','BIGINT',1,None,0),
 ('updatedBy','TEXT',1,None,0),('lastReflowDate','BIGINT',0,None,0),('configuration','TEXT',1,"'[]'",0),('history','TEXT',1,"'[]'",0))
C = None
D = None
L = None
SERIAL = 0
STAGE = 'entry'
RECOVERY = {}
GIT_DOCKERFILE_SHA256='5144cbcad44a54d4c751a441ac091853fa67b78e9ce7b0df6ee8d3e562781f35'
PRIOR_R2_MANIFEST_SHA256='cee91ca3f19d40b660078209ee64df85128a627dbecc976216ea01b5efa34d10'
PRIOR_R2_RESULT_SHA256='60c38a09eceff574e253be36545cb0bba7cf1b23eb7a1f72d74589e8dda15f3b'

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
 need(all(re.fullmatch('[a-f0-9]{40}',v or '') for v in (BASE,TARGET,TREE,HEAD,APP_TREE))
      and TARGET==EXPECTED_TARGET and TREE==EXPECTED_TREE and len(REVIEWED_PATHS)>0,'final-reviewed-source-bound')
 git('fetch','--no-write-fetch-head','origin','+refs/heads/main:refs/remotes/origin/main')
 need(git('rev-parse','origin/main').decode().strip()==TARGET and git('rev-parse',TARGET+'^{tree}').decode().strip()==TREE
      and git('rev-parse',HEAD+'^{tree}').decode().strip()==TREE and git('rev-parse',TARGET+':'+APP).decode().strip()==APP_TREE,'exact-reviewed-source-tree')
 need(git('rev-parse','HEAD').decode().strip()==HOST_BASE,'host-checkout-kept-at-4b')
 changed={n.decode() for n in git('diff','--name-only','-z',BASE,TARGET).split(bytes([0])) if n}
 need(changed=={APP+'/'+n for n in REVIEWED_PATHS},'only-final-reviewed-app-paths')
 need(git('rev-parse',BASE+':'+APP).decode().strip()==ACCEPTED_OLD_APP_TREE,'old-app-tree-matches-last-sprayplan-release')
 for name in ('Dockerfile','package.json','package-lock.json','docker-entrypoint.sh','server/SprayPlan.Api/appsettings.json','server/SprayPlan.Api/Data/LineNamesUpgrade.cs'):
  need(git('show',BASE+':'+APP+'/'+name)==git('show',TARGET+':'+APP+'/'+name),'existing-startup-seed-settings-and-line-upgrade-unchanged')
 material_sql()
 worker=git('show',TARGET+':'+APP+'/server/SprayPlan.Api/Services/MaterialReflowWorker.cs')
 need(pin(MATERIAL_WORKER_SHA256) and sha(worker)==MATERIAL_WORKER_SHA256,'reviewed-background-worker-source-blob')



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


def material_sql():
 raw=git('show',TARGET+':'+APP+'/server/SprayPlan.Api/Services/MaterialSchema.cs')
 need(pin(MATERIAL_SCHEMA_SHA256) and sha(raw)==MATERIAL_SCHEMA_SHA256,'reviewed-material-schema-source-blob')
 found=re.findall('public const string Sql = """(.*?)""";',raw.decode(),re.S)
 need(len(found)==1,'one-reviewed-csharp-raw-ddl-literal')
 sql=textwrap.dedent(found[0]).strip()
 need(' '.join(sql.split())==' '.join(MATERIAL_SQL.split()),'exact-two-object-independent-material-ddl')
 return sql


def material_shape(db):
 columns=tuple(tuple(row[1:]) for row in db.execute('PRAGMA table_info(order_materials)'))
 need(columns==MATERIAL_COLUMNS,'exact-sixteen-material-columns-types-defaults-primary-key')
 foreign=list(db.execute('PRAGMA foreign_key_list(order_materials)'))
 need(len(foreign)==1 and foreign[0][2:] == ('orders','orderId','id','CASCADE','CASCADE','NONE'),'exact-material-order-cascade-foreign-key')
 indexes=list(db.execute('PRAGMA index_list(order_materials)'))
 need(len(indexes)==1 and indexes[0][1:]==(MATERIAL_INDEX,1,'c',0)
      and [r[2] for r in db.execute('PRAGMA index_info('+MATERIAL_INDEX+')')]==['factoryId','orderId','partName'],'exact-material-unique-index')
 need(db.execute('SELECT count(*) FROM order_materials').fetchone()[0]==0,'new-material-table-empty-no-worker-candidates')
 if 'sqlite_sequence' in {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}:
  need(db.execute("SELECT count(*) FROM sqlite_sequence WHERE name='order_materials'").fetchone()[0]==0,'new-empty-material-table-has-no-sequence-consumption')


def expected_schema(before,directory,label):
 root,paths=clone_capture(before,directory,label);path=paths['data']/'sprayplan.db';old=before['data']['sqlite']['sprayplan.db']
 with contextlib.closing(sqlite3.connect(path)) as db:
  objects=lambda:list(db.execute("SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name"))
  old_objects=objects();old_names={r[1] for r in old_objects}
  if 'order_materials' in old_names:material_shape(db)
  need(MATERIAL_INDEX not in old_names or 'order_materials' in old_names,'no-conflicting-material-index-before-additive-schema')
  db.executescript(material_sql());db.commit();material_shape(db)
  new_objects=objects();allowed={'order_materials',MATERIAL_INDEX}
  need([r for r in old_objects if r[1] not in allowed]==[r for r in new_objects if r[1] not in allowed]
       and {r[1] for r in new_objects}-{r[1] for r in old_objects}<=allowed,'only-two-reviewed-empty-schema-objects-added')
  audit=D.sqlite_audit(db,L);a,b=copy.deepcopy(old),copy.deepcopy(audit)
  a['tables'].pop('order_materials',None);b['tables'].pop('order_materials',None)
  a.pop('schemaSha256');b.pop('schemaSha256');a.pop('schema');b.pop('schema')
  need(a==b,'all-old-tables-ids-lines-plans-actuals-stock-auth-pragmas-sequences-exact')
  db.executescript(material_sql());db.commit();material_shape(db)
  need(objects()==new_objects and D.sqlite_audit(db,L)==audit,'second-additive-schema-application-is-noop')
 expected=copy.deepcopy(before);expected['data']['sqlite']['sprayplan.db']=audit
 private(ACTIVE_OUT/(label+'-expected.private.json'),expected)
 return expected,len({r[1] for r in new_objects}-{r[1] for r in old_objects})



def compare_expected(expected,after,require_closed=True):
 result={name:D.compare(expected[name],after[name]) for name in ('data','storage')}
 need(all(v['preserved'] and (v['deploymentAttributionPermitted'] or not require_closed) for v in result.values()),'all-persistent-data-exact-except-predicted-empty-material-schema')
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
       '--label','io.rr-portal.pr1025-r3-probe='+token,'--env-file',str(env_path)]
 for part,destination in (('data','/app/data'),('storage','/app/server/SprayPlan.Api/storage')):
  args+=['--mount','type=bind,source='+str(paths[part])+',target='+destination]
 cid=run(args+[candidate]).decode().strip();need(re.fullmatch('[a-f0-9]{64}',cid),'owned-private-startup-probe-id')
 run(['docker','start',cid]);healthy=False
 for _ in range(90):
  record=json.loads(run(['docker','inspect',cid]))[0]
  need(record['Id']==cid and record['Image']==candidate and record['HostConfig']['NetworkMode']=='none'
       and (record['Config'].get('Labels')or{}).get('io.rr-portal.pr1025-r3-probe')==token,'same-owned-private-startup-probe')
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
 expected,count=expected_schema(before,directory,label+'-sql-reference');compare_expected(expected,after,False)
 run(['docker','rm',cid]);return {'addedSchemaObjects':count,'newMaterialRows':0,'noWorkerCandidates':True,'actualCloneStartupComparedToIndependentSQL':True}


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





def registered_images():
 values=run(['docker','image','ls','--all','--quiet','--no-trunc']).decode().split()
 need(0<len(values)<10000 and all(re.fullmatch('sha256:[a-f0-9]{64}',v) for v in values),'bounded-full-registered-image-id-set')
 return sorted(set(values))


def docker_available_bytes(path):
 value=os.statvfs(path)
 need(value.f_frsize>0 and value.f_bavail>=0,'valid-docker-filesystem-free-space')
 return value.f_bavail*value.f_frsize


def prior_r2_cache_proof():
 directory=ROOT/'deploy/backups/pr1025-sprayplan-20261028-v2/prepare'
 need(L.file_hash(directory/'manifest.json')==PRIOR_R2_MANIFEST_SHA256 and L.file_hash(directory/'result.private.json')==PRIOR_R2_RESULT_SHA256,'prior-r2-failed-build-seals')
 sealed=read(directory/'manifest.json');selected=('build-cache-before.private.json','build-cache-after.private.json','source/'+APP+'/Dockerfile')
 need(all(n in sealed and L.file_hash(directory/n)==sealed[n]for n in selected),'selected-prior-r2-cache-and-source-byte-seals')
 a,b=(read(directory/n)for n in selected[:2]);failure=read(directory/'result.private.json')
 need(a['availableBytes']==1820102656 and b['availableBytes']==22749061120 and b['cachePruned']is True and a['registeredImages']==b['registeredImages'],'actual-prior-r2-cache-cleanup-and-image-preservation')
 need(failure['success']is False and failure['phase']=='prepare'and failure['target']==TARGET and failure['tree']==TREE and failure['errorType']=='TimeoutExpired'and sha((directory/selected[2]).read_bytes())==GIT_DOCKERFILE_SHA256,'prior-r2-reached-source-after-all-cache-guards-before-build-timeout')
 return {'priorR2CacheCleanupProven':True,'priorR2ManifestSHA256':PRIOR_R2_MANIFEST_SHA256,'priorR2SourceGuardCheckpointProven':True}


def ensure_build_space(baseline,protection,hosts,auth):
 # The successful R2 cache-only cleanup is sealed. R3 never prunes again.
 prior=prior_r2_cache_proof();root=json.loads(run(['docker','info','--format','{{json .DockerRootDir}}']))
 need(type(root)is str and root.startswith('/')and len(os.fsencode(root))<=4096 and '..'not in pathlib.PurePosixPath(root).parts and not any(ord(c)<32 for c in root),'bounded-absolute-docker-root-directory')
 path=pathlib.Path(root);need(path.is_dir(),'actual-existing-docker-root-filesystem');before=docker_available_bytes(path);images=registered_images();run(['docker','system','df'])
 need(runtime()==baseline and protected(baseline)==protection and host_files()==hosts and guard(SERVICE,one(SERVICE))==auth,'original-runtime-config-and-auth-before-readonly-space-check')
 after=docker_available_bytes(path);after_images=registered_images();private(ACTIVE_OUT/'build-space.private.json',dict(prior,dockerRoot=root,beforeFree=before,afterFree=after,registeredImages=images))
 need(images==after_images and runtime()==baseline and protected(baseline)==protection and host_files()==hosts and guard(SERVICE,one(SERVICE))==auth,'original-images-runtime-config-auth-after-readonly-space-check')
 need(before>=4*1024**3 and after>=4*1024**3,'four-gib-required-no-additional-cleanup')
 return dict(prior,cachePruned=False,beforeFree=before,afterFree=after,registeredImagesPreserved=True,originalRuntimeProtectedFilesAndAuthPreserved=True)


def build_recipe(original,alias):
 need(type(original)is bytes and sha(original)==GIT_DOCKERFILE_SHA256,'exact-reviewed-original-dockerfile-bytes')
 expected='rr-portal-sprayplan:pr1025-r3-runtime-base-'+ACCEPTED_OLD_IMAGE.split(':')[1][:12]
 need(alias==expected,'only-fixed-local-accepted-runtime-alias')
 web_apt=b'RUN apt-get update \\\n    && apt-get install -y --no-install-recommends openssl \\\n    && rm -rf /var/lib/apt/lists/*\n'
 runtime_apt=b'RUN apt-get update \\\n    && apt-get install -y --no-install-recommends poppler-utils tesseract-ocr tesseract-ocr-chi-sim tesseract-ocr-eng \\\n    && rm -rf /var/lib/apt/lists/*\n'
 changes=[(b'FROM node:20-bookworm-slim AS web-build\n',('FROM '+alias+' AS rr-runtime-base\nFROM node:20-bookworm-slim AS rr-node-tools\nFROM rr-runtime-base AS web-build\nCOPY --from=rr-node-tools /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/npm\nRUN ln -sf /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \\\n    && ln -sf /usr/local/lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx\n').encode()),(web_apt,b''),(b'RUN npm ci\n',b'RUN npm ci --include=dev\n'),(b'FROM mcr.microsoft.com/dotnet/aspnet:8.0-bookworm-slim AS runtime\n',b'FROM rr-runtime-base AS runtime\n'),(runtime_apt,b''),(b'COPY --from=web-build /usr/local/bin/node /usr/local/bin/node\n',b'RUN rm -rf /app/node_modules /app/.next /app/server/SprayPlan.Api/publish /app/prisma\n\nCOPY --from=web-build /usr/local/bin/node /usr/local/bin/node\n')]
 value=original
 for before,after in changes:
  need(value.count(before)==1,'each-reviewed-recipe-block-exactly-once');value=value.replace(before,after,1)
 api=original.split(b'FROM mcr.microsoft.com/dotnet/sdk:8.0-bookworm-slim AS api-build\n',1)[1].split(b'FROM mcr.microsoft.com/dotnet/aspnet:8.0-bookworm-slim AS runtime\n',1)[0]
 need(value.count(b'FROM mcr.microsoft.com/dotnet/sdk:8.0-bookworm-slim AS api-build\n'+api)==1 and b'apt-get'not in value,'sdk-restore-publish-unchanged-and-no-apt-in-recipe')
 need(value.count(b'RUN rm -rf /app/node_modules /app/.next /app/server/SprayPlan.Api/publish /app/prisma\n')==1,'only-four-fixed-code-layer-paths-cleared')
 return value


def runtime_recipe(source):
 # Read tools from the immutable accepted image only; never install new ones.
 tools=run(['docker','run','--rm','--network','none','--read-only','--entrypoint','sh',ACCEPTED_OLD_IMAGE,'-c','set -eu; node --version; openssl version; command -v pdfinfo; command -v tesseract'],timeout=45).decode().splitlines()
 need(bool(tools)and re.fullmatch('v20[.][0-9]+[.][0-9]+',tools[0]),'accepted-runtime-node20-and-required-tools')
 alias='rr-portal-sprayplan:pr1025-r3-runtime-base-'+ACCEPTED_OLD_IMAGE.split(':')[1][:12]
 previous=run(['docker','image','ls','--no-trunc','--quiet',alias]).decode().split();need(previous in([],[ACCEPTED_OLD_IMAGE]),'owned-runtime-base-alias-absent-or-exact')
 if not previous:run(['docker','tag',ACCEPTED_OLD_IMAGE,alias])
 need(image_id(alias)==ACCEPTED_OLD_IMAGE,'frozen-accepted-runtime-base-alias')
 original=git('show',TARGET+':'+APP+'/Dockerfile');need((source/APP/'Dockerfile').read_bytes()==original,'original-build-context-dockerfile-unmodified')
 recipe=build_recipe(original,alias);path=ACTIVE_OUT/'Dockerfile.recipe';private(path,recipe)
 return path,{'recipeSHA256':sha(recipe),'originalDockerfileSHA256':sha(original),'runtimeBaseImage':ACCEPTED_OLD_IMAGE,'runtimeBaseAlias':alias,'originalContextDockerfileChanged':False}


def prepare():
 need(not PREPARED_SHA256 and not DEPLOY_SHA256,'prepare-only-blank-prior-seals')
 before=runtime();r=one(SERVICE);old=image(r['Image']);accepted=image(ACCEPTED_OLD_IMAGE)
 need(image_id(ALIAS)==r['Image'],'fresh-current-canonical-alias-matches-actual-service')
 live=code_proof(r['Id']);need(live==scratch_proof(ACCEPTED_OLD_IMAGE,SERVICE),'actual-old-next-dotnet-code-equals-accepted-last-release')
 C.image_contract(accepted,old,BASE);guarded=guard(SERVICE,r);hosts=host_files();protection=protected(before);start_probes=probes(SERVICE);internal_health(r['Id'],SERVICE)
 need(start_probes=={'/sprayplan':401,'/sprayplan/api/health':200,'/sprayplan/api/orders':401},'original-public-authorization-state')
 private(ARCHIVE_ROOT/'environment.private',(ROOT/'.env.cloud.production').read_bytes())
 private(ACTIVE_OUT/'current-runtime.private.json',before);private(ACTIVE_OUT/'protected.private.json',protection)
 cache=ensure_build_space(before,protection,hosts,guarded)
 source=ACTIVE_OUT/'source';extract_source(source);recipe_path,recipe=runtime_recipe(source);tag='rr-portal-sprayplan:pr1025-r3-'+TARGET[:12]
 run(['docker','build','--label','org.opencontainers.image.revision='+TARGET]+compose_build_labels(SERVICE,old)+['--pull=false','--file',str(recipe_path),'--build-arg','NEXT_PUBLIC_BASE_PATH=/sprayplan','--tag',tag,str(source/APP)],timeout=1800)
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
        'priorAlias':r['Image'],'probes':start_probes,'onlineClone':clone,'environmentFileSHA256':L.file_hash(ARCHIVE_ROOT/'environment.private'),'buildCacheSpace':cache,'buildRecipe':recipe}
 private(ACTIVE_OUT/'prepared.private.json',value)
 return {'durableImage':candidate['Id'],'liveBackendImage':r['Image'],'candidateRealCloneStartupVerified':True,'liveLifecycleChanged':False,
         'discoveredSQLiteFiles':sum(len(x['sqlite']) for x in captured.values()),'bindTypes':bind_source_type_summary(protection),'recipeSHA256':recipe['recipeSHA256'],**cache}


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
 expected,count=expected_schema(cold,cold_dir,'cold-expected')
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
 return {'newContainer':new['Id'],'durableImage':recipe['image'],'priorBackendImage':old['Image'],'publishedRevision':TARGET,'addedSchemaObjects':count,
         'onlyExpectedEmptyMainMaterialsSchemaAdded':True,'newMaterialRows':0,'noWorkerCandidates':True,'allOtherDatabaseRowsAuthFilesOwnersExact':True,'testAndAllOtherContainersUnchanged':True,
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
