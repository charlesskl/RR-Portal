"""INERT read-only QC live/canonical filesystem discrepancy diagnostic.
Never starts the QMS application, alters source/config/tags/databases, replays prepare,
or edits the failed phase. Canonical probes run only Node filesystem reads with
network none/read-only root/no production mounts or injected credentials.
The existing failed directory is hashed twice and externally sealed in this new archive.
Public tracked names may be returned; every unknown path/link target is hash-only.
"""
import ast,contextlib,hashlib,importlib.util,io,json,os,pathlib,re,stat,subprocess,sys,time
ROOT=pathlib.Path('/opt/rr-portal');OUT=ROOT/'deploy/backups/pr1046-1049-qc-source-diagnose-1'
FAILED_PREPARE=ROOT/'deploy/backups/pr1046-1049-qc-20261031-1/prepare'
APP='apps/生产部/品质管理系统';BASE_SOURCE='0d7599859e5e01e90e4bbcbe71a9bd4a0a77b417';HOST_BASE='f22fbffa1789234fe1c78bf776f4dcb3fe867d0c'
CID='712466bf56a8537eb914ac8c835f0315dee1d33ad4faae3665af71ed803988f9';LIVE_IMAGE='sha256:f4ae6aa9dd4ffec6e7dcca66eaae748a4e69cdc160eced9b10b4e2ab9a019494';CANONICAL='sha256:65c56b6f8f59b8df5420912057023172b3fdd402297163b31342ee04561ac2f8';ALIAS='rr-portal-qc:latest'
PROFILE=ROOT/'deploy/backups/pr1046-1049-preflight-2/result.private.json';PROFILE_FILE_SHA256='5d03099f38dfebacaa8138d5fb0bd2166f5399241b97f9cac5d38012a5b73cf7';PROFILE_INNER_SHA256='d7aa304cdf293410d123a1b531e1755b1a27f20b56a912d89d4e32acbab5064a'
OBSERVED_FAILED_RELEASE_SHA256='aa076f7e6f320eda570bce62904be7aa24fcaa79ced33e05dd3244751f127ba5'
EXECUTE=False;BRANCH='refs/heads/codex/ops-pr-1046-1049-20261031';SERIAL=0;STAGE='entry';P=None
COMMON_NAME='pr1035-quote-preflight.py';COMMON_SHA256='2b2739aa00cad03bfce8472b7416d725364b8d4ed354a5a7e9ca905a47aaffa5'
CODE_PROBE="const fs=require('fs'),path=require('path'),crypto=require('crypto');\nconst h=b=>crypto.createHash('sha256').update(b).digest('hex');\nfunction tree(root,omit=[]){let a=[],bytes=0;function walk(p,n){let s=fs.lstatSync(p),v={n,uid:s.uid,gid:s.gid,mode:s.mode&4095};\nif(s.isSymbolicLink()){v.type='link';v.target=fs.readlinkSync(p);}else if(s.isDirectory()){v.type='dir';a.push(v);for(let x of fs.readdirSync(p).sort()){if(n===''&&omit.includes(x))continue;walk(path.join(p,x),n?n+'/'+x:x);}return;}else if(s.isFile()){v.type='file';v.size=s.size;bytes+=s.size;v.sha256=h(fs.readFileSync(p));}else throw Error('unsupported-code-kind');a.push(v);if(a.length>100000||bytes>1024**3)throw Error('bounded-code');}\nif(!fs.existsSync(root))return {absent:true};walk(root,'');return {sha256:h(JSON.stringify(a)),entries:a.length,bytes};}\nconsole.log(JSON.stringify({app:tree('/app',['data']),package:tree('/app/package.json')}));"
SOURCE_PROBE="const fs=require('fs'),path=require('path'),crypto=require('crypto'),items=JSON.parse(fs.readFileSync(0,'utf8'));let out={};if(!Array.isArray(items)||items.length>2000)throw Error('scope');for(const n of items){if(!/^[A-Za-z0-9_./-]+$/.test(n)||n.split('/').some(x=>x==='..'||x===''||x==='data'||x==='uploads'||x==='legacy-data')||/(^|\\/)\\.env(\\.|$)/.test(n))throw Error('path');const p='/app/'+n;for(let d=path.dirname(p);d!=='/';d=path.dirname(d))if(fs.lstatSync(d).isSymbolicLink())throw Error('parentlink');if(!fs.existsSync(p)){out[n]={absent:true};continue;}const a=fs.lstatSync(p);if(!a.isFile()||a.isSymbolicLink()||a.size>128*1024**2)throw Error('file');const fd=fs.openSync(p,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);try{const b=fs.readFileSync(fd),z=fs.fstatSync(fd);if(b.length!==a.size||a.ino!==z.ino||a.mtimeMs!==z.mtimeMs||a.ctimeMs!==z.ctimeMs)throw Error('changed');out[n]={sha256:crypto.createHash('sha256').update(b).digest('hex'),gitBlobSHA1:crypto.createHash('sha1').update('blob '+b.length+'\\0').update(b).digest('hex'),bytes:b.length,uid:a.uid,gid:a.gid,mode:a.mode&4095};}finally{fs.closeSync(fd);}}console.log(JSON.stringify(out));"
CODE_PROBE_SHA256='6b4e6b1b70935f1276ee9c7bc24d84c06ce04e1014acf325c75bf62bab4a86ad'

