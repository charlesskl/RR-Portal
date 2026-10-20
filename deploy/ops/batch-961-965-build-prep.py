"""Closed draft: build only the final two original-Compose images, never switch services."""
import hashlib,importlib.util,json,os,pathlib,re,signal,sys

PIN=True
RELEASE_SHA='9c92f4cd77ca8c57c2a34c6d9d05fd3865e0d8afd8bad15e546241bb06f16e55'
DIAGNOSTIC_HELPER_SHA='6f09f18a8308df6942856da9a5ac906e5c0a332832fd33cbe2d8ecbb40a1b730'
DIAGNOSTIC_EXECUTED_SHA='18abccb09c4d1955645470190d8dc8c9edc44d1ddbab5fdc2c3fe8dcba2e817a'
FAILED_MANIFEST='a43adca4f12a5d9e59e46bcede71e4b5a94c4a7082724a369105554f605719d6'
FAILED_RESULT='99b0d275ef57e52840dd1977784886b973cd8daa610dc142dce3e4a9f2648541'
# Successful sealed diagnostic05 receipt; the imported library remains closed.
DIAGNOSIS_MANIFEST='8133b4d8f4142f305012655affd653bc54f24196604acdd319a2ddba2de00458'
DIAGNOSIS_RESULT='71ce887c833b695a83da2dae4341e67b96b23c2f9abd4a05977d2d7b10214986'
BRANCH='refs/heads/ops/batch-961-965-20261020'
OUT=pathlib.Path('/opt/rr-portal/deploy/backups/batch-961-965-20261020-build-preparation-01')
ORDER=('factory-review','factory-review-test','internal-quote','zuru-order-system','qc-plan-api','qc-plan-web','printlink')
BUILD_ONLY=('qc-plan-web','printlink')
OBSERVATION_KEYS={'head','headMatchesReviewedTarget','allSevenOldContainerIDsAndConfigurationsUnchanged','allOtherContainersUnchanged','environmentBytesUnchanged','preexistingFourDirtyExactlyUnchanged','allMaintenanceFlagsUnchanged','all83SourceBytesAndModesIncludingTwoExact0666MapsMatchReviewedTarget'}
R=None;D=None;STAGE='entrypoint'

def need(value):
    if not value:raise RuntimeError('BUILD_PREPARATION_REJECTED')

def load(name,filename,checksum):
    path=pathlib.Path(__file__).with_name(filename)
    need(path.is_file()and not path.is_symlink()and hashlib.sha256(path.read_bytes()).hexdigest()==checksum)
    spec=importlib.util.spec_from_file_location(name,path);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module

def strict_observation(facts):
    need(set(facts)==OBSERVATION_KEYS and facts['head']==R.TARGET and all(value is True for key,value in facts.items()if key!='head'))

def evidence(before):
    failed=R.archive(R.DEPLOY,FAILED_MANIFEST,FAILED_RESULT,False)
    need(failed.get('failedStage')=='qc-plan-api-candidate-config-validation'and failed.get('target')==R.TARGET)
    directory=R.BACKUP.with_name('batch-961-965-20261020-candidate-diagnosis-05-01')
    diagnosis=R.archive(directory,DIAGNOSIS_MANIFEST,DIAGNOSIS_RESULT)
    need(diagnosis.get('mode')=='candidate-diagnosis-05'and diagnosis.get('executedHelperSHA256')==DIAGNOSTIC_EXECUTED_SHA and diagnosis.get('failedReleaseArchiveRetainedAndValid')is True and diagnosis.get('observationsStableDuringDiagnosis')is True and diagnosis.get('buildsOrServiceSwitchesPerformed')is False and diagnosis.get('businessSourceEnvironmentOrModeWritesPerformed')is False and diagnosis.get('liveHTTPOrLoginRequestsPerformed')is False and set(diagnosis['tags'])==set(ORDER))
    for name in('beforeReadOnlyObservations','afterReadOnlyObservations'):strict_observation(diagnosis[name])
    expected={}
    for service in ORDER:
        row=diagnosis['tags'][service];old=before['runtime']['targets'][service]['image'];current=row['currentImageID']
        need(re.fullmatch('sha256:[a-f0-9]{64}',current)and row['oldRunningImageID']==old)
        if service in BUILD_ONLY:need(current==old and row['tagStillOldRunningImage']is True)
        else:need(current!=old and row['tagStillOldRunningImage']is False and row['currentImageIDBoundToSealedBuildEvidence']is True)
        expected[service]=current
    return expected,{'originalBaselineAndFailed05AndSuccessfulDiagnostic05SealsValidated':True,'initialTwoBuildTagsMustStillBeOriginalRunningImages':True,'otherFiveImageIDsBoundToSuccessfulSealedDiagnostic':True}

