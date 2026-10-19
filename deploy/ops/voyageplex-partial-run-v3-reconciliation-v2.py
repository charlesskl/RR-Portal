"""External read-only preservation of exact run 39207261143, never a normal seal."""
import ast
import contextlib
import datetime as dt
import hashlib
import json
import os
import pathlib
import re
import signal
import sqlite3
import stat
import subprocess
import time

ROOT = pathlib.Path('/opt/rr-portal')
PROC = pathlib.Path('/proc')
RUN_ID = '39207261143'
RUN = ROOT/'deploy/backups/voyageplex-mail-recovery-20261019-complete-v3-runs'/('recover-'+RUN_ID)
OUTPUT = ROOT/'deploy/backups/voyageplex-partial-run-39207261143-reconciliation-20261019-v2'
BRANCH = 'refs/heads/ops/voyageplex-maildiag-20261019'
LIB_COMMIT = 'c94ea2e93f6ea81e24d409a188ff6fed31b35b07'
LIB_SHA = '59cec17eb70984e9b3b628c3c461f01cbf3358c1ffc46fe1c9a761a8c0d4b5ac'
SOURCE_COMMIT = '60f2441ee96b4e76e809462c4015f65944157eac'
SOURCE_SHA = '62e48a3c20d6ad515d36f6bf6b3a0d5e1f3d6d72838add882b0b9779449c0e72'
EXPECTED_HEAD = 'f853c7a2ec47f3cff11e456f874218d2324ad217'
IMAGES = {'api':'sha256:67b3b5aa27964341342ff0b3f67433a6297ae5a39278dcaeb3f43f5f1dfa7abd',
          'parser':'sha256:dde9f61a68de1fcbf118c1a9011335c671dde83f0a5ee6bb36e41060f60c04b9',
          'web':'sha256:7a84507a92eab5a0caaa2fe2b4048981a1cac5844210112e26b9ca4a315f843a'}
EXPECTED_ENV = {'MAIL_RECOVERY_SHA':SOURCE_COMMIT,
                'MAIL_RECOVERY_BRANCH':'refs/heads/ops/voyageplex-mail-recovery-20261019',
                'MAIL_RECOVERY_RUN_ID':RUN_ID,'MAIL_RECOVERY_ATTEMPT':'1','MAIL_RECOVERY_MODE':'recover'}
TRANSITION_KEYS = {'onlyAllowedTargetTypedFieldsChanged','parsedMetadataAndFingerprintPassed',
                   'otherExistingMailRowsIdentical','batchCountersAndAllOtherBatchFieldsPassed',
                   'allCursorFieldsUnchangedDuringRetry','passed'}
DEADLINE = None


def require(value):
    if not value: raise ValueError('PARTIAL_RUN_CAPTURE_SAFETY_BOUND')


def check_time():
    require(DEADLINE is None or time.monotonic() < DEADLINE)


def stamp(path):
    value=path.lstat()
    require(stat.S_ISREG(value.st_mode) or stat.S_ISDIR(value.st_mode))
    return [value.st_dev,value.st_ino,value.st_size,value.st_mtime_ns,value.st_ctime_ns,
            value.st_mode,value.st_uid,value.st_gid]


def read(path,cap=65536):
    before=stamp(path);require(stat.S_ISREG(before[5]) and before[2]<=cap)
    with path.open('rb') as stream: value=stream.read(cap+1)
    require(len(value)<=cap and stamp(path)==before);check_time()
    return value


def json_read(path,cap=65536):
    return json.loads(read(path,cap))


def file_hash(path):
    check_time();before=stamp(path);require(stat.S_ISREG(before[5]))
    value=hashlib.sha256()
    with path.open('rb') as stream:
        while True:
            check_time();block=stream.read(1048576)
            if not block:break
            value.update(block)
    require(stamp(path)==before)
    return {'size':before[2],'sha256':value.hexdigest()}


