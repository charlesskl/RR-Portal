"""PR929 read-only audit-addition diagnosis. Never restore or print business rows."""
import datetime
import importlib.util
import json
import os
import pathlib
import re
import select
import subprocess
import sys
import time
import urllib.parse

MODULE = pathlib.Path(__file__).with_name('ops.py')
if not MODULE.is_file():
    MODULE = pathlib.Path(__file__).with_name('internal-quote-929.py')
SPEC = importlib.util.spec_from_file_location('internal_quote_929_strict', MODULE)
ops = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(ops)

BEFORE = '4edd6ac6a4148bd8dc2adf003f87580bd0873bb2'
TARGET = '8dd079e159ba595e91702673fe0cbf1aacf2604a'
BACKUP = '/opt/rr-portal/deploy/backups/internal-quote-pre-929-20261016T002228875402Z'
REVIEWED_HEAD = 'f2c2a60c06c2875a8bb623bc1993e62e75661a19'
SOURCE_PIN_SHA256 = '599074567a99d4f67f88e92c79b0901a1d0585a43e27cd8536ffe15216cb832d'
MERGED_AT = '2026-10-16T00:28:32Z'
DEPLOY_STARTED_AT = '2026-10-16T00:28:39Z'
LOG_SINCE = '2026-10-16T00:22:28Z'
MAX_RESTORE_BYTES = 64 * 1024 * 1024
MAX_LOG_BYTES = 32 * 1024 * 1024
EXPECTED_ORIGINAL_TABLES = 18
INITIAL_STRICT_NEW_EVENTS = 4
COPY_COLUMNS = {'id', 'quote_id', 'dept', 'actor', 'action', 'detail', 'at'}


def parse_audit_copy_ids(data):
    """Read only ID fields from pg_restore COPY text; never execute its SQL."""
    ops.require(isinstance(data, bytes) and len(data) <= MAX_RESTORE_BYTES, 'auditCopyOutputLimit')
    ids, columns, seen_copy, finished = [], None, False, False
    for line in data.splitlines():
        if columns is not None:
            if line == b'\\.':
                columns, finished = None, True
                continue
            fields = line.split(b'\t')
            ops.require(len(fields) == len(COPY_COLUMNS), 'auditCopyColumnCount')
            value = fields[columns.index('id')]
            ops.require(bool(re.fullmatch(rb'[1-9][0-9]{0,9}', value)), 'auditCopyPositiveIntegerId')
            identifier = int(value)
            ops.require(identifier <= 2147483647, 'auditCopyIntegerRange')
            ids.append(identifier)
        elif line.startswith(b'COPY '):
            ops.require(not seen_copy, 'auditCopySingleExpectedTable')
            match = re.fullmatch(rb'COPY (?:internal_quote|"internal_quote")\.(?:audit_log|"audit_log") \(([^\r\n]+)\) FROM stdin;', line)
            ops.require(bool(match), 'auditCopyExpectedTable')
            try:
                parts = [part.strip() for part in match.group(1).decode('ascii').split(',')]
                ops.require(all(re.fullmatch(r'(?:[a-z_]+|"[a-z_]+")', part) for part in parts), 'auditCopyIdentifierSyntax')
                columns = [part.strip('"') for part in parts]
            except UnicodeDecodeError:
                ops.require(False, 'auditCopyAsciiColumns')
            ops.require(len(columns) == len(COPY_COLUMNS) and set(columns) == COPY_COLUMNS, 'auditCopyExactColumnInventory')
            seen_copy = True
    ops.require(seen_copy and finished and columns is None and len(ids) == len(set(ids)), 'auditCopyCompleteUniqueIds')
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


