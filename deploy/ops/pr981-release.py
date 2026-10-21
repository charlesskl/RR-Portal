"""Two-service PR981 release. Draft; no execution until exact phase is pinned.
No business CRUD or database restore. Model smoke contains synthetic evidence only.
"""
import contextlib,copy,datetime,hashlib,importlib.util,io,json,os,secrets,shutil,tempfile,pathlib,re,signal,stat,subprocess,sys,tarfile,time,urllib.error,urllib.request
PHASE=''
TARGET=''
TREE=''
BASE='9b890cc016da403f929f8a7aaeddb878d3de24c5'
BRANCH='refs/heads/ops/pr-981-20261021'
ROOT=pathlib.Path('/opt/rr-portal');APP='apps/PMC跟仓管/加工厂月度评审管理制度'
BACKUP=ROOT/'deploy/backups/pr-981-20261021-backup';PREPARE=BACKUP.with_name('pr-981-20261021-prepare-06');DEPLOY=BACKUP.with_name('pr-981-20261021-deploy');VERIFY=BACKUP.with_name('pr-981-20261021-verify')
BACKUP_MANIFEST='1f09e9e07ad438b8bcc61d2d48626af52da83e4e30b5c0a97e1857a89217e9cf';BACKUP_RESULT='f91ca497bc7fe74b263fce4ae244bcb5861e948de4cd3eae494713542630cfe3'
PREPARE_MANIFEST='';PREPARE_RESULT='';DEPLOY_MANIFEST='';DEPLOY_RESULT=''
SERVICES=('factory-review-test','factory-review');ALLOW={ 'FACTORY_REVIEW_AI_'+x for x in ('PROVIDER','ENABLED','API_KEY','MODEL','BASE_URL')}
COMPOSE=['docker','compose','-p','rr-portal','-f',str(ROOT/'docker-compose.cloud.yml'),'--env-file',str(ROOT/'.env.cloud.production')]
DEPS={'factory-review-backup-library.py':'79d76bb47312dd08c121ebe2797f54d958666f8b72d00721f67712b152fc4666','batch-host-config-library.py':'bd1842dc6847f3e0e5c0c38374c3604791f66d1c94dc651457607dc338f38ff1'}
F=None;H=None;OUT=None;STAGE='entry';SERIAL=0;ENV=None

def need(v,label):
 global STAGE
 if not v:STAGE=label;raise RuntimeError('PR981_SCOPED_RELEASE_REJECTED')
def enc(v):return json.dumps(v,sort_keys=True,ensure_ascii=True,separators=(',',':'),allow_nan=False).encode()
def sha(v):return hashlib.sha256(v).hexdigest()
def read(p):return json.loads(p.read_bytes())
def private(n,v):F.OPS.L.private_write(OUT/n,v if type(v)is bytes else enc(v))
def run(a,data=None,timeout=180):return F.run(a,data,timeout)
def operation(a,label,timeout=180):
 global SERIAL
 SERIAL+=1
 with(OUT/('%03d-%s.private.log'%(SERIAL,label))).open('xb')as f:r=subprocess.run(a,stdout=f,stderr=subprocess.STDOUT,timeout=timeout,cwd=ROOT,env=ENV,umask=0o022 if label=='source-fast-forward'else -1)
 need(r.returncode==0,'operation-'+label)
def load(n):
 p=pathlib.Path(__file__).with_name(n);need(p.is_file()and not p.is_symlink()and sha(p.read_bytes())==DEPS[n],'dependency-pin');s=importlib.util.spec_from_file_location(n.replace('.','_'),p);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
def sealed(p,manifest,result):
 need(p.is_dir()and not p.is_symlink()and stat.S_IMODE(p.stat().st_mode)==0o700,'private-sealed-root');need(F.OPS.L.file_hash(p/'manifest.json')==manifest and F.OPS.L.file_hash(p/'first-result.json')==result,'receipt-seal');v=read(p/'manifest.json');found={str(x.relative_to(p))for x in p.rglob('*')if x.is_file()and x!=p/'manifest.json'};need(set(v)==found and all(F.OPS.L.safe_path(n)and F.OPS.L.file_hash(p/n)==h for n,h in v.items())and all(not x.is_symlink()and x.stat().st_mode&0o077==0 for x in p.rglob('*')),'complete-sealed-files');r=read(p/'first-result.json');need(r['success']is True,'prior-phase-success');return r
def baseline():
 r=sealed(BACKUP,BACKUP_MANIFEST,BACKUP_RESULT);need(r['base']==BASE and r['portableSQLiteCount']==4 and r['backupComplete'],'fresh-two-service-backup');return read(BACKUP/'baseline.private.json')
