"""Inert selected sealed writable-layer classification; no Docker/SQL/key contents."""
import ast,hashlib,json,os,pathlib,re,stat,sys
EXECUTE=False
TARGET='70590f6d0dc1c691cfcc7c6b85c67e4a3574e571'
BRANCH='refs/heads/ops/pr-1027-clone-diagnostic-20261028'
PREPARE=pathlib.Path('/opt/rr-portal/deploy/backups/pr1027-1029-indo-20261028-r4/prepare')
OUT=pathlib.Path('/opt/rr-portal/deploy/backups/pr1027-r4-layer-rejection-diagnostic-1')
MANIFEST_SHA256='acb5e1e323f56daa46aaa51ceaeea7367b6cdbf1448c399d495204ecd17aa893'
RESULT_SHA256='370cddd30f7ff76a74f39cfbf0dc223ecc49aa5c0860db7723f9468fd3e6bdce'
GUARD_SHA256='e60300452ec9156e2c416d0c02a0ccd3a44852ff0a32d70bb4dbb977ba418abe'
GUARD_SOURCE="def writable_layer_guard(lines,keyring,static_names):\n need(type(lines)is list and len(lines)<=1000 and type(static_names)is set,'bounded-original-writable-layer');directories={str(p)for n in static_names for p in pathlib.PurePosixPath(n).parents if str(p)!='.'}\n for line in lines:\n  match=re.fullmatch(r'([ACD]) (/[^\\r\\n]+)',line);need(match is not None,'canonical-diff-line');action,p=match[1],match[2]\n  if p=='/tmp'or p.startswith('/tmp/'):continue\n  if p in{'/home','/home/app','/app','/app/wwwroot','/app/wwwroot/assets'}:need(action=='C','only-known-existing-ancestor-metadata');continue\n  relative=p[len('/home/app/'):]if p.startswith('/home/app/')else''\n  if action in{'A','C'}and relative in keyring['entries']:continue\n  if action in{'A','C'}and p.removeprefix('/app/')in(static_names|directories)and p.startswith('/app/wwwroot/'):continue\n  stage=re.fullmatch(r'/app/\\.(?:pr(?:1007|1016|1020)-static-[a-f0-9]{40}|pr1023-priority-static-09b09cbf21b2dfb8518c58860fa33237d2123ed5)(?:/(.*))?',p)\n  if stage and action in{'A','C'}:\n   tail=stage[1]or'';need(tail in{'','new','old-index'}or tail.startswith('new/')and 'wwwroot/'+tail[4:]in(static_names|directories),'only-verified-public-prior-static-stage');continue\n  need(False,'unbacked-writable-path-outside-keys-static-and-tmp')"
STAGE='entry'
SYSTEM={'/','/app','/home','/home/app','/home/app/.aspnet','/home/app/.dotnet','/root','/root/.dotnet','/tmp','/app/wwwroot','/app/wwwroot/assets'}
def need(v,label):
 global STAGE
 STAGE=label
 if not v:raise RuntimeError(label)
def enc(v):return json.dumps(v,sort_keys=True,separators=(',',':'),ensure_ascii=True,allow_nan=False).encode()
def sha(v):return hashlib.sha256(v).hexdigest()
def raw(path,limit):
 need(not any(p.is_symlink()for p in(path,*path.parents)),'real-selected-private-evidence');fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
 try:
  a=os.fstat(fd);need(stat.S_ISREG(a.st_mode)and a.st_mode&0o077==0 and 0<=a.st_size<=limit,'bounded-private-static-evidence');parts=[];size=0
  while True:
   b=os.read(fd,1024**2)
   if not b:break
   parts.append(b);size+=len(b);need(size<=limit,'bounded-selected-read')
  body=b''.join(parts);z=os.fstat(fd);key=lambda s:(s.st_dev,s.st_ino,s.st_mode,s.st_uid,s.st_gid,s.st_size,s.st_mtime_ns,s.st_ctime_ns);need(key(a)==key(z)==key(path.lstat())and len(body)==a.st_size,'stable-selected-byte-seal');return body
 finally:os.close(fd)
def describe(line,static_names):
 match=re.fullmatch(r'([ACD]) (/[^\r\n]+)',line);p=match[2]if match else None;v={'action':match[1]if match else'unknown','pathSHA256':sha((p if p is not None else line).encode()),'pathClass':'invalid-line','depth':None,'suffixClass':'none'}
 if p is None:return v
 directories={str(q)for n in static_names for q in pathlib.PurePosixPath(n).parents if str(q)!='.'};stage=re.fullmatch(r'/app/\.pr[0-9]{1,8}-[A-Za-z0-9][A-Za-z0-9-]{0,79}-[a-f0-9]{40}(?:/(.*))?',p)
 public=p in SYSTEM or p.startswith('/app/wwwroot/')and p.removeprefix('/app/')in(static_names|directories)or stage is not None and(stage[1]or'')in{'','new','old-index'}or stage is not None and(stage[1]or'').startswith('new/')and 'wwwroot/'+stage[1][4:]in(static_names|directories)
 if re.search(r'[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}',p):public=False
 if public:v['path']=p
 classes=(('/home/app/.aspnet','data-protection'),('/home/app/.dotnet','home-app-dotnet'),('/root/.dotnet','root-dotnet'),('/app/wwwroot','app-public'),('/app/.pr','public-pr-artifact'),('/app','app-other'),('/home','home-other'),('/root','root-other'),('/tmp','temporary'),('/etc','etc-system'),('/var','var-system'))
 v['pathClass']=next((label for prefix,label in classes if p==prefix or p.startswith(prefix+'/')or prefix=='/app/.pr'and p.startswith(prefix)),'other-system');v['depth']=len(pathlib.PurePosixPath(p).parts)-1;suffix=pathlib.PurePosixPath(p).suffix.lower();v['suffixClass']=suffix if suffix in{'.json','.xml','.dll','.pdb','.sql','.js','.css','.txt','.dat','.db','.sqlite','.xlsx','.gz','.tar','.zip','.cache','.lock','.log'}else'other'if suffix else'none';return v
