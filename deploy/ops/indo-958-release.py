"""Fixed one-service deployment and strict read-only verification. Gates remain false."""
import hashlib,importlib.util,json,os,pathlib,re,signal,stat,subprocess,sys,time,urllib.request,urllib.error
ROOT=pathlib.Path('/opt/rr-portal');BASE='6eece9ec6802533c077dd53d46e89902ffb4e90f';TARGET='32440d3f0891e52707ea89f8dfe72eabe9f62ad7';TREE='c00584ff572f2b37cad03eb974b712fc7f559ffb'
BRANCH='refs/heads/ops/indo-shipping-958-20261020';DEPLOY_PIN=True;VERIFY_PIN=False
BACKUP=ROOT/'deploy/backups/indo-shipping-958-20261020-backup';BACKUP_MANIFEST='63324cbb1eef24753f9d7cb73084dfe7cabed3e87bffc47d63e365cb1f351acc';BACKUP_RESULT='c95bdf322e61299c4594c0492c787535d0536a36ff66f3b31270275fa608c3a1'
DEPLOY=BACKUP.with_name('indo-shipping-958-20261020-deploy');VERIFY=BACKUP.with_name('indo-shipping-958-20261020-verify');DEPLOY_MANIFEST='';DEPLOY_RESULT=''
CORE_SHA='5631d65725bc871cee1e2be992723a03a437028b4b7c07632ed565ad904a42a6'
SOURCE_MANIFEST_SHA='2f7d43445bffd4f8c5d465657913bf29639ca5553da36ef70f1dc211d4ff301d'
STAGE='preflight';CORE=None;OUT=None;ENV=None
COMPOSE=['docker','compose','-p','rr-portal','-f',str(ROOT/'docker-compose.cloud.yml'),'--env-file',str(ROOT/'.env.cloud.production')]

def need(v):
 if not v:raise RuntimeError('INDO_SHIPPING_FIXED_RELEASE_REJECTED')
def enc(v):return json.dumps(v,sort_keys=True,ensure_ascii=True,separators=(',',':'),allow_nan=False).encode()
def sha(v):return hashlib.sha256(v).hexdigest()
def core_load():
 p=pathlib.Path(__file__).with_name('indo-958-backup-library.py');need(p.is_file()and not p.is_symlink()and sha(p.read_bytes())==CORE_SHA);s=importlib.util.spec_from_file_location('fixed_indo_readonly_core',p);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m

def archive(path,msha,rsha):
 need(re.fullmatch('[a-f0-9]{64}',msha or'')and re.fullmatch('[a-f0-9]{64}',rsha or'')and path.is_dir()and not path.is_symlink()and stat.S_IMODE(path.stat().st_mode)==0o700)
 need(CORE.L.file_hash(path/'manifest.json')==msha and CORE.L.file_hash(path/'first-result.json')==rsha);manifest=json.loads((path/'manifest.json').read_bytes());entries=list(path.rglob('*'));need(len(entries)<=50000 and all(not p.is_symlink()and(p.is_dir()or p.is_file())and p.stat().st_mode&0o077==0 for p in entries));need(set(manifest)=={str(p.relative_to(path))for p in entries if p.is_file()and p!=path/'manifest.json'})
 need(all(CORE.L.safe_path(n)and re.fullmatch('[a-f0-9]{64}',h)and CORE.L.file_hash(path/n)==h for n,h in manifest.items()));receipt=json.loads((path/'first-result.json').read_bytes());need(receipt.get('success')is True)
 return receipt

def original():
 r=archive(BACKUP,BACKUP_MANIFEST,BACKUP_RESULT);need(r.get('backupComplete')is True and r.get('startupSafetyPassed')is True and r.get('base')==BASE and r.get('noPersistentRuntimeMounts')is True and r.get('targetMaintenanceInitiallyCleared')is True and r.get('composeRuntimeLiteralAndSerializedEnvironmentProven')is True);baseline=json.loads((BACKUP/'baseline.private.json').read_bytes());need(baseline['head']==BASE and baseline['startupSafetyPassed']is True and type(baseline['maintenanceInventory'])is list and baseline['composeEnvironmentProof']['composeVersion']=='5.1.0'and baseline['composeEnvironmentProof']['forwardSerializedLiteralEqualsComposeJSON']is True and baseline['composeEnvironmentProof']['literalExplicitAndImageDefaultsEqualRuntime']is True);return baseline

