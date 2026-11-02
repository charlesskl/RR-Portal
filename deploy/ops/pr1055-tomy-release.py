"""INERT TOMY-only code overlay. No deletion, dependency install or RAM snapshot.

Temporary in-process download links may expire at the one authorized restart.
Uploaded originals stay with users; no persistent business store is introduced.
"""
import copy,datetime,gzip,hashlib,importlib.util,io,json,os,pathlib,re,stat,subprocess,sys,tarfile,time
EXECUTE=False
ROOT=pathlib.Path('/opt/rr-portal')
ARCHIVE=ROOT/'deploy/backups/pr1055-release-1-20261102'
BRANCH='refs/heads/codex/ops-pr1055-20261102'
APP='apps/业务部/TOMY排期核对系统'
SERVICE='tomy-paiqi'
CID='4b5aa6b998159434b09c3e25f554461ef4220828c8349d8a6116216231d5bf9f'
BASE='2fb0757be0d132149130f0331818116b3e136d11'
HEAD='8009e60c724a70cbc9d87577710990f72044a6b8'
TARGET='032b1d8e9c08465fbbe79735bbef7101f9010665'
APP_TREE='3937b347a6f48033a1423ef9719866043aeca6b0'
REVIEWED_PATHS=('client/src/App.tsx', 'client/src/lib/download.ts', 'client/src/lib/uploadValidation.ts', 'server/lib/clientFlow.test.ts', 'server/lib/clientSubmit.test.ts', 'server/lib/customerSafety.test.ts', 'server/lib/customerSchedule.test.ts', 'server/lib/customerSchedule.ts', 'server/lib/customerWorkbookPatch.ts', 'server/lib/excelParser.test.ts', 'server/lib/excelParser.ts', 'server/lib/excelWriter.ts', 'server/lib/outputStore.test.ts', 'server/lib/outputStore.ts', 'server/lib/pdfExtractor.test.ts', 'server/lib/prepareScheduleWorkbook.test.ts', 'server/lib/prepareScheduleWorkbook.ts', 'server/lib/summaryReport.ts', 'server/lib/uploadAdmission.ts', 'server/routes/upload.test.ts', 'server/routes/upload.ts', 'server/types/index.ts', 'tsconfig.json')
BASE_IMAGE='sha256:32768ec50f41cde00e40225394c609e2c7994d37d2ef1b72df1c335fc40396c9'
CANONICAL='rr-portal-tomy-paiqi:latest'
P_SHA='0a2e27c86ceddb0623e6a5223a65cb5906b6d873d52475dcb4fb3debe17994a0'
PREFLIGHT=ROOT/'deploy/backups/pr1055-preflight-1-20261102/result.private.json'
PREFLIGHT_SHA='643b825365316cce48dd71ebcbc97f3791ef4fdf5cc4c0f506526fbc8d437d1c'
PREPARE_SHA='5cb4798d72784f424f56b564cbdb1d415caf1e56e0d697e53a4333a31e5f5bf0'
DEPLOY_SHA='97f669e3d18a6626d8c3e4a9a61e18e81036abe3ed103df0af4bc0fda2abdc26'
MANIFEST_FILE='pr1055-dist-manifest.json'
MANIFEST_SHA='73f0f318c9531676fd4b662540696a54dfe894440d8926c4d52bd52840ab3d7d'
PROVENANCE_FILE='pr1055-build-provenance.json'
PROVENANCE_SHA='fe0cc17c733964106a280803d222f314f3d3ec1281831f325ffe965601a8ae17'
DELTA_FILE='pr1055-dist-delta.tar.gz'
DELTA_SHA='f32048711dd33360699e672a5b444781a5d5750054f78704f97a9b57236ca799'
NATIVE_FILE='pr1055-native-check.cjs'
NATIVE_SHA='756c92fb1a4a080b4002584b83f60ac078870ef15c15457faf015d7c8d33dcde'
NATIVE_CHECKS=('healthAndPrefixedAssets','customerDatThreeFactories','originalWorkbookPartsRetained','repeatedCustomerAndZipDownloads','ambiguousRowNotGreen','invalidCustomerNoOutput','emptyPoNoOutput','legacyPdfThreeFactoriesAndOriginals','uploadLimitResponse')
P=None
OUT=None
STAGE='entry'
PRIMARY_FAILURE=None
STATE={'stage':'not-started','stopAttempted':False,'startAttempted':False,'canonicalTagAttempted':False,'automaticRetryOrRollback':False,'businessDataRestoreOrMigration':False,'ramDownloadBuffersPreserved':False}
MAX_PATCH=2*1024**2
SPACE_BUDGET=24*1024**2
def enc(v):return json.dumps(v,sort_keys=True,separators=(',',':'),ensure_ascii=True,allow_nan=False).encode()
def sha(v):return hashlib.sha256(v).hexdigest()
def pin(v,n=64):return type(v)is str and re.fullmatch('[a-f0-9]{%d}'%n,v)is not None
def need(v,label):
 global STAGE
 STAGE=label
 if not v:raise RuntimeError(label)
def sync(path):
 fd=os.open(path,os.O_RDONLY|os.O_DIRECTORY)
 try:os.fsync(fd)
 finally:os.close(fd)
