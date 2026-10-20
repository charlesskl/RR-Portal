"""Disabled, fixed-UID read-only diagnosis of the actual production fetch path.
No application HTTP/parse calls, database, cursor, credential or configuration writes.
Root alone may activate the gate after source/runtime/state pins and peer review.
"""
import hashlib,importlib.util,json,os,pathlib,re,resource,signal,sys,threading,time,types
from datetime import datetime,timezone
RUN_PIN=False
SCOPE='ops/voyageplex-size-fix-20261020'
SOURCE_SHA='c6246781845d4cd40439d7286c9f3afcfae0dcafc4b106de780bd715e3b201a9'
UID=1545369828;UID_VALIDITY=1;AFTER_UID=1545369827;START_DATE='2026-10-08'
MAX_BODY_BYTES=1024*1024;MAX_LITERAL_TOTAL_BYTES=1024*1024
_active_control=None;_dns_children=[]
_events=[];_diagnostic_guards=[];_body_attempts=0;_literal_reserved=0;_literal_actual=0;_mode='native';_stage='startup';_facade=None

def need(value):
 if not value:raise RuntimeError('FIXED_READONLY_FETCH_PROBE_REJECTED')
def utcnow():return datetime.now(timezone.utc).isoformat()

def status_name(value):return value if value in {'OK','NO','BAD','BYE','PREAUTH'}else'OTHER'

def exception_name(value):
 allowed={'TimeoutError','ConnectionResetError','ConnectionAbortedError','ConnectionRefusedError','SSLError','SSLCertVerificationError','gaierror','OSError','EOFError','abort','error','OversizedLiteral','BatchLiteralBudget','InterruptedError','RuntimeError','ValueError','MemoryError','DiagnosticGuard'}
 return type(value).__name__ if type(value).__name__ in allowed else'OtherException'

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
 result={'nativePartCount':len(parts),'nativeLiteralTupleCount':sum(isinstance(p,tuple)for p in parts),'nativeFetchGroupStarts':sum(bool(re.match(rb'^\d+ \(',h))for h in headers if isinstance(h,bytes)),'returnedUidCount':len(uids),'returnedTargetUidPresent':uid in uids,'uniqueMatchedTargetGroup':bool(group),'matchedLiteralCount':len(literals),'bodyAttributePresent':b'BODY[]'in matched_header,'partialBodyAttributePresent':bool(re.search(rb'BODY\[\]<[0-9]+>',matched_header)),'literalDeclaredByteCounts':declared,'groupClosingParenthesis':matched_header.rstrip().endswith(b')'),'metadataRfc822Size':sizes[0]if sizes else None,'metadataSizeTokenCount':len(sizes),'advertisedMessageBytes':size,'productionProtocolAccepted':False}
 uid_pattern=rb'\bUID '+str(uid).encode()+rb'\b';seen_literal=False;after_literal=False
 for part in group:
  if isinstance(part,tuple):seen_literal=True
  elif seen_literal and isinstance(part,bytes)and re.search(uid_pattern,part):after_literal=True
 result.update(uidTokenInLiteralHeader=any(bool(re.search(uid_pattern,p[0]))for p in literals),uidTokenAfterLiteral=after_literal)
 if not body:
  try:
   result['internalDateUTC']=mailbox.received_at_from_fetch(group)
   result['productionProtocolAccepted']=bool(group)and bool(sizes)
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

class DiagnosticGuard(RuntimeError):pass

def guard(value,label):
 if not value:
  _diagnostic_guards.append(label)
  raise DiagnosticGuard()

def safe_exception(error):
 result={'exceptionClass':exception_name(error),'sanitizedServerError':sanitized_server_error(error),'diagnosticGuard':isinstance(error,DiagnosticGuard)}
 if type(getattr(error,'errno',None))is int:result['errno']=error.errno
 return result

def validate_input(value):
 need(type(value)is dict and set(value)=={'scope','uid','expected_uid_validity','after_uid','start_date'})
 need(value=={'scope':SCOPE,'uid':UID,'expected_uid_validity':UID_VALIDITY,'after_uid':AFTER_UID,'start_date':START_DATE})
 need(all(type(value[k])is int for k in('uid','expected_uid_validity','after_uid')))

