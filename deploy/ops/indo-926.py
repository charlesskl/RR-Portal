"""PR926 private backup and read-only verification; no business writes."""
import base64
import datetime
import decimal
import hashlib
import hmac
import ipaddress
import json
import os
import pathlib
import re
import select
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = pathlib.Path('/opt/rr-portal')
BACKUPS = ROOT / 'deploy/backups'
COMPOSE = ['docker', 'compose', '-f', 'docker-compose.cloud.yml', '--env-file', '.env.cloud.production']
PG_SHELL = 'exec psql -X -q -At -v ON_ERROR_STOP=1 -U "${POSTGRES_USER:-rrportal}" -d "${POSTGRES_DB:-rrportal}"'
SETTINGS = ['schedule_placed_manual', 'schedule_production_placed_manual',
            'material_tracking_completed_schedules', 'material_tracking_order_adjustments']
REQUIRED_TABLES = {'Users', 'settings', 'schedules', 'material_tracking_history', 'audit_logs',
                   'purchase_orders', 'po_items', 'po_receipts', 'outbound', 'shipments', 'shipment_items',
                   'customers', 'products', 'images', 'materials', 'dict_hs', 'dict_supplier',
                   'tool_materials', 'dict_translation', '__rr_seed_history', 'material_lead_profiles'}
TABLE_SQL = "SELECT COALESCE(json_agg(table_name ORDER BY table_name),'[]') FROM information_schema.tables WHERE table_schema='indo_shipping' AND table_type='BASE TABLE';\n"
CORE_SERVICES = ['nginx', 'core', 'db', 'redis', 'printlink']
INITIAL_COMMIT = '77e10142ecfd07c6aba732ae3a2cc449fcdc9e6c'
APP_PATH = 'apps/印尼小组/印尼走货明细/'
PHASE = BEFORE_COMMIT = TARGET_COMMIT = BACKUP_PATH = None
FAILED_CHECK = 'entrypoint'


def checkpoint(label):
    global FAILED_CHECK
    FAILED_CHECK = label


def require(condition, label=None):
    if not condition:
        if label:
            checkpoint(label)
        raise RuntimeError('INDO_926_OPS_FAILED')


def run(args, data=None):
    result = subprocess.run(args, input=data, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                            cwd=ROOT, timeout=180)
    require(result.returncode == 0)
    return result.stdout


def cid(service):
    value = run(COMPOSE + ['ps', '-q', service]).decode().strip()
    require(bool(re.fullmatch(r'[a-f0-9]{12,64}', value)))
    return value


def sql_command():
    # Credentials are expanded only inside the DB container, never in host argv or output.
    return ['docker', 'exec', '-i', cid('db'), 'sh', '-c', PG_SHELL]


def table_names(value):
    require(isinstance(value, list) and len(value) == len(set(value)))
    require(all(isinstance(name, str) and re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]{0,62}', name) for name in value))
    require(REQUIRED_TABLES <= set(value))
    return sorted(value)


def audit_sql(tables):
    parts = []
    for table in table_names(tables):
        row = "to_jsonb(r)"
        digest = "encode(sha256(convert_to(COALESCE(string_agg(row_hash,'' ORDER BY row_hash),''),'UTF8')),'hex')"
        parts += ["'" + table + "'", "(SELECT jsonb_build_object('rows',COUNT(*),'sha256'," + digest + ") FROM (SELECT encode(sha256(convert_to((" + row + ")::text,'UTF8')),'hex') AS row_hash FROM indo_shipping.\"" + table + "\" r) hashes)"]
    keys = ','.join("'" + key + "'" for key in SETTINGS)
    return """SELECT jsonb_build_object('tables',jsonb_build_object(%s),
      'priceColumn',(SELECT jsonb_build_object('type',data_type,'precision',numeric_precision,'scale',numeric_scale)
        FROM information_schema.columns WHERE table_schema='indo_shipping' AND table_name='po_items' AND column_name='price'),
      'rawRowsType',(SELECT data_type FROM information_schema.columns
        WHERE table_schema='indo_shipping' AND table_name='schedules' AND column_name='raw_rows'),
      'stateSettings',(SELECT COALESCE(jsonb_object_agg(key,jsonb_build_object('sha256',encode(sha256(convert_to(value,'UTF8')),'hex'))),'{}')
        FROM indo_shipping.settings WHERE key IN (%s)),
      'trackingSchema',(SELECT COUNT(*)=8 FROM information_schema.columns
        WHERE table_schema='indo_shipping' AND table_name='material_tracking_history'
          AND column_name IN ('id','schedule_id','raw_rows','rows_hash','materials','products','acknowledged','captured_at')),
      'schemaSha256',(SELECT encode(sha256(convert_to(COALESCE(jsonb_agg(to_jsonb(c) ORDER BY table_name,ordinal_position)::text,'[]'),'UTF8')),'hex')
        FROM (SELECT table_name,column_name,ordinal_position,data_type,udt_name,is_nullable,column_default,
                     character_maximum_length,numeric_precision,numeric_scale
              FROM information_schema.columns WHERE table_schema='indo_shipping') c));
    """ % (','.join(parts), keys)


def audit():
    checkpoint('readOnlySchemaAudit')
    command = sql_command()
    # Discover and digest in the same read-only repeatable-read transaction.
    process = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                               stderr=subprocess.PIPE, cwd=ROOT, bufsize=0)
    try:
        process.stdin.write(('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;\n' + TABLE_SQL).encode())
        process.stdin.flush()
        tables = table_names(json.loads(read_line(process)))
        process.stdin.write(audit_sql(tables).encode()); process.stdin.flush()
        result = json.loads(read_line(process))
        finish_snapshot(process)
        return result
    finally:
        close_snapshot(process)


