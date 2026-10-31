"""INERT QC-only combined PR 1046/1049 explicit R2 release draft.
Original R1 failed evidence is preserved; this new archive is not an R1 replay.
The only old image/live baseline exception is the two sealed diagnosed COPY-path owners.
One original CID stop/copy/start behind QC-only maintenance; no PG/host checkout,
DB restore, npm/APK, environment changes, other-service lifecycle or automatic replay.
All source/head/profile/phase/manifest/capacity execution pins remain intentionally unbound.
Cold captures preserve all SQLite rows/schema including users/perms/tombstones and
all hidden-inclusive non-DB bytes/permissions. No cross-database atomicity is claimed.
"""
import calendar,contextlib,copy,datetime,hashlib,importlib.util,io,json,os,pathlib,re,stat,subprocess,sys,tarfile,time,urllib.request,urllib.error
ROOT=pathlib.Path('/opt/rr-portal');ARCHIVE=ROOT/'deploy/backups/pr1046-1049-qc-20261031-2'
APP='apps/生产部/品质管理系统';DATA_ROOT=ROOT/APP/'data';HOST_BASE='f22fbffa1789234fe1c78bf776f4dcb3fe867d0c'
BASE='0d7599859e5e01e90e4bbcbe71a9bd4a0a77b417';TARGET='ab44450518d6943af0cf7b4f1a72324d3f5076f8';TREE='6eb26e5b46630ecbe0cf1f64724490bad0a7d80f';APP_TREE='876962156a329155aaa1dd1b6624efcc808acd71';REVIEWED_HEADS={'1046': '907660d27f41521ed28ddcbd5e459bd1091ebffb', '1049': '4a9951492e72b4d8ba01a695dbeaa39f5c009217'}
PHASE='prepare';PREPARED_SHA256='';DEPLOY_SHA256='';EXECUTE=False;BRANCH='refs/heads/codex/ops-pr-1046-1049-20261031'
ALIAS='rr-portal-qc:latest';CID='712466bf56a8537eb914ac8c835f0315dee1d33ad4faae3665af71ed803988f9'
LIVE_IMAGE='sha256:f4ae6aa9dd4ffec6e7dcca66eaae748a4e69cdc160eced9b10b4e2ab9a019494'
BASE_IMAGE='sha256:65c56b6f8f59b8df5420912057023172b3fdd402297163b31342ee04561ac2f8'
CODE=('ai-ocr.js','app.js','qc-backend.js','report_export.js','server/server.js');RUNTIME_ALLOWED=set(CODE)
REVIEWED_FILES={'ai-ocr.js': '8a57edd412f32fffe2660a695b3e4789968352d584692d8da38f752d11e029ef', 'app.js': '913ac9becab4eb2f47dfa472167b240c4057766213548d98625ad1180ede5208', 'qc-backend.js': 'cb9d7845c8c59dad84eda56ca9860381852db3e58ff2eb4f829a406c87a5b759', 'report_export.js': '4938b11d8d27ebd4511aa82ad21b330fa134cc082ae15e4c76838a0a603e0e15', 'server/server.js': 'f1aa9941380c8e4d32ea15d2eef463474b6522e0c36caa19f1b4f2a542827305'};REVIEWED_PATHS=('ai-ocr.js', 'app-safety.test.js', 'app.js', 'frontend-auth.test.js', 'ocr-batch.test.js', 'qc-backend.js', 'report_export.js', 'review-batch.test.js', 'server/api-auth.test.js', 'server/ocr-parser.test.js', 'server/record-sync.test.js', 'server/server.js');TEST_FILES={'ocr-batch.test.js': 'a82bcff1bf9ea57da5c6f3d440f06b6ae8226769c97c2ee1d536c844a17c0f4c', 'review-batch.test.js': '7d58f60ce1759df4312f4997a4d9d0c28240efc1fe8a3eee45407c987577fcd9', 'server/api-auth.test.js': '80efe977eb2d648819529ffd2048b1ee34f8f027ce28b13312f7c8d1cbde84da', 'server/record-sync.test.js': '5e033ef71bbf663810a3653c5cf8fadf31498bfdc51fd4639bf4ff626855a7bf', 'server/ocr-parser.test.js': '07cd1d55cb282e243652e49f14b4ad2753306da86405e586bd7f37d6396bcb61'};EXPECTED_NATIVE_TESTS=98
PROFILE_PATH='/opt/rr-portal/deploy/backups/pr1046-1049-preflight-2/result.private.json';PROFILE_RESULT_SHA256='5d03099f38dfebacaa8138d5fb0bd2166f5399241b97f9cac5d38012a5b73cf7';PROFILE_VALUE_SHA256='d7aa304cdf293410d123a1b531e1755b1a27f20b56a912d89d4e32acbab5064a'
DIRTY_PATH_COUNT=5;DIRTY_SHA256='74b8a9c5caefdc5a220f12cd14972229312beef004e76129d0fb2bb691a0507e'
COMPANIES=('dg-xingxin','dg-huadeng-a','dg-huadeng-b','dg-huajia','hy-huakang-a','hy-huakang-b','hy-huakang-c','hy-huakang-d','hy-huadeng','hy-huaxing','sy-huadeng','sy-xingxin','xs-huadeng')
OUT=None;P=None;O=None;L=None;SERIAL=0;STAGE='entry'
DIAGNOSTIC_ARCHIVE=ROOT/'deploy/backups/pr1046-1049-qc-source-diagnose-1'
DIAGNOSTIC_MANIFEST_SHA256='b7cdd6e3d9224e7f77c724f6ea9e98cacc6366875ba72222a224c42c78b29ced'
DIAGNOSTIC_RESULT_SHA256='a694afd4d2f5f3ddfa595173c3db72c038feb9a0baafc318e5736238e8f76288'
ORIGINAL_FAILED_EXTERNAL_SEAL_SHA256='a92de10d35209c0012becac7a7f9fb51769000247c946bc0a95226e03f233fe1'
DIAGNOSED_LIVE_SIGNATURE={'app': {'bytes': 14604231, 'entries': 42, 'sha256': '5397359027b9e16efd7920fa054711770086ac29df65e3b86dbe2805fce568d1'}, 'package': {'bytes': 282, 'entries': 1, 'sha256': 'faaea91b3cfa9fc8f1bd9ed731097fd90e025aac820a327b372e572185de4958'}}
DIAGNOSED_CANONICAL_SIGNATURE={'app': {'bytes': 14604231, 'entries': 42, 'sha256': 'bb58ee950bfc71938760fde57044607eb113c37f6593107b800fa1dccf2f82c4'}, 'package': {'bytes': 282, 'entries': 1, 'sha256': 'faaea91b3cfa9fc8f1bd9ed731097fd90e025aac820a327b372e572185de4958'}}
DIAGNOSED_OWNER_DIFFERENCES=[{'canonical': {'bytes': 24296, 'gid': 0, 'mode': 420, 'sha256': 'cc11f1b88e115f6fee3faadd38dfda905d9861e375b321ef792332e4305a7be8', 'type': 'file', 'uid': 0}, 'changedGuardFields': ['gid', 'uid'], 'live': {'bytes': 24296, 'gid': 101, 'mode': 420, 'sha256': 'cc11f1b88e115f6fee3faadd38dfda905d9861e375b321ef792332e4305a7be8', 'type': 'file', 'uid': 100}, 'pathSHA256': '4f04012b28f0b2b80def1f2d3463ac3bd647a1c20a5825b99e08a55292a06d8e', 'publicPath': 'qc-backend.js'}, {'canonical': {'bytes': 76552, 'gid': 0, 'mode': 420, 'sha256': 'a745cc5c5c0cd642f895f42a9da671202e7e747dc75fb690c67c7d4187241d8b', 'type': 'file', 'uid': 0}, 'changedGuardFields': ['gid', 'uid'], 'live': {'bytes': 76552, 'gid': 101, 'mode': 420, 'sha256': 'a745cc5c5c0cd642f895f42a9da671202e7e747dc75fb690c67c7d4187241d8b', 'type': 'file', 'uid': 100}, 'pathSHA256': '8cf1ffe3788af127768748703e2f15dcfb3a05ffd20b4c2375223637e3260938', 'publicPath': 'server/server.js'}]

