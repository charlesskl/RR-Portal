"""Inert fixed-sealed writable-layer inventory and lstat metadata diagnostic.
No file contents, recursion, applications, PG, HTTP, signals or configuration writes.
Unknown paths are represented only by SHA256 and a fixed category.
"""
import hashlib,json,os,pathlib,re,stat,subprocess,sys,time
DIAGNOSTIC_PIN=False
ROOT=pathlib.Path('/opt/rr-portal')
BRANCH='refs/heads/ops/pr-996-20261023-trace-02'
BASE='6742f820c0a43388e274b867a2825a42548b5cea'
BASE_TREE='ce652db9eb263e09d24a3f44ef0c48a5c1f7b79e'
FAILED=ROOT/'deploy/backups/pr-996-20261023-03-backup'
FAILED_MANIFEST='5535bde68057452928cad0fe48a632af1c7fea42290c8f9d591f29155a53adec'
FAILED_RESULT='887a05699864ab0353f61167814176e32c306e18b84d5332c66c8e1d42cccddd'
OUT=ROOT/'deploy/backups/pr-996-20261023-trace-02'
FILE_LIMIT=2*1024*1024
EXPECTED_STAGE='no-unbacked-application-files-or-persistent-key-directories-in-writable-layer'
KNOWN={'/tmp':'temporary_directory','/tmp/.dotnet':'dotnet_temporary_directory','/tmp/.dotnet/shm':'dotnet_temporary_shared_memory_directory','/home':'home_directory','/home/app':'application_home_directory','/home/app/.aspnet':'application_aspnet_directory','/home/app/.aspnet/DataProtection-Keys':'application_aspnet_key_directory','/home/app/.dotnet':'application_dotnet_directory','/home/app/.cache':'application_cache_directory','/app':'application_program_directory'}
class Rejected(Exception):pass
def need(v):
 if not v:raise Rejected()
def sha(v):return hashlib.sha256(v).hexdigest()
def enc(v):return json.dumps(v,ensure_ascii=True,sort_keys=True,separators=(',',':'),allow_nan=False).encode()
def unique(pairs):
 d={}
 for k,v in pairs:need(type(k)is str and k not in d);d[k]=v
 return d
def parsed(b):need(type(b)is bytes and len(b)<=FILE_LIMIT);return json.loads(b.decode('utf8'),object_pairs_hook=unique)
def regular(path,limit=FILE_LIMIT):
 need(path.is_file()and not path.is_symlink());fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
 with os.fdopen(fd,'rb')as f:
  a=os.fstat(f.fileno());need(stat.S_ISREG(a.st_mode)and a.st_size<=limit and stat.S_IMODE(a.st_mode)==0o600);b=f.read(limit+1);z=os.fstat(f.fileno());fields=lambda s:(s.st_dev,s.st_ino,s.st_mode,s.st_uid,s.st_gid,s.st_size,s.st_mtime_ns,s.st_ctime_ns);need(fields(a)==fields(z)==fields(path.lstat())and len(b)==a.st_size)
 return b
