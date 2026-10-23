"""PR993 qc-only backup. Draft: execution gate is false.

Only filesystem copies, SQLite read transactions and read-only container execs.
No HTTP, model calls, signals, maintenance changes or mail access. No PostgreSQL access.
SQLite copies are individually consistent, never cross-database atomic.
"""
import contextlib,datetime,hashlib,importlib.util,io,json,os,pathlib,re,shutil,signal,stat,sys,tarfile,traceback

ROOT=pathlib.Path('/opt/rr-portal')
BASE='29254a0e90d3fe2a75f212492902aa1a00a4cba5'
BASE_TREE='ef92d7ed70394780f0389578c8cc1b2b67a167a5'
BRANCH='refs/heads/ops/pr-993-20261023'
BACKUP_PIN=True
OUT=ROOT/'deploy/backups/pr-993-20261023-backup'
QC='apps/生产部/品质管理系统'
APPS=(QC,)
ORDER=('qc',)
SERVICES=set(ORDER)
STORAGE={'qc':(QC+'/data','/app/data')}
QC_COMPANIES={'dg-xingxin','dg-huadeng-a','dg-huadeng-b','dg-huajia','hy-huakang-a','hy-huakang-b','hy-huakang-c','hy-huakang-d','hy-huadeng','hy-huaxing','sy-huadeng','sy-xingxin','xs-huadeng'}
QC_HISTORICAL_SQLITE={company+'/qc.db.bak.20260910-152122'for company in QC_COMPANIES}
QC_DATABASES={company+'/qc.db'for company in QC_COMPANIES}|QC_HISTORICAL_SQLITE
EXPECTED_ROOTS={s:[value] for s,value in STORAGE.items()}
FIXED=('docker-compose.cloud.yml','nginx/nginx.cloud.conf','deploy/update-server.sh','deploy/service-maintenance.sh','.github/workflows/deploy.yml','.env.example',QC+'/Dockerfile',QC+'/.dockerignore',QC+'/package.json',QC+'/server/auth.js',QC+'/server/ai-config.json',QC+'/server/seed.json')
DEPS={'factory-review-backup-library.py':'79d76bb47312dd08c121ebe2797f54d958666f8b72d00721f67712b152fc4666','release-data-ops-library.py':'ff9138a1d5bfed1b10077112da6ebcda2d65240f583e2d0e12ce1325cfbaafd5','release-data-library.py':'d63168fd3057f4f2aba2d93f9fab31d2d65c6dd0f3234877d71fcff1e04e62b9'}
PRIOR_QC_TARGET='f50e23735af6e198721830e26e35e26162f09af0'
PRIOR_QC_TREE='6f8cfbdf0e607ccdca59b0cc0c21c5d430ece5f2'
PRIOR_QC_APPLICATION_TREE='2fcff02d052d70baee0acd46fbfe6535b6a93d97'
PRIOR_QC_IMAGE='sha256:3b01c27acbdc50986e16f5c8900d75a87d165eaed79cd379c184e322f2700dc8'
PRIOR_QC_PREPARE=ROOT/'deploy/backups/qms-api-auth-20261021-prepare'
PRIOR_QC_PREPARE_MANIFEST='95eb32ee924ea9df0e8a55800b9f73416b60d53ab0b0918460ecca499a2cdcbc'
PRIOR_QC_PREPARE_RESULT='3bacf5758cd3421a024ba88df3825af506ba6d21855aafd4736521acc11d371a'
PRIOR_QC_VERIFY=ROOT/'deploy/backups/qms-api-auth-20261021-verify'
PRIOR_QC_VERIFY_MANIFEST='460704965517687e0587444822ab65619c6bfcc9f2703ac2aed43e83cd040133'
PRIOR_QC_VERIFY_RESULT='3a668630b7934b3d4b24f076c6b5df265d5893cbb610a23107942829e2b155a6'
F=None;STAGE='entrypoint';RUNTIME_SERIAL=0

