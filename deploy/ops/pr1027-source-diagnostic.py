"""Inert static sealed-source TAR comparison for the fixed R3 prebuild failure.
No Docker, SQL, environment, logs, business data or lifecycle is accessed.
Only the new private diagnostic evidence directory is written.
"""
import os,json,pathlib,re,stat,sys,hashlib,tarfile,io,html.parser,urllib.parse
EXECUTE=True
BRANCH='refs/heads/ops/pr-1027-clone-diagnostic-20261028'
ROOT=pathlib.Path('/opt/rr-portal')
PREPARE=ROOT/'deploy/backups/pr1027-1029-indo-20261028-r3/prepare'
OUT=ROOT/'deploy/backups/pr1027-r3-source-diagnostic-1'
TARGET='14f2dfcc6b9a189242fc4e56ed71864cd484ff3b'
MANIFEST_SHA256='a31be86c6ce4db0a58ac14c9095dfcd86dea8d17c1acff9e184dd9f0637552bd'
RESULT_SHA256='788dfd5bc902e8e1fa6c8c6ea9d6d51f3f53e7ff921a65b310ebeb41154c3408'
LIVE_CID='f77670c58a5e8022b048d7daa17aeb55740d14eb31e85cee8cb6e8f17aafeba8'
ACCEPTED_IMAGE='sha256:7a1a2d6ce470ef66fcb83cc2c5216ffe6748915e0a48938c92540438c61a7a4d'
BACKEND=tuple(p+x for p in('IndoShipping.Api','IndoShipping.Domain','IndoShipping.Infrastructure')for x in('.dll','.pdb'))
COPIED=('db/postgres_schema.sql','seed/hs-dictionary.json')
PUBLIC_TOP={'index.html','favicon.svg','icons.svg','template-customs.xlsx','template-customs-rri.xlsx','template-customs-rrm.xlsx'}
STAGE='entry'
PUBLIC_EXT={'.js','.css','.map','.json','.png','.jpg','.jpeg','.gif','.svg','.ico','.webp','.avif','.woff','.woff2','.ttf','.eot','.txt'}
def need(v,label):
 global STAGE
 if not v:STAGE=label;raise RuntimeError(label)
def enc(v):return json.dumps(v,sort_keys=True,separators=(',',':'),ensure_ascii=True,allow_nan=False).encode()
def sha(v):return hashlib.sha256(v).hexdigest()
def raw(path,limit):
 need(not any(p.is_symlink()for p in(path,*path.parents)),'real-fixed-selected-evidence')
 fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
 try:
  a=os.fstat(fd);need(stat.S_ISREG(a.st_mode)and 0<=a.st_size<=limit and a.st_mode&0o077==0,'bounded-private-regular-selected-evidence');parts=[];count=0
  while True:
   b=os.read(fd,1024**2)
   if not b:break
   parts.append(b);count+=len(b);need(count<=limit,'bounded-selected-evidence-read')
  value=b''.join(parts);z=os.fstat(fd);key=lambda s:(s.st_dev,s.st_ino,s.st_mode,s.st_uid,s.st_gid,s.st_size,s.st_mtime_ns,s.st_ctime_ns)
  need(key(a)==key(z)==key(path.lstat())and len(value)==a.st_size,'stable-byte-sealed-selected-evidence');return value
 finally:os.close(fd)
def safe_path(n):
 return type(n)is str and 0<len(n)<=512 and str(pathlib.PurePosixPath(n))==n and not n.startswith('/')and'..'not in pathlib.PurePosixPath(n).parts and '\\'not in n and all(ord(c)>=32 for c in n)
def public_file(n):
 if not safe_path(n)or not n.startswith('wwwroot/'):return False
 relative=n[len('wwwroot/'):]
 return relative in PUBLIC_TOP or relative.startswith('assets/')and all(re.fullmatch('[A-Za-z0-9_.-]{1,200}',p)for p in pathlib.PurePosixPath(relative).parts)and pathlib.PurePosixPath(relative).suffix.lower()in PUBLIC_EXT

def tar_inventory(blob):
 need(type(blob)is bytes and len(blob)<=128*1024**2,'bounded-single-source-tar');files={};seen=set();total=0;index=None
 with tarfile.open(fileobj=io.BytesIO(blob),mode='r:')as archive:
  members=archive.getmembers();need(1<=len(members)<=5000,'bounded-source-member-count')
  for m in members:
   n=m.name.rstrip('/');need(safe_path(n)and n not in seen and(m.isfile()or m.isdir()),'unique-regular-source-members');seen.add(n)
   need(type(m.uid)is int and m.uid>=0 and type(m.gid)is int and m.gid>=0 and 0<=m.mode<=0o7777,'typed-source-member-metadata')
   if m.isdir():
    need(n in{'wwwroot','db','seed'}or n.startswith('wwwroot/assets/')and all(re.fullmatch('[A-Za-z0-9_.-]{1,200}',p)for p in pathlib.PurePosixPath(n).parts)or n=='wwwroot/assets','only-known-public-source-directories');continue
   need(n in BACKEND or n in COPIED or public_file(n),'only-eight-backend-and-fixed-public-static-file-paths')
   need(0<=m.size<=64*1024**2,'bounded-source-file-size');total+=m.size;need(total<=128*1024**2,'bounded-source-regular-total')
   body=archive.extractfile(m).read();need(len(body)==m.size,'complete-source-member')
   files[n]={'sha256':sha(body),'size':len(body)}
   if n=='wwwroot/index.html':need(len(body)<=1024**2,'bounded-public-index');index=body
 need(set(BACKEND+COPIED)<=set(files)and index is not None,'all-eight-backend-copied-files-and-index-present')
 return files,index

