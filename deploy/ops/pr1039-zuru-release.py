"""INERT self-contained orchestration for ZURU only; source pins await root binding.
Read-only/metadata helpers are loaded only from pinned inert source dependencies.
"""
import ast,copy,datetime,decimal,hashlib,importlib.util,io,json,os,pathlib,re,shutil,stat,subprocess,sys,tarfile,time,uuid,urllib.request,urllib.error,urllib.parse
ROOT=pathlib.Path('/opt/rr-portal');APP='apps/业务部/ZURU接单表入单系统';SERVICE='zuru-order-system';ALIAS='rr-portal-zuru-order-system:latest'
ARCHIVE=ROOT/'deploy/backups/pr1039-zuru-20261029';BRANCH='refs/heads/ops/pr-1039-20261029-zuru'
EXECUTE=True;PHASE='verify';BASE='91178c35b2013d32dc02808ece1d81924d567d0d';TARGET='80e027a75f306f1fff50033672c52201dc4ab0bf';TREE='e656fb8aed5d980a575e26a4169bd8166806846b';HEAD='c5c8f6d82de4c41ef274f86d85cd477c5ccaa32c';APP_TREE='071383600c9727e449dbf98b36edc2c2d893e41e';REVIEWED_FILES={'app.py': 'f99e7f57c13ee5348c78b6b32fe53d1bcf089fd50b67721a2e48d03ef910b4bb', 'po_parser.py': '2d5cce76ee11860f95805e50c0729e89d37c9d6eaff772cb10f2ff850b928c7d', 'data/item_map.json': '6ac0a5ca8d64bc1bdc42c4fd436046367d85ec1ff828dd666925c96d924b0bd0', 'tests/test_parser_1039.py': '387c2558a9fa17e61bc739c7340994ee7dbc14241e9de8735b69b8dd2e166b3c', 'tests/test_pr1039_app.py': 'cbab2586ccf7c38ca7245a29d2637afc8da0fa941c694268fc863dc10cef4723'};PREPARED_SHA256='10841dcb67c079d669c52202e629520e93ebf5b79e511d1ed4eeb7fc00079839';DEPLOY_SHA256='b7e537b22262cd170a5a2d62c2e5b68bcb4767896f8a4c15249be91e41980ee6'
SWITCH_NAME='pr1039-zuru-switch.py';SWITCH_SHA256='dd2b2697694b07ee93d54e09da8effcb2577f0786847ce0dc35a339cdeeedc31'
SOURCE_BASE='91178c35b2013d32dc02808ece1d81924d567d0d';HOST_BASE='f22fbffa1789234fe1c78bf776f4dcb3fe867d0c'
CID='fdc50a796100afe772b0e85ec4256ab5f9e7cf7de7b14b77903374f16357f47b';BASE_IMAGE='sha256:46140168b2a10082ea6ac102a472411eaabd34e5164857523ba1618e336412fa'
PROFILE=ROOT/'deploy/backups/pr1039-zuru-preflight-1/result.private.json';PROFILE_FILE_SHA='87259d5ea17b1dba8ac8e9a8d7b52fc73f30eb55607d0dd1eafbd50a44bc4d74';PROFILE_RESULT_SHA='d2359444f7c3aca2ee1db09c162bc6d613b1158b647737d2990607e4084cace9'
DEPS={'pr1039-zuru-preflight.py':'6cc564926777e9a042cc80a23598838917b6e1518bb378b4576e81dbda8d2367','pr1035-quote-preflight.py':'2b2739aa00cad03bfce8472b7416d725364b8d4ed354a5a7e9ca905a47aaffa5','pr1030-engineering-preflight.py':'3d06b2aef715f75740826ff75f91c1cb78e0927e030717795ef2733f0595a4d0'}
PRODUCTION=('app.py','po_parser.py','requirements.txt','templates/index.html');PATCH=('app.py','po_parser.py');PUBLIC_DATA=('data/country_map.json','data/customer_country.json','data/ignore_items.json','data/item_map.json');TESTS=('tests/test_parser_1039.py','tests/test_pr1039_app.py','tests/test_review_regressions.py')
MIN_AVAILABLE=512*1024**2;MIN_FREE=4*1024**3;OUT=None;Q=None;P=None;E=None;SERIAL=0;STAGE='entry'

