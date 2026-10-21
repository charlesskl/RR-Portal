"""PR982 one-service read-only backup/common. All execution gates remain false.

Only generic snapshot functions are called from the pinned older libraries.
No login, business HTTP, database writes, container signals or configuration edits.
"""
import copy,datetime,hashlib,importlib.util,io,json,os,pathlib,re,shutil,signal,stat,subprocess,sys,tarfile,traceback,urllib.parse

ROOT=pathlib.Path('/opt/rr-portal')
APP_PREFIX='apps/业务部/内部报价系统/'
APP=ROOT/APP_PREFIX
BASE='67385924fc40958701843411b3731d2eeb90b2ad'
BASE_TREE='f0a724fb72b06e9cea3dc5aa1baa8bed629f127d'
BRANCH='refs/heads/ops/pr-982-20261021'
BACKUP_PIN=False
OUT=ROOT/'deploy/backups/pr-982-20261021-backup'
DEPENDENCIES={
 'release-data-ops-library.py':'ff9138a1d5bfed1b10077112da6ebcda2d65240f583e2d0e12ce1325cfbaafd5',
 'release-data-library.py':'d63168fd3057f4f2aba2d93f9fab31d2d65c6dd0f3234877d71fcff1e04e62b9',
 'internal-quote-readonly-library.py':'be4f901f3444154e5de06766a2d8a0801dba9b847a4ac25f34a84ccebe354e69',
 'batch-host-config-library.py':'bd1842dc6847f3e0e5c0c38374c3604791f66d1c94dc651457607dc338f38ff1',
}
FIXED=('docker-compose.cloud.yml','nginx/nginx.cloud.conf','deploy/update-server.sh','deploy/service-maintenance.sh','.github/workflows/deploy.yml',APP_PREFIX+'Dockerfile',APP_PREFIX+'.dockerignore',APP_PREFIX+'package.json')
PG_SHELL='exec psql -X -q -At -v ON_ERROR_STOP=1 -U "${POSTGRES_USER:-rrportal}" -d "${POSTGRES_DB:-rrportal}"'
STAGE='entrypoint';COUNTER=0;OPS=None;READONLY=None;H=None

def need(value,label='invariant'):
 global STAGE
 if not value:
  STAGE=label if type(label)is str and re.fullmatch('[A-Za-z0-9_.-]{1,140}',label)else'invalid-check'
  raise RuntimeError('PR982_GUARD_REJECTED')

def enc(v):return json.dumps(v,ensure_ascii=True,sort_keys=True,separators=(',',':'),allow_nan=False).encode()
def sha(v):return hashlib.sha256(v).hexdigest()
def pin(v,n=64):return type(v)is str and bool(re.fullmatch('[a-f0-9]{%d}'%n,v))

def load(name):
 p=pathlib.Path(__file__).with_name(name)
 need(name in DEPENDENCIES and p.is_file()and not p.is_symlink()and sha(p.read_bytes())==DEPENDENCIES[name],'dependency-pin')
 s=importlib.util.spec_from_file_location('pr982_'+name.replace('.','_'),p);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m

def run(args,data=None,timeout=180):
 global COUNTER
 COUNTER+=1
 with(OUT/('%04d-stderr.private'%COUNTER)).open('xb')as error:
  p=subprocess.run(args,input=data,stdout=subprocess.PIPE,stderr=error,timeout=timeout,cwd=ROOT)
 need(p.returncode==0 and len(p.stdout)<=128*1024**2,'bounded-private-command');return p.stdout

