"""One closed-evidence classification; never amend the failed acceptance result.
No live database, HTTP, mailbox, service signal or persistent write.
The only subprocesses are one fixed NGINX identity lookup and bounded log read.
Only aggregate counts, technical column names, action hashes and time bounds print.
"""
import collections,contextlib,datetime,hashlib,importlib.util,json,os,pathlib,re,sqlite3,stat,subprocess,sys
CLASSIFY_PIN=False
BRANCH='refs/heads/ops/batch-960-966-967-968-20261020'
ROOT=pathlib.Path('/opt/rr-portal/deploy/backups')
OLD=ROOT/'batch-960-966-967-968-20261020-backup-05'
VERIFY=ROOT/'batch-960-966-967-968-20261020-verify'
OLD_MANIFEST='4533352f7d160d95c78dce83741b81cca8f363c7d253b27959595a579e977794'
OLD_RESULT='bf36c36ffae529787564bccc74a7ef15140b3ff62cc46f09cf97008c51698ce0'
VERIFY_MANIFEST='3cab7cad38b856061a66f826b56380e6e6fbe748ebb77b6307c3fafff792ed5a'
VERIFY_RESULT='b4f736fdb385009591929ae3afb5a0c348ed7c6e6fcef6499b06b202c8947d66'
OBSERVATION_MANIFEST='3aef2fb6b01f354deaeb86f7c61579222c00399dc206c7ec1b65505901eac88c'
COMPARE_SHA='fbb6ed5498654e2e9e73a636d87ad95abe9bfbdb97b30f17a6c99600578bae8a'
LIB_SHA='d63168fd3057f4f2aba2d93f9fab31d2d65c6dd0f3234877d71fcff1e04e62b9'
TABLES=('ExportTemplates','MailContacts','MailSyncStates')
TIMES={'ExportTemplates':{'UpdatedAt'},'MailContacts':{'UpdatedAt'},'MailSyncStates':{'LastSuccessAt'}}
L=None;C=None

def need(value):
 if not value:raise RuntimeError('SEALED_VOYAGE_CLASSIFICATION_REJECTED')
def enc(value):return json.dumps(value,ensure_ascii=True,sort_keys=True,separators=(',',':'),allow_nan=False).encode()
def sha(value):return hashlib.sha256(value).hexdigest()
def safe_path(value):
 need(type(value)is str);p=pathlib.PurePosixPath(value)
 return bool(value)and not p.is_absolute()and str(p)==value and all(n not in{'','.','..'}for n in p.parts)and not any(ord(n)<32 for n in value)
def stable(path):
 s=path.lstat();return(s.st_dev,s.st_ino,s.st_mode,s.st_uid,s.st_gid,s.st_size,s.st_mtime_ns,s.st_ctime_ns)
def file_hash(path):
 with os.fdopen(os.open(path,os.O_RDONLY|os.O_NOFOLLOW),'rb')as stream:
  before=os.fstat(stream.fileno());need(stat.S_ISREG(before.st_mode)and before.st_size<=8*1024**3);h=hashlib.sha256()
  for block in iter(lambda:stream.read(1024*1024),b''):h.update(block)
  after=os.fstat(stream.fileno());need((before.st_dev,before.st_ino,before.st_size,before.st_mtime_ns,before.st_ctime_ns)==(after.st_dev,after.st_ino,after.st_size,after.st_mtime_ns,after.st_ctime_ns))
 return h.hexdigest()
def read_json(path):
 need(path.is_file()and not path.is_symlink()and path.stat().st_size<=128*1024**2);before=stable(path);data=path.read_bytes();need(before==stable(path));return json.loads(data)