def baseline_audit_ids(directory, before):
    ops.checkpoint('privateDumpAuditIds')
    # Explicit stdout is required by pg_restore. No --dbname: never connect or restore.
    args = ['docker', 'exec', '-i', ops.cid('db'), 'pg_restore', '--data-only',
            '--no-owner', '--no-privileges', '--schema=internal_quote', '--table=audit_log', '--file=-']
    with (directory / 'internal_quote.dump').open('rb') as source:
        ids = parse_audit_copy_ids(bounded_command(args, source))
    ops.require(len(ids) == before['tables']['audit_log']['rows'], 'auditDumpIdsMatchBaselineRowCount')
    return ids


def audit_details_sql(ids):
    ops.require(isinstance(ids, list) and ids and len(ids) == len(set(ids))
                and all(type(value) is int and 0 < value <= 2147483647 for value in ids), 'validatedBaselineAuditIdSet')
    selection = 'id=ANY(ARRAY[' + ','.join(map(str, sorted(ids))) + ']::integer[])'
    old_hash = "encode(sha256(convert_to(COALESCE(string_agg(row_hash,'' ORDER BY row_hash),''),'UTF8')),'hex')"
    return """WITH added AS (SELECT * FROM internal_quote.audit_log WHERE NOT (%s)),
      actions AS (SELECT CASE WHEN action ~ '^[a-z][a-z0-9_]{0,63}$' THEN action ELSE '[nonstandard]' END AS safe_action, COUNT(*) AS n FROM added GROUP BY 1),
      actors AS (SELECT encode(sha256(convert_to(COALESCE(a.actor,''),'UTF8')),'hex') AS actor_sha256,
        COUNT(*) AS n, bool_and(EXISTS (SELECT 1 FROM internal_quote.users u WHERE u.username=a.actor OR u.display_name=a.actor)) AS known_actor
        FROM added a GROUP BY 1)
      SELECT jsonb_build_object(
        'originalRows',(SELECT COUNT(*) FROM internal_quote.audit_log WHERE %s),
        'originalFullRowSha256',(SELECT %s FROM (SELECT encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex') AS row_hash FROM internal_quote.audit_log r WHERE %s) hashes),
        'addedRows',(SELECT COUNT(*) FROM added),
        'newActionCounts',(SELECT COALESCE(jsonb_object_agg(safe_action,n),'{}') FROM actions),
        'newActorHashes',(SELECT COALESCE(jsonb_agg(jsonb_build_object('sha256',actor_sha256,'events',n,'matchesExistingUser',known_actor) ORDER BY actor_sha256),'[]') FROM actors),
        'onlyViewEvents',(SELECT COALESCE(bool_and(action='view'),false) FROM added),
        'allActorsMatchExistingUsers',(SELECT COALESCE(bool_and(known_actor),false) FROM actors),
        'privateEvents',(SELECT COALESCE(jsonb_agg(jsonb_build_object('quoteId',quote_id,'at',at,'action',CASE WHEN action ~ '^[a-z][a-z0-9_]{0,63}$' THEN action ELSE '[nonstandard]' END) ORDER BY at,id),'[]') FROM added));\n""" % (selection, selection, old_hash, selection)


def audit_snapshot(ids):
    ops.checkpoint('readOnlyAuditAdditionSnapshot')
    process = subprocess.Popen(ops.sql_command(), stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                               stderr=subprocess.PIPE, cwd=ops.ROOT, bufsize=0)
    try:
        process.stdin.write(('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;\n' + ops.TABLE_SQL).encode()); process.stdin.flush()
        tables = ops.table_names(json.loads(ops.read_line(process)))
        process.stdin.write(ops.audit_sql(tables).encode()); process.stdin.flush()
        audit = json.loads(ops.read_line(process))
        process.stdin.write(audit_details_sql(ids).encode()); process.stdin.flush()
        details = json.loads(ops.read_line(process))
        ops.finish_snapshot(process)
        return audit, details
    finally:
        ops.close_snapshot(process)


def utc(value):
    normalized = value.replace('Z', '+00:00')
    # Docker adds nanoseconds; Python 3.9 accepts only microsecond ISO fractions.
    normalized = re.sub(r'\.(\d+)(?=[+-]\d{2}:\d{2}$)',
                        lambda match:'.'+(match.group(1)+'000000')[:6], normalized)
    result = datetime.datetime.fromisoformat(normalized)
    ops.require(result.tzinfo is not None, 'eventHasExplicitTimezone')
    return result.astimezone(datetime.timezone.utc)