def private(name,value):P.private(name,value)
def checkpoint(name,**values):STATE.update(values);private('operation-'+name+'.private.json',STATE)
def timed_process(name,args,timeout):
 global STAGE
 try:return subprocess.run(args,capture_output=True,timeout=timeout,cwd=ROOT)
 except subprocess.TimeoutExpired as error:
  STAGE=name+'-timeout';streams={}
  for key,value in(('stdout',error.stdout),('stderr',error.stderr)):
   body=value if type(value)is bytes else value.encode('utf8',errors='replace')if type(value)is str else b'';private(name+'-'+key+'.private.log',body[:512*1024]);streams[key]={'bytes':len(body),'sha256':sha(body),'savedBytes':min(len(body),512*1024),'truncated':len(body)>512*1024}
  private(name+'-timeout.private.json',{'stage':STAGE,'operationStage':STATE['stage'],'timeoutSeconds':timeout,'streams':streams,'automaticReplayOrCleanup':False,'stopAttempted':STATE['stopAttempted'],'startAttempted':STATE['startAttempted']});raise
def run(args,body=None,timeout=60,limit=16*1024**2):
 r=subprocess.run(args,input=body,capture_output=True,timeout=timeout,cwd=ROOT);need(len(r.stdout)<=limit and len(r.stderr)<=2*1024**2,'bounded-fixed-command-output')
 if r.returncode:
  private('failed-command-'+str(time.time_ns())+'.private.json',{'family':args[:2],'exitCode':r.returncode,'stdoutSHA256':sha(r.stdout),'stderrSHA256':sha(r.stderr)});need(False,'fixed-command-failed-no-automatic-replay')
 return r.stdout
def git(*args):return run(['git','-c','core.hooksPath=/dev/null',*args])
def load():
 global P
 path=pathlib.Path(__file__).with_name('pr1055-preflight.py');need(path.is_file()and not path.is_symlink()and sha(path.read_bytes())==P_SHA,'exact-reviewed-readonly-tomy-library');spec=importlib.util.spec_from_file_location('release1055_preflight',path);P=importlib.util.module_from_spec(spec);spec.loader.exec_module(P);P.OUT=OUT
def receipt(path,digest,phase):
 need(pin(digest)and path.is_file()and not path.is_symlink()and path.stat().st_size<=4*1024**2,'bounded-sealed-prior-receipt');raw=path.read_bytes();need(sha(raw)==digest,'exact-prior-receipt-body');v=json.loads(raw);c=dict(v);s=c.pop('resultSHA256',None);need(s==sha(enc(c))and v['success']is True and v['phase']==phase,'successful-self-sealed-prior-phase');return v
def prepared():
 r=receipt(ARCHIVE/'prepare/result.private.json',PREPARE_SHA,'prepare');need(r['target']==TARGET and r['sourceHead']==HEAD,'same-approved-prepare');p=ARCHIVE/'prepare/prepared.private.json';need(p.is_file()and not p.is_symlink()and p.stat().st_size<=4*1024**2,'bounded-prepared-plan');raw=p.read_bytes();need(sha(raw)==r['details']['preparedBodySHA256'],'complete-prepared-plan-seal');return json.loads(raw)
def capacity(reserve=0):
 v=P.capacity();need(v['available']>=1024**3+reserve and v['free']>=8*1024**3+reserve and v['MemAvailable']>=1024**3,'ordinary-one-gib-physical-eight-gib-memory-one-gib-floors');return v
def safe(name):return type(name)is str and 0<len(name)<300 and not any(ord(c)<32 for c in name)and P.safe_relative(name)and pathlib.PurePosixPath(name).as_posix()==name
def runtime_path(name):return safe(name)and(name in('package.json','package-lock.json')or name.startswith('server/')and name.endswith(('.ts','.js','.mjs','.cjs'))and not name.endswith('.test.ts')and name not in('server/smoke-test.ts','server/upload-smoke.mjs'))
def source_map(rev):
 rows=git('ls-tree','-r','-z',rev,'--',APP);result={}
 for row in rows.split(b'\0'):
  if not row:continue
  meta,name=row.split(b'\t',1);mode,kind,blob=meta.decode().split();name=name.decode()[len(APP)+1:]
  if not runtime_path(name):continue
  need(kind=='blob'and mode in('100644','100755')and pin(blob,40),'regular-reviewed-public-runtime-code');result[name]={'gitBlobSHA1':blob,'mode':int(mode,8)&0o777}
 need('server/index.ts'in result and len(result)<=100,'bounded-actual-typescript-runtime');return result
def source_guard():
 need(all(pin(v,40)for v in(HEAD,TARGET,APP_TREE))and 0<len(REVIEWED_PATHS)<=50,'final-reviewed-source-pins');git('fetch','--no-write-fetch-head','origin','+refs/heads/main:refs/remotes/origin/main');need(git('rev-parse','refs/remotes/origin/main').decode().strip()==TARGET,'exact-protected-normal-main-merge');git('merge-base','--is-ancestor',HEAD,TARGET);need(git('rev-parse',HEAD+':'+APP).decode().strip()==git('rev-parse',TARGET+':'+APP).decode().strip()==APP_TREE,'reviewed-and-merged-tomy-app-trees-identical');changed={p.decode()[len(APP)+1:]for p in git('diff','--name-only','-z',BASE,TARGET,'--',APP).split(b'\0')if p};need(changed==set(REVIEWED_PATHS),'all-and-only-reviewed-tomy-application-diff')
 for n in('package.json','package-lock.json','client/package.json','client/package-lock.json','Dockerfile'):need(git('show',HEAD+':'+APP+'/'+n)==git('show',BASE+':'+APP+'/'+n),'same-dependencies-and-build-entrypoint-no-server-install')
 old,new=source_map(BASE),source_map(HEAD);need(set(old)<=set(new),'no-runtime-code-deletion-or-retirement');return old,new
