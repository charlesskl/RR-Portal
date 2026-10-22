"""One fixed-window, read-only factory AI log diagnostic. Draft gate is false.

Only _logs request rows for the exact route/window are queried. No raw rows,
error text, headers, users, query strings, vendor responses or inspect are saved.
"""
import contextlib,datetime,hashlib,json,math,os,pathlib,re,sqlite3,stat,subprocess,sys
PIN=True
TARGET='f50e23735af6e198721830e26e35e26162f09af0'
TREE='6f8cfbdf0e607ccdca59b0cc0c21c5d430ece5f2'
BRANCH='refs/heads/ops/factory-analysis-ai-log-20261022-4'
ROOT=pathlib.Path('/opt/rr-portal')
OUT=ROOT/'deploy/backups/factory-analysis-ai-log-20261022-4'
ARCHIVE=ROOT/'deploy/backups/qms-api-auth-20261021-deploy'
MANIFEST_SHA='4fe3efb9e171a9d93c6d90464a7568c6c5eb56928ba8f9561ab624c207a607b1'
RESULT_SHA='b50d527816a5b3542148eae141fc0ef91d9b7a60f91909aa1a4b12d3835686c7'
SERVICES=('factory-review','factory-review-test')
# Exact compose bind sources, docker-compose.cloud.yml lines959/998 at TARGET.
LIVE_RELATIVE={'factory-review':'apps/PMC跟仓管/加工厂月度评审管理制度/pb_data','factory-review-test':'apps/PMC跟仓管/加工厂月度评审管理制度/pb_data_test'}
ROUTE='/api/factory-review/analysis-ai'
START='2026-10-22T00:25:00Z';END='2026-10-22T01:05:00Z';INCIDENT='2026-10-22T00:46:00Z'
JSON_KEYS=('type','url','method','status','error','details','message','execTime')
ROUTE_LABELS={ROUTE:'analysis', '/factory-review'+ROUTE:'production_prefixed_analysis', '/factory-review-test'+ROUTE:'test_prefixed_analysis', ROUTE+'/config':'analysis_config', '/factory-review'+ROUTE+'/config':'production_prefixed_analysis_config', '/factory-review-test'+ROUTE+'/config':'test_prefixed_analysis_config'}
METHODS=('GET','POST','HEAD','OPTIONS','PUT','PATCH','DELETE')
FIELD_TYPES=('integer','real','text','null','true','false','array','object','missing')
EXCEPTIONS=('ApiError','BadRequestError','ForbiddenError','UnauthorizedError','InternalServerError','TypeError','ReferenceError','SyntaxError','RangeError','TimeoutError','NetworkError','Error')
IDENTIFIERS=('ECONNREFUSED','ECONNRESET','ETIMEDOUT','EHOSTUNREACH','ENOTFOUND','EAI_AGAIN','SQLITE_BUSY','SQLITE_LOCKED','SQLITE_READONLY','SQLITE_ERROR','SQLITE_CONSTRAINT')
MESSAGES=(
 '权限配置无效','没有分析数据查看权限','没有可分析的数据权限','AI服务尚未配置，规则预警仍可使用','AI服务提供商配置无效','AI服务地址配置无效',
 '工厂数量过多，请选择单个工厂分析','没有该工厂的查看权限','没有可分析的工厂','范围内记录过多，请缩短时间或选择工厂后重试',
 '分析明细超过500条，请缩短时间或选择工厂；系统不会截取部分数据冒充全局结论','所选范围没有可分析的记录，请调整日期或工厂','分析内容过多，请缩小范围',
 '账号权限已变化，请重新分析','数据或访问权限已变化，请重新分析','今天已达到20次分析额度，请明天再试','请间隔60秒再发起分析',
 'AI服务连接失败或超时，请稍后重试；规则预警仍可使用','AI服务暂不可用，请管理员检查模型权限、额度及配置',
 '无有效角色权限','请求只能包含日期范围、工厂和问题','请选择不晚于今天、跨度不超过180天的有效日期范围','请输入2至600字的分析问题','工厂参数无效',
 'AI未完成分析，请缩小范围或稍后重试','AI未能回答此问题，请调整问题','AI返回格式异常，请重试','AI返回内容不完整，请重试','AI结论缺少有效证据，已停止展示，请重试')
