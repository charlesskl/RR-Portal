"""INERT, one successful public-dist copy only. No live links, business data or cache cleanup."""
import ctypes,errno,hashlib,importlib.util,json,os,pathlib,re,stat,sys

EXECUTE=True
ROOT=pathlib.Path('/opt/rr-portal')
OUT=ROOT/'deploy/backups/pr1054-reclaim1053-public-1-20261102'
SOURCE=ROOT/'deploy/backups/pr1053-static-2-20261102/prepare/context/new-wwwroot'
R2=ROOT/'deploy/backups/pr1053-static-2-20261102'
BRANCH='refs/heads/codex/ops-pr1054-20261102'
HEAD='47dfe8800b60090476d1ea51b7d9c1b8ab66f0cf'
TARGET='114b5cc9867960518ebe70f6731475c97fec3747'
APP_TREE='61606ef0d93d366b71ce7b3a1ea0e9c136bd9610'
INDO_CID='58a9bc0a94611e21a4d8987edd85857fa3f53521ca649bafa3a166890cf3eb2a'
CANDIDATE='sha256:51b0e822e58671ff523f0212bae7a7f7593e1c46c2882418df0594374498f31f'
PINS={'prepare':'ec3db425b626a2d742fe1f52eaa184d098b068d935b8df121ac52f643a87766a',
      'deploy':'850293a8799431ee3a5abeeaa52f60b94f09a4143c83ebcf751b92ffd8f7574a',
      'verify':'a86ee40ce9ad4203d9cdd41072e2adf45ed3eb29b573c362ce1f626a52bce60b'}
D_FILE='pr1054-preflight.py'
D_SHA='ee2e6c388cc5f72a08c7a31824a5677f44089f39d592c7892a22c773c2cec171'
BUNDLE_REF='0e675d3c87ca20d1c728a86105b6328d801174bf:deploy/ops/pr1053-reviewed-dist.tar.gz'
BUNDLE_SHA='c8fbb4d4925de9c499a865b141f3df71a9e436b8b062e9c5f54117ccdd9685bf'
BUNDLE_BYTES=44903082
MANIFEST_SHA='e53befda643926130c720575f16bc6b51e5d6435bf1e89122a4a7098d9739257'
PUBLIC_BYTES=48379669
SOURCE_UID=0
SOURCE_GID=0
TOMB='public-dist.tombstone'
CODE=('IndoShipping.Api.dll','IndoShipping.Api.pdb','IndoShipping.Domain.dll','IndoShipping.Domain.pdb',
      'IndoShipping.Infrastructure.dll','IndoShipping.Infrastructure.pdb','seed/hs-dictionary.json','db/postgres_schema.sql')
D=None
STAGE='entry'
DISPOSITION={'state':'not-started','renameAttempted':False,'renameObserved':False,'renameAcknowledged':False,
             'deletionAttempted':False,'fileUnlinksObserved':0,'fileUnlinksAcknowledged':0,
             'automaticRetryOrRollbackPerformed':False,'safeNextAction':'read-only-reconcile-no-mutation-retry'}

def enc(v):return json.dumps(v,sort_keys=True,separators=(',',':'),ensure_ascii=True,allow_nan=False).encode()
def sha(b):return hashlib.sha256(b).hexdigest()
def need(v,label):
 global STAGE
 STAGE=label
 if not v:raise RuntimeError(label)
def private(name,value):D.private(name,value)
def checkpoint(name,**changes):
 value=dict(DISPOSITION,**changes);private('reclaim-'+name+'.private.json',value);DISPOSITION.update(changes)
def stamp(s):
 return {'device':s.st_dev,'inode':s.st_ino,'mode':stat.S_IMODE(s.st_mode),'uid':s.st_uid,'gid':s.st_gid,
         'links':s.st_nlink,'bytes':s.st_size,'mtimeNS':s.st_mtime_ns,'ctimeNS':s.st_ctime_ns,'allocatedBytes':s.st_blocks*512}
def same_identity(a,b):return all(a[k]==b[k]for k in('device','inode','mode','uid','gid'))
def directory(path):
 """Open every host path component without following symlinks; owned source/output only."""
 need(path.is_absolute()and '..'not in path.parts,'fixed-absolute-host-directory')
 fd=os.open('/',os.O_RDONLY|os.O_DIRECTORY)
 try:
  for part in path.parts[1:]:
   child=os.open(part,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=fd);os.close(fd);fd=child
  return fd
 except BaseException:os.close(fd);raise
