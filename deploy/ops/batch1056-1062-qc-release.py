"""INERT source-pinned combined QC PR 1056/1057/1058/1062 scoped release.
Only the explicitly selected one-shot phase on the pinned operations branch is allowed.
The exact active QC container receives one stop/copy/start behind QC-only maintenance;
its existing RW code/data binds, stopped backup container and every other container stay intact.
No host checkout, dependency/schema/seed/permission-policy/config change, database restore, global cleanup,
automatic mutation retry or phase replay. Source, four PR heads, full live/canonical inventories,
fresh profile9, native tests and capacity bounds are checked before production lifecycle begins.
Cold proof covers all thirteen SQLite company databases, users, permissions, tombstones,
sequences and every hidden-inclusive non-DB entry. Only eleven explicit code tar members change;
all other code-bind files retain bytes and metadata. Cross-database atomicity is not claimed.
Final phase completion still requires actual runtime, source, data and remaining-space evidence.
"""
import calendar,contextlib,copy,datetime,hashlib,importlib.util,io,json,os,pathlib,re,stat,subprocess,sys,tarfile,time,urllib.request,urllib.error
ROOT=pathlib.Path('/opt/rr-portal');ARCHIVE=ROOT/'deploy/backups/batch1056-1062-qc-20261103-1'
APP='apps/生产部/品质管理系统';DATA_ROOT=ROOT/APP/'data';CODE_ROOT=pathlib.Path('/opt/qc-code')
HOST_BASE='f22fbffa1789234fe1c78bf776f4dcb3fe867d0c';BASE='90f2fa661c923c4d3144ba21d22789b38553638b';TARGET='ec0789c6ec94692c2c23717a473273c2acf666e4';TREE='5bcf828fcc57df5e762588885efc71afc019f33f';APP_TREE='d22e3c980022d5850db15993cf9990405b279d12'
REVIEWED_HEADS={'1056': 'e46a3a2da46414cb131ce10b1a2e9884df646835', '1057': '8d5facb4d0ede97999a6e8fa8db4feab017aecdd', '1058': 'bc4c5a7d0fea9f9e51d1800ce79f270635c230ae', '1062': '24f423bde8f689646208ee4292bbc9d55e0bd8d2'}
PHASE='prepare';PREPARED_SHA256='';DEPLOY_SHA256='';EXECUTE=True
BRANCH='refs/heads/codex/ops-batch1056-1060-20261103'
ALIAS='rr-portal-qc:latest';CID='080cfbbcdd68dcb43e8a627ac8e5b1d6cc1b237f322ffac4c26a97ef23b09567';LIVE_IMAGE='sha256:f4ae6aa9dd4ffec6e7dcca66eaae748a4e69cdc160eced9b10b4e2ab9a019494';BASE_IMAGE='sha256:3b3d5cb74579a38a9c0846327af7fd282740b2313912eef083eae33bd08ff788';ALIAS_IMAGE='sha256:3b3d5cb74579a38a9c0846327af7fd282740b2313912eef083eae33bd08ff788'
LIVE_SOURCE_SHA256='e1cd85721464c2befcdd424b82ef62514aeb8efed24e755969583c7a4687a86c';LIVE_SOURCE_DIFFERENCES=('ai-ocr.js', 'app.js', 'dev-server.js', 'index.html', 'package.json', 'qc-backend.js', 'report_export.js', 'server/auth.js', 'server/extract-seed.js', 'server/server.js')
QC_BACKUP_ID='712466bf56a8537eb914ac8c835f0315dee1d33ad4faae3665af71ed803988f9';EXPECTED_CONTAINER_COUNT=47
# Eight PR-diff paths plus three explicit repairs of the freshly observed runtime drift.
# Corrections must equal exact unchanged main-baseline bytes, never arbitrary live content.
DIFF_CODE=('ai-ocr.js', 'app.js', 'qc-backend.js', 'mobile.css', 'server/server.js', 'report_export.js', 'index.html', 'server/auth.js')
CORRECTION_CODE=('dev-server.js','package.json','server/extract-seed.js')
CODE=DIFF_CODE+CORRECTION_CODE;RUNTIME_ALLOWED=set(CODE)
REVIEWED_FILES={'ai-ocr.js': 'e99deec5e976837ea8614d2bbd0b872a26e0f5f24323b3a312fc5dac039773a3', 'app.js': 'c1d4d83827ac87544bc95df593c14b5dae1be0b4aa57a77cd854f0dc44a5a216', 'qc-backend.js': 'd61d83a4103a5b981aedc8e74671f8cd41bf5b3810233498c4b49d121abcb711', 'mobile.css': '190aa9555d106fe36ffa6e7358247918f2f83d3cf09f2edb5f8aaa6ef83883d3', 'server/server.js': 'd0ed7ca252514f98d36340d0e1b5d7447c531c40ea84486fae27d7bdc796d74d', 'report_export.js': '2e5dfd9cf122ff5cf26626963150c1c053ae9421321a966660e5c53a44ab05a4', 'index.html': '5ff82ef9348540fe96233e2ed0e65ad7664a35b12bdc08b10a0fbf6f5b597dab', 'server/auth.js': '52029ee98494dce34775f0219f0e7f41d5cc7859f40f71007d1ca7d75a91dc61', 'dev-server.js': 'cafe36c8ad15052076789b4ff3989089d962a3d5ec5be0cc3fb644295d179bb6', 'package.json': '218f8febf785633f94ef3658eb0c1f15833b0d481d5f344b8ba48c89cf656c66', 'server/extract-seed.js': 'a424fe29564c663cc7bea901529c841da466a1e818c6d10798b67c35cf188951'};REVIEWED_PATHS=('ai-ocr.js', 'app-safety.test.js', 'app.js', 'frontend-auth.test.js', 'frontend-ocr-rotation.test.js', 'index.html', 'judgement-flow.test.js', 'mobile.css', 'ocr-batch.test.js', 'qc-backend.js', 'report_export.js', 'server/auth.js', 'server/ocr-delivery-columns.test.js', 'server/ocr-grounding.test.js', 'server/ocr-parser.test.js', 'server/server.js', 'server/session-store.test.js');TEST_FILES={'app-safety.test.js': 'fd9d6674198cdd0341d4dffeca9dba3d3faa19fe31cf6793263b53b39dccc25a', 'frontend-auth.test.js': 'cab193beb8f208b24bfc05d94180a118da48b6bb6d9b72507a64a817f914e563', 'judgement-flow.test.js': 'ed92a25110cfc350c33658fb6160d9011fdd46760603683772720eceb7614839', 'ocr-batch.test.js': '406ffe62a9af1762634bbda745ffd2efbccdbae9b022d123e5e20a5a9311e6ca', 'review-batch.test.js': '7d58f60ce1759df4312f4997a4d9d0c28240efc1fe8a3eee45407c987577fcd9', 'server/api-auth.test.js': '80efe977eb2d648819529ffd2048b1ee34f8f027ce28b13312f7c8d1cbde84da', 'server/export.test.js': 'b0aaf1a20ab74bd4733f93486a007d8bcda4bf714f35de477cbd667a822b57cd', 'server/record-sync.test.js': '5e033ef71bbf663810a3653c5cf8fadf31498bfdc51fd4639bf4ff626855a7bf', 'server/ocr-parser.test.js': '2f7e8b1fb357233e9f58c71f90ef9ef9d32fc61e3d43e46d322542910afd3342', 'frontend-ocr-rotation.test.js': '57479cc6748c74ee77a9c5e7d2cb1d4d94b14342e26c059a304e434ddc508393', 'server/ocr-grounding.test.js': '992ecf4b72422aa492bc7125e22b22b112c2f8434f5a29f0fdabe72ffdd534cd', 'server/ocr-delivery-columns.test.js': '38d80e7aa569fbf0046db9799f516226ac1bc4f64b39cc4da1c63e797a25a5e1', 'server/session-store.test.js': '188a6ef5b72e287eb30dee793756217673c005465a4e16733f4c326873235835'};EXPECTED_NATIVE_TESTS=339
PROFILE_PATH='/opt/rr-portal/deploy/backups/batch1056-1060-preflight-9-20261103/result.private.json';PROFILE_RESULT_SHA256='b37d98d10b5f68c2cf6a6a030414e9be32a9d399ed67d93a0366f8d42d4975a0';PROFILE_VALUE_SHA256='dd0b88db69c9ff07da73c25f436e56b9ec42da35982c6990e4554eb92fc15f94'
DIRTY_PATH_COUNT=5;DIRTY_SHA256='74b8a9c5caefdc5a220f12cd14972229312beef004e76129d0fb2bb691a0507e'
REQUIRED_TEST_FILES=('app-safety.test.js', 'frontend-auth.test.js', 'judgement-flow.test.js', 'ocr-batch.test.js', 'review-batch.test.js', 'server/api-auth.test.js', 'server/export.test.js', 'server/record-sync.test.js', 'server/ocr-parser.test.js', 'frontend-ocr-rotation.test.js', 'server/ocr-grounding.test.js', 'server/ocr-delivery-columns.test.js', 'server/session-store.test.js')
COMPANIES=('dg-xingxin','dg-huadeng-a','dg-huadeng-b','dg-huajia','hy-huakang-a','hy-huakang-b','hy-huakang-c','hy-huakang-d','hy-huadeng','hy-huaxing','sy-huadeng','sy-xingxin','xs-huadeng')
OUT=None;P=None;O=None;L=None;SERIAL=0;STAGE='entry'

