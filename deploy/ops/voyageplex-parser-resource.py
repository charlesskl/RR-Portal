"""Bounded, read-only parser resource diagnosis; no raw health/log output."""
import collections
import datetime
import json
import math
import os
import pathlib
import re
import select
import stat
import subprocess
import time

PARSER = 'c6c8c7b8a69fcbddb9cd07dc9c814e3812069ac9800220035befa87b2c486a75'
DEADLINE = time.monotonic() + 55
EXCEPTIONS = {'TimeoutError', 'URLError', 'HTTPError', 'gaierror', 'ConnectionError', 'ConnectionRefusedError',
              'ConnectionResetError', 'ReadTimeout', 'ConnectTimeout', 'ConnectError', 'ReadError',
              'RemoteProtocolError', 'ProtocolError', 'CancelledError', 'MemoryError', 'OSError',
              'PermissionError', 'RuntimeError', 'KeyError', 'ValueError', 'TypeError', 'BrokenPipeError',
              'SSLError', 'EOFError', 'ImportError', 'ModuleNotFoundError', 'AttributeError'}


def emit(section, value):
    line = json.dumps({'section': section, 'data': value}, ensure_ascii=True, sort_keys=True, separators=(',', ':'), allow_nan=False)
    if len(line.encode()) > 6000:
        raise ValueError('output_limit')
    print(line, flush=True)


def command(args, limit=262144):
    if time.monotonic() >= DEADLINE:
        return b'', {'ok': False, 'bytes': 0, 'timedOut': True, 'truncated': False}
    process = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    output, timed_out, truncated = bytearray(), False, False
    deadline = min(DEADLINE, time.monotonic() + 30)
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
        # Only this diagnostic CLI client is stopped on a timeout/read cap.
        # No Docker signal/restart API, ptrace or application signal is used.
        if process.poll() is None:
            process.kill()
        process.wait(timeout=3)
        process.stdout.close()
    return bytes(output), {'ok': process.returncode == 0 and not timed_out and not truncated,
                           'bytes': len(output), 'timedOut': timed_out, 'truncated': truncated}


def read(path, limit=16384):
    with pathlib.Path(path).open('rb') as stream:
        value = stream.read(limit + 1)
    if len(value) > limit:
        raise ValueError('file_limit')
    return value.decode('utf-8', 'replace')


def safe_date(value):
    return value if isinstance(value, str) and re.fullmatch(r'\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z?', value) else None


def classify(text):
    return {'exceptionTypes': sorted(kind for kind in EXCEPTIONS if re.search(r'\b' + re.escape(kind) + r'\b', text)),
            'timeoutMarker': bool(re.search(r'timed out|timeout|TimeoutError', text, re.I)),
            'dnsMarker': bool(re.search(r'gaierror|name or service not known|temporary failure in name resolution|NameResolutionError', text, re.I)),
            'connectionMarker': bool(re.search(r'connection refused|connection reset|network is unreachable|ConnectionError', text, re.I)),
            'memoryMarker': bool(re.search(r'out of memory|MemoryError|oom.kill', text, re.I))}


def inspect_service(service, include_health=False):
    template = '{"id":{{json .Id}},"imageId":{{json .Image}},"status":{{json .State.Status}},"running":{{json .State.Running}},"oomKilled":{{json .State.OOMKilled}},"exitCode":{{json .State.ExitCode}},"hostPid":{{json .State.Pid}},"startedAt":{{json .State.StartedAt}},"restartCount":{{json .RestartCount}},"memoryLimit":{{json .HostConfig.Memory}},"memorySwapLimit":{{json .HostConfig.MemorySwap}},"health":{{if .State.Health}}{{json .State.Health.Status}}{{else}}"none"{{end}},"failingStreak":{{if .State.Health}}{{.State.Health.FailingStreak}}{{else}}0{{end}},"healthLog":{{if .State.Health}}{{json .State.Health.Log}}{{else}}[]{{end}}}'
    raw, receipt = command(['docker', 'inspect', '--format', template, 'rr-portal-' + service + '-1'])
    if not receipt['ok']:
        emit('containerState', {'service': service, 'query': receipt, 'available': False})
        return None
    value = json.loads(raw)
    if not re.fullmatch('[a-f0-9]{64}', str(value.get('id'))) or not re.fullmatch('sha256:[a-f0-9]{64}', str(value.get('imageId'))):
        raise ValueError('container_identity_shape')
    history = value.pop('healthLog') or []
    value['startedAt'] = safe_date(value.get('startedAt'))
    emit('containerState', {'service': service, 'query': receipt, 'state': value,
                           'matchesFixedParser': value['id'] == PARSER if service == 'voyageplex-parser' else None})
    if include_health and value['id'] == PARSER:
        safe = [{'start': safe_date(row.get('Start')), 'end': safe_date(row.get('End')), 'exitCode': row.get('ExitCode') if type(row.get('ExitCode')) is int else None,
                 'classification': classify(str(row.get('Output') or ''))} for row in history[-5:]]
        emit('parserLastFiveHealthChecks', safe)
    return value


