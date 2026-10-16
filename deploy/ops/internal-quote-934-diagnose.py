"""PR934 fixed read-only addition diagnosis. Never restore or print private rows."""
import datetime
import hashlib
import importlib.util
import json
import os
import pathlib
import re
import select
import stat
import subprocess
import sys
import tarfile
import time

MODULE = pathlib.Path(__file__).with_name('ops.py')
if not MODULE.is_file():
    MODULE = pathlib.Path(__file__).with_name('internal-quote-934.py')
SPEC = importlib.util.spec_from_file_location('internal_quote_934_strict', MODULE)
ops = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(ops)
BEFORE = 'a0f261dee99e6ed3a39f2def982de8d5311ec55a'
TARGET = 'bf80f392c024b160b3061f7717c02f08d319a79d'
BACKUP = '/opt/rr-portal/deploy/backups/internal-quote-pre-934-20261016T093057223428Z'
REVIEWED_HEAD = '15223e95a1d397d83336e32213f47b3bdce33610'
PIN_SHA256 = '3e9d6d62fe1de9dbef3e8475c79f6635a26b831d0f445e044da494db68d1a57e'
MERGED_AT = '2026-10-16T11:31:26Z'
DEPLOY_STARTED_AT = '2026-10-16T11:31:33Z'
ORIGINAL_STRICT_RUN = 38894533661
MAX_RESTORE_BYTES = 64 * 1024 * 1024
COPY_COLUMNS = {
    'quotes': {'id','quote_no','product_name','customer','qty','created_by_dept','created_by_name','created_at','status','version','factory_code','deleted_at','deleted_by'},
    'quote_sections': {'id','quote_id','dept','payload_json','status','filled_by','filled_at','reviewed_by','reviewed_at','review_comment'},
    'audit_log': {'id','quote_id','dept','actor','action','detail','at'},
}


def parse_copy_ids(data, table):
    ops.require(table in COPY_COLUMNS and isinstance(data,bytes) and len(data) <= MAX_RESTORE_BYTES, 'diagnosisCopyOutputAndTableLimit')
    expected = COPY_COLUMNS[table]
    ids, columns, seen, finished = [], None, False, False
    for line in data.splitlines():
        if columns is not None:
            if line == b'\\.':
                columns, finished = None, True
                continue
            fields = line.split(b'\t')
            ops.require(len(fields) == len(expected), 'diagnosisCopyColumnCount')
            value = fields[columns.index('id')]
            ops.require(bool(re.fullmatch(rb'[1-9][0-9]{0,9}',value)), 'diagnosisCopyPositiveIntegerId')
            identifier = int(value)
            ops.require(identifier <= 2147483647, 'diagnosisCopyIntegerRange')
            ids.append(identifier)
        elif line.startswith(b'COPY '):
            ops.require(not seen, 'diagnosisCopySingleExpectedTable')
            match = re.fullmatch(rb'COPY (?:internal_quote|"internal_quote")\.(?:'+table.encode()+rb'|"'+table.encode()+rb'") \(([^\r\n]+)\) FROM stdin;',line)
            ops.require(bool(match), 'diagnosisCopyExpectedTable')
            parts = [part.strip() for part in match.group(1).decode('ascii').split(',')]
            ops.require(all(re.fullmatch(r'(?:[a-z_]+|"[a-z_]+")',part) for part in parts), 'diagnosisCopyColumnSyntax')
            columns = [part.strip('"') for part in parts]
            ops.require(len(columns) == len(expected) and set(columns) == expected, 'diagnosisCopyExactColumns')
            seen = True
    ops.require(seen and finished and columns is None and len(ids) == len(set(ids)), 'diagnosisCopyCompleteUniqueIds')
    return sorted(ids)


def bounded_command(args, source=None, limit=MAX_RESTORE_BYTES):
    process = subprocess.Popen(args, stdin=source or subprocess.DEVNULL,
                               stdout=subprocess.PIPE, stderr=subprocess.PIPE, cwd=ops.ROOT)
    try:
        output, errors, streams = bytearray(), 0, [process.stdout, process.stderr]
        deadline = time.monotonic() + 180
        while streams:
            remaining = deadline-time.monotonic()
            ops.require(remaining > 0, 'privateReadCommandDeadline')
            readable, _, _ = select.select(streams, [], [], remaining)
            ops.require(bool(readable), 'privateReadCommandDeadline')
            for stream in readable:
                chunk = os.read(stream.fileno(), 65536)
                if not chunk:
                    streams.remove(stream)
                elif stream is process.stdout:
                    output.extend(chunk)
                    ops.require(len(output) <= limit, 'privateReadOutputLimit')
                else:
                    errors += len(chunk)
                    ops.require(errors <= 1024 * 1024, 'privateReadErrorLimit')
        ops.require(process.wait(timeout=max(1, deadline-time.monotonic())) == 0, 'privateReadCommandSucceeded')
        return bytes(output)
    finally:
        if process.poll() is None:
            process.kill(); process.wait(timeout=5)
        process.stdout.close(); process.stderr.close()