def initialize():
 global OPS,READONLY,H
 OPS=load('release-data-ops-library.py');OPS.L=OPS.load_library(pathlib.Path(__file__).with_name('release-data-library.py'))
 OPS.ROOT=ROOT;OPS.SCHEMAS=('internal_quote',);OPS.NEW_COLUMNS={};OPS.TARGETS={'internal-quote'};OPS.PROTECTED=set();OPS.PREFIXES={
  'quote-legacy':(APP_PREFIX+'backend/data','internal-quote','/app/backend/legacy-data'),
  'quote-uploads':(APP_PREFIX+'backend/uploads','internal-quote','/app/backend/uploads')}
 OPS.run=run;READONLY=load('internal-quote-readonly-library.py');READONLY.run=run;READONLY.ROOT=ROOT;READONLY.APP_ROOT=APP;READONLY.APP_PREFIX=APP_PREFIX;H=load('batch-host-config-library.py')
 need(OPS.SCHEMAS==('internal_quote',)and OPS.NEW_COLUMNS=={}and OPS.TARGETS=={'internal-quote'},'one-service-library-scope')

def envmap(values):
 need(type(values)is list and len(values)<=1000,'environment-list');result={}
 for row in values:
  need(type(row)is str and'='in row,'environment-entry');key,value=row.split('=',1)
  need(re.fullmatch('[A-Za-z_][A-Za-z0-9_]*',key)and key not in result,'environment-unique-key');result[key]=value
 return result

def process_environment(cid):
 value=run(['docker','exec',cid,'cat','/proc/1/environ']);need(value.endswith(b'\0'),'pid1-environment-format')
 result=envmap([v.decode()for v in value.split(b'\0')if v]);need(result.pop('HOSTNAME',None)==cid[:12],'pid1-automatic-hostname');return result

def stable_bytes(path,limit=4*1024**2):
 need(path.is_file()and not path.is_symlink(),'regular-private-file')
 with os.fdopen(os.open(path,os.O_RDONLY|os.O_NOFOLLOW),'rb')as stream:
  a=os.fstat(stream.fileno());need(stat.S_ISREG(a.st_mode)and a.st_size<=limit,'bounded-private-file');data=stream.read(limit+1);b=os.fstat(stream.fileno())
  fields=lambda s:(s.st_dev,s.st_ino,s.st_mode,s.st_uid,s.st_gid,s.st_size,s.st_mtime_ns,s.st_ctime_ns)
  need(fields(a)==fields(b)==fields(path.lstat())and len(data)==a.st_size,'stable-private-file')
 return data

def file_metadata(path):
 before=path.lstat();need(path.is_file()and not path.is_symlink(),'regular-metadata-file');checksum=OPS.L.file_hash(path);after=path.lstat()
 key=lambda s:(s.st_dev,s.st_ino,s.st_mode,s.st_uid,s.st_gid,s.st_size,s.st_mtime_ns,s.st_ctime_ns)
 need(key(before)==key(after),'stable-file-metadata')
 return {'sha256':checksum,'mode':stat.S_IMODE(before.st_mode),'uid':before.st_uid,'gid':before.st_gid,'bytes':before.st_size,'device':before.st_dev,'inode':before.st_ino,'mtimeNs':before.st_mtime_ns,'ctimeNs':before.st_ctime_ns}

def owner_inventory(root):
 need(root.is_dir()and not root.is_symlink(),'persistent-root-directory');result=[]
 for p in(root,*sorted(root.rglob('*'))):
  s=p.lstat();need(not p.is_symlink()and(stat.S_ISREG(s.st_mode)or stat.S_ISDIR(s.st_mode)),'persistent-no-special-files')
  result.append({'path':'.'if p==root else str(p.relative_to(root)),'directory':stat.S_ISDIR(s.st_mode),'mode':stat.S_IMODE(s.st_mode),'uid':s.st_uid,'gid':s.st_gid})
  need(len(result)<=100000,'persistent-owner-inventory-bound')
 return result

