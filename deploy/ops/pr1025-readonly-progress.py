"""One fixed read-only observation during the already running PR1025 R2 prepare."""
import os,json,pathlib,re,stat,subprocess,sys,hashlib,urllib.request,urllib.error
EXECUTE=False
BRANCH='refs/heads/ops/pr-1025-readonly-20261028'
ROOT=pathlib.Path('/opt/rr-portal')
PREPARE=ROOT/'deploy/backups/pr1025-sprayplan-20261028-v2/prepare'
TARGET='9d942c021e3d307e89ad1a8ea1a2425199fced1b'
def read(path):
 if not path.exists():return None
 if any(p.is_symlink() for p in (path,*path.parents)):return None
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

def main():
 assert EXECUTE is True and sys.argv[1:]==['progress']and os.environ.get('RELEASE_MODE')=='progress'and os.environ.get('RELEASE_ATTEMPT')=='1'and os.environ.get('RELEASE_BRANCH')==BRANCH
 result={'phase':'progress','target':TARGET,'success':False,'readOnly':True,'atomicAcrossObservations':False}
 try:
  cache={}
  for label,name in [('before','build-cache-before.private.json'),('after','build-cache-after.private.json')]:
   v=read(PREPARE/name)
   if isinstance(v,dict)and type(v.get('availableBytes'))is int:
    cache[label+'FreeBytes']=v['availableBytes']
    if type(v.get('cachePruned'))is bool:cache['cachePruned']=v['cachePruned']
    root=v.get('dockerRoot')
    if type(root)is str and root.startswith('/')and '..'not in pathlib.PurePosixPath(root).parts and pathlib.Path(root).is_dir():
     fs=os.statvfs(root);cache['currentFreeBytes']=fs.f_frsize*fs.f_bavail
  result['cache']=cache
  p=cmd(['ps','-eo','comm,etimes']);processes={}
  for name,seconds in re.findall(r'^\s*(apt-get|dpkg|dotnet|node|docker|buildkitd|runc|http|https)\s+([0-9]+)\s*$',p.stdout.decode(),re.M):
   d=processes.setdefault(name,{'count':0,'maxElapsedSeconds':0});d['count']+=1;d['maxElapsedSeconds']=max(d['maxElapsedSeconds'],int(seconds))
  result['processes']=processes
  image=cmd(['docker','image','inspect','rr-portal-sprayplan:pr1025-r2-'+TARGET[:12]])
  result['candidateImagePresent']=image.returncode==0
  probe=cmd(['docker','ps','-aq','--filter','label=io.rr-portal.pr1025-r2-probe']);ids=probe.stdout.decode().split();result['privateProbeCount']=len(ids)
  result['sourceExtracted']=(PREPARE/'source/apps/喷油部/喷油排期系统/Dockerfile').is_file();result['preparedEvidencePresent']=(PREPARE/'prepared.private.json').is_file()
  result['success']=True
 except Exception as e:result['errorType']=type(e).__name__
 body=json.dumps(result,sort_keys=True,separators=(',',':')).encode();result['resultSHA256']=hashlib.sha256(body).hexdigest();result['sha256Wire']={'target':[int(c,16)for c in TARGET]}
 print(json.dumps(result,sort_keys=True),flush=True);return 0 if result['success']else 1
if __name__=='__main__':sys.exit(main())