def tree_stamps(directory):
    root=stamp(directory);require(stat.S_ISDIR(root[5]))
    result={'.':root};total=0
    def failed(error):raise error
    for parent,dirs,files in os.walk(directory,followlinks=False,onerror=failed):
        check_time()
        for name in sorted(dirs+files):
            path=pathlib.Path(parent)/name;value=stamp(path)
            require(stat.S_ISDIR(value[5]) if name in dirs else stat.S_ISREG(value[5]))
            result[path.relative_to(directory).as_posix()]=value
            total+=value[2] if stat.S_ISREG(value[5]) else 0
            require(len(result)<=10000 and total<=20*1024**3)
    return result


def capture_tree(directory):
    before=tree_stamps(directory)
    manifest={name:file_hash(directory/name) for name,value in sorted(before.items()) if stat.S_ISREG(value[5])}
    require(tree_stamps(directory)==before)
    return manifest,before


def unchanged(directory,stamps):
    require(tree_stamps(directory)==stamps)
    return True


def submanifest(manifest,prefix):
    return {name[len(prefix):]:value for name,value in manifest.items() if name.startswith(prefix)}


def verify_manifest_seal(directory,manifest):
    require('seal.json' in manifest)
    expected=json_read(directory/'seal.json',16*1024**2)
    require(isinstance(expected,dict) and expected=={name:value['sha256'] for name,value in manifest.items() if name!='seal.json'})


def git_bytes(ref,path):
    require(re.fullmatch('[a-f0-9]{40}',ref) is not None)
    value=subprocess.run(['git','-C',str(ROOT),'show',ref+':'+path],stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,timeout=5)
    require(value.returncode==0 and len(value.stdout)<=262144)
    return value.stdout


def libraries():
    raw=git_bytes(LIB_COMMIT,'deploy/ops/voyageplex-mail-recovery.py')
    require(hashlib.sha256(raw).hexdigest()==LIB_SHA)
    lib={'__name__':'reviewed_readonly_library'};exec(compile(raw,'reviewed-helper','exec'),lib)
    source=git_bytes(SOURCE_COMMIT,'deploy/ops/voyageplex-mail-recovery.py')
    require(hashlib.sha256(source).hexdigest()==SOURCE_SHA)
    pins={}
    for node in ast.parse(source).body:
        if isinstance(node,ast.Assign) and len(node.targets)==1 and isinstance(node.targets[0],ast.Name) and node.targets[0].id in {'DEPLOYED_HEAD','SOURCE_FILES'}:
            pins[node.targets[0].id]=ast.literal_eval(node.value)
    require(pins.get('DEPLOYED_HEAD')==EXPECTED_HEAD and isinstance(pins.get('SOURCE_FILES'),dict) and pins['SOURCE_FILES'])
    lib['file_sha']=lambda path:file_hash(path)['sha256']
    return lib,pins


def process_facts():
    matches=[];uncertain=0;scanned=0
    for proc in PROC.iterdir():
        check_time()
        if not proc.name.isdigit():continue
        scanned+=1;require(scanned<=8192)
        candidate=False
        try:
            comm=read(proc/'comm',256).decode().strip()
            if re.fullmatch(r'python(?:[0-9]+(?:\.[0-9]+)*)?',comm) is None:continue
            argv=read(proc/'cmdline',8192).split(b'\0')
            if argv[-1:]==[b'']:argv.pop()
            if not (len(argv)==3 and pathlib.PurePosixPath(argv[0].decode()).name=='python3' and argv[2]==b'recover' and
                    re.fullmatch(rb'/tmp/mail-recovery\.[A-Za-z0-9]{6}/run\.py',argv[1])):continue
            candidate=True;env={}
            for item in read(proc/'environ',65536).split(b'\0'):
                key,sep,value=item.partition(b'=')
                if sep and key.decode('ascii','ignore') in EXPECTED_ENV:
                    key=key.decode('ascii');require(key not in env);env[key]=value.decode()
            if env.get('MAIL_RECOVERY_RUN_ID')!=RUN_ID:
                require('MAIL_RECOVERY_RUN_ID' in env);continue
            fields=read(proc/'stat',4096).rsplit(b')',1)[1].split()
            matches.append({'pid':int(proc.name),'startTicks':int(fields[19]),'exactSourceEnvironmentMatches':env==EXPECTED_ENV})
        except (FileNotFoundError,ProcessLookupError):
            # A vanished process is absent; a live candidate with unreadable identity is uncertain.
            if proc.exists():uncertain+=1
        except (OSError,ValueError,UnicodeError,IndexError):
            uncertain+=1
    return {'helperAbsent':not matches and uncertain==0,'fullProcessScanCompleted':uncertain==0,'scanComplete':uncertain==0,
            'matchingRunHelpers':len(matches),'uncertainProcesses':uncertain}, {'sameRunMatches':matches,'processesScanned':scanned}


