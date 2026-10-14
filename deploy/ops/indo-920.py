"""Server-local PR920 backup and read-only verification; never print business rows or secrets."""
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
                   'purchase_orders', 'po_items', 'po_receipts', 'outbound', 'shipments', 'shipment_items'}
TABLE_SQL = "SELECT COALESCE(json_agg(table_name ORDER BY table_name),'[]') FROM information_schema.tables WHERE table_schema='indo_shipping' AND table_type='BASE TABLE';\n"
CORE_SERVICES = ['nginx', 'core', 'db', 'redis', 'printlink']
FAILED_CHECK = 'entrypoint'


def checkpoint(label):
    global FAILED_CHECK
    FAILED_CHECK = label


def require(condition, label=None):
    if not condition:
        if label:
            checkpoint(label)
        raise RuntimeError('INDO_920_OPS_FAILED')


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
        if table == 'po_items':
            # JSON numeric text retains scale. Normalize only price so widening 18,4
            # to 22,8 does not falsely report a business change from appended zeroes.
            row = "(to_jsonb(r)-'price') || jsonb_build_object('price',trim_scale(r.price))"
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
          AND column_name IN ('id','schedule_id','raw_rows','rows_hash','materials','products','acknowledged','captured_at')));
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


def read_token(app):
    checkpoint('readOnlyProbeToken')
    uid = run(sql_command(), b'BEGIN READ ONLY; SELECT "Id" FROM indo_shipping."Users" WHERE "IsActive" AND "Userbqrpower"=\'111111111\' ORDER BY "Id" LIMIT 1; COMMIT;').decode().strip()
    require(uid.isdigit())
    # Capture privately, select the existing signing key, and discard the environment.
    values = run(['docker', 'inspect', '-f', '{{json .Config.Env}}', app])
    env = dict(item.split('=', 1) for item in json.loads(values) if '=' in item)
    key = base64.b64decode(env['INDO_SHIPPING_JWT_KEY_B64'], validate=True)
    require(len(key.decode('utf-8')) >= 32)
    del env, values
    encode = lambda data: base64.urlsafe_b64encode(data).decode().rstrip('=')
    header = encode(b'{"alg":"HS256","typ":"JWT"}')
    claims = {'iss': 'IndoShipping', 'aud': 'IndoShipping', 'sub': uid,
              'userbqrpower': '111111111', 'exp': int(time.time()) + 60}
    body = encode(json.dumps(claims, separators=(',', ':')).encode())
    unsigned = header + '.' + body
    token = unsigned + '.' + encode(hmac.new(key, unsigned.encode(), hashlib.sha256).digest())
    del key
    return token


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


def runtime_patch_proof(before, current, directory):
    checkpoint('runtimePatchEnvironmentProof')
    prior_commit = before['sourceCommit']
    require(bool(re.fullmatch(r'[a-f0-9]{40}', prior_commit)))
    compose_before = run(['git', 'show', prior_commit + ':docker-compose.cloud.yml'])
    require(compose_before == (ROOT / 'docker-compose.cloud.yml').read_bytes(), 'runtimePatchComposeUnchanged')
    require(file_hash(private_env_file()) == file_hash(directory / 'env.before'), 'runtimePatchEnvironmentFileUnchanged')
    checkpoint('runtimePatchComposeEnvironment')
    configured = json.loads(run(COMPOSE + ['config', '--format', 'json']))['services']['indo-shipping']['environment']
    require(isinstance(configured, dict) and all(isinstance(value, str) for value in configured.values()))

    def image_environment(image):
        require(bool(re.fullmatch(r'sha256:[a-f0-9]{64}', image)))
        values = json.loads(run(['docker', 'image', 'inspect', '-f', '{{json .Config.Env}}', image]))
        require(isinstance(values, list) and all(isinstance(item, str) and '=' in item for item in values))
        result = dict(item.split('=', 1) for item in values)
        require(len(result) == len(values), 'runtimePatchNoDuplicateEnvironmentKeys')
        return result

    checkpoint('runtimePatchOldImageDefaults')
    old_defaults = image_environment(before['runtime']['imageId'])
    checkpoint('runtimePatchNewImageDefaults')
    new_defaults = image_environment(current['imageId'])
    def effective_digest(defaults):
        values = {**defaults, **configured}
        items = sorted(key + '=' + value for key, value in values.items())
        return hashlib.sha256(json.dumps(items, ensure_ascii=True, separators=(',', ':')).encode()).hexdigest()

    # Exact reconstruction anchors every prior/current container environment value;
    # unchanged compose and private env prove configured secrets remain the same.
    require(effective_digest(old_defaults) == before['runtime']['configEnvSha256'], 'runtimePatchPriorEnvironmentReconstructed')
    require(effective_digest(new_defaults) == current['configEnvSha256'], 'runtimePatchCurrentEnvironmentReconstructed')
    changed = sorted(key for key in set(old_defaults) | set(new_defaults) if old_defaults.get(key) != new_defaults.get(key))
    require(bool(changed) and set(changed) <= {'DOTNET_VERSION', 'ASPNET_VERSION'}, 'runtimePatchOnlyVersionKeys')
    require(all(re.fullmatch(r'8\.0\.\d+', old_defaults.get(key, '')) and re.fullmatch(r'8\.0\.\d+', new_defaults.get(key, '')) for key in changed), 'runtimePatchSameMajorMinor')
    require(all(int(new_defaults[key].split('.')[2]) > int(old_defaults[key].split('.')[2]) for key in changed), 'runtimePatchVersionsOnlyAdvance')
    print(json.dumps({'baseRuntimeVersionKeysChanged': changed, 'priorEnvironmentExactlyReconstructed': True,
                      'currentEnvironmentExactlyReconstructed': True, 'configuredEnvironmentAndSecretsPreserved': True}))
    return changed


