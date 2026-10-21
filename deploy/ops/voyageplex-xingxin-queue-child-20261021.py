"""Disabled fixed-scope read-only UID queue observation. No FETCH or writes."""
import hashlib,importlib.util,json,os,pathlib,re,resource,signal,sys,threading,time
from datetime import datetime,timezone
RUN_PIN=False
SCOPE='ops/voyageplex-size-fix-20261020'
SOURCE_SHA='c6246781845d4cd40439d7286c9f3afcfae0dcafc4b106de780bd715e3b201a9'
MIN_AFTER_UID=1545369827;MAX_UID=4294967295;UID_VALIDITY=1
MAX_SEARCH_BYTES=1024*1024;MAX_UID_TOKENS=50000;MAX_SESSION_WIRE_BYTES=MAX_SEARCH_BYTES+65536
HARD_DEADLINE_SECONDS=60
_active_control=None;_dns_children=[];_diagnostic_guards=[]
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

def safe_exception(error):
 result={'exceptionClass':exception_name(error),'sanitizedServerError':sanitized_server_error(error),'diagnosticGuard':isinstance(error,DiagnosticGuard)}
 if type(getattr(error,'errno',None))is int:result['errno']=error.errno
 return result

def validate_input(value):
 need(type(value)is dict and set(value)=={'scope','after_uid','expected_uid_validity','folder'})
 need(value['scope']==SCOPE and value['folder']=='INBOX'and type(value['expected_uid_validity'])is int and value['expected_uid_validity']==UID_VALIDITY)
 need(type(value['after_uid'])is int and MIN_AFTER_UID<=value['after_uid']<=MAX_UID)
 return value['after_uid']

def search_facts(parts,after_uid):
 need(type(parts)is list and len(parts)==1 and type(parts[0])is bytes and len(parts[0])<=MAX_SEARCH_BYTES)
 raw=parts[0];need(not raw or re.fullmatch(rb'[0-9]+(?: [0-9]+)*',raw)is not None)
 tokens=raw.split();need(len(tokens)<=MAX_UID_TOKENS);values=[int(v)for v in tokens]
 need(all(0<v<=MAX_UID for v in values)and len(values)==len(set(values)))
 pending=sorted(v for v in values if v>after_uid)
 encoded=json.dumps(pending,separators=(',',':')).encode('ascii')
 return {'searchResponseValidated':True,'returnedUIDCount':len(values),'filteredAtOrBelowCursorCount':len(values)-len(pending),'pendingCount':len(pending),'pendingUIDSetSHA256':hashlib.sha256(encoded).hexdigest()}

def fresh_validity(parts):
 if type(parts)is not list:return False
 matches=[]
 for value in parts:
  if type(value)is bytes:
   match=re.fullmatch(rb'(?i)"?INBOX"? \(UIDVALIDITY ([0-9]+)\)',value)
   if match:matches.append(int(match[1]))
 return matches==[UID_VALIDITY]

def instrument(mailbox,after_uid):
 original=mailbox.BoundedImap
 class QueueImap(original):
  def __init__(self,*args,**kwargs):self.queue_wire_bytes=0;self.queue_search_calls=0;super().__init__(*args,**kwargs)
  def read(self,size):raise DiagnosticGuard('NO_LITERAL_ALLOWED')
  def readline(self):
   raw=super().readline();self.queue_wire_bytes+=len(raw)
   if len(raw)>MAX_SEARCH_BYTES or self.queue_wire_bytes>MAX_SESSION_WIRE_BYTES:raise DiagnosticGuard('SEARCH_WIRE_BUDGET')
   return raw
  def uid(self,command,*args):
   if command!='SEARCH'or self.queue_search_calls or after_uid==MAX_UID or args!=(None,'UID',str(after_uid+1)+':*'):raise DiagnosticGuard('FIXED_SINGLE_SEARCH_ONLY')
   self.queue_search_calls+=1;return super().uid(command,*args)
 mailbox.BoundedImap=QueueImap
 popen=mailbox.subprocess.Popen
 def tracked_popen(*args,**kwargs):
  process=popen(*args,**kwargs);_dns_children.append(process);return process
 mailbox.subprocess.Popen=tracked_popen