def body_at(parent,name,limit=64*1024**2):
 before=os.stat(name,dir_fd=parent,follow_symlinks=False);need(stat.S_ISREG(before.st_mode)and before.st_size<=limit,'bounded-regular-public-file')
 fd=os.open(name,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK,dir_fd=parent)
 try:
  need(stamp(os.fstat(fd))==stamp(before),'named-opened-file-same-identity');h=hashlib.sha256();size=0
  while True:
   b=os.read(fd,1024**2)
   if not b:break
   size+=len(b);need(size<=limit,'bounded-public-file-stream');h.update(b)
  after=os.fstat(fd);need(stamp(before)==stamp(after)==stamp(os.stat(name,dir_fd=parent,follow_symlinks=False))and size==before.st_size,'public-file-stable-through-read')
  return {**stamp(before),'sha256':h.hexdigest(),'type':'file'}
 finally:os.close(fd)
def tree_fd(fd):
 rows={};count=0;size=0
 def walk(current,prefix):
  nonlocal count,size
  before=os.fstat(current);need(stat.S_ISDIR(before.st_mode),'real-public-directory');rows[prefix]={**stamp(before),'type':'dir'}
  names=sorted(os.listdir(current));need(len(names)<=1200,'bounded-public-directory-members')
  for name in names:
   count+=1;need(count<=1200 and name not in('.','..')and '/'not in name and '\\'not in name,'bounded-safe-public-member')
   key=(prefix+'/'if prefix else'')+name;s=os.stat(name,dir_fd=current,follow_symlinks=False)
   if stat.S_ISDIR(s.st_mode):
    child=os.open(name,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=current)
    try:
     need(stamp(os.fstat(child))==stamp(s),'directory-open-identity');walk(child,key);need(stamp(s)==stamp(os.stat(name,dir_fd=current,follow_symlinks=False)),'named-child-directory-stable')
    finally:os.close(child)
   else:
    need(stat.S_ISREG(s.st_mode),'no-public-symlink-or-special-file');rows[key]=body_at(current,name);size+=rows[key]['bytes'];need(size<=256*1024**2,'bounded-total-public-tree')
  need(stamp(before)==stamp(os.fstat(current))and names==sorted(os.listdir(current)),'public-directory-stable-during-inventory')
 walk(fd,'');return rows