CLASSES={'network_timeout':('context deadline exceeded','i/o timeout','ETIMEDOUT'), 'network_dns':('no such host','ENOTFOUND','EAI_AGAIN'),
 'network_connection_refused':('connection refused','ECONNREFUSED'), 'network_connection_reset':('connection reset','ECONNRESET'),
 'network_tls':('x509:','tls:','certificate verify failed'), 'sqlite_missing_table':('no such table:',), 'sqlite_missing_column':('no such column:',),
 'sqlite_locked':('database is locked','SQLITE_BUSY','SQLITE_LOCKED'), 'sqlite_readonly':('readonly database','read-only database','SQLITE_READONLY'), 'sqlite_constraint':('SQLITE_CONSTRAINT','constraint failed')}
SAFE_TYPES=('RuntimeError','ValueError','UnicodeDecodeError','JSONDecodeError','OperationalError','DatabaseError','OSError','PermissionError','FileNotFoundError','TimeoutExpired')
MAX_DATA=262144;STAGE='entry'

def need(value,label):
 global STAGE
 if not value:STAGE=label;raise RuntimeError('DIAGNOSTIC_REJECTED')
def enc(value):return json.dumps(value,sort_keys=True,ensure_ascii=True,separators=(',',':'),allow_nan=False).encode()
def sha(value):return hashlib.sha256(value).hexdigest()
def regular(path):
 need(path.is_file()and not path.is_symlink()and path.resolve()==path,'regular-canonical-file')
 for parent in path.parents:
  need(not parent.is_symlink(),'no-symlink-ancestor')
  if parent==ROOT:break
 return path

def digest(path,maximum=1024**3):
 regular(path)
 with os.fdopen(os.open(path,os.O_RDONLY|os.O_NOFOLLOW),'rb')as f:
  a=os.fstat(f.fileno());need(stat.S_ISREG(a.st_mode)and a.st_size<=maximum,'bounded-regular-read');h=hashlib.sha256()
  for block in iter(lambda:f.read(1024*1024),b''):h.update(block)
  b=os.fstat(f.fileno());need((a.st_dev,a.st_ino,a.st_size,a.st_mtime_ns)==(b.st_dev,b.st_ino,b.st_size,b.st_mtime_ns),'stable-file-read')
 return h.hexdigest()
def bounded(path,maximum):
 regular(path);need(path.stat().st_size<=maximum,'bounded-json-file');return path.read_bytes()
def run(args):
 p=subprocess.run(args,cwd=ROOT,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=30)
 need(p.returncode==0 and len(p.stdout)<=4*1024**2,'readonly-command-success');return p.stdout

def source():
 need(run(['git','symbolic-ref','--quiet','HEAD']).decode().strip()=='refs/heads/main','canonical-main')
 need(run(['git','rev-parse','HEAD']).decode().strip()==TARGET and run(['git','rev-parse','HEAD^{tree}']).decode().strip()==TREE,'exact-live-source')

def current(service):
 need(service in SERVICES,'fixed-service');live_root=ROOT/LIVE_RELATIVE[service]
 ids=run(['docker','ps','-aq','--no-trunc','--filter','label=com.docker.compose.project=rr-portal','--filter','label=com.docker.compose.service='+service]).decode().split()
 need(len(ids)==1 and re.fullmatch('[a-f0-9]{64}',ids[0])is not None,'one-fixed-factory-container')
 template='{"id":{{json .Id}},"image":{{json .Image}},"startedAt":{{json .State.StartedAt}},"restartCount":{{json .RestartCount}},"health":{{if .State.Health}}{{json .State.Health.Status}}{{else}}null{{end}},"mounts":{{json .Mounts}}}'
 item=json.loads(run(['docker','inspect','--format',template,ids[0]]));need(item['id']==ids[0]and re.fullmatch('sha256:[a-f0-9]{64}',item['image'])and type(item['restartCount'])is int and item['restartCount']>=0 and item['health']in(None,'healthy','unhealthy','starting'),'safe-runtime-fields')
 iso(item['startedAt']);mounts=[m for m in item.pop('mounts')if m.get('Destination')=='/pb/pb_data']
 need(len(mounts)==1 and mounts[0].get('Type')=='bind'and mounts[0].get('Source')==str(live_root)and live_root.is_dir()and live_root.resolve()==live_root,'fixed-live-log-mount')
 return item

