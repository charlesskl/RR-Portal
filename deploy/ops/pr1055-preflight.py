"""INERT read-only TOMY deployment discovery; no build, login or lifecycle writes.

No uploaded document bodies, environment files, credentials or RAM output buffers
are read. Runtime code/static files are hashed; temporary folders get metadata only.
"""
import datetime,hashlib,json,os,pathlib,re,stat,subprocess,sys,urllib.request,urllib.error
EXECUTE=False
ROOT=pathlib.Path('/opt/rr-portal')
OUT=ROOT/'deploy/backups/pr1055-preflight-1-20261102'
BRANCH='refs/heads/codex/ops-pr1055-20261102'
APP='apps/业务部/TOMY排期核对系统'
SERVICE='tomy-paiqi'
BASE='2fb0757be0d132149130f0331818116b3e136d11'
APP_TREE='8722a96ea2b5a1c6d64af719a9970bca268be938'
LAST_RESULT=ROOT/'deploy/backups/pr1054-engineering-1-20261102/verify2/result.private.json'
LAST_SHA='4e4a9e8434a66caa8e71efe6d6d2c643629bf0c706b14b0a7a85de9ab3a307a0'
CANONICAL='rr-portal-tomy-paiqi:latest'
ENGINEERING_CANONICAL='rr-portal-gongcheng-ziliao:latest'
ENGINEERING_IMAGE='sha256:2ca19e15756ab37fd6f25832b2a2d9790f952b0c36a5a8719301f84671d3c909'
HOST_HEAD='f22fbffa1789234fe1c78bf776f4dcb3fe867d0c'
HOST_DIRTY_SHA='74b8a9c5caefdc5a220f12cd14972229312beef004e76129d0fb2bb691a0507e'
SHARED=('docker-compose.cloud.yml','frontend/index.cloud.html','nginx/nginx.cloud.conf','deploy/update-server.sh','deploy/service-maintenance.sh')
ROOT_CODE=('package.json','package-lock.json','Dockerfile','tsconfig.json','shims.js','server.cjs','start.js')
STATIC_DIRS=('client/dist','server/client/dist','dist','dist-portable/client/dist')
TEMP_DIRS=('tmp','uploads','temp','output','outputs','data','server/uploads','server/tmp','server/temp')
STAGE='entry'
def enc(v):return json.dumps(v,sort_keys=True,separators=(',',':'),ensure_ascii=True,allow_nan=False).encode()
def sha(v):return hashlib.sha256(v).hexdigest()
def need(v,label):
 global STAGE
 STAGE=label
 if not v:raise RuntimeError(label)
def command(args,body=None,timeout=45,limit=16*1024**2):
 r=subprocess.run(args,input=body,capture_output=True,timeout=timeout,cwd=ROOT);need(len(r.stdout)<=limit and len(r.stderr)<=1024**2,'bounded-readonly-command-output');need(r.returncode==0,'fixed-readonly-command-success');return r.stdout
def private(name,value):
 need(re.fullmatch('[a-z0-9.-]+',name)is not None,'fixed-own-evidence-name');fd=os.open(OUT/name,os.O_CREAT|os.O_EXCL|os.O_WRONLY|os.O_NOFOLLOW,0o600)
 with os.fdopen(fd,'wb')as f:f.write(value if type(value)is bytes else enc(value));f.flush();os.fsync(f.fileno())
 fd=os.open(OUT,os.O_RDONLY|os.O_DIRECTORY)
 try:os.fsync(fd)
 finally:os.close(fd)
