#!/usr/bin/env python3
"""ERP-only release. Never checks out the portal, runs db-init, or restores data.

This operator is used only from the reviewed, fingerprint-verified ops workflow.
prepare builds beside the running API. apply requires a bound successful-check
manifest, a fresh original-container identity, and a verified SQL backup.
Private runtime configuration stays on the server under a mode-0700 directory.
"""
from pathlib import Path, PurePosixPath
import argparse
import copy
import fcntl
import hashlib
import http.client
import io
import json
import os
import re
import shutil
import socket
import stat
import subprocess
import tarfile
import time
import urllib.parse
import urllib.request

PORTAL = Path('/opt/rr-portal')
RELEASES = Path('/opt/erp-p113-releases')
API_NAME = 'rr-portal-erp-api-1'
SQL_NAME = 'rr-portal-erp-sqlserver-1'
NGINX_NAME = 'rr-portal-nginx-1'
API_ID = '91305d7f9a65f7f4a01858280765c8c2bc050f17795a5af3a3ab0965684ca8da'
SQL_ID = '5098b6ddd727fb14ca61f9025f1c6c6f23f06dd93e31be00cedf800a96aec106'
API_IMAGE = 'sha256:a385952f5f4b98a2d3c3656e28e722daa1bbe4e31d336ee736b2ff55b7a7ba46'
SQL_IMAGE = 'sha256:4402d880dd4c34bfa7d8705e56a86cd6c88da80a1f6bbbe741f999e76264a090'
MIGRATIONS = ['173_raw_material_procurement_policy.sql', '174_raw_material_issue_sources.sql', '175_cloud_p113_prerequisites.sql']
ARCHIVE_PATHS = ['apps/ERP/src/ErpApi', 'apps/ERP/web2', 'apps/ERP/tools/ErpScopedMigration', 'apps/ERP/Dockerfile', 'apps/ERP/.dockerignore'] + ['apps/ERP/db/' + x for x in MIGRATIONS]
SOURCE_DIRECTORIES = ARCHIVE_PATHS[:3]
BUILD_MEMORY = 2 * 1024 ** 3
BUILD_CPU_PERIOD = 100000
BUILD_CPU_QUOTA = 75000
BUILD_RESERVE_MEMORY = 1024 ** 3
BUILD_FREE_DISK = 3 * 1024 ** 3


def need(ok, message):
    if not ok:
        raise RuntimeError(message)


def digest(path):
    h = hashlib.sha256()
    descriptor = os.open(path, os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0))
    with os.fdopen(descriptor, 'rb') as stream:
        need(stat.S_ISREG(os.fstat(stream.fileno()).st_mode), 'Expected a regular file: ' + str(path))
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def canonical(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(',', ':')).encode()


def write_json(path, value, exclusive=True):
    flags = os.O_WRONLY | os.O_CREAT | (os.O_EXCL if exclusive else os.O_TRUNC)
    with os.fdopen(os.open(path, flags, 0o600), 'wb') as stream:
        stream.write(canonical(value) + b'\n')
        stream.flush()
        os.fsync(stream.fileno())


def run(args, *, input=None, timeout=120, log=None, env=None):
    if log:
        with open(log, 'xb') as stream:
            result = subprocess.run(args, input=input, stdout=stream, stderr=subprocess.STDOUT, timeout=timeout, env=env)
        need(result.returncode == 0, 'Command failed; private log: ' + str(log))
        return b''
    result = subprocess.run(args, input=input, capture_output=True, timeout=timeout, env=env)
    need(result.returncode == 0, 'Command failed: ' + args[0] + ' (exit ' + str(result.returncode) + ')')
    return result.stdout


def inspect(name):
    values = json.loads(run(['docker', 'inspect', name]))
    need(len(values) == 1, 'Ambiguous container identity')
    return values[0]


