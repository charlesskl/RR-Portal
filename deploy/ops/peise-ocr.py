"""Private, read-only diagnosis. Never print API keys, raw logs or provider text."""
import hashlib
import json
import os
import pathlib
import re
import subprocess
import sys

REPO = pathlib.Path('/opt/rr-portal')
CONTAINER = 'rr-portal-peise-1'

def command(args, source=None):
    result = subprocess.run(args, input=source, text=True, capture_output=True, cwd=REPO, timeout=150)
    if result.returncode:
        raise RuntimeError('PEISE_DIAGNOSTIC_COMMAND_FAILED')
    return result.stdout

CONTAINER_SOURCE = r'''
import base64,hashlib,io,json,os,pathlib,re,sqlite3,time,urllib.parse
import requests
try:
 key=os.environ.get('BAILIAN_API_KEY','').strip()
 model=os.environ.get('BAILIAN_MODEL','').strip() or 'qwen-vl-max'
 base=(os.environ.get('BAILIAN_BASE_URL','').strip() or 'https://dashscope.aliyuncs.com/compatible-mode/v1').rstrip('/')
 parsed=urllib.parse.urlparse(base)
 allowed=parsed.scheme=='https' and not parsed.username and not parsed.password and bool(re.fullmatch(r'(?:dashscope(?:-intl|-us)?\.aliyuncs\.com|[a-zA-Z0-9-]+\.(?:cn-beijing|ap-southeast-1|us-east-1|ap-northeast-1|eu-central-1|cn-hongkong)\.maas\.aliyuncs\.com)',parsed.hostname or ''))
 known_models={'qwen-vl-max','qwen-vl-plus','qwen-vl-max-latest','qwen3-vl-plus','qwen3-vl-flash','qwen-vl-ocr','qwen-vl-ocr-latest'}
 dbpath=pathlib.Path('/app/instance/peise.db')
 def business_state():
  db=sqlite3.connect(dbpath.as_uri()+'?mode=ro',uri=True);db.execute('PRAGMA query_only=ON');db.execute('BEGIN')
  result={}
  for table in ['pigment','stock','transaction','pending_review','setting']:
   if not db.execute('SELECT 1 FROM sqlite_master WHERE type=\'table\' AND name=?',(table,)).fetchone():continue
   digest=hashlib.sha256();count=0
   for row in db.execute('SELECT * FROM "'+table+'" ORDER BY rowid'):
    digest.update(json.dumps(row,ensure_ascii=True,separators=(',',':')).encode());digest.update(b'\n');count+=1
   result[table]={'count':count,'hash':digest.hexdigest()}
  db.rollback();db.close();return result
 before=business_state()
 result={'keyConfigured':bool(key),'keyMatchesProjectedConfig':bool(key) and hashlib.sha256(key.encode()).hexdigest()==os.environ.get('PEISE_EXPECTED_KEY_HASH'),
  'model':model if model in known_models else '[other-model]','approvedAliyunEndpoint':allowed,'defaultBeijingEndpoint':base=='https://dashscope.aliyuncs.com/compatible-mode/v1',
  'authConfigured':bool(os.environ.get('AUTH_USERNAME')) and bool(os.environ.get('AUTH_PASSWORD')),'businessTableCounts':{t:r['count'] for t,r in before.items()}}
 codes={'invalid_api_key','InvalidApiKey','access_denied','AccessDenied','ModelNotFound','model_not_found','InvalidParameter','invalid_parameter','InvalidInput','invalid_input','Throttling','RateLimitExceeded','Arrearage','AllocationQuota.FreeTierOnly','AllocationQuota','QuotaExceeded','DataInspectionFailed'}
 if key and allowed:
  started=time.monotonic()
  payload={'model':model,'messages':[{'role':'user','content':'Reply OK only.'}],'max_tokens':4,'temperature':0}
  try:
   response=requests.post(base+'/chat/completions',headers={'Authorization':'Bearer '+key,'Content-Type':'application/json'},json=payload,timeout=(10,65),allow_redirects=False)
   try:provider=response.json()
   except ValueError:provider={}
   error=provider.get('error',{}) if isinstance(provider,dict) else {}
   code=error.get('code') if isinstance(error,dict) else None
   category='success' if response.status_code==200 else 'unauthorized' if response.status_code==401 else 'forbidden' if response.status_code==403 else 'rate_limit' if response.status_code==429 else 'service_error' if response.status_code>=500 else 'request_error'
   result['provider']={'httpStatus':response.status_code,'category':category,'code':code if code in codes else 'OTHER' if response.status_code!=200 else None,'seconds':round(time.monotonic()-started,1)}
  except requests.Timeout:result['provider']={'category':'timeout'}
  except requests.RequestException:result['provider']={'category':'network_error'}
 else:result['provider']={'category':'not_called_missing_key_or_unapproved_endpoint'}
 if os.environ.get('PEISE_OPS_MODE')=='smoke' and result['provider'].get('httpStatus')==200:
  from PIL import Image,ImageDraw
  from app.services.ocr_llm import parse_image_llm
  image=Image.new('RGB',(700,150),'white');draw=ImageDraw.Draw(image)
  draw.text((15,20),'SYNTHETIC TEST DELIVERY NOTE',fill='black')
  draw.text((15,50),'CODE               QUANTITY    UNIT PRICE',fill='black')
  draw.text((15,80),'TEST-PEISE-001     2           3',fill='black')
  image=image.resize((1400,300));buffer=io.BytesIO();image.save(buffer,format='PNG')
  started=time.monotonic()
  try:
   rows=parse_image_llm(buffer.getvalue(),{'test-peise-001':1})
   matching=[r for r in rows if r.get('purchase_code','').upper()=='TEST-PEISE-001' and r.get('quantity')==2 and r.get('unit_price')==3]
   result['syntheticImage']={'passed':len(matching)==1,'rows':len(rows),'seconds':round(time.monotonic()-started,1),'businessImageSent':False}
  except Exception as error:
   result['syntheticImage']={'passed':False,'category':getattr(error,'code','legacy_unclassified_error') if getattr(error,'code',None) in {'not_configured','timeout','network','unauthorized','forbidden','rate_limit','service','http','response','invalid_json','unexpected'} else 'legacy_unclassified_error'}
 after=business_state();result['businessDataUnchanged']=before==after;result['businessWritesPerformed']=False
 print(json.dumps(result))
except Exception:
 print(json.dumps({'failed':True,'safeError':'PEISE_CONTAINER_DIAGNOSTIC_FAILED'}));raise SystemExit(1)
'''

