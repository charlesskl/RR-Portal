"""INERT fresh Quote profile; no lifecycle, business writes or old-phase replay."""
import hashlib,importlib.util,itertools,json,math,os,pathlib,re,stat,subprocess,sys
ROOT=pathlib.Path('/opt/rr-portal');OUT=ROOT/'deploy/backups/pr1045-quote-preflight-5'
APP='apps/业务部/内部报价系统';SERVICE='internal-quote';ALIAS='rr-portal-internal-quote:latest'
BRANCH='refs/heads/codex/ops-pr-1045-20261031-quote';SOURCE_BASE='65e20c72c61d8a8dff6263f903dc5f9b6b3e52c9';EXECUTE=True
COMMON_NAME='pr1035-quote-preflight.py';COMMON_SHA256='2b2739aa00cad03bfce8472b7416d725364b8d4ed354a5a7e9ca905a47aaffa5'
AFFECTED=('backend/services/parseHardwareSheet.js', 'frontend/quote.html', 'frontend/verification.html', 'frontend/workbench.js')
CODE_PROBE="const fs=require('fs'),path=require('path'),crypto=require('crypto');\nconst h=b=>crypto.createHash('sha256').update(b).digest('hex');\nfunction tree(root,omit=[]){let a=[],bytes=0;function walk(p,n){let s=fs.lstatSync(p),v={n,uid:s.uid,gid:s.gid,mode:s.mode&4095};\nif(s.isSymbolicLink()){v.type='link';v.target=fs.readlinkSync(p);}else if(s.isDirectory()){v.type='dir';a.push(v);for(let x of fs.readdirSync(p).sort()){if(n===''&&omit.includes(x))continue;walk(path.join(p,x),n?n+'/'+x:x);}return;}else if(s.isFile()){v.type='file';v.size=s.size;bytes+=s.size;v.sha256=h(fs.readFileSync(p));}else throw Error('unsupported-code-kind');a.push(v);if(a.length>100000||bytes>1024**3)throw Error('bounded-code');}\nif(!fs.existsSync(root))return {absent:true};walk(root,'');return {sha256:h(JSON.stringify(a)),entries:a.length,bytes};}\nconsole.log(JSON.stringify({backend:tree('/app/backend',['data','legacy-data','uploads','data.db','data.db-shm','data.db-wal']),frontend:tree('/app/frontend'),nodeModules:tree('/app/node_modules'),package:tree('/app/package.json'),lock:tree('/app/package-lock.json')}));"
STAGE='entry'
def need(value,label):
 global STAGE
 STAGE=label
 if not value:raise RuntimeError(label)
def enc(value):return json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=True,allow_nan=False).encode()
def sha(body):return hashlib.sha256(body).hexdigest()
def private(name,value):
 fd=os.open(OUT/name,os.O_CREAT|os.O_EXCL|os.O_WRONLY|os.O_NOFOLLOW,0o600)
 with os.fdopen(fd,'wb')as f:f.write(enc(value));f.flush();os.fsync(f.fileno())
def command(args,timeout=90,limit=16*1024**2):
 # Docker Config/Env are consumed only in memory, never command logs.
 r=subprocess.run(args,cwd=ROOT,capture_output=True,timeout=timeout,env=dict(os.environ,GIT_OPTIONAL_LOCKS='0',GIT_TERMINAL_PROMPT='0'));need(r.returncode==0 and len(r.stdout)<=limit,'fixed-read-command-success-bounded');return r.stdout
def git(*args):return command(['git','-C',str(ROOT),'-c','core.hooksPath=/dev/null',*args])
def common():
 path=pathlib.Path(__file__).with_name(COMMON_NAME);need(path.is_file()and not path.is_symlink()and sha(path.read_bytes())==COMMON_SHA256,'pinned-inert-readonly-common');spec=importlib.util.spec_from_file_location('quote1045_readonly_common',path);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);m.OUT=OUT;m.TARGET=SOURCE_BASE;return m
def runtime():
 ids=command(['docker','ps','-aq','--no-trunc']).decode().split();need(0<len(ids)<1000 and len(set(ids))==len(ids)and all(re.fullmatch('[a-f0-9]{64}',x)for x in ids),'typed-all-container-set');rows=json.loads(command(['docker','inspect',*ids]));need({r['Id']for r in rows}==set(ids),'complete-in-memory-container-inspect');records={}
 for r in rows:
  records[r['Id']]={'image':r['Image'],'configSHA256':sha(enc(r['Config'])),'hostConfigSHA256':sha(enc(r['HostConfig'])),'envSHA256':sha(enc(sorted(r['Config'].get('Env')or[]))),'mountsSHA256':sha(enc(sorted(r['Mounts'],key=enc))),'pid':r['State']['Pid'],'started':r['State']['StartedAt'],'restarts':r['RestartCount'],'running':r['State']['Running'],'oom':r['State']['OOMKilled'],'health':r['State'].get('Health',{}).get('Status')}
 target=[r for r in rows if(r['Config'].get('Labels')or{}).get('com.docker.compose.project')=='rr-portal'and(r['Config'].get('Labels')or{}).get('com.docker.compose.service')==SERVICE];need(len(target)==1,'one-current-quote-container');return records,target[0]
