"""Read only seven current image tags and classify exact candidate guards."""
import importlib.util,json,os,pathlib,re,sys
PIN=True
RELEASE_SHA='f2fd38e3d885949d86bfcf771067e9cf037f3187a14ee4f73dc9ded29929f2a4'
FAILED_MANIFEST='6255d1978b12ac49b8ee92cd6b2afec1609428493af34c53c8ad6035fe9f0327';FAILED_RESULT='ae7e007348436ab81b8f6be3e00383dd58377273472c719c01226b7018c71dc3'
BRANCH='refs/heads/ops/batch-961-965-20261020';OUT=pathlib.Path('/opt/rr-portal/deploy/backups/batch-961-965-20261020-candidate-diagnosis-03-01')
ENV_KEY_ALLOWLIST={'PATH','LANG','TZ','NODE_VERSION','YARN_VERSION','PNPM_HOME','PYTHON_VERSION','PYTHON_SHA256','PYTHON_PIP_VERSION','PYTHON_GET_PIP_URL','PYTHON_GET_PIP_SHA256','GPG_KEY','PORT','DATA_PATH'}
VERSION_KEYS={'NODE_VERSION','YARN_VERSION','PYTHON_VERSION','PYTHON_PIP_VERSION'}
R=None;STAGE='entrypoint'
def need(value):
 if not value:raise RuntimeError('CANDIDATE_DIAGNOSIS_REJECTED')
def load():
 path=pathlib.Path(__file__).with_name('batch-961-965-release.py');need(path.is_file()and not path.is_symlink());import hashlib;need(hashlib.sha256(path.read_bytes()).hexdigest()==RELEASE_SHA);spec=importlib.util.spec_from_file_location('fixed_candidate_diag',path);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module

def shape(config,key):
 if key not in config:return 'missing'
 value=config[key]
 if value is None:return 'null'
 if value=='':return 'emptyString'
 if value==[]:return 'emptyList'
 return 'declaredNonempty'
def guard_facts(service,raw,candidate,oldimage,actual,literal):
 config=candidate['Config'];old=raw['Config'];defaults=R.CORE.envmap(config.get('Env')or[]);proposed=dict(defaults,**literal);changed={key for key in set(proposed)|set(actual)if proposed.get(key)!=actual.get(key)};olduser=old.get('User');newuser=config.get('User');imageuser=oldimage['Config'].get('User');default_only=all(value in(None,'')for value in(olduser,newuser,imageuser));user_exact=newuser==olduser;command=R.ZURU_COMMAND_AFTER if service=='zuru-order-system'else old.get('Cmd');versions={}
 for key in sorted(VERSION_KEYS):
  if key not in actual and key not in proposed:continue
  versions[key]={side:value if type(value)is str and re.fullmatch(r'\d+\.\d+\.\d+(?:-[A-Za-z0-9.]+)?',value)else None for side,value in(('old',actual.get(key)),('candidate',proposed.get(key)))}
 return {'guards':{'candidateEnvironmentExactlyMatchesPreservedLiteralValues':proposed==actual,'candidateCommandMatchesExactReviewedContract':config.get('Cmd')==command,'candidateEntrypointExact':config.get('Entrypoint')==old.get('Entrypoint'),'candidateWorkingDirectoryExact':config.get('WorkingDir')==old.get('WorkingDir'),'candidateUserRawExact':user_exact,'candidateUserDefaultSerializationCompatible':user_exact or default_only,'oldZuruCommandMatchesExpectedBefore':service!='zuru-order-system'or old.get('Cmd')==R.ZURU_COMMAND_BEFORE},'changedAllowedEnvironmentKeyNames':sorted(changed&ENV_KEY_ALLOWLIST),'changedOtherEnvironmentKeyCount':len(changed-ENV_KEY_ALLOWLIST),'totalChangedEnvironmentKeyCount':len(changed),'publicRuntimeVersions':versions,'fixedFieldShapes':{key:{'oldContainer':shape(old,key),'sealedOldImage':shape(oldimage['Config'],key),'candidateImage':shape(config,key)}for key in('User','Entrypoint','WorkingDir','Cmd')},'candidateCommandClassification':'exactReviewedZuruAfter'if service=='zuru-order-system'and config.get('Cmd')==R.ZURU_COMMAND_AFTER else'exactOld'if config.get('Cmd')==old.get('Cmd')else'other','arbitraryKeysValuesCommandsOrIdentifiersPrinted':False}