def instrument(mailbox):
 global _facade
 original_class=mailbox.BoundedImap;original_complete=mailbox.complete_body_literal
 _facade=types.SimpleNamespace(response_for_uid=mailbox.response_for_uid,received_at_from_fetch=mailbox.received_at_from_fetch,complete_body_literal=original_complete)
 class ObservedImap(original_class):
  def __init__(self,*args,**kwargs):
   global _active_control,_stage
   _stage='connect';_active_control=kwargs.get('control');self.probe_phase='connect';self.probe_metadata_size=None
   super().__init__(*args,**kwargs);_active_control=self.control
  def login(self,*args,**kwargs):
   global _stage
   _stage='login';started=utcnow();clock=time.monotonic();event={'mode':_mode,'stage':'login','startedAtUtc':started}
   try:
    status,data=super().login(*args,**kwargs);event['status']=status_name(status)
    if status!='OK':event['sanitizedServerError']=sanitized_server_error(data)
    return status,data
   except Exception as error:event.update(safe_exception(error));raise
   finally:event.update(finishedAtUtc=utcnow(),elapsedMilliseconds=round((time.monotonic()-clock)*1000));_events.append(event)
  def select(self,mailbox_name='INBOX',readonly=False):
   global _stage
   guard(readonly is True,'readonly-examine-required');_stage='examine';self.probe_phase='examine';started=utcnow();clock=time.monotonic();event={'mode':_mode,'stage':'examine','startedAtUtc':started}
   try:
    status,data=super().select(mailbox_name,readonly=True);event['status']=status_name(status)
    if status!='OK':event['sanitizedServerError']=sanitized_server_error(data)
    return status,data
   except Exception as error:event.update(safe_exception(error));raise
   finally:event.update(finishedAtUtc=utcnow(),elapsedMilliseconds=round((time.monotonic()-clock)*1000));_events.append(event)
  def uid(self,command,*args):
   global _stage,_body_attempts
   guard(command=='FETCH'and len(args)==2 and args[0]==str(UID),'only-fixed-uid-fetch')
   fields=args[1];guard(fields in{'(INTERNALDATE RFC822.SIZE)','(UID INTERNALDATE RFC822.SIZE)','(BODY.PEEK[])','(UID BODY.PEEK[])'},'only-reviewed-fetch-fields')
   body='BODY.PEEK[]'in fields;self.probe_phase='body'if body else'metadata';_stage=self.probe_phase
   event={'mode':_mode,'stage':self.probe_phase,'explicitUidAttribute':fields.startswith('(UID '),'startedAtUtc':utcnow(),'productionLiteralLimitBeforeRequest':self.literal_limit};clock=time.monotonic()
   try:
    if body:
     guard(_body_attempts<2,'maximum-two-body-commands');guard(type(self.probe_metadata_size)is int and 0<self.probe_metadata_size<=MAX_BODY_BYTES,'expected-metadata-size-at-most-one-mib')
     event['bodyMemoryGuard']=memory_headroom(MAX_LITERAL_TOTAL_BYTES-_literal_reserved);guard(event['bodyMemoryGuard']['enoughAtSamplingInstant'],'body-memory-headroom');_body_attempts+=1
    status,parts=super().uid(command,*args);event['status']=status_name(status)
    if status=='OK'and isinstance(parts,list):
     if not body:
      try:
       metadata=mailbox.response_for_uid(parts,UID);header=b' '.join(p[0]if isinstance(p,tuple)else p for p in metadata);match=re.search(rb'\bRFC822\.SIZE ([0-9]+)\b',header)
       if match:self.probe_metadata_size=int(match[1])
      except Exception as error:event['budgetInspectionExceptionClass']=exception_name(error)
     try:event['shape']=fetch_shape(_facade,parts,UID,self.probe_metadata_size if body else None,body)
     except Exception as error:event['shapeInspectionExceptionClass']=exception_name(error)
    else:event['sanitizedServerError']=sanitized_server_error(parts)
    return status,parts
   except Exception as error:event.update(safe_exception(error));raise
   finally:event.update(finishedAtUtc=utcnow(),elapsedMilliseconds=round((time.monotonic()-clock)*1000));_events.append(event)
  def read(self,size):
   global _literal_reserved,_literal_actual
   event={'mode':_mode,'stage':'literal-preallocation','declaredBytes':size,'productionLiteralLimit':self.literal_limit}
   _events.append(event)
   guard(self.probe_phase=='body'and type(size)is int and 0<=size<=MAX_BODY_BYTES and _literal_reserved+size<=MAX_LITERAL_TOTAL_BYTES,'diagnostic-one-mib-cumulative-literal-cap')
   _literal_reserved+=size
   try:
    raw=super().read(size);_literal_actual+=len(raw);event['actualBytes']=len(raw);return raw
   except Exception as error:event.update(safe_exception(error));raise
 def complete(parts,uid,size):
  global _stage
  _stage='production-validator';event={'mode':_mode,'stage':'production-validator','startedAtUtc':utcnow()};clock=time.monotonic()
  try:
   raw=original_complete(parts,uid,size);event['accepted']=True;event['actualLiteralBytes']=len(raw);return raw
  except Exception as error:event.update(accepted=False,**safe_exception(error));raise
  finally:event.update(finishedAtUtc=utcnow(),elapsedMilliseconds=round((time.monotonic()-clock)*1000));_events.append(event)
 mailbox.BoundedImap=ObservedImap;mailbox.complete_body_literal=complete
 original_popen=mailbox.subprocess.Popen
 def tracked_popen(*args,**kwargs):
  process=original_popen(*args,**kwargs);_dns_children.append(process);return process
 mailbox.subprocess.Popen=tracked_popen

