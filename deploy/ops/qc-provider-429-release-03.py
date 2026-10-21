"""Switch only the two prepared QC candidates; gates off. No provider calls or queue writes.
Only four QC provider dotenv fields may change. Keep every historical failed job,
all database rows, attachments, permissions, other services and maintenance flags.
"""
import contextlib,copy,hashlib,importlib.util,json,os,pathlib,re,signal,stat,subprocess,sys,time,traceback,urllib.error,urllib.request
ROOT=pathlib.Path('/opt/rr-portal');BASE='25a76f71e556f77a8aadb031823b392832d2354a';TARGET='b4c3763fe43e30c80c041c70e7a9f0750145d7b0';TREE='57085d6dcd242f154b4dbb199e54a71061abbd4d';BRANCH='refs/heads/ops/qc-provider-429-20261021';DEPLOY_PIN=False;VERIFY_PIN=True
PREPARE_HELPER_SHA='46ed834714a2414b51429065103779042c2e3d10eeb1b358e2c47f04271c4d81';HOST_SHA='bd1842dc6847f3e0e5c0c38374c3604791f66d1c94dc651457607dc338f38ff1';MANIFEST_SHA='c1b73460d8de0dc8f1b23a4204ac98c192880df6b247e88e8a99ee4ce81653ef';BACKUP_MANIFEST='7b218998ca5904e93f7c511a957c3f3ea351cb176698217220751e0f1621a096';BACKUP_RESULT='45e47bcf01d059e78ba7767f3f6ec741b9c70dd6a878f39a59e9082dd1756f50';PREPARE_MANIFEST='b8c4bef03ba53971d04fdf0becab3d30add8ffa9b839dda3b653fdf2fd15905b';PREPARE_RESULT='aa052c2f6dd6e04872a1ba911465a7a6f58c7df176318196ff1cab7483b6c8cb';CANDIDATE_CHECK_MANIFEST='df35183178a68fc9d9301777a3823217200465366e8940ee4413ecec7ef62a69';CANDIDATE_CHECK_RESULT='a9da0010f4078bd726765211eb8f1f5dec619646f796672d92eafa3b3e8de68d';DEPLOY_MANIFEST='b49883f3e67b45dbac710567c44da782990b5ccad9074b8bee13b7f509f99757';DEPLOY_RESULT='c2a145ff7ecccfa155104f1281015d691bc68ae4ff3d05707c4477cd5ceb626b'
BACKUP=ROOT/'deploy/backups/qc-provider-429-20261021-backup';PREPARE=BACKUP.with_name('qc-provider-429-20261021-prepare-02');DEPLOY=BACKUP.with_name('qc-provider-429-20261021-deploy');VERIFY=BACKUP.with_name('qc-provider-429-20261021-verify')
CANDIDATE_CHECK=BACKUP.with_name('qc-provider-429-20261021-candidate-check-02')
SERVICES=('qc-report','qc-report-worker');PROVIDER_FIELDS=('OPENAI_API_KEY','OPENAI_BASE_URL','OPENAI_MODEL','OPENAI_API_FORMAT');NUMERIC={'OPENAI_TIMEOUT_SECONDS':'900','OPENAI_MAX_OUTPUT_TOKENS':'64000','RQ_JOB_TIMEOUT_SECONDS':'1200'}
STAGE='entry';FAILED_CHECK=None;P=None;CORE=None;HOST=None;OUT=None;ENV=None;DRAIN=None;SERIAL=0
COMPOSE=['docker','compose','-p','rr-portal','-f',str(ROOT/'docker-compose.cloud.yml'),'--env-file',str(ROOT/'.env.cloud.production')]
def need(value,label):
 global FAILED_CHECK
 if not value:FAILED_CHECK=label;raise RuntimeError('QC_PROVIDER_SCOPED_RELEASE_REJECTED')
