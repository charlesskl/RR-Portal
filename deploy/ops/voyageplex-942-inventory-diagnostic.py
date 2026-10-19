"""Fixed read-only PR942 inventory rejection diagnostic; no backup retry or source/data repair."""
import collections,contextlib,datetime,hashlib,json,os,pathlib,re,sqlite3,stat,subprocess,sys,time
PIN=True;BASE='f32c9f00760e048a0846045a6d638290074b48d6';BRANCH='refs/heads/ops/voyageplex-942-20261019'
ROOT=pathlib.Path('/opt/rr-portal');DATA=ROOT/'apps/船务部/VoyagePlex船务协同系统/data-runtime';FAILED=ROOT/'deploy/backups/voyageplex-942-20261019-backup';OUT=ROOT/'deploy/backups/voyageplex-942-20261019-inventory-diagnostic'
MANIFEST='aef2da0ea43012dcc021e5d386c30c32896c301b97a99ec61a342c9a0ae5cc02';RESULT='64f96f5681ce3834aad85faddd2dd7b442de5f1a4efb34e3db2bfa88f9989d8e'
STAGE='preflight';DEADLINE=0
HISTORY=r'voyageplex\.db\.before-(company|daily-mail|personal-mail)-([0-9]{14})-[a-f0-9]{32}\.db'
def need(v):
 if not v:raise RuntimeError('VOYAGEPLEX_INVENTORY_DIAGNOSTIC_REJECTED')
def enc(v):return json.dumps(v,ensure_ascii=True,sort_keys=True,separators=(',',':'),allow_nan=False).encode()
def sha(v):return hashlib.sha256(v).hexdigest()
def digest(path):
 with path.open('rb')as f:h=hashlib.sha256();[h.update(c)for c in iter(lambda:f.read(1024**2),b'')];return h.hexdigest()
def save(path,data):
 fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
 with os.fdopen(fd,'wb')as f:f.write(data);f.flush();os.fsync(f.fileno())
def seal(path):
 files={str(p.relative_to(path)):digest(p)for p in sorted(path.rglob('*'))if p.is_file()};save(path/'manifest.json',enc(files))
def old_seal():
 need(FAILED.is_dir()and not FAILED.is_symlink()and stat.S_IMODE(FAILED.stat().st_mode)==0o700 and digest(FAILED/'manifest.json')==MANIFEST and digest(FAILED/'first-result.json')==RESULT);manifest=json.loads((FAILED/'manifest.json').read_bytes());entries=list(FAILED.rglob('*'));need(len(entries)<=10000 and all(not p.is_symlink()and(p.is_dir()or p.is_file())and p.stat().st_mode&0o077==0 for p in entries));need(set(manifest)=={str(p.relative_to(FAILED))for p in entries if p.is_file()and p.name!='manifest.json'})
 for name,h in manifest.items():need(not pathlib.PurePosixPath(name).is_absolute()and'..'not in pathlib.PurePosixPath(name).parts and re.fullmatch('[a-f0-9]{64}',h)and digest(FAILED/name)==h)
 r=json.loads((FAILED/'first-result.json').read_bytes());need(r.get('success')is False and r.get('backupComplete')is False and r.get('failedStage')=='sqlite-file-inventory'and r.get('base')==BASE)
