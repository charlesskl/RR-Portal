"""Read only the sealed PR981 failed build log; emit bounded redacted diagnostics."""
import pathlib,json,re,hashlib,os,sys
PIN=True
ROOT=pathlib.Path('/opt/rr-portal/deploy/backups/pr-981-20261021-prepare')
assert PIN and sys.argv[1:]==['verify'] and os.environ.get('RELEASE_BRANCH')=='refs/heads/ops/pr-981-20261021' and os.environ.get('RELEASE_ATTEMPT')=='1'
assert hashlib.sha256((ROOT/'manifest.json').read_bytes()).hexdigest()=='bec3677d1ee0ac76055b813825d776fba00f75a7c33fd567e07df4528a48878c'
m=json.loads((ROOT/'manifest.json').read_bytes());logs=[p for p in ROOT.glob('*-build-candidates.private.log')];assert len(logs)==1
p=logs[0];assert not p.is_symlink()and hashlib.sha256(p.read_bytes()).hexdigest()==m[p.name]and p.stat().st_size<20*1024**2
rows=[]
for line in p.read_text(errors='replace').splitlines():
 if not re.search(r'error|failed|not found|cannot|invalid|denied|unsupported|context canceled|unknown|unexpected|name must',line,re.I):continue
 if re.search(r'API_KEY|AUTHORIZATION|PASSWORD|TOKEN|SECRET',line,re.I):continue
 line=re.sub(r'https?://\S+','<url>',line);line=re.sub(r'[A-Za-z0-9_+/=.:-]{24,}','<redacted-long-token>',line);line=re.sub(r'[^\x20-\x7e\u4e00-\u9fff]','?',line)
 rows.append(line[:600])
assert len(rows)<=40
print(json.dumps({'mode':'verify','success':True,'readOnlyBuildDiagnostics':rows,'productionChangesPerformed':False,'rowsPrinted':False}),flush=True)
