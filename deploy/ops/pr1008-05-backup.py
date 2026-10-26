"""PR1008 fresh05 PrintLink-only backup after original access restoration. Draft: execution gate is false. One named volume, 2 SQLite databases, 45 other containers protected.

The server Git checkout is already the reviewed merge bb1fab; the running old image
and all Docker COPY bytes remain BASE37. These identities are reported separately.
Only filesystem copies, SQLite read transactions and read-only container execs.
No HTTP, model calls, signals, maintenance changes or mail access. No PostgreSQL access.
SQLite copies are individually consistent, never cross-database atomic.
"""
import contextlib,datetime,hashlib,importlib.util,io,json,os,pathlib,re,shutil,signal,stat,subprocess,sys,tarfile,traceback

ROOT=pathlib.Path('/opt/rr-portal')
BASE='37b6146354f692dfabc8b009f6c5b80ced091bdb'
BASE_TREE='2ae9b60d6aa627005d5937298fa84386b3572054'
SERVER_HEAD='bb1fab660bdf4e04e828e4c4250279f717603ac5'
SERVER_TREE='72baeafdefab7f2abf01be09f941f31ec8b623fa'
ORIGINAL_IMAGE='sha256:5d48e2e4e4557988e56fb3e27d28c38eab98410244783e31d169466b0fb476f4'
BRANCH='refs/heads/ops/pr-1008-20261026-02'
BACKUP_PIN=True
OUT=ROOT/'deploy/backups/pr-1008-20261026-05-backup'
PRINT='apps/工程部/3D打印协同平台'
APPS=(PRINT,)
ORDER=('printlink',)
SERVICES=set(ORDER)
STORAGE={'printlink':('/var/lib/docker/volumes/rr-portal_printlink-data/_data','/app/runtime')}
EXPECTED_ROOTS={s:[value] for s,value in STORAGE.items()}
FIXED=('docker-compose.cloud.yml','nginx/nginx.cloud.conf','deploy/update-server.sh','deploy/service-maintenance.sh','.github/workflows/deploy.yml','.env.example',PRINT+'/Dockerfile',PRINT+'/.dockerignore',PRINT+'/package.json')
DEPS={'factory-review-backup-library.py':'79d76bb47312dd08c121ebe2797f54d958666f8b72d00721f67712b152fc4666','release-data-ops-library.py':'ff9138a1d5bfed1b10077112da6ebcda2d65240f583e2d0e12ce1325cfbaafd5','release-data-library.py':'d63168fd3057f4f2aba2d93f9fab31d2d65c6dd0f3234877d71fcff1e04e62b9'}
F=None;STAGE='entrypoint';RUNTIME_SERIAL=0;CONFIGURATION_ARCHIVE=OUT

