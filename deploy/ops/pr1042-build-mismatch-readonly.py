"""INERT R2 public build mismatch diagnosis. No image create/start/build or SQL."""
import datetime,hashlib,json,os,pathlib,re,stat,subprocess,sys,urllib.parse
ROOT=pathlib.Path('/opt/rr-portal')
FAILED=ROOT/'deploy/backups/pr1042-indo-static-r2-20261030/prepare'
OUT=ROOT/'deploy/backups/pr1042-build-mismatch-readonly-1'
BRANCH='refs/heads/codex/ops-pr-1042-20261030-indo'
MANIFEST_SHA256='76dc0744821c46891e80d9a48a7d64420c6007e5a37086653364c8d874c178a7'
FAILED_RESULT_INNER_SHA256='640f8211268ae514ed65864a8d268216a1721bdb8b210ce8d68ea02388888dc0'
HEAD='1e024e50754b7b417207b6e0dcd8ed02d360b45f'
TARGET='1e4366f2803bd5ea19b07b787a12a7d7b66c5ff4'
HOST='f22fbffa1789234fe1c78bf776f4dcb3fe867d0c'
APP='apps/印尼小组/印尼走货明细'
CID='58a9bc0a94611e21a4d8987edd85857fa3f53521ca649bafa3a166890cf3eb2a'
IMAGE='sha256:79c441c8c2df6d6df6fcc475e865535c3ed5c4e884e56bcb1a2a772c5163b0a9'
ALIAS='rr-portal-indo-shipping:latest'
CANONICAL='sha256:f09427d7b4ac75245a4bf823b964e04b8c524edf98eb9287d2ad57f2a76f4bd1'
FRONTEND_TAG='rrportal-indo-pr1042-frontend:'+TARGET
STARTED='2026-10-28T12:00:55.077485506Z'
PID=276848
EXECUTE=False
STAGE='entry'
FORMAT='{"id":{{json .Id}},"image":{{json .Image}},"running":{{json .State.Running}},"oom":{{json .State.OOMKilled}},"health":{{if .State.Health}}{{json .State.Health.Status}}{{else}}null{{end}},"pid":{{json .State.Pid}},"started":{{json .State.StartedAt}},"restarts":{{json .RestartCount}}}'
EXPECTED_NEW_MANIFEST={'assets/CustomersPage-B_Im1Y-2.js': 'f24ce97f0313070ee8cd433837647f4780ab3f90ed877b949e9d94315c72a8a0', 'assets/DbAdminPage-s-h2A1Fm.js': 'b79f8741b0cfbfeac278df33f534ea807211b17a77f7a3dfe1c83dc95c6d2542', 'assets/DictionariesPage-DWJbzZWj.js': 'a8da23cae09f68e71e0ab22384575c74e5670fa80a4297f3eef1e8f7ecf77892', 'assets/EditOutlined-CHvjFvUY.js': 'f7028aefcc8ed192c4092e2ae4b545d86f3a50dc39e47767710b2614b4a56fc4', 'assets/LoginPage-DZ43Qcnd.js': '47c84249b4556818cd6ddd5154138c4e8e9c49f70e4ff111b097624ac0a80346', 'assets/MaterialAlertsPage-C1GjKlFK.js': 'c3810268e6cce30aa71758064070c5e26a20674588db78ebc71e04f0ed7bf7db', 'assets/MoldingPosPage-Do1lRGu1.js': '2e0fb6c24e460d925a0ab04e93c4827e18ee5a0aed23677d736b13542e9b387f', 'assets/OutboundPage-BQsxaIWx.css': 'b4f7372b122d76eebee9521327f40ab96530c2315df0b63ab49a74310fce55a5', 'assets/OutboundPage-CpqfNHeL.js': '998243b3b02d7ed0685d0ebd85f1b85b3f2a65f6d5cb85c9d1937359536c80fc', 'assets/PlusOutlined-D4EJWgTz.js': '4b840efe2b9acc0213d8e357f5c834807ee40a6d00a1080e330c7dbad119bde6', 'assets/ProductsPage-No1nTesQ.js': 'ea8ca5bc3f9214095220b41f9fe9db97206fdfef43d09d3867fcffd3e58c415a', 'assets/PurchasePage-B8YonOf3.css': 'd2ea560788ecb0057235649740060f8e6fbb0495b65017913d39193397cd3da3', 'assets/PurchasePage-BxVy_kHJ.js': 'da26fe21b6d46ab8b84015dc4e5fcb5e70b84360b946df8632da0c6234f557dd', 'assets/QuotesPage-DDVRdRl_.css': 'd9351cb3c2d4e8e5a76d947bf0e9731bac2260fb7b9abe8733daf9b3df4bbcbd', 'assets/QuotesPage-DLTn7YG6.js': '1e700228c5b3572938e167f1d2840f48945c15816e95c5f9c78669caf6dc767b', 'assets/ReloadOutlined-4dzqa3Ij.js': '3f070d4231f5d7ce5325bb8c90ce68a716c29f26f8e1e0398ad18a659c860fd8', 'assets/SchedulesPage-DKKn4xJL.js': '16010007ac69dfafca55ff449cfd736f448dfa4bc6b910d212fcf819fb238082', 'assets/ShipmentsPage-COssvjuP.css': 'f0913b15ddcbe7cba9c5265c636c4ad69d64ad59f22c002c8076dc29059a127b', 'assets/ShipmentsPage-Q6EIhx_5.js': '5a93f319b80d36a64d789654696d2b7b786992419c33259ba2f61b0d78919114', 'assets/SupplierProfileEditor-CkbV4NtT.js': '38ee798bdd0c84360c325fee621e64b0f19dea9cf54f3c41012a1a572dab8e0f', 'assets/SupplierSummaryPage-BirjdQYs.js': 'ee3c275ad85b2dc5c4c28810a89bad45d680ab6c503348d8fda3af1bbee40dc4', 'assets/ToolMaterialsPage-CjzUd56c.js': '7e65d924bfae88ae272aea64cfb89e97d15f55b7feca1d37bbd4d830a4e16116', 'assets/UsersPage-DKnyXq1I.js': '1da36923f3e369b18e02cfc03a01801f62b714ef712abd30e49394b69b365056', 'assets/auto-complete-OBX4jwDS.js': '7d27d675eaf3c63d4cb8a0f9a76075b921db35508c6a269f2f5abcc1d77939d3', 'assets/chunk-BVpWp9h4.js': 'd68000f91e617e39707775fbbf502ae057f963da84e1d06dd6129df60614fb8a', 'assets/client-S6mPGKVM.js': '0619bdac1ca199b0cd07d9d54bd7a4c7e2320ac4fd6e6db5fe8a413b8c02838a', 'assets/customsExport-Dbz8c6Lz.js': '84a1848a2d47e0dbb8dc450278cbf3fa3ee7ed539510adac3f1286076bbafbe3', 'assets/date-picker-Bx-rsx87.js': '1786041443f973b85cc43b5ff7a8e400c53c768ad5a639a2a5d9b721f2d1da76', 'assets/engineeringImport-BdBr4WS3.js': 'a3c38d8bae8417f8691f6b10c72aec1bf974356485d6ca5f702761988a2c0a1e', 'assets/form-CqOO38q0.js': '58f9d02cb754d0e22438b24b48bf8f3a944373ae1eba7c0690df5bb36b5d87a2', 'assets/grid-B48L62wM.js': '91abbc7ffc80abe5075ea2aae53d8bb4ea2d58403d22ba4d3df1beecd98a5031', 'assets/imageUpload-DgJ9GzqX.js': '2ae7e23008960198e74d812c83429f8845cc5a7fe0e509b9cf5248c9244f35fb', 'assets/index-CqDsGiiC.js': '2e71c6443a4733373fe674b0eebaed08a2734114089d3d65b443318286873fee', 'assets/index-Tu04tXLf.css': '52155b5185a7b6e40e4220a5ca913de309663c04263c268cdb46d630b2114f06', 'assets/input-CXl0CrxM.js': '25e158d41520991da9483332d71a6d82274b492b067cb61ae6e8b1db4ddc4e49', 'assets/input-number-CC_vC4xv.js': 'dd27ed0a354695df30ee6c95c3424f57cb580eccfb0e4a58c054478e93a57756', 'assets/jsx-runtime-CPIq3nuo.js': 'd2ea580ed7e6f97b65ce1f80560677bfcbab839e64ddeed93044accd603de09a', 'assets/modal-DMPi3kjn.js': '52dac29d718d8e913e2d40cf1a3554fa5b570e1982bfeed7266c24a70ea88e5f', 'assets/moldingPoExport-DskrH8Av.js': '94274fed5b9e9e6d8fe02791d57b282eb4f5939b44221055c93261901164bdc5', 'assets/pagination-LhGL_5kc.js': '2282ab0540887d8564f54ab3dc0ebbb2a071fa58a9fa22037b8e0ef4dd6a68e9', 'assets/popconfirm-16_CnxHi.js': 'f7638ea0d17c39b3b087d165ba6cf38453553e573b4cee230d6ebfc70ac5f914', 'assets/progress-CJwc4b9M.js': '8d31d7000dc848498c19bfaff18d76702f007d327b1b8f789f61dc687dd66bd1', 'assets/row-Dk9Kqh3x.js': '209b8965ca863b98d3fc16f93249fbf2cb7c75ee715a0a27b7cf07610d28420a', 'assets/scheduleImport-D1nq1GIV.js': 'b387f3b8ed16102b34ebb907197ecb0ebbe267974eb0cbca201b8a50bad55932', 'assets/scheduleLineStatus-DhsZTTpa.js': '9d27284a276d471be9a420d812a7f689bbaad3765a206c6c27dceeb594da42ad', 'assets/shipmentDates-8JdCyfYa.js': 'd681676cc7c80450824a7b40022c9f870dbde86a8378c5b69a72cf30aea027a4', 'assets/spin-N1N-gDTY.js': '59c0d5f6333af35f664aa80a2c951afad3984b62bc70dd6a5d035782ad49a310', 'assets/supplierProfiles-DdACjIXN.js': '52db3c57474848d19f0cbc130afb9628d268ce6903a35050d192041268f78870', 'assets/switch-cHCC8vmb.js': '5cce03714ee315742df2528ff937536851f8738e464718d27f6ff50de5cb1e2a', 'assets/table-B8V-lKm1.js': '648d147e443d3eb7d5fac34e6054f4a6f197c172785b5928489fe7cb256bcb0d', 'assets/toolImportDefaults-Ca36OLkA.js': 'a2e933bb3d5f2a90978c12084c5477de4697fe6fa224e7ab60c788cd78810a2d', 'assets/useForm-Bk0qN2Jh.js': '2f3fb45e485cbad0abb2b386f35134e59744d63fc7f7153abf809283ac2dfc56', 'assets/xlsx-CGtpuIau.js': '768312094736c47185e84a085235cff804c378eba126a425fa5153e221e78e5d', 'assets/xlsx.min-DqAMbf-a.js': 'e2c2a477cfde2c9a1301515a0e1b73b28f2f70ddeaf262042e24ef4292d1f275', 'favicon.svg': '61bc9a161de58248288e6905425d7180f0624c2865007b97d763fdac12043a66', 'icons.svg': 'b45fa506195cfcdef406ba9f0c77b36ddc1a7c224040926ec70abc2fdea7b93a', 'index.html': 'fa2b7f555596f277c5d28b3c850ac7cd0f3848d52d377d8d3473b655266d65eb', 'template-customs-rri.xlsx': 'cb37324b0b4d659d55a8b2ddf012f0b6bbef8b1ee7f368448b3e0ad0fff23647', 'template-customs-rrm.xlsx': '21fa65679165883c8ed9f100af96c581d79a35da9644464548c765e10f1d2984', 'template-customs.xlsx': '24ea412592b3b656a872950c8a3985813fb3dd647c26df495bc882791e9bcaf6'}