def baseline_ids(directory, before, table):
    ops.require(table in COPY_COLUMNS, 'diagnosisExpectedTable')
    # pg_restore only exports text to stdout. Never pass a database, never execute its SQL.
    args = ['docker','exec','-i',ops.cid('db'),'pg_restore','--data-only','--no-owner',
            '--no-privileges','--schema=internal_quote','--table='+table,'--file=-']
    with (directory/'internal_quote.dump').open('rb') as stream:
        ids = parse_copy_ids(bounded_command(args,stream),table)
    ops.require(len(ids) == before['tables'][table]['rows'], 'diagnosisDumpIdsMatchBaselineCount')
    return ids


def selection(ids):
    ops.require(isinstance(ids,list) and len(ids) == len(set(ids))
                and all(type(value) is int and 0 < value <= 2147483647 for value in ids), 'diagnosisValidatedOriginalIds')
    return 'id=ANY(ARRAY['+','.join(map(str,sorted(ids)))+']::integer[])'


def utc_aggregate(column, prefix=''):
    # All timestamps are rendered in UTC on the server, independent of host/psql timezone.
    return "'"+prefix+"MinUtc',to_char(min("+column+") AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"')," \
           "'"+prefix+"MaxUtc',to_char(max("+column+") AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"')," \
           "'"+prefix+"MissingTimestamps',COUNT(*) FILTER (WHERE "+column+" IS NULL)," \
           "'"+prefix+"AllPrecedeMerge',COALESCE(bool_and("+column+" IS NOT NULL AND "+column+"<'"+MERGED_AT+"'::timestamptz),false)," \
           "'"+prefix+"AllPrecedeDeployment',COALESCE(bool_and("+column+" IS NOT NULL AND "+column+"<'"+DEPLOY_STARTED_AT+"'::timestamptz),false)"


def table_details_sql(table, ids, quote_ids):
    ops.require(table in COPY_COLUMNS, 'diagnosisExpectedTable')
    condition = selection(ids)
    old_hash = "encode(sha256(convert_to(COALESCE(string_agg(row_hash,'' ORDER BY row_hash),''),'UTF8')),'hex')"
    extra = ''
    if table == 'quotes':
        extra = ",'addedTimestampEvidence',(SELECT jsonb_build_object("+utc_aggregate('created_at')+") FROM added)"
    elif table == 'audit_log':
        extra = ",'addedTimestampEvidence',(SELECT jsonb_build_object("+utc_aggregate('at')+") FROM added)," \
                "'newActionCounts',(SELECT COALESCE(jsonb_object_agg(action,n),'{}') FROM (SELECT CASE WHEN action ~ '^[a-z][a-z0-9_]{0,63}$' THEN action ELSE '[nonstandard]' END AS action,COUNT(*) AS n FROM added GROUP BY 1) actions)"
    else:
        new_parent = 'NOT ('+selection(quote_ids).replace('id=ANY','q.id=ANY')+')'
        extra = ",'allAddedSectionsBelongToNewQuotes',(SELECT COALESCE(bool_and("+new_parent+"),false) FROM added a JOIN internal_quote.quotes q ON q.id=a.quote_id)," \
                "'parentQuoteCreatedAtEvidence',(SELECT jsonb_build_object("+utc_aggregate('q.created_at')+") FROM added a JOIN internal_quote.quotes q ON q.id=a.quote_id)"
    return "WITH added AS (SELECT * FROM internal_quote."+table+" WHERE NOT ("+condition+")) SELECT jsonb_build_object(" \
           "'originalRows',(SELECT COUNT(*) FROM internal_quote."+table+" WHERE "+condition+")," \
           "'originalFullRowSha256',(SELECT "+old_hash+" FROM (SELECT encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex') AS row_hash FROM internal_quote."+table+" r WHERE "+condition+") hashes)," \
           "'addedRows',(SELECT COUNT(*) FROM added)"+extra+");\n"