def file_hash(file):
    value = hashlib.sha256()
    with file.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            value.update(block)
    return value.hexdigest()


def source_commit(ref='HEAD'):
    require(ref in ['HEAD', 'origin/main'])
    value = run(['git', 'rev-parse', ref]).decode().strip()
    require(bool(re.fullmatch(r'[a-f0-9]{40}', value)))
    return value


def read_line(process):
    require(bool(select.select([process.stdout], [], [], 60)[0]))
    value = process.stdout.readline()
    require(bool(value))
    return value.strip()


def finish_snapshot(process):
    process.stdin.write(b'COMMIT;\n'); process.stdin.flush(); process.stdin.close()
    require(process.wait(timeout=15) == 0)


def close_snapshot(process):
    if process.poll() is None:
        try:
            process.stdin.write(b'ROLLBACK;\n'); process.stdin.flush(); process.stdin.close()
            process.wait(timeout=5)
        except Exception:
            process.kill(); process.wait(timeout=5)
    for stream in [process.stdout, process.stderr]:
        if stream:
            stream.close()


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, response, code, message, headers, new_url):
        return None


HTTP = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())


def get(url, token=None):
    # Every caller uses fixed local URLs; never follow redirects carrying a probe token.
    headers = {'Authorization': 'Bearer ' + token} if token else {}
    try:
        with HTTP.open(urllib.request.Request(url, headers=headers), timeout=30) as response:
            return response.status, response.read()
    except urllib.error.HTTPError as error:
        return error.code, b''


def get_json(base, path, token):
    require(path.startswith('/api/') and not path.startswith('//'))
    status, body = get(base + path, token)
    require(status == 200)
    return json.loads(body, parse_float=decimal.Decimal)


def app_context():
    app = cid('indo-shipping')
    networks = json.loads(run(['docker', 'inspect', '-f', '{{json .NetworkSettings.Networks}}', app]))
    ip = next((entry.get('IPAddress') for entry in networks.values() if entry.get('IPAddress')), None)
    require(bool(ip) and ipaddress.ip_address(ip).is_private)
    return app, 'http://' + ip + ':5180'


def read_token(app, identity):
    checkpoint('readOnlyProbeToken')
    require(isinstance(identity.get('id'), int) and identity['id'] > 0)
    require(all(re.fullmatch(r'[01]{9}', identity.get(key, '')) for key in ['access', 'edit']))
    # Capture privately, select the existing signing key, and discard the environment.
    values = run(['docker', 'inspect', '-f', '{{json .Config.Env}}', app])
    env = dict(item.split('=', 1) for item in json.loads(values) if '=' in item)
    key = base64.b64decode(env['INDO_SHIPPING_JWT_KEY_B64'], validate=True)
    require(len(key.decode('utf-8')) >= 32)
    del env, values
    encode = lambda data: base64.urlsafe_b64encode(data).decode().rstrip('=')
    header = encode(b'{"alg":"HS256","typ":"JWT"}')
    claims = {'iss': 'IndoShipping', 'aud': 'IndoShipping', 'sub': str(identity['id']),
              'userbqrpower': identity['access'], 'usereditpower': identity['edit'],
              'exp': int(time.time()) + 60}
    body = encode(json.dumps(claims, separators=(',', ':')).encode())
    unsigned = header + '.' + body
    token = unsigned + '.' + encode(hmac.new(key, unsigned.encode(), hashlib.sha256).digest())
    del key
    return token


def role_identities():
    checkpoint('existingRoleSelection')
    rows = json.loads(run(sql_command(), b'''BEGIN READ ONLY;
        SELECT COALESCE(json_agg(row_to_json(u)),'[]') FROM (
          SELECT "Id" AS id,"Userbqrpower" AS access,"Usereditpower" AS edit
          FROM indo_shipping."Users" WHERE "IsActive" ORDER BY "Id") u;
        COMMIT;'''))
    admin = next((row for row in rows if row['access'] == row['edit'] == '111111111'), None)
    ordinary = next((row for row in rows if row['access'] != '111111111'), None)
    require(admin is not None and ordinary is not None, 'existingAdminAndOrdinaryRequired')
    return {'admin': admin, 'ordinary': ordinary}


def role_audit(app, base, identities):
    checkpoint('existingRoleReadOnlyPermissions')
    result = {}
    modules = ['/api/products', '/api/materials?code=__rr_ops_probe__', '/api/customers', '/api/schedules',
               '/api/purchase', '/api/quotes/blob', '/api/molding-pos/blob', '/api/outbound', '/api/shipments']
    for role, identity in identities.items():
        token = read_token(app, identity)
        me = get_json(base, '/api/users/me', token)
        require(me.get('id') == identity['id'] and me.get('userbqrpower') == identity['access']
                and me.get('usereditpower') == identity['edit'], 'roleIdentityMatchesDatabase')
        status, body = get(base + '/api/users', token)
        require(status == (200 if role == 'admin' else 403), 'administratorAccountBoundary')
        entry = {'identitySha256': digest_rows([me]), 'usersStatus': status}
        if role == 'ordinary':
            blocked = next(index for index, bit in enumerate(identity['access']) if bit == '0')
            status, _ = get(base + modules[blocked], token)
            require(status == 403, 'ordinaryDeniedModuleBoundary')
            entry['deniedModule'] = modules[blocked]
            allowed = next((index for index, bit in enumerate(identity['access']) if bit == '1'), None)
            if allowed is not None:
                status, _ = get(base + modules[allowed], token)
                require(status == 200, 'ordinaryAllowedModuleBoundary')
                entry['allowedModule'] = modules[allowed]
        else:
            users = json.loads(body, parse_float=decimal.Decimal)
            entry['usersSha256'] = digest_rows([users])
        result[role] = entry
        del token
    return result


