"""Sealed metadata only: preserve the failed strict receipt and describe one sequence delta."""
import datetime,hashlib,importlib.util,json,os,pathlib,re,signal,stat,sys
ROOT=pathlib.Path('/opt/rr-portal');BRANCH='refs/heads/ops/internal-quote-959-20261020';PIN=False
BASE='32440d3f0891e52707ea89f8dfe72eabe9f62ad7';TARGET='';TREE=''
BACKUPS=ROOT/'deploy/backups';OUT=BACKUPS/'internal-quote-959-20261020-sequence-supplement'
PINS=tuple((BACKUPS/('internal-quote-959-20261020-'+mode),'','',metadata)for mode,metadata in [('backup','baseline.private.json'),('deploy',None),('verify','observed.private.json')])
LIBRARY_SHA='d63168fd3057f4f2aba2d93f9fab31d2d65c6dd0f3234877d71fcff1e04e62b9'
BASE_STARTUP_SOURCE_SHA='';TARGET_STARTUP_SOURCE_SHA='';STARTUP_CONFLICT_FRAGMENT_SHA='';EXPECTED_COSTING_JSON=''
STAGE='entry';L=None

def need(value):
 if not value:raise RuntimeError('INTERNAL_QUOTE_959_SEALED_SEQUENCE_REJECTED')
def enc(value):return json.dumps(value,sort_keys=True,ensure_ascii=True,separators=(',',':'),allow_nan=False).encode()
def sha(value):return hashlib.sha256(value).hexdigest()
def stable_read(path,limit):
 need(type(limit)is int and 0<limit<=32*1024**2);fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
 with os.fdopen(fd,'rb')as stream:
  before=os.fstat(stream.fileno());need(stat.S_ISREG(before.st_mode)and stat.S_IMODE(before.st_mode)==0o600 and before.st_size<=limit);raw=stream.read(limit+1);after=os.fstat(stream.fileno());fields=lambda s:(s.st_dev,s.st_ino,s.st_mode,s.st_size,s.st_mtime_ns,s.st_ctime_ns);need(fields(before)==fields(after)==fields(path.lstat())and len(raw)==before.st_size)
 return raw

def library():
 p=pathlib.Path(__file__).with_name('release-data-library.py');need(p.is_file()and not p.is_symlink()and sha(p.read_bytes())==LIBRARY_SHA);spec=importlib.util.spec_from_file_location('quote959_seal_only_library',p);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m

def sealed(path,msha,rsha,metadata):
 need(path.parent==BACKUPS and path.is_dir()and not path.is_symlink()and stat.S_IMODE(path.stat().st_mode)==0o700);raw=stable_read(path/'manifest.json',4*1024**2);need(sha(raw)==msha);manifest=json.loads(raw);need(type(manifest)is dict and len(manifest)<=50000 and all(L.safe_path(n)and re.fullmatch('[a-f0-9]{64}',h)for n,h in manifest.items())and manifest.get('first-result.json')==rsha)
 raw=stable_read(path/'first-result.json',1024**2);need(sha(raw)==rsha);receipt=json.loads(raw);value=None
 if metadata is not None:
  need(metadata in {'baseline.private.json','observed.private.json'});raw=stable_read(path/metadata,32*1024**2);need(sha(raw)==manifest.get(metadata));value=json.loads(raw)
 return value,receipt,{'manifestSHA256':msha,'resultSHA256':rsha,'metadataSHA256':manifest.get(metadata)if metadata else None}

def sequence_state(value):
 need(type(value)is dict and set(value)=={'lastValue','called'}and type(value['called'])is bool and type(value['lastValue'])is str and re.fullmatch('-?(?:0|[1-9][0-9]{0,19})',value['lastValue']));return int(value['lastValue'])

def full_table_metadata(v):
 need(type(v)is dict and set(v)<={'rows','sha256','originalColumnsSHA256','startupCostingBasisEvidence'}and {'rows','sha256','originalColumnsSHA256'}<=set(v))
 return{k:v[k]for k in ('rows','sha256','originalColumnsSHA256')}