def seal(path,manifest_sha,result_sha=None):
 need(path.is_absolute()and path.is_dir()and not path.is_symlink()and stat.S_IMODE(path.stat().st_mode)==0o700)
 for parent in path.parents:need(not parent.is_symlink())
 need(file_hash(path/'manifest.json')==manifest_sha)
 if result_sha:need(file_hash(path/'first-result.json')==result_sha)
 manifest=read_json(path/'manifest.json');need(type(manifest)is dict and len(manifest)<=100000)
 entries=list(path.rglob('*'));need(len(entries)<=100000 and all(not p.is_symlink()and(p.is_file()or p.is_dir())and p.stat().st_mode&0o077==0 for p in entries))
 need(set(manifest)=={str(p.relative_to(path))for p in entries if p.is_file()and p!=path/'manifest.json'})
 need(all(safe_path(name)and type(checksum)is str and re.fullmatch('[a-f0-9]{64}',checksum)and file_hash(path/name)==checksum for name,checksum in manifest.items()))
 return manifest
def load(name,checksum):
 path=pathlib.Path(__file__).with_name(name);need(path.is_file()and not path.is_symlink()and file_hash(path)==checksum)
 spec=importlib.util.spec_from_file_location('closed_'+name.replace('.','_'),path);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module
def closed_db(root):
 path=root/'voyageplex-data/sqlite/voyageplex.db';need(path.is_file()and not path.is_symlink()and stat.S_IMODE(path.stat().st_mode)==0o600)
 for parent in path.parents:
  need(not parent.is_symlink())
  if parent==root:break
 need(not any(path.with_name(path.name+s).exists()for s in('-wal','-shm','-journal')));return path

def expected_startup(old,new,start,end):
 """Replay exactly the existing failed comparator's permitted changes in memory."""
 expected=sqlite3.connect(':memory:')
 try:
  old.backup(expected);C._catalogue(expected)
  old_ids={r['Id']for r in C._rows(old,'ExportTemplates')};observed={r['Id']:r for r in C._rows(new,'ExportTemplates')}
  for row in C._rows(expected,'ExportTemplates'):
   if row['Id']not in old_ids:
    value=observed.get(row['Id'],{}).get('UpdatedAt');need(C._between(value,start,end));expected.execute('UPDATE ExportTemplates SET UpdatedAt=? WHERE Id=?',(value,row['Id']))
  existed=old.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='VoyagePlexSchemaChanges'").fetchone()
  existed=existed and old.execute('SELECT 1 FROM VoyagePlexSchemaChanges WHERE Name=?',(C.MARKER,)).fetchone()
  if not existed:
   marker=new.execute('SELECT AppliedAt FROM VoyagePlexSchemaChanges WHERE Name=?',(C.MARKER,)).fetchone();need(marker and C._between(marker[0],start,end));expected.execute('UPDATE VoyagePlexSchemaChanges SET AppliedAt=? WHERE Name=?',(marker[0],C.MARKER))
  setting=old.execute('SELECT StartDate FROM MailSystemSettings WHERE Id=1').fetchone();need(setting is not None)
  groups=collections.Counter(C._sender(r[0])for r in old.execute("SELECT MailSender FROM ImportEmailItems WHERE Company='Xingxin' AND MailboxKey<>'' AND MailReceivedDate>=?",(setting[0],)));groups.pop('',None)
  current={r['Id']:r for r in C._rows(new,'MailContacts')}
  for row in C._rows(old,'MailContacts'):
   if row.get('Company')=='Xingxin'and str(row.get('Email')or'').lower()in groups:
    observed_row=current.get(row['Id'])
    if observed_row and observed_row.get('UpdatedAt')!=row.get('UpdatedAt')and C._between(observed_row.get('UpdatedAt'),start,end):expected.execute('UPDATE MailContacts SET UpdatedAt=? WHERE Id=?',(observed_row['UpdatedAt'],row['Id']))
  expected.commit();return expected,groups
 except BaseException:expected.close();raise

def table_rows(db,table):
 columns=[r[1]for r in db.execute('PRAGMA table_xinfo('+C._quote(table)+')')];need(columns and len(columns)<=100 and all(re.fullmatch('[A-Za-z][A-Za-z0-9_]{0,79}',n)for n in columns))
 rows=C._rows(db,table);need(len(rows)<=100000 and all('Id'in r for r in rows));key=lambda r:enc(L.cell(r['Id']));result={key(r):r for r in rows};need(len(result)==len(rows));return columns,result
