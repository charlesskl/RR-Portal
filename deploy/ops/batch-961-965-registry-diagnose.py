"""Read only sealed registry-resolution evidence from failed recovery 04."""
import importlib.util,json,os,pathlib,re,sys
PIN=True
RELEASE_SHA='d00491a8ddfc52655e27318c72596997afa708cf37abb4f3144abe0867eeecad'
FAILED_MANIFEST='86224078873d37331447df5d1d2b99073a34429eb4979949403b2e43a7bf4790';FAILED_RESULT='f05beadfc42b37d54764c3d36db1febaf79ecdd2874b736ea0191f7e76f41ccf'
BRANCH='refs/heads/ops/batch-961-965-20261020';OUT=pathlib.Path('/opt/rr-portal/deploy/backups/batch-961-965-20261020-registry-diagnosis-04-01')
R=None;STAGE='entrypoint'
def need(value):
 if not value:raise RuntimeError('REGISTRY_DIAGNOSIS_REJECTED')
def load():
 path=pathlib.Path(__file__).with_name('batch-961-965-release.py');need(path.is_file()and not path.is_symlink());import hashlib;need(hashlib.sha256(path.read_bytes()).hexdigest()==RELEASE_SHA);spec=importlib.util.spec_from_file_location('fixed_registry_diag',path);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module

def unchanged(before):
 runtime,_=R.CORE.runtime();head=R.CORE.run(['git','rev-parse','HEAD']).decode().strip();need(re.fullmatch('[a-f0-9]{40}',head));facts={'head':head,'headMatchesReviewedTarget':head==R.TARGET,'allSevenOldContainerIDsAndConfigurationsUnchanged':runtime['targets']==before['runtime']['targets'],'allOtherContainersUnchanged':runtime['others']==before['runtime']['others']and runtime['databaseContainer']==before['runtime']['databaseContainer'],'environmentBytesUnchanged':R.sha(R.CORE.stable_environment_bytes(R.ROOT/'.env.cloud.production'))==before['environmentSHA256'],'preexistingFourDirtyExactlyUnchanged':R.CORE.dirty_snapshot()==before['preexistingFourDirty'],'allMaintenanceFlagsUnchanged':R.flags()==before['maintenanceInventory']};R.checked_source(R.TARGET,before,R.source_manifest(),True);facts['all83SourceBytesAndModesIncludingTwoExact0666MapsMatchReviewedTarget']=True;return facts

def registry_facts(stdout,stderr):
 need(type(stdout)is bytes and type(stderr)is bytes and len(stdout)<=32*1024**2 and len(stderr)<=32*1024**2)
 low=stderr.lower();patterns={'buildxPluginUnavailable':(b"'buildx' is not a docker command",b'unknown command "buildx"',b'unknown flag: --raw'), 'tagOrManifestNotFound':(b'manifest unknown',b'not found',b'no such manifest'), 'registryAuthenticationRejected':(b'unauthorized',b'authentication required',b'denied:'), 'registryRateLimited':(b'toomanyrequests',b'too many requests',b'429 too'), 'networkOrDNSFailure':(b'i/o timeout',b'no such host',b'network is unreachable',b'connection refused',b'context deadline exceeded',b'connection reset'), 'tlsVerificationFailure':(b'x509:',b'certificate signed by unknown authority'), 'unsupportedOrInvalidRegistryResponse':(b'unsupported media type',b'invalid character',b'unexpected end of json')}
 facts={'stdoutBytes':len(stdout),'stderrBytes':len(stderr),'stdoutSHA256':R.sha(stdout),'stderrSHA256':R.sha(stderr),'fixedErrorIndicators':{key:any(pattern in low for pattern in values)for key,values in patterns.items()},'jsonParsed':False,'reviewedDescriptorParserAccepted':False,'returnCodeWasNotPersistedByOriginalCapture':True,'rawLogValuesOrMessagesPrinted':False}
 try:index=json.loads(stdout)
 except (ValueError,UnicodeError):return facts
 facts['jsonParsed']=True;facts['rootShape']='object'if type(index)is dict else'other'
 if type(index)is not dict:return facts
 facts['schemaVersionExactlyTwo']=type(index.get('schemaVersion'))is int and index.get('schemaVersion')==2;predicates={'schemaVersionEqualsTwo':index.get('schemaVersion')==2,'mediaTypeIsSupportedIndex':index.get('mediaType')in('application/vnd.oci.image.index.v1+json','application/vnd.docker.distribution.manifest.list.v2+json'),'manifestsIsList':type(index.get('manifests'))is list,'manifestCountWithinOneTo64':type(index.get('manifests'))is list and 0<len(index['manifests'])<=64,'exactlyOneLinuxAmd64WithNoVariant':False,'selectedDigestWellFormed':False,'selectedMediaTypeSupportedManifest':False};facts['resolverPredicates']=predicates
 media=index.get('mediaType');facts['mediaTypeClassification']='ociIndex'if media=='application/vnd.oci.image.index.v1+json'else'dockerManifestList'if media=='application/vnd.docker.distribution.manifest.list.v2+json'else'ociManifest'if media=='application/vnd.oci.image.manifest.v1+json'else'dockerManifest'if media=='application/vnd.docker.distribution.manifest.v2+json'else'other'
 rows=index.get('manifests');facts['manifestsShape']='list'if type(rows)is list else'missing'if'manifests'not in index else'other'
 if type(rows)is list:
  facts['manifestDescriptorCount']=len(rows);amd64=[row for row in rows if type(row)is dict and type(row.get('platform'))is dict and row['platform'].get('os')=='linux'and row['platform'].get('architecture')=='amd64'];facts['linuxAmd64VariantClassificationCounts']={kind:sum(('variant'not in row['platform']if kind=='missing'else row['platform'].get('variant')is None and'variant'in row['platform']if kind=='null'else row['platform'].get('variant')==''if kind=='emptyString'else row['platform'].get('variant')not in(None,''))for row in amd64)for kind in('missing','null','emptyString','other')};selected=[row for row in amd64 if row['platform'].get('variant')in(None,'')];facts['linuxAmd64DescriptorCount']=len(selected);facts['linuxAmd64DescriptorDigestsWellFormed']=all(type(row.get('digest'))is str and re.fullmatch('sha256:[a-f0-9]{64}',row['digest'])is not None for row in selected);predicates['exactlyOneLinuxAmd64WithNoVariant']=len(selected)==1
  if len(selected)==1:predicates['selectedDigestWellFormed']=type(selected[0].get('digest'))is str and re.fullmatch('sha256:[a-f0-9]{64}',selected[0]['digest'])is not None;predicates['selectedMediaTypeSupportedManifest']=selected[0].get('mediaType')in('application/vnd.oci.image.manifest.v1+json','application/vnd.docker.distribution.manifest.v2+json')
 facts['failedResolverPredicates']=[key for key,value in predicates.items()if not value]
 try:digest=R.resolve_python_base(index)
 except BaseException:return facts
 facts['reviewedDescriptorParserAccepted']=True;facts['resolvedLinuxAmd64ManifestDigest']=digest
 return facts

