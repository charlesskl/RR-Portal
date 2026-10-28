"""Inert exact failed R2 evidence dedup; every path/body/owner/mode remains."""
import hashlib,json,os,pathlib,re,stat,subprocess,sys,collections
EXECUTE=False
TARGET='f22fbffa1789234fe1c78bf776f4dcb3fe867d0c'
BRANCH='refs/heads/ops/pr-1034-20261028-indo-static'
OUT=pathlib.Path('/opt/rr-portal/deploy/backups/pr1034-r2-evidence-dedup-1')
BASE=pathlib.Path('/opt/rr-portal/deploy/backups/pr1034-indo-static-20261028-r2/prepare')
ALIAS='rr-portal-indo-shipping:latest'
CANONICAL='sha256:79c441c8c2df6d6df6fcc475e865535c3ed5c4e884e56bcb1a2a772c5163b0a9'
MANIFEST='2e29909df4802c055e151c1bebacf2b91b44a08111ef670010fa50e1bf2efaf5'
FAILED='ef0978f322e5d3d9ede5bd1d06cf26bdd644b7233a85d9f23b842026d79b258f'
SERIAL=0
STAGE='entry'

def need(v,label):
 global STAGE
 STAGE=label
 if not v:raise RuntimeError(label)

def enc(v):return json.dumps(v,sort_keys=True,separators=(',',':'),ensure_ascii=True,allow_nan=False).encode()

def sha(v):return hashlib.sha256(v).hexdigest()

def private(path,body):
 fd=os.open(path,os.O_CREAT|os.O_EXCL|os.O_WRONLY|os.O_NOFOLLOW,0o600)
 with os.fdopen(fd,'wb')as f:f.write(enc(body));f.flush();os.fsync(f.fileno())

def command(args,allow_failure=False):
 global SERIAL
 SERIAL+=1;base=OUT/('%02d'%SERIAL);paths=[base.with_suffix(s)for s in('.stdout.private','.stderr.private')];files=[os.fdopen(os.open(p,os.O_CREAT|os.O_EXCL|os.O_WRONLY|os.O_NOFOLLOW,0o600),'wb')for p in paths]
 try:
  try:p=subprocess.run(args,stdout=files[0],stderr=files[1],timeout=120)
  finally:
   for f in files:f.flush();os.fsync(f.fileno())
 finally:
  for f in files:f.close()
 need(all(p.stat().st_size<=16*1024**2 for p in paths),'bounded-private-command-output');stdout,stderr=[p.read_bytes()for p in paths]
 need(allow_failure or p.returncode==0,'single-command-success-no-retry');return p.returncode,stdout,stderr

def run(args):return command(args)[1]

def runtime():
 ids=run(['docker','ps','-aq','--no-trunc']).decode().split();need(0<len(ids)<=1000 and len(ids)==len(set(ids))and all(re.fullmatch('[a-f0-9]{64}',x)for x in ids),'all-container-ids');rows=json.loads(run(['docker','inspect',*ids]));need(len(rows)==len(ids),'all-runtime-records');result={}
 for r in rows:
  result[r['Id']]={'image':r['Image'],'config':r['Config'],'hostConfig':r['HostConfig'],'mounts':sorted(r['Mounts'],key=enc),'pid':r['State']['Pid'],'started':r['State']['StartedAt'],'restarts':r['RestartCount'],'running':r['State']['Running'],'oom':r['State']['OOMKilled'],'health':r['State'].get('Health',{}).get('Status')}
 need(set(result)==set(ids),'complete-runtime-inventory');return result

def alias_guard():need(json.loads(run(['docker','image','inspect','--format','{{json .Id}}',ALIAS]))==CANONICAL,'canonical-live79c-unchanged')

def available(root):
 s=os.statvfs(root);return {'available':s.f_bavail*s.f_frsize,'free':s.f_bfree*s.f_frsize,'total':s.f_blocks*s.f_frsize}

