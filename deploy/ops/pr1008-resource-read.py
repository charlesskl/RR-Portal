"""Inert, read-only PR1008 resource evidence. Root must review before pinning.

No HTTP, login, models, database decoding, container signals, configuration
changes or cleanup. Original failed backup and OPS/state are never written.
"""
import datetime, decimal, hashlib, json, os, pathlib, re, stat, subprocess, sys, traceback

ROOT = pathlib.Path('/opt/rr-portal')
OUT = ROOT / 'deploy/backups/pr-1008-20261026-resource-read'
BACKUP = ROOT / 'deploy/backups/pr-1008-20261026-backup'
BASE = '37b6146354f692dfabc8b009f6c5b80ced091bdb'
TREE = '2ae9b60d6aa627005d5937298fa84386b3572054'
BRANCH = 'refs/heads/ops/pr-1008-20261026'
RESOURCE_PIN = False
SINCE = '2026-10-26T02:28:00Z'
UNTIL = '2026-10-26T02:34:00Z'
BACKUP_MANIFEST = 'a759bd8ef765291d2ae6dc67750c7f1c34e0897f7fa8bf6eb0953bf924ca7cdb'
BACKUP_RESULT = 'de74ef0affba561e3b94c1984b0468db4953c5b88899943bc9e192d1b9693ab9'
TARGETS = ('factory-review', 'printlink')
MAX_OUTPUT = 32 * 1024**2
MEMINFO = {'MemTotal', 'MemFree', 'MemAvailable', 'Buffers', 'Cached',
           'SwapCached', 'Active', 'Inactive', 'AnonPages', 'Mapped', 'Shmem',
           'Slab', 'SReclaimable', 'SUnreclaim', 'PageTables', 'KernelStack',
           'SwapTotal', 'SwapFree', 'CommitLimit', 'Committed_AS'}
KNOWN_COMMS = {'node', 'nodejs', 'python', 'python3', 'gunicorn', 'uvicorn',
               'java', 'postgres', 'nginx', 'redis-server', 'mysqld', 'mongod',
               'php-fpm', 'dockerd', 'containerd', 'runc'}


def need(value, label):
    if not value:
        raise RuntimeError(label)


def enc(value):
    return json.dumps(value, ensure_ascii=True, sort_keys=True,
                      separators=(',', ':'), allow_nan=False).encode()


def sha(value):
    return hashlib.sha256(value).hexdigest()


def bounded_file(path, limit=MAX_OUTPUT):
    need(not path.is_symlink() and path.is_file() and
         stat.S_ISREG(path.stat().st_mode), 'regular-read-input')
    with path.open('rb') as stream:
        value = stream.read(limit + 1)
    need(len(value) <= limit, 'bounded-read-input')
    return value


def hashfile(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024**2), b''):
            digest.update(block)
    return digest.hexdigest()


def output_file(name):
    need(re.fullmatch('[a-z0-9_.-]+', name) is not None,
         'fixed-private-output-name')
    descriptor = os.open(OUT / name,
                         os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                         0o600)
    return os.fdopen(descriptor, 'wb')


def private(name, value):
    with output_file(name) as stream:
        stream.write(value if type(value) is bytes else enc(value))
        stream.flush()
        os.fsync(stream.fileno())


def capture(label, arguments):
    """Only main's fixed read commands. File-backed output avoids large buffers."""
    need(re.fullmatch('[a-z0-9-]+', label) is not None, 'fixed-command-label')
    timed_out = False
    available = True
    exit_code = None
    with output_file(label + '.stdout.private') as stdout, \
            output_file(label + '.stderr.private') as stderr:
        try:
            completed = subprocess.run(arguments, cwd=ROOT, stdout=stdout,
                                       stderr=stderr, timeout=30, check=False)
            exit_code = completed.returncode
        except subprocess.TimeoutExpired:
            timed_out = True
        except (FileNotFoundError, PermissionError):
            available = False
        stdout.flush()
        stderr.flush()
        os.fsync(stdout.fileno())
        os.fsync(stderr.fileno())
    stdout_path, stderr_path = (OUT / (label + suffix)
                               for suffix in ('.stdout.private', '.stderr.private'))
    bounded = stdout_path.stat().st_size <= MAX_OUTPUT and stderr_path.stat().st_size <= 4 * 1024**2
    meta = {'available': available, 'succeeded': available and not timed_out and
            exit_code == 0 and bounded, 'timedOut': timed_out,
            'exitCode': exit_code, 'outputWithinBounds': bounded,
            'stdoutSHA256': hashfile(stdout_path),
            'stderrSHA256': hashfile(stderr_path)}
    private(label + '.command.private.json', meta)
    return meta, bounded_file(stdout_path) if meta['succeeded'] else None


