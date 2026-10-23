"""Inert fixed sealed failed-prepare assertion diagnostic. No application commands.
Only sealed JSON assertions and bounded Docker ps/inspect metadata; no key/PG/HTTP.
"""
import hashlib,io,json,os,pathlib,re,stat,subprocess,sys,tarfile
DIAGNOSTIC_PIN=True
ROOT=pathlib.Path('/opt/rr-portal')
BRANCH='refs/heads/ops/pr-996-20261023-04'
BASE='6742f820c0a43388e274b867a2825a42548b5cea'
TARGET='2de4be7bdb0fa983dc86259701a3c4f3ddd14234'
TREE='d41d5f98f97ee0cd34b0a868fb7283f57841ee4e'
FAILED=ROOT/'deploy/backups/pr-996-20261023-04-prepare-finalized-02'
FAILED_MANIFEST='7659a260a4e0c7c861b5759258947790fd400845ffb259c589aa291884a560e3'
FAILED_RESULT='591b5493f69cbf1dd107c213330998dd2802a18787d652d087804aac8d850dad'
BACKUP=ROOT/'deploy/backups/pr-996-20261023-04-backup'
BACKUP_MANIFEST='9d0618f4e28efa4c97d9cf65cb3e53cbb73a9bb92d9546d7b556cea9bef81a31'
BACKUP_RESULT='e4633500509d7aaecca38761804767fbcb9ac5f6f0a5d6f29dfb91623c85cb7a'
OUT=ROOT/'deploy/backups/pr-996-20261023-04-prepare02-ownerdiagnostic'
EXPECTED_STAGE='entrypoint'
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
 m,r=archive(FAILED,FAILED_MANIFEST,FAILED_RESULT,True);need(r.get('mode')=='prepare'and r.get('base')==BASE and r.get('target')==TARGET and r.get('tree')==TREE and r.get('success')is False and r.get('failedStage')==EXPECTED_STAGE and r.get('backupLibraryFailedStage')=='original-keyring-owner')
 for k in('businessWritesPerformed','databaseRestoreOrCursorResetPerformed','modelCallsPerformed','authenticatedBusinessWritesPerformed','otherServicesRequested','secretOrRowsPrinted','environmentConfigurationChanged'):need(r.get(k)is False)
 raw=sealed_json(FAILED,m,'indo-shipping-key-rehearsal-created.private.json');image=sealed_json(FAILED,m,'indo-shipping-candidate-image.private.json');bm,br=archive(BACKUP,BACKUP_MANIFEST,BACKUP_RESULT);need(br.get('mode')=='backup'and br.get('success')is True and br.get('backupComplete')is True and br.get('base')==br.get('target')==BASE);baseline=sealed_json(BACKUP,bm,'baseline.private.json');need(baseline['head']==BASE and set(baseline['runtime']['targets'])=={'indo-shipping'}and len(baseline['runtime']['others'])==45);original=sealed_json(BACKUP,bm,'target-inspect.private.json');need(type(original)is dict and set(original)=={'indo-shipping'});original_user=original['indo-shipping']['Config'].get('User');keypath='indo-shipping-key-rehearsal-copied-back/keyring.private.tar';need(keypath in m);blob=regular(FAILED/keypath,2*1024**2);need(sha(blob)==m[keypath]);return raw,image,baseline,blob,original_user

