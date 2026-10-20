"""LOCAL DRAFT ONLY: pure FETCH diagnostics for one future pinned read-only job.

No configuration/credentials, database, HTTP, IMAP session or connection is read
or created by this module. Root must bind a fresh server baseline and exact
container/source pins before providing an already EXAMINE-selected IMAP client.
Never call application poll/test/sync/retry, parse mail, or persist raw bytes.
"""
import hashlib,importlib.util,json,os,pathlib,re,resource,signal,ssl,sys,threading,time
from datetime import date,timedelta,datetime,timezone

RUN_PIN=False
BODY_PEEK_PIN=False
SCOPE='ops/mail-readonly-20261020'
MAILBOX_SOURCE_SHA='4707664cb2a158c76f5df639972b3d7c475cead0f1297d0b8c52b125dbed267e'
BODY_ACCOUNT_LABELS={'xingxin','huadeng-1','huadeng-2','huadeng-3','huadeng-4'}
BODY_TARGET_UIDS={'xingxin':1545369828,'huadeng-1':1320665681,'huadeng-2':1531270833,'huadeng-3':1739454422}
MAX_BODY_BYTES=40*1024*1024
MAX_ALL_BODY_BYTES=48*1024*1024
_body_attempts=0;_body_bytes=0;_body_reserved_bytes=0;_body_attempted_slots=set()
_active_control=None;_dns_children=[]

def need(value):
 if not value:raise RuntimeError('UNPINNED_READONLY_IMAP_DIAGNOSTIC')
def utcnow():return datetime.now(timezone.utc).isoformat()
def status_name(value):return value if value in {'OK','NO','BAD','BYE','PREAUTH'}else'OTHER'
def exception_name(value):
 allowed={'TimeoutError','ConnectionResetError','ConnectionAbortedError','ConnectionRefusedError','SSLError','SSLCertVerificationError','gaierror','OSError','EOFError','abort','error','OversizedLiteral','BatchLiteralBudget','InterruptedError','RuntimeError','ValueError','MemoryError'}
 return type(value).__name__ if type(value).__name__ in allowed else'OtherException'

def memory_headroom(size):
 for current,maximum in(('/sys/fs/cgroup/memory.current','/sys/fs/cgroup/memory.max'),('/sys/fs/cgroup/memory/memory.usage_in_bytes','/sys/fs/cgroup/memory/memory.limit_in_bytes')):
  try:
   a=pathlib.Path(current).read_text().strip();b=pathlib.Path(maximum).read_text().strip()
   need(a.isdigit()and b.isdigit());used,limit=int(a),int(b);need(0<=used<=limit and limit<2**60)
   reserve=3*size+96*1024*1024
   return {'currentBytes':used,'maxBytes':limit,'requiredHeadroomBytes':reserve,'enoughAtSamplingInstant':limit-used>=reserve,'concurrentGrowthNotReserved':True}
  except Exception:continue
 return {'enoughAtSamplingInstant':False,'memoryLimitUnavailable':True,'concurrentGrowthNotReserved':True}

def hard_stop(*_):
 if _active_control is not None:
  try:_active_control.cancel()
  except Exception:pass
 for process in list(_dns_children):
  try:
   if process.poll()is None:process.kill()
   process.wait(timeout=.25)
  except Exception:pass
 os._exit(124)

