#!/usr/bin/env python3
"""Activate one verified ERP image; additive DDL only, never restore business data."""
import argparse
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import time
import urllib.error
import urllib.parse
import urllib.request

spec = importlib.util.spec_from_file_location('erp_operator', Path(__file__).with_name('erp-p113-scoped-release.py'))
op = importlib.util.module_from_spec(spec)
spec.loader.exec_module(op)
NETWORK = 'rr-portal_platform-net'
SQL_SERVER = '5098b6ddd727'
MAINTENANCE = op.PORTAL / 'deploy/maintenance/services/erp'
CHECKS = {'backend', 'frontend', 'types', 'lint', 'build', 'diff', 'stagedDiff'}


def load(path):
    op.need(path.is_file() and not path.is_symlink(), 'Required proof file missing or linked')
    return json.loads(path.read_text())


def configs_match(container_id, expected, location, label):
    actual = op.runtime_configs(container_id, location / label)
    op.need(actual == expected, 'Runtime configuration file set or content changed')


def public_check(prepared):
    # The host-local nginx endpoint uses the same /erp/ rewrite as the public site.
    for path, expected in [('/erp/', prepared['publishedFiles']['index.html']), ('/erp/health', prepared['publishedFiles']['index.html'])]:
        with urllib.request.urlopen('http://127.0.0.1' + path, timeout=20) as response:
            op.need(response.status == 200 and hashlib.sha256(response.read()).hexdigest() == expected, 'Nginx ERP candidate response differs')


def maintenance_active():
    try:
        urllib.request.urlopen('http://127.0.0.1/erp/', timeout=15)
    except urllib.error.HTTPError as error:
        return error.code == 503
    return False


def verify_candidate(candidate, original, prepared):
    op.need(candidate['Image'] == prepared['imageId'], 'Active image differs')
    expected = op.creation_body(original, prepared['imageId'])
    op.need(candidate['Config'] == {k: v for k, v in expected.items() if k not in ['HostConfig', 'NetworkingConfig']}, 'Active container Config differs')
    op.need(candidate['HostConfig'] == original['HostConfig'], 'Active runtime limits/security/ports differ')
    op.need(candidate['Mounts'] == original['Mounts'], 'Active data mounts differ')
    op.need(set(candidate['NetworkSettings']['Networks']) == {NETWORK}, 'Active network differs')
    endpoint = candidate['NetworkSettings']['Networks'][NETWORK]
    wanted = op.endpoint_config(original)[NETWORK]
    actual_aliases = set(endpoint.get('Aliases') or []) - {candidate['Id'], candidate['Id'][:12]}
    op.need(actual_aliases == set(wanted['Aliases']), 'Active network aliases differ')
    for key in ['IPAMConfig', 'DriverOpts']:
        op.need(endpoint.get(key) == wanted.get(key), 'Active network options differ')


def migrate(mode, prepared, location, env_file, name):
    migration_dir = location / 'source/apps/ERP/db'
    op.run(['docker', 'run', '--rm', '--network', NETWORK, '--memory', '512m', '--memory-swap', '512m', '--cpus', '1',
            '--env-file', str(env_file), '--mount', 'type=bind,src=' + str(migration_dir) + ',dst=/reviewed-migrations,readonly',
            '--entrypoint', 'dotnet', prepared['imageId'], '/opt/erp-scoped-migration/ErpScopedMigration.dll', mode,
            '--expected-database', 'erp', '--expected-server', SQL_SERVER, '--migrations-dir', '/reviewed-migrations'],
           timeout=900, log=location / name)
    lines = (location / name).read_text().splitlines()
    result = next((json.loads(x) for x in reversed(lines) if x.startswith('{')), None)
    op.need(result and result.get('ok') is True and result.get('mode') == mode and result.get('serverMatched') is True, 'Migration evidence is incomplete')
    if mode == 'apply':
        op.need(result.get('originalRowsUnchanged') is True and result.get('strictRuns') == 2 and result.get('businessDml') == 0, 'Migration preservation checks incomplete')
    return result


