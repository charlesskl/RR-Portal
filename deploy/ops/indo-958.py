"""Fixed indo-shipping backup first. Draft; no deployment or live business API."""
import hashlib,importlib.util,json,os,pathlib,re,shutil,signal,sqlite3,stat,subprocess,sys,urllib.parse
ROOT=pathlib.Path('/opt/rr-portal');APP=ROOT/'apps/印尼小组/印尼走货明细';BASE='6eece9ec6802533c077dd53d46e89902ffb4e90f'
BRANCH='refs/heads/ops/indo-shipping-958-20261020';BACKUP_PIN=True;DEPLOY_PIN=False;VERIFY_PIN=False;TARGET='';TARGET_TREE='';REVIEWED_FILES={}
OUT=ROOT/'deploy/backups/indo-shipping-958-20261020-backup'
DEPENDENCIES={'release-data-library.py':'d63168fd3057f4f2aba2d93f9fab31d2d65c6dd0f3234877d71fcff1e04e62b9','indo-958-readonly.py':'b95338017bb0ae5d4ff18dc758b0c395796e0b6165f5868b0e7900b50ff933d3','indo-pdb-library.py':'cf66f655a1e166491c4da67da0824f42ac8cdae3f844044cb5d8f7233ba105c5'}
STAGE='preflight';COUNTER=0;L=None;READONLY=None
APP_PREFIX='apps/印尼小组/印尼走货明细/'
FIXED=('docker-compose.cloud.yml','deploy/service-maintenance.sh',APP_PREFIX+'Dockerfile',APP_PREFIX+'.dockerignore')
PG_SHELL='exec psql -X -q -At -v ON_ERROR_STOP=1 -U "${POSTGRES_USER:-rrportal}" -d "${POSTGRES_DB:-rrportal}"'

def need(v):
 if not v:raise RuntimeError('INDO_SHIPPING_RELEASE_REJECTED')
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
  if role=='indo-shipping':need(app is None);app=(r,row)
  else:need(cid not in others);others[cid]=row
  if role=='db':need(db is None);db=r
 need(app is not None and db is not None);r,row=app;need(row['running']is True and row['oom']is False and row['health']=='healthy'and row['mounts']==[])
 ae,de=envmap(r['Config']['Env']),envmap(db['Config']['Env']);need(ae.get('ASPNETCORE_ENVIRONMENT')=='Production'and(ae.get('DB_NAME')or'rrportal')==(de.get('POSTGRES_DB')or'rrportal')and(ae.get('DB_USER')or'rrportal')==(de.get('POSTGRES_USER')or'rrportal')and ae.get('DB_PASSWORD')is not None and bool(ae.get('INDO_SHIPPING_JWT_KEY_B64'))and bool(ae.get('INDO_SHIPPING_ADMIN_PASSWORD_B64'))and(ae.get('DB_SCHEMA')or'indo_shipping')=='indo_shipping'and not ae.get('SEED_FILE'))
 pm=envmap(run(['docker','exec',r['Id'],'cat','/proc/1/environ']).decode().strip('\0').split('\0'));need(r['Config'].get('Hostname')==r['Id'][:12]and pm.pop('HOSTNAME',None)==r['Config']['Hostname']);row['processEnvironmentWithoutAutomaticHostnameSHA256']=sha(enc(pm))
 return {'app':row,'others':others,'databaseContainer':db['Id']},r

def dirty_snapshot(save=False):
 run(['git','diff','--cached','--quiet','--no-ext-diff','--no-textconv','--ignore-submodules=none']);names=run(['git','diff','--name-only','-z','--no-ext-diff','--no-textconv','--ignore-submodules=none']).decode().strip('\0').split('\0');need(len(names)==len(set(names))==4);rows={}
 for i,n in enumerate(sorted(names)):
  need(L.safe_path(n)and not any(n==p or n.startswith(p+'/')for p in (APP_PREFIX.rstrip('/'),'apps/船务部','apps/工程部/3D打印协同平台'))and n not in FIXED)
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
  if save:L.private_write(OUT/('dirty-%02d.private'%i),content)
 need(sum(v.get('bytes',0)for v in rows.values())<=16*1024**2);return rows

