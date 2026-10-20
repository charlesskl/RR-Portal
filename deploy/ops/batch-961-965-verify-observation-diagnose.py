"""Read only sealed partial verification metadata; no new HTTP or container writes."""
import hashlib,importlib.util,json,os,pathlib,re,sys,urllib.parse,tarfile,html.parser
PIN=True
RELEASE_SHA='f4f1ae32881efbdd35aa9bb36096d28c65e8f624bed0cd37f9099dd0c613a545'
DEPLOY_MANIFEST='04203afb18be0a93be77b9aa61a9891f7405d376bcf2784927bc121df35ea5ff';DEPLOY_RESULT='448c5d875d3418343bb186835e903ecce152bbed9a31c23966b1943284c1779f'
FAILED_MANIFEST='d1e9030a257f70604b7d72e30d18cd1473f7ee58f3780554940804026ffc7300';FAILED_RESULT='70d31c7f84d5d42b5a2dd724baf57a4399a53eb60f50810fcbaffdac3da25ed8'
BRANCH='refs/heads/ops/batch-961-965-20261020';OUT=pathlib.Path('/opt/rr-portal/deploy/backups/batch-961-965-20261020-verify-observation-diagnosis-06-01');R=None;STAGE='entrypoint'
def need(value):
 if not value:raise RuntimeError('SEALED_VERIFY_OBSERVATION_DIAGNOSIS_REJECTED')
def load():
 path=pathlib.Path(__file__).with_name('batch-961-965-release.py');need(path.is_file()and not path.is_symlink()and hashlib.sha256(path.read_bytes()).hexdigest()==RELEASE_SHA);spec=importlib.util.spec_from_file_location('fixed_release06_diagnosis',path);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m

def unchanged(before,deployed):
 runtime,_=R.CORE.runtime();head=R.CORE.run(['git','rev-parse','HEAD']).decode().strip();R.checked_source(R.TARGET,before,R.source_manifest(),True)
 return {'headMatchesReviewedTarget':head==R.TARGET,'allSevenDeployedContainerIDsAndConfigurationsUnchanged':runtime['targets']==deployed['runtimeAfter']['targets'],'allOtherContainersUnchanged':runtime['others']==before['runtime']['others']and runtime['databaseContainer']==before['runtime']['databaseContainer'],'environmentBytesUnchanged':R.sha(R.CORE.stable_environment_bytes(R.ROOT/'.env.cloud.production'))==before['environmentSHA256'],'preexistingFourDirtyExactlyUnchanged':R.CORE.dirty_snapshot()==before['preexistingFourDirty'],'allMaintenanceFlagsUnchanged':R.flags()==before['maintenanceInventory'],'all83SourceBytesAndModesIncludingTwoExact0666MapsMatchReviewedTarget':True}

def classify(partial,files):
 rows=partial.get('http',[]);need(type(rows)is list and len(rows)<=1000);inventories=partial.get('publicAssetContainerFiles',{});need(type(inventories)is dict and set(inventories)<={'factory-review','factory-review-test','qc-plan-web'});expected={};counts={}
 for service,entries in inventories.items():
  need(type(entries)is dict and len(entries)<=300);counts[service]=len(entries)
  for name,fact in entries.items():
   need(type(name)is str and R.CORE.OPS.L.safe_path(name)and type(fact)is dict and re.fullmatch('[a-f0-9]{64}',fact.get('sha256','')))
   if service in{'factory-review','factory-review-test'}and name.startswith('pb_public/'):expected['/'+service+'/'+name[len('pb_public/'):]]=fact['sha256']
   elif service=='qc-plan-web':expected['/qc-plan/_next/'+name]=fact['sha256']
 expected.update({('/'+service+'/'):value['pb_public/index.html']['sha256']for service,value in inventories.items()if service in{'factory-review','factory-review-test'}and'pb_public/index.html'in value})
 fixed={R.CORE.QUOTE+'/frontend/quote.html':'/internal-quote/quote.html',R.CORE.QUOTE+'/frontend/verification.html':'/internal-quote/verification.html',R.CORE.QUOTE+'/frontend/department-batch-import.js':'/internal-quote/department-batch-import.js',R.CORE.QUOTE+'/frontend/verification-transfer.js':'/internal-quote/verification-transfer.js',R.CORE.PRINT+'/cloud/public/authority.html':'/authority',R.CORE.PRINT+'/cloud/public/authority.js':'/authority.js'}
 for name,path in fixed.items():
  if name in files:expected[path]=files[name]
 unauthorized={'/factory-review/api/factory-review/analysis-ai/config','/factory-review-test/api/factory-review/analysis-ai/config','/internal-quote/api/auth/me','/internal-quote/api/quotes','/internal-quote/api/admin/users','/qc-plan/api/schedule-imports','/api/platform/authority','/api/production/data'};result=[]
 for row in rows:
  parsed=urllib.parse.urlsplit(row['url']);path=parsed.path;need(parsed.scheme=='http'and parsed.hostname=='127.0.0.1'and parsed.port in(None,80,3100)and not parsed.username and not parsed.password and len(path)<=2048 and path.startswith('/')and'..'not in urllib.parse.unquote(path).split('/')and not parsed.fragment and type(row['status'])is int and 100<=row['status']<=599 and re.fullmatch('[a-f0-9]{64}',row['sha256']))
  need(any(path.startswith(prefix)for prefix in('/factory-review/','/factory-review-test/','/internal-quote/','/zuru-order-system/','/qc-plan'))or path in{'/api/health','/api/platform/authority','/api/production/data','/authority','/authority.js'})
  result.append({'path':path,'port':parsed.port or 80,'actualStatus':row['status'],'expectedStatus':401 if path in unauthorized else 200,'actualSHA256':row['sha256'],'expectedSHA256':expected.get(path)})
 return {'retainedCompletedHTTPRequests':result,'retainedCompletedHTTPCount':len(result),'lastRetainedCompletedRequestPath':result[-1]['path']if result else None,'nextUnretainedRequestOrPredicateCannotBeInferred':True,'publicContainerAssetInventoryCounts':counts,'httpChecksWereReturnedToObserver':'httpChecks'in partial,'publicAssetResponseContentsPrinted':False,'queryStringsCredentialsAndBusinessValuesPrinted':False}


