"""Inert continuation: keep both completed factories; switch quote only, then verify.
Only the diagnosed permutation of two fixed quote bind strings is normalized.
No rebuild, environment edit, database restore/reset, login or model request.
"""
import copy,hashlib,importlib.util,json,os,pathlib,re,signal,sys,traceback
PHASE=''
TARGET=''
TREE=''
SOURCE_MANIFEST_SHA='c930e6c2275e2130cc7386e1422e9668937a2dba84cd1cee66144a662624c69e'
BACKUP_MANIFEST='';BACKUP_RESULT='';PREPARE_MANIFEST='';PREPARE_RESULT='';DEPLOY_MANIFEST='';DEPLOY_RESULT=''
BASE='f50e23735af6e198721830e26e35e26162f09af0'
BASE_TREE='6f8cfbdf0e607ccdca59b0cc0c21c5d430ece5f2'
EXPECTED_TARGET='26a009541efeb99588e84c289cfe8463f18f6f4a'
EXPECTED_TREE='603d8c20730da455cc33e3e186754e63a9af4ab0'
BRANCH='refs/heads/ops/batch-988-991-992-20261022'
ROOT=pathlib.Path('/opt/rr-portal')
BACKUP=ROOT/'deploy/backups/batch-988-991-992-20261022-backup-2'
PREPARE=ROOT/'deploy/backups/batch-988-991-992-20261022-prepare'
FAILED_DEPLOY=ROOT/'deploy/backups/batch-988-991-992-20261022-deploy'
FAILED_DEPLOY_MANIFEST='01c8a72d67dbec5e50811b5eeb2465156eba09fb840b0cb7552eaeacab63732a'
FAILED_DEPLOY_RESULT='3cdb7c3f51a223e695d737eef583a75b39af9bc73a3a0b8f273515a52d68cc16'
DIAGNOSE=ROOT/'deploy/backups/batch-988-991-992-20261022-runtime-diagnose1'
DIAGNOSE_MANIFEST='c305fde0b32edbc3da9df6600eee1e0f9eba4abd980e9779de4e6055664dc8c9'
DIAGNOSE_RESULT='1079d548600f6f4c1816f71a2383ff6b7c02bb02f246319124b59e02f21b287e'
DEPLOY=ROOT/'deploy/backups/batch-988-991-992-20261022-continue-deploy'
VERIFY=ROOT/'deploy/backups/batch-988-991-992-20261022-continue-verify'
ORDER=('factory-review-test','factory-review','internal-quote')
FACTORIES=ORDER[:2]
QUOTE='internal-quote'
DEPS={'batch-988-991-992-release-library.py':'d6eb0d297b7c394e3c1053e6b1bf11ab0302ae26501ac7fccfac331ad8513c1b','batch-988-991-992-backup-library.py':'08a98eb61829893d00be2f24e97629136929465a2d45e23ed38dbc45248db5df','batch-host-config-library.py':'bd1842dc6847f3e0e5c0c38374c3604791f66d1c94dc651457607dc338f38ff1','factory-review-backup-library.py':'79d76bb47312dd08c121ebe2797f54d958666f8b72d00721f67712b152fc4666','release-data-ops-library.py':'ff9138a1d5bfed1b10077112da6ebcda2d65240f583e2d0e12ce1325cfbaafd5','release-data-library.py':'d63168fd3057f4f2aba2d93f9fab31d2d65c6dd0f3234877d71fcff1e04e62b9','internal-quote-readonly-library.py':'be4f901f3444154e5de06766a2d8a0801dba9b847a4ac25f34a84ccebe354e69'}
R=None;OUT=None;STAGE='entrypoint'
def need(v,label):
 global STAGE
 if not v:STAGE=label;raise RuntimeError('BATCH_CONTINUATION_REJECTED')