def signature(s):return(s.st_dev,s.st_ino,s.st_mode,s.st_uid,s.st_gid,s.st_size,s.st_mtime_ns,s.st_ctime_ns)
def record(path,limit=128*1024**2,git_blob=False):
 need(not path.is_symlink(),'public-runtime-file-not-alias');fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
 try:
  a=os.fstat(fd);need(stat.S_ISREG(a.st_mode)and 0<=a.st_size<=limit,'bounded-public-runtime-file');h=hashlib.sha256();g=hashlib.sha1(('blob '+str(a.st_size)+'\0').encode());size=0
  while True:
   body=os.read(fd,1024**2)
   if not body:break
   size+=len(body);need(size<=limit,'bounded-code-file-read');h.update(body)
   if git_blob:g.update(body)
  need(size==a.st_size and signature(a)==signature(os.fstat(fd))==signature(path.lstat()),'public-runtime-file-stable-during-hash');v={'bytes':size,'sha256':h.hexdigest(),'mode':stat.S_IMODE(a.st_mode),'uid':a.st_uid,'gid':a.st_gid}
  if git_blob:v['gitBlobSHA1']=g.hexdigest()
  return v
 finally:os.close(fd)
def last_result():
 need(LAST_RESULT.is_file()and not LAST_RESULT.is_symlink()and LAST_RESULT.stat().st_size<=2*1024**2,'bounded-latest1054-verify2-receipt');raw=LAST_RESULT.read_bytes();need(sha(raw)==LAST_SHA,'exact-latest1054-verify2-body');v=json.loads(raw);core=dict(v);seal=core.pop('resultSHA256',None);need(v['success']is True and v['phase']=='verify2'and seal==sha(enc(core)),'successful-latest1054-self-sealed-runtime');return v['details']['runtime']
def runtime():
 ids=command(['docker','ps','-aq','--no-trunc']).decode().split();need(len(ids)==len(set(ids))==46 and all(re.fullmatch('[a-f0-9]{64}',cid)for cid in ids),'all46-original-container-identities');rows=json.loads(command(['docker','inspect',*ids]));need({r['Id']for r in rows}==set(ids),'complete46-in-memory-inspection');safe={}
 for r in rows:
  s=r['State'];safe[r['Id']]={'image':r['Image'],'configSHA256':sha(enc(r['Config'])),'hostConfigSHA256':sha(enc(r['HostConfig'])),'envSHA256':sha(enc(sorted(r['Config'].get('Env')or[]))),'mountsSHA256':sha(enc(sorted(r['Mounts'],key=enc))),'pid':s['Pid'],'started':s['StartedAt'],'restarts':r['RestartCount'],'running':s['Running'],'oom':s['OOMKilled'],'health':s.get('Health',{}).get('Status')}
 def one(service):
  found=[r for r in rows if(r['Config'].get('Labels')or{}).get('com.docker.compose.project')=='rr-portal'and(r['Config'].get('Labels')or{}).get('com.docker.compose.service')==service];need(len(found)==1,'one-specific-compose-service');r=found[0];need(r['State']['Running']and not r['State']['OOMKilled']and r['State'].get('Health',{}).get('Status')=='healthy','specific-service-running-healthy');return r
 return safe,one(SERVICE),one('nginx')
def host():
 head=command(['git','-c','core.hooksPath=/dev/null','rev-parse','HEAD']).decode().strip();dirty=command(['git','-c','core.hooksPath=/dev/null','diff','--name-only','-z']);staged=command(['git','-c','core.hooksPath=/dev/null','diff','--cached','--name-only','-z']);need(head==HOST_HEAD and len([x for x in dirty.split(b'\0')if x])==5 and sha(dirty)==HOST_DIRTY_SHA and not staged,'host-checkout-five-existing-dirty-paths-preserved');return {'head':head,'dirtyCount':5,'dirtyInventorySHA256':sha(dirty),'stagedCount':0,'selectedPublicFiles':{n:record(ROOT/n,8*1024**2)for n in SHARED},'environmentFilePayloadNotRead':True}
def image(alias):
 rows=json.loads(command(['docker','image','inspect',alias],limit=4*1024**2));need(len(rows)==1 and re.fullmatch('sha256:[a-f0-9]{64}',rows[0]['Id'])is not None,'one-specific-current-image');r=rows[0];return {'id':r['Id'],'configSHA256':sha(enc(r['Config'])),'rootFSSHA256':sha(enc(r['RootFS'])),'created':r['Created'],'bytes':r['Size']}
