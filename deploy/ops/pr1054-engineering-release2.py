"""INERT explicit publication 2 after a proved no-stop busy abort.

Original data is never copied, restored, reset, migrated or deleted. A complete
public-runtime/private-docs-config code backup is streamed to a bounded gzip.
Every lifecycle/publication action is one-shot and has durable intent/receipts.
"""
import copy,datetime,gzip,hashlib,importlib.util,io,json,os,pathlib,re,shutil,stat,subprocess,sys,tarfile,time,urllib.request,urllib.error

EXECUTE=True
ROOT=pathlib.Path('/opt/rr-portal')
APP='apps/工程部/工程资料管理系统'
SERVICE='gongcheng-ziliao'
BRANCH='refs/heads/codex/ops-pr1054-20261102'
ARCHIVE=ROOT/'deploy/backups/pr1054-engineering-1-20261102'
P_FILE='pr1054-preflight.py'
P_SHA='ee2e6c388cc5f72a08c7a31824a5677f44089f39d592c7892a22c773c2cec171'
PREFLIGHT=ROOT/'deploy/backups/pr1054-preflight-1-20261102/result.private.json'
PREFLIGHT_SHA='6cddaecf34f94f89a0e1219dcbeb7dd45aaa67cbd64e8c72562bcd49acd5d47b'
BASE='114b5cc9867960518ebe70f6731475c97fec3747'
HEAD='c31ff76711fa54e3eabd20b8babb84c8f50aa668'
TARGET='2fb0757be0d132149130f0331818116b3e136d11'
APP_TREE='797d120b435afbf3867c9d871e97c764d2484592'
REVIEWED_PATHS=('index.html','src/App.tsx','src/components/EpmsAccount.tsx','src/components/StitchIcon.tsx','src/index.css','src/lib/api.ts','src/lib/dashboard.ts','src/sections/DashboardView.tsx','src/sections/DocEditor.tsx','src/sections/ProjectView.tsx','src/sections/SearchView.tsx','src/sections/WorkbenchView.tsx','src/types/index.ts','tailwind.config.js','tests/dashboard.test.cjs','tests/docs-client-access.test.cjs','tests/docs-navigation.test.cjs','tests/editor-legacy-path.test.cjs','tests/epms-backend.test.cjs','tests/epms-client.test.cjs','tests/retired-workbench-safety.test.cjs','vite-plugin-docs-api.ts','vite.config.ts')
PREPARE_SHA='fcaea97c008f3fbea36719423e02a31dc22a5ef58012e324086955d9ba53f540'
DEPLOY_SHA=''
FAILED_DEPLOY_SHA='17b0fc0e59b3ddcc29b5d72841c7437b69b1f64ff289db12594621de5ce4d861'
DIAG_RESULT=ROOT/'deploy/backups/pr1054-release-diagnose-1-20261102/result.private.json'
DIAG_SHA='738115577496ff613cfddd8da10e8b4f19ad2b5f5e96f016492c45ac8abb5168'
DIST_MANIFEST_FILE='pr1054-dist-manifest.json'
DIST_MANIFEST_SHA='8a16a8d8a713aa599f7c7d2b7826e52e1caa05e73d10049156bcc9abd4cd2d51'
PROVENANCE_FILE='pr1054-build-provenance.json'
PROVENANCE_SHA='2731fab8b671fb3e72a0acfb99051f95e7393690b40108bc91a9ec6a95b5a169'
DELTA_FILE='pr1054-dist-delta.tar.gz'
DELTA_SHA='8e0d12a361113a31cb4056f289630e30e5b22d59dddb846ce7e487429c61a2e5'
CANONICAL='rr-portal-gongcheng-ziliao:latest'
BASE_IMAGE='sha256:bb50746bc22dccebe3a33277a131a7b464e6bbcb752e1e98cf9dbaef95b9a05e'
CID='b5f672104239d9a68a6792e632d9d90601afe4d7832f8eea423ea14e6e871c7c'
CURRENT_SOURCE='91178c35b2013d32dc02808ece1d81924d567d0d'
SOURCE_TREE='ff7afc1432e3bbc72ad708233fc7cae5bf2685ba'
ROOT_CODE=('vite.config.ts','vite-plugin-docs-api.ts','vite-plugin-xlsx-images.ts','epms-store.ts','epms-auth.ts','docs-trash.ts','tailwind.config.js','postcss.config.js','tsconfig.json','tsconfig.app.json','tsconfig.node.json','index.html','package.json','package-lock.json','Dockerfile','.dockerignore')
SECURITY_CODE=('epms-store.ts','epms-auth.ts','docs-trash.ts')
MAX_DELTA=2*1024**2
MAX_RETIRED=1024**2
MAX_BACKUP=8*1024**2
SPACE_BUDGET=36*1024**2
P=None
OUT=None
STAGE='entry'
PRIMARY_FAILURE=None
STATE={'stage':'not-started','stopAttempted':False,'startAttempted':False,'retirementAttempted':False,'canonicalTagAttempted':False,'automaticRetryOrRollback':False,'businessDataRestoreOrMigration':False}

def enc(v):return json.dumps(v,sort_keys=True,separators=(',',':'),ensure_ascii=True,allow_nan=False).encode()
def sha(v):return hashlib.sha256(v).hexdigest()
def pin(v,n=64):return type(v)is str and re.fullmatch('[a-f0-9]{%d}'%n,v)is not None
def need(v,label):
 global STAGE
 STAGE=label
 if not v:raise RuntimeError(label)
def sync_dir(path):
 fd=os.open(path,os.O_RDONLY|os.O_DIRECTORY)
 try:os.fsync(fd)
 finally:os.close(fd)
def private(name,value):P.private(name,value if type(value)is bytes else enc(value))
def checkpoint(name,**values):STATE.update(values);private('operation-'+name+'.private.json',STATE)
def run(args,body=None,timeout=60,limit=32*1024**2):
 # Config/Env-bearing inspect stdout stays in memory. Never generic-log stdout.
 r=subprocess.run(args,input=body,capture_output=True,timeout=timeout,cwd=ROOT)
 need(len(r.stdout)<=limit and len(r.stderr)<=2*1024**2,'bounded-fixed-command-result')
 if r.returncode!=0:
  private('failed-command-'+str(time.time_ns())+'.private.json',{'family':args[:2],'exitCode':r.returncode,'stdoutSHA256':sha(r.stdout),'stderrSHA256':sha(r.stderr)})
  need(False,'fixed-command-failed-no-automatic-replay')
 return r.stdout
def git(*args):return run(['git','-c','core.hooksPath=/dev/null',*args])
def image(name):
 rows=json.loads(run(['docker','image','inspect',name],limit=4*1024**2));need(type(rows)is list and len(rows)==1 and pin(rows[0]['Id'].removeprefix('sha256:')),'one-fixed-image');return rows[0]
def app_inspect():
 rows=json.loads(run(['docker','inspect',CID],limit=4*1024**2));need(len(rows)==1 and rows[0]['Id']==CID and rows[0]['Image']==P.LIVE_IMAGE,'same-original-service-container-and-base-image');return rows[0]
def load():
 global P
 p=pathlib.Path(__file__).with_name(P_FILE);need(pin(P_SHA)and p.is_file()and not p.is_symlink()and sha(p.read_bytes())==P_SHA,'exact-reviewed-preflight-library')
 spec=importlib.util.spec_from_file_location('engineering1054_preflight',p);P=importlib.util.module_from_spec(spec);spec.loader.exec_module(P);P.OUT=OUT
def read_result(path,digest,phase):
 need(pin(digest)and path.is_file()and not path.is_symlink()and path.stat().st_size<4*1024**2,'bounded-source-bound-private-result');raw=path.read_bytes();need(sha(raw)==digest,'exact-prior-result-body');v=json.loads(raw);core=dict(v);s=core.pop('resultSHA256',None);need(s==sha(enc(core))and v['success']is True and v['phase']==phase,'successful-self-sealed-prior-phase');return v
def prepared():
 r=read_result(ARCHIVE/'prepare/result.private.json',PREPARE_SHA,'prepare');need(r['target']==TARGET and r['sourceHead']==HEAD,'same-reviewed-and-merged-prepare');path=ARCHIVE/'prepare/prepared.private.json';need(path.is_file()and not path.is_symlink()and path.stat().st_size<4*1024**2,'bounded-complete-prepared-plan');body=path.read_bytes();need(sha(body)==r['details']['preparedBodySHA256'],'sealed-full-prepared-plan');return json.loads(body)
