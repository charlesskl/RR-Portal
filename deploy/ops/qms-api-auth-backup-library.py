"""Three-service QMS auth backup. Draft: execution gate is false.

Only filesystem copies, SQLite read transactions and read-only container execs.
No HTTP, model calls, signals, maintenance changes, PostgreSQL or mail access.
SQLite copies are individually consistent, never cross-database atomic.
"""
import contextlib,datetime,hashlib,importlib.util,io,json,os,pathlib,re,shutil,signal,stat,sys,tarfile,traceback

ROOT=pathlib.Path('/opt/rr-portal')
BASE='73364c71ad44528db35197465e9cee0f3e4a2606'
BASE_TREE='3275c7fadb9d14d0657196abf35c3a9f4a1906f4'
BRANCH='refs/heads/ops/qms-api-auth-20261021'
BACKUP_PIN=False
OUT=ROOT/'deploy/backups/qms-api-auth-20261021-backup'
FACTORY='apps/PMC跟仓管/加工厂月度评审管理制度'
QC='apps/生产部/品质管理系统'
APPS=(FACTORY,QC)
ORDER=('factory-review-test','factory-review','qc')
STORAGE={'factory-review-test':(FACTORY+'/pb_data_test','/pb/pb_data'),'factory-review':(FACTORY+'/pb_data','/pb/pb_data'),'qc':(QC+'/data','/app/data')}
QC_COMPANIES={'dg-xingxin','dg-huadeng-a','dg-huadeng-b','dg-huajia','hy-huakang-a','hy-huakang-b','hy-huakang-c','hy-huakang-d','hy-huadeng','hy-huaxing','sy-huadeng','sy-xingxin','xs-huadeng'}
QC_HISTORICAL_SQLITE={company+'/qc.db.bak.20260910-152122'for company in QC_COMPANIES}
FIXED=('docker-compose.cloud.yml','nginx/nginx.cloud.conf','deploy/update-server.sh','deploy/service-maintenance.sh','.github/workflows/deploy.yml','.env.example',FACTORY+'/Dockerfile',FACTORY+'/.dockerignore',QC+'/Dockerfile',QC+'/.dockerignore')
DEPS={'factory-review-backup-library.py':'79d76bb47312dd08c121ebe2797f54d958666f8b72d00721f67712b152fc4666','release-data-ops-library.py':'ff9138a1d5bfed1b10077112da6ebcda2d65240f583e2d0e12ce1325cfbaafd5','release-data-library.py':'d63168fd3057f4f2aba2d93f9fab31d2d65c6dd0f3234877d71fcff1e04e62b9'}
PRIOR_FACTORY_PREPARE=ROOT/'deploy/backups/batch-983-984-987-20261021-prepare'
PRIOR_FACTORY_MANIFEST='a98c6e90814ef8d2b75b91bc1197d18869080d0027cc921d19e2bc91e3d8bae5'
PRIOR_FACTORY_RESULT='20de48d001617f3b6058ccffe0db965ae6d0d089ec1bb215b60cc004ddad42ca'
F=None;STAGE='entrypoint';RUNTIME_SERIAL=0

def need(v,label):
 global STAGE
 if not v:STAGE=label;raise RuntimeError('QMS_API_AUTH_BACKUP_REJECTED')
def safe_stage(v):return v if type(v)is str and re.fullmatch('[A-Za-z0-9_.-]{1,160}',v)else'unavailable'
def enc(v):return json.dumps(v,ensure_ascii=True,sort_keys=True,separators=(',',':'),allow_nan=False).encode()
def sha(v):return hashlib.sha256(v).hexdigest()
def read(p):return json.loads(p.read_bytes())
def private(n,v):F.OPS.L.private_write(OUT/n,v if type(v)is bytes else enc(v))
def run(a,data=None,timeout=180):return F.run(a,data,timeout)
def load(name):
 p=pathlib.Path(__file__).with_name(name);need(p.is_file()and not p.is_symlink()and sha(p.read_bytes())==DEPS[name],'dependency-pin');s=importlib.util.spec_from_file_location(name.replace('.','_'),p);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
