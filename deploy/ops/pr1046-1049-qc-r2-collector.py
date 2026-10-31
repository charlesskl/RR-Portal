"""INERT fixed R2 failure collector. No prepare replay/build/cleanup/tag or lifecycle.
Only original failed archive hashes, bounded strict stream classifications and pure
read-only runtime/source/gateway/protection probes; no private bodies or business locals.
"""
import ast,contextlib,hashlib,importlib.util,io,json,os,pathlib,re,stat,subprocess,sys
ROOT=pathlib.Path('/opt/rr-portal');OUT=ROOT/'deploy/backups/pr1046-1049-qc-r2-collect-1'
FAILED=ROOT/'deploy/backups/pr1046-1049-qc-20261031-2/prepare'
FAILED_MANIFEST_SHA256='d5817fb052c9d0a4417bf0fcac0eaec8f90cfec8155c0f0005a629d6b3b4de87'
FAILED_RESULT_SHA256='6a20bbb81d9310073dd8915efa3606d991a1964ae608843f0968826ed8e31c5f'
PROFILE=ROOT/'deploy/backups/pr1046-1049-preflight-2/result.private.json';PROFILE_SHA256='5d03099f38dfebacaa8138d5fb0bd2166f5399241b97f9cac5d38012a5b73cf7'
CID='712466bf56a8537eb914ac8c835f0315dee1d33ad4faae3665af71ed803988f9';CANONICAL='sha256:65c56b6f8f59b8df5420912057023172b3fdd402297163b31342ee04561ac2f8';ALIAS='rr-portal-qc:latest';TARGET='ab44450518d6943af0cf7b4f1a72324d3f5076f8'
RELEASE_NAME='pr1046-1049-qc-release-r2.py';RELEASE_SHA256='b57f9ab3e52f8b9f0e934353a1adfa2b7713e07a6e2e2dee71bb78ca9fee261c';BRANCH='refs/heads/codex/ops-pr-1046-1049-20261031';EXECUTE=True
P=None;O=None;L=None;R=None;PROFILE_VALUE=None;PUBLIC_SOURCE_FILES=();SERIAL=0;STAGE='entry'
DEPS={'pr1035-quote-preflight.py':'2b2739aa00cad03bfce8472b7416d725364b8d4ed354a5a7e9ca905a47aaffa5','release-data-ops-library.py':'ff9138a1d5bfed1b10077112da6ebcda2d65240f583e2d0e12ce1325cfbaafd5','release-data-library.py':'d63168fd3057f4f2aba2d93f9fab31d2d65c6dd0f3234877d71fcff1e04e62b9'}
SOURCE_PROBE="const fs=require('fs'),path=require('path'),crypto=require('crypto'),items=JSON.parse(fs.readFileSync(0,'utf8'));let out={};if(!Array.isArray(items)||items.length>2000)throw Error('scope');for(const n of items){if(!/^[A-Za-z0-9_./-]+$/.test(n)||n.split('/').some(x=>x==='..'||x===''||x==='data'||x==='uploads'||x==='legacy-data')||/(^|\\/)\\.env(\\.|$)/.test(n))throw Error('path');const p='/app/'+n;for(let d=path.dirname(p);d!=='/';d=path.dirname(d))if(fs.lstatSync(d).isSymbolicLink())throw Error('parentlink');if(!fs.existsSync(p)){out[n]={absent:true};continue;}const a=fs.lstatSync(p);if(!a.isFile()||a.isSymbolicLink()||a.size>128*1024**2)throw Error('file');const fd=fs.openSync(p,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);try{const b=fs.readFileSync(fd),z=fs.fstatSync(fd);if(b.length!==a.size||a.ino!==z.ino||a.mtimeMs!==z.mtimeMs||a.ctimeMs!==z.ctimeMs)throw Error('changed');out[n]={sha256:crypto.createHash('sha256').update(b).digest('hex'),gitBlobSHA1:crypto.createHash('sha1').update('blob '+b.length+'\\0').update(b).digest('hex'),bytes:b.length,uid:a.uid,gid:a.gid,mode:a.mode&4095};}finally{fs.closeSync(fd);}}console.log(JSON.stringify(out));"
def need(v,label):
 global STAGE
 STAGE=label
 if not v:raise RuntimeError(label)

def enc(v):return json.dumps(v,sort_keys=True,separators=(',',':'),ensure_ascii=True,allow_nan=False).encode()

def sha(b):return hashlib.sha256(b).hexdigest()

def pin(v,n=64):return type(v)is str and re.fullmatch('[a-f0-9]{%d}'%n,v)is not None

def memory(args):
 # Secret-bearing Docker Config/Env stays in memory, only digests are persisted.
 r=subprocess.run(args,capture_output=True,timeout=60,cwd=ROOT);need(r.returncode==0 and len(r.stdout)<=16*1024**2,'bounded-private-in-memory-inspect');return json.loads(r.stdout)

