"""PR997 internal-quote-only backup. Draft: execution gate is false.

Only filesystem copies, SQLite read transactions and read-only container execs.
No HTTP, model calls, signals, maintenance changes or mail access. Only internal_quote PostgreSQL read-only snapshots/dumps.
SQLite copies are individually consistent, never cross-database atomic.
"""
import contextlib,datetime,hashlib,importlib.util,io,json,os,pathlib,re,shutil,signal,stat,sys,tarfile,traceback,urllib.parse

ROOT=pathlib.Path('/opt/rr-portal')
BASE='2de4be7bdb0fa983dc86259701a3c4f3ddd14234'
BASE_TREE='d41d5f98f97ee0cd34b0a868fb7283f57841ee4e'
BRANCH='refs/heads/ops/pr-997-20261023'
BACKUP_PIN=True
OUT=ROOT/'deploy/backups/pr-997-20261023-backup'
QUOTE='apps/业务部/内部报价系统'
APPS=('apps/业务部/内部报价系统',)
ORDER=('internal-quote',)
SERVICES=set(ORDER)
STORAGE={'internal-quote': ('apps/业务部/内部报价系统/backend/data', '/app/backend/legacy-data')}
EXPECTED_ROOTS={s:[value] for s,value in STORAGE.items()}
EXPECTED_ROOTS['internal-quote'].append((QUOTE+'/backend/uploads','/app/backend/uploads'))
FIXED=('docker-compose.cloud.yml','nginx/nginx.cloud.conf','deploy/update-server.sh','deploy/service-maintenance.sh','.github/workflows/deploy.yml','.env.example',QUOTE+'/Dockerfile',QUOTE+'/.dockerignore',QUOTE+'/backend/server.js',QUOTE+'/backend/db/index.js',QUOTE+'/backend/db/postgres.js',QUOTE+'/backend/db/schema.postgres.sql',QUOTE+'/backend/db/accountSeed.js',QUOTE+'/backend/db/account-seed.csv')
PG_SHELL='exec psql -X -q -At -v ON_ERROR_STOP=1 -U "${POSTGRES_USER:-rrportal}" -d "${POSTGRES_DB:-rrportal}"'
DEPS={'factory-review-backup-library.py':'79d76bb47312dd08c121ebe2797f54d958666f8b72d00721f67712b152fc4666','release-data-ops-library.py':'ff9138a1d5bfed1b10077112da6ebcda2d65240f583e2d0e12ce1325cfbaafd5','release-data-library.py':'d63168fd3057f4f2aba2d93f9fab31d2d65c6dd0f3234877d71fcff1e04e62b9','internal-quote-readonly-library.py':'be4f901f3444154e5de06766a2d8a0801dba9b847a4ac25f34a84ccebe354e69'}
PRIOR_QUOTE_TARGET='6742f820c0a43388e274b867a2825a42548b5cea'
PRIOR_QUOTE_TREE='ce652db9eb263e09d24a3f44ef0c48a5c1f7b79e'
PRIOR_QUOTE_APPLICATION_TREE='48576317c5c8a32b645014c0a8a18c478e5d396f'
PRIOR_QUOTE_IMAGE='sha256:75473a666edc499f70820f900e00d2dd29414990fb571722d614ff0906367d3f'
PRIOR_QUOTE_PREPARE=ROOT/'deploy/backups/pr-995-20261023-prepare'
PRIOR_QUOTE_PREPARE_MANIFEST='0ab37034d6645f2a6c757b0ef84d2f7b4b954202cd2081afe454374de28de117'
PRIOR_QUOTE_PREPARE_RESULT='f1dab454625abb373db6cf11393a32b4694fdc52f9b9d9f16ae4a0947ab8c79f'
PRIOR_QUOTE_VERIFY=ROOT/'deploy/backups/pr-995-20261023-verify'
PRIOR_QUOTE_VERIFY_MANIFEST='af56aef40d58bb067cc72aa5b5d73be37b6836c7034d1c48ac74428f47f58739'
PRIOR_QUOTE_VERIFY_RESULT='0d54d75712f178ee5a833b32dea3f8aadb535011f602bf6bb3b0e2d4b82196cd'
F=None;READONLY=None;STAGE='entrypoint';RUNTIME_SERIAL=0

