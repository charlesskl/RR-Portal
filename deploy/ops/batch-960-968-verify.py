"""Fixed readonly acceptance of six reviewed services and closed business evidence.
All gates and release/archive pins false/blank. Never login/import/export business,
change credentials/flags, retry mailbox, restore data, or signal a service.
"""
import contextlib,datetime,hashlib,importlib.util,json,os,pathlib,re,signal,sqlite3,stat,sys,tarfile,traceback
ROOT=pathlib.Path('/opt/rr-portal');BRANCH='refs/heads/ops/batch-960-966-967-968-20261020'
VERIFY_PIN=False;CORE_SHA='a06bd4dd932df22b9127cda35a2dd7a8d69fafd879d6619ce3b50aa54252cd5d';RELEASE_SHA='1fc87fa04ca0de1f2927b623fdab6fed172fc5c9ee0d0478eb686e00d538786b';VOYAGE_COMPARE_SHA='fbb6ed5498654e2e9e73a636d87ad95abe9bfbdb97b30f17a6c99600578bae8a'
EXPECTED_TARGET='b30a803e74641e0e18150597e0114f6cb99b2e9c';EXPECTED_TREE='60936186cae64d44ee728ac80ec3033779e9a676';DEPLOY_MANIFEST='8b5b9a56d4c117eca860dbd53ed7c5cef18b95a092adced94a2146fc2951588f';DEPLOY_RESULT='c02e7b97f36309bd03d261b5843e6fb6f9a98dcd61632fd5b883e8072d3abd8e'
OUT=ROOT/'deploy/backups/batch-960-966-967-968-20261020-verify'
CORE=None;RELEASE=None;VOYAGE=None;STAGE='entrypoint'

def need(value,label='invariant'):
 if not value:raise RuntimeError(label)
def enc(value):return json.dumps(value,ensure_ascii=True,sort_keys=True,separators=(',',':'),allow_nan=False).encode()
def sha(value):return hashlib.sha256(value).hexdigest()
def pin(value,n=64):return type(value)is str and re.fullmatch('[a-f0-9]{%d}'%n,value)is not None
def load(name,checksum):
 path=pathlib.Path(__file__).with_name(name);need(pin(checksum)and path.is_file()and not path.is_symlink()and sha(path.read_bytes())==checksum,'reviewedLibraryPin');spec=importlib.util.spec_from_file_location('readonly_'+name.replace('.','_'),path);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module

def current_utc():return datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='milliseconds').replace('+00:00','Z')
def file_rows(rows):
 result={row['path']:row for row in rows};need(len(result)==len(rows),'uniqueInventoryPaths');return result

def json_value(value):
 # JSON has one number type; retain booleans distinctly, including True != 1.
 import decimal
 if value is None:return ['null']
 if type(value)is bool:return ['bool',value]
 if type(value)in(int,float,decimal.Decimal):
  number=value if type(value)is decimal.Decimal else decimal.Decimal(str(value));need(number.is_finite(),'finiteJsonNumber')
  sign,digits,exponent=number.as_tuple();digits=list(digits)
  if not any(digits):return ['number',0,'0',0]
  # Remove insignificant trailing zeros without Decimal.normalize(), whose
  # current arithmetic precision can round away a changed low-order digit.
  while digits[-1]==0:digits.pop();exponent+=1
  return ['number',sign,''.join(str(digit)for digit in digits),exponent]
 if type(value)is str:return ['string',value]
 if type(value)is list:return ['array',[json_value(v)for v in value]]
 need(type(value)is dict,'jsonObjectType');return ['object',[(k,json_value(value[k]))for k in sorted(value)]]

def closed_path(root,key,relative):
 need(root.is_absolute()and root.is_dir()and not root.is_symlink()and key in CORE.STORAGE and CORE.OPS.L.safe_path(relative),'closedPathScope');path=root/key/'sqlite'/relative
 need(path.is_file()and not path.is_symlink()and stat.S_IMODE(path.stat().st_mode)==0o600 and not any(path.with_name(path.name+suffix).exists()for suffix in('-wal','-shm','-journal')),'closedPortableDatabase')
 for ancestor in(path,*path.parents):
  if ancestor==root:break
  need(not ancestor.is_symlink(),'noSnapshotAncestorSymlink')
 return path