def file_hash(path):
 h=hashlib.sha256()
 with path.open('rb')as f:
  for b in iter(lambda:f.read(1024**2),b''):h.update(b)
 return h.hexdigest()

def transport(value):
 raw=enc(value);need(len(raw)<=4*1024**2,'bounded-secret-free-hash-receipt');nib=lambda v:[int(x,16)for x in(format(v,'x')if type(v)is int else v)];parts=[raw[i:i+1024]for i in range(0,len(raw),1024)];digest=nib(sha(raw))
 for i,b in enumerate(parts):print(enc([0,nib(i+1),nib(len(parts)),nib(len(raw)),digest,nib(b.hex())]).decode(),flush=True)
 print(enc([1,nib(len(parts)),nib(len(raw)),digest]).decode(),flush=True)

def failure_context(error):
 # Pure in-memory reporting only: no formatted traceback, source lines, paths,
 # locals, exception strings, subprocess argv or secret-bearing objects.
 try:
  pure=lambda v:v if type(v)is str and re.fullmatch(r'[A-Za-z][A-Za-z0-9_.:-]{0,119}',v)else None
  stages={'root':pure(STAGE),'P':pure(getattr(P,'STAGE',None)),'O':pure(getattr(O,'STAGE',None)),'L':pure(getattr(L,'FAILED',None))};frames=[];tb=error.__traceback__
  while tb is not None and len(frames)<16:
   name=tb.tb_frame.f_code.co_name
   if re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]{0,79}|<lambda>|<module>',name):frames.append({'function':name,'line':tb.tb_lineno})
   tb=tb.tb_next
  label=None
  if frames and frames[-1]['function']in('need','require')and len(error.args)==1:label=pure(error.args[0])
  return {'dependencyStages':stages,'pureFailureLabel':label,'traceFunctionsAndLines':frames,'businessLocalsOrSourceLinesReturned':False,'rawExceptionMessageReturned':False}
 except Exception:return {'errorContextUnavailable':True,'rawExceptionMessageReturned':False}

def private(name,value):
 fd=os.open(OUT/name,os.O_CREAT|os.O_EXCL|os.O_WRONLY|os.O_NOFOLLOW,0o600)
 with os.fdopen(fd,'wb')as f:f.write(enc(value));f.flush();os.fsync(f.fileno())

def run(args,data=None,timeout=120):
 global SERIAL
 SERIAL+=1;a=OUT/('%03d-stdout.private'%SERIAL);b=OUT/('%03d-stderr.private'%SERIAL)
 with contextlib.ExitStack()as stack:
  x=stack.enter_context(a.open('xb'));y=stack.enter_context(b.open('xb'))
  try:r=subprocess.run(args,input=data,stdout=x,stderr=y,cwd=ROOT,timeout=timeout)
  finally:
   for f in(x,y):f.flush();os.fsync(f.fileno())
 need(r.returncode==0 and a.stat().st_size<=16*1024**2 and b.stat().st_size<=1024**2,'bounded-fixed-readonly-collector-command');return a.read_bytes()

def git(*a):return run(['git','-C',str(ROOT),'-c','core.hooksPath=/dev/null',*a])

def load(name,digest):
 path=pathlib.Path(__file__).with_name(name);need(path.is_file()and not path.is_symlink()and file_hash(path)==digest,'pinned-readonly-probe-module');s=importlib.util.spec_from_file_location('collector_'+name.replace('.','_'),path);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m

def streams_and_seal(report):
 need(FAILED.is_dir()and not any(p.is_symlink()for p in(FAILED,*FAILED.parents)),'fixed-failed-r2-real-directory');files=[p for p in FAILED.rglob('*')if p.is_file()and p.name!='manifest.json'];need(len(files)<=10000 and all(not p.is_symlink()for p in FAILED.rglob('*')),'bounded-regular-r2-private-evidence');meta=[{'path':str(p.relative_to(FAILED)),'bytes':p.stat().st_size}for p in files];report['streamsExceeding256MiB']=[r for r in meta if r['bytes']>256*1024**2];report['maximumPrivateOutputBytes']=max((r['bytes']for r in meta),default=0);need(file_hash(FAILED/'manifest.json')==FAILED_MANIFEST_SHA256,'exact-failed-r2-manifest');mf=json.loads((FAILED/'manifest.json').read_bytes());need(set(mf)=={r['path']for r in meta},'complete-failed-r2-file-set')
 for row in meta:
  p=FAILED/row['path'];need(row['bytes']<=2*1024**3,'bounded-existing-failed-stream-hash-only');row['sha256']=file_hash(p);need(row['sha256']==mf[row['path']],'failed-r2-file-bytes-match-sealed-manifest')
 v=json.loads((FAILED/'result.private.json').read_bytes());inner=dict(v);need(inner.pop('resultSHA256')==FAILED_RESULT_SHA256==sha(enc(inner))and v['success']is False and v['phase']=='prepare','original-r2-remains-failed-self-sealed-result');report['failedReceipt']={k:v.get(k)for k in('success','phase','stage','dependencyStage','errorType')};report['allFailedFileMetadata']=meta;streams=sorted((r for r in meta if re.fullmatch(r'[0-9]{3,6}-(stdout|stderr)\.private',r['path'])),key=lambda r:(int(r['path'].split('-')[0]),r['path']));report['lastPrivateStreamClassifications']=[dict(row,classification=classify(FAILED/row['path']))for row in streams[-8:]];return mf