def need(v,label):
 global STAGE
 STAGE=label
 if not v:raise RuntimeError(label)

def enc(v):return json.dumps(v,sort_keys=True,separators=(',',':'),ensure_ascii=True,allow_nan=False).encode()

def sha(b):return hashlib.sha256(b).hexdigest()

def pin(v,n=64):return type(v)is str and re.fullmatch('[a-f0-9]{%d}'%n,v)is not None

def private(p,b):
 p=pathlib.Path(p);p=p if p.is_absolute()else OUT/p;b=b if type(b)is bytes else enc(b)
 need(safe(p.relative_to(OUT).as_posix())and not any(q.is_symlink()for q in(p.parent,*p.parent.parents)if q==OUT or OUT in q.parents),'private-write-only-inside-own-output')
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

def git(*a):return run(['git','-C',str(ROOT),'-c','core.hooksPath=/dev/null',*a])

def image(name):
 rows=memory(['docker','image','inspect',name]);need(len(rows)==1 and re.fullmatch('sha256:[a-f0-9]{64}',rows[0]['Id']),'one-immutable-image');return rows[0]

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
 raw=enc(value);need(len(raw)<=4*1024**2,'bounded-secret-free-numeric-receipt')
 def nib(v):return [int(x,16)for x in(format(v,'x')if type(v)is int else v)]
 chunks=[raw[i:i+1024]for i in range(0,len(raw),1024)];digest=nib(sha(raw))
 for i,b in enumerate(chunks):print(enc([0,nib(i+1),nib(len(chunks)),nib(len(raw)),digest,nib(b.hex())]).decode(),flush=True)
 print(enc([1,nib(len(chunks)),nib(len(raw)),digest]).decode(),flush=True)

def safe(n):
 p=pathlib.PurePosixPath(n);return type(n)is str and bool(n)and str(p)==n and not p.is_absolute()and '..'not in p.parts and '\\'not in n and all(ord(c)>=32 for c in n)

def utc_ns(value):
 need(type(value)is str,'typed-docker-start-time');m=re.fullmatch(r'(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(?:\.(\d{1,9}))?(Z|[+-]\d\d:\d\d)',value);need(m is not None,'valid-docker-start-time')
 whole=datetime.datetime.fromisoformat(m[1]+('+00:00'if m[3]=='Z'else m[3]));return int(whole.timestamp())*10**9+int((m[2]or'').ljust(9,'0'))

def load(name):
 p=pathlib.Path(__file__).with_name(name);need(p.is_file()and not p.is_symlink()and file_hash(p)==DEPS[name],'fixed-inert-dependency');s=importlib.util.spec_from_file_location('zuru_'+name.replace('.','_'),p);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
def setup():
 global Q,P,E
 Q=load('pr1039-zuru-preflight.py');P=load('pr1035-quote-preflight.py');P.OUT=OUT;E=load('pr1030-engineering-preflight.py')
def read_file(path,limit=32*1024**2):
 fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
 try:
  a=os.fstat(fd);need(stat.S_ISREG(a.st_mode)and a.st_size<=limit,'bounded-regular-file');chunks=[];size=0
  while True:
   b=os.read(fd,1024**2)
   if not b:break
   size+=len(b);need(size<=limit,'bounded-read');chunks.append(b)
  z=os.fstat(fd);n=path.lstat();K=lambda s:(s.st_dev,s.st_ino,s.st_uid,s.st_gid,s.st_mode,s.st_size,s.st_mtime_ns,s.st_ctime_ns,s.st_nlink);need(K(a)==K(z)==K(n)and size==a.st_size,'stable-file');return b''.join(chunks),{'dev':a.st_dev,'ino':a.st_ino,'uid':a.st_uid,'gid':a.st_gid,'mode':stat.S_IMODE(a.st_mode),'bytes':size,'mtimeNs':a.st_mtime_ns,'ctimeNs':a.st_ctime_ns,'nlink':a.st_nlink}
 finally:os.close(fd)
