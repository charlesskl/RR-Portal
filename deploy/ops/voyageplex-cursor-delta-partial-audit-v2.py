"""UNEXECUTED: classify one sealed retry under an external failed-partial anchor.

Never relabel the old receipt, write a business database, or infer an actor.
Never invent a parent seal. Requires a separately reviewed exact external
failed-partial result, seal, full-file manifest and tree-stamps receipt.
"""
import collections
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
RUN = ROOT/'deploy/backups/voyageplex-mail-recovery-20261019-complete-v3-runs/recover-39207261143'
OUTPUT = ROOT/'deploy/backups/voyageplex-cursor-delta-partial-audit-39207261143-v2'
LIB_COMMIT = '60f2441ee96b4e76e809462c4015f65944157eac'
LIB_SHA = '62e48a3c20d6ad515d36f6bf6b3a0d5e1f3d6d72838add882b0b9779449c0e72'
HEAD = 'f853c7a2ec47f3cff11e456f874218d2324ad217'
EXTERNAL_PIN_FROZEN = True
EXTERNAL = ROOT/'deploy/backups/voyageplex-partial-run-39207261143-reconciliation-20261019-v2'
EXTERNAL_RESULT_SHA = 'cd48f59deaf4522cdfa6b8713cafab45caf8a836e30adcd201bfa2a741acdd70'
EXTERNAL_SEAL_SHA = 'e1d4a7d2484fd4e663292407a255cc065ffc273f9ac6bac559f7fa02d9df21cb'
EXTERNAL_MANIFEST_SHA = '692a349cecb0470d60556a5b5ad54c795914f56bcf276462f8fa125cc163266b'
TRANSITION = ('onlyAllowedTargetTypedFieldsChanged','parsedMetadataAndFingerprintPassed',
              'otherExistingMailRowsIdentical','batchCountersAndAllOtherBatchFieldsPassed',
              'allCursorFieldsUnchangedDuringRetry','passed')
CURSOR_COLUMNS = {'Id','Address','MailboxIdentity','ConfigurationKey','UidValidity','LastUid','LastSuccessAt','LastError'}
CURSORS = {1:('Xingxin',0),1002:('Huadeng',2),1003:('Huadeng',3),1005:('Huadeng',5),1006:('Huadeng',6)}
DEADLINE = None


def require(value):
    if not value or DEADLINE is not None and time.monotonic() >= DEADLINE:
        raise ValueError('CURSOR_AUDIT_SAFETY_BOUND')


def regular(path):
    require(not path.is_symlink() and stat.S_ISREG(path.stat().st_mode))


def file_sha(path):
    regular(path); result = hashlib.sha256()
    with path.open('rb') as stream:
        while True:
            require(True); block = stream.read(1048576)
            if not block: break
            result.update(block)
    return result.hexdigest()


def unique_object(pairs):
    result = {}
    for key,value in pairs:
        require(key not in result); result[key] = value
    return result


def read_json(path, limit=65536):
    regular(path)
    with path.open('rb') as stream: raw = stream.read(limit+1)
    require(len(raw)<=limit)
    return json.loads(raw,object_pairs_hook=unique_object)


def library():
    result = subprocess.run(['git','-C',str(ROOT),'show',LIB_COMMIT+':deploy/ops/voyageplex-mail-recovery.py'],
                            stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=10)
    require(result.returncode==0 and len(result.stdout)<=262144 and hashlib.sha256(result.stdout).hexdigest()==LIB_SHA)
    lib={'__name__':'reviewed_cursor_audit_library'}
    exec(compile(result.stdout,'exact-reviewed-recovery','exec'),lib)
    lib['file_sha']=file_sha
    # These existing helpers are only called with closed, sealed snapshot paths.
    return lib


def time_key(value):
    """Compare EF UTC and RFC3339 timestamps without losing the seventh digit."""
    if not isinstance(value,str) or len(value)>64: return None
    match = re.fullmatch(r'(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.(\d{1,7}))?(Z|[+-]\d{2}:\d{2})?',value)
    if not match: return None
    try:
        instant=dt.datetime.fromisoformat(match[1]+'T'+match[2]+(match[4] or '+00:00').replace('Z','+00:00')).astimezone(dt.timezone.utc)
        return instant, int((match[3] or '').ljust(7,'0'))
    except ValueError: return None