DEPS={'pr1035-quote-preflight.py': '2b2739aa00cad03bfce8472b7416d725364b8d4ed354a5a7e9ca905a47aaffa5', 'release-data-ops-library.py': 'ff9138a1d5bfed1b10077112da6ebcda2d65240f583e2d0e12ce1325cfbaafd5', 'release-data-library.py': 'd63168fd3057f4f2aba2d93f9fab31d2d65c6dd0f3234877d71fcff1e04e62b9'}
SOURCE_PROBE="const fs=require('fs'),path=require('path'),crypto=require('crypto'),items=JSON.parse(fs.readFileSync(0,'utf8'));let out={};if(!Array.isArray(items)||items.length>2000)throw Error('scope');for(const n of items){if(!/^[A-Za-z0-9_./-]+$/.test(n)||n.split('/').some(x=>x==='..'||x===''||x==='data'||x==='uploads'||x==='legacy-data')||/(^|\\/)\\.env(\\.|$)/.test(n))throw Error('path');const p='/app/'+n;for(let d=path.dirname(p);d!=='/';d=path.dirname(d))if(fs.lstatSync(d).isSymbolicLink())throw Error('parentlink');if(!fs.existsSync(p)){out[n]={absent:true};continue;}const a=fs.lstatSync(p);if(!a.isFile()||a.isSymbolicLink()||a.size>128*1024**2)throw Error('file');const fd=fs.openSync(p,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);try{const b=fs.readFileSync(fd),z=fs.fstatSync(fd);if(b.length!==a.size||a.ino!==z.ino||a.mtimeMs!==z.mtimeMs||a.ctimeMs!==z.ctimeMs)throw Error('changed');out[n]={sha256:crypto.createHash('sha256').update(b).digest('hex'),gitBlobSHA1:crypto.createHash('sha1').update('blob '+b.length+'\\0').update(b).digest('hex'),bytes:b.length,uid:a.uid,gid:a.gid,mode:a.mode&4095};}finally{fs.closeSync(fd);}}console.log(JSON.stringify(out));"
CODE_PROBE="const fs=require('fs'),path=require('path'),crypto=require('crypto');\nconst h=b=>crypto.createHash('sha256').update(b).digest('hex');\nfunction tree(root,omit=[]){let a=[],bytes=0;function walk(p,n){let s=fs.lstatSync(p),v={n,uid:s.uid,gid:s.gid,mode:s.mode&4095};\nif(s.isSymbolicLink()){v.type='link';v.target=fs.readlinkSync(p);}else if(s.isDirectory()){v.type='dir';a.push(v);for(let x of fs.readdirSync(p).sort()){if(n===''&&omit.includes(x))continue;walk(path.join(p,x),n?n+'/'+x:x);}return;}else if(s.isFile()){v.type='file';v.size=s.size;bytes+=s.size;v.sha256=h(fs.readFileSync(p));}else throw Error('unsupported-code-kind');a.push(v);if(a.length>100000||bytes>1024**3)throw Error('bounded-code');}\nif(!fs.existsSync(root))return {absent:true};walk(root,'');return {sha256:h(JSON.stringify(a)),entries:a.length,bytes};}\nconsole.log(JSON.stringify({app:tree('/app',['data']),package:tree('/app/package.json')}));"
QUIET_PROBE="const fs=require('fs');let connections=0;for(const f of ['/proc/net/tcp','/proc/net/tcp6'])for(const line of fs.readFileSync(f,'utf8').trim().split('\\n').slice(1)){const p=line.trim().split(/\\s+/);if(parseInt(p[1].split(':').at(-1),16)===3400&&!['0A','06','07'].includes(p[3]))connections++;}console.log(JSON.stringify({connections}));"
NATIVE_TEST="const fs=require('fs'),path=require('path'),os=require('os'),crypto=require('crypto'),cp=require('child_process');\nconst data=JSON.parse(fs.readFileSync(0,'utf8')),dir=fs.mkdtempSync(path.join(os.tmpdir(),'qms1056-1062-native-'));\ntry{\n const sources=data.sources;\n if(!Array.isArray(sources)||sources.length!==12||new Set(sources).size!==12||!sources.includes('index.html'))throw Error('source-scope');\n if(sources.some(n=>typeof n!=='string'||! /^[A-Za-z0-9_./-]+$/.test(n)||n.split('/').some(x=>x==='..'||x===''||x==='data'||x==='uploads'||x==='legacy-data')||/(^|\\/)\\.env(\\.|$)/.test(n)))throw Error('source-path');\n for(const n of sources){const p=path.join(dir,n);fs.mkdirSync(path.dirname(p),{recursive:true,mode:0o700});fs.writeFileSync(p,fs.readFileSync('/app/'+n),{mode:0o600,flag:'wx'});}\n fs.writeFileSync(path.join(dir,'server','seed.json'),JSON.stringify({users:[],records:[],defectLib:[]}),{mode:0o600,flag:'wx'});\n fs.writeFileSync(path.join(dir,'server','ai-config.json'),JSON.stringify({enabled:false,apiKey:'',baseURL:'http://127.0.0.1:1/disabled-native-test-only'}),{mode:0o600,flag:'wx'});\n for(const[n,v]of Object.entries(data.files)){\n  if(!/^[A-Za-z0-9_./-]+\\.test\\.js$/.test(n)||n.split('/').includes('..'))throw Error('testpath');\n  const b=Buffer.from(v.body,'base64');if(crypto.createHash('sha256').update(b).digest('hex')!==v.sha256)throw Error('testsha');\n  const p=path.join(dir,n);fs.mkdirSync(path.dirname(p),{recursive:true,mode:0o700});fs.writeFileSync(p,b,{mode:0o600,flag:'wx'});\n }\n const out=cp.spawnSync(process.execPath,['--test','--test-reporter=tap',...Object.keys(data.files).sort()],{cwd:dir,env:{PATH:process.env.PATH,NODE_ENV:'test',HOME:dir,TMPDIR:dir,DATA_PATH:path.join(dir,'data'),PORT:'0',DASHSCOPE_API_KEY:'',QC_BAILIAN_API_KEY:'',QC_INSPECTIONS_READ_TOKEN:'',NODE_NO_WARNINGS:'1'},encoding:'utf8',timeout:180000,maxBuffer:8*1024**2});\n fs.writeFileSync(1,out.stdout||'');fs.writeFileSync(2,out.stderr||'');if(out.status!==0)throw Error('native-test-failed');\n const count=k=>{const line=out.stdout.split('\\n').find(s=>s.startsWith('# '+k+' '));return line?Number(line.slice(k.length+3)):NaN;};\n if(!Number.isSafeInteger(data.expected)||data.expected<=0||count('tests')!==data.expected||count('pass')!==data.expected||count('fail')!==0||count('skipped')!==0)throw Error('native-test-count-or-skip');\n}finally{fs.rmSync(dir,{recursive:true,force:true});}"
# Original 36MiB numeric bounds retained; profile9 binding/approval is intentionally unset. No old backup/image cleanup.
# Retain 256MiB ordinary / 8GiB physical free; allocation already spent is not reserved twice.
CAPACITY_BUDGET={'approved': True, 'profileFileSHA256': 'b37d98d10b5f68c2cf6a6a030414e9be32a9d399ed67d93a0366f8d42d4975a0', 'ordinaryReserveBytes': 268435456, 'physicalReserveBytes': 8589934592, 'imageGrowthUpperBytes': 4194304, 'overlayStageUpperBytes': 4194304, 'coldBackupUpperBytes': 16777216, 'evidenceUpperBytes': 12582912, 'dataRootUpperBytes': 4194304, 'databaseUpperCount': 13, 'minimumMemAvailableBytes': 536870912, 'ordinaryRequiredBytes': 306184192, 'physicalRequiredBytes': 8627683328}
CAPACITY_BUDGET_SHA256='5bcaed6145d431dbedf56dbf9d52f1055cd1b70828705a8bec358f31733fe120'

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
 p=pathlib.Path(__file__).with_name(name);need(p.is_file()and not p.is_symlink()and sha(p.read_bytes())==DEPS[name],'fixed-reviewed-dependency');s=importlib.util.spec_from_file_location('qms1056_1058_'+name.replace('.','_'),p);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m

def git(*a):return run(['git','-C',str(ROOT),'-c','core.hooksPath=/dev/null',*a])

def image(name):
 rows=memory(['docker','image','inspect',name]);need(len(rows)==1 and re.fullmatch('sha256:[a-f0-9]{64}',rows[0]['Id']),'one-immutable-image');return rows[0]

def runtime():
 ids=run(['docker','ps','-aq','--no-trunc']).decode().split();need(0<len(ids)<1000 and len(ids)==len(set(ids))and all(pin(c)for c in ids),'bounded-all-container-ids');rows=memory(['docker','inspect',*ids]);need({r['Id']for r in rows}==set(ids),'all-existing-containers');value={}
 for r in rows:
  value[r['Id']]={'image':r['Image'],'config':sha(enc(r['Config'])),'hostConfig':sha(enc(r['HostConfig'])),'mounts':sorted(r['Mounts'],key=enc),'pid':r['State']['Pid'],'started':r['State']['StartedAt'],'restarts':r['RestartCount'],'running':r['State']['Running'],'oom':r['State']['OOMKilled'],'health':r['State'].get('Health',{}).get('Status')}
 need(type(EXPECTED_CONTAINER_COUNT)is int and EXPECTED_CONTAINER_COUNT==47 and len(value)==EXPECTED_CONTAINER_COUNT,'all-fresh-profile-original-containers-including-stopped-backup-required')
 need(pin(CID)and pin(QC_BACKUP_ID)and CID!=QC_BACKUP_ID,'distinct-final-profile-pinned-active-and-stopped-qc-container-ids')
 target=next((r for r in rows if r['Id']==CID),None);backup=next((r for r in rows if r['Id']==QC_BACKUP_ID),None)
 need(target is not None and target['Name']=='/rr-portal-qc-1'and target['Image']==LIVE_IMAGE,'same-explicit-active-qc-cid-name-and-image')
 need(backup is not None and backup['Name']=='/rr-portal-qc-1-bak1103'and not backup['State']['Running']and backup['State']['Pid']==0,'exact-stopped-qc-backup-preserved-not-a-deployment-target')
 for row in(target,backup):need((row['Config'].get('Labels')or{}).get('com.docker.compose.project')=='rr-portal'and(row['Config'].get('Labels')or{}).get('com.docker.compose.service')=='qc','both-qc-containers-identified-without-label-uniqueness')
 return value