def wire(value):
 raw=enc(value);need(len(raw)<=4*1024**2,'bounded-numeric-receipt');nib=lambda v:[int(x,16)for x in(format(v,'x')if type(v)is int else v)];parts=[raw[i:i+1024]for i in range(0,len(raw),1024)];digest=nib(sha(raw))
 for i,b in enumerate(parts):print(enc([0,nib(i+1),nib(len(parts)),nib(len(raw)),digest,nib(b.hex())]).decode(),flush=True)
 print(enc([1,nib(len(parts)),nib(len(raw)),digest]).decode(),flush=True)

# These probes inspect metadata only. They never prune, build, retag or stop.
CAPACITY_SQL="""BEGIN READ ONLY; SELECT json_build_object(
 'tableTotalBytes',COALESCE((SELECT sum(pg_total_relation_size(c.oid))::bigint FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='internal_quote' AND c.relkind IN('r','m')),0),
 'relations',COALESCE((SELECT json_agg(json_build_object('name',c.relname,'kind',c.relkind,'bytes',pg_total_relation_size(c.oid)) ORDER BY c.relname) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='internal_quote' AND c.relkind IN('r','m','S')),'[]'::json)); COMMIT;
"""
def root_size(folder):
 # Never read business file bodies or follow symbolic links.
 need(not any(p.is_symlink()for p in folder.parents),'capacity-real-root-parents')
 try:first=folder.lstat()
 except FileNotFoundError:return {'absent':True}
 need(stat.S_ISDIR(first.st_mode)and not stat.S_ISLNK(first.st_mode),'capacity-root-is-directory')
 entries=[];files=0;total=0;allocated=0
 def walk(p,rel):
  nonlocal files,total,allocated
  s=p.lstat();v={'pathSHA256':sha(os.fsencode(rel)),'uid':s.st_uid,'gid':s.st_gid,'mode':stat.S_IMODE(s.st_mode),'bytes':s.st_size,'allocated':s.st_blocks*512,'mtimeNs':s.st_mtime_ns}
  if stat.S_ISDIR(s.st_mode):
   v['type']='dir';entries.append(v)
   for child in sorted(p.iterdir(),key=lambda x:os.fsencode(x.name)):walk(child,rel+'/'+child.name)
  elif stat.S_ISREG(s.st_mode):v['type']='file';entries.append(v);files+=1;total+=s.st_size;allocated+=s.st_blocks*512
  elif stat.S_ISLNK(s.st_mode):v['type']='link';entries.append(v)
  else:need(False,'capacity-only-dir-file-link')
  need(len(entries)<=1000000 and total<=1024**4,'bounded-capacity-file-metadata')
 walk(folder,'');need((first.st_dev,first.st_ino,first.st_mode,first.st_mtime_ns)==tuple(getattr(folder.lstat(),n)for n in('st_dev','st_ino','st_mode','st_mtime_ns')),'capacity-root-stable-metadata')
 return {'files':files,'entries':len(entries),'fileBytes':total,'allocatedFileBytes':allocated,'metadataSHA256':sha(enc(entries)),'businessFileBodiesRead':False,'linksFollowed':False}
def optional_metadata(args):
 r=subprocess.run(args,cwd=ROOT,capture_output=True,timeout=90,env=dict(os.environ,GIT_OPTIONAL_LOCKS='0'));need(len(r.stdout)<=4*1024**2 and len(r.stderr)<=1024**2,'bounded-optional-cache-metadata')
 # Descriptions can contain build command text: persist no raw descriptions.
 return {'returncode':r.returncode,'stdoutBytes':len(r.stdout),'stdoutSHA256':sha(r.stdout),'stderrBytes':len(r.stderr),'stderrSHA256':sha(r.stderr)},r.stdout