def files(directory):
    directory = Path(directory)
    need(directory.is_dir() and not directory.is_symlink(), 'Unsafe directory: ' + str(directory))
    result = {}
    for root, dirs, names in os.walk(directory, followlinks=False):
        for name in dirs + names:
            path = Path(root) / name
            mode = path.lstat().st_mode
            need(stat.S_ISDIR(mode) or stat.S_ISREG(mode), 'Symlink or special file rejected: ' + str(path))
            if stat.S_ISREG(mode):
                result[str(path.relative_to(directory))] = digest(path)
    return dict(sorted(result.items()))


def archive_name(name):
    while name.startswith('./'):
        name = name[2:]
    name = name.rstrip('/')
    if name in ['', '.']:
        return ''
    need(not name.startswith('/') and '\\' not in name and '\x00' not in name,
         'Unsafe archive member path')
    need(all(part not in ['', '.', '..'] for part in name.split('/')), 'Unsafe archive member component')
    return str(PurePosixPath(name))


def source_member_allowed(name, is_directory):
    if name in ARCHIVE_PATHS or any(name.startswith(path + '/') for path in SOURCE_DIRECTORIES):
        return True
    return is_directory and (not name or any(path.startswith(name + '/') for path in ARCHIVE_PATHS))


def static_member_allowed(name, _is_directory):
    return name != 'index.html' and name != 'uploads' and not name.startswith('uploads/')


def extract_regular_archive(payload, destination, allowed):
    """Validate the whole tar before writing; never follow links or extract devices."""
    destination = Path(destination)
    need(destination.is_dir() and not destination.is_symlink() and not any(destination.iterdir()),
         'Archive destination must be a new empty directory')
    root = destination.resolve()
    with tarfile.open(fileobj=io.BytesIO(payload), mode='r:') as archive:
        entries = []
        seen = set()
        for member in archive.getmembers():
            name = archive_name(member.name)
            need(member.isdir() or member.isreg(), 'Archive links and special files are not allowed')
            need(name not in seen, 'Duplicate archive member')
            need(allowed(name, member.isdir()), 'Archive member is outside the permitted scope: ' + name)
            need(name or member.isdir(), 'Archive root cannot be a file')
            seen.add(name)
            entries.append((member, name))
        for member, name in entries:
            if not name:
                continue
            target = destination / name
            need(root in target.resolve().parents, 'Archive member escapes destination')
            if member.isdir():
                target.mkdir(parents=True, exist_ok=True, mode=0o700)
            else:
                target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
                with archive.extractfile(member) as source:
                    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, 'O_NOFOLLOW', 0)
                    with os.fdopen(os.open(target, flags, 0o600), 'wb') as output:
                        shutil.copyfileobj(source, output)
                # Keep executability without copying setuid/setgid or archive ownership.
                target.chmod(0o700 if member.mode & 0o111 else 0o600)
    return files(destination)


def runtime_configs(container_id, destination):
    destination.mkdir(mode=0o700)
    command = 'for f in /app/appsettings*.json; do [ ! -L "$f" ] || exit 41; [ ! -f "$f" ] || basename "$f"; done'
    names = run(['docker', 'exec', container_id, 'sh', '-c', command]).decode().splitlines()
    need('appsettings.json' in names and len(names) == len(set(names))
         and all(re.fullmatch(r'appsettings(?:\.[A-Za-z0-9_-]+)?\.json', x) for x in names),
         'Runtime config file list unexpected')
    for name in names:
        run(['docker', 'cp', container_id + ':/app/' + name, str(destination / name)])
        need(not (destination / name).is_symlink(), 'Runtime config symlink rejected')
        (destination / name).chmod(0o600)
    return files(destination)


