"""Inert PR986 production-only resume using the original frozen release helpers.

No rebuild, model calls, migrations, data restore or test-container recreation.
The one retention correction uses the sealed after-snapshot observation cutoff;
new log timestamps still must be within exact candidate start..observation.
"""
import copy,hashlib,importlib.util,json,os,pathlib,re,signal,stat,subprocess,sys,traceback
PHASE=''
ROOT=pathlib.Path('/opt/rr-portal');BASE='556798afb260020ca8f990c66290177ad0bf3e44';TARGET='97d563e93aca3d9e3c0bc512dd622d6a3002e710';TREE='ad906e8b24b81df8e7ade91d15c5e9ab4ab839ab';BRANCH='refs/heads/ops/pr-986-20261021'
RESUME=ROOT/'deploy/backups/pr-986-20261021-resume';VERIFY=RESUME.with_name('pr-986-20261021-resume-verify');RESUME_MANIFEST='';RESUME_RESULT=''
DEPS={'pr986-release-library.py':'3441d89e4ed33ef0ac2cfd20bfa1ab3618f92f5ae4904a61786707f604050688','factory-review-backup-library.py':'79d76bb47312dd08c121ebe2797f54d958666f8b72d00721f67712b152fc4666','batch-host-config-library.py':'bd1842dc6847f3e0e5c0c38374c3604791f66d1c94dc651457607dc338f38ff1','release-data-ops-library.py':'ff9138a1d5bfed1b10077112da6ebcda2d65240f583e2d0e12ce1325cfbaafd5','release-data-library.py':'d63168fd3057f4f2aba2d93f9fab31d2d65c6dd0f3234877d71fcff1e04e62b9','pr986-reviewed-files.json':'41b2007efcf669f17d0f2061f2fd67cf6af99241c3abed1a05a802e38d04de40'}
ARCHIVES={'backup':('pr-986-20261021-backup','5663afabd6a7a3c1923bfbd7fa3806429f94ac3042bff53e0b12fac0fa74cdd7','12271c965cd359d715caba26ea53e471d5e07f63e4d7605a339f720bb954a273'),'prepare':('pr-986-20261021-prepare','dddcfdaca6b1c0cef03c42ffadf50fd9dc71dc9f94f62a6ec09a84ca8c47b7a2','17a7197f4435db08a6ce54877974057e2ebbb2848dbe1cfa1f80c16de29162ca'),'deploy':('pr-986-20261021-deploy','5757e2fe6dcbcaa889c7a9a743cd2c98a07bf3646fd6680b6bb17912d20e5115','24b9cd70f51c1b65fd9fb58d21e6d484145c6b6c628be6c8c8fb42b1ee6c98b2'),'diagnose':('pr-986-20261021-log-diagnose','c787c044b8f11b8b40d5b7ab7cd29c2bfeba7ad864102426a08c736b951c241c','e6ed81bc640fb7cae4255359d6a6ce74b43c24795d8e41c89de325de4214cf64')}
S=None;OUT=None;STAGE='entrypoint';PROD='factory-review';TEST='factory-review-test'

def need(v,label):
 global STAGE
 if not v:STAGE=label;raise RuntimeError('PR986_RESUME_REJECTED')
def enc(v):return json.dumps(v,ensure_ascii=True,sort_keys=True,separators=(',',':'),allow_nan=False).encode()
def sha(v):return hashlib.sha256(v).hexdigest()
def read(p):return json.loads(p.read_bytes())
def private(n,v):S.private(n,v)
def run(args,data=None,timeout=180):return S.run(args,data,timeout)
def operation(args,label,timeout=180):return S.operation(args,label,timeout)
def load():
 for n,h in DEPS.items():
  p=pathlib.Path(__file__).with_name(n);need(p.is_file()and not p.is_symlink()and sha(p.read_bytes())==h,'exact-frozen-dependency')
 p=pathlib.Path(__file__).with_name('pr986-release-library.py');spec=importlib.util.spec_from_file_location('pr986_original_release',p);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);need(m.PHASE==''and m.TARGET==''and m.TREE=='','inert-release-dependency');return m