def error_class(value):
    if value=='': return 'empty'
    if value=='邮箱同步失败，请检查邮箱设置或联系管理员': return 'generic-sync-error'
    if isinstance(value,str) and re.fullmatch(r'邮件 [0-9]+ (?:的收件时间读取失败，已保留断点等待重试|暂时读取失败，已保留断点等待重试)',value):
        return 'transient-read-error'
    return 'other-nonempty' if isinstance(value,str) else 'invalid'


def tree_stamps():
    require(not RUN.is_symlink() and RUN.is_dir())
    result={};total=0
    for path in [RUN,*sorted(RUN.rglob('*'))]:
        require(len(result)<10000 and not path.is_symlink());value=path.lstat()
        require(stat.S_ISREG(value.st_mode) or stat.S_ISDIR(value.st_mode))
        name='.' if path==RUN else path.relative_to(RUN).as_posix()
        result[name]=[value.st_dev,value.st_ino,value.st_size,value.st_mtime_ns,value.st_ctime_ns,value.st_mode,value.st_uid,value.st_gid]
        if stat.S_ISREG(value.st_mode):total+=value.st_size;require(total<=20*1024**3)
    return result


def checked_parent():
    """The name is retained for the common selection pipeline, never normal parent proof."""
    require(EXTERNAL_PIN_FROZEN and all(re.fullmatch('[a-f0-9]{64}',value) for value in
                                      [EXTERNAL_RESULT_SHA,EXTERNAL_SEAL_SHA,EXTERNAL_MANIFEST_SHA]))
    require(not EXTERNAL.is_symlink() and EXTERNAL.is_dir() and not (RUN/'seal.json').exists() and not (RUN/'seal.json').is_symlink())
    require(file_sha(EXTERNAL/'first-result.json')==EXTERNAL_RESULT_SHA and file_sha(EXTERNAL/'seal.json')==EXTERNAL_SEAL_SHA and
            file_sha(EXTERNAL/'partial-file-manifest.private.json')==EXTERNAL_MANIFEST_SHA)
    external_seal=read_json(EXTERNAL/'seal.json',4*1024*1024)
    require(isinstance(external_seal,dict) and external_seal.get('first-result.json')==EXTERNAL_RESULT_SHA and
            external_seal.get('partial-file-manifest.private.json')==EXTERNAL_MANIFEST_SHA and
            file_sha(EXTERNAL/'partial-tree-stamps.private.json')==external_seal.get('partial-tree-stamps.private.json'))
    parent=read_json(EXTERNAL/'first-result.json',2*1024*1024)
    require(all(parent.get(key) is True for key in ['reconciliationComplete','failedPartial','runtimeStableDuringCapture',
                    'oldTreesMetadataStableAfterSingleStreamingHash','noHistoricalRuntimeReconstructed','canSupportSeparatelyReviewedNarrowPartialRunException']) and
            all(parent.get(key) is False for key in ['success','allMailboxRecoveryVerified','oldRunReclassifiedAsSuccess',
                    'businessWrites','oldEvidenceWrites','apiOrIMAPCalls','originalParentSealPresent','originalParentFullSealVerified']) and
            parent.get('recoveryRunId')=='39207261143' and parent.get('sourceCommit')==LIB_COMMIT and parent.get('sourceSHA256')==LIB_SHA and
            parent.get('process',{}).get('helperAbsent') is True and parent.get('process',{}).get('scanComplete') is True and
            type(parent.get('fullOldByteHashPasses')) is int and parent.get('fullOldByteHashPasses')==1 and parent.get('oldPartialManifestSHA256')==EXTERNAL_MANIFEST_SHA and
            parent.get('runtimeBefore')==parent.get('runtimeAfter') and isinstance(parent.get('runtimeBefore'),dict) and
            parent['runtimeBefore'].get('head')==HEAD and type(parent.get('originalParentResultPresent')) is bool and
            parent['originalParentResultPresent']==(RUN/'first-result.json').is_file())
    attempts=parent.get('attempts')
    require(isinstance(attempts,list) and len(attempts)==10 and
            all(type(r.get('step')) is int and 1<=r['step']<=5000 and r.get('sealed') is True for r in attempts))
    indices=[row['step'] for row in attempts];require(indices==sorted(set(indices)))
    manifest=read_json(EXTERNAL/'partial-file-manifest.private.json',4*1024*1024)
    require(isinstance(manifest,dict) and 1<=len(manifest)<=10000 and 'seal.json' not in manifest)
    for name,item in manifest.items():
        require(isinstance(name,str) and name!='.' and not pathlib.PurePosixPath(name).is_absolute() and '..' not in pathlib.PurePosixPath(name).parts and
                isinstance(item,dict) and set(item)=={'size','sha256'} and type(item['size']) is int and 0<=item['size']<=20*1024**3 and
                isinstance(item['sha256'],str) and re.fullmatch('[a-f0-9]{64}',item['sha256']))
    expected_stamps=read_json(EXTERNAL/'partial-tree-stamps.private.json',4*1024*1024)
    actual_stamps=tree_stamps();require(expected_stamps==actual_stamps)
    files={name:value for name,value in actual_stamps.items() if stat.S_ISREG(value[5])}
    require(set(files)==set(manifest) and all(files[name][2]==item['size'] for name,item in manifest.items()))
    require({name.split('/')[1] for name in manifest if name.startswith('retry-attempts/')}=={'attempt-%04d'%i for i in indices})
    plan=RUN/'frozen-retry-plan';prefix='frozen-retry-plan/'
    require(file_sha(plan/'seal.json')==manifest.get(prefix+'seal.json',{}).get('sha256'))
    plan_seal=read_json(plan/'seal.json',4*1024*1024)
    require(plan_seal=={name[len(prefix):]:value['sha256'] for name,value in manifest.items() if name.startswith(prefix) and name!=prefix+'seal.json'})
    require(file_sha(plan/'items.private.json')==manifest.get(prefix+'items.private.json',{}).get('sha256'))
    items=read_json(plan/'items.private.json',2*1024*1024)
    require(isinstance(items,list) and len(items)<=5000 and max(indices)<=len(items))
    seen=set()
    for item in items:
        require(isinstance(item,dict) and type(item.get('id')) is int and item['id']>0 and item['id'] not in seen and
                item.get('owner') in {2,3,5,6} and re.fullmatch('[a-f0-9]{64}',str(item.get('rowSHA256'))) is not None)
        seen.add(item['id'])
    for index in indices:
        name='retry-attempts/attempt-%04d/attempt.private.json'%index
        require(file_sha(RUN/name)==manifest.get(name,{}).get('sha256'))
        require(read_json(RUN/name)=={**items[index-1],'head':HEAD})
    return {name:item['sha256'] for name,item in manifest.items()},parent


