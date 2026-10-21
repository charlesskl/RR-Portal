"""Company provider discovery or one synthetic preflight; no runtime mutation."""
import base64,datetime,hashlib,importlib.util,json,os,pathlib,re,sys
from urllib.parse import urlsplit
ROOT=pathlib.Path('/opt/rr-portal');TARGET='25a76f71e556f77a8aadb031823b392832d2354a';BRANCH='refs/heads/ops/qc-provider-429-20261021'
INFO_PIN=False;PREFLIGHT_PIN=False;CANDIDATE_MODEL='qwen3.8-flash'
LIBRARY_SHA='88eb0bab5eb7c6972fcdd926423ff035296617c53810165d7b1a06ff19d9db0e';D=None;OUT=None;STAGE='entry'
HOST_PATTERN=r'(?:dashscope\.aliyuncs\.com|dashscope-intl\.aliyuncs\.com|cn-hongkong\.dashscope\.aliyuncs\.com|[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.(?:cn-beijing|ap-southeast-1|us-east-1|eu-central-1|cn-hongkong|ap-northeast-1)\.maas\.aliyuncs\.com)'
KEYS=('QC_BAILIAN_API_KEY','PEISE_BAILIAN_BASE_URL','PAIJI_BAILIAN_VISION_MODEL','PEISE_BAILIAN_MODEL','BAOJIA_BAILIAN_TEXT_MODEL')
def need(value):
 if not value:raise RuntimeError('QC_COMPANY_PROVIDER_PREFLIGHT_REJECTED')
def load():
 global D
 p=pathlib.Path(__file__).with_name('qc-provider-diagnostic-library.py');need(p.is_file()and not p.is_symlink()and hashlib.sha256(p.read_bytes()).hexdigest()==LIBRARY_SHA);spec=importlib.util.spec_from_file_location('company_qc_diagnostic',p);D=importlib.util.module_from_spec(spec);spec.loader.exec_module(D);D.OUT=OUT
def env_digest():
 path=ROOT/'.env.cloud.production';need(path.is_file()and not path.is_symlink()and path.stat().st_size<=4*1024**2)
 with os.fdopen(os.open(path,os.O_RDONLY|os.O_NOFOLLOW),'rb')as f:
  before=os.fstat(f.fileno());blob=f.read(4*1024**2+1);after=os.fstat(f.fileno());need((before.st_ino,before.st_size,before.st_mtime_ns)==(after.st_ino,after.st_size,after.st_mtime_ns)and len(blob)==before.st_size)
 return D.sha(blob)
def worker():
 ids=D.run(['docker','ps','-aq','--no-trunc','--filter','label=com.docker.compose.project=rr-portal','--filter','label=com.docker.compose.service=qc-report-worker']).decode().split();need(len(ids)==1 and re.fullmatch('[a-f0-9]{64}',ids[0]));rows=json.loads(D.run(['docker','inspect',*ids]));need(type(rows)is list and len(rows)==1);row=rows[0];labels=row['Config'].get('Labels')or{}
 need(row['Id']==ids[0]and row['Image']==D.IMAGE and row['State']['Running']is True and row['State']['OOMKilled']is False and row['State'].get('Health',{}).get('Status')=='healthy'and labels.get('com.docker.compose.project')=='rr-portal'and labels.get('com.docker.compose.service')=='qc-report-worker');cfg=D.envmap(row['Config']['Env']);proc=D.run(['docker','exec',ids[0],'cat','/proc/1/environ']);need(proc.endswith(b'\0')and len(proc)<=1024**2);pid1=D.envmap([v.decode()for v in proc.split(b'\0')if v]);need(all(cfg.get(k)==v and pid1.get(k)==v for k,v in D.LIMITS.items()))
 facts={k:row[k]for k in ('Id','Image','Config','HostConfig','Mounts','RestartCount')};facts['StartedAt']=row['State']['StartedAt'];return ids[0],D.sha(D.enc(facts))