def need(v,label):
 global STAGE
 if not v:STAGE=label;raise RuntimeError('PR1008_BACKUP_REJECTED')
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
 F=load('factory-review-backup-library.py');need(F.BACKUP_PIN is False and F.DEPLOY_PIN is False and F.VERIFY_PIN is False,'inert-factory-library');F.BASE=BASE;F.ROOT=ROOT;F.APP=ROOT/PRINT;F.OUT=OUT;F.OPS=load('release-data-ops-library.py');F.OPS.L=load('release-data-library.py');F.OPS.L.databases=F.OPS.database_names;F.OPS.run=F.run;F.OPS.ROOT=ROOT;F.OPS.SCHEMAS=()

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
def child_environments(cid):
 script="""const fs=require('fs'),path=require('path');const out={};for(const pid of fs.readdirSync('/proc').filter(x=>/^[0-9]+$/.test(x))){try{const a=fs.readFileSync('/proc/'+pid+'/cmdline').toString().split('\\0').filter(Boolean);const key=a.length===2&&a[0]===process.execPath&&{'cloud/server.mjs':'cloud','production/server.js':'production'}[a[1]];if(!key)continue;const cwd=fs.readlinkSync('/proc/'+pid+'/cwd');if(cwd!=='/app'||path.resolve(cwd,a[1])!==({cloud:'/app/cloud/server.mjs',production:'/app/production/server.js'}[key]))throw Error('child cwd or argv');if(out[key])throw Error('duplicate app child');out[key]=Object.fromEntries(fs.readFileSync('/proc/'+pid+'/environ').toString().split('\\0').filter(Boolean).map(x=>{const i=x.indexOf('=');if(i<1)throw Error('env');return[x.slice(0,i),x.slice(i+1)]}));}catch(e){if(!['ENOENT','ESRCH'].includes(e.code))throw e}}process.stdout.write(JSON.stringify(out));"""
 result=json.loads(run(['docker','exec',cid,'node','-e',script]));need(type(result)is dict and set(result)=={'cloud','production'},'exact-two-running-app-children');base=process_environment(cid);base['HOSTNAME']=cid[:12];root=pathlib.Path(STORAGE['printlink'][0]);p=root/'secrets.json';need(p.is_file()and not p.is_symlink(),'existing-persistent-secrets-no-regeneration');secrets=json.loads(p.read_bytes());need(type(secrets)is dict and set(secrets)=={'internal','collector'}and all(type(v)is str and re.fullmatch('[a-f0-9]{64}',v)for v in secrets.values()),'existing-persistent-secret-shape');expected=dict(base,PORT=base.get('PORT')or'3100',PRODUCTION_PORT=base.get('PRODUCTION_PORT')or'3102',DATA_DIR='/app/runtime/orders',PRODUCTION_SOURCE='/app/runtime/production-source.json',PRODUCTION_DB='/app/runtime/production.sqlite',PRODUCT_FILES_DIR='/app/runtime/product-files',INTERNAL_TOKEN=secrets['internal'],COLLECTOR_TOKEN=secrets['collector']);station=root/'stations.json'
 if station.exists():need(station.is_file()and not station.is_symlink(),'regular-existing-station-config');expected['COLLECTOR_STATIONS']=station.read_text()
 need(result=={'cloud':expected,'production':expected},'all-child-environment-values-exact-pid1-plus-existing-secret-and-station-file');return{'bothCompleteEnvironmentsMatchExistingStartMjs':True,'environmentSHA256':sha(enc(expected))}

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
   mounts=[m for m in r['Mounts']if m['Destination']==destination];need(len(mounts)==1 and mounts[0]['Type']=='volume'and mounts[0].get('Name')=='rr-portal_printlink-data'and mounts[0]['Source']==source and mounts[0]['RW']is True,'exact-service-persistent-mount')
  need(r['Config'].get('Hostname')==cid[:12],'automatic-config-hostname')
  if row['running']:
   row['processEnvironmentWithoutAutomaticHostnameSHA256']=sha(enc(process_environment(cid)));row['childEnvironmentContractSHA256']=sha(enc(child_environments(cid)))
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
  need(F.OPS.L.safe_path(n)and n not in FIXED and not any(n==a or n.startswith(a+'/')for a in APPS),'dirty-outside-printlink-app-and-fixed-configuration');entry=run(['git','ls-tree','-z',BASE,'--',n]);need(re.fullmatch(b'100(?:644|755) blob [a-f0-9]{40}\t'+re.escape(n.encode())+b'\0',entry)is not None,'dirty-original-regular-file');p=ROOT/n
  for parent in(p,*p.parents):
   if parent==ROOT:break
   need(not parent.is_symlink(),'dirty-no-symlink-ancestors')
  if not p.exists():rows[n]={'kind':'absent'};continue
  need(p.is_file(),'dirty-regular-file');before=p.lstat();data=p.read_bytes();after=p.lstat();need((before.st_dev,before.st_ino,before.st_mode,before.st_uid,before.st_gid,before.st_size,before.st_mtime_ns,before.st_ctime_ns)==(after.st_dev,after.st_ino,after.st_mode,after.st_uid,after.st_gid,after.st_size,after.st_mtime_ns,after.st_ctime_ns)and len(data)<=8*1024**2,'stable-bounded-dirty-file');rows[n]=dict(meta(p),kind='regular',bytes=len(data),sha256=sha(data))
  if save:private('dirty-%02d.private'%i,data)
 return rows
def source(revision=SERVER_HEAD):
 need(run(['git','symbolic-ref','--quiet','HEAD']).decode().strip()=='refs/heads/main'and run(['git','rev-parse','HEAD']).decode().strip()==revision,'exact-canonical-main');run(['git','diff','--quiet','--no-ext-diff','--no-textconv','--ignore-submodules=none','--',*APPS]);result={}
 for n in FIXED:
  p=ROOT/n;need(p.is_file()and not p.is_symlink()and p.read_bytes()==run(['git','show',BASE+':'+n]),'fixed-source-global-config-preserved');result[n]={'sha256':F.OPS.L.file_hash(p),**meta(p)}
 return result