def canonical(value):
    if value is None:
        return ['null']
    if isinstance(value, bool):
        return ['boolean', value]
    if isinstance(value, (int, decimal.Decimal)):
        number = decimal.Decimal(value)
        return ['number', format(number.normalize(), 'f') if number else '0']
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
    # ordered_qty is newly exposed on details by PR916; compare only fields that
    # already existed, while item-level ordered totals and all DB rows are retained.
    detail_fields = ['key', 'status', 'required_qty', 'received_qty', 'outbound_qty', 'manual_qty']
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
    BACKUPS.mkdir(parents=True, exist_ok=True)
    require(not BACKUPS.is_symlink())
    directory = BACKUPS / ('indo-pre-920-' + datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ'))
    directory.mkdir(mode=0o700)
    app, base = app_context()
    runtime = runtime_config(app)
    scope = core_containers()
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
    token = read_token(app)
    checkpoint('authenticatedReadBaseline')
    baseline['api'] = api_audit(base, token)
    del token
    # Refuse a baseline whose business rows changed between the exported snapshot
    # and API capture. Leave the private dump for recovery but no usable manifest.
    require(audit() == {key: value for key, value in baseline.items() if key != 'api'}, 'baselineDatabaseStable')
    require(runtime_config(app) == runtime, 'baselineRuntimeStable')
    require(core_containers() == scope, 'baselineCoreScopeStable')
    require(file_hash(private_env_file()) == file_hash(environment_backup), 'baselineEnvironmentStable')
    baseline.update({'schema': 'indo_shipping', 'sourceCommit': source_commit(),
                     'consistentExportedSnapshot': True, 'digestMethod': 'sha256-sorted-row-multiset-price-trim-scale',
                     'deploymentLabel': 'PR920', 'runtime': runtime, 'coreContainers': scope})
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
            'runtimeConfigurationBaselined': True, 'coreContainerScopeBaselined': True,
            'privateArchiveVerified': True, 'businessWritesPerformed': False, 'credentialsChanged': False}


def latest_backup():
    checkpoint('privateBackupManifest')
    directories = sorted(BACKUPS.glob('indo-pre-920-*'))
    require(bool(directories))
    directory = directories[-1]
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
    require(baseline.get('deploymentLabel') == 'PR920' and isinstance(baseline.get('runtime'), dict)
            and set(baseline.get('coreContainers', {})) == set(CORE_SERVICES))
    table_names(list(baseline['tables']))
    require(baseline.get('digestMethod') == 'sha256-sorted-row-multiset-price-trim-scale')
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
    for chunk in ['MaterialAlertsPage', 'PurchasePage']:
        files = run(['docker', 'exec', app, 'find', '/app/wwwroot/assets', '-maxdepth', '1',
                     '-type', 'f', '-name', chunk + '-*.js']).decode().splitlines()
        require(len(files) == 1 and re.fullmatch('/app/wwwroot/assets/' + chunk + r'-[A-Za-z0-9_-]+\.js', files[0]))
        urls.add('/indo-shipping' + files[0][len('/app/wwwroot'):])
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
    checkpoint('frontend920QuantityPrecision')
    require(contains(purchase, '0.######'))
    checkpoint('frontend920AmountRounding')
    require(contains(purchase, '.toPrecision(15)'))
    return {'frontendAssetsMatch': True, 'frontendFeatureMarkersPresent': True,
            'purchaseQuantityPrecisionMarkerPresent': True,
            'purchaseAmountRoundingMarkerPresent': True, 'versionedAssets': len(urls)}


