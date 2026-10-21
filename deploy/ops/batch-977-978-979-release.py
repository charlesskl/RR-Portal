"""Resume only Indo after the sealed four-container success/Indo guard rejection.
Local review draft. Both gates false; actual constraint facts are still required.
Never rebuild or recreate the four completed containers, restore data, or call AI.
"""
import contextlib,copy,datetime,hashlib,importlib.util,json,os,pathlib,re,signal,stat,sys,time,traceback
ROOT=pathlib.Path('/opt/rr-portal');BRANCH='refs/heads/ops/batch-977-978-979-20261021'
BASE='b4c3763fe43e30c80c041c70e7a9f0750145d7b0';TARGET='9b890cc016da403f929f8a7aaeddb878d3de24c5';TREE='e322834bbbd43082854d8c564192c3ca1e097534'
DEPLOY_PIN=False;VERIFY_PIN=False
RELEASE_SHA='c62a155b2b3b94c69f33f9f4d9aab4650b31747eea07243e486e9855b77127ac'
FAILED=ROOT/'deploy/backups/batch-977-978-979-20261021-deploy';FAILED_MANIFEST='afd8656605cfa5c92acf1bd787262140599cc2efa6c0750161f46995b76c1a26';FAILED_RESULT='bbc4f7be2f9a991c3fee22653a41bf5cb91f0d75d9804e554c02882d02e7a118'
RESUMED=FAILED.with_name('batch-977-978-979-20261021-resume');VERIFIED=FAILED.with_name('batch-977-978-979-20261021-verify-resumed');RESUMED_MANIFEST='';RESUMED_RESULT=''
COMPLETED=('factory-review-test','factory-review','qc-report','qc-report-worker');GROUPS={'factory-review-test':('factory-review-test',),'factory-review':('factory-review',),'qc-report':('qc-report-data','qc-report-storage')}
INDO_FACT_FLAGS=None;INDO_FACT_FLAGS_SHA='514daadacaa8b134e5c317e7a8120f239e4f80b8eee1586c624b18aec4bbd579'
INDO_FACT_FILE_SHA='adb7d9a60bff52d1b203ded3233a330375c4eddfb52336418313d696cad0eb74'
OUT=None;R=None;STAGE='entry';FAILED_CHECK=None
def need(value,label):
 global FAILED_CHECK
 if not value:FAILED_CHECK=label;raise RuntimeError('BATCH_977_979_RESUME_REJECTED')
def enc(value):return json.dumps(value,sort_keys=True,ensure_ascii=True,separators=(',',':'),allow_nan=False).encode()
def sha(value):return hashlib.sha256(value).hexdigest()
def read(path):return json.loads(path.read_bytes())
def private(name,value):R.private(name,value)
def initialize():
 global R
 path=pathlib.Path(__file__).with_name('batch-release-library.py');need(path.is_file()and not path.is_symlink()and sha(path.read_bytes())==RELEASE_SHA,'fixed-false-release-library');spec=importlib.util.spec_from_file_location('reviewed_batch_partial_release',path);R=importlib.util.module_from_spec(spec);spec.loader.exec_module(R);need(R.PREPARE_PIN is False and R.DEPLOY_PIN is False and R.VERIFY_PIN is False,'import-only-frozen-false-library');R.TARGET=TARGET;R.TREE=TREE;R.OUT=OUT;R.BACKUP_MANIFEST='53ca11e474b8691a4e0ba6645938f64d5179b03693cb7fdff1f62fd1d720c4a3';R.BACKUP_RESULT='d994105360343894922ed3052dac1dd5bf2cd942206f02c5644813003b048802';R.PREPARE_MANIFEST='30f76a7b7832c31491c3353750658409fcad45ee4556ebaba8055f58dd7986d8';R.PREPARE_RESULT='e46732d9424a132508521d618a76f793b798509b6d6b9339087e04885af2f79e';R.SOURCE_MANIFEST_SHA='5a8d788ec323972c7f690e7e2823b186280d3017033302f6984fa16aa35b38ae';R.initialize();R.ENV['MAINT_COMPOSE_SERVICES']='indo-shipping';load_facts()
