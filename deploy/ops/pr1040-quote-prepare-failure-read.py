"""Read only sealed failed prepare logs; no lifecycle, config or business writes."""
import hashlib,json,os,pathlib,re,subprocess,sys
ROOT=pathlib.Path('/opt/rr-portal');ARCHIVE=ROOT/'deploy/backups/pr1040-quote-20261030/prepare';MANIFEST='0615d54677a4f5bcb107a3fcdc24c8e2b7b9c54f66b5568176b1989cfe6b8fa1';BRANCH='refs/heads/ops/pr-1040-20261030-quote';EXECUTE=True
enc=lambda v:json.dumps(v,sort_keys=True,separators=(',',':'),ensure_ascii=True,allow_nan=False).encode()
sha=lambda b:hashlib.sha256(b).hexdigest()
def file_hash(p):
 h=hashlib.sha256()
 with p.open('rb')as f:
  for b in iter(lambda:f.read(1024**2),b''):h.update(b)
 return h.hexdigest()
def safe_error(s):
 s=re.sub(r'([a-z]+://)[^\s/@]+:[^\s/@]+@',r'\1[redacted]@',s,flags=re.I)
 s=re.sub(r'(?i)((?:password|passwd|authcode|authorization|token|secret|api[_-]?key)\s*[:=]\s*)[^\s,;]+',r'\1[redacted]',s)
 return s[-4096:]
def wire(v):
 raw=enc(v);assert len(raw)<4*1024**2;nib=lambda x:[int(c,16)for c in(format(x,'x')if type(x)is int else x)];parts=[raw[i:i+1024]for i in range(0,len(raw),1024)];h=nib(sha(raw))
 for i,b in enumerate(parts):print(enc([0,nib(i+1),nib(len(parts)),nib(len(raw)),h,nib(b.hex())]).decode(),flush=True)
 print(enc([1,nib(len(parts)),nib(len(raw)),h]).decode(),flush=True)
def main():
 assert EXECUTE and sys.argv[1:]==['diagnose'] and os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_ATTEMPT')=='1' and os.environ.get('RELEASE_MODE')=='diagnose'
 assert not any(p.is_symlink()for p in(ARCHIVE,*ARCHIVE.parents))and file_hash(ARCHIVE/'manifest.json')==MANIFEST
 m=json.loads((ARCHIVE/'manifest.json').read_bytes());actual={str(p.relative_to(ARCHIVE))for p in ARCHIVE.rglob('*')if p.is_file()and p.name!='manifest.json'};assert actual==set(m)and all(not p.is_symlink()for p in ARCHIVE.rglob('*'))
 assert all(not pathlib.PurePosixPath(n).is_absolute()and'..'not in pathlib.PurePosixPath(n).parts and file_hash(ARCHIVE/n)==h for n,h in m.items())
 rows=[{'name':n,'bytes':(ARCHIVE/n).stat().st_size,'sha256':h}for n,h in sorted(m.items())];logs=sorted(p for p in ARCHIVE.glob('*-stderr.private'));last=logs[-1]if logs else None
 v={'service':'internal-quote','mode':'diagnose','success':True,'readOnly':True,'lifecycleOrConfigOrBusinessWrites':False,'failedPrepareManifestSHA256':MANIFEST,'evidenceFiles':rows,'lastStderr':None if last is None else{'name':last.name,'sha256':file_hash(last),'text':safe_error(last.read_text(errors='replace'))}}
 out=ARCHIVE/last.name.replace('stderr','stdout')if last else None
 if out and out.is_file():
  lines=out.read_text(errors='replace').splitlines();v['lastStdoutSelected']=safe_error('\n'.join(line for line in lines if re.search(r'(^not ok|^# (tests|pass|fail|skipped)|error:|Error:|ERR!|failed|ERROR|fatal:)',line)))
 tag='rr-portal-internal-quote:pr1040-49c0f09167f4';image=json.loads(subprocess.check_output(['docker','image','inspect',tag],timeout=30))[0];assert re.fullmatch(r'sha256:[a-f0-9]{64}',image['Id']) and image['Config']['Labels']['org.opencontainers.image.revision']=='49c0f09167f4eedcc766d828ced36d29f94544be' and image['Config']['Labels']['io.rr-portal.quote-app-tree']=='cd895f5fe3dbbb33037f5e0c9a7ee60db2a53f1d'
 probe="const fs=require('fs'),cp=require('child_process');const d=fs.mkdtempSync('/tmp/pr1040-native-start-');const r=cp.spawnSync(process.execPath,['backend/server.js'],{cwd:'/app',env:{...process.env,NODE_ENV:'test',DB_DRIVER:'sqlite',DB_FILE:d+'/test.db',DATABASE_URL:'',TEST_DATABASE_URL:'',SESSION_SECRET:'isolated-fixture-only',ADMIN_INITIAL_PASSWORD:'isolated-fixture-only',HOST:'127.0.0.1',PORT:'39104'},encoding:'utf8',timeout:5000,maxBuffer:16384});console.log(JSON.stringify({status:r.status,error:r.error?.code||null,stderr:r.stderr||''}));fs.rmSync(d,{recursive:true,force:true});"
 observed=subprocess.run(['docker','run','--rm','--network','none','--read-only','--restart','no','--log-driver','none','--tmpfs','/tmp:rw,nosuid,nodev,size=128m','--entrypoint','node',image['Id'],'-e',probe],capture_output=True,timeout=30,check=True);assert len(observed.stdout)<32768
 x=json.loads(observed.stdout);x['stderr']=safe_error(x['stderr']);v['isolatedCandidateStartProbe']={'candidate':image['Id'],'network':'none','rootReadOnly':True,'productionMountsOrCredentials':False,'result':x}
 v['resultSHA256']=sha(enc(v));wire(v)
if __name__=='__main__':main()
