"""Three-service QMS auth release draft; every phase/target/archive gate is blank.
Runtime-only dedicated integration token. No DB restore, migrations or model calls.
"""
import contextlib,copy,datetime,hashlib,importlib.util,io,json,os,pathlib,re,secrets,signal,stat,subprocess,sys,tarfile,traceback,urllib.error,urllib.request
PHASE='prepare'
TARGET='f50e23735af6e198721830e26e35e26162f09af0'
TREE='6f8cfbdf0e607ccdca59b0cc0c21c5d430ece5f2'
SOURCE_MANIFEST_SHA='5e11343e462cbcae8d141ac3dae86556fcd977e151f633da5a786a6a6ae7ea41'
BASE='73364c71ad44528db35197465e9cee0f3e4a2606'
BASE_TREE='3275c7fadb9d14d0657196abf35c3a9f4a1906f4'
BRANCH='refs/heads/ops/qms-api-auth-20261021'
ROOT=pathlib.Path('/opt/rr-portal')
BACKUP=ROOT/'deploy/backups/qms-api-auth-20261021-backup'
PREPARE=BACKUP.with_name('qms-api-auth-20261021-prepare')
DEPLOY=BACKUP.with_name('qms-api-auth-20261021-deploy')
VERIFY=BACKUP.with_name('qms-api-auth-20261021-verify')
BACKUP_MANIFEST='f070511180e3a40e4e8b6d3877c942f9f0d1f117178dac11b6590848cb71a7ac';BACKUP_RESULT='8c3c09c98214437fa14982cc4bd15e637b60f25c628b5795d0f05cf5730db6c0';PREPARE_MANIFEST='';PREPARE_RESULT='';DEPLOY_MANIFEST='';DEPLOY_RESULT=''
ORDER=('factory-review-test','factory-review','qc')
TOKEN_KEYS=('QC_INSPECTIONS_READ_TOKEN','FACTORY_REVIEW_QMS_READ_TOKEN')
SERVICE_TOKEN_KEYS={s:TOKEN_KEYS[0]if s=='qc'else TOKEN_KEYS[1]for s in ORDER}
DEPS={'qms-api-auth-backup-library.py': 'ec0d15b34b76cbcfec8a4f79b98aeee6798a87192f197c9d80563c09ca132209', 'batch-host-config-library.py': 'bd1842dc6847f3e0e5c0c38374c3604791f66d1c94dc651457607dc338f38ff1', 'factory-review-backup-library.py': '79d76bb47312dd08c121ebe2797f54d958666f8b72d00721f67712b152fc4666', 'release-data-ops-library.py': 'ff9138a1d5bfed1b10077112da6ebcda2d65240f583e2d0e12ce1325cfbaafd5', 'release-data-library.py': 'd63168fd3057f4f2aba2d93f9fab31d2d65c6dd0f3234877d71fcff1e04e62b9'}
COMPOSE=['docker','compose','-p','rr-portal','-f',str(ROOT/'docker-compose.cloud.yml'),'--env-file',str(ROOT/'.env.cloud.production')]
B=None;H=None;OUT=None;ENV=None;EXPECTED_ENV=None;STAGE='entrypoint';SERIAL=0
def need(v,label):
 global STAGE
 if not v:STAGE=label;raise RuntimeError('QMS_API_AUTH_RELEASE_REJECTED')

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
 B=load('qms-api-auth-backup-library.py');need(B.BACKUP_PIN is False and B.BASE==BASE and B.BASE_TREE==BASE_TREE and B.ORDER==ORDER,'inert-exact-backup-library');B.ROOT=ROOT;B.initialize(OUT);H=load('batch-host-config-library.py');ENV=dict(os.environ,COMPOSE_PROJECT_NAME='rr-portal',COMPOSE_BAKE='false',COMPOSE_PARALLEL_LIMIT='1',MAINT_FLAG_DIR=str(ROOT/'deploy/maintenance'),COMPOSE_FILE=str(ROOT/'docker-compose.cloud.yml'),ENV_FILE=str(ROOT/'.env.cloud.production'),MAINT_HEALTH_TIMEOUT_SECONDS='300',MAINT_DNS_GRACE_SECONDS='10')

