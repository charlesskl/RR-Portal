"""Inert read-only diagnosis of one sealed PR1025 prepare failure.
Only ps/inspect and fixed anonymous health GETs; raw logs remain private.
No SQL, exec, lifecycle, dispatch or original evidence modification.
"""
import hashlib,json,os,pathlib,re,stat,subprocess,sys,urllib.error,urllib.request
EXECUTE=True
ROOT=pathlib.Path('/opt/rr-portal')
PREPARE=ROOT/'deploy/backups/pr1025-sprayplan-20261028/prepare'
OUT=ROOT/'deploy/backups/pr1025-sprayplan-20261028-build-diagnostic-1'
BRANCH='refs/heads/ops/pr-1025-20261028-sprayplan'
TARGET='9d942c021e3d307e89ad1a8ea1a2425199fced1b'
MANIFEST_SHA256='94ef25d65bb14ba404d18e321a2c38a3b2c6e03eb52d5abb05ad13b4c5e8bbc6'
FAILED_RESULT_SHA256='829fbb50bb7097419b8de996689ba13e6b53808fca69877a2fefcf4496f86d52'
STAGE='entry'
def enc(v):return json.dumps(v,sort_keys=True,separators=(',',':'),ensure_ascii=True,allow_nan=False).encode()
def sha(v):return hashlib.sha256(v).hexdigest()
def need(v,label):
 global STAGE
 if not v:STAGE=label;raise RuntimeError('BUILD_DIAGNOSTIC_REJECTED')
def regular(path,maximum=256*1024**2):
 fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
 try:
  first=os.fstat(fd);need(stat.S_ISREG(first.st_mode) and first.st_size<=maximum,'bounded-regular-private-evidence');chunks=[]
  for block in iter(lambda:os.read(fd,1024**2),b''):chunks.append(block)
  raw=b''.join(chunks);last=os.fstat(fd);named=path.lstat();key=lambda x:(x.st_dev,x.st_ino,x.st_uid,x.st_gid,x.st_mode,x.st_size,x.st_mtime_ns)
  need(key(first)==key(last)==key(named) and len(raw)==first.st_size,'stable-private-evidence-read');return raw
 finally:os.close(fd)