def startup_guard(app, tables, backup_directory=None):
    # These PRs change only frontend code. Refuse known pending startup backfills
    # or account replacement before deploying; do not run or suppress migrations.
    checkpoint('startupBusinessWriteGuard')
    disabled = '$2a$11$m559Cb68j1R4cHfTHJ5tV.z3oeYQyjPGL/mIlkhdltC70AnKNsLyi'
    legacy = '''NOT EXISTS (
        SELECT 1 FROM indo_shipping.users old LEFT JOIN indo_shipping."Users" current
          ON current."Username"=old.username
        WHERE current."Id" IS NULL OR current."PasswordHash"='%s')''' % disabled if 'users' in tables else 'TRUE'
    query = '''BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
      SELECT jsonb_build_object(
        'adminAlreadyConfigured',EXISTS (SELECT 1 FROM indo_shipping."Users"
          WHERE "Username"='admin' AND "PasswordHash"<>'%s'),
        'legacyAccountsAlreadyMigrated',%s,
        'oneTimeMigrationsApplied',(SELECT COUNT(*)=3 FROM indo_shipping.settings
          WHERE key IN ('data_migration:2026-08-13-replace-hs-dictionary-v1',
                        'data_migration:2026-08-15-backfill-translations-v1',
                        'data_migration:2026-09-05-backfill-supplier-dictionary-v1') AND value='applied'),
        'toolMigrationApplied',EXISTS (SELECT 1 FROM pg_constraint
          WHERE conrelid='indo_shipping.tool_materials'::regclass AND conname='tool_materials_kind_v2_check'),
        'supplierProfilesAlreadyFilled',NOT EXISTS (SELECT 1 FROM indo_shipping.dict_supplier
          WHERE trim(COALESCE(customs_company,''))='' AND
            COALESCE(NULLIF(trim(full_name),''),trim(keyword))<>''),
        'scheduleHistoryAlreadyCaptured',NOT EXISTS (
          SELECT 1 FROM indo_shipping.schedules s
          LEFT JOIN LATERAL (SELECT rows_hash,acknowledged FROM indo_shipping.material_tracking_history
                            WHERE schedule_id=s.id ORDER BY id DESC LIMIT 1) h ON TRUE
          WHERE h.rows_hash IS NULL OR h.rows_hash<>md5(COALESCE(s.raw_rows::text,'[]'))
            OR (NOT h.acknowledged AND EXISTS (SELECT 1 FROM indo_shipping.settings completed
                WHERE completed.key='material_tracking_completed_schedules'
                  AND completed.value::jsonb ->> s.id::text=h.rows_hash))));
      COMMIT;''' % (disabled, legacy)
    checks = json.loads(run(sql_command(), query.encode()))
    require(isinstance(checks, dict) and all(isinstance(value, bool) for value in checks.values()))
    if not all(checks.values()):
        print(json.dumps({'startupGuards': checks, 'backup': str(backup_directory), 'usableManifest': False}))
        require(False, 'startupWouldNotChangeBusinessOrAccounts')
    # Snapshot import is skipped when absent, as in the current Docker image.
    values = json.loads(run(['docker', 'inspect', '-f', '{{json .Config.Env}}', app]))
    env = dict(item.split('=', 1) for item in values if '=' in item)
    seed_path = env.get('SEED_FILE', '/app/seed/business-data.json')
    del values, env
    require(bool(re.fullmatch(r'/[A-Za-z0-9_./-]{1,250}', seed_path)) and '..' not in seed_path)
    exists = run(['docker', 'exec', app, 'sh', '-c', 'if [ -f "$1" ]; then wc -c < "$1"; else echo absent; fi', 'seed', seed_path]).decode().strip()
    if exists != 'absent':
        require(exists.isdigit() and 0 < int(exists) <= 32 * 1024 * 1024)
        payload = json.loads(run(['docker', 'exec', app, 'cat', seed_path]))
        version = payload.get('schemaVersion')
        del payload
        require(isinstance(version, str) and re.fullmatch(r'[A-Za-z0-9._:-]{1,128}', version))
        require('__rr_seed_history' in tables, 'existingSeedMarkerRequired')
        marker = run(sql_command(), ("BEGIN READ ONLY; SELECT EXISTS (SELECT 1 FROM indo_shipping.\"__rr_seed_history\" WHERE version='" + version + "'); COMMIT;").encode()).decode().strip()
        if marker != 't':
            print(json.dumps({'startupGuards': {'seedAlreadyImported': False},
                              'backup': str(backup_directory), 'usableManifest': False}))
            require(False, 'existingSeedMarkerRequired')
    return True


def checkout_source_proof(commit, deployed=False):
    checkpoint('checkoutSourceVersionProof')
    require(source_commit() == source_commit('origin/main') == commit, 'exactTargetMatchesMain')
    run(['git', 'diff', '--quiet', 'HEAD', '--', APP_PATH])
    if deployed:
        changed = [path for path in run(['git', 'diff', '--name-only', '-z', BEFORE_COMMIT, commit]).decode().split('\0') if path]
        require(changed and all(path.startswith((APP_PATH + 'web/', 'apps/业务部/内部报价系统/')) for path in changed)
                and any(path.startswith(APP_PATH + 'web/') for path in changed),
                'deploymentDiffOnlyTwoRequestedApplications')
        run(['git', 'merge-base', '--is-ancestor', BEFORE_COMMIT, commit])
    files = [path for path in run(['git', 'ls-tree', '-r', '-z', '--name-only', commit, '--', APP_PATH]).decode().split('\0') if path]
    require(files and all(path.startswith(APP_PATH) for path in files))
    return hashlib.sha256(run(['git', 'ls-tree', '-r', commit, '--', APP_PATH])).hexdigest()


