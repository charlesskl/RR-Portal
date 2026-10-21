"""Diagnose exact sealed pre-switch runtime rejection; read only."""
import hashlib,importlib.util,json,os,pathlib,re,sys,traceback
ROOT=pathlib.Path('/opt/rr-portal');BRANCH='refs/heads/ops/batch-969-970-972-974-20261021';DIAG_PIN=False
RELEASE_SHA='5776dcf97872c86e54aa4239cc2aba8160b40008c16fae545f4896a441e07287'
TARGET='dfcdf751cae42fdd1731729dd662fce041c28caf';TREE='d5a107e898fe35066416fa0431ccd92400467875'
FAILED=ROOT/'deploy/backups/batch-969-970-972-974-20261021-deploy'
FAILED_MANIFEST='817f091fd04aa6e770caf1f97e151f3fd04b3d9b6bbbbedf081c3d4e7eb56530';FAILED_RESULT='70498c8e96667c0bed5fbbaf28d32c0cb5527b43fffea9c1d6e6277e643fab43'
OUT=ROOT/'deploy/backups/batch-969-970-972-974-20261021-runtime-diagnose-01';R=None;STAGE='entrypoint'

def need(value):
 if not value:raise RuntimeError('FIXED_RUNTIME_DIAG_REJECTED')

def differences(old,new,path=()):
 if type(old)is not type(new):return[list(path)]
 if type(old)is dict:
  result=[]
  for key in sorted(set(old)|set(new)):
   need(type(key)is str and len(key)<=256);result.extend([list(path+(key,))]if key not in old or key not in new else differences(old[key],new[key],path+(key,)));need(len(result)<=4096)
  return result
 if type(old)is list:
  result=[]
  for index in range(max(len(old),len(new))):result.extend([list(path+(index,))]if index>=len(old)or index>=len(new)else differences(old[index],new[index],path+(index,)));need(len(result)<=4096)
  return result
 need(old is None or type(old)in(str,int,float,bool));return[]if old==new else[list(path)]

def failed_deploy():
 need(R.observation_archive(FAILED)==FAILED_MANIFEST and R.CORE.OPS.L.file_hash(FAILED/'first-result.json')==FAILED_RESULT)
 receipt=R.read_json(FAILED/'first-result.json');need(receipt.get('mode')=='deploy'and receipt.get('target')==TARGET and receipt.get('tree')==TREE and receipt.get('success')is False and receipt.get('failedStage')=='deploy-sealed-preparation'and receipt.get('failedCheck')=='runtime-exactly-unchanged')
 for key in('businessAPIMutationsPerformed','credentialsOrMailboxStateChanged','environmentFileModified','globalHooksOrGlobalMaintenanceRun','automaticSchemaDataRollbackOrCounterResetPerformed','maintenanceOrServiceSwitchesPerformed'):need(receipt.get(key)is False)
 need('builds'not in receipt and'candidateImageIDs'not in receipt and not(FAILED/'runtime-images-and-literal-env.private.yml').exists()and not any(p.name.startswith('pre-switch-')or'graceful-stop-'in p.name or'recreate-'in p.name for p in FAILED.rglob('*')))
 return receipt

def raw_inspection(label):
 ids=R.private_capture(['docker','ps','-aq','--no-trunc'],label+'-container-ids').decode().split();need(0<len(ids)<=1000 and len(ids)==len(set(ids))and all(re.fullmatch('[a-f0-9]{64}',v)for v in ids))
 rows=json.loads(R.private_capture(['docker','inspect',*ids],label+'-all-container-inspects'));need(type(rows)is list and len(rows)==len(ids));result={}
 for row in rows:
  cid=row['Id'];need(cid in ids and cid not in result);config=row['Config'];labels=config.get('Labels')or{};state=row['State'];service=labels.get('com.docker.compose.service')if labels.get('com.docker.compose.project')=='rr-portal'else None
  need(service is None or type(service)is str and re.fullmatch('[a-z0-9][a-z0-9_-]{0,80}',service));need(re.fullmatch('sha256:[a-f0-9]{64}',row['Image'])and type(state['Running'])is bool and type(state['OOMKilled'])is bool and type(row['RestartCount'])is int)
  started=state.get('StartedAt');health=state.get('Health',{}).get('Status');need(type(started)is str and re.fullmatch('[0-9TZ:.+-]{1,48}',started)and health in(None,'healthy','unhealthy','starting'))
  result[cid]={'id':cid,'service':service,'image':row['Image'],'started':started,'running':state['Running'],'oom':state['OOMKilled'],'restarts':row['RestartCount'],'health':health,'configSHA256':R.sha(R.enc(dict(config,Env=sorted(config['Env'])))),'hostConfigSHA256':R.sha(R.enc(row['HostConfig'])),'networkSettingsSHA256':R.sha(R.enc(row.get('NetworkSettings',{}))),'mountsSHA256':R.sha(R.enc(sorted(row.get('Mounts',[]),key=R.enc)))}
 R.CORE.OPS.L.private_write(OUT/(label+'-technical-facts.private.json'),R.enc(result));return result