def app_inspect():
 rows=json.loads(run(['docker','inspect',CID],limit=4*1024**2));need(len(rows)==1 and rows[0]['Id']==CID and rows[0]['Image']==BASE_IMAGE,'same-original-tomy-container-and-runtime-image');return rows[0]
def boundary(app):
 h=app['HostConfig'];n=app['NetworkSettings'];need(not app['Mounts']and not h.get('PortBindings')and not h.get('PublishAllPorts')and h.get('NetworkMode')not in('host','default','bridge','none')and not h.get('NetworkMode','').startswith('container:')and len(n.get('Networks')or{})==1 and all(v is None for v in(n.get('Ports')or{}).values()),'same-no-mounts-no-public-port-private-network-boundary')
def state():
 rows,app,nginx=P.runtime();need(app['Id']==CID and app['Image']==BASE_IMAGE,'known-original-tomy-runtime');boundary(app);return {'runtime':rows,'host':P.host(),'canonical':P.image(CANONICAL)['id'],'engineeringCanonical':P.image(P.ENGINEERING_CANONICAL)['id']},app,nginx
def unchanged(a,b,restarted=False):
 need(set(a['runtime'])==set(b['runtime'])and a['host']==b['host']and a['engineeringCanonical']==b['engineeringCanonical'],'host-and-engineering-unchanged')
 for cid,old in a['runtime'].items():
  new=b['runtime'][cid]
  if cid==CID and restarted:
   x,y=copy.deepcopy(old),copy.deepcopy(new)
   for k in('pid','started'):x.pop(k);y.pop(k)
   need(x==y and old['pid']!=new['pid']and old['started']!=new['started']and new['pid']>0,'only-one-tomy-restart-original-config-env-mounts-restarts-health-preserved')
  else:need(old==new,'all-other45-original-containers-exact')
def profile(app,expected):
 root=P.app_root(app);seen=set()
 for parent,dirs,names in os.walk(root/'server',followlinks=False):
  need(all(not(pathlib.Path(parent)/n).is_symlink()for n in dirs),'server-code-directory-not-alias')
  for name in names:seen.add((pathlib.Path(parent)/name).relative_to(root).as_posix())
 need(seen=={n for n in expected if n.startswith('server/')},'entire-existing-server-file-set-no-unreviewed-documents-read');actual={}
 for n in expected:
  path=root/n
  for parent in path.parents:
   if parent==root:break
   need(not parent.is_symlink(),'public-runtime-parent-not-alias')
  actual[n]=P.record(path,8*1024**2,True)
 need(actual==expected,'every-runtime-code-byte-owner-mode-and-git-blob-exact');return actual
def static(app):return P.public_tree(P.app_root(app),'client/dist')['files']
def lock(app):return P.record(P.app_root(app)/'node_modules/.package-lock.json',4*1024**2)
def data_folders_absent(app):
 root=P.app_root(app);need(all(not(root/n).exists()and not(root/n).is_symlink()for n in P.TEMP_DIRS),'no-new-persistent-user-folder-assumed-or-overwritten');return {'knownAppDataFoldersAbsent':True,'originalTmpAndUnknownFilesNeverDeleted':True,'tmpCompilerCacheMayGrow':True,'ramResultsNotInspectedOrPreserved':True}
def write_public(root,name,body,mode=0o644):
 need(safe(name),'safe-reviewed-overlay-name');p=root/name;p.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
 for parent in(p.parent,*p.parent.parents):
  if parent==root.parent:break
  need(not parent.is_symlink(),'owned-overlay-parent-not-link');os.chmod(parent,0o755)
 fd=os.open(p,os.O_CREAT|os.O_EXCL|os.O_WRONLY|os.O_NOFOLLOW,mode)
 with os.fdopen(fd,'wb')as f:os.fchmod(f.fileno(),mode);f.write(body);f.flush();os.fsync(f.fileno())
def artifact(name,digest,cap):
 path=pathlib.Path(__file__).with_name(name);need(pin(digest)and path.is_file()and not path.is_symlink()and path.stat().st_size<=cap and sha(path.read_bytes())==digest,'exact-reviewed-public-build-artifact');return path
def dist_delta(overlay,old):
 manifest=json.loads(artifact(MANIFEST_FILE,MANIFEST_SHA,128*1024).read_bytes());provenance=json.loads(artifact(PROVENANCE_FILE,PROVENANCE_SHA,128*1024).read_bytes());need(type(manifest)is dict and 'index.html'in manifest and 1<=len(manifest)<=1000 and all(safe(n)and pin(h)for n,h in manifest.items()),'full-clean-local-dist-manifest');expected={'sourceHead':HEAD,'appTree':APP_TREE,'manifestSHA256':MANIFEST_SHA,'sourceExtraction':'git-archive','freshExtraction':True,'freshNpmCi':True,'npmCiExitCode':0,'buildExitCode':0,'nodeModulesRootSymlink':False,'nodeModulesExternalSymlinks':0,'repeatBuildManifestEqual':True,'viteBase':'/tomy-paiqi/'};need(all(provenance.get(k)==v for k,v in expected.items())and provenance.get('packageLockSHA256')==sha(git('show',HEAD+':'+APP+'/client/package-lock.json')),'same-clean-repeated-client-build-and-lock');delta={};seen=set();total=0
 for name,h in manifest.items():
  rel='client/dist/'+name
  if name=='index.html'or rel not in old:need(name=='index.html'or name.startswith('assets/')and name.endswith(('.js','.css')),'only-index-and-new-content-hashed-static-delta');delta[name]=h
  else:need(old[rel]['sha256']==h,'all-old-fixed-and-hashed-static-bytes-retained')
 with tarfile.open(artifact(DELTA_FILE,DELTA_SHA,MAX_PATCH),'r:gz')as tf:
  for entry in tf:
   need(entry.isfile()and entry.name in delta and entry.name not in seen and safe(entry.name)and 0<=entry.size<=MAX_PATCH,'exact-safe-regular-dist-delta');seen.add(entry.name);body=tf.extractfile(entry).read(entry.size+1);total+=len(body);need(len(body)==entry.size and sha(body)==delta[entry.name]and total<=MAX_PATCH,'exact-bounded-compiled-delta');write_public(overlay,'client/dist/'+entry.name,body)
 need(seen==set(delta)and'index.html'in delta,'all-and-only-required-new-static-files');return manifest,delta
