"""INERT: reviewed local dist + bootstrap SQL, add-only assets and atomic index last.
No npm, remote downloads, app restart, business-row write, rollback or phase replay.
"""
import datetime,hashlib,importlib.util,io,json,os,pathlib,re,shutil,stat,subprocess,sys,tarfile,time,urllib.error,urllib.request
EXECUTE=True
BRANCH='refs/heads/codex/ops-pr1053-20261102'
ROOT=pathlib.Path('/opt/rr-portal')
ARCHIVE=ROOT/'deploy/backups/pr1053-static-2-20261102'
R1=ROOT/'deploy/backups/pr1053-static-1-20261102/prepare'
R1_FAILED_SHA='46c5d824b8b5f2c02788054151e61e0c9123e0b3940b42a59f5f2ca1e8f1fbab'
SCHEMA_ARCHIVE=ROOT/'deploy/backups/pr1053-schema-1-20261102'
D_FILE='pr1053-preflight.py'
D_SHA='0aeb31f9a4aea3f9d67eb8489687d7a035aa8f7fd8ea34ede9c6bd56dace9f25'
APP='apps/印尼小组/印尼走货明细'
HEAD='47dfe8800b60090476d1ea51b7d9c1b8ab66f0cf'
TARGET='114b5cc9867960518ebe70f6731475c97fec3747'
APP_TREE='61606ef0d93d366b71ce7b3a1ea0e9c136bd9610'
SCHEMA_SOURCE_SHA='e37f93e8c00089a6126cd8ef821e35e68110a5ef047dc1495a91f08701ddb7ab'
SCHEMA_DEPLOY_RESULT_SHA='00baeed5dde7daca67fd469d678933d9c024503eefbcce062485cb7ead129e15'
PREPARE_RESULT_SHA='ec3db425b626a2d742fe1f52eaa184d098b068d935b8df121ac52f643a87766a'
DEPLOY_RESULT_SHA=''
BUNDLE_FILE='pr1053-reviewed-dist.tar.gz'
BUNDLE_SHA='c8fbb4d4925de9c499a865b141f3df71a9e436b8b062e9c5f54117ccdd9685bf'
PROVENANCE_FILE='pr1053-local-build-provenance.json'
PROVENANCE_SHA='61aa5cdd0bc7f41f23ce8edb37b1515bf3e0e543f411398b1d45de340f5a1aa1'
MANIFEST_FILE='pr1053-dist-manifest.json'
MANIFEST_SHA='e53befda643926130c720575f16bc6b51e5d6435bf1e89122a4a7098d9739257'
CANONICAL='rr-portal-indo-shipping:latest'
OLD_CANONICAL='sha256:60d7deef2fe58c1c6ca66977b43392c570f11e31cc7f6d38f12fad2f2d201cee'
TEMPLATES=('template-customs.xlsx','template-customs-rri.xlsx','template-customs-rrm.xlsx')
CODE=('IndoShipping.Api.dll','IndoShipping.Api.pdb','IndoShipping.Domain.dll','IndoShipping.Domain.pdb','IndoShipping.Infrastructure.dll','IndoShipping.Infrastructure.pdb','seed/hs-dictionary.json')
BUDGET=256*1024**2
D=None
OUT=None
STAGE='entry'
DISPOSITION={'state':'not-started','schemaFileCommitAttempted':False,'indexCommitAttempted':False,'tagCommitAttempted':False,'automaticRetryOrRollbackPerformed':False}

def enc(v):return json.dumps(v,sort_keys=True,separators=(',',':'),ensure_ascii=True,allow_nan=False).encode()
def sha(v):return hashlib.sha256(v).hexdigest()
def pin(v,n=64):return type(v)is str and re.fullmatch('[a-f0-9]{%d}'%n,v)is not None

def need(v,label):
 global STAGE
 STAGE=label
 if not v:raise RuntimeError(label)

def run(args,body=None,timeout=45,limit=128*1024**2):
 r=subprocess.run(args,input=body,capture_output=True,timeout=timeout,cwd=ROOT)
 need(len(r.stdout)<=limit and len(r.stderr)<=4*1024**2,'bounded-command-capture')
 # Neither Docker Config/Env nor arbitrary error text is emitted or persisted.
 need(r.returncode==0,'fixed-scoped-command-success');return r.stdout

def private(name,value):
 D.write_private(name,value if type(value)is bytes else enc(value));fd=os.open(OUT,os.O_RDONLY|os.O_DIRECTORY)
 try:os.fsync(fd)
 finally:os.close(fd)

def checkpoint(name,**values):DISPOSITION.update(values);private('publication-'+name+'.private.json',DISPOSITION)
def sync_file(path):
 fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
 try:os.fsync(fd)
 finally:os.close(fd)
