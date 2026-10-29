"""INERT single-Quote release draft: small durable COPY overlay + one same-CID restart.
No host checkout, npm/APK, other-service lifecycle, DB restore or automatic replay.
Final reviewed source hashes are intentionally unbound until root review.
"""
import base64,copy,datetime,hashlib,importlib.util,io,json,os,pathlib,re,stat,subprocess,sys,tarfile,time,urllib.request,urllib.error
ROOT=pathlib.Path('/opt/rr-portal');ARCHIVE=ROOT/'deploy/backups/pr1035-quote-20261029'
APP='apps/业务部/内部报价系统';HOST_BASE='f22fbffa1789234fe1c78bf776f4dcb3fe867d0c';BASE=HOST_BASE
TARGET='b81980e6970f5a248f50068b4c6ceeb1398930c4';TREE='dfc42e0703e4fc181dc0b9e3e572702cd5d04e8e';HEAD='98f6b572e3d0b59b08a3f3a7ab8e91aa0a6a9ed0';APP_TREE='1c8e0dcef30e7e62726fddf8bbb301fe86ba9eda';PHASE='prepare';PREPARED_SHA256='';DEPLOY_SHA256='';EXECUTE=True
BRANCH='refs/heads/ops/pr-1035-20261029-quote';ALIAS='rr-portal-internal-quote:latest'
CID='0cfa8edaff44bbc74b4443b6dec444c90e2f115833ff9913abf8c9b6c462ef7a'
LIVE_IMAGE='sha256:adf5b723ca5f8edae60a0a0f12a3828b8cd488a99eeee6405b61092805620294'
BASE_IMAGE='sha256:783e150ceff4be287adf89e26b5385a7dac3a23b00925982bd3243cbdff8250a'
CODE=('backend/services/exportXlsx.js','backend/services/quoteCostSummary.js','backend/services/quoteSummary.js','backend/services/verificationSummary.js','backend/services/legacyFormula.js','frontend/quote.html','frontend/sewing-tax.js','frontend/verification.html','frontend/workbench.js')
REVIEWED_FILES={'backend/services/exportXlsx.js': '3931495da44a98a930d708f845f02c5ac5605f78b94dafb0e1c997778fe3ba6f', 'backend/services/legacyFormula.js': '8d5fb2c8cb91f1d60de6914e938eabad656cba0e8c0f34673ef66f91de45c8f6', 'backend/services/quoteCostSummary.js': 'd446dd2c7648113f3c4523241e7d3f00469787e8e8bf35db69175f2421b52407', 'backend/services/quoteSummary.js': 'ebafe98585240834ff2f574b50cfb8011eaf4ef93a550d9caa5bc10c29e1b392', 'backend/services/verificationSummary.js': '27bdb56c9fb74de4f2fef4031f09ef9ad48a28e2a1d25f6e07a10e4ab198cafc', 'frontend/quote.html': '943ce53e503a8c817c1967a037c55e69a72d6308ce2600081489f842546f3da1', 'frontend/sewing-tax.js': '87bcafb659f71c0803dcf0b6c1e7e093cb49be4c63b847c1d1e9dccee5275493', 'frontend/verification.html': '4861f2db38a8b5fe37050a4f503d5cbc377ca0bd3c5e1c9478bbc77fc9429752', 'frontend/workbench.js': '3bb61ad1695bdf19505c7c6fb235586b132506fa972089350cd4122e7d1e088c'}
DEPS={'pr1035-quote-preflight.py':'2b2739aa00cad03bfce8472b7416d725364b8d4ed354a5a7e9ca905a47aaffa5','release-data-ops-library.py':'ff9138a1d5bfed1b10077112da6ebcda2d65240f583e2d0e12ce1325cfbaafd5','release-data-library.py':'d63168fd3057f4f2aba2d93f9fab31d2d65c6dd0f3234877d71fcff1e04e62b9'}
CODE_PROBE="const fs=require('fs'),path=require('path'),crypto=require('crypto');\nconst h=b=>crypto.createHash('sha256').update(b).digest('hex');\nfunction tree(root,omit=[]){let a=[],bytes=0;function walk(p,n){let s=fs.lstatSync(p),v={n,uid:s.uid,gid:s.gid,mode:s.mode&4095};\nif(s.isSymbolicLink()){v.type='link';v.target=fs.readlinkSync(p);}else if(s.isDirectory()){v.type='dir';a.push(v);for(let x of fs.readdirSync(p).sort()){if(n===''&&omit.includes(x))continue;walk(path.join(p,x),n?n+'/'+x:x);}return;}else if(s.isFile()){v.type='file';v.size=s.size;bytes+=s.size;v.sha256=h(fs.readFileSync(p));}else throw Error('unsupported-code-kind');a.push(v);if(a.length>100000||bytes>1024**3)throw Error('bounded-code');}\nif(!fs.existsSync(root))return {absent:true};walk(root,'');return {sha256:h(JSON.stringify(a)),entries:a.length,bytes};}\nconsole.log(JSON.stringify({backend:tree('/app/backend',['data','legacy-data','uploads','data.db','data.db-shm','data.db-wal']),nodeModules:tree('/app/node_modules'),package:tree('/app/package.json'),lock:tree('/app/package-lock.json')}));"
OUT=None;P=None;O=None;L=None;SERIAL=0;STAGE='entry'
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
def setup():
 global P,O,L
 P=load('pr1035-quote-preflight.py');O=load('release-data-ops-library.py');L=load('release-data-library.py');O.L=L;O.ROOT=ROOT;O.SCHEMAS=('internal_quote',);O.run=run;P.OUT=OUT;P.command=lambda args,limit=8*1024**2,data=None,timeout=90:run(args,data,timeout)
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
 need(git('rev-parse','HEAD').decode().strip()==HOST_BASE,'host-checkout-preserved');shared={n:P.shared_file(n)for n in P.SHARED};need(all(v['sha256']==sha(git('show',HOST_BASE+':'+n))for n,v in shared.items()),'five-shared-files-match-observed-host');dirty=git('diff','--name-only','-z');staged=git('diff','--cached','--name-only','-z');need(not staged,'no-new-staged-changes');names=[n for n in dirty.decode().split('\0')if n];need(len(names)==4 and not any(n.startswith(APP+'/')for n in names),'four-existing-dirty-files-outside-quote');shared.update({n:P.shared_file(n)for n in names});env={str(p.relative_to(ROOT)):P.shared_file(str(p))for p in ROOT.glob('.env*')if p.is_file()};need('.env.cloud.production'in env and len(env)<100,'production-env-files-hash-only');binds={m['Source']:bind_meta(pathlib.Path(m['Source']))for r in records.values()for m in r['mounts']if m.get('Type')=='bind'};auth=P.gateway_auth();return {'host':HOST_BASE,'shared':shared,'dirtySHA256':sha(dirty),'env':env,'auth':auth,'binds':binds}