def nginx_requests(data):
    """Keep route/time/status evidence in memory; discard IP, UA and user fields."""
    ops.require(isinstance(data, bytes) and len(data) <= MAX_LOG_BYTES, 'nginxReadLimit')
    result = []
    pattern = re.compile(r'^(\S+) .*?"GET (/internal-quote/api/quotes/[1-9][0-9]*(?:\?[^ ]*)?) HTTP/[0-9.]+" 200 [0-9]+ .* rt=([0-9]+(?:\.[0-9]+)?)\s*$')
    for line in data.decode('utf8', errors='replace').splitlines():
        match = pattern.fullmatch(line)
        if not match:
            continue
        try:
            at = utc(match.group(1))
            identifier = int(urllib.parse.urlsplit(match.group(2)).path.rsplit('/', 1)[1])
            seconds = float(match.group(3))
            if not 0 <= seconds <= 600 or identifier > 2147483647:
                continue
            result.append({'quoteId':identifier, 'at':at, 'seconds':seconds})
        except (ValueError, OverflowError):
            continue
    return result


def correlate(events, requests):
    candidates = []
    for event in events:
        at = utc(event['at'])
        candidates.append([index for index, request in enumerate(requests)
            if type(event.get('quoteId')) is int and request['quoteId'] == event['quoteId']
            and at-datetime.timedelta(seconds=2) <= request['at']
            <= at+datetime.timedelta(seconds=request['seconds']+2)])
    # Bipartite matching prevents one HTTP request from explaining two events.
    assigned = {}
    def match(event, seen):
        for request in candidates[event]:
            if request in seen:
                continue
            seen.add(request)
            if request not in assigned or match(assigned[request], seen):
                assigned[request] = event
                return True
        return False
    matched = sum(match(index, set()) for index in range(len(events)))
    return {'matchingViewEvents':matched, 'addedEvents':len(events),
            'allEventsHaveDistinctSuccessfulGetRouteAndTimeMatches':bool(events) and matched == len(events),
            'identityAttributionProven':False,
            'evidenceLimit':'Route and time consistency only; Nginx access logs contain no app session or actor identity.'}


