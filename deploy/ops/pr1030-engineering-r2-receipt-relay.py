"""INERT, read-only relay of exactly one sealed successful prepare receipt."""
import hashlib,json,pathlib,stat,sys
EXECUTE=False
PHASE=pathlib.Path('/opt/rr-portal/deploy/backups/pr1030-engineering-20261029-r2/prepare')
EXPECTED='777f648373df1dc66d407b42e154c884a4f148a2de6de2deb3bdfa7453421e12'
TARGET='91178c35b2013d32dc02808ece1d81924d567d0d';TREE='2658ba6fcdcf656201d75847a9abc6c70f44849d';APP_TREE='ff7afc1432e3bbc72ad708233fc7cae5bf2685ba'
def need(v):
 if not v:raise RuntimeError('sealed-receipt-relay-rejected')
def enc(v):return json.dumps(v,sort_keys=True,separators=(',',':'),ensure_ascii=True,allow_nan=False).encode()
def sha(b):return hashlib.sha256(b).hexdigest()
def file_sha(p):
 h=hashlib.sha256()
 with p.open('rb')as f:
  for b in iter(lambda:f.read(1024**2),b''):h.update(b)
 return h.hexdigest()
def nib(v):return [int(x,16)for x in(format(v,'x')if type(v)is int else v)]
def main():
 need(EXECUTE is True and sys.argv[1:]==['prepare-receipt-relay'])
 need(all(p.is_dir() and not p.is_symlink() for p in(PHASE,*PHASE.parents)))
 names=list(PHASE.rglob('*'));need(all(not p.is_symlink() and (p.is_dir() or p.is_file())for p in names))
 for n in('manifest.json','result.private.json'):
  s=(PHASE/n).lstat();need(stat.S_ISREG(s.st_mode)and s.st_uid==s.st_gid==0 and stat.S_IMODE(s.st_mode)==0o600 and s.st_size<=4*1024**2)
 mb=(PHASE/'manifest.json').read_bytes();mf=json.loads(mb);need(type(mf)is dict and mb==enc(mf))
 need({p.relative_to(PHASE).as_posix()for p in names if p.is_file()and p!=PHASE/'manifest.json'}==set(mf))
 for n,h in mf.items():
  p=pathlib.PurePosixPath(n);need(type(n)is str and str(p)==n and bool(n) and not p.is_absolute()and '..'not in p.parts and '\\'not in n and all(ord(x)>=32 for x in n)and type(h)is str and len(h)==64 and all(x in'0123456789abcdef'for x in h)and file_sha(PHASE/n)==h)
 rb=(PHASE/'result.private.json').read_bytes();v=json.loads(rb);need(rb==enc(v)and v['success']is True and v['phase']==v['mode']=='prepare'and(v['target'],v['tree'],v['appTree'])==(TARGET,TREE,APP_TREE)and v['resultPath']==str(PHASE/'result.private.json'))
 receipt=dict(v,resultSHA256=sha(rb),manifestSHA256=sha(mb),preparedSHA256=sha(mb));raw=enc(receipt);need(len(raw)==117614 and sha(raw)==EXPECTED)
 need((PHASE/'manifest.json').read_bytes()==mb and (PHASE/'result.private.json').read_bytes()==rb)
 chunks=[raw[i:i+1024]for i in range(0,len(raw),1024)];digest=nib(EXPECTED)
 for i,b in enumerate(chunks):print(enc([0,nib(i+1),nib(len(chunks)),nib(len(raw)),digest,nib(b.hex())]).decode(),flush=True)
 print(enc([1,nib(len(chunks)),nib(len(raw)),digest]).decode(),flush=True)
if __name__=='__main__':main()
