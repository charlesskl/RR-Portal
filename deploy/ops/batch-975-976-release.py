"""Scoped PR975/976 release. False gates; prepare candidates, switch only four targets.
Factory frontend changes only. QC reuses each existing image and changes three numeric
environment fields. No mailbox operation, global deployment or automatic data restore.
"""
import contextlib,copy,datetime,hashlib,html.parser,importlib.util,json,os,pathlib,re,signal,sqlite3,stat,subprocess,sys,tarfile,time,traceback,urllib.error,urllib.request,io
ROOT=pathlib.Path('/opt/rr-portal');BASE='dfcdf751cae42fdd1731729dd662fce041c28caf';TARGET='';TREE=''
BRANCH='refs/heads/ops/batch-975-976-20261021';PREPARE_PIN=False;DEPLOY_PIN=False;VERIFY_PIN=False
CORE_SHA='01776d2c2be81fc67cfa2cc10fb12608958b6e29d38d2e783cb58bc55dfbf3f3';HOST_SHA='bd1842dc6847f3e0e5c0c38374c3604791f66d1c94dc651457607dc338f38ff1'
SOURCE_MANIFEST_SHA='';BACKUP_MANIFEST='';BACKUP_RESULT='';PREPARE_MANIFEST='';PREPARE_RESULT='';DEPLOY_MANIFEST='';DEPLOY_RESULT=''
BACKUP=ROOT/'deploy/backups/batch-975-976-20261021-backup-02';PREPARE=BACKUP.with_name('batch-975-976-20261021-prepare');DEPLOY=BACKUP.with_name('batch-975-976-20261021-deploy');VERIFY=BACKUP.with_name('batch-975-976-20261021-verify')
FACTORY='apps/PMC跟仓管/加工厂月度评审管理制度';QC='apps/QA部/QC成品报告系统';FACTORY_SERVICES=('factory-review-test','factory-review');QC_SERVICES=('qc-report','qc-report-worker');ORDER=FACTORY_SERVICES+QC_SERVICES
NUMERIC={'OPENAI_TIMEOUT_SECONDS':'900','OPENAI_MAX_OUTPUT_TOKENS':'64000','RQ_JOB_TIMEOUT_SECONDS':'1200'};SERVER_KEYS={'QC_REPORT_'+name:name for name in NUMERIC};QC_CONTRACT_FILES=('task_queue.py','ai_service.py','worker.py')
STAGE='entry';FAILED_CHECK=None;CORE=None;HOST=None;OUT=None;ENV=None;DRAIN=None;SERIAL=0
COMPOSE=['docker','compose','-p','rr-portal','-f',str(ROOT/'docker-compose.cloud.yml'),'--env-file',str(ROOT/'.env.cloud.production')]
def need(value,label):
 global FAILED_CHECK
 if not value:FAILED_CHECK=label if type(label)is str and bool(re.fullmatch('[a-z0-9-]{1,100}',label))else 'invalid-failure-label';raise RuntimeError('BATCH_975_976_SCOPED_RELEASE_REJECTED')
def enc(value):return json.dumps(value,sort_keys=True,ensure_ascii=True,separators=(',',':'),allow_nan=False).encode()
def sha(value):return hashlib.sha256(value).hexdigest()
def pin(value,n=64):return type(value)is str and bool(re.fullmatch('[a-f0-9]{%d}'%n,value))
def private(name,value):CORE.private(name,value)
def read(path):return json.loads(path.read_bytes())
def load(name,digest):
 p=pathlib.Path(__file__).with_name(name);need(p.is_file()and not p.is_symlink()and sha(p.read_bytes())==digest,'fixed-dependency-bytes');s=importlib.util.spec_from_file_location(name.replace('.','_'),p);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
def archive(path,manifest_sha,result_sha):
 need(pin(manifest_sha)and pin(result_sha)and path.is_dir()and not path.is_symlink()and stat.S_IMODE(path.stat().st_mode)==0o700,'sealed-private-archive-root');need(CORE.OPS.L.file_hash(path/'manifest.json')==manifest_sha and CORE.OPS.L.file_hash(path/'first-result.json')==result_sha,'sealed-archive-receipt-pins');manifest=read(path/'manifest.json');entries=list(path.rglob('*'));need(len(entries)<=100000 and all(not p.is_symlink()and(p.is_dir()or p.is_file())and p.stat().st_mode&0o077==0 for p in entries),'private-archive-entry-types');need(set(manifest)=={str(p.relative_to(path))for p in entries if p.is_file()and p!=path/'manifest.json'}and all(CORE.OPS.L.safe_path(n)and pin(h)and CORE.OPS.L.file_hash(path/n)==h for n,h in manifest.items()),'sealed-complete-archive');receipt=read(path/'first-result.json');need(receipt.get('success')is True,'sealed-archive-success');return receipt
def baseline():
 receipt=archive(BACKUP,BACKUP_MANIFEST,BACKUP_RESULT);need(receipt.get('base')==BASE and receipt.get('backupComplete')is True and receipt.get('portableSQLiteCount')==5,'five-database-baseline');value=read(BACKUP/'baseline.private.json');need(value['head']==BASE and set(value['runtime']['targets'])==set(ORDER),'fixed-baseline-targets');return value
def files():
 p=pathlib.Path(__file__).with_name('batch-975-976-reviewed-files.json');need(p.is_file()and not p.is_symlink()and sha(p.read_bytes())==SOURCE_MANIFEST_SHA,'reviewed-source-manifest-pin');value=read(p);need(type(value)is dict and 0<len(value)<=30 and all(CORE.OPS.L.safe_path(n)and pin(h)and(n=='docker-compose.cloud.yml'or n.startswith(FACTORY+'/src/')or n.startswith(FACTORY+'/tests/')or n==QC+'/tests/test_ai_service.py')for n,h in value.items()),'reviewed-source-scope');return value
def run(args,timeout=180,data=None):return CORE.run(args,data=data,timeout=timeout)
def operation(args,label,timeout=180,checkout=False):
 global SERIAL
 SERIAL+=1
 with(OUT/('%04d-%s.private.log'%(SERIAL,label))).open('xb')as log:p=subprocess.run(args,stdout=log,stderr=subprocess.STDOUT,timeout=timeout,cwd=ROOT,env=ENV,umask=0o022 if checkout else -1)
 need(p.returncode==0,'successful-operation')