def sync_dir(path):
 fd=os.open(path,os.O_RDONLY|os.O_DIRECTORY)
 try:os.fsync(fd)
 finally:os.close(fd)
def load():
 global D
 p=pathlib.Path(__file__).with_name(D_FILE);need(p.is_file()and not p.is_symlink()and sha(p.read_bytes())==D_SHA,'exact-reviewed-readonly-dependency')
 spec=importlib.util.spec_from_file_location('static1053_diag',p);D=importlib.util.module_from_spec(spec);spec.loader.exec_module(D);D.OUT=OUT

def read_sealed(path,digest):
 need(pin(digest)and path.is_file()and not path.is_symlink()and path.stat().st_size<=4*1024**2,'bounded-sealed-result');raw=path.read_bytes();need(sha(raw)==digest,'exact-sealed-result-sha');v=json.loads(raw);inner=dict(v);own=inner.pop('resultSHA256',None);need(own==sha(enc(inner))and v['success']is True,'successful-self-sealed-result');return v

def image(name):
 rows=json.loads(run(['docker','image','inspect',name],limit=4*1024**2));need(type(rows)is list and len(rows)==1,'one-specific-image');return rows[0]

def aliases():return image(CANONICAL)['Id']
def git(*args):return run(['git','-c','core.hooksPath=/dev/null',*args],limit=64*1024**2)

def source():
 need(all(pin(v,40)for v in(HEAD,TARGET,APP_TREE))and all(pin(v)for v in(SCHEMA_SOURCE_SHA,SCHEMA_DEPLOY_RESULT_SHA,BUNDLE_SHA,PROVENANCE_SHA,MANIFEST_SHA)),'all-final-reviewed-source-build-schema-pins')
 git('fetch','--no-write-fetch-head','origin','+refs/heads/main:refs/remotes/origin/main')
 need(git('rev-parse','refs/remotes/origin/main').decode().strip()==TARGET,'exact-normally-merged-main')
 git('merge-base','--is-ancestor',HEAD,TARGET)
 need(git('rev-parse',HEAD+':'+APP).decode().strip()==git('rev-parse',TARGET+':'+APP).decode().strip()==APP_TREE,'exact-reviewed-and-merged-app-tree')
 schema=git('show',TARGET+':'+APP+'/db/postgres_schema.sql');need(sha(schema)==SCHEMA_SOURCE_SHA,'whole-reviewed-startup-schema-body')
 deployed=read_sealed(SCHEMA_ARCHIVE/'deploy/result.private.json',SCHEMA_DEPLOY_RESULT_SHA)
 need(deployed['phase']=='deploy'and deployed['target']==TARGET and deployed['sourceHead']==HEAD and deployed['details']['schemaOnlyCommit']is True and deployed['details']['disposition']['state']=='committed-and-runtime-verified','successful-scoped-schema-commit-before-static-publication')
 return schema

def capacity(initial=False,remaining=0):
 value=D.capacity();reserve=BUDGET if initial else remaining
 need(value['available']>=1024**3+reserve and value['free']>=8*1024**3+reserve and value['MemAvailable']>=1024**3,'preserve-one-gib-ordinary-eight-gib-physical-one-gib-memory-plus-bounded-growth')
 return value

def state():
 rows,app,db=D.runtime();return {'runtime':rows,'host':D.host(),'auth':D.gateway_auth(),'canonical':aliases(),'connection':D.guard_connection(app,db)},app,db

def live_backend(app):
 root=pathlib.Path('/proc')/str(app['State']['Pid'])/'root/app';return {n:D.record(root/n)for n in(*CODE,'db/postgres_schema.sql')}
def live_static(app):return D.static_profile(app,False)['files']
def body_manifest(rows):return {n:row['sha256']for n,row in rows.items()}

def safe_name(n):
 return type(n)is str and len(n)<=200 and re.fullmatch(r'[A-Za-z0-9_.-]+(?:/[A-Za-z0-9_.-]+)*',n)is not None and all(p not in('.','..')for p in n.split('/'))

def public_name(n):return n in ('index.html','favicon.svg','icons.svg',*TEMPLATES)or re.fullmatch(r'assets/[A-Za-z0-9_.-]+[.](?:js|css)',n)is not None

def failed_result():
 p=R1/'result.private.json';need(p.is_file()and not p.is_symlink()and p.stat().st_size<65536,'exact-untouched-original-r1-result');raw=p.read_bytes();need(sha(raw)==R1_FAILED_SHA,'sealed-original-r1-failure');v=json.loads(raw);inner=dict(v);own=inner.pop('resultSHA256',None);need(own==sha(enc(inner))and v['success']is False and v['phase']=='prepare'and v['target']==TARGET and v['sourceHead']==HEAD,'same-reviewed-source-original-failed-r1-prepare');return raw

