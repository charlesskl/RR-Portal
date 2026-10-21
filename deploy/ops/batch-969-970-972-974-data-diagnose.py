"""Fixed sealed archives only: no live DB, network, process or maintenance access."""
import collections,contextlib,datetime,hashlib,importlib.util,json,os,pathlib,re,signal,sys,traceback
ROOT=pathlib.Path('/opt/rr-portal');BRANCH='refs/heads/ops/batch-969-970-972-974-20261021';DIAG_PIN=False
TARGET='dfcdf751cae42fdd1731729dd662fce041c28caf';TREE='d5a107e898fe35066416fa0431ccd92400467875';RELEASE_SHA='2db18fac4f09a6dc4ae64c07fc248e9cd575ed5e06eebabc77de58e1584254e7'
PREFIX=ROOT/'deploy/backups';OUT=PREFIX/'batch-969-970-972-974-20261021-data-diagnose-01';R=None;STAGE='entrypoint'
ARCHIVES={
 'backup':('backup-02','5b5e544aa5fa2849ca7e2dc5583c803b694a214b7d2d1b8c818fe349bcdfb8f5','5e6316717fb94d3b324e9071cbfa6fcfeedd03e8d484dc348882f6cde7db9afd'),
 'partial':('deploy-03','964efbf2e6f32bdd7355c00db59a8cd7d06e58c523fef31f4aa72ec2dfadd109','d280456999159e3dc7482fc8fdc4878deb63e11fd566e9e2c39f279689b4a98e'),
 'restore':('toy-restore-01','931e6d491d7533226c8bfbcade43ea873bcfe47900c45e193c5ee91f75a35461','cf2e68e76cf3a8d99c232edd178e8fe982f37ab414ad707fb567353282619b8b'),
 'continue':('continue-01','ba7fb928889f3f9ec57c5d08641a6449cd26b817ffecc9c3a28f00b758c56fdd','b15713cfb33f833da44d7017ae421da35ff98ed6c08b1c10da0ae3c818490113'),
 'verify':('verify-01','b74c850376ea429fe9d30f692f7dc649859eed95ef266bad1edb0d20232b3465','1d5fdb92ce63c9911fc6579a61a4fe047ccd4b9539d6d9a4397a82dc3282725b')}
OBSERVATION_SHA='8e77f587efc4ca92799fa7cff6ac4ef48a892e9ec2a05e59e9da5464c526b66e'
EXPECTED_FAILED={'qc-report-data.qc-report.db.allTypedRowsAndSchema','toyqms.toyqms.db.allTypedRowsAndSchema','indo_shipping.allSequenceValuesExact'}
JSON_KEYS={'id','name','username','displayName','email','role','category','permissions','createdAt','updatedAt','passwordHash','password','active','isActive','loginName','enabled','mustChangePassword','passwordSalt','responsibility','isPrimary'}
ACTIONS={'login','logout','sso_login','login_success','sso_login_success','enter_app'}

def need(v):
 if not v:raise RuntimeError('SEALED_DATA_DIAGNOSIS_REJECTED')
def enc(v):return json.dumps(v,ensure_ascii=True,sort_keys=True,separators=(',',':'),allow_nan=False).encode()
def name(v):return v if type(v)is str and re.fullmatch('[A-Za-z_][A-Za-z0-9_]{0,79}',v)else'identifier_omitted'
def directory(key):return PREFIX/('batch-969-970-972-974-20261021-'+ARCHIVES[key][0])
def seals():
 receipts={}
 for key,(_,manifest,result)in ARCHIVES.items():
  path=directory(key);need(R.observation_archive(path)==manifest and R.CORE.OPS.L.file_hash(path/'first-result.json')==result);value=R.read_json(path/'first-result.json');need(value.get('target',TARGET)==TARGET and value.get('tree',TREE)==TREE)
  if key=='verify':need(value.get('success')is False and value.get('mode')=='verify'and value.get('passedChecks')==38 and value.get('totalChecks')==41 and set(value.get('failedCheckNames',[]))==EXPECTED_FAILED and value.get('rawObservationSealedBeforeComparison')is True)
  elif key=='partial':need(value.get('success')is False and value.get('failedStage')=='toyqms-fixed-image-recreate'and value.get('failedCheck')=='complete-hostconfig-mounts')
  else:need(value.get('success')is True)
  receipts[key]=value
 need(R.observation_archive(directory('verify')/'observation')==OBSERVATION_SHA);return receipts

