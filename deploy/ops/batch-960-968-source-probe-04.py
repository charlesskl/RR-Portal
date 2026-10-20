"""One fixed read-only diagnosis of sealed backup04 and QC source tools.
No database opens, data/environment reads, application writes or service signals.
"""
import hashlib,json,os,pathlib,re,stat,subprocess,sys
PROBE_PIN=False
BRANCH='refs/heads/ops/batch-960-966-967-968-20261020'
ROOT=pathlib.Path('/opt/rr-portal');BASE='4f1f64cac098caa6b202eb27cae9ab8fad9109dd'
FAILED=ROOT/'deploy/backups/batch-960-966-967-968-20261020-backup-04'
MANIFEST='2c4c8c9ac762559ac6f007ebfc98f9afbd429238a4eec89ca5a64b0b7fde16da';RESULT='bcb2ca6e60033f7634d347a1d88d2ed94e8e9ca02e2d9ba896b9bf9b8f35b075'
QC='apps/生产部/品质管理系统'
SERVICES={'rr-production','qc','internal-quote','voyageplex-api','voyageplex-web','voyageplex-parser'}
FIXED_PATHS=['/app','/app/server','/app/app.js','/app/index.html','/app/style.css','/app/report_export.js','/app/server/server.js','/app/server/seed.json','/app/server/package.json','/app/server/node_modules']
STATUS_SCRIPT="""set -eu
[ -d /app ] && [ ! -L /app ] || exit 1
cd /app
for name do
 kind=F
 current=$name
 while :; do
  if [ -L "$current" ]; then kind=S; break; fi
  if [ "$current" != "$name" ] && [ -e "$current" ] && [ ! -d "$current" ]; then kind=O; break; fi
  case "$current" in */*) current=${current%/*} ;; *) break ;; esac
 done
 if [ "$kind" = F ]; then
  if [ -f "$name" ]; then kind=F
  elif [ -e "$name" ]; then kind=O
  else kind=M
  fi
 fi
 printf '%s\\000%s\\000' "$name" "$kind"
done
"""
METADATA_SCRIPT="""const fs=require('node:fs');const names=JSON.parse(process.argv[1]);let out={};for(const n of names){try{const s=fs.lstatSync(n);let readable=true;try{fs.accessSync(n,fs.constants.R_OK)}catch(e){readable=false}out[n]={kind:s.isSymbolicLink()?'symlink':s.isFile()?'regular':s.isDirectory()?'directory':'other',bytes:s.size,mode:s.mode&4095,readable};}catch(e){out[n]={kind:'unavailable',error:['ENOENT','ENOTDIR','EACCES','ELOOP'].includes(e.code)?e.code:'OTHER'}}}process.stdout.write(JSON.stringify(out));"""
def need(value):
 if not value:raise RuntimeError('SOURCE_PROBE_04_REJECTED')
def sha(value):return hashlib.sha256(value).hexdigest()
def safe_path(value):
 p=pathlib.PurePosixPath(value);return type(value)is str and bool(value)and not p.is_absolute()and str(p)==value and all(v not in{'','.','..'}for v in p.parts)and not any(ord(c)<32 for c in value)
def file_hash(path):
 h=hashlib.sha256()
 with os.fdopen(os.open(path,os.O_RDONLY|os.O_NOFOLLOW),'rb')as stream:
  for block in iter(lambda:stream.read(1024*1024),b''):h.update(block)
 return h.hexdigest()
def verify_archive():
 need(FAILED.is_dir()and not FAILED.is_symlink()and stat.S_IMODE(FAILED.stat().st_mode)==0o700);need(file_hash(FAILED/'manifest.json')==MANIFEST and file_hash(FAILED/'first-result.json')==RESULT);manifest=json.loads((FAILED/'manifest.json').read_bytes());entries=list(FAILED.rglob('*'));need(len(entries)<=100000 and all(not p.is_symlink()and(p.is_file()or p.is_dir())and p.stat().st_mode&0o077==0 for p in entries));need(set(manifest)=={str(p.relative_to(FAILED))for p in entries if p.is_file()and p!=FAILED/'manifest.json'});need(all(safe_path(n)and re.fullmatch('[a-f0-9]{64}',h)and file_hash(FAILED/n)==h for n,h in manifest.items()));return manifest

