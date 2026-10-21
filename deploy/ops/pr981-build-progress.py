"""Read-only, bounded build progress; no signals, configuration changes or credentials."""
import pathlib,json,re,os,sys,shutil
PIN=False
assert PIN and sys.argv[1:]==['verify']and os.environ.get('RELEASE_BRANCH')=='refs/heads/ops/pr-981-20261021'and os.environ.get('RELEASE_ATTEMPT')=='1'
root=pathlib.Path('/opt/rr-portal/deploy/backups/pr-981-20261021-prepare-02');logs=sorted(root.glob('*-build-factory-*.private.log'));assert 0<len(logs)<=2
out=[]
for p in logs:
 assert p.is_file()and not p.is_symlink()and p.stat().st_size<32*1024**2
 with p.open('rb')as f:f.seek(max(0,p.stat().st_size-12000));lines=f.read(12000).decode(errors='replace').splitlines()[-16:]
 safe=[]
 for line in lines:
  if re.search(r'API_KEY|AUTHORIZATION|PASSWORD|TOKEN|SECRET',line,re.I):continue
  line=re.sub(r'https?://\S+','<url>',line);line=re.sub(r'[A-Za-z0-9_+/=.:-]{24,}','<redacted-long-token>',line);line=re.sub(r'[^\x20-\x7e\u4e00-\u9fff]','?',line);safe.append(line[:400])
 out.append({'service':'factory-review-test'if 'factory-review-test'in p.name else'factory-review','logBytes':p.stat().st_size,'tail':safe})
print(json.dumps({'mode':'verify','success':True,'readOnlyBuildProgress':out,'freeDiskGiB':round(shutil.disk_usage(root).free/1024**3,1),'loadAverage':pathlib.Path('/proc/loadavg').read_text().split()[:3],'productionChangesPerformed':False}),flush=True)