def enc(v):return json.dumps(v,ensure_ascii=True,sort_keys=True,separators=(',',':'),allow_nan=False).encode()
def sha(v):return hashlib.sha256(v).hexdigest()
def read(p):return json.loads(p.read_bytes())
def pin(v,n=64):return type(v)is str and re.fullmatch('[a-f0-9]{%d}'%n,v)is not None
def private(n,v):R.private(n,v)
def initialize():
 global R
 for n,h in DEPS.items():
  p=pathlib.Path(__file__).with_name(n);need(pin(h)and p.is_file()and not p.is_symlink()and sha(p.read_bytes())==h,'all-seven-frozen-dependencies-before-import')
 p=pathlib.Path(__file__).with_name('batch-988-991-992-release-library.py');spec=importlib.util.spec_from_file_location('frozen_original_release',p);R=importlib.util.module_from_spec(spec);spec.loader.exec_module(R)
 need(R.PHASE==R.TARGET==R.TREE==''and R.BASE==BASE and R.BASE_TREE==BASE_TREE and R.ORDER==ORDER and R.SOURCE_MANIFEST_SHA==SOURCE_MANIFEST_SHA and R.DEPS=={k:v for k,v in DEPS.items()if k!='batch-988-991-992-release-library.py'},'inert-original-release-and-six-exact-dependencies')
 need(R.BACKUP==BACKUP and R.PREPARE==PREPARE and R.DEPLOY==FAILED_DEPLOY,'original-phase-paths-unchanged')
 R.ROOT=ROOT;R.OUT=OUT;R.TARGET=TARGET;R.TREE=TREE;R.BACKUP_MANIFEST=BACKUP_MANIFEST;R.BACKUP_RESULT=BACKUP_RESULT;R.PREPARE_MANIFEST=PREPARE_MANIFEST;R.PREPARE_RESULT=PREPARE_RESULT;R.initialize()

def full_contract(service,old,new,image,literal,args,revision,allow_same=False):
 if service!=QUOTE:return R.full_contract(service,old,new,image,literal,args,revision,allow_same=allow_same)
 # Compare copied HostConfig only; never mutate inspected records or the library.
 a,c=copy.deepcopy(old),copy.deepcopy(new);expected={str(ROOT/'apps/业务部/内部报价系统/backend/data')+':/app/backend/legacy-data:ro',str(ROOT/'apps/业务部/内部报价系统/backend/uploads')+':/app/backend/uploads:rw'}
 for record in(a,c):
  binds=record['HostConfig'].get('Binds');need(type(binds)is list and len(binds)==2 and all(type(v)is str for v in binds)and len(set(binds))==2 and set(binds)==expected,'only-two-exact-known-nonoverlapping-quote-bind-strings');record['HostConfig']['Binds']=sorted(binds)
 need(sorted(old['Mounts'],key=enc)==sorted(new['Mounts'],key=enc),'quote-full-mounts-remain-strict')
 return R.full_contract(service,a,c,image,literal,args,revision,allow_same=allow_same)

def original_runtime(cid,image):
 manifest=read(FAILED_DEPLOY/'manifest.json');matches=[]
 for n in sorted(manifest):
  if re.fullmatch(r'all-runtime-inspect-[0-9]{3}\.private\.json',n):
   rows=read(FAILED_DEPLOY/n);need(type(rows)is list and len(rows)==46,'sealed-original-runtime-array46')
   for row in rows:
    if row['Id']==cid:
     labels=row['Config'].get('Labels')or{};need(row['Image']==image and labels.get('com.docker.compose.project')=='rr-portal'and labels.get('com.docker.compose.service')==QUOTE,'sealed-recovered-quote-identity');matches.append(row)
 def contract(v):return{k:v[k]for k in('Id','Image','Config','HostConfig','Mounts','RestartCount')}|{'StartedAt':v['State']['StartedAt']}
 need(matches and len({sha(enc(contract(v)))for v in matches})==1,'one-sealed-recovered-runtime-contract');return matches[-1]

