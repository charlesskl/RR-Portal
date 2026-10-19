"""Fixed read-only PR942 pre-build failure diagnosis; no release/backup retry."""
import importlib.util,json,os,pathlib,re,signal,subprocess,sys
ROOT=pathlib.Path('/opt/rr-portal');OUT=ROOT/'deploy/backups/voyageplex-942-controlled-config-diagnostic'
FAILED=ROOT/'deploy/backups/voyageplex-942-20261019-deploy'
FAILED_MANIFEST='8bc05d728b52bd51319261606c7e1f29b63057ffe98e46364bcb1d3aa058068e';FAILED_RESULT='6a42faf0a997867158c88b6749b98fb640e2433bf5bd9901c31fb4199219b073'
BACKUP_MANIFEST='eda687e492371f5da3233ff469291879e2951b5f2e14dcd9941ce86d3d6ba6c0';BACKUP_RESULT='45f908fd1619bf721e3ff76b1c58d2a8208d29cbebf303ee3d2968387fe360e7'
RELEASE_SHA='439ee6f0a1754e8a97701c1bff19383508dfb185633c08caa39a5e4f03c18507'
BRANCH='refs/heads/ops/voyageplex-942-20261019';PIN=True;STAGE='entry';COUNTER=0;RELEASE=None;CORE=None
def need(v):
 if not v:raise RuntimeError('VOYAGEPLEX_942_CONTROLLED_DIAGNOSTIC_REJECTED')
def enc(v):return json.dumps(v,ensure_ascii=True,sort_keys=True,separators=(',',':'),allow_nan=False).encode()
def run(args,data=None,timeout=90):
 global COUNTER
 COUNTER+=1
 with(OUT/('%03d-stderr.private'%COUNTER)).open('xb')as errors:p=subprocess.run(args,input=data,stdout=subprocess.PIPE,stderr=errors,timeout=timeout,cwd=ROOT)
 need(p.returncode==0 and len(p.stdout)<=32*1024**2);return p.stdout
def load_release():
 path=pathlib.Path(__file__).with_name('voyageplex-release-library.py');need(path.is_file()and not path.is_symlink())
 import hashlib
 need(hashlib.sha256(path.read_bytes()).hexdigest()==RELEASE_SHA);spec=importlib.util.spec_from_file_location('fixed_voyageplex942_release',path);r=importlib.util.module_from_spec(spec);spec.loader.exec_module(r)
 need(r.BASE=='f32c9f00760e048a0846045a6d638290074b48d6'and r.BRANCH==BRANCH and r.CORE_SHA=='779331f8b03b944d18b96f3e0a6778a290f25fe7f7500cee867b4a3f02c4a660'and r.TARGET=='1cff968ccd7edeb29a9aeb2eaf2c7ee140d4f584')
 c=r.core_load();c.OUT=OUT;c.run=run;c.OPS=c.load('release-data-ops-library.py');c.OPS.L=c.OPS.load_library(pathlib.Path(__file__).with_name('release-data-library.py'));c.OPS.run=run;r.CORE=c;r.OUT=OUT
 return r,c
def evidence():
 failed=CORE.prior_archive(FAILED,FAILED_MANIFEST,FAILED_RESULT);need(failed.get('success')is False and failed.get('mode')=='deploy'and failed.get('target')==RELEASE.TARGET and failed.get('failedStage')=='controlled-compose-environment-before-any-build-or-switch')
 backup=RELEASE.archive(RELEASE.BACKUP,BACKUP_MANIFEST,BACKUP_RESULT);need(backup.get('backupComplete')is True and backup.get('base')==CORE.BASE)
 before=json.loads((RELEASE.BACKUP/'baseline.private.json').read_bytes());need(before['head']==CORE.BASE and CORE.prior_evidence()==before['priorEvidence']);return before
def log_summary(data):
 tokens={'releaseRejected':b'VOYAGEPLEX_942_RELEASE_REJECTED','maintenancePending':b'\xe4\xbb\x8d\xe6\x9c\x89\xe6\x9c\xaa\xe5\xb0\xb1\xe7\xbb\xaa\xe6\x9c\x8d\xe5\x8a\xa1','composeError':b'error','permissionDenied':b'permission denied','invalid':b'invalid','unsetVariable':b'is not set','jsonError':b'json','traceback':b'traceback'}
 lower=data.lower();return {'bytes':len(data),'sha256':RELEASE.sha(data),'fixedTokenCounts':{k:lower.count(v.lower())for k,v in tokens.items()}}
