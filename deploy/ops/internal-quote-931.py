"""Private PR931 backup and read-only verification. Never print rows, cookies or secrets."""
import datetime
import decimal
import hashlib
import io
import ipaddress
import json
import os
import pathlib
import re
import select
import stat
import subprocess
import sys
import tarfile
import urllib.error
import urllib.parse
import urllib.request

ROOT = pathlib.Path('/opt/rr-portal')
APP_ROOT = ROOT / 'apps/业务部/内部报价系统'
UPLOAD_ROOT = APP_ROOT / 'backend/uploads'
BACKUPS = ROOT / 'deploy/backups'
COMPOSE = ['docker', 'compose', '-f', 'docker-compose.cloud.yml', '--env-file', '.env.cloud.production']
PG_SHELL = 'exec psql -X -q -At -v ON_ERROR_STOP=1 -U "${POSTGRES_USER:-rrportal}" -d "${POSTGRES_DB:-rrportal}"'
REQUIRED_TABLES = {'factories','departments','quotes','quote_sections','quote_customer_confirmations',
                   'audit_log','ref_tables','app_migrations','factory_ref_tables','users',
                   'user_factories','user_customers','user_perms','factory_material_price_control',
                   'factory_material_price_managers','quote_verifications','quote_verification_versions',
                   'quote_verification_sections'}
PERMISSION_TABLES = ['user_perms','user_customers','user_factories','factories','departments',
                     'factory_material_price_control','factory_material_price_managers']
TABLE_SQL = "SELECT COALESCE(json_agg(table_name ORDER BY table_name),'[]') FROM information_schema.tables WHERE table_schema='internal_quote' AND table_type='BASE TABLE';\n"
CORE_SERVICES = ['nginx','core','db','redis','printlink']
PRE_DEPLOY_COMMIT = '3a3704582279f3bbfe2356a313bfda2165f9da65'
TARGET_COMMIT = None
BACKUP_PATH = None
TESTED_SOURCE = {'reviewedHead': None, 'files': {}}
APP_PREFIX = 'apps/业务部/内部报价系统/'
LEGACY_ROOT = APP_ROOT / 'backend/data'
VERSION_KEYS = {'NODE_VERSION', 'YARN_VERSION'}
FAILED_CHECK = 'entrypoint'
MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024
MAX_UPLOAD_FILES = 20000
MAX_UPLOAD_FILE_BYTES = 64 * 1024 * 1024
CONFIG_FILES = ['docker-compose.cloud.yml', 'apps/业务部/内部报价系统/Dockerfile',
                'apps/业务部/内部报价系统/backend/server.js',
                'apps/业务部/内部报价系统/backend/db/index.js',
                'apps/业务部/内部报价系统/backend/db/postgres.js',
                'apps/业务部/内部报价系统/backend/db/schema.postgres.sql',
                'apps/业务部/内部报价系统/backend/db/accountSeed.js',
                'apps/业务部/内部报价系统/backend/db/account-seed.csv',
                'apps/业务部/内部报价系统/backend/middleware/auth.js',
                'apps/业务部/内部报价系统/backend/middleware/perms.js']

def checkpoint(label):
    global FAILED_CHECK
    FAILED_CHECK = label


def require(condition, label=None):
    if not condition:
        if label:
            checkpoint(label)
        raise RuntimeError('IQ_931_OPS_FAILED')


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
        digest = "encode(sha256(convert_to(COALESCE(string_agg(row_hash,'' ORDER BY row_hash),''),'UTF8')),'hex')"
        parts += ["'" + table + "'", "(SELECT jsonb_build_object('rows',COUNT(*),'sha256'," + digest + ") FROM (SELECT encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex') AS row_hash FROM internal_quote.\"" + table + "\" r) hashes)"]
    identity_hash = "encode(sha256(convert_to(COALESCE(string_agg(row_hash,'' ORDER BY row_hash),''),'UTF8')),'hex')"
    # Successful login updates last_login/login_fails. All other user fields,
    # including role, password hash, lock and default factory, remain protected.
    return "SELECT jsonb_build_object('tables',jsonb_build_object(%s),'userIdentitySha256'," \
        "(SELECT %s FROM (SELECT encode(sha256(convert_to((to_jsonb(u)-'last_login'-'login_fails')::text,'UTF8')),'hex') AS row_hash FROM internal_quote.users u) hashes)," \
        "'startupChecks',(%s));\n" % (','.join(parts), identity_hash, startup_checks_sql())