def copy_paths(revision):
 raw=run(['git','ls-tree','-r','-z',revision,'--',PRINT]);entries={}
 for item in raw.rstrip(b'\0').split(b'\0'):
  mode,name=item.split(b'\t',1);n=name.decode();need(re.fullmatch(b'100(?:644|755) blob [a-f0-9]{40}',mode)is not None and n.startswith(PRINT+'/'),'regular-tracked-printlink-files');relative=n[len(PRINT)+1:]
  if relative in{'package.json','start.mjs'}or(relative.startswith(('cloud/','production/','ops/','shared/'))and not relative.startswith('production/tests/')and not relative.endswith('.log')):entries[relative]={'sha256':sha(run(['git','show',revision+':'+n])),'mode':int(mode[:6],8)&0o777}
 need(entries and{'package.json','start.mjs','cloud/server.mjs','production/server.js','ops/lock.mjs','ops/healthcheck.mjs'}<=set(entries),'all-printlink-docker-copy-roots');return entries

def application_proof(service,row,revision,image=None):
 need(service=='printlink','only-printlink-source-proof');expected=copy_paths(revision);blob=run(['docker','exec',row['id'],'tar','-C','/app','-cf','-','package.json','start.mjs','cloud','production','ops','shared']);found={};total=0
 with tarfile.open(fileobj=io.BytesIO(blob),mode='r:')as archive:
  for m in archive:
   n=m.name.rstrip('/');need(F.OPS.L.safe_path(n)and(m.isdir()or m.isfile()),'safe-regular-printlink-container-source')
   if m.isdir():continue
   need(n in expected and n not in found and m.size<=32*1024**2,'exact-tracked-only-docker-copy-files');total+=m.size;need(total<=128*1024**2,'bounded-full-printlink-source');data=archive.extractfile(m).read();need(len(data)==m.size,'complete-printlink-source');found[n]={'sha256':sha(data),'mode':m.mode&0o777}
 need(found==expected,'all-printlink-docker-copy-bytes-mode-match-base');images=json.loads(run(['docker','image','inspect',row['image']]));need(len(images)==1 and images[0]['Id']==row['image'],'immutable-printlink-original-image');private(service+'-image.private.json',images[0]);return{'files':found,'allDockerCopyBytesAndModesMatchBase':True,'applicationTree':run(['git','rev-parse',revision+':'+PRINT]).decode().strip()}

def capture(service,label):
 need(service in ORDER and re.fullmatch('[A-Za-z0-9_.-]{1,100}',label or'')is not None,'fixed-printlink-capture-service-label');tree=ROOT/STORAGE[service][0];dest=OUT/(service+'-'+label);names=F.OPS.database_names(tree);before=ownership(tree,names);value=F.OPS.sqlite_capture(service,tree,dest);need(set(value['sqlite'])==set(names)=={'orders/printlink.sqlite','production.sqlite'},'exact-two-printlink-databases');value.update(metadata=db_metadata(tree,names),fileOwnership=ownership(tree,names),databaseFamilyMetadata=db_family_metadata(tree,names),observedUTC=datetime.datetime.now(datetime.timezone.utc).isoformat());need(value['fileOwnership']==before and F.OPS.L.non_database_inventory(tree,names)==value['files'],'stable-captured-files-and-mode-owners');private(service+'-'+label+'.private.json',value);return value,dest