def need(v,label):
 global STAGE
 if not v:STAGE=label;raise RuntimeError('PR993_BACKUP_REJECTED')
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
 F=load('factory-review-backup-library.py');need(F.BACKUP_PIN is False and F.DEPLOY_PIN is False and F.VERIFY_PIN is False,'inert-factory-library');F.BASE=BASE;F.ROOT=ROOT;F.APP=ROOT/QC;F.OUT=OUT;F.OPS=load('release-data-ops-library.py');F.OPS.L=load('release-data-library.py');F.OPS.L.databases=F.OPS.database_names;F.OPS.run=F.run;F.OPS.ROOT=ROOT;F.OPS.SCHEMAS=()

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
 need(set(targets)==set(ORDER)and len(others)==45,'exact-one-target-45-others')
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
  need(F.OPS.L.safe_path(n)and n not in FIXED and not any(n==a or n.startswith(a+'/')for a in APPS),'dirty-outside-qc-app-and-fixed-configuration');entry=run(['git','ls-tree','-z',BASE,'--',n]);need(re.fullmatch(b'100(?:644|755) blob [a-f0-9]{40}\t'+re.escape(n.encode())+b'\0',entry)is not None,'dirty-original-regular-file');p=ROOT/n
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
 need(service=='qc'and revision==BASE,'only-qc-base-runtime-proof');prior=prior_qc_proof();need(row['image']==prior['image'],'actual-qc-image-equals-sealed-f50-candidate');prefix,names=code_paths(service,revision);expected={n:sha(run(['git','show',revision+':'+prefix+'/'+n]))for n in names};blob=run(['docker','exec','--user','0',row['id'],'tar','-C','/app','-cf','-',*names]);found={};total=0
 with tarfile.open(fileobj=io.BytesIO(blob),mode='r:')as archive:
  for member in archive:
   n=member.name;need(F.OPS.L.safe_path(n)and n in expected and n not in found and member.isfile(),'safe-exact-runtime-source-tar');total+=member.size;need(member.size<=16*1024**2 and total<=32*1024**2,'bounded-source-tar');data=archive.extractfile(member).read();need(len(data)==member.size,'complete-runtime-source-file');found[n]={'bytes':member.size,'sha256':sha(data)}
 need({n:v['sha256']for n,v in found.items()}==expected and found==prior['files'],'all-qc-runtime-copy-files-equal-base-and-sealed-f50-proof');return{'runningImageSourceRevision':PRIOR_QC_TARGET,'runningSourceBase':revision,'applicationTree':PRIOR_QC_APPLICATION_TREE,'reviewedSourceMatch':True,'files':found}

def prior_archive(path,manifest_hash,result_hash,mode):
 L=F.OPS.L;need(path.is_dir()and not path.is_symlink()and stat.S_IMODE(path.stat().st_mode)==0o700,'private-prior-qc-phase');need(L.file_hash(path/'manifest.json')==manifest_hash and L.file_hash(path/'first-result.json')==result_hash,'exact-prior-qc-archive-seals');manifest=read(path/'manifest.json');entries=list(path.rglob('*'));need(type(manifest)is dict and len(entries)<=100000 and all(not x.is_symlink()and(x.is_file()or x.is_dir())and x.stat().st_mode&0o077==0 for x in entries),'private-prior-qc-entries');need(set(manifest)=={str(x.relative_to(path))for x in entries if x.is_file()and x!=path/'manifest.json'}and all(L.safe_path(n)and re.fullmatch('[a-f0-9]{64}',h or'')and L.file_hash(path/n)==h for n,h in manifest.items()),'all-prior-qc-private-file-seals');r=read(path/'first-result.json');need(r.get('success')is True and r.get('mode')==mode and r.get('target')==PRIOR_QC_TARGET and r.get('tree')==PRIOR_QC_TREE,'successful-prior-qc-exact-source-phase');return r

