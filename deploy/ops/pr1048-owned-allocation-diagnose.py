"""INERT read-only fixed failed-archive/cache allocation diagnosis; no cleanup.
Only own new result/manifest are written. No cache/image deletion, build, tag,
lifecycle, application execution, business body reads or failed-evidence edits.
"""
import decimal,hashlib,json,os,pathlib,re,stat,subprocess,sys
ROOT=pathlib.Path('/opt/rr-portal');FAILED=ROOT/'deploy/backups/pr1048-indo-static-1-20261031/prepare';OUT=ROOT/'deploy/backups/pr1048-owned-allocation-diagnose-1';SEAL='27d03a6145d34c84a7c1f76c4b14ac3882fa92daa7f4ec27e27cb3621e3ca54f';TARGET='38a35585770e0e837229d50f20ee4a9a759037ad';EXECUTE=False;BRANCH='refs/heads/codex/ops-pr-1046-1049-20261031';STAGE='entry';DETAILS={}
IMAGES={'frontend':'sha256:0b97df42c7e86c0937172435be1ccb4d05ebc2c5617a50a106fe392b7b26472c','candidate':'sha256:60d7deef2fe58c1c6ca66977b43392c570f11e31cc7f6d38f12fad2f2d201cee','canonical':'sha256:805586529a8575ef0dc5f9161d619dd4fb62f67b0b6b68ae5995ac922b860503'}
def need(v,label):
 global STAGE
 STAGE=label
 if not v:raise RuntimeError(label)
def enc(v):return json.dumps(v,sort_keys=True,separators=(',',':'),ensure_ascii=True,allow_nan=False).encode()
def sha(v):return hashlib.sha256(v).hexdigest()
def cmd(a,optional=False,limit=16*1024**2,timeout=60):
 p=subprocess.run(a,cwd=ROOT,capture_output=True,timeout=timeout);need(len(p.stdout)<=limit and len(p.stderr)<=1024**2,'bounded-readonly-fixed-command');need(optional or p.returncode==0,'successful-readonly-fixed-command');return p

def runtime():
 ids=cmd(['docker','ps','-aq','--no-trunc']).stdout.decode().split();need(len(ids)==46 and len(set(ids))==46 and all(re.fullmatch('[a-f0-9]{64}',x)for x in ids),'all-original46-container-identities');rows=json.loads(cmd(['docker','inspect',*ids]).stdout);need({r['Id']for r in rows}==set(ids),'complete46-inspect');return {r['Id']:{'image':r['Image'],'config':sha(enc(r['Config'])),'host':sha(enc(r['HostConfig'])),'mounts':sha(enc(r['Mounts'])),'pid':r['State']['Pid'],'started':r['State']['StartedAt'],'restarts':r['RestartCount'],'running':r['State']['Running'],'oom':r['State']['OOMKilled'],'health':r['State'].get('Health',{}).get('Status')}for r in rows}
def images():
 ids=sorted(set(cmd(['docker','image','ls','-aq','--no-trunc']).stdout.decode().split()));need(1<=len(ids)<=5000 and all(re.fullmatch('sha256:[a-f0-9]{64}',x)for x in ids),'bounded-all-image-identities');rows=json.loads(cmd(['docker','image','inspect',*ids],limit=64*1024**2).stdout);need(len(rows)==len(ids)and{r['Id']for r in rows}==set(ids),'complete-image-inspect-only');out={}
 for r in rows:
  tags=r.get('RepoTags')or[];digests=r.get('RepoDigests')or[];out[r['Id']]={'configSHA256':sha(enc(r['Config'])),'rootfsSHA256':sha(enc(r['RootFS'])),'repositoryTagsSHA256':sha(enc(sorted(tags))),'repositoryDigestsSHA256':sha(enc(sorted(digests))),'tagCount':len(tags),'digestCount':len(digests),'size':r.get('Size')}
 for kind,i in IMAGES.items():need(i in out,'all3-protected-known-images-still-present')
 known={k:out[i]for k,i in IMAGES.items()};return out,known

