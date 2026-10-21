"""False-gated Toy-only maintenance restoration using the reviewed readonly diagnosis."""
import copy,hashlib,importlib.util,json,os,pathlib,sys,traceback
ROOT=pathlib.Path('/opt/rr-portal');BRANCH='refs/heads/ops/batch-969-970-972-974-20261021';RESTORE_PIN=False;REVIEWED_DNS_DIFF_PIN=False
TARGET='dfcdf751cae42fdd1731729dd662fce041c28caf';TREE='d5a107e898fe35066416fa0431ccd92400467875'
RELEASE_SHA='2db18fac4f09a6dc4ae64c07fc248e9cd575ed5e06eebabc77de58e1584254e7';DIAG_LIBRARY_SHA='caa05c2977970261fb480284d46c74254163602e963c1ba6193f5be284aa048b'
FAILED=ROOT/'deploy/backups/batch-969-970-972-974-20261021-deploy-03'
DIAG=ROOT/'deploy/backups/batch-969-970-972-974-20261021-toy-config-diagnose-01';DIAG_MANIFEST='a05266ca79468cf668e33ff292168847f3f579fe3acdc1c0751be2b436344ed2';DIAG_RESULT='ad48797aa5a09612c74fad26473274538e886ad96ed54ba3c72774c596f3150e'
OUT=ROOT/'deploy/backups/batch-969-970-972-974-20261021-toy-restore-01';R=None;D=None;STAGE='entrypoint'

def need(value):
 if not value:raise RuntimeError('FIXED_TOY_RESTORATION_REJECTED')

def enc(value):return json.dumps(value,ensure_ascii=True,sort_keys=True,separators=(',',':'),allow_nan=False).encode()

def load(name,checksum):
 path=pathlib.Path(__file__).with_name(name);need(path.is_file()and not path.is_symlink()and hashlib.sha256(path.read_bytes()).hexdigest()==checksum);spec=importlib.util.spec_from_file_location(name.replace('.','_'),path);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module

def normalized_toy_inspect(old,current):
 adjusted=copy.deepcopy(current)
 for field in('Dns','DnsOptions','DnsSearch'):
  need(field in old['HostConfig']and type(old['HostConfig'][field])is list and len(old['HostConfig'][field])==0 and field in current['HostConfig']and current['HostConfig'][field]is None);adjusted['HostConfig'][field]=[]
 return adjusted

def bind_current_to_diagnosis(current,raw,sealed):
 need(enc(current)==enc(sealed['runtime'])and set(raw)==set(sealed['raw'])==set(R.ORDER))
 for service in R.ORDER:
  need(raw[service]['Id']==current['targets'][service]['id']and raw[service]['Image']==current['targets'][service]['image'])
  for field in('Id','Image','Config','HostConfig','Mounts'):need(enc(sorted(raw[service][field],key=enc)if field=='Mounts'else raw[service][field])==enc(sorted(sealed['raw'][service][field],key=enc)if field=='Mounts'else sealed['raw'][service][field]))
 return True

def current_toy_data(roots,prior):
 directory=OUT/'current-toy-storage';directory.mkdir(mode=0o700);saved=R.CORE.OUT;R.CORE.OUT=directory
 try:
  value=R.release_storage({'toyqms':roots['toyqms']});R.CORE.OPS.L.private_write(directory/'observed.private.json',enc({'storage':value,'postgres':None,'walAwareLiveCopy':True}));R.CORE.OPS.L.seal(directory)
 finally:R.CORE.OUT=saved
 R.observation_archive(directory);R.closed_audits(directory,value);checks=R.compare_storage(prior['storage']['toyqms'],value['toyqms']);R.CORE.OPS.L.private_write(OUT/'toy-data-comparison.private.json',enc(checks));need(checks and all(v is True for v in checks.values()));return checks