def costing_seed_preservation(old,new):
 # Full old tables are never called identical after seed additions. Preserve
 # old candidate rows byte for byte, compare every noncandidate typed row,
 # and accept only exact default seed rows for the missing fixed keys.
 need(type(EXPECTED_COSTING_JSON)is str and bool(EXPECTED_COSTING_JSON));json.loads(EXPECTED_COSTING_JSON)
 a,b=old['tables']['factory_ref_tables'],new['tables']['factory_ref_tables']
 x,y=a['startupCostingBasisEvidence'],b['startupCostingBasisEvidence'];required={'nonSeedRows','seedRows','transactionTimestamp'}
 need(type(x)is dict and type(y)is dict and set(x)==set(y)==required)
 for z in(x,y):need(type(z['seedRows'])is list and len(z['seedRows'])<=2 and type(z['nonSeedRows'])is dict and set(z['nonSeedRows'])=={'rows','sha256','originalColumnsSHA256'})
 def stamp(v):
  need(type(v)is str);parsed=datetime.datetime.fromisoformat(v.replace('Z','+00:00'));need(parsed.utcoffset()is not None);return parsed
 start,end=stamp(x['transactionTimestamp']),stamp(y['transactionTimestamp']);need(start<=end)
 def rows(z):
  result={}
  for row in z['seedRows']:
   need(type(row)is dict and set(row)=={'factory_code','key','data_json','updated_at','updated_by'}and row['factory_code']in {'qingxi','heyuan'}and row['key']=='costing_basis'and row['factory_code']not in result);result[row['factory_code']]=row
  return result
 previous,current=rows(x),rows(y);oldrows=all(current.get(k)==v for k,v in previous.items());added=set(current)-set(previous);expected=set(('qingxi','heyuan'))-set(previous)
 valid=added==expected and all(current[k]['data_json']==EXPECTED_COSTING_JSON and current[k]['updated_by']=='[factory-seed]'and start<=stamp(current[k]['updated_at'])<=end for k in added)
 no_other_changed=set(old['tables'])==set(new['tables'])and all(full_table_metadata(old['tables'][n])==full_table_metadata(new['tables'][n])for n in old['tables']if n!='factory_ref_tables')
 projection=x['nonSeedRows']==y['nonSeedRows'];count_matches=b['rows']==a['rows']+len(added)
 preserved=oldrows and projection and no_other_changed and count_matches
 return {'allOriginalFullTypedRowsPreserved':preserved,'onlyExpectedCostingBasisSeedsInserted':valid and count_matches,'expectedCostingBasisSeedRowsAdded':len(added),'existingCostingBasisRowsUnchanged':oldrows,'nonCostingBasisReferenceRowsIdentical':projection}