def original_map(lib):
    archive=lib['ORIGINAL_AUDIT']
    require(file_sha(archive/'seal.json')==lib['ORIGINAL_AUDIT_SEAL'] and file_sha(archive/'first-result.json')==lib['ORIGINAL_AUDIT_RESULT'])
    manifest=read_json(archive/'seal.json',4*1024*1024)
    require(manifest.get('first-result.json')==lib['ORIGINAL_AUDIT_RESULT'] and
            file_sha(archive/'original-six.private.json')==manifest.get('original-six.private.json'))
    rows=read_json(archive/'original-six.private.json')
    require(isinstance(rows,list) and len(rows)==6 and len({r.get('id') for r in rows})==6 and
            dict(collections.Counter(r.get('owner') for r in rows))=={2:2,3:2,5:2})
    return {r['id']:r for r in rows}


def select_attempt(manifest, originals):
    attempts=RUN/'retry-attempts'
    require(not attempts.is_symlink() and attempts.is_dir())
    candidates=[]
    for index,path in enumerate(sorted(attempts.iterdir())):
        require(index<100 and not path.is_symlink() and path.is_dir() and re.fullmatch('attempt-[0-9]{4}',path.name))
        prefix='retry-attempts/'+path.name+'/'
        for filename in ['result.json','attempt.private.json']:
            require(file_sha(path/filename)==manifest.get(prefix+filename))
        receipt=read_json(path/'result.json'); reserved=read_json(path/'attempt.private.json')
        transition=receipt.get('transition')
        if not (receipt.get('owner')==3 and receipt.get('status')==200 and receipt.get('attempted') is True and
                receipt.get('responseRecoveredExactlyOne') is True and receipt.get('passed') is False and
                receipt.get('transportOrResponseOutcomeUncertain',False) is False and
                isinstance(transition,dict) and set(transition)==set(TRANSITION) and
                all(type(transition[key]) is bool and transition[key]==(key not in {'allCursorFieldsUnchangedDuringRetry','passed'}) for key in TRANSITION)):
            continue
        require(reserved.get('authorizedOriginal') is True and reserved.get('owner')==3 and reserved.get('head')==HEAD and
                type(reserved.get('id')) is int and reserved['id'] in originals and originals[reserved['id']]['owner']==3 and
                reserved.get('rowSHA256')==originals[reserved['id']].get('beforeSHA256'))
        candidates.append((path,reserved,receipt))
    require(len(candidates)==1)
    return candidates[0]


