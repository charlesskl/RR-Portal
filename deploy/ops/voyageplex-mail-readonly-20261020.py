"""One fresh, private, read-only VoyagePlex cloud-mail observation.
No app session, mailbox API, sync, parse, account/config/cursor writes or signals.
Only the explicitly reviewed IMAP child may contact mail servers, via stdin secrets.
"""
import collections,contextlib,datetime,hashlib,importlib.util,json,os,pathlib,re,select,signal,sqlite3,stat,subprocess,sys,time,traceback,urllib.parse
ROOT=pathlib.Path('/opt/rr-portal');OUT=ROOT/'deploy/backups/voyageplex-mail-readonly-20261020'
BRANCH='refs/heads/ops/mail-readonly-20261020';DIAG_PIN=False;IMAP_BODY_PROBE=False
EXPECTED_HEAD='b30a803e74641e0e18150597e0114f6cb99b2e9c';EXPECTED_TREE='60936186cae64d44ee728ac80ec3033779e9a676'
CORE_SHA='a06bd4dd932df22b9127cda35a2dd7a8d69fafd879d6619ce3b50aa54252cd5d';IMAP_CHILD_SHA='24aeb6d64ef57df1e4a981ae1c558b36fad5177862bb32ad747d03b651cf51a9'
SERVICES=('voyageplex-web','voyageplex-api','voyageplex-parser');VOY='apps/船务部/VoyagePlex船务协同系统';DB=ROOT/VOY/'data-runtime/voyageplex.db';KEY='VOYAGEPLEX_HUADENG_MAILBOXES_JSON'
EXPECTED_IMAGES={'voyageplex-api':'sha256:a2384da1fe8f0a920de18ca6a22f292babb0b8f2cd6a58829d7ff90c8bb55987','voyageplex-parser':'sha256:fac9deb5e681966ab30e9192cd421ff144a82c5e1c64677adce87bcf01307d32','voyageplex-web':'sha256:f25b1e36eb9a73c60ecffd4f270c07d2a3596eca0c73afb2b9b9c232330235b4'}
WEB_COMPILED_SHA='f525cccdbb7dc5a772325f092eccbe4b203a127b6232f0d86caa6302db94a5d6';WEB_BUILD_ID_SHA='11b2d8759d16872161aad66e96d640eb9ef2311ff5372e3315559b3c593e2838'
OWNERS=(2,3,5,6);STATE_IDS=(1,1002,1003,1005,1006);SOURCE_UID=1531270833
CORE=None;COUNTER=0;STAGE='preflight'
EXCEPTIONS={'SqliteException','DbUpdateException','InvalidOperationException','TaskCanceledException','OperationCanceledException','TimeoutException','IOException','HttpRequestException','SocketException','AuthenticationException','ImapProtocolException','ImapCommandException','ServiceNotConnectedException','ServiceNotAuthenticatedException','JsonException','FormatException','ArgumentException','NullReferenceException','ObjectDisposedException','CancelledError','TimeoutError','OversizedLiteral','BatchLiteralBudget','MailboxUidValidityChanged'}

def need(value):
 if not value:raise RuntimeError('VOYAGEPLEX_READONLY_DIAG_REJECTED')
def enc(value):return json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=True,allow_nan=False).encode()
def sha(value):return hashlib.sha256(value).hexdigest()
def private(name,value):CORE.OPS.L.private_write(OUT/name,value if isinstance(value,bytes)else enc(value))
def safe_type(error):return type(error).__name__ if type(error).__name__ in{'RuntimeError','ValueError','TypeError','KeyError','OSError','PermissionError','FileNotFoundError','OperationalError','DatabaseError','TimeoutExpired','UnicodeDecodeError','JSONDecodeError','TimeoutError'}else'Other'
def observe(name,fn):
 try:return fn()
 except Exception as error:private(name+'-failure-traceback.private.txt',traceback.format_exc().encode());return {'available':False,'safeFailure':'READONLY_OBSERVATION_UNAVAILABLE','exceptionType':safe_type(error)}
def capture(args,label,timeout=60,data=None):
 global COUNTER
 need(re.fullmatch('[a-z0-9-]{1,80}',label));COUNTER+=1;prefix='%04d-%s'%(COUNTER,label)
 with(OUT/(prefix+'-stderr.private')).open('xb')as errors:result=subprocess.run(args,input=data,stdout=subprocess.PIPE,stderr=errors,timeout=timeout,cwd=ROOT)
 need(len(result.stdout)<=16*1024**2);private(prefix+'-stdout.private',result.stdout);return result.returncode,result.stdout

def environment(raw):
 rows=raw['Config']['Env'];need(type(rows)is list);result={}
 for row in rows:
  need(type(row)is str and'='in row);k,v=row.split('=',1);need(re.fullmatch('[A-Za-z_][A-Za-z0-9_]*',k)and k not in result);result[k]=v
 return result

def inspect_live():
 code,blob=capture(['docker','inspect',*['rr-portal-'+s+'-1'for s in SERVICES]],'live-inspect');need(code==0);records=json.loads(blob);need(type(records)is list and len(records)==3);rows={}
 for row in records:
  service=(row.get('Config',{}).get('Labels')or{}).get('com.docker.compose.service');need((row.get('Config',{}).get('Labels')or{}).get('com.docker.compose.project')=='rr-portal'and service in SERVICES and service not in rows and re.fullmatch('[a-f0-9]{64}',row['Id']));rows[service]=row
 private('target-inspect.private.json',rows);return rows