def need(v,label):
 global STAGE
 STAGE=label
 if not v:raise RuntimeError(label)

def enc(v):return json.dumps(v,sort_keys=True,separators=(',',':'),ensure_ascii=True,allow_nan=False).encode()

def sha(b):return hashlib.sha256(b).hexdigest()

def pin(v,n=64):return type(v)is str and re.fullmatch('[a-f0-9]{%d}'%n,v)is not None

def memory(args):
 # Secret-bearing Docker Config/Env stays in memory, only digests are persisted.
 r=subprocess.run(args,capture_output=True,timeout=60,cwd=ROOT);need(r.returncode==0 and len(r.stdout)<=16*1024**2,'bounded-private-in-memory-inspect');return json.loads(r.stdout)

def file_hash(path):
 h=hashlib.sha256()
 with path.open('rb')as f:
  for b in iter(lambda:f.read(1024**2),b''):h.update(b)
 return h.hexdigest()

def transport(value):
 raw=enc(value);need(len(raw)<=4*1024**2,'bounded-secret-free-hash-receipt');nib=lambda v:[int(x,16)for x in(format(v,'x')if type(v)is int else v)];parts=[raw[i:i+1024]for i in range(0,len(raw),1024)];digest=nib(sha(raw))
 for i,b in enumerate(parts):print(enc([0,nib(i+1),nib(len(parts)),nib(len(raw)),digest,nib(b.hex())]).decode(),flush=True)
 print(enc([1,nib(len(parts)),nib(len(raw)),digest]).decode(),flush=True)

def private(name,value):
 path=OUT/name;fd=os.open(path,os.O_CREAT|os.O_EXCL|os.O_WRONLY|os.O_NOFOLLOW,0o600)
 with os.fdopen(fd,'wb')as f:f.write(enc(value));f.flush();os.fsync(f.fileno())

def run(args,data=None,timeout=180):
 global SERIAL
 SERIAL+=1;base=OUT/('%03d'%SERIAL)
 with contextlib.ExitStack()as s:
  a=s.enter_context(os.fdopen(os.open(base.with_suffix('.stdout.private'),os.O_CREAT|os.O_EXCL|os.O_WRONLY|os.O_NOFOLLOW,0o600),'wb'));b=s.enter_context(os.fdopen(os.open(base.with_suffix('.stderr.private'),os.O_CREAT|os.O_EXCL|os.O_WRONLY|os.O_NOFOLLOW,0o600),'wb'))
  try:r=subprocess.run(args,input=data,stdout=a,stderr=b,cwd=ROOT,timeout=timeout)
  finally:
   for f in(a,b):f.flush();os.fsync(f.fileno())
 need(r.returncode==0 and base.with_suffix('.stdout.private').stat().st_size<=16*1024**2 and base.with_suffix('.stderr.private').stat().st_size<=1024**2,'bounded-fixed-readonly-command');return base.with_suffix('.stdout.private').read_bytes()

def git(*args):return run(['git','-C',str(ROOT),'-c','core.hooksPath=/dev/null',*args])