def unavailable(reason):
    need(reason in {'missing', 'unreadable-or-invalid', 'command-unavailable-or-failed',
                    'inventory-not-exact', 'target-not-unique', 'unsupported-cgroup',
                    'unbound-cgroup', 'no-running-pid'}, 'fixed-unavailable-reason')
    return {'available': False, 'reason': reason}


def integer(value, maximum=2**63 - 1):
    need(type(value) is int and 0 <= value <= maximum, 'bounded-integer')
    return value


def decimal_integer(value):
    need(type(value) is str and re.fullmatch('[0-9]{1,20}', value) is not None,
         'decimal-counter')
    return integer(int(value), 2**64 - 1)


def timestamp(value):
    need(type(value) is str and re.fullmatch(
         r'[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,9})?Z', value),
         'literal-utc-timestamp')
    validation = re.sub(r'(\.\d{6})\d+(?=Z$)', r'\1', value)
    datetime.datetime.fromisoformat(validation.replace('Z', '+00:00'))
    return value


def window():
    return tuple(int(datetime.datetime.fromisoformat(v.replace('Z', '+00:00')).timestamp())
                 for v in (SINCE, UNTIL))


def service(row):
    config = row.get('Config') or {}
    if type(config) is not dict:
        return None
    labels = config.get('Labels') or {}
    if type(labels) is not dict:
        return None
    name = labels.get('com.docker.compose.service')
    return name if labels.get('com.docker.compose.project') == 'rr-portal' and name in TARGETS else None


def safe_state(row):
    state, host = row['State'], row['HostConfig']
    need(type(state['OOMKilled']) is bool and type(state['Running']) is bool,
         'boolean-container-state')
    health_record = state.get('Health') or {}
    need(type(health_record) is dict, 'health-object')
    health = health_record.get('Status')
    need(health is None or health in {'healthy', 'unhealthy', 'starting'}, 'known-health')
    limits = {key: integer(host.get(key, 0))
              for key in ('Memory', 'MemoryReservation')}
    swap = host.get('MemorySwap', 0)
    need(type(swap) is int and -1 <= swap <= 2**63 - 1, 'memory-swap-limit')
    limits['MemorySwap'] = swap
    return {'available': True, 'pid': integer(state['Pid']),
            'startedAt': timestamp(state['StartedAt']),
            'finishedAt': timestamp(state['FinishedAt']),
            'oomKilled': state['OOMKilled'], 'running': state['Running'],
            'restartCount': integer(row['RestartCount']),
            'health': {'available': health is not None, 'status': health},
            'memoryLimits': limits}


def parse_inventory(data, ids=None):
    rows = json.loads(data)
    need(type(rows) is list and len(rows) == 46 and
         all(type(r) is dict and type(r.get('Id')) is str and
             re.fullmatch('[a-f0-9]{64}', r['Id']) for r in rows), 'all46-inspect-shape')
    actual = {r['Id'] for r in rows}
    need(len(actual) == 46 and (ids is None or actual == set(ids)), 'exact46-inspect-ids')
    return rows


def target_rows(rows):
    result = {}
    for name in TARGETS:
        found = [r for r in rows if service(r) == name]
        if len(found) == 1:
            result[name] = found[0]
    return result