def runtime(require_healthy=True):
 ids=run(['docker','ps','-aq','--no-trunc']).decode().split();need(0<len(ids)<=1000 and len(ids)==len(set(ids))and all(pin(v)for v in ids),'container-ids')
 records=json.loads(run(['docker','inspect',*ids]));need(type(records)is list and len(records)==len(ids),'container-inspects');others={};app=None;db=None;seen=set()
 for raw in records:
  cid=raw['Id'];need(cid in ids and cid not in seen,'unique-container-inspect');seen.add(cid);labels=raw['Config'].get('Labels')or{};role=labels.get('com.docker.compose.service')if labels.get('com.docker.compose.project')=='rr-portal'else None;state=raw['State'];config=copy.deepcopy(raw['Config']);config['Env']=sorted(config.get('Env')or[])
  row={'id':cid,'image':raw['Image'],'started':state.get('StartedAt'),'running':state['Running'],'oom':state['OOMKilled'],'restarts':raw['RestartCount'],'health':state.get('Health',{}).get('Status'),'configSHA256':sha(enc(config)),'hostConfigSHA256':sha(enc(raw['HostConfig'])),'networkSettingsSHA256':sha(enc(raw.get('NetworkSettings',{}))),'mounts':sorted(raw.get('Mounts',[]),key=enc)}
  if role=='internal-quote':need(app is None,'one-quote-container');app=(raw,row)
  else:others[cid]=row
  if role=='db':need(db is None and state['Running']is True and state.get('Health',{}).get('Status')=='healthy','healthy-existing-postgres');db=raw
 need(app is not None and db is not None,'quote-and-database-present');raw,row=app
 if require_healthy:need(row['running']is True and row['oom']is False and row['health']=='healthy','quote-running-healthy')
 storage_contract(raw,db)
 if row['running']:
  need(raw['Config'].get('Hostname')==raw['Id'][:12],'configured-automatic-hostname');row['processEnvironmentSHA256']=sha(enc(process_environment(raw['Id'])))
 return {'app':row,'others':others,'databaseContainer':db['Id']},raw

def storage_contract(app,db):
 q=envmap(app['Config']['Env']);d=envmap(db['Config']['Env']);url=urllib.parse.urlsplit(q.get('DATABASE_URL',''))
 need(q.get('DB_DRIVER')!='sqlite'and q.get('DB_SCHEMA')=='internal_quote'and url.scheme in{'postgres','postgresql'}and url.hostname=='db'and(url.port or 5432)==5432 and urllib.parse.unquote(url.path)=='/'+(d.get('POSTGRES_DB')or'rrportal')and urllib.parse.unquote(url.username or'')==(d.get('POSTGRES_USER')or'rrportal')and urllib.parse.unquote(url.password or'')==d.get('POSTGRES_PASSWORD','')and not url.query and not url.fragment and q.get('LEGACY_SQLITE_FILE')=='/app/backend/legacy-data/data.db','bound-quote-postgres')
 mounts=app.get('Mounts',[]);need(len(mounts)==2,'only-two-quote-mounts')
 for destination,relative,rw in(('/app/backend/legacy-data','backend/data',False),('/app/backend/uploads','backend/uploads',True)):
  matches=[m for m in mounts if m.get('Destination')==destination];p=APP/relative
  need(len(matches)==1 and matches[0].get('Type')=='bind'and matches[0].get('Source')==str(p)and matches[0].get('RW')is rw and p.is_dir()and all(not a.is_symlink()for a in(p,*p.parents)),'fixed-quote-bind-mount')

