"""Read current recovery state; only the unchanged blocked UID permits a bounded sections probe."""
import contextlib,datetime,hashlib,importlib.util,json,os,pathlib,re,sqlite3,subprocess,sys
PIN=True;BRANCH='refs/heads/ops/voyageplex-size-fix-20261020'
ROOT=pathlib.Path('/opt/rr-portal');OUT=ROOT/'deploy/backups/voyageplex-xingxin-sections-20261021-01';PRIOR=ROOT/'deploy/backups/voyageplex-size-fix-20261020-release'
MANIFEST='1be739e39d1ab067bdaea80c245f2ed23923452191799ad302cd0b0bac782c53';RESULT='de20655ceccdcc0742a8ba1e9692c80a9e44d662a1b8059a2fdadde2cdea6805'
LIB_SHA='2c5675ab534d1fcac5f28698e5418daf3ca0366b549c0c9b78fb58d95e95d4c0';CHILD_SHA='22c6d39d28b99692d3d6f5d5f46afc47c45d7f477f41c97d2fa95218c451b526';SOURCE_SHA='c6246781845d4cd40439d7286c9f3afcfae0dcafc4b106de780bd715e3b201a9';DB=ROOT/'apps/船务部/VoyagePlex船务协同系统/data-runtime/voyageplex.db';UID=1545369828;M=None;COUNT=0
LOGS=tuple(stage+'-'+service+'-last24h.private.log'for stage in('before','after')for service in('voyageplex-api','voyageplex-parser'))
KNOWN_ERRORS=('无法读取有效的邮件元数据','邮件正文读取失败，已保留收件时间供人工处理','邮箱连接或读取失败，请检查账号、授权码和网络','本轮邮箱读取超时，请稍后重试','邮箱读取正在进行，请稍后重试','邮件超过 40MiB')
KINDS={'metadata','body_read','message_size','parse_timeout','parse_memory','parse_process','parse_result_size','parse_cancelled'}
FIRST_PROBE=ROOT/'deploy/backups/voyageplex-xingxin-after-size-fix-20261020-01';FIRST_MANIFEST='39963ac093f268d239c7840d7d6e021ea84fb63cac5ec1bfd454a522411c282e';FIRST_RESULT='31f985f4eb29e7bb0d9d99cb52f4f6f992c66639b324a9eaa3e4204638c2efb4'
PREVIOUS_NO_PROBE=ROOT/'deploy/backups/voyageplex-xingxin-after-size-fix-20261020-02';PREVIOUS_NO_MANIFEST='dde087f1d2d533f57e7f62159faabd8d45ac2ad0441798b51b734ae8dffa272f';PREVIOUS_NO_RESULT='25f6efd0e58fe826f303adedbc0e112d75681af3d7dce821ecc24554d1feae0e'
def need(value):
 if not value:raise RuntimeError('SEALED_XINGXIN_LOG_PROBE_REJECTED')
def enc(value):return json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=True,allow_nan=False).encode()
def digest(path):
 with path.open('rb')as stream:
  h=hashlib.sha256()
  for block in iter(lambda:stream.read(1024*1024),b''):h.update(block)
  return h.hexdigest()
def safe_path(name):return type(name)is str and all(re.fullmatch('[A-Za-z0-9_.-]+',p)and p not in{'.','..'}for p in name.split('/'))
def private(name,value):
 with(OUT/name).open('xb')as stream:stream.write(value if type(value)is bytes else enc(value));stream.flush();os.fsync(stream.fileno())
def capture(args,label,timeout=60,data=None):
 global COUNT
 need(re.fullmatch('[a-z0-9-]+',label)is not None);COUNT+=1;name='%04d-%s'%(COUNT,label)
 with(OUT/(name+'-stderr.private')).open('xb')as errors:result=subprocess.run(args,input=data,stdout=subprocess.PIPE,stderr=errors,cwd=ROOT,timeout=timeout)
 need(len(result.stdout)<=4*1024**2);private(name+'-stdout.private',result.stdout);return result.returncode,result.stdout
