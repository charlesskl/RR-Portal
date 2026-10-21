"""Build and prove two QC candidates before any maintenance/configuration change.
Provider plan is private and pinned explicitly after the approved company preflight.
No provider requests, queue mutations, service switches or production env writes.
"""
import copy,hashlib,importlib.util,json,os,pathlib,re,signal,stat,subprocess,sys,traceback,urllib.parse
ROOT=pathlib.Path('/opt/rr-portal');BASE='25a76f71e556f77a8aadb031823b392832d2354a';TARGET='';TREE='';BRANCH='refs/heads/ops/qc-provider-429-20261021';PREPARE_PIN=False
CORE_SHA='b3b042788d75b4bb11f77641d1a5ecec34e40fe71c9bc7bb64c5b28597e559ec';BACKUP=ROOT/'deploy/backups/qc-provider-429-20261021-backup';BACKUP_MANIFEST='';BACKUP_RESULT='';MANIFEST_SHA=''
KEY_SOURCE='';BASE_SOURCE='';MODEL='';API_FORMAT='';EXPECTED_BASE_URL=''
OUT=ROOT/'deploy/backups/qc-provider-429-20261021-prepare-02';START_REVISION='b4c3763fe43e30c80c041c70e7a9f0750145d7b0';CORE=None;STAGE='entry';FAILED_CHECK=None;SERIAL=0
COMPOSE=['docker','compose','-p','rr-portal','-f',str(ROOT/'docker-compose.cloud.yml'),'--env-file',str(ROOT/'.env.cloud.production')]
def need(value,label):
 global FAILED_CHECK
 if not value:FAILED_CHECK=label;raise RuntimeError('QC_PREPARE_REJECTED')
def enc(value):return json.dumps(value,sort_keys=True,ensure_ascii=True,separators=(',',':'),allow_nan=False).encode()
def sha(value):return hashlib.sha256(value).hexdigest()
def pin(value,n=64):return type(value)is str and bool(re.fullmatch('[a-f0-9]{%d}'%n,value))
def private(name,value):CORE.private(name,value)
def run(args,data=None,timeout=180):return CORE.run(args,data,timeout)
def initialize():
 global CORE
 p=pathlib.Path(__file__).with_name('qc-scoped-backup-library.py');need(p.is_file()and not p.is_symlink()and sha(p.read_bytes())==CORE_SHA,'fixed-backup-library');s=importlib.util.spec_from_file_location('qc_scoped_core',p);CORE=importlib.util.module_from_spec(s);s.loader.exec_module(CORE);CORE.OUT=OUT;CORE.initialize()
def archive():
 need(pin(BACKUP_MANIFEST)and pin(BACKUP_RESULT)and BACKUP.is_dir()and not BACKUP.is_symlink()and stat.S_IMODE(BACKUP.stat().st_mode)==0o700,'fixed-private-baseline');need(CORE.OPS.L.file_hash(BACKUP/'manifest.json')==BACKUP_MANIFEST and CORE.OPS.L.file_hash(BACKUP/'first-result.json')==BACKUP_RESULT,'exact-baseline-seals');manifest=json.loads((BACKUP/'manifest.json').read_bytes());entries=list(BACKUP.rglob('*'));need(len(entries)<=100000 and all(not p.is_symlink()and(p.is_dir()or p.is_file())and p.stat().st_mode&0o077==0 for p in entries),'all-private-baseline-files');need(set(manifest)=={str(p.relative_to(BACKUP))for p in entries if p.is_file()and p!=BACKUP/'manifest.json'}and all(CORE.OPS.L.safe_path(name)and pin(digest)and CORE.OPS.L.file_hash(BACKUP/name)==digest for name,digest in manifest.items()),'complete-baseline-manifest');receipt=json.loads((BACKUP/'first-result.json').read_bytes());need(receipt.get('success')is True and receipt.get('backupComplete')is True and receipt.get('portableSQLiteCount')==1 and receipt.get('base')==BASE,'complete-one-qc-db-baseline');return json.loads((BACKUP/'baseline.private.json').read_bytes())
