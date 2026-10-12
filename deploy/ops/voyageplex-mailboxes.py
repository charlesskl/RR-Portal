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
 prior=configured_env()
 assert_safe(isinstance(prior,list) and all(e.get('username') in {e['username'] for e in incoming} for e in prior),'OTHER_MAILBOX_CONFIG_PRESENT')
 current=candidates();resolved=[]
 for name,address in zip(NAMES,ADDRESSES):
  matches=current[name];assert_safe(len(matches)==1,'AMBIGUOUS_ACCOUNT:'+name)
  row=matches[0];entry=next((e for e in incoming if e.get('username')==row['Username'] and e.get('address')==address),None)
  assert_safe(entry is not None and entry.get('host')=='imap.163.com' and entry.get('folder')=='INBOX' and isinstance(entry.get('authCode'),str) and len(entry['authCode'])>=8,'CONFIG_BINDING_INVALID')
  # Human-approved expected and desired privileges, carried separately from the final five-key environment entries.
  approved=entry.get('approvedAccount',{})
  assert_safe(all(row[k]==approved.get(k) for k in ['Id','Role','CompanyAccess','IsActive']),'ACCOUNT_CHANGED_RECHECK_REQUIRED:'+name)
  desired=entry.get('desiredAccount',{})
  expected_role='admin' if row['Id']==2 else 'shipping'
  expected_company='Xingxin' if row['Id']==2 else 'Huadeng'
  assert_safe(desired.get('Role')==expected_role and desired.get('CompanyAccess')==expected_company and row['IsActive'],'DESIRED_SCOPE_INVALID')
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
 flag=ROOT/'deploy/maintenance/services/voyageplex';flag.parent.mkdir(parents=True,exist_ok=True);flag.touch();switched_at=time.monotonic()
 subprocess.run(COMPOSE+['up','-d','--no-deps','--force-recreate','voyageplex-api'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,check=True)
 for attempt in range(30):
  try:
   with urllib.request.urlopen(api_base()+'/api/health',timeout=5) as r:
    if r.status==200:break
  except Exception:pass
  time.sleep(2)
 else:raise RuntimeError('API_NOT_HEALTHY_AFTER_RECREATE')
 assert_safe(configured_env()==final,'RUNNING_CONTAINER_ENV_MISMATCH')
 time.sleep(max(0,12-(time.monotonic()-switched_at)))
 for attempt in range(36):
  healths=[subprocess.check_output(['docker','inspect','-f','{{.State.Health.Status}}','rr-portal-'+service+'-1'],text=True).strip() for service in ['voyageplex-api','voyageplex-web','voyageplex-parser']]
  if all(h=='healthy' for h in healths):
   flag.unlink(missing_ok=True);break
  time.sleep(5)
 else:raise RuntimeError('VOYAGEPLEX_GROUP_NOT_HEALTHY')
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
  assert_safe(u['Role']==('admin' if u['Id']==2 else 'shipping') and u['CompanyAccess']==('Xingxin' if u['Id']==2 else 'Huadeng') and u['IsActive'],'APPROVED_ACCOUNT_SCOPE_CHANGED:'+name)
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
     with connect() as cursor_db:
      previous_cursor=cursor_db.execute('SELECT LastUid FROM MailSyncStates WHERE Id=?',(1000+u['Id'],)).fetchone()
     previous_uid=previous_cursor[0] if previous_cursor else 0
     code,sync=request(base,'/api/imports/email/mailbox/sync',tokens[admin['Id']],owner=u['Id'],method='POST',body={});rounds+=1
     if code!=200 or sync.get('configured') is not True or sync.get('error') or sync.get('waitingUntil'):
      sync_error={'status':code,'configured':sync.get('configured'),'waitingUntil':sync.get('waitingUntil'),'message':'同步未完成，请检查服务状态及现有起始日期'};break
     imported+=sync.get('imported',0)
     with connect() as cursor_db:
      current_cursor=cursor_db.execute('SELECT LastUid FROM MailSyncStates WHERE Id=?',(1000+u['Id'],)).fetchone()
     current_uid=current_cursor[0] if current_cursor else 0
     if sync.get('imported',0)==0 and current_uid==previous_uid:caught_up=True;break
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
  print(json.dumps({'mailboxStates':details,'permissions':permissions},ensure_ascii=False),flush=True)
 verified=all(r['connected'] and r.get('caughtUp') and not r.get('syncError') for r in results)
 print(json.dumps({'verified':verified,'mailboxesTested':len(results),'temporarySessionsCleaned':True},ensure_ascii=False),flush=True)
 if not verified:raise RuntimeError('MAILBOX_CONNECTION_OR_SYNC_INCOMPLETE')

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
 elif mode=='progress':
  with connect() as c:
   c.row_factory=sqlite3.Row
   progress=[]
   for uid in [2,3,5,6]:
    user=dict(c.execute('SELECT Id,Username,MailboxAddress,MailboxTestStatus,MailboxTestedAt FROM Users WHERE Id=?',(uid,)).fetchone())
    state=c.execute('SELECT Id,Address,LastUid,LastSuccessAt,LastError FROM MailSyncStates WHERE Id=?',(1000+uid,)).fetchone()
    count=c.execute("SELECT COUNT(*) FROM ImportEmailItems WHERE Company='Huadeng' AND MailOwnerId=? AND MailboxKey<>''",(uid,)).fetchone()[0]
    progress.append({'user':user,'cursor':dict(state) if state else None,'mailCount':count})
  directory=sorted((ROOT/'deploy/backups').glob('voyageplex-pre-904-*'))[-1]
  old_lines=(directory/'env.before').read_text().splitlines()
  old=next((line.split('=',1)[1].strip() for line in old_lines if line.startswith('VOYAGEPLEX_HUADENG_MAILBOXES_JSON=')),'')
  if old.startswith("'") and old.endswith("'"):old=old[1:-1]
  old_count=len(json.loads(old)) if old else 0
  print(json.dumps({'readOnlyProgress':progress,'preUpgradeMailboxEntries':old_count},ensure_ascii=False))
 elif mode=='access':
  current=users_by_id();rows=[current[i] for i in [2,3,5,6]]
  admin=next(u for u in current.values() if u['Role']=='admin' and u['IsActive'])
  with connect() as c:
   samples={u['Id']:c.execute("SELECT Id FROM ImportEmailItems WHERE Company='Huadeng' AND MailOwnerId=? AND MailboxKey<>'' ORDER BY Id LIMIT 1",(u['Id'],)).fetchone() for u in rows}
  reports=[]
  with sessions([admin['Id']]+[u['Id'] for u in rows]) as tokens:
   base=api_base()
   for u in rows:
    uid=u['Id'];assert_safe(u['Role']==('admin' if uid==2 else 'shipping') and u['CompanyAccess']==('Xingxin' if uid==2 else 'Huadeng'),'APPROVED_ACCOUNT_SCOPE_CHANGED')
    with connect() as c:
     state=c.execute('SELECT MailboxTestStatus FROM Users WHERE Id=?',(uid,)).fetchone()[0]
    if state!='Connected':
     code,test=request(base,'/api/users/'+str(uid)+'/mailbox-test',tokens[admin['Id']],method='POST',body={})
     assert_safe(code==200 and test.get('connected') is True,'MAILBOX_CONNECTION_TEST_FAILED:'+u['DisplayName'])
    else:code=200
    other=next(v for v in rows if v['Id']!=uid and samples[v['Id']])
    result={'username':u['Username'],'connectionTestStatus':code,'connected':True}
    if u['Role']=='shipping':
     code,data=request(base,'/api/mail/accounts',tokens[uid],owner=other['Id']);assert_safe(code==200 and data['selectedOwnerId']==uid and [v['id'] for v in data['accounts']]==[uid],'SHIPPING_ACCOUNT_ISOLATION_FAILED')
     cross,_=request(base,'/api/imports/email/mailbox/items/'+str(samples[other['Id']][0]),tokens[uid],owner=other['Id']);assert_safe(cross==404,'SHIPPING_CROSS_MAIL_ACCESS_FAILED')
     own=None
     if samples[uid]:
      own,_=request(base,'/api/imports/email/mailbox/items/'+str(samples[uid][0]),tokens[uid]);assert_safe(own==200,'SHIPPING_OWN_MAIL_ACCESS_FAILED')
     denied,_=request(base,'/api/users/'+str(other['Id'])+'/mailbox-test',tokens[uid],method='POST',body={});assert_safe(denied==403,'SHIPPING_ADMIN_API_NOT_BLOCKED')
     result.update({'onlyOwnMailbox':True,'forgedOwnerIgnored':True,'otherMailboxDetail':cross,'ownMailboxDetail':own,'adminMailboxTestDenied':denied})
    else:
     code,data=request(base,'/api/mail/accounts',tokens[uid]);assert_safe(code==200 and {v['Id'] for v in rows}<={v['id'] for v in data['accounts']},'ADMIN_ALL_MAILBOX_SCOPE_FAILED')
     code,selected=request(base,'/api/mail/accounts',tokens[uid],owner=other['Id']);assert_safe(code==200 and selected['selectedOwnerId']==other['Id'],'ADMIN_OWNER_SELECTION_FAILED')
     result.update({'allFourMailboxesVisible':True,'ownerSelection':True})
    reports.append(result)
  print(json.dumps({'accessVerified':True,'connectionAndAccess':reports,'temporarySessionsCleaned':True},ensure_ascii=False))
 elif mode=='rollout':
  directory=sorted((ROOT/'deploy/backups').glob('voyageplex-pre-904-*'))[-1]
  fields='Id,Username,DisplayName,Role,CompanyAccess,IsActive,PasswordHash,MailboxAddress'
  with sqlite3.connect((directory/'voyageplex.db').as_uri()+'?mode=ro',uri=True) as before,connect() as after:
   assert_safe(before.execute('SELECT '+fields+' FROM Users ORDER BY Id').fetchall()==after.execute('SELECT '+fields+' FROM Users ORDER BY Id').fetchall(),'EXISTING_ACCOUNT_FIELDS_CHANGED')
   columns={table:{r[1] for r in after.execute('PRAGMA table_info('+table+')')} for table in ['Users','MailSyncStates']}
   assert_safe('MailboxTestConfigurationKey' in columns['Users'] and {'MailboxIdentity','ConfigurationKey'}<=columns['MailSyncStates'],'UPGRADE_SCHEMA_MISSING')
   assert_safe(after.execute('PRAGMA quick_check').fetchone()[0]=='ok','DATABASE_INTEGRITY_FAILED')
  actual=subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip()
  base=api_base()
  with urllib.request.urlopen(base+'/api/health',timeout=10) as response:assert_safe(response.status==200,'HEALTH_NOT_OK')
  admin=next(u for u in users_by_id().values() if u['Role']=='admin' and u['IsActive'])
  with sessions([admin['Id']]) as tokens:
   code,users=request(base,'/api/users',tokens[admin['Id']]);assert_safe(code==200,'ADMIN_USER_API_FAILED')
   safe=[{k:u[k] for k in ['id','username','displayName','role','companyAccess','isActive','mailboxAddress','mailboxConfigured']} for u in users if u['id'] in [2,3,5,6]]
  print(json.dumps({'rolloutVerified':True,'serverGitCommit':actual,'schemaUpgraded':True,'databaseIntegrity':'ok','originalAccountsAndPasswordsPreserved':True,'accounts':safe},ensure_ascii=False))
 elif mode=='configure':
  install_configuration()
 elif mode=='verify':
  verify_configuration()
 else: raise RuntimeError('INVALID_MODE')
except Exception as e:
 import re
 message=str(e) if isinstance(e,RuntimeError) and re.fullmatch(r'[A-Z_]+(?::(?:'+ '|'.join(NAMES)+r'))?',str(e)) else type(e).__name__
 print(json.dumps({'failed':True,'safeError':message},ensure_ascii=False));sys.exit(1)
