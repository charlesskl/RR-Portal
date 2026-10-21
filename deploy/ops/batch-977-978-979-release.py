"""Five-service source-only release, local review draft; every execution gate is false.
PREPARE builds and proves all candidates before maintenance. Original credentials,
environment, queue contents and business data must remain byte/typed identical.
"""
import contextlib,copy,datetime,hashlib,importlib.util,io,json,os,pathlib,re,signal,stat,subprocess,sys,tarfile,time,traceback,urllib.parse,urllib.request
ROOT=pathlib.Path('/opt/rr-portal');BASE='b4c3763fe43e30c80c041c70e7a9f0750145d7b0';TARGET='';TREE=''
BRANCH='refs/heads/ops/batch-977-978-979-20261021';PREPARE_PIN=False;DEPLOY_PIN=False;VERIFY_PIN=False
CORE_SHA='bc35ae39aff4a54681e242928c729f15393ab8d778ffda0df1b581a5c1f02d9a';HOST_SHA='bd1842dc6847f3e0e5c0c38374c3604791f66d1c94dc651457607dc338f38ff1';SOURCE_MANIFEST_SHA=''
BACKUP_MANIFEST='';BACKUP_RESULT='';PREPARE_MANIFEST='';PREPARE_RESULT='';DEPLOY_MANIFEST='';DEPLOY_RESULT=''
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
def deploy(result,before,manifest):need(False,'deploy-draft-awaiting-peer-and-indo-migration-contract')
def verify(result,before,manifest):need(False,'verify-draft-awaiting-peer-and-indo-migration-contract')
def main():
 global OUT
 need(len(sys.argv)==2 and sys.argv[1]in{'prepare','deploy','verify'},'fixed-three-phase-mode');mode=sys.argv[1];need({'prepare':PREPARE_PIN,'deploy':DEPLOY_PIN,'verify':VERIFY_PIN}[mode]and pin(TARGET,40)and pin(TREE,40)and pin(SOURCE_MANIFEST_SHA)and pin(CORE_SHA),'false-gate-or-missing-reviewed-pins');need(os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_ATTEMPT')=='1'and pin(os.environ.get('RELEASE_SHA'),40),'fixed-ops-branch-first-attempt-and-sha');os.umask(0o077);OUT={'prepare':PREPARE,'deploy':DEPLOY,'verify':VERIFY}[mode];OUT.mkdir(mode=0o700);initialize();signal.signal(signal.SIGTERM,lambda *_:need(False,'terminated'));result={'mode':mode,'base':BASE,'target':TARGET,'tree':TREE,'success':False,'environmentFileModified':False,'providerRequestsPerformed':False,'queueWritesPerformed':False,'businessWritesPerformed':False,'automaticDataOrSchemaRollbackPerformed':False,'globalMaintenanceChanged':False}
 try:before=baseline();manifest=files();{'prepare':prepare,'deploy':deploy,'verify':verify}[mode](result,before,manifest)
 except BaseException:result.update(failedStage=STAGE,failedCheck=FAILED_CHECK or'reviewed-library-or-system-error');private('failure-trace.private.txt',traceback.format_exc().encode())
 private('first-result.json',result);CORE.OPS.L.seal(OUT);need(len(enc(result))<=48000,'bounded-public-result');print(enc(dict(result,manifestSHA256=CORE.OPS.L.file_hash(OUT/'manifest.json'),resultSHA256=CORE.OPS.L.file_hash(OUT/'first-result.json'))).decode(),flush=True);return 0 if result['success']else 1
if __name__=='__main__':
 try:code=main()
 except BaseException:print('{"success":false,"safeFailure":"BATCH_977_979_SCOPED_RELEASE_PREFLIGHT_FAILED"}',flush=True);code=1
 sys.exit(code)
