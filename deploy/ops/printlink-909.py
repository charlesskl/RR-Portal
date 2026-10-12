import datetime, hashlib, json, os, pathlib, re, sqlite3, stat, subprocess, sys, tempfile, time

os.umask(0o077)
REPO = pathlib.Path('/opt/rr-portal')
BACKUPS = REPO / 'deploy/backups'
CONTAINER = 'rr-portal-printlink-1'
COMPOSE = ['docker', 'compose', '-f', 'docker-compose.cloud.yml', '--env-file', '.env.cloud.production']
APP = REPO / 'apps/工程部/3D打印协同平台'
SOURCE_FILES = ['start.mjs', 'cloud/server.mjs', 'cloud/integration.mjs', 'production/server.js',
                'production/business-sync.cjs', 'shared/business-sync.cjs',
                'cloud/public/business-sync.html', 'cloud/public/business-sync.js']


def require(condition, code):
    if not condition:
        raise RuntimeError(code)


def command(args, input=None, env=None):
    result = subprocess.run(args, input=input, text=True, capture_output=True, cwd=REPO, env=env)
    require(result.returncode == 0, 'COMMAND_FAILED')
    return result.stdout


def container_run(mode, source, extra=None):
    args = ['docker', 'exec', '-i', '-e', 'PRINTLINK_OPS_MODE=' + mode]
    for key, value in (extra or {}).items():
        args += ['-e', key + '=' + value]
    args += [CONTAINER, 'node', '--input-type=module']
    return json.loads(command(args, source))


def file_hash(file):
    digest = hashlib.sha256()
    with file.open('rb') as data:
        for block in iter(lambda: data.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def latest_backup():
    candidates = sorted(BACKUPS.glob('printlink-pre-909-*'))
    require(bool(candidates), 'NO_PRE909_BACKUP')
    directory = candidates[-1]
    require(directory.is_dir() and not directory.is_symlink(), 'BACKUP_DIRECTORY_INVALID')
    manifest_file = directory / 'sha256-manifest.json'
    require(manifest_file.is_file() and not manifest_file.is_symlink(), 'BACKUP_MANIFEST_MISSING')
    manifest = json.loads(manifest_file.read_text())
    required = {'orders/printlink.sqlite', 'production.sqlite', 'pre909-audit.json'}
    require(isinstance(manifest, dict) and required <= set(manifest), 'BACKUP_REQUIRED_FILES_MISSING')
    for relative, expected in manifest.items():
        part = pathlib.PurePosixPath(relative)
        require(not part.is_absolute() and '..' not in part.parts, 'BACKUP_MANIFEST_PATH_INVALID')
        file = directory / relative
        require(file.is_file() and not file.is_symlink() and file_hash(file) == expected,
                'BACKUP_MANIFEST_MISMATCH')
    for relative in ['orders/printlink.sqlite', 'production.sqlite']:
        with sqlite3.connect((directory / relative).as_uri() + '?mode=ro', uri=True) as db:
            require(db.execute('PRAGMA quick_check').fetchone()[0] == 'ok', 'BACKUP_DATABASE_INVALID')
    audit = json.loads((directory / 'pre909-audit.json').read_text())
    require(all(isinstance(audit.get(key), list) for key in ['orders', 'files', 'users', 'jobs']),
            'BACKUP_AUDIT_INVALID')
    with sqlite3.connect((directory / 'orders/printlink.sqlite').as_uri() + '?mode=ro', uri=True) as db:
        for table in ['orders', 'files', 'users']:
            require([row[0] for row in db.execute('SELECT id FROM ' + table + ' ORDER BY id')] == audit[table],
                    'BACKUP_AUDIT_MISMATCH')
        columns = {row[1] for row in db.execute('PRAGMA table_info(production_jobs)')}
        if columns:
            db.row_factory = sqlite3.Row
            fields = 'id,order_id,created' + (',item_id' if audit['jobs'] and 'item_id' in audit['jobs'][0] else '')
            require([dict(row) for row in db.execute('SELECT ' + fields + ' FROM production_jobs ORDER BY id')] == audit['jobs'],
                    'BACKUP_JOBS_AUDIT_MISMATCH')
        else:
            require(not audit['jobs'], 'BACKUP_JOBS_AUDIT_MISMATCH')
    return directory, audit


def source_hashes():
    return json.dumps({file: file_hash(APP / file) for file in SOURCE_FILES}, separators=(',', ':'))


def other_container_starts():
    ids = command(['docker', 'ps', '-a', '-q', '--filter', 'label=com.docker.compose.project=rr-portal']).split()
    require(bool(ids), 'COMPOSE_CONTAINERS_MISSING')
    rows = command(['docker', 'inspect', '-f', '{{.Id}} {{index .Config.Labels "com.docker.compose.service"}} {{.State.StartedAt}}', *ids])
    return {parts[0]: (parts[1], parts[2]) for line in rows.splitlines()
            if len(parts := line.split()) == 3 and parts[1] != 'printlink'}


def save_and_set_station(directory):
    envfile = REPO / '.env.cloud.production'
    require(envfile.is_file() and not envfile.is_symlink(), 'PRIVATE_ENV_FILE_INVALID')
    info = envfile.stat()
    before = envfile.read_bytes()
    pattern = re.compile(rb'^[ \t]*(?:export[ \t]+)?BUSINESS_SYNC_STATION[ \t]*=')
    lines = before.splitlines(keepends=True)
    matches = []
    quoted = None
    for index, line in enumerate(lines):
        if quoted is None:
            if pattern.match(line):
                matches.append(index)
            opener = re.match(rb'^[ \t]*(?:export[ \t]+)?[A-Za-z_][A-Za-z_0-9]*[ \t]*=[ \t]*([\x27\x22])', line)
            content = line[opener.end():] if opener else b''
            if opener:
                quoted = opener.group(1)[0]
        else:
            content = line
        escaped = False
        if quoted is not None:
            for byte in content:
                if escaped:
                    escaped = False
                elif byte == 92:
                    escaped = True
                elif byte == quoted:
                    quoted = None
                    break
        require(not (pattern.match(line) and quoted is not None and index in matches),
                'STATION_ENV_MULTILINE_UNSUPPORTED')
    require(quoted is None, 'PRIVATE_ENV_QUOTE_INVALID')
    require(len(matches) <= 1, 'DUPLICATE_STATION_ENV_KEYS')
    if matches:
        index = matches[0]
        line = lines[index]
        ending = b'\r\n' if line.endswith(b'\r\n') else b'\n' if line.endswith(b'\n') else b''
        lines[index] = b'BUSINESS_SYNC_STATION=qingxi' + ending
        after = b''.join(lines)
    else:
        newline = b'\r\n' if b'\r\n' in before else b'\n'
        after = before + (newline if before and not before.endswith((b'\n', b'\r')) else b'') + b'BUSINESS_SYNC_STATION=qingxi' + newline
    backup_env = directory / 'env.before'
    if backup_env.exists():
        require(not backup_env.is_symlink() and backup_env.read_bytes() == before, 'ENV_BACKUP_ALREADY_DIFFERENT')
    else:
        with backup_env.open('xb') as data:
            data.write(before)
            data.flush()
            os.fsync(data.fileno())
    backup_env.chmod(0o600)
    manifest_file = directory / 'sha256-manifest.json'
    manifest = json.loads(manifest_file.read_text())
    manifest['env.before'] = file_hash(backup_env)
    descriptor, temporary = tempfile.mkstemp(prefix='.manifest-', dir=directory)
    try:
        with os.fdopen(descriptor, 'w') as output:
            json.dump(manifest, output)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, manifest_file)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
    descriptor, temporary = tempfile.mkstemp(prefix='.env.printlink-', dir=REPO)
    try:
        with os.fdopen(descriptor, 'wb') as output:
            output.write(after)
            output.flush()
            os.fsync(output.fileno())
            os.fchown(output.fileno(), info.st_uid, info.st_gid)
            os.fchmod(output.fileno(), stat.S_IMODE(info.st_mode))
        require(envfile.read_bytes() == before, 'PRIVATE_ENV_CHANGED_DURING_PREFLIGHT')
        os.replace(temporary, envfile)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
    return stat.S_IMODE(info.st_mode)