class StaticReferences(html.parser.HTMLParser):
 def __init__(self):super().__init__();self.paths=[]
 def handle_starttag(self,tag,attrs):
  values=dict(attrs)
  if tag in{'script','link'}:
   value=values.get('src')if tag=='script'else values.get('href')
   if value:self.paths.append(value)

def closed_capture_facts(directory,partial):
 facts={'nonemptyWrappedStderrFixedClasses':[],'retainedTarMetadata':[]};stdout=sorted(directory.glob('[0-9][0-9][0-9][0-9]-stdout.private'));stderr=sorted(directory.glob('[0-9][0-9][0-9][0-9]-stderr.private'));need(len(stdout)<=5000 and len(stderr)<=5000);facts['wrappedStdoutFileCount']=len(stdout);facts['wrappedStderrFileCount']=len(stderr)
 for path in stderr:
  content=R.CORE.stable_environment_bytes(path);need(len(content)<=32*1024**2)
  if not content:continue
  low=content.lower();facts['nonemptyWrappedStderrFixedClasses'].append({'counter':int(path.name.split('-')[0]),'bytes':len(content),'sha256':R.sha(content),'qcDotNextPathMentioned':b'/app/.next'in low,'pathOrFileNotFound':any(v in low for v in(b'no such file or directory',b'cannot chdir',b"can't change directory",b'cannot stat')),'tarErrorMentioned':b'tar:'in low})
 facts['nonemptyWrappedStderrFixedClasses']=facts['nonemptyWrappedStderrFixedClasses'][-10:]
 for path in stdout:
  with path.open('rb')as stream:head=stream.read(512)
  if len(head)<512 or head[257:262]!=b'ustar':continue
  row={'counter':int(path.name.split('-')[0]),'archiveBytes':path.stat().st_size,'metadataRead':False};facts['retainedTarMetadata'].append(row)
  try:
   members=[]
   with tarfile.open(path,mode='r:')as archive:
    for member in archive:
     members.append(member)
     if len(members)>1000:break
   names=[v.name.rstrip('/')for v in members];files=[v for v in members if v.isfile()];row.update(metadataRead=True,memberCountBoundedAt1001=len(members),fileCount=len(files),allPathNamesSafe=all(R.CORE.OPS.L.safe_path(v)for v in names),allUnderPbPublic=all(v=='pb_public'or v.startswith('pb_public/')for v in names),allRegularFilesOrDirectories=all(v.isfile()or v.isdir()for v in members),fileNamesUnique=len({v.name for v in files})==len(files),maximumFileBytes=max([v.size for v in files]or[0]),totalFileBytes=sum(v.size for v in files),pbPublicFileCountWithinCallerLimit=len(files)<=300)
  except (OSError,ValueError,tarfile.TarError):row['metadataReadFailed']=True
 qc=next((v for v in partial.get('http',[])if urllib.parse.urlsplit(v['url']).path=='/qc-plan'),None)
 if qc is not None:
  need(re.fullmatch('http-[0-9]{4}\.private',qc.get('bodyFile','')));raw=R.CORE.stable_environment_bytes(directory/qc['bodyFile']);parser=StaticReferences();q={'retainedQCPageStatus':qc['status'],'utf8HTMLParsed':False}
  try:parser.feed(raw.decode('utf8'));q['utf8HTMLParsed']=True
  except (UnicodeError,ValueError):pass
  refs=sorted(set(v for v in parser.paths if urllib.parse.urlsplit(v).path.startswith('/qc-plan/_next/static/')and not urllib.parse.urlsplit(v).netloc));q.update(allScriptAndLinkReferenceCount=len(parser.paths),matchingQCStaticReferenceCount=len(refs),qcStaticReferenceCountWithinGuard=0<len(refs)<=100,allMatchingQCReferencesHaveNoSchemeOrFragment=all(not urllib.parse.urlsplit(v).scheme and not urllib.parse.urlsplit(v).fragment for v in refs),allDecodedQCStaticNamesSafe=all(R.CORE.OPS.L.safe_path(urllib.parse.unquote(urllib.parse.urlsplit(v).path[len('/qc-plan/_next/'):]))for v in refs));facts['closedQCPageReferenceFacts']=q
 return facts

