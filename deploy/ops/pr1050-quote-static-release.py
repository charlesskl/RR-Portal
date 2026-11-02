"""INERT Quote frontend-only hot update. No SQL, application restart, maintenance marker, host checkout or data restore.
Fresh source/runtime/phase pins are intentionally empty pending root review.
"""
import copy,decimal,hashlib,importlib.util,io,json,os,pathlib,re,stat,subprocess,sys,tarfile,time,urllib.request,urllib.error
ROOT=pathlib.Path('/opt/rr-portal');ARCHIVE=ROOT/'deploy/backups/pr1050-quote-static-20261102-1'
APP='apps/业务部/内部报价系统';SERVICE='internal-quote';ALIAS='rr-portal-internal-quote:latest'
BASE='38a35585770e0e837229d50f20ee4a9a759037ad';HOST_BASE='f22fbffa1789234fe1c78bf776f4dcb3fe867d0c';HEAD='d90b03c8db023da5fce3c62455a890c007bd6900';TARGET='f167419f2da5874dcb6cdb603a38834ea61074b0';TREE='55e4291039b76f6a8c9a1159d80e432d16f59ba2';APP_TREE='a45a07eea5259b859d565257ca1fe249be4ce0c2'
BRANCH='refs/heads/codex/ops-pr-1050-1051-20261102';PHASE='verify';EXECUTE=False;PREPARED_SHA256='01a96797087d2b056c60de702aaf4fe2a485bf048254efa9a35acf5d8f213696';DEPLOY_SHA256='abba3fa0411ef234039fb9f36abf83f513c8c7203cd34fedeaa5e875acb90596'
CID='0cfa8edaff44bbc74b4443b6dec444c90e2f115833ff9913abf8c9b6c462ef7a';LIVE_IMAGE='sha256:adf5b723ca5f8edae60a0a0f12a3828b8cd488a99eeee6405b61092805620294';BASE_IMAGE='sha256:43a6c0fb79b127a88a42b6eb6d1ee0a6ec9f6c18c2cd17bfaa34ad633d08c5e1';DIRTY_PATH_COUNT=5;DIRTY_SHA256='74b8a9c5caefdc5a220f12cd14972229312beef004e76129d0fb2bb691a0507e';PROFILE_PATH='/opt/rr-portal/deploy/backups/pr1050-1051-preflight-1-20261102/result.private.json';PROFILE_RESULT_SHA256='e313c021adb6e54884bd1c42e2738e39ad227782d0e8f2ed42b91db1e1032003'
ALLOWED_CODE=('frontend/verification-compact.css', 'frontend/verification.html')
CODE=('frontend/verification-compact.css', 'frontend/verification.html')
REVIEWED_FILES={'frontend/verification-compact.css':'be9e679b41f202e4121e02edef53ff64987cab656837ca5b56ddb8c95ed96428','frontend/verification.html':'4f8c06627e2288cc0c7fc0c53aff00019e185a257d5f4fee9675ddea30a54547'}
REVIEWED_PATHS=('frontend/verification-compact.css','frontend/verification.html')
DEPS={'pr1035-quote-preflight.py':'2b2739aa00cad03bfce8472b7416d725364b8d4ed354a5a7e9ca905a47aaffa5'}
BACKEND_SOURCE='0d7599859e5e01e90e4bbcbe71a9bd4a0a77b417'
CAPACITY_BUDGET={'imageGrowthUpperBytes':33554432,'overlayStageUpperBytes':8388608,'evidenceUpperBytes':67108864}
OUT=None;P=None;SERIAL=0;STAGE='entry'
ATTEMPTS={'promotionAttempted':False,'aliasPromotionAttempted':False,'aliasPromotionAcknowledged':False}
CODE_PROBE="const fs=require('fs'),path=require('path'),crypto=require('crypto');\nconst h=b=>crypto.createHash('sha256').update(b).digest('hex');\nfunction tree(root,omit=[]){let a=[],bytes=0;function walk(p,n){let s=fs.lstatSync(p),v={n,uid:s.uid,gid:s.gid,mode:s.mode&4095};\nif(s.isSymbolicLink()){v.type='link';v.target=fs.readlinkSync(p);}else if(s.isDirectory()){v.type='dir';a.push(v);for(let x of fs.readdirSync(p).sort()){if(n===''&&omit.includes(x))continue;walk(path.join(p,x),n?n+'/'+x:x);}return;}else if(s.isFile()){v.type='file';v.size=s.size;bytes+=s.size;v.sha256=h(fs.readFileSync(p));}else throw Error('unsupported-code-kind');a.push(v);if(a.length>100000||bytes>1024**3)throw Error('bounded-code');}\nif(!fs.existsSync(root))return {absent:true};walk(root,'');return {sha256:h(JSON.stringify(a)),entries:a.length,bytes};}\nconsole.log(JSON.stringify({backend:tree('/app/backend',['data','legacy-data','uploads','data.db','data.db-shm','data.db-wal']),nodeModules:tree('/app/node_modules'),package:tree('/app/package.json'),lock:tree('/app/package-lock.json')}));"

def need(v,label):
 global STAGE
 STAGE=label
 if not v:raise RuntimeError(label)