def compare(old,new):
 need(type(old)is dict and type(new)is dict and old.get('sequenceStateStableDuringCapture')is True and new.get('sequenceStateStableDuringCapture')is True and old['schema']==new['schema']);seed_proof=costing_seed_preservation(old,new);need(seed_proof['allOriginalFullTypedRowsPreserved']and seed_proof['onlyExpectedCostingBasisSeedsInserted']);a,b=old['sequenceStates'],new['sequenceStates'];need(type(a)is dict and type(b)is dict and set(a)==set(b)and 0<len(a)<=200);definitions=old['schema']['sequences'];need(type(definitions)is list and len(definitions)==len(a)and all(type(row)is dict and type(row.get('name'))is str for row in definitions));by_name={row['name']:row for row in definitions};need(set(by_name)==set(a)and len(by_name)==len(definitions));changed=[]
 for name in sorted(a):
  need(re.fullmatch('[A-Za-z_][A-Za-z0-9_]{0,62}',name));before,after=sequence_state(a[name]),sequence_state(b[name]);definition=by_name[name];need(all(type(definition.get(k))is str and re.fullmatch('-?(?:0|[1-9][0-9]{0,19})',definition[k])for k in('min','max'))and int(definition['min'])<=before<=int(definition['max'])and int(definition['min'])<=after<=int(definition['max']))
  if a[name]!=b[name]:changed.append({'sequence':name,'beforeLastValue':a[name]['lastValue'],'afterLastValue':b[name]['lastValue'],'delta':str(after-before),'beforeCalled':a[name]['called'],'afterCalled':b[name]['called'],'counterNeverRegressed':after>=before,'calledFlagUnchanged':a[name]['called']==b[name]['called']})
 counts={name:old['tables'][name]['rows']for name in('quotes','departments','quote_sections')};need(all(type(v)is int and 0<=v<=2**63-1 for v in counts.values()));expected=counts['quotes']*counts['departments'];definition=by_name.get('quote_sections_id_seq',{});contract={'name':'quote_sections_id_seq','type':'integer','start':'1','increment':'1','min':'1','max':'2147483647','cache':'1','cycle':False,'ownedByTable':'quote_sections','ownedByColumn':'id','dependencyType':'i'};definition_matches=all(definition.get(k)==v for k,v in contract.items());only_expected=len(changed)==1 and changed[0]['sequence']=='quote_sections_id_seq';delta_matches=only_expected and int(changed[0]['delta'])==expected and expected>0;called_matches=only_expected and changed[0]['beforeCalled']is True and changed[0]['afterCalled']is True
 return {'sequenceCount':len(a),'changedSequenceCount':len(changed),'changedSequenceStates':changed,**seed_proof,'allFullTypedBusinessRowsIdentical':all(full_table_metadata(old['tables'][n])==full_table_metadata(new['tables'][n])for n in old['tables']),'allSchemaAndSequenceDefinitionsIdentical':True,'bothSequenceCapturesIndependentlyBracketedStable':True,'sequenceValuesNotMVCCAtomic':True,'allCountersNeverRegressed':all(v['counterNeverRegressed']for v in changed),'onlyQuoteSectionsSequenceChanged':only_expected,'quoteSectionsIdentityDefinitionMatchesUnchangedStartupContract':definition_matches,'quoteSectionsBothCalledTrue':called_matches,'quoteCount':str(counts['quotes']),'departmentCount':str(counts['departments']),'quoteSectionRowCount':str(counts['quote_sections']),'startupInsertSelectCandidateRows':str(expected),'counterDeltaEqualsStartupInsertSelectCandidateRows':delta_matches,'compatibleWithExistingStartupConflictConsumption':bool(only_expected and definition_matches and delta_matches and called_matches)}

