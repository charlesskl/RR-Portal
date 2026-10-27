"""Inert PR1018 full-image rollout. Root must bind source/phase and review first.

Only the two SprayPlan containers may be recreated, test before production.
No data restore, migration, seed, login, mailbox or model request is performed.
After a gated failure the one service stays gated for explicit reconciliation;
an uncertain stop/recreate is never retried by this helper.
"""
import contextlib,datetime,hashlib,importlib.util,io,json,os,pathlib,re,stat,subprocess,sys,tarfile,time,urllib.error,urllib.request,uuid

ROOT=pathlib.Path('/opt/rr-portal')
OUT=ROOT/'deploy/backups/pr-1018-20261027-release'
BASE='0a9720c8f1493c87f6bdfab4c65a87e98e53dc69'
BRANCH='refs/heads/ops/pr-1018-20261027'
TARGET=''
TREE=''
APP_TREE=''
PHASE=''
EXECUTE=False
PREPARED_SHA256=''
APP='apps/喷油部/喷油排期系统'
SERVICES=('sprayplan-test','sprayplan')
BASE_APP_TREE='8af080627a2618dbea092f2255d742e36b4445ca'
EXPECTED_ORIGINAL_IMAGES={'sprayplan-test':'sha256:01cfaf0c6a2f5ba87230ff22be91169087156e5454ba1caa103a1dd2863969a4','sprayplan':'sha256:3e1390c9644dc74eb7b3d53668833f18385937d92e0b0fb3b3667d7aa21937de'}
REVIEWED_PATHS=('server/SprayPlan.Api.Tests/Orders/OrderAutoScheduleTests.cs','server/SprayPlan.Api/Features/Orders/OrderDtos.cs','server/SprayPlan.Api/Features/Orders/OrdersController.cs','server/SprayPlan.Api/Services/DemandScheduleAdjustment.cs','server/SprayPlan.Api/Services/OrderCalc.cs','src/app/orders/[id]/OrderDetailEditor.tsx','tests/browser/order-part-quantity.spec.ts')
DEPS={'pr1012-compose-library-v2.py':'bbf49ca20451f5c503bc807f71590dca8f20061590d0e78300551f302c386027','pr1012-data-library.py':'b937a93ac5d08ba93bb684270e3d05d13d58dc6ecf90af5e1306aec30cec0eb3','release-data-library.py':'d63168fd3057f4f2aba2d93f9fab31d2d65c6dd0f3234877d71fcff1e04e62b9'}
CODE_FILES=('docker-entrypoint.sh','next.config.mjs','prisma/schema.prisma','.next/BUILD_ID','.next/required-server-files.json','server/SprayPlan.Api/appsettings.json','server/SprayPlan.Api/publish/SprayPlan.Api.dll','server/SprayPlan.Api/publish/SprayPlan.Api.deps.json','server/SprayPlan.Api/publish/SprayPlan.Api.runtimeconfig.json')
C=None;D=None;L=None;ACTIVE_OUT=None;SERIAL=0;STAGE='entry';RECOVERY={}

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
def source_check():
 need(all(re.fullmatch('[a-f0-9]{40}',x or'')for x in(TARGET,TREE,APP_TREE)),'bound-reviewed-source')
 git('fetch','--no-write-fetch-head','origin','+refs/heads/main:refs/remotes/origin/main')
 need(git('rev-parse','origin/main').decode().strip()==TARGET and git('rev-parse',TARGET+'^{tree}').decode().strip()==TREE and git('rev-parse',TARGET+':'+APP).decode().strip()==APP_TREE,'exact-reviewed-main-app-tree')
 changed=git('diff','--name-only','-z',BASE,TARGET).decode().rstrip('\0').split('\0');need(len(changed)==len(set(changed))==len(REVIEWED_PATHS)and set(changed)=={APP+'/'+n for n in REVIEWED_PATHS},'exact-reviewed-spray-app-files');need(git('rev-parse',BASE+':'+APP).decode().strip()==BASE_APP_TREE,'accepted-original-spray-app-tree')
 for name in('Dockerfile','docker-entrypoint.sh','server/SprayPlan.Api/Program.cs','prisma/schema.prisma'):
  need(git('show',BASE+':'+APP+'/'+name)==git('show',TARGET+':'+APP+'/'+name),'unchanged-startup-schema-'+name)
