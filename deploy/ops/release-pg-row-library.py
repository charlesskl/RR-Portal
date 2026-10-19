"""Fixed PostgreSQL row diagnostics. No restore, SQL writes, or raw business output."""
import base64,datetime,hashlib,json,os,pathlib,re,select,signal,stat,subprocess,sys,time
ROOT=pathlib.Path('/opt/rr-portal')
BACKUP=ROOT/'deploy/backups/release-937-943-944-945-946-950-20261019-v2'
VERIFY=BACKUP.with_name(BACKUP.name+'-verify-v3')
PINS=((BACKUP,'22483bb8f1a2e799ad6bcd14f48c2b60c2913d74ad9a03207c39c8b6f761f93f','16dd085003188dbc56150bac9dfedcd3cd5ae9207732f1b96ed357c5a097458f'),(VERIFY,'864dfeed7692d7be7ac2c69aaf258f011799fc04a912f0b03cae91a8cd5fb6de','0491d4bed4f47764a1ef7600f45dab63c548b48912a16ff897a6e2251f6dccec'))
BASE='52c090589d6da542fee74ef17c8edd3b0dfe4fe6';TARGET='85d2082c273d3df3e51b2e414855634c56c498dd'
PIN_FROZEN=False
TABLES={'indo_shipping':('audit_logs','materials','products','purchase_orders','po_items'),'internal_quote':('audit_log','quote_sections')}
WINDOW_START='2026-10-19T07:45:00+00:00';WINDOW_END='2026-10-19T09:01:59.999999+00:00'
PG_SHELL='exec psql -X -q -At -v ON_ERROR_STOP=1 -U "${POSTGRES_USER:-rrportal}" -d "${POSTGRES_DB:-rrportal}"'
STAGE='entrypoint';DEADLINE=None
MAX_DUMP=128*1024**2;MAX_COPY=192*1024**2;MAX_ROWS=20000;MAX_LINE=16*1024**2
ACTIONS={'create','update','delete','merge','change_delivery_date','cancel','restore','import','view','login','logout','translate_vq','save','submit','approve','reject','mixed_config','mixed_product_delete_backup','publish_material_prices','other'}
PAYLOAD_KEYS={'header','material_prices','machine_prices','materials','parts','molds','molding_rows','electronics_extra','mixed_quote','mixed_products','mixed_shared','mixed_part_selections','mixed_imported_parts','parts_catalog','legacy_import','excel_native','groups','tax_label','rows','workshop_assignment'}

def need(v):
 if not v:raise RuntimeError('PG_ROW_DIAGNOSTIC_REJECTED')
def enc(v):return json.dumps(v,sort_keys=True,ensure_ascii=True,separators=(',',':'),allow_nan=False).encode()
def sha(v):return hashlib.sha256(v).hexdigest()
def pairs(items):
 result={}
 for k,v in items:need(k not in result);result[k]=v
 return result
def parsed(raw):return json.loads(raw,object_pairs_hook=pairs)
def remaining(maximum=60):
 left=(DEADLINE-time.monotonic())if DEADLINE is not None else maximum
 need(left>0);return min(maximum,left)
def identifier(value):
 need(type(value)is str and re.fullmatch('[A-Za-z_][A-Za-z0-9_]{0,62}',value));return '"'+value+'"'
def stable_read(path,maximum):
 need(not path.is_symlink())
 with os.fdopen(os.open(path,os.O_RDONLY|os.O_NOFOLLOW),'rb')as f:
  a=os.fstat(f.fileno());need(stat.S_ISREG(a.st_mode)and a.st_mode&0o077==0 and a.st_size<=maximum)
  raw=f.read(maximum+1);b=os.fstat(f.fileno())
  fields=lambda s:(s.st_dev,s.st_ino,s.st_size,s.st_mtime_ns,s.st_ctime_ns,s.st_mode)
  need(len(raw)==a.st_size and fields(a)==fields(b)==fields(path.lstat()))
 return raw
