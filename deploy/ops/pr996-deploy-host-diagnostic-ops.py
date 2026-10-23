"""Inert fixed sealed failed-prepare assertion diagnostic. No application commands.
Only sealed JSON assertions and bounded Docker ps/inspect metadata; no key/PG/HTTP.
"""
import hashlib,http.client,json,os,pathlib,re,socket,stat,subprocess,sys
DIAGNOSTIC_PIN=True
ROOT=pathlib.Path('/opt/rr-portal')
BRANCH='refs/heads/ops/pr-996-20261023-04'
BASE='6742f820c0a43388e274b867a2825a42548b5cea'
TARGET='2de4be7bdb0fa983dc86259701a3c4f3ddd14234'
TREE='d41d5f98f97ee0cd34b0a868fb7283f57841ee4e'
FAILED=ROOT/'deploy/backups/pr-996-20261023-04-deploy'
FAILED_MANIFEST='86265206df9fac3bc4365b4ebcd757a63f86389fc0eea1ce3c20784e4481aeaf'
FAILED_RESULT='5c5fd71a8167568da85ae3f908365a5f3c188a9c7d3ccf710ff078ef98770f29'
BACKUP=ROOT/'deploy/backups/pr-996-20261023-04-backup'
BACKUP_MANIFEST='9d0618f4e28efa4c97d9cf65cb3e53cbb73a9bb92d9546d7b556cea9bef81a31'
BACKUP_RESULT='e4633500509d7aaecca38761804767fbcb9ac5f6f0a5d6f29dfb91623c85cb7a'
OUT=ROOT/'deploy/backups/pr-996-20261023-04-deploy-hostdiagnostic'
EXPECTED_STAGE='complete-hostconfig-mounts'
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
 m,r=archive(FAILED,FAILED_MANIFEST,FAILED_RESULT,True);need(r.get('mode')=='deploy'and r.get('base')==BASE and r.get('target')==TARGET and r.get('tree')==TREE and r.get('success')is False and r.get('failedStage')==EXPECTED_STAGE and r.get('failedServiceRetainsOwnMaintenance')is True)
 for k in('businessWritesPerformed','databaseRestoreOrCursorResetPerformed','modelCallsPerformed','authenticatedBusinessWritesPerformed','otherServicesRequested','secretOrRowsPrinted','environmentConfigurationChanged'):need(r.get(k)is False)
 created=sealed_json(FAILED,m,'indo-shipping-create-only-indo-shipping-raw.private.json');closed=sealed_json(FAILED,m,'indo-shipping-closed-before.private.json');bm,br=archive(BACKUP,BACKUP_MANIFEST,BACKUP_RESULT);need(br.get('mode')=='backup'and br.get('success')is True and br.get('backupComplete')is True and br.get('base')==br.get('target')==BASE);baseline=sealed_json(BACKUP,bm,'baseline.private.json');original=sealed_json(BACKUP,bm,'target-inspect.private.json');need(type(original)is dict and set(original)=={'indo-shipping'}and baseline['head']==BASE and len(baseline['runtime']['others'])==45);old=original['indo-shipping'];need(created['Id']!=old['Id']and re.fullmatch('[a-f0-9]{64}',created['Id'])is not None);key=closed['keyring'];pg=closed['postgres'];need(m.get('indo-shipping-closed-before/keyring.private.tar')==key['tarSHA256']and m.get('indo-shipping-closed-before/indo_shipping.dump')==pg['dumpSHA256']);metadata={'freshClosedSnapshotPresent':True,'closedKeyArchiveBoundToSeal':True,'closedPGDumpBoundToSeal':True,'closedPGSequenceCaptureStable':pg.get('sequenceStateStableDuringCapture')is True,'closedPGTableCount':len(pg['tables']),'closedKeyFileCount':sum(v['kind']=='file'for v in key['entries'].values()),'closedKeyOwnersAll1654':all(v['uid']==v['gid']==1654 for v in key['entries'].values()),'keyFileNamesOrContentsPrinted':False};trace=[];name='indo-shipping-recovery-failure.private.txt'
 if name in m:
  text=regular(FAILED/name,131072).decode('utf8');need(sha(text.encode())==m[name])
  for file,line,fn in re.findall(r'File "([^"\n]+)", line ([0-9]{1,7}), in ([A-Za-z_][A-Za-z0-9_]{0,79})',text):
   base=pathlib.PurePosixPath(file).name;role='release_helper'if base=='run.py'else'backup_library'if base=='pr996-04-backup-library.py'else'factory_library'if base=='factory-review-backup-library.py'else'other_library';trace.append({'sourceRole':role,'line':int(line),'function':fn})
 return old,created,baseline,metadata,trace

