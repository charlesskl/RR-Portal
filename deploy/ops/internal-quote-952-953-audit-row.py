"""One audit row only: typed original rows, sealed observation, no actor assertion or writes."""
import hashlib,importlib.util,json,os,pathlib,re,signal,sys,time
ROOT=pathlib.Path('/opt/rr-portal/deploy/backups');PIN_FROZEN=True
BASE='85d2082c273d3df3e51b2e414855634c56c498dd';TARGET='593e7e35857a8f434362b7fb078a08870ac56299'
BACKUP=ROOT/'internal-quote-952-953-20261019-backup';VERIFY=ROOT/'internal-quote-952-953-20261019-verify'
PINS=((BACKUP,'3167ace441a10589644ced79e501993909a7c7be5d9f016de9de4a9f2761e00c','7021d496b60a21792f4f4e5a543a9a26c94d971e2ddf3f8236647ea49b549da8','baseline.private.json'),(VERIFY,'4b9cb92515963e2f942193e735cb8e64699d20f63318c123847abca09f19be29','b990ff30cda54548233978b2ad93d4625b155f6a9fdd5935bb0050f72bc12b16','observed.private.json'))
PURE_SHA='6fbe7f73b085130e51716992725a5ccc8ba4a2037fbd254c6f131c5b78f0e0d9'
START='2026-10-19T09:30:36+00:00';END='2026-10-19T09:39:01+00:00'
STAGE='preflight'
def need(v):
 if not v:raise RuntimeError('SINGLE_AUDIT_ROW_REJECTED')
def load():
 p=pathlib.Path(__file__).with_name('release-pg-row-library.py');need(p.is_file()and not p.is_symlink()and hashlib.sha256(p.read_bytes()).hexdigest()==PURE_SHA)
 spec=importlib.util.spec_from_file_location('reviewed_pg_pure',p);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
def sealed(m,p,msha,rsha,name):
 need(p.is_dir()and not p.is_symlink()and p.stat().st_mode&0o777==0o700)
 raw=m.stable_read(p/'manifest.json',4*1024**2);need(m.sha(raw)==msha);manifest=m.parsed(raw);need(manifest.get('first-result.json')==rsha)
 raw=m.stable_read(p/'first-result.json',1024**2);need(m.sha(raw)==rsha);receipt=m.parsed(raw)
 raw=m.stable_read(p/name,32*1024**2);need(m.sha(raw)==manifest.get(name));return m.parsed(raw),receipt,manifest
def sequences(old,new):
 need(type(old)is dict and type(new)is dict and set(old)==set(new)and len(old)<=200)
 result=[]
 for name in sorted(old):
  need(re.fullmatch('[A-Za-z_][A-Za-z0-9_]{0,100}',name));a,b=old[name],new[name]
  need(all(type(v)is dict and set(v)=={'lastValue','called'}and type(v['called'])is bool and type(v['lastValue'])is str and re.fullmatch('-?[0-9]{1,20}',v['lastValue'])for v in(a,b)))
  if a!=b:result.append({'sequence':name,'neverRegressed':int(b['lastValue'])>=int(a['lastValue'])})
 return result
def main():
 global STAGE
 need(PIN_FROZEN and os.environ.get('RELEASE_REF')=='refs/heads/ops/release-progress-v4-20261019'and os.environ.get('RELEASE_ATTEMPT')=='1'and os.environ.get('RELEASE_MODE')=='quote-audit-row')
 m=load();m.DEADLINE=time.monotonic()+105;m.TABLES={'internal_quote':('audit_log',)};m.ACTIONS={'login','export','export_department','export_vq','other'};m.WINDOW_START=START;m.WINDOW_END=END
 def stop(*_):need(False)
 signal.signal(signal.SIGALRM,stop);signal.signal(signal.SIGTERM,stop);signal.alarm(108)
 STAGE='sealed-inputs';before,rb,manifest=sealed(m,*PINS[0]);observed,rv,_=sealed(m,*PINS[1])
 need(before['head']==BASE and rb.get('success')is True and rb.get('backupComplete')is True and rv.get('success')is False and rv.get('target')==TARGET and rv.get('changedTables')==['audit_log'])
 old=before['postgres'];verified=observed['postgres'];need(old.get('sequenceStateStableDuringCapture')is True and verified.get('sequenceStateStableDuringCapture')is True and old['tables']['audit_log']['rows']==3185 and verified['tables']['audit_log']['rows']==3186)
 cid=before['runtime']['databaseContainer'];need(re.fullmatch('[a-f0-9]{64}',cid)and observed['runtime']['databaseContainer']==cid)
 STAGE='sealed-data-only-copy';raw=m.restore_copy(BACKUP/'internal_quote.dump',manifest.get('internal_quote.dump'),cid,'internal_quote',('audit_log',));block=m.copy_blocks(raw,'internal_quote')['audit_log'];del raw
 snapshot={'postgres':{'internal_quote':old}};cols=m.table_columns(snapshot,'internal_quote','audit_log');s=None
 try:
  STAGE='read-only-current-snapshot';s=m.Session(cid);need(s.ask("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SET LOCAL statement_timeout='20s'; SET LOCAL lock_timeout='2s'; SET LOCAL TimeZone='UTC'; SET LOCAL DateStyle='ISO, YMD'; SELECT jsonb_build_object('readOnly',current_setting('transaction_read_only'),'timezone',current_setting('TimeZone'));\n")=={'readOnly':'on','timezone':'UTC'})
  m.validate_current_columns(s,'internal_quote','audit_log',cols);accounts=[c for c in m.table_columns(snapshot,'internal_quote','users')if c['name']in {'username','display_name'}];need({c['name']for c in accounts}=={'username','display_name'});m.validate_current_columns(s,'internal_quote','users',accounts)
  report=m.safe_result(s.ask(m.query('internal_quote','audit_log',block,cols)),cols,old['tables']['audit_log'],verified['tables']['audit_log']);need(report['currentAggregateMatchesSealedVerification']and report['addedRows']==1 and report['removedRows']==0 and report['changedRows']==0)
  need(s.ask('COMMIT; SELECT to_jsonb(true);\n')is True);s.close();s=None
  STAGE='final-input-pins'
  for p,msha,rsha,name in PINS:sealed(m,p,msha,rsha,name)
  m.emit({'kind':'single-audit-row','completed':True,'original3185AuditRowsAllTypedIdentical':True,'exactlyOneNewAuditRow':True,'currentAggregateMatchesSealedObservation':True,'newAuditActions':report['newAuditActions'],'timeWindowUtc':{'start':START,'end':END},'sequenceStatesFromSealedMetadata':sequences(old['sequenceStates'],verified['sequenceStates']),'businessOrIdentityValuesPrinted':False,'writesOrRestoreExecuted':False,'wholeArchiveBytesRevalidated':False,'actorOrCauseProven':False,'timeAndAccountCompatibilityOnly':True,'originalStrictReceiptRemainsFailed':True})
 finally:
  if s is not None:s.close()
if __name__=='__main__':
 try:main()
 except BaseException:print(json.dumps({'completed':False,'safeFailure':'SINGLE_AUDIT_ROW_FAILED','stage':STAGE}),flush=True);sys.exit(1)
