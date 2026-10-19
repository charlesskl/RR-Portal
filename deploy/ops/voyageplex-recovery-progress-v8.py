"""UNEXECUTED: light read-only recovery progress; never final preservation/coverage proof."""
import hashlib
import json
import os
import pathlib
import re
import select
import signal
import sqlite3
import stat
import subprocess
import time
from datetime import datetime

ROOT=pathlib.Path('/opt/rr-portal')
LIVE=ROOT/'apps/船务部/VoyagePlex船务协同系统/data-runtime/voyageplex.db'
BASELINE=ROOT/'deploy/backups/voyageplex-mail-recovery-20261019-complete-v3/baseline.sqlite3'
RUNS=ROOT/'deploy/backups/voyageplex-mail-recovery-20261019-complete-v3-runs'
MONITOR_PIN_FROZEN=True
EXPECTED_HEAD='f853c7a2ec47f3cff11e456f874218d2324ad217'
RECOVERY_REF='60f2441ee96b4e76e809462c4015f65944157eac'
RECOVERY_HELPER_SHA256='62e48a3c20d6ad515d36f6bf6b3a0d5e1f3d6d72838add882b0b9779449c0e72'
RUN_ID='39207261143'
DEADLINE=time.monotonic()+38
OWNERS=(2,3,5,6)
SERVICES=('voyageplex-api','voyageplex-parser','voyageplex-web')
TRANSITION_FIELDS=('onlyAllowedTargetTypedFieldsChanged','parsedMetadataAndFingerprintPassed',
                   'otherExistingMailRowsIdentical','batchCountersAndAllOtherBatchFieldsPassed',
                   'allCursorFieldsUnchangedDuringRetry','passed')


def require(value):
    if not value:raise ValueError()


def regular(path):
    return not path.is_symlink() and stat.S_ISREG(path.stat().st_mode)


def read(path,cap=4096):
    require(regular(path))
    with path.open('rb') as source:value=source.read(cap+1)
    require(len(value)<=cap)
    return value


def emit(section, value):
    line = json.dumps({'section': section, 'data': value}, ensure_ascii=True,
                      separators=(',', ':'), sort_keys=True, allow_nan=False)
    if len(line.encode()) > 6000:
        raise ValueError()
    print(line, flush=True)

def command(args, seconds=7, cap=32768):
    end = min(DEADLINE, time.monotonic() + seconds)
    process = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    output = bytearray()
    try:
        while True:
            remaining = end - time.monotonic()
            if remaining <= 0 or not select.select([process.stdout], [], [], remaining)[0]:
                return None
            block = os.read(process.stdout.fileno(), min(4096, cap - len(output) + 1))
            if not block:
                process.wait(timeout=max(.01, end - time.monotonic()))
                return bytes(output) if process.returncode == 0 else None
            output.extend(block)
            if len(output) > cap:
                return None
    finally:
        if process.poll() is None:
            process.kill()  # Diagnostic CLI only; never signal an application.
        process.wait(timeout=1)
        process.stdout.close()

def resources():
    memory = {}
    for line in read(pathlib.Path('/proc/meminfo'), 16384).decode().splitlines():
        match = re.fullmatch(r'(MemTotal|MemAvailable|SwapTotal|SwapFree):\s+([0-9]+) kB', line)
        if match:
            memory[match[1] + 'KiB'] = int(match[2])
    disk = os.statvfs(ROOT)
    emit('resources', {'memory': memory, 'diskTotalBytes': disk.f_blocks * disk.f_frsize,
                       'diskAvailableBytes': disk.f_bavail * disk.f_frsize,
                       'diskFreeInodes': disk.f_favail})

def frozen_source():
    require(MONITOR_PIN_FROZEN and re.fullmatch('[a-f0-9]{40}',EXPECTED_HEAD) and
            re.fullmatch('[a-f0-9]{40}',RECOVERY_REF) and re.fullmatch('[a-f0-9]{64}',RECOVERY_HELPER_SHA256) and
            re.fullmatch('[1-9][0-9]{5,19}',RUN_ID))
    head=command(['git','-C',str(ROOT),'rev-parse','HEAD'],seconds=4,cap=128)
    require(head is not None and head.decode().strip()==EXPECTED_HEAD)
    helper=command(['git','-C',str(ROOT),'show',RECOVERY_REF+':deploy/ops/voyageplex-mail-recovery.py'],seconds=5,cap=262144)
    require(helper is not None and hashlib.sha256(helper).hexdigest()==RECOVERY_HELPER_SHA256)
    emit('source',{'headMatchesExpected':True,'expectedHead':EXPECTED_HEAD,'expectedRecoverySourceObjectVerified':True,
                   'activeRecoveryProcessIdentityVerified':False})