def dirty_snapshot(save=False):
 run(['git','diff','--cached','--quiet','--no-ext-diff','--no-textconv','--ignore-submodules=none'])
 names=run(['git','diff','--name-only','-z','--no-ext-diff','--no-textconv','--ignore-submodules=none']).decode().rstrip('\0').split('\0')
 need(len(names)==len(set(names))==4,'exact-four-preexisting-dirty');result={}
 for index,name in enumerate(sorted(names)):
  need(OPS.L.safe_path(name)and not name.startswith((APP_PREFIX,'apps/船务部/','apps/工程部/3D打印协同平台/'))and name not in FIXED,'dirty-files-unrelated')
  entry=run(['git','ls-tree','-z',BASE,'--',name]).split(b'\t',1);need(len(entry)==2 and entry[1]==name.encode()+b'\0'and re.fullmatch(b'100(?:644|755) blob [a-f0-9]{40}',entry[0]),'dirty-tracked-regular-file');p=ROOT/name
  for a in(p,*p.parents):
   if a==ROOT:break
   need(not a.is_symlink(),'dirty-no-symlink')
  if not p.exists():result[name]={'kind':'absent'};continue
  content=stable_bytes(p,8*1024**2);s=p.stat();result[name]={'kind':'regular','bytes':len(content),'mode':stat.S_IMODE(s.st_mode),'uid':s.st_uid,'gid':s.st_gid,'sha256':sha(content)}
  if save:OPS.L.private_write(OUT/('dirty-%02d.private'%index),content)
 need(sum(v.get('bytes',0)for v in result.values())<=16*1024**2,'dirty-total-bound');return result

def source(revision):
 need(pin(revision,40)and run(['git','symbolic-ref','--quiet','HEAD']).decode().strip()=='refs/heads/main'and run(['git','rev-parse','HEAD']).decode().strip()==revision,'canonical-reviewed-main')
 need(run(['git','rev-parse',BASE+'^{tree}']).decode().strip()==BASE_TREE,'exact-backup-base-tree')
 result={}
 for name in FIXED:
  p=ROOT/name;data=stable_bytes(p,8*1024**2);need(data==run(['git','show',revision+':'+name]),'fixed-source-bytes');result[name]=sha(data)
 untracked=run(['git','ls-files','--others','--exclude-standard','-z','--',APP_PREFIX]).decode().rstrip('\0')
 need(not untracked,'no-untracked-app-build-input')
 return result

def maintenance_inventory(own_allowed=False):
 p=ROOT/'deploy/maintenance';need(p.is_dir()and not p.is_symlink(),'maintenance-root');own=p/'services/internal-quote'
 if not own_allowed:need(not own.exists()and not own.is_symlink(),'quote-maintenance-initially-clear')
 return OPS.L.non_database_inventory(p,[])

def compose_environment(raw):
 need(run(['docker','compose','version','--short']).decode().strip()=='5.1.0','compose-version')
 config=json.loads(run(['docker','compose','-p','rr-portal','-f',str(ROOT/'docker-compose.cloud.yml'),'--env-file',str(ROOT/'.env.cloud.production'),'config','--format','json'],timeout=90))
 need(type(config)is dict and type(config.get('services'))is dict and'internal-quote'in config['services'],'complete-rendered-compose');image=json.loads(run(['docker','image','inspect',raw['Image']]))[0];need(image['Id']==raw['Image'],'original-image-binding')
 actual=envmap(raw['Config']['Env']);defaults=envmap(image['Config'].get('Env')or[]);declared=config['services']['internal-quote'].get('environment',{})
 need(type(declared)is dict and all(type(k)is str and type(v)is str for k,v in declared.items()),'compose-string-environment');literal={k:v for k,v in actual.items()if k in declared or defaults.get(k)!=v};need(dict(defaults,**literal)==actual,'literal-plus-image-environment')
 for name,value in(('compose-render',config),('app-inspect',raw),('app-image',image),('literal-configured-environment',actual),('literal-process-environment',process_environment(raw['Id'])),('literal-compose-environment',literal)):
  OPS.L.private_write(OUT/(name+'.private.json'),enc(value))
 return {'version':'5.1.0','configuredEnvironmentSHA256':sha(enc(actual)),'processEnvironmentSHA256':sha(enc(process_environment(raw['Id']))),'declaredLiteralDifferenceKeys':sorted(k for k in set(declared)|set(literal)if declared.get(k)!=literal.get(k,'').replace('$','$$'))}