SAFE_STRINGS={'no','unless-stopped','always','on-failure','runc','json-file','local','none','host','bridge','private','rr-portal_default','default','0','app','1654','1654:1654'}
def value_summary(value):
 row={'type':type(value).__name__,'sha256':sha(enc(value))}
 if value is None or type(value)in(bool,int):row['safeScalar']=value
 elif type(value)is str and value in SAFE_STRINGS:row['safeScalar']=value
 elif type(value)in(list,dict):row['entryCount']=len(value)
 return row
def differences(old,new):
 need(type(old)is dict and type(new)is dict and len(set(old)|set(new))<=256);rows=[]
 for key in sorted(set(old)|set(new)):
  need(re.fullmatch('[A-Za-z][A-Za-z0-9]{0,79}',key)is not None)
  if key not in old or key not in new or enc(old[key])!=enc(new[key]):rows.append({'key':key,'oldPresent':key in old,'newPresent':key in new,'old':value_summary(old.get(key)),'new':value_summary(new.get(key))})
 return rows

def envmap(values):
 need(type(values)is list and len(values)<=1000);d={}
 for x in values:need(type(x)is str and'='in x);k,v=x.split('=',1);need(re.fullmatch('[A-Za-z_][A-Za-z0-9_]*',k)is not None and k not in d);d[k]=v
 return d
def inspector_row(r):
 cid=r['Id'];return{'id':cid,'image':r['Image'],'started':r['State'].get('StartedAt'),'running':r['State']['Running'],'oom':r['State']['OOMKilled'],'restarts':r['RestartCount'],'health':r['State'].get('Health',{}).get('Status'),'environmentMapSHA256':sha(enc(envmap(r['Config']['Env']))),'mounts':sorted(r['Mounts'],key=enc),'configSHA256':sha(enc(dict(r['Config'],Env=sorted(r['Config']['Env'])))),'hostConfigSHA256':sha(enc(r['HostConfig']))}
def runtime(baseline):
 p=subprocess.run(['docker','ps','-aq','--no-trunc'],stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,timeout=15);need(p.returncode==0 and len(p.stdout)<=8192);ids=p.stdout.decode().split();need(len(ids)==len(set(ids))==46 and all(re.fullmatch('[a-f0-9]{64}',x)for x in ids));p=subprocess.run(['docker','inspect',*ids],stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,timeout=25);need(p.returncode==0 and len(p.stdout)<=32*1024**2);rows=json.loads(p.stdout,object_pairs_hook=pairs);need(type(rows)is list and len(rows)==46 and {x['Id']for x in rows}==set(ids));matches=[r for r in rows if(r['Config'].get('Labels')or{}).get('com.docker.compose.project')=='rr-portal'and(r['Config'].get('Labels')or{}).get('com.docker.compose.service')=='indo-shipping'];need(len(matches)==1);target=matches[0];others={r['Id']:inspector_row(r)for r in rows if r['Id']!=target['Id']};need(set(others)==set(baseline['runtime']['others']));return target,others,{'allOther45InspectorContractsMatchSealedBackup':others==baseline['runtime']['others'],'currentContainerCount':46,'pid1EnvironmentNotRead':True}
def public_target(current,old,created):
 state=current['State'];need(re.fullmatch('sha256:[a-f0-9]{64}',current.get('Image',''))is not None);need(type(state.get('Pid'))is int and 0<=state['Pid']<2**31 and type(current.get('RestartCount'))is int);status=state.get('Status');health=state.get('Health',{}).get('Status');return{'image':current['Image'],'currentIdMatchesSealedCreated':current['Id']==created['Id'],'imageMatchesSealedCreated':current['Image']==created['Image'],'imageMatchesOriginal':current['Image']==old['Image'],'status':status if status in{'created','running','exited','dead','restarting','removing','paused'}else'unexpected-status-omitted','running':state['Running'],'pid':state['Pid'],'pidZero':state['Pid']==0,'neverStarted':str(state.get('StartedAt','')).startswith('0001-01-01'),'health':health if health in{'healthy','unhealthy','starting'}else'absent-or-unknown','restartCount':current['RestartCount'],'oom':state['OOMKilled']}
