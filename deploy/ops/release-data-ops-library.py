"""Fixed batch private backups and strict data comparison. Draft; no deployment or CRUD."""
import contextlib, hashlib, importlib.util, json, os, pathlib, re, select, shutil, signal, sqlite3, stat, subprocess, sys, time, urllib.parse
ROOT=pathlib.Path('/opt/rr-portal')
BASE='52c090589d6da542fee74ef17c8edd3b0dfe4fe6'
BRANCH='refs/heads/ops/release-937-943-944-945-946-950-20261019'
BACKUP=ROOT/'deploy/backups/release-937-943-944-945-946-950-20261019-v2'
VERIFY=BACKUP.with_name(BACKUP.name+'-verify')
BACKUP_PIN_FROZEN=True
VERIFY_PIN_FROZEN=False
TARGET=''
BACKUP_MANIFEST_SHA256=''
LIBRARY_SHA256='d63168fd3057f4f2aba2d93f9fab31d2d65c6dd0f3234877d71fcff1e04e62b9'
SCHEMAS=('indo_shipping','internal_quote')
TARGETS={'qc','indo-shipping','internal-quote','factory-review','factory-review-test','qc-report','qc-report-worker'}
PROTECTED={'printlink','voyageplex-api','voyageplex-parser','voyageplex-web'}
PREFIXES={
 'qc':('apps/生产部/品质管理系统/data','qc','/app/data'),
 'factory-review':('apps/PMC跟仓管/加工厂月度评审管理制度/pb_data','factory-review','/pb/pb_data'),
 'factory-review-test':('apps/PMC跟仓管/加工厂月度评审管理制度/pb_data_test','factory-review-test','/pb/pb_data'),
 'qc-report-data':('apps/QA部/QC成品报告系统/data','qc-report','/app/data'),
 'qc-report-storage':('apps/QA部/QC成品报告系统/storage','qc-report','/app/storage'),
 'quote-legacy':('apps/业务部/内部报价系统/backend/data','internal-quote','/app/backend/legacy-data'),
 'quote-uploads':('apps/业务部/内部报价系统/backend/uploads','internal-quote','/app/backend/uploads'),
}
QC_COMPANIES={'dg-xingxin','dg-huadeng-a','dg-huadeng-b','dg-huajia','hy-huakang-a','hy-huakang-b','hy-huakang-c','hy-huakang-d','hy-huadeng','hy-huaxing','sy-huadeng','sy-xingxin','xs-huadeng'}
NEW_COLUMNS={'purchase_orders':{'merged_into_id':('integer',False,None),'merge_revision':('integer',True,'0')},
 'po_items':{'source_po_no':('text',False,None),'source_order_date':('date',False,None),'source_delivery_date':('date',False,None),'delivery_date_override':('date',False,None),'has_delivery_date_override':('boolean',True,'false')}}
L=None
STAGE='entrypoint'

def need(value,code):
 global STAGE
 STAGE=code
 if not value:raise RuntimeError('BATCH_RELEASE_CHECK_FAILED')

def enc(v):return json.dumps(v,sort_keys=True,ensure_ascii=True,separators=(',',':'),allow_nan=False).encode()
def digest(v):return hashlib.sha256(enc(v)).hexdigest()
def load_library(path):
 need(path.is_file() and not path.is_symlink() and hashlib.sha256(path.read_bytes()).hexdigest()==LIBRARY_SHA256,'reviewedLibraryBytes')
 spec=importlib.util.spec_from_file_location('release_reviewed_sqlite',path);lib=importlib.util.module_from_spec(spec);spec.loader.exec_module(lib)
 lib.databases=database_names
 return lib

def run(args,data=None,timeout=180):
 p=subprocess.run(args,input=data,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=timeout,cwd=ROOT)
 need(p.returncode==0 and len(p.stdout)<=32*1024**2,'boundedPrivateCommand')
 return p.stdout