def r1_identity(manifest):
 root=R1/'context/new-wwwroot';need(root.is_dir()and not any(p.is_symlink()for p in(root,*root.parents)),'real-original-r1-dist-root');rows={};total=0
 for parent,dirs,names in os.walk(root,followlinks=False):
  need(all(not(pathlib.Path(parent)/n).is_symlink()for n in dirs),'original-dist-no-directory-links')
  for n in names:
   p=pathlib.Path(parent)/n;name=p.relative_to(root).as_posix();need(name in manifest,'no-unreviewed-r1-dist-file');record=D.record(p,48*1024**2);st=p.lstat();rows[name]={'record':record,'device':st.st_dev,'inode':st.st_ino,'mtimeNS':st.st_mtime_ns,'ctimeNS':st.st_ctime_ns,'links':st.st_nlink};total+=record['bytes'];need(record['sha256']==manifest[name]and total<=96*1024**2,'each-original-r1-dist-body-reviewed')
 need(set(rows)==set(manifest),'all-reviewed-r1-dist-files-present-exactly');return rows,total

def bundle(dest):
 # Adopt real copies of the already verified R1 extraction, never retry extraction
 # or modify, chmod, hardlink, move, delete or rewrite any failed R1 evidence.
 base=pathlib.Path(__file__).parent
 for n,h in((PROVENANCE_FILE,PROVENANCE_SHA),(MANIFEST_FILE,MANIFEST_SHA)):
  p=base/n;need(p.is_file()and not p.is_symlink()and p.stat().st_size<=1024**2 and sha(p.read_bytes())==h,'exact-reviewed-local-public-provenance-and-manifest')
 manifest=json.loads((base/MANIFEST_FILE).read_bytes());prov=json.loads((base/PROVENANCE_FILE).read_bytes())
 need(type(manifest)is dict and 4<=len(manifest)<=200 and all(safe_name(n)and public_name(n)and pin(h)for n,h in manifest.items())and 'index.html'in manifest and all(n in manifest for n in TEMPLATES),'complete-bounded-reviewed-static-manifest')
 expected={'sourceHead':HEAD,'appTree':APP_TREE,'manifestSHA256':MANIFEST_SHA,'VITE_BASE_PATH':'/indo-shipping/','sourceExtraction':'git-archive','freshExtraction':True,'freshNpmCi':True,'npmCiExitCode':0,'buildExitCode':0,'nodeModulesRootSymlink':False,'nodeModulesExternalSymlinks':0,'repeatBuildManifestEqual':True}
 need(type(prov)is dict and all(prov.get(k)==v for k,v in expected.items()),'same-exact-clean-source-repeated-local-build-provenance')
 need(all(type(prov.get(k))is str and 0<len(prov[k])<=100 for k in('nodeVersion','npmVersion'))and pin(prov.get('packageLockSHA256',''))and sha(git('show',TARGET+':'+APP+'/web/package-lock.json'))==prov['packageLockSHA256'],'same-toolchain-and-exact-git-lock')
 failed=failed_result();identity,total=r1_identity(manifest)
 need((R1/'context/new-schema.sql').is_file()and not(R1/'context/new-schema.sql').is_symlink()and (R1/'context/new-schema.sql').stat().st_size<4*1024**2 and sha((R1/'context/new-schema.sql').read_bytes())==SCHEMA_SOURCE_SHA,'r1-extracted-whole-bootstrap-sql-reviewed')
 dest.parent.mkdir(mode=0o700,parents=True,exist_ok=True);dest.mkdir(mode=0o700);os.chmod(dest,0o755)
 for name,h in sorted(manifest.items()):
  target=dest/name;target.parent.mkdir(mode=0o700,parents=True,exist_ok=True)
  # Explicit chmod is required because main deliberately uses umask077.
  for directory in(target.parent,*target.parent.parents):
   if directory==dest.parent:break
   os.chmod(directory,0o755)
  source=R1/'context/new-wwwroot'/name;shutil.copyfile(source,target);os.chmod(target,0o644);need(sha(target.read_bytes())==h and target.stat().st_ino!=source.stat().st_ino,'new-context-real-copy-never-hardlink')
 need(identity==r1_identity(manifest)[0]and failed_result()==failed,'all-original-failed-source-inodes-modes-links-times-bytes-preserved')
 private('r1-adoption.private.json',{'r1ResultSHA256':R1_FAILED_SHA,'r1DistIdentitySHA256':sha(enc(identity)),'files':len(manifest),'bytes':total,'realCopiesNotHardlinks':True,'originalFailureUnmodified':True,'bundleReextracted':False,'sourcePackageCopiedAgain':False})
 return manifest,prov,total