def profile():
 b,meta=read_file(PROFILE);v=json.loads(b);need(sha(b)==PROFILE_FILE_SHA and v['resultSHA256']==PROFILE_RESULT_SHA==sha(enc({k:x for k,x in v.items()if k!='resultSHA256'}))and v['success']is True and v['readOnly']is True,'original-profile-full-byte-and-inner-seal');need(v['hostGitHead']==HOST_BASE and v['containerId']==CID and v['canonicalImage']==BASE_IMAGE and not v['differentBaselineFiles']and v['oneWorkerFourThreads']and v['expectedRuntimeFlags'],'accepted-original-zuru-profile');return v
def runtime():
 v,r=Q.runtime();need(r['Id']==CID and r['Image']==BASE_IMAGE,'same-fixed-zuru-container-image');return v,r
def protection(records):
 need(git('rev-parse','HEAD').decode().strip()==HOST_BASE,'host-checkout-kept');shared={n:P.shared_file(n)for n in P.SHARED};need(all(z['sha256']==sha(git('show',HOST_BASE+':'+n))for n,z in shared.items()),'shared-five-match-host');dirty=git('diff','--name-only','-z').decode().split('\0');other=[n for n in dirty if n and n!=APP+'/data/item_map.json'];need(not git('diff','--cached','--name-only','-z'),'no-staged-host-changes');preserved={n:P.shared_file(n)for n in other};env={str(p.relative_to(ROOT)):P.shared_file(str(p))for p in ROOT.glob('.env*')if p.is_file()};need('.env.cloud.production'in env,'actual-production-environment');return{'host':HOST_BASE,'shared':shared,'dirtyOther':preserved,'environment':env,'gatewayAuth':P.gateway_auth()}
def stable(before,protected):need(runtime()[0]==before and protection(before)==protected,'all-original-runtime-and-host-protection-exact')
def storage_capture(label):
 values={}
 for name in('data','uploads','exports'):
  inventory,summary=E.full_inventory(ROOT/APP/name);need(summary['links']==0,'regular-zuru-storage');private(label+'-'+name+'.private.json',inventory);values[name]=inventory
 return values
def source_check():
 need(all(pin(v,40)for v in(BASE,TARGET,TREE,HEAD,APP_TREE))and REVIEWED_FILES,'reviewed-source-pins');git('fetch','--no-write-fetch-head','origin','+refs/heads/main:refs/remotes/origin/main');need(git('rev-parse','refs/remotes/origin/main').decode().strip()==TARGET and git('rev-parse',TARGET+'^{tree}').decode().strip()==TREE,'exact-reviewed-main-tree');need(git('rev-parse',TARGET+':'+APP).decode().strip()==APP_TREE==git('rev-parse',HEAD+':'+APP).decode().strip(),'reviewed-application-tree');git('merge-base','--is-ancestor',HEAD,TARGET)
 changed={n[len(APP)+1:]for n in git('diff','--name-only','-z',SOURCE_BASE,TARGET,'--',APP).decode().split('\0')if n};need(changed==set(REVIEWED_FILES),'exact-five-reviewed-paths');need(all(safe(n)and pin(h)and sha(git('show',TARGET+':'+APP+'/'+n))==h for n,h in REVIEWED_FILES.items()),'all-reviewed-blob-sha');need(all(git('show',SOURCE_BASE+':'+APP+'/'+n)==git('show',TARGET+':'+APP+'/'+n)for n in('Dockerfile','requirements.txt','templates/index.html')),'unchanged-runtime-recipe-dependencies-and-template')