def unchanged(before):
 runtime,_=R.CORE.runtime();head=R.CORE.run(['git','rev-parse','HEAD']).decode().strip();need(re.fullmatch('[a-f0-9]{40}',head));facts={'head':head,'headMatchesReviewedTarget':head==R.TARGET,'allSevenOldContainerIDsAndConfigurationsUnchanged':runtime['targets']==before['runtime']['targets'],'allOtherContainersUnchanged':runtime['others']==before['runtime']['others']and runtime['databaseContainer']==before['runtime']['databaseContainer'],'environmentBytesUnchanged':R.sha(R.CORE.stable_environment_bytes(R.ROOT/'.env.cloud.production'))==before['environmentSHA256'],'preexistingFourDirtyExactlyUnchanged':R.CORE.dirty_snapshot()==before['preexistingFourDirty'],'allMaintenanceFlagsUnchanged':R.flags()==before['maintenanceInventory']};R.checked_source(R.TARGET,before,R.source_manifest(),True);facts['all83SourceBytesAndModesIncludingTwoExact0666MapsMatchReviewedTarget']=True;return facts

def main():
 global R,STAGE
 need(len(sys.argv)==2 and sys.argv[1]=='diagnose'and PIN and os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_ATTEMPT')=='1');os.umask(0o077);OUT.mkdir(mode=0o700);R=load();R.OUT=OUT;R.CORE=R.core_load();core=R.CORE;core.OUT=OUT;core.OPS=core.load('release-data-ops-library.py');core.OPS.L=core.OPS.load_library(pathlib.Path(__file__).with_name('release-data-library.py'));result={'mode':'candidate-diagnosis-03','success':False,'executedHelperSHA256':R.sha(pathlib.Path(__file__).read_bytes()),'businessSourceEnvironmentOrModeWritesPerformed':False,'buildsOrServiceSwitchesPerformed':False,'liveHTTPOrLoginRequestsPerformed':False,'standardWorkflowChanged':False}
 try:
  STAGE='validate-original-and-third-failed-release-seals';before=R.original();failed=R.archive(R.DEPLOY,FAILED_MANIFEST,FAILED_RESULT,False);need(failed.get('failedStage')=='zuru-order-system-candidate-config-validation'and failed.get('target')==R.TARGET);result['failedReleaseArchiveRetainedAndValid']=True;STAGE='before-unchanged-observations';result['beforeReadOnlyObservations']=unchanged(before);raw=json.loads((R.BACKUP/'target-inspect.private.json').read_bytes());result['tags']={}
  for service in R.ORDER:
   STAGE=service+'-current-tag-and-sealed-old-image-facts';tag=raw[service]['Config']['Image'];need(tag.removesuffix(':latest')=='rr-portal-'+service);current=json.loads(core.run(['docker','image','inspect',tag]));need(len(current)==1 and re.fullmatch('sha256:[a-f0-9]{64}',current[0]['Id']));image=current[0];oldimage=json.loads((R.BACKUP/(service+'-image.private.json')).read_bytes());need(oldimage['Id']==raw[service]['Image']==before['runtime']['targets'][service]['image']);actual,literal=R.expected_maps(service,before);row=guard_facts(service,raw[service],image,oldimage,actual,literal);result['tags'][service]=row;old=image['Id']==oldimage['Id'];row.update(currentImageID=image['Id'],oldRunningImageID=oldimage['Id'],tagStillOldRunningImage=old,currentImageIDBoundToSealedBuildEvidence=False)
   if service=='factory-review':row['currentImageIDBoundToSealedBuildEvidence']=image['Id']==R.REUSED_FACTORY_IMAGE and failed.get('exactPreviouslyBuiltFactoryImageReusedWithoutRebuilding')is True
   elif not old:
    logs=list(R.DEPLOY.glob('*-'+service+'-build-only-target-image.private.log'));need(len(logs)==1);content=core.stable_environment_bytes(logs[0]);row['sealedBuildLogSHA256']=R.sha(content);row['currentImageIDBoundToSealedBuildEvidence']=image['Id'].encode()in content
   revision=(image['Config'].get('Labels')or{}).get('org.opencontainers.image.revision');row['ociRevision']=revision if type(revision)is str and re.fullmatch('[a-f0-9]{40}',revision)else None;row['ociRevisionMatchesReviewedTarget']=revision==R.TARGET
  result['success']=True
 except BaseException:result['failedStage']=STAGE
 finally:
  if 'before'in locals():
   try:result['afterReadOnlyObservations']=unchanged(before);result['observationsStableDuringDiagnosis']=result.get('beforeReadOnlyObservations')==result['afterReadOnlyObservations']
   except BaseException:result['afterReadOnlyObservationFailed']=True;result['success']=False;result.setdefault('failedStage','final-unchanged-observations')
  core.OPS.L.private_write(OUT/'first-result.json',R.enc(result));core.OPS.L.seal(OUT);print(R.enc(dict(result,manifestSHA256=core.OPS.L.file_hash(OUT/'manifest.json'),resultSHA256=core.OPS.L.file_hash(OUT/'first-result.json'))).decode(),flush=True)
 return 0 if result['success']else 1
if __name__=='__main__':
 try:code=main()
 except BaseException:print('{"success":false,"safeFailure":"CANDIDATE_DIAGNOSIS_PREFLIGHT_FAILED"}',flush=True);code=1
 sys.exit(code)