def bind_meta(path):
 a=path.lstat();kind=next((n for f,n in((stat.S_ISREG,'REG'),(stat.S_ISDIR,'DIR'),(stat.S_ISLNK,'LNK'),(stat.S_ISSOCK,'SOCK'),(stat.S_ISFIFO,'FIFO'),(stat.S_ISCHR,'CHR'),(stat.S_ISBLK,'BLK'))if f(a.st_mode)),None);need(kind is not None,'typed-bind-source');v={'type':kind,'uid':a.st_uid,'gid':a.st_gid,'mode':stat.S_IMODE(a.st_mode)}
 if kind=='LNK':v.update(linkSHA256=sha(os.fsencode(os.readlink(path))),resolved=str(path.resolve(strict=True)),target=bind_meta(path.resolve(strict=True)))
 if kind in('CHR','BLK'):v['rdev']=a.st_rdev
 z=path.lstat();need((a.st_dev,a.st_ino,a.st_mode,a.st_uid,a.st_gid,a.st_rdev)==(z.st_dev,z.st_ino,z.st_mode,z.st_uid,z.st_gid,z.st_rdev),'stable-bind-metadata');return v

def protection(records):
 need(git('rev-parse','HEAD').decode().strip()==HOST_BASE,'host-checkout-preserved');shared={n:P.shared_file(n)for n in P.SHARED};need(all(v['sha256']==sha(git('show',HOST_BASE+':'+n))for n,v in shared.items()),'five-shared-files-match-observed-host');dirty=git('diff','--name-only','-z');staged=git('diff','--cached','--name-only','-z');need(not staged,'no-new-staged-changes');names=[n for n in dirty.decode().split('\0')if n];need(type(DIRTY_PATH_COUNT)is int and pin(DIRTY_SHA256)and len(names)==DIRTY_PATH_COUNT and sha(dirty)==DIRTY_SHA256 and not any(n.startswith(APP+'/')for n in names),'fresh-profile-existing-dirty-files-outside-qc');env={str(p.relative_to(ROOT)):P.shared_file(str(p))for p in ROOT.glob('.env*')if p.is_file()};need('.env.cloud.production'in env and len(env)<100,'production-env-files-hash-only');binds={m['Source']:bind_meta(pathlib.Path(m['Source']))for r in records.values()for m in r['mounts']if m.get('Type')=='bind'};auth=P.gateway_auth();return {'host':HOST_BASE,'shared':shared,'dirtySHA256':sha(dirty),'unrelatedDirtyBodiesNotRead':True,'env':env,'auth':auth,'binds':binds}

def copied_file(cid,relative):
 body=run(['docker','cp',cid+':/app/'+relative,'-']);archive=tarfile.open(fileobj=io.BytesIO(body));members=archive.getmembers();need(len(members)==1 and members[0].isfile()and not members[0].issym()and not members[0].islnk(),'single-regular-stopped-source-tar');m=members[0];data=archive.extractfile(m).read();need(len(data)==m.size<=8*1024**2,'bounded-source-copy');return data,{'sha256':sha(data),'bytes':len(data),'uid':m.uid,'gid':m.gid,'mode':m.mode,'mtime':m.mtime}

def bundle(bodies,metadata):
 b=io.BytesIO()
 with tarfile.open(fileobj=b,mode='w')as t:
  need(set(bodies)==set(metadata)and set(bodies)<=set(CODE),'bundle-only-explicit-production-members')
  for n in sorted(bodies):
   need(n in bodies and sha(bodies[n])==metadata[n]['sha256'],'bundle-exact-reviewed-bytes');m=tarfile.TarInfo(n);m.uid=metadata[n]['uid'];m.gid=metadata[n]['gid'];m.mode=metadata[n]['mode'];m.size=len(bodies[n]);m.mtime=metadata[n]['mtime'];t.addfile(m,io.BytesIO(bodies[n]))
 return b.getvalue()

def stopped_check(cid,expected):
 for n in CODE:
  _,v=copied_file(cid,n);need(v==expected[n],'stopped-source-bytes-owner-mode-readback')

def utc_ns(text):
 x=re.fullmatch(r'(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?(?:Z|\+00:00)',text);need(x is not None,'strict-utc-nanosecond-timestamp');d=datetime.datetime.strptime(x[1],'%Y-%m-%dT%H:%M:%S');return calendar.timegm(d.timetuple())*10**9+int((x[2]or'').ljust(9,'0'))

def scratch(image_id,patch,expected):
 cid=run(['docker','create','--network','none','--restart','no','--label','io.rr-portal.qc1056-1062-scratch='+TARGET,'--entrypoint','/bin/true',image_id]).decode().strip();need(pin(cid),'one-owned-never-started-scratch')
 try:
  row=memory(['docker','inspect',cid])[0];need(row['Image']==image_id and row['State']['Pid']==0 and row['State']['StartedAt'].startswith('0001-')and not row['Mounts']and row['HostConfig']['NetworkMode']=='none','scratch-never-started-no-mounts');run(['docker','cp','--archive','-',cid+':/app'],patch);stopped_check(cid,expected)
 finally:
  row=memory(['docker','inspect',cid])[0];need(row['Image']==image_id and not row['State']['Running']and row['State']['Pid']==0 and(row['Config'].get('Labels')or{}).get('io.rr-portal.qc1056-1062-scratch')==TARGET,'remove-only-owned-never-started-scratch');run(['docker','rm',cid])

def sealed(phase,digest):
 d=ARCHIVE/phase;need(pin(digest)and sha((d/'manifest.json').read_bytes())==digest,'sealed-prior-phase-manifest');mf=json.loads((d/'manifest.json').read_bytes());files={str(p.relative_to(d))for p in d.rglob('*')if p.is_file()and p.name!='manifest.json'};need(files==set(mf)and all(not p.is_symlink()and(p.is_file()or p.is_dir())for p in d.rglob('*')),'complete-private-evidence-files');need(all(L.safe_path(n)and L.file_hash(d/n)==h for n,h in mf.items()),'all-prior-evidence-bytes-sealed');v=json.loads((d/'result.private.json').read_bytes());need(v['success']is True and(v['target'],v['tree'],v['appTree'])==(TARGET,TREE,APP_TREE),'successful-source-bound-prior-phase');return v,d

def stable(before,protected):need(runtime()==before and protection(before)==protected,'all-original-runtime-env-auth-host-binds-still-exact')

def allocation(folder):
 total=0
 if not folder.exists():return 0
 for p in [folder,*folder.rglob('*')]:
  s=p.lstat();need(not stat.S_ISLNK(s.st_mode)and(stat.S_ISREG(s.st_mode)or stat.S_ISDIR(s.st_mode)),'own-archive-regular-allocation-only');total+=s.st_blocks*512
 return total

def archive_root_contract():
 a=ARCHIVE.lstat();need(stat.S_ISDIR(a.st_mode)and not any(p.is_symlink()for p in(ARCHIVE,*ARCHIVE.parents))and stat.S_IMODE(a.st_mode)==0o700,'own-new-archive-root-is-real-private-directory-never-an-old-link')

def gate_record(path):
 a=path.lstat();need(stat.S_ISREG(a.st_mode)and a.st_size==0 and a.st_uid==0 and a.st_gid==0 and stat.S_IMODE(a.st_mode)==0o644,'own-empty-root-maintenance-gate');return(a.st_dev,a.st_ino,a.st_uid,a.st_gid,a.st_mode,a.st_size,a.st_mtime_ns,a.st_ctime_ns)

def health():
 for _ in range(40):
  row=memory(['docker','inspect',CID])[0]
  if row['State']['Running']and row['State'].get('Health',{}).get('Status')=='healthy':return
  time.sleep(2)
 need(False,'qc-health-after-single-start')

def retain_failure_gate():
 # A pre-stop rejection is handled by deploy's existing CAS cleanup. Once a
 # valid sole-stop intent was recorded, failures must never leave the freshly
 # switched service exposed merely because the original gate was just cleared.
 intent_path=OUT/'stop-intent.private.json'
 if not intent_path.exists()and not intent_path.is_symlink():return {'lifecycleIntentRecorded':False,'gateCreated':False}
 need(intent_path.is_file()and not intent_path.is_symlink(),'regular-own-lifecycle-intent')
 intent=json.loads(intent_path.read_bytes());need(set(intent)=={'container','beginNs','automaticReplay'}and intent['container']==CID and type(intent['beginNs'])is int and intent['beginNs']>0 and intent['automaticReplay']is False,'source-bound-valid-single-stop-intent')
 path=ROOT/'deploy/maintenance/services/qc';need(path.parent.is_dir()and not any(p.is_symlink()for p in(path.parent,*path.parent.parents)),'fixed-qc-gate-real-parent-after-failure')
 try:fd=os.open(path,os.O_CREAT|os.O_EXCL|os.O_WRONLY|os.O_NOFOLLOW,0o644)
 except FileExistsError:return {'lifecycleIntentRecorded':True,'gateCreated':False,'existingGateOrForeignEntryPreserved':True,'automaticReplay':False}
 with os.fdopen(fd,'wb')as f:os.fchmod(f.fileno(),0o644);f.flush();os.fsync(f.fileno())
 record=gate_record(path);private(OUT/'failure-gate-created.private.json',enc(record))
 return {'lifecycleIntentRecorded':True,'gateCreated':True,'gateRecordSHA256':sha(enc(record)),'automaticReplay':False}

