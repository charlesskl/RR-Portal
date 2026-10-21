"""Observe one natural sync and one read-only queue search; never fetch or trigger sync."""
import contextlib,datetime,hashlib,importlib.util,json,os,pathlib,re,signal,sqlite3,sys,time
PIN=False;BRANCH='refs/heads/ops/voyageplex-size-fix-20261020';TARGET='6fc1143c0b39470d814caac553beaaf3bc2912e0'
ROOT=pathlib.Path('/opt/rr-portal');OUT=ROOT/'deploy/backups/voyageplex-xingxin-sections-20261021-02'
HOST_SHA='e74006dba9ecba87968bebbd05cb85c4c740b8ab1fe6d64f3dbb6bfc6f7f99ab';CHILD_SHA='76f0cda4b77f1f897a65d4f99338d3afe387ceddd4fdb4f426f98d53e2a02041';S=None
PROOF=ROOT/'deploy/backups/voyageplex-xingxin-sections-20261021-01';PROOF_MANIFEST='6c261d3f09c5865c77a184187955c42d3e9bd83d51521088de4ae99cbc4249cb';PROOF_RESULT='69a1d92f343e1454ca223043f15557a6b6d6d7a4cf18f8054d01f44f5f4aa58b'
ORIGINAL_CURSOR=1545369827;SUCCESS_STATUSES={'pending','duplicate','confirmed','duplicate_confirmed'}
def need(value):
 if not value:raise RuntimeError('XINGXIN_FINAL_READONLY_REJECTED')
def load(name,filename,sha):
 path=pathlib.Path(__file__).with_name(filename);need(path.is_file()and not path.is_symlink()and hashlib.sha256(path.read_bytes()).hexdigest()==sha);spec=importlib.util.spec_from_file_location(name,path);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module
def proof():
 need(PROOF.is_dir()and not PROOF.is_symlink()and PROOF.stat().st_mode&0o077==0);need(S.digest(PROOF/'manifest.json')==PROOF_MANIFEST and S.digest(PROOF/'first-result.json')==PROOF_RESULT);manifest=json.loads((PROOF/'manifest.json').read_bytes());need(type(manifest)is dict);items=list(PROOF.rglob('*'));need(len(items)<=100000 and all(not p.is_symlink()and(p.is_dir()or p.is_file())and p.stat().st_mode&0o077==0 for p in items));need(set(manifest)=={str(p.relative_to(PROOF))for p in items if p.is_file()and p!=PROOF/'manifest.json'});need(all(S.safe_path(n)and type(h)is str and re.fullmatch('[a-f0-9]{64}',h)and S.digest(PROOF/n)==h for n,h in manifest.items()));receipt=json.loads((PROOF/'first-result.json').read_bytes());need(receipt.get('success')is True and receipt.get('recoveryPassedAfterProbe')is True);return manifest
def shared(state):return next(row for row in state['states']if row['Id']==1)
def moment(value):
 need(type(value)is str and re.fullmatch(r'\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})?',value));value=re.sub(r'\.([0-9]{1,9})',lambda m:'.'+(m[1]+'000000')[:6],value).replace('Z','+00:00');stamp=datetime.datetime.fromisoformat(value);return stamp.replace(tzinfo=datetime.timezone.utc)if stamp.tzinfo is None else stamp
def interval_totals(db,original):
 prefix='%s:%s:'%(original['Address'],original['UidValidity']);totals={'originalCursorExclusive':ORIGINAL_CURSOR,'successfulCorrectOwner':0,'failedCorrectOwner':0,'otherStatusCorrectOwner':0,'wrongCompanyOrOwner':0,'malformedNamespaceSuffixCount':0,'scope':'original-namespace-after-original-cursor','mailContentRead':False}
 for key,company,owner,status,has_error in db.execute("SELECT MailboxKey,Company,MailOwnerId,Status,(Error IS NOT NULL AND Error<>'') FROM ImportEmailItems WHERE substr(MailboxKey,1,?)=?",(len(prefix),prefix)):
  suffix=key[len(prefix):]
  if re.fullmatch('[1-9][0-9]{0,9}',suffix)is None or int(suffix)>4294967295:totals['malformedNamespaceSuffixCount']+=1;continue
  if int(suffix)<=ORIGINAL_CURSOR:continue
  if company!='Xingxin'or owner!=0:totals['wrongCompanyOrOwner']+=1
  elif status in SUCCESS_STATUSES and not has_error:totals['successfulCorrectOwner']+=1
  elif status=='failed'or has_error:totals['failedCorrectOwner']+=1
  else:totals['otherStatusCorrectOwner']+=1
 return totals