def priors():
 b=R.baseline();p=R.prepared();failed=R.sealed(FAILED_DEPLOY,FAILED_DEPLOY_MANIFEST,FAILED_DEPLOY_RESULT,'deploy',False);diag=R.sealed(DIAGNOSE,DIAGNOSE_MANIFEST,DIAGNOSE_RESULT,'diagnose')
 need(failed.get('completedServices')==list(FACTORIES)and failed.get('failedService')==QUOTE and failed.get('failedStage')=='complete-hostconfig-mounts'and failed.get('failedServiceRecoveredWithoutDataRestore')is True,'exact-partial-deploy-and-safe-quote-recovery')
 a,c=diag['originalToCandidate'],diag['originalToRecovered'];need([d['key']for d in a['hostConfigDifferences']]==['Binds']and a['bindsSameMultiset']is True and a['bindsAllValuesAllowlisted']is True and a['mountsExactIgnoringArrayOrder']is True and a['originalMountsSHA256']==a['observedMountsSHA256']==c['originalMountsSHA256']==c['observedMountsSHA256']and c['hostConfigExact']is True and c['hostConfigDifferences']==[],'sealed-diagnosed-bind-order-only-and-exact-recovery')
 need(diag.get('recoveredOldImmutableImage')is True and diag.get('other43ExactRuntimeAndConfigUnchanged')is True and diag.get('environmentBytesModeOwnerUnchanged')is True and diag.get('flagsMatchOriginal')is True and diag.get('current46MetadataStable')is True and diag.get('allThreeConfiguredEnvironmentMapsMatchOriginal')is True and diag.get('currentSourcesMatchPreparedFactoriesAndOriginalQuote')=={s:True for s in ORDER}and diag.get('currentDockerHealth')=={s:'healthy'for s in ORDER},'complete-successful-readonly-diagnosis')
 for k in('businessWritesPerformed','configurationChanged','containerSignalsPerformed','HTTPRequestsPerformed','databaseQueriesPerformed','modelCallsPerformed','rawSecretsOrRowsPrinted'):need(diag.get(k)is False,'readonly-diagnostic-contract')
 oldraw=read(BACKUP/'target-inspect.private.json');recovered=original_runtime(diag['recoveredContainerId'],oldraw[QUOTE]['Image']);return b,p,oldraw,recovered

def factory_evidence(b,p,oldraw,current,raw,public_checks=True):
 need(current['others']==b['runtime']['others']and current['databaseContainer']==b['runtime']['databaseContainer'],'all-original43-including-postgres-container-identical');literal=R.envs();args=[*R.COMPOSE,'-f',str(FAILED_DEPLOY/'runtime.private.yml')];evidence={};publics={}
 for service in FACTORIES:
  started=read(FAILED_DEPLOY/(service+'-candidate-started.private.json'));need(started=={'candidateStartedAt':raw[service]['State']['StartedAt'],'containerId':raw[service]['Id'],'image':p['images'][service]},'completed-factory-original-candidate-id-image-started-retained')
  a=read(FAILED_DEPLOY/(service+'-closed-before.private.json'));c=read(FAILED_DEPLOY/(service+'-after-start.private.json'));ap=FAILED_DEPLOY/(service+'-closed-before');cp=FAILED_DEPLOY/(service+'-after-start');R.replay_snapshot(service,a,ap);R.replay_snapshot(service,c,cp);delta=R.same_data(service,a,c,ap,cp,started['candidateStartedAt']);audit={'candidateStartedAt':started['candidateStartedAt'],'afterSnapshotObservedUTC':c['observedUTC'],'retentionCutoffBasis':'after_snapshot_observation','deletionActorOrExactTimesProven':False,'dataDeltaEvidence':delta,'businessTypedSchemaFilesAndOwnershipPreserved':True};need(read(FAILED_DEPLOY/(service+'-closed-comparison.private.json'))==audit,'completed-factory-original-closed-audit-reproduced')
  full_contract(service,oldraw[service],raw[service],p['images'][service],literal,args,TARGET);need(R.proof(service,p['images'][service],raw[service]['Id'])==p['proofs'][service],'completed-factory-current-full-source-and-assets-exact');evidence[service]={'started':started,'audit':audit}
  if public_checks:publics[service]=R.public(service,p['proofs'][service])
 return evidence,publics

def partial_runtime(b,p,oldraw,recovered):
 R.configuration(b);R.compose_contract(b);R.cleared_flags(b);current,raw=R.B.runtime();evidence,publics=factory_evidence(b,p,oldraw,current,raw);q=raw[QUOTE];need(all(q[k]==recovered[k]for k in('Id','Image','Config','HostConfig','RestartCount'))and sorted(q['Mounts'],key=enc)==sorted(recovered['Mounts'],key=enc)and q['State']['StartedAt']==recovered['State']['StartedAt'],'same-diagnosed-recovered-quote-before-continuation');args=[*R.COMPOSE,'-f',str(FAILED_DEPLOY/'rollback.private.yml')];revision=(oldraw[QUOTE]['Config'].get('Labels')or{}).get('org.opencontainers.image.revision');full_contract(QUOTE,oldraw[QUOTE],q,oldraw[QUOTE]['Image'],R.envs(),args,revision);need(R.proof(QUOTE,q['Image'],q['Id'],BASE)==b['sourceProof'][QUOTE]['files'],'recovered-original-quote-full-source');need(R.B.runtime()[0]==current,'partial-runtime-stable-through-readonly-proofs');return current,raw,evidence,publics