def database_names(tree):
 names=[]
 for p in sorted(tree.rglob('*')):
  need(not p.is_symlink() and (p.is_dir() or p.is_file()),'regularFixedTree')
  if not p.is_file():continue
  with p.open('rb') as f:head=f.read(16)
  if head==b'SQLite format 3\0':names.append(str(p.relative_to(tree)))
  else:need(p.suffix.lower() not in {'.db','.sqlite','.sqlite3'},'noUnrecognizedDatabaseExtension')
  need(len(names)<=10000,'boundedDatabaseCount')
 return names

def storage_configuration(records):
 rows={}
 for v in records:
  labels=v.get('Config',{}).get('Labels',{}) or {};name=labels.get('com.docker.compose.service')
  if labels.get('com.docker.compose.project')!='rr-portal' or name not in TARGETS|{'db'}:continue
  values=v['Config'].get('Env',[]);need(all(type(x) is str and '=' in x for x in values),'runtimeEnvironmentShape')
  env=dict(x.split('=',1) for x in values);need(len(env)==len(values),'uniqueRuntimeEnvironment')
  need(name not in rows,'uniqueStorageService');rows[name]=(v,env)
 need(TARGETS|{'db'}<=set(rows),'completeStorageServices')
 db=rows['db'][1];database=db.get('POSTGRES_DB') or 'rrportal';user=db.get('POSTGRES_USER') or 'rrportal'
 need(rows['qc'][1].get('DATA_PATH')=='/app/data','actualQcDatabaseRoot')
 quote=rows['internal-quote'][1];url=urllib.parse.urlsplit(quote.get('DATABASE_URL',''))
 need(quote.get('DB_DRIVER')!='sqlite' and (quote.get('DB_SCHEMA') or 'internal_quote')=='internal_quote' and
  url.scheme in {'postgres','postgresql'} and url.hostname=='db' and (url.port or 5432)==5432 and
  urllib.parse.unquote(url.path)=='/'+database and urllib.parse.unquote(url.username or '')==user and
  not url.query and not url.fragment and quote.get('LEGACY_SQLITE_FILE')=='/app/backend/legacy-data/data.db','actualQuotePostgresAndLegacyRoots')
 indo=rows['indo-shipping'][1]
 need(indo.get('DB_PASSWORD') is not None and bool(indo.get('INDO_SHIPPING_JWT_KEY_B64')) and
  (indo.get('DB_NAME') or 'rrportal')==database and (indo.get('DB_USER') or 'rrportal')==user and
  (indo.get('DB_SCHEMA') or 'indo_shipping')=='indo_shipping','actualIndoDeploymentDatabase')
 for name in ('qc-report','qc-report-worker'):
  env=rows[name][1];need(env.get('DATABASE_URL')=='sqlite:////app/data/qc-report.db' and env.get('STORAGE_ROOT')=='/app/storage','actualQcReportDatabaseAndStorage')
 for name in ('factory-review','factory-review-test'):
  v=rows[name][0];need(v.get('Path')=='/pb/pocketbase' and v.get('Args')==['serve','--http=0.0.0.0:8090','--dir=/pb/pb_data','--publicDir=/pb/pb_public','--migrationsDir=/pb/pb_migrations','--hooksDir=/pb/pb_hooks'],'actualPocketBaseDatabaseDirectory')

