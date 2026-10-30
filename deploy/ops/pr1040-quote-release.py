"""INERT single-Quote release draft: small durable COPY overlay + one same-CID restart.
No host checkout, npm/APK, other-service lifecycle, DB restore or automatic replay.
Final reviewed source hashes are intentionally unbound until root review.
"""
import calendar,copy,datetime,hashlib,importlib.util,io,json,os,pathlib,re,stat,subprocess,sys,tarfile,time,urllib.request,urllib.error
ROOT=pathlib.Path('/opt/rr-portal');ARCHIVE=ROOT/'deploy/backups/pr1040-quote-20261030'
APP='apps/业务部/内部报价系统';HOST_BASE='f22fbffa1789234fe1c78bf776f4dcb3fe867d0c';BASE='80e027a75f306f1fff50033672c52201dc4ab0bf'
TARGET='49c0f09167f4eedcc766d828ced36d29f94544be';TREE='46681593ca33261f9e11366fc182b23566b18740';HEAD='c3721fd0e24ec018ee5c9e50a2e62f16d6778d90';APP_TREE='cd895f5fe3dbbb33037f5e0c9a7ee60db2a53f1d';PHASE='prepare';PREPARED_SHA256='';DEPLOY_SHA256='';EXECUTE=True
BRANCH='refs/heads/ops/pr-1040-20261030-quote';ALIAS='rr-portal-internal-quote:latest'
CID='0cfa8edaff44bbc74b4443b6dec444c90e2f115833ff9913abf8c9b6c462ef7a'
LIVE_IMAGE='sha256:adf5b723ca5f8edae60a0a0f12a3828b8cd488a99eeee6405b61092805620294'
BASE_IMAGE='sha256:834b705bec9a0da37224b3d5d3b9caf646c9bcf7d86f5e25bf18e0baf0c26aa9'
CODE=('backend/routes/quotes.js', 'backend/routes/summary.js', 'backend/routes/verifications.js', 'frontend/index.html', 'frontend/main.js')
REVIEWED_FILES={'backend/routes/quotes.js': '006400b8149bd611b93738b1df69ea40ea848b25b884af813a53507a3f8134ed', 'backend/routes/summary.js': '8863a7daefeb9ebe827cb6b4a85074f954cfcb4ba2b42505da063cc94beaee3c', 'backend/routes/verifications.js': '7ca0be4140ca1493aa1f4c5efa04a4f24c34136de65cb654be0a8bd5fff41d63', 'frontend/index.html': '31b8a8893bfe1c35f150857e96642a1461faf51b3604f196f8b5c921e6ee276e', 'frontend/main.js': '45b5bbe5384838777455a4a5d799b644fbce5f215958c340f61809722c070240'}
DEPS={'pr1035-quote-preflight.py':'2b2739aa00cad03bfce8472b7416d725364b8d4ed354a5a7e9ca905a47aaffa5','release-data-ops-library.py':'ff9138a1d5bfed1b10077112da6ebcda2d65240f583e2d0e12ce1325cfbaafd5','release-data-library.py':'d63168fd3057f4f2aba2d93f9fab31d2d65c6dd0f3234877d71fcff1e04e62b9','pr1030-engineering-preflight.py':'3d06b2aef715f75740826ff75f91c1cb78e0927e030717795ef2733f0595a4d0'}
CODE_PROBE="const fs=require('fs'),path=require('path'),crypto=require('crypto');\nconst h=b=>crypto.createHash('sha256').update(b).digest('hex');\nfunction tree(root,omit=[]){let a=[],bytes=0;function walk(p,n){let s=fs.lstatSync(p),v={n,uid:s.uid,gid:s.gid,mode:s.mode&4095};\nif(s.isSymbolicLink()){v.type='link';v.target=fs.readlinkSync(p);}else if(s.isDirectory()){v.type='dir';a.push(v);for(let x of fs.readdirSync(p).sort()){if(n===''&&omit.includes(x))continue;walk(path.join(p,x),n?n+'/'+x:x);}return;}else if(s.isFile()){v.type='file';v.size=s.size;bytes+=s.size;v.sha256=h(fs.readFileSync(p));}else throw Error('unsupported-code-kind');a.push(v);if(a.length>100000||bytes>1024**3)throw Error('bounded-code');}\nif(!fs.existsSync(root))return {absent:true};walk(root,'');return {sha256:h(JSON.stringify(a)),entries:a.length,bytes};}\nconsole.log(JSON.stringify({backend:tree('/app/backend',['data','legacy-data','uploads','data.db','data.db-shm','data.db-wal']),nodeModules:tree('/app/node_modules'),package:tree('/app/package.json'),lock:tree('/app/package-lock.json')}));"
TEST_FILES={'tests/quote-confirmation-ui.test.js': 'a09033a69292e1d18321e25ed245bc69ad897071d345ad27bfea5e4d298de3af', 'tests/quote-freeze-api.test.js': '4ba5cfaa9cb2ffe04fecc716c350a9163107b9ca59c734b879932919804666b0'};EXPECTED_NATIVE_TESTS=9;REVIEWED_PATHS=('README.md', 'backend/routes/quotes.js', 'backend/routes/summary.js', 'backend/routes/verifications.js', 'frontend/index.html', 'frontend/main.js', 'tests/confirmation-revoke-pg.test.js', 'tests/quote-confirmation-ui.test.js', 'tests/quote-freeze-api.test.js');PROFILE_PATH='/opt/rr-portal/deploy/backups/pr1040-quote-preflight-3/result.private.json';PROFILE_RESULT_SHA256='74e66aa72dc41bc3478361745f7f3096d2dc56781bb14dc48d5873dbbcce808d';DIRTY_PATH_COUNT=5;DIRTY_SHA256='74b8a9c5caefdc5a220f12cd14972229312beef004e76129d0fb2bb691a0507e'
OUT=None;P=None;O=None;L=None;E=None;PG_BASE_SCHEMA_SQL=None;SERIAL=0;STAGE='entry'
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
 p=pathlib.Path(__file__).with_name(name);need(p.is_file()and not p.is_symlink()and sha(p.read_bytes())==DEPS[name],'fixed-reviewed-dependency');s=importlib.util.spec_from_file_location('quote1040_'+name.replace('.','_'),p);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