def overlay_tar(root,names):
 need(all(safe(n)and(runtime_path(n)or n.startswith('client/dist/'))for n in names),'only-explicit-public-runtime-or-static-overlay-members')
 buffer=io.BytesIO();dirs={p.as_posix()for n in names for p in pathlib.PurePosixPath(n).parents if str(p)!='.'}
 with tarfile.open(fileobj=buffer,mode='w')as tf:
  for n in sorted(dirs,key=lambda x:(x.count('/'),x)):
   i=tarfile.TarInfo(n);i.type=tarfile.DIRTYPE;i.mode=0o755;i.uid=i.gid=0;tf.addfile(i)
  for n in sorted(names):
   p=root/n;need(p.is_file()and not p.is_symlink(),'owned-overlay-regular');body=p.read_bytes();i=tarfile.TarInfo(n);i.size=len(body);i.mode=p.stat().st_mode&0o777;i.uid=i.gid=0;tf.addfile(i,io.BytesIO(body))
 raw=buffer.getvalue();need(len(raw)<=MAX_PATCH,'small-code-static-overlay-two-mib-cap');return raw
class BoundedWriter:
 def __init__(self,stream,limit):self.stream=stream;self.limit=limit;self.bytes=0
 def write(self,body):need(self.bytes+len(body)<=self.limit,'bounded-streamed-public-backup');written=self.stream.write(body);self.bytes+=written;return written
 def flush(self):self.stream.flush()
def backup(app,code,assets):
 root=P.app_root(app);expected={**code,**assets};need(sum(r['bytes']for r in expected.values())<=8*1024**2,'bounded-complete-old-runtime-backup-input');path=OUT/'old-runtime.private.tar.gz'
 with open(path,'xb')as f:
  os.fchmod(f.fileno(),0o600)
  with gzip.GzipFile(filename='',fileobj=BoundedWriter(f,4*1024**2),mode='wb',mtime=0)as gz,tarfile.open(fileobj=gz,mode='w|')as tf:
   for n,r in sorted(expected.items()):
    need(P.record(root/n,8*1024**2)=={k:v for k,v in r.items()if k!='gitBlobSHA1'},'old-code-static-stable-before-backup');i=tarfile.TarInfo(n);i.size=r['bytes'];i.mode=r['mode'];i.uid=r['uid'];i.gid=r['gid']
    with open(root/n,'rb')as data:tf.addfile(i,data)
  f.flush();os.fsync(f.fileno())
 need(path.stat().st_size<=4*1024**2,'small-public-runtime-backup');seen=set()
 with tarfile.open(path,'r|gz')as tf:
  for e in tf:
   need(e.isfile()and e.name in expected and e.name not in seen and e.size==expected[e.name]['bytes'],'backup-exact-file-set');body=tf.extractfile(e).read(e.size+1);need(len(body)==e.size and sha(body)==expected[e.name]['sha256'],'complete-old-public-backup-body-verified');seen.add(e.name)
 need(seen==set(expected),'complete-old-runtime-backed-up');return {'files':len(seen),'bytes':path.stat().st_size,'sha256':sha(path.read_bytes()),'includesUserUploadsOrRamBuffers':False}
def image(name):
 rows=json.loads(run(['docker','image','inspect',name],limit=4*1024**2));need(len(rows)==1,'one-fixed-image');return rows[0]
def absent_image(name):
 r=subprocess.run(['docker','image','inspect','--format','{{.Id}}',name],capture_output=True,timeout=30,cwd=ROOT);need(r.returncode==1 and not r.stdout.strip()and re.fullmatch(rb'(?:(?:Error response from daemon|Error): )?No such image: '+re.escape(name.encode())+rb'\s*',r.stderr)is not None,'fresh-specific-candidate-tag-only')
def base_alias_available(name):
 r=subprocess.run(['docker','image','inspect','--format','{{.Id}}',name],capture_output=True,timeout=30,cwd=ROOT)
 if r.returncode==0:need(r.stdout.decode().strip()==BASE_IMAGE,'own-frozen-base-alias-already-correct');return
 need(r.returncode==1 and not r.stdout.strip()and re.fullmatch(rb'(?:(?:Error response from daemon|Error): )?No such image: '+re.escape(name.encode())+rb'\s*',r.stderr)is not None,'explicit-own-base-alias-absence-only')
