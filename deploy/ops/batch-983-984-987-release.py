"""RR/QC-only resume draft. Every phase/target/archive gate is blank.

Build all candidates while original containers serve, then switch one service at
a time. Preserve literal environment, all business records and unrelated services.
Never restore databases, reset cursors, call models or authenticate to business APIs.
"""
import contextlib,copy,datetime,hashlib,importlib.util,io,json,os,pathlib,re,signal,shutil,stat,subprocess,sys,tarfile,traceback,urllib.error,urllib.request
PHASE='deploy'
TARGET='73364c71ad44528db35197465e9cee0f3e4a2606'
TREE='3275c7fadb9d14d0657196abf35c3a9f4a1906f4'
SOURCE_MANIFEST_SHA='18c715dbf23b3a7fd73e8a0eb7d1e4295f7156e68e9946ef8b593178b6753381'
BASE='97d563e93aca3d9e3c0bc512dd622d6a3002e710'
BASE_TREE='ad906e8b24b81df8e7ade91d15c5e9ab4ab839ab'
BRANCH='refs/heads/ops/batch-983-984-987-20261021'
ROOT=pathlib.Path('/opt/rr-portal')
BACKUP=ROOT/'deploy/backups/batch-983-984-987-20261021-backup-v3'
PREPARE=BACKUP.with_name('batch-983-984-987-20261021-prepare')
DEPLOY=BACKUP.with_name('batch-983-984-987-20261021-deploy-resume-rrauth')
VERIFY=BACKUP.with_name('batch-983-984-987-20261021-verify-resume-rrauth')
BACKUP_MANIFEST='e62aba4d142b5636eaaf3b0da39a2f3e2c11999481a460bda867633c75a300ba';BACKUP_RESULT='0739ea4fc076600164a3120c5af771ed325dd19bfed411be0c21b25a471ed86c';PREPARE_MANIFEST='a98c6e90814ef8d2b75b91bc1197d18869080d0027cc921d19e2bc91e3d8bae5';PREPARE_RESULT='20de48d001617f3b6058ccffe0db965ae6d0d089ec1bb215b60cc004ddad42ca';DEPLOY_MANIFEST='';DEPLOY_RESULT=''
FAILED_DEPLOY=BACKUP.with_name('batch-983-984-987-20261021-deploy')
FAILED_DEPLOY_MANIFEST='5936f15eba0fa138e725fdce2a9fd5978db399de75389a8d891df1409e9b8e47'
FAILED_DEPLOY_RESULT='94130ce746894c72a4b75e4fc4db1a1aa1d11ee67797431eb3e5e0874d7a395e'
COMPLETED=('factory-review-test','factory-review')
RESUME_ORDER=('rr-production','qc')
DEPS={'batch-983-984-987-backup-library.py':'324718256221cc53f193102fe1bb1c020379e8c74352dda02568edd2303c42cd','batch-host-config-library.py':'bd1842dc6847f3e0e5c0c38374c3604791f66d1c94dc651457607dc338f38ff1','factory-review-backup-library.py':'79d76bb47312dd08c121ebe2797f54d958666f8b72d00721f67712b152fc4666','release-data-ops-library.py':'ff9138a1d5bfed1b10077112da6ebcda2d65240f583e2d0e12ce1325cfbaafd5','release-data-library.py':'d63168fd3057f4f2aba2d93f9fab31d2d65c6dd0f3234877d71fcff1e04e62b9'}
ORDER=('factory-review-test','factory-review','rr-production','qc')
COMPOSE=['docker','compose','-p','rr-portal','-f',str(ROOT/'docker-compose.cloud.yml'),'--env-file',str(ROOT/'.env.cloud.production')]
B=None;H=None;OUT=None;ENV=None;STAGE='entrypoint';SERIAL=0

def need(v,label):
 global STAGE
 if not v:STAGE=label;raise RuntimeError('BATCH_983_984_987_RELEASE_REJECTED')
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
 B=load('batch-983-984-987-backup-library.py');need(B.BACKUP_PIN is False and B.BASE==BASE and B.BASE_TREE==BASE_TREE and B.ORDER==ORDER,'inert-exact-backup-library');B.ROOT=ROOT;B.initialize(OUT);H=load('batch-host-config-library.py');ENV=dict(os.environ,COMPOSE_PROJECT_NAME='rr-portal',COMPOSE_BAKE='false',COMPOSE_PARALLEL_LIMIT='1',MAINT_FLAG_DIR=str(ROOT/'deploy/maintenance'),COMPOSE_FILE=str(ROOT/'docker-compose.cloud.yml'),ENV_FILE=str(ROOT/'.env.cloud.production'),MAINT_HEALTH_TIMEOUT_SECONDS='300',MAINT_DNS_GRACE_SECONDS='10')
def sealed(path,manifest_hash,result_hash,mode,success=True):
 need(pin(manifest_hash)and pin(result_hash)and path.is_dir()and not path.is_symlink()and stat.S_IMODE(path.stat().st_mode)==0o700,'private-phase-directory-and-pins');L=B.F.OPS.L;need(L.file_hash(path/'manifest.json')==manifest_hash and L.file_hash(path/'first-result.json')==result_hash,'exact-phase-seals');manifest=read(path/'manifest.json');entries=list(path.rglob('*'));need(type(manifest)is dict and len(entries)<=100000 and all(not p.is_symlink()and(p.is_file()or p.is_dir())and p.stat().st_mode&0o077==0 for p in entries),'all-private-regular-phase-entries');need(set(manifest)=={str(p.relative_to(path))for p in entries if p.is_file()and p!=path/'manifest.json'}and all(L.safe_path(n)and pin(h)and L.file_hash(path/n)==h for n,h in manifest.items()),'all-phase-byte-seals');r=read(path/'first-result.json');need(r.get('success')is success and r.get('mode')==mode and r.get('base')==BASE and r.get('target')==(BASE if mode=='backup'else TARGET)and r.get('tree')==(BASE_TREE if mode=='backup'else TREE),'successful-bound-prior-phase');return r