def runtime_config(app):
    checkpoint('runtimeConfiguration')
    template = ('{"env":{{json .Config.Env}},"image":{{json .Image}},'
                '"health":{{if .State.Health}}{{json .State.Health.Status}}{{else}}"none"{{end}}}')
    value = json.loads(run(['docker', 'inspect', '-f', template, app]))
    require(isinstance(value.get('env'), list) and all(isinstance(item, str) for item in value['env']))
    require(bool(re.fullmatch(r'sha256:[a-f0-9]{64}', value.get('image', ''))))
    require(value.get('health') == 'healthy', 'runtimeContainerHealthy')
    digest = hashlib.sha256(json.dumps(sorted(value['env']), ensure_ascii=True,
                                     separators=(',', ':')).encode()).hexdigest()
    # Only the canonical digest is retained; the complete environment never reaches output/files.
    return {'configEnvSha256': digest, 'imageId': value['image'], 'healthy': True}


def core_containers():
    checkpoint('coreContainerMetadata')
    result = {}
    for service in CORE_SERVICES:
        identifier = cid(service)
        started = run(['docker', 'inspect', '-f', '{{.State.StartedAt}}', identifier]).decode().strip()
        require(bool(re.fullmatch(r'\d{4}-\d{2}-\d{2}T[0-9:.]+Z', started)))
        result[service] = {'containerId': identifier, 'startedAt': started}
    return result


def private_env_file():
    checkpoint('privateEnvironmentFile')
    file = ROOT / '.env.cloud.production'
    require(file.is_file() and not file.is_symlink())
    return file


def canonical(value):
    if value is None:
        return ['null']
    if isinstance(value, bool):
        return ['boolean', value]
    if isinstance(value, (int, decimal.Decimal)):
        number = decimal.Decimal(value)
        require(number.is_finite(), 'canonicalFiniteNumber')
        if not number:
            return ['number', '0']
        # Decimal.normalize() obeys the ambient context and can round numbers
        # beyond 28 digits. Strip scale zeroes on the exact tuple instead.
        sign, digits, exponent = number.as_tuple()
        digits = list(digits)
        while digits[-1] == 0:
            digits.pop()
            exponent += 1
        return ['number', sign, ''.join(map(str, digits)), exponent]
    if isinstance(value, str):
        return ['string', value]
    if isinstance(value, list):
        return ['array', [canonical(item) for item in value]]
    if isinstance(value, dict):
        require(all(isinstance(key, str) for key in value))
        return ['object', [[key, canonical(value[key])] for key in sorted(value)]]
    require(False)


def digest_rows(rows):
    # Duplicate rows remain present: this is a sorted multiset, not a set digest.
    hashes = sorted(hashlib.sha256(json.dumps(canonical(row), sort_keys=True, ensure_ascii=True,
                                           separators=(',', ':')).encode()).hexdigest() for row in rows)
    return hashlib.sha256(''.join(hashes).encode()).hexdigest()


def api_audit(base, token, verify=False):
    alerts = get_json(base, '/api/material-alerts', token)
    schedules = get_json(base, '/api/schedules', token)
    placed = get_json(base, '/api/schedules/placed-manual', token)
    production_placed = get_json(base, '/api/schedules/production-placed-manual', token)
    items = alerts['items']
    details = [detail for item in items for detail in item['order_details']]
    item_fields = ['key', 'status', 'workflow_status', 'manual_completed', 'required_qty',
                   'ordered_qty', 'received_qty', 'outbound_qty', 'shortage_qty']
    detail_fields = ['key', 'status', 'required_qty', 'ordered_qty', 'received_qty', 'outbound_qty', 'manual_qty']
    result = {'trackedItems': len(items), 'completedItems': sum(item['manual_completed'] for item in items),
              'orderDetails': len(details), 'schedules': len(schedules), 'placedKeys': len(placed),
              'itemDigest': digest_rows([{key: item.get(key) for key in item_fields} for item in items]),
              'detailDigest': digest_rows([{key: detail.get(key) for key in detail_fields} for detail in details]),
              'scheduleDigest': digest_rows(schedules), 'placedDigest': digest_rows(placed),
              'productionPlacedDigest': digest_rows([production_placed])}
    if verify:
        require(items and details)
        require(all(all(key in item for key in ['source_required_qty', 'source_ordered_qty',
                                               'source_received_qty', 'source_outbound_qty', 'has_adjustments']) for item in items))
        require(all(all(key in detail for key in ['source_required_qty', 'source_ordered_qty',
                                                 'source_received_qty', 'source_outbound_qty',
                                                 'source_manual_qty', 'ordered_qty', 'adjustment_version']) for detail in details))
        order_key = next((detail['key'] for detail in details if detail.get('order_no')), None)
        require(isinstance(order_key, str) and 0 < len(order_key) <= 4000)
        history = get_json(base, '/api/material-alerts/adjustment-history?' +
                           urllib.parse.urlencode({'order_key': order_key, 'page': 1}), token)
        require(isinstance(history.get('total'), int) and isinstance(history.get('items'), list))
    return result


