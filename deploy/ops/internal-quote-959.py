"""Fixed internal-quote backup first. Draft; deploy/verify are deliberately disabled."""
import datetime,hashlib,importlib.util,json,os,pathlib,re,shutil,signal,sqlite3,stat,subprocess,sys,urllib.parse
ROOT=pathlib.Path('/opt/rr-portal');APP=ROOT/'apps/业务部/内部报价系统';BASE='32440d3f0891e52707ea89f8dfe72eabe9f62ad7'
BRANCH='refs/heads/ops/internal-quote-959-20261020';BACKUP_PIN=False;DEPLOY_PIN=False;VERIFY_PIN=False;TARGET='';TARGET_TREE='';REVIEWED_FILES={}
OUT=ROOT/'deploy/backups/internal-quote-959-20261020-backup'
DEPENDENCIES={'release-data-ops-library.py':'ff9138a1d5bfed1b10077112da6ebcda2d65240f583e2d0e12ce1325cfbaafd5','release-data-library.py':'d63168fd3057f4f2aba2d93f9fab31d2d65c6dd0f3234877d71fcff1e04e62b9','internal-quote-readonly-library.py':'be4f901f3444154e5de06766a2d8a0801dba9b847a4ac25f34a84ccebe354e69'}
STAGE='preflight';COUNTER=0;OPS=None;READONLY=None
APP_PREFIX='apps/业务部/内部报价系统/'
FIXED=('docker-compose.cloud.yml','deploy/service-maintenance.sh',APP_PREFIX+'Dockerfile',APP_PREFIX+'.dockerignore')
PG_SHELL='exec psql -X -q -At -v ON_ERROR_STOP=1 -U "${POSTGRES_USER:-rrportal}" -d "${POSTGRES_DB:-rrportal}"'

def need(v):
 if not v:raise RuntimeError('INTERNAL_QUOTE_RELEASE_REJECTED')
def enc(v):return json.dumps(v,ensure_ascii=True,sort_keys=True,separators=(',',':'),allow_nan=False).encode()
def sha(v):return hashlib.sha256(v).hexdigest()
def load(name):
 p=pathlib.Path(__file__).with_name(name);need(p.is_file()and not p.is_symlink()and sha(p.read_bytes())==DEPENDENCIES[name]);spec=importlib.util.spec_from_file_location(name.replace('.','_'),p);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m

def run(args,data=None,timeout=180):
 global COUNTER
 COUNTER+=1
 with (OUT/('%03d-stderr.private'%COUNTER)).open('xb')as errors:p=subprocess.run(args,input=data,stdout=subprocess.PIPE,stderr=errors,timeout=timeout,cwd=ROOT)
 need(p.returncode==0 and len(p.stdout)<=32*1024**2);return p.stdout

def envmap(value):
 need(type(value)is list and len(value)<=1000);result={}
 for v in value:need(type(v)is str and'='in v);key,val=v.split('=',1);need(re.fullmatch('[A-Za-z_][A-Za-z0-9_]*',key)and key not in result);result[key]=val
 return result

