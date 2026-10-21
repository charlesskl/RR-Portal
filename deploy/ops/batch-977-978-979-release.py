"""Five-service source-only release, local review draft; every execution gate is false.
PREPARE builds and proves all candidates before maintenance. Original credentials,
environment, queue contents and business data must remain byte/typed identical.
"""
import contextlib,copy,datetime,hashlib,importlib.util,io,json,os,pathlib,re,signal,stat,subprocess,sys,tarfile,time,traceback,urllib.parse,urllib.request
ROOT=pathlib.Path('/opt/rr-portal');BASE='b4c3763fe43e30c80c041c70e7a9f0750145d7b0';TARGET='9b890cc016da403f929f8a7aaeddb878d3de24c5';TREE='e322834bbbd43082854d8c564192c3ca1e097534'
BRANCH='refs/heads/ops/batch-977-978-979-20261021';PREPARE_PIN=False;DEPLOY_PIN=True;VERIFY_PIN=False
CORE_SHA='bc35ae39aff4a54681e242928c729f15393ab8d778ffda0df1b581a5c1f02d9a';HOST_SHA='bd1842dc6847f3e0e5c0c38374c3604791f66d1c94dc651457607dc338f38ff1';SOURCE_MANIFEST_SHA='5a8d788ec323972c7f690e7e2823b186280d3017033302f6984fa16aa35b38ae'
BACKUP_MANIFEST='53ca11e474b8691a4e0ba6645938f64d5179b03693cb7fdff1f62fd1d720c4a3';BACKUP_RESULT='d994105360343894922ed3052dac1dd5bf2cd942206f02c5644813003b048802';PREPARE_MANIFEST='30f76a7b7832c31491c3353750658409fcad45ee4556ebaba8055f58dd7986d8';PREPARE_RESULT='e46732d9424a132508521d618a76f793b798509b6d6b9339087e04885af2f79e';DEPLOY_MANIFEST='';DEPLOY_RESULT=''
BACKUP=ROOT/'deploy/backups/batch-977-978-979-20261021-backup';PREPARE=BACKUP.with_name('batch-977-978-979-20261021-prepare');DEPLOY=BACKUP.with_name('batch-977-978-979-20261021-deploy');VERIFY=BACKUP.with_name('batch-977-978-979-20261021-verify')
FACTORY='apps/PMC跟仓管/加工厂月度评审管理制度';QC='apps/QA部/QC成品报告系统';INDO='apps/印尼小组/印尼走货明细'
FACTORY_SERVICES=('factory-review-test','factory-review');QC_SERVICES=('qc-report','qc-report-worker');ORDER=FACTORY_SERVICES+QC_SERVICES+('indo-shipping',)
COMPOSE=['docker','compose','-p','rr-portal','-f',str(ROOT/'docker-compose.cloud.yml'),'--env-file',str(ROOT/'.env.cloud.production')]
STAGE='entry';FAILED_CHECK=None;CORE=None;HOST=None;OUT=None;ENV=None;DRAIN=None;SERIAL=0

def need(value,label):
 global FAILED_CHECK
 if not value:FAILED_CHECK=label if type(label)is str and re.fullmatch('[a-z0-9-]{1,140}',label)else'invalid-check-name';raise RuntimeError('BATCH_977_979_SCOPED_RELEASE_REJECTED')
def enc(value):return json.dumps(value,sort_keys=True,ensure_ascii=True,separators=(',',':'),allow_nan=False).encode()
def sha(value):return hashlib.sha256(value).hexdigest()
def pin(value,n=64):return type(value)is str and bool(re.fullmatch('[a-f0-9]{%d}'%n,value))
def read(path):return json.loads(path.read_bytes())
def private(name,value):CORE.private(name,value)
def run(args,data=None,timeout=180):return CORE.run(args,data,timeout)
def load(name,digest):
 path=pathlib.Path(__file__).with_name(name);need(pin(digest)and path.is_file()and not path.is_symlink()and sha(path.read_bytes())==digest,'fixed-dependency-bytes');spec=importlib.util.spec_from_file_location(name.replace('.','_'),path);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module
def initialize():
 global CORE,HOST,ENV
 CORE=load('batch-current-backup-library.py',CORE_SHA);need(CORE.BASE==BASE and set(CORE.SERVICES)==set(ORDER),'fixed-current-baseline-library');CORE.OUT=OUT;CORE.initialize();HOST=load('batch-host-config-library.py',HOST_SHA)
 for module in (CORE.Q,CORE.F):module.OUT=OUT
 ENV=dict(os.environ,COMPOSE_BAKE='false',COMPOSE_PARALLEL_LIMIT='1',COMPOSE_PROJECT_NAME='rr-portal',MAINT_FLAG_DIR=str(ROOT/'deploy/maintenance'),COMPOSE_FILE=str(ROOT/'docker-compose.cloud.yml'),ENV_FILE=str(ROOT/'.env.cloud.production'),MAINT_COMPOSE_SERVICES='\n'.join(ORDER),MAINT_HEALTH_TIMEOUT_SECONDS='300',MAINT_DNS_GRACE_SECONDS='10')
def operation(args,label,timeout=180,checkout=False):
 global SERIAL
 SERIAL+=1
 with(OUT/('%04d-%s.private.log'%(SERIAL,label))).open('xb')as log:result=subprocess.run(args,stdout=log,stderr=subprocess.STDOUT,timeout=timeout,cwd=ROOT,env=ENV,umask=0o022 if checkout else -1)
 need(result.returncode==0,'successful-scoped-operation')
def archive(path,manifest_sha,result_sha):
 need(pin(manifest_sha)and pin(result_sha)and path.is_dir()and not path.is_symlink()and stat.S_IMODE(path.stat().st_mode)==0o700,'sealed-private-archive-root');need(CORE.OPS.L.file_hash(path/'manifest.json')==manifest_sha and CORE.OPS.L.file_hash(path/'first-result.json')==result_sha,'sealed-archive-receipt-pins');manifest=read(path/'manifest.json');entries=list(path.rglob('*'));need(len(entries)<=100000 and all(not p.is_symlink()and(p.is_dir()or p.is_file())and p.stat().st_mode&0o077==0 for p in entries),'private-archive-entry-types');need(set(manifest)=={str(p.relative_to(path))for p in entries if p.is_file()and p!=path/'manifest.json'}and all(CORE.OPS.L.safe_path(n)and pin(h)and CORE.OPS.L.file_hash(path/n)==h for n,h in manifest.items()),'sealed-complete-archive');receipt=read(path/'first-result.json');need(receipt.get('success')is True,'sealed-archive-success');return receipt
