"""Synthetic real HTTP/SQLite startup regression; no external configuration.
An optional old DLL demonstrates the former bounded-heap startup failure.
"""
from pathlib import Path
import hashlib,json,os,shutil,socket,sqlite3,subprocess,tempfile,time,urllib.request,urllib.error
ROOT=Path(__file__).resolve().parents[1]
DOTNET=os.environ.get('DOTNET_EXECUTABLE') or shutil.which('dotnet')
DLL=Path(os.environ.get('VOYAGE_TEST_API_DLL',ROOT/'server/VoyagePlex.Api/bin/Release/net8.0/VoyagePlex.Api.dll')).resolve()
OLD=Path(os.environ['VOYAGE_TEST_OLD_DLL']).resolve()if os.environ.get('VOYAGE_TEST_OLD_DLL')else None
passed=[]
def insert(db,table,supplied):
 row={k:(0 if t=='INTEGER'else'2026-10-13 00:00:00'if k.endswith('At')else'')for _,k,t,required,default,primary in db.execute(f'PRAGMA table_info({table})')if not primary and k not in supplied and required and default is None};row.update(supplied)
 return db.execute(f"INSERT INTO {table} ({','.join(row)}) VALUES ({','.join('?'for _ in row)})",list(row.values())).lastrowid

def start(db,dll,expect=True,heap=None):
 with socket.socket()as sock:sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
 base=f'http://127.0.0.1:{port}';owned=db.parent;env={'HOME':str(owned),'PATH':str(Path(DOTNET).parent)+':/usr/bin:/bin','DOTNET_ROOT':str(Path(DOTNET).parent),'DOTNET_CLI_TELEMETRY_OPTOUT':'1','ASPNETCORE_ENVIRONMENT':'Production','ASPNETCORE_URLS':base,'ConnectionStrings__Default':f'Data Source={db}','EmailParser__BaseUrl':'http://127.0.0.1:1','Logging__LogLevel__Default':'Error'}
 if heap:env['DOTNET_GCHeapHardLimit']=hex(heap)
 log=owned/('run-'+str(port)+'.log')
 with log.open('wb')as output:
  proc=subprocess.Popen([DOTNET,str(dll)],cwd=owned,env=env,stdout=output,stderr=output)
  healthy=False
  try:
   until=time.monotonic()+100
   while time.monotonic()<until and proc.poll()is None:
    try:
     with urllib.request.urlopen(base+'/api/health',timeout=.5)as r:healthy=r.status==200
     if healthy:break
    except(OSError,urllib.error.URLError):pass
    time.sleep(.1)
   assert healthy==expect,('startup',expect,proc.poll(),log.read_text(errors='replace')[-500:])
  finally:
   if proc.poll()is None:
    proc.terminate()
    try:proc.wait(15)
    except subprocess.TimeoutExpired:proc.kill();proc.wait()
 return log.read_text(errors='replace'),proc.returncode

def snapshot(db):
 with sqlite3.connect(db)as c:
  return {t:c.execute('SELECT * FROM '+t+' ORDER BY Id').fetchall()for t in ['ImportEmailItems','ImportBatches','MailSyncStates','MailContacts','ShipmentTasks']}

def make_fixture(db,count=37,padding=0,historical=False,tasks=False):
 with sqlite3.connect(db)as c:
  c.execute('UPDATE MailSystemSettings SET SyncEnabled=0')
  c.execute('DELETE FROM MailSyncStates')
  insert(c,'MailSyncStates',{'Id':1,'Address':'x@example.invalid','UidValidity':7,'LastUid':1531270832})
  insert(c,'MailSyncStates',{'Id':1007,'Address':'h@example.invalid','UidValidity':9,'LastUid':81})
  batch=insert(c,'ImportBatches',{'Company':'Xingxin','Kind':'Email','Status':'PendingConfirmation','MailReceivedDate':''if historical else'2026-10-13'})
  hb=insert(c,'ImportBatches',{'Company':'Huadeng','MailOwnerId':7,'Kind':'Email','Status':'PendingConfirmation','MailReceivedDate':'2026-10-13'})
  rows=[]
  for n in range(count):
   payload=json.dumps({'message':{'subject':'RELEASE CFS SO SYNTHETIC','sender':'Vendor <vendor@example.invalid>'},'mailbox_received_at':'2026-10-13T01:00:00Z','padding':'x'*padding})
   values={'Company':'Xingxin','ImportBatchId':batch,'MailboxKey':f'x@example.invalid:7:{n+1}','MailReceivedAt':''if historical else'2026-10-13T01:00:00Z','MailReceivedDate':''if historical else'2026-10-13','MailSubject':'RELEASE CFS SO SYNTHETIC','MailSender':'Vendor <vendor@example.invalid>'if n%2 else'vendor@example.invalid','ResultJson':payload,'Status':'parsed','HandlingStatus':'Confirmed'if n%3==0 else'Pending','HandlingOutcome':'NoTask'if n%3==0 else'','TaskIdsJson':'[123]'if n%3==0 else'[]','ClassificationSource':'Manual'if n%11==0 else'System','ShipmentMode':'FCL','WorkCategory':'Change','Fingerprint':f'fp-{n}'}
   rows.append(insert(c,'ImportEmailItems',values))
   if tasks:insert(c,'ShipmentTasks',{'Company':'Xingxin','SourceImportItemId':rows[-1],'EmailSubject':'','DestinationCountry':'Synthetic Country','SoNumber':f'SYN-{n}'})
  insert(c,'ImportEmailItems',{'Company':'Huadeng','MailOwnerId':7,'ImportBatchId':hb,'MailboxKey':'Huadeng:7:hash:h@example.invalid:9:80','MailReceivedAt':'2026-10-13T01:00:00Z','MailReceivedDate':'2026-10-13','MailSubject':'Private synthetic','MailSender':'huadeng@example.invalid','ResultJson':'{}','ClassificationSource':'System','Status':'failed','HandlingStatus':'Pending'})
 return rows