def startup_checks_sql():
    # Exact logical row effects of the pre-deploy initialize() source. Existing
    # ON CONFLICT upserts can still issue physical writes / advance sequences;
    # this guard proves they will not add, remove or change business row values.
    return """SELECT jsonb_build_object(
      'expiredRecycleQuotes',(SELECT COUNT(*) FROM internal_quote.quotes
        WHERE deleted_at IS NOT NULL AND deleted_at<CURRENT_TIMESTAMP-INTERVAL '30 days'),
      'existingUsersPreventSeedAndLegacyMigration',EXISTS(SELECT 1 FROM internal_quote.users),
      'configuredAccountSeedApplied',EXISTS(SELECT 1 FROM internal_quote.app_migrations
        WHERE key='configured_accounts_20260831_v1'),
      'qingxiMaterialPriceMigrationApplied',EXISTS(SELECT 1 FROM internal_quote.app_migrations
        WHERE key='qingxi_material_prices_20260819'),
      'heyuanRetirementMigrationApplied',EXISTS(SELECT 1 FROM internal_quote.app_migrations
        WHERE key='retire_heyuan_factory_20260819'),
      'knownFactoriesWouldChange',(SELECT COUNT(*) FROM
        (VALUES ('qingxi','清溪',1,1),('heyuan','河源',2,0)) e(code,name_cn,sort_order,active)
        LEFT JOIN internal_quote.factories f ON f.code=e.code
        WHERE f.code IS NULL OR (f.name_cn,f.sort_order,f.active)
          IS DISTINCT FROM (e.name_cn,e.sort_order,e.active)),
      'knownDepartmentsWouldChange',(SELECT COUNT(*) FROM
        (VALUES ('sales','业务',1),('engineering','工程/业务',2),('electronic','电子部',3),
          ('molding','啤机部',4),('painting','喷油部',5),('slush','搪胶',6),
          ('sewing','车缝',7),('assembly','装配部',8)) e(code,name_cn,sort_order)
        LEFT JOIN internal_quote.departments d ON d.code=e.code
        WHERE d.code IS NULL OR (d.name_cn,d.sort_order) IS DISTINCT FROM (e.name_cn,e.sort_order)),
      'missingQuoteSections',(SELECT COUNT(*) FROM internal_quote.quotes q
        CROSS JOIN internal_quote.departments d WHERE NOT EXISTS (
          SELECT 1 FROM internal_quote.quote_sections s WHERE s.quote_id=q.id AND s.dept=d.code)),
      'missingDefaultUserFactoryScope',(SELECT COUNT(*) FROM internal_quote.users u
        WHERE NOT EXISTS (SELECT 1 FROM internal_quote.user_factories uf
          WHERE uf.user_id=u.id AND uf.factory_code=u.factory_code)),
      'missingGlobalReferenceTables',(SELECT COUNT(*) FROM
        (VALUES ('material_prices'),('machine_prices')) e(key)
        WHERE NOT EXISTS (SELECT 1 FROM internal_quote.ref_tables r WHERE r.key=e.key)),
      'missingFactoryReferenceTables',(SELECT COUNT(*) FROM
        (VALUES ('qingxi'),('heyuan')) f(code)
        CROSS JOIN (VALUES ('material_prices'),('machine_prices')) e(key)
        WHERE NOT EXISTS (SELECT 1 FROM internal_quote.factory_ref_tables r
          WHERE r.factory_code=f.code AND r.key=e.key)),
      'missingMaterialPriceManagerLinks',(SELECT COUNT(*) FROM internal_quote.factory_material_price_control c
        WHERE c.manager_user_id IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM internal_quote.factory_material_price_managers m
          WHERE m.factory_code=c.factory_code AND m.user_id=c.manager_user_id)))"""


def startup_safety_checks(checks):
    counts = ['expiredRecycleQuotes','knownFactoriesWouldChange','knownDepartmentsWouldChange',
              'missingQuoteSections','missingDefaultUserFactoryScope','missingGlobalReferenceTables',
              'missingFactoryReferenceTables','missingMaterialPriceManagerLinks']
    markers = ['existingUsersPreventSeedAndLegacyMigration','configuredAccountSeedApplied','qingxiMaterialPriceMigrationApplied','heyuanRetirementMigrationApplied']
    require(isinstance(checks,dict) and set(checks) == set(counts + markers), 'startupSafetyCheckInventory')
    require(all(type(checks[key]) is int and checks[key] >= 0 for key in counts)
            and all(type(checks[key]) is bool for key in markers), 'startupSafetyCheckTypes')
    return [(checks[key] == 0,'startupWouldChange:' + key) for key in counts] + \
        [(checks[key] is True,'startupMigrationNotApplied:' + key) for key in markers]


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


def inspect(identifier):
    return json.loads(run(['docker','inspect',identifier]))[0]


def digest(value):
    return hashlib.sha256(json.dumps(value,ensure_ascii=True,sort_keys=True,separators=(',',':')).encode()).hexdigest()


def protected_environment(value, image, process=False, hostname=None):
    require(isinstance(value,list) and all(isinstance(item,str) and '=' in item for item in value), 'environmentShape')
    environment = dict(item.split('=',1) for item in value)
    require(len(environment) == len(value), 'uniqueEnvironmentKeys')
    versions = {}
    for key in VERSION_KEYS:
        require(environment.get(key) == image.get(key), 'publicVersionInheritedFromActualImage')
        if key in environment:
            pattern = r'22\.[0-9]+\.[0-9]+' if key == 'NODE_VERSION' else r'1\.[0-9]+\.[0-9]+'
            require(bool(re.fullmatch(pattern, environment[key])), 'publicVersionWithinPinnedBaseImageMajor')
            versions[key] = environment[key]
    if process:
        require(environment.get('HOSTNAME') == hostname, 'actualProcessAutomaticHostname')
    protected = {key:val for key,val in environment.items() if key not in VERSION_KEYS and not (process and key == 'HOSTNAME')}
    return digest(sorted(value)), digest(protected), versions