def app_root(app):
 root=pathlib.Path('/proc')/str(app['State']['Pid'])/'root/app';need(root.is_dir()and not root.is_symlink(),'actual-running-tomy-app-root');return root
def safe_relative(name):return bool(name)and not name.startswith('/')and '\\'not in name and not any(p in('','..','.')or p.startswith('.env')or p in('node_modules','.git')for p in pathlib.PurePosixPath(name).parts)
def public_tree(root,prefix,limit=256*1024**2):
 folder=root/prefix
 if not folder.exists():need(not folder.is_symlink(),'missing-runtime-directory-not-dangling-link');return None
 need(folder.is_dir()and not folder.is_symlink(),'runtime-directory-is-real');files={};total=0
 for parent,dirs,names in os.walk(folder,followlinks=False):
  need(all(not(pathlib.Path(parent)/n).is_symlink()for n in dirs),'runtime-directory-parents-not-aliases')
  for name in sorted(names):
   path=pathlib.Path(parent)/name;rel=path.relative_to(root).as_posix();need(safe_relative(rel),'runtime-code-only-public-safe-path');r=record(path,128*1024**2,True);files[rel]=r;total+=r['bytes'];need(len(files)<=2000 and total<=limit,'bounded-whole-public-runtime-tree')
 return {'files':files,'bytes':total,'manifestSHA256':sha(enc(files))}
def code(app):
 root=app_root(app);files={};rows=command(['git','-c','core.hooksPath=/dev/null','ls-tree','-r','-z',BASE,'--',APP]);expected={}
 for row in rows.split(b'\0'):
  if not row:continue
  meta,name=row.split(b'\t',1);mode,kind,blob=meta.decode().split();name=name.decode()[len(APP)+1:]
  if not(name in ROOT_CODE or name.startswith('server/')and name.endswith(('.ts','.js','.cjs','.mjs'))):continue
  need(kind=='blob'and mode in('100644','100755')and safe_relative(name),'known-code-path-is-regular-public-git-blob');expected[name]=blob
 # Never recursively read server/uploads or other untracked business folders.
 selected=set(ROOT_CODE)|set(expected)|{n[:-3]+'.js'for n in expected if n.endswith('.ts')}
 for name in sorted(selected):
  path=root/name
  if path.exists():
   need(not any(p.is_symlink()for p in path.parents if p!=root.parent and len(p.parts)>=len(root.parts)),'fixed-code-parent-not-alias');files[name]=record(path,128*1024**2,True)
  else:need(not path.is_symlink(),'missing-fixed-code-path-not-dangling-link')
 need('server/index.ts'in files or'server/index.js'in files or'server.cjs'in files,'actual-ts-or-bundled-server-entrypoint-discovered');tree=command(['git','-c','core.hooksPath=/dev/null','rev-parse',BASE+':'+APP]).decode().strip();need(tree==APP_TREE,'known-pr1055-source-baseline-app-tree');matches={n:files[n]['gitBlobSHA1']==h for n,h in expected.items()if n in files};private('runtime-code.private.json',files);return {'files':files,'fileCount':len(files),'manifestSHA256':sha(enc(files)),'baselineAppTree':tree,'gitComparableFiles':len(matches),'allComparableGitFilesMatch':all(matches.values()),'mismatchedPublicCodePaths':[n for n,v in matches.items()if not v],'ramOutputMapPreservationNotEstablished':True}
def statics(app):
 result={}
 for prefix in STATIC_DIRS:
  value=public_tree(app_root(app),prefix)
  if value is not None:result[prefix]=value
 need(result and any(prefix+'/index.html'in value['files']for prefix,value in result.items()),'actual-public-frontend-directory-discovered');private('runtime-static.private.json',result);return result