def run():
 assert DOTNET and DLL.is_file()
 with tempfile.TemporaryDirectory(prefix='voyage-startup-memory-')as temp:
  root=Path(temp);seed=root/'seed.db';start(seed,DLL)
  with sqlite3.connect(seed)as c:c.execute('UPDATE MailSystemSettings SET SyncEnabled=0')
  def clone(name):p=root/name;shutil.copyfile(seed,p);return p
  db=clone('functional.db');ids=make_fixture(db,historical=True,tasks=True);before=snapshot(db)
  if OLD:
   old_functional=root/'old-functional.db';shutil.copyfile(db,old_functional);start(old_functional,OLD);old_after=snapshot(old_functional)
  start(db,DLL);after=snapshot(db)
  if OLD:
   for table in ('ImportEmailItems','ImportBatches','MailSyncStates','ShipmentTasks'):assert old_after[table]==after[table],('old behavior changed',table)
   with sqlite3.connect(db)as c:contact_cols=[r[1]for r in c.execute('PRAGMA table_info(MailContacts)')]
   stamp=contact_cols.index('UpdatedAt');without_time=lambda rows:[tuple(v for i,v in enumerate(row)if i!=stamp)for row in rows]
   assert without_time(old_after['MailContacts'])==without_time(after['MailContacts']);passed.append('complete functional result equals original implementation except contact refresh timestamp')
  assert before['MailSyncStates']==after['MailSyncStates'];passed.append('original two-company checkpoints unchanged')
  with sqlite3.connect(db)as c:
   assert c.execute("SELECT COUNT(*) FROM ShipmentTasks WHERE EmailSubject='RELEASE CFS SO SYNTHETIC'").fetchone()==(37,)
  passed.append('task subject backfill completes across multiple pages')
  with sqlite3.connect(db)as c:
   cols=[r[1]for r in c.execute('PRAGMA table_info(ImportEmailItems)')];now={r[0]:dict(zip(cols,r))for r in after['ImportEmailItems']};was={r[0]:dict(zip(cols,r))for r in before['ImportEmailItems']}
   assert all(now[i]['MailReceivedDate']=='2026-10-13'for i in ids);passed.append('metadata across multiple pages complete')
   assert c.execute('SELECT MailReceivedDate FROM ImportBatches WHERE Id=?',(now[ids[0]]['ImportBatchId'],)).fetchone()==('2026-10-13',);passed.append('shared batch date persists across pages')
   assert c.execute('SELECT MessageCount FROM MailContacts WHERE Email=?',('vendor@example.invalid',)).fetchone()==(len(ids),);passed.append('normalized sender count includes manual rows across pages')
   assert all(now[i]['ClassificationSource']=='Manual'and now[i]['ShipmentMode']=='FCL'for i in ids if was[i]['ClassificationSource']=='Manual');passed.append('manual classification retained')
   assert all(now[i]['ShipmentMode']=='Warehouse'for i in ids if was[i]['ClassificationSource']!='Manual');passed.append('non-manual classification complete beyond first page')
   unchanged=['Status','HandlingStatus','HandlingOutcome','TaskIdsJson','MailboxKey','ResultJson','Fingerprint','ImportBatchId','MailOwnerId','Company']
   assert all(all(now[i][k]==was[i][k]for k in unchanged)for i in now);assert all(now[i]==was[i]for i in now if now[i]['Company']=='Huadeng');passed.append('mail contents, statuses, ownership and unrelated company unchanged')
  for mode in ['metadata','classification']:
   db=clone(mode+'-rollback.db');ids=make_fixture(db,historical=mode=='metadata');before=snapshot(db)
   with sqlite3.connect(db)as c:c.executescript(f"CREATE TRIGGER reject_later_page BEFORE UPDATE OF {'MailReceivedAt'if mode=='metadata'else'ShipmentMode'} ON ImportEmailItems WHEN OLD.Id={ids[18]} BEGIN SELECT RAISE(ABORT,'synthetic later page failure'); END;")
   start(db,DLL,expect=False);after=snapshot(db);assert before==after,(mode,'partial transaction writes');passed.append(mode+' later-page failure rolls back complete stage')
  db=clone('subject-rollback.db');ids=make_fixture(db,tasks=True);before=snapshot(db)
  with sqlite3.connect(db)as c:c.executescript("CREATE TRIGGER reject_later_subject_page BEFORE UPDATE OF EmailSubject ON ShipmentTasks WHEN OLD.Id=19 BEGIN SELECT RAISE(ABORT,'synthetic subject page failure'); END;")
  start(db,DLL,expect=False);after=snapshot(db);assert before['ShipmentTasks']==after['ShipmentTasks']and before['MailSyncStates']==after['MailSyncStates'];passed.append('task subject later-page failure rolls back full task stage')
  db=clone('malformed.db');ids=make_fixture(db,historical=True)
  with sqlite3.connect(db)as c:c.execute('UPDATE ImportEmailItems SET ResultJson=? WHERE Id=?',('[',ids[16]))
  before=snapshot(db);start(db,DLL);after=snapshot(db)
  with sqlite3.connect(db)as c:
   assert c.execute('SELECT ResultJson,MailReceivedDate FROM ImportEmailItems WHERE Id=?',(ids[16],)).fetchone()==('[','')
   assert c.execute('SELECT MailReceivedDate FROM ImportEmailItems WHERE Id=?',(ids[-1],)).fetchone()==('2026-10-13',)
  assert before['MailSyncStates']==after['MailSyncStates'];passed.append('malformed historical JSON retained and later pages still visited')
  db=clone('large.db');ids=make_fixture(db,count=120,padding=1024*1024,historical=True,tasks=True);before=snapshot(db)
  # Drop the Python copy of payloads before measuring the isolated .NET child.
  digest=lambda rows:hashlib.sha256(json.dumps(rows,sort_keys=True).encode()).hexdigest()
  before_digest={k:digest(v)for k,v in before.items()if k=='MailSyncStates'};del before
  old_proved=False
  if OLD:
   old_db=root/'old-large.db';shutil.copyfile(db,old_db);log,code=start(old_db,OLD,expect=False,heap=128*1024**2);assert 'Out of memory'in log or 'OutOfMemoryException'in log;old_proved=True;passed.append('old unbounded startup reproduces heap exhaustion on same synthetic data')
  start(db,DLL,heap=128*1024**2)
  with sqlite3.connect(db)as c:
   assert c.execute("SELECT COUNT(*) FROM ImportEmailItems WHERE Company='Xingxin'").fetchone()==(120,)
   assert c.execute("SELECT COUNT(*) FROM ImportEmailItems WHERE Company='Xingxin' AND ClassificationSource<>'Manual' AND ShipmentMode='Warehouse'").fetchone()[0]==120-len(range(0,120,11))
   assert c.execute("SELECT MessageCount FROM MailContacts WHERE Email='vendor@example.invalid'").fetchone()==(120,)
   assert c.execute("SELECT COUNT(*) FROM ShipmentTasks WHERE EmailSubject='RELEASE CFS SO SYNTHETIC'").fetchone()==(120,)
   assert c.execute("SELECT COUNT(*) FROM ImportEmailItems WHERE Company='Xingxin' AND length(ResultJson)>1048576").fetchone()==(120,)
   for k,h in before_digest.items():assert digest(c.execute('SELECT * FROM '+k+' ORDER BY Id').fetchall())==h
  passed.append('120 one-MiB mails complete metadata, classification and subject stages within 128 MiB GC heap without skipped rows or cursor changes')
 print(json.dumps({'passed':len(passed),'failed':0,'skipped':0,'checks':passed,'oldFailureReproduced':old_proved,'productionAccess':False,'externalNetwork':False},indent=2))
if __name__=='__main__':run()