def optional_image_id(name):
 r=subprocess.run(['docker','image','inspect','--format','{{.Id}}',name],capture_output=True,timeout=30,cwd=ROOT)
 need(len(r.stdout)<4096 and len(r.stderr)<65536,'bounded-selected-image-id-query')
 if r.returncode==0:
  value=r.stdout.decode().strip();need(re.fullmatch(r'sha256:[a-f0-9]{64}',value)is not None,'typed-selected-local-image-id');return value
 # Do not treat daemon errors as absence or overwrite an unexpected existing alias.
 need(r.returncode==1 and not r.stdout.strip()and re.fullmatch(rb'(?:(?:Error response from daemon|Error): )?No such image: '+re.escape(name.encode())+rb'\s*',r.stderr)is not None,'only-explicit-local-image-absence');return None

def default_builder():
 # No --bootstrap: observe the existing Docker driver, never create/start a builder.
 args=['docker','buildx','inspect','default'];r=subprocess.run(args,capture_output=True,timeout=30,cwd=ROOT)
 need(len(r.stdout)<=1024**2 and len(r.stderr)<=1024**2,'bounded-default-builder-observation');safe={'exitCode':r.returncode,'stdoutSHA256':sha(r.stdout),'stderrSHA256':sha(r.stderr)}
 need(r.returncode==0,'existing-default-builder-readable-without-bootstrap')
 selected={}
 for line in r.stdout.decode().splitlines():
  if line.strip()=='Nodes:':break
  key,sep,value=line.partition(':')
  if sep and key in('Name','Driver'):
   need(key not in selected,'single-default-builder-header-field');selected[key]=value.strip()
 need(selected=={'Name':'default','Driver':'docker'},'explicit-existing-default-docker-driver-only');safe.update(selected);private('candidate-builder-profile.private.json',safe);return safe

def build_candidate(context,tag):
 default_builder()
 alias='rrportal-indo-pr1053-base:'+OLD_CANONICAL.split(':',1)[1]
 need(optional_image_id(alias)in(None,OLD_CANONICAL),'exclusive-own-base-alias-absent-or-already-same-image')
 need(optional_image_id(tag)is None,'fresh-r2-candidate-tag-never-overwrites-r1')
 run(['docker','tag',OLD_CANONICAL,alias],limit=1024);need(image(alias)['Id']==OLD_CANONICAL,'frozen-normal-local-base-reference')
 p=context/'Dockerfile';text=p.read_text();need(text.startswith('FROM '+OLD_CANONICAL+'\n'),'only-known-bare-image-id-replacement');p.write_text('FROM '+alias+'\n'+text.split('\n',1)[1])
 try:
  r=subprocess.run(['docker','buildx','build','--builder','default','--load','--network=none','--pull=false','--no-cache','--progress=plain','--tag',tag,str(context)],capture_output=True,timeout=180,cwd=ROOT)
 except subprocess.TimeoutExpired as error:
  private('candidate-build-stdout.private.log',error.stdout or b'');private('candidate-build-stderr.private.log',error.stderr or b'');raise
 need(len(r.stdout)<=8*1024**2 and len(r.stderr)<=8*1024**2,'bounded-private-candidate-build-streams');private('candidate-build-stdout.private.log',r.stdout);private('candidate-build-stderr.private.log',r.stderr);private('candidate-build-result.private.json',{'exitCode':r.returncode,'stdoutSHA256':sha(r.stdout),'stderrSHA256':sha(r.stderr)})
 need(r.returncode==0,'fixed-offline-local-alias-candidate-build-success');need(image(alias)['Id']==OLD_CANONICAL,'base-alias-still-frozen-after-build')

def candidate_files(cid,path):
 raw=run(['docker','cp',cid+':'+path,'-'],limit=160*1024**2);result={}
 with tarfile.open(fileobj=io.BytesIO(raw),mode='r:')as tf:
  for m in tf:
   need(m.isfile()or m.isdir(),'no-link-in-candidate-files');n=m.name.rstrip('/');parts=n.split('/');need(all(x not in('.','..','')for x in parts),'safe-candidate-tar-path')
   if m.isdir():continue
   key='/'.join(parts[1:]);need(key and key not in result and 0<=m.size<=48*1024**2,'bounded-unique-candidate-file');b=tf.extractfile(m).read(m.size+1);need(len(b)==m.size,'complete-candidate-file');result[key]=sha(b)
 need(0<len(result)<=1200,'bounded-candidate-static-file-inventory');return result

