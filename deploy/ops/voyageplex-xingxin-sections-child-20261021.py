"""Disabled, fixed-UID read-only section evidence. No HTTP, MIME parse or writes."""
import base64,hashlib,importlib.util,ipaddress,json,os,pathlib,re,resource,signal,sys,threading,time,types
from datetime import datetime,timezone
from urllib.parse import quote,quote_plus
RUN_PIN=True
SCOPE='ops/voyageplex-size-fix-20261020'
SOURCE_SHA='c6246781845d4cd40439d7286c9f3afcfae0dcafc4b106de780bd715e3b201a9'
UID=1545369828;UID_VALIDITY=1;AFTER_UID=1545369827;START_DATE='2026-10-08'
MAX_BODY_BYTES=1024*1024;MAX_LITERAL_TOTAL_BYTES=1024*1024
EXPECTED_BODY_BYTES=308705
EXPECTED_BODY_SHA256='d1b24b3792af12a6d99d8725724c9a38730f8ae828449d240e407f2c37f7b87c'
_active_control=None;_dns_children=[];_events=[];_diagnostic_guards=[]
_body_attempts=0;_literal_reserved=0;_literal_actual=0;_literal_reads=0;_body_sections=set();_stage='startup';_facade=None
_identity={'advertised':None,'sent':False,'status':None};_connection={}
class DiagnosticGuard(RuntimeError):pass

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

def guard(value,label):
 if not value:
  _diagnostic_guards.append(label)
  raise DiagnosticGuard()

def safe_exception(error):
 result={'exceptionClass':exception_name(error),'sanitizedServerError':sanitized_server_error(error),'diagnosticGuard':isinstance(error,DiagnosticGuard)}
 if type(getattr(error,'errno',None))is int:result['errno']=error.errno
 return result

def runtime_private_values():
 address=os.environ.get('VOYAGEPLEX_MAIL_ADDRESS','').strip();secret=os.environ.get('VOYAGEPLEX_MAIL_AUTH_CODE','')
 return(address,secret,address.split('@',1)[0]if '@'in address else address)

def no_response_detail(parts,private_values):
 """Only tagged NO primitives; never inspect or emit a FETCH literal tuple."""
 values=[parts]if type(parts)is bytes else parts if type(parts)is list else None
 if values is None or not values or len(values)>8 or any(type(v)is not bytes for v in values):return{'textOmitted':'nonprimitive-response-shape'}
 raw=b' '.join(values);result={'responseBytes':len(raw),'responseSHA256':hashlib.sha256(raw).hexdigest()}
 if len(raw)>1024:result['textOmitted']='response-over-1024-bytes';return result
 if any(v in raw for v in(b'\r',b'\n',b'\0')):result['textOmitted']='multiline-or-binary';return result
 try:text=raw.decode('utf-8')
 except UnicodeDecodeError:result['textOmitted']='non-utf8-response';return result
 if re.search(r'(?i)\b(?:subject|from|to|cc|bcc|mime-version|content-type|content-transfer-encoding|content-disposition|body)\s*:|BODY(?:\.PEEK)?\[[^\]]*\]\s*(?:<[0-9]+>)?\s*\{[0-9]+\}|<!doctype|<html|<\?xml',text):
  result['textOmitted']='mail-header-body-or-literal-marker';return result
 variants=set()
 for value in private_values:
  if type(value)is not str or not value:continue
  variants.update((value,quote(value,safe=''),quote_plus(value,safe=''),json.dumps(value,ensure_ascii=True)[1:-1]))
  for encoded in(base64.b64encode(value.encode()).decode(),base64.urlsafe_b64encode(value.encode()).decode()):variants.update((encoded,encoded.rstrip('=')))
 for value in sorted(variants,key=len,reverse=True):text=re.sub(re.escape(value),'<redacted>',text,flags=re.I)
 text=''.join(c if ord(c)>=32 and ord(c)!=127 else' 'for c in text)
 text=re.sub(r'(?i)[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}','<mailbox>',text)
 def ipv6(match):
  value=match[0]
  try:ipaddress.IPv6Address(value.split('%',1)[0]);return'<ip>'
  except ValueError:return value
 text=re.sub(r'(?<![A-Za-z0-9])(?:[0-9A-Fa-f]{0,4}:){2,}[0-9A-Fa-f:.%]*(?![A-Za-z0-9])',ipv6,text)
 text=re.sub(r'(?<![A-Za-z0-9])(?:[0-9]{1,3}\.){3}[0-9]{1,3}(?![A-Za-z0-9])','<ip>',text)
 text=re.sub(r'(?i)\b(auth(?:code|_code)?|authorization|password|passwd|token|secret|username|user|account|address|email|name)\s*[:=]\s*(?:"[^"]*"|\x27[^\x27]*\x27|[^;,]+)',lambda m:m[1]+'=<redacted>',text)
 result['sanitizedTechnicalText']=text[:1024];return result