def sealed(path,manifest_hash,result_hash,mode,success=True):
 need(pin(manifest_hash)and pin(result_hash)and path.is_dir()and not path.is_symlink()and stat.S_IMODE(path.stat().st_mode)==0o700,'private-phase-directory-and-pins');L=B.F.OPS.L;need(L.file_hash(path/'manifest.json')==manifest_hash and L.file_hash(path/'first-result.json')==result_hash,'exact-phase-seals');manifest=read(path/'manifest.json');entries=list(path.rglob('*'));need(type(manifest)is dict and len(entries)<=100000 and all(not p.is_symlink()and(p.is_file()or p.is_dir())and p.stat().st_mode&0o077==0 for p in entries),'all-private-regular-phase-entries');need(set(manifest)=={str(p.relative_to(path))for p in entries if p.is_file()and p!=path/'manifest.json'}and all(L.safe_path(n)and pin(h)and L.file_hash(path/n)==h for n,h in manifest.items()),'all-phase-byte-seals');r=read(path/'first-result.json');need(r.get('success')is success and r.get('mode')==mode and r.get('base')==BASE and r.get('target')==(BASE if mode=='backup'else TARGET)and r.get('tree')==(BASE_TREE if mode=='backup'else TREE),'successful-bound-prior-phase');return r

def envs():return{s:read(BACKUP/(s+'-literal-configured-environment.private.json'))for s in ORDER}

def overlay(images,literal,name,build=False):
 need(set(images)==set(literal)==set(ORDER),'overlay-exact-four-services');lines=['services:']
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
 revision=revision or TARGET;prefix=['docker','exec','--user','0',cid,'tar']if cid else['docker','run','--rm','--user','0','--network','none','--read-only','--log-driver','none','--entrypoint','tar',image]
 if service.startswith('factory-review'):
  found=archive_files([*prefix,'-C','/pb','-cf','-','pb_hooks','pb_migrations','pb_public'],factory=True);names=run(['git','ls-tree','-r','--name-only','-z',revision,'--',B.FACTORY+'/pb_hooks',B.FACTORY+'/pb_migrations']).decode().rstrip('\0').split('\0');expected={n[len(B.FACTORY)+1:]:sha(run(['git','show',revision+':'+n]))for n in names};need({n:v['sha256']for n,v in found.items()if not n.startswith('pb_public/')}==expected and'pb_public/index.html'in found and any(n.startswith('pb_public/assets/')for n in found),'all-factory-hooks-migrations-and-built-assets');return found
 app,names=B.code_paths(service,revision);expected={n:sha(run(['git','show',revision+':'+app+'/'+n]))for n in names};found=archive_files([*prefix,'-C','/app','-cf','-',*names],expected);need({n:v['sha256']for n,v in found.items()}==expected,'complete-docker-copy-source-hashes');return found

def candidate(s,image,old):
 i=json.loads(run(['docker','image','inspect',image]))[0];original=read(BACKUP/(s+'-image.private.json'));need(i['Id']==image and original['Id']==old['Image']and i['Architecture']==original['Architecture']=='amd64'and i['Os']==original['Os']=='linux'and(i['Config'].get('Labels')or{}).get('org.opencontainers.image.revision')==TARGET,'exact-candidate-platform-revision')
 for k in('Cmd','Entrypoint','User','WorkingDir','Healthcheck','ExposedPorts','Volumes','StopSignal','Shell','ArgsEscaped','StopTimeout'):need(i['Config'].get(k)==original['Config'].get(k),'candidate-image-default-'+k.lower())
 oldlabels=original['Config'].get('Labels')or{};newlabels=i['Config'].get('Labels')or{};need({k:v for k,v in oldlabels.items()if k!='org.opencontainers.image.revision'}=={k:v for k,v in newlabels.items()if k!='org.opencontainers.image.revision'},'unchanged-other-image-labels');need(dict(B.F.envmap(i['Config'].get('Env')or[]),**envs()[s])==envs()[s],'candidate-default-environment-covered-by-original-literal');need(i['Config'].get('Env')==original['Config'].get('Env')and not set(TOKEN_KEYS)&set(B.F.envmap(i['Config'].get('Env')or[])),'runtime-token-never-built-into-image-and-default-env-unchanged');private(s+'-candidate-image.private.json',i);return proof(s,image)

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

def unchanged_except(before,after,s):need(after['others']==before['others']and all(after['targets'][x]==before['targets'][x]for x in ORDER if x!=s),'all43-and-other-two-containers-unchanged')

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

def same_data(s,a,c,ap,cp,started):
 need(a['files']==c['files']and a['fileOwnership']==c['fileOwnership']and a['metadata']==c['metadata']and set(a['sqlite'])==set(c['sqlite']),'all-attachments-json-files-mode-owners-and-database-inventory-identical')
 if not s.startswith('factory-review'):need(a['sqlite']==c['sqlite'],'every-qc-company-all-schema-and-typed-rows-identical');return None
 need(a['sqlite']['data.db']==c['sqlite']['data.db'],'all-factory-business-typed-rows-schema-identical');x,y=a['sqlite']['auxiliary.db'],c['sqlite']['auxiliary.db'];need(x['schema']==y['schema']and{k:v for k,v in x['tables'].items()if k!='_logs'}=={k:v for k,v in y['tables'].items()if k!='_logs'},'auxiliary-schema-nonlog-typed-rows-identical');counts=logs_at_observation(ap/'sqlite/auxiliary.db',cp/'sqlite/auxiliary.db',ap/'sqlite/data.db',cp/'sqlite/data.db',started,c['observedUTC']);need(counts['compatibleWithoutChangingRetainedRows'],'unchanged-retained-logs-observed-retention-and-exact-new-row-window');return counts