class References(html.parser.HTMLParser):
 def __init__(self):super().__init__(convert_charrefs=True);self.refs=set();self.ignored=0
 def handle_starttag(self,tag,attrs):
  a=dict(attrs);value=a.get('src')if tag=='script'else a.get('href')if tag=='link'and'rel'in a and'stylesheet'in a['rel'].lower().split()else None
  if value is None:return
  if len(value)>1024:self.ignored+=1;return
  try:u=urllib.parse.urlsplit(value)
  except ValueError:self.ignored+=1;return
  if u.scheme or u.netloc:self.ignored+=1;return
  path=u.path
  if path.startswith('/indo-shipping/'):path=path[len('/indo-shipping/'):]
  elif path.startswith('./'):path=path[2:]
  if path.startswith('assets/')and public_file('wwwroot/'+path)and pathlib.PurePosixPath(path).suffix in{'.js','.css'}:self.refs.add(path)
  else:self.ignored+=1

def index_summary(body):
 p=References();p.feed(body.decode('utf-8'));need(len(p.refs)<=100,'bounded-public-index-resource-references')
 return {'sha256':sha(body),'size':len(body),'safeRelativeAssetReferences':sorted(p.refs),'ignoredUnsafeOrExternalReferenceCount':p.ignored}

def compare(left,right,li,ri):
 backend={n:{'same':left[n]==right[n],'live':left[n],'accepted':right[n]}for n in BACKEND+COPIED}
 differences=[];leftweb={n:v for n,v in left.items()if n.startswith('wwwroot/')};rightweb={n:v for n,v in right.items()if n.startswith('wwwroot/')}
 for n in sorted(set(leftweb)|set(rightweb)):
  if leftweb.get(n)!=rightweb.get(n):differences.append({'path':n,'live':leftweb.get(n),'accepted':rightweb.get(n)})
 return {'allSixDllPdbExact':all(backend[n]['same']for n in BACKEND),'dbSchemaAndHsDictionaryExact':all(backend[n]['same']for n in COPIED),'backendAndCopiedFiles':backend,'wwwrootLiveFileCount':len(leftweb),'wwwrootAcceptedFileCount':len(rightweb),'wwwrootDifferenceCount':len(differences),'wwwrootDifferences':differences[:40],'wwwrootDifferenceListTruncated':len(differences)>40,'index':{'live':index_summary(li),'accepted':index_summary(ri)}}

def main():
 need(EXECUTE is True and sys.argv[1:]==['diagnose']and os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_MODE')=='diagnose'and os.environ.get('RELEASE_ATTEMPT')=='1','inert-first-diagnostic')
 os.umask(0o077);need(OUT.parent.is_dir()and not OUT.parent.is_symlink()and not OUT.exists()and not OUT.is_symlink(),'fresh-own-private-diagnostic');OUT.mkdir(mode=0o700)
 result={'phase':'diagnose','target':TARGET,'success':False,'readOnly':True,'selectedSealedSourceTarOnly':True,'dockerSqlOrLifecycleUsed':False,'wholeMutableArchiveSealClaimed':False}
 try:
  body=raw(PREPARE/'manifest.json',16*1024**2);failure=raw(PREPARE/'result.private.json',16*1024**2);need(sha(body)==MANIFEST_SHA256 and sha(failure)==RESULT_SHA256,'fixed-r3-failure-byte-seals');manifest=json.loads(body);failed=json.loads(failure)
  need(failed.get('success')is False and failed.get('phase')=='prepare'and failed.get('target')==TARGET and failed.get('stage')=='actual-live-backend-and-whole-static-graph-match-known-accepted-image','exact-source-proof-failure')
  selected={};all_tars=[n for n in manifest if n.startswith('runtime-source-')and n.endswith('.private.tar')]
  need(len(all_tars)==2,'exactly-two-fixed-source-tars')
  total=0
  for label,cid in(('live',LIVE_CID),('accepted',ACCEPTED_IMAGE)):
   names=[n for n in all_tars if re.fullmatch(re.escape('runtime-source-'+cid[:12]+'-')+'[0-9]+[.]private[.]tar',n)];need(len(names)==1,'one-source-tar-per-full-fixed-id-prefix')
   n=names[0];blob=raw(PREPARE/n,128*1024**2);total+=len(blob);need(total<=256*1024**2 and sha(blob)==manifest[n],'selected-tar-byte-seal-and-combined-size');selected[label]=tar_inventory(blob)
  result['comparison']=compare(selected['live'][0],selected['accepted'][0],selected['live'][1],selected['accepted'][1]);result['success']=True
 except Exception as e:result.update(errorType=type(e).__name__,stage=STAGE)
 result['resultSHA256']=sha(enc(result));result['sha256Wire']={'target':[int(c,16)for c in TARGET]}
 fd=os.open(OUT/'result.private.json',os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
 with os.fdopen(fd,'wb')as f:f.write(enc(result));f.flush();os.fsync(f.fileno())
 print(json.dumps(result,sort_keys=True),flush=True);return 0 if result['success']else 1
if __name__=='__main__':sys.exit(main())