def runtime_facts(raw):
 result={}
 for service,row in raw.items():
  state=row['State'];result[service]={'containerId':row['Id'],'imageId':row['Image'],'imageMatchesExpectedDeployment':row['Image']==EXPECTED_IMAGES[service],'status':state.get('Status'),'running':state.get('Running'),'health':state.get('Health',{}).get('Status'),'oomKilled':state.get('OOMKilled'),'restartCount':row.get('RestartCount'),'startedAt':safe_date(state.get('StartedAt')),'exitCode':state.get('ExitCode'),'configuredUserSHA256':sha(enc(row['Config'].get('User'))),'environmentSHA256':sha(enc(environment(row))),'mountsSHA256':sha(enc(row.get('Mounts',[]))),'memoryLimit':row['HostConfig'].get('Memory'),'memorySwapLimit':row['HostConfig'].get('MemorySwap'),'nanoCPUs':row['HostConfig'].get('NanoCpus'),'cpuQuota':row['HostConfig'].get('CpuQuota'),'cpuPeriod':row['HostConfig'].get('CpuPeriod')}
 return result

def safe_date(value):
 if value is None or value=='':return None
 return value if type(value)is str and re.fullmatch(r'\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})?)?',value)else'nonstandard-date'
def error_category(value):
 if not value:return'none'
 text=str(value).lower()
 for label,pattern in [('rate-limit',r'429|too many requests|rate.limit|限流'),('authentication',r'authenticat|credentials|invalid password|授权|密码|认证|登录'),('timeout',r'timeout|timed out|超时'),('cancelled',r'cancel|取消'),('configuration',r'not configured|未配置|配置.*不一致'),('storage',r'sqlite|database|dbupdate|数据库|磁盘'),('network',r'connection|socket|network|连接|tls|ssl|dns'),('parsing',r'parse|pdf|excel|xlsx|解析'),('generic-sync-failure',r'邮箱同步失败')]:
  if re.search(pattern,text):return label
 return'present-unclassified'
def safe_last_error(value):
 text=str(value or'');match=re.fullmatch(r'邮件 ([0-9]{1,10}) (暂时读取失败，已保留断点等待重试|的收件时间读取失败，已保留断点等待重试)',text)
 if match and 0<int(match[1])<=4294967295:return {'safeExactStoredTemplate':text,'blockedUIDs':[int(match[1])],'rawOtherErrorPrinted':False}
 if text=='邮箱同步失败，请检查邮箱设置或联系管理员':return {'safeExactStoredTemplate':text,'blockedUIDs':[],'rawOtherErrorPrinted':False}
 return {'safeExactStoredTemplate':None,'blockedUIDs':[],'category':error_category(text),'rawOtherErrorPrinted':False}

ALLOWED_ROUTES={'/v1/mailbox/poll','/v1/mailbox/test','/v1/mailbox/retry','/api/health','/health','/voyageplex/api/health','/api/imports/email/mailbox/sync','/api/imports/email/mailbox/retry','/voyageplex/api/imports/email/mailbox/sync','/voyageplex/api/imports/email/mailbox/retry'}
def structured_event(line,service):
 stamp=re.match(r'^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.\d+)?Z ',line);timestamp=stamp[1]+'Z'if stamp else None
 if timestamp is None:
  match=re.search(r'\[([0-9]{2}/[A-Za-z]{3}/[0-9]{4}:[0-9]{2}:[0-9]{2}:[0-9]{2} [+-][0-9]{4})\]',line)
  if match:
   try:timestamp=datetime.datetime.strptime(match[1],'%d/%b/%Y:%H:%M:%S %z').astimezone(datetime.timezone.utc).isoformat()
   except ValueError:pass
 owner=re.search(r'邮箱\s+(Xingxin|Huadeng)(?::([0-9]*))?\s+同步失败',line);company=owner[1]if owner else None;slot=None
 if owner:
  if company=='Xingxin':slot='xingxin'
  elif owner[2]and int(owner[2])in OWNERS:slot='huadeng-'+str(OWNERS.index(int(owner[2]))+1)
 request=re.search(r'"(GET|POST|PUT|PATCH|DELETE|HEAD) ([^"\s]+) HTTP/[0-9.]+"(?:\s+([1-5][0-9]{2}))?',line);route=None;method=None;status=None
 if request:
  candidate=request[2].split('?',1)[0]
  if candidate in ALLOWED_ROUTES:route=candidate;method=request[1];status=int(request[3])if request[3]else None
  elif re.fullmatch(r'/(?:voyageplex/)?api/users/[0-9]+/mailbox-test',candidate):route='/api/users/{id}/mailbox-test';method=request[1];status=int(request[3])if request[3]else None
  try:query=urllib.parse.parse_qs(request[2].partition('?')[2],max_num_fields=100)
  except ValueError:query={}
  if len(query.get('company',[]))==1 and query['company'][0]in{'Xingxin','Huadeng'}:company=query['company'][0]
 httpclient=re.search(r'(?:Start processing HTTP request|Sending HTTP request) (GET|POST|PUT|PATCH|DELETE|HEAD) http://voyageplex-parser:8091([^\s]+)',line)
 if httpclient:
  candidate=httpclient[2].split('?',1)[0]
  if candidate in ALLOWED_ROUTES:route=candidate;method=httpclient[1]
  try:query=urllib.parse.parse_qs(httpclient[2].partition('?')[2],max_num_fields=100)
  except ValueError:query={}
  if len(query.get('company',[]))==1 and query['company'][0]in{'Xingxin','Huadeng'}:company=query['company'][0]
 exceptions=[name for name in EXCEPTIONS if re.search(r'(?<![A-Za-z0-9_])'+re.escape(name)+r'(?![A-Za-z0-9_])',line)];network=[]
 for code,pattern in [('ECONNREFUSED',r'ECONNREFUSED|Connection refused|connect\(\) failed'),('ETIMEDOUT',r'ETIMEDOUT|timed out|upstream timed out'),('ENOTFOUND',r'ENOTFOUND|Name or service not known|name resolution'),('ECONNRESET',r'ECONNRESET|Connection reset'),('CANCELLED',r'cancelled|canceled|TaskCanceledException|OperationCanceledException')]:
  if re.search(pattern,line,re.I):network.append(code)
 elapsed=None;duration=re.search(r'rt=([0-9]+(?:\.[0-9]+)?)|after ([0-9]+(?:\.[0-9]+)?)ms',line)
 if duration:elapsed=round(float(duration[1])*1000 if duration[1]else float(duration[2]),3)
 if status is None:
  response=re.search(r'(?:status(?: code)?\s*[:=]?\s*|HTTP[^ ]* [^0-9]*|(?:Received HTTP response headers|End processing HTTP request) after [0-9.]+ms - )([45][0-9]{2})(?:\b|$)',line,re.I)
  if response:status=int(response[1])
 relevant=bool(owner or route and('mailbox'in route)or exceptions or network or status and status>=400 and re.search(r'Received HTTP response headers|End processing HTTP request',line))
 if service.startswith('nginx')and not(route and'voyageplex'in route or'/voyageplex/'in line):relevant=False
 if not relevant:return None
 return {'timestampUtc':timestamp,'service':service,'companyDirectlyLogged':company,'mailboxSlotDirectlyLogged':slot,'method':method,'route':route,'statusDirectlyLogged':status,'exceptionTypes':sorted(exceptions),'networkErrorCodes':network,'elapsedMsDirectlyLogged':elapsed,'sameRequestAcrossLayersProven':False}

