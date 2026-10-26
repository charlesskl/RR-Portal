"""Inert PR1013 two-service PocketBase code publication, derived from audited Batch1003.

Build both variants before maintenance. Preserve original CIDs/runtime/AI Env and
publish complete hooks plus a static union only while stopped. Never restore data.
Any failure after a live mutation keeps only that service gated for reconciliation.
"""
import contextlib,datetime,hashlib,importlib.util,io,json,os,pathlib,re,shutil,sqlite3,stat,subprocess,sys,tarfile,time,urllib.request,urllib.error
ROOT=pathlib.Path('/opt/rr-portal')
OUT=ROOT/'deploy/backups/pr-1013-20261026-release'
BASE='df60d6a6b1e7f76070cd866cbbc6a4ee50936122'
BRANCH='refs/heads/ops/pr-1013-20261026'
TARGET='bdf872c28daa2dd2b7c44c247569e85db711cf1e'
TREE='e718f68767de1285b388d8cad93e6b0b9fd3538b'
APP_TREE='efece58c8bd805757e0cfd62100b0784f730cdd2'
PHASE='deploy-factory-review'
EXECUTE=True
PREPARED_SHA256='97395c02ef337fc90bf9513d25f5051a639fb137a04df68902de1cd3a96065e9'
DEPS={'batch1003-data-library.py':'f40fdf266b765a9a1fedcb04190b413e2d979aaa8e7548c030c1eed5560e50c6','batch1003-image-library.py':'94d9dc30f1e21ee1346f89ac231bbc28ebc21d210d08298f54c56cc0103fab02','release-data-library.py':'d63168fd3057f4f2aba2d93f9fab31d2d65c6dd0f3234877d71fcff1e04e62b9'}
APPS={'factory-review-test':'apps/PMC跟仓管/加工厂月度评审管理制度','factory-review':'apps/PMC跟仓管/加工厂月度评审管理制度'}
DATA={'factory-review-test':('pb_data_test','/pb/pb_data'),'factory-review':('pb_data','/pb/pb_data')}
PROBES={s:['/'+s+'/api/factory-review/health','/'+s+'/','/'+s+'/api/factory-review/analysis-ai/config']for s in APPS}
MIGRATION_SOURCE=None
I=None;D=None;L=None;STAGE='entry';SERIAL=0;ACTIVE_OUT=None;RECOVERY={}

def need(v,label):
 global STAGE
 STAGE=label
 if not v:raise RuntimeError(label)


def enc(v):return json.dumps(v,sort_keys=True,separators=(',',':'),ensure_ascii=True,allow_nan=False).encode()


def sha(v):return hashlib.sha256(v).hexdigest()


def private(p,v):
 fd=os.open(p,os.O_CREAT|os.O_EXCL|os.O_WRONLY|os.O_NOFOLLOW,0o600)
 with os.fdopen(fd,'wb')as f:f.write(v if type(v)is bytes else enc(v));f.flush();os.fsync(f.fileno())


def run(a,data=None,timeout=180):
 global SERIAL,STAGE
 SERIAL+=1;STAGE='command-'+pathlib.Path(a[0]).name
 p=subprocess.run(a,input=data,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=timeout,cwd=ROOT)
 if ACTIVE_OUT is not None:
  private(ACTIVE_OUT/('%03d.stdout.private'%SERIAL),p.stdout);private(ACTIVE_OUT/('%03d.stderr.private'%SERIAL),p.stderr)
 need(p.returncode==0,'command-'+pathlib.Path(a[0]).name);return p.stdout


def git(*a):return run(['git','-c','core.hooksPath=/dev/null',*a])


def load(name):
 p=pathlib.Path(__file__).with_name(name);need(p.is_file()and not p.is_symlink()and sha(p.read_bytes())==DEPS[name],'fixed-library-'+name)
 sp=importlib.util.spec_from_file_location(name.replace('.','_'),p);m=importlib.util.module_from_spec(sp);sp.loader.exec_module(m);return m


def initialize():
 global I,D,L
 for n,h in DEPS.items():need(sha(pathlib.Path(__file__).with_name(n).read_bytes())==h,'all-library-pins-before-import')
 I=load('batch1003-image-library.py');D=load('batch1003-data-library.py');L=load('release-data-library.py')