def size(value):
    match = re.fullmatch(r'\s*([0-9]+(?:\.[0-9]+)?)\s*(B|kB|KB|KiB|MB|MiB|GB|GiB|TB|TiB)\s*', value)
    units = {'B': 1, 'kB': 1000, 'KB': 1000, 'KiB': 1024, 'MB': 1000**2, 'MiB': 1024**2,
             'GB': 1000**3, 'GiB': 1024**3, 'TB': 1000**4, 'TiB': 1024**4}
    return int(float(match[1]) * units[match[2]]) if match else None


def stats():
    raw, receipt = command(['docker', 'stats', '--no-stream', '--format', '{{json .}}', PARSER], 16384)
    result = {'query': receipt}
    if receipt['ok']:
        value = json.loads(raw)
        for key, out in [('CPUPerc', 'cpuPercent'), ('MemPerc', 'memoryPercent')]:
            text = value.get(key, '').rstrip('%')
            result[out] = float(text) if re.fullmatch(r'[0-9]+(?:\.[0-9]+)?', text) else None
        memory = value.get('MemUsage', '').split('/')
        result['memoryUsedBytes'] = size(memory[0]) if len(memory) == 2 else None
        result['memoryLimitBytes'] = size(memory[1]) if len(memory) == 2 else None
        result['pids'] = int(value['PIDs']) if str(value.get('PIDs', '')).isdigit() else None
    emit('parserStats', result)


def process_rows():
    raw, receipt = command(['docker', 'top', PARSER, '-eo', 'pid=,ppid=,comm=,etime=,pcpu=,pmem='], 32768)
    rows = []
    allowed = {'python', 'python3', 'sh', 'bash', 'uvicorn', 'gunicorn', 'tesseract', 'pdftoppm', 'busybox', 'curl', 'wget', 'timeout'}
    for line in raw.decode('utf-8', 'replace').splitlines():
        match = re.fullmatch(r'\s*([0-9]+)\s+([0-9]+)\s+(.+?)\s+([0-9:-]+)\s+([0-9.]+)\s+([0-9.]+)\s*', line)
        if match and all(math.isfinite(float(match[x])) for x in [5, 6]):
            rows.append({'pid': int(match[1]), 'ppid': int(match[2]), 'command': match[3] if match[3] in allowed else 'other-command',
                         'elapsed': match[4], 'cpuPercent': float(match[5]), 'memoryPercent': float(match[6])})
    for index in range(0, min(len(rows), 60), 15):
        emit('parserProcesses', {'offset': index, 'items': rows[index:index + 15]})
    emit('parserProcessSummary', {'query': receipt, 'matchingRows': len(rows), 'outputLimited': len(rows) > 60, 'argumentsRead': False})