def private(name,value):
 fd=os.open(OUT/name,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
 with os.fdopen(fd,'wb') as stream:stream.write(value if type(value)is bytes else enc(value));stream.flush();os.fsync(stream.fileno())
def read_command(args,name):
 value=subprocess.run(args,cwd=ROOT,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=30)
 need(len(value.stdout)+len(value.stderr)<=16*1024**2,'bounded-readonly-inspection');private(name+'.stdout.private',value.stdout);private(name+'.stderr.private',value.stderr)
 need(value.returncode==0,'readonly-inspection-'+name);return value.stdout

def seal():
 raw=regular(PREPARE/'manifest.json',8*1024**2);need(sha(raw)==MANIFEST_SHA256,'exact-failed-prepare-manifest');values=json.loads(raw)
 need(type(values)is dict and len(values)<100000,'bounded-sealed-private-files')
 for name,digest in values.items():
  path=pathlib.PurePosixPath(name);need(type(name)is str and name and not path.is_absolute() and str(path)==name and all(p not in ('','.','..') for p in path.parts)
       and re.fullmatch('[a-f0-9]{64}',str(digest)) is not None,'safe-original-sealed-file')
  need(not any(p.is_symlink() for p in (PREPARE/name,*(PREPARE/name).parents)),'original-evidence-has-no-link-components')
  need(sha(regular(PREPARE/name))==digest,'every-original-sealed-file-exact')
 actual={str(p.relative_to(PREPARE)) for p in PREPARE.rglob('*') if p.is_file() and p.name not in ('manifest.json','result.private.json')}
 need(actual==set(values) and all(not p.is_symlink() for p in PREPARE.rglob('*')),'exact-original-private-evidence-set')
 result=json.loads(regular(PREPARE/'result.private.json',1024**2))
 need(sha(enc(result))==FAILED_RESULT_SHA256 and result.get('target')==TARGET and result.get('phase')=='prepare'
      and result.get('success') is False and result.get('stage')=='command-docker','exact-original-failed-result')
 return values

def safe_diagnostics(raw):
 text=raw.decode('utf-8','replace')
 hosts=('registry.npmjs.org','registry.npmmirror.com','npmmirror.com','binaries.prisma.sh','registry-1.docker.io','auth.docker.io',
        'mcr.microsoft.com','deb.debian.org','security.debian.org','mirrors.aliyun.com','api.nuget.org','globalcdn.nuget.org','nodejs.org')
 codes=('ECONNRESET','ETIMEDOUT','ENOTFOUND','EAI_AGAIN','ECONNREFUSED','ENETUNREACH','EHOSTUNREACH','EPIPE','UND_ERR_CONNECT_TIMEOUT',
        'UND_ERR_SOCKET','CERT_HAS_EXPIRED','UNABLE_TO_VERIFY_LEAF_SIGNATURE','SELF_SIGNED_CERT_IN_CHAIN','ERR_TLS_CERT_ALTNAME_INVALID')
 technical=sorted(set(re.findall('(?:error|warning)\\s+((?:TS|CS|NU|NETSDK|MSB)[0-9]{4})\\b',text,re.I)))
 statuses=sorted(set(int(v) for v in re.findall('(?:HTTP/[12](?:[.]1)?\\s+|status(?: code)?[ :=]+|returned error:[ ]*)([1-5][0-9]{2})\\b',text,re.I)))
 for code,label in ((401,'Unauthorized'),(403,'Forbidden'),(404,'Not Found'),(408,'Request Timeout'),(429,'Too Many Requests'),(500,'Internal Server Error'),(502,'Bad Gateway'),(503,'Service Unavailable'),(504,'Gateway Timeout')):
  if re.search(str(code)+'[ ]+'+label,text,re.I):statuses.append(code)
 paths=[]
 for path,line,column in re.findall('([A-Za-z0-9_@./\\[\\]()+-]{1,240}[.](?:tsx?|jsx?|mjs|cs|json))(?::|[(])([0-9]{1,6})(?::|,)([0-9]{1,6})[)]?',text):
  path=path.removeprefix('/src/').removeprefix('./')
  if path.startswith(('src/','server/','prisma/','tests/','Services/','Data/','Entities/','Features/')) and '..' not in pathlib.PurePosixPath(path).parts:paths.append({'path':path,'line':int(line),'column':int(column)})
 return {'networkHosts':[v for v in hosts if re.search('(?<![A-Za-z0-9_.-])'+re.escape(v)+'(?![A-Za-z0-9_.-])',text)],
         'networkErrorCodes':[v for v in codes if re.search('\\b'+v+'\\b',text)],'compilerErrorCodes':technical[:24],
         'httpStatusCodes':sorted(set(statuses)),'sourceLocations':paths[:24],
         'npmFailure':bool(re.search('npm (?:ERR!|error)',text,re.I)),'typescriptFailure':bool(re.search('Type error:|error TS[0-9]{4}',text)),
         'dotnetBuildFailure':bool(re.search('Build FAILED|error (?:CS|NETSDK|MSB)[0-9]{4}',text,re.I)),
         'dockerBuildFailure':bool(re.search('failed to (?:solve|build)|ERROR:.*(?:build|Dockerfile)',text,re.I)),
         'npmCodes':[v for v in ('E401','E403','E404') if re.search('\\b'+v+'\\b',text)],
         'processExitCodes':sorted(set(int(v) for pair in re.findall('exit code[:= ]+(1|137)\\b|non-zero code:[ ]*(1|137)\\b',text,re.I) for v in pair if v)),
         'diskFull':bool(re.search('no space left on device',text,re.I)),'oomOrKilled':bool(re.search('out of memory|OOMKilled|Killed',text,re.I))}

class NoRedirect(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,*args,**kwargs):return None

def services():
 baseline=json.loads(regular(PREPARE/'current-runtime.private.json',8*1024**2));result={}
 for service in ('sprayplan','sprayplan-test'):
  ids=read_command(['docker','ps','-aq','--no-trunc','--filter','label=com.docker.compose.project=rr-portal','--filter','label=com.docker.compose.service='+service],service+'-ids').decode().split()
  need(0<len(ids)<32,'bounded-matching-service-inspection');rows=json.loads(read_command(['docker','inspect',*ids],service+'-inspect'))
  originals=[r for r in rows if r['Id'] in baseline and (baseline[r['Id']]['config'].get('Labels')or{}).get('com.docker.compose.service')==service]
  need(len(originals)==1,'one-baseline-original-service-'+service);row=originals[0];extras=[r for r in rows if r['Id']!=row['Id']]
  known_owned=any(any(k in (r['Config'].get('Labels')or{}) for k in ('io.rr-portal.pr1025-probe','io.rr-portal.pr1018-release')) for r in extras)
  actual={'image':row['Image'],'config':row['Config'],'hostConfig':row['HostConfig'],'mounts':sorted(row['Mounts'],key=enc),
          'started':row['State']['StartedAt'],'restarts':row['RestartCount'],'running':row['State']['Running'],
          'oom':row['State']['OOMKilled'],'health':row['State'].get('Health',{}).get('Status')}
  need(baseline.get(row['Id'])==actual and actual['running'] and not actual['oom'] and actual['health']=='healthy','original-healthy-runtime-exact-'+service)
  gate=ROOT/'deploy/maintenance/services'/service;need(not gate.exists() and not gate.is_symlink(),'original-service-has-no-gate')
  opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),NoRedirect())
  try:
   with opener.open('http://127.0.0.1/'+service+'/api/health',timeout=15) as response:response.read(131072);code=response.status
  except urllib.error.HTTPError as error:code=error.code;error.close()
  need(code==200,'original-public-health200-'+service);result[service]={'sameOriginalRuntime':True,'healthy':True,'publicHealth200':True,'maintenanceAbsent':True,'extraMatchingContainersCount':len(extras),'extraKnownOwnedLabelPresent':known_owned}
 return result