def capacity(reserve=0):
 v=P.capacity();need(v['available']>=1024**3+reserve and v['free']>=8*1024**3+reserve and v['MemAvailable']>=1024**3,'one-gib-ordinary-eight-gib-physical-one-gib-memory-plus-bounded-own-growth');return v

def safe_name(name):
 return type(name)is str and bool(name)and len(name)<=300 and not any(ord(c)<32 for c in name)and '\\'not in name and not name.startswith('/')and pathlib.PurePosixPath(name).as_posix()==name and not any(x in('','..','.')or x.startswith('.env')or x in('资料库存储','node_modules','.git','docs.config.json','.epms')for x in pathlib.PurePosixPath(name).parts)
def runtime_name(name):return safe_name(name)and(name.startswith(('src/','public/'))or name in ROOT_CODE)
def source_map(revision):
 out={}
 for row in git('ls-tree','-r','-z',revision,'--',APP).split(b'\0'):
  if not row:continue
  meta,name=row.split(b'\t',1);mode,kind,blob=meta.decode().split();name=name.decode()[len(APP)+1:]
  if not runtime_name(name):continue
  need(mode in('100644','100755')and kind=='blob'and pin(blob,40),'only-regular-public-runtime-git-input');out[name]={'gitBlobSHA1':blob,'mode':int(mode,8)&0o777}
 need(0<len(out)<=2000,'bounded-complete-runtime-git-map');return out
def source_guard():
 need(all(pin(v,40)for v in(BASE,HEAD,TARGET,APP_TREE))and 0<len(REVIEWED_PATHS)<=64,'all-final-reviewed-main-source-pins')
 git('fetch','--no-write-fetch-head','origin','+refs/heads/main:refs/remotes/origin/main');need(git('rev-parse','refs/remotes/origin/main').decode().strip()==TARGET,'exact-normally-merged-main');git('merge-base','--is-ancestor',HEAD,TARGET)
 need(git('rev-parse',HEAD+':'+APP).decode().strip()==git('rev-parse',TARGET+':'+APP).decode().strip()==APP_TREE and git('rev-parse',BASE+':'+APP).decode().strip()==SOURCE_TREE,'current-review-and-actual-merged-app-trees')
 changed={x.decode()[len(APP)+1:]for x in git('diff','--name-only','-z',BASE,TARGET,'--',APP).split(b'\0')if x};need(changed==set(REVIEWED_PATHS),'exact-reviewed-application-path-scope')
 for n in SECURITY_CODE:need(git('show',HEAD+':'+APP+'/'+n)==git('show',CURRENT_SOURCE+':'+APP+'/'+n),'existing-core-identity-and-controlled-history-protection-kept')
 for n in('Dockerfile','package-lock.json'):need(git('show',HEAD+':'+APP+'/'+n)==git('show',CURRENT_SOURCE+':'+APP+'/'+n),'same-runtime-build-recipe-and-dependency-lock')
 old=json.loads(git('show',CURRENT_SOURCE+':'+APP+'/package.json'));new=json.loads(git('show',HEAD+':'+APP+'/package.json'));need({k:v for k,v in old.items()if k!='scripts'}=={k:v for k,v in new.items()if k!='scripts'}and new['scripts'].get('preview')==old['scripts'].get('preview')=='vite preview'and not any(n in new['scripts']for n in('prepreview','postpreview')),'same-installed-packages-and-original-preview-entrypoint-no-hooks')
 ignore=git('show',HEAD+':'+APP+'/.dockerignore').decode().splitlines();need('资料库存储'in ignore and '.env*'in ignore,'private-files-and-business-data-remain-excluded-from-future-builds')
 return source_map(CURRENT_SOURCE),source_map(HEAD)

def no_public_service_port(app):
 h=app['HostConfig'];s=app['NetworkSettings'];need(not h.get('PortBindings')and h.get('PublishAllPorts')is False and h.get('NetworkMode')not in('host','none','default','bridge')and not h.get('NetworkMode','').startswith('container:')and len(s.get('Networks')or{})==1 and all(v is None for v in(s.get('Ports')or{}).values()),'engineering-only-private-compose-bridge-no-public-port-gate-bypass')
 return {'noPublishedPorts':True,'singlePrivateComposeNetwork':True,'networkModeSHA256':sha(h['NetworkMode'].encode())}
def state():
 rows,app,nginx=P.runtime();no_public_service_port(app);return {'runtime':rows,'host':P.host(),'auth':P.auth(nginx),'canonical':image(CANONICAL)['Id']},app,nginx
def app_root(app):return P.app_root(app)
def current_profile(app,expected):
 root=app_root(app);actual={}
 for n in expected:
  p=root/n
  for parent in p.parents:
   if parent==root:break
   need(not parent.is_symlink(),'runtime-code-parent-not-symlink')
  actual[n]=P.record(p,32*1024**2,True)
 need(all(actual[n]['gitBlobSHA1']==v['gitBlobSHA1']for n,v in expected.items()),'each-selected-public-runtime-source-exact')
 for prefix in('src','public'):
  folder=root/prefix;seen=set()
  for parent,dirs,names in os.walk(folder,followlinks=False):
   need(all(not(pathlib.Path(parent)/n).is_symlink()for n in dirs),'runtime-source-no-parent-alias')
   for n in names:seen.add((pathlib.Path(parent)/n).relative_to(root).as_posix())
  need(seen=={n for n in expected if n.startswith(prefix+'/')},'entire-public-source-tree-has-no-unreviewed-extra-files')
 return actual
def config_profile(app):
 root=app_root(app);return {'docs.config.json':P.record(root/'docs.config.json',1024**2),'node_modules/.package-lock.json':P.record(root/'node_modules/.package-lock.json',2*1024**2)}

def write_public(root,name,body,mode=0o644):
 need(safe_name(name),'safe-owned-public-file');p=root/name;p.parent.mkdir(mode=0o700,parents=True,exist_ok=True)
 for parent in(p.parent,*p.parent.parents):
  if parent==root.parent:break
  need(not parent.is_symlink(),'owned-public-context-no-parent-link');os.chmod(parent,0o755)
 fd=os.open(p,os.O_CREAT|os.O_EXCL|os.O_WRONLY|os.O_NOFOLLOW,mode)
 with os.fdopen(fd,'wb')as f:os.fchmod(f.fileno(),mode);f.write(body);f.flush();os.fsync(f.fileno())
 return p

def dist_delta(overlay,old):
 base=pathlib.Path(__file__).parent
 for n,digest,cap in((DIST_MANIFEST_FILE,DIST_MANIFEST_SHA,128*1024),(PROVENANCE_FILE,PROVENANCE_SHA,128*1024),(DELTA_FILE,DELTA_SHA,MAX_DELTA)):
  p=base/n;need(pin(digest)and p.is_file()and not p.is_symlink()and p.stat().st_size<=cap and sha(p.read_bytes())==digest,'exact-small-reviewed-local-build-artifact')
 manifest=json.loads((base/DIST_MANIFEST_FILE).read_bytes());provenance=json.loads((base/PROVENANCE_FILE).read_bytes());need(type(manifest)is dict and 1<=len(manifest)<=1200 and 'index.html'in manifest and all(safe_name(n)and pin(h)for n,h in manifest.items()),'complete-public-dist-manifest')
 expected={'sourceHead':HEAD,'appTree':APP_TREE,'manifestSHA256':DIST_MANIFEST_SHA,'sourceExtraction':'git-archive','freshExtraction':True,'freshNpmCi':True,'npmCiExitCode':0,'buildExitCode':0,'nodeModulesRootSymlink':False,'nodeModulesExternalSymlinks':0,'repeatBuildManifestEqual':True,'viteBase':'./'}
 need(type(provenance)is dict and all(provenance.get(k)==v for k,v in expected.items())and provenance.get('packageLockSHA256')==sha(git('show',HEAD+':'+APP+'/package-lock.json')),'same-clean-reviewed-repeated-build-and-lock')
 delta={'index.html':manifest['index.html']}
 for n,h in manifest.items():
  if n=='index.html':continue
  if n in old:need(old[n]['sha256']==h,'old-fixed-and-hashed-asset-body-never-overwritten')
  else:need(n.startswith('assets/')and n.endswith(('.js','.css')),'only-new-reviewed-content-hashed-assets');delta[n]=h
 seen=set();total=0
 with tarfile.open(base/DELTA_FILE,'r:gz')as tf:
  for entry in tf:
   need(entry.isfile()and safe_name(entry.name)and entry.name in delta and entry.name not in seen and 0<=entry.size<=MAX_DELTA,'delta-tar-only-exact-reviewed-regular-files');seen.add(entry.name);total+=entry.size;need(total<=MAX_DELTA,'delta-public-bytes-under-two-mib')
   body=tf.extractfile(entry).read(entry.size+1);need(len(body)==entry.size and sha(body)==delta[entry.name],'each-compiled-delta-body-exact');write_public(overlay,'dist/'+entry.name,body)
 need(seen==set(delta),'all-and-only-required-static-delta-files');return manifest,delta,total