def evidence():
 need(FAILED.is_dir()and not FAILED.is_symlink()and stat.S_IMODE(FAILED.stat().st_mode)==0o700)
 for p in FAILED.parents:
  need(p.is_dir()and not p.is_symlink())
  if p==ROOT:break
 mb=regular(FAILED/'manifest.json');need(sha(mb)==FAILED_MANIFEST);m=parsed(mb);need(type(m)is dict and m.get('first-result.json')==FAILED_RESULT);rb=regular(FAILED/'first-result.json',131072);need(sha(rb)==FAILED_RESULT);r=parsed(rb);need(r.get('mode')=='backup'and r.get('base')==r.get('target')==BASE and r.get('tree')==BASE_TREE and r.get('success')is False and r.get('backupComplete')is False and r.get('failedStage')==EXPECTED_STAGE)
 for k in('businessWritesPerformed','containerSignalsPerformed','credentialsOrConfigurationChanged','healthOrBusinessHTTPRequestsPerformed','modelCallsPerformed','otherServicesRequested','secretOrRowsPrinted'):need(r.get(k)is False)
 files={}
 for n in('indo-original-writable-layer-paths.private.json','target-inspect.private.json'):
  need(type(m.get(n))is str and re.fullmatch('[a-f0-9]{64}',m[n])is not None);b=regular(FAILED/n);need(sha(b)==m[n]);files[n]=parsed(b)
 lines=files['indo-original-writable-layer-paths.private.json'];need(type(lines)is list and len(lines)<=256 and len(lines)==len(set(lines))and all(type(x)is str and len(x)<=4096 for x in lines));records=files['target-inspect.private.json'];need(type(records)is dict and set(records)=={'indo-shipping'});old=records['indo-shipping'];need(re.fullmatch('[a-f0-9]{64}',old.get('Id',''))is not None and old.get('Image')=='sha256:037bae64802a4efa7bc3e33d50e412b88c76f0de674304fd184f051c4c09861d');labels=old.get('Config',{}).get('Labels',{});need(labels.get('com.docker.compose.project')=='rr-portal'and labels.get('com.docker.compose.service')=='indo-shipping'and old['State']['Running']is True and old['State']['OOMKilled']is False and old['State']['Health']['Status']=='healthy');return lines,old,m['indo-original-writable-layer-paths.private.json']
def runtime_metadata(cid,timeout):
 template='\n'.join('{{json '+x+'}}'for x in('.Id','.Image','.State.Running','.State.StartedAt','.RestartCount','.State.OOMKilled','.State.Health.Status'));p=subprocess.run(['docker','inspect','--format',template,cid],stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,timeout=timeout);need(p.returncode==0 and len(p.stdout)<=65536);rows=p.stdout.decode('utf8').splitlines();need(len(rows)==7);return [json.loads(x)for x in rows]
def expected(old):return[old['Id'],old['Image'],True,old['State']['StartedAt'],old['RestartCount'],False,'healthy']
def category(path):
 if any(path==p or path.startswith(p+'/')for p in('/home/app/.aspnet/DataProtection-Keys','/root/.aspnet/DataProtection-Keys')):return'aspnet_data_protection_key_candidate'
 if path=='/tmp'or path.startswith('/tmp/'):return'temporary_runtime_candidate'
 if any(path==p or path.startswith(p+'/')for p in('/home/app/.dotnet','/home/app/.cache','/home/app/.nuget','/root/.dotnet','/root/.cache','/root/.nuget')):return'runtime_cache_candidate'
 if path=='/root'or path.startswith('/root/'):return'administrator_home_candidate'
 if path=='/home/app'or path.startswith('/home/app/'):return'application_home_candidate'
 if path=='/app'or path.startswith('/app/'):return'application_program_or_data_candidate'
 return'unclassified_filesystem_change'
def path_record(line):
 match=re.fullmatch(r'([ACD]) (/[^\r\n]+)',line);record={'sealedDiffEntrySHA256':sha(line.encode())}
 if not match:return dict(record,pathClass='unparsed_diff_entry',metadataStatus='not_probed_invalid_entry'),None,None
 action,path=match[1],match[2];safe=not path.startswith('//')and str(pathlib.PurePosixPath(path))==path and all(x not in{'.','..'}for x in pathlib.PurePosixPath(path).parts)and not any(ord(x)<32 for x in path);record.update(change=action,pathSHA256=sha(path.encode()),pathClass=category(path))
 if path in KNOWN:record.update(knownStandardPath=path,knownStandardLocation=KNOWN[path])
 elif path=='/root':record['knownStandardLocation']='administrator_home_directory'
 elif path=='/root/.aspnet':record['knownStandardLocation']='administrator_aspnet_directory'
 elif path=='/root/.aspnet/DataProtection-Keys':record['knownStandardLocation']='administrator_aspnet_key_directory'
 if not safe:record['metadataStatus']='not_probed_noncanonical_path';return record,None,None
 return record,path,action