def source():
 need(run(['git','symbolic-ref','--quiet','HEAD']).decode().strip()=='refs/heads/main'and run(['git','rev-parse','HEAD']).decode().strip()==BASE)
 need(run(['git','ls-files','--others','--exclude-standard','-z','--',APP_PREFIX])==b'')
 for name in FIXED:
  p=ROOT/name;need(p.is_file()and not p.is_symlink()and p.read_bytes()==run(['git','show',BASE+':'+name]))
 return {n:L.file_hash(ROOT/n)for n in FIXED}

def startup(cid,db):
 value=READONLY.startup_guard(cid,db);return value,all(value.values()),[code for code,v in value.items()if not v]

def serialized_environment(literal):
 need(type(literal)is dict and all(type(k)is str and re.fullmatch('[A-Za-z_][A-Za-z0-9_]*',k)and type(v)is str for k,v in literal.items()));return{k:v.replace('$','$$')for k,v in literal.items()}

def literal_explicit_environment(actual,defaults,declared):
 need(type(actual)is dict and type(defaults)is dict and type(declared)is dict and all(type(k)is str and re.fullmatch('[A-Za-z_][A-Za-z0-9_]*',k)and type(v)is str for mapping in(actual,defaults,declared)for k,v in mapping.items())and set(declared)<=set(actual));literal={k:actual[k]for k in declared};need(declared==serialized_environment(literal));expected=dict(defaults);expected.update(literal);need(expected==actual);return literal

def compose_environment(app,image):
 global STAGE
 STAGE='installed-compose-version';need(run(['docker','compose','version','--short']).decode().strip()=='5.1.0')
 STAGE='compose-config-forward-serialized-environment';command=['docker','compose','-p','rr-portal','-f',str(ROOT/'docker-compose.cloud.yml'),'--env-file',str(ROOT/'.env.cloud.production'),'config','--format','json'];configuration=json.loads(run(command,timeout=90));need(type(configuration)is dict and type(configuration.get('services'))is dict and type(configuration['services'].get('indo-shipping'))is dict);declared=configuration['services']['indo-shipping'].get('environment',{});need(image['Id']==app['Image']);literal=literal_explicit_environment(envmap(app['Config']['Env']),envmap(image['Config'].get('Env')or[]),declared);L.private_write(OUT/'compose-environment.private.json',enc(declared));L.private_write(OUT/'literal-compose-environment.private.json',enc(literal));return {'composeVersion':'5.1.0','serializedExplicitEnvironmentSHA256':sha(enc(declared)),'literalExplicitEnvironmentSHA256':sha(enc(literal)),'forwardSerializedLiteralEqualsComposeJSON':True,'literalExplicitAndImageDefaultsEqualRuntime':True}

def maintenance_inventory():
 p=ROOT/'deploy/maintenance';need(p.is_dir()and not p.is_symlink());target=p/'services/indo-shipping';need(not target.exists()and not target.is_symlink());return L.non_database_inventory(p,[])

