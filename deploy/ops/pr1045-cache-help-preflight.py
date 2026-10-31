"""INERT fresh Quote profile; no lifecycle, business writes or old-phase replay."""
import hashlib,importlib.util,json,os,pathlib,re,stat,subprocess,sys
ROOT=pathlib.Path('/opt/rr-portal');OUT=ROOT/'deploy/backups/pr1045-quote-preflight-2'
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


def cache_help_linkage():
 # CLI help, version and builder inspection only; never --bootstrap or prune.
 help_meta,body=optional_metadata(['docker','builder','prune','--help'])
 help_meta['flags']={n:help_meta['returncode']==0 and ('--'+n).encode()in body for n in('keep-storage','filter','force','all')}
 help_meta['dryRunAdvertised']=help_meta['returncode']==0 and b'--dry-run'in body
 if help_meta['returncode']==0:help_meta['text']=body.decode('utf-8','strict')
 version_meta,body=optional_metadata(['docker','version','--format','{{json .}}']);versions={}
 if version_meta['returncode']==0:
  raw=json.loads(body)
  for k in('Client','Server'):
   if type(raw.get(k))is dict:versions[k]={n:raw[k].get(n)for n in('Version','ApiVersion','APIVersion','GitCommit','Os','Arch')if n in raw[k]}
 info_meta,body=optional_metadata(['docker','info','--format','{{json .}}']);engine={}
 if info_meta['returncode']==0:
  raw=json.loads(body);engine={k:raw.get(k)for k in('ID','DockerRootDir','ServerVersion','Driver','OSType','Architecture')}
 context_meta,body=optional_metadata(['docker','context','show']);context=None
 if context_meta['returncode']==0:
  context=body.decode().strip();need(re.fullmatch(r'[A-Za-z0-9_.-]{1,128}',context)is not None,'typed-docker-context-name')
 endpoint_meta,body=optional_metadata(['docker','context','inspect','--format','{{json .Endpoints.docker.Host}}']);endpoint=None
 if endpoint_meta['returncode']==0:
  endpoint=json.loads(body);need(type(endpoint)is str and len(endpoint)<=8192,'bounded-current-context-endpoint');endpoint_meta['endpointSHA256']=sha(endpoint.encode());endpoint_meta['localSocket']=endpoint.startswith(('unix://','npipe://'))
 inspect_meta,body=optional_metadata(['docker','buildx','inspect']);builder={};endpoints=[]
 if inspect_meta['returncode']==0:
  for line in body.decode('utf-8','strict').splitlines():
   m=re.fullmatch(r'(Name|Driver|Endpoint|Status|BuildKit):\s*(.*)',line)
   if not m:continue
   k,value=m.groups()
   if k=='Endpoint':endpoints.append({'sha256':sha(value.encode()),'matchesDockerContextName':value==context,'matchesDockerContextEndpoint':value==endpoint})
   elif k in('Name','Driver')and k not in builder:builder[k]=value
  builder['nodes']=endpoints
 env={k:{'present':k in os.environ,'sha256':sha(os.environ[k].encode())if k in os.environ else None}for k in('DOCKER_HOST','DOCKER_CONTEXT','BUILDX_BUILDER')}
 linked=bool(context and builder.get('Driver')=='docker'and len(endpoints)==1 and (endpoints[0]['matchesDockerContextName']or endpoints[0]['matchesDockerContextEndpoint'])and endpoint_meta.get('localSocket')and not env['DOCKER_HOST']['present'])
 return {'builderPruneHelp':help_meta,'dockerVersionQuery':version_meta,'versions':versions,'dockerInfoQuery':info_meta,'engine':engine,'contextQuery':context_meta,'contextName':context,'contextEndpointQuery':endpoint_meta,'selectedBuilderInspectQuery':inspect_meta,'selectedBuilder':builder,'dockerOverrideEnvironmentHashes':env,'duAndEngineDefaultBuilderLinkageObserved':linked,'linkageBasis':'docker-driver selected builder endpoint matches same current local context; docker info engine ID and version observed with same CLI environment; no bootstrap','noPruneOrLifecyclePerformed':True,'maintenanceAuthorized':False}
def capacity_profile(P,docker_root):
 value=original_capacity_profile(P,docker_root);value['cacheHelpAndEngineLinkage']=cache_help_linkage();return value

