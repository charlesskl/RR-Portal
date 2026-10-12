"""Server-only, read-only PR911 backup and deployment audit. Never logs row values."""
import datetime
import hashlib
import json
import os
import pathlib
import re
import select
import subprocess
import sys
import urllib.error
import urllib.request

os.umask(0o077)
ROOT = pathlib.Path('/opt/rr-portal')
BACKUPS = ROOT / 'deploy/backups'
COMPOSE = ['docker', 'compose', '-f', 'docker-compose.cloud.yml', '--env-file', '.env.cloud.production']
TABLES = [('settings', '"key"'), ('dict_supplier', 'id'), ('materials', 'id'),
          ('purchase_orders', 'id'), ('po_items', 'id'), ('po_receipts', 'id'),
          ('products', 'code'), ('tool_materials', 'material_id'),
          ('dict_hs', 'id'), ('dict_translation', 'id'), ('Users', '"Id"')]
USER_FIELDS = '"Id","Username","DisplayName","Userbqrpower","Usereditpower","IsActive"'
PG_SHELL = 'exec psql -X -q -At -v ON_ERROR_STOP=1 -U "${POSTGRES_USER:-rrportal}" -d "${POSTGRES_DB:-rrportal}"'


def require(condition, code):
    if not condition:
        raise RuntimeError(code)


def run(args, data=None):
    result = subprocess.run(args, input=data, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                            cwd=ROOT, timeout=180)
    require(result.returncode == 0, 'COMMAND_FAILED')
    return result.stdout


def cid(service):
    value = run(COMPOSE + ['ps', '-q', service]).decode().strip()
    require(bool(re.fullmatch(r'[a-f0-9]{12,64}', value)), 'COMPOSE_CONTAINER_NOT_UNIQUE')
    return value


def sql_command():
    # The DB container reads its own credentials internally; no credentials enter argv or logs.
    return ['docker', 'exec', '-i', cid('db'), 'sh', '-c', PG_SHELL]


def audit_sql():
    parts = []
    for table, key in TABLES:
        identifier = '"' + table + '"'
        source = ('SELECT ' + USER_FIELDS + ' FROM indo_shipping.' + identifier) if table == 'Users' else ('SELECT * FROM indo_shipping.' + identifier)
        digest = "encode(sha256(convert_to(COALESCE(string_agg(encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex'),'' ORDER BY " + key + "),''),'UTF8')),'hex')"
        parts += ["'" + table + "'", "(SELECT jsonb_build_object('rows',COUNT(*),'sha256'," + digest + ") FROM (" + source + ") r)"]
    return "SELECT jsonb_build_object('tables',jsonb_build_object(" + ','.join(parts) + "),'blankCustoms',(SELECT COUNT(*) FROM indo_shipping.dict_supplier WHERE trim(COALESCE(customs_company,''))=''));\n"


def audit():
    sql = 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;\n' + audit_sql() + 'COMMIT;\n'
    return json.loads(run(sql_command(), sql.encode()))


def file_hash(file):
    value = hashlib.sha256()
    with file.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            value.update(block)
    return value.hexdigest()


def source_commit():
    value = run(['git', 'rev-parse', 'HEAD']).decode().strip()
    require(bool(re.fullmatch(r'[a-f0-9]{40}', value)), 'SOURCE_COMMIT_INVALID')
    return value


def read_line(process):
    require(bool(select.select([process.stdout], [], [], 60)[0]), 'READ_ONLY_SNAPSHOT_TIMEOUT')
    value = process.stdout.readline()
    require(bool(value), 'READ_ONLY_SNAPSHOT_FAILED')
    return value.strip()


