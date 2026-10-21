"""One controlled synthetic request; configuration, queues and business data untouched.
Provider error bytes, selected response headers and QC logs stay server-private.
"""
import base64,datetime,hashlib,json,os,pathlib,re,resource,subprocess,sys
from email.utils import parsedate_to_datetime
ROOT=pathlib.Path('/opt/rr-portal');TARGET='25a76f71e556f77a8aadb031823b392832d2354a';BRANCH='refs/heads/ops/qc-provider-429-20261021'
DIAGNOSE_PIN=True;IMAGE='sha256:13be768463dc49fb063394df2c48bcd87b66509e858da362cf414b3c14a44b2b'
OUT=ROOT/'deploy/backups/qc-provider-429-20261021-diagnose';LIMITS={'OPENAI_TIMEOUT_SECONDS':'900','OPENAI_MAX_OUTPUT_TOKENS':'64000','RQ_JOB_TIMEOUT_SECONDS':'1200'};STAGE='entry'
def enc(value):return json.dumps(value,sort_keys=True,ensure_ascii=True,separators=(',',':')).encode()
def sha(value):return hashlib.sha256(value).hexdigest()
def need(value):
 if not value:raise RuntimeError('QC_PROVIDER_DIAGNOSE_REJECTED')
def private(name,value):
 blob=value if type(value)is bytes else enc(value);fd=os.open(OUT/name,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
 with os.fdopen(fd,'wb')as file:file.write(blob);file.flush();os.fsync(file.fileno())
 return sha(blob)
def run(args,data=None,timeout=30):
 p=subprocess.run(args,input=data,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,timeout=timeout,cwd=ROOT);need(p.returncode==0 and len(p.stdout)<=8*1024**2);return p.stdout
def envmap(values):
 need(type(values)is list and len(values)<=1000);result={}
 for item in values:
  need(type(item)is str and '='in item);key,value=item.split('=',1);need(bool(re.fullmatch('[A-Za-z_][A-Za-z0-9_]*',key))and key not in result);result[key]=value
 return result
def logs(service):
 ids=run(['docker','ps','-aq','--no-trunc','--filter','label=com.docker.compose.project=rr-portal','--filter','label=com.docker.compose.service='+service]).decode().split();need(len(ids)==1 and bool(re.fullmatch('[a-f0-9]{64}',ids[0])));name=service+'-since-20261021T024500Z.private.log';fd=os.open(OUT/name,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
 def bounded_file():resource.setrlimit(resource.RLIMIT_FSIZE,(8*1024**2,8*1024**2))
 with os.fdopen(fd,'wb')as file:
  try:process=subprocess.run(['docker','logs','--timestamps','--since','2026-10-21T02:45:00Z','--tail','2000',ids[0]],stdout=file,stderr=subprocess.STDOUT,timeout=40,cwd=ROOT,preexec_fn=bounded_file);code=process.returncode
  except subprocess.TimeoutExpired:code='timeout'
  file.flush();os.fsync(file.fileno())
 path=OUT/name;return {'savedPrivately':True,'bytes':path.stat().st_size,'sha256':sha(path.read_bytes()),'readerExitCode':code,'possiblyTruncated':path.stat().st_size>=8*1024**2 or code!=0}
def safe_name(value,pattern,secret):return value if type(value)is str and bool(re.fullmatch(pattern,value))and(not secret or secret not in value)else None
def safe_header_facts(headers,now):
 if type(headers)is not dict:return {}
 allowed=('x-ratelimit-limit','x-ratelimit-remaining','x-ratelimit-reset','x-ratelimit-limit-requests','x-ratelimit-remaining-requests','x-ratelimit-reset-requests','x-ratelimit-limit-tokens','x-ratelimit-remaining-tokens','x-ratelimit-reset-tokens');numbers={};retry=None
 for key,value in list(headers.items())[:100]:
  if type(key)is not str:continue
  key=key.lower()
  if key in allowed and(type(value)is int or type(value)is str and bool(re.fullmatch('[0-9]{1,15}',value))):
   number=int(value)
   if 0<=number<=10**15:numbers[key]=number
  if key=='retry-after'and type(value)is str and len(value)<=128:
   if re.fullmatch('[0-9]{1,8}',value):seconds=int(value)
   else:
    try:
     date=parsedate_to_datetime(value);need(date.tzinfo is not None);seconds=max(0,int((date-now).total_seconds()+0.999))
    except Exception:seconds=-1
   if 0<=seconds<=604800:retry=seconds
 result={'numericRateLimitHeaders':numbers}
 if retry is not None:result['retryAfterSeconds']=retry
 return result
def classify(body,secret):
 try:value=json.loads(body);error=value.get('error')if type(value)is dict else None
 except Exception:error=None
 error=error if type(error)is dict else {};types=('new_api_error','relay_api_error','upstream_error','rate_limit_error','invalid_request_error','authentication_error','permission_error','server_error','insufficient_quota','requests','tokens');codes=('rate_limit_exceeded','insufficient_quota','insufficient_balance','quota_exceeded','token_quota_exhausted','channel_not_found','no_available_channel','model_not_found','model_not_supported','too_many_requests','concurrency_limit_exceeded','rpm_limit_exceeded','tpm_limit_exceeded','daily_limit_exceeded','request_too_large','max_tokens_exceeded','context_length_exceeded');params=('max_output_tokens','model','input','text.format','text.format.schema');result={'rawProviderErrorSavedPrivately':True,'providerErrorObjectPresent':bool(error)}
 for key,allowed in [('type',types),('code',codes),('param',params)]:
  v=error.get(key)
  if v in allowed and type(v)is str and(not secret or secret not in v):result['providerError'+key.title()]=v
  elif key=='code'and type(v)is int and 100<=v<=599:result['providerErrorCode']=v
  elif v is not None:result['providerError'+key.title()+'NotWhitelistedSavedPrivately']=True;result['providerError'+key.title()+'SHA256']=sha(enc(v))
 message=error.get('message');text=((message if type(message)is str else '')+'\n'+body.decode('utf-8',errors='replace')).lower();matches=[]
 for category,words in [('quota-or-balance',('insufficient_quota','insufficient_balance','token_quota_exhausted','quota exceeded','余额不足','额度不足','额度已用尽','额度已耗尽','令牌额度已用尽','账户额度已用尽')),('no-available-channel',('channel_not_found','no_available_channel','无可用渠道','无可用通道','channel not found','no available channel')),('rate-or-concurrency',('rate_limit','rate limit','too many requests','频率','并发','requests per min','tokens per min','限流','tpm','rpm')),('output-budget',('max_output_tokens','max_tokens_exceeded','context_length_exceeded'))]:
  if any(word in text or word==error.get('code')for word in words):matches.append(category)
 phrases=('无可用渠道','余额不足','额度不足','余额不','令牌额度已用尽','账户额度已用尽','并发','频率','限流','insufficient_quota','rate_limit_exceeded','token_limit','TPM','RPM','channel not found','no available channel','model not found','free-models-per-day','free-models-per-min','rate-limited upstream','temporarily rate-limited','upstream rate limit','upstream provider');result['matchedFixedReasonIndicators']=[phrase for phrase in phrases if phrase.lower()in text];result['reasonCategories']=matches or ['unclassified-private-error'];result['reasonCategoriesAreInferencesFromFixedIndicators']=True
 metadata=error.get('metadata');headers=metadata.get('headers')if type(metadata)is dict else None;result['errorMetadataHeaderFacts']=safe_header_facts(headers,datetime.datetime.now(datetime.timezone.utc));return result
WORKER_SCRIPT=r'''import base64,json,urllib.parse
from dataclasses import replace
from urllib import request,error
from unittest.mock import patch
from ai_service import AIConfig,AIService,_extract_structured_json
class NoRedirect(request.HTTPRedirectHandler):
 def redirect_request(self,*args,**kwargs):return None
result={'httpStatus':None,'httpSuccess':False,'ok':False,'requestCount':0,'errorBodyB64':'','errorBodyTruncated':False,'responseHeaders':{}}
cfg=AIConfig.from_env();cfg.validate();assert not cfg.mock_mode and cfg.max_output_tokens==64000
result['model']=cfg.model;result['providerHostname']=urllib.parse.urlsplit(cfg.responses_url).hostname
opener=request.build_opener(NoRedirect())
def save_headers(headers):
 result['responseHeaders']={k:v[:2048]for k,v in list(headers.items())[:100]if k.lower()in('retry-after','x-request-id','request-id','x-correlation-id')or k.lower().startswith('x-ratelimit-')}
def once(req,*,timeout):
 result['requestCount']+=1;assert result['requestCount']==1 and timeout==30
 try:
  response=opener.open(req,timeout=30);result['httpStatus']=response.status;save_headers(response.headers);return response
 except error.HTTPError as exc:
  result['httpStatus']=exc.code;save_headers(exc.headers)
  with exc:body=exc.read(65537)
  result['errorBodyB64']=base64.b64encode(body[:65536]).decode();result['errorBodyTruncated']=len(body)>65536
  raise
try:
 service=AIService(replace(cfg,timeout_seconds=30));payload=service._payload(system_prompt='Return exactly {"ok":true}.',user_content=[{'type':'input_text','text':'Return {"ok":true}.'}],schema_name='qc_429_diagnostic',schema={'type':'object','properties':{'ok':{'type':'boolean'}},'required':['ok'],'additionalProperties':False},prompt_version='diagnose.v1',schema_version='diagnose.v1')
 with patch('ai_service.request.urlopen',once):response,_=service._post_responses(payload)
 decoded=_extract_structured_json(response,request_id='redacted');result['httpSuccess']=type(result['httpStatus'])is int and 200<=result['httpStatus']<300;result['ok']=type(decoded)is dict and set(decoded)=={'ok'}and decoded['ok']is True
except Exception:result['transportOrResponseFailure']=True
print(json.dumps(result,sort_keys=True,separators=(',',':')),flush=True)
'''
def diagnose(result):
 global STAGE
 STAGE='immutable-worker-and-final-runtime-limits';need(run(['git','rev-parse','HEAD']).decode().strip()==TARGET);ids=run(['docker','ps','-aq','--no-trunc','--filter','label=com.docker.compose.project=rr-portal','--filter','label=com.docker.compose.service=qc-report-worker']).decode().split();need(len(ids)==1 and bool(re.fullmatch('[a-f0-9]{64}',ids[0])));records=json.loads(run(['docker','inspect',*ids]));need(type(records)is list and len(records)==1);row=records[0];labels=row['Config'].get('Labels')or{};need(row['Id']==ids[0]and row['Image']==IMAGE and row['State']['Running']is True and row['State']['OOMKilled']is False and row['State'].get('Health',{}).get('Status')=='healthy'and labels.get('com.docker.compose.project')=='rr-portal'and labels.get('com.docker.compose.service')=='qc-report-worker');configured=envmap(row['Config']['Env']);proc=run(['docker','exec',ids[0],'cat','/proc/1/environ']);need(proc.endswith(b'\0')and len(proc)<=1024**2);process=envmap([v.decode()for v in proc.split(b'\0')if v]);need(all(configured.get(k)==v and process.get(k)==v for k,v in LIMITS.items()));result.update(immutableWorkerAndRuntimeLimitsVerified=True,configuredEnvironmentSHA256=sha(enc(configured)),processEnvironmentSHA256=sha(enc(process)))
 STAGE='bounded-private-qc-logs';result['privateLogs']={service:logs(service)for service in ('qc-report','qc-report-worker')}
 STAGE='single-synthetic-64000-request';result.update(syntheticProviderRequestAttempted=True,vendorUsageMayHaveOccurred=True);raw=run(['docker','exec','-i',ids[0],'python','-B','-'],WORKER_SCRIPT.encode(),65);need(len(raw)<=128*1024);private('worker-response-envelope.private.json',raw);value=json.loads(raw);need(type(value)is dict and value.get('requestCount')==1);body=base64.b64decode(value.get('errorBodyB64',''),validate=True);need(len(body)<=65536);result['privateErrorBodySHA256']=private('provider-error-body.private.bin',body);result['privateErrorBodyPath']=str(OUT/'provider-error-body.private.bin');private('provider-response-headers.private.json',value.get('responseHeaders',{}));private('provider-private-metadata.private.json',{k:value.get(k)for k in ('model','providerHostname','httpStatus','errorBodyTruncated','requestCount')});secret=configured.get('OPENAI_API_KEY');result['providerHostname']=safe_name(value.get('providerHostname'),r'[A-Za-z0-9.-]{1,253}',secret);result['model']=safe_name(value.get('model'),r'[A-Za-z0-9._:/-]{1,128}',secret);status=value.get('httpStatus');need(status is None or type(status)is int and 100<=status<=599);result['responseHeaderFacts']=safe_header_facts(value.get('responseHeaders'),datetime.datetime.now(datetime.timezone.utc));result.update(providerHTTPStatus=status,httpSuccess=value.get('httpSuccess')is True,ok=value.get('ok')is True,errorBodyTruncated=value.get('errorBodyTruncated')is True,requestCount=1,**classify(body,secret));result['diagnosticComplete']=True;result['providerAccepted64000Request']=result['httpSuccess']and result['ok'];result['probeSuccess']=result['providerAccepted64000Request'];result['success']=True
def main():
 need(len(sys.argv)==2 and sys.argv[1]=='diagnose'and DIAGNOSE_PIN and os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_ATTEMPT')=='1');os.umask(0o077);OUT.mkdir(mode=0o700);result={'mode':'diagnose','target':TARGET,'observedUTC':datetime.datetime.now(datetime.timezone.utc).isoformat(),'success':False,'syntheticProviderRequestAttempted':False,'vendorUsageMayHaveOccurred':False,'businessWritesPerformed':False,'queueWritesPerformed':False,'configurationChanged':False,'containerSignalsSent':False,'automaticRetryPerformed':False}
 try:diagnose(result)
 except BaseException:result['failedStage']=STAGE
 digest=private('first-result.json',result);manifest={p.name:sha(p.read_bytes())for p in OUT.iterdir()if p.is_file()};msha=private('manifest.json',manifest);print(enc(dict(result,manifestSHA256=msha,resultSHA256=digest)).decode(),flush=True);return 0 if result['success']else 1
if __name__=='__main__':
 try:code=main()
 except BaseException:print('{"mode":"diagnose","success":false,"safeFailure":"QC_PROVIDER_DIAGNOSE_PREFLIGHT_FAILED"}',flush=True);code=1
 sys.exit(code)