def baseline():
 r=sealed(BACKUP,BACKUP_MANIFEST,BACKUP_RESULT,'backup');need(r.get('backupComplete')is True and r.get('portableSQLiteCount')==30 and r.get('targetContainerCount')==4 and r.get('otherContainerCount')==42,'complete-four-service-backup');b=read(BACKUP/'baseline.private.json');need(b['head']==BASE and b['tree']==BASE_TREE and set(b['runtime']['targets'])==set(ORDER)and len(b['runtime']['others'])==42 and set(b['storage'])==set(ORDER)==set(b['sourceProof']),'complete-original-baseline');return b
def configuration(b):
 B.environment_stable(dict(b,archive=BACKUP));need(B.dirty_snapshot()==b['preexistingFourDirty'],'preserved-four-dirty-files');need(B.source(TARGET)==b['configuration'],'all-fixed-source-and-global-configuration')
def source(b,revision):
 need(B.source(revision)==b['configuration']and B.dirty_snapshot()==b['preexistingFourDirty'],'canonical-source-and-preexisting-dirty');manifest_path=pathlib.Path(__file__).with_name('batch-983-984-987-reviewed-files.json');need(pin(SOURCE_MANIFEST_SHA)and manifest_path.is_file()and not manifest_path.is_symlink()and sha(manifest_path.read_bytes())==SOURCE_MANIFEST_SHA,'reviewed-change-manifest-pin');manifest=read(manifest_path);need(type(manifest)is dict and manifest and all(B.F.OPS.L.safe_path(n)and any(n.startswith(a+'/')for a in B.APPS)and pin(h)for n,h in manifest.items()),'only-three-apps-reviewed-files');names=run(['git','diff','--name-only','-z',BASE,TARGET]).decode().rstrip('\0').split('\0');need(set(names)==set(manifest)and not set(names)&set(b['preexistingFourDirty']),'exact-reviewed-three-app-diff');need(run(['git','rev-parse',TARGET+'^{tree}']).decode().strip()==TREE,'exact-reviewed-target-tree')
 for n,h in manifest.items():need(sha(run(['git','show',TARGET+':'+n]))==h and(revision!=TARGET or B.F.OPS.L.file_hash(ROOT/n)==h),'all-reviewed-changed-file-shas')
 # No Docker, global, migration or engineering startup recipe changes.
 for n in(*B.FIXED,B.FACTORY+'/pb_migrations',B.RR+'/server.js',B.RR+'/scripts/migrate-unquoted.js'):
  need(run(['git','rev-parse',BASE+':'+n])==run(['git','rev-parse',TARGET+':'+n]),'unchanged-runtime-migrations-engineering-startup')
 # PR987 may edit routes in this file; its complete schema/startup region is fixed.
 n=B.QC+'/server/server.js';old=run(['git','show',BASE+':'+n]);new=run(['git','show',TARGET+':'+n]);start=b'const SCHEMA_SQL = ';end=b'\nmigrateLegacyDb();'
 def region(data):need(data.count(start)==1 and data.count(end)==1,'unique-qc-startup-region');a=data.index(start);z=data.index(end,a)+len(end);return data[a:z]
 need(region(old)==region(new),'qc-schema-seed-migrations-and-startup-unchanged')
 run(['git','merge-base','--is-ancestor',BASE,TARGET])
def envs():return{s:read(BACKUP/(s+'-literal-configured-environment.private.json'))for s in ORDER}
def overlay(images,literal,name,build=False):
 need(set(images)==set(literal)==set(ORDER),'overlay-exact-four-services');lines=['services:']
 for s in ORDER:
  need(type(literal[s])is dict and all(type(k)is str and type(v)is str for k,v in literal[s].items()),'literal-environment-map');lines+=['  '+s+':','    image: '+images[s],'    pull_policy: never','    environment: !override '+json.dumps({k:v.replace('$','$$')for k,v in literal[s].items()},ensure_ascii=True)]
  if build:
   lines+=['    build:','      labels: '+json.dumps({'org.opencontainers.image.revision':TARGET})]
   if s.startswith('factory-review'):
    old=read(BACKUP/(s+'-image.private.json'));revision=(old['Config'].get('Labels')or{}).get('org.opencontainers.image.revision');need(pin(revision,40),'original-factory-build-revision');lines+=['      args:','        OCI_REVISION: '+revision]
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
 oldlabels=original['Config'].get('Labels')or{};newlabels=i['Config'].get('Labels')or{};need({k:v for k,v in oldlabels.items()if k!='org.opencontainers.image.revision'}=={k:v for k,v in newlabels.items()if k!='org.opencontainers.image.revision'},'unchanged-other-image-labels');need(dict(B.F.envmap(i['Config'].get('Env')or[]),**envs()[s])==envs()[s],'candidate-default-environment-covered-by-original-literal');private(s+'-candidate-image.private.json',i);return proof(s,image)
