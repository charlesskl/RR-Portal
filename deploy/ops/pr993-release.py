"""PR993 qc-only release draft; phase/target/archive gates remain blank.
No environment changes, DB restore, authenticated writes or model calls.
"""
import copy,hashlib,importlib.util,io,json,os,pathlib,re,signal,stat,subprocess,sys,tarfile,traceback,urllib.error,urllib.request
PHASE='prepare'
TARGET='c5162e74833f388ff3e9cddff1c9b7de3d2723ba'
TREE='d04be0b8c89a8a8cf1d375b2a9cb30d5443d2aa3'
SOURCE_MANIFEST_SHA='f92b6906cbf49a142c83206a5adabf07ae9ac5b147051e1a1254de50624b3e24'
BASE='29254a0e90d3fe2a75f212492902aa1a00a4cba5'
BASE_TREE='ef92d7ed70394780f0389578c8cc1b2b67a167a5'
BRANCH='refs/heads/ops/pr-993-20261023'
ROOT=pathlib.Path('/opt/rr-portal')
BACKUP=ROOT/'deploy/backups/pr-993-20261023-backup'
PREPARE=BACKUP.with_name('pr-993-20261023-prepare')
DEPLOY=BACKUP.with_name('pr-993-20261023-deploy')
VERIFY=BACKUP.with_name('pr-993-20261023-verify')
BACKUP_MANIFEST='5928759e158a9dbe72660b769e02f9192d2360573a1b95362ae2f844df16f0c5';BACKUP_RESULT='e59d83eb5ca7f6911ae773782695d4f66c5f0c97143c90379065a84a74b6fd69';PREPARE_MANIFEST='';PREPARE_RESULT='';DEPLOY_MANIFEST='';DEPLOY_RESULT=''
ORDER=('qc',)
DEPS={'pr993-backup-library.py': 'efc3e1f7f92a26236f0c19fc8920cfdad2fae5f18716617071d67b9f8cdb4ad3', 'batch-host-config-library.py': 'bd1842dc6847f3e0e5c0c38374c3604791f66d1c94dc651457607dc338f38ff1', 'factory-review-backup-library.py': '79d76bb47312dd08c121ebe2797f54d958666f8b72d00721f67712b152fc4666', 'release-data-ops-library.py': 'ff9138a1d5bfed1b10077112da6ebcda2d65240f583e2d0e12ce1325cfbaafd5', 'release-data-library.py': 'd63168fd3057f4f2aba2d93f9fab31d2d65c6dd0f3234877d71fcff1e04e62b9'}
COMPOSE=['docker','compose','-p','rr-portal','-f',str(ROOT/'docker-compose.cloud.yml'),'--env-file',str(ROOT/'.env.cloud.production')]
B=None;H=None;OUT=None;ENV=None;EXPECTED_ENV=None;STAGE='entrypoint';SERIAL=0
def need(v,label):
 global STAGE
 if not v:STAGE=label;raise RuntimeError('PR993_RELEASE_REJECTED')

def enc(v):return json.dumps(v,ensure_ascii=True,sort_keys=True,separators=(',',':'),allow_nan=False).encode()

def sha(v):return hashlib.sha256(v).hexdigest()

def read(p):return json.loads(p.read_bytes())

def pin(v,length=64):return type(v)is str and re.fullmatch('[a-f0-9]{%d}'%length,v)is not None

def private(n,v):B.private(n,v)

def run(a,data=None,timeout=180):return B.run(a,data,timeout)

def operation(args,label,timeout=180,service=None):
 global SERIAL
 SERIAL+=1;environment=dict(ENV)
 if service is not None:need(service in ORDER,'own-operation-service');environment['MAINT_COMPOSE_SERVICES']=service
 with(OUT/('%03d-%s.private.log'%(SERIAL,label))).open('xb')as log:r=subprocess.run(args,stdout=log,stderr=subprocess.STDOUT,timeout=timeout,cwd=ROOT,env=environment,umask=0o022 if label=='source-fast-forward'else -1)
 need(r.returncode==0,'operation-'+label)

def load(n):
 p=pathlib.Path(__file__).with_name(n);need(pin(DEPS[n])and p.is_file()and not p.is_symlink()and sha(p.read_bytes())==DEPS[n],'frozen-dependency-pin');spec=importlib.util.spec_from_file_location(n.replace('.','_'),p);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m