def typed_row(row,columns):return None if row is None else[L.cell(row[n])for n in columns]
def time_bounds(rows,column,start,end):
 parsed=[];invalid=empty=0
 for row in rows:
  value=row.get(column)
  if value is None or value=='':empty+=1;continue
  try:parsed.append(C._time(value))
  except Exception:invalid+=1
 return {'parsedCount':len(parsed),'emptyCount':empty,'invalidCount':invalid,'minimumUTC':min(parsed).isoformat()if parsed else None,'maximumUTC':max(parsed).isoformat()if parsed else None,'beforeApiStartupCount':sum(t<start for t in parsed),'withinApiStartupToObservationCount':sum(start<=t<=end for t in parsed),'afterObservationCount':sum(t>end for t in parsed)}
def classify_table(left,right,table,start,end):
 columns,a=table_rows(left,table);other,b=table_rows(right,table);need(columns==other);counts=collections.Counter();groups=collections.Counter();actions=[];old_changed=[];new_changed=[];updates=inserts=deletes=0
 for key in sorted(set(a)|set(b)):
  x,y=a.get(key),b.get(key)
  if typed_row(x,columns)==typed_row(y,columns):continue
  changed=[n for n in columns if x is None or y is None or L.cell(x[n])!=L.cell(y[n])]
  action='insert'if x is None else'delete'if y is None else'update';inserts+=action=='insert';deletes+=action=='delete';updates+=action=='update'
  counts.update(changed);groups[tuple(changed)]+=1
  actions.append(sha(enc([action,typed_row(x,columns),typed_row(y,columns)])))
  if x is not None:old_changed.append(x)
  if y is not None:new_changed.append(y)
 return {'oldRowCount':len(a),'newRowCount':len(b),'changedRowCount':updates+inserts+deletes,'updatedRows':updates,'insertedRows':inserts,'deletedRows':deletes,'changedColumnRowCounts':dict(sorted(counts.items())),'changedColumnGroups':[{'columns':list(k),'rowCount':v}for k,v in sorted(groups.items())],'typedActionSetSHA256':sha(enc(sorted(actions))),'timestampBounds':{n:{'oldChangedRows':time_bounds(old_changed,n,start,end),'newChangedRows':time_bounds(new_changed,n,start,end)}for n in sorted(TIMES[table])if n in columns}}

def existing_contact_startup_model(expected,groups):
 """Separate diagnostic hypothesis from unchanged failed acceptance comparator."""
 modeled=sqlite3.connect(':memory:');expected.backup(modeled);counts=collections.Counter()
 for row in C._rows(expected,'MailContacts'):
  email=str(row.get('Email')or'');key=email.lower()
  if row.get('Company')!='Xingxin'or key not in groups:continue
  counts['eligibleExistingRows']+=1
  if row.get('MessageCount')!=groups[key]:counts['expectedMessageCountChanges']+=1
  modeled.execute('UPDATE MailContacts SET MessageCount=? WHERE Id=?',(groups[key],row['Id']))
  internal='@'in email and email.rsplit('@',1)[1].strip().lower()in{'hanson2.com','royalregent.net'}
  if internal:
   if row.get('ContactType')!='Internal':counts['expectedInternalContactTypeChanges']+=1
   if row.get('IsConfirmed')!=1:counts['expectedInternalConfirmationChanges']+=1
   modeled.execute("UPDATE MailContacts SET ContactType='Internal',IsConfirmed=1 WHERE Id=?",(row['Id'],))
 modeled.commit();return modeled,dict(counts)