def safe_targets(rows):
    found, result = target_rows(rows), {}
    for name in TARGETS:
        if name not in found:
            result[name] = unavailable('target-not-unique')
            continue
        try:
            result[name] = safe_state(found[name])
        except (KeyError, TypeError, ValueError, RuntimeError):
            result[name] = unavailable('unreadable-or-invalid')
    return result


def sealed_backup_reference():
    """Only two selected inspect digests; never scan/hash DBs or files.tar."""
    need(BACKUP.is_dir() and not BACKUP.is_symlink() and
         stat.S_IMODE(BACKUP.stat().st_mode) == 0o700, 'private-original-backup')
    for filename in ('manifest.json', 'first-result.json'):
        path = BACKUP / filename
        need(not path.is_symlink() and stat.S_IMODE(path.stat().st_mode) & 0o077 == 0,
             'private-original-seal-file')
    manifest = bounded_file(BACKUP / 'manifest.json')
    first = bounded_file(BACKUP / 'first-result.json')
    need(sha(manifest) == BACKUP_MANIFEST and sha(first) == BACKUP_RESULT,
         'exact-original-failed-backup-two-seals')
    mapping = json.loads(manifest)
    need(type(mapping) is dict, 'manifest-object')
    result = {'available': True, 'entireBackupRehashed': False,
              'selectedInspectFilesVerifiedAgainstPinnedManifest': True,
              'manifestSHA256': BACKUP_MANIFEST, 'resultSHA256': BACKUP_RESULT,
              'snapshots': []}
    for filename in ('all-runtime-inspect-001.private.json', 'all-runtime-inspect-002.private.json'):
        path = BACKUP / filename
        need(not path.is_symlink() and stat.S_IMODE(path.stat().st_mode) & 0o077 == 0,
             'private-selected-inspect')
        data = bounded_file(path)
        need(type(mapping.get(filename)) is str and sha(data) == mapping[filename],
             'selected-inspect-exact-manifest-digest')
        result['snapshots'].append({'targets': safe_targets(parse_inventory(data)),
                                    'sha256': sha(data)})
    private('sealed-backup-reference.private.json', result)
    return result


def parse_meminfo(data):
    result = {}
    for line in data.decode('ascii').splitlines():
        match = re.fullmatch(r'([A-Za-z_()]+):\s+([0-9]+) kB', line)
        if match and match[1] in MEMINFO:
            need(match[1] not in result, 'unique-meminfo-key')
            result[match[1]] = integer(int(match[2])) * 1024
    need('MemTotal' in result and 'MemAvailable' in result, 'host-memory-required-keys')
    return {'available': True, 'bytes': result}


def parse_pressure(data):
    result = {}
    for line in data.decode('ascii').splitlines():
        match = re.fullmatch(r'(some|full) avg10=([0-9]+\.[0-9]+) avg60=([0-9]+\.[0-9]+) avg300=([0-9]+\.[0-9]+) total=([0-9]+)', line)
        need(match is not None and match[1] not in result, 'typed-pressure-record')
        averages = [float(match[i]) for i in (2, 3, 4)]
        need(all(0 <= v <= 100 for v in averages), 'pressure-percent-range')
        result[match[1]] = dict(zip(('avg10', 'avg60', 'avg300'), averages), totalMicroseconds=decimal_integer(match[5]))
    need(bool(result), 'pressure-not-empty')
    return {'available': True, 'values': result}


def read_resource(path, label, parser, limit=65536):
    if not path.exists():
        return unavailable('missing')
    try:
        data = bounded_file(path, limit)
        private(label + '.private', data)
        return parser(data)
    except (OSError, UnicodeError, ValueError, RuntimeError):
        return unavailable('unreadable-or-invalid')


def parse_flag(data):
    need(data in (b'0\n', b'1\n'), 'boolean-sysctl')
    return {'available': True, 'value': int(data.strip())}


def parse_counter(data):
    text = data.decode('ascii').strip()
    return {'available': True, 'value': decimal_integer(text)}