def restore(result):
 global STAGE
 STAGE='complete-prior-sealed-diagnosis';prior=R.archive(DIAG,DIAG_MANIFEST,DIAG_RESULT);need(prior.get('mode')=='diagnose'and prior.get('target')==TARGET and prior.get('tree')==TREE and prior.get('diagnosisCompleteOnly')is True);sealed=R.read_json(DIAG/'final-runtime-and-target-inspects.private.json');STAGE='fresh-reviewed-readonly-diagnosis';proof={};D.observe(proof);need(proof.get('success')is True and proof.get('diagnosisCompleteOnly')is True);R.CORE.OPS.L.private_write(OUT/'fresh-diagnosis-proof.private.json',enc(proof));observed=R.read_json(OUT/'final-runtime-and-target-inspects.private.json');current,raw=observed['runtime'],observed['raw'];bind_current_to_diagnosis(current,raw,sealed);before=R.original();files=R.source_manifest();old=R.read_json(R.BACKUP/'target-inspect.private.json');STAGE='exact-three-default-dns-representations';adjusted=normalized_toy_inspect(old['toyqms'],raw['toyqms']);args=[*R.COMPOSE,'-f',str(FAILED/'runtime-images-and-literal-env.private.yml')];R.configuration_preserved(old['toyqms'],adjusted,args)
 STAGE='toy-wal-data-preservation';folder=FAILED/'pre-switch-toyqms';R.observation_archive(folder);preswitch=R.read_json(folder/'observed.private.json');need(set(preswitch['storage'])=={'toyqms'}and preswitch['postgres']is None);R.closed_audits(folder,preswitch['storage']);roots,mounts=R.CORE.storage_roots(raw);need(mounts==before['storageMounts']);checks=current_toy_data(roots,preswitch);R.runtime_stable(current,before,files,'toyqms');D.guards(before,files);R.CORE.OPS.L.private_write(OUT/'ready-to-clear-toy-only.private.json',enc({'runtime':current,'knownDockerDefaultDNSRepresentationOnly':True,'dataChecks':checks}))
 STAGE='clear-only-toy-maintenance';result['maintenanceFlagMutationAttempted']=True;R.maintenance('maintenance_off','toyqms');R.maintenance('require_maintenance_cleared','toyqms');need(R.flags()==before['maintenanceInventory'])
 try:
  STAGE='readonly-restored-health-and-assets';source=R.read_json(OUT/'current-source-proof.private.json')['toyqms'];public={'health':R.health('toyqms'),'assets':R.public_assets('toyqms',source)};R.runtime_stable(current,before,files)
 except BaseException:R.maintenance('maintenance_on','toyqms');result['toyMaintenanceRestoredAfterPublicCheckFailure']=True;raise
 D.partial_evidence();R.archive(DIAG,DIAG_MANIFEST,DIAG_RESULT);R.CORE.OPS.L.private_write(OUT/'runtime-after.private.json',enc(current));result.update(success=True,restoredToyEntryOnly=True,knownDockerDefaultDNSRepresentationOnly=True,allTypedToyRowsSchemaFilesAndOwnersPreserved=True,completeConfigurationAndPID1EnvironmentPreserved=True,qcAndToyNotRecreated=True,remainingIndoAndQuoteNotSwitched=True,publicReadOnlyProof=public,knownPreDeploymentUnrelatedRestartObserved=True,actualActorOrCauseOfKnownRestartProven=False)

def main():
 global R,D,STAGE
 need(RESTORE_PIN and REVIEWED_DNS_DIFF_PIN and sys.argv[1:]==['restore-toy']and os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_ATTEMPT')=='1');D=load('batch-toy-diagnostic-library.py',DIAG_LIBRARY_SHA);R=load('batch-release-library.py',RELEASE_SHA);need(D.DIAG_PIN is False and D.RELEASE_SHA==RELEASE_SHA and R.TARGET==TARGET and R.TREE==TREE and R.DEPLOY==FAILED and R.CORE_SHA=='4745c90f126cf46106b0f170a3ebc6b24ccb64c0e963e427d13308d5cb5b54f5');os.umask(0o077);OUT.mkdir(mode=0o700);D.R=R;D.OUT=OUT;R.OUT=OUT;R.ENV=dict(os.environ,MAINT_FLAG_DIR=str(ROOT/'deploy/maintenance'),COMPOSE_FILE=str(ROOT/'docker-compose.cloud.yml'),ENV_FILE=str(ROOT/'.env.cloud.production'),COMPOSE_PROJECT_NAME='rr-portal',MAINT_COMPOSE_SERVICES='toyqms');R.CORE=R.load_core();result={'mode':'restore-toy','target':TARGET,'tree':TREE,'success':False,'maintenanceFlagMutationAttempted':False,'oldContainerRestartedOrRolledBack':False,'containerRecreationOrServiceSignalsPerformed':False,'businessAPIMutationsOrDatabaseWritesPerformed':False,'sourceOrEnvironmentModified':False}
 try:restore(result)
 except BaseException:result.update(failedStage=STAGE,safeFailure='FIXED_TOY_RESTORATION_REJECTED');R.CORE.OPS.L.private_write(OUT/'failure-traceback.private.txt',traceback.format_exc().encode())
 finally:R.CORE.OPS.L.private_write(OUT/'first-result.json',enc(result));R.CORE.OPS.L.seal(OUT);public=dict(result,manifestSHA256=R.CORE.OPS.L.file_hash(OUT/'manifest.json'),resultSHA256=R.CORE.OPS.L.file_hash(OUT/'first-result.json'));need(len(enc(public))<=18000);print(enc(public).decode(),flush=True)
 return 0 if result['success']else 1
if __name__=='__main__':
 try:code=main()
 except BaseException:print('{"success":false,"safeFailure":"FIXED_TOY_RESTORATION_PREFLIGHT_REJECTED"}');code=1
 sys.exit(code)
