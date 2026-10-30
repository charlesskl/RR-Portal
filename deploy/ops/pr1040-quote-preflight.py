"""INERT fresh Quote profile; no lifecycle, business writes or old-phase replay."""
import hashlib,importlib.util,json,os,pathlib,re,stat,subprocess,sys
ROOT=pathlib.Path('/opt/rr-portal');OUT=ROOT/'deploy/backups/pr1040-quote-preflight-1'
APP='apps/业务部/内部报价系统';SERVICE='internal-quote';ALIAS='rr-portal-internal-quote:latest'
BRANCH='refs/heads/ops/pr-1040-20261030-quote';SOURCE_BASE='80e027a75f306f1fff50033672c52201dc4ab0bf';EXECUTE=True
COMMON_NAME='pr1035-quote-preflight.py';COMMON_SHA256='2b2739aa00cad03bfce8472b7416d725364b8d4ed354a5a7e9ca905a47aaffa5'
AFFECTED=('backend/routes/quotes.js','backend/routes/summary.js','backend/routes/verifications.js','frontend/main.js')
STAGE='entry'
def need(value,label):
 global STAGE
 STAGE=label
 if not value:raise RuntimeError(label)
def enc(value):return json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=True,allow_nan=False).encode()
def sha(body):return hashlib.sha256(body).hexdigest()
def private(name,value):
 fd=os.open(OUT/name,os.O_CREAT|os.O_EXCL|os.O_WRONLY|os.O_NOFOLLOW,0o600)
 with os.fdopen(fd,'wb')as f:f.write(enc(value));f.flush();os.fsync(f.fileno())
def command(args,timeout=90,limit=16*1024**2):
 # Docker Config/Env are consumed only in memory, never command logs.
 r=subprocess.run(args,cwd=ROOT,capture_output=True,timeout=timeout);need(r.returncode==0 and len(r.stdout)<=limit,'fixed-read-command-success-bounded');return r.stdout
def git(*args):return command(['git','-C',str(ROOT),'-c','core.hooksPath=/dev/null',*args])
def common():
 path=pathlib.Path(__file__).with_name(COMMON_NAME);need(path.is_file()and not path.is_symlink()and sha(path.read_bytes())==COMMON_SHA256,'pinned-inert-readonly-common');spec=importlib.util.spec_from_file_location('quote1040_readonly_common',path);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);m.OUT=OUT;m.TARGET=SOURCE_BASE;return m
def runtime():
 ids=command(['docker','ps','-aq','--no-trunc']).decode().split();need(0<len(ids)<1000 and len(set(ids))==len(ids)and all(re.fullmatch('[a-f0-9]{64}',x)for x in ids),'typed-all-container-set');rows=json.loads(command(['docker','inspect',*ids]));need({r['Id']for r in rows}==set(ids),'complete-in-memory-container-inspect');records={}
 for r in rows:
  records[r['Id']]={'image':r['Image'],'configSHA256':sha(enc(r['Config'])),'hostConfigSHA256':sha(enc(r['HostConfig'])),'envSHA256':sha(enc(sorted(r['Config'].get('Env')or[]))),'mountsSHA256':sha(enc(sorted(r['Mounts'],key=enc))),'pid':r['State']['Pid'],'started':r['State']['StartedAt'],'restarts':r['RestartCount'],'running':r['State']['Running'],'oom':r['State']['OOMKilled'],'health':r['State'].get('Health',{}).get('Status')}
 target=[r for r in rows if(r['Config'].get('Labels')or{}).get('com.docker.compose.project')=='rr-portal'and(r['Config'].get('Labels')or{}).get('com.docker.compose.service')==SERVICE];need(len(target)==1,'one-current-quote-container');return records,target[0]
def wire(value):
 raw=enc(value);need(len(raw)<=4*1024**2,'bounded-numeric-receipt');nib=lambda v:[int(x,16)for x in(format(v,'x')if type(v)is int else v)];parts=[raw[i:i+1024]for i in range(0,len(raw),1024)];digest=nib(sha(raw))
 for i,b in enumerate(parts):print(enc([0,nib(i+1),nib(len(parts)),nib(len(raw)),digest,nib(b.hex())]).decode(),flush=True)
 print(enc([1,nib(len(parts)),nib(len(raw)),digest]).decode(),flush=True)
