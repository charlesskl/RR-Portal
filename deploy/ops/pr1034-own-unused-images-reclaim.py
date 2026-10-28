"""INERT exact two-tag owned-unused cleanup. No force/prune/backups/SQL/replay."""
import hashlib,json,os,pathlib,re,subprocess,sys
EXECUTE=True
TARGET='f22fbffa1789234fe1c78bf776f4dcb3fe867d0c'
BRANCH='refs/heads/ops/pr-1034-20261028-indo-static'
OUT=pathlib.Path('/opt/rr-portal/deploy/backups/pr1034-own-unused-images-reclaim-1')
ALIAS='rr-portal-indo-shipping:latest'
CANONICAL='sha256:79c441c8c2df6d6df6fcc475e865535c3ed5c4e884e56bcb1a2a772c5163b0a9'
OWNED=(('rr-portal-indo-shipping:pr1027-r4-70590f6d0dc1','sha256:4a53226d75b0588eeb5b2f10af0e1c89c25cac2ab2dbb4a7f3cf3532871b3952',192368677),('rr-portal-indo-shipping:pr1027-r4-built-70590f6d0dc1','sha256:7f854a17437df370b8bf7a1fdc052bfe33b1303da7ee76909265d4d3bdfbb923',143251491))
GOAL=4*1024**3+128*1024**2
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
def candidate_guard(item,records):
 tag,iid,size=item;fmt='{"id":{{json .Id}},"tags":{{json .RepoTags}},"bytes":{{json .Size}}}';v=json.loads(run(['docker','image','inspect','--format',fmt,tag]));need(v=={'id':iid,'tags':[tag],'bytes':size},'exact-owned-unique-tag-image-and-byte-size');need(all(r['image']!=iid and r['config'].get('Image')!=tag for r in records.values()),'no-running-or-stopped-container-image-or-tag-reference')
def available(root):
 s=os.statvfs(root);return {'available':s.f_bavail*s.f_frsize,'free':s.f_bfree*s.f_frsize,'total':s.f_blocks*s.f_frsize}
def cache_observation():
 blob=b''
 try:
  rc,blob,_=command(['docker','buildx','du','--format=json'],True)
  if rc:return {'available':False,'exitCode':rc}
  try:data=json.loads(blob);rows=data if type(data)is list else[data]
  except ValueError:rows=[json.loads(x)for x in blob.splitlines()]
  need(len(rows)<=100000,'bounded-cache-records');selected=[]
  for x in rows:
   desc=x.get('Description',x.get('description',x.get('desc')));iid=x.get('ID',x.get('id'));size=x.get('Size',x.get('size'))
   if type(desc)is not str or'COPY --chown=app:app wwwroot/ /app/wwwroot/'not in desc:continue
   need(type(iid)is str and re.fullmatch('[a-zA-Z0-9]{12,128}',iid),'public-cache-id');number=int(size)if type(size)is str and 0<len(size)<=24 and size.isdecimal()else size;v={'id':iid,'description':'COPY --chown=app:app wwwroot/ /app/wwwroot/','bytes':number if type(number)is int and number>=0 else None}
   for public,upper,lower in(('reclaimable','Reclaimable','reclaimable'),('shared','Shared','shared'),('mutable','Mutable','mutable')):
    value=x.get(upper,x.get(lower));v[public]=value if type(value)is bool else None
   selected.append(v)
  return {'available':True,'matchingRecords':selected,'rawMetadataSHA256':sha(blob),'noCachePrunePerformed':True}
 except Exception as e:return {'available':False,'errorType':type(e).__name__,'rawMetadataSHA256':sha(blob)}

def main():
 need(EXECUTE is True and sys.argv[1:]==['reclaim']and os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_MODE')=='reclaim'and os.environ.get('RELEASE_ATTEMPT')=='1','inert-first-owned-image-cleanup')
 os.umask(0o077);need(OUT.parent.is_dir()and not OUT.parent.is_symlink()and not OUT.exists()and not OUT.is_symlink(),'fresh-single-attempt-private-output');OUT.mkdir(mode=0o700);v={'phase':'reclaim','target':TARGET,'success':False,'noForceNoPruneNoBackupDeletes':True,'automaticRetryPerformed':False,'tagActions':[]}
 try:
  need(run(['git','-C','/opt/rr-portal','rev-parse','HEAD']).decode().strip()==TARGET,'reviewed-host-source-before-resource-reclaim')
  root=json.loads(run(['docker','info','--format','{{json .DockerRootDir}}']));need(type(root)is str and root.startswith('/')and len(root)<4096,'bounded-docker-root');v['beforeSpace']=available(root);before=runtime();private(OUT/'runtime-before.private.json',before);alias_guard()
  for item in OWNED:candidate_guard(item,before)
  for index,item in enumerate(OWNED,1):
   if index==2 and available(root)['available']>=GOAL:v['secondTagSkippedGoalAlreadyReached']=True;break
   now=runtime();need(now==before,'all-original-runtime-fields-still-exact-before-delete');alias_guard();candidate_guard(item,now);tag,iid,size=item;private(OUT/('delete-%d.intent.private.json'%index),{'tag':tag,'id':iid,'bytes':size});action={'tag':tag,'id':iid,'beforeSpace':available(root),'deleteAttempted':True};v['tagActions'].append(action)
   run(['docker','image','rm','--no-prune',tag]);rc,_,stderr=command(['docker','image','inspect','--format','{{json .Id}}',tag],True);need(rc!=0 and(b'No such image'in stderr or b'No such object'in stderr),'exact-tag-absent-after-single-delete');action.update(tagAbsent=True,afterSpace=available(root));need(runtime()==before,'all-runtime-config-hostconfig-mounts-pid-start-restarts-health-exact');alias_guard()
  v['afterSpace']=available(root);v['freeSpaceGoalReached']=v['afterSpace']['available']>=GOAL;private(OUT/'runtime-after.private.json',runtime());need(runtime()==before,'final-runtime-exact');alias_guard();v.update(runtimeAndCanonicalAliasUnchanged=True,success=True)
  if not v['freeSpaceGoalReached']:v['cacheObservation']=cache_observation()
 except Exception as e:v.update(errorType=type(e).__name__,stage=STAGE,success=False)
 v['resultSHA256']=sha(enc(v));v['sha256Wire']={'target':[int(c,16)for c in TARGET]};private(OUT/'result.private.json',v);print(json.dumps(v,sort_keys=True),flush=True);return 0 if v['success']else 1
if __name__=='__main__':sys.exit(main())