def main():
 need(EXECUTE is True and sys.argv[1:]==['build-diagnostic'] and os.environ.get('RELEASE_BRANCH')==BRANCH
      and os.environ.get('RELEASE_MODE')=='build-diagnostic' and os.environ.get('RELEASE_ATTEMPT')=='1','inert-first-readonly-diagnosis')
 os.umask(0o077);need(OUT.parent.is_dir() and not OUT.parent.is_symlink() and not OUT.exists() and not OUT.is_symlink(),'fresh-private-diagnostic-directory');OUT.mkdir(mode=0o700)
 result={'phase':'build-diagnostic','target':TARGET,'success':False,'noLifecycleSQLOrOriginalEvidenceChanges':True}
 try:
  values=seal();serials=[int(m[1]) for name in values if (m:=re.fullmatch('([0-9]{3,})[.](?:stdout|stderr)[.]private',name))]
  need(serials,'sealed-command-logs-exist');last=max(serials);parts=[]
  for stream in ('stdout','stderr'):
   name='%03d.%s.private'%(last,stream);need(name in values,'complete-last-command-private-pair');raw=regular(PREPARE/name);private('last-command.'+stream+'.private',raw);parts.append(raw)
  result.update(lastCommandSerial=last,diagnostics=safe_diagnostics(bytes([10]).join(parts)))
  result['services']=services()
  need(seal()==values,'original-sealed-evidence-still-exact');result['success']=True
 except Exception as error:result.update(errorType=type(error).__name__,stage=STAGE)
 private('result.private.json',result);result['resultSHA256']=sha(enc(result))
 result['sha256Wire']={k:[int(c,16) for c in v] for k,v in result.items() if type(v)is str and re.fullmatch('[a-f0-9]{40}|[a-f0-9]{64}',v)}
 print(json.dumps(result,sort_keys=True),flush=True);return 0 if result['success'] else 1
if __name__=='__main__':sys.exit(main())