def sanitized_server_error(value,secrets=()):
 """Emit only fixed technical codes/phrases, never unknown vendor words.

 This also handles FETCH errors that could contain arbitrary message bytes.
 Do not stringify arbitrary objects/exceptions or echo usernames/response text.
 """
 if isinstance(value,BaseException):value=value.args
 values=value[:3]if isinstance(value,(list,tuple))else[value]
 text=' '.join(v[:4096].decode('utf-8','replace')if isinstance(v,bytes)else v[:4096]if isinstance(v,str)else''for v in values)[:4096]
 codes={'AUTHENTICATIONFAILED','AUTHORIZATIONFAILED','UNAVAILABLE','LIMIT','INUSE','SERVERBUG','CLIENTBUG','CANNOT','ALREADYEXISTS','NONEXISTENT','BADCHARSET','CONTACTADMIN','PRIVACYREQUIRED','EXPIRED','CORRUPTION','ALERT','PARSE','TRYCREATE','READ-ONLY','READ-WRITE'}
 phrases=('too many connections','too many requests','unsafe login','authentication failed','authorization failed','invalid credentials','login failed','login fail','imap disabled','imap service disabled','service not available','rate limit','system busy','server busy','connection reset by peer','connection refused','connection closed','socket closed','timed out','timeout','certificate verify failed','name or service not known','temporary failure in name resolution','unexpected response','邮箱服务器域名解析失败','邮箱服务器连接失败','邮箱服务器拒绝客户端身份声明','本轮邮箱读取已达到时间预算','邮箱读取已取消')
 result=[]
 for code in re.findall(r'\[([A-Z-]+)(?:\s[^\]]*)?\]',text.upper()):
  if code in codes and '['+code+']'not in result:result.append('['+code+']')
 for status in('NO','BAD','BYE'):
  if re.search(r'(?:^|\s)'+status+r'\b',text,re.I):result.append(status)
 for phrase in phrases:
  if re.search(r'(?<![A-Za-z])'+re.escape(phrase)+r'(?![A-Za-z])',text,re.I):result.append(phrase)
 return ' | '.join(result)[:256]if result else'unrecognizedServerError'

def fetch_failure(error):
 result={'exceptionClass':exception_name(error),'sanitizedServerError':sanitized_server_error(error)}
 if type(getattr(error,'errno',None))is int:result['errno']=error.errno
 return result

def validate_body_targets(value):
 need(type(value)is dict and len(value)<=len(BODY_TARGET_UIDS))
 need(all(slot in BODY_TARGET_UIDS and type(uid)is int and uid==BODY_TARGET_UIDS[slot]for slot,uid in value.items()))
 return value

def fetch_shape(mailbox,parts,uid,size=None,body=False):
 """No message/header content is emitted: technical framing, sizes and hashes only."""
 need(type(uid)is int and 0<uid<=4294967295 and isinstance(parts,list))
 headers=[p[0]if isinstance(p,tuple)and len(p)==2 else p for p in parts]
 need(all(isinstance(h,bytes)or h is None for h in headers))
 header=b' '.join(h for h in headers if isinstance(h,bytes))
 uids={int(v)for v in re.findall(rb'\bUID ([0-9]+)\b',header)}
 group=mailbox.response_for_uid(parts,uid,body=body)
 matched_header=b' '.join(p[0]if isinstance(p,tuple)else p for p in group)
 literals=[p for p in group if isinstance(p,tuple)]
 declared=[int(v)for v in re.findall(rb'\bBODY\[\](?:<[0-9]+>)? \{([0-9]+)\}',matched_header)]
 sizes=[int(v)for v in re.findall(rb'\bRFC822\.SIZE ([0-9]+)\b',matched_header)]
 result={'nativePartCount':len(parts),'nativeLiteralTupleCount':sum(isinstance(p,tuple)for p in parts),'nativeFetchGroupStarts':sum(bool(re.match(rb'^\d+ \(',h))for h in headers if isinstance(h,bytes)),'returnedUidCount':len(uids),'returnedTargetUidPresent':uid in uids,'uniqueMatchedTargetGroup':bool(group),'matchedLiteralCount':len(literals),'bodyAttributePresent':b'BODY[]'in matched_header,'partialBodyAttributePresent':bool(re.search(rb'BODY\[\]<[0-9]+>',matched_header)),'literalDeclaredByteCounts':declared,'groupClosingParenthesis':matched_header.rstrip().endswith(b')'),'metadataRfc822Size':sizes[0]if len(sizes)==1 else None,'advertisedMessageBytes':size,'productionProtocolAccepted':False}
 uid_pattern=rb'\bUID '+str(uid).encode()+rb'\b';seen_literal=False;after_literal=False
 for part in group:
  if isinstance(part,tuple):seen_literal=True
  elif seen_literal and isinstance(part,bytes)and re.search(uid_pattern,part):after_literal=True
 result.update(uidTokenInLiteralHeader=any(bool(re.search(uid_pattern,p[0]))for p in literals),uidTokenAfterLiteral=after_literal)
 if not body:
  try:
   result['internalDateUTC']=mailbox.received_at_from_fetch(group)
   result['productionProtocolAccepted']=bool(group)and len(sizes)==1
  except Exception as error:result['validationExceptionClass']=exception_name(error)
  return result
 result['productionFramingAcceptedWithObservedLengthForDiagnosis']=False
 raw=literals[0][1]if len(literals)==1 and isinstance(literals[0][1],bytes)else None
 if raw is not None:
  result.update(actualLiteralBytes=len(raw),rfc822SizeMinusActualBytes=size-len(raw)if type(size)is int else None,ephemeralBodySHA256=hashlib.sha256(raw).hexdigest())
  try:
   # Diagnostic only: retain the actual RFC-size validator result separately.
   mailbox.complete_body_literal(parts,uid,len(raw));result['productionFramingAcceptedWithObservedLengthForDiagnosis']=True
  except Exception as error:
   result['productionFramingAcceptedWithObservedLengthForDiagnosis']=False;result['framingValidationExceptionClass']=exception_name(error)
 try:
  complete=mailbox.complete_body_literal(parts,uid,size);need(len(complete)<=MAX_BODY_BYTES);result['productionProtocolAccepted']=True
 except Exception as error:result['validationExceptionClass']=exception_name(error)
 return result