def diagnose():
    directory, before = ops.latest_backup()
    ids = baseline_audit_ids(directory, before)
    strict = ops.verify()
    current, details = audit_snapshot(ids)
    final = ops.audit()
    events = details.pop('privateEvents')
    ops.require(len(events) == details['addedRows'], 'addedEventInventoryComplete')
    timestamps = [utc(event['at']) for event in events]
    changed = sorted(table for table in set(before['tables']) | set(current['tables'])
                     if before['tables'].get(table) != current['tables'].get(table))
    old_rows_unchanged = (details['originalRows'] == before['tables']['audit_log']['rows']
                          and details['originalFullRowSha256'] == before['tables']['audit_log']['sha256'])
    other_tables = set(current['tables']) - {'audit_log'}
    other_unchanged = (set(before['tables']) == set(current['tables']) and len(current['tables']) == EXPECTED_ORIGINAL_TABLES
                        and all(current['tables'][name] == before['tables'][name] for name in other_tables))
    log_evidence = {'available':False, 'identityAttributionProven':False}
    try:
        raw = bounded_command(['docker', 'logs', '--timestamps', '--since', LOG_SINCE,
                               '--tail', '200000', ops.cid('nginx')], limit=MAX_LOG_BYTES)
        log_evidence = correlate(events, nginx_requests(raw))
        log_evidence['available'] = True
    except Exception:
        # Log rotation/absence is an evidence limit, never an invented match.
        log_evidence['safeLimitation'] = 'Nginx log evidence could not be read within the fixed limits.'
    all_before_merge = bool(timestamps) and all(value < utc(MERGED_AT) for value in timestamps)
    all_before_deploy = bool(timestamps) and all(value < utc(DEPLOY_STARTED_AT) for value in timestamps)
    counts_match = {name:row['rows'] for name,row in current['tables'].items()} == strict['tableCounts']
    invariants = (old_rows_unchanged and other_unchanged and changed == ['audit_log'] and current == final
                  and counts_match and strict['deploymentChecksPassed'] and strict['uploadsUnchanged']
                  and strict['readOnlyProbeWindowDatabaseStable'])
    view_route_consistent = (details['onlyViewEvents'] and details['allActorsMatchExistingUsers']
                             and log_evidence.get('allEventsHaveDistinctSuccessfulGetRouteAndTimeMatches',False))
    # Keep the strict failure visible. This separate diagnosis never exempts it.
    return {'diagnosisCompleted':True, 'diagnosisInvariantsPassed':invariants,
            'originalStrictVerificationRemainsFailed':True, 'originalStrictRunId':38829888627,
            'strictVerification':strict, 'baselineAuditRows':len(ids),
            'originalAuditRowsPresent':details['originalRows'], 'originalAuditFullRowsUnchanged':old_rows_unchanged,
            'newAuditRows':details['addedRows'], 'initialStrictNewAuditRows':INITIAL_STRICT_NEW_EVENTS,
            'newAuditRowsEqualInitialStrictObservation':details['addedRows'] == INITIAL_STRICT_NEW_EVENTS,
            'newActionCounts':details['newActionCounts'], 'newActorHashes':details['newActorHashes'],
            'allNewActorsMatchExistingUsers':details['allActorsMatchExistingUsers'],
            'allNewEventsAreViews':details['onlyViewEvents'],
            'newEventMinUtc':min(timestamps).isoformat() if timestamps else None,
            'newEventMaxUtc':max(timestamps).isoformat() if timestamps else None,
            'mergeTimeUtc':MERGED_AT, 'deploymentStartedUtc':DEPLOY_STARTED_AT,
            'allNewEventsPrecedeMerge':all_before_merge, 'allNewEventsPrecedeDeployment':all_before_deploy,
            'onlyAuditLogAdditionsObserved':old_rows_unchanged and other_unchanged and changed == ['audit_log'],
            'other17TablesFullRowsUnchanged':other_unchanged,
            'diagnosticReadWindowStable':current == final,
            'diagnosticTableCountsMatchStrictRead':counts_match,
            'nginxEvidence':log_evidence,
            'consistentWithExistingAuthenticatedQuoteViewRoute':view_route_consistent,
            'readActivityExplained':invariants and view_route_consistent,
            'businessWritesPerformed':False, 'credentialsChanged':False,
            'databaseRestorePerformed':False, 'strictChecksExempted':False}


def main():
    mode, before, target, backup, pin_path = sys.argv[1:]
    ops.require(mode == 'diagnose-audit' and before == BEFORE and target == TARGET and backup == BACKUP, 'exactAuditDiagnosisArguments')
    ops.TARGET_COMMIT, ops.BACKUP_PATH = target, backup
    ops.require(ops.file_hash(pathlib.Path(pin_path)) == SOURCE_PIN_SHA256, 'exactUnchangedFinalSourceManifest')
    ops.TESTED_SOURCE = json.loads(pathlib.Path(pin_path).read_text())
    ops.require(ops.TESTED_SOURCE.get('reviewedHead') == REVIEWED_HEAD and len(ops.TESTED_SOURCE.get('files',{})) == 9, 'unchangedFinalReviewedSourcePin')
    result = diagnose()
    print(json.dumps(result,ensure_ascii=True))
    return 0 if result['diagnosisInvariantsPassed'] else 1


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception:
        print(json.dumps({'failed':True,'safeError':'IQ_929_AUDIT_DIAG_FAILED','failedCheck':ops.FAILED_CHECK}))
        sys.exit(1)
