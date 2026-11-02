"""INERT one-use read-only R1 postmortem. Never build, tag, copy, restart, retry or clean."""
import datetime,hashlib,importlib.util,json,os,pathlib,re,stat,subprocess,sys
EXECUTE=True
ROOT=pathlib.Path('/opt/rr-portal')
OUT=ROOT/'deploy/backups/pr1053-static-postmortem-1-20261102'
FAILED=ROOT/'deploy/backups/pr1053-static-1-20261102/prepare'
FAILED_RESULT_SHA='46c5d824b8b5f2c02788054151e61e0c9123e0b3940b42a59f5f2ca1e8f1fbab'
REFERENCE=ROOT/'deploy/backups/pr1053-preflight-1-20261102/result.private.json'
REFERENCE_SHA='9e98f4cc963316f45d545906647d3bc0fbb03b60f6dfb5dfecac744fff658007'
BRANCH='refs/heads/codex/ops-pr1053-20261102'
TARGET='114b5cc9867960518ebe70f6731475c97fec3747'
HEAD='47dfe8800b60090476d1ea51b7d9c1b8ab66f0cf'
CANDIDATE='rrportal-indo-pr1053:'+TARGET
OLD_IMAGE='sha256:60d7deef2fe58c1c6ca66977b43392c570f11e31cc7f6d38f12fad2f2d201cee'
D_FILE='pr1053-preflight.py'
D_SHA='0aeb31f9a4aea3f9d67eb8489687d7a035aa8f7fd8ea34ede9c6bd56dace9f25'
D=None
STAGE='entry'

def enc(v):return json.dumps(v,sort_keys=True,separators=(',',':'),ensure_ascii=True,allow_nan=False).encode()
def sha(v):return hashlib.sha256(v).hexdigest()
def need(v,label):
 global STAGE
 STAGE=label
 if not v:raise RuntimeError(label)
def private(name,value):D.write_private(name,value if type(value)is bytes else enc(value))
def sealed(path,digest,success):
 need(path.is_file()and not path.is_symlink()and path.stat().st_size<=4*1024**2,'bounded-real-sealed-private-result');raw=path.read_bytes();need(sha(raw)==digest,'exact-prior-result-body');v=json.loads(raw);inner=dict(v);seal=inner.pop('resultSHA256',None);need(seal==sha(enc(inner))and v['success']is success,'expected-prior-outcome-and-self-seal');return v

def inventory():
 need(FAILED.is_dir()and not any(p.is_symlink()for p in(FAILED,*FAILED.parents)),'real-original-failed-archive')
 files={};directories=0;total=0
 for parent,dirs,names in os.walk(FAILED,followlinks=False):
  directories+=len(dirs);need(directories<=100 and all(not(pathlib.Path(parent)/n).is_symlink()for n in dirs),'bounded-nonsymlink-archive-directories')
  for name in sorted(names):
   p=pathlib.Path(parent)/name;n=p.relative_to(FAILED).as_posix();row=D.record(p,80*1024**2);files[n]=row;total+=row['bytes'];need(len(files)<=300 and total<=192*1024**2,'bounded-original-failed-archive-file-inventory')
 private('failed-archive-inventory.private.json',files)
 known=('result.private.json','old-index.private.html','old-schema.private.sql','context/Dockerfile','context/new-schema.sql','context/new-wwwroot/index.html','prepared.private.json')
 dockerfile=FAILED/'context/Dockerfile';syntax={'present':dockerfile.is_file(),'fromBareImageID':False,'fromExactOldImage':False}
 if dockerfile.is_file():
  need(not dockerfile.is_symlink()and dockerfile.stat().st_size<8192,'bounded-original-dockerfile');body=dockerfile.read_bytes();lines=body.decode('ascii').splitlines();first=lines[0]if lines else''
  syntax.update(fromBareImageID=re.fullmatch(r'FROM sha256:[a-f0-9]{64}',first)is not None,fromExactOldImage=first=='FROM '+OLD_IMAGE,sha256=sha(body))
 return {'files':len(files),'directories':directories,'bytes':total,'inventorySHA256':sha(enc(files)),'knownFiles':{n:files.get(n)for n in known},'dockerfile':syntax,'rawNamesRemainPrivate':True}

def capture(name,args,limit=4*1024**2,persist_stdout=True):
 # Only fixed readonly Docker version/info/inspect commands are passed by main.
 r=subprocess.run(args,capture_output=True,timeout=30,cwd=ROOT)
 need(len(r.stdout)<=limit and len(r.stderr)<=limit,'bounded-readonly-docker-observation')
 if persist_stdout:private(name+'-stdout.private.log',r.stdout)
 private(name+'-stderr.private.log',r.stderr)
 return r,{'exitCode':r.returncode,'stdoutBytes':len(r.stdout),'stderrBytes':len(r.stderr),'stdoutSHA256':sha(r.stdout),'stderrSHA256':sha(r.stderr),'rawStdoutPersisted':persist_stdout}