def failure_artifacts(result):
 manifest=json.loads((FAILED/'manifest.json').read_bytes());result['failedArchiveContainsControlledComposeProof']='controlled-compose-environment.private.json'in manifest;logs={}
 for name in sorted(manifest):
  if not re.fullmatch(r'[0-9]{3}-(?:controlled-compose-stderr\.private|[a-z0-9-]+\.private\.log|stderr\.private)',name):continue
  p=FAILED/name;need(p.stat().st_size<=8*1024**2);logs[name]=log_summary(p.read_bytes())
 need(len(logs)<=100);result['failedArchiveLogSummaries']=logs
def source_state():
 head=run(['git','rev-parse','HEAD']).decode().strip();branch=run(['git','symbolic-ref','--quiet','HEAD']).decode().strip();need(re.fullmatch('[a-f0-9]{40}',head));appdiff=run(['git','diff','--name-only','-z','--no-ext-diff','--no-textconv','--ignore-submodules=none','--',CORE.APP_PREFIX]);fixed={}
 for name in CORE.FIXED:
  p=ROOT/name;fixed[name]=CORE.OPS.L.file_hash(p)if p.is_file()and not p.is_symlink()else None
 dirty=CORE.dirty_snapshot();env=ROOT/'.env.cloud.production';need(env.is_file()and not env.is_symlink());flags=ROOT/'deploy/maintenance';need(flags.is_dir()and not flags.is_symlink());inventory=CORE.OPS.L.non_database_inventory(flags,[])
 return {'head':head,'branch':branch,'appTrackedDiffSHA256':RELEASE.sha(appdiff),'appTrackedClean':not appdiff,'fixedFiles':fixed,'fourDirty':dirty,'environmentSHA256':CORE.OPS.L.file_hash(env),'flags':inventory}
def source_guards(state,before):
 names=[row['path']for row in state['flags']];return {'serverHEAD':state['head'],'mainBranch':state['branch']=='refs/heads/main','headMatchesBase':state['head']==CORE.BASE,'headMatchesTarget':state['head']==RELEASE.TARGET,'applicationTrackedClean':state['appTrackedClean'],'fixedSourceHashesMatchBackup':state['fixedFiles']==before['configuration'],'fourDirtyMatchBackup':state['fourDirty']==before['preexistingFourDirty'],'environmentFileHashMatchesBackup':state['environmentSHA256']==before['environmentSHA256'],'voyageplexMaintenanceFlagExists':'services/voyageplex'in names,'rootLevelMaintenanceFileCount':sum('/'not in n for n in names),'otherMaintenanceFileCount':sum(n!='services/voyageplex'for n in names)}
def map_difference(expected,actual):
 need(type(expected)is dict and type(actual)is dict and all(type(k)is str and re.fullmatch('[A-Za-z_][A-Za-z0-9_]*',k)for k in set(expected)|set(actual)))
 return {'changedKeys':sorted(k for k in set(expected)&set(actual)if expected[k]!=actual[k]),'addedActualKeys':sorted(set(actual)-set(expected)),'missingActualKeys':sorted(set(expected)-set(actual))}
def service_conditions(service,explicit,raw,images,declared,before):
 actual=CORE.envmap(raw[service]['Config']['Env']);wanted=dict(declared[service])
 if service=='voyageplex-parser':wanted.update(RELEASE.PARSER_PROCESS_OVERRIDE)
 valid=type(explicit)is dict and all(type(k)is str and re.fullmatch('[A-Za-z_][A-Za-z0-9_]*',k)for k in explicit)
 result={'resolvedEnvironmentIsObjectWithValidKeys':valid,'oldIDMatchesBackup':raw[service]['Id']==before['runtime']['targets'][service]['id'],'oldImageMatchesBackup':raw[service]['Image']==before['runtime']['targets'][service]['image'],'actualEnvironmentHashMatchesBackup':RELEASE.sha(enc(actual))==before['runtime']['targets'][service]['environmentMapSHA256']}
 if not valid:return result
 expected=CORE.envmap(images[raw[service]['Image']]['Config'].get('Env')or[]);expected.update(explicit)
 result.update(allExplicitValuesAreStrings=all(type(v)is str for v in explicit.values()),nonStringExplicitKeys=sorted(k for k,v in explicit.items()if type(v)is not str),explicitEqualsDeclaredWithOnlyParserOverride=explicit==wanted,explicitDifference=map_difference(wanted,explicit),imageDefaultsPlusResolvedEqualsActual=expected==actual,actualDifference=map_difference(expected,actual));return result