def initialize():
 global B,H,ENV
 for n,h in DEPS.items():
  p=pathlib.Path(__file__).with_name(n);need(pin(h)and p.is_file()and not p.is_symlink()and sha(p.read_bytes())==h,'all-transitive-frozen-dependencies')
 B=load('pr993-backup-library.py');need(B.BACKUP_PIN is False and B.BASE==BASE and B.BASE_TREE==BASE_TREE and B.ORDER==ORDER,'inert-exact-backup-library');B.ROOT=ROOT;B.initialize(OUT);H=load('batch-host-config-library.py');ENV=dict(os.environ,COMPOSE_PROJECT_NAME='rr-portal',COMPOSE_BAKE='false',COMPOSE_PARALLEL_LIMIT='1',MAINT_FLAG_DIR=str(ROOT/'deploy/maintenance'),COMPOSE_FILE=str(ROOT/'docker-compose.cloud.yml'),ENV_FILE=str(ROOT/'.env.cloud.production'),MAINT_HEALTH_TIMEOUT_SECONDS='300',MAINT_DNS_GRACE_SECONDS='10')

def sealed(path,manifest_hash,result_hash,mode,success=True):
 need(pin(manifest_hash)and pin(result_hash)and path.is_dir()and not path.is_symlink()and stat.S_IMODE(path.stat().st_mode)==0o700,'private-phase-directory-and-pins');L=B.F.OPS.L;need(L.file_hash(path/'manifest.json')==manifest_hash and L.file_hash(path/'first-result.json')==result_hash,'exact-phase-seals');manifest=read(path/'manifest.json');entries=list(path.rglob('*'));need(type(manifest)is dict and len(entries)<=100000 and all(not p.is_symlink()and(p.is_file()or p.is_dir())and p.stat().st_mode&0o077==0 for p in entries),'all-private-regular-phase-entries');need(set(manifest)=={str(p.relative_to(path))for p in entries if p.is_file()and p!=path/'manifest.json'}and all(L.safe_path(n)and pin(h)and L.file_hash(path/n)==h for n,h in manifest.items()),'all-phase-byte-seals');r=read(path/'first-result.json');need(r.get('success')is success and r.get('mode')==mode and r.get('base')==BASE and r.get('target')==(BASE if mode=='backup'else TARGET)and r.get('tree')==(BASE_TREE if mode=='backup'else TREE),'successful-bound-prior-phase');return r

def envs():return{s:read(BACKUP/(s+'-literal-configured-environment.private.json'))for s in ORDER}

def overlay(images,literal,name,build=False):
 need(set(images)==set(literal)==set(ORDER),'overlay-exact-qc-only');lines=['services:']
 for s in ORDER:
  need(type(literal[s])is dict and all(type(k)is str and type(v)is str for k,v in literal[s].items()),'literal-environment-map');lines+=['  '+s+':','    image: '+images[s],'    pull_policy: never','    environment: !override '+json.dumps({k:v.replace('$','$$')for k,v in literal[s].items()},ensure_ascii=True)]
  if build:lines+=['    build:','      labels: '+json.dumps({'org.opencontainers.image.revision':TARGET})]
 private(name,('\n'.join(lines)+'\n').encode());args=[*COMPOSE,'-f',str(OUT/name)];render=json.loads(run([*args,'config','--format','json']))
 for s in ORDER:need(render['services'][s]['image']==images[s]and render['services'][s]['environment']=={k:v.replace('$','$$')for k,v in literal[s].items()},'rendered-full-literal-environment')
 return args

def archive_files(args,expected):
 blob=run(args);found={};total=0
 with tarfile.open(fileobj=io.BytesIO(blob),mode='r:')as archive:
  for m in archive:
   n=m.name;need(B.F.OPS.L.safe_path(n)and n in expected and m.isfile()and n not in found,'safe-exact-qc-source-archive');total+=m.size;need(m.size<=16*1024**2 and total<=32*1024**2,'bounded-source-files');data=archive.extractfile(m).read();need(len(data)==m.size,'complete-source-file');found[n]={'bytes':m.size,'sha256':sha(data)}
 return found

def proof(service,image,cid=None,revision=None):
 need(service=='qc','only-qc-source-proof');revision=revision or TARGET;prefix=['docker','exec','--user','0',cid,'tar']if cid else['docker','run','--rm','--user','0','--network','none','--read-only','--log-driver','none','--entrypoint','tar',image];app,names=B.code_paths(service,revision);expected={n:sha(run(['git','show',revision+':'+app+'/'+n]))for n in names};found=archive_files([*prefix,'-C','/app','-cf','-',*names],expected);need({n:v['sha256']for n,v in found.items()}==expected,'complete-qc-docker-copy-source-hashes');return found