def baseline():
 receipt=archive(BACKUP,BACKUP_MANIFEST,BACKUP_RESULT);need(receipt.get('base')==BASE and receipt.get('backupComplete')is True and receipt.get('portableSQLiteCount')==5 and receipt.get('postgresSchemaCount')==1 and receipt.get('oldFailedJobsPreservedExactly')is True,'complete-five-sqlite-one-postgres-current-baseline');before=read(BACKUP/'baseline.private.json');need(before['head']==BASE and set(before['runtime']['targets'])==set(ORDER)and set(before['storage'])==set(CORE.STORAGE)and set(before['postgres'])=={'indo_shipping'},'fixed-five-service-baseline');return before
def files():
 path=pathlib.Path(__file__).with_name('batch-977-978-979-reviewed-files.json');need(path.is_file()and not path.is_symlink()and sha(path.read_bytes())==SOURCE_MANIFEST_SHA,'reviewed-source-manifest-pin');value=read(path);need(type(value)is dict and 0<len(value)<=200,'bounded-reviewed-source-manifest')
 for name,digest in value.items():
  need(CORE.OPS.L.safe_path(name)and pin(digest)and any(name.startswith(p+'/')for p in (QC,FACTORY,INDO)),'reviewed-three-application-source-scope')
  need(not any(name.startswith(p+'/'+part+'/')for p in (QC,FACTORY,INDO)for part in ('data','storage','pb_data','pb_data_test','node_modules','.git','bin','obj')),'no-persistent-or-generated-source-path')
 return value
def flags(alias=None):return[row for row in CORE.OPS.L.non_database_inventory(ROOT/'deploy/maintenance',[])if alias is None or row['path']!='services/'+alias]
def checked_source(revision,before,manifest):
 need(revision in(BASE,TARGET)and run(['git','symbolic-ref','--quiet','HEAD']).decode().strip()=='refs/heads/main'and run(['git','rev-parse','HEAD']).decode().strip()==revision,'canonical-reviewed-main');need(run(['git','rev-parse',TARGET+'^{tree}']).decode().strip()==TREE,'reviewed-target-tree');changed=run(['git','diff','--name-only','-z','--no-ext-diff','--no-textconv',BASE,TARGET]).decode().rstrip('\0').split('\0');need(set(changed)==set(manifest)and not set(manifest)&set(before['preexistingFourDirty']),'exact-target-diff-disjoint-dirty')
 for prefix in (QC,FACTORY,INDO):run(['git','diff','--quiet','--no-ext-diff','--no-textconv','--ignore-submodules=none','--',prefix])
 for name in CORE.FIXED:need((ROOT/name).is_file()and not(ROOT/name).is_symlink()and(ROOT/name).read_bytes()==run(['git','show',BASE+':'+name])==run(['git','show',TARGET+':'+name]),'fixed-compose-dockerfiles-deployment-and-nginx-unchanged')
 for name,digest in manifest.items():
  need(sha(run(['git','show',TARGET+':'+name]))==digest,'reviewed-target-file-bytes')
  if revision==TARGET:
   entry=run(['git','ls-tree','-z',TARGET,'--',name]).split(b'\t',1);need(len(entry)==2 and entry[1]==name.encode()+b'\0'and re.fullmatch(b'100(?:644|755) blob [a-f0-9]{40}',entry[0]),'canonical-source-git-mode');path=ROOT/name;need(path.is_file()and all(not p.is_symlink()for p in(path,*path.parents))and stat.S_IMODE(path.stat().st_mode)==(0o755 if entry[0].startswith(b'100755')else 0o644)and CORE.OPS.L.file_hash(path)==digest,'canonical-source-bytes-mode-and-no-symlink')
 need(CORE.Q.dirty_snapshot()==before['preexistingFourDirty']and CORE.Q.stable_environment_bytes(ROOT/'.env.cloud.production')==(BACKUP/'environment.private').read_bytes()and CORE.Q.stable_file_metadata(ROOT/'.env.cloud.production')==before['environmentFileMetadata'],'four-dirty-and-entire-environment-exact')
 for prefix in (QC+'/migrations',FACTORY+'/pb_migrations'):need(run(['git','rev-parse',BASE+':'+prefix])==run(['git','rev-parse',TARGET+':'+prefix]),'qc-and-pocketbase-no-migration-changes')
def environments():
 value={s:read(BACKUP/(s+'-literal-configured-environment.private.json'))for s in ORDER};need(all(type(v)is dict and all(type(k)is str and type(x)is str for k,x in v.items())for v in value.values()),'sealed-original-literal-environments');return value
def compose_base():
 need(run(['docker','compose','version','--short']).decode().strip()=='5.1.0','fixed-compose-version');value=json.loads(run([*COMPOSE,'config','--format','json']));need(value==read(BACKUP/'compose-render.private.json'),'entire-compose-render-preserved');return value
def overlay(base,images,path,build=False):
 need(set(images)==set(ORDER),'all-five-overlay-images');expected=copy.deepcopy(base);literal=environments();lines=['services:']
 for service in ORDER:
  image=images[service];need(image=='rr-portal-'+service+'-977-979:'+TARGET if build else bool(re.fullmatch('sha256:[a-f0-9]{64}',image)),'fixed-image-reference');serialized={k:v.replace('$','$$')for k,v in literal[service].items()};lines.extend(['  '+service+':','    environment: !override '+json.dumps(serialized,ensure_ascii=True,separators=(',',':')),'    image: '+image,'    pull_policy: never']);expected['services'][service].update(environment=serialized,image=image,pull_policy='never')
  if build:
   labels=dict(base['services'][service].get('build',{}).get('labels')or{});labels['org.opencontainers.image.revision']=TARGET;lines.extend(['    build:','      labels: '+json.dumps(labels,separators=(',',':'))]);expected['services'][service]['build']['labels']=labels
   if service in FACTORY_SERVICES:lines.extend(['      args:','        OCI_REVISION: '+TARGET]);expected['services'][service]['build']['args']['OCI_REVISION']=TARGET
 private(path.name,('\n'.join(lines)+'\n').encode());args=[*COMPOSE,'-f',str(path)];need(json.loads(run([*args,'config','--format','json']))==expected,'only-five-literal-env-images-and-build-metadata-overlay');return args,expected