def legacy_build_budget():
    """Fail closed before builds if legacy limits or host headroom are unavailable."""
    env = dict(os.environ, DOCKER_BUILDKIT='0')
    need(env.get('DOCKER_HOST', '') in ['', 'unix:///var/run/docker.sock'], 'Remote Docker host is not allowed')
    endpoint = json.loads(run(['docker', 'context', 'inspect', '--format', '{{json .Endpoints.docker.Host}}']))
    need(endpoint == 'unix:///var/run/docker.sock', 'Docker CLI must use the same local socket as activation')
    need(Path('/var/run/docker.sock').is_socket(), 'Local Docker socket unavailable')
    info = json.loads(run(['docker', 'info', '--format', '{{json .}}']))
    need(info.get('OSType') == 'linux', 'Resource-constrained release requires a Linux Docker daemon')
    for capability in ['MemoryLimit', 'SwapLimit', 'CpuCfsPeriod', 'CpuCfsQuota']:
        need(info.get(capability) is True, 'Docker resource limit is unavailable: ' + capability)
    help_text = run(['docker', 'build', '--help'], env=env).decode()
    for option in ['--memory', '--memory-swap', '--cpu-period', '--cpu-quota']:
        need(option in help_text, 'Legacy builder option unavailable: ' + option)
    memory = {}
    for line in Path('/proc/meminfo').read_text().splitlines():
        fields = line.split()
        if len(fields) >= 2 and fields[0] == 'MemAvailable:':
            memory['available'] = int(fields[1]) * 1024
    need(memory.get('available', 0) >= BUILD_MEMORY + BUILD_RESERVE_MEMORY,
         'Insufficient available RAM for the fixed build budget and service reserve')
    docker_root = Path(info.get('DockerRootDir', ''))
    need(docker_root.is_absolute() and docker_root.is_dir(), 'Docker storage path unavailable')
    for path in [Path('/opt'), docker_root]:
        need(shutil.disk_usage(path).free >= BUILD_FREE_DISK, 'Insufficient build disk headroom: ' + str(path))
    return env, {'builder': 'legacy', 'memoryBytes': BUILD_MEMORY, 'memorySwapBytes': BUILD_MEMORY,
                 'cpuPeriod': BUILD_CPU_PERIOD, 'cpuQuota': BUILD_CPU_QUOTA,
                 'availableMemoryBytes': memory['available'], 'dockerRootDir': str(docker_root)}


def environment(item):
    entries = item['Config']['Env']
    keys = [x.split('=', 1)[0] for x in entries]
    need(len(keys) == len(set(keys)), 'Duplicate runtime environment key')
    return dict(x.split('=', 1) for x in entries)


def original_identity(api=None, sql=None):
    api, sql = api or inspect(API_NAME), sql or inspect(SQL_NAME)
    need(api['Id'] == API_ID and api['Image'] == API_IMAGE and api['State']['Running'], 'Original API identity changed')
    need(sql['Id'] == SQL_ID and sql['Image'] == SQL_IMAGE and sql['State']['Running'], 'Original SQL identity changed')
    need(sql['State'].get('Health', {}).get('Status') == 'healthy', 'SQL is not healthy')
    mounts = {(x['Source'], x['Destination'], x['Type'], x['RW']) for x in sql['Mounts']}
    need(('/opt/rr-portal/apps/ERP/data/sqlserver', '/var/opt/mssql', 'bind', True) in mounts, 'SQL data volume differs')
    mounts = {(x['Source'], x['Destination'], x['Type'], x['RW']) for x in api['Mounts']}
    need(('/opt/rr-portal/apps/ERP/data/uploads', '/app/wwwroot/uploads', 'bind', True) in mounts, 'ERP upload volume differs')
    need(set(api['NetworkSettings']['Networks']) == {'rr-portal_platform-net'}, 'Unexpected API network')
    env = environment(api)
    need(env.get('ERP_DB') and env.get('ERP_JWT_KEY'), 'Original database/JWT configuration missing')
    return api, sql


def identity_equal(actual, saved):
    actual_mounts, saved_mounts = actual.get('Mounts'), saved.get('Mounts')
    if not all(isinstance(mounts, list) and all(isinstance(mount, dict) for mount in mounts)
               for mounts in [actual_mounts, saved_mounts]):
        return False
    # Docker inspect may reorder Mounts; retain every field and duplicate record.
    return (sorted(canonical(mount) for mount in actual_mounts) == sorted(canonical(mount) for mount in saved_mounts)
            and all(actual[key] == saved[key] for key in ['Id', 'Name', 'Image', 'Created', 'Config', 'HostConfig', 'NetworkSettings'])
            and actual['State']['StartedAt'] == saved['State']['StartedAt']
            and actual['State']['Running'] == saved['State']['Running']
            and actual.get('RestartCount') == saved.get('RestartCount'))


