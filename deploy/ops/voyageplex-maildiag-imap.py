"""UNEXECUTED DRAFT: fixed four-mailbox, metadata-only IMAP diagnosis.

Server-only opt-in: python3 <reviewed-file> --execute-read-only
No application imports, mailbox bodies, sessions, synchronization or data writes.
Credentials are read from the running API's configuration into private memory,
then sent only over stdin to a fixed Python program in the pinned parser container.
Never print subprocess output, server responses or exception messages directly.
"""
import contextlib
import datetime
import json
import os
import pathlib
import re
import select
import sqlite3
import stat
import subprocess
import sys
import time

ROOT = pathlib.Path('/opt/rr-portal')
DB = ROOT / 'apps/船务部/VoyagePlex船务协同系统/data-runtime/voyageplex.db'
KEY = 'VOYAGEPLEX_HUADENG_MAILBOXES_JSON'
OWNERS = {2: ('tan123', 'lisa666tan@163.com'),
          3: ('秦湘柳', 'hyt9833@163.com'),
          5: ('莫秀珍', '13768947334@163.com'),
          6: ('麦淳恩', '13471221956@163.com')}
SAFE_TYPES = {'TimeoutError', 'DeadlineError', 'ValueError', 'TypeError',
              'KeyError', 'OSError', 'PermissionError', 'FileNotFoundError',
              'OperationalError', 'SSLError', 'SSLCertVerificationError',
              'gaierror', 'ConnectionError', 'ConnectionResetError',
              'BrokenPipeError', 'EOFError', 'error', 'abort', 'readonly'}
STAGES = {'input', 'connect', 'login', 'client-id', 'folder', 'uid-validity',
          'search', 'metadata', 'complete', 'preflight', 'diagnostic-client'}
RECEIPTS = {'OK', 'NO', 'BAD', 'OTHER', 'EXCEPTION'}


class DeadlineError(Exception):
    pass


def safe_type(error):
    name = type(error).__name__
    return name if name in SAFE_TYPES else 'Other'


def emit(section, data):
    # All callers construct whitelisted structures; never pass raw diagnostics.
    line = json.dumps({'section': section, 'data': data}, ensure_ascii=True,
                      sort_keys=True, separators=(',', ':'))
    if len(line.encode()) > 6000:
        raise ValueError('output_limit')
    print(line, flush=True)