def git(*a):return run(['git','-C',str(ROOT),'-c','core.hooksPath=/dev/null',*a])
def setup():
 global P,O,L,E,PG_BASE_SCHEMA_SQL
 P=load('pr1035-quote-preflight.py');O=load('release-data-ops-library.py');L=load('release-data-library.py');O.L=L;O.ROOT=ROOT;O.SCHEMAS=('internal_quote',);O.run=run;P.OUT=OUT;P.command=lambda args,limit=8*1024**2,data=None,timeout=90:run(args,data,timeout);E=load('pr1030-engineering-preflight.py');E.OUT=OUT;E.common.OUT=OUT;E.need=need;PG_BASE_SCHEMA_SQL=O.pg_schema_sql;O.pg_schema_sql=pg_schema_sql_complete
def image(name):
 rows=memory(['docker','image','inspect',name]);need(len(rows)==1 and re.fullmatch('sha256:[a-f0-9]{64}',rows[0]['Id']),'one-immutable-image');return rows[0]
def runtime():
 ids=run(['docker','ps','-aq','--no-trunc']).decode().split();need(0<len(ids)<1000 and len(ids)==len(set(ids))and all(pin(c)for c in ids),'bounded-all-container-ids');rows=memory(['docker','inspect',*ids]);need({r['Id']for r in rows}==set(ids),'all-existing-containers');value={}
 for r in rows:
  value[r['Id']]={'image':r['Image'],'config':sha(enc(r['Config'])),'hostConfig':sha(enc(r['HostConfig'])),'mounts':sorted(r['Mounts'],key=enc),'pid':r['State']['Pid'],'started':r['State']['StartedAt'],'restarts':r['RestartCount'],'running':r['State']['Running'],'oom':r['State']['OOMKilled'],'health':r['State'].get('Health',{}).get('Status')}
 target=[r for r in rows if(r['Config'].get('Labels')or{}).get('com.docker.compose.project')=='rr-portal'and(r['Config'].get('Labels')or{}).get('com.docker.compose.service')=='internal-quote'];need(len(target)==1 and target[0]['Id']==CID and target[0]['Image']==LIVE_IMAGE,'same-accepted-quote-cid-image');return value

def bind_meta(path):
 a=path.lstat();kind=next((n for f,n in((stat.S_ISREG,'REG'),(stat.S_ISDIR,'DIR'),(stat.S_ISLNK,'LNK'),(stat.S_ISSOCK,'SOCK'),(stat.S_ISFIFO,'FIFO'),(stat.S_ISCHR,'CHR'),(stat.S_ISBLK,'BLK'))if f(a.st_mode)),None);need(kind is not None,'typed-bind-source');v={'type':kind,'uid':a.st_uid,'gid':a.st_gid,'mode':stat.S_IMODE(a.st_mode)}
 if kind=='LNK':v.update(linkSHA256=sha(os.fsencode(os.readlink(path))),resolved=str(path.resolve(strict=True)),target=bind_meta(path.resolve(strict=True)))
 if kind in('CHR','BLK'):v['rdev']=a.st_rdev
 z=path.lstat();need((a.st_dev,a.st_ino,a.st_mode,a.st_uid,a.st_gid,a.st_rdev)==(z.st_dev,z.st_ino,z.st_mode,z.st_uid,z.st_gid,z.st_rdev),'stable-bind-metadata');return v

def protection(records):
 need(git('rev-parse','HEAD').decode().strip()==HOST_BASE,'host-checkout-preserved');shared={n:P.shared_file(n)for n in P.SHARED};need(all(v['sha256']==sha(git('show',HOST_BASE+':'+n))for n,v in shared.items()),'five-shared-files-match-observed-host');dirty=git('diff','--name-only','-z');staged=git('diff','--cached','--name-only','-z');need(not staged,'no-new-staged-changes');names=[n for n in dirty.decode().split('\0')if n];need(type(DIRTY_PATH_COUNT)is int and pin(DIRTY_SHA256)and len(names)==DIRTY_PATH_COUNT and sha(dirty)==DIRTY_SHA256 and not any(n.startswith(APP+'/')for n in names),'fresh-profile-existing-dirty-files-outside-quote');shared.update({n:P.shared_file(n)for n in names});env={str(p.relative_to(ROOT)):P.shared_file(str(p))for p in ROOT.glob('.env*')if p.is_file()};need('.env.cloud.production'in env and len(env)<100,'production-env-files-hash-only');binds={m['Source']:bind_meta(pathlib.Path(m['Source']))for r in records.values()for m in r['mounts']if m.get('Type')=='bind'};auth=P.gateway_auth();return {'host':HOST_BASE,'shared':shared,'dirtySHA256':sha(dirty),'env':env,'auth':auth,'binds':binds}

