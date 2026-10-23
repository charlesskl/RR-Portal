"""Inert fixed-archive traceback reader and sealed original program-tar size probe.
Outputs only allowlisted filenames/functions/line numbers and exception types.
Never prints traceback source lines, exception messages, secrets or business rows.
"""
import hashlib,json,os,pathlib,re,select,stat,subprocess,sys,time
DIAGNOSTIC_PIN=False
ROOT=pathlib.Path('/opt/rr-portal')
BRANCH='refs/heads/ops/pr-996-20261023-trace-01'
BASE='6742f820c0a43388e274b867a2825a42548b5cea'
BASE_TREE='ce652db9eb263e09d24a3f44ef0c48a5c1f7b79e'
FAILED=ROOT/'deploy/backups/pr-996-20261023-02-backup'
FAILED_MANIFEST='029638a279ec4746bdf97419f4c34ea31cd0c407d47874536a56e7af3f218fbd'
FAILED_RESULT='c669e95c6f99c3a9ff905e31b49b0b93840b93d19ff2d6329516834e2a02de00'
OUT=ROOT/'deploy/backups/pr-996-20261023-trace-01'
FILE_LIMIT=2*1024*1024
FRAME_FILES={'run.py','pr996-02-backup.py','pr996-02-backup-library.py','factory-review-backup-library.py','qc-source-library.py','release-data-ops-library.py','release-data-library.py','portable-pdb-library.py'}
FUNCTIONS={'<module>','main','backup','initialize','application_proof','prior_indo_proof','prior_archive','source_proof','service_source_proof','file_proof','container_files','git_files','run','need','load','capture','indo_pg_capture','startup_guard','replay_snapshot','pg_capture','pg_table_sql','pg_schema_sql','sequence_states','prove','pe_codeview','pdb_documents','streams','compressed','take','number','__init__'}
EXCEPTIONS={'RuntimeError','ValueError','AssertionError','KeyError','TypeError','FileNotFoundError','PermissionError','FileExistsError','OSError','TimeoutError','UnicodeDecodeError','JSONDecodeError','CalledProcessError','TimeoutExpired'}
class Rejected(Exception):pass
def need(value):
 if not value:raise Rejected()
def sha(blob):return hashlib.sha256(blob).hexdigest()
def enc(value):return json.dumps(value,ensure_ascii=True,sort_keys=True,separators=(',',':'),allow_nan=False).encode()
def unique(pairs):
 value={}
 for k,v in pairs:need(type(k)is str and k not in value);value[k]=v
 return value
def parsed(blob):
 need(type(blob)is bytes and len(blob)<=FILE_LIMIT);return json.loads(blob.decode('utf8'),object_pairs_hook=unique)
def regular(path,limit=FILE_LIMIT):
 need(path.is_file()and not path.is_symlink());fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
 with os.fdopen(fd,'rb')as f:
  a=os.fstat(f.fileno());need(stat.S_ISREG(a.st_mode)and a.st_size<=limit and stat.S_IMODE(a.st_mode)==0o600);blob=f.read(limit+1);b=os.fstat(f.fileno());c=path.lstat();fields=lambda s:(s.st_dev,s.st_ino,s.st_mode,s.st_uid,s.st_gid,s.st_size,s.st_mtime_ns,s.st_ctime_ns);need(fields(a)==fields(b)==fields(c)and len(blob)==a.st_size)
 return blob
def trace_metadata(blob):
 need(type(blob)is bytes and 0<len(blob)<=FILE_LIMIT);text=blob.decode('utf8');frames=[];types=[];unknown=0;frame_count=0
 for line in text.splitlines():
  match=re.fullmatch(r'  File "([^"\r\n]+)", line ([1-9][0-9]{0,6}), in ([^\r\n]+)',line)
  if match:
   frame_count+=1;need(frame_count<=64);name=pathlib.PurePosixPath(match[1]).name;function=match[3]
   if name in FRAME_FILES and function in FUNCTIONS:frames.append({'file':name,'function':function,'line':int(match[2])})
   else:unknown+=1
   continue
  match=re.fullmatch(r'([A-Za-z_][A-Za-z0-9_.]*)(?::.*)?',line)
  if match and match[1] in EXCEPTIONS:types.append(match[1]);need(len(types)<=16)
 need(frames and types);return{'frames':frames,'exceptionTypes':types,'unrecognizedFrameCount':unknown,'allFramesRecognized':unknown==0,'sourceLinesAndExceptionMessagesOmitted':True}
