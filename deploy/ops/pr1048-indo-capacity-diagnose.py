"""INERT bounded read-only collection of the failed Indo preparation capacity."""
import hashlib,json,os,pathlib,stat,subprocess,sys
ROOT=pathlib.Path('/opt/rr-portal');FAILED=ROOT/'deploy/backups/pr1048-indo-static-1-20261031/prepare';OUT=ROOT/'deploy/backups/pr1048-indo-capacity-diagnose-1'
FAILED_SEAL='27d03a6145d34c84a7c1f76c4b14ac3882fa92daa7f4ec27e27cb3621e3ca54f'
TARGET='38a35585770e0e837229d50f20ee4a9a759037ad';BRANCH='refs/heads/codex/ops-pr-1046-1049-20261031';EXECUTE=True;STAGE='entry'
def need(v,label):
 global STAGE
 STAGE=label
 if not v:raise RuntimeError(label)
def enc(v):return json.dumps(v,sort_keys=True,separators=(',',':'),ensure_ascii=True,allow_nan=False).encode()
def sha(v):return hashlib.sha256(v).hexdigest()
def read(p,limit=1024**2):
 need(p.is_file()and not p.is_symlink()and p.stat().st_size<=limit,'bounded-regular-selected-file');return p.read_bytes()
def cmd(a):
 p=subprocess.run(a,cwd=ROOT,capture_output=True,timeout=45);need(len(p.stdout)<=16*1024**2 and len(p.stderr)<=1024**2,'bounded-readonly-command')
 return p
def metadata(name,manifest):
 p=FAILED/name
 if not p.exists():return {'exists':False,'listedInFailedManifest':name in manifest}
 need(p.is_file()and not p.is_symlink(),'regular-selected-metadata');s=p.stat();return {'exists':True,'bytes':s.st_size,'mode':stat.S_IMODE(s.st_mode),'sealedSHA256':manifest.get(name),'listedInFailedManifest':name in manifest}
def image(name):
 p=cmd(['docker','image','inspect',name])
 if p.returncode:
  need(b'No such image:'in p.stderr or b'No such object:'in p.stderr,'only-known-image-absence');return {'exists':False}
 rows=json.loads(p.stdout);need(len(rows)==1,'one-known-requested-image');r=rows[0]
 return {'exists':True,'id':r['Id'],'size':r.get('Size'),'rootfsSHA256':sha(enc(r['RootFS'])),'configSHA256':sha(enc(r['Config'])),'envSHA256':sha(enc(sorted(r['Config'].get('Env')or[])))}
def wire(v):
 raw=enc(v);need(len(raw)<=1024**2,'bounded-safe-result');nib=lambda x:[int(c,16)for c in(format(x,'x')if type(x)is int else x)];parts=[raw[i:i+1024]for i in range(0,len(raw),1024)];digest=nib(sha(raw))
 for i,b in enumerate(parts):print(enc([0,nib(i+1),nib(len(parts)),nib(len(raw)),digest,nib(b.hex())]).decode(),flush=True)
 print(enc([1,nib(len(parts)),nib(len(raw)),digest]).decode(),flush=True)
def main():
 need(EXECUTE is True and sys.argv[1:]==['diagnose']and os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_MODE')=='diagnose'and os.environ.get('RELEASE_ATTEMPT')=='1','explicit-first-inert-readonly-diagnosis')
 os.umask(0o077);need(OUT.parent.is_dir()and not any(p.is_symlink()for p in(OUT.parent,*OUT.parent.parents))and not OUT.exists(),'fresh-own-diagnostic-directory');OUT.mkdir(mode=0o700)
 v={'success':False,'phase':'diagnose','mode':'diagnose','target':TARGET,'readOnly':True,'businessWrites':False,'lifecycleWrites':False,'configurationWrites':False,'cleanupOrRetryPerformed':False,'failedPrepareKeptFailed':True}
 try:
  manifestBody=read(FAILED/'manifest.json',8*1024**2);need(sha(manifestBody)==FAILED_SEAL,'exact-failed-manifest-seal');manifest=json.loads(manifestBody);need(type(manifest)is dict and len(manifest)<100000,'bounded-failed-manifest-metadata')
  failed=json.loads(read(FAILED/'result.private.json'));inner=dict(failed);inner.pop('resultSHA256',None);need(failed.get('resultSHA256')==sha(enc(inner))and failed.get('success')is False and failed.get('phase')=='prepare'and failed.get('target')==TARGET and failed.get('manifestSHA256')==FAILED_SEAL,'exact-failed-source-bound-result')
  v['failure']={k:failed.get(k)for k in('success','phase','target','stage','errorType','manifestSHA256','resultSHA256')};v['capacity']={}
  for name in('docker-space-before.private.json','docker-space-after.private.json'):
   body=read(FAILED/name);need(manifest.get(name)==sha(body),'selected-capacity-bytes-still-sealed');data=json.loads(body)
   need(type(data)is dict and all(type(x)is int and x>=0 for k,x in data.items()if k not in('policy','budgetBytes'))and type(data.get('budgetBytes'))is dict and all(type(x)is int and x>=0 for x in data['budgetBytes'].values()),'capacity-only-numeric-and-fixed-policy-json');need(data.get('policy')=='explicit-bounded-static-release-growth-always-preserving-one-gib-and-eight-gib-no-cleanup-or-retry','known-safe-capacity-policy');v['capacity'][name]=data
  v['selectedMetadata']={n:metadata(n,manifest)for n in('prepared.private.json','frontend-raw-dist.private.json','image-context/Dockerfile')}
  v['sealedPublicPathCounts']={prefix:sum(name.startswith(prefix)for name in manifest)for prefix in('old-wwwroot/','prepared-wwwroot/','image-context/wwwroot/')}
  v['knownImages']={name:image(name)for name in('rrportal-indo-pr1048-frontend:'+TARGET,'rrportal-indo-pr1048:'+TARGET,'rr-portal-indo-shipping:latest')}
  p=cmd(['docker','info','--format','{{json .DockerRootDir}}']);need(p.returncode==0,'readonly-docker-root');root=json.loads(p.stdout);need(type(root)is str and pathlib.Path(root).is_absolute(),'absolute-docker-root');fs=os.statvfs(root);v['currentSpace']={'available':fs.f_bavail*fs.f_frsize,'free':fs.f_bfree*fs.f_frsize}
  need(sha(read(FAILED/'manifest.json',8*1024**2))==FAILED_SEAL,'failed-evidence-unmodified');v['success']=True
 except Exception as e:v.update(errorType=type(e).__name__,stage=STAGE)
 v['resultSHA256']=sha(enc(v));fd=os.open(OUT/'result.private.json',os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
 with os.fdopen(fd,'wb')as f:f.write(enc(v));f.flush();os.fsync(f.fileno())
 wire(v);return 0 if v['success']else 1
if __name__=='__main__':sys.exit(main())
