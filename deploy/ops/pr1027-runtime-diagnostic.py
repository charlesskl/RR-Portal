"""Inert read-only runtime/alias diagnostic for the fixed failed Indo R2 prepare.
No environment/config bodies, SQL, log bodies, lifecycle or alias changes.
Only this diagnostic's new EXCL private evidence directory is written.
"""
import os,json,pathlib,re,stat,subprocess,sys,hashlib
EXECUTE=False
BRANCH='refs/heads/ops/pr-1027-clone-diagnostic-20261028'
ROOT=pathlib.Path('/opt/rr-portal')
PREPARE=ROOT/'deploy/backups/pr1027-1029-indo-20261028-r2/prepare'
OUT=ROOT/'deploy/backups/pr1027-r2-runtime-diagnostic-1'
TARGET='14f2dfcc6b9a189242fc4e56ed71864cd484ff3b'
MANIFEST_SHA256='3e19000e652ffb245cd999d1c5835918929891ba9ea2816c245d276ebc03057a'
RESULT_SHA256='910cbb1358cb46b299880e9a85d09babd42b7583deccae4d792da89ea7ae6030'
EXPECTED_BACKEND='sha256:ba2a99c9ff21311e22ede4f5ce46a49ffbcd298c77845681e3a9c881d6f157d2'
EXPECTED_DURABLE='sha256:7a1a2d6ce470ef66fcb83cc2c5216ffe6748915e0a48938c92540438c61a7a4d'
FORMAT='{"id":{{json .Id}},"image":{{json .Image}},"started":{{json .State.StartedAt}},"restarts":{{json .RestartCount}},"running":{{json .State.Running}},"health":{{if .State.Health}}{{json .State.Health.Status}}{{else}}null{{end}},"revision":{{json (index .Config.Labels "org.opencontainers.image.revision")}}}'
def need(value,label):
 if not value:raise RuntimeError(label)
def enc(value):return json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=True,allow_nan=False).encode()
def sha(value):return hashlib.sha256(value).hexdigest()
def raw(path):
 need(not any(p.is_symlink()for p in(path,*path.parents)),'regular-no-symlink-evidence')
 fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
 try:
  a=os.fstat(fd);need(stat.S_ISREG(a.st_mode)and a.st_size<=16*1024**2,'bounded-regular-evidence');chunks=[]
  while True:
   part=os.read(fd,1024**2)
   if not part:break
   chunks.append(part);need(sum(map(len,chunks))<=16*1024**2,'bounded-evidence')
  data=b''.join(chunks);z=os.fstat(fd);key=lambda s:(s.st_dev,s.st_ino,s.st_mode,s.st_uid,s.st_gid,s.st_size,s.st_mtime_ns,s.st_ctime_ns)
  need(key(a)==key(z)==key(path.lstat())and len(data)==a.st_size,'stable-evidence-read');return data
 finally:os.close(fd)
def command(args):
 p=subprocess.run(args,cwd=ROOT,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=20)
 need(len(p.stdout)+len(p.stderr)<=1024**2,'bounded-readonly-command-output');return p

def safe_runtime(value):
 need(type(value)is dict and set(value)=={'id','image','started','restarts','running','health','revision'},'only-fixed-runtime-fields')
 need(type(value['id'])is str and re.fullmatch('[a-f0-9]{64}',value['id'])and type(value['image'])is str and re.fullmatch('sha256:[a-f0-9]{64}',value['image']),'typed-runtime-identities')
 need(type(value['started'])is str and re.fullmatch('[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:[.][0-9]{1,9})?(?:Z|[+-][0-9]{2}:[0-9]{2})',value['started']),'typed-runtime-start-time')
 need(type(value['restarts'])is int and 0<=value['restarts']<=1000000000 and type(value['running'])is bool,'typed-runtime-state')
 if value['revision']=='':value=dict(value,revision=None)
 need(value['health']in(None,'healthy','unhealthy','starting')and(value['revision']is None or type(value['revision'])is str and re.fullmatch('[a-f0-9]{40}',value['revision'])),'typed-health-and-public-revision')
 return dict(value,health=value['health']or'absent')