def flags():return F.OPS.L.non_database_inventory(ROOT/'deploy/maintenance',[])
def source(b,revision):
 need(run(['git','symbolic-ref','--quiet','HEAD']).decode().strip()=='refs/heads/main'and run(['git','rev-parse','HEAD']).decode().strip()==revision,'exact-main');need(F.dirty_snapshot()==b['preexistingFourDirty'],'preserve-preexisting-dirty');run(['git','diff','--quiet','--',APP,'docker-compose.cloud.yml','.env.example'])
 manifest=read(pathlib.Path(__file__).with_name('pr981-reviewed-files.json'));names=run(['git','diff','--name-only','-z',BASE,TARGET]).decode().rstrip('\0').split('\0');need(set(names)==set(manifest)and not set(names)&set(b['preexistingFourDirty']),'reviewed-only-diff');need(run(['git','rev-parse',TARGET+'^{tree}']).decode().strip()==TREE,'target-tree')
 for n,h in manifest.items():need(sha(run(['git','show',TARGET+':'+n]))==h and (revision!=TARGET or F.OPS.L.file_hash(ROOT/n)==h),'reviewed-source-hashes')
 for n in('deploy/service-maintenance.sh',APP+'/Dockerfile',APP+'/.dockerignore',APP+'/pb_migrations'):need(run(['git','rev-parse',BASE+':'+n])==run(['git','rev-parse',TARGET+':'+n]),'unchanged-runtime-and-migrations')
def envs():return{s:read(BACKUP/(s+'-literal-configured-environment.private.json'))for s in SERVICES}
def intended():
 old=envs();ids=run(['docker','ps','-aq','--no-trunc']).decode().split();rows=json.loads(run(['docker','inspect',*ids]));qc=[r for r in rows if(r['Config'].get('Labels')or{}).get('com.docker.compose.project')=='rr-portal'and(r['Config'].get('Labels')or{}).get('com.docker.compose.service')=='qc-report'];need(len(qc)==1,'company-config-present');q=F.envmap(qc[0]['Config']['Env']);need(q.get('OPENAI_BASE_URL')=='https://dashscope.aliyuncs.com/compatible-mode/v1'and q.get('OPENAI_MODEL')=='qwen3.8-max'and bool(q.get('OPENAI_API_KEY')),'known-company-provider-trio');new=copy.deepcopy(old);new['factory-review'].update(FACTORY_REVIEW_AI_PROVIDER='qwen',FACTORY_REVIEW_AI_ENABLED='true',FACTORY_REVIEW_AI_API_KEY=q['OPENAI_API_KEY'],FACTORY_REVIEW_AI_MODEL=q['OPENAI_MODEL'],FACTORY_REVIEW_AI_BASE_URL=q['OPENAI_BASE_URL']);need(new['factory-review-test']==old['factory-review-test']and{k:v for k,v in new['factory-review'].items()if k not in ALLOW}=={k:v for k,v in old['factory-review'].items()if k not in ALLOW},'only-production-five-ai-variables');return new

def overlay(images,literal,name,build=False):
 p=OUT/name;lines=['services:']
 for s in SERVICES:
  lines += ['  '+s+':','    image: '+images[s],'    pull_policy: never','    environment: !override '+json.dumps({k:v.replace('$','$$')for k,v in literal[s].items()},ensure_ascii=True)]
  if build:lines+=['    build:','      labels: '+json.dumps({'org.opencontainers.image.revision':TARGET}),'      args:','        OCI_REVISION: '+read(BACKUP/(s+'-image.private.json'))['Config']['Labels']['org.opencontainers.image.revision']]
 private(name,('\n'.join(lines)+'\n').encode());args=[*COMPOSE,'-f',str(p)];render=json.loads(run([*args,'config','--format','json']))
 for s in SERVICES:need(render['services'][s]['image']==images[s]and render['services'][s]['environment']=={k:v.replace('$','$$')for k,v in literal[s].items()},'literal-compose-environment')
 return args

def proof(image,cid=None):
 a=['docker','exec',cid,'tar']if cid else['docker','run','--rm','--network','none','--read-only','--log-driver','none','--entrypoint','tar',image];blob=run([*a,'-C','/pb','-cf','-','pb_hooks','pb_migrations','pb_public']);found={};total=0
 with tarfile.open(fileobj=io.BytesIO(blob),mode='r:')as t:
  for m in t:
   n=m.name.rstrip('/');need(F.OPS.L.safe_path(n)and n.split('/')[0]in{'pb_hooks','pb_migrations','pb_public'}and(m.isdir()or m.isfile()),'safe-image-source')
   if m.isdir():continue
   total+=m.size;need(n not in found and m.size<=16*1024**2 and total<=32*1024**2,'bounded-image-source');data=t.extractfile(m).read();found[n]={'bytes':len(data),'sha256':sha(data)}
 names=run(['git','ls-tree','-r','--name-only','-z',TARGET,'--',APP+'/pb_hooks',APP+'/pb_migrations']).decode().rstrip('\0').split('\0');expected={n[len(APP)+1:]:sha(run(['git','show',TARGET+':'+n]))for n in names};need({n:r['sha256']for n,r in found.items()if not n.startswith('pb_public/')}==expected and'pb_public/index.html'in found,'all-hooks-and-migrations');return found