def source_check():
 need(all(pin(v,40)for v in(TARGET,TREE,HEAD,APP_TREE))and set(REVIEWED_FILES)==set(CODE)and all(pin(h)for h in REVIEWED_FILES.values()),'final-reviewed-source-pins-required');git('fetch','--no-write-fetch-head','origin','+refs/heads/main:refs/remotes/origin/main');need(git('rev-parse','refs/remotes/origin/main').decode().strip()==TARGET and git('rev-parse',TARGET+'^{tree}').decode().strip()==TREE,'exact-reviewed-main-tree');need(git('rev-parse',TARGET+':'+APP).decode().strip()==APP_TREE==git('rev-parse',HEAD+':'+APP).decode().strip(),'reviewed-whole-app-tree');git('merge-base','--is-ancestor',HEAD,TARGET);paths=[p for p in git('diff','--name-only','-z',BASE,TARGET,'--',APP).decode().split('\0')if p];production={p[len(APP)+1:]for p in paths if not p.startswith(APP+'/tests/')};need(production==set(CODE),'only-fixed-nine-production-files');return {n:git('show',TARGET+':'+APP+'/'+n)for n in CODE}

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
  for n in CODE:
   need(n in bodies and sha(bodies[n])==metadata[n]['sha256'],'bundle-exact-reviewed-bytes');m=tarfile.TarInfo(n);m.uid=metadata[n]['uid'];m.gid=metadata[n]['gid'];m.mode=metadata[n]['mode'];m.size=len(bodies[n]);m.mtime=metadata[n]['mtime'];t.addfile(m,io.BytesIO(bodies[n]))
 return b.getvalue()

def stopped_check(cid,expected):
 for n in CODE:
  _,v=copied_file(cid,n);need(v==expected[n],'stopped-source-bytes-owner-mode-readback')