def main():
    mode = sys.argv[1]
    if mode not in ['diagnose', 'smoke']:
        raise RuntimeError('INVALID_DIAGNOSTIC_MODE')
    projected = json.loads(command(['docker','compose','-f','docker-compose.cloud.yml','--env-file','.env.cloud.production','config','--format','json']))
    key = projected['services']['peise']['environment'].get('BAILIAN_API_KEY','') or ''
    secret = os.environ.get('PEISE_CONFIGURED_SECRET','').strip()
    state=json.loads(command(['docker','inspect','-f','{"running":{{.State.Running}},"restartCount":{{.RestartCount}},"health":{{json .State.Health.Status}},"memory":{{.HostConfig.Memory}}}',CONTAINER]))
    result=json.loads(command(['docker','exec','-i','-e','PEISE_OPS_MODE='+mode,'-e','PEISE_EXPECTED_KEY_HASH='+hashlib.sha256(key.encode()).hexdigest(),CONTAINER,'python','-'],CONTAINER_SOURCE))
    result['serverEnvKeyConfigured']=bool(key)
    result['githubSecretConfigured']=bool(secret)
    result['serverEnvMatchesGithubSecret']=bool(key) and bool(secret) and key==secret
    result['container']=state
    logs=subprocess.run(['docker','logs','--since','24h','--tail','1000',CONTAINER],text=True,capture_output=True,cwd=REPO)
    text=logs.stdout+'\n'+logs.stderr
    lines=[line for line in text.splitlines() if 'LLM OCR' in line]
    result['recentErrorCounts']={'llmOCR':len(lines),'http401':sum(bool(re.search(r'HTTP 401\b',line)) for line in lines),'http403':sum(bool(re.search(r'HTTP 403\b',line)) for line in lines),'http429':sum(bool(re.search(r'HTTP 429\b',line)) for line in lines),'timeout':sum('timeout' in line.lower() or 'timed out' in line.lower() for line in lines),'missingKey':sum('BAILIAN_API_KEY 未设置' in line for line in lines)}
    print(json.dumps(result))

try:
    main()
except Exception:
    print(json.dumps({'failed':True,'safeError':'PEISE_DIAGNOSTIC_FAILED'}));sys.exit(1)