def candidate(s,image,old):
 i=json.loads(run(['docker','image','inspect',image]))[0];need(i['Id']==image and i['Architecture']=='amd64'and i['Os']=='linux'and i['Config']['Labels'].get('org.opencontainers.image.revision')==TARGET,'candidate-revision-platform')
 for k in('Cmd','Entrypoint','User','WorkingDir'):need(i['Config'].get(k)==old['Config'].get(k)or k=='User'and i['Config'].get(k)in(None,'')and old['Config'].get(k)in(None,''),'candidate-process-'+k.lower())
 original=read(BACKUP/(s+'-image.private.json'));need(original['Id']==old['Image']and i['Config'].get('Healthcheck')==original['Config'].get('Healthcheck'),'candidate-image-healthcheck-preserved')
 need(dict(F.envmap(i['Config'].get('Env')or[]),**envs()[s])==envs()[s],'candidate-default-env-covered-by-old-runtime')
 return proof(image)
def valid_probe_result(value):
 if type(value)is not dict or set(value)!={'success','status','model','elapsedMs','diagnostics'}or type(value['success'])is not bool or type(value['status'])is not str or not re.fullmatch('[a-z0-9_]{1,100}',value['status'])or value['model']!='qwen3.8-max'or type(value['elapsedMs'])is not int or not 0<=value['elapsedMs']<=60000:return False
 d=value['diagnostics'];kinds={'not_checked','missing','null','array','object','string','boolean','number','other'};enums={'responseJsonType':kinds,'contentType':kinds,'reportType':kinds,'finishReason':{'not_checked','missing','stop','length','content_filter','tool_calls','function_call','other'},'contentLengthClass':{'not_checked','not_string','empty','one_to_16384','up_to_65536','larger'},'findingsCountClass':{'not_checked','not_array','empty','one_to_eight','more_than_eight'},'rootKeyCountClass':{'not_checked','not_object','empty','one','two','three','four_to_eight','more_than_eight'},'validationClass':{'not_checked','valid','incomplete_response','refused_response','malformed_json','invalid_report_shape','invalid_finding_or_evidence','unexpected_exception'}};booleans={'rootHasSummary','rootHasFindings','rootHasLimitations','rootHasType','rootHasProperties','rootHasRequired','rootHasReport','rootHasResult','rootHasData','rootHasOutput','rootHasAnalysis','nestedReportHasRequiredShape','nestedResultHasRequiredShape','nestedDataHasRequiredShape','nestedOutputHasRequiredShape','nestedAnalysisHasRequiredShape','schemaPropertiesHasRootFields','rootTypeIsObject','rootRequiredListsRootFields','hasChoices','hasFirstChoice','hasRefusal','hasReasoningContent','jsonParsed','summaryValid','findingsArray','limitationsValid','invalidTitle','invalidRisk','invalidAnalysis','invalidActions','invalidCitations'}
 return type(d)is dict and set(d)==set(enums)|booleans and all(type(d[k])is str and d[k]in choices for k,choices in enums.items())and all(type(d[k])is bool for k in booleans)