def runtime():
 ids=run(['docker','ps','-aq','--no-trunc']).decode().split();need(len(ids)==46 and len(set(ids))==46 and all(pin(v)for v in ids),'all-original46-container-identities');rows=memory(['docker','inspect',*ids]);need({r['Id']for r in rows}==set(ids),'complete-in-memory-original46-inspect');result={}
 for r in rows:
  result[r['Id']]={'image':r['Image'],'configSHA256':sha(enc(r['Config'])),'hostConfigSHA256':sha(enc(r['HostConfig'])),'envSHA256':sha(enc(sorted(r['Config'].get('Env')or[]))),'mountsSHA256':sha(enc(sorted(r['Mounts'],key=enc))),'pid':r['State']['Pid'],'started':r['State']['StartedAt'],'restarts':r['RestartCount'],'running':r['State']['Running'],'oom':r['State']['OOMKilled'],'health':r['State'].get('Health',{}).get('Status')}
 target=[r for r in rows if r['Id']==CID];need(len(target)==1 and target[0]['Image']==LIVE_IMAGE and target[0]['State']['Running']and target[0]['State'].get('Health',{}).get('Status')=='healthy','same-healthy-qc-cid-image');e=dict(v.split('=',1)for v in target[0]['Config'].get('Env')or[]);need(e.get('DATA_PATH')=='/app/data','configured-business-data-root-excluded-from-probes');return result

def canonical():
 r=memory(['docker','image','inspect',ALIAS]);need(len(r)==1 and r[0]['Id']==CANONICAL and not r[0]['Config'].get('Volumes'),'same-canonical-qc-image-no-probe-volumes');return {'id':r[0]['Id'],'configSHA256':sha(enc(r[0]['Config'])),'rootfsSHA256':sha(enc(r[0]['RootFS']))}

def protection():
 need(git('rev-parse','HEAD').decode().strip()==HOST_BASE,'host-checkout-unchanged');dirty=P.dirty_summary(git('diff','--name-only','-z'));staged=P.dirty_summary(git('diff','--cached','--name-only','-z'));return {'shared':{n:P.shared_file(n)for n in P.SHARED},'env':{str(p.relative_to(ROOT)):P.shared_file(str(p))for p in ROOT.glob('.env*')if p.is_file()},'gatewayAuth':P.gateway_auth(),'unstaged':dirty,'staged':staged}

def original_failed_seal():
 need(FAILED_PREPARE.is_dir()and not any(p.is_symlink()for p in(FAILED_PREPARE,*FAILED_PREPARE.parents)),'original-failed-prepare-real-directory');records=[];total=0
 for path in[FAILED_PREPARE,*sorted(FAILED_PREPARE.rglob('*'))]:
  a=path.lstat();need(not stat.S_ISLNK(a.st_mode)and(stat.S_ISREG(a.st_mode)or stat.S_ISDIR(a.st_mode)),'original-failed-evidence-regular-only');row={'path':str(path.relative_to(FAILED_PREPARE)),'uid':a.st_uid,'gid':a.st_gid,'mode':stat.S_IMODE(a.st_mode),'mtimeNs':a.st_mtime_ns,'ctimeNs':a.st_ctime_ns,'bytes':a.st_size,'type':'directory'if stat.S_ISDIR(a.st_mode)else'file'}
  if stat.S_ISREG(a.st_mode):
   total+=a.st_size;need(a.st_size<=256*1024**2 and total<=512*1024**2,'bounded-original-failed-evidence-hash-only');row['sha256']=file_hash(path);b=path.lstat();need((a.st_dev,a.st_ino,a.st_uid,a.st_gid,a.st_mode,a.st_size,a.st_mtime_ns,a.st_ctime_ns)==(b.st_dev,b.st_ino,b.st_uid,b.st_gid,b.st_mode,b.st_size,b.st_mtime_ns,b.st_ctime_ns),'original-failed-file-stable-while-hashed')
  records.append(row);need(len(records)<=10000,'bounded-original-failed-evidence-entries')
 return {'directory':str(FAILED_PREPARE),'entries':records,'contentAndMetadataSHA256':sha(enc(records)),'atimeExcluded':True,'bytes':total,'writesToOriginalDirectory':False}

