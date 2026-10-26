"""PR1008 fresh05 PrintLink prepare/deploy/verify; runtime gates remain blank.
Use a fresh actual-current backup05 and recertify immutable 7cc; never rebuild.
No environment changes, DB restore, authenticated writes or model calls.
"""
import contextlib,copy,datetime,hashlib,importlib.util,io,json,os,pathlib,re,signal,stat,subprocess,sys,tarfile,traceback,urllib.error,urllib.request
PHASE='verify'
TARGET='bb1fab660bdf4e04e828e4c4250279f717603ac5'
TREE='72baeafdefab7f2abf01be09f941f31ec8b623fa'
SOURCE_MANIFEST_SHA='c73c0f11264192d40a06e16185d356168098ac0c19da66cf15ee05292a5ba734' # Root binds final reviewed source manifest.
REVIEWED_PATHS=('README.md', 'cloud/public/app.js', 'cloud/public/style.css', 'cloud/server.mjs', 'tests/order-browser.test.mjs', 'tests/orders.test.mjs') # Root binds exact final reviewed app-relative paths.
BASE='37b6146354f692dfabc8b009f6c5b80ced091bdb'
BASE_TREE='2ae9b60d6aa627005d5937298fa84386b3572054'
BRANCH='refs/heads/ops/pr-1008-20261026-02'
ROOT=pathlib.Path('/opt/rr-portal')
BACKUP=ROOT/'deploy/backups/pr-1008-20261026-05-backup'
PREPARE=BACKUP.with_name('pr-1008-20261026-05-prepare')
DEPLOY=BACKUP.with_name('pr-1008-20261026-05-deploy')
VERIFY=BACKUP.with_name('pr-1008-20261026-05-verify')
BACKUP_MANIFEST='7e0e9a42b3298802e1dde8145dddc67af93f61614a2322885b2f1d9d10c94bf0';BACKUP_RESULT='4b150d0fa39f9f1362d226cdb12f8da415cc0ec6c6d95b190d27131acf4882fb';PREPARE_MANIFEST='cb1ad89a1076feb38cb591c2eeb713ebcb5c7012c368cc3909e17d2b19674d53';PREPARE_RESULT='a38a3a82a03ab52f0cf68ce8cb31f2d32095e01379c601f6a1a321347df046ad';DEPLOY_MANIFEST='b3093c3bbfc50a2904e4979d47897f1855085b0f336208c647d4652ece6ec60a';DEPLOY_RESULT='2b63c335e623883e0876cd3c59da802d4ed40035f15a86f0648785b5c3c641fb'
ORDER=('printlink',)
REUSED_CANDIDATE_IMAGE='sha256:7cc8e9f25c895fe97f302357058a9ceb07ecc7c5a204ab53958a8ecfa8666684'
DEPS={'pr1008-02-publication-ingress-profile.json': 'c0c279e91c9b55a119e3755801964d3f586752999d3df6a260ac4697dd018e0e', 'pr1008-04-publication-ingress-library.py': 'b34cd0fcce033076b4e72bb875588eb982b37f7c12d8b25707b48031f9ab950d', 'pr1008-05-backup-library.py': 'd816776bcad1b70d893e9f25cef05c2ece2d0d97639adca5c48c865ea1b947b3', 'pr1008-printlink-contract-library.py': '97a14ebb6a93034cf6531880d8852151472ec49f7881a136648376b602a36882', 'batch-host-config-library.py': 'bd1842dc6847f3e0e5c0c38374c3604791f66d1c94dc651457607dc338f38ff1', 'factory-review-backup-library.py': '79d76bb47312dd08c121ebe2797f54d958666f8b72d00721f67712b152fc4666', 'release-data-ops-library.py': 'ff9138a1d5bfed1b10077112da6ebcda2d65240f583e2d0e12ce1325cfbaafd5', 'release-data-library.py': 'd63168fd3057f4f2aba2d93f9fab31d2d65c6dd0f3234877d71fcff1e04e62b9'}
COMPOSE=['docker','compose','-p','rr-portal','-f',str(ROOT/'docker-compose.cloud.yml'),'--env-file',str(ROOT/'.env.cloud.production')]
B=None;H=None;D=None;G=None;LEASE=None;OUT=None;ENV=None;EXPECTED_ENV=None;STAGE='entrypoint';SERIAL=0
def need(v,label):
 global STAGE
 if not v:STAGE=label;raise RuntimeError('PR1008_RELEASE_REJECTED')

def enc(v):return json.dumps(v,ensure_ascii=True,sort_keys=True,separators=(',',':'),allow_nan=False).encode()

def sha(v):return hashlib.sha256(v).hexdigest()

def read(p):return json.loads(p.read_bytes())

def pin(v,length=64):return type(v)is str and re.fullmatch('[a-f0-9]{%d}'%length,v)is not None