def native_fetch(mailbox):
 started=utcnow();clock=time.monotonic();result={'startedAtUtc':started,'selectedUID':UID,'searchPerformed':False}
 try:
  native=mailbox.fetch_mailbox(after_uid=AFTER_UID,start_date=START_DATE,company='Xingxin',selected_uids=[UID],expected_uid_validity=UID_VALIDITY)
  messages=native.get('messages',[]);need(type(messages)is list and len(messages)<=1)
  result.update(returned=True,configured=native.get('configured')is True,uidValidity=native.get('uid_validity'),blockedUID=native.get('blocked_uid'),messageCount=len(messages))
  if messages:
   entry=messages[0];need(entry.get('uid')==UID);raw=entry.get('raw');result.update(targetReturned=True,targetHasRaw=isinstance(raw,bytes),retryable=entry.get('retryable')is True,failureKind=entry.get('failure_kind')if entry.get('failure_kind')in{'metadata','body_read','message_size'}else None,receivedAtUTC=entry.get('received_at'))
   if isinstance(raw,bytes):result.update(actualRawBytes=len(raw),ephemeralRawSHA256=hashlib.sha256(raw).hexdigest())
   entry['raw']=None;raw=None
  native=None
 except Exception as error:result.update(returned=False,failedStage=_stage,**safe_exception(error))
 result.update(finishedAtUtc=utcnow(),elapsedMilliseconds=round((time.monotonic()-clock)*1000));return result

def explicit_comparison(mailbox,body):
 global _mode,_active_control,_stage
 _mode='explicit-comparison';control=mailbox.MailboxControl();_active_control=control;client=None;timer=threading.Timer(45,control.expire_fetch);timer.daemon=True;timer.start();result={'reason':'native-body-failure'if body else'native-metadata-failure','startedAtUtc':utcnow(),'bodyRequested':False}
 try:
  client=mailbox.BoundedImap(os.environ.get('VOYAGEPLEX_MAIL_IMAP_HOST','imaphz.qiye.163.com'),993,timeout=20,control=control,deadline=time.monotonic()+45);client.debug=0
  client.login(os.environ.get('VOYAGEPLEX_MAIL_ADDRESS','').strip(),os.environ.get('VOYAGEPLEX_MAIL_AUTH_CODE',''));mailbox.identify_client(client);status,_=client.select(os.environ.get('VOYAGEPLEX_MAIL_FOLDER','INBOX'),readonly=True);need(status=='OK')
  status,values=client.response('UIDVALIDITY');observed=int(values[0])if status=='UIDVALIDITY'and values and values[0]else 0;result['namespaceMatchesExpected']=observed==UID_VALIDITY;need(result['namespaceMatchesExpected'])
  status,parts=client.uid('FETCH',str(UID),'(UID INTERNALDATE RFC822.SIZE)');metadata=None
  try:metadata=fetch_shape(_facade,parts,UID)if status=='OK'and isinstance(parts,list)else None
  except Exception as error:result['metadataInspectionExceptionClass']=exception_name(error)
  result['metadataAcceptedByProductionHelpers']=bool(metadata and metadata['productionProtocolAccepted'])
  if body and result['metadataAcceptedByProductionHelpers']:
   client.literal_limit=40*1024*1024;result['bodyRequested']=True;client.uid('FETCH',str(UID),'(UID BODY.PEEK[])')
  parts=None
 except Exception as error:result.update(safe_exception(error))
 finally:
  timer.cancel()
  if client is not None:
   try:client.shutdown()
   except Exception:pass
  control.client=None;result['finishedAtUtc']=utcnow();_active_control=None
 return result