def main():
 need(EXECUTE is True and sys.argv[1:]==['diagnose']and os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_MODE')=='diagnose'and os.environ.get('RELEASE_ATTEMPT')=='1','explicit-first-fresh-readonly-profile');os.umask(0o077);need(re.fullmatch('[a-f0-9]{40}',SOURCE_BASE)and OUT.parent.is_dir()and not any(p.is_symlink()for p in(OUT.parent,*OUT.parent.parents))and not OUT.exists()and not OUT.is_symlink(),'fresh-own-private-evidence');OUT.mkdir(mode=0o700);v={'phase':'diagnose','mode':'diagnose','service':SERVICE,'sourceBaselineMain':SOURCE_BASE,'success':False,'readOnly':True,'lifecycleOrConfigOrBusinessWrites':False,'plaintextCredentialsWritten':False,'businessFileBodiesCopied':False}
 try:
  P=common();before,r=runtime();v['allRuntime']=before;v['containerId']=r['Id'];v['runtime']=before[r['Id']];v['hostGitHead']=git('rev-parse','HEAD').decode().strip();need(re.fullmatch('[a-f0-9]{40}',v['hostGitHead']),'typed-observed-host-head');v['shared']={name:P.shared_file(name)for name in P.SHARED};v['sharedMatchObservedHost']=all(row['sha256']==sha(git('show',v['hostGitHead']+':'+name))for name,row in v['shared'].items());v['environmentFiles']={str(p.relative_to(ROOT)):P.shared_file(str(p))for p in ROOT.glob('.env*')if p.is_file()};need('.env.cloud.production'in v['environmentFiles'],'production-env-hash-present');v['gatewayAuth']=P.gateway_auth();v['unstaged']=P.dirty_summary(git('diff','--name-only','-z'));v['staged']=P.dirty_summary(git('diff','--cached','--name-only','-z'))
  images=json.loads(command(['docker','image','inspect','--format',P.IMAGE_FORMAT,ALIAS]));v['canonicalImage']=P.safe_image(images);v['sourceSummary']=P.source_inventory(r['Id']);source_path=OUT/'source-hashes.private.json';source=json.loads(source_path.read_bytes());v['completeSourceInventorySHA256']=sha(source_path.read_bytes());v['affectedSource']={n:source['actual'].get(n,{'absent':True})for n in AFFECTED};v['generatedLock']={'actual':source['actual'].get('package-lock.json',{'absent':True}),'expectedGitBlobSHA1':source['expectedGitBlobSHA1'].get('package-lock.json'),'preserveActualRuntimeGeneratedLock':True}
  v['startup']=P.startup_counts();v['rowInvariantRisk']={'countsAreNotFullRowOrDatabaseSnapshot':True,'startupGuardMustBeRecheckedAfterServiceGateBeforeStop':True,'singleStartupMayConsumeQuoteSectionSequence':v['startup']['expectedSingleStartupQuoteSectionSequenceIncrement'],'fullGatedRowSchemaUserAuthAndOtherSequenceEvidenceRequiredForDeploy':True,'noSequenceResetOrBusinessRestoreAuthorized':True};docker_root=json.loads(command(['docker','info','--format','{{json .DockerRootDir}}']));need(type(docker_root)is str and pathlib.Path(docker_root).is_absolute(),'actual-docker-root');space=os.statvfs(docker_root);v['space']={'available':space.f_bavail*space.f_frsize,'free':space.f_bfree*space.f_frsize};after,_=runtime();need(before==after and git('rev-parse','HEAD').decode().strip()==v['hostGitHead'],'all-original-runtime-pids-and-host-head-unchanged');v['allOriginalRuntimeUnchanged']=True;v['success']=True
 except Exception as e:v.update(errorType=type(e).__name__,stage=STAGE)
 v['resultSHA256']=sha(enc(v));private('result.private.json',v);wire(v);return 0 if v['success']else 1
if __name__=='__main__':sys.exit(main())