def scratch(image_id,patch,expected):
 cid=run(['docker','create','--network','none','--restart','no','--label','io.rr-portal.pr1035-scratch='+TARGET,'--entrypoint','/bin/true',image_id]).decode().strip();need(pin(cid),'one-owned-never-started-scratch')
 try:
  row=memory(['docker','inspect',cid])[0];need(row['Image']==image_id and row['State']['Pid']==0 and row['State']['StartedAt'].startswith('0001-')and not row['Mounts']and row['HostConfig']['NetworkMode']=='none','scratch-never-started-no-mounts');run(['docker','cp','--archive','-',cid+':/app'],patch);stopped_check(cid,expected)
 finally:
  row=memory(['docker','inspect',cid])[0];need(row['Image']==image_id and not row['State']['Running']and row['State']['Pid']==0 and(row['Config'].get('Labels')or{}).get('io.rr-portal.pr1035-scratch')==TARGET,'remove-only-owned-never-started-scratch');run(['docker','rm',cid])

def storage(label,with_dump):
 d=OUT/label;d.mkdir(mode=0o700);pg=O.pg_capture(P.unique_service('db'),d,with_dump)['internal_quote'];roots={n:L.non_database_inventory(ROOT/APP/'backend'/n,[])for n in('data','uploads')};v={'postgres':pg,'roots':roots,'startup':P.startup_counts()};private(d/'capture.private.json',enc(v));return v

def compare_storage(a,b):
 a=copy.deepcopy(a);b=copy.deepcopy(b);need(a['startup']['startupGuardEligible']and b['startup']['startupGuardEligible'],'both-startup-guards-eligible');count=a['startup']['expectedSingleStartupQuoteSectionSequenceIncrement'];need(a['startup']==b['startup'],'startup-memberships-auth-counts-still-exact');x=a['postgres']['sequenceStates']['quote_sections_id_seq'];y=b['postgres']['sequenceStates']['quote_sections_id_seq'];need(x['called']is True and y['called']is True and int(y['lastValue'])-int(x['lastValue'])==count,'exact-one-startup-quote-sections-sequence-consumption');a['postgres']['sequenceStates']['quote_sections_id_seq']=y;need(a==b,'all-other-business-auth-schema-sequences-legacy-uploads-exact')

def sealed(phase,digest):
 d=ARCHIVE/phase;need(pin(digest)and sha((d/'manifest.json').read_bytes())==digest,'sealed-prior-phase-manifest');mf=json.loads((d/'manifest.json').read_bytes());files={str(p.relative_to(d))for p in d.rglob('*')if p.is_file()and p.name!='manifest.json'};need(files==set(mf)and all(not p.is_symlink()and(p.is_file()or p.is_dir())for p in d.rglob('*')),'complete-private-evidence-files');need(all(L.safe_path(n)and L.file_hash(d/n)==h for n,h in mf.items()),'all-prior-evidence-bytes-sealed');v=json.loads((d/'result.private.json').read_bytes());need(v['success']is True and(v['target'],v['tree'],v['appTree'])==(TARGET,TREE,APP_TREE),'successful-source-bound-prior-phase');return v,d

def stable(before,protected):need(runtime()==before and protection(before)==protected,'all-original-runtime-env-auth-host-binds-still-exact')
def free_check():
 root=memory(['docker','info','--format','{{json .DockerRootDir}}']);s=os.statvfs(root);v={'available':s.f_bavail*s.f_frsize,'free':s.f_bfree*s.f_frsize};need(v['available']>=1024**3 and v['free']>=8*1024**3,'small-nine-file-overlay-one-gib-ordinary-eight-gib-physical-headroom');return v

