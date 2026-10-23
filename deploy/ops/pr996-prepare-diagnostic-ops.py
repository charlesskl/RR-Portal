"""Inert fixed sealed failed-prepare assertion diagnostic. No application commands.
Only sealed JSON assertions and bounded Docker ps/inspect metadata; no key/PG/HTTP.
"""
import hashlib,json,os,pathlib,re,stat,subprocess,sys
DIAGNOSTIC_PIN=False
ROOT=pathlib.Path('/opt/rr-portal')
BRANCH='refs/heads/ops/pr-996-20261023-04'
BASE='6742f820c0a43388e274b867a2825a42548b5cea'
TARGET='2de4be7bdb0fa983dc86259701a3c4f3ddd14234'
TREE='d41d5f98f97ee0cd34b0a868fb7283f57841ee4e'
FAILED=ROOT/'deploy/backups/pr-996-20261023-04-prepare'
FAILED_MANIFEST='8651f8ecc5f1bccef98b224b885ff49bf53e5b648783bf3aabfb75a8f1b92e30'
FAILED_RESULT='c5529196692a0d4506baf9057507a51a47ec09542504d103ae780eb9295dbf74'
BACKUP=ROOT/'deploy/backups/pr-996-20261023-04-backup'
BACKUP_MANIFEST='9d0618f4e28efa4c97d9cf65cb3e53cbb73a9bb92d9546d7b556cea9bef81a31'
BACKUP_RESULT='e4633500509d7aaecca38761804767fbcb9ac5f6f0a5d6f29dfb91623c85cb7a'
OUT=ROOT/'deploy/backups/pr-996-20261023-04-prepare-diagnostic'
EXPECTED_STAGE='isolated-never-started-no-network-no-logs-no-restart-key-rehearsal'
LIMIT=16*1024*1024
class Rejected(Exception):pass
def need(v):
 if not v:raise Rejected()
def sha(b):return hashlib.sha256(b).hexdigest()
def enc(v):return json.dumps(v,ensure_ascii=True,sort_keys=True,separators=(',',':'),allow_nan=False).encode()
def pairs(items):
 d={}
 for k,v in items:need(type(k)is str and k not in d);d[k]=v
 return d
def parsed(b):need(type(b)is bytes and len(b)<=LIMIT);return json.loads(b.decode(),object_pairs_hook=pairs)
def safe(n):
 p=pathlib.PurePosixPath(n);return type(n)is str and bool(n)and not p.is_absolute()and str(p)==n and all(x not in{'','..','.'}for x in p.parts)and not any(ord(x)<32 for x in n)
def regular(p,limit=LIMIT):
 need(p.is_file()and not p.is_symlink());fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW)
 with os.fdopen(fd,'rb')as f:
  a=os.fstat(f.fileno());need(stat.S_ISREG(a.st_mode)and stat.S_IMODE(a.st_mode)==0o600 and a.st_size<=limit);b=f.read(limit+1);z=os.fstat(f.fileno());fields=lambda s:(s.st_dev,s.st_ino,s.st_mode,s.st_uid,s.st_gid,s.st_size,s.st_mtime_ns,s.st_ctime_ns);need(fields(a)==fields(z)==fields(p.lstat())and len(b)==a.st_size)
 return b
def digest_file(p):
 need(p.is_file()and not p.is_symlink()and stat.S_IMODE(p.stat().st_mode)==0o600);h=hashlib.sha256();fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW)
 with os.fdopen(fd,'rb')as f:
  a=os.fstat(f.fileno());need(stat.S_ISREG(a.st_mode)and a.st_size<=512*1024**2)
  for b in iter(lambda:f.read(1024*1024),b''):h.update(b)
  z=os.fstat(f.fileno());fields=lambda s:(s.st_dev,s.st_ino,s.st_mode,s.st_uid,s.st_gid,s.st_size,s.st_mtime_ns,s.st_ctime_ns);need(fields(a)==fields(z)==fields(p.lstat()))
 return h.hexdigest()
