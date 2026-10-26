"""PR1005 factory-only release draft; phase/target/archive gates remain blank.
No environment changes, DB restore, authenticated writes or model calls.
"""
import contextlib,copy,datetime,hashlib,importlib.util,io,json,os,pathlib,re,signal,stat,subprocess,sys,tarfile,traceback,urllib.error,urllib.request
PHASE=''
TARGET=''
TREE=''
SOURCE_MANIFEST_SHA='77ce532388969ff3846137d0e43fe199057ae9967066a384cf72d3327d9497e1'
REVIEWED_PATHS=('pb_hooks/analysis_ai.pb.js', 'pb_hooks/lib/analysis_ai.js', 'src/components/AnalysisAiPanel.vue', 'tests/AnalysisAiPanel.spec.ts', 'tests/analysisAiBackend.integration.mjs')
REVIEWED_HOOK_PATHS=('pb_hooks/analysis_ai.pb.js','pb_hooks/lib/analysis_ai.js')
BASE='04b6e92301c7dce04b83a3f63b1e83bfe2d9fe10'
BASE_TREE='fd9348f63f6d1edb156677dce8b600179fd4b0a5'
BRANCH='refs/heads/ops/pr-1005-20261026'
ROOT=pathlib.Path('/opt/rr-portal')
BACKUP=ROOT/'deploy/backups/pr-1005-20261026-backup'
PREPARE=BACKUP.with_name('pr-1005-20261026-prepare')
DEPLOY=BACKUP.with_name('pr-1005-20261026-deploy')
VERIFY=BACKUP.with_name('pr-1005-20261026-verify')
BACKUP_MANIFEST='';BACKUP_RESULT='';PREPARE_MANIFEST='';PREPARE_RESULT='';DEPLOY_MANIFEST='';DEPLOY_RESULT=''
ORDER=('factory-review',)
DEPS={'pr1005-backup-library.py': '800103096b0640690e498fd305ab1044d07d4252e0ea8fe69954ef825f461f48', 'batch-host-config-library.py': 'bd1842dc6847f3e0e5c0c38374c3604791f66d1c94dc651457607dc338f38ff1', 'factory-review-backup-library.py': '79d76bb47312dd08c121ebe2797f54d958666f8b72d00721f67712b152fc4666', 'release-data-ops-library.py': 'ff9138a1d5bfed1b10077112da6ebcda2d65240f583e2d0e12ce1325cfbaafd5', 'release-data-library.py': 'd63168fd3057f4f2aba2d93f9fab31d2d65c6dd0f3234877d71fcff1e04e62b9'}
COMPOSE=['docker','compose','-p','rr-portal','-f',str(ROOT/'docker-compose.cloud.yml'),'--env-file',str(ROOT/'.env.cloud.production')]
B=None;H=None;OUT=None;ENV=None;EXPECTED_ENV=None;STAGE='entrypoint';SERIAL=0
def need(v,label):
 global STAGE
 if not v:STAGE=label;raise RuntimeError('PR1005_RELEASE_REJECTED')

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
 B=load('pr1005-backup-library.py');need(B.BACKUP_PIN is False and B.BASE==BASE and B.BASE_TREE==BASE_TREE and B.ORDER==ORDER,'inert-exact-backup-library');B.ROOT=ROOT;B.CONFIGURATION_ARCHIVE=BACKUP;B.initialize(OUT);H=load('batch-host-config-library.py');native_host=H.same_host_config
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
 need(set(images)==set(literal)==set(ORDER),'overlay-exact-production-factory');lines=['services:']
 for s in ORDER:
  need(type(literal[s])is dict and all(type(k)is str and type(v)is str for k,v in literal[s].items()),'literal-environment-map');lines+=['  '+s+':','    image: '+images[s],'    pull_policy: never','    environment: !override '+json.dumps({k:v.replace('$','$$')for k,v in literal[s].items()},ensure_ascii=True)]
  if build:
   lines+=['    build:','      labels: '+json.dumps({'org.opencontainers.image.revision':TARGET})]
   if s.startswith('factory-review'):
    revision=read(BACKUP/'baseline.private.json')['factoryBuildArgumentRevisions'][s];need(pin(revision,40),'original-sealed-factory-build-argument');lines+=['      args:','        OCI_REVISION: '+revision]
 private(name,('\n'.join(lines)+'\n').encode());args=[*COMPOSE,'-f',str(OUT/name)];render=json.loads(run([*args,'config','--format','json']))
 for s in ORDER:need(render['services'][s]['image']==images[s]and render['services'][s]['environment']=={k:v.replace('$','$$')for k,v in literal[s].items()},'rendered-full-literal-environment')
 return args