DEPS={'pr1035-quote-preflight.py': '2b2739aa00cad03bfce8472b7416d725364b8d4ed354a5a7e9ca905a47aaffa5', 'release-data-ops-library.py': 'ff9138a1d5bfed1b10077112da6ebcda2d65240f583e2d0e12ce1325cfbaafd5', 'release-data-library.py': 'd63168fd3057f4f2aba2d93f9fab31d2d65c6dd0f3234877d71fcff1e04e62b9'}
SOURCE_PROBE="const fs=require('fs'),path=require('path'),crypto=require('crypto'),items=JSON.parse(fs.readFileSync(0,'utf8'));let out={};if(!Array.isArray(items)||items.length>2000)throw Error('scope');for(const n of items){if(!/^[A-Za-z0-9_./-]+$/.test(n)||n.split('/').some(x=>x==='..'||x===''||x==='data'||x==='uploads'||x==='legacy-data')||/(^|\\/)\\.env(\\.|$)/.test(n))throw Error('path');const p='/app/'+n;for(let d=path.dirname(p);d!=='/';d=path.dirname(d))if(fs.lstatSync(d).isSymbolicLink())throw Error('parentlink');if(!fs.existsSync(p)){out[n]={absent:true};continue;}const a=fs.lstatSync(p);if(!a.isFile()||a.isSymbolicLink()||a.size>128*1024**2)throw Error('file');const fd=fs.openSync(p,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);try{const b=fs.readFileSync(fd),z=fs.fstatSync(fd);if(b.length!==a.size||a.ino!==z.ino||a.mtimeMs!==z.mtimeMs||a.ctimeMs!==z.ctimeMs)throw Error('changed');out[n]={sha256:crypto.createHash('sha256').update(b).digest('hex'),gitBlobSHA1:crypto.createHash('sha1').update('blob '+b.length+'\\0').update(b).digest('hex'),bytes:b.length,uid:a.uid,gid:a.gid,mode:a.mode&4095};}finally{fs.closeSync(fd);}}console.log(JSON.stringify(out));"
CODE_PROBE="const fs=require('fs'),path=require('path'),crypto=require('crypto');\nconst h=b=>crypto.createHash('sha256').update(b).digest('hex');\nfunction tree(root,omit=[]){let a=[],bytes=0;function walk(p,n){let s=fs.lstatSync(p),v={n,uid:s.uid,gid:s.gid,mode:s.mode&4095};\nif(s.isSymbolicLink()){v.type='link';v.target=fs.readlinkSync(p);}else if(s.isDirectory()){v.type='dir';a.push(v);for(let x of fs.readdirSync(p).sort()){if(n===''&&omit.includes(x))continue;walk(path.join(p,x),n?n+'/'+x:x);}return;}else if(s.isFile()){v.type='file';v.size=s.size;bytes+=s.size;v.sha256=h(fs.readFileSync(p));}else throw Error('unsupported-code-kind');a.push(v);if(a.length>100000||bytes>1024**3)throw Error('bounded-code');}\nif(!fs.existsSync(root))return {absent:true};walk(root,'');return {sha256:h(JSON.stringify(a)),entries:a.length,bytes};}\nconsole.log(JSON.stringify({app:tree('/app',['data']),package:tree('/app/package.json')}));"
QUIET_PROBE="const fs=require('fs');let connections=0;for(const f of ['/proc/net/tcp','/proc/net/tcp6'])for(const line of fs.readFileSync(f,'utf8').trim().split('\\n').slice(1)){const p=line.trim().split(/\\s+/);if(parseInt(p[1].split(':').at(-1),16)===3400&&!['0A','06','07'].includes(p[3]))connections++;}console.log(JSON.stringify({connections}));"
NATIVE_TEST="const fs=require('fs'),path=require('path'),os=require('os'),crypto=require('crypto'),cp=require('child_process');const data=JSON.parse(fs.readFileSync(0,'utf8')),dir=fs.mkdtempSync(path.join(os.tmpdir(),'qms1046-1049-native-'));try{const sources=['app.js','ai-ocr.js','qc-backend.js','report_export.js','server/server.js','server/auth.js'];for(const n of sources){const p=path.join(dir,n);fs.mkdirSync(path.dirname(p),{recursive:true,mode:0o700});fs.symlinkSync('/app/'+n,p);}for(const[n,v]of Object.entries(data.files)){if(!/^[A-Za-z0-9_./-]+\\.test\\.js$/.test(n)||n.split('/').includes('..'))throw Error('testpath');const b=Buffer.from(v.body,'base64');if(crypto.createHash('sha256').update(b).digest('hex')!==v.sha256)throw Error('testsha');const p=path.join(dir,n);fs.mkdirSync(path.dirname(p),{recursive:true,mode:0o700});fs.writeFileSync(p,b,{mode:0o600,flag:'wx'});}const out=cp.spawnSync(process.execPath,['--test','--test-reporter=tap',...Object.keys(data.files).sort()],{cwd:dir,env:{PATH:process.env.PATH,NODE_ENV:'test',HOME:dir,TMPDIR:dir,DATA_PATH:path.join(dir,'data'),PORT:'0',DASHSCOPE_API_KEY:'',QC_BAILIAN_API_KEY:'',QC_INSPECTIONS_READ_TOKEN:'',NODE_NO_WARNINGS:'1'},encoding:'utf8',timeout:180000,maxBuffer:8*1024**2});fs.writeFileSync(1,out.stdout||'');fs.writeFileSync(2,out.stderr||'');if(out.status!==0)throw Error('native-test-failed');const count=k=>Number((out.stdout.match(new RegExp('^# '+k+' (\\\\d+)$','m'))||[])[1]);if(count('tests')!==data.expected||count('pass')!==data.expected||count('fail')!==0||count('skipped')!==0)throw Error('native-test-count-or-skip');}finally{fs.rmSync(dir,{recursive:true,force:true});}"
CAPACITY_BUDGET={'approved': True, 'profileFileSHA256': '5d03099f38dfebacaa8138d5fb0bd2166f5399241b97f9cac5d38012a5b73cf7', 'ordinaryReserveBytes': 1073741824, 'physicalReserveBytes': 8589934592, 'imageGrowthUpperBytes': 33554432, 'overlayStageUpperBytes': 16777216, 'coldBackupUpperBytes': 536870912, 'evidenceUpperBytes': 67108864, 'dataRootUpperBytes': 134217728, 'databaseUpperCount': 64, 'minimumMemAvailableBytes': 1073741824, 'ordinaryRequiredBytes': 1728053248, 'physicalRequiredBytes': 9244246016}
CAPACITY_BUDGET_SHA256='b88bba5409011a6188d4cf84a940370f5ac38c10ed21ed8e6095f0875a9dd6bb'

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
 p=pathlib.Path(__file__).with_name(name);need(p.is_file()and not p.is_symlink()and sha(p.read_bytes())==DEPS[name],'fixed-reviewed-dependency');s=importlib.util.spec_from_file_location('qms1046_1049_'+name.replace('.','_'),p);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m

