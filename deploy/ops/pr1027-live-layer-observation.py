"""Inert read-only fixed Indo public-stage observation; raw diff remains private."""
import hashlib,json,os,pathlib,re,subprocess,sys
EXECUTE=False
TARGET='70590f6d0dc1c691cfcc7c6b85c67e4a3574e571'
BRANCH='refs/heads/ops/pr-1027-clone-diagnostic-20261028'
OUT=pathlib.Path('/opt/rr-portal/deploy/backups/pr1027-r4-live-layer-observation-1')
CID='f77670c58a5e8022b048d7daa17aeb55740d14eb31e85cee8cb6e8f17aafeba8'
IMAGE='sha256:ba2a99c9ff21311e22ede4f5ce46a49ffbcd298c77845681e3a9c881d6f157d2'
SERIAL=0
STAGE='entry'
FORMAT='{"id":{{json .Id}},"image":{{json .Image}},"running":{{json .State.Running}},"health":{{if .State.Health}}{{json .State.Health.Status}}{{else}}null{{end}}}'
def need(v,label):
 global STAGE
 STAGE=label
 if not v:raise RuntimeError(label)
def enc(v):return json.dumps(v,sort_keys=True,separators=(',',':'),ensure_ascii=True,allow_nan=False).encode()
def sha(v):return hashlib.sha256(v).hexdigest()
def private(p,body):
 fd=os.open(p,os.O_CREAT|os.O_EXCL|os.O_WRONLY|os.O_NOFOLLOW,0o600)
 with os.fdopen(fd,'wb')as f:f.write(body);f.flush();os.fsync(f.fileno())
def command(args,limit):
 global SERIAL
 SERIAL+=1;base=OUT/('%02d'%SERIAL)
 paths=[base.with_suffix(x)for x in('.stdout.private','.stderr.private')]
 streams=[os.fdopen(os.open(p,os.O_CREAT|os.O_EXCL|os.O_WRONLY|os.O_NOFOLLOW,0o600),'wb')for p in paths]
 try:
  try:result=subprocess.run(args,stdout=streams[0],stderr=streams[1],timeout=60)
  finally:
   for f in streams:f.flush();os.fsync(f.fileno())
 finally:
  for f in streams:f.close()
 need(result.returncode==0,'read-only-docker-command-success');need(paths[0].stat().st_size<=limit,'bounded-private-command-output');return paths[0].read_bytes()
def public_summary(raw):
 need(type(raw)is bytes and len(raw)<=32*1024**2,'bounded-diff-input');roots={};other=[];types={'A':0,'C':0,'D':0,'unknown':0}
 lines=raw.splitlines();need(len(lines)<=200000,'bounded-diff-line-count')
 for line in lines:
  entry=re.fullmatch(rb'([ACD]) (.+)',line);match=re.match(rb'/app/(\.pr[0-9]{1,8}-[A-Za-z0-9][A-Za-z0-9-]{0,79}-[a-f0-9]{40})(?:/|$)',entry[2])if entry else None
  if match:
   name='/app/'+match[1].decode('ascii');counts=roots.setdefault(name,{'A':0,'C':0,'D':0});counts[entry[1].decode('ascii')]+=1
  else:
   other.append(line);types[entry[1].decode('ascii')if entry else'unknown']+=1
 need(len(roots)<=1000,'bounded-public-stage-root-count')
 return {'publicStageRoots':dict(sorted(roots.items())),'totalDiffLineCount':len(lines),'otherPathCount':len(other),'otherChangeCounts':types,'otherDiffSHA256':sha(b'\n'.join(other)),'rawDiffSHA256':sha(raw)}
def main():
 need(EXECUTE is True and sys.argv[1:]==['diagnose']and os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_MODE')=='diagnose'and os.environ.get('RELEASE_ATTEMPT')=='1'and re.fullmatch('[a-f0-9]{40}',TARGET),'inert-first-read-only-observation')
 os.umask(0o077);need(OUT.parent.is_dir()and not OUT.parent.is_symlink()and not OUT.exists()and not OUT.is_symlink(),'fresh-own-private-evidence-output');OUT.mkdir(mode=0o700)
 value={'phase':'diagnose','target':TARGET,'success':False,'readOnly':True,'lifecycleOrSQLUsed':False,'rawDiffPubliclyExposed':False}
 try:
  ids=command(['docker','ps','-aq','--no-trunc','--filter','label=com.docker.compose.project=rr-portal','--filter','label=com.docker.compose.service=indo-shipping'],4096).decode().split();need(ids==[CID],'fixed-unique-original-formal-indo-cid')
  runtime=json.loads(command(['docker','inspect','--format',FORMAT,CID],4096));need(runtime=={'id':CID,'image':IMAGE,'running':True,'health':'healthy'},'fixed-original-healthy-runtime-four-public-fields')
  value['runtime']=runtime;value['diff']=public_summary(command(['docker','diff',CID],32*1024**2));value['success']=True
 except Exception as e:value.update(errorType=type(e).__name__,stage=STAGE)
 value['resultSHA256']=sha(enc(value));value['sha256Wire']={'target':[int(c,16)for c in TARGET]};private(OUT/'result.private.json',enc(value));print(json.dumps(value,sort_keys=True),flush=True);return 0 if value['success']else 1
if __name__=='__main__':sys.exit(main())
