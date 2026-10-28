"""Inert readonly exact space/Docker summary and fixed-task image reference scan."""
import hashlib,json,os,pathlib,re,stat,subprocess,sys
EXECUTE=False
TARGET='f22fbffa1789234fe1c78bf776f4dcb3fe867d0c'
BRANCH='refs/heads/ops/pr-1034-20261028-indo-static'
PREPARE=pathlib.Path('/opt/rr-portal/deploy/backups/pr1034-indo-static-20261028/prepare')
OUT=pathlib.Path('/opt/rr-portal/deploy/backups/pr1034-disk-observation-1')
MANIFEST_SHA256='3c81f3c3611bc11372ccb519e0591b7b7a0c0c7f55d3fad6f55509587ab9e863'
FAILED_SHA256='4f3ac9b0ac9fee4657464ee222686e6e3edd94ca51faf460d3276c5bd13b912a'
SERIAL=0
STAGE='entry'
PUBLIC_REPOS={'rrportal-indo-pr1023','rrportal-indo-pr1023-frontend','rrportal-indo-pr1023-backend','rrportal-indo-pr1027','rrportal-indo-pr1027-frontend','rrportal-indo-pr1027-backend','rrportal-indo-batch1027','rrportal-indo-batch1027-frontend','rrportal-indo-batch1027-backend','rrportal-indo-pr1034','rrportal-indo-pr1034-frontend','rrportal-indo-pr1034-backend','rrportal-quote-pr1028','rrportal-quote-pr1028-base','rrportal-quote-pr1028-r2','rrportal-quote-pr1028-r2-base'}
def need(v,label):
 global STAGE
 STAGE=label
 if not v:raise RuntimeError(label)
def enc(v):return json.dumps(v,sort_keys=True,separators=(',',':'),ensure_ascii=True,allow_nan=False).encode()
def sha(v):return hashlib.sha256(v).hexdigest()
def image_id(v):return type(v)is str and re.fullmatch('sha256:[a-f0-9]{64}',v)is not None
def private(path,body):
 fd=os.open(path,os.O_CREAT|os.O_EXCL|os.O_WRONLY|os.O_NOFOLLOW,0o600)
 with os.fdopen(fd,'wb')as f:f.write(body);f.flush();os.fsync(f.fileno())
def raw(path,limit):
 need(not any(p.is_symlink()for p in(path,*path.parents))and path.is_file(),'regular-selected-sealed-evidence');a=path.stat();need(a.st_mode&0o077==0 and a.st_size<=limit,'private-bounded-selected-evidence');body=path.read_bytes();z=path.stat();need((a.st_dev,a.st_ino,a.st_size,a.st_mtime_ns,a.st_ctime_ns)==(z.st_dev,z.st_ino,z.st_size,z.st_mtime_ns,z.st_ctime_ns)and len(body)==a.st_size,'stable-selected-evidence');return body
def command(args,limit=8*1024**2):
 global SERIAL
 SERIAL+=1;base=OUT/('%02d'%SERIAL);paths=[base.with_suffix(s)for s in('.stdout.private','.stderr.private')];files=[os.fdopen(os.open(p,os.O_CREAT|os.O_EXCL|os.O_WRONLY|os.O_NOFOLLOW,0o600),'wb')for p in paths]
 try:
  try:p=subprocess.run(args,stdout=files[0],stderr=files[1],timeout=60)
  finally:
   for f in files:f.flush();os.fsync(f.fileno())
 finally:
  for f in files:f.close()
 need(p.returncode==0 and paths[0].stat().st_size<=limit,'successful-bounded-readonly-command');return paths[0].read_bytes()
def candidate(repo,tag):
 if type(repo)is not str or type(tag)is not str:return False
 return repo in PUBLIC_REPOS and re.fullmatch('[a-f0-9]{12,64}',tag)is not None or repo=='rr-portal-indo-shipping'and re.fullmatch(r'pr1027(?:-r[2-5])?(?:-built)?-[a-f0-9]{12}',tag)is not None or repo=='rr-portal-sprayplan'and re.fullmatch(r'pr1031(?:-r[2-9])?-[a-f0-9]{12}',tag)is not None

def df_summary(blob):
 rows=[]
 for line in blob.splitlines():
  x=json.loads(line);need(x.get('Type')in('Images','Containers','Local Volumes','Build Cache'),'known-docker-summary-type');v={'type':x['Type']}
  for key in('TotalCount','Active'):
   value=str(x[key]);need(re.fullmatch('[0-9]{1,12}',value)is not None,'typed-docker-summary-count');v[key]=int(value)
  for key in('Size','Reclaimable'):
   value=x[key];need(type(value)is str and re.fullmatch(r'[0-9]+(?:\.[0-9]+)?\s*(?:B|kB|KB|MB|GB|TB|KiB|MiB|GiB|TiB)(?:\s+\([0-9]+%\))?',value)is not None,'typed-docker-summary-size');v[key]=value
  rows.append(v)
 need(len(rows)<=8,'bounded-summary-row-count');return rows