def snapshot_service(records):
 need(type(records)is dict,'saved-runtime-map');selected=[]
 for cid,v in records.items():
  labels=v.get('config',{}).get('Labels')or{}
  if labels.get('com.docker.compose.project')=='rr-portal'and labels.get('com.docker.compose.service')=='indo-shipping':
   selected.append(safe_runtime({'id':cid,'image':v['image'],'started':v['started'],'restarts':v['restarts'],'running':v['running'],'health':v['health'],'revision':labels.get('org.opencontainers.image.revision')}))
 need(len(selected)==1,'one-saved-formal-indo');return selected[0]

def image_identity(reference):
 p=command(['docker','image','inspect','--format','{{.Id}}',reference]);value=p.stdout.decode().strip()
 if p.returncode!=0:return {'present':False}
 need(re.fullmatch('sha256:[a-f0-9]{64}',value)is not None,'typed-image-id-only');return {'present':True,'id':value}

def main():
 need(EXECUTE is True and sys.argv[1:]==['diagnose']and os.environ.get('RELEASE_MODE')=='diagnose'and os.environ.get('RELEASE_ATTEMPT')=='1'and os.environ.get('RELEASE_BRANCH')==BRANCH,'inert-first-diagnostic')
 os.umask(0o077);need(OUT.parent.is_dir()and not OUT.parent.is_symlink()and not OUT.exists()and not OUT.is_symlink(),'fresh-own-private-diagnostic');OUT.mkdir(mode=0o700)
 result={'phase':'diagnose','target':TARGET,'success':False,'readOnly':True,'atomicAcrossObservations':False}
 try:
  body=raw(PREPARE/'manifest.json');failure=raw(PREPARE/'result.private.json');need(sha(body)==MANIFEST_SHA256 and sha(failure)==RESULT_SHA256,'fixed-r2-failure-byte-seals')
  manifest=json.loads(body);failed=json.loads(failure);need(failed.get('success')is False and failed.get('phase')=='prepare'and failed.get('target')==TARGET and failed.get('stage')=='fresh-last-accepted-backend-and-durable-alias','exact-runtime-baseline-failure')
  for label,name in(('beforeCleanup','r1-current-before-cleanup.private.json'),('afterCleanup','r1-current-after-cleanup.private.json')):
   body=raw(PREPARE/name);need(name in manifest and sha(body)==manifest[name],'selected-saved-runtime-byte-seal');result[label]=snapshot_service(json.loads(body))
  ids=command(['docker','ps','-aq','--no-trunc','--filter','label=com.docker.compose.project=rr-portal','--filter','label=com.docker.compose.service=indo-shipping'])
  values=ids.stdout.decode().split();need(ids.returncode==0 and len(values)==1 and re.fullmatch('[a-f0-9]{64}',values[0]),'one-current-formal-indo')
  p=command(['docker','inspect','--format',FORMAT,values[0]]);need(p.returncode==0,'safe-current-runtime-format-success');result['current']=safe_runtime(json.loads(p.stdout))
  result['canonicalAlias']=image_identity('rr-portal-indo-shipping:latest');result['expectedBackend']=image_identity(EXPECTED_BACKEND);result['expectedDurable']=image_identity(EXPECTED_DURABLE)
  result['cloneCounts']={}
  for name,label in(('oldR1','io.rr-portal.pr1027-clone'),('newR2','io.rr-portal.pr1027-r2-clone')):
   p=command(['docker','ps','-aq','--no-trunc','--filter','label='+label]);ids=p.stdout.decode().split();need(p.returncode==0 and all(re.fullmatch('[a-f0-9]{64}',x)for x in ids),'typed-clone-count-only');result['cloneCounts'][name]=len(ids)
  result['success']=True
 except Exception as e:result['errorType']=type(e).__name__
 result['resultSHA256']=sha(enc(result));result['sha256Wire']={'target':[int(c,16)for c in TARGET]}
 fd=os.open(OUT/'result.private.json',os.O_CREAT|os.O_EXCL|os.O_WRONLY|os.O_NOFOLLOW,0o600)
 with os.fdopen(fd,'wb')as f:f.write(enc(result));f.flush();os.fsync(f.fileno())
 print(json.dumps(result,sort_keys=True),flush=True);return 0 if result['success']else 1
if __name__=='__main__':sys.exit(main())
