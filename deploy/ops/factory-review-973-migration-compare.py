"""Read-only exact PR973 additive PocketBase migration comparator; closed snapshots only."""
import contextlib,datetime,hashlib,json,re,sqlite3
MIGRATION='1792537200_extend_patrol_template02.js'
TEXT_FIELDS=(('responsibility_scope','text2707377328'),('responsible_supervisor','text1982967167'),('processing_fee_period','text3182212436'),('completion_details','text2269576956'))
ADDED_FIELDS=[dict(autogeneratePattern='',help='',hidden=False,id=identifier,max=10000,min=0,name=name,pattern='',presentable=False,primaryKey=False,required=False,system=False,type='text')for name,identifier in TEXT_FIELDS]+[dict(help='',hidden=False,id='json1394067528',maxSize=100,name='processing_fee',presentable=False,required=False,system=False,type='json')]
ADDED_COLUMNS=[(name,"TEXT DEFAULT '' NOT NULL")for name,_ in TEXT_FIELDS]+[('processing_fee','JSON DEFAULT NULL')]

def need(value):
 if not value:raise RuntimeError('FACTORY_REVIEW_973_MIGRATION_COMPARISON_REJECTED')
def encoded(value):return json.dumps(value,sort_keys=True,ensure_ascii=True,separators=(',',':'),allow_nan=False).encode()
def digest(value):return hashlib.sha256(encoded(value)).hexdigest()
def timestamp(value):
 need(type(value)is str);match=re.fullmatch(r'(\d{4}-\d\d-\d\d[ T]\d\d:\d\d:\d\d)(?:\.(\d{1,9}))?(Z|[+-]\d\d:\d\d)',value);need(match is not None)
 try:
  normalized=match[1]+('.'+match[2][:6].ljust(6,'0')if match[2]else'')+match[3];parsed=datetime.datetime.fromisoformat(normalized.replace('Z','+00:00'));need(parsed.tzinfo is not None);return parsed.astimezone(datetime.timezone.utc)
 except (ValueError,TypeError,AttributeError):need(False)
def micros(value):
 delta=value-datetime.datetime(1970,1,1,tzinfo=datetime.timezone.utc);return(delta.days*86400+delta.seconds)*1000000+delta.microseconds