def wire_nibbles(value):
 need(pin(value),'nonsecret-wire-sha256');return[int(c,16)for c in value]

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
 global B,H,D,G,ENV
 for n,h in DEPS.items():
  p=pathlib.Path(__file__).with_name(n);need(pin(h)and p.is_file()and not p.is_symlink()and sha(p.read_bytes())==h,'all-transitive-frozen-dependencies')
 B=load('pr1008-05-backup-library.py');need(B.BACKUP_PIN is False and B.BASE==BASE and B.BASE_TREE==BASE_TREE and B.SERVER_HEAD==TARGET and B.SERVER_TREE==TREE and B.ORIGINAL_IMAGE=='sha256:5d48e2e4e4557988e56fb3e27d28c38eab98410244783e31d169466b0fb476f4'and B.ORDER==ORDER,'inert-exact-backup-library');B.ROOT=ROOT;B.CONFIGURATION_ARCHIVE=BACKUP;B.initialize(OUT);H=load('batch-host-config-library.py');D=load('pr1008-printlink-contract-library.py');G=load('pr1008-04-publication-ingress-library.py');native_host=H.same_host_config
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
 need(set(images)==set(literal)==set(ORDER),'overlay-exact-production-printlink');lines=['services:']
 for s in ORDER:
  need(type(literal[s])is dict and all(type(k)is str and type(v)is str for k,v in literal[s].items()),'literal-environment-map');lines+=['  '+s+':','    image: '+images[s],'    pull_policy: never','    environment: !override '+json.dumps({k:v.replace('$','$$')for k,v in literal[s].items()},ensure_ascii=True)]
  if build:
   lines+=['    build:','      labels: '+json.dumps({'org.opencontainers.image.revision':TARGET})]
 private(name,('\n'.join(lines)+'\n').encode());args=[*COMPOSE,'-f',str(OUT/name)];render=json.loads(run([*args,'config','--format','json']))
 for s in ORDER:need(render['services'][s]['image']==images[s]and render['services'][s]['environment']=={k:v.replace('$','$$')for k,v in literal[s].items()},'rendered-full-literal-environment')
 return args

def proof(service,image,cid=None,revision=None):
 need(service=='printlink','only-printlink-source-proof');revision=revision or TARGET;expected=B.copy_paths(revision);prefix=['docker','exec','--user','0',cid,'tar']if cid else['docker','run','--rm','--user','0','--network','none','--read-only','--log-driver','none','--entrypoint','tar',image];blob=run([*prefix,'-C','/app','-cf','-','package.json','start.mjs','cloud','production','ops','shared']);found={};total=0
 with tarfile.open(fileobj=io.BytesIO(blob),mode='r:')as archive:
  for m in archive:
   n=m.name.rstrip('/');need(B.F.OPS.L.safe_path(n)and(m.isdir()or m.isfile()),'safe-regular-candidate-copy-source')
   if m.isdir():continue
   need(n in expected and n not in found and m.size<=32*1024**2,'exact-only-reviewed-copy-files');total+=m.size;need(total<=128*1024**2,'bounded-printlink-candidate-source');data=archive.extractfile(m).read();need(len(data)==m.size,'complete-printlink-candidate-source');found[n]={'sha256':sha(data),'mode':m.mode&0o777}
 need(found==expected,'every-candidate-copy-byte-and-mode-equals-reviewed-git');return found

def candidate(s,image,old):
 i=json.loads(run(['docker','image','inspect',image]))[0];original=read(BACKUP/(s+'-image.private.json'));need(i['Id']==image and original['Id']==old['Image']and i['Architecture']==original['Architecture']=='amd64'and i['Os']==original['Os']=='linux'and(i['Config'].get('Labels')or{}).get('org.opencontainers.image.revision')==TARGET,'exact-candidate-platform-revision')
 for k in('Cmd','Entrypoint','User','WorkingDir','Healthcheck','ExposedPorts','Volumes','StopSignal','Shell','ArgsEscaped','StopTimeout'):need(i['Config'].get(k)==original['Config'].get(k),'candidate-image-default-'+k.lower())
 oldlabels=original['Config'].get('Labels')or{};newlabels=i['Config'].get('Labels')or{};need({k:v for k,v in oldlabels.items()if k!='org.opencontainers.image.revision'}=={k:v for k,v in newlabels.items()if k!='org.opencontainers.image.revision'},'unchanged-other-image-labels');need(dict(B.F.envmap(i['Config'].get('Env')or[]),**envs()[s])==envs()[s],'candidate-default-environment-covered-by-original-literal');need(i['Config'].get('Env')==original['Config'].get('Env'),'candidate-default-env-byte-list-unchanged');private(s+'-candidate-image.private.json',i);return proof(s,image)