def snapshot(label,original):
 need(S.DB.is_file()and not S.DB.is_symlink())
 with contextlib.closing(sqlite3.connect(S.DB.as_uri()+'?mode=ro',uri=True,timeout=5))as db:
  db.execute('PRAGMA query_only=ON');db.execute('BEGIN');state=S.M.selected_state(db);key='%s:%s:%s'%(original['Address'],original['UidValidity'],S.UID);state['originalTargetRows']=S.M.rows(db,'SELECT Company,MailOwnerId,Status,Error FROM ImportEmailItems WHERE MailboxKey=?',(key,));totals=interval_totals(db,original);need(db.execute('PRAGMA query_only').fetchone()[0]==1)
 need({r['Id']for r in state['states']}=={1,1002,1003,1005,1006});S.private(label+'-selected-state.private.json',state);S.private(label+'-interval-totals.private.json',totals);return state,totals
def new_success(before,after):
 old=shared(before);current=shared(after);need(type(current['LastUid'])is int and ORIGINAL_CURSOR<=current['LastUid']<=4294967295);return bool(not current['LastError']and current['LastUid']>=old['LastUid']and moment(current['LastSuccessAt'])>moment(old['LastSuccessAt']))
def observe(before,original):
 current=before;totals=None;start=time.monotonic();number=0;protected=S.protected_selected(before)
 while time.monotonic()-start<360:
  time.sleep(min(20,max(0,360-(time.monotonic()-start))));number+=1;fresh,totals=snapshot('poll-%02d'%number,original);need(S.protected_selected(fresh)==protected and shared(fresh)['LastUid']>=shared(current)['LastUid']);current=fresh
  if new_success(before,current):return current,totals,True,number
 return current,totals,False,number
def same_runtime(before,after):
 return bool(all(before[k]==after[k]for k in('Id','Image','Config','HostConfig'))and sorted(before['Mounts'],key=S.enc)==sorted(after['Mounts'],key=S.enc)and all(before['State'].get(k)==after['State'].get(k)for k in('StartedAt','Running','OOMKilled'))and before['RestartCount']==after['RestartCount'])
def queue(row,state):
 memory=S.M.child_bootstrap_headroom({'voyageplex-parser':row})
 if not memory['enoughAtSamplingInstant']:return {'deferredInsufficientMemory':True,'queueObservationValidated':False,'bootstrapMemoryGuard':memory}
 path=pathlib.Path(__file__).with_name('voyageplex-xingxin-queue-child-20261021.py');need(path.is_file()and not path.is_symlink()and hashlib.sha256(path.read_bytes()).hexdigest()==CHILD_SHA);cursor=shared(state)['LastUid'];payload={'scope':'ops/voyageplex-size-fix-20261020','after_uid':cursor,'expected_uid_validity':1,'folder':'INBOX'};code,blob=S.capture(['docker','exec','-i',row['Id'],'python3','-B','-c',path.read_text()],'xingxin-single-queue-search',70,S.enc(payload));need(code==0);report=json.loads(blob);S.private('queue-child.private.json',report);need(type(report)is dict and report.get('success')is True and report.get('scope')==payload['scope']and report.get('after_uid')==cursor);evidence=report.get('evidence');need(type(evidence)is dict);valid=bool(evidence.get('namespaceValid')is True and evidence.get('searchResponseValidated')is True and not report.get('failedStage')and not report.get('exception')and not report.get('sessionBudgetExpired')and evidence.get('sessionBudgetExpired')is False and not evidence.get('failedStage')and not evidence.get('exceptionClass'));need(valid and type(evidence.get('pendingCount'))is int and evidence['pendingCount']>=0);return {'queueObservationValidated':True,'cursorAtSearch':cursor,'serverCandidateUIDCountAfterCursor':evidence['pendingCount'],'queueEmptyAtSearchInstant':evidence['pendingCount']==0,'pendingUIDSetSHA256':evidence.get('pendingUIDSetSHA256'),'notFilteredByBusinessStartDate':True,'snapshotOnlyNotFullHistoricalCompleteness':True,'bootstrapMemoryGuard':memory}
