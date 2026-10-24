"""PR1001 indo-shipping-only release draft; phase/target/archive gates remain blank.
No environment changes, DB restore, authenticated writes or model calls.
"""
import copy,hashlib,importlib.util,io,json,os,pathlib,re,signal,stat,subprocess,sys,tarfile,traceback,urllib.error,urllib.request
PHASE='prepare'
TARGET='ab0ae0bdbbea5ab7c6c7216e925f2ba1eeeef2b3'
TREE='b31cbe6b6939e743d72debe33c7ffbd52df1c04f'
SOURCE_MANIFEST_SHA='6d288f847e7553db189f273c4a47b64a8e0fd0289d53035ce4b2fc8197bc5ccc'
BASE='69e37c71354935a4eaae825af2a1fddeee2090a9'
BASE_TREE='d0053e7f662089359f0afb4e239cff36687b9a3b'
BRANCH='refs/heads/ops/pr-1001-20261024'
ROOT=pathlib.Path('/opt/rr-portal')
BACKUP=ROOT/'deploy/backups/pr-1001-20261024-backup'
PREPARE=BACKUP.with_name('pr-1001-20261024-prepare')
DEPLOY=BACKUP.with_name('pr-1001-20261024-deploy')
VERIFY=BACKUP.with_name('pr-1001-20261024-verify')
BACKUP_MANIFEST='02d4cf796e366a54117c4b04ddede786eb9b26ba46debb90bce5a11ef64969e8';BACKUP_RESULT='02611b29b6c05ffdf4e1ad37e3b53cd009059ded2032d3a672f49223a42fdcda';PREPARE_MANIFEST='';PREPARE_RESULT='';DEPLOY_MANIFEST='';DEPLOY_RESULT=''
ORDER=('indo-shipping',)
INDO_SCHEMA_SHA='2a7e993b0c6f673cb27eec87ca9cf4fde483e5b91468a92f96342691e7372a7a'
REVIEWED_PATHS=('web/src/pages/ShipmentsPage.tsx', 'web/src/utils/customsExport.ts', 'web/src/utils/shipmentConsolidation.test.ts', 'web/src/utils/shipmentConsolidation.ts', 'web/src/utils/shipmentConsolidationSave.test.ts')
ADMIN_INSERT_FRAGMENT=b'INSERT INTO "Users" ("Username", "PasswordHash", "DisplayName", "Userbqrpower", "Usereditpower")\nVALUES (\'admin\', \'$2a$11$m559Cb68j1R4cHfTHJ5tV.z3oeYQyjPGL/mIlkhdltC70AnKNsLyi\',\n        \'\xe7\xae\xa1\xe7\x90\x86\xe5\x91\x98\', \'111111111\', \'111111111\')\nON CONFLICT ("Username") DO NOTHING;'
ADMIN_INSERT_SHA='13bbcce66881899060d460e753d61a2755e6fd1029e9d77b782a198489d0f2e8'
DEPS={'pr1001-backup-library.py': 'f0df28a8cd2b3791fcfbddd74a280a949b5c2500052e2e179e173e321930f4ce', 'factory-review-backup-library.py': '79d76bb47312dd08c121ebe2797f54d958666f8b72d00721f67712b152fc4666', 'release-data-ops-library.py': 'ff9138a1d5bfed1b10077112da6ebcda2d65240f583e2d0e12ce1325cfbaafd5', 'release-data-library.py': 'd63168fd3057f4f2aba2d93f9fab31d2d65c6dd0f3234877d71fcff1e04e62b9', 'qc-source-library.py': '4745c90f126cf46106b0f170a3ebc6b24ccb64c0e963e427d13308d5cb5b54f5', 'portable-pdb-library.py': 'cf66f655a1e166491c4da67da0824f42ac8cdae3f844044cb5d8f7233ba105c5', 'batch-host-config-library.py': 'bd1842dc6847f3e0e5c0c38374c3604791f66d1c94dc651457607dc338f38ff1'}
COMPOSE=['docker','compose','-p','rr-portal','-f',str(ROOT/'docker-compose.cloud.yml'),'--env-file',str(ROOT/'.env.cloud.production')]
B=None;H=None;OUT=None;ENV=None;EXPECTED_ENV=None;STAGE='entrypoint';SERIAL=0
def need(v,label):
 global STAGE
 if not v:STAGE=label;raise RuntimeError('PR1001_RELEASE_REJECTED')

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
 B=load('pr1001-backup-library.py');need(B.BACKUP_PIN is False and B.BASE==BASE and B.BASE_TREE==BASE_TREE and B.ORDER==ORDER,'inert-exact-backup-library');B.ROOT=ROOT;B.initialize(OUT);H=load('batch-host-config-library.py');native_host=H.same_host_config
 def scoped_host(expected,observed):
  if type(expected)is not dict or type(observed)is not dict:return False
  a,c=copy.deepcopy(expected),copy.deepcopy(observed)
  if 'OomKillDisable'in a and 'OomKillDisable'in c and(a['OomKillDisable']is None or a['OomKillDisable']is False)and(c['OomKillDisable']is None or c['OomKillDisable']is False):a['OomKillDisable']=c['OomKillDisable']=False
  return native_host(a,c)
 H.same_host_config=scoped_host;ENV=dict(os.environ,COMPOSE_PROJECT_NAME='rr-portal',COMPOSE_BAKE='false',COMPOSE_PARALLEL_LIMIT='1',MAINT_FLAG_DIR=str(ROOT/'deploy/maintenance'),COMPOSE_FILE=str(ROOT/'docker-compose.cloud.yml'),ENV_FILE=str(ROOT/'.env.cloud.production'),MAINT_HEALTH_TIMEOUT_SECONDS='300',MAINT_DNS_GRACE_SECONDS='10')