def validate_input(value):
 need(type(value)is dict and set(value)=={'scope','uid','expected_uid_validity','after_uid','start_date'})
 need(value=={'scope':SCOPE,'uid':UID,'expected_uid_validity':UID_VALIDITY,'after_uid':AFTER_UID,'start_date':START_DATE})
 need(all(type(value[k])is int for k in('uid','expected_uid_validity','after_uid')))

def section_literal(parts,section):
 """Exact full HEADER/TEXT response framing; never decode the literal itself."""
 need(section in{'HEADER','TEXT'}and type(parts)is list)
 groups=[];current=[]
 for part in parts:
  header=part[0]if type(part)is tuple and len(part)==2 else part
  if not isinstance(header,bytes):continue
  if re.match(rb'^\d+ \(',header)and current:groups.append(current);current=[]
  current.append(part)
 if current:groups.append(current)
 matches=[];attribute=b'BODY['+section.encode()+b']'
 for group in groups:
  header=b' '.join(p[0]if isinstance(p,tuple)else p for p in group)
  if {int(v)for v in re.findall(rb'\bUID ([0-9]+)\b',header)}=={UID}and attribute in header:matches.append(group)
 need(len(matches)==1);group=matches[0];literals=[p for p in group if isinstance(p,tuple)];need(len(literals)==1)
 header,raw=literals[0];declared=re.search(rb'\b'+re.escape(attribute)+rb' \{([0-9]+)\}$',header)
 closing=b' '.join(p[0]if isinstance(p,tuple)else p for p in group)
 need(declared is not None and type(raw)is bytes and len(raw)==int(declared[1])and closing.rstrip().endswith(b')'))
 return raw

def metadata_facts(mailbox,parts):
 shape=fetch_shape(mailbox,parts,UID);group=mailbox.response_for_uid(parts,UID);header=b' '.join(p[0]if isinstance(p,tuple)else p for p in group);flags=re.findall(rb'\bFLAGS \(([^)]*)\)',header)
 system={'\\answered','\\flagged','\\deleted','\\seen','\\draft','\\recent'};tokens=flags[0].decode('ascii','replace').split()if len(flags)==1 else[]
 shape.update(flagsPresent=len(flags)==1,systemFlags=sorted({v.lower()for v in tokens if v.lower()in system}),unknownFlagCount=sum(v.lower()not in system for v in tokens),deleted=any(v.lower()=='\\deleted'for v in tokens)if len(flags)==1 else None)
 return shape

def matches_original(raw):
 return type(raw)is bytes and len(raw)==EXPECTED_BODY_BYTES and hashlib.sha256(raw).hexdigest()==EXPECTED_BODY_SHA256

def primitive_no_without_fetch_literal(parts):
 return type(parts)is list and 0<len(parts)<=8 and all(type(p)is bytes and not re.search(rb'(?:^\d+ \(|\bBODY(?:\.PEEK)?\[[^\]]*\]|\{[0-9]+\})',p)for p in parts)