def archive(path,mh,rh,all_files=False):
 need(path.is_dir()and not path.is_symlink()and stat.S_IMODE(path.stat().st_mode)==0o700)
 for p in path.parents:
  need(p.is_dir()and not p.is_symlink())
  if p==ROOT:break
 mb=regular(path/'manifest.json');need(sha(mb)==mh);m=parsed(mb);need(type(m)is dict and m.get('first-result.json')==rh and len(m)<=100000 and all(safe(n)and type(h)is str and re.fullmatch('[a-f0-9]{64}',h)for n,h in m.items()));rb=regular(path/'first-result.json',131072);need(sha(rb)==rh);r=parsed(rb)
 if all_files:
  entries=list(path.rglob('*'));need(len(entries)<=100000 and all(not p.is_symlink()and(p.is_file()or p.is_dir())and p.stat().st_mode&0o077==0 for p in entries));need(set(m)=={str(p.relative_to(path))for p in entries if p.is_file()and p!=path/'manifest.json'}and all(digest_file(path/n)==h for n,h in m.items()))
 return m,r
def sealed_json(path,m,name):
 need(name in m);b=regular(path/name);need(sha(b)==m[name]);return parsed(b)
def evidence():
 m,r=archive(FAILED,FAILED_MANIFEST,FAILED_RESULT,True);need(r.get('mode')=='prepare'and r.get('base')==BASE and r.get('target')==TARGET and r.get('tree')==TREE and r.get('success')is False and r.get('failedStage')==EXPECTED_STAGE)
 for k in('businessWritesPerformed','databaseRestoreOrCursorResetPerformed','modelCallsPerformed','authenticatedBusinessWritesPerformed','otherServicesRequested','secretOrRowsPrinted','environmentConfigurationChanged'):need(r.get(k)is False)
 raw=sealed_json(FAILED,m,'indo-shipping-key-rehearsal-created.private.json');image=sealed_json(FAILED,m,'indo-shipping-candidate-image.private.json');bm,br=archive(BACKUP,BACKUP_MANIFEST,BACKUP_RESULT);need(br.get('mode')=='backup'and br.get('success')is True and br.get('backupComplete')is True and br.get('base')==br.get('target')==BASE);baseline=sealed_json(BACKUP,bm,'baseline.private.json');need(baseline['head']==BASE and set(baseline['runtime']['targets'])=={'indo-shipping'}and len(baseline['runtime']['others'])==45);return raw,image,baseline

def assertions(raw,image):
 need(re.fullmatch('[a-f0-9]{64}',raw.get('Id',''))is not None and re.fullmatch('sha256:[a-f0-9]{64}',image.get('Id',''))is not None);state=raw['State'];labels=raw['Config'].get('Labels')or{};expected=image['Config'].get('Labels')or{};need(type(labels)is dict and type(expected)is dict and len(labels)<=256 and len(expected)<=256 and all(type(k)is str and type(v)is str for k,v in list(labels.items())+list(expected.items())))
 checks={'immutableImageMatches':raw['Image']==image['Id'],'neverStartedCreatedState':state.get('Status')=='created'and state.get('Running')is False and state.get('Pid')==0 and str(state.get('StartedAt','')).startswith('0001-01-01')and raw.get('RestartCount')==0 and state.get('OOMKilled')is False,'noMounts':raw['Mounts']==[],'networkNone':raw['HostConfig']['NetworkMode']=='none','logDriverNone':raw['HostConfig']['LogConfig']['Type']=='none','restartPolicyNo':raw['HostConfig']['RestartPolicy']['Name']=='no','entrypointTar':raw['Config']['Entrypoint']==['tar'],'userZero':raw['Config']['User']=='0','oldNoComposeLabelPredicate':not any(k.startswith('com.docker.compose.')for k in labels),'labelsExactlyInheritedFromImmutableImage':labels==expected,'revisionMatchesMergedTarget':expected.get('org.opencontainers.image.revision')==TARGET}
 names=sorted(k for k in labels if k in{'com.docker.compose.project','com.docker.compose.service','com.docker.compose.version','com.docker.compose.image','org.opencontainers.image.revision'});return{'checks':checks,'knownStaticLabelNamesOnly':names,'totalLabelCount':len(labels),'composeLabelCount':sum(k.startswith('com.docker.compose.')for k in labels),'unknownLabelNamesOrAnyLabelValuesPrinted':False}