def runtime_config(app):
    checkpoint('runtimeConfiguration')
    value = inspect(app)
    state = value.get('State',{})
    require(state.get('Running') is True and state.get('OOMKilled') is False and state.get('Health',{}).get('Status') == 'healthy', 'runtimeContainerHealthy')
    image_id = value.get('Image')
    require(bool(re.fullmatch(r'sha256:[a-f0-9]{64}',image_id or '')), 'actualImageIdentifier')
    image = inspect(image_id)
    image_env = dict(item.split('=',1) for item in image['Config']['Env'])
    complete, protected, versions = protected_environment(value['Config']['Env'],image_env)
    require(value['Config'].get('Hostname') == app[:12], 'automaticContainerHostname')
    script = "const fs=require('node:fs');const e=fs.readFileSync('/proc/1/environ','utf8').split('\\0').filter(Boolean);process.stdout.write(JSON.stringify(e));"
    process_env = json.loads(run(['docker','exec',app,'node','-e',script]))
    proc_complete, proc_protected, proc_versions = protected_environment(process_env,image_env,True,app[:12])
    require(proc_versions == versions, 'processImageVersionAgreement')
    mounts = sorted([{'type':m.get('Type'),'source':m.get('Source'),'destination':m.get('Destination'),'rw':m.get('RW')} for m in value['Mounts']],key=lambda m:m['destination'])
    return {'configEnvSha256':complete,'protectedEnvSha256':protected,'publicVersionMetadata':versions,
            'processCompleteEnvSha256':proc_complete,'processProtectedEnvSha256':proc_protected,
            'imageId':image_id,'healthy':True,'mounts':mounts,'containerId':app,
            'startedAt':state['StartedAt'],'restartCount':value['RestartCount']}


def core_containers():
    checkpoint('fiveCoreFreshLifecycle')
    result = {}
    for service in CORE_SERVICES:
        identifier = cid(service)
        value = inspect(identifier)
        state = value.get('State',{})
        require(state.get('Running') is True and state.get('OOMKilled') is False, 'coreRunningWithoutOom')
        if state.get('Health') is not None:
            require(state['Health']['Status'] == 'healthy', 'coreHealthy')
        result[service] = {'containerId':identifier,'startedAt':state['StartedAt'],
                           'restartCount':value['RestartCount'],'healthy':True}
    return result


def nginx_protected():
    checkpoint('actualNginxAndAuthorization')
    app = cid('nginx')
    return {key:hashlib.sha256(run(['docker','exec',app,'cat',path])).hexdigest() for key,path in
            [('actualConfig','/etc/nginx/nginx.conf'),('actualAuthorization','/etc/nginx/.htpasswd')]}


def private_env_file():
    checkpoint('privateEnvironmentFile')
    file = ROOT / '.env.cloud.production'
    require(file.is_file() and not file.is_symlink())
    return file


def configuration_files():
    checkpoint('unchangedApplicationAndDeploymentConfiguration')
    return {name:file_hash(ROOT / name) for name in CONFIG_FILES}


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


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, response, code, message, headers, new_url):
        return None


HTTP = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())


def get(url, cookie=None):
    # Fixed local URLs only. Cookie headers never follow redirects or reach logs.
    parts = urllib.parse.urlsplit(url)
    try:
        address = ipaddress.ip_address(parts.hostname)
    except ValueError:
        require(False, 'localReadOnlyHttpTarget')
    require(parts.scheme == 'http' and address.version == 4 and (address.is_private or address.is_loopback)
            and parts.username is None and parts.password is None and not parts.fragment, 'localReadOnlyHttpTarget')
    headers = {'Cookie': cookie} if cookie else {}
    try:
        with HTTP.open(urllib.request.Request(url, headers=headers), timeout=60) as response:
            data = response.read(64 * 1024 * 1024 + 1)
            require(len(data) <= 64 * 1024 * 1024, 'readResponseSizeLimit')
            return response.status, data
    except urllib.error.HTTPError as error:
        return error.code, b''


def get_json(base, path, cookie):
    allowed = {'/api/auth/me', '/api/quotes', '/api/quotes/customers', '/api/admin/users',
               '/api/quote-summary', '/api/quote-summary/completion'}
    # In particular, GET /api/quotes/:id writes a view audit and is excluded.
    require(path in allowed, 'readOnlyApiAllowlist')
    status, body = get(base + path, cookie)
    require(status == 200, 'authenticatedReadApiStatus')
    return json.loads(body, parse_float=decimal.Decimal)


def app_context():
    app = cid('internal-quote')
    networks = json.loads(run(['docker', 'inspect', '-f', '{{json .NetworkSettings.Networks}}', app]))
    ip = next((entry.get('IPAddress') for entry in networks.values() if entry.get('IPAddress')), None)
    require(bool(ip) and ipaddress.ip_address(ip).is_private and ipaddress.ip_address(ip).version == 4)
    environment = json.loads(run(['docker', 'inspect', '-f', '{{json .Config.Env}}', app]))
    require(isinstance(environment, list) and all(isinstance(item, str) and '=' in item for item in environment))
    env = dict(item.split('=', 1) for item in environment)
    require(len(env) == len(environment), 'uniqueContainerEnvironmentKeys')
    require(env.get('DB_SCHEMA') == 'internal_quote' and env.get('DATABASE_URL', '').startswith(('postgres://','postgresql://'))
            and env.get('DB_DRIVER') != 'sqlite' and env.get('SESSION_SECRET'), 'postgresAndSessionConfigured')
    del environment, env
    # Ensure the persistent upload source really is the expected bind directory.
    mounts = json.loads(run(['docker', 'inspect', '-f', '{{json .Mounts}}', app]))
    uploads = [m for m in mounts if m.get('Destination') == '/app/backend/uploads']
    require(len(uploads) == 1 and uploads[0].get('Type') == 'bind'
            and uploads[0].get('Source') == str(UPLOAD_ROOT), 'persistentUploadBindMount')
    legacy = [m for m in mounts if m.get('Destination') == '/app/backend/legacy-data']
    require(len(legacy) == 1 and legacy[0].get('Type') == 'bind'
            and legacy[0].get('Source') == str(APP_ROOT / 'backend/data')
            and legacy[0].get('RW') is False, 'readOnlyLegacySqliteBindMount')
    run(['docker','exec',app,'test','!','-e','/app/.env'])
    return app, 'http://' + ip + ':3211'


