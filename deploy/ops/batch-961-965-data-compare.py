"""Closed-snapshot evidence derivation plus pure business-preservation comparison.
No live database, HTTP, subprocess, business write, restore or counter reset.
"""
import contextlib,datetime,hashlib,importlib.util,json,pathlib,re,stat,tarfile
LIB=None;QC=None
LIB_SHA='d63168fd3057f4f2aba2d93f9fab31d2d65c6dd0f3234877d71fcff1e04e62b9'
QC_SHA='5e77b0a75c11f166cbe2151dc9c1fc19a3f589673f2a49dc1c7aa5f046c49d89'
PB_REFERENCE={'collections': {'analysis_followups': {'id': 'pbc_851364229', 'system': 0, 'type': 'base', 'name': 'analysis_followups', 'fields': '[{"autogeneratePattern":"[a-z0-9]{15}","help":"","hidden":false,"id":"text3208210256","max":15,"min":15,"name":"id","pattern":"^[a-z0-9]+$","presentable":false,"primaryKey":true,"required":true,"system":true,"type":"text"},{"cascadeDelete":true,"collectionId":"_pb_users_auth_","help":"","hidden":false,"id":"relation3479234172","maxSelect":1,"minSelect":0,"name":"owner","presentable":false,"required":true,"system":false,"type":"relation"},{"autogeneratePattern":"","help":"","hidden":false,"id":"text85227156","max":250,"min":0,"name":"issue_key","pattern":"","presentable":false,"primaryKey":false,"required":true,"system":false,"type":"text"},{"help":"","hidden":false,"id":"select2063623452","maxSelect":1,"name":"status","presentable":false,"required":true,"system":false,"type":"select","values":["pending","following","resolved"]}]', 'indexes': '["CREATE UNIQUE INDEX idx_analysis_followup_owner_key ON analysis_followups (owner, issue_key)"]', 'listRule': '@request.auth.id != "" && @request.auth.collectionName = "users" && owner = @request.auth.id', 'viewRule': '@request.auth.id != "" && @request.auth.collectionName = "users" && owner = @request.auth.id', 'createRule': '@request.auth.id != "" && @request.auth.collectionName = "users" && owner = @request.auth.id', 'updateRule': '@request.auth.id != "" && @request.auth.collectionName = "users" && owner = @request.auth.id && (@request.body.owner:isset = false || @request.body.owner = owner) && (@request.body.issue_key:isset = false || @request.body.issue_key = issue_key)', 'deleteRule': '@request.auth.id != "" && @request.auth.collectionName = "users" && owner = @request.auth.id', 'options': '{}'}, 'analysis_ai_usage': {'id': 'pbc_4169730423', 'system': 0, 'type': 'base', 'name': 'analysis_ai_usage', 'fields': '[{"autogeneratePattern":"[a-z0-9]{15}","help":"","hidden":false,"id":"text3208210256","max":15,"min":15,"name":"id","pattern":"^[a-z0-9]+$","presentable":false,"primaryKey":true,"required":true,"system":true,"type":"text"},{"cascadeDelete":true,"collectionId":"_pb_users_auth_","help":"","hidden":false,"id":"relation3479234172","maxSelect":1,"minSelect":0,"name":"owner","presentable":false,"required":true,"system":false,"type":"relation"},{"autogeneratePattern":"","help":"","hidden":false,"id":"text1807501289","max":80,"min":0,"name":"minute_key","pattern":"","presentable":false,"primaryKey":false,"required":true,"system":false,"type":"text"},{"help":"","hidden":false,"id":"date222754019","max":"","min":"","name":"started_at","presentable":false,"required":true,"system":false,"type":"date"}]', 'indexes': '["CREATE UNIQUE INDEX idx_analysis_ai_minute ON analysis_ai_usage (minute_key)","CREATE INDEX idx_analysis_ai_owner_date ON analysis_ai_usage (owner, started_at)"]', 'listRule': None, 'viewRule': None, 'createRule': None, 'updateRule': None, 'deleteRule': None, 'options': '{}'}}, 'columns': {'analysis_followups': [[0, 'id', 'TEXT', 1, "'r'||lower(hex(randomblob(7)))", 1, 0], [1, 'issue_key', 'TEXT', 1, "''", 0, 0], [2, 'owner', 'TEXT', 1, "''", 0, 0], [3, 'status', 'TEXT', 1, "''", 0, 0]], 'analysis_ai_usage': [[0, 'id', 'TEXT', 1, "'r'||lower(hex(randomblob(7)))", 1, 0], [1, 'minute_key', 'TEXT', 1, "''", 0, 0], [2, 'owner', 'TEXT', 1, "''", 0, 0], [3, 'started_at', 'TEXT', 1, "''", 0, 0]]}, 'schema': [['index', 'idx_analysis_ai_minute', 'analysis_ai_usage', 'CREATE UNIQUE INDEX `idx_analysis_ai_minute` ON `analysis_ai_usage` (`minute_key`)'], ['index', 'idx_analysis_ai_owner_date', 'analysis_ai_usage', 'CREATE INDEX `idx_analysis_ai_owner_date` ON `analysis_ai_usage` (\n  `owner`,\n  `started_at`\n)'], ['index', 'idx_analysis_followup_owner_key', 'analysis_followups', 'CREATE UNIQUE INDEX `idx_analysis_followup_owner_key` ON `analysis_followups` (\n  `owner`,\n  `issue_key`\n)'], ['index', 'sqlite_autoindex_analysis_ai_usage_1', 'analysis_ai_usage', None], ['index', 'sqlite_autoindex_analysis_followups_1', 'analysis_followups', None], ['table', 'analysis_ai_usage', 'analysis_ai_usage', "CREATE TABLE `analysis_ai_usage` (`id` TEXT PRIMARY KEY DEFAULT ('r'||lower(hex(randomblob(7)))) NOT NULL, `minute_key` TEXT DEFAULT '' NOT NULL, `owner` TEXT DEFAULT '' NOT NULL, `started_at` TEXT DEFAULT '' NOT NULL)"], ['table', 'analysis_followups', 'analysis_followups', "CREATE TABLE `analysis_followups` (`id` TEXT PRIMARY KEY DEFAULT ('r'||lower(hex(randomblob(7)))) NOT NULL, `issue_key` TEXT DEFAULT '' NOT NULL, `owner` TEXT DEFAULT '' NOT NULL, `status` TEXT DEFAULT '' NOT NULL)"]], 'migrationColumns': ['file', 'applied']}
MAPPING_PINS={'country_map.json': {'before': '2de5a5af98594e4d626b7b83565f906d50d776a9229871fbba572a8133b22174', 'after': 'c30a4583a6130ae8854308d7e251a2d45dbbeba4e01f11c565dc226a216f7c59', 'afterBytes': 26316}, 'item_map.json': {'before': 'e251ba63423890f9dfedf8706299ba7c21270ad439519ae0620ef03137700d90', 'after': 'c46d4e113144dc551e97d3e15b850602302b8efb8828dbf8258736097cef31f0', 'afterBytes': 63161}, 'customer_country.json': {'before': None, 'after': '85ca806b646163bace88eabc21eacc9157fac393a69fda4c007d27cb728c107a', 'afterBytes': 5354}}
WRITABLE_MAPPING_MODES={'country_map.json':0o666,'item_map.json':0o666}
PRINT_TABLE_SQL={'authority_state':'CREATE TABLE authority_state(id INTEGER PRIMARY KEY,value TEXT NOT NULL)','authority_commands':'CREATE TABLE authority_commands(id TEXT PRIMARY KEY,value TEXT NOT NULL,status TEXT NOT NULL,result TEXT,created TEXT NOT NULL)','authority_backups':'CREATE TABLE authority_backups(id INTEGER PRIMARY KEY,created TEXT NOT NULL,value TEXT NOT NULL)'}
STORAGE_KEYS={'factory-review','factory-review-test','qc-plan-data','printlink-runtime','quote-legacy','quote-uploads','zuru-data','zuru-uploads','zuru-exports'}