def structured_old_probes():
 records=[]
 for path in sorted(FAILED_PREPARE.iterdir()):
  if not re.fullmatch(r'[0-9]{3,6}-stdout\.private',path.name)or not path.is_file()or path.is_symlink()or path.stat().st_size>4096:continue
  try:value=json.loads(path.read_bytes())
  except(ValueError,UnicodeError):continue
  if type(value)is not dict or set(value)!={'app','package'}:continue
  if not all(type(row)is dict and set(row)=={'sha256','entries','bytes'}and pin(row['sha256'])and type(row['entries'])is int and 1<=row['entries']<=100000 and type(row['bytes'])is int and 0<=row['bytes']<=1024**3 for row in value.values()):continue
  records.append({'fixedPrivateLog':path.name,'signature':value,'rawFileSHA256':file_hash(path)})
 need(len(records)<=4,'bounded-structured-code-probe-records-only');return records

def public_paths(profile):
 expected={};known=[]
 for raw in git('ls-tree','-r','-z',BASE_SOURCE,'--',APP).split(b'\0'):
  if not raw:continue
  meta,name=raw.split(b'\t',1);mode,kind,blob=meta.decode().split();name=name.decode()[len(APP)+1:];parts=pathlib.PurePosixPath(name).parts
  need(name and not name.startswith('/')and'..'not in parts and not any(ord(c)<32 for c in name),'safe-public-git-path')
  if any(p in parts for p in('data','data-test','storage','storage-test','uploads','legacy-data','node_modules'))or any(p.startswith('.env')for p in parts):continue
  if kind=='blob':known.append(name)
  take=(name.startswith('server/')or'/'not in name)and name.endswith(('.js','.html','.css','.json'))and not name.startswith('.')and not name.endswith(('.test.js','.test.json'))
  if take:need(mode in('100644','100755')and kind=='blob','regular-known-qc-source');expected[name]=blob
 need(len(expected)==16 and expected==profile['targets']['qc']['source']['expectedGitBlobSHA1'],'same16-public-production-source-baseline');need(len(known)<=10000,'bounded-public-tracked-name-allowlist');return known,expected

DETAIL_NODE=r"""const fs=require('fs'),path=require('path'),crypto=require('crypto'),vm=require('vm');const input=JSON.parse(fs.readFileSync(0,'utf8')),h=b=>crypto.createHash('sha256').update(b).digest('hex');if(!Array.isArray(input.publicPaths)||input.publicPaths.length>10000||h(input.codeProbe)!==input.codeProbeSHA256)throw Error('fixed-probe-input');const known=new Set(['']),fields=['uid','gid','mode','size','mtimeMs','ctimeMs','ino','dev'];for(const n of input.publicPaths){if(typeof n!=='string'||!n||n.startsWith('/')||n.split('/').some(x=>x==='..'||x==='')||/[\x00-\x1f]/.test(n))throw Error('publicpath');known.add(n);let p=n;while(p.includes('/')){p=p.slice(0,p.lastIndexOf('/'));known.add(p);}}function coarse(){const result=[];vm.runInNewContext(input.codeProbe,{require,console:{log:v=>result.push(JSON.parse(v))}},{timeout:120000});if(result.length!==1||Object.keys(result[0]).sort().join()!=='app,package')throw Error('coarse-shape');return result[0];}const before=coarse(),rows=[];let bytes=0;function walk(p,n){const a=fs.lstatSync(p),row={pathSHA256:h(n),type:'',uid:a.uid,gid:a.gid,mode:a.mode&4095};if(known.has(n))row.publicPath=n;else{const ext=path.extname(n);row.extension=/^\.[A-Za-z0-9]{1,12}$/.test(ext)?ext.toLowerCase():'';row.classification=/(^|\/)(?:tests?|[^/]+\.test\.[jt]sx?)(\/|$)/i.test(n)?'test':/(^|\/)(?:docs?|README[^/]*)(\/|$)|\.md$/i.test(n)?'documentation':'other';}if(a.isSymbolicLink()){row.type='link';row.linkSHA256=h(fs.readlinkSync(p));}else if(a.isDirectory()){row.type='directory';rows.push(row);for(const c of fs.readdirSync(p).sort()){if(n===''&&c==='data')continue;walk(path.join(p,c),n?n+'/'+c:c);}return;}else if(a.isFile()){if(a.size>128*1024**2)throw Error('bounded-file');const fd=fs.openSync(p,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);let body;try{body=fs.readFileSync(fd);const z=fs.fstatSync(fd);if(!fields.every(k=>a[k]===z[k])||body.length!==a.size)throw Error('file-changed');}finally{fs.closeSync(fd);}row.type='file';row.bytes=body.length;row.sha256=h(body);bytes+=body.length;if(bytes>512*1024**2)throw Error('bounded-tree');}else throw Error('unsupported-kind');rows.push(row);if(rows.length>10000)throw Error('bounded-entries');const z=fs.lstatSync(p);if(!fields.every(k=>a[k]===z[k]))throw Error('entry-changed');}walk('/app','');const after=coarse();if(JSON.stringify(before)!==JSON.stringify(after))throw Error('whole-tree-changed-during-probe');console.log(JSON.stringify({originalGuardSignature:before,entries:rows,totalFileBytes:bytes,businessRootTraversed:false,rawUnknownNamesReturned:false,rawBodiesReturned:false}));"""