def file_hash(path):
 h=hashlib.sha256()
 with path.open('rb')as f:
  for b in iter(lambda:f.read(1024**2),b''):h.update(b)
 return h.hexdigest()

def transport(value):
 raw=enc(value);need(len(raw)<=4*1024**2,'bounded-secret-free-hash-receipt');nib=lambda v:[int(x,16)for x in(format(v,'x')if type(v)is int else v)];parts=[raw[i:i+1024]for i in range(0,len(raw),1024)];digest=nib(sha(raw))
 for i,b in enumerate(parts):print(enc([0,nib(i+1),nib(len(parts)),nib(len(raw)),digest,nib(b.hex())]).decode(),flush=True)
 print(enc([1,nib(len(parts)),nib(len(raw)),digest]).decode(),flush=True)

def setup():
 global P,O,L
 P=load('pr1035-quote-preflight.py');O=load('release-data-ops-library.py');L=load('release-data-library.py');O.L=L;O.ROOT=ROOT;O.run=run;L.databases=O.database_names;P.OUT=OUT;P.command=lambda args,limit=8*1024**2,data=None,timeout=90:run(args,data,timeout)

def storage_contract():
 rows=memory(['docker','inspect',CID]);need(len(rows)==1,'one-fixed-qc-storage-container');r=rows[0]
 values=r['Config'].get('Env')or[];need(all(type(v)is str and '='in v for v in values),'typed-in-memory-qc-env');e=dict(v.split('=',1)for v in values)
 need(len(e)==len(values)and e.get('DATA_PATH')=='/app/data'and e.get('PORT')=='3400','actual-qc-storage-path-and-server-port')
 expected=[{'Type':'bind','Source':str(CODE_ROOT),'Destination':'/app','Mode':'','RW':True,'Propagation':'rprivate'},
  {'Type':'bind','Source':str(DATA_ROOT),'Destination':'/app/data','Mode':'','RW':True,'Propagation':'rprivate'}]
 need(sorted(r['Mounts'],key=enc)==sorted(expected,key=enc),'exact-original-whole-code-bind-and-nested-data-bind-no-recreation')
 need(CODE_ROOT.is_dir()and not any(q.is_symlink()for q in(CODE_ROOT,*CODE_ROOT.parents)),'fixed-existing-qc-code-bind-real-directory')
 return {'onlyFixedCodeAndDataBinds':True,'codeBindReplaced':False,'credentialsNotPersisted':True}

def startup_contract(body):
 text=body.decode('utf8');sections=[]
 for begin,end in [('const COMPANIES = [','const DEFAULT_COMPANY'),('const SCHEMA_SQL = `','`;'),('function seedIfEmpty(', '/* 用户表新增字段'),('const USER_EXTRA_COLS = [','migrateLegacyDb();')]:
  need(text.count(begin)==1,'unique-unchanged-qc-startup-contract-start');i=text.index(begin);j=text.index(end,i)+len(end);need(0<j-i<128*1024,'bounded-unchanged-qc-startup-contract');sections.append(text[i:j])
 return sections

def test_manifest_contract():
 need(type(TEST_FILES)is dict and set(TEST_FILES)==set(REQUIRED_TEST_FILES)and len(REQUIRED_TEST_FILES)==len(set(REQUIRED_TEST_FILES))==13 and all(re.fullmatch(r'[A-Za-z0-9_./-]+\.test\.js',n)and '..'not in n.split('/')and pin(h)for n,h in TEST_FILES.items())and type(EXPECTED_NATIVE_TESTS)is int and EXPECTED_NATIVE_TESTS>0,'exact-thirteen-reviewed-native-tests-including-delivery-layout-session-store-and-positive-pass-count')
 return tuple(sorted(TEST_FILES))

def auth_policy_contract(baseline,candidate):
 # This is a deliberately exact source-layout contract, not a JS parser. The
 # whole factory is separately pinned by REVIEWED_FILES and exercised by the
 # required session-store suite. All policy declarations and exports stay exact.
 need(type(baseline)is bytes and type(candidate)is bytes,'typed-auth-module-bodies')
 old,new=baseline.decode('utf8'),candidate.decode('utf8')
 marker='function createSessions(';export='module.exports = '
 signatures=('function createSessions({ now = Date.now, lifetime = 12 * 60 * 60 * 1000 } = {}) {\n',
             'function createSessions({ now = Date.now, lifetime = 12 * 60 * 60 * 1000, storeFile = null } = {}) {\n')
 sections=[]
 for text,signature in zip((old,new),signatures):
  need(text.count(marker)==1 and text.count(export)==1,'unique-auth-session-factory-and-exports')
  start=text.index(marker);end=text.index(export)
  need(start<end and text[start:].startswith(signature),'only-reviewed-session-store-parameter-extension')
  factory=text[start:end]
  need(0<len(factory)<=128*1024 and factory.count('\n}\n')==1 and factory.endswith('\n}\n'),'single-final-top-level-auth-factory-no-extra-policy-declarations')
  sections.append((text[:start],text[end:]))
 prefix=sections[1][0]
 for line in ("const fs     = require('node:fs');\n","const path   = require('node:path');\n"):
  need(prefix.count(line)==1,'only-two-reviewed-auth-storage-imports')
  prefix=prefix.replace(line,'',1)
 need(prefix==sections[0][0] and sections[1][1]==sections[0][1],'auth-menus-permissions-public-user-password-json-policy-and-exports-byte-identical')
 return {'permissionPolicyUnchanged':True,'sessionFactorySeparatelyHashPinned':True,'requiredSessionStoreTests':True}

def source_check():
 need(all(pin(v,40)for v in(BASE,TARGET,TREE,APP_TREE,HOST_BASE))and type(REVIEWED_HEADS)is dict and set(REVIEWED_HEADS)=={'1056','1057','1058','1062'}and all(pin(v,40)for v in REVIEWED_HEADS.values())and len(DIFF_CODE)==8 and len(CORRECTION_CODE)==3 and len(CODE)==len(set(CODE))==11 and set(CODE)==RUNTIME_ALLOWED and set(REVIEWED_FILES)==set(CODE)and all(pin(h)for h in REVIEWED_FILES.values())and REVIEWED_PATHS and TEST_FILES and type(EXPECTED_NATIVE_TESTS)is int and EXPECTED_NATIVE_TESTS>0,'final-reviewed-source-four-heads-eleven-files-thirteen-tests-and-runtime-pins-required')
 git('fetch','--no-write-fetch-head','origin','+refs/heads/main:refs/remotes/origin/main')
 for number,head in sorted(REVIEWED_HEADS.items()):
  ref='refs/remotes/origin/pr'+number+'-reviewed-head';git('fetch','--no-write-fetch-head','origin','+refs/pull/'+number+'/head:'+ref);need(git('rev-parse',ref).decode().strip()==head,'fetched-pr-head-equals-reviewed-commit')
 need(git('rev-parse','refs/remotes/origin/main').decode().strip()==TARGET and git('rev-parse',TARGET+'^{tree}').decode().strip()==TREE and git('rev-parse',TARGET+':'+APP).decode().strip()==APP_TREE,'exact-reviewed-main-tree-and-combined-qc-app-tree')
 for head in REVIEWED_HEADS.values():git('merge-base','--is-ancestor',head,TARGET)
 paths=[p[len(APP)+1:]for p in git('diff','--name-only','-z',BASE,TARGET,'--',APP).decode().split('\0')if p];need(set(paths)==set(REVIEWED_PATHS),'exact-complete-reviewed-qc-app-path-scope');production={n for n in paths if not n.endswith(('.test.js','.test.json'))and((n.startswith('server/')or'/'not in n)and n.endswith(('.js','.html','.css','.json')))};need(production==set(DIFF_CODE)and set(CORRECTION_CODE).isdisjoint(production)and all(re.fullmatch(r'[A-Za-z0-9_./-]+',n)and '..'not in n.split('/')for n in CODE),'only-reviewed-qc-production-code-files')
 need(all(git('show',BASE+':'+APP+'/'+n)==git('show',TARGET+':'+APP+'/'+n)for n in CORRECTION_CODE),'three-runtime-corrections-are-exact-reviewed-unchanged-main-baseline-bytes')
 test_manifest_contract()
 need(all(git('show',BASE+':'+APP+'/'+n)==git('show',TARGET+':'+APP+'/'+n)for n in('Dockerfile','package.json','server/seed.json','server/ai-config.json','dev-server.js')),'unchanged-build-seed-config-and-no-dependencies')
 auth_policy_contract(git('show',BASE+':'+APP+'/server/auth.js'),git('show',TARGET+':'+APP+'/server/auth.js'))
 need(startup_contract(git('show',BASE+':'+APP+'/server/server.js'))==startup_contract(git('show',TARGET+':'+APP+'/server/server.js')),'unchanged-qc-schema-migrations-companies-seeding-and-getdb-startup');package=json.loads(git('show',TARGET+':'+APP+'/package.json'));need(not package.get('dependencies')and not package.get('devDependencies'),'zero-npm-dependencies-qc-runtime');return {n:git('show',TARGET+':'+APP+'/'+n)for n in CODE}