def original_capacity_profile(P,docker_root):
 mem={}
 for line in pathlib.Path('/proc/meminfo').read_text().splitlines():
  k,_,v=line.partition(':')
  if k in('MemTotal','MemAvailable','SwapTotal','SwapFree'):
   m=re.fullmatch(r'\s*([0-9]+) kB',v);need(m is not None,'typed-proc-memory-kib');mem[k+'Bytes']=int(m[1])*1024
 need(set(mem)=={'MemTotalBytes','MemAvailableBytes','SwapTotalBytes','SwapFreeBytes'},'actual-memavailable-present')
 db=P.unique_service('db')
 r=subprocess.run(['docker','exec','-i',db,'sh','-c','exec psql -X -q -At -v ON_ERROR_STOP=1 -U "${POSTGRES_USER:-rrportal}" -d "${POSTGRES_DB:-rrportal}"'],input=CAPACITY_SQL.encode(),cwd=ROOT,capture_output=True,timeout=90);need(r.returncode==0 and len(r.stdout)<=1024**2,'readonly-relation-size-query');pg=json.loads(r.stdout);need(type(pg['tableTotalBytes'])is int and 0<=pg['tableTotalBytes']<=8*1024**3 and type(pg['relations'])is list and len(pg['relations'])<=1000,'bounded-actual-quote-relation-metadata')
 roots={n:root_size(ROOT/APP/'backend'/n)for n in('data','legacy-data','uploads')}
 old=ROOT/'deploy/backups/pr1043-quote-20261030-1/deploy/cold-before/internal_quote.dump';prior={'path':str(old),'absent':not old.exists()}
 if old.exists():
  s=old.lstat();need(stat.S_ISREG(s.st_mode)and not old.is_symlink(),'prior-quote-dump-regular-metadata-only');prior.update(bytes=s.st_size,allocatedBytes=s.st_blocks*512,mtimeNs=s.st_mtime_ns,contentsRead=False)
 fs=os.statvfs(docker_root);system,body=optional_metadata(['docker','system','df','--format','{{json .}}']);system['rows']=[]
 if system['returncode']==0:
  for line in body.splitlines():
   r=json.loads(line);system['rows'].append({k:r[k]for k in('Type','TotalCount','Active','Size','Reclaimable')if k in r})
 helpmeta,body=optional_metadata(['docker','builder','du','--help']);cache={'help':helpmeta,'queryPerformed':False,'cleanupAuthorized':False}
 if helpmeta['returncode']==0 and b'--verbose' in body:
  meta,body=optional_metadata(['docker','builder','du','--verbose']);cache.update(query=meta,queryPerformed=True,records=[])
  if meta['returncode']==0:
   for block in re.split(rb'\n\s*\n',body):
    row={}
    for line in block.splitlines():
     m=re.fullmatch(rb'(ID|Reclaimable|Shared|Mutable|In use|Size|Created at|Last used|Usage count):\s*(.*)',line)
     if m:row[m[1].decode()]=m[2].decode('utf-8','replace')
    if row:cache['records'].append(row)
 need(len(cache.get('records',[]))<=10000,'bounded-builder-cache-record-count')
 return {'memory':mem,'space':{'available':fs.f_bavail*fs.f_frsize,'free':fs.f_bfree*fs.f_frsize,'blockSize':fs.f_frsize},'postgres':pg,'threeRootFileMetadata':roots,'priorQuoteDumpMetadata':prior,'dockerSystemDf':system,'builderCacheMetadata':cache,'budgetApproved':False,'budgetFloorInvented':False,'cleanupPerformed':False,'npmCiOrBuildPerformed':False,'allOldRollbackImagesAnd1044EvidencePreserved':True}


R3_ARCHIVE=ROOT/'deploy/backups/pr1045-cache-maintenance-3'
R3_MANIFEST_SHA256='64f37c12a42116e129cbf9e5a9866ab421bab8a3fefc7a0ed883ea339c76eb86'
PROFILE2=ROOT/'deploy/backups/pr1045-quote-preflight-2/result.private.json'
PROFILE2_SHA256='e68d2c58444ce06978385719bf3e4abea82930ba3ce4bbcaf51d8e13910b2249'
ORDER_COMBINATION_LIMIT=100000

def sealed_r3():
 need(R3_ARCHIVE.is_dir()and not any(p.is_symlink()for p in(R3_ARCHIVE,*R3_ARCHIVE.parents)),'sealed-r3-real-private-directory');p=R3_ARCHIVE/'manifest.json';need(p.is_file()and not p.is_symlink(),'sealed-r3-regular-manifest');raw=p.read_bytes();need(sha(raw)==R3_MANIFEST_SHA256,'sealed-r3-fixed-manifest-sha');manifest=json.loads(raw);need(type(manifest)is dict and 1<=len(manifest)<=100,'sealed-r3-bounded-file-manifest')
 paths=list(R3_ARCHIVE.iterdir());need(all(p.is_file()and not p.is_symlink()for p in paths)and {p.name for p in paths}==set(manifest)|{'manifest.json'},'sealed-r3-complete-regular-file-set')
 for name,digest in manifest.items():
  need(type(name)is str and re.fullmatch(r'[A-Za-z0-9_.-]+',name)is not None and type(digest)is str and re.fullmatch('[a-f0-9]{64}',digest)is not None,'sealed-r3-safe-file-hash-entry');p=R3_ARCHIVE/name;need(p.stat().st_size<=4*1024**2 and sha(p.read_bytes())==digest,'sealed-r3-all-private-file-bytes-exact')
 need({'before.private.json','after.private.json','selected-cache-before.private.json','single-command.private.json','result.private.json','intent.private.json'}<=set(manifest),'sealed-r3-complete-before-after-command-evidence');return manifest