def compose_probe(label,childenv,before,raw,images,declared):
 need(label in {'inherited','controlled'});args=[*RELEASE.COMPOSE,'config','--format','json']
 with(OUT/(label+'-compose-stderr.private')).open('xb')as errors:p=subprocess.run(args,stdout=subprocess.PIPE,stderr=errors,timeout=90,cwd=ROOT,env=childenv)
 CORE.OPS.L.private_write(OUT/(label+'-compose-stdout.private'),p.stdout);result={'returnCode':p.returncode,'stdoutBytes':len(p.stdout),'stdoutSHA256':RELEASE.sha(p.stdout),'outputWithinBound':len(p.stdout)<=32*1024**2,'stderr':log_summary((OUT/(label+'-compose-stderr.private')).read_bytes()),'jsonParsed':False}
 if p.returncode!=0 or not result['outputWithinBound']:return result
 try:config=json.loads(p.stdout)
 except(ValueError,TypeError):return result
 result['jsonParsed']=True;services=config.get('services')if type(config)is dict else None;result['allThreeServiceEnvironmentsPresent']=type(services)is dict and all(type(services.get(s))is dict and'environment'in services[s]for s in RELEASE.ORDER)
 if result['allThreeServiceEnvironmentsPresent']:result['serviceConditions']={s:service_conditions(s,services[s]['environment'],raw,images,declared,before)for s in RELEASE.ORDER}
 return result
def diagnose(result):
 global STAGE
 STAGE='sealed-failure-and-successful-backup';before=evidence();failure_artifacts(result);raw=json.loads((RELEASE.BACKUP/'containers.private.json').read_bytes());images=json.loads((RELEASE.BACKUP/'images.private.json').read_bytes());declared=json.loads((RELEASE.BACKUP/'compose-environment.private.json').read_bytes())
 STAGE='initial-runtime-and-independent-source-guards';runtime,_=CORE.runtime();need(runtime==before['runtime']);initial=source_state();CORE.OPS.L.private_write(OUT/'initial-source-state.private.json',enc(initial));result['sourceAndPostComposeGuards']=source_guards(initial,before)
 RELEASE.ENV=dict(os.environ,AFTER_COMMIT=RELEASE.TARGET,COMPOSE_BAKE='false',COMPOSE_PARALLEL_LIMIT='1',COMPOSE_PROJECT_NAME='rr-portal',MAINT_FLAG_DIR=str(ROOT/'deploy/maintenance'),COMPOSE_FILE=str(ROOT/'docker-compose.cloud.yml'),ENV_FILE=str(ROOT/'.env.cloud.production'),MAINT_COMPOSE_SERVICES='voyageplex-parser\nvoyageplex-api\nvoyageplex-web',MAINT_HEALTH_TIMEOUT_SECONDS='300',MAINT_DNS_GRACE_SECONDS='10')
 RELEASE.PARSER_PROCESS_OVERRIDE=RELEASE.prepare_parser_process_override(before)
 STAGE='unmodified-inherited-compose-config';result['inheritedCompose']=compose_probe('inherited',None,before,raw,images,declared)
 STAGE='controlled-parser-child-environment-compose-config';result['controlledCompose']=compose_probe('controlled',RELEASE.compose_process_environment(),before,raw,images,declared)
 STAGE='all-source-runtime-evidence-preserved';need(source_state()==initial and CORE.runtime()[0]==runtime and evidence()==before);result.update(success=True,diagnosticCompleted=True,bothSealedArchivesAndPriorEvidenceUnchanged=True,allSourceEnvironmentFourDirtyAndMaintenanceFilesUnchanged=True,allContainersUnchanged=True)
def main():
 global RELEASE,CORE
 need(PIN and len(sys.argv)==2 and sys.argv[1]=='controlled-config-diagnostic'and os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_ATTEMPT')=='1');os.umask(0o077);OUT.mkdir(mode=0o700);RELEASE,CORE=load_release();signal.signal(signal.SIGTERM,lambda *_:need(False));signal.signal(signal.SIGALRM,lambda *_:need(False));signal.alarm(420)
 result={'mode':'controlled-config-diagnostic','success':False,'diagnosticCompleted':False,'backupOrDeployRetried':False,'historicalSQLiteOpened':False,'businessHTTPOrMailboxSyncPerformed':False,'configurationOrContainersChanged':False,'secretOrRowsPrinted':False}
 try:diagnose(result)
 except BaseException as error:result.update(failedStage=STAGE,safeExceptionType=type(error).__name__ if type(error).__name__ in {'RuntimeError','KeyError','ValueError','TypeError','OSError','TimeoutExpired'}else'OtherError')
 finally:CORE.OPS.L.private_write(OUT/'first-result.json',enc(result));CORE.OPS.L.seal(OUT);print(enc(dict(result,manifestSHA256=CORE.OPS.L.file_hash(OUT/'manifest.json'),resultSHA256=CORE.OPS.L.file_hash(OUT/'first-result.json'))).decode(),flush=True)
 return 0 if result['success']else 1
if __name__=='__main__':
 try:code=main()
 except BaseException:print('{"success":false,"safeFailure":"VOYAGEPLEX_942_CONTROLLED_DIAGNOSTIC_PREFLIGHT_FAILED"}',flush=True);code=1
 sys.exit(code)