def parse_limit(data):
    return {'available': True, 'unlimited': True, 'value': None} if data == b'max\n' else dict(
        parse_counter(data), unlimited=False)


def parse_events_counter(data):
    allowed = {'low', 'high', 'max', 'oom', 'oom_kill', 'oom_group_kill'}
    result = {}
    for line in data.decode('ascii').splitlines():
        match = re.fullmatch(r'([a-z_]+) ([0-9]+)', line)
        need(match is not None, 'typed-memory-event')
        if match[1] in allowed:
            need(match[1] not in result, 'unique-memory-event')
            result[match[1]] = decimal_integer(match[2])
    need(bool(result), 'memory-events-not-empty')
    return {'available': True, 'counters': result}


def cgroup_memory(row, name):
    try:
        pid = integer(row['State']['Pid'])
        if pid == 0:
            return unavailable('no-running-pid')
        proc = pathlib.Path('/proc') / str(pid) / 'cgroup'
        anchor = bounded_file(proc, 16384)
        private(name + '-proc-cgroup.private', anchor)
        lines = [line.split(':', 2) for line in anchor.decode('ascii').splitlines()]
        matches = [parts[2] for parts in lines if len(parts) == 3 and parts[:2] == ['0', '']]
        if len(matches) != 1:
            return unavailable('unsupported-cgroup')
        relative = pathlib.PurePosixPath(matches[0])
        need(relative.is_absolute() and '..' not in relative.parts, 'safe-cgroup-path')
        need(row['Id'] in relative.parts or 'docker-' + row['Id'] + '.scope' in relative.parts,
             'cgroup-bound-to-inspected-container')
        root = pathlib.Path('/sys/fs/cgroup').resolve(strict=True)
        directory = (root / str(relative).lstrip('/')).resolve(strict=True)
        need(directory.is_dir() and directory.is_relative_to(root), 'bounded-cgroup-directory')
        parsers = {'memory.events': parse_events_counter, 'memory.current': parse_counter,
                   'memory.max': parse_limit, 'memory.peak': parse_counter,
                   'memory.pressure': parse_pressure}
        result = {'available': True, 'version': 2, 'containerBindingVerified': True,
                  'pathSHA256': sha(str(relative).encode()), 'files': {},
                  'historicalAccountingMayResetOnContainerRestart': True}
        for filename, parser in parsers.items():
            result['files'][filename] = read_resource(directory / filename,
                name + '-cgroup-' + filename, parser)
        need(bounded_file(proc, 16384) == anchor, 'process-cgroup-anchor-still-matches')
        return result
    except (OSError, UnicodeError, ValueError, KeyError, TypeError, RuntimeError):
        return unavailable('unbound-cgroup')


def bytes_quantity(value):
    match = re.fullmatch(r'([0-9]+(?:\.[0-9]{1,9})?)\s*(B|kB|KB|KiB|MB|MiB|GB|GiB|TB|TiB|PB|PiB)', value)
    need(match is not None, 'typed-docker-memory-size')
    units = {'B': 1, 'kB': 1000, 'KB': 1000, 'KiB': 1024, 'MB': 1000**2,
             'MiB': 1024**2, 'GB': 1000**3, 'GiB': 1024**3, 'TB': 1000**4,
             'TiB': 1024**4, 'PB': 1000**5, 'PiB': 1024**5}
    return integer(int(decimal.Decimal(match[1]) * units[match[2]]))


def percent(value, maximum):
    need(type(value) is str and re.fullmatch(r'[0-9]+(?:\.[0-9]+)?%', value), 'typed-percent')
    number = decimal.Decimal(value[:-1])
    need(0 <= number <= maximum, 'bounded-percent')
    return float(number)