def source_code(cid,image_mode=False):
 if not image_mode and not memory(['docker','inspect',cid])[0]['State']['Running']:
  result={}
  for n in PRODUCTION:
   raw=run(['docker','cp',cid+':/app/'+n,'-'],timeout=60)
   with tarfile.open(fileobj=io.BytesIO(raw))as archive:
    members=archive.getmembers();need(len(members)==1 and members[0].isfile()and not members[0].issym()and not members[0].islnk()and members[0].name==pathlib.PurePosixPath(n).name,'fixed-stopped-code-tar');m=members[0];b=archive.extractfile(m).read();need(len(b)==m.size<4*1024**2,'bounded-stopped-code-body');stamp=m.pax_headers.get('mtime',str(m.mtime));ns=int(decimal.Decimal(stamp)*10**9);result[n]={'sha256':sha(b),'bytes':len(b),'uid':m.uid,'gid':m.gid,'mode':m.mode,'mtimeNs':ns}
  return result
 args=['docker','run','--rm','-i','--network','none','--read-only','--restart','no','--log-driver','none','--entrypoint','python',cid,'-B','-c',Q.CODE]if image_mode else['docker','exec','-i',cid,'python','-B','-c',Q.CODE];v=json.loads(run(args,enc(PRODUCTION),timeout=180));need(v['python']=='3.12.13'and set(v['files'])==set(PRODUCTION),'actual-python-and-complete-production-source');return v['files']
def source_matches(value,revision):
 need(all(value[n].get('sha256')==sha(git('show',revision+':'+APP+'/'+n))for n in PRODUCTION),'all-four-production-files-match-git');return value
def source_projection(values):return{n:{k:v[k]for k in('sha256','bytes','uid','gid','mode')}for n,v in values.items()}
def space_check():
 s=os.statvfs(json.loads(run(['docker','info','--format','{{json .DockerRootDir}}'])));v={'available':s.f_bavail*s.f_frsize,'free':s.f_bfree*s.f_frsize};need(v['available']>=MIN_AVAILABLE and v['free']>=MIN_FREE,'small-copy-only-space-budget-no-prune');return v
def sealed(phase,digest):
 d=ARCHIVE/phase;raw,_=read_file(d/'manifest.json');need(sha(raw)==digest,'successful-phase-manifest-seal');mf=json.loads(raw);paths=list(d.rglob('*'));need(all(not p.is_symlink()and(p.is_dir()or p.is_file())for p in paths)and{str(p.relative_to(d))for p in paths if p.is_file()and p!=d/'manifest.json'}==set(mf),'complete-regular-phase-evidence');need(all(safe(n)and file_hash(d/n)==h for n,h in mf.items()),'all-sealed-phase-bytes');v=json.loads((d/'result.private.json').read_bytes());need(v['success']is True and v['resultSHA256']==sha(enc({k:x for k,x in v.items()if k!='resultSHA256'}))and(v['target'],v['tree'],v['appTree'])==(TARGET,TREE,APP_TREE),'source-bound-successful-inner-result');return v,d
TABLE_PROBE=r'''import os,json,zipfile,openpyxl
v={'configured':False,'existing':False,'normalizedScheduleSheets':0,'uniqueNormalizedPOs':0,'activeIsSchedule':False,'valid':True}
try:
 p='/app/data/config.json'
 if os.path.exists(p):
  if os.path.islink(p)or os.path.getsize(p)>1024**2:raise ValueError('CONFIG_BOUNDED')
  with open(p,'r',encoding='utf8')as f:cfg=json.load(f)
  selected=cfg.get('order_table_path','');v['configured']=bool(selected)
  if selected:
   v['existing']=isinstance(selected,str)and os.path.isfile(selected)
   if not v['existing']:raise ValueError('CONFIGURED_FILE_MISSING')
   resolved=os.path.realpath(selected)
   if not any(resolved.startswith('/app/'+n+'/')for n in('data','uploads','exports')):raise ValueError('CONFIGURED_PATH_SCOPE')
   if os.path.getsize(resolved)>32*1024**2:raise ValueError('TABLE_BOUNDED')
   with zipfile.ZipFile(resolved)as z:
    if len(z.infolist())>10000 or sum(x.file_size for x in z.infolist())>128*1024**2:raise ValueError('ZIP_BOUNDED')
   wb=openpyxl.load_workbook(resolved,read_only=True,data_only=True)
   try:
    names=[n for n in wb.sheetnames if str(n).strip()=='排期'];v['normalizedScheduleSheets']=len(names)
    if len(names)!=1:raise ValueError('SCHEDULE_NOT_UNIQUE')
    v['activeIsSchedule']=wb.active is not None and wb.active.title==names[0];sheet=wb[names[0]]
    if sheet.max_row>200000:raise ValueError('ROWS_BOUNDED')
    pos=set()
    for row in sheet.iter_rows(min_row=3,min_col=2,max_col=2,values_only=True):
     if row[0]:
      x=str(row[0]).strip();x=x[:-2]if x.endswith('.0')else x
      if x:pos.add(x)
    v['uniqueNormalizedPOs']=len(pos)
    if not pos:raise ValueError('EMPTY_SCHEDULE')
   finally:wb.close()
except Exception as e:v['valid']=False;v['errorType']=type(e).__name__;v['reason']=str(e)if isinstance(e,ValueError)and str(e).isupper()and len(str(e))<60 else'READ_FAILED'
print(json.dumps(v,sort_keys=True))'''
def configured_table():
 v=json.loads(run(['docker','exec','-i',CID,'python','-B','-c',TABLE_PROBE],timeout=180));private('configured-table.private.json',v);return v
