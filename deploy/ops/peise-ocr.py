"""Private, read-only diagnosis. Never print API keys, raw logs or provider text."""
import hashlib
import datetime
import json
import os
import pathlib
import re
import sqlite3
import stat
import subprocess
import sys
import tempfile

REPO = pathlib.Path('/opt/rr-portal')
CONTAINER = 'rr-portal-peise-1'
APP = REPO / 'apps/PMC跟仓管/配色库存管理'
MODEL = 'qwen3-vl-plus'
TABLES = ['pigment','stock','transaction','pending_review','setting']

def business_audit(file):
    db=sqlite3.connect(file.as_uri()+'?mode=ro',uri=True)
    try:
        db.execute('PRAGMA query_only=ON');db.execute('BEGIN')
        if db.execute('PRAGMA quick_check').fetchone()[0]!='ok':
            raise RuntimeError('DATABASE_INTEGRITY_FAILED')
        result={}
        for table in TABLES:
            digest=hashlib.sha256();count=0
            for row in db.execute('SELECT * FROM "'+table+'" ORDER BY rowid'):
                digest.update(json.dumps(row,ensure_ascii=True,separators=(',',':')).encode());digest.update(b'\n');count+=1
            result[table]={'count':count,'hash':digest.hexdigest()}
        return result
    finally:
        db.close()

def env_with_model(before):
    lines=before.splitlines(keepends=True);matches=[];quoted=None
    pattern=re.compile(rb'^[ \t]*(?:export[ \t]+)?PEISE_BAILIAN_MODEL[ \t]*=')
    for index,line in enumerate(lines):
        if quoted is None:
            if pattern.match(line):matches.append(index)
            opener=re.match(rb'^[ \t]*(?:export[ \t]+)?[A-Za-z_][A-Za-z_0-9]*[ \t]*=[ \t]*([\x27\x22])',line)
            content=line[opener.end():] if opener else b''
            if opener:quoted=opener.group(1)[0]
        else:content=line
        escaped=False
        if quoted is not None:
            for byte in content:
                if escaped:escaped=False
                elif byte==92:escaped=True
                elif byte==quoted:quoted=None;break
        if pattern.match(line) and index in matches and quoted is not None:
            raise RuntimeError('MODEL_MULTILINE_UNSUPPORTED')
    if quoted is not None or len(matches)>1:
        raise RuntimeError('PRIVATE_ENV_AMBIGUOUS')
    model=b'PEISE_BAILIAN_MODEL='+MODEL.encode()
    if matches:
        index=matches[0];line=lines[index]
        ending=b'\r\n' if line.endswith(b'\r\n') else b'\n' if line.endswith(b'\n') else b''
        lines[index]=model+ending;return b''.join(lines)
    newline=b'\r\n' if b'\r\n' in before else b'\n'
    return before+(newline if before and not before.endswith((b'\r',b'\n')) else b'')+model+newline

