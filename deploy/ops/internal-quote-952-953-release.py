"""Fixed one-service deployment and strict read-only verification. Gates remain false."""
import hashlib,importlib.util,json,os,pathlib,re,signal,stat,subprocess,sys,time,urllib.request,urllib.error
ROOT=pathlib.Path('/opt/rr-portal');BASE='85d2082c273d3df3e51b2e414855634c56c498dd';TARGET='593e7e35857a8f434362b7fb078a08870ac56299';TREE='68e209a5bc8ad17b8f72d98ec729db22bad9f797'
BRANCH='refs/heads/ops/internal-quote-952-953-20261019';DEPLOY_PIN=True;VERIFY_PIN=False
BACKUP=ROOT/'deploy/backups/internal-quote-952-953-20261019-backup';BACKUP_MANIFEST='3167ace441a10589644ced79e501993909a7c7be5d9f016de9de4a9f2761e00c';BACKUP_RESULT='7021d496b60a21792f4f4e5a543a9a26c94d971e2ddf3f8236647ea49b549da8'
DEPLOY=BACKUP.with_name('internal-quote-952-953-20261019-deploy');VERIFY=BACKUP.with_name('internal-quote-952-953-20261019-verify');DEPLOY_MANIFEST='';DEPLOY_RESULT=''
CORE_SHA='67fb555ac8f614c743b889b4411a2fc415140a96765cacff6c42da448e408a66'
SOURCE_MANIFEST_SHA='ec6abe3e3dfaa406189859f58d6f3b7358cac1fba5a10246b8dec634231fd132';CACHE='20261019-952-953-reviewed'
STAGE='preflight';CORE=None;OUT=None;ENV=None
COMPOSE=['docker','compose','-p','rr-portal','-f',str(ROOT/'docker-compose.cloud.yml'),'--env-file',str(ROOT/'.env.cloud.production')]

def need(v):
 if not v:raise RuntimeError('INTERNAL_QUOTE_FIXED_RELEASE_REJECTED')
def enc(v):return json.dumps(v,sort_keys=True,ensure_ascii=True,separators=(',',':'),allow_nan=False).encode()
def sha(v):return hashlib.sha256(v).hexdigest()
def core_load():
 p=pathlib.Path(__file__).with_name('internal-quote-backup-library.py');need(p.is_file()and not p.is_symlink()and sha(p.read_bytes())==CORE_SHA);s=importlib.util.spec_from_file_location('fixed_quote_readonly_core',p);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m

def archive(path,msha,rsha):
 need(re.fullmatch('[a-f0-9]{64}',msha or'')and re.fullmatch('[a-f0-9]{64}',rsha or'')and path.is_dir()and not path.is_symlink()and stat.S_IMODE(path.stat().st_mode)==0o700)
 need(CORE.OPS.L.file_hash(path/'manifest.json')==msha and CORE.OPS.L.file_hash(path/'first-result.json')==rsha);manifest=json.loads((path/'manifest.json').read_bytes());entries=list(path.rglob('*'));need(len(entries)<=50000 and all(not p.is_symlink()and(p.is_dir()or p.is_file())and p.stat().st_mode&0o077==0 for p in entries));need(set(manifest)=={str(p.relative_to(path))for p in entries if p.is_file()and p!=path/'manifest.json'})
 need(all(CORE.OPS.L.safe_path(n)and re.fullmatch('[a-f0-9]{64}',h)and CORE.OPS.L.file_hash(path/n)==h for n,h in manifest.items()));receipt=json.loads((path/'first-result.json').read_bytes());need(receipt.get('success')is True)
 return receipt

def original():
 r=archive(BACKUP,BACKUP_MANIFEST,BACKUP_RESULT);need(r.get('backupComplete')is True and r.get('startupSafetyPassed')is True and r.get('base')==BASE and r.get('legacyPortableSQLiteCount')==2);baseline=json.loads((BACKUP/'baseline.private.json').read_bytes());need(baseline['head']==BASE and baseline['startupSafetyPassed']is True);return baseline