def content(p):
 need(p.is_file()and not any(x.is_symlink()for x in(p,*p.parents)),'own-regular-evidence-only');fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW)
 try:
  a=os.fstat(fd);need(stat.S_ISREG(a.st_mode)and a.st_size<=512*1024**2,'bounded-own-regular-file');h=hashlib.sha256();size=0
  while True:
   b=os.read(fd,1024**2)
   if not b:break
   h.update(b);size+=len(b)
  z=os.fstat(fd);sig=lambda s:(s.st_dev,s.st_ino,s.st_uid,s.st_gid,s.st_mode,s.st_size,s.st_mtime_ns,s.st_ctime_ns,s.st_nlink);need(sig(a)==sig(z)==sig(p.lstat())and size==a.st_size,'stable-owned-file-read');attrs=tuple((n,sha(os.getxattr(p,n,follow_symlinks=False)))for n in sorted(os.listxattr(p,follow_symlinks=False)));return a,h.hexdigest(),attrs
 finally:os.close(fd)

def inventory(mf):
 entries=list(BASE.rglob('*'));need(all(not p.is_symlink()and(stat.S_ISREG(p.lstat().st_mode)or stat.S_ISDIR(p.lstat().st_mode))for p in entries),'no-symlink-or-special-evidence-entry');actual={p.relative_to(BASE).as_posix()for p in entries if p.is_file()};need(actual==set(mf)|{'manifest.json','result.private.json'},'same-complete-sealed-evidence-file-set');result={};inodes=collections.Counter();total=0
 for name,digest in mf.items():
  q=pathlib.PurePosixPath(name);need(str(q)==name and not q.is_absolute()and'..'not in q.parts and chr(92)not in name,'safe-own-evidence-path');a,h,x=content(BASE/name);need(h==digest,'sealed-every-evidence-byte-sha');result[name]=(a,h,x);inodes[(a.st_dev,a.st_ino)]+=1;total+=a.st_size
 need(len(result)<100000 and total<3*1024**3,'bounded-owned-evidence-tree')
 for a,_,_ in result.values():need(a.st_nlink==inodes[(a.st_dev,a.st_ino)],'no-existing-hardlink-outside-fixed-failed-phase')
 return result

def allocated(rows):return sum(a.st_blocks*512 for a in{(r[0].st_dev,r[0].st_ino):r[0]for r in rows.values()}.values())
def stable(before):
 need(run(['git','-C','/opt/rr-portal','rev-parse','HEAD']).decode().strip()==TARGET,'same-host-source');need(runtime()==before,'all-runtime-fields-still-exact');alias_guard()