def detail_probe(identity,known,image_mode=False):
 args=['docker','exec','--user','0','-i',identity,'node','-e',DETAIL_NODE]
 if image_mode:args=['docker','run','--rm','-i','--user','0','--network','none','--read-only','--restart','no','--log-driver','none','--entrypoint','node',identity,'-e',DETAIL_NODE]
 value=json.loads(run(args,enc({'publicPaths':known,'codeProbe':CODE_PROBE,'codeProbeSHA256':CODE_PROBE_SHA256}),240));need(set(value)=={'originalGuardSignature','entries','totalFileBytes','businessRootTraversed','rawUnknownNamesReturned','rawBodiesReturned'}and value['businessRootTraversed']is False and value['rawUnknownNamesReturned']is False and value['rawBodiesReturned']is False,'strict-redacted-detailed-probe');need(type(value['entries'])is list and 1<=len(value['entries'])<=10000 and len({r['pathSHA256']for r in value['entries']})==len(value['entries']),'bounded-unique-detailed-path-hashes');return value

def differences(live,canonical):
 a={r['pathSHA256']:r for r in live['entries']};b={r['pathSHA256']:r for r in canonical['entries']};rows=[];allowed={'type','uid','gid','mode','bytes','sha256','linkSHA256'}
 for key in sorted(set(a)|set(b)):
  x,y=a.get(key),b.get(key);changed=['presence']if x is None or y is None else sorted(k for k in allowed if x.get(k)!=y.get(k))
  if not changed:continue
  row={'pathSHA256':key,'changedGuardFields':changed}
  known=(x or y).get('publicPath')
  if known is not None:row['publicPath']=known
  else:row.update(extension=(x or y).get('extension',''),classification=(x or y).get('classification','other'))
  row['live']=None if x is None else{k:v for k,v in x.items()if k in allowed};row['canonical']=None if y is None else{k:v for k,v in y.items()if k in allowed};rows.append(row)
 return rows

def source_probe(expected):
 actual=json.loads(run(['docker','exec','--user','0','-i',CID,'node','-e',SOURCE_PROBE],enc(sorted(expected))));need(set(actual)==set(expected)and all(actual[n].get('gitBlobSHA1')==h for n,h in expected.items()),'all16-current-live-public-source-blobs-exact-original-base');return actual