def prepared():
 sealed(PREPARE,PREPARE_MANIFEST,PREPARE_RESULT,'prepare');p=read(PREPARE/'prepared.private.json');need(p['target']==TARGET and p['tree']==TREE and set(p['images'])==set(p['proofs'])==set(ORDER),'exact-prepared-source-and-services');need(all(re.fullmatch('sha256:[a-f0-9]{64}',v)for v in p['images'].values()),'immutable-prepared-image-identities');return p
def prepare(result,b):
 runtime,raw=B.runtime();need(runtime==b['runtime']and B.flags()==b['maintenanceInventory'],'original-runtime-before-build');B.environment_stable(dict(b,archive=BACKUP));operation(['git','-c','core.hooksPath=/dev/null','fetch','--no-write-fetch-head','origin','main'],'fetch-reviewed-main');need(run(['git','rev-parse','origin/main']).decode().strip()==TARGET,'exact-current-remote-main');head=run(['git','rev-parse','HEAD']).decode().strip();need(head in{BASE,TARGET},'known-canonical-source-head');source(b,head)
 if head==BASE:operation(['git','-c','core.hooksPath=/dev/null','merge','--ff-only',TARGET],'source-fast-forward')
 source(b,TARGET);render=json.loads(run([*COMPOSE,'config','--format','json']));need(render==read(BACKUP/'compose-render.private.json'),'entire-original-compose-render-unchanged');literal=envs();private('literal-environments.private.json',literal);tags={s:'rr-portal-'+s+'-983-984-987:'+TARGET for s in ORDER};args=overlay(tags,literal,'build.private.yml',True)
 for s in ORDER:operation([*args,'build',s],'build-'+s,1800)
 images={s:json.loads(run(['docker','image','inspect',tags[s]]))[0]['Id']for s in ORDER};proofs={s:candidate(s,images[s],raw[s])for s in ORDER};after,_=B.runtime();need(after==runtime and B.flags()==b['maintenanceInventory'],'original-four-and42-serve-through-all-builds');configuration(b);private('prepared.private.json',{'target':TARGET,'tree':TREE,'images':images,'proofs':proofs,'originalRuntime':runtime});result.update(success=True,candidatesBuiltBeforeAnyMaintenance=True,targetContainerCount=4,otherContainerCount=42,all46OriginalContainersUnchanged=True,environmentFileUnchanged=True,images=images)
def maintenance(fn,s):
 need(fn in{'maintenance_on','maintenance_off','wait_service_ready','require_maintenance_cleared'}and s in RESUME_ORDER,'only-owned-remaining-service-maintenance-operation');operation(['bash','-c','set -euo pipefail; source "$1"; "$2" "$3"','batch983984987',str(ROOT/'deploy/service-maintenance.sh'),fn,s],fn+'-'+s,330,service=s)
def owned_flags(b,s):
 previous={r['path']:r for r in b['maintenanceInventory']};now={r['path']:r for r in B.flags()};own=now.pop('services/'+s,None);need(own=={'path':'services/'+s,'directory':False,'mode':0o600,'bytes':0,'sha256':sha(b'')},'only-own-empty-maintenance-flag')
 if'services'not in previous:need(now.pop('services',None)=={'path':'services','directory':True,'mode':0o700},'only-own-new-services-directory')
 need(now==previous,'all-other-maintenance-flags-identical')
def cleared_flags(b):
 if not any(r['path']=='services'for r in b['maintenanceInventory']):
  p=ROOT/'deploy/maintenance/services'
  if p.exists():need(p.is_dir()and not p.is_symlink()and not list(p.iterdir()),'only-created-empty-services-directory');p.rmdir()
 need(B.flags()==b['maintenanceInventory'],'all-original-maintenance-flags-restored')
def unchanged_except(before,after,s):need(after['others']==before['others']and all(after['targets'][x]==before['targets'][x]for x in ORDER if x!=s),'all-42-and-other-three-containers-unchanged')
def stopped_runtime(before,old,s):
 current,raw=B.runtime(False);unchanged_except(before,current,s);a,c=before['targets'][s],current['targets'][s];need(raw[s]['Id']==old['Id']and c['running']is False and all(a[k]==c[k]for k in('id','image','started','restarts','environmentMapSHA256','mounts','configSHA256','hostConfigSHA256')),'only-owned-old-writer-stopped-with-original-contract');return current
def full_contract(s,old,new,image,literal,args,revision,allow_same=False):
 same=new['Id']==old['Id'];need((allow_same or not same)and new['Image']==image and new['Config'].get('Image')==(old['Config']['Image']if same else image)and new['RestartCount']==(old['RestartCount']if same else 0)and new['State']['Running']is True and new['State']['OOMKilled']is False and new['State'].get('Health',{}).get('Status')=='healthy','healthy-immutable-running-image');need(H.same_host_config(old['HostConfig'],new['HostConfig'])and sorted(old['Mounts'],key=enc)==sorted(new['Mounts'],key=enc),'complete-hostconfig-mounts');a,c=copy.deepcopy(old['Config']),copy.deepcopy(new['Config']);left=a.pop('Labels')or{};right=c.pop('Labels')or{};need(a.pop('Hostname')==old['Id'][:12]and c.pop('Hostname')==new['Id'][:12],'only-automatic-config-hostname');a.pop('Image');c.pop('Image');a.pop('Env');c.pop('Env');need(a==c and B.F.envmap(new['Config']['Env'])==literal[s],'complete-runtime-config-and-literal-env');need(B.process_environment(new['Id'])==read(BACKUP/(s+'-literal-process-environment.private.json')),'complete-original-pid1-environment')
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
 need(path.startswith('/')and'..'not in path and method in{'GET','POST'},'bounded-local-public-request');req=urllib.request.Request('http://127.0.0.1'+path,method=method,data=data,headers={'Host':'8.148.146.194','Cache-Control':'no-cache','Content-Type':'application/json'});opener=urllib.request.build_opener(urllib.request.ProxyHandler({}))
 try:
  with opener.open(req,timeout=20)as r:body=r.read(16*1024**2+1);need(len(body)<=16*1024**2,'bounded-public-static-response');return r.status,body
 except urllib.error.HTTPError as error:return error.code,error.read(8192)
