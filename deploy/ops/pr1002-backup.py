"""PR1002 factory-only backup. Draft: execution gate is false.

Only filesystem copies, SQLite read transactions and read-only container execs.
No HTTP, model calls, signals, maintenance changes or mail access. No PostgreSQL access.
SQLite copies are individually consistent, never cross-database atomic.
"""
import contextlib,datetime,hashlib,importlib.util,io,json,os,pathlib,re,shutil,signal,stat,sys,tarfile,traceback

ROOT=pathlib.Path('/opt/rr-portal')
BASE='f223ec9957a07e8e7b8dff7b5adcafcbe83ac7c8'
BASE_TREE='23a3654c523cb5aa727fd05b1fe6875e3375e2f5'
BRANCH='refs/heads/ops/pr-1002-20261026'
BACKUP_PIN=True
OUT=ROOT/'deploy/backups/pr-1002-20261026-backup'
FACTORY='apps/PMC跟仓管/加工厂月度评审管理制度'
APPS=(FACTORY,)
ORDER=('factory-review',)
SERVICES=set(ORDER)
STORAGE={'factory-review':(FACTORY+'/pb_data','/pb/pb_data')}
EXPECTED_ROOTS={s:[value] for s,value in STORAGE.items()}
FIXED=('docker-compose.cloud.yml','nginx/nginx.cloud.conf','deploy/update-server.sh','deploy/service-maintenance.sh','.github/workflows/deploy.yml','.env.example',FACTORY+'/Dockerfile',FACTORY+'/.dockerignore',FACTORY+'/package.json',FACTORY+'/package-lock.json')
DEPS={'factory-review-backup-library.py':'79d76bb47312dd08c121ebe2797f54d958666f8b72d00721f67712b152fc4666','release-data-ops-library.py':'ff9138a1d5bfed1b10077112da6ebcda2d65240f583e2d0e12ce1325cfbaafd5','release-data-library.py':'d63168fd3057f4f2aba2d93f9fab31d2d65c6dd0f3234877d71fcff1e04e62b9'}
PRIOR_FACTORY_TARGET='29254a0e90d3fe2a75f212492902aa1a00a4cba5'
PRIOR_FACTORY_TREE='ef92d7ed70394780f0389578c8cc1b2b67a167a5'
PRIOR_FACTORY_PREPARE=ROOT/'deploy/backups/pr-994-20261022-prepare'
PRIOR_FACTORY_MANIFEST='3f274f208e08454b832f82fdae1d6316141adeb62208e4c52a49375f69733078'
PRIOR_FACTORY_RESULT='c23c9c8ba495e60da93c9737a3e84375c770e3364415b4f10740079ddf980547'
PRIOR_FACTORY_VERIFY=ROOT/'deploy/backups/pr-994-20261022-verify'
PRIOR_FACTORY_VERIFY_MANIFEST='30164eb621cc1b5a79a385ceabc75f903f41b8617ed6084610e83c2b701c5b53'
PRIOR_FACTORY_VERIFY_RESULT='175f1e061e2d5b90e491c09b48d835fbca36649a09f9568a23e331c026ce39d3'
F=None;STAGE='entrypoint';RUNTIME_SERIAL=0;CONFIGURATION_ARCHIVE=OUT

