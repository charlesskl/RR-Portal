"""Sealed metadata only: preserve the failed strict receipt and describe one sequence delta."""
import hashlib,importlib.util,json,os,pathlib,re,signal,stat,sys
ROOT=pathlib.Path('/opt/rr-portal');BRANCH='refs/heads/ops/internal-quote-957-20261019';PIN=True
BASE='1cff968ccd7edeb29a9aeb2eaf2c7ee140d4f584';TARGET='062b5d40441098f3e1e4ccdf44b9aca9d9d730c7';TREE='c8a9f953e0a1e6aec31e349d73abbad40adb421e'
BACKUPS=ROOT/'deploy/backups';OUT=BACKUPS/'internal-quote-957-20261019-sequence-supplement'
PINS=((BACKUPS/'internal-quote-957-20261019-backup','253ef8156e37d0b863d076dc22fc31b4b61ebeba748aaffff2b57cc9f0987c46','a3df7b00ff2c53d8fc790ddc358b6d6a79109595b27c3faec1c509d6f0d0788c','baseline.private.json'),(BACKUPS/'internal-quote-957-20261019-deploy','30a92c87513e32a5fa1d8b2b481111b6dd3e87b26ca2d441932f4db4d1af8da9','dc30967e3523c737421fe16b12415e8b7bb7a1ffc287d141f82a65914051443a',None),(BACKUPS/'internal-quote-957-20261019-verify','2c8fb0b2d5ad392fabd94d80b064f873e091981f96278abfeff42f8ffde899cd','cfb73b2b423226b4c7ab0f39b79b40fa6e87c802a6631d6b4b5cb0633fc431a9','observed.private.json'))
LIBRARY_SHA='d63168fd3057f4f2aba2d93f9fab31d2d65c6dd0f3234877d71fcff1e04e62b9'
STARTUP_SOURCE_SHA='c601e8f6e4c875dc816098d138e88cd9197f6642d37c416598686eec47563008'
STAGE='entry';L=None

def need(value):
 if not value:raise RuntimeError('INTERNAL_QUOTE_957_SEALED_SEQUENCE_REJECTED')
def enc(value):return json.dumps(value,sort_keys=True,ensure_ascii=True,separators=(',',':'),allow_nan=False).encode()
def sha(value):return hashlib.sha256(value).hexdigest()
def stable_read(path,limit):
 need(type(limit)is int and 0<limit<=32*1024**2);fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
 with os.fdopen(fd,'rb')as stream:
  before=os.fstat(stream.fileno());need(stat.S_ISREG(before.st_mode)and stat.S_IMODE(before.st_mode)==0o600 and before.st_size<=limit);raw=stream.read(limit+1);after=os.fstat(stream.fileno());fields=lambda s:(s.st_dev,s.st_ino,s.st_mode,s.st_size,s.st_mtime_ns,s.st_ctime_ns);need(fields(before)==fields(after)==fields(path.lstat())and len(raw)==before.st_size)
 return raw

def library():
 p=pathlib.Path(__file__).with_name('release-data-library.py');need(p.is_file()and not p.is_symlink()and sha(p.read_bytes())==LIBRARY_SHA);spec=importlib.util.spec_from_file_location('quote957_seal_only_library',p);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m

def sealed(path,msha,rsha,metadata):
 need(path.parent==BACKUPS and path.is_dir()and not path.is_symlink()and stat.S_IMODE(path.stat().st_mode)==0o700);raw=stable_read(path/'manifest.json',4*1024**2);need(sha(raw)==msha);manifest=json.loads(raw);need(type(manifest)is dict and len(manifest)<=50000 and all(L.safe_path(n)and re.fullmatch('[a-f0-9]{64}',h)for n,h in manifest.items())and manifest.get('first-result.json')==rsha)
 raw=stable_read(path/'first-result.json',1024**2);need(sha(raw)==rsha);receipt=json.loads(raw);value=None
 if metadata is not None:
  need(metadata in {'baseline.private.json','observed.private.json'});raw=stable_read(path/metadata,32*1024**2);need(sha(raw)==manifest.get(metadata));value=json.loads(raw)
 return value,receipt,{'manifestSHA256':msha,'resultSHA256':rsha,'metadataSHA256':manifest.get(metadata)if metadata else None}

