"""Fresh PR986 factory backup using the unchanged reviewed PR973 library.

The checkout already contains PR981; both factory containers still run the
earlier application tree. These are distinct, explicitly pinned proof bases.
All execution gates false. No configuration changes or container signals.
"""
import hashlib,importlib.util,json,os,pathlib,re,signal,stat,sys,traceback

ROOT=pathlib.Path('/opt/rr-portal')
BASE='556798afb260020ca8f990c66290177ad0bf3e44'
BASE_TREE='e190beed13d0318a2f3fa2e5b2eb5acf6c6f4308'
CHECKOUT_BASE=BASE
RUNNING_BASE='9b890cc016da403f929f8a7aaeddb878d3de24c5'
BRANCH='refs/heads/ops/pr-986-20261021'
PIN=True
OUT=ROOT/'deploy/backups/pr-986-20261021-backup'
LIBRARY_SHA='79d76bb47312dd08c121ebe2797f54d958666f8b72d00721f67712b152fc4666'
F=None;STAGE='entrypoint'

def need(v,label):
 global STAGE
 if not v:STAGE=label;raise RuntimeError('PR986_FRESH_BACKUP_REJECTED')
def enc(v):return json.dumps(v,ensure_ascii=True,sort_keys=True,separators=(',',':'),allow_nan=False).encode()
def sha(v):return hashlib.sha256(v).hexdigest()

def load():
 p=pathlib.Path(__file__).with_name('factory-review-backup-library.py');need(p.is_file()and not p.is_symlink()and sha(p.read_bytes())==LIBRARY_SHA,'reviewed-factory-library-pin');s=importlib.util.spec_from_file_location('pr986_frozen_factory_backup',p);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);need(m.BACKUP_PIN is False and m.DEPLOY_PIN is False and m.VERIFY_PIN is False,'inert-factory-library');return m

def backup(result):
 global STAGE
 need(F.BASE==CHECKOUT_BASE,'initial-checkout-base');need(F.run(['git','rev-parse','HEAD^{tree}']).decode().strip()==BASE_TREE and F.run(['git','rev-parse',CHECKOUT_BASE+'^{tree}']).decode().strip()==BASE_TREE,'exact-checkout-tree');original_files=F.runtime_files;original_write=F.OPS.L.private_write;written=[False]
 def running_files(service,row):
  need(F.BASE==CHECKOUT_BASE and service in F.SERVICES,'runtime-proof-entry-checkout-base')
  F.BASE=RUNNING_BASE
  try:proof=original_files(service,row)
  finally:F.BASE=CHECKOUT_BASE
  need(proof.pop('hooksAndMigrationsMatchBase',None)is True,'running-hooks-match-old-base');proof.update(runningSourceBase=RUNNING_BASE,hooksAndMigrationsMatchRunningSource=True,ociApplicationTreeMatchesRunningSource=True);return proof
 def write(path,content):
  if path==OUT/'baseline.private.json':
   need(not written[0]and F.BASE==CHECKOUT_BASE,'single-final-checkout-baseline');baseline=json.loads(content);need(baseline['head']==CHECKOUT_BASE and set(baseline['sourceProof'])==set(F.SERVICES),'fresh-two-factory-baseline')
   checkout_tree=F.run(['git','rev-parse',CHECKOUT_BASE+':'+F.APP_PREFIX.rstrip('/')]).decode().strip();running_tree=F.run(['git','rev-parse',RUNNING_BASE+':'+F.APP_PREFIX.rstrip('/')]).decode().strip();need(re.fullmatch('[a-f0-9]{40}',checkout_tree)and re.fullmatch('[a-f0-9]{40}',running_tree)and checkout_tree!=running_tree,'intentional-distinct-application-trees')
   need(len(baseline['runtime']['targets'])==2 and len(baseline['runtime']['others'])==44,'fresh-all-46-containers');need(all(p['runningSourceBase']==RUNNING_BASE and p['applicationTree']==running_tree and p['hooksAndMigrationsMatchRunningSource']is True for p in baseline['sourceProof'].values()),'all-running-code-proven-old-source')
   baseline.update(checkoutSourceBase=CHECKOUT_BASE,runningSourceBase=RUNNING_BASE,checkoutApplicationTree=checkout_tree,runningApplicationTree=running_tree,checkoutAndRunningSourceIntentionallyDifferent=True);content=enc(baseline);written[0]=True
  original_write(path,content)
 F.runtime_files=running_files;F.OPS.L.private_write=write
 try:
  STAGE='fresh-backup-library';F.backup(result);need(written[0]and F.BASE==CHECKOUT_BASE,'complete-fresh-divergence-baseline')
 finally:
  F.runtime_files=original_files;F.OPS.L.private_write=original_write;F.BASE=CHECKOUT_BASE
 # The pinned legacy function calls its own comparison base simply "Base".
 # Its public receipt is renamed here to identify the actual running source.
 need(result.pop('actualHooksAndMigrationsMatchBase',None)is True and result.pop('actualOCIApplicationTreesMatchBase',None)is True,'legacy-running-proof-receipt')
 result.update(checkoutSourceBase=CHECKOUT_BASE,runningSourceBase=RUNNING_BASE,checkoutAndRunningSourceIntentionallyDifferent=True,actualHooksAndMigrationsMatchRunningSource=True,actualOCIApplicationTreesMatchRunningSource=True,otherContainerCount=44,all46ContainerRuntimeCaptured=True)

def main():
 global F
 need(PIN and sys.argv[1:]==['backup']and os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_ATTEMPT')=='1','false-draft-or-wrong-invocation');os.umask(0o077);OUT.mkdir(mode=0o700);F=load();F.BASE=CHECKOUT_BASE;F.ROOT=ROOT;F.OUT=OUT;F.OPS=F.load('release-data-ops-library.py');F.OPS.L=F.OPS.load_library(pathlib.Path(__file__).with_name('release-data-library.py'));F.OPS.run=F.run;signal.signal(signal.SIGTERM,lambda *_:need(False,'terminated'))
 result={'mode':'backup','base':BASE,'target':BASE,'tree':BASE_TREE,'success':False,'backupComplete':False,'checkoutSourceBase':CHECKOUT_BASE,'runningSourceBase':RUNNING_BASE,'businessWritesPerformed':False,'credentialsOrConfigurationChanged':False,'containerSignalsPerformed':False,'otherServicesRequested':False,'secretOrRowsPrinted':False}
 try:backup(result)
 except BaseException as error:result.update(success=False,failedStage=STAGE,libraryFailedStage=F.STAGE,safeExceptionType=type(error).__name__);F.OPS.L.private_write(OUT/'failure.private.txt',traceback.format_exc().encode())
 finally:
  F.OPS.L.private_write(OUT/'first-result.json',enc(result));F.OPS.L.seal(OUT);print(enc(dict(result,manifestSHA256=F.OPS.L.file_hash(OUT/'manifest.json'),resultSHA256=F.OPS.L.file_hash(OUT/'first-result.json'))).decode(),flush=True)
 return 0 if result['success']else 1

if __name__=='__main__':
 try:sys.exit(main())
 except SystemExit:raise
 except BaseException:print('{"success":false,"safeFailure":"PR986_BACKUP_PREFLIGHT_REJECTED"}',flush=True);sys.exit(1)