def build_candidate(context):
 r=subprocess.run(['docker','buildx','inspect','default'],capture_output=True,timeout=30,cwd=ROOT);need(r.returncode==0 and re.search(rb'^Name:\s+default\s*$',r.stdout,re.M)and re.search(rb'^Driver:\s+docker\s*$',r.stdout,re.M),'existing-default-local-docker-builder');alias='rrportal-pr1055-base:'+BASE_IMAGE.split(':')[1];tag='rrportal-tomy-pr1055:'+TARGET;absent_image(tag);base_alias_available(alias);run(['docker','tag',BASE_IMAGE,alias],limit=4096);need(image(alias)['Id']==BASE_IMAGE,'explicit-frozen-local-base-reference');body='FROM '+alias+'\nCOPY --chown=0:0 overlay/ /app/\nLABEL org.opencontainers.image.revision="'+TARGET+'" io.rr-portal.release-service="'+SERVICE+'" io.rr-portal.app-tree="'+APP_TREE+'"\n';(context/'Dockerfile').write_text(body);r=timed_process('build',['docker','buildx','build','--builder','default','--load','--network=none','--pull=false','--no-cache','--progress=plain','--tag',tag,str(context)],240);need(len(r.stdout)<=512*1024 and len(r.stderr)<=512*1024,'bounded-build-output');private('build-stdout.private.log',r.stdout);private('build-stderr.private.log',r.stderr);need(r.returncode==0 and image(alias)['Id']==BASE_IMAGE,'one-candidate-build-loaded');old,new=image(BASE_IMAGE),image(tag);a,b=copy.deepcopy(old['Config']),copy.deepcopy(new['Config']);a.pop('Image',None);b.pop('Image',None);a['Labels']=dict(a.get('Labels')or{},**{'org.opencontainers.image.revision':TARGET,'io.rr-portal.release-service':SERVICE,'io.rr-portal.app-tree':APP_TREE});need(a==b and old['Os']==new['Os']=='linux'and old['Architecture']==new['Architecture']and new['RootFS']['Layers'][:len(old['RootFS']['Layers'])]==old['RootFS']['Layers'],'original-image-config-env-health-entrypoint-user-dependencies-and-layers-inherited');return tag,new['Id']
def candidate_files(cid,prefix,directory=False):
 raw=run(['docker','cp',cid+':/app/'+prefix,'-'],limit=32*1024**2);files={}
 with tarfile.open(fileobj=io.BytesIO(raw))as tf:
  for e in tf:
   need(e.isfile()or e.isdir(),'candidate-no-links-or-special-files');parts=pathlib.PurePosixPath(e.name.rstrip('/')).parts;need(parts and parts[0]==pathlib.PurePosixPath(prefix).name and all(p not in('','..','.')for p in parts),'specific-safe-candidate-copy-root')
   if e.isdir():continue
   name='/'.join(parts[1:])if directory else parts[-1];need(name and name not in files and 0<=e.size<=8*1024**2,'bounded-unique-candidate-code-file');body=tf.extractfile(e).read(e.size+1);need(len(body)==e.size,'complete-candidate-body');files[name]={'bytes':len(body),'sha256':sha(body),'gitBlobSHA1':hashlib.sha1(('blob '+str(len(body))+'\0').encode()+body).hexdigest(),'mode':e.mode,'uid':e.uid,'gid':e.gid}
 return files
def candidate_proof(candidate,code,assets,installed):
 cid=run(['docker','create','--network','none',candidate],limit=4096).decode().strip();need(pin(cid),'own-never-started-inspection-container')
 try:
  actual={'server/'+n:r for n,r in candidate_files(cid,'server',True).items()}
  for n in('package.json','package-lock.json'):actual[n]=candidate_files(cid,n)[n]
  need(actual==code,'candidate-entire-server-and-original-root-package-files-exact');static={'client/dist/'+n:r['sha256']for n,r in candidate_files(cid,'client/dist',True).items()};need(static==assets,'candidate-all-old-and-new-static-assets-exact');rows=candidate_files(cid,'node_modules/.package-lock.json');need(len(rows)==1 and next(iter(rows.values()))['sha256']==installed['sha256'],'original-installed-dependency-lock');return {'allRuntimeAndStaticBytesExact':True,'originalInstalledDependenciesPreserved':True,'neverStartedScratchOnly':True}
 finally:
  rows=json.loads(run(['docker','inspect',cid],limit=4*1024**2));need(len(rows)==1 and rows[0]['Image']==candidate and rows[0]['State']['Status']=='created'and rows[0]['State']['Pid']==0,'only-own-never-started-scratch-removable');run(['docker','rm',cid],limit=4096)
def native(candidate):
 path=artifact(NATIVE_FILE,NATIVE_SHA,512*1024);need(0<len(NATIVE_CHECKS)<=100 and all(type(n)is str and re.fullmatch('[A-Za-z0-9_-]+',n)for n in NATIVE_CHECKS),'exact-reviewed-required-native-check-cases');args=['docker','run','--rm','--init','--name','rrportal-pr1055-native-'+TARGET[:12],'--label','io.rr-portal.native-check=pr1055-'+TARGET,'--network','none','--read-only','--restart','no','--log-driver','none','--memory','768m','--memory-swap','768m','--pids-limit','128','--env','PORT=3006','--env','NODE_ENV=production','--env','NODE_OPTIONS=--max-old-space-size=256','--env','PR1055_ISOLATED_CHECK=1','--tmpfs','/tmp:rw,nosuid,nodev,size=256m,mode=1777','--mount','type=bind,source='+str(path)+',target=/review/native.cjs,readonly','--entrypoint','node',candidate,'/review/native.cjs'];checkpoint('native-intent',stage='native-check',nativeContainerName='rrportal-pr1055-native-'+TARGET[:12]);r=timed_process('native',args,300);need(len(r.stdout)<=512*1024 and len(r.stderr)<=512*1024,'bounded-isolated-native-results');private('native-stdout.private.log',r.stdout);private('native-stderr.private.log',r.stderr);v=json.loads(r.stdout);need(r.returncode==0 and v['success']is True and v['node']=='v24.21.0'and v['failed']==v['skipped']==0 and v['passed']==len(NATIVE_CHECKS)and v['cleanupPassed']is True and set(v['checks'])==set(NATIVE_CHECKS)and all(v['checks'][n]is True for n in NATIVE_CHECKS),'all-reviewed-native-node24-isolated-http-cases-pass-no-skips');checkpoint('native-ack',stage='native-check-complete');return v