def prepare():
 bodies=source_check();entry();need(all(sha(bodies[n])==REVIEWED_FILES[n]for n in CODE),'exact-reviewed-nine-blob-shas');before=runtime();need(before[CID]['running']and before[CID]['health']=='healthy'and image(ALIAS)['Id']==BASE_IMAGE,'healthy-original-runtime-and-durable-alias');protected=protection(before);private(OUT/'runtime-before.private.json',enc(before));private(OUT/'protection.private.json',enc(protected));free=free_check();need(P.startup_counts()['startupGuardEligible'],'startup-safe-before-build');actual,old=source(CID,'old-live-source',BASE);need(actual['differentFiles']==['package-lock.json'],'all-tracked-live-production-source-matches-base-except-generated-lock');base=image(BASE_IMAGE);need(not base['Config'].get('Volumes'),'trusted-base-without-anonymous-volumes');old_sig=tree_hash(CID);need(old_sig==tree_hash(BASE_IMAGE,True),'whole-live-backend-dependencies-equal-accepted-durable');metadata={};old_bodies={};old_metadata={};context=OUT/'context';context.mkdir(mode=0o700);recipe=[];base_alias='rrportal-quote-pr1035-base:'+BASE_IMAGE.split(':')[1];probe=subprocess.run(['docker','image','inspect',base_alias],capture_output=True,timeout=30);need(probe.returncode!=0 or json.loads(probe.stdout)[0]['Id']==BASE_IMAGE,'own-base-alias-not-reassigned');need(probe.returncode==0 or b'No such image' in probe.stderr or b'No such object'in probe.stderr,'only-known-base-alias-absence')
 if probe.returncode:run(['docker','tag',BASE_IMAGE,base_alias])
 recipe.append('FROM '+base_alias)
 for i,n in enumerate(CODE):
  original,v=copied_file(CID,n);need({k:v[k]for k in('sha256','bytes','uid','gid','mode')}=={k:old[n][k]for k in('sha256','bytes','uid','gid','mode')},'rollback-source-exact-original-metadata');old_bodies[n]=original;old_metadata[n]=v;metadata[n]=dict(v,sha256=sha(bodies[n]),bytes=len(bodies[n]),mtime=max(int(time.time())+2,int(v['mtime'])+2));p=context/('code'+str(i));private(p,bodies[n]);p.chmod(v['mode']);os.utime(p,(metadata[n]['mtime'],metadata[n]['mtime']));recipe.append('COPY --chown=%d:%d %s /app/%s'%(v['uid'],v['gid'],p.name,n))
 private(OUT/'rollback-source.tar',bundle(old_bodies,old_metadata));patch=bundle(bodies,metadata);private(OUT/'patch.tar',patch);private(context/'Dockerfile',('\n'.join(recipe)+label_line()+'\n').encode());tag='rr-portal-internal-quote:pr1035-'+TARGET[:12];run(['docker','build','--network=none','--pull=false','-t',tag,str(context)],timeout=600);candidate=image(tag);a=copy.deepcopy(base['Config']);b=copy.deepcopy(candidate['Config']);a.pop('Image',None);b.pop('Image',None);labels=dict(a.get('Labels')or{});a['Labels']=dict(labels,**{'org.opencontainers.image.revision':TARGET,'io.rr-portal.quote-app-tree':APP_TREE});need(a==b and candidate['Architecture']==base['Architecture']and candidate['Os']==base['Os']and candidate['RootFS']['Layers'][:len(base['RootFS']['Layers'])]==base['RootFS']['Layers'],'derivative-exact-runtime-config-and-base-layers');new_sig=tree_hash(candidate['Id'],True);need(all(new_sig[k]==old_sig[k]for k in('nodeModules','package','lock')),'all-dependencies-package-and-generated-lock-preserved');s,new=source(candidate['Id'],'candidate-source',TARGET);need(s['differentFiles']==['package-lock.json']and all({k:new[n][k]for k in('sha256','bytes','uid','gid','mode')}=={k:metadata[n][k]for k in('sha256','bytes','uid','gid','mode')}for n in CODE),'candidate-all-source-target-and-nine-file-metadata');scratch(candidate['Id'],patch,metadata);tests=OUT/'tests';tests.mkdir(mode=0o755);test=tests/'sewing-tax.test.js';private(test,git('show',TARGET+':'+APP+'/tests/sewing-tax.test.js'));test.chmod(0o644);run(['docker','run','--rm','--network','none','--read-only','--restart','no','--log-driver','none','--mount','type=bind,source='+str(tests)+',target=/app/tests,readonly','--entrypoint','node',candidate['Id'],'--test','/app/tests/sewing-tax.test.js'],timeout=300);stable(before,protected);free_after=free_check();private(OUT/'candidate-source.private.json',enc(new));return {'candidate':candidate['Id'],'runtime':before,'protected':protected,'metadata':metadata,'oldSignature':old_sig,'newSignature':new_sig,'oldSource':old,'source':new,'spaceBefore':free,'spaceAfter':free_after,'sameCidCopyProvenInNeverStartedScratch':True}

