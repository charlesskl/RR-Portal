"""Read only at most three failed rows and three safe settings; no mailbox calls."""
import contextlib,datetime,hashlib,importlib.util,json,os,pathlib,re,signal,sqlite3,sys
PIN=True;BRANCH='refs/heads/ops/voyageplex-size-fix-20261020';TARGET='6fc1143c0b39470d814caac553beaaf3bc2912e0'
ROOT=pathlib.Path('/opt/rr-portal');OUT=ROOT/'deploy/backups/voyageplex-xingxin-sections-20261021-03'
FINAL_SHA='b4796e4828b2482cf3fc4adbd859397ff3d2f5cd92aa1e6a61be26dc1adabdee';F=None;S=None
FINAL_PROOF=ROOT/'deploy/backups/voyageplex-xingxin-sections-20261021-02';FINAL_MANIFEST='c4e09164c33d705f24261f2166dc429a901074956a28f651b113a3c1f56a33bd';FINAL_RESULT='72bc8e18dad4d978c6de4e449fd4dc3f56298553fddf53ed6170ea7a358342e8'
ORIGINAL_CURSOR=1545369827
ERRORS={'邮件超过 40MiB':'message_size','无法读取有效的邮件元数据':'metadata','邮件正文读取失败，已保留收件时间供人工处理':'body_read','邮件解析内存超出单封预算，已隔离供人工处理':'parse_memory','邮件解析超过单封时间预算，已隔离供人工处理':'parse_timeout','邮件解析结果超过单封大小预算，已隔离供人工处理':'parse_result_size','邮件解析进程异常退出，已隔离供人工处理':'parse_process','邮件解析进程异常退出':'parse_process','邮件解析已取消':'parse_cancelled'}
ERRORS.update({'邮件中的业务附件均无法解析':'attachment_parse','文件为空':'empty_input','只支持 .eml 邮件文件':'invalid_input'})
STATUSES={'pending','duplicate','confirmed','duplicate_confirmed','failed','Pending'}
def need(value):
 if not value:raise RuntimeError('XINGXIN_FAILED_ROWS_READONLY_REJECTED')
def load(name,filename,sha):
 path=pathlib.Path(__file__).with_name(filename);need(path.is_file()and not path.is_symlink()and hashlib.sha256(path.read_bytes()).hexdigest()==sha);spec=importlib.util.spec_from_file_location(name,path);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module
def final_proof():
 root=FINAL_PROOF;need(root.is_dir()and not root.is_symlink()and root.stat().st_mode&0o077==0);need(S.digest(root/'manifest.json')==FINAL_MANIFEST and S.digest(root/'first-result.json')==FINAL_RESULT);manifest=json.loads((root/'manifest.json').read_bytes());need(type(manifest)is dict);items=list(root.rglob('*'));need(len(items)<=100000 and all(not p.is_symlink()and(p.is_dir()or p.is_file())and p.stat().st_mode&0o077==0 for p in items));need(set(manifest)=={str(p.relative_to(root))for p in items if p.is_file()and p!=root/'manifest.json'});need(all(S.safe_path(n)and type(h)is str and re.fullmatch('[a-f0-9]{64}',h)and S.digest(root/n)==h for n,h in manifest.items()));receipt=json.loads((root/'first-result.json').read_bytes());need(receipt.get('success')is True and receipt.get('naturalNextSuccessfulRoundObserved')is True and receipt.get('queue',{}).get('queueObservationValidated')is True);return manifest

def safe_date(value):
 if type(value)is not str or re.fullmatch('[0-9]{4}-[0-9]{2}-[0-9]{2}',value)is None:return None
 try:datetime.date.fromisoformat(value);return value
 except ValueError:return None

def public_row(row):
 error=row['Error']or'';status=row['Status'];return {'uid':row['UID'],'status':status if status in STATUSES else'other','receivedDate':safe_date(row['ReceivedDate']),'errorPresent':bool(error),'errorCategory':ERRORS.get(error,'unclassified_error'if error else'failed_without_error'),'fixedKnownError':error if error in ERRORS else None,'errorSHA256':hashlib.sha256(error.encode('utf-8')).hexdigest()}

def read_rows(db,original):
 prefix='%s:%s:'%(original['Address'],original['UidValidity']);records=[]
 query="SELECT MailboxKey,Company,MailOwnerId,Status,Error,MailReceivedDate FROM ImportEmailItems WHERE substr(MailboxKey,1,?)=? AND CAST(substr(MailboxKey,?) AS INTEGER)>? AND (Status='failed' OR (Error IS NOT NULL AND Error<>'')) ORDER BY MailboxKey LIMIT 4"
 rows=db.execute(query,(len(prefix),prefix,len(prefix)+1,ORIGINAL_CURSOR)).fetchall();need(len(rows)<=3)
 for key,company,owner,status,error,received in rows:
  suffix=key[len(prefix):];need(re.fullmatch('[1-9][0-9]{0,9}',suffix)is not None and ORIGINAL_CURSOR<int(suffix)<=4294967295 and company=='Xingxin'and owner==0);need(type(status)is str and len(status)<=128 and(error is None or type(error)is str and len(error.encode('utf-8'))<=65536));records.append({'UID':int(suffix),'Status':status,'Error':error,'ReceivedDate':received})
 need(len({r['UID']for r in records})==len(records));records.sort(key=lambda r:r['UID'])
 settings=db.execute('SELECT SyncIntervalMinutes,StartDate,SyncEnabled FROM MailSystemSettings WHERE Id=1').fetchall();need(len(settings)==1);interval,start,enabled=settings[0];need(type(interval)is int and 1<=interval<=1440 and safe_date(start)is not None and type(enabled)is int and enabled in(0,1));return records,{'SyncIntervalMinutes':interval,'StartDate':start,'SyncEnabled':bool(enabled)}