def archive_files(args,expected=None,factory=False):
 blob=run(args);found={};total=0
 with tarfile.open(fileobj=io.BytesIO(blob),mode='r:')as archive:
  for m in archive:
   n=m.name.rstrip('/');need(B.F.OPS.L.safe_path(n)and(m.isdir()or m.isfile()),'safe-source-archive')
   if factory:need(n.split('/')[0]in{'pb_hooks','pb_migrations','pb_public'},'factory-source-prefix')
   else:need(n in expected,'only-requested-docker-copy-paths')
   if m.isdir():continue
   need(n not in found,'unique-source-file');total+=m.size;need(m.size<=16*1024**2 and total<=32*1024**2,'bounded-source-files');data=archive.extractfile(m).read();need(len(data)==m.size,'complete-source-file');found[n]={'bytes':m.size,'sha256':sha(data)}
 return found

def proof(service,image,cid=None,revision=None):
 need(service in ORDER,'only-production-factory-source-proofs');revision=revision or TARGET;prefix=['docker','exec','--user','0',cid,'tar']if cid else['docker','run','--rm','--user','0','--network','none','--read-only','--log-driver','none','--entrypoint','tar',image];found=archive_files([*prefix,'-C','/pb','-cf','-','pb_hooks','pb_migrations','pb_public'],factory=True);names=run(['git','ls-tree','-r','--name-only','-z',revision,'--',B.FACTORY+'/pb_hooks',B.FACTORY+'/pb_migrations']).decode().rstrip('\0').split('\0');expected={n[len(B.FACTORY)+1:]:sha(run(['git','show',revision+':'+n]))for n in names};need({n:v['sha256']for n,v in found.items()if not n.startswith('pb_public/')}==expected and'pb_public/index.html'in found and any(n.startswith('pb_public/assets/')for n in found),'all-factory-hooks-migrations-and-built-assets');return found

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

def unchanged_except(before,after,s):need(after['others']==before['others']and all(after['targets'][x]==before['targets'][x]for x in ORDER if x!=s),'all45-other-container-unchanged')

def stopped_runtime(before,old,s):
 current,raw=B.runtime(False);unchanged_except(before,current,s);a,c=before['targets'][s],current['targets'][s];need(raw[s]['Id']==old['Id']and c['running']is False and all(a[k]==c[k]for k in('id','image','started','restarts','environmentMapSHA256','mounts','configSHA256','hostConfigSHA256')),'only-owned-old-writer-stopped-with-original-contract');return current

def full_contract(s,old,new,image,literal,args,revision,allow_same=False):
 same=new['Id']==old['Id'];need((allow_same or not same)and new['Image']==image and new['Config'].get('Image')==(old['Config']['Image']if same else image)and new['RestartCount']==(old['RestartCount']if same else 0)and new['State']['Running']is True and new['State']['OOMKilled']is False and new['State'].get('Health',{}).get('Status')=='healthy','healthy-immutable-running-image');need(H.same_host_config(old['HostConfig'],new['HostConfig'])and sorted(old['Mounts'],key=enc)==sorted(new['Mounts'],key=enc),'complete-hostconfig-mounts');a,c=copy.deepcopy(old['Config']),copy.deepcopy(new['Config']);left=a.pop('Labels')or{};right=c.pop('Labels')or{};need(a.pop('Hostname')==old['Id'][:12]and c.pop('Hostname')==new['Id'][:12],'only-automatic-config-hostname');a.pop('Image');c.pop('Image');a.pop('Env');c.pop('Env');need(a==c and B.F.envmap(new['Config']['Env'])==literal[s],'complete-runtime-config-and-literal-env');need(B.process_environment(new['Id'])==expected_process(s,literal),'complete-original-pid1-environment')
 if new['Id']==old['Id']:need(right==left,'unrecreated-original-labels');return
 expected=copy.deepcopy(left);expected['com.docker.compose.image']=image;expected['com.docker.compose.project.config_files']=','.join([str(ROOT/'docker-compose.cloud.yml'),args[-1]]);hashes=run([*args,'config','--hash',s]).decode().split();need(len(hashes)==2 and hashes[0]==s and pin(hashes[1]),'exact-compose-service-config-hash');expected['com.docker.compose.config-hash']=hashes[1]
 if revision is not None:expected['org.opencontainers.image.revision']=revision
 need(right==expected,'only-exact-image-revision-and-compose-labels')