def need(v,label):
 global STAGE
 if not v:STAGE=label;raise RuntimeError('PR1002_BACKUP_REJECTED')
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
 OUT=out
 for n,h in DEPS.items():
  p=pathlib.Path(__file__).with_name(n);need(p.is_file()and not p.is_symlink()and sha(p.read_bytes())==h,'all-three-transitive-dependency-pins-before-import')
 F=load('factory-review-backup-library.py');need(F.BACKUP_PIN is False and F.DEPLOY_PIN is False and F.VERIFY_PIN is False,'inert-factory-library');F.BASE=BASE;F.ROOT=ROOT;F.APP=ROOT/FACTORY;F.OUT=OUT;F.OPS=load('release-data-ops-library.py');F.OPS.L=load('release-data-library.py');F.OPS.L.databases=F.OPS.database_names;F.OPS.run=F.run;F.OPS.ROOT=ROOT;F.OPS.SCHEMAS=()

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
  need(s not in targets,'unique-target-service');need(not require_healthy or(row['running']is True and row['oom']is False and row['health']=='healthy'),'healthy-target-runtime');need(len(r['Mounts'])==len(EXPECTED_ROOTS[s]),'exact-service-mount-count')
  for source,destination in EXPECTED_ROOTS[s]:
   mounts=[m for m in r['Mounts']if m['Destination']==destination];need(len(mounts)==1 and mounts[0]['Type']=='bind'and mounts[0]['Source']==str(ROOT/source)and mounts[0]['RW']is True,'exact-service-persistent-mount')
  need(r['Config'].get('Hostname')==cid[:12],'automatic-config-hostname')
  if row['running']:row['processEnvironmentWithoutAutomaticHostnameSHA256']=sha(enc(process_environment(cid)))
  targets[s]=row;raw[s]=r
 need(set(targets)==set(ORDER)and len(others)==45,'exact-one-production-target-45-others')
 canonical={(s,n):(ROOT/n).resolve(strict=True)for s,roots in EXPECTED_ROOTS.items()for n,_ in roots};need(all(str(p)==str(ROOT/n)for(s,n),p in canonical.items()),'canonical-persistent-roots-without-symlink-aliases');need(all(not(a==b or str(a).startswith(str(b)+'/')or str(b).startswith(str(a)+'/'))for i,a in enumerate(canonical.values())for b in list(canonical.values())[i+1:]),'disjoint-canonical-persistent-roots')
 for r in records:
  for mount in r.get('Mounts',[]):
   src=mount.get('Source','')
   if not src:continue
   actual=str(pathlib.Path(src).resolve(strict=True))
   for(service,_),path in canonical.items():
    expected=str(path)
    if actual==expected or actual.startswith(expected+'/')or expected.startswith(actual.rstrip('/')+'/'):
     need(r['Id']==raw[service]['Id']and src==actual==expected,'one-writer-exclusive-canonical-persistent-root')
 return{'targets':targets,'others':others},raw

def dirty_snapshot(save=False):
 run(['git','diff','--cached','--quiet','--no-ext-diff','--no-textconv','--ignore-submodules=none']);names=run(['git','diff','--name-only','-z','--no-ext-diff','--no-textconv','--ignore-submodules=none']).decode().strip('\0').split('\0');need(len(names)==len(set(names))==4,'exact-four-preexisting-dirty-files');rows={}
 for i,n in enumerate(sorted(names)):
  need(F.OPS.L.safe_path(n)and n not in FIXED and not any(n==a or n.startswith(a+'/')for a in APPS),'dirty-outside-factory-app-and-fixed-configuration');entry=run(['git','ls-tree','-z',BASE,'--',n]);need(re.fullmatch(b'100(?:644|755) blob [a-f0-9]{40}\t'+re.escape(n.encode())+b'\0',entry)is not None,'dirty-original-regular-file');p=ROOT/n
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

def application_proof(service,row,revision,image=None):
 need(service in ORDER,'only-production-factory-source-proof');old=F.BASE;F.BASE=revision
 try:
  result=F.runtime_files(service,row);prior=prior_factory_prepare();need(row['image']==prior['images'][service]and result['files']==prior['proofs'][service],'factory-runtime-equals-sealed-base26-candidate');return result
 finally:F.BASE=old

def sealed_prior(path,manifest_sha,result_sha,mode):
 L=F.OPS.L;need(path.is_dir()and not path.is_symlink()and stat.S_IMODE(path.stat().st_mode)==0o700,'private-prior-factory-directory');need(L.file_hash(path/'manifest.json')==manifest_sha and L.file_hash(path/'first-result.json')==result_sha,'exact-prior-factory-archive-seals');manifest=read(path/'manifest.json');entries=list(path.rglob('*'));need(type(manifest)is dict and len(entries)<=100000 and all(not x.is_symlink()and(x.is_file()or x.is_dir())and x.stat().st_mode&0o077==0 for x in entries),'private-prior-factory-entries');need(set(manifest)=={str(x.relative_to(path))for x in entries if x.is_file()and x!=path/'manifest.json'}and all(L.safe_path(n)and re.fullmatch('[a-f0-9]{64}',h or'')and L.file_hash(path/n)==h for n,h in manifest.items()),'all-prior-factory-private-file-seals');r=read(path/'first-result.json');need(r.get('success')is True and r.get('mode')==mode and r.get('target')==PRIOR_FACTORY_TARGET and r.get('tree')==PRIOR_FACTORY_TREE,'successful-bound-prior994-phase');return r