def need(value):
 if not value:raise ValueError('SEALED_DATA_COMPARISON_REJECTED')
def enc(value):return json.dumps(value,sort_keys=True,ensure_ascii=True,separators=(',',':'),allow_nan=False).encode()
def sha(value):return hashlib.sha256(value).hexdigest()
def load(name,checksum):
 path=pathlib.Path(__file__).with_name(name);need(path.is_file()and not path.is_symlink()and sha(path.read_bytes())==checksum);spec=importlib.util.spec_from_file_location(name.replace('.','_'),path);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module

def libraries():
 global LIB,QC
 if LIB is None:LIB=load('release-data-library.py',LIB_SHA)
 if QC is None:QC=load('batch-qc-sqlite-compat.py',QC_SHA)
 return LIB,QC

def timestamp(value):
 match=re.fullmatch(r'(\d{4}-\d\d-\d\d[ T]\d\d:\d\d:\d\d)(?:\.(\d{1,9}))?(Z|[+-]\d\d:\d\d)',value or'')
 if not match:return None
 try:return datetime.datetime.fromisoformat(match[1]+('.'+match[2][:6].ljust(6,'0')if match[2]else'')+('+00:00'if match[3]=='Z'else match[3])).astimezone(datetime.timezone.utc)
 except ValueError:return None

