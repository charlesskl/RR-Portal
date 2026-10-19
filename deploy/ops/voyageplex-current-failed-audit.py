"""One exclusive current-failure snapshot; no API/IMAP/env/log/session access."""
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
OUTPUT = ROOT/'deploy/backups/voyageplex-current-failed-audit-20261019'
MAIN = 'f853c7a2ec47f3cff11e456f874218d2324ad217'
BRANCH = 'refs/heads/ops/voyageplex-maildiag-20261019'
LIB_COMMIT = 'c94ea2e93f6ea81e24d409a188ff6fed31b35b07'
LIB_SHA = '59cec17eb70984e9b3b628c3c461f01cbf3358c1ffc46fe1c9a761a8c0d4b5ac'
IMAGES = {'api':'sha256:67b3b5aa27964341342ff0b3f67433a6297ae5a39278dcaeb3f43f5f1dfa7abd',
          'parser':'sha256:dde9f61a68de1fcbf118c1a9011335c671dde83f0a5ee6bb36e41060f60c04b9'}
FAILURES = {'metadata','message_size','body_read','parse_memory','parse_timeout',
            'parse_result_size','parse_process','parse_cancelled'}
ERRORS = {'邮件中的业务附件均无法解析':'all_business_attachments_unparseable',
          '邮件超过 25MB':'legacy_message_size','邮件超过 40MB':'message_size',
          '邮件正文读取失败，已保留收件时间供人工处理':'body_read',
          '邮件解析内存超出单封预算，已隔离供人工处理':'parse_memory',
          '邮件解析超过单封时间预算，已隔离供人工处理':'parse_timeout',
          '邮件解析结果超过单封大小预算，已隔离供人工处理':'parse_result_size',
          '邮件解析进程异常退出，已隔离供人工处理':'parse_process','邮件解析已取消':'parse_cancelled'}
LIMIT, JSON_LIMIT = 5000, 2097152
DEADLINE = None


def check(condition=True):
    if not condition or DEADLINE is not None and time.monotonic() >= DEADLINE:
        raise ValueError('CURRENT_FAILURE_AUDIT_SAFETY_BOUND')


def digest(path):
    check(not path.is_symlink() and stat.S_ISREG(path.stat().st_mode))
    value=hashlib.sha256()
    with path.open('rb') as stream:
        while True:
            check();block=stream.read(1048576)
            if not block:break
            value.update(block)
    return value.hexdigest()


def library():
    result=subprocess.run(['git','-C',str(ROOT),'show',LIB_COMMIT+':deploy/ops/voyageplex-mail-recovery.py'],
                          stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=5)
    check(result.returncode==0 and len(result.stdout)<=262144 and hashlib.sha256(result.stdout).hexdigest()==LIB_SHA)
    lib={'__name__':'fixed_readonly_library'};exec(compile(result.stdout,'fixed-helper','exec'),lib)
    lib['file_sha']=digest  # Deadline-aware hashes of THIS archive only; no old seals.
    return lib


def runtime(lib):
    check();head=lib['command'](['git','-C',str(ROOT),'rev-parse','HEAD'],seconds=3,cap=128).decode().strip()
    check(head==MAIN);result={'head':head,'services':{}}
    template='{"id":{{json .Id}},"name":{{json .Name}},"image":{{json .Image}},"running":{{json .State.Running}},"restarts":{{.RestartCount}},"health":{{if .State.Health}}{{json .State.Health.Status}}{{else}}null{{end}}}'
    for service,image in IMAGES.items():
        check();name='rr-portal-voyageplex-'+service+'-1'
        value=json.loads(lib['command'](['docker','inspect','--format',template,name],seconds=3,cap=4096))
        check(set(value)=={'id','name','image','running','restarts','health'} and value['name']=='/'+name
              and re.fullmatch('[a-f0-9]{64}',value['id']) is not None and value['image']==image
              and type(value['running']) is bool and type(value['restarts']) is int
              and value['health'] in {'healthy','unhealthy','starting',None})
        result['services'][service]=value
    return result


def snapshot(lib):
    destination=OUTPUT/'current.sqlite3'
    with destination.open('xb'):pass
    destination.chmod(0o600);started=dt.datetime.now(dt.timezone.utc).isoformat()
    with lib['connect']() as source,contextlib.closing(sqlite3.connect(destination)) as target:
        source.execute('PRAGMA busy_timeout=1000')
        source.backup(target,pages=128,progress=lambda *_:check(),sleep=.02)
    with lib['connect'](destination) as db:
        db.set_progress_handler(lambda: int(DEADLINE is not None and time.monotonic()>=DEADLINE),1000)
        check(db.execute('PRAGMA integrity_check').fetchone()[0]=='ok')
    return {'startedAtUtc':started,'finishedAtUtc':dt.datetime.now(dt.timezone.utc).isoformat(),
            'method':'SQLite-online-backup-API','committedWALIncluded':True,
            'transactionConsistentSQLiteSnapshot':True,'integrityCheckOK':True}


