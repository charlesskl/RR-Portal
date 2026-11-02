"""INERT read-only engineering rollback preflight; no build/lifecycle/data mutation.

Business names/content and secret-bearing Docker Config/Env remain private/in memory.
A warm file inventory is per-file stable, not a globally atomic backup or snapshot.
"""
import datetime,hashlib,json,os,pathlib,re,stat,subprocess,sys,urllib.request,urllib.error

EXECUTE=False
ROOT=pathlib.Path('/opt/rr-portal')
OUT=ROOT/'deploy/backups/pr1054-preflight-1-20261102'
BRANCH='refs/heads/codex/ops-pr1054-20261102'
APP='apps/工程部/工程资料管理系统'
SERVICE='gongcheng-ziliao'
CID='b5f672104239d9a68a6792e632d9d90601afe4d7832f8eea423ea14e6e871c7c'
LIVE_IMAGE='sha256:d678092aef9e194584a7397074e673b07e9e538519ba67b25c91e0f023992d17'
CANONICAL='rr-portal-gongcheng-ziliao:latest'
CANONICAL_ID='sha256:bb50746bc22dccebe3a33277a131a7b464e6bbcb752e1e98cf9dbaef95b9a05e'
INDO_CANONICAL='rr-portal-indo-shipping:latest'
INDO_CANONICAL_ID='sha256:51b0e822e58671ff523f0212bae7a7f7593e1c46c2882418df0594374498f31f'
SOURCE='91178c35b2013d32dc02808ece1d81924d567d0d'
SOURCE_TREE='ff7afc1432e3bbc72ad708233fc7cae5bf2685ba'
HOST_HEAD='f22fbffa1789234fe1c78bf776f4dcb3fe867d0c'
HOST_DIRTY_SHA='74b8a9c5caefdc5a220f12cd14972229312beef004e76129d0fb2bb691a0507e'
LAST_RESULT=ROOT/'deploy/backups/pr1053-static-2-20261102/deploy/result.private.json'
LAST_RESULT_SHA='850293a8799431ee3a5abeeaa52f60b94f09a4143c83ebcf751b92ffd8f7574a'
SHARED=('docker-compose.cloud.yml','frontend/index.cloud.html','nginx/nginx.cloud.conf','deploy/update-server.sh','deploy/service-maintenance.sh','.env.cloud.production')
ROOT_CODE=('vite.config.ts','vite-plugin-docs-api.ts','vite-plugin-xlsx-images.ts','epms-store.ts','epms-auth.ts','docs-trash.ts','tailwind.config.js','postcss.config.js','tsconfig.json','tsconfig.app.json','tsconfig.node.json','index.html','package.json','package-lock.json')
CONFIG_SHA='1a1745df3bfe3b5fde9305f0578a434ee83fc50c362d0a9d18a45c2b633ab195'
INSTALLED_LOCK_SHA='72612a06d62c7f553d246be913a50d9fde3b5a482a0e5edbd013eea127cbd757'
STAGE='entry'

def enc(v):return json.dumps(v,sort_keys=True,separators=(',',':'),ensure_ascii=True,allow_nan=False).encode()
def sha(v):return hashlib.sha256(v).hexdigest()
def need(v,label):
 global STAGE
 STAGE=label
 if not v:raise RuntimeError(label)
def command(args,body=None,timeout=45,limit=16*1024**2):
 r=subprocess.run(args,input=body,capture_output=True,timeout=timeout,cwd=ROOT)
 need(len(r.stdout)<=limit and len(r.stderr)<=1024**2,'bounded-fixed-readonly-command-output')
 need(r.returncode==0,'fixed-readonly-command-success');return r.stdout
def private(name,body):
 need(re.fullmatch('[a-z0-9.-]+',name)is not None,'fixed-private-evidence-name')
 fd=os.open(OUT/name,os.O_CREAT|os.O_EXCL|os.O_WRONLY|os.O_NOFOLLOW,0o600)
 with os.fdopen(fd,'wb')as f:f.write(body if type(body)is bytes else enc(body));f.flush();os.fsync(f.fileno())
 fd=os.open(OUT,os.O_RDONLY|os.O_DIRECTORY)
 try:os.fsync(fd)
 finally:os.close(fd)