def git(*a):return run(['git','-C',str(ROOT),'-c','core.hooksPath=/dev/null',*a])

def image(name):
 rows=memory(['docker','image','inspect',name]);need(len(rows)==1 and re.fullmatch('sha256:[a-f0-9]{64}',rows[0]['Id']),'one-immutable-image');return rows[0]

def runtime():
 ids=run(['docker','ps','-aq','--no-trunc']).decode().split();need(0<len(ids)<1000 and len(ids)==len(set(ids))and all(pin(c)for c in ids),'bounded-all-container-ids');rows=memory(['docker','inspect',*ids]);need({r['Id']for r in rows}==set(ids),'all-existing-containers');value={}
 for r in rows:
  value[r['Id']]={'image':r['Image'],'config':sha(enc(r['Config'])),'hostConfig':sha(enc(r['HostConfig'])),'mounts':sorted(r['Mounts'],key=enc),'pid':r['State']['Pid'],'started':r['State']['StartedAt'],'restarts':r['RestartCount'],'running':r['State']['Running'],'oom':r['State']['OOMKilled'],'health':r['State'].get('Health',{}).get('Status')}
 need(len(value)==46,'all-46-original-containers-required');target=[r for r in rows if(r['Config'].get('Labels')or{}).get('com.docker.compose.project')=='rr-portal'and(r['Config'].get('Labels')or{}).get('com.docker.compose.service')=='qc'];need(len(target)==1 and target[0]['Id']==CID and target[0]['Image']==LIVE_IMAGE,'same-accepted-quote-cid-image');return value

def bind_meta(path):
 a=path.lstat();kind=next((n for f,n in((stat.S_ISREG,'REG'),(stat.S_ISDIR,'DIR'),(stat.S_ISLNK,'LNK'),(stat.S_ISSOCK,'SOCK'),(stat.S_ISFIFO,'FIFO'),(stat.S_ISCHR,'CHR'),(stat.S_ISBLK,'BLK'))if f(a.st_mode)),None);need(kind is not None,'typed-bind-source');v={'type':kind,'uid':a.st_uid,'gid':a.st_gid,'mode':stat.S_IMODE(a.st_mode)}
 if kind=='LNK':v.update(linkSHA256=sha(os.fsencode(os.readlink(path))),resolved=str(path.resolve(strict=True)),target=bind_meta(path.resolve(strict=True)))
 if kind in('CHR','BLK'):v['rdev']=a.st_rdev
 z=path.lstat();need((a.st_dev,a.st_ino,a.st_mode,a.st_uid,a.st_gid,a.st_rdev)==(z.st_dev,z.st_ino,z.st_mode,z.st_uid,z.st_gid,z.st_rdev),'stable-bind-metadata');return v

def protection(records):
 need(git('rev-parse','HEAD').decode().strip()==HOST_BASE,'host-checkout-preserved');shared={n:P.shared_file(n)for n in P.SHARED};need(all(v['sha256']==sha(git('show',HOST_BASE+':'+n))for n,v in shared.items()),'five-shared-files-match-observed-host');dirty=git('diff','--name-only','-z');staged=git('diff','--cached','--name-only','-z');need(not staged,'no-new-staged-changes');names=[n for n in dirty.decode().split('\0')if n];need(type(DIRTY_PATH_COUNT)is int and pin(DIRTY_SHA256)and len(names)==DIRTY_PATH_COUNT and sha(dirty)==DIRTY_SHA256 and not any(n.startswith(APP+'/')for n in names),'fresh-profile-existing-dirty-files-outside-quote');env={str(p.relative_to(ROOT)):P.shared_file(str(p))for p in ROOT.glob('.env*')if p.is_file()};need('.env.cloud.production'in env and len(env)<100,'production-env-files-hash-only');binds={m['Source']:bind_meta(pathlib.Path(m['Source']))for r in records.values()for m in r['mounts']if m.get('Type')=='bind'};auth=P.gateway_auth();return {'host':HOST_BASE,'shared':shared,'dirtySHA256':sha(dirty),'unrelatedDirtyBodiesNotRead':True,'env':env,'auth':auth,'binds':binds}

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
 cid=run(['docker','create','--network','none','--restart','no','--label','io.rr-portal.qc1046-1049-scratch='+TARGET,'--entrypoint','/bin/true',image_id]).decode().strip();need(pin(cid),'one-owned-never-started-scratch')
 try:
  row=memory(['docker','inspect',cid])[0];need(row['Image']==image_id and row['State']['Pid']==0 and row['State']['StartedAt'].startswith('0001-')and not row['Mounts']and row['HostConfig']['NetworkMode']=='none','scratch-never-started-no-mounts');run(['docker','cp','--archive','-',cid+':/app'],patch);stopped_check(cid,expected)
 finally:
  row=memory(['docker','inspect',cid])[0];need(row['Image']==image_id and not row['State']['Running']and row['State']['Pid']==0 and(row['Config'].get('Labels')or{}).get('io.rr-portal.qc1046-1049-scratch')==TARGET,'remove-only-owned-never-started-scratch');run(['docker','rm',cid])

def sealed(phase,digest):
 d=ARCHIVE/phase;need(pin(digest)and sha((d/'manifest.json').read_bytes())==digest,'sealed-prior-phase-manifest');mf=json.loads((d/'manifest.json').read_bytes());files={str(p.relative_to(d))for p in d.rglob('*')if p.is_file()and p.name!='manifest.json'};need(files==set(mf)and all(not p.is_symlink()and(p.is_file()or p.is_dir())for p in d.rglob('*')),'complete-private-evidence-files');need(all(L.safe_path(n)and L.file_hash(d/n)==h for n,h in mf.items()),'all-prior-evidence-bytes-sealed');v=json.loads((d/'result.private.json').read_bytes());need(v['success']is True and(v['target'],v['tree'],v['appTree'])==(TARGET,TREE,APP_TREE),'successful-source-bound-prior-phase');return v,d

def stable(before,protected):need(runtime()==before and protection(before)==protected,'all-original-runtime-env-auth-host-binds-still-exact')

def allocation(folder):
 total=0
 if not folder.exists():return 0
 for p in [folder,*folder.rglob('*')]:
  s=p.lstat();need(not stat.S_ISLNK(s.st_mode)and(stat.S_ISREG(s.st_mode)or stat.S_ISDIR(s.st_mode)),'own-archive-regular-allocation-only');total+=s.st_blocks*512
 return total