def tar_code(bodies,metadata):
 data=io.BytesIO()
 with tarfile.open(fileobj=data,mode='w')as archive:
  for n in PATCH:
   v=metadata[n];body=bodies[n];need(sha(body)==v['sha256'],'exact-code-tar-body');m=tarfile.TarInfo(n);m.uid=v['uid'];m.gid=v['gid'];m.mode=v['mode'];m.mtime=v['mtime'];m.size=len(body);archive.addfile(m,io.BytesIO(body))
 return data.getvalue()
def stopped_copy_rehearsal(candidate,patch,wanted):
 token=uuid.uuid4().hex;cid=run(['docker','create','--network','none','--restart','no','--log-driver','none','--label','io.rr-portal.pr1039-scratch='+token,'--entrypoint','/bin/true',candidate]).decode().strip();need(pin(cid),'owned-scratch-cid')
 def owned():
  rows=memory(['docker','inspect',cid]);need(len(rows)==1,'single-scratch');r=rows[0];need(r['Id']==cid and r['Image']==candidate and not r['State']['Running']and r['State']['Pid']==0 and r['State']['StartedAt'].startswith('0001-')and not r['Mounts']and r['HostConfig']['NetworkMode']=='none'and r['HostConfig']['RestartPolicy']['Name']=='no'and r['HostConfig']['LogConfig']['Type']=='none'and(r['Config'].get('Labels')or{}).get('io.rr-portal.pr1039-scratch')==token,'only-own-never-started-scratch');return r
 try:
  owned();before=source_code(cid);need(source_projection(before)==source_projection(wanted),'durable-readback-before-any-copy');run(['docker','cp','--archive','-',cid+':/app'],patch);after=source_code(cid);need(after==before,'same-metadata-stopped-copy-rehearsal')
 finally:owned();run(['docker','rm',cid])
