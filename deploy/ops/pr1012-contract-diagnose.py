"""Inert immutable-image contract diagnosis; private configs stay only in RAM.

No files are written, no services signalled, and no Config/Env/Cmd is emitted.
"""
import datetime,hashlib,importlib.util,json,os,pathlib,re,subprocess,sys
ROOT=pathlib.Path('/opt/rr-portal')
BRANCH='refs/heads/ops/pr-1012-20261026'
TARGET='df60d6a6b1e7f76070cd866cbbc6a4ee50936122'
PHASE='diagnose-contract'
EXECUTE=True
SERVICE='sprayplan-test'
CURRENT='cc6ee80a9a34e49ec04242f9be6c231ec7c889e4289778736fe6fdad6fb98011'
OLD='sha256:a41a9f9f7b6d1cc7b3ff4bdacf8d6509aa410c52f9a98db48db21d8bdc796d6a'
NEW='sha256:0e730833ac4cfd2f8118cd87ec9b7be7008d6d0dca92ecc2b7014479c05fc42b'
LIBRARY_SHA256='9f84d48c122999038151db2f8d6e63cbeba3c5d658546ca67a379c44aa61600c'
STAGE='entry'
C=None
def need(v,label):
 global STAGE
 STAGE=label
 if not v:raise RuntimeError(label)
def enc(v):return json.dumps(v,sort_keys=True,separators=(',',':'),ensure_ascii=True,allow_nan=False).encode()
def sha(v):return hashlib.sha256(v).hexdigest()
def digest(v):return sha(enc(v))
def run(args):
 global STAGE
 STAGE='read-only-'+pathlib.Path(args[0]).name
 p=subprocess.run(args,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=30,cwd=ROOT)
 need(p.returncode==0 and len(p.stdout)<=4*1024**2,'bounded-read-only-command');return p.stdout
def initialize():
 global C
 p=pathlib.Path(__file__).with_name('pr1012-compose-library.py');need(p.is_file()and not p.is_symlink()and sha(p.read_bytes())==LIBRARY_SHA256,'reviewed-compose-library')
 sys.dont_write_bytecode=True;s=importlib.util.spec_from_file_location('pinned_contract_compose',p);C=importlib.util.module_from_spec(s);s.loader.exec_module(C)
def names(values):
 values=sorted(values);need(len(values)<=1024,'bounded-config-key-set')
 return {'keys':[k if re.fullmatch('[A-Za-z0-9_./:-]{1,160}',k)else'[key-sha256:'+sha(k.encode())+']'for k in values[:64]],'omitted':max(0,len(values)-64)}
def differences(a,b):return {k for k in set(a)|set(b)if k not in a or k not in b or a[k]!=b[k]}
def public_env(e):
 allowed={'NODE_ENV':{'production'},'ASPNETCORE_ENVIRONMENT':{'Production'},'NEXT_PUBLIC_BASE_PATH':{'/sprayplan','/sprayplan-test'},'DOTNET_API_URL':{'http://127.0.0.1:5080'},'DATA_PATH':{'/app/data'},'SPRAYPLAN_DB_PATH':{'/app/data/sprayplan.db'},'JWT_ISSUER':{'sprayplan'}}
 result={k:v for k,v in e.items()if k in allowed and v in allowed[k]}
 for k in('DOTNET_VERSION','ASPNET_VERSION'):
  if type(e.get(k))is str and re.fullmatch(r'8\.0\.[0-9]{1,4}',e[k]):result[k]=e[k]
 return result
def shape(config):
 hostname=config.get('Hostname');volumes=config.get('Volumes')or{};cmd=config.get('Cmd');entry=config.get('Entrypoint')
 return {'nonemptyHostname':bool(hostname),'hostnameIsContainerIDPrefix':hostname==CURRENT[:12],'commandPresent':cmd is not None,'commandElements':len(cmd)if type(cmd)is list else None,'entrypointIsReviewedPath':entry==['/app/docker-entrypoint.sh'],'workingDirIsReviewedPath':config.get('WorkingDir')=='/app','volumesAreReviewedPaths':set(volumes)=={'/app/data','/app/server/SprayPlan.Api/storage'},'hasImageHealthcheck':config.get('Healthcheck')is not None}