def mailbox_config(value):
 parsed=json.loads(value);need(type(parsed)is list and len(parsed)<=20);out=[]
 for row in parsed:
  need(type(row)is dict and all(type(k)is str for k in row));lower={k.lower():v for k,v in row.items()};need(len(lower)==len(row));out.append(lower)
 return out

def configuration(raw):
 envpath=ROOT/'.env.cloud.production';content=CORE.stable_environment_bytes(envpath);private('environment.private',content);maps={service:environment(row)for service,row in raw.items()};private('running-environments.private.json',maps)
 filevalues=[]
 for line in content.decode().splitlines():
  if line.startswith(KEY+'='):
   v=line.split('=',1)[1].strip();filevalues.append(v[1:-1]if len(v)>=2 and v[0]==v[-1]and v[0]in{'"',"'"}else v)
 entries=mailbox_config(maps['voyageplex-api'].get(KEY,''));private('huadeng-runtime-configuration.private.json',entries)
 api_env=maps['voyageplex-api'];parser_env=maps['voyageplex-parser'];flags={k:{'apiPresent':bool(api_env.get(k)),'parserPresent':bool(parser_env.get(k)),'bothPresentAndEqual':bool(api_env.get(k))and api_env.get(k)==parser_env.get(k),'apiAbsenceNormalForSharedMailbox':k.startswith('VOYAGEPLEX_MAIL_')and not api_env.get(k)}for k in('VOYAGEPLEX_MAIL_ADDRESS','VOYAGEPLEX_MAIL_AUTH_CODE','VOYAGEPLEX_MAIL_IMAP_HOST','VOYAGEPLEX_MAIL_FOLDER')}
 return {'privateEnvironmentSHA256':sha(content),'privateEnvironmentMode':stat.S_IMODE(envpath.stat().st_mode),'huadengRuntimeJsonValid':True,'huadengRuntimeEntryCount':len(entries),'privateHuadengVariableExactlyOnce':len(filevalues)==1,'privateAndRuntimeLiteralHuadengJSONEqual':len(filevalues)==1 and filevalues[0]==api_env.get(KEY),'xingxinVariablePresenceAndEquality':flags,'internalEndpoints':{'apiToParserBaseUrlMatches':api_env.get('EmailParser__BaseUrl')=='http://voyageplex-parser:8091','webToApiBaseUrlMatches':maps['voyageplex-web'].get('VOYAGEPLEX_API_BASE_URL')=='http://voyageplex-api:5088','webToParserBaseUrlMatches':maps['voyageplex-web'].get('EMAIL_PARSER_BASE_URL')=='http://voyageplex-parser:8091'}},entries

def personal_namespace(entry):
 values=[str(entry.get(k)or'')for k in('address','host','folder','authcode')]
 # This batch uses ASCII addresses/hosts/INBOX/163 authorization codes. Do not
 # guess .NET JavaScriptEncoder semantics for arbitrary escaped/non-ASCII input.
 if not all(re.fullmatch(r'[A-Za-z0-9@._:-]+',v)for v in values):return None,None
 address,host,folder,auth=values;identity=hashlib.sha256(json.dumps({'address':address.strip().lower(),'host':host.strip().lower(),'folder':folder.strip()},separators=(',',':')).encode()).hexdigest().upper();key=hashlib.sha256(json.dumps({'identity':identity,'AuthCode':auth},separators=(',',':')).encode()).hexdigest().upper();return identity,key

def typed_value(value):
 if isinstance(value,bytes):return {'blobHex':value.hex()}
 return value
def rows(db,query,args=()):
 result=db.execute(query,args);names=[v[0]for v in result.description];return[{k:typed_value(v)for k,v in zip(names,row)}for row in result.fetchall()]
def selected_state(db):
 marks=','.join('?'for _ in STATE_IDS);owners=','.join('?'for _ in OWNERS)
 return {'states':rows(db,'SELECT * FROM MailSyncStates WHERE Id IN ('+marks+') ORDER BY Id',STATE_IDS),'settings':rows(db,'SELECT * FROM MailSystemSettings WHERE Id IN ('+marks+') ORDER BY Id',STATE_IDS),'users':rows(db,'SELECT * FROM Users WHERE Id IN ('+owners+') ORDER BY Id',OWNERS)}
