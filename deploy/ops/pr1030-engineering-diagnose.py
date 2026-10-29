"""INERT: inspect sealed failed prepare evidence only; no command/lifecycle retry."""
import hashlib,json,os,pathlib,re,stat,sys
ROOT=pathlib.Path('/opt/rr-portal')
ARCHIVE=ROOT/'deploy/backups/pr1030-engineering-20261029/prepare'
OUT=ROOT/'deploy/backups/pr1030-engineering-prepare-diagnostic-1'
MANIFEST_SHA256='90282d32240e4e13dfca997b523202bb33faf63ae46d4b610150e1edc21d7a6d'
RESULT_SHA256='43abc8c275ea8aeec576122053d2197be2d7202d009bff32ba9d280c2f949b6e'
BRANCH='refs/heads/ops/pr-1030-1033-20261029-engineering'
EXECUTE=True
def need(v,label):
 if not v:raise RuntimeError(label)
def enc(v):return json.dumps(v,sort_keys=True,separators=(',',':'),ensure_ascii=True,allow_nan=False).encode()
def sha(b):return hashlib.sha256(b).hexdigest()
def safe(n):
 p=pathlib.PurePosixPath(n);return type(n)is str and bool(n)and str(p)==n and not p.is_absolute()and '..'not in p.parts and '\\'not in n and all(ord(c)>=32 for c in n)
def read(path,maximum=256*1024**2,private=False):
 fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
 try:
  a=os.fstat(fd);need(stat.S_ISREG(a.st_mode)and a.st_nlink==1 and a.st_size<=maximum,'bounded-regular-evidence-file');need(not private or(a.st_uid==0 and a.st_gid==0 and stat.S_IMODE(a.st_mode)==0o600),'root-private-command-file');parts=[];total=0
  while True:
   b=os.read(fd,1024**2)
   if not b:break
   parts.append(b);total+=len(b);need(total<=maximum,'bounded-file-read')
  z=os.fstat(fd);named=path.lstat();key=lambda s:(s.st_dev,s.st_ino,s.st_mode,s.st_uid,s.st_gid,s.st_size,s.st_mtime_ns,s.st_ctime_ns)
  need(key(a)==key(z)==key(named)and total==a.st_size,'stable-private-file');return b''.join(parts)
 finally:os.close(fd)
def redact(line):
 line=re.sub(r'([A-Za-z][A-Za-z0-9+.-]*://)[^\s/@]+(?::[^\s/@]*)?@',r'\1<userinfo-redacted>@',line)
 line=re.sub(r'([A-Za-z][A-Za-z0-9+.-]*://[^\s?]+)\?\S+',r'\1?<query-redacted>',line)
 line=re.sub(r'(?i)\bBearer\s+\S+','Bearer <redacted>',line)
 line=re.sub(r'''(?i)((?:[A-Za-z0-9_-]*(?:password|passwd|token|secret|cookie|authcode|authorization|api[_-]?key)[A-Za-z0-9_-]*)["']?\s*[:=]).*''',r'\1<redacted>',line)
 line=re.sub(r'[A-Za-z0-9_+/=-]{16,}','<long-token-redacted>',line)
 line=''.join(c if ord(c)>=32 and ord(c)!=127 else ' ' for c in line)
 return line[:700]
def diagnostic(body):
 value={'bytes':len(body),'sha256':sha(body)}
 if b'\0'in body:return dict(value,text=False,reason='binary-or-nul')
 try:text=body.decode('utf-8','strict')
 except UnicodeDecodeError:return dict(value,text=False,reason='invalid-utf8')
 lines=[s.strip()for s in text.splitlines()if s.strip()];error=re.compile(r'(?i)\b(?:error|failed|failure|fatal|exception|cannot|unable|denied|invalid|unknown|not found|no such|exit(?:ed)?|ENOENT|EACCES|ENOSPC|ETIMEDOUT|EAI_AGAIN)\b')
 found=[s for s in lines if error.search(s)][-10:]
 return dict(value,text=True,lastErrorLines=[redact(s) for s in found])
def main():
 need(EXECUTE is True and sys.argv[1:]==['diagnose']and os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_MODE')=='diagnose'and os.environ.get('RELEASE_ATTEMPT')=='1','explicit-first-readonly-diagnostic');os.umask(0o077)
 need(ARCHIVE.is_dir()and not any(p.is_symlink()for p in(ARCHIVE,*ARCHIVE.parents)),'fixed-real-failed-archive');raw=read(ARCHIVE/'manifest.json',4*1024**2,True);need(sha(raw)==MANIFEST_SHA256,'fixed-failed-manifest');manifest=json.loads(raw);need(type(manifest)is dict and all(safe(n)and type(h)is str and re.fullmatch('[a-f0-9]{64}',h)for n,h in manifest.items()),'typed-sealed-inventory')
 paths=list(ARCHIVE.rglob('*'));need(all(not p.is_symlink()and(p.is_file()or p.is_dir())for p in paths),'regular-complete-archive');need({p.relative_to(ARCHIVE).as_posix()for p in paths if p.is_file()and p!=ARCHIVE/'manifest.json'}==set(manifest),'complete-manifest-file-set')
 logs={};result=None
 for n,h in manifest.items():
  body=read(ARCHIVE/n);need(sha(body)==h,'every-prior-evidence-byte-sealed')
  if n=='result.private.json':need(sha(body)==RESULT_SHA256,'fixed-failed-result');need(read(ARCHIVE/n,private=True)==body,'private-failed-result');result=json.loads(body)
  match=re.fullmatch(r'(\d{3,})-(stdout|stderr)\.private',n)
  if match:logs.setdefault(int(match[1]),{})[match[2]]=n
 need(result and result.get('success')is False and result.get('errorType')=='RuntimeError'and result.get('stage')=='single-command-success-no-replay','exact-pre-lifecycle-failure');need(logs and all(set(v)=={'stdout','stderr'}for v in logs.values()),'paired-private-command-evidence')
 selected=sorted(logs)[-3:];rows=[]
 for serial in selected:rows.append({'serial':serial,**{kind:diagnostic(read(ARCHIVE/logs[serial][kind],private=True))for kind in('stdout','stderr')}})
 need(OUT.parent.is_dir()and not OUT.parent.is_symlink()and not OUT.exists()and not OUT.is_symlink(),'fresh-private-diagnostic-output');OUT.mkdir(mode=0o700);value={'success':True,'readOnly':True,'lifecycleOrConfigOrBusinessWrites':False,'mode':'diagnose','manifestSHA256':MANIFEST_SHA256,'failedResultSHA256':RESULT_SHA256,'lastThreeCommands':rows};value['resultSHA256']=sha(enc(value));fd=os.open(OUT/'result.private.json',os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
 with os.fdopen(fd,'wb')as f:f.write(enc(value));f.flush();os.fsync(f.fileno())
 print(enc(value).decode(),flush=True)
if __name__=='__main__':main()