def need(v,label):
 global STAGE
 STAGE=label
 if not v:raise RuntimeError(label)
def enc(v):return json.dumps(v,sort_keys=True,separators=(',',':'),ensure_ascii=True,allow_nan=False).encode()
def sha(v):return hashlib.sha256(v).hexdigest()
def private(v):
 fd=os.open(OUT/'result.private.json',os.O_CREAT|os.O_EXCL|os.O_WRONLY|os.O_NOFOLLOW,0o600)
 with os.fdopen(fd,'wb')as f:f.write(enc(v));f.flush();os.fsync(f.fileno())

def safe_read(p,limit=4*1024**2):
 need(not any(x.is_symlink()for x in(p,*p.parents)),'fixed-evidence-path-no-symlink')
 fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW)
 try:
  a=os.fstat(fd);need(stat.S_ISREG(a.st_mode)and 0<=a.st_size<=limit,'bounded-private-regular-evidence')
  b=b''
  while True:
   chunk=os.read(fd,65536)
   if not chunk:break
   b+=chunk;need(len(b)<=limit,'bounded-evidence-read')
  z=os.fstat(fd);key=lambda s:(s.st_dev,s.st_ino,s.st_uid,s.st_gid,s.st_mode,s.st_size,s.st_mtime_ns,s.st_ctime_ns)
  need(key(a)==key(z)==key(p.lstat())and len(b)==a.st_size,'stable-evidence-file')
  return b
 finally:os.close(fd)

