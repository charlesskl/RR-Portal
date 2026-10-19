"""Fixed PR942 source-proof diagnosis; reads existing evidence, never retries backup."""
import hashlib, importlib.util, json, os, pathlib, re, signal, subprocess, sys
ROOT=pathlib.Path('/opt/rr-portal')
OUT=ROOT/'deploy/backups/voyageplex-942-20261019-source-diagnostic'
FAILED=ROOT/'deploy/backups/voyageplex-942-20261019-backup-v2'
MANIFEST='d80feb3735d4b1a88f2a1cdfb3c5497fafea76dd2447d6bf67e33e3779c82cf2'
RESULT='cdb05627c65f6e73993b4d5de8af2f398e49ce8a8fdbfc3eff4de4387b848a49'
CORE_SHA='df7bd36ec986b0b7456dc4794fd287c772a08941771ea59fc631ec6d920404b2'
BRANCH='refs/heads/ops/voyageplex-942-20261019';PIN=True;STAGE='entry';COUNTER=0;CORE=None

def need(value):
 if not value:raise RuntimeError('VOYAGEPLEX_942_SOURCE_DIAGNOSTIC_REJECTED')
def enc(value):return json.dumps(value,sort_keys=True,ensure_ascii=True,separators=(',',':'),allow_nan=False).encode()
def sha(value):return hashlib.sha256(value).hexdigest()
def run(args,data=None,timeout=90):
 global COUNTER
 COUNTER+=1
 with (OUT/('%03d-stderr.private'%COUNTER)).open('xb')as errors:
  p=subprocess.run(args,input=data,stdout=subprocess.PIPE,stderr=errors,timeout=timeout,cwd=ROOT)
 need(p.returncode==0 and len(p.stdout)<=32*1024**2);return p.stdout
def load_core():
 path=pathlib.Path(__file__).with_name('voyageplex-942-backup-v2.py');need(path.is_file()and not path.is_symlink()and sha(path.read_bytes())==CORE_SHA)
 spec=importlib.util.spec_from_file_location('reviewed_voyageplex942_backup',path);core=importlib.util.module_from_spec(spec);spec.loader.exec_module(core)
 need(core.BASE=='f32c9f00760e048a0846045a6d638290074b48d6'and core.BRANCH==BRANCH and not core.DEPLOY_PIN and not core.VERIFY_PIN)
 core.OUT=OUT;core.run=run;core.OPS=core.load('release-data-ops-library.py');core.OPS.L=core.OPS.load_library(pathlib.Path(__file__).with_name('release-data-library.py'));core.OPS.run=run
 return core
def evidence():
 first=CORE.prior_archive(FAILED,MANIFEST,RESULT)
 need(first.get('success')is False and first.get('backupComplete')is False and first.get('base')==CORE.BASE and first.get('failedStage')=='actual-images-sources-and-processes')
 prior=CORE.prior_evidence()
 return prior
def binding(raw):
 return {service:{'id':r['Id'],'image':r['Image'],'started':r['State']['StartedAt'],'restarts':r['RestartCount'],'configSHA256':sha(enc(r['Config'])),'hostConfigSHA256':sha(enc(r['HostConfig'])),'mounts':sorted(r.get('Mounts',[]),key=enc)}for service,r in raw.items()}
def environment_proof(image,explicit,actual):
 need(type(explicit)is dict and all(type(k)is str and re.fullmatch('[A-Za-z_][A-Za-z0-9_]*',k)for k in explicit))
 expected=CORE.envmap(image['Config'].get('Env')or[]);expected.update(explicit);runtime=CORE.envmap(actual['Config']['Env'])
 return {'allExplicitValuesAreStrings':all(type(v)is str for v in explicit.values()),'nonStringExplicitKeys':sorted(k for k,v in explicit.items()if type(v)is not str),'changedKeys':sorted(k for k in expected.keys()&runtime.keys()if expected[k]!=runtime[k]),'addedActualKeys':sorted(runtime.keys()-expected.keys()),'missingActualKeys':sorted(expected.keys()-runtime.keys()),'imageDefaultsPlusComposeEqualsActual':expected==runtime}

HASH_CODE="""import hashlib,json,pathlib,sys
out={}
for name in json.loads(sys.stdin.read()):
 p=pathlib.Path('/app')/name
 try:
  valid=p.is_file()and not p.is_symlink()and p.stat().st_size<=16*1024**2
  out[name]={'readableRegularFile':valid,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()if valid else None}
 except OSError:out[name]={'readableRegularFile':False,'sha256':None}
print(json.dumps(out,sort_keys=True))
"""
def parser_source(runtime):
 prefix=CORE.APP_PREFIX+'services/email-parser/'
 names=run(['git','ls-tree','-r','--name-only','-z',CORE.BASE,'--',prefix+'app']).decode().strip('\0').split('\0')
 need(names and all(n.startswith(prefix+'app/')and CORE.OPS.L.safe_path(n)for n in names))
 expected={n[len(prefix):]:sha(run(['git','show',CORE.BASE+':'+n]))for n in names}
 actual=json.loads(run(['docker','exec','-i',runtime['targets']['voyageplex-parser']['id'],'python','-c',HASH_CODE],enc(list(expected))))
 need(type(actual)is dict and set(actual)==set(expected));rows={}
 for name,value in actual.items():
  need(type(value)is dict and type(value.get('readableRegularFile'))is bool and(value.get('sha256')is None or re.fullmatch('[a-f0-9]{64}',value['sha256'])))
  rows[name]={'expectedSHA256':expected[name],'actualSHA256':value['sha256'],'readableRegularFile':value['readableRegularFile'],'matchesBase':value['sha256']==expected[name]}
 return {'files':rows,'fileCount':len(rows),'allFilesMatchBase':all(r['matchesBase']for r in rows.values())}