def record(path,limit=128*1024**2,git_blob=False):
 need(not path.is_symlink(),'selected-regular-file-not-link')
 fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
 try:
  a=os.fstat(fd);need(stat.S_ISREG(a.st_mode)and 0<=a.st_size<=limit,'bounded-selected-regular-file')
  h=hashlib.sha256();g=hashlib.sha1();g.update(('blob '+str(a.st_size)+'\0').encode());size=0
  while True:
   b=os.read(fd,1024**2)
   if not b:break
   size+=len(b);need(size<=limit,'bounded-selected-file-read');h.update(b)
   if git_blob:g.update(b)
  z=os.fstat(fd);key=lambda s:(s.st_dev,s.st_ino,s.st_mode,s.st_uid,s.st_gid,s.st_size,s.st_mtime_ns,s.st_ctime_ns)
  need(key(a)==key(z)==key(path.lstat())and size==a.st_size,'selected-file-stable-during-read')
  v={'bytes':size,'sha256':h.hexdigest(),'mode':stat.S_IMODE(a.st_mode),'uid':a.st_uid,'gid':a.st_gid}
  if git_blob:v['gitBlobSHA1']=g.hexdigest()
  return v
 finally:os.close(fd)

def runtime():
 ids=command(['docker','ps','-aq','--no-trunc']).decode().split();need(len(ids)==len(set(ids))==46 and all(re.fullmatch('[a-f0-9]{64}',x)for x in ids),'current46-original-containers')
 rows=json.loads(command(['docker','inspect',*ids]));need({x['Id']for x in rows}==set(ids),'complete46-in-memory-inspection')
 safe={}
 for r in rows:
  s=r['State'];safe[r['Id']]={'image':r['Image'],'configSHA256':sha(enc(r['Config'])),'hostConfigSHA256':sha(enc(r['HostConfig'])),'envSHA256':sha(enc(sorted(r['Config'].get('Env')or[]))),'mountsSHA256':sha(enc(sorted(r['Mounts'],key=enc))),'pid':s['Pid'],'started':s['StartedAt'],'restarts':r['RestartCount'],'running':s['Running'],'oom':s['OOMKilled'],'health':s.get('Health',{}).get('Status')}
 def one(service):
  found=[r for r in rows if(r['Config'].get('Labels')or{}).get('com.docker.compose.project')=='rr-portal'and(r['Config'].get('Labels')or{}).get('com.docker.compose.service')==service]
  need(len(found)==1,'one-fixed-compose-service');r=found[0];need(r['State']['Running']and not r['State']['OOMKilled']and r['State'].get('Health',{}).get('Status')=='healthy','fixed-compose-service-running-healthy');return r
 app=one(SERVICE);nginx=one('nginx');need(app['Id']==CID and app['Image']==LIVE_IMAGE,'same-known-engineering-cid-and-runtime-base')
 return safe,app,nginx

def last_runtime():
 need(LAST_RESULT.is_file()and not LAST_RESULT.is_symlink()and LAST_RESULT.stat().st_size<4*1024**2,'bounded-latest-deployment-receipt')
 raw=LAST_RESULT.read_bytes();need(sha(raw)==LAST_RESULT_SHA,'exact-latest1053-runtime-receipt');v=json.loads(raw);c=dict(v);s=c.pop('resultSHA256',None)
 need(v['success']is True and s==sha(enc(c))and v['phase']=='deploy','successful-latest-self-sealed-deployment');return v['details']['runtime']

