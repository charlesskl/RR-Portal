"""PR958 bounded read-only exported PostgreSQL snapshot and source/PDB proof. No live writes."""
import hashlib,importlib.util,json,pathlib,re,select,subprocess,urllib.request,urllib.error
ROOT=pathlib.Path('/opt/rr-portal');SCHEMAS=('indo_shipping',);run=None
PDB_SHA='cf66f655a1e166491c4da67da0824f42ac8cdae3f844044cb5d8f7233ba105c5'
APP_PREFIX='apps/印尼小组/印尼走货明细/'
def need(v,code=None):
 if not v:raise RuntimeError('INDO_958_READONLY_CHECK_FAILED')
def sha(v):return hashlib.sha256(v).hexdigest()
def pg_quote(v):
 need(bool(re.fullmatch('[A-Za-z_][A-Za-z0-9_]{0,62}',v)),'fixedSQLIdentifier')
 return '"'+v+'"'

def pg_table_sql(schema,tables):
 chunks=[]
 for start in range(0,len(tables),20):
  parts=[]
  for name in tables[start:start+20]:
   remove=[]
   expr='to_jsonb(r)' + ''.join("-'"+k+"'" for k in remove)
   h=lambda e:"encode(sha256(convert_to(COALESCE(string_agg(encode(sha256(convert_to("+e+"::text,'UTF8')),'hex'),'' ORDER BY encode(sha256(convert_to("+e+"::text,'UTF8')),'hex')),''),'UTF8')),'hex')"
   parts += ["'"+name+"'","(SELECT jsonb_build_object('rows',count(*),'sha256',"+h('to_jsonb(r)')+",'originalColumnsSHA256',"+h('('+expr+')')+") FROM "+pg_quote(schema)+'.'+pg_quote(name)+' r)']
  chunks.append('jsonb_build_object('+','.join(parts)+')')
 return 'SELECT '+(' || '.join(chunks) or "'{}'::jsonb")+';\n'

def pg_schema_sql(schema):
 return """SELECT jsonb_build_object('columns',COALESCE((SELECT jsonb_agg(jsonb_build_object(
 'table',c.relname,'name',a.attname,'position',a.attnum,'type',format_type(a.atttypid,a.atttypmod),
 'notNull',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid),'identity',a.attidentity,'generated',a.attgenerated,
 'collation',a.attcollation::text) ORDER BY c.relname,a.attnum)
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid
 LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
 WHERE n.nspname='%s' AND c.relkind IN('r','p') AND a.attnum>0 AND NOT a.attisdropped),'[]'::jsonb),
 'constraints',COALESCE((SELECT jsonb_agg(jsonb_build_object('table',c.relname,'name',x.conname,'definition',pg_get_constraintdef(x.oid)) ORDER BY c.relname,x.conname)
 FROM pg_constraint x JOIN pg_class c ON c.oid=x.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='%s'),'[]'::jsonb),
 'sequences',COALESCE((SELECT jsonb_agg(jsonb_build_object('name',s.relname,'owner',s.relowner::regrole::text,'acl',s.relacl::text,
 'persistence',s.relpersistence,'type',q.seqtypid::regtype::text,'start',q.seqstart::text,'increment',q.seqincrement::text,
 'max',q.seqmax::text,'min',q.seqmin::text,'cache',q.seqcache::text,'cycle',q.seqcycle,'ownedByTable',o.relname,'ownedByColumn',a.attname,'dependencyType',d.deptype) ORDER BY s.relname)
 FROM pg_class s JOIN pg_namespace n ON n.oid=s.relnamespace JOIN pg_sequence q ON q.seqrelid=s.oid
 LEFT JOIN pg_depend d ON d.classid='pg_class'::regclass AND d.objid=s.oid AND d.deptype IN('a','i')
 LEFT JOIN pg_class o ON o.oid=d.refobjid LEFT JOIN pg_attribute a ON a.attrelid=d.refobjid AND a.attnum=d.refobjsubid
 WHERE n.nspname='%s' AND s.relkind='S'),'[]'::jsonb),
 'objects',COALESCE((SELECT jsonb_agg(x ORDER BY x::text) FROM (
 SELECT jsonb_build_object('kind','view','name',viewname,'definition',definition) x FROM pg_views WHERE schemaname='%s'
 UNION ALL SELECT jsonb_build_object('kind','function','name',p.oid::regprocedure::text,'definition',pg_get_functiondef(p.oid)) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='%s' AND p.prokind IN('f','p')
 UNION ALL SELECT jsonb_build_object('kind','trigger','name',t.tgname,'definition',pg_get_triggerdef(t.oid)) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='%s' AND NOT t.tgisinternal
 UNION ALL SELECT jsonb_build_object('kind','enum','name',t.typname,'label',e.enumlabel,'sort',e.enumsortorder) FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='%s'
 ) q),'[]'::jsonb),
 'indexes',COALESCE((SELECT jsonb_agg(jsonb_build_object('table',tablename,'name',indexname,'definition',indexdef) ORDER BY tablename,indexname)
 FROM pg_indexes WHERE schemaname='%s'),'[]'::jsonb));\n""" % ((schema,)*8)