def recover(old,b,before,literal,rollback,closed,closed_path,attempted,stopped,result):
 # Original quote-only recovery order; each startup retains its own exact +N proof.
 R.maintenance('maintenance_on',QUOTE);R.owned_flags(b,QUOTE);need(not stopped or closed is not None,'no-restart-without-fresh-closed-quote-evidence')
 if stopped:R.replay_snapshot(QUOTE,closed,closed_path)
 comparison,comparison_path=closed,closed_path
 if attempted:
  cid=R.run([*rollback,'ps','-a','-q',QUOTE]).decode().strip();need(re.fullmatch('[a-f0-9]{12,64}',cid)is not None,'one-owned-failed-quote-candidate');R.operation(['docker','stop','--time','60',cid],'stop-failed-'+QUOTE,80);failed,fp=R.B.capture(QUOTE,'failed-candidate');R.replay_snapshot(QUOTE,failed,fp);started=json.loads(R.run(['docker','inspect',cid]))[0]['State']['StartedAt'];R.same_data(QUOTE,closed,failed,closed_path,fp,started);comparison,comparison_path=failed,fp;R.operation([*rollback,'up','-d','--force-recreate','--no-build','--no-deps','--pull','never',QUOTE],'recover-only-'+QUOTE,180)
 elif stopped:R.operation(['docker','start',old['Id']],'restart-only-original-'+QUOTE,80)
 R.maintenance('wait_service_ready',QUOTE);now,raw=R.B.runtime();R.unchanged_except(before,now,QUOTE);revision=(old['Config'].get('Labels')or{}).get('org.opencontainers.image.revision');full_contract(QUOTE,old,raw[QUOTE],old['Image'],literal,rollback,revision,allow_same=True);need(R.proof(QUOTE,old['Image'],raw[QUOTE]['Id'],BASE)==b['sourceProof'][QUOTE]['files'],'recovered-original-quote-full-source-and-assets')
 if closed is not None:
  after,ap=R.B.capture(QUOTE,'after-recovery');R.replay_snapshot(QUOTE,after,ap);R.same_data(QUOTE,comparison,after,comparison_path,ap,raw[QUOTE]['State']['StartedAt'])
 R.configuration(b);need(R.B.runtime()[0]==now,'runtime-stable-through-quote-recovery-capture');R.operation(['sleep','11'],'recovery-dns-'+QUOTE,20);R.maintenance('maintenance_off',QUOTE);R.maintenance('require_maintenance_cleared',QUOTE);R.cleared_flags(b);result['failedServiceRecoveredWithoutDataRestore']=True

def quote_audit(closed,post,closed_path,post_path,started):
 delta=R.same_data(QUOTE,closed,post,closed_path,post_path,started['candidateStartedAt']);return{'candidateStartedAt':started['candidateStartedAt'],'afterSnapshotObservedUTC':post['observedUTC'],'retentionCutoffBasis':None,'deletionActorOrExactTimesProven':False,'dataDeltaEvidence':delta,'businessTypedSchemaFilesAndOwnershipPreserved':True}