def replay_snapshot(s,value,path):
 need(B.F.OPS.L.snapshots(path/'sqlite',immutable=True)==value['sqlite'],'closed-portable-snapshots-reproduce-all-typed-audits');B.F.OPS.L.verify_archive(path/'files.tar',value['files']);need(type(value['fileOwnership'])is dict and type(value['metadata'])is dict,'sealed-mode-owner-inventories-present');B.startup_guard(s,value,path)

def request(path,method='GET',data=None):
 need(path.startswith('/')and'..'not in path and method=='GET'and data is None,'bounded-readonly-public-request');req=urllib.request.Request('http://127.0.0.1'+path,method='GET',headers={'Host':'8.148.146.194','Cache-Control':'no-cache'});opener=urllib.request.build_opener(urllib.request.ProxyHandler({}))
 try:
  with opener.open(req,timeout=20)as r:body=r.read(16*1024**2+1);need(len(body)<=16*1024**2,'bounded-public-static-response');return r.status,body
 except urllib.error.HTTPError as error:return error.code,error.read(8192)

def public(s,files):
 if s.startswith('factory-review'):
  base='/'+s+'/';health=base+'api/factory-review/health';index='pb_public/index.html';assets=None
 else:base='/qc/';health='/qc/api/health';index='index.html';assets=['app.js','qc-backend.js','sso.js','style.css','ai-ocr.js','vendor/echarts.min.js']
 status,_=request(health);need(status==200,'public-health');status,body=request(base);need(status==200 and sha(body)==files[index]['sha256'],'public-index-exact-candidate')
 if assets is None:assets=[v.decode()[len(base):]for v in re.findall(rb'(?:src|href)="([^\"]+/assets/[^\"]+)"',body)];need(assets and all(v.startswith('assets/')and'..'not in v for v in assets),'factory-index-assets')
 for asset in assets:
  key=('pb_public/'if s.startswith('factory-review')else'')+asset;need(key in files,'reviewed-public-static-file');status,data=request(base+asset);need(status==200 and sha(data)==files[key]['sha256'],'public-selected-static-exact-candidate')
 if s.startswith('factory-review'):status,_=request(base+'api/factory-review/analysis-ai/config')
 else:status,_=request(base+'api/session?company=dg-xingxin')
 need(status==401,'synthetic-anonymous-auth-rejection');return{'health':200,'indexMatchesCandidate':True,'selectedAssetCount':len(assets),'anonymousAuth':401}

def valid_token(value):return type(value)is str and re.fullmatch('[A-Za-z0-9_-]{43,128}',value)is not None and len(set(value))>=8

def token_values(raw):
 need(type(raw)is bytes and len(raw)<=4*1024**2,'bounded-environment-bytes');text=raw.decode('utf8');found={}
 for key in TOKEN_KEYS:
  matches=re.findall(r'(?m)^[ \t]*(?:export[ \t]+)?'+re.escape(key)+r'[ \t]*=([^\r\n]*)',text);need(len(matches)<=1,'unique-dedicated-token-assignment')
  if matches:
   value=matches[0].strip()
   if len(value)>=2 and value[0]in"'\""and value[-1]==value[0]:value=value[1:-1]
   need(valid_token(value),'existing-dedicated-token-full-format-and-not-placeholder');found[key]=value
 need(not found or set(found)==set(TOKEN_KEYS)and len(set(found.values()))==1,'both-token-names-present-with-identical-value');return next(iter(found.values()))if found else None

def desired_environment(original,token):
 need(valid_token(token),'dedicated-256bit-runtime-token');existing=token_values(original)
 if existing is not None:need(existing==token,'reuse-existing-token-without-regeneration');return original
 ending=b'\r\n'if b'\r\n'in original else b'\n';suffix=b''if not original or original.endswith(b'\n')else ending
 return original+suffix+ending.join(key.encode()+b"='"+token.encode()+b"'"for key in TOKEN_KEYS)+ending

def stable_environment():
 p=ROOT/'.env.cloud.production';need(p.is_file()and not p.is_symlink(),'regular-environment-file')
 with os.fdopen(os.open(p,os.O_RDONLY|os.O_NOFOLLOW),'rb')as stream:
  a=os.fstat(stream.fileno());need(stat.S_ISREG(a.st_mode)and a.st_size<=4*1024**2,'bounded-private-environment-file');data=stream.read(4*1024**2+1);z=os.fstat(stream.fileno());fields=lambda r:(r.st_dev,r.st_ino,r.st_mode,r.st_uid,r.st_gid,r.st_size,r.st_mtime_ns,r.st_ctime_ns);need(fields(a)==fields(z)==fields(p.lstat())and len(data)==a.st_size,'stable-environment-read')
 return data