def runtime():
 ids=run(['docker','ps','-aq','--no-trunc']).decode().split()
 need(0<len(ids)<=1000 and all(re.fullmatch('[a-f0-9]{64}',v) for v in ids),'completeContainerIds')
 records=json.loads(run(['docker','inspect',*ids]));storage_configuration(records);services={};others={}
 for v in records:
  label=v.get('Config',{}).get('Labels',{}) or {};service=label.get('com.docker.compose.service')
  row={'id':v['Id'],'image':v['Image'],'started':v['State'].get('StartedAt'),'restarts':v['RestartCount'],
   'running':v['State'].get('Running'),'oom':v['State'].get('OOMKilled'),
   'health':v['State'].get('Health',{}).get('Status'),'environmentSHA256':digest(v['Config'].get('Env',[])),
   'mounts':sorted(v.get('Mounts',[]),key=enc),'memory':v['HostConfig'].get('Memory'),'swap':v['HostConfig'].get('MemorySwap'),
   'healthcheck':v['Config'].get('Healthcheck')}
  if label.get('com.docker.compose.project')=='rr-portal' and service in TARGETS|PROTECTED|{'db','nginx','core','redis'}:
   need(service not in services,'uniqueFixedService');services[service]=row
  else:others[v['Id']]=row
 need(TARGETS|PROTECTED|{'db','nginx','core','redis'}<=set(services),'allFixedServicesPresent')
 for key,(rel,service,dest) in PREFIXES.items():
  matches=[m for m in services[service]['mounts'] if m.get('Destination')==dest]
  need(len(matches)==1 and matches[0].get('Type')=='bind' and matches[0].get('Source')==str(ROOT/rel),'exactPersistentBindMount')
 # Worker must use the same two persistent roots, not a private alternate DB.
 for dest,rel in [('/app/data',PREFIXES['qc-report-data'][0]),('/app/storage',PREFIXES['qc-report-storage'][0])]:
  need(any(m.get('Type')=='bind' and m.get('Destination')==dest and m.get('Source')==str(ROOT/rel) for m in services['qc-report-worker']['mounts']),'workerSharedPersistentRoots')
 return {'services':services,'others':others}

def runtime_difference(before,after):
 # Only fixed service labels, truncated container IDs and fixed field names.
 changes={'services':[],'others':[]}
 allowed={'id','image','started','restarts','running','oom','health','environmentSHA256','mounts','memory','swap','healthcheck'}
 for scope in changes:
  for name in sorted(set(before[scope])|set(after[scope])):
   a,b=before[scope].get(name),after[scope].get(name)
   if a==b:continue
   fields=['presence'] if a is None or b is None else sorted(k for k in allowed if a.get(k)!=b.get(k))
   if a is not None and b is not None and any(a.get(k)!=b.get(k) for k in (set(a)|set(b))-allowed):fields.append('otherFields')
   changes[scope].append({'service' if scope=='services' else 'idPrefix':name if scope=='services' else name[:12],'fields':fields})
 return changes

def runtime_checks(before,after):
 a,b=before['services'],after['services'];checks={}
 checks['protectedAndUnrelatedContainersIdentical']=before['others']==after['others'] and set(a)==set(b) and all(a[k]==b[k] for k in a if k not in TARGETS)
 checks['targetConfigurationUnchanged']=all(all(a[k][f]==b[k][f] for f in ('environmentSHA256','mounts','memory','swap','healthcheck')) for k in TARGETS)
 checks['targetsHealthyWithoutOOM']=all(b[k]['running'] is True and b[k]['health']=='healthy' and b[k]['oom'] is False for k in TARGETS)
 return checks

def sqlite_capture(key,tree,dest):
 need(tree.is_dir() and not tree.is_symlink(),'fixedPersistentRootExists')
 names=database_names(tree)
 if key.startswith('factory-review'):need({'data.db','auxiliary.db'}<=set(names),'bothPocketBaseDatabases')
 if key=='qc':need(any(pathlib.PurePosixPath(n).name=='qc.db' for n in names),'qcDatabasePresent')
 if key=='qc-report-data':need('qc-report.db' in names,'qcReportDatabasePresent')
 dest.mkdir(mode=0o700);copies=dest/'sqlite';copies.mkdir(mode=0o700)
 snapshots=L.snapshots(tree,copies)
 files=L.non_database_inventory(tree,names,dest/'files.tar')
 need(database_names(tree)==names,'databaseInventoryStable')
 return {'sqlite':snapshots,'files':files}