def selected(db,name,lib,columns=None,where='',params=()):
 columns=columns or db.execute('PRAGMA table_xinfo('+lib.quote(name)+')').fetchall();rows=db.execute('SELECT '+','.join(lib.quote(c[1])for c in columns)+' FROM '+lib.quote(name)+(' WHERE '+where if where else''),params);hashes=sorted(lib.digest([lib.cell(value)for value in row])for row in rows);return {'rows':len(hashes),'sha256':sha(''.join(hashes).encode()),'columnsSha256':lib.digest(columns)}

def pb_data(old,new,a,b,lib):
 names=set(PB_REFERENCE['collections']);checks={};details={}
 if names&set(a['tables']):return {'passed':a==b,'checks':{'preexistingAnalysisSchemaStrictlyUnchanged':a==b},'details':details}
 expected_schema=sorted(a['schema']+PB_REFERENCE['schema'],key=lambda row:(row[0],row[1]));checks['onlyExactNewAnalysisSchemaObjects']=b['schema']==expected_schema and set(b['tables'])==set(a['tables'])|names;checks['allNewAnalysisTablesEmpty']=all(b['tables'].get(n,{}).get('rows')==0 for n in names)
 unchanged=set(a['tables'])-{'_collections','_migrations'};checks['allOldBusinessTablesTypedIdentical']=all(a['tables'][n]==b['tables'].get(n)for n in unchanged);checks['existingCollectionsTypedIdentical']=selected(new,'_collections',lib,where='name NOT IN (?,?)',params=tuple(sorted(names)))==a['tables']['_collections'];new_rows=[dict(zip([c[1]for c in new.execute('PRAGMA table_xinfo(_collections)')],row))for row in new.execute('SELECT * FROM _collections WHERE name IN (?,?)',tuple(sorted(names)))];valid=len(new_rows)==2
 for row in new_rows:
  expected=PB_REFERENCE['collections'][row['name']];created=row.pop('created');updated=row.pop('updated');valid&=row==expected and timestamp(created)is not None and created==updated
 checks['newCollectionFieldsOwnersRulesAndIndexesExact']=bool(valid)
 migrations=('1792454400_create_analysis_followups.js','1792454500_create_analysis_ai_usage.js');checks['existingMigrationRowsTypedIdentical']=selected(new,'_migrations',lib,where='file NOT IN (?,?)',params=migrations)==a['tables']['_migrations'];rows=new.execute('SELECT file,applied FROM _migrations WHERE file IN (?,?)',migrations).fetchall();checks['onlyTwoExpectedMigrationReceiptsAdded']=len(rows)==2 and{r[0]for r in rows}==set(migrations)and all(type(r[1])is int and r[1]>0 for r in rows)and b['tables']['_migrations']['rows']==a['tables']['_migrations']['rows']+2 and b['tables']['_collections']['rows']==a['tables']['_collections']['rows']+2
 return {'passed':all(checks.values()),'checks':checks,'details':{'newCollections':sorted(names),'originalBusinessTables':len(unchanged)}}