def gate_record(path):
 a=path.lstat();need(stat.S_ISREG(a.st_mode)and a.st_size==0 and a.st_uid==0 and a.st_gid==0 and stat.S_IMODE(a.st_mode)==0o644,'own-empty-root-maintenance-gate');return(a.st_dev,a.st_ino,a.st_uid,a.st_gid,a.st_mode,a.st_size,a.st_mtime_ns,a.st_ctime_ns)

def health():
 for _ in range(40):
  row=memory(['docker','inspect',CID])[0]
  if row['State']['Running']and row['State'].get('Health',{}).get('Status')=='healthy':return
  time.sleep(2)
 need(False,'quote-health-after-single-start')

def retain_failure_gate():
 # A pre-stop rejection is handled by deploy's existing CAS cleanup. Once a
 # valid sole-stop intent was recorded, failures must never leave the freshly
 # switched service exposed merely because the original gate was just cleared.
 intent_path=OUT/'stop-intent.private.json'
 if not intent_path.exists()and not intent_path.is_symlink():return {'lifecycleIntentRecorded':False,'gateCreated':False}
 need(intent_path.is_file()and not intent_path.is_symlink(),'regular-own-lifecycle-intent')
 intent=json.loads(intent_path.read_bytes());need(set(intent)=={'container','beginNs','automaticReplay'}and intent['container']==CID and type(intent['beginNs'])is int and intent['beginNs']>0 and intent['automaticReplay']is False,'source-bound-valid-single-stop-intent')
 path=ROOT/'deploy/maintenance/services/qc';need(path.parent.is_dir()and not any(p.is_symlink()for p in(path.parent,*path.parent.parents)),'fixed-quote-gate-real-parent-after-failure')
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
 rows=memory(['docker','inspect',CID]);need(len(rows)==1,'one-fixed-qc-storage-container');r=rows[0];values=r['Config'].get('Env')or[];need(all(type(v)is str and '='in v for v in values),'typed-in-memory-qc-env');e=dict(v.split('=',1)for v in values);need(len(e)==len(values)and e.get('DATA_PATH')=='/app/data'and e.get('PORT')=='3400','actual-qc-storage-path-and-server-port');expected=[{'Type':'bind','Source':str(DATA_ROOT),'Destination':'/app/data','Mode':'rw','RW':True,'Propagation':'rprivate'}];need(r['Mounts']==expected,'only-original-qc-data-bind-source');return {'onlyFixedDataRoot':True,'credentialsNotPersisted':True}

def startup_contract(body):
 text=body.decode('utf8');sections=[]
 for begin,end in [('const COMPANIES = [','const DEFAULT_COMPANY'),('const SCHEMA_SQL = `','`;'),('function seedIfEmpty(', '/* 用户表新增字段'),('const USER_EXTRA_COLS = [','migrateLegacyDb();')]:
  need(text.count(begin)==1,'unique-unchanged-qc-startup-contract-start');i=text.index(begin);j=text.index(end,i)+len(end);need(0<j-i<128*1024,'bounded-unchanged-qc-startup-contract');sections.append(text[i:j])
 return sections

def source_check():
 need(all(pin(v,40)for v in(BASE,TARGET,TREE,APP_TREE,HOST_BASE))and type(REVIEWED_HEADS)is dict and set(REVIEWED_HEADS)=={'1046','1049'}and all(pin(v,40)for v in REVIEWED_HEADS.values())and CODE and set(CODE)<=RUNTIME_ALLOWED and set(REVIEWED_FILES)==set(CODE)and all(pin(h)for h in REVIEWED_FILES.values())and REVIEWED_PATHS and TEST_FILES and EXPECTED_NATIVE_TESTS>0,'final-reviewed-source-two-heads-scope-tests-and-runtime-pins-required')
 git('fetch','--no-write-fetch-head','origin','+refs/heads/main:refs/remotes/origin/main')
 for number,head in sorted(REVIEWED_HEADS.items()):
  ref='refs/remotes/origin/pr'+number+'-reviewed-head';git('fetch','--no-write-fetch-head','origin','+refs/pull/'+number+'/head:'+ref);need(git('rev-parse',ref).decode().strip()==head,'fetched-pr-head-equals-reviewed-commit')
 need(git('rev-parse','refs/remotes/origin/main').decode().strip()==TARGET and git('rev-parse',TARGET+'^{tree}').decode().strip()==TREE and git('rev-parse',TARGET+':'+APP).decode().strip()==APP_TREE,'exact-reviewed-main-tree-and-combined-qc-app-tree')
 for head in REVIEWED_HEADS.values():git('merge-base','--is-ancestor',head,TARGET)
 paths=[p[len(APP)+1:]for p in git('diff','--name-only','-z',BASE,TARGET,'--',APP).decode().split('\0')if p];need(set(paths)==set(REVIEWED_PATHS),'exact-complete-reviewed-qc-app-path-scope');production={n for n in paths if not n.endswith(('.test.js','.test.json'))and((n.startswith('server/')or'/'not in n)and n.endswith(('.js','.html','.css','.json')))};need(production==set(CODE)and all(re.fullmatch(r'[A-Za-z0-9_./-]+',n)and '..'not in n.split('/')for n in CODE),'only-reviewed-qc-production-code-files')
 need({'ocr-batch.test.js','review-batch.test.js','server/api-auth.test.js','server/record-sync.test.js','server/ocr-parser.test.js'}<=set(TEST_FILES)and all(re.fullmatch(r'[A-Za-z0-9_./-]+\.test\.js',n)and '..'not in n.split('/')and pin(h)for n,h in TEST_FILES.items()),'reviewed-offline-qc-ocr-review-permission-and-record-sync-native-test-manifest')
 need(all(git('show',BASE+':'+APP+'/'+n)==git('show',TARGET+':'+APP+'/'+n)for n in('Dockerfile','package.json','server/auth.js','server/seed.json','server/ai-config.json','dev-server.js')),'unchanged-build-auth-seed-config-and-no-dependencies')
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
 files={n:{'body':__import__('base64').b64encode(git('show',TARGET+':'+APP+'/'+n)).decode(),'sha256':h}for n,h in TEST_FILES.items()};need(all(sha(__import__('base64').b64decode(v['body']))==v['sha256']for v in files.values()),'native-tests-exact-reviewed-git-bytes');run(['docker','run','--rm','-i','--network','none','--read-only','--restart','no','--log-driver','none','--tmpfs','/tmp:rw,nosuid,nodev,size=256m','--entrypoint','node',candidate,'-e',NATIVE_TEST],enc({'files':files,'expected':EXPECTED_NATIVE_TESTS}),timeout=240);return {'tests':EXPECTED_NATIVE_TESTS,'skips':0,'productionMountsOrCredentialsUsed':False,'database':'isolated-tmpfs-sqlite','wholeSuiteClaimed':False}

def data_estimate():
 need(DATA_ROOT.is_dir()and not any(p.is_symlink()for p in(DATA_ROOT,*DATA_ROOT.parents)),'fixed-qc-data-root-real-parents');files=0;dirs=1;size=0
 for p in DATA_ROOT.rglob('*'):
  a=p.lstat();need(not stat.S_ISLNK(a.st_mode)and(stat.S_ISREG(a.st_mode)or stat.S_ISDIR(a.st_mode)),'all-hidden-inclusive-qc-data-entries-regular')
  if stat.S_ISDIR(a.st_mode):dirs+=1
  else:files+=1;size+=a.st_size
  need(files+dirs<=100000,'bounded-all-qc-data-entries')
 names=O.database_names(DATA_ROOT);need(any(pathlib.PurePosixPath(n).name=='qc.db'for n in names),'at-least-one-real-qc-database');return {'root':str(DATA_ROOT.relative_to(ROOT)),'bytes':size,'regularFiles':files,'directories':dirs,'databases':len(names)}