def source_check():
 need(all(pin(v,40)for v in(TARGET,TREE,HEAD,APP_TREE,HOST_BASE))and CODE and set(REVIEWED_FILES)==set(CODE)and all(pin(h)for h in REVIEWED_FILES.values())and REVIEWED_PATHS and TEST_FILES and EXPECTED_NATIVE_TESTS>0,'final-reviewed-source-scope-tests-and-runtime-pins-required');git('fetch','--no-write-fetch-head','origin','+refs/heads/main:refs/remotes/origin/main');need(git('rev-parse','refs/remotes/origin/main').decode().strip()==TARGET and git('rev-parse',TARGET+'^{tree}').decode().strip()==TREE,'exact-reviewed-main-tree');need(git('rev-parse',TARGET+':'+APP).decode().strip()==APP_TREE==git('rev-parse',HEAD+':'+APP).decode().strip(),'reviewed-whole-app-tree');need(git('rev-parse',HEAD+'^{tree}').decode().strip()==TREE,'reviewed-whole-tree-exact-including-squash-merge');paths=[p[len(APP)+1:]for p in git('diff','--name-only','-z',BASE,TARGET,'--',APP).decode().split('\0')if p];need(set(paths)==set(REVIEWED_PATHS),'exact-complete-reviewed-app-path-scope');production={n for n in paths if n.startswith(('backend/','frontend/'))};need(production==set(CODE)and all(re.fullmatch(r'(?:backend|frontend)/[A-Za-z0-9_./-]+',n)and '..'not in n.split('/')for n in CODE),'only-reviewed-production-code-files');need(all(n.startswith('tests/')and re.fullmatch(r'[A-Za-z0-9_./-]+',n)and '..'not in n.split('/')and pin(h)for n,h in TEST_FILES.items()),'reviewed-isolated-native-test-manifest');need(all(git('show',BASE+':'+APP+'/'+n)==git('show',TARGET+':'+APP+'/'+n)for n in('Dockerfile','package.json','package-lock.json','backend/server.js')),'unchanged-startup-build-recipe-and-dependencies');return {n:git('show',TARGET+':'+APP+'/'+n)for n in CODE}

def source(cid,label,revision):
 d=OUT/label;d.mkdir(mode=0o700);saved=P.OUT;old_target=P.TARGET;old_command=P.command;P.OUT=d;P.TARGET=revision
 def transport(args,limit=8*1024**2,data=None,timeout=90):
  if args[:6]==['docker','exec','--user','0','-i',cid]and args[6:8]==['node','-e']:
   if re.fullmatch('sha256:[a-f0-9]{64}',cid):args=['docker','run','--rm','-i','--read-only','--network','none','--restart','no','--log-driver','none','--entrypoint','node',cid,'-e',args[-1]]
  return run(args,data,timeout)
 try:P.command=transport;v=P.source_inventory(cid);detail=json.loads((d/'source-hashes.private.json').read_bytes());return v,detail['actual']
 finally:P.OUT=saved;P.TARGET=old_target;P.command=old_command

def tree_hash(cid,image_mode=False):
 args=['docker','exec','--user','0',cid,'node','-e',CODE_PROBE]if not image_mode else['docker','run','--rm','--read-only','--network','none','--restart','no','--log-driver','none','--entrypoint','node',cid,'-e',CODE_PROBE];return json.loads(run(args,timeout=240))

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

QUIET_PROBE=r"""const fs=require('fs');let connections=0,writes=0;for(const f of ['/proc/net/tcp','/proc/net/tcp6'])for(const line of fs.readFileSync(f,'utf8').trim().split('\n').slice(1)){const p=line.trim().split(/\s+/);if(parseInt(p[1].split(':').at(-1),16)===3211&&!['0A','06','07'].includes(p[3]))connections++;}for(const p of fs.readdirSync('/proc').filter(x=>/^\d+$/.test(x))){let entries;try{entries=fs.readdirSync('/proc/'+p+'/fd');}catch(e){if(e.code==='ENOENT')continue;throw e;}for(const n of entries){try{const target=fs.readlinkSync('/proc/'+p+'/fd/'+n);if(target==='/app/backend/uploads'||target.startsWith('/app/backend/uploads/')){const m=fs.readFileSync('/proc/'+p+'/fdinfo/'+n,'utf8').match(/^flags:\s+([0-7]+)$/m);if(!m)throw Error('fdflags');if(parseInt(m[1],8)&3)writes++;}}catch(e){if(!['ENOENT','ESRCH'].includes(e.code))throw e;}}}console.log(JSON.stringify({connections,writes}));"""
def quiet():
 samples=[];consecutive=0;deadline=time.monotonic()+60
 while time.monotonic()<deadline:
  sample=json.loads(run(['docker','exec','--user','0',CID,'node','-e',QUIET_PROBE],timeout=10));need(set(sample)=={'connections','writes'}and all(type(v)is int and v>=0 for v in sample.values()),'typed-quote-only-quiet-sample');samples.append(sample);consecutive=consecutive+1 if sample=={'connections':0,'writes':0}else 0
  if consecutive==3:private(OUT/'quiet.private.json',enc(samples));return samples
  time.sleep(1)
 private(OUT/'quiet.private.json',enc(samples));need(False,'bounded-quote-quiet-timeout-no-lifecycle-attempted')