def host_files():
 names=['.env.cloud.production','docker-compose.cloud.yml','nginx/nginx.cloud.conf','deploy/service-maintenance.sh','deploy/update-server.sh']
 git('diff','--cached','--quiet');names+=git('diff','--name-only','-z').decode().rstrip('\0').split('\0');result={}
 for n in sorted(set(filter(None,names))):
  need(L.safe_path(n),'safe-host-file');p=ROOT/n;need(p.is_file()and not p.is_symlink(),'regular-host-file');s=p.stat();result[n]={'sha256':sha(p.read_bytes()),'mode':stat.S_IMODE(s.st_mode),'uid':s.st_uid,'gid':s.st_gid}
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
 folder=ACTIVE_OUT/(service+'-scratch');folder.mkdir(mode=0o700);mounts={}
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
def compose_args(overlay):return ['docker','compose','--project-name','rr-portal','--project-directory',str(ROOT),'--env-file',str(OUT/'environment.private'),'-f',str(ROOT/'docker-compose.cloud.yml'),'-f',str(overlay)]
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
 expected_overlay=str(OUT/(service+'-compose.private.json'));need(recipe['overlay']==expected_overlay,'fixed-service-private-compose-overlay')
 metadata={'com.docker.compose.project.config_files':str(ROOT/'docker-compose.cloud.yml')+','+expected_overlay,'com.docker.compose.project.environment_file':str(OUT/'environment.private')}
 need(all(labels_b.get(k)==v for k,v in metadata.items()),'exact-new-compose-invocation-metadata');allowed|=set(metadata)
 need({k:v for k,v in labels_a.items()if k not in allowed}=={k:v for k,v in labels_b.items()if k not in allowed},'all-other-runtime-labels-exact')
 hostname=old['Config'].get('Hostname');need(new['Config'].get('Hostname')==(new['Id'][:12]if hostname==old['Id'][:12]else hostname),'only-automatic-hostname-changes')
 need(code_proof(new['Id'])==recipe['code'],'new-next-and-dotnet-code-exact')
def prepare():
 global ACTIVE_OUT
 need(not OUT.exists()and not OUT.is_symlink(),'one-prepare');OUT.mkdir(mode=0o700);ACTIVE_OUT=OUT/'prepare';ACTIVE_OUT.mkdir(mode=0o700)
 need(git('rev-parse','HEAD').decode().strip()==BASE,'canonical-base');source_check();hosts=host_files();private(OUT/'environment.private',(ROOT/'.env.cloud.production').read_bytes())
 source=OUT/'source';extract_source(source);records={};recipes={};initial_probes={};guards={}
 for service in SERVICES:
  current=one(service);need(current['Image']==EXPECTED_ORIGINAL_IMAGES[service],'accepted-original-spray-image-before-build');current_image=image(current['Image']);preflight=C.literal_overlay(service,current,current_image,current_image,TARGET,str(ROOT));path=OUT/('schema-preflight-'+service+'.private.json');private(path,preflight);rendered_check(service,path,preflight)
 for service in SERVICES:
  r=one(service);records[service]=r;need(not(ROOT/'deploy/maintenance/services'/service).exists(),'target-gate-initially-clear');guards[service]=guard(service,r);initial_probes[service]=probes(service);internal_health(r['Id'],service)
  old_image=image(r['Image']);tag='rr-portal-'+service+':pr1018-'+TARGET[:12]
  run(['docker','build','--label','org.opencontainers.image.revision='+TARGET]+compose_build_labels(service,old_image)+['--build-arg','NEXT_PUBLIC_BASE_PATH=/'+service,'--tag',tag,str(source/APP)],timeout=1800)
  new_image=json.loads(run(['docker','image','inspect',tag]))[0];C.image_contract(old_image,new_image,TARGET);need((new_image['Config'].get('Labels')or{}).get('org.opencontainers.image.revision')==TARGET,'candidate-revision-label')
  overlay=C.literal_overlay(service,r,old_image,new_image,TARGET,str(ROOT));overlay_path=OUT/(service+'-compose.private.json');private(overlay_path,overlay);rendered_check(service,overlay_path,overlay)
  proof=scratch_proof(new_image['Id'],service);settings=APP+'/server/SprayPlan.Api/appsettings.json';need(proof['server/SprayPlan.Api/appsettings.json']==sha(git('show',TARGET+':'+settings))==sha(code_file(r['Id'],'server/SprayPlan.Api/appsettings.json')),'unchanged-live-and-image-appsettings')
  private(ACTIVE_OUT/(service+'-old-image.private.json'),old_image);private(ACTIVE_OUT/(service+'-new-image.private.json'),new_image)
  recipes[service]={'image':new_image['Id'],'tag':tag,'overlay':str(overlay_path),'overlaySHA256':sha(enc(overlay)),'environment':C.preserved_environment(r,old_image,new_image,TARGET),'code':proof,'guard':guards[service]}
  need(contract(one(service))==contract(r),'prepare-live-contract-unchanged')
 need(host_files()==hosts,'prepare-host-files-preserved');value={'target':TARGET,'tree':TREE,'appTree':APP_TREE,'hostFiles':hosts,'runtime':records,'services':recipes,'probes':initial_probes};private(OUT/'prepared.private.json',value)
 return {'preparedSHA256':sha(enc(value)),'testImage':recipes['sprayplan-test']['image'],'productionImage':recipes['sprayplan']['image'],'bothCandidatesBuiltBeforeMaintenance':True,'liveLifecycleChanged':False}