def prepare_phase():
 old_map,new_map=source_guard();pre=receipt(PREFLIGHT,PREFLIGHT_SHA,'diagnose');before,app,nginx=state();need(before['runtime']==pre['allRuntime']and before['host']==pre['host']and before['canonical']==pre['canonical']['id']==BASE_IMAGE,'fresh-preflight-state-and-original-canonical-cas');capacity(SPACE_BUDGET);old_code=pre['source']['files'];profile(app,old_code);old_static=pre['static']['client/dist']['files'];need(static(app)==old_static and lock(app)==pre['properties']['installedLock'],'original-static-and-installed-dependencies-exact');data_folders_absent(app);context=OUT/'context';context.mkdir(mode=0o700);overlay=context/'overlay';overlay.mkdir(mode=0o700);new_code=copy.deepcopy(old_code);changed=[];total=0
 for n,v in new_map.items():
  if n in old_code and old_code[n]['gitBlobSHA1']==v['gitBlobSHA1']and old_code[n]['mode']==v['mode']:continue
  body=git('show',HEAD+':'+APP+'/'+n);total+=len(body);need(total<=512*1024,'bounded-reviewed-runtime-typescript-delta');write_public(overlay,n,body,v['mode']);changed.append(n);new_code[n]={'bytes':len(body),'sha256':sha(body),'gitBlobSHA1':v['gitBlobSHA1'],'mode':v['mode'],'uid':0,'gid':0}
 manifest,delta=dist_delta(overlay,old_static);patch=overlay_tar(overlay,changed+['client/dist/'+n for n in delta]);private('overlay.private.tar',patch);old_backup=backup(app,old_code,old_static);checkpoint('candidate-build-intent',stage='candidate-build');candidate_tag,candidate=build_candidate(context);checkpoint('candidate-build-ack',stage='candidate-built',candidateImage=candidate);new_static={**{n:r['sha256']for n,r in old_static.items()},**{'client/dist/'+n:h for n,h in delta.items()}};proof=candidate_proof(candidate,new_code,new_static,pre['properties']['installedLock']);checks=native(candidate);after,app2,nginx2=state();unchanged(before,after);need(after['canonical']==BASE_IMAGE,'prepare-no-canonical-promotion');profile(app2,old_code);need(static(app2)==old_static and lock(app2)==pre['properties']['installedLock'],'prepare-no-live-source-static-dependency-writes');data_folders_absent(app2);capacity();plan={'sourceHead':HEAD,'target':TARGET,'before':before,'oldCode':old_code,'newCode':new_code,'oldStatic':old_static,'newStatic':new_static,'installedLock':pre['properties']['installedLock'],'candidateTag':candidate_tag,'candidateImage':candidate,'patchSHA256':sha(patch),'patchBytes':len(patch),'backup':old_backup,'candidateProof':proof,'native':checks,'fullDataBackupCreated':False,'ramDownloadBuffersPreserved':False,'diskFileDeletionPerformed':False};raw=enc(plan);private('prepared.private.json',raw);return {'preparedBodySHA256':sha(raw),'candidate':candidate,'patchBytes':len(patch),'backup':old_backup,'native':checks,'fullDataBackupCreated':False,'ramDownloadBuffersPreserved':False,'capacity':capacity()}
def gate_path():return ROOT/'deploy/maintenance/services'/SERVICE
def gate_record():
 s=gate_path().lstat();need(stat.S_ISREG(s.st_mode)and s.st_size==0 and s.st_uid==s.st_gid==0 and stat.S_IMODE(s.st_mode)==0o644,'exact-own-empty-root-service-gate');return(s.st_dev,s.st_ino,s.st_mode,s.st_uid,s.st_gid,s.st_mtime_ns,s.st_ctime_ns)
def create_gate():
 path=gate_path();need(path.parent.is_dir()and not any(p.is_symlink()for p in(path.parent,*path.parent.parents))and not path.exists()and not path.is_symlink(),'fresh-single-service-gate');checkpoint('gate-intent',stage='gate-intent');fd=os.open(path,os.O_CREAT|os.O_EXCL|os.O_WRONLY|os.O_NOFOLLOW,0o644)
 try:os.fchmod(fd,0o644);os.fsync(fd)
 finally:os.close(fd)
 sync(path.parent);owned=gate_record();private('owned-gate.private.json',owned);checkpoint('gate-ack',stage='gated');return owned
def clear_gate(owned):
 need(gate_record()==owned,'only-owned-gate-removable');checkpoint('gate-clear-intent',stage='gate-clear-intent');gate_path().unlink();sync(gate_path().parent);checkpoint('gate-clear-ack',stage='gate-cleared')
