"""INERT exact PR1044 prepare capacity-failure read-only collector. Never replay."""
import datetime,hashlib,importlib.util,json,os,pathlib,re,stat,subprocess,sys,urllib.request
ROOT=pathlib.Path('/opt/rr-portal')
FAILED=ROOT/'deploy/backups/pr1044-indo-static-1-20261031/prepare'
PROFILE=ROOT/'deploy/backups/pr1044-indo-preflight-1/result.private.json'
OUT=ROOT/'deploy/backups/pr1044-prepare-failure-readonly-1'
BRANCH='refs/heads/codex/ops-pr-1044-20261031-indo'
PHASE='diagnose'
EXECUTE=True
MANIFEST_SHA256='064c7010013d1de91715667243e56006e9e3afc3f11adc54398dc540e47a8e5f'
FAILED_RESULT_INNER_SHA256='9522942e5d48291541fd8ee554dcc90f5234bd9b10ba8dd1c473cf28e3df9d48'
PROFILE_SHA256='ef3e8e8c37d062c0b4d5e3fb0fb1a9ba849f6495bb621ddce9c9c90781e0acc2'
PROFILE_INNER_SHA256='6cba0924b449143c364ea03562dcdc27adec3a61fad678d32c687b6739dc131c'
HEAD='b3693d755283f23518fe478ee7e46e1c22545f0d'
TARGET='9947afd48c2bc6f4bd2f12757789368460990c36'
APP_TREE='2bb9d25768d10e9dde67b2eb889ec48be1aeb5fd'
HOST='f22fbffa1789234fe1c78bf776f4dcb3fe867d0c'
FRONTEND_TAG='rrportal-indo-pr1044-frontend:'+TARGET
CANDIDATE_TAG='rrportal-indo-pr1044:'+TARGET
COMMON_NAME='pr1044-indo-preflight.py'
COMMON_SHA256='940e9675d628bc0af628ac3964b9073069f99d682a7bc812960ac6e1b88d3004'
PUBLIC='http://127.0.0.1/indo-shipping/'
SELECTED=('docker-space-before.private.json','docker-space-after.private.json','docker-space-preapply.private.json','prepared.private.json','frontend-raw-dist.private.json','image-context/Dockerfile')
P=None
STAGE='entry'

def need(value,label):
 global STAGE
 STAGE=label
 if not value:raise RuntimeError(label)
def enc(v):return json.dumps(v,sort_keys=True,separators=(',',':'),ensure_ascii=True,allow_nan=False).encode()
def sha(v):return hashlib.sha256(v).hexdigest()
def pin(v,width=64):return type(v)is str and re.fullmatch('[a-f0-9]{%d}'%width,v)is not None
def safe_relative(v):return type(v)is str and bool(v)and str(pathlib.PurePosixPath(v))==v and not pathlib.PurePosixPath(v).is_absolute()and '..'not in pathlib.PurePosixPath(v).parts and '\\'not in v and all(ord(c)>=32 for c in v)
def read(path,limit=4*1024**2):
 need(not any(p.is_symlink()for p in(path,*path.parents)),'fixed-read-path-no-symlink');fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
 try:
  first=os.fstat(fd);need(stat.S_ISREG(first.st_mode)and 0<=first.st_size<=limit,'bounded-regular-selected-file');body=b''
  while True:
   chunk=os.read(fd,65536)
   if not chunk:break
   body+=chunk;need(len(body)<=limit,'bounded-selected-body')
  key=lambda s:(s.st_dev,s.st_ino,s.st_uid,s.st_gid,s.st_mode,s.st_size,s.st_mtime_ns,s.st_ctime_ns)
  need(key(first)==key(os.fstat(fd))==key(path.lstat())and len(body)==first.st_size,'stable-selected-evidence');return body
 finally:os.close(fd)
def private(name,value):
 need(name in('result.private.json',),'only-own-fixed-result-output');fd=os.open(OUT/name,os.O_CREAT|os.O_EXCL|os.O_WRONLY|os.O_NOFOLLOW,0o600)
 with os.fdopen(fd,'wb')as f:f.write(enc(value));f.flush();os.fsync(f.fileno())