def capture(path,msha,rsha):
 need(path.is_dir()and not path.is_symlink()and stat.S_IMODE(path.stat().st_mode)==0o700)
 raw=stable_read(path/'manifest.json',4*1024**2);need(sha(raw)==msha);manifest=parsed(raw);need(manifest.get('first-result.json')==rsha)
 raw=stable_read(path/'first-result.json',1024**2);need(sha(raw)==rsha);receipt=parsed(raw)
 raw=stable_read(path/'baseline.private.json',32*1024**2);need(sha(raw)==manifest.get('baseline.private.json'));snapshot=parsed(raw)
 return snapshot,receipt,manifest
def stamps(s):return(s.st_dev,s.st_ino,s.st_size,s.st_mtime_ns,s.st_ctime_ns,s.st_mode)
def restore_copy(path,expected,cid,schema,tables):
 """Hash and feed the same nofollow descriptor; only pg_restore --file=-, never --dbname."""
 need(not path.is_symlink())
 with os.fdopen(os.open(path,os.O_RDONLY|os.O_NOFOLLOW),'rb')as source:
  a=os.fstat(source.fileno());need(stat.S_ISREG(a.st_mode)and a.st_mode&0o077==0 and 0<a.st_size<=MAX_DUMP)
  digest=hashlib.sha256()
  for block in iter(lambda:source.read(1024**2),b''):remaining();digest.update(block)
  need(digest.hexdigest()==expected and stamps(a)==stamps(os.fstat(source.fileno()))==stamps(path.lstat()));source.seek(0)
  output=command(['docker','exec','-i',cid,'pg_restore','--data-only','--schema='+schema,'--strict-names',*['--table='+t for t in tables],'--file=-'],stdin=source,timeout=90)
  need(stamps(a)==stamps(os.fstat(source.fileno()))==stamps(path.lstat()));return output
def command(args,stdin=None,limit=MAX_COPY,timeout=90):
 """Bound stdout while reading; no subprocess output or exception text is printed."""
 end=time.monotonic()+remaining(timeout);p=subprocess.Popen(args,stdin=stdin,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,cwd=ROOT,bufsize=0)
 chunks=[];count=0
 try:
  while True:
   need(time.monotonic()<end);ready=select.select([p.stdout],[],[],min(1,max(.001,end-time.monotonic())))[0]
   if not ready:continue
   block=os.read(p.stdout.fileno(),65536)
   if not block:break
   count+=len(block);need(count<=limit);chunks.append(block)
  need(p.wait(timeout=remaining(10))==0);return b''.join(chunks)
 finally:
  if p.poll()is None:p.kill();p.wait(timeout=5)
  p.stdout.close()
def copy_text(token):
 if token==b'\\N':return None
 out=bytearray();i=0;esc={ord(k):ord(v)for k,v in [('b','\b'),('f','\f'),('n','\n'),('r','\r'),('t','\t'),('v','\v'),('\\','\\')]}
 while i<len(token):
  c=token[i];i+=1
  if c!=92:out.append(c);continue
  need(i<len(token));c=token[i];i+=1
  if c in esc:out.append(esc[c])
  elif 48<=c<=55:
   digits=bytes([c])
   while i<len(token)and len(digits)<3 and 48<=token[i]<=55:digits+=bytes([token[i]]);i+=1
   need(int(digits,8)<=255);out.append(int(digits,8))
  elif c==120:
   digits=b''
   while i<len(token)and len(digits)<2 and token[i]in b'0123456789abcdefABCDEF':digits+=bytes([token[i]]);i+=1
   need(digits);out.append(int(digits,16))
  else:out.append(c)
 need(0 not in out);return out.decode('utf-8')