def candidate_contract(service,image,oldraw,declared):
 old=read(BACKUP/(service+'-configured-image.private.json'));need(image['Architecture']==old['Architecture']=='amd64'and image['Os']==old['Os']=='linux'and image['Config'].get('Healthcheck')==old['Config'].get('Healthcheck'),'candidate-platform-and-healthcheck');labels=dict(old['Config'].get('Labels')or{});labels.update({'org.opencontainers.image.revision':TARGET,'com.docker.compose.project':'rr-portal','com.docker.compose.service':service,'com.docker.compose.version':'5.1.0'});need((image['Config'].get('Labels')or{})==labels,'candidate-only-revision-and-fixed-compose-build-labels');literal=environments()[service];need(dict(CORE.Q.envmap(image['Config'].get('Env')or[]),**literal)==literal,'candidate-defaults-covered-by-original-literal-env')
 for field,override in(('Cmd','command'),('Entrypoint','entrypoint'),('User','user'),('WorkingDir','working_dir')):
  actual=declared.get(override)
  if actual is None:actual=image['Config'].get(field)
  need(not(field=='Cmd'and declared.get('command')is None and declared.get('entrypoint')is not None),'no-suppressed-image-command');need(actual==oldraw['Config'].get(field)or field=='User'and actual in(None,'')and oldraw['Config'].get(field)in(None,''),'candidate-full-original-process-contract')
def factory_files(image,candidate=True,cid=None):
 command=['docker','run','--rm','--network','none','--read-only','--log-driver','none','--entrypoint','tar',image]if candidate else['docker','exec',cid,'tar'];blob=run([*command,'-C','/pb','-cf','-','pb_hooks','pb_migrations','pb_public']);result={};seen=set();total=0
 with tarfile.open(fileobj=io.BytesIO(blob),mode='r:')as archive_file:
  for member in archive_file:
   name=member.name.rstrip('/');need(CORE.OPS.L.safe_path(name)and name.split('/')[0]in{'pb_hooks','pb_migrations','pb_public'}and name not in seen and(member.isdir()or member.isfile()),'safe-bounded-factory-tar');seen.add(name)
   if member.isdir():continue
   total+=member.size;need(member.size<=16*1024**2 and total<=32*1024**2,'bounded-factory-candidate-assets');content=archive_file.extractfile(member).read();need(len(content)==member.size,'complete-factory-candidate-file');result[name]={'bytes':member.size,'sha256':sha(content)}
 names=run(['git','ls-tree','-r','--name-only','-z',TARGET,'--',FACTORY+'/pb_hooks',FACTORY+'/pb_migrations']).decode().rstrip('\0').split('\0');expected={n[len(FACTORY)+1:]:sha(run(['git','show',TARGET+':'+n]))for n in names};need({n:r['sha256']for n,r in result.items()if not n.startswith('pb_public/')}==expected and'pb_public/index.html'in result and any(n.startswith('pb_public/assets/')for n in result),'candidate-all-hooks-migrations-and-compiled-assets');return{'reviewedSourceMatch':True,'files':result}
def source_proof(service,image,candidate=True,cid=None):
 if service in FACTORY_SERVICES:return factory_files(image,candidate,cid)
 if service=='indo-shipping':return CORE.Q.service_source_proof(service,{'id':image if candidate else cid},revision=TARGET,candidate=candidate)
 files={'app.py','ai_service.py','bailian_adapter.py','pdf_service.py','task_queue.py','unified_pdf.py','worker.py','requirements.txt','alembic.ini'};dirs=('migrations/','templates/','static/','assets/');return CORE.Q.file_proof({'id':image if candidate else cid},QC,[*sorted(files),'migrations','templates','static','assets'],lambda n:n in files or n.startswith(dirs),revision=TARGET,candidate=candidate)

OFFLINE_QC_SCRIPT=r'''import dataclasses,json,os
from flask import Flask
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
import cryptography
from ai_service import AIConfig
from app import ai_runtime_config
assert cryptography.__version__=='50.0.2'
assert os.environ['QC_SKIP_APP_INIT']=='true'
engine=create_engine('sqlite:///file:/contract/qc-report.db?mode=ro&immutable=1&uri=true')
application=Flask('offline-config-contract');application.config['SECRET_KEY']=os.environ['SECRET_KEY']
with sessionmaker(bind=engine)() as db:
    actual=ai_runtime_config(db,application);expected=AIConfig.from_env()
    assert all(getattr(actual,f.name)==getattr(expected,f.name) for f in dataclasses.fields(expected))
    assert actual.api_format=='bailian_chat' and actual.model=='qwen3.8-max'
    assert actual.base_url=='https://dashscope.aliyuncs.com/compatible-mode/v1'
    assert actual.timeout_seconds==900 and actual.max_output_tokens==64000
    assert os.environ['RQ_JOB_TIMEOUT_SECONDS']=='1200' and bool(actual.api_key)
engine.dispose()
print(json.dumps({'allAIConfigFieldsEqualOriginalEnvironment':True,'readOnlySealedBackupSQLite':True,'noAppInitialization':True,'cryptographyVersion':'50.0.2','providerCallsPerformed':False}))
'''
def offline_qc_contract(service,image):
 need(service in QC_SERVICES,'qc-only-offline-contract');literal=environments()[service];need(all('\n'not in v and'\r'not in v and'\0'not in v for v in literal.values()),'docker-literal-env-file-format');envfile=OUT/(service+'-offline-literal.private.env');private(envfile.name,(''.join(k+'='+v+'\n'for k,v in literal.items())).encode());database=BACKUP/'qc-report-data/sqlite/qc-report.db';need(database.is_file()and not database.is_symlink(),'sealed-portable-qc-sqlite-present');args=['docker','run','--rm','-i','--network','none','--read-only','--log-driver','none','--user','0','--cap-drop','ALL','--security-opt','no-new-privileges','--env-file',str(envfile),'-e','QC_SKIP_APP_INIT=true','-e','PYTHONDONTWRITEBYTECODE=1','--mount','type=bind,src='+str(database)+',dst=/contract/qc-report.db,readonly','--entrypoint','python',image,'-B','-'];result=json.loads(run(args,OFFLINE_QC_SCRIPT.encode(),60));private(service+'-offline-config-contract.private.json',result);need(result=={'allAIConfigFieldsEqualOriginalEnvironment':True,'readOnlySealedBackupSQLite':True,'noAppInitialization':True,'cryptographyVersion':'50.0.2','providerCallsPerformed':False},'candidate-qc-config-full-equality-with-no-provider-request');return result
def queue_quiet(raw,before,label):
 value,failed=CORE.queue(raw,label);active=CORE.active(label);need(CORE.quiet(value,active)and failed==before['failedJobEvidence'],'qc-empty-and-entire-original-failed-evidence-identical');return value,active
def stable(before,manifest,label,revision=TARGET):
 runtime,raw=CORE.current(label);need(runtime==before['runtime']and flags()==before['maintenanceInventory'],'original-all-containers-and-flags-identical');checked_source(revision,before,manifest);queue_quiet(raw,before,label);return runtime,raw