def backup():
    checkpoint('backupDirectory')
    os.umask(0o077)
    before_commit = source_commit()
    require(before_commit == source_commit('origin/main') == BEFORE_COMMIT == TARGET_COMMIT,
            'backupSourceMatchesPreDeployMain')
    checkout_source_proof(before_commit)
    BACKUPS.mkdir(parents=True, exist_ok=True)
    require(not BACKUPS.is_symlink())
    directory = BACKUPS / ('indo-pre-' + PHASE + '-' + datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ'))
    directory.mkdir(mode=0o700)
    app, base = app_context()
    runtime = runtime_config(app)
    scope = core_containers()
    lifecycle = diagnostic_core_state()
    checkpoint('privateEnvironmentBackup')
    environment_backup = directory / 'env.before'
    with private_env_file().open('rb') as source, environment_backup.open('xb') as target:
        for block in iter(lambda: source.read(1024 * 1024), b''):
            target.write(block)
    environment_backup.chmod(0o600)
    dump = directory / 'indo_shipping.dump'
    checkpoint('exportedDatabaseSnapshot')
    command = sql_command()
    process = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                               stderr=subprocess.PIPE, cwd=ROOT, bufsize=0)
    try:
        process.stdin.write(b'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;\nSELECT pg_export_snapshot();\n')
        process.stdin.flush()
        snapshot = read_line(process).decode()
        require(bool(re.fullmatch(r'[0-9A-Fa-f]+-[0-9A-Fa-f]+-[0-9]+', snapshot)))
        process.stdin.write(TABLE_SQL.encode()); process.stdin.flush()
        tables = table_names(json.loads(read_line(process)))
        process.stdin.write(audit_sql(tables).encode()); process.stdin.flush()
        baseline = json.loads(read_line(process))
        checkpoint('privateSchemaDump')
        args = ['docker', 'exec', cid('db'), 'sh', '-c',
                'exec pg_dump -Fc --schema=indo_shipping --snapshot="$1" -U "${POSTGRES_USER:-rrportal}" -d "${POSTGRES_DB:-rrportal}"',
                'pg_dump', snapshot]
        with dump.open('xb') as output:
            dumped = subprocess.run(args, stdout=output, stderr=subprocess.PIPE, cwd=ROOT, timeout=180)
        require(dumped.returncode == 0 and dump.stat().st_size > 0)
        checkpoint('privateArchiveValidation')
        with dump.open('rb') as stream:
            checked = subprocess.run(['docker', 'exec', '-i', cid('db'), 'pg_restore', '--list'],
                                     stdin=stream, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
                                     cwd=ROOT, timeout=180)
        require(checked.returncode == 0)
        finish_snapshot(process)
    finally:
        close_snapshot(process)
    startup_guard(app, tables, directory)
    identities = role_identities()
    token = read_token(app, identities['admin'])
    checkpoint('authenticatedReadBaseline')
    baseline['api'] = api_audit(base, token)
    del token
    roles = role_audit(app, base, identities)
    # Refuse a baseline whose business rows changed between the exported snapshot
    # and API capture. Leave the private dump for recovery but no usable manifest.
    require(audit() == {key: value for key, value in baseline.items() if key != 'api'}, 'baselineDatabaseStable')
    require(runtime_config(app) == runtime, 'baselineRuntimeStable')
    require(core_containers() == scope and diagnostic_core_state() == lifecycle, 'baselineCoreScopeStable')
    require(file_hash(private_env_file()) == file_hash(environment_backup), 'baselineEnvironmentStable')
    require(source_commit() == source_commit('origin/main') == before_commit,
            'baselineSourceStable')
    baseline.update({'schema': 'indo_shipping', 'sourceCommit': before_commit,
                     'consistentExportedSnapshot': True, 'digestMethod': 'sha256-sorted-full-row-multiset',
                     'deploymentLabel': 'PR' + PHASE, 'runtime': runtime, 'coreContainers': scope, 'coreLifecycle': lifecycle,
                     'roles': roles, 'roleIdentities': identities, 'startupBusinessWritesGuardPassed': True,
                     'sourceTreeSha256': checkout_source_proof(before_commit)})
    checkpoint('privateBackupManifest')
    baseline_file = directory / 'baseline.json'
    baseline_file.write_text(json.dumps(baseline, ensure_ascii=True))
    dump.chmod(0o600); baseline_file.chmod(0o600)
    manifest = {'indo_shipping.dump': file_hash(dump), 'baseline.json': file_hash(baseline_file),
                'env.before': file_hash(environment_backup)}
    manifest_file = directory / 'manifest.json'
    manifest_file.write_text(json.dumps(manifest)); manifest_file.chmod(0o600)
    return {'backup': str(directory), 'consistentSnapshot': True, 'dumpBytes': dump.stat().st_size,
            'tableCounts': {table: value['rows'] for table, value in baseline['tables'].items()},
            'sourceCommit': baseline['sourceCommit'], 'privateEnvironmentBackedUp': True,
            'runtimeConfigurationBaselined': True, 'coreContainerScopeBaselined': True, 'coreLifecycle': lifecycle,
            'privateArchiveVerified': True, 'startupBusinessWritesGuardPassed': True,
            'existingAdminAndOrdinaryReadOnlyBoundaryVerified': True,
            'phase': PHASE, 'businessWritesPerformed': False, 'credentialsChanged': False}