def metadata_folder(folder):
 if not folder.exists():need(not folder.is_symlink(),'missing-temp-folder-not-dangling-link');return {'exists':False,'documentContentRead':False}
 need(folder.is_dir()and not folder.is_symlink(),'selected-temp-root-real-directory');rows=[];size=0
 for parent,dirs,names in os.walk(folder,followlinks=False):
  for name in sorted(dirs+names):
   path=pathlib.Path(parent)/name;s=path.lstat();relative=path.relative_to(folder).as_posix();kind='dir'if stat.S_ISDIR(s.st_mode)else'file'if stat.S_ISREG(s.st_mode)else'link'if stat.S_ISLNK(s.st_mode)else'other';rows.append({'pathSHA256':sha(os.fsencode(relative)),'type':kind,'device':s.st_dev,'inode':s.st_ino,'mode':s.st_mode,'uid':s.st_uid,'gid':s.st_gid,'bytes':s.st_size,'mtimeNS':s.st_mtime_ns,'ctimeNS':s.st_ctime_ns});size+=s.st_size if kind=='file'else 0;need(len(rows)<=5000 and size<=1024**3,'bounded-temp-metadata-without-document-content-read')
 return {'exists':True,'entries':len(rows),'fileBytes':size,'metadataSHA256':sha(enc(rows)),'documentContentRead':False,'warmObservationNotGlobalAtomicSnapshot':True}
def temporary(app):
 root=app_root(app);result={name:metadata_folder(root/name)for name in TEMP_DIRS};result['container-/tmp']=metadata_folder(pathlib.Path('/proc')/str(app['State']['Pid'])/'root/tmp');top=[]
 for path in sorted(root.iterdir()):
  s=path.lstat();top.append({'nameSHA256':sha(os.fsencode(path.name)),'mode':s.st_mode,'uid':s.st_uid,'gid':s.st_gid,'bytes':s.st_size,'inode':s.st_ino,'mtimeNS':s.st_mtime_ns,'ctimeNS':s.st_ctime_ns})
 result['appTopLevelMetadata']={'entries':len(top),'sha256':sha(enc(top)),'unknownFilePayloadsNotRead':True};return result
def descendants(pid):
 found={pid};pairs=[]
 for path in pathlib.Path('/proc').iterdir():
  if not path.name.isdecimal():continue
  try:raw=(path/'stat').read_text();pairs.append((int(path.name),int(raw[raw.rfind(')')+2:].split()[1])))
  except FileNotFoundError:continue
 while True:
  extra={child for child,parent in pairs if parent in found}-found
  if not extra:return found
  found|=extra
def activity(app):
 rows=[];writes=0
 for pid in sorted(descendants(app['State']['Pid'])):
  base=pathlib.Path('/proc')/str(pid)
  try:
   status={}
   for line in(base/'status').read_text().splitlines():
    key,_,value=line.partition(':')
    if key in('VmRSS','VmHWM','RssAnon','RssFile','Threads'):status[key]=value.strip()
   argv=(base/'cmdline').read_bytes();rows.append({'pid':pid,'cmdlineSHA256':sha(argv),'status':status,'nodeProcess':pathlib.Path(os.readlink(base/'exe')).name=='node'})
   for fd in(base/'fd').iterdir():
    try:
     target=os.readlink(fd);flags=[line.split(':',1)[1].strip()for line in(base/'fdinfo'/fd.name).read_text().splitlines()if line.startswith('flags:')];need(len(flags)==1,'one-process-fd-flags-value');writable=(int(flags[0],8)&os.O_ACCMODE)in(os.O_WRONLY,os.O_RDWR)
     if writable and any(target.startswith(p)for p in('/app/uploads/','/app/tmp/','/app/temp/','/tmp/','/data/')):writes+=1
    except FileNotFoundError:continue
  except FileNotFoundError:continue
 connections=0
 for name in('tcp','tcp6'):
  for row in(pathlib.Path('/proc')/str(app['State']['Pid'])/'net'/name).read_text().splitlines()[1:]:
   fields=row.split()
   if fields[3]=='01'and int(fields[1].rsplit(':',1)[1],16)==3006:connections+=1
 return {'processes':rows,'rssBytesTotal':sum(int(r['status'].get('VmRSS','0 kB').split()[0])*1024 for r in rows),'activeLocal3006Connections':connections,'selectedTempDataWriteFDs':writes,'ramOutputMapNotInspected':True,'noProcessInjectionOrHeapSnapshot':True}