def verify_prior():
 need(PRIOR.is_dir()and not PRIOR.is_symlink()and PRIOR.stat().st_mode&0o077==0);need(digest(PRIOR/'manifest.json')==MANIFEST and digest(PRIOR/'first-result.json')==RESULT);manifest=json.loads((PRIOR/'manifest.json').read_bytes());need(type(manifest)is dict);items=list(PRIOR.rglob('*'));need(len(items)<=100000 and all(not p.is_symlink()and(p.is_file()or p.is_dir())and p.stat().st_mode&0o077==0 for p in items));need(set(manifest)=={str(p.relative_to(PRIOR))for p in items if p.is_file()and p!=PRIOR/'manifest.json'});need(all(safe_path(n)and type(h)is str and re.fullmatch('[a-f0-9]{64}',h)and digest(PRIOR/n)==h for n,h in manifest.items()));receipt=json.loads((PRIOR/'first-result.json').read_bytes());need(receipt.get('success')is False and receipt.get('parserHealthy')is True and receipt.get('parserSourceMatchesReviewedTarget')is True and receipt.get('target')=='6fc1143c0b39470d814caac553beaaf3bc2912e0');return manifest
def sealed_json(manifest,name):
 need(name in manifest and safe_path(name));blob=(PRIOR/name).read_bytes();need(len(blob)<=16*1024**2 and hashlib.sha256(blob).hexdigest()==manifest[name]);return json.loads(blob)
def verify_first_probe():
 root=FIRST_PROBE;need(root.is_dir()and not root.is_symlink()and root.stat().st_mode&0o077==0);need(digest(root/'manifest.json')==FIRST_MANIFEST and digest(root/'first-result.json')==FIRST_RESULT);manifest=json.loads((root/'manifest.json').read_bytes());need(type(manifest)is dict);items=list(root.rglob('*'));need(len(items)<=100000 and all(not p.is_symlink()and(p.is_file()or p.is_dir())and p.stat().st_mode&0o077==0 for p in items));need(set(manifest)=={str(p.relative_to(root))for p in items if p.is_file()and p!=root/'manifest.json'});need(all(safe_path(n)and type(h)is str and re.fullmatch('[a-f0-9]{64}',h)and digest(root/n)==h for n,h in manifest.items()));receipt=json.loads((root/'first-result.json').read_bytes());need(receipt.get('success')is True and receipt.get('parserContainerImageConfigEnvironmentAndSourceUnchanged')is True);return {'firstProbeFilesPreserved':len(manifest),'firstProbeManifestSHA256':FIRST_MANIFEST,'firstProbeResultSHA256':FIRST_RESULT}
def verify_previous_no_probe():
 root=PREVIOUS_NO_PROBE;need(root.is_dir()and not root.is_symlink()and root.stat().st_mode&0o077==0);need(digest(root/'manifest.json')==PREVIOUS_NO_MANIFEST and digest(root/'first-result.json')==PREVIOUS_NO_RESULT);manifest=json.loads((root/'manifest.json').read_bytes());need(type(manifest)is dict);items=list(root.rglob('*'));need(len(items)<=100000 and all(not p.is_symlink()and(p.is_file()or p.is_dir())and p.stat().st_mode&0o077==0 for p in items));need(set(manifest)=={str(p.relative_to(root))for p in items if p.is_file()and p!=root/'manifest.json'});need(all(safe_path(n)and type(h)is str and re.fullmatch('[a-f0-9]{64}',h)and digest(root/n)==h for n,h in manifest.items()));receipt=json.loads((root/'first-result.json').read_bytes());need(receipt.get('success')is True and receipt.get('mode')=='xingxin-no-detail-single-body-readonly');return {'previousNoProbeFilesPreserved':len(manifest),'previousNoProbeManifestSHA256':PREVIOUS_NO_MANIFEST,'previousNoProbeResultSHA256':PREVIOUS_NO_RESULT}