def key_diff(before,after):
 need(type(before)is dict and type(after)is dict,'typed-snapshot-key-dictionaries');return [{'key':k,'beforePresent':k in before,'afterPresent':k in after,'beforeSHA256':sha(enc(before[k]))if k in before else None,'afterSHA256':sha(enc(after[k]))if k in after else None}for k in sorted(set(before)|set(after))if before.get(k)!=after.get(k)or(k in before)!=(k in after)]

def hash_map_diff(before,after,ids=True):
 need(type(before)is dict and type(after)is dict,'typed-hash-map-comparison');added=sorted(set(after)-set(before));removed=sorted(set(before)-set(after));changed=sorted(k for k in set(before)&set(after)if before[k]!=after[k]);label=lambda k:k if ids else sha(k.encode());return {'beforeCount':len(before),'afterCount':len(after),'sameKeySet':set(before)==set(after),'added':[label(k)for k in added],'removed':[label(k)for k in removed],'changed':[{'id'if ids else'nameSHA256':label(k),'beforeSHA256':before[k],'afterSHA256':after[k]}for k in changed],'changedCount':len(changed)}

def image_array_order_proof(record,before_sha,after_sha,limit=ORDER_COMBINATION_LIMIT):
 # Only top-level Manifests/RepoDigests/RepoTags may be permuted.
 # Config.Env, RootFS.Layers and every nested array retain exact original order.
 # All raw image Config/Env and encoded static prefixes remain in memory.
 fields=[k for k in('Manifests','RepoDigests','RepoTags')if k in record and type(record[k])is list]
 out={'id':record.get('Id'),'currentSHA256':sha(enc(record)),'fields':{k:len(record[k])for k in fields},'combinationLimit':limit,'attempted':False,'beforeHashMatched':False,'afterHashMatched':False,'onlyAllowedTopLevelArrayOrderProven':False,'tried':0}
 count=1
 for key in fields:
  values=record[key]
  if not all(type(v)is dict if key=='Manifests' else type(v)is str for v in values)or len(values)!=len({sha(enc(v))for v in values}):out['reason']='non-unique-or-unexpected-allowed-array-element-type';return out
  
  for factor in range(2,len(values)+1):
   count*=factor
   if count>limit:out['combinationUpperBoundAtRejection']=count;out['reason']='finite-combination-limit-exceeded';return out
 out['combinationUpperBound']=count
 if count>limit:out['reason']='finite-combination-limit-exceeded';return out
 # Canonical top-level key order matches enc(); hash the large prefix once.
 segments=[b'{'];ordered=[]
 for index,key in enumerate(sorted(record)):
  segments[-1]+=(b','if index else b'')+enc(key)+b':'
  if key in fields:ordered.append(key);segments.append(b'')
  else:segments[-1]+=enc(record[key])
 segments[-1]+=b'}';need(b''.join(x for pair in zip(segments,[enc(record[k])for k in ordered]+[b''])for x in pair)==enc(record),'exact-canonical-image-serialization-segments')
 out['attempted']=True;matched=set();prefix=hashlib.sha256(segments[0])
 def walk(level,state):
  if level==len(ordered):
   out['tried']+=1;value=state.hexdigest()
   if value in(before_sha,after_sha):matched.add(value)
   return len(matched)==len({before_sha,after_sha})
  for values in itertools.permutations(record[ordered[level]]):
   current=state.copy();current.update(enc(list(values)));current.update(segments[level+1])
   if walk(level+1,current):return True
  return False
 walk(0,prefix);out['beforeHashMatched']=before_sha in matched;out['afterHashMatched']=after_sha in matched;out['onlyAllowedTopLevelArrayOrderProven']=out['beforeHashMatched']and out['afterHashMatched'];out['reason']='both-sealed-hashes-matched-by-only-allowed-top-level-array-permutations'if out['onlyAllowedTopLevelArrayOrderProven']else'cannot-prove-only-allowed-top-level-array-order';return out