def sequence_state(value):
 need(type(value)is dict and set(value)=={'lastValue','called'}and type(value['called'])is bool and type(value['lastValue'])is str and re.fullmatch('-?(?:0|[1-9][0-9]{0,19})',value['lastValue']));return int(value['lastValue'])

def compare(old,new):
 need(type(old)is dict and type(new)is dict and old.get('sequenceStateStableDuringCapture')is True and new.get('sequenceStateStableDuringCapture')is True and old['tables']==new['tables']and old['schema']==new['schema']);a,b=old['sequenceStates'],new['sequenceStates'];need(type(a)is dict and type(b)is dict and set(a)==set(b)and 0<len(a)<=200);definitions=old['schema']['sequences'];need(type(definitions)is list and len(definitions)==len(a)and all(type(row)is dict and type(row.get('name'))is str for row in definitions));by_name={row['name']:row for row in definitions};need(set(by_name)==set(a)and len(by_name)==len(definitions));changed=[]
 for name in sorted(a):
  need(re.fullmatch('[A-Za-z_][A-Za-z0-9_]{0,62}',name));before,after=sequence_state(a[name]),sequence_state(b[name]);definition=by_name[name];need(all(type(definition.get(k))is str and re.fullmatch('-?(?:0|[1-9][0-9]{0,19})',definition[k])for k in('min','max'))and int(definition['min'])<=before<=int(definition['max'])and int(definition['min'])<=after<=int(definition['max']))
  if a[name]!=b[name]:changed.append({'sequence':name,'beforeLastValue':a[name]['lastValue'],'afterLastValue':b[name]['lastValue'],'delta':str(after-before),'beforeCalled':a[name]['called'],'afterCalled':b[name]['called'],'counterNeverRegressed':after>=before,'calledFlagUnchanged':a[name]['called']==b[name]['called']})
 counts={name:old['tables'][name]['rows']for name in('quotes','departments','quote_sections')};need(all(type(v)is int and 0<=v<=2**63-1 for v in counts.values()));expected=counts['quotes']*counts['departments'];definition=by_name.get('quote_sections_id_seq',{});contract={'name':'quote_sections_id_seq','type':'integer','start':'1','increment':'1','min':'1','max':'2147483647','cache':'1','cycle':False,'ownedByTable':'quote_sections','ownedByColumn':'id','dependencyType':'i'};definition_matches=all(definition.get(k)==v for k,v in contract.items());only_expected=len(changed)==1 and changed[0]['sequence']=='quote_sections_id_seq';delta_matches=only_expected and int(changed[0]['delta'])==expected and expected>0;called_matches=only_expected and changed[0]['beforeCalled']is True and changed[0]['afterCalled']is True
 return {'sequenceCount':len(a),'changedSequenceCount':len(changed),'changedSequenceStates':changed,'allFullTypedBusinessRowsIdentical':True,'allSchemaAndSequenceDefinitionsIdentical':True,'bothSequenceCapturesIndependentlyBracketedStable':True,'sequenceValuesNotMVCCAtomic':True,'allCountersNeverRegressed':all(v['counterNeverRegressed']for v in changed),'onlyQuoteSectionsSequenceChanged':only_expected,'quoteSectionsIdentityDefinitionMatchesUnchangedStartupContract':definition_matches,'quoteSectionsBothCalledTrue':called_matches,'quoteCount':str(counts['quotes']),'departmentCount':str(counts['departments']),'quoteSectionRowCount':str(counts['quote_sections']),'startupInsertSelectCandidateRows':str(expected),'counterDeltaEqualsStartupInsertSelectCandidateRows':delta_matches,'compatibleWithExistingStartupConflictConsumption':bool(only_expected and definition_matches and delta_matches and called_matches)}