def host():
 head=command(['git','-c','core.hooksPath=/dev/null','rev-parse','HEAD']).decode().strip();dirty=command(['git','-c','core.hooksPath=/dev/null','diff','--name-only','-z'],limit=1024**2);staged=command(['git','-c','core.hooksPath=/dev/null','diff','--cached','--name-only','-z'],limit=1024**2)
 need(head==HOST_HEAD and len([x for x in dirty.split(b'\0')if x])==5 and sha(dirty)==HOST_DIRTY_SHA and not staged,'last-observed-host-head-and-five-dirty-paths-preserved')
 return {'head':head,'dirtyCount':5,'dirtyInventorySHA256':sha(dirty),'stagedCount':0,'stagedInventorySHA256':sha(staged),'selectedFiles':{n:record(ROOT/n,8*1024**2)for n in SHARED}}

def auth(nginx):
 selected=[m for m in nginx['Mounts']if m.get('Destination')=='/etc/nginx/.htpasswd'];need(len(selected)==1 and selected[0]['Type']=='bind'and selected[0]['RW']is False,'one-readonly-actual-gateway-auth-bind')
 p=pathlib.Path(selected[0]['Source']);a=p.lstat();resolved=p.resolve(strict=True);value=record(resolved,1024**2);z=p.lstat();key=lambda s:(s.st_dev,s.st_ino,s.st_mode,s.st_uid,s.st_gid,s.st_mtime_ns,s.st_ctime_ns)
 need(key(a)==key(z),'gateway-auth-binding-stable');return {'file':value,'sourcePathSHA256':sha(os.fsencode(str(p))),'sourceType':'LNK'if stat.S_ISLNK(a.st_mode)else'REG','linkTextSHA256':sha(os.fsencode(os.readlink(p)))if stat.S_ISLNK(a.st_mode)else None}

def image(alias,expected):
 values=json.loads(command(['docker','image','inspect',alias],limit=4*1024**2));need(type(values)is list and len(values)==1 and values[0]['Id']==expected,'exact-last-accepted-canonical-image');v=values[0]
 return {'id':v['Id'],'configSHA256':sha(enc(v['Config'])),'rootFSSHA256':sha(enc(v['RootFS'])),'bytes':v['Size'],'created':v['Created']}

def app_root(app):
 p=pathlib.Path('/proc')/str(app['State']['Pid'])/'root/app';need(p.is_dir()and not p.is_symlink(),'existing-live-engineering-app-root');return p

def sources(app):
 need(command(['git','-c','core.hooksPath=/dev/null','rev-parse',SOURCE+':'+APP]).decode().strip()==SOURCE_TREE,'known-last-deployed-source-app-tree')
 entries=command(['git','-c','core.hooksPath=/dev/null','ls-tree','-r','-z',SOURCE,'--',APP]);expected={}
 for line in entries.split(b'\0'):
  if not line:continue
  metadata,name=line.split(b'\t',1);mode,kind,blob=metadata.decode().split();name=name.decode()[len(APP)+1:]
  if not(name.startswith(('src/','public/'))or name in ROOT_CODE):continue
  need(mode in('100644','100755')and kind=='blob'and not any(x in('.','..','资料库存储','node_modules','dist')or x.startswith('.env')for x in pathlib.PurePosixPath(name).parts)and name!='docs.config.json','only-public-source-not-live-config-data');expected[name]=blob
 need(0<len(expected)<=2000,'bounded-complete-public-runtime-source');root=app_root(app);actual={}
 for name in expected:
  p=root/name
  for parent in p.parents:
   if parent==root:break
   need(not parent.is_symlink(),'no-public-runtime-source-parent-link')
  actual[name]=record(p,32*1024**2,True)
 need(all(actual[n]['gitBlobSHA1']==blob for n,blob in expected.items()),'every-current-runtime-source-equals-last-deployed91178c');private('runtime-public-source.private.json',actual)
 return {'revision':SOURCE,'appTree':SOURCE_TREE,'fileCount':len(actual),'manifestSHA256':sha(enc(actual)),'allPublicSourceExact':True}

