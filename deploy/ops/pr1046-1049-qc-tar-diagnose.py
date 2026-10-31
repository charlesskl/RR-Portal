"""Inert: read two sealed public-source tar headers; no Docker/service/DB calls."""
import hashlib,io,json,os,pathlib,re,stat,sys,tarfile
ROOT=pathlib.Path('/opt/rr-portal');OUT=ROOT/'deploy/backups/pr1046-1049-qc-tar-diagnose-1'
FAILED=ROOT/'deploy/backups/pr1046-1049-qc-20261031-2/prepare'
MANIFEST_SHA256='d5817fb052c9d0a4417bf0fcac0eaec8f90cfec8155c0f0005a629d6b3b4de87'
CODE={'ai-ocr.js','app.js','qc-backend.js','report_export.js','server/server.js'}
EXECUTE=False;BRANCH='refs/heads/codex/ops-pr-1046-1049-20261031';STAGE='entry'
def need(v,label):
 global STAGE
 STAGE=label
 if not v:raise RuntimeError(label)
def enc(v):return json.dumps(v,sort_keys=True,separators=(',',':'),ensure_ascii=True,allow_nan=False).encode()
def sha(b):return hashlib.sha256(b).hexdigest()
def read(path,maximum):
 need(not any(p.is_symlink()for p in(path,*path.parents)),'fixed-real-readonly-path');s=path.lstat();need(stat.S_ISREG(s.st_mode)and 0<=s.st_size<=maximum,'bounded-regular-readonly-input');body=path.read_bytes();z=path.lstat();need((s.st_dev,s.st_ino,s.st_size,s.st_mtime_ns,s.st_ctime_ns)==(z.st_dev,z.st_ino,z.st_size,z.st_mtime_ns,z.st_ctime_ns)and len(body)==s.st_size,'read-only-input-stable');return body
def tar_metadata(body,expected_count):
 with tarfile.open(fileobj=io.BytesIO(body),mode='r:')as archive:
  members=archive.getmembers();need(len(members)==expected_count,'exact-public-code-tar-entry-count');result={}
  for m in members:
   name=m.name.removeprefix('./');need(m.isfile()and not m.issym()and not m.islnk()and name in CODE and name not in result and 0<=m.size<=4*1024**2,'only-fixed-regular-public-code-members');data=archive.extractfile(m).read(4*1024**2+1);need(len(data)==m.size,'complete-public-source-hash-only');result[name]={'bytes':m.size,'sha256':sha(data),'uid':m.uid,'gid':m.gid,'mode':m.mode,'mtime':m.mtime}
  return result
def private(name,value):
 fd=os.open(OUT/name,os.O_CREAT|os.O_EXCL|os.O_WRONLY|os.O_NOFOLLOW,0o600)
 with os.fdopen(fd,'wb')as f:f.write(enc(value));f.flush();os.fsync(f.fileno())
def wire(value):
 raw=enc(value);need(len(raw)<1024**2,'bounded-hash-and-header-only-receipt');parts=[raw[i:i+1024]for i in range(0,len(raw),1024)];nib=lambda v:[int(x,16)for x in(format(v,'x')if type(v)is int else v)];digest=nib(sha(raw))
 for i,b in enumerate(parts):print(enc([0,nib(i+1),nib(len(parts)),nib(len(raw)),digest,nib(b.hex())]).decode(),flush=True)
 print(enc([1,nib(len(parts)),nib(len(raw)),digest]).decode(),flush=True)
def main():
 global STAGE
 need(EXECUTE is True and sys.argv[1:]==['diagnose']and os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_MODE')=='diagnose'and os.environ.get('RELEASE_ATTEMPT')=='1','explicit-first-readonly-tar-diagnostic');os.umask(0o077);need(OUT.parent.is_dir()and not any(p.is_symlink()for p in(OUT.parent,*OUT.parent.parents))and not OUT.exists(),'new-private-readonly-evidence');OUT.mkdir(mode=0o700);v={'phase':'diagnose','mode':'diagnose','success':False,'readOnly':True,'serviceOrDbOrSourceChanges':False,'rawSourceBodiesReturned':False,'originalFailedPhaseEditedOrRetried':False}
 try:
  manifest=read(FAILED/'manifest.json',4*1024**2);need(sha(manifest)==MANIFEST_SHA256,'sealed-r2-manifest-exact');mf=json.loads(manifest);bodies={n:read(FAILED/n,8*1024**2)for n in('patch.tar','070-stdout.private')};need(all(sha(body)==mf[n]for n,body in bodies.items()),'both-selected-tar-streams-match-failed-manifest');expected=tar_metadata(bodies['patch.tar'],5);actual=tar_metadata(bodies['070-stdout.private'],1);need(set(actual)=={'ai-ocr.js'}and set(expected)==CODE,'exact-failed-first-code-readback-and-reviewed-five-code-patch');v['details']={'expectedPatchMetadata':expected,'actualFirstReadbackMetadata':actual,'differences':{n:[k for k in actual[n]if actual[n][k]!=expected[n][k]]for n in actual},'manifestSHA256':MANIFEST_SHA256};need(read(FAILED/'manifest.json',4*1024**2)==manifest and all(sha(read(FAILED/n,8*1024**2))==mf[n]for n in bodies),'failed-phase-selected-evidence-unchanged');v['success']=True
 except Exception as e:v.update(errorType=type(e).__name__,stage=STAGE)
 v['resultSHA256']=sha(enc(v));private('result.private.json',v);mf={p.name:sha(p.read_bytes())for p in OUT.iterdir()if p.is_file()};private('manifest.json',mf);wire({'result':v,'manifestSHA256':sha(enc(mf))});return 0 if v['success']else 1
if __name__=='__main__':sys.exit(main())