def candidate(s,image,old):
 i=json.loads(run(['docker','image','inspect',image]))[0];original=read(BACKUP/(s+'-image.private.json'));need(i['Id']==image and original['Id']==old['Image']and i['Architecture']==original['Architecture']=='amd64'and i['Os']==original['Os']=='linux'and(i['Config'].get('Labels')or{}).get('org.opencontainers.image.revision')==TARGET,'exact-candidate-platform-revision')
 for k in('Cmd','Entrypoint','User','WorkingDir','Healthcheck','ExposedPorts','Volumes','StopSignal','Shell','ArgsEscaped','StopTimeout'):need(i['Config'].get(k)==original['Config'].get(k),'candidate-image-default-'+k.lower())
 oldlabels=original['Config'].get('Labels')or{};newlabels=i['Config'].get('Labels')or{};need({k:v for k,v in oldlabels.items()if k!='org.opencontainers.image.revision'}=={k:v for k,v in newlabels.items()if k!='org.opencontainers.image.revision'},'unchanged-other-image-labels');need(dict(B.F.envmap(i['Config'].get('Env')or[]),**envs()[s])==envs()[s],'candidate-default-environment-covered-by-original-literal');need(i['Config'].get('Env')==original['Config'].get('Env'),'candidate-default-env-byte-list-unchanged');private(s+'-candidate-image.private.json',i);return proof(s,image)

def prepared():
 sealed(PREPARE,PREPARE_MANIFEST,PREPARE_RESULT,'prepare');p=read(PREPARE/'prepared.private.json');need(p['target']==TARGET and p['tree']==TREE and set(p['images'])==set(p['proofs'])==set(ORDER),'exact-prepared-source-and-services');need(all(re.fullmatch('sha256:[a-f0-9]{64}',v)for v in p['images'].values()),'immutable-prepared-image-identities');return p

def owned_flags(b,s):
 previous={r['path']:r for r in b['maintenanceInventory']};now={r['path']:r for r in B.flags()};own=now.pop('services/'+s,None);need(own=={'path':'services/'+s,'directory':False,'mode':0o600,'bytes':0,'sha256':sha(b'')},'only-own-empty-maintenance-flag')
 if'services'not in previous:need(now.pop('services',None)=={'path':'services','directory':True,'mode':0o700},'only-own-new-services-directory')
 need(now==previous,'all-other-maintenance-flags-identical')

def cleared_flags(b):
 if not any(r['path']=='services'for r in b['maintenanceInventory']):
  p=ROOT/'deploy/maintenance/services'
  if p.exists():need(p.is_dir()and not p.is_symlink()and not list(p.iterdir()),'only-created-empty-services-directory');p.rmdir()
 need(B.flags()==b['maintenanceInventory'],'all-original-maintenance-flags-restored')

def unchanged_except(before,after,s):need(after['others']==before['others']and all(after['targets'][x]==before['targets'][x]for x in ORDER if x!=s),'all-other45-containers-unchanged')

def stopped_runtime(before,old,s):
 current,raw=B.runtime(False);unchanged_except(before,current,s);a,c=before['targets'][s],current['targets'][s];need(raw[s]['Id']==old['Id']and c['running']is False and all(a[k]==c[k]for k in('id','image','started','restarts','environmentMapSHA256','mounts','configSHA256','hostConfigSHA256')),'only-owned-old-writer-stopped-with-original-contract');return current

def full_contract(s,old,new,image,literal,args,revision,allow_same=False):
 same=new['Id']==old['Id'];need((allow_same or not same)and new['Image']==image and new['Config'].get('Image')==(old['Config']['Image']if same else image)and new['RestartCount']==(old['RestartCount']if same else 0)and new['State']['Running']is True and new['State']['OOMKilled']is False and new['State'].get('Health',{}).get('Status')=='healthy','healthy-immutable-running-image');need(H.same_host_config(old['HostConfig'],new['HostConfig'])and sorted(old['Mounts'],key=enc)==sorted(new['Mounts'],key=enc),'complete-hostconfig-mounts');a,c=copy.deepcopy(old['Config']),copy.deepcopy(new['Config']);left=a.pop('Labels')or{};right=c.pop('Labels')or{};need(a.pop('Hostname')==old['Id'][:12]and c.pop('Hostname')==new['Id'][:12],'only-automatic-config-hostname');a.pop('Image');c.pop('Image');a.pop('Env');c.pop('Env');need(a==c and B.F.envmap(new['Config']['Env'])==literal[s],'complete-runtime-config-and-literal-env');need(B.process_environment(new['Id'])==expected_process(s,literal),'complete-original-pid1-environment')
 if new['Id']==old['Id']:need(right==left,'unrecreated-original-labels');return
 expected=copy.deepcopy(left);expected['com.docker.compose.image']=image;expected['com.docker.compose.project.config_files']=','.join([str(ROOT/'docker-compose.cloud.yml'),args[-1]]);hashes=run([*args,'config','--hash',s]).decode().split();need(len(hashes)==2 and hashes[0]==s and pin(hashes[1]),'exact-compose-service-config-hash');expected['com.docker.compose.config-hash']=hashes[1]
 if revision is not None:expected['org.opencontainers.image.revision']=revision
 need(right==expected,'only-exact-image-revision-and-compose-labels')