def utc(value):
    # RFC3339 comparison uses Python's microsecond precision; original full
    # timestamp strings remain covered by the private complete typed row hash.
    if not isinstance(value,str) or len(value)>64:return None
    match=re.fullmatch(r'(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})',value)
    if not match:return None
    fraction='.'+(match[2]+'000000')[:6] if match[2] else ''
    try:return dt.datetime.fromisoformat(match[1]+fraction+match[3].replace('Z','+00:00')).astimezone(dt.timezone.utc)
    except ValueError:return None


def json_object(raw):
    try:value=json.loads(raw)
    except (ValueError,TypeError,RecursionError):return {},'invalid'
    return (value,'object') if isinstance(value,dict) else ({},'other-shape')


def summary(item):
    value,state=json_object(item['ResultJson'])
    failure=value.get('failure_kind');error=ERRORS.get(item['Error'],'other_nonempty' if item['Error'] else 'none')
    failure=failure if isinstance(failure,str) and failure in FAILURES else ('all_business_attachments_unparseable' if error=='all_business_attachments_unparseable' else 'other')
    status=value.get('status');status=status if isinstance(status,str) and status in {'failed','parsed','duplicate','pending'} else 'unknown'
    attachments=value.get('attachments');attachments=attachments if isinstance(attachments,list) else []
    message=value.get('message');message=message if isinstance(message,dict) else {}
    source_attachments=message.get('attachments');source_attachments=source_attachments if isinstance(source_attachments,list) else []
    check(len(attachments)<=LIMIT and len(source_attachments)<=LIMIT)
    return {'failureKind':failure,'staticErrorClass':error,'resultJSONState':state,'parserStatus':status,
            'attachmentCount':len(attachments),'sourceAttachmentCount':len(source_attachments),
            'failedAttachmentCount':sum(isinstance(a,dict) and (a.get('status')=='failed' or a.get('kind')=='failed') for a in attachments)},value


class _ObjectPairs(list):
    pass


def secondary_ids(raw):
    """Mirror the API's conservative SourceEmailsJson structural gate."""
    if not isinstance(raw,str) or len(raw.encode())>64*1024:return None
    def reject(_):raise ValueError()
    def bounded(value,depth=1):
        if not isinstance(value,list):return True
        if depth>8:return False
        children=(child for _,child in value) if isinstance(value,_ObjectPairs) else value
        return all(bounded(child,depth+1) for child in children)
    try:
        refs=json.loads(raw,object_pairs_hook=_ObjectPairs,parse_constant=reject)
        if type(refs) is not list or not bounded(refs):return None
        result=set()
        for source in refs:
            if not isinstance(source,_ObjectPairs):return None
            ids=[value for key,value in source if key=='id']
            if len(ids)!=1 or type(ids[0]) is not int or not 1<=ids[0]<=9223372036854775807:return None
            result.add(ids[0])
        return result
    except (ValueError,TypeError,RecursionError):return None


def task_references(db):
    selected=db.execute("SELECT Id,length(CAST(SourceEmailsJson AS BLOB)) AS bytes FROM ShipmentTasks WHERE Company='Huadeng' LIMIT ?",(LIMIT+1,)).fetchall()
    check(len(selected)<=LIMIT and sum(r['bytes'] or 0 for r in selected)<=JSON_LIMIT)
    direct_rows=db.execute('SELECT SourceImportItemId FROM ShipmentTasks WHERE SourceImportItemId IS NOT NULL LIMIT ?',(LIMIT+1,)).fetchall()
    check(len(direct_rows)<=LIMIT)
    direct={r[0] for r in direct_rows if type(r[0]) is int};secondary=set();known=True
    for row in selected:
        check()
        raw=db.execute('SELECT SourceEmailsJson FROM ShipmentTasks WHERE Id=?',(row['Id'],)).fetchone()[0]
        refs=secondary_ids(raw)
        if refs is None:known=False;continue
        secondary.update(refs)
    return direct,secondary,known