def classify(old,new,old_audit,new_audit,start,end):
 original=C.compare_voyageplex(pathlib.Path(old),pathlib.Path(new),old_audit,new_audit,L,start.isoformat(),end.isoformat())
 need(original['checks'].get('closedInputAuditsMatchMetadata')is True and original['checks'].get('exactDeclaredSchemaObjectsAndSql')is True)
 with contextlib.closing(L.connect(old,True))as a,contextlib.closing(L.connect(new,True))as b:
  need(L.audit(a)==old_audit and L.audit(b)==new_audit)
  expected,groups=expected_startup(a,b,start,end)
  with contextlib.closing(expected):
   expected_audit=L.audit(expected);need(expected_audit['schema']==new_audit['schema']and original['checks']['exactFullTypedRowsAfterOnlyDeclaredStartupChanges']==(expected_audit['tables']==new_audit['tables']))
   raw={n:classify_table(a,b,n,start,end)for n in TABLES};residual={n:classify_table(expected,b,n,start,end)for n in TABLES}
   modeled,counts=existing_contact_startup_model(expected,groups)
   with contextlib.closing(modeled):contact=classify_table(modeled,b,'MailContacts',start,end)
   _,old_state=table_rows(a,'MailSyncStates');_,new_state=table_rows(b,'MailSyncStates');samekeys=set(old_state)==set(new_state);non_error_equal=samekeys and all(all(L.cell(x[n])==L.cell(new_state[k][n])for n in x if n!='LastError')for k,x in old_state.items())
   failure_matches=sum(k in old_state and L.cell(old_state[k].get('LastError'))!=L.cell(r.get('LastError'))and r.get('LastError')=='邮箱同步失败，请检查邮箱设置或联系管理员'for k,r in new_state.items())
   cursor_fields={n:samekeys and all(n in x and n in new_state[k]and L.cell(x[n])==L.cell(new_state[k][n])for k,x in old_state.items())for n in('Address','MailboxIdentity','ConfigurationKey','UidValidity','LastUid')}
 return {'originalFailedAcceptancePassed':original['passed'],'originalComparisonChecks':original['checks'],'rawOldToObserved':raw,'sameDeclaredStartupExpectedToObserved':residual,'additionalExistingContactStartupRuleDiagnostic':{'candidateRuleSource':'Program.cs existing startup MessageCount/internal ContactType/IsConfirmed refresh','plannedChangeCounts':counts,'remainingMailContactDifferencesAfterThatRule':contact,'compatibleWithThatRuleOnly':contact['changedRowCount']==0,'causeOrActorProven':False},'mailSyncStateDiagnostic':{'sameExistingStateRowKeys':samekeys,'allFieldsExceptLastErrorTypedExact':non_error_equal,'cursorIdentityAndConfigurationTypedExact':cursor_fields,'changedLastErrorMatchesExistingGenericFailureLiteralRows':failure_matches,'causeOrActorProven':False},'failedAcceptanceResultAmended':False,'changesAttributedToOperatorOrDeployment':False}

LOG_SINCE='2026-10-20T06:59:00Z';LOG_UNTIL='2026-10-20T07:20:00Z'
def nginx_mutation_correlation():
 """Read only fixed nginx logs; never expose raw lines, targets or identifiers."""
 result={'windowStartUTC':LOG_SINCE,'windowEndUTC':LOG_UNTIL,'absenceOrTruncationIsInconclusive':True,'actorOrAuthenticationProven':False,'rawLogLinesOrRequestTargetsPrinted':False}
 try:
  found=subprocess.run(['docker','ps','--no-trunc','--filter','label=com.docker.compose.project=rr-portal','--filter','label=com.docker.compose.service=nginx','--format','{{.ID}}'],stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=45)
  need(found.returncode==0 and len(found.stdout)<=4096 and len(found.stderr)<=1024**2);ids=found.stdout.decode().split();need(len(ids)==1 and re.fullmatch('[a-f0-9]{64}',ids[0]))
  logs=subprocess.run(['docker','logs','--timestamps','--since',LOG_SINCE,'--until',LOG_UNTIL,'--tail','50000',ids[0]],stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=45)
  need(logs.returncode==0 and len(logs.stdout)+len(logs.stderr)<=32*1024**2);lines=(logs.stdout+b'\n'+logs.stderr).splitlines();counts=collections.Counter();times=[];unparsed=0;start,end=C._time(LOG_SINCE),C._time(LOG_UNTIL)
  for raw in lines:
   line=raw.decode('utf-8','replace');match=re.search(r'"(POST|PUT|PATCH|DELETE) ([^ ]+) HTTP/[0-9.]+" ([0-9]{3})(?: |$)',line)
   if not match:continue
   method,target,status=match.groups();target=target.split('?',1)[0]
   if not re.fullmatch(r'/voyageplex/api/export-templates(?:/[0-9]{1,20})?',target)or not 200<=int(status)<300:continue
   stamp=re.match(r'([0-9]{4}-[0-9]{2}-[0-9]{2}T[^ ]+)',line)
   try:
    value=C._time(stamp.group(1));need(start<=value<=end)
   except Exception:unparsed+=1;continue
   counts[(method,int(status))]+=1;times.append(value.isoformat())
  unique=sorted(set(times));result.update(logReadSucceeded=True,tailMayBeTruncated=len(lines)>=50000,successfulMutationCount=sum(counts.values()),methodStatusCounts=[{'method':k[0],'status':k[1],'count':v}for k,v in sorted(counts.items())],matchingRequestTimestampsUTC=unique[:256],timestampListTruncated=len(unique)>256,matchedRequestTimestampParseFailures=unparsed,requestPresenceProvesActor=False)
 except Exception:result.update(logReadSucceeded=False,classificationUnavailableOrBoundedReadRejected=True)
 return result