def environment_exact(b):
 need(type(EXPECTED_ENV)is bytes and stable_environment()==EXPECTED_ENV and B.meta(ROOT/'.env.cloud.production')==b['environmentFileMetadata'],'entire-environment-exact-expected-bytes-mode-owner')

def desired_envs(token):
 literal=envs()
 for service in ORDER:
  key=SERVICE_TOKEN_KEYS[service];need(literal[service].get(key,'')in{'',token},'existing-runtime-token-consistent-with-private-env');literal[service][key]=token
 return literal

def expected_process(service,literal):
 value=read(BACKUP/(service+'-literal-process-environment.private.json'));key=SERVICE_TOKEN_KEYS[service]
 if key in literal[service]:value[key]=literal[service][key]
 return value

def install_token(b):
 global EXPECTED_ENV
 original=(BACKUP/'environment.private').read_bytes();need(EXPECTED_ENV==original,'token-step-starts-from-original-environment');environment_exact(b);token=token_values(original)
 if token is None:token=secrets.token_urlsafe(32)
 desired=desired_environment(original,token);desired_envs(token);private('integration-token.private',token.encode());private('environment-after.private',desired);private('environment-intent.private.json',{'originalSHA256':sha(original),'desiredSHA256':sha(desired),'onlyAllowedNames':list(TOKEN_KEYS),'metadata':b['environmentFileMetadata'],'existingTokenReused':token_values(original)is not None})
 if desired!=original:
  path=ROOT/'.env.cloud.production';temp=path.with_name('.env.cloud.production.qms-auth-'+str(os.getpid())+'.private.tmp');meta=b['environmentFileMetadata'];fd=os.open(temp,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
  try:
   with os.fdopen(fd,'wb')as stream:stream.write(desired);stream.flush();os.fchown(stream.fileno(),meta['uid'],meta['gid']);os.fchmod(stream.fileno(),meta['mode']);os.fsync(stream.fileno())
   environment_exact(b);os.replace(temp,path);directory=os.open(path.parent,os.O_RDONLY|os.O_DIRECTORY)
   try:os.fsync(directory)
   finally:os.close(directory)
  finally:
   if temp.exists():temp.unlink()
 EXPECTED_ENV=desired;environment_exact(b);return token

def baseline():
 r=sealed(BACKUP,BACKUP_MANIFEST,BACKUP_RESULT,'backup');need(r.get('backupComplete')is True and r.get('portableSQLiteCount')==30 and r.get('targetContainerCount')==3 and r.get('otherContainerCount')==43,'complete-three-service-30-sqlite-backup');b=read(BACKUP/'baseline.private.json');need(b['head']==BASE and b['tree']==BASE_TREE and set(b['runtime']['targets'])==set(ORDER)and len(b['runtime']['others'])==43 and set(b['storage'])==set(ORDER)==set(b['sourceProof']),'complete-original-three-service-baseline');return b

def reviewed_manifest():
 p=pathlib.Path(__file__).with_name('qms-api-auth-reviewed-files.json');need(pin(SOURCE_MANIFEST_SHA)and p.is_file()and not p.is_symlink()and sha(p.read_bytes())==SOURCE_MANIFEST_SHA,'reviewed-source-manifest-pin');value=read(p);need(type(value)is dict and value and all(B.F.OPS.L.safe_path(n)and(n in{'docker-compose.cloud.yml','.github/workflows/factory-review-restore-contract.yml'}or any(n.startswith(a+'/')for a in B.APPS))and pin(h)for n,h in value.items()),'reviewed-app-compose-and-exact-ci-workflow-scope');return value

def source(b,revision):
 need(run(['git','symbolic-ref','--quiet','HEAD']).decode().strip()=='refs/heads/main'and run(['git','rev-parse','HEAD']).decode().strip()==revision and revision in{BASE,TARGET},'canonical-known-main-revision');manifest=reviewed_manifest();names=run(['git','diff','--name-only','-z',BASE,TARGET]).decode().rstrip('\0').split('\0');need(set(names)==set(manifest)and not set(names)&set(b['preexistingFourDirty']),'exact-reviewed-app-and-compose-diff');need(run(['git','rev-parse',TARGET+'^{tree}']).decode().strip()==TREE,'exact-reviewed-target-tree');need(B.dirty_snapshot()==b['preexistingFourDirty'],'four-existing-dirty-files-identical');run(['git','diff','--quiet','--no-ext-diff','--no-textconv','--',*B.APPS,'docker-compose.cloud.yml'])
 for n,h in manifest.items():need(sha(run(['git','show',TARGET+':'+n]))==h and(revision!=TARGET or B.F.OPS.L.file_hash(ROOT/n)==h),'all-reviewed-file-hashes')
 for n in B.FIXED:
  expected=revision if n=='docker-compose.cloud.yml'else BASE;need((ROOT/n).is_file()and not(ROOT/n).is_symlink()and(ROOT/n).read_bytes()==run(['git','show',expected+':'+n])and B.meta(ROOT/n)=={k:b['configuration'][n][k]for k in('mode','uid','gid')},'all-fixed-configuration-and-mode-owners-preserved-except-reviewed-compose')
 for n in(*[n for n in B.FIXED if n!='docker-compose.cloud.yml'],B.FACTORY+'/pb_migrations'):need(run(['git','rev-parse',BASE+':'+n])==run(['git','rev-parse',TARGET+':'+n]),'unchanged-docker-global-and-pocketbase-migrations')
 n=B.QC+'/server/server.js';old=run(['git','show',BASE+':'+n]);new=run(['git','show',TARGET+':'+n]);start=b'const SCHEMA_SQL = ';end=b'\nmigrateLegacyDb();'
 def region(data):need(data.count(start)==1 and data.count(end)==1,'unique-qms-existing-schema-startup-region');a=data.index(start);return data[a:data.index(end,a)+len(end)]
 need(region(old)==region(new),'qms-existing-business-schema-seed-migrations-startup-unchanged');run(['git','merge-base','--is-ancestor',BASE,TARGET])

def configuration(b):source(b,TARGET);environment_exact(b)

def compose_contract(b,token):
 expected=copy.deepcopy(read(BACKUP/'compose-render.private.json'))
 for service in ORDER:
  key=SERVICE_TOKEN_KEYS[service];need(key not in expected['services'][service].get('environment',{}),'new-compose-only-three-token-fields');expected['services'][service].setdefault('environment',{})[key]=token or''
 actual=json.loads(run([*COMPOSE,'config','--format','json']));need(actual==expected,'entire-compose-render-only-three-dedicated-runtime-token-fields');return actual

def prepare(result,b):
 runtime,raw=B.runtime();need(runtime==b['runtime']and B.flags()==b['maintenanceInventory'],'original-runtime-before-build');environment_exact(b);operation(['git','-c','core.hooksPath=/dev/null','fetch','--no-write-fetch-head','origin','main'],'fetch-reviewed-main');need(run(['git','rev-parse','origin/main']).decode().strip()==TARGET,'exact-current-remote-main');head=run(['git','rev-parse','HEAD']).decode().strip();source(b,head)
 if head==BASE:operation(['git','-c','core.hooksPath=/dev/null','merge','--ff-only',TARGET],'source-fast-forward')
 configuration(b);compose_contract(b,token_values(EXPECTED_ENV));literal=envs();private('literal-environments.private.json',literal);tags={s:'rr-portal-'+s+'-qms-auth:'+TARGET for s in ORDER};args=overlay(tags,literal,'build.private.yml',True)
 for service in ORDER:operation([*args,'build',service],'build-'+service,1800)
 images={s:json.loads(run(['docker','image','inspect',tags[s]]))[0]['Id']for s in ORDER};proofs={s:candidate(s,images[s],raw[s])for s in ORDER};need(B.runtime()[0]==runtime and B.flags()==b['maintenanceInventory'],'all46-originals-serve-through-three-builds');configuration(b);private('prepared.private.json',{'target':TARGET,'tree':TREE,'images':images,'proofs':proofs,'originalRuntime':runtime});result.update(success=True,candidatesBuiltBeforeAnyMaintenance=True,targetContainerCount=3,otherContainerCount=43,all46OriginalContainersUnchanged=True,environmentFileUnchanged=True,tokenGeneratedOrInstalled=False,images=images)

def maintenance(fn,service):
 need(fn in{'maintenance_on','maintenance_off','wait_service_ready','require_maintenance_cleared'}and service in ORDER,'only-owned-three-service-maintenance');operation(['bash','-c','set -euo pipefail; source "$1"; "$2" "$3"','qms-api-auth',str(ROOT/'deploy/service-maintenance.sh'),fn,service],fn+'-'+service,330,service=service)

def recover(service,old,b,before,literal,rollback,closed,closed_path,attempted,stopped,result):
 need(service in ORDER,'only-owned-failed-service-recovery');maintenance('maintenance_on',service);owned_flags(b,service);need(not stopped or closed is not None,'no-restart-without-fresh-closed-business-evidence')
 if stopped:replay_snapshot(service,closed,closed_path)
 recovery_start=None
 if attempted:
  current=run([*rollback,'ps','-a','-q',service]).decode().strip();need(re.fullmatch('[a-f0-9]{12,64}',current)is not None,'one-owned-failed-candidate');operation(['docker','stop','--time','60',current],'stop-failed-'+service,80);failed,fp=B.capture(service,'failed-candidate');private(service+'-failed-raw-before-comparison.private.json',failed);replay_snapshot(service,failed,fp);recovery_start=json.loads(run(['docker','inspect',current]))[0]['State']['StartedAt'];same_data(service,closed,failed,closed_path,fp,recovery_start);operation([*rollback,'up','-d','--force-recreate','--no-build','--no-deps','--pull','never',service],'recover-only-'+service,180)
 elif stopped:operation(['docker','start',old['Id']],'restart-only-original-'+service,80)
 maintenance('wait_service_ready',service);now,raw=B.runtime();unchanged_except(before,now,service);revision=(old['Config'].get('Labels')or{}).get('org.opencontainers.image.revision');full_contract(service,old,raw[service],old['Image'],literal,rollback,revision,allow_same=True);need(proof(service,old['Image'],raw[service]['Id'],BASE)==b['sourceProof'][service]['files'],'recovered-original-full-source-and-assets')
 if closed is not None:
  after,ap=B.capture(service,'after-recovery');private(service+'-recovery-raw-before-comparison.private.json',after);replay_snapshot(service,after,ap);same_data(service,closed,after,closed_path,ap,recovery_start or raw[service]['State']['StartedAt'])
 configuration(b);operation(['sleep','11'],'recovery-dns-'+service,20);maintenance('maintenance_off',service);maintenance('require_maintenance_cleared',service);cleared_flags(b);result['failedServiceRecoveredWithoutDataRestore']=True

def auth_request(path,token=None):
 need(path.startswith('/qc/api/')and'..'not in path,'fixed-qms-readonly-auth-probe');headers={'Host':'8.148.146.194','Cache-Control':'no-cache'}
 if token is not None:need(type(token)is str and re.fullmatch('[A-Za-z0-9_-]{43,128}',token)is not None,'bounded-private-probe-token');headers['Authorization']='Bearer '+token
 class NoRedirect(urllib.request.HTTPRedirectHandler):
  def redirect_request(self,*args,**kwargs):return None
 request=urllib.request.Request('http://127.0.0.1'+path,method='GET',headers=headers);opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),NoRedirect())
 try:
  with opener.open(request,timeout=20)as response:body=response.read(16*1024**2+1);need(len(body)<=16*1024**2,'bounded-integration-response');return response.status,body
 except urllib.error.HTTPError as error:return error.code,error.read(8192)