def activate(source_sha, ready_path):
    source_sha = op.validate_source_sha(source_sha)
    location = op.RELEASES / source_sha
    op.need(location.is_dir() and not location.is_symlink(), 'Prepared release missing')
    op.need(not (location / 'activation.private.json').exists() and not (location / 'activation-journal.private.json').exists(), 'Activation already attempted; inspect before any retry')
    ready = load(Path(ready_path))
    op.need(ready.get('sourceSha') == source_sha and ready.get('scope') == 'P112-P113-cloud', 'Readiness source/scope differs')
    checks = ready.get('checks', {})
    op.need(set(checks) == CHECKS and all(v.get('status') == 'passed' and v.get('failed') == 0 and v.get('skipped') == 0 for v in checks.values()), 'Mandatory final checks incomplete')
    op.need(ready.get('isolatedBusinessChain') == 'passed' and ready.get('freshBaselineMigration') == 'passed' and ready.get('migrationRollback') == 'passed', 'Business or migration acceptance incomplete')
    op.need(ready.get('activationSha256') == op.digest(__file__), 'Reviewed activation operator differs')
    evidence = ready.get('evidenceSha256', {})
    op.need(set(evidence) == {'backendTrx', 'frontendJson', 'checkSummary', 'isolatedBusinessChain', 'migrationVerification'} and all(isinstance(v, str) and re.fullmatch(r'[a-f0-9]{64}', v) for v in evidence.values()), 'Acceptance evidence hashes incomplete')
    op.need(checks['backend'].get('passed', 0) > 0 and checks['frontend'].get('passed', 0) > 0, 'Test suite evidence must be nonempty')
    prepared = load(location / 'prepared.private.json')
    op.need(prepared.get('prepared') is True and prepared.get('sourceSha') == source_sha and prepared.get('operatorSha256') == op.digest(op.__file__), 'Prepared source/operator differs')
    for file, key in [('source-files.private.json', 'sourceFilesSha256'), ('original-api.private.json', 'originalApiSha256'), ('original-sql.private.json', 'originalSqlSha256'), ('original-nginx.private.json', 'originalNginxSha256'), ('build-context-files.private.json', 'buildContextFilesSha256')]:
        op.need(op.digest(location / file) == prepared[key], 'Prepared evidence changed')
    original = load(location / 'original-api.private.json')
    original_sql = load(location / 'original-sql.private.json')
    original_nginx = load(location / 'original-nginx.private.json')
    api, sql = op.original_identity()
    op.need(op.identity_equal(api, original) and op.identity_equal(sql, original_sql), 'Original runtime changed since preparation')
    op.need(op.identity_equal(op.inspect(op.NGINX_NAME), original_nginx), 'Nginx changed since preparation')
    op.need(op.files(location / 'published') == prepared['publishedFiles'], 'Published evidence changed')
    tracked = load(location / 'source-files.private.json')
    app = location / 'source/apps/ERP'
    op.need(op.files(app) == load(location / 'build-context-files.private.json'), 'Prepared build context changed')
    for name, expected in tracked.items():
        op.need(op.digest(app / name) == expected, 'Reviewed source changed after preparation')
    op.need(json.loads(op.run(['docker', 'image', 'inspect', prepared['imageId']]))[0]['Id'] == prepared['imageId'], 'Prepared image unavailable')
    configs_match(op.API_ID, prepared['configFiles'], location, 'before-activation-config')
    nginx_config = op.run(['docker', 'exec', op.NGINX_NAME, 'cat', '/etc/nginx/nginx.conf']).decode()
    op.need('~^/erp(/|$) erp;' in nginx_config and 'if (-f /etc/nginx/maintenance/services/$maintenance_service) { return 503; }' in nginx_config, 'ERP-only maintenance is not configured')
    op.need(not MAINTENANCE.exists() and not MAINTENANCE.is_symlink(), 'Existing ERP maintenance must not be overwritten')
    op.need(MAINTENANCE.parent.is_dir() and not MAINTENANCE.parent.is_symlink(), 'Maintenance directory missing or linked')
    op.need(('/opt/rr-portal/deploy/maintenance', '/etc/nginx/maintenance', 'bind', False) in {(m['Source'], m['Destination'], m['Type'], m['RW']) for m in original_nginx['Mounts']}, 'Maintenance mount differs')
    journal = {'sourceSha': source_sha, 'startedUtc': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), 'steps': [], 'candidateId': None}
    def step(name):
        journal['steps'].append(name)
        op.write_json(location / 'activation-journal.private.json', journal, exclusive=False)
        print(json.dumps({'step': name, 'sourceSha': source_sha}), flush=True)
    op.write_json(location / 'ready.private.json', ready)
    env_file = location / 'migration-env.private'
    connection = op.environment(original)['ERP_DB']
    op.need('\n' not in connection and '\r' not in connection, 'Database environment cannot be represented safely')
    with os.fdopen(os.open(env_file, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'w') as stream:
        stream.write('ERP_DB=' + connection + '\n')
    migrate('inspect', prepared, location, env_file, 'migration-before.private.log')
    step('readiness-and-identity-verified')
    flag_bytes = ('P113 scoped ERP release ' + source_sha + '\n').encode()
    stopped = renamed = disconnected = flagged = False
    candidate_id = None
    old_name = op.API_NAME + '-pre-p113-' + source_sha[:12]
    old_tag = 'rr-portal-erp-api:pre-p113-' + source_sha[:12]
    original_image_ref = original['Config']['Image']
    try:
        with os.fdopen(os.open(MAINTENANCE, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o644), 'wb') as stream:
            stream.write(flag_bytes)
            stream.flush()
            os.fsync(stream.fileno())
        flagged = True
        op.need(maintenance_active(), 'ERP-only maintenance did not take effect')
        # Drain in-flight work before freezing the original API. SQL stays running.
        time.sleep(5)
        op.need(op.identity_equal(op.inspect(op.API_ID), original), 'API changed before stop')
        op.run(['docker', 'stop', '--time', '45', op.API_ID], timeout=75)
        stopped = True
        step('original-api-stopped-under-maintenance')
        backup_file = 'erp_pre_p113_' + source_sha[:12] + '_' + time.strftime('%Y%m%dT%H%M%SZ', time.gmtime()) + '.bak'
        backup_sql_path = '/var/opt/mssql/backup/' + backup_file
        op.run(['docker', 'exec', op.SQL_ID, 'mkdir', '-p', '/var/opt/mssql/backup'])
        backup_host = Path('/opt/rr-portal/apps/ERP/data/sqlserver/backup') / backup_file
        op.need(not backup_host.exists() and not backup_host.is_symlink(), 'Backup name already exists')
        op.sqlcmd("SELECT N'ERP_BACKUP_REQUIRED_BYTES:'+CONVERT(nvarchar(40),SUM(CONVERT(bigint,[size]))*8192) FROM sys.database_files WHERE [type]=0;\n", location, 'backup-size.private.log')
        size_match = re.search(r'ERP_BACKUP_REQUIRED_BYTES:(\d+)', (location / 'backup-size.private.log').read_text())
        op.need(size_match is not None, 'Backup storage estimate unavailable')
        required_bytes = int(size_match.group(1)) + 512 * 1024 ** 2
        op.need(op.shutil.disk_usage(backup_host.parent).free >= required_bytes, 'Insufficient SQL-volume free space for a native backup and reserve')
        op.sqlcmd("IF DB_NAME()<>N'erp' OR CONVERT(nvarchar(128),SERVERPROPERTY('ServerName'))<>N'" + SQL_SERVER + "' THROW 51000,'Database identity differs',1;\nBACKUP DATABASE [erp] TO DISK=N'" + backup_sql_path + "' WITH COPY_ONLY,CHECKSUM,INIT;\nRESTORE VERIFYONLY FROM DISK=N'" + backup_sql_path + "' WITH CHECKSUM;\n", location, 'backup-verify.private.log')
        backup_host = Path('/opt/rr-portal/apps/ERP/data/sqlserver/backup') / backup_file
        op.need(backup_host.is_file() and backup_host.stat().st_size > 0 and not backup_host.is_symlink(), 'Native verified backup file missing')
        backup = {'path': str(backup_host), 'bytes': backup_host.stat().st_size, 'sha256': op.digest(backup_host), 'copyOnly': True, 'checksum': True, 'verifyOnly': True}
        op.write_json(location / 'backup.private.json', backup)
        step('native-sql-backup-verified')
        migration = migrate('apply', prepared, location, env_file, 'migration-apply.private.log')
        step('additive-migration-committed-original-rows-unchanged')
        op.run(['docker', 'image', 'tag', op.API_IMAGE, old_tag])
        op.run(['docker', 'rename', op.API_ID, old_name])
        renamed = True
        op.docker_request('POST', '/networks/' + NETWORK + '/disconnect', {'Container': op.API_ID, 'Force': False})
        disconnected = True
        body = op.creation_body(original, prepared['imageId'])
        result = op.docker_request('POST', '/containers/create?name=' + urllib.parse.quote(op.API_NAME), body)
        candidate_id = result['Id']
        journal['candidateId'] = candidate_id
        step('candidate-created-original-retained')
        op.docker_request('POST', '/containers/' + candidate_id + '/start')
        active = op.wait_healthy(candidate_id)
        op.write_json(location / 'candidate-runtime.private.json', active)
        verify_candidate(active, original, prepared)
        configs_match(candidate_id, prepared['configFiles'], location, 'active-config')
        op.static_checks(active, prepared)
        op.need(op.identity_equal(op.inspect(op.SQL_ID), original_sql), 'SQL identity changed during release')
        op.need(op.identity_equal(op.inspect(op.NGINX_NAME), original_nginx), 'Nginx identity changed during release')
        migrate('inspect', prepared, location, env_file, 'migration-after.private.log')
        # The original image reference is retained as a backup tag before advancing
        # its API-only local alias. No compose command or working checkout changes.
        op.need(not original_image_ref.startswith('sha256:'), 'Original image alias needs explicit review')
        op.run(['docker', 'image', 'tag', prepared['imageId'], original_image_ref])
        time.sleep(10)
        op.need(MAINTENANCE.read_bytes() == flag_bytes, 'Maintenance owner changed')
        MAINTENANCE.unlink()
        flagged = False
        public_check(prepared)
        step('candidate-live-and-nginx-verified')
        result = {'ok': True, 'sourceSha': source_sha, 'imageId': prepared['imageId'], 'apiId': candidate_id,
                  'oldApiId': op.API_ID, 'oldApiName': old_name, 'oldImageTag': old_tag,
                  'sqlId': op.SQL_ID, 'sqlIdentityUnchanged': True, 'nginxIdentityUnchanged': True,
                  'runtimeEnvironmentUnchanged': True, 'runtimeConfigurationUnchanged': True,
                  'uploadsMountUnchanged': True, 'backup': backup,
                  'migration': migration, 'publishedFiles': len(prepared['publishedFiles']),
                  'atUtc': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}
        op.write_json(location / 'activation.private.json', result)
        print(json.dumps({k: result[k] for k in ['ok', 'sourceSha', 'imageId', 'apiId', 'sqlIdentityUnchanged', 'runtimeEnvironmentUnchanged', 'runtimeConfigurationUnchanged', 'uploadsMountUnchanged']}), flush=True)
    except Exception as error:
        journal['failureType'] = type(error).__name__
        journal['failureMessage'] = str(error)
        # Reopen only after the original service is healthy. Business data is
        # never restored; successful additive DDL is compatible with the old API.
        try:
            if not flagged:
                with os.fdopen(os.open(MAINTENANCE, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o644), 'wb') as stream:
                    stream.write(flag_bytes)
                flagged = True
            # CLI/HTTP timeouts can occur after the daemon completed a mutation.
            # Discover exact live identities instead of trusting local booleans.
            containers = op.docker_request('GET', '/containers/json?all=1')
            candidates = [row['Id'] for row in containers if row['Id'] != op.API_ID and
                          ('/' + op.API_NAME in row.get('Names', []) or row['Id'] == candidate_id)]
            op.need(len(candidates) <= 1, 'Ambiguous rollback candidate')
            for identifier in candidates:
                actual = op.inspect(identifier)
                op.need(actual['Image'] == prepared['imageId'], 'Candidate rollback identity differs')
                op.run(['docker', 'rm', '--force', identifier], timeout=90)
            old_actual = op.inspect(op.API_ID)
            op.need(old_actual['Image'] == op.API_IMAGE and old_actual['Config'] == original['Config']
                    and old_actual['HostConfig'] == original['HostConfig'] and old_actual['Mounts'] == original['Mounts'], 'Original rollback identity differs')
            op.need(old_actual['Name'] in ['/' + op.API_NAME, '/' + old_name], 'Original container name changed unexpectedly')
            if old_actual['Name'] != '/' + op.API_NAME:
                op.run(['docker', 'rename', op.API_ID, op.API_NAME])
            if NETWORK not in old_actual['NetworkSettings']['Networks']:
                op.docker_request('POST', '/networks/' + NETWORK + '/connect', {'Container': op.API_ID, 'EndpointConfig': op.endpoint_config(original)[NETWORK]})
            if not old_actual['State']['Running']:
                op.run(['docker', 'start', op.API_ID])
            restored = op.wait_healthy(op.API_ID)
            op.need(restored['Image'] == op.API_IMAGE and restored['Config'] == original['Config'] and restored['HostConfig'] == original['HostConfig'] and restored['Mounts'] == original['Mounts'], 'Restored original runtime differs')
            if not original_image_ref.startswith('sha256:'):
                op.run(['docker', 'image', 'tag', op.API_IMAGE, original_image_ref])
            op.need(op.identity_equal(op.inspect(op.SQL_ID), original_sql), 'SQL changed during rollback')
            time.sleep(10)
            if flagged:
                op.need(MAINTENANCE.read_bytes() == flag_bytes, 'Maintenance ownership changed during rollback')
                MAINTENANCE.unlink()
                flagged = False
            with urllib.request.urlopen('http://127.0.0.1/erp/', timeout=20) as response:
                op.need(response.status == 200, 'Original public API not ready after rollback')
            step('original-api-restored-no-database-restore')
        except Exception as rollback_error:
            # A failed post-clear public check must close the ERP again. Never
            # overwrite or delete a maintenance flag owned by another operation.
            try:
                if not MAINTENANCE.exists():
                    with os.fdopen(os.open(MAINTENANCE, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o644), 'wb') as stream:
                        stream.write(flag_bytes)
                flagged = MAINTENANCE.read_bytes() == flag_bytes
            except OSError:
                flagged = False
            journal['maintenanceRetained'] = flagged
            journal['rollbackFailureType'] = type(rollback_error).__name__
            journal['rollbackFailureMessage'] = str(rollback_error)
            step('rollback-needs-inspection-maintenance-retained')
            raise RuntimeError('Activation and runtime rollback need inspection; database was never restored') from None
        raise RuntimeError('Activation failed; original API restored, database never restored; inspect private journal') from None
    finally:
        if env_file.exists():
            env_file.unlink()


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-sha', required=True)
    parser.add_argument('--ready', required=True)
    args = parser.parse_args()
    with open(op.RELEASES / '.operator.lock', 'a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        activate(args.source_sha, args.ready)


if __name__ == '__main__':
    main()