NATIVE_TEST=r"""const fs=require('fs'),path=require('path'),os=require('os'),crypto=require('crypto'),cp=require('child_process');const data=JSON.parse(fs.readFileSync(0,'utf8')),dir=fs.mkdtempSync(path.join(os.tmpdir(),'quote1040-native-'));try{for(const n of ['backend','frontend','node_modules','package.json','package-lock.json'])fs.symlinkSync('/app/'+n,path.join(dir,n));for(const [n,v]of Object.entries(data.files)){if(!/^tests\/[A-Za-z0-9_./-]+$/.test(n)||n.split('/').includes('..'))throw Error('testpath');const b=Buffer.from(v.body,'base64');if(crypto.createHash('sha256').update(b).digest('hex')!==v.sha256)throw Error('testsha');const p=path.join(dir,n);fs.mkdirSync(path.dirname(p),{recursive:true,mode:0o700});fs.writeFileSync(p,b,{mode:0o600,flag:'wx'});}const out=cp.spawnSync(process.execPath,['--test','--test-reporter=tap',...Object.keys(data.files).sort()],{cwd:dir,env:{...process.env,NODE_ENV:'test',DB_DRIVER:'sqlite',DB_FILE:path.join(dir,'fixture.db'),DATABASE_URL:'',TEST_DATABASE_URL:'',SESSION_SECRET:'isolated-fixture-only'},encoding:'utf8',timeout:180000,maxBuffer:8*1024**2});fs.writeFileSync(1,out.stdout||'');fs.writeFileSync(2,out.stderr||'');if(out.status!==0)throw Error('native-test-failed');const count=k=>Number((out.stdout.match(new RegExp('^# '+k+' (\\d+)$','m'))||[])[1]);if(count('tests')!==data.expected||count('pass')!==data.expected||count('fail')!==0||count('skipped')!==0)throw Error('native-test-count-or-skip');}finally{fs.rmSync(dir,{recursive:true,force:true});}"""
def native_tests(candidate):
 files={n:{'body':__import__('base64').b64encode(git('show',TARGET+':'+APP+'/'+n)).decode(),'sha256':h}for n,h in TEST_FILES.items()};need(all(sha(__import__('base64').b64decode(v['body']))==v['sha256']for v in files.values()),'native-tests-exact-reviewed-git-bytes');run(['docker','run','--rm','-i','--network','none','--read-only','--restart','no','--log-driver','none','--tmpfs','/tmp:rw,nosuid,nodev,size=128m','--entrypoint','node',candidate,'-e',NATIVE_TEST],enc({'files':files,'expected':EXPECTED_NATIVE_TESTS}),timeout=240);return {'tests':EXPECTED_NATIVE_TESTS,'skips':0,'productionMountsOrCredentialsUsed':False,'database':'isolated-tmpfs-sqlite'}

def scratch(image_id,patch,expected):
 cid=run(['docker','create','--network','none','--restart','no','--label','io.rr-portal.pr1040-scratch='+TARGET,'--entrypoint','/bin/true',image_id]).decode().strip();need(pin(cid),'one-owned-never-started-scratch')
 try:
  row=memory(['docker','inspect',cid])[0];need(row['Image']==image_id and row['State']['Pid']==0 and row['State']['StartedAt'].startswith('0001-')and not row['Mounts']and row['HostConfig']['NetworkMode']=='none','scratch-never-started-no-mounts');run(['docker','cp','--archive','-',cid+':/app'],patch);stopped_check(cid,expected)
 finally:
  row=memory(['docker','inspect',cid])[0];need(row['Image']==image_id and not row['State']['Running']and row['State']['Pid']==0 and(row['Config'].get('Labels')or{}).get('io.rr-portal.pr1040-scratch')==TARGET,'remove-only-owned-never-started-scratch');run(['docker','rm',cid])

PG_ACCESS_SQL="""jsonb_build_object(
 'scope','internal_quote objects plus database-wide default ACLs; no role passwords',
 'schema',(SELECT jsonb_build_object('name',n.nspname,'owner',pg_get_userbyid(n.nspowner),'acl',n.nspacl::text) FROM pg_namespace n WHERE n.nspname='internal_quote'),
 'relations',COALESCE((SELECT jsonb_agg(jsonb_build_object('name',c.relname,'kind',c.relkind,'owner',pg_get_userbyid(c.relowner),'acl',c.relacl::text,'rowSecurity',c.relrowsecurity,'forceRowSecurity',c.relforcerowsecurity) ORDER BY c.relname,c.relkind) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='internal_quote'),'[]'::jsonb),
 'columns',COALESCE((SELECT jsonb_agg(jsonb_build_object('table',c.relname,'name',a.attname,'position',a.attnum,'acl',a.attacl::text) ORDER BY c.relname,a.attnum) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid WHERE n.nspname='internal_quote' AND a.attnum<>0 AND NOT a.attisdropped),'[]'::jsonb),
 'functions',COALESCE((SELECT jsonb_agg(jsonb_build_object('name',p.proname,'identityArguments',pg_get_function_identity_arguments(p.oid),'kind',p.prokind,'owner',pg_get_userbyid(p.proowner),'acl',p.proacl::text,'securityDefiner',p.prosecdef,'leakproof',p.proleakproof,'settings',p.proconfig) ORDER BY p.proname,pg_get_function_identity_arguments(p.oid),p.prokind) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='internal_quote'),'[]'::jsonb),
 'policies',COALESCE((SELECT jsonb_agg(jsonb_build_object('table',c.relname,'name',p.polname,'command',p.polcmd,'permissive',p.polpermissive,'roles',ARRAY(SELECT CASE WHEN roleid=0 THEN 'PUBLIC' ELSE pg_get_userbyid(roleid) END FROM unnest(p.polroles) AS roleid ORDER BY roleid),'using',pg_get_expr(p.polqual,p.polrelid),'withCheck',pg_get_expr(p.polwithcheck,p.polrelid)) ORDER BY c.relname,p.polname) FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='internal_quote'),'[]'::jsonb),
 'defaultACL',COALESCE((SELECT jsonb_agg(jsonb_build_object('owner',pg_get_userbyid(d.defaclrole),'schema',n.nspname,'objectType',d.defaclobjtype,'acl',d.defaclacl::text) ORDER BY pg_get_userbyid(d.defaclrole),COALESCE(n.nspname,''),d.defaclobjtype) FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid=d.defaclnamespace WHERE d.defaclnamespace=0 OR n.nspname='internal_quote'),'[]'::jsonb))"""
def pg_schema_sql_complete(schema):
 # This SELECT is called by the original pg_capture inside its same exported
 # REPEATABLE READ READ ONLY transaction; no separate privileged connection.
 need(schema=='internal_quote'and callable(PG_BASE_SCHEMA_SQL),'only-fixed-quote-permission-snapshot');base=PG_BASE_SCHEMA_SQL(schema).strip();need(base.startswith('SELECT ')and base.endswith(';')and base.count(';')==1,'pinned-single-original-schema-select');return 'WITH original_schema(value) AS ('+base[:-1]+') SELECT value || jsonb_build_object(\'accessMetadata\','+PG_ACCESS_SQL+') FROM original_schema;\n'