def configure():
    os.umask(0o077)
    directory=REPO/'deploy/backups'/('peise-ocr-'+datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ'))
    directory.mkdir(mode=0o700,parents=True)
    envfile=REPO/'.env.cloud.production'
    if not envfile.is_file() or envfile.is_symlink():raise RuntimeError('PRIVATE_ENV_FILE_INVALID')
    info=envfile.stat();before=envfile.read_bytes();after=env_with_model(before)
    (directory/'env.before').write_bytes(before)
    source=sqlite3.connect((APP/'instance/peise.db').as_uri()+'?mode=ro',uri=True)
    target=sqlite3.connect(directory/'peise.db')
    try:source.backup(target)
    finally:target.close();source.close()
    audit=business_audit(directory/'peise.db')
    (directory/'audit.json').write_text(json.dumps(audit))
    manifest={file.name:hashlib.sha256(file.read_bytes()).hexdigest() for file in directory.iterdir() if file.is_file()}
    (directory/'manifest.json').write_text(json.dumps(manifest))
    for file in directory.iterdir():file.chmod(0o600)
    descriptor,temporary=tempfile.mkstemp(prefix='.peise-model-',dir=REPO)
    try:
        with os.fdopen(descriptor,'wb') as output:
            output.write(after);output.flush();os.fsync(output.fileno())
            os.fchown(output.fileno(),info.st_uid,info.st_gid);os.fchmod(output.fileno(),stat.S_IMODE(info.st_mode))
        if envfile.read_bytes()!=before:raise RuntimeError('PRIVATE_ENV_CHANGED_DURING_PREFLIGHT')
        os.replace(temporary,envfile)
    finally:
        if os.path.exists(temporary):os.unlink(temporary)
    return {'modelConfigured':MODEL,'environmentUpdated':before!=after,'backup':str(directory),
            'databaseBackupVerified':True,'businessTableCounts':{table:value['count'] for table,value in audit.items()},
            'credentialsChanged':False,'businessWritesPerformed':False,'containerRecreated':False}

def command(args, source=None):
    result = subprocess.run(args, input=source, text=True, capture_output=True, cwd=REPO, timeout=150)
    if result.returncode:
        raise RuntimeError('PEISE_DIAGNOSTIC_COMMAND_FAILED')
    return result.stdout

CONTAINER_SOURCE = r'''
import base64,hashlib,io,json,os,pathlib,re,sqlite3,time,urllib.parse
from html.parser import HTMLParser
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
 candidate=None
 if os.environ.get('PEISE_OPS_MODE')=='candidates' and key and allowed:
  try:
   available=requests.get(base+'/models',headers={'Authorization':'Bearer '+key},timeout=(10,20),allow_redirects=False)
   listed=available.json().get('data',[]) if available.status_code==200 else []
   result['knownVisionModelsListed']=[name for name in sorted(known_models) if any(isinstance(item,dict) and item.get('id')==name for item in listed)]
  except (requests.RequestException,ValueError,AttributeError):result['knownVisionModelsListed']=[]
  result['candidateModels']=[]
  for name in ['qwen3-vl-plus','qwen3-vl-flash']:
   try:
    candidate_payload={'model':name,'messages':[{'role':'user','content':'Reply OK only.'}],'max_tokens':4,'temperature':0}
    trial=requests.post(base+'/chat/completions',headers={'Authorization':'Bearer '+key,'Content-Type':'application/json'},json=candidate_payload,timeout=(10,30),allow_redirects=False)
    result['candidateModels'].append({'model':name,'httpStatus':trial.status_code})
    if trial.status_code==200:candidate=name;break
   except requests.RequestException:result['candidateModels'].append({'model':name,'category':'network_or_timeout'})
  if candidate:os.environ['BAILIAN_MODEL']=candidate
 if (os.environ.get('PEISE_OPS_MODE') in {'smoke','verify'} and result['provider'].get('httpStatus')==200) or candidate:
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
   result['syntheticImage']={'passed':len(matching)==1,'model':candidate or (model if model in known_models else '[other-model]'),'rows':len(rows),'seconds':round(time.monotonic()-started,1),'businessImageSent':False}
  except Exception as error:
   result['syntheticImage']={'passed':False,'category':getattr(error,'code','legacy_unclassified_error') if getattr(error,'code',None) in {'not_configured','timeout','network','unauthorized','forbidden','rate_limit','service','http','response','invalid_json','unexpected'} else 'legacy_unclassified_error'}
  if os.environ.get('PEISE_OPS_MODE')=='verify' and result.get('syntheticImage',{}).get('passed'):
   class Inputs(HTMLParser):
    def __init__(self):super().__init__();self.fields={}
    def handle_starttag(self,tag,attrs):
     if tag=='input':
      values=dict(attrs);name=values.get('name')
      if name in {'pigment_code[]','purchase_code[]','quantity[]'}:self.fields.setdefault(name,[]).append(values.get('value',''))
   session=requests.Session()
   login=session.post('http://127.0.0.1:5006/login',data={'username':os.environ['AUTH_USERNAME'],'password':os.environ['AUTH_PASSWORD']},timeout=(5,15),allow_redirects=False)
   if login.status_code!=302:raise RuntimeError('LOCAL_OCR_LOGIN_FAILED')
   result['authenticatedPreview']=[]
   try:
    for kind,format,mime in [('in','PNG','image/png'),('out','JPEG','image/jpeg')]:
     png=io.BytesIO();image.save(png,format=format)
     preview=session.post('http://127.0.0.1:5006/transactions/'+kind+'/ocr',files={'file':('synthetic.'+('png' if format=='PNG' else 'jpg'),png.getvalue(),mime)},timeout=(10,90),allow_redirects=False)
     parser=Inputs();parser.feed(preview.text)
     code_present=any('TEST-PEISE-001'==value.upper() for name in ['pigment_code[]','purchase_code[]'] for value in parser.fields.get(name,[]))
     quantity_present=any(value in {'2','2.0','2.00'} for value in parser.fields.get('quantity[]',[]))
     result['authenticatedPreview'].append({'type':kind,'format':format,'httpStatus':preview.status_code,'syntheticCodeMatched':code_present,'syntheticQuantityMatched':quantity_present,'errorAlert':bool(re.search(r'alert[^"<>]*danger',preview.text)),'submitted':False})
   finally:
    session.get('http://127.0.0.1:5006/logout',timeout=(5,15),allow_redirects=False);session.close()
 expected=json.loads(os.environ.get('PEISE_EXPECTED_SOURCE_HASHES','{}'))
 result['runningSourcesMatch']=all(hashlib.sha256((pathlib.Path('/app')/file).read_bytes()).hexdigest()==digest for file,digest in expected.items()) if expected else None
 after=business_state();result['businessDataUnchanged']=before==after;result['businessWritesPerformed']=False
 print(json.dumps(result))
except Exception:
 print(json.dumps({'failed':True,'safeError':'PEISE_CONTAINER_DIAGNOSTIC_FAILED'}));raise SystemExit(1)
'''

def main():
    mode = sys.argv[1]
    if mode=='configure':
        print(json.dumps(configure()));return
    if mode not in ['diagnose', 'smoke', 'candidates','verify']:
        raise RuntimeError('INVALID_DIAGNOSTIC_MODE')
    projected = json.loads(command(['docker','compose','-f','docker-compose.cloud.yml','--env-file','.env.cloud.production','config','--format','json']))
    key = projected['services']['peise']['environment'].get('BAILIAN_API_KEY','') or ''
    secret = os.environ.get('PEISE_CONFIGURED_SECRET','').strip()
    state=json.loads(command(['docker','inspect','-f','{"running":{{.State.Running}},"restartCount":{{.RestartCount}},"health":{{json .State.Health.Status}},"memory":{{.HostConfig.Memory}}}',CONTAINER]))
    hashes={file:hashlib.sha256((APP/file).read_bytes()).hexdigest() for file in ['app/services/ocr_llm.py','app/routes/transactions.py']} if mode=='verify' else {}
    result=json.loads(command(['docker','exec','-i','-e','PEISE_OPS_MODE='+mode,'-e','PEISE_EXPECTED_KEY_HASH='+hashlib.sha256(key.encode()).hexdigest(),'-e','PEISE_EXPECTED_SOURCE_HASHES='+json.dumps(hashes),CONTAINER,'python','-'],CONTAINER_SOURCE))
    if mode=='verify':
        backup=sorted((REPO/'deploy/backups').glob('peise-ocr-*'))[-1]
        audit=json.loads((backup/'audit.json').read_text());current=business_audit(APP/'instance/peise.db')
        result['deploymentBusinessDataPreserved']=audit==current
        result['serverSourceCommit']=command(['git','rev-parse','HEAD']).strip()
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
