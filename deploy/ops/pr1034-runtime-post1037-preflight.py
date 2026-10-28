"""Inert readonly host/shared-file/Indo baseline observation; no Env/keyring/SQL."""
import hashlib,json,os,pathlib,re,stat,subprocess,sys
EXECUTE=True
TARGET='f22fbffa1789234fe1c78bf776f4dcb3fe867d0c'
BRANCH='refs/heads/ops/pr-1034-20261028-indo-static'
ROOT=pathlib.Path('/opt/rr-portal')
OUT=ROOT/'deploy/backups/pr1034-runtime-preflight-2'
SHARED=('docker-compose.cloud.yml','frontend/index.cloud.html','nginx/nginx.cloud.conf','deploy/update-server.sh','deploy/service-maintenance.sh')
KNOWN_DIRTY=set(SHARED)|{'.env.cloud.production','.github/workflows/deploy.yml'}
ALIAS='rr-portal-indo-shipping:latest'
ISO=r'[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:[.][0-9]{1,9})?(?:Z|[+-][0-9]{2}:[0-9]{2})'
RUNTIME_FORMAT='{"id":{{json .Id}},"image":{{json .Image}},"running":{{json .State.Running}},"health":{{if .State.Health}}{{json .State.Health.Status}}{{else}}"absent"{{end}},"restarts":{{json .RestartCount}},"pid":{{json .State.Pid}},"started":{{json .State.StartedAt}},"revision":{{with index .Config.Labels "org.opencontainers.image.revision"}}{{json .}}{{else}}null{{end}}}'
IMAGE_FORMAT='{"id":{{json .Id}},"revision":{{with index .Config.Labels "org.opencontainers.image.revision"}}{{json .}}{{else}}null{{end}},"frontendAppTree":{{with index .Config.Labels "io.rr-portal.frontend-app-tree"}}{{json .}}{{else}}null{{end}},"backendImage":{{with index .Config.Labels "io.rr-portal.backend-image"}}{{json .}}{{else}}null{{end}}}'
SERIAL=0
STAGE='entry'
def need(v,label):
 global STAGE
 STAGE=label
 if not v:raise RuntimeError(label)
def enc(v):return json.dumps(v,sort_keys=True,separators=(',',':'),ensure_ascii=True,allow_nan=False).encode()
def sha(v):return hashlib.sha256(v).hexdigest()
def pin(v,n=64):return type(v)is str and re.fullmatch('[a-f0-9]{%d}'%n,v)is not None
def command(args,limit=8*1024**2):
 global SERIAL
 SERIAL+=1;base=OUT/('%02d'%SERIAL);files=[base.with_suffix(s)for s in('.stdout.private','.stderr.private')];opened=[os.fdopen(os.open(p,os.O_CREAT|os.O_EXCL|os.O_WRONLY|os.O_NOFOLLOW,0o600),'wb')for p in files]
 try:
  try:p=subprocess.run(args,stdout=opened[0],stderr=opened[1],timeout=45)
  finally:
   for f in opened:f.flush();os.fsync(f.fileno())
 finally:
  for f in opened:f.close()
 need(p.returncode==0,'readonly-command-success');need(files[0].stat().st_size<=limit,'bounded-private-command-output');return files[0].read_bytes()
def git(*a):return command(['git','-C',str(ROOT),'-c','core.hooksPath=/dev/null',*a])
def shared_file(name):
 p=ROOT/name;need(not any(x.is_symlink()for x in(p,*p.parents)),'regular-real-fixed-shared-path');fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW)
 try:
  a=os.fstat(fd);need(stat.S_ISREG(a.st_mode)and 0<=a.st_size<=8*1024**2,'bounded-shared-regular-file');body=b''
  while True:
   b=os.read(fd,1024**2)
   if not b:break
   body+=b;need(len(body)<=8*1024**2,'bounded-shared-read')
  z=os.fstat(fd);key=lambda s:(s.st_dev,s.st_ino,s.st_uid,s.st_gid,s.st_mode,s.st_size,s.st_mtime_ns,s.st_ctime_ns);need(key(a)==key(z)==key(p.lstat())and len(body)==a.st_size,'stable-shared-file-snapshot');return {'sha256':sha(body),'bytes':len(body),'uid':a.st_uid,'gid':a.st_gid,'mode':stat.S_IMODE(a.st_mode)}
 finally:os.close(fd)