def sqlite_compare(key,relative,before,after,path):
 if before==after:return True
 p=pathlib.PurePosixPath(relative)
 allowed=key=='qc' and len(p.parts)==2 and p.parts[0] in QC_COMPANIES and p.name=='qc.db'
 if not allowed or 'record_tombstones' in before['tables']:return False
 current=json.loads(json.dumps(after))
 if 'record_tombstones' not in current['tables'] or current['tables']['record_tombstones']['rows']!=0:return False
 with contextlib.closing(L.connect(path,True)) as db:
  fields=db.execute('PRAGMA table_info(record_tombstones)').fetchall()
 if [tuple(r) for r in fields]!=[(0,'id','INTEGER',0,None,1),(1,'deletedAt','TEXT',0,None,0)]:return False
 del current['tables']['record_tombstones']
 rows=[r for r in current['schema'] if r[0]=='table' and r[1]=='record_tombstones' and r[2]=='record_tombstones']
 if len(rows)!=1 or ''.join((rows[0][3] or '').lower().split())!='createtablerecord_tombstones(idintegerprimarykey,deletedattext)':return False
 current['schema']=[r for r in current['schema'] if r is not rows[0]]
 current['schemaSha256']=L.digest(current['schema'])
 return current==before

def pg_quote(v):
 need(bool(re.fullmatch('[A-Za-z_][A-Za-z0-9_]{0,62}',v)),'fixedSQLIdentifier')
 return '"'+v+'"'

def pg_table_sql(schema,tables):
 chunks=[]
 for start in range(0,len(tables),20):
  parts=[]
  for name in tables[start:start+20]:
   remove=list(NEW_COLUMNS.get(name,{})) if schema=='indo_shipping' else []
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
    if schema=='indo_shipping':
     found={(r['table'],r['name']) for r in result[schema]['schema']['columns']}
     expected={(t,c) for t,cols in NEW_COLUMNS.items() for c in cols}
     need((not found.intersection(expected)) if with_dump else expected<=found,'exactPurchaseMigrationStage')
     if not with_dump:
      result[schema]['newColumnNonDefaultRows']=int(ask("SELECT (SELECT count(*) FROM indo_shipping.purchase_orders WHERE merged_into_id IS NOT NULL OR merge_revision<>0)+(SELECT count(*) FROM indo_shipping.po_items WHERE source_po_no IS NOT NULL OR source_order_date IS NOT NULL OR source_delivery_date IS NOT NULL OR delivery_date_override IS NOT NULL OR has_delivery_date_override);\n"))
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

def pg_compare(schema,before,after):
 if before.get('sequenceStateStableDuringCapture') is not True or after.get('sequenceStateStableDuringCapture') is not True or before.get('sequenceStates')!=after.get('sequenceStates'):return False
 if set(before['tables'])!=set(after['tables']):return False
 if any(before['tables'][t]['rows']!=after['tables'][t]['rows'] or before['tables'][t]['originalColumnsSHA256']!=after['tables'][t]['originalColumnsSHA256'] for t in before['tables']):return False
 old,new=before['schema'],json.loads(json.dumps(after['schema']))
 if schema=='indo_shipping' and after.get('newColumnNonDefaultRows')!=0:return False
 if schema!='indo_shipping':return old==new and before['tables']==after['tables']
 actual={(v['table'],v['name']):v for v in new['columns']}
 for table,cols in NEW_COLUMNS.items():
  for name,(kind,notnull,default) in cols.items():
   row=actual.get((table,name))
   if row is None or (row['type'],row['notNull'],row['default'],row['identity'],row['generated'])!=(kind,notnull,default,'',''):return False
 new['columns']=[r for r in new['columns'] if r['name'] not in NEW_COLUMNS.get(r['table'],{})]
 indexes=[r for r in new['indexes'] if r['name']=='ix_purchase_orders_merged_into']
 expected='CREATE INDEX ix_purchase_orders_merged_into ON indo_shipping.purchase_orders USING btree (merged_into_id) WHERE (merged_into_id IS NOT NULL)'
 if len(indexes)!=1 or indexes[0]['table']!='purchase_orders' or indexes[0]['definition']!=expected:return False
 new['indexes']=[r for r in new['indexes'] if r['name']!='ix_purchase_orders_merged_into']
 return old==new