def startup_guard():
 names=O.database_names(DATA_ROOT);expected={company+'/qc.db'for company in COMPANIES};need(expected<=set(names),'all-existing-qc-company-databases-no-startup-migration-or-new-db');seed=json.loads(git('show',BASE+':'+APP+'/server/seed.json'));need(type(seed)is dict and all(type(seed.get(k,[]))is list for k in('users','records','defectLib')),'typed-unchanged-qc-seed-shape');record_columns={'processType','status','reviewBy','reviewAt','rejectReason','rejectBy','rejectAt','aqlLevel'};user_columns={'name','dept','perms'}
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
 b=CAPACITY_BUDGET;keys={'profileFileSHA256','ordinaryReserveBytes','physicalReserveBytes','imageGrowthUpperBytes','overlayStageUpperBytes','coldBackupUpperBytes','evidenceUpperBytes','dataRootUpperBytes','databaseUpperCount','minimumMemAvailableBytes','ordinaryRequiredBytes','physicalRequiredBytes','approved'};need(type(b)is dict and set(b)==keys and pin(CAPACITY_BUDGET_SHA256)and sha(enc(b))==CAPACITY_BUDGET_SHA256 and b['approved']is True and b['profileFileSHA256']==PROFILE_RESULT_SHA256,'explicit-reviewed-fresh-profile-bound-qc-capacity-budget');numeric=keys-{'profileFileSHA256','approved'};need(all(type(b[k])is int and b[k]>0 for k in numeric),'typed-positive-reviewed-qc-capacity-budget');need(b['ordinaryReserveBytes']>=1024**3 and b['physicalReserveBytes']>=8*1024**3 and b['databaseUpperCount']<=64,'retain-one-gb-ordinary-eight-gb-physical-reserves-and-bounded-dbs');need(b['coldBackupUpperBytes']>=4*b['dataRootUpperBytes'],'cold-budget-covers-two-db-and-file-backups-plus-format-overhead');peak=sum(b[k]for k in('imageGrowthUpperBytes','overlayStageUpperBytes','coldBackupUpperBytes','evidenceUpperBytes'));need(b['ordinaryRequiredBytes']==b['ordinaryReserveBytes']+peak and b['physicalRequiredBytes']==b['physicalReserveBytes']+peak,'reviewed-additive-qc-peak-budget');return b

def free_check():
 b=budget_contract();root=memory(['docker','info','--format','{{json .DockerRootDir}}']);need(type(root)is str and pathlib.Path(root).is_absolute(),'actual-absolute-docker-root-for-qc-capacity');match=re.search(r'^MemAvailable:\s+([0-9]+) kB$',pathlib.Path('/proc/meminfo').read_text(),re.M);need(match is not None,'fresh-memavailable');mem=int(match[1])*1024;fs=os.statvfs(root);used=allocation(ARCHIVE);data=data_estimate();v={'available':fs.f_bavail*fs.f_frsize,'free':fs.f_bfree*fs.f_frsize,'qcData':data,'memAvailableBytes':mem,'ownArchiveAllocatedBytes':used,'minimumOrdinaryBytes':b['ordinaryRequiredBytes'],'minimumPhysicalBytes':b['physicalRequiredBytes'],'capacityBudgetSHA256':CAPACITY_BUDGET_SHA256};need(data['bytes']<=b['dataRootUpperBytes']and data['databases']<=b['databaseUpperCount']and v['available']>=b['ordinaryRequiredBytes']and v['free']>=b['physicalRequiredBytes']and mem>=b['minimumMemAvailableBytes']and used<=b['overlayStageUpperBytes']+b['coldBackupUpperBytes']+b['evidenceUpperBytes'],'actual-qc-space-memory-data-size-own-evidence-within-reviewed-budget');return v

def profile_check(before):
 p=pathlib.Path(PROFILE_PATH);need(PROFILE_PATH and p.is_absolute()and p.parent.parent==ROOT/'deploy/backups'and re.fullmatch(r'pr1046-1049-preflight-[0-9]+',p.parent.name)and p.name=='result.private.json','bound-fresh-qc-batch-profile-path');need(pin(PROFILE_RESULT_SHA256)and pin(PROFILE_VALUE_SHA256)and p.is_file()and not p.is_symlink()and file_hash(p)==PROFILE_RESULT_SHA256,'bound-fresh-successful-qc-readonly-profile');v=json.loads(p.read_bytes());verify=dict(v);need(verify.pop('resultSHA256')==PROFILE_VALUE_SHA256==sha(enc(verify)),'canonical-successful-profile-result-digest');need(v['success']is True and v['readOnly']is True and v['allRuntimeUnchanged']is True and v['sourceBaseline']==BASE and v['hostGitHead']==HOST_BASE and all(v[k]is False for k in('businessWrites','lifecycleWrites','configWrites','plaintextCredentialsWritten','businessFileBodiesCopied')),'successful-nonmutating-source-bound-batch-profile');q=v['targets']['qc'];need(q['id']==CID and q['canonicalImage']['id']==BASE_IMAGE and q['source']['differences']==[],'profile-same-qc-service-source-and-accepted-durable-alias');need(v['unstaged']['trackedPathCount']==DIRTY_PATH_COUNT and v['unstaged']['rawPathInventorySHA256']==DIRTY_SHA256 and v['staged']['trackedPathCount']==0,'profile-bound-existing-dirty-inventory');observed=v['allRuntime'];need(set(observed)==set(before)and all(observed[c]['image']==before[c]['image']and observed[c]['configSHA256']==before[c]['config']and observed[c]['hostConfigSHA256']==before[c]['hostConfig']and observed[c]['mountsSHA256']==sha(enc(before[c]['mounts']))and all(observed[c][k]==before[c][k]for k in('pid','started','restarts','running','oom','health'))for c in before),'fresh-profile-all-46-runtime-contracts-still-exact');protected=protection(before);need(v['shared']==protected['shared']and v['env']==protected['env']and v['gatewayAuth']==protected['auth'],'fresh-profile-shared-config-env-and-gateway-auth-exact');b=budget_contract();data=v['qcData'];need(set(data)=={'root','bytes','regularFiles','directories','databases'}and data['root']==str(DATA_ROOT.relative_to(ROOT))and all(type(data[k])is int and data[k]>=0 for k in('bytes','regularFiles','directories','databases'))and 1<=data['databases']<=b['databaseUpperCount']and data['bytes']<=b['dataRootUpperBytes'],'fresh-profile-qc-metadata-only-size-budget');return v['resultSHA256']

