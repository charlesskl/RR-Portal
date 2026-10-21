"""Only Indo/Quote immutable continuation and sealed all-four verification. Default false."""
import copy,hashlib,importlib.util,json,os,pathlib,re,signal,sys,time,traceback
ROOT=pathlib.Path('/opt/rr-portal');BRANCH='refs/heads/ops/batch-969-970-972-974-20261021';CONTINUE_PIN=True;VERIFY_PIN=False
TARGET='dfcdf751cae42fdd1731729dd662fce041c28caf';TREE='d5a107e898fe35066416fa0431ccd92400467875'
RELEASE_SHA='2db18fac4f09a6dc4ae64c07fc248e9cd575ed5e06eebabc77de58e1584254e7';HOST_SHA='bd1842dc6847f3e0e5c0c38374c3604791f66d1c94dc651457607dc338f38ff1'
FAILED=ROOT/'deploy/backups/batch-969-970-972-974-20261021-deploy-03';FAILED_MANIFEST='964efbf2e6f32bdd7355c00db59a8cd7d06e58c523fef31f4aa72ec2dfadd109';FAILED_RESULT='d280456999159e3dc7482fc8fdc4878deb63e11fd566e9e2c39f279689b4a98e'
RESTORED=ROOT/'deploy/backups/batch-969-970-972-974-20261021-toy-restore-01';RESTORED_MANIFEST='931e6d491d7533226c8bfbcade43ea873bcfe47900c45e193c5ee91f75a35461';RESTORED_RESULT='cf2e68e76cf3a8d99c232edd178e8fe982f37ab414ad707fb567353282619b8b'
CONTINUED=ROOT/'deploy/backups/batch-969-970-972-974-20261021-continue-01';CONTINUED_MANIFEST='';CONTINUED_RESULT=''
VERIFIED=ROOT/'deploy/backups/batch-969-970-972-974-20261021-verify-01';REMAINING=('indo-shipping','internal-quote');COMPLETED=('qc-report','toyqms')
R=None;H=None;OUT=None;STAGE='entrypoint';ORIGINAL_CONFIGURATION_PRESERVED=None;LOCAL_FAILED_CHECK=None

def need(value,label='continuation-invariant'):
 global LOCAL_FAILED_CHECK
 if not value:
  LOCAL_FAILED_CHECK=label if type(label)is str and re.fullmatch('[A-Za-z0-9_.-]{1,100}',label)else'continuation-invariant';raise RuntimeError(LOCAL_FAILED_CHECK)

def enc(v):return json.dumps(v,ensure_ascii=True,sort_keys=True,separators=(',',':'),allow_nan=False).encode()

def load(name,checksum):
 path=pathlib.Path(__file__).with_name(name);need(path.is_file()and not path.is_symlink()and hashlib.sha256(path.read_bytes()).hexdigest()==checksum,'pinned-library');spec=importlib.util.spec_from_file_location(name.replace('.','_'),path);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m

def partial_evidence():
 need(R.observation_archive(FAILED)==FAILED_MANIFEST and R.CORE.OPS.L.file_hash(FAILED/'first-result.json')==FAILED_RESULT,'complete-partial-release-seal');value=R.read_json(FAILED/'first-result.json');need(value.get('mode')=='deploy'and value.get('target')==TARGET and value.get('tree')==TREE and value.get('success')is False and value.get('failedStage')=='toyqms-fixed-image-recreate'and value.get('failedCheck')=='complete-hostconfig-mounts'and value.get('maintenanceOrServiceSwitchesPerformed')is True,'exact-partial-release-failure');return value

