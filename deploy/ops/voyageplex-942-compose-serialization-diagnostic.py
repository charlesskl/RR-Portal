"""Read-only PR942 Compose serialization relations; never changes credentials."""
import importlib.util,json,os,pathlib,re,signal,subprocess,sys
ROOT=pathlib.Path('/opt/rr-portal');OUT=ROOT/'deploy/backups/voyageplex-942-compose-serialization-diagnostic'
PRIOR=ROOT/'deploy/backups/voyageplex-942-controlled-config-diagnostic'
PRIOR_MANIFEST='25c57580dc87d8b17ef1beedafaeec1ac2a4e040dc5793143a7f7a0bf6caf77c';PRIOR_RESULT='5cf3ab18356d8d5c1c6f6ab78d5a34dc3dc72240de1717961d012edd74439eb3'
LIBRARY_SHA='18e25ffd448d55867dbd291f919a2b6a0456f02b85d1e675e9946f79ddc88890'
BRANCH='refs/heads/ops/voyageplex-942-20261019';PIN=True;STAGE='entry';D=None
def need(v):
 if not v:raise RuntimeError('VOYAGEPLEX_942_SERIALIZATION_DIAGNOSTIC_REJECTED')
def enc(v):return json.dumps(v,ensure_ascii=True,sort_keys=True,separators=(',',':'),allow_nan=False).encode()
def load():
 import hashlib
 p=pathlib.Path(__file__).with_name('voyageplex-controlled-library.py');need(p.is_file()and not p.is_symlink()and hashlib.sha256(p.read_bytes()).hexdigest()==LIBRARY_SHA);spec=importlib.util.spec_from_file_location('fixed_controlled_config_diagnostic',p);d=importlib.util.module_from_spec(spec);spec.loader.exec_module(d);d.OUT=OUT;d.RELEASE,d.CORE=d.load_release();return d
def evidence():
 before=D.evidence();prior=D.CORE.prior_archive(PRIOR,PRIOR_MANIFEST,PRIOR_RESULT);need(prior.get('success')is True and prior.get('diagnosticCompleted')is True and prior.get('allContainersUnchanged')is True and prior.get('allSourceEnvironmentFourDirtyAndMaintenanceFilesUnchanged')is True and prior.get('bothSealedArchivesAndPriorEvidenceUnchanged')is True);return before
def relations(actual,resolved):
 need(type(actual)is str and type(resolved)is str);decoded=resolved.replace('$$','$')
 return {'equal':resolved==actual,'actualEmpty':actual=='','resolvedEmpty':resolved=='','resolvedEqualsDollarDoubledActual':resolved==actual.replace('$','$$'),'pairDecodedEqualsActual':decoded==actual,'allResolvedDollarRunsEven':'$'not in resolved.replace('$$',''),'pairDecodeReencodeRoundTrip':decoded.replace('$','$$')==resolved,'resolvedStripEqualsActual':resolved.strip()==actual,'resolvedEqualsStrippedActual':resolved==actual.strip(),'normalizedNewlinesEqual':resolved.replace('\r\n','\n')==actual}
def fixed_config(args,env,label):
 need(label in {'synthetic','synthetic-no-interpolate'})
 with(OUT/(label+'-stderr.private')).open('xb')as errors:p=subprocess.run(args,stdout=subprocess.PIPE,stderr=errors,timeout=60,cwd=ROOT,env=env)
 D.CORE.OPS.L.private_write(OUT/(label+'-stdout.private'),p.stdout);result={'commandSucceeded':p.returncode==0,'outputWithinBound':len(p.stdout)<=1024**2,'jsonParsed':False}
 if not result['commandSucceeded']or not result['outputWithinBound']:return result,None
 try:value=json.loads(p.stdout)
 except(ValueError,TypeError):return result,None
 result['jsonParsed']=True;return result,value
def synthetic():
 values={'DOLLAR':'synthetic$variable','DOUBLE_DOLLAR':'synthetic$$pair','BACKSLASH':'synthetic\\path','NEWLINE':'synthetic\nline','EMPTY':'','WHITESPACE':' synthetic '};expressions={k:'${VOYAGEPLEX942_PROBE_'+k+':-}'for k in values};path=OUT/'synthetic-compose.private.json';empty=OUT/'synthetic-empty-env.private';D.CORE.OPS.L.private_write(path,enc({'services':{'probe':{'image':'scratch','environment':expressions}}}));D.CORE.OPS.L.private_write(empty,b'');child={k:os.environ[k]for k in ('PATH','HOME','LANG')if k in os.environ};child.update({'VOYAGEPLEX942_PROBE_'+k:v for k,v in values.items()});result={}
 for label,flags in (('synthetic',[]),('synthetic-no-interpolate',['--no-interpolate'])):
  meta,config=fixed_config(['docker','compose','-p','voyageplex942readonly','-f',str(path),'--env-file',str(empty),'config','--format','json',*flags],child,label)
  if config is not None:
   actual=config.get('services',{}).get('probe',{}).get('environment');valid=type(actual)is dict and set(actual)==set(values)and all(type(v)is str for v in actual.values());meta['expectedSyntheticFieldsPresent']=valid
   if valid:meta['fields']={k:dict(relations(values[k],actual[k]),originalExpressionPreserved=actual[k]==expressions[k])for k in values}
  result[label]=meta
 return result