def prepare(result,before,manifest):
 global STAGE
 STAGE='original-runtime-source-and-private-environment';runtime,raw=CORE.current('before-prepare');need(runtime==before['runtime']and flags()==before['maintenanceInventory'],'original-runtime-before-prepare');queue_quiet(raw,before,'before-prepare');run(['git','-c','core.hooksPath=/dev/null','fetch','--no-write-fetch-head','origin','main:refs/rr-portal-977-979-main']);need(run(['git','rev-parse','refs/rr-portal-977-979-main']).decode().strip()==TARGET,'remote-main-exact-reviewed-target');checked_source(BASE,before,manifest);run(['git','merge-base','--is-ancestor',BASE,TARGET]);originaltrees={s:run(['git','rev-parse',BASE+':'+(FACTORY if s in FACTORY_SERVICES else INDO if s=='indo-shipping'else QC)]).decode().strip()for s in ORDER};private('original-source-application-trees.private.json',originaltrees)
 STAGE='fast-forward-only-reviewed-canonical-source';operation(['git','-c','core.hooksPath=/dev/null','-c','merge.autoStash=false','merge','--ff-only','--no-autostash',TARGET],'fast-forward-reviewed-main',180,True);checked_source(TARGET,before,manifest);base=compose_base();tags={s:'rr-portal-'+s+'-977-979:'+TARGET for s in ORDER};args,declared=overlay(base,tags,OUT/'build-images-and-literal-env.private.yml',True);images={};proofs={};offline={}
 for service in ORDER:
  STAGE=service+'-candidate-build-before-any-maintenance';stable(before,manifest,service+'-before-build');operation([*args,'build',service],'build-'+service,1800);records=json.loads(run(['docker','image','inspect',tags[service]]));need(len(records)==1 and re.fullmatch('sha256:[a-f0-9]{64}',records[0]['Id']),'single-immutable-candidate-image');image=records[0];private(service+'-candidate-image.private.json',image);candidate_contract(service,image,raw[service],declared['services'][service]);proof=source_proof(service,image['Id']);private(service+'-candidate-source.private.json',proof);need(proof.get('reviewedSourceMatch')is True,'candidate-full-reviewed-source');proofs[service]=proof;images[service]=image['Id']
  if service in QC_SERVICES:offline[service]=offline_qc_contract(service,image['Id'])
  stable(before,manifest,service+'-after-build')
 private('prepared.private.json',{'target':TARGET,'tree':TREE,'images':images,'sourceProof':proofs,'runtimeBefore':runtime,'failedJobEvidence':before['failedJobEvidence'],'originalApplicationTrees':originaltrees,'environmentSHA256':{s:sha(enc(v))for s,v in environments().items()},'offlineQCConfigContracts':offline});result.update(success=True,allFiveCandidatesSealedBeforeMaintenance=True,allExistingContainersAndMaintenanceUnchanged=True,sourceOnlyRelease=True,allEnvironmentsPreserved=True,offlineQCFullOriginalConfigEqualityPassed=True,candidateImages=images,providerRequestsPerformed=False)
def startup_guard(service,raw):
 if service in FACTORY_SERVICES:
  env=CORE.Q.envmap(raw['Config']['Env']);email=env.get('FACTORY_REVIEW_ADMIN_EMAIL','').strip();need(bool(email)and len(env.get('FACTORY_REVIEW_ADMIN_PASSWORD',''))>=12,'factory-bootstrap-credential-contract')
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

OLD_RECEIPT_CHECK={'table':'po_receipts','name':'CK_po_receipts_qty_positive','definition':'CHECK ((qty > (0)::numeric))'}
NEW_RECEIPT_CHECK={'table':'po_receipts','name':'CK_po_receipts_qty_or_spare_positive','definition':'CHECK (((qty > (0)::numeric) OR ((qty = (0)::numeric) AND (spare_qty > (0)::numeric))))'}
SPARE_RECEIPT_CHECK={'table':'po_receipts','name':'CK_po_receipts_spare_qty_nonnegative','definition':'CHECK ((spare_qty >= (0)::numeric))'}

def prepared(before):
 receipt=archive(PREPARE,PREPARE_MANIFEST,PREPARE_RESULT);need(receipt.get('target')==TARGET and receipt.get('tree')==TREE and all(receipt.get(k)is True for k in('allFiveCandidatesSealedBeforeMaintenance','allExistingContainersAndMaintenanceUnchanged','allEnvironmentsPreserved','offlineQCFullOriginalConfigEqualityPassed')),'all-five-candidates-sealed-before-maintenance');value=read(PREPARE/'prepared.private.json');need(value['target']==TARGET and value['tree']==TREE and value['runtimeBefore']==before['runtime']and value['failedJobEvidence']==before['failedJobEvidence']and set(value['images'])==set(ORDER)and all(re.fullmatch('sha256:[a-f0-9]{64}',v)for v in value['images'].values())and value['environmentSHA256']=={s:sha(enc(v))for s,v in environments().items()},'sealed-prepared-runtime-images-env-and-queue');return value
def maintenance(fn,service):
 need(fn in{'maintenance_on','maintenance_off','wait_service_ready','require_maintenance_cleared'}and service in ORDER,'scoped-maintenance-command');operation(['bash','-c','set -euo pipefail; source "$1"; "$2" "$3"','batch-current-source-release',str(ROOT/'deploy/service-maintenance.sh'),fn,service],fn+'-'+service,340)
def unchanged_others(before,after,services):
 oldids={before['targets'][s]for s in services};newids={after['targets'][s]for s in services};need({k:v for k,v in before['all'].items()if k not in oldids}=={k:v for k,v in after['all'].items()if k not in newids}and set(before['targets'])==set(after['targets']),'all-non-selected-containers-full-runtime-identical')
def current_stable(expected,before,manifest,label,alias=None,stopped=()):
 value,raw=CORE.current(label,stopped=stopped);need(value==expected,'all-current-runtime-identical');checked_source(TARGET,before,manifest);need(flags(alias)==[row for row in before['maintenanceInventory']if alias is None or row['path']!='services/'+alias],'all-unrelated-maintenance-identical');return value,raw
def pid_environment(cid):
 blob=run(['docker','exec',cid,'cat','/proc/1/environ']);need(blob.endswith(b'\0'),'complete-pid1-environment');process=CORE.Q.envmap([v.decode()for v in blob.split(b'\0')if v]);need(process.pop('HOSTNAME',None)==cid[:12],'automatic-pid1-hostname-only');return process