def initialize(out):
 global F,OUT
 OUT=out;F=load('factory-review-backup-library.py');need(F.BACKUP_PIN is False and F.DEPLOY_PIN is False and F.VERIFY_PIN is False,'inert-factory-library');F.BASE=BASE;F.ROOT=ROOT;F.APP=ROOT/FACTORY;F.OUT=OUT;F.OPS=load('release-data-ops-library.py');F.OPS.L=load('release-data-library.py');F.OPS.L.databases=F.OPS.database_names;F.OPS.run=F.run
def meta(p):
 need(p.exists()and not p.is_symlink(),'regular-metadata-path');s=p.lstat();need(stat.S_ISREG(s.st_mode)or stat.S_ISDIR(s.st_mode),'regular-metadata-kind');return{'mode':stat.S_IMODE(s.st_mode),'uid':s.st_uid,'gid':s.st_gid}
def ownership(tree,names):
 physical=set(names)|{n+x for n in names for x in('-wal','-shm','-journal')};result={'.':meta(tree)}
 for p in sorted(tree.rglob('*')):
  n=str(p.relative_to(tree));need(F.OPS.L.safe_path(n),'safe-owned-path')
  if n not in physical:result[n]=meta(p)
 return result
def db_metadata(tree,names):return{n:meta(tree/n)for n in names}
def db_family_metadata(tree,names):return{n+x:meta(tree/(n+x))for n in names for x in('','-wal','-shm','-journal')if(tree/(n+x)).exists()}
def process_environment(cid):
 blob=run(['docker','exec',cid,'cat','/proc/1/environ']);need(blob.endswith(b'\0'),'complete-pid1-environment');v=F.envmap([x.decode()for x in blob.split(b'\0')if x]);need(v.pop('HOSTNAME',None)==cid[:12],'automatic-pid1-hostname');return v
def runtime(require_healthy=True):
 global RUNTIME_SERIAL
 ids=run(['docker','ps','-aq','--no-trunc']).decode().split();need(len(ids)==len(set(ids))==46 and all(re.fullmatch('[a-f0-9]{64}',x)for x in ids),'all-46-container-identities');records=json.loads(run(['docker','inspect',*ids]));need(type(records)is list and len(records)==46 and{r['Id']for r in records}==set(ids),'all-46-runtime-inspects');targets={};others={};raw={}
 RUNTIME_SERIAL+=1;private('all-runtime-inspect-%03d.private.json'%RUNTIME_SERIAL,records)
 for r in records:
  cid=r['Id'];labels=r['Config'].get('Labels')or{};s=labels.get('com.docker.compose.service')if labels.get('com.docker.compose.project')=='rr-portal'else None
  row={'id':cid,'image':r['Image'],'started':r['State'].get('StartedAt'),'running':r['State']['Running'],'oom':r['State']['OOMKilled'],'restarts':r['RestartCount'],'health':r['State'].get('Health',{}).get('Status'),'environmentMapSHA256':sha(enc(F.envmap(r['Config']['Env']))),'mounts':sorted(r['Mounts'],key=enc),'configSHA256':sha(enc(dict(r['Config'],Env=sorted(r['Config']['Env'])))),'hostConfigSHA256':sha(enc(r['HostConfig']))}
  if s not in ORDER:others[cid]=row;continue
  need(s not in targets,'unique-target-service');need(not require_healthy or(row['running']is True and row['oom']is False and row['health']=='healthy'),'healthy-target-runtime');source,destination=STORAGE[s];mounts=[m for m in r['Mounts']if m['Destination']==destination];need(len(r['Mounts'])==len(mounts)==1 and mounts[0]['Type']=='bind'and mounts[0]['Source']==str(ROOT/source)and mounts[0]['RW']is True,'exact-service-persistent-mount')
  need(r['Config'].get('Hostname')==cid[:12],'automatic-config-hostname')
  if row['running']:row['processEnvironmentWithoutAutomaticHostnameSHA256']=sha(enc(process_environment(cid)))
  targets[s]=row;raw[s]=r
 need(set(targets)==set(ORDER)and len(others)==43,'exact-three-targets-43-others')
 canonical={s:(ROOT/n).resolve(strict=True)for s,(n,_)in STORAGE.items()};need(all(str(p)==str(ROOT/STORAGE[s][0])for s,p in canonical.items()),'canonical-persistent-roots-without-symlink-aliases');need(all(not(a==b or str(a).startswith(str(b)+'/')or str(b).startswith(str(a)+'/'))for i,a in enumerate(canonical.values())for b in list(canonical.values())[i+1:]),'disjoint-canonical-persistent-roots')
 for r in records:
  for mount in r.get('Mounts',[]):
   src=mount.get('Source','')
   if not src:continue
   actual=str(pathlib.Path(src).resolve(strict=True))
   for service,path in canonical.items():
    expected=str(path)
    if actual==expected or actual.startswith(expected+'/')or expected.startswith(actual.rstrip('/')+'/'):
     need(r['Id']==raw[service]['Id']and src==actual==expected,'one-writer-exclusive-canonical-persistent-root')
 return{'targets':targets,'others':others},raw