def log_facts(manifest,name):
 need(name in LOGS and name in manifest);path=PRIOR/name;need(path.stat().st_size<=64*1024**2 and digest(path)==manifest[name]);count=0;latest=[];get_status={};unattributed_status={};exceptions={};known=set();kinds=set();company_counts={};service='voyageplex-parser'if'-parser-'in name else'voyageplex-api';output=OUT/(name+'.safe-events.private.jsonl')
 with path.open('r',errors='replace')as stream,output.open('xb')as saved:
  for line in stream:
   need(len(line)<=2*1024**2)
   for phrase in KNOWN_ERRORS:
    if phrase in line:known.add(phrase)
   for kind in re.findall(r'["\']failure_kind["\']\s*:\s*["\']([a-z_]+)["\']',line):
    if kind in KINDS:kinds.add(kind)
   event=M.structured_event(line,service)
   if event is None:continue
   count+=1;saved.write(enc(event)+b'\n');company=event.get('companyDirectlyLogged');company_counts[company or'unattributed']=company_counts.get(company or'unattributed',0)+1
   for error in event['exceptionTypes']:exceptions[error]=exceptions.get(error,0)+1
   status=event.get('statusDirectlyLogged');is_get=event.get('method')=='GET'and event.get('route')=='/v1/mailbox/poll'and company=='Xingxin'
   if is_get and status is not None:get_status[str(status)]=get_status.get(str(status),0)+1
   elif status is not None and company is None:unattributed_status[str(status)]=unattributed_status.get(str(status),0)+1
   if company in{None,'Xingxin'}:latest.append(event);latest=latest[-8:]
  saved.flush();os.fsync(saved.fileno())
 return {'sourceSealedLogName':name,'sourceSealedLogSHA256':manifest[name],'bytes':path.stat().st_size,'safeEventCount':count,'directCompanyCounts':company_counts,'xingxinGetPollDirectStatusCounts':get_status,'responseStatusWithoutCompanyCannotBeAttributed':unattributed_status,'exceptionTypeCountsWithoutRequestAttribution':exceptions,'fixedErrorTemplatesSeenWithoutRequestAttribution':sorted(known),'fixedFailureKindsSeenWithoutRequestAttribution':sorted(kinds),'latestSafeEvents':latest,'fullSafeEventsPrivateSHA256':digest(output),'rawLinesOrQueryStringsPrinted':False,'crossLineRequestLinkNotProven':True}
def selected_state(label,original=None):
 need(DB.is_file()and not DB.is_symlink())
 with contextlib.closing(sqlite3.connect(DB.as_uri()+'?mode=ro',uri=True,timeout=10))as db:
  db.execute('PRAGMA query_only=ON');db.execute('BEGIN');state=M.selected_state(db);shared=original or next(row for row in state['states']if row['Id']==1);key='%s:%s:%s'%(shared['Address'],shared['UidValidity'],UID);state['originalTargetRows']=M.rows(db,'SELECT Company,MailOwnerId,Status,Error FROM ImportEmailItems WHERE MailboxKey=?',(key,));need(db.execute('PRAGMA query_only').fetchone()[0]==1)
 need({r['Id']for r in state['states']}=={1,1002,1003,1005,1006});private(label+'-selected-state.private.json',state);return state