def builder():
 r,safe=capture('docker-version',['docker','version','--format','{"client":{{json .Client.Version}},"server":{{json .Server.Version}}}'])
 need(r.returncode==0,'current-docker-version-readable');v=json.loads(r.stdout);need(set(v)=={'client','server'}and all(type(x)is str and re.fullmatch(r'[A-Za-z0-9_.+-]{1,100}',x)for x in v.values()),'typed-docker-version-only');safe['versions']=v
 bx,bs=capture('buildx-version',['docker','buildx','version'],65536);text=bx.stdout.decode(errors='replace');match=re.fullmatch(r'github[.]com/docker/buildx (v[0-9A-Za-z_.+-]{1,60}) [a-f0-9]{7,64}\s*',text)
 bs['recognizedVersion']=match[1]if match else None
 info,ins=capture('docker-storage-driver',['docker','info','--format','{{json .Driver}}'],65536);need(info.returncode==0,'docker-storage-driver-readable');driver=json.loads(info.stdout);ins['knownDriver']=driver if driver in('overlay2','overlayfs','fuse-overlayfs','aufs','btrfs','zfs','devicemapper','vfs','windowsfilter')else'other'
 value=os.environ.get('DOCKER_BUILDKIT');return {'docker':safe,'buildx':bs,'storage':ins,'explicitBuildkitEnvironment':value if value in(None,'0','1')else'other-value-not-returned'}

def candidate():
 r,safe=capture('candidate-image-inspect',['docker','image','inspect',CANDIDATE],persist_stdout=False)
 if r.returncode!=0:return {'present':False,'inspect':safe,'absenceOrInspectionErrorMustBeDistinguishedByPrivateStderr':True}
 rows=json.loads(r.stdout);need(type(rows)is list and len(rows)==1,'one-selected-candidate-image');v=rows[0];need(re.fullmatch(r'sha256:[a-f0-9]{64}',v['Id'])is not None,'typed-candidate-id')
 # Full image Config may contain inherited secrets: never emit or persist inspect stdout.
 return {'present':True,'id':v['Id'],'bytes':v['Size'],'created':v['Created'],'configSHA256':sha(enc(v['Config'])),'rootFSSHA256':sha(enc(v['RootFS'])),'inspect':safe}

def observe():
 old=sealed(REFERENCE,REFERENCE_SHA,True);failed=sealed(FAILED/'result.private.json',FAILED_RESULT_SHA,False)
 need(failed['phase']=='prepare'and failed['target']==TARGET and failed['sourceHead']==HEAD,'exact-failed-r1-reviewed-source')
 before,app,db=D.runtime();host=D.host();auth=D.gateway_auth();canon=D.canonical_profile();code=D.code_profile(app);static=D.static_profile(app)
 need(before==old['allRuntime']and host==old['host']and auth==old['gatewayAuth']and canon==old['canonical']and code==old['backendFiles']and static==old['static'],'all-original46-source-config-auth-canonical-and-static-still-equal-preflight')
 first=inventory();build=builder();selected=candidate();pg=D.postgres(db)
 after,app2,db2=D.runtime();need(before==after and host==D.host()and auth==D.gateway_auth()and canon==D.canonical_profile()and code==D.code_profile(app2)and static==D.static_profile(app2,False)and db['Id']==db2['Id']and first==inventory_repeat(),'postmortem-all-runtime-host-code-static-and-original-failure-evidence-stable')
 return {'allRuntime':before,'host':host,'gatewayAuth':auth,'canonical':canon,'backendFiles':code,'static':static,'archive':first,'builder':build,'candidate':selected,'postgres':pg,'capacity':D.capacity(),'originalFailureRetained':True,'originalPrepareNotReplayed':True}

def inventory_repeat():
 # Inventory() intentionally writes only once; repeat under a new private filename.
 original=D.write_private
 def renamed(name,body):return original('repeat-'+name,body)
 D.write_private=renamed
 try:return inventory()
 finally:D.write_private=original

def load():
 global D
 p=pathlib.Path(__file__).with_name(D_FILE);need(p.is_file()and not p.is_symlink()and sha(p.read_bytes())==D_SHA,'exact-readonly-preflight-dependency')
 spec=importlib.util.spec_from_file_location('postmortem1053_diag',p);D=importlib.util.module_from_spec(spec);spec.loader.exec_module(D);D.OUT=OUT

def main():
 need(EXECUTE is True and sys.argv[1:]==['diagnose']and os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_MODE')=='diagnose'and os.environ.get('RELEASE_ATTEMPT')=='1','inert-first-readonly-postmortem')
 os.umask(0o077);need(OUT.parent.is_dir()and not any(p.is_symlink()for p in(OUT.parent,*OUT.parent.parents))and not OUT.exists(),'fresh-postmortem-private-directory');OUT.mkdir(mode=0o700);load()
 v={'phase':'diagnose','target':TARGET,'success':False,'readOnly':True,'lifecycleWrites':False,'businessWrites':False,'configurationWrites':False,'buildTagCopyOrCleanupPerformed':False}
 try:v['details']=observe();v['success']=True
 except Exception as error:v.update(errorType=type(error).__name__,stage=STAGE,diagnosticStage=D.STAGE)
 v['utc']=datetime.datetime.now(datetime.timezone.utc).isoformat();v['resultSHA256']=sha(enc(v));private('result.private.json',v);D.wire(v);return 0 if v['success']else 1
if __name__=='__main__':sys.exit(main())
