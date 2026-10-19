"""Phase 1 only: in-memory configuration flags, read-only SQLite, classified logs.

No sessions, IMAP tests, mailbox synchronization, account/configuration writes or
container changes. Secret-bearing environment values never leave this process.
"""
import collections
import contextlib
import datetime
import ipaddress
import json
import os
import pathlib
import re
import select
import sqlite3
import stat
import subprocess
import time
import urllib.error
import urllib.request

ROOT = pathlib.Path('/opt/rr-portal')
DB = ROOT / 'apps/船务部/VoyagePlex船务协同系统/data-runtime/voyageplex.db'
KEY = 'VOYAGEPLEX_HUADENG_MAILBOXES_JSON'
OWNERS = {2: ('tan123', 'lisa666tan@163.com'), 3: ('秦湘柳', 'hyt9833@163.com'),
          5: ('莫秀珍', '13768947334@163.com'), 6: ('麦淳恩', '13471221956@163.com')}
EXCEPTIONS = {'SqliteException', 'DbUpdateException', 'InvalidOperationException', 'TaskCanceledException',
              'OperationCanceledException', 'TimeoutException', 'IOException', 'HttpRequestException',
              'SocketException', 'AuthenticationException', 'ImapProtocolException', 'ImapCommandException',
              'ServiceNotConnectedException', 'ServiceNotAuthenticatedException', 'JsonException',
              'FormatException', 'ArgumentException', 'NullReferenceException', 'ObjectDisposedException'}


def emit(section, value):
    line = json.dumps({'section': section, 'data': value}, sort_keys=True, separators=(',', ':'), ensure_ascii=True)
    if len(line.encode()) > 6000:
        raise ValueError('output_limit')
    print(line, flush=True)


def command(args, limit=262144):
    process = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    output, truncated, timed_out = bytearray(), False, False
    deadline = time.monotonic() + 30
    try:
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0 or not select.select([process.stdout], [], [], max(0, remaining))[0]:
                timed_out = True
                break
            block = os.read(process.stdout.fileno(), min(65536, limit - len(output)))
            if not block:
                try:
                    process.wait(timeout=max(.1, deadline - time.monotonic()))
                except subprocess.TimeoutExpired:
                    timed_out = True
                break
            output.extend(block)
            if len(output) >= limit:
                truncated = True
                break
    finally:
        # Stop only this diagnostic CLI client, never an application container.
        if process.poll() is None:
            process.kill()
        process.wait(timeout=3)
        process.stdout.close()
    return bytes(output), {'ok': process.returncode == 0 and not truncated and not timed_out,
                           'bytes': len(output), 'truncated': truncated, 'timedOut': timed_out}


def bounded_file(path, limit):
    with path.open('rb') as stream:
        content = stream.read(limit + 1)
    if len(content) > limit:
        raise ValueError('file_limit')
    return content


def date(value):
    if value is None or value == '':
        return None
    if not isinstance(value, str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})?)?', value):
        return 'unrecognized-date-format'
    return value


def label(value):
    return value if isinstance(value, str) and len(value) <= 128 and not any(ord(c) < 32 for c in value) else 'invalid-label'


def error_category(value):
    if not value:
        return 'none'
    text = str(value).lower()
    for category, pattern in [
        ('generic-sync-failure', r'邮箱同步失败'),
        ('authentication', r'authentication|credentials|invalid password|授权|密码|认证|登录'),
        ('timeout', r'timeout|timed out|超时'),
        ('configuration', r'not configured|未配置|尚未配置|配置.*不一致'),
        ('storage', r'sqlite|database|dbupdate|数据库|磁盘'),
        ('network', r'connection|socket|network|连接'),
        ('parsing', r'parse|pdf|excel|xlsx|解析')]:
        if re.search(pattern, text):
            return category
    return 'present-unclassified'


def config(value):
    try:
        entries = json.loads(value)
        if not isinstance(entries, list) or len(entries) > 20:
            return None
        result = []
        for entry in entries:
            if not isinstance(entry, dict) or not all(isinstance(k, str) for k in entry):
                return None
            lowered = {k.lower(): v for k, v in entry.items()}
            if len(lowered) != len(entry):
                return None
            result.append(lowered)
        return result
    except (ValueError, TypeError):
        return None