NODE=r'''const fs=require('fs'),http=require('http'),crypto=require('crypto');const H=b=>crypto.createHash('sha256').update(b).digest('hex');const get=p=>new Promise(resolve=>{const r=http.get({host:'127.0.0.1',port:3006,path:p,headers:{Connection:'close'}},s=>{const parts=[];let n=0;s.on('data',b=>{n+=b.length;if(n>2097152){s.destroy();resolve({errorType:'bounded'})}else parts.push(b)});s.on('end',()=>resolve({status:s.statusCode,bytes:n,sha256:H(Buffer.concat(parts))}));s.on('error',e=>resolve({errorType:e.name}))});r.setTimeout(8000,()=>{r.destroy();resolve({errorType:'Timeout'})});r.on('error',e=>resolve({errorType:e.name}))});(async()=>{const v={node:process.version,dependencies:{}};for(const name of['express','multer','exceljs','pdfjs-dist','pdf-parse','tsx','typescript']){try{v.dependencies[name]=JSON.parse(fs.readFileSync('/app/node_modules/'+name+'/package.json','utf8')).version}catch(e){v.dependencies[name]=null}}v.health=await get('/health');v.root=await get('/');console.log(JSON.stringify(v))})().catch(()=>process.exitCode=1);'''
def properties(app):
 configured={}
 for item in app['Config'].get('Env')or[]:
  key,sep,value=item.partition('=');need(sep and key not in configured,'unique-configured-environment-keys');configured[key]=value
 options=configured.get('NODE_OPTIONS','');heap=re.findall(r'(?:^|\s)--max-old-space-size=(\d{2,5})(?=\s|$)',options);selected={'PORT':configured.get('PORT'),'NODE_ENV':configured.get('NODE_ENV'),'nodeHeapMiB':int(heap[0])if len(heap)==1 else None,'nodeOptionsSHA256':sha(options.encode())};need(selected['PORT']=='3006'and selected['NODE_ENV']=='production','fixed-tomy-public-runtime-port-and-mode');h=app['HostConfig'];network=app['NetworkSettings'];v=json.loads(command(['docker','exec',app['Id'],'node','-e',NODE],limit=1024**2));return {'actualContainer':app['Id'],'image':app['Image'],'configuredImageNameSHA256':sha(app['Config']['Image'].encode()),'publicSettings':selected,'memoryLimit':h['Memory'],'memorySwap':h['MemorySwap'],'portBindingsSHA256':sha(enc(h.get('PortBindings'))),'noPublishedPorts':not h.get('PortBindings')and not h.get('PublishAllPorts')and all(value is None for value in(network.get('Ports')or{}).values()),'networkModeSHA256':sha(h['NetworkMode'].encode()),'mountCount':len(app['Mounts']),'mountsSHA256':sha(enc(app['Mounts'])),'mounts':[{'destination':v['Destination'],'type':v['Type'],'rw':v['RW'],'sourcePathSHA256':sha(v['Source'].encode())}for v in app['Mounts']],'nodeAndReadOnlyHTTP':v,'installedLock':record(app_root(app)/'node_modules/.package-lock.json',4*1024**2)if(app_root(app)/'node_modules/.package-lock.json').exists()else None}
def gateway():
 class NoRedirect(urllib.request.HTTPRedirectHandler):
  def redirect_request(self,*args,**kwargs):return None
 opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),NoRedirect());rows={}
 for path in('/','/tomy-paiqi/','/tomy-paiqi/health','/gongcheng-ziliao/health','/indo-shipping/api/health','/qc/api/health','/internal-quote/health'):
  try:
   try:r=opener.open(urllib.request.Request('http://127.0.0.1'+path,headers={'Connection':'close','Cache-Control':'no-cache'}),timeout=12)
   except urllib.error.HTTPError as error:r=error
   with r:body=r.read(2*1024**2+1);code=r.code
   need(len(body)<=2*1024**2,'bounded-gateway-response-body');rows[path]={'status':code,'bytes':len(body),'sha256':sha(body)}
  except Exception as error:rows[path]={'errorType':type(error).__name__}
 return rows