def initialize():
 global S
 S=load();S.ROOT=ROOT;S.OUT=OUT;S.TARGET=TARGET;S.TREE=TREE;S.SOURCE_MANIFEST_SHA=DEPS['pr986-reviewed-files.json'];S.BACKUP_MANIFEST=ARCHIVES['backup'][1];S.BACKUP_RESULT=ARCHIVES['backup'][2];S.PREPARE_MANIFEST=ARCHIVES['prepare'][1];S.PREPARE_RESULT=ARCHIVES['prepare'][2];S.F=S.load('factory-review-backup-library.py');S.F.BASE=BASE;S.F.OUT=OUT;S.F.OPS=S.F.load('release-data-ops-library.py');S.F.OPS.L=S.F.OPS.load_library(pathlib.Path(__file__).with_name('release-data-library.py'));S.F.OPS.run=S.F.run;S.H=S.load('batch-host-config-library.py');S.ENV=dict(os.environ,COMPOSE_PROJECT_NAME='rr-portal',COMPOSE_BAKE='false',COMPOSE_PARALLEL_LIMIT='1',MAINT_FLAG_DIR=str(ROOT/'deploy/maintenance'),COMPOSE_FILE=str(ROOT/'docker-compose.cloud.yml'),ENV_FILE=str(ROOT/'.env.cloud.production'),MAINT_COMPOSE_SERVICES=PROD,MAINT_HEALTH_TIMEOUT_SECONDS='300',MAINT_DNS_GRACE_SECONDS='10')
def sealed(mode):
 name,mhash,rhash=ARCHIVES[mode];p=ROOT/'deploy/backups'/name;need(p.is_dir()and not p.is_symlink()and stat.S_IMODE(p.stat().st_mode)==0o700,'private-original-directory');need(S.F.OPS.L.file_hash(p/'manifest.json')==mhash and S.F.OPS.L.file_hash(p/'first-result.json')==rhash,'original-result-seals');manifest=read(p/'manifest.json');files=list(p.rglob('*'));need(len(files)<=100000 and all(not f.is_symlink()and(f.is_dir()or f.is_file())and f.stat().st_mode&0o077==0 for f in files),'private-original-entries');need(set(manifest)=={str(f.relative_to(p))for f in files if f.is_file()and f!=p/'manifest.json'}and all(S.F.OPS.L.safe_path(n)and re.fullmatch('[a-f0-9]{64}',h)and S.F.OPS.L.file_hash(p/n)==h for n,h in manifest.items()),'complete-original-byte-seals');r=read(p/'first-result.json');need(r['mode']==mode and r['base']==BASE and r['success']is(mode!='deploy'),'known-original-outcome')
 if mode!='backup':need(r['target']==TARGET and r['tree']==TREE,'known-original-target')
 if mode=='deploy':need(r.get('failedService')==PROD and r.get('completedServices')==[TEST]and r.get('failedServiceRolledBackWithoutRestoringData')is True and r.get('failedStage')=='retained-logs-typed-identical-only-valid-additions-or-retention','exact-original-partial-deploy')
 return p,r
def evidence():
 original={m:sealed(m)for m in ARCHIVES};b=S.baseline();p=read(original['prepare'][0]/'prepared.private.json');need(p['target']==TARGET and p['tree']==TREE,'prepared-existing-candidates');diag=original['diagnose'][1];current=diag['currentRuntime'];need(current['allOther44ContainersUnchanged']and current['maintenanceFlagsEqualBaseline']and current['environmentBytesAndModeOwnerEqualBaseline'],'diagnosed-stable-recovered-runtime');r=diag['logComparisons'][PROD];a=r['existingSealedAudit'];need(a['retainedTypedChanged']==0 and a['newRows']==0 and a['missing']==2913 and r['retainedTypedIdentical']==90930 and r['missingDefinitelyAgeEligible']==2912 and r['missingPossiblyAgeEligible']==1 and r['missingDefinitelyNotAgeEligible']==0 and r['missingInvalidCreated']==0 and r['policyAvailableAndUnchanged']is True and r['policyBefore']['maxDays']==5 and r['policyBefore']['minLevel']==0,'exact-diagnosed-retention-boundary');return b,p
def source_at(image,cid,revision):
 old=S.TARGET;S.TARGET=revision
 try:return S.proof(image,cid)
 finally:S.TARGET=old