def envmap(record):
 result={}
 for x in record['Config'].get('Env')or[]:
  k,sep,v=x.partition('=');need(sep and k not in result,'unique-runtime-env');result[k]=v
 return result


def one(service,healthy=True):
 need(service in APPS,'only-two-pb-services')
 ids=run(['docker','ps','-aq','--filter','label=com.docker.compose.project=rr-portal','--filter','label=com.docker.compose.service='+service,'--no-trunc']).decode().split();need(len(ids)==1,'one-target-'+service)
 r=json.loads(run(['docker','inspect',ids[0]]))[0]
 if healthy:need(r['State']['Running']and not r['State']['OOMKilled']and r['State'].get('Health',{}).get('Status')=='healthy','healthy-'+service)
 source,dest=DATA[service];mount=[m for m in r['Mounts']if m['Destination']==dest]
 need(len(mount)==len(r['Mounts'])==1 and mount[0]['Type']=='bind'and mount[0]['Source']==str(ROOT/APPS[service]/source)and mount[0]['RW'],'fixed-persistent-mount-'+service)
 return r


def contract(r):return{'id':r['Id'],'image':r['Image'],'config':sha(enc(dict(r['Config'],Env=sorted(r['Config'].get('Env')or[])))),'host':sha(enc(r['HostConfig'])),'mounts':sha(enc(sorted(r['Mounts'],key=enc)))}


def host_files():
 names=['.env.cloud.production','docker-compose.cloud.yml','nginx/nginx.cloud.conf','deploy/service-maintenance.sh','deploy/update-server.sh']+git('diff','--name-only','-z').decode().rstrip('\0').split('\0');git('diff','--cached','--quiet');result={}
 for n in sorted(set(filter(None,names))):
  need(I.safe(n),'safe-host-path');p=ROOT/n;need(p.is_file()and not p.is_symlink(),'regular-host-file');s=p.stat();result[n]={'sha256':sha(p.read_bytes()),'uid':s.st_uid,'gid':s.st_gid,'mode':stat.S_IMODE(s.st_mode)}
 return result


def source_check():
 need(all(re.fullmatch('[a-f0-9]{40}',v or'')for v in(TARGET,TREE,APP_TREE)),'bound-reviewed-source');git('fetch','--no-write-fetch-head','origin','+refs/heads/main:refs/remotes/origin/main')
 need(git('rev-parse','origin/main').decode().strip()==TARGET and git('rev-parse',TARGET+'^{tree}').decode().strip()==TREE,'exact-reviewed-main-tree')
 for s,a in APPS.items():need(git('rev-parse',TARGET+':'+a).decode().strip()==APP_TREE,'reviewed-app-tree-'+s)
 changed=git('diff','--name-only','-z',BASE,TARGET).decode().rstrip('\0').split('\0');need(changed and all(any(n.startswith(a+'/')for a in APPS.values())for n in changed),'only-reviewed-factory-review-app')


def extract_source(dest):
 dest.mkdir(mode=0o700)
 with tarfile.open(fileobj=io.BytesIO(git('archive',TARGET,*sorted(set(APPS.values())))))as t:
  names=set();total=0
  for m in t.getmembers():
   n=m.name.rstrip('/');need(I.safe(n)and n not in names and(m.isdir()or m.isfile()),'safe-regular-source-archive');names.add(n);total+=m.size;need(total<=512*1024**2 and m.size<=128*1024**2,'bounded-source-archive')
   need(any(n==a or n.startswith(a+'/')or(m.isdir()and a.startswith(n+'/'))for a in APPS.values()),'source-only-reviewed-apps')
   p=dest/n
   if m.isdir():p.mkdir(mode=0o755,parents=True,exist_ok=True)
   else:p.parent.mkdir(mode=0o755,parents=True,exist_ok=True);private(p,t.extractfile(m).read());p.chmod(m.mode&0o755)


