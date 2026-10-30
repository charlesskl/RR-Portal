"""INERT first-attempt read-only Indo runtime/static profile. No SQL/env-file read."""
import hashlib,json,os,pathlib,re,stat,subprocess,sys

ROOT=pathlib.Path('/opt/rr-portal')
OUT=ROOT/'deploy/backups/pr1042-indo-preflight-1'
BRANCH='refs/heads/codex/ops-pr-1042-20261030-indo'
SOURCE_HINT='cb5f6d864760962817db9c2f8ed29e809f277594'
SERVICE='indo-shipping'
ALIAS='rr-portal-indo-shipping:latest'
SHARED=('docker-compose.cloud.yml','frontend/index.cloud.html','nginx/nginx.cloud.conf','deploy/update-server.sh','deploy/service-maintenance.sh')
KNOWN_DIRTY=set(SHARED)|{'.env.cloud.production','.github/workflows/deploy.yml'}
EXECUTE=True
STAGE='entry'

def need(v,label):
 global STAGE
 STAGE=label
 if not v:raise RuntimeError(label)

def enc(v):return json.dumps(v,sort_keys=True,separators=(',',':'),ensure_ascii=True,allow_nan=False).encode()
def sha(v):return hashlib.sha256(v).hexdigest()
def pin(v,n=64):return type(v)is str and re.fullmatch('[a-f0-9]{%d}'%n,v)is not None
def private(name,v):
 fd=os.open(OUT/name,os.O_CREAT|os.O_EXCL|os.O_WRONLY|os.O_NOFOLLOW,0o600)
 with os.fdopen(fd,'wb')as f:f.write(enc(v));f.flush();os.fsync(f.fileno())

def command(args,timeout=45,limit=16*1024**2):
 # Config/Env are consumed in memory; neither argv nor raw streams are persisted.
 r=subprocess.run(args,cwd=ROOT,capture_output=True,timeout=timeout)
 need(r.returncode==0 and len(r.stdout)<=limit,'bounded-fixed-read-command-success')
 return r.stdout

def git(*args):return command(['git','-C',str(ROOT),'-c','core.hooksPath=/dev/null',*args])

def safe_relative(v):
 return type(v)is str and bool(v)and str(pathlib.PurePosixPath(v))==v and not pathlib.PurePosixPath(v).is_absolute()and '..'not in pathlib.PurePosixPath(v).parts and '\\'not in v and all(ord(c)>=32 for c in v)

def record(path,limit=64*1024**2):
 need(not path.is_symlink(),'regular-readonly-file-no-symlink')
 fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
 try:
  a=os.fstat(fd);need(stat.S_ISREG(a.st_mode)and 0<=a.st_size<=limit,'bounded-regular-readonly-file')
  h=hashlib.sha256();size=0
  while True:
   b=os.read(fd,1024**2)
   if not b:break
   size+=len(b);need(size<=limit,'bounded-streamed-readonly-file');h.update(b)
  z=os.fstat(fd);key=lambda s:(s.st_dev,s.st_ino,s.st_uid,s.st_gid,s.st_mode,s.st_size,s.st_mtime_ns,s.st_ctime_ns)
  need(key(a)==key(z)==key(path.lstat())and size==a.st_size,'stable-readonly-file-metadata-and-body')
  return {'bytes':size,'sha256':h.hexdigest(),'uid':a.st_uid,'gid':a.st_gid,'mode':stat.S_IMODE(a.st_mode),'mtimeNS':a.st_mtime_ns}
 finally:os.close(fd)

def shared():
 v={}
 for name in SHARED:
  p=ROOT/name;need(not any(x.is_symlink()for x in(p,*p.parents)),'fixed-shared-path-no-symlink')
  v[name]=record(p,8*1024**2)
 return v

def dirty(raw):
 need(type(raw)is bytes and len(raw)<=1024**2 and(not raw or raw.endswith(b'\0')),'bounded-nul-dirty-inventory')
 names=raw.split(b'\0')[:-1]if raw else[]
 need(len(names)==len(set(names))<=10000 and all(names),'unique-dirty-paths')
 known=sorted(n.decode('ascii')for n in names if n in{p.encode()for p in KNOWN_DIRTY})
 return {'trackedPathCount':len(names),'rawPathInventorySHA256':sha(raw),'knownPublicPaths':known,'unknownPathCount':len(names)-len(known)}

def runtime():
 ids=command(['docker','ps','-aq','--no-trunc']).decode().split()
 need(0<len(ids)<1000 and len(ids)==len(set(ids))and all(pin(i)for i in ids),'typed-all-container-identities')
 rows=json.loads(command(['docker','inspect',*ids]));need({r['Id']for r in rows}==set(ids),'complete-in-memory-runtime-inspect')
 result={}
 for r in rows:
  result[r['Id']]={'image':r['Image'],'configSHA256':sha(enc(r['Config'])),'hostConfigSHA256':sha(enc(r['HostConfig'])),'envSHA256':sha(enc(sorted(r['Config'].get('Env')or[]))),'mountsSHA256':sha(enc(sorted(r['Mounts'],key=enc))),'pid':r['State']['Pid'],'started':r['State']['StartedAt'],'restarts':r['RestartCount'],'running':r['State']['Running'],'oom':r['State']['OOMKilled'],'health':r['State'].get('Health',{}).get('Status')}
 targets=[r for r in rows if(r['Config'].get('Labels')or{}).get('com.docker.compose.project')=='rr-portal'and(r['Config'].get('Labels')or{}).get('com.docker.compose.service')==SERVICE]
 need(len(targets)==1,'one-current-indo-container')
 return result,targets[0]