def full_data_root(folder):
 # E is the pinned, previously reviewed hidden-inclusive no-link-follow walker.
 # Preserve an absent root as evidence. Never mkdir or read a link target.
 need(not any(p.is_symlink()for p in folder.parents),'data-root-real-parents-only')
 try:before=folder.lstat()
 except FileNotFoundError:return {'absent':True}
 key=lambda a:(a.st_dev,a.st_ino,a.st_mode,a.st_uid,a.st_gid,a.st_size,a.st_mtime_ns,a.st_ctime_ns)
 metadata=lambda a:{'uid':a.st_uid,'gid':a.st_gid,'mode':stat.S_IMODE(a.st_mode),'mtimeNs':a.st_mtime_ns,'bytes':a.st_size}
 if stat.S_ISLNK(before.st_mode):
  target=os.fsencode(os.readlink(folder));need(key(before)==key(folder.lstat()),'stable-data-root-link-not-followed');return {'root':dict(metadata(before),type='link',linkSHA256=sha(target)),'entries':[]}
 need(stat.S_ISDIR(before.st_mode),'data-root-directory-or-link-or-absent');inventory,_=E.full_inventory(folder)
 for row in inventory['entries']:
  need(L.safe_path(row['path']),'fixed-safe-private-data-entry');p=folder/row['path'];current=p.lstat();need(all(row[k]==metadata(current)[k]for k in('uid','gid','mode','mtimeNs')),'data-entry-metadata-still-matches-captured-inventory')
  if row['type']=='dir':need(stat.S_ISDIR(current.st_mode),'data-directory-not-replaced');row['bytes']=current.st_size
  elif row['type']=='file':need(stat.S_ISREG(current.st_mode)and current.st_size==row['bytes'],'data-regular-file-size-still-captured')
  elif row['type']=='link':
   need(stat.S_ISLNK(current.st_mode),'data-link-not-replaced');target=os.fsencode(os.readlink(p));need(sha(target)==row['linkSHA256']and key(current)==key(p.lstat()),'stable-data-link-bytes-not-followed');row['bytes']=len(target)
  else:need(False,'only-fixed-data-entry-types')
 need(key(before)==key(folder.lstat()),'data-root-metadata-stable-through-capture');inventory['root']=dict(metadata(before),type='dir');return inventory

def storage(label,with_dump):
 d=OUT/label;d.mkdir(mode=0o700);pg=O.pg_capture(P.unique_service('db'),d,with_dump)['internal_quote'];roots={n:full_data_root(ROOT/APP/'backend'/n)for n in('data','legacy-data','uploads')};v={'postgres':pg,'postgresAccessSHA256':sha(enc(pg['schema']['accessMetadata'])),'roots':roots,'rootInventorySHA256':{n:sha(enc(v))for n,v in roots.items()},'startup':P.startup_counts()};private(d/'capture.private.json',enc(v));return v

def compare_storage(a,b):
 a=copy.deepcopy(a);b=copy.deepcopy(b);need(a['startup']['startupGuardEligible']and b['startup']['startupGuardEligible'],'both-startup-guards-eligible');count=a['startup']['expectedSingleStartupQuoteSectionSequenceIncrement'];need(a['startup']==b['startup'],'startup-memberships-auth-counts-still-exact');x=a['postgres']['sequenceStates']['quote_sections_id_seq'];y=b['postgres']['sequenceStates']['quote_sections_id_seq'];need(x['called']is True and y['called']is True and int(y['lastValue'])-int(x['lastValue'])==count,'exact-one-startup-quote-sections-sequence-consumption');a['postgres']['sequenceStates']['quote_sections_id_seq']=y;need(a==b,'all-other-business-auth-schema-sequences-legacy-uploads-exact')

def sealed(phase,digest):
 d=ARCHIVE/phase;need(pin(digest)and sha((d/'manifest.json').read_bytes())==digest,'sealed-prior-phase-manifest');mf=json.loads((d/'manifest.json').read_bytes());files={str(p.relative_to(d))for p in d.rglob('*')if p.is_file()and p.name!='manifest.json'};need(files==set(mf)and all(not p.is_symlink()and(p.is_file()or p.is_dir())for p in d.rglob('*')),'complete-private-evidence-files');need(all(L.safe_path(n)and L.file_hash(d/n)==h for n,h in mf.items()),'all-prior-evidence-bytes-sealed');v=json.loads((d/'result.private.json').read_bytes());need(v['success']is True and(v['target'],v['tree'],v['appTree'])==(TARGET,TREE,APP_TREE),'successful-source-bound-prior-phase');return v,d

def stable(before,protected):need(runtime()==before and protection(before)==protected,'all-original-runtime-env-auth-host-binds-still-exact')
def free_check():
 root=memory(['docker','info','--format','{{json .DockerRootDir}}']);s=os.statvfs(root);v={'available':s.f_bavail*s.f_frsize,'free':s.f_bfree*s.f_frsize};need(v['available']>=1024**3 and v['free']>=8*1024**3,'small-reviewed-overlay-one-gib-ordinary-eight-gib-physical-headroom');return v