def envmap(values):
 need(type(values)is list and len(values)<=1000);d={}
 for x in values:need(type(x)is str and'='in x);k,v=x.split('=',1);need(re.fullmatch('[A-Za-z_][A-Za-z0-9_]*',k)is not None and k not in d);d[k]=v
 return d
def runtime(baseline,temp_id):
 p=subprocess.run(['docker','ps','-aq','--no-trunc'],stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,timeout=15);need(p.returncode==0 and len(p.stdout)<=8192);ids=p.stdout.decode().split();need(len(ids)==len(set(ids))and 46<=len(ids)<=47 and all(re.fullmatch('[a-f0-9]{64}',x)for x in ids));expected={**baseline['runtime']['others'],**{r['id']:r for r in baseline['runtime']['targets'].values()}};need(len(expected)==46 and set(expected)<=set(ids)and set(ids)-set(expected)<= {temp_id});p=subprocess.run(['docker','inspect',*ids],stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,timeout=25);need(p.returncode==0 and len(p.stdout)<=32*1024**2);rows=json.loads(p.stdout,object_pairs_hook=pairs);need(type(rows)is list and len(rows)==len(ids)and {x['Id']for x in rows}==set(ids));actual={}
 for r in rows:
  cid=r['Id']
  if cid not in expected:continue
  actual[cid]={'id':cid,'image':r['Image'],'started':r['State'].get('StartedAt'),'running':r['State']['Running'],'oom':r['State']['OOMKilled'],'restarts':r['RestartCount'],'health':r['State'].get('Health',{}).get('Status'),'environmentMapSHA256':sha(enc(envmap(r['Config']['Env']))),'mounts':sorted(r['Mounts'],key=enc),'configSHA256':sha(enc(dict(r['Config'],Env=sorted(r['Config']['Env'])))),'hostConfigSHA256':sha(enc(r['HostConfig']))}
 need(set(actual)==set(expected));comparison={cid:{k:v for k,v in r.items()if k!='processEnvironmentWithoutAutomaticHostnameSHA256'}for cid,r in expected.items()};return actual,{'all46InspectorContractsMatchSealedBackup':actual==comparison,'currentContainerCount':len(ids),'temporaryRehearsalContainerAbsent':temp_id not in ids,'pid1EnvironmentNotRead':True}
def write(p,b):
 fd=os.open(p,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
 with os.fdopen(fd,'wb')as f:f.write(b);f.flush();os.fsync(f.fileno())
def main():
 need(DIAGNOSTIC_PIN is True and sys.argv[1:]==['backup']and os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_ATTEMPT')=='1'and re.fullmatch('[a-f0-9]{40}',os.environ.get('RELEASE_SHA',''))is not None);raw,image,baseline=evidence();before,first=runtime(baseline,raw['Id']);detail=assertions(raw,image);after,last=runtime(baseline,raw['Id']);need(after==before and last==first);os.umask(0o077);need(not OUT.exists()and not OUT.is_symlink());OUT.mkdir(mode=0o700);result={'mode':'diagnose','base':BASE,'target':TARGET,'success':True,'failedRunId':39906503066,'failedManifestSHA256':FAILED_MANIFEST,'failedResultSHA256':FAILED_RESULT,'assertionDiagnostic':detail,'originalRuntimeMetadata':first,'originalMetadataBeforeAfterUnchanged':True,'oldEvidenceModified':False,'keyMaterialDecodedOrPrinted':False,'labelValuesPrinted':False,'containerSignalsOrApplicationCommandsPerformed':False,'postgresHTTPModelOrBusinessWritesPerformed':False};body=enc(result);write(OUT/'first-result.json',body);mb=enc({'first-result.json':sha(body)});write(OUT/'manifest.json',mb);print(enc(dict(result,manifestSHA256=sha(mb),resultSHA256=sha(body))).decode(),flush=True);return 0
if __name__=='__main__':
 try:sys.exit(main())
 except SystemExit:raise
 except BaseException:print('{"mode":"diagnose","success":false,"safeFailure":"FIXED_PREPARE_ASSERTION_REJECTED"}',flush=True);sys.exit(1)