def config_preserved(service,old,new,args):
 need(new['Id']!=old['Id']and new['RestartCount']==0 and new['State']['OOMKilled']is False and HOST.same_host_config(old['HostConfig'],new['HostConfig'])and sorted(old['Mounts'],key=enc)==sorted(new['Mounts'],key=enc),'new-container-original-host-config-mounts-no-restart');a=copy.deepcopy(old['Config']);b=copy.deepcopy(new['Config']);labels=a.pop('Labels')or{};actual=b.pop('Labels')or{};need(a.pop('Hostname')==old['Id'][:12]and b.pop('Hostname')==new['Id'][:12],'automatic-container-hostnames-only');a.pop('Image');need(b.pop('Image')==new['Image'],'immutable-image-id');a['Env']=sorted(a['Env']);b['Env']=sorted(b['Env']);need(a==b,'complete-config-all-environment-command-user-workdir-preserved');expected=copy.deepcopy(labels);expected.update({'org.opencontainers.image.revision':TARGET,'com.docker.compose.image':new['Image'],'com.docker.compose.project.config_files':','.join([str(ROOT/'docker-compose.cloud.yml'),str(DEPLOY/'runtime-images-and-literal-env.private.yml')])});hashes=run([*args,'config','--hash',service]).decode().split();need(len(hashes)==2 and hashes[0]==service and pin(hashes[1]),'fixed-compose-config-hash');expected['com.docker.compose.config-hash']=hashes[1];need(actual==expected,'only-reviewed-source-and-compose-image-label-deltas');process=pid_environment(new['Id']);private(service+'-pid1-complete.private.json',process);need(process==read(BACKUP/(service+'-literal-process-environment.private.json')),'complete-pid1-original-environment-preserved')
def immediate_raw(label):
 global SERIAL
 SERIAL+=1;ids=run(['docker','ps','-aq','--no-trunc']).decode().split();need(0<len(ids)<=1000 and len(ids)==len(set(ids))and all(pin(cid,64)for cid in ids),'bounded-immediate-runtime-inventory');private('%04d-%s-all-raw-before-health.private.json'%(SERIAL,label),json.loads(run(['docker','inspect',*ids])))
def pg_details(dbid):
 query="""BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SET LOCAL statement_timeout='30s';
SELECT jsonb_build_object(
'schema', (SELECT jsonb_build_object('name',nspname,'owner',nspowner::regrole::text,'acl',nspacl::text) FROM pg_namespace WHERE nspname='indo_shipping'),
'objects',COALESCE((SELECT jsonb_agg(jsonb_build_object('name',c.relname,'kind',c.relkind,'owner',c.relowner::regrole::text,'acl',c.relacl::text,'rls',c.relrowsecurity,'forceRls',c.relforcerowsecurity,'persistence',c.relpersistence) ORDER BY c.relname,c.relkind) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='indo_shipping'),'[]'),
'constraintFlags',COALESCE((SELECT jsonb_agg(jsonb_build_object('table',c.relname,'name',x.conname,'definition',pg_get_constraintdef(x.oid),'type',x.contype,'validated',x.convalidated,'deferrable',x.condeferrable,'deferred',x.condeferred,'local',x.conislocal,'inheritCount',x.coninhcount,'noInherit',x.connoinherit) ORDER BY c.relname,x.conname) FROM pg_constraint x JOIN pg_class c ON c.oid=x.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='indo_shipping'),'[]'));
COMMIT;
""";return json.loads(run(['docker','exec','-i',dbid,'sh','-c',CORE.Q.PG_SHELL],query.encode(),50))
def check_old_receipt_contract(value):
 constraints=value['constraintFlags'];need(all(type(row)is dict for row in constraints),'all-constraint-flags-observed')
 for expected in(OLD_RECEIPT_CHECK,SPARE_RECEIPT_CHECK):
  rows=[r for r in constraints if(r.get('table'),r.get('name'))==(expected['table'],expected['name'])];need(len(rows)==1 and all(rows[0].get(k)==v for k,v in expected.items())and rows[0].get('type')=='c'and rows[0].get('validated')is True,'old-receipt-constraint-exact-definition-type-and-validation')
 need(not any(r.get('table')==NEW_RECEIPT_CHECK['table']and r.get('name')==NEW_RECEIPT_CHECK['name']for r in constraints),'new-receipt-check-absent-before-source-change')
def pg_comparison(before,after,oldextra,newextra):
 checks={'all-tables-full-typed-rows-identical':before['tables']==after['tables'],'all-sequence-values-identical':before['sequenceStates']==after['sequenceStates']and before['sequenceStateStableDuringCapture']is True and after['sequenceStateStableDuringCapture']is True};expected=copy.deepcopy(before['schema']);rows=expected['constraints'];need(rows.count(OLD_RECEIPT_CHECK)==1 and NEW_RECEIPT_CHECK not in rows and rows.count(SPARE_RECEIPT_CHECK)==1,'old-schema-receipt-check-contract');expected['constraints']=sorted([r for r in rows if r!=OLD_RECEIPT_CHECK]+[NEW_RECEIPT_CHECK],key=lambda r:(r['table'],r['name']));checks['only-exact-receipt-check-schema-replacement']=expected==after['schema'];check_old_receipt_contract(oldextra);flags=copy.deepcopy(oldextra);oldrow=next(r for r in flags['constraintFlags']if(r['table'],r['name'])==(OLD_RECEIPT_CHECK['table'],OLD_RECEIPT_CHECK['name']));newrow=dict(oldrow,**NEW_RECEIPT_CHECK);flags['constraintFlags']=sorted([r for r in flags['constraintFlags']if r!=oldrow]+[newrow],key=lambda r:(r['table'],r['name']));checks['all-owners-grants-rls-and-constraint-flags-except-exact-check-identical']=flags==newextra;return checks
def capture(name,keys,raw,postgres=False):
 folder=OUT/name;folder.mkdir(mode=0o700);roots,_=CORE.roots(raw);need(set(keys)<=set(roots),'only-original-storage-roots');storage={}
 for key in keys:
  storage[key]=CORE.OPS.sqlite_capture(key,roots[key],folder/key);storage[key]['databaseFileMetadata']={n:CORE.Q.file_metadata(roots[key]/n)for n in storage[key]['sqlite']}
 value={'storage':storage,'postgres':None,'postgresDetails':None}
 if postgres:
  dbid=read(BACKUP/'baseline.private.json')['databaseContainer'];value['postgres']=CORE.postgres_capture(dbid,folder/'postgres',True);value['postgresDetails']=pg_details(dbid)
 value['observedUTC']=datetime.datetime.now(datetime.timezone.utc).isoformat();CORE.OPS.L.private_write(folder/'observed.private.json',enc(value));CORE.OPS.L.seal(folder);return value