def bounded_command(args, *, seconds, stdout_limit, stdin=None, deadline=None):
    """Bound both streams. A killed CLI does not signal an application container.

    The IMAP child has its own 65-second alarm, shorter than its CLI timeout,
    so it also terminates if the diagnostic Docker client disconnects.
    """
    until = min(time.monotonic() + seconds, deadline or float('inf'))
    if until <= time.monotonic():
        raise DeadlineError()
    if stdin is not None and len(stdin) > 8192:
        raise ValueError('stdin_limit')
    process = subprocess.Popen(args, stdin=subprocess.PIPE if stdin is not None else subprocess.DEVNULL,
                               stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    buffers = {process.stdout: bytearray(), process.stderr: bytearray()}
    limits = {process.stdout: stdout_limit, process.stderr: 8192}
    capped = timed_out = False
    try:
        if stdin is not None:
            # One bounded JSON document fits in the pipe; no shell interpolation.
            process.stdin.write(stdin)
            process.stdin.close()
        active = set(buffers)
        while active:
            remaining = until - time.monotonic()
            if remaining <= 0:
                timed_out = True
                break
            ready, _, _ = select.select(list(active), [], [], remaining)
            if not ready:
                timed_out = True
                break
            for stream in ready:
                block = os.read(stream.fileno(), min(16384, limits[stream] - len(buffers[stream]) + 1))
                if not block:
                    active.remove(stream)
                    continue
                buffers[stream].extend(block)
                if len(buffers[stream]) > limits[stream]:
                    capped = True
                    break
            if capped:
                break
        if not capped and not timed_out:
            try:
                process.wait(timeout=max(.01, until - time.monotonic()))
            except subprocess.TimeoutExpired:
                timed_out = True
    finally:
        if process.poll() is None:
            process.kill()  # diagnostic client only; never docker kill/restart.
        process.wait(timeout=3)
        for stream in buffers:
            stream.close()
        if process.stdin is not None and not process.stdin.closed:
            process.stdin.close()
    if capped or timed_out or process.returncode != 0:
        # Do not expose stderr: it is untrusted and may include private input.
        raise DeadlineError() if timed_out else ValueError('diagnostic_command_failed')
    return bytes(buffers[process.stdout])


def inspect_service(service, deadline):
    # Only the API environment is needed. Parser configuration is not retrieved.
    template = ('{"id":{{json .Id}},"name":{{json .Name}},'
                '"running":{{json .State.Running}},'
                '"project":{{json (index .Config.Labels "com.docker.compose.project")}},'
                '"service":{{json (index .Config.Labels "com.docker.compose.service")}},'
                '"mounts":{{json .Mounts}}')
    if service == 'voyageplex-api':
        template += ',"environment":{{json .Config.Env}}'
    template += '}'
    value = json.loads(bounded_command(
        ['docker', 'inspect', '--format', template, 'rr-portal-' + service + '-1'],
        seconds=20, stdout_limit=524288, deadline=deadline))
    if (not isinstance(value, dict) or value.get('name') != '/rr-portal-' + service + '-1'
            or value.get('project') != 'rr-portal' or value.get('service') != service
            or value.get('running') is not True
            or not re.fullmatch('[a-f0-9]{64}', str(value.get('id', '')))):
        raise ValueError('fixed_container_identity')
    return value


def credentials_from_runtime(api):
    env = api.get('environment')
    if not isinstance(env, list):
        raise ValueError('runtime_environment_shape')
    matches = [item.split('=', 1)[1] for item in env
               if isinstance(item, str) and item.startswith(KEY + '=')]
    if len(matches) != 1:
        raise ValueError('runtime_configuration_missing_or_duplicate')
    entries = json.loads(matches[0])
    if not isinstance(entries, list) or len(entries) != 4:
        raise ValueError('four_entries_required')
    mapped = {}
    addresses = set()
    for item in entries:
        if not isinstance(item, dict) or not all(isinstance(key, str) for key in item):
            raise ValueError('entry_shape')
        lowered = {key.lower(): value for key, value in item.items()}
        if len(lowered) != len(item):
            raise ValueError('ambiguous_entry_keys')
        if not all(isinstance(lowered.get(key), str) for key in ('username', 'address', 'authcode', 'host', 'folder')):
            raise ValueError('entry_value_types')
        username = lowered['username'].strip().casefold()
        address = lowered['address'].strip().casefold()
        secret = lowered['authcode']
        if (username in mapped or address in addresses or not secret.strip()
                or len(secret) > 1024 or len(secret.encode()) > 4096
                or lowered['host'].strip().casefold() != 'imap.163.com'
                or lowered['folder'].strip() != 'INBOX'):
            raise ValueError('entry_validation')
        mapped[username] = {'address': address, 'auth_code': secret}
        addresses.add(address)
    if set(mapped) != {value[0].casefold() for value in OWNERS.values()}:
        raise ValueError('fixed_usernames_required')
    for username, address in OWNERS.values():
        if mapped[username.casefold()]['address'] != address:
            raise ValueError('fixed_address_mapping_required')
    return mapped


def snapshots(api, entries):
    mounts = [m for m in api.get('mounts', []) if isinstance(m, dict) and m.get('Destination') == '/app/data']
    if (len(mounts) != 1 or mounts[0].get('Type') != 'bind'
            or pathlib.Path(mounts[0].get('Source', '')).resolve() != DB.parent):
        raise ValueError('fixed_database_mount_required')
    if DB.is_symlink() or not stat.S_ISREG(DB.stat().st_mode) or DB.parent.resolve() != DB.parent:
        raise ValueError('regular_database_required')
    until = time.monotonic() + 8
    result = []
    with contextlib.closing(sqlite3.connect(DB.as_uri() + '?mode=ro', uri=True, timeout=5)) as db:
        db.row_factory = sqlite3.Row
        db.set_progress_handler(lambda: 1 if time.monotonic() > until else 0, 1000)
        db.execute('PRAGMA query_only=ON')
        db.execute('BEGIN')
        for owner, (username, address) in OWNERS.items():
            users = db.execute('SELECT Id,Username,MailboxAddress,IsActive,Role,CompanyAccess FROM Users WHERE Id=? OR Username=?',
                               (owner, username)).fetchall()
            if (len(users) != 1 or users[0]['Id'] != owner or users[0]['Username'] != username
                    or users[0]['MailboxAddress'].casefold() != address
                    or users[0]['IsActive'] != 1
                    or not (users[0]['Role'] == 'admin' or users[0]['CompanyAccess'] in {'Huadeng', 'Both'})
                    or entries[username.casefold()]['address'] != users[0]['MailboxAddress'].casefold()):
                raise ValueError('database_binding_mismatch')
            setting = db.execute('SELECT StartDate FROM MailSystemSettings WHERE Id=?', (1000 + owner,)).fetchone()
            state = db.execute('SELECT Address,LastUid,UidValidity FROM MailSyncStates WHERE Id=?', (1000 + owner,)).fetchone()
            if setting is None or not isinstance(setting['StartDate'], str):
                raise ValueError('owner_start_date_required')
            start = datetime.date.fromisoformat(setting['StartDate'])
            if start.isoformat() != setting['StartDate']:
                raise ValueError('canonical_start_date_required')
            last_uid, validity = (state['LastUid'], state['UidValidity']) if state else (0, 0)
            if (any(type(value) is not int or not 0 <= value <= 4294967295 for value in (last_uid, validity))
                    or (state and state['Address'] and state['Address'].casefold() != address)):
                raise ValueError('owner_cursor_invalid')
            result.append({'username': username, 'address': address, 'start_date': start.isoformat(),
                           'after_uid': last_uid, 'stored_uid_validity': validity})
        db.rollback()
    return result


# Static code only in argv. Per-mailbox credentials travel as one JSON stdin document.
IMAP_CODE = r'''
import datetime, imaplib, json, re, signal, socket, ssl, sys
FIXED = {'tan123':'lisa666tan@163.com','秦湘柳':'hyt9833@163.com',
         '莫秀珍':'13768947334@163.com','麦淳恩':'13471221956@163.com'}
TYPES = {'TimeoutError','DeadlineError','ValueError','TypeError','KeyError','OSError',
         'SSLError','SSLCertVerificationError','gaierror','ConnectionError',
         'ConnectionResetError','BrokenPipeError','EOFError','error','abort','readonly'}
class DeadlineError(Exception): pass
def alarm(*_): raise DeadlineError()
def kind(exc): return type(exc).__name__ if type(exc).__name__ in TYPES else 'Other'
def status(value): return value if value in {'OK','NO','BAD'} else 'OTHER'
result = {'stage':'input','connected':False,'folderOpened':False,
          'idSupported':False,'idAccepted':None,'uidValidity':None,
          'uidValidityMatchesStored':None,'matchingUidCount':None,
          'sampleUids':[],'metadata':[],'complete':False,'exceptionType':None}
client = None
signal.signal(signal.SIGALRM, alarm)
signal.alarm(65)
try:
    raw = sys.stdin.buffer.read(8193)
    if len(raw)>8192: raise ValueError()
    payload = json.loads(raw)
    username, address, secret = payload['username'], payload['address'], payload['auth_code']
    if FIXED.get(username)!=address or not isinstance(secret,str) or not secret.strip() or len(secret)>1024:
        raise ValueError()
    start = datetime.date.fromisoformat(payload['start_date'])
    after, previous = payload['after_uid'], payload['stored_uid_validity']
    if any(type(value) is not int or not 0<=value<=4294967295 for value in (after,previous)):
        raise ValueError()
    result['stage']='connect'
    client=imaplib.IMAP4_SSL('imap.163.com',993,ssl_context=ssl.create_default_context(),timeout=20)
    result['stage']='login'
    login_status,_=client.login(address,secret)
    if login_status!='OK': raise imaplib.IMAP4.error()
    result['connected']=True
    result['stage']='client-id'
    if b'ID' in client.capabilities or 'ID' in client.capabilities:
        result['idSupported']=True
        imaplib.Commands.setdefault('ID',('AUTH',))
        id_status,_=client._simple_command('ID','("name" "VoyagePlex" "version" "1.0" "vendor" "VoyagePlex")')
        result['idAccepted']=id_status=='OK'
        if id_status!='OK': raise imaplib.IMAP4.error()
    result['stage']='folder'
    folder_status,_=client.select('INBOX',readonly=True)
    if folder_status!='OK': raise imaplib.IMAP4.error()
    result['folderOpened']=True
    result['stage']='uid-validity'
    validity_status,parts=client.response('UIDVALIDITY')
    if (validity_status not in {'UIDVALIDITY','OK'} or not isinstance(parts,list) or len(parts)!=1
            or not isinstance(parts[0],bytes) or not re.fullmatch(rb'[0-9]{1,10}',parts[0])):
        raise ValueError()
    validity=int(parts[0])
    if not 0<validity<=4294967295: raise ValueError()
    result['uidValidity']=validity
    result['uidValidityMatchesStored']=validity==previous if previous else None
    result['stage']='search'
    # Original per-owner start date minus one day; never alter its stored cursor.
    since=(start-datetime.timedelta(days=1)).strftime('%d-%b-%Y')
    search_status,parts=client.uid('SEARCH',None,'SINCE',since)
    if search_status!='OK': raise imaplib.IMAP4.error()
    if not isinstance(parts,list) or len(parts)!=1 or not isinstance(parts[0],bytes) or len(parts[0])>262144:
        raise ValueError()
    tokens=parts[0].split()
    if len(tokens)>50000 or any(not re.fullmatch(rb'[0-9]{1,10}',token) for token in tokens):
        raise ValueError()
    all_uids=[int(token) for token in tokens]
    if any(not 0<uid<=4294967295 for uid in all_uids) or len(set(all_uids))!=len(all_uids):
        raise ValueError()
    pending=sorted(uid for uid in all_uids if uid>after)
    result['matchingUidCount']=len(pending)
    result['sampleUids']=pending[:5]
    result['stage']='metadata'
    for uid in result['sampleUids']:
        item={'uid':uid,'fetchStatus':'EXCEPTION','uidMatchesRequest':False,
              'dateValid':False,'receivedAtUtc':None,'sizeBytes':None,'exceptionType':None}
        try:
            fetch_status,parts=client.uid('FETCH',str(uid),'(INTERNALDATE RFC822.SIZE)')
            item['fetchStatus']=status(fetch_status)
            if fetch_status!='OK':
                result['metadata'].append(item)
                continue
            if (not isinstance(parts,list) or not parts or len(parts)>20
                    or any(not isinstance(part,bytes) for part in parts)
                    or sum(len(part) for part in parts)>8192):
                raise ValueError()
            metadata=b' '.join(parts)
            uid_match=re.search(rb'\bUID ([0-9]{1,10})\b',metadata)
            item['uidMatchesRequest']=uid_match is not None and int(uid_match[1])==uid
            size=re.search(rb'\bRFC822\.SIZE ([0-9]{1,20})\b',metadata)
            internal=re.search(rb'\bINTERNALDATE "([^"\r\n]{1,40})"',metadata)
            if size is not None:
                value=int(size[1])
                if 0<=value<=9223372036854775807: item['sizeBytes']=value
            if internal is not None:
                received=datetime.datetime.strptime(internal[1].decode('ascii').strip(),'%d-%b-%Y %H:%M:%S %z')
                item['receivedAtUtc']=received.astimezone(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
                item['dateValid']=True
        except DeadlineError:
            result['metadata'].append(item)
            raise
        except Exception as error:
            item['exceptionType']=kind(error)
        result['metadata'].append(item)
    result['complete']=all(item['fetchStatus']=='OK' and item['uidMatchesRequest']
                           and item['dateValid'] and item['sizeBytes'] is not None
                           for item in result['metadata'])
    result['stage']='complete' if result['complete'] else 'metadata'
except Exception as error:
    result['exceptionType']=kind(error)
finally:
    # Closing this diagnostic connection cannot expunge, mark read or update mail.
    if client is not None:
        try:
            client.sock.close()
        except Exception:
            pass
    signal.alarm(0)
    print(json.dumps(result,separators=(',',':'),ensure_ascii=True),flush=True)
'''


def checked_result(raw):
    value = json.loads(raw)
    expected = {'stage', 'connected', 'folderOpened', 'idSupported', 'idAccepted',
                'uidValidity', 'uidValidityMatchesStored', 'matchingUidCount',
                'sampleUids', 'metadata', 'complete', 'exceptionType'}
    if not isinstance(value, dict) or set(value) != expected or value['stage'] not in STAGES:
        raise ValueError('child_result_shape')
    for key in ('connected', 'folderOpened', 'idSupported', 'complete'):
        if type(value[key]) is not bool:
            raise ValueError('child_boolean')
    for key in ('idAccepted', 'uidValidityMatchesStored'):
        if value[key] is not None and type(value[key]) is not bool:
            raise ValueError('child_nullable_boolean')
    for key in ('uidValidity', 'matchingUidCount'):
        if value[key] is not None and (type(value[key]) is not int or not 0 <= value[key] <= 4294967295):
            raise ValueError('child_number')
    if (not isinstance(value['sampleUids'], list) or len(value['sampleUids']) > 5
            or any(type(uid) is not int or not 0 < uid <= 4294967295 for uid in value['sampleUids'])
            or not isinstance(value['metadata'], list) or len(value['metadata']) > 5):
        raise ValueError('child_samples')
    if value['exceptionType'] not in SAFE_TYPES | {'Other', None}:
        raise ValueError('child_exception_type')
    for item in value['metadata']:
        if (not isinstance(item, dict) or set(item) != {'uid', 'fetchStatus', 'uidMatchesRequest', 'dateValid', 'receivedAtUtc', 'sizeBytes', 'exceptionType'}
                or item['uid'] not in value['sampleUids'] or item['fetchStatus'] not in RECEIPTS
                or type(item['uidMatchesRequest']) is not bool or type(item['dateValid']) is not bool
                or item['exceptionType'] not in SAFE_TYPES | {'Other', None}
                or (item['sizeBytes'] is not None and (type(item['sizeBytes']) is not int or not 0 <= item['sizeBytes'] <= 9223372036854775807))
                or (item['receivedAtUtc'] is not None and (not isinstance(item['receivedAtUtc'], str)
                    or not re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z', item['receivedAtUtc'])))):
            raise ValueError('child_metadata_shape')
    return value


def main():
    if sys.argv[1:] != ['--execute-read-only']:
        emit('guard', {'executed': False, 'reason': 'EXPLICIT_REVIEWED_EXECUTION_FLAG_REQUIRED'})
        return 2
    deadline = time.monotonic() + 345
    api = inspect_service('voyageplex-api', deadline)
    parser = inspect_service('voyageplex-parser', deadline)
    entries = credentials_from_runtime(api)
    owners = snapshots(api, entries)  # Validate every binding before any IMAP call.
    emit('preflight', {'phase': 'metadata-only-imap', 'fourBindingsMatch': True,
                       'businessWritesPerformed': False, 'syncTriggered': False,
                       'credentialsPrintedOrPassedViaArgvOrEnv': False})
    for owner in owners:
        if deadline - time.monotonic() < 75:
            emit('mailbox', {'username': owner['username'], 'address': owner['address'],
                             'stage': 'diagnostic-client', 'complete': False,
                             'exceptionType': 'DeadlineError'})
            continue
        private_input = dict(owner)
        private_input['auth_code'] = entries[owner['username'].casefold()]['auth_code']
        try:
            raw = bounded_command(['docker', 'exec', '-i', parser['id'], 'python', '-c', IMAP_CODE],
                                  seconds=75, stdout_limit=16384, deadline=deadline,
                                  stdin=json.dumps(private_input, ensure_ascii=False, separators=(',', ':')).encode())
            result = checked_result(raw)
            emit('mailbox', {'username': owner['username'], 'address': owner['address'], **result})
        except Exception as error:
            emit('mailbox', {'username': owner['username'], 'address': owner['address'],
                             'stage': 'diagnostic-client', 'complete': False,
                             'exceptionType': safe_type(error)})
        finally:
            private_input.clear()
    emit('facts', {'businessWritesPerformed': False, 'sessionsCreated': False,
                   'syncTriggered': False, 'bodyOrAttachmentFetched': False,
                   'configurationOrContainersChanged': False,
                   'metadataSampleLimitPerMailbox': 5, 'imapAttemptsPerMailbox': 1,
                   'socketTimeoutSeconds': 20, 'childDeadlineSeconds': 65,
                   'wholeScriptBudgetSeconds': 345,
                   'healthOrMetadataSuccessProvesSynchronizationHealthy': False})
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception as error:
        emit('failure', {'stage': 'preflight', 'exceptionType': safe_type(error),
                         'businessWritesPerformed': False, 'syncTriggered': False,
                         'secretsOrRawServerResponsesPrinted': False})
        sys.exit(1)