def inspect_one_uid(client,mailbox,account_label,uid,expected_uid_validity,observed_uid_validity,body_target_slots=None):
 """Requires EXAMINE already selected by the future root-owned bounded adapter.

 At most two metadata requests and one BODY.PEEK[] per fixed mailbox target.
 No SEARCH, parsing, STORE/EXPUNGE, application endpoint, cursor or database write.
 The real production mailbox module must be source-hash checked by the adapter.
 """
 global _body_attempts,_body_bytes,_body_reserved_bytes
 need(RUN_PIN and type(uid)is int and 0<uid<=4294967295 and type(expected_uid_validity)is int and 0<expected_uid_validity<=4294967295)
 need(getattr(client,'state',None)=='SELECTED'and getattr(client,'is_readonly',False)is True)
 need(type(observed_uid_validity)is int and 0<observed_uid_validity<=4294967295)
 output={'uid':uid,'namespaceMatchesExpected':observed_uid_validity==expected_uid_validity,'metadataAttempts':[],'readOnlyExamineRequired':True,'bodyPeekAttempted':False,'cursorChangesPerformed':False,'rawBodyOrHeadersPrintedOrPersisted':False}
 if observed_uid_validity!=expected_uid_validity:return output
 sizes=[]
 for _ in range(2):
  start=time.monotonic();started=utcnow()
  try:
   if hasattr(client,'literal_limit'):client.literal_limit=0
   status,parts=client.uid('FETCH',str(uid),'(UID INTERNALDATE RFC822.SIZE)')
   attempt={'stage':'metadata-fetch','status':status_name(status),'elapsedMilliseconds':round((time.monotonic()-start)*1000),'shape':fetch_shape(mailbox,parts,uid)if status=='OK'and isinstance(parts,list)else None}
   if status!='OK':attempt['sanitizedServerError']=sanitized_server_error(parts)
   if attempt['shape']and attempt['shape']['productionProtocolAccepted']:sizes.append(attempt['shape']['metadataRfc822Size'])
  except Exception as error:attempt={'stage':'metadata-fetch',**fetch_failure(error),'elapsedMilliseconds':round((time.monotonic()-start)*1000)}
  attempt.update(startedAtUtc=started,finishedAtUtc=utcnow());output['metadataAttempts'].append(attempt)
  if 'exceptionClass'in attempt or attempt.get('status')!='OK':break
 targets=validate_body_targets({}if body_target_slots is None else body_target_slots)
 if not(BODY_PEEK_PIN and account_label in BODY_TARGET_UIDS and targets.get(account_label)==uid==BODY_TARGET_UIDS[account_label]):return output
 if not(len(sizes)==2 and sizes[0]==sizes[1]and 0<sizes[0]<=MAX_BODY_BYTES):return output
 if account_label in _body_attempted_slots or _body_attempts>=len(BODY_TARGET_UIDS)or _body_reserved_bytes+sizes[0]>MAX_ALL_BODY_BYTES:output['bodySkippedByGlobalBudget']=True;return output
 output['bodyMemoryGuard']=memory_headroom(sizes[0])
 if not output['bodyMemoryGuard']['enoughAtSamplingInstant']:output['bodyDeferredInsufficientMemory']=True;return output
 if hasattr(client,'literal_limit'):client.literal_limit=min(sizes[0],MAX_BODY_BYTES,MAX_ALL_BODY_BYTES-_body_reserved_bytes)
 # Reserve before the request; failed/partial reads never refund this cap.
 _body_reserved_bytes+=sizes[0];_body_attempted_slots.add(account_label)
 _body_attempts+=1;output['bodyPeekAttempted']=True;start=time.monotonic();started=utcnow()
 try:
  status,parts=client.uid('FETCH',str(uid),'(BODY.PEEK[])')
  output['bodyPeek']={'stage':'body-peek','status':status_name(status),'elapsedMilliseconds':round((time.monotonic()-start)*1000),'shape':fetch_shape(mailbox,parts,uid,sizes[0],True)if status=='OK'and isinstance(parts,list)else None}
  if status!='OK':output['bodyPeek']['sanitizedServerError']=sanitized_server_error(parts)
  if output['bodyPeek']['shape']:_body_bytes+=output['bodyPeek']['shape'].get('actualLiteralBytes',0)
 except Exception as error:output['bodyPeek']={'stage':'body-peek',**fetch_failure(error),'elapsedMilliseconds':round((time.monotonic()-start)*1000)}
 output['bodyPeek'].update(startedAtUtc=started,finishedAtUtc=utcnow())
 return output