def reviewed_files():
 p=pathlib.Path(__file__).with_name('qc429-reviewed-files.json');need(p.is_file()and not p.is_symlink()and sha(p.read_bytes())==MANIFEST_SHA,'reviewed-source-manifest');value=json.loads(p.read_bytes());need(type(value)is dict and 0<len(value)<=30 and all(CORE.OPS.L.safe_path(name)and pin(digest)and(name in {'docker-compose.cloud.yml','.github/workflows/factory-review-restore-contract.yml'}or name.startswith(CORE.QC+'/')and not any(name.startswith(CORE.QC+'/'+part+'/')for part in ('data','storage')))for name,digest in value.items()),'reviewed-qc-source-scope');return value
def checked_source(revision,before,files):
 need(run(['git','symbolic-ref','--quiet','HEAD']).decode().strip()=='refs/heads/main'and run(['git','rev-parse','HEAD']).decode().strip()==revision,'canonical-server-main');need(run(['git','rev-parse',TARGET+'^{tree}']).decode().strip()==TREE,'exact-reviewed-target-tree');changed=run(['git','diff','--name-only','-z','--no-ext-diff','--no-textconv',BASE,TARGET]).decode().rstrip('\0').split('\0');need(set(changed)==set(files)and not set(files)&set(before['preexistingFourDirty']),'only-reviewed-files-no-dirty-overlap')
 for name,digest in files.items():
  need(sha(run(['git','show',TARGET+':'+name]))==digest,'reviewed-git-file-bytes')
  if revision==TARGET:need((ROOT/name).is_file()and not(ROOT/name).is_symlink()and CORE.OPS.L.file_hash(ROOT/name)==digest,'canonical-target-file-bytes')
 run(['git','diff','--quiet','--no-ext-diff','--no-textconv','--',CORE.QC]);need(CORE.Q.dirty_snapshot()==before['preexistingFourDirty']and CORE.Q.stable_environment_bytes(ROOT/'.env.cloud.production')==(BACKUP/'environment.private').read_bytes()and CORE.Q.stable_file_metadata(ROOT/'.env.cloud.production')==before['environmentFileMetadata'],'original-environment-and-four-dirty-preserved')
def selected_literal(blob,key):
 values=[]
 for line in blob.decode().splitlines():
  match=re.fullmatch(r'\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*',line)
  if match and match[1]==key:
   value=match[2]
   if len(value)>=2 and value[0]in("'",'"')and value[-1]==value[0]:value=value[1:-1]
   else:value=re.sub(r'\s+#.*$','',value).rstrip()
   values.append(value)
 need(len(values)==1 and bool(values[0])and not any(c in values[0]for c in ('\0','\n','\r'))and '${'not in values[0],'one-existing-literal-company-provider-value');return values[0]
def provider_plan(before):
 need(KEY_SOURCE in {'QC_BAILIAN_API_KEY','BAILIAN_API_KEY','DASHSCOPE_API_KEY'}and BASE_SOURCE=='PEISE_BAILIAN_BASE_URL'and API_FORMAT=='bailian_chat'and bool(MODEL)and bool(EXPECTED_BASE_URL),'explicit-company-provider-plan-pins');blob=(BACKUP/'environment.private').read_bytes();key=selected_literal(blob,KEY_SOURCE);base=selected_literal(blob,BASE_SOURCE);resolved={}
 for line in run(['docker','compose','-p','rr-portal','-f',str(ROOT/'docker-compose.cloud.yml'),'--env-file',str(BACKUP/'environment.private'),'config','--environment']).decode().splitlines():
  name,separator,value=line.partition('=')
  if separator and name in {KEY_SOURCE,BASE_SOURCE}:need(name not in resolved,'one-compose-provider-resolution');resolved[name]=value
 private('company-compose-parser-selected-values.private.json',resolved);need(resolved=={KEY_SOURCE:key,BASE_SOURCE:base},'company-literals-equal-actual-compose-dotenv-parser');parts=urllib.parse.urlsplit(base);need(base==EXPECTED_BASE_URL and parts.scheme=='https'and parts.hostname in {'dashscope.aliyuncs.com','dashscope-intl.aliyuncs.com'}and parts.port in(None,443)and parts.path.rstrip('/')=='/compatible-mode/v1'and not(parts.username or parts.password or parts.query or parts.fragment),'exact-approved-ali-company-endpoint');result={service:json.loads((BACKUP/(service+'-literal-configured-environment.private.json')).read_bytes())for service in CORE.SERVICES}
 for service in result:result[service].update(OPENAI_API_KEY=key,OPENAI_BASE_URL=base,OPENAI_MODEL=MODEL,OPENAI_API_FORMAT=API_FORMAT)
 private('desired-runtime-environments.private.json',result);private('provider-plan.private.json',{'sourceKey':KEY_SOURCE,'sourceBaseKey':BASE_SOURCE,'base':base,'model':MODEL,'apiFormat':API_FORMAT,'desiredEnvironmentSHA256':{s:sha(enc(v))for s,v in result.items()}});return result