def archive_allocation():
 need(FAILED.is_dir()and not any(p.is_symlink()for p in(FAILED,*FAILED.parents)),'fixed-failed-archive-real-directory');body=(FAILED/'manifest.json').read_bytes();need(len(body)<=8*1024**2 and sha(body)==SEAL,'original-failed-manifest-seal');rows=[];seen=set();groups={};logical=0
 for p in [FAILED,*sorted(FAILED.rglob('*'))]:
  n=str(p.relative_to(FAILED));s=p.lstat();need(stat.S_ISREG(s.st_mode)or stat.S_ISDIR(s.st_mode),'failed-archive-only-regular-metadata');need(len(rows)<200000 and s.st_dev==FAILED.stat().st_dev,'bounded-same-filesystem-failed-allocation');key=(s.st_dev,s.st_ino);allocated=s.st_blocks*512 if key not in seen else 0;seen.add(key);group=n.split('/')[0]if n!='.'else'root';group=group if group in('source','old-wwwroot','prepared-wwwroot','image-context','root')else'other-private-evidence';g=groups.setdefault(group,{'entries':0,'logicalFileBytes':0,'uniqueAllocatedBytes':0});g['entries']+=1;g['uniqueAllocatedBytes']+=allocated
  if stat.S_ISREG(s.st_mode):g['logicalFileBytes']+=s.st_size;logical+=s.st_size
  rows.append({'pathSHA256':sha(os.fsencode(n)),'device':s.st_dev,'inode':s.st_ino,'mode':s.st_mode,'uid':s.st_uid,'gid':s.st_gid,'bytes':s.st_size,'blocks':s.st_blocks,'mtimeNs':s.st_mtime_ns,'ctimeNs':s.st_ctime_ns})
 return {'groups':groups,'entries':len(rows),'logicalFileBytes':logical,'uniqueAllocatedBytes':sum(v['uniqueAllocatedBytes']for v in groups.values()),'metadataSHA256':sha(enc(rows)),'manifestSHA256':SEAL,'payloadFileBodiesRead':False,'manifestBodyReadForHashOnly':True,'hardlinksCountedOnce':True}

def cache_rows(raw):
 out=[];ids=set()
 for line in raw.splitlines():
  if not line.strip():continue
  r=json.loads(line);i=r.get('ID');need(type(i)is str and re.fullmatch('[a-z0-9]{1,128}',i)and i not in ids and len(ids)<20000,'bounded-unique-cache-id');ids.add(i);size=r.get('Size');need(type(size)is int and size>=0 or type(size)is str and re.fullmatch(r'[0-9]+(?:[.][0-9]+)? ?(?:[kKMGTPE]?[iI]?[bB])?',size)and len(size)<=64,'typed-cache-size-display');display=str(size);exact=int(size)if re.fullmatch('[0-9]+',display)else None;match=re.fullmatch(r'([0-9]+(?:[.][0-9]+)?) ?([kKMGTPE]?)([iI]?)[bB]?',display);need(match is not None,'bounded-safe-cache-size-display');scale=('KMGTPE'.find(match[2].upper())+1)if match[2]else 0;size=int(decimal.Decimal(match[1])*(1024 if match[3]else 1000)**scale);need(0<=size<=1024**4,'bounded-cache-reported-size');parents=r.get('Parents')or[];need(type(parents)is list and all(type(x)is str and re.fullmatch('[a-z0-9]{1,128}',x)for x in parents),'typed-cache-parent-ids');flags={k:r.get(k)for k in('Reclaimable','Shared','Mutable')};need(all(type(x)is bool for x in flags.values()),'explicit-cache-eligibility-flags');kind=r.get('Type');need(kind in('regular','internal','frontend','source.local','source.git.checkout','exec.cachemount')or type(kind)is str and re.fullmatch('[A-Za-z0-9_.-]{1,80}',kind),'typed-cache-record-type');description=r.get('Description')or'';need(type(description)is str and len(description)<=65536,'bounded-cache-description-in-memory');classification='npm-ci'if'npm ci'in description else'npm-build'if'npm run build'in description else'public-copy'if'COPY'in description and('web/'in description or'wwwroot'in description)else'other';times={}
  for k in('CreatedAt','LastUsedAt'):
   value=r.get(k);need(value is None or type(value)is str and re.fullmatch('[0-9A-Za-z +:._-]{0,256}',value),'typed-cache-time');times[k]=value
  count=r.get('UsageCount');need(count is None or type(count)is int and 0<=count<=10**12,'typed-cache-usage-count');eligible=flags=={'Reclaimable':True,'Shared':False,'Mutable':False}and kind=='regular';out.append({'id':i,'parents':parents,'reportedSizeDisplay':display,'reportedBytesExact':exact,'reportedBytesApproximate':size,**flags,'type':kind,'usageCount':count,**times,'descriptionSHA256':sha(description.encode()),'classification':classification,'currentlyPrivateImmutableReclaimableRegular':eligible,'ownershipProven':False,'explicitLockFieldPresent':any(k in r for k in('InUse','Locked'))})
 return sorted(out,key=lambda r:(-r['reportedBytesApproximate'],r['id']))