def time_value(v):
 if type(v)is str and re.fullmatch(r'20[0-9]{2}-[01][0-9]-[0-3][0-9][T ][0-2][0-9]:[0-5][0-9]:[0-5][0-9](?:\.[0-9]{1,7})?(?:Z|[+-][0-2][0-9]:[0-5][0-9])?',v):
  try:datetime.datetime.fromisoformat(v.replace('Z','+00:00'));return v
  except ValueError:return None
 if type(v)in(int,float):
  scale=1000 if v>100000000000 else 1
  if 1577836800<=v/scale<=2082758400:return datetime.datetime.fromtimestamp(v/scale,datetime.timezone.utc).isoformat()
 return None

def temporal(column,values):
 if not re.fullmatch(r'(?:created_at|updated_at|expires_at|createdAt|updatedAt|expiresAt|created|expires|last_login_at|lastLoginAt|timestamp|time)',column):return None
 values=[x for v in values if(x:=time_value(v))is not None];return {'minimumStoredTimestamp':min(values),'maximumStoredTimestamp':max(values),'recognizedValueCount':len(values)}if values else None

def row_summary(a,b,cols,pk):
 typed=lambda row:enc([R.CORE.OPS.L.cell(v)for v in row]);oldkeys=[typed(tuple(row[i]for i in pk))for row in a];newkeys=[typed(tuple(row[i]for i in pk))for row in b];keyed=bool(pk)and len(set(oldkeys))==len(a)and len(set(newkeys))==len(b)and all(all(row[i]is not None for i in pk)for row in a+b);changes=collections.Counter();pairs=[]
 if keyed:
  old=dict(zip(oldkeys,a));new=dict(zip(newkeys,b));deleted=[old[k]for k in old.keys()-new.keys()];inserted=[new[k]for k in new.keys()-old.keys()];pairs=[(old[k],new[k])for k in old.keys()&new.keys()if typed(old[k])!=typed(new[k])]
  for x,y in pairs:
   for i,c in enumerate(cols):
    if typed((x[i],))!=typed((y[i],)):changes[name(c)]+=1
 else:
  old=collections.Counter(map(typed,a));new=collections.Counter(map(typed,b));deleted=[None]*sum((old-new).values());inserted=[None]*sum((new-old).values())
 touched=[r for r in inserted+deleted if r is not None]+[r for pair in pairs for r in pair];result={'beforeRows':len(a),'afterRows':len(b),'primaryKeyMatchAvailable':keyed,'insertedRows':len(inserted),'deletedRows':len(deleted),'updatedRows':len(pairs)if keyed else None,'changedColumnRowCounts':dict(changes),'changedRowTimestampRanges':{name(c):v for i,c in enumerate(cols)if(v:=temporal(c,[r[i]for r in touched]))is not None}}
 if 'action'in cols:
  i=cols.index('action');counts=collections.Counter(r[i]if r[i]in ACTIONS else'unknown'for r in touched if type(r[i])is str);result['touchedRowsKnownActionCounts']=dict(counts)
 if 'data'in cols:
  i=cols.index('data');keys=collections.Counter();timestamps=collections.defaultdict(list);unknown=0;invalid=0
  for x,y in pairs:
   try:oldjson=json.loads(x[i]);newjson=json.loads(y[i]);need(type(oldjson)is dict and type(newjson)is dict)
   except(Exception):invalid+=1;continue
   for key in set(oldjson)|set(newjson):
    if(key in oldjson)!=(key in newjson)or enc(oldjson.get(key))!=enc(newjson.get(key)):
     if key in JSON_KEYS:keys[key]+=1;timestamps[key].extend([oldjson.get(key),newjson.get(key)])
     else:unknown+=1
  result['dataJSONChangedKeyRowCounts']=dict(keys);result['dataJSONUnrecognizedChangedKeyCount']=unknown;result['dataJSONUnparsedUpdatedRows']=invalid;result['dataJSONPermissionsChanged']=keys['permissions']>0;result['dataJSONTimestampRanges']={k:v for k,values in timestamps.items()if(v:=temporal(k,values))is not None}
 return result

