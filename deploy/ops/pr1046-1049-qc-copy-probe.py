"""INERT two-mode Docker tar-stdin ownership experiment on owned NEVER-STARTED scratches.
No build/start/run/exec, production-CID copy, mounts, networking, env injection,
image retag, source checkout, database access, old-phase modification or retry.
"""
import contextlib,hashlib,io,json,os,pathlib,re,stat,subprocess,sys,tarfile
ROOT=pathlib.Path('/opt/rr-portal');OUT=ROOT/'deploy/backups/pr1046-1049-qc-copy-probe-1'
FAILED=ROOT/'deploy/backups/pr1046-1049-qc-20261031-2/prepare';FAILED_MANIFEST='d5817fb052c9d0a4417bf0fcac0eaec8f90cfec8155c0f0005a629d6b3b4de87'
CANDIDATE='sha256:8f0dee9f9428dc2908dd3cff8e13ec849bc58db2f9ebce7db7e02d1cac063019';ALIAS='rr-portal-qc:latest';CANONICAL='sha256:65c56b6f8f59b8df5420912057023172b3fdd402297163b31342ee04561ac2f8'
EXPERIMENT='pr1046-1049-qc-copy-probe-1';EXECUTE=False;BRANCH='refs/heads/codex/ops-pr-1046-1049-20261031';STAGE='entry';DETAILS={}
FILES={'ai-ocr.js':'8a57edd412f32fffe2660a695b3e4789968352d584692d8da38f752d11e029ef','app.js':'913ac9becab4eb2f47dfa472167b240c4057766213548d98625ad1180ede5208','qc-backend.js':'cb9d7845c8c59dad84eda56ca9860381852db3e58ff2eb4f829a406c87a5b759','report_export.js':'4938b11d8d27ebd4511aa82ad21b330fa134cc082ae15e4c76838a0a603e0e15','server/server.js':'f1aa9941380c8e4d32ea15d2eef463474b6522e0c36caa19f1b4f2a542827305'}
OWNERS={n:(100,101)if n in('qc-backend.js','server/server.js')else(0,0)for n in FILES}
def need(v,label):
 global STAGE
 STAGE=label
 if not v:raise RuntimeError(label)
def enc(v):return json.dumps(v,sort_keys=True,separators=(',',':'),ensure_ascii=True,allow_nan=False).encode()
def sha(v):return hashlib.sha256(v).hexdigest()
def file_hash(p):
 h=hashlib.sha256()
 with p.open('rb')as f:
  for b in iter(lambda:f.read(1024**2),b''):h.update(b)
 return h.hexdigest()
def command(args,data=None):
 p=subprocess.run(args,input=data,capture_output=True,timeout=90,cwd=ROOT);need(p.returncode==0 and len(p.stdout)<=8*1024**2 and len(p.stderr)<=1024**2,'bounded-fixed-owned-scratch-command');return p.stdout

def runtime():
 ids=command(['docker','ps','-aq','--no-trunc']).decode().split();need(len(ids)==46 and len(set(ids))==46,'all-original46-before-or-after-probe');rows=json.loads(command(['docker','inspect',*ids]));return {r['Id']:{'image':r['Image'],'configSHA256':sha(enc(r['Config'])),'hostSHA256':sha(enc(r['HostConfig'])),'mountsSHA256':sha(enc(r['Mounts'])),'pid':r['State']['Pid'],'started':r['State']['StartedAt'],'restarts':r['RestartCount'],'running':r['State']['Running'],'oom':r['State']['OOMKilled'],'health':r['State'].get('Health',{}).get('Status')}for r in rows}
def alias():
 rows=json.loads(command(['docker','image','inspect',ALIAS]));need(len(rows)==1 and rows[0]['Id']==CANONICAL,'canonical-alias-stays-original');return rows[0]['Id']
def tar_metadata(raw,expected=None):
 need(len(raw)<=8*1024**2,'bounded-fixed-source-tar');out={}
 with tarfile.open(fileobj=io.BytesIO(raw))as archive:
  for m in archive.getmembers():
   need(m.isfile()and not m.issym()and not m.islnk()and m.name not in out and 0<=m.size<=4*1024**2,'regular-unique-owned-source-tar-member');body=archive.extractfile(m).read();need(len(body)==m.size,'complete-owned-source-tar-body');out[m.name]={'sha256':sha(body),'bytes':m.size,'uid':m.uid,'gid':m.gid,'mode':m.mode,'mtime':m.mtime}
 if expected is not None:
  need(set(out)==set(expected),'exact-five-reviewed-source-tar-paths')
  for n,h in expected.items():need(out[n]['sha256']==h and(out[n]['uid'],out[n]['gid'])==OWNERS[n]and out[n]['mode']==0o644 and type(out[n]['mtime'])is int and out[n]['mtime']>0,'reviewed-five-source-bytes-mixed-owners-mode-and-mtime')
 return out

def owned(cid,mode):
 rows=json.loads(command(['docker','inspect',cid]));need(len(rows)==1,'one-owned-neverstarted-scratch');r=rows[0];need(r['Id']==cid and r['Image']==CANDIDATE and not r['Mounts']and r['HostConfig']['NetworkMode']=='none'and not r['State']['Running']and r['State']['Pid']==0 and r['State']['StartedAt'].startswith('0001-')and(r['Config'].get('Labels')or{}).get('io.rr-portal.qc-copy-probe')==EXPERIMENT+'-'+mode,'exact-owned-candidate-scratch-neverstarted-no-mounts-network');return r