def prepared():
 raw=(OUT/'prepared.private.json').read_bytes();need(sha(raw)==PREPARED_SHA256,'sealed-prepared');p=json.loads(raw);need((p['target'],p['tree'],p['appTree'])==(TARGET,TREE,APP_TREE),'same-prepared-source');source_check();need(host_files()==p['hostFiles'],'host-config-preserved');return p
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
def capture(service,r,dest,owned):
 gate_assert(owned);need(all(v==503 for v in probes(service).values()),'business-ingress-still-gated');result={}
 for m in C.mounts(service,r,str(ROOT)):
  label='data'if m['target']=='/app/data'else'storage';result[label]=D.capture(service,pathlib.Path(m['source']),dest/label,True,L,root_label=label)
 return result
def deploy(service):
 global ACTIVE_OUT,RECOVERY,STAGE
 p=prepared()
 if service=='sprayplan':need((OUT/'deploy-sprayplan-test/success.private.json').is_file(),'test-passed-before-production')
 ACTIVE_OUT=OUT/PHASE;need(not ACTIVE_OUT.exists(),'one-service-deploy');ACTIVE_OUT.mkdir(mode=0o700);recipe=p['services'][service];old=one(service);need(contract(old)==contract(p['runtime'][service]),'same-original-service-contract')
 need(guard(service,old)==recipe['guard'],'same-authoritative-key-before-gate');overlay_path=pathlib.Path(recipe['overlay']);raw=overlay_path.read_bytes();need(sha(raw)==recipe['overlaySHA256'],'sealed-overlay');overlay=json.loads(raw);rendered_check(service,overlay_path,overlay);image(recipe['image'])
 owned=None;completed=False;mutation_attempted=False;failure_stage=None
 try:
  owned=gate_on(service);need(all(v==503 for v in probes(service).values()),'target-business-ingress-isolated');private(ACTIVE_OUT/'reservation.private.json',{'oldCID':old['Id'],'candidateImage':recipe['image'],'gateDevice':owned[1],'gateInode':owned[2]})
  mutation_attempted=True;run(['docker','stop','--time','30',old['Id']],timeout=50);stopped=one(service,False);need(stopped['Id']==old['Id']and not stopped['State']['Running'],'original-container-stopped')
  need(guard(service,stopped)==recipe['guard'],'fresh-stopped-authoritative-db-key-guard');before_dir=ACTIVE_OUT/'before';before_dir.mkdir(mode=0o700);before=capture(service,stopped,before_dir,owned)
  gate_assert(owned);need(guard(service,stopped)==recipe['guard'],'authoritative-guard-immediately-before-recreate')
  run(compose_args(overlay_path)+['up','-d','--no-deps','--no-build','--pull','never','--force-recreate',service],timeout=240)
  new=one(service,False);need(new['Id']!=old['Id']and new['Image']==recipe['image'],'new-candidate-container-created');new=wait_healthy(service,new['Id']);runtime_check(service,old,new,recipe)
  need(guard(service,new)==recipe['guard'],'same-effective-key-after-start');after_dir=ACTIVE_OUT/'after';after_dir.mkdir(mode=0o700);after=capture(service,new,after_dir,owned)
  comparisons={label:D.compare(before[label],after[label])for label in('data','storage')};need(all(v['preserved']and v['deploymentAttributionPermitted']for v in comparisons.values()),'all-rows-auth-schema-sequences-files-owners-exact')
  # Nginx resolves container names with a ten-second cache. Keep ingress closed
  # for at least eleven seconds after recreation before testing the new route.
  time.sleep(11);new=one(service);internal_health(new['Id'],service);need(new['Image']==recipe['image'],'candidate-still-healthy-after-dns-cache-window')
  need(host_files()==p['hostFiles'],'host-config-still-preserved');private(ACTIVE_OUT/'verified.private.json',{'newRuntime':new,'comparisons':comparisons,'source':TARGET,'guard':recipe['guard']});gate_off(owned);owned=None
  public=probes(service);need(public==p['probes'][service],'public-status-and-auth-preserved')
  private(ACTIVE_OUT/'success.private.json',{'target':TARGET,'image':recipe['image'],'id':new['Id'],'public':public});completed=True
  return {'service':service,'publishedRevision':TARGET,'image':recipe['image'],'newContainer':new['Id'],'allPersistentRowsAuthFilesOwnersExact':True,'bothNextAndDotnetVerified':True,'maintenanceCleared':True,'public':public}
 except BaseException:
  failure_stage=STAGE
  if mutation_attempted and owned is None:
   # A post-open failure re-closes only this service with a new O_EXCL flag.
   # An existing operator's flag is never replaced or removed.
   try:owned=gate_on(service);RECOVERY['ownGateRecreatedAfterPostOpenFailure']=True
   except BaseException as e:RECOVERY.update(postOpenGateReservationFailed=True,gateErrorType=type(e).__name__)
  STAGE=failure_stage;raise
 finally:
  if not completed:
   RECOVERY.update(automaticStartRecreateOrDataRestoreAttempted=False,unknownMutationNeverRetried=True)
   if owned is not None:
    try:
     gate_assert(owned)
     if not mutation_attempted:
      current=one(service);need(contract(current)==contract(old)and guard(service,current)==recipe['guard']and host_files()==p['hostFiles'],'untouched-original-proven-before-gate-cleanup');gate_off(owned);RECOVERY['ownGateClearedBeforeAnyLiveMutation']=True
     else:RECOVERY['onlyFailedServiceMaintenanceRetained']=True
    except Exception as e:RECOVERY.update(ownedGateProofFailed=True,errorType=type(e).__name__)
   # No guessed rollback: root must inspect actual CID/state and fresh DB/key
   # guards before authorizing any subsequent start/recreate of either image.
  if failure_stage is not None:STAGE=failure_stage