def original_public(s,files):
 if s.startswith('factory-review'):
  base='/'+s+'/';health=base+'api/factory-review/health';index='pb_public/index.html';assets=None
 elif s=='rr-production':base='/rr/';health='/rr/health';index='public/index.html';assets=['engineering.html','assembly.html','utils.js','style.css','vendor/xlsx.full.min.js','vendor/xlsx.LICENSE.txt','vendor/xlsx.NOTICE.txt']
 else:base='/qc/';health='/qc/api/health';index='index.html';assets=['app.js','style.css','ai-ocr.js','vendor/echarts.min.js']
 status,_=request(health);need(status==200,'public-health');status,body=request(base);need(status==200 and sha(body)==files[index]['sha256'],'public-index-exact-candidate')
 if assets is None:assets=[v.decode()[len(base):]for v in re.findall(rb'(?:src|href)="([^\"]+/assets/[^\"]+)"',body)];need(assets and all(v.startswith('assets/')and'..'not in v for v in assets),'factory-index-assets')
 for asset in assets:
  key=('pb_public/'if s.startswith('factory-review')else'public/'if s=='rr-production'else'')+asset;need(key in files,'reviewed-public-static-file');status,data=request(base+asset);need(status==200 and sha(data)==files[key]['sha256'],'public-selected-static-exact-candidate')
 if s.startswith('factory-review'):status,_=request(base+'api/factory-review/analysis-ai/config')
 elif s=='rr-production':status,_=request(base+'api/__release-anonymous-rejection','POST',b'{}')
 else:status,_=request(base+'api/sso-verify','POST',b'{}')
 need(status==401,'synthetic-anonymous-auth-rejection');return{'health':200,'indexMatchesCandidate':True,'selectedAssetCount':len(assets),'anonymousAuth':401}
RR_PATHS=('/','/engineering.html','/assembly.html','/utils.js','/style.css','/vendor/xlsx.full.min.js','/vendor/xlsx.LICENSE.txt','/vendor/xlsx.NOTICE.txt')
RR_SCHEMA='rr-fixed-static-v1'
RR_MAX_BYTES=16*1024**2

# Fixed GET paths only; no redirects, auth, app import, filesystem or DB access.
# Both the absolute request deadline and response size are bounded. Bodies are
# hashed incrementally and are never included in stdout or exception messages.
RR_NODE_STATIC=r"""'use strict';
const http = require('node:http');
const crypto = require('node:crypto');
const paths = Object.freeze(['/','/engineering.html','/assembly.html','/utils.js','/style.css','/vendor/xlsx.full.min.js','/vendor/xlsx.LICENSE.txt','/vendor/xlsx.NOTICE.txt']);
const schema = 'rr-fixed-static-v1';
const maximum = 16 * 1024 * 1024;
function fetchStatic(path) {
  return new Promise((resolve, reject) => {
    let done = false, response, timer;
    const finish = (error, row) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (error) {
        if (response) response.destroy();
        request.destroy();
        reject(new Error('fixed_static_request_failed'));
      } else resolve(row);
    };
    const request = http.get({hostname:'127.0.0.1',port:3000,path,method:'GET',agent:false,headers:{'Cache-Control':'no-cache','Connection':'close'}}, result => {
      response = result;
      let bytes = 0;
      const digest = crypto.createHash('sha256');
      result.on('data', chunk => {
        if (done) return;
        bytes += chunk.length;
        if (bytes > maximum) { finish(true); return; }
        digest.update(chunk);
      });
      result.once('aborted', () => finish(true));
      result.once('error', () => finish(true));
      result.once('end', () => {
        if (done) return;
        if (!result.complete) { finish(true); return; }
        finish(false, {path,status:result.statusCode,bytes,sha256:digest.digest('hex')});
      });
    });
    timer = setTimeout(() => finish(true), 4000);
    request.setTimeout(3000, () => finish(true));
    request.once('error', () => finish(true));
  });
}
(async () => {
  const results = [];
  for (const path of paths) results.push(await fetchStatic(path));
  process.stdout.write(JSON.stringify({schema,success:true,results}));
})().catch(() => process.stdout.write(JSON.stringify({schema,success:false,error:'fixed_static_request_failed'})));
"""

