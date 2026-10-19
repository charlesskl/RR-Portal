"""PR942 sealed-only cursor metadata proof; original strict verification stays false."""
import contextlib,hashlib,importlib.util,json,os,pathlib,re,selectors,signal,subprocess,sys,time
ROOT=pathlib.Path('/opt/rr-portal');OUT=ROOT/'deploy/backups/voyageplex-942-20261019-sync-metadata-supplement';BRANCH='refs/heads/ops/voyageplex-942-20261019';PIN=True
RELEASE_SHA='5f6ab3ef3aee34fdfa6ce5805ef58e1a37305f26ccdad9cfa4c9c999b6f1d6cb';VERIFY_MANIFEST='d61e5f22ee43b193c4e4e10b2e817b4767a8199c63acc43d5070ec5a7ae9834e';VERIFY_RESULT='ef3b44281bb79021972a88ce485dfebc18c541ec03e55a3dfb90b300bfcea3a3'
M=None;C=None;STAGE='entry'
def need(v):
 if not v:raise RuntimeError('VOYAGEPLEX_942_SYNC_METADATA_SUPPLEMENT_REJECTED')
def enc(v):return json.dumps(v,ensure_ascii=True,sort_keys=True,separators=(',',':'),allow_nan=False).encode()
def load():
 p=pathlib.Path(__file__).with_name('voyageplex-release-library.py');need(p.is_file()and not p.is_symlink()and hashlib.sha256(p.read_bytes()).hexdigest()==RELEASE_SHA);spec=importlib.util.spec_from_file_location('fixed_942_release_for_metadata',p);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);c=m.core_load();c.OUT=OUT;c.OPS=c.load('release-data-ops-library.py');c.OPS.L=c.OPS.load_library(pathlib.Path(__file__).with_name('release-data-library.py'));m.CORE=c;return m,c
def evidence():
 backup=M.archive(M.BACKUP,M.BACKUP_MANIFEST,M.BACKUP_RESULT);deployed=M.archive(M.DEPLOY,M.DEPLOY_MANIFEST,M.DEPLOY_RESULT);verified=C.prior_archive(M.VERIFY,VERIFY_MANIFEST,VERIFY_RESULT);need(backup.get('backupComplete')is True and deployed.get('success')is True and deployed.get('onlyVoyagePlexThreeServicesRebuilt')is True and verified.get('success')is False and verified.get('deploymentVerified')is True and verified.get('strictAllPrimarySnapshotFieldsIdentical')is False and verified.get('strictNonTemplateTableTypedRowsIdentical')is False and deployed.get('target')==verified.get('target')==M.TARGET and verified.get('expectedTree')==M.TREE)
 checks=verified['checks'];need(type(checks)is dict and all(type(v)is bool for v in checks.values())and{k for k,v in checks.items()if not v}=={'AllMailboxCursorsAllTypedIdentical','AllOtherBusinessTablesPreservedExceptProvedExistingStartupFields'});observed=json.loads((M.VERIFY/'observed.private.json').read_bytes());need(observed['runtime']==deployed['runtimeAfter']);return backup,deployed,verified,observed

