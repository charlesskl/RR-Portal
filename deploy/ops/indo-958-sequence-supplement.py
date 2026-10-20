"""Sealed metadata only: preserve the failed strict receipt and describe one sequence delta."""
import hashlib,importlib.util,json,os,pathlib,re,signal,stat,sys
ROOT=pathlib.Path('/opt/rr-portal');BRANCH='refs/heads/ops/indo-shipping-958-20261020';PIN=True
BASE='6eece9ec6802533c077dd53d46e89902ffb4e90f';TARGET='32440d3f0891e52707ea89f8dfe72eabe9f62ad7';TREE='c00584ff572f2b37cad03eb974b712fc7f559ffb'
BACKUPS=ROOT/'deploy/backups';OUT=BACKUPS/'indo-shipping-958-20261020-sequence-supplement'
PINS=((BACKUPS/'indo-shipping-958-20261020-backup','63324cbb1eef24753f9d7cb73084dfe7cabed3e87bffc47d63e365cb1f351acc','c95bdf322e61299c4594c0492c787535d0536a36ff66f3b31270275fa608c3a1','baseline.private.json'),(BACKUPS/'indo-shipping-958-20261020-deploy','386a2728484f4ea599c257b69f392c23b1eb93fbe47a43df69ef66ad23bda489','8ba7b7336519ed8e1dad4f93f8576eb6cec35f07b955747e0889af552202a605',None),(BACKUPS/'indo-shipping-958-20261020-verify','e52ed1bfe689e915c4b99d1b0d84bb61e85260e526ac6b8af05f340e45ee7708','1e58530e8c083c44899eff310db0708b9b1ef8eff3ef7023cb8875c1c283ee3d','observed.private.json'))
LIBRARY_SHA='d63168fd3057f4f2aba2d93f9fab31d2d65c6dd0f3234877d71fcff1e04e62b9'
STARTUP_SOURCE_SHA='5cae24b2ece596e17acaba179ad740f7382a94dc663e1e013c11a815779dfae5'
COMPATIBILITY_SOURCE_SHA='8915c2cef5db24e951eed8d49e3c19910cdf2ea71dabc61864162588589cfa12'
BOOTSTRAP_SQL_SHA='367cb7b45782195e00e6d07364a36cd91bf743220662f8bcec7f3a35907cd2c3'
TARGET_API_DOCUMENT_MANIFEST_SHA='674dd5ee7d0614c98b0434d37f45e2314cfaa1a2643aafde61e5362f546c4f0f'
STAGE='entry';L=None

def need(value):
 if not value:raise RuntimeError('INDO_SHIPPING_958_SEALED_SEQUENCE_REJECTED')
def enc(value):return json.dumps(value,sort_keys=True,ensure_ascii=True,separators=(',',':'),allow_nan=False).encode()
def sha(value):return hashlib.sha256(value).hexdigest()
def stable_read(path,limit):
 need(type(limit)is int and 0<limit<=32*1024**2);fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
 with os.fdopen(fd,'rb')as stream:
  before=os.fstat(stream.fileno());need(stat.S_ISREG(before.st_mode)and stat.S_IMODE(before.st_mode)==0o600 and before.st_size<=limit);raw=stream.read(limit+1);after=os.fstat(stream.fileno());fields=lambda s:(s.st_dev,s.st_ino,s.st_mode,s.st_size,s.st_mtime_ns,s.st_ctime_ns);need(fields(before)==fields(after)==fields(path.lstat())and len(raw)==before.st_size)
 return raw

def library():
 p=pathlib.Path(__file__).with_name('release-data-library.py');need(p.is_file()and not p.is_symlink()and sha(p.read_bytes())==LIBRARY_SHA);spec=importlib.util.spec_from_file_location('indo958_seal_only_library',p);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m

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
 legacy_present='users'in old['tables'];legacy=old['tables'].get('users',{}).get('rows',0);current=old['tables']['Users']['rows'];need(type(legacy)is int and type(current)is int and 0<=legacy<=2**63-1 and 0<=current<=2**63-1)
 # DatabaseCompatibility always attempts one admin row before the legacy-user SELECT.
 # Both unchanged statements can consume nextval despite conflict/no resulting row change.
 bootstrap_candidates=1;expected=bootstrap_candidates+legacy;definition=by_name.get('Users_Id_seq',{});contract={'name':'Users_Id_seq','type':'integer','start':'1','increment':'1','min':'1','max':'2147483647','cache':'1','cycle':False,'ownedByTable':'Users','ownedByColumn':'Id','dependencyType':'i'};definition_matches=all(definition.get(k)==v for k,v in contract.items());only_expected=len(changed)==1 and changed[0]['sequence']=='Users_Id_seq';delta_matches=only_expected and int(changed[0]['delta'])==expected;called_matches=only_expected and changed[0]['beforeCalled']is True and changed[0]['afterCalled']is True
 return {'sequenceCount':len(a),'changedSequenceCount':len(changed),'changedSequenceStates':changed,'allFullTypedBusinessRowsIdentical':True,'allSchemaAndSequenceDefinitionsIdentical':True,'bothSequenceCapturesIndependentlyBracketedStable':True,'sequenceValuesNotMVCCAtomic':True,'allCountersNeverRegressed':all(v['counterNeverRegressed']for v in changed),'onlyUsersIdentitySequenceChanged':only_expected,'usersIdentityDefinitionMatchesUnchangedStartupContract':definition_matches,'usersIdentityBothCalledTrue':called_matches,'legacyLowercaseUsersTablePresent':legacy_present,'legacyLowercaseUsersRowCount':str(legacy),'currentUsersRowCount':str(current),'bootstrapAdminConflictCandidateRows':str(bootstrap_candidates),'legacyInsertSelectCandidateRows':str(legacy),'totalUnchangedStartupIdentityCandidateRows':str(expected),'counterDeltaEqualsBothUnchangedStartupCandidateCounts':delta_matches,'compatibleWithExistingStartupConflictConsumption':bool(only_expected and definition_matches and delta_matches and called_matches)}

