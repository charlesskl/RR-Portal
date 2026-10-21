"""Read only one sealed failed backup; emit frame locations and allowlisted stage markers."""
import hashlib,json,os,pathlib,re,stat,sys
PIN=True
BASE='97d563e93aca3d9e3c0bc512dd622d6a3002e710'
BRANCH='refs/heads/ops/batch-983-984-987-20261021'
ARCHIVE=pathlib.Path('/opt/rr-portal/deploy/backups/batch-983-984-987-20261021-backup')
MANIFEST='59a37eeb179739adedb72ac5f61ec82af7ef120a27df4b33dd99613ebee91092'
RESULT='c9e8283ac106a004f1fdb673d48a7e3372427c5e5b8e64bc6038c0dd9ef89996'
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def need(v):
 if not v:raise RuntimeError('READONLY_DIAG_REJECTED')
def main():
 need(PIN is True and sys.argv[1:]==['diagnose']and os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_ATTEMPT')=='1')
 need(ARCHIVE.is_dir()and not ARCHIVE.is_symlink()and stat.S_IMODE(ARCHIVE.stat().st_mode)==0o700)
 need(sha(ARCHIVE/'manifest.json')==MANIFEST and sha(ARCHIVE/'first-result.json')==RESULT)
 manifest=json.loads((ARCHIVE/'manifest.json').read_bytes());need(type(manifest)is dict)
 for n,h in manifest.items():
  p=pathlib.PurePosixPath(n);need(not p.is_absolute()and '..'not in p.parts and str(p)==n);f=ARCHIVE/n;need(f.is_file()and not f.is_symlink()and stat.S_IMODE(f.stat().st_mode)&0o077==0 and sha(f)==h)
 result=json.loads((ARCHIVE/'first-result.json').read_bytes());need(result.get('success')is False and result.get('base')==BASE)
 trace=ARCHIVE/'failure.private.txt';need(trace.stat().st_size<=1024**2);text=trace.read_text();frames=[]
 for name,line,fn in re.findall(r'File "([^"]+)", line (\d+), in ([A-Za-z_][A-Za-z0-9_]*)',text):
  name=pathlib.PurePosixPath(name).name;need(re.fullmatch('[A-Za-z0-9_.-]+',name)is not None);frames.append({'file':name,'line':int(line),'function':fn})
 need(frames);exception=text.splitlines()[-1].split(':',1)[0];need(exception in{'RuntimeError','ValueError','KeyError','TypeError','FileNotFoundError','PermissionError'})
 print(json.dumps({'mode':'diagnose','success':True,'archiveSealsVerified':True,'base':BASE,'frames':frames,'exceptionType':exception,'knownEvidencePresence':{n:(n in manifest)for n in['environment.private','target-inspect.private.json','compose-render.private.json','baseline.private.json']},'archiveFileCount':len(manifest),'businessWrites':False,'containerSignals':False,'configurationModified':False}),flush=True)
if __name__=='__main__':main()