def operation(args,timeout=180,checkout=False):
 CORE.COUNTER+=1
 with (OUT/('%03d-%s.private.log'%(CORE.COUNTER,STAGE))).open('xb')as log:p=subprocess.run(args,stdout=log,stderr=subprocess.STDOUT,timeout=timeout,cwd=ROOT,env=ENV,umask=0o022 if checkout else -1)
 need(p.returncode==0)

def source_manifest():
 p=pathlib.Path(__file__).with_name('internal-quote-reviewed-files.json');need(p.is_file()and not p.is_symlink()and sha(p.read_bytes())==SOURCE_MANIFEST_SHA);v=json.loads(p.read_bytes());need(type(v)is dict and len(v)==13 and all(n.startswith(CORE.APP_PREFIX)and CORE.OPS.L.safe_path(n)and re.fullmatch('[a-f0-9]{64}',h)for n,h in v.items()));return v

def checked_source(revision,baseline,files,canonical=False):
 CORE.BASE=revision;need(CORE.source()==baseline['configuration']and CORE.dirty_snapshot()==baseline['preexistingFourDirty']and CORE.OPS.L.file_hash(ROOT/'.env.cloud.production')==baseline['environmentSHA256'])
 need(CORE.run(['git','rev-parse',TARGET+'^{tree}']).decode().strip()==TREE);changed=CORE.run(['git','diff','--name-only','-z','--no-ext-diff','--no-textconv',BASE,TARGET]).decode().strip('\0').split('\0');need(set(changed)==set(files));need(not set(changed)&set(baseline['preexistingFourDirty']))
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
 p=ROOT/'deploy/maintenance';need(p.is_dir()and not p.is_symlink());v=CORE.OPS.L.non_database_inventory(p,[]);return[r for r in v if r['path']!='services/internal-quote']
def maintenance(fn):
 need(fn in {'maintenance_on','wait_service_ready','maintenance_off','require_maintenance_cleared'});operation(['bash','-c','set -euo pipefail; source "$1"; "$2" internal-quote','quote-release',str(ROOT/'deploy/service-maintenance.sh'),fn],340)

def public_assets(target):
 html=CORE.run(['git','show',target+':'+CORE.APP_PREFIX+'frontend/quote.html']);status,body=CORE.READONLY.get('http://127.0.0.1/internal-quote/quote.html');need(status==200 and body==html)
 for n in ('mixed-molds.js','mixed-sku.js','mixed-quotation.js'):
  need(('./'+n+'?v='+CACHE).encode()in html);expected=CORE.run(['git','show',target+':'+CORE.APP_PREFIX+'frontend/'+n]);status,body=CORE.READONLY.get('http://127.0.0.1/internal-quote/'+n+'?v='+CACHE);need(status==200 and body==expected)
 need(CORE.READONLY.get('http://127.0.0.1/internal-quote/health')[0]==200)
 for path in ('/api/auth/me','/api/quotes','/api/admin/users'):need(CORE.READONLY.get('http://127.0.0.1/internal-quote'+path)[0]==401)
 return {'quoteHtmlAndThreeActualCacheUrlsMatchTargetBytes':True,'publicHealthPassed':True,'unauthenticatedBoundaryPassed':True}