def iso(value):
 need(type(value)is str and re.fullmatch(r'\d{4}-\d\d-\d\d[ T]\d\d:\d\d:\d\d(?:\.\d{1,9})?(?:Z|[+-]\d\d:\d\d)',value)is not None,'valid-iso-time')
 normalized=re.sub(r'\.(\d{1,9})',lambda m:'.'+m.group(1)[:6].ljust(6,'0'),value);t=datetime.datetime.fromisoformat(normalized.replace('Z','+00:00')).astimezone(datetime.timezone.utc);return t

def classify(error):
 raw=error.encode()if type(error)is str else enc(error)if error is not None else b''
 text=error if type(error)is str else json.dumps(error,ensure_ascii=False,sort_keys=True,allow_nan=False)if error is not None else'';matches=[m for m in MESSAGES if m in text]
 types=[v for v in EXCEPTIONS if re.search(r'(?<![A-Za-z0-9_])'+re.escape(v)+r'(?![A-Za-z0-9_])',text)]
 identifiers=[v for v in IDENTIFIERS if re.search(r'(?<![A-Za-z0-9_])'+re.escape(v)+r'(?![A-Za-z0-9_])',text)]
 frames=[]
 for f,line,col in re.findall(r'(?<![A-Za-z0-9_.-])(analysis_ai\.pb\.js|analysis_ai\.js):([1-9][0-9]{0,5}):([1-9][0-9]{0,5})(?![0-9])',text):
  item={'file':f,'line':int(line),'column':int(col)}
  if item not in frames:frames.append(item)
 return {'errorPresent':error is not None,'errorSHA256':sha(raw)if error is not None else None,'errorBytes':len(raw),
  'knownMessageMatches':matches[:8],'exceptionTypes':types,'technicalIdentifiers':identifiers,'errorIndicators':[k for k,values in CLASSES.items()if any(v in text for v in values)],'frames':frames[:8],
  'unclassified':error is not None and text not in MESSAGES}

def readonly(path,immutable=False):
 regular(path);db=sqlite3.connect(path.as_uri()+'?mode=ro'+('&immutable=1'if immutable else''),uri=True,timeout=5)
 db.execute('PRAGMA temp_store=MEMORY');db.execute('PRAGMA query_only=ON');need(db.execute('PRAGMA query_only').fetchone()==(1,),'sqlite-query-only');db.execute('BEGIN');return db

def retention(path,immutable=False):
 with contextlib.closing(readonly(path,immutable))as db:
  row=db.execute("SELECT CASE WHEN json_valid(value) AND json_type(value,'$.logs.maxDays')='integer' THEN json_extract(value,'$.logs.maxDays') END,CASE WHEN json_valid(value) AND json_type(value,'$.logs.minLevel')='integer' THEN json_extract(value,'$.logs.minLevel') END FROM _params WHERE id='settings' LIMIT 1").fetchone()
 return {'settingsRowPresent':row is not None,'maxDays':row[0]if row and type(row[0])is int and 0<=row[0]<=36500 else None,'minLevel':row[1]if row and type(row[1])is int and -100<=row[1]<=100 else None}

def normalized_time(value):return iso(value).isoformat().replace('+00:00','Z')if value is not None else None