def collect(old,created,current):
 original_env=envmap(old['Config']['Env']);created_env=envmap(created['Config']['Env']);current_env=envmap(current['Config']['Env']);return{'oldToCreatedHostConfigDifferences':differences(old['HostConfig'],created['HostConfig']),'oldToCurrentHostConfigDifferences':differences(old['HostConfig'],current['HostConfig']),'createdToCurrentHostConfigDifferences':differences(created['HostConfig'],current['HostConfig']),'mounts':{'originalCount':len(old['Mounts']),'createdCount':len(created['Mounts']),'currentCount':len(current['Mounts']),'createdEqualsOriginal':created['Mounts']==old['Mounts'],'currentEqualsOriginal':current['Mounts']==old['Mounts']},'fullConfiguredEnvironment':{'originalSHA256':sha(enc(original_env)),'createdSHA256':sha(enc(created_env)),'currentSHA256':sha(enc(current_env)),'createdEqualsOriginal':created_env==original_env,'currentEqualsOriginal':current_env==original_env,'valuesPrinted':False},'currentTarget':public_target(current,old,created)}

def fixed_key_directory_head(cid):
 need(re.fullmatch('[a-f0-9]{64}',cid)is not None)
 class FixedEngineConnection(http.client.HTTPConnection):
  def connect(self):
   self.sock=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM);self.sock.settimeout(8);self.sock.connect('/var/run/docker.sock')
 connection=FixedEngineConnection('localhost',timeout=8)
 try:
  connection.request('HEAD','/containers/'+cid+'/archive?path=%2Fhome%2Fapp%2F.aspnet');response=connection.getresponse();status=response.status;need(type(status)is int and 100<=status<=599);return{'status':status,'keyDirectoryExists':status==200,'keyDirectoryAbsentByStructuredHEAD':status==404,'responseBodyRead':False,'fixedEngineArchiveHEADOnly':True}
 finally:connection.close()
def server_version():
 p=subprocess.run(['docker','version','--format','{{.Server.Version}}'],stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,timeout=15);need(p.returncode==0 and len(p.stdout)<=128);v=p.stdout.decode('ascii').strip();need(re.fullmatch('[0-9]{1,3}[.][0-9]{1,3}[.][0-9]{1,4}[A-Za-z0-9_.+-]{0,40}',v)is not None);return v
def write(p,b):
 fd=os.open(p,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
 with os.fdopen(fd,'wb')as f:f.write(b);f.flush();os.fsync(f.fileno())
def main():
 need(DIAGNOSTIC_PIN is True and sys.argv[1:]==['backup']and os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_ATTEMPT')=='1'and re.fullmatch('[a-f0-9]{40}',os.environ.get('RELEASE_SHA',''))is not None);old,created,baseline,closed,trace=evidence();current,others,first=runtime(baseline);version=server_version();detail=collect(old,created,current);directory_head=fixed_key_directory_head(current['Id']);after,after_others,last=runtime(baseline);need(inspector_row(after)==inspector_row(current)and after_others==others and last==first);os.umask(0o077);need(not OUT.exists()and not OUT.is_symlink());OUT.mkdir(mode=0o700);result={'mode':'diagnose','base':BASE,'target':TARGET,'success':True,'failedRunId':39909005636,'failedManifestSHA256':FAILED_MANIFEST,'failedResultSHA256':FAILED_RESULT,'hostContractDiagnostic':detail,'sealedClosedSnapshotMetadata':closed,'fixedKeyDirectoryHead':directory_head,'recoveryTraceFramesOnly':trace,'dockerServerVersion':version,'originalRuntimeMetadata':first,'runtimeMetadataBeforeAfterUnchanged':True,'oldEvidenceModified':False,'keyMaterialDecodedOrPrinted':False,'containerSignalsOrApplicationCommandsPerformed':False,'postgresApplicationHTTPModelOrBusinessWritesPerformed':False};body=enc(result);write(OUT/'first-result.json',body);mb=enc({'first-result.json':sha(body)});write(OUT/'manifest.json',mb);print(enc(dict(result,manifestSHA256=sha(mb),resultSHA256=sha(body))).decode(),flush=True);return 0

if __name__=='__main__':
 try:sys.exit(main())
 except SystemExit:raise
 except BaseException:print('{"mode":"diagnose","success":false,"safeFailure":"FIXED_DEPLOY_HOST_CONTRACT_REJECTED"}',flush=True);sys.exit(1)