def verify_step(path, manifest):
    require(not path.is_symlink() and path.is_dir())
    prefix='retry-attempts/'+path.name+'/'
    step=read_json(path/'seal.json',1048576)
    required={'before.sqlite3','after.sqlite3','before-snapshot.private.json','after-snapshot.private.json','attempt.private.json','result.json'}
    require(isinstance(step,dict) and set(step)==required and file_sha(path/'seal.json')==manifest.get(prefix+'seal.json'))
    for name,digest in step.items():
        require(re.fullmatch('[a-f0-9]{64}',digest) and digest==manifest.get(prefix+name) and file_sha(path/name)==digest)
    require({p.name for p in path.iterdir()}==required|{'seal.json'})
    meta=[]
    for name in ['before-snapshot.private.json','after-snapshot.private.json']:
        value=read_json(path/name)
        require(value.get('method')=='SQLite-online-backup-API' and value.get('integrityCheckOK') is True and
                value.get('transactionConsistentSQLiteSnapshot') is True and value.get('committedWALIncluded') is True and
                time_key(value.get('startedAtUtc')) is not None and time_key(value.get('finishedAtUtc')) is not None and
                time_key(value['startedAtUtc'])<=time_key(value['finishedAtUtc']))
        meta.append(value)
    require(time_key(meta[0]['finishedAtUtc'])<=time_key(meta[1]['startedAtUtc']))
    return meta


def full_index(lib,db,table):
    return lib['row_hash_index'](db,table)