def main():
 need(EXECUTE is True and sys.argv[1:]==['dedup']and os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_MODE')=='dedup'and os.environ.get('RELEASE_ATTEMPT')=='1','inert-first-evidence-dedup');os.umask(0o077);need(OUT.parent.is_dir()and not OUT.exists()and not OUT.is_symlink(),'fresh-own-dedup-output');OUT.mkdir(mode=0o700);v={'phase':'dedup','target':TARGET,'success':False,'businessOrLiveFilesOperated':False,'bodyPermissionsOwnersAndAllLogicalPathsPreserved':False,'memberOriginalTimesRecordedPrivately':True,'automaticMutationRetry':False,'changedPaths':0}
 try:
  need(not any(p.is_symlink()for p in(BASE,*BASE.parents)),'fixed-real-failed-phase');need(sha((BASE/'manifest.json').read_bytes())==MANIFEST and sha((BASE/'result.private.json').read_bytes())==FAILED,'fixed-failed-r2-seals');mf=json.loads((BASE/'manifest.json').read_bytes());fail=json.loads((BASE/'result.private.json').read_bytes());need(fail['success']is False and fail['target']==TARGET and fail['stage']=='frontend-three-gib-user-and-ten-gib-physical-free'and'docker-space-after.private.json'in mf,'only-confirmed-failed-after-complete-build');before=runtime();private(OUT/'runtime-before.private.json',before);stable(before);old=inventory(mf);v['spaceBefore']=available('/var/lib/docker');v['allocatedBefore']=allocated(old);groups=collections.defaultdict(list)
  for name,(a,h,x)in old.items():groups[(a.st_dev,a.st_uid,a.st_gid,a.st_mode,a.st_size,h,x)].append(name)
  fd=os.open(OUT/'actions.private.jsonl',os.O_CREAT|os.O_EXCL|os.O_WRONLY|os.O_NOFOLLOW,0o600)
  with os.fdopen(fd,'wb')as log:
   for key,names in sorted(groups.items(),key=lambda z:sorted(z[1])[0]):
    names=sorted(names);canon=BASE/names[0]
    for name in names[1:]:
     member=BASE/name;ca,ch,cx=content(canon);ma,mh,mx=content(member);need((ca.st_dev,ca.st_uid,ca.st_gid,ca.st_mode,ca.st_size,ch,cx)==key and(ma.st_dev,ma.st_uid,ma.st_gid,ma.st_mode,ma.st_size,mh,mx)==key,'same-content-owner-mode-and-xattr-group')
     if(ca.st_dev,ca.st_ino)==(ma.st_dev,ma.st_ino):continue
     intent={'path':name,'canonical':names[0],'sha256':ch,'bytes':ma.st_size,'uid':ma.st_uid,'gid':ma.st_gid,'mode':ma.st_mode,'oldMtimeNs':ma.st_mtime_ns,'oldCtimeNs':ma.st_ctime_ns,'canonicalMtimeNs':ca.st_mtime_ns};log.write(enc(intent)+b'\n');log.flush();os.fsync(log.fileno());tmp=member.with_name(member.name+'.pr1034-own-dedup-link');need(not tmp.exists()and not tmp.is_symlink(),'fresh-own-link-temp')
     try:
      os.link(canon,tmp,follow_symlinks=False);cr,ch2,cx2=content(canon);need((cr.st_dev,cr.st_uid,cr.st_gid,cr.st_mode,cr.st_size,ch2,cx2)==key and(tmp.stat().st_dev,tmp.stat().st_ino)==(cr.st_dev,cr.st_ino),'exact-stable-new-hardlink');current=member.lstat();signature=lambda z:(z.st_dev,z.st_ino,z.st_uid,z.st_gid,z.st_mode,z.st_size,z.st_mtime_ns,z.st_ctime_ns,z.st_nlink);need(signature(current)==signature(ma),'exact-member-cas-before-replace');os.replace(tmp,member);d=os.open(member.parent,os.O_RDONLY|os.O_DIRECTORY);os.fsync(d);os.close(d);v['changedPaths']+=1
     finally:
      if tmp.exists():need(tmp.stat().st_ino==canon.stat().st_ino,'remove-only-own-temporary-link');tmp.unlink()
  after=inventory(mf);need(all((a.st_uid,a.st_gid,a.st_mode,a.st_size,h,x)==(after[n][0].st_uid,after[n][0].st_gid,after[n][0].st_mode,after[n][0].st_size,after[n][1],after[n][2])for n,(a,h,x)in old.items()),'all-body-permission-owner-xattr-byte-seals-unchanged');need(sha((BASE/'manifest.json').read_bytes())==MANIFEST and sha((BASE/'result.private.json').read_bytes())==FAILED,'failure-seals-still-exact');stable(before);private(OUT/'runtime-after.private.json',runtime());v.update(success=True,bodyPermissionsOwnersAndAllLogicalPathsPreserved=True,allocatedAfter=allocated(after),spaceAfter=available('/var/lib/docker'),originalManifestStillValid=True,originalFailurePreserved=True,reclaimedAllocatedBytes=v['allocatedBefore']-allocated(after),ordinaryThreeGiBReached=available('/var/lib/docker')['available']>=3221225472)
 except Exception as e:v.update(errorType=type(e).__name__,stage=STAGE,success=False)
 v['resultSHA256']=sha(enc(v));v['sha256Wire']={'target':[int(c,16)for c in TARGET]};private(OUT/'result.private.json',v);print(json.dumps(v,sort_keys=True),flush=True);return 0 if v['success']else 1
if __name__=='__main__':sys.exit(main())