def account_probe(mailbox,entry,dns_cache,allow_body,body_target_slots):
 """One sequential session in the actual parser network namespace, no API calls."""
 global _active_control
 slot=entry['slot'];company=entry['company'];credentials=dict(entry)
 if company=='Xingxin':
  credentials.update(address=os.environ.get('VOYAGEPLEX_MAIL_ADDRESS','').strip(),auth_code=os.environ.get('VOYAGEPLEX_MAIL_AUTH_CODE',''),host=os.environ.get('VOYAGEPLEX_MAIL_IMAP_HOST','imaphz.qiye.163.com'),folder=os.environ.get('VOYAGEPLEX_MAIL_FOLDER','INBOX'))
 address=credentials.get('address','');secret=credentials.get('auth_code','');host=credentials.get('host','');folder=credentials.get('folder','')
 result={'slot':slot,'company':company,'configured':bool(address and secret and host and folder),'stage':'configuration','imapCommandsReadOnly':True,'startedAtUtc':utcnow()};trace={};start=time.monotonic();control=mailbox.MailboxControl();client=None;timer=None;_active_control=control
 secrets=(address,secret,folder)
 if not result['configured']:result['finishedAtUtc']=utcnow();return result
 need(all(type(x)is str for x in(address,secret,host,folder))and len(address)<=254 and len(secret)<=1024 and re.fullmatch(r'[A-Za-z0-9.-]{1,253}',host)and 0<len(folder)<=100 and not any(ord(c)<32 for c in folder))
 result.update(actualImapHost=host,port=993,folderIsInbox=folder.upper()=='INBOX')
 class Context:
  def __init__(self):self.base=ssl.create_default_context()
  def __getattr__(self,name):return getattr(self.base,name)
  def wrap_socket(self,*args,**kwargs):
   now=time.monotonic();trace['tcpMilliseconds']=round((now-trace.pop('_tcpStart',now))*1000);trace['_tlsStart']=now;result['stage']='tls';return self.base.wrap_socket(*args,**kwargs)
 class Traced(mailbox.BoundedImap):
  literal_limit=0  # Greeting/login/EXAMINE/metadata never need a mail literal.
  def _resolve(self):
   result['stage']='dns';now=time.monotonic();key=(self.host,self.port)
   values=dns_cache.get(key)
   if values is None:values=super()._resolve();dns_cache[key]=values;trace['dnsCacheHit']=False
   else:trace['dnsCacheHit']=True
   trace['dnsMilliseconds']=round((time.monotonic()-now)*1000);trace['resolvedAddressCount']=len(values);trace['addressFamilies']=sorted(set(int(v[0])for v in values));trace['_tcpStart']=time.monotonic();result['stage']='tcp';return values
  def _create_socket(self,timeout):
   value=super()._create_socket(timeout);trace['tlsMilliseconds']=round((time.monotonic()-trace.pop('_tlsStart',time.monotonic()))*1000);trace['tlsVerified']=True;trace['tlsProtocol']=value.version();cipher=value.cipher();trace['tlsCipher']=cipher[0]if cipher else None;result['stage']='greeting-capability';return value
  def read(self,size):
   trace['literalReadCalls']=trace.get('literalReadCalls',0)+1;trace['maxDeclaredLiteralBytes']=max(size,trace.get('maxDeclaredLiteralBytes',0));raw=super().read(size);trace['literalBytesSuccessfullyRead']=trace.get('literalBytesSuccessfullyRead',0)+len(raw);return raw
 try:
  deadline=time.monotonic()+45;timer=threading.Timer(45,control.expire_fetch);timer.daemon=True;timer.start()
  client=Traced(host,993,timeout=20,ssl_context=Context(),control=control,deadline=deadline);client.debug=0
  result['stage']='login';control.check(deadline);status,data=client.login(address,secret);result['loginStatus']=status_name(status);need(status=='OK')
  result['stage']='client-id';control.check(deadline);mailbox.identify_client(client)
  result['stage']='examine';control.check(deadline);status,data=client.select(folder,readonly=True);result['examineStatus']=status_name(status)
  if status!='OK':result['sanitizedServerError']=sanitized_server_error(data,secrets);return result
  status,data=client.response('UIDVALIDITY');validity=int(data[0])if status=='UIDVALIDITY'and data and data[0]else 0;result['observedUidValidity']=validity;need(0<validity<=4294967295)
  expected=entry.get('expected_uid_validity');result['namespaceMatchesExpected']=type(expected)is int and validity==expected
  uid=entry.get('target_uid')
  if uid is None:
   result['stage']='uid-search';control.check(deadline);after=entry['after_uid'];since=(date.fromisoformat(entry['start_date'])-timedelta(days=1)).strftime('%d-%b-%Y')
   status,found=client.uid('SEARCH',None,'UID',str(min(after+1,4294967295))+':*','SINCE',since);result['searchStatus']=status_name(status)
   if status!='OK':result['sanitizedServerError']=sanitized_server_error(found,secrets);return result
   raw=found[0]or b'';need(isinstance(raw,bytes)and len(raw)<=65536);tokens=raw.split();need(len(tokens)<=10000 and all(t.isdigit()and 0<int(t)<=4294967295 for t in tokens));candidates=[int(t)for t in tokens if int(t)>after];result['pendingSearchCount']=len(candidates);uid=min(candidates)if candidates else None
  if uid is not None:
   result['stage']='uid-fetch';control.check(deadline)
   # An unknown namespace permits metadata facts only, never a body read.
   global BODY_PEEK_PIN
   saved=BODY_PEEK_PIN;BODY_PEEK_PIN=saved and allow_body and result['namespaceMatchesExpected']
   try:result['uidProbe']=inspect_one_uid(client,mailbox,slot,uid,expected if type(expected)is int and expected>0 else validity,validity,body_target_slots)
   finally:BODY_PEEK_PIN=saved
   result['uidProbe']['namespaceMatchesExpected']=result['namespaceMatchesExpected'];result['uidProbe']['expectedNamespaceKnown']=type(expected)is int and expected>0
   result['uidProbe']['targetIsAfterSavedCursor']=uid>entry['after_uid']
  result['stage']='complete';result['readOnlyConnectionSucceeded']=True
 except Exception as error:
  result.update(exceptionClass=exception_name(error),sanitizedServerError=sanitized_server_error(error,secrets))
  if type(getattr(error,'errno',None))is int:result['errno']=error.errno
 finally:
  if timer is not None:timer.cancel()
  if client is not None:
   try:client.shutdown()
   except Exception:pass
  control.client=None;_active_control=None;result['elapsedMilliseconds']=round((time.monotonic()-start)*1000);result['finishedAtUtc']=utcnow();result['networkAndLiteralFacts']={k:v for k,v in trace.items()if not k.startswith('_')};result['fetchBudgetExpired']=control.fetch_expired.is_set()
 return result