class BoundedWriter:
 def __init__(self,stream,limit):self.stream=stream;self.limit=limit;self.total=0
 def write(self,body):need(self.total+len(body)<=self.limit,'bounded-compressed-complete-runtime-backup');n=self.stream.write(body);self.total+=n;return n
 def flush(self):self.stream.flush()

def backup_code(app,old_source,old_static,config):
 # Stream the complete selected public runtime and full static tree; no unpacked copy.
 root=app_root(app);expected={**old_source,**{'dist/'+n:r for n,r in old_static.items()},'docs.config.json':config['docs.config.json']};need(len(expected)<=4000,'bounded-complete-runtime-backup-paths');path=OUT/'old-runtime-code.private.tar.gz';fd=os.open(path,os.O_CREAT|os.O_EXCL|os.O_WRONLY|os.O_NOFOLLOW,0o600);metadata={}
 with os.fdopen(fd,'wb')as f:
  writer=BoundedWriter(f,MAX_BACKUP)
  with gzip.GzipFile(filename='',fileobj=writer,mode='wb',mtime=0)as gz,tarfile.open(fileobj=gz,mode='w|')as tf:
   for name,r in sorted(expected.items()):
    p=root/name;before=p.lstat();need(stat.S_ISREG(before.st_mode)and not p.is_symlink(),'regular-original-runtime-backup-file');body_fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW)
    with os.fdopen(body_fd,'rb')as data:
     info=tarfile.TarInfo(name);info.size=r['bytes'];info.mode=r['mode'];info.uid=r['uid'];info.gid=r['gid'];info.mtime=int(before.st_mtime);tf.addfile(info,data)
    after=p.lstat();identity=lambda s:(s.st_dev,s.st_ino,s.st_mode,s.st_uid,s.st_gid,s.st_size,s.st_mtime_ns,s.st_ctime_ns);need(identity(before)==identity(after)and P.record(p,32*1024**2)=={k:v for k,v in r.items()if k!='gitBlobSHA1'},'original-runtime-code-stable-during-streamed-backup');metadata[name]={**r,'mtimeNS':before.st_mtime_ns,'ctimeNS':before.st_ctime_ns}
  f.flush();os.fsync(f.fileno())
 sync_dir(OUT);observed={}
 with tarfile.open(path,'r|gz')as tf:
  for entry in tf:
   need(entry.isfile()and entry.name in expected and entry.name not in observed and entry.size==expected[entry.name]['bytes'],'verified-complete-private-backup-entry-set');body=tf.extractfile(entry).read(entry.size+1);need(len(body)==entry.size and sha(body)==expected[entry.name]['sha256'],'verified-original-backup-content');observed[entry.name]=True
 need(set(observed)==set(expected),'verified-complete-runtime-backup-no-user-data');private('old-runtime-code-metadata.private.json',metadata)
 return {'path':'old-runtime-code.private.tar.gz','files':len(expected),'compressedBytes':path.stat().st_size,'sha256':sha(path.read_bytes()),'privateDocsConfigIncluded':True,'businessDataIncluded':False,'installedDependenciesReusedFromImmutableBase':True}

def retirement_script(root='/app'):
 need(root=='/app'or EXECUTE is False,'production-retirement-root-fixed-to-app')
 script=r"""const fs=require('fs'),path=require('path'),crypto=require('crypto');
const ROOT=__ROOT__,H=b=>crypto.createHash('sha256').update(b).digest('hex');
const v=JSON.parse(process.argv[1]||fs.readFileSync(0,'utf8')),fail=s=>{throw Error(s)};
if(!/^[a-f0-9]{40}$/.test(v.target)||!Array.isArray(v.entries)||v.entries.length>100)fail('manifest');
const rootStat=fs.lstatSync(ROOT);if(!rootStat.isDirectory()||rootStat.isSymbolicLink())fail('root');
const scope=n=>typeof n==='string'&&n.length<300&&!Array.from(n).some(c=>c.charCodeAt(0)<32)&&!n.startsWith('/')&&!n.includes(String.fromCharCode(92))&&!n.split('/').some(p=>!p||p==='.'||p==='..'||p.startsWith('.env')||['资料库存储','node_modules','dist','.git','.epms','docs.config.json'].includes(p))&&(n.startsWith('src/')||n==='tailwind.config.js');
const sig=s=>[s.dev,s.ino,s.mode,s.uid,s.gid,s.size,s.mtimeNs,s.ctimeNs].map(String).join(':');
const parents=p=>{for(let d=path.dirname(p);d!==ROOT;d=path.dirname(d)){if(!d.startsWith(ROOT+path.sep)||fs.lstatSync(d).isSymbolicLink())fail('parent');}};
const sync=p=>{const f=fs.openSync(p,'r');try{fs.fsyncSync(f)}finally{fs.closeSync(f)}};
const signatures=new Map(),seen=new Set();let total=0;
// Validate the entire explicit old public-source CAS set before any mutation.
for(const e of v.entries){
 if(!scope(e.path)||seen.has(e.path)||!/^[a-f0-9]{64}$/.test(e.sha256)||!Number.isSafeInteger(e.bytes)||e.bytes<0||e.bytes>1048576)fail('scope');
 seen.add(e.path);total+=e.bytes;if(total>1048576)fail('bounded');
 const p=path.join(ROOT,e.path);parents(p);const before=fs.lstatSync(p,{bigint:true});
 if(!before.isFile()||before.isSymbolicLink()||Number(before.size)!==e.bytes||Number(before.uid)!==e.uid||Number(before.gid)!==e.gid||(Number(before.mode)&4095)!==e.mode)fail('metadata-cas');
 const fd=fs.openSync(p,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
 try{const opened=fs.fstatSync(fd,{bigint:true}),body=fs.readFileSync(fd);if(sig(before)!==sig(opened)||H(body)!==e.sha256||sig(before)!==sig(fs.fstatSync(fd,{bigint:true}))||sig(before)!==sig(fs.lstatSync(p,{bigint:true})))fail('content-cas');}finally{fs.closeSync(fd)}
 signatures.set(e.path,sig(before));
}
const base=path.join(ROOT,'.retired-pr1054'),dest=path.join(base,v.target);
if(fs.existsSync(base)){const s=fs.lstatSync(base);if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==process.getuid()||(s.mode&4095)!==448)fail('base')}
if(fs.existsSync(dest))fail('no-replay');
if(!fs.existsSync(base)){fs.mkdirSync(base,{mode:448});fs.chmodSync(base,448)}
fs.mkdirSync(dest,{mode:448});fs.chmodSync(dest,448);
const journal=(name,value)=>{const p=path.join(dest,name),f=fs.openSync(p,'wx',384);try{fs.fchmodSync(f,384);fs.writeFileSync(f,JSON.stringify(value));fs.fsyncSync(f)}finally{fs.closeSync(f)}sync(dest)};
journal('00-intent.json',v);
for(let i=0;i<v.entries.length;i++){
 const e=v.entries[i],source=path.join(ROOT,e.path),target=path.join(dest,e.path);
 if(signatures.get(e.path)!==sig(fs.lstatSync(source,{bigint:true})))fail('immediate-cas');
 fs.mkdirSync(path.dirname(target),{recursive:true,mode:448});
 for(let d=path.dirname(target);d!==dest;d=path.dirname(d)){if(fs.lstatSync(d).isSymbolicLink())fail('archive-parent');fs.chmodSync(d,448)}
 journal(String(i).padStart(3,'0')+'-intent.json',e);fs.renameSync(source,target);sync(path.dirname(source));sync(path.dirname(target));
 if(H(fs.readFileSync(target))!==e.sha256||fs.existsSync(source))fail('post');journal(String(i).padStart(3,'0')+'-ack.json',e);
}
journal('99-complete.json',{target:v.target,files:v.entries.length});sync(base);
console.log(JSON.stringify({target:v.target,files:v.entries.length,complete:true}));
"""
 return script.replace('__ROOT__',json.dumps(root))