def rr_internal_static(files,cid):
 """Read eight fixed static resources through the verified running RR server."""
 need(type(cid)is str and re.fullmatch('[a-f0-9]{64}',cid)is not None,'fixed-verified-rr-container-identity')
 expected=[]
 for path in RR_PATHS:
  key='public/index.html'if path=='/'else'public'+path
  value=files.get(key)
  need(type(value)is dict and set(value)=={'bytes','sha256'}and type(value['bytes'])is int and 0<value['bytes']<=RR_MAX_BYTES and type(value['sha256'])is str and re.fullmatch('[a-f0-9]{64}',value['sha256'])is not None,'prepared-fixed-rr-static-file-proof')
  expected.append({'path':path,'status':200,'bytes':value['bytes'],'sha256':value['sha256']})
 # Docker exec inherits the configured runtime user. No passwords, auth headers,
 # mounts, capability changes or additional environment values are supplied.
 result=json.loads(run(['docker','exec',cid,'node','-e',RR_NODE_STATIC],timeout=45))
 need(type(result)is dict and set(result)=={'schema','success','results'}and result.get('schema')==RR_SCHEMA and result.get('success')is True and type(result.get('results'))is list and len(result['results'])==len(RR_PATHS),'bounded-safe-rr-static-result')
 for row in result['results']:
  need(type(row)is dict and set(row)=={'path','status','bytes','sha256'}and type(row['path'])is str and type(row['status'])is int and type(row['bytes'])is int and type(row['sha256'])is str,'typed-safe-rr-static-result')
 need(result['results']==expected,'rr-loopback-index-and-seven-assets-match-prepared-proof')
 return{'schema':RR_SCHEMA,'staticPathCount':len(RR_PATHS),'allHTTP200':True,'allBytesAndSHA256MatchPreparedProof':True,'readOnlyGET':True,'credentialsUsed':False}

def rr_public(files,cid):
 """Preserve the existing Basic Auth boundary while verifying static serving."""
 status,_=request('/rr/health');need(status==200,'rr-public-health')
 # Nginx's inherited server auth_basic protects every RR index/static/API path.
 # These unauthenticated requests must preserve that 401 boundary.
 for path in RR_PATHS:
  status,_=request('/rr/'if path=='/'else'/rr'+path)
  need(status==401,'rr-existing-public-static-basic-auth-boundary')
 status,_=request('/rr/api/__release-anonymous-rejection','POST',b'{}')
 need(status==401,'rr-existing-public-api-basic-auth-boundary')
 internal=rr_internal_static(files,cid)
 return{'health':200,'anonymousIndexAndStatic':401,'anonymousAPI':401,'basicAuthConfigurationPreserved':True,'internalStatic':internal}


def public(service,files,cid=None):
 if service=='rr-production':return rr_public(files,cid)
 return original_public(service,files)


def recover(s,old,b,before,literal,rollback,closed,closed_path,attempted,stopped,result):
 need(s in RESUME_ORDER,'recover-only-remaining-rr-or-qc')
 # Fail closed if startup or any other activity changed business data. No restore.
 maintenance('maintenance_on',s);owned_flags(b,s)
 need(not stopped or closed is not None,'no-restart-without-fresh-closed-business-evidence')
 if stopped:replay_snapshot(s,closed,closed_path)
 recovery_log_start=None
 if attempted:
  current=run([*rollback,'ps','-a','-q',s]).decode().strip();need(re.fullmatch('[a-f0-9]{12,64}',current)is not None,'one-owned-failed-candidate');operation(['docker','stop','--time','60',current],'stop-failed-'+s,80);failed,fp=B.capture(s,'failed-candidate');private(s+'-failed-raw-before-comparison.private.json',failed);replay_snapshot(s,failed,fp);recovery_log_start=json.loads(run(['docker','inspect',current]))[0]['State']['StartedAt'];same_data(s,closed,failed,closed_path,fp,recovery_log_start);operation([*rollback,'up','-d','--force-recreate','--no-build','--no-deps','--pull','never',s],'recover-only-'+s,180)
 elif stopped:operation(['docker','start',old['Id']],'restart-only-original-'+s,80)
 maintenance('wait_service_ready',s);now,raw=B.runtime();unchanged_except(before,now,s);revision=(old['Config'].get('Labels')or{}).get('org.opencontainers.image.revision');full_contract(s,old,raw[s],old['Image'],literal,rollback,revision,allow_same=True);need(proof(s,old['Image'],raw[s]['Id'],BASE)==b['sourceProof'][s]['files'],'recovered-original-all-source-files')
 if closed is not None:
  after,ap=B.capture(s,'after-recovery');private(s+'-recovery-raw-before-comparison.private.json',after);replay_snapshot(s,after,ap);same_data(s,closed,after,closed_path,ap,recovery_log_start or raw[s]['State']['StartedAt'])
 configuration(b);operation(['sleep','11'],'recovery-dns-'+s,20);maintenance('maintenance_off',s);maintenance('require_maintenance_cleared',s);cleared_flags(b);result['failedServiceRecoveredWithoutDataRestore']=True
def failed_deploy():
 r=sealed(FAILED_DEPLOY,FAILED_DEPLOY_MANIFEST,FAILED_DEPLOY_RESULT,'deploy',False)
 need(r.get('completedServices')==list(COMPLETED)and r.get('failedService')=='rr-production'and r.get('failedStage')=='public-index-exact-candidate'and r.get('failedServiceRecoveredWithoutDataRestore')is True and not r.get('failedServiceRetainsOwnMaintenance'),'exact-known-recovered-rr-public-auth-failure')
 for key in('businessWritesPerformed','databaseRestoreOrCursorResetPerformed','environmentFileModified','modelCallsPerformed','authenticatedBusinessCallsPerformed','otherServicesRequested','secretOrRowsPrinted'):need(r.get(key)is False,'original-failure-no-business-config-model-or-other-mutations')
 need(set(r.get('public',{}))==set(COMPLETED)and all(r['public'][s].get('health')==200 and r['public'][s].get('anonymousAuth')==401 and r['public'][s].get('indexMatchesCandidate')is True for s in COMPLETED),'original-two-factory-public-success')
 names=set(read(FAILED_DEPLOY/'manifest.json'));need(not any(n.startswith(('qc-closed-','qc-after-','qc-candidate-','qc-failed-'))for n in names)and'final-runtime.private.json'not in names and'closed-evidence.private.json'not in names,'original-qc-never-switched-and-no-successful-all-four-claim');return r