def same_data(s,a,c,ap,cp,started):
 need(s=='qc'and set(a['sqlite'])==set(c['sqlite'])==B.QC_DATABASES,'exact13-active13-historical-qc-database-inventory');need(a['historicalDatabaseFiles']==c['historicalDatabaseFiles'],'all13-historical-raw-database-bytes-mode-owners-identical');need(a['files']==c['files']and a['fileOwnership']==c['fileOwnership']and a['metadata']==c['metadata'],'all-qc-attachments-files-bytes-mode-owners-and-database-mode-owners-identical');need(a['sqlite']==c['sqlite'],'all26-qc-schema-and-typed-rows-identical');return{'activeDatabases':13,'historicalDatabases':13,'all26TypedSchemasRowsIdentical':True,'allFilesBytesModesOwnersIdentical':True}

def replay_snapshot(s,value,path):B.replay_snapshot(s,value,path)

def request(path,method='GET',data=None):
 need(path.startswith('/')and'..'not in path and method=='GET'and data is None,'bounded-readonly-public-request')
 class NoRedirect(urllib.request.HTTPRedirectHandler):
  def redirect_request(self,*args,**kwargs):return None
 req=urllib.request.Request('http://127.0.0.1'+path,method='GET',headers={'Host':'8.148.146.194','Cache-Control':'no-cache'});opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),NoRedirect())
 try:
  with opener.open(req,timeout=20)as r:body=r.read(16*1024**2+1);need(len(body)<=16*1024**2,'bounded-public-static-response');return r.status,body
 except urllib.error.HTTPError as error:return error.code,error.read(8192)

def public(s,files):
 need(s=='qc','only-qc-readonly-public-target');base='/qc/';status,_=request(base+'api/health');need(status==200,'qc-public-health');status,body=request(base);need(status==200 and sha(body)==files['index.html']['sha256'],'qc-public-index-exact-candidate');assets=['app.js','qc-backend.js','sso.js','style.css','ai-ocr.js','vendor/echarts.min.js']
 for asset in assets:
  need(asset in files,'reviewed-qc-public-static-file');status,data=request(base+asset);need(status==200 and sha(data)==files[asset]['sha256'],'qc-public-static-exact-candidate')
 paths=('api/session','api/bootstrap','api/export/records.csv','api/export/factory-excel.xls','api/ai/status','api/integration/inspections')
 for path in paths:need(request(base+path+'?company=dg-xingxin')[0]==401,'qc-anonymous-read-permission-rejected')
 return{'health':200,'indexMatchesCandidate':True,'selectedAssetCount':len(assets),'anonymousPermissionReadChecks':len(paths),'anonymousAuth':401}

def stable_environment():
 p=ROOT/'.env.cloud.production';need(p.is_file()and not p.is_symlink(),'regular-environment-file')
 with os.fdopen(os.open(p,os.O_RDONLY|os.O_NOFOLLOW),'rb')as stream:
  a=os.fstat(stream.fileno());need(stat.S_ISREG(a.st_mode)and a.st_size<=4*1024**2,'bounded-private-environment-file');data=stream.read(4*1024**2+1);z=os.fstat(stream.fileno());fields=lambda r:(r.st_dev,r.st_ino,r.st_mode,r.st_uid,r.st_gid,r.st_size,r.st_mtime_ns,r.st_ctime_ns);need(fields(a)==fields(z)==fields(p.lstat())and len(data)==a.st_size,'stable-environment-read')
 return data

def environment_exact(b):
 need(type(EXPECTED_ENV)is bytes and stable_environment()==EXPECTED_ENV and B.meta(ROOT/'.env.cloud.production')==b['environmentFileMetadata'],'entire-environment-exact-expected-bytes-mode-owner')

def expected_process(service,literal):
 need(literal[service]==envs()[service],'only-original-runtime-environment');return read(BACKUP/(service+'-literal-process-environment.private.json'))