def logs(path,immutable=False):
 with contextlib.closing(readonly(path,immutable))as db:
  need({'id','created','level','message','data'}<={r[1]for r in db.execute('PRAGMA table_info(_logs)')},'known-log-schema')
  window="julianday(created)>=julianday(?) AND julianday(created)<julianday(?)";times=(START,END)
  total,earliest,latest=db.execute("SELECT count(*),strftime('%Y-%m-%dT%H:%M:%fZ',min(julianday(created))),strftime('%Y-%m-%dT%H:%M:%fZ',max(julianday(created))) FROM _logs").fetchone()
  window_count,valid_count=db.execute('SELECT count(*),coalesce(sum(json_valid(data)),0) FROM _logs WHERE '+window,times).fetchone()
  keys={key:db.execute("SELECT coalesce(sum(CASE WHEN json_valid(data) THEN json_type(data,'$."+key+"') IS NOT NULL ELSE 0 END),0) FROM _logs WHERE "+window,times).fetchone()[0]for key in JSON_KEYS}
  status="CASE WHEN json_valid(data) THEN json_extract(data,'$.status') END";url="CASE WHEN json_valid(data) THEN json_extract(data,'$.url') END";method="CASE WHEN json_valid(data) THEN json_extract(data,'$.method') END"
  route="CASE WHEN instr("+url+",'?')>0 THEN substr("+url+",1,instr("+url+",'?')-1) ELSE "+url+' END'
  status_type="coalesce(CASE WHEN json_valid(data) THEN json_type(data,'$.status') END,'missing')";method_type="coalesce(CASE WHEN json_valid(data) THEN json_type(data,'$.method') END,'missing')"
  integer_status="CASE WHEN "+status_type+"='integer' AND "+status+' BETWEEN 0 AND 999 THEN '+status+' END'
  success='CASE WHEN '+integer_status+' BETWEEN 200 AND 299 THEN 1 ELSE 0 END'
  safe_method="CASE WHEN "+method_type+"='text' AND "+method+" IN ('GET','POST','HEAD','OPTIONS','PUT','PATCH','DELETE') THEN "+method+' END'
  statuses={str(code):count for code,count in db.execute('SELECT '+integer_status+',count(*) FROM _logs WHERE '+window+' AND '+integer_status+' IS NOT NULL GROUP BY '+integer_status,times)}
  route_counts={label:db.execute('SELECT count(*) FROM _logs WHERE '+window+' AND '+route+'=?',(*times,path)).fetchone()[0]for path,label in ROUTE_LABELS.items()}
  names=tuple(ROUTE_LABELS);where=window+' AND '+route+' IN ('+','.join('?'for _ in names)+')'
  params=(*times,*names);count=db.execute('SELECT count(*) FROM _logs WHERE '+where,params).fetchone()[0]
  parts="json_object('error',json_extract(data,'$.error'),'details',json_extract(data,'$.details'),'message',json_extract(data,'$.message'))"
  sql='SELECT id,created,level,'+route+','+integer_status+','+status_type+','+safe_method+','+method_type+",json_extract(data,'$.execTime'),CASE WHEN "+success+'=1 THEN NULL WHEN length(CAST(data AS BLOB))<=? THEN '+parts+' END,length(CAST(data AS BLOB)) FROM _logs WHERE '+where+" ORDER BY (CASE WHEN "+success+"=1 THEN 2 ELSE 0 END)+(CASE WHEN substr("+route+",-7)='/config' THEN 1 ELSE 0 END),created,id LIMIT 100"
  rows=db.execute(sql,(MAX_DATA,*params)).fetchall();records=[]
  for identity,created,level,path,code,code_type,verb,verb_type,duration,data,data_size in rows:
   t=iso(created);need(iso(START)<=t<iso(END)and path in ROUTE_LABELS and(verb is None or verb in METHODS)and(code is None or type(code)is int and 0<=code<=999)and code_type in FIELD_TYPES and verb_type in FIELD_TYPES,'exact-request-fields')
   row={'logIdSHA256':sha(enc(identity)),'routeLabel':ROUTE_LABELS[path],'createdUTC':t.isoformat().replace('+00:00','Z'),'createdBeijing':t.astimezone(datetime.timezone(datetime.timedelta(hours=8))).isoformat(),'level':level if type(level)is int and level in(-8,-4,0,4,8,12)else None,'method':verb,'methodFieldType':verb_type,'status':code,'statusFieldType':code_type,'executionMilliseconds':duration if type(duration)in(int,float)and math.isfinite(duration)and 0<=duration<=600000 else None}
   if type(code)is int and 200<=code<=299:row['successfulResponseMetadataOnly']=True
   elif data is None:row.update(dataOversize=True,dataBytes=data_size,unclassified=True)
   else:
    value=json.loads(data);parts={k:value[k]for k in('error','details','message')if value.get(k)is not None};error=next(iter(parts.values()))if len(parts)==1 else parts or None;row.update(classify(error))
   records.append(row)
  need(rows==db.execute(sql,(MAX_DATA,*params)).fetchall(),'selected-log-rows-stable-in-read-transaction')
 return records,{'allLogsCount':total,'earliestCreatedUTC':normalized_time(earliest),'latestCreatedUTC':normalized_time(latest),'windowLogsCount':window_count,'windowValidJsonCount':valid_count,'jsonKeysPresence':keys,'windowStatusIntegerCounts':statuses,'windowInvalidStatusCount':window_count-sum(statuses.values()),'fixedRouteCounts':route_counts,'matchingCount':count,'returnedCount':len(records),'limitedTo100':count>100,'queryOnly':True,'immutable':immutable}