def runtime(lib,pins):
    check_time();head=lib['command'](['git','-C',str(ROOT),'rev-parse','HEAD'],seconds=5,cap=128).decode().strip()
    require(head==EXPECTED_HEAD);matches={}
    for name,expected in pins['SOURCE_FILES'].items():
        require(name.startswith('apps/船务部/VoyagePlex船务协同系统/') and '..' not in pathlib.PurePosixPath(name).parts and re.fullmatch('[a-f0-9]{64}',expected) is not None)
        matches[name]=file_hash(ROOT/name)['sha256']==expected
    require(all(matches.values()))
    result={'head':head,'headMatchesExpected':True,'sourcePinsMatchExpected':True,'services':{},
            'provenance':'externally-observed-during-reconciliation','historicalInMemoryRuntimeProven':False}
    template='{"id":{{json .Id}},"name":{{json .Name}},"image":{{json .Image}},"running":{{json .State.Running}},"health":{{if .State.Health}}{{json .State.Health.Status}}{{else}}null{{end}},"restarts":{{.RestartCount}}}'
    for service,image in IMAGES.items():
        name='rr-portal-voyageplex-'+service+'-1'
        item=json.loads(lib['command'](['docker','inspect','--format',template,name],seconds=5,cap=4096))
        require(set(item)=={'id','name','image','running','health','restarts'} and item['name']=='/'+name and
                re.fullmatch('[a-f0-9]{64}',item['id']) is not None and item['image']==image and
                type(item['running']) is bool and type(item['restarts']) is int and item['restarts']>=0 and item['health'] in {'healthy','unhealthy','starting',None})
        result['services'][service]=item
    dll=lib['command'](['docker','exec',result['services']['api']['id'],'sha256sum','/app/VoyagePlex.Api.dll'],seconds=10,cap=256).decode().split()
    require(len(dll)==2 and re.fullmatch('[a-f0-9]{64}',dll[0]) is not None and dll[1]=='/app/VoyagePlex.Api.dll')
    result.update({'apiDLLSHA256':dll[0],'apiDLLByteSourceProofAvailable':False})
    return result,matches


def parse_date(value):
    require(isinstance(value,str) and len(value)<=64)
    match=re.fullmatch(r'(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(?:\.(\d{1,9}))?(Z|[+-]\d\d:\d\d)?',value);require(match is not None)
    fraction='.'+(match[2]+'000000')[:6] if match[2] else ''
    return dt.datetime.fromisoformat(match[1]+fraction+(match[3] or 'Z').replace('Z','+00:00')).astimezone(dt.timezone.utc)


def snapshot_metadata(path):
    value=json_read(path,2048)
    keys={'startedAtUtc','finishedAtUtc','method','committedWALIncluded','transactionConsistentSQLiteSnapshot','integrityCheckOK'}
    require(set(value)==keys and value['method']=='SQLite-online-backup-API' and all(value[k] is True for k in keys-{'startedAtUtc','finishedAtUtc','method'}))
    require(parse_date(value['startedAtUtc'])<=parse_date(value['finishedAtUtc']))
    return value


@contextlib.contextmanager
def closed_connect(path):
    require(stat.S_ISREG(stamp(path)[5]))
    for suffix in ['-wal','-shm','-journal']:
        other=path.with_name(path.name+suffix)
        require(not other.is_symlink() and (not other.exists() or stamp(other)[2]==0))
    with contextlib.closing(sqlite3.connect(path.as_uri()+'?mode=ro&immutable=1',uri=True)) as db:
        db.row_factory=sqlite3.Row;db.execute('PRAGMA query_only=ON');db.execute('BEGIN')
        db.set_progress_handler(lambda:int(DEADLINE is not None and time.monotonic()>=DEADLINE),1000)
        yield db


