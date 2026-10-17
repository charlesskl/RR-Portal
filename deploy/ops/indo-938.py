"""PR938 private schema backup and strict read-only application deployment verification; no business writes."""
import base64
import datetime
import decimal
import hashlib
import hmac
import ipaddress
import importlib.util
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
# Frozen only after application review, fixes, tests and production build finish.
PIN_PATH = pathlib.Path(__file__).with_name('source-pin.json')
if not PIN_PATH.is_file():
    PIN_PATH = pathlib.Path(__file__).with_name('indo-938-source-pin.json')
PIN = json.loads(PIN_PATH.read_text())
EXPECTED_DIST = PIN['dist']
EXPECTED_SOURCE_BLOBS = PIN['sourceBlobs']
EXPECTED_RUNTIME_DOCUMENTS = PIN['runtimeDocuments']
ASSEMBLIES = ['IndoShipping.Api', 'IndoShipping.Domain', 'IndoShipping.Infrastructure']
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
        raise RuntimeError('INDO_938_OPS_FAILED')


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
    # This PR changes frontend code only, with no startup changes. Refuse known pending startup backfills
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
        require(changed and all(path.startswith(APP_PATH + 'web/') for path in changed),
                'deploymentDiffOnlyReviewedIndoApplication')
        run(['git', 'merge-base', '--is-ancestor', BEFORE_COMMIT, commit])
        # A frontend-only rebuild may retain or change assembly bytes; exact source
        # identity is independently proved from the actual DLL/PDB document checksums.
        run(['git', 'diff', '--quiet', BEFORE_COMMIT, commit, '--', APP_PATH + 'src/'])
        validate_expected_manifest()
        require(set(changed) == set(EXPECTED_SOURCE_BLOBS), 'exactReviewedChangeInventory')
        for path, expected in EXPECTED_SOURCE_BLOBS.items():
            require(hashlib.sha256(run(['git', 'show', commit + ':' + path])).hexdigest() == expected,
                    'exactReviewedSourceBlobs')
        runtime_paths = [path for path in run(['git', 'ls-tree', '-r', '-z', '--name-only', commit, '--',
                         APP_PATH + 'src/']).decode().split('\0') if path.endswith('.cs')]
        expected_runtime_paths = {APP_PATH + path for documents in EXPECTED_RUNTIME_DOCUMENTS.values() for path in documents}
        require(set(runtime_paths) == expected_runtime_paths, 'allCompiledProjectSourceInventoryPinned')
        for documents in EXPECTED_RUNTIME_DOCUMENTS.values():
            for relative, expected in documents.items():
                require(hashlib.sha256(run(['git', 'show', commit + ':' + APP_PATH + relative])).hexdigest() == expected,
                        'runtimeDocumentPinMatchesExactTargetGitBlob')
    files = [path for path in run(['git', 'ls-tree', '-r', '-z', '--name-only', commit, '--', APP_PATH]).decode().split('\0') if path]
    require(files and all(path.startswith(APP_PATH) for path in files))
    return hashlib.sha256(run(['git', 'ls-tree', '-r', commit, '--', APP_PATH])).hexdigest()


def runtime_config(app):
    checkpoint('runtimeConfiguration')
    template = ('{"env":{{json .Config.Env}},"mounts":{{json .Mounts}},"image":{{json .Image}},'
                '"startedAt":{{json .State.StartedAt}},"restartCount":{{json .RestartCount}},'
                '"running":{{json .State.Running}},"oomKilled":{{json .State.OOMKilled}},'
                '"health":{{if .State.Health}}{{json .State.Health.Status}}{{else}}"none"{{end}}}')
    value = json.loads(run(['docker', 'inspect', '-f', template, app]))
    require(isinstance(value.get('env'), list) and all(isinstance(item, str) for item in value['env']))
    require(bool(re.fullmatch(r'sha256:[a-f0-9]{64}', value.get('image', ''))))
    require(value.get('health') == 'healthy' and value.get('running') is True
            and value.get('oomKilled') is False, 'runtimeContainerHealthy')
    # The application stores business rows and image bytes in indo_shipping.
    # It has no persistent filesystem mount; refuse unexpected extra mounts.
    require(value.get('mounts') == [], 'expectedDatabaseOnlyPersistence')
    environment = dict(item.split('=', 1) for item in value['env'] if '=' in item)
    require(len(environment) == len(value['env']), 'uniqueRuntimeEnvironmentKeys')
    # Base runtime version labels may change when the image is rebuilt. All
    # application and other inherited settings remain part of the protected hash.
    protected = {key: item for key, item in environment.items()
                 if key not in {'DOTNET_VERSION', 'ASPNET_VERSION'}}
    digest = lambda data: hashlib.sha256(json.dumps(data, sort_keys=True, ensure_ascii=True,
                                                   separators=(',', ':')).encode()).hexdigest()
    return {'configEnvSha256': digest(protected), 'completeEnvSha256': digest(environment),
            'mountsSha256': digest(value['mounts']), 'imageId': value['image'], 'healthy': True,
            'containerId': app, 'startedAt': value['startedAt'], 'restartCount': value['restartCount']}


