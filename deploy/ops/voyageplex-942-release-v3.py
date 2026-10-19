"""PR942 scoped VoyagePlex release draft. All execution and migration gates remain false."""
import collections,contextlib,datetime,hashlib,html.parser,importlib.util,json,os,pathlib,re,signal,stat,subprocess,sys,time,urllib.error,urllib.parse,urllib.request
ROOT=pathlib.Path('/opt/rr-portal');BASE='f32c9f00760e048a0846045a6d638290074b48d6';BRANCH='refs/heads/ops/voyageplex-942-20261019'
BACKUP=ROOT/'deploy/backups/voyageplex-942-20261019-backup-v3';DEPLOY=ROOT/'deploy/backups/voyageplex-942-20261019-deploy-v3';VERIFY=ROOT/'deploy/backups/voyageplex-942-20261019-verify-v3'
DEPLOY_PIN=False;VERIFY_PIN=True;MIGRATION_RULES_PIN=True;TARGET='1cff968ccd7edeb29a9aeb2eaf2c7ee140d4f584';TREE='6a56d2bbe7dfeb06780368f1d3efd97b8d370c45';CORE_SHA='779331f8b03b944d18b96f3e0a6778a290f25fe7f7500cee867b4a3f02c4a660';TEMPLATE_PROOF_SHA='b40a7a8fbc0aec7efa78a7e7415d35b7c8895e7fc17892efbea59d8ba32b9aed';SOURCE_MANIFEST_SHA='788d359df27dc5068428a86a90940358b8be14089c66baf180163f79b1d01264';BACKUP_MANIFEST='eda687e492371f5da3233ff469291879e2951b5f2e14dcd9941ce86d3d6ba6c0';BACKUP_RESULT='45f908fd1619bf721e3ff76b1c58d2a8208d29cbebf303ee3d2968387fe360e7';DEPLOY_MANIFEST='71621485e75275eddf80c1a011f62d328dbaa994a9e936460fb82a5aa21faaf6';DEPLOY_RESULT='5c436de66a76ba18811dd1c8f3ae147444ea451807890758115d507e38e88caa'
FIRST_DEPLOY=ROOT/'deploy/backups/voyageplex-942-20261019-deploy';FIRST_DEPLOY_MANIFEST='8bc05d728b52bd51319261606c7e1f29b63057ffe98e46364bcb1d3aa058068e';FIRST_DEPLOY_RESULT='6a42faf0a997867158c88b6749b98fb640e2433bf5bd9901c31fb4199219b073'
CONTROL_DIAGNOSTIC=ROOT/'deploy/backups/voyageplex-942-controlled-config-diagnostic';CONTROL_MANIFEST='25c57580dc87d8b17ef1beedafaeec1ac2a4e040dc5793143a7f7a0bf6caf77c';CONTROL_RESULT='5cf3ab18356d8d5c1c6f6ab78d5a34dc3dc72240de1717961d012edd74439eb3'
SERIAL_DIAGNOSTIC=ROOT/'deploy/backups/voyageplex-942-compose-serialization-diagnostic';SERIAL_MANIFEST='40a84cd94fbfa795a1ee6ef0af46ba7f90308f66b9e2313606e98fa10e273134';SERIAL_RESULT='27d9132275bc1286d02af4377b8e795fbcba2092083336760044da4461485931';COMPOSE_VERSION='5.1.0'
STAGE='preflight';CORE=None;OUT=None;ENV=None;PARSER_PROCESS_OVERRIDE=None
ORDER=('voyageplex-parser','voyageplex-api','voyageplex-web')
COMPOSE=['docker','compose','-p','rr-portal','-f',str(ROOT/'docker-compose.cloud.yml'),'--env-file',str(ROOT/'.env.cloud.production')]
def need(value):
 if not value:raise RuntimeError('VOYAGEPLEX_942_RELEASE_REJECTED')
def enc(value):return json.dumps(value,ensure_ascii=True,sort_keys=True,separators=(',',':'),allow_nan=False).encode()
def sha(value):return hashlib.sha256(value).hexdigest()
def core_load():
 p=pathlib.Path(__file__).with_name('voyageplex-backup-library.py');need(re.fullmatch('[a-f0-9]{64}',CORE_SHA or'')and p.is_file()and not p.is_symlink()and sha(p.read_bytes())==CORE_SHA);s=importlib.util.spec_from_file_location('voyageplex_942_fixed_backup',p);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
def archive(path,msha,rsha):
 need(re.fullmatch('[a-f0-9]{64}',msha or'')and re.fullmatch('[a-f0-9]{64}',rsha or'')and path.is_dir()and not path.is_symlink()and stat.S_IMODE(path.stat().st_mode)==0o700)
 need(CORE.OPS.L.file_hash(path/'manifest.json')==msha and CORE.OPS.L.file_hash(path/'first-result.json')==rsha);manifest=json.loads((path/'manifest.json').read_bytes());entries=list(path.rglob('*'));need(len(entries)<=100000 and all(not p.is_symlink()and(p.is_dir()or p.is_file())and p.stat().st_mode&0o077==0 for p in entries));need(set(manifest)=={str(p.relative_to(path))for p in entries if p.is_file()and p!=path/'manifest.json'})
 need(all(CORE.OPS.L.safe_path(n)and re.fullmatch('[a-f0-9]{64}',h)and CORE.OPS.L.file_hash(path/n)==h for n,h in manifest.items()));receipt=json.loads((path/'first-result.json').read_bytes());need(receipt.get('success')is True);return receipt