def request(path):
 need(path.startswith('/')and'..'not in pathlib.PurePosixPath(path.split('?')[0]).parts,'fixed-http-path')
 class NoRedirect(urllib.request.HTTPRedirectHandler):
  def redirect_request(self,*a,**k):return None
 opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),NoRedirect())
 try:
  with opener.open(urllib.request.Request('http://127.0.0.1'+path,headers={'Cache-Control':'no-cache'}),timeout=20)as r:b=r.read(64*1024**2+1);need(len(b)<=64*1024**2,'bounded-http');return r.status,sha(b)
 except urllib.error.HTTPError as e:
  try:return e.code,sha(e.read(1024*1024))
  finally:e.close()


def pb_guard(service,dbpath,environment,expected,portable=False):
 path=pathlib.Path(dbpath);need(path.is_file()and not path.is_symlink()and path.stat().st_size>0 and all(not q.is_symlink()for q in path.parents),'existing-regular-nonempty-pb-database')
 with contextlib.closing(L.connect(path,portable))as db:
  need(db.execute('PRAGMA quick_check').fetchone()[0]=='ok','actual-pb-database-integrity')
  email=environment.get('FACTORY_REVIEW_ADMIN_EMAIL','').strip();pw=environment.get('FACTORY_REVIEW_ADMIN_PASSWORD','');need(email and len(pw)>=12 and db.execute('SELECT count(*) FROM users WHERE email=?',(email,)).fetchone()[0]==1,'existing-pb-admin-prevents-health-write-'+service)
  applied={r[0]for r in db.execute('SELECT file FROM _migrations')}
 need(expected and set(expected)<=applied,'all-actual-pb-migrations-already-applied-'+service)
 return {'existingAdminAndPermissionsPreserved':True,'allMigrationsAlreadyApplied':True,'actualMigrationFilesMatchReviewedTarget':True,'databaseIntegrity':'ok'}
def migration_manifest(blob,prefix):
 need(len(blob)<=32*1024**2 and prefix.endswith('/'),'bounded-migration-archive');result={};total=0
 with tarfile.open(fileobj=io.BytesIO(blob))as archive:
  for member in archive.getmembers():
   name=member.name.rstrip('/');need(I.safe(name)and(member.isfile()or member.isdir()),'regular-migration-archive')
   if member.isdir():continue
   need(name.startswith(prefix),'only-reviewed-migration-root');relative=name[len(prefix):];need(I.safe(relative)and relative not in result,'unique-safe-migration-file');total+=member.size
   need(member.size<=2*1024**2 and total<=16*1024**2 and len(result)<2000,'bounded-migration-files');raw=archive.extractfile(member).read();need(len(raw)==member.size,'complete-migration-file');result[relative]=sha(raw)
 need(result,'nonempty-migration-file-set');return result
def migration_source():
 global MIGRATION_SOURCE
 if MIGRATION_SOURCE is None:
  path=next(iter(APPS.values()))+'/pb_migrations';MIGRATION_SOURCE=migration_manifest(git('archive',TARGET,path),path+'/')
 return MIGRATION_SOURCE


def guard(service,r,portable=None):
 need(service in APPS,'only-two-pb-guards');expected=migration_source();actual=migration_manifest(run(['docker','cp',r['Id']+':/pb/pb_migrations','-']),'pb_migrations/')
 need(actual==expected,'actual-migration-files-match-reviewed-target');names={pathlib.PurePosixPath(n).name for n in actual if n.endswith('.js')};need(names,'existing-actual-migration-scripts')
 tree=ROOT/APPS[service]/DATA[service][0]
 return pb_guard(service,(pathlib.Path(portable)/'sqlite/data.db')if portable else(tree/'data.db'),envmap(r),names,bool(portable))