def optional_image_id(name):
 r=subprocess.run(['docker','image','inspect','--format','{{.Id}}',name],capture_output=True,timeout=30,cwd=ROOT);need(len(r.stdout)<4096 and len(r.stderr)<65536,'bounded-specific-image-id-probe')
 if r.returncode==0:
  value=r.stdout.decode().strip();need(re.fullmatch(r'sha256:[a-f0-9]{64}',value)is not None,'typed-image-id');return value
 need(r.returncode==1 and not r.stdout.strip()and re.fullmatch(rb'(?:(?:Error response from daemon|Error): )?No such image: '+re.escape(name.encode())+rb'\s*',r.stderr)is not None,'explicit-specific-image-absence-only');return None

def default_builder():
 r=subprocess.run(['docker','buildx','inspect','default'],capture_output=True,timeout=30,cwd=ROOT);need(r.returncode==0 and len(r.stdout)<=1024**2 and len(r.stderr)<=1024**2,'read-existing-default-builder-without-bootstrap');selected={}
 for line in r.stdout.decode().splitlines():
  if line.strip()=='Nodes:':break
  k,sep,v=line.partition(':')
  if sep and k in('Name','Driver'):need(k not in selected,'unique-builder-profile-field');selected[k]=v.strip()
 need(selected=={'Name':'default','Driver':'docker'},'only-existing-local-docker-driver');private('builder-profile.private.json',{'profile':selected,'stdoutSHA256':sha(r.stdout),'stderrSHA256':sha(r.stderr)})

def build_candidate(context,retirement):
 default_builder();alias='rrportal-pr1054-base:'+BASE_IMAGE.split(':',1)[1];tag='rrportal-gongcheng-pr1054:'+TARGET
 need(optional_image_id(alias)in(None,BASE_IMAGE)and optional_image_id(tag)is None,'own-base-reference-and-fresh-candidate-tag')
 run(['docker','tag',BASE_IMAGE,alias],limit=1024);need(image(alias)['Id']==BASE_IMAGE,'frozen-local-named-base-reference')
 body='FROM '+alias+'\nCOPY --chown=0:0 overlay/ /app/\n'
 if retirement['entries']:body+='RUN '+json.dumps(['node','-e',retirement_script(),enc(retirement).decode()],ensure_ascii=True)+'\n'
 body+='LABEL org.opencontainers.image.revision="'+TARGET+'" io.rr-portal.release-service="'+SERVICE+'" io.rr-portal.app-tree="'+APP_TREE+'"\n';(context/'Dockerfile').write_text(body)
 try:r=subprocess.run(['docker','buildx','build','--builder','default','--load','--network=none','--pull=false','--no-cache','--progress=plain','--tag',tag,str(context)],capture_output=True,timeout=240,cwd=ROOT)
 except subprocess.TimeoutExpired as error:
  private('image-build-stdout.private.log',error.stdout or b'');private('image-build-stderr.private.log',error.stderr or b'');raise
 need(len(r.stdout)<=4*1024**2 and len(r.stderr)<=4*1024**2,'bounded-private-build-output');private('image-build-stdout.private.log',r.stdout);private('image-build-stderr.private.log',r.stderr);private('image-build-status.private.json',{'exitCode':r.returncode,'stdoutSHA256':sha(r.stdout),'stderrSHA256':sha(r.stderr)})
 need(r.returncode==0 and image(alias)['Id']==BASE_IMAGE,'single-frozen-base-image-build-loaded-success');new=image(tag);old=image(BASE_IMAGE);a,b=copy.deepcopy(old['Config']),copy.deepcopy(new['Config']);a.pop('Image',None);b.pop('Image',None);a['Labels']=dict(a.get('Labels')or{},**{'org.opencontainers.image.revision':TARGET,'io.rr-portal.release-service':SERVICE,'io.rr-portal.app-tree':APP_TREE})
 need(a==b and old['Os']==new['Os']=='linux'and old['Architecture']==new['Architecture']and new['RootFS']['Layers'][:len(old['RootFS']['Layers'])]==old['RootFS']['Layers'],'all-original-image-config-env-entrypoint-user-health-platform-layers-preserved');return tag,new['Id']

def candidate_tar(cid,remote,limit=64*1024**2,directory=False):
 raw=run(['docker','cp',cid+':/app/'+remote,'-'],limit=limit);values={}
 with tarfile.open(fileobj=io.BytesIO(raw),mode='r:')as tf:
  for entry in tf:
   need(entry.isfile()or entry.isdir(),'candidate-public-paths-no-links');parts=pathlib.PurePosixPath(entry.name.rstrip('/')).parts;need(parts and all(p not in('','..','.')for p in parts),'candidate-safe-relative-tar-path')
   if entry.isdir():continue
   need(parts[0]==pathlib.PurePosixPath(remote).name,'docker-copy-exact-selected-basename');name='/'.join(parts[1:])if directory else parts[-1]
   need(name and name not in values and 0<=entry.size<=32*1024**2,'candidate-bounded-unique-regular-file');body=tf.extractfile(entry).read(entry.size+1);need(len(body)==entry.size,'complete-candidate-public-body');values[name]={'sha256':sha(body),'gitBlobSHA1':hashlib.sha1(('blob '+str(len(body))+'\0').encode()+body).hexdigest(),'bytes':len(body),'mode':entry.mode,'uid':entry.uid,'gid':entry.gid}
 need(len(values)<=2000,'bounded-candidate-file-inventory');return values

def candidate_proof(image_id,expected_source,expected_static,config,retirement):
 cid=run(['docker','create','--network','none',image_id],limit=4096).decode().strip();need(pin(cid),'owned-never-started-candidate-inspection-container')
 try:
  actual={}
  for prefix in('src','public'):
   actual.update({prefix+'/'+n:r for n,r in candidate_tar(cid,prefix,directory=True).items()})
  for name in expected_source:
   if name.startswith(('src/','public/')):continue
   rows=candidate_tar(cid,name);need(set(rows)=={pathlib.PurePosixPath(name).name},'one-specific-candidate-root-code-file');actual[name]=next(iter(rows.values()))
  need(set(actual)==set(expected_source)and all(actual[n]['sha256']==r['sha256']and actual[n]['gitBlobSHA1']==r['gitBlobSHA1']and actual[n]['mode']==r['mode']and actual[n]['uid']==actual[n]['gid']==0 for n,r in expected_source.items()),'entire-candidate-runtime-source-exact-and-retired-paths-gone')
  static=candidate_tar(cid,'dist',directory=True);need({n:r['sha256']for n,r in static.items()}==expected_static,'complete-candidate-old-new-static-union-exact')
  for name,r in config.items():
   rows=candidate_tar(cid,name);need(len(rows)==1 and next(iter(rows.values()))['sha256']==r['sha256'],'unchanged-candidate-private-config-and-installed-lock')
  if retirement['entries']:
   rows=candidate_tar(cid,'.retired-pr1054/'+TARGET,limit=4*1024**2,directory=True);expected={e['path']:e['sha256']for e in retirement['entries']};need(all(n in rows and rows[n]['sha256']==h for n,h in expected.items())and'99-complete.json'in rows and set(rows)==set(expected)|{'00-intent.json','99-complete.json'}|{str(i).zfill(3)+suffix+'.json'for i in range(len(expected))for suffix in('-intent','-ack')},'complete-candidate-explicit-retired-source-and-durable-journal-only')
  return {'neverStartedScratchInspected':True,'allRuntimeSourceAndStaticExact':True,'configAndInstalledLockPreserved':True}
 finally:
  rows=json.loads(run(['docker','inspect',cid],limit=4*1024**2));need(len(rows)==1 and rows[0]['Image']==image_id and rows[0]['State']['Status']=='created'and rows[0]['State']['Pid']==0,'only-own-never-started-scratch-can-be-removed');run(['docker','rm',cid],limit=1024)

