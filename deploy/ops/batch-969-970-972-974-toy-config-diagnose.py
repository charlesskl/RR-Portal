"""Fixed partial-release Toy configuration observation only. No repair or flag clearing."""
import copy,hashlib,importlib.util,json,os,pathlib,re,sys,traceback
ROOT=pathlib.Path('/opt/rr-portal');BRANCH='refs/heads/ops/batch-969-970-972-974-20261021';DIAG_PIN=False
RELEASE_SHA='2db18fac4f09a6dc4ae64c07fc248e9cd575ed5e06eebabc77de58e1584254e7'
FAILED=ROOT/'deploy/backups/batch-969-970-972-974-20261021-deploy-03';FAILED_MANIFEST='964efbf2e6f32bdd7355c00db59a8cd7d06e58c523fef31f4aa72ec2dfadd109';FAILED_RESULT='d280456999159e3dc7482fc8fdc4878deb63e11fd566e9e2c39f279689b4a98e'
OUT=ROOT/'deploy/backups/batch-969-970-972-974-20261021-toy-config-diagnose-01';R=None;STAGE='entrypoint';MISSING=object()

def need(value):
 if not value:raise RuntimeError('FIXED_TOY_CONFIG_DIAG_REJECTED')

def safe_value(value,key):
 if value is MISSING:return {'type':'missing'}
 if value is None or type(value)in(bool,int):return {'type':type(value).__name__,'value':value}
 enums={'','bind','volume','tmpfs','rprivate','rshared','rslave','private','shared','slave','rw','ro','cached','delegated','consistent','json-file','local','none','journald','syslog'}
 if type(value)is str and(key in{'Mode','Type','Propagation'}or key.endswith('Mode'))and value in enums:return {'type':'str','technicalEnum':value}
 return {'type':type(value).__name__,'sha256':R.sha(R.enc(value)),'length':len(value)if type(value)in(str,list,dict)else None}

def differences(old,new,path=()):
 if type(old)is type(new)and type(old)is dict:
  result=[]
  for key in sorted(set(old)|set(new)):need(type(key)is str and len(key)<=256);result.extend(differences(old.get(key,MISSING),new.get(key,MISSING),path+(key,)));need(len(result)<=512)
  return result
 if type(old)is type(new)and type(old)is list:
  result=[]
  for index in range(max(len(old),len(new))):result.extend(differences(old[index]if index<len(old)else MISSING,new[index]if index<len(new)else MISSING,path+(index,)));need(len(result)<=512)
  return result
 if old is not MISSING and new is not MISSING and type(old)is type(new)and old==new:return[]
 key=path[-1]if path and type(path[-1])is str else'';return [{'path':list(path),'before':safe_value(old,key),'after':safe_value(new,key)}]

def partial_evidence():
 need(R.observation_archive(FAILED)==FAILED_MANIFEST and R.CORE.OPS.L.file_hash(FAILED/'first-result.json')==FAILED_RESULT);receipt=R.read_json(FAILED/'first-result.json')
 need(receipt.get('mode')=='deploy'and receipt.get('success')is False and receipt.get('target')==R.TARGET and receipt.get('tree')==R.TREE and receipt.get('failedStage')=='toyqms-fixed-image-recreate'and receipt.get('failedCheck')=='complete-hostconfig-mounts'and receipt.get('maintenanceOrServiceSwitchesPerformed')is True)
 need(not receipt.get('oldContainerRestartedOnlyBeforeAnyCandidateAttempt')and not receipt.get('preCandidateOriginalContainerRecoveryIncomplete')and not(FAILED/'runtime-after.private.json').exists());return receipt

def guards(before,files):
 R.checked_source(R.TARGET,before,files);need(R.flags('toyqms')==[v for v in before['maintenanceInventory']if v['path']!='services/toyqms']);path=ROOT/'deploy/maintenance/services/toyqms';need(path.is_file()and not path.is_symlink()and path.read_bytes()==b'')