def probe_account(admin=True):
    checkpoint('existingAuthorizedProbeAccount')
    if admin:
        condition = "u.role='admin' AND EXISTS (SELECT 1 FROM internal_quote.user_perms p WHERE p.user_id=u.id AND p.menu='账号管理' AND p.can_admin=1)"
    else:
        condition = "u.role<>'admin' AND NOT EXISTS (SELECT 1 FROM internal_quote.user_perms p WHERE p.user_id=u.id AND p.menu='账号管理' AND p.can_admin=1)"
    query = """BEGIN READ ONLY;
      SELECT jsonb_build_object('user_id',u.id,'factory_code',f.code)
      FROM internal_quote.users u JOIN internal_quote.factories f ON f.code=u.factory_code AND f.active=1
      WHERE (u.locked_until IS NULL OR u.locked_until<=CURRENT_TIMESTAMP)
        AND EXISTS (SELECT 1 FROM internal_quote.user_factories uf WHERE uf.user_id=u.id AND uf.factory_code=f.code)
        AND %s ORDER BY u.id LIMIT 1; COMMIT;
      """ % condition
    output = run(sql_command(), query.encode()).decode().strip()
    if not output and not admin:
        return None
    value = json.loads(output)
    require(isinstance(value.get('user_id'), int) and value['user_id'] > 0
            and isinstance(value.get('factory_code'), str)
            and re.fullmatch('[a-z_][a-z0-9_]{0,40}', value['factory_code']))
    return value


def read_cookie(app, account):
    checkpoint('inMemorySignedCookie')
    # Use the installed cookie-session dependency's actual Keygrip signing engine.
    # SESSION_SECRET remains inside the container; only the cookie is captured in
    # this private process and then discarded. There is no login or DB session row.
    # cookie-session has no server-enforced TTL; never claim this cookie expires.
    script = """const fs=require('node:fs');const Keygrip=require('keygrip');
      const value=JSON.parse(fs.readFileSync(0,'utf8'));
      if(!process.env.SESSION_SECRET||!Number.isInteger(value.user_id)||typeof value.factory_code!=='string')process.exit(1);
      const encoded=Buffer.from(JSON.stringify(value)).toString('base64');
      const signature=new Keygrip([process.env.SESSION_SECRET]).sign('iq_sess='+encoded);
      process.stdout.write('iq_sess='+encoded+'; iq_sess.sig='+signature);"""
    cookie = run(['docker','exec','-i',app,'node','-e',script],
                 json.dumps(account, separators=(',', ':')).encode()).decode()
    require(len(cookie) < 1024 and re.fullmatch(r'iq_sess=[A-Za-z0-9+/=]+; iq_sess.sig=[A-Za-z0-9_-]+', cookie))
    return cookie


def api_audit(app, base, features=False):
    account = probe_account()
    cookie = read_cookie(app, account)
    try:
        me = get_json(base, '/api/auth/me', cookie)
        require(me.get('id') == account['user_id'] and me.get('role') == 'admin'
                and me.get('active_factory_code') == account['factory_code']
                and me.get('perms', {}).get('账号管理', {}).get('can_admin'), 'actualAdminPermissions')
        quotes = get_json(base, '/api/quotes', cookie)
        customers = get_json(base, '/api/quotes/customers', cookie)
        users = get_json(base, '/api/admin/users', cookie)
        require(isinstance(quotes, list) and isinstance(customers.get('customers'), list) and isinstance(users, list))
        require(all(row.get('factory_code') == account['factory_code'] for row in quotes), 'adminFactoryIsolation')
        result = {'quotes': len(quotes), 'users': len(users), 'quoteListDigest': digest_rows(quotes),
                  'customerListDigest': digest_rows(customers['customers']), 'identityDigest': digest_rows([me]),
                  'adminReadsVerified': True}
        if features:
            summary = get_json(base, '/api/quote-summary', cookie)
            completion = get_json(base, '/api/quote-summary/completion', cookie)
            require(isinstance(summary.get('rows'), list) and isinstance(summary.get('summary_columns'), list)
                    and isinstance(completion, dict), 'summaryReadApis')
            require(all('share_amounts' in col for col in summary['summary_columns'])
                    and any(col.get('share_amounts') for col in summary['summary_columns']), 'summaryShareMetadata')
            result['summaryShareMetadataVerified'] = True
            result['summaryReadApisVerified'] = True
    finally:
        del cookie
    staff = probe_account(admin=False)
    if staff is not None:
        cookie = read_cookie(app, staff)
        try:
            require(get(base + '/api/admin/users', cookie)[0] == 403, 'staffAdminAccessDenied')
            require(get(base + '/api/quote-summary/completion', cookie)[0] == 403, 'staffCompletionAccessDenied')
            me = get_json(base, '/api/auth/me', cookie)
            require(me.get('id') == staff['user_id'] and me.get('active_factory_code') == staff['factory_code'], 'staffIdentityPreserved')
            status, content = get(base + '/api/quotes', cookie)
            allowed = run(sql_command(), ("BEGIN READ ONLY; SELECT COALESCE(json_agg(q.id ORDER BY q.id),'[]') FROM internal_quote.quotes q WHERE q.factory_code='%s' AND q.deleted_at IS NULL AND q.customer IN (SELECT customer FROM internal_quote.user_customers WHERE user_id=%d); COMMIT;" % (staff['factory_code'], staff['user_id'])).encode())
            allowed_ids = json.loads(allowed)
            if status == 200:
                rows = json.loads(content, parse_float=decimal.Decimal)
                require(isinstance(rows, list) and sorted(row['id'] for row in rows) == allowed_ids
                        and all(row.get('factory_code') == staff['factory_code'] for row in rows), 'staffCustomerAndFactoryIsolation')
            else:
                require(status == 403 and not allowed_ids, 'staffNoCustomerAuthorization')
            result['existingStaffIsolationVerified'] = True
        finally:
            del cookie
    else:
        result['existingStaffIsolationVerified'] = None
    return result