def tree(path,host=False):
 fd=directory(path)if host else os.open(path,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
 try:return tree_fd(fd)
 finally:os.close(fd)
def read_json_body(path):
 parent=directory(path.parent)
 try:
  before=body_at(parent,path.name,4*1024**2);fd=os.open(path.name,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK,dir_fd=parent)
  try:
   opened=stamp(os.fstat(fd));need(opened=={k:before[k]for k in opened},'same-original-receipt-reopened');parts=[];size=0
   while True:
    b=os.read(fd,1024**2)
    if not b:break
    size+=len(b);need(size<=4*1024**2,'bounded-original-receipt-body');parts.append(b)
   raw=b''.join(parts);need(body_at(parent,path.name,4*1024**2)==before and sha(raw)==before['sha256']and size==before['bytes'],'same-original-receipt-stable-through-decode');return raw
  finally:os.close(fd)
 finally:os.close(parent)
def sealed(path,digest,phase):
 raw=read_json_body(path);need(sha(raw)==digest,'exact-1053-phase-body');v=json.loads(raw);c=dict(v);own=c.pop('resultSHA256',None)
 need(own==sha(enc(c))and v['success']is True and v['phase']==phase and v['target']==TARGET and v['sourceHead']==HEAD,'successful-self-sealed-same-1053-source');return v
def receipts():
 values={phase:sealed(R2/phase/'result.private.json',digest,phase)for phase,digest in PINS.items()}
 raw=read_json_body(R2/'prepare/prepared.private.json');need(sha(raw)==values['prepare']['preparedBodySHA256'],'original-prepared-plan-full-sha');plan=json.loads(raw)
 need(plan['sourceHead']==HEAD and plan['target']==TARGET and plan['appTree']==APP_TREE and plan['candidate']==CANDIDATE and plan['newBytes']==PUBLIC_BYTES,'same-reviewed-successfully-published-public-plan')
 need(values['deploy']['details']['candidate']==CANDIDATE and values['deploy']['details']['disposition']['state']=='live-and-durable-publication-verified'and values['verify']['details']['checks']['allOldNewAssetsAndThreeTemplates200AndExact']is True,'successful-live-durable-and-final-verified-release')
 m=plan['newStatic'];need(type(m)is dict and len(m)==60 and sha(enc(m))==MANIFEST_SHA and all(type(h)is str and re.fullmatch('[a-f0-9]{64}',h)for h in m.values()),'exact-reviewed60-public-dist-manifest')
 allowed=lambda n:n in('index.html','favicon.svg','icons.svg','template-customs.xlsx','template-customs-rri.xlsx','template-customs-rrm.xlsx')or re.fullmatch(r'assets/[A-Za-z0-9_.-]+\.(?:js|css)',n)is not None
 need(all(type(n)is str and allowed(n)for n in m),'only-known-rebuildable-public-files')
 need(set(plan['expectedBackend'])==set(CODE),'exact-original-backend-and-startup-sql-proof')
 return values,plan
def source_check(rows,manifest):
 files={n:r for n,r in rows.items()if r['type']=='file'};dirs={n for n,r in rows.items()if r['type']=='dir'}
 wanted={''}|{pathlib.PurePosixPath(n).parent.as_posix()for n in manifest if'/'in n}
 need(set(files)==set(manifest)and dirs==wanted,'no-extra-or-missing-source-files-or-directories')
 need(sum(r['bytes']for r in files.values())==PUBLIC_BYTES,'exact-sealed-logical-public-bytes')
 need(all(r['sha256']==manifest[n]and r['links']==1 and r['mode']==0o644 and r['uid']==SOURCE_UID and r['gid']==SOURCE_GID for n,r in files.items()),'all-source-hashes-owner-mode-and-single-link-real-copies')
 need(all(r['mode']==0o755 and r['uid']==SOURCE_UID and r['gid']==SOURCE_GID for n,r in rows.items()if r['type']=='dir'),'known-original-public-directory-owner-mode')
def protection(values,plan):
 runtime,engineering,nginx=D.runtime();need(runtime==values['deploy']['details']['runtime']['runtime'],'all46-original-runtime-still-equal1053-release')
 need(INDO_CID in runtime and runtime[INDO_CID]['running']and runtime[INDO_CID]['health']=='healthy','same-live-indo-container')
 pid=runtime[INDO_CID]['pid'];need(type(pid)is int and pid>0,'actual-existing-indo-pid');root=pathlib.Path('/proc')/str(pid)/'root/app';need(root.is_dir()and not root.is_symlink(),'trusted-process-app-root')
 live=tree(root/'wwwroot');files={n:r for n,r in live.items()if r['type']=='file'};expected={n:r['sha256']for n,r in plan['oldStatic'].items()};expected.update(plan['newStatic'])
 need(len(files)==465 and {n:r['sha256']for n,r in files.items()}==expected,'all465-live-static-resources-exact-old-and-new-union')
 backend={n:{**D.record(root/n,32*1024**2),**stamp((root/n).lstat())}for n in CODE};need(all(backend[n]['sha256']==h for n,h in plan['expectedBackend'].items()),'all-live-compiled-backend-seed-and-schema-exact')
 host=D.host();auth=D.auth(nginx);need(host==values['deploy']['details']['runtime']['host']and auth==values['deploy']['details']['runtime']['auth'],'host-and-auth-still-equal1053-successful-release')
 return {'runtime':runtime,'host':host,'auth':auth,'engineeringCanonical':D.image(D.CANONICAL,D.CANONICAL_ID),'indoCanonical':D.image(D.INDO_CANONICAL,CANDIDATE),'engineeringStatic':D.static(engineering,False),'indoStatic':live,'indoBackend':backend}
def move_noreplace(src_fd,src,dst_fd,dst):
 libc=ctypes.CDLL(None,use_errno=True)
 if sys.platform.startswith('linux'):fn=getattr(libc,'renameat2',None);flags=1
 elif sys.platform=='darwin':fn=getattr(libc,'renameatx_np',None);flags=4
 else:fn=None;flags=0
 need(fn is not None,'native-atomic-no-overwrite-rename-available');fn.argtypes=[ctypes.c_int,ctypes.c_char_p,ctypes.c_int,ctypes.c_char_p,ctypes.c_uint];fn.restype=ctypes.c_int
 if fn(src_fd,os.fsencode(src),dst_fd,os.fsencode(dst),flags)!=0:raise OSError(ctypes.get_errno(),'atomic-no-overwrite-rename-failed')
def check_renamed(before,after):
 need(set(before)==set(after),'same-entire-public-tree-after-own-rename')
 for name,row in before.items():
  actual=dict(after[name]);expected=dict(row)
  if name=='':need(actual['ctimeNS']>=expected['ctimeNS'],'own-renamed-root-ctime-monotonic');actual.pop('ctimeNS');expected.pop('ctimeNS')
  need(actual==expected,'all-copied-public-members-stable-before-unlink')
def remove_fd(parent,name,rows,prefix=''):
 fd=os.open(name,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=parent)
 try:
  need(same_identity(stamp(os.fstat(fd)),rows[prefix]),'owned-tombstone-directory-identity')
  members={p[len(prefix)+1:]if prefix else p:r for p,r in rows.items()if p and(pathlib.PurePosixPath(p).parent.as_posix()if'/'in p else'')==prefix}
  need(set(os.listdir(fd))==set(members),'only-planned-tombstone-members')
  for child,row in sorted(members.items()):
   relative=prefix+'/'+child if prefix else child
   if row['type']=='dir':remove_fd(fd,child,rows,relative)
   else:
    need(body_at(fd,child)==row,'exact-single-link-planned-file-immediately-before-unlink');os.unlink(child,dir_fd=fd);DISPOSITION['fileUnlinksObserved']+=1;os.fsync(fd)
    checkpoint('file-%03d-ack'%DISPOSITION['fileUnlinksObserved'],state='deleting-only-sealed-public-copy',fileUnlinksAcknowledged=DISPOSITION['fileUnlinksObserved'])
  need(not os.listdir(fd)and same_identity(stamp(os.fstat(fd)),rows[prefix]),'owned-planned-directory-empty-and-same-inode');os.rmdir(name,dir_fd=parent);os.fsync(parent)
 finally:os.close(fd)
def reclaim(source,rows):
 """Only this fixed-source caller supplies the plan. No retries, rollback, following links or glob deletion."""
 parent=directory(source.parent);out=directory(OUT)
 try:
  need(os.fstat(parent).st_dev==os.fstat(out).st_dev,'same-filesystem-atomic-public-move')
  need(tree(source,True)==rows,'entire-source-stat-and-hash-still-exact-before-intent')
  checkpoint('10-rename-intent',state='durable-intent-before-rename',renameAttempted=True)
  move_noreplace(parent,source.name,out,TOMB);DISPOSITION['renameObserved']=True;os.fsync(parent);os.fsync(out)
  checkpoint('11-rename-ack',state='public-copy-quarantined',renameAcknowledged=True)
  tomb_fd=os.open(TOMB,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=out)
  try:renamed=tree_fd(tomb_fd);check_renamed(rows,renamed)
  finally:os.close(tomb_fd)
  checkpoint('20-delete-intent',state='deleting-only-sealed-public-copy',deletionAttempted=True)
  remove_fd(out,TOMB,renamed);checkpoint('30-delete-ack',state='public-copy-deleted',allPlannedFilesRemoved=True)
 except BaseException:
  DISPOSITION['state']='partial-or-uncertain-readonly-reconcile-required';raise
 finally:os.close(out);os.close(parent)
def load():
 global D
 p=pathlib.Path(__file__).with_name(D_FILE);need(p.is_file()and not p.is_symlink()and sha(p.read_bytes())==D_SHA,'exact-reviewed-readonly1054-preflight-library')
 spec=importlib.util.spec_from_file_location('reclaim1054_preflight',p);D=importlib.util.module_from_spec(spec);spec.loader.exec_module(D);D.OUT=OUT
def main():
 need(EXECUTE is True and sys.argv[1:]==['maintain']and os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_MODE')=='maintain'and os.environ.get('RELEASE_ATTEMPT')=='1','inert-one-fixed-public-copy-reclaim')
 need(SOURCE==ROOT/'deploy/backups/pr1053-static-2-20261102/prepare/context/new-wwwroot','one-constant-source-no-live-stage-or-user-path')
 os.umask(0o077);need(OUT.parent.is_dir()and not any(p.is_symlink()for p in(OUT.parent,*OUT.parent.parents))and not OUT.exists(),'fresh-private-one-attempt-reclaim-archive');OUT.mkdir(mode=0o700)
 archive_parent=directory(OUT.parent)
 try:os.fsync(archive_parent)
 finally:os.close(archive_parent)
 load()
 result={'phase':'maintain','success':False,'businessDataWrites':False,'liveServiceWrites':False,'originalConfigurationWrites':False,'imageOrCacheCleanupPerformed':False}
 try:
  values,plan=receipts();before=protection(values,plan);space=D.capacity();need(space['available']>=1024**3+8*1024**2 and space['free']>=8*1024**3+8*1024**2,'original-capacity-floors-plus-bounded-reclaim-evidence')
  need(SOURCE.parent.stat().st_dev==pathlib.Path('/var/lib/docker').stat().st_dev,'source-on-same-filesystem-as-capacity-budget')
  public=D.command(['git','-c','core.hooksPath=/dev/null','show',BUNDLE_REF],limit=64*1024**2);public_bytes=len(public);need(public_bytes==BUNDLE_BYTES and sha(public)==BUNDLE_SHA,'retained-public-rebuild-tgz-reference-exact');del public
  rows=tree(SOURCE,True);source_check(rows,plan['newStatic']);private('original-public-deletion-plan.private.json',{'source':str(SOURCE),'manifest':plan['newStatic'],'rows':rows,'publicBundleGitRef':BUNDLE_REF,'publicBundleSHA256':BUNDLE_SHA,'publicBundleBytes':public_bytes,'logicalBytes':PUBLIC_BYTES,'estimatedAllocatedBytes':sum(r['allocatedBytes']for r in rows.values())});private('protected-before.private.json',before)
  siblings={p.name:{**D.record(p,1024**2),**stamp(p.lstat())}for p in SOURCE.parent.iterdir()if p.name!=SOURCE.name};need(set(siblings)=={'Dockerfile','new-schema.sql'},'only-known-public-context-siblings-preserved');private('context-siblings.private.json',siblings)
  need(before==protection(values,plan),'all-runtime-host-auth-canonicals-static-and-backend-stable-before-reclaim');reclaim(SOURCE,rows)
  need(not SOURCE.exists()and not SOURCE.is_symlink()and not(OUT/TOMB).exists(),'only-selected-public-copy-and-own-tombstone-removed')
  need(siblings=={p.name:{**D.record(p,1024**2),**stamp(p.lstat())}for p in SOURCE.parent.iterdir()},'all-other-original-context-files-unchanged')
  after=protection(values,plan);need(before==after,'all465-live-files-backend-original46-host-auth-two-canonicals-exact-after-unlink');need((values,plan)==receipts(),'all-original1053-phase-and-prepared-receipts-remain-exact');private('protected-after.private.json',after);after_space=D.capacity();need(after_space['available']>=1024**3 and after_space['free']>=8*1024**3,'original-disk-floors-still-preserved')
  checkpoint('40-complete',state='only-public-copy-reclaimed-all-protected-state-verified');result.update(success=True,filesRemoved=60,logicalBytesRemoved=PUBLIC_BYTES,estimatedAllocatedBytes=sum(r['allocatedBytes']for r in rows.values()),capacityBefore=space,capacityAfter=after_space,availableDeltaObserved=after_space['available']-space['available'],allProtectedStateExact=True,publicRebuildArtifactRetained=True,disposition=dict(DISPOSITION))
 except Exception as error:
  result.update(errorType=type(error).__name__,stage=STAGE,disposition=dict(DISPOSITION))
  try:private('failure-disposition.private.json',DISPOSITION)
  except Exception:pass
 result['resultSHA256']=sha(enc(result));private('result.private.json',result);D.wire(result);return 0 if result['success']else 1
if __name__=='__main__':sys.exit(main())
