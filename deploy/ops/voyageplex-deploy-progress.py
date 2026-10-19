"""Unexecuted fixed read-only deployment progress probe. No raw argv/env/logs."""
import hashlib
import json
import os
import pathlib
import re
import select
import subprocess
import time

ROOT = pathlib.Path('/opt/rr-portal')
EXPECTED_HEAD = '53f482f4b71fc0fd4c6696e9ec4b2058e6a342bc'
UPDATE_SCRIPT_SHA256 = '65691c767b5228287ff905d0a273ddd8cf6acdca8aacf7ff023a734f3de4ed21'
DEADLINE = time.monotonic() + 38
TOOLS = {'docker', 'docker-compose', 'buildkitd', 'buildkit-runc', 'buildctl',
         'node', 'npm', 'npm ci', 'npm run build', 'dotnet', 'apt', 'apt-get',
         'apk', 'wget', 'curl', 'git', 'gzip', 'tar', 'pg_dump', 'python',
         'python3', 'python3.11', 'python3.12', 'bash', 'sh'}


def emit(section, value):
    line = json.dumps({'section': section, 'data': value}, ensure_ascii=True,
                      separators=(',', ':'), sort_keys=True, allow_nan=False)
    if len(line.encode()) > 6000:
        raise ValueError()
    print(line, flush=True)


def read(path, cap=4096):
    with path.open('rb') as source:
        value = source.read(cap + 1)
    if len(value) > cap:
        raise ValueError()
    return value


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


def state():
    path = ROOT / 'deploy/.deploy-state'
    value = {'exists': path.is_file(), 'phase': None}
    if value['exists']:
        if path.is_symlink():
            raise ValueError()
        raw = read(path, 128).decode('ascii', 'replace').strip()
        value['phase'] = raw if raw in {'pulling', 'analyze', 'cleanup', 'directories', 'backup', 'deploy'} else 'unknown'
    head = command(['git', '-C', str(ROOT), 'rev-parse', 'HEAD'], seconds=5, cap=128)
    value['headMatchesExpected53f482f'] = bool(head and head.decode('ascii', 'replace').strip() == EXPECTED_HEAD)
    emit('deployment', value)


def containers():
    template = ('{"id":{{json .Id}},"image":{{json .Image}},"status":{{json .State.Status}},'
                '"running":{{json .State.Running}},"restartCount":{{.RestartCount}},'
                '"oomKilled":{{json .State.OOMKilled}},'
                '"health":{{if .State.Health}}{{json .State.Health.Status}}{{else}}"none"{{end}}}')
    for service in ['voyageplex-web', 'voyageplex-api', 'voyageplex-parser']:
        raw = command(['docker', 'inspect', '--format', template, 'rr-portal-' + service + '-1'])
        result = {'service': service, 'available': False}
        if raw is not None:
            data = json.loads(raw)
            if (re.fullmatch('[a-f0-9]{64}', str(data.get('id', ''))) and
                    re.fullmatch('sha256:[a-f0-9]{64}', str(data.get('image', ''))) and
                    data.get('status') in {'created', 'running', 'paused', 'restarting', 'removing', 'exited', 'dead'} and
                    data.get('health') in {'none', 'starting', 'healthy', 'unhealthy'} and
                    type(data.get('restartCount')) is int and type(data.get('running')) is bool and
                    type(data.get('oomKilled')) is bool):
                result.update(data)
                result['available'] = True
        emit('container', result)


def process_stat(pid, uptime, ticks):
    path = pathlib.Path('/proc') / str(pid)
    comm = read(path / 'comm', 64).decode('utf-8', 'replace').strip()
    fields = read(path / 'stat').rsplit(b')', 1)[1].split()
    ppid = int(fields[1])
    elapsed = max(0., uptime - int(fields[19]) / ticks)
    cpu = (int(fields[11]) + int(fields[12])) / ticks
    return {'pid': pid, 'ppid': ppid, 'comm': comm, 'elapsedSeconds': round(elapsed, 1),
            'cpuLifetimePercent': round(cpu / elapsed * 100, 2) if elapsed > 0 else 0.}


def argv(pid):
    # Private classification only. These strings are never returned or printed.
    return [part.decode('utf-8', 'strict') for part in read(pathlib.Path('/proc') / str(pid) / 'cmdline', 4096).split(b'\0') if part]


