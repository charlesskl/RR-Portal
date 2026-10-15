"""PR928 private schema backup and strict read-only frontend deployment verification; no business writes."""
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
# Reviewed HEAD 47f2e3163ff1d3f3ee834740b69f023264c15b56; production base /indo-shipping/.
EXPECTED_DIST = {
    "assets/CustomersPage-B8GhV9xG.js": "cf1542268c1a0dd5e2b1f838679647b816e2a27009999d420212f48b3620593d",
    "assets/DbAdminPage-BxLoehvR.js": "77f6505a2f8005843e75047d69f83d74cf839e051223c64409c6eb45458069a2",
    "assets/DictionariesPage-ekWN8Hbw.js": "42ffdc4c767d2c42413af9e2f561c281c9b331ebb01fd0517cfe14824a7ee437",
    "assets/EditOutlined-BdaU1PMD.js": "1aebe4a632a6a02ba1215b2594e829dd6383814aa433a1f2c6eebf6be5a039f5",
    "assets/LoginPage-Cp2xQfnn.js": "65e18bc4f4368407152ec26139d499f55db54e3cbb39044a12bd1defec209541",
    "assets/MaterialAlertsPage-jt-N0PGy.js": "6275c290accbb32ba1b88c3e5a3e27b103c9b239fbd34f53f7fc8492a685683e",
    "assets/MoldingPosPage-Bp8KoRAG.js": "0411294830b00705be66b793a57b92e97bec649829833564ddc36e73b9d2606a",
    "assets/OutboundPage-BQsxaIWx.css": "b4f7372b122d76eebee9521327f40ab96530c2315df0b63ab49a74310fce55a5",
    "assets/OutboundPage-D2Pld4yh.js": "0837c2b61585ff182b1732158c50c91e638ed13b1f234ee9e215913f7477ae60",
    "assets/PlusOutlined-xrv8oXer.js": "56700fac79d25f62a91ed0aba81e1999f7feb89445ef9357259403cb207f5415",
    "assets/ProductsPage-fi56TO6j.js": "76c73f409bd6f62f15e23e73888835a8f4aea1bc95e8c3950bb94ff881f44da2",
    "assets/PurchasePage-B8YonOf3.css": "d2ea560788ecb0057235649740060f8e6fbb0495b65017913d39193397cd3da3",
    "assets/PurchasePage-Gou305kn.js": "73e01d7e9414d01e2baa258bc64876f68ba44af6144cdddb9a64694f2582cc23",
    "assets/QuotesPage-BxAJ2647.js": "af2a764fe009417b1b8f285fc0925acb405f7f8c2e3064ee05fe1bb7038e9bc3",
    "assets/QuotesPage-DDVRdRl_.css": "d9351cb3c2d4e8e5a76d947bf0e9731bac2260fb7b9abe8733daf9b3df4bbcbd",
    "assets/ReloadOutlined-T1Ov1Zr2.js": "cb4e4672e2c4e47b8724560cab2c26fe04c7cc1bd51dd921f09be2a0f2151d30",
    "assets/SchedulesPage-C3vpMXxe.js": "cc3b04d764077c51495b498d49eed1326c2fffb96fb7c458c490b5e8affcd912",
    "assets/ShipmentsPage-DMt5tysh.js": "7a1816ed240ef785b789a19ff04c36e8d24c6132dfe930b9790c7011905d029c",
    "assets/ShipmentsPage-zTLU3P3Y.css": "0eaa5eb65a005292affa5606b4bff7c26f06e845f1087e14d539892da535504d",
    "assets/SupplierProfileEditor-hBENEzI0.js": "f20b7418bdab0eb086f20489891c5b5cb8da21f0a98a2e1f1b50762f59715533",
    "assets/SupplierSummaryPage-M0xbDq-X.js": "7ff4e62fd170886370c7192be06d4dd2d0250687825dd510ddd0bf11df90bc6a",
    "assets/ToolMaterialsPage-Be4qJ3LV.js": "5dca96bd1d58df4307feaffb051a5e56208f86c903b4ebffd1268639c9806c2b",
    "assets/UsersPage-2ktopxfE.js": "fa31b483d98ea958d223f01284decf7feb90c371cf471c53641edbd8ca1f7111",
    "assets/auto-complete-OBX4jwDS.js": "7d27d675eaf3c63d4cb8a0f9a76075b921db35508c6a269f2f5abcc1d77939d3",
    "assets/chunk-BVpWp9h4.js": "d68000f91e617e39707775fbbf502ae057f963da84e1d06dd6129df60614fb8a",
    "assets/client-S6mPGKVM.js": "0619bdac1ca199b0cd07d9d54bd7a4c7e2320ac4fd6e6db5fe8a413b8c02838a",
    "assets/customsExport-CGkYNpZH.js": "097ae9d692e3c1272b46dbc0eb5f451d8f58c2c073219dd1ba0a377577ffa50f",
    "assets/date-picker-DFgTm1-c.js": "1216812a9e02428ffe88079e82614553719276e7bb1fbb98422760a8cb7484e4",
    "assets/engineeringImport-F6BX9lSV.js": "9838e099590fa89f8cdd53f115ac5149b6ac34f8524129458338fb2952aa6c73",
    "assets/form-BEFj0fzJ.js": "62c2a26d409e67cf465239485418523fd8fb804cf0a746821abb93d65e0c8c5c",
    "assets/imageUpload-DgJ9GzqX.js": "2ae7e23008960198e74d812c83429f8845cc5a7fe0e509b9cf5248c9244f35fb",
    "assets/index-B_GhPNIf.js": "b8a99652ff0f9d054ebbfced512566dfd65b640fc9ef7d812107a40f8abb57e8",
    "assets/index-Tu04tXLf.css": "52155b5185a7b6e40e4220a5ca913de309663c04263c268cdb46d630b2114f06",
    "assets/input-CXl0CrxM.js": "25e158d41520991da9483332d71a6d82274b492b067cb61ae6e8b1db4ddc4e49",
    "assets/input-number-CC_vC4xv.js": "dd27ed0a354695df30ee6c95c3424f57cb580eccfb0e4a58c054478e93a57756",
    "assets/jsx-runtime-CPIq3nuo.js": "d2ea580ed7e6f97b65ce1f80560677bfcbab839e64ddeed93044accd603de09a",
    "assets/modal-BoezGB0B.js": "05b1bf557975324f72172a832b885aaf7632d6c113233b30a2825be06c229df6",
    "assets/moldingPoExport-DskrH8Av.js": "94274fed5b9e9e6d8fe02791d57b282eb4f5939b44221055c93261901164bdc5",
    "assets/pagination-LhGL_5kc.js": "2282ab0540887d8564f54ab3dc0ebbb2a071fa58a9fa22037b8e0ef4dd6a68e9",
    "assets/popconfirm-Dd61sGzg.js": "116864a16cec3141cbc4e4f6090390712a592f525d7e12ecd42995297d0b5a05",
    "assets/progress-CJwc4b9M.js": "8d31d7000dc848498c19bfaff18d76702f007d327b1b8f789f61dc687dd66bd1",
    "assets/row-BlZvG0y0.js": "16246c0249d10294578edadbb1e7b537b27329f0afe5c2e94c4a7cc70a9749db",
    "assets/row-TerzTg4K.js": "4a38a640a311dd72140b2508af62cddf1ecc83c3a945d4e63d367e324ef7b4fd",
    "assets/shipmentWeight-CUOe8BXB.js": "de027d9c28aed150012f8a1a191b0396cb4766e2205ee5f8a4157dd0de085ded",
    "assets/spin-N1N-gDTY.js": "59c0d5f6333af35f664aa80a2c951afad3984b62bc70dd6a5d035782ad49a310",
    "assets/supplierProfiles-gKS5qAu8.js": "5fdf83c169edf865855f04fcec066b4d1f5d412cf9326a3a9a16d3cb880ebbee",
    "assets/switch-cHCC8vmb.js": "5cce03714ee315742df2528ff937536851f8738e464718d27f6ff50de5cb1e2a",
    "assets/table-Ccsta54F.js": "fe14daf31eeaac7404988f9b7befcf85e5e872fe52b029c36ca5961ee5f88d68",
    "assets/toolImportDefaults-CZel7gHV.js": "29112747349510ba947d78a6451354657a2d721cfdf0a261ee38e4c3ff751e22",
    "assets/useForm-Bk0qN2Jh.js": "2f3fb45e485cbad0abb2b386f35134e59744d63fc7f7153abf809283ac2dfc56",
    "assets/xlsx-CGtpuIau.js": "768312094736c47185e84a085235cff804c378eba126a425fa5153e221e78e5d",
    "assets/xlsx.min-DqAMbf-a.js": "e2c2a477cfde2c9a1301515a0e1b73b28f2f70ddeaf262042e24ef4292d1f275",
    "index.html": "13bed08036709883a1e0ede6301cdd98c7ebf7a8cba804138ff31f9427ca506d"
}
EXPECTED_SOURCE_BLOBS = {
    "apps/印尼小组/印尼走货明细/web/src/pages/ProductsPage.tsx": "3fa18c74d28d38a9bfe4b2573bfd6269312444c015e91a2ab07b4ba1b4a059cd",
    "apps/印尼小组/印尼走货明细/web/src/utils/moldingImportMerge.test.ts": "fa1372f204862d3c4e1b4064719aa9f9e3bdb13947c47b85525bf45295bb387b",
    "apps/印尼小组/印尼走货明细/web/src/utils/moldingImportMerge.ts": "0722199c289b3c0c305879e283cb9d5ed2b746db21472bb2b5ffbc6f087da090"
}
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
        raise RuntimeError('INDO_928_OPS_FAILED')


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
    # This PR changes only frontend code. Refuse known pending startup backfills
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
                'deploymentDiffOnlyIndoFrontend')
        run(['git', 'merge-base', '--is-ancestor', BEFORE_COMMIT, commit])
        validate_expected_manifest()
        require(set(changed) == set(EXPECTED_SOURCE_BLOBS), 'exactReviewedChangeInventory')
        for path, expected in EXPECTED_SOURCE_BLOBS.items():
            require(hashlib.sha256(run(['git', 'show', commit + ':' + path])).hexdigest() == expected,
                    'exactReviewedSourceBlobs')
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
    products = get_json(base, '/api/products', token)
    require(isinstance(products, list))
    molding_blob = get_json(base, '/api/molding-pos/blob', token)
    result = {'productsDigest': digest_rows(products), 'moldingBlobDigest': digest_rows([molding_blob]),
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
    require(runtime_config(app) == runtime, 'baselineRuntimeStable')
    require(core_containers() == scope, 'baselineCoreScopeStable')
    require(nginx_hashes() == nginx_baseline, 'baselineNginxStable')
    require(file_hash(private_env_file()) == file_hash(environment_backup), 'baselineEnvironmentStable')
    require(source_commit() == source_commit('origin/main') == before_commit,
            'baselineSourceStable')
    baseline.update({'schema': 'indo_shipping', 'sourceCommit': before_commit,
                     'consistentExportedSnapshot': True, 'digestMethod': 'sha256-sorted-full-row-multiset',
                     'deploymentLabel': 'PR' + PHASE, 'runtime': runtime, 'coreContainers': scope,
                     'nginxProtected': nginx_baseline, 'frontend': frontend,
                     'roles': roles, 'roleIdentities': identities, 'startupBusinessWritesGuardPassed': True,
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
              'privateEnvironmentPreserved': environment_same, 'deployedImageChanged': image_changed,
              'deployedImageHealthy': runtime['healthy'], 'coreContainersUnchanged': scope_same,
              'businessWritesPerformed': False, 'credentialsChanged': False}
    result.update(frontend_audit(app))
    require(source_commit() == source_commit('origin/main') == TARGET_COMMIT
            and audit() == final and core_containers() == before['coreContainers']
            and runtime_config(app) == runtime and nginx_hashes() == before['nginxProtected'],
            'finalVerificationWindowStable')
    result['verificationWindowStable'] = True
    return result




def main():
    global PHASE, BEFORE_COMMIT, TARGET_COMMIT, BACKUP_PATH
    mode, PHASE, BEFORE_COMMIT, TARGET_COMMIT, BACKUP_PATH = sys.argv[1:]
    require(mode in ['backup', 'verify'], 'modeValidation')
    require(PHASE == '928', 'phaseValidation')
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
        print(json.dumps({'failed': True, 'safeError': 'INDO_928_OPS_FAILED', 'failedCheck': FAILED_CHECK, 'errorType': error_type}))
        sys.exit(1)