def full_config(service,old,new,image,literal,args,revision):
 need(new['Image']==image and new['Config'].get('Image')==image and new['RestartCount']==0 and new['State']['Running']is True and new['State']['OOMKilled']is False and new['State'].get('Health',{}).get('Status')=='healthy','healthy-exact-immutable-image');need(S.H.same_host_config(old['HostConfig'],new['HostConfig'])and sorted(old['Mounts'],key=enc)==sorted(new['Mounts'],key=enc),'full-hostconfig-and-mounts');a,c=copy.deepcopy(old['Config']),copy.deepcopy(new['Config']);left=a.pop('Labels')or{};right=c.pop('Labels')or{};need(a.pop('Hostname')==old['Id'][:12]and c.pop('Hostname')==new['Id'][:12],'automatic-hostnames');a.pop('Image');c.pop('Image');a.pop('Env');c.pop('Env');need(a==c and S.F.envmap(new['Config']['Env'])==literal[service],'complete-config-and-literal-environment');pm=read(S.BACKUP/(service+'-literal-process-environment.private.json'));pm.update({k:v for k,v in literal[service].items()if k in S.ALLOW});need(S.envmap_process(new['Id'])==pm,'complete-pid1-environment')
 if new['Id']==old['Id']:need(right==left,'same-original-id-labels-identical');return
 expected=copy.deepcopy(left);expected['com.docker.compose.image']=image;expected['com.docker.compose.project.config_files']=','.join([str(ROOT/'docker-compose.cloud.yml'),args[-1]]);hashes=run([*args,'config','--hash',service]).decode().split();need(len(hashes)==2 and hashes[0]==service and re.fullmatch('[a-f0-9]{64}',hashes[1]),'exact-compose-config-hash');expected['com.docker.compose.config-hash']=hashes[1]
 if revision is not None:expected['org.opencontainers.image.revision']=revision
 need(right==expected,'only-exact-compose-and-source-labels')
def owned_flags(b):
 before={r['path']:r for r in b['maintenanceInventory']};now={r['path']:r for r in S.flags()};own=now.pop('services/'+PROD,None);need(own=={'path':'services/'+PROD,'directory':False,'mode':0o600,'bytes':0,'sha256':sha(b'')},'only-empty-private-owned-maintenance')
 if'services'not in before:
  need(now.pop('services',None)=={'path':'services','directory':True,'mode':0o700},'only-owned-new-services-directory')
 need(now==before,'every-other-maintenance-path-identical')
def cleared_flags(b):
 if not any(r['path']=='services'for r in b['maintenanceInventory']):
  directory=ROOT/'deploy/maintenance/services'
  if directory.exists():need(directory.is_dir()and not directory.is_symlink()and not list(directory.iterdir()),'only-owned-empty-services-directory-cleanup');directory.rmdir()
 need(S.flags()==b['maintenanceInventory'],'all-original-maintenance-flags-restored')
def stopped_runtime(before,old):
 original=S.F.SERVICES;S.F.SERVICES={TEST:original[TEST]}
 try:current,_=S.F.runtime()
 finally:S.F.SERVICES=original
 row=current['others'].pop(old['Id'],None);need(row is not None and row['running']is False and row['image']==old['Image'],'only-production-writer-stopped');need(all(row[k]==before['targets'][PROD][k]for k in('configSHA256','hostConfigSHA256','mounts','started','restarts')),'stopped-production-config-preserved');need(current['others']==before['others']and current['targets'][TEST]==before['targets'][TEST],'test-and44-stable-through-closed-capture');return current
def original_environment(b):
 need((ROOT/'.env.cloud.production').read_bytes()==(S.BACKUP/'environment.private').read_bytes()and S.F.file_metadata(ROOT/'.env.cloud.production')==b['environmentFileMetadata'],'original-private-environment-bytes-mode-owner')
