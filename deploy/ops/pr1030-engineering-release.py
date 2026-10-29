"""INERT engineering-only same-CID release. Final application pins remain unbound.
Derived transport/host/receipt guards from reviewed PR1035; no import-time action.
"""
import ast,base64,copy,datetime,hashlib,importlib.util,io,json,os,pathlib,re,shutil,stat,subprocess,sys,tarfile,time,uuid,urllib.request,urllib.error,urllib.parse
ROOT=pathlib.Path('/opt/rr-portal');APP='apps/工程部/工程资料管理系统';SERVICE='gongcheng-ziliao';ALIAS='rr-portal-gongcheng-ziliao:latest'
ARCHIVE=ROOT/'deploy/backups/pr1030-engineering-20261029-r2'
BRANCH='refs/heads/ops/pr-1030-1033-20261029-engineering'
EXECUTE=False;PHASE='';BASE='b81980e6970f5a248f50068b4c6ceeb1398930c4';TARGET='91178c35b2013d32dc02808ece1d81924d567d0d';TREE='2658ba6fcdcf656201d75847a9abc6c70f44849d';HEAD='7dbfdfa37b53a7f0552d7d66cd8aeb75f0b87f89';APP_TREE='ff7afc1432e3bbc72ad708233fc7cae5bf2685ba';PREPARED_SHA256='';DEPLOY_SHA256=''
REVIEWED_FILES={'.dockerignore': '9152f7a0ccb704b9feefe135bd8c319af1c482a50a27b14140568ecb5fe88a8c', 'docs-trash.ts': '3c6d00cf9c468456192fa44b88f46ef0070ff66d9f057707458389121c458bfe', 'epms-auth.ts': 'dabccf4d1e9e03065b311f2fcb54794d1275ff9245d7693cc6807a2383e59e13', 'epms-store.ts': '9df55e70592928882f3d9a771b441b792b2d3ab09143118f9fdf8b5f7c8e6ed4', 'index.html': '42969579fe69d6d737ee36b5f020e97e5c06bd8d86ff4af64429e9d2bfebee35', 'package.json': '6ef1e8158773fd966984d4a8bee6de9e2d63c60e38b519e4846fb52fcb5a82b2', 'src/App.tsx': '2c2068d6673d51d39428e7cca43453fe65dfadc420c4e65932d2164b7e42f9c4', 'src/components/EpmsAccount.tsx': '8888396da29b3c401f00bb26e4057d06254c2e6853fb66d758b34150c93279aa', 'src/components/StitchIcon.tsx': 'c13a68c69b66284b497076725c6d57952e579e60999f06d49c16155482371d02', 'src/index.css': 'bab7cce0fdf5101605375df37e029f91437c3038059ae29b745b4bdf3a4d0e84', 'src/lib/api.ts': 'bb9be915d24a32c88798ed69493a6114a59bb71005ddc322cd9761287c47e12c', 'src/lib/dashboard.ts': 'dd466c7af0474817e72ae11e165bc22122a95404ee6362c3aaba5e73f8e0be73', 'src/lib/epms-access.ts': '9d408e953af8f41384f0704289770d273264610f7cf15a522675b731752fb82d', 'src/sections/ClientView.tsx': '6eb76a1f6b74caca8c965c7ce8454a0d6f134218d5895655428ede1c757379fe', 'src/sections/DashboardView.tsx': 'b287425be1b4801bf8a5475053d9c50dd595f56bffa295da20e1ed141c7217e2', 'src/sections/Dialogs.tsx': '9cfec0d127506f597c57df8b81f8468a2e419ebe24adba6d07c35943bf264d63', 'src/sections/DocEditor.tsx': '30b5c8174ebf381b09a5a6825efefe89cbe2281abae247005898e82849289f84', 'src/sections/ExplorerView.tsx': '7c2e4dddd3491c888d1cb8f49e7a152ac1be834a4e827ccc296cd55d859cec1b', 'src/sections/ProjectView.tsx': 'd3bf20463ebb56d45c3bc3b0060593c21cffcc63e7540c74b36aa3e1cd42494a', 'src/sections/SearchView.tsx': 'c651acd07b473fe29e8cc333896e329f07de4f3de181762f7de23b659afe510b', 'src/sections/TrashView.tsx': '418b676ed219495c1a7b1a7b701d6ee1e00987c80aa7086d9031daf58abe0ddf', 'src/sections/WorkbenchView.tsx': 'ff727c30274e999e44760f9cb6686655f04fa8526f8cba6eeeb2349d5aafea59', 'src/types/index.ts': 'fdef549785c3af25616540dfcbed9fa8eb8f8d22024c0647b1b7ae43fd4ec104', 'tailwind.config.js': 'f5cdc128893d22daf36c6fb69c5881f15d49d1afd12517190d2e245d2bf758f4', 'tests/dashboard.test.cjs': 'c2982648999bedd7e85d58e385718673c14fa84f6551e3fd808343a18f946191', 'tests/editor-legacy-path.test.cjs': '74b0f5d5f033cf21cca778d232abb9c0f34c6bcd2314b34cfe776123cf1ce80c', 'tests/epms-auth.test.cjs': 'ff9cd543b29234227bf9838c17899054136d98df912ce55f7bd865b890341de4', 'tests/epms-backend.test.cjs': '49ff89458c0da558b5444d5d7d3cc81abe420066eaf7678d61896af9261a52af', 'tests/epms-client.test.cjs': 'e692cdb9798c246346e282ef72d1ea035c6e7c8226566d18bae3b59c31365432', 'tests/trash-defensive.test.cjs': 'f6cb525002773888621138fdb183e28408f428af5ad3b858adfc27a11117e217', 'vite-plugin-docs-api.ts': 'e15f711c6ac447dc4dcc69f5b6671c70d993657fef8af2cfb8493dd09a4eea47', 'vite.config.ts': '91e510afe7a95614ddfa8bdeebce9dfe3d96ffb560f902c47a3853ace55e1bbe'};TEST_PATHS=('tests/dashboard.test.cjs', 'tests/editor-legacy-path.test.cjs', 'tests/epms-auth.test.cjs', 'tests/epms-backend.test.cjs', 'tests/epms-client.test.cjs', 'tests/trash-defensive.test.cjs');MIN_AVAILABLE=536870912;MIN_PHYSICAL_FREE=4294967296
HOST_BASE=SOURCE_BASE='f22fbffa1789234fe1c78bf776f4dcb3fe867d0c'
CID='b5f672104239d9a68a6792e632d9d90601afe4d7832f8eea423ea14e6e871c7c'
LIVE_IMAGE='sha256:d678092aef9e194584a7397074e673b07e9e538519ba67b25c91e0f023992d17'
BASE_IMAGE='sha256:b5787ec2c08cc5871ed4db2513860061b7520b738bdd26b8bacf42771afcb454'
PREFLIGHT_RESULT_SHA256='899fa4189451c71de22d3b4cb4fdca518bcb9d4a567bbc8b5e8d49bbc0f84f50'
CONFIG_FILE_SHA256='1a1745df3bfe3b5fde9305f0578a434ee83fc50c362d0a9d18a45c2b633ab195'
DEPENDENCY_LOCK_SHA256='72612a06d62c7f553d246be913a50d9fde3b5a482a0e5edbd013eea127cbd757'
DEPS={'pr1035-quote-preflight.py':'2b2739aa00cad03bfce8472b7416d725364b8d4ed354a5a7e9ca905a47aaffa5','pr1030-engineering-preflight.py':'3d06b2aef715f75740826ff75f91c1cb78e0927e030717795ef2733f0595a4d0','batch1003-image-library.py':'94d9dc30f1e21ee1346f89ac231bbc28ebc21d210d08298f54c56cc0103fab02'}
ROOT_CODE=('vite.config.ts','vite-plugin-docs-api.ts','vite-plugin-xlsx-images.ts','epms-store.ts','epms-auth.ts','docs-trash.ts','tailwind.config.js','postcss.config.js','tsconfig.json','tsconfig.app.json','tsconfig.node.json','index.html','package.json')
OUT=None;P=None;E=None;I=None;SERIAL=0;STAGE='entry';PATCH=()