def native_tests(candidate):
 paths={}
 for line in git('ls-tree','-r','--name-only','-z',HEAD,'--',APP+'/tests').split(b'\0'):
  if not line:continue
  full=line.decode();name=full[len(APP)+1:]
  if not(name.startswith('tests/')and name.endswith('.test.cjs')):continue
  need(safe_name(name)and'/'not in name[len('tests/'):],'only-direct-reviewed-native-test-files');body=git('show',HEAD+':'+full);need(len(body)<=256*1024,'bounded-native-tests');paths[name[len('tests/'):]]=sha(body);write_public(OUT/'reviewed-tests',name[len('tests/'):],body,0o444)
 need(0<len(paths)<=32,'all-reviewed-native-tests-required')
 script=r'''const fs=require('fs'),crypto=require('crypto'),cp=require('child_process');const expected=JSON.parse(fs.readFileSync(0,'utf8'));for(const[n,h]of Object.entries(expected)){if(!/^[A-Za-z0-9_.-]+[.]cjs$/.test(n))throw Error('scope');const p='/reviewed-tests/'+n,s=fs.lstatSync(p);if(!s.isFile()||s.isSymbolicLink())throw Error('file');const b=fs.readFileSync(p);if(crypto.createHash('sha256').update(b).digest('hex')!==h)throw Error('digest');fs.writeFileSync('/app/tests/'+n,b,{flag:'wx',mode:292})}const r=cp.spawnSync(process.execPath,['--test',...Object.keys(expected).map(n=>'/app/tests/'+n)],{stdio:'inherit',timeout:270000});if(r.error||r.signal||r.status===null)process.exit(1);process.exit(r.status);'''
 args=['docker','run','--rm','-i','--network','none','--read-only','--restart','no','--log-driver','none','--env','DOCS_ROOT=/tmp/isolated-documents','--env','NODE_OPTIONS=','--tmpfs','/tmp:rw,nosuid,nodev,size=256m,mode=1777','--tmpfs','/data:rw,nosuid,nodev,noexec,size=16m,mode=0700','--tmpfs','/app/tests:rw,nosuid,nodev,size=64m,mode=1777','--mount','type=bind,source='+str(OUT/'reviewed-tests')+',target=/reviewed-tests,readonly','--entrypoint','node',candidate,'-e',script]
 r=subprocess.run(args,input=enc(paths),capture_output=True,timeout=300,cwd=ROOT);need(len(r.stdout)<=4*1024**2 and len(r.stderr)<=2*1024**2,'bounded-offline-native-test-output');private('native-tests-stdout.private.log',r.stdout);private('native-tests-stderr.private.log',r.stderr);text=r.stdout.decode(errors='replace');counts={k:int(re.search(r'^# '+k+r' (\d+)\s*$',text,re.M)[1])for k in('tests','pass','fail','cancelled','skipped')};need(r.returncode==0 and counts['tests']==counts['pass']==25 and counts['fail']==counts['cancelled']==counts['skipped']==0,'all-final-native-tests-pass-without-business-mount-or-network');return counts

def patch_tar(overlay,paths):
 data=io.BytesIO();directories=set()
 with tarfile.open(fileobj=data,mode='w')as tf:
  for n in paths:
   for parent in pathlib.PurePosixPath(n).parents:
    if str(parent)!='.':directories.add(parent.as_posix())
  for n in sorted(directories,key=lambda n:(n.count('/'),n)):
   info=tarfile.TarInfo(n);info.type=tarfile.DIRTYPE;info.mode=0o755;info.uid=info.gid=0;info.mtime=int(time.time());tf.addfile(info)
  for n in sorted(paths):
   p=overlay/n;need(p.is_file()and not p.is_symlink(),'owned-code-overlay-regular');body=p.read_bytes();info=tarfile.TarInfo(n);info.size=len(body);info.mode=p.stat().st_mode&0o777;info.uid=info.gid=0;info.mtime=int(p.stat().st_mtime);tf.addfile(info,io.BytesIO(body))
 body=data.getvalue();need(len(body)<=MAX_DELTA,'raw-code-and-static-overlay-under-two-mib');return body

def old_profile(app,expected):
 selected={n:r for n,r in expected.items()if n not in('Dockerfile','.dockerignore')};actual=current_profile(app,selected);root=app_root(app)
 for name in('Dockerfile','.dockerignore'):
  path=root/name
  if not path.exists():need(not path.is_symlink(),'absent-build-metadata-not-dangling-link');continue
  r=P.record(path,1024**2,True);allowed={hashlib.sha1(('blob '+str(len(b))+'\0').encode()+b).hexdigest()for b in(git('show',CURRENT_SOURCE+':'+APP+'/'+name),git('show',P.HOST_HEAD+':'+APP+'/'+name))};need(r['gitBlobSHA1']in allowed,'explicit-existing-or-last-host-public-build-metadata');actual[name]=r
 return actual

def complete_source(app,expected):
 actual=current_profile(app,expected);need(actual==expected,'all-live-public-source-bytes-mode-owner-exact');return actual

def document_root(app):
 mounts=app['Mounts'];need(len(mounts)==1 and mounts[0].get('Destination')=='/data'and mounts[0].get('Type')=='bind'and mounts[0].get('RW')is True and pathlib.Path(mounts[0]['Source'])==ROOT/APP/'资料库存储','original-single-data-bind-no-remap');return pathlib.Path(mounts[0]['Source'])

def unchanged(before,after,own_restart=False):
 need(set(before['runtime'])==set(after['runtime'])and before['host']==after['host']and before['auth']==after['auth'],'all-host-files-auth-and46-container-identities-preserved')
 for cid,a in before['runtime'].items():
  b=after['runtime'][cid]
  if cid==CID and own_restart:
   aa,bb=copy.deepcopy(a),copy.deepcopy(b)
   for k in('pid','started'):aa.pop(k);bb.pop(k)
   need(aa==bb and b['pid']>0 and b['pid']!=a['pid']and b['started']!=a['started'],'one-target-start-only-config-env-mounts-image-restarts-oom-health-unchanged')
  else:need(a==b,'all-other-runtime-fields-exactly-unchanged')

HTTP=r'''const crypto=require('crypto');const H=b=>crypto.createHash('sha256').update(b).digest('hex');const v=JSON.parse(require('fs').readFileSync(0,'utf8'));(async()=>{let out={};for(const item of v){const r=await fetch('http://127.0.0.1:3100'+item.path,{redirect:'error',headers:item.headers||{},signal:AbortSignal.timeout(10000)}),parts=[];let size=0;for await(const b of r.body){size+=b.length;if(size>33554432)throw Error('bounded');parts.push(b)}out[item.key]={status:r.status,bytes:size,sha256:H(Buffer.concat(parts)),etag:r.headers.get('etag')}}console.log(JSON.stringify(out))})().catch(e=>{console.error(e.name);process.exitCode=1});'''
def http(static=None,new=False,old_etag=None):
 tests=[{'key':'root','path':'/'},{'key':'health','path':'/health'},{'key':'session','path':'/api/epms/session','headers':{'Cookie':'rr_epms_session=diagnostic.invalid.token'}}]
 if new:tests +=[{'key':'editor','path':'/api/editor-access','headers':{'Cookie':'rr_epms_session=diagnostic.invalid.token'}},*({'key':'retired-'+str(i),'path':p}for i,p in enumerate(('/api/epms/dashboard','/api/epms/documents','/api/epms/workbench')))]
 if static:tests +=[{'key':'static-'+n,'path':'/'+n,'headers':{'Cache-Control':'no-cache'}}for n in sorted(static)]
 if old_etag:tests.append({'key':'stale-index','path':'/','headers':{'If-None-Match':old_etag}})
 v=json.loads(run(['docker','exec','-i',CID,'node','-e',HTTP],enc(tests),timeout=120,limit=1024**2));need(v['root']['status']==v['health']['status']==200 and v['session']['status']==401,'actual-preview-static-health-and-core-invalid-session-status')
 if new:need(v['editor']['status']==404 and all(v['retired-'+str(i)]['status']==404 for i in range(3)),'empty-editor-path-rejected-without-business-read-and-retired-business-endpoints-closed')
 if static:need(all(v['static-'+n]['status']==200 and v['static-'+n]['sha256']==h for n,h in static.items())and v['root']['sha256']==static['index.html'],'all-original-and-new-static-http-bytes-match')
 if old_etag:need(v['stale-index']['status']==200 and v['stale-index']['sha256']==static['index.html'],'stale-browser-etag-receives-new-index')
 return v

def gateway(maintained=False):
 class NoRedirect(urllib.request.HTTPRedirectHandler):
  def redirect_request(self,*args,**kw):return None
 opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),NoRedirect());paths={'/':401,'/gongcheng-ziliao/':503 if maintained else 401,'/gongcheng-ziliao/health':503 if maintained else 200,'/indo-shipping/api/health':200,'/qc/api/health':200,'/internal-quote/health':200,'/paiji/health':200,'/sprayplan/api/health':200};out={}
 for path,expected in paths.items():
  try:r=opener.open(urllib.request.Request('http://127.0.0.1'+path,headers={'Connection':'close','Cache-Control':'no-cache'}),timeout=12)
  except urllib.error.HTTPError as error:r=error
  with r:body=r.read(2*1024**2+1);status=r.code
  need(status==expected and len(body)<=2*1024**2,'only-engineering-service-gated-other-services-and-auth-boundary-live');out[path]={'status':status,'bytes':len(body),'sha256':sha(body)}
 return out