def maintenance_evidence(docker_root):
 manifest=sealed_r3();read=lambda name:json.loads((R3_ARCHIVE/name).read_bytes());before=read('before.private.json');after=read('after.private.json');receipt=read('single-command.private.json');failed=read('result.private.json');selected=read('selected-cache-before.private.json');intent=read('intent.private.json')
 need(PROFILE2.is_file()and not PROFILE2.is_symlink()and sha(PROFILE2.read_bytes())==PROFILE2_SHA256,'original-profile2-file-seal');original=json.loads(PROFILE2.read_bytes());need(original.get('success')is True and original.get('readOnly')is True,'original-profile2-successful-readonly')
 runtime_before=before['runtime'];runtime_after=after['runtime'];runtime_changes=[{'id':k,'fields':[d['key']for d in key_diff(runtime_before.get(k,{}),runtime_after.get(k,{}))]}for k in sorted(set(runtime_before)|set(runtime_after))if runtime_before.get(k)!=runtime_after.get(k)]
 images=hash_map_diff(before['allImages'],after['allImages']);volumes=hash_map_diff(before['allVolumes'],after['allVolumes'],False)
 aliases={'runtime':'allRuntime','host':'hostGitHead','dirty':'unstaged','staged':'staged','shared':'shared','env':'environmentFiles','gatewayAuth':'gatewayAuth','quoteCodeAndDependencies':'sourceAndDependencySignature'};profile_match={k:after.get(k)==original.get(v)for k,v in aliases.items()}
 proofs=[];changed=[r['id']for r in images['changed']];inspection={'performed':False};remaining=ORDER_COMBINATION_LIMIT
 if changed:
  need(len(changed)<=1000 and all(re.fullmatch('sha256:[a-f0-9]{64}',i)for i in changed),'typed-bounded-changed-image-ids');probe=subprocess.run(['docker','image','inspect',*changed],cwd=ROOT,capture_output=True,timeout=90);need(len(probe.stdout)<=64*1024**2 and len(probe.stderr)<=1024**2,'bounded-in-memory-changed-image-inspection');inspection={'performed':True,'returncode':probe.returncode,'stdoutBytes':len(probe.stdout),'stdoutSHA256':sha(probe.stdout),'stderrBytes':len(probe.stderr),'stderrSHA256':sha(probe.stderr)}
  if probe.returncode==0:
   try:rows=json.loads(probe.stdout)
   except (ValueError,TypeError):rows=None
   if type(rows)is list and {r.get('Id')for r in rows if type(r)is dict}==set(changed)and len(rows)==len(changed):
    for row in rows:
     if remaining<=0:proofs.append({'id':row['Id'],'attempted':False,'onlyAllowedTopLevelArrayOrderProven':False,'reason':'shared-total-combination-limit-exhausted'});continue
     proof=image_array_order_proof(row,before['allImages'][row['Id']],after['allImages'][row['Id']],remaining);proofs.append(proof);remaining-=proof['tried']
   else:inspection['typedRowsMatchedChangedIDs']=False
 fs=os.statvfs(docker_root);out={'archive':str(R3_ARCHIVE),'manifestSHA256':R3_MANIFEST_SHA256,'allManifestEntriesVerified':True,'manifestEntries':manifest,'snapshotTopLevelDifferences':key_diff(before,after),'runtime':{'beforeCount':len(runtime_before),'afterCount':len(runtime_after),'sameKeySet':set(runtime_before)==set(runtime_after),'exactEqual':runtime_before==runtime_after,'changes':runtime_changes},'afterMatchesOriginalProfile2':profile_match,'images':images,'volumes':volumes,'backupMetadata':{'exactEqual':before['backupMetadata']==after['backupMetadata'],'before':before['backupMetadata'],'after':after['backupMetadata']},'singleCommand':{k:receipt.get(k)for k in('returncode','stdoutSHA256','stderrSHA256','stdoutBytes','stderrBytes')},'intent':{'presentAndSealed':True,'singleAttempt':intent.get('singleAttempt'),'noAutomaticRetry':intent.get('noAutomaticRetry'),'commandSHA256':sha(enc(intent.get('command')))},'selectedCache':{'count':len(selected),'SHA256':sha(enc(selected))},'failedResult':{k:failed.get(k)for k in('success','stage','errorType','automaticRetry','resultSHA256')},'currentSpace':{'available':fs.f_bavail*fs.f_frsize,'free':fs.f_bfree*fs.f_frsize},'changedImageInspection':inspection,'changedImageArrayOrderProofs':proofs,'totalPermutationAttempts':ORDER_COMBINATION_LIMIT-remaining,'sharedTotalPermutationLimit':ORDER_COMBINATION_LIMIT,'allChangedImagesOnlyAllowedTopLevelArrayOrderProven':bool(changed)and len(proofs)==len(changed)and all(p['onlyAllowedTopLevelArrayOrderProven']for p in proofs),'rawImageConfigOrEnvPersisted':False,'pruneOrLifecycleReplayed':False,'businessRowsOrUploadsCopied':False}
 known=b'Total:\t0B\n';matches=receipt.get('returncode')==0 and receipt.get('stdoutBytes')==len(known) and receipt.get('stdoutSHA256')==sha(known);out['singleCommand']['knownExactSummary']={'sealedStdoutHashMatchesKnownTotalZeroLiteral':matches,'reportedTotalReclaimedBytes':0 if matches else None,'onlyTotalLineNoRecordIDsListed':matches};need(sealed_r3()==manifest,'sealed-r3-all-evidence-still-exact-after-readonly-diagnose');return out