def sealed(path,manifest_hash,result_hash,mode,success=True):
 need(pin(manifest_hash)and pin(result_hash)and path.is_dir()and not path.is_symlink()and stat.S_IMODE(path.stat().st_mode)==0o700,'private-phase-directory-and-pins');L=B.F.OPS.L;need(L.file_hash(path/'manifest.json')==manifest_hash and L.file_hash(path/'first-result.json')==result_hash,'exact-phase-seals');manifest=read(path/'manifest.json');entries=list(path.rglob('*'));need(type(manifest)is dict and len(entries)<=100000 and all(not p.is_symlink()and(p.is_file()or p.is_dir())and p.stat().st_mode&0o077==0 for p in entries),'all-private-regular-phase-entries');need(set(manifest)=={str(p.relative_to(path))for p in entries if p.is_file()and p!=path/'manifest.json'}and all(L.safe_path(n)and pin(h)and L.file_hash(path/n)==h for n,h in manifest.items()),'all-phase-byte-seals');r=read(path/'first-result.json');need(r.get('success')is success and r.get('mode')==mode and r.get('base')==BASE and r.get('target')==(BASE if mode=='backup'else TARGET)and r.get('tree')==(BASE_TREE if mode=='backup'else TREE),'successful-bound-prior-phase');return r

def envs():return{s:read(BACKUP/(s+'-literal-configured-environment.private.json'))for s in ORDER}

def overlay(images,literal,name,build=False):
 need(set(images)==set(literal)==set(ORDER),'overlay-exact-indo-shipping-only');lines=['services:']
 for s in ORDER:
  need(type(literal[s])is dict and all(type(k)is str and type(v)is str for k,v in literal[s].items()),'literal-environment-map');lines+=['  '+s+':','    image: '+images[s],'    pull_policy: never','    environment: !override '+json.dumps({k:v.replace('$','$$')for k,v in literal[s].items()},ensure_ascii=True)]
  if build:lines+=['    build:','      labels: '+json.dumps({'org.opencontainers.image.revision':TARGET})]
 private(name,('\n'.join(lines)+'\n').encode());args=[*COMPOSE,'-f',str(OUT/name)];render=json.loads(run([*args,'config','--format','json']))
 for s in ORDER:need(render['services'][s]['image']==images[s]and render['services'][s]['environment']=={k:v.replace('$','$$')for k,v in literal[s].items()},'rendered-full-literal-environment')
 return args



def proof(service,image,cid=None,revision=None):
 need(service=='indo-shipping','only-indo-source-proof');revision=revision or TARGET;value=B.Q.service_source_proof(service,{'id':cid or image},revision=revision,candidate=cid is None);need(value['reviewedSourceMatch']is True,'full-reviewed-dotnet-pdb-copied-files-and-frontend-assets');return value

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

def full_contract(s,old,new,image,literal,args,revision,allow_same=False,created=False):
 need(s=='indo-shipping','only-indo-runtime-contract');need(old['Mounts']==new['Mounts']==[]and old['HostConfig'].get('Binds')in(None,[])and new['HostConfig'].get('Binds')in(None,[]),'original-no-mounted-files-or-keys');same=new['Id']==old['Id'];need((allow_same or not same)and new['Image']==image and new['Config'].get('Image')==(old['Config']['Image']if same else image)and new['RestartCount']==(old['RestartCount']if same else 0)and new['State']['OOMKilled']is False,'immutable-original-container-identity-and-no-restarts')
 if created:need(not same and never_started(new),'created-candidate-never-started-with-pid-zero')
 else:need(new['State']['Running']is True and new['State'].get('Health',{}).get('Status')=='healthy','healthy-running-candidate')
 need(H.same_host_config(old['HostConfig'],new['HostConfig'])and sorted(old['Mounts'],key=enc)==sorted(new['Mounts'],key=enc),'complete-hostconfig-mounts');a,c=copy.deepcopy(old['Config']),copy.deepcopy(new['Config']);left=a.pop('Labels')or{};right=c.pop('Labels')or{};need(a.pop('Hostname')==old['Id'][:12]and c.pop('Hostname')==new['Id'][:12],'only-automatic-config-hostname');a.pop('Image');c.pop('Image');a.pop('Env');c.pop('Env');need(a==c and B.F.envmap(new['Config']['Env'])==literal[s],'complete-runtime-config-and-literal-env')
 if not created:need(B.process_environment(new['Id'])==expected_process(s,literal),'complete-original-pid1-environment')
 if new['Id']==old['Id']:need(right==left,'unrecreated-original-labels');return
 expected=copy.deepcopy(left);expected['com.docker.compose.image']=image;expected['com.docker.compose.project.config_files']=','.join([str(ROOT/'docker-compose.cloud.yml'),args[-1]]);hashes=run([*args,'config','--hash',s]).decode().split();need(len(hashes)==2 and hashes[0]==s and pin(hashes[1]),'exact-compose-service-config-hash');expected['com.docker.compose.config-hash']=hashes[1]
 if revision is not None:expected['org.opencontainers.image.revision']=revision
 need(right==expected,'only-exact-image-revision-and-compose-labels')

def sequence_state(value):
 need(type(value)is dict and set(value)=={'lastValue','called'}and type(value['called'])is bool and type(value['lastValue'])is str and re.fullmatch('-?(?:0|[1-9][0-9]{0,19})',value['lastValue']),'typed-bounded-sequence-state');return int(value['lastValue'])