def containers():
    template='{"image":{{json .Image}},"running":{{json .State.Running}},"health":{{if .State.Health}}{{json .State.Health.Status}}{{else}}"none"{{end}},"restarts":{{.RestartCount}},"oomKilled":{{json .State.OOMKilled}},"memoryLimitBytes":{{.HostConfig.Memory}}}'
    for service in SERVICES:
        raw=command(['docker','inspect','--format',template,'rr-portal-'+service+'-1'],seconds=3,cap=1024)
        value={'service':service,'available':False}
        try:
            record=json.loads(raw) if raw is not None else None
            require(isinstance(record,dict) and set(record)=={'image','running','health','restarts','oomKilled','memoryLimitBytes'} and
                    re.fullmatch('sha256:[a-f0-9]{64}',record['image']) and record['health'] in {'none','starting','healthy','unhealthy'} and
                    type(record['running']) is bool and type(record['oomKilled']) is bool and
                    all(type(record[key]) is int and record[key]>=0 for key in ['restarts','memoryLimitBytes']))
            value.update(record);value['available']=True
        except (ValueError,TypeError,KeyError):pass
        emit('container',value)
    raw=command(['docker','stats','--no-stream','--format','{{.Name}}|{{.CPUPerc}}|{{.MemPerc}}|{{.PIDs}}']+
                ['rr-portal-'+service+'-1' for service in SERVICES],seconds=4,cap=2048)
    records={}
    for line in raw.decode('ascii','replace').splitlines() if raw is not None else []:
        match=re.fullmatch(r'(rr-portal-voyageplex-(?:api|parser|web)-1)\|([0-9]{1,5}(?:\.[0-9]{1,3})?)%\|([0-9]{1,5}(?:\.[0-9]{1,3})?)%\|([0-9]{1,7})',line)
        if match and match[1] not in records:
            records[match[1]]={'cpuPercent':float(match[2]),'memoryPercent':float(match[3]),'pids':int(match[4])}
    for service in SERVICES:
        value=records.get('rr-portal-'+service+'-1');emit('containerResources',{'service':service,'available':value is not None,**(value or {})})


def canonical_date(value):
    if not isinstance(value,str) or re.fullmatch('[0-9]{4}-[0-9]{2}-[0-9]{2}',value) is None:return None
    try:datetime.strptime(value,'%Y-%m-%d');return value
    except ValueError:return None