def dirty_snapshot(save=False):
 run(['git','diff','--cached','--quiet','--no-ext-diff','--no-textconv','--ignore-submodules=none']);names=run(['git','diff','--name-only','-z','--no-ext-diff','--no-textconv','--ignore-submodules=none']).decode().strip('\0').split('\0');need(len(names)==len(set(names))==4,'exact-four-preexisting-dirty-files');rows={}
 for i,n in enumerate(sorted(names)):
  need(F.OPS.L.safe_path(n)and n not in FIXED and not any(n==a or n.startswith(a+'/')for a in APPS),'dirty-outside-three-apps-and-fixed-configuration');entry=run(['git','ls-tree','-z',BASE,'--',n]);need(re.fullmatch(b'100(?:644|755) blob [a-f0-9]{40}\t'+re.escape(n.encode())+b'\0',entry)is not None,'dirty-original-regular-file');p=ROOT/n
  for parent in(p,*p.parents):
   if parent==ROOT:break
   need(not parent.is_symlink(),'dirty-no-symlink-ancestors')
  if not p.exists():rows[n]={'kind':'absent'};continue
  need(p.is_file(),'dirty-regular-file');before=p.lstat();data=p.read_bytes();after=p.lstat();need((before.st_dev,before.st_ino,before.st_mode,before.st_uid,before.st_gid,before.st_size,before.st_mtime_ns,before.st_ctime_ns)==(after.st_dev,after.st_ino,after.st_mode,after.st_uid,after.st_gid,after.st_size,after.st_mtime_ns,after.st_ctime_ns)and len(data)<=8*1024**2,'stable-bounded-dirty-file');rows[n]=dict(meta(p),kind='regular',bytes=len(data),sha256=sha(data))
  if save:private('dirty-%02d.private'%i,data)
 return rows
def source(revision=BASE):
 need(run(['git','symbolic-ref','--quiet','HEAD']).decode().strip()=='refs/heads/main'and run(['git','rev-parse','HEAD']).decode().strip()==revision,'exact-canonical-main');run(['git','diff','--quiet','--no-ext-diff','--no-textconv','--ignore-submodules=none','--',*APPS]);result={}
 for n in FIXED:
  p=ROOT/n;need(p.is_file()and not p.is_symlink()and p.read_bytes()==run(['git','show',BASE+':'+n]),'fixed-source-global-config-preserved');result[n]={'sha256':F.OPS.L.file_hash(p),**meta(p)}
 return result