def deploy(result,before,files):
 global STAGE
 STAGE='initial-runtime-and-source';current,raw=CORE.runtime();need(current==before['runtime']);old_flags=flags();CORE.BASE=BASE;need(CORE.source()==before['configuration']and CORE.dirty_snapshot()==before['preexistingFourDirty'])
 STAGE='fetch-exact-main';CORE.run(['git','-c','core.hooksPath=/dev/null','fetch','origin','main']);need(CORE.run(['git','rev-parse','FETCH_HEAD']).decode().strip()==TARGET);CORE.run(['git','merge-base','--is-ancestor',BASE,TARGET]);checked_source(BASE,before,files)
 STAGE='fast-forward-with-readable-source';operation(['git','-c','core.hooksPath=/dev/null','-c','merge.autoStash=false','merge','--ff-only','--no-autostash',TARGET],180,checkout=True);checked_source(TARGET,before,files,True)
 STAGE='build-only-internal-quote';need(CORE.runtime()[0]==current);tag=raw['Config']['Image'];need(tag.removesuffix(':latest')=='rr-portal-internal-quote');image=json.loads(CORE.run(['docker','image','inspect',tag]))[0];need(image['Id']==current['app']['image']);operation([*COMPOSE,'build','internal-quote'],600);built=json.loads(CORE.run(['docker','image','inspect',tag]))[0];need(re.fullmatch('sha256:[a-f0-9]{64}',built['Id'])and built['Id']!=image['Id']);checked_source(TARGET,before,files,True)
 STAGE='startup-safety-immediately-before-switch';_,eligible,_=CORE.startup(current['databaseContainer']);need(eligible and CORE.runtime()[0]==current)
 STAGE='switch-only-internal-quote';maintenance('maintenance_on');switched=time.monotonic();operation([*COMPOSE,'up','-d','--no-build','--no-deps','internal-quote'],180);maintenance('wait_service_ready')
 STAGE='verify-new-runtime';after,_=CORE.runtime();need(after['others']==current['others']and config_same(current['app'],after['app'])and after['app']['id']!=current['app']['id']and after['app']['image']==built['Id']and after['app']['restarts']==0);CORE.READONLY.source_runtime_files(after['app']['id'],TARGET);time.sleep(max(0,10-(time.monotonic()-switched)));latest,_=CORE.runtime();need(latest==after and flags()==old_flags);checked_source(TARGET,before,files,True)
 STAGE='clear-only-internal-quote-maintenance';maintenance('maintenance_off');maintenance('require_maintenance_cleared');need(flags()==old_flags and CORE.runtime()[0]==after);result.update(public_assets(TARGET))
 STAGE='final-preservation';original();checked_source(TARGET,before,files,True);need(CORE.runtime()[0]==after);result.update(success=True,onlyInternalQuoteRebuilt=True,allNonQuoteContainersUnchanged=True,fourPreexistingChangesPreserved=True,canonicalGitSourceModesVerified=True,environmentAndProcessMapsPreserved=True,runtimeAfter=after)

def verify(result,before,files):
 global STAGE
 STAGE='deployed-private-receipt';receipt=archive(DEPLOY,DEPLOY_MANIFEST,DEPLOY_RESULT);need(receipt.get('target')==TARGET and receipt.get('onlyInternalQuoteRebuilt')is True);current,_=CORE.runtime();need(current==receipt['runtimeAfter']and current['others']==before['runtime']['others']);checked_source(TARGET,before,files,True);maintenance('require_maintenance_cleared')
 STAGE='current-internal-quote-snapshot';pg=CORE.OPS.pg_capture(current['databaseContainer'],OUT,False)['internal_quote'];legacy=CORE.OPS.sqlite_capture('quote-legacy',CORE.APP/'backend/data',OUT/'legacy');uploads=CORE.OPS.L.non_database_inventory(CORE.APP/'backend/uploads',[]);rawlegacy=CORE.OPS.L.non_database_inventory(CORE.APP/'backend/data',[])
 STAGE='actual-runtime-and-cache-url-proof';result.update(CORE.READONLY.source_runtime_files(current['app']['id'],TARGET));result.update(public_assets(TARGET));checked_source(TARGET,before,files,True);need(CORE.runtime()[0]==current)
 old=before['postgres'];tables_changed=[n for n in sorted(set(old['tables'])|set(pg['tables']))if old['tables'].get(n)!=pg['tables'].get(n)];checks={'originalFullTypedRowsIdentical':not tables_changed,'fullSchemaAndSequenceDefinitionsIdentical':old['schema']==pg['schema'],'sequenceStateIdenticalNonMVCC':old.get('sequenceStates')==pg.get('sequenceStates'),'legacyLogicalSQLiteAndFilesIdentical':legacy=={k:v for k,v in before['legacy'].items()if k!='completeRawFileInventory'},'legacyPhysicalBytesAndPermissionsIdentical':rawlegacy==before['legacy']['completeRawFileInventory'],'uploadBytesAndPermissionsIdentical':uploads==before['uploads'],'runtimeAndAllNonQuoteContainersUnchanged':current==receipt['runtimeAfter']and current['others']==before['runtime']['others'],'runtimeConfigurationMapsMatchOriginal':config_same(before['runtime']['app'],current['app'])}
 CORE.OPS.L.private_write(OUT/'observed.private.json',enc({'postgres':pg,'legacy':legacy,'uploads':uploads,'runtime':current}));original();archive(DEPLOY,DEPLOY_MANIFEST,DEPLOY_RESULT)
 result.update(deploymentVerified=True,checks=checks,changedTables=tables_changed,changedTableCounts={n:{'before':old['tables'].get(n,{}).get('rows'),'after':pg['tables'].get(n,{}).get('rows')}for n in tables_changed},originalBusinessIdPreservationProven=True if not tables_changed else None,requiresScopedRowInvestigation=bool(tables_changed),sequenceStatesNotMVCCAtomic=True,success=all(checks.values()))