def parent_is_update_server(pid, uptime, ticks):
    visited = set()
    while pid > 1 and pid not in visited and len(visited) < 24 and time.monotonic() < DEADLINE:
        visited.add(pid)
        try:
            item = process_stat(pid, uptime, ticks)
            if item['comm'] in {'bash', 'sh'}:
                for value in argv(pid)[1:6]:
                    # workflow writes the exact reviewed script to GNU mktemp's
                    # random /tmp/tmp.* path; identify it by bytes, not its name.
                    if value == str(ROOT / 'deploy/update-server.sh') or re.fullmatch(r'/tmp/tmp\.[A-Za-z0-9]{6,32}', value):
                        path = pathlib.Path(value)
                        if not path.is_symlink() and hashlib.sha256(read(path, 131072)).hexdigest() == UPDATE_SCRIPT_SHA256:
                            return True
            pid = item['ppid']
        except (OSError, ValueError, IndexError, UnicodeError):
            return False
    return False


def sqlite_source(pid):
    parts = argv(pid)
    if len(parts) != 4 or pathlib.PurePosixPath(parts[0]).name not in {'python3', 'python', 'python3.11', 'python3.12'} or parts[1] != '-':
        return None
    source = pathlib.PurePosixPath(parts[2])
    destination = pathlib.PurePosixPath(parts[3])
    if not source.is_absolute():
        if pathlib.Path(os.readlink(pathlib.Path('/proc') / str(pid) / 'cwd')) != ROOT:
            return None
        source = pathlib.PurePosixPath(ROOT) / source
    if (source.suffix != '.db' or '..' in source.parts or
            not source.is_relative_to(pathlib.PurePosixPath(ROOT / 'apps')) or
            destination.parent != pathlib.PurePosixPath(ROOT / 'deploy/backups')):
        return None
    value = source.relative_to(ROOT).as_posix()
    if len(value) > 512 or any(ord(char) < 32 or ord(char) == 127 for char in value):
        return None
    return value


def processes():
    uptime = float(read(pathlib.Path('/proc/uptime'), 128).split()[0])
    ticks = os.sysconf('SC_CLK_TCK')
    tools, backups, examined = [], [], 0
    for path in pathlib.Path('/proc').iterdir():
        if not path.name.isdigit() or time.monotonic() >= DEADLINE:
            continue
        examined += 1
        if examined > 4096:
            break
        try:
            item = process_stat(int(path.name), uptime, ticks)
            if item['comm'] not in TOOLS:
                continue
            tools.append(item)
            if item['comm'] in {'python', 'python3', 'python3.11', 'python3.12'}:
                source = sqlite_source(item['pid'])
                if source is not None:
                    backups.append({**item, 'classification': 'sqlite-online-backup-command-shape',
                                    'sourceRelativeAppDatabase': source,
                                    'parentChainIsReviewedUpdateServer': parent_is_update_server(item['ppid'], uptime, ticks)})
        except (OSError, ValueError, IndexError, UnicodeError):
            continue
    for offset in range(0, min(len(tools), 100), 20):
        emit('buildToolProcesses', {'items': tools[offset:offset + 20], 'cpuIsLifetimeAverage': True})
    for item in backups[:20]:
        emit('sqliteBackupCandidate', item)
    emit('processSummary', {'examined': examined, 'whitelistedToolCount': len(tools),
                            'toolOutputLimitedTo': 100, 'sqliteBackupCandidates': len(backups),
                            'sqliteCandidateOutputLimitedTo': 20, 'rawArgumentsOrEnvironmentPrinted': False})


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


if __name__ == '__main__':
    try:
        state()
        containers()
        processes()
        resources()
        emit('scope', {'readOnly': True, 'rawLogsOrEnvironmentRead': False,
                        'commandsPrivatelyClassifiedOnlyForFixedBackupAndReviewedParentScript': True,
                        'elapsedSeconds': round(time.monotonic() - (DEADLINE - 38), 2)})
    except Exception:
        emit('failure', {'readOnly': True, 'reason': 'REDACTED_DIAGNOSTIC_FAILURE'})
        raise SystemExit(1)