def dirty_summary(raw):
 need(type(raw)is bytes and len(raw)<=1024**2 and(not raw or raw.endswith(b'\0')),'bounded-nul-dirty-path-inventory');names=raw.split(b'\0')[:-1]if raw else[];need(len(names)==len(set(names))<=10000 and all(names),'unique-dirty-path-inventory');known=sorted(n.decode('ascii')for n in names if n in{p.encode()for p in KNOWN_DIRTY});return {'trackedPathCount':len(names),'rawPathInventorySHA256':sha(raw),'knownPublicPaths':known,'unknownPathCount':len(names)-len(known)}
def safe_runtime(v):
 need(set(v)=={'id','image','running','health','restarts','pid','started','revision'}and pin(v['id'])and type(v['image'])is str and re.fullmatch('sha256:[a-f0-9]{64}',v['image'])and type(v['running'])is bool and v['health']in('healthy','unhealthy','starting','absent')and type(v['restarts'])is int and v['restarts']>=0 and type(v['pid'])is int and v['pid']>=0 and type(v['started'])is str and re.fullmatch(ISO,v['started'])and(v['revision']is None or pin(v['revision'],40)),'typed-minimal-public-runtime');return v
def safe_image(v):
 need(set(v)=={'id','revision','frontendAppTree','backendImage'}and type(v['id'])is str and re.fullmatch('sha256:[a-f0-9]{64}',v['id']),'typed-canonical-image-id');result={'id':v['id'],'publicLabels':{}}
 for name,width in(('revision',40),('frontendAppTree',40),('backendImage',64)):
  x=v[name];valid=pin(x,width)if width==40 else type(x)is str and re.fullmatch('sha256:[a-f0-9]{64}',x)is not None;result['publicLabels'][name]={'present':x is not None,'valid':valid,'value':x if valid else None}
 return result
def main():
 need(EXECUTE is True and sys.argv[1:]==['diagnose']and os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_MODE')=='diagnose'and os.environ.get('RELEASE_ATTEMPT')=='1'and pin(TARGET,40),'inert-first-readonly-preflight')
 os.umask(0o077);need(OUT.parent.is_dir()and not OUT.parent.is_symlink()and not OUT.exists()and not OUT.is_symlink(),'fresh-own-private-evidence-output');OUT.mkdir(mode=0o700);v={'phase':'diagnose','target':TARGET,'success':False,'readOnly':True,'envKeyringOrSqlRead':False,'lifecycleOrConfigWrites':False}
 try:
  head=git('rev-parse','HEAD').decode().strip();tree=git('rev-parse','HEAD^{tree}').decode().strip();need(pin(head,40)and pin(tree,40),'typed-observed-host-head-and-tree');v.update(hostGitHead=head,hostGitTree=tree,sharedFiles={})
  for name in SHARED:
   live=shared_file(name);committed=git('show',head+':'+name);v['sharedFiles'][name]={**live,'gitHeadSHA256':sha(committed),'matchesObservedGitHead':live['sha256']==sha(committed)}
  v['unstaged']=dirty_summary(git('diff','--name-only','-z'));v['staged']=dirty_summary(git('diff','--cached','--name-only','-z'));ids=command(['docker','ps','-aq','--no-trunc','--filter','label=com.docker.compose.project=rr-portal','--filter','label=com.docker.compose.service=indo-shipping'],4096).decode().split();need(len(ids)==1 and pin(ids[0]),'one-observed-indo-service-cid')
  v['runtime']=safe_runtime(json.loads(command(['docker','inspect','--format',RUNTIME_FORMAT,ids[0]],8192)));need(v['runtime']['id']==ids[0],'same-inspected-indo-cid');v['canonicalAlias']=safe_image(json.loads(command(['docker','image','inspect','--format',IMAGE_FORMAT,ALIAS],8192)));need(git('rev-parse','HEAD').decode().strip()==head,'host-head-stable-through-observation');v['allSharedFilesMatchObservedGitHead']=all(x['matchesObservedGitHead']for x in v['sharedFiles'].values());v['runtimeHealthy']=v['runtime']['running']and v['runtime']['health']=='healthy';v['success']=True
 except Exception as e:v.update(errorType=type(e).__name__,stage=STAGE)
 v['resultSHA256']=sha(enc(v));v['sha256Wire']={k:[int(c,16)for c in x]for k,x in v.items()if pin(x,40)or pin(x)};fd=os.open(OUT/'result.private.json',os.O_CREAT|os.O_EXCL|os.O_WRONLY|os.O_NOFOLLOW,0o600)
 with os.fdopen(fd,'wb')as f:f.write(enc(v));f.flush();os.fsync(f.fileno())
 print(json.dumps(v,sort_keys=True),flush=True);return 0 if v['success']else 1
if __name__=='__main__':sys.exit(main())