def source(cid,label,revision):
 d=OUT/label;d.mkdir(mode=0o700);expected={}
 for row in git('ls-tree','-r','-z',revision,'--',APP).split(b'\0'):
  if not row:continue
  meta,name=row.split(b'\t',1);mode,kind,blob=meta.decode().split();n=name.decode()[len(APP)+1:];take=(n.startswith('server/')or'/'not in n)and n.endswith(('.js','.html','.css','.json'))
  if not take or any(p in n.split('/')for p in('data','uploads','legacy-data','node_modules'))or n.startswith('.')or n.endswith(('.test.js','.test.json')):continue
  need(mode in('100644','100755')and kind=='blob'and re.fullmatch('[A-Za-z0-9_./-]+',n),'safe-fixed-tracked-qc-code-only');expected[n]=blob
 need(1<=len(expected)<=2000,'bounded-qc-code-file-inventory');args=['docker','exec','--user','0','-i',cid,'node','-e',SOURCE_PROBE]
 if re.fullmatch('sha256:[a-f0-9]{64}',cid):args=['docker','run','--rm','-i','--read-only','--network','none','--restart','no','--log-driver','none','--entrypoint','node',cid,'-e',SOURCE_PROBE]
 actual=json.loads(run(args,enc(sorted(expected)),180));need(set(actual)==set(expected),'complete-actual-qc-source-hashes');different=[n for n in expected if actual[n].get('gitBlobSHA1')!=expected[n]];v={'expectedGitBlobSHA1':expected,'actual':actual,'differentFiles':different};private(d/'source-hashes.private.json',enc(v));return {'differentFiles':different},actual

def tree_hash(cid,image_mode=False):
 args=['docker','exec','--user','0',cid,'node','-e',CODE_PROBE]if not image_mode else['docker','run','--rm','--read-only','--network','none','--restart','no','--log-driver','none','--entrypoint','node',cid,'-e',CODE_PROBE];return json.loads(run(args,timeout=240))

def quiet():
 samples=[];consecutive=0;deadline=time.monotonic()+60
 while time.monotonic()<deadline:
  sample=json.loads(run(['docker','exec','--user','0',CID,'node','-e',QUIET_PROBE],timeout=10));need(set(sample)=={'connections'}and type(sample['connections'])is int and sample['connections']>=0,'typed-qc-only-quiet-sample');samples.append(sample);consecutive=consecutive+1 if sample=={'connections':0}else 0
  if consecutive==3:private(OUT/'quiet.private.json',enc(samples));return samples
  time.sleep(1)
 private(OUT/'quiet.private.json',enc(samples));need(False,'bounded-qc-quiet-timeout-no-lifecycle-attempted')

def native_tests(candidate):
 files={n:{'body':__import__('base64').b64encode(git('show',TARGET+':'+APP+'/'+n)).decode(),'sha256':h}for n,h in TEST_FILES.items()};need(all(sha(__import__('base64').b64decode(v['body']))==v['sha256']for v in files.values()),'native-tests-exact-reviewed-git-bytes');run(['docker','run','--rm','-i','--network','none','--read-only','--restart','no','--log-driver','none','--tmpfs','/tmp:rw,nosuid,nodev,size=256m','--entrypoint','node',candidate,'-e',NATIVE_TEST],enc({'files':files,'sources':list(CODE)+['sso.js'],'expected':EXPECTED_NATIVE_TESTS}),timeout=240);return {'tests':EXPECTED_NATIVE_TESTS,'skips':0,'productionMountsOrCredentialsUsed':False,'database':'isolated-tmpfs-sqlite','wholeSuiteClaimed':False}

def data_estimate():
 need(DATA_ROOT.is_dir()and not any(p.is_symlink()for p in(DATA_ROOT,*DATA_ROOT.parents)),'fixed-qc-data-root-real-parents');files=0;dirs=1;size=0
 for p in DATA_ROOT.rglob('*'):
  a=p.lstat();need(not stat.S_ISLNK(a.st_mode)and(stat.S_ISREG(a.st_mode)or stat.S_ISDIR(a.st_mode)),'all-hidden-inclusive-qc-data-entries-regular')
  if stat.S_ISDIR(a.st_mode):dirs+=1
  else:files+=1;size+=a.st_size
  need(files+dirs<=100000,'bounded-all-qc-data-entries')
 names=O.database_names(DATA_ROOT);need(any(pathlib.PurePosixPath(n).name=='qc.db'for n in names),'at-least-one-real-qc-database');return {'root':str(DATA_ROOT.relative_to(ROOT)),'bytes':size,'regularFiles':files,'directories':dirs,'databases':len(names)}