def load_facts():
 global INDO_FACT_FLAGS
 path=pathlib.Path(__file__).with_name('batch-977-978-979-indo-facts.json');need(path.is_file()and not path.is_symlink()and sha(path.read_bytes())==INDO_FACT_FILE_SHA,'exact-independent-indo-facts-manifest');facts=read(path);need(facts.get('schema')=='indo_shipping'and facts.get('table')=='po_receipts'and facts.get('failedArchiveManifestSHA256')==FAILED_MANIFEST and facts.get('failedArchiveResultSHA256')==FAILED_RESULT and facts.get('closedGroupCheckCounts')=={'factory-review-test':5,'factory-review':5,'qc-report':6},'actual-facts-bound-to-sealed-partial-deploy');INDO_FACT_FLAGS=facts['constraintFlags'];facts_ready()
@contextlib.contextmanager
def scope(name):
 directory=OUT/name;directory.mkdir(mode=0o700);modules=(R,R.CORE,R.CORE.Q,R.CORE.F);old=[m.OUT for m in modules]
 for module in modules:module.OUT=directory
 try:yield directory
 finally:
  try:R.CORE.OPS.L.seal(directory)
  finally:
   for module,path in zip(modules,old):module.OUT=path
def observation_archive(path):
 need(path.is_dir()and not path.is_symlink()and stat.S_IMODE(path.stat().st_mode)==0o700,'private-observation-directory');manifest=read(path/'manifest.json');entries=list(path.rglob('*'));need(len(entries)<=100000 and all(not p.is_symlink()and(p.is_file()or p.is_dir())and p.stat().st_mode&0o077==0 for p in entries),'private-observation-files');need(set(manifest)=={str(p.relative_to(path))for p in entries if p.is_file()and p!=path/'manifest.json'}and all(R.CORE.OPS.L.safe_path(n)and R.pin(h)and R.CORE.OPS.L.file_hash(path/n)==h for n,h in manifest.items()),'complete-observation-manifest')
def failed_archive():
 observation_archive(FAILED);need(R.CORE.OPS.L.file_hash(FAILED/'manifest.json')==FAILED_MANIFEST and R.CORE.OPS.L.file_hash(FAILED/'first-result.json')==FAILED_RESULT,'exact-failed-archive-pins');receipt=read(FAILED/'first-result.json');need(receipt.get('success')is False and receipt.get('mode')=='deploy'and receipt.get('base')==BASE and receipt.get('target')==TARGET and receipt.get('tree')==TREE and receipt.get('failedStage')=='indo-shipping-fresh-full-runtime-and-startup-guards'and receipt.get('failedCheck')=='old-receipt-constraint-exact-definition-type-and-validation','only-known-pre-indo-guard-rejection');need(not(FAILED/'pre-switch-indo-shipping').exists()and not(FAILED/'post-start-indo-shipping').exists()and not(FAILED/'runtime-after.private.json').exists()and not(FAILED/'pre-switch-storage.private.json').exists(),'no-indo-candidate-or-complete-deploy-claim');return receipt
def partial_runtime():
 names=list(FAILED.glob('*-before-indo-shipping-canonical-before-assertions.private.json'));need(len(names)==1,'one-last-pre-indo-canonical-runtime');path=names[0];suffix='-canonical-before-assertions.private.json';prefix=path.name[:-len(suffix)];runtime=read(path);records=read(FAILED/(prefix+'-raw-all.private.json'));need(type(records)is list and len(records)==len(runtime['all']),'last-raw-runtime-complete');raw={row['Id']:row for row in records};need(set(raw)==set(runtime['all'])and set(runtime['targets'])==set(R.ORDER),'last-runtime-five-target-binding')
 for service,cid in runtime['targets'].items():
  need(cid in raw and raw[cid]['State']['Running']is True and raw[cid]['State'].get('Health',{}).get('Status')=='healthy','last-five-targets-healthy');process=read(FAILED/(prefix+'-'+service+'-pid1.private.json'));runtime['all'][cid]['processEnvironmentSHA256']=sha(enc(process))
 return runtime,{s:raw[cid]for s,cid in runtime['targets'].items()}
