"""Fixed read-only sealed-runtime comparison. No HTTP, DB queries, writes or signals."""
import copy,hashlib,io,json,os,pathlib,re,stat,subprocess,sys,tarfile
PIN=False
TARGET='26a009541efeb99588e84c289cfe8463f18f6f4a'
TREE='603d8c20730da455cc33e3e186754e63a9af4ab0'
BASE='f50e23735af6e198721830e26e35e26162f09af0'
BRANCH='refs/heads/ops/batch-988-991-992-20261022'
ROOT=pathlib.Path('/opt/rr-portal')
OUT=ROOT/'deploy/backups/batch-988-991-992-20261022-runtime-diagnose1'
BACKUP=ROOT/'deploy/backups/batch-988-991-992-20261022-backup-2'
PREPARE=ROOT/'deploy/backups/batch-988-991-992-20261022-prepare'
DEPLOY=ROOT/'deploy/backups/batch-988-991-992-20261022-deploy'
SEALS=((BACKUP,'f2ab3255fe5f84b68425836d2ade883431a75bb17f55d0bc418fe13afb9a8835','8c762d0483fa954ca586c7a1c80e73bc98ae2b5473a9f483132954d4ba8a710c','backup',True),(PREPARE,'b0002877f3440b1350d5cdc1a084bc744eac6dcf90bd30ad4499a5dca892ade8','0f815ba77c689a3f3d0e5580c6e389da5110a954786d1c316939c05ff31fda0d','prepare',True),(DEPLOY,'01c8a72d67dbec5e50811b5eeb2465156eba09fb840b0cb7552eaeacab63732a','3cdb7c3f51a223e695d737eef583a75b39af9bc73a3a0b8f273515a52d68cc16','deploy',False))
SERVICES=('factory-review-test','factory-review','internal-quote')
BIND_OPTIONS={str(ROOT/'apps/业务部/内部报价系统/backend/data')+':/app/backend/legacy-data:ro',str(ROOT/'apps/业务部/内部报价系统/backend/uploads')+':/app/backend/uploads:rw',str(ROOT/'apps/业务部/内部报价系统/backend/uploads')+':/app/backend/uploads'}
STAGE='entry'
def need(v,label):
 global STAGE
 if not v:STAGE=label;raise RuntimeError('DIAGNOSTIC_REJECTED')
def enc(v):return json.dumps(v,ensure_ascii=True,sort_keys=True,separators=(',',':'),allow_nan=False).encode()
def sha(v):return hashlib.sha256(v).hexdigest()
def safe(n):return type(n)is str and n and not n.startswith('/')and'\\'not in n and all(p not in('','..','.')for p in n.split('/'))
def regular(p):
 need(p.is_file()and not p.is_symlink()and p.resolve()==p,'canonical-regular-file');return p
def digest(p):
 regular(p);h=hashlib.sha256()
 with p.open('rb')as f:
  a=os.fstat(f.fileno());need(a.st_size<=8*1024**3,'bounded-archive-file')
  for b in iter(lambda:f.read(1024**2),b''):h.update(b)
  c=os.fstat(f.fileno());need((a.st_dev,a.st_ino,a.st_size,a.st_mtime_ns,a.st_ctime_ns)==(c.st_dev,c.st_ino,c.st_size,c.st_mtime_ns,c.st_ctime_ns),'stable-archive-file')
 return h.hexdigest()