def command(args):
 r=subprocess.run(args,cwd=ROOT,capture_output=True,timeout=30)
 need(len(r.stdout)<=8192 and len(r.stderr)<=8192,'bounded-readonly-command-output')
 return r

def safe_relative(v):
 return type(v)is str and bool(v)and str(pathlib.PurePosixPath(v))==v and not pathlib.PurePosixPath(v).is_absolute()and '..'not in pathlib.PurePosixPath(v).parts and '\\'not in v and all(ord(c)>=32 for c in v)

def public_name(v):
 return safe_relative(v)and(v in('index.html','favicon.svg','icons.svg','template-customs.xlsx','template-customs-rri.xlsx','template-customs-rrm.xlsx')or re.fullmatch(r'assets/[A-Za-z0-9_.,@-]+[.](?:js|css|svg|woff2?|ttf|png|jpe?g|gif|webp)',v)is not None)

def record(p,limit=64*1024**2):
 need(not any(x.is_symlink()for x in(p,*p.parents)),'fixed-public-archive-file-no-symlink');fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW)
 try:
  a=os.fstat(fd);need(stat.S_ISREG(a.st_mode)and 0<=a.st_size<=limit,'bounded-public-archive-file');h=hashlib.sha256();size=0
  while True:
   b=os.read(fd,1024**2)
   if not b:break
   size+=len(b);need(size<=limit,'bounded-public-streamed-hash');h.update(b)
  z=os.fstat(fd);key=lambda s:(s.st_dev,s.st_ino,s.st_uid,s.st_gid,s.st_mode,s.st_size,s.st_mtime_ns,s.st_ctime_ns);need(key(a)==key(z)==key(p.lstat())and size==a.st_size,'stable-public-archive-file');return{'sha256':h.hexdigest(),'bytes':size}
 finally:os.close(fd)