def startup_guard():
 names=O.database_names(DATA_ROOT);expected={company+'/qc.db'for company in COMPANIES};need(set(names)==expected and len(expected)==13,'exact-all-thirteen-existing-qc-company-databases-no-startup-migration-or-new-db');seed=json.loads(git('show',BASE+':'+APP+'/server/seed.json'));need(type(seed)is dict and all(type(seed.get(k,[]))is list for k in('users','records','defectLib')),'typed-unchanged-qc-seed-shape');record_columns={'processType','status','reviewBy','reviewAt','rejectReason','rejectBy','rejectAt','aqlLevel'};user_columns={'name','dept','perms'}
 for name in sorted(expected):
  with contextlib.closing(L.connect(DATA_ROOT/name))as db:
   tables={r[0]for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")};need({'records','users','defect_library','partners','record_tombstones','sqlite_sequence'}<=tables,'all-qc-startup-tables-already-exist-no-ddl');need(record_columns<={r[1]for r in db.execute('PRAGMA table_info(records)')}and user_columns<={r[1]for r in db.execute('PRAGMA table_info(users)')},'all-qc-startup-migration-columns-already-exist')
   for table,key in(('users','users'),('defect_library','defectLib'),('records','records')):
    if key=='records'and name!='dg-xingxin/qc.db':continue
    count=db.execute('SELECT COUNT(*) FROM '+table).fetchone()[0];need(count>0 or not seed.get(key),'no-startup-seed-business-or-user-write')
 return {'companies':len(COMPANIES),'startupBusinessOrSchemaWritesExpected':False,'legacyMigrationExpected':False}

def data_metadata(names):
 physical=set(names)|{n+suffix for n in names for suffix in('-wal','-shm','-journal')};result=[]
 for p in [DATA_ROOT,*sorted(DATA_ROOT.rglob('*'))]:
  name=''if p==DATA_ROOT else str(p.relative_to(DATA_ROOT));a=p.lstat();need(not stat.S_ISLNK(a.st_mode)and(stat.S_ISREG(a.st_mode)or stat.S_ISDIR(a.st_mode)),'qc-data-root-and-every-entry-regular');v={'path':name,'uid':a.st_uid,'gid':a.st_gid,'mode':stat.S_IMODE(a.st_mode)}
  if name in physical:
   need(stat.S_ISREG(a.st_mode),'qc-database-and-companions-regular')
   if name not in names:continue
   v['type']='database'
  elif stat.S_ISDIR(a.st_mode):v['type']='directory'
  else:v.update(type='file',bytes=a.st_size,mtimeNs=a.st_mtime_ns,sha256=L.file_hash(p))
  result.append(v)
 return result

def storage(label):
 b=budget_contract();estimate=data_estimate();need(estimate['bytes']<=b['dataRootUpperBytes']and estimate['databases']<=b['databaseUpperCount'],'actual-cold-qc-data-within-reviewed-byte-and-db-bound');d=OUT/label;d.mkdir(mode=0o700);capture=O.sqlite_capture('qc',DATA_ROOT,d/'qc');names=O.database_names(DATA_ROOT);need(set(names)==set(capture['sqlite']),'all-qc-databases-backed-up-and-audited');value={'data':capture,'metadata':data_metadata(names),'startup':startup_guard()};private(d/'capture.private.json',enc(value));need(all(p.stat().st_size<=b['coldBackupUpperBytes']for p in d.rglob('*')if p.is_file()),'each-cold-backup-file-bounded');free_check();return value

def compare_storage(a,b):
 need(a==b,'all-qc-business-records-users-permissions-tombstones-sqlite-schema-and-nondb-files-exact')

def budget_contract():
 b=CAPACITY_BUDGET;keys={'profileFileSHA256','ordinaryReserveBytes','physicalReserveBytes','imageGrowthUpperBytes','overlayStageUpperBytes','coldBackupUpperBytes','evidenceUpperBytes','dataRootUpperBytes','databaseUpperCount','minimumMemAvailableBytes','ordinaryRequiredBytes','physicalRequiredBytes','approved'};need(type(b)is dict and set(b)==keys and pin(CAPACITY_BUDGET_SHA256)and sha(enc(b))==CAPACITY_BUDGET_SHA256 and b['approved']is True and b['profileFileSHA256']==PROFILE_RESULT_SHA256,'explicit-reviewed-fresh-profile-bound-qc-capacity-budget');numeric=keys-{'profileFileSHA256','approved'};need(all(type(b[k])is int and b[k]>0 for k in numeric),'typed-positive-reviewed-qc-capacity-budget');need(b['ordinaryReserveBytes']>=256*1024**2 and b['physicalReserveBytes']>=8*1024**3 and b['databaseUpperCount']==13,'retain-reviewed-256-mib-ordinary-eight-gb-physical-reserves-and-exact-thirteen-dbs');need(b['coldBackupUpperBytes']>=4*b['dataRootUpperBytes'],'cold-budget-covers-two-db-and-file-backups-plus-format-overhead');peak=sum(b[k]for k in('imageGrowthUpperBytes','overlayStageUpperBytes','coldBackupUpperBytes','evidenceUpperBytes'));need(b['ordinaryRequiredBytes']==b['ordinaryReserveBytes']+peak and b['physicalRequiredBytes']==b['physicalReserveBytes']+peak,'reviewed-additive-qc-peak-budget');return b

def remaining_capacity(b,used):
 need(type(used)is int and used>=0,'typed-own-archive-allocation')
 archive_bound=sum(b[k]for k in('overlayStageUpperBytes','coldBackupUpperBytes','evidenceUpperBytes'))
 need(used<=archive_bound,'own-archive-within-total-reviewed-allocation')
 # Already allocated owned evidence is counted in f_bavail. Reserve only the
 # unspent archive allowance, plus the full image upper bound conservatively.
 pending=archive_bound-used+b['imageGrowthUpperBytes']
 return {'ordinary':b['ordinaryReserveBytes']+pending,'physical':b['physicalReserveBytes']+pending}

def free_check():
 b=budget_contract();root=memory(['docker','info','--format','{{json .DockerRootDir}}']);need(type(root)is str and pathlib.Path(root).is_absolute(),'actual-absolute-docker-root-for-qc-capacity');match=re.search(r'^MemAvailable:\s+([0-9]+) kB$',pathlib.Path('/proc/meminfo').read_text(),re.M);need(match is not None,'fresh-memavailable');mem=int(match[1])*1024;fs=os.statvfs(root);used=allocation(ARCHIVE);data=data_estimate();remaining=remaining_capacity(b,used);v={'available':fs.f_bavail*fs.f_frsize,'free':fs.f_bfree*fs.f_frsize,'qcData':data,'memAvailableBytes':mem,'ownArchiveAllocatedBytes':used,'minimumOrdinaryBytes':remaining['ordinary'],'minimumPhysicalBytes':remaining['physical'],'capacityBudgetSHA256':CAPACITY_BUDGET_SHA256};need(data['bytes']<=b['dataRootUpperBytes']and data['databases']<=b['databaseUpperCount']and v['available']>=remaining['ordinary']and v['free']>=remaining['physical']and mem>=b['minimumMemAvailableBytes']and used<=b['overlayStageUpperBytes']+b['coldBackupUpperBytes']+b['evidenceUpperBytes'],'actual-qc-space-memory-data-size-own-evidence-within-reviewed-budget');return v

def profile_check(before):
 p=pathlib.Path(PROFILE_PATH);need(PROFILE_PATH and p.is_absolute()and p.parent.parent==ROOT/'deploy/backups'and p.parent.name=='batch1056-1060-preflight-9-20261103'and p.name=='result.private.json','bound-fresh-qc-batch-profile-path');need(pin(PROFILE_RESULT_SHA256)and pin(PROFILE_VALUE_SHA256)and p.is_file()and not p.is_symlink()and file_hash(p)==PROFILE_RESULT_SHA256,'bound-fresh-successful-qc-readonly-profile');v=json.loads(p.read_bytes());verify=dict(v);need(verify.pop('resultSHA256')==PROFILE_VALUE_SHA256==sha(enc(verify)),'canonical-successful-profile-result-digest');need(v['success']is True and v['readOnly']is True and v['allRuntimeUnchanged']is True and v['sourceBaseline']==BASE and v['hostGitHead']==HOST_BASE and all(v[k]is False for k in('businessWrites','lifecycleWrites','configWrites','plaintextCredentialsWritten','businessFileBodiesCopied')),'successful-nonmutating-source-bound-batch-profile');q=v['targets']['qc'];need(q['id']==CID and q['canonicalImage']['id']==ALIAS_IMAGE and pin(LIVE_SOURCE_SHA256)and sha(enc(q['source']['actual']))==LIVE_SOURCE_SHA256 and tuple(q['source']['differences'])==LIVE_SOURCE_DIFFERENCES,'profile-same-qc-service-source-and-accepted-durable-alias');need(v['unstaged']['trackedPathCount']==DIRTY_PATH_COUNT and v['unstaged']['rawPathInventorySHA256']==DIRTY_SHA256 and v['staged']['trackedPathCount']==0,'profile-bound-existing-dirty-inventory');observed=v['allRuntime'];need(set(observed)==set(before)and all(observed[c]['image']==before[c]['image']and observed[c]['configSHA256']==before[c]['config']and observed[c]['hostConfigSHA256']==before[c]['hostConfig']and observed[c]['mountsSHA256']==sha(enc(before[c]['mounts']))and all(observed[c][k]==before[c][k]for k in('pid','started','restarts','running','oom','health'))for c in before),'fresh-profile-all-profiled-runtime-contracts-including-stopped-backup-still-exact');protected=protection(before);need(v['shared']==protected['shared']and v['env']==protected['env']and v['gatewayAuth']==protected['auth'],'fresh-profile-shared-config-env-and-gateway-auth-exact');b=budget_contract();data=v['qcData'];need(set(data)=={'root','bytes','regularFiles','directories','databases'}and data['root']==str(DATA_ROOT.relative_to(ROOT))and all(type(data[k])is int and data[k]>=0 for k in('bytes','regularFiles','directories','databases'))and 1<=data['databases']<=b['databaseUpperCount']and data['bytes']<=b['dataRootUpperBytes'],'fresh-profile-qc-metadata-only-size-budget');return v['resultSHA256']

def code_bind_manifest():
 need(CODE_ROOT.is_dir()and not any(q.is_symlink()for q in(CODE_ROOT,*CODE_ROOT.parents)),'fixed-qc-code-bind-no-symlink-parents')
 for member in CODE:
  parts=pathlib.PurePosixPath(member).parts
  for depth in range(1,len(parts)):
   parent=CODE_ROOT.joinpath(*parts[:depth]);meta=parent.lstat()
   need(stat.S_ISDIR(meta.st_mode)and not stat.S_ISLNK(meta.st_mode),'every-payload-parent-is-an-existing-real-directory')
 rows={};total=0
 def walk(path,name):
  nonlocal total
  a=path.lstat();row={'uid':a.st_uid,'gid':a.st_gid,'mode':stat.S_IMODE(a.st_mode)}
  key=sha(os.fsencode(name))
  if name in CODE:
   need(stat.S_ISREG(a.st_mode)and a.st_nlink==1,'existing-payload-member-is-regular-single-link-never-directory-or-symlink')
   row['publicPath']=name
  if stat.S_ISDIR(a.st_mode):
   row['type']='directory';rows[key]=row
   for child in sorted(path.iterdir(),key=lambda q:os.fsencode(q.name)):
    if not name and child.name=='data':continue
    walk(child,name+'/'+child.name if name else child.name)
  elif stat.S_ISLNK(a.st_mode):row.update(type='symlink',targetSHA256=sha(os.fsencode(os.readlink(path))));rows[key]=row
  elif stat.S_ISREG(a.st_mode):
   need(a.st_size<=128*1024**2,'bounded-private-code-bind-file-hash-only');total+=a.st_size
   fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
   with os.fdopen(fd,'rb')as f:
    before=os.fstat(f.fileno());h=hashlib.sha256()
    for block in iter(lambda:f.read(1024**2),b''):h.update(block)
    after=os.fstat(f.fileno())
   identity=lambda v:(v.st_dev,v.st_ino,v.st_uid,v.st_gid,v.st_mode,v.st_size,v.st_mtime_ns,v.st_ctime_ns,v.st_nlink)
   need(identity(a)==identity(before)==identity(after),'code-bind-file-stable-during-hash')
   row.update(type='file',bytes=a.st_size,sha256=h.hexdigest(),mtimeNs=a.st_mtime_ns,ctimeNs=a.st_ctime_ns,nlink=a.st_nlink);rows[key]=row
  else:need(False,'code-bind-only-directories-files-or-preserved-symlinks')
  need(len(rows)<=100000 and total<=1024**3,'bounded-entire-hidden-inclusive-code-bind-hash-manifest')
  z=path.lstat()
  need((a.st_dev,a.st_ino,a.st_uid,a.st_gid,a.st_mode,a.st_mtime_ns,a.st_ctime_ns,a.st_nlink)==(z.st_dev,z.st_ino,z.st_uid,z.st_gid,z.st_mode,z.st_mtime_ns,z.st_ctime_ns,z.st_nlink),'code-bind-entry-inode-owner-mode-times-stable-during-walk')
 walk(CODE_ROOT,'');return {'entries':rows,'sha256':sha(enc(rows)),'bytes':total,'dataSubtreeTraversed':False,'privateFileBodiesOrNamesReturned':False}

def compare_code_bind(before,after,metadata):
 a,b=before['entries'],after['entries'];patched={sha(n.encode()):n for n in CODE}
 need({k:v for k,v in a.items()if k not in patched}=={k:v for k,v in b.items()if k not in patched},'all-nonpayload-code-bind-hidden-private-files-and-directory-owner-mode-exact')
 need(set(b)==set(a)|set(patched),'only-explicit-payload-files-added-no-other-code-bind-entry-change')
 for key,name in patched.items():
  row=b[key];want=metadata[name]
  need(row.get('publicPath')==name and row.get('type')=='file'and row.get('nlink')==1 and all(row[k]==want[k]for k in('uid','gid','mode','bytes','sha256'))and row['mtimeNs']==want['mtime']*10**9,'all-live-bind-payload-bytes-owner-mode-mtime-exact-reviewed-members')
 return True

def expected_live_source(prepared):
 need(set(prepared['source'])==set(prepared['oldSource']),'same-full-tracked-code-inventory-before-after-with-explicit-absence-repairs')
 return {n:prepared['source'][n]if n in CODE else prepared['oldSource'][n]for n in prepared['source']}

def candidate_image_growth(base,candidate):
 budget=budget_contract();old=base.get('Size');new=candidate.get('Size');limit=budget['imageGrowthUpperBytes']
 need(type(old)is int and type(new)is int and old>0 and new>0 and type(limit)is int and limit>0,'exact-positive-integer-base-candidate-size-and-reviewed-image-growth-bound')
 increment=new-old
 need(0<increment<=limit,'actual-candidate-image-size-increment-within-reviewed-upper-bound')
 return {'baseBytes':old,'candidateBytes':new,'incrementBytes':increment,'upperBytes':limit}

def prepare():
 budget_contract();bodies=source_check();entry()
 need(all(sha(bodies[n])==REVIEWED_FILES[n]for n in CODE),'exact-reviewed-qc-code-blob-shas')
 before=runtime();profile=profile_check(before)
 need(before[CID]['running']and before[CID]['health']=='healthy'and image(ALIAS)['Id']==ALIAS_IMAGE,'healthy-original-qc-runtime-and-durable-alias')
 storage_contract();protected=protection(before);private(OUT/'runtime-before.private.json',enc(before));private(OUT/'protection.private.json',enc(protected))
 free=free_check();guard=startup_guard();actual,old=source(CID,'old-live-source',BASE)
 need(pin(LIVE_SOURCE_SHA256)and sha(enc(old))==LIVE_SOURCE_SHA256 and tuple(actual['differentFiles'])==LIVE_SOURCE_DIFFERENCES,'all-tracked-live-bind-source-exact-fresh-reviewed-inventory-including-absence-and-drift')
 novel=[n for n in CODE if n not in old or old[n]=={'absent':True}]
 need(set(novel)=={'dev-server.js','package.json','server/extract-seed.js'},'only-three-profiled-absent-tracked-nonruntime-files-restored')
 need(startup_contract(copied_file(CID,'server/server.js')[0])==startup_contract(bodies['server/server.js']),'actual-live-server-startup-contract-equals-reviewed-target-no-migration-or-seed-change')
 old_sig=code_bind_manifest();private(OUT/'original-code-bind-hash-manifest.private.json',enc(old_sig))
 need(BASE_IMAGE==ALIAS_IMAGE,'candidate-base-is-exact-profiled-canonical-alias-image');base=image(BASE_IMAGE);need(not base['Config'].get('Volumes'),'trusted-canonical-base-without-anonymous-volumes')
 canonical,_=source(BASE_IMAGE,'canonical-base-source',BASE)
 need(canonical['differentFiles']==[],'canonical-immutable-image-full-tracked-source-exact-main-baseline')
 base_sig=tree_hash(BASE_IMAGE,True);metadata={};old_bodies={};old_metadata={};context=OUT/'context';context.mkdir(mode=0o700);recipe=[]
 base_alias='rrportal-qc-1056-1062-base:'+BASE_IMAGE.split(':')[1]
 probe=subprocess.run(['docker','image','inspect',base_alias],capture_output=True,timeout=30)
 need(probe.returncode!=0 or json.loads(probe.stdout)[0]['Id']==BASE_IMAGE,'own-qc-base-alias-not-reassigned')
 need(probe.returncode==0 or b'No such image'in probe.stderr or b'No such object'in probe.stderr,'only-known-qc-base-alias-absence')
 if probe.returncode:run(['docker','tag',BASE_IMAGE,base_alias])
 recipe.append('FROM '+base_alias)
 for i,n in enumerate(CODE):
  anchor=n if n not in novel else('server/server.js'if n.startswith('server/')else'app.js')
  original,v=copied_file(CID,anchor)
  need({k:v[k]for k in('sha256','bytes','uid','gid','mode')}=={k:old[anchor][k]for k in('sha256','bytes','uid','gid','mode')},'qc-rollback-or-restored-file-anchor-exact-original-bind-metadata')
  if n not in novel:old_bodies[n]=original;old_metadata[n]=v
  metadata[n]=dict(v,sha256=sha(bodies[n]),bytes=len(bodies[n]),mtime=max(int(time.time())+2,int(v['mtime'])+2))
  path=context/('code'+str(i));private(path,bodies[n]);path.chmod(v['mode']);os.utime(path,(metadata[n]['mtime'],metadata[n]['mtime']))
  recipe.append('COPY --chown=%d:%d %s /app/%s'%(v['uid'],v['gid'],path.name,n))
 free_check();private(OUT/'rollback-source.tar',bundle(old_bodies,old_metadata));patch=bundle(bodies,metadata);private(OUT/'patch.tar',patch)
 private(context/'Dockerfile',('\n'.join(recipe)+label_line()+'\n').encode());tag='rr-portal-qc:pr1056-1062-'+TARGET[:12]
 free_check();run(['docker','build','--network=none','--pull=false','-t',tag,str(context)],timeout=600);candidate=image(tag);growth=candidate_image_growth(base,candidate)
 a=copy.deepcopy(base['Config']);b=copy.deepcopy(candidate['Config']);a.pop('Image',None);b.pop('Image',None)
 labels=dict(a.get('Labels')or{});a['Labels']=dict(labels,**{'org.opencontainers.image.revision':TARGET,'io.rr-portal.qc-app-tree':APP_TREE,'io.rr-portal.frontend-app-tree':APP_TREE,'io.rr-portal.backend-source':TARGET})
 need(a==b and candidate['Architecture']==base['Architecture']and candidate['Os']==base['Os']and candidate['RootFS']['Layers'][:len(base['RootFS']['Layers'])]==base['RootFS']['Layers'],'derivative-exact-canonical-image-config-and-base-layers-only-reviewed-copies')
 new_sig=tree_hash(candidate['Id'],True);s,new=source(candidate['Id'],'candidate-source',TARGET)
 need(s['differentFiles']==[]and all({k:new[n][k]for k in('sha256','bytes','uid','gid','mode')}=={k:metadata[n][k]for k in('sha256','bytes','uid','gid','mode')}for n in CODE),'candidate-full-tracked-source-target-and-reviewed-payload-metadata')
 scratch(BASE_IMAGE,patch,metadata);native=native_tests(candidate['Id']);stable(before,protected)
 need(code_bind_manifest()==old_sig,'actual-code-bind-entire-hidden-tree-unchanged-during-prepare')
 free_after=free_check();private(OUT/'candidate-source.private.json',enc(new))
 return {'candidate':candidate['Id'],'runtime':before,'protected':protected,'metadata':metadata,'oldSignature':old_sig,'newSignature':new_sig,'canonicalBaseSignature':base_sig,'actualImageGrowth':growth,'oldSource':old,'source':new,'spaceBefore':free,'spaceAfter':free_after,'canonicalScratchCopyProven':True,'nativeTests':native,'profileResultSHA256':profile,'oldAbsentPaths':novel,'reviewedRuntimeCorrections':list(CORRECTION_CODE),'startupGuard':guard,'canonicalTrackedBaseExactlyMain':True,'liveCodeIsExistingRwBind':True,'privateNonCodeFilesPreservedByHashOnly':True}

def deploy():
 global STAGE
 value,d=sealed('prepare',PREPARED_SHA256);p=value['details'];before=runtime();protected=protection(before);need(before==p['runtime']and protected==p['protected'],'same-prepared-qc-runtime-and-protection');need(image(ALIAS)['Id']==ALIAS_IMAGE,'canonical-qc-alias-cas-before-switch');source_check();s,preswitch=source(CID,'preswitch-source',BASE);need(sha(enc(preswitch))==LIVE_SOURCE_SHA256 and tuple(s['differentFiles'])==LIVE_SOURCE_DIFFERENCES and code_bind_manifest()==p['oldSignature'],'all-preswitch-qc-source-exact-fresh-reviewed-inventory');free_check();storage_contract();startup_guard();ingress=entry();cache_headers=old_cache_headers();private(OUT/'original-cache-headers.private.json',enc(cache_headers));path=ROOT/'deploy/maintenance/services/qc';need(path.parent.is_dir()and not path.parent.is_symlink()and not path.exists()and not path.is_symlink(),'one-new-qc-service-gate');fd=os.open(path,os.O_CREAT|os.O_EXCL|os.O_WRONLY|os.O_NOFOLLOW,0o644);os.fchmod(fd,0o644);os.close(fd);owned=gate_record(path);stop_attempted=False
 try:
  private(OUT/'gate.private.json',enc(owned));entry(True,ingress);samples=quiet();startup_guard();private(OUT/'pre-stop-space.private.json',enc(free_check()));need(runtime()==before and protection(before)==protected and image(ALIAS)['Id']==ALIAS_IMAGE and gate_record(path)==owned and code_bind_manifest()==p['oldSignature'],'before-stop-all-original-qc-contracts-bind-tree-and-owned-gate');stop_begin=time.time_ns();private(OUT/'stop-intent.private.json',enc({'container':CID,'beginNs':stop_begin,'automaticReplay':False}));stop_attempted=True;run(['docker','stop','--time','30',CID],timeout=90)
 except Exception:
  failed_stage=STAGE;cleanup={'lifecycleAttempted':stop_attempted,'clearedOwnUnchangedGate':False}
  if not stop_attempted:
   try:
    need(gate_record(path)==owned,'pre-stop-failure-only-own-qc-gate-cas');path.unlink();cleanup['clearedOwnUnchangedGate']=True
   except Exception as e:cleanup['cleanupErrorType']=type(e).__name__
  private(OUT/'pre-stop-failure-gate.private.json',enc(cleanup));STAGE=failed_stage;raise
 need(not memory(['docker','inspect',CID])[0]['State']['Running'],'same-original-qc-stopped');cold=storage('cold-before');free_check();need(code_bind_manifest()==p['oldSignature'],'stopped-bind-tree-exact-before-targeted-copy');run(['docker','cp','--archive','-',CID+':/app'],(d/'patch.tar').read_bytes());stopped_check(CID,p['metadata']);patched_bind=code_bind_manifest();compare_code_bind(p['oldSignature'],patched_bind,p['metadata']);private(OUT/'patched-code-bind-hash-manifest.private.json',enc(patched_bind));free_check();start_begin=time.time_ns();run(['docker','start',CID],timeout=90);start_end=time.time_ns();private(OUT/'single-start-window.private.json',enc({'beginNs':start_begin,'endNs':start_end,'stopBeginNs':stop_begin,'container':CID}));health();after=runtime();need(set(before)==set(after)and all(after[c]==before[c]for c in before if c!=CID),'every-other-existing-container-exact');old,new=before[CID],after[CID];need(new==dict(old,started=new['started'],pid=new['pid'],restarts=0)and new['running']and new['health']=='healthy'and old['started']!=new['started']and old['pid']!=new['pid'],'one-same-qc-cid-manual-start-only-runtime-delta');need(start_begin<=utc_ns(new['started'])<=start_end,'manual-qc-start-in-exact-integer-ns-command-window');s,actual=source(CID,'live-upgraded-source',TARGET);need(actual==expected_live_source(p),'live-full-tracked-source-payload-target-and-other-files-exact-before');need(code_bind_manifest()==patched_bind,'hidden-inclusive-code-bind-still-exact-after-single-start');post=storage('after-start');compare_storage(cold,post);need(protection(after)==protected,'all-config-env-auth-binds-preserved');need(runtime()==after and image(ALIAS)['Id']==ALIAS_IMAGE and gate_record(path)==owned,'final-qc-runtime-alias-gate-cas');run(['docker','tag',p['candidate'],ALIAS]);need(image(ALIAS)['Id']==p['candidate'],'durable-qc-canonical-promoted-once');need(gate_record(path)==owned,'own-qc-maintenance-gate-unchanged-before-clear');path.unlink();entry(False,ingress);public_files(cache_headers);return {'candidate':p['candidate'],'runtime':after,'protected':protected,'allQmsBusinessAuthTombstonesSchemaAndFilesPreserved':True,'singleStopCopyStart':True,'sameContainer':CID,'liveImage':LIVE_IMAGE,'durableImage':p['candidate'],'reviewedRuntimeCorrections':list(CORRECTION_CODE),'liveBindSignature':patched_bind,'existingCodeBindPreserved':True,'activeImageRecreated':False,'quietSamples':samples,'historicalDockerEventsNotRequiredOrClaimed':True,'nonAtomicCrossDatabaseSnapshotClaimed':False}

def verify():
 source_check();value,_=sealed('deploy',DEPLOY_SHA256);p=value['details'];prepared,_=sealed('prepare',PREPARED_SHA256);baseline=prepared['details']
 need(runtime()==p['runtime']and protection(p['runtime'])==p['protected']and image(ALIAS)['Id']==p['candidate'],'deployed-qc-runtime-config-and-durable-alias')
 _,actual=source(CID,'verify-live-source',TARGET)
 need(actual==expected_live_source(baseline),'live-target-payload-and-unmodified-tracked-source-still-exact')
 need(not(ROOT/'deploy/maintenance/services/qc').exists(),'qc-maintenance-cleared')
 need(code_bind_manifest()==p['liveBindSignature'],'live-code-bind-all-hidden-private-bytes-and-metadata-still-exact')
 need(tree_hash(p['candidate'],True)==baseline['newSignature'],'durable-candidate-image-whole-code-still-exact')
 storage_contract();entry();public_files()
 return {'sameContainer':CID,'durableImage':p['candidate'],'allOtherContainersRuntimeAndEnvPreserved':True,'existingCodeBindPreserved':True,'activeImageRecreated':False,'privateNonCodeFilesPreservedByHashOnly':True,'businessDataNotComparedAcrossUserWriteWindow':True}

def label_line():return '\nLABEL org.opencontainers.image.revision="'+TARGET+'" io.rr-portal.qc-app-tree="'+APP_TREE+'" io.rr-portal.frontend-app-tree="'+APP_TREE+'" io.rr-portal.backend-source="'+TARGET+'"'

def http(path,headers=None):
 need(path in('/','/paiji/health','/indo-shipping/api/health','/sprayplan/api/health','/internal-quote/health','/qc/','/qc/api/health','/qc/api/bootstrap?company=dg-xingxin')or path in['/qc/'+n for n in CODE if '/'not in n],'fixed-local-readonly-qc-http-path');request=urllib.request.Request('http://127.0.0.1'+path,headers=headers or{})
 class NoRedirect(urllib.request.HTTPRedirectHandler):
  def redirect_request(self,*a,**kw):return None
 opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),NoRedirect())
 try:r=opener.open(request,timeout=20)
 except urllib.error.HTTPError as e:r=e
 with r:body=r.read(8*1024**2+1);need(len(body)<=8*1024**2,'bounded-public-qc-http');return {'status':r.status,'sha256':sha(body),'headers':{k:r.headers.get(k)for k in('ETag','Last-Modified')}}