def need(v,label):
 global STAGE
 if not v:STAGE=label;raise RuntimeError('PR997_BACKUP_REJECTED')
def safe_stage(v):return v if type(v)is str and re.fullmatch('[A-Za-z0-9_.-]{1,160}',v)else'unavailable'
def enc(v):return json.dumps(v,ensure_ascii=True,sort_keys=True,separators=(',',':'),allow_nan=False).encode()
def sha(v):return hashlib.sha256(v).hexdigest()
def read(p):return json.loads(p.read_bytes())
def private(n,v):F.OPS.L.private_write(OUT/n,v if type(v)is bytes else enc(v))
def run(a,data=None,timeout=180):return F.run(a,data,timeout)
def load(name):
 p=pathlib.Path(__file__).with_name(name);need(p.is_file()and not p.is_symlink()and sha(p.read_bytes())==DEPS[name],'dependency-pin');s=importlib.util.spec_from_file_location(name.replace('.','_'),p);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
def initialize(out):
 global F,OUT,READONLY
 OUT=out
 for n,h in DEPS.items():
  p=pathlib.Path(__file__).with_name(n);need(p.is_file()and not p.is_symlink()and sha(p.read_bytes())==h,'all-four-transitive-dependency-pins-before-import')
 F=load('factory-review-backup-library.py');need(F.BACKUP_PIN is False and F.DEPLOY_PIN is False and F.VERIFY_PIN is False,'inert-factory-library');F.BASE=BASE;F.ROOT=ROOT;F.APP=ROOT/QUOTE;F.OUT=OUT;F.OPS=load('release-data-ops-library.py');F.OPS.L=load('release-data-library.py');F.OPS.L.databases=F.OPS.database_names;F.OPS.run=F.run;F.OPS.ROOT=ROOT;F.OPS.SCHEMAS=('internal_quote',);READONLY=load('internal-quote-readonly-library.py');READONLY.ROOT=ROOT;READONLY.APP_ROOT=ROOT/QUOTE;READONLY.APP_PREFIX=QUOTE+'/';READONLY.run=run

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
   mounts=[m for m in r['Mounts']if m['Destination']==destination];need(len(mounts)==1 and mounts[0]['Type']=='bind'and mounts[0]['Source']==str(ROOT/source)and mounts[0]['RW']is(not(s=='internal-quote'and destination=='/app/backend/legacy-data')),'exact-service-persistent-mount')
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
 db=database_contract(raw,records);return{'targets':targets,'others':others,'databaseContainer':db},raw
def database_contract(raw,records):
 matches=[r for r in records if(r['Config'].get('Labels')or{}).get('com.docker.compose.project')=='rr-portal'and(r['Config'].get('Labels')or{}).get('com.docker.compose.service')=='db'];need(len(matches)==1,'one-existing-postgres-container');db=matches[0];need(db['State']['Running']is True and db['State'].get('Health',{}).get('Status')=='healthy','healthy-existing-postgres');ae=F.envmap(raw['internal-quote']['Config']['Env']);de=F.envmap(db['Config']['Env']);url=urllib.parse.urlsplit(ae.get('DATABASE_URL',''))
 need(ae.get('DB_DRIVER')!='sqlite'and ae.get('DB_SCHEMA')=='internal_quote'and ae.get('LEGACY_SQLITE_FILE')=='/app/backend/legacy-data/data.db'and url.scheme in{'postgres','postgresql'}and url.hostname=='db'and(url.port or 5432)==5432 and urllib.parse.unquote(url.path)=='/'+(de.get('POSTGRES_DB')or'rrportal')and urllib.parse.unquote(url.username or'')==(de.get('POSTGRES_USER')or'rrportal')and urllib.parse.unquote(url.password or'')==de.get('POSTGRES_PASSWORD','')and not url.query and not url.fragment,'exact-internal-quote-postgres-connection');return db['Id']