def main():
 global L,C
 need(CLASSIFY_PIN and sys.argv[1:]==['classify']and os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_ATTEMPT')=='1')
 L=load('release-data-library.py',LIB_SHA);C=load('batch-voyageplex-sqlite-compat.py',COMPARE_SHA)
 oldseal=seal(OLD,OLD_MANIFEST,OLD_RESULT);verifyseal=seal(VERIFY,VERIFY_MANIFEST,VERIFY_RESULT);observation=VERIFY/'observation';obsseal=seal(observation,OBSERVATION_MANIFEST)
 first=read_json(OLD/'first-result.json');failed=read_json(VERIFY/'first-result.json');need(first.get('success')is True and failed.get('success')is False and failed.get('observationManifestSHA256')==OBSERVATION_MANIFEST)
 before=read_json(OLD/'baseline.private.json');observed=read_json(observation/'observed.private.json');need(before['head']=='4f1f64cac098caa6b202eb27cae9ab8fad9109dd'and observed['head']=='b30a803e74641e0e18150597e0114f6cb99b2e9c')
 old,new=closed_db(OLD),closed_db(observation);start=C._time(observed['runtime']['targets']['voyageplex-api']['started']);end=C._time(observed['capturedAtUTC']);need(start<=end)
 output=classify(old,new,before['storage']['voyageplex-data']['sqlite']['voyageplex.db'],observed['storage']['voyageplex-data']['sqlite']['voyageplex.db'],start,end)
 logs=nginx_mutation_correlation()if output['sameDeclaredStartupExpectedToObserved']['ExportTemplates']['changedRowCount']else{'notReadBecauseDeclaredStartupExplainsAllTemplateRows':True,'actorOrAuthenticationProven':False}
 need(seal(OLD,OLD_MANIFEST,OLD_RESULT)==oldseal and seal(VERIFY,VERIFY_MANIFEST,VERIFY_RESULT)==verifyseal and seal(observation,OBSERVATION_MANIFEST)==obsseal)
 result={'success':True,'mode':'sealed-voyage-difference-classification','sourceHead':C.SOURCE_HEAD,'allThreeFullSealsVerifiedBeforeAndAfter':True,'apiStartupUTC':start.isoformat(),'observedCapturedAtUTC':end.isoformat(),'classification':output,'fixedNginxMutationCorrelation':logs,'onlyClosedImmutableInputDatabasesOpened':True,'persistentFilesOrRowsWritten':False,'businessValuesNamesAddressesCredentialsOrRowIdsPrinted':False,'noActorClaim':True};content=enc(result);need(len(content)<=24000);print(content.decode(),flush=True)
if __name__=='__main__':
 try:main()
 except BaseException:print('{"success":false,"safeFailure":"SEALED_VOYAGE_CLASSIFICATION_REJECTED"}',flush=True);sys.exit(1)