def original_overlay():return[*COMPOSE,'-f',str(FAILED_DEPLOY/'runtime.private.yml')]
def original_rollback_overlay():return[*COMPOSE,'-f',str(FAILED_DEPLOY/'rollback.private.yml')]

def closed_record(service,directory):
 before=read(directory/(service+'-closed-before.private.json'));after=read(directory/(service+'-after-start.private.json'));started=read(directory/(service+'-candidate-started.private.json'));audit=read(directory/(service+'-closed-comparison.private.json'));ap=directory/(service+'-closed-before');cp=directory/(service+'-after-start')
 expected={'data.db','auxiliary.db'}if service in COMPLETED else set()if service=='rr-production'else{c+'/qc.db'for c in B.QC_COMPANIES}|B.QC_HISTORICAL_SQLITE
 need(set(before['sqlite'])==set(after['sqlite'])==set(before['metadata'])==set(after['metadata'])==expected,'exact-sealed-service-database-and-main-metadata-inventory');need(type(started)is dict and set(started)=={'candidateStartedAt','containerId','image'}and stamp(before['observedUTC'])is not None and stamp(started['candidateStartedAt'])is not None and stamp(before['observedUTC'])<=stamp(started['candidateStartedAt']),'closed-before-candidate-start-binding')
 replay_snapshot(service,before,ap);replay_snapshot(service,after,cp);counts=same_data(service,before,after,ap,cp,started['candidateStartedAt']);expected_audit={'candidateStartedAt':started['candidateStartedAt'],'afterSnapshotObservedUTC':after['observedUTC'],'retentionCutoffBasis':'after_snapshot_observation','deletionActorOrExactTimesProven':False,'logCounts':counts,'businessTypedSchemaFilesAndOwnershipPreserved':True};need(audit==expected_audit,'complete-original-closed-data-audit-reproduced');return{'before':before,'after':after,'audit':audit},started

def sealed_factory_records():
 return{s:closed_record(s,FAILED_DEPLOY)for s in COMPLETED}

def private_tree_hashes(path):
 need(path.is_dir()and not path.is_symlink()and stat.S_IMODE(path.stat().st_mode)==0o700,'private-portable-evidence-root');entries=list(path.rglob('*'));need(len(entries)<=100000 and all(not p.is_symlink()and(p.is_file()or p.is_dir())and p.stat().st_mode&0o077==0 for p in entries),'only-private-regular-portable-evidence');return{str(p.relative_to(path)):B.F.OPS.L.file_hash(p)for p in entries if p.is_file()}

def carry_factory_records(records):
 # Copy already sealed archive evidence only. No live factory DB is opened.
 for service in COMPLETED:
  for suffix in('closed-before','after-start'):
   name=service+'-'+suffix;src=FAILED_DEPLOY/name;dst=OUT/name;need(src.parent==FAILED_DEPLOY and dst.parent==OUT and not dst.exists(),'new-archive-only-portable-copy');expected=private_tree_hashes(src);shutil.copytree(src,dst);need(private_tree_hashes(dst)==expected,'carried-portable-evidence-all-byte-hashes')
  for suffix in('closed-before.private.json','after-start.private.json','candidate-started.private.json','closed-comparison.private.json'):
   name=service+'-'+suffix;private(name,(FAILED_DEPLOY/name).read_bytes());need(B.F.OPS.L.file_hash(OUT/name)==B.F.OPS.L.file_hash(FAILED_DEPLOY/name),'carried-metadata-and-audit-exact-bytes')
  need(closed_record(service,OUT)==records[service],'carried-closed-evidence-identical-to-original-sealed-record')
 private('carried-factory-evidence.private.json',{'sourceArchive':str(FAILED_DEPLOY),'manifestSHA256':FAILED_DEPLOY_MANIFEST,'resultSHA256':FAILED_DEPLOY_RESULT,'services':list(COMPLETED),'liveFactoryDatabaseCapturePerformed':False})

def verify_carried_factory_records(records):
 need(read(DEPLOY/'carried-factory-evidence.private.json')=={'sourceArchive':str(FAILED_DEPLOY),'manifestSHA256':FAILED_DEPLOY_MANIFEST,'resultSHA256':FAILED_DEPLOY_RESULT,'services':list(COMPLETED),'liveFactoryDatabaseCapturePerformed':False},'carried-factory-records-exact-original-archive-binding')
 for service in COMPLETED:
  need(closed_record(service,DEPLOY)==records[service],'carried-factory-closed-records-replay-original')
  for suffix in('closed-before','after-start'):need(private_tree_hashes(DEPLOY/(service+'-'+suffix))==private_tree_hashes(FAILED_DEPLOY/(service+'-'+suffix)),'carried-factory-portable-folders-identical-original-bytes')
  for suffix in('closed-before.private.json','after-start.private.json','candidate-started.private.json','closed-comparison.private.json'):
   name=service+'-'+suffix;need(B.F.OPS.L.file_hash(DEPLOY/name)==B.F.OPS.L.file_hash(FAILED_DEPLOY/name),'carried-factory-metadata-and-audit-byte-binding')