def logs_retention(oldpath,newpath,olddata,newdata,started,observed):
 policies=[log_policy(p,started)for p in(olddata,newdata)];policy=policies[0]if policies[0]is not None and policies[0]==policies[1]else None;start,end=timestamp(started),timestamp(observed);need(start is not None and end is not None and start<=end,'bounded-pocketbase-request-window');counts={'oldRows':0,'retainedTypedIdentical':0,'retainedTypedChanged':0,'missing':0,'missingCompatibleWithConfiguredRetention':0,'newRows':0,'newRowsWithinRequestTime':0,'configuredPolicyAvailableAndUnchanged':policy is not None}
 with contextlib.closing(CORE.OPS.L.connect(oldpath,True))as db:
  db.execute('ATTACH DATABASE ? AS afterdb',(newpath.as_uri()+'?mode=ro&immutable=1',));columns=db.execute('PRAGMA table_xinfo(_logs)').fetchall();need(columns==db.execute('PRAGMA afterdb.table_xinfo(_logs)').fetchall()and columns and[c[1]for c in columns if c[5]]==['id'],'identical-pocketbase-log-schema');names=[c[1]for c in columns];need({'id','created','level'}<=set(names),'known-pocketbase-log-fields');q=CORE.OPS.L.quote;need(all(db.execute('SELECT count(*)=count(DISTINCT id) FROM '+prefix+'._logs').fetchone()==(1,)for prefix in('main','afterdb')),'unique-log-identities');query='SELECT '+','.join('a.'+q(n)for n in names)+','+','.join('b.'+q(n)for n in names)+' FROM _logs a LEFT JOIN afterdb._logs b ON a.id=b.id AND typeof(a.id)=typeof(b.id)';n=len(names);idindex=names.index('id')
  for row in db.execute(query):
   counts['oldRows']+=1;a,b=row[:n],row[n:]
   if b[idindex]is not None:counts['retainedTypedIdentical'if[CORE.OPS.L.cell(x)for x in a]==[CORE.OPS.L.cell(x)for x in b]else'retainedTypedChanged']+=1;continue
   counts['missing']+=1;created=timestamp(a[names.index('created')]);level=a[names.index('level')];compatible=policy is not None and((created is not None and created<=policy['cutoff'])or(type(level)is int and level<policy['minLevel']));counts['missingCompatibleWithConfiguredRetention']+=int(compatible)
  for(created,)in db.execute('SELECT b.created FROM afterdb._logs b LEFT JOIN _logs a ON a.id=b.id AND typeof(a.id)=typeof(b.id) WHERE a.id IS NULL'):
   counts['newRows']+=1;created=timestamp(created);counts['newRowsWithinRequestTime']+=int(created is not None and start<=created<=end)
 counts['compatibleWithoutChangingRetainedRows']=counts['retainedTypedChanged']==0 and counts['missing']==counts['missingCompatibleWithConfiguredRetention']and counts['newRows']==counts['newRowsWithinRequestTime'];return counts
def storage_comparison(before,after,oldfolder,newfolder,raw):
 checks={};details={};need(set(before['storage'])==set(after['storage']),'same-observed-storage-scope')
 for key,a in before['storage'].items():
  b=after['storage'][key];checks[key+'-all-files-bytes-and-modes']=a['files']==b['files'];checks[key+'-database-owner-mode']=a['databaseFileMetadata']==b['databaseFileMetadata'];checks[key+'-all-sqlite-schema-and-typed-rows']=a['sqlite']==b['sqlite']
  if key in FACTORY_SERVICES:
   del checks[key+'-all-sqlite-schema-and-typed-rows'];checks[key+'-all-business-data-schema-and-typed-rows']=a['sqlite']['data.db']==b['sqlite']['data.db'];x,y=a['sqlite']['auxiliary.db'],b['sqlite']['auxiliary.db'];checks[key+'-aux-schema-and-all-nonlog-rows']=x['schema']==y['schema']and{k:v for k,v in x['tables'].items()if k!='_logs'}=={k:v for k,v in y['tables'].items()if k!='_logs'};log=logs_retention(oldfolder/key/'sqlite/auxiliary.db',newfolder/key/'sqlite/auxiliary.db',oldfolder/key/'sqlite/data.db',newfolder/key/'sqlite/data.db',raw[key]['State']['StartedAt'],after['observedUTC']);checks[key+'-old-log-prefix-identical-only-request-time-additions-and-configured-retention']=log['compatibleWithoutChangingRetainedRows'];details[key]=log
 return checks,details
def public_get(path):
 need(path.startswith('/')and not path.startswith('//')and'?'not in path and'#'not in path and'..'not in path.split('/'),'fixed-readonly-public-path')
 class NoRedirect(urllib.request.HTTPRedirectHandler):
  def redirect_request(self,*_):return None
 start=datetime.datetime.now(datetime.timezone.utc).isoformat();opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),NoRedirect());request=urllib.request.Request('http://127.0.0.1'+path,headers={'Host':'8.148.146.194','Cache-Control':'no-cache'})
 with opener.open(request,timeout=20)as response:body=response.read(16*1024**2+1);need(response.status==200 and len(body)<=16*1024**2,'bounded-public-readonly-200')
 return body,{'path':path,'status':200,'bytes':len(body),'sha256':sha(body),'requestStartedUTC':start,'requestCompletedUTC':datetime.datetime.now(datetime.timezone.utc).isoformat()}
def public_proof(service,proof):
 if service=='qc-report-worker':return{'workerHasNoPublicRoute':True}
 base='/'+service+'/';health=base+('api/factory-review/health'if service in FACTORY_SERVICES else'health'if service=='qc-report'else'api/health');body,facts=public_get(health);need(type(json.loads(body))is dict,'json-health-object');results=[facts];assets=proof.get('files')if service in FACTORY_SERVICES else proof.get('compiledArtifactInventory')
 if assets:
  prefix='pb_public/'if service in FACTORY_SERVICES else'wwwroot/';chosen={name:row for name,row in assets.items()if name==prefix+'index.html'or name.startswith(prefix+'assets/')};need(prefix+'index.html'in chosen and len(chosen)>1,'compiled-index-and-assets-present')
  for name,row in chosen.items():
   relative=name[len(prefix):];body,facts=public_get(base if relative=='index.html'else base+urllib.parse.quote(relative,safe='/-._~'));need(facts['sha256']==row['sha256']and facts['bytes']==row['bytes'],'public-index-and-assets-equal-running-candidate');results.append(facts)
 return{'allReadOnlyHealthIndexAssetsVerified':True,'requests':results}