def persistent_configuration(b,literal,expected_bytes):
 need((ROOT/'.env.cloud.production').read_bytes()==expected_bytes and S.F.file_metadata(ROOT/'.env.cloud.production')==b['environmentFileMetadata'],'persistent-env-exact-bytes-mode-owner');rendered=json.loads(run([*S.COMPOSE,'config','--format','json']));original=read(S.BACKUP/'compose-render.private.json');need(S.normalized_ai_declaration(rendered['services'][TEST]['environment'])==S.normalized_ai_declaration(original['services'][TEST]['environment']),'normal-compose-test-full-declared-environment-preserved')
 for key in S.ALLOW:need(rendered['services'][PROD]['environment'].get(key)==literal[PROD][key].replace('$','$$'),'normal-compose-production-five-ai-vars')
def preflight(b,p):
 S.source(b,TARGET);original_environment(b);runtime,raw=S.F.runtime();need(runtime['others']==b['runtime']['others']and len(runtime['others'])==44 and S.flags()==b['maintenanceInventory'],'fresh-partial-runtime-and-flags');oldraw=read(S.BACKUP/'factory-inspect.private.json');literal=S.envs();args_test=[*S.COMPOSE,'-f',str(ROOT/'deploy/backups/pr-986-20261021-deploy/runtime.private.yml')];args_prod=[*S.COMPOSE,'-f',str(ROOT/'deploy/backups/pr-986-20261021-deploy/rollback.private.yml')];full_config(TEST,oldraw[TEST],raw[TEST],p['images'][TEST],literal,args_test,TARGET);full_config(PROD,oldraw[PROD],raw[PROD],b['runtime']['targets'][PROD]['image'],literal,args_prod,(oldraw[PROD]['Config'].get('Labels')or{}).get('org.opencontainers.image.revision'));need(S.proof(p['images'][TEST],raw[TEST]['Id'])==p['proofs'][TEST]and source_at(raw[PROD]['Image'],raw[PROD]['Id'],S.RUNNING_BASE)==b['sourceProof'][PROD]['files'],'current-test-new-production-old-exact-source');private('fresh-partial-runtime.private.json',{'runtime':runtime,'raw':raw});return runtime,raw
def logs_at_observation(oldpath,newpath,olddata,newdata,started,observed):
 # Keep the original typed-retention and exact new-row-window predicates.
 # Only the policy cutoff is evaluated at the sealed observation upper bound.
 original=S.log_policy
 def cutoff_at_end(path,unused):return original(path,observed)
 S.log_policy=cutoff_at_end
 try:return S.logs_retention(oldpath,newpath,olddata,newdata,started,observed)
 finally:S.log_policy=original
def audit_logs(before_path,after_path,started,after):
 counts=logs_at_observation(before_path/'sqlite/auxiliary.db',after_path/'sqlite/auxiliary.db',before_path/'sqlite/data.db',after_path/'sqlite/data.db',started,after['observedUTC']);private('production-retention-log-audit.private.json',{'candidateStartedAt':started,'afterSnapshotObservedUTC':after['observedUTC'],'retentionCutoffBasis':'after_snapshot_observation','deletionActorOrExactTimesProven':False,'counts':counts});need(counts['compatibleWithoutChangingRetainedRows'],'strict-retained-logs-and-observation-retention');return counts