def stamp(value):
 match=re.fullmatch(r'(\d{4}-\d\d-\d\d[ T]\d\d:\d\d:\d\d)(?:\.(\d{1,9}))?(Z|[+-]\d\d:\d\d)',value or'')
 if match is None:return None
 try:delta=datetime.datetime.fromisoformat(match[1]+match[3].replace('Z','+00:00')).astimezone(datetime.timezone.utc)-datetime.datetime(1970,1,1,tzinfo=datetime.timezone.utc);return(delta.days*86400+delta.seconds)*10**9+int((match[2]or'0').ljust(9,'0'))
 except ValueError:return None

def log_policy(path,observed):
 with contextlib.closing(B.F.OPS.L.connect(path,True))as db:row=db.execute("SELECT CASE WHEN json_valid(value) THEN json_extract(value,'$.logs.maxDays') END,CASE WHEN json_valid(value) THEN json_extract(value,'$.logs.minLevel') END,CASE WHEN json_valid(value) THEN json_type(value,'$.logs.maxDays') END,CASE WHEN json_valid(value) THEN json_type(value,'$.logs.minLevel') END FROM _params WHERE id='settings'").fetchone()
 upper=stamp(observed)
 if row is None or row[2:]!=('integer','integer')or type(row[0])is not int or not 0<=row[0]<=36500 or type(row[1])is not int or not -100<=row[1]<=100 or upper is None:return None
 return{'cutoffNS':upper-row[0]*86400*10**9,'minLevel':row[1]}

def logs_at_observation(oldpath,newpath,olddata,newdata,started,observed):
 policies=[log_policy(p,observed)for p in(olddata,newdata)];policy=policies[0]if policies[0]is not None and policies[0]==policies[1]else None;start,end=stamp(started),stamp(observed);need(start is not None and end is not None and start<=end,'exact-nanosecond-candidate-observation-window');counts={'oldRows':0,'retainedTypedIdentical':0,'retainedTypedChanged':0,'missing':0,'missingCompatibleWithConfiguredRetention':0,'newRows':0,'newRowsWithinRequestTime':0,'configuredPolicyAvailableAndUnchanged':policy is not None}
 with contextlib.closing(B.F.OPS.L.connect(oldpath,True))as db:
  db.execute('ATTACH DATABASE ? AS afterdb',(newpath.as_uri()+'?mode=ro&immutable=1',));columns=db.execute('PRAGMA table_xinfo(_logs)').fetchall();need(columns==db.execute('PRAGMA afterdb.table_xinfo(_logs)').fetchall()and columns and[c[1]for c in columns if c[5]]==['id'],'identical-typed-log-schema');names=[c[1]for c in columns];need({'id','created','level'}<=set(names),'known-log-fields');q=B.F.OPS.L.quote;need(all(db.execute('SELECT count(*)=count(DISTINCT id) FROM '+p+'._logs').fetchone()==(1,)for p in('main','afterdb')),'unique-log-identities');query='SELECT '+','.join('a.'+q(n)for n in names)+','+','.join('b.'+q(n)for n in names)+' FROM _logs a LEFT JOIN afterdb._logs b ON a.id=b.id AND typeof(a.id)=typeof(b.id)';size=len(names);identity=names.index('id')
  for row in db.execute(query):
   counts['oldRows']+=1;a,c=row[:size],row[size:]
   if c[identity]is not None:counts['retainedTypedIdentical'if[B.F.OPS.L.cell(v)for v in a]==[B.F.OPS.L.cell(v)for v in c]else'retainedTypedChanged']+=1;continue
   counts['missing']+=1;created=stamp(a[names.index('created')]);level=a[names.index('level')];counts['missingCompatibleWithConfiguredRetention']+=int(policy is not None and((created is not None and created<=policy['cutoffNS'])or(type(level)is int and level<policy['minLevel'])))
  for(created,)in db.execute('SELECT b.created FROM afterdb._logs b LEFT JOIN _logs a ON a.id=b.id AND typeof(a.id)=typeof(b.id) WHERE a.id IS NULL'):
   counts['newRows']+=1;t=stamp(created);counts['newRowsWithinRequestTime']+=int(t is not None and start<=t<=end)
 counts['compatibleWithoutChangingRetainedRows']=counts['retainedTypedChanged']==0 and counts['missing']==counts['missingCompatibleWithConfiguredRetention']and counts['newRows']==counts['newRowsWithinRequestTime'];return counts