def image():
 rows=json.loads(command(['docker','image','inspect',ALIAS]));need(len(rows)==1,'one-canonical-indo-image');r=rows[0]
 need(type(r['Id'])is str and re.fullmatch('sha256:[a-f0-9]{64}',r['Id']),'typed-canonical-image-id')
 labels=r['Config'].get('Labels')or{};public={}
 for k,pattern in [('org.opencontainers.image.revision','[a-f0-9]{40}'),('io.rr-portal.frontend-app-tree','[a-f0-9]{40}'),('io.rr-portal.backend-image','sha256:[a-f0-9]{64}')]:
  value=labels.get(k);valid=type(value)is str and re.fullmatch(pattern,value)is not None
  public[k]={'present':value is not None,'valid':valid,'value':value if valid else None}
 return {'id':r['Id'],'architecture':r['Architecture'],'os':r['Os'],'configSHA256':sha(enc(r['Config'])),'envSHA256':sha(enc(sorted(r['Config'].get('Env')or[]))),'rootFS':r['RootFS'],'publicLabels':public}

def web_inventory(r):
 # /proc/PID/root is the intended container namespace link; all paths below it
 # are checked independently. Only public /app/wwwroot bytes are read.
 pid=r['State']['Pid'];need(type(pid)is int and pid>0 and not r['Mounts'],'unmounted-running-indo-root')
 parent=pathlib.Path('/proc')/str(pid)/'root'/'app';root=parent/'wwwroot'
 need(parent.is_dir()and not parent.is_symlink()and root.is_dir()and not root.is_symlink(),'regular-container-app-and-wwwroot')
 values={};total=0;dirs=0
 for p,children,names in os.walk(root,followlinks=False):
  directory=pathlib.Path(p);dirs+=1;need(dirs<=1000,'bounded-wwwroot-directories')
  for name in children:
   child=directory/name;need(child.is_dir()and not child.is_symlink(),'regular-wwwroot-child-directory')
  for name in sorted(names):
   child=directory/name;relative=child.relative_to(root).as_posix();need(safe_relative(relative),'safe-public-static-relative-name')
   row=record(child);total+=row['bytes'];need(total<=256*1024**2 and len(values)<1000,'bounded-public-wwwroot-inventory');values[relative]=row
 need('index.html'in values and all(n in values for n in('template-customs.xlsx','template-customs-rri.xlsx','template-customs-rrm.xlsx')),'index-and-three-template-inventory')
 private('wwwroot-hashes.private.json',values)
 return {'files':values,'totalBytes':total,'fileCount':len(values),'inventorySHA256':sha(enc(values))}

def wire(v):
 raw=enc(v);need(len(raw)<=4*1024**2,'bounded-numeric-receipt')
 nib=lambda x:[int(c,16)for c in(format(x,'x')if type(x)is int else x)]
 parts=[raw[i:i+1024]for i in range(0,len(raw),1024)];digest=nib(sha(raw))
 for i,b in enumerate(parts):print(enc([0,nib(i+1),nib(len(parts)),nib(len(raw)),digest,nib(b.hex())]).decode(),flush=True)
 print(enc([1,nib(len(parts)),nib(len(raw)),digest]).decode(),flush=True)

def main():
 need(EXECUTE is True and sys.argv[1:]==['diagnose']and os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_MODE')=='diagnose'and os.environ.get('RELEASE_ATTEMPT')=='1','inert-first-fresh-readonly-profile')
 os.umask(0o077);need(pin(SOURCE_HINT,40)and OUT.parent.is_dir()and not any(p.is_symlink()for p in(OUT.parent,*OUT.parent.parents))and not OUT.exists()and not OUT.is_symlink(),'fresh-own-private-evidence');OUT.mkdir(mode=0o700)
 v={'phase':'diagnose','mode':'diagnose','service':SERVICE,'sourceHint':SOURCE_HINT,'success':False,'readOnly':True,'lifecycleOrConfigOrBusinessWrites':False,'environmentFileRead':False,'plaintextCredentialsWritten':False,'businessFileBodiesCopied':False}
 try:
  before,r=runtime();v['allRuntime']=before;v['containerId']=r['Id'];v['runtime']=before[r['Id']];v['mounts']=r['Mounts'];v['hostGitHead']=git('rev-parse','HEAD').decode().strip();need(pin(v['hostGitHead'],40),'typed-observed-host-head');v['shared']=shared();v['sharedMatchObservedHost']=all(row['sha256']==sha(git('show',v['hostGitHead']+':'+name))for name,row in v['shared'].items());v['unstaged']=dirty(git('diff','--name-only','-z'));v['staged']=dirty(git('diff','--cached','--name-only','-z'));v['canonicalImage']=image();v['wwwroot']=web_inventory(r)
  docker_root=json.loads(command(['docker','info','--format','{{json .DockerRootDir}}']));need(type(docker_root)is str and pathlib.Path(docker_root).is_absolute(),'actual-docker-root');space=os.statvfs(docker_root);v['space']={'available':space.f_bavail*space.f_frsize,'free':space.f_bfree*space.f_frsize};after,_=runtime();need(before==after and git('rev-parse','HEAD').decode().strip()==v['hostGitHead']and shared()==v['shared']and image()==v['canonicalImage'],'all-original-runtime-and-host-profile-unchanged');v['allOriginalRuntimeUnchanged']=True;v['success']=True
 except Exception as e:v.update(errorType=type(e).__name__,stage=STAGE)
 v['resultSHA256']=sha(enc(v));private('result.private.json',v);wire(v);return 0 if v['success']else 1

if __name__=='__main__':sys.exit(main())