def candidate_one(cid,name):
 raw=run(['docker','cp',cid+':/app/'+name,'-'],limit=40*1024**2)
 with tarfile.open(fileobj=io.BytesIO(raw),mode='r:')as tf:
  entries=tf.getmembers();need(len(entries)==1 and entries[0].isfile()and entries[0].name==pathlib.PurePosixPath(name).name and 0<=entries[0].size<=32*1024**2,'one-fixed-candidate-backend-file');data=tf.extractfile(entries[0]).read();need(len(data)==entries[0].size,'complete-candidate-backend-file');return sha(data)

def candidate_proof(image_id,expected_static,expected_backend):
 cid=run(['docker','create','--network','none',image_id],limit=1024).decode().strip();need(pin(cid),'own-never-started-scratch-id')
 try:
  need(candidate_files(cid,'/app/wwwroot')==expected_static,'entire-candidate-static-union-exact')
  need({n:candidate_one(cid,n)for n in expected_backend}==expected_backend,'compiled-backend-seed-and-only-new-schema-exact')
 finally:
  row=json.loads(run(['docker','inspect',cid],limit=4*1024**2))[0];need(row['Image']==image_id and row['State']['Status']=='created'and row['State']['Pid']==0,'only-owned-never-started-scratch');run(['docker','rm',cid],limit=1024)

def image_contract(before,after):
 need(before['Architecture']==after['Architecture']and before['Os']==after['Os']and after['RootFS']['Layers'][:len(before['RootFS']['Layers'])]==before['RootFS']['Layers'],'base-layers-and-platform-preserved')
 left=dict(before['Config']);right=dict(after['Config']);a=left.pop('Labels',None)or{};b=right.pop('Labels',None)or{};left.pop('Image',None);right.pop('Image',None)
 need(left==right and b==dict(a,**{'org.opencontainers.image.revision':TARGET,'io.rr-portal.frontend-app-tree':APP_TREE,'io.rr-portal.bootstrap-schema-sha256':SCHEMA_SOURCE_SHA}),'all-config-env-user-command-health-preserved-only-version-labels')

def prepare(schema):
 before,app,_=state();need(before['canonical']==OLD_CANONICAL,'unchanged-old-canonical');start=capacity(True)
 old=live_static(app);backend=live_backend(app);D.code_profile(app);D.source_proof(app)
 status,headers,content=http();need(status==200 and sha(content)==old['index.html']['sha256'],'old-public-index-exact');old_headers={k.lower():v for k,v in headers.items()if k.lower()in('etag','last-modified')};need(set(old_headers)=={'etag','last-modified'},'old-conditional-cache-validators')
 new,prov,total=bundle(OUT/'context/new-wwwroot');need(total*4+32*1024**2<=BUDGET,'bounded-four-complete-dist-copies-plus-evidence-peak');need(all(old[n]['sha256']==new[n]for n in TEMPLATES),'all-three-template-bodies-preserved')
 additions=[]
 for n,h in new.items():
  if n=='index.html':continue
  if n in old:need(old[n]['sha256']==h,'no-overwriting-old-hashed-or-fixed-static-file')
  else:need(n.startswith('assets/')and n.endswith(('.js','.css')),'only-add-content-hashed-assets');additions.append(n)
 private('old-index.private.html',(pathlib.Path('/proc')/str(app['State']['Pid'])/'root/app/wwwroot/index.html').read_bytes());private('old-schema.private.sql',(pathlib.Path('/proc')/str(app['State']['Pid'])/'root/app/db/postgres_schema.sql').read_bytes())
 (OUT/'context/new-schema.sql').write_bytes(schema);os.chmod(OUT/'context/new-schema.sql',0o644)
 static_meta=old['index.html'];sql_meta=backend['db/postgres_schema.sql'];need(static_meta['mode']==sql_meta['mode']==0o644,'original-static-and-bootstrap-mode')
 dockerfile='FROM '+OLD_CANONICAL+'\nCOPY --chown='+str(static_meta['uid'])+':'+str(static_meta['gid'])+' new-wwwroot/ /app/wwwroot/\nCOPY --chown='+str(sql_meta['uid'])+':'+str(sql_meta['gid'])+' new-schema.sql /app/db/postgres_schema.sql\nLABEL org.opencontainers.image.revision="'+TARGET+'" io.rr-portal.frontend-app-tree="'+APP_TREE+'" io.rr-portal.bootstrap-schema-sha256="'+SCHEMA_SOURCE_SHA+'"\n'
 (OUT/'context/Dockerfile').write_text(dockerfile)
 tag='rrportal-indo-pr1053-r2:'+TARGET
 build_candidate(OUT/'context',tag)
 candidate=image(tag);image_contract(image(OLD_CANONICAL),candidate);expected_backend={n:r['sha256']for n,r in backend.items()};expected_backend['db/postgres_schema.sql']=SCHEMA_SOURCE_SHA
 candidate_proof(candidate['Id'],dict(body_manifest(old),**new),expected_backend)
 adoption=json.loads((OUT/'r1-adoption.private.json').read_bytes());need(failed_result()==(R1/'result.private.json').read_bytes()and sha(enc(r1_identity(new)[0]))==adoption['r1DistIdentitySHA256'],'original-r1-failure-and-all-source-metadata-still-identical')
 after,app2,_=state();need(before==after and old==live_static(app2)and backend==live_backend(app2),'prepare-no-live-runtime-config-auth-static-schema-changes');capacity()
 p={'state':before,'oldStatic':old,'backend':backend,'newStatic':new,'additions':sorted(additions),'candidate':candidate['Id'],'tag':tag,'newBytes':total,'sourceHead':HEAD,'target':TARGET,'appTree':APP_TREE,'provenanceSHA256':PROVENANCE_SHA,'spaceBefore':start,'expectedBackend':expected_backend,'oldHeaders':old_headers};private('prepared.private.json',p)
 return {'candidate':candidate['Id'],'newFiles':len(new),'newAssets':len(additions),'sourceHead':HEAD,'target':TARGET,'compiledBackendSourceUnchanged':D.BACKEND_REVISION,'bootstrapSchemaSHA256':SCHEMA_SOURCE_SHA,'noAppRestart':True}