def log_policy(path,started,lib):
 start=timestamp(started)
 if start is None:return None
 with contextlib.closing(lib.connect(path,True))as db:row=db.execute("SELECT CASE WHEN json_valid(value) THEN json_extract(value,'$.logs.maxDays') END,CASE WHEN json_valid(value) THEN json_extract(value,'$.logs.minLevel') END,CASE WHEN json_valid(value) THEN json_type(value,'$.logs.maxDays') END,CASE WHEN json_valid(value) THEN json_type(value,'$.logs.minLevel') END FROM _params WHERE id='settings'").fetchone()
 if row is None or row[2:]!=('integer','integer')or type(row[0])is not int or not 0<=row[0]<=36500 or type(row[1])is not int or not-100<=row[1]<=100:return None
 return {'cutoff':start-datetime.timedelta(days=row[0]),'minLevel':row[1]}

def pb_aux(old,new,a,b,old_data,new_data,started,lib):
 checks={'schemaAndAllNonLogTablesExact':a['schema']==b['schema']and{k:v for k,v in a['tables'].items()if k!='_logs'}=={k:v for k,v in b['tables'].items()if k!='_logs'}};columns=old.execute('PRAGMA table_xinfo(_logs)').fetchall();need(columns==new.execute('PRAGMA table_xinfo(_logs)').fetchall());names=[c[1]for c in columns];need({'id','created','level'}<=set(names));old_rows=old.execute('SELECT * FROM _logs').fetchall();current={row[names.index('id')]:row for row in new.execute('SELECT * FROM _logs')};need(len(current)==b['tables']['_logs']['rows']);policies=[log_policy(p,started,lib)for p in(old_data,new_data)];policy=policies[0]if policies[0]is not None and policies[0]==policies[1]else None;counts={'oldRows':len(old_rows),'retainedTypedIdentical':0,'changedTypedRows':0,'missing':0,'missingCompatibleWithConfiguredRetention':0,'newRows':len(current),'configuredRetentionAvailableAndUnchanged':policy is not None}
 for row in old_rows:
  key=row[names.index('id')];match=current.get(key)
  if match is not None:
   counts['newRows']-=1;counts['retainedTypedIdentical'if[lib.cell(v)for v in row]==[lib.cell(v)for v in match]else'changedTypedRows']+=1;continue
  counts['missing']+=1;created=timestamp(row[names.index('created')]);level=row[names.index('level')];counts['missingCompatibleWithConfiguredRetention']+=int(policy is not None and((created is not None and created<=policy['cutoff'])or(type(level)is int and level<policy['minLevel'])))
 checks['oldLogRowsTypedPreservedOrExactConfiguredRetentionCompatible']=counts['changedTypedRows']==0 and counts['missing']==counts['missingCompatibleWithConfiguredRetention'];return {'passed':all(checks.values()),'checks':checks,'details':dict(counts,actualActorOrCauseProven=False,strictAllAuxiliaryValuesIdentical=a==b)}

def added_column_sql(old_sql,column):
 need(old_sql.endswith(')'));return old_sql[:-1]+', '+column+')'

def print_cloud(old,new,a,b,lib):
 columns=old.execute('PRAGMA table_xinfo(production_jobs)').fetchall()
 if any(c[1]=='authority_revision'for c in columns):return {'passed':a==b,'checks':{'existingAuthorityRevisionSchemaStrictlyUnchanged':a==b},'details':{}}
 current=new.execute('PRAGMA table_xinfo(production_jobs)').fetchall();expected=columns+[(len(columns),'authority_revision','INTEGER',1,'0',0,0)];checks={'onlyExpectedIntegerDefaultZeroColumn':current==expected,'allOriginalJobValuesTypedIdentical':selected(new,'production_jobs',lib,columns)==a['tables']['production_jobs'],'newRevisionValuesAllTypedIntegerZero':new.execute("SELECT COUNT(*) FROM production_jobs WHERE typeof(authority_revision)<>'integer' OR authority_revision<>0").fetchone()[0]==0};schema=[]
 for row in a['schema']:
  row=list(row)
  if row[0]=='table'and row[1]=='production_jobs':row[3]=added_column_sql(row[3],'authority_revision INTEGER NOT NULL DEFAULT 0')
  schema.append(row)
 checks['allOtherSchemaObjectsExact']=schema==b['schema'];checks['allOtherOriginalTablesTypedIdentical']=set(a['tables'])==set(b['tables'])and all(value==b['tables'][n]for n,value in a['tables'].items()if n!='production_jobs');return {'passed':all(checks.values()),'checks':checks,'details':{}}