def current(label,stopped=()):
 global SERIAL
 SERIAL+=1;prefix='%04d-%s'%(SERIAL,label);need(set(stopped)<=set(ORDER),'fixed-expected-stopped-services');ids=run(['docker','ps','-aq','--no-trunc']).decode().split();need(0<len(ids)<=1000 and len(ids)==len(set(ids))and all(pin(cid,64)for cid in ids),'bounded-container-inventory');records=json.loads(run(['docker','inspect',*ids]));private(prefix+'-all-raw-inspects.private.json',records);need(type(records)is list and len(records)==len(ids),'complete-raw-inventory');rows={};targets={};raw={}
 for record in records:
  cid=record['Id'];need(cid in ids and cid not in rows,'unique-runtime-container');config=copy.deepcopy(record['Config']);config['Env']=sorted(config['Env']);state=record['State'];rows[cid]={'id':cid,'image':record['Image'],'started':state.get('StartedAt'),'running':state['Running'],'oom':state['OOMKilled'],'restarts':record['RestartCount'],'health':state.get('Health',{}).get('Status'),'configSHA256':sha(enc(config)),'hostConfigSHA256':sha(enc(record['HostConfig'])),'networkSettingsSHA256':sha(enc(record.get('NetworkSettings',{}))),'mounts':sorted(record.get('Mounts',[]),key=enc)};labels=config.get('Labels')or{};service=labels.get('com.docker.compose.service')if labels.get('com.docker.compose.project')=='rr-portal'else None
  if service in ORDER:need(service not in targets,'one-container-per-target');targets[service]=cid;raw[service]=record
 private(prefix+'-runtime-before-assertions.private.json',{'all':rows,'targets':targets});need(set(targets)==set(ORDER),'all-four-targets-present')
 for service,cid in targets.items():need(rows[cid]['oom']is False and(rows[cid]['running']is False if service in stopped else rows[cid]['running']is True and rows[cid]['health']=='healthy'),'only-explicitly-stopped-targets-unhealthy')
 return {'all':rows,'targets':targets},raw
def flags(alias=None):
 need(alias is None or alias in {'factory-review','factory-review-test','qc-report'},'maintenance-alias-scope');value=CORE.OPS.L.non_database_inventory(ROOT/'deploy/maintenance',[]);return [r for r in value if alias is None or r['path']!='services/'+alias]
def maintenance(fn,service):
 need(service in ORDER and fn in {'maintenance_on','maintenance_off','wait_service_ready','require_maintenance_cleared'},'service-maintenance-command');operation(['bash','-c','set -euo pipefail; source "$1"; "$2" "$3"','scoped-release',str(ROOT/'deploy/service-maintenance.sh'),fn,service],fn+'-'+service,340)
def env_metadata(path):
 v=CORE.Q.stable_file_metadata(path);return{k:v[k]for k in ('mode','uid','gid')}
def checked_source(revision,before,manifest,env_bytes):
 need(run(['git','symbolic-ref','--quiet','HEAD']).decode().strip()=='refs/heads/main'and run(['git','rev-parse','HEAD']).decode().strip()==revision,'canonical-server-main-source');need(run(['git','rev-parse',TARGET+'^{tree}']).decode().strip()==TREE,'reviewed-target-tree');changed=run(['git','diff','--name-only','-z','--no-ext-diff','--no-textconv',BASE,TARGET]).decode().rstrip('\0').split('\0');need(set(changed)==set(manifest),'only-reviewed-committed-paths')
 for path,digest in manifest.items():need(sha(run(['git','show',TARGET+':'+path]))==digest,'reviewed-target-file-bytes')
 for prefix in (FACTORY,QC):run(['git','diff','--quiet','--no-ext-diff','--no-textconv','--ignore-submodules=none','--',prefix])
 for path in CORE.FIXED:
  need((ROOT/path).is_file()and not(ROOT/path).is_symlink()and (ROOT/path).read_bytes()==run(['git','show',revision+':'+path]),'tracked-runtime-configuration-byte-match')
 CORE.F.BASE=revision;need(CORE.F.dirty_snapshot()==before['preexistingFourDirty'],'four-preexisting-changes-preserved');need(not set(manifest)&set(before['preexistingFourDirty']),'reviewed-changes-disjoint-preexisting-dirty');need(CORE.Q.stable_environment_bytes(ROOT/'.env.cloud.production')==env_bytes and env_metadata(ROOT/'.env.cloud.production')=={k:before['environmentFileMetadata'][k]for k in ('mode','uid','gid')},'literal-env-bytes-owner-mode-expected')
 if revision==TARGET:
  for path,digest in manifest.items():
   file=ROOT/path;entry=run(['git','ls-tree','-z',TARGET,'--',path]).split(b'\t',1);need(len(entry)==2 and entry[1]==path.encode()+b'\0'and re.fullmatch(b'100(?:644|755) blob [a-f0-9]{40}',entry[0]),'canonical-git-regular-file');mode=0o755 if entry[0].startswith(b'100755')else 0o644;need(not file.is_symlink()and stat.S_IMODE(file.stat().st_mode)==mode and CORE.OPS.L.file_hash(file)==digest,'canonical-source-bytes-and-mode')
def qc_contract(before):
 explicit=CORE.explicit_numeric_environment((BACKUP/'environment.private').read_bytes());need(all(not value['present']and value['occurrences']==0 for value in explicit.values()),'actual-three-server-numeric-overrides-absent')
 for service in QC_SERVICES:
  proof=before['sourceProof'][service];need(proof['reviewedSourceMatch']is True,'qc-own-source-proven')
  for name in QC_CONTRACT_FILES:need(proof['sourceFileSHA256'][name]==sha(run(['git','show',BASE+':'+QC+'/'+name])),'old-worker-and-web-support-reviewed-queue-contract')
 for part in ('pb_hooks','pb_migrations'):
  need(run(['git','rev-parse',BASE+':'+FACTORY+'/'+part])==run(['git','rev-parse',TARGET+':'+FACTORY+'/'+part]),'factory-hooks-migrations-unchanged')
 need(run(['git','rev-parse',BASE+':'+QC])==run(['git','rev-parse',TARGET+':'+QC])or run(['git','diff','--name-only','-z',BASE,TARGET,'--',QC]).decode().rstrip('\0').split('\0')==[QC+'/tests/test_ai_service.py'],'qc-runtime-source-remains-unchanged')