def startup_guard(service,value,dest):
 need(service=='printlink'and set(value['sqlite'])=={'orders/printlink.sqlite','production.sqlite'},'only-two-existing-printlink-databases');literal=read(CONFIGURATION_ARCHIVE/(service+'-literal-configured-environment.private.json'));need(literal.get('PLATFORM_DATA_DIR')=='/app/runtime'and literal.get('APP_MODE')=='production'and literal.get('PORT')=='3100'and literal.get('HOST')=='0.0.0.0','production-printlink-runtime-path-and-no-demo-mode');now=datetime.datetime.now(datetime.timezone.utc);cutoff=(now+datetime.timedelta(hours=2)-datetime.timedelta(hours=24)).isoformat(timespec='milliseconds').replace('+00:00','Z');facts={'guardObservedUTC':now.isoformat(),'expiredUploadSafetyCutoffUTC':cutoff}
 cloud_tables={'users','sessions','orders','files','events','feedback','metadata','account_events','production_jobs','collector_events','collector_devices','collector_stations'};production_tables={'snapshot','source_inventory_config','source_inventory_ledger','data_images','business_sync_state','business_sync_backups','authority_state','authority_commands','authority_backups'}
 with contextlib.closing(F.OPS.L.connect(dest/'sqlite/orders/printlink.sqlite',True))as db:
  need(cloud_tables<={r[0]for r in db.execute("SELECT name FROM sqlite_schema WHERE type='table'")},'all-unchanged-cloud-startup-tables-exist');columns=lambda t:{r[1]for r in db.execute('PRAGMA table_xinfo('+F.OPS.L.quote(t)+')')};need('factory_scope'in columns('users')and{'sync_error','item_id','authority_revision'}<=columns('production_jobs'),'all-cloud-add-column-migrations-already-applied');need(db.execute('SELECT COUNT(*) FROM users').fetchone()[0]>0 and db.execute("SELECT value FROM metadata WHERE key='mode'").fetchone()==('production',),'existing-production-users-and-mode-no-seed');need(db.execute('SELECT COUNT(*) FROM files WHERE order_id IS NULL AND created < ?',(cutoff,)).fetchone()==(0,),'no-unattached-upload-gc-candidates-next-two-hours');need(db.execute('SELECT COUNT(*) FROM production_jobs WHERE synced=0').fetchone()==(0,),'no-background-unsynced-job-writer');need(db.execute("SELECT COUNT(*) FROM production_jobs j JOIN orders o ON o.id=j.order_id WHERE j.status='待质检' AND o.status IN ('打印中','待交付')").fetchone()==(0,),'no-legacy-quality-stage-migration-candidates')
 with contextlib.closing(F.OPS.L.connect(dest/'sqlite/production.sqlite',True))as db:
  need(production_tables<={r[0]for r in db.execute("SELECT name FROM sqlite_schema WHERE type='table'")},'all-unchanged-production-startup-tables-exist');row=db.execute('SELECT value FROM snapshot WHERE id=1').fetchone();need(row is not None,'existing-production-snapshot-no-seed');data=json.loads(row[0]);need(type(data)is dict and type(data.get('records',{}))is dict,'existing-production-snapshot-shape')
  for day in data.get('records',{}).values():
   need(type(day)is dict and type(day.get('items',[]))is list,'existing-record-day-shape')
   for item in day.get('items',[]):need(type(item)is dict and bool(item.get('_id'))and bool(item.get('_updatedAt')),'all-records-have-identities-and-timestamps-no-startup-migration')
  need(db.execute('SELECT COUNT(*) FROM source_inventory_config WHERE id=1').fetchone()==(1,),'existing-source-inventory-startup-config-no-seed');authority=db.execute('SELECT value FROM authority_state WHERE id=1').fetchone();state=json.loads(authority[0])if authority else{};need(type(state)is dict and('enabled'not in state or type(state['enabled'])is bool),'existing-authority-state-valid-and-preserved');facts['existingAuthorityEnabled']=state.get('enabled',False)
 facts.update(allExistingStartupGuardsPassed=True,allStartupDDLAlreadyApplied=True,allOriginalBusinessSyncAndAuthorityStatePreserved=True,noUploadGCForNextTwoHours=True,noBackgroundUnsyncedJob=True,noStartupBusinessMigration=True);return facts

def replay_snapshot(service,value,path):
 need(F.OPS.L.snapshots(path/'sqlite',immutable=True)==value['sqlite'],'all-closed-portable-typed-sqlite-audits-reproduce');F.OPS.L.verify_archive(path/'files.tar',value['files']);need(type(value['fileOwnership'])is dict and type(value['metadata'])is dict,'sealed-mode-owner-inventories');startup_guard(service,value,path)

def source_proof(service,row,revision=BASE):return application_proof(service,row,revision)

def flags():return F.OPS.L.non_database_inventory(ROOT/'deploy/maintenance',[])
def environment_stable(b):
 p=ROOT/'.env.cloud.production';need(p.is_file()and not p.is_symlink()and p.read_bytes()==(b['archive']/'environment.private').read_bytes()and meta(p)==b['environmentFileMetadata'],'full-environment-bytes-mode-owner-unchanged')