def integration_acceptance(token):
 allowed={'id','date','inspDate','supplier','client','productNo','productName','deliveryNo','orderNo','type','qty','sampleQty','fail','defectRate','result','defect','qc','remark'}
 for company in sorted(B.QC_COMPANIES):
  path='/qc/api/integration/inspections?company='+company;status,body=auth_request(path,token);need(status==200,'new-integration-read-http200');value=json.loads(body);need(type(value)is dict and set(value)=={'company','records'}and value['company']==company and type(value['records'])is list and all(type(row)is dict and'id'in row and set(row)<=allowed for row in value['records']),'new-integration-only-company-and-whitelisted-record-fields')
  for credential in(None,'0'*64):need(auth_request(path,credential)[0]==401,'integration-rejects-missing-or-wrong-token')
  for credential in(None,token):need(auth_request('/qc/api/bootstrap?company='+company,credential)[0]==401,'old-bootstrap-rejects-anonymous-and-service-credential')
 for path in('/qc/api/export/records.csv','/qc/api/export/factory-excel.xls','/qc/api/ai/status','/qc/api/session'):need(auth_request(path+'?company=dg-xingxin')[0]==401,'anonymous-export-ai-and-session-read-rejected')
 return{'newEndpointOnly':True,'companyCount':13,'authorizedReadHTTP':200,'anonymousAndWrongTokenHTTP':401,'oldBootstrapAnonymousAndServiceTokenHTTP':401,'anonymousExportsAIAndSessionHTTP':401,'modelCallsPerformed':False,'businessWritesPerformed':False}