def compare(oldpath,newpath,started,observed,lib):
 lower=timestamp(started);lower=lower.replace(microsecond=lower.microsecond//1000*1000);upper=timestamp(observed);need(lower<=upper)
 with contextlib.ExitStack()as stack:
  old=stack.enter_context(contextlib.closing(lib.connect(oldpath,True)));new=stack.enter_context(contextlib.closing(lib.connect(newpath,True)))
  audits=[lib.audit(db)for db in (old,new)];a,b=audits;checks={};q=lib.quote
  schemas=[{(row[0],row[1]):row for row in audit['schema']}for audit in audits];sa,sb=schemas
  need(len(sa)==len(a['schema'])and len(sb)==len(b['schema'])and ('table','quality_patrols')in sa)
  with contextlib.closing(sqlite3.connect(':memory:'))as model:
   model.execute(sa['table','quality_patrols'][3])
   for name,definition in ADDED_COLUMNS:model.execute('ALTER TABLE quality_patrols ADD COLUMN '+q(name)+' '+definition)
   expected_sql=model.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name='quality_patrols'").fetchone()[0];expected_columns=model.execute('PRAGMA table_xinfo(quality_patrols)').fetchall()
  expected_schema=dict(sa);expected_schema['table','quality_patrols']=[*sa['table','quality_patrols'][:3],expected_sql]
  checks['SchemaOnlyExactFiveColumnsAdded']=expected_schema==sb
  checks['AllOldTablesAndNoUnexpectedTables']=set(a['tables'])==set(b['tables'])
  expected={name:dict(row)for name,row in a['tables'].items()};special={'quality_patrols','_collections','_migrations','sqlite_stat1'};details={}
  for name in sorted(set(a['tables'])|set(b['tables'])):
   if name not in special and a['tables'].get(name)!=b['tables'].get(name):details[name]={'beforeRows':a['tables'].get(name,{}).get('rows'),'afterRows':b['tables'].get(name,{}).get('rows'),'allTypedCellsIdentical':False}
  checks['AllOtherTablesTypedIdentical']=not details
  need({'quality_patrols','_collections','_migrations'}<=set(a['tables'])and set(a['tables'])==set(b['tables']))
  columns={name:[db.execute('PRAGMA table_xinfo('+q(name)+')').fetchall()for db in (old,new)]for name in special if name in a['tables']}
  def hashes(rows):return sorted(digest([lib.cell(value)for value in row])for row in rows)
  def rows(db,name,names):return list(db.execute('SELECT '+','.join(map(q,names))+' FROM '+q(name)))
  patrol_old_names=[c[1]for c in columns['quality_patrols'][0]];patrol_new_names=[c[1]for c in columns['quality_patrols'][1]]
  checks['PatrolColumnsExact']=columns['quality_patrols'][1]==expected_columns
  old_patrol=rows(old,'quality_patrols',patrol_old_names);new_patrol_old=rows(new,'quality_patrols',patrol_old_names)
  checks['PatrolOldColumnsAllTypedIdentical']=hashes(old_patrol)==hashes(new_patrol_old)
  checks['ExistingPatrolNewFieldsExactlyEmptyTextAndSQLNull']=hashes([(*row,'','','','',None)for row in old_patrol])==hashes(rows(new,'quality_patrols',patrol_new_names))
  expected['quality_patrols']={'rows':len(old_patrol),'sha256':hashlib.sha256(''.join(hashes([(*row,'','','','',None)for row in old_patrol])).encode()).hexdigest(),'columnsSha256':digest(expected_columns)}
  names=[c[1]for c in columns['_collections'][0]];need({'id','name','fields','updated'}<=set(names));checks['CollectionColumnsUnchanged']=columns['_collections'][0]==columns['_collections'][1]
  original=rows(old,'_collections',names);actual=rows(new,'_collections',names);ni=names.index('name');fi=names.index('fields');ui=names.index('updated');targets=[row for row in original if row[ni]=='quality_patrols'];current=[row for row in actual if row[ni]=='quality_patrols'];need(len(targets)==len(current)==1)
  target=list(targets[0]);fields=target[fi];need(type(fields)is str and fields.endswith(']')and type(json.loads(fields))is list and not {f['name']for f in ADDED_FIELDS}&{f['name']for f in json.loads(fields)})
  target[fi]=fields[:-1]+(','if json.loads(fields)else'')+','.join(encoded(f).decode()for f in ADDED_FIELDS)+']';updated=current[0][ui]
  checks['CollectionMigrationUpdatedWithinStartupObservationWindow']=type(updated)is str and lower<=timestamp(updated)<=upper
  target[ui]=updated if checks['CollectionMigrationUpdatedWithinStartupObservationWindow']else target[ui]
  modeled=[tuple(target)if row[ni]=='quality_patrols'else row for row in original];checks['AllCollectionRulesIDsDefinitionsExceptExactAppendAndUpdatedIdentical']=hashes(modeled)==hashes(actual)
  expected['_collections']={'rows':len(modeled),'sha256':hashlib.sha256(''.join(hashes(modeled)).encode()).hexdigest(),'columnsSha256':digest(columns['_collections'][0])}
  mnames=[c[1]for c in columns['_migrations'][0]];need(mnames==['file','applied']);checks['MigrationColumnsUnchanged']=columns['_migrations'][0]==columns['_migrations'][1];mold=rows(old,'_migrations',mnames);mnew=rows(new,'_migrations',mnames);added=[r for r in mnew if r[0]==MIGRATION];need(not any(r[0]==MIGRATION for r in mold));applied=added[0][1]if len(added)==1 else None
  checks['OneMigrationLedgerEntryAppliedWithinStartupObservationWindow']=len(added)==1 and type(applied)is int and micros(lower)<=applied<=micros(upper)
  modeled_migrations=mold+added if checks['OneMigrationLedgerEntryAppliedWithinStartupObservationWindow']else mold;checks['MigrationLedgerOnlyExpectedAddition']=hashes(modeled_migrations)==hashes(mnew)
  expected['_migrations']={'rows':len(modeled_migrations),'sha256':hashlib.sha256(''.join(hashes(modeled_migrations)).encode()).hexdigest(),'columnsSha256':digest(columns['_migrations'][0])}
  planner={'present': 'sqlite_stat1'in a['tables'],'strictTypedIdentical':a['tables'].get('sqlite_stat1')==b['tables'].get('sqlite_stat1')}
  if planner['present']:
   cn=[c[1]for c in columns['sqlite_stat1'][0]];need(cn==['tbl','idx','stat']);checks['PlannerStatisticsColumnsUnchanged']=columns['sqlite_stat1'][0]==columns['sqlite_stat1'][1];prior=rows(old,'sqlite_stat1',cn);now=rows(new,'sqlite_stat1',cn)
   with contextlib.closing(sqlite3.connect(':memory:'))as model:
    model.execute(expected_sql);model.executemany('INSERT INTO quality_patrols('+','.join(map(q,patrol_old_names))+') VALUES('+','.join('?'for _ in patrol_old_names)+')',old_patrol)
    for key,row in sa.items():
     if row[0]=='index'and row[2]=='quality_patrols'and row[3]is not None:model.execute(row[3])
    model.execute('ANALYZE quality_patrols');computed=model.execute('SELECT tbl,idx,stat FROM sqlite_stat1').fetchall()
   before_quality={r[1]:r for r in prior if r[0]=='quality_patrols'};after_quality={r[1]:r for r in now if r[0]=='quality_patrols'};fresh={r[1]:r for r in computed};unique=len(before_quality)==sum(r[0]=='quality_patrols'for r in prior)and len(after_quality)==sum(r[0]=='quality_patrols'for r in now)
   allowed=unique and hashes([r for r in prior if r[0]!='quality_patrols'])==hashes([r for r in now if r[0]!='quality_patrols'])and all(row in (before_quality.get(key),fresh.get(key))for key,row in after_quality.items())and all(key in after_quality or key not in fresh for key in before_quality)
   checks['PlannerStatisticsOnlyExactQualityPatrolIndexRefresh']=allowed;planner.update(beforeRows=len(prior),afterRows=len(now),qualityPatrolBeforeRows=len(before_quality),qualityPatrolAfterRows=len(after_quality),computedIndexRows=len(fresh),onlyQualityPatrolExactCountRefresh=allowed)
   if allowed:expected['sqlite_stat1']=b['tables']['sqlite_stat1']
  checks['AllTypedTablesMatchExactlyModeledMigration']=expected==b['tables']
  return {'checks':checks,'allExpectedMigrationChecksPassed':all(checks.values()),'oldPatrolRows':len(old_patrol),'newPatrolRows':len(new_patrol_old),'unmodeledOtherTableDifferences':details,'rawStrictDataSnapshotIdentical':a==b,'plannerStatisticsClassification':planner,'migrationTimestampWindow':{'lowerInclusiveMillisecond':lower.isoformat(),'upperInclusive':upper.isoformat()},'compatibilityDoesNotIdentifyActor':True,'sourceSnapshotsWereReadOnly':True}