NATIVE_TEST=r'''import os,sys,json,hashlib,pathlib,subprocess,re
if sys.version.split()[0]!='3.12.13':raise RuntimeError('fixed-native-python-version')
expected=json.load(sys.stdin);root=pathlib.Path('/tmp/pr1039-review-app');root.mkdir()
for n,h in expected.items():
 if n.startswith('/')or'..'in n.split('/')or not(n in('app.py','po_parser.py','requirements.txt','templates/index.html')or n.startswith(('data/','tests/'))):raise RuntimeError('scope')
 b=(pathlib.Path('/app')/n).read_bytes()
 if hashlib.sha256(b).hexdigest()!=h:raise RuntimeError('reviewed-source-sha')
 p=root/n;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(b)
os.environ['DATA_PATH']='/tmp/pr1039-review-state';os.environ['LOCAL_MODE']='0';os.environ['PYTHONDONTWRITEBYTECODE']='1'
r=subprocess.run([sys.executable,'-B','-m','unittest','discover','-s','tests','-p','test*.py','-v'],cwd=root,capture_output=True,timeout=270)
sys.stderr.buffer.write(r.stdout+r.stderr);text=(r.stdout+r.stderr).decode('utf8','replace');ok=r.returncode==0 and re.search(r'Ran 28 tests\b',text)is not None and re.search(r'^OK\s*$',text,re.M)is not None and'skipped='not in text
print(json.dumps({'passed':bool(ok),'tests':28 if ok else None,'python':sys.version.split()[0],'logSHA256':hashlib.sha256(r.stdout+r.stderr).hexdigest(),'isolatedDataPath':True}));sys.exit(0 if ok else 1)'''
def prepare():
 source_check();accepted=profile();before,r=runtime();need(before==accepted['allRuntime']and before[CID]['running']and before[CID]['health']=='healthy'and image(ALIAS)['Id']==BASE_IMAGE,'unchanged-profile-process-and-canonical');protected=protection(before);private('runtime-before.private.json',before);private('protected.private.json',protected);first_space=space_check();configured=configured_table();old=source_matches(source_code(CID),SOURCE_BASE);need(old==accepted['code']['files'],'profile-production-source-still-identical');base=image(BASE_IMAGE);need(not base['Config'].get('Volumes')and source_projection(source_code(BASE_IMAGE,True))==source_projection(old),'known-image-full-source-and-no-volumes')
 public=ROOT/APP/'data/item_map.json';mapping=Q.map_profile(public);need(mapping['conflictCount']==0,'seven-key-conflicts-require-confirmation');private('item-map-baseline.private.json',mapping)
 context=OUT/'context';context.mkdir(mode=0o700);expected={};target_meta={};patch_meta={};old_meta={};bodies={};old_bodies={}
 for n in(*PRODUCTION,*PUBLIC_DATA,*TESTS):
  body=git('show',TARGET+':'+APP+'/'+n);expected[n]=sha(body);p=context/n;p.parent.mkdir(mode=0o755,parents=True,exist_ok=True);private(p,body)
  if n in PRODUCTION:
   v=old[n];t=max(int(time.time())+2,v['mtimeNs']//10**9+2)if n in PATCH else v['mtimeNs']//10**9;os.chown(p,v['uid'],v['gid']);os.chmod(p,v['mode']);os.utime(p,(t,t));target_meta[n]=dict(v,sha256=sha(body),bytes=len(body),mtimeNs=t*10**9)
   if n in PATCH:patch_meta[n]={'sha256':sha(body),'bytes':len(body),'uid':v['uid'],'gid':v['gid'],'mode':v['mode'],'mtime':t,'mtimeNs':t*10**9};bodies[n]=body;old_bodies[n]=git('show',SOURCE_BASE+':'+APP+'/'+n);old_meta[n]=dict(v,mtime=v['mtimeNs']//10**9)
  else:p.chmod(0o644)
 alias='rrportal-pr1039-base:'+BASE_IMAGE.split(':')[1];probe=subprocess.run(['docker','image','inspect',alias],capture_output=True,timeout=30);need(probe.returncode==0 or b'No such image'in probe.stderr or b'No such object'in probe.stderr,'known-owned-base-tag-state')
 if probe.returncode:run(['docker','tag',BASE_IMAGE,alias])
 else:need(json.loads(probe.stdout)[0]['Id']==BASE_IMAGE,'owned-base-tag-id')
 recipe='FROM '+alias+'\n'+''.join('COPY --chown=%d:%d %s\n'%(target_meta[n]['uid'],target_meta[n]['gid'],json.dumps([n,'/app/'+n]))for n in PRODUCTION)+''.join('COPY '+json.dumps([n,'/app/'+n])+'\n'for n in(*PUBLIC_DATA,*TESTS));labels={'org.opencontainers.image.revision':TARGET,'io.rr-portal.app-tree':APP_TREE,'io.rr-portal.release-service':SERVICE};recipe+='LABEL '+' '.join(k+'='+json.dumps(v)for k,v in labels.items())+'\n';private(context/'Dockerfile',recipe.encode());tag='rrportal-pr1039-candidate:'+TARGET;run(['docker','build','--network=none','--pull=false','-t',tag,str(context)],timeout=300);candidate=image(tag);a,b=copy.deepcopy(base['Config']),copy.deepcopy(candidate['Config']);a.pop('Image',None);b.pop('Image',None);a['Labels']=dict(a.get('Labels')or{},**labels);need(a==b and candidate['Os']==base['Os']and candidate['Architecture']==base['Architecture']and candidate['RootFS']['Layers'][:len(base['RootFS']['Layers'])]==base['RootFS']['Layers'],'copy-only-durable-config-layers-preserved');new=source_matches(source_code(candidate['Id'],True),TARGET);need(source_projection(new)==source_projection(target_meta),'durable-full-source-owner-mode')
 for n in PATCH:need(new[n]['mtimeNs']==patch_meta[n]['mtimeNs'],'durable-patch-cache-time-exact')
 patch=tar_code(bodies,patch_meta);private('patch.tar',patch);private('old-code.tar',tar_code(old_bodies,old_meta));stopped_copy_rehearsal(candidate['Id'],patch,new)
 tests=json.loads(run(['docker','run','--rm','-i','--network','none','--read-only','--restart','no','--log-driver','none','--tmpfs','/tmp:rw,nosuid,nodev,size=256m','--entrypoint','python',candidate['Id'],'-B','-c',NATIVE_TEST],enc(expected),timeout=300));need(tests.get('passed')is True and tests['tests']==28,'all-twenty-eight-real-python-tests');private('native-tests.private.json',tests);stable(before,protected);last_space=space_check();return{'candidate':candidate['Id'],'runtime':before,'protected':protected,'oldSource':old,'newSource':new,'patchFiles':patch_meta,'configuredTable':configured,'deploymentEligible':configured['valid'],'nativeTests':tests,'itemMap':mapping,'spaceBefore':first_space,'spaceAfter':last_space,'noDependencyInstallOrNetworkBuild':True,'noProductionDataCopiedIntoImage':True,'neverStartedScratchCopyProof':True}
def switch_module():
 p=pathlib.Path(__file__).with_name(SWITCH_NAME);need(pin(SWITCH_SHA256)and p.is_file()and not p.is_symlink()and file_hash(p)==SWITCH_SHA256,'reviewed-switch-module-required');s=importlib.util.spec_from_file_location('zuru_switch',p);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
def main():
 global OUT
 need(EXECUTE is True and PHASE in('prepare','deploy','verify')and sys.argv[1:]==[PHASE]and os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_MODE')==PHASE and os.environ.get('RELEASE_ATTEMPT')=='1','explicit-first-phase-only');need(all(pin(v,40)for v in(BASE,TARGET,TREE,HEAD,APP_TREE))and REVIEWED_FILES,'bound-reviewed-app-required');os.umask(0o077);need(ARCHIVE.parent.is_dir()and not ARCHIVE.parent.is_symlink(),'owned-archive-parent');ARCHIVE.mkdir(mode=0o700,exist_ok=True);need(not ARCHIVE.is_symlink(),'real-archive');OUT=ARCHIVE/PHASE;need(not OUT.exists()and not OUT.is_symlink(),'fresh-phase-no-replay');OUT.mkdir(mode=0o700);v={'phase':PHASE,'mode':PHASE,'service':SERVICE,'base':BASE,'target':TARGET,'tree':TREE,'head':HEAD,'appTree':APP_TREE,'success':False,'resultPath':str(OUT/'result.private.json'),'automaticRetry':False,'otherServicesLifecycleOperated':False}
 try:
  setup()
  if PHASE=='prepare':v['details']=prepare()
  else:
   source_check();m=switch_module();v['details']=getattr(m,PHASE)(sys.modules[__name__])
  v['success']=True
 except Exception as e:v.update(errorType=type(e).__name__,stage=STAGE)
 v['resultSHA256']=sha(enc(v));private('result.private.json',v);paths=list(OUT.rglob('*'));need(all(not p.is_symlink()and(p.is_file()or p.is_dir())for p in paths),'regular-all-phase-artifacts');manifest={str(p.relative_to(OUT)):file_hash(p)for p in paths if p.is_file()};private('manifest.json',manifest);digest=sha(enc(manifest));wire={'result':v,'manifestSHA256':digest};wire['preparedSHA256'if PHASE=='prepare'else'deployEvidenceSHA256']=digest;transport(wire);return 0 if v['success']else 1
if __name__=='__main__':sys.exit(main())