def artifact_proofs(runtime):
 global STAGE
 STAGE='actual-api-dll';dll=run(['docker','exec',runtime['targets']['voyageplex-api']['id'],'sh','-c','test ! -r /app/VoyagePlex.Api.dll || sha256sum /app/VoyagePlex.Api.dll || true']).decode().strip()
 STAGE='actual-web-build-id';build=run(['docker','exec',runtime['targets']['voyageplex-web']['id'],'sh','-c','test ! -r /app/.next-build/BUILD_ID || head -c 257 /app/.next-build/BUILD_ID || true'])
 return {'apiDLLReadable':bool(dll),'apiDLLHashOutputValid':bool(re.fullmatch('[a-f0-9]{64}  /app/VoyagePlex.Api.dll',dll)),'webBuildIDReadable':bool(build),'webBuildIDReadableAndBounded':0<len(build)<=256}

def diagnose(result):
 global STAGE
 STAGE='verify-original-evidence';original=evidence();manifest=json.loads((FAILED/'manifest.json').read_bytes())
 stage_files=('images.private.json','compose-environment.private.json','voyageplex-api-processes.private.txt','voyageplex-parser-processes.private.txt','voyageplex-web-processes.private.txt')
 result['completedSourceSubstageFiles']={name:name in manifest for name in stage_files}
 old=json.loads((FAILED/'containers.private.json').read_bytes());need(type(old)is dict and set(old)==set(CORE.SERVICES))
 STAGE='initial-source-environment-dirty-and-runtime';config=CORE.source();dirty=CORE.dirty_snapshot();env=ROOT/'.env.cloud.production';envhash=CORE.OPS.L.file_hash(env);before,raw=CORE.runtime();need(binding(old)==binding(raw));CORE.OPS.L.private_write(OUT/'initial-runtime.private.json',enc(before))
 STAGE='image-defaults';images={};image_source={}
 if 'images.private.json'in manifest:
  images=json.loads((FAILED/'images.private.json').read_bytes());need(type(images)is dict)
 for service in CORE.SERVICES:
  image=raw[service]['Image']
  if image in images:need(images[image]['Id']==image);image_source[service]='sealed-failed-backup-image-inspect'
  else:
   records=json.loads(run(['docker','image','inspect',image]));need(type(records)is list and len(records)==1 and records[0]['Id']==image);images[image]=records[0];image_source[service]='current-exact-image-inspect'
 STAGE='compose-and-runtime-environment-key-differences';config_json=json.loads(run(['docker','compose','-p','rr-portal','-f',str(ROOT/'docker-compose.cloud.yml'),'--env-file',str(env),'config','--format','json']))
 CORE.OPS.L.private_write(OUT/'current-environment-evidence.private.json',enc({'images':images,'explicit':{s:config_json['services'][s].get('environment',{})for s in CORE.SERVICES},'actualConfigEnvironment':{s:raw[s]['Config']['Env']for s in CORE.SERVICES}}))
 result['environmentProof']={service:dict(environment_proof(images[raw[service]['Image']],config_json['services'][service].get('environment',{}),raw[service]),imageDefaultsEvidence=image_source[service])for service in CORE.SERVICES}
 STAGE='actual-parser-source';result['parserSource']=parser_source(before)
 result.update(artifact_proofs(before))
 STAGE='final-source-environment-dirty-runtime-and-evidence';after,end=CORE.runtime();need(before==after and binding(old)==binding(end)and CORE.source()==config and CORE.dirty_snapshot()==dirty and CORE.OPS.L.file_hash(env)==envhash and evidence()==original)
 result.update(success=True,diagnosticCompleted=True,originalFailedArchivesUnchanged=True,threeTargetsAndAllOtherContainersUnchanged=True,sourceEnvironmentAndFourDirtyUnchanged=True)

def main():
 global CORE
 need(PIN and len(sys.argv)==2 and sys.argv[1]=='source-diagnostic'and os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_ATTEMPT')=='1')
 os.umask(0o077);OUT.mkdir(mode=0o700);CORE=load_core();signal.signal(signal.SIGTERM,lambda *_:need(False));signal.signal(signal.SIGALRM,lambda *_:need(False));signal.alarm(340)
 result={'success':False,'diagnosticCompleted':False,'mode':'source-diagnostic','base':CORE.BASE,'backupRetried':False,'historicalSQLiteOpened':False,'businessHTTPOrMailboxSyncPerformed':False,'configurationOrContainersChanged':False,'secretOrRowsPrinted':False}
 try:diagnose(result)
 except BaseException as error:result.update(failedStage=STAGE,safeExceptionType=type(error).__name__ if type(error).__name__ in {'RuntimeError','KeyError','ValueError','TypeError','OSError','TimeoutExpired'}else'OtherError')
 finally:
  CORE.OPS.L.private_write(OUT/'first-result.json',enc(result));CORE.OPS.L.seal(OUT);print(enc(dict(result,manifestSHA256=CORE.OPS.L.file_hash(OUT/'manifest.json'),resultSHA256=CORE.OPS.L.file_hash(OUT/'first-result.json'))).decode(),flush=True)
 return 0 if result['success']else 1
if __name__=='__main__':
 try:code=main()
 except BaseException:print('{"success":false,"safeFailure":"VOYAGEPLEX_942_SOURCE_DIAGNOSTIC_PREFLIGHT_FAILED"}',flush=True);code=1
 sys.exit(code)