def readonly_live():
 db=sqlite3.connect(DB.as_uri()+'?mode=ro',uri=True,timeout=10);db.execute('PRAGMA query_only=ON');db.execute('BEGIN');db.execute('SELECT count(*) FROM sqlite_schema').fetchone();return db

def database_snapshot(entries,parser_environment):
 need(DB.is_file()and not DB.is_symlink());dest=OUT/'voyageplex-consistent.private.sqlite';fd=os.open(dest,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600);os.close(fd)
 with contextlib.closing(readonly_live())as source,contextlib.closing(sqlite3.connect(dest))as target:source.backup(target);target.commit();need(source.execute('PRAGMA query_only').fetchone()[0]==1)
 db=CORE.OPS.L.connect(dest,True)
 with contextlib.closing(db):
  state=selected_state(db);private('mail-state-before.private.json',state);need(db.execute('PRAGMA quick_check').fetchone()[0]=='ok');facts=[];mailboxes=[];byuser={u['Id']:u for u in state['users']};bystate={s['Id']:s for s in state['states']};settings={s['Id']:s for s in state['settings']}
  for index,stateid in enumerate(STATE_IDS):
   company='Xingxin'if stateid==1 else'Huadeng';owner=None if stateid==1 else stateid-1000;slot='xingxin'if owner is None else'huadeng-'+str(OWNERS.index(owner)+1);current=bystate.get(stateid);setting=settings.get(stateid);user=byuser.get(owner);matches=[]
   if owner is not None and user:matches=[e for e in entries if type(e.get('username'))is str and e['username'].strip().casefold()==str(user.get('Username','')).casefold()]
   entry=matches[0]if len(matches)==1 else{};binding=bool(user and type(entry.get('address'))is str and entry['address'].strip().casefold()==str(user.get('MailboxAddress','')).strip().casefold());statebinding=bool(current and(str(current.get('Address','')).strip().casefold()==str(parser_environment.get('VOYAGEPLEX_MAIL_ADDRESS','')).strip().casefold()if owner is None else user and str(current.get('Address','')).strip().casefold()==str(user.get('MailboxAddress','')).strip().casefold()));identity,key=personal_namespace(entry)if owner is not None else(None,None);identity_matches=bool(current and identity and current.get('MailboxIdentity')==identity)if owner is not None else None;namespace=bool(current and int(current.get('UidValidity')or 0)>0 and statebinding and(owner is None or identity_matches))
   aggregate=db.execute('SELECT COUNT(*),SUM(CASE WHEN Error<>\'\' THEN 1 ELSE 0 END),MAX(MailReceivedDate),MAX(MailReceivedAt),MAX(CreatedAt) FROM ImportEmailItems WHERE Company=?'+(''if owner is None else' AND MailOwnerId=?')+' AND MailboxKey<>\'\'',(company,)if owner is None else(company,owner)).fetchone()
   item={'slot':slot,'company':company,'stateId':stateid,'statePresent':current is not None,'settingPresent':setting is not None,'ownerPresent':owner is None or user is not None,'bindingMatchesRuntimeConfiguration':None if owner is None else binding,'cursorAddressMatchesBinding':statebinding,'cursorNamespaceKnown':namespace,'personalMailboxIdentityMatchesRuntime':identity_matches,'personalConfigurationKeyMatchesRuntime':bool(current and key and current.get('ConfigurationKey')==key)if owner is not None else None,'sharedMailboxIdentityNotUsedByCurrentProtocol':owner is None,'uidValidity':current.get('UidValidity')if current else None,'lastUid':current.get('LastUid')if current else None,'lastSuccessAt':safe_date(current.get('LastSuccessAt'))if current else None,'lastErrorCategory':error_category(current.get('LastError'))if current else None,'storedLastErrorSanitized':safe_last_error(current.get('LastError'))if current else None,'lastErrorPresent':bool(current.get('LastError'))if current else None,'syncEnabled':bool(setting.get('SyncEnabled'))if setting else None,'startDate':safe_date(setting.get('StartDate'))if setting else None,'syncIntervalMinutes':setting.get('SyncIntervalMinutes')if setting else None,'storedMailCount':aggregate[0],'storedParseErrorCount':aggregate[1]or 0,'latestReceivedDate':safe_date(aggregate[2]),'latestReceivedAt':safe_date(aggregate[3]),'latestCreatedAt':safe_date(aggregate[4])};facts.append(item)
   request={'slot':slot,'company':company,'target_uid':(safe_last_error(current.get('LastError')).get('blockedUIDs')or[SOURCE_UID])[0]if current else SOURCE_UID,'expected_uid_validity':int(current['UidValidity'])if namespace else None,'after_uid':int(current.get('LastUid')or 0)if current else 0,'start_date':str(setting.get('StartDate')or'1970-01-01')if setting else'1970-01-01'}
   if owner is not None:
    eligible=bool(binding and user and user.get('IsActive')and(user.get('Role')=='admin'or user.get('CompanyAccess')in{'Huadeng','Both'})and type(entry.get('authcode'))is str and entry['authcode'].strip())
    request.update(address=entry['address'].strip()if eligible else'',auth_code=entry['authcode']if eligible else'',host=str(entry.get('host')or'')if eligible else'',folder=str(entry.get('folder')or'')if eligible else'')
   item['runtimeCredentialsEligibleForConnection']=bool(parser_environment.get('VOYAGEPLEX_MAIL_ADDRESS')and parser_environment.get('VOYAGEPLEX_MAIL_AUTH_CODE'))if owner is None else eligible
   mailboxes.append(request)
  blocked=[v for v in facts if SOURCE_UID in(v.get('storedLastErrorSanitized')or{}).get('blockedUIDs',[])];target=blocked[0]['slot']if len(blocked)==1 and blocked[0]['cursorNamespaceKnown']and blocked[0]['runtimeCredentialsEligibleForConnection']and(blocked[0]['company']=='Xingxin'or blocked[0]['bindingMatchesRuntimeConfiguration'])else None
  return {'uniqueStoredSourceUidSlot':blocked[0]['slot']if len(blocked)==1 else None,'storedSourceUidSlotCount':len(blocked),'bodyTargetSlotFromUniqueStoredBlockedUID':target,'bodySkippedIfTargetUnproved':target is None,'queryOnlyLiveSnapshot':True,'closedSnapshotImmutableQueryOnly':True,'privateSQLiteSHA256':CORE.OPS.L.file_hash(dest),'privateStateSHA256':sha(enc(state)),'selectedCursorCount':len(state['states']),'mailboxes':facts},mailboxes,state