def observe(mailbox,after_uid):
 global _active_control
 result={'startedAtUtc':utcnow(),'namespaceValid':False,'searchRequestPerformed':False,'searchResponseValidated':False,'snapshotOnlyNotFullHistoricalCompleteness':True,'candidateUIDsNotFilteredByBusinessStartDate':True,'cursorMayAdvanceConcurrently':True,'bodyOrMetadataFetchPerformed':False,'sessionBudgetSeconds':45}
 control=mailbox.MailboxControl();_active_control=control;deadline=time.monotonic()+45;timer=threading.Timer(45,control.expire_fetch);timer.daemon=True;timer.start();client=None;stage='connect'
 try:
  result['memoryGuard']=memory_headroom(MAX_SEARCH_BYTES);need(result['memoryGuard']['enoughAtSamplingInstant'])
  client=mailbox.BoundedImap(os.environ.get('VOYAGEPLEX_MAIL_IMAP_HOST','imaphz.qiye.163.com'),993,timeout=20,control=control,deadline=deadline);client.debug=0
  stage='login';control.check(deadline);status,_=client.login(os.environ.get('VOYAGEPLEX_MAIL_ADDRESS','').strip(),os.environ.get('VOYAGEPLEX_MAIL_AUTH_CODE',''));result['loginStatus']=status_name(status);need(status=='OK')
  stage='identify';control.check(deadline);mailbox.identify_client(client)
  stage='examine';control.check(deadline);status,_=client.select('INBOX',readonly=True);result['examineStatus']=status_name(status);need(status=='OK')
  status,values=client.response('UIDVALIDITY');result['initialUidValidityMatches']=status=='UIDVALIDITY'and type(values)is list and values==[str(UID_VALIDITY).encode()];need(result['initialUidValidityMatches'])
  stage='uid-search';control.check(deadline);result['searchStartedAtUtc']=utcnow()
  if after_uid==MAX_UID:
   result.update(search_facts([b''],after_uid));result['emptyRangeAtMaximumUID']=True
  else:
   result['searchRequestPerformed']=True;status,parts=client.uid('SEARCH',None,'UID',str(after_uid+1)+':*');result['searchStatus']=status_name(status)
   if status!='OK':result['sanitizedServerError']=sanitized_server_error(parts)
   need(status=='OK');result.update(search_facts(parts,after_uid));parts=None
  result['searchFinishedAtUtc']=utcnow()
  stage='fresh-namespace-status';control.check(deadline);status,parts=client.status('INBOX','(UIDVALIDITY)');result['freshNamespaceStatus']=status_name(status);result['freshUidValidityMatches']=status=='OK'and fresh_validity(parts)
  result['namespaceValid']=bool(result['initialUidValidityMatches']and result['freshUidValidityMatches'])
 except Exception as error:result.update(failedStage=stage,**safe_exception(error))
 finally:
  timer.cancel()
  if client is not None:
   try:client.shutdown()
   except Exception:pass
  control.client=None;_active_control=None;result['finishedAtUtc']=utcnow();result['sessionBudgetExpired']=control.fetch_expired.is_set()
 return result

def main():
 need(RUN_PIN);signal.signal(signal.SIGALRM,hard_stop);signal.signal(signal.SIGTERM,hard_stop);signal.setitimer(signal.ITIMER_REAL,HARD_DEADLINE_SECONDS)
 soft,hard=resource.getrlimit(resource.RLIMIT_AS);cap=256*1024*1024;resource.setrlimit(resource.RLIMIT_AS,(min(cap,hard)if hard>=0 else cap,hard))
 raw=sys.stdin.buffer.read(4097);need(len(raw)<=4096);after_uid=validate_input(json.loads(raw))
 source=pathlib.Path('/app/app/mailbox.py');need(source.is_file()and not source.is_symlink()and hashlib.sha256(source.read_bytes()).hexdigest()==SOURCE_SHA)
 host=os.environ.get('VOYAGEPLEX_MAIL_IMAP_HOST','imaphz.qiye.163.com');need(re.fullmatch('[A-Za-z0-9.-]{1,253}',host)and os.environ.get('VOYAGEPLEX_MAIL_ADDRESS','').strip()and os.environ.get('VOYAGEPLEX_MAIL_AUTH_CODE','')and os.environ.get('VOYAGEPLEX_MAIL_FOLDER','INBOX').upper()=='INBOX')
 spec=importlib.util.spec_from_file_location('fixed_queue_production_mailbox',source);mailbox=importlib.util.module_from_spec(spec);spec.loader.exec_module(mailbox);mailbox.imaplib.Debug=0;instrument(mailbox,after_uid);evidence=observe(mailbox,after_uid)
 result={'success':True,'scope':SCOPE,'after_uid':after_uid,'mailboxSourceSHA256':SOURCE_SHA,'actualImapHost':host,'port':993,'folderIsInbox':True,'evidence':evidence,'httpFetchParseDatabaseConfigurationOrCursorWritesPerformed':False,'rawUIDListSecretsAddressesOrMailContentPrinted':False}
 encoded=json.dumps(result,ensure_ascii=True,separators=(',',':'),allow_nan=False);need(len(encoded)<=12000);print(encoded,flush=True);signal.setitimer(signal.ITIMER_REAL,0)

if __name__=='__main__':
 try:main()
 except BaseException:print('{"success":false,"safeFailure":"FIXED_QUEUE_READONLY_PROBE_REJECTED"}',flush=True);sys.exit(1)