def copy_blocks(data,schema):
 need(schema in TABLES and len(data)<=MAX_COPY);blocks={};active=None
 for line in data.split(b'\n'):
  need(len(line)<=MAX_LINE)
  if active is not None:
   if line==b'\\.':active=None;continue
   fields=line.split(b'\t');need(len(fields)==len(blocks[active]['columns']))
   blocks[active]['rows'].append([copy_text(v)for v in fields]);need(len(blocks[active]['rows'])<=MAX_ROWS)
  elif line.startswith(b'COPY '):
   match=re.fullmatch(rb'COPY ([A-Za-z_][A-Za-z0-9_]*)\.(?:"([A-Za-z_][A-Za-z0-9_]*)"|([A-Za-z_][A-Za-z0-9_]*)) \(([^\r\n]+)\) FROM stdin;',line)
   need(match is not None and match[1].decode()==schema);name=(match[2]or match[3]).decode();need(name in TABLES[schema]and name not in blocks)
   columns=[]
   for token in match[4].split(b', '):
    part=re.fullmatch(rb'(?:"([A-Za-z_][A-Za-z0-9_]*)"|([A-Za-z_][A-Za-z0-9_]*))',token);need(part is not None);columns.append((part[1]or part[2]).decode())
   need(columns and len(columns)==len(set(columns))and len(columns)<=150);blocks[name]={'columns':columns,'rows':[]};active=name
 need(active is None and set(blocks)==set(TABLES[schema]))
 for name,block in blocks.items():
  key='code'if name=='products'else'id';need(key in block['columns']);idx=block['columns'].index(key);values=[r[idx]for r in block['rows']]
  need(all(type(v)is str and bool(v)for v in values)and len(set(values))==len(values))
  if key=='id':need(all(re.fullmatch('[1-9][0-9]{0,18}',v)and int(v)<=9223372036854775807 for v in values))
 return blocks
def column_type(value):
 need(type(value)is str and bool(re.fullmatch(r'(?:smallint|integer|bigint|text|boolean|json|jsonb|date|numeric(?:\([1-9][0-9]{0,3},[0-9]{1,4}\))?|(?:character varying|character)\([1-9][0-9]{0,6}\)|timestamp(?:\([0-6]\))? (?:with|without) time zone)',value)))
 return value
def table_columns(snapshot,schema,table):
 rows=[r for r in snapshot['postgres'][schema]['schema']['columns']if r['table']==table];rows.sort(key=lambda r:r['position'])
 need(0<len(rows)<=150 and len({r['name']for r in rows})==len(rows))
 for r in rows:identifier(r['name']);column_type(r['type'])
 return rows
def validate_current_columns(session,schema,table,columns):
 relation=identifier(schema)+'.'+identifier(table)
 metadata=session.ask("SELECT COALESCE(jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod)) ORDER BY a.attnum),'[]') FROM pg_attribute a WHERE a.attrelid='"+relation+"'::regclass AND a.attnum>0 AND NOT a.attisdropped;\n")
 need(type(metadata)is list and len(metadata)<=150);by_name={r['name']:r['type']for r in metadata};need(len(by_name)==len(metadata)and all(by_name.get(c['name'])==c['type']for c in columns))
def old_cte(block,columns,alias='old'):
 need(block['columns']==[r['name']for r in columns]);rows=[dict(zip(block['columns'],row))for row in block['rows']]
 encoded=base64.b64encode(enc(rows)).decode();need(len(encoded)<=256*1024**2)
 definitions=','.join(identifier(r['name'])+' text'for r in columns)
 cast=','.join('x.'+identifier(r['name'])+'::'+column_type(r['type'])+' AS '+identifier(r['name'])for r in columns)
 return alias+" AS MATERIALIZED (SELECT "+cast+" FROM jsonb_to_recordset(convert_from(decode('"+encoded+"','base64'),'UTF8')::jsonb) AS x("+definitions+"))"
def row_hash(alias):return "encode(sha256(convert_to(to_jsonb("+alias+")::text,'UTF8')),'hex')"
def aggregate(alias):return "(SELECT jsonb_build_object('rows',count(*),'sha256',encode(sha256(convert_to(COALESCE(string_agg(h,'' ORDER BY h),''),'UTF8')),'hex')) FROM (SELECT "+row_hash('z')+' h FROM '+alias+' z) h)'
def action_case(expr):return 'CASE WHEN '+expr+' IN ('+','.join("'"+v+"'"for v in sorted(ACTIONS))+") THEN "+expr+" ELSE 'other' END"
def window(expr,kind):
 stamp=expr+" AT TIME ZONE 'UTC'"if kind.endswith('without time zone')else expr
 return '('+stamp+") BETWEEN '"+WINDOW_START+"'::timestamptz AND '"+WINDOW_END+"'::timestamptz"