def gate_record(path):
 a=path.lstat();need(stat.S_ISREG(a.st_mode)and a.st_size==0 and a.st_uid==0 and a.st_gid==0 and stat.S_IMODE(a.st_mode)==0o644,'own-empty-root-maintenance-gate');return(a.st_dev,a.st_ino,a.st_uid,a.st_gid,a.st_mode,a.st_size,a.st_mtime_ns,a.st_ctime_ns)
def health():
 for _ in range(40):
  row=memory(['docker','inspect',CID])[0]
  if row['State']['Running']and row['State'].get('Health',{}).get('Status')=='healthy':return
  time.sleep(2)
 need(False,'quote-health-after-single-start')
def deploy():
 value,d=sealed('prepare',PREPARED_SHA256);p=value['details'];before=runtime();protected=protection(before);need(all(before[c]==p['runtime'][c]for c in before)and set(before)==set(p['runtime'])and protected==p['protected'],'same-prepared-runtime-and-protection');need(image(ALIAS)['Id']==BASE_IMAGE,'canonical-alias-cas-before-switch');source_check();s,_=source(CID,'preswitch-source',BASE);need(s['differentFiles']==['package-lock.json']and tree_hash(CID)==p['oldSignature'],'all-preswitch-source-exact');free_check();ingress=entry();cache_headers=old_cache_headers();path=ROOT/'deploy/maintenance/services/internal-quote';need(path.parent.is_dir()and not path.parent.is_symlink()and not path.exists()and not path.is_symlink(),'one-new-quote-service-gate');fd=os.open(path,os.O_CREAT|os.O_EXCL|os.O_WRONLY|os.O_NOFOLLOW,0o644);os.fchmod(fd,0o644);os.close(fd);owned=gate_record(path);private(OUT/'gate.private.json',enc(owned));entry(True,ingress);time.sleep(60);need(P.startup_counts()['startupGuardEligible'],'after-gate-before-stop-startup-safe');start_window=datetime.datetime.now(datetime.timezone.utc).isoformat();private(OUT/'stop-start-window.private.json',enc({'begin':start_window}));run(['docker','stop','--time','30',CID],timeout=90);need(not memory(['docker','inspect',CID])[0]['State']['Running'],'same-original-quote-stopped');cold=storage('cold-before',True);need(cold['startup']['startupGuardEligible'],'cold-before-startup-safe');run(['docker','cp','--archive','-',CID+':/app'],(d/'patch.tar').read_bytes());stopped_check(CID,p['metadata']);run(['docker','start',CID],timeout=90);health();after=runtime();need(set(before)==set(after)and all(after[c]==before[c]for c in before if c!=CID),'every-other-existing-container-exact');old,new=before[CID],after[CID];expected=dict(old,started=new['started'],pid=new['pid'],restarts=0);need(new==expected and new['running']and new['health']=='healthy'and old['started']!=new['started']and old['pid']!=new['pid'],'one-same-cid-manual-start-only-runtime-delta');begin=datetime.datetime.fromisoformat(start_window).timestamp();started=datetime.datetime.fromisoformat(new['started'].replace('Z','+00:00')).timestamp();need(begin<=started<=time.time(),'manual-start-in-current-operation-window');s,actual=source(CID,'live-upgraded-source',TARGET);need(s['differentFiles']==['package-lock.json']and actual==p['source']and tree_hash(CID)==p['newSignature'],'all-live-source-and-original-dependencies-exact-candidate');post=storage('after-start',False);compare_storage(cold,post);need(protection(after)==protected,'all-config-env-auth-binds-preserved');need(runtime()==after and image(ALIAS)['Id']==BASE_IMAGE and gate_record(path)==owned,'final-runtime-alias-gate-cas');run(['docker','tag',p['candidate'],ALIAS]);need(image(ALIAS)['Id']==p['candidate'],'durable-canonical-promoted-once');need(gate_record(path)==owned,'own-maintenance-gate-unchanged-before-clear');path.unlink();entry(False,ingress);public_files(cache_headers);return {'candidate':p['candidate'],'runtime':after,'protected':protected,'allBusinessAuthRowsSchemaAndFilesPreserved':True,'expectedQuoteSectionsSequenceConsumption':cold['startup']['expectedSingleStartupQuoteSectionSequenceIncrement'],'singleStopCopyStart':True,'sameContainer':CID,'liveImage':LIVE_IMAGE,'durableImage':p['candidate']}

