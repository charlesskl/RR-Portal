"""One fixed-window, read-only factory AI log diagnostic. Draft gate is false.

Only _logs request rows for the exact route/window are queried. No raw rows,
error text, headers, users, query strings, vendor responses or inspect are saved.
"""
import contextlib,datetime,hashlib,json,math,os,pathlib,re,sqlite3,stat,subprocess,sys
PIN=True
TARGET='f50e23735af6e198721830e26e35e26162f09af0'
TREE='6f8cfbdf0e607ccdca59b0cc0c21c5d430ece5f2'
BRANCH='refs/heads/ops/factory-analysis-ai-log-20261022-2'
ROOT=pathlib.Path('/opt/rr-portal')
OUT=ROOT/'deploy/backups/factory-analysis-ai-log-20261022-2'
ARCHIVE=ROOT/'deploy/backups/qms-api-auth-20261021-deploy'
MANIFEST_SHA='4fe3efb9e171a9d93c6d90464a7568c6c5eb56928ba8f9561ab624c207a607b1'
RESULT_SHA='b50d527816a5b3542148eae141fc0ef91d9b7a60f91909aa1a4b12d3835686c7'
SNAPSHOT='factory-review-closed-before/sqlite/auxiliary.db'
LIVE_ROOT=ROOT/'apps/PMC跟仓管/加工厂月度评审管理制度/pb_data'
ROUTE='/api/factory-review/analysis-ai'
START='2026-10-22T00:40:00Z';END='2026-10-22T00:50:00Z'
METHODS=('GET','POST','HEAD','OPTIONS','PUT','PATCH','DELETE')
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

def current():
 ids=run(['docker','ps','-aq','--no-trunc','--filter','label=com.docker.compose.project=rr-portal','--filter','label=com.docker.compose.service=factory-review']).decode().split()
 need(len(ids)==1 and re.fullmatch('[a-f0-9]{64}',ids[0])is not None,'one-fixed-factory-container')
 template='{"id":{{json .Id}},"image":{{json .Image}},"startedAt":{{json .State.StartedAt}},"restartCount":{{json .RestartCount}},"health":{{if .State.Health}}{{json .State.Health.Status}}{{else}}null{{end}},"mounts":{{json .Mounts}}}'
 item=json.loads(run(['docker','inspect','--format',template,ids[0]]));need(item['id']==ids[0]and re.fullmatch('sha256:[a-f0-9]{64}',item['image'])and type(item['restartCount'])is int and item['restartCount']>=0 and item['health']in(None,'healthy','unhealthy','starting'),'safe-runtime-fields')
 iso(item['startedAt']);mounts=[m for m in item.pop('mounts')if m.get('Destination')=='/pb/pb_data']
 need(len(mounts)==1 and mounts[0].get('Type')=='bind'and mounts[0].get('Source')==str(LIVE_ROOT)and LIVE_ROOT.is_dir()and LIVE_ROOT.resolve()==LIVE_ROOT,'fixed-live-log-mount')
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

def logs(path,immutable=False):
 regular(path);uri=path.as_uri()+'?mode=ro'+('&immutable=1'if immutable else'')
 with contextlib.closing(sqlite3.connect(uri,uri=True,timeout=5))as db:
  db.execute('PRAGMA temp_store=MEMORY');db.execute('PRAGMA query_only=ON');need(db.execute('PRAGMA query_only').fetchone()==(1,),'sqlite-query-only');db.execute('BEGIN')
  need({'id','created','level','message','data'}<={r[1]for r in db.execute('PRAGMA table_info(_logs)')},'known-log-schema')
  where="julianday(created)>=julianday(?) AND julianday(created)<julianday(?) AND json_valid(data) AND typeof(json_extract(data,'$.status'))='integer' AND json_extract(data,'$.status') BETWEEN 300 AND 599 AND json_extract(data,'$.method') IN ('GET','POST','HEAD','OPTIONS','PUT','PATCH','DELETE') AND (json_extract(data,'$.url')=? OR json_extract(data,'$.url') LIKE ? ESCAPE '\\')"
  escaped=ROUTE.replace('_','\\_').replace('%','\\%')
  params=(START,END,ROUTE,escaped+'?%');count=db.execute('SELECT count(*) FROM _logs WHERE '+where,params).fetchone()[0]
  sql='SELECT id,created,level,CASE WHEN length(CAST(data AS BLOB))<=? THEN data END,length(CAST(data AS BLOB)) FROM _logs WHERE '+where+' ORDER BY created,id LIMIT 100'
  rows=db.execute(sql,(MAX_DATA,*params)).fetchall();records=[]
  for identity,created,level,data,data_size in rows:
   t=iso(created);need(iso(START)<=t<iso(END),'row-inside-fixed-window')
   row={'logIdSHA256':sha(enc(identity)),'route':ROUTE,'createdUTC':t.isoformat().replace('+00:00','Z'),'createdBeijing':t.astimezone(datetime.timezone(datetime.timedelta(hours=8))).isoformat(),'level':level if type(level)is int and level in(-8,-4,0,4,8,12)else None}
   if data is None:row.update(dataOversize=True,dataBytes=data_size,unclassified=True);records.append(row);continue
   value=json.loads(data);need(type(value)is dict,'request-log-object');need(value['url'].split('?',1)[0]==ROUTE and value['method']in METHODS and type(value['status'])is int and 300<=value['status']<=599,'exact-request-fields')
   parts={k:value[k]for k in('error','details','message')if value.get(k)is not None};error=next(iter(parts.values()))if len(parts)==1 else parts or None;row.update(method=value['method'],status=value['status'],**classify(error))
   duration=value.get('execTime');row['executionMilliseconds']=duration if type(duration)in(int,float)and math.isfinite(duration)and 0<=duration<=600000 else None
   records.append(row)
  need(rows==db.execute(sql,(MAX_DATA,*params)).fetchall(),'selected-log-rows-stable-in-read-transaction')
 return records,{'matchingCount':count,'returnedCount':len(records),'limitedTo100':count>100,'queryOnly':True,'immutable':immutable}

