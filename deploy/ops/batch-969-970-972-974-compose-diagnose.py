"""Fixed sealed-compose comparison only; never execute release phases."""
import hashlib,importlib.util,json,os,pathlib,re,stat,sys,traceback
ROOT=pathlib.Path('/opt/rr-portal');BRANCH='refs/heads/ops/batch-969-970-972-974-20261021';DIAG_PIN=False
RELEASE_SHA='68e38c2f8837703a81cf101c68d1a13b5c4d5ad93d22fe7ce7904643d190e066'
TARGET='dfcdf751cae42fdd1731729dd662fce041c28caf';TREE='d5a107e898fe35066416fa0431ccd92400467875'
FAILED=ROOT/'deploy/backups/batch-969-970-972-974-20261021-prepare'
FAILED_MANIFEST='01e867075b6a446cb270042935e7a2b89f9d0c3e34fb93a386406603995e505e';FAILED_RESULT='2485b49ee36df66ef6a0452bc19b269f0dff3ae53970c3f44fb1bf06863d289d'
OUT=ROOT/'deploy/backups/batch-969-970-972-974-20261021-compose-diagnose-01';R=None;STAGE='entrypoint'

def need(value):
 if not value:raise RuntimeError('FIXED_COMPOSE_DIAG_REJECTED')

def differences(old,new,path=()):
 """Strict JSON types and paths only; values never enter diagnostic summaries."""
 if type(old)is not type(new):return [list(path)]
 if type(old)is dict:
  result=[]
  for key in sorted(set(old)|set(new)):
   need(type(key)is str and len(key)<=256)
   result.extend([list(path+(key,))]if key not in old or key not in new else differences(old[key],new[key],path+(key,)))
   need(len(result)<=512)
  return result
 if type(old)is list:
  result=[]
  for index in range(max(len(old),len(new))):
   result.extend([list(path+(index,))]if index>=len(old)or index>=len(new)else differences(old[index],new[index],path+(index,)))
   need(len(result)<=512)
  return result
 need(old is None or type(old)in(str,int,float,bool));return []if old==new else[list(path)]

def sealed_failure():
 need(R.observation_archive(FAILED)==FAILED_MANIFEST)
 need(R.CORE.OPS.L.file_hash(FAILED/'first-result.json')==FAILED_RESULT)
 receipt=R.read_json(FAILED/'first-result.json')
 need(receipt.get('success')is False and receipt.get('mode')=='prepare'and receipt.get('target')==TARGET and receipt.get('tree')==TREE)
 need(receipt.get('failedStage')=='prepare-fast-forward-reviewed-source'and receipt.get('failedCheck')=='base-compose-byte-semantics-unchanged')
 need(receipt.get('maintenanceOrServiceSwitchesPerformed')is False and not receipt.get('builds'))
 files=list(FAILED.glob('*-compose-base.stdout.private'));need(len(files)==1 and files[0].is_file()and not files[0].is_symlink())
 return R.read_json(files[0])

def observe(result):
 global STAGE
 STAGE='sealed-original-and-failure';before=R.original();files=R.source_manifest();failed=sealed_failure()
 STAGE='current-runtime-source-and-env-unchanged';R.runtime_stable(before['runtime'],before,files)
 backup=R.read_json(R.BACKUP/'compose-render.private.json')
 STAGE='render-without-release-environment-override'
 need(R.CORE.run(['docker','compose','version','--short']).decode().strip()=='5.1.0')
 # Inherit exactly the invocation environment, like original CORE.run; never inject TARGET.
 need(R.ENV==dict(os.environ))
 fresh=json.loads(R.private_capture([*R.COMPOSE,'config','--format','json'],'compose-inherited-environment',90))
 paths={'backupVersusFailed':differences(backup,failed),'backupVersusFreshInheritedEnvironment':differences(backup,fresh),'failedVersusFreshInheritedEnvironment':differences(failed,fresh)}
 R.CORE.OPS.L.private_write(OUT/'compose-path-comparison.private.json',R.enc(paths))
 expected={('services',s,'build','args','OCI_REVISION')for s in('factory-review','factory-review-test')}
 only_expected=set(map(tuple,paths['backupVersusFailed']))==expected and not paths['backupVersusFreshInheritedEnvironment'] and set(map(tuple,paths['failedVersusFreshInheritedEnvironment']))==expected
 if only_expected:
  only_expected=all(failed['services'][s]['build']['args']['OCI_REVISION']==TARGET for s in('factory-review','factory-review-test'))
 STAGE='final-runtime-source-env-flags-and-original-seals';R.runtime_stable(before['runtime'],before,files);need(R.original()==before);need(sealed_failure()==failed)
 result.update(success=True,diagnosisCompleteOnly=True,noReleasePhaseInvoked=True,protectedRuntimeSourceEnvironmentDirtyFilesAndFlagsUnchanged=True,failedPrepareFullSealPreserved=True,differencePaths=paths,freshInheritedComposeExactlyMatchesBackup=not paths['backupVersusFreshInheritedEnvironment'],consistentWithOnlyInjectedAfterCommitBuildArguments=only_expected)

def main():
 global R,STAGE
 need(DIAG_PIN and sys.argv[1:]==['diagnose']and os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_ATTEMPT')=='1')
 path=pathlib.Path(__file__).with_name('batch-release-library.py');need(path.is_file()and not path.is_symlink()and hashlib.sha256(path.read_bytes()).hexdigest()==RELEASE_SHA)
 spec=importlib.util.spec_from_file_location('sealed_release_readonly_library',path);R=importlib.util.module_from_spec(spec);spec.loader.exec_module(R)
 need(R.TARGET==TARGET and R.TREE==TREE and R.CORE_SHA=='4745c90f126cf46106b0f170a3ebc6b24ccb64c0e963e427d13308d5cb5b54f5')
 os.umask(0o077);OUT.mkdir(mode=0o700);R.OUT=OUT;R.ENV=dict(os.environ);R.CORE=R.load_core()
 result={'mode':'diagnose','success':False,'target':TARGET,'tree':TREE,'businessWritesPerformed':False,'containerOrServiceSignalsPerformed':False,'liveHTTPOrAuthenticationRequestsPerformed':False,'environmentOrMaintenanceModified':False,'secretOrBusinessValuesPrinted':False}
 try:observe(result)
 except BaseException:
  result.update(failedStage=STAGE,safeFailure='FIXED_COMPOSE_DIAG_REJECTED');R.CORE.OPS.L.private_write(OUT/'failure-traceback.private.txt',traceback.format_exc().encode())
 finally:
  R.CORE.OPS.L.private_write(OUT/'first-result.json',R.enc(result));R.CORE.OPS.L.seal(OUT);public=dict(result,manifestSHA256=R.CORE.OPS.L.file_hash(OUT/'manifest.json'),resultSHA256=R.CORE.OPS.L.file_hash(OUT/'first-result.json'));need(len(R.enc(public))<=24000);print(R.enc(public).decode(),flush=True)
 return 0 if result['success']else 1

if __name__=='__main__':
 try:code=main()
 except BaseException:print('{"success":false,"safeFailure":"FIXED_COMPOSE_DIAG_PREFLIGHT_REJECTED"}',flush=True);code=1
 sys.exit(code)