def timeout_handler(signum,frame):raise TimeoutError('FINAL_READONLY_DEADLINE')
def main():
 global S
 need(PIN and sys.argv[1:]==['observe']and os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_ATTEMPT')=='1');os.umask(0o077);OUT.mkdir(mode=0o700);S=load('reviewed_recovery_guards','xingxin-recovery-library.py',HOST_SHA);S.OUT=OUT;S.COUNT=0;S.M=load('reviewed_mail_observation','mail-observation-library.py',S.LIB_SHA);S.M.capture=S.capture;S.M.private=S.private;signal.signal(signal.SIGALRM,timeout_handler);signal.alarm(460);result={'mode':'xingxin-natural-sync-and-queue-readonly','success':False,'backfillCompleteUnknown':True,'businessHttpMailboxSyncTestOrRetryCallsPerformed':False,'databaseConfigurationOrCursorWritesPerformed':False,'applicationContainerSignalsPerformed':False,'mailBodyOrHeaderFetchPerformed':False,'otherMailboxesContacted':False,'rawSecretsAddressesOrMailContentPrinted':False}
 try:
  manifest=S.verify_prior();first=S.verify_first_probe();previous=S.verify_previous_no_probe();recovery=proof();code,head=S.capture(['git','rev-parse','HEAD'],'current-reviewed-head');need(code==0 and head==((TARGET+'\n').encode()));deployed=S.sealed_json(manifest,'deployed.private.json');original=shared(S.sealed_json(manifest,'after/mail-state-before.private.json'));need(original['UidValidity']==1 and original['LastUid']==ORIGINAL_CURSOR);before,initial_totals=snapshot('before',original);facts=S.shared_facts(before,manifest);result['currentXingxinBefore']=facts;need(facts['automaticSyncRecoveryPassed']);runtime=S.parser_inspect(deployed);baseline=S.sealed_json(manifest,'baseline.private.json');need(S.M.environment(runtime)==S.M.environment(baseline['parserBefore']));observed,totals,passed,samples=observe(before,original);result.update(naturalNextSuccessfulRoundObserved=passed,queryOnlySampleCount=samples,observationLimitSeconds=360,samplingSeconds=20);result['queue']=queue(runtime,observed);after,final_totals=snapshot('after',original);final=S.parser_inspect(deployed);need(S.protected_selected(before)==S.protected_selected(after)and shared(after)['LastUid']>=shared(observed)['LastUid']and same_runtime(runtime,final));facts_after=S.shared_facts(after,manifest);result.update(currentXingxinAfter=facts_after,storedIntervalBefore=initial_totals,storedIntervalAfter=final_totals,selectedStateChanges=S.state_changes(before,after),naturalProgressDuringSearch=shared(after)['LastUid']!=shared(observed)['LastUid']);code,head=S.capture(['git','rev-parse','HEAD'],'final-reviewed-head');need(code==0 and head==((TARGET+'\n').encode()));need(S.verify_prior()==manifest and S.verify_first_probe()==first and S.verify_previous_no_probe()==previous and proof()==recovery);result.update(recoveryProofManifestSHA256=PROOF_MANIFEST,recoveryProofResultSHA256=PROOF_RESULT,priorEvidenceSealsPreserved=True,usersExceptRoutineLoginSettingsNamespacesStrictlyUnchanged=True,parserContainerImageConfigEnvironmentAndSourceUnchanged=True);result['success']=bool(passed and facts_after['automaticSyncRecoveryPassed']and result['queue']['queueObservationValidated']and final_totals['wrongCompanyOrOwner']==0 and final_totals['malformedNamespaceSuffixCount']==0)
 except Exception as error:result.update(safeFailure='NATURAL_SYNC_OR_QUEUE_OBSERVATION_INCOMPLETE',exceptionType=type(error).__name__ if type(error).__name__ in{'RuntimeError','OSError','ValueError','KeyError','OperationalError','TimeoutError'}else'Other')
 finally:
  signal.alarm(0);S.private('first-result.json',result);S.private('manifest.json',{str(p.relative_to(OUT)):S.digest(p)for p in OUT.rglob('*')if p.is_file()});public=dict(result,manifestSHA256=S.digest(OUT/'manifest.json'),resultSHA256=S.digest(OUT/'first-result.json'));need(len(S.enc(public))<=65536);print(S.enc(public).decode(),flush=True)
 return 0 if result['success']else 1
if __name__=='__main__':
 try:sys.exit(main())
 except Exception:print('{"success":false,"safeFailure":"FINAL_READONLY_PREFLIGHT_REJECTED"}',flush=True);sys.exit(1)