def supplement(result):
 global STAGE
 STAGE='sealed-backup-deploy-and-failed-verify';before,rb,sb=sealed(*PINS[0]);_,rd,sd=sealed(*PINS[1]);observed,rv,sv=sealed(*PINS[2]);need(before['head']==BASE and rb.get('success')is True and rb.get('backupComplete')is True and rd.get('success')is True and rd.get('target')==TARGET and rd.get('expectedTree')==TREE and rd.get('onlyInternalQuoteRebuilt')is True and rv.get('success')is False and rv.get('target')==TARGET and rv.get('expectedTree')==TREE and rv.get('deploymentVerified')is True and rv.get('changedTables')==[]and rv.get('changedTableCounts')=={}and rv.get('originalBusinessIdPreservationProven')is True and rv.get('requiresScopedRowInvestigation')is False)
 expected={'originalFullTypedRowsIdentical','fullSchemaAndSequenceDefinitionsIdentical','sequenceStateIdenticalNonMVCC','legacyLogicalSQLiteAndFilesIdentical','legacyPhysicalBytesAndPermissionsIdentical','uploadBytesAndPermissionsIdentical','runtimeAndAllNonQuoteContainersUnchanged','runtimeConfigurationMapsMatchOriginal'};need(type(rv.get('checks'))is dict and set(rv['checks'])==expected and rv['checks']['sequenceStateIdenticalNonMVCC']is False and all(v is True for k,v in rv['checks'].items()if k!='sequenceStateIdenticalNonMVCC'));need(observed['runtime']==rd['runtimeAfter']and observed['runtime']['others']==before['runtime']['others'])
 STAGE='exact-sealed-sequence-classification';report=compare(before['postgres'],observed['postgres']);result.update(report)
 STAGE='selected-input-seals-unchanged';need(sealed(*PINS[0])==(before,rb,sb)and sealed(*PINS[1])[1:]==(rd,sd)and sealed(*PINS[2])==(observed,rv,sv));L.private_write(OUT/'sealed-input-receipts.private.json',enc({'backup':sb,'deploy':sd,'strictVerification':sv}));result.update(completed=True,selectedMetadataSealsRevalidated=True,originalStrictReceiptRemainsFailed=True,originalStrictEqualityResult=False,successfulDeploymentReceiptPreserved=True,compatibleSourceCommit=TARGET,reviewedUnchangedStartupSourceSHA256=STARTUP_SOURCE_SHA,actualActorOrCauseProven=False,wholeArchiveBytesRevalidated=False,success=report['compatibleWithExistingStartupConflictConsumption']and report['allCountersNeverRegressed'])

def main():
 global L
 need(PIN and len(sys.argv)==2 and sys.argv[1]=='sequence-supplement'and os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_ATTEMPT')=='1');os.umask(0o077);L=library();OUT.mkdir(mode=0o700);signal.signal(signal.SIGTERM,lambda *_:need(False));signal.signal(signal.SIGALRM,lambda *_:need(False));signal.alarm(90)
 result={'mode':'sequence-supplement','success':False,'completed':False,'target':TARGET,'businessWritesPerformed':False,'liveDatabaseOrHTTPAccessPerformed':False,'credentialsOrBusinessRowsPrinted':False,'configurationOrContainersChanged':False,'originalArchivesModified':False,'automaticRollbackOrDataResetPerformed':False}
 try:supplement(result)
 except BaseException:result['failedStage']=STAGE
 finally:L.private_write(OUT/'first-result.json',enc(result));L.seal(OUT);print(enc(dict(result,manifestSHA256=L.file_hash(OUT/'manifest.json'),resultSHA256=L.file_hash(OUT/'first-result.json'))).decode(),flush=True)
 return 0 if result['success']else 1
if __name__=='__main__':
 try:code=main()
 except BaseException:print('{"success":false,"safeFailure":"INTERNAL_QUOTE_957_SEQUENCE_PREFLIGHT_FAILED"}',flush=True);code=1
 sys.exit(code)