def compare_database_family(before,after):
 need(type(before)is dict and type(after)is dict,'exact-database-family-metadata-maps');mains={'data.db','auxiliary.db'};allowed=mains|{n+x for n in mains for x in('-wal','-shm','-journal')}
 for mapping in(before,after):
  need(mains<=set(mapping)<=allowed,'only-known-main-and-transient-sqlite-family-paths')
  for value in mapping.values():need(type(value)is dict and set(value)=={'mode','uid','gid'}and all(type(value[k])is int and value[k]>=0 for k in value)and value['mode']<=0o7777,'strict-typed-file-mode-and-owner')
 for name in set(before)&set(after):need(before[name]==after[name],'all-retained-main-and-companion-mode-owners-identical')
 for name in set(after)-set(before):
  main=next((n for n in mains if name in{n+x for x in('-wal','-shm','-journal')}),None);need(main is not None and after[name]==after[main],'new-transient-companion-inherits-main-mode-owner')
 return{'retainedModeOwnersIdentical':True,'newCompanionsMatchMainModeOwners':True,'removedCompanions':sorted(set(before)-set(after)),'createdCompanions':sorted(set(after)-set(before)),'transientPresenceClaimedIdentical':False}

def same_data(s,a,c,ap,cp,started):
 need(s in ORDER and a['files']==c['files']and a['fileOwnership']==c['fileOwnership']and a['metadata']==c['metadata']and set(a['sqlite'])==set(c['sqlite'])=={'data.db','auxiliary.db'},'all-attachments-json-files-mode-owners-and-exact-two-database-inventory-identical');family=compare_database_family(a['databaseFamilyMetadata'],c['databaseFamilyMetadata']);need(a['sqlite']['data.db']==c['sqlite']['data.db'],'all-factory-business-typed-rows-schema-identical');x,y=a['sqlite']['auxiliary.db'],c['sqlite']['auxiliary.db'];need(x['schema']==y['schema']and{k:v for k,v in x['tables'].items()if k!='_logs'}=={k:v for k,v in y['tables'].items()if k!='_logs'},'auxiliary-schema-nonlog-typed-rows-identical');counts=logs_at_observation(ap/'sqlite/auxiliary.db',cp/'sqlite/auxiliary.db',ap/'sqlite/data.db',cp/'sqlite/data.db',started,c['observedUTC']);need(counts['compatibleWithoutChangingRetainedRows'],'unchanged-retained-logs-observed-retention-and-exact-new-row-window');counts['databaseFamilyModeOwnerEvidence']=family;return counts

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
 need(s in ORDER,'only-production-factory-public-targets');base='/'+s+'/';status,_=request(base+'api/factory-review/health');need(status==200,'factory-public-health');status,body=request(base);need(status==200 and sha(body)==files['pb_public/index.html']['sha256'],'factory-public-index-exact-candidate');assets=[v.decode()[len(base):]for v in re.findall(rb'(?:src|href)="([^\"]+/assets/[^\"]+)"',body)];need(assets and all(v.startswith('assets/')and'..'not in v for v in assets),'factory-index-assets')
 for asset in assets:
  need('pb_public/'+asset in files,'reviewed-public-static-file');status,data=request(base+asset);need(status==200 and sha(data)==files['pb_public/'+asset]['sha256'],'factory-public-assets-exact-candidate')
 need(request(base+'api/factory-review/analysis-ai/config')[0]==401,'factory-anonymous-analysis-config-rejected');return{'health':200,'indexMatchesCandidate':True,'indexSHA256':files['pb_public/index.html']['sha256'],'selectedAssetCount':len(assets),'staticAssetsSHA256':{base+asset:files['pb_public/'+asset]['sha256']for asset in assets},'anonymousAuth':401}

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
 r=sealed(BACKUP,BACKUP_MANIFEST,BACKUP_RESULT,'backup');need(r.get('backupComplete')is True and r.get('portableSQLiteCount')==2 and r.get('targetContainerCount')==1 and r.get('otherContainerCount')==45 and r.get('factoryRuntimeSourceMatchesBaseAndSealed1002')is True,'complete-production-two-sqlite-backup');b=read(BACKUP/'baseline.private.json');need(b['head']==BASE and b['tree']==BASE_TREE and set(b['runtime']['targets'])==set(ORDER)and len(b['runtime']['others'])==45 and set(b['storage'])==set(ORDER)==set(b['sourceProof']),'complete-original-production-factory-baseline');return b