def main():
 need(EXECUTE is True and sys.argv[1:]==['diagnose']and os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_MODE')=='diagnose'and os.environ.get('RELEASE_ATTEMPT')=='1','inert-first-readonly-disk-observation')
 os.umask(0o077);need(OUT.parent.is_dir()and not OUT.parent.is_symlink()and not OUT.exists()and not OUT.is_symlink(),'fresh-own-private-output');OUT.mkdir(mode=0o700);v={'phase':'diagnose','target':TARGET,'success':False,'readOnly':True,'pruneDeleteOrLifecycleUsed':False,'envKeyringOrSQLRead':False,'archiveRecursiveScanPerformed':False,'imageSizesAreSharedLayerTotalsNotGuaranteedReclaimBytes':True}
 try:
  manifest=raw(PREPARE/'manifest.json',16*1024**2);failed=raw(PREPARE/'result.private.json',16*1024**2);need(sha(manifest)==MANIFEST_SHA256 and sha(failed)==FAILED_SHA256,'fixed-early-space-failure-seals');mf=json.loads(manifest);failure=json.loads(failed);need(failure['success']is False and failure['stage']=='four-gib-free-no-prune'and failure['phase']=='prepare'and failure['target']==TARGET,'fixed-no-build-space-failure')
  name='docker-space.private.json';body=raw(PREPARE/name,8192);need(name in mf and sha(body)==mf[name],'selected-failed-space-byte-seal');space=json.loads(body);need(set(space)=={'root','available'}and type(space['root'])is str and space['root'].startswith('/')and len(space['root'])<4096 and type(space['available'])is int and space['available']>=0,'typed-failed-space');s=os.statvfs(space['root']);v.update(failedSpace=space,currentSpace={'available':s.f_bavail*s.f_frsize,'free':s.f_bfree*s.f_frsize,'total':s.f_blocks*s.f_frsize})
  v['dockerSummary']=df_summary(command(['docker','system','df','--format','{{json .}}']));rows=[json.loads(x)for x in command(['docker','image','ls','--no-trunc','--format','json']).splitlines()];need(len(rows)<=10000,'bounded-image-inventory');chosen={};alltags={}
  for x in rows:
   iid=x['ID'];need(image_id(iid),'full-image-ls-id');tag=x['Repository']+':'+x['Tag'];alltags.setdefault(iid,set()).add(tag)
   if candidate(x['Repository'],x['Tag']):chosen.setdefault(iid,set()).add(tag)
  ids=command(['docker','ps','-aq','--no-trunc']).decode().split();need(0<len(ids)<=1000 and all(re.fullmatch('[a-f0-9]{64}',x)for x in ids),'bounded-all-container-ids');fmt='{"image":{{json .Image}},"configImage":{{json .Config.Image}}}';refs=[json.loads(x)for x in command(['docker','inspect','--format',fmt,*ids]).splitlines()];need(len(refs)==len(ids)and all(image_id(x['image'])and type(x['configImage'])is str for x in refs),'typed-minimal-container-image-refs');need(len(chosen)<=256,'bounded-fixed-task-candidate-images');v['candidateImages']=[]
  for iid,tags in sorted(chosen.items()):
   size=json.loads(command(['docker','image','inspect','--format','{{json .Size}}',iid],4096));need(type(size)is int and size>=0,'exact-image-byte-size');direct=sum(x['image']==iid for x in refs);named=sum(x['configImage']in tags for x in refs);v['candidateImages'].append({'id':iid,'tags':sorted(tags),'bytes':size,'referencedByAnyContainer':bool(direct or named),'immutableImageRefCount':direct,'configuredTagRefCount':named,'otherUnlistedTagCount':len(alltags[iid]-tags)})
  v.update(totalImageRowCount=len(rows),containerCount=len(ids),success=True)
 except Exception as e:v.update(errorType=type(e).__name__,stage=STAGE)
 v['resultSHA256']=sha(enc(v));v['sha256Wire']={'target':[int(c,16)for c in TARGET]};private(OUT/'result.private.json',enc(v));print(json.dumps(v,sort_keys=True),flush=True);return 0 if v['success']else 1
if __name__=='__main__':sys.exit(main())