def instrument(mailbox):
 global _facade
 original_class=mailbox.BoundedImap;_facade=types.SimpleNamespace(response_for_uid=mailbox.response_for_uid,received_at_from_fetch=mailbox.received_at_from_fetch,complete_body_literal=mailbox.complete_body_literal)
 class ObservedImap(original_class):
  def __init__(self,*args,**kwargs):
   global _active_control
   _active_control=kwargs.get('control');self.probe_phase='connect';self.probe_metadata_size=None;super().__init__(*args,**kwargs);_active_control=self.control
  def _create_socket(self,timeout):
   value=super()._create_socket(timeout)
   try:
    peer=ipaddress.ip_address(value.getpeername()[0]);version=value.version();_connection.update(peerFamily=int(value.family),peerAddressSHA256=hashlib.sha256(peer.compressed.encode()).hexdigest(),tlsProtocol=version if version in{'TLSv1.2','TLSv1.3'}else'OTHER')
   except Exception as error:_connection['inspectionExceptionClass']=exception_name(error)
   return value
  def _simple_command(self,name,*args):
   if name!='ID':return super()._simple_command(name,*args)
   _identity['sent']=True
   try:status,data=super()._simple_command(name,*args);_identity['status']=status_name(status);return status,data
   except Exception as error:_identity['exceptionClass']=exception_name(error);raise
  def login(self,*args,**kwargs):
   status,data=super().login(*args,**kwargs);_identity['advertised']=b'ID'in self.capabilities or'ID'in self.capabilities;return status,data
  def read(self,size):
   global _literal_reserved,_literal_actual,_literal_reads
   _literal_reads+=1
   event={'stage':'literal-preallocation','section':self.probe_phase,'declaredBytes':size,'remainingLiteralBudget':self.literal_limit};_events.append(event)
   guard(self.probe_phase in{'FULL','HEADER','TEXT'}and type(size)is int and 0<=size<=MAX_BODY_BYTES and _literal_reserved+size<=MAX_LITERAL_TOTAL_BYTES,'one-mib-cumulative-literal-cap')
   _literal_reserved+=size;raw=super().read(size);_literal_actual+=len(raw);event['actualBytes']=len(raw);return raw
 mailbox.BoundedImap=ObservedImap
 original_popen=mailbox.subprocess.Popen
 def tracked_popen(*args,**kwargs):
  process=original_popen(*args,**kwargs);_dns_children.append(process);return process
 mailbox.subprocess.Popen=tracked_popen

def fetch(client,fields,section=None):
 global _stage,_body_attempts
 allowed={'(UID FLAGS INTERNALDATE RFC822.SIZE)','(BODY.PEEK[])','(BODY.PEEK[HEADER])','(BODY.PEEK[TEXT])'};need(fields in allowed)
 _stage=section or'metadata';client.probe_phase=section or'metadata';event={'stage':_stage,'startedAtUtc':utcnow()};clock=time.monotonic();before=_literal_reserved;before_reads=_literal_reads
 try:
  client.control.check(client.deadline)
  if section:
   guard(section in{'FULL','HEADER','TEXT'}and section not in _body_sections and _body_attempts<3,'each-full-section-once');event['memoryGuard']=memory_headroom(MAX_LITERAL_TOTAL_BYTES-_literal_reserved);guard(event['memoryGuard']['enoughAtSamplingInstant'],'body-memory-headroom');_body_sections.add(section);_body_attempts+=1
  status,parts=client.uid('FETCH',str(UID),fields);event['status']=status_name(status)
  if status=='NO':event['noResponse']=no_response_detail(parts,runtime_private_values())
  elif status!='OK':event['sanitizedServerError']=sanitized_server_error(parts)
  event['literalDeclaredBytesInCommand']=_literal_reserved-before;event['literalReadCallsInCommand']=_literal_reads-before_reads;return status,parts,event
 except Exception as error:event.update(safe_exception(error));raise
 finally:event.update(finishedAtUtc=utcnow(),elapsedMilliseconds=round((time.monotonic()-clock)*1000));_events.append(event)