def sqlite_difference(oldpath,newpath):
 need(oldpath.is_file()and newpath.is_file()and not oldpath.is_symlink()and not newpath.is_symlink())
 with contextlib.closing(R.CORE.OPS.L.connect(oldpath,True))as old,contextlib.closing(R.CORE.OPS.L.connect(newpath,True))as new:
  schemas=[db.execute('SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name').fetchall()for db in(old,new)];tables=[{r[1]for r in schema if r[0]=='table'}for schema in schemas];result={'allSchemaExact':schemas[0]==schemas[1],'beforeTableCount':len(tables[0]),'afterTableCount':len(tables[1]),'tables':{}}
  need(len(tables[0]|tables[1])<=200)
  for table in sorted(tables[0]|tables[1]):
   info=[db.execute('PRAGMA table_xinfo('+R.CORE.OPS.L.quote(table)+')').fetchall()if table in names else[]for db,names in zip((old,new),tables)];cols=[r[1]for r in(info[0]or info[1])];need(cols and len(cols)<=300);rows=[db.execute('SELECT '+','.join(R.CORE.OPS.L.quote(c)for c in cols)+' FROM '+R.CORE.OPS.L.quote(table)).fetchall()if table in names and meta==(info[0]or info[1])else[]for db,names,meta in zip((old,new),tables,info)];need(all(len(x)<=200000 for x in rows));pk=[i for _,i in sorted((c[5],i)for i,c in enumerate(info[0]or info[1])if c[5])];summary=row_summary(*rows,cols,pk);summary['tableColumnsExact']=info[0]==info[1]
   if summary['insertedRows']or summary['deletedRows']or summary['updatedRows']or info[0]!=info[1]:result['tables'][name(table)]=summary
  return result

def sequence_difference(old,new):
 names=sorted(set(old['sequenceStates'])|set(new['sequenceStates']));out=[];need(len(names)<=200)
 for seq in names:
  a=old['sequenceStates'].get(seq);b=new['sequenceStates'].get(seq)
  if a==b:continue
  defs=[[r for r in data['schema']['sequences']if r['name']==seq]for data in(old,new)];need(a is not None and b is not None and all(len(v)==1 for v in defs));policies=[]
  for definition in(v[0]for v in defs):
   policy={k:int(definition[k])for k in('increment','cache','start','min','max')};policy.update(type=definition['type']if definition['type']in{'smallint','integer','bigint'}else'type_omitted',ownedByTable=name(definition.get('ownedByTable')),ownedByColumn=name(definition.get('ownedByColumn')),cycle=definition['cycle'],dependencyType=definition.get('dependencyType')if definition.get('dependencyType')in{'a','i',None}else'omitted');policies.append(policy)
  out.append({'sequence':name(seq),'oldValue':int(a['lastValue']),'newValue':int(b['lastValue']),'delta':int(b['lastValue'])-int(a['lastValue']),'oldCalled':a['called'],'newCalled':b['called'],'oldPolicy':policies[0],'newPolicy':policies[1],'wholeDefinitionUnchanged':defs[0]==defs[1],'ownerUnchanged':defs[0][0].get('owner')==defs[1][0].get('owner'),'aclUnchanged':defs[0][0].get('acl')==defs[1][0].get('acl')})
 return {'allTypedTablesExact':old['tables']==new['tables'],'allSchemaExact':old['schema']==new['schema'],'oldSequenceBracketStable':old['sequenceStateStableDuringCapture'],'newSequenceBracketStable':new['sequenceStateStableDuringCapture'],'totalSequenceCount':len(names),'unchangedSequenceCount':len(names)-len(out),'changedSequences':out,'legacyLowercaseUsersPresentBefore':'users'in old['tables'],'legacyLowercaseUsersBeforeRows':old['tables'].get('users',{}).get('rows',0),'legacyLowercaseUsersPresentAfter':'users'in new['tables'],'legacyLowercaseUsersAfterRows':new['tables'].get('users',{}).get('rows',0),'capitalUsersTypedUnchanged':old['tables'].get('Users')==new['tables'].get('Users'),'actualActorOrCauseProven':False}