def prepared():
 r=read_sealed(ARCHIVE/'prepare/result.private.json',PREPARE_RESULT_SHA);need(r['phase']=='prepare'and r['target']==TARGET,'same-target-prepared-result');path=ARCHIVE/'prepare/prepared.private.json';raw=path.read_bytes();need(sha(raw)==r['preparedBodySHA256'],'sealed-complete-prepared-plan');return json.loads(raw)

def target_paths(app):return pathlib.Path('/proc')/str(app['State']['Pid'])/'root/app'
def publication_check(app,p):
 need(live_backend(app)==dict(p['backend'],**{'db/postgres_schema.sql':dict(p['backend']['db/postgres_schema.sql'],sha256=SCHEMA_SOURCE_SHA,bytes=len(git('show',TARGET+':'+APP+'/db/postgres_schema.sql')))}),'only-bootstrap-source-body-changed')
 actual=live_static(app);need(body_manifest(actual)==dict(body_manifest(p['oldStatic']),**p['newStatic']),'all-old-assets-retained-and-every-new-body-present')
 for n,row in p['oldStatic'].items():
  if n!='index.html':need(actual[n]==row,'all-original-nonindex-static-metadata-and-bytes-preserved')

def http(path='',headers=None):
 need(path==''or safe_name(path),'fixed-relative-public-route')
 request=urllib.request.Request('http://127.0.0.1/indo-shipping/'+path,headers={'Cache-Control':'no-cache',**(headers or {})})
 class NoRedirect(urllib.request.HTTPRedirectHandler):
  def redirect_request(self,*args,**kwargs):return None
 opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),NoRedirect())
 try:
  with opener.open(request,timeout=20)as response:
   body=response.read(64*1024**2+1);need(len(body)<=64*1024**2,'bounded-readonly-public-response');return response.status,dict(response.headers),body
 except urllib.error.HTTPError as e:
  try:return e.code,dict(e.headers),e.read(1024)
  finally:e.close()

def public_check(p):
 status,headers,body=http();need(status==200 and sha(body)==p['newStatic']['index.html'],'actual-public-index-is-reviewed-new-index')
 union=dict(body_manifest(p['oldStatic']),**p['newStatic']);checked=0
 for name,expected in union.items():
  if name.startswith('assets/')or name in TEMPLATES:
   code,_,body=http(name);need(code==200 and sha(body)==expected,'every-old-and-new-asset-and-template-public-exact');checked+=1
 for key,header in(('etag','If-None-Match'),('last-modified','If-Modified-Since')):
  code,_,body=http(headers={header:p['oldHeaders'][key]});need(code==200 and sha(body)==p['newStatic']['index.html'],'old-cache-validator-reloads-reviewed-index')
 code,_,body=http('purchase');need(code==200 and sha(body)==p['newStatic']['index.html'],'spa-purchase-fallback-new-index')
 code,_,_=http('api/health');need(code==200,'backend-health-select1-200')
 code,_,_=http('api/purchase');need(code==401,'anonymous-purchase-still-protected401')
 return {'indexStatus':status,'indexSHA256':p['newStatic']['index.html'],'allOldNewAssetsAndThreeTemplates200AndExact':True,'assetRequests':checked,'oldCacheValidatorsReload200':True,'spaFallback200':True,'health200':True,'anonymousPurchase401':True}