def diagnose(result):
 global STAGE
 STAGE='sealed-prior-evidence';before=evidence();r,c=D.RELEASE,D.CORE;STAGE='initial-read-only-preservation';initial=D.source_state();runtime,_=c.runtime();need(runtime==before['runtime']and initial['environmentSHA256']==before['environmentSHA256']);c.OPS.L.private_write(OUT/'initial-source-state.private.json',enc(initial))
 r.ENV=dict(os.environ,AFTER_COMMIT=r.TARGET,COMPOSE_BAKE='false',COMPOSE_PARALLEL_LIMIT='1',COMPOSE_PROJECT_NAME='rr-portal',MAINT_FLAG_DIR=str(ROOT/'deploy/maintenance'),COMPOSE_FILE=str(ROOT/'docker-compose.cloud.yml'),ENV_FILE=str(ROOT/'.env.cloud.production'),MAINT_COMPOSE_SERVICES='voyageplex-parser\nvoyageplex-api\nvoyageplex-web',MAINT_HEALTH_TIMEOUT_SECONDS='300',MAINT_DNS_GRACE_SECONDS='10');r.PARSER_PROCESS_OVERRIDE=r.prepare_parser_process_override(before);key='VOYAGEPLEX_MAIL_AUTH_CODE';service='voyageplex-parser';child=r.compose_process_environment();actual=c.envmap(c.SEALED_SOURCE_ENV['actualConfigEnvironment'][service])[key];need(child[key]==actual)
 raw=json.loads((r.BACKUP/'containers.private.json').read_bytes());images=json.loads((r.BACKUP/'images.private.json').read_bytes());declared=json.loads((r.BACKUP/'compose-environment.private.json').read_bytes());inherited=json.loads((PRIOR/'inherited-compose-stdout.private').read_bytes());oldcontrolled=json.loads((PRIOR/'controlled-compose-stdout.private').read_bytes())
 STAGE='installed-compose-version';version=D.run(['docker','compose','version','--short']).decode().strip();result['composeVersion']=version if re.fullmatch(r'v?[0-9]+\.[0-9]+\.[0-9]+(?:[-+][A-Za-z0-9.-]+)?',version)else None;result['composeVersionFormatValid']=result['composeVersion']is not None
 STAGE='exact-controlled-config-relations';proof=D.compose_probe('controlled',child,before,raw,images,declared);need(proof.get('jsonParsed')is True and proof.get('allThreeServiceEnvironmentsPresent')is True);controlled=json.loads((OUT/'controlled-compose-stdout.private').read_bytes());resolved=controlled['services'][service]['environment'][key];plain=inherited['services'][service]['environment'][key]
 result['parserRelations']={'controlledChildInputEqualsSealedActual':child[key]==actual,'controlledResolvedVersusSealedActual':relations(actual,resolved),'inheritedResolvedEqualsSealedDeclared':plain==declared[service][key],'inheritedResolvedVersusSealedActual':relations(actual,plain),'controlledResolvedEqualsPriorControlled':resolved==oldcontrolled['services'][service]['environment'][key],'otherResolvedServicesEqualSealedPrior':all(controlled['services'][s]['environment']==oldcontrolled['services'][s]['environment']for s in r.ORDER if s!=service),'envFileRawBytesMatchSealedBackup':initial['environmentSHA256']==before['environmentSHA256']};result['controlledConfigServiceGuards']=proof['serviceConditions']
 STAGE='synthetic-only-config-serialization';result['syntheticCompose']=synthetic()
 STAGE='final-read-only-preservation';need(D.source_state()==initial and c.runtime()[0]==runtime and evidence()==before);result.update(success=True,diagnosticCompleted=True,allPriorSealsSourceEnvironmentFourDirtyMaintenanceAndContainersUnchanged=True)
def main():
 global D
 need(PIN and len(sys.argv)==2 and sys.argv[1]=='compose-serialization-diagnostic'and os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_ATTEMPT')=='1');os.umask(0o077);OUT.mkdir(mode=0o700);D=load();signal.signal(signal.SIGTERM,lambda *_:need(False));signal.signal(signal.SIGALRM,lambda *_:need(False));signal.alarm(420)
 result={'mode':'compose-serialization-diagnostic','success':False,'diagnosticCompleted':False,'backupOrDeployRetried':False,'businessHTTPOrMailboxSyncPerformed':False,'configurationOrContainersChanged':False,'historicalSQLiteOpened':False,'secretValuesLengthsOrHashesPrinted':False}
 try:diagnose(result)
 except BaseException as error:result.update(failedStage=STAGE,safeExceptionType=type(error).__name__ if type(error).__name__ in {'RuntimeError','KeyError','ValueError','TypeError','OSError','TimeoutExpired'}else'OtherError')
 finally:D.CORE.OPS.L.private_write(OUT/'first-result.json',enc(result));D.CORE.OPS.L.seal(OUT);print(enc(dict(result,manifestSHA256=D.CORE.OPS.L.file_hash(OUT/'manifest.json'),resultSHA256=D.CORE.OPS.L.file_hash(OUT/'first-result.json'))).decode(),flush=True)
 return 0 if result['success']else 1
if __name__=='__main__':
 try:code=main()
 except BaseException:print('{"success":false,"safeFailure":"VOYAGEPLEX_942_SERIALIZATION_DIAGNOSTIC_PREFLIGHT_FAILED"}',flush=True);code=1
 sys.exit(code)