def partial_evidence(before,prepared):
 failed_archive();runtime,raw=partial_runtime();R.unchanged_others(before['runtime'],runtime,COMPLETED);original=read(FAILED/'original-target-inspects.private.json');need(set(original)==set(R.ORDER),'all-five-original-inspects');snapshots={};failedfacts=read(FAILED/'fresh-indo-old-constraint-flags.private.json');need([r for r in failedfacts['constraintFlags']if r.get('table')=='po_receipts']==INDO_FACT_FLAGS,'independent-facts-match-actual-failed-guard-evidence')
 for alias,keys in GROUPS.items():
  oldfolder=FAILED/('pre-switch-'+alias);newfolder=FAILED/('post-start-'+alias);observation_archive(oldfolder);observation_archive(newfolder);a=read(oldfolder/'observed.private.json');b=read(newfolder/'observed.private.json');need(set(a['storage'])==set(b['storage'])==set(keys)and a['postgres']is None and b['postgres']is None,'exact-completed-group-snapshots');saved=read(FAILED/(alias+'-closed-data-checks.private.json'));need(enc(saved['before'])==enc(a)and enc(saved['observed'])==enc(b)and saved['checks']and all(v is True for v in saved['checks'].values()),'all-four-completed-closed-checks-sealed-true');checks,details=R.storage_comparison(a,b,oldfolder,newfolder,raw);need(saved['checks']==checks and saved['details']==details and all(v is True for v in checks.values()),'recomputed-completed-closed-checks-exact');snapshots[alias]=a
 for service in COMPLETED:need(runtime['all'][runtime['targets'][service]]['image']==prepared['images'][service]and runtime['targets'][service]!=before['runtime']['targets'][service],'only-sealed-four-candidates-completed')
 need(runtime['targets']['indo-shipping']==before['runtime']['targets']['indo-shipping']and runtime['all'][runtime['targets']['indo-shipping']]==before['runtime']['all'][before['runtime']['targets']['indo-shipping']],'indo-original-container-entire-runtime-still-untouched');return runtime,raw,original,snapshots
def running_proofs(runtime,raw,original,prepared,label,include_indo=False):
 result={}
 with scope(label):
  for service in COMPLETED+(('indo-shipping',)if include_indo else()):
   R.DEPLOY=RESUMED if service=='indo-shipping'else FAILED;args=[*R.COMPOSE,'-f',str(R.DEPLOY/'runtime-images-and-literal-env.private.yml')];result[service]=R.exact_running_proof(service,original[service],raw[service],prepared,args)
 return result
def facts_ready():
 need(type(INDO_FACT_FLAGS)is list and R.pin(INDO_FACT_FLAGS_SHA)and sha(enc(INDO_FACT_FLAGS))==INDO_FACT_FLAGS_SHA,'root-reviewed-exact-actual-indo-facts-required');need(len(INDO_FACT_FLAGS)==3 and INDO_FACT_FLAGS[0]==dict(R.OLD_RECEIPT_CHECK,type='c',validated=True,deferrable=False,deferred=False,local=True,inheritCount=0,noInherit=False)and not any(row['name']in{R.NEW_RECEIPT_CHECK['name'],R.SPARE_RECEIPT_CHECK['name']}for row in INDO_FACT_FLAGS),'only-known-positive-check-and-historical-spare-check-absence')
def actual_indo_guard(dbid):
 facts_ready();details=R.pg_details(dbid);actual=[row for row in details['constraintFlags']if row.get('table')=='po_receipts'];need(actual==INDO_FACT_FLAGS,'all-three-actual-po-receipts-constraints-and-flags-exact');return details