def baseline():
 r=sealed(BACKUP,BACKUP_MANIFEST,BACKUP_RESULT,'backup');need(r.get('backupComplete')is True and r.get('portableSQLiteCount')==26 and r.get('targetContainerCount')==1 and r.get('otherContainerCount')==45,'complete-qc26-sqlite-backup');b=read(BACKUP/'baseline.private.json');need(b['head']==BASE and b['tree']==BASE_TREE and set(b['runtime']['targets'])==set(ORDER)and len(b['runtime']['others'])==45 and set(b['storage'])==set(ORDER)==set(b['sourceProof']),'complete-original-qc-baseline');return b

def reviewed_manifest():
 p=pathlib.Path(__file__).with_name('pr993-reviewed-files.json');need(pin(SOURCE_MANIFEST_SHA)and p.is_file()and not p.is_symlink()and sha(p.read_bytes())==SOURCE_MANIFEST_SHA,'reviewed-source-manifest-pin');value=read(p)
 def allowed(n):
  relative=n[len(B.QC)+1:]if n.startswith(B.QC+'/')else'';return B.F.OPS.L.safe_path(n)and(relative=='server/server.js'or re.fullmatch(r'(?:[^/]+\.test\.js|server/[^/]+\.test\.js|tests/[^/]+\.test\.(?:js|mjs))',relative)is not None)
 need(type(value)is dict and B.QC+'/server/server.js'in value and 1<=len(value)<=16 and all(allowed(n)and pin(h)for n,h in value.items()),'only-reviewed-qc-server-ocr-and-offline-test-source');return value

def source(b,revision):
 need(run(['git','symbolic-ref','--quiet','HEAD']).decode().strip()=='refs/heads/main'and run(['git','rev-parse','HEAD']).decode().strip()==revision and revision in{BASE,TARGET},'canonical-known-main-revision');manifest=reviewed_manifest();names=run(['git','diff','--name-only','-z',BASE,TARGET]).decode().rstrip('\0').split('\0');need(len(names)==len(set(names))==len(manifest)and set(names)==set(manifest)and not set(names)&set(b['preexistingFourDirty']),'exact-reviewed-qc-server-ocr-diff');need(run(['git','rev-parse',TARGET+'^{tree}']).decode().strip()==TREE,'exact-reviewed-target-tree');need(B.dirty_snapshot()==b['preexistingFourDirty'],'four-existing-dirty-files-identical');run(['git','diff','--quiet','--no-ext-diff','--no-textconv','--',*B.APPS])
 for n,h in manifest.items():
  need(sha(run(['git','show',TARGET+':'+n]))==h,'all-reviewed-git-file-hashes')
  if revision==TARGET:
   p=ROOT/n;entry=run(['git','ls-tree','-z',TARGET,'--',n]);need(re.fullmatch(b'100(?:644|755) blob [a-f0-9]{40}\t'+re.escape(n.encode())+b'\0',entry)is not None,'reviewed-regular-source-mode')
   for ancestor in(p,*p.parents):
    if ancestor==ROOT:break
    need(not ancestor.is_symlink(),'reviewed-source-no-symlink-ancestors')
   need(p.is_file()and B.F.OPS.L.file_hash(p)==h and stat.S_IMODE(p.stat().st_mode)==(0o755 if entry.startswith(b'100755')else 0o644),'reviewed-canonical-file-bytes-mode')
 for n in B.FIXED:need((ROOT/n).is_file()and not(ROOT/n).is_symlink()and(ROOT/n).read_bytes()==run(['git','show',BASE+':'+n])and B.meta(ROOT/n)=={k:b['configuration'][n][k]for k in('mode','uid','gid')},'all-fixed-configuration-and-mode-owners-preserved')
 for n in B.FIXED:need(run(['git','rev-parse',BASE+':'+n])==run(['git','rev-parse',TARGET+':'+n]),'unchanged-global-docker-dependencies-auth-seeds-and-provider-configuration')
 n=B.QC+'/server/server.js';old=run(['git','show',BASE+':'+n]);new=run(['git','show',TARGET+':'+n]);start=b'const SCHEMA_SQL = ';end=b'\nmigrateLegacyDb();'
 def region(data):need(data.count(start)==1 and data.count(end)==1,'unique-qc-existing-schema-startup-region');a=data.index(start);return data[a:data.index(end,a)+len(end)]
 need(region(old)==region(new),'qc-schema-seed-migrations-and-startup-unchanged');run(['git','merge-base','--is-ancestor',BASE,TARGET])