def diagnose(result):
 global STAGE
 STAGE='complete-fixed-archive-seals';seals();verify=directory('verify')/'observation';partial=directory('partial');backup=directory('backup');restore=directory('restore')/'current-toy-storage';need(R.observation_archive(restore));observed=R.read_json(verify/'observed.private.json');R.closed_audits(verify,observed['storage']);summary={}
 for label,store,filename in [('qc-report','qc-report-data','qc-report.db'),('toyqms','toyqms','toyqms.db')]:
  pre=partial/('pre-switch-'+label);need(R.observation_archive(pre));prior=R.read_json(pre/'observed.private.json');R.closed_audits(pre,prior['storage']);path=lambda base:base/store/'sqlite'/filename;STAGE='closed-sqlite-'+label;summary[label]={'backupToPreSwitch':sqlite_difference(path(backup),path(pre)),'preSwitchToFinalObservation':sqlite_difference(path(pre),path(verify))}
  if label=='toyqms':summary[label]['restoredToFinalObservation']=sqlite_difference(path(restore),path(verify))
 STAGE='sealed-indo-sequence-difference';pre=directory('continue')/'pre-switch-indo-shipping';need(R.observation_archive(pre));pg=R.read_json(pre/'observed.private.json')['postgres']['indo_shipping'];summary['indo_shipping']=sequence_difference(pg,observed['postgres']['indo_shipping']);seals();R.CORE.OPS.L.private_write(OUT/'safe-difference-summary.private.json',enc(summary));result.update(success=True,diagnosisCompleteOnly=True,originalVerificationRemainsFailed=True,originalPassedChecks=38,originalTotalChecks=41,sealedArchiveDifferences=summary,allInputArchiveSealsPreserved=True,actualActorOrCauseProven=False)

def main():
 global R,STAGE
 need(DIAG_PIN and sys.argv[1:]==['diagnose']and os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_ATTEMPT')=='1');os.umask(0o077);p=pathlib.Path(__file__).with_name('batch-release-library.py');need(p.is_file()and not p.is_symlink()and hashlib.sha256(p.read_bytes()).hexdigest()==RELEASE_SHA);spec=importlib.util.spec_from_file_location('sealed_release',p);R=importlib.util.module_from_spec(spec);spec.loader.exec_module(R);R.OUT=OUT;R.CORE=R.load_core();need(R.TARGET==TARGET and R.TREE==TREE);OUT.mkdir(mode=0o700);signal.signal(signal.SIGALRM,lambda *_:need(False));signal.alarm(180);result={'mode':'diagnose','target':TARGET,'tree':TREE,'success':False,'liveDatabaseOrHTTPAccessPerformed':False,'containerOrServiceSignalsPerformed':False,'businessOrConfigurationWritesPerformed':False,'maintenanceModified':False,'secretBusinessValuesOrRowIdentifiersPrinted':False}
 try:diagnose(result)
 except BaseException:result.update(failedStage=STAGE,safeFailure='SEALED_DATA_DIAGNOSIS_REJECTED');R.CORE.OPS.L.private_write(OUT/'failure-traceback.private.txt',traceback.format_exc().encode())
 finally:R.CORE.OPS.L.private_write(OUT/'first-result.json',enc(result));R.CORE.OPS.L.seal(OUT);public=dict(result,manifestSHA256=R.CORE.OPS.L.file_hash(OUT/'manifest.json'),resultSHA256=R.CORE.OPS.L.file_hash(OUT/'first-result.json'));need(len(enc(public))<=32000);print(enc(public).decode(),flush=True)
 return 0 if result['success']else 1
if __name__=='__main__':
 try:code=main()
 except BaseException:print('{"success":false,"safeFailure":"SEALED_DATA_DIAGNOSIS_PREFLIGHT_REJECTED"}');code=1
 sys.exit(code)