def original():
 r=archive(BACKUP,BACKUP_MANIFEST,BACKUP_RESULT);need(r.get('backupComplete')is True and r.get('base')==BASE and r.get('portablePrimarySQLiteCount')==1 and r.get('configuredMailboxBindings')==4 and r.get('manualSyncBackfillRetryOrMailboxTestPerformed')is False)
 before=json.loads((BACKUP/'baseline.private.json').read_bytes());need(before['head']==BASE and set(before['runtime']['targets'])==set(ORDER));seed=[v for v in before['files']if v.get('path')=='inspection-mappings.json'];need(len(seed)==1 and seed[0].get('bytes',0)>0);revision=CORE.BASE
 try:CORE.BASE=BASE;need(CORE.prior_evidence()==before['priorEvidence'])
 finally:CORE.BASE=revision
 with contextlib.closing(CORE.OPS.L.connect(BACKUP/'sqlite/voyageplex.db',True))as db:
  version=db.execute('SELECT DailyWorkflowVersion FROM MailSystemSettings WHERE Id=1').fetchall();need(len(version)==1 and type(version[0][0])is int and version[0][0]>=1)
 release_prior_evidence();return before
def prepare_parser_process_override(before):
 proof=before['sourceProof']['sealedExistingParserEnvironmentProof'];need(proof.get('onlySealedExistingParserCredentialDiffersFromEnvFile')is True and proof.get('existingRuntimeCredentialUnchanged')is True);raw=json.loads((BACKUP/'containers.private.json').read_bytes());service='voyageplex-parser';need(set(raw)==set(ORDER)and raw[service]['Id']==before['runtime']['targets'][service]['id']and raw[service]['Image']==before['runtime']['targets'][service]['image']);actual=CORE.envmap(raw[service]['Config']['Env']);need(actual==CORE.envmap(CORE.SEALED_SOURCE_ENV['actualConfigEnvironment'][service])and sha(enc(actual))==before['runtime']['targets'][service]['environmentMapSHA256']);key=CORE.PARSER_PRESERVED_KEY;need(key=='VOYAGEPLEX_MAIL_AUTH_CODE'and key in actual and type(actual[key])is str and len(actual[key])<=1024);return{key:actual[key]}
def compose_process_environment():
 need(type(ENV)is dict and type(PARSER_PROCESS_OVERRIDE)is dict and set(PARSER_PROCESS_OVERRIDE)=={'VOYAGEPLEX_MAIL_AUTH_CODE'}and type(PARSER_PROCESS_OVERRIDE['VOYAGEPLEX_MAIL_AUTH_CODE'])is str);result=dict(ENV);result.update(PARSER_PROCESS_OVERRIDE);return result
def release_prior_evidence():
 failed=CORE.prior_archive(FIRST_DEPLOY,FIRST_DEPLOY_MANIFEST,FIRST_DEPLOY_RESULT);need(failed.get('success')is False and failed.get('target')==TARGET and failed.get('failedStage')=='controlled-compose-environment-before-any-build-or-switch'and all(failed.get(k)is False for k in('manualSyncBackfillRetryOrMailboxTestPerformed','credentialsOrConfigurationChanged','globalHooksRun','globalMaintenanceChanged','automaticRollback','otherServicesRequested')))
 previous=CORE.prior_archive(CONTROL_DIAGNOSTIC,CONTROL_MANIFEST,CONTROL_RESULT);need(previous.get('success')is True and previous.get('diagnosticCompleted')is True and all(previous.get(k)is True for k in('allContainersUnchanged','allSourceEnvironmentFourDirtyAndMaintenanceFilesUnchanged','bothSealedArchivesAndPriorEvidenceUnchanged'))and previous.get('failedArchiveContainsControlledComposeProof')is False)
 report=CORE.prior_archive(SERIAL_DIAGNOSTIC,SERIAL_MANIFEST,SERIAL_RESULT);need(report.get('success')is True and report.get('diagnosticCompleted')is True and report.get('composeVersion')==COMPOSE_VERSION and report.get('composeVersionFormatValid')is True and report.get('allPriorSealsSourceEnvironmentFourDirtyMaintenanceAndContainersUnchanged')is True and all(report.get(k)is False for k in('backupOrDeployRetried','businessHTTPOrMailboxSyncPerformed','configurationOrContainersChanged','historicalSQLiteOpened','secretValuesLengthsOrHashesPrinted')))
 relations=report['parserRelations'];need(all(relations.get(k)is True for k in('controlledChildInputEqualsSealedActual','inheritedResolvedEqualsSealedDeclared','controlledResolvedEqualsPriorControlled','otherResolvedServicesEqualSealedPrior','envFileRawBytesMatchSealedBackup')))
 for key in('controlledResolvedVersusSealedActual','inheritedResolvedVersusSealedActual'):need(all(relations[key].get(k)is True for k in('resolvedEqualsDollarDoubledActual','pairDecodedEqualsActual','allResolvedDollarRunsEven','pairDecodeReencodeRoundTrip')))
 synthetic=report['syntheticCompose'];fields={'DOLLAR','DOUBLE_DOLLAR','BACKSLASH','NEWLINE','EMPTY','WHITESPACE'}
 for name in('synthetic','synthetic-no-interpolate'):
  row=synthetic[name];need(all(row.get(k)is True for k in('commandSucceeded','outputWithinBound','jsonParsed','expectedSyntheticFieldsPresent'))and set(row['fields'])==fields)
  for row in row['fields'].values():need(row.get('resolvedEqualsDollarDoubledActual')is True if name=='synthetic'else row.get('originalExpressionPreserved')is True)
 return {'firstFailedDeployPreservedAsFailure':True,'bothReadOnlyDiagnosticsPreserved':True,'installedComposeVersionAndSerializationCalibrated':True,'priorRawComparisonDoesNotProveCredentialChange':True}