def read(p,limit=32*1024**2):regular(p);need(p.stat().st_size<=limit,'bounded-json');return json.loads(p.read_bytes())
def write(n,v):
 p=OUT/n;fd=os.open(p,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
 with os.fdopen(fd,'wb')as f:f.write(enc(v))
def archive(spec):
 p,mh,rh,mode,success=spec;need(p.is_dir()and not p.is_symlink()and p.resolve()==p and stat.S_IMODE(p.stat().st_mode)==0o700,'private-fixed-archive');need(digest(p/'manifest.json')==mh and digest(p/'first-result.json')==rh,'fixed-sealed-archive');m=read(p/'manifest.json');entries=list(p.rglob('*'));need(type(m)is dict and len(entries)<=100000 and all(not f.is_symlink()and(f.is_file()or f.is_dir())and f.stat().st_mode&0o077==0 for f in entries),'all-private-archive-entries');need(set(m)=={str(f.relative_to(p))for f in entries if f.is_file()and f!=p/'manifest.json'}and all(safe(n)and re.fullmatch('[a-f0-9]{64}',h or'')and digest(p/n)==h for n,h in m.items()),'all-archive-file-seals');r=read(p/'first-result.json');need(r.get('mode')==mode and r.get('success')is success and r.get('base')==BASE and r.get('target')==(BASE if mode=='backup'else TARGET),'archive-mode-outcome-source');return m

def run(a):
 r=subprocess.run(a,cwd=ROOT,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=45);need(r.returncode==0 and len(r.stdout)<=32*1024**2,'fixed-readonly-command');return r.stdout
def envmap(v):
 need(type(v)is list and len(v)<=1000,'bounded-env-list');out={}
 for x in v:need(type(x)is str and'='in x,'environment-pair');k,val=x.split('=',1);need(re.fullmatch('[A-Za-z_][A-Za-z0-9_]*',k)and k not in out,'unique-environment-key');out[k]=val
 return out
def row(r):return{'id':r['Id'],'image':r['Image'],'started':r['State'].get('StartedAt'),'running':r['State']['Running'],'oom':r['State']['OOMKilled'],'restarts':r['RestartCount'],'health':r['State'].get('Health',{}).get('Status'),'environmentMapSHA256':sha(enc(envmap(r['Config']['Env']))),'mounts':sorted(r['Mounts'],key=enc),'configSHA256':sha(enc(dict(r['Config'],Env=sorted(r['Config']['Env'])))),'hostConfigSHA256':sha(enc(r['HostConfig']))}
def runtime():
 ids=run(['docker','ps','-aq','--no-trunc']).decode().split();need(len(ids)==len(set(ids))==46 and all(re.fullmatch('[a-f0-9]{64}',n)for n in ids),'exact46-container-identities');rs=json.loads(run(['docker','inspect',*ids]));need(type(rs)is list and len(rs)==46 and{r['Id']for r in rs}==set(ids),'all46-runtime-inspects');targets={}
 for r in rs:
  labels=r['Config'].get('Labels')or{};s=labels.get('com.docker.compose.service')if labels.get('com.docker.compose.project')=='rr-portal'else None
  if s in SERVICES:need(s not in targets,'unique-target');targets[s]=r
 need(set(targets)==set(SERVICES),'exact-three-targets');return rs,targets

def normalized(h):
 h=copy.deepcopy(h)
 for k in('Dns','DnsOptions','DnsSearch'):
  if k in h and(h[k]is None or type(h[k])is list and not h[k]):h[k]=None
 return h
def value(v):return{'type':type(v).__name__,'sha256':sha(enc(v))}
def exposed(k,v):
 if k=='Binds'and type(v)is list and len(v)==2 and len(set(v))==2 and all(x in BIND_OPTIONS for x in v):return v
 if k in('Dns','DnsOptions','DnsSearch')and(v is None or type(v)is list and not v):return v
 if k=='NetworkMode'and v=='rr-portal_platform-net':return v
 if k=='PortBindings'and(v is None or v=={}):return v
 return 'value_suppressed'
def difference(old,new):
 a,c=old['HostConfig'],new['HostConfig'];changed=[]
 for k in sorted(set(a)|set(c)):
  if(k in a)==(k in c)and a.get(k)==c.get(k):continue
  need(type(k)is str and re.fullmatch('[A-Za-z][A-Za-z0-9]{0,63}',k),'fixed-docker-hostconfig-key');item={'key':k,'originalPresent':k in a,'observedPresent':k in c,'original':value(a.get(k)),'observed':value(c.get(k))}
  for label,v in(('original',a.get(k)),('observed',c.get(k))):
   shown=exposed(k,v)
   if shown!='value_suppressed':item[label]['safeValue']=shown
  changed.append(item)
 x,y=a.get('Binds'),c.get('Binds');lists=type(x)is list and type(y)is list and all(type(v)is str for v in x+y);return{'hostConfigExact':a==c,'hostConfigEqualWithExistingEmptyDNSNormalization':normalized(a)==normalized(c),'hostConfigDifferences':changed,'mountsExactIgnoringArrayOrder':sorted(old['Mounts'],key=enc)==sorted(new['Mounts'],key=enc),'originalMountsSHA256':sha(enc(sorted(old['Mounts'],key=enc))),'observedMountsSHA256':sha(enc(sorted(new['Mounts'],key=enc))),'bindsOrderEqual':x==y,'bindsSameMultiset':sorted(x)==sorted(y)if lists else None,'bindsAllValuesAllowlisted':lists and all(v in BIND_OPTIONS for v in x+y)}
def flags():
 root=ROOT/'deploy/maintenance';need(root.is_dir()and not root.is_symlink(),'existing-maintenance-directory');out=[]
 for p in sorted(root.rglob('*')):
  need(not p.is_symlink()and(p.is_dir()or p.is_file()),'regular-maintenance-entry');v={'path':str(p.relative_to(root)),'directory':p.is_dir(),'mode':stat.S_IMODE(p.stat().st_mode)}
  if p.is_file():v.update(bytes=p.stat().st_size,sha256=digest(p))
  out.append(v)
 return out
def environment():
 p=regular(ROOT/'.env.cloud.production');s=p.stat();return{'sha256':digest(p),'metadata':{'mode':stat.S_IMODE(s.st_mode),'uid':s.st_uid,'gid':s.st_gid}}
def sources(s,cid,expected):
 need(type(expected)is dict and expected and len(expected)<=5000 and all(safe(n)and type(v)is dict and re.fullmatch('[a-f0-9]{64}',v.get('sha256',''))for n,v in expected.items()),'fixed-safe-source-proof-inventory');factory=s.startswith('factory-review');names=['pb_hooks','pb_migrations','pb_public']if factory else list(expected);blob=run(['docker','exec','--user','0',cid,'tar','-C','/pb'if factory else'/app','-cf','-',*names]);actual={};total=0
 with tarfile.open(fileobj=io.BytesIO(blob),mode='r:')as t:
  for m in t:
   n=m.name.rstrip('/');need(safe(n)and(m.isdir()or m.isfile()),'safe-readonly-runtime-tar')
   if m.isdir():continue
   need(n in expected and n not in actual and m.size<=16*1024**2,'exact-runtime-source-entry');total+=m.size;need(total<=32*1024**2,'bounded-runtime-source');b=t.extractfile(m).read();need(len(b)==m.size,'complete-runtime-source');actual[n]={'bytes':m.size,'sha256':sha(b)}
 return actual==expected

def diagnose(result):
 before=[archive(s)for s in SEALS];b=read(BACKUP/'baseline.private.json');oldraw=read(BACKUP/'target-inspect.private.json');p=read(PREPARE/'prepared.private.json');failed=read(DEPLOY/'first-result.json');need(failed.get('completedServices')==list(SERVICES[:2])and failed.get('failedService')=='internal-quote'and failed.get('failedStage')=='complete-hostconfig-mounts'and failed.get('failedServiceRecoveredWithoutDataRestore')is True,'fixed-known-failed-and-recovered-deployment');need(p['target']==TARGET and p['tree']==TREE and set(p['images'])==set(p['proofs'])==set(SERVICES),'bound-three-prepared-proofs');started=read(DEPLOY/'internal-quote-candidate-started.private.json');matches=[]
 for n in sorted(before[2]):
  if re.fullmatch(r'all-runtime-inspect-[0-9]{3}\.private\.json',n):
   rs=read(DEPLOY/n);need(type(rs)is list and len(rs)==46,'sealed-runtime-array46')
   for r in rs:
    if r['Id']==started['containerId']:need(r['Image']==started['image']==p['images']['internal-quote']and r['State']['StartedAt']==started['candidateStartedAt'],'sealed-candidate-exact-id-image-started');matches.append(r)
 need(matches and len({sha(enc({k:r[k]for k in('Config','HostConfig','Mounts')}))for r in matches})==1,'one-immutable-candidate-runtime-contract');candidate=matches[0];allbefore,current=runtime();environment_before=environment();flags_before=flags();need(run(['git','symbolic-ref','--quiet','HEAD']).decode().strip()=='refs/heads/main'and run(['git','rev-parse','HEAD']).decode().strip()==TARGET and run(['git','rev-parse','HEAD^{tree}']).decode().strip()==TREE,'canonical-current-main');others={r['Id']:row(r)for r in allbefore if r['Id']not in{r['Id']for r in current.values()}};sourceproof={};health={}
 for s,r in current.items():
  health[s]=r['State'].get('Health',{}).get('Status');need(r['State']['Running']is True and r['State']['OOMKilled']is False and health[s]=='healthy','all-three-current-docker-healths');expected=p['proofs'][s]if s.startswith('factory-review')else b['sourceProof'][s]['files'];sourceproof[s]=sources(s,r['Id'],expected)
  if s.startswith('factory-review'):
   cut=read(DEPLOY/(s+'-candidate-started.private.json'));need(r['Id']==cut['containerId']and r['Image']==cut['image']==p['images'][s]and r['State']['StartedAt']==cut['candidateStartedAt'],'current-factory-equals-completed-candidate')
 recovered=current['internal-quote'];result.update(originalToCandidate=difference(oldraw['internal-quote'],candidate),originalToRecovered=difference(oldraw['internal-quote'],recovered),candidateRuntimeRecordCount=len(matches),candidateContainerId=candidate['Id'],recoveredContainerId=recovered['Id'],recoveredOldImmutableImage=recovered['Image']==oldraw['internal-quote']['Image'],other43ExactRuntimeAndConfigUnchanged=others==b['runtime']['others'],currentDockerHealth=health,currentSourcesMatchPreparedFactoriesAndOriginalQuote=sourceproof,environmentBytesModeOwnerUnchanged=environment_before=={'sha256':b['environmentSHA256'],'metadata':b['environmentFileMetadata']},flagsMatchOriginal=flags_before==b['maintenanceInventory'])
 need(all(sourceproof.values())and result['recoveredOldImmutableImage']and result['other43ExactRuntimeAndConfigUnchanged']and result['environmentBytesModeOwnerUnchanged']and result['flagsMatchOriginal'],'current-recovered-scope-and-preservation');need(all(envmap(current[s]['Config']['Env'])==read(BACKUP/(s+'-literal-configured-environment.private.json'))for s in SERVICES),'all-three-current-literal-environments');allafter,_=runtime();need({r['Id']:row(r)for r in allafter}=={r['Id']:row(r)for r in allbefore}and environment()==environment_before and flags()==flags_before,'current-runtime-environment-flags-stable');need([archive(s)for s in SEALS]==before,'all-three-original-sealed-archives-unchanged');result.update(success=True,allOriginalArchiveFilesRehashedBeforeAfter=True,current46MetadataStable=True,currentEnvironmentAndFlagsStable=True,allThreeConfiguredEnvironmentMapsMatchOriginal=True,rootCauseOrContractChangeInferred=False)

def main():
 need(PIN is True and sys.argv[1:]==['diagnose']and os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_ATTEMPT')=='1','inert-or-wrong-invocation');os.umask(0o077);OUT.mkdir(mode=0o700);result={'mode':'diagnose','base':BASE,'target':TARGET,'tree':TREE,'success':False,'businessWritesPerformed':False,'configurationChanged':False,'containerSignalsPerformed':False,'HTTPRequestsPerformed':False,'databaseQueriesPerformed':False,'modelCallsPerformed':False,'rawSecretsOrRowsPrinted':False}
 try:diagnose(result)
 except BaseException as e:result.update(failedStage=STAGE,safeExceptionType=type(e).__name__)
 finally:
  write('first-result.json',result);m={str(p.relative_to(OUT)):digest(p)for p in OUT.rglob('*')if p.is_file()};write('manifest.json',m);print(enc(dict(result,manifestSHA256=digest(OUT/'manifest.json'),resultSHA256=digest(OUT/'first-result.json'))).decode(),flush=True)
 return 0 if result['success']else 1
if __name__=='__main__':
 try:sys.exit(main())
 except SystemExit:raise
 except BaseException as e:print(enc({'mode':'diagnose','success':False,'safeExceptionType':type(e).__name__,'safeFailure':'INERT_OR_PREFLIGHT_REJECTED'}).decode(),flush=True);sys.exit(1)
