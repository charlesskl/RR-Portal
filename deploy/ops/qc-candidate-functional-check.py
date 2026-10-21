"""Closed by default: two synthetic calls through the immutable candidate image."""
import base64,hashlib,json,os,pathlib,re,signal,stat,subprocess,sys
ROOT=pathlib.Path('/opt/rr-portal');BRANCH='refs/heads/ops/qc-provider-429-20261021'
FUNCTIONAL_PIN=False;TARGET='b4c3763fe43e30c80c041c70e7a9f0750145d7b0';TREE='57085d6dcd242f154b4dbb199e54a71061abbd4d';WORKER_IMAGE='sha256:b6c79a60b27494caa916ff2a1a1f3bea6f8d1d2c89b6e5fd7458b6dd52fdff42';PREPARE_MANIFEST='8f4cb176c51843efdfa7833320a7e4269e403dbaa71589ca8605691085100f7c';PREPARE_RESULT='1ed3da0eadbd5bcdad7feb6dfc297af015c22afc2d6ac0a2838688cc9576265d'
PREPARE=ROOT/'deploy/backups/qc-provider-429-20261021-prepare';OUT=ROOT/'deploy/backups/qc-provider-429-20261021-candidate-check'
OWNER='qc429-candidate-functional';QC='apps/QA部/QC成品报告系统';STAGE='entry'
PROVIDER_FIELDS=('OPENAI_API_KEY','OPENAI_BASE_URL','OPENAI_MODEL','OPENAI_API_FORMAT')
LIMITS={'OPENAI_TIMEOUT_SECONDS':'900','OPENAI_MAX_OUTPUT_TOKENS':'64000','RQ_JOB_TIMEOUT_SECONDS':'1200'}
def enc(v):return json.dumps(v,sort_keys=True,ensure_ascii=True,separators=(',',':'),allow_nan=False).encode()
def sha(v):return hashlib.sha256(v).hexdigest()
def need(v):
 if not v:raise RuntimeError('QC_CANDIDATE_FUNCTIONAL_REJECTED')
def _run(args,data=None,timeout=30):
 p=subprocess.run(args,input=data,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,timeout=timeout,cwd=ROOT);need(p.returncode==0 and len(p.stdout)<=8*1024**2);return p.stdout