HISTORICAL_BACKUP=ROOT/'deploy/backups/batch-960-966-967-968-20261020-backup-05'
HISTORICAL_MANIFEST='4533352f7d160d95c78dce83741b81cca8f363c7d253b27959595a579e977794'
HISTORICAL_RESULT='bf36c36ffae529787564bccc74a7ef15140b3ff62cc46f09cf97008c51698ce0'

def historical_timeline(current,raw):
 root=HISTORICAL_BACKUP;need(root.is_dir()and not root.is_symlink());need(CORE.OPS.L.file_hash(root/'manifest.json')==HISTORICAL_MANIFEST and CORE.OPS.L.file_hash(root/'first-result.json')==HISTORICAL_RESULT);manifest=json.loads((root/'manifest.json').read_bytes());name='voyageplex-data/sqlite/voyageplex.db';path=root/name;need(path.is_file()and not path.is_symlink()and CORE.OPS.L.file_hash(path)==manifest[name])
 with contextlib.closing(CORE.OPS.L.connect(path,True))as db:old=selected_state(db)
 private('reviewed-predeployment-mail-state.private.json',old);current_states={v['Id']:v for v in current['states']};comparison=[]
 for row in old['states']:
  now=current_states.get(row['Id']);comparison.append({'stateId':row['Id'],'historicalLastUid':row.get('LastUid'),'historicalErrorCategory':error_category(row.get('LastError')),'historicalStoredLastErrorSanitized':safe_last_error(row.get('LastError')),'sourceUidMentionedInHistoricalError':SOURCE_UID in safe_last_error(row.get('LastError'))['blockedUIDs'],'currentLastUidSame':bool(now and row.get('LastUid')==now.get('LastUid')),'currentUidValiditySame':bool(now and row.get('UidValidity')==now.get('UidValidity')),'currentErrorByteIdentical':bool(now and row.get('LastError')==now.get('LastError')),'historicalLastSuccessAt':safe_date(row.get('LastSuccessAt'))})
 return {'historicalEvidenceOnlyNotCurrentState':True,'reviewedBackupManifestAndResultVerified':True,'selectedClosedSQLiteManifestEntryVerified':True,'reviewedBackupRunPredatesLatestDeployment':True,'latestApiContainerStartedAt':safe_date(raw['voyageplex-api']['State'].get('StartedAt')),'sourceUid':SOURCE_UID,'states':comparison,'symptomPredatesLatestDeployment':any(v['sourceUidMentionedInHistoricalError']for v in comparison),'scopeOfChronologyClaim':'reviewed-backup05-before-current-api-deployment-only'}

def log_capture(service,cid,args=None):
 path=OUT/(service+'-last24h.private.log');limit=64*1024**2;deadline=time.monotonic()+60;total=0;truncated=False;timed=False
 with path.open('xb')as output:
  process=subprocess.Popen(args or['docker','logs','--timestamps','--since','24h','--tail','50000',cid],stdout=subprocess.PIPE,stderr=subprocess.STDOUT,cwd=ROOT)
  try:
   while True:
    remaining=deadline-time.monotonic()
    if remaining<=0 or not select.select([process.stdout],[],[],remaining)[0]:timed=True;break
    block=os.read(process.stdout.fileno(),min(65536,limit-total))
    if not block:break
    output.write(block);total+=len(block)
    if total==limit:truncated=True;break
  finally:
   if process.poll()is None:process.kill()
   process.wait(timeout=3);process.stdout.close();output.flush();os.fsync(output.fileno())
 counts=collections.Counter();owners={};first=None;last=None;lines=0;events=[];event_count=0
 with path.open('rb')as stream,(OUT/(service+'-safe-events.private.jsonl')).open('xb')as safe_events:
  for rawline in stream:
   lines+=1;line=rawline[:65536].decode('utf-8','replace');event=structured_event(line,service)
   if event:event_count+=1;events.append(event);events=events[-80:];safe_events.write(enc(event)+b'\n')
   stamp=re.match(r'^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.\d+)?Z ',line);matched=False
   for label,pattern in [('http429',r'HTTP(?:/[0-9.]+)?[\"\s:]+429\b|status(?: code)?\s*[:=]?\s*429\b|(?:Received HTTP response headers|End processing HTTP request) after [0-9.]+ms - 429\b|Too Many Requests'),('timeout',r'timeout|timed out|TimeoutException|超时'),('cancelled',r'cancelled|canceled|CancelledError|TaskCanceledException|OperationCanceledException|取消'),('http502',r'HTTP(?:/[0-9.]+)?[\"\s:]+502\b|status(?: code)?\s*[:=]?\s*502\b|Bad Gateway'),('sync-failed',r'邮箱.*同步失败|邮箱同步写入失败'),('parser-worker',r'fetch_mailbox|poll_mailbox|parser.*(?:fail|error)|worker.*(?:timeout|cancel)'),('shutdown',r'Application is shutting down|BackgroundService failed'),('inflight-control',r'in.?flight|semaphore|concurrency|并发|already.*sync')]:
    if re.search(pattern,line,re.I):counts[label]+=1;matched=True
   owner=re.search(r'邮箱\s+(Huadeng:(?:2|3|5|6)|Xingxin:)\s+同步失败[：:]\s*([A-Za-z_][A-Za-z0-9_]*)',line)
   if owner:owners.setdefault(owner[1],collections.Counter())[owner[2]if owner[2]in EXCEPTIONS else'OtherExceptionType']+=1
   if stamp and matched:first=first or stamp[1]+'Z';last=stamp[1]+'Z'
 return {'requestedLastHours':24,'regularFileTailMayIncludeOlderRows':args is not None,'tailLineLimit':50000,'byteLimit':limit,'returnedBytes':total,'returnedLines':lines,'truncated':truncated,'timedOut':timed,'dockerClientReturnCode':process.returncode,'rawPrivateLogSHA256':CORE.OPS.L.file_hash(path),'classifiedCounts':dict(counts),'mailboxExceptionCounts':{k:dict(v)for k,v in owners.items()},'firstClassifiedUtc':first,'lastClassifiedUtc':last,'structuredEventCount':event_count,'safeStructuredEventArchiveSHA256':CORE.OPS.L.file_hash(OUT/(service+'-safe-events.private.jsonl')),'latestSafeStructuredEvents':events[-6:],'perCompanyLatestDirectFailure':{company:next((e for e in reversed(events)if e['companyDirectlyLogged']==company and(e['exceptionTypes']or e['networkErrorCodes']or e['statusDirectlyLogged']and e['statusDirectlyLogged']>=400)),None)for company in('Xingxin','Huadeng')},'publicStructuredEventsTruncated':event_count>6,'allRetainedStructuredEventsPrivatelyArchived':True,'fullHistoryCompletenessProven':False,'perCompanyFullRequestChainCorrelationProven':False,'httpStatusCountsAreObservedLogMarkersOnly':True}