def visibility_role(P):
 sql=b"BEGIN READ ONLY; SELECT json_build_object('currentUser',current_user,'sessionUser',session_user,'currentRoleSuperuser',(SELECT rolsuper FROM pg_roles WHERE rolname=current_user)); COMMIT;\n";db=P.unique_service('db');r=subprocess.run(['docker','exec','-i',db,'sh','-c','exec psql -X -q -At -v ON_ERROR_STOP=1 -U "${POSTGRES_USER:-rrportal}" -d "${POSTGRES_DB:-rrportal}"'],input=sql,cwd=ROOT,capture_output=True,timeout=90);need(r.returncode==0 and len(r.stdout)<=8192,'bounded-readonly-current-session-superuser-proof');v=json.loads(r.stdout);need(set(v)=={'currentUser','sessionUser','currentRoleSuperuser'}and type(v['currentUser'])is str and type(v['sessionUser'])is str and type(v['currentRoleSuperuser'])is bool,'typed-current-session-superuser-proof');return v


CACHE_ROOT_IDS=tuple(sorted(('nhge2ev4tp7n11trp6cxgt93d','pnz75pe7lyx9k77mis6q147s3','qsllsiwz72jrsw12pkomte3m8','dffp2znok9t2q0bzpfrytguxk','pmxbytwvlxa8nzhvp9h8q17mu','qjiyizc7qoyp3q33ymejou7en')))
CACHE_METADATA_FIELDS=('ID','Parents','CreatedAt','LastUsedAt','Reclaimable','Shared','Mutable','Size','Type')

def safe_cache_records(raw):
 # The du stdout may contain descriptions: raw stdout is never persisted.
 need(type(raw)is bytes and len(raw)<=16*1024**2,'bounded-in-memory-complete-cache-du');rows=[]
 for line in raw.splitlines():
  if not line.strip():continue
  value=json.loads(line);need(type(value)is dict and type(value.get('ID'))is str and re.fullmatch('[a-z0-9]{1,128}',value['ID'])is not None,'typed-cache-metadata-id');row={k:value[k]for k in CACHE_METADATA_FIELDS if k in value}
  for key in('Reclaimable','Shared','Mutable'):need(type(row.get(key))is bool,'typed-cache-metadata-bools')
  for key in('CreatedAt','LastUsedAt'):
   need(key not in row or row[key]is None or(type(row[key])is str and re.fullmatch(r'[0-9A-Za-z +:._-]{0,256}',row[key])is not None),'bounded-safe-cache-time-display-no-parsing')
  if 'Parents'in row:
   parents=row['Parents'];need(parents is None or(type(parents)is list and len(parents)<=256 and all(type(v)is str and re.fullmatch('[a-z0-9]{1,128}',v)is not None for v in parents))or(type(parents)is str and re.fullmatch(r'[a-z0-9 ,;\[\]"\t-]{0,8192}',parents)is not None),'bounded-safe-cache-parent-metadata')
  size=row.get('Size');need(type(size)is int and size>=0 or type(size)is str and re.fullmatch(r'[0-9]+(?:\.[0-9]+)? ?(?:[kKMGTPE]?[iI]?[bB])?',size)is not None and len(size)<=64,'bounded-cache-size-display-no-byte-inference')
  need(type(row.get('Type'))is str and re.fullmatch('[a-z][a-z0-9_.-]{0,63}',row['Type'])is not None,'bounded-cache-record-type');rows.append(row);need(len(rows)<=20000,'bounded-complete-cache-record-count')
 need(len({r['ID']for r in rows})==len(rows),'unique-complete-cache-record-ids');return sorted(rows,key=lambda r:r['ID'])

