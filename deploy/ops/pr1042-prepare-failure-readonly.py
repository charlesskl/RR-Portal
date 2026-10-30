"""INERT classifier for the exact PR1042 first prepare failure. No fetch or replay."""
import datetime,hashlib,json,os,pathlib,re,stat,subprocess,sys

ROOT=pathlib.Path('/opt/rr-portal')
FAILED=ROOT/'deploy/backups/pr1042-indo-static-20261030/prepare'
OUT=ROOT/'deploy/backups/pr1042-prepare-failure-readonly-1'
BRANCH='refs/heads/codex/ops-pr-1042-20261030-indo'
MANIFEST_SHA256='fcbfa2a7b65e9ec8387b1fa77f837841930fb1e6834827fe4d2fef28f8285057'
FAILED_RESULT_INNER_SHA256='e6f3c73faa60fedb323bf69c7206f367c0467c87a29fa57b230e87ae14fe032f'
HEAD='1e024e50754b7b417207b6e0dcd8ed02d360b45f'
TARGET='1e4366f2803bd5ea19b07b787a12a7d7b66c5ff4'
HOST='f22fbffa1789234fe1c78bf776f4dcb3fe867d0c'
CID='58a9bc0a94611e21a4d8987edd85857fa3f53521ca649bafa3a166890cf3eb2a'
IMAGE='sha256:79c441c8c2df6d6df6fcc475e865535c3ed5c4e884e56bcb1a2a772c5163b0a9'
STARTED='2026-10-28T12:00:55.077485506Z'
PID=276848
EXECUTE=True
STAGE='entry'
FORMAT='{"id":{{json .Id}},"image":{{json .Image}},"running":{{json .State.Running}},"oom":{{json .State.OOMKilled}},"health":{{if .State.Health}}{{json .State.Health.Status}}{{else}}null{{end}},"pid":{{json .State.Pid}},"started":{{json .State.StartedAt}},"restarts":{{json .RestartCount}}}'

def need(v,label):
 global STAGE
 STAGE=label
 if not v:raise RuntimeError(label)
def enc(v):return json.dumps(v,sort_keys=True,separators=(',',':'),ensure_ascii=True,allow_nan=False).encode()
def sha(v):return hashlib.sha256(v).hexdigest()
def private(v):
 fd=os.open(OUT/'result.private.json',os.O_CREAT|os.O_EXCL|os.O_WRONLY|os.O_NOFOLLOW,0o600)
 with os.fdopen(fd,'wb')as f:f.write(enc(v));f.flush();os.fsync(f.fileno())

def safe_read(p,limit=4*1024**2):
 need(not any(x.is_symlink()for x in(p,*p.parents)),'fixed-evidence-path-no-symlink')
 fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW)
 try:
  a=os.fstat(fd);need(stat.S_ISREG(a.st_mode)and 0<=a.st_size<=limit,'bounded-private-regular-evidence')
  b=b''
  while True:
   chunk=os.read(fd,65536)
   if not chunk:break
   b+=chunk;need(len(b)<=limit,'bounded-evidence-read')
  z=os.fstat(fd);key=lambda s:(s.st_dev,s.st_ino,s.st_uid,s.st_gid,s.st_mode,s.st_size,s.st_mtime_ns,s.st_ctime_ns)
  need(key(a)==key(z)==key(p.lstat())and len(b)==a.st_size,'stable-evidence-file')
  return b
 finally:os.close(fd)

def command(args):
 r=subprocess.run(args,cwd=ROOT,capture_output=True,timeout=30)
 need(len(r.stdout)<=8192 and len(r.stderr)<=8192,'bounded-readonly-command-output')
 return r

def git(*args):return command(['git','-C',str(ROOT),'-c','core.hooksPath=/dev/null',*args])

def object_presence(revision):
 need(revision in(HEAD,TARGET),'only-two-fixed-reviewed-object-probes')
 r=git('cat-file','-e',revision+'^{commit}')
 # A missing object is an expected probe result. Its private text is discarded.
 need(r.returncode in(0,1,128),'known-object-presence-exit-code')
 return {'revision':revision,'commitPresent':r.returncode==0,'exitCode':r.returncode}

def classify(raw):
 # Arbitrary stderr, paths and argv are never included in a result. Exact known
 # fixed-revision errors alone are classified; unrecognized bytes stay private.
 for revision,label in((HEAD,'reviewed-head'),(TARGET,'merged-target')):
  patterns=[
   (b"fatal: invalid object name '"+revision.encode()+b"'.\n",'invalid-object-name-'),
   (b'fatal: bad object '+revision.encode()+b'\n','bad-object-'),
  ]
  for expected,prefix in patterns:
   if raw==expected:return {'category':prefix+label,'revision':revision}
 if raw.startswith(b'From https://github.com/charlesskl/RR-Portal')and b'fatal:'not in raw and b'error:'not in raw:
  return {'category':'git-fetch-notice-no-fatal'}
 return {'category':'unclassified-private-stderr'}