def model_probe(image,literal,raw,result):
 hook=pathlib.Path(__file__).with_name('pr981-single-synthetic-probe.pb.js');need(hook.is_file()and sha(hook.read_bytes())=='e7271c30188768759f6944c84163c5b77f31e6a5b2fd3ccb00eb86d23993ee6e','synthetic-probe-hook-pin');networks=raw['NetworkSettings']['Networks'];need(len(networks)==1,'single-original-factory-network');network=next(iter(networks));nonce=secrets.token_hex(24);name='rr-pr981-synthetic-'+secrets.token_hex(6)
 with tempfile.TemporaryDirectory(prefix='synthetic-',dir=OUT)as folder:
  d=pathlib.Path(folder);(d/'hooks').mkdir(mode=0o700);(d/'empty').mkdir(mode=0o700);(d/'empty/migrations').mkdir(mode=0o700);(d/'empty/public').mkdir(mode=0o700);F.OPS.L.private_write(d/'hooks/probe.pb.js',hook.read_bytes());env={k:literal['factory-review'][k]for k in ALLOW};env.update(AI_PROBE_ALLOW_ONCE='true',AI_PROBE_NONCE=nonce);need(all(not any(x in v for x in('\r','\n','\0'))for v in env.values()),'literal-probe-env');F.OPS.L.private_write(d/'env',(''.join(k+'='+v+'\n'for k,v in env.items())).encode());cid=None
  try:
   cid=run(['docker','run','-d','--name',name,'--restart','no','--read-only','--no-healthcheck','--log-driver','none','--cap-drop','ALL','--security-opt','no-new-privileges','--memory','512m','--memory-swap','512m','--cpus','1','--network',network,'--env-file',str(d/'env'),'--tmpfs','/probe-state:rw,nosuid,nodev,size=64m','--mount','type=bind,src='+str(d/'hooks')+',dst=/probe-hooks,readonly','--mount','type=bind,src='+str(d/'empty')+',dst=/probe-empty,readonly','--entrypoint','/pb/pocketbase',image,'serve','--http=127.0.0.1:18090','--dir=/probe-state','--hooksDir=/probe-hooks','--migrationsDir=/probe-empty/migrations','--publicDir=/probe-empty/public','--hooksWatch=false','--automigrate=false','--indexFallback=false']).decode().strip();need(re.fullmatch('[a-f0-9]{64}',cid),'isolated-probe-id')
   ready=False
   for _ in range(30):
    p=subprocess.run(['docker','exec',cid,'wget','-q','-O','/dev/null','-T','1','http://127.0.0.1:18090/api/health'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=3)
    if p.returncode==0:ready=True;break
    time.sleep(1)
   need(ready,'isolated-probe-ready');value=json.loads(run(['docker','exec',cid,'sh','-c','exec wget -q -O - -T 50 --header "X-Probe-Nonce: $AI_PROBE_NONCE" --post-data="" http://127.0.0.1:18090/probe'],timeout=55));need(valid_probe_result(value),'bounded-safe-model-result');private('single-synthetic-provider-result.private.json',value);result['syntheticProviderResult']=value;result['providerCallAttempted']=True;need(value['success']is True and value['status']=='validated','company-model-synthetic-validation');return value
  finally:
   subprocess.run(['docker','rm','-f',name],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=30);need(not run(['docker','ps','-aq','--filter','name=^/'+name+'$']).strip(),'isolated-probe-removed')

def prep(result,b):
 runtime,raw=F.runtime();need(runtime==b['runtime']and flags()==b['maintenanceInventory'],'original-runtime-before-build');operation(['git','-c','core.hooksPath=/dev/null','fetch','--no-write-fetch-head','origin','main'],'fetch-reviewed-main');need(run(['git','rev-parse','origin/main']).decode().strip()==TARGET,'remote-target');head=run(['git','rev-parse','HEAD']).decode().strip();need(head in{BASE,TARGET},'recoverable-source-head');source(b,head);need((ROOT/'.env.cloud.production').read_bytes()==(BACKUP/'environment.private').read_bytes(),'original-env-file')
 if head==BASE:operation(['git','-c','core.hooksPath=/dev/null','merge','--ff-only',TARGET],'source-fast-forward')
 source(b,TARGET)
 old=read(BACKUP/'compose-render.private.json');base=json.loads(run([*COMPOSE,'config','--format','json']));need({k:v for k,v in old.items()if k!='services'}=={k:v for k,v in base.items()if k!='services'}and set(old['services'])==set(base['services']),'compose-global-unchanged')
 for s in old['services']:
  a,c=copy.deepcopy(old['services'][s]),copy.deepcopy(base['services'][s])
  if s in SERVICES:a.pop('environment');c.pop('environment')
  need(a==c,'compose-other-config-unchanged')
 literal=intended();private('intended-environments.private.json',literal);tags={s:'rr-portal-'+s+'-981:'+TARGET for s in SERVICES};args=overlay(tags,literal,'build.private.yml',True)
 for service in SERVICES:operation([*args,'build',service],'build-'+service,1800)
 images={s:json.loads(run(['docker','image','inspect',tag]))[0]['Id']for s,tag in tags.items()};proofs={s:candidate(s,images[s],raw[s])for s in SERVICES};smoke=model_probe(images['factory-review'],literal,raw['factory-review'],result);runtime2,_=F.runtime();need(runtime2==runtime and flags()==b['maintenanceInventory'],'old-containers-serve-through-build');source(b,TARGET);need((ROOT/'.env.cloud.production').read_bytes()==(BACKUP/'environment.private').read_bytes()and F.file_metadata(ROOT/'.env.cloud.production')==b['environmentFileMetadata'],'env-file-unchanged-through-build');private('prepared.private.json',{'images':images,'proofs':proofs,'runtime':runtime,'target':TARGET,'tree':TREE});result.update(success=True,candidatesBuiltBeforeMaintenance=True,productionProvider='qwen',productionModel='qwen3.8-max',testConfigurationPreserved=True,providerCallsPerformed=True,syntheticProviderResult=smoke,images=images)

def maintenance(fn,s):
 need(fn in{'maintenance_on','maintenance_off','wait_service_ready','require_maintenance_cleared'}and s in SERVICES,'scoped-maintenance');operation(['bash','-c','set -euo pipefail; source "$1"; "$2" "$3"','pr981',str(ROOT/'deploy/service-maintenance.sh'),fn,s],fn+'-'+s,330)
def atomic_env(data,meta):
 p=ROOT/'.env.cloud.production';tmp=p.with_name('.env.cloud.production.pr981.tmp');need(not tmp.exists(),'new-env-temp');F.OPS.L.private_write(tmp,data);os.chmod(tmp,meta['mode']);os.chown(tmp,meta['uid'],meta['gid']);os.replace(tmp,p)
def new_env_bytes(old,literal):
 need(b'\r'not in old,'unix-dotenv');lines=[line for line in old.splitlines(keepends=True)if not re.match(rb'\s*(?:export\s+)?(?:'+b'|'.join(k.encode()for k in sorted(ALLOW))+rb')\s*=',line)]
 content=b''.join(lines)
 if content and not content.endswith(b'\n'):content+=b'\n'
 for k in sorted(ALLOW):
  v=literal['factory-review'][k];need(not any(c in v for c in('\n','\r','\0')),'single-line-private-env');content+=(k+"='"+v.replace('\\','\\\\').replace("'","\\'")+"'\n").encode()
 return content

def capture(s,label):
 p=OUT/(s+'-'+label);value=F.OPS.sqlite_capture(s,ROOT/APP/F.SERVICES[s],p);value['metadata']={n:F.file_metadata(ROOT/APP/F.SERVICES[s]/n)for n in value['sqlite']};value['observedUTC']=datetime.datetime.now(datetime.timezone.utc).isoformat();private(s+'-'+label+'.private.json',value);return value,p

def timestamp(value):
 match=re.fullmatch(r'(\d{4}-\d\d-\d\d[ T]\d\d:\d\d:\d\d)(?:\.(\d{1,9}))?(Z|[+-]\d\d:\d\d)',value or'')
 if not match:return None
 try:return datetime.datetime.fromisoformat((match[1]+('.'+match[2][:6].ljust(6,'0')if match[2]else'')+match[3]).replace('Z','+00:00')).astimezone(datetime.timezone.utc)
 except ValueError:return None

def log_policy(path,started):
 with contextlib.closing(F.OPS.L.connect(path,True))as db:
  row=db.execute("SELECT CASE WHEN json_valid(value) THEN json_extract(value,'$.logs.maxDays') END,CASE WHEN json_valid(value) THEN json_extract(value,'$.logs.minLevel') END,CASE WHEN json_valid(value) THEN json_type(value,'$.logs.maxDays') END,CASE WHEN json_valid(value) THEN json_type(value,'$.logs.minLevel') END FROM _params WHERE id='settings'").fetchone()
 start=timestamp(started)
 if row is None or row[2:]!=('integer','integer')or type(row[0])is not int or not 0<=row[0]<=36500 or type(row[1])is not int or not -100<=row[1]<=100 or start is None:return None
 return {'cutoff':start-datetime.timedelta(days=row[0]),'minLevel':row[1]}


def logs_retention(oldpath,newpath,olddata,newdata,started,observed):
 policies=[log_policy(p,started)for p in(olddata,newdata)];policy=policies[0]if policies[0]is not None and policies[0]==policies[1]else None;start,end=timestamp(started),timestamp(observed);need(start is not None and end is not None and start<=end,'bounded-pocketbase-request-window');counts={'oldRows':0,'retainedTypedIdentical':0,'retainedTypedChanged':0,'missing':0,'missingCompatibleWithConfiguredRetention':0,'newRows':0,'newRowsWithinRequestTime':0,'configuredPolicyAvailableAndUnchanged':policy is not None}
 with contextlib.closing(F.OPS.L.connect(oldpath,True))as db:
  db.execute('ATTACH DATABASE ? AS afterdb',(newpath.as_uri()+'?mode=ro&immutable=1',));columns=db.execute('PRAGMA table_xinfo(_logs)').fetchall();need(columns==db.execute('PRAGMA afterdb.table_xinfo(_logs)').fetchall()and columns and[c[1]for c in columns if c[5]]==['id'],'identical-pocketbase-log-schema');names=[c[1]for c in columns];need({'id','created','level'}<=set(names),'known-pocketbase-log-fields');q=F.OPS.L.quote;need(all(db.execute('SELECT count(*)=count(DISTINCT id) FROM '+prefix+'._logs').fetchone()==(1,)for prefix in('main','afterdb')),'unique-log-identities');query='SELECT '+','.join('a.'+q(n)for n in names)+','+','.join('b.'+q(n)for n in names)+' FROM _logs a LEFT JOIN afterdb._logs b ON a.id=b.id AND typeof(a.id)=typeof(b.id)';n=len(names);idindex=names.index('id')
  for row in db.execute(query):
   counts['oldRows']+=1;a,b=row[:n],row[n:]
   if b[idindex]is not None:counts['retainedTypedIdentical'if[F.OPS.L.cell(x)for x in a]==[F.OPS.L.cell(x)for x in b]else'retainedTypedChanged']+=1;continue
   counts['missing']+=1;created=timestamp(a[names.index('created')]);level=a[names.index('level')];compatible=policy is not None and((created is not None and created<=policy['cutoff'])or(type(level)is int and level<policy['minLevel']));counts['missingCompatibleWithConfiguredRetention']+=int(compatible)
  for(created,)in db.execute('SELECT b.created FROM afterdb._logs b LEFT JOIN _logs a ON a.id=b.id AND typeof(a.id)=typeof(b.id) WHERE a.id IS NULL'):
   counts['newRows']+=1;created=timestamp(created);counts['newRowsWithinRequestTime']+=int(created is not None and start<=created<=end)
 counts['compatibleWithoutChangingRetainedRows']=counts['retainedTypedChanged']==0 and counts['missing']==counts['missingCompatibleWithConfiguredRetention']and counts['newRows']==counts['newRowsWithinRequestTime'];return counts

def same_data(a,b):
 need(a['sqlite']['data.db']==b['sqlite']['data.db'],'all-business-schema-typed-rows-identical');need(a['files']==b['files']and a['metadata']==b['metadata'],'all-attachments-and-db-metadata-identical');x,y=a['sqlite']['auxiliary.db'],b['sqlite']['auxiliary.db'];need(x['schema']==y['schema']and{k:v for k,v in x['tables'].items()if k!='_logs'}=={k:v for k,v in y['tables'].items()if k!='_logs'},'auxiliary-nonlog-schema-and-rows-identical')
def envmap_process(cid):
 p=F.envmap([x.decode()for x in run(['docker','exec',cid,'cat','/proc/1/environ']).split(b'\0')if x]);need(p.pop('HOSTNAME',None)==cid[:12],'only-automatic-hostname');return p

def contract(s,old,new,literal,image,args):
 need(new['Id']!=old['Id']and new['Image']==image and new['RestartCount']==0 and new['State']['Running']and not new['State']['OOMKilled']and new['State'].get('Health',{}).get('Status')=='healthy','new-healthy-immutable-image');need(H.same_host_config(old['HostConfig'],new['HostConfig'])and sorted(old['Mounts'],key=enc)==sorted(new['Mounts'],key=enc),'full-hostconfig-mounts');a=copy.deepcopy(old['Config']);c=copy.deepcopy(new['Config']);la=a.pop('Labels');lc=c.pop('Labels');need(a.pop('Hostname')==old['Id'][:12]and c.pop('Hostname')==new['Id'][:12],'automatic-hostnames');a.pop('Image');c.pop('Image');a.pop('Env');c.pop('Env');need(a==c and F.envmap(new['Config']['Env'])==literal[s],'all-config-and-literal-environment');expected=read(BACKUP/(s+'-literal-process-environment.private.json'));expected.update({k:v for k,v in literal[s].items()if k in ALLOW});need(envmap_process(new['Id'])==expected,'pid1-actual-environment');allowed={'com.docker.compose.image','com.docker.compose.config-hash','com.docker.compose.project.config_files','org.opencontainers.image.revision'};need({k:v for k,v in la.items()if k not in allowed}=={k:v for k,v in lc.items()if k not in allowed}and lc.get('org.opencontainers.image.revision')==TARGET and lc.get('com.docker.compose.image')==image,'fixed-source-compose-labels')

def get(path):
 request=urllib.request.Request('http://127.0.0.1'+path,headers={'Host':'8.148.146.194','Cache-Control':'no-cache'});opener=urllib.request.build_opener(urllib.request.ProxyHandler({}))
 try:
  with opener.open(request,timeout=20)as r:return r.status,r.read(16*1024**2+1)
 except urllib.error.HTTPError as e:return e.code,e.read(8192)
def public(s,files):
 base='/'+s+'/';status,body=get(base+'api/factory-review/health');need(status==200,'public-health');status,body=get(base);need(status==200 and sha(body)==files['pb_public/index.html']['sha256'],'public-index-matches-image');assets=re.findall(rb'(?:src|href)="([^\"]+/assets/[^\"]+)"',body)
 for asset in assets:
  path=asset.decode();need(path.startswith(base+'assets/')and'..'not in path,'public-safe-asset');status,data=get(path);need(status==200 and files.get('pb_public/'+path[len(base):],{}).get('sha256')==sha(data),'public-asset-matches-image')
 need(len(assets)>0,'public-assets-exercised');status,_=get(base+'api/factory-review/analysis-ai/config');need(status==401,'anonymous-ai-auth-enforced');return{'health':200,'indexMatchesImage':True,'assetCount':len(assets),'anonymousAI':401}

def recovered(s,old,b,runtime,a):
 now,raw=F.runtime();new=raw[s];need(new['Image']==old['Image']and H.same_host_config(old['HostConfig'],new['HostConfig'])and sorted(old['Mounts'],key=enc)==sorted(new['Mounts'],key=enc),'recovered-original-image-host-mounts');left=copy.deepcopy(old['Config']);right=copy.deepcopy(new['Config']);la=left.pop('Labels');lb=right.pop('Labels')
 for k in('Hostname','Image'):left.pop(k);right.pop(k)
 left['Env']=sorted(left['Env']);right['Env']=sorted(right['Env']);need(left==right and envmap_process(new['Id'])==read(BACKUP/(s+'-literal-process-environment.private.json')),'recovered-full-original-config-pid1');allowed={'com.docker.compose.image','com.docker.compose.config-hash','com.docker.compose.project.config_files'};need({k:v for k,v in la.items()if k not in allowed}=={k:v for k,v in lb.items()if k not in allowed},'recovered-original-labels');need(F.runtime_files(s,now['targets'][s])['files']==b['sourceProof'][s]['files'],'recovered-original-hooks-migrations-static');need(now['others']==b['runtime']['others']and all(now['targets'][x]==runtime['targets'][x]for x in SERVICES if x!=s),'recovery-other-containers-unchanged')
 if a is not None:
  after,_=capture(s,'after-recovery');same_data(a,after)
 return now

def deploy(result,b):
 sealed(PREPARE,PREPARE_MANIFEST,PREPARE_RESULT);p=read(PREPARE/'prepared.private.json');need(p['target']==TARGET and p['tree']==TREE,'prepared-source');source(b,TARGET);runtime,raw=F.runtime();need(runtime==b['runtime']and flags()==b['maintenanceInventory'],'unchanged-runtime-before-deploy');literal=read(PREPARE/'intended-environments.private.json');need(literal==intended(),'same-intended-company-config');oldenv=(BACKUP/'environment.private').read_bytes();need((ROOT/'.env.cloud.production').read_bytes()==oldenv and F.file_metadata(ROOT/'.env.cloud.production')==b['environmentFileMetadata'],'env-file-stable');newenv=new_env_bytes(oldenv,literal);private('updated-environment.private',newenv);args=overlay(p['images'],literal,'runtime.private.yml');rollback_args=overlay({s:raw[s]['Image']for s in SERVICES},envs(),'rollback.private.yml');completed=[];changed_env=False
 try:
  atomic_env(newenv,b['environmentFileMetadata']);changed_env=True
  rendered=json.loads(run([*COMPOSE,'config','--format','json']))
  for k in ALLOW:need(rendered['services']['factory-review']['environment'].get(k)==literal['factory-review'][k].replace('$','$$'),'persistent-production-ai-config')
  for s in SERVICES:
   global STAGE
   STAGE='switch-'+s;old=raw[s];a=None;attempted=False
   try:
    maintenance('maintenance_on',s);operation(['sleep','60'],'drain-'+s,70);operation(['docker','stop','--time','60',old['Id']],'stop-'+s,80);closed=json.loads(run(['docker','inspect',old['Id']]))[0];need(not closed['State']['Running'],'old-writer-stopped');a,ap=capture(s,'closed-before');attempted=True
    operation([*args,'up','-d','--force-recreate','--no-build','--no-deps','--pull','never',s],'recreate-'+s,180);maintenance('wait_service_ready',s);now,newraw=F.runtime();new=newraw[s];contract(s,old,new,literal,p['images'][s],args);need(proof(p['images'][s],new['Id'])==p['proofs'][s],'running-source-and-assets');post,bp=capture(s,'after-start');same_data(a,post);logs=logs_retention(ap/'sqlite/auxiliary.db',bp/'sqlite/auxiliary.db',ap/'sqlite/data.db',bp/'sqlite/data.db',new['State']['StartedAt'],post['observedUTC']);private(s+'-log-audit.private.json',logs);need(logs['compatibleWithoutChangingRetainedRows'],'retained-logs-typed-identical-only-valid-additions-or-retention');need(now['others']==b['runtime']['others']and all(now['targets'][x]==runtime['targets'][x]for x in SERVICES if x!=s),'all-other-containers-unchanged');operation(['sleep','11'],'dns-grace-'+s,20);maintenance('maintenance_off',s);maintenance('require_maintenance_cleared',s);result.setdefault('public',{})[s]=public(s,p['proofs'][s]);runtime=now;completed.append(s);result['completedServices']=completed[:]
   except BaseException:
    # Keep evidence and current business records. Never restore SQLite or cursors.
    result['failedService']=s
    try:
     maintenance('maintenance_on',s)
     if attempted:
      current=run([*args,'ps','-a','-q',s]).decode().strip()
      if current:operation(['docker','stop','--time','60',current],'stop-failed-'+s,80)
      failed,fp=capture(s,'failed-candidate');same_data(a,failed)
      operation([*rollback_args,'up','-d','--force-recreate','--no-build','--no-deps','--pull','never',s],'rollback-'+s,180)
     else:operation(['docker','start',old['Id']],'restart-original-'+s,80)
     maintenance('wait_service_ready',s);recovered(s,old,b,runtime,a);operation(['sleep','11'],'rollback-dns-'+s,20);maintenance('maintenance_off',s);maintenance('require_maintenance_cleared',s);result['failedServiceRolledBackWithoutRestoringData']=True
    except BaseException:result['failedServiceRetainsScopedMaintenance']=True
    raise
  need(flags()==b['maintenanceInventory'],'maintenance-restored');result.update(success=True,images=p['images'],allOther44ContainersUnchanged=True,allBusinessSchemaAndTypedRowsPreserved=True,allAttachmentsPreserved=True,productionProvider='qwen',productionModel='qwen3.8-max',testAIEnabled=False,providerCallsPerformed=False)
 except BaseException:
  if changed_env:
   # Keep the environment consistent with any already successful production switch.
   if 'factory-review'not in completed:atomic_env(oldenv,b['environmentFileMetadata'])
  raise
 private('final-runtime.private.json',runtime)

def normalized_ai_declaration(env):
 need(type(env)is dict and all(type(k)is str and type(v)is str for k,v in env.items()),'string-test-env');value=copy.deepcopy(env);provider=value.get('FACTORY_REVIEW_AI_PROVIDER')or'openai';value['FACTORY_REVIEW_AI_PROVIDER']=provider;need(provider in{'openai','qwen'},'known-test-provider');key='FACTORY_REVIEW_AI_BASE_URL'
 if not value.get(key):value[key]='https://dashscope.aliyuncs.com/compatible-mode/v1'if provider=='qwen'else'https://api.openai.com/v1'
 return value

def verify(result,b):
 sealed(PREPARE,PREPARE_MANIFEST,PREPARE_RESULT);sealed(DEPLOY,DEPLOY_MANIFEST,DEPLOY_RESULT);p=read(PREPARE/'prepared.private.json');source(b,TARGET);runtime,raw=F.runtime();need(runtime==read(DEPLOY/'final-runtime.private.json')and runtime['others']==b['runtime']['others']and flags()==b['maintenanceInventory'],'final-runtime-source-flags');literal=read(PREPARE/'intended-environments.private.json')
 need((ROOT/'.env.cloud.production').read_bytes()==(DEPLOY/'updated-environment.private').read_bytes()and F.file_metadata(ROOT/'.env.cloud.production')==b['environmentFileMetadata'],'persistent-env-file-exact');rendered=json.loads(run([*COMPOSE,'config','--format','json']));oldrender=read(BACKUP/'compose-render.private.json');need(normalized_ai_declaration(rendered['services']['factory-review-test']['environment'])==normalized_ai_declaration(oldrender['services']['factory-review-test']['environment']),'test-declared-env-preserved')
 for k in ALLOW:need(rendered['services']['factory-review']['environment'].get(k)==literal['factory-review'][k].replace('$','$$'),'final-persistent-ai-five-vars')
 for s in SERVICES:need(F.envmap(raw[s]['Config']['Env'])==literal[s]and proof(p['images'][s],raw[s]['Id'])==p['proofs'][s],'final-runtime-environment-source');result.setdefault('public',{})[s]=public(s,p['proofs'][s])
 result.update(success=True,images=p['images'],productionProvider='qwen',productionModel='qwen3.8-max',testAIEnabled=False,allOther44ContainersUnchanged=True,providerCallsPerformed=False)

def main():
 global F,H,OUT,ENV
 need(PHASE in{'prepare','deploy','verify'}and sys.argv[1:]==[PHASE]and os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_ATTEMPT')=='1'and re.fullmatch('[a-f0-9]{40}',TARGET or'')and re.fullmatch('[a-f0-9]{40}',TREE or''),'fixed-phase-branch-attempt-target');os.umask(0o077);OUT={'prepare':PREPARE,'deploy':DEPLOY,'verify':VERIFY}[PHASE];OUT.mkdir(mode=0o700);F=load('factory-review-backup-library.py');F.BASE=BASE;F.OUT=OUT;F.OPS=F.load('release-data-ops-library.py');F.OPS.L=F.OPS.load_library(pathlib.Path(__file__).with_name('release-data-library.py'));F.OPS.run=F.run;H=load('batch-host-config-library.py');ENV=dict(os.environ,COMPOSE_PROJECT_NAME='rr-portal',COMPOSE_BAKE='false',COMPOSE_PARALLEL_LIMIT='1',MAINT_FLAG_DIR=str(ROOT/'deploy/maintenance'),COMPOSE_FILE=str(ROOT/'docker-compose.cloud.yml'),ENV_FILE=str(ROOT/'.env.cloud.production'),MAINT_COMPOSE_SERVICES='\n'.join(SERVICES),MAINT_HEALTH_TIMEOUT_SECONDS='300');result={'mode':PHASE,'success':False,'base':BASE,'target':TARGET,'tree':TREE,'businessWritesPerformed':False,'databaseRestorePerformed':False,'otherServicesRequested':False}
 def terminated(*_):need(False,'terminated')
 signal.signal(signal.SIGTERM,terminated)
 try:
  b=baseline();{'prepare':prep,'deploy':deploy,'verify':verify}[PHASE](result,b)
 except BaseException:result.update(success=False,failedStage=STAGE)
 finally:
  F.OPS.L.private_write(OUT/'first-result.json',enc(result));F.OPS.L.seal(OUT);print(enc(dict(result,manifestSHA256=F.OPS.L.file_hash(OUT/'manifest.json'),resultSHA256=F.OPS.L.file_hash(OUT/'first-result.json'))).decode(),flush=True)
 return 0 if result['success']else 1
if __name__=='__main__':
 try:sys.exit(main())
 except SystemExit:raise
 except BaseException:print('{"mode":"rejected","success":false,"safeFailure":"PR981_RELEASE_REJECTED"}',flush=True);sys.exit(1)