def analyze(lib,path,reserved,original,metadata):
    before_path,after_path=path/'before.sqlite3',path/'after.sqlite3'
    transition=lib['retry_transition'](before_path,after_path,reserved['id'])
    require(set(transition)==set(TRANSITION) and all(type(transition[k]) is bool for k in TRANSITION))
    require(all(transition[k] for k in TRANSITION if k not in {'allCursorFieldsUnchangedDuringRetry','passed'}) and
            transition['allCursorFieldsUnchangedDuringRetry'] is False and transition['passed'] is False)
    with lib['connect'](before_path) as old,lib['connect'](after_path) as new:
        for db in (old,new):
            db.set_progress_handler(lambda: int(DEADLINE is not None and time.monotonic()>=DEADLINE),1000)
            require(db.execute('PRAGMA integrity_check').fetchone()[0]=='ok')
        schema=lambda db:list(db.execute('SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name'))
        require([tuple(r) for r in schema(old)]==[tuple(r) for r in schema(new)])
        target=lib['full_row_by_id'](old,'ImportEmailItems',reserved['id'])
        require(lib['row_sha'](target)==original['beforeSHA256'] and target['MailOwnerId']==3 and target['Company']=='Huadeng' and
                target['ImportBatchId']==original['batchId'] and target['MailboxKey'].rsplit(':',1)[-1]==str(original['uid']))
        cursors=lambda db:{r['Id']:dict(r) for r in db.execute('SELECT * FROM MailSyncStates')}
        left,right=cursors(old),cursors(new)
        require(set(left)==set(right) and set(CURSORS)<=set(left) and all(set(r)==CURSOR_COLUMNS for r in [*left.values(),*right.values()]))
        changed={key:[name for name in sorted(CURSOR_COLUMNS) if lib['typed'](left[key][name])!=lib['typed'](right[key][name])] for key in left}
        changed={key:names for key,names in changed.items() if names}
        private={'targetID':reserved['id'],'targetBeforeRowSHA256':lib['row_sha'](target),'cursorRowsBefore':left,'cursorRowsAfter':right,
                 'recomputedOriginalTransition':transition}
        identity=all(all(lib['typed'](a[name])==lib['typed'](right[key][name]) for name in CURSOR_COLUMNS-{'LastUid','LastSuccessAt','LastError'}) for key,a in left.items())
        all_no_regression=all(type(a['LastUid']) is int and type(right[key]['LastUid']) is int and
                              0<=a['LastUid']<=right[key]['LastUid']<=4294967295 for key,a in left.items())
        huadeng_same=all(key not in changed for key in (1002,1003,1005,1006))
        windows=(time_key(metadata[0]['startedAtUtc']),time_key(metadata[1]['finishedAtUtc']))
        details=[];compatible=identity and all_no_regression and bool(changed)
        advanced={}
        for key,names in changed.items():
            a,b=left[key],right[key];first,last=time_key(a['LastSuccessAt']),time_key(b['LastSuccessAt'])
            no_regression=type(a['LastUid']) is int and type(b['LastUid']) is int and 0<=a['LastUid']<=b['LastUid']<=4294967295
            success_forward=last is not None and (first is None and a['LastSuccessAt'] is None or first is not None and last>first)
            in_window=last is not None and windows[0]<=last<=windows[1]
            good=(key in CURSORS and set(names)<={'LastUid','LastSuccessAt','LastError'} and no_regression and
                  success_forward and in_window and isinstance(a['LastError'],str) and b['LastError']=='')
            compatible=bool(compatible and good)
            if key in CURSORS and no_regression and b['LastUid']>a['LastUid']:advanced[key]=(a,b)
            details.append({'cursorLogicalId':key,'changedFields':names,'uidNeverRegressed':no_regression,
                            'lastSuccessAtMovedForward':success_forward,'lastSuccessAtInsideSnapshotWindow':in_window,
                            'lastErrorBeforeClass':error_class(a['LastError']),'lastErrorAfterClass':error_class(b['LastError']),
                            'compatibleSuccessMetadataChange':bool(good)})
        old_items,new_items=full_index(lib,old,'ImportEmailItems'),full_index(lib,new,'ImportEmailItems')
        old_batches,new_batches=full_index(lib,old,'ImportBatches'),full_index(lib,new,'ImportBatches')
        added_ids=set(new_items)-set(old_items);added_batches=set(new_batches)-set(old_batches)
        counts=collections.defaultdict(collections.Counter);uids=collections.defaultdict(set);messages_ok=True
        for item_id in added_ids:
            require(True);row=lib['full_row_by_id'](new,'ImportEmailItems',item_id)
            matching=[key for key in advanced if CURSORS[key]==(row['Company'],row['MailOwnerId'])]
            if len(matching)!=1:messages_ok=False;continue
            key=matching[0];a,b=advanced[key];prefix=(('Huadeng:%d:%s:'%(row['MailOwnerId'],b['MailboxIdentity'])) if row['Company']=='Huadeng' else '')+b['Address']+':'+str(b['UidValidity'])+':'
            tail=row['MailboxKey'][len(prefix):] if isinstance(row['MailboxKey'],str) and row['MailboxKey'].startswith(prefix) else ''
            uid=int(tail) if re.fullmatch('[1-9][0-9]{0,9}',tail) else None
            batch=lib['full_row_by_id'](new,'ImportBatches',row['ImportBatchId'])
            exact_batch_scope=bool(batch and (batch['Company'],batch['MailOwnerId'])==(row['Company'],row['MailOwnerId'])==CURSORS[key])
            created=time_key(row['CreatedAt'])
            valid=type(uid) is int and a['LastUid']<uid<=b['LastUid'] and uid not in uids[key] and row['ImportBatchId'] in added_batches and row['Status'] in {'failed','pending','duplicate'} and exact_batch_scope and created is not None and windows[0]<=created<=windows[1]
            try:
                payload=json.loads(row['ResultJson']) if isinstance(row['ResultJson'],str) and len(row['ResultJson'])<=2097152 else {}
                fingerprint=row['Fingerprint'];valid_fingerprint=isinstance(fingerprint,str) and (re.fullmatch('[a-fA-F0-9]{64}',fingerprint) is not None or row['Status']=='failed' and fingerprint=='')
                valid=bool(valid and type(payload.get('mailbox_uid')) is int and payload['mailbox_uid']==uid and
                           payload.get('status')==('failed' if row['Status']=='failed' else 'parsed') and
                           lib['received_date'](payload.get('mailbox_received_at'))==row['MailReceivedDate']==lib['received_date'](row['MailReceivedAt']) and
                           lib['utc_date'](payload.get('mailbox_received_at'))==lib['utc_date'](row['MailReceivedAt']) and
                           valid_fingerprint and 'fingerprint' in payload and payload['fingerprint']==fingerprint)
            except (ValueError,TypeError,AttributeError,lib['CheckError']):valid=False
            messages_ok=bool(messages_ok and valid)
            if valid:
                uids[key].add(uid);counts[row['ImportBatchId']]['total']+=1
                counts[row['ImportBatchId']]['failed' if row['Status']=='failed' else 'parsed']+=1
        batch_equations=set(counts)==added_batches
        for batch_id in added_batches:
            row=lib['full_row_by_id'](new,'ImportBatches',batch_id);counter=counts[batch_id]
            matching=[key for key in advanced if CURSORS[key]==(row['Company'],row['MailOwnerId'])]
            members=list(new.execute('SELECT Id,Company,MailOwnerId,MailReceivedDate FROM ImportEmailItems WHERE ImportBatchId=?',(batch_id,)))
            batch_equations=bool(batch_equations and len(matching)==1 and row['Kind']=='Email' and row['Status']=='PendingConfirmation' and
                                 row['ParserVersion']=='mailbox-imap' and row['TotalCount']==counter['total'] and row['FailedCount']==counter['failed'] and
                                 row['ParsedCount']==counter['parsed'] and row['TotalCount']==row['FailedCount']+row['ParsedCount'] and
                                 len(members)==counter['total'] and all(r[0] in added_ids and (r[1],r[2])==(row['Company'],row['MailOwnerId']) and r[3]==row['MailReceivedDate'] for r in members) and
                                 time_key(row['CreatedAt']) is not None and windows[0]<=time_key(row['CreatedAt'])<=windows[1])
        uid_equation=all(bool(uids[key]) and max(uids[key])==b['LastUid'] for key,(a,b) in advanced.items())
        # Deliberately conservative without IMAP: a legal deleted/skipped UID
        # can make this false. It is not proof that an actual email is missing.
        consecutive=all(len(uids[key])==b['LastUid']-a['LastUid'] for key,(a,b) in advanced.items())
        classified=bool(compatible and messages_ok and batch_equations and uid_equation and consecutive)
        private.update({'addedMailIDs':sorted(added_ids),'addedBatchIDs':sorted(added_batches),'uidSetsByCursor':{key:sorted(value) for key,value in uids.items()}})
    safe={'strictAllCursorSame':False,'originalRetryReceiptPassed':False,'recomputedOriginalTransitionMatchesReceipt':True,
          'targetTypedFieldsMetadataFingerprintOtherMailsAndBatchProofPassed':True,'fourHuadengCursorsTypedIdentical':huadeng_same,
          'allCursorIdentitiesAndConfigurationTypedIdentical':identity,'allCursorUIDsNeverRegressed':all_no_regression,'changedCursors':details,
          'newMailCount':len(added_ids),'newBatchCount':len(added_batches),'newMessagesMatchChangedCursorNamespaceAndUIDBounds':messages_ok,
          'newBatchCountersExactlyMatchNewMailRows':batch_equations,'advancedCursorUIDsEqualMaximumProvenNewMessageUIDs':uid_equation,
          'newArchivedUIDsCoverEveryIntegerAdvancedInStep':consecutive,
          'targetTransitionAndClassifiedConcurrentCursor':classified,'actorProven':False,
          'classificationIsObservedCompatibilityNotProofOfBackgroundActor':True,'UIDRangeHasNotBeenComparedWithIMAP':True,
          'nonconsecutiveUIDsMayBeLegitimateIMAPGaps':True,
          'contactsAndOtherBusinessTablesNotClassified':True,'finalUIDCoverageProof':False}
    return safe,private