def verify():
    directory, before = latest_backup()
    current = audit()
    changed = sorted(table for table in set(before['tables']) | set(current['tables'])
                     if before['tables'].get(table) != current['tables'].get(table))
    commit = source_commit()
    checkpoint('sourceMatchesMain')
    require(commit == source_commit('origin/main'))
    app, base = app_context()
    runtime = runtime_config(app)
    configuration_same = runtime['configEnvSha256'] == before['runtime'].get('configEnvSha256')
    runtime_version_keys = [] if configuration_same else runtime_patch_proof(before, runtime, directory)
    configuration_preserved = configuration_same or bool(runtime_version_keys)
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
    token = read_token(app)
    checkpoint('authenticatedReadVerification')
    api = api_audit(base, token, verify=True)
    del token
    final = audit()
    stable = current == final
    data_same = not changed and before['stateSettings'] == current['stateSettings']
    api_same = api == before['api']
    precision = price_preserved(before['priceColumn'], current['priceColumn'])
    schema = current['trackingSchema'] is True and current['rawRowsType'] in ['text', 'json', 'jsonb']
    require(configuration_preserved, 'runtimeConfigurationPreserved')
    require(environment_same, 'privateEnvironmentPreserved')
    require(image_changed, 'deployedImageChanged')
    require(scope_same and core_containers() == before['coreContainers'], 'coreContainerScopePreserved')
    require(runtime_config(app) == runtime, 'verificationRuntimeStable')
    result = {'verified': data_same and api_same and precision and schema and stable,
              'backup': str(directory), 'businessDataUnchanged': data_same,
              'changedTables': changed, 'stateSettingsPreserved': before['stateSettings'] == current['stateSettings'],
              'existingTrackingAndPlacedPreserved': api_same, 'pricePrecisionVerified': precision,
              'trackingSchemaVerified': schema, 'readOnlyProbesLeftDataUnchanged': stable,
              'tableCounts': {table: value['rows'] for table, value in current['tables'].items()},
              'trackedItems': api['trackedItems'], 'completedItems': api['completedItems'],
              'orderDetails': api['orderDetails'], 'schedules': api['schedules'], 'placedKeys': api['placedKeys'],
              'health': True, 'publicHealth': True, 'containerHealth': True, 'authBoundaryVerified': True,
              'authenticatedReadApisVerified': True, 'trackingAdjustmentFieldsVerified': True,
              'adjustmentHistoryReadVerified': True,
              'sourceCommit': commit, 'beforeSourceCommit': before['sourceCommit'],
              'sourceMatchesMain': True, 'runtimeConfigurationPreserved': configuration_preserved,
              'completeContainerEnvironmentIdentical': configuration_same,
              'baseRuntimeVersionKeysChanged': runtime_version_keys,
              'privateEnvironmentPreserved': environment_same, 'deployedImageChanged': image_changed,
              'deployedImageHealthy': runtime['healthy'], 'coreContainersUnchanged': scope_same,
              'businessWritesPerformed': False, 'credentialsChanged': False}
    result.update(frontend_audit(app))
    return result


def main():
    mode, = sys.argv[1:]
    require(mode in ['backup', 'verify'], 'modeValidation')
    result = backup() if mode == 'backup' else verify()
    if mode == 'verify' and not result['verified']:
        checks = [('businessDataUnchanged', 'businessRowHashesPreserved'),
                  ('stateSettingsPreserved', 'stateSettingsPreserved'),
                  ('existingTrackingAndPlacedPreserved', 'existingTrackingReadApisPreserved'),
                  ('pricePrecisionVerified', 'priceSchemaPrecision'),
                  ('trackingSchemaVerified', 'trackingSchema'),
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
        print(json.dumps({'failed': True, 'safeError': 'INDO_920_OPS_FAILED', 'failedCheck': FAILED_CHECK, 'errorType': error_type}))
        sys.exit(1)
