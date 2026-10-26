"""Inert, exact read of the successful original prepare archive; never rebuilds.

Only the fixed private PREPARE archive is read. Its original result is emitted
unchanged with non-secret SHA-256 metadata encoded as typed nibble arrays.
"""
import hashlib,json,os,pathlib,re,stat,sys,traceback
ROOT=pathlib.Path('/opt/rr-portal')
PREPARE=ROOT/'deploy/backups/pr-1008-20261026-02-prepare'
OUT=ROOT/'deploy/backups/pr-1008-20261026-02-prepare-seal-read'
BASE='37b6146354f692dfabc8b009f6c5b80ced091bdb'
TARGET='bb1fab660bdf4e04e828e4c4250279f717603ac5'
TREE='72baeafdefab7f2abf01be09f941f31ec8b623fa'
BRANCH='refs/heads/ops/pr-1008-20261026-02'
ORIGINAL_RESULT_SHA256='19b89c3480f1ea8d00da0f5ec67aa15e9b830711f679ba8a9c5e32fa45127a7e'
MANIFEST_KNOWN_PREFIX='aa2dcab5af382a7cedbc8efb27c025da97d69b28'
MANIFEST_KNOWN_SUFFIX='59273b979238cf2c44a6'
IMAGE='sha256:7cc8e9f25c895fe97f302357058a9ceb07ecc7c5a204ab53958a8ecfa8666684'
IMPLEMENTATION={'cloud/server.mjs':'1188ceb60a708c0ec2443e2f868a5aae79ba7ed031a158f8182ef473e03a9260','cloud/public/app.js':'2eb820c8ebe84b5ac863f8ef821d9e01bb1c7b64211b59388a011229b33b912a','cloud/public/style.css':'7af97b8c7ae31a840f803bd05c57fb2fb4965018219eff9da485a3cc35ae1116'}
PIN=False
STAGE='entrypoint'
def need(value,label):
 global STAGE
 if not value:STAGE=label;raise RuntimeError('PREPARE_SEAL_READ_REJECTED')
def enc(value):return json.dumps(value,ensure_ascii=True,sort_keys=True,separators=(',',':'),allow_nan=False).encode()
def sha(value):return hashlib.sha256(value).hexdigest()
def nibbles(value):
 need(type(value)is str and re.fullmatch('[a-f0-9]{64}',value)is not None,'typed-sha256-before-wire-encoding');return[int(c,16)for c in value]
def safe_name(value):
 return type(value)is str and bool(value)and not any(ord(c)<32 or c=='\\'for c in value)and not pathlib.PurePosixPath(value).is_absolute()and str(pathlib.PurePosixPath(value))==value and all(p not in{'','.','..'}for p in pathlib.PurePosixPath(value).parts)
def filehash(path):
 need(path.is_file()and not path.is_symlink(),'regular-private-file');fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW);h=hashlib.sha256()
 with os.fdopen(fd,'rb')as stream:
  a=os.fstat(stream.fileno());need(stat.S_ISREG(a.st_mode)and a.st_size<=32*1024**3,'bounded-private-file')
  for block in iter(lambda:stream.read(1024**2),b''):h.update(block)
  z=os.fstat(stream.fileno());key=lambda s:(s.st_dev,s.st_ino,s.st_mode,s.st_uid,s.st_gid,s.st_size,s.st_mtime_ns,s.st_ctime_ns);need(key(a)==key(z)==key(path.lstat()),'stable-file-through-hash')
 return h.hexdigest()
def regular(path,limit=32*1024**2):
 need(path.is_file()and not path.is_symlink()and path.stat().st_size<=limit,'bounded-regular-json-file');before=filehash(path);data=path.read_bytes();need(sha(data)==before==filehash(path),'stable-complete-private-json-read');return data