def configuration(b):source(b,TARGET);environment_exact(b)

def compose_contract(b):
 expected=read(BACKUP/'compose-render.private.json');actual=json.loads(run([*COMPOSE,'config','--format','json']));need(actual==expected,'entire-compose-render-unchanged');return actual

def prepare(result,b):
 runtime,raw=B.runtime();need(runtime==b['runtime']and B.flags()==b['maintenanceInventory'],'original-runtime-before-build');environment_exact(b);operation(['git','-c','core.hooksPath=/dev/null','fetch','--no-write-fetch-head','origin','main'],'fetch-reviewed-main');need(run(['git','rev-parse','origin/main']).decode().strip()==TARGET,'exact-current-remote-main');head=run(['git','rev-parse','HEAD']).decode().strip();source(b,head)
 if head==BASE:operation(['git','-c','core.hooksPath=/dev/null','merge','--ff-only',TARGET],'source-fast-forward')
 configuration(b);compose_contract(b);literal=envs();private('literal-environments.private.json',literal);tags={s:'rr-portal-'+s+'-pr993:'+TARGET for s in ORDER};args=overlay(tags,literal,'build.private.yml',True)
 for service in ORDER:operation([*args,'build',service],'build-'+service,1800)
 images={s:json.loads(run(['docker','image','inspect',tags[s]]))[0]['Id']for s in ORDER};proofs={s:candidate(s,images[s],raw[s])for s in ORDER};need(B.runtime()[0]==runtime and B.flags()==b['maintenanceInventory'],'all46-originals-serve-through-qc-build');configuration(b);private('prepared.private.json',{'target':TARGET,'tree':TREE,'images':images,'proofs':proofs,'originalRuntime':runtime});result.update(success=True,candidatesBuiltBeforeAnyMaintenance=True,targetContainerCount=1,otherContainerCount=45,all46OriginalContainersUnchanged=True,environmentFileUnchanged=True,images=images)

def maintenance(fn,service):
 need(fn in{'maintenance_on','maintenance_off','wait_service_ready','require_maintenance_cleared'}and service in ORDER,'only-owned-qc-maintenance');operation(['bash','-c','set -euo pipefail; source "$1"; "$2" "$3"','pr993',str(ROOT/'deploy/service-maintenance.sh'),fn,service],fn+'-'+service,330,service=service)

def recover(service,old,b,before,literal,rollback,closed,closed_path,attempted,stopped,result):
 need(service in ORDER,'only-owned-failed-service-recovery');maintenance('maintenance_on',service);owned_flags(b,service);need(not stopped or closed is not None,'no-restart-without-fresh-closed-business-evidence')
 if stopped:replay_snapshot(service,closed,closed_path)
 recovery_start=None;comparison=closed;comparison_path=closed_path
 if attempted:
  current=run([*rollback,'ps','-a','-q',service]).decode().strip();need(re.fullmatch('[a-f0-9]{12,64}',current)is not None,'one-owned-failed-candidate');operation(['docker','stop','--time','60',current],'stop-failed-'+service,80);failed,fp=B.capture(service,'failed-candidate');private(service+'-failed-raw-before-comparison.private.json',failed);replay_snapshot(service,failed,fp);recovery_start=json.loads(run(['docker','inspect',current]))[0]['State']['StartedAt'];same_data(service,closed,failed,closed_path,fp,recovery_start);comparison,comparison_path=closed,closed_path;operation([*rollback,'up','-d','--force-recreate','--no-build','--no-deps','--pull','never',service],'recover-only-'+service,180)
 elif stopped:operation(['docker','start',old['Id']],'restart-only-original-'+service,80)
 maintenance('wait_service_ready',service);now,raw=B.runtime();unchanged_except(before,now,service);revision=(old['Config'].get('Labels')or{}).get('org.opencontainers.image.revision');full_contract(service,old,raw[service],old['Image'],literal,rollback,revision,allow_same=True);need(proof(service,old['Image'],raw[service]['Id'],BASE)==b['sourceProof'][service]['files'],'recovered-original-full-source-and-assets')
 if closed is not None:
  after,ap=B.capture(service,'after-recovery');private(service+'-recovery-raw-before-comparison.private.json',after);replay_snapshot(service,after,ap);same_data(service,comparison,after,comparison_path,ap,recovery_start or raw[service]['State']['StartedAt'])
 configuration(b);operation(['sleep','11'],'recovery-dns-'+service,20);maintenance('maintenance_off',service);maintenance('require_maintenance_cleared',service);cleared_flags(b);result['failedServiceRecoveredWithoutDataRestore']=True