def deploy(result,b):
 p=prepared();configuration(b);need(p['originalRuntime']==b['runtime']and envs()==read(PREPARE/'literal-environments.private.json'),'prepared-original-runtime-and-full-env-bound');before,raw=B.runtime();need(before==b['runtime']and B.flags()==b['maintenanceInventory'],'original-all46-before-config-step');result['tokenConfigurationAttempted']=True;token=install_token(b);result.update(dedicatedTokenConfigurationInstalled=True,environmentOnlyTwoDedicatedTokenNamesInstalled=True,existingEnvironmentModeOwnerPreserved=True);configuration(b);compose_contract(b,token);literal=desired_envs(token);private('desired-runtime-environments.private.json',literal);args=overlay(p['images'],literal,'runtime.private.yml');original=envs();rollback=overlay({s:raw[s]['Image']for s in ORDER},original,'rollback.private.yml');completed=[];evidence={}
 for service in ORDER:
  global STAGE
  STAGE='switch-'+service;old=raw[service];closed=None;closed_path=None;attempted=False;stopped=False
  try:
   configuration(b);need(B.runtime()[0]==before and B.flags()==b['maintenanceInventory'],'all-runtime-and-flags-stable-before-own-switch');maintenance('maintenance_on',service);owned_flags(b,service);operation(['sleep','60'],'drain-'+service,70);operation(['docker','stop','--time','60',old['Id']],'stop-own-old-writer-'+service,80);stopped=True;stopped_runtime(before,old,service);closed,closed_path=B.capture(service,'closed-before');private(service+'-closed-raw-before-comparison.private.json',closed);replay_snapshot(service,closed,closed_path);stopped_runtime(before,old,service);configuration(b);owned_flags(b,service);attempted=True;operation([*args,'up','-d','--force-recreate','--no-build','--no-deps','--pull','never',service],'recreate-only-'+service,180);maintenance('wait_service_ready',service);now,newraw=B.runtime();new=newraw[service];started={'candidateStartedAt':new['State']['StartedAt'],'containerId':new['Id'],'image':new['Image']};private(service+'-candidate-started.private.json',started);full_contract(service,old,new,p['images'][service],literal,args,TARGET);need(proof(service,p['images'][service],new['Id'])==p['proofs'][service],'actual-service-source-and-assets-equal-prepared');unchanged_except(before,now,service);post,post_path=B.capture(service,'after-start');private(service+'-poststart-raw-before-comparison.private.json',post);replay_snapshot(service,post,post_path);need(B.runtime()[0]==now,'runtime-stable-through-fresh-poststart-capture');counts=same_data(service,closed,post,closed_path,post_path,started['candidateStartedAt']);audit={'candidateStartedAt':started['candidateStartedAt'],'afterSnapshotObservedUTC':post['observedUTC'],'retentionCutoffBasis':'after_snapshot_observation','deletionActorOrExactTimesProven':False,'logCounts':counts,'businessTypedSchemaFilesAndOwnershipPreserved':True};private(service+'-closed-comparison.private.json',audit);evidence[service]={'before':closed,'after':post,'started':started,'audit':audit};configuration(b);owned_flags(b,service);operation(['sleep','11'],'dns-grace-'+service,20);maintenance('maintenance_off',service);maintenance('require_maintenance_cleared',service);cleared_flags(b);result.setdefault('public',{})[service]=public(service,p['proofs'][service])
   if service=='qc':result['integration']=integration_acceptance(token)
   need(B.runtime()[0]==now,'all45-contracts-stable-after-own-public-smoke');before=now;completed.append(service);result['completedServices']=completed[:]
  except BaseException:
   result['failedService']=service
   try:recover(service,old,b,before,original,rollback,closed,closed_path,attempted,stopped,result)
   except BaseException:result['failedServiceRetainsOwnMaintenance']=True;private(service+'-recovery-failure.private.txt',traceback.format_exc().encode())
   raise
 need(completed==list(ORDER),'all-three-services-complete');configuration(b);compose_contract(b,token);cleared_flags(b);private('closed-evidence.private.json',evidence);private('final-runtime.private.json',before);result.update(success=True,images=p['images'],allOther43ContainersUnchanged=True,allBusinessTypedRowsSchemaFilesAndModeOwnersPreserved=True,environmentOnlyTwoDedicatedTokenNamesInstalled=True,existingEnvironmentModeOwnerPreserved=True,allMaintenanceFlagsRestored=True,buildsPerformed=False)