def stats_summary(data, rows):
    inventory = {r['Id']: r for r in rows}
    values, seen = [], set()
    for line in data.decode().splitlines():
        row = json.loads(line)
        cid = row.get('ID') or row.get('Container')
        need(cid in inventory and cid not in seen, 'stats-bound-unique-inspected-id')
        seen.add(cid)
        memory = row['MemUsage'].split(' / ')
        need(len(memory) == 2, 'stats-memory-usage-and-limit')
        item = {'memoryUsageBytes': bytes_quantity(memory[0]), 'memoryLimitBytes': bytes_quantity(memory[1]),
                'cpuPercent': percent(row['CPUPerc'], 1000000),
                'memoryPercent': percent(row['MemPerc'], 100), 'pids': decimal_integer(row['PIDs'])}
        values.append((service(inventory[cid]), item))
    need(len(seen) <= 46, 'stats-inventory-bound')
    return {'available': True, 'reportedContainerCount': len(values),
            'targets': {name: next((dict(value, available=True) for label, value in values if label == name),
                                   unavailable('missing')) for name in TARGETS},
            'allReportedContainersTotals': {
                'memoryUsageBytes': sum(value['memoryUsageBytes'] for _, value in values),
                'cpuPercent': sum(value['cpuPercent'] for _, value in values),
                'pids': sum(value['pids'] for _, value in values)},
            'reportedWorkingSetNotProcessRSSOrHostPressureProof': True}