def resume_context(b,p):
 failed_deploy();need(p['originalRuntime']==b['runtime']and envs()==read(PREPARE/'literal-environments.private.json'),'original-prepared-runtime-and-full-literal-environment-binding');configuration(b);source(b,TARGET)
 for service in ORDER:
  image=json.loads(run(['docker','image','inspect',p['images'][service]]));need(type(image)is list and len(image)==1 and image[0]['Id']==p['images'][service]and(image[0]['Config'].get('Labels')or{}).get('org.opencontainers.image.revision')==TARGET,'same-existing-prepared-immutable-image-no-rebuild')
 records=sealed_factory_records();before,raw=B.runtime();oldraw=read(BACKUP/'target-inspect.private.json');literal=envs();need(before['others']==b['runtime']['others']and before['targets']['qc']==b['runtime']['targets']['qc']and B.flags()==b['maintenanceInventory'],'original-qc-container-42-others-and-flags-identical')
 for service in COMPLETED:
  started=records[service][1];need(started=={'candidateStartedAt':raw[service]['State']['StartedAt'],'containerId':raw[service]['Id'],'image':p['images'][service]},'same-completed-factory-candidate-identity-start-image');full_contract(service,oldraw[service],raw[service],p['images'][service],literal,original_overlay(),TARGET);need(proof(service,p['images'][service],raw[service]['Id'])==p['proofs'][service],'completed-factory-current-source-and-assets')
 for service in RESUME_ORDER:
  original=oldraw[service];current=raw[service];revision=(original['Config'].get('Labels')or{}).get('org.opencontainers.image.revision');args=original_rollback_overlay()if service=='rr-production'else original_overlay();full_contract(service,original,current,original['Image'],literal,args,revision,allow_same=True);need(proof(service,original['Image'],current['Id'],BASE)==b['sourceProof'][service]['files'],'recovered-rr-and-untouched-qc-original-full-source')
 # Reproduce original RR recovery's sealed data closure without reading live data.
 rr_before=read(FAILED_DEPLOY/'rr-production-closed-before.private.json');rr_recovered=read(FAILED_DEPLOY/'rr-production-after-recovery.private.json');ap=FAILED_DEPLOY/'rr-production-closed-before';cp=FAILED_DEPLOY/'rr-production-after-recovery';replay_snapshot('rr-production',rr_before,ap);replay_snapshot('rr-production',rr_recovered,cp);same_data('rr-production',rr_before,rr_recovered,ap,cp,'unused')
 need(B.runtime()[0]==before,'partial-runtime-stable-through-readonly-preflight');private('resume-original-partial-runtime.private.json',{'runtime':before,'raw':raw});return before,raw,records

def deploy(result,b):
 p=prepared();before,raw,records=resume_context(b,p);literal=envs();args=overlay(p['images'],literal,'runtime.private.yml');rollback=overlay({s:raw[s]['Image']for s in ORDER},literal,'rollback.private.yml');carry_factory_records(records);completed=list(COMPLETED);evidence={s:records[s][0]for s in COMPLETED};result['completedServices']=completed[:];result['carriedServices']=list(COMPLETED)
 for service in RESUME_ORDER:
  global STAGE
  STAGE='resume-switch-'+service;old=raw[service];closed=None;closed_path=None;attempted=False;stopped=False
  try:
   configuration(b);need(B.runtime()[0]==before and B.flags()==b['maintenanceInventory'],'all45-other-contracts-and-own-original-before-resume-switch');maintenance('maintenance_on',service);owned_flags(b,service);operation(['sleep','60'],'drain-'+service,70);operation(['docker','stop','--time','60',old['Id']],'stop-own-old-writer-'+service,80);stopped=True;stopped_runtime(before,old,service);closed,closed_path=B.capture(service,'closed-before');private(service+'-closed-raw-before-comparison.private.json',closed);replay_snapshot(service,closed,closed_path);B.startup_guard(service,closed,closed_path);stopped_runtime(before,old,service);configuration(b);owned_flags(b,service);attempted=True;operation([*args,'up','-d','--force-recreate','--no-build','--no-deps','--pull','never',service],'recreate-only-'+service,180);maintenance('wait_service_ready',service);now,newraw=B.runtime();new=newraw[service];private(service+'-candidate-started.private.json',{'candidateStartedAt':new['State']['StartedAt'],'containerId':new['Id'],'image':new['Image']});full_contract(service,old,new,p['images'][service],literal,args,TARGET);need(proof(service,p['images'][service],new['Id'])==p['proofs'][service],'actual-resumed-service-full-source-and-assets');unchanged_except(before,now,service);post,post_path=B.capture(service,'after-start');private(service+'-poststart-raw-before-comparison.private.json',post);replay_snapshot(service,post,post_path);need(B.runtime()[0]==now,'all-runtime-stable-through-resumed-poststart-snapshot');counts=same_data(service,closed,post,closed_path,post_path,new['State']['StartedAt']);audit={'candidateStartedAt':new['State']['StartedAt'],'afterSnapshotObservedUTC':post['observedUTC'],'retentionCutoffBasis':'after_snapshot_observation','deletionActorOrExactTimesProven':False,'logCounts':counts,'businessTypedSchemaFilesAndOwnershipPreserved':True};private(service+'-closed-comparison.private.json',audit);evidence[service]={'before':closed,'after':post,'audit':audit};configuration(b);owned_flags(b,service);operation(['sleep','11'],'dns-grace-'+service,20);maintenance('maintenance_off',service);maintenance('require_maintenance_cleared',service);cleared_flags(b);result.setdefault('public',{})[service]=public(service,p['proofs'][service],new['Id']);need(B.runtime()[0]==now,'all45-contracts-stable-after-own-public-and-loopback-smoke');before=now;completed.append(service);result['completedServices']=completed[:]
  except BaseException:
   result['failedService']=service
   try:recover(service,old,b,before,literal,rollback,closed,closed_path,attempted,stopped,result)
   except BaseException:result['failedServiceRetainsOwnMaintenance']=True;private(service+'-recovery-failure.private.txt',traceback.format_exc().encode())
   raise
 need(completed==list(ORDER),'original-two-plus-resumed-two-complete');configuration(b);cleared_flags(b);failed_deploy();private('closed-evidence.private.json',evidence);private('final-runtime.private.json',before);result.update(success=True,images=p['images'],resumedServices=list(RESUME_ORDER),completedFactoryContainersNotRecreated=True,carriedClosedEvidenceFromFailedDeploy=True,allOther42ContainersUnchanged=True,allBusinessTypedRowsSchemaFilesAndModeOwnersPreserved=True,environmentFileUnchanged=True,allMaintenanceFlagsRestored=True,buildsPerformed=False)