def exact_running_proof(service,old,new,value,args):
 need(new['Image']==value['images'][service],'running-prepared-immutable-image');config_preserved(service,old,new,args);proof=source_proof(service,new['Image'],False,new['Id']);private(service+'-running-full-source.private.json',proof);need(proof==value['sourceProof'][service],'running-full-source-and-compiled-assets-equal-sealed-candidate');return proof
def stop_and_snapshot(services,expected,raw,before,manifest,keys,alias,postgres=False):
 global DRAIN
 need(services and all(s in ORDER for s in services)and alias==services[0]and alias!='qc-report-worker','fixed-local-maintenance-group');need(all(row['path']!='services/'+alias for row in before['maintenanceInventory']),'original-service-maintenance-clear');DRAIN={'services':services,'alias':alias,'raw':{s:copy.deepcopy(raw[s])for s in services},'expected':copy.deepcopy(expected),'candidateAttempted':False,'stopped':[]};maintenance('maintenance_on',alias);need(flags(alias)==before['maintenanceInventory'],'only-current-maintenance-added')
 for service in services:
  if service=='qc-report-worker':
   middle,midraw=CORE.current('qc-web-stopped-idle-worker-check',stopped=('qc-report',));unchanged_others(expected,middle,('qc-report',));queue_quiet(midraw,before,'qc-web-fully-stopped-worker-idle')
  grace=1300 if service=='qc-report-worker'else 30;operation(['docker','stop','--time',str(grace),raw[service]['Id']],'stop-'+service,grace+20);DRAIN['stopped'].append(service)
 stopped,stoppedraw=CORE.current('original-group-stopped',stopped=services);unchanged_others(expected,stopped,services)
 for service in services:
  a,b=raw[service],stoppedraw[service];need(a['Id']==b['Id']and a['Config']==b['Config']and a['HostConfig']==b['HostConfig']and a['Mounts']==b['Mounts']and a['RestartCount']==b['RestartCount']and b['State']['OOMKilled']is False,'only-original-writers-stopped-full-config-preserved')
 checked_source(TARGET,before,manifest);need(flags(alias)==before['maintenanceInventory'],'other-maintenance-during-snapshot-identical');snapshot=capture('pre-switch-'+alias,keys,stoppedraw,postgres);after,_=CORE.current('closed-snapshot-complete',stopped=services);need(after==stopped,'closed-snapshot-original-stopped-runtime-stable');return snapshot,stopped
def deploy(result,before,manifest):
 global STAGE,DRAIN
 value=prepared(before);expected,raw=stable(before,manifest,'before-deploy');private('original-target-inspects.private.json',raw);base=compose_base();args,declared=overlay(base,value['images'],OUT/'runtime-images-and-literal-env.private.yml');original=copy.deepcopy(raw);preswitch={};public={};proofs={};postchecks={}
 for services,keys,alias in[((s,),(s,),s)for s in FACTORY_SERVICES]+[(QC_SERVICES,('qc-report-data','qc-report-storage'),'qc-report'),(('indo-shipping',),(),'indo-shipping')]:
  STAGE=alias+'-fresh-full-runtime-and-startup-guards';expected,raw=current_stable(expected,before,manifest,'before-'+alias)
  for service in services:
   candidate_contract(service,read(PREPARE/(service+'-candidate-image.private.json')),raw[service],declared['services'][service])
   if service!='indo-shipping':startup_guard(service,raw[service])
  if alias=='indo-shipping':
   dbid=CORE.database_container(expected,raw);checks=CORE.Q.indo_startup_guard(raw['indo-shipping']['Id'],dbid);private('fresh-indo-old-startup-guards.private.json',checks);need(all(checks.values()),'all-old-indo-startup-migrations-already-satisfied');details=pg_details(dbid);private('fresh-indo-old-constraint-flags.private.json',details);check_old_receipt_contract(details)
  STAGE=alias+'-local-maintenance-stop-writers-closed-snapshot';snapshot,stopped=stop_and_snapshot(services,expected,raw,before,manifest,keys,alias,alias=='indo-shipping');preswitch[alias]=snapshot
  STAGE=alias+'-fixed-candidates-create';DRAIN['candidateAttempted']=True
  for service in services:operation([*args,'up','-d','--force-recreate','--no-build','--no-deps','--pull','never',service],'create-'+service);immediate_raw(service);maintenance('wait_service_ready',service)
  after,postraw=CORE.current('after-create-'+alias);unchanged_others(expected,after,services)
  for service in services:proofs[service]=exact_running_proof(service,original[service],postraw[service],value,args)
  time.sleep(10);need(CORE.current('stable-after-dns-'+alias)[0]==after,'new-group-stable-after-dns-grace');STAGE=alias+'-closed-post-start-data-before-clear';observed=capture('post-start-'+alias,keys,postraw,alias=='indo-shipping');checks,details=storage_comparison(snapshot,observed,OUT/('pre-switch-'+alias),OUT/('post-start-'+alias),postraw)
  if alias=='indo-shipping':checks.update(pg_comparison(snapshot['postgres']['indo_shipping'],observed['postgres']['indo_shipping'],snapshot['postgresDetails'],observed['postgresDetails']))
  private(alias+'-closed-data-checks.private.json',{'checks':checks,'details':details,'before':snapshot,'observed':observed,'differencesDoNotIdentifyActor':True});need(all(checks.values()),'closed-data-schema-rows-permissions-and-sequences-preserved');postchecks[alias]=checks
  if alias=='qc-report':queue_quiet(postraw,before,'after-new-qc-before-clear')
  need(flags(alias)==before['maintenanceInventory'],'only-own-maintenance-before-clear');maintenance('maintenance_off',alias);maintenance('require_maintenance_cleared',alias)
  try:
   for service in services:public[service]=public_proof(service,proofs[service])
  except BaseException:maintenance('maintenance_on',alias);raise
  need(flags()==before['maintenanceInventory'],'all-maintenance-original-after-group');expected=after;raw=postraw;DRAIN=None
 STAGE='final-all-five-source-config-runtime-and-original-env';current_stable(expected,before,manifest,'final-deploy');unchanged_others(before['runtime'],expected,ORDER);queue_quiet(raw,before,'final-deploy-queue');private('pre-switch-storage.private.json',preswitch);private('runtime-after.private.json',expected);private('source-proof-after.private.json',proofs);private('public-requests.private.json',public);result.update(success=True,onlyFiveTargetContainersRecreated=True,allFiveSealedCandidateImagesRunning=True,allEnvironmentsAndOtherContainersPreserved=True,allMaintenanceFlagsRestored=True,closedPreSwitchStoragePreserved=True,onlyExactIndoReceiptCheckMigrated=True,closedDataChecks=postchecks,oldFailedJobsPreservedExactly=True,providerRequestsPerformed=False)