def configuration_flags(api_environment):
    private_env = ROOT / '.env.cloud.production'
    regular = private_env.is_file() and not private_env.is_symlink()
    raw = bounded_file(private_env, 1048576).decode() if regular else ''
    values = [line.split('=', 1)[1].strip() for line in raw.splitlines() if line.startswith(KEY + '=')]
    value = values[0] if len(values) == 1 else ''
    if len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}:
        value = value[1:-1]
    actual = api_environment.get(KEY, '')
    expected, running = config(value), config(actual)
    flags = {'privateFileRegular': regular, 'privateFileModePrivate': regular and stat.S_IMODE(private_env.stat().st_mode) & 0o077 == 0,
             'privateVariableExactlyOnce': len(values) == 1, 'privateValuePresent': bool(value), 'containerValuePresent': bool(actual),
             'privateAndContainerValueIdentical': value == actual, 'privateJsonValid': expected is not None,
             'containerJsonValid': running is not None, 'privateAndContainerParsedEntriesIdentical': expected == running,
             'entryCount': len(running) if running is not None else None}
    users = [e.get('username', '').strip().casefold() for e in running or [] if isinstance(e.get('username'), str)]
    addresses = [e.get('address', '').strip().casefold() for e in running or [] if isinstance(e.get('address'), str)]
    flags['uniqueNonemptyUsernames'] = len(users) == len(running or []) and all(users) and len(set(users)) == len(users)
    flags['uniqueNonemptyAddresses'] = len(addresses) == len(running or []) and all(addresses) and len(set(addresses)) == len(addresses)
    emit('serverMailboxConfiguration', flags)
    return running or []


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


HTTP = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())


def inspect_service(service):
    template = '{"id":{{json .Id}},"imageId":{{json .Image}},"status":{{json .State.Status}},"running":{{json .State.Running}},"oomKilled":{{json .State.OOMKilled}},"exitCode":{{json .State.ExitCode}},"startedAt":{{json .State.StartedAt}},"restartCount":{{json .RestartCount}},"health":{{if .State.Health}}{{json .State.Health.Status}}{{else}}"none"{{end}},"healthFailingStreak":{{if .State.Health}}{{.State.Health.FailingStreak}}{{else}}0{{end}},"memory":{{json .HostConfig.Memory}},"memorySwap":{{json .HostConfig.MemorySwap}},"environment":{{json .Config.Env}},"networks":{{json .NetworkSettings.Networks}}}'
    raw, receipt = command(['docker', 'inspect', '--format', template, 'rr-portal-' + service + '-1'])
    if not receipt['ok']:
        emit('container', {'service': service, 'query': receipt, 'present': False})
        return {}, None
    value = json.loads(raw)
    if not re.fullmatch('[a-f0-9]{64}', str(value.get('id'))) or not re.fullmatch('sha256:[a-f0-9]{64}', str(value.get('imageId'))):
        raise ValueError('container_identity_shape')
    environment = value.pop('environment') or []
    networks = value.pop('networks') or {}
    mapped = dict(item.split('=', 1) for item in environment if isinstance(item, str) and '=' in item)
    if len(mapped) != len(environment):
        raise ValueError('environment_shape')
    value['startedAt'] = date(value.get('startedAt'))
    emit('container', {'service': service, 'query': receipt, 'present': True, 'state': value})
    addresses = [n.get('IPAddress') for n in networks.values() if isinstance(n, dict) and n.get('IPAddress')]
    health = {'service': service, 'status': None, 'errorType': None}
    started = time.monotonic()
    try:
        if len(addresses) != 1:
            raise ValueError('network_inventory')
        address = ipaddress.ip_address(addresses[0])
        if address.version != 4 or not address.is_private or address.is_loopback:
            raise ValueError('private_container_address')
        port, path = {'voyageplex-api': (5088, '/api/health'), 'voyageplex-parser': (8091, '/health'), 'voyageplex-web': (3000, '/voyageplex/api/health')}[service]
        with HTTP.open('http://' + str(address) + ':' + str(port) + path, timeout=5) as response:
            health['status'] = response.status
    except urllib.error.HTTPError as error:
        health['status'] = error.code
    except Exception as error:
        health['errorType'] = type(error).__name__ if type(error).__name__ in {'TimeoutError', 'URLError', 'ValueError', 'ConnectionError'} else 'Other'
    health['elapsedMs'] = round((time.monotonic() - started) * 1000)
    emit('health', health)
    return mapped, value['id']