def prepared():
 receipt=sealed(PREPARE,PREPARE_MANIFEST,PREPARE_RESULT,'prepare');need(receipt.get('buildsPerformed')is False and receipt.get('candidatesReusedWithoutBuild')is True and receipt.get('alreadyBuiltCandidateFullyRecertified')is True,'successful-fresh-prepare-recertifies-existing-candidate-without-build');p=read(PREPARE/'prepared.private.json');need(p['target']==TARGET and p['tree']==TREE and p['images']=={'printlink':REUSED_CANDIDATE_IMAGE}and set(p['images'])==set(p['proofs'])==set(ORDER)and p.get('candidateReusedWithoutBuild')is True,'exact-prepared-source-and-services');need(all(re.fullmatch('sha256:[a-f0-9]{64}',v)for v in p['images'].values()),'immutable-prepared-image-identities');return p

def cleared_flags(b):need(B.flags()==b['maintenanceInventory'],'every-original-nginx-maintenance-flag-unmodified')

def unchanged_except(before,after,s):need(after['others']==before['others']and all(after['targets'][x]==before['targets'][x]for x in ORDER if x!=s),'all45-other-container-unchanged')

def stopped_runtime(before,old,s):
 current,raw=B.runtime(False);unchanged_except(before,current,s);a,c=before['targets'][s],current['targets'][s];need(raw[s]['Id']==old['Id']and c['running']is False and all(a[k]==c[k]for k in('id','image','started','restarts','environmentMapSHA256','mounts','configSHA256','hostConfigSHA256')),'only-owned-old-writer-stopped-with-original-contract');return current

def full_contract(s,old,new,image,literal,args,revision,allow_same=False):
 same=new['Id']==old['Id'];need((allow_same or not same)and new['Image']==image and new['Config'].get('Image')==(old['Config']['Image']if same else image)and new['RestartCount']==(old['RestartCount']if same else 0)and new['State']['Running']is True and new['State']['OOMKilled']is False and new['State'].get('Health',{}).get('Status')=='healthy','healthy-immutable-running-image');need(H.same_host_config(old['HostConfig'],new['HostConfig'])and sorted(old['Mounts'],key=enc)==sorted(new['Mounts'],key=enc),'complete-hostconfig-mounts');a,c=copy.deepcopy(old['Config']),copy.deepcopy(new['Config']);left=a.pop('Labels')or{};right=c.pop('Labels')or{};need(a.pop('Hostname')==old['Id'][:12]and c.pop('Hostname')==new['Id'][:12],'only-automatic-config-hostname');a.pop('Image');c.pop('Image');a.pop('Env');c.pop('Env');need(a==c and B.F.envmap(new['Config']['Env'])==literal[s],'complete-runtime-config-and-literal-env');need(B.process_environment(new['Id'])==expected_process(s,literal),'complete-original-pid1-environment')
 if new['Id']==old['Id']:need(right==left,'unrecreated-original-labels');return
 expected=copy.deepcopy(left);expected['com.docker.compose.image']=image;expected['com.docker.compose.project.config_files']=','.join([str(ROOT/'docker-compose.cloud.yml'),args[-1]]);hashes=run([*args,'config','--hash',s]).decode().split();need(len(hashes)==2 and hashes[0]==s and pin(hashes[1]),'exact-compose-service-config-hash');expected['com.docker.compose.config-hash']=hashes[1]
 if revision is not None:expected['org.opencontainers.image.revision']=revision
 need(right==expected,'only-exact-image-revision-and-compose-labels')

def lock_owner(value,path):
 rows=[r for r in value['files']if r['path']=='.platform-lock/owner.json']
 if not rows:return None
 need(len(rows)==1 and rows[0]['directory']is False and 0<rows[0]['bytes']<=2048,'exact-bounded-lock-file-inventory');p=path/'files.tar';need(p.is_file()and not p.is_symlink(),'regular-sealed-lock-archive');before=p.stat()
 with tarfile.open(p,'r:')as archive:
  entries=[m for m in archive if m.name=='.platform-lock/owner.json'];need(len(entries)==1 and entries[0].isfile()and entries[0].size==rows[0]['bytes'],'one-complete-operational-lock-member');content=archive.extractfile(entries[0]).read();need(len(content)==rows[0]['bytes']and sha(content)==rows[0]['sha256'],'exact-operational-lock-archive-bytes');owner=json.loads(content)
 after=p.stat();need((before.st_dev,before.st_ino,before.st_size,before.st_mtime_ns,before.st_ctime_ns)==(after.st_dev,after.st_ino,after.st_size,after.st_mtime_ns,after.st_ctime_ns),'stable-sealed-lock-archive');return owner