def indo_postgres(old,new,allowed_deltas=(1,)):
 need(type(old)is dict and type(new)is dict and old.get('sequenceStateStableDuringCapture')is True and new.get('sequenceStateStableDuringCapture')is True and old.get('startupSourceSHA256')==new.get('startupSourceSHA256')and old['startupChecks']==new['startupChecks']and old['tables']==new['tables']and old['schema']==new['schema']and old['postgresDetails']==new['postgresDetails'],'indo-all-full-typed-rows-schema-owners-acl-rls-identical');need(set(old['startupSourceSHA256'])==set(B.STARTUP_FILES)and old['startupSourceSHA256']['db/postgres_schema.sql']==INDO_SCHEMA_SHA and'users'not in old['tables'],'unchanged-complete-startup-source-and-no-legacy-user-table');a,b=old['sequenceStates'],new['sequenceStates'];need(type(a)is dict and type(b)is dict and set(a)==set(b)and 0<len(a)<=200,'indo-exact-sequence-inventory');definitions=old['schema']['sequences'];need(type(definitions)is list and len(definitions)==len(a)and all(type(row)is dict and type(row.get('name'))is str for row in definitions),'indo-complete-sequence-definitions');by_name={row['name']:row for row in definitions};need(set(by_name)==set(a)and len(by_name)==len(definitions),'indo-unique-sequence-definitions');changed=[]
 for name in sorted(a):
  need(re.fullmatch('[A-Za-z_][A-Za-z0-9_]{0,62}',name)is not None,'indo-safe-sequence-name');before,after=sequence_state(a[name]),sequence_state(b[name]);definition=by_name[name];need(all(type(definition.get(k))is str and re.fullmatch('-?(?:0|[1-9][0-9]{0,19})',definition[k])for k in('min','max'))and int(definition['min'])<=before<=int(definition['max'])and int(definition['min'])<=after<=int(definition['max']),'indo-sequence-definition-bounds')
  if a[name]!=b[name]:changed.append(name)
 definition=by_name.get('Users_Id_seq',{});contract={'name':'Users_Id_seq','type':'integer','start':'1','increment':'1','min':'1','max':'2147483647','cache':'1','cycle':False,'ownedByTable':'Users','ownedByColumn':'Id','dependencyType':'i'};need(all(definition.get(k)==v for k,v in contract.items()),'indo-unchanged-admin-identity-sequence-contract');before,after=sequence_state(a['Users_Id_seq']),sequence_state(b['Users_Id_seq']);need(a['Users_Id_seq']['called']is True and b['Users_Id_seq']['called']is True and after-before in allowed_deltas and changed==(['Users_Id_seq']if after!=before else[]),'only-exact-one-startup-admin-conflict-consumption-no-regression-or-reset')
 return{'allFullTypedRowsSchemaOwnersACLAndRLSIdentical':True,'allOtherSequenceStatesIdentical':True,'usersIdentityDelta':str(after-before),'usersIdentityBeforeCalled':True,'usersIdentityAfterCalled':True,'compatibleWithUnchangedBootstrapAdminConflictConsumption':True,'sequenceValuesNotMVCCAtomic':True,'counterResetPerformed':False,'deletionOrConsumptionActorProven':False}

def same_data(s,a,c,ap,cp,started,allowed_deltas=(1,)):
 need(s=='indo-shipping'and set(a)==set(c)=={'postgres','keyring','observedUTC'},'complete-indo-postgres-and-keyring-assets');need(a['keyring']['entries']==c['keyring']['entries']and a['keyring']['ancestors']==c['keyring']['ancestors'],'all-keyring-file-bytes-count-paths-modes-owners-and-pre-stop-post-start-ancestors-identical');value=indo_postgres(a['postgres'],c['postgres'],allowed_deltas);value.update(dataProtectionKeyringPostStartExact=True,ancestorMetadataMatchesPreStop=True);return value

def replay_snapshot(s,value,path):
 B.replay_snapshot(s,value,path)

def request(path,method='GET',data=None):
 need(path.startswith('/')and'..'not in path and method=='GET'and data is None,'bounded-readonly-public-request')
 class NoRedirect(urllib.request.HTTPRedirectHandler):
  def redirect_request(self,*args,**kwargs):return None
 req=urllib.request.Request('http://127.0.0.1'+path,method='GET',headers={'Host':'8.148.146.194','Cache-Control':'no-cache'});opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),NoRedirect())
 try:
  with opener.open(req,timeout=20)as r:body=r.read(16*1024**2+1);need(len(body)<=16*1024**2,'bounded-public-static-response');return r.status,body
 except urllib.error.HTTPError as error:return error.code,error.read(8192)

def public(s,files):
 need(s=='indo-shipping','only-indo-readonly-public-target');base='/indo-shipping/';need(request(base+'api/health')[0]==200,'indo-public-health');assets=files['compiledArtifactInventory'];selected={name:row for name,row in assets.items()if name=='wwwroot/index.html'or name.startswith('wwwroot/assets/')};need('wwwroot/index.html'in selected and 1<len(selected)<=100,'compiled-index-and-assets-present-and-bounded')
 for name,row in selected.items():
  relative=name[len('wwwroot/'):];status,body=request(base if relative=='index.html'else base+relative);need(status==200 and len(body)==row['bytes']and sha(body)==row['sha256'],'all-public-index-and-assets-equal-running-candidate')
 for path in('api/purchase','api/purchase/placed-keys','api/purchase/blob','api/outbound','api/shipments','api/users/me'):need(request(base+path)[0]==401,'indo-anonymous-business-api-rejected')
 return{'health':200,'allPublicIndexAndAssetsMatch':True,'staticRequestCount':len(selected),'anonymousPermissionReadChecks':6,'anonymousAuth':401,'productionBusinessWritesPerformed':False}

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
 r=sealed(BACKUP,BACKUP_MANIFEST,BACKUP_RESULT,'backup');need(r.get('backupComplete')is True and r.get('portableSQLiteCount')==0 and r.get('postgresSchemaCount')==1 and r.get('consistentExportedIndoShippingPostgresSnapshotAndDump')is True and r.get('targetContainerCount')==1 and r.get('otherContainerCount')==45,'complete-indo-postgres-backup');need(r.get('persistentDataProtectionKeyringCaptured')is True and r.get('keyringBackupPrivateAndReplayVerified')is True and type(r.get('dataProtectionKeyringFileCount'))is int and 1<=r['dataProtectionKeyringFileCount']<=16 and r.get('ancestorMetadataReference')=='observed-live-not-closed-atomic'and r.get('keyMaterialPrintedOrSubmittedToGit')is False,'complete-private-existing-data-protection-keyring-backup');b=read(BACKUP/'baseline.private.json');need(b['head']==BASE and b['tree']==BASE_TREE and set(b['runtime']['targets'])==set(ORDER)and len(b['runtime']['others'])==45 and set(b['storage'])==set(ORDER)==set(b['sourceProof']),'complete-original-indo-baseline');return b