def initialize():
 global P
 path=pathlib.Path(__file__).with_name(COMMON_NAME);need(sha(read(path))==COMMON_SHA256,'exact-inactive-memory-only-helper');spec=importlib.util.spec_from_file_location('pr1044_inactive_profile',path);P=importlib.util.module_from_spec(spec);spec.loader.exec_module(P);need(P.EXECUTE is False,'helper-entry-stays-inactive')
def baseline():
 raw=read(PROFILE);need(sha(raw)==PROFILE_SHA256,'exact-successful-baseline-profile-bytes');v=json.loads(raw);inner=dict(v);inner.pop('resultSHA256',None)
 need(v['success']is True and v['phase']=='diagnose'and v['service']=='indo-shipping'and v['resultSHA256']==PROFILE_INNER_SHA256==sha(enc(inner))and v['hostGitHead']==HOST and len(v['allRuntime'])==46,'exact-self-sealed-successful-forty-six-container-baseline');return v

def archive():
 raw=read(FAILED/'manifest.json',16*1024**2);need(sha(raw)==MANIFEST_SHA256,'exact-failed-manifest-bytes');m=json.loads(raw);need(type(m)is dict and 0<len(m)<=100000 and all(safe_relative(n)and pin(h)for n,h in m.items()),'bounded-safe-manifest-in-memory')
 raw_result=read(FAILED/'result.private.json');r=json.loads(raw_result);inner=dict(r);inner.pop('resultSHA256',None)
 need(r['resultSHA256']==FAILED_RESULT_INNER_SHA256==sha(enc(inner))and r['success']is False and r['phase']=='prepare'and r['stage']=='reviewed-realistic-capacity-floor'and r['head']==HEAD and r['target']==TARGET and r['appTree']==APP_TREE and r['hostBase']==HOST and r['manifestSHA256']==MANIFEST_SHA256,'exact-source-bound-capacity-failure')
 result={'manifestSHA256':MANIFEST_SHA256,'resultInnerSHA256':FAILED_RESULT_INNER_SHA256,'failureStage':r['stage'],'sealedManifestEntryCount':len(m),'rawCommandLogsOpened':False,'allArchiveBodiesVerified':False,'selected':{}}
 for name in SELECTED:
  path=FAILED/name;need(not any(p.is_symlink()for p in(path,*path.parents)),'fixed-selected-path-no-symlink');present=path.exists();row={'present':present,'listedInSealedManifest':name in m,'sealConsistent':present==(name in m)};result['selected'][name]=row
  if not present:continue
  body=read(path);row.update(bytes=len(body),sha256=sha(body),sealConsistent=m.get(name)==sha(body));need(row['sealConsistent'],'exact-selected-structured-evidence-seal')
  if name.startswith('docker-space-'):
   value=json.loads(body);need(type(value)is dict and all(type(value.get(k))is int and value[k]>=0 for k in('available','free')),'typed-observed-capacity-values');row['values']={k:v for k,v in value.items()if k in('available','free','minimumOrdinaryAvailable','minimumPhysicalFree','maximumObservedPreparationGrowth','observedOrdinarySpaceDrop','observedPhysicalSpaceDrop')and type(v)is int};row['floorPassed']=value['available']>=value.get('minimumOrdinaryAvailable',0)and value['free']>=value.get('minimumPhysicalFree',0)
  elif name=='frontend-raw-dist.private.json':
   value=json.loads(body);files=value.get('files');need(type(files)is dict and 0<len(files)<1000 and all(safe_relative(n)and pin(h)for n,h in files.items()),'bounded-raw-frontend-public-hash-graph');row['summary']={'image':value.get('image')if re.fullmatch('sha256:[a-f0-9]{64}',str(value.get('image')))else None,'fileCount':len(files),'manifestSHA256':sha(enc(files)),'indexSHA256':files.get('index.html'),'missingGitProvenTemplates':[n for n in value.get('missingGitProvenTemplates',[])if n in('template-customs-rri.xlsx','template-customs-rrm.xlsx')],'noCacheFrontendBuild':value.get('noCacheFrontendBuild')is True}
  elif name=='prepared.private.json':
   value=json.loads(body);row['summary']={k:value.get(k)for k in('base','head','target','tree','appTree','hostBase','container','durableImage','newManifestSHA256','frontendImage')if type(value.get(k))is str and(re.fullmatch('[a-f0-9]{40,64}',value[k])or re.fullmatch('sha256:[a-f0-9]{64}',value[k]))};row['summary'].update(oldFileCount=len(value.get('oldManifest',{})),newFileCount=len(value.get('newManifest',{})),newAssetCount=len(value.get('newAssets',[])),oldProofPresent=type(value.get('oldProof'))is dict)
  else:row['summary']={'lineCount':len(body.splitlines()),'containsOnlyExpectedThinStaticDockerfile':body==('FROM rrportal-indo-pr1044-backend:d490c0729e6604fed85993e4b95d423d206eeeac38d4f0f6358af682ec33faed\nCOPY --chown=app:app wwwroot/ /app/wwwroot/\nLABEL org.opencontainers.image.revision="'+TARGET+'" io.rr-portal.backend-image="sha256:79c441c8c2df6d6df6fcc475e865535c3ed5c4e884e56bcb1a2a772c5163b0a9" io.rr-portal.frontend-app-tree="'+APP_TREE+'"\n').encode()}
 result['publicTreeDirectoryPresence']={name:(FAILED/name).is_dir()and not(FAILED/name).is_symlink()for name in('old-wwwroot','prepared-wwwroot','image-context')}
 before=result['selected']['docker-space-before.private.json'];after=result['selected']['docker-space-after.private.json'];result['capacityFailureLocation']='after'if after['present']and not after.get('floorPassed',True)else'before'if before['present']and not before.get('floorPassed',True)else'unresolved'
 return result

