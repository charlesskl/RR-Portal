"""PR973 fixed initial-preflight read-only diagnosis; disabled until independent review."""
import hashlib,importlib.util,json,os,pathlib,re,subprocess,sys,traceback
ROOT=pathlib.Path('/opt/rr-portal');OUT=ROOT/'deploy/backups/factory-review-973-20261021-diagnose-01';PIN=True
BRANCH='refs/heads/ops/factory-review-973-20261021';RELEASE_SHA='8c7f870eddbdadb093c50761ba177d63b2cd37a3eab9a5a1b240efa18f010b3e'
FAILED=ROOT/'deploy/backups/factory-review-973-20261021-deploy';FAILED_MANIFEST='3b9d2093460313baac6c15144d614a8208608bec556578dcbdf8c8111f97fc12';FAILED_RESULT='680bc74dafc5df496139077db726720c0444938130c296ebd756b1f0eaf3ac41'
ALLOWED_ERRORS={'RuntimeError','ValueError','TypeError','KeyError','OSError','OperationalError','TimeoutExpired','FileNotFoundError','PermissionError'}
R=None;CORE=None

def need(value):
 if not value:raise RuntimeError('FACTORY_REVIEW_973_DIAGNOSE_REJECTED')
def enc(value):return json.dumps(value,sort_keys=True,ensure_ascii=True,separators=(',',':'),allow_nan=False).encode()
def sha(value):return hashlib.sha256(value).hexdigest()
def error_type(error):return type(error).__name__ if type(error).__name__ in ALLOWED_ERRORS else'Other'
def private(name,value):CORE.OPS.L.private_write(OUT/name,value if type(value)is bytes else enc(value))
def attempt(callback):
 try:return {'completed':True,'value':callback()}
 except Exception as error:return {'completed':False,'exceptionType':error_type(error)}
def evidence():
 old=R.original();need(R.observation_archive(FAILED)==FAILED_MANIFEST and CORE.OPS.L.file_hash(FAILED/'first-result.json')==FAILED_RESULT);failed=json.loads((FAILED/'first-result.json').read_bytes());need(failed.get('success')is False and failed.get('failedStage')=='initial-runtime-and-source'and failed.get('target')==R.TARGET);return old

def frames(blob):
 text=blob.decode('utf-8','replace');found=[]
 for filename,line,function in re.findall(r'^  File "([^"]+)", line ([0-9]+), in ([A-Za-z_][A-Za-z_0-9]*|<module>)$',text,re.M):
  name=pathlib.PurePath(filename).name
  if re.fullmatch('[A-Za-z0-9_.-]{1,100}',name):found.append({'fileBasename':name,'line':int(line),'function':function})
 last=text.rstrip().splitlines()[-1].split(':',1)[0]if text.strip()else'';return {'frames':found[-20:],'exceptionType':last if last in ALLOWED_ERRORS else'Other'}

def runtime_differences(old,current):
 result={};fields={'id','image','started','running','oom','restarts','health','environmentMapSHA256','mounts','memory','swap','healthcheck','command','entrypoint','user','workingDirectory','configSHA256','hostConfigSHA256','processEnvironmentWithoutAutomaticHostnameSHA256'}
 for scope in ('targets','others'):
  rows=[]
  for key in sorted(set(old[scope])|set(current[scope])):
   a,b=old[scope].get(key),current[scope].get(key)
   if a==b:continue
   changed=['presence']if a is None or b is None else sorted(k for k in set(a)|set(b)if a.get(k)!=b.get(k));need(set(changed)<=fields|{'presence'});rows.append({'identity':key if scope=='targets'and key in CORE.SERVICES else sha(key.encode())[:16],'changedFieldNames':changed,'beforeSHA256':sha(enc(a)),'afterSHA256':sha(enc(b))})
  result[scope]=rows
 return result