def mailbox_progress():
    require(regular(LIVE) and regular(BASELINE))
    db=sqlite3.connect(LIVE.as_uri()+'?mode=ro',uri=True,timeout=2)
    try:
        db.execute('PRAGMA query_only=ON')
        db.set_progress_handler(lambda:1 if time.monotonic()>=DEADLINE else 0,1000)
        db.execute('ATTACH DATABASE ? AS baseline',(BASELINE.as_uri()+'?mode=ro&immutable=1',))
        db.execute('BEGIN')
        original={row[0]:row[1:] for row in db.execute("SELECT MailOwnerId,COUNT(*),SUM(Status='failed') FROM baseline.ImportEmailItems WHERE Company='Huadeng' AND MailOwnerId IN(2,3,5,6) AND MailboxKey<>'' GROUP BY MailOwnerId")}
        current={row[0]:row[1:] for row in db.execute("""SELECT i.MailOwnerId,COUNT(*),SUM(i.Status='failed'),SUM(i.Status IN('duplicate','duplicate_confirmed')),MAX(i.MailReceivedDate),SUM(b.Id IS NULL),SUM(b.Id IS NULL AND i.Status='failed') FROM main.ImportEmailItems i LEFT JOIN baseline.ImportEmailItems b ON b.Id=i.Id WHERE i.Company='Huadeng' AND i.MailOwnerId IN(2,3,5,6) AND i.MailboxKey<>'' GROUP BY i.MailOwnerId""")}
        old_failed={row[0]:row[1:] for row in db.execute("""SELECT b.MailOwnerId,SUM(i.Id IS NULL),SUM(i.Status='failed'),SUM(i.Status IN('pending','duplicate','confirmed','duplicate_confirmed')),SUM(i.Id IS NOT NULL AND (i.Company<>b.Company OR i.MailOwnerId<>b.MailOwnerId)) FROM baseline.ImportEmailItems b LEFT JOIN main.ImportEmailItems i ON i.Id=b.Id WHERE b.Company='Huadeng' AND b.MailOwnerId IN(2,3,5,6) AND b.MailboxKey<>'' AND b.Status='failed' GROUP BY b.MailOwnerId""")}
        cursors={row[0]-1000:row[1:] for row in db.execute("""SELECT s.Id,CASE WHEN coalesce(s.LastError,'')<>'' THEN 1 ELSE 0 END,t.SyncEnabled,CASE WHEN b.Id IS NULL THEN NULL WHEN s.UidValidity IS b.UidValidity AND s.MailboxIdentity IS b.MailboxIdentity THEN 0 ELSE 1 END,CASE WHEN b.Id IS NOT NULL AND s.UidValidity IS b.UidValidity AND s.MailboxIdentity IS b.MailboxIdentity THEN s.LastUid>b.LastUid ELSE NULL END FROM main.MailSyncStates s LEFT JOIN baseline.MailSyncStates b ON b.Id=s.Id LEFT JOIN main.MailSystemSettings t ON t.Id=s.Id WHERE s.Id IN(1002,1003,1005,1006)""")}
        for owner in OWNERS:
            before=original.get(owner,(0,0));now=current.get(owner,(0,0,0,None,0,0));failed=old_failed.get(owner,(0,0,0,0));cursor=cursors.get(owner)
            value={'owner':owner,'mailCount':now[0],'failedCount':now[1] or 0,'duplicateCount':now[2] or 0,'latestReceivedDate':canonical_date(now[3]),
                   'baselineMailCount':before[0],'baselineFailedCount':before[1] or 0,'newMailRecordsSinceBaseline':now[4] or 0,'newFailedRecordsSinceBaseline':now[5] or 0,
                   'baselineFailedStillFailed':failed[1] or 0,'baselineFailedNowParsedOrConfirmedStatus':failed[2] or 0,'baselineFailedRowsAbsent':failed[0] or 0,
                   'baselineFailedOwnerOrCompanyChanged':failed[3] or 0,'cursorAvailable':cursor is not None}
            if cursor is not None:
                value.update({'cursorId':1000+owner,'syncErrorPresent':bool(cursor[0]),'syncEnabled':None if cursor[1] is None else bool(cursor[1]),
                              'cursorNamespaceChangedSinceBaseline':None if cursor[2] is None else bool(cursor[2]),'cursorAdvancedSinceBaseline':None if cursor[3] is None else bool(cursor[3])})
            emit('mailboxProgress',value)
        db.rollback()
    finally:db.close()


def small_budget():
    return {'bytes':0,'entries':0,'reached':False}


def budget_entry(budget):
    if budget['reached'] or budget['entries']>=3000 or time.monotonic()>=DEADLINE:
        budget['reached']=True;return False
    budget['entries']+=1;return True


def small_receipt(path,budget):
    # Share the conservative cap, including the potential overflow byte.
    if budget['bytes']+4097>512*1024:
        budget['reached']=True;raise ValueError()
    budget['bytes']+=4097;return json.loads(read(path,4096))