def deploy(result,b):
 p=prepared();configuration(b);need(p['originalRuntime']==b['runtime']and envs()==read(PREPARE/'literal-environments.private.json'),'prepared-original-runtime-and-full-env-bound');before,raw=B.runtime();need(before==b['runtime']and B.flags()==b['maintenanceInventory'],'original-all46-before-switch');compose_contract(b);literal=envs();private('desired-runtime-environments.private.json',literal);args=overlay(p['images'],literal,'runtime.private.yml');original=envs();rollback=overlay({s:raw[s]['Image']for s in ORDER},original,'rollback.private.yml');completed=[];evidence={}
 for service in ORDER:
  global STAGE
  STAGE='switch-'+service;old=raw[service];closed=None;closed_path=None;attempted=False;stopped=False
  try:
   configuration(b);need(B.runtime()[0]==before and B.flags()==b['maintenanceInventory'],'all-runtime-and-flags-stable-before-own-switch');maintenance('maintenance_on',service);owned_flags(b,service);operation(['sleep','60'],'drain-'+service,70);operation(['docker','stop','--time','60',old['Id']],'stop-own-old-writer-'+service,80);stopped=True;stopped_runtime(before,old,service);closed,closed_path=B.capture(service,'closed-before');private(service+'-closed-raw-before-comparison.private.json',closed);replay_snapshot(service,closed,closed_path);stopped_runtime(before,old,service);configuration(b);owned_flags(b,service);attempted=True;operation([*args,'up','-d','--force-recreate','--no-build','--no-deps','--pull','never',service],'recreate-only-'+service,180);maintenance('wait_service_ready',service);now,newraw=B.runtime();new=newraw[service];started={'candidateStartedAt':new['State']['StartedAt'],'containerId':new['Id'],'image':new['Image']};private(service+'-candidate-started.private.json',started);full_contract(service,old,new,p['images'][service],literal,args,TARGET);need(proof(service,p['images'][service],new['Id'])==p['proofs'][service],'actual-service-source-and-assets-equal-prepared');unchanged_except(before,now,service);post,post_path=B.capture(service,'after-start');private(service+'-poststart-raw-before-comparison.private.json',post);replay_snapshot(service,post,post_path);need(B.runtime()[0]==now,'runtime-stable-through-fresh-poststart-capture');counts=same_data(service,closed,post,closed_path,post_path,started['candidateStartedAt']);audit={'candidateStartedAt':started['candidateStartedAt'],'afterSnapshotObservedUTC':post['observedUTC'],'comparison':'exact_all26_typed_schema_rows_and_files_modes_owners','dataDeltaEvidence':counts,'businessTypedSchemaFilesAndOwnershipPreserved':True};private(service+'-closed-comparison.private.json',audit);evidence[service]={'before':closed,'after':post,'started':started,'audit':audit};configuration(b);owned_flags(b,service);operation(['sleep','11'],'dns-grace-'+service,20);maintenance('maintenance_off',service);maintenance('require_maintenance_cleared',service);cleared_flags(b);result.setdefault('public',{})[service]=public(service,p['proofs'][service])
   need(B.runtime()[0]==now,'all46-contracts-stable-after-own-public-smoke');before=now;completed.append(service);result['completedServices']=completed[:]
  except BaseException:
   result['failedService']=service
   try:recover(service,old,b,before,original,rollback,closed,closed_path,attempted,stopped,result)
   except BaseException:result['failedServiceRetainsOwnMaintenance']=True;private(service+'-recovery-failure.private.txt',traceback.format_exc().encode())
   raise
 need(completed==list(ORDER),'qc-service-complete');configuration(b);compose_contract(b);cleared_flags(b);private('closed-evidence.private.json',evidence);private('final-runtime.private.json',before);result.update(success=True,images=p['images'],allOther45ContainersUnchanged=True,allBusinessTypedRowsSchemaFilesAndModeOwnersPreserved=True,entireEnvironmentFileAndRuntimeEnvironmentsUnchanged=True,allMaintenanceFlagsRestored=True,buildsPerformed=False)