def verify(result,b):
 p=prepared();failed_deploy();receipt=sealed(DEPLOY,DEPLOY_MANIFEST,DEPLOY_RESULT,'deploy');need(receipt.get('completedServices')==list(ORDER)and receipt.get('carriedServices')==list(COMPLETED)and receipt.get('resumedServices')==list(RESUME_ORDER)and receipt.get('completedFactoryContainersNotRecreated')is True and receipt.get('buildsPerformed')is False,'successful-exact-two-service-resume');source(b,TARGET);configuration(b);need(p['originalRuntime']==b['runtime']and envs()==read(PREPARE/'literal-environments.private.json'),'same-original-prepared-source-and-literal-env');current,raw=B.runtime();need(current==read(DEPLOY/'final-runtime.private.json')and current['others']==b['runtime']['others'],'all-four-sealed-final-runtime-and-original42-identical');cleared_flags(b);records=sealed_factory_records();verify_carried_factory_records(records);evidence=read(DEPLOY/'closed-evidence.private.json');need(set(evidence)==set(ORDER),'all-four-complete-sealed-startup-evidence');literal=envs();oldraw=read(BACKUP/'target-inspect.private.json')
 for service in ORDER:
  record,started=closed_record(service,DEPLOY);need(record==evidence[service]and started=={'candidateStartedAt':raw[service]['State']['StartedAt'],'containerId':raw[service]['Id'],'image':p['images'][service]},'complete-sealed-data-record-and-exact-current-candidate-binding')
  if service in COMPLETED:need((record,started)==records[service],'original-completed-factory-evidence-retained-exactly')
  args=original_overlay()if service in COMPLETED else[*COMPOSE,'-f',str(DEPLOY/'runtime.private.yml')];full_contract(service,oldraw[service],raw[service],p['images'][service],literal,args,TARGET);need(proof(service,p['images'][service],raw[service]['Id'])==p['proofs'][service],'all-four-actual-runtime-source-and-assets');result.setdefault('public',{})[service]=public(service,p['proofs'][service],raw[service]['Id'])
 configuration(b);need(B.runtime()[0]==current,'all-runtime-stable-through-resume-verify');cleared_flags(b);failed_deploy();private('verified-runtime.private.json',current);result.update(success=True,images=p['images'],completedFactoryContainersNotRecreated=True,carriedClosedEvidenceFromFailedDeploy=True,allFourPreparedSourcesAndRuntimeContractsVerified=True,allFourSealedClosedDataChecksReproduced=True,allOther42ContainersUnchanged=True,environmentFileUnchanged=True,allMaintenanceFlagsRestored=True,freshLiveBusinessComparisonPerformed=False,buildsPerformed=False)

def main():
 global OUT
 need(PHASE in{'prepare','deploy','verify'}and sys.argv[1:]==[PHASE]and os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_ATTEMPT')=='1'and pin(TARGET,40)and pin(TREE,40)and pin(SOURCE_MANIFEST_SHA),'blank-draft-or-wrong-phase-branch-attempt-target');os.umask(0o077);OUT={'prepare':PREPARE,'deploy':DEPLOY,'verify':VERIFY}[PHASE];OUT.mkdir(mode=0o700);initialize();signal.signal(signal.SIGTERM,lambda *_:need(False,'terminated'));result={'mode':PHASE,'base':BASE,'target':TARGET,'tree':TREE,'success':False,'businessWritesPerformed':False,'databaseRestoreOrCursorResetPerformed':False,'environmentFileModified':False,'modelCallsPerformed':False,'authenticatedBusinessCallsPerformed':False,'otherServicesRequested':False,'secretOrRowsPrinted':False}
 try:
  b=baseline();{'prepare':prepare,'deploy':deploy,'verify':verify}[PHASE](result,b);baseline();failed_deploy()
 except BaseException as error:result.update(success=False,failedStage=STAGE,backupLibraryFailedStage=B.STAGE,safeExceptionType=type(error).__name__);private('failure.private.txt',traceback.format_exc().encode())
 finally:private('first-result.json',result);B.F.OPS.L.seal(OUT);print(enc(dict(result,manifestSHA256=B.F.OPS.L.file_hash(OUT/'manifest.json'),resultSHA256=B.F.OPS.L.file_hash(OUT/'first-result.json'))).decode(),flush=True)
 return 0 if result['success']else 1
if __name__=='__main__':
 try:sys.exit(main())
 except SystemExit:raise
 except BaseException:print('{"mode":"rejected","success":false,"safeFailure":"BATCH_983_984_987_RELEASE_PREFLIGHT_REJECTED"}',flush=True);sys.exit(1)