def sequence_states(schema,ask):
 # PostgreSQL sequences are NOT MVCC: retain independent bracketing reads,
 # require equality, and never call these an exported-snapshot atomic proof.
 names=json.loads(ask("SELECT COALESCE(json_agg(c.relname ORDER BY c.relname),'[]') FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='"+schema+"' AND c.relkind='S';\n"))
 need(type(names) is list and len(names)<=1000 and len(names)==len(set(names)),'boundedSequenceInventory')
 return {name:json.loads(ask("SELECT jsonb_build_object('lastValue',last_value::text,'called',is_called) FROM "+pg_quote(schema)+'.'+pg_quote(name)+';\n')) for name in names}

def pg_capture(db_id,directory,with_dump):
 cmd=['docker','exec','-i',db_id,'sh','-c','exec psql -X -q -At -v ON_ERROR_STOP=1 -U "${POSTGRES_USER:-rrportal}" -d "${POSTGRES_DB:-rrportal}"']
 result={}
 with (directory/'postgres.stderr.private').open('xb') as errors:
  p=subprocess.Popen(cmd,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=errors,cwd=ROOT,bufsize=0)
  def ask(sql):
   p.stdin.write(sql.encode());p.stdin.flush()
   need(bool(select.select([p.stdout],[],[],180)[0]),'boundedPGSnapshotQuery')
   line=p.stdout.readline(16*1024**2+1)
   need(bool(line) and len(line)<=16*1024**2 and line.endswith(b'\n'),'boundedPGResultLine')
   return line.decode().strip()
  try:
   p.stdin.write(b"BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SET LOCAL statement_timeout='120s';\n");p.stdin.flush()
   snapshot=ask('SELECT pg_export_snapshot();\n');need(bool(re.fullmatch('[0-9A-Fa-f]+-[0-9A-Fa-f]+-[0-9]+',snapshot)),'exportedPGSnapshot')
   for schema in SCHEMAS:
    states=sequence_states(schema,ask)
    names=json.loads(ask("SELECT COALESCE(json_agg(table_name ORDER BY table_name),'[]') FROM information_schema.tables WHERE table_schema='"+schema+"' AND table_type='BASE TABLE';\n"))
    need(1<=len(names)<=200 and len(names)==len(set(names)),'boundedSchemaTables')
    for name in names:pg_quote(name)
    result[schema]={'tables':json.loads(ask(pg_table_sql(schema,names))),'schema':json.loads(ask(pg_schema_sql(schema)))}
    if with_dump:
     out=directory/(schema+'.dump')
     with out.open('xb') as f:
      r=subprocess.run(['docker','exec',db_id,'sh','-c','exec pg_dump -Fc --schema="$1" --snapshot="$2" -U "${POSTGRES_USER:-rrportal}" -d "${POSTGRES_DB:-rrportal}"','pg_dump',schema,snapshot],stdout=f,stderr=errors,timeout=300,cwd=ROOT)
     need(r.returncode==0 and out.stat().st_size>0,'consistentSchemaDump')
     with out.open('rb') as f:
      r=subprocess.run(['docker','exec','-i',db_id,'pg_restore','--list'],stdin=f,stdout=subprocess.DEVNULL,stderr=errors,timeout=180,cwd=ROOT)
     need(r.returncode==0,'dumpArchiveListValid')
    final_states=sequence_states(schema,ask);need(final_states==states,'nonMVCCSequenceStateStableDuringCapture')
    result[schema]['sequenceStates']=states;result[schema]['sequenceStateStableDuringCapture']=True
   p.stdin.write(b'COMMIT;\n');p.stdin.flush();p.stdin.close();need(p.wait(timeout=20)==0,'readOnlyPGSnapshotClosed')
  finally:
   if p.poll() is None:p.kill();p.wait(timeout=10)
   if p.stdout:p.stdout.close()
 return result