def print_production(old,new,a,b,lib):
 names=set(PRINT_TABLE_SQL)
 if names&set(a['tables']):return {'passed':a==b,'checks':{'preexistingAuthorityTablesStrictlyUnchanged':a==b},'details':{}}
 schema=a['schema']+[['table',name,name,sql]for name,sql in PRINT_TABLE_SQL.items()]+[['index','sqlite_autoindex_authority_commands_1','authority_commands',None]];schema.sort(key=lambda row:(row[0],row[1]));checks={'onlyExactAuthoritySchemaObjectsAdded':schema==b['schema']and set(b['tables'])==set(a['tables'])|names,'allAuthorityTablesEmptyAndDisabled':all(b['tables'].get(n,{}).get('rows')==0 for n in names),'allOldSnapshotLedgerInventoryImagesAndBusinessTablesTypedExact':all(value==b['tables'].get(name)for name,value in a['tables'].items())};return {'passed':all(checks.values()),'checks':checks,'details':{}}

def closed_path(root,key,relative,lib):
 need(root.is_absolute()and root.is_dir()and not root.is_symlink()and key in STORAGE_KEYS and lib.safe_path(relative));path=root/key/'sqlite'/relative;need(path.is_file()and not path.is_symlink()and stat.S_IMODE(path.stat().st_mode)==0o600 and not any(path.with_name(path.name+suffix).exists()for suffix in('-wal','-shm','-journal')))
 for ancestor in(path,*path.parents):
  if ancestor==root:break
  need(not ancestor.is_symlink())
 return path

def lock_owner(root,inventory):
 name='.platform-lock/owner.json';rows=[row for row in inventory if row['path']==name];need(len(rows)==1 and rows[0].get('directory')is False and rows[0].get('mode')==0o600 and 0<rows[0].get('bytes',0)<=2048);path=root/'printlink-runtime/files.tar';need(path.is_file()and not path.is_symlink());before=path.stat()
 with tarfile.open(path,'r:')as archive:
  members=[member for member in archive if member.name==name];need(len(members)==1 and members[0].isfile()and members[0].size==rows[0]['bytes']);content=archive.extractfile(members[0]).read();need(len(content)==rows[0]['bytes']and sha(content)==rows[0]['sha256']);value=json.loads(content)
 after=path.stat();need((before.st_dev,before.st_ino,before.st_size,before.st_mtime_ns)==(after.st_dev,after.st_ino,after.st_size,after.st_mtime_ns));return value