def docker_event_summary(data, cid):
    start, end = window()
    result = []
    for line in data.decode().splitlines():
        row = json.loads(line)
        action = row.get('Action') or row.get('status')
        actor = row.get('Actor') or {}
        need(row.get('Type') == 'container' and actor.get('ID') == cid and
             action in {'oom', 'die', 'restart'}, 'fixed-container-resource-event')
        seconds = integer(row.get('time'))
        need(start <= seconds <= end, 'event-in-fixed-window')
        item = {'action': action, 'unixSeconds': seconds,
                'factoryReviewContainerMatch': True, 'printlinkContainerMatch': False}
        if row.get('timeNano') is not None:
            nanos = integer(row['timeNano'])
            need(start * 1000000000 <= nanos <= end * 1000000000 and
                 nanos // 1000000000 == seconds, 'event-nanoseconds-in-fixed-window')
            item['unixNanoseconds'] = nanos
        raw_exit = actor.get('Attributes', {}).get('exitCode')
        if raw_exit is not None:
            need(type(raw_exit) is str and re.fullmatch('[0-9]{1,3}', raw_exit), 'typed-event-exit-code')
            item['exitCode'] = integer(int(raw_exit), 255)
        result.append(item)
        need(len(result) <= 10000, 'bounded-event-count')
    return {'available': True, 'events': result, 'emptyDoesNotProveNoPastOOM': True}


def oom_message(message, identities):
    need(type(message) is str and len(message) <= 262144, 'bounded-kernel-message')
    if not re.search(r'oom-kill|invoked oom-killer|out of memory|killed process|memory cgroup', message, re.I):
        return None
    constraint = re.search(r'\bconstraint=(CONSTRAINT_[A-Z_]+)', message)
    category = {'CONSTRAINT_MEMCG': 'MEMCG', 'CONSTRAINT_NONE': 'GLOBAL'}.get(
        constraint[1] if constraint else None, 'OTHER' if constraint else 'UNSPECIFIED')
    found = re.search(r'\btask=([^,\s]+)', message) or re.search(r'Killed process [0-9]+ \(([^)]*)\)', message, re.I)
    comm = found[1] if found else None
    result = {'constraint': category, 'comm': comm if comm in KNOWN_COMMS else None,
              'commAvailable': comm in KNOWN_COMMS,
              'unknownCommSHA256': sha(comm.encode()) if comm and comm not in KNOWN_COMMS else None,
              'containerMatches': {name: bool(cid and cid in message) for name, cid in identities.items()},
              'memoryKiB': {}}
    for label in ('total-vm', 'anon-rss', 'file-rss', 'shmem-rss', 'pgtables'):
        found = re.search(r'\b' + re.escape(label) + r':([0-9]+)kB\b', message)
        if found:
            result['memoryKiB'][label] = integer(int(found[1]))
    memory = re.search(r'\bmemory: usage ([0-9]+)kB, limit ([0-9]+)kB, failcnt ([0-9]+)', message, re.I)
    if memory:
        result['memoryKiB'].update(usage=integer(int(memory[1])), limit=integer(int(memory[2])))
        result['memoryFailCount'] = integer(int(memory[3]))
    return result


def journal_summary(data, identities):
    start, end = window()
    records = []
    for line in data.decode().splitlines():
        row = json.loads(line)
        need(type(row.get('__REALTIME_TIMESTAMP')) is str, 'journal-real-time')
        micros = decimal_integer(row['__REALTIME_TIMESTAMP'])
        need(start * 1000000 <= micros <= end * 1000000, 'journal-fixed-window')
        item = oom_message(row.get('MESSAGE'), identities)
        if item is not None:
            records.append(item)
        need(len(records) <= 1000, 'bounded-oom-summary-records')
    return {'available': True, 'records': records,
            'constraintCounts': {name: sum(r['constraint'] == name for r in records)
                                 for name in ('MEMCG', 'GLOBAL', 'OTHER', 'UNSPECIFIED')},
            'unmatchedOrMissingLogsDoNotProveNoOOM': True,
            'noAutomaticAttributionFromKilledProcessLineAlone': True,
            'recordCountsNotOOMEventCounts': True}


def collect(result):
    result['observedAtUTC'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    result['historicalWindowUTC'] = {'since': SINCE, 'until': UNTIL}
    result['hostAndCgroupReadingsAreCurrentNotHistorical'] = True
    try:
        result['sealedFailedBackupReference'] = sealed_backup_reference()
    except (OSError, UnicodeError, ValueError, KeyError, TypeError, RuntimeError):
        result['sealedFailedBackupReference'] = unavailable('unreadable-or-invalid')
    result['hostMemory'] = read_resource(pathlib.Path('/proc/meminfo'), 'host-meminfo', parse_meminfo)
    result['hostMemoryPressure'] = read_resource(pathlib.Path('/proc/pressure/memory'), 'host-memory-pressure', parse_pressure)
    result['bridgeSysctls'] = {name: read_resource(pathlib.Path('/proc/sys/net/bridge') / name,
        'bridge-' + name, parse_flag, 16) for name in ('bridge-nf-call-iptables', 'bridge-nf-call-ip6tables')}
    commands = result['commands'] = {}
    commands['containerIDs'], data = capture('docker-container-ids', ['docker', 'container', 'ls', '-aq', '--no-trunc'])
    ids, rows, found = [], [], {}
    if data is not None:
        try:
            ids = data.decode('ascii').splitlines()
        except UnicodeError:
            ids = []
        if len(ids) != 46 or len(set(ids)) != 46 or not all(re.fullmatch('[a-f0-9]{64}', cid) for cid in ids):
            ids = []
    if ids:
        commands['runtimeInspect'], data = capture('docker-all46-inspect', ['docker', 'inspect', *ids])
        if data is not None:
            try:
                rows = parse_inventory(data, ids)
                found = target_rows(rows)
            except (UnicodeError, ValueError, KeyError, TypeError, RuntimeError):
                rows = []
    result['runtimeInspect'] = {'available': True, 'containerCount': 46, 'targets': safe_targets(rows)} if rows else unavailable('inventory-not-exact')
    commands['dockerStats'], data = capture('docker-stats', ['docker', 'stats', '--no-stream', '--no-trunc', '--format', '{{json .}}'])
    result['dockerStats'] = unavailable('command-unavailable-or-failed')
    if data is not None and rows:
        try:
            result['dockerStats'] = stats_summary(data, rows)
        except (UnicodeError, ValueError, KeyError, TypeError, RuntimeError, decimal.InvalidOperation):
            result['dockerStats'] = unavailable('unreadable-or-invalid')
    result['cgroupMemory'] = {}
    for name in TARGETS:
        result['cgroupMemory'][name] = cgroup_memory(found[name], name) if name in found else unavailable('target-not-unique')
    identities = {name: found[name]['Id'] if name in found else None for name in TARGETS}
    result['factoryReviewDockerEvents'] = unavailable('target-not-unique')
    if identities['factory-review']:
        commands['factoryReviewEvents'], data = capture('docker-factory-resource-events',
            ['docker', 'events', '--since', SINCE, '--until', UNTIL, '--filter', 'type=container',
             '--filter', 'container=' + identities['factory-review'], '--filter', 'event=oom',
             '--filter', 'event=die', '--filter', 'event=restart', '--format', '{{json .}}'])
        if data is not None:
            try:
                result['factoryReviewDockerEvents'] = docker_event_summary(data, identities['factory-review'])
            except (UnicodeError, ValueError, KeyError, TypeError, RuntimeError):
                result['factoryReviewDockerEvents'] = unavailable('unreadable-or-invalid')
        else:
            result['factoryReviewDockerEvents'] = unavailable('command-unavailable-or-failed')
    commands['kernelOOMJournal'], data = capture('kernel-oom-journal',
        ['journalctl', '-k', '--since', '2026-10-26 02:28:00 UTC',
         '--until', '2026-10-26 02:34:00 UTC', '--no-pager', '--output=json',
         '--grep', 'oom-kill|invoked oom-killer|Out of memory|Killed process|Memory cgroup', '--case-sensitive=no'])
    result['kernelOOMJournal'] = unavailable('command-unavailable-or-failed')
    if data is not None:
        try:
            result['kernelOOMJournal'] = journal_summary(data, identities)
        except (UnicodeError, ValueError, KeyError, TypeError, RuntimeError):
            result['kernelOOMJournal'] = unavailable('unreadable-or-invalid')
    result.update(success=True, collectionCompleted=True, observationsOnly=True,
        unavailableEvidenceMustNotBeTreatedAsNegative=True,
        containerOrHostPressureCauseNotAutomaticallyConcluded=True,
        resourceFaultResolved=False, freshBackupSucceeded=False,
        businessWritesPerformed=False, runtimeMutationPerformed=False,
        configurationChanged=False, signalsPerformed=False,
        liveNetworkRequestsPerformed=False, modelCallsPerformed=False,
        businessRowsDecoded=False, secretsOrCommandArgumentsPrinted=False,
        originalFailedBackupOPSAndStateUnchanged=True)
    result['commandTimeoutOnlyTerminatesOwnedReadClientNotContainers'] = True


def main():
    need(RESOURCE_PIN is True and sys.argv[1:] == ['resource-read'] and
         os.environ.get('RELEASE_BRANCH') == BRANCH and
         os.environ.get('RELEASE_ATTEMPT') == '1', 'inert-or-wrong-resource-invocation')
    os.umask(0o077)
    OUT.mkdir(mode=0o700)
    result = {'mode': 'resource-read', 'base': BASE, 'target': BASE, 'tree': TREE,
              'success': False, 'businessWritesPerformed': False,
              'runtimeMutationPerformed': False, 'configurationChanged': False,
              'signalsPerformed': False, 'liveNetworkRequestsPerformed': False,
              'modelCallsPerformed': False, 'businessRowsDecoded': False,
              'secretsOrCommandArgumentsPrinted': False}
    try:
        collect(result)
    except BaseException as error:
        result.update(success=False, safeFailureType=type(error).__name__)
        private('failure.private.txt', traceback.format_exc().encode())
    finally:
        private('first-result.json', result)
        manifest = {str(path.relative_to(OUT)): hashfile(path)
                    for path in OUT.iterdir() if path.is_file()}
        private('manifest.json', manifest)
        print(enc(dict(result, manifestSHA256=hashfile(OUT / 'manifest.json'),
                       resultSHA256=hashfile(OUT / 'first-result.json'))).decode(), flush=True)
    return 0 if result['success'] else 1


if __name__ == '__main__':
    try:
        sys.exit(main())
    except SystemExit:
        raise
    except BaseException:
        print('{"mode":"resource-read","success":false,"safeFailure":"INERT_RESOURCE_REJECTED"}', flush=True)
        sys.exit(1)