def ingress_evidence(raw):
 # Capability discovery only. No rule, route, sysctl, daemon or network changes.
 commands={'ipv4FilterAndNat':['iptables-save'],'ipv6FilterAndNat':['ip6tables-save'],'ipv4Backend':['iptables','--version'],'ipv6Backend':['ip6tables','--version'],'addresses':['ip','-j','address','show'],'ipv4Routes':['ip','-j','-4','route','show','table','all'],'ipv6Routes':['ip','-j','-6','route','show','table','all'],'listeners':['ss','-lntp'],'dockerInfo':['docker','info','--format','{{json .}}']};summary={}
 for label,args in commands.items():
  executable=shutil.which(args[0])
  if executable is None:summary[label]={'available':False,'succeeded':False};continue
  item=subprocess.run([executable,*args[1:]],stdout=subprocess.PIPE,stderr=subprocess.PIPE,cwd=ROOT,timeout=30);need(len(item.stdout)<=32*1024**2 and len(item.stderr)<=1024**2,'bounded-ingress-capability-read');private('ingress-'+label+'.stdout.private',item.stdout);private('ingress-'+label+'.stderr.private',item.stderr);summary[label]={'available':True,'succeeded':item.returncode==0,'exitCode':item.returncode,'stdoutSHA256':sha(item.stdout)}
 networks=[json.loads(line)for line in run(['docker','network','ls','--no-trunc','--format','{{json .}}']).decode().splitlines()];need(len(networks)<=100 and len({n['ID']for n in networks})==len(networks),'bounded-unique-docker-networks');details=json.loads(run(['docker','network','inspect',*[n['ID']for n in networks]]));private('ingress-all-docker-networks.private.json',details);need(len(details)==len(networks),'all-docker-network-topologies-captured')
 daemon=pathlib.Path('/etc/docker/daemon.json');daemon_summary={'exists':daemon.exists()}
 if daemon.exists():need(daemon.is_file()and not daemon.is_symlink()and daemon.stat().st_size<=1024**2,'bounded-regular-docker-daemon-config');data=daemon.read_bytes();private('ingress-docker-daemon.private.json',data);daemon_summary.update(sha256=sha(data),metadata=meta(daemon))
 sysctls={}
 for n in('net/ipv4/ip_forward','net/ipv6/conf/all/forwarding','net/ipv6/bindv6only'):
  file=pathlib.Path('/proc/sys')/n;need(file.is_file(),'readable-network-protocol-sysctl');value=file.read_bytes();need(value in{b'0\n',b'1\n',b'2\n'},'known-network-protocol-sysctl');sysctls[n]=value.decode().strip()
 private('ingress-sysctls.private.json',sysctls);summary.update(dockerNetworkCount=len(networks),daemonConfiguration=daemon_summary,publishedPortBindings=raw['printlink']['HostConfig']['PortBindings'],targetNetworkCount=len(raw['printlink']['NetworkSettings']['Networks']),configurationChangesPerformed=False);private('ingress-capabilities.private.json',summary);return{'commandsAvailable':{k:v['available']for k,v in summary.items()if type(v)is dict and'available'in v},'commandsSucceeded':{k:v['succeeded']for k,v in summary.items()if type(v)is dict and'succeeded'in v},'dockerNetworkCount':len(networks),'targetNetworkCount':summary['targetNetworkCount'],'networkOrFirewallChangesPerformed':False,'fullTopologyAndRulesStoredPrivately':True}