def compose_base():
 need(run(['docker','compose','version','--short']).decode().strip()=='5.1.0','reviewed-compose-version');value=json.loads(run([*COMPOSE,'config','--format','json']));old=json.loads((BACKUP/'compose-render.private.json').read_bytes())
 for service in CORE.SERVICES:old['services'][service]['environment']['OPENAI_API_FORMAT']='responses'
 if 'x-qc-report-environment'in old:old['x-qc-report-environment']['OPENAI_API_FORMAT']='responses'
 need(value==old,'only-reviewed-api-format-compose-default-added');return value
def overlay(base,environments,tags):
 expected=copy.deepcopy(base);lines=['services:']
 for service in CORE.SERVICES:
  env={k:v.replace('$','$$')for k,v in environments[service].items()};labels=dict(base['services'][service].get('build',{}).get('labels')or{});labels['org.opencontainers.image.revision']=TARGET;lines.extend(['  '+service+':','    environment: !override '+json.dumps(env,ensure_ascii=True,separators=(',',':')),'    image: '+tags[service],'    pull_policy: never','    build:','      labels: '+json.dumps(labels,separators=(',',':'))]);expected['services'][service].update(environment=env,image=tags[service],pull_policy='never');expected['services'][service]['build']['labels']=labels
 path=OUT/'build-images-and-desired-env.private.yml';private(path.name,('\n'.join(lines)+'\n').encode());args=[*COMPOSE,'-f',str(path)];need(json.loads(run([*args,'config','--format','json']))==expected,'only-qc-build-labels-env-image-overlay');return args
def candidate(service,image,oldraw,base,environments):
 private(service+'-candidate-image.private.json',image);old=json.loads((BACKUP/(service+'-configured-image.private.json')).read_bytes());need(image['Architecture']==old['Architecture']=='amd64'and image['Os']==old['Os']=='linux'and(image['Config'].get('Labels')or{}).get('org.opencontainers.image.revision')==TARGET,'candidate-platform-and-source-label');expected_labels=dict(old['Config'].get('Labels')or{});expected_labels.update({'org.opencontainers.image.revision':TARGET,'com.docker.compose.project':'rr-portal','com.docker.compose.service':service,'com.docker.compose.version':'5.1.0'});need((image['Config'].get('Labels')or{})==expected_labels and image['Config'].get('Healthcheck')==old['Config'].get('Healthcheck'),'candidate-only-reviewed-image-and-fixed-compose-build-label-delta');need(dict(CORE.Q.envmap(image['Config'].get('Env')or[]),**environments[service])==environments[service],'candidate-full-literal-environment')
 for field,override in [('Cmd','command'),('Entrypoint','entrypoint'),('User','user'),('WorkingDir','working_dir')]:
  actual=base['services'][service].get(override)
  if actual is None:actual=image['Config'].get(field)
  need(actual==oldraw['Config'].get(field)or field=='User'and actual in(None,'')and oldraw['Config'].get(field)in(None,''),'candidate-original-process-contract')
 files={'app.py','ai_service.py','bailian_adapter.py','pdf_service.py','task_queue.py','unified_pdf.py','worker.py','requirements.txt','alembic.ini'};dirs=('migrations/','templates/','static/','assets/');proof=CORE.Q.file_proof({'id':image['Id']},CORE.QC,[*sorted(files),'migrations','templates','static','assets'],lambda name:name in files or name.startswith(dirs),revision=TARGET,candidate=True);private(service+'-candidate-source.private.json',proof);need(proof.get('reviewedSourceMatch')is True,'candidate-full-reviewed-qc-source-including-company-adapter');return proof
def failed_preserved(old,new):return old['registryKey']==new['registryKey']and all(key in new['jobs']and new['jobs'][key]==value for key,value in old['jobs'].items())
def stable(before,label):
 runtime,raw=CORE.current(label);need(runtime==before['runtime'],'all-containers-identical-before-maintenance');need(CORE.OPS.L.non_database_inventory(ROOT/'deploy/maintenance',[])==before['maintenanceInventory'],'all-maintenance-original');queue,failed=CORE.queue(raw,label);active=CORE.active(label);need(CORE.quiet(queue,active)and failed_preserved(before['failedJobEvidence'],failed),'qc-empty-and-original-failed-jobs-preserved');return runtime,raw