def sample(label):
 raw=raw_inspection(label);canonical=None;error=None
 try:canonical,_=R.CORE.runtime()
 except BaseException as exc:
  error=type(exc).__name__;need(re.fullmatch('[A-Za-z_][A-Za-z0-9_]{0,80}',error));R.CORE.OPS.L.private_write(OUT/(label+'-canonical-runtime-error.private.txt'),traceback.format_exc().encode())
 R.CORE.OPS.L.private_write(OUT/(label+'-canonical-runtime.private.json'),R.enc({'available':canonical is not None,'exceptionType':error,'runtime':canonical}));return {'rawTechnicalFacts':raw,'canonical':canonical,'exceptionType':error}

def source_guard(before,files):
 R.checked_source(TARGET,before,files);need(R.flags()==before['maintenanceInventory'])

def safe_canonical(row,service):
 fields=('id','image','started','running','oom','restarts','health','configSHA256','hostConfigSHA256','networkSettingsSHA256')
 return dict({k:row.get(k)for k in fields},service=service,mountsSHA256=R.sha(R.enc(sorted(row['mounts'],key=R.enc))))

def observe(result):
 global STAGE
 STAGE='sealed-original-prepared-and-two-failures';before=R.original();files=R.source_manifest();old_failure=R.failed_prepare_evidence();failed_deploy();prepare_receipt=R.archive(R.PREPARE,R.PREPARE_MANIFEST,R.PREPARE_RESULT);prepared=R.read_json(R.PREPARE/'prepared.private.json')
 need(prepare_receipt.get('mode')=='prepare'and prepare_receipt.get('allFourCandidatesBuiltAndProvenBeforeMaintenance')is True and prepare_receipt.get('maintenanceOrServiceSwitchesPerformed')is False and prepared['runtimeBefore']==before['runtime']and prepared['target']==TARGET and prepared['tree']==TREE)
 STAGE='strict-source-env-dirty-flags-before';source_guard(before,files)
 STAGE='current-runtime-before';first=sample('current-before')
 STAGE='strict-source-env-dirty-flags-middle';source_guard(before,files)
 STAGE='current-runtime-after';last=sample('current-after')
 paths={} if first['canonical']is None else {'backupVersusCurrentBefore':differences(before['runtime'],first['canonical']),'preparedVersusCurrentBefore':differences(prepared['runtimeBefore'],first['canonical'])}
 if last['canonical']is not None:paths['backupVersusCurrentAfter']=differences(before['runtime'],last['canonical'])
 if first['canonical']is not None and last['canonical']is not None:paths['currentBeforeVersusAfter']=differences(first['canonical'],last['canonical'])
 old_rows={row['id']:safe_canonical(row,s)for s,row in before['runtime']['targets'].items()};old_rows.update({cid:safe_canonical(row,None)for cid,row in before['runtime']['others'].items()})
 changed=[]
 for cid in sorted(set(old_rows)|set(last['rawTechnicalFacts'])):
  old=old_rows.get(cid);new=last['rawTechnicalFacts'].get(cid);old_comparison=None if old is None else {k:v for k,v in old.items()if k!='service'or v is not None};comparable=None if new is None else {k:v for k,v in new.items()if old_comparison is None or k in old_comparison}
  if old is None or new is None or differences(old_comparison,comparable):changed.append({'id':cid,'before':old,'after':new})
 R.CORE.OPS.L.private_write(OUT/'runtime-differences.private.json',R.enc({'differencePaths':paths,'changedContainerFacts':changed}))
 result.update(differencePaths={k:v[:128]for k,v in paths.items()},differencePathCounts={k:len(v)for k,v in paths.items()},differencePathsCompleteInPublic=all(len(v)<=128 for v in paths.values()),changedContainerCount=len(changed),changedContainerFacts=changed[:12],changedContainerFactsCompleteInPublic=len(changed)<=12,currentCanonicalBeforeAvailable=first['canonical']is not None,currentCanonicalAfterAvailable=last['canonical']is not None,currentCanonicalExceptionTypes=[first['exceptionType'],last['exceptionType']],currentRuntimeStableDuringDiagnostic=first['canonical']is not None and first['canonical']==last['canonical'],rawInspectionTechnicalFactsStable=first['rawTechnicalFacts']==last['rawTechnicalFacts'])
 while len(R.enc(result))>22000:
  if result['changedContainerFacts']:result['changedContainerFacts'].pop();result['changedContainerFactsCompleteInPublic']=False
  elif any(result['differencePaths'].values()):
   key=max(result['differencePaths'],key=lambda k:len(R.enc(result['differencePaths'][k])));result['differencePaths'][key]=result['differencePaths'][key][:-1];result['differencePathsCompleteInPublic']=False
  else:need(False)
 STAGE='final-strict-source-env-dirty-flags-and-all-seals';source_guard(before,files);need(R.original()==before and R.failed_prepare_evidence()==old_failure);failed_deploy();R.archive(R.PREPARE,R.PREPARE_MANIFEST,R.PREPARE_RESULT)
 result.update(success=True,diagnosisCompleteOnly=True,noReleasePhaseInvoked=True,sourceEnvironmentFileDirtyFilesAndMaintenanceStrictlyUnchanged=True,allOriginalAndFailedEvidenceSealsPreserved=True,actualActorOrCauseProven=False)