def observation_seal(directory):
 manifest=json.loads((directory/'manifest.json').read_bytes());files=[p for p in directory.rglob('*')if p.is_file()];need(set(manifest)=={str(p.relative_to(directory))for p in files if p!=directory/'manifest.json'},'completeObservedManifest');need(all(not p.is_symlink()and p.stat().st_mode&0o077==0 for p in directory.rglob('*')),'privateObservedEntries');need(all(CORE.OPS.L.safe_path(n)and pin(h)and CORE.OPS.L.file_hash(directory/n)==h for n,h in manifest.items()),'observedAllByteSeals');return CORE.OPS.L.file_hash(directory/'manifest.json')

def capture_observation(before,files,prepared,candidates):
 global STAGE
 directory=OUT/'observation';directory.mkdir(mode=0o700);saved=CORE.OUT;CORE.OUT=directory
 try:
  STAGE='fixed-health-probes-before-database-copies';probes=[RELEASE.get(path)for path in('/rr/health','/qc/api/health','/internal-quote/health','/voyageplex/api/health')]
  STAGE='observed-source-environment-runtime';configuration=RELEASE.checked_source(RELEASE.TARGET,before,files);runtime,raw=CORE.runtime();CORE.OPS.L.private_write(directory/'target-inspect.private.json',enc(raw));roots,mounts=CORE.storage_roots(raw);CORE.storage_contract(raw,runtime['databaseContainer'])
  STAGE='observed-consistent-sqlite-and-all-files';storage=CORE.capture_storage(roots);raw_rr=(roots['rr-data']/'data.json').read_bytes();need(len(raw_rr)<=128*1024**2 and sha(raw_rr)==file_rows(storage['rr-data']['files'])['data.json']['sha256'],'observedEngineeringFileBound');CORE.OPS.L.private_write(directory/'engineering-data.private.json',raw_rr)
  STAGE='observed-postgres-exported-snapshot';postgres=CORE.OPS.pg_capture(runtime['databaseContainer'],directory,False)['internal_quote'];STAGE='observed-runtime-source-and-compiled-image-bindings';proof={service:CORE.service_source_proof(service,row)for service,row in runtime['targets'].items()}
  STAGE='observed-stability'
  for key,path in roots.items():
   need(CORE.OPS.L.non_database_inventory(path,list(storage[key]['sqlite']))==storage[key]['files'],'stablePersistentFileInventory')
   if key=='quote-legacy':need(CORE.OPS.L.non_database_inventory(path,[])==storage[key]['completeRawFileInventory'],'stableImmutableLegacyDatabaseBytes')
  after,_=CORE.runtime();need(after==runtime and RELEASE.checked_source(RELEASE.TARGET,before,files)==configuration,'observedRuntimeAndSourceStable')
  observation={'head':RELEASE.TARGET,'capturedAtUTC':current_utc(),'runtime':runtime,'configuration':configuration,'environmentSHA256':CORE.OPS.L.file_hash(ROOT/'.env.cloud.production'),'preexistingFourDirty':CORE.dirty_snapshot(),'maintenanceInventory':RELEASE.flags(),'storageMounts':mounts,'storage':storage,'postgres':postgres,'sourceProof':proof,'probes':probes}
  CORE.OPS.L.private_write(directory/'observed.private.json',enc(observation));CORE.OPS.L.seal(directory)
 finally:CORE.OUT=saved
 seal=observation_seal(directory);return observation,directory,seal

def recorded_source_matches(service,proof,prepared):
 # Apply release acceptance only after the complete observation is sealed.
 # Use its recorded facts so a mismatch remains available without live rereads.
 if service=='voyageplex-web':return all(proof.get(key)==prepared['webArtifacts'].get(key)for key in('compiledArtifactCount','compiledArtifactInventorySHA256','buildIdFileSHA256'))
 return proof.get('reviewedSourceMatch')is True

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
 details.update(delta=delta,expectedUnchangedStartupInsertSelectCandidates=expected,counterNeverRegressed=delta>=0,compatibleWithExistingStartupConflictConsumption=delta==expected)
 return delta>=0 and delta==expected,details