def startup_guard(service,raw):
 if service in FACTORY_SERVICES:
  env=CORE.envmap(raw['Config']['Env']);email=env.get('FACTORY_REVIEW_ADMIN_EMAIL','').strip();need(bool(email)and len(env.get('FACTORY_REVIEW_ADMIN_PASSWORD',''))>=12,'factory-bootstrap-credential-contract')
  with contextlib.closing(CORE.OPS.L.connect(ROOT/CORE.STORAGE[service]/'data.db'))as db:need(db.execute('SELECT count(*) FROM users WHERE email=?',(email,)).fetchone()==(1,),'factory-existing-bootstrap-user-no-new-user-created')
  return
 need(service in QC_SERVICES,'startup-guard-service');checks={}
 with contextlib.closing(CORE.OPS.L.connect(ROOT/QC/'data/qc-report.db'))as db:
  tables={row[0]for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
  for table in('users','customers','products','purchase_orders','aql_rules','test_templates','photo_checklist_templates','defect_categories','settings','alembic_version'):checks[table+'-exists']=table in tables
  for table in('users','aql_rules','test_templates','photo_checklist_templates','defect_categories'):checks[table+'-nonempty']=table in tables and db.execute('SELECT EXISTS(SELECT 1 FROM "'+table+'")').fetchone()[0]==1
  for table,column,value in(('customers','name','Zanzoon'),('products','item_no','5226155'),('purchase_orders','po_no','PO-26032401')):checks[table+'-existing-seed-row']=table in tables and db.execute('SELECT EXISTS(SELECT 1 FROM "'+table+'" WHERE "'+column+'"=?)',(value,)).fetchone()[0]==1
  for key in('ai_workflow_defaults_v1','ai_workflow_defaults_v2','company_name','report_title','required_photo_categories','logo_path'):checks['setting-'+key]='settings'in tables and db.execute('SELECT EXISTS(SELECT 1 FROM settings WHERE key=?)',(key,)).fetchone()[0]==1
  checks['single-known-migration-head']='alembic_version'in tables and db.execute('SELECT version_num FROM alembic_version').fetchall()==[('b7c4f1a2d9e0',)]
 private(service+'-fresh-startup-guard.private.json',checks);need(all(checks.values()),'qc-startup-will-not-seed-or-migrate-existing-database')
def compose_base(before,env_updated):
 need(run(['docker','compose','version','--short']).decode().strip()=='5.1.0','reviewed-compose-version');value=json.loads(run([*COMPOSE,'config','--format','json']));expected=read(BACKUP/'compose-render.private.json');explicit=CORE.explicit_numeric_environment((BACKUP/'environment.private').read_bytes())
 for service in QC_SERVICES:
  for server,key in SERVER_KEYS.items():
   old=explicit[server];need(old['occurrences']in(0,1)and(not old['present']or old['validPositiveInteger']is True),'safe-existing-server-numeric-config');expected['services'][service]['environment'][key]=NUMERIC[key]if env_updated or not old['present']else old['value']
 if 'x-qc-report-environment'in expected:
  need(type(expected['x-qc-report-environment'])is dict,'existing-qc-environment-anchor-block');expected['x-qc-report-environment'].update(NUMERIC)
 need(value==expected,'only-qc-three-compose-environment-values-changed');return value
def desired_environments():
 result={service:read(BACKUP/(service+'-literal-configured-environment.private.json'))for service in ORDER}
 for service in QC_SERVICES:result[service].update(NUMERIC)
 return result
def overlay(base,images,path):
 desired=desired_environments();expected=copy.deepcopy(base);lines=['services:']
 for service in ORDER:
  image=images[service];need(bool(re.fullmatch('sha256:[a-f0-9]{64}',image))or image=='rr-portal-'+service+'-975-976:'+TARGET,'fixed-candidate-image-name');serialized={k:v.replace('$','$$')for k,v in desired[service].items()};lines.extend(['  '+service+':','    environment: !override '+json.dumps(serialized,ensure_ascii=True,separators=(',',':')),'    image: '+image,'    pull_policy: never']);expected['services'][service].update(environment=serialized,image=image,pull_policy='never')
  if service in FACTORY_SERVICES:lines.extend(['    build:','      args:','        OCI_REVISION: '+TARGET]);expected['services'][service]['build']['args']['OCI_REVISION']=TARGET
 private(path.name,('\n'.join(lines)+'\n').encode());args=[*COMPOSE,'-f',str(path)];need(json.loads(run([*args,'config','--format','json']))==expected,'exact-overlay-with-literal-actual-env');return args
def candidate_files(service,image):
 blob=run(['docker','run','--rm','--network','none','--read-only','--log-driver','none','--entrypoint','tar',image,'-C','/pb','-cf','-','pb_hooks','pb_migrations','pb_public']);result={};seen=set();total=0
 with tarfile.open(fileobj=io.BytesIO(blob),mode='r:')as archive_file:
  for member in archive_file:
   name=member.name.rstrip('/');need(CORE.OPS.L.safe_path(name)and name.split('/')[0]in {'pb_hooks','pb_migrations','pb_public'}and name not in seen and(member.isdir()or member.isfile()),'safe-candidate-tar-entry');seen.add(name)
   if member.isdir():continue
   need(member.size<=16*1024**2,'bounded-candidate-single-file');total+=member.size;need(total<=32*1024**2,'bounded-candidate-assets');content=archive_file.extractfile(member).read();need(len(content)==member.size,'complete-candidate-file');result[name]={'bytes':member.size,'sha256':sha(content)}
 names=run(['git','ls-tree','-r','--name-only','-z',TARGET,'--',FACTORY+'/pb_hooks',FACTORY+'/pb_migrations']).decode().rstrip('\0').split('\0');expected={n[len(FACTORY)+1:]:sha(run(['git','show',TARGET+':'+n]))for n in names};need({n:r['sha256']for n,r in result.items()if not n.startswith('pb_public/')}==expected and 'pb_public/index.html'in result and any(n.startswith('pb_public/assets/')for n in result),'candidate-hooks-migrations-and-compiled-assets');return result
def candidate_contract(service,image,oldraw,base):
 old=read(BACKUP/(service+'-configured-image.private.json'));need(image['Architecture']==old['Architecture']=='amd64'and image['Os']==old['Os']=='linux'and image['Config'].get('Healthcheck')==old['Config'].get('Healthcheck'),'candidate-image-os-architecture-healthcheck');desired=desired_environments()[service];defaults=CORE.envmap(image['Config'].get('Env')or[]);need(dict(defaults,**desired)==desired,'candidate-image-defaults-preserved-by-literal-runtime-map')
 for key,override in [('Cmd','command'),('Entrypoint','entrypoint'),('User','user'),('WorkingDir','working_dir')]:
  actual=base['services'][service].get(override)
  if actual is None:actual=image['Config'].get(key)
  need(actual==oldraw['Config'].get(key)or key=='User'and actual in(None,'')and oldraw['Config'].get(key)in(None,''),'candidate-full-process-contract')
def prepared(before):
 receipt=archive(PREPARE,PREPARE_MANIFEST,PREPARE_RESULT);need(receipt.get('target')==TARGET and receipt.get('allCandidatesSealedBeforeMaintenance')is True,'complete-prepared-receipt');value=read(PREPARE/'prepared.private.json');need(value['runtimeBefore']==before['runtime']and set(value['images'])==set(ORDER),'prepared-original-runtime-and-images');return value
def prepare(result,before,manifest):
 global STAGE
 original_env=(BACKUP/'environment.private').read_bytes();STAGE='original-runtime-before-readonly-fetch';runtime,raw=current('before-prepare');need(runtime==before['runtime']and flags()==before['maintenanceInventory'],'unchanged-original-runtime-and-flags')
 STAGE='fetch-exact-reviewed-main-before-target-objects';run(['git','-c','core.hooksPath=/dev/null','fetch','--no-write-fetch-head','origin','main:refs/rr-portal-975-976-main']);need(run(['git','rev-parse','refs/rr-portal-975-976-main']).decode().strip()==TARGET,'remote-main-exact-reviewed-target');qc_contract(before);checked_source(BASE,before,manifest,original_env);run(['git','merge-base','--is-ancestor',BASE,TARGET]);STAGE='fast-forward-reviewed-main';operation(['git','-c','core.hooksPath=/dev/null','-c','merge.autoStash=false','merge','--ff-only','--no-autostash',TARGET],'fast-forward-canonical-source',180,True);checked_source(TARGET,before,manifest,original_env);base=compose_base(before,False)
 images={s:raw[s]['Image']for s in ORDER};images.update({s:'rr-portal-'+s+'-975-976:'+TARGET for s in FACTORY_SERVICES});args=overlay(base,images,OUT/'build-images-and-literal-env.private.yml');candidates={}
 for service in FACTORY_SERVICES:
  STAGE=service+'-build-before-any-maintenance';need(current('before-build')[0]==runtime and flags()==before['maintenanceInventory'],'old-runtime-and-flags-during-build');operation([*args,'build',service],'build-'+service,1500);image=json.loads(run(['docker','image','inspect',images[service]]));need(len(image)==1 and pin(image[0]['Id'].removeprefix('sha256:'))and(image[0]['Config'].get('Labels')or{}).get('org.opencontainers.image.revision')==TARGET,'reviewed-factory-image-revision');candidate_contract(service,image[0],raw[service],base);images[service]=image[0]['Id'];candidates[service]=candidate_files(service,images[service]);private(service+'-candidate-image.private.json',image[0]);private(service+'-candidate-files.private.json',candidates[service]);need(current('after-build')[0]==runtime and flags()==before['maintenanceInventory'],'build-did-not-switch-containers')
 for service in QC_SERVICES:
  image=json.loads(run(['docker','image','inspect',images[service]]));need(len(image)==1 and image[0]['Id']==raw[service]['Image'],'qc-original-image-available');candidate_contract(service,image[0],raw[service],base)
 private('desired-environment.private',original_env);private('prepared.private.json',{'images':images,'factoryCandidateFiles':candidates,'runtimeBefore':runtime,'qcImagesRetained':{s:images[s]for s in QC_SERVICES},'environmentBeforeSHA256':sha(original_env),'environmentDesiredSHA256':sha((OUT/'desired-environment.private').read_bytes())});checked_source(TARGET,before,manifest,original_env);result.update(success=True,allCandidatesSealedBeforeMaintenance=True,onlyFactoryTwoImagesBuilt=True,qcOriginalImmutableImagesRetained=True,allContainersAndMaintenanceUnchanged=True,environmentFileModified=False,candidateImages=images)

def config_preserved(service,old,new,args,expected_env):
 need(HOST.same_host_config(old['HostConfig'],new['HostConfig'])and sorted(old['Mounts'],key=enc)==sorted(new['Mounts'],key=enc),'hostconfig-and-mounts-preserved');a=copy.deepcopy(old['Config']);b=copy.deepcopy(new['Config']);oldlabels=a.pop('Labels')or{};labels=b.pop('Labels')or{};need(a.pop('Hostname')==old['Id'][:12]and b.pop('Hostname')==new['Id'][:12],'automatic-container-hostnames');a.pop('Image');need(b.pop('Image')==new['Image'],'fixed-runtime-image-id');a['Env']=sorted(k+'='+v for k,v in expected_env.items());b['Env']=sorted(b['Env']);need(a==b,'full-target-config-with-only-reviewed-env-delta');expected=copy.deepcopy(oldlabels);expected['com.docker.compose.image']=new['Image'];expected['com.docker.compose.project.config_files']=','.join([str(ROOT/'docker-compose.cloud.yml'),str(DEPLOY/'runtime-images-and-literal-env.private.yml')]);hashes=run([*args,'config','--hash',service]).decode().split();need(len(hashes)==2 and pin(hashes[1]),'compose-target-config-hash');expected['com.docker.compose.config-hash']=hashes[1]
 if service in FACTORY_SERVICES:expected['org.opencontainers.image.revision']=TARGET
 need(labels==expected,'complete-target-labels-only-expected-delta');blob=run(['docker','exec',new['Id'],'cat','/proc/1/environ']);need(blob.endswith(b'\0'),'complete-post-create-pid1-environment');process=CORE.envmap([v.decode()for v in blob.split(b'\0')if v]);need(process.pop('HOSTNAME',None)==new['Id'][:12],'post-create-automatic-hostname');original_process=read(BACKUP/(service+'-literal-process-environment.private.json'))
 if service in QC_SERVICES:original_process.update(NUMERIC)
 need(process==original_process,'pid1-env-only-reviewed-numeric-delta')
def unchanged_others(expected,actual,changed):
 old=expected['all'];new=actual['all'];removed={expected['targets'][s]for s in changed};added={actual['targets'][s]for s in changed};need({k:v for k,v in old.items()if k not in removed}=={k:v for k,v in new.items()if k not in added},'all-unrelated-containers-identical');need(set(actual['targets'])==set(expected['targets']),'same-four-service-targets')
def queue_state(raw,label):
 global SERIAL
 SERIAL+=1;label='%04d-%s'%(SERIAL,label);queue=CORE.queue_observation(raw,label);database=CORE.active_database_rows(ROOT/QC/'data/qc-report.db',label);return queue,database
def queue_quiet(queue,database):return queue['queued']==0 and queue['busyWorkers']==0 and all(queue['registryCounts'][name]==0 for name in ('StartedJobRegistry','ScheduledJobRegistry','DeferredJobRegistry'))and all(value==0 for counts in database.values()for value in counts.values())
def capture_storage(name,keys):
 folder=OUT/name;folder.mkdir(mode=0o700);result={}
 for key in keys:
  root=ROOT/CORE.STORAGE[key];result[key]=CORE.OPS.sqlite_capture(key,root,folder/key);result[key]['databaseFileMetadata']={n:CORE.metadata(root/n)for n in result[key]['sqlite']}
 CORE.OPS.L.private_write(folder/'observed.private.json',enc(result));CORE.OPS.L.seal(folder);return result
def public_get(path):
 need(path.startswith('/')and not path.startswith('//'),'same-origin-public-path')
 try:
  with urllib.request.urlopen(urllib.request.Request('http://127.0.0.1'+path,headers={'Cache-Control':'no-cache'}),timeout=15)as response:body=response.read(16*1024**2+1);need(len(body)<=16*1024**2,'bounded-public-body');return response.status,body
 except urllib.error.HTTPError as error:return error.code,b''
def public_factory(service,inventory):
 base='/'+service+'/';status,body=public_get(base);need(status==200 and sha(body)==inventory['pb_public/index.html']['sha256'],'factory-public-index-exact-candidate')
 for name,row in inventory.items():
  if name.startswith('pb_public/assets/'):
   status,body=public_get(base+name[len('pb_public/'):]);need(status==200 and len(body)==row['bytes']and sha(body)==row['sha256'],'factory-all-public-assets-exact-candidate')
 return {'healthHTTPStatus':public_get(base+'api/factory-review/health')[0],'indexAndAllCompiledAssetBytesMatchCandidate':True}
def factory_runtime_proof(service,raw,label):
 global SERIAL
 SERIAL+=1;directory=OUT/('%04d-%s'%(SERIAL,label));directory.mkdir(mode=0o700);old=CORE.F.OUT;CORE.F.OUT=directory;CORE.F.BASE=TARGET
 try:return CORE.F.runtime_files(service,{'id':raw['Id'],'image':raw['Image']})
 finally:CORE.F.OUT=old
def immediate_raw_after_create(label):
 global SERIAL
 SERIAL+=1;ids=run(['docker','ps','-aq','--no-trunc']).decode().split();need(0<len(ids)<=1000 and all(pin(cid,64)for cid in ids),'bounded-post-create-inventory');private('%04d-%s-all-raw-before-health.private.json'%(SERIAL,label),json.loads(run(['docker','inspect',*ids])))
def final_proofs(before,value,runtime,raw,args):
 desired=desired_environments();proof={};public={}
 for service in ORDER:
  old=read(BACKUP/'before-all-raw-inspects.private.json');old=next(row for row in old if row['Id']==before['runtime']['targets'][service]);config_preserved(service,old,raw[service],args,desired[service]);need(raw[service]['Image']==value['images'][service],'deployed-exact-prepared-image')
  if service in FACTORY_SERVICES:
   proof[service]=factory_runtime_proof(service,raw[service],'final-source-'+service);need(proof[service]['files']==value['factoryCandidateFiles'][service],'running-factory-candidate-files');public[service]=public_factory(service,proof[service]['files']);need(public[service]['healthHTTPStatus']==200,'factory-public-health-200')
  else:
   revision=before['sourceProof'][service]['provenSourceRevision'];proof[service]=CORE.Q.service_source_proof('qc-report',{'id':raw[service]['Id']},revision=revision);need(proof[service]['reviewedSourceMatch']is True and proof[service]['sourceFileSHA256']==before['sourceProof'][service]['sourceFileSHA256'],'qc-existing-source-image-preserved')
 status,body=public_get('/qc-report/health');need(status==200 and type(json.loads(body))is dict,'qc-public-health-200');public['qc-report']={'healthHTTPStatus':status};return proof,public
def stop_and_snapshot(services,expected,keys,alias):
 global DRAIN
 DRAIN={'services':services,'originalIds':{s:expected['targets'][s]for s in services},'expected':copy.deepcopy(expected),'candidateAttempted':False,'alias':alias};prior_flags=flags(alias);maintenance('maintenance_on',services[0]);need(flags(alias)==prior_flags,'only-own-maintenance-added')
 for service in services:
  if service=='qc-report-worker':
   records=json.loads(run(['docker','inspect',expected['targets'][service]]));need(len(records)==1,'one-original-worker-before-stop');queue,database=queue_state({'qc-report-worker':records[0]},'web-stopped-before-worker-stop');need(queue_quiet(queue,database),'web-fully-stopped-then-worker-and-queue-confirmed-empty');DRAIN['qcQueueAfterWebStopped']=queue;DRAIN['qcActiveDatabaseJobsAfterWebStopped']=database
  grace=1300 if service=='qc-report-worker'else 30;operation(['docker','stop','--time',str(grace),expected['targets'][service]],'stop-'+service,grace+20)
 after,raw=current('after-graceful-stop',stopped=services);unchanged_others(expected,after,services)
 for service in services:
  row=after['all'][raw[service]['Id']];old=expected['all'][expected['targets'][service]];need(raw[service]['Id']==expected['targets'][service]and raw[service]['State']['Running']is False and raw[service]['State']['OOMKilled']is False and all(row[key]==old[key]for key in ('id','image','started','oom','restarts','configSHA256','hostConfigSHA256','mounts')),'only-original-targets-stopped-with-full-config-intact')
 need(flags(alias)==prior_flags,'only-current-service-maintenance');snapshot=capture_storage('pre-switch-'+alias,keys);return snapshot
def deploy(result,before,manifest):
 global STAGE,DRAIN
 value=prepared(before);original_env=(BACKUP/'environment.private').read_bytes();desired=(PREPARE/'desired-environment.private').read_bytes();expected,raw=current('before-deploy');need(expected==before['runtime']and flags()==before['maintenanceInventory'],'unchanged-originals-before-switch');checked_source(TARGET,before,manifest,original_env);qc_contract(before);queue,database=queue_state(raw,'initial');result.update(initialQCQueue=queue,initialQCActiveDatabaseJobs=database);need(queue_quiet(queue,database),'qc-no-active-queued-scheduled-or-deferred-jobs-before-change')
 STAGE='reviewed-defaults-with-environment-file-preserved';need(desired==original_env,'production-env-entire-file-preserved');base=compose_base(before,True);args=overlay(base,value['images'],OUT/'runtime-images-and-literal-env.private.yml');preswitch={}
 for service in FACTORY_SERVICES:
  STAGE=service+'-single-service-maintenance';need(current('before-factory-switch')[0]==expected and flags()==before['maintenanceInventory'],'runtime-and-flags-before-single-service-switch');startup_guard(service,raw[service]);preswitch[service]=stop_and_snapshot((service,),expected,(service,),service)
  STAGE=service+'-fixed-candidate-create';DRAIN['candidateAttempted']=True;operation([*args,'up','-d','--force-recreate','--no-build','--no-deps','--pull','never',service],'create-'+service);immediate_raw_after_create(service);maintenance('wait_service_ready',service);after,postraw=current('post-create-'+service);private(service+'-post-create-inspect.private.json',postraw[service]);unchanged_others(expected,after,(service,));need(postraw[service]['Image']==value['images'][service]and postraw[service]['Id']!=raw[service]['Id']and postraw[service]['RestartCount']==0,'factory-new-fixed-image-container-without-restarts');config_preserved(service,raw[service],postraw[service],args,desired_environments()[service]);proof=factory_runtime_proof(service,postraw[service],'running-source-'+service);need(proof['files']==value['factoryCandidateFiles'][service],'factory-running-source-exact-candidate');time.sleep(10);need(current('stable-'+service)[0]==after,'factory-runtime-stable-after-dns-grace');maintenance('maintenance_off',service);maintenance('require_maintenance_cleared',service)
  try:need(public_factory(service,proof['files'])['healthHTTPStatus']==200,'factory-public-health-after-maintenance-clear')
  except BaseException:maintenance('maintenance_on',service);raise
  expected=after;raw=postraw;DRAIN=None
 STAGE='qc-shared-maintenance-and-safe-empty-worker';need(current('before-qc-switch')[0]==expected and flags()==before['maintenanceInventory'],'runtime-before-qc-env-switch');startup_guard('qc-report',raw['qc-report']);preswitch['qc-report']=stop_and_snapshot(QC_SERVICES,expected,('qc-report-data','qc-report-storage'),'qc-report');result['qcQueueAfterWebFullyStopped']=DRAIN['qcQueueAfterWebStopped'];result['qcActiveDatabaseJobsAfterWebFullyStopped']=DRAIN['qcActiveDatabaseJobsAfterWebStopped']
 STAGE='qc-fixed-existing-images-with-new-env';DRAIN['candidateAttempted']=True
 for service in QC_SERVICES:
  operation([*args,'up','-d','--force-recreate','--no-build','--no-deps','--pull','never',service],'create-'+service);immediate_raw_after_create(service);maintenance('wait_service_ready',service)
 after,postraw=current('post-create-qc-pair');private('qc-pair-post-create-inspects.private.json',postraw);unchanged_others(expected,after,QC_SERVICES)
 for service in QC_SERVICES:need(postraw[service]['Image']==value['images'][service]and postraw[service]['Id']!=raw[service]['Id']and postraw[service]['RestartCount']==0,'qc-new-container-original-image-without-restarts');config_preserved(service,raw[service],postraw[service],args,desired_environments()[service])
 time.sleep(10);need(current('stable-qc-pair')[0]==after,'qc-stable-after-dns-grace');maintenance('maintenance_off','qc-report');maintenance('require_maintenance_cleared','qc-report')
 try:status,body=public_get('/qc-report/health');need(status==200 and type(json.loads(body))is dict,'qc-public-health-after-shared-maintenance-clear')
 except BaseException:maintenance('maintenance_on','qc-report');raise
 DRAIN=None;expected=after;raw=postraw;STAGE='final-four-source-config-public-proof';proof,public=final_proofs(before,value,expected,raw,args);need(flags()==before['maintenanceInventory']and current('final-deploy')[0]==expected,'final-runtime-and-maintenance');checked_source(TARGET,before,manifest,desired);private('pre-switch-storage.private.json',preswitch);private('runtime-after.private.json',expected);private('source-proof-after.private.json',proof);result.update(success=True,onlyFourTargetContainersRecreated=True,onlyFactoryImagesBuilt=True,qcOriginalImagesAndSourcePreserved=True,allOtherContainersPreserved=True,onlyThreeNumericQCEnvironmentValuesChanged=True,allMaintenanceFlagsRestored=True,publicVerification=public,closedPreSwitchStoragePreserved=True)
def timestamp(value):
 match=re.fullmatch(r'(\d{4}-\d\d-\d\d[ T]\d\d:\d\d:\d\d)(?:\.(\d{1,9}))?(Z|[+-]\d\d:\d\d)',value or'')
 if not match:return None
 try:return datetime.datetime.fromisoformat((match[1]+('.'+match[2][:6].ljust(6,'0')if match[2]else'')+match[3]).replace('Z','+00:00')).astimezone(datetime.timezone.utc)
 except ValueError:return None
def log_policy(path,started):
 with contextlib.closing(CORE.OPS.L.connect(path,True))as db:
  row=db.execute("SELECT CASE WHEN json_valid(value) THEN json_extract(value,'$.logs.maxDays') END,CASE WHEN json_valid(value) THEN json_extract(value,'$.logs.minLevel') END,CASE WHEN json_valid(value) THEN json_type(value,'$.logs.maxDays') END,CASE WHEN json_valid(value) THEN json_type(value,'$.logs.minLevel') END FROM _params WHERE id='settings'").fetchone()
 start=timestamp(started)
 if row is None or row[2:]!=('integer','integer')or type(row[0])is not int or not 0<=row[0]<=36500 or type(row[1])is not int or not -100<=row[1]<=100 or start is None:return None
 return {'cutoff':start-datetime.timedelta(days=row[0]),'minLevel':row[1]}
def logs_retention(oldpath,newpath,olddata,newdata,started):
 policies=[log_policy(p,started)for p in (olddata,newdata)];policy=policies[0]if policies[0]is not None and policies[0]==policies[1]else None;counts={'oldRows':0,'retainedTypedIdentical':0,'retainedTypedChanged':0,'missing':0,'missingCompatibleWithConfiguredRetention':0,'newRows':0,'configuredPolicyAvailableAndUnchanged':policy is not None}
 with contextlib.closing(CORE.OPS.L.connect(oldpath,True))as db:
  db.execute('ATTACH DATABASE ? AS afterdb',(newpath.as_uri()+'?mode=ro&immutable=1',));columns=db.execute('PRAGMA table_xinfo(_logs)').fetchall();need(columns==db.execute('PRAGMA afterdb.table_xinfo(_logs)').fetchall()and columns and[c[1]for c in columns if c[5]]==['id'],'same-pocketbase-log-schema');names=[c[1]for c in columns];need({'id','created','level'}<=set(names),'known-pocketbase-log-fields');q=CORE.OPS.L.quote;need(all(db.execute('SELECT count(*)=count(DISTINCT id) FROM '+prefix+'._logs').fetchone()==(1,)for prefix in ('main','afterdb')),'unique-pocketbase-log-identities');query='SELECT '+','.join('a.'+q(n)for n in names)+','+','.join('b.'+q(n)for n in names)+' FROM _logs a LEFT JOIN afterdb._logs b ON a.id=b.id AND typeof(a.id)=typeof(b.id)';n=len(names);idindex=names.index('id')
  for row in db.execute(query):
   counts['oldRows']+=1;a,b=row[:n],row[n:]
   if b[idindex]is not None:counts['retainedTypedIdentical'if[CORE.OPS.L.cell(x)for x in a]==[CORE.OPS.L.cell(x)for x in b]else'retainedTypedChanged']+=1;continue
   counts['missing']+=1;created=timestamp(a[names.index('created')]);level=a[names.index('level')];compatible=policy is not None and((created is not None and created<=policy['cutoff'])or(type(level)is int and level<policy['minLevel']));counts['missingCompatibleWithConfiguredRetention']+=int(compatible)
  counts['newRows']=db.execute('SELECT count(*) FROM afterdb._logs b LEFT JOIN _logs a ON a.id=b.id AND typeof(a.id)=typeof(b.id) WHERE a.id IS NULL').fetchone()[0]
 counts['compatibleWithoutChangingRetainedRows']=counts['retainedTypedChanged']==0 and counts['missing']==counts['missingCompatibleWithConfiguredRetention'];return counts

def verify(result,before,manifest):
 global STAGE
 receipt=archive(DEPLOY,DEPLOY_MANIFEST,DEPLOY_RESULT);need(receipt.get('target')==TARGET and receipt.get('onlyFourTargetContainersRecreated')is True and receipt.get('closedPreSwitchStoragePreserved')is True,'actual-deployment-receipt');value=prepared(before);expected=read(DEPLOY/'runtime-after.private.json');runtime,raw=current('verify-initial');need(runtime==expected,'runtime-matches-exact-actual-deployment');desired=(PREPARE/'desired-environment.private').read_bytes();checked_source(TARGET,before,manifest,desired);STAGE='raw-observation-before-data-comparison';storage=capture_storage('observation',tuple(CORE.STORAGE));private('verify-storage.private.json',storage);old=read(DEPLOY/'pre-switch-storage.private.json');preswitch={**old['factory-review'],**old['factory-review-test'],**old['qc-report']};checks={};details={}
 for key in CORE.STORAGE:
  a,b=preswitch[key],storage[key];checks[key+'-schema-and-all-typed-rows']=a['sqlite']==b['sqlite'];checks[key+'-all-files-bytes-and-modes']=a['files']==b['files'];checks[key+'-database-owners-and-modes']=a['databaseFileMetadata']==b['databaseFileMetadata'];details[key]={'strictTypedIdentical':a['sqlite']==b['sqlite'],'filesIdentical':a['files']==b['files'],'changedTables':{name:{table:{'beforeRows':a['sqlite'][name]['tables'].get(table,{}).get('rows'),'afterRows':b['sqlite'][name]['tables'].get(table,{}).get('rows')}for table in set(a['sqlite'][name]['tables'])|set(b['sqlite'][name]['tables'])if a['sqlite'][name]['tables'].get(table)!=b['sqlite'][name]['tables'].get(table)}for name in set(a['sqlite'])&set(b['sqlite'])},'differencesDoNotIdentifyActor':True}
 for service in FACTORY_SERVICES:
  a,b=preswitch[service]['sqlite'],storage[service]['sqlite'];oldpath=DEPLOY/('pre-switch-'+service)/service/'sqlite';newpath=OUT/'observation'/service/'sqlite';retention=logs_retention(oldpath/'auxiliary.db',newpath/'auxiliary.db',oldpath/'data.db',newpath/'data.db',runtime['all'][runtime['targets'][service]]['started']);details[service]['logsRetentionCompatibility']=retention;checks.pop(service+'-schema-and-all-typed-rows');checks[service+'-main-schema-all-typed-business-rows']=a['data.db']==b['data.db'];checks[service+'-aux-schema-and-all-non-log-typed-rows']=a['auxiliary.db']['schema']==b['auxiliary.db']['schema']and{k:v for k,v in a['auxiliary.db']['tables'].items()if k!='_logs'}=={k:v for k,v in b['auxiliary.db']['tables'].items()if k!='_logs'};checks[service+'-all-retained-logs-typed-identical-and-only-policy-compatible-removals']=retention['compatibleWithoutChangingRetainedRows']
 args=[*COMPOSE,'-f',str(DEPLOY/'runtime-images-and-literal-env.private.yml')];STAGE='verify-four-source-config-and-public-assets';proof,public=final_proofs(before,value,runtime,raw,args);private('verified-source.private.json',proof);queue,database=queue_state(raw,'verify');checks['all-other-containers-preserved']={k:v for k,v in runtime['all'].items()if k not in set(runtime['targets'].values())}=={k:v for k,v in before['runtime']['all'].items()if k not in set(before['runtime']['targets'].values())};checks['all-maintenance-flags-restored']=flags()==before['maintenanceInventory'];need(current('verify-final')[0]==runtime,'verify-runtime-stable');checked_source(TARGET,before,manifest,desired);result.update(success=all(checks.values()),checks=checks,storageDifferences=details,publicVerification=public,queueAfter=queue,activeDatabaseJobsAfter=database,rawDataObservationRetainedBeforeComparison=True,dataRestoredOrRowsModified=False)
def recover_before_candidate(result):
 if not DRAIN or DRAIN['candidateAttempted']:return
 result['preCandidateOriginalContainerRecoveryAttempted']=True
 for service,cid in DRAIN['originalIds'].items():
  records=json.loads(run(['docker','inspect',cid]));need(len(records)==1 and records[0]['Id']==cid and records[0]['Image']==DRAIN['expected']['all'][cid]['image']and records[0]['State']['OOMKilled']is False,'same-old-container-before-candidate-only');config=copy.deepcopy(records[0]['Config']);config['Env']=sorted(config['Env']);old=DRAIN['expected']['all'][cid];need(sha(enc(config))==old['configSHA256']and sha(enc(records[0]['HostConfig']))==old['hostConfigSHA256']and sorted(records[0]['Mounts'],key=enc)==old['mounts']and records[0]['RestartCount']==old['restarts'],'full-original-container-config-before-recovery')
  if records[0]['State']['Running']is False:operation(['docker','start',cid],'recover-before-candidate-'+service,45)
  maintenance('wait_service_ready',service)
 after,_raw=current('pre-candidate-recovery');unchanged_others(DRAIN['expected'],after,DRAIN['services'])
 for service,cid in DRAIN['originalIds'].items():
  need(after['targets'][service]==cid,'same-original-id-after-recovery');old=DRAIN['expected']['all'][cid];row=after['all'][cid];need(all(row[k]==old[k]for k in ('id','image','oom','restarts','configSHA256','hostConfigSHA256','mounts')),'original-config-preserved-after-recovery')
 maintenance('maintenance_off',DRAIN['services'][0]);maintenance('require_maintenance_cleared',DRAIN['services'][0]);result['preCandidateOriginalContainersRecoveredWithoutDataRestore']=True
def main():
 global CORE,HOST,OUT,ENV
 need(len(sys.argv)==2 and sys.argv[1]in {'prepare','deploy','verify'},'fixed-three-phase-argument');mode=sys.argv[1];need({'prepare':PREPARE_PIN,'deploy':DEPLOY_PIN,'verify':VERIFY_PIN}[mode]and pin(TARGET,40)and pin(TREE,40)and pin(SOURCE_MANIFEST_SHA),'false-or-missing-reviewed-pins');need(os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_ATTEMPT')=='1','fixed-branch-first-attempt');os.umask(0o077);OUT={'prepare':PREPARE,'deploy':DEPLOY,'verify':VERIFY}[mode];OUT.mkdir(mode=0o700);CORE=load('batch-scoped-backup-library.py',CORE_SHA);CORE.initialize();CORE.OUT=OUT;CORE.F.OUT=OUT;CORE.Q.OUT=OUT;HOST=load('batch-host-config-library.py',HOST_SHA);ENV=dict(os.environ,COMPOSE_BAKE='false',COMPOSE_PARALLEL_LIMIT='1',COMPOSE_PROJECT_NAME='rr-portal',MAINT_FLAG_DIR=str(ROOT/'deploy/maintenance'),COMPOSE_FILE=str(ROOT/'docker-compose.cloud.yml'),ENV_FILE=str(ROOT/'.env.cloud.production'),MAINT_COMPOSE_SERVICES='\n'.join(ORDER),MAINT_HEALTH_TIMEOUT_SECONDS='300',MAINT_DNS_GRACE_SECONDS='10');signal.signal(signal.SIGTERM,lambda *_:need(False,'termination-signal'));result={'mode':mode,'base':BASE,'target':TARGET,'tree':TREE,'success':False,'businessWritesPerformed':False,'credentialsChanged':False,'mailboxStateChanged':False,'globalMaintenanceChanged':False,'automaticDataOrSchemaRollbackPerformed':False,'environmentFileModified':False}
 try:before=baseline();manifest=files();{'prepare':prepare,'deploy':deploy,'verify':verify}[mode](result,before,manifest)
 except BaseException:
  result.update(failedStage=STAGE,failedCheck=FAILED_CHECK or 'imported-helper-or-system-error');private('failure-trace.private.txt',traceback.format_exc().encode())
  if mode=='deploy':
   try:recover_before_candidate(result)
   except BaseException:result['preCandidateRecoveryIncomplete']=True;private('recovery-failure-trace.private.txt',traceback.format_exc().encode())
 finally:private('first-result.json',result);CORE.OPS.L.seal(OUT);need(len(enc(result))<=48000,'bounded-public-receipt');print(enc(dict(result,manifestSHA256=CORE.OPS.L.file_hash(OUT/'manifest.json'),resultSHA256=CORE.OPS.L.file_hash(OUT/'first-result.json'))).decode(),flush=True)
 return 0 if result['success']else 1
if __name__=='__main__':
 try:code=main()
 except BaseException:print('{"success":false,"safeFailure":"BATCH_975_976_SCOPED_RELEASE_PREFLIGHT_FAILED"}',flush=True);code=1
 sys.exit(code)