def backup(result):
 global STAGE
 STAGE='source-and-fixed-configuration';config=source()
 STAGE='four-preexisting-tracked-changes';dirty=dirty_snapshot(True)
 STAGE='target-maintenance-cleared-and-flags';maintenance=maintenance_inventory()
 STAGE='private-environment-file';env=ROOT/'.env.cloud.production';need(env.is_file()and not env.is_symlink()and env.stat().st_size<=4*1024**2);envhash=L.file_hash(env);L.private_write(OUT/'environment.private',env.read_bytes())
 STAGE='current-runtime-and-storage';before,app=runtime();L.private_write(OUT/'app-inspect.private.json',enc(app));image=json.loads(run(['docker','image','inspect',before['app']['image']]));need(len(image)==1 and image[0]['Id']==before['app']['image']);L.private_write(OUT/'app-image.private.json',enc(image[0]))
 STAGE='compose-runtime-environment-preflight';composeproof=compose_environment(app,image[0])
 STAGE='startup-preflight';checks,eligible,failed=startup(before['app']['id'],before['databaseContainer']);result.update(startupSafetyPassed=eligible,startupSafetyFailedChecks=failed)
 size=int(run(['docker','exec','-i',before['databaseContainer'],'sh','-c',PG_SHELL],b"BEGIN READ ONLY; SELECT COALESCE(sum(pg_total_relation_size(c.oid)),0) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='indo_shipping'; COMMIT;\n",45));need(size>=0 and shutil.disk_usage(OUT).free>2*size+1024**3)
 STAGE='exported-indo-snapshot-and-complete-dump';pg=READONLY.pg_capture(before['databaseContainer'],OUT,True)['indo_shipping']
 STAGE='actual-dll-pdb-and-complete-source-proof';documents=READONLY.source_documents(BASE);proof=READONLY.backend_proof(before['app']['id'],documents)
 STAGE='actual-frontend-and-denied-boundary';frontend=READONLY.frontend_proof(before['app']['id'])
 STAGE='final-stability';after,_=runtime();need(before==after and dirty_snapshot()==dirty and source()==config and L.file_hash(env)==envhash and maintenance_inventory()==maintenance)
 baseline={'composeEnvironmentProof':composeproof,'maintenanceInventory':maintenance,'head':BASE,'runtime':before,'configuration':config,'environmentSHA256':envhash,'preexistingFourDirty':dirty,'postgres':pg,'startupChecks':checks,'startupSafetyPassed':eligible,'backendSourceProof':proof,'runtimeDocuments':documents,'frontend':frontend};L.private_write(OUT/'baseline.private.json',enc(baseline))
 result.update(backupComplete=True,consistentExportedPostgresSnapshot=True,sequenceStatesIndependentlyBracketedNotMVCC=True,allBusinessRowsAndDatabaseImagesIncluded=True,noPersistentRuntimeMounts=True,allNonIndoContainersUnchanged=True,fourPreexistingChangesPreserved=True,privateEnvironmentBackedUp=True,targetMaintenanceInitiallyCleared=True,maintenanceInventoryUnchanged=True,actualDllPdbDocumentsMatchBase=True,actualFrontendPublicBytesMatchContainer=True,composeRuntimeLiteralAndSerializedEnvironmentProven=True,success=eligible)

def main():
 global L,READONLY
 need(len(sys.argv)==2 and sys.argv[1]=='backup'and BACKUP_PIN and os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_ATTEMPT')=='1')
 os.umask(0o077);L=load('release-data-library.py');READONLY=load('indo-958-readonly.py');OUT.mkdir(mode=0o700);READONLY.run=run
 def stop(*_):need(False)
 signal.signal(signal.SIGTERM,stop)
 result={'mode':'backup','success':False,'backupComplete':False,'base':BASE,'targetPinFrozen':False,'businessWritesPerformed':False,'credentialsOrConfigurationChanged':False,'otherServicesRequested':False,'secretOrRowsPrinted':False}
 try:backup(result)
 except BaseException:result['failedStage']=STAGE
 finally:
  L.private_write(OUT/'first-result.json',enc(result));L.seal(OUT);print(enc(dict(result,manifestSHA256=L.file_hash(OUT/'manifest.json'),resultSHA256=L.file_hash(OUT/'first-result.json'))).decode(),flush=True)
 return 0 if result['success']else 1
if __name__=='__main__':
 try:exit_code=main()
 except BaseException:print('{"success":false,"safeFailure":"INDO_SHIPPING_RELEASE_PREFLIGHT_FAILED"}',flush=True);exit_code=1
 sys.exit(exit_code)