def image(tag):
 need(tag in(FRONTEND_TAG,CANDIDATE_TAG),'only-two-exact-candidate-tags');r=subprocess.run(['docker','image','inspect',tag],cwd=ROOT,capture_output=True,timeout=30);need(len(r.stdout)<=16*1024**2 and len(r.stderr)<=1024**2,'bounded-image-inspect-only-memory')
 if r.returncode!=0:
  need(b'No such image:'in r.stderr or b'No such object:'in r.stderr,'only-known-absent-candidate-image');return{'present':False}
 rows=json.loads(r.stdout);need(type(rows)is list and len(rows)==1,'one-exact-tag-image');v=rows[0];need(re.fullmatch('sha256:[a-f0-9]{64}',str(v['Id']))and v['Architecture']in('amd64','arm64')and v['Os']=='linux','typed-public-image-identity');labels=v['Config'].get('Labels')or{};public={}
 for key,pattern in(('org.opencontainers.image.revision','[a-f0-9]{40}'),('io.rr-portal.frontend-app-tree','[a-f0-9]{40}'),('io.rr-portal.backend-image','sha256:[a-f0-9]{64}')):
  value=labels.get(key);public[key]=value if type(value)is str and re.fullmatch(pattern,value)else None
 return{'present':True,'id':v['Id'],'architecture':v['Architecture'],'os':v['Os'],'configSHA256':sha(enc(v['Config'])),'rootFS':v['RootFS'],'publicLabels':public}
def index(r):
 pid=r['State']['Pid'];need(type(pid)is int and pid>0 and not r['Mounts'],'same-unmounted-live-index-root');path=pathlib.Path('/proc')/str(pid)/'root/app/wwwroot/index.html';need(not any(p.is_symlink()for p in(path,path.parent,path.parent.parent)),'fixed-public-index-no-symlink');return P.record(path,1024**2)