def current_tags(raw,expected,private_name):
    images={}
    for service in ORDER:
        tag=raw[service]['Config']['Image'];need(type(tag)is str and tag.removesuffix(':latest')=='rr-portal-'+service)
        values=json.loads(R.CORE.run(['docker','image','inspect',tag]));need(type(values)is list and len(values)==1)
        image=values[0];need(type(image)is dict and image.get('Id')==expected[service]);images[service]=image
    R.CORE.OPS.L.private_write(OUT/private_name,R.enc(images))
    return images

def candidate_facts(service,raw,image,before):
    old=json.loads((R.BACKUP/(service+'-image.private.json')).read_bytes());need(old['Id']==raw['Image']==before['runtime']['targets'][service]['image'])
    actual,literal=R.expected_maps(service,before);row=D.guard_facts(service,raw,image,old,actual,literal)
    layers=image.get('RootFS',{}).get('Layers',[]);need(type(layers)is list and len(layers)<=256 and all(type(value)is str and re.fullmatch('sha256:[a-f0-9]{64}',value)for value in layers))
    revision=(image['Config'].get('Labels')or{}).get('org.opencontainers.image.revision')
    row.update(currentImageID=image['Id'],oldRunningImageID=old['Id'],tagStillOldRunningImage=image['Id']==old['Id'],architectureClassification=image.get('Architecture')if image.get('Architecture')in('amd64','arm64','386','arm')else'other',osClassification=image.get('Os')if image.get('Os')in('linux','windows')else'other',contentAddressedLayerDigests=layers,ociRevision=revision if type(revision)is str and re.fullmatch('[a-f0-9]{40}',revision)else None,ociRevisionMatchesReviewedTarget=revision==R.TARGET,hostReviewedSourceManifestSHA256=R.SOURCE_MANIFEST_SHA,candidateRawImageMetadataRetainedPrivately=True,candidateApplicationFileBytesIndependentlyVerified=False,configurationGuardsAreObservationsNotPreparationAcceptance=True)
    return row

def prepare(before,result):
    global STAGE
    STAGE='validate-sealed-baseline-failed05-and-successful-diagnostic05';expected,proof=evidence(before);result.update(proof)
    raw=json.loads((R.BACKUP/'target-inspect.private.json').read_bytes());need(set(raw)==set(ORDER));STAGE='strict-initial-source-runtime-env-flags-and-image-tag-binding'
    result['beforeBuildObservations']=D.unchanged(before);strict_observation(result['beforeBuildObservations']);current_tags(raw,expected,'initial-seven-image-inspect.private.json')
    result['builds']={}
    for service in BUILD_ONLY:
        STAGE=service+'-prebuild-strict-old-runtime-and-current-tag-guards';strict_observation(D.unchanged(before));current_tags(raw,expected,service+'-prebuild-seven-image-inspect.private.json')
        STAGE=service+'-original-compose-build-only';R.STAGE=service+'-build-only-target-image'
        log_name='%04d-%s.private.log'%(R.CORE.COUNTER+1,R.STAGE)
        record={'attempted':True,'completed':False,'oldTagImageID':expected[service],'privateBuildLogFile':log_name,'originalComposeUsed':True};result['builds'][service]=record
        R.operation([*R.COMPOSE,'build',service],1800)
        need(log_name=='%04d-%s.private.log'%(R.CORE.COUNTER,R.STAGE));record['completed']=True
        STAGE=service+'-postbuild-new-image-and-protected-state-guards';values=json.loads(R.CORE.run(['docker','image','inspect',raw[service]['Config']['Image']]))
        need(type(values)is list and len(values)==1 and type(values[0])is dict and type(values[0].get('Id'))is str and re.fullmatch('sha256:[a-f0-9]{64}',values[0]['Id'])and values[0]['Id']!=expected[service])
        expected[service]=values[0]['Id'];record['newCandidateImageID']=expected[service];record['candidateImageIDChangedAfterOwnBuild']=True
        content=R.CORE.stable_environment_bytes(OUT/log_name);record['sealedBuildLogSHA256']=R.sha(content);record['imageIDPresentInSealedBuildLog']=expected[service].encode()in content
        strict_observation(D.unchanged(before));current_tags(raw,expected,service+'-postbuild-seven-image-inspect.private.json')
    STAGE='collect-all-seven-candidate-guard-facts-without-demanding-all-guards-pass'
    images=current_tags(raw,expected,'final-seven-image-inspect.private.json');result['tags']={}
    for service in ORDER:
        R.CORE.OPS.L.private_write(OUT/(service+'-candidate-image.private.json'),R.enc(images[service]));result['tags'][service]=candidate_facts(service,raw[service],images[service],before)
    result.update(bothOriginalComposeBuildsCompleted=True,onlyTwoImageTagsBuilt=True,noCandidateGuardFalseWasSilentlyAcceptedForDeployment=True,allSevenCandidateGuardsRecordedWithoutServiceSwitch=True,success=True)