def capacity():
 fs=os.statvfs('/var/lib/docker');mem={}
 for line in pathlib.Path('/proc/meminfo').read_text().splitlines():
  key,_,value=line.partition(':')
  if key in('MemAvailable','MemTotal'):mem[key]=int(value.strip().split()[0])*1024
 return {'available':fs.f_bavail*fs.f_frsize,'free':fs.f_bfree*fs.f_frsize,**mem}
def wire(v):
 raw=enc(v);need(len(raw)<=2*1024**2,'bounded-numeric-safe-result');nib=lambda value:[int(c,16)for c in(format(value,'x')if type(value)is int else value)];pieces=[raw[i:i+1024]for i in range(0,len(raw),1024)];digest=nib(sha(raw))
 for i,body in enumerate(pieces):print(enc([0,nib(i+1),nib(len(pieces)),nib(len(raw)),digest,nib(body.hex())]).decode(),flush=True)
 print(enc([1,nib(len(pieces)),nib(len(raw)),digest]).decode(),flush=True)
def main():
 need(EXECUTE is True and sys.argv[1:]==['diagnose']and os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_MODE')=='diagnose'and os.environ.get('RELEASE_ATTEMPT')=='1','inert-first-readonly-tomy-discovery');os.umask(0o077);space=capacity();need(space['available']>=1024**3+8*1024**2 and space['free']>=8*1024**3+8*1024**2 and space['MemAvailable']>=1024**3,'ordinary-one-gib-physical-eight-gib-and-memory-one-gib-floors');need(OUT.parent.is_dir()and not any(p.is_symlink()for p in(OUT.parent,*OUT.parent.parents))and not OUT.exists()and not OUT.is_symlink(),'fresh-private-tomy-readonly-evidence');OUT.mkdir(mode=0o700);result={'phase':'diagnose','success':False,'readOnly':True,'businessWrites':False,'lifecycleWrites':False,'configurationWrites':False,'credentialsOrEnvironmentFilesRead':False,'fullDataBackupCreated':False,'startedUtc':datetime.datetime.now(datetime.timezone.utc).isoformat()}
 try:
  previous=last_result();before,app,nginx=runtime();need(before==previous['runtime'],'all46-match-latest1054-verify2');result['allRuntime']=before;h=host();canonical=image(CANONICAL);engineering=image(ENGINEERING_CANONICAL);need(engineering['id']==ENGINEERING_IMAGE,'last-engineering-canonical-preserved');source=code(app);static=statics(app);result.update(host=h,canonical=canonical,engineeringCanonical=engineering,properties=properties(app),activity=activity(app),source=source,static=static,temporary=temporary(app),gateway=gateway(),capacity=capacity());after,app2,nginx2=runtime();need(after==before and host()==h and image(CANONICAL)==canonical and image(ENGINEERING_CANONICAL)==engineering and code_repeat(app2)==source and statics_repeat(app2)==static,'all-runtime-host-source-static-aliases-stable-during-readonly-observation');result['success']=True
 except Exception as error:result.update(errorType=type(error).__name__,stage=STAGE)
 result['finishedUtc']=datetime.datetime.now(datetime.timezone.utc).isoformat();result['resultSHA256']=sha(enc(result));private('result.private.json',result);wire(result);return 0 if result['success']else 1
def repeated(function,prefix,app):
 original=private
 def alternate(name,value):return original(prefix+name,value)
 globals()['private']=alternate
 try:return function(app)
 finally:globals()['private']=original
def code_repeat(app):return repeated(code,'repeat-',app)
def statics_repeat(app):return repeated(statics,'repeat-',app)
if __name__=='__main__':sys.exit(main())