def run_resume(result,b,p):
 global STAGE
 STAGE='resume-fresh-partial-preflight';before,raw=preflight(b,p);old=raw[PROD];literal=S.intended();need(literal[TEST]==S.envs()[TEST],'test-full-literal-environment-unchanged');args=S.overlay(p['images'],literal,'runtime.private.yml');rollback_images=dict(p['images']);rollback_images[PROD]=old['Image'];rollback=S.overlay(rollback_images,S.envs(),'rollback.private.yml');oldenv=(S.BACKUP/'environment.private').read_bytes();newenv=S.new_env_bytes(oldenv,literal);private('updated-environment.private',newenv);private('resume-start.private.json',{'runtime':before,'raw':raw,'literal':literal,'images':p['images']});closed=None;closed_path=None;attempted=False;changed_env=False
 try:
  STAGE='resume-scoped-maintenance-drain-stop';S.maintenance('maintenance_on',PROD);operation(['sleep','60'],'resume-drain-production',70);now,_=S.F.runtime();need(now==before,'runtime-stable-before-stop');owned_flags(b)
  operation(['docker','stop','--time','60',old['Id']],'resume-stop-current-production',80);stopped=json.loads(run(['docker','inspect',old['Id']]))[0];need(stopped['State']['Running']is False,'production-writer-stopped')
  STAGE='resume-fresh-closed-business-snapshot';closed_runtime=stopped_runtime(before,old);private('closed-runtime.private.json',closed_runtime);closed,closed_path=S.capture(PROD,'resume-closed-before');need(stopped_runtime(before,old)==closed_runtime,'closed-runtime-stable-during-snapshot');owned_flags(b);S.source(b,TARGET);original_environment(b)
  STAGE='resume-persist-five-production-vars';S.atomic_env(newenv,b['environmentFileMetadata']);changed_env=True;persistent_configuration(b,literal,newenv)
  STAGE='resume-only-production-existing-candidate';attempted=True;operation([*args,'up','-d','--force-recreate','--no-build','--no-deps','--pull','never',PROD],'resume-recreate-only-production',180);S.maintenance('wait_service_ready',PROD);after,newraw=S.F.runtime();new=newraw[PROD];S.contract(PROD,old,new,literal,p['images'][PROD],args);full_config(PROD,old,new,p['images'][PROD],literal,args,TARGET);need(after['others']==before['others']and after['targets'][TEST]==before['targets'][TEST],'all44-and-test-unchanged');need(S.proof(p['images'][PROD],new['Id'])==p['proofs'][PROD],'production-exact-prepared-source');started=new['State']['StartedAt'];private('production-candidate-started.private.json',{'candidateStartedAt':started})
  STAGE='resume-closed-data-and-retention-contract';post,post_path=S.capture(PROD,'resume-after-start');S.same_data(closed,post);logs=audit_logs(closed_path,post_path,started,post);need(S.F.runtime()[0]==after,'resumed-runtime-stable');S.source(b,TARGET)
  STAGE='resume-clear-only-owned-maintenance';operation(['sleep','11'],'resume-dns-grace',20);S.maintenance('maintenance_off',PROD);S.maintenance('require_maintenance_cleared',PROD);cleared_flags(b);result['public']=S.public(PROD,p['proofs'][PROD]);need(S.F.runtime()[0]==after,'final-resumed-runtime-stable');private('runtime-after.private.json',after);result.update(success=True,onlyProductionRecreated=True,testContainerUnchanged=True,allOther44ContainersUnchanged=True,closedBusinessSchemaAndTypedRowsPreserved=True,allFilesAndMetadataPreserved=True,productionImage=p['images'][PROD],candidateStartedAt=started,afterSnapshotObservedUTC=post['observedUTC'],logAudit=logs,retentionCutoffBasis='after_snapshot_observation',deletionActorOrExactTimesProven=False)
 except BaseException:
  first=STAGE;result['originalFailedStage']=first
  try:
   S.maintenance('maintenance_on',PROD)
   if attempted:
    current=run([*args,'ps','-a','-q',PROD]).decode().strip()
    if current:need(re.fullmatch('[a-f0-9]{64}',current),'only-production-recovery-id');operation(['docker','stop','--time','60',current],'resume-stop-failed-production',80)
    failed,failed_path=S.capture(PROD,'resume-failed-candidate');S.same_data(closed,failed)
    if changed_env:S.atomic_env(oldenv,b['environmentFileMetadata']);changed_env=False
    operation([*rollback,'up','-d','--force-recreate','--no-build','--no-deps','--pull','never',PROD],'resume-rollback-current-old-image',180)
   else:
    if changed_env:S.atomic_env(oldenv,b['environmentFileMetadata']);changed_env=False
    current=json.loads(run(['docker','inspect',old['Id']]))[0]
    if not current['State']['Running']:operation(['docker','start',old['Id']],'resume-restart-original-production',80)
   S.maintenance('wait_service_ready',PROD);S.recovered(PROD,old,b,before,closed);recovered,recovered_raw=S.F.runtime();full_config(PROD,old,recovered_raw[PROD],old['Image'],S.envs(),rollback,(old['Config'].get('Labels')or{}).get('org.opencontainers.image.revision'));original_environment(b);operation(['sleep','11'],'resume-recovery-dns-grace',20);S.maintenance('maintenance_off',PROD);S.maintenance('require_maintenance_cleared',PROD);cleared_flags(b);result['productionRolledBackWithoutRestoringData']=True
  except BaseException:result['productionRetainsScopedMaintenance']=True;result['recoveryFailedStage']=STAGE
  STAGE=first;raise