def selected_company_environment():
 # Compose parses dotenv quoting/interpolation; the private recipe contains no key values.
 recipe='services:\n  company-provider-read:\n    image: scratch\n    environment:\n'+''.join('      '+key+': ${'+key+'-}\n'for key in KEYS)
 D.private('company-dotenv-parser.private.yml',recipe.encode());path=OUT/'company-dotenv-parser.private.yml'
 args=['env']
 for key in KEYS:args+=['-u',key]
 args+=['docker','compose','--project-directory',str(ROOT),'--env-file',str(ROOT/'.env.cloud.production'),'-f',str(path),'config','--format','json']
 parsed=json.loads(D.run(args,timeout=30));values=parsed['services']['company-provider-read']['environment'];need(type(values)is dict and set(values)==set(KEYS)and all(type(v)is str and len(v)<=8192 for v in values.values()));return values
def selection(values):
 key=values['QC_BAILIAN_API_KEY'].strip();need(16<=len(key)<=4096 and all(33<=ord(c)<=126 for c in key));base=values['PEISE_BAILIAN_BASE_URL'].strip().rstrip('/');parsed=urlsplit(base)
 safe=parsed.scheme=='https'and bool(parsed.hostname)and bool(re.fullmatch(HOST_PATTERN,parsed.hostname))and parsed.username is None and parsed.password is None and parsed.query==''and parsed.fragment==''and parsed.port in(None,443)and parsed.path=='/compatible-mode/v1'
 host=D.safe_name(parsed.hostname,r'[A-Za-z0-9.-]{1,253}',key)if safe else None
 models={k:D.safe_name(values[k],r'[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}',key)for k in KEYS if k.endswith('MODEL')}
 return {'apiKey':key,'baseUrl':base,'model':CANDIDATE_MODEL},{'companyKeySource':'QC_BAILIAN_API_KEY','companyKeyPresent':True,'providerHostname':host,'chatBaseCompatible':safe,'modelsSeen':models,'candidateModel':CANDIDATE_MODEL,'candidateMaxCompletionTokens':64000,'candidateNativePDFAndVisionDocumented':True}