def profile_check(before):
 p=pathlib.Path(PROFILE_PATH);need(PROFILE_PATH and p.is_absolute()and p.parent.parent==ROOT/'deploy/backups'and re.fullmatch(r'pr1040-quote-preflight-[0-9]+',p.parent.name)and p.name=='result.private.json','bound-fresh-profile-path');need(pin(PROFILE_RESULT_SHA256)and p.is_file()and not p.is_symlink()and file_hash(p)==PROFILE_RESULT_SHA256,'bound-fresh-successful-readonly-profile');v=json.loads(p.read_bytes());need(v['success']is True and v['readOnly']is True and v['sourceBaselineMain']==BASE and v['containerId']==CID and v['canonicalImage']['id']==BASE_IMAGE,'profile-same-service-source-and-accepted-alias');need(v['unstaged']['trackedPathCount']==DIRTY_PATH_COUNT and v['unstaged']['rawPathInventorySHA256']==DIRTY_SHA256 and v['staged']['trackedPathCount']==0,'profile-bound-existing-dirty-inventory');r=v['runtime'];current=before[CID];need(current['image']==LIVE_IMAGE==r['image']and current['config']==r['configSHA256']and current['hostConfig']==r['hostConfigSHA256']and sha(enc(current['mounts']))==r['mountsSHA256']and all(current[k]==r[k]for k in('pid','started','restarts','running','oom','health')),'fresh-profile-quote-runtime-contract-still-exact');return v['resultSHA256']

def prepare():
 bodies=source_check();entry();need(all(sha(bodies[n])==REVIEWED_FILES[n]for n in CODE),'exact-reviewed-code-blob-shas');before=runtime();profile=profile_check(before);need(before[CID]['running']and before[CID]['health']=='healthy'and image(ALIAS)['Id']==BASE_IMAGE,'healthy-original-runtime-and-durable-alias');protected=protection(before);private(OUT/'runtime-before.private.json',enc(before));private(OUT/'protection.private.json',enc(protected));free=free_check();need(P.startup_counts()['startupGuardEligible'],'startup-safe-before-build');actual,old=source(CID,'old-live-source',BASE);need(actual['differentFiles']==['package-lock.json'],'all-tracked-live-production-source-matches-base-except-generated-lock');novel=[n for n in CODE if n not in old]
 if novel:
  observed=json.loads(run(['docker','exec','--user','0','-i',CID,'node','-e',P.SOURCE_NODE],enc(novel)));need(set(observed)==set(novel)and all(v=={'absent':True}for v in observed.values()),'new-reviewed-code-paths-actually-absent-before-patch');old.update(observed)
 base=image(BASE_IMAGE);need(not base['Config'].get('Volumes'),'trusted-base-without-anonymous-volumes');old_sig=tree_hash(CID);need(old_sig==tree_hash(BASE_IMAGE,True),'whole-live-backend-dependencies-equal-accepted-durable');metadata={};old_bodies={};old_metadata={};context=OUT/'context';context.mkdir(mode=0o700);recipe=[];base_alias='rrportal-quote-pr1040-base:'+BASE_IMAGE.split(':')[1];probe=subprocess.run(['docker','image','inspect',base_alias],capture_output=True,timeout=30);need(probe.returncode!=0 or json.loads(probe.stdout)[0]['Id']==BASE_IMAGE,'own-base-alias-not-reassigned');need(probe.returncode==0 or b'No such image' in probe.stderr or b'No such object'in probe.stderr,'only-known-base-alias-absence')
 if probe.returncode:run(['docker','tag',BASE_IMAGE,base_alias])
 recipe.append('FROM '+base_alias)
 for i,n in enumerate(CODE):
  anchor=n if n not in novel else('frontend/main.js'if n.startswith('frontend/')else'backend/server.js');original,v=copied_file(CID,anchor);need({k:v[k]for k in('sha256','bytes','uid','gid','mode')}=={k:old[anchor][k]for k in('sha256','bytes','uid','gid','mode')},'rollback-or-new-file-anchor-exact-original-metadata')
  if n not in novel:old_bodies[n]=original;old_metadata[n]=v
  metadata[n]=dict(v,sha256=sha(bodies[n]),bytes=len(bodies[n]),mtime=max(int(time.time())+2,int(v['mtime'])+2));p=context/('code'+str(i));private(p,bodies[n]);p.chmod(v['mode']);os.utime(p,(metadata[n]['mtime'],metadata[n]['mtime']));recipe.append('COPY --chown=%d:%d %s /app/%s'%(v['uid'],v['gid'],p.name,n))
 private(OUT/'rollback-source.tar',bundle(old_bodies,old_metadata));patch=bundle(bodies,metadata);private(OUT/'patch.tar',patch);private(context/'Dockerfile',('\n'.join(recipe)+label_line()+'\n').encode());tag='rr-portal-internal-quote:pr1040-'+TARGET[:12];run(['docker','build','--network=none','--pull=false','-t',tag,str(context)],timeout=600);candidate=image(tag);a=copy.deepcopy(base['Config']);b=copy.deepcopy(candidate['Config']);a.pop('Image',None);b.pop('Image',None);labels=dict(a.get('Labels')or{});a['Labels']=dict(labels,**{'org.opencontainers.image.revision':TARGET,'io.rr-portal.quote-app-tree':APP_TREE});need(a==b and candidate['Architecture']==base['Architecture']and candidate['Os']==base['Os']and candidate['RootFS']['Layers'][:len(base['RootFS']['Layers'])]==base['RootFS']['Layers'],'derivative-exact-runtime-config-and-base-layers');new_sig=tree_hash(candidate['Id'],True);need(all(new_sig[k]==old_sig[k]for k in('nodeModules','package','lock')),'all-dependencies-package-and-generated-lock-preserved');s,new=source(candidate['Id'],'candidate-source',TARGET);need(s['differentFiles']==['package-lock.json']and all({k:new[n][k]for k in('sha256','bytes','uid','gid','mode')}=={k:metadata[n][k]for k in('sha256','bytes','uid','gid','mode')}for n in CODE),'candidate-all-source-target-and-reviewed-metadata');scratch(candidate['Id'],patch,metadata);native=native_tests(candidate['Id']);stable(before,protected);free_after=free_check();private(OUT/'candidate-source.private.json',enc(new));return {'candidate':candidate['Id'],'runtime':before,'protected':protected,'metadata':metadata,'oldSignature':old_sig,'newSignature':new_sig,'oldSource':old,'source':new,'spaceBefore':free,'spaceAfter':free_after,'sameCidCopyProvenInNeverStartedScratch':True,'nativeTests':native,'profileResultSHA256':profile,'oldAbsentPaths':novel}