def analyze(lib,path):
    private=[];public=[]
    with lib['connect'](path) as db:
        db.set_progress_handler(lambda: int(DEADLINE is not None and time.monotonic()>=DEADLINE),1000)
        db.execute('BEGIN')
        selected=db.execute("SELECT Id,length(CAST(ResultJson AS BLOB)) AS bytes FROM ImportEmailItems WHERE Company='Huadeng' AND MailOwnerId IN (2,3,5,6) AND Status='failed' ORDER BY MailOwnerId,Id LIMIT ?",(LIMIT+1,)).fetchall()
        check(len(selected)<=LIMIT and all(0<=(r['bytes'] or 0)<=JSON_LIMIT for r in selected) and sum(r['bytes'] or 0 for r in selected)<=JSON_LIMIT)
        direct,secondary,known=task_references(db)
        bindings={}
        for owner,(username,address) in lib['OWNERS'].items():
            user=db.execute('SELECT Username,MailboxAddress,IsActive,Role,CompanyAccess FROM Users WHERE Id=?',(owner,)).fetchone()
            state=db.execute('SELECT Address,MailboxIdentity,UidValidity,LastUid FROM MailSyncStates WHERE Id=?',(1000+owner,)).fetchone()
            setting=db.execute('SELECT StartDate FROM MailSystemSettings WHERE Id=?',(1000+owner,)).fetchone()
            identity=hashlib.sha256(json.dumps({'address':address,'host':'imap.163.com','folder':'INBOX'},separators=(',',':')).encode()).hexdigest().upper()
            check(user is not None and state is not None and setting is not None)
            matching=(user['Username']==username and user['MailboxAddress']==address==state['Address'] and state['MailboxIdentity']==identity
                      and user['IsActive']==1 and (user['Role']=='admin' or user['CompanyAccess'] in {'Huadeng','Both'})
                      and type(state['UidValidity']) is int and 1<=state['UidValidity']<=4294967295
                      and type(state['LastUid']) is int and 0<=state['LastUid']<=4294967295)
            bindings[owner]=(state,setting,matching)
        for entry in selected:
            check();row=db.execute('SELECT * FROM ImportEmailItems WHERE Id=?',(entry['Id'],)).fetchone();item=dict(row)
            owner=item['MailOwnerId'];state,setting,bound=bindings[owner];safe,value=summary(item)
            prefix='Huadeng:%d:%s:%s:%s:'%(owner,state['MailboxIdentity'],state['Address'],state['UidValidity'])
            key=item['MailboxKey'];tail=key[len(prefix):] if isinstance(key,str) and key.startswith(prefix) else ''
            uid=int(tail) if re.fullmatch('[1-9][0-9]{0,9}',tail) and int(tail)<=4294967295 else None
            identity_ok=bool(bound and uid is not None and uid<=state['LastUid'])
            received=utc(item['MailReceivedAt']);date=item['MailReceivedDate']
            date_ok=bool(received and (received+dt.timedelta(hours=8)).date().isoformat()==date and setting['StartDate']=='2026-10-08' and date>='2026-10-08')
            parser_uid=value.get('mailbox_uid');parser_received=utc(value.get('mailbox_received_at'))
            uid_matches=(type(parser_uid) is int and parser_uid==uid) if 'mailbox_uid' in value else None
            metadata_matches=(parser_received is not None and parser_received==received) if 'mailbox_received_at' in value else None
            try:
                raw_tasks=item['TaskIdsJson']
                task_ids=json.loads(raw_tasks) if isinstance(raw_tasks,str) and len(raw_tasks.encode())<=4096 else None
                empty_tasks=isinstance(task_ids,list) and task_ids==[]
            except (ValueError,TypeError,RecursionError):empty_tasks=False
            unhandled=(item['HandlingStatus']=='Pending' and item['HandlingOutcome']=='' and item['WorkNote']==''
                       and item['ReviewedAt'] is None and str(item['ClassificationSource']).casefold()!='manual' and empty_tasks)
            no_direct=item['Id'] not in direct;no_secondary=(item['Id'] not in secondary) if known else None
            batch=db.execute('SELECT * FROM ImportBatches WHERE Id=?',(item['ImportBatchId'],)).fetchone()
            batch_ok=bool(batch and (batch['Kind'],batch['Status'],batch['Company'],batch['MailOwnerId'])==('Email','PendingConfirmation','Huadeng',owner))
            flags={'identityMatching':identity_ok,'receivedDateInRequestedRange':date_ok,'parserUIDMatchesRecord':uid_matches,
                   'parserMetadataInstantMatchesRecord':metadata_matches,'unhandled':unhandled,
                   'noDirectTaskReference':no_direct,'noSecondaryTaskReference':no_secondary,'batchHandlingMatches':batch_ok}
            public.append({'owner':owner,**safe,**flags})
            private.append({'id':item['Id'],'owner':owner,'company':item['Company'],'mailboxKey':key,'uid':uid,
                'uidValidity':state['UidValidity'],'mailboxIdentity':state['MailboxIdentity'],'address':state['Address'],
                'receivedAt':item['MailReceivedAt'],'receivedDate':date,'batchId':item['ImportBatchId'],
                'rowSHA256':hashlib.sha256(lib['encoded']({k:lib['typed'](v) for k,v in item.items()})).hexdigest(),
                'batchRowSHA256':hashlib.sha256(lib['encoded']({k:lib['typed'](v) for k,v in dict(batch).items()})).hexdigest() if batch else None,
                **flags,**safe})
        db.rollback()
    by_owner=[]
    for owner in lib['OWNERS']:
        rows=[r for r in public if r['owner']==owner]
        flags=['identityMatching','receivedDateInRequestedRange','parserUIDMatchesRecord','parserMetadataInstantMatchesRecord',
               'unhandled','noDirectTaskReference','noSecondaryTaskReference','batchHandlingMatches']
        by_owner.append({'owner':owner,'failedCount':len(rows),'failureKindCounts':dict(collections.Counter(r['failureKind'] for r in rows)),
                         'staticErrorClassCounts':dict(collections.Counter(r['staticErrorClass'] for r in rows)),
                         'resultJSONStateCounts':dict(collections.Counter(r['resultJSONState'] for r in rows)),
                         'parserStatusCounts':dict(collections.Counter(r['parserStatus'] for r in rows)),
                         'attachmentCount':sum(r['attachmentCount'] for r in rows),
                         'sourceAttachmentCount':sum(r['sourceAttachmentCount'] for r in rows),
                         'failedAttachmentCount':sum(r['failedAttachmentCount'] for r in rows),
                         'flags':{key:{'true':sum(r[key] is True for r in rows),'false':sum(r[key] is False for r in rows),
                                       'unknown':sum(r[key] is None for r in rows)} for key in flags}})
    return private,by_owner


