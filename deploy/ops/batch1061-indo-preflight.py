"""INERT fresh Indo-only read-only profile. Never import a historical profile as current.
BASE/sourceHint is a review hint only; no claim that live binaries/static files came from it.
Raw Docker Config/Env and environment/auth bodies are consumed only in memory and hashed.
Only diagnose mode exists; no explicit SQL client/business query, exec/run/start/stop/restart, fetch, configuration write,
application startup, payload copy, image mutation, cleanup or credential export is allowed.
The only writes are a NEW private diagnostic archive containing hashes/metadata and a <=4MiB result.
"""
import hashlib,importlib.util,json,os,pathlib,re,stat,subprocess,sys
ROOT=pathlib.Path('/opt/rr-portal')
ARCHIVE=ROOT/'deploy/backups/batch1061-indo-preflight-1-20261103'
BASE='e6459c7e9d7483527f7b22abbe93753183075fb8'
BRANCH='refs/heads/codex/ops-batch1056-1060-20261103'
EXECUTE=False
APP='apps/印尼小组/印尼走货明细';SERVICE='indo-shipping'
DEPS={'pr1044-indo-preflight.py':'940e9675d628bc0af628ac3964b9073069f99d682a7bc812960ac6e1b88d3004',
      'pr1035-quote-preflight.py':'2b2739aa00cad03bfce8472b7416d725364b8d4ed354a5a7e9ca905a47aaffa5'}
# Both pinned helpers have only Python-standard-library imports; no extra dynamic helper is loaded.
P=None;Q=None;SERIAL=0;STAGE='entry'
def need(value,label):
 global STAGE
 STAGE=label
 if not value:raise RuntimeError(label)
def enc(value):return json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=True,allow_nan=False).encode()
def sha(value):return hashlib.sha256(value).hexdigest()
def pin(value,width=64):return type(value)is str and re.fullmatch('[a-f0-9]{%d}'%width,value)is not None
def allowed_command(args):
 if not(type(args)is list and all(type(v)is str for v in args)):return False
 if args[:1]==['docker']:
  if args[1:]==['ps','-aq','--no-trunc']or args[1:]==['info','--format','{{json .DockerRootDir}}']:return True
  if args[1:]==['ps','-aq','--no-trunc','--filter','label=com.docker.compose.project=rr-portal','--filter','label=com.docker.compose.service=nginx']:return True
  if len(args)>2 and args[1]=='inspect'and len(args)<=1002 and all(pin(v)for v in args[2:]):return True
  if len(args)==5 and args[1:4]==['inspect','--format','{{json .Mounts}}']and pin(args[4]):return True
  if args[1:]==['image','inspect','rr-portal-indo-shipping:latest']:return True
  return False
 prefix=['git','-C',str(ROOT),'-c','core.hooksPath=/dev/null']
 return args[:len(prefix)]==prefix and args[len(prefix):]in[
  ['rev-parse','HEAD'],['rev-parse','HEAD^{tree}'],['rev-parse','HEAD:'+APP],
  ['diff','--name-only','-z'],['diff','--cached','--name-only','-z']]
def command(args,data=None,timeout=90,limit=16*1024**2):
 need(data is None and allowed_command(args),'only-fixed-readonly-docker-inspect-and-local-git-metadata-commands')
 result=subprocess.run(args,capture_output=True,cwd=ROOT,timeout=timeout,
  env=dict(os.environ,GIT_OPTIONAL_LOCKS='0',GIT_TERMINAL_PROMPT='0'))
 need(result.returncode==0 and len(result.stdout)<=limit and len(result.stderr)<=1024**2,'bounded-readonly-command-in-memory-no-raw-stream-export')
 return result.stdout
def git(*args):return command(['git','-C',str(ROOT),'-c','core.hooksPath=/dev/null',*args])
def private(name,value):
 global SERIAL
 SERIAL+=1
 need(type(name)is str and re.fullmatch(r'[A-Za-z0-9_.-]+',name),'fixed-private-evidence-name')
 body=enc(value);need(len(body)<=4*1024**2,'bounded-private-hash-metadata-artifact')
 path=ARCHIVE/('%04d-'%SERIAL+name)
 fd=os.open(path,os.O_CREAT|os.O_EXCL|os.O_WRONLY|os.O_NOFOLLOW,0o600)
 with os.fdopen(fd,'wb')as stream:stream.write(body);stream.flush();os.fsync(stream.fileno())
def save_result(value):
 body=enc(value);need(len(body)<=4*1024**2,'result-at-most-four-mib')
 fd=os.open(ARCHIVE/'result.private.json',os.O_CREAT|os.O_EXCL|os.O_WRONLY|os.O_NOFOLLOW,0o600)
 with os.fdopen(fd,'wb')as stream:stream.write(body);stream.flush();os.fsync(stream.fileno())
def load(name):
 path=pathlib.Path(__file__).with_name(name)
 need(name in DEPS and path.is_file()and not path.is_symlink()and sha(path.read_bytes())==DEPS[name],'exact-reviewed-readonly-helper-and-dependency-bytes-before-import')
 spec=importlib.util.spec_from_file_location('batch1061_profile_'+name.replace('.','_'),path);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
 module.ROOT=ROOT;module.OUT=ARCHIVE;return module