def operation(args,timeout=180,checkout=False):
 CORE.COUNTER+=1
 with (OUT/('%03d-%s.private.log'%(CORE.COUNTER,STAGE))).open('xb')as log:p=subprocess.run(args,stdout=log,stderr=subprocess.STDOUT,timeout=timeout,cwd=ROOT,env=ENV,umask=0o022 if checkout else -1)
 need(p.returncode==0)

def source_manifest():
 p=pathlib.Path(__file__).with_name('indo-958-source-pin.json');need(p.is_file()and not p.is_symlink()and sha(p.read_bytes())==SOURCE_MANIFEST_SHA);v=json.loads(p.read_bytes());need(type(v)is dict and set(v)=={'base','reviewedHead','target','tree','sourceBlobs','runtimeDocuments','dist'}and v['base']==BASE and v['target']==TARGET and v['tree']==TREE and re.fullmatch('[a-f0-9]{40}',v['reviewedHead']or''));files=v['sourceBlobs'];need(type(files)is dict and 1<=len(files)<=30 and all(n.startswith(CORE.APP_PREFIX)and CORE.L.safe_path(n)and re.fullmatch('[a-f0-9]{64}',h)for n,h in files.items()));need(type(v['dist'])is dict and'index.html'in v['dist']and 2<=len(v['dist'])<=128 and all((n=='index.html'or re.fullmatch('assets/[A-Za-z0-9_.-]+\\.(js|css)',n))and re.fullmatch('[a-f0-9]{64}',h)for n,h in v['dist'].items()));return v

def checked_source(revision,baseline,pin,canonical=False):
 files=pin['sourceBlobs']
 global STAGE
 STAGE='checked-source-head-and-fixed-configuration';CORE.BASE=revision;need(CORE.source()==baseline['configuration'])
 STAGE='checked-source-four-preexisting-tracked-changes';need(CORE.dirty_snapshot()==baseline['preexistingFourDirty'])
 STAGE='checked-source-private-environment-hash';need(CORE.L.file_hash(ROOT/'.env.cloud.production')==baseline['environmentSHA256'])
 STAGE='checked-source-startup-code-unchanged';CORE.run(['git','diff','--quiet',BASE,TARGET,'--',CORE.APP_PREFIX+'src/IndoShipping.Api/Program.cs',CORE.APP_PREFIX+'src/IndoShipping.Api/DeploymentSecrets.cs',CORE.APP_PREFIX+'src/IndoShipping.Api/Features/Bootstrap',CORE.APP_PREFIX+'src/IndoShipping.Infrastructure/Persistence',CORE.APP_PREFIX+'db/',CORE.APP_PREFIX+'seed/',CORE.APP_PREFIX+'Dockerfile',CORE.APP_PREFIX+'.dockerignore'])
 STAGE='checked-source-compiled-document-inventory';need(CORE.READONLY.source_documents(TARGET)==pin['runtimeDocuments']and CORE.run(['git','rev-parse',pin['reviewedHead']+'^{tree}']).decode().strip()==TREE)
 STAGE='checked-source-target-tree-and-reviewed-files';need(CORE.run(['git','rev-parse',TARGET+'^{tree}']).decode().strip()==TREE);changed=CORE.run(['git','diff','--name-only','-z','--no-ext-diff','--no-textconv',BASE,TARGET]).decode().strip('\0').split('\0');need(set(changed)==set(files));need(not set(changed)&set(baseline['preexistingFourDirty']))
 for n,h in files.items():
  STAGE='checked-source-reviewed-blob-and-canonical-mode';need(sha(CORE.run(['git','show',TARGET+':'+n]))==h)
  if canonical:
   path=ROOT/n;entry=CORE.run(['git','ls-tree','-z',TARGET,'--',n]).split(b'\t',1);need(len(entry)==2 and entry[1]==n.encode()+b'\0'and re.fullmatch(b'100(?:644|755) blob [a-f0-9]{40}',entry[0]));desired=0o755 if entry[0].startswith(b'100755')else 0o644
   for ancestor in(path,*path.parents):
    if ancestor==ROOT:break
    need(not ancestor.is_symlink())
   need(path.is_file()and stat.S_IMODE(path.stat().st_mode)==desired and CORE.L.file_hash(path)==h)