def prepare():
 global ACTIVE_OUT
 need(not OUT.exists()and not OUT.is_symlink(),'one-prepare');OUT.mkdir(mode=0o700);ACTIVE_OUT=OUT/'prepare';ACTIVE_OUT.mkdir(mode=0o700)
 need(git('rev-parse','HEAD').decode().strip()==BASE,'canonical-base');source_check();hosts=host_files();private(OUT/'environment.private',(ROOT/'.env.cloud.production').read_bytes())
 source=OUT/'source';extract_source(source);workspace=OUT/'images';workspace.mkdir(mode=0o700);prepared={};records={};probes={};guards={}
 for s in APPS:
  r=one(s);records[s]=r;need(not(ROOT/'deploy/maintenance/services'/s).exists(),'initial-target-gate-clear-'+s);guards[s]=guard(s,r);probes[s]={p:request(p)[0]for p in PROBES[s]}
  prepared[s]=I.prepare_service(s,r['Image'],r['Id'],source,workspace,TARGET,run)
  need(contract(one(s))==contract(r),'prepare-live-contract-unchanged-'+s)
 need(host_files()==hosts,'prepare-host-files-preserved');value={'target':TARGET,'tree':TREE,'services':prepared,'runtime':records,'hostFiles':hosts,'probes':probes,'guards':guards};private(OUT/'prepared.private.json',value)
 return{'preparedSHA256':sha(enc(value)),'imagesSHA256':sha(enc({s:p['image']for s,p in prepared.items()})),'candidateCount':len(prepared),'allCandidatesBuiltBeforeMaintenance':True,'liveServicesNotRestarted':True}


def capture_overlay(cid,recipe,dest,new=False):
 dest.mkdir(mode=0o700)
 for x in recipe['logicalRoots']:I.capture(cid,x['path'],dest/x['path'],x['directory'],run)
 need(I.directory_manifest(dest,recipe['logicalRoots'])==recipe['newDirectoryManifest'if new else'oldDirectoryManifest'],'actual-logical-directory-metadata-exact')
 return I.manifest(dest)


def copy_overlay(cid,recipe,folder):
 for x in recipe['logicalRoots']:
  path=x['path'];need(path in('pb/pb_public','pb/pb_hooks')and x['directory']is True,'only-complete-pb-code-trees')
  run(['docker','cp','-a',str(folder/path)+'/.',cid+':/'+path])

def wait_healthy(s,cid,stable_seconds=0):
 deadline=time.monotonic()+100;since=None
 while time.monotonic()<deadline:
  r=one(s,False);need(r['Id']==cid,'same-target-container')
  if r['State']['Running']and r['State'].get('Health',{}).get('Status')=='healthy':
   if since is None:since=time.monotonic()
   if time.monotonic()-since>=stable_seconds:return r
  else:since=None
  time.sleep(2)
 raise RuntimeError('target-not-healthy')


def gate_on(s):
 path=ROOT/'deploy/maintenance/services'/s;need(path.parent.is_dir()and not path.parent.is_symlink(),'existing-maintenance-directory');fd=os.open(path,os.O_CREAT|os.O_EXCL|os.O_WRONLY|os.O_NOFOLLOW,0o600)
 identity=None
 try:
  st=os.fstat(fd);identity=(st.st_dev,st.st_ino)
  with os.fdopen(fd,'wb')as f:fd=None;f.write(b'');f.flush();os.fsync(f.fileno())
  need(path.is_file()and not path.is_symlink()and(path.stat().st_dev,path.stat().st_ino)==identity,'new-gate-inode-stable')
  return(path,*identity)
 except BaseException:
  if identity is not None and path.is_file()and not path.is_symlink()and(path.stat().st_dev,path.stat().st_ino)==identity:path.unlink()
  raise
 finally:
  if fd is not None:os.close(fd)


def gate_off(owned):
 p,dev,ino=owned;need(p.is_file()and not p.is_symlink()and(p.stat().st_dev,p.stat().st_ino)==(dev,ino),'only-owned-service-gate');p.unlink()


def gate_assert(owned):
 p,dev,ino=owned;need(p.is_file()and not p.is_symlink()and(p.stat().st_dev,p.stat().st_ino)==(dev,ino),'only-owned-target-gate')
def closed_capture(service,destination,owned):
 gate_assert(owned);need(all(request(path)[0]==503 for path in PROBES[service]),'business-ingress-still-gated')
 return D.capture(service,ROOT/APPS[service]/DATA[service][0],destination,True,L)