def prior_qc_proof():
 prior_archive(PRIOR_QC_PREPARE,PRIOR_QC_PREPARE_MANIFEST,PRIOR_QC_PREPARE_RESULT,'prepare');verified=prior_archive(PRIOR_QC_VERIFY,PRIOR_QC_VERIFY_MANIFEST,PRIOR_QC_VERIFY_RESULT,'verify');p=read(PRIOR_QC_PREPARE/'prepared.private.json');need(p['target']==PRIOR_QC_TARGET and p['tree']==PRIOR_QC_TREE and set(p['images'])==set(p['proofs'])=={'factory-review-test','factory-review','qc'}and p['images']['qc']==PRIOR_QC_IMAGE and verified.get('images',{}).get('qc')==PRIOR_QC_IMAGE,'sealed-prepared-and-deployed-qc-image-source-binding');need(verified.get('allThreePreparedSourcesAndRuntimeContractsVerified')is True,'prior-qc-full-runtime-source-verification');need(run(['git','rev-parse',BASE+':'+QC]).decode().strip()==run(['git','rev-parse',PRIOR_QC_TARGET+':'+QC]).decode().strip()==PRIOR_QC_APPLICATION_TREE,'current-base-qc-subtree-identical-to-actual-running-f50-source');return{'image':PRIOR_QC_IMAGE,'files':p['proofs']['qc']}

def historical_files(tree,archive=None):
 result={}
 with contextlib.ExitStack()as stack:
  tar=stack.enter_context(tarfile.open(archive,'x'))if archive else None
  for name in sorted(QC_HISTORICAL_SQLITE):
   p=tree/name;before=meta(p);size=p.stat().st_size;digest=F.OPS.L.file_hash(p);need(size<=F.OPS.L.MAX_FILE,'bounded-historical-qc-database');result[name]=dict(before,bytes=size,sha256=digest)
   if tar:tar.add(p,arcname=name,recursive=False)
   need(meta(p)==before and p.stat().st_size==size and F.OPS.L.file_hash(p)==digest,'historical-qc-file-bytes-mode-owner-stable')
 if archive:archive.chmod(0o600);replay_historical(archive,result)
 return result

def replay_historical(archive,expected):
 need(set(expected)==QC_HISTORICAL_SQLITE,'all13-historical-raw-qc-database-files');found={};total=0
 with tarfile.open(archive,'r')as tar:
  for m in tar:
   need(m.name in expected and m.name not in found and m.isfile(),'safe-exact-historical-database-archive');total+=m.size;need(m.size<=F.OPS.L.MAX_FILE and total<=F.OPS.L.MAX_BYTES,'bounded-historical-database-archive');hasher=hashlib.sha256();size=0
   # Open each archive stream once and hash in bounded chunks.
   with tar.extractfile(m)as stream:
    for chunk in iter(lambda:stream.read(1024**2),b''):hasher.update(chunk);size+=len(chunk)
   need(size==m.size,'complete-historical-database-archive-file');found[m.name]={'mode':m.mode,'uid':m.uid,'gid':m.gid,'bytes':size,'sha256':hasher.hexdigest()}
 need(found==expected,'exact-historical-database-bytes-mode-owners-replay')

def capture(service,label):
 need(service=='qc'and re.fullmatch('[A-Za-z0-9_.-]{1,100}',label or'')is not None,'fixed-qc-capture-service-label');tree=ROOT/STORAGE[service][0];dest=OUT/(service+'-'+label);names=F.OPS.database_names(tree);need(set(names)==QC_DATABASES,'exact-13-active-13-historical-qc-databases');before=ownership(tree,names);historical=historical_files(tree);value=F.OPS.sqlite_capture(service,tree,dest);need(set(value['sqlite'])==set(names)==QC_DATABASES,'all26-discovered-qc-sqlite-copied');value.update(metadata=db_metadata(tree,names),fileOwnership=ownership(tree,names),databaseFamilyMetadata=db_family_metadata(tree,names),historicalDatabaseFiles=historical_files(tree,dest/'historical-sqlite.tar'),observedUTC=datetime.datetime.now(datetime.timezone.utc).isoformat());need(value['historicalDatabaseFiles']==historical and value['fileOwnership']==before and F.OPS.L.non_database_inventory(tree,names)==value['files'],'stable-captured-files-and-mode-owners');private(service+'-'+label+'.private.json',value);return value,dest