def cgroup_and_status(pid):
    if type(pid) is not int or pid <= 0:
        emit('parserProcMetrics', {'available': False})
        return
    source = read('/proc/' + str(pid) + '/cgroup', 16384)
    candidates = []
    for line in source.splitlines():
        parts = line.split(':', 2)
        if len(parts) != 3 or PARSER not in parts[2]:
            continue
        path = pathlib.PurePosixPath(parts[2])
        if not path.is_absolute() or '..' in path.parts or not re.fullmatch(r'/[A-Za-z0-9_./-]+', str(path)):
            continue
        if parts[0] == '0' and parts[1] == '':
            candidates.append(('v2', pathlib.Path('/sys/fs/cgroup') / str(path).lstrip('/')))
        elif 'memory' in parts[1].split(','):
            candidates.append(('v1', pathlib.Path('/sys/fs/cgroup/memory') / str(path).lstrip('/')))
    if len(candidates) != 1:
        emit('parserProcMetrics', {'available': False, 'cgroupMatchesFixedParser': False})
        return
    version, directory = candidates[0]
    status = {}
    for line in read('/proc/' + str(pid) + '/status', 32768).splitlines():
        match = re.fullmatch(r'(Pid|PPid|Threads|VmRSS|VmHWM|VmSwap):\s+([0-9]+)(?:\s+(kB))?', line)
        if match:
            status[match[1] + ('Bytes' if match[3] else '')] = int(match[2]) * (1024 if match[3] else 1)
    emit('parserProcMetrics', {'available': True, 'cgroupMatchesFixedParser': True, 'numbers': status})
    names = ['memory.current', 'memory.peak', 'memory.max', 'memory.swap.current', 'memory.swap.max'] if version == 'v2' else ['memory.usage_in_bytes', 'memory.max_usage_in_bytes', 'memory.limit_in_bytes', 'memory.memsw.usage_in_bytes', 'memory.memsw.limit_in_bytes', 'memory.failcnt']
    metrics, unavailable = {}, []
    for name in names:
        try:
            value = read(directory / name, 4096).strip()
            metrics[name] = {'value': int(value) if value.isdigit() else None, 'unlimited': value == 'max'}
        except (FileNotFoundError, PermissionError):
            unavailable.append(name)
    events = {}
    try:
        name = 'memory.events' if version == 'v2' else 'memory.oom_control'
        for line in read(directory / name, 4096).splitlines():
            match = re.fullmatch(r'(low|high|max|oom|oom_kill|oom_group_kill|under_oom|oom_kill_disable)\s+([0-9]+)', line)
            if match:
                events[match[1]] = int(match[2])
    except (FileNotFoundError, PermissionError):
        unavailable.append('memory.events' if version == 'v2' else 'memory.oom_control')
    emit('parserCgroupMemory', {'version': version, 'metrics': metrics, 'events': events, 'unavailable': unavailable,
                               'historicalCountersAreLifetimeNotThisRequestOnly': True})


def logs():
    raw, receipt = command(['docker', 'logs', '--timestamps', '--tail', '500', PARSER])
    exception_counts, requests = collections.Counter(), collections.Counter()
    for line in raw.decode('utf-8', 'replace').splitlines():
        for kind in classify(line)['exceptionTypes']:
            exception_counts[kind] += 1
        match = re.search(r'\b(GET|POST)\s+(/health|/v1/mailbox/poll|/mailbox/poll)(?:\?[^ \"\s]*)?\s+HTTP/[0-9.]+\"?\s+([1-5][0-9]{2})\b', line)
        if match:
            path = 'health' if match[2] == '/health' else 'mailbox-poll'
            requests[path + ':' + match[1] + ':' + match[3]] += 1
    emit('parserClassifiedRecentLogs', {'query': receipt, 'tailLimit': 500, 'byteLimit': 262144,
         'exceptionTypeCounts': dict(exception_counts), 'httpStatusCounts': dict(requests), 'markers': classify(raw.decode('utf-8', 'replace')),
         'rawLinesPrinted': False, 'historicalCompletenessProven': False})


def main():
    inspect_service('voyageplex-api')
    before = inspect_service('voyageplex-parser', True)
    if before and before['id'] == PARSER and before.get('running') is True:
        stats()
        process_rows()
        cgroup_and_status(before.get('hostPid'))
        logs()
    after = inspect_service('voyageplex-parser')
    inspect_service('voyageplex-api')
    memory = {}
    for line in read('/proc/meminfo').splitlines():
        match = re.fullmatch(r'(MemTotal|MemAvailable|MemFree|SwapTotal|SwapFree):\s+([0-9]+) kB', line)
        if match:
            memory[match[1] + 'Bytes'] = int(match[2]) * 1024
    emit('memoryNow', memory)
    emit('facts', {'fixedParserIdentity': PARSER, 'parserStateUnchangedDuringRead': before == after,
                  'overallTimeBudgetSeconds': 60, 'businessWritesPerformed': False, 'applicationSignalsSent': False,
                  'ptracePerformed': False, 'httpOrImapTestsPerformed': False, 'rawHealthOutputOrLogsPrinted': False})


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        emit('failure', {'safeError': 'VOYAGEPLEX_PARSER_RESOURCE_FAILED', 'errorType': type(error).__name__ if type(error).__name__ in
                        {'ValueError', 'TypeError', 'KeyError', 'FileNotFoundError', 'PermissionError', 'ProcessLookupError', 'TimeoutExpired'} else 'Other',
                        'businessWritesPerformed': False, 'applicationSignalsSent': False})
        raise SystemExit(1)