def sealed():
 need(ARCHIVE.is_dir()and not ARCHIVE.is_symlink()and stat.S_IMODE(ARCHIVE.stat().st_mode)==0o700,'fixed-private-deploy-archive')
 manifest_raw=bounded(ARCHIVE/'manifest.json',16*1024**2);result_raw=bounded(ARCHIVE/'first-result.json',1024**2)
 need(sha(manifest_raw)==MANIFEST_SHA and sha(result_raw)==RESULT_SHA,'exact-deploy-seals');manifest=json.loads(manifest_raw);result=json.loads(result_raw)
 need(type(manifest)is dict and result.get('mode')=='deploy'and result.get('success')is True and result.get('target')==TARGET and result.get('tree')==TREE and enc(result)==result_raw,'bound-canonical-deploy-result')
 selected={}
 for service in SERVICES:
  selected[service]={}
  for filename in('auxiliary.db','data.db'):
   name=service+'-closed-before/sqlite/'+filename;need(re.fullmatch('[a-f0-9]{64}',manifest.get(name,'')),'selected-file-manifest-entry');path=ARCHIVE/name;need(digest(path)==manifest[name],'selected-snapshot-byte-seal');selected[service][filename]=(path,manifest[name])
 return selected

def collect():
 global STAGE
 STAGE='source-before';source();STAGE='current-containers-before';before={s:current(s)for s in SERVICES};STAGE='sealed-archive';selected=sealed();union={};coverage={}
 for service in SERVICES:
  coverage[service]={}
  for origin,immutable in(('sealed_pre_cutover',True),('current_live',False)):
   STAGE='query-'+service+'-'+origin;aux=selected[service]['auxiliary.db'][0]if immutable else ROOT/LIVE_RELATIVE[service]/'auxiliary.db';data=selected[service]['data.db'][0]if immutable else ROOT/LIVE_RELATIVE[service]/'data.db'
   records,counts=logs(aux,immutable);counts['logSettings']=retention(data,immutable);coverage[service][origin]=counts
   for row in records:
    key=(service,row['logIdSHA256']);existing=union.get(key)
    if existing is None:union[key]=dict(row,service=service,sources=[origin])
    else:
     need({k:v for k,v in existing.items()if k not in('sources','service')}==row,'same-log-identity-has-same-safe-fields');existing['sources'].append(origin)
 STAGE='source-after';source();STAGE='current-containers-after';need({s:current(s)for s in SERVICES}==before,'selected-runtimes-unchanged');STAGE='sealed-evidence-after'
 need(all(digest(path)==expected for files in selected.values()for path,expected in files.values())and digest(ARCHIVE/'manifest.json',16*1024**2)==MANIFEST_SHA and digest(ARCHIVE/'first-result.json',1024**2)==RESULT_SHA,'selected-archive-evidence-unchanged')
 boundaries={s:{'currentStartedAt':row['startedAt'],'currentInstanceCoversIncident':iso(row['startedAt'])<=iso(INCIDENT),'coverage':'current_instance_started_after_window'if iso(row['startedAt'])>=iso(END)else'current_instance_started_after_incident_partial_window'if iso(row['startedAt'])>iso(INCIDENT)else'current_instance_started_inside_window_before_incident'if iso(row['startedAt'])>iso(START)else'current_instance_started_before_window'}for s,row in before.items()}
 return {'sanitizedRecords':sorted(union.values(),key=lambda r:((2 if r.get('successfulResponseMetadataOnly')is True else 0)+(1 if r['routeLabel'].endswith('_config')else 0),r['createdUTC'],r['service'],r['logIdSHA256'])),'sourceCoverage':coverage,'currentRuntime':before,'historyCoverageBoundary':boundaries,'incidentUTC':INCIDENT,
  'dockerLogsRead':False,'currentEmptyLogsWouldNotDisproveIncident':any(not v['currentInstanceCoversIncident']for v in boundaries.values()),'selectedArchiveFilesVerified':4,'selectedArchiveUnchanged':True,'entireArchiveRehashed':False,'logsUnchangedByCollector':True,'sqliteWritesPerformed':False,'selectedRowsStableWithinReadTransaction':True,'databaseSnapshotsNotCrossDatabaseAtomic':True,'recordSelection':'failed_analysis_first_then_other_failure_then_success_metadata',
  'upstreamStatusOrResponseRecoverable':False,'upstreamDetailLimitation':'hook_replaces_network_exception_and_non200_upstream_details_with_fixed_messages'}

