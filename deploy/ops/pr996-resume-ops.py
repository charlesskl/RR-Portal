"""Inert one-shot resume of the exact never-started sealed indo candidate.
Restore complete closed keys before one first start; preserve all PG and 45 peers.
"""
import copy,hashlib,http.client,importlib.util,json,os,pathlib,re,socket,stat,sys,traceback
RESUME_PIN=False
ROOT=pathlib.Path('/opt/rr-portal')
BRANCH='refs/heads/ops/pr-996-20261023-04'
BASE='6742f820c0a43388e274b867a2825a42548b5cea'
TARGET='2de4be7bdb0fa983dc86259701a3c4f3ddd14234'
TREE='d41d5f98f97ee0cd34b0a868fb7283f57841ee4e'
OUT=ROOT/'deploy/backups/pr-996-20261023-04-resume'
FAILED=ROOT/'deploy/backups/pr-996-20261023-04-deploy'
FAILED_MANIFEST='86265206df9fac3bc4365b4ebcd757a63f86389fc0eea1ce3c20784e4481aeaf'
FAILED_RESULT='5c5fd71a8167568da85ae3f908365a5f3c188a9c7d3ccf710ff078ef98770f29'
BACKUP_MANIFEST='9d0618f4e28efa4c97d9cf65cb3e53cbb73a9bb92d9546d7b556cea9bef81a31'
BACKUP_RESULT='e4633500509d7aaecca38761804767fbcb9ac5f6f0a5d6f29dfb91623c85cb7a'
PREPARE_MANIFEST='e71e9bb2afa4975cf1312eb3e47a60a32a913d86816a2d9d7d57b1e6bb7136b9'
PREPARE_RESULT='b996eddb5b15ac0de726eebb9b82aeb31556cee025ee56a4d5600fb4cd67342a'
IMAGE='sha256:d707aee7bf0f5ba758441b1e8d6317c66d36ffe770ef11241982a6f49f94bcd2'
DEPS={'pr996-resume-release-library.py':'a470f45ee2b27246653163b40bcec0cd58fdccc2bb80926f7c2a8769439767a9','pr996-04-backup-library.py':'b433486575a40fba04a179a4549227d2657f6abb49b34a743c244fae2a6f08c9','factory-review-backup-library.py':'79d76bb47312dd08c121ebe2797f54d958666f8b72d00721f67712b152fc4666','release-data-ops-library.py':'ff9138a1d5bfed1b10077112da6ebcda2d65240f583e2d0e12ce1325cfbaafd5','release-data-library.py':'d63168fd3057f4f2aba2d93f9fab31d2d65c6dd0f3234877d71fcff1e04e62b9','qc-source-library.py':'4745c90f126cf46106b0f170a3ebc6b24ccb64c0e963e427d13308d5cb5b54f5','portable-pdb-library.py':'cf66f655a1e166491c4da67da0824f42ac8cdae3f844044cb5d8f7233ba105c5','batch-host-config-library.py':'bd1842dc6847f3e0e5c0c38374c3604791f66d1c94dc651457607dc338f38ff1','pr996-04-reviewed-files.json':'fb1567df15dba946e0d32660ccb5f162f0654e7fb3a67d1ca652909676f23edb'}
R=None;STAGE='entrypoint'
def need(v,label):
 global STAGE
 if not v:STAGE=label;raise RuntimeError('PR996_RESUME_REJECTED')
def sha(b):return hashlib.sha256(b).hexdigest()
def enc(v):return json.dumps(v,sort_keys=True,separators=(',',':'),ensure_ascii=True,allow_nan=False).encode()
def read(p):return json.loads(p.read_bytes())
def initialize():
 global R
 for n,h in DEPS.items():
  p=pathlib.Path(__file__).with_name(n);need(p.is_file()and not p.is_symlink()and sha(p.read_bytes())==h,'all-frozen-transitive-sources')
 p=pathlib.Path(__file__).with_name('pr996-resume-release-library.py');spec=importlib.util.spec_from_file_location('resume_frozen_release',p);R=importlib.util.module_from_spec(spec);spec.loader.exec_module(R);need(R.PHASE==R.TARGET==R.TREE==R.BACKUP_MANIFEST==R.BACKUP_RESULT==R.PREPARE_MANIFEST==R.PREPARE_RESULT==R.DEPLOY_MANIFEST==R.DEPLOY_RESULT=='','inert-frozen-release-nine-empty-gates');R.OUT=OUT;R.TARGET=TARGET;R.TREE=TREE;R.BACKUP_MANIFEST=BACKUP_MANIFEST;R.BACKUP_RESULT=BACKUP_RESULT;R.PREPARE_MANIFEST=PREPARE_MANIFEST;R.PREPARE_RESULT=PREPARE_RESULT;R.initialize();native=R.H.same_host_config
 def scoped_host(expected,observed):
  if type(expected)is not dict or type(observed)is not dict:return False
  a,b=copy.deepcopy(expected),copy.deepcopy(observed)
  if 'OomKillDisable'in a and 'OomKillDisable'in b and(a['OomKillDisable']is None or a['OomKillDisable']is False)and(b['OomKillDisable']is None or b['OomKillDisable']is False):a['OomKillDisable']=b['OomKillDisable']=False
  return native(a,b)
 R.H.same_host_config=scoped_host