def gate_record(path):
 a=path.lstat();need(stat.S_ISREG(a.st_mode)and a.st_size==0 and a.st_uid==0 and a.st_gid==0 and stat.S_IMODE(a.st_mode)==0o644,'own-empty-root-maintenance-gate');return(a.st_dev,a.st_ino,a.st_uid,a.st_gid,a.st_mode,a.st_size,a.st_mtime_ns,a.st_ctime_ns)
def health():
 for _ in range(40):
  row=memory(['docker','inspect',CID])[0]
  if row['State']['Running']and row['State'].get('Health',{}).get('Status')=='healthy':return
  time.sleep(2)
 need(False,'quote-health-after-single-start')
def deploy():
 global STAGE
 value,d=sealed('prepare',PREPARED_SHA256);p=value['details'];before=runtime();protected=protection(before);need(before==p['runtime']and protected==p['protected'],'same-prepared-runtime-and-protection');need(image(ALIAS)['Id']==BASE_IMAGE,'canonical-alias-cas-before-switch');source_check();s,_=source(CID,'preswitch-source',BASE);need(s['differentFiles']==['package-lock.json']and tree_hash(CID)==p['oldSignature'],'all-preswitch-source-exact');free_check();ingress=entry();cache_headers=old_cache_headers();private(OUT/'original-cache-headers.private.json',enc(cache_headers));path=ROOT/'deploy/maintenance/services/internal-quote';need(path.parent.is_dir()and not path.parent.is_symlink()and not path.exists()and not path.is_symlink(),'one-new-quote-service-gate');fd=os.open(path,os.O_CREAT|os.O_EXCL|os.O_WRONLY|os.O_NOFOLLOW,0o644);os.fchmod(fd,0o644);os.close(fd);owned=gate_record(path);stop_attempted=False
 try:
  private(OUT/'gate.private.json',enc(owned));entry(True,ingress);samples=quiet();need(P.startup_counts()['startupGuardEligible'],'after-gate-before-stop-startup-safe');need(runtime()==before and protection(before)==protected and image(ALIAS)['Id']==BASE_IMAGE and gate_record(path)==owned,'before-stop-all-original-contracts-and-owned-gate');stop_begin=time.time_ns();private(OUT/'stop-intent.private.json',enc({'container':CID,'beginNs':stop_begin,'automaticReplay':False}));stop_attempted=True;run(['docker','stop','--time','30',CID],timeout=90)
 except Exception:
  failed_stage=STAGE;cleanup={'lifecycleAttempted':stop_attempted,'clearedOwnUnchangedGate':False}
  if not stop_attempted:
   try:
    need(gate_record(path)==owned,'pre-stop-failure-only-own-gate-cas');path.unlink();cleanup['clearedOwnUnchangedGate']=True
   except Exception as e:cleanup['cleanupErrorType']=type(e).__name__
  private(OUT/'pre-stop-failure-gate.private.json',enc(cleanup));STAGE=failed_stage;raise
 need(not memory(['docker','inspect',CID])[0]['State']['Running'],'same-original-quote-stopped');cold=storage('cold-before',True);need(cold['startup']['startupGuardEligible'],'cold-before-startup-safe');run(['docker','cp','--archive','-',CID+':/app'],(d/'patch.tar').read_bytes());stopped_check(CID,p['metadata']);start_begin=time.time_ns();run(['docker','start',CID],timeout=90);start_end=time.time_ns();private(OUT/'single-start-window.private.json',enc({'beginNs':start_begin,'endNs':start_end,'stopBeginNs':stop_begin,'container':CID}));health();after=runtime();need(set(before)==set(after)and all(after[c]==before[c]for c in before if c!=CID),'every-other-existing-container-exact');old,new=before[CID],after[CID];need(new==dict(old,started=new['started'],pid=new['pid'],restarts=0)and new['running']and new['health']=='healthy'and old['started']!=new['started']and old['pid']!=new['pid'],'one-same-cid-manual-start-only-runtime-delta');need(start_begin<=utc_ns(new['started'])<=start_end,'manual-start-in-exact-integer-ns-command-window');s,actual=source(CID,'live-upgraded-source',TARGET);need(s['differentFiles']==['package-lock.json']and actual==p['source']and tree_hash(CID)==p['newSignature'],'all-live-source-and-original-dependencies-exact-candidate');post=storage('after-start',False);compare_storage(cold,post);need(protection(after)==protected,'all-config-env-auth-binds-preserved');need(runtime()==after and image(ALIAS)['Id']==BASE_IMAGE and gate_record(path)==owned,'final-runtime-alias-gate-cas');run(['docker','tag',p['candidate'],ALIAS]);need(image(ALIAS)['Id']==p['candidate'],'durable-canonical-promoted-once');need(gate_record(path)==owned,'own-maintenance-gate-unchanged-before-clear');path.unlink();entry(False,ingress);public_files(cache_headers);return {'candidate':p['candidate'],'runtime':after,'protected':protected,'allBusinessAuthRowsSchemaAndFilesPreserved':True,'expectedQuoteSectionsSequenceConsumption':cold['startup']['expectedSingleStartupQuoteSectionSequenceIncrement'],'singleStopCopyStart':True,'sameContainer':CID,'liveImage':LIVE_IMAGE,'durableImage':p['candidate'],'quietSamples':samples,'historicalDockerEventsNotRequiredOrClaimed':True}


