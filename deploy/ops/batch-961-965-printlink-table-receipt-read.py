"""Inspect only original and retained closed PrintLink SQLite copies; output counts, never values."""
import collections,contextlib,hashlib,importlib.util,json,os,pathlib,re,sys
PIN=True
BRANCH='refs/heads/ops/batch-961-965-20261020';RELEASE_SHA='f4f1ae32881efbdd35aa9bb36096d28c65e8f624bed0cd37f9099dd0c613a545'
VERIFY=pathlib.Path('/opt/rr-portal/deploy/backups/batch-961-965-20261020-verify-07');MANIFEST='014aba15d6e51888151805e7cfa2e35092ab297b33be70969a374dac5d3ec0d4';RESULT='8bb2dc492379c2c6df54d9b2b3893a4b1e0242c9e8d89a86aff04562c3919e91'
def need(value):
 if not value:raise RuntimeError('CLOSED_PRINTLINK_TABLE_RECEIPT_REJECTED')
def identifier(value):return type(value)is str and re.fullmatch('[A-Za-z_][A-Za-z0-9_]{0,100}',value)is not None


def safe_time_windows(db,table,columns,L):
 if table not in{'sessions','collector_events','collector_devices','collector_stations'}:return {}
 result={}
 for column in columns:
  if column not in{'expires','created','received','observed','last_seen'}:continue
  values=[r[0]for r in db.execute('SELECT '+L.quote(column)+' FROM '+L.quote(table)+' WHERE '+L.quote(column)+' IS NOT NULL')];numeric=all(type(v)is int and 0<=v<=4102444800000 for v in values);textual=all(type(v)is str and re.fullmatch(r'20[0-9]{2}-[0-9]{2}-[0-9]{2}[T ][0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,6})?(?:Z|[+-][0-9]{2}:[0-9]{2})?',v)for v in values)
  result[column]={'nonNullCount':len(values),'safeTimestampShape':'empty'if not values else'epochNumeric'if numeric else'ISOText'if textual else'otherRetainedPrivately','minimum':min(values)if values and(numeric or textual)else None,'maximum':max(values)if values and(numeric or textual)else None}
 return result

def table_differences(a,b,old,new,L):
 result=[];names=sorted(set(old['tables'])|set(new['tables']));need(len(names)<=256 and all(identifier(n)for n in names))
 for name in names:
  x=old['tables'].get(name);y=new['tables'].get(name)
  if x==y:continue
  oldschema=[r for r in old['schema']if r[2]==name];newschema=[r for r in new['schema']if r[2]==name];row={'table':name,'oldRows':x['rows']if x else None,'newRows':y['rows']if y else None,'wholeTypedTableHashEqual':x is not None and y is not None and x['sha256']==y['sha256'],'columnDefinitionsHashEqual':x is not None and y is not None and x['columnsSha256']==y['columnsSha256'],'schemaObjectsEqual':oldschema==newschema,'oldSchemaObjectsSHA256':L.digest(oldschema),'newSchemaObjectsSHA256':L.digest(newschema)};result.append(row)
  if x is None or y is None:continue
  ac=a.execute('PRAGMA table_xinfo('+L.quote(name)+')').fetchall();bc=b.execute('PRAGMA table_xinfo('+L.quote(name)+')').fetchall();an=[c[1]for c in ac];bn=[c[1]for c in bc];need(all(identifier(c)for c in an+bn));shared=[c for c in an if c in bn];row['addedColumnNames']=[c for c in bn if c not in an];row['removedColumnNames']=[c for c in an if c not in bn];row['safeOperationalTimeWindows']={'old':safe_time_windows(a,name,an,L),'new':safe_time_windows(b,name,bn,L)}
  if name=='sqlite_sequence':
   oldrows=a.execute('SELECT name,seq FROM sqlite_sequence ORDER BY name').fetchall();newrows=b.execute('SELECT name,seq FROM sqlite_sequence ORDER BY name').fetchall();need(all(identifier(n)and type(v)is int for n,v in oldrows+newrows));row['exactSequenceCounters']={'old':oldrows,'new':newrows};continue
  pk=[c[1]for c in sorted(ac,key=lambda c:c[5])if c[5]>0];pknew=[c[1]for c in sorted(bc,key=lambda c:c[5])if c[5]>0];row['primaryKeyColumnNames']=pk;oldrows=[list(r)for r in a.execute('SELECT '+','.join(L.quote(c)for c in shared)+' FROM '+L.quote(name))];newrows=[list(r)for r in b.execute('SELECT '+','.join(L.quote(c)for c in shared)+' FROM '+L.quote(name))]
  if pk and pk==pknew and all(c in shared for c in pk):
   positions=[shared.index(c)for c in pk];key=lambda values:L.encoded([L.cell(values[i])for i in positions]);am={key(r):r for r in oldrows};bm={key(r):r for r in newrows}
   if len(am)==len(oldrows)and len(bm)==len(newrows):
    joint=set(am)&set(bm);row.update(typedPrimaryKeyMatchingUsed=True,insertedIdentityCount=len(set(bm)-set(am)),removedIdentityCount=len(set(am)-set(bm)),retainedIdentityCount=len(joint),changedOriginalColumnCounts={c:sum(L.cell(am[k][i])!=L.cell(bm[k][i])for k in joint)for i,c in enumerate(shared)if any(L.cell(am[k][i])!=L.cell(bm[k][i])for k in joint)});continue
  oldset=collections.Counter(L.digest([L.cell(v)for v in r])for r in oldrows);newset=collections.Counter(L.digest([L.cell(v)for v in r])for r in newrows);row.update(typedPrimaryKeyMatchingUsed=False,removedTypedRowMultisetCount=sum((oldset-newset).values()),addedTypedRowMultisetCount=sum((newset-oldset).values()),changedOriginalColumnTypedMultisetCounts={c:{'removed':sum((collections.Counter(L.digest(L.cell(r[i]))for r in oldrows)-collections.Counter(L.digest(L.cell(r[i]))for r in newrows)).values()),'added':sum((collections.Counter(L.digest(L.cell(r[i]))for r in newrows)-collections.Counter(L.digest(L.cell(r[i]))for r in oldrows)).values())}for i,c in enumerate(shared)if collections.Counter(L.digest(L.cell(r[i]))for r in oldrows)!=collections.Counter(L.digest(L.cell(r[i]))for r in newrows)})
 return {'changedTables':result,'oldTableCount':len(old['tables']),'newTableCount':len(new['tables']),'exactTableInventory':set(old['tables'])==set(new['tables']),'sqliteSequencePresentOld':'sqlite_sequence'in old['tables'],'sqliteSequencePresentNew':'sqlite_sequence'in new['tables'],'rowValuesPrimaryKeysTokensUsernamesAndCredentialsPrinted':False,'actualActorOrCauseProven':False}

