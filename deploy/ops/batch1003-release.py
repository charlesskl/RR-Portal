"""Scoped same-container code publication. Inert; source and phase pins required.

Build before maintenance; each service has an independent one-shot publication.
Persistent data is never restored or rewritten. Only qc/PB/docs restart; RR stays up.
"""
import contextlib,datetime,hashlib,importlib.util,io,json,os,pathlib,re,shutil,sqlite3,stat,subprocess,sys,tarfile,time,urllib.request,urllib.error
ROOT=pathlib.Path('/opt/rr-portal')
OUT=ROOT/'deploy/backups/batch-1003-1011-20261026-release'
BASE='74b0f2143197dd1a814a4a11b0f737c3f110454e'
BRANCH='refs/heads/ops/batch-1003-1011-20261026'
TARGET='6b36a35e0d1239a96da3d24ec660ac6fb678f8f0'
TREE='5d02b2e9187a1eb16e1ccf45f9b6b8b103c382b5'
PHASE='verify'
EXECUTE=True
PREPARED_SHA256='3c1cbd2bd001104a89a1b60f0e267a40cfb9ed3b8fee0ad8d80e160d838c9ead'
DEPS={'batch1003-data-library.py':'f40fdf266b765a9a1fedcb04190b413e2d979aaa8e7548c030c1eed5560e50c6','batch1003-image-library.py':'94d9dc30f1e21ee1346f89ac231bbc28ebc21d210d08298f54c56cc0103fab02','release-data-library.py':'d63168fd3057f4f2aba2d93f9fab31d2d65c6dd0f3234877d71fcff1e04e62b9'}
APPS={'qc':'apps/生产部/品质管理系统','rr-production':'apps/工程部/工程啤办单','gongcheng-ziliao':'apps/工程部/工程资料管理系统','factory-review':'apps/PMC跟仓管/加工厂月度评审管理制度','factory-review-test':'apps/PMC跟仓管/加工厂月度评审管理制度'}
APP_TREES={'qc':'d0229f6137739c8ac694a4214464d6aa244e52af','rr-production':'aa40a3bbfaca1f50db4bf73274d73f5156e94566','gongcheng-ziliao':'a1fab1cf262839c8d466602de4e7d1ee0fa0c185','factory-review':'6143dd4f0e5bfd92d3ccd0100d4c3817cbf6c918','factory-review-test':'6143dd4f0e5bfd92d3ccd0100d4c3817cbf6c918'}
DATA={'qc':('data','/app/data'),'rr-production':('data','/app/data'),'gongcheng-ziliao':('资料库存储','/data'),'factory-review':('pb_data','/pb/pb_data'),'factory-review-test':('pb_data_test','/pb/pb_data')}
PROBES={'qc':['/qc/api/health','/qc/qc-backend.js','/qc/api/records?company=dg-xingxin'],'rr-production':['/rr/health','/rr/engineering.html','/rr/slush.html'],'gongcheng-ziliao':['/gongcheng-ziliao/health','/gongcheng-ziliao/'],'factory-review':['/factory-review/api/factory-review/health','/factory-review/','/factory-review/api/factory-review/delivery-reminders'],'factory-review-test':['/factory-review-test/api/factory-review/health','/factory-review-test/','/factory-review-test/api/factory-review/delivery-reminders']}
COMPANIES={'dg-xingxin','dg-huadeng-a','dg-huadeng-b','dg-huajia','hy-huakang-a','hy-huakang-b','hy-huakang-c','hy-huakang-d','hy-huadeng','hy-huaxing','sy-huadeng','sy-xingxin','xs-huadeng'}
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
 need(re.fullmatch('[a-f0-9]{40}',TARGET or''),'bound-target');git('fetch','--no-write-fetch-head','origin','+refs/heads/main:refs/remotes/origin/main')
 need(git('rev-parse','origin/main').decode().strip()==TARGET and git('rev-parse',TARGET+'^{tree}').decode().strip()==TREE,'exact-reviewed-main-tree')
 for s,a in APPS.items():need(git('rev-parse',TARGET+':'+a).decode().strip()==APP_TREES[s],'reviewed-app-tree-'+s)
 changed=git('diff','--name-only','-z',BASE,TARGET).decode().rstrip('\0').split('\0');need(changed and all(any(n.startswith(a+'/')for a in APPS.values())for n in changed),'only-four-reviewed-apps')
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
def qc_guard(tree,portable=False):
 need(tree.is_dir()and not tree.is_symlink(),'existing-qc-data');result={}
 for c in sorted(COMPANIES):
  p=tree/c/'qc.db';need(p.is_file()and not p.is_symlink(),'existing-qc-db-'+c)
  with contextlib.closing(L.connect(p,portable))as db:
   tables={r[0]for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")};need({'records','users','defect_library','partners','record_tombstones'}<=tables,'existing-qc-tables-'+c)
   need({'name','dept','perms'}<={r[1]for r in db.execute('PRAGMA table_info(users)')},'existing-qc-user-columns-'+c)
   need({'processType','status','reviewBy','reviewAt','rejectReason','rejectBy','rejectAt','aqlLevel'}<={r[1]for r in db.execute('PRAGMA table_info(records)')},'existing-qc-record-columns-'+c)
   need(db.execute('SELECT count(*) FROM users').fetchone()[0]>0 and db.execute('SELECT count(*) FROM defect_library').fetchone()[0]>0,'no-qc-seed-trigger-'+c)
   if c=='dg-xingxin':need(db.execute('SELECT count(*) FROM records').fetchone()[0]>0,'no-dg-record-seed-trigger')
  result[c]=True
 return {'all13ExistingDatabasesAndColumnsReady':len(result)==13,'seedWillNotRun':True}
def pb_guard(service,dbpath,environment,portable=False):
 with contextlib.closing(L.connect(dbpath,portable))as db:
  email=environment.get('FACTORY_REVIEW_ADMIN_EMAIL','').strip();pw=environment.get('FACTORY_REVIEW_ADMIN_PASSWORD','');need(email and len(pw)>=12 and db.execute('SELECT count(*) FROM users WHERE email=?',(email,)).fetchone()[0]==1,'existing-pb-admin-prevents-health-write-'+service)
  applied={r[0]for r in db.execute('SELECT file FROM _migrations')}
 expected={pathlib.PurePosixPath(n).name for n in git('ls-tree','-r','--name-only','-z',TARGET,'--',APPS[service]+'/pb_migrations').decode().rstrip('\0').split('\0')if n.endswith('.js')};need(expected and expected<=applied,'all-pb-migrations-already-applied-'+service)
 return {'existingAdminAndPermissionsPreserved':True,'allMigrationsAlreadyApplied':True}
def guard(service,r,portable=None):
 tree=ROOT/APPS[service]/DATA[service][0]
 if service=='qc':return qc_guard(pathlib.Path(portable)/'sqlite'if portable else tree,bool(portable))
 if service.startswith('factory-review'):return pb_guard(service,(pathlib.Path(portable)/'sqlite/data.db')if portable else(tree/'data.db'),envmap(r),bool(portable))
 return {'noDatabaseStartupChangeRequested':True}
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
def copy_overlay(cid,recipe,folder,rr=False):
 for x in recipe['logicalRoots']:
  path=x['path'];src=folder/path;need(I.safe(path)and not path.startswith(('app/data/','pb/pb_data/')),'code-root-only')
  if rr:
   need(not x['directory'],'rr-files-only');staged='/app/.batch1003-'+pathlib.PurePosixPath(path).name;run(['docker','cp','-a',str(src),cid+':'+staged]);run(['docker','exec','--user','0',cid,'mv','-fT',staged,'/'+path])
  else:run(['docker','cp','-a',str(src)+('/.'if x['directory']else''),cid+':/'+path])
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
def deploy(service):
 global ACTIVE_OUT,STAGE,RECOVERY
 raw=(OUT/'prepared.private.json').read_bytes();need(sha(raw)==PREPARED_SHA256,'sealed-prepared');p=json.loads(raw);need(p['target']==TARGET and p['tree']==TREE,'prepared-source');source_check();need(host_files()==p['hostFiles'],'host-config-preserved')
 ACTIVE_OUT=OUT/PHASE;need(not ACTIVE_OUT.exists(),'one-service-deploy');ACTIVE_OUT.mkdir(mode=0o700);recipe=p['services'][service];r=one(service);need(contract(r)==contract(p['runtime'][service]),'same-original-target-contract');guard(service,r)
 need(I.manifest(pathlib.Path(recipe['oldOverlay']))==recipe['oldManifest']and I.manifest(pathlib.Path(recipe['newOverlay']))==recipe['newManifest'],'sealed-code-overlays');need(I.inspect_image(recipe['imageTag'],run)['Id']==recipe['image'],'prepared-image-pin')
 need(capture_overlay(r['Id'],recipe,ACTIVE_OUT/'preapply-code')==recipe['oldManifest'],'actual-code-still-prepared-old')
 owned=None;stopped=False;stop_attempted=False;stop_uncertain=False;changed=False;completed=False;before=None;failure_stage=None;closed_guard_proven=False;blocked_restart=False
 try:
  owned=gate_on(service);need(all(request(path)[0]==503 for path in PROBES[service]),'target-business-entry-isolated');private(ACTIVE_OUT/'reservation.private.json',{'container':r['Id'],'target':TARGET})
  if service!='rr-production':
   stop_attempted=True;stop_uncertain=True;run(['docker','stop','--time','30',r['Id']],timeout=50);need(not one(service,False)['State']['Running'],'original-target-stopped');stopped=True;stop_uncertain=False
   before=D.capture(service,ROOT/APPS[service]/DATA[service][0],ACTIVE_OUT/'before-data',service!='gongcheng-ziliao',L);guard(service,r,ACTIVE_OUT/'before-data');closed_guard_proven=True
  changed=True;copy_overlay(r['Id'],recipe,pathlib.Path(recipe['newOverlay']),service=='rr-production');need(capture_overlay(r['Id'],recipe,ACTIVE_OUT/'new-code',True)==recipe['newManifest'],'new-live-code-exact')
  if stopped:run(['docker','start',r['Id']]);new=wait_healthy(service,r['Id'])
  else:new=one(service)
  need(contract(new)==contract(r),'runtime-config-volume-user-environment-unchanged');comparison=None
  if before is not None:
   after=D.capture(service,ROOT/APPS[service]/DATA[service][0],ACTIVE_OUT/'after-data',service!='gongcheng-ziliao',L)
   policy={'auxiliary.db':['_logs']}if service.startswith('factory-review')and'auxiliary.db'in before['sqlite']and'_logs'in before['sqlite']['auxiliary.db']['tables']else{}
   comparison=D.compare(before,after,policy);need(comparison['preserved'],'persistent-business-auth-files-and-owner-preserved')
  need(host_files()==p['hostFiles'],'host-config-still-preserved');tag='rr-portal-'+service+':latest';run(['docker','tag',recipe['image'],tag]);private(ACTIVE_OUT/'committed.private.json',{'service':service,'target':TARGET,'recipeImage':recipe['image'],'liveRuntimeImage':r['Image'],'comparison':comparison});completed=True
 except BaseException:
  failure_stage=STAGE
  raise
 finally:
  recovery_error=None
  try:
   if not completed and service=='rr-production'and changed:copy_overlay(r['Id'],recipe,pathlib.Path(recipe['oldOverlay']),True)
   if not completed and stop_attempted:
    current=one(service,False);need(current['Id']==r['Id'],'recover-only-original-container')
    healthy=current['State']['Running']and current['State'].get('Health',{}).get('Status')=='healthy'
    if stop_uncertain or not healthy:
     if current['State']['Running']:
      # A separate reconciliation is authorized by the newly observed running
      # state, never by rerunning this deployment phase or trusting cached health.
      need(owned is not None and owned[0].is_file()and(owned[0].stat().st_dev,owned[0].stat().st_ino)==owned[1:],'reconcile-only-under-owned-target-gate')
      RECOVERY['observedRunningReconcileStopAttempted']=True
      run(['docker','stop','--time','30',r['Id']],timeout=50)
     need(not one(service,False)['State']['Running'],'reconciled-original-container-is-stopped')
     # An in-flight write could invalidate the earlier live guard. Re-read the
     # actual stopped data before *any* start, including recovery of old code.
     try:guard(service,r);closed_guard_proven=True;RECOVERY['freshStoppedStartupGuardPassed']=True
     except BaseException:
      blocked_restart=True;RECOVERY.update(restartBlockedByStartupGuard=True,blockedGuardStage=STAGE)
      raise
     need(closed_guard_proven,'authoritative-startup-guard-before-recovery')
     if changed:copy_overlay(r['Id'],recipe,pathlib.Path(recipe['oldOverlay']))
     run(['docker','start',r['Id']]);wait_healthy(service,r['Id'],10 if stop_uncertain else 0)
     RECOVERY['originalCodeRestartedWithoutDataRestore']=True
    # A healthy new process with an unexpected data comparison is retained for
    # investigation. Never restore data or run the operation a second time.
  except BaseException as error:recovery_error=error;RECOVERY.update(recoveryProven=False,recoveryErrorType=type(error).__name__,recoveryStage=STAGE)
  finally:
   try:
    if owned is not None and not blocked_restart:gate_off(owned);RECOVERY['ownedMaintenanceFlagCleared']=True
    elif owned is not None:RECOVERY['onlyTargetMaintenanceRetainedForBlockedStartupGuard']=True
   except BaseException as error:
    if recovery_error is None:recovery_error=error
    RECOVERY.update(maintenanceCleanupProven=False,maintenanceErrorType=type(error).__name__)
   if failure_stage is not None:STAGE=failure_stage
  if recovery_error is not None and failure_stage is None:raise recovery_error
 public={path:request(path)[0]for path in PROBES[service]};need(public==p['probes'][service],'public-status-and-auth-retained');private(ACTIVE_OUT/'success.private.json',{'service':service,'public':public,'target':TARGET})
 return{'service':service,'publishedRevision':TARGET,'sameContainer':True,'runtimeRestarted':service!='rr-production','image':recipe['image'],'liveRuntimeImage':r['Image'],'configurationPreserved':True,'persistentDataPreserved':comparison['preserved']if comparison is not None else None,'businessAndAuthExact':comparison['businessAndAuthExact']if comparison is not None else None,'allSQLiteTablesExact':comparison['sqliteAllTablesExact']if comparison is not None else None,'public':public,'targetMaintenanceCleared':True}
def verify():
 global ACTIVE_OUT
 raw=(OUT/'prepared.private.json').read_bytes();need(sha(raw)==PREPARED_SHA256,'sealed-final-prepared');p=json.loads(raw);source_check();ACTIVE_OUT=OUT/'verify';need(not ACTIVE_OUT.exists(),'one-final-verify');ACTIVE_OUT.mkdir(mode=0o700);result={}
 for s,recipe in p['services'].items():
  need((OUT/('deploy-'+s)/'success.private.json').is_file(),'each-service-success-before-final');r=one(s);need(contract(r)==contract(p['runtime'][s]),'same-final-runtime-contract');need(capture_overlay(r['Id'],recipe,ACTIVE_OUT/s,True)==recipe['newManifest'],'final-running-source-and-static-exact');need(not(ROOT/'deploy/maintenance/services'/s).exists(),'final-target-maintenance-clear');result[s]={path:request(path)[0]for path in PROBES[s]};need(result[s]==p['probes'][s],'final-public-and-auth-status')
 git('merge','--ff-only',TARGET);need(git('rev-parse','HEAD').decode().strip()==TARGET and host_files()==p['hostFiles'],'canonical-main-advanced-preserving-environment')
 return{'allFiveServicesVerified':True,'public':result,'frontendAndBackendSourceRevision':TARGET,'environmentAndConfigurationPreserved':True,'noDataRestoreOrCursorReset':True}
def main():
 need(EXECUTE is True and sys.argv[1:]==[PHASE]and(PHASE in('prepare','verify')or PHASE.startswith('deploy-')and PHASE[7:]in APPS),'inert-exact-phase');need(os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_ATTEMPT')=='1'and os.environ.get('RELEASE_MODE')==PHASE,'fixed-first-attempt-branch');os.umask(0o077);initialize();value={'phase':PHASE,'target':TARGET,'success':False}
 try:value.update(prepare()if PHASE=='prepare'else verify()if PHASE=='verify'else deploy(PHASE[7:]));value['success']=True
 except Exception as e:
  value.update(errorType=type(e).__name__,stage=STAGE)
  if RECOVERY:value['recovery']=RECOVERY
 value['utc']=datetime.datetime.now(datetime.timezone.utc).isoformat();value['resultSHA256']=sha(enc(value));value['sha256Wire']={k:[int(c,16)for c in(v.split(':')[1]if v.startswith('sha256:')else v)]for k,v in value.items()if type(v)is str and re.fullmatch('(?:sha256:)?[a-f0-9]{64}|[a-f0-9]{40}',v)};print(json.dumps(value,sort_keys=True),flush=True);return 0 if value['success']else 1
if __name__=='__main__':sys.exit(main())
