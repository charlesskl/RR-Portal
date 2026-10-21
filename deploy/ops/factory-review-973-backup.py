"""PR973 factory-review backup only. Draft; all execution gates default off."""
import io,tarfile,hashlib,importlib.util,json,os,pathlib,re,shutil,signal,stat,subprocess,sys
ROOT=pathlib.Path('/opt/rr-portal');APP=ROOT/'apps/PMC跟仓管/加工厂月度评审管理制度';BASE='6fc1143c0b39470d814caac553beaaf3bc2912e0'
BRANCH='refs/heads/ops/factory-review-973-20261021';BACKUP_PIN=True;DEPLOY_PIN=False;VERIFY_PIN=False;TARGET='';TARGET_TREE='';REVIEWED_FILES={}
OUT=ROOT/'deploy/backups/factory-review-973-20261021-backup'
DEPENDENCIES={'release-data-ops-library.py':'ff9138a1d5bfed1b10077112da6ebcda2d65240f583e2d0e12ce1325cfbaafd5','release-data-library.py':'d63168fd3057f4f2aba2d93f9fab31d2d65c6dd0f3234877d71fcff1e04e62b9'}
STAGE='preflight';COUNTER=0;OPS=None
APP_PREFIX='apps/PMC跟仓管/加工厂月度评审管理制度/'
SERVICES={'factory-review':'pb_data','factory-review-test':'pb_data_test'}
FIXED=('docker-compose.cloud.yml','deploy/service-maintenance.sh',APP_PREFIX+'Dockerfile',APP_PREFIX+'.dockerignore')

def need(v):
 if not v:raise RuntimeError('FACTORY_REVIEW_973_REJECTED')
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
 ids=run(['docker','ps','-aq','--no-trunc']).decode().split();need(0<len(ids)<=1000 and len(ids)==len(set(ids))and all(re.fullmatch('[a-f0-9]{64}',v)for v in ids));records=json.loads(run(['docker','inspect',*ids]));need(type(records)is list and len(records)==len(ids));others={};targets={};raw={}
 for r in records:
  cid=r['Id'];need(cid in ids and cid not in raw);raw[cid]=r;labels=r.get('Config',{}).get('Labels')or{};service=labels.get('com.docker.compose.service');role=service if labels.get('com.docker.compose.project')=='rr-portal'else None
  row={'id':cid,'image':r['Image'],'started':r['State'].get('StartedAt'),'running':r['State']['Running'],'oom':r['State']['OOMKilled'],'restarts':r['RestartCount'],'health':r['State'].get('Health',{}).get('Status'),'environmentMapSHA256':sha(enc(envmap(r['Config']['Env']))),'mounts':sorted(r.get('Mounts',[]),key=enc),'memory':r['HostConfig'].get('Memory'),'swap':r['HostConfig'].get('MemorySwap'),'healthcheck':r['Config'].get('Healthcheck'),'command':r['Config'].get('Cmd'),'entrypoint':r['Config'].get('Entrypoint'),'user':r['Config'].get('User'),'workingDirectory':r['Config'].get('WorkingDir'),'configSHA256':sha(enc(dict(r['Config'],Env=sorted(r['Config']['Env'])))),'hostConfigSHA256':sha(enc(r['HostConfig']))}
  if role not in SERVICES:others[cid]=row;continue
  need(role not in targets and row['running']is True and row['oom']is False and row['health']=='healthy'and row['memory']==row['swap']==512*1024**2)
  matches=[m for m in row['mounts']if m.get('Destination')=='/pb/pb_data'];need(len(matches)==1 and matches[0].get('Type')=='bind'and matches[0].get('Source')==str(APP/SERVICES[role])and matches[0].get('RW')is True)
  need(row['command']==['/pb/pocketbase','serve','--http=0.0.0.0:8090','--dir=/pb/pb_data','--publicDir=/pb/pb_public','--migrationsDir=/pb/pb_migrations','--hooksDir=/pb/pb_hooks'])
  proc=run(['docker','exec',cid,'cat','/proc/1/environ']);need(proc.endswith(b'\0'));pm=envmap([v.decode()for v in proc.split(b'\0')if v]);need(r['Config'].get('Hostname')==cid[:12]and pm.pop('HOSTNAME',None)==cid[:12]);row['processEnvironmentWithoutAutomaticHostnameSHA256']=sha(enc(pm));targets[role]=row
 need(set(targets)==set(SERVICES));return {'targets':targets,'others':others},{k:raw[v['id']]for k,v in targets.items()}

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
 run(['git','diff','--quiet','--no-ext-diff','--no-textconv','--ignore-submodules=none','--',APP_PREFIX])
 for name in FIXED:
  p=ROOT/name;need(p.is_file()and not p.is_symlink()and p.read_bytes()==run(['git','show',BASE+':'+name]))
 return {n:OPS.L.file_hash(ROOT/n)for n in FIXED}