def serialized_environment(literal):
 need(type(literal)is dict and all(type(k)is str and type(v)is str for k,v in literal.items()));return{k:v.replace('$','$$')for k,v in literal.items()}
def literal_explicit_environments(before):
 raw=json.loads((BACKUP/'containers.private.json').read_bytes());images=json.loads((BACKUP/'images.private.json').read_bytes());declared=json.loads((BACKUP/'compose-environment.private.json').read_bytes());need(set(raw)==set(declared)==set(ORDER));literal={}
 for service in ORDER:
  row=raw[service];need(row['Id']==before['runtime']['targets'][service]['id']and row['Image']==before['runtime']['targets'][service]['image']);actual=CORE.envmap(row['Config']['Env']);need(actual==CORE.envmap(CORE.SEALED_SOURCE_ENV['actualConfigEnvironment'][service])and sha(enc(actual))==before['runtime']['targets'][service]['environmentMapSHA256']);need(type(declared[service])is dict and all(type(k)is str and type(v)is str for k,v in declared[service].items())and set(declared[service])<=set(actual));literal[service]={k:actual[k]for k in declared[service]};need(declared[service]==serialized_environment(literal[service]));image=images[row['Image']];need(image['Id']==row['Image']);expected=CORE.envmap(image['Config'].get('Env')or[]);expected.update(literal[service]);need(expected==actual)
 need(literal['voyageplex-parser']['VOYAGEPLEX_MAIL_AUTH_CODE']==PARSER_PROCESS_OVERRIDE['VOYAGEPLEX_MAIL_AUTH_CODE']);return literal
def controlled_compose_configuration(before):
 global STAGE
 STAGE='controlled-compose-installed-version';need(CORE.run(['docker','compose','version','--short']).decode().strip()==COMPOSE_VERSION);STAGE='sealed-serialized-and-literal-environment-proof';literal=literal_explicit_environments(before);STAGE='controlled-compose-config-command';CORE.COUNTER+=1;args=[*COMPOSE,'config','--format','json']
 with(OUT/('%03d-controlled-compose-stderr.private'%CORE.COUNTER)).open('xb')as errors:p=subprocess.run(args,stdout=subprocess.PIPE,stderr=errors,timeout=90,cwd=ROOT,env=compose_process_environment())
 STAGE='controlled-compose-json-shape';need(p.returncode==0 and len(p.stdout)<=32*1024**2);config=json.loads(p.stdout);explicit={s:config['services'][s].get('environment',{})for s in ORDER}
 for service in ORDER:STAGE=service+'-controlled-json-forward-serialization-equality';need(explicit[service]==serialized_environment(literal[service]))
 STAGE='persist-literal-explicit-environment';CORE.OPS.L.private_write(OUT/'controlled-compose-environment.private.json',enc(literal));return {'allThreeSerializedComposeEnvironmentsEqualForwardEncodedSealedLiteral':True,'allLiteralExplicitAndImageDefaultMapsEqualSealedRuntime':True,'onlyParserExistingLiteralAuthProvidedInComposeChildEnvironment':True,'envFileAndFourHuadengMailboxConfigurationUnchanged':True,'preservesAttestedEmptyStringWithoutFallback':True,'priorRawComparisonDifferenceWasJSONSerializationNotCredentialDrift':True}
def built_image_environment(service,image,before):
 need(service in ORDER and re.fullmatch('sha256:[a-f0-9]{64}',image.get('Id',''))and image['Id']!=before['runtime']['targets'][service]['image']);raw=json.loads((BACKUP/'containers.private.json').read_bytes());explicit=json.loads((OUT/'controlled-compose-environment.private.json').read_bytes());need(set(raw)==set(explicit)==set(ORDER)and raw[service]['Id']==before['runtime']['targets'][service]['id']and raw[service]['Image']==before['runtime']['targets'][service]['image']);actual=CORE.envmap(raw[service]['Config']['Env']);need(sha(enc(actual))==before['runtime']['targets'][service]['environmentMapSHA256']and type(explicit[service])is dict and all(type(k)is str and type(v)is str for k,v in explicit[service].items()));expected=CORE.envmap(image['Config'].get('Env')or[]);expected.update(explicit[service]);need(expected==actual);return True

def operation(args,timeout=180,checkout=False):
 CORE.COUNTER+=1
 with (OUT/('%03d-%s.private.log'%(CORE.COUNTER,STAGE))).open('xb')as log:p=subprocess.run(args,stdout=log,stderr=subprocess.STDOUT,timeout=timeout,cwd=ROOT,env=compose_process_environment()if args[:len(COMPOSE)]==COMPOSE else ENV,umask=0o022 if checkout else -1)
 need(p.returncode==0)