def dirty_snapshot(save=False):
 run(['git','diff','--cached','--quiet','--no-ext-diff','--no-textconv','--ignore-submodules=none']);names=run(['git','diff','--name-only','-z','--no-ext-diff','--no-textconv','--ignore-submodules=none']).decode().strip('\0').split('\0');need(len(names)==len(set(names))==4,'exact-four-preexisting-dirty-files');rows={}
 for i,n in enumerate(sorted(names)):
  need(F.OPS.L.safe_path(n)and n not in FIXED and not any(n==a or n.startswith(a+'/')for a in APPS),'dirty-outside-quote-app-and-fixed-configuration');entry=run(['git','ls-tree','-z',BASE,'--',n]);need(re.fullmatch(b'100(?:644|755) blob [a-f0-9]{40}\t'+re.escape(n.encode())+b'\0',entry)is not None,'dirty-original-regular-file');p=ROOT/n
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
 need(service=='internal-quote','only-quote-nonfactory-source');prefix=QUOTE;names=run(['git','ls-tree','-r','--name-only','-z',revision,'--',prefix]).decode().rstrip('\0').split('\0');relative=[n[len(prefix)+1:]for n in names];relative=[n for n in relative if n=='package.json'or((n.startswith('backend/')or n.startswith('frontend/'))and not any(n==p or n.startswith(p+'/')for p in('backend/data','backend/uploads','backend/node_modules','frontend/node_modules')))];need(relative and len(relative)==len(set(relative))and all(F.OPS.L.safe_path(n)for n in relative),'safe-complete-quote-docker-copy-paths');return prefix,relative

def application_proof(service,row,revision,image=None):
 need(service=='internal-quote'and revision==BASE,'only-quote-base-runtime-proof');prior=prior_quote_proof();need(row['image']==prior['image'],'actual-quote-image-equals-sealed-prior-candidate')
 prefix,names=code_paths(service,revision);expected={n:sha(run(['git','show',revision+':'+prefix+'/'+n]))for n in names};blob=run(['docker','exec','--user','0',row['id'],'tar','-C','/app','-cf','-',*names]);found={};total=0
 with tarfile.open(fileobj=io.BytesIO(blob),mode='r:')as archive:
  for member in archive:
   n=member.name;need(F.OPS.L.safe_path(n)and n in expected and n not in found and member.isfile(),'safe-exact-runtime-source-tar');total+=member.size;need(member.size<=16*1024**2 and total<=32*1024**2,'bounded-source-tar');data=archive.extractfile(member).read();need(len(data)==member.size,'complete-runtime-source-file');found[n]={'bytes':member.size,'sha256':sha(data)}
 need({n:v['sha256']for n,v in found.items()}==expected and found==prior['files'],'all-runtime-copy-files-equal-base-and-sealed-prior-proof');return{'runningImageSourceRevision':PRIOR_QUOTE_TARGET,'runningSourceBase':revision,'applicationTree':run(['git','rev-parse',revision+':'+prefix]).decode().strip(),'reviewedSourceMatch':True,'files':found}