def enc(v):return json.dumps(v,sort_keys=True,separators=(',',':'),ensure_ascii=True,allow_nan=False).encode()

def sha(b):return hashlib.sha256(b).hexdigest()

def pin(v,n=64):return type(v)is str and re.fullmatch('[a-f0-9]{%d}'%n,v)is not None

def private(p,b):
 fd=os.open(p,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
 with os.fdopen(fd,'wb')as f:f.write(b);f.flush();os.fsync(f.fileno())

def run(args,data=None,timeout=180):
 global SERIAL,STAGE
 SERIAL+=1;STAGE='command-'+pathlib.Path(args[0]).name;paths=[OUT/('%03d-%s.private'%(SERIAL,n))for n in('stdout','stderr')];files=[os.fdopen(os.open(p,os.O_CREAT|os.O_EXCL|os.O_WRONLY|os.O_NOFOLLOW,0o600),'wb')for p in paths]
 try:
  try:r=subprocess.run(args,input=data,stdout=files[0],stderr=files[1],timeout=timeout,cwd=ROOT)
  finally:
   for f in files:f.flush();os.fsync(f.fileno())
 finally:
  for f in files:f.close()
 need(r.returncode==0,'single-command-success-no-replay');need(paths[0].stat().st_size<=256*1024**2,'bounded-private-output');return paths[0].read_bytes()

def memory(args):
 # Secret-bearing Docker Config/Env stays in memory, only digests are persisted.
 r=subprocess.run(args,capture_output=True,timeout=60,cwd=ROOT);need(r.returncode==0 and len(r.stdout)<=16*1024**2,'bounded-private-in-memory-inspect');return json.loads(r.stdout)

def load(name):
 p=pathlib.Path(__file__).with_name(name);need(p.is_file()and not p.is_symlink()and sha(p.read_bytes())==DEPS[name],'fixed-reviewed-dependency');s=importlib.util.spec_from_file_location('quote1041_'+name.replace('.','_'),p);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m

def git(*a):return run(['git','-C',str(ROOT),'-c','core.hooksPath=/dev/null',*a])

def image(name):
 rows=memory(['docker','image','inspect',name]);need(len(rows)==1 and re.fullmatch('sha256:[a-f0-9]{64}',rows[0]['Id']),'one-immutable-image');return rows[0]

def runtime():
 ids=run(['docker','ps','-aq','--no-trunc']).decode().split();need(0<len(ids)<1000 and len(ids)==len(set(ids))and all(pin(c)for c in ids),'bounded-all-container-ids');rows=memory(['docker','inspect',*ids]);need({r['Id']for r in rows}==set(ids),'all-existing-containers');value={}
 for r in rows:
  value[r['Id']]={'image':r['Image'],'config':sha(enc(r['Config'])),'hostConfig':sha(enc(r['HostConfig'])),'mounts':sorted(r['Mounts'],key=enc),'pid':r['State']['Pid'],'started':r['State']['StartedAt'],'restarts':r['RestartCount'],'running':r['State']['Running'],'oom':r['State']['OOMKilled'],'health':r['State'].get('Health',{}).get('Status')}
 need(len(value)==46,'all46-original-containers');target=[r for r in rows if(r['Config'].get('Labels')or{}).get('com.docker.compose.project')=='rr-portal'and(r['Config'].get('Labels')or{}).get('com.docker.compose.service')=='internal-quote'];need(len(target)==1 and target[0]['Id']==CID and target[0]['Image']==LIVE_IMAGE,'same-accepted-quote-cid-image');return value

def bind_meta(path):
 a=path.lstat();kind=next((n for f,n in((stat.S_ISREG,'REG'),(stat.S_ISDIR,'DIR'),(stat.S_ISLNK,'LNK'),(stat.S_ISSOCK,'SOCK'),(stat.S_ISFIFO,'FIFO'),(stat.S_ISCHR,'CHR'),(stat.S_ISBLK,'BLK'))if f(a.st_mode)),None);need(kind is not None,'typed-bind-source');v={'type':kind,'uid':a.st_uid,'gid':a.st_gid,'mode':stat.S_IMODE(a.st_mode)}
 if kind=='LNK':v.update(linkSHA256=sha(os.fsencode(os.readlink(path))),resolved=str(path.resolve(strict=True)),target=bind_meta(path.resolve(strict=True)))
 if kind in('CHR','BLK'):v['rdev']=a.st_rdev
 z=path.lstat();need((a.st_dev,a.st_ino,a.st_mode,a.st_uid,a.st_gid,a.st_rdev)==(z.st_dev,z.st_ino,z.st_mode,z.st_uid,z.st_gid,z.st_rdev),'stable-bind-metadata');return v

def protection(records):
 need(git('rev-parse','HEAD').decode().strip()==HOST_BASE,'host-checkout-preserved');shared={n:P.shared_file(n)for n in P.SHARED};need(all(v['sha256']==sha(git('show',HOST_BASE+':'+n))for n,v in shared.items()),'five-shared-files-match-observed-host');dirty=git('diff','--name-only','-z');staged=git('diff','--cached','--name-only','-z');need(not staged,'no-new-staged-changes');names=[n for n in dirty.decode().split('\0')if n];need(type(DIRTY_PATH_COUNT)is int and pin(DIRTY_SHA256)and len(names)==DIRTY_PATH_COUNT and sha(dirty)==DIRTY_SHA256 and not any(n.startswith(APP+'/')for n in names),'fresh-profile-existing-dirty-files-outside-quote');env={str(p.relative_to(ROOT)):P.shared_file(str(p))for p in ROOT.glob('.env*')if p.is_file()};need('.env.cloud.production'in env and len(env)<100,'production-env-files-hash-only');binds={m['Source']:bind_meta(pathlib.Path(m['Source']))for r in records.values()for m in r['mounts']if m.get('Type')=='bind'};auth=P.gateway_auth();return {'host':HOST_BASE,'shared':shared,'dirtySHA256':sha(dirty),'unrelatedDirtyBodiesNotRead':True,'env':env,'auth':auth,'binds':binds}

def source(cid,label,revision):
 d=OUT/label;d.mkdir(mode=0o700);saved=P.OUT;old_target=P.TARGET;old_command=P.command;P.OUT=d;P.TARGET=revision
 def transport(args,limit=8*1024**2,data=None,timeout=90):
  if args[:6]==['docker','exec','--user','0','-i',cid]and args[6:8]==['node','-e']:
   if re.fullmatch('sha256:[a-f0-9]{64}',cid):args=['docker','run','--rm','-i','--read-only','--network','none','--restart','no','--log-driver','none','--entrypoint','node',cid,'-e',args[-1]]
  return run(args,data,timeout)
 try:P.command=transport;v=P.source_inventory(cid);detail=json.loads((d/'source-hashes.private.json').read_bytes());return v,detail['actual']
 finally:P.OUT=saved;P.TARGET=old_target;P.command=old_command

def tree_hash(cid,image_mode=False):
 args=['docker','exec','--user','0',cid,'node','-e',CODE_PROBE]if not image_mode else['docker','run','--rm','--read-only','--network','none','--restart','no','--log-driver','none','--entrypoint','node',cid,'-e',CODE_PROBE];return json.loads(run(args,timeout=240))



def file_hash(path):
 h=hashlib.sha256()
 with path.open('rb')as f:
  for b in iter(lambda:f.read(1024**2),b''):h.update(b)
 return h.hexdigest()

def transport(value):
 raw=enc(value);need(len(raw)<=4*1024**2,'bounded-secret-free-hash-receipt');nib=lambda v:[int(x,16)for x in(format(v,'x')if type(v)is int else v)];parts=[raw[i:i+1024]for i in range(0,len(raw),1024)];digest=nib(sha(raw))
 for i,b in enumerate(parts):print(enc([0,nib(i+1),nib(len(parts)),nib(len(raw)),digest,nib(b.hex())]).decode(),flush=True)
 print(enc([1,nib(len(parts)),nib(len(raw)),digest]).decode(),flush=True)

def http(path,headers=None):
 need(path in('/','/paiji/health','/indo-shipping/api/health','/sprayplan/api/health','/internal-quote/','/internal-quote/health','/internal-quote/api/auth/me')or path in['/internal-quote/'+n.split('/')[-1]for n in CODE if n.startswith('frontend/')],'fixed-local-readonly-http-path');request=urllib.request.Request('http://127.0.0.1'+path,headers=headers or{})
 try:r=urllib.request.urlopen(request,timeout=20)
 except urllib.error.HTTPError as e:r=e
 with r:body=r.read(8*1024**2+1);need(len(body)<=8*1024**2,'bounded-public-http');return {'status':r.status,'sha256':sha(body),'headers':{k:r.headers.get(k)for k in('ETag','Last-Modified')}}

def entry(maintained=False,baseline=None):
 result={p:http(p)['status']for p in('/','/paiji/health','/indo-shipping/api/health','/sprayplan/api/health','/internal-quote/health','/internal-quote/api/auth/me','/internal-quote/')};need(result['/']in(200,401)and all(result[p]==200 for p in('/paiji/health','/indo-shipping/api/health','/sprayplan/api/health')),'portal-other-services-available');need(result['/internal-quote/health']==(503 if maintained else 200)and result['/internal-quote/api/auth/me']==(503 if maintained else 401)and result['/internal-quote/']in((503,)if maintained else(200,401)),'quote-only-maintenance-http-boundary')
 if baseline:need(all(result[p]==baseline[p]for p in('/','/paiji/health','/indo-shipping/api/health','/sprayplan/api/health')),'other-portal-ingress-statuses-unchanged')
 return result

def old_cache_headers():return {n:http('/internal-quote/'+n.split('/')[-1])['headers']for n in CODE if n.startswith('frontend/')}

def public_files(previous=None):
 for n in CODE:
  if not n.startswith('frontend/'):continue
  url='/internal-quote/'+n.split('/')[-1];need(http(url)['status']==200 and http(url)['sha256']==REVIEWED_FILES[n],'all-reviewed-public-static-files-exact-target')
  if previous:
   for key,header in(('ETag','If-None-Match'),('Last-Modified','If-Modified-Since')):
    if previous[n][key]:v=http(url,{header:previous[n][key]});need(v['status']==200 and v['sha256']==REVIEWED_FILES[n],'old-cache-validator-receives-new-bytes')

def setup():
 global P
 P=load('pr1035-quote-preflight.py');P.OUT=OUT;P.command=lambda args,limit=8*1024**2,data=None,timeout=90:run(args,data,timeout)
def safe_path(n):return type(n)is str and bool(n)and pathlib.PurePosixPath(n).as_posix()==n and not n.startswith('/')and not any(x in('..','.')for x in pathlib.PurePosixPath(n).parts)
def ordered_code():
 need(len(CODE)==len(set(CODE))==2 and set(CODE)==set(ALLOWED_CODE),'exact-two-reviewed-css-and-html-paths');return tuple(n for n in ALLOWED_CODE if n in CODE)
def source_check():
 need(all(pin(v,40)for v in(BASE,HEAD,TARGET,TREE,APP_TREE,HOST_BASE,BACKEND_SOURCE))and ordered_code()and set(REVIEWED_FILES)==set(CODE)and all(pin(v)for v in REVIEWED_FILES.values())and set(REVIEWED_PATHS)==set(CODE)and type(BASE_IMAGE)is str and re.fullmatch('sha256:[a-f0-9]{64}',BASE_IMAGE),'final-reviewed-static-source-pins-required')
 git('fetch','--no-write-fetch-head','origin','+refs/heads/main:refs/remotes/origin/main');git('fetch','--no-write-fetch-head','origin','+refs/pull/1050/head:refs/remotes/origin/pr1050-reviewed-head')
 need(git('rev-parse','refs/remotes/origin/pr1050-reviewed-head').decode().strip()==HEAD,'current-pr1050-head-exact-reviewed');need(git('rev-parse','refs/remotes/origin/main').decode().strip()==TARGET and git('rev-parse',TARGET+'^{tree}').decode().strip()==TREE,'exact-reviewed-main-tree');git('merge-base','--is-ancestor',HEAD,TARGET)
 need(git('rev-parse',TARGET+':'+APP).decode().strip()==APP_TREE==git('rev-parse',HEAD+':'+APP).decode().strip(),'reviewed-whole-app-tree');paths=[p[len(APP)+1:]for p in git('diff','--name-only','-z',BASE,TARGET,'--',APP).decode().split('\0')if p];need(set(paths)==set(CODE),'only-two-reviewed-frontend-production-paths')
 need(git('rev-parse',BASE+':'+APP+'/backend').strip()==git('rev-parse',TARGET+':'+APP+'/backend').strip()==git('rev-parse',BACKEND_SOURCE+':'+APP+'/backend').strip()and all(git('show',BASE+':'+APP+'/'+n)==git('show',TARGET+':'+APP+'/'+n)for n in('Dockerfile','package.json','package-lock.json')),'all-backend-startup-and-dependencies-unchanged')
 body={n:git('show',TARGET+':'+APP+'/'+n)for n in CODE};need(all(sha(v)==REVIEWED_FILES[n]for n,v in body.items()),'reviewed-static-bodies-exact-reviewed-shas');return body

def profile_check(before):
 p=pathlib.Path(PROFILE_PATH);need(p==ROOT/'deploy/backups/pr1050-1051-preflight-1-20261102/result.private.json'and pin(PROFILE_RESULT_SHA256)and p.is_file()and not p.is_symlink()and file_hash(p)==PROFILE_RESULT_SHA256,'bound-fresh-readonly-profile-file');v=json.loads(p.read_bytes());core=dict(v);inner=core.pop('resultSHA256');need(sha(enc(core))==inner and v['success']is True and v['readOnly']is True and v['allRuntimeUnchanged']is True and v['sourceBaseline']==BASE,'successful-self-sealed-fresh-readonly-profile');q=v['targets'][SERVICE];need(q['id']==CID and q['canonicalImage']['id']==BASE_IMAGE and q['source']['differences']==['package-lock.json'],'fresh-profile-same-quote-source-and-accepted-alias')
 observed=v['allRuntime'];need(set(before)==set(observed)and len(before)==46 and all(observed[c]['image']==before[c]['image']and observed[c]['configSHA256']==before[c]['config']and observed[c]['hostConfigSHA256']==before[c]['hostConfig']and observed[c]['mountsSHA256']==sha(enc(before[c]['mounts']))and all(observed[c][k]==before[c][k]for k in('pid','started','restarts','running','oom','health'))for c in before),'fresh-profile-all46-runtime-exact')
 protected=protection(before);need(v['shared']==protected['shared']and v['env']==protected['env']and v['gatewayAuth']==protected['auth']and v['unstaged']['trackedPathCount']==DIRTY_PATH_COUNT and v['unstaged']['rawPathInventorySHA256']==DIRTY_SHA256 and v['staged']['trackedPathCount']==0,'fresh-profile-host-auth-and-environment-preserved');return inner
def free_check():
 need(CAPACITY_BUDGET=={'imageGrowthUpperBytes':33554432,'overlayStageUpperBytes':8388608,'evidenceUpperBytes':67108864},'explicit-reviewed-two-file-derivative-budget');root=memory(['docker','info','--format','{{json .DockerRootDir}}']);need(type(root)is str and pathlib.Path(root).is_absolute(),'actual-docker-root');s=os.statvfs(root);v={'available':s.f_bavail*s.f_frsize,'free':s.f_bfree*s.f_frsize,'budgetBytes':sum(CAPACITY_BUDGET.values())};need(v['available']>=1024**3+v['budgetBytes']and v['free']>=8*1024**3+v['budgetBytes'],'preserve-one-gib-ordinary-eight-gib-physical-plus-bounded-two-file-growth');return v

def copied_file(cid,relative):
 raw=run(['docker','cp',cid+':/app/'+relative,'-']);t=tarfile.open(fileobj=io.BytesIO(raw));rows=t.getmembers();need(len(rows)==1 and rows[0].isfile()and not rows[0].issym()and not rows[0].islnk(),'one-regular-source-tar-member');m=rows[0];b=t.extractfile(m).read();need(len(b)==m.size<=8*1024**2,'bounded-reviewed-static-file-source');ns=decimal.Decimal(str(m.pax_headers.get('mtime',m.mtime)))*10**9;need(ns==int(ns),'exact-source-nanosecond-mtime');return b,{'sha256':sha(b),'bytes':len(b),'uid':m.uid,'gid':m.gid,'mode':m.mode,'mtimeNs':str(int(ns))}
def bundle(bodies,metadata):
 need(set(bodies)==set(CODE)==set(metadata),'exact-reviewed-static-file-bundle');buffer=io.BytesIO()
 with tarfile.open(fileobj=buffer,mode='w',format=tarfile.PAX_FORMAT)as t:
  for n in CODE:
   row=metadata[n];need(sha(bodies[n])==row['sha256']and len(bodies[n])==row['bytes'],'exact-bundle-body');m=tarfile.TarInfo(n.split('/')[-1]);m.uid=row['uid'];m.gid=row['gid'];m.mode=row['mode'];m.size=len(bodies[n]);m.mtime=int(row['mtimeNs'])//10**9;m.pax_headers={'mtime':format(decimal.Decimal(row['mtimeNs'])/10**9,'f')};t.addfile(m,io.BytesIO(bodies[n]))
 return buffer.getvalue()
def metadata_readback(cid,expected,prefix='/app/frontend'):
 for n in CODE:
  _,v=copied_file(cid,prefix.removeprefix('/app/')+'/'+n.split('/')[-1]);need(v==expected[n],'all-reviewed-source-body-owner-mode-mtime-readback')
def scratch(candidate,metadata):
 cid=run(['docker','create','--network','none','--restart','no','--label','io.rr-portal.pr1050-scratch='+TARGET,'--entrypoint','/bin/true',candidate]).decode().strip();need(pin(cid),'owned-never-started-scratch-id')
 try:
  r=memory(['docker','inspect',cid])[0];need(r['Image']==candidate and r['State']['Pid']==0 and not r['State']['Running']and r['State']['StartedAt'].startswith('0001-')and not r['Mounts']and r['HostConfig']['NetworkMode']=='none','scratch-owned-never-started-no-data-mounts');metadata_readback(cid,metadata)
 finally:
  r=memory(['docker','inspect',cid])[0];need(r['Image']==candidate and r['State']['Pid']==0 and not r['State']['Running']and(r['Config'].get('Labels')or{}).get('io.rr-portal.pr1050-scratch')==TARGET,'remove-only-owned-never-started-scratch');run(['docker','rm',cid])

def sealed(phase,digest):
 d=ARCHIVE/phase;need(pin(digest)and d.is_dir()and not d.is_symlink()and file_hash(d/'manifest.json')==digest,'sealed-prior-phase-manifest');mf=json.loads((d/'manifest.json').read_bytes());items=list(d.rglob('*'));need(all(not p.is_symlink()and(p.is_file()or p.is_dir())for p in items),'regular-private-prior-evidence');files={p.relative_to(d).as_posix()for p in items if p.is_file()and p!=d/'manifest.json'};need(files==set(mf)and all(safe_path(n)and file_hash(d/n)==h for n,h in mf.items()),'every-prior-private-artifact-byte-sealed');v=json.loads((d/'result.private.json').read_bytes());copyv=dict(v);self_hash=copyv.pop('resultSHA256');need(sha(enc(copyv))==self_hash and v['success']is True and(v['service'],v['phase'],v['base'],v['head'],v['target'],v['tree'],v['appTree'],v['hostBase'])==(SERVICE,phase,BASE,HEAD,TARGET,TREE,APP_TREE,HOST_BASE),'successful-source-bound-self-hashed-prior-phase');return v,d

def prepare():
 bodies=source_check();entry();before=runtime();profile=profile_check(before);need(before[CID]['running']and before[CID]['health']=='healthy'and image(ALIAS)['Id']==BASE_IMAGE,'healthy-accepted-live-and-durable-baseline');protected=protection(before);private(OUT/'runtime-before.private.json',enc(before));private(OUT/'protection.private.json',enc(protected));space=free_check();old_summary,old=source(CID,'old-live-source',BASE);base=image(BASE_IMAGE);need(not base['Config'].get('Volumes')and not base['Config'].get('OnBuild')and(base['Config'].get('Labels')or{}).get('io.rr-portal.backend-source')==BACKEND_SOURCE,'known-base-with-no-volumes-or-onbuild-before-any-container-run');base_summary,base_source=source(BASE_IMAGE,'old-durable-source',BASE);need(old_summary['differentFiles']==base_summary['differentFiles']==['package-lock.json']and old==base_source,'all-current-source-identical-to-known-accepted-durable');signature=tree_hash(CID);need(signature==tree_hash(BASE_IMAGE,True),'whole-backend-and-dependencies-identical-to-accepted-durable');base=image(BASE_IMAGE);need(not base['Config'].get('Volumes')and not base['Config'].get('OnBuild')and(base['Config'].get('Labels')or{}).get('io.rr-portal.backend-source')==BACKEND_SOURCE,'accepted-base-preserves-known-backend-source-no-anonymous-volumes-or-onbuild');context=OUT/'context';context.mkdir(mode=0o700);metadata={};old_metadata={};old_bodies={};recipe=[];alias='rrportal-quote-pr1050-base:'+BASE_IMAGE.split(':')[1];probe=subprocess.run(['docker','image','inspect',alias],capture_output=True,timeout=30);need(probe.returncode!=0 or json.loads(probe.stdout)[0]['Id']==BASE_IMAGE,'own-base-alias-never-reassigned');need(probe.returncode==0 or b'No such image'in probe.stderr or b'No such object'in probe.stderr,'only-known-own-base-tag-absence')
 if probe.returncode:run(['docker','tag',BASE_IMAGE,alias])
 recipe.append('FROM '+alias)
 for i,n in enumerate(CODE):
  b,row=copied_file(CID,n);need(all(row[k]==old[n][k]for k in('sha256','bytes','uid','gid','mode')),'original-static-file-body-and-metadata-authority');old_bodies[n]=b;old_metadata[n]=row;second=max(int(time.time())+2,int(row['mtimeNs'])//10**9+2);metadata[n]=dict(row,sha256=sha(bodies[n]),bytes=len(bodies[n]),mtimeNs=str(second*10**9));p=context/('code'+str(i));private(p,bodies[n]);p.chmod(row['mode']);os.utime(p,ns=(second*10**9,second*10**9));recipe.append('COPY --chown=%d:%d %s /app/%s'%(row['uid'],row['gid'],p.name,n))
 labels={'org.opencontainers.image.revision':TARGET,'io.rr-portal.quote-app-tree':APP_TREE,'io.rr-portal.frontend-app-tree':APP_TREE,'io.rr-portal.backend-source':BACKEND_SOURCE};recipe.append('LABEL '+' '.join(k+'="'+v+'"'for k,v in labels.items()));private(context/'Dockerfile',('\n'.join(recipe)+'\n').encode());private(OUT/'rollback-static.tar',bundle(old_bodies,old_metadata));private(OUT/'patch-static.tar',bundle(bodies,metadata));tag='rr-portal-internal-quote:pr1050-'+TARGET[:12];run(['docker','build','--network=none','--pull=false','-t',tag,str(context)],timeout=600);candidate=image(tag);a=copy.deepcopy(base['Config']);b=copy.deepcopy(candidate['Config']);a.pop('Image',None);b.pop('Image',None);a['Labels']=dict(a.get('Labels')or{},**labels);need(a==b and candidate['Os']==base['Os']and candidate['Architecture']==base['Architecture']and candidate['RootFS']['Layers'][:len(base['RootFS']['Layers'])]==base['RootFS']['Layers'],'thin-static-image-preserves-entire-runtime-config-user-and-base-layers');new_summary,new=source(candidate['Id'],'candidate-source',TARGET);need(new_summary['differentFiles']==['package-lock.json']and tree_hash(candidate['Id'],True)==signature,'candidate-all-target-source-and-unchanged-backend-dependencies');scratch(candidate['Id'],metadata);need(runtime()==before and protection(before)==protected and image(ALIAS)['Id']==BASE_IMAGE,'all-live-runtimes-config-env-auth-and-canonical-untouched');return {'candidate':candidate['Id'],'runtime':before,'protected':protected,'oldSource':old,'source':new,'oldMetadata':old_metadata,'metadata':metadata,'signature':signature,'profileResultSHA256':profile,'spaceBefore':space,'spaceAfter':free_check(),'productionLifecycleCalls':0,'sqlStatements':0,'candidateWasNeverApplicationStarted':True}

STAGE_SCRIPT=r"""const fs=require('fs'),crypto=require('crypto');const x=JSON.parse(fs.readFileSync(0,'utf8'));const need=v=>{if(!v)throw Error('static-stage-guard')};need(/^\/app\/\.pr1050-static-[a-f0-9]{40}$/.test(x.stage));const hash=b=>crypto.createHash('sha256').update(b).digest('hex');const allowed=['verification-compact.css','verification.html'];const names=x.order;need(Array.isArray(names)&&names.length===2&&new Set(names).size===names.length&&names.every(n=>allowed.includes(n))&&JSON.stringify(names)===JSON.stringify(allowed.filter(n=>names.includes(n)))&&JSON.stringify(Object.keys(x.old).sort())===JSON.stringify(names.map(n=>'frontend/'+n).sort())&&JSON.stringify(Object.keys(x.next).sort())===JSON.stringify(names.map(n=>'frontend/'+n).sort()));const meta=(p,v)=>{const s=fs.lstatSync(p,{bigint:true});need(s.isFile()&&!s.isSymbolicLink()&&String(s.uid)===String(v.uid)&&String(s.gid)===String(v.gid)&&Number(s.mode&4095n)===v.mode&&String(s.mtimeNs)===v.mtimeNs&&Number(s.size)===v.bytes&&hash(fs.readFileSync(p))===v.sha256)};need(fs.lstatSync('/app').isDirectory()&&!fs.lstatSync('/app').isSymbolicLink());need(fs.lstatSync('/app/frontend').isDirectory()&&!fs.lstatSync('/app/frontend').isSymbolicLink());if(x.action==='mkdir'){need(!fs.existsSync(x.stage));fs.mkdirSync(x.stage,{mode:0o700});fs.mkdirSync(x.stage+'/new',{mode:0o700});fs.mkdirSync(x.stage+'/old',{mode:0o700});}else{need(fs.lstatSync(x.stage).isDirectory()&&!fs.lstatSync(x.stage).isSymbolicLink()&&fs.lstatSync(x.stage).uid===0&&(fs.lstatSync(x.stage).mode&4095)===0o700);for(const part of ['new','old'])need(fs.lstatSync(x.stage+'/'+part).isDirectory()&&!fs.lstatSync(x.stage+'/'+part).isSymbolicLink()&&fs.lstatSync(x.stage+'/'+part).uid===0&&(fs.lstatSync(x.stage+'/'+part).mode&4095)===0o700);for(const n of names){const key='frontend/'+n;meta(x.stage+'/new/'+n,x.next[key]);meta(x.stage+'/old/'+n,x.old[key]);meta('/app/frontend/'+n,x.old[key]);}if(x.action==='promote'){for(const n of names){const key='frontend/'+n;meta('/app/frontend/'+n,x.old[key]);meta(x.stage+'/new/'+n,x.next[key]);fs.renameSync(x.stage+'/new/'+n,'/app/frontend/'+n);meta('/app/frontend/'+n,x.next[key]);}}else need(x.action==='check');}console.log(JSON.stringify({action:x.action,files:names.length}));"""
def stage_call(stage,action,p):return json.loads(run(['docker','exec','--user','0','-i',CID,'node','-e',STAGE_SCRIPT],enc({'stage':stage,'action':action,'old':p['oldMetadata'],'next':p['metadata'],'order':[n.split('/')[-1]for n in ordered_code()]})))
def deploy():
 value,d=sealed('prepare',PREPARED_SHA256);p=value['details'];source_check();before=runtime();protected=protection(before);need(before==p['runtime']and protected==p['protected']and image(ALIAS)['Id']==BASE_IMAGE,'same-prepared-runtime-config-and-canonical');s,old=source(CID,'preswitch-source',BASE);need(s['differentFiles']==['package-lock.json']and old==p['oldSource']and tree_hash(CID)==p['signature'],'all-current-source-and-backend-dependencies-still-baseline');free_check();ingress=entry();headers=old_cache_headers();private(OUT/'original-cache-headers.private.json',enc(headers));stage='/app/.pr1050-static-'+TARGET
 stage_call(stage,'mkdir',p);run(['docker','cp','-',CID+':'+stage+'/old'],(d/'rollback-static.tar').read_bytes());run(['docker','cp','-',CID+':'+stage+'/new'],(d/'patch-static.tar').read_bytes());stage_call(stage,'check',p)
 need(runtime()==before and protection(before)==protected and image(ALIAS)['Id']==BASE_IMAGE,'all-preswitch-runtime-source-alias-cas');private(OUT/'promotion-intent.private.json',enc({'container':CID,'stage':stage,'order':list(ordered_code()),'automaticReplay':False,'compatibleCSSBeforeHTML':True}));ATTEMPTS['promotionAttempted']=True;stage_call(stage,'promote',p)
 s,actual=source(CID,'live-upgraded-source',TARGET);need(s['differentFiles']==['package-lock.json']and actual==p['source']and tree_hash(CID)==p['signature'],'whole-tracked-frontend-target-and-backend-dependencies-unchanged');metadata_readback(CID,p['metadata']);need(runtime()==before and protection(before)==protected and image(ALIAS)['Id']==BASE_IMAGE,'same-pid-all46-config-auth-and-old-alias');private(OUT/'alias-promotion-intent.private.json',enc({'from':BASE_IMAGE,'to':p['candidate'],'alias':ALIAS,'automaticReplay':False}));ATTEMPTS['aliasPromotionAttempted']=True;run(['docker','tag',p['candidate'],ALIAS]);ATTEMPTS['aliasPromotionAcknowledged']=True;need(image(ALIAS)['Id']==p['candidate']and runtime()==before,'durable-alias-promoted-once-without-restart');entry(False,ingress);public_files(headers);return {'candidate':p['candidate'],'runtime':before,'protected':protected,'signature':p['signature'],'sameContainer':CID,'samePID':before[CID]['pid'],'sameStartedAt':before[CID]['started'],'durableImage':p['candidate'],'backendSourceVersion':BACKEND_SOURCE,'frontendSourceVersion':TARGET,'serviceMarkerCreated':False,'sqlStatements':0,'applicationStopStartCalls':0,'businessDataComparedAcrossActiveUserWindow':False,'ownStaticRollbackArchiveRetained':True}

def verify():
 source_check();value,_=sealed('deploy',DEPLOY_SHA256);p=value['details'];need(runtime()==p['runtime']and protection(p['runtime'])==p['protected']and image(ALIAS)['Id']==p['candidate'],'same-pid-runtime-config-auth-and-durable-alias-still-deployed');s,_=source(CID,'verify-source',TARGET);need(s['differentFiles']==['package-lock.json']and tree_hash(CID)==p['signature'],'complete-target-source-and-backend-dependency-invariant');need(not(ROOT/'deploy/maintenance/services/internal-quote').exists(),'no-other-quote-maintenance-active');entry();public_files();return {'sameContainer':CID,'samePID':p['samePID'],'durableImage':p['candidate'],'backendSourceVersion':BACKEND_SOURCE,'frontendSourceVersion':TARGET,'sqlStatements':0,'applicationStopStartCalls':0,'businessDataComparedAcrossActiveUserWindow':False}

def ensure_archive():
 need(ARCHIVE.parent.is_dir()and not any(p.is_symlink()for p in(ARCHIVE.parent,*ARCHIVE.parent.parents))and not ARCHIVE.is_symlink(),'real-private-archive-path')
 if not ARCHIVE.exists():ARCHIVE.mkdir(mode=0o700)
 a=ARCHIVE.lstat();need(stat.S_ISDIR(a.st_mode)and a.st_uid==a.st_gid==0 and stat.S_IMODE(a.st_mode)==0o700,'existing-owned-root-private-archive-directory')

def failure_readback():
 value,_=sealed('prepare',PREPARED_SHA256);p=value['details'];files={n:copied_file(CID,n)[1]for n in CODE};classes={n:('old'if files[n]==p['oldMetadata'][n]else'new'if files[n]==p['metadata'][n]else'unknown')for n in CODE};alias=image(ALIAS)['Id'];states=set(classes.values())
 disposition='unknown'
 if states=={'old'}and alias==BASE_IMAGE:disposition='not-published'
 elif states=={'new'}and alias==p['candidate']:disposition='published-needs-verification'
 elif states=={'new'}and alias==BASE_IMAGE:disposition='files-published-alias-old'
 elif states=={'old','new'}and alias in(BASE_IMAGE,p['candidate']):disposition='partially-published'
 return {'disposition':disposition,'files':files,'fileStates':classes,'alias':alias,'runtimeUnchanged':runtime()==p['runtime'],'readOnly':True,'automaticRetryOrRollback':False}

def main():
 global OUT
 need(EXECUTE is True and PHASE in('prepare','deploy','verify')and sys.argv[1:]==[PHASE]and os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_MODE')==PHASE and os.environ.get('RELEASE_ATTEMPT')=='1','explicit-one-shot-static-phase');os.umask(0o077);ensure_archive();OUT=ARCHIVE/PHASE;need(not OUT.exists()and not OUT.is_symlink(),'fresh-phase-no-replay');OUT.mkdir(mode=0o700);v={'service':SERVICE,'mode':PHASE,'phase':PHASE,'base':BASE,'head':HEAD,'target':TARGET,'tree':TREE,'appTree':APP_TREE,'hostBase':HOST_BASE,'success':False,'resultPath':str(OUT/'result.private.json'),'applicationStopStartCalls':0,'sqlStatements':0,'hostCheckoutPerformed':False,'automaticMutationRetry':False}
 try:setup();v['details']={'prepare':prepare,'deploy':deploy,'verify':verify}[PHASE]();v['success']=True
 except Exception as e:
  v.update(errorType=type(e).__name__,stage=STAGE,mutationAttemptState=dict(ATTEMPTS))
  if PHASE=='deploy':
   try:v['readOnlyFailureState']=failure_readback()
   except Exception as readback_error:v['readOnlyFailureState']={'disposition':'unknown','errorType':type(readback_error).__name__,'readOnly':True,'automaticRetryOrRollback':False}
 v['resultSHA256']=sha(enc(v));private(OUT/'result.private.json',enc(v));items=list(OUT.rglob('*'));need(all(not p.is_symlink()and(p.is_file()or p.is_dir())for p in items),'regular-private-phase-artifacts');mf={p.relative_to(OUT).as_posix():file_hash(p)for p in items if p.is_file()};private(OUT/'manifest.json',enc(mf));digest=sha(enc(mf));transport({'result':v,'manifestSHA256':digest,'preparedSHA256'if PHASE=='prepare'else'deployEvidenceSHA256':digest});return 0 if v['success']else 1
if __name__=='__main__':sys.exit(main())