def reviewed_manifest():
 p=pathlib.Path(__file__).with_name('pr1001-reviewed-files.json');need(pin(SOURCE_MANIFEST_SHA)and p.is_file()and not p.is_symlink()and sha(p.read_bytes())==SOURCE_MANIFEST_SHA,'reviewed-source-manifest-pin');value=read(p);need(type(REVIEWED_PATHS)is tuple and len(REVIEWED_PATHS)==len(set(REVIEWED_PATHS))==5 and all(n.startswith('web/')for n in REVIEWED_PATHS),'final-exact-five-frontend-path-allowlist');allowed={B.INDO+'/'+n for n in REVIEWED_PATHS};need(type(value)is dict and set(value)==allowed and all(B.F.OPS.L.safe_path(n)and pin(h)for n,h in value.items()),'exact-reviewed-indo-five-web-files');return value

def source(b,revision):
 need(run(['git','symbolic-ref','--quiet','HEAD']).decode().strip()=='refs/heads/main'and run(['git','rev-parse','HEAD']).decode().strip()==revision and revision in{BASE,TARGET},'canonical-known-main-revision');manifest=reviewed_manifest();names=run(['git','diff','--name-only','-z',BASE,TARGET]).decode().rstrip('\0').split('\0');need(len(names)==len(set(names))==len(manifest)and set(names)==set(manifest)and not set(names)&set(b['preexistingFourDirty']),'exact-reviewed-indo-files-diff');need(run(['git','rev-parse',TARGET+'^{tree}']).decode().strip()==TREE,'exact-reviewed-target-tree');need(B.dirty_snapshot()==b['preexistingFourDirty'],'four-existing-dirty-files-identical');run(['git','diff','--quiet','--no-ext-diff','--no-textconv','--',*B.APPS])
 for n,h in manifest.items():
  need(sha(run(['git','show',TARGET+':'+n]))==h,'all-reviewed-git-file-hashes')
  if revision==TARGET:
   p=ROOT/n;entry=run(['git','ls-tree','-z',TARGET,'--',n]);need(re.fullmatch(b'100(?:644|755) blob [a-f0-9]{40}\t'+re.escape(n.encode())+b'\0',entry)is not None,'reviewed-regular-source-mode')
   for ancestor in(p,*p.parents):
    if ancestor==ROOT:break
    need(not ancestor.is_symlink(),'reviewed-source-no-symlink-ancestors')
   need(p.is_file()and B.F.OPS.L.file_hash(p)==h and stat.S_IMODE(p.stat().st_mode)==(0o755 if entry.startswith(b'100755')else 0o644),'reviewed-canonical-file-bytes-mode')
 for n in B.FIXED:need((ROOT/n).is_file()and not(ROOT/n).is_symlink()and(ROOT/n).read_bytes()==run(['git','show',BASE+':'+n])and B.meta(ROOT/n)=={k:b['configuration'][n][k]for k in('mode','uid','gid')},'all-fixed-configuration-and-mode-owners-preserved')
 for n in B.FIXED:need(run(['git','rev-parse',BASE+':'+n])==run(['git','rev-parse',TARGET+':'+n]),'unchanged-global-docker-db-account-and-startup-configuration')
 for n in(B.INDO+'/src/IndoShipping.Api/Auth',B.INDO+'/src/IndoShipping.Domain/Auth',B.INDO+'/src/IndoShipping.Infrastructure/Auth',B.INDO+'/src/IndoShipping.Api/IndoShipping.Api.csproj',B.INDO+'/src/IndoShipping.Domain/IndoShipping.Domain.csproj',B.INDO+'/src/IndoShipping.Infrastructure/IndoShipping.Infrastructure.csproj',B.INDO+'/web/package.json',B.INDO+'/web/package-lock.json'):need(run(['git','rev-parse',BASE+':'+n])==run(['git','rev-parse',TARGET+':'+n]),'unchanged-indo-dependencies-auth-and-startup')
 n=B.INDO+'/db/postgres_schema.sql'
 for revision in(BASE,TARGET):
  body=run(['git','show',revision+':'+n]);need(sha(body)==INDO_SCHEMA_SHA and body.count(ADMIN_INSERT_FRAGMENT)==1 and sha(ADMIN_INSERT_FRAGMENT)==ADMIN_INSERT_SHA,'reviewed-bootstrap-schema-and-unchanged-single-admin-conflict-fragment')
 run(['git','merge-base','--is-ancestor',BASE,TARGET])

def configuration(b):source(b,TARGET);environment_exact(b)

def compose_contract(b):
 expected=read(BACKUP/'compose-render.private.json');actual=json.loads(run([*COMPOSE,'config','--format','json']));need(actual==expected,'entire-compose-render-unchanged');return actual



