"""Read only the already identified gateway logs; never call mailbox, DB or deploy functions."""
import datetime,hashlib,importlib.util,json,os,pathlib,re,sys,traceback
PIN=False
BRANCH='refs/heads/ops/mail-readonly-20261020'
OUT=pathlib.Path('/opt/rr-portal/deploy/backups/voyageplex-mail-readonly-20261020-04')
PRIOR=pathlib.Path('/opt/rr-portal/deploy/backups/voyageplex-mail-readonly-20261020-03')
PRIOR_MANIFEST='d360a0ce9af307c3b878cb80f3d8a3fb75fcb0364430634c76a21bb62e0079ca'
LIB_SHA='2c5675ab534d1fcac5f28698e5418daf3ca0366b549c0c9b78fb58d95e95d4c0'
CORE_SHA='a06bd4dd932df22b9127cda35a2dd7a8d69fafd879d6619ce3b50aa54252cd5d'
CID='6dcc97a4da0cad516f7bd44574ee8ff1c2455b0e8d5df67ab5f8b146f461d2ce'
def need(value):
 if not value:raise RuntimeError('READONLY_GATEWAY_EVIDENCE_REJECTED')
def digest(path):
 with path.open('rb')as stream:
  h=hashlib.sha256()
  for block in iter(lambda:stream.read(1024*1024),b''):h.update(block)
  return h.hexdigest()
def load(name,expected):
 path=pathlib.Path(__file__).with_name(name);need(path.is_file()and not path.is_symlink()and digest(path)==expected);spec=importlib.util.spec_from_file_location('gateway_'+name.replace('.','_'),path);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
def verify_prior():
 need(PRIOR.is_dir()and not PRIOR.is_symlink()and PRIOR.stat().st_mode&0o077==0);need(digest(PRIOR/'manifest.json')==PRIOR_MANIFEST);manifest=json.loads((PRIOR/'manifest.json').read_bytes());items=list(PRIOR.rglob('*'));need(all(not p.is_symlink()and(p.is_file()or p.is_dir())and p.stat().st_mode&0o077==0 for p in items));need(set(manifest)=={str(p.relative_to(PRIOR))for p in items if p.is_file()and p!=PRIOR/'manifest.json'});need(all(type(n)is str and re.fullmatch(r'[A-Za-z0-9_.-]+',n)and re.fullmatch('[a-f0-9]{64}',h)and digest(PRIOR/n)==h for n,h in manifest.items()));return {'phase03FullSealVerified':True,'phase03ManifestSHA256':PRIOR_MANIFEST,'phase03FilesPreserved':len(manifest)}
def main():
 need(PIN and sys.argv[1:]==['observe']and os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_ATTEMPT')=='1');os.umask(0o077);OUT.mkdir(mode=0o700);m=load('nginx-readonly-library.py',LIB_SHA);core=load('batch-backup-library.py',CORE_SHA);core.OUT=OUT;core.initialize();m.CORE=core;m.OUT=OUT
 # Only diagnostic filename labels change. The actual Docker arguments stay byte-identical.
 original_capture=m.capture
 def capture(args,label,timeout=60,data=None):return original_capture(args,label.replace('_','-'),timeout,data)
 m.capture=capture
 result={'mode':'voyageplex-mail-readonly','observationPhase':4,'observedAtUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'success':False,'scope':'nginx-only','mailboxOrDatabaseFunctionsCalled':False,'configurationOrCursorWritesPerformed':False,'containerSignalsPerformed':False,'rawSecretsOrBusinessRowsPrinted':False}
 try:
  prior=verify_prior();result['priorEvidence']=prior;code,blob=capture(['docker','inspect',CID],'nginx-before');need(code==0);before=json.loads(blob);need(len(before)==1 and before[0]['Id']==CID and before[0]['State']['Running']);before=before[0];labels=before['Config'].get('Labels')or{};need(labels.get('com.docker.compose.project')=='rr-portal'and labels.get('com.docker.compose.service')=='nginx')
  result['nginx']=m.nginx_evidence();need(result['nginx'].get('verifiedNginxContainerId')==CID)
  code,blob=capture(['docker','inspect',CID],'nginx-after');need(code==0);after=json.loads(blob);need(len(after)==1);after=after[0];result['sameNginxContainerImageConfigMountsAndStart']=all(before.get(k)==after.get(k)for k in('Id','Image','Config','Mounts'))and before['State']['StartedAt']==after['State']['StartedAt'];need(result['sameNginxContainerImageConfigMountsAndStart']);need(verify_prior()==prior);result['success']=True
 except BaseException as error:
  result['safeFailure']='READONLY_GATEWAY_OBSERVATION_INCOMPLETE';result['exceptionType']=type(error).__name__ if type(error).__name__ in{'RuntimeError','OSError','ValueError','KeyError','TimeoutError','TimeoutExpired'}else'Other';m.private('failure-traceback.private.txt',traceback.format_exc().encode())
 finally:
  m.private('first-result.json',result);core.OPS.L.seal(OUT);result=dict(result,manifestSHA256=digest(OUT/'manifest.json'),resultSHA256=digest(OUT/'first-result.json'));need(len(m.enc(result))<65536);print(m.enc(result).decode(),flush=True)
 return 0 if result['success']else 1
if __name__=='__main__':
 try:sys.exit(main())
 except Exception:print('{"success":false,"safeFailure":"READONLY_GATEWAY_PREFLIGHT_REJECTED"}',flush=True);sys.exit(1)