def deploy(service):
 global ACTIVE_OUT,STAGE,RECOVERY
 need(service in APPS,'only-two-pb-deployments')
 raw=(OUT/'prepared.private.json').read_bytes();need(sha(raw)==PREPARED_SHA256,'sealed-prepared');p=json.loads(raw);need(p['target']==TARGET and p['tree']==TREE,'prepared-source');source_check();need(host_files()==p['hostFiles'],'host-config-preserved')
 if service=='factory-review':need((OUT/'deploy-factory-review-test/success.private.json').is_file(),'test-before-production')
 ACTIVE_OUT=OUT/PHASE;need(not ACTIVE_OUT.exists(),'one-service-deploy');ACTIVE_OUT.mkdir(mode=0o700);recipe=p['services'][service];r=one(service);need(contract(r)==contract(p['runtime'][service]),'same-original-target-contract');guard(service,r)
 need(I.manifest(pathlib.Path(recipe['oldOverlay']))==recipe['oldManifest']and I.manifest(pathlib.Path(recipe['newOverlay']))==recipe['newManifest'],'sealed-code-overlays');need(I.inspect_image(recipe['imageTag'],run)['Id']==recipe['image'],'prepared-image-pin')
 need(capture_overlay(r['Id'],recipe,ACTIVE_OUT/'preapply-code')==recipe['oldManifest'],'actual-code-still-prepared-old')
 owned=None;mutation_attempted=False;completed=False;failure_stage=None
 try:
  owned=gate_on(service);need(all(request(path)[0]==503 for path in PROBES[service]),'target-business-entry-isolated');private(ACTIVE_OUT/'reservation.private.json',{'container':r['Id'],'target':TARGET})
  mutation_attempted=True;run(['docker','stop','--time','30',r['Id']],timeout=50);stopped=one(service,False);need(stopped['Id']==r['Id']and not stopped['State']['Running'],'original-target-stopped')
  guard(service,stopped);before=closed_capture(service,ACTIVE_OUT/'before-data',owned);guard(service,stopped,ACTIVE_OUT/'before-data')
  copy_overlay(r['Id'],recipe,pathlib.Path(recipe['newOverlay']));need(capture_overlay(r['Id'],recipe,ACTIVE_OUT/'new-code',True)==recipe['newManifest'],'new-live-code-exact')
  gate_assert(owned);guard(service,stopped)
  run(['docker','start',r['Id']]);new=wait_healthy(service,r['Id'],5);need(contract(new)==contract(r),'runtime-config-volume-user-environment-unchanged')
  after=closed_capture(service,ACTIVE_OUT/'after-data',owned)
  policy={'auxiliary.db':['_logs']}if'auxiliary.db'in before['sqlite']and'_logs'in before['sqlite']['auxiliary.db']['tables']else{}
  comparison=D.compare(before,after,policy);need(comparison['preserved']and comparison['deploymentAttributionPermitted'],'persistent-business-auth-files-and-owner-preserved')
  need(host_files()==p['hostFiles'],'host-config-still-preserved');tag='rr-portal-'+service+':latest';run(['docker','tag',recipe['image'],tag]);need(I.inspect_image(tag,run)['Id']==recipe['image'],'canonical-fixed-image-alias-exact')
  private(ACTIVE_OUT/'committed.private.json',{'service':service,'target':TARGET,'recipeImage':recipe['image'],'liveRuntimeImage':r['Image'],'comparison':comparison});gate_off(owned);owned=None
  public={path:request(path)[0]for path in PROBES[service]};need(public==p['probes'][service],'public-status-and-auth-retained');private(ACTIVE_OUT/'success.private.json',{'service':service,'public':public,'target':TARGET});completed=True
  return{'service':service,'publishedRevision':TARGET,'sameContainer':True,'runtimeRestarted':True,'image':recipe['image'],'liveRuntimeImage':r['Image'],'configurationPreserved':True,'persistentDataPreserved':comparison['preserved'],'businessAndAuthExact':comparison['businessAndAuthExact'],'allSQLiteTablesExact':comparison['sqliteAllTablesExact'],'public':public,'targetMaintenanceCleared':True}
 except BaseException:
  failure_stage=STAGE
  if mutation_attempted and owned is None:
   try:owned=gate_on(service);RECOVERY['ownGateRecreatedAfterPostOpenFailure']=True
   except BaseException as e:RECOVERY.update(postOpenGateReservationFailed=True,gateErrorType=type(e).__name__)
  STAGE=failure_stage;raise
 finally:
  if not completed:
   RECOVERY.update(automaticStartOrDataRestoreAttempted=False,unknownMutationNeverRetried=True)
   if owned is not None:
    try:
     gate_assert(owned)
     if not mutation_attempted:
      current=one(service);need(contract(current)==contract(r)and host_files()==p['hostFiles'],'untouched-original-contract-before-gate-cleanup');guard(service,current);gate_off(owned);RECOVERY['ownGateClearedBeforeLiveMutation']=True
     else:RECOVERY['onlyFailedTargetMaintenanceRetained']=True
    except BaseException as e:RECOVERY.update(ownedGateProofFailed=True,gateErrorType=type(e).__name__)
  if failure_stage is not None:STAGE=failure_stage