def same_data(s,a,c,ap,cp,started,after_running=True):
 need(s=='printlink','only-printlink-data-contract')
 if after_running:return D.same_closed_data(a,c,lock_owner(c,cp),started)
 D.validate_lock(a,None,None,None,False);D.validate_lock(c,None,None,None,False);need(D.strict_equal(a['sqlite'],c['sqlite'])and set(a['sqlite'])==D.DATABASES and D.strict_equal(a['files'],c['files'])and D.strict_equal(a['fileOwnership'],c['fileOwnership'])and D.strict_equal(a['metadata'],c['metadata']),'failed-closed-candidate-all-typed-rows-schema-sequence-files-mode-owners-exact');return{'bothClosedBusinessAndTelemetryExactlyIdentical':True,'databaseFamilyModeOwnerEvidence':D.database_family(a['databaseFamilyMetadata'],c['databaseFamilyMetadata'])}

def replay_snapshot(s,value,path):B.replay_snapshot(s,value,path)

def request(path,method='GET',data=None):
 need(path.startswith('/')and'..'not in path and method=='GET'and data is None,'bounded-readonly-public-request')
 class NoRedirect(urllib.request.HTTPRedirectHandler):
  def redirect_request(self,*args,**kwargs):return None
 req=urllib.request.Request('http://127.0.0.1:3100'+path,method='GET',headers={'Host':'8.148.146.194','Cache-Control':'no-cache'});opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),NoRedirect())
 try:
  with opener.open(req,timeout=20)as r:body=r.read(16*1024**2+1);need(len(body)<=16*1024**2,'bounded-public-static-response');return r.status,body
 except urllib.error.HTTPError as error:return error.code,error.read(8192)

def public(s,files):
 need(s=='printlink','only-printlink-public-target');status,body=request('/api/health');need(status==200 and json.loads(body)=={'ok':True},'printlink-public-health');selected={'/':'cloud/public/index.html','/app.js':'cloud/public/app.js','/style.css':'cloud/public/style.css'}
 for route,name in selected.items():
  status,body=request(route);need(status==200 and sha(body)==files[name]['sha256'],'printlink-public-static-exact-reviewed-candidate')
 need(request('/api/orders')[0]==401 and request('/api/files/00000000-0000-4000-8000-000000000000')[0]==401,'anonymous-business-and-attachment-access-rejected');return{'health':200,'staticFilesMatchCandidate':True,'staticAssetsSHA256':{route:files[name]['sha256']for route,name in selected.items()},'anonymousOrders':401,'anonymousAttachment':401,'authenticatedBusinessOrDownloadRequestsPerformed':False}

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
 r=sealed(BACKUP,BACKUP_MANIFEST,BACKUP_RESULT,'backup');need(r.get('backupComplete')is True and r.get('portableSQLiteCount')==2 and r.get('targetContainerCount')==1 and r.get('otherContainerCount')==45 and r.get('printlinkRuntimeAllDockerCopyBytesAndModesMatchBase')is True and r.get('serverHead')==TARGET and r.get('serverTree')==TREE and r.get('runningSourceBase')==BASE and r.get('runningSourceTree')==BASE_TREE,'complete-fresh-backup-distinguishes-server-head-and-original-running-source');b=read(BACKUP/'baseline.private.json');need(b['head']==TARGET and b['tree']==TREE and b.get('runningSourceBase')==BASE and b.get('runningSourceTree')==BASE_TREE and set(b['runtime']['targets'])==set(ORDER)and len(b['runtime']['others'])==45 and set(b['storage'])==set(ORDER)==set(b['sourceProof']),'fresh-actual-current-production-printlink-baseline');old=b['runtime']['targets']['printlink'];need(old['image']==B.ORIGINAL_IMAGE and type(old['restarts'])is int and old['restarts']==0,'fresh-original-zero-restart-baseline-supports-exact-old-recovery-contract');return b

def reviewed_manifest():
 p=pathlib.Path(__file__).with_name('pr1008-05-reviewed-files.json');need(pin(SOURCE_MANIFEST_SHA)and p.is_file()and not p.is_symlink()and sha(p.read_bytes())==SOURCE_MANIFEST_SHA,'reviewed-source-manifest-pin');value=read(p);need(type(REVIEWED_PATHS)is tuple and 2<=len(REVIEWED_PATHS)<=20 and len(set(REVIEWED_PATHS))==len(REVIEWED_PATHS)and all(B.F.OPS.L.safe_path(n)and(n in{'README.md','cloud/server.mjs','cloud/public/app.js','cloud/public/style.css'}or n.startswith('tests/'))for n in REVIEWED_PATHS),'exact-final-reviewed-printlink-frontend-server-doc-test-paths');need(type(value)is dict and set(value)=={B.PRINT+'/'+n for n in REVIEWED_PATHS}and all(pin(h)for h in value.values()),'exact-reviewed-printlink-only-source-inventory');return value