def verify(result,b):
 p=prepared();receipt=sealed(DEPLOY,DEPLOY_MANIFEST,DEPLOY_RESULT,'deploy');need(receipt.get('completedServices')==list(ORDER)and receipt.get('buildsPerformed')is False,'qc-only-scoped-deploy-success');configuration(b);compose_contract(b);literal=envs();need(literal==read(DEPLOY/'desired-runtime-environments.private.json')and p['originalRuntime']==b['runtime'],'prepared-and-deployed-full-env-binding');current,raw=B.runtime();need(current==read(DEPLOY/'final-runtime.private.json')and current['others']==b['runtime']['others'],'current-final-runtime-and-original45');cleared_flags(b);evidence=read(DEPLOY/'closed-evidence.private.json');need(set(evidence)==set(ORDER),'qc-closed-evidence-present');oldraw=read(BACKUP/'target-inspect.private.json');args=[*COMPOSE,'-f',str(DEPLOY/'runtime.private.yml')]
 for service in ORDER:
  entry=evidence[service];a,c,started,audit=(entry[k]for k in('before','after','started','audit'));need(started=={'candidateStartedAt':raw[service]['State']['StartedAt'],'containerId':raw[service]['Id'],'image':p['images'][service]}and read(DEPLOY/(service+'-candidate-started.private.json'))==started,'sealed-cutover-exact-current-candidate-binding');ap=DEPLOY/(service+'-closed-before');cp=DEPLOY/(service+'-after-start');need(read(DEPLOY/(service+'-closed-before.private.json'))==a and read(DEPLOY/(service+'-after-start.private.json'))==c,'sealed-capture-audit-binding');replay_snapshot(service,a,ap);replay_snapshot(service,c,cp);counts=same_data(service,a,c,ap,cp,started['candidateStartedAt']);expected={'candidateStartedAt':started['candidateStartedAt'],'afterSnapshotObservedUTC':c['observedUTC'],'comparison':'exact_all26_typed_schema_rows_and_files_modes_owners','dataDeltaEvidence':counts,'businessTypedSchemaFilesAndOwnershipPreserved':True};need(audit==expected and read(DEPLOY/(service+'-closed-comparison.private.json'))==expected,'closed-data-audit-reproduced');full_contract(service,oldraw[service],raw[service],p['images'][service],literal,args,TARGET);need(proof(service,p['images'][service],raw[service]['Id'])==p['proofs'][service],'actual-source-and-assets-equal-prepared');result.setdefault('public',{})[service]=public(service,p['proofs'][service])
 configuration(b);need(B.runtime()[0]==current,'all46-stable-through-readonly-verify');cleared_flags(b);private('verified-runtime.private.json',current);result.update(success=True,images=p['images'],qcPreparedSourceAndRuntimeContractVerified=True,qcSealedClosedDataCheckReproduced=True,allOther45ContainersUnchanged=True,entireEnvironmentFileAndRuntimeEnvironmentsUnchanged=True,allMaintenanceFlagsRestored=True,freshLiveBusinessComparisonPerformed=False,buildsPerformed=False)

def main():
 global OUT,EXPECTED_ENV
 need(PHASE in{'prepare','deploy','verify'}and sys.argv[1:]==[PHASE]and os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_ATTEMPT')=='1'and pin(TARGET,40)and pin(TREE,40)and pin(SOURCE_MANIFEST_SHA),'blank-draft-or-wrong-phase-branch-attempt-target');os.umask(0o077);OUT={'prepare':PREPARE,'deploy':DEPLOY,'verify':VERIFY}[PHASE];OUT.mkdir(mode=0o700);initialize();signal.signal(signal.SIGTERM,lambda *_:need(False,'terminated'));result={'mode':PHASE,'base':BASE,'target':TARGET,'tree':TREE,'success':False,'businessWritesPerformed':False,'databaseRestorePerformed':False,'modelCallsPerformed':False,'authenticatedBusinessWritesPerformed':False,'otherServicesRequested':False,'secretOrRowsPrinted':False,'environmentConfigurationChanged':False}
 try:
  b=baseline();EXPECTED_ENV=(BACKUP/'environment.private').read_bytes();{'prepare':prepare,'deploy':deploy,'verify':verify}[PHASE](result,b);baseline()
 except BaseException as error:result.update(success=False,failedStage=STAGE,backupLibraryFailedStage=B.STAGE,safeExceptionType=type(error).__name__);private('failure.private.txt',traceback.format_exc().encode())
 finally:private('first-result.json',result);B.F.OPS.L.seal(OUT);print(enc(dict(result,manifestSHA256=B.F.OPS.L.file_hash(OUT/'manifest.json'),resultSHA256=B.F.OPS.L.file_hash(OUT/'first-result.json'))).decode(),flush=True)
 return 0 if result['success']else 1
if __name__=='__main__':
 try:sys.exit(main())
 except SystemExit:raise
 except BaseException:print('{"mode":"rejected","success":false,"safeFailure":"PR993_RELEASE_PREFLIGHT_REJECTED"}',flush=True);sys.exit(1)