def main():
    global R,D,STAGE
    need(len(sys.argv)==2 and sys.argv[1]=='prepare'and PIN and os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_ATTEMPT')=='1'and re.fullmatch('[a-f0-9]{64}',DIAGNOSIS_MANIFEST or'')and re.fullmatch('[a-f0-9]{64}',DIAGNOSIS_RESULT or''))
    os.umask(0o077);OUT.mkdir(mode=0o700)
    R=load('fixed_build_prep_release','batch-961-965-release.py',RELEASE_SHA);D=load('fixed_build_prep_diagnostic','batch-candidate-diagnose-library.py',DIAGNOSTIC_HELPER_SHA);D.R=R;R.OUT=OUT;R.CORE=R.core_load();core=R.CORE;core.OUT=OUT;core.OPS=core.load('release-data-ops-library.py');core.OPS.L=core.OPS.load_library(pathlib.Path(__file__).with_name('release-data-library.py'))
    R.ENV=dict(os.environ,AFTER_COMMIT=R.TARGET,COMPOSE_BAKE='false',COMPOSE_PARALLEL_LIMIT='1',COMPOSE_PROJECT_NAME='rr-portal')
    for prefix in('FACTORY_REVIEW_AI_','FACTORY_REVIEW_TEST_AI_'):
        for suffix,value in{'ENABLED':'false','API_KEY':'','MODEL':'','BASE_URL':'https://api.openai.com/v1'}.items():R.ENV[prefix+suffix]=value
    signal.signal(signal.SIGTERM,lambda *_:need(False))
    result={'mode':'build-preparation-01','success':False,'executedHelperSHA256':R.sha(pathlib.Path(__file__).read_bytes()),'loadedReleaseHelperSHA256':RELEASE_SHA,'sourceEnvironmentOrModeWritesPerformed':False,'maintenanceOrServiceSwitchesPerformed':False,'liveRegistryPreResolutionOrHTTPProbesPerformed':False,'normalDeploymentWorkflowManagedByReleaseOwnerOutsideThisHelper':True,'candidateApplicationFileBytesIndependentlyVerified':False}
    try:
        STAGE='validate-original-sealed-backup';before=R.original();prepare(before,result)
    except BaseException:result['failedStage']=STAGE
    finally:
        if 'before'in locals():
            try:
                result['afterBuildObservations']=D.unchanged(before);strict_observation(result['afterBuildObservations']);result['observationsStableDuringPreparation']=result.get('beforeBuildObservations')==result['afterBuildObservations'];need(result['observationsStableDuringPreparation']is True)
            except BaseException:result['success']=False;result['finalProtectedStateGuardRejected']=True;result.setdefault('failedStage','final-protected-state-guards')
        core.OPS.L.private_write(OUT/'first-result.json',R.enc(result));core.OPS.L.seal(OUT);print(R.enc(dict(result,manifestSHA256=core.OPS.L.file_hash(OUT/'manifest.json'),resultSHA256=core.OPS.L.file_hash(OUT/'first-result.json'))).decode(),flush=True)
    return 0 if result['success']else 1

if __name__=='__main__':
    try:code=main()
    except BaseException:print('{"success":false,"safeFailure":"BUILD_PREPARATION_PREFLIGHT_FAILED"}',flush=True);code=1
    sys.exit(code)