def classify(lines,keyring,static_names):
 need(type(lines)is list and len(lines)<=1000 and all(type(x)is str and len(x)<=16384 for x in lines),'bounded-sealed-diff-lines');need(type(keyring)is dict and type(keyring.get('entries'))is dict and type(static_names)is set,'only-sealed-keyring-and-static-paths')
 need(sha(GUARD_SOURCE.encode())==GUARD_SHA256,'exact-reviewed-r4-pure-guard-source');tree=ast.parse(GUARD_SOURCE);need(len(tree.body)==1 and isinstance(tree.body[0],ast.FunctionDef)and tree.body[0].name=='writable_layer_guard','single-reviewed-pure-function')
 def guard_need(v,label):
  if not v:raise RuntimeError(label)
 scope={'__builtins__':{'type':type,'list':list,'len':len,'set':set,'str':str},'need':guard_need,'re':re,'pathlib':pathlib};exec(compile(tree,'<fixed-reviewed-R4-guard>','exec'),scope);rejected=[]
 for index,line in enumerate(lines,1):
  try:scope['writable_layer_guard']([line],keyring,static_names)
  except RuntimeError as e:
   label=str(e);need(label in{'bounded-original-writable-layer','canonical-diff-line','only-known-existing-ancestor-metadata','only-verified-public-prior-static-stage','unbacked-writable-path-outside-keys-static-and-tmp'},'fixed-guard-rejection-category');rejected.append({'lineIndex':index,'reason':label,**describe(line,static_names)})
 return {'totalLineCount':len(lines),'acceptedCount':len(lines)-len(rejected),'rejectedCount':len(rejected),'rejections':rejected,'guardSourceSHA256':GUARD_SHA256}
def main():
 need(EXECUTE is True and sys.argv[1:]==['diagnose']and os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_MODE')=='diagnose'and os.environ.get('RELEASE_ATTEMPT')=='1'and re.fullmatch('[a-f0-9]{40}',TARGET),'inert-first-readonly-sealed-classification')
 os.umask(0o077);need(OUT.parent.is_dir()and not OUT.parent.is_symlink()and not OUT.exists()and not OUT.is_symlink(),'fresh-own-private-output');OUT.mkdir(mode=0o700);v={'phase':'diagnose','target':TARGET,'success':False,'readOnly':True,'selectedSealedEvidenceOnly':True,'dockerSqlOrLifecycleUsed':False,'wholeMutableArchiveSealClaimed':False}
 try:
  m=raw(PREPARE/'manifest.json',16*1024**2);f=raw(PREPARE/'result.private.json',16*1024**2);need(sha(m)==MANIFEST_SHA256 and sha(f)==RESULT_SHA256,'fixed-r4-failure-byte-seals');manifest=json.loads(m);failure=json.loads(f);need(failure['success']is False and failure['phase']=='prepare'and failure['target']==TARGET and failure['stage']=='unbacked-writable-path-outside-keys-static-and-tmp','fixed-r4-layer-failure-context')
  names=[n for n in manifest if re.fullmatch(r'writable-layer-[0-9]+[.]private[.]json',n)];need(len(names)==1,'one-fixed-sealed-writable-layer-json');selected={}
  for name in(names[0],'online-before/capture.private.json','frozen-old-source-proof.private.json'):
   body=raw(PREPARE/name,64*1024**2);need(name in manifest and sha(body)==manifest[name],'selected-layer-keyring-static-json-byte-seals');selected[name]=json.loads(body)
  keyring=selected['online-before/capture.private.json']['keyring'];inventory=selected['frozen-old-source-proof.private.json']['compiledArtifactInventory'];need(type(inventory)is dict and 0<len(inventory)<=1000,'bounded-static-inventory');v['classification']=classify(selected[names[0]],keyring,set(inventory));v['success']=True
 except Exception as e:v.update(errorType=type(e).__name__,stage=STAGE)
 v['resultSHA256']=sha(enc(v));v['sha256Wire']={'target':[int(c,16)for c in TARGET]};fd=os.open(OUT/'result.private.json',os.O_CREAT|os.O_EXCL|os.O_WRONLY|os.O_NOFOLLOW,0o600)
 with os.fdopen(fd,'wb')as output:output.write(enc(v));output.flush();os.fsync(output.fileno())
 print(json.dumps(v,sort_keys=True),flush=True);return 0 if v['success']else 1
if __name__=='__main__':sys.exit(main())