def database_snapshot(original_ids):
    ops.checkpoint('diagnosisReadOnlySnapshot')
    process = subprocess.Popen(ops.sql_command(),stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,cwd=ops.ROOT,bufsize=0)
    try:
        process.stdin.write(('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;\n'+ops.TABLE_SQL).encode());process.stdin.flush()
        tables=ops.table_names(json.loads(ops.read_line(process)))
        process.stdin.write(ops.audit_sql(tables).encode());process.stdin.flush()
        current=json.loads(ops.read_line(process));details={}
        for table in COPY_COLUMNS:
            process.stdin.write(table_details_sql(table,original_ids[table],original_ids['quotes']).encode());process.stdin.flush()
            details[table]=json.loads(ops.read_line(process))
        ops.finish_snapshot(process)
        return current,details
    finally:ops.close_snapshot(process)


def original_uploads(directory,before):
    entries={};total=0
    with tarfile.open(directory/'uploads.tar','r') as archive:
        members=archive.getmembers()
        ops.require(len(members)==before['uploads']['files'] and len(members)<=ops.MAX_UPLOAD_FILES,'diagnosisOriginalUploadCount')
        for info in members:
            relative=pathlib.PurePosixPath(info.name)
            ops.require(info.isfile() and not relative.is_absolute() and not any(part in {'','..','.'} for part in relative.parts)
                        and info.name not in entries and 0<=info.size<=ops.MAX_UPLOAD_FILE_BYTES,'diagnosisOriginalUploadPath')
            with archive.extractfile(info) as stream:content=stream.read(info.size+1)
            ops.require(len(content)==info.size,'diagnosisOriginalUploadRead')
            total+=info.size;ops.require(total<=ops.MAX_UPLOAD_BYTES,'diagnosisOriginalUploadTotal')
            entries[info.name]={'path':info.name,'bytes':info.size,'sha256':hashlib.sha256(content).hexdigest()}
    ops.require({'files':len(entries),'bytes':total,'sha256':ops.digest_rows(list(entries.values()))}==before['uploads'],'diagnosisOriginalUploadManifest')
    return entries