def prepare(result,b):
 runtime,raw=B.runtime();need(runtime==b['runtime']and B.flags()==b['maintenanceInventory'],'original-runtime-before-build');environment_exact(b);operation(['git','-c','core.hooksPath=/dev/null','fetch','--no-write-fetch-head','origin','main'],'fetch-reviewed-main');need(run(['git','rev-parse','origin/main']).decode().strip()==TARGET,'exact-current-remote-main');head=run(['git','rev-parse','HEAD']).decode().strip();source(b,head)
 if head==BASE:operation(['git','-c','core.hooksPath=/dev/null','merge','--ff-only',TARGET],'source-fast-forward')
 configuration(b);compose_contract(b);replay_snapshot('indo-shipping',b['storage']['indo-shipping'],BACKUP/'indo-shipping-baseline');literal=envs();private('literal-environments.private.json',literal);tags={s:'rr-portal-'+s+'-pr1001:'+TARGET for s in ORDER};args=overlay(tags,literal,'build.private.yml',True)
 for service in ORDER:operation([*args,'build',service],'build-'+service,1800)
 images={s:json.loads(run(['docker','image','inspect',tags[s]]))[0]['Id']for s in ORDER};proofs={s:candidate(s,images[s],raw[s])for s in ORDER};rehearsals={s:key_restore_rehearsal(s,images[s],b['storage'][s],BACKUP/(s+'-baseline'),runtime)for s in ORDER};need(B.runtime()[0]==runtime and B.flags()==b['maintenanceInventory'],'all46-originals-serve-through-indo-build');configuration(b);private('prepared.private.json',{'target':TARGET,'tree':TREE,'images':images,'proofs':proofs,'originalRuntime':runtime,'keyRestoreRehearsals':rehearsals});result.update(success=True,prestartKeyRestoreRehearsalPassed=True,candidatesBuiltBeforeAnyMaintenance=True,targetContainerCount=1,otherContainerCount=45,all46OriginalContainersUnchanged=True,environmentFileUnchanged=True,images=images)

def key_restore_rehearsal(service,image,snapshot,path,before):
 need(service=='indo-shipping'and pin(image.removeprefix('sha256:'))and B.runtime()[0]==before,'exact-isolated-key-restore-rehearsal-image-and-original-runtime');cid=None;restored=False
 immutable=json.loads(run(['docker','image','inspect',image]))[0];need(immutable['Id']==image,'exact-immutable-rehearsal-image-id');image_labels=immutable['Config'].get('Labels')or{}
 original_user=read(BACKUP/'target-inspect.private.json')[service]['Config'].get('User');need(original_user in{'app','1654','1654:1654'}and original_user==immutable['Config'].get('User'),'rehearsal-user-exact-original-runtime-and-immutable-image')
 try:
  cid=run(['docker','create','--network','none','--log-driver','none','--restart','no','--entrypoint','tar','--user',original_user,image],timeout=45).decode().strip();need(pin(cid),'exact-self-created-rehearsal-identity');raw=json.loads(run(['docker','inspect',cid]))[0];private(service+'-key-rehearsal-created.private.json',raw);labels=raw['Config'].get('Labels')or{};need(raw['Id']==cid and raw['Image']==image and never_started(raw)and raw['Mounts']==[]and raw['HostConfig']['NetworkMode']=='none'and raw['HostConfig']['LogConfig']['Type']=='none'and raw['HostConfig']['RestartPolicy']['Name']=='no'and raw['Config']['Entrypoint']==['tar']and raw['Config']['User']==original_user and labels==image_labels,'isolated-never-started-no-network-no-logs-no-restart-key-rehearsal');ref={'observationKind':'running-pre-stop-stat','metadata':snapshot['keyring']['ancestors'],'observedUTC':snapshot['keyring']['ancestorObservationUTC']};proof,dest=restore_keys(service,cid,snapshot,path,ref,'key-rehearsal-copied-back');B.replay_keyring(proof,dest);restored=True
 finally:
  if cid is not None:
   current=json.loads(run(['docker','inspect',cid]))[0];need(current['Id']==cid and current['Image']==image and never_started(current),'remove-only-own-never-started-rehearsal-container');run(['docker','rm',cid],timeout=30)
 need(restored and B.runtime()[0]==before,'real-created-only-key-rehearsal-and-all46-originals-unchanged');return{'passed':True,'neverStarted':True,'keyring':proof,'containerId':cid}

def maintenance(fn,service):
 need(fn in{'maintenance_on','maintenance_off','wait_service_ready','require_maintenance_cleared'}and service in ORDER,'only-owned-indo-maintenance');operation(['bash','-c','set -euo pipefail; source "$1"; "$2" "$3"','pr996',str(ROOT/'deploy/service-maintenance.sh'),fn,service],fn+'-'+service,330,service=service)


def never_started(raw):
 state=raw['State'];return state.get('Status')=='created'and state.get('Running')is False and state.get('Pid')==0 and str(state.get('StartedAt','')).startswith('0001-01-01')and raw['RestartCount']==0 and state.get('OOMKilled')is False

def keyring_equal(a,c):
 need(a['entries']==c['entries']and a['ancestors']==c['ancestors'],'complete-keyring-and-ancestor-metadata-exact')

def restore_keys(service,cid,closed,path,ancestor_ref,label):
 B.replay_keyring(closed['keyring'],path);raw=json.loads(run(['docker','inspect',cid]))[0];need(raw['Id']==cid and never_started(raw),'restore-keys-only-before-first-start');run(['docker','cp','-a','-',cid+':/home/app'],(path/'keyring.private.tar').read_bytes(),45);dest=OUT/(service+'-'+label);dest.mkdir(mode=0o700);proof=B.capture_keyring(cid,dest,ancestor_ref);keyring_equal(closed['keyring'],proof);after=json.loads(run(['docker','inspect',cid]))[0];need(after==raw and never_started(after),'complete-created-identity-still-never-started-after-private-key-copy-back');private(service+'-'+label+'.private.json',proof);return proof,dest

def preserve_created_key_material(service,current,result):
 need(service=='indo-shipping'and never_started(current),'private-custody-only-never-started-owned-candidate');blob=run(['docker','cp','-a',current['Id']+':'+B.KEYRING_DEST,'-'],timeout=45);private(service+'-failed-created-keyring-custody.private.tar',blob);need(type(blob)is bytes and 0<len(blob)<=B.KEYRING_MAX,'bounded-complete-created-keyring-custody-before-recreate');private(service+'-failed-created-keyring-custody.private.json',{'containerId':current['Id'],'bytes':len(blob),'sha256':sha(blob),'reason':'preserve-all-material-before-candidate-recreate-even-if-invalid'});result['failedCreatedKeyMaterialRetainedPrivatelyBeforeRecreate']=True