def reviewed_manifest():
 p=pathlib.Path(__file__).with_name('pr1005-reviewed-files.json');need(pin(SOURCE_MANIFEST_SHA)and p.is_file()and not p.is_symlink()and sha(p.read_bytes())==SOURCE_MANIFEST_SHA,'reviewed-source-manifest-pin');value=read(p);need(type(REVIEWED_PATHS)is tuple and 2<=len(REVIEWED_PATHS)<=40 and len(set(REVIEWED_PATHS))==len(REVIEWED_PATHS)and set(REVIEWED_HOOK_PATHS)<=set(REVIEWED_PATHS)and all(B.F.OPS.L.safe_path(n)and(n in REVIEWED_HOOK_PATHS or n=='index.html'or any(n.startswith(a+'/')for a in('src','tests','public')))for n in REVIEWED_PATHS),'exact-final-reviewed-two-hooks-frontend-and-test-paths');need(type(value)is dict and set(value)=={B.FACTORY+'/'+n for n in REVIEWED_PATHS}and all(pin(h)for h in value.values()),'only-exact-reviewed-factory-frontend-and-tests');return value

def hook_entries(revision):
 raw=run(['git','ls-tree','-r','-z',revision,'--',B.FACTORY+'/pb_hooks']);entries={}
 for item in raw.rstrip(b'\0').split(b'\0'):
  parts=item.split(b'\t',1);need(len(parts)==2 and re.fullmatch(b'100(?:644|755) blob [a-f0-9]{40}',parts[0])is not None,'only-regular-full-hook-inventory');name=parts[1].decode();need(B.F.OPS.L.safe_path(name)and name.startswith(B.FACTORY+'/pb_hooks/')and name not in entries,'safe-unique-full-hook-path');entries[name]=parts[0]
 need(entries,'nonempty-complete-hook-inventory');return entries