def row_hash(lib,row):
    return hashlib.sha256(lib['encoded']({key:lib['typed'](value) for key,value in dict(row).items()})).hexdigest()


def safe_receipt(path):
    value=json_read(path,4*1024**2);require(isinstance(value,dict))
    result={}
    for key in ['attempted','passed','responseRecoveredExactlyOne','transportOrResponseOutcomeUncertain','failedRequestOriginalRowsAndAllCursorsUnchanged']:
        if key in value:require(type(value[key]) is bool);result[key]=value[key]
    if 'status' in value:
        require(value['status'] is None or type(value['status']) is int and 100<=value['status']<=599);result['status']=value['status']
    if 'transition' in value:
        require(isinstance(value['transition'],dict) and set(value['transition'])==TRANSITION_KEYS and all(type(v) is bool for v in value['transition'].values()))
        result['transition']=value['transition']
    result['safeFailurePresent']=bool(value.get('safeFailure'))
    return result


def retained_evidence(lib,manifest):
    plan=RUN/'frozen-retry-plan';verify_manifest_seal(plan,submanifest(manifest,'frozen-retry-plan/'))
    snapshot_metadata(plan/'snapshot.private.json')
    items=json_read(plan/'items.private.json',2*1024**2);require(isinstance(items,list) and len(items)<=5000)
    byid={}
    for item in items:
        require(isinstance(item,dict) and type(item.get('id')) is int and item['id']>0 and item.get('owner') in {2,3,5,6} and
                re.fullmatch('[a-f0-9]{64}',str(item.get('rowSHA256'))) is not None and item['id'] not in byid)
        byid[item['id']]=item
    attempts=RUN/'retry-attempts'
    names={p.name for p in attempts.iterdir()}
    require(len(names)==10 and all(re.fullmatch(r'attempt-[0-9]{4}',name) and 1<=int(name[8:])<=len(items) for name in names))
    receipts=[];private=[]
    for name in sorted(names):
        index=int(name[8:]);check_time();step=attempts/name
        verify_manifest_seal(step,submanifest(manifest,step.relative_to(RUN).as_posix()+'/'))
        reservation=json_read(step/'attempt.private.json')
        require(isinstance(reservation,dict) and reservation.get('head')==EXPECTED_HEAD and reservation.get('id') in byid)
        selected=items[index-1]
        require(selected['id']==reservation['id'] and reservation=={**selected,'head':EXPECTED_HEAD})
        observed={}
        for side in ['before','after']:
            snapshot_metadata(step/(side+'-snapshot.private.json'))
            with closed_connect(step/(side+'.sqlite3')) as db:
                row=db.execute('SELECT * FROM ImportEmailItems WHERE Id=?',(reservation['id'],)).fetchone()
                require(row is not None);observed[side]=row_hash(lib,row)
        require(observed['before']==selected['rowSHA256'])
        receipt={'step':index,'owner':reservation['owner'],'sealed':True,**safe_receipt(step/'result.json')}
        receipts.append(receipt);private.append({'reservation':reservation,'observedTargetSHA256':observed})
    batchnames={name for name in manifest if re.fullmatch(r'batch-[0-9]{4}\.json',name)}
    require(batchnames=={'batch-%04d.json'%i for i in range(1,8)})
    batches=[]
    for name in sorted(batchnames):
        value=json_read(RUN/name,8192);require(isinstance(value,dict) and value.get('owner') in {2,3,5,6})
        safe={'owner':value['owner']}
        for key in ['blockedUIDPresent','errorPresent','configured','blockedCursorGuardPassed','batchSucceeded']:
            require(type(value.get(key)) is bool);safe[key]=value[key]
        for key in ['imported','newFailedDuringBatchInterval']:
            require(value.get(key) is None or type(value[key]) is int and 0<=value[key]<=5000);safe[key]=value.get(key)
        require(value.get('status') is None or type(value['status']) is int and 100<=value['status']<=599);safe['status']=value.get('status')
        batches.append(safe)
    return receipts,batches,{'frozenPlanItems':items,'retryTargets':private}