def classify(path):
 size=path.stat().st_size
 with path.open('rb')as f:
  head=f.read(512);f.seek(max(0,size-65536));tail=f.read(65536)
 if not size:return {'kind':'empty'}
 if len(head)>=262 and head[257:262]==b'ustar':return {'kind':'tar-magic','rawBodiesReturned':False}
 counts={k:int(n)for k,n in re.findall(r'^# (tests|pass|fail|cancelled|skipped|todo) ([0-9]{1,9})$',tail.decode('utf8','replace'),re.M)}
 if counts:return {'kind':'strict-tap-counts','counts':counts}
 if size<=1024 and re.fullmatch(rb'(sha256:)?[a-f0-9]{64}\s*',head):return {'kind':'strict-hex-image-or-object-id','id':head.decode().strip()}
 if size<=65536:
  try:v=json.loads(path.read_bytes())
  except(ValueError,UnicodeError):v=None
  if type(v)is dict and set(v)=={'app','package'}and all(type(r)is dict and set(r)=={'bytes','entries','sha256'}for r in v.values()):return {'kind':'known-code-signature-json','knownKeys':['app','package']}
  if type(v)is dict and v and set(v)<=set(PUBLIC_SOURCE_FILES):return {'kind':'known-public-source-json','knownPublicSourceCount':len(v)}
  if type(v)in(dict,list):return {'kind':'other-json-no-keys-or-values-returned'}
 return {'kind':'other-text-or-binary-no-body-returned'}

def original_runtime():
 ids=run(['docker','ps','-aq','--no-trunc']).decode().split();need(46<=len(ids)<=64 and all(pin(v)for v in ids),'bounded-current-container-inventory');rows=memory(['docker','inspect',*ids]);values={};extra=[]
 for r in rows:
  row={'image':r['Image'],'configSHA256':sha(enc(r['Config'])),'hostConfigSHA256':sha(enc(r['HostConfig'])),'envSHA256':sha(enc(sorted(r['Config'].get('Env')or[]))),'mountsSHA256':sha(enc(sorted(r['Mounts'],key=enc))),'pid':r['State']['Pid'],'started':r['State']['StartedAt'],'restarts':r['RestartCount'],'running':r['State']['Running'],'oom':r['State']['OOMKilled'],'health':r['State'].get('Health',{}).get('Status')};values[r['Id']]=row
  if r['Id']not in PROFILE_VALUE['allRuntime']:
   labels=r['Config'].get('Labels')or{};extra.append({'id':r['Id'],'image':r['Image'],'running':r['State']['Running'],'pid':r['State']['Pid'],'ownedScratchLabel':labels.get('io.rr-portal.qc1046-1049-scratch')==TARGET})
 need(set(PROFILE_VALUE['allRuntime'])<=set(values)and{n:values[n]for n in PROFILE_VALUE['allRuntime']}==PROFILE_VALUE['allRuntime'],'all-original46-runtime-config-env-pids-still-exact');return values,extra

def optional_images():
 result=[]
 for name in('rr-portal-qc:pr1046-1049-'+TARGET[:12],'rrportal-qc-1046-1049-base:'+CANONICAL.split(':')[1]):
  p=subprocess.run(['docker','image','inspect',name],capture_output=True,timeout=30,cwd=ROOT)
  if p.returncode:
   need(b'No such image'in p.stderr or b'No such object'in p.stderr,'only-known-owned-image-absence');result.append({'ownedTag':name,'present':False});continue
  rows=json.loads(p.stdout);need(len(rows)==1,'one-owned-preparation-image');r=rows[0];labels=r['Config'].get('Labels')or{};result.append({'ownedTag':name,'present':True,'id':r['Id'],'rootfsSHA256':sha(enc(r['RootFS'])),'revision':labels.get('org.opencontainers.image.revision')if pin(labels.get('org.opencontainers.image.revision'),40)else None,'qcAppTree':labels.get('io.rr-portal.qc-app-tree')if pin(labels.get('io.rr-portal.qc-app-tree'),40)else None})
 return result

