"""INERT fresh read-only profile for QC, internal quote and Indo shipping.
No lifecycle, SQL writes, configuration changes, business-file copies or cleanup.
"""
import hashlib,importlib.util,json,os,pathlib,re,stat,subprocess,sys,urllib.request,urllib.error
ROOT=pathlib.Path('/opt/rr-portal');OUT=ROOT/'deploy/backups/pr1046-1049-preflight-4'
BRANCH='refs/heads/codex/ops-pr-1046-1049-20261031'
BASE='0d7599859e5e01e90e4bbcbe71a9bd4a0a77b417';EXECUTE=False
DEPS={'pr1035-quote-preflight.py':'2b2739aa00cad03bfce8472b7416d725364b8d4ed354a5a7e9ca905a47aaffa5','pr1044-indo-preflight.py':'940e9675d628bc0af628ac3964b9073069f99d682a7bc812960ac6e1b88d3004'}
APPS={'qc':'apps/生产部/品质管理系统','internal-quote':'apps/业务部/内部报价系统','indo-shipping':'apps/印尼小组/印尼走货明细'}
STAGE='entry'
def need(v,label):
 global STAGE
 STAGE=label
 if not v:raise RuntimeError(label)
def enc(v):return json.dumps(v,sort_keys=True,separators=(',',':'),ensure_ascii=True,allow_nan=False).encode()
def sha(v):return hashlib.sha256(v).hexdigest()
def command(args,data=None,timeout=120,limit=16*1024**2):
 r=subprocess.run(args,input=data,capture_output=True,cwd=ROOT,timeout=timeout,env=dict(os.environ,GIT_OPTIONAL_LOCKS='0',GIT_TERMINAL_PROMPT='0'))
 need(r.returncode==0 and len(r.stdout)<=limit and len(r.stderr)<=1024**2,'bounded-readonly-command-success');return r.stdout
def git(*args):return command(['git','-C',str(ROOT),'-c','core.hooksPath=/dev/null',*args])
def private(name,v):
 fd=os.open(OUT/name,os.O_CREAT|os.O_EXCL|os.O_WRONLY|os.O_NOFOLLOW,0o600)
 with os.fdopen(fd,'wb')as f:f.write(enc(v));f.flush();os.fsync(f.fileno())
def load(name):
 p=pathlib.Path(__file__).with_name(name);need(p.is_file()and not p.is_symlink()and sha(p.read_bytes())==DEPS[name],'pinned-inert-readonly-library')
 s=importlib.util.spec_from_file_location('batch1046_'+name.replace('.','_'),p);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);m.OUT=OUT;return m
def containers():
 ids=command(['docker','ps','-aq','--no-trunc']).decode().split();need(len(ids)==46 and len(set(ids))==46 and all(re.fullmatch('[a-f0-9]{64}',s)for s in ids),'all-46-existing-containers')
 rows=json.loads(command(['docker','inspect',*ids]));need({r['Id']for r in rows}==set(ids),'all-existing-container-inspects-in-memory')
 v={};targets={}
 for r in rows:
  v[r['Id']]={'image':r['Image'],'configSHA256':sha(enc(r['Config'])),'hostConfigSHA256':sha(enc(r['HostConfig'])),'envSHA256':sha(enc(sorted(r['Config'].get('Env')or[]))),'mountsSHA256':sha(enc(sorted(r['Mounts'],key=enc))),'pid':r['State']['Pid'],'started':r['State']['StartedAt'],'restarts':r['RestartCount'],'running':r['State']['Running'],'oom':r['State']['OOMKilled'],'health':r['State'].get('Health',{}).get('Status')}
  l=r['Config'].get('Labels')or{};service=l.get('com.docker.compose.service')
  if l.get('com.docker.compose.project')=='rr-portal'and service in APPS:
   need(service not in targets,'one-original-target-service');targets[service]=r
 need(set(targets)==set(APPS),'all-three-original-targets');return v,targets