def prior_archive(path,manifest_hash,result_hash,mode):
 L=F.OPS.L;need(path.is_dir()and not path.is_symlink()and stat.S_IMODE(path.stat().st_mode)==0o700,'private-prior-quote-phase');need(L.file_hash(path/'manifest.json')==manifest_hash and L.file_hash(path/'first-result.json')==result_hash,'exact-prior-quote-archive-seals');manifest=read(path/'manifest.json');entries=list(path.rglob('*'));need(type(manifest)is dict and len(entries)<=100000 and all(not x.is_symlink()and(x.is_file()or x.is_dir())and x.stat().st_mode&0o077==0 for x in entries),'private-prior-quote-entries');need(set(manifest)=={str(x.relative_to(path))for x in entries if x.is_file()and x!=path/'manifest.json'}and all(L.safe_path(n)and re.fullmatch('[a-f0-9]{64}',h or'')and L.file_hash(path/n)==h for n,h in manifest.items()),'all-prior-quote-private-file-seals');r=read(path/'first-result.json');need(r.get('success')is True and r.get('mode')==mode and r.get('target')==PRIOR_QUOTE_TARGET and r.get('tree')==PRIOR_QUOTE_TREE,'successful-prior-quote-exact-source-phase');return r

def prior_quote_proof():
 prior_archive(PRIOR_QUOTE_PREPARE,PRIOR_QUOTE_PREPARE_MANIFEST,PRIOR_QUOTE_PREPARE_RESULT,'prepare');verified=prior_archive(PRIOR_QUOTE_VERIFY,PRIOR_QUOTE_VERIFY_MANIFEST,PRIOR_QUOTE_VERIFY_RESULT,'verify');p=read(PRIOR_QUOTE_PREPARE/'prepared.private.json');need(p['target']==PRIOR_QUOTE_TARGET and p['tree']==PRIOR_QUOTE_TREE and set(p['images'])==set(p['proofs'])=={'internal-quote'}and p['images']['internal-quote']==PRIOR_QUOTE_IMAGE and verified.get('images',{}).get('internal-quote')==PRIOR_QUOTE_IMAGE,'sealed-prepared-and-deployed-quote-image-source-binding');need(verified.get('quotePreparedSourceAndRuntimeContractVerified')is True and verified.get('quoteSealedClosedDataCheckReproduced')is True,'prior-quote-full-runtime-source-verification');need(run(['git','rev-parse',BASE+':'+QUOTE]).decode().strip()==run(['git','rev-parse',PRIOR_QUOTE_TARGET+':'+QUOTE]).decode().strip()==PRIOR_QUOTE_APPLICATION_TREE,'current-base-quote-subtree-identical-to-actual-running-source');return{'image':PRIOR_QUOTE_IMAGE,'files':p['proofs']['internal-quote']}

def capture(service,label):
 need(service=='internal-quote' and re.fullmatch('[A-Za-z0-9_.-]{1,100}',label or'')is not None,'fixed-capture-service-label');tree=ROOT/STORAGE[service][0];dest=OUT/(service+'-'+label);names=F.OPS.database_names(tree);before=ownership(tree,names);value=F.OPS.sqlite_capture(service,tree,dest);need(set(value['sqlite'])==set(names),'all-discovered-sqlite-copied')
 need(len(names)==2 and'data.db'in names,'exact-two-legacy-quote-sqlite');value['legacyRawFiles']=F.OPS.L.non_database_inventory(tree,[],dest/'legacy-raw.tar');uploads=ROOT/QUOTE/'backend/uploads';owners=ownership(uploads,[]);value['uploads']=F.OPS.L.non_database_inventory(uploads,[],dest/'uploads.tar');value['uploadsOwnership']=ownership(uploads,[]);need(owners==value['uploadsOwnership'],'stable-upload-mode-owners');db=current_database_id();value['postgres']=quote_pg_capture(db,dest,True)
 value.update(metadata=db_metadata(tree,names),fileOwnership=ownership(tree,names),databaseFamilyMetadata=db_family_metadata(tree,names),observedUTC=datetime.datetime.now(datetime.timezone.utc).isoformat());need(value['fileOwnership']==before and F.OPS.L.non_database_inventory(tree,names)==value['files'],'stable-captured-files-and-mode-owners');private(service+'-'+label+'.private.json',value);return value,dest