def public_index():
 class NoRedirect(urllib.request.HTTPRedirectHandler):
  def redirect_request(self,*args,**kwargs):return None
 opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),NoRedirect());request=urllib.request.Request(PUBLIC,headers={'Cache-Control':'no-cache'})
 with opener.open(request,timeout=20)as response:body=response.read(1024**2+1);code=response.status
 need(len(body)<=1024**2 and code==200,'bounded-current-public-index200');return{'status':code,'bytes':len(body),'sha256':sha(body)}
def space():
 root=json.loads(P.command(['docker','info','--format','{{json .DockerRootDir}}']));need(type(root)is str and pathlib.Path(root).is_absolute(),'actual-docker-root-for-readonly-space');v=os.statvfs(root);return{'available':v.f_bavail*v.f_frsize,'free':v.f_bfree*v.f_frsize}
def wire(value):
 raw=enc(value);need(len(raw)<=4*1024**2,'bounded-numeric-diagnostic-receipt');nib=lambda x:[int(c,16)for c in(format(x,'x')if type(x)is int else x)];parts=[raw[i:i+1024]for i in range(0,len(raw),1024)];digest=nib(sha(raw))
 for i,b in enumerate(parts):print(enc([0,nib(i+1),nib(len(parts)),nib(len(raw)),digest,nib(b.hex())]).decode(),flush=True)
 print(enc([1,nib(len(parts)),nib(len(raw)),digest]).decode(),flush=True)
def main():
 need(EXECUTE is True and PHASE=='diagnose'and sys.argv[1:]==[PHASE]and os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_MODE')==PHASE and os.environ.get('RELEASE_ATTEMPT')=='1','inert-first-exact-readonly-capacity-diagnostic');os.umask(0o077);need(OUT.parent.is_dir()and not any(p.is_symlink()for p in(OUT.parent,*OUT.parent.parents))and not OUT.exists()and not OUT.is_symlink(),'fresh-own-single-attempt-readonly-output');OUT.mkdir(mode=0o700)
 v={'phase':PHASE,'mode':PHASE,'service':'indo-shipping','success':False,'readOnly':True,'buildOrReplayOrCleanupOrLifecyclePerformed':False,'databaseReadOrWritten':False,'rawCommandLogsOpened':False,'environmentFileRead':False,'plaintextCredentialsWritten':False}
 try:
  initialize();base=baseline();v['archive']=archive();rows,r=P.runtime();v['allRuntime']=rows;v['runtime']=rows[r['Id']];v['canonicalImage']=P.image();v['liveIndex']=index(r);v['publicIndex']=public_index();v['space']=space();v['candidateImages']={tag:image(tag)for tag in(FRONTEND_TAG,CANDIDATE_TAG)}
  v['baselineComparison']={'all46RuntimeExact':rows==base['allRuntime'],'canonicalImageExact':v['canonicalImage']==base['canonicalImage'],'liveIndexExact':v['liveIndex']==base['wwwroot']['files']['index.html'],'publicIndexExact':v['publicIndex']==base['public']['index'],'ordinarySpaceDelta':v['space']['available']-base['space']['available'],'physicalSpaceDelta':v['space']['free']-base['space']['free']}
  after,_=P.runtime();need(after==rows and P.image()==v['canonicalImage']and index(r)==v['liveIndex'],'runtime-alias-and-live-index-unchanged-through-readonly-diagnostic');need(all(row['sealConsistent']for row in v['archive']['selected'].values()),'all-selected-presence-and-seals-consistent');need(all(v['baselineComparison'][k]for k in('all46RuntimeExact','canonicalImageExact','liveIndexExact','publicIndexExact')),'all-original-runtime-canonical-and-public-index-still-baseline');v['success']=True
 except Exception as error:v.update(errorType=type(error).__name__,stage=STAGE)
 v['utc']=datetime.datetime.now(datetime.timezone.utc).isoformat();v['resultSHA256']=sha(enc(v));private('result.private.json',v);wire(v);return 0 if v['success']else 1
if __name__=='__main__':sys.exit(main())