def nginx_evidence():
 code,blob=capture(['docker','inspect','rr-portal-nginx-1'],'nginx-inspect');need(code==0);records=json.loads(blob);need(len(records)==1);row=records[0];need((row.get('Config',{}).get('Labels')or{}).get('com.docker.compose.service')=='nginx'and(row.get('Config',{}).get('Labels')or{}).get('com.docker.compose.project')=='rr-portal');private('nginx-inspect.private.json',row);mounts=[m for m in row.get('Mounts',[])if m.get('Destination')=='/etc/nginx/nginx.conf'];need(len(mounts)==1 and mounts[0].get('Type')=='bind'and mounts[0].get('RW')is False)
 code,config=capture(['docker','exec',row['Id'],'cat',mounts[0]['Destination']],'actual-nginx-configuration');need(code==0);paths={}
 for kind,path in re.findall(rb'^\s*(access_log|error_log)\s+([^;\s]+)',config,re.M):
  value=path.decode();need(re.fullmatch(r'/var/log/nginx/[A-Za-z0-9_.-]+\.log',value));paths[kind.decode()]=value
 facts={};logs={};private('nginx-actual-log-paths.private.json',paths)
 for kind,path in paths.items():
  script='if [ -L "$1" ]; then printf "symlink\\n"; readlink "$1"; elif [ -f "$1" ]; then printf "regular\\n"; else printf "unavailable\\n"; fi';code,metadata=capture(['docker','exec',row['Id'],'sh','-c',script,'fixed-nginx-log-path-kind',path],'nginx-'+kind+'-kind');parts=metadata.decode().splitlines();mode=parts[0]if parts and parts[0]in{'symlink','regular','unavailable'}else'unknown';target=parts[1]if len(parts)>1 and parts[1]in{'/dev/stdout','/dev/stderr','/proc/1/fd/1','/proc/1/fd/2'}else None;facts[kind]={'kind':mode,'dockerStreamTarget':target,'pathDerivedFromActualMountedNginxConfiguration':True}
  if mode=='regular':logs[kind]=log_capture('nginx-'+kind,row['Id'],['docker','exec',row['Id'],'tail','-n','50000',path])
 if any(v['dockerStreamTarget']for v in facts.values()):logs['docker-streams']=log_capture('nginx-docker-streams',row['Id'])
 return {'actualConfigurationSHA256':sha(config),'logPathKinds':facts,'logs':logs,'entranceCompanyFromCookieOrAuthNotAvailableInStandardLog':True,'crossLayerRequestIdentityNotProven':True}