def startup_guard(service,value,dest):
 if service=='qc':
  result={}
  for company in sorted(QC_COMPANIES):
   with contextlib.closing(F.OPS.L.connect(dest/'sqlite'/company/'qc.db',True))as db:
    tables={r[0]for r in db.execute("SELECT name FROM sqlite_schema WHERE type='table'")};need({'records','users','defect_library','partners','record_tombstones'}<=tables,'qc-existing-complete-schema');columns={t:{r[1]for r in db.execute('PRAGMA table_info('+F.OPS.L.quote(t)+')')}for t in('records','users')};need({'name','dept','perms'}<=columns['users']and{'processType','status','reviewBy','reviewAt','rejectReason','rejectBy','rejectAt','aqlLevel'}<=columns['records'],'qc-existing-complete-columns');counts={t:db.execute('SELECT COUNT(*) FROM '+F.OPS.L.quote(t)).fetchone()[0]for t in('users','records','defect_library')};need(counts['users']>0 and counts['defect_library']>0 and(company!='dg-xingxin'or counts['records']>0),'qc-no-seeding-existing-data');result[company]=counts
  return{'allExistingStartupGuardsPassed':True,'companyCounts':result}
 need(False,'only-qc-startup-guard')

def replay_snapshot(service,value,path):
 need(service=='qc'and set(value['sqlite'])==QC_DATABASES,'only-all26-qc-snapshot-replay');need(F.OPS.L.snapshots(path/'sqlite',immutable=True)==value['sqlite'],'all-closed-portable-typed-sqlite-audits-reproduce');replay_historical(path/'historical-sqlite.tar',value['historicalDatabaseFiles']);F.OPS.L.verify_archive(path/'files.tar',value['files']);need(type(value['fileOwnership'])is dict and type(value['metadata'])is dict,'sealed-mode-owner-inventories');startup_guard(service,value,path)

def source_proof(service,row,revision=BASE):return application_proof(service,row,revision)

def flags():return F.OPS.L.non_database_inventory(ROOT/'deploy/maintenance',[])
def environment_stable(b):
 p=ROOT/'.env.cloud.production';need(p.is_file()and not p.is_symlink()and p.read_bytes()==(b['archive']/'environment.private').read_bytes()and meta(p)==b['environmentFileMetadata'],'full-environment-bytes-mode-owner-unchanged')