SOURCE_PROBE=r"""const fs=require('fs'),path=require('path'),crypto=require('crypto'),items=JSON.parse(fs.readFileSync(0,'utf8'));let out={};if(!Array.isArray(items)||items.length>2000)throw Error('scope');for(const n of items){if(!/^[A-Za-z0-9_./-]+$/.test(n)||n.split('/').some(x=>x==='..'||x===''||x==='data'||x==='uploads'||x==='legacy-data')||/(^|\/)\.env(\.|$)/.test(n))throw Error('path');const p='/app/'+n;for(let d=path.dirname(p);d!=='/';d=path.dirname(d))if(fs.lstatSync(d).isSymbolicLink())throw Error('parentlink');if(!fs.existsSync(p)){out[n]={absent:true};continue;}const a=fs.lstatSync(p);if(!a.isFile()||a.isSymbolicLink()||a.size>128*1024**2)throw Error('file');const fd=fs.openSync(p,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);try{const b=fs.readFileSync(fd),z=fs.fstatSync(fd);if(b.length!==a.size||a.ino!==z.ino||a.mtimeMs!==z.mtimeMs||a.ctimeMs!==z.ctimeMs)throw Error('changed');out[n]={sha256:crypto.createHash('sha256').update(b).digest('hex'),gitBlobSHA1:crypto.createHash('sha1').update('blob '+b.length+'\0').update(b).digest('hex'),bytes:b.length,uid:a.uid,gid:a.gid,mode:a.mode&4095};}finally{fs.closeSync(fd);}}console.log(JSON.stringify(out));"""
def source(service,r):
 app=APPS[service];expected={}
 for row in git('ls-tree','-r','-z',BASE,'--',app).split(b'\0'):
  if not row:continue
  meta,name=row.split(b'\t',1);mode,kind,blob=meta.decode().split();n=name.decode()[len(app)+1:]
  if service=='internal-quote':take=n.startswith(('backend/','frontend/'))or n in('package.json','package-lock.json')
  else:take=(n.startswith('server/')or'/'not in n)and n.endswith(('.js','.html','.css','.json'))
  if not take or any(p in n.split('/')for p in('data','uploads','legacy-data','node_modules'))or n.startswith('.')or n.endswith(('.test.js','.test.json')):continue
  need(mode in('100644','100755')and kind=='blob'and re.fullmatch('[A-Za-z0-9_./-]+',n),'safe-fixed-tracked-code-only');expected[n]=blob
 need(1<=len(expected)<=2000,'bounded-code-file-inventory');actual=json.loads(command(['docker','exec','--user','0','-i',r['Id'],'node','-e',SOURCE_PROBE],enc(sorted(expected)),180))
 need(set(actual)==set(expected),'complete-actual-source-hashes');return {'expectedGitBlobSHA1':expected,'actual':actual,'differences':[n for n in expected if actual[n].get('gitBlobSHA1')!=expected[n]]}
def public():
 class NoRedirect(urllib.request.HTTPRedirectHandler):
  def redirect_request(self,*a,**kw):return None
 opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),NoRedirect());v={}
 for path,expected in(('/qc/api/health',200),('/internal-quote/health',200),('/internal-quote/api/auth/me',401),('/indo-shipping/api/health',200),('/indo-shipping/api/purchase',401),('/',401)):
  try:
   with opener.open(urllib.request.Request('http://127.0.0.1'+path,headers={'Cache-Control':'no-cache'}),timeout=20)as r:status=r.status;body=r.read(1024**2+1)
  except urllib.error.HTTPError as e:
   try:status=e.code;body=e.read(1024**2+1)
   finally:e.close()
  need(status==expected and len(body)<=1024**2,'expected-public-health-and-auth-protection');v[path]={'status':status,'bodySHA256':sha(body)}
 return v