def prepare(result):
 global STAGE,SERIAL
 before=archive();files=reviewed_files();need(TARGET==START_REVISION,'fixed-already-reviewed-source-revision');STAGE='initial-runtime-and-fetch-target';runtime,raw=stable(before,'before-prepare');run(['git','-c','core.hooksPath=/dev/null','fetch','--no-write-fetch-head','origin','main:refs/rr-portal-qc429-main']);need(run(['git','rev-parse','refs/rr-portal-qc429-main']).decode().strip()==TARGET,'exact-remote-reviewed-main');checked_source(TARGET,before,files);run(['git','merge-base','--is-ancestor',BASE,TARGET]);STAGE='already-reviewed-main-source-kept-without-checkout';environments=provider_plan(before);base=compose_base();tags={service:'rr-portal-'+service+'-qc429:'+TARGET for service in CORE.SERVICES};args=overlay(base,environments,tags);images={};proofs={}
 for service in CORE.SERVICES:
  STAGE=service+'-candidate-build-before-maintenance';stable(before,service+'-before-build')
  with(OUT/(service+'-build.private.log')).open('xb')as log:p=subprocess.run([*args,'build',service],stdout=log,stderr=subprocess.STDOUT,timeout=1500,cwd=ROOT,env=dict(os.environ,COMPOSE_BAKE='false',COMPOSE_PARALLEL_LIMIT='1'),umask=0o077)
  need(p.returncode==0,'successful-qc-only-candidate-build');image=json.loads(run(['docker','image','inspect',tags[service]]));need(len(image)==1 and bool(re.fullmatch('sha256:[a-f0-9]{64}',image[0]['Id'])),'single-immutable-candidate');proofs[service]=candidate(service,image[0],raw[service],base,environments);images[service]=image[0]['Id'];stable(before,service+'-after-build');checked_source(TARGET,before,files)
 private('prepared.private.json',{'target':TARGET,'tree':TREE,'images':images,'sourceProof':proofs,'runtimeBefore':runtime,'failedJobEvidence':before['failedJobEvidence'],'desiredEnvironmentSHA256':{s:sha(enc(v))for s,v in environments.items()},'companyProviderProbesPerformed':False});result.update(success=True,bothReviewedCandidatesBuiltBeforeMaintenance=True,onlyQCCandidatesBuilt=True,allExistingContainersAndMaintenanceUnchanged=True,productionEnvironmentFileChanged=False,companyProviderPreflightStillRequired=True,candidateImages=images)
def main():
 need(len(sys.argv)==2 and sys.argv[1]=='prepare'and PREPARE_PIN and pin(TARGET,40)and pin(TREE,40)and pin(MANIFEST_SHA)and os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_ATTEMPT')=='1','false-gate-or-missing-pins');os.umask(0o077);OUT.mkdir(mode=0o700);initialize();signal.signal(signal.SIGTERM,lambda *_:need(False,'terminated'));result={'mode':'prepare','base':BASE,'target':TARGET,'tree':TREE,'success':False,'businessWritesPerformed':False,'queueWritesPerformed':False,'productionEnvironmentFileChanged':False,'containerSignalsSent':False,'maintenanceChanged':False,'providerRequestsPerformed':False}
 try:prepare(result)
 except BaseException:result.update(failedStage=STAGE,failedCheck=FAILED_CHECK or 'reviewed-library-or-system-error');private('failure-trace.private.txt',traceback.format_exc().encode())
 private('first-result.json',result);CORE.OPS.L.seal(OUT);print(enc(dict(result,manifestSHA256=CORE.OPS.L.file_hash(OUT/'manifest.json'),resultSHA256=CORE.OPS.L.file_hash(OUT/'first-result.json'))).decode(),flush=True);return 0 if result['success']else 1
if __name__=='__main__':
 try:code=main()
 except BaseException:print('{"mode":"prepare","success":false,"safeFailure":"QC_CANDIDATE_PREPARE_PREFLIGHT_FAILED"}',flush=True);code=1
 sys.exit(code)
