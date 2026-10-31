"""INERT fixed read-only Buildx du filter matrix; absolutely no prune path."""
import hashlib,json,os,pathlib,re,subprocess,sys
ROOT=pathlib.Path('/opt/rr-portal');OUT=ROOT/'deploy/backups/pr1048-cache-filter-diagnose-1';EXECUTE=False;BRANCH='refs/heads/codex/ops-pr-1046-1049-20261031';STAGE='entry';IDS=('8qzomgd3axoasvusjy9gn2iin','s6lzlgvw18svpmfa55xnoksu1');PATTERN='^('+'|'.join(IDS)+')$';DETAILS={}
def need(v,label):
 global STAGE
 STAGE=label
 if not v:raise RuntimeError(label)
def enc(v):return json.dumps(v,sort_keys=True,separators=(',',':'),ensure_ascii=True,allow_nan=False).encode()
def sha(v):return hashlib.sha256(v).hexdigest()
def cmd(a):
 p=subprocess.run(a,cwd=ROOT,capture_output=True,timeout=60);need(len(p.stdout)<=16*1024**2 and len(p.stderr)<=1024**2,'bounded-fixed-readonly-command');return p

def runtime():
 p=cmd(['docker','ps','-aq','--no-trunc']);need(p.returncode==0,'list46');ids=p.stdout.decode().split();need(len(ids)==len(set(ids))==46 and all(re.fullmatch('[a-f0-9]{64}',x)for x in ids),'exact46');p=cmd(['docker','inspect',*ids]);need(p.returncode==0,'inspect46');r=json.loads(p.stdout);need(len(r)==46 and{v['Id']for v in r}==set(ids),'complete46');return {v['Id']:{'config':sha(enc(v['Config'])),'host':sha(enc(v['HostConfig'])),'mounts':sha(enc(sorted(v['Mounts'],key=enc))),'image':v['Image'],'pid':v['State']['Pid'],'started':v['State']['StartedAt'],'running':v['State']['Running'],'oom':v['State']['OOMKilled'],'health':v['State'].get('Health',{}).get('Status'),'restarts':v['RestartCount']}for v in r}
def variant(label,filters):
 p=cmd(['docker','buildx','--builder','default','du',*[x for f in filters for x in('--filter',f)],'--format=json']);row={'label':label,'filters':filters,'returncode':p.returncode,'stdoutBytes':len(p.stdout),'stdoutSHA256':sha(p.stdout),'stderrBytes':len(p.stderr),'stderrSHA256':sha(p.stderr)};DETAILS.setdefault('queries',[]).append(row)
 if p.returncode:return
 records=[]
 for line in p.stdout.splitlines():
  if not line.strip():continue
  v=json.loads(line);i=v.get('ID');need(type(i)is str and re.fullmatch('[a-z0-9]{1,128}',i)and len(records)<20000,'typed-readonly-cache-identities');description=v.get('Description')or'';need(type(description)is str and len(description)<=65536,'bounded-description-hash-only');records.append({'id':i,'type':v.get('Type'),'Reclaimable':v.get('Reclaimable'),'Shared':v.get('Shared'),'Mutable':v.get('Mutable'),'descriptionSHA256':sha(description.encode())})
 ids=sorted(v['id']for v in records);need(len(ids)==len(set(ids)),'unique-returned-cache-identities');unexpected=sorted(set(ids)-set(IDS));row.update(returnedCount=len(ids),returnedIDsSHA256=sha(enc(ids)),matchedSelectedIDs=sorted(set(ids)&set(IDS)),unexpectedCount=len(unexpected),firstUnexpectedIDs=unexpected[:32],returnedTypedClassificationSHA256=sha(enc(sorted(records,key=lambda x:x['id']))),selectedTypedRows=[v for v in records if v['id']in IDS],exactTwoReturned=set(ids)==set(IDS))