def diagnose():
 before=runtime();all_images,known=images();failed=archive_allocation();DETAILS.update(original46RuntimeSHA256=sha(enc(before)),allImagesSHA256=sha(enc(all_images)),knownImages=known,knownImageReferences={k:sum(r['image']==i for r in before.values())for k,i in IMAGES.items()},failedArchiveAllocation=failed)
 info=json.loads(cmd(['docker','info','--format','{{json .}}']).stdout);root=pathlib.Path(info['DockerRootDir']);need(root.is_absolute()and root.is_dir()and not any(p.is_symlink()for p in(root,*root.parents)),'actual-docker-root-real-directory');DETAILS['engine']={k:info.get(k)for k in('ID','ServerVersion','Driver','OSType','Architecture')};need(info['ID']=='bc9f32e6-298a-45f8-92c7-b755d1b61818'and info['ServerVersion']=='29.2.1','same-observed-docker-engine');build=cmd(['docker','buildx','inspect','default']).stdout.decode();meta={}
 for line in build.splitlines():
  hit=re.fullmatch(r'(Name|Driver|Status|BuildKit):\s*(.{1,200})',line)
  if hit:meta.setdefault(hit[1],[]).append(hit[2])
 need(1<=len(meta.get('Name',[]))<=2 and set(meta.get('Name',[]))=={'default'}and meta.get('Driver')==['docker'],'same-default-docker-builder');DETAILS['builder']={'name':'default','driver':'docker','rawMetadataSHA256':sha(build.encode())};cache=cache_rows(cmd(['docker','buildx','--builder','default','du','--format=json']).stdout);DETAILS['cacheRecords']=cache;eligible=[r for r in cache if r['currentlyPrivateImmutableReclaimableRegular']];DETAILS['cacheSummary']={'records':len(cache),'reportedAllRecordBytesApproximate':sum(r['reportedBytesApproximate']for r in cache),'privateImmutableReclaimableRegularCount':len(eligible),'reportedPrivateEligibleBytesApproximate':sum(r['reportedBytesApproximate']for r in eligible),'actualPhysicalReclaimInferred':False,'noRecordsSelectedOrApproved':True}
 summary=cmd(['docker','system','df','--format','{{json .}}']).stdout;DETAILS['dockerSystemDf']=[{k:r.get(k)for k in('Type','TotalCount','Active','Size','Reclaimable')}for r in map(json.loads,summary.splitlines())if r]
 allocations={}
 for name in('buildkit','image','overlay2','containerd','tmp'):
  p=root/name
  if not p.exists():continue
  need(p.is_dir()and not p.is_symlink(),'fixed-docker-allocation-directory');r=cmd(['du','-sx','--block-size=1','--',str(p)],optional=True,limit=4096,timeout=45);match=re.fullmatch(rb'([0-9]+)\s+[^\n]+\n?',r.stdout);allocations[name]={'returncode':r.returncode,'bytes':int(match[1])if r.returncode==0 and match else None,'stderrSHA256':sha(r.stderr)}
 DETAILS['dockerDirectoryAllocatedBytes']=allocations;fs=os.statvfs(root);DETAILS['space']={'available':fs.f_bavail*fs.f_frsize,'free':fs.f_bfree*fs.f_frsize};after=runtime();after_images=images()[0];DETAILS['runtimeDifferences']={cid:{k:{'before':before.get(cid,{}).get(k),'after':after.get(cid,{}).get(k)}for k in set(before.get(cid,{}))|set(after.get(cid,{}))if before.get(cid,{}).get(k)!=after.get(cid,{}).get(k)}for cid in set(before)|set(after)if before.get(cid)!=after.get(cid)};DETAILS['imageDifferences']={iid:{k:{'before':all_images.get(iid,{}).get(k),'after':after_images.get(iid,{}).get(k)}for k in set(all_images.get(iid,{}))|set(after_images.get(iid,{}))if all_images.get(iid,{}).get(k)!=after_images.get(iid,{}).get(k)}for iid in set(all_images)|set(after_images)if all_images.get(iid)!=after_images.get(iid)};need(after==before and after_images==all_images,'all46-runtime-and-all-images-preserved');need(archive_allocation()==failed,'all-failed-archive-file-and-directory-metadata-preserved');DETAILS['allOriginal46ImagesAndFailedArchivePreserved']=True