def snapshot(label,original):
 need(S.DB.is_file()and not S.DB.is_symlink())
 with contextlib.closing(sqlite3.connect(S.DB.as_uri()+'?mode=ro',uri=True,timeout=5))as db:
  db.execute('PRAGMA query_only=ON');db.execute('BEGIN');state=S.M.selected_state(db);key='%s:%s:%s'%(original['Address'],original['UidValidity'],S.UID);state['originalTargetRows']=S.M.rows(db,'SELECT Company,MailOwnerId,Status,Error FROM ImportEmailItems WHERE MailboxKey=?',(key,));records,settings=read_rows(db,original);need(db.execute('PRAGMA query_only').fetchone()[0]==1)
 need({r['Id']for r in state['states']}=={1,1002,1003,1005,1006});S.private(label+'-selected-state.private.json',state);name=label+'-failed-rows.private.json';S.private(name,records);need((OUT/name).stat().st_mode&0o777==0o600);S.private(label+'-safe-settings.private.json',settings);return state,records,settings

def timeout_handler(signum,frame):raise TimeoutError('FAILED_ROWS_READONLY_DEADLINE')
def main():
 global F,S
 need(PIN and sys.argv[1:]==['inspect']and os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_ATTEMPT')=='1');os.umask(0o077);OUT.mkdir(mode=0o700);F=load('reviewed_final_host','xingxin-final-library.py',FINAL_SHA);S=load('reviewed_recovery_guards','xingxin-recovery-library.py',F.HOST_SHA);F.S=S;S.OUT=OUT;S.COUNT=0;S.M=load('reviewed_mail_observation','mail-observation-library.py',S.LIB_SHA);S.M.capture=S.capture;S.M.private=S.private;signal.signal(signal.SIGALRM,timeout_handler);signal.alarm(150);result={'mode':'xingxin-three-failed-rows-and-safe-settings-readonly','success':False,'backfillCompleteUnknown':True,'imapHTTPFetchOrRetryCallsPerformed':False,'databaseConfigurationOrCursorWritesPerformed':False,'applicationContainerSignalsPerformed':False,'rawErrorTextSettingsJSONSecretsAddressesOrMailContentPrinted':False}
 try:
  manifest=S.verify_prior();first=S.verify_first_probe();previous=S.verify_previous_no_probe();recovery=F.proof();final_seal=final_proof();code,head=S.capture(['git','rev-parse','HEAD'],'current-reviewed-head');need(code==0 and head==((TARGET+'\n').encode()));deployed=S.sealed_json(manifest,'deployed.private.json');original=F.shared(S.sealed_json(manifest,'after/mail-state-before.private.json'));need(original['UidValidity']==1 and original['LastUid']==ORIGINAL_CURSOR);before,records,settings=snapshot('before',original);need(S.shared_facts(before,manifest)['automaticSyncRecoveryPassed']);runtime=S.parser_inspect(deployed);baseline=S.sealed_json(manifest,'baseline.private.json');need(S.M.environment(runtime)==S.M.environment(baseline['parserBefore']));after,current,current_settings=snapshot('after',original);final=S.parser_inspect(deployed);need(S.protected_selected(before)==S.protected_selected(after)and F.shared(after)['LastUid']>=F.shared(before)['LastUid']and F.same_runtime(runtime,final)and settings==current_settings);result.update(currentXingxin=S.shared_facts(after,manifest),failedRecords=[public_row(r)for r in current],failedRecordCount=len(current),knownFailedCountAtPriorAcceptance=3,failedRowsChangedBetweenReadTransactions=S.enc(records)!=S.enc(current),safeMailboxSettings=current_settings,selectedStateChanges=S.state_changes(before,after));need(result['currentXingxin']['automaticSyncRecoveryPassed']);code,head=S.capture(['git','rev-parse','HEAD'],'final-reviewed-head');need(code==0 and head==((TARGET+'\n').encode()));need(S.verify_prior()==manifest and S.verify_first_probe()==first and S.verify_previous_no_probe()==previous and F.proof()==recovery and final_proof()==final_seal);result.update(success=True,priorEvidenceSealsPreserved=True,usersExceptRoutineLoginSettingsNamespacesStrictlyUnchanged=True,parserContainerImageConfigEnvironmentAndSourceUnchanged=True,finalAcceptanceManifestSHA256=FINAL_MANIFEST,finalAcceptanceResultSHA256=FINAL_RESULT)
 except Exception as error:result.update(safeFailure='FAILED_ROWS_READONLY_INCOMPLETE',exceptionType=type(error).__name__ if type(error).__name__ in{'RuntimeError','OSError','ValueError','KeyError','OperationalError','TimeoutError'}else'Other')
 finally:
  signal.alarm(0);S.private('first-result.json',result);S.private('manifest.json',{str(p.relative_to(OUT)):S.digest(p)for p in OUT.rglob('*')if p.is_file()});public=dict(result,manifestSHA256=S.digest(OUT/'manifest.json'),resultSHA256=S.digest(OUT/'first-result.json'));need(len(S.enc(public))<=65536);print(S.enc(public).decode(),flush=True)
 return 0 if result['success']else 1
if __name__=='__main__':
 try:sys.exit(main())
 except Exception:print('{"success":false,"safeFailure":"FAILED_ROWS_READONLY_PREFLIGHT_REJECTED"}',flush=True);sys.exit(1)