def selected_backup():
    checkpoint('privateBackupManifest')
    directory = pathlib.Path(BACKUP_PATH)
    require(BACKUPS.is_dir() and not BACKUPS.is_symlink())
    require(directory.parent == BACKUPS and re.fullmatch('indo-pre-' + PHASE + r'-[0-9]{8}T[0-9]{12}Z', directory.name))
    require(directory.is_dir() and not directory.is_symlink() and directory.stat().st_mode & 0o077 == 0)
    manifest_file = directory / 'manifest.json'
    require(manifest_file.is_file() and not manifest_file.is_symlink() and manifest_file.stat().st_mode & 0o077 == 0)
    manifest = json.loads(manifest_file.read_text())
    require(set(manifest) == {'indo_shipping.dump', 'baseline.json', 'env.before'})
    for filename, expected in manifest.items():
        file = directory / filename
        require(file.is_file() and not file.is_symlink() and file.stat().st_mode & 0o077 == 0
                and file_hash(file) == expected)
    baseline = json.loads((directory / 'baseline.json').read_text())
    require(baseline.get('schema') == 'indo_shipping' and baseline.get('consistentExportedSnapshot') is True)
    require(baseline.get('deploymentLabel') == 'PR' + PHASE and isinstance(baseline.get('runtime'), dict)
            and set(baseline.get('coreContainers', {})) == set(CORE_SERVICES)
            and set(baseline.get('coreLifecycle', {})) == set(CORE_SERVICES))
    require(baseline.get('sourceCommit') == BEFORE_COMMIT and baseline.get('startupBusinessWritesGuardPassed') is True,
            'backupExactPhaseAndSourceMatch')
    table_names(list(baseline['tables']))
    require(baseline.get('digestMethod') == 'sha256-sorted-full-row-multiset')
    return directory, baseline


def price_preserved(before, after):
    if not isinstance(before, dict) or not isinstance(after, dict):
        return False
    bp, bs, ap, ass = (before.get('precision'), before.get('scale'), after.get('precision'), after.get('scale'))
    return (before.get('type') == after.get('type') == 'numeric'
            and all(isinstance(value, int) for value in [bp, bs, ap, ass])
            and ass >= max(8, bs) and ap - ass >= max(14, bp - bs))


def frontend_audit(app):
    checkpoint('servedFrontendAssets')
    index = run(['docker', 'exec', app, 'cat', '/app/wwwroot/index.html'])
    status, served = get('http://127.0.0.1/indo-shipping/')
    require(status == 200 and served == index)
    urls = set(re.findall(r'(?:src|href)="(/indo-shipping/assets/[A-Za-z0-9_.-]+\.(?:js|css))"', index.decode()))
    texts = {}
    files = run(['docker', 'exec', app, 'find', '/app/wwwroot/assets', '-maxdepth', '1',
                 '-type', 'f']).decode().splitlines()
    for file in files:
        if file.endswith(('.js', '.css')):
            require(re.fullmatch(r'/app/wwwroot/assets/[A-Za-z0-9_.-]+\.(?:js|css)', file))
            urls.add('/indo-shipping' + file[len('/app/wwwroot'):])
    require(0 < len(urls) <= 128)
    require(any(url.endswith('.js') for url in urls))
    for url in sorted(urls):
        content = run(['docker', 'exec', app, 'cat', '/app/wwwroot' + url[len('/indo-shipping'):]])
        status, served = get('http://127.0.0.1' + url)
        require(status == 200 and hashlib.sha256(content).digest() == hashlib.sha256(served).digest())
        texts[url] = content.decode()
    alerts = '\n'.join(text for path, text in texts.items() if '/MaterialAlertsPage-' in path)
    purchase = '\n'.join(text for path, text in texts.items() if '/PurchasePage-' in path)
    def contains(text, marker):
        return marker in text or marker.encode('unicode_escape').decode().lower() in text.lower()
    require(all(contains(alerts, marker) for marker in ['adjustment-history', 'expected_source_received', '调整追踪', '调整记录']))
    require(all(contains(purchase, marker) for marker in ['回填净重', '已关联排期并带入走货期，数量和单价未改变']))
    checkpoint('frontendRoundedQuantityAndReversePrice')
    # Capture the same rounded quantity / rounded amount variables rather than
    # accepting unrelated .toFixed() display code elsewhere on the purchase page.
    writer = re.search(r'(?:const|let|var) ([A-Za-z_$][\w$]*)=Number\('
                       r'[A-Za-z_$][\w$]*\.toFixed\(([A-Za-z_$][\w$]*)\)\),'
                       r'([A-Za-z_$][\w$]*)=[A-Za-z_$][\w$]*\([A-Za-z_$][\w$]*\),'
                       r'[A-Za-z_$][\w$]*=(?:\1!==0\?\3/\1:0|\1===0\?0:\3/\1);', purchase)
    require(writer is not None)
    quantity, digits, amount = writer.group(1, 2, 3)
    require(re.search(r'z:`0\.\$\{[\"\'`]#[\"\'`]\.repeat\(' + re.escape(digits) + r'\)\}`', purchase))
    require(re.search(re.escape(quantity) + r'===0&&' + re.escape(amount) + r'!==0', purchase))
    checkpoint('frontendAmountRounding')
    require(contains(purchase, '.toPrecision(15)'))
    checkpoint('frontend923MaterialQuantityDisplay')
    require(re.search(r'\.material_qty\s*\?\?\s*0\)\.toFixed\(0\)', purchase))
    return {'frontendAssetsMatch': True, 'frontendFeatureMarkersPresent': True,
            'purchaseRoundedQuantityAndReversePriceMarkerPresent': True,
            'purchaseZeroRoundedQuantityGuardMarkerPresent': True,
            'purchaseAmountRoundingMarkerPresent': True, 'materialQuantityWholeNumberDisplayPresent': True,
            'versionedAssets': len(urls),
            'frontendAssetManifestSha256': hashlib.sha256(json.dumps(
                {path: hashlib.sha256(value.encode()).hexdigest() for path, value in texts.items()},
                sort_keys=True, separators=(',', ':')).encode()).hexdigest()}