def audit_sql(schema,table,columns):
 col={r['name']:r['type']for r in columns};indo=schema=='indo_shipping';stamp='occurred_at'if indo else'at';who='username'if indo else'actor'
 account=('EXISTS (SELECT 1 FROM indo_shipping."Users" u WHERE u."Id"=a.user_id AND u."Username"=a.username AND u."IsActive")'if indo else'(SELECT count(*)=1 FROM internal_quote.users u WHERE u.username=a.actor OR u.display_name=a.actor)')
 inside=window('a.'+identifier(stamp),col[stamp]);action=action_case('a.action')
 return ",(SELECT COALESCE(jsonb_agg(jsonb_build_object('action',action,'rows',n,'existingAccountMatches',account_match,'inConfirmedWindow',in_window) ORDER BY action,account_match,in_window),'[]') FROM (SELECT "+action+' action,'+account+' account_match,COALESCE('+inside+",false) in_window,count(*) n FROM cur a WHERE NOT EXISTS(SELECT 1 FROM old o WHERE o.id=a.id) GROUP BY 1,2,3) stats) AS audit_summary"
def query(schema,table,block,columns):
 need(schema in TABLES and table in TABLES[schema]);key='code'if table=='products'else'id';names=[r['name']for r in columns];need(key in names)
 qualified=identifier(schema)+'.'+identifier(table);projection=','.join(identifier(n)for n in names)
 cte=old_cte(block,columns)+',cur AS MATERIALIZED (SELECT '+projection+' FROM '+qualified+')'
 cte+=',d AS MATERIALIZED (SELECT to_jsonb(o) oldrow,to_jsonb(c) newrow FROM old o FULL JOIN cur c ON o.'+identifier(key)+'=c.'+identifier(key)+')'
 fields="(SELECT COALESCE(jsonb_object_agg(k,n),'{}') FROM (SELECT f.k,count(*) n FROM d CROSS JOIN LATERAL jsonb_object_keys(d.oldrow) f(k) WHERE oldrow IS NOT NULL AND newrow IS NOT NULL AND oldrow->f.k IS DISTINCT FROM newrow->f.k GROUP BY f.k) q)"
 sql='WITH '+cte+' SELECT jsonb_build_object(\'baseline\','+aggregate('old')+",'current',"+aggregate('cur')+",'addedRows',(SELECT count(*) FROM d WHERE oldrow IS NULL),'removedRows',(SELECT count(*) FROM d WHERE newrow IS NULL),'changedRows',(SELECT count(*) FROM d WHERE oldrow IS NOT NULL AND newrow IS NOT NULL AND oldrow IS DISTINCT FROM newrow),'changedFields',"+fields
 if table in {'audit_log','audit_logs'}:
  tail=audit_sql(schema,table,columns);sql+=",'newAuditActions',"+tail.split(' AS audit_summary')[0][1:]
 if table=='quote_sections':
  sql+=",'payload',"+payload_sql()
 sql+=');\n';return sql
def payload_sql():
 good="pg_input_is_valid(oldrow->>'payload_json','jsonb') AND pg_input_is_valid(newrow->>'payload_json','jsonb')"
 keys=','.join("'"+v+"'"for v in sorted(PAYLOAD_KEYS))
 return "(WITH changed AS (SELECT * FROM d WHERE oldrow IS NOT NULL AND newrow IS NOT NULL AND oldrow->'payload_json' IS DISTINCT FROM newrow->'payload_json'), valid AS (SELECT CASE WHEN "+good+" THEN (oldrow->>'payload_json')::jsonb ELSE NULL END a,CASE WHEN "+good+" THEN (newrow->>'payload_json')::jsonb ELSE NULL END b FROM changed), object_rows AS(SELECT * FROM valid WHERE jsonb_typeof(a)='object' AND jsonb_typeof(b)='object'), names AS (SELECT k,count(*) n FROM object_rows CROSS JOIN LATERAL (SELECT jsonb_object_keys(a) k UNION SELECT jsonb_object_keys(b)) x WHERE a->k IS DISTINCT FROM b->k GROUP BY k) SELECT jsonb_build_object('textChangedRows',(SELECT count(*) FROM changed),'validPairRows',(SELECT count(*) FROM valid WHERE a IS NOT NULL AND b IS NOT NULL),'semanticEqualRows',(SELECT count(*) FROM valid WHERE a=b),'knownTopLevelChangedKeys',COALESCE((SELECT jsonb_object_agg(k,n) FROM names WHERE k IN ("+keys+")),'{}'),'otherTopLevelChangedKeyCount',(SELECT count(*) FROM names WHERE k NOT IN ("+keys+")),'changedRowsFilledAtInConfirmedWindow',(SELECT count(*) FROM changed WHERE "+window("(newrow->>'filled_at')::timestamptz",'timestamp with time zone')+")))"