def document_manifest(documents):
 need(type(documents)is dict and 0<len(documents)<=1000 and all(type(n)is str and n.startswith('src/')and n.endswith('.cs')and'..'not in n and re.fullmatch('[a-f0-9]{64}',h)for n,h in documents.items()));return sha(''.join(n+':'+documents[n]+'\n'for n in sorted(documents)).encode())

def source_binding(before,rb,rd):
 need(rb.get('actualDllPdbDocumentsMatchBase')is True and rd.get('actualDllPdbDocumentsMatchTarget')is True and before['startupChecks'].get('adminAlreadyConfigured')is True and before['startupChecks'].get('legacyAccountsAlreadyMigrated')is True);docs=before['runtimeDocuments'];need(docs['IndoShipping.Api'].get('src/IndoShipping.Api/Features/Bootstrap/ProductionSeeder.cs')==STARTUP_SOURCE_SHA and docs['IndoShipping.Infrastructure'].get('src/IndoShipping.Infrastructure/Persistence/DatabaseCompatibility.cs')==COMPATIBILITY_SOURCE_SHA)
 for project in('IndoShipping.Api','IndoShipping.Infrastructure'):
  baseline=before['backendSourceProof'][project];target=rd['backendSourceProof'][project]
  for row in(baseline,target):need(all(row.get(k)is True for k in('codeViewMatchesPortablePdb','reviewedDocumentChecksumsMatched','nonGeneratedDocumentInventoryMatched')))
  need(baseline.get('documentManifestSha256')==document_manifest(docs[project]))
  need(target.get('documentManifestSha256')==(TARGET_API_DOCUMENT_MANIFEST_SHA if project=='IndoShipping.Api'else baseline['documentManifestSha256']))
 return {'sealedBaselineSeederAndCompatibilitySourceChecksumsMatched':True,'actualTargetDllPdbBindingMatchesLocallyReviewedSourceDocuments':True,'reviewedUnchangedSeederSourceSHA256':STARTUP_SOURCE_SHA,'reviewedUnchangedCompatibilitySourceSHA256':COMPATIBILITY_SOURCE_SHA,'locallyReviewedUnchangedBootstrapSQLSHA256':BOOTSTRAP_SQL_SHA,'bootstrapSQLBytesRereadFromLiveRuntime':False}

def supplement(result):
 global STAGE
 STAGE='sealed-backup-deploy-and-failed-verify';before,rb,sb=sealed(*PINS[0]);_,rd,sd=sealed(*PINS[1]);observed,rv,sv=sealed(*PINS[2]);need(before['head']==BASE and rb.get('success')is True and rb.get('backupComplete')is True and rd.get('success')is True and rd.get('target')==TARGET and rd.get('expectedTree')==TREE and rd.get('onlyIndoShippingRebuilt')is True and rv.get('success')is False and rv.get('target')==TARGET and rv.get('expectedTree')==TREE and rv.get('deploymentVerified')is True and rv.get('changedTables')==[]and rv.get('changedTableCounts')=={}and rv.get('originalBusinessIdPreservationProven')is True and rv.get('requiresScopedRowInvestigation')is False)
 expected={'allOriginalFullTypedRowsIdentical','fullSchemaAndSequenceDefinitionsIdentical','sequenceStateIdenticalNonMVCC','databaseImagesAttachmentsAndUserPermissionsIncluded','runtimeAndAllNonIndoContainersUnchanged','runtimeConfigurationMapsMatchOriginal'};need(type(rv.get('checks'))is dict and set(rv['checks'])==expected and rv['checks']['sequenceStateIdenticalNonMVCC']is False and all(v is True for k,v in rv['checks'].items()if k!='sequenceStateIdenticalNonMVCC'));need(observed['runtime']==rd['runtimeAfter']and observed['runtime']['others']==before['runtime']['others'])
 STAGE='exact-sealed-sequence-classification';report=compare(before['postgres'],observed['postgres']);result.update(report)
 STAGE='sealed-actual-source-binding';result.update(source_binding(before,rb,rd))
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
 except BaseException:print('{"success":false,"safeFailure":"INDO_SHIPPING_958_SEQUENCE_PREFLIGHT_FAILED"}',flush=True);code=1
 sys.exit(code)