def sessions_evidence(lib,manifest):
    paths=[RUN/'frozen-retry-plan/current.sqlite3',RUN/'retry-attempts/attempt-0001/before.sqlite3']
    current_present='current.sqlite3' in manifest
    if current_present:paths.append(RUN/'current.sqlite3')
    scopes=[]
    for path in paths:
        with closed_connect(path) as db:
            require(db.execute('SELECT COUNT(*) FROM UserSessions').fetchone()[0]<=10000)
            scopes.append({row['Id']:dict(row) for row in db.execute('SELECT * FROM UserSessions')})
    old,first=scopes[:2];added=[row for key,row in first.items() if key not in old]
    retained=all(key in first and row_hash(lib,row)==row_hash(lib,first[key]) for key,row in old.items())
    identified=False;end=None
    if len(added)==1 and added[0].get('UserId')==2 and retained:
        item=added[0];start=parse_date(item['CreatedAt']);end=parse_date(item['ExpiresAt'])
        low=snapshot_metadata(RUN/'frozen-retry-plan/snapshot.private.json')
        high=snapshot_metadata(RUN/'retry-attempts/attempt-0001/before-snapshot.private.json')
        identified=((end-start).total_seconds()==1500 and parse_date(low['finishedAtUtc'])<=start<=parse_date(high['finishedAtUtc']) and
                    re.fullmatch('[A-F0-9]{64}',str(item.get('TokenHash'))) is not None)
    present=None
    if identified and current_present:
        matches=[row for row in scopes[2].values() if row.get('TokenHash')==added[0]['TokenHash']];require(len(matches)<=1);present=bool(matches)
    return {'exactOwnSessionIdentifiedFromRetainedSequence':identified,'createdSessionCandidates':len(added),
            'retainedCurrentSnapshotPresent':current_present,'ownSessionPresentInRetainedCurrentSnapshot':present,
            'ownSessionExpiredAtObservation':end<=dt.datetime.now(dt.timezone.utc) if identified else None,
            'ownSessionRemovalObservedInRetainedCurrentSnapshot':not present if present is not None else None,
            'retainedSnapshotIsNotLiveCurrentState':True,'sessionDeletionActorProven':False,'cleanupProven':False,
            'expiryDoesNotProveDeletion':True,'sessionsChangedByProbe':False}, {'sessionRowsByRetainedScope':scopes,'identifiedCreatedSession':added[0] if identified else None}