def runtime():
 ids=run(['docker','ps','-aq','--no-trunc']).decode().split();need(0<len(ids)<=1000 and all(re.fullmatch('[a-f0-9]{64}',v)for v in ids));records=json.loads(run(['docker','inspect',*ids]));need(type(records)is list and len(records)==len(ids));others={};app=None;db=None
 for r in records:
  cid=r['Id'];need(cid in ids);labels=r.get('Config',{}).get('Labels')or{};service=labels.get('com.docker.compose.service');role=service if labels.get('com.docker.compose.project')=='rr-portal'else None
  row={'id':cid,'image':r['Image'],'started':r['State'].get('StartedAt'),'running':r['State']['Running'],'oom':r['State']['OOMKilled'],'restarts':r['RestartCount'],'health':r['State'].get('Health',{}).get('Status'),'environmentMapSHA256':sha(enc(envmap(r['Config']['Env']))),'mounts':sorted(r.get('Mounts',[]),key=enc),'memory':r['HostConfig'].get('Memory'),'swap':r['HostConfig'].get('MemorySwap'),'healthcheck':r['Config'].get('Healthcheck'),'command':r['Config'].get('Cmd'),'entrypoint':r['Config'].get('Entrypoint'),'user':r['Config'].get('User'),'workingDirectory':r['Config'].get('WorkingDir')}
  if role=='internal-quote':need(app is None);app=(r,row)
  else:need(cid not in others);others[cid]=row
  if role=='db':need(db is None);db=r
 need(app is not None and db is not None);r,row=app;need(row['running']is True and row['oom']is False and row['health']=='healthy')
 ae,de=envmap(r['Config']['Env']),envmap(db['Config']['Env']);url=urllib.parse.urlsplit(ae.get('DATABASE_URL',''));need(ae.get('DB_DRIVER')!='sqlite'and ae.get('DB_SCHEMA')=='internal_quote'and url.scheme in {'postgres','postgresql'}and url.hostname=='db'and(url.port or 5432)==5432 and urllib.parse.unquote(url.path)=='/'+(de.get('POSTGRES_DB')or'rrportal')and urllib.parse.unquote(url.username or'')==(de.get('POSTGRES_USER')or'rrportal')and not url.query and not url.fragment and ae.get('LEGACY_SQLITE_FILE')=='/app/backend/legacy-data/data.db')
 for dest,rel in [('/app/backend/legacy-data','backend/data'),('/app/backend/uploads','backend/uploads')]:
  matches=[m for m in row['mounts']if m.get('Destination')==dest];need(len(matches)==1 and matches[0].get('Type')=='bind'and matches[0].get('Source')==str(APP/rel))
 proc=json.loads(run(['docker','exec',r['Id'],'node','-e',"const fs=require('node:fs');process.stdout.write(JSON.stringify(fs.readFileSync('/proc/1/environ','utf8').split('\\0').filter(Boolean))); "]));pm=envmap(proc);need(r['Config'].get('Hostname')==r['Id'][:12]and pm.pop('HOSTNAME',None)==r['Config']['Hostname']);row['processEnvironmentWithoutAutomaticHostnameSHA256']=sha(enc(pm))
 return {'app':row,'others':others,'databaseContainer':db['Id']},r

def dirty_snapshot(save=False):
 run(['git','diff','--cached','--quiet','--no-ext-diff','--no-textconv','--ignore-submodules=none']);names=run(['git','diff','--name-only','-z','--no-ext-diff','--no-textconv','--ignore-submodules=none']).decode().strip('\0').split('\0');need(len(names)==len(set(names))==4);rows={}
 for i,n in enumerate(sorted(names)):
  need(OPS.L.safe_path(n)and not any(n==p or n.startswith(p+'/')for p in (APP_PREFIX.rstrip('/'),'apps/船务部','apps/工程部/3D打印协同平台'))and n not in FIXED)
  raw=run(['git','ls-tree','-z',BASE,'--',n]);parts=raw.split(b'\t',1);need(len(parts)==2 and parts[1]==n.encode()+b'\0'and re.fullmatch(b'100(?:644|755) blob [a-f0-9]{40}',parts[0]))
  p=ROOT/n
  for a in (p,*p.parents):
   if a==ROOT:break
   need(not a.is_symlink())
  if not p.exists():rows[n]={'kind':'absent'};continue
  fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW)
  with os.fdopen(fd,'rb')as f:
   a=os.fstat(f.fileno());need(stat.S_ISREG(a.st_mode)and a.st_size<=8*1024**2);content=f.read(8*1024**2+1);b=os.fstat(f.fileno());fields=lambda s:(s.st_dev,s.st_ino,s.st_mode,s.st_size,s.st_mtime_ns,s.st_ctime_ns);need(fields(a)==fields(b)==fields(p.lstat())and len(content)==a.st_size)
  rows[n]={'kind':'regular','bytes':len(content),'mode':stat.S_IMODE(a.st_mode),'sha256':sha(content)}
  if save:OPS.L.private_write(OUT/('dirty-%02d.private'%i),content)
 need(sum(v.get('bytes',0)for v in rows.values())<=16*1024**2);return rows

def source():
 need(run(['git','symbolic-ref','--quiet','HEAD']).decode().strip()=='refs/heads/main'and run(['git','rev-parse','HEAD']).decode().strip()==BASE)
 for name in FIXED:
  p=ROOT/name;need(p.is_file()and not p.is_symlink()and p.read_bytes()==run(['git','show',BASE+':'+name]))
 return {n:OPS.L.file_hash(ROOT/n)for n in FIXED}

def startup(db):
 sql="BEGIN READ ONLY; SET LOCAL statement_timeout='30s'; "+READONLY.startup_checks_sql()+"; COMMIT;\n";raw=run(['docker','exec','-i',db,'sh','-c',PG_SHELL],sql.encode(),45);value=json.loads(raw);checks=READONLY.startup_safety_checks(value);return value,all(ok for ok,_ in checks),[code for ok,code in checks if not ok]

def serialized_environment(literal):
 need(type(literal)is dict and all(type(k)is str and re.fullmatch('[A-Za-z_][A-Za-z0-9_]*',k)and type(v)is str for k,v in literal.items()));return{k:v.replace('$','$$')for k,v in literal.items()}