def summarize(old,new,current):
 a,b=old['Config'],new['Config'];actual=current['Config'];ae,be=C.environment(a.get('Env')or[]),C.environment(b.get('Env')or[]);al,bl=a.get('Labels')or{},b.get('Labels')or{};changed=differences(a,b)
 contract={'passed':False}
 try:C.image_contract(old,new,TARGET);contract['passed']=True
 except RuntimeError as e:
  label=str(e);contract['errorLabel']=label if re.fullmatch('SPRAYPLAN_COMPOSE_[a-z0-9-]{1,150}',label)else'non-public-runtime-error'
 except Exception as e:contract['errorType']=type(e).__name__
 fields={k:{'old':digest(a.get(k)),'new':digest(b.get(k)),'oldPresent':k in a,'newPresent':k in b}for k in sorted(changed)[:64]if re.fullmatch('[A-Za-z0-9_]{1,80}',k)}
 matches={k:a.get(k)==actual.get(k)for k in('Hostname','Domainname','Env','Cmd','Entrypoint','Healthcheck','WorkingDir','User','Labels')}
 return {'contract':contract,'changedConfig':names(changed),'configFieldDigests':fields,'changedEnvironment':names(differences(ae,be)),'environmentOnlyOld':names(set(ae)-set(be)),'environmentOnlyNew':names(set(be)-set(ae)),'changedLabels':names(differences(al,bl)),'oldComposeLabelKeys':names(k for k in al if k.startswith('com.docker.compose.')),'publicEnvironment':{'oldImage':public_env(ae),'newImage':public_env(be)},'oldImageShape':shape(a),'newImageShape':shape(b),'oldImageFieldEqualsLiveRuntime':matches,'oldImageHasParent':bool(old.get('Parent')),'oldImageHasComment':bool(old.get('Comment'))}
def diagnose():
 need(run(['git','rev-parse','refs/remotes/origin/main']).decode().strip()==TARGET,'cached-main-exact')
 remote=run(['git','ls-remote','--exit-code','origin','refs/heads/main']).decode().split();need(remote==[TARGET,'refs/heads/main'],'remote-main-exact')
 current=json.loads(run(['docker','container','inspect',CURRENT]))[0];need(current['Id']==CURRENT and current['Image']==OLD and current['State']['Running'],'fixed-original-running-container')
 labels=current['Config'].get('Labels')or{};need(labels.get('com.docker.compose.project')=='rr-portal'and labels.get('com.docker.compose.service')==SERVICE,'fixed-compose-service')
 old=json.loads(run(['docker','image','inspect',OLD]))[0];new=json.loads(run(['docker','image','inspect',NEW]))[0];need(old['Id']==OLD and new['Id']==NEW,'both-immutable-images-exact')
 return dict(summarize(old,new,current),currentID=CURRENT,oldImage=OLD,newImage=NEW,serviceSignalsSQLOrFileWrites=False,rawConfigEnvironmentCommandPrinted=False)
def main():
 need(EXECUTE is True and sys.argv[1:]==[PHASE]and os.environ.get('RELEASE_MODE')==PHASE and os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_ATTEMPT')=='1','inert-exact-first-contract-diagnosis')
 result={'phase':PHASE,'target':TARGET,'success':False}
 try:initialize();result.update(diagnose());result['success']=True
 except Exception as e:result.update(errorType=type(e).__name__,stage=STAGE)
 result['utc']=datetime.datetime.now(datetime.timezone.utc).isoformat();result['resultSHA256']=digest(result);raw=enc(result);need(len(raw)<60000,'bounded-public-contract-receipt');print(raw.decode(),flush=True);return 0 if result['success']else 1
if __name__=='__main__':sys.exit(main())