def pg_comparison(before,after,oldextra,newextra):
 facts_ready();need([r for r in oldextra['constraintFlags']if r.get('table')=='po_receipts']==INDO_FACT_FLAGS,'pre-switch-exact-receipt-constraint-facts');expected=copy.deepcopy(before['schema']);old=R.OLD_RECEIPT_CHECK;new=R.NEW_RECEIPT_CHECK;rows=expected['constraints'];need(rows.count(old)==1 and not any(r['table']=='po_receipts'and r['name']in{new['name'],R.SPARE_RECEIPT_CHECK['name']}for r in rows),'only-known-old-check-and-historical-spare-absence');expected['constraints']=[copy.deepcopy(new)if r==old else r for r in rows];flags=copy.deepcopy(oldextra);flags['constraintFlags']=[dict(r,**new)if(r['table'],r['name'])==(old['table'],old['name'])else r for r in flags['constraintFlags']];return{'all-tables-full-typed-rows-identical':before['tables']==after['tables'],'all-sequence-values-identical':before['sequenceStates']==after['sequenceStates']and before['sequenceStateStableDuringCapture']is True and after['sequenceStateStableDuringCapture']is True,'only-exact-receipt-positive-check-replaced-historical-spare-absence-preserved':expected==after['schema'],'all-owners-grants-rls-and-full-constraint-flags-except-exact-check-identical':flags==newextra}
def new_check_preflight(dbid):
 sql=b"BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SET LOCAL statement_timeout='30s'; SELECT jsonb_build_object('rowsViolatingNewCheck',count(*)) FROM indo_shipping.po_receipts WHERE ((qty > 0) OR ((qty = 0) AND (spare_qty > 0))) IS FALSE; COMMIT;\n";value=json.loads(R.run(['docker','exec','-i',dbid,'sh','-c',R.CORE.Q.PG_SHELL],sql,50));private('new-check-readonly-preflight.private.json',value);need(value=={'rowsViolatingNewCheck':0},'all-current-receipts-satisfy-new-check-without-row-repair')
def candidate_before_switch(prepared,raw):
 imageid=prepared['images']['indo-shipping'];records=json.loads(R.run(['docker','image','inspect',imageid]));need(len(records)==1 and records[0]['Id']==imageid,'original-sealed-indo-candidate-still-available');R.candidate_contract('indo-shipping',records[0],raw['indo-shipping'],R.compose_base()['services']['indo-shipping'])
 with scope('indo-candidate-readonly-proof'):
  proof=R.source_proof('indo-shipping',imageid);private('source-proof.private.json',proof);need(proof==prepared['sourceProof']['indo-shipping'],'same-prepared-indo-source-and-assets-no-rebuild')