def gateway(gated=False):
 rows=P.gateway()
 for n,v in rows.items():expected=503 if gated and n in('/tomy-paiqi/','/tomy-paiqi/health')else 401 if n in('/','/tomy-paiqi/')else 200;need(v.get('status')==expected,'single-tomy-gate-and-other-service-auth-health-boundaries')
 return rows
def drain(app,maximum=120):
 start=time.monotonic();quiet_since=None;observations=[]
 while True:
  need(app_inspect()['State']['Pid']==app['State']['Pid'],'original-target-pid-through-drain');a=P.activity(app);row={'seconds':round(time.monotonic()-start,3),'targetConnections':a['activeLocal3006Connections'],'selectedTempDataWriteFDs':a['selectedTempDataWriteFDs']};observations.append(row);quiet=row['targetConnections']==row['selectedTempDataWriteFDs']==0
  if not quiet:quiet_since=None
  elif quiet_since is None:quiet_since=row['seconds']
  if quiet_since is not None and row['seconds']-quiet_since>=10 and len(observations)>=4:private('drain-observations.private.json',observations);return {'seconds':row['seconds'],'quietSeconds':row['seconds']-quiet_since,'targetConnectionsAndTempWriteFDsObservedIdle':True,'ramOutputMapInspectedOrPreserved':False,'allGatewayConnectionsDrainedClaimed':False}
  if row['seconds']>=maximum:private('drain-observations.private.json',observations);need(False,'target-upload-or-temp-write-still-busy-no-stop')
  time.sleep(3)
HTTP=r'''const fs=require('fs'),crypto=require('crypto');const H=b=>crypto.createHash('sha256').update(b).digest('hex');const paths=JSON.parse(fs.readFileSync(0,'utf8'));(async()=>{let out={};for(const p of paths){const r=await fetch('http://127.0.0.1:3006/'+p,{redirect:'error',headers:{Connection:'close'},signal:AbortSignal.timeout(10000)}),parts=[];let size=0;for await(const b of r.body){size+=b.length;if(size>8388608)throw Error('bounded');parts.push(b)}out[p]={status:r.status,sha256:H(Buffer.concat(parts))}}console.log(JSON.stringify(out))})().catch(e=>{console.error(e.name);process.exitCode=1});'''
def http(assets):
 names=[n.removeprefix('client/dist/')for n in assets];v=json.loads(run(['docker','exec','-i',CID,'node','-e',HTTP],enc(['health',*names]),timeout=120,limit=1024**2));need(v['health']['status']==200 and all(v[n]['status']==200 and v[n]['sha256']==assets['client/dist/'+n]for n in names),'live-health-and-complete-old-new-frontend-http-graph-exact');return v
def wait_healthy():
 started=time.monotonic()
 while True:
  app=app_inspect();s=app['State'];need(s['Running']and not s['OOMKilled'],'one-start-target-running-not-oom')
  if s.get('Health',{}).get('Status')=='healthy':return app
  need(time.monotonic()-started<90,'single-target-start-healthy-no-retry');time.sleep(2)
def deploy_phase():
 global STAGE,PRIMARY_FAILURE
 plan=prepared();source_guard();before,app,nginx=state();need(before==plan['before']and image(plan['candidateTag'])['Id']==plan['candidateImage'],'prepared-state-and-candidate-cas');profile(app,plan['oldCode']);need(static(app)==plan['oldStatic']and lock(app)==plan['installedLock'],'old-code-static-dependencies-exact');data_folders_absent(app);path=ARCHIVE/'prepare/overlay.private.tar';need(path.is_file()and not path.is_symlink()and path.stat().st_size<=MAX_PATCH,'bounded-prepared-overlay');patch=path.read_bytes();need(sha(patch)==plan['patchSHA256']and len(patch)==plan['patchBytes'],'exact-prepared-overlay-body');capacity();owned=create_gate()
 try:
  gateway(True);idle=drain(app);gateway(True);fresh,app2,nginx2=state();unchanged(before,fresh);need(fresh['canonical']==BASE_IMAGE and gate_record()==owned,'idle-original-runtime-and-owned-gate');profile(app2,plan['oldCode']);data_folders_absent(app2)
 except Exception as error:
  PRIMARY_FAILURE={'stage':STAGE,'errorType':type(error).__name__};private('pre-stop-primary-failure.private.json',PRIMARY_FAILURE)
  if STATE['stopAttempted']is False:
   fresh,still,nginx2=state();unchanged(before,fresh);profile(still,plan['oldCode']);need(fresh['canonical']==BASE_IMAGE and static(still)==plan['oldStatic']and lock(still)==plan['installedLock'],'original-healthy-unmodified-before-clearing-owned-gate');clear_gate(owned);gateway(False)
  STAGE=PRIMARY_FAILURE['stage'];raise
 checkpoint('stop-intent',stage='stop',stopAttempted=True);run(['docker','stop','--time','30',CID],timeout=45,limit=4096);stopped=app_inspect();need(stopped['State']['Running']is False and stopped['State']['Pid']==0 and not stopped['State']['OOMKilled'],'original-target-stopped-once');checkpoint('stop-ack',stage='stopped');checkpoint('overlay-intent',stage='overlay');run(['docker','cp','-',CID+':/app'],patch,timeout=60,limit=4096);checkpoint('overlay-ack',stage='overlay-copied');checkpoint('start-intent',stage='start',startAttempted=True);run(['docker','start',CID],timeout=40,limit=4096);wait_healthy();checkpoint('start-ack',stage='healthy-gated');after,new,nginx2=state();unchanged(before,after,True);need(after['canonical']==BASE_IMAGE and gate_record()==owned,'new-code-only-while-service-gate-still-active');profile(new,plan['newCode']);assets=static(new);need({n:r['sha256']for n,r in assets.items()}==plan['newStatic']and lock(new)==plan['installedLock'],'new-server-plus-old-new-static-and-dependencies-exact');data_folders_absent(new);web=http(plan['newStatic']);last,_,_=state();need(last==after and gate_record()==owned,'one-start-only-and-original-protection-unchanged');capacity();checkpoint('canonical-intent',stage='canonical',canonicalTagAttempted=True);run(['docker','tag',plan['candidateImage'],CANONICAL],limit=4096);need(image(CANONICAL)['Id']==plan['candidateImage'],'single-durable-canonical-promotion');checkpoint('canonical-ack',stage='canonical-promoted');clear_gate(owned);public=gateway();final,_,_=state();unchanged(before,final,True);need(final['runtime']==after['runtime']and final['canonical']==plan['candidateImage'],'published-original-container-with-durable-code-image');return {'runtime':final,'candidate':plan['candidateImage'],'sameContainer':CID,'allOther45ContainersUnchanged':True,'singleRestart':True,'noDiskFileDeletionOrDataRestore':True,'oldRuntimeBackup':plan['backup'],'oldStaticHashAssetsRetained':True,'ramDownloadBuffersPreserved':False,'temporaryDownloadLinksMayExpireAtRestart':True,'fullBusinessDataBackupCreated':False,'drain':idle,'http':web,'gateway':public,'capacity':capacity()}