def static(app,persist=True):
 root=app_root(app)/'dist';need(root.is_dir()and not root.is_symlink(),'existing-real-dist-root');files={};total=0
 for parent,dirs,names in os.walk(root,followlinks=False):
  need(all(not(pathlib.Path(parent)/n).is_symlink()for n in dirs),'no-static-directory-links')
  for name in sorted(names):
   p=pathlib.Path(parent)/name;n=p.relative_to(root).as_posix();r=record(p,32*1024**2);files[n]=r;total+=r['bytes'];need(len(files)<=1200 and total<=256*1024**2,'bounded-whole-live-static-tree')
 need('index.html'in files,'existing-index-present')
 if persist:private('runtime-static.private.json',files)
 return {'files':files,'fileCount':len(files),'bytes':total,'manifestSHA256':sha(enc(files))}

def data_inventory(root):
 need(root.is_dir()and not any(p.is_symlink()for p in(root,*root.parents)),'real-original-bound-data-directory');entries=[];total=0;epms={'files':0,'bytes':0};trash={'files':0,'bytes':0};formats={}
 identity=lambda s:(s.st_dev,s.st_ino,s.st_mode,s.st_uid,s.st_gid,s.st_size,s.st_mtime_ns,s.st_ctime_ns)
 def walk(folder):
  nonlocal total
  a=folder.lstat();children=sorted(folder.iterdir())
  for p in children:
   before=p.lstat();name=p.relative_to(root).as_posix();row={'path':name,'uid':before.st_uid,'gid':before.st_gid,'mode':stat.S_IMODE(before.st_mode),'mtimeNS':before.st_mtime_ns,'ctimeNS':before.st_ctime_ns,'device':before.st_dev,'inode':before.st_ino}
   if stat.S_ISDIR(before.st_mode):row['type']='dir'
   elif stat.S_ISREG(before.st_mode):
    r=record(p,4*1024**3);row.update(type='file',bytes=r['bytes'],sha256=r['sha256']);total+=r['bytes'];need(total<=16*1024**3,'bounded-complete-engineering-data-read')
    ext=p.suffix.lower();bucket=ext if ext in('.xlsx','.xls','.json','.pdf','.png','.jpg','.jpeg','.zip','.docx','.doc','.txt','.dwg','.step','.stp')else'other';f=formats.setdefault(bucket,{'files':0,'bytes':0});f['files']+=1;f['bytes']+=r['bytes']
    if '.epms'in p.relative_to(root).parts:epms['files']+=1;epms['bytes']+=r['bytes']
    if '.回收站'in p.relative_to(root).parts:trash['files']+=1;trash['bytes']+=r['bytes']
   elif stat.S_ISLNK(before.st_mode):row.update(type='link',linkTextSHA256=sha(os.fsencode(os.readlink(p))))
   else:need(False,'no-special-business-files')
   entries.append(row);need(len(entries)<=20000,'bounded-business-inventory-entry-count')
   if row['type']=='dir':walk(p)
   need(identity(before)==identity(p.lstat()),'whole-entry-stable-across-metadata-and-content-observation')
  z=folder.lstat();need((a.st_dev,a.st_ino,a.st_mode,a.st_uid,a.st_gid,a.st_mtime_ns,a.st_ctime_ns)==(z.st_dev,z.st_ino,z.st_mode,z.st_uid,z.st_gid,z.st_mtime_ns,z.st_ctime_ns),'directory-stable-during-warm-observation')
 root_stat=root.lstat();walk(root);inventory={'root':{'uid':root_stat.st_uid,'gid':root_stat.st_gid,'mode':stat.S_IMODE(root_stat.st_mode),'inode':root_stat.st_ino,'device':root_stat.st_dev,'mtimeNS':root_stat.st_mtime_ns,'ctimeNS':root_stat.st_ctime_ns},'entries':entries}
 summary={'files':sum(r['type']=='file'for r in entries),'entries':len(entries),'bytes':total,'links':sum(r['type']=='link'for r in entries),'sha256':sha(enc(inventory)),'epms':epms,'trash':trash,'formats':formats,'fullContentBackupCreated':False,'observation':'One per-file/directory-stable warm inventory, not a globally atomic snapshot. Cold gated inventory required at publication.'}
 return inventory,summary