def derive_closed_sqlite_evidence(before,observed,backup_root,observe_root):
 lib,qc=libraries();backup_root=pathlib.Path(backup_root);observe_root=pathlib.Path(observe_root);need(set(before['storage'])==set(observed['storage'])==STORAGE_KEYS);evidence={'beforeStorageMetadataSHA256':sha(enc(before['storage'])),'observedStorageMetadataSHA256':sha(enc(observed['storage'])),'databases':{},'sqliteInventoryIdentical':True,'noLiveDatabaseReads':True,'noInputWrites':True}
 for key in sorted(STORAGE_KEYS):
  old=before['storage'][key]['sqlite'];new=observed['storage'][key]['sqlite'];evidence['sqliteInventoryIdentical']&=set(old)==set(new)
  for relative in sorted(set(old)|set(new)):
   label=key+'/'+relative
   if relative not in old or relative not in new:evidence['databases'][label]={'passed':False,'checks':{'exactDatabaseInventory':False},'details':{}};continue
   old_path=closed_path(backup_root,key,relative,lib);new_path=closed_path(observe_root,key,relative,lib);stats=[p.stat()for p in(old_path,new_path)]
   with contextlib.ExitStack()as stack:
    a,b=[stack.enter_context(contextlib.closing(lib.connect(p,True)))for p in(old_path,new_path)];need(lib.audit(a)==old[relative]and lib.audit(b)==new[relative]);old_a,new_a=old[relative],new[relative]
    if key in{'factory-review','factory-review-test'}and relative=='data.db':result=pb_data(a,b,old_a,new_a,lib)
    elif key in{'factory-review','factory-review-test'}and relative=='auxiliary.db':result=pb_aux(a,b,old_a,new_a,closed_path(backup_root,key,'data.db',lib),closed_path(observe_root,key,'data.db',lib),observed['runtime']['targets'][key]['started'],lib)
    elif key=='qc-plan-data'and relative=='qc-inspection.db':result=qc.compare_qc(old_path,new_path,old_a,new_a,lib)
    elif key=='printlink-runtime'and relative=='orders/printlink.sqlite':result=print_cloud(a,b,old_a,new_a,lib)
    elif key=='printlink-runtime'and relative=='production.sqlite':result=print_production(a,b,old_a,new_a,lib)
    else:result={'passed':old_a==new_a,'checks':{'allOriginalTypedRowsAndSchemaExact':old_a==new_a},'details':{}}
   for path,pinned in zip((old_path,new_path),stats):
    current=path.stat();need((pinned.st_dev,pinned.st_ino,pinned.st_size,pinned.st_mtime_ns,pinned.st_ctime_ns)==(current.st_dev,current.st_ino,current.st_size,current.st_mtime_ns,current.st_ctime_ns))
   result['oldAuditSHA256']=sha(enc(old[relative]));result['observedAuditSHA256']=sha(enc(new[relative]));evidence['databases'][label]=result
 try:
  old_owner=lock_owner(backup_root,before['storage']['printlink-runtime']['files']);new_owner=lock_owner(observe_root,observed['storage']['printlink-runtime']['files']);start=timestamp(observed['runtime']['targets']['printlink']['started']);created=timestamp(new_owner.get('created'));valid=all(type(value)is dict and set(value)=={'pid','purpose','created'}and type(value['pid'])is int and value['pid']==1 and value['purpose']=='platform'and timestamp(value['created'])is not None for value in(old_owner,new_owner))and start is not None and created is not None and start<=created<=start+datetime.timedelta(seconds=30);evidence['operationalLockOwnerOnlyCompatible']=bool(valid)
 except BaseException:evidence['operationalLockOwnerOnlyCompatible']=False
 return evidence

def file_mapping_check(old,new):
 a={row['path']:row for row in old};b={row['path']:row for row in new};names=set(MAPPING_PINS)
 if{k:v for k,v in a.items()if k not in names}!={k:v for k,v in b.items()if k not in names}:return False
 for name,pin in MAPPING_PINS.items():
  current=b.get(name)
  if current is None or current.get('directory')is not False or current.get('sha256')!=pin['after']or current.get('bytes')!=pin['afterBytes']or current.get('mode')!=WRITABLE_MAPPING_MODES.get(name,0o644):return False
  original=a.get(name)
  if pin['before']is None:
   if original is not None and original!=current:return False
  elif original is None or original.get('directory')is not False or original.get('sha256')!=pin['before']or original.get('mode')!=WRITABLE_MAPPING_MODES.get(name,0o644):return False
 return True