def main():
    global DEADLINE
    require(os.environ.get('MAILDIAG_BRANCH')==BRANCH and os.environ.get('MAILDIAG_ATTEMPT')=='1' and re.fullmatch('[a-f0-9]{40}',os.environ.get('MAILDIAG_REF','')) is not None)
    lib,pins=libraries();os.umask(0o077);OUTPUT.mkdir(mode=0o700)
    result={'reconciliationComplete':False,'failedPartial':True,'success':False,'allMailboxRecoveryVerified':False,
            'oldRunReclassifiedAsSuccess':False,'businessWrites':False,'oldEvidenceWrites':False,'apiOrIMAPCalls':False,
            'recoveryRunId':RUN_ID,'sourceCommit':SOURCE_COMMIT,'sourceSHA256':SOURCE_SHA,
            'observedPriorWorkflowExitStatus':137,'exitStatusSource':'reviewed-GitHub-Actions-log','exitStatusIndependentlyVerifiedByProbe':False,
            'originalParentFullSealVerified':False,'noHistoricalRuntimeReconstructed':True}
    stamps=None
    try:
        result['captureStage']='process-before'
        proc,private=process_facts();result['process']=proc;lib['write_new'](OUTPUT/'process-before.private.json',private)
        require(proc['helperAbsent'] and proc['fullProcessScanCompleted'])
        result['captureStage']='runtime-before'
        result['runtimeBefore'],matches=runtime(lib,pins)
        lib['write_new'](OUTPUT/'source-pins.private.json',{'sourceCommit':SOURCE_COMMIT,'sourceSHA256':SOURCE_SHA,'sourceFiles':pins['SOURCE_FILES'],'sourceFilesMatch':matches,'captureSourceCommit':os.environ['MAILDIAG_REF']})
        result['captureStage']='old-tree-streaming-hash'
        manifest,stamps=capture_tree(RUN)
        lib['write_new'](OUTPUT/'partial-file-manifest.private.json',manifest)
        lib['write_new'](OUTPUT/'partial-tree-stamps.private.json',stamps)
        result['originalParentSealPresent']='seal.json' in manifest
        result['originalParentResultPresent']='first-result.json' in manifest
        require(not result['originalParentSealPresent'])
        result['captureStage']='retained-steps-and-batches'
        result['attempts'],result['batchReceipts'],private=retained_evidence(lib,manifest)
        lib['write_new'](OUTPUT/'retained-targets.private.json',private)
        result['sealedAttempts']=len(result['attempts']);result['sealedSuccessfulSteps']=sum(r.get('passed') is True for r in result['attempts'])
        result['reportedRecoveredExactlyOneSteps']=sum(r.get('responseRecoveredExactlyOne') is True for r in result['attempts'])
        result['retainedFiles']={name:{'present':name in manifest,'size':manifest.get(name,{}).get('size')} for name in ['current.sqlite3','typed-tables.private.json','bindings-after.private.json','first-result.json']}
        result['captureStage']='retained-session-observation'
        result['sessions'],private=sessions_evidence(lib,manifest);lib['write_new'](OUTPUT/'sessions.private.json',private)
        result['captureStage']='runtime-after'
        result['runtimeAfter'],_=runtime(lib,pins)
        result['runtimeStableDuringCapture']=result['runtimeBefore']==result['runtimeAfter']
        result['captureStage']='process-after'
        after,private=process_facts();result['processAfter']=after;lib['write_new'](OUTPUT/'process-after.private.json',private)
        require(after['helperAbsent'] and after['fullProcessScanCompleted'])
        result['captureStage']='old-tree-final-stamps'
        result['oldTreesMetadataStableAfterSingleStreamingHash']=unchanged(RUN,stamps)
        result['oldPartialManifestSHA256']=file_hash(OUTPUT/'partial-file-manifest.private.json')['sha256']
        result['fullOldByteHashPasses']=1
        result['captureStage']='complete'
        result['reconciliationComplete']=True
        result['canSupportSeparatelyReviewedNarrowPartialRunException']=bool(result['runtimeStableDuringCapture'] and all(v['running'] and v['health']=='healthy' for v in result['runtimeAfter']['services'].values()))
    except Exception:
        result['safeFailure']='PARTIAL_RUN_RECONCILIATION_INCOMPLETE'
    finally:
        # Bounded receipt reserve; no more business or large-file processing.
        signal.alarm(0);DEADLINE=time.monotonic()+15
        # Final tree identity is checked before, never after, sealing the safe result.
        try:
            if stamps is not None:unchanged(RUN,stamps)
        except Exception:
            result['reconciliationComplete']=False;result['oldTreesMetadataStableAfterSingleStreamingHash']=False
            result['canSupportSeparatelyReviewedNarrowPartialRunException']=False;result['safeFailure']='PARTIAL_RUN_RECONCILIATION_INCOMPLETE'
        signal.alarm(0)
        lib['write_new'](OUTPUT/'first-result.json',result);lib['seal'](OUTPUT)
        lib['emit']({'section':'result','data':result})
        lib['emit']({'section':'receipt','data':{'resultSHA256':file_hash(OUTPUT/'first-result.json')['sha256'],'sealSHA256':file_hash(OUTPUT/'seal.json')['sha256']}})
    return 0 if result['reconciliationComplete'] else 1


if __name__=='__main__':
    DEADLINE=time.monotonic()+560
    def interrupted(*_):raise TimeoutError()
    signal.signal(signal.SIGTERM,interrupted);signal.signal(signal.SIGALRM,interrupted);signal.alarm(560)
    try:raise SystemExit(main())
    except Exception:
        print('{"failedPartial":true,"success":false,"safeFailure":"PARTIAL_RECONCILIATION_SETUP_OR_RECEIPT_FAILURE"}',flush=True)
        raise SystemExit(1)