def gate_path():return ROOT/'deploy/maintenance/services'/SERVICE
def gate_record(path):
 s=path.lstat();need(stat.S_ISREG(s.st_mode)and s.st_size==0 and s.st_uid==s.st_gid==0 and stat.S_IMODE(s.st_mode)==0o644,'owned-empty-root-service-only-gate');return {'device':s.st_dev,'inode':s.st_ino,'mode':s.st_mode,'uid':s.st_uid,'gid':s.st_gid,'bytes':s.st_size,'mtimeNS':s.st_mtime_ns,'ctimeNS':s.st_ctime_ns}
def gate_create():
 path=gate_path();need(path.parent.is_dir()and not any(p.is_symlink()for p in(path.parent,*path.parent.parents))and not path.exists()and not path.is_symlink(),'fresh-original-service-gate-directory');checkpoint('gate-intent',stage='gate-intent');fd=os.open(path,os.O_CREAT|os.O_EXCL|os.O_WRONLY|os.O_NOFOLLOW,0o644)
 try:os.fchmod(fd,0o644);os.fsync(fd)
 finally:os.close(fd)
 sync_dir(path.parent);v=gate_record(path);private('owned-gate.private.json',v);checkpoint('gate-ack',stage='gate-active');return v
def gate_remove(owned):
 path=gate_path();need(gate_record(path)==owned,'only-exact-owned-service-gate-can-be-cleared');checkpoint('gate-clear-intent',stage='gate-clear-intent');path.unlink();sync_dir(path.parent);checkpoint('gate-clear-ack',stage='gate-cleared')

def established(pid,ports):
 count=0
 for name in('tcp','tcp6'):
  rows=(pathlib.Path('/proc')/str(pid)/'net'/name).read_text().splitlines()[1:]
  for row in rows:
   fields=row.split();need(len(fields)>=10,'typed-proc-socket-row')
   if fields[3]=='01'and int(fields[1].rsplit(':',1)[1],16)in ports:count+=1
 return count
def descendants(pid):
 result={pid};pairs=[]
 for folder in pathlib.Path('/proc').iterdir():
  if not folder.name.isdecimal():continue
  try:text=(folder/'stat').read_text();ppid=int(text[text.rfind(')')+2:].split()[1]);pairs.append((int(folder.name),ppid))
  except FileNotFoundError:continue
 while True:
  new={child for child,parent in pairs if parent in result}-result
  if not new:return result
  result|=new
def writable_fds(pid,prefixes):
 total=0
 for child in descendants(pid):
  folder=pathlib.Path('/proc')/str(child)/'fd'
  try:files=list(folder.iterdir())
  except FileNotFoundError:continue
  for fd in files:
   try:
    target=os.readlink(fd);info=(folder.parent/'fdinfo'/fd.name).read_text();flags=[x.split(':',1)[1].strip()for x in info.splitlines()if x.startswith('flags:')];need(len(flags)==1,'typed-process-fd-flags');writable=(int(flags[0],8)&os.O_ACCMODE)in(os.O_WRONLY,os.O_RDWR)
    if writable and any(target==p or target.startswith(p.rstrip('/')+'/')for p in prefixes):total+=1
   except FileNotFoundError:continue
 return total
def metadata_tree(root):
 rows=[]
 for parent,dirs,files in os.walk(root,followlinks=False):
  for n in sorted(dirs+files):
   p=pathlib.Path(parent)/n;s=p.lstat();need(stat.S_ISDIR(s.st_mode)or stat.S_ISREG(s.st_mode),'drain-tree-no-links-or-special-files');rows.append((p.relative_to(root).as_posix(),s.st_dev,s.st_ino,s.st_mode,s.st_uid,s.st_gid,s.st_size,s.st_mtime_ns,s.st_ctime_ns))
  need(len(rows)<=20000,'bounded-drain-metadata-tree')
 s=root.lstat();return sha(enc([[(s.st_dev,s.st_ino,s.st_mode,s.st_uid,s.st_gid,s.st_mtime_ns,s.st_ctime_ns)],rows]))
def drain(app,nginx,data,maximum=120,minimum=10,interval=3):
 start=time.monotonic();last=None;stable=0;quiet_since=None;observations=[]
 while True:
  need(app_inspect()['State']['Pid']==app['State']['Pid'],'original-target-pid-during-drain');current=metadata_tree(data);row={'elapsed':round(time.monotonic()-start,3),'dataMetadataSHA256':current,'targetConnections':established(app['State']['Pid'],{3100}),'targetDataWriteFDs':writable_fds(app['State']['Pid'],('/data',str(data))),'gatewayConnections':established(nginx['State']['Pid'],{80,443}),'gatewayBufferedUploadWriteFDs':writable_fds(nginx['State']['Pid'],('/var/cache/nginx/client_temp','/var/lib/nginx/tmp/client_body','/tmp/client_body','/var/cache/nginx/client_body_temp'))};observations.append(row)
  # Front connections belong to all 46 services; retain the count as evidence.
  # Target sockets, data writers and Nginx buffered-upload writers remain gates.
  quiet=all(row[k]==0 for k in('targetConnections','targetDataWriteFDs','gatewayBufferedUploadWriteFDs'))
  if quiet and current==last and quiet_since is not None:stable+=1
  else:stable=0;quiet_since=row['elapsed']if quiet else None
  last=current;quiet_seconds=row['elapsed']-quiet_since if quiet_since is not None else 0
  if stable>=3 and quiet_seconds>=minimum:private('drain-observations.private.json',observations);return {'observations':len(observations),'seconds':row['elapsed'],'stableQuietSeconds':quiet_seconds,'noActiveTargetConnectionsOrDataWritesOrBufferedUploadWritersObserved':True,'dataMetadataSHA256':current,'gatewayFrontConnectionsAreObservationOnly':True,'allGatewayRequestsDrainedClaimed':False,'lateCommittedWritesInvalidateColdComparison':True}
  if time.monotonic()-start>=maximum:private('drain-observations.private.json',observations);need(False,'busy-upload-or-user-traffic-no-stop-permitted')
  time.sleep(interval)

def prepare_phase():
 old_map,new_map=source_guard();pre=read_result(PREFLIGHT,PREFLIGHT_SHA,'diagnose');before,app,nginx=state();need(before['runtime']==pre['allRuntime']and before['host']==pre['host']and before['auth']==pre['gatewayAuth']and before['canonical']==pre['canonical']['id']==BASE_IMAGE,'fresh-preflight-runtime-host-auth-and-canonical-cas');capacity(SPACE_BUDGET);document_root(app);old_source=old_profile(app,old_map);old_static=P.static(app,False)['files'];config=config_profile(app);need(config['docs.config.json']==pre['dependencies']['configFile']and config['node_modules/.package-lock.json']==pre['dependencies']['installedLock'],'original-private-config-and-dependency-lock');http_old=http();gateway_old=gateway();need(not gate_path().exists()and not gate_path().is_symlink(),'engineering-not-already-maintained')
 context=OUT/'context';context.mkdir(mode=0o700);overlay=context/'overlay';overlay.mkdir(mode=0o700);os.chmod(overlay,0o755);new_source={};changed=[];source_bytes=0
 for n,v in new_map.items():
  if n in old_source and old_source[n]['gitBlobSHA1']==v['gitBlobSHA1']and old_source[n]['mode']==v['mode']:new_source[n]=old_source[n];continue
  body=git('show',HEAD+':'+APP+'/'+n);source_bytes+=len(body);need(source_bytes<=256*1024,'bounded-small-runtime-source-delta');write_public(overlay,n,body,v['mode']);changed.append(n);new_source[n]={'bytes':len(body),'sha256':sha(body),'gitBlobSHA1':v['gitBlobSHA1'],'mode':v['mode'],'uid':0,'gid':0}
 need(all(old_source[n]==new_source[n]for n in old_source if n.startswith('public/'))and{n for n in old_source if n.startswith('public/')}=={n for n in new_source if n.startswith('public/')},'whole-public-luckysheet-tree-unchanged-no-repeat-copy')
 retired=[dict(path=n,**{k:v for k,v in r.items()if k!='gitBlobSHA1'})for n,r in sorted(old_source.items())if n not in new_source];need(all((r['path'].startswith('src/')or r['path']=='tailwind.config.js')and r['path']not in SECURITY_CODE for r in retired)and sum(r['bytes']for r in retired)<=MAX_RETIRED,'only-explicit-reviewed-obsolete-public-code-retired');retirement={'target':TARGET,'entries':retired};manifest,delta,delta_bytes=dist_delta(overlay,old_static);paths=changed+['dist/'+n for n in delta];patch=patch_tar(overlay,paths);private('code-overlay.private.tar',patch);private('retirement-manifest.private.json',retirement);backup=backup_code(app,old_source,old_static,config);capacity(16*1024**2)
 checkpoint('candidate-build-intent',stage='candidate-build');candidate,candidate_id=build_candidate(context,retirement);checkpoint('candidate-build-ack',candidate=candidate,candidateImage=candidate_id);new_static={**{n:r['sha256']for n,r in old_static.items()},**delta};proof=candidate_proof(candidate_id,new_source,new_static,config,retirement);native=native_tests(candidate_id);after,app2,nginx2=state();unchanged(before,after);need(before['canonical']==after['canonical']and old_profile(app2,old_map)==old_source and P.static(app2,False)['files']==old_static and config_profile(app2)==config,'prepare-has-no-live-code-private-config-data-or-alias-writes');capacity();plan={'sourceHead':HEAD,'target':TARGET,'appTree':APP_TREE,'before':before,'oldSource':old_source,'newSource':new_source,'oldStatic':old_static,'newStatic':new_static,'freshBuildManifest':manifest,'config':config,'candidateTag':candidate,'candidateImage':candidate_id,'retirement':retirement,'patchSHA256':sha(patch),'patchBytes':len(patch),'sourceDeltaBytes':source_bytes,'staticDeltaBytes':delta_bytes,'backup':backup,'candidateProof':proof,'nativeTests':native,'oldHTTP':http_old,'gateway':gateway_old,'capacity':capacity(),'fullBusinessDataBackupCreated':False,'originalDataBindRetained':True,'coldDataComparisonRequiredDuringPublication':True};body=enc(plan);private('prepared.private.json',body);return {'preparedBodySHA256':sha(body),'patchBytes':len(patch),'sourceDeltaBytes':source_bytes,'staticDeltaBytes':delta_bytes,'candidate':candidate_id,'nativeTests':native,'fullBusinessDataBackupCreated':False,'backup':backup,'capacity':capacity()}