def validate_source_sha(value):
    need(re.fullmatch(r'[a-f0-9]{40}', value) is not None, 'Source must be an exact Git commit')
    return value


def prepare(source_sha):
    source_sha = validate_source_sha(source_sha)
    need(RELEASES.is_dir() and RELEASES.resolve() == RELEASES, 'Release root must not use symlinks')
    need(RELEASES.stat().st_uid == os.geteuid() and stat.S_IMODE(RELEASES.stat().st_mode) & 0o077 == 0,
         'Release root must be private and owned by the operator')
    location = RELEASES / source_sha
    need(not location.exists(), 'Prepared release already exists; inspect it instead of overwriting')
    api, sql = original_identity()
    nginx = inspect(NGINX_NAME)
    build_env, budget = legacy_build_budget()
    location.mkdir(mode=0o700, parents=True)
    write_json(location / 'original-api.private.json', api)
    write_json(location / 'original-sql.private.json', sql)
    write_json(location / 'original-nginx.private.json', nginx)
    write_json(location / 'build-budget.private.json', budget)
    run(['git', '-C', str(PORTAL), 'fetch', 'origin', source_sha], timeout=180, log=location / 'fetch.private.log')
    need(run(['git', '-C', str(PORTAL), 'rev-parse', source_sha + '^{commit}']).decode().strip() == source_sha, 'Source commit differs')
    archive = run(['git', '-C', str(PORTAL), 'archive', '--format=tar', source_sha, '--', *ARCHIVE_PATHS, ':(exclude)apps/ERP/src/ErpApi/wwwroot'], timeout=180)
    source = location / 'source'
    source.mkdir(mode=0o700)
    extract_regular_archive(archive, source, source_member_allowed)
    app = source / 'apps/ERP'
    need(all((source / path).is_dir() if path in SOURCE_DIRECTORIES else (source / path).is_file()
             for path in ARCHIVE_PATHS), 'Required source archive path missing')
    write_json(location / 'source-files.private.json', files(app))
    old_static = location / 'old-static'
    old_static.mkdir(mode=0o700)
    # tar does not follow symlinks; excluded uploads are never traversed or copied.
    static_archive = run(['docker', 'exec', API_ID, 'tar', '-C', '/app/wwwroot',
                          '--exclude=./uploads', '--exclude=./index.html', '-cf', '-', '.'], timeout=180)
    old_static_files = extract_regular_archive(static_archive, old_static, static_member_allowed)
    old_asset_files = {name[len('assets/'):]: value for name, value in old_static_files.items() if name.startswith('assets/')}
    need(old_asset_files, 'Original static assets missing')
    public_root = app / 'web2/public'
    public_root.mkdir(parents=True, exist_ok=True)
    for name, value in old_static_files.items():
        target = public_root / name
        need(not target.exists() or digest(target) == value, 'Tracked public asset collides with original asset')
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(old_static / name, target)
        target.chmod(0o644)
    configs = app / 'runtime-preserved-config'
    config_files = runtime_configs(API_ID, configs)
    dockerfile = (app / 'Dockerfile').read_text()
    need(dockerfile.splitlines().count('RUN npm run build') == 1, 'Unexpected frontend build command')
    dockerfile = dockerfile.replace('RUN npm run build', 'RUN NODE_OPTIONS=--max-old-space-size=1536 npm run build', 1)
    marker = 'FROM mcr.microsoft.com/dotnet/aspnet:8.0 AS runtime'
    need(dockerfile.count(marker) == 1, 'Unexpected runtime Dockerfile')
    migration_stage = '\n'.join(['FROM mcr.microsoft.com/dotnet/sdk:8.0 AS migration', 'WORKDIR /src', 'COPY tools/ErpScopedMigration/ tools/ErpScopedMigration/', *['COPY db/' + name + ' db/' for name in MIGRATIONS], 'RUN dotnet publish tools/ErpScopedMigration/ErpScopedMigration.csproj -c Release -o /migration-publish', ''])
    dockerfile = dockerfile.replace(marker, migration_stage + '\n' + marker)
    dockerfile += '\nCOPY --from=migration /migration-publish/ /opt/erp-scoped-migration/\nCOPY runtime-preserved-config/ /app/\n'
    (app / 'Dockerfile.p113').write_text(dockerfile)
    write_json(location / 'build-context-files.private.json', files(app))
    tag = 'rr-portal-erp-api:p113-' + source_sha[:12]
    # Check headroom again after staging; never retry through an unbounded builder.
    build_env, budget = legacy_build_budget()
    run(['docker', 'build', '--pull=false', '--force-rm', '--memory', str(BUILD_MEMORY),
         '--memory-swap', str(BUILD_MEMORY), '--cpu-period', str(BUILD_CPU_PERIOD),
         '--cpu-quota', str(BUILD_CPU_QUOTA), '-f', str(app / 'Dockerfile.p113'), '-t', tag, str(app)],
        timeout=3300, log=location / 'build.private.log', env=build_env)
    image_id = json.loads(run(['docker', 'image', 'inspect', tag]))[0]['Id']
    need(re.fullmatch(r'sha256:[a-f0-9]{64}', image_id) is not None, 'Candidate image ID is not immutable')
    probe = run(['docker', 'create', '--network', 'none', '--entrypoint', '/bin/true', image_id]).decode().strip()
    published = location / 'published'
    published.mkdir(mode=0o700)
    try:
        probe_identity = inspect(probe)
        need(probe_identity['Image'] == image_id and not probe_identity['State']['Running'], 'Static probe identity differs')
        need(not probe_identity['Mounts'], 'Static probe unexpectedly has mounted data')
        run(['docker', 'cp', probe + ':/app/wwwroot/.', str(published)], timeout=180)
        for name in config_files:
            run(['docker', 'cp', probe + ':/app/' + name, str(location / ('new-' + name))])
            need(digest(location / ('new-' + name)) == digest(configs / name), 'Preserved runtime config differs')
    finally:
        run(['docker', 'rm', probe])
    published_files = files(published)
    need(all(published_files.get(name) == value for name, value in old_static_files.items()), 'Candidate lost or changed original static files')
    final_configs = runtime_configs(API_ID, location / 'original-config-recheck')
    need(final_configs == config_files, 'Original runtime configuration changed during prepare')
    final_api, final_sql = original_identity()
    need(identity_equal(final_api, api) and identity_equal(final_sql, sql)
         and identity_equal(inspect(NGINX_NAME), nginx), 'Original service identity changed during prepare')
    result = {'prepared': True, 'sourceSha': source_sha, 'imageId': image_id, 'tag': tag, 'operatorSha256': digest(__file__), 'sourceFilesSha256': digest(location / 'source-files.private.json'), 'buildContextFilesSha256': digest(location / 'build-context-files.private.json'), 'originalApiSha256': digest(location / 'original-api.private.json'), 'originalSqlSha256': digest(location / 'original-sql.private.json'), 'originalNginxSha256': digest(location / 'original-nginx.private.json'), 'publishedFiles': published_files, 'oldAssets': old_asset_files, 'oldStatic': old_static_files, 'configFiles': config_files, 'buildBudget': budget, 'businessWrites': 0, 'databaseCommands': 0, 'runtimeChanges': 0}
    write_json(location / 'prepared.private.json', result)
    print(json.dumps({'prepared': True, 'sourceSha': source_sha, 'imageId': image_id, 'staticFiles': len(published_files), 'retainedAssets': len(old_asset_files), 'retainedStaticFiles': len(old_static_files), 'runtimeChanges': 0, 'databaseCommands': 0}))