def source_manifest():
 p=pathlib.Path(__file__).with_name('voyageplex-reviewed-files.json');need(re.fullmatch('[a-f0-9]{64}',SOURCE_MANIFEST_SHA or'')and p.is_file()and not p.is_symlink()and sha(p.read_bytes())==SOURCE_MANIFEST_SHA);v=json.loads(p.read_bytes());need(type(v)is dict and 0<len(v)<=100 and all(n.startswith(CORE.APP_PREFIX)and'/data-runtime/'not in n and CORE.OPS.L.safe_path(n)and re.fullmatch('[a-f0-9]{64}',h)for n,h in v.items()));return v
def checked_source(revision,before,files,canonical=False):
 CORE.BASE=revision;need(CORE.source()==before['configuration']and CORE.dirty_snapshot()==before['preexistingFourDirty']and CORE.OPS.L.file_hash(ROOT/'.env.cloud.production')==before['environmentSHA256'])
 need(CORE.run(['git','rev-parse',TARGET+'^{tree}']).decode().strip()==TREE);changed=CORE.run(['git','diff','--name-only','-z','--no-ext-diff','--no-textconv',BASE,TARGET]).decode().strip('\0').split('\0');need(set(changed)==set(files)and not set(changed)&set(before['preexistingFourDirty']))
 for n,h in files.items():
  need(sha(CORE.run(['git','show',TARGET+':'+n]))==h)
  if canonical:
   path=ROOT/n;entry=CORE.run(['git','ls-tree','-z',TARGET,'--',n]).split(b'\t',1);need(len(entry)==2 and entry[1]==n.encode()+b'\0'and re.fullmatch(b'100(?:644|755) blob [a-f0-9]{40}',entry[0]));desired=0o755 if entry[0].startswith(b'100755')else 0o644
   for ancestor in(path,*path.parents):
    if ancestor==ROOT:break
    need(not ancestor.is_symlink())
   need(path.is_file()and stat.S_IMODE(path.stat().st_mode)==desired and CORE.OPS.L.file_hash(path)==h)
def config_same(a,b):
 return all(a[k]==b[k]for k in ('environmentMapSHA256','processEnvironmentWithoutAutomaticHostnameSHA256','mounts','memory','swap','healthcheck','command','entrypoint','user','workingDirectory'))
def flags():
 path=ROOT/'deploy/maintenance';need(path.is_dir()and not path.is_symlink());return[r for r in CORE.OPS.L.non_database_inventory(path,[])if r['path']!='services/voyageplex']
def maintenance(fn):
 need(fn in {'maintenance_on','wait_service_ready','maintenance_off','require_maintenance_cleared'});operation(['bash','-c','set -euo pipefail; source "$1"; "$2" "$3"','voyageplex-release',str(ROOT/'deploy/service-maintenance.sh'),fn,'voyageplex-web'],340)
def wait(service):
 need(service in ORDER);operation(['bash','-c','set -euo pipefail; source "$1"; wait_service_ready "$2"','voyageplex-release',str(ROOT/'deploy/service-maintenance.sh'),service],340)
WEB_FILES_CODE="""const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');let out={};function walk(p,r){for(const n of fs.readdirSync(p)){const f=path.join(p,n),s=fs.lstatSync(f);if(s.isSymbolicLink())throw Error('link');if(s.isDirectory())walk(f,r+n+'/');else if(s.isFile()){const b=fs.readFileSync(f);out[r+n]={bytes:b.length,sha256:crypto.createHash('sha256').update(b).digest('hex')};}else throw Error('type');}}walk('/app/.next-build/static','');console.log(JSON.stringify(out));"""
def actual_source(current):
 prefix=CORE.APP_PREFIX+'services/email-parser/';names=CORE.run(['git','ls-tree','-r','--name-only','-z',TARGET,'--',prefix+'app']).decode().strip('\0').split('\0');need(names and all(n.startswith(prefix+'app/')and CORE.OPS.L.safe_path(n)for n in names));expected={n[len(prefix):]:sha(CORE.run(['git','show',TARGET+':'+n]))for n in names};actual=json.loads(CORE.run(['docker','exec','-i',current['targets']['voyageplex-parser']['id'],'python','-c',CORE.PARSER_HASH_CODE],enc(list(expected))));need(actual==expected)
 dll=CORE.run(['docker','exec',current['targets']['voyageplex-api']['id'],'sha256sum','/app/VoyagePlex.Api.dll']).decode().strip();need(re.fullmatch('[a-f0-9]{64}  /app/VoyagePlex.Api.dll',dll));web=current['targets']['voyageplex-web']['id'];build=CORE.run(['docker','exec',web,'cat','/app/.next-build/BUILD_ID']);need(0<len(build)<=256);static_files=json.loads(CORE.run(['docker','exec',web,'node','-e',WEB_FILES_CODE]));need(type(static_files)is dict and 0<len(static_files)<=20000 and all(CORE.OPS.L.safe_path(n)and type(v)is dict and type(v.get('bytes'))is int and 0<=v['bytes']<=32*1024**2 and re.fullmatch('[a-f0-9]{64}',v.get('sha256',''))for n,v in static_files.items())and sum(v['bytes']for v in static_files.values())<=512*1024**2)
 return {'parserSourceFiles':actual,'parserActualSourceMatchesTarget':True,'apiDLLSHA256':dll.split()[0],'webBuildIdSHA256':sha(build),'webStaticFiles':static_files,'applicationTree':CORE.run(['git','rev-parse',TARGET+':'+CORE.APP_PREFIX.rstrip('/')]).decode().strip()}