def backup(result):
 need(run(['git','rev-parse','HEAD^{tree}']).decode().strip()==SERVER_TREE,'exact-reviewed-server-tree-distinct-from-running-source-base');configuration=source();dirty=dirty_snapshot(True);env=ROOT/'.env.cloud.production';need(env.is_file()and not env.is_symlink()and env.stat().st_size<=4*1024**2,'bounded-private-env');private('environment.private',env.read_bytes());envmeta=meta(env);maintenance=flags();need(not any(r['path']in{'services/'+s for s in ORDER}for r in maintenance),'all-target-maintenance-initially-clear');before,raw=runtime();need(raw['printlink']['Image']==ORIGINAL_IMAGE,'exact-still-original-running-image');private('target-inspect.private.json',raw);ingress=ingress_evidence(raw);render=json.loads(run(['docker','compose','-p','rr-portal','-f',str(ROOT/'docker-compose.cloud.yml'),'--env-file',str(env),'config','--format','json']));private('compose-render.private.json',render);captured={};proof={};startup={}
 need(shutil.disk_usage(OUT).free>2*sum(p.stat().st_size for roots in EXPECTED_ROOTS.values()for source,_ in roots for p in(ROOT/source).rglob('*')if p.is_file())+1024**3,'enough-private-backup-space')
 for s in ORDER:
  actual=F.envmap(raw[s]['Config']['Env']);process=process_environment(raw[s]['Id']);image=json.loads(run(['docker','image','inspect',raw[s]['Image']]))[0];need(image['Id']==raw[s]['Image'],'original-immutable-image')
  # F.runtime_files is the sole O_EXCL writer of service-image.private.json.
  private(s+'-literal-configured-environment.private.json',actual);private(s+'-literal-process-environment.private.json',process);private(s+'-declared-compose-environment.private.json',render['services'][s].get('environment',{}));captured[s],dest=capture(s,'baseline');startup[s]=startup_guard(s,captured[s],dest);proof[s]=application_proof(s,before['targets'][s],BASE)
 after,_=runtime();need(after==before and source()==configuration and dirty_snapshot()==dirty and flags()==maintenance,'unchanged-all46-runtime-source-dirty-flags');b={'head':SERVER_HEAD,'tree':SERVER_TREE,'runningSourceBase':BASE,'runningSourceTree':BASE_TREE,'runtime':before,'configuration':configuration,'preexistingFourDirty':dirty,'maintenanceInventory':maintenance,'environmentFileMetadata':envmeta,'environmentSHA256':sha((OUT/'environment.private').read_bytes()),'storage':captured,'sourceProof':proof,'startup':startup,'ingressEvidence':ingress};environment_stable(dict(b,archive=OUT))
 for s in ORDER:
  tree=ROOT/STORAGE[s][0];names=list(captured[s]['sqlite']);need(F.OPS.L.non_database_inventory(tree,names)==captured[s]['files']and ownership(tree,names)==captured[s]['fileOwnership']and db_metadata(tree,names)==captured[s]['metadata'],'all-files-mode-owners-stable-through-backup')
 private('baseline.private.json',b);result.update(success=True,backupComplete=True,serverHead=SERVER_HEAD,serverTree=SERVER_TREE,runningSourceBase=BASE,runningSourceTree=BASE_TREE,targetContainerCount=1,otherContainerCount=45,portableSQLiteCount=2,printlinkRuntimeAllDockerCopyBytesAndModesMatchBase=True,ingressCapabilityDiscovery=ingress,allPersistentDataFilesAndOwnershipArchived=True,allOriginalTypedRowsAndSchemaCaptured=True,databaseSnapshotsIndividuallyConsistentNotCrossDatabaseAtomic=True,all46ContainersUnchanged=True,environmentFileUnchanged=True,fourExistingDirtyFilesPreserved=True)

def main():
 need(BACKUP_PIN is True and sys.argv[1:]==['backup']and os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_ATTEMPT')=='1','false-draft-or-wrong-invocation');os.umask(0o077);OUT.mkdir(mode=0o700);initialize(OUT);signal.signal(signal.SIGTERM,lambda *_:need(False,'terminated'));result={'mode':'backup','base':BASE,'target':BASE,'tree':BASE_TREE,'success':False,'backupComplete':False,'businessWritesPerformed':False,'credentialsOrConfigurationChanged':False,'containerSignalsPerformed':False,'healthOrBusinessHTTPRequestsPerformed':False,'modelCallsPerformed':False,'otherServicesRequested':False,'secretOrRowsPrinted':False}
 try:backup(result)
 except BaseException as error:result.update(success=False,failedStage=safe_stage(STAGE),factoryLibraryFailedStage=safe_stage(getattr(F,'STAGE',None)),dataOpsFailedStage=safe_stage(getattr(F.OPS,'STAGE',None)),sqliteLibraryFailedStage=safe_stage(getattr(F.OPS.L,'FAILED',None)),safeExceptionType=type(error).__name__);private('failure.private.txt',traceback.format_exc().encode())
 finally:private('first-result.json',result);F.OPS.L.seal(OUT);print(enc(dict(result,manifestSHA256=F.OPS.L.file_hash(OUT/'manifest.json'),resultSHA256=F.OPS.L.file_hash(OUT/'first-result.json'),manifestSHA256Nibbles=[int(v,16)for v in F.OPS.L.file_hash(OUT/'manifest.json')],resultSHA256Nibbles=[int(v,16)for v in F.OPS.L.file_hash(OUT/'first-result.json')])).decode(),flush=True)
 return 0 if result['success']else 1
if __name__=='__main__':
 try:sys.exit(main())
 except SystemExit:raise
 except BaseException:print('{"mode":"backup","success":false,"safeFailure":"PR1008_BACKUP_PREFLIGHT_REJECTED"}',flush=True);sys.exit(1)