class Session:
 def __init__(self,cid):
  self.p=subprocess.Popen(['docker','exec','-i',cid,'sh','-c',PG_SHELL],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,cwd=ROOT,bufsize=0)
 def ask(self,sql):
  data=sql.encode();need(len(data)<=256*1024**2);view=memoryview(data)
  while view:
   remaining();sent=os.write(self.p.stdin.fileno(),view);need(sent>0);view=view[sent:]
  self.p.stdin.flush();end=time.monotonic()+remaining(30);out=bytearray()
  while True:
   need(time.monotonic()<end)
   if not select.select([self.p.stdout],[],[],min(1,max(.001,end-time.monotonic())))[0]:continue
   b=os.read(self.p.stdout.fileno(),65536);need(b);out.extend(b);need(len(out)<=1024**2)
   if b'\n'in out:
    need(out.endswith(b'\n')and out.count(b'\n')==1);return parsed(out)
 def close(self):
  if self.p.poll()is None:
   try:self.p.stdin.close();self.p.wait(timeout=3)
   except Exception:self.p.kill();self.p.wait(timeout=5)
  for stream in (self.p.stdin,self.p.stdout):
   if stream and not stream.closed:stream.close()

def safe_result(raw,columns,old_expected,verified):
 need(type(raw)is dict and raw['baseline']=={'rows':old_expected['rows'],'sha256':old_expected['originalColumnsSHA256']})
 ints=('addedRows','removedRows','changedRows')
 need(all(type(raw[k])is int and 0<=raw[k]<=MAX_ROWS for k in ints))
 fields=raw['changedFields'];need(type(fields)is dict and set(fields)<={r['name']for r in columns}and all(type(v)is int and 0<v<=MAX_ROWS for v in fields.values()))
 current=raw['current'];need(type(current)is dict and type(current['rows'])is int and 0<=current['rows']<=MAX_ROWS and re.fullmatch('[a-f0-9]{64}',current['sha256']))
 result={k:raw[k]for k in ints};result['changedFields']=fields;result['baselineTypedAggregateExactlyVerified']=True;result['baselineRows']=raw['baseline']['rows'];result['currentRows']=current['rows']
 result['currentAggregateMatchesSealedVerification']=current=={'rows':verified['rows'],'sha256':verified['originalColumnsSHA256']}
 if 'newAuditActions'in raw:
  values=raw['newAuditActions'];need(type(values)is list and len(values)<=4*len(ACTIONS))
  for r in values:need(type(r)is dict and set(r)=={'action','rows','existingAccountMatches','inConfirmedWindow'}and r['action']in ACTIONS and type(r['rows'])is int and 0<r['rows']<=MAX_ROWS and type(r['existingAccountMatches'])is bool and type(r['inConfirmedWindow'])is bool)
  need(sum(r['rows']for r in values)==raw['addedRows']);result['newAuditActions']=values
 if 'payload'in raw:
  v=raw['payload'];need(set(v)=={'textChangedRows','validPairRows','semanticEqualRows','knownTopLevelChangedKeys','otherTopLevelChangedKeyCount','changedRowsFilledAtInConfirmedWindow'})
  need(all(type(v[k])is int and 0<=v[k]<=MAX_ROWS for k in set(v)-{'knownTopLevelChangedKeys'}));need(type(v['knownTopLevelChangedKeys'])is dict and set(v['knownTopLevelChangedKeys'])<=PAYLOAD_KEYS and all(type(n)is int and 0<n<=MAX_ROWS for n in v['knownTopLevelChangedKeys'].values()));result['payload']=v
 return result