def sealed_literal_environment(before):
 raw=json.loads((BACKUP/'app-inspect.private.json').read_bytes());image=json.loads((BACKUP/'app-image.private.json').read_bytes());declared=json.loads((BACKUP/'compose-environment.private.json').read_bytes());literal=json.loads((BACKUP/'literal-compose-environment.private.json').read_bytes());need(raw['Id']==before['runtime']['app']['id']and raw['Image']==before['runtime']['app']['image']==image['Id']);actual=CORE.envmap(raw['Config']['Env']);proof=before['composeEnvironmentProof'];need(sha(enc(actual))==before['runtime']['app']['environmentMapSHA256']and sha(enc(declared))==proof['serializedExplicitEnvironmentSHA256']and sha(enc(literal))==proof['literalExplicitEnvironmentSHA256']);need(CORE.literal_explicit_environment(actual,CORE.envmap(image['Config'].get('Env')or[]),declared)==literal);return actual,literal

def compose_preflight(before,label):
 global STAGE
 need(label in {'prebuild','preswitch','verify'})
 STAGE='controlled-compose-version';need(CORE.run(['docker','compose','version','--short']).decode().strip()=='5.1.0')
 STAGE='sealed-literal-explicit-environment';actual,literal=sealed_literal_environment(before)
 STAGE='controlled-compose-configuration';CORE.COUNTER+=1
 with(OUT/('%03d-compose-config-stderr.private'%CORE.COUNTER)).open('xb')as errors:p=subprocess.run([*COMPOSE,'config','--format','json'],stdout=subprocess.PIPE,stderr=errors,timeout=90,cwd=ROOT,env=ENV)
 STAGE='controlled-compose-forward-serialized-environment';need(p.returncode==0 and len(p.stdout)<=32*1024**2);config=json.loads(p.stdout);need(type(config)is dict and type(config.get('services'))is dict and type(config['services'].get('indo-shipping'))is dict);declared=config['services']['indo-shipping'].get('environment',{});need(declared==CORE.serialized_environment(literal));CORE.L.private_write(OUT/(label+'-controlled-literal-compose-environment.private.json'),enc(literal));return {'exactComposeVersionAndLiteralEnvironmentPreserved':True,'forwardSerializedEnvironmentMatchesCurrentComposeConfiguration':True}

def built_image_environment(image,before):
 need(re.fullmatch('sha256:[a-f0-9]{64}',image.get('Id',''))and image['Id']!=before['runtime']['app']['image']);actual,literal=sealed_literal_environment(before);controlled=json.loads((OUT/'prebuild-controlled-literal-compose-environment.private.json').read_bytes());need(controlled==literal);expected=CORE.envmap(image['Config'].get('Env')or[]);expected.update(literal);need(expected==actual);return True

def config_same(a,b):
 return all(a[k]==b[k]for k in ('environmentMapSHA256','processEnvironmentWithoutAutomaticHostnameSHA256','mounts','memory','swap','healthcheck','command','entrypoint','user','workingDirectory'))
def flags():
 p=ROOT/'deploy/maintenance';need(p.is_dir()and not p.is_symlink());v=CORE.L.non_database_inventory(p,[]);return[r for r in v if r['path']!='services/indo-shipping']
def maintenance(fn):
 need(fn in {'maintenance_on','wait_service_ready','maintenance_off','require_maintenance_cleared'});operation(['bash','-c','set -euo pipefail; source "$1"; "$2" indo-shipping','indo-release',str(ROOT/'deploy/service-maintenance.sh'),fn],340)

def public_assets(cid,pin):
 manifest=CORE.READONLY.frontend_proof(cid,pin['dist']);backend=CORE.READONLY.backend_proof(cid,pin['runtimeDocuments']);return {'actualFrontendProductionBuildMatchesReviewedBytes':True,'versionedAssets':len(manifest)-1,'actualDllPdbDocumentsMatchTarget':True,'backendSourceProof':backend,'publicHealthPassed':True,'unauthenticatedBoundaryPassed':True}