def failed_original_evidence_guard(seal):
 root=ROOT/'deploy/backups/pr1046-1049-qc-20261031-1/prepare';need(seal['directory']==str(root)and seal['writesToOriginalDirectory']is False and seal['atimeExcluded']is True and sha(enc(seal['entries']))==seal['contentAndMetadataSHA256']==ORIGINAL_FAILED_EXTERNAL_SEAL_SHA256,'exact-original-failed-phase-external-seal');actual=[];total=0;need(root.is_dir()and not any(p.is_symlink()for p in(root,*root.parents)),'original-failed-phase-real-directory')
 for path in[root,*sorted(root.rglob('*'))]:
  a=path.lstat();need(not stat.S_ISLNK(a.st_mode)and(stat.S_ISREG(a.st_mode)or stat.S_ISDIR(a.st_mode)),'original-failed-evidence-still-regular');row={'path':str(path.relative_to(root)),'uid':a.st_uid,'gid':a.st_gid,'mode':stat.S_IMODE(a.st_mode),'mtimeNs':a.st_mtime_ns,'ctimeNs':a.st_ctime_ns,'bytes':a.st_size,'type':'directory'if stat.S_ISDIR(a.st_mode)else'file'}
  if stat.S_ISREG(a.st_mode):
   total+=a.st_size;need(a.st_size<=256*1024**2 and total<=512*1024**2,'bounded-original-failed-evidence-hash-only');row['sha256']=file_hash(path);b=path.lstat();need((a.st_dev,a.st_ino,a.st_uid,a.st_gid,a.st_mode,a.st_size,a.st_mtime_ns,a.st_ctime_ns)==(b.st_dev,b.st_ino,b.st_uid,b.st_gid,b.st_mode,b.st_size,b.st_mtime_ns,b.st_ctime_ns),'original-failed-evidence-stable-while-read')
  actual.append(row);need(len(actual)<=10000,'bounded-original-failed-evidence-set')
 need(actual==seal['entries']and total==seal['bytes'],'original-failed-phase-entire-external-seal-still-exact');return seal['contentAndMetadataSHA256']

def diagnosed_owner_layout(live_signature,canonical_signature,old_source):
 # No normalization of current signatures is allowed. The only exception is a
 # successful, sealed, source-bound forensic observation of exactly these two
 # old file owners; both paths are replaced by this release's existing COPY.
 d=DIAGNOSTIC_ARCHIVE;need(pin(DIAGNOSTIC_MANIFEST_SHA256)and pin(DIAGNOSTIC_RESULT_SHA256)and pin(ORIGINAL_FAILED_EXTERNAL_SEAL_SHA256)and d==ROOT/'deploy/backups/pr1046-1049-qc-source-diagnose-1'and d.is_dir()and not any(p.is_symlink()for p in(d,*d.parents)),'fixed-successful-readonly-diagnosis-archive');need(file_hash(d/'manifest.json')==DIAGNOSTIC_MANIFEST_SHA256,'exact-readonly-diagnostic-manifest');mf=json.loads((d/'manifest.json').read_bytes());paths=list(d.rglob('*'));need(all(not p.is_symlink()and(p.is_file()or p.is_dir())for p in paths)and{str(p.relative_to(d))for p in paths if p.is_file()and p.name!='manifest.json'}==set(mf)and all(L.safe_path(n)and file_hash(d/n)==h for n,h in mf.items()),'every-readonly-diagnosis-evidence-byte-sealed');value=json.loads((d/'result.private.json').read_bytes());raw=dict(value);need(raw.pop('resultSHA256')==DIAGNOSTIC_RESULT_SHA256==sha(enc(raw))and value['success']is True and value['phase']==value['mode']=='diagnose'and value['readOnly']is True,'successful-self-sealed-readonly-diagnosis');need(all(value[k]is False for k in('businessWrites','configurationWrites','configuredBusinessDataRootTraversed','lifecycleWrites','originalFailedPhaseModified','plaintextCredentialsOrFileBodiesReturned','prepareRetried','sourceOrImageTagsChanged')),'diagnosis-no-lifecycle-config-data-or-source-mutations');detail=value['details'];need(detail['currentLiveSignature']==live_signature==DIAGNOSED_LIVE_SIGNATURE and detail['currentCanonicalSignature']==canonical_signature==DIAGNOSED_CANONICAL_SIGNATURE,'current-whole-live-and-canonical-signatures-exact-diagnosed-observations');need(detail['all46RuntimeAndOriginalPublicSourcePreserved']is True and detail['originalFailedEvidencePreserved']is True and detail['originalFailedEvidenceSealSHA256']==ORIGINAL_FAILED_EXTERNAL_SEAL_SHA256 and detail['guardRelaxed']is False and detail['prepareRetried']is False and detail['originalProbeOrderMatchesCurrent']==[True,True]and detail['originalStructuredProbeCount']==2,'source-bound-diagnosis-preserved-original-failure-runtime-and-public-code');need(detail['differingPaths']==detail['knownPublicDifferences']==2 and detail['unknownHashedDifferences']==0 and detail['differenceRows']==DIAGNOSED_OWNER_DIFFERENCES,'exactly-two-diagnosed-code-owner-only-differences')
 live=json.loads((d/'live-filesystem-redacted.private.json').read_bytes());canonical=json.loads((d/'canonical-filesystem-redacted.private.json').read_bytes());need(live['originalGuardSignature']==live_signature and canonical['originalGuardSignature']==canonical_signature and live['totalFileBytes']==canonical['totalFileBytes']==live_signature['app']['bytes'],'same-complete-forensic-tree-signatures-and-bytes');a={r['pathSHA256']:r for r in live['entries']};b={r['pathSHA256']:r for r in canonical['entries']};need(len(a)==len(live['entries'])==live_signature['app']['entries']and len(b)==len(canonical['entries'])==canonical_signature['app']['entries']and set(a)==set(b),'same-complete-diagnosed-tree-path-set-no-extra-or-missing-entry');allowed={row['pathSHA256']:row for row in DIAGNOSED_OWNER_DIFFERENCES};need(len(allowed)==2 and{r['publicPath']for r in allowed.values()}=={'qc-backend.js','server/server.js'}<=set(CODE),'owner-exception-only-two-existing-code-files-this-release-replaces')
 for path_hash in a:
  x,y=a[path_hash],copy.deepcopy(b[path_hash])
  if path_hash in allowed:
   row=allowed[path_hash];name=row['publicPath'];need(path_hash==sha(name.encode())and x.get('publicPath')==y.get('publicPath')==name and row['changedGuardFields']==['gid','uid']and row['live']['type']==row['canonical']['type']=='file'and row['live']['uid']==100 and row['live']['gid']==101 and row['canonical']['uid']==row['canonical']['gid']==0,'exact-diagnosed-owner-pair-on-public-code-files');need({k:v for k,v in row['live'].items()if k not in('uid','gid')}=={k:v for k,v in row['canonical'].items()if k not in('uid','gid')}and row['live']['mode']==0o644,'same-old-file-body-size-mode-and-type-on-diagnosed-owner-delta');need({k:x[k]for k in('type','uid','gid','mode','bytes','sha256')}==row['live']and{k:y[k]for k in('type','uid','gid','mode','bytes','sha256')}==row['canonical'],'full-file-metadata-equals-diagnosed-exact-pair');need(name in old_source and all(old_source[name][k]==x[k]for k in('uid','gid','mode','bytes','sha256')),'actual-old-source-metadata-matches-diagnosed-live-copy-owner');y.update(uid=x['uid'],gid=x['gid'])
  need(x==y,'every-other-diagnosed-entry-field-and-body-remains-exact')
 seal=json.loads((d/'failed-prepare-external-seal.private.json').read_bytes());original=failed_original_evidence_guard(seal);return {'diagnosticManifestSHA256':DIAGNOSTIC_MANIFEST_SHA256,'diagnosticResultSHA256':DIAGNOSTIC_RESULT_SHA256,'originalFailedEvidenceSealSHA256':original,'ownerOnlyCodePaths':['qc-backend.js','server/server.js'],'otherEntriesFullyExact':True,'currentWholeSignaturesExact':True,'arbitraryOwnerNormalizationAllowed':False,'originalFailedPhaseUnmodified':True}