def upload_inventory(archive=None, tree=None):
    tree = UPLOAD_ROOT if tree is None else tree
    checkpoint('privateUploadInventory')
    require(tree.is_dir() and not tree.is_symlink(), 'uploadRootDirectory')
    paths = []
    for directory, dirs, files in os.walk(tree, followlinks=False):
        root = pathlib.Path(directory)
        require(not root.is_symlink() and all(not (root / name).is_symlink() for name in dirs), 'uploadNoSymlinkDirectories')
        for name in files:
            file = root / name
            require(file.is_file() and not file.is_symlink(), 'uploadRegularFilesOnly')
            paths.append(file)
    paths.sort()
    require(len(paths) <= MAX_UPLOAD_FILES, 'uploadFileCountLimit')
    rows, total = [], 0
    tar = tarfile.open(archive, 'x') if archive else None
    try:
        for file in paths:
            fd = os.open(file, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
            with os.fdopen(fd, 'rb') as source:
                before = os.fstat(source.fileno())
                require(stat.S_ISREG(before.st_mode), 'uploadRegularFile')
                require(0 <= before.st_size <= MAX_UPLOAD_FILE_BYTES, 'uploadSingleFileSizeLimit')
                total += before.st_size
                require(total <= MAX_UPLOAD_BYTES, 'uploadTotalSizeLimit')
                content = source.read(before.st_size + 1)
                after = os.fstat(source.fileno())
                require(len(content) == before.st_size and (before.st_ino,before.st_size,before.st_mtime_ns)
                        == (after.st_ino,after.st_size,after.st_mtime_ns), 'uploadFileStable')
            relative = str(file.relative_to(tree))
            rows.append({'path':relative,'bytes':len(content),'sha256':hashlib.sha256(content).hexdigest()})
            if tar:
                info = tarfile.TarInfo(relative)
                info.size, info.mode, info.mtime = len(content), stat.S_IMODE(before.st_mode), int(before.st_mtime)
                tar.addfile(info, io.BytesIO(content))
        return {'files':len(rows),'bytes':total,'sha256':digest_rows(rows)}
    finally:
        if tar:
            tar.close()
            pathlib.Path(archive).chmod(0o600)


def validate_upload_archive(archive, expected):
    checkpoint('privateUploadArchiveValidation')
    rows, total = [], 0
    with tarfile.open(archive, 'r') as tar:
        members = tar.getmembers()
        require(len(members) == expected['files'] and len(members) <= MAX_UPLOAD_FILES)
        for info in members:
            path = pathlib.PurePosixPath(info.name)
            require(info.isfile() and not path.is_absolute() and '..' not in path.parts)
            total += info.size
            require(total <= MAX_UPLOAD_BYTES and 0 <= info.size <= MAX_UPLOAD_FILE_BYTES)
            with tar.extractfile(info) as stream:
                content = stream.read(info.size + 1)
            require(len(content) == info.size)
            rows.append({'path':info.name,'bytes':len(content),'sha256':hashlib.sha256(content).hexdigest()})
    require({'files':len(rows),'bytes':total,'sha256':digest_rows(rows)} == expected)


def backup():
    checkpoint('backupDirectory')
    os.umask(0o077)
    before_commit = source_commit()
    require(before_commit == source_commit('origin/main') == PRE_DEPLOY_COMMIT, 'backupSourceMatchesPreDeployMain')
    BACKUPS.mkdir(parents=True, exist_ok=True)
    require(not BACKUPS.is_symlink())
    directory = BACKUPS / ('internal-quote-pre-931-' + datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ'))
    directory.mkdir(mode=0o700)
    app, base = app_context()
    runtime, scope = runtime_config(app), core_containers()
    nginx = nginx_protected()
    source_runtime_files(app, before_commit)
    file_config = configuration_files()
    checkpoint('privateEnvironmentBackup')
    environment_backup = directory / 'env.before'
    with private_env_file().open('rb') as source, environment_backup.open('xb') as target:
        for block in iter(lambda:source.read(1024 * 1024), b''):
            target.write(block)
    environment_backup.chmod(0o600)
    dump = directory / 'internal_quote.dump'
    checkpoint('exportedDatabaseSnapshot')
    process = subprocess.Popen(sql_command(), stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                               stderr=subprocess.PIPE, cwd=ROOT, bufsize=0)
    try:
        process.stdin.write(b'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;\nSELECT pg_export_snapshot();\n'); process.stdin.flush()
        snapshot = read_line(process).decode()
        require(bool(re.fullmatch(r'[0-9A-Fa-f]+-[0-9A-Fa-f]+-[0-9]+',snapshot)))
        process.stdin.write(TABLE_SQL.encode()); process.stdin.flush()
        tables = table_names(json.loads(read_line(process)))
        process.stdin.write(audit_sql(tables).encode()); process.stdin.flush()
        baseline = json.loads(read_line(process))
        checkpoint('privateSchemaDump')
        args = ['docker','exec',cid('db'),'sh','-c',
                'exec pg_dump -Fc --schema=internal_quote --snapshot="$1" -U "${POSTGRES_USER:-rrportal}" -d "${POSTGRES_DB:-rrportal}"', 'pg_dump',snapshot]
        with dump.open('xb') as output:
            dumped = subprocess.run(args,stdout=output,stderr=subprocess.PIPE,cwd=ROOT,timeout=300)
        require(dumped.returncode == 0 and dump.stat().st_size > 0)
        checkpoint('privateArchiveValidation')
        with dump.open('rb') as stream:
            checked = subprocess.run(['docker','exec','-i',cid('db'),'pg_restore','--list'],stdin=stream,
                                     stdout=subprocess.DEVNULL,stderr=subprocess.PIPE,cwd=ROOT,timeout=180)
        require(checked.returncode == 0)
        finish_snapshot(process)
    finally:
        close_snapshot(process)
    baseline['api'] = api_audit(app,base)
    baseline['uploads'] = upload_inventory(directory / 'uploads.tar')
    baseline['legacy'] = upload_inventory(directory / 'legacy-data.tar', LEGACY_ROOT)
    validate_upload_archive(directory / 'uploads.tar', baseline['uploads'])
    validate_upload_archive(directory / 'legacy-data.tar', baseline['legacy'])
    require(audit() == {k:v for k,v in baseline.items() if k not in {'api','uploads','legacy'}}, 'baselineDatabaseStable')
    require(upload_inventory() == baseline['uploads'], 'baselineUploadsStable')
    require(upload_inventory(tree=LEGACY_ROOT) == baseline['legacy'], 'baselineLegacyDataStable')
    require(runtime_config(app) == runtime and core_containers() == scope, 'baselineContainerScopeStable')
    require(file_hash(private_env_file()) == file_hash(environment_backup), 'baselineEnvironmentStable')
    require(source_commit() == source_commit('origin/main') == before_commit, 'baselineSourceStable')
    require(configuration_files() == file_config, 'baselineFileConfigurationStable')
    require(nginx_protected() == nginx, 'baselineActualNginxStable')
    baseline.update({'schema':'internal_quote','sourceCommit':before_commit,'consistentExportedSnapshot':True,
                     'digestMethod':'sha256-sorted-full-row-multiset','deploymentLabel':'PR931',
                     'runtime':runtime,'coreContainers':scope,'configurationFiles':file_config,'actualNginx':nginx})
    checkpoint('privateBackupManifest')
    baseline_file = directory / 'baseline.json'
    baseline_file.write_text(json.dumps(baseline,ensure_ascii=True)); baseline_file.chmod(0o600); dump.chmod(0o600)
    manifest = {name:file_hash(directory / name) for name in ['internal_quote.dump','baseline.json','env.before','uploads.tar','legacy-data.tar']}
    manifest_file = directory / 'manifest.json'
    manifest_file.write_text(json.dumps(manifest)); manifest_file.chmod(0o600)
    # Keep validated dumps, attachments, baseline and manifest even when a known
    # startup action would change rows. Refuse deployment rather than repairing
    # data, granting missing permissions or exempting a delta after the fact.
    checks = startup_safety_checks(baseline['startupChecks'])
    if not all(ok for ok,label in checks):
        print(json.dumps({'backupRetained':str(directory),'privateArchivesVerified':True,
                          'startupChecks':baseline['startupChecks'],'businessWritesPerformed':False,
                          'credentialsChanged':False},ensure_ascii=True))
    for ok,label in checks:
        require(ok,label)
    return {'backup':str(directory),'consistentSnapshot':True,'dumpBytes':dump.stat().st_size,
            'tableCounts':{t:v['rows'] for t,v in baseline['tables'].items()}, 'sourceCommit':before_commit,
            'uploadFiles':baseline['uploads']['files'],'uploadBytes':baseline['uploads']['bytes'],
            'uploadsBackedUp':True,'legacyDataBackedUp':True,'privateEnvironmentBackedUp':True,'runtimeConfigurationBaselined':True,
            'coreContainerScopeBaselined':True,'privateArchivesVerified':True,
            'startupSafetyChecksPassed':True,'startupChecks':baseline['startupChecks'],
            'businessWritesPerformed':False,'credentialsChanged':False}


def latest_backup():
    checkpoint('privateBackupManifest')
    require(isinstance(BACKUP_PATH, str) and re.fullmatch(re.escape(str(BACKUPS)) + r'/internal-quote-pre-931-[0-9]{8}T[0-9]{12}Z', BACKUP_PATH), 'exactPrivateBackupPath')
    directory = pathlib.Path(BACKUP_PATH)
    require(directory.is_dir() and not directory.is_symlink() and directory.stat().st_mode & 0o077 == 0)
    manifest_file = directory / 'manifest.json'
    require(manifest_file.is_file() and not manifest_file.is_symlink() and manifest_file.stat().st_mode & 0o077 == 0)
    manifest = json.loads(manifest_file.read_text())
    require(set(manifest) == {'internal_quote.dump','baseline.json','env.before','uploads.tar','legacy-data.tar'})
    for name,expected in manifest.items():
        file = directory / name
        require(file.is_file() and not file.is_symlink() and file.stat().st_mode & 0o077 == 0 and file_hash(file) == expected)
    baseline = json.loads((directory / 'baseline.json').read_text())
    require(baseline.get('schema') == 'internal_quote' and baseline.get('consistentExportedSnapshot') is True
            and baseline.get('deploymentLabel') == 'PR931' and baseline.get('digestMethod') == 'sha256-sorted-full-row-multiset'
            and isinstance(baseline.get('runtime'),dict) and set(baseline.get('coreContainers',{})) == set(CORE_SERVICES)
            and set(baseline.get('configurationFiles',{})) == set(CONFIG_FILES)
            and baseline.get('sourceCommit') == PRE_DEPLOY_COMMIT)
    table_names(list(baseline['tables']))
    for ok,label in startup_safety_checks(baseline.get('startupChecks')):
        require(ok,label)
    return directory,baseline


def tested_source_guard(commit):
    checkpoint('safePinnedTestedSourceInventory')
    require(isinstance(TESTED_SOURCE,dict) and re.fullmatch(r'[a-f0-9]{40}',str(TESTED_SOURCE.get('reviewedHead',''))), 'finalReviewedHeadPinned')
    files = TESTED_SOURCE.get('files')
    require(isinstance(files,dict) and files, 'nonemptyFinalTestedSourceManifest')
    for path, expected in files.items():
        relative = path[len(APP_PREFIX):] if path.startswith(APP_PREFIX) else ''
        require(relative and not any(part in {'','..','.'} for part in pathlib.PurePosixPath(relative).parts)
                and not any(part in {'data','uploads','legacy-data'} for part in pathlib.PurePosixPath(relative).parts)
                and not any(ord(char)<32 for char in path) and re.fullmatch(r'[a-f0-9]{64}',expected), 'safePinnedTestedSourceInventory')
    changed = run(['git','diff','--name-only','-z',PRE_DEPLOY_COMMIT,commit]).decode().strip('\0').split('\0')
    require(set(changed) == set(files), 'allChangedPathsExactlyMatchFinalTestedManifest')
    for path,expected in files.items():
        require(hashlib.sha256(run(['git','show',commit + ':' + path])).hexdigest() == expected, 'deployedGitBlobMatchesFinalTestedSource')
        actual = ROOT/path
        require(actual.is_file() and not actual.is_symlink(), 'actualSourceRegularFile')
        require(file_hash(actual) == expected, 'actualCheckoutMatchesFinalTestedSource')
    return {'allChangedPathsPinned':True,'testedFiles':len(files),'allDeployedGitBlobsAndCheckoutFilesMatchFinalTestedSource':True}


def source_runtime_files(app, commit):
    checkpoint('allActualApplicationRuntimeFilesMatchGit')
    paths = run(['git','ls-tree','-r','--name-only','-z',commit,'--',APP_PREFIX+'backend',APP_PREFIX+'frontend']).decode().strip('\0').split('\0')
    paths = [path for path in paths if path and '/data/' not in path and '/uploads/' not in path]
    require(paths, 'nonemptyRuntimeSourceInventory')
    expected = {}
    for path in paths:
        relative = path[len(APP_PREFIX):]
        source = run(['git','show',commit+':'+path])
        require((ROOT/path).is_file() and not (ROOT/path).is_symlink() and (ROOT/path).read_bytes() == source, 'runtimeCheckoutMatchesGit')
        expected[relative] = hashlib.sha256(source).hexdigest()
    script = "const fs=require('node:fs'),crypto=require('node:crypto');const paths=JSON.parse(fs.readFileSync(0,'utf8'));const out={};for(const p of paths){const f='/app/'+p;const s=fs.lstatSync(f);if(!s.isFile()||s.isSymbolicLink())process.exit(1);out[p]=crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');}process.stdout.write(JSON.stringify(out));"
    actual = json.loads(run(['docker','exec','-i',app,'node','-e',script],json.dumps(list(expected)).encode()))
    require(actual == expected, 'actualContainerRuntimeFilesMatchGit')
    return {'allActualRuntimeFilesMatchSource':True,'runtimeFilesVerified':len(paths)}


def runtime_and_frontend_files(app, commit):
    result = source_runtime_files(app,commit)
    checkpoint('publicFrontendFilesMatchContainerAndSource')
    names = sorted(path.name for path in (APP_ROOT/'frontend').iterdir() if path.is_file() and path.suffix in {'.html','.js','.css'})
    require(names, 'nonemptyServedAssetInventory')
    for name in names:
        require(bool(re.fullmatch('[A-Za-z0-9_.-]+\.(?:js|css|html)',name)), 'safeStaticAssetFilename')
        expected = (APP_ROOT/'frontend'/name).read_bytes()
        status, served = get('http://127.0.0.1/internal-quote/'+name)
        require(status == 200 and served == expected, 'nginxServedFrontendMatchesGit')
    result.update({'publicFrontendFilesMatchContainerAndSource':True,'publicFrontendFilesVerified':len(names)})
    return result


def verify():
    directory,before = latest_backup()
    current = audit()
    changed = sorted(t for t in set(before['tables']) | set(current['tables']) if before['tables'].get(t) != current['tables'].get(t))
    commit = source_commit()
    require(commit == source_commit('origin/main') == TARGET_COMMIT and commit != PRE_DEPLOY_COMMIT,'sourceMatchesDeployedMain')
    source_proof = tested_source_guard(commit)
    run(['git','merge-base','--is-ancestor',PRE_DEPLOY_COMMIT,commit])
    app,base = app_context()
    runtime = runtime_config(app)
    config_same = runtime['protectedEnvSha256'] == before['runtime']['protectedEnvSha256']
    process_same = runtime['processProtectedEnvSha256'] == before['runtime']['processProtectedEnvSha256']
    mount_same = runtime['mounts'] == before['runtime']['mounts']
    nginx_same = nginx_protected() == before['actualNginx']
    image_changed = runtime['imageId'] != before['runtime']['imageId']
    scope_same = core_containers() == before['coreContainers']
    environment_same = file_hash(private_env_file()) == file_hash(directory / 'env.before')
    file_config_same = configuration_files() == before['configurationFiles']
    checkpoint('healthAndAuthenticationBoundary')
    status,health = get(base + '/health')
    require(status == 200 and json.loads(health).get('status') == 'ok')
    require(get('http://127.0.0.1/internal-quote/health')[0] == 200)
    require(all(get(base + path)[0] == 401 for path in ['/api/auth/me','/api/quotes','/api/admin/users']), 'unauthenticatedAccessDenied')
    api = api_audit(app,base,features=True)
    uploads = upload_inventory()
    final = audit()
    probe_window_stable = current == final
    uploads_same = uploads == before['uploads']
    legacy_same = upload_inventory(tree=LEGACY_ROOT) == before['legacy']
    inventory_same = set(before['tables']) == set(current['tables'])
    permissions_same = before['userIdentitySha256'] == current['userIdentitySha256'] and all(
        before['tables'].get(t) == current['tables'].get(t) for t in PERMISSION_TABLES)
    api_same = all(api.get(key) == value for key,value in before['api'].items())
    # No blanket exemptions, runtime patch guessing, restore or data repairs.
    require(config_same and process_same,'protectedRuntimeAndProcessEnvironmentPreserved')
    require(mount_same, 'persistentMountsPreserved')
    require(nginx_same, 'actualNginxAndAuthorizationPreserved')
    require(legacy_same, 'readOnlyLegacyFilesPreserved')
    require(environment_same,'privateEnvironmentFilePreserved')
    require(file_config_same,'applicationAndDeploymentConfigurationPreserved')
    require(image_changed,'deployedImageChanged')
    require(scope_same and core_containers() == before['coreContainers'],'coreContainersPreserved')
    require(runtime_config(app) == runtime,'verificationRuntimeStable')
    result = {'verified':False,'deploymentChecksPassed':all([inventory_same,permissions_same,config_same,
              environment_same,file_config_same,image_changed,scope_same]), 'backup':str(directory),
              'businessDataUnchanged':not changed,'changedTables':changed,
              'changedTableCounts':{t:{'before':before['tables'].get(t,{}).get('rows'),'after':current['tables'].get(t,{}).get('rows')} for t in changed},
              'databaseTableInventoryPreserved':inventory_same,'usersAndPermissionsPreserved':permissions_same,
              'readOnlyProbeWindowDatabaseStable':probe_window_stable,
              'authenticatedListReadsPreserved':api_same,'authenticatedReadApisVerified':True,
              'summaryShareMetadataVerified':api['summaryShareMetadataVerified'],
              'existingStaffIsolationVerified':api['existingStaffIsolationVerified'],
              'tableCounts':{t:v['rows'] for t,v in current['tables'].items()},
              'uploadsUnchanged':uploads_same,'uploadFiles':uploads['files'],'uploadBytes':uploads['bytes'],
              'health':True,'publicHealth':True,'containerHealth':True,'authBoundaryVerified':True,
              'sourceCommit':commit,'beforeSourceCommit':before['sourceCommit'],'sourceMatchesMain':True,
              'protectedContainerEnvironmentPreserved':config_same,'protectedProcessEnvironmentPreserved':process_same,
              'completeContainerEnvironmentIdentical':runtime['configEnvSha256']==before['runtime']['configEnvSha256'],
              'publicVersionMetadataChanged':runtime['publicVersionMetadata']!=before['runtime']['publicVersionMetadata'],
              'actualNginxAndAuthorizationPreserved':nginx_same,'persistentMountsPreserved':mount_same,'legacyFilesPreserved':legacy_same,'privateEnvironmentPreserved':environment_same,
              'applicationAndDeploymentConfigurationPreserved':file_config_same,
              'deployedImageChanged':image_changed,'coreContainersUnchanged':scope_same,
              'businessWritesPerformed':False,'credentialsChanged':False}
    result.update(source_proof)
    result.update(runtime_and_frontend_files(app,commit))
    result['verified'] = all([result['deploymentChecksPassed'],not changed,uploads_same,api_same,probe_window_stable])
    if not result['verified']:
        checks = [(not changed,'businessFullRowHashesPreserved'),(permissions_same,'usersAndPermissionsPreserved'),
                  (inventory_same,'databaseTableInventoryPreserved'),(uploads_same,'uploadContentPreserved'),
                  (api_same,'authenticatedListReadsPreserved'),(probe_window_stable,'readOnlyProbeWindowDatabaseStable')]
        result['failedCheck'] = next(label for ok,label in checks if not ok)
    return result


def main():
    global TARGET_COMMIT, BACKUP_PATH, TESTED_SOURCE
    mode, before, TARGET_COMMIT, BACKUP_PATH, pin_path = sys.argv[1:]
    require(before == PRE_DEPLOY_COMMIT and re.fullmatch(r'[a-f0-9]{40}', TARGET_COMMIT), 'exactSourceArguments')
    require(mode in ['backup','verify'],'modeValidation')
    require((mode == 'backup' and TARGET_COMMIT == before and not BACKUP_PATH) or (mode == 'verify' and TARGET_COMMIT != before and BACKUP_PATH), 'modeArguments')
    TESTED_SOURCE = json.loads(pathlib.Path(pin_path).read_text())
    result = backup() if mode == 'backup' else verify()
    print(json.dumps(result,ensure_ascii=True))
    return 0 if mode == 'backup' or result['verified'] else 1


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception as error:
        kind = type(error).__name__ if type(error).__name__ in {'RuntimeError','KeyError','TypeError','ValueError','JSONDecodeError','FileNotFoundError'} else 'Other'
        print(json.dumps({'failed':True,'safeError':'IQ_931_OPS_FAILED','failedCheck':FAILED_CHECK,'errorType':kind}))
        sys.exit(1)