def batch_progress(budget=None):
    if budget is None:budget=small_budget()
    run=RUNS/('recover-'+RUN_ID)
    require(not RUNS.is_symlink() and not run.is_symlink())
    value={'runAvailable':run.is_dir(),'reportedBatchReceipts':0,'reportedSuccessfulBatches':0,'reportedBlockedBatches':0,
           'reportedErrorBatches':0,'reportedImported':0,'reportedImportedUnknownBatches':0,'statusCounts':{},'unreadableOrInProgressReceipts':0,
           'symlinkOrNonregularReceiptsRejected':0,'scanComplete':False,'smallReadBudgetReached':False,
           'parentResultPresent':False,'parentSealPresent':False,'reportedOnlyNotFinal':True,'fullSealsVerified':False,'retryDetailsNotScannedInThisSection':True}
    if not run.is_dir():emit('batchProgress',value);return
    value['parentResultPresent']=(run/'first-result.json').is_file() and not (run/'first-result.json').is_symlink()
    value['parentSealPresent']=(run/'seal.json').is_file() and not (run/'seal.json').is_symlink()
    for path in run.iterdir():
        if not budget_entry(budget):break
        if re.fullmatch('batch-[0-9]{4}\.json',path.name) is None:continue
        try:
            if not regular(path):value['symlinkOrNonregularReceiptsRejected']+=1;continue
            row=small_receipt(path,budget)
            require(isinstance(row,dict) and type(row.get('owner')) is int and row.get('owner') in OWNERS and type(row.get('status')) is int and 100<=row['status']<=599 and
                    (row.get('imported') is None or type(row.get('imported')) is int and 0<=row['imported']<=5) and all(type(row.get(key)) is bool for key in
                    ['batchSucceeded','blockedUIDPresent','errorPresent']))
            value['reportedBatchReceipts']+=1;value['reportedImported']+=row.get('imported') or 0;value['reportedImportedUnknownBatches']+=row.get('imported') is None
            value['reportedSuccessfulBatches']+=row['batchSucceeded'];value['reportedBlockedBatches']+=row['blockedUIDPresent'];value['reportedErrorBatches']+=row['errorPresent']
            code=str(row['status']);value['statusCounts'][code]=value['statusCounts'].get(code,0)+1
        except (OSError,ValueError,TypeError):value['unreadableOrInProgressReceipts']+=1
    else:value['scanComplete']=True
    value['smallReadBudgetReached']=budget['reached']
    emit('batchProgress',value)