def code_paths(service,revision):
 need(service=='qc','only-qc-nonfactory-source');prefix=QC;names=run(['git','ls-tree','-r','--name-only','-z',revision,'--',prefix]).decode().rstrip('\0').split('\0');relative=[n[len(prefix)+1:]for n in names];relative=[n for n in relative if not any(p in{'data','node_modules','.git'}for p in pathlib.PurePosixPath(n).parts)and not n.endswith(('.bat','/qc.db','.db-wal','.db-shm'))];need(relative and len(relative)==len(set(relative))and all(F.OPS.L.safe_path(n)for n in relative),'safe-complete-qc-docker-copy-paths');return prefix,relative
def application_proof(service,row,revision,image=None):
 if service.startswith('factory-review'):
  old=F.BASE;F.BASE=revision
  try:
   result=F.runtime_files(service,row);prior=prior_factory_prepare();need(row['image']==prior['images'][service]and result['files']==prior['proofs'][service],'factory-runtime-equals-sealed-batch733-candidate');return result
  finally:F.BASE=old
 prefix,names=code_paths(service,revision);expected={n:sha(run(['git','show',revision+':'+prefix+'/'+n]))for n in names};blob=run(['docker','exec','--user','0',row['id'],'tar','-C','/app','-cf','-',*names]);found={};total=0
 with tarfile.open(fileobj=io.BytesIO(blob),mode='r:')as archive:
  for member in archive:
   n=member.name;need(F.OPS.L.safe_path(n)and n in expected and n not in found and member.isfile(),'safe-exact-runtime-source-tar');total+=member.size;need(member.size<=16*1024**2 and total<=32*1024**2,'bounded-source-tar');data=archive.extractfile(member).read();need(len(data)==member.size,'complete-runtime-source-file');found[n]={'bytes':member.size,'sha256':sha(data)}
 need({n:v['sha256']for n,v in found.items()}==expected,'all-docker-copy-source-files-match-revision');return{'runningSourceBase':revision,'applicationTree':run(['git','rev-parse',revision+':'+prefix]).decode().strip(),'reviewedSourceMatch':True,'files':found}
def prior_factory_prepare():
 p=PRIOR_FACTORY_PREPARE;L=F.OPS.L;need(p.is_dir()and not p.is_symlink()and stat.S_IMODE(p.stat().st_mode)==0o700,'private-prior-factory-prepare');need(L.file_hash(p/'manifest.json')==PRIOR_FACTORY_MANIFEST and L.file_hash(p/'first-result.json')==PRIOR_FACTORY_RESULT,'exact-prior-factory-archive-seals');manifest=read(p/'manifest.json');entries=list(p.rglob('*'));need(type(manifest)is dict and len(entries)<=100000 and all(not x.is_symlink()and(x.is_file()or x.is_dir())and x.stat().st_mode&0o077==0 for x in entries),'private-prior-factory-entries');need(set(manifest)=={str(x.relative_to(p))for x in entries if x.is_file()and x!=p/'manifest.json'}and all(L.safe_path(n)and re.fullmatch('[a-f0-9]{64}',h or'')and L.file_hash(p/n)==h for n,h in manifest.items()),'all-prior-factory-private-file-seals');r=read(p/'first-result.json');prepared=read(p/'prepared.private.json');need(r.get('success')is True and r.get('mode')=='prepare'and r.get('target')==BASE and r.get('tree')==BASE_TREE and prepared['target']==BASE and prepared['tree']==BASE_TREE and set(prepared['images'])==set(prepared['proofs'])=={'factory-review','factory-review-test','rr-production','qc'},'prior-factory-exact-prepared-base');return prepared