def original_archive():
 need(re.fullmatch('[a-f0-9]{64}',BACKUP_MANIFEST_SHA256 or '') is not None,'frozenOriginalManifest')
 need(BACKUP.is_dir() and not BACKUP.is_symlink() and stat.S_IMODE(BACKUP.stat().st_mode)==0o700,'privateOriginalArchive')
 need(L.file_hash(BACKUP/'manifest.json')==BACKUP_MANIFEST_SHA256,'originalManifestPin')
 manifest=json.loads((BACKUP/'manifest.json').read_bytes())
 files={str(p.relative_to(BACKUP)) for p in BACKUP.rglob('*') if p.is_file() and p!=BACKUP/'manifest.json'}
 need(files==set(manifest) and all(not p.is_symlink() and (p.is_file() or p.is_dir()) and stat.S_IMODE(p.stat().st_mode)&0o077==0 for p in BACKUP.rglob('*')),'originalArchiveCompleteSet')
 need(all(L.safe_path(n) and L.file_hash(BACKUP/n)==h for n,h in manifest.items()),'originalArchiveFullBytes')
 baseline=json.loads((BACKUP/'baseline.private.json').read_bytes());receipt=json.loads((BACKUP/'first-result.json').read_bytes())
 need(receipt.get('success') is True and baseline['head']==BASE,'successfulOriginalBaseline')
 return baseline

def capture(directory,with_dump):
 first=runtime();L.private_write(directory/'runtime-before.private.json',enc(first))
 head=run(['git','rev-parse','HEAD']).decode().strip()
 need(head==(BASE if with_dump else TARGET),'exactDeploymentHead')
 env=ROOT/'.env.cloud.production';need(env.is_file() and not env.is_symlink() and env.stat().st_size<=4*1024**2,'privateEnvironmentFile')
 L.private_write(directory/'environment.private',env.read_bytes())
 result={'head':head,'runtime':first,'envSHA256':L.file_hash(env),'trees':{}}
 estimated=0
 for rel,_,_ in PREFIXES.values():
  tree=ROOT/rel;need(tree.is_dir() and not tree.is_symlink(),'allPersistentRootsExist')
  for p in tree.rglob('*'):
   need(not p.is_symlink() and (p.is_file() or p.is_dir()),'regularPersistentEntries')
   if p.is_file():estimated+=p.stat().st_size
 pg_size=int(run(['docker','exec','-i',first['services']['db']['id'],'sh','-c',
  'exec psql -X -q -At -v ON_ERROR_STOP=1 -U "${POSTGRES_USER:-rrportal}" -d "${POSTGRES_DB:-rrportal}"'],
  b"SELECT COALESCE(sum(pg_total_relation_size(quote_ident(schemaname)||'.'||quote_ident(tablename))),0) FROM pg_tables WHERE schemaname IN ('indo_shipping','internal_quote');\n").decode().strip())
 need(pg_size>=0 and shutil.disk_usage(directory).free>2*(estimated+pg_size)+1024**3,'privateArchiveDiskHeadroom')
 for key,(rel,_,_) in PREFIXES.items():result['trees'][key]=sqlite_capture(key,ROOT/rel,directory/key)
 result['postgres']=pg_capture(first['services']['db']['id'],directory,with_dump)
 need(L.file_hash(env)==result['envSHA256'],'environmentStableDuringCapture')
 last=runtime();L.private_write(directory/'runtime-after.private.json',enc(last))
 if last!=first:
  changed=runtime_difference(first,last);L.private_write(directory/'runtime-difference.private.json',enc(changed))
  for scope,rows in changed.items():
   for start in range(0,len(rows),8):print(json.dumps({'kind':'runtime-field-differences','scope':scope,'changedServiceFields':rows[start:start+8]},sort_keys=True),flush=True)
 need(last==first,'runtimeStableDuringCapture')
 L.private_write(directory/'baseline.private.json',enc(result))
 return result