def enable(source):
    directory, baseline = latest_backup()
    head = command(['git', 'rev-parse', 'HEAD']).strip()
    require(head == command(['git', 'rev-parse', 'origin/main']).strip(), 'SERVER_SOURCE_NOT_CURRENT_MAIN')
    command(['git', 'diff', '--quiet', 'HEAD', '--', 'apps/工程部/3D打印协同平台', 'docker-compose.cloud.yml'])
    expected = os.environ.get('PRINTLINK_EXPECTED_SOURCE_SHA')
    require(not expected or expected == head, 'EXPECTED_SOURCE_COMMIT_MISMATCH')
    hashes = source_hashes()
    inspected = container_run('inspect', source, {'PRINTLINK_OPS_SOURCE_HASHES': hashes})
    stations = inspected['stations']
    require(len(stations) == 1 and stations[0]['id'] == 'qingxi' and '清溪' in stations[0]['factories'],
            'EXACT_QINGXI_STATION_REQUIRED')
    state = inspected['businessSync']
    if state['active'] == 'qingxi':
        require(state['boundStation'] in [None, 'qingxi'], 'BOUND_STATION_MISMATCH')
        result = container_run('enable', source, {'PRINTLINK_OPS_BASELINE': json.dumps(baseline),
                                                'PRINTLINK_OPS_SOURCE_HASHES': hashes})
        return {**result, 'enabledStation': 'qingxi', 'alreadyEnabled': True,
                'backup': str(directory), 'serverSourceCommit': head, 'containerRecreated': False}
    require(state['active'] in [None, 'qingxi'] and not state['activated'] and not state['clientIdExists']
            and not state['lastSuccess'] and not state['conflicts'] and not state['boundStation'],
            'BRIDGE_ALREADY_BOUND_OR_CONFLICTED')
    compose = json.loads(command(COMPOSE + ['config', '--format', 'json']))
    require('BUSINESS_SYNC_STATION' in compose['services']['printlink'].get('environment', {}),
            'COMPOSE_STATION_MAPPING_MISSING')
    projected = json.loads(command(COMPOSE + ['config', '--format', 'json'],
                                   env={**os.environ, 'BUSINESS_SYNC_STATION': 'qingxi'}))
    require(projected['services']['printlink']['environment'].get('BUSINESS_SYNC_STATION') == 'qingxi',
            'COMPOSE_STATION_MAPPING_MISMATCH')
    container_run('status', source, {'PRINTLINK_OPS_BASELINE': json.dumps(baseline),
                                   'PRINTLINK_OPS_SOURCE_HASHES': hashes, 'PRINTLINK_OPS_EXPECT_UNBOUND': '1'})
    siblings = other_container_starts()
    original_mode = save_and_set_station(directory)
    compose = json.loads(command(COMPOSE + ['config', '--format', 'json']))
    require(compose['services']['printlink']['environment'].get('BUSINESS_SYNC_STATION') == 'qingxi',
            'COMPOSE_STATION_MAPPING_MISMATCH')
    require(command(['git', 'rev-parse', 'HEAD']).strip() == head
            and command(['git', 'rev-parse', 'origin/main']).strip() == head,
            'SERVER_SOURCE_CHANGED_DURING_PREFLIGHT')
    flag = REPO / 'deploy/maintenance/services/printlink'
    flag.parent.mkdir(parents=True, exist_ok=True)
    flag.touch()
    switched = time.monotonic()
    command(COMPOSE + ['up', '-d', '--no-deps', '--force-recreate', 'printlink'])
    deadline = time.monotonic() + 180
    while time.monotonic() < deadline:
        health = command(['docker', 'inspect', '-f', '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}', CONTAINER]).strip()
        if health == 'healthy':
            break
        time.sleep(3)
    else:
        raise RuntimeError('PRINTLINK_NOT_HEALTHY')
    result = container_run('enable', source, {'PRINTLINK_OPS_BASELINE': json.dumps(baseline),
                                            'PRINTLINK_OPS_SOURCE_HASHES': hashes})
    require(stat.S_IMODE((REPO / '.env.cloud.production').stat().st_mode) == original_mode,
            'PRIVATE_ENV_PERMISSIONS_CHANGED')
    time.sleep(max(0, 12 - (time.monotonic() - switched)))
    require(other_container_starts() == siblings, 'OTHER_CONTAINER_START_TIME_CHANGED')
    require(command(['git', 'rev-parse', 'HEAD']).strip() == head
            and command(['git', 'rev-parse', 'origin/main']).strip() == head,
            'SERVER_SOURCE_CHANGED_DURING_ENABLE')
    flag.unlink(missing_ok=True)
    return {**result, 'enabledStation': 'qingxi', 'backup': str(directory), 'serverSourceCommit': head,
            'backupManifestSha256': file_hash(directory / 'sha256-manifest.json'),
            'otherContainersUnchanged': True, 'privateEnvPermissionsPreserved': True,
            'containerHealthy': True, 'maintenanceCleared': True}