def evidence():
 need(FAILED.is_dir()and not FAILED.is_symlink()and stat.S_IMODE(FAILED.stat().st_mode)==0o700)
 for parent in FAILED.parents:
  if parent==ROOT:need(parent.is_dir()and not parent.is_symlink());break
  need(parent.is_dir()and not parent.is_symlink())
 manifest_blob=regular(FAILED/'manifest.json');need(sha(manifest_blob)==FAILED_MANIFEST);manifest=parsed(manifest_blob);need(type(manifest)is dict and 2<=len(manifest)<=100000 and manifest.get('first-result.json')==FAILED_RESULT and type(manifest.get('failure.private.txt'))is str and re.fullmatch('[a-f0-9]{64}',manifest['failure.private.txt'])is not None)
 result_blob=regular(FAILED/'first-result.json',131072);need(sha(result_blob)==FAILED_RESULT);result=parsed(result_blob);need(result.get('mode')=='backup'and result.get('base')==result.get('target')==BASE and result.get('tree')==BASE_TREE and result.get('success')is False and result.get('backupComplete')is False and result.get('failedStage')=='entrypoint'and result.get('safeExceptionType')=='RuntimeError')
 for k in('businessWritesPerformed','containerSignalsPerformed','credentialsOrConfigurationChanged','healthOrBusinessHTTPRequestsPerformed','modelCallsPerformed','otherServicesRequested','secretOrRowsPrinted'):need(result.get(k)is False)
 trace=regular(FAILED/'failure.private.txt');need(sha(trace)==manifest['failure.private.txt']);value=trace_metadata(trace);value.update(failedManifestSHA256=FAILED_MANIFEST,failedResultSHA256=FAILED_RESULT,failedTraceSHA256=sha(trace),failedStage='entrypoint',failedSafeExceptionType='RuntimeError');return value
def sealed_runtime():
 manifest_blob=regular(FAILED/'manifest.json');need(sha(manifest_blob)==FAILED_MANIFEST);manifest=parsed(manifest_blob);name='target-inspect.private.json';need(type(manifest.get(name))is str and re.fullmatch('[a-f0-9]{64}',manifest[name])is not None);blob=regular(FAILED/name);need(sha(blob)==manifest[name]);value=parsed(blob);need(type(value)is dict and set(value)=={'indo-shipping'});old=value['indo-shipping'];need(type(old)is dict and re.fullmatch('[a-f0-9]{64}',old.get('Id',''))is not None and old.get('Image')=='sha256:037bae64802a4efa7bc3e33d50e412b88c76f0de674304fd184f051c4c09861d');labels=old.get('Config',{}).get('Labels',{});need(labels.get('com.docker.compose.project')=='rr-portal'and labels.get('com.docker.compose.service')=='indo-shipping');need(old['State']['Running']is True and old['State']['OOMKilled']is False and old['State'].get('Health',{}).get('Status')=='healthy');return old

def runtime_metadata(cid):
 template='\n'.join('{{json '+x+'}}'for x in('.Id','.Image','.State.Running','.State.StartedAt','.RestartCount','.State.OOMKilled','.State.Health.Status'));command=['docker','inspect','--format',template,cid];p=subprocess.run(command,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,timeout=20);need(p.returncode==0 and len(p.stdout)<=65536);lines=p.stdout.decode('utf8').splitlines();need(len(lines)==7);parts=[json.loads(x)for x in lines];need(all(type(parts[i])is str for i in(0,1,3,6))and type(parts[2])is bool and type(parts[4])is int and type(parts[5])is bool);return dict(zip(('id','image','running','started','restarts','oom','health'),parts))