def quote_sequence_check(old,new):
 changed=[name for name in sorted(set(old.get('sequenceStates',{}))|set(new.get('sequenceStates',{})))if old.get('sequenceStates',{}).get(name)!=new.get('sequenceStates',{}).get(name)];details={'changedSequences':changed,'actualActorOrCauseProven':False,'sequenceStatesNotMVCCAtomic':True}
 if not old.get('sequenceStateStableDuringCapture')or not new.get('sequenceStateStableDuringCapture'):return False,details
 if not changed:return True,details
 if changed!=['quote_sections_id_seq']:return False,details
 name=changed[0];a,b=old['sequenceStates'][name],new['sequenceStates'][name];definitions=[row for row in old['schema']['sequences']if row['name']==name];current=[row for row in new['schema']['sequences']if row['name']==name]
 if len(definitions)!=1 or definitions!=current:return False,details
 definition=definitions[0]
 if any(str(definition.get(key))!=value for key,value in{'increment':'1','cache':'1','ownedByTable':'quote_sections','ownedByColumn':'id'}.items())or definition.get('cycle')is not False or a.get('called')is not True or b.get('called')is not True:return False,details
 try:delta=int(b['lastValue'])-int(a['lastValue']);expected=old['tables']['quotes']['rows']*old['tables']['departments']['rows']
 except BaseException:return False,details
 details.update(beforeLastValue=a['lastValue'],afterLastValue=b['lastValue'],delta=delta,expectedUnchangedStartupInsertSelectCandidates=expected,counterNeverRegressed=delta>=0,compatibleWithExistingStartupConflictConsumption=delta==expected)
 return delta>=0 and delta==expected,details

def compare(before,observed):
 """Pure dict comparison. Closed SQLite/tar evidence must already be derived."""
 evidence=observed.get('closedSqliteEvidence',{});checks={};strict={};details={};checks['closedEvidenceBoundToBothFullStorageMetadata']=evidence.get('beforeStorageMetadataSHA256')==sha(enc(before['storage']))and evidence.get('observedStorageMetadataSHA256')==sha(enc(observed['storage']));checks['exactAllDatabaseInventories']=evidence.get('sqliteInventoryIdentical')is True;expected_labels={key+'/'+name for key,value in before['storage'].items()for name in value['sqlite']};checks['allDatabaseComparisonsPresentAndOriginalValuesPreserved']=set(evidence.get('databases',{}))==expected_labels and all(value.get('passed')is True for value in evidence.get('databases',{}).values());details['closedDatabaseCompatibility']=evidence.get('databases',{})
 for key in sorted(STORAGE_KEYS):
  old=before['storage'][key];new=observed['storage'][key];strict[key+'FullSQLiteSnapshotStrictlyIdentical']=old['sqlite']==new['sqlite'];strict[key+'AllFileBytesAndModesStrictlyIdentical']=old['files']==new['files']
  if key=='zuru-data':checks[key+'OnlyThreeExactReviewedMappingChanges']=file_mapping_check(old['files'],new['files'])
  elif key=='printlink-runtime':
   name='.platform-lock/owner.json';same=[row for row in old['files']if row['path']!=name]==[row for row in new['files']if row['path']!=name];checks[key+'OriginalBusinessFilesAndModesPreserved']=same and(evidence.get('operationalLockOwnerOnlyCompatible')is True or old['files']==new['files'])
  else:checks[key+'OriginalFileBytesAndModesPreserved']=old['files']==new['files']
  if key=='quote-legacy':checks['quoteLegacyRawSQLiteBytesAndModesPreserved']=old['completeRawFileInventory']==new['completeRawFileInventory']
 a,b=before['postgres'],observed['postgres'];checks['quoteAllOriginalFullTypedRowsStrictlyIdentical']=a['tables']==b['tables'];checks['quoteFullSchemaAndSequenceDefinitionsStrictlyIdentical']=a['schema']==b['schema'];strict['quoteSequenceStatesStrictlyIdenticalNonMVCC']=a['sequenceStates']==b['sequenceStates'];compatible,sequence=quote_sequence_check(a,b);checks['quoteSequenceStateIdenticalOrExactKnownStartupCandidateConsumption']=compatible;details['quoteSequenceCompatibility']=sequence
 return {'checks':checks,'strictChecks':strict,'details':details,'allAcceptanceChecksPassed':all(checks.values()),'strictAllSnapshotsIdentical':all(strict.values()),'requiresScopedDifferenceClassification':not all(checks.values()),'actualActorOrCauseProven':False,'businessWritesOrCounterResetPerformed':False}