def backup():
    BACKUPS.mkdir(parents=True, exist_ok=True)
    directory = BACKUPS / ('indo-pre-911-' + datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ'))
    directory.mkdir(mode=0o700)
    dump = directory / 'indo_shipping.dump'
    process = subprocess.Popen(sql_command(), stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                               stderr=subprocess.PIPE, cwd=ROOT, bufsize=0)
    committed = False
    try:
        process.stdin.write(b'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;\nSELECT pg_export_snapshot();\n')
        process.stdin.flush()
        snapshot = read_line(process).decode()
        require(bool(re.fullmatch(r'[0-9A-Fa-f]+-[0-9A-Fa-f]+-[0-9]+', snapshot)), 'SNAPSHOT_ID_INVALID')
        process.stdin.write(audit_sql().encode())
        process.stdin.flush()
        baseline = json.loads(read_line(process))
        # pg_dump imports the exact snapshot used for counts/hashes, while the transaction stays open.
        args = ['docker', 'exec', cid('db'), 'sh', '-c',
                'exec pg_dump -Fc --schema=indo_shipping --snapshot="$1" -U "${POSTGRES_USER:-rrportal}" -d "${POSTGRES_DB:-rrportal}"',
                'pg_dump', snapshot]
        with dump.open('xb') as output:
            dumped = subprocess.run(args, stdout=output, stderr=subprocess.PIPE, cwd=ROOT, timeout=180)
        require(dumped.returncode == 0 and dump.stat().st_size > 0, 'SCHEMA_BACKUP_FAILED')
        with dump.open('rb') as stream:
            checked = subprocess.run(['docker', 'exec', '-i', cid('db'), 'pg_restore', '--list'],
                                     stdin=stream, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
                                     cwd=ROOT, timeout=180)
        require(checked.returncode == 0, 'SCHEMA_BACKUP_ARCHIVE_INVALID')
        process.stdin.write(b'COMMIT;\n')
        process.stdin.flush()
        process.stdin.close()
        require(process.wait(timeout=15) == 0, 'SNAPSHOT_COMMIT_FAILED')
        committed = True
    finally:
        if not committed and process.poll() is None:
            try:
                process.stdin.write(b'ROLLBACK;\n')
                process.stdin.flush()
                process.stdin.close()
                process.wait(timeout=5)
            except Exception:
                process.kill()
                process.wait(timeout=5)
        for stream in [process.stdout, process.stderr]:
            if stream:
                stream.close()
    baseline.update({'schema': 'indo_shipping', 'sourceCommit': source_commit(),
                     'created': datetime.datetime.now(datetime.timezone.utc).isoformat(),
                     'consistentExportedSnapshot': True, 'digestMethod': 'sha256-sorted-row-sha256'})
    baseline_file = directory / 'baseline.json'
    baseline_file.write_text(json.dumps(baseline, ensure_ascii=False))
    dump.chmod(0o600)
    baseline_file.chmod(0o600)
    manifest = {'indo_shipping.dump': file_hash(dump), 'baseline.json': file_hash(baseline_file)}
    manifest_file = directory / 'manifest.json'
    manifest_file.write_text(json.dumps(manifest))
    manifest_file.chmod(0o600)
    return {'backup': str(directory), 'schema': 'indo_shipping', 'consistentSnapshot': True,
            'dumpBytes': dump.stat().st_size, 'manifestSha256': file_hash(manifest_file),
            'baseline': baseline}


def latest_backup():
    directories = sorted(BACKUPS.glob('indo-pre-911-*'))
    require(bool(directories), 'BASELINE_BACKUP_MISSING')
    directory = directories[-1]
    require(directory.is_dir() and not directory.is_symlink(), 'BASELINE_DIRECTORY_INVALID')
    manifest = json.loads((directory / 'manifest.json').read_text())
    require(set(manifest) == {'indo_shipping.dump', 'baseline.json'}, 'BACKUP_MANIFEST_INVALID')
    for filename, expected in manifest.items():
        file = directory / filename
        require(file.is_file() and not file.is_symlink() and file_hash(file) == expected, 'BACKUP_HASH_MISMATCH')
    baseline = json.loads((directory / 'baseline.json').read_text())
    require(baseline.get('schema') == 'indo_shipping' and baseline.get('consistentExportedSnapshot') is True
            and set(baseline.get('tables', {})) == {table for table, key in TABLES}, 'BASELINE_SCOPE_INVALID')
    return directory, baseline


def get(url):
    try:
        with urllib.request.urlopen(url, timeout=20) as response:
            return response.status, response.read()
    except urllib.error.HTTPError as error:
        return error.code, b''


def verify():
    directory, before = latest_backup()
    current = audit()
    changed = [table for table, key in TABLES if current['tables'][table] != before['tables'][table]]
    commit = source_commit()
    require(commit == run(['git', 'rev-parse', 'origin/main']).decode().strip(), 'SERVER_SOURCE_NOT_CURRENT_MAIN')
    app = cid('indo-shipping')
    networks = json.loads(run(['docker', 'inspect', '-f', '{{json .NetworkSettings.Networks}}', app]))
    ip = next((entry.get('IPAddress') for entry in networks.values() if entry.get('IPAddress')), None)
    require(bool(ip), 'APP_CONTAINER_NETWORK_MISSING')
    base = 'http://' + ip + ':5180'
    health_code, health_body = get(base + '/api/health')
    require(health_code == 200 and json.loads(health_body).get('ok') is True, 'DATABASE_HEALTH_FAILED')
    public_health, _ = get('http://127.0.0.1/indo-shipping/health')
    require(public_health == 200, 'PUBLIC_HEALTH_FAILED')
    unauthorized, _ = get(base + '/api/purchase')
    require(unauthorized == 401, 'PURCHASE_AUTH_BOUNDARY_FAILED')
    index = run(['docker', 'exec', app, 'cat', '/app/wwwroot/index.html'])
    public_index_code, public_index = get('http://127.0.0.1/indo-shipping/')
    require(public_index_code == 200 and public_index == index, 'SERVED_INDEX_MISMATCH')
    asset_urls = sorted(set(re.findall(r'(?:src|href)="(/indo-shipping/assets/[A-Za-z0-9_.-]+\.(?:js|css))"', index.decode())))
    require(any(url.endswith('.js') for url in asset_urls), 'VERSIONED_FRONTEND_ASSETS_MISSING')
    purchase_files = run(['docker', 'exec', app, 'find', '/app/wwwroot/assets', '-maxdepth', '1', '-type', 'f', '-name', 'PurchasePage-*.js']).decode().splitlines()
    require(len(purchase_files) == 1 and bool(re.fullmatch(r'/app/wwwroot/assets/PurchasePage-[A-Za-z0-9_-]+\.js', purchase_files[0])),
            'PURCHASE_PAGE_CHUNK_NOT_UNIQUE')
    asset_urls = sorted(set(asset_urls + ['/indo-shipping' + purchase_files[0][len('/app/wwwroot'):]]))
    assets = []
    javascript = []
    for url in asset_urls:
        content = run(['docker', 'exec', app, 'cat', '/app/wwwroot' + url[len('/indo-shipping'):]])
        status, served = get('http://127.0.0.1' + url)
        require(status == 200 and content == served, 'SERVED_ASSET_MISMATCH')
        assets.append({'path': url, 'bytes': len(content), 'sha256': hashlib.sha256(content).hexdigest()})
        if url.endswith('.js'):
            javascript.append(content.decode())
    text = '\n'.join(javascript)
    markers = ['供应商档案未唯一匹配或未设置报关公司', '订单、报关资料或可用编号已变化，请取消后重新检查']
    feature_present = all(marker in text or marker.encode('unicode_escape').decode().lower() in text.lower() for marker in markers)
    require(feature_present, 'PR911_FRONTEND_FEATURES_MISSING')
    docker_health = run(['docker', 'inspect', '-f', '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}', app]).decode().strip()
    require(docker_health == 'healthy', 'APP_CONTAINER_NOT_HEALTHY')
    same = not changed and current['blankCustoms'] == before['blankCustoms']
    return {'verified': same, 'businessDataUnchanged': same, 'changedTables': changed,
            'schema': 'indo_shipping', 'backup': str(directory), 'sourceCommit': commit,
            'beforeSourceCommit': before['sourceCommit'], 'audit': current,
            'health': health_code, 'publicHealth': public_health, 'containerHealth': docker_health,
            'unauthenticatedPurchaseApi': unauthorized, 'frontendFeaturesPresent': feature_present,
            'indexSha256': hashlib.sha256(index).hexdigest(), 'assets': assets,
            'businessWritesPerformed': False, 'passwordChangesPerformed': False}


try:
    mode, = sys.argv[1:]
    require(mode in ['backup', 'verify'], 'INVALID_MODE')
    result = backup() if mode == 'backup' else verify()
    print(json.dumps(result, ensure_ascii=False))
    if mode == 'verify' and not result['verified']:
        sys.exit(1)
except Exception as error:
    # Do not print subprocess stderr/argv, database rows, environment values, or raw parser errors.
    code = str(error) if isinstance(error, RuntimeError) and re.fullmatch(r'[A-Z_]+', str(error)) else 'INDO_OPS_FAILED'
    print(json.dumps({'failed': True, 'safeError': code}))
    sys.exit(1)