def deploy(result,before,files):
 global STAGE
 STAGE='initial-runtime';current,raw=CORE.runtime();need(current==before['runtime'])
 STAGE='initial-target-maintenance-cleared-and-all-flags';need(CORE.maintenance_inventory()==before['maintenanceInventory']);old_flags=flags();need(old_flags==before['maintenanceInventory']);maintenance('require_maintenance_cleared')
 STAGE='initial-source-and-fixed-configuration';CORE.BASE=BASE;need(CORE.source()==before['configuration'])
 STAGE='initial-four-preexisting-tracked-changes';need(CORE.dirty_snapshot()==before['preexistingFourDirty'])
 STAGE='initial-private-environment-hash';need(CORE.L.file_hash(ROOT/'.env.cloud.production')==before['environmentSHA256']);result.update(compose_preflight(before,'prebuild'))
 STAGE='fetch-exact-main';CORE.run(['git','-c','core.hooksPath=/dev/null','fetch','origin','main']);need(CORE.run(['git','rev-parse','FETCH_HEAD']).decode().strip()==TARGET);CORE.run(['git','merge-base','--is-ancestor',BASE,TARGET]);checked_source(BASE,before,files)
 STAGE='fast-forward-with-readable-source';operation(['git','-c','core.hooksPath=/dev/null','-c','merge.autoStash=false','merge','--ff-only','--no-autostash',TARGET],180,checkout=True);checked_source(TARGET,before,files,True)
 STAGE='build-only-indo-shipping';need(CORE.runtime()[0]==current);tag=raw['Config']['Image'];need(tag.removesuffix(':latest')=='rr-portal-indo-shipping');image=json.loads(CORE.run(['docker','image','inspect',tag]))[0];need(image['Id']==current['app']['image']);operation([*COMPOSE,'build','indo-shipping'],1500);built=json.loads(CORE.run(['docker','image','inspect',tag]))[0];need(re.fullmatch('sha256:[a-f0-9]{64}',built['Id'])and built['Id']!=image['Id']);checked_source(TARGET,before,files,True)
 STAGE='candidate-image-environment-before-maintenance-or-switch';need(built_image_environment(built,before));result.update(candidateImageEnvironmentMatchesBaselineBeforeSwitch=True)
 STAGE='all-maintenance-flags-before-switch';need(CORE.maintenance_inventory()==before['maintenanceInventory']);result.update(compose_preflight(before,'preswitch'))
 STAGE='startup-safety-immediately-before-switch';_,eligible,_=CORE.startup(current['app']['id'],current['databaseContainer']);need(eligible and CORE.runtime()[0]==current)
 STAGE='switch-only-indo-shipping';maintenance('maintenance_on');switched=time.monotonic();operation([*COMPOSE,'up','-d','--no-build','--no-deps','indo-shipping'],180);maintenance('wait_service_ready')
 STAGE='verify-new-runtime';after,_=CORE.runtime();need(after['others']==current['others']and config_same(current['app'],after['app'])and after['app']['id']!=current['app']['id']and after['app']['image']==built['Id']and after['app']['restarts']==0);CORE.READONLY.backend_proof(after['app']['id'],files['runtimeDocuments']);time.sleep(max(0,10-(time.monotonic()-switched)));latest,_=CORE.runtime();need(latest==after and flags()==old_flags);checked_source(TARGET,before,files,True)
 STAGE='clear-only-indo-shipping-maintenance';maintenance('maintenance_off');maintenance('require_maintenance_cleared');need(flags()==old_flags and CORE.runtime()[0]==after)
 STAGE='public-assets-and-authentication-boundary'
 try:result.update(public_assets(CORE.runtime()[0]['app']['id'],files))
 except BaseException:maintenance('maintenance_on');raise
 STAGE='final-maintenance-inventory';need(CORE.maintenance_inventory()==before['maintenanceInventory'])
 STAGE='final-preservation';original();checked_source(TARGET,before,files,True);need(CORE.runtime()[0]==after);result.update(success=True,onlyIndoShippingRebuilt=True,allNonIndoContainersUnchanged=True,fourPreexistingChangesPreserved=True,canonicalGitSourceModesVerified=True,environmentAndProcessMapsPreserved=True,runtimeAfter=after)