def fixed_absence(cid):
 need(re.fullmatch('[a-f0-9]{64}',cid)is not None,'exact-fixed-candidate-id')
 class Engine(http.client.HTTPConnection):
  def connect(self):self.sock=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM);self.sock.settimeout(8);self.sock.connect('/var/run/docker.sock')
 connection=Engine('localhost',timeout=8)
 try:connection.request('HEAD','/containers/'+cid+'/archive?path=%2Fhome%2Fapp%2F.aspnet');response=connection.getresponse();need(response.status==404,'fresh-structured-key-directory-absence-required')
 finally:connection.close()
 return{'status':404,'responseBodyRead':False,'fixedExactContainerArchivePathOnly':True}

def resume(result):
 b=R.baseline();R.EXPECTED_ENV=(R.BACKUP/'environment.private').read_bytes();R.configuration(b);R.compose_contract(b);p=R.prepared();need(p['originalRuntime']==b['runtime']and p['images']=={'indo-shipping':IMAGE},'exact-original-and-successfully-prepared-immutable-image');failed=R.sealed(FAILED,FAILED_MANIFEST,FAILED_RESULT,'deploy',success=False);need(failed.get('failedStage')=='complete-hostconfig-mounts'and failed.get('failedServiceRetainsOwnMaintenance')is True,'exact-failed-deploy-retaining-own-maintenance');service='indo-shipping';old=read(R.BACKUP/'target-inspect.private.json')[service];created=read(FAILED/'indo-shipping-create-only-indo-shipping-raw.private.json');closed=read(FAILED/'indo-shipping-closed-before.private.json');closed_path=FAILED/'indo-shipping-closed-before';ref=read(FAILED/'indo-shipping-last-running-ancestors.private.json');need(closed['keyring']['ancestors']==ref['metadata'],'exact-closed-pre-stop-reference');R.replay_snapshot(service,closed,closed_path);literal=R.envs();need(literal==read(FAILED/'desired-runtime-environments.private.json'),'full-original-deployed-environment-bound');args=[*R.COMPOSE,'-f',str(FAILED/'runtime.private.yml')];before,raw=R.B.runtime(False);current=raw[service];R.unchanged_except(b['runtime'],before,service);need(current['Id']==created['Id']and current['Image']==created['Image']==IMAGE and R.never_started(current)and current['Config']==created['Config']and current['HostConfig']==created['HostConfig']and current['Mounts']==created['Mounts'],'same-exact-sealed-created-never-started-candidate');R.full_contract(service,old,current,IMAGE,literal,args,TARGET,created=True);need(p['proofs'][service]['reviewedSourceMatch']is True and json.loads(R.run(['docker','image','inspect',IMAGE]))[0]['Id']==IMAGE,'existing-created-image-bound-to-sealed-prepared-full-source');R.owned_flags(b,service);R.private('resume-existing-before.private.json',current);absence=fixed_absence(current['Id']);again=json.loads(R.run(['docker','inspect',current['Id']]))[0];need(again['Id']==current['Id']and R.never_started(again)and again['Config']==current['Config']and again['HostConfig']==current['HostConfig']and again['Mounts']==current['Mounts'],'same-never-started-candidate-after-structured-absence');keys_restored=False;rollback=R.overlay({service:old['Image']},literal,'resume-rollback.private.yml')
 try:
  keys,kp=R.restore_keys(service,current['Id'],closed,closed_path,ref,'resume-restored-keys-before-start');keys_restored=True;pg,pp=R.pg_only(service,'resume-prestart-pg',closed['postgres'],(0,));prestart={'createdId':current['Id'],'keyring':keys,'postgres':pg,'neverStarted':True,'structuredAbsence':absence};R.private('resume-prestart-proof.private.json',prestart);R.configuration(b);R.owned_flags(b,service);R.start_created(service,current,'resume-start-existing-once');R.maintenance('wait_service_ready',service);now,newraw=R.B.runtime();new=newraw[service];R.unchanged_except(b['runtime'],now,service);need(new['Id']==current['Id']and new['Image']==IMAGE,'same-candidate-first-start');R.full_contract(service,old,new,IMAGE,literal,args,TARGET);proof=R.proof(service,IMAGE,new['Id']);need(proof==p['proofs'][service],'running-reviewed-full-source-and-assets');post,post_path=R.B.capture(service,'resume-after-start');R.replay_snapshot(service,post,post_path);started={'candidateStartedAt':new['State']['StartedAt'],'containerId':new['Id'],'image':IMAGE};audit=R.same_data(service,closed,post,closed_path,post_path,started['candidateStartedAt']);R.private('resume-poststart-proof.private.json',{'started':started,'after':post,'audit':audit,'sourceProof':proof});R.configuration(b);R.compose_contract(b);R.owned_flags(b,service);R.operation(['sleep','11'],'resume-dns-grace',20);R.maintenance('maintenance_off',service);R.maintenance('require_maintenance_cleared',service);R.cleared_flags(b);public=R.public(service,proof);need(R.B.runtime()[0]==now,'all46-stable-through-resume-public-checks');R.private('resume-evidence.private.json',{'failedDeployManifestSHA256':FAILED_MANIFEST,'failedDeployResultSHA256':FAILED_RESULT,'closedBefore':closed,'ancestorRef':ref,'preStart':prestart,'after':post,'started':started,'audit':audit,'sourceProof':proof,'originalImage':old['Image'],'resumedImage':IMAGE});R.private('final-runtime.private.json',now);result.update(success=True,resumedExistingCandidate=True,images={service:IMAGE},allOther45ContainersUnchanged=True,fullOriginalEnvironmentAndConfigurationPreserved=True,dataProtectionKeyringPreservedBeforeStart=True,dataProtectionKeyringPostStartExact=True,ancestorMetadataMatchesPreStop=True,fullTypedRowsSchemaAndOtherSequencesExact=True,healthyStartupUsersIdentityPlusOne=True,allOwnMaintenanceCleared=True,keyMaterialPrintedOrSubmittedToGit=False,noContainerRecreateOnSuccess=True,public={service:public})
 except BaseException:
  if keys_restored:
   try:R.recover(service,old,b,b['runtime'],literal,rollback,closed,closed_path,True,True,result,ref)
   except BaseException:R.private('resume-recovery-failure.private.txt',traceback.format_exc().encode());result['failedServiceRetainsOwnMaintenance']=True
  else:result['failedServiceRetainsOwnMaintenance']=True
  raise