def diagnose():
 need(sha(CODE_PROBE.encode())==CODE_PROBE_SHA256 and pin(PROFILE_FILE_SHA256)and PROFILE.is_file()and not PROFILE.is_symlink()and file_hash(PROFILE)==PROFILE_FILE_SHA256,'fixed-original-guard-and-readonly-profile');profile=json.loads(PROFILE.read_bytes());inner=dict(profile);inner.pop('resultSHA256',None);need(profile['success']is True and profile['readOnly']is True and profile['sourceBaseline']==BASE_SOURCE and profile['resultSHA256']==PROFILE_INNER_SHA256==sha(enc(inner)),'successful-profile2-source-and-digests');before=runtime();need(before==profile['allRuntime'],'all46-runtime-env-config-pids-preserved-since-successful-profile2');protected=protection();need(protected=={k:profile[k]for k in('shared','env','gatewayAuth','unstaged','staged')},'all-original-host-shared-env-auth-and-dirty-inventory-preserved');image=canonical();need(image['rootfsSHA256']==profile['targets']['qc']['canonicalImage']['rootfsSHA256'],'canonical-rootfs-still-original');old=original_failed_seal();private('failed-prepare-external-seal.private.json',old);old_probes=structured_old_probes();known,expected=public_paths(profile);public=source_probe(expected);need(public==profile['targets']['qc']['source']['actual'],'all16-live-public-source-bytes-and-metadata-preserved');live=detail_probe(CID,known);canon=detail_probe(CANONICAL,known,True);diff=differences(live,canon);private('live-filesystem-redacted.private.json',live);private('canonical-filesystem-redacted.private.json',canon);private('differences.private.json',diff);need(runtime()==before and protection()==protected and canonical()==image,'all46-runtime-source-env-shared-canonical-preserved-after-readonly-probes');need(source_probe(expected)==public,'all16-public-source-stable-through-diagnostic');again=original_failed_seal();need(old==again,'original-failed-phase-bytes-and-recorded-metadata-unchanged');summary={'originalStructuredProbeCount':len(old_probes),'originalStructuredProbes':old_probes,'currentLiveSignature':live['originalGuardSignature'],'currentCanonicalSignature':canon['originalGuardSignature'],'differingPaths':len(diff),'knownPublicDifferences':sum('publicPath'in r for r in diff),'unknownHashedDifferences':sum('publicPath'not in r for r in diff),'differenceRows':diff,'originalFailedEvidenceSealSHA256':old['contentAndMetadataSHA256'],'originalFailedEvidencePreserved':True,'all46RuntimeAndOriginalPublicSourcePreserved':True,'guardRelaxed':False,'prepareRetried':False}
 if len(old_probes)==2:summary['originalProbeOrderMatchesCurrent']=[old_probes[0]['signature']==live['originalGuardSignature'],old_probes[1]['signature']==canon['originalGuardSignature']]
 return summary

def main():
 global STAGE,P
 need(EXECUTE is True and BRANCH and sys.argv[1:]==['diagnose']and os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_MODE')=='diagnose'and os.environ.get('RELEASE_ATTEMPT')=='1','explicit-first-readonly-qc-source-diagnostic-only');os.umask(0o077);need(OUT.parent.is_dir()and not any(p.is_symlink()for p in(OUT.parent,*OUT.parent.parents))and not OUT.exists(),'fresh-own-readonly-diagnostic-private-directory');OUT.mkdir(mode=0o700);value={'phase':'diagnose','mode':'diagnose','success':False,'readOnly':True,'businessWrites':False,'lifecycleWrites':False,'configurationWrites':False,'sourceOrImageTagsChanged':False,'originalFailedPhaseModified':False,'prepareRetried':False,'configuredBusinessDataRootTraversed':False,'plaintextCredentialsOrFileBodiesReturned':False,'resultPath':str(OUT/'result.private.json')}
 try:
  path=pathlib.Path(__file__).with_name(COMMON_NAME);need(path.is_file()and not path.is_symlink()and sha(path.read_bytes())==COMMON_SHA256,'fixed-reviewed-hash-only-protection-library');s=importlib.util.spec_from_file_location('qc_readonly_common',path);P=importlib.util.module_from_spec(s);s.loader.exec_module(P);P.OUT=OUT;value['details']=diagnose();value['success']=True
 except Exception as e:value.update(errorType=type(e).__name__,stage=STAGE)
 value['resultSHA256']=sha(enc(value));private('result.private.json',value);files=list(OUT.rglob('*'));need(all(not p.is_symlink()and(p.is_file()or p.is_dir())for p in files),'all-readonly-evidence-regular');manifest={str(p.relative_to(OUT)):file_hash(p)for p in files if p.is_file()};private('manifest.json',manifest);transport({'result':value,'manifestSHA256':sha(enc(manifest))});return 0 if value['success']else 1

if __name__=='__main__':sys.exit(main())
