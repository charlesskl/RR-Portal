import base64,datetime,hashlib,http.cookiejar,json,os,pathlib,secrets,sqlite3,subprocess,sys,time,urllib.request,urllib.error
os.umask(0o077)
ROOT=pathlib.Path('/opt/rr-portal')
DATA=ROOT/'apps/船务部/VoyagePlex船务协同系统/data-runtime'
DB=DATA/'voyageplex.db'
NAMES=['谭凤斌','秦湘柳','莫秀珍','麦淳恩']
ADDRESSES=['lisa666tan@163.com','hyt9833@163.com','13768947334@163.com','13471221956@163.com']
COMPOSE=['docker','compose','-f','docker-compose.cloud.yml','--env-file','.env.cloud.production']
def connect(readonly=True):
 return sqlite3.connect(DB.as_uri()+'?mode='+('ro' if readonly else 'rw'),uri=True,timeout=20)
def candidates():
 with connect() as c:
  c.row_factory=sqlite3.Row
  rows=[dict(r) for r in c.execute('SELECT Id,Username,DisplayName,Role,CompanyAccess,MailboxAddress,IsActive FROM Users')]
 return {name:[r for r in rows if name in r['DisplayName'] or name in r['Username']] for name in NAMES}
def resolve():
 data=candidates();result=[]
 for name,address in zip(NAMES,ADDRESSES):
  matches=data[name]
  if len(matches)!=1: raise RuntimeError('AMBIGUOUS_ACCOUNT:'+name)
  row=matches[0]
  expected='supervisor' if name==NAMES[0] else 'shipping'
  if not row['IsActive'] or row['Role']!=expected or row['CompanyAccess']!='Huadeng': raise RuntimeError('ACCOUNT_SCOPE_MISMATCH:'+name)
  result.append({**row,'expectedAddress':address})
 return result
try:
 mode=sys.argv[1]
 if mode=='inspect':
  print(json.dumps({'candidates':candidates()},ensure_ascii=False))
 elif mode=='backup':
  target=ROOT/'deploy/backups'/('voyageplex-pre-904-'+datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ'))
  target.mkdir(parents=True,mode=0o700)
  destination=target/'voyageplex.db'
  with connect() as source,sqlite3.connect(destination) as backup:
   source.backup(backup)
   if backup.execute('PRAGMA quick_check').fetchone()[0]!='ok': raise RuntimeError('BACKUP_INTEGRITY_FAILED')
  destination.chmod(0o600)
  env=(ROOT/'.env.cloud.production').read_bytes()
  (target/'env.before').write_bytes(env)
  (target/'env.before').chmod(0o600)
  import shutil
  keys=DATA/'mailbox-keys'
  if keys.exists(): shutil.copytree(keys,target/'mailbox-keys')
  digest=hashlib.sha256(destination.read_bytes()).hexdigest()
  print(json.dumps({'backup':str(target),'databaseIntegrity':'ok','databaseSha256':digest},ensure_ascii=False))
 elif mode in ['configure','verify']:
  raise RuntimeError('NOT_IMPLEMENTED_YET')
 else: raise RuntimeError('INVALID_MODE')
except Exception as e:
 message=str(e) if isinstance(e,RuntimeError) and str(e).startswith(('AMBIGUOUS_ACCOUNT:','ACCOUNT_SCOPE_MISMATCH:','NOT_IMPLEMENTED','INVALID_MODE')) else type(e).__name__
 print(json.dumps({'failed':True,'safeError':message},ensure_ascii=False));sys.exit(1)