def verify(result,before,manifest):
 global STAGE
 receipt=archive(DEPLOY,DEPLOY_MANIFEST,DEPLOY_RESULT);need(receipt.get('target')==TARGET and all(receipt.get(k)is True for k in('onlyFiveTargetContainersRecreated','allFiveSealedCandidateImagesRunning','allEnvironmentsAndOtherContainersPreserved','closedPreSwitchStoragePreserved','onlyExactIndoReceiptCheckMigrated')),'sealed-completed-five-service-deploy');value=prepared(before);expected=read(DEPLOY/'runtime-after.private.json');runtime,raw=current_stable(expected,before,manifest,'verify-before-observation');unchanged_others(before['runtime'],runtime,ORDER);STAGE='raw-all-five-sqlite-and-indo-pg-before-comparison';observed=capture('observation',tuple(CORE.STORAGE),raw,True);private('raw-observation-before-comparison.private.json',observed);old=read(DEPLOY/'pre-switch-storage.private.json');checks={};details={};original=read(DEPLOY/'original-target-inspects.private.json');args=[*COMPOSE,'-f',str(DEPLOY/'runtime-images-and-literal-env.private.yml')];proofs={};public={}
 for alias,snapshot in old.items():
  scoped=dict(observed,storage={k:observed['storage'][k]for k in snapshot['storage']});part,extra=storage_comparison(snapshot,scoped,DEPLOY/('pre-switch-'+alias),OUT/'observation',raw);checks.update(part);details[alias]=extra
  if alias=='indo-shipping':checks.update(pg_comparison(snapshot['postgres']['indo_shipping'],observed['postgres']['indo_shipping'],snapshot['postgresDetails'],observed['postgresDetails']))
 for service in ORDER:proofs[service]=exact_running_proof(service,original[service],raw[service],value,args);public[service]=public_proof(service,proofs[service])
 queue_quiet(raw,before,'verify-original-failed-queue');current_stable(runtime,before,manifest,'verify-final');private('verification-comparison.private.json',{'checks':checks,'details':details,'differencesDoNotIdentifyActor':True});private('verified-source.private.json',proofs);private('verified-public-requests.private.json',public);result.update(success=all(checks.values()),checks=checks,rawObservationSealedBeforeComparison=True,allEnvironmentsAndNonTargetContainersPreserved=True,oldFailedJobsPreservedExactly=True,providerRequestsPerformed=False,unexpectedDifferencesNotAutomaticallyAttributedOrRestored=True)
def recover_before_candidate(result):
 if not DRAIN or DRAIN['candidateAttempted']:return
 result['preCandidateOriginalContainerRecoveryAttempted']=True
 for service,old in DRAIN['raw'].items():
  records=json.loads(run(['docker','inspect',old['Id']]));need(len(records)==1,'one-original-container-before-recovery');actual=records[0];need(actual['Id']==old['Id']and actual['Image']==old['Image']and actual['Config']==old['Config']and actual['HostConfig']==old['HostConfig']and actual['Mounts']==old['Mounts']and actual['RestartCount']==old['RestartCount']and actual['State']['OOMKilled']is False,'only-exact-original-container-recovery-before-candidate')
  if actual['State']['Running']is False:operation(['docker','start',old['Id']],'restart-exact-original-'+service,45)
  maintenance('wait_service_ready',service)
 after,raw=CORE.current('after-pre-candidate-original-recovery');unchanged_others(DRAIN['expected'],after,DRAIN['services'])
 for service,old in DRAIN['raw'].items():need(raw[service]['Id']==old['Id']and raw[service]['Config']==old['Config']and raw[service]['HostConfig']==old['HostConfig']and raw[service]['Mounts']==old['Mounts']and raw[service]['RestartCount']==old['RestartCount']and pid_environment(old['Id'])==read(BACKUP/(service+'-literal-process-environment.private.json')),'restored-exact-original-runtime-contract-and-pid1-env')
 maintenance('maintenance_off',DRAIN['alias']);maintenance('require_maintenance_cleared',DRAIN['alias']);result['preCandidateOriginalContainersRecoveredWithoutDataRestore']=True
def main():
 global OUT
 need(len(sys.argv)==2 and sys.argv[1]in{'prepare','deploy','verify'},'fixed-three-phase-mode');mode=sys.argv[1];need({'prepare':PREPARE_PIN,'deploy':DEPLOY_PIN,'verify':VERIFY_PIN}[mode]and pin(TARGET,40)and pin(TREE,40)and pin(SOURCE_MANIFEST_SHA)and pin(CORE_SHA),'false-gate-or-missing-reviewed-pins');need(os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_ATTEMPT')=='1'and pin(os.environ.get('RELEASE_SHA'),40),'fixed-ops-branch-first-attempt-and-sha');os.umask(0o077);OUT={'prepare':PREPARE,'deploy':DEPLOY,'verify':VERIFY}[mode];OUT.mkdir(mode=0o700);initialize();signal.signal(signal.SIGTERM,lambda *_:need(False,'terminated'));result={'mode':mode,'base':BASE,'target':TARGET,'tree':TREE,'success':False,'environmentFileModified':False,'providerRequestsPerformed':False,'queueWritesPerformed':False,'businessWritesPerformed':False,'automaticDataOrSchemaRollbackPerformed':False,'globalMaintenanceChanged':False}
 try:before=baseline();manifest=files();{'prepare':prepare,'deploy':deploy,'verify':verify}[mode](result,before,manifest)
 except BaseException:
  result.update(failedStage=STAGE,failedCheck=FAILED_CHECK or'reviewed-library-or-system-error');private('failure-trace.private.txt',traceback.format_exc().encode())
  if mode=='deploy':
   try:recover_before_candidate(result)
   except BaseException:result['preCandidateRecoveryIncomplete']=True;private('recovery-failure-trace.private.txt',traceback.format_exc().encode())
 private('first-result.json',result);CORE.OPS.L.seal(OUT);need(len(enc(result))<=48000,'bounded-public-result');print(enc(dict(result,manifestSHA256=CORE.OPS.L.file_hash(OUT/'manifest.json'),resultSHA256=CORE.OPS.L.file_hash(OUT/'first-result.json'))).decode(),flush=True);return 0 if result['success']else 1
if __name__=='__main__':
 try:code=main()
 except BaseException:print('{"success":false,"safeFailure":"BATCH_977_979_SCOPED_RELEASE_PREFLIGHT_FAILED"}',flush=True);code=1
 sys.exit(code)