def unchanged_hooks_and_startup(manifest):
 before,after=hook_entries(BASE),hook_entries(TARGET);need(set(before)==set(after),'complete-original-hook-inventory-preserved');allowed={B.FACTORY+'/'+n for n in REVIEWED_HOOK_PATHS};need(len(allowed)==2 and allowed<=set(manifest) and allowed<=set(before),'exact-two-existing-reviewed-hook-paths');changed=set()
 for name in before:
  if name in allowed:
   need(before[name].split()[0]==after[name].split()[0]and sha(run(['git','show',TARGET+':'+name]))==manifest[name],'reviewed-hook-mode-preserved-and-exact-final-manifest-byte-hash')
   if before[name]!=after[name]:changed.add(name)
  else:need(before[name]==after[name],'every-other-hook-source-and-mode-exact-base')
 need(changed==allowed,'only-exact-two-reviewed-hooks-change');name=B.FACTORY+'/pb_hooks/analysis_ai.pb.js';old=run(['git','show',BASE+':'+name]);new=run(['git','show',TARGET+':'+name]);start=b"\ncronAdd('analysis-ai-quota-cleanup'"
 need(old.count(b'cronAdd(')==new.count(b'cronAdd(')==1 and old.count(start)==new.count(start)==1 and old[old.index(start):]==new[new.index(start):],'sole-existing-quota-cleanup-cron-original-bytes-through-eof')

def source(b,revision):
 need(run(['git','symbolic-ref','--quiet','HEAD']).decode().strip()=='refs/heads/main'and run(['git','rev-parse','HEAD']).decode().strip()==revision and revision in{BASE,TARGET},'canonical-known-main-revision');manifest=reviewed_manifest();names=run(['git','diff','--name-only','-z',BASE,TARGET]).decode().rstrip('\0').split('\0');need(len(names)==len(set(names))==len(manifest)and set(names)==set(manifest)and not set(names)&set(b['preexistingFourDirty']),'exact-reviewed-factory-frontend-diff');need(run(['git','rev-parse',TARGET+'^{tree}']).decode().strip()==TREE,'exact-reviewed-target-tree');need(B.dirty_snapshot()==b['preexistingFourDirty'],'four-existing-dirty-files-identical');run(['git','diff','--quiet','--no-ext-diff','--no-textconv','--',*B.APPS])
 for n,h in manifest.items():
  need(sha(run(['git','show',TARGET+':'+n]))==h,'all-reviewed-git-file-hashes')
  if revision==TARGET:
   p=ROOT/n;entry=run(['git','ls-tree','-z',TARGET,'--',n]);need(re.fullmatch(b'100(?:644|755) blob [a-f0-9]{40}\t'+re.escape(n.encode())+b'\0',entry)is not None,'reviewed-regular-source-mode')
   for ancestor in(p,*p.parents):
    if ancestor==ROOT:break
    need(not ancestor.is_symlink(),'reviewed-source-no-symlink-ancestors')
   need(p.is_file()and B.F.OPS.L.file_hash(p)==h and stat.S_IMODE(p.stat().st_mode)==(0o755 if entry.startswith(b'100755')else 0o644),'reviewed-canonical-file-bytes-mode')
 for n in B.FIXED:need((ROOT/n).is_file()and not(ROOT/n).is_symlink()and(ROOT/n).read_bytes()==run(['git','show',BASE+':'+n])and B.meta(ROOT/n)=={k:b['configuration'][n][k]for k in('mode','uid','gid')},'all-fixed-configuration-and-mode-owners-preserved')
 for n in(*B.FIXED,B.FACTORY+'/pb_migrations'):need(run(['git','rev-parse',BASE+':'+n])==run(['git','rev-parse',TARGET+':'+n]),'unchanged-global-docker-dependencies-and-migrations')
 unchanged_hooks_and_startup(manifest)
 run(['git','merge-base','--is-ancestor',BASE,TARGET])

def configuration(b):source(b,TARGET);environment_exact(b)

def compose_contract(b):
 expected=read(BACKUP/'compose-render.private.json');actual=json.loads(run([*COMPOSE,'config','--format','json']));need(actual==expected,'entire-compose-render-unchanged');return actual