def sealed():
 need(ARCHIVE.is_dir()and not ARCHIVE.is_symlink()and stat.S_IMODE(ARCHIVE.stat().st_mode)==0o700,'fixed-private-deploy-archive')
 manifest_path=ARCHIVE/'manifest.json';result_path=ARCHIVE/'first-result.json';manifest_raw=bounded(manifest_path,16*1024**2);result_raw=bounded(result_path,1024**2)
 need(sha(manifest_raw)==MANIFEST_SHA and sha(result_raw)==RESULT_SHA,'exact-deploy-seals');manifest=json.loads(manifest_raw);result=json.loads(result_raw)
 need(type(manifest)is dict and re.fullmatch('[a-f0-9]{64}',manifest.get(SNAPSHOT,''))and result.get('mode')=='deploy'and result.get('success')is True and result.get('target')==TARGET and result.get('tree')==TREE and enc(result)==result_raw,'bound-canonical-deploy-result')
 path=ARCHIVE/SNAPSHOT;need(digest(path)==manifest[SNAPSHOT],'selected-snapshot-byte-seal');return path,manifest[SNAPSHOT]

def collect():
 global STAGE
 STAGE='source-before';source();STAGE='current-container-before';before=current();STAGE='sealed-archive';snapshot,snapshot_sha=sealed();STAGE='sealed-log-query';history,hcount=logs(snapshot,True);STAGE='live-log-query';live,lcount=logs(LIVE_ROOT/'auxiliary.db');STAGE='deduplicate-safe-records'
 union={}
 for origin,records in(('sealed_pre_cutover',history),('current_live',live)):
  for row in records:
   identity=row['logIdSHA256'];existing=union.get(identity)
   if existing is None:union[identity]=dict(row,sources=[origin])
   else:
    need({k:v for k,v in existing.items()if k!='sources'}==row,'same-log-identity-has-same-safe-fields');existing['sources'].append(origin)
 STAGE='source-after';source();STAGE='current-container-after';need(current()==before,'selected-runtime-unchanged');STAGE='sealed-evidence-after';need(digest(ARCHIVE/SNAPSHOT)==snapshot_sha and digest(ARCHIVE/'manifest.json',16*1024**2)==MANIFEST_SHA and digest(ARCHIVE/'first-result.json',1024**2)==RESULT_SHA,'selected-archive-evidence-unchanged')
 late=iso(before['startedAt'])>=iso(END)
 return {'sanitizedRecords':sorted(union.values(),key=lambda r:(r['createdUTC'],r['logIdSHA256'])),'sourceCounts':{'sealedPreCutover':hcount,'currentLive':lcount},'currentRuntime':before,'currentStartedAt':before['startedAt'],
  'historyCoverageBoundary':'current_container_started_after_requested_window_use_sealed_pre_cutover_and_live_persistent_logs'if late else'current_container_start_not_after_window_persistent_sqlite_is_primary',
  'dockerLogsRead':False,'currentEmptyLogsWouldNotDisproveIncident':late,'selectedArchiveUnchanged':True,'entireArchiveRehashed':False,'logsUnchangedByCollector':True,'sqliteWritesPerformed':False,'selectedRowsStableWithinReadTransaction':True,
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