def read_patch(plan):
 path=ARCHIVE/'prepare/code-overlay.private.tar';need(path.is_file()and not path.is_symlink()and path.stat().st_size<=MAX_DELTA,'bounded-prepared-overlay');body=path.read_bytes();need(sha(body)==plan['patchSHA256']and len(body)==plan['patchBytes'],'sealed-exact-code-static-overlay');return body
def wait_healthy(maximum=90):
 start=time.monotonic()
 while True:
  app=app_inspect();s=app['State'];need(not s['OOMKilled'],'target-not-oom-after-start')
  if s['Running']and s.get('Health',{}).get('Status')=='healthy':return app
  need(time.monotonic()-start<maximum and s['Running'],'single-start-target-became-healthy-no-retry');time.sleep(2)
def cold(data,name):
 inventory,summary=P.data_inventory(data);summary['observation']='Service-only gate active; target connections/data writers and Nginx buffered-upload writers observed idle, while unrelated gateway front connections may remain. Original target stopped before baseline. Every original entry/content/inode/owner/mode/mtime/ctime compared after start, before reopening; any late committed write invalidates equality.';private(name+'-inventory.private.json',inventory);private(name+'-summary.private.json',summary);return inventory,summary
def retire_live(plan,app):
 manifest=plan['retirement'];need(manifest['entries'],'reviewed-retirement-nonempty-required');checkpoint('retirement-intent',stage='retirement',retirementAttempted=True,newPID=app['State']['Pid'],newStarted=app['State']['StartedAt']);v=json.loads(run(['docker','exec','--user','0','-i',CID,'node','-e',retirement_script()],enc(manifest),timeout=30,limit=4096));need(v=={'target':TARGET,'files':len(manifest['entries']),'complete':True},'one-shot-complete-live-explicit-source-retirement');fresh=app_inspect();need(fresh['State']['Pid']==app['State']['Pid']and fresh['State']['StartedAt']==app['State']['StartedAt'],'same-new-pid-and-startedat-through-retirement');checkpoint('retirement-ack',stage='retired')

def prior_no_stop(plan):
 # Reuse the first successful prepare/candidate. A distinct deploy2 directory is
 # allowed only after an exact failed-receipt and independent read-only proof.
 path=ARCHIVE/'deploy/result.private.json';need(path.is_file()and not path.is_symlink()and path.stat().st_size<4*1024**2,'original-bounded-failed-deploy-receipt');raw=path.read_bytes();need(sha(raw)==FAILED_DEPLOY_SHA,'exact-original-no-stop-failed-deploy');failed=json.loads(raw);core=dict(failed);seal=core.pop('resultSHA256',None);flags=('stopAttempted','startAttempted','retirementAttempted','canonicalTagAttempted','automaticRetryOrRollback','businessDataRestoreOrMigration');need(seal==sha(enc(core))and failed['phase']=='deploy'and failed['success']is False and failed['target']==TARGET and failed['sourceHead']==HEAD and failed['gateMayRemainClosed']is False and all(failed['operations'][k]is False for k in flags),'original-deploy-failed-before-code-lifecycle-or-image-publication')
 for operation in('stop','overlay','start','retirement','canonical'):
  path=ARCHIVE/'deploy'/('operation-'+operation+'-intent.private.json');need(not path.exists()and not path.is_symlink(),'no-unacknowledged-original-live-operation-intent')
 diag=read_result(DIAG_RESULT,DIAG_SHA,'diagnose');need(diag['readOnly']is True and all(diag[k]is False for k in('businessWrites','configurationWrites','lifecycleWrites','automaticReplayOrRollback'))and diag['all46EqualPrepared']is True and diag['runtimeUnchangedDuringObservation']is True and diag['runtime']==diag['runtimeAfter']==plan['before']['runtime'],'independent-observation-proved-original46-and-no-writes');need(diag['originalFailure']['receiptSHA256']==FAILED_DEPLOY_SHA and diag['originalFailure']['evidence']['busy-abort.private.json']['value']=={'automaticRetry':False,'originalHealthyUnmodified':True,'ownedGateCleared':True,'stopAttempted':False},'independent-proof-of-healthy-unmodified-busy-abort-and-cleared-owned-gate')
 expected={'gate':None,'canonical':BASE_IMAGE,'candidate':plan['candidateImage'],'privateConfigAndInstalledLock':True,'host':plan['before']['host'],'auth':plan['before']['auth']}
 need(all(diag[n]['success']is True and diag[n]['value']==v for n,v in expected.items())and diag['source']['success']is True and diag['source']['value']['exactOriginalPreparedSource']is True and diag['static']['success']is True and diag['static']['value']['exactOriginalPreparedStatic']is True,'independent-old-source-static-private-config-and-candidate-proof');rows=diag['originalFailure']['drain']['value'];need(len(rows)==41 and len({r['dataMetadataSHA256']for r in rows})==1 and all(all(r[k]==0 for k in('targetConnections','targetDataWriteFDs','gatewayBufferedUploadWriteFDs'))and r['gatewayConnections']>0 for r in rows),'original-blocker-exclusively-shared-front-connections');need(not gate_path().exists()and not gate_path().is_symlink(),'original-gate-currently-absent-before-new-explicit-publication');private('original-no-stop-diagnosis-proof.private.json',{'failedDeploySHA256':FAILED_DEPLOY_SHA,'diagnosisSHA256':DIAG_SHA,'originalPrepareSHA256':PREPARE_SHA,'candidate':plan['candidateImage'],'newPhase':'deploy2','originalDeployDirectoryNeverReplayed':True,'allOriginalOperationFlagsFalse':True})