def verify(result,b,p):
 global STAGE
 STAGE='verify-resume-sealed-result';r=S.sealed(RESUME,RESUME_MANIFEST,RESUME_RESULT);need(r['mode']=='resume'and r['target']==TARGET and r['tree']==TREE and r.get('onlyProductionRecreated')is True,'completed-production-only-resume');initial=read(RESUME/'resume-start.private.json');expected=read(RESUME/'runtime-after.private.json');runtime,raw=S.F.runtime();need(runtime==expected and runtime['others']==b['runtime']['others']and runtime['targets'][TEST]==initial['runtime']['targets'][TEST]and S.flags()==b['maintenanceInventory'],'final-two-services-and44-containers');literal=initial['literal'];persistent_configuration(b,literal,(RESUME/'updated-environment.private').read_bytes());S.source(b,TARGET);args=[*S.COMPOSE,'-f',str(RESUME/'runtime.private.yml')];full_config(PROD,initial['raw'][PROD],raw[PROD],p['images'][PROD],literal,args,TARGET)
 STAGE='verify-sealed-closed-data-and-exact-log-window';before=read(RESUME/'factory-review-resume-closed-before.private.json');after=read(RESUME/'factory-review-resume-after-start.private.json');S.same_data(before,after);started=read(RESUME/'production-candidate-started.private.json')['candidateStartedAt'];counts=logs_at_observation(RESUME/'factory-review-resume-closed-before/sqlite/auxiliary.db',RESUME/'factory-review-resume-after-start/sqlite/auxiliary.db',RESUME/'factory-review-resume-closed-before/sqlite/data.db',RESUME/'factory-review-resume-after-start/sqlite/data.db',started,after['observedUTC']);need(counts['compatibleWithoutChangingRetainedRows'],'sealed-retention-contract-reproduced')
 for service in(TEST,PROD):need(S.proof(p['images'][service],raw[service]['Id'])==p['proofs'][service],'final-reviewed-source');result.setdefault('public',{})[service]=S.public(service,p['proofs'][service])
 need(S.F.runtime()[0]==runtime,'final-runtime-stable');result.update(success=True,productionImage=p['images'][PROD],bothServicesExactPreparedSource=True,testContainerUnchanged=True,allOther44ContainersUnchanged=True,closedDataAndLogContractReproduced=True,productionProvider='qwen',productionModel='qwen3.8-max',testAIEnabled=False)
def main():
 global OUT
 need(PHASE in{'resume','resume-verify'}and sys.argv[1:]==[PHASE]and os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_ATTEMPT')=='1','false-draft-or-wrong-phase');os.umask(0o077);OUT=RESUME if PHASE=='resume'else VERIFY;OUT.mkdir(mode=0o700);initialize();signal.signal(signal.SIGTERM,lambda *_:need(False,'terminated'));result={'mode':PHASE,'base':BASE,'target':TARGET,'tree':TREE,'success':False,'buildsPerformed':False,'modelCallsPerformed':False,'businessAPIMutationsPerformed':False,'databaseRestoreOrSequenceResetPerformed':False,'testServiceRecreated':False}
 try:
  b,p=evidence();{'resume':run_resume,'resume-verify':verify}[PHASE](result,b,p);evidence()
 except BaseException as error:result.update(success=False,failedStage=STAGE,libraryFailedStage=S.STAGE,safeExceptionType=type(error).__name__);private('failure.private.txt',traceback.format_exc().encode())
 finally:
  private('first-result.json',result);S.F.OPS.L.seal(OUT);print(enc(dict(result,manifestSHA256=S.F.OPS.L.file_hash(OUT/'manifest.json'),resultSHA256=S.F.OPS.L.file_hash(OUT/'first-result.json'))).decode(),flush=True)
 return 0 if result['success']else 1
if __name__=='__main__':
 try:sys.exit(main())
 except SystemExit:raise
 except BaseException:print('{"success":false,"safeFailure":"PR986_RESUME_PREFLIGHT_REJECTED"}',flush=True);sys.exit(1)