def main():
 need(RUN_PIN)
 signal.signal(signal.SIGALRM,hard_stop);signal.signal(signal.SIGTERM,hard_stop);signal.setitimer(signal.ITIMER_REAL,300)
 soft,hard=resource.getrlimit(resource.RLIMIT_AS);cap=256*1024*1024;resource.setrlimit(resource.RLIMIT_AS,(min(cap,hard)if hard>=0 else cap,hard))
 source=pathlib.Path('/app/app/mailbox.py');need(hashlib.sha256(source.read_bytes()).hexdigest()==MAILBOX_SOURCE_SHA)
 spec=importlib.util.spec_from_file_location('readonly_production_mailbox',source);mailbox=importlib.util.module_from_spec(spec);spec.loader.exec_module(mailbox)
 # The production resolver's only subprocess is its credential-free DNS child.
 # Register those owned processes so the hard deadline cannot orphan one.
 original_popen=mailbox.subprocess.Popen
 def tracked_popen(*args,**kwargs):
  process=original_popen(*args,**kwargs);_dns_children.append(process);return process
 mailbox.subprocess.Popen=tracked_popen
 raw=sys.stdin.buffer.read(65537);need(len(raw)<=65536);payload=json.loads(raw);need(type(payload)is dict and set(payload)=={'scope','mailboxes','body_probe_enabled','body_target_slots'}and payload['scope']==SCOPE and type(payload['body_probe_enabled'])is bool)
 validate_body_targets(payload['body_target_slots'])
 entries=payload['mailboxes'];need(type(entries)is list and len(entries)==5 and {v.get('slot')for v in entries}==BODY_ACCOUNT_LABELS)
 allowed={'slot','company','address','auth_code','host','folder','target_uid','expected_uid_validity','after_uid','start_date'}
 for entry in entries:
  need(type(entry)is dict and set(entry)<=allowed and entry.get('company')==('Xingxin'if entry['slot']=='xingxin'else'Huadeng'))
  need(type(entry.get('after_uid'))is int and 0<=entry['after_uid']<=4294967295 and type(entry.get('start_date'))is str);date.fromisoformat(entry['start_date'])
  for key in('target_uid','expected_uid_validity'):need(entry.get(key)is None or type(entry[key])is int and 0<entry[key]<=4294967295)
 mailbox.imaplib.Debug=0;cache={};accounts=[]
 for entry in sorted(entries,key=lambda v:(v['slot']!='xingxin',v['slot'])):
  started=utcnow()
  try:accounts.append(account_probe(mailbox,entry,cache,payload['body_probe_enabled'],payload['body_target_slots']))
  except Exception as error:accounts.append({'slot':entry['slot'],'company':entry['company'],'stage':'configuration','exceptionClass':exception_name(error),'startedAtUtc':started,'finishedAtUtc':utcnow()})
 result={'success':True,'scope':SCOPE,'accounts':accounts,'mailboxSourceMatched':True,'bodyLiteralBytesObserved':_body_bytes,'bodyAttempts':_body_attempts,'bodyMetadataBudgetReservedBytes':_body_reserved_bytes,'businessApiOrCursorOperationsPerformed':False,'mailParsedOrRawBodyPersistedOrPrinted':False};encoded=json.dumps(result,ensure_ascii=True,separators=(',',':'),allow_nan=False);need(len(encoded)<=24000);print(encoded,flush=True);signal.setitimer(signal.ITIMER_REAL,0)

if __name__=='__main__':
 try:main()
 except BaseException:print('{"success":false,"safeFailure":"READONLY_IMAP_DIAGNOSTIC_REJECTED"}',flush=True);sys.exit(1)