def static_inventory(name,manifest):
 need(name in('prepared-wwwroot','old-wwwroot'),'only-two-fixed-public-asset-directories');root=FAILED/name;need(root.is_dir()and not root.is_symlink(),'fixed-public-archive-directory');result={};total=0;count=0
 for parent,directories,files in os.walk(root,followlinks=False):
  count+=1;need(count<=1000,'bounded-public-directories')
  for d in directories:
   path=pathlib.Path(parent)/d;need(path.is_dir()and not path.is_symlink(),'regular-public-directory')
  for n in files:
   path=pathlib.Path(parent)/n;relative=path.relative_to(root).as_posix();need(public_name(relative),'only-known-public-asset-name');row=record(path);total+=row['bytes'];need(total<=256*1024**2 and len(result)<1000,'bounded-public-static-inventory');key=name+'/'+relative;need(manifest.get(key)==row['sha256'],'original-public-file-manifest-seal');result[relative]=row
 need('index.html'in result and all(n in result for n in('template-customs.xlsx','template-customs-rri.xlsx','template-customs-rrm.xlsx')),'index-and-three-restored-templates-present');expected={n.removeprefix(name+'/')for n in manifest if n.startswith(name+'/')};need(set(result)==expected,'all-original-sealed-public-files-still-present-no-extra');return result

def diff(actual,expected):
 a={n:v['sha256']for n,v in actual.items()};need(all(public_name(n)and re.fullmatch('[a-f0-9]{64}',v)for n,v in expected.items()),'public-only-root-reviewed-expected-build-manifest')
 return{'missingExpectedFiles':sorted(set(expected)-set(a)),'additionalActualFiles':sorted(set(a)-set(expected)),'changedSamePathFiles':[{'path':n,'expectedSHA256':expected[n],'actualSHA256':a[n]}for n in sorted(set(a)&set(expected))if a[n]!=expected[n]],'matchingSamePathCount':sum(a[n]==expected[n]for n in set(a)&set(expected))}