def classify_states(old,new,started,finished,utc_ns):
 q=C.OPS.L.quote;columns=old.execute('PRAGMA table_xinfo(MailSyncStates)').fetchall();need(columns==new.execute('PRAGMA table_xinfo(MailSyncStates)').fetchall());names=[r[1]for r in columns];need('Id'in names and 'LastSuccessAt'in names and {'LastUid','UidValidity','Address','MailboxIdentity','ConfigurationKey','LastError'}<=set(names));rows=[];sets=[]
 for db in(old,new):
  current=db.execute('SELECT * FROM MailSyncStates ORDER BY Id').fetchall();need(len(current)==5 and all(type(r[names.index('Id')])is int for r in current));values={r[names.index('Id')]:dict(zip(names,r))for r in current};need(len(values)==5);rows.append(values);sets.append(set(values))
 need(sets[0]==sets[1]);users={r[0]for r in old.execute("SELECT Id FROM Users WHERE IsActive=1 AND trim(MailboxAddress)<>'' AND (Role='admin' OR CompanyAccess IN ('Huadeng','Both'))")};need(len(users)==4 and all(type(v)is int and 0<v<=2147482647 for v in users)and sets[0]=={1,*[1000+v for v in users]});groups={};changed=[];private=[];cell=C.OPS.L.cell
 for key,a in rows[0].items():
  b=rows[1][key];kind='legacyXingxin'if key==1 else'legacyHuadeng'if key==2 else'huadengPersonal'if key>1000 and key-1000 in users else'unknown';need(kind!='unknown');summary=groups.setdefault(kind,{'rows':0,'retainedTypedIdentical':0,'onlyLastSuccessAtChanged':0});summary['rows']+=1;fields={n for n in names if cell(a[n])!=cell(b[n])};need(not fields or fields=={'LastSuccessAt'});private.append({'id':key,'classification':kind,'oldTypedRow':[cell(a[n])for n in names],'newTypedRow':[cell(b[n])for n in names]})
  if not fields:summary['retainedTypedIdentical']+=1;continue
  need(type(a['LastSuccessAt'])is str and type(b['LastSuccessAt'])is str);low,high=utc_ns(started),utc_ns(finished);before,after=utc_ns(a['LastSuccessAt']),utc_ns(b['LastSuccessAt']);need(low<=after<=high and before<after);setting=old.execute('SELECT SyncEnabled FROM MailSystemSettings WHERE Id=?',(key,)).fetchall();need(len(setting)==1 and type(setting[0][0])is int and setting[0][0]==1);summary['onlyLastSuccessAtChanged']+=1;changed.append(kind)
 need(len(changed)==1 and set(groups)=={'legacyXingxin','huadengPersonal'}and groups['legacyXingxin']['rows']==1 and groups['huadengPersonal']['rows']==4);return {'rows':5,'retainedTypedIdentical':4,'onlyLastSuccessAtChanged':1,'classificationCounts':groups,'changedStateClassification':changed[0],'allOtherTypedFieldsIdentityAndUIDsUnchanged':True,'timestampStrictlyAdvanced':True,'newTimestampWithinNewAPIStartAndSealedSnapshotWindow':True,'baselineAutomaticSyncEnabledForChangedState':True,'noAddedOrMissingStateRows':True},private

def log_counts(data):
 text=data.decode('utf-8',errors='replace');return {'perMailboxSyncFailureTemplate':len(re.findall(r'邮箱 (?:Xingxin|Huadeng):[^\r\n]* 同步失败：[A-Za-z0-9_.]+',text)),'automaticPollingFailureTemplate':text.count('邮箱自动同步轮询失败：'),'syncDatabaseWriteFailureTemplate':text.count('邮箱同步写入失败：'),'httpClientLegacyGetPollRequestTemplate':len(re.findall(r'Start processing HTTP request GET http://voyageplex-parser:[0-9]+/v1/mailbox/poll(?:\?|\s)',text)),'httpClientPersonalPostPollRequestTemplate':len(re.findall(r'Start processing HTTP request POST http://voyageplex-parser:[0-9]+/v1/mailbox/poll(?:\s|$)',text))}
def bounded_logs(cid,started,finished):
 need(re.fullmatch('[a-f0-9]{64}',cid));args=['docker','logs','--timestamps','--since',started,'--until',finished,'--tail','2000',cid];p=subprocess.Popen(args,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,bufsize=0);data=bytearray();limit=256*1024;deadline=time.monotonic()+20;bounded=True
 try:
  with selectors.DefaultSelector()as selected:
   selected.register(p.stdout,selectors.EVENT_READ)
   while selected.get_map():
    remaining=deadline-time.monotonic()
    if remaining<=0:bounded=False;break
    for key,_ in selected.select(min(remaining,0.25)):
     block=os.read(key.fileobj.fileno(),min(65536,limit+1-len(data)))
     if not block:selected.unregister(key.fileobj);continue
     data.extend(block)
     if len(data)>limit:bounded=False;break
    if not bounded:break
  if p.poll()is None:
   if bounded:
    try:p.wait(timeout=max(.01,deadline-time.monotonic()))
    except subprocess.TimeoutExpired:bounded=False
   if p.poll()is None:p.terminate()
  try:p.wait(timeout=2)
  except subprocess.TimeoutExpired:p.kill();p.wait(timeout=2)
 finally:
  if p.poll()is None:p.kill();p.wait(timeout=2)
  p.stdout.close()
 return {'commandSucceeded':p.returncode==0,'withinByteAndTimeLimit':bounded,'bytesInspected':min(len(data),limit),'tailLimit':2000,'completeHistoricalLogCoverageProven':False,'counts':log_counts(bytes(data[:limit]))if bounded and p.returncode==0 else None,'successOrAutomaticActorAuditTemplateExists':False,'pollRequestOrFailureCountsDoNotIdentifyTriggerOrActor':True,'rawLogLinesOrValuesSavedOrPrinted':False}