def checktime():need(time.monotonic()<DEADLINE)
def stamp(s):return[s.st_dev,s.st_ino,s.st_mode,s.st_size,s.st_mtime_ns,s.st_ctime_ns]
def inspect_entry(path):
 checktime();name=str(path.relative_to(DATA));s=path.lstat();row={'path':name,'pathSHA256':sha(name.encode()),'stat':stamp(s),'reasons':[]}
 if stat.S_ISLNK(s.st_mode):row.update(kind='symlink',category='symlink');row['reasons'].append('symlink-rejected');return row
 if stat.S_ISDIR(s.st_mode):row.update(kind='directory',category='directory');return row
 if not stat.S_ISREG(s.st_mode):row.update(kind='special',category='special');row['reasons'].append('special-file-rejected');return row
 row['kind']='regular';fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
 with os.fdopen(fd,'rb')as f:head=f.read(16);row['headerReadStable']=stamp(os.fstat(f.fileno()))==stamp(s)
 isdb=head==b'SQLite format 3\0';match=re.fullmatch(HISTORY,name);row['sqliteHeader']=isdb
 if name=='voyageplex.db':row['category']='primary';row['reasons']+=[]if isdb else['primary-header-invalid'];return row
 if isdb and match is None:row['category']='unrecognized-sqlite';row['reasons'].append('sqlite-name-not-in-fixed-history-rule');return row
 if match is None:row['category']='ordinary-file';return row
 row['category']='known-history-'+match[1]
 if not isdb:row['reasons'].append('known-history-header-invalid');return row
 try:d=datetime.datetime.strptime(match[2],'%Y%m%d%H%M%S');row['timestampValid']=d.strftime('%Y%m%d%H%M%S')==match[2]
 except ValueError:row['timestampValid']=False
 if not row['timestampValid']:row['reasons'].append('known-history-timestamp-invalid');return row
 row['companions']={};live=False
 for suffix in('-wal','-shm','-journal'):
  p=path.with_name(path.name+suffix);v=p.lstat()if p.exists()or p.is_symlink()else None;okay=v is None or stat.S_ISREG(v.st_mode)and v.st_size==0;row['companions'][suffix]={'exists':v is not None,'regular':v is not None and stat.S_ISREG(v.st_mode),'bytes':None if v is None else v.st_size,'acceptedByOriginalRule':okay};live|=not okay
 if live:row['reasons'].append('known-history-companion-not-empty-regular');return row
 try:
  with contextlib.closing(sqlite3.connect(path.as_uri()+'?mode=ro&immutable=1',uri=True,timeout=2))as db:
   db.execute('PRAGMA query_only=ON');db.set_progress_handler(lambda:int(time.monotonic()>=DEADLINE),10000);row['integrityOK']=db.execute('PRAGMA integrity_check').fetchall()==[('ok',)]
  if not row['integrityOK']:row['reasons'].append('known-history-integrity-not-ok')
 except sqlite3.Error as error:row['integrityOK']=False;row['sqliteExceptionType']=type(error).__name__ if type(error).__name__ in{'OperationalError','DatabaseError','IntegrityError'}else'Error';row['reasons'].append('known-history-integrity-open-or-query-error')
 row['historicalMetadataStable']=stamp(path.lstat())==stamp(s);return row
def diagnose(result):
 global STAGE
 STAGE='fixed-head-and-sealed-failure';old_seal();p=subprocess.run(['git','rev-parse','HEAD'],cwd=ROOT,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,timeout=10);need(p.returncode==0 and p.stdout.decode().strip()==BASE)
 STAGE='bounded-entry-classification';need(DATA.is_dir()and not DATA.is_symlink());rows=[];stack=[DATA]
 while stack:
  directory=stack.pop();checktime()
  with os.scandir(directory)as iterator:
   for entry in iterator:
    row=inspect_entry(pathlib.Path(entry.path));rows.append(row);need(len(rows)<=100000)
    if row['kind']=='directory':stack.append(pathlib.Path(entry.path))
 need(sum(r['category']=='primary'for r in rows)==1);private=enc(rows);need(len(private)<=32*1024**2);save(OUT/'entry-classification.private.json',private);categories=collections.Counter(r['category']for r in rows);reasons=collections.Counter(reason for r in rows for reason in r['reasons'])
 STAGE='original-seal-recheck';old_seal();result.update(success=True,diagnosticCompleted=True,originalFailurePreserved=True,categoryCounts=dict(categories),rejectionReasonCounts=dict(reasons),entryCount=len(rows),rejectingEntryCount=sum(bool(r['reasons'])for r in rows),historicalMetadataUnstableCount=sum(r.get('historicalMetadataStable')is False for r in rows),unknownSQLiteFilesCopiedOrWhitelisted=False,sourceRulesWereNotBroadened=True)
def main():
 global DEADLINE
 need(PIN and len(sys.argv)==2 and sys.argv[1]=='diagnose'and os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_ATTEMPT')=='1');os.umask(0o077);OUT.mkdir(mode=0o700);DEADLINE=time.monotonic()+110;result={'success':False,'diagnosticCompleted':False,'base':BASE,'businessRowsRead':False,'HTTPRequestsPerformed':False,'configurationOrDataModified':False,'backupRetried':False,'secretOrPathNamesPrinted':False}
 try:diagnose(result)
 except BaseException:result['failedStage']=STAGE
 finally:save(OUT/'first-result.json',enc(result));seal(OUT);print(enc(dict(result,manifestSHA256=digest(OUT/'manifest.json'),resultSHA256=digest(OUT/'first-result.json'))).decode(),flush=True)
 return 0 if result['success']else 1
if __name__=='__main__':
 try:exit_code=main()
 except BaseException:print('{"success":false,"safeFailure":"VOYAGEPLEX_942_INVENTORY_PREFLIGHT_FAILED"}',flush=True);exit_code=1
 sys.exit(exit_code)