def rr_comparison(before,observed,directory):
 import decimal
 old_raw=(RELEASE.BACKUP/'engineering-data.private.json').read_bytes();new_raw=(directory/'engineering-data.private.json').read_bytes();old_inventory=file_rows(before['storage']['rr-data']['files']);new_inventory=file_rows(observed['storage']['rr-data']['files']);need(sha(old_raw)==old_inventory['data.json']['sha256']and sha(new_raw)==new_inventory['data.json']['sha256'],'engineeringClosedCopiesBound')
 # The baseline's native-JSON guard already proves the migration planner can
 # represent its numbers. Use that planner only to determine exact statuses;
 # retain every old decimal digit when constructing the expected business data.
 planned,receipt=CORE.engineering_plan(json.loads(old_raw));expected=json.loads(old_raw,parse_float=decimal.Decimal);actual=json.loads(new_raw,parse_float=decimal.Decimal)
 original_orders=expected.get('assembly_orders',[]);planned_orders=planned.get('assembly_orders',[]);need(len(original_orders)==len(planned_orders),'engineeringPlanPreservesOrderPositions')
 for old_order,planned_order in zip(original_orders,planned_orders):
  if old_order.get('status')!=planned_order.get('status'):old_order['status']=planned_order['status']
 exact=json_value(expected)==json_value(actual);old_other={n:r for n,r in old_inventory.items()if n!='data.json'};new_other={n:r for n,r in new_inventory.items()if n!='data.json'};added=set(new_other)-set(old_other);count=receipt['renamed']+receipt['unquoted'];backup_ok=len(added)==(1 if count else 0)
 for name in added:
  row=new_other[name];backup_ok&=re.fullmatch('data.json.bak-unquoted-[a-f0-9]{24}',name)is not None and row=={'path':name,'directory':False,'mode':0o600,'bytes':len(old_raw),'sha256':sha(old_raw)}
 preserved=all(new_other.get(n)==r for n,r in old_other.items())and not set(old_other)-set(new_other);modes=old_inventory['data.json']['mode']==new_inventory['data.json']['mode']
 return {'passed':exact and preserved and backup_ok and modes,'checks':{'allJsonBusinessValuesExactAfterOnlyEligibleStatusChanges':exact,'allOriginalOtherFilesAndModesExact':preserved,'onePrivateExactOriginalBackupOnlyWhenMigrationNeeded':backup_ok,'originalDataJsonModePreserved':modes},'details':{'plannedStatusChanges':receipt,'newFileCount':len(added),'strictOriginalJsonBytesUnchanged':old_raw==new_raw,'actualActorOrCauseOfUnexpectedChangesProven':False}}

