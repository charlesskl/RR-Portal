"""Read only the sealed synthetic probe's four safe status fields."""
import pathlib,json,hashlib,re,os,sys
PIN=True
assert PIN and sys.argv[1:]==['verify']and os.environ.get('RELEASE_BRANCH')=='refs/heads/ops/pr-981-20261021'and os.environ.get('RELEASE_ATTEMPT')=='1'
r=pathlib.Path('/opt/rr-portal/deploy/backups/pr-981-20261021-prepare-04');m=r/'manifest.json';assert hashlib.sha256(m.read_bytes()).hexdigest()=='581830840a6cdbd70dad977d202c2fafd28103d7e564e89507e20f04d066d2f3';manifest=json.loads(m.read_bytes());p=r/'single-synthetic-provider-result.private.json';assert p.is_file()and not p.is_symlink()and p.stat().st_size<2048 and hashlib.sha256(p.read_bytes()).hexdigest()==manifest[p.name];v=json.loads(p.read_bytes());assert set(v)=={'success','status','model','elapsedMs'}and type(v['success'])is bool and re.fullmatch('[a-z0-9_]{1,100}',v['status'])and v['model']=='qwen3.8-max'and type(v['elapsedMs'])is int
print(json.dumps({'mode':'verify','success':True,'syntheticProbeResult':v,'businessWritesPerformed':False,'providerCallsPerformedByReader':False}),flush=True)