SCRIPT=r'''import base64,io,json,os,re,secrets,signal,sys,urllib.parse
from urllib import request,error
from PIL import Image,ImageDraw,ImageFont
from reportlab.pdfgen.canvas import Canvas
selected=json.loads(sys.stdin.buffer.read(65537));assert type(selected)is dict and set(selected)=={'apiKey','baseUrl','model'}
host_pattern='(?:dashscope\\.aliyuncs\\.com|dashscope-intl\\.aliyuncs\\.com|cn-hongkong\\.dashscope\\.aliyuncs\\.com|[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.(?:cn-beijing|ap-southeast-1|us-east-1|eu-central-1|cn-hongkong|ap-northeast-1)\\.maas\\.aliyuncs\\.com)'
base=urllib.parse.urlsplit(selected['baseUrl']);assert base.scheme=='https'and base.hostname and re.fullmatch(host_pattern,base.hostname)and base.username is None and base.password is None and not base.query and not base.fragment and base.port in(None,443)and base.path=='/compatible-mode/v1'and selected['model']=='qwen3.8-flash'
assert os.environ.get('OPENAI_MAX_OUTPUT_TOKENS')=='64000'and os.environ.get('OPENAI_TIMEOUT_SECONDS')=='900'
pdf_marker='PDF-'+secrets.token_hex(8).upper();image_marker='PNG-'+secrets.token_hex(8).upper()
pdf=io.BytesIO();canvas=Canvas(pdf,pagesize=(420,140));canvas.setFont('Helvetica',20);canvas.drawString(24,64,pdf_marker);canvas.save();pdf_bytes=pdf.getvalue()
image=Image.new('RGB',(720,160),'white');ImageDraw.Draw(image).text((24,48),image_marker,fill='black',font=ImageFont.load_default(size=32));png=io.BytesIO();image.save(png,format='PNG');png_bytes=png.getvalue()
class NoRedirect(request.HTTPRedirectHandler):
 def redirect_request(self,*args,**kwargs):return None
result={'requestCount':0,'httpStatus':None,'httpSuccess':False,'ok':False,'bodyB64':'','bodyTruncated':False,'pdfMarkerMatch':False,'imageMarkerMatch':False,'finishReasonStop':False,'pdfB64':base64.b64encode(pdf_bytes).decode(),'pngB64':base64.b64encode(png_bytes).decode(),'expectedMarkers':{'pdf_marker':pdf_marker,'image_marker':image_marker}}
opener=request.build_opener(NoRedirect())
def capture(body):result['bodyB64']=base64.b64encode(body[:65536]).decode();result['bodyTruncated']=len(body)>65536
def expired(*args):raise TimeoutError()
previous=signal.signal(signal.SIGALRM,expired)
try:
 content=[{'type':'text','text':'Read the marker printed in the supplied PDF and the marker printed in the supplied PNG. Return only a JSON object with exactly two string keys: pdf_marker and image_marker. Copy each marker exactly; do not guess.'},{'type':'file','file':{'file_data':'data:application/pdf;base64,'+result['pdfB64'],'filename':'synthetic.pdf'}},{'type':'image_url','image_url':{'url':'data:image/png;base64,'+result['pngB64']}}]
 payload={'model':selected['model'],'max_completion_tokens':64000,'enable_thinking':False,'response_format':{'type':'json_object'},'messages':[{'role':'user','content':content}]}
 req=request.Request(selected['baseUrl']+'/chat/completions',data=json.dumps(payload,separators=(',',':')).encode(),headers={'Authorization':'Bearer '+selected['apiKey'],'Content-Type':'application/json','Accept':'application/json'},method='POST')
 result['requestCount']+=1;assert result['requestCount']==1;signal.setitimer(signal.ITIMER_REAL,60)
 try:
  with opener.open(req,timeout=60)as stream:result['httpStatus']=stream.status;result['httpSuccess']=200<=stream.status<300;body=stream.read(65537);capture(body)
 except error.HTTPError as exc:
  result['httpStatus']=exc.code
  with exc:capture(exc.read(65537))
  body=b''
 if result['httpSuccess']and not result['bodyTruncated']:
  response=json.loads(body);choices=response.get('choices');assert type(choices)is list and len(choices)==1;choice=choices[0];result['finishReasonStop']=choice.get('finish_reason')=='stop';decoded=json.loads(choice['message']['content']);result['pdfMarkerMatch']=type(decoded)is dict and decoded.get('pdf_marker')==pdf_marker;result['imageMarkerMatch']=type(decoded)is dict and decoded.get('image_marker')==image_marker;result['ok']=type(decoded)is dict and set(decoded)=={'pdf_marker','image_marker'}and result['pdfMarkerMatch']and result['imageMarkerMatch']and result['finishReasonStop']
  usage=response.get('usage');result['usage']={k:usage[k]for k in('prompt_tokens','completion_tokens','total_tokens')if type(usage)is dict and type(usage.get(k))is int and 0<=usage[k]<=10**9}
except Exception:result['transportOrResponseFailure']=True
finally:signal.setitimer(signal.ITIMER_REAL,0);signal.signal(signal.SIGALRM,previous);selected=payload=response=decoded=body=None
print(json.dumps(result,sort_keys=True,separators=(',',':')),flush=True)
'''
def inspect_company(result,mode):
 global STAGE
 STAGE='fixed-source-and-worker';need(D.run(['git','rev-parse','HEAD']).decode().strip()==TARGET);container,before=worker();env_before=env_digest();result['pinnedWorkerAndRuntimeLimitsVerified']=True
 STAGE='compose-dotenv-read';values=selected_company_environment();candidate,metadata=selection(values);result.update(metadata);D.private('company-safe-metadata.json',metadata)
 if mode=='company-preflight':
  STAGE='single-company-native-pdf-image-preflight';need(metadata['chatBaseCompatible']and CANDIDATE_MODEL=='qwen3.8-flash');result.update(syntheticProviderRequestAttempted=True,vendorUsageMayHaveOccurred=True,requestedMaxCompletionTokens=64000,requestedResponseFormat='json_object',strictSchemaClaimed=False)
  raw=D.run(['docker','exec','-i',container,'python','-B','-c',SCRIPT],D.enc(candidate),85);need(len(raw)<=128*1024);D.private('company-worker-envelope.private.json',raw);reply=json.loads(raw);need(type(reply)is dict and reply.get('requestCount')==1);body=base64.b64decode(reply.get('bodyB64',''),validate=True);need(len(body)<=65536);result['privateProviderBodySHA256']=D.private('company-provider-response.private.bin',body);result['privateProviderBodyPath']=str(OUT/'company-provider-response.private.bin');status=reply.get('httpStatus');need(status is None or type(status)is int and 100<=status<=599);result.update(requestCount=1,providerHTTPStatus=status,httpSuccess=reply.get('httpSuccess')is True,ok=reply.get('ok')is True,providerBodyTruncated=reply.get('bodyTruncated')is True,pdfMarkerMatch=reply.get('pdfMarkerMatch')is True,imageMarkerMatch=reply.get('imageMarkerMatch')is True,finishReasonStop=reply.get('finishReasonStop')is True)
  for name,field,limit in [('synthetic-private.pdf','pdfB64',65536),('synthetic-private.png','pngB64',65536)]:
   fixture=base64.b64decode(reply[field],validate=True);need(len(fixture)<=limit);D.private(name,fixture)
  usage=reply.get('usage');result['usage']={k:usage[k]for k in('prompt_tokens','completion_tokens','total_tokens')if type(usage)is dict and type(usage.get(k))is int and 0<=usage[k]<=10**9}
  if not(result['httpSuccess']and result['ok']):result.update(D.classify(body,candidate['apiKey']))
  result['providerAccepted64000Request']=result['httpSuccess']and result['ok'];result['probeSuccess']=result['providerAccepted64000Request']
 candidate=values=None
 STAGE='unchanged-runtime-and-environment';container_after,after=worker();need(container_after==container and after==before and env_digest()==env_before);result.update(success=True,diagnosticComplete=True,workerAndConfigurationUnchanged=True)