def restored_evidence(before,prepared):
 receipt=R.archive(RESTORED,RESTORED_MANIFEST,RESTORED_RESULT);need(receipt.get('mode')=='restore-toy'and receipt.get('target')==TARGET and receipt.get('tree')==TREE,'restored-target-binding')
 for key in('restoredToyEntryOnly','knownDockerDefaultDNSRepresentationOnly','allTypedToyRowsSchemaFilesAndOwnersPreserved','completeConfigurationAndPID1EnvironmentPreserved','qcAndToyNotRecreated','remainingIndoAndQuoteNotSwitched'):need(receipt.get(key)is True,'complete-toy-restoration')
 for key in('oldContainerRestartedOrRolledBack','containerRecreationOrServiceSignalsPerformed','businessAPIMutationsOrDatabaseWritesPerformed','sourceOrEnvironmentModified'):need(receipt.get(key)is False,'toy-restoration-no-other-mutations')
 current=R.read_json(RESTORED/'runtime-after.private.json');wanted=R.accepted_predeployment_runtime(before)
 for service in COMPLETED:
  row=current['targets'][service];need(row['id']!=wanted['targets'][service]['id']and row['image']==prepared['candidateImageIDs'][service]and row['running']is True and row['health']=='healthy'and row['oom']is False and row['restarts']==0,'only-completed-reviewed-candidates');wanted['targets'][service]=copy.deepcopy(row)
 need(enc(current)==enc(wanted),'restoration-runtime-only-qc-toy-replaced');return current

def pre_switch(service):
 need(service in R.ORDER,'fixed-pre-switch-service');base=FAILED if service in COMPLETED else CONTINUED;directory=base/('pre-switch-'+service);R.observation_archive(directory);value=R.read_json(directory/'observed.private.json');need(set(value['storage'])=={k for k,spec in R.CORE.STORAGE.items()if spec[0]==service},'exact-service-pre-switch-store');need((value['postgres']is None)==(service in COMPLETED),'correct-pre-switch-postgres-scope');R.closed_audits(directory,value['storage']);return value

def configuration_for(service,old,actual):
 need(service in R.ORDER and actual['Config']['Labels'].get('com.docker.compose.service')==service,'fixed-config-service');need(H.same_host_config(old['HostConfig'],actual['HostConfig']),'complete-hostconfig-except-empty-dns-representation');shadow=copy.deepcopy(actual);shadow['HostConfig']=copy.deepcopy(old['HostConfig']);base=FAILED if service in COMPLETED else CONTINUED;saved=R.DEPLOY;R.DEPLOY=base
 try:ORIGINAL_CONFIGURATION_PRESERVED(old,shadow,[*R.COMPOSE,'-f',str(base/'runtime-images-and-literal-env.private.yml')])
 finally:R.DEPLOY=saved
 return True

def all_running_proofs(current,raw,before,prepared):
 old=R.read_json(R.BACKUP/'target-inspect.private.json');proof={}
 for service in R.ORDER:
  need(current['targets'][service]['image']==prepared['candidateImageIDs'][service],'running-sealed-image');configuration_for(service,old[service],raw[service]);need(R.pid_environment(current['targets'][service]['id'])==R.read_json(R.BACKUP/(service+'-literal-process-environment.private.json')),'full-pid1-environment');proof[service]=R.CORE.service_source_proof(service,current['targets'][service],TARGET);R.checked_proof(service,proof[service],prepared['candidates'][service]['sourceProof'])
 return proof