def failed_evidence():
 raw=safe_read(FAILED/'manifest.json');need(sha(raw)==MANIFEST_SHA256,'exact-root-provided-failed-manifest')
 manifest=json.loads(raw);need(type(manifest)is dict and 0<len(manifest)<=2000,'bounded-fixed-failed-manifest')
 metadata={};stderr={};stdout={}
 for name,digest in manifest.items():
  match=re.fullmatch(r'([0-9]{3,6})[.](command[.]private[.]json|stderr[.]private|stdout[.]private)',name)
  need(match is not None and type(digest)is str and re.fullmatch('[a-f0-9]{64}',digest),'failed-archive-only-known-command-evidence')
  body=safe_read(FAILED/name);need(sha(body)==digest,'sealed-original-command-file')
  ordinal=int(match[1]);need(ordinal>0,'positive-command-ordinal')
  if match[2]=='command.private.json':
   value=json.loads(body);need(type(value)is dict and set(value)=={'program','timeout'}and value['program']in('git','docker')and type(value['timeout'])is int and 0<value['timeout']<=1800,'known-program-only-no-argv-command-metadata');need(ordinal not in metadata,'one-command-metadata-per-ordinal');metadata[ordinal]=value['program']
  elif match[2]=='stderr.private':stderr[ordinal]=body
  else:stdout[ordinal]=len(body)
 need(set(metadata)==set(stderr)==set(stdout)and sorted(metadata)==list(range(1,max(metadata)+1)),'complete-sequential-command-triplets')
 failed_raw=safe_read(FAILED/'result.private.json');failed=json.loads(failed_raw);inner=dict(failed);inner.pop('resultSHA256',None)
 need(failed['resultSHA256']==FAILED_RESULT_INNER_SHA256==sha(enc(inner))and failed['success']is False and failed['phase']=='prepare'and failed['stage']=='command-git'and failed['head']==HEAD and failed['target']==TARGET and failed['manifestSHA256']==MANIFEST_SHA256,'exact-root-observed-source-bound-original-failure')
 findings=[{'commandOrdinal':i,**classify(stderr[i])}for i in sorted(stderr)if stderr[i]]
 return {'failedManifestSHA256':MANIFEST_SHA256,'originalFailureStage':'command-git','originalCommandCount':len(metadata),'lastRecordedCommandOrdinal':max(metadata),'recordedGitCommandCount':sum(x=='git'for x in metadata.values()),'recordedDockerCommandCount':sum(x=='docker'for x in metadata.values()),'nonemptyStderrCount':len(findings),'stderrClassifications':findings,'originalManifestAndCommandFilesVerified':True}

def runtime():
 r=command(['docker','inspect','--format',FORMAT,CID]);need(r.returncode==0,'fixed-target-runtime-readable');v=json.loads(r.stdout)
 need(set(v)=={'id','image','running','oom','health','pid','started','restarts'}and v['id']==CID and v['image']==IMAGE and type(v['running'])is bool and type(v['oom'])is bool and type(v['pid'])is int and type(v['restarts'])is int,'typed-fixed-target-minimal-runtime')
 need(v['started']==STARTED and v['pid']==PID and v['running']is True and v['oom']is False and v['health']=='healthy'and v['restarts']==0,'same-last-observed-healthy-indo-process-no-switch')
 return v

def wire(v):
 raw=enc(v);need(len(raw)<=4*1024**2,'bounded-numeric-receipt');nib=lambda x:[int(c,16)for c in(format(x,'x')if type(x)is int else x)];parts=[raw[i:i+1024]for i in range(0,len(raw),1024)];digest=nib(sha(raw))
 for i,b in enumerate(parts):print(enc([0,nib(i+1),nib(len(parts)),nib(len(raw)),digest,nib(b.hex())]).decode(),flush=True)
 print(enc([1,nib(len(parts)),nib(len(raw)),digest]).decode(),flush=True)

def main():
 need(EXECUTE is True and sys.argv[1:]==['diagnose']and os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_MODE')=='diagnose'and os.environ.get('RELEASE_ATTEMPT')=='1','inert-first-readonly-failure-classifier')
 os.umask(0o077);need(OUT.parent.is_dir()and not any(p.is_symlink()for p in(OUT.parent,*OUT.parent.parents))and not OUT.exists()and not OUT.is_symlink(),'fresh-own-readonly-diagnostic-output');OUT.mkdir(mode=0o700)
 v={'phase':'diagnose','mode':'diagnose','service':'indo-shipping','success':False,'readOnly':True,'fetchOrCheckoutOrReplayPerformed':False,'databaseReadOrWritten':False,'configurationOrEnvironmentRead':False,'arbitraryPrivateOutputIncluded':False}
 try:
  before=runtime();head=git('rev-parse','HEAD');need(head.returncode==0 and head.stdout.decode().strip()==HOST,'same-physical-host-source-baseline');v.update(failed_evidence());v['objectPresence']=[object_presence(HEAD),object_presence(TARGET)];v['runtime']=before;need(runtime()==before,'fixed-runtime-unchanged-through-diagnostic');again=git('rev-parse','HEAD');need(again.returncode==0 and again.stdout==head.stdout,'host-source-unchanged-through-diagnostic');v['hostGitHead']=HOST;v['success']=True
 except Exception as e:v.update(errorType=type(e).__name__,stage=STAGE)
 v['utc']=datetime.datetime.now(datetime.timezone.utc).isoformat();v['resultSHA256']=sha(enc(v));private(v);wire(v);return 0 if v['success']else 1

if __name__=='__main__':sys.exit(main())