class DockerConnection(http.client.HTTPConnection):
    def connect(self):
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.settimeout(self.timeout)
        self.sock.connect('/var/run/docker.sock')


def docker_request(method, path, body=None):
    client = DockerConnection('localhost', timeout=120)
    try:
        data = None if body is None else canonical(body)
        client.request(method, path, body=data, headers={'Content-Type': 'application/json'})
        response = client.getresponse()
        payload = response.read()
        need(200 <= response.status < 300, 'Docker operation failed: ' + method + ' ' + path + ' HTTP ' + str(response.status))
        return json.loads(payload) if payload else None
    finally:
        client.close()


def endpoint_config(original):
    result = {}
    for network, info in original['NetworkSettings']['Networks'].items():
        aliases = [x for x in info.get('Aliases') or [] if x not in [original['Id'], original['Id'][:12]]]
        result[network] = {'Aliases': aliases}
        for key in ['IPAMConfig', 'DriverOpts']:
            if info.get(key) is not None:
                result[network][key] = info[key]
    return result


def creation_body(original, image_id):
    body = copy.deepcopy(original['Config'])
    body['Image'] = image_id
    body['Labels']['com.docker.compose.image'] = image_id
    body['HostConfig'] = copy.deepcopy(original['HostConfig'])
    body['NetworkingConfig'] = {'EndpointsConfig': endpoint_config(original)}
    need(body['Env'] == original['Config']['Env'], 'Environment changed in create request')
    return body