def unchanged_startup(manifest):
 name=B.PRINT+'/cloud/server.mjs';before=run(['git','show',BASE+':'+name]);after=run(['git','show',TARGET+':'+name]);anchor=b'const safeUser =';need(before.count(anchor)==after.count(anchor)==1 and before.split(anchor,1)[0]==after.split(anchor,1)[0],'entire-existing-cloud-startup-schema-seeding-cleanup-prefix-byte-identical');need(set(B.copy_paths(BASE))==set(B.copy_paths(TARGET)),'all-existing-docker-copy-source-paths-preserved')
 for relative in B.copy_paths(BASE):
  if B.PRINT+'/'+relative not in manifest:need(run(['git','ls-tree',BASE,'--',B.PRINT+'/'+relative])==run(['git','ls-tree',TARGET,'--',B.PRINT+'/'+relative]),'all-other-startup-production-sync-lock-health-source-and-mode-identical')

def source(b,revision):
 need(run(['git','symbolic-ref','--quiet','HEAD']).decode().strip()=='refs/heads/main'and run(['git','rev-parse','HEAD']).decode().strip()==revision and revision in{BASE,TARGET},'canonical-known-main-revision');manifest=reviewed_manifest();names=run(['git','diff','--name-only','-z',BASE,TARGET]).decode().rstrip('\0').split('\0');need(len(names)==len(set(names))==len(manifest)and set(names)==set(manifest)and not set(names)&set(b['preexistingFourDirty']),'exact-reviewed-printlink-frontend-diff');need(run(['git','rev-parse',TARGET+'^{tree}']).decode().strip()==TREE,'exact-reviewed-target-tree');need(B.dirty_snapshot()==b['preexistingFourDirty'],'four-existing-dirty-files-identical');run(['git','diff','--quiet','--no-ext-diff','--no-textconv','--',*B.APPS])
 for n,h in manifest.items():
  need(sha(run(['git','show',TARGET+':'+n]))==h,'all-reviewed-git-file-hashes')
  if revision==TARGET:
   p=ROOT/n;entry=run(['git','ls-tree','-z',TARGET,'--',n]);need(re.fullmatch(b'100(?:644|755) blob [a-f0-9]{40}\t'+re.escape(n.encode())+b'\0',entry)is not None,'reviewed-regular-source-mode')
   for ancestor in(p,*p.parents):
    if ancestor==ROOT:break
    need(not ancestor.is_symlink(),'reviewed-source-no-symlink-ancestors')
   need(p.is_file()and B.F.OPS.L.file_hash(p)==h and stat.S_IMODE(p.stat().st_mode)==(0o755 if entry.startswith(b'100755')else 0o644),'reviewed-canonical-file-bytes-mode')
 for n in B.FIXED:need((ROOT/n).is_file()and not(ROOT/n).is_symlink()and(ROOT/n).read_bytes()==run(['git','show',BASE+':'+n])and B.meta(ROOT/n)=={k:b['configuration'][n][k]for k in('mode','uid','gid')},'all-fixed-configuration-and-mode-owners-preserved')
 for n in B.FIXED:need(run(['git','rev-parse',BASE+':'+n])==run(['git','rev-parse',TARGET+':'+n]),'unchanged-global-docker-dependencies-and-migrations')
 unchanged_startup(manifest)
 run(['git','merge-base','--is-ancestor',BASE,TARGET])

def configuration(b):source(b,TARGET);environment_exact(b)

def compose_contract(b):
 expected=read(BACKUP/'compose-render.private.json');actual=json.loads(run([*COMPOSE,'config','--format','json']));need(actual==expected,'entire-compose-render-unchanged');return actual

def prepare(result,b):
 # This phase certifies the already-built immutable candidate against the fresh
 # real baseline. It never fetches, merges, builds, pulls or starts the app.
 configuration(b);compose_contract(b);runtime,raw=B.runtime();need(D.strict_equal(runtime,b['runtime'])and B.flags()==b['maintenanceInventory'],'fresh-all46-runtime-and-flags-before-candidate-recertification');literal=envs();private('literal-environments.private.json',literal);images={'printlink':REUSED_CANDIDATE_IMAGE};proofs={s:candidate(s,images[s],raw[s])for s in ORDER};need(D.strict_equal(B.runtime()[0],runtime)and B.flags()==b['maintenanceInventory'],'all46-current-originals-unchanged-through-candidate-recertification');configuration(b);compose_contract(b);need(envs()==literal,'all-literal-environments-unchanged-through-recertification');private('prepared.private.json',{'target':TARGET,'tree':TREE,'images':images,'proofs':proofs,'originalRuntime':runtime,'candidateReusedWithoutBuild':True,'backupServerHead':b['head'],'backupRunningSourceBase':b['runningSourceBase']});result.update(success=True,buildsPerformed=False,candidatesReusedWithoutBuild=True,alreadyBuiltCandidateFullyRecertified=True,targetContainerCount=1,otherContainerCount=45,all46OriginalContainersUnchanged=True,environmentFileUnchanged=True,images=images)


def maintenance(fn,service):
 need(fn=='wait_service_ready'and service=='printlink','only-readiness-no-false-nginx-isolation');operation(['bash','-c','set -euo pipefail; source "$1"; "$2" "$3"','pr1008',str(ROOT/'deploy/service-maintenance.sh'),fn,service],fn+'-'+service,330,service=service)