def main():
    global DEADLINE
    DEADLINE=time.monotonic()+480
    require(os.environ.get('MAILDIAG_BRANCH')=='refs/heads/ops/voyageplex-maildiag-20261019' and os.environ.get('MAILDIAG_ATTEMPT')=='1' and re.fullmatch('[a-f0-9]{40}',os.environ.get('MAILDIAG_REF','')))
    manifest,parent=checked_parent();lib=library();originals=original_map(lib)
    path,reserved,receipt=select_attempt(manifest,originals);metadata=verify_step(path,manifest)
    os.umask(0o077);OUTPUT.mkdir(mode=0o700)
    result={'completed':False,'sourceHead':HEAD,'recoveryRunId':'39207261143','recoveryHelperSHA256':LIB_SHA,
            'businessWrites':False,'oldEvidenceWrites':False,'liveDatabaseRead':False,'APIOrIMAPCalls':False,
            'oldParentReceiptOrSealsRewritten':False,'originalRetryReceiptReclassifiedAsPassed':False,'authorizesFurtherRetry':False,
            'normalParentResultAndSealPinsVerified':False,'originalParentSealPresent':False,
            'originalParentResultPresent':(RUN/'first-result.json').is_file(),'failedPartialStrict':True,
            'externalFailedPartialProvenanceVerified':True,'externalReconciliationReportedSuccess':False,
            'fullOldTreeHashPassObservedInExternalReceipt':True,'fullParentArchiveRehashed':False,
            'currentFullTreeStampsMatchExternalReceipt':True,'selectedStepFullSealVerified':True}
    try:
        safe,private=analyze(lib,path,reserved,originals[reserved['id']],metadata)
        lib['write_new'](OUTPUT/'evidence.private.json',{'ref':os.environ['MAILDIAG_REF'],'externalResultSHA256':EXTERNAL_RESULT_SHA,
            'externalSealSHA256':EXTERNAL_SEAL_SHA,'externalFileManifestSHA256':EXTERNAL_MANIFEST_SHA,
            'selectedStep':path.name,'reservation':reserved,'originalReceipt':receipt,**private})
        result.update(safe);result['completed']=True
    except Exception:result['safeFailure']='REDACTED_CURSOR_DELTA_AUDIT_FAILURE'
    finally:
        try:
            checked_parent();verify_step(path,manifest);original_map(lib)
            result['selectedRetainedEvidenceUnchanged']=True
        except Exception:
            result['completed']=False;result['targetTransitionAndClassifiedConcurrentCursor']=False;result['selectedRetainedEvidenceUnchanged']=False
        lib['write_new'](OUTPUT/'first-result.json',result);lib['seal'](OUTPUT);lib['emit'](result)
        lib['emit']({'kind':'receipt','resultSHA256':file_sha(OUTPUT/'first-result.json'),'sealSHA256':file_sha(OUTPUT/'seal.json')})
    return 0 if result['completed'] else 1


if __name__=='__main__':
    def interrupted(*_):raise TimeoutError()
    signal.signal(signal.SIGALRM,interrupted);signal.alarm(490)
    try:raise SystemExit(main())
    except Exception:
        print('{"failed":true,"reason":"REDACTED_CURSOR_AUDIT_SETUP_OR_SEAL_FAILURE","businessWrites":false}',flush=True)
        raise SystemExit(1)