def main():
 global R,STAGE
 need(len(sys.argv)==2 and sys.argv[1]=='diagnose'and PIN and os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_ATTEMPT')=='1');os.umask(0o077);OUT.mkdir(mode=0o700);R=load();R.OUT=OUT;R.CORE=R.core_load();core=R.CORE;core.OUT=OUT;core.OPS=core.load('release-data-ops-library.py');core.OPS.L=core.OPS.load_library(pathlib.Path(__file__).with_name('release-data-library.py'));result={'mode':'registry-diagnosis-04','success':False,'executedHelperSHA256':R.sha(pathlib.Path(__file__).read_bytes()),'businessSourceEnvironmentOrModeWritesPerformed':False,'buildsOrServiceSwitchesPerformed':False,'liveRegistryHTTPOrLoginRequestsPerformed':False,'standardWorkflowChanged':False}
 try:
  STAGE='validate-original-and-fourth-failed-release-seals';before=R.original();failed=R.archive(R.DEPLOY,FAILED_MANIFEST,FAILED_RESULT,False);need(failed.get('failedStage')=='zuru-resolve-python-3-12-13-manifest-descriptor'and failed.get('target')==R.TARGET);result['failedReleaseArchiveRetainedAndValid']=True;STAGE='before-unchanged-observations';result['beforeReadOnlyObservations']=unchanged(before)
  STAGE='read-fixed-sealed-registry-stdout-and-stderr';stdout=core.stable_environment_bytes(R.DEPLOY/'python-3-12-13-registry-index.private.json');stderr=core.stable_environment_bytes(R.DEPLOY/'python-3-12-13-registry-index-stderr.private');result['sealedRegistryFacts']=registry_facts(stdout,stderr);result['success']=True
 except BaseException:result['failedStage']=STAGE
 finally:
  if 'before'in locals():
   try:result['afterReadOnlyObservations']=unchanged(before);result['observationsStableDuringDiagnosis']=result.get('beforeReadOnlyObservations')==result['afterReadOnlyObservations']
   except BaseException:result['afterReadOnlyObservationFailed']=True;result['success']=False;result.setdefault('failedStage','final-unchanged-observations')
  core.OPS.L.private_write(OUT/'first-result.json',R.enc(result));core.OPS.L.seal(OUT);print(R.enc(dict(result,manifestSHA256=core.OPS.L.file_hash(OUT/'manifest.json'),resultSHA256=core.OPS.L.file_hash(OUT/'first-result.json'))).decode(),flush=True)
 return 0 if result['success']else 1
if __name__=='__main__':
 try:code=main()
 except BaseException:print('{"success":false,"safeFailure":"REGISTRY_DIAGNOSIS_PREFLIGHT_FAILED"}',flush=True);code=1
 sys.exit(code)