def retry_progress(budget=None):
    if budget is None:budget=small_budget()
    run=RUNS/('recover-'+RUN_ID);attempts=run/'retry-attempts'
    require(not RUNS.is_symlink() and not run.is_symlink())
    value={'runAvailable':run.is_dir(),'retryDirectoryPresent':False,'attemptDirectories':0,
           'beforeDatabasePresent':0,'beforeMetadataPresent':0,'afterDatabasePresent':0,'afterMetadataPresent':0,
           'resultPresent':0,'sealPresent':0,'resultWithoutSeal':0,'attemptsWithoutResult':0,
           'reportedRetryReceipts':0,'reportedHTTP200':0,'reportedPassed':0,'reportedAttempted':0,'reportedAttemptedUnknown':0,
           'reportedResponseRecoveredExactlyOne':0,'reportedUncertain':0,'statusCounts':{},'ownerCounts':{},'safeFailureCounts':{},
           'unreadableOrInProgressReceipts':0,'symlinkOrNonregularEntriesRejected':0,'scanComplete':False,
           'smallReadBudgetReached':False,'reportedOnlyNotFinal':True,'fullSealsVerified':False,
           'privateRetryDetailsNotRead':True,'existenceMarkersDoNotEstablishExecutionPhase':True,
           'transitionChecksByOwner':{str(owner):{field:{'missing':0,'invalid':0,'true':0,'false':0} for field in TRANSITION_FIELDS} for owner in OWNERS}}
    if not run.is_dir():emit('retryProgress',value);return
    try:mode=attempts.lstat().st_mode
    except FileNotFoundError:emit('retryProgress',value);return
    if not stat.S_ISDIR(mode):
        value['symlinkOrNonregularEntriesRejected']+=1;emit('retryProgress',value);return
    value['retryDirectoryPresent']=True
    markers={'before.sqlite3':'beforeDatabasePresent','before-snapshot.private.json':'beforeMetadataPresent',
             'after.sqlite3':'afterDatabasePresent','after-snapshot.private.json':'afterMetadataPresent',
             'result.json':'resultPresent','seal.json':'sealPresent'}
    for step in attempts.iterdir():
        if not budget_entry(budget):break
        if re.fullmatch('attempt-[0-9]{4}',step.name) is None:continue
        if not stat.S_ISDIR(step.lstat().st_mode):value['symlinkOrNonregularEntriesRejected']+=1;continue
        value['attemptDirectories']+=1;present={}
        for filename,key in markers.items():
            if not budget_entry(budget):break
            try:
                mode=(step/filename).lstat().st_mode;exists=stat.S_ISREG(mode)
                if not exists:value['symlinkOrNonregularEntriesRejected']+=1
            except FileNotFoundError:exists=False
            present[filename]=exists;value[key]+=exists
        if budget['reached']:break
        value['resultWithoutSeal']+=present['result.json'] and not present['seal.json']
        value['attemptsWithoutResult']+=not present['result.json']
        if not present['result.json']:continue
        try:
            row=small_receipt(step/'result.json',budget)
            require(isinstance(row,dict) and type(row.get('owner')) is int and row['owner'] in OWNERS and
                    (row.get('status') is None or type(row['status']) is int and 100<=row['status']<=599) and
                    all(type(row.get(key)) is bool for key in ['passed','responseRecoveredExactlyOne']) and
                    (row.get('attempted') is None or type(row['attempted']) is bool) and
                    type(row.get('transportOrResponseOutcomeUncertain',False)) is bool)
            value['reportedRetryReceipts']+=1;value['reportedHTTP200']+=row.get('status')==200
            value['reportedPassed']+=row['passed'];value['reportedAttempted']+=row.get('attempted') is True
            value['reportedAttemptedUnknown']+=row.get('attempted') is None
            value['reportedResponseRecoveredExactlyOne']+=row['responseRecoveredExactlyOne']
            value['reportedUncertain']+=row.get('transportOrResponseOutcomeUncertain',False)
            code='none' if row.get('status') is None else str(row['status']);owner=str(row['owner'])
            failure=row.get('safeFailure');failure='none' if failure is None else failure if failure=='RETRY_REQUEST_OR_PRECONDITION_FAILED' else 'unrecognized'
            for key,token in [('statusCounts',code),('ownerCounts',owner),('safeFailureCounts',failure)]:value[key][token]=value[key].get(token,0)+1
            transition=row.get('transition')
            for field in TRANSITION_FIELDS:
                state='missing' if 'transition' not in row or isinstance(transition,dict) and field not in transition else 'invalid'
                if isinstance(transition,dict) and type(transition.get(field)) is bool:state='true' if transition[field] else 'false'
                value['transitionChecksByOwner'][owner][field][state]+=1
        except (OSError,ValueError,TypeError):value['unreadableOrInProgressReceipts']+=1
        if budget['reached']:break
    else:value['scanComplete']=True
    value['smallReadBudgetReached']=budget['reached'];emit('retryProgress',value)


def main():
    require(os.environ.get('MAILDIAG_BRANCH')=='refs/heads/ops/voyageplex-maildiag-20261019' and os.environ.get('MAILDIAG_ATTEMPT')=='1' and
            re.fullmatch('[a-f0-9]{40}',os.environ.get('MAILDIAG_REF','')))
    frozen_source();mailbox_progress();budget=small_budget();batch_progress(budget);retry_progress(budget);containers();resources()
    emit('scope',{'readOnly':True,'businessWrites':False,'oldArtifactWrites':False,'rawLogsOrEnvironmentRead':False,
                  'fullOldSealsRehashed':False,'baselineArchiveNotReverifiedByMonitor':True,'finalPreservationOrUIDCoverageProof':False,
                  'existenceMarkersAreNotActiveExecutionProof':True,'sharedSmallFileByteBudget':512*1024,'sharedFilesystemEntryBudget':3000,
                  'elapsedSeconds':round(time.monotonic()-(DEADLINE-38),2)})


if __name__=='__main__':
    def interrupted(*_):raise TimeoutError()
    signal.signal(signal.SIGALRM,interrupted);signal.setitimer(signal.ITIMER_REAL,38)
    try:main()
    except Exception:
        emit('failure',{'readOnly':True,'reason':'REDACTED_LIGHT_PROGRESS_FAILURE','finalPreservationOrUIDCoverageProof':False})
        raise SystemExit(1)
    finally:signal.setitimer(signal.ITIMER_REAL,0)