def get(path):
 parts=urllib.parse.urlsplit(path);need(not parts.scheme and not parts.netloc and not parts.query and not parts.fragment and(parts.path=='/voyageplex'or parts.path.startswith('/voyageplex/')));request=urllib.request.Request('http://127.0.0.1'+path,headers={'Cache-Control':'no-cache'})
 class NoRedirect(urllib.request.HTTPRedirectHandler):
  def redirect_request(self,*args,**kwargs):return None
 opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),NoRedirect())
 try:
  with opener.open(request,timeout=15)as response:body=response.read(32*1024**2+1);need(len(body)<=32*1024**2);return response.status,body
 except urllib.error.HTTPError as error:return error.code,b''
def public_assets(proof):
 deadline=time.monotonic()+120
 need(get('/voyageplex/api/health')[0]==200 and get('/voyageplex/api/export-templates')[0]==401);status,body=get('/voyageplex');need(status==200 and body)
 class Assets(html.parser.HTMLParser):
  def __init__(self):super().__init__();self.urls=set()
  def handle_starttag(self,tag,attrs):
   for key,value in attrs:
    if tag in {'script','link'}and key in {'src','href'}and value and value.startswith('/voyageplex/_next/static/'):
     parts=urllib.parse.urlsplit(value);need(not parts.scheme and not parts.netloc and not parts.query and not parts.fragment);self.urls.add(urllib.parse.unquote(parts.path,errors='strict'))
 parser=Assets();parser.feed(body.decode());need(parser.urls and all(url[len('/voyageplex/_next/static/'):]in proof['webStaticFiles']for url in parser.urls))
 for n,row in proof['webStaticFiles'].items():
  need(time.monotonic()<deadline and'?'not in n and'#'not in n);status,body=get('/voyageplex/_next/static/'+urllib.parse.quote(n,safe='/'));need(status==200 and len(body)==row['bytes']and sha(body)==row['sha256'])
 return {'webHealth200':True,'unauthenticatedTemplateAPIBoundary401':True,'publicStaticBytesMatchContainer':True,'staticFiles':len(proof['webStaticFiles']),'noAuthenticationOrEmailSyncRequests':True}
def deploy(result,before,files):
 global STAGE
 STAGE='initial-runtime-equality';current,raw=CORE.runtime();need(current==before['runtime']);STAGE='initial-other-maintenance-inventory';other_flags=flags();composeproof=controlled_compose_configuration(before);STAGE='require-voyageplex-maintenance-cleared';maintenance('require_maintenance_cleared');CORE.BASE=BASE;STAGE='initial-source-configurations-equality';need(CORE.source()==before['configuration']);STAGE='initial-four-dirty-equality';need(CORE.dirty_snapshot()==before['preexistingFourDirty']);STAGE='initial-env-file-byte-equality';need(CORE.OPS.L.file_hash(ROOT/'.env.cloud.production')==before['environmentSHA256'])
 STAGE='fetch-exact-main';CORE.run(['git','-c','core.hooksPath=/dev/null','fetch','origin','main']);need(CORE.run(['git','rev-parse','FETCH_HEAD']).decode().strip()==TARGET);CORE.run(['git','merge-base','--is-ancestor',BASE,TARGET]);checked_source(BASE,before,files)
 STAGE='fast-forward-readable-source';operation(['git','-c','core.hooksPath=/dev/null','-c','merge.autoStash=false','merge','--ff-only','--no-autostash',TARGET],180,True);checked_source(TARGET,before,files,True);built={}
 for service in ORDER:
  STAGE=service+'-build';need(CORE.runtime()[0]==current);tag=raw[service]['Config']['Image'];need(tag.removesuffix(':latest')=='rr-portal-'+service);image=json.loads(CORE.run(['docker','image','inspect',tag]));need(len(image)==1 and image[0]['Id']==current['targets'][service]['image']);operation([*COMPOSE,'build',service],1200);images=json.loads(CORE.run(['docker','image','inspect',tag]));need(len(images)==1 and re.fullmatch('sha256:[a-f0-9]{64}',images[0]['Id'])and images[0]['Id']!=current['targets'][service]['image']);STAGE=service+'-built-image-environment-before-any-switch';built_image_environment(service,images[0],before);built[service]=images[0]['Id'];checked_source(TARGET,before,files,True)
 STAGE='shared-voyageplex-maintenance';need(CORE.runtime()[0]==current);maintenance('maintenance_on');switched=time.monotonic();expected=current
 for service in ORDER:
  STAGE=service+'-switch';operation([*COMPOSE,'up','-d','--no-build','--no-deps',service],180);wait(service);after,_=CORE.runtime();need(after['others']==expected['others']and all(after['targets'][s]==expected['targets'][s]for s in ORDER if s!=service));row=after['targets'][service];need(config_same(before['runtime']['targets'][service],row)and row['id']!=expected['targets'][service]['id']and row['image']==built[service]and row['restarts']==0);expected=after;checked_source(TARGET,before,files,True)
 STAGE='three-service-runtime-and-static-proof';proof=actual_source(expected);time.sleep(max(0,10-(time.monotonic()-switched)));need(CORE.runtime()[0]==expected and all(v['restarts']==0 for v in expected['targets'].values())and flags()==other_flags);checked_source(TARGET,before,files,True);maintenance('maintenance_off');maintenance('require_maintenance_cleared')
 STAGE='public-read-only-health-and-assets'
 try:public=public_assets(proof)
 except BaseException:maintenance('maintenance_on');raise
 STAGE='final-preservation';original();checked_source(TARGET,before,files,True);need(CORE.runtime()[0]==expected and flags()==other_flags);result.update(success=True,onlyVoyagePlexThreeServicesRebuilt=True,allNonVoyagePlexContainersUnchanged=True,fourPreexistingChangesPreserved=True,canonicalGitSourceModesVerified=True,environmentAndProcessMapsPreserved=True,runtimeAfter=expected,sourceProof=proof,publicChecks=public,ordinaryConfiguredAutomaticEmailPollingMayRun=True,controlledComposeEnvironmentProof=composeproof,priorDeployAndDiagnostics=release_prior_evidence(),priorRawEnvironmentDifferenceWasSerializationOnly=True)