def session(mailbox):
 global _active_control,_stage
 control=mailbox.MailboxControl();_active_control=control;deadline=time.monotonic()+45;timer=threading.Timer(45,control.expire_fetch);timer.daemon=True;timer.start();client=None;raw=None;header=None;text=None;parts=None
 result={'startedAtUtc':utcnow(),'recoveredOriginalBody':False,'fullBodyHashMatchedOriginal':False,'joinedSectionsHashMatchedOriginal':False,'singleExamineSession':True,'searchWasFixedUIDOnly':True,'sessionBudgetSeconds':45}
 try:
  client=mailbox.BoundedImap(os.environ.get('VOYAGEPLEX_MAIL_IMAP_HOST','imaphz.qiye.163.com'),993,timeout=20,control=control,deadline=deadline);client.debug=0
  _stage='login';control.check(deadline);status,_=client.login(os.environ.get('VOYAGEPLEX_MAIL_ADDRESS','').strip(),os.environ.get('VOYAGEPLEX_MAIL_AUTH_CODE',''));result['loginStatus']=status_name(status);need(status=='OK');control.check(deadline);mailbox.identify_client(client)
  _stage='examine';control.check(deadline);folder=os.environ.get('VOYAGEPLEX_MAIL_FOLDER','INBOX');status,_=client.select(folder,readonly=True);result['examineStatus']=status_name(status);need(status=='OK')
  status,values=client.response('UIDVALIDITY');validity=int(values[0])if status=='UIDVALIDITY'and values and values[0]else 0;result['initialUidValidityMatches']=validity==UID_VALIDITY;need(result['initialUidValidityMatches'])
  status,parts,event=fetch(client,'(UID FLAGS INTERNALDATE RFC822.SIZE)');before=metadata_facts(_facade,parts)if status=='OK'else None;result['metadataBefore']=before;need(before and before['productionProtocolAccepted']and 0<before['metadataRfc822Size']<=MAX_BODY_BYTES)
  _stage='fixed-uid-search';control.check(deadline);status,found=client.uid('SEARCH',None,'UID',str(UID));result['fixedUidSearchStatus']=status_name(status);need(status=='OK'and type(found)is list and len(found)==1 and type(found[0])is bytes and len(found[0])<=128);tokens=found[0].split();need(len(tokens)<=4 and all(v.isdigit()and 0<int(v)<=4294967295 for v in tokens));result['fixedUidSearchHitCount']=sum(int(v)==UID for v in tokens);result['fixedUidSearchUnexpectedCount']=sum(int(v)!=UID for v in tokens)
  # Set once: the underlying production reader consumes this across all sections.
  client.literal_limit=MAX_LITERAL_TOTAL_BYTES
  status,parts,event=fetch(client,'(BODY.PEEK[])','FULL')
  if status=='OK':
   result['fullBodyShape']=fetch_shape(_facade,parts,UID,before['metadataRfc822Size'],True);raw=_facade.complete_body_literal(parts,UID,before['metadataRfc822Size']);result.update(fullBodyBytes=len(raw),fullBodySHA256=hashlib.sha256(raw).hexdigest(),fullBodyHashMatchedOriginal=matches_original(raw));raw=None
  elif status=='NO'and event['literalReadCallsInCommand']==0 and event['literalDeclaredBytesInCommand']==0 and primitive_no_without_fetch_literal(parts):
   result['sectionFallbackAttempted']=True
   for section,fields in(('HEADER','(BODY.PEEK[HEADER])'),('TEXT','(BODY.PEEK[TEXT])')):
    status,parts,event=fetch(client,fields,section)
    if status=='OK':
     section_raw=section_literal(parts,section);result[section.lower()+'Section']={'accepted':True,'actualBytes':len(section_raw),'ephemeralSHA256':hashlib.sha256(section_raw).hexdigest()}
     if section=='HEADER':header=section_raw
     else:text=section_raw
    else:result[section.lower()+'Section']={'accepted':False,'status':status_name(status)}
    parts=None
   if header is not None and text is not None:
    result['joinMemoryGuard']=memory_headroom(len(header)+len(text));guard(result['joinMemoryGuard']['enoughAtSamplingInstant'],'join-memory-headroom');raw=header+text;result.update(joinedSectionsBytes=len(raw),joinedSectionsSHA256=hashlib.sha256(raw).hexdigest(),joinedSectionsHashMatchedOriginal=matches_original(raw));raw=None;header=None;text=None
  status,parts,event=fetch(client,'(UID FLAGS INTERNALDATE RFC822.SIZE)');after=metadata_facts(_facade,parts)if status=='OK'else None;result['metadataAfter']=after;result['metadataStable']=bool(after and after['productionProtocolAccepted']and all(before[k]==after[k]for k in('internalDateUTC','metadataRfc822Size','returnedTargetUidPresent','uniqueMatchedTargetGroup')))
  _stage='fresh-namespace-status';control.check(deadline);status,values=client.status(folder,'(UIDVALIDITY)');result['freshNamespaceStatus']=status_name(status);matches=[]
  if status=='OK'and type(values)is list:
   for value in values:
    if type(value)is bytes:
     match=re.fullmatch(rb'(?i)"?INBOX"? \(UIDVALIDITY ([0-9]+)\)',value)
     if match:matches.append(int(match[1]))
  result['freshUidValidityMatches']=matches==[UID_VALIDITY]
  result['recoveredOriginalBody']=bool(result['initialUidValidityMatches']and result['freshUidValidityMatches']and result['metadataStable']and result['fixedUidSearchHitCount']==1 and result['fixedUidSearchUnexpectedCount']==0 and(result['fullBodyHashMatchedOriginal']or result['joinedSectionsHashMatchedOriginal']))
 except Exception as error:result.update(failedStage=_stage,**safe_exception(error))
 finally:
  raw=None;header=None;text=None;parts=None;timer.cancel()
  if client is not None:
   try:client.shutdown()
   except Exception:pass
  control.client=None;_active_control=None;result['finishedAtUtc']=utcnow();result['fetchBudgetExpired']=control.fetch_expired.is_set()
 return result