def _private(name,value):
 need('/'not in name and name not in('.','..'));blob=value if type(value)is bytes else enc(value);fd=os.open(OUT/name,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
 with os.fdopen(fd,'wb')as f:f.write(blob);f.flush();os.fsync(f.fileno())
 return sha(blob)
def seal_prepare():
 need(re.fullmatch('[a-f0-9]{40}',TARGET)and re.fullmatch('[a-f0-9]{40}',TREE)and re.fullmatch('sha256:[a-f0-9]{64}',WORKER_IMAGE));need(PREPARE.is_dir()and not PREPARE.is_symlink()and stat.S_IMODE(PREPARE.stat().st_mode)==0o700)
 need(sha((PREPARE/'manifest.json').read_bytes())==PREPARE_MANIFEST and sha((PREPARE/'first-result.json').read_bytes())==PREPARE_RESULT)
 manifest=json.loads((PREPARE/'manifest.json').read_bytes());paths=list(PREPARE.rglob('*'));need(len(paths)<=100000 and all(not p.is_symlink()and(p.is_file()or p.is_dir())and p.stat().st_mode&0o077==0 for p in paths));need(set(manifest)=={str(p.relative_to(PREPARE))for p in paths if p.is_file()and p!=PREPARE/'manifest.json'})
 for name,digest in manifest.items():
  need(type(name)is str and not pathlib.PurePosixPath(name).is_absolute()and '..'not in pathlib.PurePosixPath(name).parts and re.fullmatch('[a-f0-9]{64}',digest)and sha((PREPARE/name).read_bytes())==digest)
 receipt=json.loads((PREPARE/'first-result.json').read_bytes());prepared=json.loads((PREPARE/'prepared.private.json').read_bytes());need(receipt.get('success')is True and receipt.get('target')==TARGET and receipt.get('tree')==TREE and prepared.get('target')==TARGET and prepared.get('tree')==TREE and prepared['images']['qc-report-worker']==WORKER_IMAGE and receipt['candidateImages']['qc-report-worker']==WORKER_IMAGE)
 values=json.loads((PREPARE/'desired-runtime-environments.private.json').read_bytes())['qc-report-worker'];need(all(values.get(k)==v for k,v in LIMITS.items())and all(type(values.get(k))is str and bool(values[k])for k in PROVIDER_FIELDS));need(values['OPENAI_API_FORMAT']=='bailian_chat'and values['OPENAI_MODEL']=='qwen3.8-flash'and values.get('AI_MOCK_MODE','false').strip().lower()in('false','0','no','off',''));return {k:values[k]for k in PROVIDER_FIELDS}
def snapshot(run):
 ids=run(['docker','ps','-aq','--no-trunc']).decode().split();need(ids and len(ids)==len(set(ids))and all(re.fullmatch('[a-f0-9]{64}',v)for v in ids));rows=json.loads(run(['docker','inspect',*ids]));need(len(rows)==len(ids));result={}
 for row in rows:
  state=row['State'];result[row['Id']]={k:row.get(k)for k in('Id','Name','Image','Config','HostConfig','Mounts','NetworkSettings','RestartCount')};result[row['Id']]['state']={k:state.get(k)for k in('Running','Paused','Restarting','Dead','OOMKilled','StartedAt','Pid')};result[row['Id']]['health']=state.get('Health',{}).get('Status')
 return result
def own_container(run,cid,name):
 need(re.fullmatch('[a-f0-9]{64}',cid));rows=json.loads(run(['docker','inspect',cid]));need(len(rows)==1);row=rows[0];labels=row['Config'].get('Labels')or{};need(row['Id']==cid and row['Name']=='/'+name and row['Image']==WORKER_IMAGE and labels.get('rrportal.functional.owner')==OWNER and labels.get('rrportal.functional.target')==TARGET);return row

SCRIPT=r'''import base64,hashlib,io,json,pathlib,secrets,signal,sys,tempfile
from unittest.mock import patch
from urllib import request,error
from PIL import Image,ImageDraw,ImageFont
from reportlab.pdfgen.canvas import Canvas
from ai_service import AIConfig,AIService
import ai_service,bailian_adapter
data=json.loads(sys.stdin.buffer.read(65537));values=data['provider'];assert set(values)=={'OPENAI_API_KEY','OPENAI_BASE_URL','OPENAI_MODEL','OPENAI_API_FORMAT'}
assert values['OPENAI_API_FORMAT']=='bailian_chat'and values['OPENAI_MODEL']=='qwen3.8-flash'
cfg=AIConfig(api_key=values['OPENAI_API_KEY'],base_url=values['OPENAI_BASE_URL'],model=values['OPENAI_MODEL'],api_format=values['OPENAI_API_FORMAT'],timeout_seconds=900,max_output_tokens=64000);cfg.validate();service=AIService(cfg)
result={'actualExtractPOPassed':False,'actualInspectPhotosPassed':False,'photoOCRNonceFound':False,'providerRequestCounts':{'po':0,'photos':0},'httpStatuses':{'po':None,'photos':None},'usage':{},'rawResponses':{},'fixtures':{},'moduleSHA256':{name:hashlib.sha256(pathlib.Path(module.__file__).read_bytes()).hexdigest()for name,module in [('ai_service.py',ai_service),('bailian_adapter.py',bailian_adapter)]}}
assert result['moduleSHA256']==data['sourceSHA256']and not any(name in sys.modules for name in('app','sqlalchemy','redis','rq'))
class NoRedirect(request.HTTPRedirectHandler):
 def redirect_request(self,*args,**kwargs):return None
opener=request.build_opener(NoRedirect());phase=None
def capture(body):result['rawResponses'][phase]={'bodyB64':base64.b64encode(body[:65536]).decode(),'truncated':len(body)>65536}
class Response:
 def __init__(self,response):self.response=response;self.headers=response.headers
 def __enter__(self):return self
 def __exit__(self,*args):self.response.close()
 def read(self,limit):body=self.response.read(limit);capture(body);return body
def once(req,*,timeout):
 assert phase in('po','photos')and timeout==900;result['providerRequestCounts'][phase]+=1;assert result['providerRequestCounts'][phase]==1
 try:
  response=opener.open(req,timeout=120);result['httpStatuses'][phase]=response.status;return Response(response)
 except error.HTTPError as exc:
  result['httpStatuses'][phase]=exc.code
  with exc:capture(exc.read(65537))
  raise
def expired(*args):raise TimeoutError()
previous=signal.signal(signal.SIGALRM,expired)
def call(which,fn):
 global phase
 phase=which;signal.setitimer(signal.ITIMER_REAL,120)
 try:
  with patch('ai_service.request.urlopen',once):return fn()
 finally:signal.setitimer(signal.ITIMER_REAL,0)
def usage(value):return {k:v for k,v in(value or {}).items()if k in('input_tokens','output_tokens','total_tokens')and type(v)is int and 0<=v<=10**9}
try:
 with tempfile.TemporaryDirectory(prefix='qc-functional-',dir='/tmp')as folder:
  root=pathlib.Path(folder);po_number='PO'+secrets.token_hex(6).upper();item_number='SKU'+secrets.token_hex(6).upper();label='LABEL'+secrets.token_hex(6).upper()
  pdf=io.BytesIO();canvas=Canvas(pdf,pagesize=(600,300));canvas.setFont('Helvetica',18)
  for y,text in [(240,'Synthetic purchase order'),(195,'PO number: '+po_number),(150,'Item number: '+item_number),(105,'Ordered quantity: 7 PCS'),(60,'Description: Synthetic verification object')]:canvas.drawString(24,y,text)
  canvas.save();pdf_path=root/'synthetic.pdf';pdf_path.write_bytes(pdf.getvalue());result['fixtures']['synthetic.pdf']=base64.b64encode(pdf.getvalue()).decode()
  po=call('po',lambda:service.extract_po(pdf_path));items=po.data['items'];result['actualExtractPOPassed']=po.data['document_fields']['po_number']['normalized_value']==po_number and len(items)==1 and items[0]['fields']['item_number']['normalized_value']==item_number and items[0]['fields']['ordered_quantity']['normalized_value']=='7';result['usage']['po']=usage(po.metadata.usage)
  if not result['actualExtractPOPassed']:raise ValueError()
  image=Image.new('RGB',(720,240),'white');draw=ImageDraw.Draw(image);draw.text((24,24),'SYNTHETIC QC LABEL',fill='black',font=ImageFont.load_default(size=26));draw.text((24,100),label,fill='black',font=ImageFont.load_default(size=32));png=io.BytesIO();image.save(png,format='PNG');photo_path=root/'synthetic.png';photo_path.write_bytes(png.getvalue());result['fixtures']['synthetic.png']=base64.b64encode(png.getvalue()).decode()
  photo_id='candidate-synthetic-photo';photos=call('photos',lambda:service.inspect_photos([{'path':str(photo_path),'photo_id':photo_id,'slot_key':'label'}]));observations=photos.data['observations'];result['actualInspectPhotosPassed']=len(observations)==1 and observations[0]['photo_id']==photo_id;result['photoOCRNonceFound']=any(label in text for item in observations for text in item['ocr_text']);result['usage']['photos']=usage(photos.metadata.usage)
except Exception as exc:
 allowed={'AIConfigurationError','AIInputError','AITransportError','AIResponseError','AIValidationError','TimeoutError'};result['safeErrorType']=type(exc).__name__ if type(exc).__name__ in allowed else 'functional_verification'
finally:signal.setitimer(signal.ITIMER_REAL,0);signal.signal(signal.SIGALRM,previous);values=data=cfg=service=None
print(json.dumps(result,sort_keys=True,separators=(',',':')),flush=True)
'''
def check(run=_run,private=_private):
 global STAGE
 need(FUNCTIONAL_PIN and os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_ATTEMPT')=='1');provider=seal_prepare();need(run(['git','rev-parse','HEAD']).decode().strip()==TARGET and run(['git','rev-parse',TARGET+'^{tree}']).decode().strip()==TREE);before=snapshot(run);private('all-original-containers-before.private.json',before);name='rr-portal-qc-functional-'+TARGET[:12];need(all(row['Name']!='/'+name for row in before.values()));workers=[row for row in before.values()if(row['Config'].get('Labels')or{}).get('com.docker.compose.project')=='rr-portal'and(row['Config'].get('Labels')or{}).get('com.docker.compose.service')=='qc-report-worker'];need(len(workers)==1 and workers[0]['state']['Running']is True and workers[0]['health']=='healthy');networks=workers[0]['NetworkSettings']['Networks'];need(len(networks)==1);network=next(iter(networks));need(re.fullmatch('[A-Za-z0-9_.-]{1,128}',network)and network not in('host','none'))
 image=json.loads(run(['docker','image','inspect',WORKER_IMAGE]));need(len(image)==1 and image[0]['Id']==WORKER_IMAGE and image[0]['Architecture']=='amd64'and image[0]['Os']=='linux'and(image[0]['Config'].get('Labels')or{}).get('org.opencontainers.image.revision')==TARGET and not image[0]['Config'].get('Volumes'));source={name:sha(run(['git','show',TARGET+':'+QC+'/'+name]))for name in('ai_service.py','bailian_adapter.py')};cid=None;result={'target':TARGET,'tree':TREE,'workerImageID':WORKER_IMAGE,'actualExtractPOPassed':False,'actualInspectPhotosPassed':False,'allOriginalContainersUnchanged':False,'candidateContainerRemoved':False,'success':False,'businessWritesPerformed':False,'queueWritesPerformed':False,'originalContainerSignalsSent':False}
 try:
  STAGE='create-owned-readonly-candidate';cid=run(['docker','create','-i','--pull','never','--name',name,'--label','rrportal.functional.owner='+OWNER,'--label','rrportal.functional.target='+TARGET,'--read-only','--tmpfs','/tmp:rw,noexec,nosuid,size=67108864,mode=1777','--user','65534:65534','--cap-drop','ALL','--security-opt','no-new-privileges','--pids-limit','64','--memory','512m','--memory-swap','512m','--log-driver','none','--no-healthcheck','--network',network,'--entrypoint','python',WORKER_IMAGE,'-B','-c',SCRIPT]).decode().strip();need(cid not in before);row=own_container(run,cid,name);host=row['HostConfig'];need(row['Config']['User']=='65534:65534'and host['ReadonlyRootfs']is True and not host.get('Binds')and not host.get('VolumesFrom')and set(host.get('Tmpfs')or{})=={'/tmp'}and host['NetworkMode']==network and host['LogConfig']['Type']=='none'and all(m.get('Type')=='tmpfs'and m.get('Destination')=='/tmp'for m in row.get('Mounts',[])))
  STAGE='two-actual-candidate-service-calls';raw=run(['docker','start','-a','-i',cid],enc({'provider':provider,'sourceSHA256':source}),300);need(len(raw)<=512*1024);private('candidate-functional-envelope.private.json',raw);value=json.loads(raw);need(type(value)is dict and value.get('moduleSHA256')==source);counts=value.get('providerRequestCounts');need(type(counts)is dict and set(counts)=={'po','photos'}and all(type(v)is int and 0<=v<=1 for v in counts.values()));result.update(actualExtractPOPassed=value.get('actualExtractPOPassed')is True,actualInspectPhotosPassed=value.get('actualInspectPhotosPassed')is True,photoOCRNonceFound=value.get('photoOCRNonceFound')is True,providerRequestCounts=counts)
  statuses=value.get('httpStatuses');result['providerHTTPStatus']={k:v if type(v)is int and 100<=v<=599 else None for k,v in statuses.items()}if type(statuses)is dict and set(statuses)=={'po','photos'}else{};result['usage']={phase:{k:v for k,v in info.items()if k in('input_tokens','output_tokens','total_tokens')and type(v)is int and 0<=v<=10**9}for phase,info in value.get('usage',{}).items()if phase in('po','photos')and type(info)is dict}
  for phase,item in value.get('rawResponses',{}).items():
   need(phase in('po','photos')and type(item)is dict);body=base64.b64decode(item['bodyB64'],validate=True);need(len(body)<=65536);private('candidate-'+phase+'-response.private.bin',body)
  for filename,b64 in value.get('fixtures',{}).items():
   need(filename in('synthetic.pdf','synthetic.png'));blob=base64.b64decode(b64,validate=True);need(len(blob)<=65536);private('candidate-'+filename,blob)
  result['sourceModulesVerified']=True
 except Exception:result['failedStage']=STAGE
 finally:
  provider=None
  try:
   if cid is None:
    candidates=run(['docker','ps','-aq','--no-trunc','--filter','name=^/'+name+'$']).decode().split();need(len(candidates)<=1);cid=candidates[0]if candidates else None
   if cid is not None:
    need(cid not in before);own_container(run,cid,name);run(['docker','rm','--force',cid]);remaining=run(['docker','ps','-aq','--no-trunc']).decode().split();need(cid not in remaining)
   result['candidateContainerRemoved']=True
  except Exception:result['candidateCleanupFailed']=True
  try:
   after=snapshot(run);private('all-original-containers-after.private.json',after);result['allOriginalContainersUnchanged']=after==before
  except Exception:result['originalContainerVerificationFailed']=True
 result['success']='failedStage'not in result and result.get('sourceModulesVerified')is True and result['actualExtractPOPassed']and result['actualInspectPhotosPassed']and result['allOriginalContainersUnchanged']and result['candidateContainerRemoved']and result.get('providerRequestCounts')=={'po':1,'photos':1};return result
def terminate(*args):raise TimeoutError('QC_CANDIDATE_FUNCTIONAL_TERMINATED')
def main():
 need(len(sys.argv)==2 and sys.argv[1]=='candidate-check'and FUNCTIONAL_PIN);os.umask(0o077);OUT.mkdir(mode=0o700)
 previous=signal.signal(signal.SIGTERM,terminate)
 try:result=check()
 except Exception:result={'mode':'candidate-check','success':False,'safeFailure':'QC_CANDIDATE_FUNCTIONAL_PREFLIGHT_FAILED'}
 finally:signal.signal(signal.SIGTERM,previous)
 result['mode']='candidate-check';digest=_private('first-result.json',result);manifest={p.name:sha(p.read_bytes())for p in OUT.iterdir()if p.is_file()};msha=_private('manifest.json',manifest);print(enc(dict(result,resultSHA256=digest,manifestSHA256=msha)).decode(),flush=True);return 0 if result['success']else 1
if __name__=='__main__':
 try:code=main()
 except Exception:print('{"mode":"candidate-check","success":false,"safeFailure":"QC_CANDIDATE_FUNCTIONAL_GATE_REJECTED"}',flush=True);code=1
 sys.exit(code)