CGROUP_SCRIPT="""for p in memory.current memory.max memory.events cpu.stat cpu.max pids.current; do printf 'BEGIN %s\\n' "$p"; if [ -r "/sys/fs/cgroup/$p" ]; then cat "/sys/fs/cgroup/$p"; else printf 'unavailable\\n'; fi; done"""
def resource_sample(raw,label):
 samples={}
 for service,row in raw.items():
  code,data=capture(['docker','exec',row['Id'],'sh','-c',CGROUP_SCRIPT],'cgroup-'+label+'-'+service,15);items={};key=None
  for line in data.decode().splitlines():
   if line.startswith('BEGIN '):key=line[6:];items[key]=[]
   elif key and re.fullmatch(r'[a-z_0-9]+(?: [0-9]+)?|[0-9]+ [0-9]+',line):items[key].append(line)
  samples[service]={'returnCode':code,'cgroup':items}
 host={}
 for line in pathlib.Path('/proc/meminfo').read_text().splitlines():
  match=re.fullmatch(r'(MemTotal|MemAvailable|MemFree|SwapTotal|SwapFree):\s+([0-9]+) kB',line)
  if match:host[match[1]+'Bytes']=int(match[2])*1024
 code,stats=capture(['docker','stats','--no-stream','--format','{{json .}}',*[r['Id']for r in raw.values()]],'stats-'+label,20);private('resource-'+label+'.private.json',{'cgroups':samples,'hostMemory':host,'dockerStatsReturnCode':code,'dockerStatsRaw':stats.decode(errors='replace')});return {'atUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'hostMemory':host,'loadAverage':list(os.getloadavg()),'containers':samples}

WEB_HEALTH="""const http=require('node:http');const targets=[['web-self','http://127.0.0.1:3000/voyageplex/api/health'],['web-to-api','http://voyageplex-api:5088/api/health'],['web-to-parser','http://voyageplex-parser:8091/health']];Promise.all(targets.map(([label,url])=>new Promise(resolve=>{const start=Date.now(),r=http.get(url,{timeout:8000},s=>{let count=0;s.on('data',b=>{count+=b.length;if(count>65536)r.destroy()});s.on('end',()=>resolve({label,status:s.statusCode,elapsedMs:Date.now()-start,bodyBytes:count}))});r.on('timeout',()=>r.destroy());r.on('error',e=>resolve({label,error:['ECONNREFUSED','ENOTFOUND','ECONNRESET','ETIMEDOUT'].includes(e.code)?e.code:'OTHER',elapsedMs:Date.now()-start}))}))).then(v=>process.stdout.write(JSON.stringify(v)));"""
def health(raw):
 code,web=capture(['docker','exec',raw['voyageplex-web']['Id'],'node','-e',WEB_HEALTH],'health-from-web',30);result={'fromWeb':json.loads(web)if code==0 else{'available':False,'returnCode':code}}
 for label,url in [('api-self','http://127.0.0.1:5088/api/health'),('api-to-parser','http://voyageplex-parser:8091/health')]:
  start=time.monotonic();code,data=capture(['docker','exec',raw['voyageplex-api']['Id'],'curl','--silent','--show-error','--max-time','8','--output','/dev/null','--write-out','%{http_code}',url],label,12);result[label]={'returnCode':code,'status':int(data)if re.fullmatch(b'[0-9]{3}',data)else None,'elapsedMs':round((time.monotonic()-start)*1000)}
 return result

def source_proof(raw):
 code,head=capture(['git','rev-parse','HEAD'],'git-head');code2,tree=capture(['git','rev-parse','HEAD^{tree}'],'git-tree');h=head.decode().strip()if code==0 else None;t=tree.decode().strip()if code2==0 else None;proof={};CORE.BASE=EXPECTED_HEAD
 for service,row in raw.items():
  proof[service]=observe('source-'+service,lambda s=service,r=row:CORE.service_source_proof(s,{'id':r['Id']}))
  private(service+'-source-proof.private.json',proof[service])
 safe={}
 for service,p in proof.items():
  if service=='voyageplex-web':safe[service]={'sourceIsCompiledRuntimeOnly':True,'compiledArtifactInventoryMatchesReviewedDeployment':p.get('compiledArtifactInventorySHA256')==WEB_COMPILED_SHA,'buildIdMatchesReviewedDeployment':p.get('buildIdFileSHA256')==WEB_BUILD_ID_SHA,'compiledArtifactCount':p.get('compiledArtifactCount')}
  else:safe[service]={'available':p.get('available',True),'reviewedSourceMatch':p.get('reviewedSourceMatch'),'sourceFileCount':p.get('sourceFileCount'),'differentPathCount':len(p.get('differentPaths',[])),'codeViewMatchesPortablePdb':p.get('codeViewMatchesPortablePdb')}
 return {'actualGitHead':h if h and re.fullmatch('[a-f0-9]{40}',h)else None,'actualGitTree':t if t and re.fullmatch('[a-f0-9]{40}',t)else None,'gitHeadMatchesExpectedDeployment':h==EXPECTED_HEAD,'gitTreeMatchesExpectedDeployment':t==EXPECTED_TREE,'runtimeSources':safe}

def child_bootstrap_headroom(raw):
 script='if [ -r /sys/fs/cgroup/memory.current ] && [ -r /sys/fs/cgroup/memory.max ]; then cat /sys/fs/cgroup/memory.current /sys/fs/cgroup/memory.max; elif [ -r /sys/fs/cgroup/memory/memory.usage_in_bytes ] && [ -r /sys/fs/cgroup/memory/memory.limit_in_bytes ]; then cat /sys/fs/cgroup/memory/memory.usage_in_bytes /sys/fs/cgroup/memory/memory.limit_in_bytes; fi'
 code,data=capture(['docker','exec',raw['voyageplex-parser']['Id'],'sh','-c',script],'imap-bootstrap-memory',15);values=data.decode().splitlines();available=None;used=None;limit=None
 if code==0 and len(values)==2 and all(v.isdigit()for v in values):
  used,limit=map(int,values)
  if 0<=used<=limit<2**60:available=limit-used
 host_available=None
 for line in pathlib.Path('/proc/meminfo').read_text().splitlines():
  match=re.fullmatch(r'MemAvailable:\s+([0-9]+) kB',line)
  if match:host_available=int(match[1])*1024
 return {'currentBytes':used,'maxBytes':limit,'headroomBytes':available,'requiredHeadroomBytes':64*1024*1024,'hostMemAvailableBytes':host_available,'requiredHostAvailableBytes':128*1024*1024,'enoughAtSamplingInstant':available is not None and available>=64*1024*1024 and host_available is not None and host_available>=128*1024*1024,'concurrentGrowthNotReserved':True}

def imap_child(raw,mailboxes,body_target_slot):
 path=pathlib.Path(__file__).with_name('voyageplex-imap-readonly-child.py');need(re.fullmatch('[a-f0-9]{64}',IMAP_CHILD_SHA)and path.is_file()and not path.is_symlink()and sha(path.read_bytes())==IMAP_CHILD_SHA);memory=child_bootstrap_headroom(raw)
 if not memory['enoughAtSamplingInstant']:return {'childDeferredInsufficientMemory':True,'bootstrapMemoryGuard':memory,'accountsNotContacted':5,'bodyPeekAttempted':False}
 code=path.read_text();payload=enc({'scope':'ops/mail-readonly-20261020','mailboxes':mailboxes,'body_probe_enabled':IMAP_BODY_PROBE,'body_target_slot':body_target_slot});need(len(payload)<=65536)
 status,data=capture(['docker','exec','-i',raw['voyageplex-parser']['Id'],'python3','-B','-c',code],'imap-readonly-child',340,payload);need(status==0);report=json.loads(data);need(type(report)is dict and report.get('scope')=='ops/mail-readonly-20261020'and report.get('success')is True and type(report.get('accounts'))is list and len(report['accounts'])==5 and{v.get('slot')for v in report['accounts']}=={'xingxin','huadeng-1','huadeng-2','huadeng-3','huadeng-4'});private('imap-readonly-report.private.json',report);return dict(report,bootstrapMemoryGuard=memory)

def state_after():
 with contextlib.closing(readonly_live())as db:value=selected_state(db);private('mail-state-after.private.json',value);return value

def main():
 global CORE,STAGE
 need(DIAG_PIN and sys.argv[1:]==['observe']and os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_ATTEMPT')=='1');os.umask(0o077);OUT.mkdir(mode=0o700);path=pathlib.Path(__file__).with_name('batch-backup-library.py');need(path.is_file()and not path.is_symlink()and sha(path.read_bytes())==CORE_SHA);spec=importlib.util.spec_from_file_location('readonly_core',path);CORE=importlib.util.module_from_spec(spec);spec.loader.exec_module(CORE);CORE.OUT=OUT;CORE.initialize();CORE.BASE=EXPECTED_HEAD
 def stop(*_):raise RuntimeError('READONLY_DIAGNOSTIC_TERMINATED')
 signal.signal(signal.SIGTERM,stop);result={'mode':'voyageplex-mail-readonly','success':False,'observedAtUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'businessOrConfigurationWritesPerformed':False,'mailboxApiSyncTestParseCalled':False,'applicationContainerSignalsPerformed':False,'sessionsCreated':False,'mailboxCursorsSkippedOrReset':False,'mailboxSyncRecovered':False,'rawSecretsOrMailContentPrinted':False}
 try:
  STAGE='fresh-runtime';raw=inspect_live();result['runtimeBefore']=runtime_facts(raw)
  STAGE='configuration-private-evidence';config,entries=configuration(raw);result['configuration']=config
  STAGE='consistent-query-only-mail-state';dbfacts,mailboxes,before=database_snapshot(entries,environment(raw['voyageplex-parser']));result['database']=dbfacts
  STAGE='reviewed-prior-deployment-timeline';result['historicalTimeline']=observe('historical-timeline',lambda:historical_timeline(before,raw))
  STAGE='first-resource-sample';result['resourcesFirst']=observe('resources-first',lambda:resource_sample(raw,'first'))
  STAGE='private-bounded-last24h-chain-logs';result['logs']={s:observe('logs-'+s,lambda s=s:log_capture(s,raw[s]['Id']))for s in SERVICES}
  STAGE='actual-nginx-entrance-log-evidence';result['nginx']=observe('nginx-evidence',nginx_evidence)
  STAGE='safe-network-health-only';result['health']=observe('health',lambda:health(raw))
  STAGE='current-version-and-source';result['version']=observe('version',lambda:source_proof(raw))
  STAGE='evidence-first-readonly-imap';result['imap']=observe('imap-child',lambda:imap_child(raw,mailboxes,dbfacts['bodyTargetSlotFromUniqueStoredBlockedUID']));result['imapEligibleMailboxCount']=len(mailboxes)
  STAGE='resource-after-imap-observation';time.sleep(2);result['resourcesSecond']=observe('resources-second',lambda:resource_sample(raw,'second'))
  STAGE='final-live-readonly-state';after=state_after();result['selectedStateUnchangedDuringObservation']=enc(after)==enc(before);result['selectedStateAfterSHA256']=sha(enc(after));result['stateChangesAreObservedNotAttributed']=True
  STAGE='final-runtime-environment-fingerprints';code,final=capture(['docker','inspect',*[r['Id']for r in raw.values()]],'final-runtime');need(code==0);finalraw={(r.get('Config',{}).get('Labels')or{}).get('com.docker.compose.service'):r for r in json.loads(final)};result['runtimeAfter']=runtime_facts(finalraw);result['sameContainerIdsImagesConfiguredEnvironmentsAndMounts']=all(finalraw[s]['Id']==raw[s]['Id']and finalraw[s]['Image']==raw[s]['Image']and finalraw[s]['Config']==raw[s]['Config']and finalraw[s]['Mounts']==raw[s]['Mounts']for s in SERVICES);result['privateEnvironmentFileByteIdenticalAfterObservation']=CORE.OPS.L.file_hash(ROOT/'.env.cloud.production')==config['privateEnvironmentSHA256'];result['success']=True
 except BaseException as error:result.update(failedStage=STAGE,safeError='READONLY_DIAGNOSTIC_INCOMPLETE',exceptionType=safe_type(error));private('failure-traceback.private.txt',traceback.format_exc().encode())
 finally:
  private('first-result.json',result);CORE.OPS.L.seal(OUT);safe=dict(result,manifestSHA256=CORE.OPS.L.file_hash(OUT/'manifest.json'),resultSHA256=CORE.OPS.L.file_hash(OUT/'first-result.json'));need(len(enc(safe))<65536);print(enc(safe).decode(),flush=True)
 return 0 if result['success']else 1
if __name__=='__main__':
 try:sys.exit(main())
 except Exception:print('{"success":false,"safeFailure":"VOYAGEPLEX_READONLY_DIAG_PREFLIGHT_REJECTED"}',flush=True);sys.exit(1)