def supplement(result):
 global STAGE
 STAGE='sealed-backup-deploy-and-failed-verify';before,rb,sb=sealed(*PINS[0]);_,rd,sd=sealed(*PINS[1]);observed,rv,sv=sealed(*PINS[2]);need(before['head']==BASE and rb.get('success')is True and rb.get('backupComplete')is True and rd.get('success')is True and rd.get('target')==TARGET and rd.get('expectedTree')==TREE and rd.get('onlyInternalQuoteRebuilt')is True and rv.get('success')is False and rv.get('target')==TARGET and rv.get('expectedTree')==TREE and rv.get('deploymentVerified')is True and rv.get('originalBusinessIdPreservationProven')is True and rv.get('requiresScopedRowInvestigation')is False)
 expected={'originalFullTypedRowsIdentical','fullSchemaAndSequenceDefinitionsIdentical','sequenceStateIdenticalNonMVCC','legacyLogicalSQLiteAndFilesIdentical','legacyPhysicalBytesAndPermissionsIdentical','uploadBytesAndPermissionsIdentical','runtimeAndAllNonQuoteContainersUnchanged','runtimeConfigurationMapsMatchOriginal','allOriginalFullTypedRowsPreserved','onlyExpectedCostingBasisSeedsInserted'};seed_proof=costing_seed_preservation(before['postgres'],observed['postgres']);added=seed_proof['expectedCostingBasisSeedRowsAdded'];expected_changed=['factory_ref_tables']if added else [];expected_counts={'factory_ref_tables':{'before':before['postgres']['tables']['factory_ref_tables']['rows'],'after':observed['postgres']['tables']['factory_ref_tables']['rows']}}if added else {};need(rv.get('changedTables')==expected_changed and rv.get('changedTableCounts')==expected_counts and rv.get('allOriginalFullTypedRowsPreserved')is True and rv.get('onlyExpectedCostingBasisSeedsInserted')is True);need(type(rv.get('checks'))is dict and set(rv['checks'])==expected and rv['checks']['sequenceStateIdenticalNonMVCC']is False and rv['checks']['originalFullTypedRowsIdentical']is(not bool(added))and all(v is True for k,v in rv['checks'].items()if k not in {'sequenceStateIdenticalNonMVCC','originalFullTypedRowsIdentical'}));need(observed['runtime']==rd['runtimeAfter']and observed['runtime']['others']==before['runtime']['others'])
 STAGE='exact-sealed-sequence-classification';report=compare(before['postgres'],observed['postgres']);result.update(report)
 STAGE='selected-input-seals-unchanged';need(sealed(*PINS[0])==(before,rb,sb)and sealed(*PINS[1])[1:]==(rd,sd)and sealed(*PINS[2])==(observed,rv,sv));L.private_write(OUT/'sealed-input-receipts.private.json',enc({'backup':sb,'deploy':sd,'strictVerification':sv}));result.update(completed=True,selectedMetadataSealsRevalidated=True,originalStrictReceiptRemainsFailed=True,originalStrictEqualityResult=False,successfulDeploymentReceiptPreserved=True,compatibleSourceCommit=TARGET,reviewedBaseStartupSourceSHA256=BASE_STARTUP_SOURCE_SHA,reviewedTargetStartupSourceSHA256=TARGET_STARTUP_SOURCE_SHA,unchangedStartupConflictFragmentSHA256=STARTUP_CONFLICT_FRAGMENT_SHA,actualActorOrCauseProven=False,wholeArchiveBytesRevalidated=False,success=report['compatibleWithExistingStartupConflictConsumption']and report['allCountersNeverRegressed'])

def main():
 global L
 need(PIN and all(re.fullmatch('[a-f0-9]{64}',v or'')for v in(BASE_STARTUP_SOURCE_SHA,TARGET_STARTUP_SOURCE_SHA,STARTUP_CONFLICT_FRAGMENT_SHA))and re.fullmatch('[a-f0-9]{40}',TARGET or'')and re.fullmatch('[a-f0-9]{40}',TREE or'')and len(sys.argv)==2 and sys.argv[1]=='sequence-supplement'and os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_ATTEMPT')=='1');os.umask(0o077);L=library();OUT.mkdir(mode=0o700);signal.signal(signal.SIGTERM,lambda *_:need(False));signal.signal(signal.SIGALRM,lambda *_:need(False));signal.alarm(90)
 result={'mode':'sequence-supplement','success':False,'completed':False,'target':TARGET,'businessWritesPerformed':False,'liveDatabaseOrHTTPAccessPerformed':False,'credentialsOrBusinessRowsPrinted':False,'configurationOrContainersChanged':False,'originalArchivesModified':False,'automaticRollbackOrDataResetPerformed':False}
 try:supplement(result)
 except BaseException:result['failedStage']=STAGE
 finally:L.private_write(OUT/'first-result.json',enc(result));L.seal(OUT);print(enc(dict(result,manifestSHA256=L.file_hash(OUT/'manifest.json'),resultSHA256=L.file_hash(OUT/'first-result.json'))).decode(),flush=True)
 return 0 if result['success']else 1
if __name__=='__main__':
 try:code=main()
 except BaseException:print('{"success":false,"safeFailure":"INTERNAL_QUOTE_959_SEQUENCE_PREFLIGHT_FAILED"}',flush=True);code=1
 sys.exit(code)