def source_documents(revision):
 need(re.fullmatch('[a-f0-9]{40}',revision));rows=run(['git','ls-tree','-r','--name-only','-z',revision,'--',APP_PREFIX+'src/']).decode().strip('\0').split('\0');result={p:{}for p in('IndoShipping.Api','IndoShipping.Domain','IndoShipping.Infrastructure')}
 for name in rows:
  if not name.endswith('.cs'):continue
  need(name.startswith(APP_PREFIX));rel=name[len(APP_PREFIX):];project=rel.split('/')[1];need(project in result and rel not in result[project]);result[project][rel]=sha(run(['git','show',revision+':'+name]))
 need(all(result.values()));return result

def backend_proof(cid,documents):
 p=pathlib.Path(__file__).with_name('indo-pdb-library.py');need(p.is_file()and not p.is_symlink()and sha(p.read_bytes())==PDB_SHA);s=importlib.util.spec_from_file_location('indo958_pdb_proof',p);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);result={}
 need(set(documents)=={'IndoShipping.Api','IndoShipping.Domain','IndoShipping.Infrastructure'})
 for project,expected in documents.items():
  blobs=[]
  for ext in('.dll','.pdb'):
   path='/app/'+project+ext;size=int(run(['docker','exec',cid,'stat','-c','%s',path]));need(0<size<=32*1024**2);raw=run(['docker','exec',cid,'cat',path]);need(len(raw)==size);blobs.append(raw)
  result[project]=m.prove(*blobs,expected)
 return result

class NoRedirect(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,*args,**kwargs):return None
HTTP=urllib.request.build_opener(urllib.request.ProxyHandler({}),NoRedirect())
def get(path):
 # Only static assets, health, and unauthenticated denied routes. Never schedules/material APIs.
 need(path in {'/','/api/health','/api/users/me','/api/users'}or bool(re.fullmatch('/assets/[A-Za-z0-9_.-]+\\.(js|css)',path)))
 try:
  with HTTP.open('http://127.0.0.1/indo-shipping'+path,timeout=20)as r:body=r.read(32*1024**2+1);need(len(body)<=32*1024**2);return r.status,body
 except urllib.error.HTTPError as e:return e.code,b''

def frontend_proof(cid,expected=None):
 paths=run(['docker','exec',cid,'find','/app/wwwroot/assets','-maxdepth','1','-type','f']).decode().splitlines();need(0<len(paths)<=128 and len(paths)==len(set(paths)));names=['index.html']
 for path in paths:
  if not path.endswith(('.js','.css')):continue
  need(re.fullmatch('/app/wwwroot/assets/[A-Za-z0-9_.-]+\\.(js|css)',path));names.append(path[len('/app/wwwroot/'):])
 result={}
 for name in sorted(names):
  content=run(['docker','exec',cid,'cat','/app/wwwroot/'+name]);need(0<len(content)<=32*1024**2);status,body=get('/'if name=='index.html'else'/'+name);need(status==200 and body==content);result[name]=sha(content)
  if name=='index.html':html=content.decode()
 referenced=re.findall(r'(?:src|href)="/indo-shipping/(assets/[A-Za-z0-9_.-]+\.(?:js|css))"',html);need(referenced and all(n in result for n in referenced)and any(n.endswith('.js')for n in result))
 if expected is not None:need(result==expected)
 need(get('/api/health')[0]==200)
 # Do not invoke authenticated application endpoints; controller authorization rejects these probes.
 for path in('/api/users/me','/api/users'):need(get(path)[0]==401)
 return result