def observe(result):
 before=evidence();private('failure-frames.private.json',frames((FAILED/'failure-traceback.private.txt').read_bytes()));result['originalFailure']=frames((FAILED/'failure-traceback.private.txt').read_bytes());head=CORE.run(['git','rev-parse','HEAD']).decode().strip();need(re.fullmatch('[a-f0-9]{40}',head));result['observedMainHead']=head;result['mainHeadMatchesBackup']=head==before['head']
 with (OUT/'target-object-check-stderr.private').open('xb')as errors:p=subprocess.run(['git','cat-file','-e',R.TARGET+'^{commit}'],stdout=subprocess.PIPE,stderr=errors,cwd=ROOT,timeout=15)
 need(p.returncode in(0,1,128)and not p.stdout);result['mergedTargetObjectPresentBeforeAnyFetch']=p.returncode==0
 observed=attempt(CORE.runtime);result['runtimeReadCompleted']=observed['completed']
 if observed['completed']:
  current,raw=observed['value'];private('current-runtime.private.json',current);private('current-target-inspect.private.json',raw);result['runtimeExactlyMatchesBackup']=current==before['runtime'];result['runtimeDifferences']=runtime_differences(before['runtime'],current);checks={}
  for service,row in raw.items():
   env=CORE.envmap(row['Config']['Env']);email=env.get('FACTORY_REVIEW_ADMIN_EMAIL','').strip();values={'bootstrapEmailPresent':bool(email),'configuredPasswordMeetsExistingMinimumLength':len(env.get('FACTORY_REVIEW_ADMIN_PASSWORD',''))>=12};query=attempt(lambda:bootstrap_count(service,email));values['readOnlyExistingUserQueryCompleted']=query['completed'];values['configuredBootstrapUserAlreadyExistsExactlyOnce']=query.get('value')==1 if query['completed']else False;checks[service]=values
  result['bootstrapReadOnlyChecks']=checks
 else:result['runtimeFailureExceptionType']=observed['exceptionType']
 for name,callback in {'maintenanceInventoryMatchesBackup':lambda:R.flags()==before['maintenanceInventory'],'sourceBaselineConfigurationMatchesBackup':lambda:CORE.source()==before['configuration'],'fourPreexistingDirtyFilesMatchBackup':lambda:CORE.dirty_snapshot()==before['preexistingFourDirty'],'environmentFileBytesMatchBackup':lambda:CORE.OPS.L.file_hash(ROOT/'.env.cloud.production')==before['environmentSHA256'],'environmentFileModeAndOwnerMatchBackup':lambda:CORE.file_metadata(ROOT/'.env.cloud.production')==before['environmentFileMetadata']}.items():result[name]=attempt(callback)
 need(evidence()==before);result.update(originalBackupAndFailedDeployFullSealsStillMatch=True,diagnosticComplete=True,success=True)

def bootstrap_count(service,email):
 import contextlib
 need(service in CORE.SERVICES)
 with contextlib.closing(CORE.OPS.L.connect(CORE.APP/CORE.SERVICES[service]/'data.db'))as db:return db.execute('SELECT count(*) FROM users WHERE email=?',(email,)).fetchone()[0]

def main():
 global R,CORE
 need(len(sys.argv)==2 and sys.argv[1]=='diagnose'and PIN and os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_ATTEMPT')=='1');os.umask(0o077);path=pathlib.Path(__file__).with_name('factory-release-library.py');need(path.is_file()and not path.is_symlink()and sha(path.read_bytes())==RELEASE_SHA);spec=importlib.util.spec_from_file_location('factory973_pinned_release_readonly',path);R=importlib.util.module_from_spec(spec);spec.loader.exec_module(R);R.OUT=OUT;CORE=R.core_load();CORE.OUT=OUT;CORE.OPS=CORE.load('release-data-ops-library.py');CORE.OPS.L=CORE.OPS.load_library(pathlib.Path(__file__).with_name('release-data-library.py'));CORE.OPS.run=CORE.run;R.CORE=CORE;OUT.mkdir(mode=0o700);result={'mode':'diagnose','success':False,'diagnosticComplete':False,'businessOrProductionConfigurationWritesPerformed':False,'sourceFetchCheckoutBuildOrContainerActionsPerformed':False,'businessHTTPOrLoginPerformed':False,'maintenanceFlagsChanged':False,'secretsOrBusinessRowsPrinted':False}
 try:observe(result)
 except BaseException as error:result['safeFailureExceptionType']=error_type(error);private('diagnostic-failure-traceback.private.txt',traceback.format_exc().encode())
 finally:private('first-result.json',result);CORE.OPS.L.seal(OUT);need(len(enc(result))<24000);print(enc(dict(result,manifestSHA256=CORE.OPS.L.file_hash(OUT/'manifest.json'),resultSHA256=CORE.OPS.L.file_hash(OUT/'first-result.json'))).decode(),flush=True)
 return 0 if result['success']else 1
if __name__=='__main__':
 try:sys.exit(main())
 except Exception:print('{"success":false,"safeFailure":"FACTORY_REVIEW_973_DIAGNOSE_PREFLIGHT_REJECTED"}',flush=True);sys.exit(1)