def startup_guard(service,value,dest):
 if service=='internal-quote':
  pg=value['postgres'];checks=dict(pg['startupChecks']);missing=checks.pop('missingCostingBasis');need(type(missing)is int and missing==0,'quote-no-costing-basis-seed-insert');verdict=READONLY.startup_safety_checks(checks);need(all(ok for ok,_ in verdict),'quote-existing-startup-row-guards');need(pg.get('sequenceStateStableDuringCapture')is True and READONLY.REQUIRED_TABLES<=set(pg['tables']),'quote-complete-existing-schema-and-stable-sequences');need(all(type(v)is dict and type(v.get('rows'))is int and v['rows']>=0 and re.fullmatch('[a-f0-9]{64}',v.get('sha256',''))and v.get('originalColumnsSHA256')==v['sha256']for v in pg['tables'].values()),'quote-complete-typed-row-digests')
  schema=run(['git','show',BASE+':'+QUOTE+'/backend/db/schema.postgres.sql']).decode();columns={(r['table'],r['name'])for r in pg['schema']['columns']};indexes={r['name']for r in pg['schema']['indexes']}
  for table,body in re.findall(r'CREATE TABLE IF NOT EXISTS ([a-z_]+) \(\n(.*?)\n\);',schema,re.S):
   expected={(table,m.group(1))for line in body.splitlines()if(m:=re.match(r'  ([a-z_]+)\s',line))};need(expected<=columns,'quote-all-existing-bootstrap-columns')
  need({('quote_verification_versions','category'),('quotes','deleted_at'),('quotes','deleted_by')}<=columns and set(re.findall(r'CREATE INDEX IF NOT EXISTS ([a-z_]+)',schema))<=indexes,'quote-existing-alter-columns-and-indexes');need(F.OPS.L.file_hash(dest/'internal_quote.dump')==pg['dumpSHA256'],'sealed-consistent-postgres-dump');return{'allExistingStartupGuardsPassed':True,'allBusinessRowsRequireNoStartupChanges':True,'sequenceValuesCapturedSeparatelyNotClaimedUnchangedOnRestart':True}
 need(False,'only-quote-startup-guard')

def current_database_id():
 records=json.loads(run(['docker','inspect',*run(['docker','ps','-aq','--no-trunc']).decode().split()]));matches=[r for r in records if(r['Config'].get('Labels')or{}).get('com.docker.compose.project')=='rr-portal'and(r['Config'].get('Labels')or{}).get('com.docker.compose.service')=='db'];need(len(matches)==1 and matches[0]['State']['Running']is True,'one-live-readonly-postgres-container');return matches[0]['Id']

def quote_pg_capture(db,dest,with_dump=True):
 need(with_dump is True,'consistent-dump-required-for-every-quote-snapshot');original=F.OPS.pg_table_sql
 def query(schema,tables):
  need(schema=='internal_quote','only-internal-quote-schema-read');sql=original(schema,tables).strip().removesuffix(';');checks=READONLY.startup_checks_sql();extra="SELECT c.value || jsonb_build_object('missingCostingBasis',(SELECT count(*) FROM (VALUES ('qingxi'),('heyuan')) f(code) WHERE NOT EXISTS(SELECT 1 FROM internal_quote.factory_ref_tables r WHERE r.factory_code=f.code AND r.key='costing_basis'))) FROM ("+checks+") c(value)"
  return "SELECT captured.value || jsonb_build_object('__startupChecks',("+extra+")) FROM ("+sql+") captured(value);\n"
 F.OPS.pg_table_sql=query
 try:value=F.OPS.pg_capture(db,dest,True)['internal_quote']
 finally:F.OPS.pg_table_sql=original
 value['startupChecks']=value['tables'].pop('__startupChecks');value['dumpSHA256']=F.OPS.L.file_hash(dest/'internal_quote.dump');value['startupSourceSHA256']=sha(run(['git','show',BASE+':'+QUOTE+'/backend/db/postgres.js']));F.OPS.L.private_write(dest/'postgres.private.json',enc(value));return value