def resume(result,before,prepared,files):
 global STAGE
 STAGE='sealed-failed-partial-and-four-completed-closures';expected,partial,original,snapshots=partial_evidence(before,prepared);runtime,raw=R.current_stable(expected,before,files,'resume-initial');proofs=running_proofs(runtime,raw,original,prepared,'completed-four-initial-proofs');R.queue_quiet(raw,before,'resume-initial-qc-quiet');candidate_before_switch(prepared,raw);runtime,raw=R.current_stable(expected,before,files,'before-indo-fresh-guards');dbid=R.CORE.database_container(runtime,raw);checks=R.CORE.Q.indo_startup_guard(raw['indo-shipping']['Id'],dbid);private('fresh-indo-old-startup-guards.private.json',checks);need(all(v is True for v in checks.values()),'all-original-indo-startup-migrations-already-satisfied');details=actual_indo_guard(dbid);private('fresh-indo-exact-actual-constraint-flags.private.json',details);new_check_preflight(dbid)
 STAGE='indo-only-maintenance-closed-pre-switch-snapshot';R.DEPLOY=RESUMED;args,_=R.overlay(R.compose_base(),prepared['images'],OUT/'runtime-images-and-literal-env.private.yml');snapshot,stopped=R.stop_and_snapshot(('indo-shipping',),runtime,raw,before,files,(),'indo-shipping',True);need([r for r in snapshot['postgresDetails']['constraintFlags']if r.get('table')=='po_receipts']==INDO_FACT_FLAGS,'closed-snapshot-still-exact-original-constraints');snapshots['indo-shipping']=snapshot;private('pre-switch-storage.private.json',snapshots)
 STAGE='only-indo-fixed-candidate-create';R.DRAIN['candidateAttempted']=True;R.operation([*args,'up','-d','--force-recreate','--no-build','--no-deps','--pull','never','indo-shipping'],'resume-only-indo-create');R.immediate_raw('resume-indo');R.maintenance('wait_service_ready','indo-shipping');after,postraw=R.CORE.current('resume-indo-created');R.unchanged_others(expected,after,('indo-shipping',))
 with scope('indo-running-source-config-proof'):proofs['indo-shipping']=R.exact_running_proof('indo-shipping',original['indo-shipping'],postraw['indo-shipping'],prepared,args)
 time.sleep(10);need(R.CORE.current('resume-indo-dns-stable')[0]==after,'only-indo-new-candidate-stable');STAGE='indo-closed-post-start-all-pg-data-and-exact-check';observed=R.capture('post-start-indo-shipping',(),postraw,True);checks=pg_comparison(snapshot['postgres']['indo_shipping'],observed['postgres']['indo_shipping'],snapshot['postgresDetails'],observed['postgresDetails']);private('indo-shipping-closed-data-checks.private.json',{'before':snapshot,'observed':observed,'checks':checks,'differencesDoNotIdentifyActor':True});need(all(v is True for v in checks.values()),'only-known-check-migrated-all-other-pg-schema-rows-sequences-permissions-exact');need(R.flags('indo-shipping')==before['maintenanceInventory'],'only-indo-maintenance-added');R.maintenance('maintenance_off','indo-shipping');R.maintenance('require_maintenance_cleared','indo-shipping')
 try:public=R.public_proof('indo-shipping',proofs['indo-shipping'])
 except BaseException:R.maintenance('maintenance_on','indo-shipping');raise
 R.DRAIN=None;STAGE='all-five-final-running-source-env-config-and-original-failed-jobs';runtime,raw=R.current_stable(after,before,files,'resume-final');R.unchanged_others(before['runtime'],runtime,R.ORDER);proofs=running_proofs(runtime,raw,original,prepared,'all-five-final-proofs',True);R.queue_quiet(raw,before,'resume-final-qc-quiet');failed_archive();private('runtime-after.private.json',runtime);private('original-target-inspects.private.json',original);private('all-five-source-proof.private.json',proofs);private('indo-public-proof.private.json',public);result.update(success=True,onlyRemainingIndoContainerRecreated=True,allFivePreparedImagesAndFullRuntimeContractsProven=True,previousFourClosedDataChecksRecomputedTrue=True,newIndoClosedChecks=checks,originalFailedArchivePreserved=True,allMaintenanceFlagsRestored=True,oldFailedJobsPreservedExactly=True,historicalSpareCheckAbsencePreserved=True)
