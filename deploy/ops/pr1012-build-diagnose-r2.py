"""Inert one-shot build diagnosis: bounded stderr tails and public runtime IDs.

No stdout logs, environment/config payloads, SQL, signals, writes or retries.
"""
import datetime,hashlib,json,os,pathlib,re,stat,subprocess,sys,urllib.parse
ROOT=pathlib.Path('/opt/rr-portal')
OUT=ROOT/'deploy/backups/pr-1012-20261026-release-r2/prepare'
BRANCH='refs/heads/ops/pr-1012-20261026'
TARGET='df60d6a6b1e7f76070cd866cbbc6a4ee50936122'
PHASE='diagnose-build-r2'
EXECUTE=True
SERVICES=('sprayplan-test','sprayplan')
TAIL_BYTES=32768
TAIL_LINES=25
LINE_CHARS=350
STAGE='entry'
SENSITIVE=re.compile(r'password|token|authcode|key|secret|authorization',re.I)
URL=re.compile(r'[a-zA-Z][a-zA-Z0-9+.-]*://[^\s<>\x22\x27]+')
def need(v,label):
 global STAGE
 STAGE=label
 if not v:raise RuntimeError(label)
def enc(v):return json.dumps(v,sort_keys=True,separators=(',',':'),ensure_ascii=True,allow_nan=False).encode()
def sha(v):return hashlib.sha256(v).hexdigest()
def run(args):
 global STAGE
 STAGE='read-only-'+pathlib.Path(args[0]).name
 p=subprocess.run(args,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=30,cwd=ROOT)
 need(p.returncode==0 and len(p.stdout)<=128*1024,'bounded-read-only-command');return p.stdout
def redact(line):
 if SENSITIVE.search(line):return '[REDACTED: sensitive setting line]'
 def url(match):
  try:
   value=urllib.parse.urlsplit(match.group());netloc=value.netloc.rsplit('@',1)[-1]
   return urllib.parse.urlunsplit((value.scheme,netloc,value.path,'',''))
  except ValueError:return '[REDACTED URL]'
 value=URL.sub(url,line)[:LINE_CHARS]
 while len(json.dumps(value).encode())>LINE_CHARS:value=value[:-1]
 return value
def stderr_tails():
 need(OUT.is_dir()and not OUT.is_symlink(),'fixed-existing-prepare-directory');files=[]
 for p in OUT.glob('*.stderr.private'):
  need(re.fullmatch(r'[0-9]{3,6}\.stderr\.private',p.name)is not None,'fixed-stderr-filename');s=p.lstat();need(stat.S_ISREG(s.st_mode)and not p.is_symlink(),'regular-stderr-file');files.append((s.st_mtime_ns,p.name,p,s))
 need(len(files)<=10000,'bounded-stderr-file-count');result=[]
 for _,name,p,before in sorted(files)[-3:]:
  fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW)
  with os.fdopen(fd,'rb')as f:
   opened=os.fstat(f.fileno());need((opened.st_dev,opened.st_ino,opened.st_size)==(before.st_dev,before.st_ino,before.st_size),'stable-stderr-identity');f.seek(max(0,opened.st_size-TAIL_BYTES));raw=f.read(TAIL_BYTES)
   after=os.fstat(f.fileno());need((opened.st_dev,opened.st_ino,opened.st_size,opened.st_mtime_ns)==(after.st_dev,after.st_ino,after.st_size,after.st_mtime_ns),'stderr-not-changing-during-read')
  lines=raw.decode('utf-8',errors='replace').splitlines()
  if opened.st_size>TAIL_BYTES and lines:lines=lines[1:]
  result.append({'name':name,'bytes':opened.st_size,'mtimeNS':opened.st_mtime_ns,'tailReadBytes':len(raw),'excerpt':[redact(line)for line in lines[-TAIL_LINES:]]})
 return result
def runtime(service):
 ids=run(['docker','ps','-aq','--no-trunc','--filter','label=com.docker.compose.project=rr-portal','--filter','label=com.docker.compose.service='+service]).decode().split();need(len(ids)==1 and re.fullmatch('[a-f0-9]{64}',ids[0])is not None,'unique-service-container')
 template='{{.Id}} {{.Image}} {{.State.Running}} {{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}'
 values=run(['docker','container','inspect','--format',template,ids[0]]).decode().split();need(len(values)==4 and values[0]==ids[0]and re.fullmatch('sha256:[a-f0-9]{64}',values[1])is not None and values[2]in('true','false')and values[3]in('healthy','unhealthy','starting','none'),'runtime-public-metadata-only')
 flag=ROOT/'deploy/maintenance/services'/service
 return {'id':values[0],'image':values[1],'Running':values[2]=='true','health':values[3],'maintenanceFlagExists':flag.exists()or flag.is_symlink()}
def candidate(service):
 tag='rr-portal-'+service+':pr1012-'+TARGET[:12];ids=run(['docker','image','ls','--quiet','--no-trunc','--filter','reference='+tag]).decode().split();need(len(ids)<=1 and all(re.fullmatch('sha256:[a-f0-9]{64}',i)for i in ids),'fixed-candidate-tag-only')
 return {'tag':tag,'exists':bool(ids),'image':ids[0]if ids else None}
def diagnose():
 need(run(['git','rev-parse','refs/remotes/origin/main']).decode().strip()==TARGET,'cached-main-is-reviewed-target')
 remote=run(['git','ls-remote','--exit-code','origin','refs/heads/main']).decode().split();need(remote==[TARGET,'refs/heads/main'],'remote-main-is-reviewed-target')
 tails=stderr_tails();services={s:runtime(s)for s in SERVICES};tags={s:candidate(s)for s in SERVICES}
 return {'stderr':tails,'services':services,'candidateTags':tags,'serviceSignalsSQLOrFileWrites':False}
def main():
 need(EXECUTE is True and sys.argv[1:]==[PHASE]and os.environ.get('RELEASE_MODE')==PHASE and os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_ATTEMPT')=='1','inert-exact-first-diagnosis')
 result={'phase':PHASE,'target':TARGET,'success':False}
 try:result.update(diagnose());result['success']=True
 except Exception as e:result.update(errorType=type(e).__name__,stage=STAGE)
 result['utc']=datetime.datetime.now(datetime.timezone.utc).isoformat();result['resultSHA256']=sha(enc(result));print(json.dumps(result,sort_keys=True),flush=True);return 0 if result['success']else 1
if __name__=='__main__':sys.exit(main())