def replay_snapshot(service,value,path):
 need(F.OPS.L.snapshots(path/'sqlite',immutable=True)==value['sqlite'],'all-closed-portable-typed-sqlite-audits-reproduce');F.OPS.L.verify_archive(path/'files.tar',value['files']);need(type(value['fileOwnership'])is dict and type(value['metadata'])is dict,'sealed-mode-owner-inventories')
 if service=='internal-quote':
  F.OPS.L.verify_archive(path/'legacy-raw.tar',value['legacyRawFiles']);F.OPS.L.verify_archive(path/'uploads.tar',value['uploads']);need(type(value['uploadsOwnership'])is dict and read(path/'postgres.private.json')==value['postgres'],'sealed-upload-ownership-and-postgres-evidence')
  with(path/'internal_quote.dump').open('rb')as dump:need(dump.read(5)==b'PGDMP','postgres-custom-format-dump')
 startup_guard(service,value,path)

def source_proof(service,row,revision=BASE):return application_proof(service,row,revision)
def replay_quote(value,path):return replay_snapshot('internal-quote',value,path)

def flags():return F.OPS.L.non_database_inventory(ROOT/'deploy/maintenance',[])
def environment_stable(b):
 p=ROOT/'.env.cloud.production';need(p.is_file()and not p.is_symlink()and p.read_bytes()==(b['archive']/'environment.private').read_bytes()and meta(p)==b['environmentFileMetadata'],'full-environment-bytes-mode-owner-unchanged')
def backup(result):
 need(run(['git','rev-parse','HEAD^{tree}']).decode().strip()==BASE_TREE,'exact-base-tree');configuration=source();dirty=dirty_snapshot(True);env=ROOT/'.env.cloud.production';need(env.is_file()and not env.is_symlink()and env.stat().st_size<=4*1024**2,'bounded-private-env');private('environment.private',env.read_bytes());envmeta=meta(env);maintenance=flags();need(not any(r['path']in{'services/'+s for s in ORDER}for r in maintenance),'all-target-maintenance-initially-clear');before,raw=runtime();private('target-inspect.private.json',raw);render=json.loads(run(['docker','compose','-p','rr-portal','-f',str(ROOT/'docker-compose.cloud.yml'),'--env-file',str(env),'config','--format','json']));private('compose-render.private.json',render);captured={};proof={};startup={}
 dbsize=int(run(['docker','exec','-i',before['databaseContainer'],'sh','-c',PG_SHELL],b"BEGIN READ ONLY; SELECT COALESCE(sum(pg_total_relation_size(c.oid)),0) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='internal_quote'; COMMIT;\n",45));need(dbsize>=0 and shutil.disk_usage(OUT).free>2*(dbsize+sum(p.stat().st_size for roots in EXPECTED_ROOTS.values()for source,_ in roots for p in(ROOT/source).rglob('*')if p.is_file()))+1024**3,'enough-private-backup-space')
 for s in ORDER:
  actual=F.envmap(raw[s]['Config']['Env']);process=process_environment(raw[s]['Id']);image=json.loads(run(['docker','image','inspect',raw[s]['Image']]))[0];need(image['Id']==raw[s]['Image'],'original-immutable-image')
  need((image['Config'].get('Labels')or{}).get('org.opencontainers.image.revision')==PRIOR_QUOTE_TARGET and image['Id']==PRIOR_QUOTE_IMAGE,'actual-quote-image-metadata-equals-sealed-source-revision');private(s+'-image.private.json',image)
  private(s+'-literal-configured-environment.private.json',actual);private(s+'-literal-process-environment.private.json',process);private(s+'-declared-compose-environment.private.json',render['services'][s].get('environment',{}));captured[s],dest=capture(s,'baseline');startup[s]=startup_guard(s,captured[s],dest);proof[s]=application_proof(s,before['targets'][s],BASE)
 after,_=runtime();need(after==before and source()==configuration and dirty_snapshot()==dirty and flags()==maintenance,'unchanged-runtime-source-dirty-flags');b={'head':BASE,'tree':BASE_TREE,'runtime':before,'configuration':configuration,'preexistingFourDirty':dirty,'maintenanceInventory':maintenance,'environmentFileMetadata':envmeta,'environmentSHA256':sha((OUT/'environment.private').read_bytes()),'storage':captured,'sourceProof':proof,'startup':startup};environment_stable(dict(b,archive=OUT))
 for s in ORDER:
  tree=ROOT/STORAGE[s][0];names=list(captured[s]['sqlite']);need(F.OPS.L.non_database_inventory(tree,names)==captured[s]['files']and ownership(tree,names)==captured[s]['fileOwnership']and db_metadata(tree,names)==captured[s]['metadata'],'all-files-mode-owners-stable-through-backup')
 need(F.OPS.L.non_database_inventory(ROOT/QUOTE/'backend/data',[])==captured['internal-quote']['legacyRawFiles']and F.OPS.L.non_database_inventory(ROOT/QUOTE/'backend/uploads',[])==captured['internal-quote']['uploads']and ownership(ROOT/QUOTE/'backend/uploads',[])==captured['internal-quote']['uploadsOwnership'],'unchanged-legacy-raw-and-upload-bytes-mode-owners');private('baseline.private.json',b);result.update(success=True,backupComplete=True,targetContainerCount=1,otherContainerCount=45,portableSQLiteCount=2,consistentExportedInternalQuotePostgresSnapshotAndDump=True,postgresSequenceStatesIndependentlyBracketedNotMVCC=True,quoteRuntimeSourceMatchesBaseAndSealedPrior=True,allPersistentDataFilesAndOwnershipArchived=True,allOriginalTypedRowsAndSchemaCaptured=True,databaseSnapshotsIndividuallyConsistentNotCrossDatabaseAtomic=True,all46ContainersUnchanged=True,environmentFileUnchanged=True,fourExistingDirtyFilesPreserved=True)