def ingress_preflight(b):
 global LEASE
 need(LEASE is None,'one-ingress-lease-per-phase');LEASE=G.Lease(run,operation,private,OUT,BACKUP,b);LEASE.preflight()
def ingress_enter(b):need(LEASE is not None,'reviewed-ingress-lease-present');LEASE.enter()
def ingress_held(b):need(LEASE is not None,'ingress-lease-present');return LEASE.held()
def ingress_release(b,recovery=False):need(LEASE is not None,'ingress-lease-present');LEASE.release(recovery=recovery)
def ingress_cleared(b):
 global LEASE
 if LEASE is None:LEASE=G.Lease(run,operation,private,OUT,BACKUP,b)
 return LEASE.cleared()

def recover(service,old,b,before,literal,rollback,closed,closed_path,attempted,stopped,result):
 need(service=='printlink'and ingress_held(b),'only-held-owned-failed-service-recovery');need(B.flags()==b['maintenanceInventory'],'all-nginx-flags-unmodified');need(not stopped or closed is not None,'never-restart-without-fresh-closed-business-evidence')
 if stopped:replay_snapshot(service,closed,closed_path)
 if attempted:
  current=run([*rollback,'ps','-a','-q',service]).decode().strip();need(re.fullmatch('[a-f0-9]{12,64}',current)is not None,'one-owned-failed-candidate');operation(['docker','stop','--time','60',current],'stop-failed-printlink',80);ingress_held(b);failed,fp=B.capture(service,'failed-candidate');private(service+'-failed-raw-before-comparison.private.json',failed);replay_snapshot(service,failed,fp);same_data(service,closed,failed,closed_path,fp,None,after_running=False);operation([*rollback,'up','-d','--force-recreate','--no-build','--no-deps','--pull','never',service],'recover-only-printlink',180)
 elif stopped:operation(['docker','start',old['Id']],'restart-only-original-printlink',80)
 maintenance('wait_service_ready',service);now,raw=B.runtime();unchanged_except(before,now,service);revision=(old['Config'].get('Labels')or{}).get('org.opencontainers.image.revision');full_contract(service,old,raw[service],old['Image'],literal,rollback,revision,allow_same=True);need(proof(service,old['Image'],raw[service]['Id'],BASE)==b['sourceProof'][service]['files'],'recovered-original-full-source')
 if closed is not None:
  after,ap=B.capture(service,'after-recovery');private(service+'-recovery-raw-before-comparison.private.json',after);replay_snapshot(service,after,ap);same_data(service,closed,after,closed_path,ap,raw[service]['State']['StartedAt'])
 configuration(b);compose_contract(b);cleared_flags(b);public(service,b['sourceProof'][service]['files']);need(B.runtime()[0]==now,'all46-stable-before-recovery-open');ingress_held(b);private('recovery-ready.private.json',{'actualRecoveredStartedAt':raw[service]['State']['StartedAt'],'runtime':now,'oldImage':old['Image'],'freshClosedDataExactlyPreserved':closed is not None,'gateHeld':True});ingress_release(b,recovery=True);result.update(failedServiceRecoveredWithoutDataRestore=True,recoveryPublicIngressReopened=True)