def archive():
 raw=safe_read(FAILED/'manifest.json',16*1024**2);need(sha(raw)==MANIFEST_SHA256,'exact-failed-r2-manifest');m=json.loads(raw);need(type(m)is dict and 0<len(m)<=100000 and all(safe_relative(k)and type(v)is str and re.fullmatch('[a-f0-9]{64}',v)for k,v in m.items()),'bounded-safe-private-manifest-in-memory-only')
 r=json.loads(safe_read(FAILED/'result.private.json'));inner=dict(r);inner.pop('resultSHA256',None);need(r['resultSHA256']==FAILED_RESULT_INNER_SHA256==sha(enc(inner))and r['success']is False and r['phase']=='prepare'and r['stage']=='actual-cloud-build-equals-root-reviewed-local-build-manifest'and r['head']==HEAD and r['target']==TARGET and r['manifestSHA256']==MANIFEST_SHA256,'exact-source-bound-failed-r2-result');return m

def source_versions(manifest):
 root=FAILED/'source'/APP/'web';result={}
 for n in('package.json','package-lock.json'):
  p=root/n;body=safe_read(p,4*1024**2);key='source/'+APP+'/web/'+n;need(manifest.get(key)==sha(body),'sealed-public-source-package-file');value=json.loads(body);need(type(value)is dict,'public-package-object')
  if n=='package-lock.json':
   packages=value.get('packages');need(type(packages)is dict,'modern-public-lock-packages');versions={}
   for dependency in('vite','rollup','esbuild','typescript','@vitejs/plugin-react','react','react-dom'):
    row=packages.get('node_modules/'+dependency);version=row.get('version')if type(row)is dict else None;need(version is None or type(version)is str and re.fullmatch('[0-9A-Za-z.+_-]{1,80}',version),'bounded-public-dependency-version');versions[dependency]=version
   lock_version=value.get('lockfileVersion');need(type(lock_version)is int and 0<lock_version<10,'typed-public-lock-format');result[n]={'sha256':sha(body),'lockfileVersion':lock_version,'versions':versions}
  else:
   engines=value.get('engines')or{};node=engines.get('node');manager=value.get('packageManager');need(node is None or type(node)is str and len(node)<=128 and re.fullmatch('[0-9A-Za-z.+_~^<>=| -]+',node),'bounded-public-node-engine');need(manager is None or type(manager)is str and re.fullmatch('[0-9A-Za-z.+_@:-]{1,128}',manager),'bounded-public-package-manager');result[n]={'sha256':sha(body),'nodeEngine':node,'packageManager':manager}
 return result

def inspect_image(name):
 need(name in(ALIAS,FRONTEND_TAG),'only-fixed-image-tag-inspection');r=command(['docker','image','inspect',name]);need(r.returncode==0,'existing-fixed-image-tag-readable');values=json.loads(r.stdout);need(type(values)is list and len(values)==1,'one-fixed-image-inspect');v=values[0];need(type(v['Id'])is str and re.fullmatch('sha256:[a-f0-9]{64}',v['Id']),'typed-fixed-image-id')
 return{'id':v['Id'],'architecture':v['Architecture'],'os':v['Os'],'created':v['Created'],'rootFSInventorySHA256':sha(enc(v['RootFS']))}

def runtime():
 r=command(['docker','inspect','--format',FORMAT,CID]);need(r.returncode==0,'fixed-target-minimal-runtime-readable');v=json.loads(r.stdout);need(set(v)=={'id','image','running','oom','health','pid','started','restarts'}and v['id']==CID and v['image']==IMAGE and v['started']==STARTED and type(v['pid'])is int and v['pid']==PID and v['running']is True and v['oom']is False and v['health']=='healthy'and type(v['restarts'])is int and v['restarts']==0,'same-fixed-running-indo-process');return v

def live_index():
 r=command(['docker','exec','--user','0',CID,'sha256sum','--','/app/wwwroot/index.html']);need(r.returncode==0,'readonly-live-index-hash-readable');match=re.fullmatch(rb'([a-f0-9]{64})  /app/wwwroot/index[.]html\n',r.stdout);need(match is not None,'fixed-public-index-sha-format');return match[1].decode()