def cache_graph_summary(rows):
 index={r['ID']:r for r in rows};eligible_ids={r['ID']for r in rows if r['Reclaimable']is True and r['Shared']is False and r['Mutable']is False and r['Type']=='regular'};children={i:set()for i in index};unknown_encoding=[];missing_parents=set();edges=0
 for row in rows:
  if 'Parents'not in row:unknown_encoding.append(row['ID']);continue
  parents=row['Parents']
  if parents is None:parents=[]
  if type(parents)is not list:unknown_encoding.append(row['ID']);continue
  for parent in set(parents):
   children.setdefault(parent,set()).add(row['ID']);edges+=1;need(edges<=200000,'bounded-cache-parent-child-edge-count')
   if parent not in index:missing_parents.add(parent)
 def show_ids(values):
  values=sorted(values);return {'count':len(values),'ids':values[:1000],'idsTruncated':len(values)>1000}
 def eligibility(values):
  actual=[index[i]for i in values if i in index];return {'metadataEligibleCount':len(set(values)&eligible_ids),'notMetadataEligibleCount':len(set(values)-eligible_ids),'reclaimableTrueCount':sum(r['Reclaimable']for r in actual),'sharedTrueCount':sum(r['Shared']for r in actual),'mutableTrueCount':sum(r['Mutable']for r in actual),'regularTypeCount':sum(r['Type']=='regular'for r in actual)}
 closures=[]
 for root in CACHE_ROOT_IDS:
  seen=set();todo=list(children.get(root,set()))
  while todo:
   node=todo.pop()
   if node==root or node in seen:continue
   seen.add(node);need(len(seen)<=20000,'bounded-observed-cache-descendant-closure');todo.extend(children.get(node,set())-seen)
  outside=seen-set(CACHE_ROOT_IDS);closures.append({'rootID':root,'rootPresent':root in index,'rootMetadataEligible':root in eligible_ids,'directChildren':show_ids(children.get(root,set())),'observedDescendants':show_ids(seen),'descendantsOutsideSixSelectedRoots':show_ids(outside),'descendantEligibility':eligibility(seen),'outsideSixEligibility':eligibility(outside)})
 types={}
 for row in rows:types[row['Type']]=types.get(row['Type'],0)+1
 return {'allRecords':len(rows),'metadataEligibleRecords':len(eligible_ids),'metadataEligibilityCondition':'Reclaimable true, Shared false, Mutable false and Type regular; no age condition','allRecordTypes':types,'parentChildEdges':edges,'unknownParentsEncoding':show_ids(unknown_encoding),'unlistedReferencedParentIDs':show_ids(missing_parents),'completeObservedParentsEncoding':not unknown_encoding,'allRecordEligibility':eligibility(set(index)),'sixRootObservedDescendantClosures':closures,'graphIsObservedCacheMetadataOnly':True,'causeOfNoReclaimNotEstablished':True,'ageAndSizeDisplayNotParsed':True,'metadataEligibilityDoesNotEstablishAgeOrDeletionEligibility':True}

def complete_cache_graph():
 # Metadata GETs only; same default builder as the already executed single prune.
 all_raw=command(['docker','buildx','--builder','default','du','--format=json'],90,16*1024**2);rows=safe_cache_records(all_raw);private('cache-du-all.private.json',rows)
 # Exactly one full metadata GET. Boolean/type eligibility is calculated locally.
 # Display LastUsedAt is retained as evidence and never treated as exact age.
 summary=cache_graph_summary(rows);summary.update(allSafeMetadataFile='cache-du-all.private.json',allSafeMetadataSHA256=sha(enc(rows)),allRawStdoutSHA256=sha(all_raw),descriptionFieldsPersisted=False,cleanupPerformed=False,pruneOutputBodyUnavailable=True,reclaimedByteAmountNotInferred=True);return summary


def capacity_profile(P,docker_root):
 value=original_capacity_profile(P,docker_root);value['r3SealedMaintenanceEvidence']=maintenance_evidence(docker_root);value['postgresVisibilityRole']=visibility_role(P);value['completeCacheDependencyMetadata']=complete_cache_graph();return value