def main():
 global R,STAGE
 need(DIAG_PIN and sys.argv[1:]==['diagnose']and os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_ATTEMPT')=='1')
 path=pathlib.Path(__file__).with_name('batch-release-library.py');need(path.is_file()and not path.is_symlink()and hashlib.sha256(path.read_bytes()).hexdigest()==RELEASE_SHA)
 spec=importlib.util.spec_from_file_location('runtime_release_readonly_library',path);R=importlib.util.module_from_spec(spec);spec.loader.exec_module(R)
 need(R.TARGET==TARGET and R.TREE==TREE and R.CORE_SHA=='4745c90f126cf46106b0f170a3ebc6b24ccb64c0e963e427d13308d5cb5b54f5')
 os.umask(0o077);OUT.mkdir(mode=0o700);R.OUT=OUT;R.ENV=dict(os.environ);R.CORE=R.load_core();result={'mode':'diagnose','target':TARGET,'tree':TREE,'success':False,'businessWritesPerformed':False,'containerOrServiceSignalsPerformed':False,'liveHTTPOrAuthenticationRequestsPerformed':False,'environmentOrMaintenanceModified':False,'secretOrBusinessValuesPrinted':False}
 try:observe(result)
 except BaseException:result.update(failedStage=STAGE,safeFailure='FIXED_RUNTIME_DIAG_REJECTED');R.CORE.OPS.L.private_write(OUT/'failure-traceback.private.txt',traceback.format_exc().encode())
 finally:
  R.CORE.OPS.L.private_write(OUT/'first-result.json',R.enc(result));R.CORE.OPS.L.seal(OUT);public=dict(result,manifestSHA256=R.CORE.OPS.L.file_hash(OUT/'manifest.json'),resultSHA256=R.CORE.OPS.L.file_hash(OUT/'first-result.json'));need(len(R.enc(public))<=24000);print(R.enc(public).decode(),flush=True)
 return 0 if result['success']else 1

if __name__=='__main__':
 try:code=main()
 except BaseException:print('{"success":false,"safeFailure":"FIXED_RUNTIME_DIAG_PREFLIGHT_REJECTED"}',flush=True);code=1
 sys.exit(code)