def sqlcmd(sql, location, name):
    command = 'set -eu; export SQLCMDPASSWORD="$MSSQL_SA_PASSWORD"; if [ -x /opt/mssql-tools18/bin/sqlcmd ]; then client=/opt/mssql-tools18/bin/sqlcmd; else client=/opt/mssql-tools/bin/sqlcmd; fi; exec "$client" -C -S 127.0.0.1 -U sa -d erp -b -r1 -h -1 -W -w 65535'
    run(['docker', 'exec', '-i', SQL_ID, 'sh', '-c', command], input=sql.encode(), timeout=600, log=location / name)


def wait_healthy(container_id, timeout=150):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        value = inspect(container_id)
        need(value['State']['Running'], 'Candidate API stopped')
        if value['State'].get('Health', {}).get('Status') == 'healthy':
            return value
        time.sleep(2)
    raise RuntimeError('Candidate API readiness timed out')


def static_checks(item, prepared):
    ip = item['NetworkSettings']['Networks']['rr-portal_platform-net']['IPAddress']
    need(re.fullmatch(r'\d{1,3}(?:\.\d{1,3}){3}', ip) is not None, 'Invalid candidate private address')
    origin = 'http://' + ip + ':8080/'
    for name, expected in prepared['publishedFiles'].items():
        with urllib.request.urlopen(origin + urllib.parse.quote(name), timeout=15) as response:
            need(hashlib.sha256(response.read()).hexdigest() == expected, 'Candidate static resource differs: ' + name)
    try:
        urllib.request.urlopen(origin + 'api/plastic-raw-material-stock-issue/access', timeout=15)
    except urllib.error.HTTPError as error:
        need(error.code == 401, 'Anonymous raw-workflow access was not denied')
    else:
        raise RuntimeError('Anonymous raw-workflow access unexpectedly allowed')


def apply(source_sha, ready_path):
    raise RuntimeError('Apply is disabled until the final migration contract and local acceptance manifest have been reviewed')


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['prepare', 'apply'])
    parser.add_argument('--source-sha', required=True)
    parser.add_argument('--ready')
    args = parser.parse_args()
    RELEASES.mkdir(mode=0o700, parents=True, exist_ok=True)
    with open(RELEASES / '.operator.lock', 'a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if args.action == 'prepare':
            prepare(args.source_sha)
        else:
            apply(args.source_sha, args.ready)


if __name__ == '__main__':
    main()