def main():
 need(EXECUTE is True and sys.argv[1:]==['diagnose']and os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_MODE')=='diagnose'and os.environ.get('RELEASE_ATTEMPT')=='1','explicit-first-fresh-readonly-profile');os.umask(0o077);need(re.fullmatch('[a-f0-9]{40}',SOURCE_BASE)and OUT.parent.is_dir()and not any(p.is_symlink()for p in(OUT.parent,*OUT.parent.parents))and not OUT.exists()and not OUT.is_symlink(),'fresh-own-private-evidence');OUT.mkdir(mode=0o700);v={'phase':'diagnose','mode':'diagnose','service':SERVICE,'sourceBaselineMain':SOURCE_BASE,'success':False,'readOnly':True,'lifecycleOrConfigOrBusinessWrites':False,'plaintextCredentialsWritten':False,'businessFileBodiesCopied':False}
 try:
  P=common();before,r=runtime();need(len(before)==46 and r['Id']=='0cfa8edaff44bbc74b4443b6dec444c90e2f115833ff9913abf8c9b6c462ef7a' and r['Image']=='sha256:adf5b723ca5f8edae60a0a0f12a3828b8cd488a99eeee6405b61092805620294','current-46-containers-and-accepted-quote-identity');v['allRuntime']=before;v['containerId']=r['Id'];v['runtime']=before[r['Id']];v['hostGitHead']=git('rev-parse','HEAD').decode().strip();need(v['hostGitHead']=='f22fbffa1789234fe1c78bf776f4dcb3fe867d0c','accepted-host-head-no-checkout');v['shared']={name:P.shared_file(name)for name in P.SHARED};v['sharedMatchObservedHost']=all(row['sha256']==sha(git('show',v['hostGitHead']+':'+name))for name,row in v['shared'].items());v['environmentFiles']={str(p.relative_to(ROOT)):P.shared_file(str(p))for p in ROOT.glob('.env*')if p.is_file()};need('.env.cloud.production'in v['environmentFiles'],'production-env-hash-present');v['gatewayAuth']=P.gateway_auth();v['unstaged']=P.dirty_summary(git('diff','--name-only','-z'));v['staged']=P.dirty_summary(git('diff','--cached','--name-only','-z'))
  images=json.loads(command(['docker','image','inspect','--format',P.IMAGE_FORMAT,ALIAS]));v['canonicalImage']=P.safe_image(images);need(v['canonicalImage']['id']=='sha256:fd09d39c1e43afe9ec5f37f7f5ff1e529b9a0bb140a0f2ce24a5bfe19a72249c','accepted-1043-durable-quote-canonical');v['sourceAndDependencySignature']=json.loads(command(['docker','exec','--user','0',r['Id'],'node','-e',CODE_PROBE],180,8*1024**2));v['sourceSummary']=P.source_inventory(r['Id']);source_path=OUT/'source-hashes.private.json';source=json.loads(source_path.read_bytes());v['completeSourceInventorySHA256']=sha(source_path.read_bytes());v['affectedSource']={n:source['actual'].get(n,{'absent':True})for n in AFFECTED};v['generatedLock']={'actual':source['actual'].get('package-lock.json',{'absent':True}),'expectedGitBlobSHA1':source['expectedGitBlobSHA1'].get('package-lock.json'),'preserveActualRuntimeGeneratedLock':True}
  need(v['unstaged']['trackedPathCount']==5 and v['unstaged']['rawPathInventorySHA256']=='74b8a9c5caefdc5a220f12cd14972229312beef004e76129d0fb2bb691a0507e' and v['staged']['trackedPathCount']==0,'five-unknown-dirty-paths-hash-only-preserved');v['startup']=P.startup_counts();v['rowInvariantRisk']={'countsAreNotFullRowOrDatabaseSnapshot':True,'startupGuardMustBeRecheckedAfterServiceGateBeforeStop':True,'singleStartupMayConsumeQuoteSectionSequence':v['startup']['expectedSingleStartupQuoteSectionSequenceIncrement'],'fullGatedRowSchemaUserAuthAndOtherSequenceEvidenceRequiredForDeploy':True,'noSequenceResetOrBusinessRestoreAuthorized':True};docker_root=json.loads(command(['docker','info','--format','{{json .DockerRootDir}}']));need(type(docker_root)is str and pathlib.Path(docker_root).is_absolute(),'actual-docker-root');space=os.statvfs(docker_root);v['space']={'available':space.f_bavail*space.f_frsize,'free':space.f_bfree*space.f_frsize};v['capacityMetadata']=capacity_profile(P,docker_root);after,_=runtime();need(before==after and git('rev-parse','HEAD').decode().strip()==v['hostGitHead'],'all-original-runtime-pids-and-host-head-unchanged');need(json.loads(command(['docker','exec','--user','0',r['Id'],'node','-e',CODE_PROBE],180,8*1024**2))==v['sourceAndDependencySignature'],'source-and-dependencies-stable-through-profile');v['allOriginalRuntimeUnchanged']=True;v['success']=True
 except Exception as e:v.update(errorType=type(e).__name__,stage=STAGE)
 v['resultSHA256']=sha(enc(v));private('result.private.json',v);wire(v);return 0 if v['success']else 1
if __name__=='__main__':sys.exit(main())