def main():
 need(RUN_PIN);signal.signal(signal.SIGALRM,hard_stop);signal.signal(signal.SIGTERM,hard_stop);signal.setitimer(signal.ITIMER_REAL,120)
 soft,hard=resource.getrlimit(resource.RLIMIT_AS);cap=256*1024*1024;resource.setrlimit(resource.RLIMIT_AS,(min(cap,hard)if hard>=0 else cap,hard))
 encoded=sys.stdin.buffer.read(4097);need(len(encoded)<=4096);validate_input(json.loads(encoded))
 source=pathlib.Path('/app/app/mailbox.py');need(source.is_file()and not source.is_symlink()and hashlib.sha256(source.read_bytes()).hexdigest()==SOURCE_SHA)
 host=os.environ.get('VOYAGEPLEX_MAIL_IMAP_HOST','imaphz.qiye.163.com');need(re.fullmatch('[A-Za-z0-9.-]{1,253}',host)and os.environ.get('VOYAGEPLEX_MAIL_ADDRESS','').strip()and os.environ.get('VOYAGEPLEX_MAIL_AUTH_CODE','')and os.environ.get('VOYAGEPLEX_MAIL_FOLDER','INBOX').upper()=='INBOX')
 spec=importlib.util.spec_from_file_location('fixed_section_production_mailbox',source);mailbox=importlib.util.module_from_spec(spec);spec.loader.exec_module(mailbox);mailbox.imaplib.Debug=0;instrument(mailbox);evidence=session(mailbox)
 result={'success':True,'scope':SCOPE,'uid':UID,'mailboxSourceSHA256':SOURCE_SHA,'actualImapHost':host,'port':993,'folderIsInbox':True,'evidence':evidence,'protocolEvents':_events,'identityFacts':_identity,'connectionFacts':_connection,'diagnosticGuards':_diagnostic_guards,'bodyCommands':_body_attempts,'literalDeclaredBudgetReservedBytes':_literal_reserved,'literalActualBytesObserved':_literal_actual,'httpParseDatabaseConfigurationOrCursorWritesPerformed':False,'rawMailContentPrintedOrPersisted':False};encoded=json.dumps(result,ensure_ascii=True,separators=(',',':'),allow_nan=False);need(len(encoded)<=24000);print(encoded,flush=True);signal.setitimer(signal.ITIMER_REAL,0)

if __name__=='__main__':
 try:main()
 except BaseException:print('{"success":false,"safeFailure":"FIXED_SECTION_READONLY_PROBE_REJECTED"}',flush=True);sys.exit(1)