def entry(maintained=False,baseline=None):
 others=('/','/paiji/health','/indo-shipping/api/health','/sprayplan/api/health','/internal-quote/health');result={p:http(p)['status']for p in(*others,'/qc/api/health','/qc/api/bootstrap?company=dg-xingxin','/qc/')};need(result['/']in(200,401)and all(result[p]==200 for p in others if p!='/'),'portal-other-services-available');need(result['/qc/api/health']==(503 if maintained else 200)and result['/qc/api/bootstrap?company=dg-xingxin']==(503 if maintained else 401)and result['/qc/']in((503,)if maintained else(200,401)),'qc-only-maintenance-http-boundary')
 if baseline:need(all(result[p]==baseline[p]for p in others),'other-portal-ingress-statuses-unchanged')
 return result

def old_cache_headers():return {n:http('/qc/'+n)['headers']for n in CODE if '/'not in n}

def public_files(previous=None):
 for n in CODE:
  if '/'in n:continue
  url='/qc/'+n;need(http(url)['status']==200 and http(url)['sha256']==REVIEWED_FILES[n],'all-reviewed-public-qc-static-files-exact-target')
  if previous:
   for key,header in(('ETag','If-None-Match'),('Last-Modified','If-Modified-Since')):
    if previous[n][key]:v=http(url,{header:previous[n][key]});need(v['status']==200 and v['sha256']==REVIEWED_FILES[n],'old-qc-cache-validator-receives-new-bytes')

