"""Signal only the exact PR981 prepare02 helper; never signal a business container."""
import pathlib,os,re,hashlib,signal,time,json,sys
PIN=True
assert PIN and sys.argv[1:]==['verify']and os.environ.get('RELEASE_BRANCH')=='refs/heads/ops/pr-981-20261021'and os.environ.get('RELEASE_ATTEMPT')=='1'
found=[]
for p in pathlib.Path('/proc').iterdir():
 if not p.name.isdigit():continue
 try:
  args=p.joinpath('cmdline').read_bytes().rstrip(b'\0').split(b'\0')
  if len(args)!=4 or pathlib.PurePosixPath(args[0].decode()).name!='python3'or args[1]!=b'-B'or args[3]!=b'prepare':continue
  script=pathlib.Path(args[2].decode())
  if not re.fullmatch(r'/tmp/pr981-backup\.[A-Za-z0-9]+/run.py',str(script)):continue
  if not script.is_file()or script.is_symlink()or hashlib.sha256(script.read_bytes()).hexdigest()!='ff16637c403afcd62882525b3423be775ed54a69f68ce7c412879ab20884d4b3':continue
  env=dict(v.split(b'=',1)for v in p.joinpath('environ').read_bytes().split(b'\0')if b'='in v)
  if env.get(b'RELEASE_SHA')!=b'9c00ebb47f159697c6b1cbe2bb5a2cf8605345e9'or env.get(b'RELEASE_BRANCH')!=b'refs/heads/ops/pr-981-20261021':continue
  assert p.stat().st_uid==os.geteuid();found.append((int(p.name),p.joinpath('stat').read_text().split()[21]))
 except(FileNotFoundError,ProcessLookupError,PermissionError):continue
assert len(found)<=1
if found:
 pid,start=found[0];p=pathlib.Path('/proc')/str(pid);assert p.joinpath('stat').read_text().split()[21]==start;os.kill(pid,signal.SIGTERM)
 for _ in range(30):
  if not p.exists()or p.joinpath('stat').read_text().split()[21]!=start:break
  time.sleep(1)
 assert not p.exists()or p.joinpath('stat').read_text().split()[21]!=start
print(json.dumps({'mode':'verify','success':True,'exactOwnBuildHelperSignaled':bool(found),'businessContainerSignalsPerformed':False}),flush=True)