def diagnose(result):
 global STAGE
 STAGE='three-fixed-sealed-archives';before,deployed,verified,observed=evidence();api=deployed['runtimeAfter']['targets']['voyageplex-api'];need(re.fullmatch('[a-f0-9]{64}',api['id']));proof=M.template_module();STAGE='two-closed-sealed-sqlite-state-rows'
 with contextlib.closing(C.OPS.L.connect(M.BACKUP/'sqlite/voyageplex.db',True))as old,contextlib.closing(C.OPS.L.connect(M.VERIFY/'sqlite/voyageplex.db',True))as new:summary,private=classify_states(old,new,api['started'],observed['snapshotFinishedAtUtc'],proof.utc_ns)
 retained=verified['tableRowDifferences']['MailSyncStates'];need(retained.get('oldRows')==retained.get('newRows')==5 and retained.get('missingOldIds')==retained.get('newIds')==0 and retained.get('retainedTypedIdentical')==4 and retained.get('retainedTypedChanged')==1 and retained.get('changedFieldCounts')=={'LastSuccessAt':1}and retained.get('exactTypedMultisetIdentical')is False);C.OPS.L.private_write(OUT/'state-typed-comparison.private.json',enc(private));STAGE='fixed-sealed-api-container-bounded-historical-log-counts';logs=bounded_logs(api['id'],api['started'],observed['snapshotFinishedAtUtc']);STAGE='three-original-seals-unchanged';need(evidence()==(before,deployed,verified,observed));result.update(success=True,supplementProofCompleted=True,originalStrictVerificationStillFalse=True,originalReceiptsUnchanged=True,metadataProof=summary,boundedLogObservation=logs,compatibleWithExistingAutomaticPollingButTriggerNotProven=summary['changedStateClassification']=='legacyXingxin',doesNotIdentifyActor=True,manualTriggerProven=False,automaticTriggerProven=False,noBusinessRowsOrUIDsChangedByThisProbe=True,noGlobalAuditReclassifiedAsSuccess=True)
def main():
 global M,C
 need(PIN and len(sys.argv)==2 and sys.argv[1]=='sync-metadata-supplement'and os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_ATTEMPT')=='1');os.umask(0o077);OUT.mkdir(mode=0o700);M,C=load();C.OUT=OUT;signal.signal(signal.SIGTERM,lambda *_:need(False));signal.signal(signal.SIGALRM,lambda *_:need(False));signal.alarm(420);result={'mode':'sync-metadata-supplement','success':False,'oldStrictVerificationChanged':False,'liveSQLiteOrHistoricalRuntimeSQLiteOpened':False,'businessHTTPManualSyncBackfillRetryOrMailboxTestPerformed':False,'credentialsConfigurationOrContainersChanged':False,'secretRowsIdentifiersOrLogLinesPrinted':False}
 try:diagnose(result)
 except BaseException as error:result.update(failedStage=STAGE,safeExceptionType=type(error).__name__ if type(error).__name__ in {'RuntimeError','KeyError','ValueError','TypeError','OSError','TimeoutExpired'}else'OtherError')
 finally:C.OPS.L.private_write(OUT/'first-result.json',enc(result));C.OPS.L.seal(OUT);print(enc(dict(result,manifestSHA256=C.OPS.L.file_hash(OUT/'manifest.json'),resultSHA256=C.OPS.L.file_hash(OUT/'first-result.json'))).decode(),flush=True)
 return 0 if result['success']else 1
if __name__=='__main__':
 try:code=main()
 except BaseException:print('{"success":false,"safeFailure":"VOYAGEPLEX_942_SYNC_METADATA_SUPPLEMENT_PREFLIGHT_FAILED"}',flush=True);code=1
 sys.exit(code)