def references(manifest):
 p=FAILED/'prepared-wwwroot/index.html';body=safe_read(p,1024**2);need(sha(body)==manifest['prepared-wwwroot/index.html'],'sealed-public-index-for-static-reference-check');text=body.decode('utf-8');refs=[]
 for raw in re.findall(r'(?:src|href)=["\']([^"\']+)["\']',text):
  need(raw.startswith('/indo-shipping/')and'?'not in raw and'#'not in raw,'same-base-static-index-reference-only');relative=urllib.parse.unquote(raw[len('/indo-shipping/'):]);need(public_name(relative),'known-public-reference-name');need(relative not in refs,'unique-public-index-reference');refs.append(relative)
 return refs

def wire(v):
 raw=enc(v);need(len(raw)<=4*1024**2,'bounded-numeric-receipt');nib=lambda x:[int(c,16)for c in(format(x,'x')if type(x)is int else x)];parts=[raw[i:i+1024]for i in range(0,len(raw),1024)];digest=nib(sha(raw))
 for i,b in enumerate(parts):print(enc([0,nib(i+1),nib(len(parts)),nib(len(raw)),digest,nib(b.hex())]).decode(),flush=True)
 print(enc([1,nib(len(parts)),nib(len(raw)),digest]).decode(),flush=True)

def main():
 need(EXECUTE is True and sys.argv[1:]==['diagnose']and os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_MODE')=='diagnose'and os.environ.get('RELEASE_ATTEMPT')=='1','inert-first-readonly-build-mismatch-diagnosis');os.umask(0o077);need(OUT.parent.is_dir()and not any(p.is_symlink()for p in(OUT.parent,*OUT.parent.parents))and not OUT.exists()and not OUT.is_symlink(),'fresh-own-build-diagnostic-output');OUT.mkdir(mode=0o700)
 v={'phase':'diagnose','mode':'diagnose','service':'indo-shipping','success':False,'readOnly':True,'fetchOrCheckoutOrReplayPerformed':False,'imageCreateStartOrBuildPerformed':False,'databaseReadOrWritten':False,'configurationOrEnvironmentRead':False,'arbitraryPrivateOutputIncluded':False}
 try:
  before=runtime();m=archive();actual=static_inventory('prepared-wwwroot',m);old=static_inventory('old-wwwroot',m);v.update(failedManifestSHA256=MANIFEST_SHA256,originalFailureStage='actual-cloud-build-equals-root-reviewed-local-build-manifest',actualPreparedManifest=actual,actualPreparedManifestSHA256=sha(enc(actual)),actualPreparedFileCount=len(actual),actualPreparedTotalBytes=sum(x['bytes']for x in actual.values()),expectedManifestSHA256=sha(enc(EXPECTED_NEW_MANIFEST)),buildDifferences=diff(actual,EXPECTED_NEW_MANIFEST),oldIndex=old['index.html'],oldStaticFileCount=len(old),oldStaticManifestSHA256=sha(enc(old)),publicSourceVersions=source_versions(m));v['indexReferences']=references(m);need(all(n in actual for n in v['indexReferences']),'all-built-index-references-present');v['frontendImage']=inspect_image(FRONTEND_TAG);v['canonicalImage']=inspect_image(ALIAS);need(v['canonicalImage']['id']==CANONICAL,'original-canonical-image-still-unmodified');v['liveIndexSHA256']=live_index();need(v['liveIndexSHA256']==old['index.html']['sha256'],'old-public-static-index-still-live');v['runtime']=before
  r=command(['docker','info','--format','{{json .DockerRootDir}}']);need(r.returncode==0,'docker-storage-root-readable');root=json.loads(r.stdout);need(type(root)is str and pathlib.Path(root).is_absolute(),'typed-docker-root-for-space-only');space=os.statvfs(root);v['space']={'available':space.f_bavail*space.f_frsize,'free':space.f_bfree*space.f_frsize};need(runtime()==before and inspect_image(FRONTEND_TAG)==v['frontendImage']and inspect_image(ALIAS)==v['canonicalImage'],'runtime-and-images-unchanged-through-readonly-diagnosis');v['success']=True
 except Exception as e:v.update(errorType=type(e).__name__,stage=STAGE)
 v['utc']=datetime.datetime.now(datetime.timezone.utc).isoformat();v['resultSHA256']=sha(enc(v));private(v);wire(v);return 0 if v['success']else 1

if __name__=='__main__':sys.exit(main())