def qc_capacity():
 root=ROOT/APPS['qc']/'data';need(root.is_dir()and not any(p.is_symlink()for p in(root,*root.parents)),'fixed-qc-data-real-root');v={'root':str(root.relative_to(ROOT)),'bytes':0,'regularFiles':0,'directories':1,'databases':0}
 for path in root.rglob('*'):
  s=path.lstat();need(not stat.S_ISLNK(s.st_mode)and(stat.S_ISREG(s.st_mode)or stat.S_ISDIR(s.st_mode)),'qc-capacity-regular-metadata-only')
  if stat.S_ISDIR(s.st_mode):v['directories']+=1
  else:
   v['regularFiles']+=1;v['bytes']+=s.st_size
   if path.suffix.lower()in('.db','.sqlite','.sqlite3'):v['databases']+=1
  need(v['regularFiles']+v['directories']<=100000 and v['bytes']<=32*1024**3,'bounded-qc-data-capacity-metadata')
 return v
def main():
 need(EXECUTE is True and sys.argv[1:]==['diagnose']and os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_MODE')=='diagnose'and os.environ.get('RELEASE_ATTEMPT')=='1','explicit-first-fresh-readonly-profile')
 os.umask(0o077);need(OUT.parent.is_dir()and not any(p.is_symlink()for p in(OUT.parent,*OUT.parent.parents))and not OUT.exists(),'fresh-private-profile');OUT.mkdir(mode=0o700)
 v={'phase':'diagnose','mode':'diagnose','success':False,'readOnly':True,'businessWrites':False,'lifecycleWrites':False,'configWrites':False,'plaintextCredentialsWritten':False,'businessFileBodiesCopied':False,'sourceBaseline':BASE}
 try:
  P=load('pr1035-quote-preflight.py');I=load('pr1044-indo-preflight.py');before,targets=containers();v['allRuntime']=before;v['hostGitHead']=git('rev-parse','HEAD').decode().strip();need(v['hostGitHead']=='f22fbffa1789234fe1c78bf776f4dcb3fe867d0c','observed-host-checkout-preserved')
  v['shared']={n:P.shared_file(n)for n in P.SHARED};v['env']={str(p.relative_to(ROOT)):P.shared_file(str(p))for p in ROOT.glob('.env*')if p.is_file()};v['gatewayAuth']=P.gateway_auth();v['unstaged']=P.dirty_summary(git('diff','--name-only','-z'));v['staged']=P.dirty_summary(git('diff','--cached','--name-only','-z'));v['targets']={}
  for name,r in targets.items():
   alias='rr-portal-'+name+':latest';image=json.loads(command(['docker','image','inspect',alias]))[0];labels=image['Config'].get('Labels')or{}
   entry={'id':r['Id'],'runtime':before[r['Id']],'mounts':r['Mounts'],'canonicalImage':{'id':image['Id'],'revision':labels.get('org.opencontainers.image.revision'),'rootfsSHA256':sha(enc(image['RootFS']))}}
   if name in('qc','internal-quote'):entry['source']=source(name,r)
   else:entry.update(wwwroot=I.web_inventory(r),backendFiles=I.backend_inventory(r))
   v['targets'][name]=entry
  v['quoteStartup']=P.startup_counts();v['qcData']=qc_capacity();docker_root=json.loads(command(['docker','info','--format','{{json .DockerRootDir}}']));fs=os.statvfs(docker_root);v['space']={'available':fs.f_bavail*fs.f_frsize,'free':fs.f_bfree*fs.f_frsize}
  v['memory']={k:int(a.split()[0])*1024 for k,_,a in(line.partition(':')for line in pathlib.Path('/proc/meminfo').read_text().splitlines())if k in('MemAvailable','MemTotal','SwapFree','SwapTotal')};v['public']=public();after,_=containers();need(before==after and git('rev-parse','HEAD').decode().strip()==v['hostGitHead']and all(P.shared_file(n)==row for n,row in v['shared'].items()),'runtime-and-shared-source-stable-during-readonly-profile');v['allRuntimeUnchanged']=True;v['success']=True
 except Exception as e:v.update(errorType=type(e).__name__,stage=STAGE)
 v['resultSHA256']=sha(enc(v));private('result.private.json',v);I=load('pr1044-indo-preflight.py');I.wire(v);return 0 if v['success']else 1
if __name__=='__main__':sys.exit(main())
