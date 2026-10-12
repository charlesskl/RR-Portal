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
# Server-only helper, no production credentials embedded.
from contextlib import contextmanager

def users_by_id():
 with connect() as c:
  c.row_factory=sqlite3.Row
  return {r['Id']:dict(r) for r in c.execute('SELECT Id,Username,DisplayName,Role,CompanyAccess,MailboxAddress,IsActive FROM Users')}

def api_base():
 cid=subprocess.check_output(COMPOSE+['ps','-q','voyageplex-api'],text=True).strip()
 info=json.loads(subprocess.check_output(['docker','inspect',cid],text=True))[0]
 ip=next(v['IPAddress'] for v in info['NetworkSettings']['Networks'].values() if v['IPAddress'])
 return 'http://'+ip+':5088'

@contextmanager
def sessions(userids):
 tokens={};hashes=[];now=datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None)
 try:
  with connect(False) as c:
   for uid in set(userids):
    raw=secrets.token_bytes(32);token=base64.b64encode(raw).decode();digest=hashlib.sha256(raw).hexdigest().upper()
    c.execute('INSERT INTO UserSessions (UserId,TokenHash,CreatedAt,ExpiresAt) VALUES (?,?,?,?)',(uid,digest,now.isoformat(),(now+datetime.timedelta(minutes=25)).isoformat()))
    tokens[uid]=token;hashes.append(digest)
  yield tokens
 finally:
  with connect(False) as c:
   for digest in hashes:c.execute('DELETE FROM UserSessions WHERE TokenHash=?',(digest,))

def request(base,route,token,owner=None,method='GET',body=None):
 cookie='voyageplex_session='+token+'; voyageplex_company=Huadeng'
 if owner is not None:cookie+='; voyageplex_mail_owner='+str(owner)
 data=None if body is None else json.dumps(body,ensure_ascii=False).encode()
 headers={'Cookie':cookie,'Content-Type':'application/json'}
 try:
  with urllib.request.urlopen(urllib.request.Request(base+route,data=data,headers=headers,method=method),timeout=200) as response:
   return response.status,json.load(response)
 except urllib.error.HTTPError as e:
  try:result=json.load(e)
  except Exception:result={}
  return e.code,result

def assert_safe(condition,code):
 if not condition:raise RuntimeError(code)

def configured_env():
 cid=subprocess.check_output(COMPOSE+['ps','-q','voyageplex-api'],text=True).strip()
 info=json.loads(subprocess.check_output(['docker','inspect',cid],text=True))[0]
 env=dict(v.split('=',1) for v in info['Config']['Env'] if '=' in v)
 return json.loads(env.get('VOYAGEPLEX_HUADENG_MAILBOXES_JSON','[]'))