def deploy(result,b,p,oldraw,recovered):
 before,raw,inherited,publics=partial_runtime(b,p,oldraw,recovered);private('continuation-before-runtime.private.json',before);private('continuation-before-inspect.private.json',raw);private('inherited-factory-evidence.private.json',inherited);result['public']=publics;literal=R.envs();private('literal-environments.private.json',literal);args=R.overlay(p['images'],literal,'runtime.private.yml');rollback=R.overlay({s:raw[s]['Image']for s in ORDER},literal,'rollback.private.yml')
 live,lp=R.B.capture(QUOTE,'fresh-live');R.replay_snapshot(QUOTE,live,lp);need(R.B.runtime()[0]==before,'all46-stable-through-fresh-live-quote-backup');R.configuration(b);R.cleared_flags(b);private('fresh-live-backup.private.json',live);old=raw[QUOTE];closed=None;closed_path=None;attempted=False;stopped=False
 try:
  R.maintenance('maintenance_on',QUOTE);R.owned_flags(b,QUOTE);R.operation(['sleep','60'],'drain-'+QUOTE,70);R.operation(['docker','stop','--time','60',old['Id']],'stop-own-old-writer-'+QUOTE,80);stopped=True;R.stopped_runtime(before,old,QUOTE);closed,closed_path=R.B.capture(QUOTE,'closed-before');R.replay_snapshot(QUOTE,closed,closed_path);R.stopped_runtime(before,old,QUOTE);R.configuration(b);R.owned_flags(b,QUOTE);attempted=True;R.operation([*args,'up','-d','--force-recreate','--no-build','--no-deps','--pull','never',QUOTE],'recreate-only-'+QUOTE,180);R.maintenance('wait_service_ready',QUOTE);now,newraw=R.B.runtime();new=newraw[QUOTE];started={'candidateStartedAt':new['State']['StartedAt'],'containerId':new['Id'],'image':new['Image']};private('internal-quote-candidate-started.private.json',started);full_contract(QUOTE,old,new,p['images'][QUOTE],literal,args,TARGET);R.unchanged_except(before,now,QUOTE);need(R.proof(QUOTE,p['images'][QUOTE],new['Id'])==p['proofs'][QUOTE],'continued-quote-current-source-equals-original-prepared');post,post_path=R.B.capture(QUOTE,'after-start');R.replay_snapshot(QUOTE,post,post_path);need(R.B.runtime()[0]==now,'all46-stable-through-new-quote-closed-comparison');audit=quote_audit(closed,post,closed_path,post_path,started);private('internal-quote-closed-comparison.private.json',audit);private('closed-evidence.private.json',{'before':closed,'after':post,'started':started,'audit':audit});R.configuration(b);R.owned_flags(b,QUOTE);R.operation(['sleep','11'],'dns-grace-'+QUOTE,20);R.maintenance('maintenance_off',QUOTE);R.maintenance('require_maintenance_cleared',QUOTE);R.cleared_flags(b);result['public'][QUOTE]=R.public(QUOTE,p['proofs'][QUOTE]);need(R.B.runtime()[0]==now,'all46-stable-after-quote-public-smoke');private('final-runtime.private.json',now)
 except BaseException:
  result['failedService']=QUOTE
  try:recover(old,b,before,literal,rollback,closed,closed_path,attempted,stopped,result)
  except BaseException:result['failedServiceRetainsOwnMaintenance']=True;private('quote-recovery-failure.private.txt',traceback.format_exc().encode())
  raise
 R.configuration(b);R.compose_contract(b);R.cleared_flags(b);result.update(success=True,completedServices=[QUOTE],inheritedCompletedServices=list(FACTORIES),allOther43ContainersUnchanged=True,bothCompletedFactoryContainersUnchanged=True,allBusinessTypedRowsSchemaFilesAndModeOwnersPreserved=True,entireEnvironmentFileAndRuntimeEnvironmentsUnchanged=True,allMaintenanceFlagsRestored=True,buildsPerformed=False,images=p['images'],freshLiveQuoteBackupBeforeMaintenance=True)