def verify_phase():
 plan=prepared();done=receipt(ARCHIVE/'deploy/result.private.json',DEPLOY_SHA,'deploy');source_guard();before,app,nginx=state();need(before==done['details']['runtime']and before['canonical']==plan['candidateImage'],'exact-published-runtime-and-durable-canonical');need(not gate_path().exists()and not gate_path().is_symlink(),'owned-gate-cleared');profile(app,plan['newCode']);need({n:r['sha256']for n,r in static(app).items()}==plan['newStatic']and lock(app)==plan['installedLock'],'published-code-full-static-graph-and-dependencies-exact');folders=data_folders_absent(app);web=http(plan['newStatic']);public=gateway();after,_,_=state();need(after==before,'verification-is-readonly-no-runtime-change');return {'runtime':after,'candidate':plan['candidateImage'],'sameContainer':CID,'http':web,'gateway':public,'diskFolders':folders,'noProductionBusinessWriteTests':True,'ramDownloadBuffersPreserved':False}
def reconcile_phase():
 app=app_inspect();s=app['State'];return {'state':{'running':s['Running'],'pid':s['Pid'],'started':s['StartedAt'],'oom':s['OOMKilled'],'health':s.get('Health',{}).get('Status'),'restarts':app['RestartCount']},'canonical':image(CANONICAL)['Id'],'configuredEnvSHA256':sha(enc(sorted(app['Config'].get('Env')or[]))),'mountsSHA256':sha(enc(app['Mounts'])),'gate':gate_record()if gate_path().exists()else None,'observationalOnly':True,'automaticReplayOrRollback':False,'ramDownloadBuffersInspectedOrRestored':False}
def main():
 global OUT
 args=sys.argv[1:];need(EXECUTE is True and len(args)==1 and args[0]in('prepare','deploy','verify','reconcile')and os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_MODE')==args[0]and os.environ.get('RELEASE_ATTEMPT')=='1','inert-first-source-bound-publication-only');phase=args[0];need(all(pin(v,40)for v in(HEAD,TARGET,APP_TREE)),'final-source-pins-required');os.umask(0o077);need(ARCHIVE.parent.is_dir()and not any(p.is_symlink()for p in(ARCHIVE.parent,*ARCHIVE.parent.parents)),'existing-private-release-parent')
 if phase=='prepare':need(not ARCHIVE.exists()and not ARCHIVE.is_symlink(),'fresh-never-replayed-prepare');ARCHIVE.mkdir(mode=0o700);sync(ARCHIVE.parent)
 else:need(ARCHIVE.is_dir()and not ARCHIVE.is_symlink()and ARCHIVE.stat().st_uid==0 and stat.S_IMODE(ARCHIVE.stat().st_mode)==0o700,'same-owned-private-release-root')
 OUT=ARCHIVE/phase;need(not OUT.exists()and not OUT.is_symlink(),'fresh-never-replayed-phase');OUT.mkdir(mode=0o700);sync(ARCHIVE);load();result={'phase':phase,'success':False,'sourceHead':HEAD,'target':TARGET,'appTree':APP_TREE,'startedUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'ramDownloadBuffersPreserved':False}
 try:result['details']={'prepare':prepare_phase,'deploy':deploy_phase,'verify':verify_phase,'reconcile':reconcile_phase}[phase]();result['success']=True
 except Exception as error:result.update(errorType=type(error).__name__,stage=STAGE,primaryFailure=PRIMARY_FAILURE,operations=copy.deepcopy(STATE),gateMayRemainClosed=gate_path().exists());private('failure-observation.private.json',{'stage':STAGE,'primaryFailure':PRIMARY_FAILURE,'errorType':type(error).__name__,'operations':STATE,'noAutomaticReplayOrRollback':True})
 result['finishedUtc']=datetime.datetime.now(datetime.timezone.utc).isoformat();result['resultSHA256']=sha(enc(result));private('result.private.json',result);P.wire(result);return 0 if result['success']else 1
if __name__=='__main__':sys.exit(main())