def runtime_files(service,row):
 image=json.loads(run(['docker','image','inspect',row['image']]));need(type(image)is list and len(image)==1 and image[0]['Id']==row['image']);revision=(image[0].get('Config',{}).get('Labels')or{}).get('org.opencontainers.image.revision');need(type(revision)is str and re.fullmatch('[a-f0-9]{40}',revision))
 need(run(['git','rev-parse',revision+':'+APP_PREFIX.rstrip('/')])==run(['git','rev-parse',BASE+':'+APP_PREFIX.rstrip('/')]))
 OPS.L.private_write(OUT/(service+'-image.private.json'),enc(image[0]));blob=run(['docker','exec',row['id'],'tar','-C','/pb','-cf','-','pb_hooks','pb_migrations','pb_public']);found={};total=0
 with tarfile.open(fileobj=io.BytesIO(blob),mode='r:')as tar:
  for member in tar:
   name=member.name.rstrip('/');need(OPS.L.safe_path(name)and name.split('/')[0]in {'pb_hooks','pb_migrations','pb_public'}and(member.isdir()or member.isfile())and name not in found)
   if member.isdir():continue
   total+=member.size;need(total<=32*1024**2 and member.size<=16*1024**2);content=tar.extractfile(member).read();need(len(content)==member.size);found[name]={'bytes':member.size,'sha256':sha(content)}
   if name=='pb_public/index.html':OPS.L.private_write(OUT/(service+'-index.private.html'),content)
 expected=run(['git','ls-tree','-r','--name-only','-z',BASE,'--',APP_PREFIX+'pb_hooks',APP_PREFIX+'pb_migrations']).decode().strip('\0').split('\0');expected={n[len(APP_PREFIX):]:sha(run(['git','show',BASE+':'+n]))for n in expected};actual={n:v['sha256']for n,v in found.items()if not n.startswith('pb_public/')};need(actual==expected and 'pb_public/index.html'in found and any(n.startswith('pb_public/assets/')for n in found));need(OPS.L.file_hash(OUT/(service+'-index.private.html'))==found['pb_public/index.html']['sha256'])
 return {'ociRevision':revision,'applicationTree':run(['git','rev-parse',BASE+':'+APP_PREFIX.rstrip('/')]).decode().strip(),'hooksAndMigrationsMatchBase':True,'files':found}

def file_metadata(path):
 need(path.is_file()and not path.is_symlink());value=path.stat();return {'mode':stat.S_IMODE(value.st_mode),'uid':value.st_uid,'gid':value.st_gid}

def capture_compose_and_runtime_environment(raw):
 args=['docker','compose','-p','rr-portal','-f',str(ROOT/'docker-compose.cloud.yml'),'--env-file',str(ROOT/'.env.cloud.production'),'config','--format','json'];rendered=json.loads(run(args));need(type(rendered)is dict and type(rendered.get('services'))is dict);OPS.L.private_write(OUT/'compose-render.private.json',enc(rendered));proof={}
 for service in SERVICES:
  actual=envmap(raw[service]['Config']['Env']);declared=rendered['services'][service].get('environment');need(type(declared)is dict and all(type(k)is str and type(v)is str for k,v in declared.items()));blob=run(['docker','exec',raw[service]['Id'],'cat','/proc/1/environ']);need(blob.endswith(b'\0'));process=envmap([value.decode()for value in blob.split(b'\0')if value]);need(process.pop('HOSTNAME',None)==raw[service]['Id'][:12]);OPS.L.private_write(OUT/(service+'-literal-configured-environment.private.json'),enc(actual));OPS.L.private_write(OUT/(service+'-literal-process-environment.private.json'),enc(process));OPS.L.private_write(OUT/(service+'-declared-compose-environment.private.json'),enc(declared));changed=sorted(k for k in declared if actual.get(k)not in {declared[k],declared[k].replace('$$','$')});proof[service]={'configuredEnvironmentKeys':sorted(actual),'declaredEnvironmentKeys':sorted(declared),'declaredActualMismatchKeys':changed,'actualConfiguredSHA256':sha(enc(actual)),'actualProcessWithoutAutomaticHostnameSHA256':sha(enc(process)),'runtimeAIConfigurationPreservedAsLiteralEvidence':all(k in actual for k in ('FACTORY_REVIEW_AI_ENABLED','FACTORY_REVIEW_AI_API_KEY','FACTORY_REVIEW_AI_MODEL','FACTORY_REVIEW_AI_BASE_URL'))};need(proof[service]['runtimeAIConfigurationPreservedAsLiteralEvidence'])
 return proof