def template_module():
 need(MIGRATION_RULES_PIN and re.fullmatch('[a-f0-9]{64}',TEMPLATE_PROOF_SHA or''));p=pathlib.Path(__file__).with_name('voyageplex-template-proof.py');need(p.is_file()and not p.is_symlink()and sha(p.read_bytes())==TEMPLATE_PROOF_SHA);s=importlib.util.spec_from_file_location('voyageplex_942_exact_template_proof',p);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
def typed_rows(db,table,names,exclude_template_sequence=False):
 q=CORE.OPS.L.quote;where=" WHERE name<>'ExportTemplates'"if exclude_template_sequence else'';return collections.Counter(sha(enc([CORE.OPS.L.cell(v)for v in row]))for row in db.execute('SELECT '+','.join(map(q,names))+' FROM '+q(table)+where))
def startup_context(db,lower,upper,proof):
 rows=db.execute('SELECT StartDate,DailyWorkflowVersion FROM MailSystemSettings WHERE Id=1').fetchall();need(len(rows)==1 and type(rows[0][1])is int and rows[0][1]>=1);groups=collections.Counter()
 for sender, in db.execute("SELECT MailSender FROM ImportEmailItems WHERE Company='Xingxin'AND MailboxKey<>''AND MailReceivedDate>=?",(rows[0][0],)):
  need(type(sender)is str);match=re.search(r'[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}',sender,re.I);email=match[0].lower()if match else sender.strip().lower()
  if email:groups[email]+=1
 return {'groups':groups,'low':proof.utc_ns(lower),'high':proof.utc_ns(upper),'proof':proof}
def compatible_existing_startup(table,names,a,b,changed,old,context):
 values=dict(zip(names,a));observed=dict(zip(names,b))
 if table=='ImportEmailItems'and changed=={'BusinessFingerprint'}and values.get('BusinessFingerprint')=='':
  raw=values.get('ResultJson');wanted=old.execute("SELECT CAST(COALESCE(json_extract(CASE WHEN json_valid(?)THEN ? ELSE NULL END,'$.business_fingerprint'),'')AS TEXT)",(raw,raw)).fetchone()[0];return observed['BusinessFingerprint']==wanted
 if table=='MailContacts'and changed<= {'MessageCount','UpdatedAt','ContactType','IsConfirmed'}and values.get('Company')=='Xingxin'and type(values.get('Email'))is str:
  email=values['Email'].lower();count=context['groups'].get(email);need(count is None or type(count)is int)
  if count is None or CORE.OPS.L.cell(observed.get('MessageCount'))!=CORE.OPS.L.cell(count):return False
  try:
   if not(context['low']<=context['proof'].utc_ns(observed['UpdatedAt'])<=context['high']):return False
  except (ValueError,RuntimeError,TypeError):return False
  internal=email.rsplit('@',1)[-1].strip()in {'hanson2.com','royalregent.net'}and'@'in email
  return(CORE.OPS.L.cell(observed.get('ContactType'))==CORE.OPS.L.cell('Internal')and CORE.OPS.L.cell(observed.get('IsConfirmed'))==CORE.OPS.L.cell(1))if internal else all(CORE.OPS.L.cell(observed[k])==CORE.OPS.L.cell(values[k])for k in('ContactType','IsConfirmed'))
 return False