def compare_data(before,observed,directory):
 checks={};details={};old_storage,new_storage=before['storage'],observed['storage'];checks['persistentStorageInventoryExactlyBound']=set(old_storage)==set(new_storage)==set(CORE.STORAGE)
 for key in sorted(set(old_storage)&set(new_storage)):
  old,new=old_storage[key],new_storage[key];checks[key+'.sqliteInventory']=set(old['sqlite'])==set(new['sqlite']);checks[key+'.originalDatabaseModesOwnersPreserved']=old.get('originalSQLiteMetadata')==new.get('originalSQLiteMetadata')
  for name in sorted(set(old['sqlite'])&set(new['sqlite'])):
   old_path,new_path=closed_path(RELEASE.BACKUP,key,name),closed_path(directory,key,name)
   with contextlib.closing(CORE.OPS.L.connect(old_path,True))as a,contextlib.closing(CORE.OPS.L.connect(new_path,True))as b:need(CORE.OPS.L.audit(a)==old['sqlite'][name]and CORE.OPS.L.audit(b)==new['sqlite'][name],'closedSnapshotAuditsMatchStoredMetadata')
   if key=='voyageplex-data'and name=='voyageplex.db':
    result=VOYAGE.compare_voyageplex(old_path,new_path,old['sqlite'][name],new['sqlite'][name],CORE.OPS.L,observed['runtime']['targets']['voyageplex-api']['started'],observed['capturedAtUTC']);details['voyageplexDeclaredStartupComparison']=result;checks['voyageplexDeclaredStartupComparison']=result['passed']
   else:checks[key+'.'+name+'.allOriginalTypedRowsAndSchema']=old['sqlite'][name]==new['sqlite'][name]
  if key=='rr-data':
   result=rr_comparison(before,observed,directory);checks['engineeringStatusOnlyMigration']=result['passed'];details['engineeringStatusOnlyMigration']=result
  else:checks[key+'.allOriginalFilesBytesAndModes']=old['files']==new['files']
  if key=='quote-legacy':checks['immutableLegacyDatabaseExactRawBytes']=old.get('completeRawFileInventory')==new.get('completeRawFileInventory')
  if key=='voyageplex-data':checks['historicalVoyageplexClosedDatabaseExactRawBytes']=old.get('historicalSQLite')==new.get('historicalSQLite')
 old,new=before['postgres'],observed['postgres'];checks['quoteAllOriginalTablesTypedExact']=old['tables']==new['tables'];checks['quoteAllOriginalSchemaExact']=old['schema']==new['schema'];seq,seqdetails=quote_sequence_check(old,new);checks['quoteSequenceExactOrExistingStartupConsumptionCompatible']=seq;details['quoteSequence']=seqdetails
 return {'passed':bool(checks)and all(value is True for value in checks.values()),'checks':checks,'details':details,'noUnexpectedDifferenceAttributedToActor':True,'dataRestoredOrCountersReset':False}

def verify(result):
 global STAGE
 STAGE='sealed-original-preparation-and-deployment';before=RELEASE.original();files=RELEASE.source_manifest();prepared,candidates=RELEASE.prepared_evidence(before,files);deployed=RELEASE.archive(RELEASE.DEPLOY,DEPLOY_MANIFEST,DEPLOY_RESULT);need(deployed.get('mode')=='deploy'and deployed.get('target')==EXPECTED_TARGET and deployed.get('allSixServicesUseExactSealedCandidateImages')is True and deployed.get('allMaintenanceFlagsRestored')is True,'completeSealedDeployment');need(RELEASE.TARGET==EXPECTED_TARGET and RELEASE.TREE==EXPECTED_TREE,'exactReviewedDeploymentTarget')
 observed,directory,seal=capture_observation(before,files,prepared,candidates);result.update(observedEvidenceSavedBeforeDerivation=True,observationManifestSHA256=seal)
 STAGE='closed-evidence-runtime-preservation';old_raw=RELEASE.read_json(RELEASE.BACKUP/'target-inspect.private.json');new_raw=json.loads((directory/'target-inspect.private.json').read_bytes());old_process=RELEASE.read_json(RELEASE.PREPARE/'old-process-environments.private.json');expected_runtime=RELEASE.read_json(RELEASE.DEPLOY/'runtime-after.private.json');checks={'actualRuntimeMatchesSealedDeployment':observed['runtime']==expected_runtime,'allOtherContainersStrictlyUnchanged':observed['runtime']['others']==before['runtime']['others'],'privateEnvironmentFileByteIdentical':observed['environmentSHA256']==before['environmentSHA256'],'fourExistingTrackedChangesExactlyPreserved':observed['preexistingFourDirty']==before['preexistingFourDirty'],'allMaintenanceFlagsExactlyRestored':observed['maintenanceInventory']==before['maintenanceInventory'],'allPersistentMountBindingsUnchanged':observed['storageMounts']==before['storageMounts']}
 for service in RELEASE.ORDER:
  proposed=RELEASE.approved_environment(service,candidates[service],old_raw,before);row=observed['runtime']['targets'][service];checks[service+'.exactPreparedCandidateImage']=row['image']==prepared['candidateImageIDs'][service];checks[service+'.configurationAndPid1EnvironmentPreserved']=RELEASE.config_same(service,before['runtime']['targets'][service],row,new_raw[service],proposed,old_process[service]);checks[service+'.recordedSourceMatchesReviewedCandidate']=recorded_source_matches(service,observed['sourceProof'][service],prepared)
 STAGE='pure-closed-data-comparison';comparison=compare_data(before,observed,directory);CORE.OPS.L.private_write(OUT/'comparison.private.json',enc(comparison));need(observation_seal(directory)==seal,'observedEvidenceUnchangedByComparison');checks['allBusinessRowsFilesAndDeclaredMigrationsAccepted']=comparison['passed'];passed=sum(value is True for value in checks.values());total=len(checks)
 result.update(success=passed==total,checks=checks,passedChecks=passed,totalChecks=total,dataComparisonPassed=comparison['passed'],dataComparisonChecksPassed=sum(value is True for value in comparison['checks'].values()),dataComparisonChecksTotal=len(comparison['checks']),failedDataCheckNames=[n for n,value in comparison['checks'].items()if value is not True],voyageplexStartupComparison=comparison['details'].get('voyageplexDeclaredStartupComparison'),engineeringMigration=comparison['details'].get('engineeringStatusOnlyMigration'),quoteSequenceComparison=comparison['details'].get('quoteSequence'),observedClosedEvidenceRetainedEvenOnDifference=True,unexpectedDataDifferencesNotAutomaticallyAttributedOrRestored=True)