def enc(value):return json.dumps(value,sort_keys=True,ensure_ascii=True,separators=(',',':'),allow_nan=False).encode()
def sha(value):return hashlib.sha256(value).hexdigest()
def pin(value,n=64):return type(value)is str and bool(re.fullmatch('[a-f0-9]{%d}'%n,value))
def private(name,value):CORE.private(name,value)
def read(path):return json.loads(path.read_bytes())
def load(name,digest):
 path=pathlib.Path(__file__).with_name(name);need(path.is_file()and not path.is_symlink()and sha(path.read_bytes())==digest,'fixed-library-bytes');spec=importlib.util.spec_from_file_location(name.replace('.','_'),path);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module
def initialize():
 global P,CORE,HOST,ENV
 P=load('qc-candidate-prepare-02-library.py',PREPARE_HELPER_SHA);P.OUT=OUT;P.TARGET=TARGET;P.TREE=TREE;P.BACKUP_MANIFEST=BACKUP_MANIFEST;P.BACKUP_RESULT=BACKUP_RESULT;P.MANIFEST_SHA=MANIFEST_SHA;P.initialize();CORE=P.CORE;HOST=load('qc-host-config-library.py',HOST_SHA);ENV=dict(os.environ,COMPOSE_BAKE='false',COMPOSE_PARALLEL_LIMIT='1',COMPOSE_PROJECT_NAME='rr-portal',MAINT_FLAG_DIR=str(ROOT/'deploy/maintenance'),COMPOSE_FILE=str(ROOT/'docker-compose.cloud.yml'),ENV_FILE=str(ROOT/'.env.cloud.production'),MAINT_COMPOSE_SERVICES='\n'.join(SERVICES),MAINT_HEALTH_TIMEOUT_SECONDS='300',MAINT_DNS_GRACE_SECONDS='10')
def run(args,data=None,timeout=180):return CORE.run(args,data,timeout)
def operation(args,label,timeout=180):
 global SERIAL
 SERIAL+=1
 with(OUT/('%04d-%s.private.log'%(SERIAL,label))).open('xb')as log:p=subprocess.run(args,stdout=log,stderr=subprocess.STDOUT,timeout=timeout,cwd=ROOT,env=ENV)
 need(p.returncode==0,'successful-scoped-operation')
def archive(path,manifest_sha,result_sha):
 need(pin(manifest_sha)and pin(result_sha)and path.is_dir()and not path.is_symlink()and stat.S_IMODE(path.stat().st_mode)==0o700,'private-sealed-archive');need(CORE.OPS.L.file_hash(path/'manifest.json')==manifest_sha and CORE.OPS.L.file_hash(path/'first-result.json')==result_sha,'exact-archive-seals');manifest=read(path/'manifest.json');entries=list(path.rglob('*'));need(len(entries)<=100000 and all(not f.is_symlink()and(f.is_dir()or f.is_file())and f.stat().st_mode&0o077==0 for f in entries),'private-archive-entries');need(set(manifest)=={str(f.relative_to(path))for f in entries if f.is_file()and f!=path/'manifest.json'}and all(CORE.OPS.L.safe_path(n)and pin(h)and CORE.OPS.L.file_hash(path/n)==h for n,h in manifest.items()),'complete-archive-manifest');receipt=read(path/'first-result.json');need(receipt.get('success')is True,'successful-archive');return receipt
def prepared(before):
 receipt=archive(PREPARE,PREPARE_MANIFEST,PREPARE_RESULT);need(receipt.get('target')==TARGET and receipt.get('bothReviewedCandidatesBuiltBeforeMaintenance')is True and receipt.get('allExistingContainersAndMaintenanceUnchanged')is True,'prepared-two-qc-candidates');value=read(PREPARE/'prepared.private.json');environments=read(PREPARE/'desired-runtime-environments.private.json');need(value['target']==TARGET and value['tree']==TREE and value['runtimeBefore']==before['runtime']and value['failedJobEvidence']==before['failedJobEvidence']and set(value['images'])==set(SERVICES)and set(environments)==set(SERVICES),'prepared-original-runtime-and-failed-jobs');need(all(bool(re.fullmatch('sha256:[a-f0-9]{64}',image))for image in value['images'].values())and value['desiredEnvironmentSHA256']=={s:sha(enc(e))for s,e in environments.items()},'prepared-immutable-images-and-full-env');provider={key:environments[SERVICES[0]][key]for key in PROVIDER_FIELDS};need(provider['OPENAI_BASE_URL']=='https://dashscope.aliyuncs.com/compatible-mode/v1'and provider['OPENAI_MODEL']=='qwen3.8-max'and provider['OPENAI_API_FORMAT']=='bailian_chat'and bool(provider['OPENAI_API_KEY']),'approved-existing-company-provider');
 for service,desired in environments.items():
  original=read(BACKUP/(service+'-literal-configured-environment.private.json'));original.update(provider);need(desired==original and all(desired.get(k)==v for k,v in NUMERIC.items()),'only-four-approved-provider-runtime-fields')
 return value,environments
