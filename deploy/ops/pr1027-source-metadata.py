"""Inert sealed public-label/index-mtime observation; no Docker/SQL/log/data access."""
import os,json,pathlib,re,stat,sys,hashlib,io,tarfile
EXECUTE=False
BRANCH='refs/heads/ops/pr-1027-clone-diagnostic-20261028'
ROOT=pathlib.Path('/opt/rr-portal')
PREPARE=ROOT/'deploy/backups/pr1027-1029-indo-20261028-r3/prepare'
OUT=ROOT/'deploy/backups/pr1027-r3-source-metadata-1'
TARGET='dc7d673dfe1d441e97550c6c7d42901b3e0322ff'
FAILED_TARGET='14f2dfcc6b9a189242fc4e56ed71864cd484ff3b'
MANIFEST_SHA256='a31be86c6ce4db0a58ac14c9095dfcd86dea8d17c1acff9e184dd9f0637552bd'
RESULT_SHA256='788dfd5bc902e8e1fa6c8c6ea9d6d51f3f53e7ff921a65b310ebeb41154c3408'
LIVE_CID='f77670c58a5e8022b048d7daa17aeb55740d14eb31e85cee8cb6e8f17aafeba8'
ACCEPTED='sha256:7a1a2d6ce470ef66fcb83cc2c5216ffe6748915e0a48938c92540438c61a7a4d'
OBSERVED='sha256:cb683bf7689f8562866c3e9277eaff0afea044a397c1ee65f12a55492d363853'
def need(v,label):
 if not v:raise RuntimeError(label)
def enc(v):return json.dumps(v,sort_keys=True,separators=(',',':'),ensure_ascii=True,allow_nan=False).encode()
def sha(v):return hashlib.sha256(v).hexdigest()
def raw(p,limit):
 need(not any(x.is_symlink()for x in(p,*p.parents)),'real-fixed-static-evidence');fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW)
 try:
  a=os.fstat(fd);need(stat.S_ISREG(a.st_mode)and a.st_mode&0o077==0 and 0<=a.st_size<=limit,'bounded-private-evidence');chunks=[];size=0
  while True:
   b=os.read(fd,1024**2)
   if not b:break
   chunks.append(b);size+=len(b);need(size<=limit,'bounded-read')
  value=b''.join(chunks);z=os.fstat(fd);key=lambda s:(s.st_dev,s.st_ino,s.st_mode,s.st_uid,s.st_gid,s.st_size,s.st_mtime_ns,s.st_ctime_ns)
  need(key(a)==key(z)==key(p.lstat())and len(value)==a.st_size,'stable-static-evidence');return value
 finally:os.close(fd)
def public_metadata(v):
 need(v['Id']==OBSERVED and type(v.get('Created'))is str and re.fullmatch('[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:[.][0-9]{1,9})?(?:Z|[+-][0-9]{2}:[0-9]{2})',v['Created']),'typed-observed-image-public-metadata')
 labels=v.get('Config',{}).get('Labels')or{};safe={}
 for name,pattern in(('org.opencontainers.image.revision','[a-f0-9]{40}'),('io.rr-portal.frontend-app-tree','[a-f0-9]{40}'),('io.rr-portal.backend-image','sha256:[a-f0-9]{64}')):
  value=labels.get(name);valid=type(value)is str and re.fullmatch(pattern,value)is not None
  safe[name]={'present':value is not None,'valid':valid,'value':value if valid else None}
 return {'id':v['Id'],'created':v['Created'],'publicLabels':safe}
def index_mtime(blob):
 with tarfile.open(fileobj=io.BytesIO(blob),mode='r:')as archive:
  members=archive.getmembers();need(1<=len(members)<=5000,'bounded-tar-metadata');need(all((m.isfile()or m.isdir())and not m.name.startswith('/')and'..'not in pathlib.PurePosixPath(m.name).parts for m in members),'regular-relative-tar-members')
  matches=[m for m in members if m.name=='wwwroot/index.html'];need(len(matches)==1 and matches[0].isfile()and type(matches[0].mtime)in(int,float)and 0<=matches[0].mtime<=4102444800,'one-typed-index-mtime');return int(matches[0].mtime)
def main():
 need(EXECUTE is True and sys.argv[1:]==['diagnose']and os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_MODE')=='diagnose'and os.environ.get('RELEASE_ATTEMPT')=='1'and re.fullmatch('[a-f0-9]{40}',TARGET),'inert-first-observation')
 os.umask(0o077);need(OUT.parent.is_dir()and not OUT.parent.is_symlink()and not OUT.exists()and not OUT.is_symlink(),'fresh-own-private-output');OUT.mkdir(mode=0o700)
 result={'phase':'diagnose','target':TARGET,'sourceFailureTarget':FAILED_TARGET,'success':False,'readOnly':True,'sealedMetadataOnly':True,'dockerOrSqlUsed':False}
 try:
  m=raw(PREPARE/'manifest.json',16*1024**2);f=raw(PREPARE/'result.private.json',16*1024**2);need(sha(m)==MANIFEST_SHA256 and sha(f)==RESULT_SHA256,'fixed-r3-failure-seals');manifest=json.loads(m);failure=json.loads(f);need(failure['success']is False and failure['target']==FAILED_TARGET,'fixed-failed-source-context')
  n='observed-canonical-alias-image.private.json';body=raw(PREPARE/n,4*1024**2);need(n in manifest and sha(body)==manifest[n],'selected-observed-image-json-byte-seal');result['observedImage']=public_metadata(json.loads(body))
  tars=[n for n in manifest if n.startswith('runtime-source-')and n.endswith('.private.tar')];need(len(tars)==2,'only-two-fixed-source-tars');total=0;result['indexMtime']={}
  for label,cid in(('live',LIVE_CID),('accepted',ACCEPTED)):
   names=[n for n in tars if re.fullmatch(re.escape('runtime-source-'+cid[:12]+'-')+'[0-9]+[.]private[.]tar',n)];need(len(names)==1,'one-exact-full-id-prefix');n=names[0];body=raw(PREPARE/n,128*1024**2);total+=len(body);need(total<=256*1024**2 and sha(body)==manifest[n],'selected-tar-byte-seals-and-budget');result['indexMtime'][label]=index_mtime(body)
  result['success']=True
 except Exception as e:result['errorType']=type(e).__name__
 result['resultSHA256']=sha(enc(result));result['sha256Wire']={'target':[int(c,16)for c in TARGET],'sourceFailureTarget':[int(c,16)for c in FAILED_TARGET]}
 fd=os.open(OUT/'result.private.json',os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
 with os.fdopen(fd,'wb')as output:output.write(enc(result));output.flush();os.fsync(output.fileno())
 print(json.dumps(result,sort_keys=True),flush=True);return 0 if result['success']else 1
if __name__=='__main__':sys.exit(main())