def verify(result,before,files):
 global STAGE
 STAGE='deployed-private-receipt';receipt=archive(DEPLOY,DEPLOY_MANIFEST,DEPLOY_RESULT);need(receipt.get('target')==TARGET and receipt.get('onlyIndoShippingRebuilt')is True);current,_=CORE.runtime();need(current==receipt['runtimeAfter']and current['others']==before['runtime']['others']);checked_source(TARGET,before,files,True);maintenance('require_maintenance_cleared');need(CORE.maintenance_inventory()==before['maintenanceInventory']);result.update(compose_preflight(before,'verify'))
 STAGE='current-readonly-exported-indo-snapshot';pg=CORE.READONLY.pg_capture(current['databaseContainer'],OUT,False)['indo_shipping']
 STAGE='actual-dll-pdb-runtime-and-all-public-assets';result.update(public_assets(current['app']['id'],files));checked_source(TARGET,before,files,True);need(CORE.runtime()[0]==current)
 old=before['postgres'];tables_changed=[n for n in sorted(set(old['tables'])|set(pg['tables']))if old['tables'].get(n)!=pg['tables'].get(n)];checks={'allOriginalFullTypedRowsIdentical':not tables_changed,'fullSchemaAndSequenceDefinitionsIdentical':old['schema']==pg['schema'],'sequenceStateIdenticalNonMVCC':old.get('sequenceStates')==pg.get('sequenceStates'),'databaseImagesAttachmentsAndUserPermissionsIncluded':{'images','Users'}<=set(pg['tables'])and all(old['tables'][n]==pg['tables'][n]for n in('images','Users')),'runtimeAndAllNonIndoContainersUnchanged':current==receipt['runtimeAfter']and current['others']==before['runtime']['others'],'runtimeConfigurationMapsMatchOriginal':config_same(before['runtime']['app'],current['app'])}
 CORE.L.private_write(OUT/'observed.private.json',enc({'postgres':pg,'runtime':current}));original();archive(DEPLOY,DEPLOY_MANIFEST,DEPLOY_RESULT);need(CORE.maintenance_inventory()==before['maintenanceInventory'])
 result.update(deploymentVerified=True,checks=checks,changedTables=tables_changed,changedTableCounts={n:{'before':old['tables'].get(n,{}).get('rows'),'after':pg['tables'].get(n,{}).get('rows')}for n in tables_changed},originalBusinessIdPreservationProven=True if not tables_changed else None,requiresScopedRowInvestigation=bool(tables_changed),sequenceStatesNotMVCCAtomic=True,success=all(checks.values()))

def main():
 global CORE,OUT,ENV,STAGE
 need(len(sys.argv)==2 and sys.argv[1]in {'deploy','verify'});mode=sys.argv[1];need((DEPLOY_PIN if mode=='deploy'else VERIFY_PIN)and re.fullmatch('[a-f0-9]{40}',TARGET or'')and re.fullmatch('[a-f0-9]{64}',SOURCE_MANIFEST_SHA or'')and os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_ATTEMPT')=='1')
 os.umask(0o077);OUT=DEPLOY if mode=='deploy'else VERIFY;OUT.mkdir(mode=0o700);CORE=core_load();CORE.OUT=OUT;CORE.L=CORE.load('release-data-library.py');CORE.READONLY=CORE.load('indo-958-readonly.py');CORE.READONLY.run=CORE.run
 ENV=dict(os.environ,COMPOSE_BAKE='false',COMPOSE_PARALLEL_LIMIT='1',COMPOSE_PROJECT_NAME='rr-portal',MAINT_FLAG_DIR=str(ROOT/'deploy/maintenance'),COMPOSE_FILE=str(ROOT/'docker-compose.cloud.yml'),ENV_FILE=str(ROOT/'.env.cloud.production'),MAINT_COMPOSE_SERVICES='indo-shipping',MAINT_HEALTH_TIMEOUT_SECONDS='300',MAINT_DNS_GRACE_SECONDS='10')
 def stop(*_):need(False)
 signal.signal(signal.SIGTERM,stop);result={'mode':mode,'success':False,'target':TARGET,'expectedTree':TREE,'businessWritesPerformed':False,'credentialsChanged':False,'envFileModified':False,'globalHooksRun':False,'globalMaintenanceChanged':False,'automaticRollback':False}
 try:
  before=original();files=source_manifest();(deploy if mode=='deploy'else verify)(result,before,files)
 except BaseException:result['failedStage']=STAGE
 finally:
  CORE.L.private_write(OUT/'first-result.json',enc(result));CORE.L.seal(OUT);public={k:v for k,v in result.items()if k not in {'runtimeAfter','backendSourceProof'}};print(enc(dict(public,resultSHA256=CORE.L.file_hash(OUT/'first-result.json'),manifestSHA256=CORE.L.file_hash(OUT/'manifest.json'))).decode(),flush=True)
 return 0 if result['success']else 1
if __name__=='__main__':
 try:exit_code=main()
 except BaseException:print('{"success":false,"safeFailure":"INDO_SHIPPING_RELEASE_PREFLIGHT_FAILED"}',flush=True);exit_code=1
 sys.exit(exit_code)