def runtime_artifact_bytes(app, filename):
    require(filename in [name + suffix for name in ASSEMBLIES for suffix in ['.dll', '.pdb']])
    path = '/app/' + filename
    size = run(['docker', 'exec', app, 'stat', '-c', '%s', path]).decode().strip()
    require(size.isdigit() and 0 < int(size) <= 32 * 1024 * 1024, 'boundedRuntimeArtifact')
    value = run(['docker', 'exec', app, 'cat', path])
    require(len(value) == int(size), 'runtimeArtifactCompleteRead')
    return value


def backend_artifacts(app, check_expected=False):
    checkpoint('actualBackendRuntimeArtifacts')
    values = {}
    if check_expected:
        validate_expected_manifest()
        module_path = pathlib.Path(__file__).with_name('pdb-proof.py')
        if not module_path.is_file():
            module_path = pathlib.Path(__file__).with_name('indo-938-pdb.py')
        spec = importlib.util.spec_from_file_location('indo_938_pdb_proof', module_path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
    for assembly in ASSEMBLIES:
        dll = runtime_artifact_bytes(app, assembly + '.dll')
        pdb = runtime_artifact_bytes(app, assembly + '.pdb')
        if check_expected:
            checkpoint('actualDllPdbAndReviewedSourceDocumentBinding')
            values[assembly] = module.prove(dll, pdb, EXPECTED_RUNTIME_DOCUMENTS[assembly])
        else:
            values[assembly] = {'dllSha256': hashlib.sha256(dll).hexdigest(),
                                'pdbSha256': hashlib.sha256(pdb).hexdigest()}
    return values



def backend_binding_preserved(before, artifacts):
    # Compare source evidence, not a required binary change. Both sides must be
    # actual DLL↔PDB proofs bound to the same frozen complete source inventory.
    require(before.get('actualBackendRuntimeSourceVerified') is True,
            'backupBackendSourceIdentityRequired')
    old = before.get('backendArtifacts', {})
    require(set(old) == set(artifacts) == set(ASSEMBLIES), 'completeBackendBindingInventory')
    for name in ASSEMBLIES:
        for side in [old[name], artifacts[name]]:
            require(all(side.get(field) is True for field in
                        ['codeViewMatchesPortablePdb', 'reviewedDocumentChecksumsMatched',
                         'nonGeneratedDocumentInventoryMatched']), 'actualBackendSourceBindingRequired')
        require(old[name].get('documentManifestSha256') == artifacts[name].get('documentManifestSha256')
                and bool(re.fullmatch(r'[a-f0-9]{64}', artifacts[name].get('documentManifestSha256', ''))),
                'frontendOnlyBackendDocumentIdentityPreserved')
    return all(artifacts[name][field] == old[name][field]
               for name in ASSEMBLIES for field in ['dllSha256', 'pdbSha256'])



def core_containers():
    checkpoint('freshCoreContainerLifecycle')
    result = {}
    template = ('{"running":{{json .State.Running}},"status":{{json .State.Status}},'
                '"startedAt":{{json .State.StartedAt}},"restartCount":{{json .RestartCount}},'
                '"oomKilled":{{json .State.OOMKilled}},'
                '"health":{{if .State.Health}}{{json .State.Health.Status}}{{else}}"none"{{end}}}')
    for service in CORE_SERVICES:
        identifier = cid(service)
        value = json.loads(run(['docker', 'inspect', '-f', template, identifier]))
        require(value.get('running') is True and value.get('status') == 'running'
                and value.get('oomKilled') is False and value.get('health') in ['healthy', 'none'],
                'allFiveCoreServicesHealthy')
        require(isinstance(value.get('restartCount'), int) and value['restartCount'] >= 0)
        require(bool(re.fullmatch(r'\d{4}-\d{2}-\d{2}T[0-9:.]+Z', value.get('startedAt', ''))))
        result[service] = {'containerId': identifier, **value}
    return result


def nginx_protected():
    checkpoint('actualNginxConfigurationAndAuthorization')
    nginx = cid('nginx')
    return {name: run(['docker', 'exec', nginx, 'cat', path]) for name, path in
            [('nginx.conf', '/etc/nginx/nginx.conf'), ('nginx.htpasswd', '/etc/nginx/.htpasswd')]}


def nginx_hashes():
    return {name: hashlib.sha256(value).hexdigest() for name, value in nginx_protected().items()}


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
    dictionaries = get_json(base, '/api/dictionaries', token)
    require(isinstance(dictionaries.get('suppliers'), list))
    products = get_json(base, '/api/products', token)
    require(isinstance(products, list))
    molding_blob = get_json(base, '/api/molding-pos/blob', token)
    result = {'supplierDictionaryDigest': digest_rows([dictionaries]), 'supplierCount': len(dictionaries['suppliers']),
              'productsDigest': digest_rows(products), 'moldingBlobDigest': digest_rows([molding_blob]),
              'trackedItems': len(items), 'completedItems': sum(item['manual_completed'] for item in items),
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
    artifacts = backend_artifacts(app, check_expected=True)
    scope = core_containers()
    nginx_files = nginx_protected()
    for name, content in nginx_files.items():
        with (directory / name).open('xb') as target:
            target.write(content)
        (directory / name).chmod(0o600)
    nginx_baseline = {name: hashlib.sha256(content).hexdigest() for name, content in nginx_files.items()}
    del nginx_files
    frontend = frontend_audit(app, check_expected=False)
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
    require(runtime_config(app) == runtime and backend_artifacts(app, check_expected=True) == artifacts, 'baselineRuntimeStable')
    require(core_containers() == scope, 'baselineCoreScopeStable')
    require(nginx_hashes() == nginx_baseline, 'baselineNginxStable')
    require(file_hash(private_env_file()) == file_hash(environment_backup), 'baselineEnvironmentStable')
    require(source_commit() == source_commit('origin/main') == before_commit,
            'baselineSourceStable')
    baseline.update({'schema': 'indo_shipping', 'sourceCommit': before_commit,
                     'consistentExportedSnapshot': True, 'digestMethod': 'sha256-sorted-full-row-multiset',
                     'deploymentLabel': 'PR' + PHASE, 'runtime': runtime, 'backendArtifacts': artifacts, 'coreContainers': scope,
                     'nginxProtected': nginx_baseline, 'frontend': frontend,
                     'roles': roles, 'roleIdentities': identities, 'startupBusinessWritesGuardPassed': True,
                     'actualBackendRuntimeSourceVerified': True,
                     'sourceTreeSha256': checkout_source_proof(before_commit)})
    checkpoint('privateBackupManifest')
    baseline_file = directory / 'baseline.json'
    baseline_file.write_text(json.dumps(baseline, ensure_ascii=True))
    dump.chmod(0o600); baseline_file.chmod(0o600)
    manifest = {'indo_shipping.dump': file_hash(dump), 'baseline.json': file_hash(baseline_file),
                'env.before': file_hash(environment_backup),
                **{name: file_hash(directory / name) for name in nginx_baseline}}
    manifest_file = directory / 'manifest.json'
    manifest_file.write_text(json.dumps(manifest)); manifest_file.chmod(0o600)
    return {'backup': str(directory), 'consistentSnapshot': True, 'dumpBytes': dump.stat().st_size,
            'tableCounts': {table: value['rows'] for table, value in baseline['tables'].items()},
            'sourceCommit': baseline['sourceCommit'], 'privateEnvironmentBackedUp': True,
            'runtimeConfigurationBaselined': True, 'coreContainerScopeBaselined': True,
            'privateArchiveVerified': True, 'backendRuntimeArtifactsBaselined': True, 'startupBusinessWritesGuardPassed': True,
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
    require(set(manifest) == {'indo_shipping.dump', 'baseline.json', 'env.before', 'nginx.conf', 'nginx.htpasswd'})
    for filename, expected in manifest.items():
        file = directory / filename
        require(file.is_file() and not file.is_symlink() and file.stat().st_mode & 0o077 == 0
                and file_hash(file) == expected)
    baseline = json.loads((directory / 'baseline.json').read_text())
    require(baseline.get('schema') == 'indo_shipping' and baseline.get('consistentExportedSnapshot') is True)
    require(baseline.get('deploymentLabel') == 'PR' + PHASE and isinstance(baseline.get('runtime'), dict)
            and set(baseline.get('coreContainers', {})) == set(CORE_SERVICES))
    require(baseline.get('sourceCommit') == BEFORE_COMMIT and baseline.get('startupBusinessWritesGuardPassed') is True,
            'backupExactPhaseAndSourceMatch')
    require(set(baseline.get('backendArtifacts', {})) == set(ASSEMBLIES), 'backupActualAssembliesRequired')
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


def validate_expected_manifest():
    require(isinstance(EXPECTED_DIST, dict) and 2 <= len(EXPECTED_DIST) <= 128,
            'reviewedProductionBuildManifestRequired')
    require('index.html' in EXPECTED_DIST and any(name.endswith('.js') for name in EXPECTED_DIST))
    require(all(re.fullmatch(r'(?:index\.html|assets/[A-Za-z0-9_.-]+\.(?:js|css))', name)
                and re.fullmatch(r'[a-f0-9]{64}', digest) for name, digest in EXPECTED_DIST.items()))
    require(isinstance(EXPECTED_SOURCE_BLOBS, dict) and EXPECTED_SOURCE_BLOBS)
    require(isinstance(PIN.get('reviewedHead'), str) and re.fullmatch(r'[a-f0-9]{40}', PIN['reviewedHead']))
    require(set(EXPECTED_RUNTIME_DOCUMENTS) == set(ASSEMBLIES))
    for name, documents in EXPECTED_RUNTIME_DOCUMENTS.items():
        require(documents and all(path.startswith('src/' + name + '/') and path.endswith('.cs')
                and '..' not in path and re.fullmatch(r'[a-f0-9]{64}', digest)
                for path, digest in documents.items()), 'allRuntimeSourceDocumentsPinned')
    require(all(name.startswith(APP_PATH + 'web/') and '..' not in name
                and re.fullmatch(r'[a-f0-9]{64}', digest) for name, digest in EXPECTED_SOURCE_BLOBS.items()))


def frontend_audit(app, check_expected=True):
    checkpoint('servedFrontendAssets')
    index = run(['docker', 'exec', app, 'cat', '/app/wwwroot/index.html'])
    status, served = get('http://127.0.0.1/indo-shipping/')
    require(status == 200 and served == index, 'servedIndexMatchesActualContainer')
    listed = run(['docker', 'exec', app, 'find', '/app/wwwroot/assets', '-maxdepth', '1',
                  '-type', 'f']).decode().splitlines()
    files = [file for file in listed if file.endswith(('.js', '.css'))]
    require(0 < len(files) < 128 and len(files) == len(set(files)))
    manifest = {'index.html': hashlib.sha256(index).hexdigest()}
    for file in sorted(files):
        require(re.fullmatch(r'/app/wwwroot/assets/[A-Za-z0-9_.-]+\.(?:js|css)', file))
        relative = file[len('/app/wwwroot/'):]
        content = run(['docker', 'exec', app, 'cat', file])
        status, served = get('http://127.0.0.1/indo-shipping/' + relative)
        require(status == 200 and hashlib.sha256(content).digest() == hashlib.sha256(served).digest(),
                'servedAssetMatchesActualContainer')
        manifest[relative] = hashlib.sha256(content).hexdigest()
    require(any(name.endswith('.js') for name in manifest))
    referenced = re.findall(r'(?:src|href)="/indo-shipping/(assets/[A-Za-z0-9_.-]+\.(?:js|css))"', index.decode())
    require(referenced and all(name in manifest for name in referenced), 'indexAssetsPresent')
    if check_expected:
        validate_expected_manifest()
        require(manifest == EXPECTED_DIST, 'allActualAssetsMatchReviewedProductionBuild')
    return {'frontendAssetsMatch': True, 'versionedAssets': len(files),
            'reviewedBuildMatched': check_expected, 'assetHashes': manifest,
            'frontendAssetManifestSha256': hashlib.sha256(json.dumps(manifest, sort_keys=True,
                separators=(',', ':')).encode()).hexdigest()}


def verify():
    directory, before = selected_backup()
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
    artifacts = backend_artifacts(app, check_expected=True)
    backend_binary_same = backend_binding_preserved(before, artifacts)
    configuration_same = runtime['configEnvSha256'] == before['runtime'].get('configEnvSha256')
    configuration_preserved = configuration_same and runtime['mountsSha256'] == before['runtime']['mountsSha256']
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
    require(configuration_preserved, 'runtimeConfigurationPreserved')
    require(nginx_hashes() == before['nginxProtected'], 'actualNginxAndAuthorizationPreserved')
    require(environment_same, 'privateEnvironmentPreserved')
    require(image_changed, 'deployedImageChanged')
    require(scope_same and core_containers() == before['coreContainers'], 'coreContainerScopePreserved')
    require(runtime_config(app) == runtime, 'verificationRuntimeStable')
    deployment_passed = all([precision, schema, schema_same, roles_same, stable, state_same, users_same, table_inventory_same,
                             configuration_preserved, environment_same, image_changed, scope_same])
    result = {'verified': data_same and api_same and deployment_passed,
              'deploymentChecksPassed': deployment_passed,
              'backup': str(directory), 'businessDataUnchanged': data_same,
              'changedTables': changed, 'stateSettingsPreserved': state_same,
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
              'completeContainerEnvironmentIdentical': runtime['completeEnvSha256'] == before['runtime']['completeEnvSha256'],
              'runtimeVersionLabelsOnlyMayDiffer': True, 'databaseOnlyPersistencePreserved': True,
              'actualNginxAndAuthorizationPreserved': True,
              'sourceTreeSha256': source_tree, 'phase': PHASE,
              'actualBackendRuntimeSourceVerified': True, 'frontendOnlyBackendSourcePreserved': True,
              'backendBinaryFingerprintsIdentical': backend_binary_same,
              'actualApiAssemblyChanged': artifacts['IndoShipping.Api']['dllSha256'] != before['backendArtifacts']['IndoShipping.Api']['dllSha256'],
              'backendArtifacts': artifacts,
              'privateEnvironmentPreserved': environment_same, 'deployedImageChanged': image_changed,
              'deployedImageHealthy': runtime['healthy'], 'coreContainersUnchanged': scope_same,
              'businessWritesPerformed': False, 'credentialsChanged': False}
    result.update(frontend_audit(app))
    require(source_commit() == source_commit('origin/main') == TARGET_COMMIT
            and audit() == final and core_containers() == before['coreContainers']
            and runtime_config(app) == runtime and backend_artifacts(app, check_expected=True) == artifacts
            and nginx_hashes() == before['nginxProtected'],
            'finalVerificationWindowStable')
    result['verificationWindowStable'] = True
    return result




def main():
    global PHASE, BEFORE_COMMIT, TARGET_COMMIT, BACKUP_PATH
    mode, PHASE, BEFORE_COMMIT, TARGET_COMMIT, BACKUP_PATH = sys.argv[1:]
    require(mode in ['backup', 'verify'], 'modeValidation')
    require(PHASE == '938', 'phaseValidation')
    require(BEFORE_COMMIT == '499aa8f3fc5e62fee3c6fad7a6bcb7f243b62de8', 'exactReviewedBeforeCommit')
    require(all(re.fullmatch(r'[a-f0-9]{40}', value) for value in [BEFORE_COMMIT, TARGET_COMMIT]),
            'commitValidation')
    if mode == 'backup':
        require(BEFORE_COMMIT == TARGET_COMMIT and not BACKUP_PATH, 'backupArguments')
    else:
        require(BEFORE_COMMIT != TARGET_COMMIT and re.fullmatch(
            r'/opt/rr-portal/deploy/backups/indo-pre-' + PHASE + r'-[0-9]{8}T[0-9]{12}Z', BACKUP_PATH), 'verifyArguments')
    result = backup() if mode == 'backup' else verify()
    if mode == 'verify' and not result['verified']:
        checks = [('businessDataUnchanged', 'businessRowHashesPreserved'),
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
        print(json.dumps({'failed': True, 'safeError': 'INDO_938_OPS_FAILED', 'failedCheck': FAILED_CHECK, 'errorType': error_type}))
        sys.exit(1)