def compare(before,after,directory):
 checks=runtime_checks(before['runtime'],after['runtime']);checks['environmentUnchanged']=before['envSHA256']==after['envSHA256']
 checks['allFileInventoriesIdentical']=set(before['trees'])==set(after['trees']) and all(before['trees'][k]['files']==after['trees'][k]['files'] for k in before['trees'])
 checked=[]
 for key in before['trees']:
  a,b=before['trees'][key]['sqlite'],after['trees'][key]['sqlite'];checked.append(set(a)==set(b) and all(sqlite_compare(key,name,a[name],b[name],directory/key/'sqlite'/name) for name in a))
 checks['allSQLiteOriginalColumnsAndAllowedSchemaPassed']=all(checked)
 checks['allPostgresOriginalColumnsAndAllowedSchemaPassed']=all(pg_compare(schema,before['postgres'][schema],after['postgres'][schema]) for schema in SCHEMAS)
 return checks

def main():
 global L
 os.umask(0o077)
 need(len(sys.argv)==2 and sys.argv[1] in {'backup','verify'},'fixedMode')
 mode=sys.argv[1]
 need(os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_ATTEMPT')=='1','fixedFirstWorkflowAttempt')
 need(BACKUP_PIN_FROZEN and (mode=='backup' or VERIFY_PIN_FROZEN and re.fullmatch('[a-f0-9]{40}',TARGET or '')),'reviewedExecutionPin')
 L=load_library(pathlib.Path(__file__).with_name('release-data-library.py'))
 def terminate(*_):need(False,'operationTerminated')
 signal.signal(signal.SIGTERM,terminate)
 directory=BACKUP if mode=='backup' else VERIFY;directory.mkdir(mode=0o700)
 result={'mode':mode,'success':False,'businessWritesPerformed':False,'containersOrConfigChanged':False,'secretOrBusinessRowsPrinted':False,'individuallyConsistentSQLiteNotCrossDatabaseAtomic':True,'dataPreservationOnlyNotApplicationCodeVersionProof':True,'sequenceStatesIndependentlyBracketedNotMVCCSnapshotAtomic':True}
 try:
  before=original_archive() if mode=='verify' else None
  observed=capture(directory,mode=='backup')
  if before is not None:
   result['checks']=compare(before,observed,directory);original_archive()
   result['success']=all(result['checks'].values())
  else:result['success']=True
  result['databaseCountsByRoot']={k:len(v['sqlite']) for k,v in observed['trees'].items()}
  result['postgresSchemaCount']=len(observed['postgres'])
 except BaseException:
  result['failedCheck']=STAGE;result['success']=False
 finally:
  L.private_write(directory/'first-result.json',enc(result));L.seal(directory)
  print(json.dumps({'mode':mode,'success':result['success'],'failedCheck':result.get('failedCheck'),
   'checks':result.get('checks'),'databaseCountsByRoot':result.get('databaseCountsByRoot'),
   'resultSHA256':L.file_hash(directory/'first-result.json'),'manifestSHA256':L.file_hash(directory/'manifest.json')},sort_keys=True),flush=True)
 return 0 if result['success'] else 1

if __name__=='__main__':
 try:sys.exit(main())
 except Exception:print('{"success":false,"failedCheck":"RELEASE_PREFLIGHT_REJECTED"}',flush=True);sys.exit(1)