def startup(dbid):
 need(OPS.SCHEMAS==('internal_quote',)and OPS.NEW_COLUMNS=={},'quote-only-pg-scope');sql='BEGIN READ ONLY; SET LOCAL statement_timeout=\'30s\'; '+READONLY.startup_checks_sql()+'; COMMIT;\n'
 facts=json.loads(run(['docker','exec','-i',dbid,'sh','-c',PG_SHELL],sql.encode(),45));checks={name:ok for ok,name in READONLY.startup_safety_checks(facts)}
 missing=int(run(['docker','exec','-i',dbid,'sh','-c',PG_SHELL],b"BEGIN READ ONLY; SELECT count(*) FROM(VALUES('qingxi'),('heyuan')) f(code) WHERE NOT EXISTS(SELECT 1 FROM internal_quote.factory_ref_tables r WHERE r.factory_code=f.code AND r.key='costing_basis'); COMMIT;\n",45))
 checks['existing-both-factory-costing-basis']=missing==0
 return {'allPassed':all(v is True for v in checks.values()),'checks':checks,'facts':dict(facts,missingCostingBasis=missing)}

def git_runtime_inventory(revision):
 names=run(['git','ls-tree','-r','--name-only','-z',revision,'--',APP_PREFIX+'backend',APP_PREFIX+'frontend']).decode().rstrip('\0').split('\0')
 need(names and all(OPS.L.safe_path(n)and n.startswith(APP_PREFIX)for n in names),'runtime-source-inventory')
 names=[n for n in names if'/data/'not in n and'/uploads/'not in n]
 return {n[len(APP_PREFIX):]:sha(run(['git','show',revision+':'+n]))for n in names}

def source_proof(reference,revision,candidate=False):
 expected=git_runtime_inventory(revision);need(0<len(expected)<=10000,'source-file-count')
 args=['docker','run','--rm','--network','none','--read-only','--log-driver','none','--entrypoint','tar',reference]if candidate else['docker','exec',reference,'tar']
 blob=run([*args,'-C','/app','-cf','-',*sorted(expected)]);actual={};total=0
 with tarfile.open(fileobj=io.BytesIO(blob),mode='r:')as archive:
  for row in archive:
   need(row.name in expected and row.name not in actual and row.isfile(),'exact-runtime-source-tar');total+=row.size;need(row.size<=64*1024**2 and total<=128*1024**2,'bounded-runtime-source-tar');data=archive.extractfile(row).read();need(len(data)==row.size,'complete-runtime-source-file');actual[row.name]=sha(data)
 need(actual==expected,'all-runtime-source-bytes');return {'sourceFileCount':len(actual),'sourceSHA256':sha(enc(actual)),'sourceFileSHA256':actual,'target':revision}

def capture(directory,dbid,with_dump=True):
 need(not directory.exists(),'new-storage-evidence-directory');directory.mkdir(mode=0o700);legacy=APP/'backend/data';uploads=APP/'backend/uploads';oldowners={'legacy':owner_inventory(legacy),'uploads':owner_inventory(uploads)}
 need(OPS.SCHEMAS==('internal_quote',)and OPS.NEW_COLUMNS=={},'snapshot-only-quote-schema');pg=OPS.pg_capture(dbid,directory,with_dump)['internal_quote'];sqlite=OPS.sqlite_capture('quote-legacy',legacy,directory/'legacy');need('data.db'in sqlite['sqlite']and 1<=len(sqlite['sqlite'])<=10,'existing-legacy-databases')
 raw=OPS.L.non_database_inventory(legacy,[],directory/'legacy-raw.private.tar');files=OPS.L.non_database_inventory(uploads,[],directory/'uploads.private.tar');owners={'legacy':owner_inventory(legacy),'uploads':owner_inventory(uploads)}
 need(oldowners==owners and raw==OPS.L.non_database_inventory(legacy,[])and files==OPS.L.non_database_inventory(uploads,[]),'persistent-files-stable-during-capture')
 value={'postgres':pg,'legacy':sqlite,'legacyRaw':raw,'uploads':files,'owners':owners};OPS.L.private_write(directory/'observed.private.json',enc(value));OPS.L.seal(directory);return value