def backup(result):
 global STAGE
 STAGE='observe-source-revision';observed=run(['git','rev-parse','HEAD']).decode().strip();need(re.fullmatch('[a-f0-9]{40}',observed));result['observedServerMainHead']=observed
 STAGE='source-and-four-dirty';config=source();dirty=dirty_snapshot(True);env=ROOT/'.env.cloud.production';need(env.is_file()and not env.is_symlink()and env.stat().st_size<=4*1024**2);envhash=OPS.L.file_hash(env);envmeta=file_metadata(env);maintenance=OPS.L.non_database_inventory(ROOT/'deploy/maintenance',[]);OPS.L.private_write(OUT/'environment.private',env.read_bytes())
 STAGE='current-runtime-and-storage';before,raw=runtime();OPS.L.private_write(OUT/'factory-inspect.private.json',enc(raw));compose_proof=capture_compose_and_runtime_environment(raw);size=sum(p.stat().st_size for rel in SERVICES.values()for p in (APP/rel).rglob('*')if p.is_file());need(shutil.disk_usage(OUT).free>2*size+1024**3);databases={};proof={}
 for service,rel in SERVICES.items():
  STAGE=service+'-wal-consistent-backup';databases[service]=OPS.sqlite_capture(service,APP/rel,OUT/service);need(set(databases[service]['sqlite'])=={'data.db','auxiliary.db'});databases[service]['databaseFileMetadata']={name:file_metadata(APP/rel/name)for name in ('data.db','auxiliary.db')}
  STAGE=service+'-runtime-source-proof';proof[service]=runtime_files(service,before['targets'][service])
 STAGE='final-stability';after,_=runtime();need(before==after and dirty_snapshot()==dirty and source()==config and OPS.L.file_hash(env)==envhash and file_metadata(env)==envmeta and OPS.L.non_database_inventory(ROOT/'deploy/maintenance',[])==maintenance)
 for service,rel in SERVICES.items():need(OPS.L.non_database_inventory(APP/rel,['data.db','auxiliary.db'])==databases[service]['files'] and {name:file_metadata(APP/rel/name)for name in ('data.db','auxiliary.db')}==databases[service]['databaseFileMetadata'])
 baseline={'head':BASE,'composeEnvironmentProof':compose_proof,'environmentFileMetadata':envmeta,'maintenanceInventory':maintenance,'runtime':before,'configuration':config,'environmentSHA256':envhash,'preexistingFourDirty':dirty,'pocketbase':databases,'sourceProof':proof};OPS.L.private_write(OUT/'baseline.private.json',enc(baseline))
 result.update(backupComplete=True,portableSQLiteCount=sum(len(v['sqlite'])for v in databases.values()),allOtherStorageFilesArchivedAndVerified=True,allNonFactoryContainersUnchanged=True,fourPreexistingChangesPreserved=True,privateEnvironmentBackedUp=True,actualHooksAndMigrationsMatchBase=True,actualOCIApplicationTreesMatchBase=True,databaseSnapshotsIndividuallyConsistentNotCrossDatabaseAtomic=True,healthOrBusinessHTTPRequestsPerformed=False,success=True)

def main():
 global OPS
 need(len(sys.argv)==2 and sys.argv[1]=='backup'and BACKUP_PIN and os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_ATTEMPT')=='1')
 os.umask(0o077);OPS=load('release-data-ops-library.py');OPS.L=OPS.load_library(pathlib.Path(__file__).with_name('release-data-library.py'));OUT.mkdir(mode=0o700);OPS.run=run
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
 except BaseException:print('{"success":false,"safeFailure":"FACTORY_REVIEW_973_PREFLIGHT_FAILED"}',flush=True);exit_code=1
 sys.exit(exit_code)