def main():
    global DEADLINE
    DEADLINE=time.monotonic()+105
    check(os.environ.get('MAILDIAG_BRANCH')==BRANCH and os.environ.get('MAILDIAG_ATTEMPT')=='1'
          and re.fullmatch('[a-f0-9]{40}',os.environ.get('MAILDIAG_REF','')) is not None)
    lib=library();before=runtime(lib);os.umask(0o077);OUTPUT.mkdir(mode=0o700)
    result={'source':MAIN,'readOnly':True,'businessWrites':False,'mailboxOrNetworkCalls':False,'rawLogsOrEnvironmentRead':False,
            'oldSealsOrOldPartialScanned':False,'oldEvidenceWrites':False,'retryAuthorizedByThisAudit':False,'completed':False}
    try:
        lib['write_new'](OUTPUT/'source.private.json',{'ref':os.environ['MAILDIAG_REF'],'libraryCommit':LIB_COMMIT,'librarySHA256':LIB_SHA,'runtimeBefore':before})
        lib['write_new'](OUTPUT/'snapshot.private.json',snapshot(lib))
        private,owners=analyze(lib,OUTPUT/'current.sqlite3')
        lib['write_new'](OUTPUT/'failed-items.private.json',private)
        result.update({'owners':owners,'selectedFailedCount':len(private),'completed':True,
                       'metadataEvidenceDoesNotEstablishCurrentIMAPExistence':True,
                       'metadataInstantComparisonPrecision':'microsecond'})
    except Exception:
        result['safeFailure']='REDACTED_CURRENT_FAILED_AUDIT_FAILURE'
    finally:
        try:
            after=runtime(lib);lib['write_new'](OUTPUT/'runtime-after.private.json',after)
            result['runtimeMatchesExactPinsAndUnchanged']=before==after
            if before!=after:result['completed']=False
        except Exception:result['completed']=False;result['runtimeMatchesExactPinsAndUnchanged']=False
        lib['write_new'](OUTPUT/'first-result.json',result);lib['seal'](OUTPUT);lib['emit'](result)
        lib['emit']({'kind':'receipt','resultPath':str(OUTPUT/'first-result.json'),'resultSHA256':digest(OUTPUT/'first-result.json'),'sealSHA256':digest(OUTPUT/'seal.json')})
    return 0 if result['completed'] else 1


if __name__=='__main__':
    def interrupted(*_):raise TimeoutError()
    signal.signal(signal.SIGTERM,interrupted);signal.signal(signal.SIGALRM,interrupted);signal.alarm(108)
    try:raise SystemExit(main())
    except Exception:
        print('{"failed":true,"reason":"REDACTED_CURRENT_FAILED_AUDIT_SETUP_OR_SEAL_FAILURE","businessWrites":false}',flush=True)
        raise SystemExit(1)