def candidate_checked(value):
 receipt=archive(CANDIDATE_CHECK,CANDIDATE_CHECK_MANIFEST,CANDIDATE_CHECK_RESULT);need(receipt.get('target')==TARGET and receipt.get('tree')==TREE and receipt.get('workerImageID')==value['images']['qc-report-worker']and receipt.get('model')=='qwen3.8-max'and receipt.get('providerHost')=='dashscope.aliyuncs.com'and all(receipt.get(name)is True for name in ('actualExtractPOPassed','actualInspectPhotosPassed','allOriginalContainersUnchanged','candidateContainerRemoved'))and receipt.get('providerRequestCounts')=={'po':1,'photos':1},'sealed-real-candidate-po-and-photo-checks-before-maintenance');return receipt

def desired_dotenv(original,provider):
 result=original
 for key in PROVIDER_FIELDS:
  value=provider[key];need(type(value)is str and bool(value)and not any(c in value for c in ("'",'\\','\0','\n','\r')),'literal-single-line-provider-setting');name=('QC_REPORT_'+key).encode();pattern=re.compile(rb'(?m)^[ \t]*(?:export[ \t]+)?'+re.escape(name)+rb'[ \t]*=[^\r\n]*(?:\r?\n|$)');matches=list(pattern.finditer(result));need(len(matches)<=1,'at-most-one-existing-qc-provider-setting');line=name+b"='"+value.encode()+b"'"
  if matches:
   a=matches[0];old=a.group();ending=b'\r\n'if old.endswith(b'\r\n')else b'\n'if old.endswith(b'\n')else b'';result=result[:a.start()]+line+ending+result[a.end():]
  else:result+=(b''if not result or result.endswith(b'\n')else b'\n')+line+b'\n'
 return result

def env_metadata():
 metadata=CORE.Q.stable_file_metadata(ROOT/'.env.cloud.production');return{k:metadata[k]for k in ('mode','uid','gid')}