def emit(value):
 raw=enc(value);need(len(raw)<=256*1024);print(raw.decode(),flush=True)
def main():
 global STAGE,DEADLINE
 need(PIN_FROZEN and os.environ.get('RELEASE_REF')=='refs/heads/ops/release-progress-v4-20261019'and os.environ.get('RELEASE_ATTEMPT')=='1'and os.environ.get('RELEASE_MODE')=='pg-rows')
 DEADLINE=time.monotonic()+300
 def stop(*_):need(False)
 signal.signal(signal.SIGALRM,stop);signal.signal(signal.SIGTERM,stop);signal.alarm(305)
 STAGE='authenticate-sealed-inputs';before,rb,manifest=capture(*PINS[0]);verify,rv,_=capture(*PINS[1]);need(before['head']==BASE and verify['head']==TARGET and rb.get('success')is True and rv.get('success')is False)
 need(rv.get('checks',{}).get('allPostgresOriginalColumnsAndAllowedSchemaPassed')is False)
 cid=before['runtime']['services']['db']['id'];need(re.fullmatch('[a-f0-9]{64}',cid))
 session=None;reports=[]
 try:
  for schema,tables in TABLES.items():
   STAGE='read-sealed-'+schema+'-dump';output=restore_copy(BACKUP/(schema+'.dump'),manifest.get(schema+'.dump'),cid,schema,tables)
   blocks=copy_blocks(output,schema);del output
   if session is None:
    session=Session(cid);setup=session.ask("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SET LOCAL statement_timeout='20s'; SET LOCAL lock_timeout='2s'; SET LOCAL TimeZone='UTC'; SET LOCAL DateStyle='ISO, YMD'; SELECT jsonb_build_object('readOnly',current_setting('transaction_read_only'),'timezone',current_setting('TimeZone'));\n");need(setup=={'readOnly':'on','timezone':'UTC'})
   account_table='Users'if schema=='indo_shipping'else'users';account_names={'Id','Username','IsActive'}if schema=='indo_shipping'else{'username','display_name'}
   account_columns=[r for r in table_columns(before,schema,account_table)if r['name']in account_names];need({r['name']for r in account_columns}==account_names);validate_current_columns(session,schema,account_table,account_columns)
   for table in tables:
    STAGE='compare-'+schema+'-'+table;columns=table_columns(before,schema,table)
    validate_current_columns(session,schema,table,columns)
    raw=session.ask(query(schema,table,blocks[table],columns));report=safe_result(raw,columns,before['postgres'][schema]['tables'][table],verify['postgres'][schema]['tables'][table]);report.update(schema=schema,table=table);reports.append(report);emit(dict(kind='postgres-row-difference',**report))
   del blocks
  STAGE='close-readonly-snapshot';closed=session.ask('COMMIT; SELECT to_jsonb(true);\n');need(closed is True);session.close();session=None
  STAGE='revalidate-input-pins'
  for path,msha,rsha in PINS:need(sha(stable_read(path/'manifest.json',4*1024**2))==msha and sha(stable_read(path/'first-result.json',1024**2))==rsha)
  emit({'kind':'summary','completed':True,'tableCount':len(reports),'allCurrentSelectedTablesStillMatchSealedVerification':all(r['currentAggregateMatchesSealedVerification']for r in reports),'businessWritesPerformed':False,'restoreExecuted':False,'temporaryTablesCreated':False,'businessOrIdentityValuesPrinted':False,'causeOrActorProven':False,'originalStrictVerificationRemainsFailed':True,'onlySelectedManifestReceiptBaselineAndDumpBytesVerified':True,'wholeArchiveBytesRevalidated':False,'currentRowsReadInOneRepeatableReadOnlyTransaction':True})
 finally:
  if session is not None:session.close()
if __name__=='__main__':
 try:main()
 except BaseException:emit({'completed':False,'safeFailure':'PG_ROW_DIAGNOSTIC_FAILED','stage':STAGE});sys.exit(1)