def matches_runtime(old,current):
 return current=={'id':old['Id'],'image':old['Image'],'running':old['State']['Running'],'started':old['State']['StartedAt'],'restarts':old['RestartCount'],'oom':old['State']['OOMKilled'],'health':old['State']['Health']['Status']}

def program_tar_probe():
 old=sealed_runtime();before=runtime_metadata(old['Id']);need(matches_runtime(old,before));names=[p+x for p in('IndoShipping.Api','IndoShipping.Domain','IndoShipping.Infrastructure')for x in('.dll','.pdb')]+['wwwroot','db/postgres_schema.sql','seed/hs-dictionary.json'];command=['docker','exec','--user','0',old['Id'],'tar','-C','/app','-cf','-',*names];count=0;digest=hashlib.sha256();maximum=128*1024*1024;over=False;timed_out=False;deadline=time.monotonic()+120;p=subprocess.Popen(command,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL)
 try:
  while True:
   remaining=deadline-time.monotonic()
   if remaining<=0:timed_out=True;break
   ready=select.select([p.stdout],[],[],min(remaining,5))[0]
   if not ready:continue
   chunk=os.read(p.stdout.fileno(),65536)
   if not chunk:break
   if count+len(chunk)>maximum:over=True;break
   count+=len(chunk);digest.update(chunk)
  if over or timed_out:
   p.stdout.close()
   if p.poll()is None:p.terminate()
  code=p.wait(timeout=10)
 finally:
  if p.stdout and not p.stdout.closed:p.stdout.close()
  if p.poll()is None:p.kill();p.wait(timeout=5)
 after=runtime_metadata(old['Id']);need(matches_runtime(old,after)and after==before);return{'performed':True,'sealedOriginalRuntimeBeforeAndAfterMatches':True,'originalContainerStillRunning':after['running'],'programFilesOnly':True,'readOnlyTarFileSelectionMatchesReviewedQContainerFiles':True,'returnCode':code,'stdoutBytesHashed':count,'stdoutSHA256':digest.hexdigest(),'exceeds32MiB':count>32*1024*1024,'maximum128MiBLimitExceeded':over,'timedOut':timed_out,'archiveContentsSavedOrPrinted':False,'containerApplicationOrSignalsExecuted':False}

def write(path,blob):
 fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
 with os.fdopen(fd,'wb')as f:f.write(blob);f.flush();os.fsync(f.fileno())
def main():
 need(DIAGNOSTIC_PIN is True and sys.argv[1:]==['backup']and os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_ATTEMPT')=='1'and re.fullmatch('[a-f0-9]{40}',os.environ.get('RELEASE_SHA',''))is not None);os.umask(0o077);facts=evidence()
 try:probe=program_tar_probe()
 except BaseException as error:probe={'performed':False,'safeFailure':'FIXED_PROGRAM_PROBE_REJECTED','safeExceptionType':type(error).__name__ if type(error).__name__ in EXCEPTIONS else 'Unhandled','arbitraryExceptionMessagePrinted':False}
 need(not OUT.exists()and not OUT.is_symlink());OUT.mkdir(mode=0o700)
 result={'mode':'diagnose','base':BASE,'success':True,'failedRunId':39892794253,'trace':facts,'programTarProbe':probe,'archiveAndProgramSourceOnlyRead':True,'postgresCommandsPerformed':False,'dockerProgramSourceReadCommandsOnly':True,'containerSignalsPerformed':False,'HTTPOrModelCallsPerformed':False,'businessOrConfigurationWritesPerformed':False,'oldEvidenceModified':False,'arbitraryTraceSourceOrExceptionMessagePrinted':False}
 body=enc(result);write(OUT/'first-result.json',body);manifest=enc({'first-result.json':sha(body)});write(OUT/'manifest.json',manifest);print(enc(dict(result,manifestSHA256=sha(manifest),resultSHA256=sha(body))).decode(),flush=True)
 return 0
if __name__=='__main__':
 try:sys.exit(main())
 except SystemExit:raise
 except BaseException:print('{"mode":"diagnose","success":false,"safeFailure":"FIXED_TRACE_DIAGNOSTIC_REJECTED"}',flush=True);sys.exit(1)