def verify():
    directory, before = selected_backup()
    lifecycle_before_probe = diagnostic_core_state()
    current = audit()
    changed = sorted(table for table in set(before['tables']) | set(current['tables'])
                     if before['tables'].get(table) != current['tables'].get(table))
    commit = source_commit()
    checkpoint('sourceMatchesMain')
    require(commit == source_commit('origin/main') == TARGET_COMMIT and commit != BEFORE_COMMIT,
            'exactDeploymentTargetMatchesMain')
    source_tree = checkout_source_proof(commit, deployed=True)
    app, base = app_context()
    runtime = runtime_config(app)
    configuration_same = runtime['configEnvSha256'] == before['runtime'].get('configEnvSha256')
    configuration_preserved = configuration_same
    image_changed = runtime['imageId'] != before['runtime'].get('imageId')
    scope_same = core_containers() == before['coreContainers']
    environment_same = file_hash(private_env_file()) == file_hash(directory / 'env.before')
    checkpoint('healthAndAuthenticationBoundary')
    health, health_body = get(base + '/api/health')
    require(health == 200 and json.loads(health_body).get('ok') is True)
    public_health, _ = get('http://127.0.0.1/indo-shipping/health'); require(public_health == 200)
    unauthorized, _ = get(base + '/api/material-alerts'); require(unauthorized == 401)
    purchase_unauthorized, _ = get(base + '/api/purchase'); require(purchase_unauthorized == 401)
    container_health = run(['docker', 'inspect', '-f', '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}', app]).decode().strip()
    require(container_health == 'healthy')
    identities = role_identities()
    require(identities == before['roleIdentities'], 'existingProbeRolesPreserved')
    token = read_token(app, identities['admin'])
    checkpoint('authenticatedReadVerification')
    api = api_audit(base, token, verify=True)
    del token
    roles_same = role_audit(app, base, identities) == before['roles']
    final = audit()
    stable = current == final
    state_same = before['stateSettings'] == current['stateSettings']
    users_same = before['tables']['Users'] == current['tables']['Users']
    table_inventory_same = set(before['tables']) == set(current['tables'])
    data_same = not changed and state_same
    api_same = api == before['api']
    precision = price_preserved(before['priceColumn'], current['priceColumn'])
    schema = current['trackingSchema'] is True and current['rawRowsType'] in ['text', 'json', 'jsonb']
    schema_same = current['schemaSha256'] == before['schemaSha256']
    # Keep strict failures visible alongside complete database comparison results.
    lifecycle_after_probe = diagnostic_core_state()
    lifecycle_same = lifecycle_after_probe == before['coreLifecycle']
    lifecycle_stable = lifecycle_before_probe == lifecycle_after_probe
    scope_same = scope_same and core_containers() == before['coreContainers']
    runtime_stable = runtime_config(app) == runtime
    core_running = all(state.get('running') is True for state in lifecycle_after_probe.values())
    core_healthy = all(state.get('health') in ['healthy','none'] for state in lifecycle_after_probe.values())
    deployment_passed = all([precision, schema, schema_same, roles_same, stable, state_same, users_same, table_inventory_same,
                             configuration_preserved, environment_same, image_changed, scope_same,
                             lifecycle_same, lifecycle_stable, runtime_stable, core_running, core_healthy])
    result = {'verified': data_same and api_same and deployment_passed,
              'deploymentChecksPassed': deployment_passed,
              'backup': str(directory), 'businessDataUnchanged': data_same,
              'changedTables': changed,
              'changedTableCounts': {t: {'before': before['tables'].get(t,{}).get('rows'),
                                          'after': current['tables'].get(t,{}).get('rows')} for t in changed},
              'stateSettingsPreserved': state_same,
              'usersAndPermissionsPreserved': users_same, 'databaseTableInventoryPreserved': table_inventory_same,
              'existingTrackingAndPlacedPreserved': api_same, 'pricePrecisionVerified': precision,
              'trackingSchemaVerified': schema, 'schemaColumnsPreserved': schema_same,
              'existingAdminAndOrdinaryReadOnlyBoundaryVerified': roles_same, 'readOnlyProbesLeftDataUnchanged': stable,
              'tableCounts': {table: value['rows'] for table, value in current['tables'].items()},
              'trackedItems': api['trackedItems'], 'completedItems': api['completedItems'],
              'orderDetails': api['orderDetails'], 'schedules': api['schedules'], 'placedKeys': api['placedKeys'],
              'health': True, 'publicHealth': True, 'containerHealth': True, 'authBoundaryVerified': True,
              'authenticatedReadApisVerified': True, 'trackingAdjustmentFieldsVerified': True,
              'adjustmentHistoryReadVerified': True,
              'sourceCommit': commit, 'beforeSourceCommit': before['sourceCommit'],
              'sourceMatchesMain': True, 'runtimeConfigurationPreserved': configuration_preserved,
              'completeContainerEnvironmentIdentical': configuration_same,
              'sourceTreeSha256': source_tree, 'phase': PHASE,
              'privateEnvironmentPreserved': environment_same, 'deployedImageChanged': image_changed,
              'deployedImageHealthy': runtime['healthy'], 'coreContainersUnchanged': scope_same,
              'coreLifecycleUnchanged': lifecycle_same, 'coreLifecycleStableDuringProbe': lifecycle_stable,
              'runtimeStableDuringProbe': runtime_stable, 'coreServicesRunning': core_running,
              'coreServicesHealthyWhenConfigured': core_healthy,
              'coreLifecycleBefore': before['coreLifecycle'], 'coreLifecycleAfter': lifecycle_after_probe,
              'businessWritesPerformed': False, 'credentialsChanged': False}
    result.update(frontend_audit(app))
    return result