def continue_remaining(result,before,prepared,files):
 global STAGE
 STAGE='sealed-partial-and-toy-restoration';partial_evidence();expected=restored_evidence(before,prepared);current,raw,roots=R.runtime_stable(expected,before,files);preswitch={service:pre_switch(service)for service in COMPLETED};old=R.read_json(R.BACKUP/'target-inspect.private.json');proof={};public={}
 for service in COMPLETED:
  configuration_for(service,old[service],raw[service]);need(R.pid_environment(current['targets'][service]['id'])==R.read_json(R.BACKUP/(service+'-literal-process-environment.private.json')),'completed-pid1-env');proof[service]=R.CORE.service_source_proof(service,current['targets'][service],TARGET);R.checked_proof(service,proof[service],prepared['candidates'][service]['sourceProof'])
 args,declared,literals=R.overlay(before,prepared['candidateImageIDs']);need(R.DEPLOY==CONTINUED,'remaining-fixed-overlay-directory')
 for service in REMAINING:
  image=R.read_json(R.PREPARE/(service+'-candidate-image.private.json'));facts=R.candidate_facts(service,image,raw[service],declared['services'][service],literals[service]);need(facts==prepared['candidates'][service],'remaining-candidate-all-guards-before-maintenance')
 for service in REMAINING:
  STAGE=service+'-fresh-startup-guards';current,live,roots=R.fresh_startup(service,expected,before,files);R.maintenance('require_maintenance_cleared',service);other_flags=R.flags(service);STAGE=service+'-maintenance-and-graceful-stop';result['maintenanceOrServiceSwitchesPerformed']=True;cid=expected['targets'][service]['id'];R.DRAIN={'service':service,'id':cid,'image':expected['targets'][service]['image'],'candidateAttempted':False,'expected':copy.deepcopy(expected),'before':before,'files':files,'raw':live[service]};R.maintenance('maintenance_on',service);need(R.flags(service)==other_flags,'only-own-maintenance-added');running=R.raw_inventory();cid=expected['targets'][service]['id'];need(running[cid]['Running']is True,'remaining-original-running');R.operation(['docker','stop','--time','30',cid],'graceful-stop-'+service,45);stopped=R.raw_inventory();wanted=copy.deepcopy(running);wanted[cid]['Running']=False;need(stopped==wanted,'only-selected-remaining-web-stopped')
  STAGE=service+'-wal-aware-and-postgres-pre-switch';selected={k:p for k,p in roots.items()if R.CORE.STORAGE[k][0]==service};preswitch[service]=R.storage_snapshot('pre-switch-'+service,selected,current['databaseContainer'],True);need(R.raw_inventory()==stopped and R.flags(service)==other_flags,'stable-during-pre-switch-capture');STAGE=service+'-fixed-candidate-recreate';R.DRAIN['candidateAttempted']=True;R.operation([*args,'up','-d','--force-recreate','--no-build','--pull','never','--no-deps',service],'recreate-'+service,180);started=time.monotonic();R.maintenance('wait_service_ready',service);after,inspects=R.CORE.runtime();R.CORE.OPS.L.private_write(OUT/(service+'-post-create-inspects.private.json'),enc({'runtime':after,'rawTargetInspects':inspects}));need(after['others']==expected['others']and after['databaseContainer']==expected['databaseContainer']and after['qcReportWorker']==expected['qcReportWorker']and all(after['targets'][s]==expected['targets'][s]for s in R.ORDER if s!=service),'all-other-runtime-including-qc-toy-unchanged');row=after['targets'][service];need(row['id']!=cid and row['image']==prepared['candidateImageIDs'][service]and row['restarts']==0,'new-exact-remaining-candidate');configuration_for(service,old[service],inspects[service]);need(R.pid_environment(row['id'])==R.read_json(R.BACKUP/(service+'-literal-process-environment.private.json')),'remaining-pid1-literal-env');proof[service]=R.CORE.service_source_proof(service,row,TARGET);R.checked_proof(service,proof[service],prepared['candidates'][service]['sourceProof']);time.sleep(max(0,10-(time.monotonic()-started)));R.runtime_stable(after,before,files,service);STAGE=service+'-clear-only-own-maintenance';R.maintenance('maintenance_off',service);R.maintenance('require_maintenance_cleared',service);need(R.flags()==before['maintenanceInventory'],'all-flags-restored')
  try:public[service]={'health':R.health(service),'assets':R.public_assets(service,proof[service])}
  except BaseException:R.maintenance('maintenance_on',service);raise
  expected=after;R.DRAIN=None
 STAGE='all-four-final-source-env-and-public-proof';current,raw,roots=R.runtime_stable(expected,before,files);proof=all_running_proofs(current,raw,before,prepared)
 for service in COMPLETED:public[service]={'health':R.health(service),'assets':R.public_assets(service,proof[service])}
 partial_evidence();restored_evidence(before,prepared);R.original();R.CORE.OPS.L.private_write(OUT/'runtime-after.private.json',enc(current));R.CORE.OPS.L.private_write(OUT/'pre-switch-storage.private.json',enc(preswitch));R.CORE.OPS.L.private_write(OUT/'source-proof.private.json',enc(proof));result.update(success=True,allFourServicesUseSealedCandidateImages=True,qcAndToyNeverRecreatedByContinuation=True,onlyIndoAndQuoteSwitched=True,allOtherServicesWorkersAndEnvironmentPreserved=True,allMaintenanceFlagsRestored=True,knownPreDeploymentUnrelatedRestartObserved=True,emptyDNSRepresentationSemanticComparisonOnly=True,publicReadOnlyProof=public)