def verify():
 global ACTIVE_OUT
 p=prepared();ACTIVE_OUT=OUT/'verify';need(not ACTIVE_OUT.exists(),'one-final-verify');ACTIVE_OUT.mkdir(mode=0o700);result={}
 for service in SERVICES:
  success=json.loads((OUT/('deploy-'+service)/'success.private.json').read_bytes());need(success['target']==TARGET,'each-service-success-before-final');r=one(service);need(r['Id']==success['id'],'same-final-new-container');runtime_check(service,p['runtime'][service],r,p['services'][service]);need(guard(service,r)==p['services'][service]['guard'],'final-effective-key-preserved');internal_health(r['Id'],service)
  need(not(ROOT/'deploy/maintenance/services'/service).exists(),'final-service-gate-clear');result[service]=probes(service);need(result[service]==p['probes'][service],'final-public-status-and-auth')
 git('merge','--ff-only',TARGET);need(git('rev-parse','HEAD').decode().strip()==TARGET and host_files()==p['hostFiles'],'canonical-main-advanced-host-config-preserved')
 for service in SERVICES:
  candidate=p['services'][service]['image'];image(candidate);alias='rr-portal-'+service+':latest';run(['docker','tag',candidate,alias])
  actual=json.loads(run(['docker','image','inspect',alias]));need(len(actual)==1 and actual[0]['Id']==candidate,'canonical-fixed-service-image-alias-exact')
 return {'bothServicesVerified':True,'frontendAndBackendSourceRevision':TARGET,'public':result,'noDataRestoreCursorResetOrLogin':True,'allOtherServicesLeftRunning':True,'canonicalImagesReadyForRecreation':True}
def main():
 need(EXECUTE is True and PHASE in('prepare','deploy-sprayplan-test','deploy-sprayplan','verify')and sys.argv[1:]==[PHASE],'inert-exact-phase')
 need(os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_MODE')==PHASE and os.environ.get('RELEASE_ATTEMPT')=='1','fixed-first-attempt-branch');os.umask(0o077);initialize();value={'phase':PHASE,'target':TARGET,'success':False}
 try:value.update(prepare()if PHASE=='prepare'else verify()if PHASE=='verify'else deploy(PHASE[7:]));value['success']=True
 except Exception as e:
  value.update(errorType=type(e).__name__,stage=STAGE)
  if isinstance(e,RuntimeError)and re.fullmatch(r'(?:SPRAYPLAN_COMPOSE_[a-z0-9-]{1,150}|[a-z][a-z0-9-]{0,150})',str(e)):value['errorLabel']=str(e)
  if RECOVERY:value['recovery']=RECOVERY
 value['commandNumber']=SERIAL
 value['utc']=datetime.datetime.now(datetime.timezone.utc).isoformat();value['resultSHA256']=sha(enc(value));value['sha256Wire']={k:[int(c,16)for c in(v.split(':')[1]if v.startswith('sha256:')else v)]for k,v in value.items()if type(v)is str and re.fullmatch('(?:sha256:)?[a-f0-9]{64}|[a-f0-9]{40}',v)};print(json.dumps(value,sort_keys=True),flush=True);return 0 if value['success']else 1
if __name__=='__main__':sys.exit(main())