def literal_explicit_environment(actual,defaults,declared):
 need(type(actual)is dict and type(defaults)is dict and type(declared)is dict and all(type(k)is str and re.fullmatch('[A-Za-z_][A-Za-z0-9_]*',k)and type(v)is str for mapping in(actual,defaults,declared)for k,v in mapping.items())and set(declared)<=set(actual));literal={k:actual[k]for k in declared};need(declared==serialized_environment(literal));expected=dict(defaults);expected.update(literal);need(expected==actual);return literal

def compose_environment(app,image):
 global STAGE
 STAGE='installed-compose-version';need(run(['docker','compose','version','--short']).decode().strip()=='5.1.0')
 STAGE='compose-config-forward-serialized-environment';command=['docker','compose','-p','rr-portal','-f',str(ROOT/'docker-compose.cloud.yml'),'--env-file',str(ROOT/'.env.cloud.production'),'config','--format','json'];configuration=json.loads(run(command,timeout=90));need(type(configuration)is dict and type(configuration.get('services'))is dict and type(configuration['services'].get('internal-quote'))is dict);declared=configuration['services']['internal-quote'].get('environment',{});need(image['Id']==app['Image']);literal=literal_explicit_environment(envmap(app['Config']['Env']),envmap(image['Config'].get('Env')or[]),declared);OPS.L.private_write(OUT/'compose-environment.private.json',enc(declared));OPS.L.private_write(OUT/'literal-compose-environment.private.json',enc(literal));return {'composeVersion':'5.1.0','serializedExplicitEnvironmentSHA256':sha(enc(declared)),'literalExplicitEnvironmentSHA256':sha(enc(literal)),'forwardSerializedLiteralEqualsComposeJSON':True,'literalExplicitAndImageDefaultsEqualRuntime':True}

def maintenance_inventory():
 p=ROOT/'deploy/maintenance';need(p.is_dir()and not p.is_symlink());target=p/'services/internal-quote';need(not target.exists()and not target.is_symlink());return OPS.L.non_database_inventory(p,[])

def pg_with_seed_evidence(db,directory,with_dump):
 # Extend only the table digest query. The full hashes, original schema, and
 # baseline dump remain in the same read-only exported snapshot. Never print
 # these private rows. Two fixed seed keys are independently compared later.
 original=OPS.pg_table_sql
 def query(schema,tables):
  raw=original(schema,tables)
  need(schema=='internal_quote'and'factory_ref_tables'in tables)
  candidate="factory_code IN ('qingxi','heyuan') AND key='costing_basis'"
  digest="encode(sha256(convert_to(COALESCE(string_agg(row_hash,'' ORDER BY row_hash),''),'UTF8')),'hex')"
  projection="(SELECT jsonb_build_object('rows',count(*),'sha256',"+digest+",'originalColumnsSHA256',"+digest+") FROM (SELECT encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex') row_hash FROM internal_quote.factory_ref_tables r WHERE NOT ("+candidate+")) h)"
  seeds="(SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY factory_code),'[]'::jsonb) FROM internal_quote.factory_ref_tables r WHERE "+candidate+")"
  return "SELECT captured.value || jsonb_build_object('factory_ref_tables',(captured.value->'factory_ref_tables') || jsonb_build_object('startupCostingBasisEvidence',jsonb_build_object('nonSeedRows',"+projection+",'seedRows',"+seeds+",'transactionTimestamp',CURRENT_TIMESTAMP::text))) FROM ("+raw.strip().removesuffix(';')+") captured(value);\n"
 OPS.pg_table_sql=query
 try:return OPS.pg_capture(db,directory,with_dump)['internal_quote']
 finally:OPS.pg_table_sql=original