def command(args,timeout=90):
 result=subprocess.run(args,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,cwd=ROOT,timeout=timeout);need(len(result.stdout)<=16*1024**2 and len(result.stderr)<=8*1024**2);return result

def error_labels(data,names):
 low=data.lower();labels=[]
 for needle,label in[(b'permission denied','permission-denied'),(b'no such file','no-such-file'),(b'not found','not-found'),(b'syntax error','shell-syntax-error'),(b'unrecognized option','unsupported-option'),(b'invalid option','invalid-option'),(b'not a directory','not-directory'),(b'cannot open','cannot-open'),(b'cannot stat','cannot-stat'),(b'error exit delayed','tar-error-exit'),(b'file changed as we read','tar-source-changed')]:
  if needle in low:labels.append(label)
 return {'knownErrorLabels':labels,'canonicalSourcePathsMentioned':[n for n in names if n.encode()in data][:32],'stderrBytes':len(data),'stderrSHA256':sha(data)}

def public_command(tokens):
 allowed={'node','server.js','server/server.js','tini','--','dotnet','VoyagePlex.Api.dll','uvicorn','app.main:app','--host','0.0.0.0','--port','8080','3000','/usr/local/bin/voyageplex-web','/bin/sh','sh','python','python3','-m'};need(tokens is None or type(tokens)is list and all(type(v)is str for v in tokens));return None if tokens is None else[v if v in allowed else'<redacted>'for v in tokens]

def inspect_facts(raw):
 facts={}
 for service,row in raw.items():
  cfg=row['Config'];directory=cfg.get('WorkingDir');facts[service]={'workingDirectory':directory if directory in{'/app','/app/server','/',''}else'<redacted>','entrypoint':public_command(cfg.get('Entrypoint')),'command':public_command(cfg.get('Cmd')),'containerId':row['Id'],'imageId':row['Image']}
 return facts