def verify():
 source_check();value,_=sealed('deploy',DEPLOY_SHA256);p=value['details'];need(runtime()==p['runtime']and protection(p['runtime'])==p['protected']and image(ALIAS)['Id']==p['candidate'],'deployed-runtime-config-and-durable-alias');s,_=source(CID,'verify-live-source',TARGET);need(s['differentFiles']==['package-lock.json'],'all-current-tracked-production-source-target');need(not(ROOT/'deploy/maintenance/services/internal-quote').exists(),'quote-maintenance-cleared');need(tree_hash(CID)==sealed('prepare',PREPARED_SHA256)[0]['details']['newSignature'],'backend-and-dependencies-still-candidate');entry();public_files();return {'sameContainer':CID,'durableImage':p['candidate'],'allOtherContainersRuntimeAndEnvPreserved':True,'businessDataNotComparedAcrossUserWriteWindow':True}

def label_line():return '\nLABEL org.opencontainers.image.revision="'+TARGET+'" io.rr-portal.quote-app-tree="'+APP_TREE+'"'
def file_hash(path):
 h=hashlib.sha256()
 with path.open('rb')as f:
  for b in iter(lambda:f.read(1024**2),b''):h.update(b)
 return h.hexdigest()
def transport(value):
 raw=enc(value);need(len(raw)<=4*1024**2,'bounded-secret-free-hash-receipt');nib=lambda v:[int(x,16)for x in(format(v,'x')if type(v)is int else v)];parts=[raw[i:i+1024]for i in range(0,len(raw),1024)];digest=nib(sha(raw))
 for i,b in enumerate(parts):print(enc([0,nib(i+1),nib(len(parts)),nib(len(raw)),digest,nib(b.hex())]).decode(),flush=True)
 print(enc([1,nib(len(parts)),nib(len(raw)),digest]).decode(),flush=True)

def http(path,headers=None):
 need(path in('/','/paiji/health','/indo-shipping/api/health','/sprayplan/api/health','/internal-quote/','/internal-quote/health','/internal-quote/api/auth/me')or path in['/internal-quote/'+n.split('/')[-1]for n in CODE if n.startswith('frontend/')],'fixed-local-readonly-http-path');request=urllib.request.Request('http://127.0.0.1'+path,headers=headers or{})
 try:r=urllib.request.urlopen(request,timeout=20)
 except urllib.error.HTTPError as e:r=e
 with r:body=r.read(8*1024**2+1);need(len(body)<=8*1024**2,'bounded-public-http');return {'status':r.status,'sha256':sha(body),'headers':{k:r.headers.get(k)for k in('ETag','Last-Modified')}}
def entry(maintained=False,baseline=None):
 result={p:http(p)['status']for p in('/','/paiji/health','/indo-shipping/api/health','/sprayplan/api/health','/internal-quote/health','/internal-quote/api/auth/me','/internal-quote/')};need(result['/']in(200,401)and all(result[p]==200 for p in('/paiji/health','/indo-shipping/api/health','/sprayplan/api/health')),'portal-other-services-available');need(result['/internal-quote/health']==(503 if maintained else 200)and result['/internal-quote/api/auth/me']==(503 if maintained else 401)and result['/internal-quote/']in((503,)if maintained else(200,401)),'quote-only-maintenance-http-boundary')
 if baseline:need(all(result[p]==baseline[p]for p in('/','/paiji/health','/indo-shipping/api/health','/sprayplan/api/health')),'other-portal-ingress-statuses-unchanged')
 return result
def old_cache_headers():return {n:http('/internal-quote/'+n.split('/')[-1])['headers']for n in CODE if n.startswith('frontend/')}
def public_files(previous=None):
 for n in CODE:
  if not n.startswith('frontend/'):continue
  url='/internal-quote/'+n.split('/')[-1];need(http(url)['status']==200 and http(url)['sha256']==REVIEWED_FILES[n],'all-reviewed-public-static-files-exact-target')
  if previous:
   for key,header in(('ETag','If-None-Match'),('Last-Modified','If-Modified-Since')):
    if previous[n][key]:v=http(url,{header:previous[n][key]});need(v['status']==200 and v['sha256']==REVIEWED_FILES[n],'old-cache-validator-receives-new-bytes')

def main():
 global OUT
 need(EXECUTE is True and PHASE in('prepare','deploy','verify')and sys.argv[1:]==[PHASE]and os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_MODE')==PHASE and os.environ.get('RELEASE_ATTEMPT')=='1','explicit-one-shot-reviewed-phase-only');os.umask(0o077);need(ARCHIVE.parent.is_dir()and not ARCHIVE.parent.is_symlink(),'private-parent');ARCHIVE.mkdir(mode=0o700,exist_ok=True);OUT=ARCHIVE/PHASE;need(not OUT.exists()and not OUT.is_symlink(),'fresh-private-phase-no-replay');OUT.mkdir(mode=0o700);v={'service':'internal-quote','mode':PHASE,'resultPath':str(OUT/'result.private.json'),'phase':PHASE,'base':BASE,'head':HEAD,'target':TARGET,'tree':TREE,'appTree':APP_TREE,'hostBase':HOST_BASE,'success':False,'hostSourceCheckoutPerformed':False,'automaticMutationRetry':False,'credentialsChanged':False,'allNonQuoteServicesLifecycleOperated':False}
 try:
  setup();v['details']={'prepare':prepare,'deploy':deploy,'verify':verify}[PHASE]();v['success']=True
 except Exception as e:v.update(errorType=type(e).__name__,stage=STAGE,dependencyStage=None if O is None else O.STAGE)
 v['resultSHA256']=sha(enc(v));private(OUT/'result.private.json',enc(v));files=list(OUT.rglob('*'));need(all(not p.is_symlink()and(p.is_file()or p.is_dir())for p in files),'regular-private-phase-evidence');manifest={str(p.relative_to(OUT)):file_hash(p)for p in files if p.is_file()};private(OUT/'manifest.json',enc(manifest));digest=sha(enc(manifest));receipt={'result':v,'manifestSHA256':digest,'preparedSHA256'if PHASE=='prepare'else'deployEvidenceSHA256':digest};transport(receipt);return 0 if v['success']else 1

if __name__=='__main__':sys.exit(main())