def utc_ns(value):
    return datetime.datetime.fromtimestamp(value//1000000000,datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%S')+'.'+str(value%1000000000).zfill(9)+'Z'


def upload_snapshot(original):
    tree=ops.UPLOAD_ROOT
    ops.require(tree.is_dir() and not tree.is_symlink(),'diagnosisUploadRoot')
    current={};times=[];total=0
    for root,dirs,files in os.walk(tree,followlinks=False):
        for name in dirs:ops.require(not (pathlib.Path(root)/name).is_symlink(),'diagnosisUploadDirectory')
        for name in files:
            path=pathlib.Path(root)/name
            ops.require(path.is_file() and not path.is_symlink(),'diagnosisRegularUploadPath')
            fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
            with os.fdopen(fd,'rb') as stream:
                first=os.fstat(stream.fileno());ops.require(stat.S_ISREG(first.st_mode) and 0<=first.st_size<=ops.MAX_UPLOAD_FILE_BYTES,'diagnosisRegularUpload')
                content=stream.read(first.st_size+1);last=os.fstat(stream.fileno())
            ops.require(len(content)==first.st_size and (first.st_ino,first.st_size,first.st_mtime_ns,first.st_ctime_ns)==(last.st_ino,last.st_size,last.st_mtime_ns,last.st_ctime_ns),'diagnosisUploadStableDuringRead')
            relative=str(path.relative_to(tree));current[relative]={'path':relative,'bytes':len(content),'sha256':hashlib.sha256(content).hexdigest()}
            total+=len(content);ops.require(len(current)<=ops.MAX_UPLOAD_FILES and total<=ops.MAX_UPLOAD_BYTES,'diagnosisUploadLimits')
            if relative not in original:times.append({'bytes':len(content),'mtime':first.st_mtime_ns,'ctime':first.st_ctime_ns})
    old_preserved=all(current.get(name)==entry for name,entry in original.items())
    result={'originalUploadFiles':len(original),'originalUploadFilesPresent':sum(name in current for name in original),
            'originalUploadContentsUnchanged':old_preserved,'newUploadFiles':len(times),'newUploadBytes':sum(row['bytes'] for row in times),
            'currentUploadFiles':len(current),'currentUploadBytes':total,
            'timestampEvidenceLimit':'mtime/ctime show filesystem metadata only; neither proves file creation, active upload or actor identity.'}
    for field in ['mtime','ctime']:
        ns=[row[field] for row in times]
        result[field+'MinUtc']=utc_ns(min(ns)) if ns else None;result[field+'MaxUtc']=utc_ns(max(ns)) if ns else None
        threshold=lambda value:int(datetime.datetime.fromisoformat(value.replace('Z','+00:00')).timestamp())*1000000000
        result[field+'AllPrecedeMerge']=bool(ns) and all(value<threshold(MERGED_AT) for value in ns)
        result[field+'AllPrecedeDeployment']=bool(ns) and all(value<threshold(DEPLOY_STARTED_AT) for value in ns)
    # The digest and timestamps are retained privately for exact second-read equality, never output paths.
    return {'inventory':{'files':len(current),'bytes':total,'sha256':ops.digest_rows(list(current.values()))},'times':sorted(times,key=lambda row:(row['bytes'],row['mtime'],row['ctime'])),'result':result}


def diagnose():
    directory,before=ops.latest_backup()
    ops.require(ops.source_commit()==ops.source_commit('origin/main')==TARGET,'diagnosisExactDeployedSource')
    ops.tested_source_guard(TARGET)
    ids={table:baseline_ids(directory,before,table) for table in COPY_COLUMNS}
    original=original_uploads(directory,before)
    current,details=database_snapshot(ids)
    uploads=upload_snapshot(original)
    final=ops.audit();uploads_final=upload_snapshot(original)
    output={}
    for table,row in details.items():
        output[table]={key:value for key,value in row.items() if key!='originalFullRowSha256'}
        output[table]['baselineRows']=before['tables'][table]['rows']
        output[table]['originalFullRowsUnchanged']=(row['originalRows']==before['tables'][table]['rows'] and row['originalFullRowSha256']==before['tables'][table]['sha256'])
    other=set(before['tables'])-set(COPY_COLUMNS)-{'users'}
    ops.require(len(other)==14,'diagnosisExpectedOtherTableCount')
    other_same=(set(before['tables'])==set(current['tables']) and all(before['tables'][table]==current['tables'][table] for table in other))
    identity_same=before['userIdentitySha256']==current['userIdentitySha256']
    window_stable=current==final and uploads==uploads_final
    invariants=other_same and identity_same and window_stable and all(row['originalFullRowsUnchanged'] for row in output.values()) and uploads['result']['originalUploadContentsUnchanged']
    return {'diagnosisCompleted':True,'diagnosisInvariantsPassed':invariants,'originalStrictRunId':ORIGINAL_STRICT_RUN,
            'originalStrictVerificationRemainsFailed':True,'tableDetails':output,'other14TablesFullRowsUnchanged':other_same,
            'userIdentityPermissionsAndConfigurationFieldsUnchanged':identity_same,
            'userFullRowsChanged':before['tables']['users']!=current['tables']['users'],
            'userDifferenceScope':'Only last_login and login_fails are omitted from the separately preserved full identity hash.',
            'uploads':uploads['result'],'diagnosticReadWindowStable':window_stable,
            'tableCounts':{table:row['rows'] for table,row in current['tables'].items()},
            'sourceCommit':TARGET,'mergeTimeUtc':MERGED_AT,'deploymentStartedUtc':DEPLOY_STARTED_AT,
            'sectionTimestampEvidenceLimit':'quote_sections has no created_at. Parent quote.created_at is reported separately and does not prove section creation time.',
            'actorOrRequestIdentityAttributionProven':False,'databaseRestorePerformed':False,
            'businessWritesPerformed':False,'credentialsChanged':False,'strictChecksExempted':False}


def main():
    mode,before,target,backup,pin_path=sys.argv[1:]
    ops.require(mode=='diagnose' and before==BEFORE and target==TARGET and backup==BACKUP,'diagnosisExactArguments')
    ops.TARGET_COMMIT,ops.BACKUP_PATH=target,backup
    ops.require(ops.file_hash(pathlib.Path(pin_path))==PIN_SHA256,'diagnosisExactOriginalPin')
    ops.TESTED_SOURCE=json.loads(pathlib.Path(pin_path).read_text())
    ops.require(ops.TESTED_SOURCE.get('reviewedHead')==REVIEWED_HEAD and len(ops.TESTED_SOURCE.get('files',{}))==26,'diagnosisExactReviewedSource')
    result=diagnose();print(json.dumps(result,ensure_ascii=True))
    return 0 if result['diagnosisInvariantsPassed'] else 1


if __name__=='__main__':
    try:sys.exit(main())
    except Exception:
        print(json.dumps({'failed':True,'safeError':'IQ_934_DIAG_FAILED','failedCheck':ops.FAILED_CHECK}));sys.exit(1)