def main():
 global CORE,RELEASE,VOYAGE
 need(len(sys.argv)==2 and sys.argv[1]=='verify'and VERIFY_PIN and pin(CORE_SHA)and pin(RELEASE_SHA)and pin(VOYAGE_COMPARE_SHA)and pin(EXPECTED_TARGET,40)and pin(EXPECTED_TREE,40)and pin(DEPLOY_MANIFEST)and pin(DEPLOY_RESULT),'falseDraftOrMissingPins');need(os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_ATTEMPT')=='1','exactBranchFirstAttempt');os.umask(0o077);OUT.mkdir(mode=0o700);CORE=load('batch-backup-library.py',CORE_SHA);CORE.OUT=OUT;CORE.initialize();RELEASE=load('release-library.py',RELEASE_SHA);RELEASE.CORE=CORE;RELEASE.OUT=OUT;RELEASE.ENV=dict(os.environ);VOYAGE=load('batch-voyageplex-sqlite-compat.py',VOYAGE_COMPARE_SHA)
 def stop(*_):need(False,'terminationSignal')
 signal.signal(signal.SIGTERM,stop);result={'mode':'verify','success':False,'target':EXPECTED_TARGET,'tree':EXPECTED_TREE,'readOnlyBusinessValidation':True,'businessApiWritesOrLoginsPerformed':False,'mailboxSyncRetryBackfillOrConfigurationPerformed':False,'serviceSignalsOrMaintenanceChanged':False,'automaticRollbackRestoreOrCounterResetPerformed':False,'secretOrBusinessRowsPrinted':False}
 try:verify(result)
 except BaseException:result.update(failedStage=STAGE,failedCheck='READONLY_EVIDENCE_OR_COMPARISON_REJECTED');CORE.OPS.L.private_write(OUT/'failure-traceback.private.txt',traceback.format_exc().encode())
 finally:
  CORE.OPS.L.private_write(OUT/'first-result.json',enc(result));CORE.OPS.L.seal(OUT);safe=dict(result,manifestSHA256=CORE.OPS.L.file_hash(OUT/'manifest.json'),resultSHA256=CORE.OPS.L.file_hash(OUT/'first-result.json'));need(len(enc(safe))<24000,'safeReceiptBound');print(enc(safe).decode(),flush=True)
 return 0 if result['success']else 1
if __name__=='__main__':
 try:code=main()
 except BaseException:print('{"success":false,"safeFailure":"BATCH_960_968_VERIFY_PREFLIGHT_FAILED"}',flush=True);code=1
 sys.exit(code)