def private(name,value):
 need(re.fullmatch('[a-z0-9_.-]+',name)is not None,'fixed-private-output-name');data=value if type(value)is bytes else enc(value);fd=os.open(OUT/name,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
 with os.fdopen(fd,'wb')as stream:stream.write(data);stream.flush();os.fsync(stream.fileno())
def archive_entries():
 need(PREPARE.is_dir()and not PREPARE.is_symlink()and stat.S_IMODE(PREPARE.stat().st_mode)==0o700,'exact-private-prepare-directory');entries=list(PREPARE.rglob('*'));need(len(entries)<=100000 and all(not p.is_symlink()and(p.is_file()or p.is_dir())and p.stat().st_mode&0o077==0 for p in entries),'all-private-regular-original-prepare-entries');return{str(p.relative_to(PREPARE))for p in entries if p.is_file()}
def read_prepare():
 names=archive_entries();manifest_bytes=regular(PREPARE/'manifest.json');manifest_sha=sha(manifest_bytes);need(manifest_sha.startswith(MANIFEST_KNOWN_PREFIX)and manifest_sha.endswith(MANIFEST_KNOWN_SUFFIX),'computed-manifest-matches-exact-known-wire-prefix-and-suffix');manifest=json.loads(manifest_bytes);need(type(manifest)is dict and set(manifest)==names-{'manifest.json'}and all(safe_name(n)and type(h)is str and re.fullmatch('[a-f0-9]{64}',h)is not None and filehash(PREPARE/n)==h for n,h in manifest.items()),'complete-original-prepare-manifest-and-every-file-seal');raw=regular(PREPARE/'first-result.json');need(sha(raw)==ORIGINAL_RESULT_SHA256,'fixed-original-prepare-result-seal');r=json.loads(raw);need(enc(r)==raw,'original-result-canonical-bytes')
 booleans={'success':True,'businessWritesPerformed':False,'databaseRestorePerformed':False,'modelCallsPerformed':False,'authenticatedBusinessWritesPerformed':False,'otherServicesRequested':False,'secretOrRowsPrinted':False,'environmentConfigurationChanged':False,'candidatesBuiltBeforeAnyMaintenance':True,'all46OriginalContainersUnchanged':True,'environmentFileUnchanged':True};allowed=set(booleans)|{'mode','base','target','tree','images','targetContainerCount','otherContainerCount'};need(type(r)is dict and set(r)==allowed and r['mode']=='prepare'and r['base']==BASE and r['target']==TARGET and r['tree']==TREE and all(r[k]is v for k,v in booleans.items())and type(r['targetContainerCount'])is int and r['targetContainerCount']==1 and type(r['otherContainerCount'])is int and r['otherContainerCount']==45 and r['images']=={'printlink':IMAGE},'original-successful-safe-prepare-source-and-exact-image')
 p=json.loads(regular(PREPARE/'prepared.private.json'));need(p['target']==TARGET and p['tree']==TREE and p['images']==r['images']and set(p['proofs'])=={'printlink'}and all(p['proofs']['printlink'][n]=={'sha256':h,'mode':0o644}for n,h in IMPLEMENTATION.items()),'sealed-prepared-source-implementation-and-image-match');need(archive_entries()==names and regular(PREPARE/'manifest.json')==manifest_bytes and regular(PREPARE/'first-result.json')==raw,'original-prepare-archive-remains-identical-through-read');return r,nibbles(manifest_sha),nibbles(ORIGINAL_RESULT_SHA256)
def main():
 need(PIN is True and sys.argv[1:]==['read-prepare-seal']and os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_ATTEMPT')=='1','false-pin-or-wrong-invocation');os.umask(0o077);OUT.mkdir(mode=0o700);result={'mode':'prepare-seal-read','base':BASE,'target':TARGET,'tree':TREE,'success':False,'originalPrepareReadOnly':True,'buildOrRuntimeOrConfigurationChangesPerformed':False,'DBNetworkDockerSignalModelOrHTTPCallsPerformed':False}
 try:r,mh,rh=read_prepare();result.update(success=True,originalReceipt=r,originalManifestSHA256Nibbles=mh,originalResultSHA256Nibbles=rh,completeOriginalPrepareFileSealsVerified=True)
 except BaseException as error:result.update(success=False,safeFailureStage=STAGE,safeExceptionType=type(error).__name__);private('failure.private.txt',traceback.format_exc().encode())
 finally:
  private('first-result.json',result);manifest={str(p.relative_to(OUT)):filehash(p)for p in OUT.rglob('*')if p.is_file()};private('manifest.json',manifest);print(enc(dict(result,manifestSHA256Nibbles=nibbles(filehash(OUT/'manifest.json')),resultSHA256Nibbles=nibbles(filehash(OUT/'first-result.json')))).decode(),flush=True)
 return 0 if result['success']else 1
if __name__=='__main__':
 try:sys.exit(main())
 except SystemExit:raise
 except BaseException:print('{"mode":"prepare-seal-read","success":false,"safeFailure":"INERT_OR_OUTPUT_FAILURE"}',flush=True);sys.exit(1)