def main():
 need(BACKUP_PIN is True and sys.argv[1:]==['backup']and os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_ATTEMPT')=='1','false-draft-or-wrong-invocation');os.umask(0o077);OUT.mkdir(mode=0o700);initialize(OUT);signal.signal(signal.SIGTERM,lambda *_:need(False,'terminated'));result={'mode':'backup','base':BASE,'target':BASE,'tree':BASE_TREE,'success':False,'backupComplete':False,'businessWritesPerformed':False,'credentialsOrConfigurationChanged':False,'containerSignalsPerformed':False,'healthOrBusinessHTTPRequestsPerformed':False,'modelCallsPerformed':False,'otherServicesRequested':False,'secretOrRowsPrinted':False}
 try:backup(result)
 except BaseException as error:result.update(success=False,failedStage=safe_stage(STAGE),factoryLibraryFailedStage=safe_stage(getattr(F,'STAGE',None)),dataOpsFailedStage=safe_stage(getattr(F.OPS,'STAGE',None)),sqliteLibraryFailedStage=safe_stage(getattr(F.OPS.L,'FAILED',None)),quoteLibraryFailedStage=safe_stage(getattr(READONLY,'FAILED_CHECK',None)),safeExceptionType=type(error).__name__);private('failure.private.txt',traceback.format_exc().encode())
 finally:private('first-result.json',result);F.OPS.L.seal(OUT);print(enc(dict(result,manifestSHA256=F.OPS.L.file_hash(OUT/'manifest.json'),resultSHA256=F.OPS.L.file_hash(OUT/'first-result.json'))).decode(),flush=True)
 return 0 if result['success']else 1
if __name__=='__main__':
 try:sys.exit(main())
 except SystemExit:raise
 except BaseException:print('{"mode":"backup","success":false,"safeFailure":"PR997_BACKUP_PREFLIGHT_REJECTED"}',flush=True);sys.exit(1)