def deploy(schema):
 p=prepared();before,app,_=state();need(before==p['state']and live_static(app)==p['oldStatic']and live_backend(app)==p['backend']and image(p['tag'])['Id']==p['candidate'],'exact-prepared-live-and-candidate-cas');capacity(remaining=p['newBytes']+16*1024**2)
 root=target_paths(app);stage=root/('.pr1053-'+TARGET);need(not stage.exists()and not stage.is_symlink(),'new-one-use-live-static-stage');stage.mkdir(mode=0o700)
 checkpoint('00-stage',state='staging',candidate=p['candidate'])
 try:
  # Staging and every new byte precede SQL/index publication. Existing assets are never replaced.
  new=ARCHIVE/'prepare/context/new-wwwroot'
  for n,h in p['newStatic'].items():
   target=stage/n;target.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(new/n,target);need(sha(target.read_bytes())==h,'exact-staged-public-file');os.chown(target,p['oldStatic']['index.html']['uid'],p['oldStatic']['index.html']['gid']);os.chmod(target,0o644);sync_file(target)
  next_sql=stage/'new-schema.sql';next_sql.write_bytes(schema);meta=p['backend']['db/postgres_schema.sql'];os.chown(next_sql,meta['uid'],meta['gid']);os.chmod(next_sql,meta['mode']);need(sha(next_sql.read_bytes())==SCHEMA_SOURCE_SHA,'staged-bootstrap-source');sync_file(next_sql)
  for n in p['additions']:
   target=root/'wwwroot'/n;need(not target.exists()and not target.is_symlink()and target.parent.is_dir()and not target.parent.is_symlink(),'new-asset-only-cas');os.link(stage/n,target)
  sync_dir(root/'wwwroot/assets');sync_dir(stage)
  # The SQL is read only on future startup; current API remains running the same DLLs.
  need(live_backend(app)==p['backend'],'old-bootstrap-and-compiled-code-cas-immediately-before-publication')
  checkpoint('10-schema-intent',state='publishing-bootstrap-source',schemaFileCommitAttempted=True);os.replace(next_sql,root/'db/postgres_schema.sql');sync_dir(root/'db');checkpoint('11-schema-ack',state='bootstrap-source-published',schemaFileCommitted=True)
  index=root/'wwwroot/index.html';need(D.record(index)==p['oldStatic']['index.html'],'original-index-cas-immediately-before-last-commit')
  # Fresh whole-second mtime prevents equal-size HTTP conditional-cache reuse.
  stamp=max(int(time.time()),int(index.stat().st_mtime)+2);need(stamp<=int(time.time())+3,'bounded-new-index-cache-time')
  while time.time()<stamp:time.sleep(.1)
  os.utime(stage/'index.html',(stamp,stamp));checkpoint('20-index-intent',state='publishing-index-last',indexCommitAttempted=True);os.replace(stage/'index.html',index);sync_dir(root/'wwwroot');checkpoint('21-index-ack',state='live-index-published',indexCommitted=True)
  publication_check(app,p);checks=public_check(p);after,app2,_=state();need(after==before,'all-original46-runtime-env-config-auth-and-alias-unchanged-before-durable-tag');capacity()
  need(aliases()==OLD_CANONICAL,'old-canonical-alias-cas');checkpoint('30-tag-intent',state='publishing-durable-canonical',tagCommitAttempted=True);run(['docker','tag',p['candidate'],CANONICAL],limit=1024);need(aliases()==p['candidate'],'durable-canonical-new-image');checkpoint('31-tag-ack',state='durable-canonical-published',tagCommitted=True)
  final,app3,_=state();expected=dict(before,canonical=p['candidate']);need(final==expected,'only-canonical-alias-changed-all-runtime-preserved');publication_check(app3,p)
  checkpoint('40-complete',state='live-and-durable-publication-verified')
  return {'target':TARGET,'sourceHead':HEAD,'runtime':final,'checks':checks,'candidate':p['candidate'],'compiledBackendSourceUnchanged':D.BACKEND_REVISION,'bootstrapSchemaSHA256':SCHEMA_SOURCE_SHA,'noAppRestart':True,'disposition':dict(DISPOSITION)}
 except BaseException:
  DISPOSITION['state']='partial-or-uncertain-readonly-reconcile-required'
  try:DISPOSITION.update(observedIndexSHA256=D.record(root/'wwwroot/index.html')['sha256'],observedSchemaSHA256=D.record(root/'db/postgres_schema.sql')['sha256'],observedCanonical=aliases());checkpoint('90-failure-observation')
  except Exception:pass
  raise

