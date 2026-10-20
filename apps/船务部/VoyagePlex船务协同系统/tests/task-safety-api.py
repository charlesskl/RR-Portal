"""Safety workflow regression using an isolated database; never touches local business data."""
import datetime,http.cookiejar,json,os,secrets,socket,sqlite3,subprocess,tempfile,threading,time,urllib.request,urllib.error
from pathlib import Path
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
ROOT=Path(__file__).resolve().parents[1]
def run():
 with tempfile.TemporaryDirectory(prefix='voyageplex-safety-') as temp:
  db=Path(temp)/'test.db';log_path=Path(temp)/'api.log';password=secrets.token_urlsafe(16)
  class Stub(BaseHTTPRequestHandler):
   def log_message(self,*args):pass
   def do_POST(self):
    if self.headers.get('Transfer-Encoding','').lower()=='chunked':
     chunks=[]
     while True:
      n=int(self.rfile.readline().strip(),16)
      if not n:self.rfile.readline();break
      chunks.append(self.rfile.read(n));self.rfile.read(2)
     raw=b''.join(chunks)
    else:raw=self.rfile.read(int(self.headers.get('Content-Length',0)))
    self.send_response(200);self.send_header('Content-Type','application/json');self.end_headers();self.wfile.write(json.dumps({'exportPayload':json.loads(raw)}).encode())
  stub=ThreadingHTTPServer(('127.0.0.1',0),Stub);threading.Thread(target=stub.serve_forever,daemon=True).start()
  with socket.socket() as s:s.bind(('127.0.0.1',0));port=s.getsockname()[1]
  base=f'http://127.0.0.1:{port}';jar=http.cookiejar.CookieJar();opener=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar));proc=None;log=None
  def req(path,body=None,status=200,method=None):
   request=urllib.request.Request(base+path,data=None if body is None else json.dumps(body).encode(),method=method,headers={'Content-Type':'application/json'} if body is not None else {})
   try:r=opener.open(request,timeout=15)
   except urllib.error.HTTPError as e:r=e
   raw=r.read();value=json.loads(raw) if raw else None
   assert r.code==status,(path,r.code,value)
   return value
  def start():
   nonlocal proc,log
   log=open(log_path,'ab');env=dict(os.environ,ConnectionStrings__Default=f'Data Source={db}',ASPNETCORE_URLS=base,EmailParser__BaseUrl=f'http://127.0.0.1:{stub.server_port}')
   proc=subprocess.Popen(['dotnet',str(ROOT/'server/VoyagePlex.Api/bin/Debug/net8.0/VoyagePlex.Api.dll')],cwd=ROOT/'server/VoyagePlex.Api',env=env,stdout=log,stderr=log)
   for _ in range(150):
    if proc.poll() is not None:raise AssertionError(log_path.read_text()[-2500:])
    try:req('/api/auth/setup-status');return
    except OSError:time.sleep(.1)
   raise AssertionError('startup timeout')
  def stop():
   if proc:proc.terminate();proc.wait(timeout=15)
   if log:log.close()
  try:
   start();req('/api/auth/setup',{'username':'admin','displayName':'Owner','password':password},status=201);req('/api/auth/login',{'username':'admin','password':password})
   owner=req('/api/auth/me')['id'];other=req('/api/users',{'username':'operator','displayName':'Operator','role':'admin','companyAccess':'Both','password':password},status=201)['id']
   def task():
    row=req('/api/shipments',{'customer':'ZURU','plannedShipDate':datetime.date.today().isoformat()},status=201)
    assert row['responsibleUserId']==owner
    return req(f"/api/shipments/{row['id']}",{'items':[{'product_code':'ITEM','contract_number':'C1','quantity':12,'pieces':1,'gross_weight_per_box':2}],'status':'PendingShipment'},method='PATCH')['id']
   first,second,third=task(),task(),task()
   missing=req(f'/api/shipments/{first}/export',status=422);assert missing['code']=='MissingWeights' and missing['missing'][0]['label']=='每箱净重'
   export=req(f'/api/shipments/{first}/export?allowIncomplete=true')['exportPayload'];assert export['exportMissingWeights'][0]['itemIndex']==0
   req('/api/auth/login',{'username':'operator','password':password})
   warning=req(f'/api/shipments/{first}',{'transportReference':'9车'},status=409,method='PATCH');assert warning['code']=='OtherTaskOwner' and warning['ownerId']==owner
   assert req(f'/api/shipments/{first}')['transportReference']==''
   saved=req(f'/api/shipments/{first}',{'transportReference':'9车','confirmedOwnerId':owner},method='PATCH');assert saved['responsibleUserId']==owner and saved['lastEditedBy']=='Operator'
   ack={str(first):owner,str(second):owner,str(third):owner}
   begin={'taskIds':[first,second],'ownerConfirmations':ack}
   assert req('/api/inventory/writebacks/begin',{'taskIds':[first]},status=409)['code']=='OtherTaskOwner'
   operation=req('/api/inventory/writebacks/begin',begin)['operationId'];base_body={'operationId':operation,'ownerConfirmations':ack}
   req('/api/inventory/writebacks/begin',begin,status=409)
   req(f'/api/shipments/{first}',{'transportReference':'changed','confirmedOwnerId':owner},status=409,method='PATCH')
   req(f'/api/shipments/{first}',status=409,method='DELETE')
   result={'files':[{'filename':'stock.xlsx','beforeHash':'a'*64,'afterHash':'b'*64}],'outbound_date':datetime.date.today().isoformat(),'allocations':[{'item_index':0,'quantity':12},{'item_index':1,'quantity':12}]}
   req('/api/inventory/writebacks/prepared',{**base_body,'result':result})
   op2=req('/api/inventory/writebacks/begin',{'taskIds':[third],'ownerConfirmations':ack})['operationId']
   req('/api/inventory/writebacks/prepared',{'operationId':op2,'ownerConfirmations':ack,'result':result},status=409)
   req('/api/inventory/writebacks/cancel',{'operationId':op2,'ownerConfirmations':ack})
   req('/api/inventory/writebacks/writing',base_body)
   req('/api/inventory/writebacks/writing',base_body,status=409)
   req('/api/inventory/writebacks/cancel',base_body,status=409)
   req('/api/inventory/writebacks/complete',{**base_body,'files':[{'filename':'stock.xlsx','hash':'a'*64}]},status=409)
   assert req(f'/api/shipments/{first}')['status']=='PendingShipment'
   stop();start()
   records=req('/api/inventory/writebacks');assert len(records)==1 and records[0]['state']=='Writing'
   complete={**base_body,'files':[{'filename':'stock.xlsx','hash':'b'*64}]}
   req('/api/inventory/writebacks/complete',complete)
   req('/api/inventory/writebacks/complete',complete)
   for tid in [first,second]:
    row=req(f'/api/shipments/{tid}');assert row['status']=='Completed' and row['items'][0]['inventory_writeback_task_id']==str(tid) and row['responsibleUserId']==owner
   req('/api/inventory/writebacks/begin',begin,status=409)
   assert req('/api/inventory/writebacks')==[]
   # A batch containing an already-completed task must not reserve the other task.
   req('/api/inventory/writebacks/begin',{'taskIds':[third,first],'ownerConfirmations':ack},status=409)
   with sqlite3.connect(db) as c:
    assert c.execute('SELECT COUNT(*) FROM InventoryWritebacks WHERE TaskId=?',(third,)).fetchone()[0]==0
    assert c.execute('SELECT COUNT(*) FROM TaskEditAudits WHERE TaskId=? AND ActorId=?',(first,other)).fetchone()[0]>=2
   op3=req('/api/inventory/writebacks/begin',{'taskIds':[third],'ownerConfirmations':ack})['operationId']
   recovery={'operationId':op3,'ownerConfirmations':ack}
   req('/api/inventory/writebacks/prepared',{**recovery,'result':result})
   req('/api/inventory/writebacks/writing',recovery)
   req('/api/inventory/writebacks/rollback',{**recovery,'files':[{'filename':'stock.xlsx','hash':'a'*64}]},status=409)
   req('/api/inventory/writebacks/rollback',{**recovery,'confirmRollback':True,'files':[{'filename':'stock.xlsx','hash':'b'*64}]},status=409)
   req('/api/inventory/writebacks/rollback',{**recovery,'confirmRollback':True,'files':[{'filename':'stock.xlsx','hash':'a'*64}]})
   assert req(f'/api/shipments/{third}')['status']=='PendingShipment'
   retry=req('/api/inventory/writebacks/begin',{'taskIds':[third],'ownerConfirmations':ack})['operationId']
   req('/api/inventory/writebacks/cancel',{'operationId':retry,'ownerConfirmations':ack})
   print('Task safety API passed: missing-weight acknowledgement, owner warning/audit, duplicate and batch locks, file claims, restart recovery, hash mismatch rejection and idempotent completion.')
  finally:stop();stub.shutdown()
if __name__=='__main__':run()