def main():
 global R,STAGE
 need(len(sys.argv)==2 and sys.argv[1]=='diagnose'and PIN and os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_ATTEMPT')=='1');os.umask(0o077);OUT.mkdir(mode=0o700);R=load();R.OUT=OUT;R.CORE=R.core_load();core=R.CORE;core.OUT=OUT;core.OPS=core.load('release-data-ops-library.py');core.OPS.L=core.OPS.load_library(pathlib.Path(__file__).with_name('release-data-library.py'));result={'mode':'verify-observation-diagnosis-06','success':False,'executedHelperSHA256':R.sha(pathlib.Path(__file__).read_bytes()),'businessSourceEnvironmentOrModeWritesPerformed':False,'buildsRunsOrServiceSwitchesPerformed':False,'newHTTPRegistryOrLoginRequestsPerformed':False,'standardWorkflowChanged':False}
 try:
  STAGE='validate-original-successful-deploy-and-failed-verify-seals';before=R.original();deployed=R.archive(R.DEPLOY,DEPLOY_MANIFEST,DEPLOY_RESULT);failed=R.archive(R.VERIFY,FAILED_MANIFEST,FAILED_RESULT,False);need(deployed.get('target')==R.TARGET and deployed.get('allSevenTargetServicesUseSealedReviewedBuiltImages')is True and failed.get('failedStage')=='fixed-get-only-public-observations'and failed.get('target')==R.TARGET);result['successfulReleaseAndFailedVerificationArchivesRetainedAndValid']=True;STAGE='before-unchanged-observations';result['beforeReadOnlyObservations']=unchanged(before,deployed);need(all(result['beforeReadOnlyObservations'].values()));STAGE='classify-sealed-partial-http-and-asset-metadata';partial=json.loads(core.stable_environment_bytes(R.VERIFY/'partial-observations.private.json'));result.update(classify(partial,R.source_manifest()));result['closedCaptureFacts']=closed_capture_facts(R.VERIFY,partial);result['success']=True
 except BaseException:result['failedStage']=STAGE
 finally:
  if 'deployed'in locals():
   try:result['afterReadOnlyObservations']=unchanged(before,deployed);result['observationsStableDuringDiagnosis']=result.get('beforeReadOnlyObservations')==result['afterReadOnlyObservations']and all(result['afterReadOnlyObservations'].values());need(result['observationsStableDuringDiagnosis'])
   except BaseException:result['success']=False;result['afterReadOnlyObservationFailed']=True;result.setdefault('failedStage','final-unchanged-observations')
  core.OPS.L.private_write(OUT/'first-result.json',R.enc(result));core.OPS.L.seal(OUT);print(R.enc(dict(result,manifestSHA256=core.OPS.L.file_hash(OUT/'manifest.json'),resultSHA256=core.OPS.L.file_hash(OUT/'first-result.json'))).decode(),flush=True)
 return 0 if result['success']else 1
if __name__=='__main__':
 try:code=main()
 except BaseException:print('{"success":false,"safeFailure":"SEALED_VERIFY_DIAGNOSIS_PREFLIGHT_FAILED"}',flush=True);code=1
 sys.exit(code)
