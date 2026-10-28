"""Inert one-shot read-only observation of the existing PR1027 prepare.
Only safe command/file metadata is observed, never log bodies/env/argv/business/SQL.
Only this observer's new private evidence directory is written.
"""
import os,json,pathlib,re,stat,subprocess,sys,hashlib,time,math
EXECUTE=False
BRANCH='refs/heads/ops/pr-1027-readonly-20261028'
ROOT=pathlib.Path('/opt/rr-portal')
PREPARE=ROOT/'deploy/backups/pr1027-indo-20261028/prepare'
OUT=ROOT/'deploy/backups/pr1027-indo-20261028-progress-1'
TARGET='fd32ce653647474acf8c6c8e7aa84dfd11854bfc'
SAFE_PROGRAMS={'docker','git','node','dotnet','sh','bash','curl','tar'}
def read(path):
 if not path.exists():return None
 if any(p.is_symlink()for p in(path,*path.parents)):return None
 fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
 try:
  a=os.fstat(fd)
  if not stat.S_ISREG(a.st_mode)or a.st_size>2*1024**2:return None
  raw=os.read(fd,a.st_size+1);b=os.fstat(fd)
  if(a.st_ino,a.st_size,a.st_mtime_ns)!=(b.st_ino,b.st_size,b.st_mtime_ns)or len(raw)!=a.st_size:return None
  return json.loads(raw)
 except(ValueError,OSError):return None
 finally:os.close(fd)
def cmd(args):
 p=subprocess.run(args,cwd=ROOT,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=20)
 if len(p.stdout)+len(p.stderr)>16*1024**2:raise RuntimeError('bounded-output')
 return p

def status(path):
 # lstat only: stdout/stderr bytes are never opened or returned.
 if any(p.is_symlink()for p in path.parents):return {'present':False}
 try:s=path.lstat()
 except FileNotFoundError:return {'present':False}
 if not stat.S_ISREG(s.st_mode):return {'present':False,'regular':False}
 return {'present':True,'regular':True,'bytes':s.st_size,'mtimeNs':s.st_mtime_ns}

def command_progress():
 files=sorted(PREPARE.glob('*.command.private.json'))
 if len(files)>10000:raise RuntimeError('bounded-command-metadata-count')
 counts={};last=[];invalid=0
 for p in files:
  match=re.fullmatch('([0-9]{3,8})[.]command[.]private[.]json',p.name)
  if not match:invalid+=1;continue
  value=read(p)
  if type(value)is not dict or set(value)!={'program','timeout'}or type(value.get('timeout'))not in(int,float)or not math.isfinite(value['timeout'])or not 0<value['timeout']<=7200:
   invalid+=1;continue
  program=value['program']if value['program']in SAFE_PROGRAMS else'other'
  counts[program]=counts.get(program,0)+1;prefix=match[1]
  last.append({'serial':int(prefix),'program':program,'timeoutSeconds':value['timeout'],'metadata':status(p),'stdout':status(PREPARE/(prefix+'.stdout.private')),'stderr':status(PREPARE/(prefix+'.stderr.private'))})
 last.sort(key=lambda x:x['serial'])
 return {'validMetadataCount':len(last),'invalidMetadataCount':invalid,'programCounts':counts,'latestCommands':last[-5:],'commandCompletionNotInferred':True}

def main():
 assert EXECUTE is True and sys.argv[1:]==['progress']and os.environ.get('RELEASE_MODE')=='progress'and os.environ.get('RELEASE_ATTEMPT')=='1'and os.environ.get('RELEASE_BRANCH')==BRANCH
 os.umask(0o077)
 if not OUT.parent.is_dir()or OUT.parent.is_symlink()or OUT.exists()or OUT.is_symlink():raise RuntimeError('fresh-own-private-observation-required')
 OUT.mkdir(mode=0o700)
 result={'phase':'progress','target':TARGET,'success':False,'readOnly':True,'atomicAcrossObservations':False,'observedUnixNs':time.time_ns()}
 try:
  space={};v=read(PREPARE/'docker-space.private.json')
  if type(v)is dict and type(v.get('available'))is int and v['available']>=0:space['availableBytesBeforeBuild']=v['available']
  info=cmd(['docker','info','--format','{{json .DockerRootDir}}'])
  if info.returncode==0:
   root=json.loads(info.stdout)
   if type(root)is str and root.startswith('/')and '..'not in pathlib.PurePosixPath(root).parts and pathlib.Path(root).is_dir():
    fs=os.statvfs(root);space['currentFreeBytes']=fs.f_frsize*fs.f_bavail
  result['space']=space;result['commands']=command_progress()
  p=cmd(['ps','-eo','comm,etimes']);processes={}
  for name,seconds in re.findall(r'^\s*(apt-get|dpkg|dotnet|node|docker|buildkitd|runc|http|https)\s+([0-9]+)\s*$',p.stdout.decode(),re.M):
   d=processes.setdefault(name,{'count':0,'maxElapsedSeconds':0});d['count']+=1;d['maxElapsedSeconds']=max(d['maxElapsedSeconds'],int(seconds))
  result['processes']=processes
  built=cmd(['docker','image','inspect','--format','{{.Id}}','rr-portal-indo-shipping:pr1027-built-'+TARGET[:12]]);result['builtImagePresent']=built.returncode==0
  image=cmd(['docker','image','inspect','--format','{{.Id}}','rr-portal-indo-shipping:pr1027-'+TARGET[:12]]);result['candidateImagePresent']=image.returncode==0
  probe=cmd(['docker','ps','-aq','--filter','label=io.rr-portal.pr1027-clone']);ids=probe.stdout.decode().split();result['privateProbeCount']=len(ids)
  result['sourceExtracted']=status(PREPARE/'source/apps/印尼小组/印尼走货明细/Dockerfile')['present'];result['preparedEvidencePresent']=status(PREPARE/'prepared.private.json')['present'];result['success']=True
 except Exception as e:result['errorType']=type(e).__name__
 body=json.dumps(result,sort_keys=True,separators=(',',':')).encode();result['resultSHA256']=hashlib.sha256(body).hexdigest();result['sha256Wire']={'target':[int(c,16)for c in TARGET]}
 fd=os.open(OUT/'result.private.json',os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
 with os.fdopen(fd,'wb')as f:f.write(json.dumps(result,sort_keys=True).encode()+b'\n');f.flush();os.fsync(f.fileno())
 print(json.dumps(result,sort_keys=True),flush=True);return 0 if result['success']else 1
if __name__=='__main__':sys.exit(main())