def pg_only(service,label,expected,allowed):
 dest=OUT/(service+'-'+label);dest.mkdir(mode=0o700);value=B.indo_pg_capture(B.current_database_id(),dest,True);B.startup_guard(service,{'postgres':value},dest);private(service+'-'+label+'.private.json',value);indo_postgres(expected,value,allowed);return value,dest

def create_stopped(service,old,image,literal,args,revision,before,label):
 operation([*args,'up','--no-start','--force-recreate','--no-build','--no-deps','--pull','never',service],label,180);raw=B.current_target_record();private(service+'-'+label+'-raw.private.json',raw);full_contract(service,old,raw,image,literal,args,revision,created=True);current,_=B.runtime(False);unchanged_except(before,current,service)
 if revision==TARGET:
  p=prepared();need(p['images'][service]==image and p['proofs'][service]['reviewedSourceMatch']is True and json.loads(run(['docker','image','inspect',image]))[0]['Id']==image,'never-started-candidate-bound-to-sealed-prepared-full-source')
 return raw

def start_created(service,raw,label):
 current=json.loads(run(['docker','inspect',raw['Id']]))[0];need(current['Id']==raw['Id']and current['Image']==raw['Image']and never_started(current),'only-one-first-start-for-exact-created-container');operation(['docker','start',raw['Id']],label,80)




def recover(service,old,b,before,literal,rollback,closed,closed_path,attempted,stopped,result,ancestor_ref):
 need(service in ORDER,'only-owned-failed-service-recovery');maintenance('maintenance_on',service);owned_flags(b,service)
 if not attempted:
  current=json.loads(run(['docker','inspect',old['Id']]))[0];need(current['Id']==old['Id']and current['Image']==old['Image']and current['RestartCount']==old['RestartCount']and current['State']['OOMKilled']is False,'only-retained-original-container-no-create-attempt')
  if current['State']['Running']is False:
   if closed is not None:B.replay_keyring(closed['keyring'],closed_path)
   operation(['docker','start',old['Id']],'restart-only-original-'+service,80)
  maintenance('wait_service_ready',service);now,raw=B.runtime();unchanged_except(before,now,service);full_contract(service,old,raw[service],old['Image'],literal,rollback,None,allow_same=True)
  if closed is not None:
   after,ap=B.capture(service,'after-recovery');B.replay_snapshot(service,after,ap);same_data(service,closed,after,closed_path,ap,raw[service]['State']['StartedAt'])
  else:result['originalContainerRetainedWithoutClosedEvidenceOrDataRestore']=True
 else:
  need(closed is not None and closed_path is not None and ancestor_ref is not None,'no-image-recovery-without-fresh-closed-keyring-and-pg');B.replay_snapshot(service,closed,closed_path);ids=run([*rollback,'ps','-a','-q',service]).decode().split();need(len(ids)<=1,'at-most-one-owned-created-or-failed-candidate');comparison=closed;comparison_path=closed_path
  if ids:
   current=json.loads(run(['docker','inspect',ids[0]]))[0];need(current['RestartCount']==0 and current['State']['OOMKilled']is False,'no-ambiguous-multiple-boots-or-oom');did_start=not str(current['State'].get('StartedAt','')).startswith('0001-01-01')
   if current['State']['Running']:operation(['docker','stop','--time','60',current['Id']],'stop-failed-'+service,80)
   if did_start:
    failed,fp=B.capture(service,'failed-candidate',ancestor_ref);B.replay_snapshot(service,failed,fp);same_data(service,closed,failed,closed_path,fp,current['State']['StartedAt'],allowed_deltas=(0,1));comparison,comparison_path=failed,fp
   else:need(never_started(current),'created-only-failure-has-never-started');preserve_created_key_material(service,current,result);pg_only(service,'never-started-pg',closed['postgres'],(0,))
  else:pg_only(service,'absent-after-create-failure-pg',closed['postgres'],(0,))
  revision=(old['Config'].get('Labels')or{}).get('org.opencontainers.image.revision');created=create_stopped(service,old,old['Image'],literal,rollback,revision,before,'recover-create-only-'+service);restore_keys(service,created['Id'],closed,closed_path,ancestor_ref,'recovery-restored-keys-before-start');pg_only(service,'recovery-prestart-pg',comparison['postgres'],(0,));start_created(service,created,'start-recovered-only-'+service);maintenance('wait_service_ready',service);now,raw=B.runtime();unchanged_except(before,now,service);full_contract(service,old,raw[service],old['Image'],literal,rollback,revision);after,ap=B.capture(service,'after-recovery');B.replay_snapshot(service,after,ap);same_data(service,comparison,after,comparison_path,ap,raw[service]['State']['StartedAt'])
 need(proof(service,old['Image'],raw[service]['Id'],BASE)==b['sourceProof'][service]['files'],'recovered-original-full-source-and-assets');configuration(b);operation(['sleep','11'],'recovery-dns-'+service,20);maintenance('maintenance_off',service);maintenance('require_maintenance_cleared',service);cleared_flags(b);result['failedServiceRecoveredWithoutDataRestore']=True