NODE=r'''const fs=require('fs'),crypto=require('crypto'),dns=require('dns').promises;const H=b=>crypto.createHash('sha256').update(b).digest('hex');async function req(url,headers){try{const r=await fetch(url,{headers,redirect:'error',signal:AbortSignal.timeout(8000)});const reader=r.body?.getReader(),parts=[];let size=0;try{if(reader)for(;;){const x=await reader.read();if(x.done)break;size+=x.value.length;if(size>2*1024**2)throw Error('bounded');parts.push(x.value)}}finally{await reader?.cancel().catch(()=>{});reader?.releaseLock()}return{status:r.status,bytes:size,sha256:H(Buffer.concat(parts)),etag:r.headers.get('etag'),lastModified:r.headers.get('last-modified')}}catch(e){return{errorType:e.name}}} (async()=>{const v={node:process.version,dependencies:{}};for(const n of['vite','typescript','react','react-dom','exceljs']){const p='/app/node_modules/'+n+'/package.json';v.dependencies[n]=JSON.parse(fs.readFileSync(p,'utf8')).version}try{v.coreDNS={resolved:(await dns.lookup('core',{all:true})).length>0}}catch(e){v.coreDNS={resolved:false,errorType:e.code||e.name}}v.root=await req('http://127.0.0.1:3100/');v.invalidSession=await req('http://127.0.0.1:3100/api/epms/session',{Cookie:'rr_epms_session=diagnostic.invalid.token'});v.coreInvalidMe=await req('http://core:8000/api/auth/me',{Authorization:'Bearer diagnostic.invalid.token'});console.log(JSON.stringify(v))})().catch(()=>process.exitCode=1);'''

def dependencies(app):
 root=app_root(app);need((root/'node_modules').is_dir()and not(root/'node_modules').is_symlink(),'original-installed-dependency-directory');cfg=record(root/'docs.config.json',1024**2);lock=record(root/'node_modules/.package-lock.json',2*1024**2);need(cfg['sha256']==CONFIG_SHA and lock['sha256']==INSTALLED_LOCK_SHA,'original-private-config-and-installed-dependency-lock')
 env={}
 for item in app['Config'].get('Env')or[]:
  k,sep,v=item.partition('=');need(sep and k not in env,'unique-configured-environment-keys');env[k]=v
 actual=command(['docker','exec',CID,'cat','/proc/1/environ'],limit=1024**2);need(actual.endswith(b'\0'),'whole-actual-pid1-environment');process={}
 for part in actual.split(b'\0'):
  if part:k,sep,v=part.decode().partition('=');need(sep and k not in process,'unique-actual-process-environment');process[k]=v
 need(env.get('DOCS_ROOT')==process.get('DOCS_ROOT')=='/data','actual-and-configured-data-root-is-original-bound-data')
 v=json.loads(command(['docker','exec',CID,'node','-e',NODE],timeout=45,limit=1024**2));need(v['node']=='v20.20.2'and v['root']['status']==200 and v['invalidSession']['status']==401 and v['coreInvalidMe']['status']==401 and v['coreDNS']['resolved']is True,'existing-runtime-node-static-and-core-identity-chain')
 return {'configFile':cfg,'installedLock':lock,'actualProcessEnvSHA256':sha(actual),'actualDataRootVerified':True,**v}

def gateway():
 class NoRedirect(urllib.request.HTTPRedirectHandler):
  def redirect_request(self,*a,**kw):return None
 op=urllib.request.build_opener(urllib.request.ProxyHandler({}),NoRedirect());out={}
 paths={'/':401,'/gongcheng-ziliao/':401,'/gongcheng-ziliao/api/clients':401,'/indo-shipping/api/health':200,'/qc/api/health':200,'/internal-quote/health':200,'/paiji/health':200,'/sprayplan/api/health':200}
 for p,expected in paths.items():
  r=None
  try:r=op.open(urllib.request.Request('http://127.0.0.1'+p,headers={'Cache-Control':'no-cache'}),timeout=15)
  except urllib.error.HTTPError as error:r=error
  with r:b=r.read(2*1024**2+1);code=r.code
  need(code==expected and len(b)<=2*1024**2,'fixed-anonymous-gateway-readonly-status');out[p]={'status':code,'bytes':len(b),'sha256':sha(b)}
 return out