def backup(result):
 global STAGE
 STAGE='backup-source-dirty-flags';configuration=source(BASE);dirty=dirty_snapshot(True);flags=maintenance_inventory();env=ROOT/'.env.cloud.production';envbytes=stable_bytes(env);envmeta=file_metadata(env);OPS.L.private_write(OUT/'environment.private',envbytes)
 STAGE='backup-runtime-environment';before,raw=runtime();compose=compose_environment(raw);need(shutil.disk_usage(OUT).free>3*sum(p.stat().st_size for root in(APP/'backend/data',APP/'backend/uploads')for p in root.rglob('*')if p.is_file())+2*1024**3,'backup-free-space')
 STAGE='backup-startup-safety';checks=startup(before['databaseContainer']);OPS.L.private_write(OUT/'startup.private.json',enc(checks));need(checks['allPassed'],'startup-would-change-data')
 STAGE='backup-actual-source-proof';proof=source_proof(raw['Id'],BASE)
 STAGE='backup-consistent-data';data=capture(OUT/'storage',before['databaseContainer'])
 STAGE='backup-final-stability';need(runtime()[0]==before and source(BASE)==configuration and dirty_snapshot()==dirty and maintenance_inventory()==flags and stable_bytes(env)==envbytes and file_metadata(env)==envmeta,'backup-source-runtime-env-stability')
 value={'head':BASE,'runtime':before,'configuration':configuration,'preexistingFourDirty':dirty,'maintenanceInventory':flags,'environmentFileMetadata':envmeta,'environmentSHA256':sha(envbytes),'composeEnvironmentProof':compose,'sourceProof':proof,'storage':data,'startupChecks':checks};OPS.L.private_write(OUT/'baseline.private.json',enc(value))
 result.update(success=True,backupComplete=True,onlyInternalQuoteStorageCaptured=True,startupSafetyPassed=True,allOtherContainersUnchanged=True,allMaintenanceFlagsUnchanged=True,allOriginalTypedRowsAndSchemaCaptured=True,privateEnvironmentCaptured=True,sourceProven=True,portableLegacySQLiteCount=len(data['legacy']['sqlite']),otherContainerCount=len(before['others']),sequenceStatesIndependentlyBracketedNotMVCC=True)

def main():
 global OUT
 need(BACKUP_PIN and sys.argv[1:]==['backup']and os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_ATTEMPT')=='1','false-draft-or-wrong-phase')
 os.umask(0o077);OUT.mkdir(mode=0o700);initialize();signal.signal(signal.SIGTERM,lambda *_:need(False,'terminated'))
 result={'mode':'backup','base':BASE,'target':BASE,'tree':BASE_TREE,'success':False,'businessWritesPerformed':False,'liveHTTPOrAuthenticationRequestsPerformed':False,'containerSignalsPerformed':False,'configurationChanged':False,'databaseRestorePerformed':False,'secretOrBusinessRowsPrinted':False}
 try:backup(result)
 except BaseException as error:
  result.update(failedStage=STAGE,safeExceptionType=type(error).__name__);OPS.L.private_write(OUT/'failure.private.txt',traceback.format_exc().encode())
 finally:
  OPS.L.private_write(OUT/'first-result.json',enc(result));OPS.L.seal(OUT);print(enc(dict(result,manifestSHA256=OPS.L.file_hash(OUT/'manifest.json'),resultSHA256=OPS.L.file_hash(OUT/'first-result.json'))).decode(),flush=True)
 return 0 if result['success']else 1

if __name__=='__main__':
 try:sys.exit(main())
 except SystemExit:raise
 except BaseException:print('{"success":false,"safeFailure":"PR982_BACKUP_PREFLIGHT_REJECTED"}',flush=True);sys.exit(1)