def prepare():
 budget_contract();bodies=source_check();entry();need(all(sha(bodies[n])==REVIEWED_FILES[n]for n in CODE),'exact-reviewed-qc-code-blob-shas');before=runtime();profile=profile_check(before);need(before[CID]['running']and before[CID]['health']=='healthy'and image(ALIAS)['Id']==BASE_IMAGE,'healthy-original-qc-runtime-and-durable-alias');storage_contract();protected=protection(before);private(OUT/'runtime-before.private.json',enc(before));private(OUT/'protection.private.json',enc(protected));free=free_check();guard=startup_guard();actual,old=source(CID,'old-live-source',BASE);need(actual['differentFiles']==[],'all-tracked-live-qc-production-source-matches-base');novel=[n for n in CODE if n not in old]
 if novel:
  observed=json.loads(run(['docker','exec','--user','0','-i',CID,'node','-e',SOURCE_PROBE],enc(novel)));need(set(observed)==set(novel)and all(v=={'absent':True}for v in observed.values()),'new-reviewed-qc-paths-actually-absent-before-patch');old.update(observed)
 base=image(BASE_IMAGE);need(not base['Config'].get('Volumes'),'trusted-qc-base-without-anonymous-volumes');old_sig=tree_hash(CID);base_sig=tree_hash(BASE_IMAGE,True);owner_proof=diagnosed_owner_layout(old_sig,base_sig,old);metadata={};old_bodies={};old_metadata={};context=OUT/'context';context.mkdir(mode=0o700);recipe=[];base_alias='rrportal-qc-1046-1049-base:'+BASE_IMAGE.split(':')[1];probe=subprocess.run(['docker','image','inspect',base_alias],capture_output=True,timeout=30);need(probe.returncode!=0 or json.loads(probe.stdout)[0]['Id']==BASE_IMAGE,'own-qc-base-alias-not-reassigned');need(probe.returncode==0 or b'No such image'in probe.stderr or b'No such object'in probe.stderr,'only-known-qc-base-alias-absence')
 if probe.returncode:run(['docker','tag',BASE_IMAGE,base_alias])
 recipe.append('FROM '+base_alias)
 for i,n in enumerate(CODE):
  anchor=n if n not in novel else('server/server.js'if n.startswith('server/')else'app.js');original,v=copied_file(CID,anchor);need({k:v[k]for k in('sha256','bytes','uid','gid','mode')}=={k:old[anchor][k]for k in('sha256','bytes','uid','gid','mode')},'qc-rollback-or-new-file-anchor-exact-original-metadata')
  if n not in novel:old_bodies[n]=original;old_metadata[n]=v
  metadata[n]=dict(v,sha256=sha(bodies[n]),bytes=len(bodies[n]),mtime=max(int(time.time())+2,int(v['mtime'])+2));p=context/('code'+str(i));private(p,bodies[n]);p.chmod(v['mode']);os.utime(p,(metadata[n]['mtime'],metadata[n]['mtime']));recipe.append('COPY --chown=%d:%d %s /app/%s'%(v['uid'],v['gid'],p.name,n))
 free_check();private(OUT/'rollback-source.tar',bundle(old_bodies,old_metadata));patch=bundle(bodies,metadata);private(OUT/'patch.tar',patch);private(context/'Dockerfile',('\n'.join(recipe)+label_line()+'\n').encode());tag='rr-portal-qc:pr1046-1049-'+TARGET[:12];free_check();run(['docker','build','--network=none','--pull=false','-t',tag,str(context)],timeout=600);candidate=image(tag);a=copy.deepcopy(base['Config']);b=copy.deepcopy(candidate['Config']);a.pop('Image',None);b.pop('Image',None);labels=dict(a.get('Labels')or{});a['Labels']=dict(labels,**{'org.opencontainers.image.revision':TARGET,'io.rr-portal.qc-app-tree':APP_TREE,'io.rr-portal.frontend-app-tree':APP_TREE,'io.rr-portal.backend-source':TARGET});need(a==b and candidate['Architecture']==base['Architecture']and candidate['Os']==base['Os']and candidate['RootFS']['Layers'][:len(base['RootFS']['Layers'])]==base['RootFS']['Layers'],'derivative-exact-qc-runtime-config-and-base-layers');new_sig=tree_hash(candidate['Id'],True);need(new_sig['package']==old_sig['package'],'qc-zero-dependency-package-preserved');s,new=source(candidate['Id'],'candidate-source',TARGET);need(s['differentFiles']==[]and all({k:new[n][k]for k in('sha256','bytes','uid','gid','mode')}=={k:metadata[n][k]for k in('sha256','bytes','uid','gid','mode')}for n in CODE),'candidate-all-qc-source-target-and-reviewed-metadata');scratch(candidate['Id'],patch,metadata);native=native_tests(candidate['Id']);stable(before,protected);free_after=free_check();private(OUT/'candidate-source.private.json',enc(new));return {'candidate':candidate['Id'],'runtime':before,'protected':protected,'metadata':metadata,'oldSignature':old_sig,'newSignature':new_sig,'oldSource':old,'source':new,'spaceBefore':free,'spaceAfter':free_after,'sameCidCopyProvenInNeverStartedScratch':True,'nativeTests':native,'profileResultSHA256':profile,'oldAbsentPaths':novel,'startupGuard':guard,'diagnosedOwnerOnlyBaseline':owner_proof}