def main():
 need(EXECUTE is True and sys.argv[1:]==['diagnose']and os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_MODE')=='diagnose'and os.environ.get('RELEASE_ATTEMPT')=='1','explicit-first-fresh-readonly-profile');os.umask(0o077);need(re.fullmatch('[a-f0-9]{40}',SOURCE_BASE)and OUT.parent.is_dir()and not any(p.is_symlink()for p in(OUT.parent,*OUT.parent.parents))and not OUT.exists()and not OUT.is_symlink(),'fresh-own-private-evidence');OUT.mkdir(mode=0o700);v={'phase':'diagnose','mode':'diagnose','service':SERVICE,'sourceBaselineMain':SOURCE_BASE,'success':False,'readOnly':True,'lifecycleOrConfigOrBusinessWrites':False,'plaintextCredentialsWritten':False,'businessFileBodiesCopied':False}
 try:
  P=common();before,r=runtime();need(len(before)==46 and r['Id']=='0cfa8edaff44bbc74b4443b6dec444c90e2f115833ff9913abf8c9b6c462ef7a' and r['Image']=='sha256:adf5b723ca5f8edae60a0a0f12a3828b8cd488a99eeee6405b61092805620294','current-46-containers-and-accepted-quote-identity');v['allRuntime']=before;v['containerId']=r['Id'];v['runtime']=before[r['Id']];v['hostGitHead']=git('rev-parse','HEAD').decode().strip();need(v['hostGitHead']=='f22fbffa1789234fe1c78bf776f4dcb3fe867d0c','accepted-host-head-no-checkout');v['shared']={name:P.shared_file(name)for name in P.SHARED};v['sharedMatchObservedHost']=all(row['sha256']==sha(git('show',v['hostGitHead']+':'+name))for name,row in v['shared'].items());v['environmentFiles']={str(p.relative_to(ROOT)):P.shared_file(str(p))for p in ROOT.glob('.env*')if p.is_file()};need('.env.cloud.production'in v['environmentFiles'],'production-env-hash-present');v['gatewayAuth']=P.gateway_auth();v['unstaged']=P.dirty_summary(git('diff','--name-only','-z'));v['staged']=P.dirty_summary(git('diff','--cached','--name-only','-z'))
  images=json.loads(command(['docker','image','inspect','--format',P.IMAGE_FORMAT,ALIAS]));v['canonicalImage']=P.safe_image(images);need(v['canonicalImage']['id']=='sha256:fd09d39c1e43afe9ec5f37f7f5ff1e529b9a0bb140a0f2ce24a5bfe19a72249c','accepted-1043-durable-quote-canonical');v['sourceAndDependencySignature']=json.loads(command(['docker','exec','--user','0',r['Id'],'node','-e',CODE_PROBE],180,8*1024**2));v['sourceSummary']=P.source_inventory(r['Id']);source_path=OUT/'source-hashes.private.json';source=json.loads(source_path.read_bytes());v['completeSourceInventorySHA256']=sha(source_path.read_bytes());v['affectedSource']={n:source['actual'].get(n,{'absent':True})for n in AFFECTED};v['generatedLock']={'actual':source['actual'].get('package-lock.json',{'absent':True}),'expectedGitBlobSHA1':source['expectedGitBlobSHA1'].get('package-lock.json'),'preserveActualRuntimeGeneratedLock':True}
  need(v['unstaged']['trackedPathCount']==5 and v['unstaged']['rawPathInventorySHA256']=='74b8a9c5caefdc5a220f12cd14972229312beef004e76129d0fb2bb691a0507e' and v['staged']['trackedPathCount']==0,'five-unknown-dirty-paths-hash-only-preserved');v['startup']=P.startup_counts();v['rowInvariantRisk']={'countsAreNotFullRowOrDatabaseSnapshot':True,'startupGuardMustBeRecheckedAfterServiceGateBeforeStop':True,'singleStartupMayConsumeQuoteSectionSequence':v['startup']['expectedSingleStartupQuoteSectionSequenceIncrement'],'fullGatedRowSchemaUserAuthAndOtherSequenceEvidenceRequiredForDeploy':True,'noSequenceResetOrBusinessRestoreAuthorized':True};docker_root=json.loads(command(['docker','info','--format','{{json .DockerRootDir}}']));need(type(docker_root)is str and pathlib.Path(docker_root).is_absolute(),'actual-docker-root');space=os.statvfs(docker_root);v['space']={'available':space.f_bavail*space.f_frsize,'free':space.f_bfree*space.f_frsize};v['capacityMetadata']=capacity_profile(P,docker_root);after,_=runtime();need(before==after and git('rev-parse','HEAD').decode().strip()==v['hostGitHead'],'all-original-runtime-pids-and-host-head-unchanged');need(json.loads(command(['docker','exec','--user','0',r['Id'],'node','-e',CODE_PROBE],180,8*1024**2))==v['sourceAndDependencySignature'],'source-and-dependencies-stable-through-profile');v['allOriginalRuntimeUnchanged']=True;v['success']=True
 except Exception as e:v.update(errorType=type(e).__name__,stage=STAGE)
 v['resultSHA256']=sha(enc(v));private('result.private.json',v);wire(v);return 0 if v['success']else 1
if __name__=='__main__':sys.exit(main())