def atomic_environment(expected,desired,metadata):
 path=ROOT/'.env.cloud.production';need(CORE.Q.stable_environment_bytes(path)==expected and env_metadata()==metadata,'exact-environment-before-atomic-update');temp=path.with_name('.env.cloud.production.qc429-'+str(os.getpid())+'.private.tmp');fd=os.open(temp,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
 try:
  with os.fdopen(fd,'wb')as stream:stream.write(desired);stream.flush();os.fchown(stream.fileno(),metadata['uid'],metadata['gid']);os.fchmod(stream.fileno(),metadata['mode']);os.fsync(stream.fileno())
  need(CORE.Q.stable_environment_bytes(path)==expected and env_metadata()==metadata,'environment-unchanged-before-replace');os.replace(temp,path);directory=os.open(path.parent,os.O_RDONLY|os.O_DIRECTORY)
  try:os.fsync(directory)
  finally:os.close(directory)
 finally:
  if temp.exists():temp.unlink()
 need(CORE.Q.stable_environment_bytes(path)==desired and env_metadata()==metadata,'exact-environment-after-atomic-update')
def checked_source(before,files,environment):
 need(run(['git','symbolic-ref','--quiet','HEAD']).decode().strip()=='refs/heads/main'and run(['git','rev-parse','HEAD']).decode().strip()==TARGET and run(['git','rev-parse',TARGET+'^{tree}']).decode().strip()==TREE,'canonical-reviewed-main-and-tree');need(set(run(['git','diff','--name-only','-z','--no-ext-diff','--no-textconv',BASE,TARGET]).decode().rstrip('\0').split('\0'))==set(files),'only-reviewed-source-change');run(['git','diff','--quiet','--no-ext-diff','--no-textconv','--',CORE.QC])
 for name,digest in files.items():need((ROOT/name).is_file()and not(ROOT/name).is_symlink()and CORE.OPS.L.file_hash(ROOT/name)==digest and sha(run(['git','show',TARGET+':'+name]))==digest,'exact-reviewed-source-file')
 for name in CORE.FIXED:need((ROOT/name).is_file()and not(ROOT/name).is_symlink()and (ROOT/name).read_bytes()==run(['git','show',TARGET+':'+name]),'all-fixed-runtime-configuration-byte-match')
 need(CORE.Q.dirty_snapshot()==before['preexistingFourDirty']and CORE.Q.stable_environment_bytes(ROOT/'.env.cloud.production')==environment and env_metadata()=={k:before['environmentFileMetadata'][k]for k in ('mode','uid','gid')},'four-dirty-and-exact-expected-env-preserved')
def flags(without_qc=False):return[row for row in CORE.OPS.L.non_database_inventory(ROOT/'deploy/maintenance',[])if not without_qc or row['path']!='services/qc-report']
def maintenance(fn):
 need(fn in {'maintenance_on','maintenance_off','wait_service_ready','require_maintenance_cleared'},'qc-maintenance-command');operation(['bash','-c','set -euo pipefail; source "$1"; "$2" "$3"','qc-release',str(ROOT/'deploy/service-maintenance.sh'),fn,'qc-report'],fn,340)
def wait_service(service):
 need(service in SERVICES,'qc-only-health-wait');operation(['bash','-c','set -euo pipefail; source "$1"; wait_service_ready "$2"','qc-release',str(ROOT/'deploy/service-maintenance.sh'),service],'wait-'+service,340)
def unchanged_others(before,after,changed=SERVICES):
 oldids={before['targets'][s]for s in changed};newids={after['targets'][s]for s in changed};need({k:v for k,v in before['all'].items()if k not in oldids}=={k:v for k,v in after['all'].items()if k not in newids}and set(before['targets'])==set(after['targets']),'every-non-qc-container-identical')
def queue_quiet(raw,before,label):
 queue,failed=CORE.queue(raw,label);active=CORE.active(label);need(CORE.quiet(queue,active)and P.failed_preserved(before['failedJobEvidence'],failed),'empty-queue-no-active-work-old-failed-preserved');return queue,active,failed
def capture(name,raw):
 folder=OUT/name;folder.mkdir(mode=0o700);roots,_=CORE.roots(raw);value=CORE.capture_storage(folder,roots);CORE.OPS.L.private_write(folder/'observed.private.json',enc(value));CORE.OPS.L.seal(folder);return value

def startup_guard():
 checks={}
 with contextlib.closing(CORE.OPS.L.connect(ROOT/CORE.QC/'data/qc-report.db'))as db:
  tables={row[0]for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
  for table in ('users','customers','products','purchase_orders','aql_rules','test_templates','photo_checklist_templates','defect_categories','settings','alembic_version'):checks[table+'-exists']=table in tables
  for table in ('users','aql_rules','test_templates','photo_checklist_templates','defect_categories'):checks[table+'-nonempty']=table in tables and db.execute('SELECT EXISTS(SELECT 1 FROM "'+table+'")').fetchone()[0]==1
  for table,column,value in (('customers','name','Zanzoon'),('products','item_no','5226155'),('purchase_orders','po_no','PO-26032401')):checks[table+'-existing-seed-row']=table in tables and db.execute('SELECT EXISTS(SELECT 1 FROM "'+table+'" WHERE "'+column+'"=?)',(value,)).fetchone()[0]==1
  for key in ('ai_workflow_defaults_v1','ai_workflow_defaults_v2','company_name','report_title','required_photo_categories','logo_path'):checks['setting-'+key]='settings'in tables and db.execute('SELECT EXISTS(SELECT 1 FROM settings WHERE key=?)',(key,)).fetchone()[0]==1
  checks['single-known-migration-head']='alembic_version'in tables and db.execute('SELECT version_num FROM alembic_version').fetchall()==[('b7c4f1a2d9e0',)]
 private('fresh-qc-startup-guard.private.json',checks);need(all(checks.values()),'no-new-seed-or-migration-on-existing-qc-data');need(run(['git','rev-parse',BASE+':'+CORE.QC+'/migrations'])==run(['git','rev-parse',TARGET+':'+CORE.QC+'/migrations']),'qc-migrations-byte-identical')
def stop_and_snapshot(before,runtime,raw):
 global DRAIN
 need(flags()==before['maintenanceInventory']and all(row['path']!='services/qc-report'for row in before['maintenanceInventory']),'original-qc-maintenance-clear');DRAIN={'runtime':runtime,'raw':raw,'maintenanceInventory':before['maintenanceInventory'],'environmentMetadata':{k:before['environmentFileMetadata'][k]for k in ('mode','uid','gid')},'candidateAttempted':False,'environmentChanged':False,'stopped':[]};maintenance('maintenance_on');need(flags(True)==before['maintenanceInventory'],'only-qc-maintenance-added');operation(['docker','stop','--time','30',raw['qc-report']['Id']],'stop-qc-web',50);DRAIN['stopped'].append('qc-report');middle,midraw=CORE.current('web-stopped',stopped=('qc-report',));unchanged_others(runtime,middle,('qc-report',));queue_quiet(midraw,before,'web-stopped-before-snapshot');snapshot=capture('pre-switch',midraw);private('pre-switch-storage.private.json',snapshot);queue_quiet(midraw,before,'snapshot-complete-before-worker-stop');operation(['docker','stop','--time','1300',raw['qc-report-worker']['Id']],'stop-empty-qc-worker',1320);DRAIN['stopped'].append('qc-report-worker');after,_=CORE.current('both-originals-stopped',stopped=SERVICES);unchanged_others(runtime,after)
 for service in SERVICES:
  old=runtime['all'][runtime['targets'][service]];new=after['all'][after['targets'][service]];need(all(old[k]==new[k]for k in ('id','image','started','oom','restarts','configSHA256','hostConfigSHA256','mounts')),'original-qc-only-stopped-full-config-intact')
 need(flags(True)==before['maintenanceInventory'],'only-own-maintenance-during-closed-snapshot');return snapshot

def compose_after_update(environments):
 need(run(['docker','compose','version','--short']).decode().strip()=='5.1.0','reviewed-compose-version');value=json.loads(run([*COMPOSE,'config','--format','json']));expected=read(BACKUP/'compose-render.private.json');provider={k:environments[SERVICES[0]][k].replace('$','$$')for k in PROVIDER_FIELDS}
 for service in SERVICES:expected['services'][service]['environment'].update(provider)
 if 'x-qc-report-environment'in expected:expected['x-qc-report-environment'].update(provider)
 need(value==expected,'only-four-provider-fields-in-rendered-compose');return value

def raw_after_create(service):
 global SERIAL
 SERIAL+=1;ids=run(['docker','ps','-aq','--no-trunc']).decode().split();need(0<len(ids)<=1000 and len(ids)==len(set(ids))and all(pin(cid,64)for cid in ids),'bounded-immediate-runtime-inventory');private('%04d-%s-post-create-before-health.private.json'%(SERIAL,service),json.loads(run(['docker','inspect',*ids])))
def config_preserved(service,old,new,args,environments):
 need(new['Id']!=old['Id']and new['RestartCount']==0 and new['State']['OOMKilled']is False and HOST.same_host_config(old['HostConfig'],new['HostConfig'])and sorted(old['Mounts'],key=enc)==sorted(new['Mounts'],key=enc),'new-qc-without-restarts-original-hostconfig-mounts');a=copy.deepcopy(old['Config']);b=copy.deepcopy(new['Config']);labels=a.pop('Labels')or{};actual=b.pop('Labels')or{};need(a.pop('Hostname')==old['Id'][:12]and b.pop('Hostname')==new['Id'][:12],'automatic-hostnames-only');a.pop('Image');need(b.pop('Image')==new['Image'],'immutable-runtime-image');a['Env']=sorted(k+'='+v for k,v in environments[service].items());b['Env']=sorted(b['Env']);need(a==b,'all-target-config-except-four-env-and-image-preserved');expected=copy.deepcopy(labels);expected.update({'com.docker.compose.image':new['Image'],'com.docker.compose.project.config_files':','.join([str(ROOT/'docker-compose.cloud.yml'),str(DEPLOY/'build-images-and-desired-env.private.yml')]),'org.opencontainers.image.revision':TARGET});hashes=run([*args,'config','--hash',service]).decode().split();need(len(hashes)==2 and pin(hashes[1]),'one-compose-config-hash');expected['com.docker.compose.config-hash']=hashes[1];need(actual==expected,'only-reviewed-image-and-compose-label-deltas');blob=run(['docker','exec',new['Id'],'cat','/proc/1/environ']);need(blob.endswith(b'\0'),'complete-pid1-environment');process=CORE.Q.envmap([v.decode()for v in blob.split(b'\0')if v]);need(process.pop('HOSTNAME',None)==new['Id'][:12],'new-pid1-automatic-hostname');oldprocess=read(BACKUP/(service+'-literal-process-environment.private.json'));oldprocess.update({k:environments[service][k]for k in PROVIDER_FIELDS});private(service+'-verified-pid1.private.json',process);need(process==oldprocess and all(process.get(k)==v for k,v in NUMERIC.items()),'pid1-only-four-provider-fields-numeric-budgets-preserved')
def runtime_source(service,raw,value):
 files={'app.py','ai_service.py','bailian_adapter.py','pdf_service.py','task_queue.py','unified_pdf.py','worker.py','requirements.txt','alembic.ini'};dirs=('migrations/','templates/','static/','assets/');proof=CORE.Q.file_proof({'id':raw['Id']},CORE.QC,[*sorted(files),'migrations','templates','static','assets'],lambda n:n in files or n.startswith(dirs),revision=TARGET);private(service+'-running-source.private.json',proof);need(proof['reviewedSourceMatch']is True and proof['sourceFileSHA256']==value['sourceProof'][service]['sourceFileSHA256'],'running-full-qc-source-equals-prepared-candidate');return proof

def compare_storage(before,after):
 checks={}
 for key in CORE.STORAGE:checks[key+'-schema-and-all-typed-rows']=before[key]['sqlite']==after[key]['sqlite'];checks[key+'-all-files-bytes-and-modes']=before[key]['files']==after[key]['files'];checks[key+'-database-owners-and-modes']=before[key]['databaseFileMetadata']==after[key]['databaseFileMetadata']
 return checks

def public_health():
 try:
  with urllib.request.urlopen(urllib.request.Request('http://127.0.0.1/qc-report/health',headers={'Cache-Control':'no-cache'}),timeout=15)as response:body=response.read(65537);need(response.status==200 and len(body)<=65536 and type(json.loads(body))is dict,'qc-public-health-200');return response.status
 except urllib.error.HTTPError:need(False,'qc-public-health-http-error')
def deploy(result,before,files):
 global STAGE,DRAIN
 value,environments=prepared(before);candidate_checked(value);runtime,raw=CORE.current('before-deploy');need(runtime==before['runtime']and flags()==before['maintenanceInventory'],'all-original-containers-and-flags-before-deploy');original=(BACKUP/'environment.private').read_bytes();checked_source(before,files,original);queue_quiet(raw,before,'initial');startup_guard();private('original-qc-inspects.private.json',raw);provider={k:environments[SERVICES[0]][k]for k in PROVIDER_FIELDS};desired=desired_dotenv(original,provider);private('desired-production-environment.private',desired);STAGE='qc-only-maintenance-and-closed-snapshot';snapshot=stop_and_snapshot(before,runtime,raw);STAGE='atomic-four-qc-provider-settings';metadata={k:before['environmentFileMetadata'][k]for k in ('mode','uid','gid')};DRAIN['environmentChanged']=True;atomic_environment(original,desired,metadata);result['environmentFileModified']=True;checked_source(before,files,desired);base=compose_after_update(environments);args=P.overlay(base,environments,value['images']);STAGE='create-only-two-fixed-qc-candidates';DRAIN['candidateAttempted']=True
 for service in SERVICES:operation([*args,'up','-d','--force-recreate','--no-build','--no-deps','--pull','never',service],'create-'+service);raw_after_create(service);wait_service(service)
 after,postraw=CORE.current('new-qc-pair');unchanged_others(runtime,after);proof={}
 for service in SERVICES:need(postraw[service]['Image']==value['images'][service],'exact-prepared-qc-image');config_preserved(service,raw[service],postraw[service],args,environments);proof[service]=runtime_source(service,postraw[service],value)
 time.sleep(10);need(CORE.current('new-qc-stable')[0]==after,'new-qc-pair-stable-after-dns-grace');queue,active,failed=queue_quiet(postraw,before,'post-create');STAGE='strict-closed-qc-storage-proof';observed=capture('post-create',postraw);checks=compare_storage(snapshot,observed);private('closed-data-checks.private.json',checks);need(all(checks.values()),'closed-qc-all-business-typed-rows-files-and-owners-preserved');need(flags(True)==before['maintenanceInventory'],'other-maintenance-flags-unchanged');maintenance('maintenance_off');maintenance('require_maintenance_cleared')
 try:public_status=public_health()
 except BaseException:maintenance('maintenance_on');raise
 DRAIN=None;need(flags()==before['maintenanceInventory']and CORE.current('final-deploy')[0]==after,'all-maintenance-restored-and-runtime-stable');checked_source(before,files,desired);private('runtime-after.private.json',after);private('source-proof-after.private.json',proof);result.update(success=True,onlyTwoQCContainersRecreated=True,allNonQCContainersPreserved=True,onlyFourQCProviderSettingsChanged=True,closedPreSwitchStoragePreserved=True,closedStorageChecks=checks,oldFailedJobsPreservedExactly=True,oldFailedJobCount=len(before['failedJobEvidence']['jobs']),failedJobEvidenceSHA256=sha(enc(failed)),allMaintenanceFlagsRestored=True,publicHealthHTTPStatus=public_status,preparedCandidateActualPOAndPhotoChecksPassed=True,candidateImages=value['images'])
def verify(result,before,files):
 global STAGE
 receipt=archive(DEPLOY,DEPLOY_MANIFEST,DEPLOY_RESULT);need(receipt.get('target')==TARGET and receipt.get('onlyTwoQCContainersRecreated')is True and receipt.get('closedPreSwitchStoragePreserved')is True,'completed-qc-only-release');value,environments=prepared(before);candidate_checked(value);expected=read(DEPLOY/'runtime-after.private.json');runtime,raw=CORE.current('verify-initial');need(runtime==expected,'exact-actual-deployed-runtime');unchanged_others(before['runtime'],runtime);desired=(DEPLOY/'desired-production-environment.private').read_bytes();checked_source(before,files,desired);args=[*COMPOSE,'-f',str(DEPLOY/'build-images-and-desired-env.private.yml')];oldraw=read(DEPLOY/'original-qc-inspects.private.json');proof={}
 for service in SERVICES:need(raw[service]['Image']==value['images'][service],'verify-prepared-immutable-image');config_preserved(service,oldraw[service],raw[service],args,environments);proof[service]=runtime_source(service,raw[service],value)
 STAGE='read-only-qc-observation';storage=capture('observation',raw);checks=compare_storage(read(DEPLOY/'pre-switch-storage.private.json'),storage);private('verified-storage-checks.private.json',checks);queue,active,failed=queue_quiet(raw,before,'verify');checks['all-maintenance-restored']=flags()==before['maintenanceInventory'];checks['public-qc-health-200']=public_health()==200;need(CORE.current('verify-final')[0]==runtime,'verify-runtime-stable');checked_source(before,files,desired);result.update(success=all(checks.values()),checks=checks,allNonQCContainersPreserved=True,oldFailedJobsPreservedExactly=True,oldFailedJobCount=len(before['failedJobEvidence']['jobs']),failedJobEvidenceSHA256=sha(enc(failed)),dataRestoredOrRowsModified=False,rawStorageObservationRetained=True,preparedCandidateActualPOAndPhotoChecksPassed=True)
def recover_before_candidate(result):
 if not DRAIN or DRAIN['candidateAttempted']:return
 result['preCandidateRecoveryAttempted']=True
 if DRAIN['environmentChanged']:
  original=(BACKUP/'environment.private').read_bytes();current=CORE.Q.stable_environment_bytes(ROOT/'.env.cloud.production')
  if current!=original:need(current==(OUT/'desired-production-environment.private').read_bytes(),'only-exact-reviewed-env-may-be-restored');atomic_environment(current,original,DRAIN['environmentMetadata'])
  need(CORE.Q.stable_environment_bytes(ROOT/'.env.cloud.production')==original and env_metadata()==DRAIN['environmentMetadata'],'original-env-owner-mode-before-recovery')
  result['environmentFileModified']=False;result['preCandidateOriginalEnvironmentRestored']=True
 for service in SERVICES:
  old=DRAIN['raw'][service];records=json.loads(run(['docker','inspect',old['Id']]));need(len(records)==1 and records[0]['Id']==old['Id']and records[0]['Image']==old['Image']and records[0]['State']['OOMKilled']is False,'same-old-qc-container-only-before-candidate');new=records[0];need(new['Config']==old['Config']and new['HostConfig']==old['HostConfig']and new['Mounts']==old['Mounts']and new['RestartCount']==old['RestartCount'],'full-original-config-before-recovery')
  if new['State']['Running']is False:operation(['docker','start',old['Id']],'start-original-'+service,45)
  wait_service(service)
 after,_=CORE.current('pre-candidate-recovery');unchanged_others(DRAIN['runtime'],after)
 for service in SERVICES:need(after['targets'][service]==DRAIN['raw'][service]['Id'],'same-old-qc-id-after-recovery')
 need(flags(True)==DRAIN['maintenanceInventory'],'other-maintenance-original-before-recovery-clear');maintenance('maintenance_off');maintenance('require_maintenance_cleared');result['preCandidateOriginalContainersRecovered']=True

def main():
 global OUT,STAGE
 need(len(sys.argv)==2 and sys.argv[1]in {'deploy','verify'},'fixed-phase');mode=sys.argv[1];need({'deploy':DEPLOY_PIN,'verify':VERIFY_PIN}[mode]and pin(TARGET,40)and pin(TREE,40)and pin(MANIFEST_SHA)and os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_ATTEMPT')=='1','false-gate-or-missing-pins');os.umask(0o077);OUT=DEPLOY if mode=='deploy'else VERIFY;OUT.mkdir(mode=0o700);initialize();signal.signal(signal.SIGTERM,lambda *_:need(False,'terminated'));result={'mode':mode,'base':BASE,'target':TARGET,'tree':TREE,'success':False,'businessWritesPerformed':False,'queueWritesPerformed':False,'historicalFailedJobsReplayedOrDeleted':False,'environmentFileModified':False,'globalMaintenanceChanged':False,'automaticDataOrSchemaRestorePerformed':False,'providerRequestsPerformed':False}
 try:before=P.archive();files=P.reviewed_files();{'deploy':deploy,'verify':verify}[mode](result,before,files)
 except BaseException:
  result.update(failedStage=STAGE,failedCheck=FAILED_CHECK or P.FAILED_CHECK or CORE.FAILED_CHECK or 'reviewed-library-or-system-error');private('failure-trace.private.txt',traceback.format_exc().encode())
  if mode=='deploy':
   try:recover_before_candidate(result)
   except BaseException:result['preCandidateRecoveryIncomplete']=True;private('recovery-failure-trace.private.txt',traceback.format_exc().encode())
 private('first-result.json',result);CORE.OPS.L.seal(OUT);need(len(enc(result))<=48000,'bounded-public-result');print(enc(dict(result,manifestSHA256=CORE.OPS.L.file_hash(OUT/'manifest.json'),resultSHA256=CORE.OPS.L.file_hash(OUT/'first-result.json'))).decode(),flush=True);return 0 if result['success']else 1
if __name__=='__main__':
 try:code=main()
 except BaseException:print('{"success":false,"safeFailure":"QC_PROVIDER_SCOPED_RELEASE_PREFLIGHT_FAILED"}',flush=True);code=1
 sys.exit(code)