def database_report(entries):
    with contextlib.closing(sqlite3.connect(DB.as_uri() + '?mode=ro', uri=True, timeout=10)) as connection:
        connection.row_factory = sqlite3.Row
        connection.execute('PRAGMA query_only=ON')
        connection.execute('BEGIN')
        connection.execute('SELECT count(*) FROM sqlite_master').fetchone()
        owners = connection.execute('SELECT Id,Username,Role,CompanyAccess,MailboxAddress,IsActive,MailboxTestStatus,MailboxTestedAt FROM Users WHERE Id IN (2,3,5,6)').fetchall()
        mapped = {row['Id']: dict(row) for row in owners}
        cursors = []
        for owner, (expected_user, address) in OWNERS.items():
            user = mapped.get(owner)
            if user is None:
                emit('mailbox', {'ownerId': owner, 'expectedUsername': expected_user, 'userPresent': False})
                continue
            matches = [e for e in entries if isinstance(e.get('username'), str) and e['username'].strip().casefold() == user['Username'].casefold()]
            entry = matches[0] if len(matches) == 1 else {}
            state = connection.execute('SELECT Id,Address,UidValidity,LastUid,LastSuccessAt,LastError FROM MailSyncStates WHERE Id=?', (1000 + owner,)).fetchone()
            setting = connection.execute('SELECT Id,StartDate,SyncEnabled,SyncIntervalMinutes,RetentionDays,UpdatedAt FROM MailSystemSettings WHERE Id=?', (1000 + owner,)).fetchone()
            aggregate = connection.execute("SELECT COUNT(*),SUM(CASE WHEN Error<>'' THEN 1 ELSE 0 END),MAX(MailReceivedDate),MAX(MailReceivedAt),MAX(CreatedAt) FROM ImportEmailItems WHERE Company='Huadeng' AND MailOwnerId=? AND MailboxKey<>''", (owner,)).fetchone()
            mismatch = connection.execute("SELECT COUNT(*) FROM ImportEmailItems WHERE Company='Huadeng' AND MailOwnerId=? AND MailboxKey<>'' AND MailboxKey NOT LIKE ?", (owner, 'Huadeng:' + str(owner) + ':%')).fetchone()[0]
            cursor = None
            if state:
                cursors.append(state['Id'])
                cursor = {'id': state['Id'], 'addressMatchesBinding': str(state['Address']).casefold() == str(user['MailboxAddress']).casefold(),
                          'uidValidity': state['UidValidity'], 'lastUid': state['LastUid'], 'lastSuccessAt': date(state['LastSuccessAt']),
                          'lastErrorPresent': bool(state['LastError']), 'lastErrorCategory': error_category(state['LastError'])}
            settings = None if not setting else {'id': setting['Id'], 'startDate': date(setting['StartDate']), 'syncEnabled': bool(setting['SyncEnabled']),
                      'intervalMinutes': setting['SyncIntervalMinutes'], 'retentionDays': setting['RetentionDays'], 'updatedAt': date(setting['UpdatedAt'])}
            emit('mailbox', {'ownerId': owner, 'username': label(user['Username']), 'expectedUsernameMatches': user['Username'] == expected_user,
                 'role': user['Role'] if user['Role'] in {'admin', 'supervisor', 'shipping'} else 'unrecognized',
                 'companyAccess': user['CompanyAccess'] if user['CompanyAccess'] in {'Huadeng', 'Xingxin', 'Both'} else 'unrecognized',
                 'isActive': bool(user['IsActive']), 'boundAddress': user['MailboxAddress'] if user['MailboxAddress'] in {v[1] for v in OWNERS.values()} else 'different-address',
                 'addressMatchesExpected': str(user['MailboxAddress']).casefold() == address.casefold(),
                 'mailboxTestStatus': user['MailboxTestStatus'] if user['MailboxTestStatus'] in {'Unknown', 'Connected', 'Failed', 'NotConfigured'} else 'other', 'mailboxTestedAt': date(user['MailboxTestedAt']),
                 'configuration': {'entryCountForUsername': len(matches), 'addressMatchesBinding': isinstance(entry.get('address'), str) and entry['address'].strip().casefold() == str(user['MailboxAddress']).casefold(),
                      'hostMatches163': isinstance(entry.get('host'), str) and entry['host'].strip().casefold() == 'imap.163.com', 'folderMatchesInbox': entry.get('folder') == 'INBOX',
                      'authorizationValuePresentAndLengthValid': isinstance(entry.get('authcode'), str) and 0 < len(entry['authcode'].strip()) <= 1024},
                 'cursor': cursor, 'settings': settings, 'mailCount': aggregate[0], 'parseErrorCount': aggregate[1] or 0,
                 'latestReceivedDate': date(aggregate[2]), 'latestReceivedAt': date(aggregate[3]), 'latestCreatedAt': date(aggregate[4]), 'ownerKeyMismatchCount': mismatch})
        emit('cursorIsolation', {'expectedOwners': 4, 'usersPresent': len(mapped), 'cursorsPresent': len(cursors), 'independentCursorIds': len(cursors) == len(set(cursors)), 'queryOnly': connection.execute('PRAGMA query_only').fetchone()[0] == 1})
        connection.rollback()


