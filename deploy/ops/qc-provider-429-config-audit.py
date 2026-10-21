"""One read-only OpenRouter key metadata GET; no AI request or config change."""
import base64,datetime,hashlib,importlib.util,json,os,pathlib,re,sys
ROOT=pathlib.Path('/opt/rr-portal');BRANCH='refs/heads/ops/qc-provider-429-20261021';TARGET='25a76f71e556f77a8aadb031823b392832d2354a';AUDIT_PIN=True
LIBRARY_SHA='88eb0bab5eb7c6972fcdd926423ff035296617c53810165d7b1a06ff19d9db0e';OUT=ROOT/'deploy/backups/qc-provider-429-20261021-config-audit';D=None;STAGE='entry'
def need(value):
 if not value:raise RuntimeError('QC_KEY_METADATA_AUDIT_REJECTED')
def load():
 global D
 p=pathlib.Path(__file__).with_name('qc-provider-diagnostic-library.py');need(p.is_file()and not p.is_symlink()and hashlib.sha256(p.read_bytes()).hexdigest()==LIBRARY_SHA);s=importlib.util.spec_from_file_location('fixed_qc_diagnostic',p);D=importlib.util.module_from_spec(s);s.loader.exec_module(D);D.OUT=OUT
def availability(blob):
 result={}
 for line in blob.decode().splitlines():
  match=re.fullmatch(r'\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*',line)
  if not match or not any(name in match[1].upper()for name in ('BAILIAN','DASHSCOPE','OPENAI')):continue
  value=re.sub(r'\s+#.*$','',match[2]).strip()
  if len(value)>=2 and value[0]in("'",'"')and value[-1]==value[0]:value=value[1:-1]
  result[match[1]]=bool(value)
 return result