def verify(result,b):
 global EXPECTED_ENV
 p=prepared();receipt=sealed(DEPLOY,DEPLOY_MANIFEST,DEPLOY_RESULT,'deploy');need(receipt.get('completedServices')==list(ORDER)and receipt.get('buildsPerformed')is False,'all-three-scoped-deploy-success');token=(DEPLOY/'integration-token.private').read_bytes().decode();EXPECTED_ENV=desired_environment((BACKUP/'environment.private').read_bytes(),token);need(EXPECTED_ENV==(DEPLOY/'environment-after.private').read_bytes(),'exact-two-name-environment-intent-reproduced');configuration(b);compose_contract(b,token);literal=desired_envs(token);need(literal==read(DEPLOY/'desired-runtime-environments.private.json')and p['originalRuntime']==b['runtime'],'prepared-and-deployed-full-env-binding');current,raw=B.runtime();need(current==read(DEPLOY/'final-runtime.private.json')and current['others']==b['runtime']['others'],'current-final-runtime-and-original43');cleared_flags(b);evidence=read(DEPLOY/'closed-evidence.private.json');need(set(evidence)==set(ORDER),'all-three-closed-evidence-present');oldraw=read(BACKUP/'target-inspect.private.json');args=[*COMPOSE,'-f',str(DEPLOY/'runtime.private.yml')]
 for service in ORDER:
  entry=evidence[service];a,c,started,audit=(entry[k]for k in('before','after','started','audit'));need(started=={'candidateStartedAt':raw[service]['State']['StartedAt'],'containerId':raw[service]['Id'],'image':p['images'][service]}and read(DEPLOY/(service+'-candidate-started.private.json'))==started,'sealed-cutover-exact-current-candidate-binding');ap=DEPLOY/(service+'-closed-before');cp=DEPLOY/(service+'-after-start');need(read(DEPLOY/(service+'-closed-before.private.json'))==a and read(DEPLOY/(service+'-after-start.private.json'))==c,'sealed-capture-audit-binding');replay_snapshot(service,a,ap);replay_snapshot(service,c,cp);counts=same_data(service,a,c,ap,cp,started['candidateStartedAt']);expected={'candidateStartedAt':started['candidateStartedAt'],'afterSnapshotObservedUTC':c['observedUTC'],'retentionCutoffBasis':'after_snapshot_observation','deletionActorOrExactTimesProven':False,'logCounts':counts,'businessTypedSchemaFilesAndOwnershipPreserved':True};need(audit==expected and read(DEPLOY/(service+'-closed-comparison.private.json'))==expected,'closed-data-audit-reproduced');full_contract(service,oldraw[service],raw[service],p['images'][service],literal,args,TARGET);need(proof(service,p['images'][service],raw[service]['Id'])==p['proofs'][service],'actual-source-and-assets-equal-prepared');result.setdefault('public',{})[service]=public(service,p['proofs'][service])
 result['integration']=integration_acceptance(token);configuration(b);need(B.runtime()[0]==current,'all46-stable-through-readonly-verify');cleared_flags(b);private('verified-runtime.private.json',current);result.update(success=True,images=p['images'],allThreePreparedSourcesAndRuntimeContractsVerified=True,allThreeSealedClosedDataChecksReproduced=True,allOther43ContainersUnchanged=True,environmentOnlyTwoDedicatedTokenNamesInstalled=True,existingEnvironmentModeOwnerPreserved=True,allMaintenanceFlagsRestored=True,freshLiveBusinessComparisonPerformed=False,buildsPerformed=False)