def diagnose():
 before=runtime();p=cmd(['docker','buildx','version']);need(p.returncode==0,'actual-buildx-version');text=p.stdout.decode();match=re.search(r'\bv[0-9]+(?:\.[0-9]+){1,3}(?:[-+][A-Za-z0-9_.-]+)?\b',text);need(match is not None and len(text)<=4096,'typed-buildx-version');DETAILS['buildxVersion']=match[0];DETAILS['buildxVersionOutputSHA256']=sha(p.stdout);p=cmd(['docker','version','--format','{{json .Server.Version}}']);need(p.returncode==0,'engine-version');v=json.loads(p.stdout);need(type(v)is str and re.fullmatch('[0-9]+(?:\.[0-9]+){1,3}',v),'typed-engine-version');DETAILS['engineVersion']=v
 variant('all',[])
 for op in('=','~='):
  base='id'+op+PATTERN;variant('id-'+op,[base]);variant('id-'+op+'-type',[base,'type=regular'])
  for boolean in('mutable=false','shared=false','inuse=false'):variant('id-'+op+'-'+boolean,[base,boolean])
  variant('id-'+op+'-all-guards',[base,'type=regular','mutable=false','shared=false','inuse=false'])
  variant('id-'+op+'-presence-immutable-private',[base,'type=regular','immutable~=^$','private~=^$','inuse!=""'])
  variant('id-'+op+'-absence-mutable-shared-inuse',[base,'type=regular','mutable!=""','shared!=""','inuse!=""'])
 variant('single-id-equal',['id='+IDS[0]]);variant('single-id-regex',['id~=^'+IDS[0]+'$']);after=runtime();DETAILS['runtimeDifferences']={c:{k:{'before':before.get(c,{}).get(k),'after':after.get(c,{}).get(k)}for k in set(before.get(c,{}))|set(after.get(c,{}))if before.get(c,{}).get(k)!=after.get(c,{}).get(k)}for c in set(before)|set(after)if before.get(c)!=after.get(c)};need(before==after,'all46-normalized-runtime-config-preserved');DETAILS['all46Preserved']=True

def private(n,v):
 fd=os.open(OUT/n,os.O_CREAT|os.O_EXCL|os.O_WRONLY|os.O_NOFOLLOW,0o600)
 with os.fdopen(fd,'wb')as f:f.write(enc(v));f.flush();os.fsync(f.fileno())
def wire(v):
 raw=enc(v);need(len(raw)<=2*1024**2,'bounded-typed-filter-result');nib=lambda x:[int(c,16)for c in(format(x,'x')if type(x)is int else x)];parts=[raw[i:i+1024]for i in range(0,len(raw),1024)];digest=nib(sha(raw))
 for i,b in enumerate(parts):print(enc([0,nib(i+1),nib(len(parts)),nib(len(raw)),digest,nib(b.hex())]).decode(),flush=True)
 print(enc([1,nib(len(parts)),nib(len(raw)),digest]).decode(),flush=True)
def main():
 need(EXECUTE is True and BRANCH and sys.argv[1:]==['diagnose']and os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_MODE')=='diagnose'and os.environ.get('RELEASE_ATTEMPT')=='1','explicit-readonly-filter-matrix-only');os.umask(0o077);need(OUT.parent.is_dir()and not any(p.is_symlink()for p in(OUT.parent,*OUT.parent.parents))and not OUT.exists(),'fresh-private-filter-diagnosis');OUT.mkdir(mode=0o700);v={'success':False,'phase':'diagnose','mode':'diagnose','readOnly':True,'pruneBuildTagOrLifecyclePerformed':False,'failedArchivesModified':False,'rawCacheDescriptionsOrEnvReturned':False,'details':DETAILS}
 try:diagnose();v['success']=True
 except Exception as e:v.update(errorType=type(e).__name__,stage=STAGE)
 v['resultSHA256']=sha(enc(v));private('result.private.json',v);private('manifest.json',{'result.private.json':sha((OUT/'result.private.json').read_bytes())});wire({'result':v,'manifestSHA256':sha((OUT/'manifest.json').read_bytes())});return 0 if v['success']else 1
if __name__=='__main__':sys.exit(main())