def table_differences(old,new,table,context):
 q=CORE.OPS.L.quote;columns=old.execute('PRAGMA table_xinfo('+q(table)+')').fetchall();need(columns==new.execute('PRAGMA table_xinfo('+q(table)+')').fetchall());names=[r[1]for r in columns];keys=[r[1]for r in sorted(columns,key=lambda r:r[5])if r[5]]
 if table=='sqlite_sequence':keys=['name']
 if not keys or old.execute('SELECT count(*) FROM '+q(table)+' WHERE '+' OR '.join(q(k)+' IS NULL'for k in keys)).fetchone()[0]:
  a=typed_rows(old,table,names,table=='sqlite_sequence');b=typed_rows(new,table,names,table=='sqlite_sequence');return {'oldRows':sum(a.values()),'newRows':sum(b.values()),'oldTypedRowsMissingOrChanged':sum((a-b).values()),'newTypedRowsAddedOrChanged':sum((b-a).values()),'exactTypedMultisetIdentical':a==b,'onlyProvedExistingStartupFieldChanges':a==b}
 where=" WHERE a.name<>'ExportTemplates'"if table=='sqlite_sequence'else'';join=' AND '.join('a.'+q(k)+' COLLATE BINARY IS b.'+q(k)+' COLLATE BINARY AND typeof(a.'+q(k)+')=typeof(b.'+q(k)+')'for k in keys);n=len(names);result={'oldRows':0,'newRows':0,'missingOldIds':0,'newIds':0,'retainedTypedIdentical':0,'retainedTypedChanged':0,'existingStartupCompatibleChangedRows':0,'changedFieldCounts':{}};fields=collections.Counter()
 query='SELECT '+','.join('a.'+q(k)for k in names)+','+','.join('b.'+q(k)for k in names)+' FROM '+q(table)+' a LEFT JOIN afterdb.'+q(table)+' b ON '+join+where
 for row in old.execute(query):
  result['oldRows']+=1;a,b=row[:n],row[n:]
  if b[names.index(keys[0])]is None:result['missingOldIds']+=1;continue
  changed={key for key,left,right in zip(names,a,b)if CORE.OPS.L.cell(left)!=CORE.OPS.L.cell(right)}
  if not changed:result['retainedTypedIdentical']+=1;continue
  result['retainedTypedChanged']+=1;fields.update(changed);result['existingStartupCompatibleChangedRows']+=int(compatible_existing_startup(table,names,a,b,changed,old,context))
 newwhere=" WHERE name<>'ExportTemplates'"if table=='sqlite_sequence'else'';result['newRows']=new.execute('SELECT count(*) FROM '+q(table)+newwhere).fetchone()[0];result['newIds']=result['newRows']-(result['oldRows']-result['missingOldIds']);need(result['newIds']>=0);result['changedFieldCounts']=dict(fields);result['exactTypedMultisetIdentical']=result['missingOldIds']==result['newIds']==result['retainedTypedChanged']==0;result['onlyProvedExistingStartupFieldChanges']=result['missingOldIds']==result['newIds']==0 and result['retainedTypedChanged']==result['existingStartupCompatibleChangedRows'];return result
def verify(result,before,files):
 global STAGE
 STAGE='deployed-sealed-receipt';deployed=archive(DEPLOY,DEPLOY_MANIFEST,DEPLOY_RESULT);need(deployed.get('target')==TARGET and deployed.get('onlyVoyagePlexThreeServicesRebuilt')is True);current,_=CORE.runtime();need(current==deployed['runtimeAfter']and current['others']==before['runtime']['others']and all(v['restarts']==0 for v in current['targets'].values()));checked_source(TARGET,before,files,True);other_flags=flags();maintenance('require_maintenance_cleared');proof=template_module()
 STAGE='single-primary-consistent-closed-snapshot';started=datetime.datetime.now(datetime.timezone.utc).isoformat();copies=OUT/'sqlite';copies.mkdir(mode=0o700);CORE.OPS.L.databases=lambda _:['voyageplex.db'];database=CORE.OPS.L.snapshots(CORE.DATA,copies);finished=datetime.datetime.now(datetime.timezone.utc).isoformat();storage=CORE.OPS.L.non_database_inventory(CORE.DATA,['voyageplex.db']);historical=CORE.persistent_inventory();original_db=before['database']['voyageplex.db'];observed_db=database['voyageplex.db'];table_rows={};checks={};lower=current['targets']['voyageplex-api']['started']
 with contextlib.closing(CORE.OPS.L.connect(BACKUP/'sqlite/voyageplex.db',True))as old,contextlib.closing(CORE.OPS.L.connect(copies/'voyageplex.db',True))as new:
  old.execute('ATTACH DATABASE ? AS afterdb',((copies/'voyageplex.db').as_uri()+'?mode=ro&immutable=1',));STAGE='exact-template-schema-and-row-proof';templates=proof.prove(old,new,CORE.OPS.L.cell,lower,finished);schema=original_db['schema'];expected_sql=new.execute("SELECT sql FROM sqlite_master WHERE type='table'AND name='ExportTemplates'").fetchone()[0];expected_schema=[[kind,name,tbl,expected_sql if kind=='table'and name=='ExportTemplates'else sql]for kind,name,tbl,sql in schema];checks['OnlyExactTemplateSchemaChanges']=expected_schema==observed_db['schema'];checks['ExportTemplateRowsMatchExactReviewedMigration']=templates['exactSchemaAndAllTemplateRowsPassed'];need(set(original_db['tables'])==set(observed_db['tables']))
  STAGE='all-non-template-tables-on-same-closed-snapshot';context=startup_context(new,lower,finished,proof)
  for table in original_db['tables']:
   if table=='ExportTemplates':continue
   table_rows[table]=table_differences(old,new,table,context)
 checks['AllOtherBusinessTablesPreservedExceptProvedExistingStartupFields']=all(v['onlyProvedExistingStartupFieldChanges']for v in table_rows.values());checks['AllRuntimeStorageFileBytesAndModesIdentical']=storage==before['files'];checks['HistoricalRawSQLiteBundlesUnchanged']=historical==before['historicalSQLite'];checks['AllThreeConfigurationAndProcessMapsPreserved']=all(config_same(before['runtime']['targets'][s],current['targets'][s])for s in ORDER);checks['AllNonVoyagePlexContainersUnchanged']=current['others']==before['runtime']['others'];checks['UserRolesMailboxBindingsAndSecretsAllTypedIdentical']=table_rows['Users']['exactTypedMultisetIdentical'];checks['MailboxConfigurationAllTypedIdentical']=table_rows['MailSystemSettings']['exactTypedMultisetIdentical'];checks['AllMailboxCursorsAllTypedIdentical']=table_rows['MailSyncStates']['exactTypedMultisetIdentical']
 STAGE='actual-runtime-and-public-bytes';source=actual_source(current);public=public_assets(source);checks['ActualParserSourceAndPublicStaticBytesMatchTarget']=source['parserActualSourceMatchesTarget']and public['publicStaticBytesMatchContainer'];STAGE='final-byte-and-runtime-rechecks';original();archive(DEPLOY,DEPLOY_MANIFEST,DEPLOY_RESULT);checked_source(TARGET,before,files,True);need(CORE.runtime()[0]==current and flags()==other_flags and CORE.OPS.L.non_database_inventory(CORE.DATA,['voyageplex.db'])==storage and CORE.persistent_inventory()==historical);CORE.OPS.L.private_write(OUT/'observed.private.json',enc({'database':database,'files':storage,'historicalSQLite':historical,'runtime':current,'sourceProof':source,'snapshotStartedAtUtc':started,'snapshotFinishedAtUtc':finished}));result.update(success=all(checks.values()),deploymentVerified=True,checks=checks,strictAllPrimarySnapshotFieldsIdentical=original_db==observed_db,strictNonTemplateTableTypedRowsIdentical=all(v['exactTypedMultisetIdentical']for v in table_rows.values()),templateMigration=templates,tableRowDifferences=table_rows,existingStartupCompatibilityDoesNotIdentifyActor=True,automaticBackgroundSyncDifferencesNotAutomaticallyExempted=True,noLiveHistorySQLiteOpened=True,requiresNarrowBusinessDifferenceInvestigation=not all(checks.values()))