def prepare(result,b):
 runtime,raw=B.runtime();need(runtime==b['runtime']and B.flags()==b['maintenanceInventory'],'original-runtime-before-build');environment_exact(b);operation(['git','-c','core.hooksPath=/dev/null','fetch','--no-write-fetch-head','origin','main'],'fetch-reviewed-main');need(run(['git','rev-parse','origin/main']).decode().strip()==TARGET,'exact-current-remote-main');head=run(['git','rev-parse','HEAD']).decode().strip();source(b,head)
 if head==BASE:operation(['git','-c','core.hooksPath=/dev/null','merge','--ff-only',TARGET],'source-fast-forward')
 configuration(b);compose_contract(b);literal=envs();private('literal-environments.private.json',literal);tags={s:'rr-portal-'+s+'-pr1005:'+TARGET for s in ORDER};args=overlay(tags,literal,'build.private.yml',True)
 for service in ORDER:operation([*args,'build',service],'build-'+service,1800)
 images={s:json.loads(run(['docker','image','inspect',tags[s]]))[0]['Id']for s in ORDER};proofs={s:candidate(s,images[s],raw[s])for s in ORDER};need(B.runtime()[0]==runtime and B.flags()==b['maintenanceInventory'],'all46-originals-serve-through-production-build');configuration(b);private('prepared.private.json',{'target':TARGET,'tree':TREE,'images':images,'proofs':proofs,'originalRuntime':runtime});result.update(success=True,candidatesBuiltBeforeAnyMaintenance=True,targetContainerCount=1,otherContainerCount=45,all46OriginalContainersUnchanged=True,environmentFileUnchanged=True,images=images)

def maintenance(fn,service):
 need(fn in{'maintenance_on','maintenance_off','wait_service_ready','require_maintenance_cleared'}and service in ORDER,'only-owned-production-factory-maintenance');operation(['bash','-c','set -euo pipefail; source "$1"; "$2" "$3"','pr1005',str(ROOT/'deploy/service-maintenance.sh'),fn,service],fn+'-'+service,330,service=service)

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
   configuration(b);need(B.runtime()[0]==before and B.flags()==b['maintenanceInventory'],'all-runtime-and-flags-stable-before-own-switch');maintenance('maintenance_on',service);owned_flags(b,service);operation(['sleep','60'],'drain-'+service,70);operation(['docker','stop','--time','60',old['Id']],'stop-own-old-writer-'+service,80);stopped=True;stopped_runtime(before,old,service);closed,closed_path=B.capture(service,'closed-before');private(service+'-closed-raw-before-comparison.private.json',closed);replay_snapshot(service,closed,closed_path);stopped_runtime(before,old,service);configuration(b);owned_flags(b,service);attempted=True;operation([*args,'up','-d','--force-recreate','--no-build','--no-deps','--pull','never',service],'recreate-only-'+service,180);maintenance('wait_service_ready',service);now,newraw=B.runtime();new=newraw[service];started={'candidateStartedAt':new['State']['StartedAt'],'containerId':new['Id'],'image':new['Image']};private(service+'-candidate-started.private.json',started);full_contract(service,old,new,p['images'][service],literal,args,TARGET);need(proof(service,p['images'][service],new['Id'])==p['proofs'][service],'actual-service-source-and-assets-equal-prepared');unchanged_except(before,now,service);post,post_path=B.capture(service,'after-start');private(service+'-poststart-raw-before-comparison.private.json',post);replay_snapshot(service,post,post_path);need(B.runtime()[0]==now,'runtime-stable-through-fresh-poststart-capture');counts=same_data(service,closed,post,closed_path,post_path,started['candidateStartedAt']);audit={'candidateStartedAt':started['candidateStartedAt'],'afterSnapshotObservedUTC':post['observedUTC'],'retentionCutoffBasis':'after_snapshot_observation','deletionActorOrExactTimesProven':False,'dataDeltaEvidence':counts,'businessTypedSchemaFilesAndOwnershipPreserved':True};private(service+'-closed-comparison.private.json',audit);evidence[service]={'before':closed,'after':post,'started':started,'audit':audit};configuration(b);owned_flags(b,service);operation(['sleep','11'],'dns-grace-'+service,20);maintenance('maintenance_off',service);maintenance('require_maintenance_cleared',service);cleared_flags(b);result.setdefault('public',{})[service]=public(service,p['proofs'][service])
   need(B.runtime()[0]==now,'all46-contracts-stable-after-own-public-smoke');before=now;completed.append(service);result['completedServices']=completed[:]
  except BaseException:
   result['failedService']=service
   try:recover(service,old,b,before,original,rollback,closed,closed_path,attempted,stopped,result)
   except BaseException:result['failedServiceRetainsOwnMaintenance']=True;private(service+'-recovery-failure.private.txt',traceback.format_exc().encode())
   raise
 need(completed==list(ORDER),'production-factory-services-complete');configuration(b);compose_contract(b);cleared_flags(b);private('closed-evidence.private.json',evidence);private('final-runtime.private.json',before);result.update(success=True,images=p['images'],allOther45ContainersUnchanged=True,allBusinessTypedRowsSchemaFilesAndModeOwnersPreserved=True,entireEnvironmentFileAndRuntimeEnvironmentsUnchanged=True,allMaintenanceFlagsRestored=True,buildsPerformed=False)