def deploy_phase():
 global STAGE,PRIMARY_FAILURE
 plan=prepared();prior_no_stop(plan);source_guard();before,app,nginx=state();need(before==plan['before']and image(plan['candidateTag'])['Id']==plan['candidateImage'],'complete-prepared-state-and-durable-candidate-cas');complete_source(app,plan['oldSource']);need(P.static(app,False)['files']==plan['oldStatic']and config_profile(app)==plan['config'],'preswitch-old-code-static-private-config-exact');patch=read_patch(plan);data=document_root(app);capacity();owned=gate_create()
 try:
  gateway(True);drained=drain(app,nginx,data);gateway(True);fresh,app2,nginx2=state();unchanged(before,fresh);need(fresh['canonical']==BASE_IMAGE and gate_record(gate_path())==owned,'drained-original-runtime-and-owned-gate');complete_source(app2,plan['oldSource']);need(metadata_tree(data)==drained['dataMetadataSHA256'],'metadata-still-stable-immediately-before-single-stop')
 except Exception as error:
  PRIMARY_FAILURE={'stage':STAGE,'errorType':type(error).__name__,'preflightStage':P.STAGE};private('pre-stop-primary-failure.private.json',PRIMARY_FAILURE)
  # Only this pre-stop branch may resume access, and only after exact identity proof.
  if STATE['stopAttempted']is False:
   fresh,still,nginx2=state();unchanged(before,fresh);need(fresh['canonical']==BASE_IMAGE,'original-canonical-before-busy-abort');complete_source(still,plan['oldSource']);need(P.static(still,False)['files']==plan['oldStatic']and config_profile(still)==plan['config'],'unmodified-original-service-before-clearing-busy-abort-gate');gate_remove(owned);gateway(False);private('busy-abort.private.json',{'stopAttempted':False,'originalHealthyUnmodified':True,'ownedGateCleared':True,'automaticRetry':False})
  STAGE=PRIMARY_FAILURE['stage'];raise
 checkpoint('stop-intent',stage='stop',stopAttempted=True);run(['docker','stop','--time','30',CID],timeout=45,limit=4096);stopped=app_inspect();need(stopped['State']['Running']is False and stopped['State']['Pid']==0 and not stopped['State']['OOMKilled'],'original-target-stopped-once');checkpoint('stop-ack',stage='stopped');baseline,data_summary=cold(data,'cold-before');need(gate_record(gate_path())==owned,'gate-owned-through-cold-baseline');checkpoint('overlay-intent',stage='overlay');run(['docker','cp','-',CID+':/app'],patch,timeout=60,limit=4096);checkpoint('overlay-ack',stage='overlay-copied');checkpoint('start-intent',stage='start',startAttempted=True);run(['docker','start',CID],timeout=40,limit=4096);fresh_app=wait_healthy();checkpoint('start-ack',stage='healthy-gated',newPID=fresh_app['State']['Pid'],newStarted=fresh_app['State']['StartedAt']);fresh,app2,nginx2=state();unchanged(before,fresh,True);need(gate_record(gate_path())==owned and fresh['canonical']==BASE_IMAGE,'new-service-healthy-while-own-gate-still-closed');retire_live(plan,app2);complete_source(app2,plan['newSource']);static=P.static(app2,False)['files'];need({n:r['sha256']for n,r in static.items()}==plan['newStatic']and config_profile(app2)==plan['config'],'live-full-new-source-and-old-new-static-union-private-config-lock-exact');after_inventory,after_summary=cold(data,'cold-after');need(after_inventory==baseline,'every-original-business-file-hidden-epms-trash-and-metadata-exact');live_http=http(plan['newStatic'],True,plan['oldHTTP']['root']['etag']);final,app3,nginx3=state();unchanged(before,final,True);need(final['runtime']==fresh['runtime']and gate_record(gate_path())==owned and final['canonical']==BASE_IMAGE,'one-restart-only-and-no-unexpected-runtime-or-gate-change');capacity();checkpoint('canonical-intent',stage='canonical',canonicalTagAttempted=True);run(['docker','tag',plan['candidateImage'],CANONICAL],limit=1024);need(image(CANONICAL)['Id']==plan['candidateImage'],'durable-canonical-promoted-once');checkpoint('canonical-ack',stage='canonical-promoted');gate_remove(owned);public=gateway();end,app4,nginx4=state();unchanged(before,end,True);need(end['runtime']==final['runtime']and end['canonical']==plan['candidateImage'],'published-runtime-and-durable-image-exact');return {'runtime':end,'candidate':plan['candidateImage'],'sameContainer':CID,'allOther45ContainersUnchanged':True,'singleTargetRestart':True,'drain':drained,'coldDataBefore':data_summary,'coldDataAfter':after_summary,'allColdBusinessContentAndMetadataEqual':True,'originalDataBindRetained':True,'fullBusinessDataBackupCreated':False,'privateCodeConfigBackup':plan['backup'],'http':live_http,'gateway':public,'ownedGateCleared':True,'capacity':capacity(),'automaticRetryOrRollback':False}

def verify_phase():
 plan=prepared();receipt=read_result(ARCHIVE/'deploy2/result.private.json',DEPLOY_SHA,'deploy2');source_guard();current,app,nginx=state();need(current==receipt['details']['runtime']and current['canonical']==plan['candidateImage'],'same-successfully-published-runtime-host-auth-and-durable-image');need(not gate_path().exists()and not gate_path().is_symlink(),'service-gate-absent-after-success');complete_source(app,plan['newSource']);need({n:r['sha256']for n,r in P.static(app,False)['files'].items()}==plan['newStatic']and config_profile(app)==plan['config'],'all-public-code-static-private-config-and-installed-lock-exact');live=http(plan['newStatic'],True);public=gateway();after,app2,nginx2=state();need(after==current,'readonly-verification-no-state-change');return {'sameContainer':CID,'runtime':after,'candidate':plan['candidateImage'],'http':live,'gateway':public,'noProductionBusinessWriteTests':True,'businessDataNotComparedAcrossUserWriteWindow':True,'coldFullDataEqualityProvenDuringGatedDeploy':receipt['details']['allColdBusinessContentAndMetadataEqual'],'fullBusinessDataBackupCreated':False}

def reconcile_phase():
 # Observation only. Never source-guard fetch, tag, copy, start, stop, delete or gate.
 app=app_inspect();s=app['State'];result={'state':{'running':s['Running'],'pid':s['Pid'],'started':s['StartedAt'],'oom':s['OOMKilled'],'restarts':app['RestartCount'],'health':s.get('Health',{}).get('Status')},'configuredEnvSHA256':sha(enc(sorted(app['Config'].get('Env')or[]))),'mountsSHA256':sha(enc(app['Mounts'])),'canonical':image(CANONICAL)['Id'],'gate':gate_record(gate_path())if gate_path().exists()else None,'observationalOnly':True,'automaticReplayOrRollback':False,'businessDataRestoredOrChanged':False};no_public_service_port(app)
 if s['Running']and s['Pid']>0:
  root=app_root(app);result['index']=P.record(root/'dist/index.html',1024**2);result['config']=config_profile(app);journal=root/'.retired-pr1054'/TARGET/'99-complete.json';result['retirementCompleteJournal']=P.record(journal,4096)if journal.exists()else None
 return result

def main():
 global OUT
 args=sys.argv[1:];need(EXECUTE is True and len(args)==1 and args[0]in('deploy2','verify2','reconcile2')and os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_MODE')==args[0]and os.environ.get('RELEASE_ATTEMPT')=='1','inert-explicit-publication2-only-no-prepare-or-first-deploy-replay');phase=args[0];need(all(pin(x,40)for x in(BASE,HEAD,TARGET,APP_TREE)),'final-source-pins-required');os.umask(0o077);need(ARCHIVE.parent.is_dir()and not any(p.is_symlink()for p in(ARCHIVE.parent,*ARCHIVE.parent.parents)),'existing-private-evidence-parent');need(ARCHIVE.is_dir()and not ARCHIVE.is_symlink()and ARCHIVE.stat().st_uid==0 and stat.S_IMODE(ARCHIVE.stat().st_mode)==0o700,'original-owned-private-release-root')
 OUT=ARCHIVE/phase;need(not OUT.exists()and not OUT.is_symlink(),'fresh-never-replayed-phase');OUT.mkdir(mode=0o700);sync_dir(ARCHIVE);load();result={'phase':phase,'sourceHead':HEAD,'target':TARGET,'appTree':APP_TREE,'success':False,'startedUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'fullBusinessDataBackupCreated':False}
 try:result['details']={'deploy2':deploy_phase,'verify2':verify_phase,'reconcile2':reconcile_phase}[phase]();result['success']=True
 except Exception as error:result.update(errorType=type(error).__name__,stage=STAGE,primaryFailure=PRIMARY_FAILURE,operations=copy.deepcopy(STATE),gateMayRemainClosed=gate_path().exists());private('failure-observation.private.json',{'stage':STAGE,'primaryFailure':PRIMARY_FAILURE,'exceptionType':type(error).__name__,'operations':STATE,'noAutomaticReplayOrRollback':True})
 result['finishedUtc']=datetime.datetime.now(datetime.timezone.utc).isoformat();result['resultSHA256']=sha(enc(result));private('result.private.json',result);P.wire(result);return 0 if result['success']else 1

if __name__=='__main__':sys.exit(main())