def deploy():
 global STAGE
 value,d=sealed('prepare',PREPARED_SHA256);p=value['details'];before=runtime();protected=protection(before);need(before==p['runtime']and protected==p['protected'],'same-prepared-qc-runtime-and-protection');need(image(ALIAS)['Id']==BASE_IMAGE,'canonical-qc-alias-cas-before-switch');source_check();s,_=source(CID,'preswitch-source',BASE);need(s['differentFiles']==[]and tree_hash(CID)==p['oldSignature'],'all-preswitch-qc-source-exact');free_check();storage_contract();startup_guard();ingress=entry();cache_headers=old_cache_headers();private(OUT/'original-cache-headers.private.json',enc(cache_headers));path=ROOT/'deploy/maintenance/services/qc';need(path.parent.is_dir()and not path.parent.is_symlink()and not path.exists()and not path.is_symlink(),'one-new-qc-service-gate');fd=os.open(path,os.O_CREAT|os.O_EXCL|os.O_WRONLY|os.O_NOFOLLOW,0o644);os.fchmod(fd,0o644);os.close(fd);owned=gate_record(path);stop_attempted=False
 try:
  private(OUT/'gate.private.json',enc(owned));entry(True,ingress);samples=quiet();startup_guard();private(OUT/'pre-stop-space.private.json',enc(free_check()));need(runtime()==before and protection(before)==protected and image(ALIAS)['Id']==BASE_IMAGE and gate_record(path)==owned,'before-stop-all-original-qc-contracts-and-owned-gate');stop_begin=time.time_ns();private(OUT/'stop-intent.private.json',enc({'container':CID,'beginNs':stop_begin,'automaticReplay':False}));stop_attempted=True;run(['docker','stop','--time','30',CID],timeout=90)
 except Exception:
  failed_stage=STAGE;cleanup={'lifecycleAttempted':stop_attempted,'clearedOwnUnchangedGate':False}
  if not stop_attempted:
   try:
    need(gate_record(path)==owned,'pre-stop-failure-only-own-qc-gate-cas');path.unlink();cleanup['clearedOwnUnchangedGate']=True
   except Exception as e:cleanup['cleanupErrorType']=type(e).__name__
  private(OUT/'pre-stop-failure-gate.private.json',enc(cleanup));STAGE=failed_stage;raise
 need(not memory(['docker','inspect',CID])[0]['State']['Running'],'same-original-qc-stopped');cold=storage('cold-before');free_check();run(['docker','cp','--archive','-',CID+':/app'],(d/'patch.tar').read_bytes());stopped_check(CID,p['metadata']);free_check();start_begin=time.time_ns();run(['docker','start',CID],timeout=90);start_end=time.time_ns();private(OUT/'single-start-window.private.json',enc({'beginNs':start_begin,'endNs':start_end,'stopBeginNs':stop_begin,'container':CID}));health();after=runtime();need(set(before)==set(after)and all(after[c]==before[c]for c in before if c!=CID),'every-other-existing-container-exact');old,new=before[CID],after[CID];need(new==dict(old,started=new['started'],pid=new['pid'],restarts=0)and new['running']and new['health']=='healthy'and old['started']!=new['started']and old['pid']!=new['pid'],'one-same-qc-cid-manual-start-only-runtime-delta');need(start_begin<=utc_ns(new['started'])<=start_end,'manual-qc-start-in-exact-integer-ns-command-window');s,actual=source(CID,'live-upgraded-source',TARGET);need(s['differentFiles']==[]and actual==p['source']and tree_hash(CID)==p['newSignature'],'all-live-qc-source-exact-candidate');post=storage('after-start');compare_storage(cold,post);need(protection(after)==protected,'all-config-env-auth-binds-preserved');need(runtime()==after and image(ALIAS)['Id']==BASE_IMAGE and gate_record(path)==owned,'final-qc-runtime-alias-gate-cas');run(['docker','tag',p['candidate'],ALIAS]);need(image(ALIAS)['Id']==p['candidate'],'durable-qc-canonical-promoted-once');need(gate_record(path)==owned,'own-qc-maintenance-gate-unchanged-before-clear');path.unlink();entry(False,ingress);public_files(cache_headers);return {'candidate':p['candidate'],'runtime':after,'protected':protected,'allQmsBusinessAuthTombstonesSchemaAndFilesPreserved':True,'singleStopCopyStart':True,'sameContainer':CID,'liveImage':LIVE_IMAGE,'durableImage':p['candidate'],'quietSamples':samples,'historicalDockerEventsNotRequiredOrClaimed':True,'nonAtomicCrossDatabaseSnapshotClaimed':False}

def verify():
 source_check();value,_=sealed('deploy',DEPLOY_SHA256);p=value['details'];need(runtime()==p['runtime']and protection(p['runtime'])==p['protected']and image(ALIAS)['Id']==p['candidate'],'deployed-qc-runtime-config-and-durable-alias');s,_=source(CID,'verify-live-source',TARGET);need(s['differentFiles']==[],'all-current-tracked-qc-production-source-target');need(not(ROOT/'deploy/maintenance/services/qc').exists(),'qc-maintenance-cleared');need(tree_hash(CID)==sealed('prepare',PREPARED_SHA256)[0]['details']['newSignature'],'qc-whole-source-still-candidate');entry();public_files();return {'sameContainer':CID,'durableImage':p['candidate'],'allOtherContainersRuntimeAndEnvPreserved':True,'businessDataNotComparedAcrossUserWriteWindow':True}

def label_line():return '\nLABEL org.opencontainers.image.revision="'+TARGET+'" io.rr-portal.qc-app-tree="'+APP_TREE+'" io.rr-portal.frontend-app-tree="'+APP_TREE+'" io.rr-portal.backend-source="'+TARGET+'"'

def http(path,headers=None):
 need(path in('/','/paiji/health','/indo-shipping/api/health','/sprayplan/api/health','/internal-quote/health','/qc/','/qc/api/health','/qc/api/bootstrap?company=dg-xingxin')or path in['/qc/'+n for n in CODE if '/'not in n],'fixed-local-readonly-qc-http-path');request=urllib.request.Request('http://127.0.0.1'+path,headers=headers or{})
 try:r=urllib.request.urlopen(request,timeout=20)
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

def main():
 global OUT,STAGE
 need(EXECUTE is True and PHASE in('prepare','deploy','verify')and sys.argv[1:]==[PHASE]and os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_MODE')==PHASE and os.environ.get('RELEASE_ATTEMPT')=='1','explicit-one-shot-reviewed-qc-phase-only');os.umask(0o077);need(ARCHIVE.parent.is_dir()and not ARCHIVE.parent.is_symlink(),'private-parent');ARCHIVE.mkdir(mode=0o700,exist_ok=True);OUT=ARCHIVE/PHASE;need(not OUT.exists()and not OUT.is_symlink(),'fresh-private-qc-phase-no-replay');OUT.mkdir(mode=0o700);v={'service':'qc','mode':PHASE,'resultPath':str(OUT/'result.private.json'),'phase':PHASE,'base':BASE,'reviewedHeads':REVIEWED_HEADS,'target':TARGET,'tree':TREE,'appTree':APP_TREE,'hostBase':HOST_BASE,'success':False,'hostSourceCheckoutPerformed':False,'automaticMutationRetry':False,'credentialsChanged':False,'allNonQcServicesLifecycleOperated':False,'postgresAccessPerformed':False}
 try:
  setup();v['details']={'prepare':prepare,'deploy':deploy,'verify':verify}[PHASE]();v['success']=True
 except Exception as e:
  original_stage=STAGE;v.update(errorType=type(e).__name__,stage=original_stage,dependencyStage=None if O is None else O.STAGE)
  if PHASE=='deploy':
   try:v['failureGate']=retain_failure_gate()
   except Exception as gate_error:v['failureGate']={'errorType':type(gate_error).__name__,'stage':STAGE,'automaticReplay':False}
  STAGE=original_stage
 v['resultSHA256']=sha(enc(v));private(OUT/'result.private.json',enc(v));files=list(OUT.rglob('*'));need(all(not p.is_symlink()and(p.is_file()or p.is_dir())for p in files),'regular-private-qc-phase-evidence');manifest={str(p.relative_to(OUT)):file_hash(p)for p in files if p.is_file()};private(OUT/'manifest.json',enc(manifest));digest=sha(enc(manifest));receipt={'result':v,'manifestSHA256':digest,'preparedSHA256'if PHASE=='prepare'else'deployEvidenceSHA256':digest};transport(receipt);return 0 if v['success']else 1

if __name__=='__main__':sys.exit(main())