def main():
    mode, script = sys.argv[1:]
    require(mode in ['backup', 'verify', 'inspect', 'status', 'enable'], 'INVALID_MODE')
    source = pathlib.Path(script).read_text()
    if mode == 'enable':
        result = enable(source)
    else:
        extra = {}
        directory = None
        if mode in ['verify', 'status']:
            directory, baseline = latest_backup()
            extra['PRINTLINK_OPS_BASELINE'] = json.dumps(baseline)
        result = container_run(mode, source, extra)
        if mode == 'backup':
            target = result['target']
            require(target.startswith('/app/runtime/.pre909-'), 'INVALID_BACKUP_PATH')
            BACKUPS.mkdir(parents=True, exist_ok=True)
            dest = BACKUPS / ('printlink-pre-909-' + datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ'))
            dest.mkdir(mode=0o700)
            command(['docker', 'cp', CONTAINER + ':' + target + '/.', str(dest)])
            for file in dest.rglob('*'):
                require(not file.is_symlink(), 'UNEXPECTED_BACKUP_SYMLINK')
                file.chmod(0o700 if file.is_dir() else 0o600)
            checks = {str(file.relative_to(dest)): file_hash(file) for file in dest.rglob('*') if file.is_file()}
            manifest = dest / 'sha256-manifest.json'
            manifest.write_text(json.dumps(checks))
            command(['docker', 'exec', CONTAINER, 'node', '-e', "require('fs').rmSync(process.argv[1],{recursive:true,force:true})", target])
            result.update({'target': str(dest), 'backupFiles': len(checks), 'manifestSha256': file_hash(manifest)})
        elif directory:
            result['backup'] = str(directory)
    print(json.dumps(result, ensure_ascii=False))


try:
    main()
except Exception as error:
    code = str(error) if isinstance(error, RuntimeError) and re.fullmatch(r'[A-Z_]+', str(error)) else type(error).__name__
    print(json.dumps({'failed': True, 'safeError': code}))
    sys.exit(1)