def comparison_reason(native):
 if native.get('failureKind')=='metadata':return'metadata'
 if native.get('targetHasRaw')or _diagnostic_guards:return None
 body_failed=native.get('failureKind')=='body_read'or any(e.get('mode')=='native'and e.get('stage')=='body'and('exceptionClass'in e or e.get('status')!='OK'or e.get('shape',{}).get('productionProtocolAccepted')is False)for e in _events)
 return'body'if body_failed else None

def main():
 global _stage
 need(RUN_PIN);signal.signal(signal.SIGALRM,hard_stop);signal.signal(signal.SIGTERM,hard_stop);signal.setitimer(signal.ITIMER_REAL,120)
 soft,hard=resource.getrlimit(resource.RLIMIT_AS);cap=256*1024*1024;resource.setrlimit(resource.RLIMIT_AS,(min(cap,hard)if hard>=0 else cap,hard))
 raw=sys.stdin.buffer.read(4097);need(len(raw)<=4096);validate_input(json.loads(raw))
 source=pathlib.Path('/app/app/mailbox.py');need(source.is_file()and not source.is_symlink()and hashlib.sha256(source.read_bytes()).hexdigest()==SOURCE_SHA)
 host=os.environ.get('VOYAGEPLEX_MAIL_IMAP_HOST','imaphz.qiye.163.com');address=os.environ.get('VOYAGEPLEX_MAIL_ADDRESS','').strip();secret=os.environ.get('VOYAGEPLEX_MAIL_AUTH_CODE','');folder=os.environ.get('VOYAGEPLEX_MAIL_FOLDER','INBOX');need(re.fullmatch('[A-Za-z0-9.-]{1,253}',host)and 0<len(address)<=254 and 0<len(secret)<=1024 and 0<len(folder)<=100 and not any(ord(c)<32 for c in folder))
 spec=importlib.util.spec_from_file_location('fixed_production_mailbox',source);mailbox=importlib.util.module_from_spec(spec);spec.loader.exec_module(mailbox);mailbox.imaplib.Debug=0;instrument(mailbox)
 native=native_fetch(mailbox);reason=comparison_reason(native)
 comparison=None
 if reason=='metadata':comparison=explicit_comparison(mailbox,False)
 elif reason=='body':comparison=explicit_comparison(mailbox,True)
 result={'success':True,'scope':SCOPE,'uid':UID,'mailboxSourceSHA256':SOURCE_SHA,'actualImapHost':host,'port':993,'folderIsInbox':folder.upper()=='INBOX','nativeFetch':native,'optionalExplicitComparison':comparison,'protocolEvents':_events,'diagnosticGuards':_diagnostic_guards,'bodyAttempts':_body_attempts,'literalDeclaredBudgetReservedBytes':_literal_reserved,'literalActualBytesObserved':_literal_actual,'applicationHttpParseSyncOrCursorWritesPerformed':False,'rawBodyHeadersCredentialsPrintedOrPersisted':False};encoded=json.dumps(result,ensure_ascii=True,separators=(',',':'),allow_nan=False);need(len(encoded)<=24000);print(encoded,flush=True);signal.setitimer(signal.ITIMER_REAL,0)

if __name__=='__main__':
 try:main()
 except BaseException:print('{"success":false,"safeFailure":"FIXED_READONLY_FETCH_PROBE_REJECTED"}',flush=True);sys.exit(1)