def need(v,label):
 global STAGE
 STAGE=label
 if not v:raise RuntimeError(label)

def enc(v):return json.dumps(v,sort_keys=True,separators=(',',':'),ensure_ascii=True,allow_nan=False).encode()

def sha(b):return hashlib.sha256(b).hexdigest()

def pin(v,n=64):return type(v)is str and re.fullmatch('[a-f0-9]{%d}'%n,v)is not None

def private(p,b):
 fd=os.open(p,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
 with os.fdopen(fd,'wb')as f:f.write(b);f.flush();os.fsync(f.fileno())

def run(args,data=None,timeout=180):
 global SERIAL,STAGE
 SERIAL+=1;STAGE='command-'+pathlib.Path(args[0]).name;paths=[OUT/('%03d-%s.private'%(SERIAL,n))for n in('stdout','stderr')];files=[os.fdopen(os.open(p,os.O_CREAT|os.O_EXCL|os.O_WRONLY|os.O_NOFOLLOW,0o600),'wb')for p in paths]
 try:
  try:r=subprocess.run(args,input=data,stdout=files[0],stderr=files[1],timeout=timeout,cwd=ROOT)
  finally:
   for f in files:f.flush();os.fsync(f.fileno())
 finally:
  for f in files:f.close()
 need(r.returncode==0,'single-command-success-no-replay');need(paths[0].stat().st_size<=256*1024**2,'bounded-private-output');return paths[0].read_bytes()

def memory(args):
 # Secret-bearing Docker Config/Env stays in memory, only digests are persisted.
 r=subprocess.run(args,capture_output=True,timeout=60,cwd=ROOT);need(r.returncode==0 and len(r.stdout)<=16*1024**2,'bounded-private-in-memory-inspect');return json.loads(r.stdout)

def load(name):
 p=pathlib.Path(__file__).with_name(name);need(p.is_file()and not p.is_symlink()and sha(p.read_bytes())==DEPS[name],'fixed-reviewed-dependency');s=importlib.util.spec_from_file_location('quote1035_'+name.replace('.','_'),p);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m

def git(*a):return run(['git','-C',str(ROOT),'-c','core.hooksPath=/dev/null',*a])

def image(name):
 rows=memory(['docker','image','inspect',name]);need(len(rows)==1 and re.fullmatch('sha256:[a-f0-9]{64}',rows[0]['Id']),'one-immutable-image');return rows[0]

def runtime():
 ids=run(['docker','ps','-aq','--no-trunc']).decode().split();need(0<len(ids)<1000 and len(ids)==len(set(ids))and all(pin(c)for c in ids),'bounded-all-container-ids');rows=memory(['docker','inspect',*ids]);need({r['Id']for r in rows}==set(ids),'all-existing-containers');value={}
 for r in rows:
  value[r['Id']]={'image':r['Image'],'config':sha(enc(r['Config'])),'hostConfig':sha(enc(r['HostConfig'])),'mounts':sorted(r['Mounts'],key=enc),'pid':r['State']['Pid'],'started':r['State']['StartedAt'],'restarts':r['RestartCount'],'running':r['State']['Running'],'oom':r['State']['OOMKilled'],'health':r['State'].get('Health',{}).get('Status')}
 target=[r for r in rows if(r['Config'].get('Labels')or{}).get('com.docker.compose.project')=='rr-portal'and(r['Config'].get('Labels')or{}).get('com.docker.compose.service')=='gongcheng-ziliao'];need(len(target)==1 and target[0]['Id']==CID and target[0]['Image']==LIVE_IMAGE,'same-accepted-engineering-cid-image');return value

def bind_meta(path):
 a=path.lstat();kind=next((n for f,n in((stat.S_ISREG,'REG'),(stat.S_ISDIR,'DIR'),(stat.S_ISLNK,'LNK'),(stat.S_ISSOCK,'SOCK'),(stat.S_ISFIFO,'FIFO'),(stat.S_ISCHR,'CHR'),(stat.S_ISBLK,'BLK'))if f(a.st_mode)),None);need(kind is not None,'typed-bind-source');v={'type':kind,'uid':a.st_uid,'gid':a.st_gid,'mode':stat.S_IMODE(a.st_mode)}
 if kind=='LNK':v.update(linkSHA256=sha(os.fsencode(os.readlink(path))),resolved=str(path.resolve(strict=True)),target=bind_meta(path.resolve(strict=True)))
 if kind in('CHR','BLK'):v['rdev']=a.st_rdev
 z=path.lstat();need((a.st_dev,a.st_ino,a.st_mode,a.st_uid,a.st_gid,a.st_rdev)==(z.st_dev,z.st_ino,z.st_mode,z.st_uid,z.st_gid,z.st_rdev),'stable-bind-metadata');return v

def protection(records):
 need(git('rev-parse','HEAD').decode().strip()==HOST_BASE,'host-checkout-preserved');shared={n:P.shared_file(n)for n in P.SHARED};need(all(v['sha256']==sha(git('show',HOST_BASE+':'+n))for n,v in shared.items()),'five-shared-files-match-observed-host');dirty=git('diff','--name-only','-z');staged=git('diff','--cached','--name-only','-z');need(not staged,'no-new-staged-changes');names=[n for n in dirty.decode().split('\0')if n and not n.startswith(APP+'/资料库存储/')];need(len(names)==4 and not any(n.startswith(APP+'/')for n in names),'four-existing-dirty-files-outside-engineering');shared.update({n:P.shared_file(n)for n in names});env={str(p.relative_to(ROOT)):P.shared_file(str(p))for p in ROOT.glob('.env*')if p.is_file()};need('.env.cloud.production'in env and len(env)<100,'production-env-files-hash-only');binds={m['Source']:bind_meta(pathlib.Path(m['Source']))for r in records.values()for m in r['mounts']if m.get('Type')=='bind'};auth=P.gateway_auth();return {'host':HOST_BASE,'shared':shared,'dirtySHA256':sha(enc(names)),'env':env,'auth':auth,'binds':binds}

def sealed(phase,digest):
 d=ARCHIVE/phase;need(pin(digest)and sha((d/'manifest.json').read_bytes())==digest,'sealed-prior-phase-manifest');mf=json.loads((d/'manifest.json').read_bytes());files={str(p.relative_to(d))for p in d.rglob('*')if p.is_file()and p.name!='manifest.json'};need(files==set(mf)and all(not p.is_symlink()and(p.is_file()or p.is_dir())for p in d.rglob('*')),'complete-private-evidence-files');need(all(safe(n)and file_hash(d/n)==h for n,h in mf.items()),'all-prior-evidence-bytes-sealed');v=json.loads((d/'result.private.json').read_bytes());need(v['success']is True and(v['target'],v['tree'],v['appTree'])==(TARGET,TREE,APP_TREE),'successful-source-bound-prior-phase');return v,d

def gate_record(path):
 a=path.lstat();need(stat.S_ISREG(a.st_mode)and a.st_size==0 and a.st_uid==0 and a.st_gid==0 and stat.S_IMODE(a.st_mode)==0o644,'own-empty-root-maintenance-gate');return(a.st_dev,a.st_ino,a.st_uid,a.st_gid,a.st_mode,a.st_size,a.st_mtime_ns,a.st_ctime_ns)

def health():
 for _ in range(40):
  row=memory(['docker','inspect',CID])[0]
  if row['State']['Running']and row['State'].get('Health',{}).get('Status')=='healthy':return
  time.sleep(2)
 need(False,'engineering-health-after-single-start')

def file_hash(path):
 h=hashlib.sha256()
 with path.open('rb')as f:
  for b in iter(lambda:f.read(1024**2),b''):h.update(b)
 return h.hexdigest()

def transport(value):
 raw=enc(value);need(len(raw)<=4*1024**2,'bounded-secret-free-hash-receipt');payload=base64.b64encode(raw).decode();chunks=[payload[i:i+5000]for i in range(0,len(payload),5000)]
 for i,b in enumerate(chunks):print(enc({'kind':'result-part','part':i+1,'total':len(chunks),'fullSha256':sha(raw),'encoding':'base64','data':b}).decode(),flush=True)
 print(enc({'kind':'result-receipt','bytes':len(raw),'fullSha256':sha(raw),'parts':len(chunks),'mode':value['mode'],'resultPath':value['resultPath']}).decode(),flush=True)

def safe(n):
 p=pathlib.PurePosixPath(n);return type(n)is str and bool(n)and str(p)==n and not p.is_absolute()and '..'not in p.parts and '\\'not in n and all(ord(c)>=32 for c in n)
def utc_ns(value):
 need(type(value)is str,'typed-docker-start-time');m=re.fullmatch(r'(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(?:\.(\d{1,9}))?(Z|[+-]\d\d:\d\d)',value);need(m is not None,'valid-docker-start-time')
 whole=datetime.datetime.fromisoformat(m[1]+('+00:00'if m[3]=='Z'else m[3]));return int(whole.timestamp())*10**9+int((m[2]or'').ljust(9,'0'))
def setup():
 global P,E,I
 P=load('pr1035-quote-preflight.py');E=load('pr1030-engineering-preflight.py');I=load('batch1003-image-library.py');P.OUT=OUT;P.command=lambda args,limit=8*1024**2,data=None,timeout=90:run(args,data,timeout)
def baseline():
 p=ROOT/'deploy/backups/pr1030-engineering-preflight-1/result.private.json';meta=P.shared_file(str(p));need(meta['uid']==0 and meta['gid']==0 and meta['mode']==0o600 and meta['bytes']<=1024**2,'owned-private-preflight-evidence');v=json.loads(p.read_bytes());unsigned={k:x for k,x in v.items()if k not in('resultSHA256','sha256Wire')};need(v.get('success')is True and v.get('readOnly')is True and v.get('resultSHA256')==PREFLIGHT_RESULT_SHA256==sha(enc(unsigned)),'source-bound-successful-readonly-preflight');need(v['hostGitHead']==HOST_BASE and v['runtime']['id']==CID and v['runtime']['image']==LIVE_IMAGE and v['canonicalAlias']['id']==BASE_IMAGE and v['configFile']['sha256']==CONFIG_FILE_SHA256 and v['dependencyLock']['sha256']==DEPENDENCY_LOCK_SHA256,'exact-approved-baseline-constants');return v
def data_capture(label):
 data=ROOT/APP/'资料库存储';before=data.lstat();inventory,summary=E.full_inventory(data);after=data.lstat();need((before.st_dev,before.st_ino,before.st_mtime_ns,before.st_uid,before.st_gid,before.st_mode)==(after.st_dev,after.st_ino,after.st_mtime_ns,after.st_uid,after.st_gid,after.st_mode),'stable-data-root-during-inventory');inventory['root']['mtimeNs']=after.st_mtime_ns;summary['sha256']=sha(enc(inventory));private(OUT/(label+'.private.json'),enc(inventory));return summary

def space_check(label):
 need(label in('before-prepare','after-prepare','before-live-write')and MIN_AVAILABLE>=512*1024**2 and MIN_PHYSICAL_FREE>=4*1024**3,'reviewed-measured-space-budget-required');s=os.statvfs(json.loads(run(['docker','info','--format','{{json .DockerRootDir}}'])));v={'available':s.f_bavail*s.f_frsize,'free':s.f_bfree*s.f_frsize};need(v['available']>=MIN_AVAILABLE and v['free']>=MIN_PHYSICAL_FREE,'frontend-only-space-budget-'+label);return v

def source_check():
 global PATCH
 need(all(pin(v,40)for v in(BASE,TARGET,TREE,HEAD,APP_TREE))and REVIEWED_FILES and all(safe(n)and pin(h)for n,h in REVIEWED_FILES.items()),'final-reviewed-source-pins-required');git('fetch','--no-write-fetch-head','origin','+refs/heads/main:refs/remotes/origin/main');need(git('rev-parse','refs/remotes/origin/main').decode().strip()==TARGET and git('rev-parse',TARGET+'^{tree}').decode().strip()==TREE,'exact-main-tree');need(git('rev-parse',TARGET+':'+APP).decode().strip()==APP_TREE==git('rev-parse',HEAD+':'+APP).decode().strip(),'reviewed-app-tree');git('merge-base','--is-ancestor',HEAD,TARGET)
 changed=[n[len(APP)+1:]for n in git('diff','--name-only','-z',SOURCE_BASE,TARGET,'--',APP).decode().split('\0')if n];need(set(changed)==set(REVIEWED_FILES),'exact-reviewed-app-path-manifest')
 for n,h in REVIEWED_FILES.items():need(sha(git('show',TARGET+':'+APP+'/'+n))==h,'reviewed-blob-sha')
 for n in('Dockerfile','package-lock.json'):need(git('show',TARGET+':'+APP+'/'+n)==git('show',SOURCE_BASE+':'+APP+'/'+n),'unchanged-build-recipe-and-lock')
 old=json.loads(git('show',SOURCE_BASE+':'+APP+'/package.json'));new=json.loads(git('show',TARGET+':'+APP+'/package.json'));need({k:v for k,v in old.items()if k!='scripts'}=={k:v for k,v in new.items()if k!='scripts'}and all(new['scripts'].get(k)==v for k,v in old['scripts'].items()),'same-dependencies-and-existing-build-runtime-scripts')
 PATCH=tuple(sorted(n for n in REVIEWED_FILES if n.startswith('src/')or n in ROOT_CODE));need(PATCH and not any(n.startswith('资料库存储/')or n.startswith('.env')or n=='docs.config.json'for n in PATCH),'code-only-runtime-overlay');need(TEST_PATHS and all(n.startswith('tests/')and n.endswith('.cjs')and safe(n)for n in TEST_PATHS),'reviewed-portable-candidate-tests-required');return PATCH

PUBLIC_PROBE=r"""const fs=require('fs'),path=require('path'),crypto=require('crypto');let out={};for(const n of JSON.parse(fs.readFileSync(0,'utf8'))){if(!/^[A-Za-z0-9_./-]+$/.test(n)||n.split('/').some(p=>p==='..'||p==='')||n==='docs.config.json'||n.startsWith('.env'))throw Error('scope');const p='/app/'+n;let dir=path.dirname(p);while(dir!=='/'){if(fs.lstatSync(dir).isSymbolicLink())throw Error('parent-link');dir=path.dirname(dir);}if(!fs.existsSync(p)){out[n]={absent:true};continue;}const s=fs.lstatSync(p);if(!s.isFile()||s.isSymbolicLink()||s.size>128*1024**2)throw Error('source');const b=fs.readFileSync(p);out[n]={sha256:crypto.createHash('sha256').update(b).digest('hex'),gitBlobSHA1:crypto.createHash('sha1').update('blob '+b.length+'\0').update(b).digest('hex'),bytes:b.length,uid:s.uid,gid:s.gid,mode:s.mode&4095};}console.log(JSON.stringify(out));"""
DEPS_PROBE=r"""const fs=require('fs'),path=require('path'),crypto=require('crypto');const H=b=>crypto.createHash('sha256').update(b).digest('hex');function tree(root){let rows=[],bytes=0;function walk(p,n){const s=fs.lstatSync(p),v={path:n,uid:s.uid,gid:s.gid,mode:s.mode&4095};if(s.isSymbolicLink()){v.type='link';v.target=fs.readlinkSync(p);}else if(s.isDirectory()){v.type='dir';rows.push(v);for(const q of fs.readdirSync(p).sort())walk(path.join(p,q),n?n+'/'+q:q);return;}else if(s.isFile()){bytes+=s.size;if(bytes>1024**3)throw Error('bounded');v.type='file';v.bytes=s.size;v.sha256=H(fs.readFileSync(p));}else throw Error('kind');rows.push(v);if(rows.length>100000)throw Error('bounded');}walk(root,'');return{sha256:H(JSON.stringify(rows)),entries:rows.length,bytes};}console.log(JSON.stringify({node:process.version,dependencies:tree('/app/node_modules'),lock:tree('/app/package-lock.json'),config:tree('/app/docs.config.json'),installLockSHA256:H(fs.readFileSync('/app/node_modules/.package-lock.json')),configSHA256:H(fs.readFileSync('/app/docs.config.json'))}));"""
QUIET_PROBE=r"""const fs=require('fs');let connections=0,writes=0;for(const f of ['/proc/net/tcp','/proc/net/tcp6'])for(const line of fs.readFileSync(f,'utf8').trim().split('\n').slice(1)){const p=line.trim().split(/\s+/);if(parseInt(p[1].split(':').at(-1),16)===3100&&!['0A','06','07'].includes(p[3]))connections++;}for(const p of fs.readdirSync('/proc').filter(x=>/^\d+$/.test(x))){let files;try{files=fs.readdirSync('/proc/'+p+'/fd');}catch(e){if(e.code==='ENOENT')continue;throw e;}for(const n of files){try{const target=fs.readlinkSync('/proc/'+p+'/fd/'+n);if(target==='/data'||target.startsWith('/data/')){const info=fs.readFileSync('/proc/'+p+'/fdinfo/'+n,'utf8'),m=info.match(/^flags:\s+([0-7]+)$/m);if(!m)throw Error('fdflags');if(parseInt(m[1],8)&3)writes++;}}catch(e){if(e.code!=='ENOENT'&&e.code!=='ESRCH')throw e;}}}console.log(JSON.stringify({connections,writes}));"""

def node(cid,script,data=None,image_mode=False):
 args=['docker','exec','--user','0','-i',cid,'node','-e',script]if not image_mode else['docker','run','--rm','-i','--network','none','--read-only','--restart','no','--log-driver','none','--entrypoint','node',cid,'-e',script]
 return json.loads(run(args,data,timeout=300))

def image_run(args,data=None,timeout=180):
 # Reused scratch validators need raw inspect in memory, never Config/Env command logs.
 if args[:2]==['docker','inspect']or args[:3]==['docker','image','inspect']:return enc(memory(args))
 return run(args,data,timeout)

def source_contract(cid,revision,label,image_mode=False):
 expected={}
 for row in git('ls-tree','-r','-z',revision,'--',APP).split(b'\0'):
  if not row:continue
  meta,name=row.split(b'\t',1);mode,kind,blob=meta.decode().split();n=name.decode()[len(APP)+1:]
  if not(n.startswith(('src/','public/'))or n in ROOT_CODE or n=='package-lock.json'):continue
  need(mode in('100644','100755')and kind=='blob'and safe(n),'regular-public-production-source');expected[n]=blob
 actual=node(cid,PUBLIC_PROBE,enc(sorted(expected)),image_mode);need(set(actual)==set(expected)and all(actual[n].get('gitBlobSHA1')==blob for n,blob in expected.items()),'all-tracked-public-source-'+label);private(OUT/(label+'-source.private.json'),enc(actual));return actual

def dependency_contract(cid,image_mode=False):
 v=node(cid,DEPS_PROBE,image_mode=image_mode);need(v['node']=='v20.20.2'and v['configSHA256']==CONFIG_FILE_SHA256 and v['installLockSHA256']==DEPENDENCY_LOCK_SHA256,'fixed-node-config-dependency-observation');return v

def extract_filtered(destination):
 destination.mkdir(mode=0o700);selected=[]
 for row in git('ls-tree','-r','-z',TARGET,'--',APP).split(b'\0'):
  if not row:continue
  meta,name=row.split(b'\t',1);mode,kind,blob=meta.decode().split();full=name.decode();n=full[len(APP)+1:]
  if not(n.startswith(('src/','public/','tests/'))or n in ROOT_CODE or n=='package-lock.json'):continue
  need(mode in('100644','100755')and kind=='blob'and safe(n),'filtered-git-regular-build-input');selected.append(full)
 need(selected,'nonempty-filtered-source');raw=git('archive',TARGET,*selected)
 with tarfile.open(fileobj=io.BytesIO(raw))as archive:
  total=0
  for member in archive:
   if member.isdir()and(APP==member.name.rstrip('/')or APP.startswith(member.name.rstrip('/')+'/')):continue
   need(member.name.startswith(APP+'/')and(member.isfile()or member.isdir())and not member.issym()and not member.islnk(),'regular-source-archive')
   n=member.name[len(APP)+1:]
   if not n:continue
   need(safe(n)and not any(x in('资料库存储','node_modules','dist','.git')or x.startswith('.env')for x in pathlib.PurePosixPath(n).parts)and n!='docs.config.json','no-data-env-or-live-config-in-source')
   p=destination/n
   if member.isdir():p.mkdir(mode=0o755,parents=True,exist_ok=True);continue
   total+=member.size;need(member.size<=128*1024**2 and total<=512*1024**2,'bounded-filtered-build-source');p.parent.mkdir(mode=0o755,parents=True,exist_ok=True);body=archive.extractfile(member).read();need(len(body)==member.size,'full-public-source-file');private(p,body);p.chmod(member.mode&0o777)
 need(not(destination/'node_modules').exists()and not(destination/'docs.config.json').exists(),'source-omits-dependencies-and-config');return I.manifest(destination)

def code_manifest(folder):
 values=I.manifest(folder)
 for n,v in values.items():v['mtime']=int((folder/n).stat().st_mtime)
 return values

def capture(cid,remote,destination,directory=False):
 destination.parent.mkdir(mode=0o755,parents=True,exist_ok=True);need(not destination.exists(),'fresh-code-capture');run(['docker','cp','--archive',cid+':/app/'+remote,str(destination)],timeout=300)
 if directory:need(destination.is_dir()and not destination.is_symlink(),'captured-code-directory');return code_manifest(destination)
 need(destination.is_file()and not destination.is_symlink(),'captured-code-file');s=destination.stat();return{'sha256':file_hash(destination),'bytes':s.st_size,'uid':s.st_uid,'gid':s.st_gid,'mode':stat.S_IMODE(s.st_mode),'mtime':int(s.st_mtime)}

def set_metadata(path,value):
 os.chown(path,value['uid'],value['gid']);os.chmod(path,value['mode']);os.utime(path,(value['mtime'],value['mtime']))

def bundle(folder,files,dirs):
 body=io.BytesIO()
 with tarfile.open(fileobj=body,mode='w')as archive:
  for n,v in sorted(dirs.items(),key=lambda x:(len(pathlib.PurePosixPath(x[0]).parts),x[0])):
   need(safe(n),'safe-code-directory');m=tarfile.TarInfo(n);m.type=tarfile.DIRTYPE;m.uid=v['uid'];m.gid=v['gid'];m.mode=v['mode'];m.mtime=v['mtime'];archive.addfile(m)
  for n,v in sorted(files.items()):
   need(safe(n)and not n.startswith(('资料库存储/','node_modules/'))and n!='docs.config.json','public-patch-only');p=folder/n;need(p.is_file()and not p.is_symlink()and file_hash(p)==v['sha256'],'patch-bytes-exact');m=tarfile.TarInfo(n);m.uid=v['uid'];m.gid=v['gid'];m.mode=v['mode'];m.mtime=v['mtime'];m.size=p.stat().st_size
   with p.open('rb')as f:archive.addfile(m,f)
 return body.getvalue()

def directory_values(folder):
 out={}
 for p in sorted(folder.rglob('*')):
  if p.is_dir():
   s=p.stat();out[p.relative_to(folder).as_posix()]={'uid':s.st_uid,'gid':s.st_gid,'mode':stat.S_IMODE(s.st_mode),'mtime':int(s.st_mtime)}
 return out

def metadata_readback(cid,files,dirs,label):
 # Read only the fixed logical roots, never /app as a whole (which may contain image-baked data).
 dest=OUT/label;dest.mkdir(mode=0o700)
 capture(cid,'dist',dest/'dist',True);capture(cid,'src',dest/'src',True)
 for n in PATCH:
  if not n.startswith('src/'):capture(cid,n,dest/n)
 actual=code_manifest(dest);need(set(files)<=set(actual)and all(actual[n]==v for n,v in files.items())and {n for n in actual if n.startswith('dist/')}=={n for n in files if n.startswith('dist/')},'stopped-code-bytes-owner-mode-mtime-'+label)
 observed=directory_values(dest);project=lambda v:{k:v[k]for k in('uid','gid','mode')};need(all(n in observed and project(observed[n])==project(v)for n,v in dirs.items()),'stopped-code-directory-owner-mode-'+label)

def local_alias(image_id):
 alias='rrportal-pr1030-base:'+image_id.split(':')[1];probe=subprocess.run(['docker','image','inspect',alias],capture_output=True,timeout=30)
 need(probe.returncode==0 or b'No such image'in probe.stderr or b'No such object'in probe.stderr,'known-local-base-alias-absence')
 if probe.returncode==0:need(json.loads(probe.stdout)[0]['Id']==image_id,'base-alias-cas')
 else:run(['docker','tag',image_id,alias])
 return alias

def build_images():
 base=image(BASE_IMAGE);need(not base['Config'].get('Volumes'),'no-anonymous-data-volumes');old_signature=dependency_contract(CID);need(old_signature==dependency_contract(BASE_IMAGE,True),'live-and-durable-dependencies-config-identical')
 old_source=source_contract(CID,SOURCE_BASE,'old-live');need(old_source==source_contract(BASE_IMAGE,SOURCE_BASE,'old-base',True),'live-source-equals-accepted-base')
 source=OUT/'source';source_manifest=extract_filtered(source);context=OUT/'frontend-context';context.mkdir(mode=0o700);shutil.copytree(source,context/'source');alias=local_alias(BASE_IMAGE)
 recipe='FROM '+alias+'\nUSER 0\nRUN test ! -e /rr-pr1030-build\nWORKDIR /rr-pr1030-build\nCOPY source/ ./\nRUN ln -s /app/node_modules ./node_modules && npm run build\n'
 private(context/'Dockerfile',recipe.encode());front_tag='rrportal-pr1030-frontend:'+TARGET;need(not any(r.split(' ',1)[0]==front_tag for r in run(['docker','image','ls','--no-trunc','--format','{{.Repository}}:{{.Tag}} {{.ID}}']).decode().splitlines()),'fresh-frontend-tag');run(['docker','build','--network=none','--pull=false','-t',front_tag,str(context)],timeout=900);front=image(front_tag)['Id'];fresh=OUT/'fresh-dist';cid,token=I.scratch(front,SERVICE,TARGET,image_run)
 try:run(['docker','cp','--archive',cid+':/rr-pr1030-build/dist',str(fresh)],timeout=300);I.manifest(fresh)
 finally:I.remove_scratch(cid,token,front,SERVICE,TARGET,image_run)
 old=OUT/'old-overlay';old.mkdir(mode=0o700);capture(CID,'dist',old/'dist',True);capture(CID,'src',old/'src',True)
 old_files={}
 for n in PATCH:
  if n in old_source:old_files[n]=capture(CID,n,old/n)if not n.startswith('src/')else dict(old_source[n],mtime=int((old/n).stat().st_mtime))
 prototype=capture(CID,'vite-plugin-docs-api.ts',OUT/'prototype.ts');overlay=OUT/'overlay';overlay.mkdir(mode=0o700);static=I.union_static(old/'dist',fresh,overlay/'dist');old_static=code_manifest(old/'dist')
 for p in sorted((overlay/'dist').rglob('*')):
  if p.is_file():
   n=p.relative_to(overlay/'dist').as_posix();v=old_static.get(n);meta=dict(v or prototype)
   if not v or file_hash(p)!=v['sha256']:meta['mtime']=max(int(time.time())+2,int(meta['mtime'])+2)
   set_metadata(p,meta)
 for n in PATCH:
  p=overlay/n;p.parent.mkdir(mode=0o755,parents=True,exist_ok=True);private(p,(source/n).read_bytes());meta=dict(old_files.get(n,prototype));meta['mtime']=max(int(time.time())+2,int(meta['mtime'])+2);set_metadata(p,meta)
 # Preserve original directory metadata where present; derive only genuinely new dirs from a fixed prototype.
 old_dirs=directory_values(old)
 for p in sorted(overlay.rglob('*'),key=lambda p:len(p.parts),reverse=True):
  if p.is_dir():set_metadata(p,old_dirs.get(p.relative_to(overlay).as_posix(),dict(prototype,mode=0o755)))
 files=code_manifest(overlay);dirs=directory_values(overlay);patch=bundle(overlay,files,dirs);private(OUT/'patch.tar',patch);rollback_files={n:v for n,v in code_manifest(old).items()if n.startswith('dist/')or n in old_files};rollback_dirs={n:v for n,v in old_dirs.items()if n=='dist'or n.startswith('dist/')or any(f.startswith(n+'/')for f in old_files)};private(OUT/'old-code.tar',bundle(old,rollback_files,rollback_dirs))
 derivative=OUT/'derivative-context';derivative.mkdir(mode=0o700);shutil.copytree(overlay,derivative/'overlay');labels={'org.opencontainers.image.revision':TARGET,'io.rr-portal.release-service':SERVICE,'io.rr-portal.app-tree':APP_TREE}
 recipe='FROM '+alias+'\n'+''.join('COPY --chown=%d:%d %s\n'%(v['uid'],v['gid'],json.dumps(['overlay/'+n,'/app/'+n]))for n,v in files.items())+'LABEL '+' '.join(k+'='+json.dumps(v)for k,v in labels.items())+'\n';private(derivative/'Dockerfile',recipe.encode());tag='rrportal-pr1030-durable:'+TARGET;run(['docker','build','--network=none','--pull=false','-t',tag,str(derivative)],timeout=300);candidate=image(tag);a,b=copy.deepcopy(base['Config']),copy.deepcopy(candidate['Config']);a.pop('Image',None);b.pop('Image',None);a['Labels']=dict(a.get('Labels')or{},**labels);need(a==b and candidate['Architecture']==base['Architecture']and candidate['Os']==base['Os']and candidate['RootFS']['Layers'][:len(base['RootFS']['Layers'])]==base['RootFS']['Layers'],'durable-exact-base-layers-and-config')
 need(dependency_contract(candidate['Id'],True)==old_signature,'durable-config-and-dependencies-exact');new_source=source_contract(candidate['Id'],TARGET,'candidate',True)
 cid,token=I.scratch(candidate['Id'],SERVICE,TARGET,image_run)
 try:
  metadata_readback(cid,files,dirs,'durable-image-readback');run(['docker','cp','--archive','-',cid+':/app'],patch);metadata_readback(cid,files,dirs,'candidate-stopped-readback')
 finally:I.remove_scratch(cid,token,candidate['Id'],SERVICE,TARGET,image_run)
 tests=source/'tests';need(all((source/n).is_file()for n in TEST_PATHS),'reviewed-tests-extracted');run(['docker','run','--rm','--network','none','--read-only','--restart','no','--log-driver','none','--tmpfs','/tmp:rw,nosuid,nodev,size=256m','--mount','type=bind,source='+str(tests)+',target=/app/tests,readonly','--entrypoint','node',candidate['Id'],'--test',*['/app/'+n for n in TEST_PATHS]],timeout=300)
 return{'candidate':candidate['Id'],'frontendImage':front,'sourceManifestSHA256':sha(enc(source_manifest)),'files':files,'dirs':dirs,'oldStatic':old_static,'newStatic':code_manifest(overlay/'dist'),'oldSignature':old_signature,'newSource':new_source,'offlineTestsPassed':True,'neverStartedScratchCopyProof':True}

INTERNAL_HTTP=r"""const fs=require('fs'),crypto=require('crypto');(async()=>{let out={};for(const q of JSON.parse(fs.readFileSync(0,'utf8'))){if(!q.path.startsWith('/')||q.path.includes('..')||q.path.includes('\\'))throw Error('path');const r=await fetch('http://127.0.0.1:3100'+q.path,{redirect:'error',signal:AbortSignal.timeout(12000),headers:q.headers||{}});const h=crypto.createHash('sha256');let bytes=0;if(r.body){const reader=r.body.getReader();for(;;){const x=await reader.read();if(x.done)break;bytes+=x.value.byteLength;if(bytes>128*1024**2)throw Error('bounded');h.update(x.value);}}out[q.key]={status:r.status,sha256:h.digest('hex'),bytes,etag:r.headers.get('etag'),lastModified:r.headers.get('last-modified')};}console.log(JSON.stringify(out));})().catch(()=>{process.exitCode=1;});"""
GATEWAY_PATHS=('/','/paiji/health','/indo-shipping/api/health','/sprayplan/api/health','/internal-quote/health','/gongcheng-ziliao/health','/gongcheng-ziliao/')
def gateway():
 out={}
 for path in GATEWAY_PATHS:
  try:r=urllib.request.urlopen('http://127.0.0.1'+path,timeout=20)
  except urllib.error.HTTPError as e:r=e
  with r:need(len(r.read(2*1024**2+1))<=2*1024**2,'bounded-public-health-response');out[path]=r.status
 return out

def ingress(maintained=False,previous=None):
 v=gateway();need(v['/']in(200,401)and all(v[p]==200 for p in GATEWAY_PATHS if p not in('/','/gongcheng-ziliao/health','/gongcheng-ziliao/')),'other-services-available');need(v['/gongcheng-ziliao/health']==(503 if maintained else 200)and v['/gongcheng-ziliao/']==(503 if maintained else 401),'only-engineering-gated-auth-boundary')
 if previous:need(all(v[p]==previous[p]for p in GATEWAY_PATHS if not p.startswith('/gongcheng-ziliao/')),'other-public-statuses-unchanged')
 return v

def internal_http(static=None,previous=None,require_new_backend=False):
 queries=[{'key':'index','path':'/'},{'key':'session','path':'/api/epms/session'}]
 if static:queries.extend({'key':n,'path':'/'+urllib.parse.quote(n)}for n in sorted(static)if n!='index.html')
 if previous:
  for k,header in(('etag','If-None-Match'),('lastModified','If-Modified-Since')):
   if previous['index'][k]:queries.append({'key':'old-'+k,'path':'/','headers':{header:previous['index'][k]}})
 value=node(CID,INTERNAL_HTTP,enc(queries))
 need(value['index']['status']==200,'internal-entry-available')
 if static:
  need(value['index']['sha256']==static['index.html']['sha256']and all(value[n]['status']==200 and value[n]['sha256']==v['sha256']for n,v in static.items()if n!='index.html'),'all-new-and-old-public-graph-exact')
 if require_new_backend:need(value['session']['status']==401,'running-reviewed-epms-backend-anonymous-session-rejected')
 for k in value:
  if k.startswith('old-'):need(value[k]['status']==200 and value[k]['sha256']==static['index.html']['sha256'],'old-entry-validators-return-new-bytes')
 private(OUT/('http-'+str(SERIAL)+'.private.json'),enc(value));return value

def stable(before,protected):need(runtime()==before and protection(before)==protected,'all-original-runtime-env-host-auth-unchanged')
def quiescent():
 until=time.monotonic()+300;since=None;observed=[]
 while time.monotonic()<until:
  v=node(CID,QUIET_PROBE);need(set(v)=={'connections','writes'}and all(type(n)is int and n>=0 for n in v.values()),'typed-readonly-drain-counts');observed.append(v)
  if v=={'connections':0,'writes':0}:
   if since is None:since=time.monotonic()
   if time.monotonic()-since>=3:private(OUT/'drain.private.json',enc({'observations':observed,'stableZeroSeconds':3,'processWritesObservedOnly':True}));return
  else:since=None
  time.sleep(1)
 private(OUT/'drain-timeout.private.json',enc(observed));need(False,'inflight-upload-drain-timeout-before-stop-no-replay')

R1=ROOT/'deploy/backups/pr1030-engineering-20261029'/'prepare'
R1_MANIFEST='90282d32240e4e13dfca997b523202bb33faf63ae46d4b610150e1edc21d7a6d'
R1_RESULT='43abc8c275ea8aeec576122053d2197be2d7202d009bff32ba9d280c2f949b6e'

def failed_prepare():
 need(R1.is_dir() and not R1.is_symlink(),'original-private-failed-phase')
 mfraw=(R1/'manifest.json').read_bytes();need(sha(mfraw)==R1_MANIFEST,'original-failed-manifest-pin');mf=json.loads(mfraw)
 paths=list(R1.rglob('*'));need(all(not p.is_symlink() and (p.is_file() or p.is_dir()) for p in paths),'regular-original-evidence')
 need({str(p.relative_to(R1)) for p in paths if p.is_file() and p!=R1/'manifest.json'}==set(mf),'original-complete-evidence-set')
 need(all(safe(n) and file_hash(R1/n)==h for n,h in mf.items()),'every-original-file-sha-exact')
 raw=(R1/'result.private.json').read_bytes();v=json.loads(raw);need(sha(raw)==R1_RESULT and v['success']is False and v['phase']=='prepare' and v['stage']=='single-command-success-no-replay' and (v['target'],v['tree'],v['appTree'])==(TARGET,TREE,APP_TREE),'exact-original-failed-prepare-only');return mf

def sealed_tar(name):
 raw=(R1/name).read_bytes();files={};dirs={};seen=set();total=0
 with tarfile.open(fileobj=io.BytesIO(raw)) as archive:
  for m in archive:
   n=m.name;need(safe(n) and n not in seen and (m.isfile() or m.isdir()) and not m.issym() and not m.islnk(),'unique-regular-code-tar');seen.add(n)
   need(n=='dist' or n.startswith('dist/') or n in PATCH or m.isdir() and any(x.startswith(n+'/') for x in PATCH),'reviewed-code-tar-scope');v={'uid':m.uid,'gid':m.gid,'mode':m.mode,'mtime':m.mtime}
   if m.isdir():dirs[n]=v;continue
   b=archive.extractfile(m).read();total+=len(b);need(len(b)==m.size<=128*1024**2 and total<=512*1024**2,'bounded-complete-code-tar');files[n]=dict(v,sha256=sha(b),bytes=len(b))
 need('dist/index.html' in files,'sealed-static-entry');return raw,files,dirs

def reviewed_tests(candidate):
 tests=R1/'source/tests';expected={n[len('tests/'):]:REVIEWED_FILES[n] for n in TEST_PATHS}
 need(all((tests/n).is_file() and not (tests/n).is_symlink() and file_hash(tests/n)==h for n,h in expected.items()),'all-six-reviewed-test-source-bytes')
 script=r'''const fs=require('fs'),crypto=require('crypto'),cp=require('child_process');const expected=JSON.parse(fs.readFileSync(0,'utf8'));for(const [n,h]of Object.entries(expected)){if(!/^[A-Za-z0-9_.-]+\.cjs$/.test(n))throw Error('scope');const p='/reviewed-tests/'+n,s=fs.lstatSync(p);if(!s.isFile()||s.isSymbolicLink())throw Error('kind');const b=fs.readFileSync(p),H=x=>crypto.createHash('sha256').update(x).digest('hex');if(H(b)!==h)throw Error('source');fs.writeFileSync('/app/tests/'+n,b,{flag:'wx',mode:0o444});if(H(fs.readFileSync('/app/tests/'+n))!==h)throw Error('copy');}const r=cp.spawnSync(process.execPath,['--test',...Object.keys(expected).map(n=>'/app/tests/'+n)],{stdio:'inherit',timeout:270000});if(r.error||r.signal||r.status===null)process.exit(1);process.exit(r.status);'''
 raw=run(['docker','run','--rm','-i','--network','none','--read-only','--restart','no','--log-driver','none','--tmpfs','/tmp:rw,nosuid,nodev,size=256m','--tmpfs','/app/tests:rw,nosuid,nodev,size=128m,mode=1777','--mount','type=bind,source='+str(tests)+',target=/reviewed-tests,readonly','--entrypoint','node',candidate,'-e',script],enc(expected),timeout=300)
 need(all(re.search(rb'^# '+k+rb' '+str(v).encode()+rb'\r?$',raw,re.M) for k,v in ((b'tests',18),(b'pass',18),(b'fail',0),(b'cancelled',0),(b'skipped',0))),'same-eighteen-tests-no-skip');return True

def prepare_adopt_r1():
 source_check();accepted=baseline();mf=failed_prepare();before=json.loads((R1/'runtime-before.private.json').read_bytes());protected=json.loads((R1/'protected.private.json').read_bytes());stable(before,protected)
 need(before[CID]['running'] and before[CID]['health']=='healthy' and image(ALIAS)['Id']==BASE_IMAGE,'original-live-and-canonical-unchanged');need(before[CID]['config']==accepted['configSHA256'] and before[CID]['hostConfig']==accepted['hostConfigSHA256'] and all(before[CID][k]==accepted['runtime'][x] for k,x in (('pid','pid'),('started','started'),('restarts','restarts'))),'same-original-preflight-process')
 private(OUT/'runtime-before.private.json',enc(before));private(OUT/'protected.private.json',enc(protected));space_before=space_check('before-prepare');public=ingress()
 saved_http=list(R1.glob('http-*.private.json'));need(len(saved_http)==1,'unique-original-entry-http');old_http=internal_http();need(old_http==json.loads(saved_http[0].read_bytes()),'same-original-entry-body-and-validators')
 old_signature=dependency_contract(CID);need(old_signature==dependency_contract(BASE_IMAGE,True),'unchanged-live-and-base-dependencies')
 old_source=source_contract(CID,SOURCE_BASE,'r2-old-live');need(old_source==json.loads((R1/'old-live-source.private.json').read_bytes()) and old_source==source_contract(BASE_IMAGE,SOURCE_BASE,'r2-old-base',True),'old-public-source-still-exact')
 patch,files,dirs=sealed_tar('patch.tar');rollback,oldfiles,olddirs=sealed_tar('old-code.tar');need(set(files)=={'dist/'+n for n in code_manifest(R1/'overlay/dist')}|set(PATCH),'complete-target-overlay')
 old_static={n[5:]:v for n,v in oldfiles.items() if n.startswith('dist/')};new_static={n[5:]:v for n,v in files.items() if n.startswith('dist/')};fresh=I.manifest(R1/'fresh-dist')
 need(set(new_static)==set(old_static)|set(fresh) and all(new_static[n]['sha256']==(fresh[n]['sha256'] if n in fresh else old_static[n]['sha256']) for n in new_static) and all(n not in old_static or not n.startswith('assets/') or v['sha256']==old_static[n]['sha256'] for n,v in fresh.items()),'sealed-complete-old-new-static-union')
 candidate=image('rrportal-pr1030-durable:'+TARGET);base=image(BASE_IMAGE);labels={'org.opencontainers.image.revision':TARGET,'io.rr-portal.release-service':SERVICE,'io.rr-portal.app-tree':APP_TREE};a,b=copy.deepcopy(base['Config']),copy.deepcopy(candidate['Config']);a.pop('Image',None);b.pop('Image',None);a['Labels']=dict(a.get('Labels')or{},**labels)
 need(not base['Config'].get('Volumes') and a==b and candidate['Architecture']==base['Architecture'] and candidate['Os']==base['Os'] and candidate['RootFS']['Layers'][:len(base['RootFS']['Layers'])]==base['RootFS']['Layers'],'same-immutable-base-config-layers-no-volumes');immutable=candidate['Id']
 need(dependency_contract(immutable,True)==old_signature,'candidate-dependencies-config-exact');new_source=source_contract(immutable,TARGET,'r2-candidate',True);need(new_source==json.loads((R1/'candidate-source.private.json').read_bytes()),'same-original-candidate-public-source')
 cid,token=I.scratch(immutable,SERVICE,TARGET,image_run)
 try:metadata_readback(cid,files,dirs,'r2-durable-image-readback')
 finally:I.remove_scratch(cid,token,immutable,SERVICE,TARGET,image_run)
 reviewed_tests(immutable);need(image('rrportal-pr1030-durable:'+TARGET)['Id']==immutable,'candidate-tag-still-same-immutable-image');private(OUT/'patch.tar',patch);private(OUT/'old-code.tar',rollback)
 stable(before,protected);need(failed_prepare()==mf,'original-failed-evidence-still-exact');space_after=space_check('after-prepare')
 return {'candidate':immutable,'frontendImage':image('rrportal-pr1030-frontend:'+TARGET)['Id'],'sourceManifestSHA256':sha(enc(I.manifest(R1/'source'))),'files':files,'dirs':dirs,'oldStatic':old_static,'newStatic':new_static,'oldSignature':old_signature,'newSource':new_source,'offlineTestsPassed':True,'neverStartedScratchCopyProof':True,'runtime':before,'protected':protected,'oldHttp':old_http,'public':public,'spaceBefore':space_before,'spaceAfter':space_after,'dataNotCopied':True,'adoptedFailedManifestSHA256':R1_MANIFEST,'adoptedFailedResultSHA256':R1_RESULT,'noBuildReplay':True,'copyProofInheritedFromSealedR1':True}

def prepare():
 return prepare_adopt_r1()

def deploy():
 source_check();receipt,d=sealed('prepare',PREPARED_SHA256);p=receipt['details'];before=runtime();protected=protection(before);need(before==p['runtime']and protected==p['protected']and image(ALIAS)['Id']==BASE_IMAGE,'prepared-runtime-host-auth-and-alias-cas');need(dependency_contract(CID)==p['oldSignature'],'preswitch-deps-and-private-config-exact');source_contract(CID,SOURCE_BASE,'preswitch');space_check('before-live-write');public=ingress();old_http=internal_http();path=ROOT/'deploy/maintenance/services'/SERVICE;need(path.parent.is_dir()and not path.parent.is_symlink()and not path.exists()and not path.is_symlink(),'new-service-only-marker');fd=os.open(path,os.O_CREAT|os.O_EXCL|os.O_WRONLY|os.O_NOFOLLOW,0o644);os.fchmod(fd,0o644);os.close(fd);owned=gate_record(path);private(OUT/'gate.private.json',enc(owned));ingress(True,public);quiescent();need(runtime()==before and protection(before)==protected,'runtime-and-protection-still-exact-before-stop')
 begin=time.time_ns();private(OUT/'start-window.private.json',enc({'beginNs':begin}));run(['docker','stop','--time','30',CID],timeout=90);need(not memory(['docker','inspect',CID])[0]['State']['Running'],'same-cid-stopped-once')
 cold=data_capture('cold-before');need(cold['links']==0,'regular-reviewed-data-root-no-links');run(['docker','cp','--archive','-',CID+':/app'],(d/'patch.tar').read_bytes());metadata_readback(CID,p['files'],p['dirs'],'live-stopped-code-readback');run(['docker','start',CID],timeout=90);health()
 after=runtime();need(set(after)==set(before)and all(after[c]==before[c]for c in before if c!=CID),'all-other-existing-containers-exact');a,b=before[CID],after[CID];need(b==dict(a,pid=b['pid'],started=b['started'],restarts=0)and b['pid']!=a['pid']and b['started']!=a['started']and b['running']and b['health']=='healthy','one-same-cid-manual-start-only');need(begin<=utc_ns(b['started'])<=time.time_ns(),'manual-start-in-operation-window')
 after_data=data_capture('cold-after');need(after_data==cold,'all-data-files-hidden-types-hashes-owners-modes-times-preserved');need(source_contract(CID,TARGET,'live-new')==p['newSource']and dependency_contract(CID)==p['oldSignature'],'live-source-dependencies-and-config-exact');internal_http(p['newStatic'],old_http,True);need(protection(after)==protected and runtime()==after and image(ALIAS)['Id']==BASE_IMAGE and gate_record(path)==owned,'final-host-runtime-alias-marker-cas');run(['docker','tag',p['candidate'],ALIAS]);need(image(ALIAS)['Id']==p['candidate']and gate_record(path)==owned,'durable-alias-promoted-once-owned-marker');path.unlink();ingress(False,public)
 return{'runtime':after,'protected':protected,'candidate':p['candidate'],'sameContainer':CID,'liveImage':LIVE_IMAGE,'durableImage':p['candidate'],'dataSummary':cold,'allDataExactInStoppedInterval':True,'allOtherContainersUnchanged':True,'sameStopCopyStartOnce':True,'noDataCopyOrRestore':True,'serviceMarkerCleared':True}

def verify():
 source_check();receipt,_=sealed('deploy',DEPLOY_SHA256);p=receipt['details'];need(runtime()==p['runtime']and protection(p['runtime'])==p['protected']and image(ALIAS)['Id']==p['candidate'],'current-runtime-host-config-auth-and-durable-alias');need(not(ROOT/'deploy/maintenance/services'/SERVICE).exists(),'service-marker-cleared');prepared=sealed('prepare',PREPARED_SHA256)[0]['details'];need(source_contract(CID,TARGET,'verify-source')==prepared['newSource']and dependency_contract(CID)==prepared['oldSignature'],'verified-tracked-source-and-original-dependencies-config');internal_http(prepared['newStatic'],require_new_backend=True);public=ingress();return{'sameContainer':CID,'durableImage':p['candidate'],'public':public,'allOtherContainersUnchanged':True,'businessDataNotComparedAcrossUserWriteWindow':True,'noProductionBusinessWriteTests':True}

def main():
 global OUT
 need(EXECUTE is True and PHASE in('prepare','deploy','verify')and sys.argv[1:]==[PHASE]and os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_MODE')==PHASE and os.environ.get('RELEASE_ATTEMPT')=='1','explicit-first-attempt-only');need(all(pin(v,40)for v in(BASE,TARGET,TREE,HEAD,APP_TREE))and REVIEWED_FILES and TEST_PATHS,'final-source-and-test-pins-required');os.umask(0o077);need(ARCHIVE.parent.is_dir()and not ARCHIVE.parent.is_symlink(),'private-existing-archive-parent');ARCHIVE.mkdir(mode=0o700,exist_ok=True);OUT=ARCHIVE/PHASE;need(not OUT.exists()and not OUT.is_symlink(),'fresh-private-phase-no-replay');OUT.mkdir(mode=0o700);v={'phase':PHASE,'mode':PHASE,'base':BASE,'target':TARGET,'tree':TREE,'head':HEAD,'appTree':APP_TREE,'success':False,'service':SERVICE,'resultPath':str(OUT/'result.private.json'),'hostSourceCheckoutPerformed':False,'automaticMutationRetry':False,'businessDataRestorePerformed':False,'otherServicesLifecycleOperated':False}
 try:setup();v['details']={'prepare':prepare,'deploy':deploy,'verify':verify}[PHASE]();v['success']=True
 except Exception as e:v.update(errorType=type(e).__name__,stage=STAGE)
 private(OUT/'result.private.json',enc(v));paths=list(OUT.rglob('*'));need(all(not p.is_symlink()and(p.is_file()or p.is_dir())for p in paths),'regular-private-evidence');mf={str(p.relative_to(OUT)):file_hash(p)for p in paths if p.is_file()};private(OUT/'manifest.json',enc(mf));digest=sha(enc(mf));receipt=dict(v,resultSHA256=sha(enc(v)),manifestSHA256=digest);receipt['preparedSHA256'if PHASE=='prepare'else'deployEvidenceSHA256']=digest;transport(receipt);return 0 if v['success']else 1
if __name__=='__main__':sys.exit(main())