def verify_all(result,before,prepared,files):
 global STAGE
 STAGE='sealed-complete-continuation';receipt=R.archive(CONTINUED,CONTINUED_MANIFEST,CONTINUED_RESULT);need(receipt.get('mode')=='continue'and receipt.get('target')==TARGET and receipt.get('tree')==TREE and receipt.get('allFourServicesUseSealedCandidateImages')is True and receipt.get('allMaintenanceFlagsRestored')is True,'complete-continuation-receipt');partial_evidence();restored_evidence(before,prepared);expected=R.read_json(CONTINUED/'runtime-after.private.json');current,raw,roots=R.runtime_stable(expected,before,files);directory=OUT/'observation';directory.mkdir(mode=0o700);saved=R.CORE.OUT;R.CORE.OUT=directory
 try:
  STAGE='raw-full-observation-before-comparison';storage=R.release_storage(roots);postgres=R.CORE.postgres_capture(current['databaseContainer'],directory,True);R.CORE.OPS.L.private_write(directory/'target-inspect.private.json',enc(raw));R.CORE.OPS.L.private_write(directory/'observed.private.json',enc({'storage':storage,'postgres':postgres,'runtime':current}));R.CORE.OPS.L.seal(directory)
 finally:R.CORE.OUT=saved
 seal=R.observation_archive(directory);result.update(rawObservationSealedBeforeComparison=True,observationManifestSHA256=seal);R.closed_audits(directory,storage);STAGE='all-four-source-and-per-service-config';proof=all_running_proofs(current,raw,before,prepared);R.CORE.OPS.L.private_write(OUT/'observed-source-proof.private.json',enc(proof));aggregate=R.read_json(CONTINUED/'pre-switch-storage.private.json');checks={};differences={};details={}
 for service in R.ORDER:
  previous=pre_switch(service);need(enc(previous)==enc(aggregate[service]),'pre-switch-aggregate-source-binding');checks[service+'.candidateImage']=current['targets'][service]['image']==prepared['candidateImageIDs'][service]
  for key in previous['storage']:
   differences[key]=R.compare_storage(before['storage'][key],previous['storage'][key]);checks.update({key+'.'+n:v for n,v in R.compare_storage(previous['storage'][key],storage[key]).items()})
  if service in REMAINING:
   schema='indo_shipping'if service=='indo-shipping'else'internal_quote';old=previous['postgres'][schema];new=postgres[schema];differences[schema]={'allTablesTypedExact':before['postgres'][schema]['tables']==old['tables'],'allSchemaExact':before['postgres'][schema]['schema']==old['schema'],'allSequencesExact':before['postgres'][schema]['sequenceStates']==old['sequenceStates']};checks[schema+'.allTablesTypedExact']=old['tables']==new['tables'];checks[schema+'.allSchemaExact']=old['schema']==new['schema']
   if schema=='internal_quote':checks[schema+'.onlyExactKnownStartupSequenceConsumption'],details['quoteSequence']=R.quote_sequence_check(old,new)
   else:checks[schema+'.allSequenceValuesExact']=old['sequenceStates']==new['sequenceStates']and old['sequenceStateStableDuringCapture']is True and new['sequenceStateStableDuringCapture']is True
  R.health(service);R.public_assets(service,proof[service])
 STAGE='final-seals-source-runtime';need(R.observation_archive(directory)==seal,'observation-unchanged');R.runtime_stable(current,before,files);partial_evidence();restored_evidence(before,prepared);R.archive(CONTINUED,CONTINUED_MANIFEST,CONTINUED_RESULT);R.original();R.CORE.OPS.L.private_write(OUT/'comparison.private.json',enc({'checks':checks,'preBackupToPreSwitch':differences,'details':details}));passed=sum(v is True for v in checks.values());result.update(success=passed==len(checks),checks=checks,passedChecks=passed,totalChecks=len(checks),failedCheckNames=[k for k,v in checks.items()if v is not True],preBackupToPreSwitchDifferences=differences,quoteSequenceComparison=details.get('quoteSequence'),unexpectedDifferencesNotAutomaticallyAttributedOrRestored=True,knownPreDeploymentUnrelatedRestartObserved=True,allRuntimeSourceEnvironmentAndWorkerGuardsPassed=True)