SCRIPT=r'''import base64,json,urllib.parse
from urllib import request,error
from ai_service import AIConfig
cfg=AIConfig.from_env();cfg.validate();parsed=urllib.parse.urlsplit(cfg.base_url)
assert parsed.scheme=='https'and parsed.hostname=='openrouter.ai'and parsed.port in(None,443)
class NoRedirect(request.HTTPRedirectHandler):
 def redirect_request(self,*args,**kwargs):return None
req=request.Request('https://openrouter.ai/api/v1/key',headers={'Authorization':'Bearer '+cfg.api_key,'Accept':'application/json'},method='GET')
result={'requestCount':1,'model':cfg.model,'providerHostname':parsed.hostname,'httpStatus':None,'bodyB64':'','truncated':False}
try:
 with request.build_opener(NoRedirect()).open(req,timeout=15)as response:result['httpStatus']=response.status;body=response.read(32769)
except error.HTTPError as exc:
 with exc:result['httpStatus']=exc.code;body=exc.read(32769)
except Exception:body=b''
result['bodyB64']=base64.b64encode(body[:32768]).decode();result['truncated']=len(body)>32768
print(json.dumps(result,sort_keys=True,separators=(',',':')),flush=True)
'''
def audit(result):
 global STAGE
 STAGE='pinned-current-worker-and-runtime';need(D.run(['git','rev-parse','HEAD']).decode().strip()==TARGET);ids=D.run(['docker','ps','-aq','--no-trunc','--filter','label=com.docker.compose.project=rr-portal','--filter','label=com.docker.compose.service=qc-report-worker']).decode().split();need(len(ids)==1 and re.fullmatch('[a-f0-9]{64}',ids[0]));rows=json.loads(D.run(['docker','inspect',*ids]));need(type(rows)is list and len(rows)==1);row=rows[0];labels=row['Config'].get('Labels')or{};need(row['Id']==ids[0]and row['Image']==D.IMAGE and row['State']['Running']is True and row['State']['OOMKilled']is False and row['State'].get('Health',{}).get('Status')=='healthy'and labels.get('com.docker.compose.project')=='rr-portal'and labels.get('com.docker.compose.service')=='qc-report-worker');configured=D.envmap(row['Config']['Env']);proc=D.run(['docker','exec',ids[0],'cat','/proc/1/environ']);need(proc.endswith(b'\0')and len(proc)<=1024**2);process=D.envmap([v.decode()for v in proc.split(b'\0')if v]);need(all(configured.get(k)==v and process.get(k)==v for k,v in D.LIMITS.items()));result['pinnedWorkerAndRuntimeLimitsVerified']=True
 STAGE='provider-key-presence-only';path=ROOT/'.env.cloud.production';need(path.is_file()and not path.is_symlink()and path.stat().st_size<=4*1024**2)
 with os.fdopen(os.open(path,os.O_RDONLY|os.O_NOFOLLOW),'rb')as file:before=os.fstat(file.fileno());blob=file.read(4*1024**2+1);after=os.fstat(file.fileno());need((before.st_ino,before.st_size,before.st_mtime_ns)==(after.st_ino,after.st_size,after.st_mtime_ns)and len(blob)==before.st_size)
 result['serverProviderEnvKeysNonempty']=availability(blob)
 STAGE='single-openrouter-key-metadata-get';result['keyMetadataGETAttempted']=True;raw=D.run(['docker','exec','-i',ids[0],'python','-B','-'],SCRIPT.encode(),35);need(len(raw)<=65536);D.private('worker-key-response-envelope.private.json',raw);value=json.loads(raw);need(type(value)is dict and value.get('requestCount')==1);body=base64.b64decode(value['bodyB64'],validate=True);need(len(body)<=32768);result['privateKeyMetadataBodySHA256']=D.private('openrouter-key-metadata.private.bin',body);result['privateKeyMetadataBodyPath']=str(OUT/'openrouter-key-metadata.private.bin');result['providerHTTPStatus']=value.get('httpStatus');result['responseTruncated']=value.get('truncated')is True;secret=configured.get('OPENAI_API_KEY');result['providerHostname']=D.safe_name(value.get('providerHostname'),r'[A-Za-z0-9.-]{1,253}',secret);result['model']=D.safe_name(value.get('model'),r'[A-Za-z0-9._:/-]{1,128}',secret)
 try:decoded=json.loads(body);data=decoded.get('data')if type(decoded)is dict else None
 except Exception:data=None
 if type(data)is dict:
  result['numericKeyMetadata']={k:data[k]for k in ('limit','limit_remaining','usage','usage_daily','usage_weekly','usage_monthly','free_model_daily_requests','free_model_daily_requests_remaining','free_model_daily_requests_limit')if type(data.get(k))in(int,float)and abs(data[k])<=10**15}
  if type(data.get('is_free_tier'))is bool:result['isFreeTier']=data['is_free_tier']
 result.update(success=True,diagnosticComplete=True,keyMetadataReadable=type(data)is dict and result['providerHTTPStatus']==200)
def main():
 need(len(sys.argv)==2 and sys.argv[1]=='audit'and AUDIT_PIN and os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_ATTEMPT')=='1');os.umask(0o077);OUT.mkdir(mode=0o700);load();result={'mode':'audit','target':TARGET,'observedUTC':datetime.datetime.now(datetime.timezone.utc).isoformat(),'success':False,'keyMetadataGETAttempted':False,'aiRequestsPerformed':False,'businessWritesPerformed':False,'queueWritesPerformed':False,'configurationChanged':False,'automaticRetryPerformed':False}
 try:audit(result)
 except BaseException:result['failedStage']=STAGE
 digest=D.private('first-result.json',result);manifest={p.name:D.sha(p.read_bytes())for p in OUT.iterdir()if p.is_file()};msha=D.private('manifest.json',manifest);print(D.enc(dict(result,manifestSHA256=msha,resultSHA256=digest)).decode(),flush=True);return 0 if result['success']else 1
if __name__=='__main__':
 try:code=main()
 except BaseException:print('{"mode":"audit","success":false,"safeFailure":"QC_KEY_AUDIT_PREFLIGHT_FAILED"}',flush=True);code=1
 sys.exit(code)