def deploy(result,b):
 ingress_preflight(b);p=prepared();configuration(b);need(p['originalRuntime']==b['runtime']and envs()==read(PREPARE/'literal-environments.private.json'),'prepared-original-runtime-and-full-env');before,raw=B.runtime();need(before==b['runtime']and B.flags()==b['maintenanceInventory'],'all46-original-runtime-before-switch');compose_contract(b);literal=envs();private('desired-runtime-environments.private.json',literal);args=overlay(p['images'],literal,'runtime.private.yml');rollback=overlay({s:raw[s]['Image']for s in ORDER},literal,'rollback.private.yml');service='printlink';old=raw[service];closed=None;closed_path=None;attempted=False;stopped=False
 try:
  configuration(b);need(B.runtime()[0]==before,'all46-stable-before-own-gate');ingress_enter(b);ingress_held(b);operation(['sleep','10'],'drain-printlink',20);operation(['docker','stop','--time','60',old['Id']],'stop-own-old-writer-printlink',80);stopped=True;closed,closed_path=B.capture(service,'closed-before');private(service+'-closed-raw-before-comparison.private.json',closed);replay_snapshot(service,closed,closed_path);stopped_runtime(before,old,service);configuration(b);ingress_held(b);attempted=True;operation([*args,'up','-d','--force-recreate','--no-build','--no-deps','--pull','never',service],'recreate-only-printlink',180);maintenance('wait_service_ready',service);now,newraw=B.runtime();new=newraw[service];started={'candidateStartedAt':new['State']['StartedAt'],'containerId':new['Id'],'image':new['Image']};private(service+'-candidate-started.private.json',started);full_contract(service,old,new,p['images'][service],literal,args,TARGET);need(proof(service,p['images'][service],new['Id'])==p['proofs'][service],'actual-source-equals-immutable-prepared');unchanged_except(before,now,service);ingress_held(b);post,post_path=B.capture(service,'after-start');private(service+'-poststart-raw-before-comparison.private.json',post);replay_snapshot(service,post,post_path);counts=same_data(service,closed,post,closed_path,post_path,started['candidateStartedAt']);audit={'candidateStartedAt':started['candidateStartedAt'],'afterSnapshotObservedUTC':post['observedUTC'],'operationalLockTimestampBasis':'exact_candidate_start_and_after_snapshot','dataDeltaEvidence':counts,'businessTypedSchemaFilesAndOwnershipPreserved':True};private(service+'-closed-comparison.private.json',audit);evidence={service:{'before':closed,'after':post,'started':started,'audit':audit}};configuration(b);compose_contract(b);cleared_flags(b);result['public']={service:public(service,p['proofs'][service])};need(B.runtime()[0]==now,'all46-stable-through-held-loopback-public-checks');baseline();ingress_held(b)
  # The complete source/data/env/runtime evidence is durable before publication.
  private('closed-evidence.private.json',evidence);private('final-runtime.private.json',now);private('cutover-ready.private.json',{'gateHeld':True,'images':p['images'],'runtime':now,'allTypedRowsSchemaSequenceFilesAndOwnershipPreserved':True,'allValidationFinishedBeforePublicIngressReopened':True,'lastIngressEvidence':LEASE.last});result.update(images=p['images'],allOther45ContainersUnchanged=True,allBusinessTypedRowsSchemaFilesAndModeOwnersPreserved=True,entireEnvironmentFileAndRuntimeEnvironmentsUnchanged=True,allMaintenanceFlagsRestored=True,onlyOwnPublishedIngressGateUsed=True,buildsPerformed=False)
  ingress_release(b);result.update(success=True,completedServices=[service],publicIngressReopened=True,allIngressRulesRestoredExceptProvenTargetDockerIPRuleMovement=True,publishedIngressIsolationOnly=True,arbitraryHostOrDirectBridgeWritersClaimedBlocked=False,publishedIngressRulesRemoved=6,allOriginalNetworksPreserved=True,originalNetworkCount=len(LEASE.original_networks),allOriginalNonTargetNetworkEndpointsPreserved=True,fourExistingDirtyFilesPreserved=True)
 except BaseException:
  result['failedService']=service
  try:
   if LEASE is not None and LEASE.install_started:
    try:ingress_held(b)
    except BaseException:LEASE.reacquire()
    need(ingress_held(b),'actual-gate-proven-before-recovery');recover(service,old,b,before,literal,rollback,closed,closed_path,attempted,stopped,result)
   else:need(B.runtime()[0]==before,'old-runtime-serving-with-no-ingress-write');result['originalRuntimeStillServingWithoutSwitch']=True
  except BaseException:
   private(service+'-recovery-failure.private.txt',traceback.format_exc().encode());result['failedServiceRecoveryCompleted']=False
   try:result['failedServiceRetainsOnlyOwnIngressIsolation']=ingress_held(b)is True
   except BaseException:result['ingressIsolationState']='unproven';result['failedServiceRetainsOnlyOwnIngressIsolation']=False
  raise