def startup_guard(cid,dbid):
 cmd=['docker','exec','-i',dbid,'sh','-c','exec psql -X -q -At -v ON_ERROR_STOP=1 -U "${POSTGRES_USER:-rrportal}" -d "${POSTGRES_DB:-rrportal}"']
 tables=json.loads(run(cmd,b"BEGIN READ ONLY; SELECT COALESCE(json_agg(table_name ORDER BY table_name),'[]') FROM information_schema.tables WHERE table_schema='indo_shipping' AND table_type='BASE TABLE'; COMMIT;\n"));required={'Users','settings','schedules','material_tracking_history','purchase_orders','po_items','po_receipts','outbound','shipments','shipment_items','images','materials','dict_supplier','dict_translation','tool_materials','__rr_seed_history'};need(required<=set(tables))
 disabled='$2a$11$m559Cb68j1R4cHfTHJ5tV.z3oeYQyjPGL/mIlkhdltC70AnKNsLyi'
 legacy='''NOT EXISTS (SELECT 1 FROM indo_shipping.users old LEFT JOIN indo_shipping."Users" current ON current."Username"=old.username WHERE current."Id" IS NULL OR current."PasswordHash"='%s')'''%disabled if'users'in tables else'TRUE'
 query='''BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SET LOCAL statement_timeout='30s';
 SELECT jsonb_build_object(
 'adminAlreadyConfigured',EXISTS(SELECT 1 FROM indo_shipping."Users" WHERE "Username"='admin' AND "PasswordHash"<>'%s'),
 'legacyAccountsAlreadyMigrated',%s,
 'oneTimeMigrationsApplied',(SELECT COUNT(*)=3 FROM indo_shipping.settings WHERE key IN ('data_migration:2026-08-13-replace-hs-dictionary-v1','data_migration:2026-08-15-backfill-translations-v1','data_migration:2026-09-05-backfill-supplier-dictionary-v1')AND value='applied'),
 'toolMigrationApplied',EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='indo_shipping.tool_materials'::regclass AND conname='tool_materials_kind_v2_check'),
 'supplierProfilesAlreadyFilled',NOT EXISTS(SELECT 1 FROM indo_shipping.dict_supplier WHERE trim(COALESCE(customs_company,''))=''AND COALESCE(NULLIF(trim(full_name),''),trim(keyword))<>''),
 'purchasePrecisionAlreadyApplied',EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='indo_shipping'AND table_name='po_items'AND column_name='price'AND data_type='numeric'AND numeric_precision=22 AND numeric_scale=8),
 'purchaseMergeColumnsPresent',(SELECT count(*)=8 FROM information_schema.columns WHERE table_schema='indo_shipping'AND((table_name='purchase_orders'AND column_name IN('merged_into_id','merge_revision'))OR(table_name='po_items'AND column_name IN('source_po_no','source_order_date','source_delivery_date','delivery_date_override','has_delivery_date_override'))OR(table_name='po_receipts'AND column_name='spare_qty'))),
 'scheduleHistoryAlreadyCaptured',NOT EXISTS(SELECT 1 FROM indo_shipping.schedules s LEFT JOIN LATERAL(SELECT rows_hash,acknowledged FROM indo_shipping.material_tracking_history WHERE schedule_id=s.id ORDER BY id DESC LIMIT 1)h ON TRUE WHERE h.rows_hash IS NULL OR h.rows_hash<>md5(COALESCE(s.raw_rows::text,'[]'))OR(NOT h.acknowledged AND EXISTS(SELECT 1 FROM indo_shipping.settings completed WHERE completed.key='material_tracking_completed_schedules'AND completed.value::jsonb->>s.id::text=h.rows_hash)))); COMMIT;'''%(disabled,legacy)
 checks=json.loads(run(cmd,query.encode(),45));need(type(checks)is dict and all(type(v)is bool for v in checks.values()))
 # Build never copies business-data.json; refuse any runtime override or preexisting unexpected payload.
 raw=run(['docker','exec',cid,'sh','-c','if [ -e /app/seed/business-data.json ]; then echo present; else echo absent; fi']).decode().strip();need(raw=='absent');checks['businessSeedAbsent']=True
 return checks
