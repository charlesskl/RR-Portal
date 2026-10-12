import datetime,json,os,pathlib,subprocess,sys,hashlib,stat
os.umask(0o077)
mode,script=sys.argv[1:]
root=pathlib.Path('/opt/rr-portal/deploy/backups')
root.mkdir(parents=True,exist_ok=True)
cmd=['docker','exec','-i','-e','PRINTLINK_OPS_MODE='+mode]
if mode=='verify':
 dirs=sorted(root.glob('printlink-pre-909-*'))
 if not dirs: raise RuntimeError('No pre-909 backup')
 baseline=(dirs[-1]/'pre909-audit.json').read_text()
 cmd+=['-e','PRINTLINK_OPS_BASELINE='+baseline]
cmd+=['rr-portal-printlink-1','node','--input-type=module']
r=subprocess.run(cmd,input=pathlib.Path(script).read_text(),text=True,capture_output=True,check=True)
result=json.loads(r.stdout)
if mode=='backup':
 target=result['target']
 if not target.startswith('/app/runtime/.pre909-'): raise RuntimeError('Invalid backup path')
 dest=root/('printlink-pre-909-'+datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ'))
 dest.mkdir(mode=0o700)
 subprocess.run(['docker','cp','rr-portal-printlink-1:'+target+'/.',str(dest)],check=True)
 for p in dest.rglob('*'):
  if p.is_symlink(): raise RuntimeError('Unexpected symlink in backup')
  p.chmod(0o700 if p.is_dir() else 0o600)
 checks={str(p.relative_to(dest)):hashlib.sha256(p.read_bytes()).hexdigest() for p in dest.rglob('*') if p.is_file()}
 (dest/'sha256-manifest.json').write_text(json.dumps(checks))
 subprocess.run(['docker','exec','rr-portal-printlink-1','node','-e',"require('fs').rmSync(process.argv[1],{recursive:true,force:true})",target],check=True)
 result['target']=str(dest)
 result['backupFiles']=len(checks)
 result['manifestSha256']=hashlib.sha256((dest/'sha256-manifest.json').read_bytes()).hexdigest()
elif mode=='verify': result['backup']=str(dirs[-1])
print(json.dumps(result,ensure_ascii=False))