def main():
 global OUT
 need(len(sys.argv)==2 and sys.argv[1]in('company-info','company-preflight'));mode=sys.argv[1];need((INFO_PIN if mode=='company-info'else PREFLIGHT_PIN)and not(INFO_PIN and PREFLIGHT_PIN)and os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_ATTEMPT')=='1');os.umask(0o077);OUT=ROOT/('deploy/backups/qc-provider-429-20261021-'+mode);OUT.mkdir(mode=0o700);load();result={'mode':mode,'target':TARGET,'observedUTC':datetime.datetime.now(datetime.timezone.utc).isoformat(),'success':False,'syntheticProviderRequestAttempted':False,'vendorUsageMayHaveOccurred':False,'businessWritesPerformed':False,'queueWritesPerformed':False,'configurationChanged':False,'containerSignalsSent':False,'automaticRetryPerformed':False}
 try:inspect_company(result,mode)
 except BaseException:result['failedStage']=STAGE
 digest=D.private('first-result.json',result);manifest={p.name:D.sha(p.read_bytes())for p in OUT.iterdir()if p.is_file()};msha=D.private('manifest.json',manifest);print(D.enc(dict(result,manifestSHA256=msha,resultSHA256=digest)).decode(),flush=True);return 0 if result['success']else 1
if __name__=='__main__':
 try:code=main()
 except BaseException:
  mode=sys.argv[1]if len(sys.argv)>1 and sys.argv[1]in('company-info','company-preflight')else'company-info';print(json.dumps({'mode':mode,'success':False,'safeFailure':'QC_COMPANY_PREFLIGHT_REJECTED'}),flush=True);code=1
 sys.exit(code)