def main():
 need(RESUME_PIN is True and sys.argv[1:]==['resume']and os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_ATTEMPT')=='1'and re.fullmatch('[a-f0-9]{40}',os.environ.get('RELEASE_SHA',''))is not None,'false-or-wrong-one-shot-resume');os.umask(0o077);OUT.mkdir(mode=0o700);initialize();result={'mode':'resume','base':BASE,'target':TARGET,'tree':TREE,'success':False,'failedDeployRunId':39909005636,'oldEvidenceModified':False,'businessWritesPerformed':False,'databaseRestoreOrCursorResetPerformed':False,'environmentConfigurationChanged':False,'otherServicesRequested':False,'modelCallsPerformed':False,'keyMaterialPrintedOrSubmittedToGit':False,'hostCompatibilityOnlyPresentNullFalseOomKillDisable':True}
 try:resume(result)
 except BaseException as error:result.update(success=False,failedStage=STAGE,releaseLibraryFailedStage=R.STAGE,backupLibraryFailedStage=R.B.STAGE,safeExceptionType=type(error).__name__);R.private('failure.private.txt',traceback.format_exc().encode())
 finally:R.private('first-result.json',result);R.B.F.OPS.L.seal(OUT);print(enc(dict(result,manifestSHA256=R.B.F.OPS.L.file_hash(OUT/'manifest.json'),resultSHA256=R.B.F.OPS.L.file_hash(OUT/'first-result.json'))).decode(),flush=True)
 return 0 if result['success']else 1
if __name__=='__main__':
 try:sys.exit(main())
 except SystemExit:raise
 except BaseException:print('{"mode":"resume","success":false,"safeFailure":"FIXED_EXISTING_CANDIDATE_RESUME_REJECTED"}',flush=True);sys.exit(1)