def capacity():
 fs=os.statvfs('/var/lib/docker');mem={}
 for line in pathlib.Path('/proc/meminfo').read_text().splitlines():
  k,_,v=line.partition(':')
  if k in('MemAvailable','MemTotal'):mem[k]=int(v.strip().split()[0])*1024
 return {'available':fs.f_bavail*fs.f_frsize,'free':fs.f_bfree*fs.f_frsize,**mem}

def wire(v):
 raw=enc(v);need(len(raw)<=2*1024**2,'bounded-safe-numeric-receipt');nib=lambda v:[int(c,16)for c in(format(v,'x')if type(v)is int else v)];pieces=[raw[i:i+1024]for i in range(0,len(raw),1024)];digest=nib(sha(raw))
 for i,b in enumerate(pieces):print(enc([0,nib(i+1),nib(len(pieces)),nib(len(raw)),digest,nib(b.hex())]).decode(),flush=True)
 print(enc([1,nib(len(pieces)),nib(len(raw)),digest]).decode(),flush=True)

def main():
 need(EXECUTE is True and sys.argv[1:]==['diagnose']and os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_MODE')=='diagnose'and os.environ.get('RELEASE_ATTEMPT')=='1','inert-first-readonly-engineering-preflight')
 os.umask(0o077);space=capacity();need(space['available']>=1024**3+32*1024**2 and space['free']>=8*1024**3+32*1024**2,'original-disk-floors-plus-bounded-readonly-evidence');need(OUT.parent.is_dir()and not any(p.is_symlink()for p in(OUT.parent,*OUT.parent.parents))and not OUT.exists(),'fresh-private-preflight-evidence');OUT.mkdir(mode=0o700)
 v={'phase':'diagnose','success':False,'readOnly':True,'businessWrites':False,'lifecycleWrites':False,'configurationWrites':False,'fullDataBackupCreated':False,'startedUtc':datetime.datetime.now(datetime.timezone.utc).isoformat()}
 try:
  before,app,nginx=runtime();v['allRuntime']=before;last=last_runtime();need(before==last['runtime'],'all46-runtime-equal-latest1053-success');h=host();a=auth(nginx);canonical=image(CANONICAL,CANONICAL_ID);indo=image(INDO_CANONICAL,INDO_CANONICAL_ID);source=sources(app);st=static(app);dep=dependencies(app)
  mounts=[m for m in app['Mounts']if m.get('Destination')=='/data'];need(len(app['Mounts'])==len(mounts)==1 and mounts[0]['Type']=='bind'and mounts[0]['RW']is True and pathlib.Path(mounts[0]['Source'])==ROOT/APP/'资料库存储','one-original-readwrite-documents-bind-only')
  inventory,data=data_inventory(pathlib.Path(mounts[0]['Source']));private('business-inventory.private.json',inventory)
  v.update(host=h,gatewayAuth=a,canonical=canonical,indoCanonical=indo,source=source,static=st,dependencies=dep,data=data,gateway=gateway(),capacity=capacity())
  after,app2,nginx2=runtime();need(before==after and h==host()and a==auth(nginx2)and canonical==image(CANONICAL,CANONICAL_ID)and indo==image(INDO_CANONICAL,INDO_CANONICAL_ID)and st==static(app2,False)and source==sources_repeat(app2),'all-original-runtime-host-auth-code-static-alias-stable-during-observation');v['success']=True
 except Exception as error:v.update(errorType=type(error).__name__,stage=STAGE)
 v['finishedUtc']=datetime.datetime.now(datetime.timezone.utc).isoformat();v['resultSHA256']=sha(enc(v));private('result.private.json',v);wire(v);return 0 if v['success']else 1

def sources_repeat(app):
 original=private
 def renamed(name,body):return original('repeat-'+name,body)
 globals()['private']=renamed
 try:return sources(app)
 finally:globals()['private']=original

if __name__=='__main__':sys.exit(main())