def lstat_metadata(cid,path,action,timeout):
 p=subprocess.run(['docker','exec','--user','0',cid,'stat','-c','%f|%a|%u|%g|%s','--',path],stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,timeout=timeout);need(len(p.stdout)<=4096)
 if p.returncode!=0:return{'metadataStatus':'absent'if action=='D'else'not_present_or_inaccessible','statReturnCode':p.returncode,'absenceIsStatFailureOnly':True}
 text=p.stdout.decode('ascii').strip();need(re.fullmatch('[0-9a-f]+[|][0-7]+[|][0-9]+[|][0-9]+[|][0-9]+',text)is not None);a,b,c,d,e=text.split('|');bits=int(a,16);mode=int(b,8);uid,gid,size=int(c),int(d),int(e);need(stat.S_IMODE(bits)==mode and 0<=uid<2**32 and 0<=gid<2**32 and 0<=size<2**63);kind=next((n for test,n in((stat.S_ISREG,'regular_file'),(stat.S_ISDIR,'directory'),(stat.S_ISLNK,'symlink'),(stat.S_ISSOCK,'socket'),(stat.S_ISFIFO,'fifo'),(stat.S_ISCHR,'character_device'),(stat.S_ISBLK,'block_device'))if test(bits)),'other')
 return{'metadataStatus':'present','type':kind,'modeOctal':format(mode,'04o'),'uid':uid,'gid':gid,'bytes':size,'statReturnCode':0,'deletedEntryNowPresent':action=='D'}
def collect(lines,old,deadline):
 before=runtime_metadata(old['Id'],min(10,max(0.01,deadline-time.monotonic())));need(before==expected(old));rows=[]
 for line in lines:
  row,path,action=path_record(line)
  if path is not None:
   remaining=deadline-time.monotonic()-10
   if remaining<=0:row['metadataStatus']='not_probed_total_time_budget'
   else:
    try:row.update(lstat_metadata(old['Id'],path,action,min(10,remaining)))
    except subprocess.TimeoutExpired:row['metadataStatus']='not_probed_stat_timeout'
  rows.append(row)
 after=runtime_metadata(old['Id'],min(10,max(0.01,deadline-time.monotonic())));need(after==before==expected(old));return rows
def write(path,b):
 fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
 with os.fdopen(fd,'wb')as f:f.write(b);f.flush();os.fsync(f.fileno())
def main():
 need(DIAGNOSTIC_PIN is True and sys.argv[1:]==['backup']and os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_ATTEMPT')=='1'and re.fullmatch('[a-f0-9]{40}',os.environ.get('RELEASE_SHA',''))is not None);deadline=time.monotonic()+120;lines,old,list_hash=evidence();rows=collect(lines,old,deadline);need(time.monotonic()<=deadline);os.umask(0o077);need(not OUT.exists()and not OUT.is_symlink());OUT.mkdir(mode=0o700);result={'mode':'diagnose','base':BASE,'success':True,'failedRunId':39894262611,'failedManifestSHA256':FAILED_MANIFEST,'failedResultSHA256':FAILED_RESULT,'sealedDiffListSHA256':list_hash,'sealedDiffEntryCount':len(lines),'entries':rows,'sealedOriginalRuntimeBeforeAndAfterMatches':True,'originalContainerStillHealthyAndRunning':True,'onlyFixedSealedEntriesLstatRead':True,'fileContentsReadOrPrinted':False,'recursiveScanPerformed':False,'unknownPathsPrinted':False,'oldEvidenceModified':False,'containerSignalsOrApplicationCommandsPerformed':False,'postgresHTTPModelOrBusinessWritesPerformed':False,'ignoredUnknownEntries':False};body=enc(result);write(OUT/'first-result.json',body);mb=enc({'first-result.json':sha(body)});write(OUT/'manifest.json',mb);print(enc(dict(result,manifestSHA256=sha(mb),resultSHA256=sha(body))).decode(),flush=True);return 0
if __name__=='__main__':
 try:sys.exit(main())
 except SystemExit:raise
 except BaseException:print('{"mode":"diagnose","success":false,"safeFailure":"FIXED_WRITABLE_INVENTORY_REJECTED"}',flush=True);sys.exit(1)