def main():
 global CORE,OUT,ENV,STAGE,PARSER_PROCESS_OVERRIDE
 need(len(sys.argv)==2 and sys.argv[1]in {'deploy','verify'});mode=sys.argv[1];need((DEPLOY_PIN if mode=='deploy'else VERIFY_PIN)and re.fullmatch('[a-f0-9]{40}',TARGET or'')and re.fullmatch('[a-f0-9]{40}',TREE or'')and os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_ATTEMPT')=='1');os.umask(0o077);OUT=DEPLOY if mode=='deploy'else VERIFY;OUT.mkdir(mode=0o700);CORE=core_load();CORE.OUT=OUT;CORE.OPS=CORE.load('release-data-ops-library.py');CORE.OPS.L=CORE.OPS.load_library(pathlib.Path(__file__).with_name('release-data-library.py'));CORE.OPS.run=CORE.run
 ENV=dict(os.environ,AFTER_COMMIT=TARGET,COMPOSE_BAKE='false',COMPOSE_PARALLEL_LIMIT='1',COMPOSE_PROJECT_NAME='rr-portal',MAINT_FLAG_DIR=str(ROOT/'deploy/maintenance'),COMPOSE_FILE=str(ROOT/'docker-compose.cloud.yml'),ENV_FILE=str(ROOT/'.env.cloud.production'),MAINT_COMPOSE_SERVICES='voyageplex-parser\nvoyageplex-api\nvoyageplex-web',MAINT_HEALTH_TIMEOUT_SECONDS='300',MAINT_DNS_GRACE_SECONDS='10')
 def stop(*_):need(False)
 signal.signal(signal.SIGTERM,stop);result={'mode':mode,'success':False,'target':TARGET,'expectedTree':TREE,'manualSyncBackfillRetryOrMailboxTestPerformed':False,'credentialsOrConfigurationChanged':False,'globalHooksRun':False,'globalMaintenanceChanged':False,'automaticRollback':False,'otherServicesRequested':False,'secretOrRowsPrinted':False}
 try:
  STAGE='sealed-backup-and-source-manifest';before=original();STAGE='sealed-literal-parser-process-binding';PARSER_PROCESS_OVERRIDE=prepare_parser_process_override(before);STAGE='reviewed-source-manifest';files=source_manifest();(deploy if mode=='deploy'else verify)(result,before,files)
 except BaseException:result['failedStage']=STAGE
 finally:
  CORE.OPS.L.private_write(OUT/'first-result.json',enc(result));CORE.OPS.L.seal(OUT);public={k:v for k,v in result.items()if k not in {'runtimeAfter','sourceProof'}};print(enc(dict(public,resultSHA256=CORE.OPS.L.file_hash(OUT/'first-result.json'),manifestSHA256=CORE.OPS.L.file_hash(OUT/'manifest.json'))).decode(),flush=True)
 return 0 if result['success']else 1
if __name__=='__main__':
 try:exit_code=main()
 except BaseException:print('{"success":false,"safeFailure":"VOYAGEPLEX_942_RELEASE_PREFLIGHT_FAILED"}',flush=True);exit_code=1
 sys.exit(exit_code)