def main():
 need(len(sys.argv)==2 and sys.argv[1]=='diagnose'and PIN and os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_ATTEMPT')=='1');path=pathlib.Path(__file__).with_name('batch-961-965-release.py');need(path.is_file()and not path.is_symlink()and hashlib.sha256(path.read_bytes()).hexdigest()==RELEASE_SHA);spec=importlib.util.spec_from_file_location('printlink_table_reader_release06',path);R=importlib.util.module_from_spec(spec);spec.loader.exec_module(R);R.CORE=R.core_load();core=R.CORE;core.OPS=core.load('release-data-ops-library.py');core.OPS.L=core.OPS.load_library(pathlib.Path(__file__).with_name('release-data-library.py'));L=core.OPS.L;before=R.original();receipt=R.archive(VERIFY,MANIFEST,RESULT,False);need(receipt.get('mode')=='verify'and receipt.get('target')==R.TARGET and receipt.get('allSevenServiceObservationsComplete')is True);observed=json.loads(core.stable_environment_bytes(VERIFY/'observed.private.json'));relative='orders/printlink.sqlite';old=before['storage']['printlink-runtime']['sqlite'][relative];new=observed['storage']['printlink-runtime']['sqlite'][relative];paths=[root/'printlink-runtime/sqlite'/relative for root in(R.BACKUP,VERIFY)];hashes=[L.file_hash(p)for p in paths]
 with contextlib.ExitStack()as stack:
  a,b=[stack.enter_context(contextlib.closing(L.connect(p,True)))for p in paths];need(L.audit(a)==old and L.audit(b)==new);out=table_differences(a,b,old,new,L)
 need(hashes==[L.file_hash(p)for p in paths]);out.update(mode='printlink-closed-table-receipt',success=True,manifestSHA256=MANIFEST,resultSHA256=RESULT,closedCopyMetadataAuditsMatch=True,inputDatabaseBytesUnchanged=True,newLiveDatabaseCapturesOrRequestsPerformed=False);encoded=R.enc(out);need(len(encoded)<=24000);print(encoded.decode(),flush=True);return 0
if __name__=='__main__':
 try:code=main()
 except BaseException:print('{"success":false,"safeFailure":"CLOSED_PRINTLINK_TABLE_RECEIPT_PREFLIGHT_FAILED"}',flush=True);code=1
 sys.exit(code)