def private(name,raw):
 fd=os.open(OUT/name,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
 with os.fdopen(fd,'wb')as f:f.write(raw);f.flush();os.fsync(f.fileno())

def main():
 need(PIN is True and sys.argv[1:]==['diagnose']and os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_ATTEMPT')=='1','false-gate-or-wrong-invocation')
 os.umask(0o077);need(OUT.parent.is_dir()and OUT.parent.resolve()==OUT.parent,'canonical-output-parent');OUT.mkdir(mode=0o700)
 result={'mode':'diagnose','target':TARGET,'tree':TREE,'success':False,'readOnly':True,'route':ROUTE,'windowStartUTC':START,'windowEndUTCExclusive':END,'rawLogOrErrorSaved':False,'credentialsOrBusinessDetailsPrinted':False,'httpOrModelCallsPerformed':False,'containerSignalsPerformed':False}
 try:result.update(collect(),success=True)
 except BaseException as e:result.update(failedStage=STAGE,safeExceptionType=type(e).__name__ if type(e).__name__ in SAFE_TYPES else'Exception')
 finally:
  result['outputRecordsOmitted']=0
  while len(enc(result))>120000 and result.get('sanitizedRecords'):
   result['sanitizedRecords'].pop();result['outputRecordsOmitted']+=1
  raw=enc(result);private('first-result.json',raw);manifest=enc({'first-result.json':sha(raw)});private('manifest.json',manifest)
  print(enc(dict(result,manifestSHA256=sha(manifest),resultSHA256=sha(raw))).decode(),flush=True)
 return 0 if result['success']else 1

if __name__=='__main__':
 try:sys.exit(main())
 except SystemExit:raise
 except BaseException:print('{"mode":"diagnose","success":false,"safeFailure":"FIXED_DIAGNOSTIC_PREFLIGHT_REJECTED"}',flush=True);sys.exit(1)