def capture(service,label):
 tree=ROOT/STORAGE[service][0];dest=OUT/(service+'-'+label);names=F.OPS.database_names(tree);before=ownership(tree,names);value=F.OPS.sqlite_capture(service,tree,dest);need(set(value['sqlite'])==set(names),'all-discovered-sqlite-copied')
 if service.startswith('factory-review'):need(set(names)=={'data.db','auxiliary.db'},'exact-factory-databases')
 elif service=='qc':need(set(names)=={company+'/qc.db'for company in QC_COMPANIES}|QC_HISTORICAL_SQLITE,'exact-13-active-13-historical-qc-databases')
 else:need(names==[]and(tree/'data.json').is_file(),'engineering-json-without-sqlite')
 value.update(metadata=db_metadata(tree,names),fileOwnership=ownership(tree,names),databaseFamilyMetadata=db_family_metadata(tree,names),observedUTC=datetime.datetime.now(datetime.timezone.utc).isoformat());need(value['fileOwnership']==before and F.OPS.L.non_database_inventory(tree,names)==value['files'],'stable-captured-files-and-mode-owners');private(service+'-'+label+'.private.json',value);return value,dest
def factory_build_revisions():
 prior_factory_prepare();values=re.findall(rb'(?m)^        OCI_REVISION: ([a-f0-9]{40})$',(PRIOR_FACTORY_PREPARE/'build.private.yml').read_bytes());need(len(values)==2,'two-sealed-original-factory-build-arguments');return{service:values[i].decode()for i,service in enumerate(ORDER[:2])}
def startup_guard(service,value,dest):
 if service=='qc':
  result={}
  for company in sorted(QC_COMPANIES):
   with contextlib.closing(F.OPS.L.connect(dest/'sqlite'/company/'qc.db',True))as db:
    tables={r[0]for r in db.execute("SELECT name FROM sqlite_schema WHERE type='table'")};need({'records','users','defect_library','partners','record_tombstones'}<=tables,'qc-existing-complete-schema');columns={t:{r[1]for r in db.execute('PRAGMA table_info('+F.OPS.L.quote(t)+')')}for t in('records','users')};need({'name','dept','perms'}<=columns['users']and{'processType','status','reviewBy','reviewAt','rejectReason','rejectBy','rejectAt','aqlLevel'}<=columns['records'],'qc-existing-complete-columns');counts={t:db.execute('SELECT COUNT(*) FROM '+F.OPS.L.quote(t)).fetchone()[0]for t in('users','records','defect_library')};need(counts['users']>0 and counts['defect_library']>0 and(company!='dg-xingxin'or counts['records']>0),'qc-no-seeding-existing-data');result[company]=counts
  return{'allExistingStartupGuardsPassed':True,'companyCounts':result}
 return{'allExistingStartupGuardsPassed':True,'noChangedMigrationsPermitted':True}
def flags():return F.OPS.L.non_database_inventory(ROOT/'deploy/maintenance',[])
def environment_stable(b):
 p=ROOT/'.env.cloud.production';need(p.is_file()and not p.is_symlink()and p.read_bytes()==(b['archive']/'environment.private').read_bytes()and meta(p)==b['environmentFileMetadata'],'full-environment-bytes-mode-owner-unchanged')
