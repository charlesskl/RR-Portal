"""INERT exact fixed-ID nonshared reclaimable BuildKit cache cleanup only."""
import hashlib,json,os,pathlib,re,subprocess,sys
EXECUTE=False
TARGET='f22fbffa1789234fe1c78bf776f4dcb3fe867d0c'
BRANCH='refs/heads/ops/pr-1034-20261028-indo-static'
OUT=pathlib.Path('/opt/rr-portal/deploy/backups/pr1034-own-cache-reclaim-1')
ALIAS='rr-portal-indo-shipping:latest'
CANONICAL='sha256:79c441c8c2df6d6df6fcc475e865535c3ed5c4e884e56bcb1a2a772c5163b0a9'
CACHE_IDS=('vhn806od8wrtjw8lour5vxofx','oonfp10add9wcqie14053g9t0','yxt7rvhlsj5en2hsnak2ss2lz')
DESCRIPTION='COPY --chown=app:app wwwroot/ /app/wwwroot/'
GOAL=4*1024**3+64*1024**2
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

def tagged_images():
 rows=[json.loads(x)for x in run(['docker','image','ls','--no-trunc','--format','json']).splitlines()];need(len(rows)<=10000,'bounded-all-tagged-image-inventory');result={}
 for x in rows:
  if x['Repository']=='<none>'or x['Tag']=='<none>':continue
  tag=x['Repository']+':'+x['Tag'];iid=x['ID'];need(re.fullmatch('sha256:[a-f0-9]{64}',iid)is not None and(tag not in result or result[tag]==iid),'typed-unique-registered-tag-mapping');result[tag]=iid
 return result

def cache_records():
 blob=run(['docker','buildx','du','--format=json'])
 try:data=json.loads(blob);rows=data if type(data)is list else[data]
 except ValueError:rows=[json.loads(x)for x in blob.splitlines()]
 need(len(rows)<=100000,'bounded-buildcache-records');result={}
 for x in rows:
  iid=x.get('ID',x.get('id'))
  if iid not in CACHE_IDS:continue
  need(iid not in result,'one-record-per-fixed-cache-id');result[iid]=x
 return result

def cache_guard(iid,records):
 need(iid in CACHE_IDS and iid in records,'fixed-owned-cache-record-present');x=records[iid];desc=x.get('Description',x.get('description',x.get('desc')))
 need(type(desc)is str and DESCRIPTION in desc and x.get('Reclaimable',x.get('reclaimable'))is True and x.get('Shared',x.get('shared'))is False and x.get('Mutable',x.get('mutable'))is False,'exact-public-copy-reclaimable-nonshared-immutable-cache-only')
 size=x.get('Size',x.get('size'));number=int(size)if type(size)is str and len(size)<=24 and size.isdecimal()else size
 return {'id':iid,'description':DESCRIPTION,'reclaimable':True,'shared':False,'mutable':False,'bytes':number if type(number)is int and number>=0 else None}

def stable(before,images):
 need(run(['git','-C','/opt/rr-portal','rev-parse','HEAD']).decode().strip()==TARGET,'fixed-reviewed-host-head');need(runtime()==before,'all-runtime-config-hostconfig-mounts-pid-start-restarts-health-exact');need(tagged_images()==images,'all-existing-image-tag-to-id-mappings-exact');alias_guard()

def main():
 need(EXECUTE is True and sys.argv[1:]==['reclaim']and os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_MODE')=='reclaim'and os.environ.get('RELEASE_ATTEMPT')=='1','inert-first-exact-cache-cleanup')
 os.umask(0o077);need(OUT.parent.is_dir()and not OUT.parent.is_symlink()and not OUT.exists()and not OUT.is_symlink(),'fresh-single-attempt-cache-output');OUT.mkdir(mode=0o700);v={'phase':'reclaim','kind':'exact-buildcache-ids','target':TARGET,'success':False,'noImageTagContainerVolumeBackupOrSqlMutations':True,'genericPrunePerformed':False,'automaticRetryPerformed':False,'cacheActions':[],'actualRemovedIDs':[]}
 try:
  root=json.loads(run(['docker','info','--format','{{json .DockerRootDir}}']));need(type(root)is str and root.startswith('/')and len(root)<4096,'bounded-docker-root');before=runtime();images=tagged_images();private(OUT/'runtime-before.private.json',before);private(OUT/'tagged-images-before.private.json',images);stable(before,images);v['beforeSpace']=available(root)
  records=cache_records()
  for iid in CACHE_IDS:cache_guard(iid,records)
  for index,iid in enumerate(CACHE_IDS,1):
   if available(root)['available']>=GOAL:break
   stable(before,images);current=cache_records()
   if iid not in current:v['cacheActions'].append({'id':iid,'alreadyAbsentNoMutation':True});continue
   proof=cache_guard(iid,current);private(OUT/('cache-%d.intent.private.json'%index),proof);action={'id':iid,'deleteAttempted':True,'beforeSpace':available(root)};v['cacheActions'].append(action)
   run(['docker','buildx','prune','--force','--filter','id='+iid,'--filter','shared=false']);after=cache_records();removed=[x for x in CACHE_IDS if x in current and x not in after];action.update(observedRemovedIDs=removed,afterSpace=available(root));v['actualRemovedIDs']=sorted(set(v['actualRemovedIDs'])|set(removed));stable(before,images)
  v['afterSpace']=available(root);v['freeSpaceGoalReached']=v['afterSpace']['available']>=GOAL;stable(before,images);after_runtime=runtime();after_tags=tagged_images();need(after_runtime==before and after_tags==images,'stored-after-runtime-and-tags-exact');alias_guard();private(OUT/'runtime-after.private.json',after_runtime);private(OUT/'tagged-images-after.private.json',after_tags);v.update(allRuntimeAndExistingTaggedImagesAndCanonicalUnchanged=True,taggedImageMappingSHA256=sha(enc(images)),success=True)
 except Exception as e:v.update(errorType=type(e).__name__,stage=STAGE,success=False)
 v['resultSHA256']=sha(enc(v));v['sha256Wire']={'target':[int(c,16)for c in TARGET]};private(OUT/'result.private.json',v);print(json.dumps(v,sort_keys=True),flush=True);return 0 if v['success']else 1
if __name__=='__main__':sys.exit(main())