def verify():
 p=prepared();r=read_sealed(ARCHIVE/'deploy/result.private.json',DEPLOY_RESULT_SHA);need(r['phase']=='deploy'and r['target']==TARGET,'same-target-deployed-result');before,app,_=state();need(before==r['details']['runtime']and before['canonical']==p['candidate'],'same-deployed-runtime-and-canonical');publication_check(app,p);candidate_proof(p['candidate'],dict(body_manifest(p['oldStatic']),**p['newStatic']),p['expectedBackend']);checks=public_check(p);after,app2,_=state();need(before==after,'verify-all-runtime-config-auth-and-alias-stable');publication_check(app2,p);capacity();return {'liveServicesAndBusinessDataReadOnly':True,'ownedNeverStartedScratchCreatedAndRemoved':True,'target':TARGET,'checks':checks,'noAppRestart':True}

def reconcile():
 p=prepared();before,app,_=state();actual=live_static(app);backend=live_backend(app);current=body_manifest(actual);old=body_manifest(p['oldStatic']);new=dict(old,**p['newStatic'])
 allowed=all(name in new and value in{old.get(name),new[name]}for name,value in current.items())
 preserved=all(current.get(name)==value for name,value in old.items()if name!='index.html')
 journal={}
 for path in sorted((ARCHIVE/'deploy').glob('publication-*.private.json')):
  need(path.is_file()and not path.is_symlink()and path.stat().st_size<65536,'bounded-original-publication-journal');journal[path.name]=json.loads(path.read_bytes())
 after,app2,_=state();need(before==after and actual==live_static(app2)and backend==live_backend(app2),'read-only-reconcile-runtime-and-files-stable')
 return {'liveServicesAndBusinessDataReadOnly':True,'mutationPerformed':False,'noAutomaticRetryOrRollback':True,'canonical':before['canonical'],'canonicalIsOld':before['canonical']==OLD_CANONICAL,'canonicalIsCandidate':before['canonical']==p['candidate'],'indexIsOld':current.get('index.html')==old['index.html'],'indexIsNew':current.get('index.html')==p['newStatic']['index.html'],'bootstrapIsOld':backend['db/postgres_schema.sql']['sha256']==p['backend']['db/postgres_schema.sql']['sha256'],'bootstrapIsNew':backend['db/postgres_schema.sql']['sha256']==SCHEMA_SOURCE_SHA,'compiledBackendAndSeedPreserved':all(backend[n]==p['backend'][n]for n in CODE),'allOldNonIndexFilesPreserved':preserved,'onlyKnownOldOrNewPublicBodies':allowed,'missingExpectedNewFiles':sum(current.get(n)!=h for n,h in p['newStatic'].items()),'journal':journal}

def main():
 global OUT
 need(EXECUTE is True and sys.argv[1:]in(['prepare'],['deploy'],['verify'],['reconcile'])and os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_MODE')==sys.argv[1]and os.environ.get('RELEASE_ATTEMPT')=='1','inert-first-scoped-publication')
 phase=sys.argv[1];os.umask(0o077);need(ARCHIVE.parent.is_dir()and not any(p.is_symlink()for p in(ARCHIVE.parent,*ARCHIVE.parent.parents)),'real-private-archive-parent')
 if phase=='prepare':need(not ARCHIVE.exists(),'fresh-release-root');ARCHIVE.mkdir(mode=0o700)
 need(ARCHIVE.is_dir()and not ARCHIVE.is_symlink(),'existing-owned-release-root');OUT=ARCHIVE/phase;need(not OUT.exists(),'one-phase-one-attempt');OUT.mkdir(mode=0o700);load()
 result={'phase':phase,'target':TARGET,'sourceHead':HEAD,'success':False,'businessRowWrites':False,'originalConfigurationWrites':False,'originalRuntimeLifecycleWrites':False,'ownedNeverStartedScratchLifecycleWrites':phase in('prepare','verify')}
 try:
  schema=None if phase=='reconcile'else source();result['details']={'prepare':lambda:prepare(schema),'deploy':lambda:deploy(schema),'verify':verify,'reconcile':reconcile}[phase]()
  if phase=='prepare':result['preparedBodySHA256']=sha((OUT/'prepared.private.json').read_bytes())
  result['success']=True
 except Exception as error:result.update(errorType=type(error).__name__,stage=STAGE,disposition=dict(DISPOSITION))
 result['resultSHA256']=sha(enc(result));private('result.private.json',result);D.wire(result);return 0 if result['success']else 1
if __name__=='__main__':sys.exit(main())