def one_mode(mode,patch,expected,original_ids):
 need(mode in('default','archive'),'fixed-two-copy-modes-only');cid=command(['docker','create','--pull=never','--network','none','--restart','no','--log-driver','none','--label','io.rr-portal.qc-copy-probe='+EXPERIMENT+'-'+mode,'--entrypoint','/bin/true',CANDIDATE]).decode().strip();need(re.fullmatch('[a-f0-9]{64}',cid)is not None and cid not in original_ids,'new-own-scratch-not-any-original-cid');result={'mode':mode,'id':cid,'neverStarted':True,'metadata':{},'removed':False};DETAILS.setdefault('modes',[]).append(result)
 try:
  owned(cid,mode);command(['docker','cp',*(['--archive']if mode=='archive'else[]),'-',cid+':/app'],patch)
  for name in FILES:
   raw=command(['docker','cp',cid+':/app/'+name,'-']);rows=tar_metadata(raw);need(len(rows)==1 and pathlib.PurePosixPath(next(iter(rows))).name==pathlib.PurePosixPath(name).name,'single-readback-owned-source-member');result['metadata'][name]=next(iter(rows.values()))
  result['allExpectedFieldsMatch']=result['metadata']==expected;result['differingFields']={n:sorted(k for k in expected[n]if expected[n][k]!=result['metadata'][n].get(k))for n in expected if expected[n]!=result['metadata'][n]}
 except Exception as e:result['operationFailureType']=type(e).__name__;result['operationPureLabel']=e.args[0]if len(e.args)==1 and type(e.args[0])is str and re.fullmatch('[A-Za-z][A-Za-z0-9_.:-]{0,119}',e.args[0])else None;raise
 finally:owned(cid,mode);command(['docker','rm',cid]);result['removed']=True

def experiment():
 need(file_hash(FAILED/'manifest.json')==FAILED_MANIFEST,'sealed-failed-r2-manifest');mf=json.loads((FAILED/'manifest.json').read_bytes());path=FAILED/'patch.tar';need(path.is_file()and not path.is_symlink()and path.stat().st_size<=8*1024**2 and file_hash(path)==mf['patch.tar'],'exact-sealed-public-source-patch-only');patch=path.read_bytes();expected=tar_metadata(patch,FILES);DETAILS['expectedMetadata']=expected;DETAILS['patchSHA256']=sha(patch);before=runtime();alias();rows=json.loads(command(['docker','image','inspect',CANDIDATE]));need(len(rows)==1 and rows[0]['Id']==CANDIDATE and rows[0]['Config'].get('User')=='appuser'and not rows[0]['Config'].get('Volumes'),'fixed-existing-candidate-no-build-no-volumes-same-configured-user');DETAILS['configuredUser']='appuser';version=json.loads(command(['docker','version','--format','{{json .Server.Version}}']));need(type(version)is str and re.fullmatch('[0-9]+\.[0-9]+\.[A-Za-z0-9_.+-]+',version),'typed-engine-version');DETAILS['serverVersion']=version
 for mode in('archive','default'):one_mode(mode,patch,expected,set(before))
 need(runtime()==before and alias()==CANONICAL,'all-original46-runtime-config-and-alias-exact-after-owned-probe');need(file_hash(FAILED/'manifest.json')==FAILED_MANIFEST and file_hash(path)==mf['patch.tar'],'original-failed-r2-evidence-unchanged');DETAILS['original46AndAliasUnchanged']=True;DETAILS['originalFailedPatchUnchanged']=True;DETAILS['defaultModeExact']=next(r['allExpectedFieldsMatch']for r in DETAILS['modes']if r['mode']=='default');DETAILS['archiveModeExact']=next(r['allExpectedFieldsMatch']for r in DETAILS['modes']if r['mode']=='archive')

def private(name,v):
 fd=os.open(OUT/name,os.O_CREAT|os.O_EXCL|os.O_WRONLY|os.O_NOFOLLOW,0o600)
 with os.fdopen(fd,'wb')as f:f.write(enc(v));f.flush();os.fsync(f.fileno())
def wire(value):
 raw=enc(value);need(len(raw)<=1024**2,'bounded-secret-free-metadata-receipt');nib=lambda x:[int(c,16)for c in(format(x,'x')if type(x)is int else x)];parts=[raw[i:i+1024]for i in range(0,len(raw),1024)];digest=nib(sha(raw))
 for i,b in enumerate(parts):print(enc([0,nib(i+1),nib(len(parts)),nib(len(raw)),digest,nib(b.hex())]).decode(),flush=True)
 print(enc([1,nib(len(parts)),nib(len(raw)),digest]).decode(),flush=True)
def main():
 global STAGE
 need(EXECUTE is True and BRANCH and sys.argv[1:]==['diagnose']and os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_MODE')=='diagnose'and os.environ.get('RELEASE_ATTEMPT')=='1','explicit-owned-neverstarted-copy-probe-only');os.umask(0o077);need(OUT.parent.is_dir()and not any(p.is_symlink()for p in(OUT.parent,*OUT.parent.parents))and not OUT.exists(),'fresh-own-copy-probe-private-archive');OUT.mkdir(mode=0o700);v={'mode':'diagnose','phase':'diagnose','success':False,'ownedNeverStartedScratchWritesOnly':True,'productionContainerSourceOrConfigWrites':False,'productionContainerLifecycle':False,'imageBuildOrTagWrites':False,'databaseAccess':False,'rawSourceBodiesReturned':False,'resultPath':str(OUT/'result.private.json'),'details':DETAILS}
 try:experiment();v['success']=True
 except Exception as e:v.update(errorType=type(e).__name__,stage=STAGE)
 v['resultSHA256']=sha(enc(v));private('result.private.json',v);private('manifest.json',{'result.private.json':file_hash(OUT/'result.private.json')});wire({'result':v,'manifestSHA256':file_hash(OUT/'manifest.json')});return 0 if v['success']else 1
if __name__=='__main__':sys.exit(main())