def diagnostic_core_state():
    checkpoint('readOnlyCoreLifecycleMetadata')
    result = {}
    template = ('{"running":{{json .State.Running}},"status":{{json .State.Status}},'
                '"startedAt":{{json .State.StartedAt}},"finishedAt":{{json .State.FinishedAt}},'
                '"restartCount":{{json .RestartCount}},"oomKilled":{{json .State.OOMKilled}},'
                '"createdAt":{{json .Created}},'
                '"health":{{if .State.Health}}{{json .State.Health.Status}}{{else}}"none"{{end}}}')
    for service in CORE_SERVICES:
        identifier = run(COMPOSE + ['ps', '-a', '-q', service]).decode().strip()
        if not identifier:
            result[service] = {'exists': False}
            continue
        require(bool(re.fullmatch(r'[a-f0-9]{12,64}', identifier)), 'oneCoreContainerPerService')
        value = json.loads(run(['docker', 'inspect', '-f', template, identifier]))
        require(set(value) == {'running', 'status', 'startedAt', 'finishedAt', 'restartCount',
                               'oomKilled', 'createdAt', 'health'})
        require(all(isinstance(value[key], bool) for key in ['running', 'oomKilled']))
        require(isinstance(value['restartCount'], int) and value['restartCount'] >= 0)
        require(value['status'] in ['created', 'running', 'paused', 'restarting', 'removing', 'exited', 'dead'])
        require(value['health'] in ['none', 'starting', 'healthy', 'unhealthy'])
        require(all(re.fullmatch(r'\d{4}-\d{2}-\d{2}T[0-9:.]+Z', value[key])
                    for key in ['startedAt', 'finishedAt', 'createdAt']))
        result[service] = {'exists': True, 'containerId': identifier, **value}
    return result


def main():
    global PHASE, BEFORE_COMMIT, TARGET_COMMIT, BACKUP_PATH
    mode, BEFORE_COMMIT, TARGET_COMMIT, BACKUP_PATH = sys.argv[1:]
    PHASE = '926'
    require(mode in ['backup', 'verify', 'diagnose'], 'modeValidation')
    require(PHASE == '926', 'phaseValidation')
    require(all(re.fullmatch(r'[a-f0-9]{40}', value) for value in [BEFORE_COMMIT, TARGET_COMMIT]),
            'commitValidation')
    require(BEFORE_COMMIT == INITIAL_COMMIT, 'exactPreDeployCommit')
    if mode == 'backup':
        require(BEFORE_COMMIT == TARGET_COMMIT and not BACKUP_PATH, 'backupArguments')
    else:
        require(BEFORE_COMMIT != TARGET_COMMIT and re.fullmatch(
            r'/opt/rr-portal/deploy/backups/indo-pre-' + PHASE + r'-[0-9]{8}T[0-9]{12}Z', BACKUP_PATH), 'verifyArguments')
    result = backup() if mode == 'backup' else verify()
    result['application'] = 'indo-shipping'
    if mode == 'diagnose':
        result['diagnosticComplete'] = True
        result['strictVerificationPassed'] = result['verified']
    if mode == 'verify' and not result['verified']:
        checks = [('runtimeConfigurationPreserved','runtimeConfigurationPreserved'),
                  ('privateEnvironmentPreserved','privateEnvironmentPreserved'),
                  ('deployedImageChanged','deployedImageChanged'),
                  ('coreContainersUnchanged','coreContainerScopePreserved'),
                  ('coreLifecycleUnchanged','coreLifecyclePreserved'),
                  ('coreLifecycleStableDuringProbe','coreLifecycleStableDuringProbe'),
                  ('runtimeStableDuringProbe','runtimeStableDuringProbe'),
                  ('coreServicesRunning','coreServicesRunning'),
                  ('coreServicesHealthyWhenConfigured','coreServicesHealthyWhenConfigured'),
                  ('businessDataUnchanged', 'businessRowHashesPreserved'),
                  ('stateSettingsPreserved', 'stateSettingsPreserved'),
                  ('usersAndPermissionsPreserved', 'usersAndPermissionsPreserved'),
                  ('databaseTableInventoryPreserved', 'databaseTableInventoryPreserved'),
                  ('existingTrackingAndPlacedPreserved', 'existingTrackingReadApisPreserved'),
                  ('pricePrecisionVerified', 'priceSchemaPrecision'),
                  ('trackingSchemaVerified', 'trackingSchema'),
                  ('schemaColumnsPreserved', 'schemaColumnsPreserved'),
                  ('existingAdminAndOrdinaryReadOnlyBoundaryVerified', 'readOnlyRoleBoundaryPreserved'),
                  ('readOnlyProbesLeftDataUnchanged', 'readOnlyVerificationStable')]
        result['failedCheck'] = next(label for field, label in checks if not result[field])
    print(json.dumps(result, ensure_ascii=True))
    if mode == 'verify' and not result['verified']:
        return 1
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception as error:
        error_type = type(error).__name__ if type(error).__name__ in {'RuntimeError', 'KeyError', 'TypeError', 'ValueError', 'JSONDecodeError', 'FileNotFoundError'} else 'Other'
        print(json.dumps({'failed': True, 'safeError': 'INDO_926_OPS_FAILED', 'failedCheck': FAILED_CHECK, 'errorType': error_type}))
        sys.exit(1)