def main():
 need(PROBE_PIN and sys.argv[1:]==['probe']and os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_ATTEMPT')=='1');manifest=verify_archive();old=json.loads((FAILED/'target-inspect.private.json').read_bytes());need(set(old)==SERVICES and all(re.fullmatch('[a-f0-9]{64}',v['Id'])for v in old.values()));qc=old['qc']['Id'];paths=command(['git','ls-tree','-r','--name-only','-z',BASE,'--',QC]);need(paths.returncode==0);tracked=paths.stdout.decode().strip('\0').split('\0');names=[n[len(QC)+1:]for n in tracked if n.startswith(QC+'/')and(n[len(QC)+1:].startswith('server/')and not n[len(QC)+1:].startswith(('server/data/','server/node_modules/'))or n[len(QC)+1:]in{'app.js','report_export.js','index.html','style.css'})];need(0<len(names)<=5000 and len(set(names))==len(names)and all(safe_path(n)for n in names))
 live=command(['docker','inspect',*[v['Id']for v in old.values()]]);need(live.returncode==0);live_by_id={v['Id']:v for v in json.loads(live.stdout)};need(set(live_by_id)=={v['Id']for v in old.values()});raw={s:live_by_id[v['Id']]for s,v in old.items()};need(all(raw[s]['Image']==old[s]['Image']and raw[s]['State']['StartedAt']==old[s]['State']['StartedAt']and raw[s]['State']['Running']is True for s in SERVICES))
 trace=(FAILED/'failure-traceback.private.txt');need(trace.stat().st_size<=128*1024);frames=re.findall(r'^  File "[^\n]*", line ([0-9]+), in ([A-Za-z_][A-Za-z0-9_]*|<dictcomp>)$',trace.read_text(),re.M);allowed={'main','backup','source_proof','service_source_proof','simple_source_proof','baseline_source_path_status','container_files','run','need','<dictcomp>'};public_frames=[{'function':name,'publicSourceLine':int(line)}for line,name in frames if name in allowed];need(len(frames)<=64 and len(public_frames)<=24)
 errors=[]
 for path in sorted(FAILED.glob('*-stderr.private'))[-6:]:
  need(re.fullmatch('[0-9]{4}-stderr.private',path.name)and path.stat().st_size<=8*1024**2);e=error_labels(path.read_bytes(),names);e['sealedStderrFile']=path.name;errors.append(e)
 absolute=FIXED_PATHS+['/app/'+n for n in names if'/app/'+n not in FIXED_PATHS];meta=command(['docker','exec',qc,'node','-e',METADATA_SCRIPT,json.dumps(absolute,separators=(',',':'))]);metadata=None
 if meta.returncode==0:
  metadata=json.loads(meta.stdout);need(type(metadata)is dict and set(metadata)==set(absolute)and all(type(v)is dict and v.get('kind')in{'regular','directory','symlink','other','unavailable'}for v in metadata.values()))
 status=command(['docker','exec',qc,'sh','-c',STATUS_SCRIPT,'batch-baseline-canonical-source-status',*names]);fields=status.stdout.split(b'\0');protocol=len(fields)==2*len(names)+1 and fields[-1]==b''and all(fields[2*i]==n.encode()and fields[2*i+1]in{b'F',b'M',b'S',b'O'}for i,n in enumerate(names));statuses={n:fields[2*i+1].decode()for i,n in enumerate(names)}if protocol else None
 selected=[n for n in names if metadata and metadata['/app/'+n].get('kind')=='regular'];tar=None
 if selected:
  result=command(['docker','exec',qc,'tar','-C','/app','-cf','/dev/null',*selected]);tar=dict(returnCode=result.returncode,canonicalRequestedCount=len(selected),stdoutBytes=len(result.stdout),**error_labels(result.stderr,names))
 result={'success':True,'mode':'fixed-source-probe04','failedArchiveFullSealsVerifiedBeforeAndAfter':False,'noDatabaseOpened':True,'noEnvironmentOrDataContentRead':True,'noSourceContentPrinted':True,'noServiceConfigurationOrBusinessMutation':True,'sourceRecipeWorkingDirectory':'/app','actualServiceCommands':inspect_facts(raw),'sealedTracebackFrames':public_frames,'sealedRecentStderr':errors,'qcFixedPathKinds':{p:metadata[p]for p in FIXED_PATHS}if metadata else None,'qcMetadataCommand':dict(returnCode=meta.returncode,**error_labels(meta.stderr,names)),'qcCanonicalSourceCount':len(names),'qcCanonicalSourceKindCounts':{kind:sum(metadata['/app/'+n].get('kind')==kind for n in names)for kind in['regular','directory','symlink','other','unavailable']}if metadata else None,'qcCanonicalSourceUnavailableOrNonregular':{n:metadata['/app/'+n]for n in names if metadata['/app/'+n].get('kind')!='regular'}if metadata else None,'qcOriginalStatusCommand':dict(returnCode=status.returncode,stdoutBytes=len(status.stdout),stdoutSHA256=sha(status.stdout),nulCount=status.stdout.count(b'\0'),protocolValid=protocol,statusCounts={k:sum(v==k for v in statuses.values())for k in['F','M','S','O']}if statuses else None,**error_labels(status.stderr,names)),'qcCanonicalTarToDevNull':tar}
 final=command(['docker','inspect',*[v['Id']for v in old.values()]]);need(final.returncode==0);end={v['Id']:v for v in json.loads(final.stdout)};need(all(end[v['Id']]['Image']==v['Image']and end[v['Id']]['State']['StartedAt']==v['State']['StartedAt']and end[v['Id']]['State']['Running']is True and end[v['Id']]['Config']==v['Config']for v in raw.values()));need(verify_archive()==manifest);result['failedArchiveFullSealsVerifiedBeforeAndAfter']=True;encoded=json.dumps(result,sort_keys=True,separators=(',',':'));need(len(encoded.encode())<24000);print(encoded,flush=True)
if __name__=='__main__':
 try:main()
 except BaseException:print('{"success":false,"safeFailure":"SOURCE_PROBE04_REJECTED"}',flush=True);sys.exit(1)