def main():
 global OUT,EXPECTED_ENV
 need(PHASE in{'prepare','deploy','verify'}and sys.argv[1:]==[PHASE]and os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_ATTEMPT')=='1'and pin(TARGET,40)and pin(TREE,40)and pin(SOURCE_MANIFEST_SHA),'blank-draft-or-wrong-phase-branch-attempt-target');os.umask(0o077);OUT={'prepare':PREPARE,'deploy':DEPLOY,'verify':VERIFY}[PHASE];OUT.mkdir(mode=0o700);initialize();signal.signal(signal.SIGTERM,lambda *_:need(False,'terminated'));result={'mode':PHASE,'base':BASE,'target':TARGET,'tree':TREE,'success':False,'businessWritesPerformed':False,'databaseRestoreOrCursorResetPerformed':False,'modelCallsPerformed':False,'authenticatedBusinessWritesPerformed':False,'otherServicesRequested':False,'secretOrRowsPrinted':False,'persistentAuthSessionFilesCreated':False}
 try:
  b=baseline();EXPECTED_ENV=(BACKUP/'environment.private').read_bytes();{'prepare':prepare,'deploy':deploy,'verify':verify}[PHASE](result,b);baseline()
 except BaseException as error:result.update(success=False,failedStage=STAGE,backupLibraryFailedStage=B.STAGE,safeExceptionType=type(error).__name__);private('failure.private.txt',traceback.format_exc().encode())
 finally:private('first-result.json',result);B.F.OPS.L.seal(OUT);print(enc(dict(result,manifestSHA256=B.F.OPS.L.file_hash(OUT/'manifest.json'),resultSHA256=B.F.OPS.L.file_hash(OUT/'first-result.json'))).decode(),flush=True)
 return 0 if result['success']else 1
if __name__=='__main__':
 try:sys.exit(main())
 except SystemExit:raise
 except BaseException:print('{"mode":"rejected","success":false,"safeFailure":"QMS_API_AUTH_RELEASE_PREFLIGHT_REJECTED"}',flush=True);sys.exit(1)