def log_report(service, identifier):
    if not identifier:
        return
    raw, receipt = command(['docker', 'logs', '--timestamps', '--tail', '500', identifier])
    counts, owners, timestamps = collections.Counter(), {}, []
    for line in raw.decode('utf-8', 'replace').splitlines():
        stamp = re.match(r'^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.\d{1,9})?Z\s', line)
        first = re.search(r'邮箱同步写入失败[：:]\s*([A-Za-z_][A-Za-z0-9_]*)', line)
        second = re.search(r'邮箱\s+(Huadeng:(?:2|3|5|6)|Xingxin:)\s+同步失败[：:]\s*([A-Za-z_][A-Za-z0-9_]*)', line)
        if first:
            kind = first[1] if first[1] in EXCEPTIONS else 'OtherExceptionType'
            counts['writeFailure:' + kind] += 1
        if second:
            kind = second[2] if second[2] in EXCEPTIONS else 'OtherExceptionType'
            owners.setdefault(second[1], collections.Counter())[kind] += 1
        if (first or second) and stamp:
            timestamps.append(stamp[1] + 'Z')
        if 'BackgroundService failed' in line:
            counts['backgroundServiceFailedMarker'] += 1
        if 'Application is shutting down' in line:
            counts['hostShutdownMarker'] += 1
    emit('classifiedRecentLog', {'service': service, 'query': receipt, 'tailLimit': 500, 'byteLimit': 262144, 'returnedLines': len(raw.splitlines()),
         'counts': dict(counts), 'perMailboxExceptionCounts': {k: dict(v) for k, v in owners.items()},
         'firstMatchingUtc': min(timestamps) if timestamps else None, 'lastMatchingUtc': max(timestamps) if timestamps else None,
         'rawLogPrinted': False, 'historicalCompletenessProven': False})


def main():
    environment, identifiers = {}, {}
    for service in ['voyageplex-api', 'voyageplex-parser', 'voyageplex-web']:
        values, identifier = inspect_service(service)
        identifiers[service] = identifier
        if service == 'voyageplex-api':
            environment = values
    entries = configuration_flags(environment)
    database_report(entries)
    for service, identifier in identifiers.items():
        log_report(service, identifier)
    memory = {}
    for line in bounded_file(pathlib.Path('/proc/meminfo'), 16384).decode().splitlines():
        match = re.fullmatch(r'(MemTotal|MemAvailable|MemFree|SwapTotal|SwapFree):\s+([0-9]+) kB', line)
        if match:
            memory[match[1] + 'Bytes'] = int(match[2]) * 1024
    emit('memoryNow', memory)
    emit('facts', {'phase': 1, 'businessWritesPerformed': False, 'sessionsCreated': False, 'imapTestsPerformed': False,
                   'syncTriggered': False, 'configurationOrContainersChanged': False, 'secretsOrMessageContentsPrinted': False})


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        emit('failure', {'safeError': 'VOYAGEPLEX_MAIL_PHASE1_FAILED', 'errorType': type(error).__name__ if type(error).__name__ in
                        {'ValueError', 'TypeError', 'KeyError', 'FileNotFoundError', 'PermissionError', 'OperationalError', 'TimeoutExpired', 'UnicodeDecodeError'} else 'Other',
                        'businessWritesPerformed': False, 'syncTriggered': False})
        raise SystemExit(1)