def deploy(result,b):
 p=prepared();configuration(b);need(p['originalRuntime']==b['runtime']and envs()==read(PREPARE/'literal-environments.private.json')and all(p['keyRestoreRehearsals'][s]['passed']is True and p['keyRestoreRehearsals'][s]['neverStarted']is True for s in ORDER),'prepared-original-runtime-env-and-real-prestart-key-rehearsal-bound');before,raw=B.runtime();need(before==b['runtime']and B.flags()==b['maintenanceInventory'],'original-all46-before-switch');compose_contract(b);literal=envs();private('desired-runtime-environments.private.json',literal);args=overlay(p['images'],literal,'runtime.private.yml');rollback=overlay({s:raw[s]['Image']for s in ORDER},literal,'rollback.private.yml');evidence={}
 live,lp=B.capture('indo-shipping','fresh-live');B.replay_snapshot('indo-shipping',live,lp);private('fresh-live-backup.private.json',live);need(B.runtime()[0]==before,'all46-through-live-keyring-pg-backup')
 for service in ORDER:
  old=raw[service];closed=None;closed_path=None;attempted=False;stopped=False;ancestor_ref=None
  try:
   configuration(b);need(B.runtime()[0]==before and B.flags()==b['maintenanceInventory'],'stable-before-owned-maintenance');maintenance('maintenance_on',service);owned_flags(b,service);operation(['sleep','60'],'drain-'+service,70);ancestor_ref=B.ancestor_metadata(old['Id']);private(service+'-last-running-ancestors.private.json',ancestor_ref);operation(['docker','stop','--time','60',old['Id']],'stop-own-old-writer-'+service,80);stopped=True;stopped_runtime(before,old,service);closed,closed_path=B.capture(service,'closed-before',ancestor_ref);B.replay_snapshot(service,closed,closed_path);configuration(b);owned_flags(b,service);attempted=True;created=create_stopped(service,old,p['images'][service],literal,args,TARGET,before,'create-only-'+service);keys,kp=restore_keys(service,created['Id'],closed,closed_path,ancestor_ref,'restored-keys-before-start');pg,pp=pg_only(service,'candidate-prestart-pg',closed['postgres'],(0,));prestart={'createdId':created['Id'],'keyring':keys,'postgres':pg,'neverStarted':True};private(service+'-prestart-proof.private.json',prestart);start_created(service,created,'start-only-'+service);maintenance('wait_service_ready',service);now,newraw=B.runtime();new=newraw[service];started={'candidateStartedAt':new['State']['StartedAt'],'containerId':new['Id'],'image':new['Image']};private(service+'-candidate-started.private.json',started);full_contract(service,old,new,p['images'][service],literal,args,TARGET);need(proof(service,p['images'][service],new['Id'])==p['proofs'][service],'running-source-equals-prepared');unchanged_except(before,now,service);post,post_path=B.capture(service,'after-start');B.replay_snapshot(service,post,post_path);counts=same_data(service,closed,post,closed_path,post_path,started['candidateStartedAt']);audit={'candidateStartedAt':started['candidateStartedAt'],'afterSnapshotObservedUTC':post['observedUTC'],'dataDeltaEvidence':counts,'allBusinessTypedRowsSchemaAndPrivateKeyringPreserved':True};private(service+'-closed-comparison.private.json',audit);evidence[service]={'before':closed,'after':post,'started':started,'audit':audit,'preStart':prestart,'ancestorRef':ancestor_ref};configuration(b);owned_flags(b,service);operation(['sleep','11'],'dns-grace-'+service,20);maintenance('maintenance_off',service);maintenance('require_maintenance_cleared',service);cleared_flags(b);result.setdefault('public',{})[service]=public(service,p['proofs'][service]);need(B.runtime()[0]==now,'all46-stable-after-public');before=now;result['completedServices']=[service]
  except BaseException:
   result['failedService']=service
   try:recover(service,old,b,before,literal,rollback,closed,closed_path,attempted,stopped,result,ancestor_ref)
   except BaseException:result['failedServiceRetainsOwnMaintenance']=True;private(service+'-recovery-failure.private.txt',traceback.format_exc().encode())
   raise
 configuration(b);compose_contract(b);cleared_flags(b);private('closed-evidence.private.json',evidence);private('final-runtime.private.json',before);result.update(success=True,images=p['images'],allOther45ContainersUnchanged=True,allBusinessTypedRowsSchemaFilesAndModeOwnersPreserved=True,fullTypedRowsIncludingCustomerAndSchemaExact=True,entireEnvironmentFileAndRuntimeEnvironmentsUnchanged=True,allMaintenanceFlagsRestored=True,buildsPerformed=False,freshLiveIndoBackupBeforeMaintenance=True,dataProtectionKeyringPreservedBeforeStart=True,dataProtectionKeyringPostStartExact=True,ancestorMetadataMatchesPreStop=True,keyMaterialPrintedOrSubmittedToGit=False)