def verify(result,b):
 p=prepared();receipt=sealed(DEPLOY,DEPLOY_MANIFEST,DEPLOY_RESULT,'deploy');need(receipt.get('completedServices')==list(ORDER)and receipt.get('buildsPerformed')is False,'production-factory-scoped-deploy-success');configuration(b);compose_contract(b);literal=envs();need(literal==read(DEPLOY/'desired-runtime-environments.private.json')and p['originalRuntime']==b['runtime'],'prepared-and-deployed-full-env-binding');current,raw=B.runtime();need(current==read(DEPLOY/'final-runtime.private.json')and current['others']==b['runtime']['others'],'current-final-runtime-and-original45');cleared_flags(b);evidence=read(DEPLOY/'closed-evidence.private.json');need(set(evidence)==set(ORDER),'production-factory-closed-evidence-present');oldraw=read(BACKUP/'target-inspect.private.json');args=[*COMPOSE,'-f',str(DEPLOY/'runtime.private.yml')]
 for service in ORDER:
  entry=evidence[service];a,c,started,audit=(entry[k]for k in('before','after','started','audit'));need(started=={'candidateStartedAt':raw[service]['State']['StartedAt'],'containerId':raw[service]['Id'],'image':p['images'][service]}and read(DEPLOY/(service+'-candidate-started.private.json'))==started,'sealed-cutover-exact-current-candidate-binding');ap=DEPLOY/(service+'-closed-before');cp=DEPLOY/(service+'-after-start');need(read(DEPLOY/(service+'-closed-before.private.json'))==a and read(DEPLOY/(service+'-after-start.private.json'))==c,'sealed-capture-audit-binding');replay_snapshot(service,a,ap);replay_snapshot(service,c,cp);counts=same_data(service,a,c,ap,cp,started['candidateStartedAt']);expected={'candidateStartedAt':started['candidateStartedAt'],'afterSnapshotObservedUTC':c['observedUTC'],'retentionCutoffBasis':'after_snapshot_observation','deletionActorOrExactTimesProven':False,'dataDeltaEvidence':counts,'businessTypedSchemaFilesAndOwnershipPreserved':True};need(audit==expected and read(DEPLOY/(service+'-closed-comparison.private.json'))==expected,'closed-data-audit-reproduced');full_contract(service,oldraw[service],raw[service],p['images'][service],literal,args,TARGET);need(proof(service,p['images'][service],raw[service]['Id'])==p['proofs'][service],'actual-source-and-assets-equal-prepared');result.setdefault('public',{})[service]=public(service,p['proofs'][service])
 configuration(b);need(B.runtime()[0]==current,'all46-stable-through-readonly-verify');cleared_flags(b);private('verified-runtime.private.json',current);result.update(success=True,images=p['images'],factoryPreparedSourceAndRuntimeContractVerified=True,factorySealedClosedDataCheckReproduced=True,allOther45ContainersUnchanged=True,entireEnvironmentFileAndRuntimeEnvironmentsUnchanged=True,allMaintenanceFlagsRestored=True,freshLiveBusinessComparisonPerformed=False,buildsPerformed=False)

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
 except BaseException:print('{"mode":"rejected","success":false,"safeFailure":"PR1005_RELEASE_PREFLIGHT_REJECTED"}',flush=True);sys.exit(1)