def verify(result,b,p,oldraw,recovered):
 receipt=R.sealed(DEPLOY,DEPLOY_MANIFEST,DEPLOY_RESULT,'deploy');need(receipt.get('completedServices')==[QUOTE]and receipt.get('inheritedCompletedServices')==list(FACTORIES)and receipt.get('buildsPerformed')is False,'successful-quote-only-continuation');R.configuration(b);R.compose_contract(b);R.cleared_flags(b);current,raw=R.B.runtime();need(current==read(DEPLOY/'final-runtime.private.json'),'same-successful-final-runtime');inherited,publics=factory_evidence(b,p,oldraw,current,raw);need(inherited==read(DEPLOY/'inherited-factory-evidence.private.json'),'same-original-two-factory-closed-evidence');before=read(DEPLOY/'continuation-before-runtime.private.json');before_raw=read(DEPLOY/'continuation-before-inspect.private.json');need(before_raw[QUOTE]['Id']==recovered['Id']and before_raw[QUOTE]['Image']==recovered['Image']and before_raw[QUOTE]['State']['StartedAt']==recovered['State']['StartedAt'],'continued-from-diagnosed-recovered-quote');R.unchanged_except(before,current,QUOTE);literal=R.envs();need(literal==read(DEPLOY/'literal-environments.private.json'),'all-original-literal-environments-preserved');live=read(DEPLOY/'fresh-live-backup.private.json');need(live==read(DEPLOY/'internal-quote-fresh-live.private.json'),'fresh-live-backup-capture-binding');R.replay_snapshot(QUOTE,live,DEPLOY/'internal-quote-fresh-live')
 e=read(DEPLOY/'closed-evidence.private.json');a,c,started,audit=(e[k]for k in('before','after','started','audit'));need(started=={'candidateStartedAt':raw[QUOTE]['State']['StartedAt'],'containerId':raw[QUOTE]['Id'],'image':p['images'][QUOTE]}and started==read(DEPLOY/'internal-quote-candidate-started.private.json'),'new-quote-candidate-exact-current-binding');ap=DEPLOY/'internal-quote-closed-before';cp=DEPLOY/'internal-quote-after-start';need(a==read(DEPLOY/'internal-quote-closed-before.private.json')and c==read(DEPLOY/'internal-quote-after-start.private.json'),'new-quote-closed-capture-binding');R.replay_snapshot(QUOTE,a,ap);R.replay_snapshot(QUOTE,c,cp);need(audit==quote_audit(a,c,ap,cp,started)==read(DEPLOY/'internal-quote-closed-comparison.private.json'),'new-quote-exact-one-startup-data-audit-reproduced');args=[*R.COMPOSE,'-f',str(DEPLOY/'runtime.private.yml')];full_contract(QUOTE,before_raw[QUOTE],raw[QUOTE],p['images'][QUOTE],literal,args,TARGET);need(R.proof(QUOTE,p['images'][QUOTE],raw[QUOTE]['Id'])==p['proofs'][QUOTE],'current-quote-full-source-assets-equal-original-prepared');publics[QUOTE]=R.public(QUOTE,p['proofs'][QUOTE]);R.configuration(b);need(R.B.runtime()[0]==current,'all46-stable-through-readonly-final-verification');R.cleared_flags(b);private('verified-runtime.private.json',current);result.update(success=True,public=publics,allThreePreparedSourcesAndRuntimeContractsVerified=True,allThreeSealedClosedDataChecksReproduced=True,allOther43ContainersUnchanged=True,bothCompletedFactoryContainersUnchanged=True,entireEnvironmentFileAndRuntimeEnvironmentsUnchanged=True,allMaintenanceFlagsRestored=True,freshLiveBusinessComparisonPerformed=False,buildsPerformed=False,images=p['images'])

def main():
 global OUT
 need(PHASE in{'deploy','verify'}and sys.argv[1:]==[PHASE]and os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_ATTEMPT')=='1'and TARGET==EXPECTED_TARGET and TREE==EXPECTED_TREE and all(pin(v)for v in(BACKUP_MANIFEST,BACKUP_RESULT,PREPARE_MANIFEST,PREPARE_RESULT))and(PHASE=='deploy'or all(pin(v)for v in(DEPLOY_MANIFEST,DEPLOY_RESULT))),'blank-or-wrong-phase-source-priors-branch-attempt');os.umask(0o077);OUT=DEPLOY if PHASE=='deploy'else VERIFY;OUT.mkdir(mode=0o700);initialize();signal.signal(signal.SIGTERM,lambda *_:need(False,'terminated'));result={'mode':PHASE,'base':BASE,'target':TARGET,'tree':TREE,'success':False,'businessWritesPerformed':False,'databaseRestoreOrCursorResetPerformed':False,'modelCallsPerformed':False,'authenticatedBusinessWritesPerformed':False,'otherServicesRequested':False,'secretOrRowsPrinted':False,'environmentConfigurationChanged':False,'factoryLifecycleOperationsPerformed':False,'quoteSequencePolicy':'only-exact-unchanged-startup-conflict-consumption-no-reset-no-actor-attribution'}
 try:
  b,p,oldraw,recovered=priors();R.EXPECTED_ENV=(BACKUP/'environment.private').read_bytes();{'deploy':deploy,'verify':verify}[PHASE](result,b,p,oldraw,recovered);priors()
 except BaseException as error:result.update(success=False,failedStage=STAGE,releaseLibraryFailedStage=R.STAGE,backupLibraryFailedStage=R.B.STAGE,safeExceptionType=type(error).__name__);private('failure.private.txt',traceback.format_exc().encode())
 finally:private('first-result.json',result);R.B.F.OPS.L.seal(OUT);print(enc(dict(result,manifestSHA256=R.B.F.OPS.L.file_hash(OUT/'manifest.json'),resultSHA256=R.B.F.OPS.L.file_hash(OUT/'first-result.json'))).decode(),flush=True)
 return 0 if result['success']else 1
if __name__=='__main__':
 try:sys.exit(main())
 except SystemExit:raise
 except BaseException:print('{"mode":"rejected","success":false,"safeFailure":"INERT_OR_PREFLIGHT_REJECTED"}',flush=True);sys.exit(1)