def verify(result,b):
 p=prepared();receipt=sealed(DEPLOY,DEPLOY_MANIFEST,DEPLOY_RESULT,'deploy');need(receipt.get('completedServices')==list(ORDER)and receipt.get('buildsPerformed')is False and all(receipt.get(k)is True for k in('dataProtectionKeyringPreservedBeforeStart','dataProtectionKeyringPostStartExact','ancestorMetadataMatchesPreStop'))and receipt.get('keyMaterialPrintedOrSubmittedToGit')is False,'key-preserving-scoped-deploy-success');configuration(b);compose_contract(b);literal=envs();need(literal==read(DEPLOY/'desired-runtime-environments.private.json')and p['originalRuntime']==b['runtime'],'prepared-and-deployed-full-env-binding');current,raw=B.runtime();need(current==read(DEPLOY/'final-runtime.private.json')and current['others']==b['runtime']['others'],'current-final-runtime-and-original45');cleared_flags(b);evidence=read(DEPLOY/'closed-evidence.private.json');need(set(evidence)==set(ORDER),'sealed-closed-keyring-pg-evidence');oldraw=read(BACKUP/'target-inspect.private.json');args=[*COMPOSE,'-f',str(DEPLOY/'runtime.private.yml')];live=read(DEPLOY/'fresh-live-backup.private.json');need(live==read(DEPLOY/'indo-shipping-fresh-live.private.json'),'fresh-live-backup-capture-binding');replay_snapshot('indo-shipping',live,DEPLOY/'indo-shipping-fresh-live')
 for service in ORDER:
  e=evidence[service];a,c,started,audit=(e[k]for k in('before','after','started','audit'));ap=DEPLOY/(service+'-closed-before');cp=DEPLOY/(service+'-after-start');need(read(DEPLOY/(service+'-closed-before.private.json'))==a and read(DEPLOY/(service+'-after-start.private.json'))==c,'sealed-capture-binding');replay_snapshot(service,a,ap);replay_snapshot(service,c,cp);pre=e['preStart'];need(pre==read(DEPLOY/(service+'-prestart-proof.private.json'))and pre['neverStarted']is True and pre['createdId']==raw[service]['Id'],'actual-prestart-current-candidate-binding');created=read(DEPLOY/(service+'-create-only-'+service+'-raw.private.json'));need(never_started(created)and created['Id']==pre['createdId']and created['Image']==p['images'][service],'sealed-created-before-first-start-candidate-identity');full_contract(service,oldraw[service],created,p['images'][service],literal,args,TARGET,created=True);B.replay_keyring(pre['keyring'],DEPLOY/(service+'-restored-keys-before-start'));keyring_equal(a['keyring'],pre['keyring']);need(read(DEPLOY/(service+'-candidate-prestart-pg')/'postgres.private.json')==pre['postgres'],'sealed-prestart-pg-binding');B.startup_guard(service,{'postgres':pre['postgres']},DEPLOY/(service+'-candidate-prestart-pg'));indo_postgres(a['postgres'],pre['postgres'],(0,));need(e['ancestorRef']==read(DEPLOY/(service+'-last-running-ancestors.private.json'))and e['ancestorRef']['metadata']==a['keyring']['ancestors'],'explicit-pre-stop-reference-bound');need(started=={'candidateStartedAt':raw[service]['State']['StartedAt'],'containerId':raw[service]['Id'],'image':p['images'][service]}and read(DEPLOY/(service+'-candidate-started.private.json'))==started,'same-current-and-sealed-started-candidate');counts=same_data(service,a,c,ap,cp,started['candidateStartedAt']);expected={'candidateStartedAt':started['candidateStartedAt'],'afterSnapshotObservedUTC':c['observedUTC'],'dataDeltaEvidence':counts,'allBusinessTypedRowsSchemaAndPrivateKeyringPreserved':True};need(audit==expected and read(DEPLOY/(service+'-closed-comparison.private.json'))==expected,'closed-pg-and-keyring-audit-reproduced');full_contract(service,oldraw[service],raw[service],p['images'][service],literal,args,TARGET);need(proof(service,p['images'][service],raw[service]['Id'])==p['proofs'][service],'actual-source-equals-prepared');result.setdefault('public',{})[service]=public(service,p['proofs'][service])
 configuration(b);need(B.runtime()[0]==current,'all46-stable-through-readonly-verification');cleared_flags(b);private('verified-runtime.private.json',current);result.update(success=True,images=p['images'],indoPreparedSourceAndRuntimeContractVerified=True,indoSealedClosedDataCheckReproduced=True,allOther45ContainersUnchanged=True,entireEnvironmentFileAndRuntimeEnvironmentsUnchanged=True,allMaintenanceFlagsRestored=True,freshLiveBusinessComparisonPerformed=False,buildsPerformed=False,dataProtectionKeyringPreservedBeforeStart=True,dataProtectionKeyringPostStartExact=True,ancestorMetadataMatchesPreStop=True,sealedClosedKeyringCheckReproduced=True,keyMaterialPrintedOrSubmittedToGit=False,fullTypedRowsIncludingCustomerAndSchemaExact=True)

def main():
 global OUT,EXPECTED_ENV
 need(PHASE in{'prepare','deploy','verify'}and sys.argv[1:]==[PHASE]and os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_ATTEMPT')=='1'and pin(TARGET,40)and pin(TREE,40)and pin(SOURCE_MANIFEST_SHA),'blank-draft-or-wrong-phase-branch-attempt-target');os.umask(0o077);OUT={'prepare':PREPARE,'deploy':DEPLOY,'verify':VERIFY}[PHASE];OUT.mkdir(mode=0o700);initialize();signal.signal(signal.SIGTERM,lambda *_:need(False,'terminated'));result={'mode':PHASE,'base':BASE,'target':TARGET,'tree':TREE,'success':False,'businessWritesPerformed':False,'schemaOrDerivedCustomerChangesPermitted':False,'databaseRestoreOrCursorResetPerformed':False,'modelCallsPerformed':False,'authenticatedBusinessWritesPerformed':False,'otherServicesRequested':False,'secretOrRowsPrinted':False,'environmentConfigurationChanged':False,'indoSequencePolicy':'only-exact-unchanged-bootstrap-admin-identity-plus-one-no-reset-no-actor-attribution'}
 try:
  b=baseline();EXPECTED_ENV=(BACKUP/'environment.private').read_bytes();{'prepare':prepare,'deploy':deploy,'verify':verify}[PHASE](result,b);baseline()
 except BaseException as error:result.update(success=False,failedStage=STAGE,backupLibraryFailedStage=B.STAGE,safeExceptionType=type(error).__name__);private('failure.private.txt',traceback.format_exc().encode())
 finally:private('first-result.json',result);B.F.OPS.L.seal(OUT);print(enc(dict(result,manifestSHA256=B.F.OPS.L.file_hash(OUT/'manifest.json'),resultSHA256=B.F.OPS.L.file_hash(OUT/'first-result.json'))).decode(),flush=True)
 return 0 if result['success']else 1
if __name__=='__main__':
 try:sys.exit(main())
 except SystemExit:raise
 except BaseException:print('{"mode":"rejected","success":false,"safeFailure":"PR1001_RELEASE_PREFLIGHT_REJECTED"}',flush=True);sys.exit(1)