def private(name,value):
 fd=os.open(OUT/name,os.O_CREAT|os.O_EXCL|os.O_WRONLY|os.O_NOFOLLOW,0o600)
 with os.fdopen(fd,'wb')as f:f.write(enc(value));f.flush();os.fsync(f.fileno())
def wire(v):
 raw=enc(v);need(len(raw)<=8*1024**2,'bounded-hash-and-typed-metadata-output');nib=lambda x:[int(c,16)for c in(format(x,'x')if type(x)is int else x)];parts=[raw[i:i+1024]for i in range(0,len(raw),1024)];digest=nib(sha(raw))
 for i,b in enumerate(parts):print(enc([0,nib(i+1),nib(len(parts)),nib(len(raw)),digest,nib(b.hex())]).decode(),flush=True)
 print(enc([1,nib(len(parts)),nib(len(raw)),digest]).decode(),flush=True)
def main():
 need(EXECUTE is True and BRANCH and sys.argv[1:]==['diagnose']and os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_MODE')=='diagnose'and os.environ.get('RELEASE_ATTEMPT')=='1','explicit-new-readonly-allocation-diagnosis');os.umask(0o077);need(OUT.parent.is_dir()and not any(p.is_symlink()for p in(OUT.parent,*OUT.parent.parents))and not OUT.exists(),'fresh-own-readonly-allocation-archive');OUT.mkdir(mode=0o700);v={'success':False,'phase':'diagnose','mode':'diagnose','target':TARGET,'readOnly':True,'businessBodiesRead':False,'cleanupOrBuildOrLifecycleOrTagWrites':False,'failedArchiveModified':False,'details':DETAILS}
 try:diagnose();v['success']=True
 except Exception as e:v.update(errorType=type(e).__name__,stage=STAGE)
 v['resultSHA256']=sha(enc(v));private('result.private.json',v);private('manifest.json',{'result.private.json':sha((OUT/'result.private.json').read_bytes())});wire({'result':v,'manifestSHA256':sha((OUT/'manifest.json').read_bytes())});return 0 if v['success']else 1
if __name__=='__main__':sys.exit(main())