def initialize():
 global P,Q
 P=load('pr1044-indo-preflight.py');Q=load('pr1035-quote-preflight.py')
 P.command=lambda args,timeout=45,limit=16*1024**2:command(args,timeout=timeout,limit=limit)
 Q.command=lambda args,limit=8*1024**2,data=None,timeout=90:command(args,data=data,timeout=timeout,limit=limit)
 P.private=private

def environment_files():
 paths=sorted(ROOT.glob('.env*'));need(0<len(paths)<=100,'bounded-existing-environment-files-hash-only')
 result={}
 for path in paths:
  need(path.is_file()and not path.is_symlink(),'environment-file-is-regular-no-link-follow')
  result[str(path.relative_to(ROOT))]=Q.shared_file(str(path))
 need('.env.cloud.production'in result,'actual-production-env-file-hashed-without-export')
 return result

def observe():
 runtime,target=P.runtime()
 need(target['State']['Running']and target['State'].get('Health',{}).get('Status')=='healthy'and not target['State']['OOMKilled'],'actual-indo-healthy-before-readonly-profile')
 shared=P.shared();unstaged=P.dirty(git('diff','--name-only','-z'));staged=P.dirty(git('diff','--cached','--name-only','-z'))
 web=P.web_inventory(target);backend=P.backend_inventory(target)
 host=git('rev-parse','HEAD').decode().strip();tree=git('rev-parse','HEAD^{tree}').decode().strip();app_tree=git('rev-parse','HEAD:'+APP).decode().strip()
 need(all(pin(v,40)for v in(host,tree,app_tree)),'typed-observed-host-commits-and-app-tree-no-source-match-claim')
 return {'allRuntime':runtime,'observedContainerCount':len(runtime),'containerId':target['Id'],'runtime':runtime[target['Id']],
  'mounts':target['Mounts'],'shared':shared,'unstaged':unstaged,'staged':staged,'canonicalImage':P.image(),
  'wwwroot':web,'backendFiles':backend,'public':P.public_profile(web['files']['index.html']['sha256']),
  'hostGitHead':host,'hostGitTree':tree,'observedHostAppTree':app_tree,'env':environment_files(),'gatewayAuth':Q.gateway_auth(),
  'containerEnvHashes':{cid:row['envSHA256']for cid,row in runtime.items()}}
def space():
 root=json.loads(command(['docker','info','--format','{{json .DockerRootDir}}']))
 need(type(root)is str and pathlib.Path(root).is_absolute(),'typed-existing-docker-root')
 values=os.statvfs(root)
 return {'available':values.f_bavail*values.f_frsize,'free':values.f_bfree*values.f_frsize,'dockerRootPathSHA256':sha(os.fsencode(root))}
def wire(value):
 raw=enc(value);need(len(raw)<=4*1024**2,'four-mib-maximum-wire-result');nibbles=lambda v:[int(c,16)for c in(format(v,'x')if type(v)is int else v)]
 parts=[raw[i:i+1024]for i in range(0,len(raw),1024)];digest=nibbles(sha(raw))
 for index,body in enumerate(parts):print(enc([0,nibbles(index+1),nibbles(len(parts)),nibbles(len(raw)),digest,nibbles(body.hex())]).decode(),flush=True)
 print(enc([1,nibbles(len(parts)),nibbles(len(raw)),digest]).decode(),flush=True)
def main():
 need(EXECUTE is True and sys.argv[1:]==['diagnose']and os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_MODE')=='diagnose'and os.environ.get('RELEASE_ATTEMPT')=='1'and pin(BASE,40),'inert-one-shot-diagnose-only-source-hint-workflow')
 os.umask(0o077)
 need(ARCHIVE.parent.is_dir()and not any(path.is_symlink()for path in(ARCHIVE.parent,*ARCHIVE.parent.parents))and not ARCHIVE.exists()and not ARCHIVE.is_symlink(),'new-private-numbered-profile-no-relabel-or-replay')
 ARCHIVE.mkdir(mode=0o700)
 result={'phase':'diagnose','mode':'diagnose','service':SERVICE,'sourceHint':BASE,'sourceHintOnly':True,'liveSourceMatchClaimed':False,
  'success':False,'readOnly':True,'explicitSqlAccessPerformed':False,'healthReadOnlyProbe':True,'lifecycleOrConfigOrBusinessWrites':False,'environmentFileRead':True,'environmentFileHashedOnly':True,
  'environmentFileBodiesCopied':False,'rawDockerConfigOrEnvExported':False,'plaintextCredentialsWritten':False,'businessFileBodiesCopied':False}
 try:
  initialize();before=observe();result.update(before);result['spaceBefore']=space();after=observe();result['space']=space()
  need(before==after,'same-start-end-all-stopped-runtime-shared-dirty-canonical-static-backend-public-host-env-and-auth')
  result.update(allOriginalRuntimeUnchanged=True,allObservedContractsUnchanged=True,finalObservationSHA256=sha(enc(after)),success=True)
 except Exception as error:
  result.update(errorType=type(error).__name__,stage=STAGE,dependencyStageP=getattr(P,'STAGE',None),dependencyStageQ=getattr(Q,'STAGE',None))
 result['resultSHA256']=sha(enc(result));save_result(result);wire(result);return 0 if result['success']else 1
if __name__=='__main__':sys.exit(main())