def observe(result):
 global STAGE
 STAGE='sealed-partial-and-reviewed-candidates';partial_evidence();before=R.original();files=R.source_manifest();prepared=R.prepared_evidence(before);expected=R.accepted_predeployment_runtime(before);old=R.read_json(R.BACKUP/'target-inspect.private.json')
 STAGE='private-current-runtime-before-comparison';current,raw=R.CORE.runtime();R.CORE.OPS.L.private_write(OUT/'current-runtime-and-target-inspects.private.json',R.enc({'runtime':current,'raw':raw}))
 values={'HostConfig':differences(old['toyqms']['HostConfig'],raw['toyqms']['HostConfig'],('HostConfig',)),'Mounts':differences(sorted(old['toyqms']['Mounts'],key=R.enc),sorted(raw['toyqms']['Mounts'],key=R.enc),('Mounts',))};R.CORE.OPS.L.private_write(OUT/'toy-hostconfig-mounts-safe-differences.private.json',R.enc(values));result.update(toyHostConfigAndMountsDifferenceRecords={k:v[:32]for k,v in values.items()},differenceCounts={k:len(v)for k,v in values.items()},allDifferencesIncludedInPublic=all(len(v)<=32 for v in values.values()));guards(before,files)
 need(current['others']==expected['others']and current['databaseContainer']==expected['databaseContainer']and current['qcReportWorker']==expected['qcReportWorker']and all(current['targets'][s]==expected['targets'][s]for s in('indo-shipping','internal-quote')))
 roots,mounts=R.CORE.storage_roots(raw);R.CORE.storage_contract(raw,current['databaseContainer']);proofs={}
 for service in('qc-report','toyqms'):
  row=current['targets'][service];need(row['id']!=expected['targets'][service]['id']and row['image']==prepared['candidateImageIDs'][service]and row['running']is True and row['health']=='healthy'and row['oom']is False and row['restarts']==0);need(R.pid_environment(row['id'])==R.read_json(R.BACKUP/(service+'-literal-process-environment.private.json')));proofs[service]=R.CORE.service_source_proof(service,row,R.TARGET);R.checked_proof(service,proofs[service],prepared['candidates'][service]['sourceProof'])
 R.CORE.OPS.L.private_write(OUT/'current-source-proof.private.json',R.enc(proofs));args=[*R.COMPOSE,'-f',str(FAILED/'runtime-images-and-literal-env.private.yml')];R.configuration_preserved(old['qc-report'],raw['qc-report'],args)
 # Isolate the already-rejected HostConfig/Mounts from all remaining strict Config checks.
 isolated=copy.deepcopy(raw['toyqms']);isolated['HostConfig']=old['toyqms']['HostConfig'];isolated['Mounts']=old['toyqms']['Mounts'];R.configuration_preserved(old['toyqms'],isolated,args)
 result.update(qcAndToySealedCandidatesHealthyAndSourceProven=True,bothConfiguredAndPID1EnvironmentPreserved=True,toyAllRemainingConfigurationFieldsPreserved=True,toyOwnMaintenanceStillOn=True,otherServicesWorkersAndAcceptedFactoryRuntimePreserved=True)
 STAGE='final-runtime-source-flags-and-seals';after,after_raw=R.CORE.runtime();R.CORE.OPS.L.private_write(OUT/'final-runtime-and-target-inspects.private.json',R.enc({'runtime':after,'raw':after_raw}));need(after==current);guards(before,files);partial_evidence();need(R.original()==before);R.prepared_evidence(before);R.accepted_predeployment_runtime(before);R.failed_prepare_evidence();R.failed_deploy_evidence();R.failed_deploy_02_evidence();result.update(success=True,diagnosisCompleteOnly=True,noHostConfigurationDifferenceAcceptedOrChanged=True,noMaintenanceFlagCleared=True)

def main():
 global R,STAGE
 need(DIAG_PIN and sys.argv[1:]==['diagnose']and os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_ATTEMPT')=='1');path=pathlib.Path(__file__).with_name('batch-release-library.py');need(path.is_file()and not path.is_symlink()and hashlib.sha256(path.read_bytes()).hexdigest()==RELEASE_SHA);spec=importlib.util.spec_from_file_location('reviewed_partial_release',path);R=importlib.util.module_from_spec(spec);spec.loader.exec_module(R);need(R.TARGET=='dfcdf751cae42fdd1731729dd662fce041c28caf'and R.TREE=='d5a107e898fe35066416fa0431ccd92400467875')
 os.umask(0o077);OUT.mkdir(mode=0o700);R.OUT=OUT;R.ENV=dict(os.environ);R.CORE=R.load_core();result={'mode':'diagnose','success':False,'target':R.TARGET,'tree':R.TREE,'containerOrServiceSignalsPerformed':False,'businessDatabaseMutationsOrHTTPPerformed':False,'environmentSourceDataOrMaintenanceModified':False}
 try:observe(result)
 except BaseException:result.update(success=False,failedStage=STAGE,safeFailure='FIXED_TOY_CONFIG_DIAG_REJECTED');R.CORE.OPS.L.private_write(OUT/'failure-traceback.private.txt',traceback.format_exc().encode())
 finally:
  R.CORE.OPS.L.private_write(OUT/'first-result.json',R.enc(result));R.CORE.OPS.L.seal(OUT);public=dict(result,manifestSHA256=R.CORE.OPS.L.file_hash(OUT/'manifest.json'),resultSHA256=R.CORE.OPS.L.file_hash(OUT/'first-result.json'));need(len(R.enc(public))<=24000);print(R.enc(public).decode(),flush=True)
 return 0 if result['success']else 1

if __name__=='__main__':
 try:code=main()
 except BaseException:print('{"success":false,"safeFailure":"FIXED_TOY_CONFIG_DIAG_PREFLIGHT_REJECTED"}',flush=True);code=1
 sys.exit(code)