def prior_factory_prepare():
 prepared_result=sealed_prior(PRIOR_FACTORY_PREPARE,PRIOR_FACTORY_MANIFEST,PRIOR_FACTORY_RESULT,'prepare');verified=sealed_prior(PRIOR_FACTORY_VERIFY,PRIOR_FACTORY_VERIFY_MANIFEST,PRIOR_FACTORY_VERIFY_RESULT,'verify');prepared=read(PRIOR_FACTORY_PREPARE/'prepared.private.json');runtime=read(PRIOR_FACTORY_VERIFY/'verified-runtime.private.json');need(prepared['target']==PRIOR_FACTORY_TARGET and prepared['tree']==PRIOR_FACTORY_TREE and set(prepared['images'])==set(prepared['proofs'])=={'factory-review-test','factory-review'}and prepared_result['images']==verified['images']==prepared['images'],'sealed-successful994-two-factory-prepared-verified-images');need(all(verified.get(k)is True for k in ('allTwoPreparedSourcesAndRuntimeContractsVerified','allTwoSealedClosedDataChecksReproduced','allOther44ContainersUnchanged','entireEnvironmentFileAndRuntimeEnvironmentsUnchanged','allMaintenanceFlagsRestored')),'actual-prior994-successful-source-runtime-data-flags');need(run(['git','rev-parse',BASE+':'+FACTORY])==run(['git','rev-parse',PRIOR_FACTORY_TARGET+':'+FACTORY]),'current-base-factory-subtree-exact-deployed994');need(all(runtime['targets'][s]['image']==prepared['images'][s]for s in ORDER),'actual-prior994-production-running-image');return{'images':{s:prepared['images'][s]for s in ORDER},'proofs':{s:prepared['proofs'][s]for s in ORDER}}

def capture(service,label):
 need(service in ORDER and re.fullmatch('[A-Za-z0-9_.-]{1,100}',label or'')is not None,'fixed-factory-capture-service-label');tree=ROOT/STORAGE[service][0];dest=OUT/(service+'-'+label);names=F.OPS.database_names(tree);before=ownership(tree,names);value=F.OPS.sqlite_capture(service,tree,dest);need(set(value['sqlite'])==set(names)=={'data.db','auxiliary.db'},'exact-two-factory-databases');value.update(metadata=db_metadata(tree,names),fileOwnership=ownership(tree,names),databaseFamilyMetadata=db_family_metadata(tree,names),observedUTC=datetime.datetime.now(datetime.timezone.utc).isoformat());need(value['fileOwnership']==before and F.OPS.L.non_database_inventory(tree,names)==value['files'],'stable-captured-files-and-mode-owners');private(service+'-'+label+'.private.json',value);return value,dest

def factory_build_revisions():
 prior_factory_prepare();raw=(PRIOR_FACTORY_PREPARE/'build.private.yml').read_bytes();services=re.findall(rb'(?m)^  (factory-review(?:-test)?):$',raw);values=re.findall(rb'(?m)^        OCI_REVISION: ([a-f0-9]{40})$',raw);need(len(values)==len(services)==2 and set(services)=={b'factory-review-test',b'factory-review'},'two-sealed-original-factory-build-arguments');mapping={s.decode():values[i].decode()for i,s in enumerate(services)};return{s:mapping[s]for s in ORDER}