def verify():
 source_check();value,_=sealed('deploy',DEPLOY_SHA256);p=value['details'];need(runtime()==p['runtime']and protection(p['runtime'])==p['protected']and image(ALIAS)['Id']==p['candidate'],'deployed-runtime-config-and-durable-alias');s,_=source(CID,'verify-live-source',TARGET);need(s['differentFiles']==['package-lock.json'],'all-current-tracked-production-source-target');need(not(ROOT/'deploy/maintenance/services/internal-quote').exists(),'quote-maintenance-cleared');need(tree_hash(CID)==sealed('prepare',PREPARED_SHA256)[0]['details']['newSignature'],'backend-and-dependencies-still-candidate');entry();public_files();return {'sameContainer':CID,'durableImage':p['candidate'],'allOtherContainersRuntimeAndEnvPreserved':True,'businessDataNotComparedAcrossUserWriteWindow':True}

def label_line():return '\nLABEL org.opencontainers.image.revision="'+TARGET+'" io.rr-portal.quote-app-tree="'+APP_TREE+'"'
def file_hash(path):
 h=hashlib.sha256()
 with path.open('rb')as f:
  for b in iter(lambda:f.read(1024**2),b''):h.update(b)
 return h.hexdigest()
def transport(value):
 raw=enc(value);need(len(raw)<=4*1024**2,'bounded-secret-free-hash-receipt');payload=base64.b64encode(raw).decode();chunks=[payload[i:i+5000]for i in range(0,len(payload),5000)]
 for i,b in enumerate(chunks):print(enc({'kind':'result-part','part':i+1,'total':len(chunks),'fullSha256':sha(raw),'encoding':'base64','data':b}).decode(),flush=True)
 print(enc({'kind':'result-receipt','bytes':len(raw),'fullSha256':sha(raw),'parts':len(chunks),'mode':value['mode'],'resultPath':value['resultPath']}).decode(),flush=True)
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
  url='/internal-quote/'+n.split('/')[-1];need(http(url)['status']==200 and http(url)['sha256']==REVIEWED_FILES[n],'all-four-public-static-files-exact-target')
  if previous:
   for key,header in(('ETag','If-None-Match'),('Last-Modified','If-Modified-Since')):
    if previous[n][key]:v=http(url,{header:previous[n][key]});need(v['status']==200 and v['sha256']==REVIEWED_FILES[n],'old-cache-validator-receives-new-bytes')

def main():
 global OUT
 need(EXECUTE is True and PHASE in('prepare','deploy','verify')and sys.argv[1:]==[PHASE]and os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_MODE')==PHASE and os.environ.get('RELEASE_ATTEMPT')=='1','explicit-one-shot-reviewed-phase-only');os.umask(0o077);need(ARCHIVE.parent.is_dir()and not ARCHIVE.parent.is_symlink(),'private-parent');ARCHIVE.mkdir(mode=0o700,exist_ok=True);OUT=ARCHIVE/PHASE;need(not OUT.exists()and not OUT.is_symlink(),'fresh-private-phase-no-replay');OUT.mkdir(mode=0o700);v={'mode':PHASE,'resultPath':str(OUT/'result.private.json'),'phase':PHASE,'base':BASE,'head':HEAD,'target':TARGET,'tree':TREE,'appTree':APP_TREE,'hostBase':HOST_BASE,'success':False,'hostSourceCheckoutPerformed':False,'automaticMutationRetry':False,'credentialsChanged':False,'allNonQuoteServicesLifecycleOperated':False}
 try:
  setup();v['details']={'prepare':prepare,'deploy':deploy,'verify':verify}[PHASE]();v['success']=True
 except Exception as e:v.update(errorType=type(e).__name__,stage=STAGE,dependencyStage=None if O is None else O.STAGE)
 private(OUT/'result.private.json',enc(v));files=list(OUT.rglob('*'));need(all(not p.is_symlink()and(p.is_file()or p.is_dir())for p in files),'regular-private-phase-evidence');manifest={str(p.relative_to(OUT)):file_hash(p)for p in files if p.is_file()};private(OUT/'manifest.json',enc(manifest));digest=sha(enc(manifest));receipt=dict(v,resultSHA256=sha(enc(v)),manifestSHA256=digest);receipt['preparedSHA256'if PHASE=='prepare'else'deployEvidenceSHA256']=digest;transport(receipt);return 0 if v['success']else 1

if __name__=='__main__':sys.exit(main())
