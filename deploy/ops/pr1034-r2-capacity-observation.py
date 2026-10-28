"""Inert selected failed prepare capacity evidence; no secret or lifecycle access."""
import pathlib,json,hashlib,os,subprocess,sys
EXECUTE=True
TARGET='f22fbffa1789234fe1c78bf776f4dcb3fe867d0c'
BASE=pathlib.Path('/opt/rr-portal/deploy/backups/pr1034-indo-static-20261028-r2/prepare')
OUT=pathlib.Path('/opt/rr-portal/deploy/backups/pr1034-r2-capacity-observation-1')
def enc(v):return json.dumps(v,sort_keys=True,separators=(',',':'),ensure_ascii=True,allow_nan=False).encode()
def sha(v):return hashlib.sha256(v).hexdigest()
def need(v):
 if not v:raise RuntimeError('capacity-evidence-precondition')
def main():
 need(EXECUTE is True and sys.argv[1:]==['diagnose']and os.environ.get('RELEASE_BRANCH')=='refs/heads/ops/pr-1034-20261028-indo-static'and os.environ.get('RELEASE_MODE')=='diagnose'and os.environ.get('RELEASE_ATTEMPT')=='1');os.umask(0o077);need(OUT.parent.is_dir()and not OUT.exists()and not OUT.is_symlink());OUT.mkdir(mode=0o700);v={'phase':'diagnose','target':TARGET,'success':False,'readOnly':True}
 try:
  b=(BASE/'manifest.json').read_bytes();need(sha(b)=='2e29909df4802c055e151c1bebacf2b91b44a08111ef670010fa50e1bf2efaf5');mf=json.loads(b);v['spaceChecks']={}
  for name in('docker-space-before.private.json','docker-space-after.private.json'):
   p=BASE/name
   if p.exists():
    need(p.is_file()and not p.is_symlink()and p.stat().st_size<8192);b=p.read_bytes();need(sha(b)==mf[name]);x=json.loads(b);v['spaceChecks'][name]={k:x[k]for k in('available','free','minimumOrdinaryAvailable','minimumPhysicalFree')}
  s=os.statvfs('/var/lib/docker');v['currentSpace']={'available':s.f_bavail*s.f_frsize,'free':s.f_bfree*s.f_frsize};v['ownDirectoryBytes']={}
  for name in('source','old-wwwroot','prepared-wwwroot','image-context','base-image-wwwroot','image-verified-wwwroot'):
   p=BASE/name
   if p.is_dir():
    files=[x for x in p.rglob('*')if x.is_file()];need(len(files)<100000 and all(not x.is_symlink()for x in files));v['ownDirectoryBytes'][name]={'bytes':sum(x.stat().st_size for x in files),'files':len(files)}
  v['privateCommandOutputBytes']=sum(x.stat().st_size for x in BASE.iterdir()if x.is_file()and x.name.endswith(('.stdout.private','.stderr.private')));v['images']={}
  fmt='{"id":{{json .Id}},"bytes":{{json .Size}}}'
  for repo in('rrportal-indo-pr1034-frontend','rrportal-indo-pr1034'):
   p=subprocess.run(['docker','image','inspect','--format',fmt,repo+':'+TARGET],stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=30);v['images'][repo]=json.loads(p.stdout)if p.returncode==0 else{'present':False}
  v['success']=True
 except Exception as e:v['errorType']=type(e).__name__
 v['resultSHA256']=sha(enc(v));v['sha256Wire']={'target':[int(c,16)for c in TARGET]};raw=enc(v);fd=os.open(OUT/'result.private.json',os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600)
 with os.fdopen(fd,'wb')as f:f.write(raw)
 print(json.dumps(v,sort_keys=True),flush=True);return 0 if v['success']else 1
if __name__=='__main__':sys.exit(main())
