"""Fixed read-only diagnosis of the first scoped-release source rejection."""
import hashlib,importlib.util,json,os,pathlib,re,stat,subprocess,sys,time
ROOT=pathlib.Path('/opt/rr-portal');TARGET='85d2082c273d3df3e51b2e414855634c56c498dd';BASE='52c090589d6da542fee74ef17c8edd3b0dfe4fe6'
OLD=ROOT/'deploy/backups/release-937-943-944-945-946-950-deploy-20261019';OUT=OLD.with_name(OLD.name+'-source-diagnostic')
BRANCH='refs/heads/ops/release-937-943-944-945-946-950-20261019';PIN_FROZEN=True
LIBRARY_SHA='d63168fd3057f4f2aba2d93f9fab31d2d65c6dd0f3234877d71fcff1e04e62b9'
APP_ROOTS=('apps/生产部/品质管理系统','apps/印尼小组/印尼走货明细','apps/业务部/内部报价系统','apps/PMC跟仓管/加工厂月度评审管理制度','apps/QA部/QC成品报告系统','apps/船务部','apps/工程部/3D打印协同平台')
def need(x):
 if not x:raise RuntimeError('SOURCE_DIAGNOSTIC_REJECTED')
def enc(x):return json.dumps(x,ensure_ascii=True,sort_keys=True,separators=(',',':')).encode()
def read(args,optional=False):
 need(time.monotonic()<DEADLINE);p=subprocess.run(['git','-c','core.hooksPath=/dev/null',*args],stdout=subprocess.PIPE,stderr=subprocess.PIPE,cwd=ROOT,timeout=max(.1,min(10,DEADLINE-time.monotonic())))
 need(len(p.stdout)+len(p.stderr)<=512*1024);need(optional or p.returncode==0);return p.returncode,p.stdout
def seal_state():
 need(OLD.is_dir() and not OLD.is_symlink() and stat.S_IMODE(OLD.stat().st_mode)==0o700)
 entries=list(OLD.rglob('*'));need(len(entries)<=1000 and all(not p.is_symlink() and (p.is_file() or p.is_dir()) and p.stat().st_mode&0o077==0 for p in entries))
 manifest=json.loads((OLD/'manifest.json').read_bytes());need(isinstance(manifest,dict) and set(manifest)=={str(p.relative_to(OLD))for p in entries if p.is_file() and p!=OLD/'manifest.json'})
 need(sum(p.stat().st_size for p in entries if p.is_file())<=64*1024**2)
 need(all(L.safe_path(n) and re.fullmatch('[a-f0-9]{64}',h) and L.file_hash(OLD/n)==h for n,h in manifest.items()))
 return {'manifestSHA256':L.file_hash(OLD/'manifest.json'),'resultSHA256':L.file_hash(OLD/'first-result.json')}
def paths(args):
 code,raw=read(['diff','--no-ext-diff','--no-textconv','--name-only','-z',*args]);rows=[p for p in raw.decode().split('\0')if p];need(len(rows)<=10000);return rows
def classify(rows,known):
 counts={};visible=[]
 for name in rows:
  if name in known:visible.append(name)
  else:
   root=next((p for p in APP_ROOTS if name.startswith(p+'/')),'other');counts[root]=counts.get(root,0)+1
 return {'reviewedSourcePaths':sorted(visible),'otherTrackedPathCountsByFixedRoot':counts,'total':len(rows)}
def main():
 global L,DEADLINE
 os.umask(0o077);need(PIN_FROZEN and os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_ATTEMPT')=='1');DEADLINE=time.monotonic()+80
 lib=pathlib.Path(__file__).with_name('release-data-library.py');need(not lib.is_symlink() and hashlib.sha256(lib.read_bytes()).hexdigest()==LIBRARY_SHA)
 spec=importlib.util.spec_from_file_location('source_diag_library',lib);L=importlib.util.module_from_spec(spec);spec.loader.exec_module(L)
 OUT.mkdir(mode=0o700);result={'success':False,'businessWritesPerformed':False,'oldEvidenceModified':False}
 try:
  before=seal_state();prior=json.loads((OLD/'first-result.json').read_bytes());need(prior.get('success')is False and prior.get('failedStage')=='validate-source' and prior.get('target')==TARGET)
  result['oldEvidence']=before;logs=[]
  for p in OLD.iterdir():
   match=re.fullmatch(r'(\d{3})-[a-z-]+\.(?:log|stdout\.private)',p.name)
   if match:logs.append({'number':int(match[1]),'bytes':p.stat().st_size,'stdout':p.name.endswith('.stdout.private')})
  result['commandLogMetadata']=sorted(logs,key=lambda x:(x['number'],x['stdout']));result['lastCommandNumber']=max((x['number']for x in logs),default=None)
  for label,args in [('head',['rev-parse','HEAD']),('fetchHead',['rev-parse','FETCH_HEAD'])]:
   code,raw=read(args,True);value=raw.decode().strip();result[label]=value if code==0 and re.fullmatch('[a-f0-9]{40}',value)else None
  code,raw=read(['symbolic-ref','--quiet','HEAD'],True);result['branch']='main'if code==0 and raw==b'refs/heads/main\n'else'other-or-detached'
  code,_=read(['cat-file','-e',TARGET+'^{commit}'],True);result['expectedTargetObjectPresent']=code==0
  known=set(paths([BASE,TARGET])) if code==0 else set();need(not known or len(known)==57)
  raw_paths={'unstaged':paths([]),'staged':paths(['--cached'])};L.private_write(OUT/'tracked-paths.private.json',enc(raw_paths))
  result['trackedChanges']={k:classify(v,known)for k,v in raw_paths.items()};need(seal_state()==before);result['oldSealRevalidated']=True;result['success']=True
 except BaseException:result['safeFailure']='FIXED_SOURCE_DIAGNOSTIC_FAILED'
 finally:
  L.private_write(OUT/'first-result.json',enc(result));L.seal(OUT);print(enc(result).decode(),flush=True)
 return 0 if result['success']else 1
if __name__=='__main__':
 try:sys.exit(main())
 except Exception:print('{"success":false,"safeFailure":"SOURCE_DIAGNOSTIC_PREFLIGHT_REJECTED"}',flush=True);sys.exit(1)