def backup(result):
 global STAGE
 STAGE='source-and-fixed-configuration';config=source()
 STAGE='four-preexisting-tracked-changes';dirty=dirty_snapshot(True)
 STAGE='target-maintenance-cleared-and-flags';maintenance=maintenance_inventory()
 STAGE='private-environment-file';env=ROOT/'.env.cloud.production';need(env.is_file()and not env.is_symlink()and env.stat().st_size<=4*1024**2);envhash=OPS.L.file_hash(env);OPS.L.private_write(OUT/'environment.private',env.read_bytes())
 STAGE='current-runtime-and-storage';before,app=runtime();OPS.L.private_write(OUT/'app-inspect.private.json',enc(app));image=json.loads(run(['docker','image','inspect',before['app']['image']]));need(len(image)==1 and image[0]['Id']==before['app']['image']);OPS.L.private_write(OUT/'app-image.private.json',enc(image[0]))
 STAGE='compose-runtime-environment-preflight';composeproof=compose_environment(app,image[0])
 STAGE='startup-preflight';checks,eligible,failed=startup(before['databaseContainer']);result.update(startupSafetyPassed=eligible,startupSafetyFailedChecks=failed)
 size=int(run(['docker','exec','-i',before['databaseContainer'],'sh','-c',PG_SHELL],b"BEGIN READ ONLY; SELECT COALESCE(sum(pg_total_relation_size(c.oid)),0) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='internal_quote'; COMMIT;\n",45));filesize=sum(p.stat().st_size for root in (APP/'backend/data',APP/'backend/uploads')for p in root.rglob('*')if p.is_file());need(size>=0 and shutil.disk_usage(OUT).free>2*(size+filesize)+1024**3)
 STAGE='exported-internal-quote-snapshot';pg=pg_with_seed_evidence(before['databaseContainer'],OUT,True)
 STAGE='legacy-wal-consistent-and-files';legacy=OPS.sqlite_capture('quote-legacy',APP/'backend/data',OUT/'legacy');need(len(legacy['sqlite'])==2 and'data.db'in legacy['sqlite']);legacy['completeRawFileInventory']=OPS.L.non_database_inventory(APP/'backend/data',[],OUT/'legacy-raw.tar')
 STAGE='upload-bytes-and-permissions';uploads=OPS.L.non_database_inventory(APP/'backend/uploads',[],OUT/'uploads.tar')
 STAGE='runtime-source-file-proof';proof=READONLY.source_runtime_files(before['app']['id'],BASE)
 STAGE='final-stability';after,_=runtime();need(before==after and dirty_snapshot()==dirty and source()==config and OPS.L.file_hash(env)==envhash and OPS.L.non_database_inventory(APP/'backend/uploads',[])==uploads and OPS.L.non_database_inventory(APP/'backend/data',[])==legacy['completeRawFileInventory']and maintenance_inventory()==maintenance)
 baseline={'composeEnvironmentProof':composeproof,'maintenanceInventory':maintenance,'head':BASE,'runtime':before,'configuration':config,'environmentSHA256':envhash,'preexistingFourDirty':dirty,'postgres':pg,'legacy':legacy,'uploads':uploads,'startupChecks':checks,'startupSafetyPassed':eligible,'sourceProof':proof};OPS.L.private_write(OUT/'baseline.private.json',enc(baseline))
 result.update(backupComplete=True,consistentExportedPostgresSnapshot=True,sequenceStatesIndependentlyBracketedNotMVCC=True,legacyPortableSQLiteCount=len(legacy['sqlite']),uploadsFileCount=sum(not r['directory']for r in uploads),allNonQuoteContainersUnchanged=True,fourPreexistingChangesPreserved=True,privateEnvironmentBackedUp=True,targetMaintenanceInitiallyCleared=True,maintenanceInventoryUnchanged=True,actualRuntimeSourceFilesMatchBase=True,composeRuntimeLiteralAndSerializedEnvironmentProven=True,success=eligible)

def main():
 global OPS,READONLY
 need(len(sys.argv)==2 and sys.argv[1]=='backup'and BACKUP_PIN and os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_ATTEMPT')=='1')
 os.umask(0o077);OPS=load('release-data-ops-library.py');OPS.L=OPS.load_library(pathlib.Path(__file__).with_name('release-data-library.py'));OPS.SCHEMAS=('internal_quote',);READONLY=load('internal-quote-readonly-library.py');OUT.mkdir(mode=0o700);OPS.run=run;READONLY.run=run
 def stop(*_):need(False)
 signal.signal(signal.SIGTERM,stop)
 result={'mode':'backup','success':False,'backupComplete':False,'base':BASE,'targetPinFrozen':False,'businessWritesPerformed':False,'credentialsOrConfigurationChanged':False,'otherServicesRequested':False,'secretOrRowsPrinted':False}
 try:backup(result)
 except BaseException:result['failedStage']=STAGE
 finally:
  OPS.L.private_write(OUT/'first-result.json',enc(result));OPS.L.seal(OUT);print(enc(dict(result,manifestSHA256=OPS.L.file_hash(OUT/'manifest.json'),resultSHA256=OPS.L.file_hash(OUT/'first-result.json'))).decode(),flush=True)
 return 0 if result['success']else 1
if __name__=='__main__':
 try:exit_code=main()
 except BaseException:print('{"success":false,"safeFailure":"INTERNAL_QUOTE_RELEASE_PREFLIGHT_FAILED"}',flush=True);exit_code=1
 sys.exit(exit_code)