def main():
 global R,H,OUT,STAGE,ORIGINAL_CONFIGURATION_PRESERVED
 need(len(sys.argv)==2 and sys.argv[1]in{'continue','verify'},'fixed-mode');mode=sys.argv[1];need({'continue':CONTINUE_PIN,'verify':VERIFY_PIN}[mode],'false-draft');need(os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_ATTEMPT')=='1','fixed-branch-first-attempt');R=load('batch-release-library.py',RELEASE_SHA);H=load('batch-host-config-library.py',HOST_SHA);need(R.TARGET==TARGET and R.TREE==TREE and R.CORE_SHA=='4745c90f126cf46106b0f170a3ebc6b24ccb64c0e963e427d13308d5cb5b54f5'and R.pin(RESTORED_MANIFEST)and R.pin(RESTORED_RESULT)and(mode!='verify'or R.pin(CONTINUED_MANIFEST)and R.pin(CONTINUED_RESULT)),'exact-library-and-archive-pins');os.umask(0o077);OUT=CONTINUED if mode=='continue'else VERIFIED;OUT.mkdir(mode=0o700);R.OUT=OUT;R.DEPLOY=CONTINUED;R.ENV=dict(os.environ,MAINT_FLAG_DIR=str(ROOT/'deploy/maintenance'),COMPOSE_FILE=str(ROOT/'docker-compose.cloud.yml'),ENV_FILE=str(ROOT/'.env.cloud.production'),COMPOSE_PROJECT_NAME='rr-portal',MAINT_COMPOSE_SERVICES='\n'.join(REMAINING),MAINT_HEALTH_TIMEOUT_SECONDS='300',MAINT_DNS_GRACE_SECONDS='10');R.CORE=R.load_core();signal.signal(signal.SIGTERM,lambda *_:R.need(False,'termination-signal'));ORIGINAL_CONFIGURATION_PRESERVED=R.configuration_preserved;result={'mode':mode,'target':TARGET,'tree':TREE,'success':False,'maintenanceOrServiceSwitchesPerformed':False,'qcOrToyContainerRecreated':False,'businessAPIMutationsOrDatabaseWritesPerformed':False,'sourceOrEnvironmentModified':False,'automaticSchemaDataRollbackPerformed':False}
 try:before=R.original();prepared=R.prepared_evidence(before);files=R.source_manifest();R.failed_prepare_evidence();R.failed_deploy_evidence();R.failed_deploy_02_evidence();{'continue':continue_remaining,'verify':verify_all}[mode](result,before,prepared,files)
 except BaseException:
  result.update(failedStage=STAGE,failedCheck=LOCAL_FAILED_CHECK or R.FAILED_CHECK or'continuation-invariant');R.CORE.OPS.L.private_write(OUT/'failure-traceback.private.txt',traceback.format_exc().encode())
  if mode=='continue':
   try:R.recover_before_candidate(result)
   except BaseException:result['preCandidateOriginalContainerRecoveryIncomplete']=True;R.CORE.OPS.L.private_write(OUT/'pre-candidate-recovery-failure.private.txt',traceback.format_exc().encode())
 finally:R.CORE.OPS.L.private_write(OUT/'first-result.json',enc(result));R.CORE.OPS.L.seal(OUT);public=dict(result,manifestSHA256=R.CORE.OPS.L.file_hash(OUT/'manifest.json'),resultSHA256=R.CORE.OPS.L.file_hash(OUT/'first-result.json'));need(len(enc(public))<32000,'bounded-public-receipt');print(enc(public).decode(),flush=True)
 return 0 if result['success']else 1
if __name__=='__main__':
 try:code=main()
 except BaseException:print('{"success":false,"safeFailure":"FIXED_CONTINUATION_PREFLIGHT_REJECTED"}');code=1
 sys.exit(code)