def startup_guard(service,value,dest):
 need(service in ORDER and set(value['sqlite'])=={'data.db','auxiliary.db'},'only-two-existing-factory-databases');literal=read(CONFIGURATION_ARCHIVE/(service+'-literal-configured-environment.private.json'));email=literal.get('FACTORY_REVIEW_ADMIN_EMAIL','').strip();password=literal.get('FACTORY_REVIEW_ADMIN_PASSWORD','');need(type(email)is str and bool(email)and type(password)is str and len(password)>=12,'existing-health-credentials-configured');migrations=run(['git','ls-tree','-r','--name-only','-z',BASE,'--',FACTORY+'/pb_migrations']).decode().strip('\0').split('\0');expected={pathlib.PurePosixPath(n).name for n in migrations if n.endswith('.js')};need(expected and len(expected)==len(migrations),'all-factory-source-migration-basenames');observed=datetime.datetime.now(datetime.timezone.utc);cutoff=(observed+datetime.timedelta(hours=2)-datetime.timedelta(days=30)).isoformat()
 with contextlib.closing(F.OPS.L.connect(dest/'sqlite/data.db',True))as db:
  need(db.execute("SELECT count(*) FROM _collections WHERE name='users' AND type='auth'").fetchone()==(1,),'existing-users-auth-collection');need(db.execute('SELECT count(*) FROM users WHERE lower(email)=lower(?)',(email,)).fetchone()==(1,),'existing-bootstrap-user-no-health-seed');need(db.execute('SELECT count(*) FROM users WHERE email=? COLLATE BINARY',(email,)).fetchone()==(1,),'exact-bootstrap-email-match-independent-of-collection-index-collation');applied={row[0]for row in db.execute('SELECT file FROM _migrations')};need(expected<=applied,'all-existing-factory-migrations-already-applied');need(db.execute('SELECT count(*) FROM analysis_ai_usage WHERE date(started_at) IS NULL OR date(started_at)<=date(?)',(cutoff,)).fetchone()==(0,),'unchanged-quota-cleanup-cannot-delete-within-next-two-hours')
 return{'allExistingStartupGuardsPassed':True,'existingHealthUserPresentWithoutSeeding':True,'allSourceMigrationsAlreadyApplied':True,'quotaCleanupHasNoEligibleRowsForNextTwoHours':True,'noChangedHooksOrMigrationsPermitted':True}

def replay_snapshot(service,value,path):
 need(F.OPS.L.snapshots(path/'sqlite',immutable=True)==value['sqlite'],'all-closed-portable-typed-sqlite-audits-reproduce');F.OPS.L.verify_archive(path/'files.tar',value['files']);need(type(value['fileOwnership'])is dict and type(value['metadata'])is dict,'sealed-mode-owner-inventories');startup_guard(service,value,path)

def source_proof(service,row,revision=BASE):return application_proof(service,row,revision)

def flags():return F.OPS.L.non_database_inventory(ROOT/'deploy/maintenance',[])
def environment_stable(b):
 p=ROOT/'.env.cloud.production';need(p.is_file()and not p.is_symlink()and p.read_bytes()==(b['archive']/'environment.private').read_bytes()and meta(p)==b['environmentFileMetadata'],'full-environment-bytes-mode-owner-unchanged')