def main():
 global CORE,OUT,ENV,STAGE
 need(len(sys.argv)==2 and sys.argv[1]in {'deploy','verify'});mode=sys.argv[1];need((DEPLOY_PIN if mode=='deploy'else VERIFY_PIN)and re.fullmatch('[a-f0-9]{40}',TARGET or'')and re.fullmatch('[a-f0-9]{64}',SOURCE_MANIFEST_SHA or'')and os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_ATTEMPT')=='1')
 os.umask(0o077);OUT=DEPLOY if mode=='deploy'else VERIFY;OUT.mkdir(mode=0o700);CORE=core_load();CORE.OUT=OUT;CORE.OPS=CORE.load('release-data-ops-library.py');CORE.OPS.L=CORE.OPS.load_library(pathlib.Path(__file__).with_name('release-data-library.py'));CORE.OPS.SCHEMAS=('internal_quote',);CORE.READONLY=CORE.load('internal-quote-readonly-library.py');CORE.OPS.run=CORE.run;CORE.READONLY.run=CORE.run
 ENV=dict(os.environ,COMPOSE_BAKE='false',COMPOSE_PARALLEL_LIMIT='1',COMPOSE_PROJECT_NAME='rr-portal',MAINT_FLAG_DIR=str(ROOT/'deploy/maintenance'),COMPOSE_FILE=str(ROOT/'docker-compose.cloud.yml'),ENV_FILE=str(ROOT/'.env.cloud.production'),MAINT_COMPOSE_SERVICES='internal-quote',MAINT_HEALTH_TIMEOUT_SECONDS='300',MAINT_DNS_GRACE_SECONDS='10')
 def stop(*_):need(False)
 signal.signal(signal.SIGTERM,stop);result={'mode':mode,'success':False,'target':TARGET,'expectedTree':TREE,'businessWritesPerformed':False,'credentialsChanged':False,'envFileModified':False,'globalHooksRun':False,'globalMaintenanceChanged':False,'automaticRollback':False}
 try:
  before=original();files=source_manifest();(deploy if mode=='deploy'else verify)(result,before,files)
 except BaseException:result['failedStage']=STAGE
 finally:
  CORE.OPS.L.private_write(OUT/'first-result.json',enc(result));CORE.OPS.L.seal(OUT);public={k:v for k,v in result.items()if k!='runtimeAfter'};print(enc(dict(public,resultSHA256=CORE.OPS.L.file_hash(OUT/'first-result.json'),manifestSHA256=CORE.OPS.L.file_hash(OUT/'manifest.json'))).decode(),flush=True)
 return 0 if result['success']else 1
if __name__=='__main__':
 try:exit_code=main()
 except BaseException:print('{"success":false,"safeFailure":"INTERNAL_QUOTE_RELEASE_PREFLIGHT_FAILED"}',flush=True);exit_code=1
 sys.exit(exit_code)