def failure_context(error):
 # Pure in-memory reporting only: no formatted traceback, source lines, paths,
 # locals, exception strings, subprocess argv or secret-bearing objects.
 try:
  pure=lambda v:v if type(v)is str and re.fullmatch(r'[A-Za-z][A-Za-z0-9_.:-]{0,119}',v)else None
  stages={'root':pure(STAGE),'P':pure(getattr(P,'STAGE',None)),'O':pure(getattr(O,'STAGE',None)),'L':pure(getattr(L,'FAILED',None))};frames=[];tb=error.__traceback__
  while tb is not None and len(frames)<16:
   name=tb.tb_frame.f_code.co_name
   if re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]{0,79}|<lambda>|<module>',name):frames.append({'function':name,'line':tb.tb_lineno})
   tb=tb.tb_next
  label=None
  if frames and frames[-1]['function']in('need','require')and len(error.args)==1:label=pure(error.args[0])
  return {'dependencyStages':stages,'pureFailureLabel':label,'traceFunctionsAndLines':frames,'businessLocalsOrSourceLinesReturned':False,'rawExceptionMessageReturned':False}
 except Exception:return {'errorContextUnavailable':True,'rawExceptionMessageReturned':False}

def main():
 global OUT,STAGE
 need(EXECUTE is True and all(pin(v,40)for v in(HOST_BASE,BASE,TARGET,TREE,APP_TREE))and pin(CID)and pin(QC_BACKUP_ID)and all(re.fullmatch(r'sha256:[a-f0-9]{64}',v)for v in(LIVE_IMAGE,BASE_IMAGE,ALIAS_IMAGE))and pin(LIVE_SOURCE_SHA256)and pin(PROFILE_RESULT_SHA256)and pin(PROFILE_VALUE_SHA256)and PHASE in('prepare','deploy','verify')and sys.argv[1:]==[PHASE]and os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_MODE')==PHASE and os.environ.get('RELEASE_ATTEMPT')=='1','explicit-one-shot-reviewed-qc-phase-only');os.umask(0o077);need(ARCHIVE.parent.is_dir()and not ARCHIVE.parent.is_symlink(),'private-parent');ARCHIVE.mkdir(mode=0o700,exist_ok=True);archive_root_contract();OUT=ARCHIVE/PHASE;need(not OUT.exists()and not OUT.is_symlink(),'fresh-private-qc-phase-no-replay');OUT.mkdir(mode=0o700);v={'service':'qc','mode':PHASE,'resultPath':str(OUT/'result.private.json'),'phase':PHASE,'base':BASE,'reviewedHeads':REVIEWED_HEADS,'target':TARGET,'tree':TREE,'appTree':APP_TREE,'hostBase':HOST_BASE,'success':False,'hostSourceCheckoutPerformed':False,'automaticMutationRetry':False,'credentialsChanged':False,'allNonQcServicesLifecycleOperated':False,'postgresAccessPerformed':False}
 try:
  setup();v['details']={'prepare':prepare,'deploy':deploy,'verify':verify}[PHASE]();v['finalSpaceBeforeSeal']=free_check();v['success']=True
 except Exception as e:
  original_stage=STAGE;v.update(errorType=type(e).__name__,stage=original_stage,dependencyStage=None if O is None else O.STAGE,safeFailureContext=failure_context(e))
  if PHASE=='deploy':
   try:v['failureGate']=retain_failure_gate()
   except Exception as gate_error:v['failureGate']={'errorType':type(gate_error).__name__,'stage':STAGE,'automaticReplay':False}
  STAGE=original_stage
 v['resultSHA256']=sha(enc(v));private(OUT/'result.private.json',enc(v));files=list(OUT.rglob('*'));need(all(not p.is_symlink()and(p.is_file()or p.is_dir())for p in files),'regular-private-qc-phase-evidence');manifest={str(p.relative_to(OUT)):file_hash(p)for p in files if p.is_file()};private(OUT/'manifest.json',enc(manifest));digest=sha(enc(manifest));receipt={'result':v,'manifestSHA256':digest,'preparedSHA256'if PHASE=='prepare'else'deployEvidenceSHA256':digest};transport(receipt);return 0 if v['success']else 1

if __name__=='__main__':sys.exit(main())