def backup(result):
 need(run(['git','rev-parse','HEAD^{tree}']).decode().strip()==BASE_TREE,'exact-base-tree');configuration=source();dirty=dirty_snapshot(True);env=ROOT/'.env.cloud.production';need(env.is_file()and not env.is_symlink()and env.stat().st_size<=4*1024**2,'bounded-private-env');private('environment.private',env.read_bytes());envmeta=meta(env);maintenance=flags();need(not any(r['path']in{'services/'+s for s in ORDER}for r in maintenance),'all-target-maintenance-initially-clear');before,raw=runtime();private('target-inspect.private.json',raw);render=json.loads(run(['docker','compose','-p','rr-portal','-f',str(ROOT/'docker-compose.cloud.yml'),'--env-file',str(env),'config','--format','json']));private('compose-render.private.json',render);captured={};proof={};startup={}
 need(shutil.disk_usage(OUT).free>2*sum(p.stat().st_size for roots in EXPECTED_ROOTS.values()for source,_ in roots for p in(ROOT/source).rglob('*')if p.is_file())+1024**3,'enough-private-backup-space')
 for s in ORDER:
  actual=F.envmap(raw[s]['Config']['Env']);process=process_environment(raw[s]['Id']);image=json.loads(run(['docker','image','inspect',raw[s]['Image']]))[0];need(image['Id']==raw[s]['Image'],'original-immutable-image')
  # F.runtime_files is the sole O_EXCL writer of service-image.private.json.
  private(s+'-literal-configured-environment.private.json',actual);private(s+'-literal-process-environment.private.json',process);private(s+'-declared-compose-environment.private.json',render['services'][s].get('environment',{}));captured[s],dest=capture(s,'baseline');startup[s]=startup_guard(s,captured[s],dest);proof[s]=application_proof(s,before['targets'][s],BASE)
 after,_=runtime();need(after==before and source()==configuration and dirty_snapshot()==dirty and flags()==maintenance,'unchanged-all46-runtime-source-dirty-flags');b={'head':BASE,'tree':BASE_TREE,'runtime':before,'configuration':configuration,'preexistingFourDirty':dirty,'maintenanceInventory':maintenance,'environmentFileMetadata':envmeta,'environmentSHA256':sha((OUT/'environment.private').read_bytes()),'storage':captured,'sourceProof':proof,'startup':startup};environment_stable(dict(b,archive=OUT))
 for s in ORDER:
  tree=ROOT/STORAGE[s][0];names=list(captured[s]['sqlite']);need(F.OPS.L.non_database_inventory(tree,names)==captured[s]['files']and ownership(tree,names)==captured[s]['fileOwnership']and db_metadata(tree,names)==captured[s]['metadata'],'all-files-mode-owners-stable-through-backup')
 b['factoryBuildArgumentRevisions']=factory_build_revisions();private('baseline.private.json',b);result.update(success=True,backupComplete=True,targetContainerCount=1,otherContainerCount=45,portableSQLiteCount=2,factoryRuntimeSourceMatchesBaseAndSealed994=True,allPersistentDataFilesAndOwnershipArchived=True,allOriginalTypedRowsAndSchemaCaptured=True,databaseSnapshotsIndividuallyConsistentNotCrossDatabaseAtomic=True,all46ContainersUnchanged=True,environmentFileUnchanged=True,fourExistingDirtyFilesPreserved=True)

def main():
 need(BACKUP_PIN is True and sys.argv[1:]==['backup']and os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_ATTEMPT')=='1','false-draft-or-wrong-invocation');os.umask(0o077);OUT.mkdir(mode=0o700);initialize(OUT);signal.signal(signal.SIGTERM,lambda *_:need(False,'terminated'));result={'mode':'backup','base':BASE,'target':BASE,'tree':BASE_TREE,'success':False,'backupComplete':False,'businessWritesPerformed':False,'credentialsOrConfigurationChanged':False,'containerSignalsPerformed':False,'healthOrBusinessHTTPRequestsPerformed':False,'modelCallsPerformed':False,'otherServicesRequested':False,'secretOrRowsPrinted':False}
 try:backup(result)
 except BaseException as error:result.update(success=False,failedStage=safe_stage(STAGE),factoryLibraryFailedStage=safe_stage(getattr(F,'STAGE',None)),dataOpsFailedStage=safe_stage(getattr(F.OPS,'STAGE',None)),sqliteLibraryFailedStage=safe_stage(getattr(F.OPS.L,'FAILED',None)),safeExceptionType=type(error).__name__);private('failure.private.txt',traceback.format_exc().encode())
 finally:private('first-result.json',result);F.OPS.L.seal(OUT);print(enc(dict(result,manifestSHA256=F.OPS.L.file_hash(OUT/'manifest.json'),resultSHA256=F.OPS.L.file_hash(OUT/'first-result.json'))).decode(),flush=True)
 return 0 if result['success']else 1
if __name__=='__main__':
 try:sys.exit(main())
 except SystemExit:raise
 except BaseException:print('{"mode":"backup","success":false,"safeFailure":"PR1002_BACKUP_PREFLIGHT_REJECTED"}',flush=True);sys.exit(1)