def header_diagnostic(raw,image,baseline,blob,original_user):
 need(re.fullmatch('[a-f0-9]{64}',raw.get('Id',''))is not None and re.fullmatch('sha256:[a-f0-9]{64}',image.get('Id',''))is not None and raw['Image']==image['Id']);expected=baseline['storage']['indo-shipping']['keyring']['entries'];actual={};groups={};need(type(expected)is dict and 1<=len(expected)<=18 and 0<len(blob)<=2*1024**2)
 with tarfile.open(fileobj=io.BytesIO(blob),mode='r:')as archive:
  for member in archive:
   name=member.name.rstrip('/');need(type(name)is str and len(name)<=4096 and name not in actual and len(actual)<256);kind='directory'if member.isdir()else'file'if member.isfile()else'link'if member.issym()or member.islnk()else'other';row={'kind':kind,'mode':member.mode,'uid':member.uid,'gid':member.gid,'bytes':member.size};need(all(type(row[k])is int and 0<=row[k]<2**63 for k in('mode','uid','gid','bytes')));actual[name]=row;group=(kind,member.mode,member.uid,member.gid,member.size);groups[group]=groups.get(group,0)+1
 known=set(actual)==set(expected);same_except_owner=known and all(all(actual[n][k]==expected[n][k]for k in('kind','mode','bytes'))for n in actual);owner_match=known and all(all(actual[n][k]==expected[n][k]for k in('uid','gid'))for n in actual);cu=raw['Config'].get('User');iu=image['Config'].get('User');allowed={'0','1654','1654:1654'};state=raw['State'];checks={'immutableImageMatches':raw['Image']==image['Id'],'neverStartedCreatedState':state.get('Status')=='created'and state.get('Running')is False and state.get('Pid')==0 and str(state.get('StartedAt','')).startswith('0001-01-01')and raw.get('RestartCount')==0 and state.get('OOMKilled')is False,'noMounts':raw['Mounts']==[],'networkNone':raw['HostConfig']['NetworkMode']=='none','logDriverNone':raw['HostConfig']['LogConfig']['Type']=='none','restartPolicyNo':raw['HostConfig']['RestartPolicy']['Name']=='no','entrypointTar':raw['Config']['Entrypoint']==['tar'],'createdUserMatchesImmutableImageUser':cu==iu,'createdUserMatchesBaselineRuntimeUser':cu==original_user,'immutableImageUserMatchesBaselineRuntimeUser':iu==original_user,'allHeaderPathsMatchBaselinePrivately':known,'allHeaderMetadataExceptOwnershipMatchesBaseline':same_except_owner,'allHeaderOwnersMatchBaseline':owner_match}
 return{'checks':checks,'createdUserValue':cu if cu in allowed else'nonwhitelisted-value-omitted','immutableImageUserValue':iu if iu in allowed else'nonwhitelisted-value-omitted','baselineRuntimeUserValue':original_user if original_user in allowed else'nonwhitelisted-value-omitted','headerEntryCount':len(actual),'baselineHeaderEntryCount':len(expected),'unknownHeaderPathCount':len(set(actual)-set(expected)),'metadataGroups':[{'kind':k[0],'modeOctal':format(k[1],'04o'),'uid':k[2],'gid':k[3],'bytes':k[4],'count':v}for k,v in sorted(groups.items())],'keyFileNamesPathsOrContentsPrinted':False,'keyFileContentsDecodedOrExtracted':False}

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
def server_version():
 p=subprocess.run(['docker','version','--format','{{.Server.Version}}'],stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,timeout=15);need(p.returncode==0 and len(p.stdout)<=128);v=p.stdout.decode('ascii').strip();need(re.fullmatch('[0-9]{1,3}[.][0-9]{1,3}[.][0-9]{1,4}[A-Za-z0-9_.+-]{0,40}',v)is not None);return v
def write(p,b):
 fd=os.open(p,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
 with os.fdopen(fd,'wb')as f:f.write(b);f.flush();os.fsync(f.fileno())
def main():
 need(DIAGNOSTIC_PIN is True and sys.argv[1:]==['backup']and os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_ATTEMPT')=='1'and re.fullmatch('[a-f0-9]{40}',os.environ.get('RELEASE_SHA',''))is not None);raw,image,baseline,blob,original_user=evidence();before,first=runtime(baseline,raw['Id']);version=server_version();detail=header_diagnostic(raw,image,baseline,blob,original_user);after,last=runtime(baseline,raw['Id']);need(after==before and last==first);os.umask(0o077);need(not OUT.exists()and not OUT.is_symlink());OUT.mkdir(mode=0o700);result={'mode':'diagnose','base':BASE,'target':TARGET,'success':True,'failedRunId':39907701110,'failedManifestSHA256':FAILED_MANIFEST,'failedResultSHA256':FAILED_RESULT,'keyringHeaderDiagnostic':detail,'dockerServerVersion':version,'originalRuntimeMetadata':first,'originalMetadataBeforeAfterUnchanged':True,'oldEvidenceModified':False,'keyMaterialDecodedOrPrinted':False,'labelValuesPrinted':False,'containerSignalsOrApplicationCommandsPerformed':False,'postgresHTTPModelOrBusinessWritesPerformed':False};body=enc(result);write(OUT/'first-result.json',body);mb=enc({'first-result.json':sha(body)});write(OUT/'manifest.json',mb);print(enc(dict(result,manifestSHA256=sha(mb),resultSHA256=sha(body))).decode(),flush=True);return 0
if __name__=='__main__':
 try:sys.exit(main())
 except SystemExit:raise
 except BaseException:print('{"mode":"diagnose","success":false,"safeFailure":"FIXED_PREPARE_OWNER_HEADERS_REJECTED"}',flush=True);sys.exit(1)