def backup(result):
 need(run(['git','rev-parse','HEAD^{tree}']).decode().strip()==BASE_TREE,'exact-base-tree');configuration=source();dirty=dirty_snapshot(True);env=ROOT/'.env.cloud.production';need(env.is_file()and not env.is_symlink()and env.stat().st_size<=4*1024**2,'bounded-private-env');private('environment.private',env.read_bytes());envmeta=meta(env);maintenance=flags();before,raw=runtime();private('target-inspect.private.json',raw);render=json.loads(run(['docker','compose','-p','rr-portal','-f',str(ROOT/'docker-compose.cloud.yml'),'--env-file',str(env),'config','--format','json']));private('compose-render.private.json',render);captured={};proof={};startup={}
 need(shutil.disk_usage(OUT).free>2*sum(p.stat().st_size for source,_ in STORAGE.values()for p in(ROOT/source).rglob('*')if p.is_file())+1024**3,'enough-private-backup-space')
 for s in ORDER:
  actual=F.envmap(raw[s]['Config']['Env']);process=process_environment(raw[s]['Id']);image=json.loads(run(['docker','image','inspect',raw[s]['Image']]))[0];need(image['Id']==raw[s]['Image'],'original-immutable-image')
  if not s.startswith('factory-review'):private(s+'-image.private.json',image)
  private(s+'-literal-configured-environment.private.json',actual);private(s+'-literal-process-environment.private.json',process);private(s+'-declared-compose-environment.private.json',render['services'][s].get('environment',{}));captured[s],dest=capture(s,'baseline');startup[s]=startup_guard(s,captured[s],dest);proof[s]=application_proof(s,before['targets'][s],BASE)
 after,_=runtime();need(after==before and source()==configuration and dirty_snapshot()==dirty and flags()==maintenance,'unchanged-runtime-source-dirty-flags');b={'head':BASE,'tree':BASE_TREE,'runtime':before,'configuration':configuration,'preexistingFourDirty':dirty,'maintenanceInventory':maintenance,'environmentFileMetadata':envmeta,'environmentSHA256':sha((OUT/'environment.private').read_bytes()),'storage':captured,'sourceProof':proof,'startup':startup};environment_stable(dict(b,archive=OUT))
 for s in ORDER:
  tree=ROOT/STORAGE[s][0];names=list(captured[s]['sqlite']);need(F.OPS.L.non_database_inventory(tree,names)==captured[s]['files']and ownership(tree,names)==captured[s]['fileOwnership']and db_metadata(tree,names)==captured[s]['metadata'],'all-files-mode-owners-stable-through-backup')
 b['factoryBuildArgumentRevisions']=factory_build_revisions();private('baseline.private.json',b);result.update(success=True,backupComplete=True,targetContainerCount=3,otherContainerCount=43,portableSQLiteCount=30,qcCompanyDatabaseCount=13,qcHistoricalDatabaseCount=13,allThreeRuntimeSourcesMatchBase=True,allPersistentDataFilesAndOwnershipArchived=True,allOriginalTypedRowsAndSchemaCaptured=True,databaseSnapshotsIndividuallyConsistentNotCrossDatabaseAtomic=True,all46ContainersUnchanged=True,environmentFileUnchanged=True,fourExistingDirtyFilesPreserved=True)
def main():
 need(BACKUP_PIN is True and sys.argv[1:]==['backup']and os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_ATTEMPT')=='1','false-draft-or-wrong-invocation');os.umask(0o077);OUT.mkdir(mode=0o700);initialize(OUT);signal.signal(signal.SIGTERM,lambda *_:need(False,'terminated'));result={'mode':'backup','base':BASE,'target':BASE,'tree':BASE_TREE,'success':False,'backupComplete':False,'businessWritesPerformed':False,'credentialsOrConfigurationChanged':False,'containerSignalsPerformed':False,'healthOrBusinessHTTPRequestsPerformed':False,'modelCallsPerformed':False,'otherServicesRequested':False,'secretOrRowsPrinted':False}
 try:backup(result)
 except BaseException as error:result.update(success=False,failedStage=safe_stage(STAGE),factoryLibraryFailedStage=safe_stage(getattr(F,'STAGE',None)),dataOpsFailedStage=safe_stage(getattr(F.OPS,'STAGE',None)),sqliteLibraryFailedStage=safe_stage(getattr(F.OPS.L,'FAILED',None)),safeExceptionType=type(error).__name__);private('failure.private.txt',traceback.format_exc().encode())
 finally:private('first-result.json',result);F.OPS.L.seal(OUT);print(enc(dict(result,manifestSHA256=F.OPS.L.file_hash(OUT/'manifest.json'),resultSHA256=F.OPS.L.file_hash(OUT/'first-result.json'))).decode(),flush=True)
 return 0 if result['success']else 1
if __name__=='__main__':
 try:sys.exit(main())
 except SystemExit:raise
 except BaseException:print('{"mode":"backup","success":false,"safeFailure":"BATCH_983_984_987_BACKUP_PREFLIGHT_REJECTED"}',flush=True);sys.exit(1)