def shared_facts(state,manifest):
 current=next(row for row in state['states']if row['Id']==1);old=sealed_json(manifest,'after/mail-state-before.private.json');matches=[row for row in old['states']if row.get('Id')==1];need(len(matches)==1);previous=matches[0]
 facts={'stateId':1,'capturedAtUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'lastUid':current['LastUid'],'uidValidity':current['UidValidity'],'lastSuccessAt':M.safe_date(current['LastSuccessAt']),'storedLastErrorSanitized':M.safe_last_error(current['LastError']),'blockedTargetUID':UID,'cursorAtOrBeyondTarget':current['LastUid']>=UID,'namespaceSameAsSealedRelease':all(current[k]==previous[k]for k in('Id','Address','UidValidity','MailboxIdentity','ConfigurationKey')),'cursorSameAsSealedRelease':current['LastUid']==previous['LastUid'],'storedErrorSameAsSealedRelease':current['LastError']==previous['LastError'],'onlySharedStateDetailsPrinted':True,'liveSQLiteQueryOnlyWalAware':True};rows=state.get('originalTargetRows',[]);owned=len(rows)==1 and rows[0]['Company']=='Xingxin'and rows[0]['MailOwnerId']==0;parsed=bool(owned and rows[0]['Status']in{'pending','duplicate','confirmed','duplicate_confirmed'}and not rows[0]['Error']);moment=current.get('LastSuccessAt');age=None
 if type(moment)is str and re.fullmatch(r'\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})?',moment):
  try:
   normalized=re.sub(r'\.([0-9]{1,9})',lambda match:'.'+(match[1]+'000000')[:6],moment).replace('Z','+00:00');timestamp=datetime.datetime.fromisoformat(normalized);timestamp=timestamp.replace(tzinfo=datetime.timezone.utc)if timestamp.tzinfo is None else timestamp;age=(datetime.datetime.now(datetime.timezone.utc)-timestamp).total_seconds()
  except ValueError:pass
 recent=age is not None and 0<=age<=900;facts.update(originalTargetExactKeyRowCount=len(rows),originalTargetDownloadedAndStored=owned,originalTargetParsedSuccessfully=parsed,originalTargetStatus=rows[0]['Status']if len(rows)==1 and rows[0]['Status']in{'pending','duplicate','confirmed','duplicate_confirmed','failed','Pending'}else None,originalTargetHasParseError=bool(rows[0]['Error']or rows[0]['Status']=='failed')if len(rows)==1 else None,lastSuccessAgeSeconds=round(age,3)if age is not None else None,lastSuccessRecent=recent,lastSuccessRecentThresholdSeconds=900,automaticSyncRecoveryPassed=bool(facts['namespaceSameAsSealedRelease']and facts['cursorAtOrBeyondTarget']and not current['LastError']and recent and parsed),backfillCompleteUnknown=True);return facts
def protected_selected(state):
 return {'usersExceptRoutineLastLoginAt':[{k:v for k,v in row.items()if k!='LastLoginAt'}for row in state['users']],'settings':state['settings'],'namespaces':[{k:row[k]for k in('Id','Address','UidValidity','MailboxIdentity','ConfigurationKey')}for row in state['states']]}
def state_changes(before,after):
 old={row['Id']:row for row in before['states']};new={row['Id']:row for row in after['states']};need(set(old)==set(new));result=[]
 for stateid in sorted(old):
  keys=[k for k in('LastUid','LastSuccessAt','LastError')if old[stateid].get(k)!=new[stateid].get(k)]
  if keys:result.append({'stateId':stateid,'changedStateFields':keys,'lastUidDelta':new[stateid]['LastUid']-old[stateid]['LastUid'],'changesObservedWithoutActorAttribution':True})
 return result
def parser_inspect(deployed):
 need(type(deployed.get('id'))is str and re.fullmatch('[a-f0-9]{64}',deployed['id'])and deployed.get('image')=='sha256:24b43679adaaba9de73bb17aed1aaa8a91cd353781c30464a1297e0d64e14f78');code,blob=capture(['docker','inspect',deployed['id']],'same-released-parser');need(code==0);rows=json.loads(blob);need(type(rows)is list and len(rows)==1);row=rows[0];labels=row['Config'].get('Labels')or{};need(row['Id']==deployed['id']and row['Image']==deployed['image']and row['State']['Running']and labels.get('com.docker.compose.project')=='rr-portal'and labels.get('com.docker.compose.service')=='voyageplex-parser');code,source=capture(['docker','exec','--user','0',row['Id'],'sha256sum','/app/app/mailbox.py'],'same-reviewed-mailbox-source');need(code==0 and source==((SOURCE_SHA+'  /app/app/mailbox.py\n').encode()));return row
def production_fetch(row,facts):
 if facts.get('automaticSyncRecoveryPassed'):return {'deferredAlreadyRecovered':True,'mailServersContacted':False,'originalFixedUidProbeNotNeeded':True}
 if not(facts['namespaceSameAsSealedRelease']and facts['uidValidity']==1 and facts['lastUid']==UID-1 and facts['storedLastErrorSanitized'].get('blockedUIDs')==[UID]):return {'deferredStateNoLongerMatchesFixedProbe':True,'mailServersContacted':False}
 memory=M.child_bootstrap_headroom({'voyageplex-parser':row})
 if not memory['enoughAtSamplingInstant']:return {'deferredInsufficientMemory':True,'memory':memory,'mailServersContacted':False}
 path=pathlib.Path(__file__).with_name('voyageplex-xingxin-sections-child-20261021.py');need(type(CHILD_SHA)is str and re.fullmatch('[a-f0-9]{64}',CHILD_SHA)and path.is_file()and not path.is_symlink()and digest(path)==CHILD_SHA);payload={'scope':'ops/voyageplex-size-fix-20261020','uid':UID,'expected_uid_validity':1,'after_uid':UID-1,'start_date':'2026-10-08'};code,blob=capture(['docker','exec','-i',row['Id'],'python3','-B','-c',path.read_text()],'single-xingxin-sections',180,enc(payload));need(code==0);report=json.loads(blob);need(type(report)is dict and report.get('scope')==BRANCH.removeprefix('refs/heads/')and report.get('uid')==UID and report.get('success')is True);private('single-xingxin-sections.private.json',report);return dict(report,bootstrapMemoryGuard=memory)
def main():
 global M
 need(PIN and sys.argv[1:]==['observe']and os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_ATTEMPT')=='1');os.umask(0o077);OUT.mkdir(mode=0o700);lib=pathlib.Path(__file__).with_name('mail-observation-library.py');need(lib.is_file()and not lib.is_symlink()and digest(lib)==LIB_SHA);spec=importlib.util.spec_from_file_location('safe_shared_log_library',lib);M=importlib.util.module_from_spec(spec);spec.loader.exec_module(M);M.capture=capture;M.private=private;result={'mode':'xingxin-current-recovery-or-fixed-uid-sections-readonly','success':False,'businessHttpMailboxSyncTestOrRetryCallsPerformed':False,'applicationContainerSignalsPerformed':False,'databaseConfigurationOrCursorWritesPerformed':False,'otherMailboxesContacted':False,'priorFailedReleaseReceiptChanged':False,'rawSecretsAddressesOrMailContentPrinted':False}
 try:
  manifest=verify_prior();first_probe=verify_first_probe();previous_no=verify_previous_no_probe();result['firstProbeEvidence']=first_probe;result['previousNoProbeEvidence']=previous_no;result['logs']=[log_facts(manifest,name)for name in LOGS];deployed=sealed_json(manifest,'deployed.private.json');originals=[row for row in sealed_json(manifest,'after/mail-state-before.private.json')['states']if row['Id']==1];need(len(originals)==1);original=originals[0];before=selected_state('before',original);result['currentXingxin']=shared_facts(before,manifest);runtime=parser_inspect(deployed);sealed_baseline=sealed_json(manifest,'baseline.private.json');need(M.environment(runtime)==M.environment(sealed_baseline['parserBefore']));result['singleProductionFetch']=production_fetch(runtime,result['currentXingxin']);after=selected_state('after',original);final=parser_inspect(deployed);result['selectedStateBeforeSHA256']=hashlib.sha256(enc(before)).hexdigest();result['selectedStateAfterSHA256']=hashlib.sha256(enc(after)).hexdigest();result['selectedStateByteIdenticalBeforeAndAfter']=enc(before)==enc(after);result['selectedStateChanges']=state_changes(before,after);result['backgroundStateChangesObservedWithoutActorAttribution']=True;result['currentXingxinAfter']=shared_facts(after,manifest);result['recoveryPassedBeforeProbe']=result['currentXingxin']['automaticSyncRecoveryPassed'];result['recoveryPassedAfterProbe']=result['currentXingxinAfter']['automaticSyncRecoveryPassed'];result['backfillCompleteUnknown']=True;result['originalTargetEvidenceChangedBeforeAfter']=before['originalTargetRows']!=after['originalTargetRows'];need(protected_selected(before)==protected_selected(after));need(all(runtime[k]==final[k]for k in('Id','Image','Config','HostConfig'))and sorted(runtime['Mounts'],key=enc)==sorted(final['Mounts'],key=enc)and all(runtime['State'].get(k)==final['State'].get(k)for k in('StartedAt','Running','OOMKilled'))and runtime['RestartCount']==final['RestartCount']);need(verify_prior()==manifest and verify_first_probe()==first_probe and verify_previous_no_probe()==previous_no);result.update(success=True,usersExceptRoutineLoginSettingsNamespacesStrictlyUnchanged=True,parserContainerImageConfigEnvironmentAndSourceUnchanged=True,sealedReleaseManifestSHA256=MANIFEST,sealedReleaseResultSHA256=RESULT,sealedReleaseFilesPreserved=len(manifest),realSharedRouteFromReviewedSource={'method':'GET','path':'/v1/mailbox/poll','queryParameterNames':['after_uid','start_date','company'],'company':'Xingxin','routeActivelyCalledByProbe':False},storedErrorDoesNotIdentifyUnderlyingException=True,itemLevelErrorsMayNotBeLogged=True)
 except Exception as error:result.update(safeFailure='XINGXIN_LOG_OR_CURSOR_OBSERVATION_INCOMPLETE',exceptionType=type(error).__name__ if type(error).__name__ in{'RuntimeError','OSError','ValueError','KeyError','OperationalError'}else'Other')
 finally:private('first-result.json',result);files={str(p.relative_to(OUT)):digest(p)for p in OUT.rglob('*')if p.is_file()};private('manifest.json',files);public=dict(result,manifestSHA256=digest(OUT/'manifest.json'),resultSHA256=digest(OUT/'first-result.json'));need(len(enc(public))<65536);print(enc(public).decode(),flush=True)
 return 0 if result['success']else 1
if __name__=='__main__':
 try:sys.exit(main())
 except Exception:print('{"success":false,"safeFailure":"XINGXIN_LOG_PROBE_PREFLIGHT_REJECTED"}',flush=True);sys.exit(1)