def verify(result,b):
 ingress_cleared(b);p=prepared();receipt=sealed(DEPLOY,DEPLOY_MANIFEST,DEPLOY_RESULT,'deploy');need(receipt.get('completedServices')==list(ORDER)and receipt.get('buildsPerformed')is False,'production-printlink-scoped-deploy-success');configuration(b);compose_contract(b);literal=envs();need(literal==read(DEPLOY/'desired-runtime-environments.private.json')and p['originalRuntime']==b['runtime'],'prepared-and-deployed-full-env-binding');current,raw=B.runtime();need(current==read(DEPLOY/'final-runtime.private.json')and current['others']==b['runtime']['others'],'current-final-runtime-and-original45');cleared_flags(b);evidence=read(DEPLOY/'closed-evidence.private.json');need(set(evidence)==set(ORDER),'production-printlink-closed-evidence-present');oldraw=read(BACKUP/'target-inspect.private.json');args=[*COMPOSE,'-f',str(DEPLOY/'runtime.private.yml')]
 for service in ORDER:
  entry=evidence[service];a,c,started,audit=(entry[k]for k in('before','after','started','audit'));need(started=={'candidateStartedAt':raw[service]['State']['StartedAt'],'containerId':raw[service]['Id'],'image':p['images'][service]}and read(DEPLOY/(service+'-candidate-started.private.json'))==started,'sealed-cutover-exact-current-candidate-binding');ap=DEPLOY/(service+'-closed-before');cp=DEPLOY/(service+'-after-start');need(read(DEPLOY/(service+'-closed-before.private.json'))==a and read(DEPLOY/(service+'-after-start.private.json'))==c,'sealed-capture-audit-binding');replay_snapshot(service,a,ap);replay_snapshot(service,c,cp);counts=same_data(service,a,c,ap,cp,started['candidateStartedAt']);expected={'candidateStartedAt':started['candidateStartedAt'],'afterSnapshotObservedUTC':c['observedUTC'],'operationalLockTimestampBasis':'exact_candidate_start_and_after_snapshot','dataDeltaEvidence':counts,'businessTypedSchemaFilesAndOwnershipPreserved':True};need(audit==expected and read(DEPLOY/(service+'-closed-comparison.private.json'))==expected,'closed-data-audit-reproduced');full_contract(service,oldraw[service],raw[service],p['images'][service],literal,args,TARGET);need(proof(service,p['images'][service],raw[service]['Id'])==p['proofs'][service],'actual-source-and-assets-equal-prepared');result.setdefault('public',{})[service]=public(service,p['proofs'][service])
 configuration(b);need(B.runtime()[0]==current,'all46-stable-through-readonly-verify');cleared_flags(b);ingress_cleared(b);private('verified-runtime.private.json',current);result.update(success=True,images=p['images'],printlinkPreparedSourceAndRuntimeContractVerified=True,printlinkSealedClosedDataCheckReproduced=True,allOther45ContainersUnchanged=True,entireEnvironmentFileAndRuntimeEnvironmentsUnchanged=True,allMaintenanceFlagsRestored=True,onlyOwnPublishedIngressGateUsed=True,freshLiveBusinessComparisonPerformed=False,buildsPerformed=False,publishedIngressIsolationOnly=True,arbitraryHostOrDirectBridgeWritersClaimedBlocked=False,publishedIngressRulesAbsent=True,allOriginalNetworksPreserved=True,originalNetworkCount=len(LEASE.original_networks),allOriginalNonTargetNetworkEndpointsPreserved=True,fourExistingDirtyFilesPreserved=True)

def main():
 global OUT,EXPECTED_ENV
 need(PHASE in{'prepare','deploy','verify'}and sys.argv[1:]==[PHASE]and os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_ATTEMPT')=='1'and pin(TARGET,40)and pin(TREE,40)and pin(SOURCE_MANIFEST_SHA),'blank-draft-or-wrong-phase-branch-attempt-target');os.umask(0o077);OUT={'prepare':PREPARE,'deploy':DEPLOY,'verify':VERIFY}[PHASE];OUT.mkdir(mode=0o700);initialize();signal.signal(signal.SIGTERM,lambda *_:need(False,'terminated'));result={'mode':PHASE,'base':BASE,'target':TARGET,'tree':TREE,'success':False,'businessWritesPerformed':False,'databaseRestorePerformed':False,'modelCallsPerformed':False,'authenticatedBusinessWritesPerformed':False,'otherServicesRequested':False,'secretOrRowsPrinted':False,'environmentConfigurationChanged':False}
 try:
  b=baseline();EXPECTED_ENV=(BACKUP/'environment.private').read_bytes();{'prepare':prepare,'deploy':deploy,'verify':verify}[PHASE](result,b)
 except BaseException as error:
  result.update(success=False,failedStage=STAGE,backupLibraryFailedStage=B.STAGE,safeExceptionType=type(error).__name__)
  if LEASE is not None:result.update(lastKnownPublicIngressReopened=LEASE.released,releaseStarted=LEASE.release_started,ingressIsolationMustNotBeAssumed=True)
  private('failure.private.txt',traceback.format_exc().encode())
 finally:
  private('first-result.json',result);B.F.OPS.L.seal(OUT);manifest_sha=B.F.OPS.L.file_hash(OUT/'manifest.json');result_sha=B.F.OPS.L.file_hash(OUT/'first-result.json');print(enc(dict(result,manifestSHA256=manifest_sha,resultSHA256=result_sha,manifestSHA256Nibbles=wire_nibbles(manifest_sha),resultSHA256Nibbles=wire_nibbles(result_sha))).decode(),flush=True)
 return 0 if result['success']else 1
if __name__=='__main__':
 try:sys.exit(main())
 except SystemExit:raise
 except BaseException:
  safe={'mode':PHASE if PHASE in{'prepare','deploy','verify'}else'rejected','success':False,'safeFailure':'PR1008_RELEASE_OUTPUT_OR_PREFLIGHT_FAILURE','phaseMayHavePerformedOperations':OUT is not None,'runtimeAndGateStateRequireReadOnlyVerification':OUT is not None}
  if LEASE is not None:safe.update(lastKnownPublicIngressReopened=LEASE.released,releaseStarted=LEASE.release_started,ingressIsolationMustNotBeAssumed=True)
  print(enc(safe).decode(),flush=True);sys.exit(1)