def verify():
 global ACTIVE_OUT
 raw=(OUT/'prepared.private.json').read_bytes();need(sha(raw)==PREPARED_SHA256,'sealed-final-prepared');p=json.loads(raw);source_check();ACTIVE_OUT=OUT/'verify';need(not ACTIVE_OUT.exists(),'one-final-verify');ACTIVE_OUT.mkdir(mode=0o700);result={}
 for s,recipe in p['services'].items():
  need((OUT/('deploy-'+s)/'success.private.json').is_file(),'each-service-success-before-final');r=one(s);need(contract(r)==contract(p['runtime'][s]),'same-final-runtime-contract');guard(s,r);need(I.inspect_image('rr-portal-'+s+':latest',run)['Id']==recipe['image'],'final-canonical-image-alias-exact');need(capture_overlay(r['Id'],recipe,ACTIVE_OUT/s,True)==recipe['newManifest'],'final-running-source-and-static-exact');need(not(ROOT/'deploy/maintenance/services'/s).exists(),'final-target-maintenance-clear');result[s]={path:request(path)[0]for path in PROBES[s]};need(result[s]==p['probes'][s],'final-public-and-auth-status')
 git('merge','--ff-only',TARGET);need(git('rev-parse','HEAD').decode().strip()==TARGET and host_files()==p['hostFiles'],'canonical-main-advanced-preserving-environment')
 return{'bothServicesVerified':True,'public':result,'frontendAndBackendSourceRevision':TARGET,'environmentAndConfigurationPreserved':True,'noDataRestoreOrCursorReset':True,'noModelCallsOrAuthenticatedLogin':True}


def main():
 need(EXECUTE is True and sys.argv[1:]==[PHASE]and(PHASE in('prepare','verify')or PHASE.startswith('deploy-')and PHASE[7:]in APPS),'inert-exact-phase');need(os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_ATTEMPT')=='1'and os.environ.get('RELEASE_MODE')==PHASE,'fixed-first-attempt-branch');os.umask(0o077);initialize();value={'phase':PHASE,'target':TARGET,'success':False}
 try:value.update(prepare()if PHASE=='prepare'else verify()if PHASE=='verify'else deploy(PHASE[7:]));value['success']=True
 except Exception as e:
  value.update(errorType=type(e).__name__,stage=STAGE)
  if isinstance(e,RuntimeError)and re.fullmatch(r'(?:IMAGE_PREPARE_[a-z0-9-]{1,160}|[a-z][a-z0-9-]{0,160})',str(e)):value['errorLabel']=str(e)
  if RECOVERY:value['recovery']=RECOVERY
 value['commandNumber']=SERIAL;value['utc']=datetime.datetime.now(datetime.timezone.utc).isoformat();value['resultSHA256']=sha(enc(value));value['sha256Wire']={k:[int(c,16)for c in(v.split(':')[1]if v.startswith('sha256:')else v)]for k,v in value.items()if type(v)is str and re.fullmatch('(?:sha256:)?[a-f0-9]{64}|[a-f0-9]{40}',v)};print(json.dumps(value,sort_keys=True),flush=True);return 0 if value['success']else 1


if __name__=='__main__':sys.exit(main())