def backup(result):
 need(run(['git','rev-parse','HEAD^{tree}']).decode().strip()==BASE_TREE,'exact-base-tree');configuration=source();dirty=dirty_snapshot(True);env=ROOT/'.env.cloud.production';need(env.is_file()and not env.is_symlink()and env.stat().st_size<=4*1024**2,'bounded-private-env');private('environment.private',env.read_bytes());envmeta=meta(env);maintenance=flags();need(not any(r['path']in{'services/'+s for s in ORDER}for r in maintenance),'all-target-maintenance-initially-clear');before,raw=runtime();private('target-inspect.private.json',raw);render=json.loads(run(['docker','compose','-p','rr-portal','-f',str(ROOT/'docker-compose.cloud.yml'),'--env-file',str(env),'config','--format','json']));private('compose-render.private.json',render);captured={};proof={};startup={}
 need(shutil.disk_usage(OUT).free>2*sum(p.stat().st_size for roots in EXPECTED_ROOTS.values()for source,_ in roots for p in(ROOT/source).rglob('*')if p.is_file())+1024**3,'enough-private-backup-space')
 for s in ORDER:
  actual=F.envmap(raw[s]['Config']['Env']);process=process_environment(raw[s]['Id']);image=json.loads(run(['docker','image','inspect',raw[s]['Image']]))[0];need(image['Id']==raw[s]['Image'],'original-immutable-image')
  need((image['Config'].get('Labels')or{}).get('org.opencontainers.image.revision')==PRIOR_QC_TARGET and image['Id']==PRIOR_QC_IMAGE,'actual-qc-image-metadata-equals-sealed-source-revision');private(s+'-image.private.json',image)
  private(s+'-literal-configured-environment.private.json',actual);private(s+'-literal-process-environment.private.json',process);private(s+'-declared-compose-environment.private.json',render['services'][s].get('environment',{}));captured[s],dest=capture(s,'baseline');startup[s]=startup_guard(s,captured[s],dest);proof[s]=application_proof(s,before['targets'][s],BASE)
 after,_=runtime();need(after==before and source()==configuration and dirty_snapshot()==dirty and flags()==maintenance,'unchanged-all46-runtime-source-dirty-flags');b={'head':BASE,'tree':BASE_TREE,'runtime':before,'configuration':configuration,'preexistingFourDirty':dirty,'maintenanceInventory':maintenance,'environmentFileMetadata':envmeta,'environmentSHA256':sha((OUT/'environment.private').read_bytes()),'storage':captured,'sourceProof':proof,'startup':startup};environment_stable(dict(b,archive=OUT))
 for s in ORDER:
  tree=ROOT/STORAGE[s][0];names=list(captured[s]['sqlite']);need(F.OPS.L.non_database_inventory(tree,names)==captured[s]['files']and ownership(tree,names)==captured[s]['fileOwnership']and db_metadata(tree,names)==captured[s]['metadata']and historical_files(tree)==captured[s]['historicalDatabaseFiles'],'all-files-mode-owners-stable-through-backup')
 private('baseline.private.json',b);result.update(success=True,backupComplete=True,targetContainerCount=1,otherContainerCount=45,portableSQLiteCount=26,qcCompanyDatabaseCount=13,qcHistoricalDatabaseCount=13,qcRuntimeSourceMatchesBaseAndSealedF50=True,allPersistentDataFilesAndOwnershipArchived=True,allOriginalTypedRowsAndSchemaCaptured=True,databaseSnapshotsIndividuallyConsistentNotCrossDatabaseAtomic=True,all46ContainersUnchanged=True,environmentFileUnchanged=True,fourExistingDirtyFilesPreserved=True)

def main():
 need(BACKUP_PIN is True and sys.argv[1:]==['backup']and os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_ATTEMPT')=='1','false-draft-or-wrong-invocation');os.umask(0o077);OUT.mkdir(mode=0o700);initialize(OUT);signal.signal(signal.SIGTERM,lambda *_:need(False,'terminated'));result={'mode':'backup','base':BASE,'target':BASE,'tree':BASE_TREE,'success':False,'backupComplete':False,'businessWritesPerformed':False,'credentialsOrConfigurationChanged':False,'containerSignalsPerformed':False,'healthOrBusinessHTTPRequestsPerformed':False,'modelCallsPerformed':False,'otherServicesRequested':False,'secretOrRowsPrinted':False}
 try:backup(result)
 except BaseException as error:result.update(success=False,failedStage=safe_stage(STAGE),factoryLibraryFailedStage=safe_stage(getattr(F,'STAGE',None)),dataOpsFailedStage=safe_stage(getattr(F.OPS,'STAGE',None)),sqliteLibraryFailedStage=safe_stage(getattr(F.OPS.L,'FAILED',None)),safeExceptionType=type(error).__name__);private('failure.private.txt',traceback.format_exc().encode())
 finally:private('first-result.json',result);F.OPS.L.seal(OUT);print(enc(dict(result,manifestSHA256=F.OPS.L.file_hash(OUT/'manifest.json'),resultSHA256=F.OPS.L.file_hash(OUT/'first-result.json'))).decode(),flush=True)
 return 0 if result['success']else 1
if __name__=='__main__':
 try:sys.exit(main())
 except SystemExit:raise
 except BaseException:print('{"mode":"backup","success":false,"safeFailure":"PR993_BACKUP_PREFLIGHT_REJECTED"}',flush=True);sys.exit(1)