def instrument(name,operation):
 R.STAGE=P.STAGE=O.STAGE=L.FAILED='instrument-entry'
 try:value=operation();return {'operation':name,'success':True,'valueSHA256':sha(enc(value)),'observedStages':{'rootRelease':R.STAGE,'P':P.STAGE,'O':O.STAGE,'L':L.FAILED}}
 except Exception as e:return {'operation':name,'success':False,'errorType':type(e).__name__,'rootReleaseStage':R.STAGE,**failure_context(e)}

def collect(report):
 global PROFILE_VALUE,P,O,L,R,PUBLIC_SOURCE_FILES
 report['failedArchiveIsNotRetried']=True;mf=streams_and_seal(report);need(PROFILE.is_file()and not PROFILE.is_symlink()and file_hash(PROFILE)==PROFILE_SHA256,'same-successful-readonly-profile2');PROFILE_VALUE=json.loads(PROFILE.read_bytes());P=load('pr1035-quote-preflight.py',DEPS['pr1035-quote-preflight.py']);O=load('release-data-ops-library.py',DEPS['release-data-ops-library.py']);L=load('release-data-library.py',DEPS['release-data-library.py']);R=load(RELEASE_NAME,RELEASE_SHA256);need(R.DEPS==DEPS and R.CID==CID and R.BASE_IMAGE==CANONICAL,'exact-observed-r2-helper-for-pure-readonly-functions');R.P=P;R.O=O;R.L=L;O.L=L;R.OUT=OUT;R.run=run;P.OUT=OUT;P.command=lambda args,limit=8*1024**2,data=None,timeout=90:run(args,data,timeout);PUBLIC_SOURCE_FILES=tuple(PROFILE_VALUE['targets']['qc']['source']['expectedGitBlobSHA1']);before,extra=original_runtime();report['original46Unchanged']=True;report['extraContainersReadOnlyMetadata']=extra;alias=memory(['docker','image','inspect',ALIAS]);need(len(alias)==1 and alias[0]['Id']==CANONICAL,'original-qc-canonical-alias-still-exact');source=json.loads(run(['docker','exec','--user','0','-i',CID,'node','-e',SOURCE_PROBE],enc(sorted(PUBLIC_SOURCE_FILES))));need(source==PROFILE_VALUE['targets']['qc']['source']['actual'],'all16-public-qc-source-bytes-and-metadata-still-exact');report['publicSource16Unchanged']=True;report['ownedPreparationImages']=optional_images();report['gatewayAuthProbe']=instrument('gateway-auth',P.gateway_auth);records=R.runtime();report['protectionProbe']=instrument('protection',lambda:R.protection(records));after,after_extra=original_runtime();need(after==before and after_extra==extra and memory(['docker','image','inspect',ALIAS])[0]['Id']==CANONICAL,'all-runtime-and-alias-unchanged-after-pure-probes');need(mf==json.loads((FAILED/'manifest.json').read_bytes())and all(file_hash(FAILED/n)==h for n,h in mf.items()),'original-failed-r2-archive-still-sealed-unchanged');report['originalFailedArchiveUnchanged']=True

def main():
 global STAGE
 need(EXECUTE is True and BRANCH and pin(RELEASE_SHA256)and sys.argv[1:]==['diagnose']and os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_MODE')=='diagnose'and os.environ.get('RELEASE_ATTEMPT')=='1','explicit-first-readonly-r2-collector-only');os.umask(0o077);need(OUT.parent.is_dir()and not any(p.is_symlink()for p in(OUT.parent,*OUT.parent.parents))and not OUT.exists(),'fresh-own-r2-collector-private-output');OUT.mkdir(mode=0o700);v={'mode':'diagnose','phase':'diagnose','success':False,'readOnly':True,'businessWrites':False,'lifecycleWrites':False,'configOrTagWrites':False,'failedArchiveRetriedOrEdited':False,'rawPrivateLogBodiesReturned':False,'resultPath':str(OUT/'result.private.json'),'details':{}}
 try:collect(v['details']);v['success']=True
 except Exception as e:v.update(errorType=type(e).__name__,stage=STAGE,**failure_context(e))
 v['resultSHA256']=sha(enc(v));private('result.private.json',v);entries=list(OUT.rglob('*'));need(all(not p.is_symlink()and(p.is_file()or p.is_dir())for p in entries),'regular-only-r2-collector-evidence');mf={str(p.relative_to(OUT)):file_hash(p)for p in entries if p.is_file()};private('manifest.json',mf);transport({'result':v,'manifestSHA256':sha(enc(mf))});return 0 if v['success']else 1

if __name__=='__main__':sys.exit(main())