def verify(result,before,prepared,files):
 global STAGE
 receipt=R.archive(RESUMED,RESUMED_MANIFEST,RESUMED_RESULT);need(receipt.get('mode')=='deploy'and receipt.get('target')==TARGET and receipt.get('tree')==TREE and all(receipt.get(k)is True for k in('onlyRemainingIndoContainerRecreated','allFivePreparedImagesAndFullRuntimeContractsProven','previousFourClosedDataChecksRecomputedTrue','allMaintenanceFlagsRestored','historicalSpareCheckAbsencePreserved')),'sealed-successful-indo-only-resume');partial_runtime_value,partialraw,original,snapshots=partial_evidence(before,prepared);expected=read(RESUMED/'runtime-after.private.json');runtime,raw=R.current_stable(expected,before,files,'verify-resumed-initial');R.unchanged_others(before['runtime'],runtime,R.ORDER);STAGE='seal-raw-all-sqlite-pg-files-and-permissions-before-comparison';observed=R.capture('observation',tuple(R.CORE.STORAGE),raw,True);private('raw-observation-before-comparison.private.json',observed);STAGE='strict-all-five-data-source-and-full-runtime-comparison';aggregate=read(RESUMED/'pre-switch-storage.private.json');need(set(aggregate)==set(GROUPS)|{'indo-shipping'}and all(enc(aggregate[k])==enc(v)for k,v in snapshots.items()),'original-four-pre-switch-snapshots-reused-exactly');indofolder=RESUMED/'pre-switch-indo-shipping';observation_archive(indofolder);indopre=read(indofolder/'observed.private.json');need(enc(indopre)==enc(aggregate['indo-shipping']),'original-new-indo-closed-snapshot-binding');checks={};details={}
 for alias in GROUPS:
  snapshot=snapshots[alias];scoped=dict(observed,storage={k:observed['storage'][k]for k in snapshot['storage']});part,extra=R.storage_comparison(snapshot,scoped,FAILED/('pre-switch-'+alias),OUT/'observation',raw);checks.update(part);details[alias]=extra
 checks.update(pg_comparison(indopre['postgres']['indo_shipping'],observed['postgres']['indo_shipping'],indopre['postgresDetails'],observed['postgresDetails']));proofs=running_proofs(runtime,raw,original,prepared,'verify-all-five-proofs',True);public={}
 for service in R.ORDER:public[service]=R.public_proof(service,proofs[service])
 R.queue_quiet(raw,before,'verify-resumed-original-failed');R.current_stable(runtime,before,files,'verify-resumed-final');failed_archive();private('verification-comparison.private.json',{'checks':checks,'details':details,'differencesDoNotIdentifyActor':True});private('verified-public-requests.private.json',public);result.update(success=all(v is True for v in checks.values()),checks=checks,rawObservationSealedBeforeComparison=True,allFivePreparedImagesAndFullRuntimeContractsProven=True,oldFailedJobsPreservedExactly=True,unexpectedDifferencesNotAutomaticallyAttributedOrRestored=True)
def main():
 global OUT,STAGE
 need(len(sys.argv)==2 and sys.argv[1]in{'deploy','verify'},'fixed-two-phase-mode');mode=sys.argv[1];need({'deploy':DEPLOY_PIN,'verify':VERIFY_PIN}[mode]and os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_ATTEMPT')=='1'and re.fullmatch('[a-f0-9]{40}',os.environ.get('RELEASE_SHA','')),'false-gate-or-fixed-branch-sha-first-attempt');os.umask(0o077);OUT=RESUMED if mode=='deploy'else VERIFIED;OUT.mkdir(mode=0o700);initialize();signal.signal(signal.SIGTERM,lambda *_:need(False,'terminated'));result={'mode':mode,'target':TARGET,'tree':TREE,'success':False,'completedFourContainersRecreated':False,'environmentFileModified':False,'providerRequestsPerformed':False,'queueWritesPerformed':False,'automaticDataOrSchemaRollbackPerformed':False}
 try:
  before=R.baseline();prepared=R.prepared(before);files=R.files();facts_ready();{'deploy':resume,'verify':verify}[mode](result,before,prepared,files)
 except BaseException:
  result.update(failedStage=STAGE,failedCheck=FAILED_CHECK or R.FAILED_CHECK or'reviewed-library-or-system-error');private('failure-trace.private.txt',traceback.format_exc().encode())
  if mode=='deploy':
   try:R.recover_before_candidate(result)
   except BaseException:result['preCandidateRecoveryIncomplete']=True;private('recovery-failure-trace.private.txt',traceback.format_exc().encode())
 private('first-result.json',result);R.CORE.OPS.L.seal(OUT);need(len(enc(result))<=48000,'bounded-public-result');print(enc(dict(result,manifestSHA256=R.CORE.OPS.L.file_hash(OUT/'manifest.json'),resultSHA256=R.CORE.OPS.L.file_hash(OUT/'first-result.json'))).decode(),flush=True);return 0 if result['success']else 1
if __name__=='__main__':
 try:code=main()
 except BaseException:print('{"success":false,"safeFailure":"BATCH_977_979_RESUME_PREFLIGHT_FAILED"}',flush=True);code=1
 sys.exit(code)