def install_configuration():
 incoming=json.loads(base64.b64decode(os.environ['MAILBOX_CONFIG_B64'],validate=True))
 assert_safe(isinstance(incoming,list) and len(incoming)==4,'CONFIG_COUNT_INVALID')
 current=candidates();resolved=[]
 for name,address in zip(NAMES,ADDRESSES):
  matches=current[name];assert_safe(len(matches)==1,'AMBIGUOUS_ACCOUNT:'+name)
  row=matches[0];entry=next((e for e in incoming if e.get('username')==row['Username'] and e.get('address')==address),None)
  assert_safe(entry is not None and entry.get('host')=='imap.163.com' and entry.get('folder')=='INBOX' and isinstance(entry.get('authCode'),str) and len(entry['authCode'])>=8,'CONFIG_BINDING_INVALID')
  # Human-approved expected and desired privileges, carried separately from the final five-key environment entries.
  approved=entry.get('approvedAccount',{})
  assert_safe(all(row[k]==approved.get(k) for k in ['Id','Role','CompanyAccess','IsActive']),'ACCOUNT_CHANGED_RECHECK_REQUIRED:'+name)
  desired=entry.get('desiredAccount',{})
  assert_safe(desired.get('Role') in ['admin','supervisor','shipping'] and desired.get('CompanyAccess') in ['Huadeng','Xingxin','Both'] and row['IsActive'],'DESIRED_SCOPE_INVALID')
  resolved.append((row,entry,desired))
 assert_safe(len({e['username'] for e in incoming})==4 and len({e['address'] for e in incoming})==4,'DUPLICATE_CONFIG')
 admins=[u for u in users_by_id().values() if u['Role']=='admin' and u['IsActive']]
 assert_safe(bool(admins),'NO_ACTIVE_ADMIN')
 admin=next((u for u in admins if u['Id'] not in [r['Id'] for r,e,d in resolved]),admins[0])
 with sessions([admin['Id']]) as tokens:
  base=api_base()
  for row,entry,desired in resolved:
   payload={'displayName':row['DisplayName'],'role':desired['Role'],'companyAccess':desired['CompanyAccess'],'isActive':bool(row['IsActive']),'mailboxAddress':entry['address']}
   code,result=request(base,'/api/users/'+str(row['Id']),tokens[admin['Id']],method='PUT',body=payload)
   assert_safe(code==200 and result.get('username')==row['Username'] and result.get('mailboxAddress')==entry['address'],'USER_BINDING_UPDATE_FAILED:'+row['DisplayName'])
 final=[{k:e[k] for k in ['username','address','authCode','host','folder']} for row,e,d in resolved]
 value=json.dumps(final,ensure_ascii=False,separators=(',',':'))
 # Compact JSON is one physical line; literal single quote protects dotenv interpolation.
 assert_safe('\n' not in value and '\r' not in value and "'" not in value,'ENV_VALUE_UNSAFE')
 envfile=ROOT/'.env.cloud.production';lines=envfile.read_text().splitlines(keepends=True)
 prefix='VOYAGEPLEX_HUADENG_MAILBOXES_JSON='
 updated=[line for line in lines if not line.lstrip().startswith(prefix)]
 if updated and not updated[-1].endswith('\n'):updated[-1]+='\n'
 updated.append(prefix+"'"+value+"'\n")
 temporary=envfile.with_name('.env.cloud.production.mailbox-ops.tmp')
 with open(temporary,'x',encoding='utf-8') as out:out.write(''.join(updated))
 temporary.chmod(0o600);os.replace(temporary,envfile)
 # Render only in memory; never print compose output containing credentials.
 rendered=json.loads(subprocess.check_output(COMPOSE+['config','--format','json'],text=True))
 assert_safe(rendered['services']['voyageplex-api']['environment'].get('VOYAGEPLEX_HUADENG_MAILBOXES_JSON')==value,'COMPOSE_ENV_NOT_TRANSMITTED')
 subprocess.run(COMPOSE+['up','-d','--no-deps','--force-recreate','voyageplex-api'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,check=True)
 for attempt in range(30):
  try:
   with urllib.request.urlopen(api_base()+'/api/health',timeout=5) as r:
    if r.status==200:break
  except Exception:pass
  time.sleep(2)
 else:raise RuntimeError('API_NOT_HEALTHY_AFTER_RECREATE')
 assert_safe(configured_env()==final,'RUNNING_CONTAINER_ENV_MISMATCH')
 after=users_by_id()
 for row,entry,desired in resolved:
  a=after[row['Id']]
  assert_safe(a['Username']==row['Username'] and a['Role']==desired['Role'] and a['CompanyAccess']==desired['CompanyAccess'] and a['IsActive']==row['IsActive'] and a['MailboxAddress']==entry['address'],'ACCOUNT_POST_UPDATE_MISMATCH')
 print(json.dumps({'configured':True,'containerRecreated':True,'entries':4,'bindings':[{'id':row['Id'],'username':row['Username'],'name':row['DisplayName'],'role':desired['Role'],'companyAccess':desired['CompanyAccess'],'address':entry['address']} for row,entry,desired in resolved]},ensure_ascii=False),flush=True)


def verify_configuration():
 config=configured_env();assert_safe(len(config)==4,'RUNNING_CONFIG_COUNT_INVALID')
 known=users_by_id();rows=[]
 for name,address in zip(NAMES,ADDRESSES):
  matches=[u for u in known.values() if name in u['DisplayName'] or name in u['Username']]
  assert_safe(len(matches)==1,'AMBIGUOUS_ACCOUNT:'+name);u=matches[0]
  e=next((e for e in config if e.get('username')==u['Username'] and e.get('address')==address),None)
  assert_safe(e is not None and u['MailboxAddress']==address and e.get('host')=='imap.163.com' and e.get('folder')=='INBOX','RUNNING_BINDING_MISMATCH')
  rows.append(u)
 admins=[u for u in known.values() if u['Role']=='admin' and u['IsActive']]
 assert_safe(bool(admins),'NO_ACTIVE_ADMIN');admin=admins[0]
 results=[]
 with sessions([admin['Id']]+[u['Id'] for u in rows]) as tokens:
  base=api_base()
  for u in rows:
   code,test=request(base,'/api/users/'+str(u['Id'])+'/mailbox-test',tokens[admin['Id']],method='POST',body={})
   connected=code==200 and test.get('connected') is True
   result={'id':u['Id'],'username':u['Username'],'name':u['DisplayName'],'address':u['MailboxAddress'],'role':u['Role'],'companyAccess':u['CompanyAccess'],'testStatus':code,'connected':connected,'testMessage':str(test.get('message','')).replace(next((e['authCode'] for e in config if e['address']==u['MailboxAddress']),'NO-CREDENTIAL'), '[redacted]') if code==200 else '邮箱连接测试未通过，请检查 IMAP/授权码/服务器网络'}
   if connected:
    imported=0;rounds=0;caught_up=False;sync_error=None
    for n in range(20):
     code,sync=request(base,'/api/imports/email/mailbox/sync',tokens[admin['Id']],owner=u['Id'],method='POST',body={});rounds+=1
     if code!=200 or sync.get('configured') is not True or sync.get('error') or sync.get('waitingUntil'):
      sync_error={'status':code,'configured':sync.get('configured'),'waitingUntil':sync.get('waitingUntil'),'message':'同步未完成，请检查服务状态及现有起始日期'};break
     imported+=sync.get('imported',0)
     if sync.get('imported',0)==0:caught_up=True;break
    result.update({'syncImportedDuringValidation':imported,'syncRounds':rounds,'caughtUp':caught_up,'syncError':sync_error})
   print(json.dumps({'mailboxResult':result},ensure_ascii=False),flush=True);results.append(result)
  with connect() as c:
   c.row_factory=sqlite3.Row
   details=[]
   for u in rows:
    cursor=c.execute('SELECT Id,Address,UidValidity,LastUid,LastSuccessAt,LastError FROM MailSyncStates WHERE Id=?',(1000+u['Id'],)).fetchone()
    setting=c.execute('SELECT Id,StartDate,SyncEnabled,SyncIntervalMinutes FROM MailSystemSettings WHERE Id=?',(1000+u['Id'],)).fetchone()
    mails=c.execute("SELECT Id,MailOwnerId,MailboxKey FROM ImportEmailItems WHERE Company='Huadeng' AND MailOwnerId=? AND MailboxKey<>''",(u['Id'],)).fetchall()
    assert_safe(all(r['MailboxKey'].startswith('Huadeng:'+str(u['Id'])+':') for r in mails),'EMAIL_OWNER_KEY_MISMATCH')
    details.append({'username':u['Username'],'ownerId':u['Id'],'cursor':dict(cursor) if cursor else None,'setting':dict(setting) if setting else None,'mailCount':len(mails),'oneSampleId':mails[0]['Id'] if mails else None})
  for d,r in zip(details,results):
   if r.get('caughtUp'):
    assert_safe(bool(d['cursor'] and d['cursor']['LastSuccessAt'] and not d['cursor']['LastError']),'SYNC_SUCCESS_STATE_MISSING')
  permissions=[]
  for u in rows:
   own=u['Id'];other=next(v for v in details if v['ownerId']!=own)
   if u['Role']=='shipping':
    code,accounts=request(base,'/api/mail/accounts',tokens[own],owner=other['ownerId'])
    assert_safe(code==200 and accounts.get('selectedOwnerId')==own and [a['id'] for a in accounts.get('accounts',[])]==[own],'SHIPPING_ACCOUNT_ISOLATION_FAILED')
    usercode,_=request(base,'/api/users',tokens[own]);testcode,_=request(base,'/api/users/'+str(other['ownerId'])+'/mailbox-test',tokens[own],method='POST',body={})
    assert_safe(usercode==403 and testcode==403,'SHIPPING_ADMIN_API_NOT_BLOCKED')
    sample=next((v for v in details if v['ownerId']!=own and v['oneSampleId']),None)
    cross=None
    if sample:
     cross,_=request(base,'/api/imports/email/mailbox/items/'+str(sample['oneSampleId']),tokens[own],owner=sample['ownerId']);assert_safe(cross==404,'SHIPPING_CROSS_MAIL_ACCESS_FAILED')
    own_sample=next(v for v in details if v['ownerId']==own)['oneSampleId'];own_status=None
    if own_sample:
     own_status,_=request(base,'/api/imports/email/mailbox/items/'+str(own_sample),tokens[own]);assert_safe(own_status==200,'SHIPPING_OWN_MAIL_ACCESS_FAILED')
    permissions.append({'username':u['Username'],'forgedOwnerCookieIgnored':True,'userManagementDenied':usercode,'mailboxTestDenied':testcode,'otherMailboxDetail':cross,'ownMailboxDetail':own_status})
   elif u['Role'] in ['supervisor','admin']:
    code,accounts=request(base,'/api/mail/accounts',tokens[own]);assert_safe(code==200 and set(v['id'] for v in accounts['accounts'])>={v['Id'] for v in rows},'PRIVILEGED_MAILBOX_SCOPE_FAILED')
    code,selected=request(base,'/api/mail/accounts',tokens[own],owner=other['ownerId']);assert_safe(code==200 and selected['selectedOwnerId']==other['ownerId'],'PRIVILEGED_OWNER_SELECTION_FAILED')
    permissions.append({'username':u['Username'],'role':u['Role'],'existingAllMailboxScope':True,'ownerSelection':True})
  assert_safe(len({d['cursor']['Id'] for d in details if d['cursor']})==len([d for d in details if d['cursor']]),'MAILBOX_CURSORS_NOT_INDEPENDENT')
  for d in details:d.pop('oneSampleId',None)
  print(json.dumps({'mailboxStates':details,'permissions':permissions,'temporarySessionsCleanedOnExit':True},ensure_ascii=False),flush=True)
 print(json.dumps({'verified':all(r['connected'] and r.get('caughtUp') and not r.get('syncError') for r in results),'mailboxesTested':len(results)},ensure_ascii=False),flush=True)

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
  keys=DATA/'data-protection-keys'
  if keys.exists(): shutil.copytree(keys,target/'data-protection-keys')
  digest=hashlib.sha256(destination.read_bytes()).hexdigest()
  print(json.dumps({'backup':str(target),'databaseIntegrity':'ok','databaseSha256':digest},ensure_ascii=False))
 elif mode=='configure':
  install_configuration()
 elif mode=='verify':
  verify_configuration()
 else: raise RuntimeError('INVALID_MODE')
except Exception as e:
 message=str(e) if isinstance(e,RuntimeError) and str(e).startswith(('AMBIGUOUS_ACCOUNT:','ACCOUNT_SCOPE_MISMATCH:','NOT_IMPLEMENTED','INVALID_MODE')) else type(e).__name__
 print(json.dumps({'failed':True,'safeError':message},ensure_ascii=False));sys.exit(1)
