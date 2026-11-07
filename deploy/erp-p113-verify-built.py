#!/usr/bin/env python3
"""Resume verification of one pinned, completed ERP build. Never build or activate."""
import argparse
import fcntl
import hashlib
import io
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import threading
import tarfile
import time
import types

HELPER_SHA = '68ef1c977319a877c2ff469da3564a9b4f783f7a6c52974bfd942743a3a497dc'
helper_path = Path(__file__).with_name('erp-p113-scoped-release.py')
with os.fdopen(os.open(helper_path, os.O_RDONLY | os.O_NOFOLLOW), 'rb') as helper_stream:
    if not stat.S_ISREG(os.fstat(helper_stream.fileno()).st_mode):
        raise RuntimeError('Reviewed verification helper is not a regular file')
    helper_content = helper_stream.read()
if hashlib.sha256(helper_content).hexdigest() != HELPER_SHA:
    raise RuntimeError('Reviewed verification helper differs')
op = types.ModuleType('erp_operator')
op.__file__ = str(helper_path)
exec(compile(helper_content, str(helper_path), 'exec'), op.__dict__)
SOURCE = '8d0a955487883d29a54aed883c66592c24722306'
TREE = 'ad7202627e60949ccf4edd02218d2fd78bbd9c85'
BUILD_OPERATOR_COMMIT = '68d2b996009e44c5d616e9353697a6c621a7abe1'
BUILD_OPERATOR_SHA = 'f544bb9352e932c98a55349facfdf0cb43804d0c7acb6c67ecd2c351a3e96d3c'
IMAGE = 'sha256:fcec04803bab092f13060034d97d691befa2ae27c0d972c304826d41c332dfdc'
IMAGE_CREATED = '2026-11-07T04:56:24.213719668Z'
IMAGE_SIZE = 108079420
TAG = 'rr-portal-erp-api:p113-8d0a95548788'
WORK = 'verify-built-20261107'
RESERVE = 512 * 1024 ** 2
OVERHEAD = 16 * 1024 ** 2
MAX_SCAN_ENTRIES = 50000
PINS = {
    'build.private.log': '0d2d2964d3ed9861e46bca076b32d209ec9156e3888c511bd911a6ebf2576f72',
    'build-context-files.private.json': '4ec5d75cda2a1b9c2927b9d3173d073c8466c55aa14ac05ac6ffd62511f29046',
    'source-files.private.json': '547aa78f1d3a54f434140a291c1c89e43f628bb624f805aebcc24f68578fd765',
    'original-api.private.json': 'c481d5939267aa33fbbd7fdefd624eb8c6cb11921e41c52e76bfb315c6deca92',
    'original-sql.private.json': '7685b3be0a4a33e85f07b67b658164e83ba1df4110d6d9ab67db712aabf44534',
    'original-nginx.private.json': 'bf3e615ed01afd8263ddeafda1646b412b7057029cc8103c7c259a31f3945b1b',
    'build-budget.private.json': 'cc828f7f397f376ddb5f25e9755ed6abff288925bf6a92722aaf65fd857e375b',
}


def private_directory(path):
    op.need(path.is_dir() and path.resolve() == path and not path.is_symlink(), 'Private directory missing or linked')
    info = path.stat()
    op.need(info.st_uid == os.geteuid() and not stat.S_IMODE(info.st_mode) & 0o077, 'Directory must remain private and operator-owned')


def read_regular(path):
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(descriptor, 'rb') as stream:
        info = os.fstat(stream.fileno())
        op.need(stat.S_ISREG(info.st_mode) and info.st_uid == os.geteuid(), 'Evidence is not an owned regular file')
        return stream.read()


def pinned_inputs(location):
    result = {}
    for name, wanted in PINS.items():
        content = read_regular(location / name)
        op.need(hashlib.sha256(content).hexdigest() == wanted, 'Pinned build evidence differs: ' + name)
        result[name] = content.decode() if name.endswith('.log') else json.loads(content)
    expected_tail = ['Successfully built ' + IMAGE[7:19], 'Successfully tagged ' + TAG]
    op.need(result['build.private.log'].strip().splitlines()[-2:] == expected_tail, 'Pinned build did not finish with this image and tag')
    budget = result['build-budget.private.json']
    op.need(all(budget.get(k) == v for k, v in {'builder': 'legacy', 'memoryBytes': 2 * 1024 ** 3,
        'memorySwapBytes': 2 * 1024 ** 3, 'cpuPeriod': 100000, 'cpuQuota': 75000}.items()), 'Original bounded build policy differs')
    return result


def git_source_map():
    op.need(op.run(['git', '-C', str(op.PORTAL), 'rev-parse', SOURCE + '^{commit}']).decode().strip() == SOURCE, 'Pinned source object unavailable')
    op.need(op.run(['git', '-C', str(op.PORTAL), 'rev-parse', SOURCE + '^{tree}']).decode().strip() == TREE, 'Tested source tree differs')
    built_operator = op.run(['git', '-C', str(op.PORTAL), 'show', BUILD_OPERATOR_COMMIT + ':deploy/erp-p113-scoped-release.py'])
    op.need(hashlib.sha256(built_operator).hexdigest() == BUILD_OPERATOR_SHA, 'Trusted build operator object differs')
    payload = op.run(['git', '-C', str(op.PORTAL), 'archive', '--format=tar', SOURCE, '--', *op.ARCHIVE_PATHS,
                     ':(exclude)apps/ERP/src/ErpApi/wwwroot'], timeout=180)
    seen, result = set(), {}
    with tarfile.open(fileobj=io.BytesIO(payload), mode='r:') as archive:
        for entry in archive.getmembers():
            name = op.archive_name(entry.name)
            op.need(name not in seen and (entry.isdir() or entry.isreg()) and op.source_member_allowed(name, entry.isdir()), 'Unexpected source archive member')
            seen.add(name)
            if entry.isreg():
                op.need(name.startswith('apps/ERP/'), 'Source file outside ERP')
                with archive.extractfile(entry) as stream:
                    result[name[len('apps/ERP/'):]] = hashlib.sha256(stream.read()).hexdigest()
    op.need(result, 'Source archive is empty')
    return result


def check_identities(inputs):
    api, sql = op.original_identity()
    nginx = op.inspect(op.NGINX_NAME)
    for name, actual in [('api', api), ('sql', sql), ('nginx', nginx)]:
        op.need(op.identity_equal(actual, inputs['original-' + name + '.private.json']), 'Current ' + name + ' identity differs from original build')
    return api, sql, nginx


def check_image():
    values = json.loads(op.run(['docker', 'image', 'inspect', IMAGE]))
    tags = json.loads(op.run(['docker', 'image', 'inspect', TAG]))
    op.need(len(values) == len(tags) == 1 and values[0]['Id'] == tags[0]['Id'] == IMAGE, 'Pinned image/tag binding differs')
    image = values[0]
    op.need(image['Created'] == IMAGE_CREATED and image['Size'] == IMAGE_SIZE, 'Pinned image metadata differs')
    op.need(TAG in (image.get('RepoTags') or []), 'Dedicated build tag missing')
    op.need(not image['Config'].get('Volumes'), 'Probe image must not create anonymous volumes')
    op.need(image['Config'].get('Entrypoint') == ['dotnet', 'ErpApi.dll'] and image['Config'].get('WorkingDir') == '/app', 'Image is not the completed ERP runtime')
    return image


def check_context(location, inputs):
    app = location / 'source/apps/ERP'
    context = inputs['build-context-files.private.json']
    source = inputs['source-files.private.json']
    op.need(git_source_map() == source, 'Saved source manifest does not match the pinned Git tree')
    op.need(op.files(app) == context, 'Actual build context differs from pinned manifest')
    op.need(op.files(location / 'source') == {'apps/ERP/' + name: value for name, value in context.items()}, 'Unexpected file outside archived ERP source')
    op.need(all(context.get(name) == value for name, value in source.items()), 'Tracked source changed during staging')
    configs = op.files(app / 'runtime-preserved-config')
    op.need('appsettings.json' in configs and all(re.fullmatch(r'appsettings(?:\.[A-Za-z0-9_-]+)?\.json', name) for name in configs), 'Unexpected preserved config set')
    old = op.files(location / 'old-static')
    op.need(old and any(name.startswith('assets/') for name in old), 'Old static assets missing')
    op.need(all(op.static_member_allowed(name, False) for name in old), 'Old static evidence contains excluded data')
    additions = {'web2/public/' + name: value for name, value in old.items()}
    additions.update({'runtime-preserved-config/' + name: value for name, value in configs.items()})
    additions['Dockerfile.p113'] = context.get('Dockerfile.p113')
    op.need(additions['Dockerfile.p113'] and {**source, **additions} == context, 'Unexpected staged file or missing preserved artifact')
    published = op.files(location / 'published')
    op.need('index.html' in published and all(published.get(name) == value for name, value in old.items()), 'Previous candidate publication lost old static files')
    op.need(op.files(location / 'original-config-recheck') == configs, 'Original final config recheck differs')
    for name, wanted in configs.items():
        op.need(op.digest(location / ('new-' + name)) == wanted, 'Original candidate config check differs')
    top = set(PINS) | {'fetch.private.log', 'source', 'old-static', 'published', 'original-config-recheck'} | {'new-' + name for name in configs}
    op.need({p.name for p in location.iterdir()} == top, 'Unexpected release state; do not resume automatically')
    return app, configs, old, published, top


def allocated_tree_bytes(directory, block):
    op.files(directory)  # Reject links/special files before estimating allocations.
    total = block  # Root directory.
    for path in directory.rglob('*'):
        total += block if path.is_dir() else max(block, ((path.stat().st_size + block - 1) // block) * block)
    return total


def verification_budget(location, inputs, configs, old, probe_allocation=0):
    # Actual streamed tar sizes, rounded per file/directory to the host block size.
    # Docker image Size is only an identity pin, never an unpacked-size bound.
    op.need(os.environ.get('DOCKER_HOST', '') in ['', 'unix:///var/run/docker.sock'], 'Remote Docker host is not allowed')
    endpoint = json.loads(op.run(['docker', 'context', 'inspect', '--format', '{{json .Endpoints.docker.Host}}']))
    op.need(endpoint == 'unix:///var/run/docker.sock' and Path('/var/run/docker.sock').is_socket(), 'Local Docker socket unavailable')
    info = json.loads(op.run(['docker', 'info', '--format', '{{json .}}']))
    docker_root = Path(info.get('DockerRootDir', ''))
    op.need(info.get('OSType') == 'linux' and docker_root.is_absolute() and docker_root.is_dir()
            and str(docker_root) == inputs['build-budget.private.json']['dockerRootDir'], 'Docker storage identity differs')
    paths = [location, docker_root]
    block = max(os.statvfs(path).f_frsize or os.statvfs(path).f_bsize for path in paths)
    op.need(block > 0, 'Filesystem block size unavailable')
    old_bytes = allocated_tree_bytes(location / 'old-static', block)
    config_bytes = allocated_tree_bytes(location / 'source/apps/ERP/runtime-preserved-config', block)
    scratch_bytes = probe_allocation + 2 * old_bytes + 2 * config_bytes + OVERHEAD
    for path in paths:
        op.need(op.shutil.disk_usage(path).free >= scratch_bytes + RESERVE, 'Insufficient verification scratch space plus 512MiB reserve')
    return {'scratchBytes': scratch_bytes, 'probeAllocationBytes': probe_allocation, 'blockBytes': block, 'serviceReserveBytes': RESERVE,
            'requiredFreeBytes': scratch_bytes + RESERVE, 'dockerRootDir': str(docker_root),
            'buildDiskGateChanged': False, 'activationBackupGateChanged': False}


def scan_probe_tree(identifier, source, block, limit, metadata_limit=OVERHEAD):
    """Hash/measure bounded tar streams without starting the probe or writing files."""
    op.need(source in ['/app/.', '/opt/erp-scoped-migration/.'] and limit >= 0, 'Unexpected probe scan')
    process = subprocess.Popen(['docker', 'cp', identifier + ':' + source, '-'],
                               stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    expired = threading.Event()
    def expire():
        expired.set()
        process.kill()
    timer = threading.Timer(180, expire)
    timer.daemon = True
    timer.start()
    result = {'files': {}, 'directories': [], 'regularBytes': 0, 'allocationBytes': 0, 'metadataBytes': 0}
    seen = set()
    prefix = None
    try:
        # One tar block prevents hidden trailing bytes in tarfile's read-ahead buffer.
        with tarfile.open(fileobj=process.stdout, mode='r|', bufsize=512) as archive:
            for entry in archive:
                name = op.archive_name(entry.name)
                op.need(name not in seen and len(seen) < MAX_SCAN_ENTRIES and len(name) <= 4096, 'Duplicate or excessive probe archive entries')
                seen.add(name)
                op.need(entry.isdir() or entry.isreg(), 'Probe archive links/special files rejected')
                if prefix is None:
                    op.need(entry.isdir() and name in ['', Path(source[:-2]).name], 'Unexpected probe archive root')
                    prefix = name + '/' if name else ''
                    relative = ''
                else:
                    op.need(not prefix or name.startswith(prefix), 'Probe archive member outside root')
                    relative = name[len(prefix):] if prefix else name
                op.need(relative or entry.isdir(), 'Probe archive root must be a directory')
                op.need(entry.size >= 0 and (not entry.isdir() or entry.size == 0), 'Invalid probe archive member size')
                result['metadataBytes'] += 4 * len(name.encode('utf-8')) + 1024
                op.need(result['metadataBytes'] <= metadata_limit, 'Probe metadata exceeds reserved evidence budget')
                result['allocationBytes'] += block if entry.isdir() else max(block, ((entry.size + block - 1) // block) * block)
                op.need(result['allocationBytes'] <= limit, 'Measured probe files exceed available scratch budget')
                if entry.isdir():
                    result['directories'].append(relative)
                    continue
                digest = hashlib.sha256()
                count = 0
                with archive.extractfile(entry) as stream:
                    for chunk in iter(lambda: stream.read(1024 * 1024), b''):
                        count += len(chunk)
                        digest.update(chunk)
                op.need(count == entry.size, 'Incomplete probe archive member')
                result['regularBytes'] += count
                result['files'][relative] = {'bytes': count, 'sha256': digest.hexdigest()}
        # Consume only bounded zero padding after the tar end before requiring exit0.
        padding = 0
        for chunk in iter(lambda: process.stdout.read(65536), b''):
            padding += len(chunk)
            op.need(padding <= OVERHEAD and not any(chunk), 'Unexpected trailing probe archive data')
        op.need(process.wait(timeout=5) == 0 and not expired.is_set(), 'Probe archive command failed or timed out')
        op.need(prefix is not None and result['files'], 'Probe archive is empty')
        result['directories'].sort()
        return result
    finally:
        timer.cancel()
        if process.poll() is None:
            process.kill()
            process.wait(timeout=5)
        process.stdout.close()


def match_probe_copy(directory, measured):
    hashes = op.files(directory)
    actual = {name: {'bytes': (directory / name).stat().st_size, 'sha256': value} for name, value in hashes.items()}
    directories = sorted([''] + [str(path.relative_to(directory)) for path in directory.rglob('*') if path.is_dir()])
    op.need(actual == measured['files'] and directories == measured['directories'], 'Probe copy differs from the complete measured tar file set')
    return hashes


def current_artifacts(work, label, configs, old):
    actual_configs = op.runtime_configs(op.API_ID, work / ('config-' + label))
    op.need(actual_configs == configs, 'Current runtime config differs')
    target = work / ('static-' + label)
    target.mkdir(mode=0o700)
    archive = op.run(['docker', 'exec', op.API_ID, 'tar', '-C', '/app/wwwroot', '--exclude=./uploads', '--exclude=./index.html', '-cf', '-', '.'], timeout=180)
    actual_static = op.extract_regular_archive(archive, target, op.static_member_allowed)
    op.need(actual_static == old, 'Current original static files differ')


def probe_identity(identifier):
    op.need(re.fullmatch(r'[a-f0-9]{64}', identifier) is not None, 'Probe ID is not immutable')
    value = op.inspect(identifier)
    op.need(value['Id'] == identifier and value['Image'] == IMAGE and not value['State']['Running']
            and value['State']['Status'] == 'created' and value['Mounts'] == []
            and value['HostConfig']['NetworkMode'] == 'none'
            and value['Config']['Entrypoint'] == ['/bin/true']
            and value['Config'].get('Labels', {}).get('erp.p113.verify-built') == SOURCE,
            'Verification probe identity differs; leave it for inspection')


def verify_built(source_sha):
    op.need(source_sha == SOURCE, 'Only the pinned completed build may be verified')
    op.need(op.digest(op.__file__) == HELPER_SHA, 'Reviewed verification helper differs')
    private_directory(op.RELEASES)
    location = op.RELEASES / SOURCE
    private_directory(location)
    inputs = pinned_inputs(location)
    app, configs, old, published, original_top = check_context(location, inputs)
    original_files = op.files(location)
    check_identities(inputs)
    check_image()
    budget = verification_budget(location, inputs, configs, old)
    work = location / WORK
    work.mkdir(mode=0o700)  # Exclusive one-shot verification; never overwrite a failed attempt.
    op.write_json(work / 'start.private.json', {'sourceSha': SOURCE, 'imageId': IMAGE, 'pinnedEvidenceSha256': PINS,
        'builtWithOperatorSha256': BUILD_OPERATOR_SHA, 'verifiedWithHelperSha256': HELPER_SHA,
        'verifierSha256': op.digest(__file__), 'storageBudget': budget})
    current_artifacts(work, 'before', configs, old)
    probe = op.run(['docker', 'create', '--network', 'none', '--entrypoint', '/bin/true',
                    '--label', 'erp.p113.verify-built=' + SOURCE, IMAGE]).decode().strip()
    try:
        probe_identity(probe)
        capacity = min(op.shutil.disk_usage(path).free for path in [location, Path(budget['dockerRootDir'])]) - RESERVE - budget['scratchBytes']
        app_measure = scan_probe_tree(probe, '/app/.', budget['blockBytes'], capacity)
        migration_measure = scan_probe_tree(probe, '/opt/erp-scoped-migration/.', budget['blockBytes'], capacity - app_measure['allocationBytes'], OVERHEAD - app_measure['metadataBytes'])
        budget = verification_budget(location, inputs, configs, old, app_measure['allocationBytes'] + migration_measure['allocationBytes'])
        op.write_json(work / 'measured-probe.private.json', {'app': app_measure, 'migration': migration_measure, 'storageBudget': budget})
        candidate = work / 'candidate-app'
        candidate.mkdir(mode=0o700)
        op.run(['docker', 'cp', probe + ':/app/.', str(candidate)], timeout=180)
        candidate_files = match_probe_copy(candidate, app_measure)
        op.need(op.files(candidate / 'wwwroot') == published, 'Complete candidate static file set differs')
        candidate_configs = {name: value for name, value in candidate_files.items() if '/' not in name and name.startswith('appsettings') and name.endswith('.json')}
        op.need(candidate_configs == configs, 'Complete candidate config set differs')
        op.need(all(name in candidate_files and (candidate / name).stat().st_size > 0 for name in ['ErpApi.dll', 'ErpApi.deps.json', 'ErpApi.runtimeconfig.json']), 'Candidate backend publication incomplete')
        migration = work / 'migration-tool'
        migration.mkdir(mode=0o700)
        op.run(['docker', 'cp', probe + ':/opt/erp-scoped-migration/.', str(migration)], timeout=180)
        migration_files = match_probe_copy(migration, migration_measure)
        op.need(all(name in migration_files and (migration / name).stat().st_size > 0 for name in ['ErpScopedMigration.dll', 'ErpScopedMigration.deps.json', 'ErpScopedMigration.runtimeconfig.json']), 'Candidate scoped migration tool incomplete')
    finally:
        # Only this newly-created, never-started, volume-free probe can be removed.
        probe_identity(probe)
        op.run(['docker', 'rm', probe])
    current_artifacts(work, 'after', configs, old)
    check_identities(inputs)
    check_image()
    pinned_inputs(location)
    op.need(op.digest(op.__file__) == HELPER_SHA, 'Verification helper changed during verification')
    op.need({p.name for p in location.iterdir()} == original_top | {WORK}, 'Release state changed during verification')
    op.need({name: value for name, value in op.files(location).items() if not name.startswith(WORK + '/')} == original_files, 'Original build evidence changed during verification')
    for path in [location, Path(budget['dockerRootDir'])]:
        op.need(op.shutil.disk_usage(path).free >= RESERVE, 'Service disk reserve no longer available')
    proof = {'verified': True, 'sourceSha': SOURCE, 'sourceTree': TREE, 'imageId': IMAGE, 'completedUtc': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
        'builtWith': {'operatorCommit': BUILD_OPERATOR_COMMIT, 'operatorSha256': BUILD_OPERATOR_SHA, 'buildLogSha256': PINS['build.private.log']},
        'verifiedWith': {'helperSha256': HELPER_SHA, 'verifierSha256': op.digest(__file__)},
        'pinnedEvidenceSha256': PINS, 'storageBudget': budget, 'measuredProbeSha256': op.digest(work / 'measured-probe.private.json'), 'candidateAppFiles': candidate_files, 'migrationToolFiles': migration_files,
        'businessWrites': 0, 'databaseCommands': 0, 'buildCommands': 0, 'runtimeChanges': 0, 'probeStarted': False}
    op.write_json(work / 'verification.private.json', proof)
    prepared = {'prepared': True, 'mode': 'verified-existing-build', 'sourceSha': SOURCE, 'imageId': IMAGE, 'tag': TAG,
        'operatorSha256': HELPER_SHA, 'sourceFilesSha256': PINS['source-files.private.json'],
        'buildContextFilesSha256': PINS['build-context-files.private.json'],
        'originalApiSha256': PINS['original-api.private.json'], 'originalSqlSha256': PINS['original-sql.private.json'],
        'originalNginxSha256': PINS['original-nginx.private.json'], 'publishedFiles': published, 'oldStatic': old,
        'oldAssets': {name[len('assets/'):]: value for name, value in old.items() if name.startswith('assets/')},
        'configFiles': configs, 'buildBudget': inputs['build-budget.private.json'], 'builtWith': proof['builtWith'], 'verifiedWith': proof['verifiedWith'],
        'verificationProofSha256': op.digest(work / 'verification.private.json'),
        'businessWrites': 0, 'databaseCommands': 0, 'buildCommands': 0, 'runtimeChanges': 0}
    op.write_json(location / 'prepared.private.json', prepared)
    print(json.dumps({'prepared': True, 'mode': prepared['mode'], 'sourceSha': SOURCE, 'imageId': IMAGE,
        'publishedFiles': len(published), 'retainedStaticFiles': len(old), 'businessWrites': 0, 'databaseCommands': 0, 'buildCommands': 0, 'runtimeChanges': 0}))


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-sha', required=True)
    args = parser.parse_args()
    op.need(args.source_sha == SOURCE, 'Only the pinned completed build may be verified')
    private_directory(op.RELEASES)
    flags = os.O_WRONLY | os.O_CREAT | os.O_NOFOLLOW
    with os.fdopen(os.open(op.RELEASES / '.operator.lock', flags, 0o600), 'w') as lock:
        op.need(stat.S_ISREG(os.fstat(lock.fileno()).st_mode), 'Operator lock is not a regular file')
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        verify_built(args.source_sha)


if __name__ == '__main__':
    main()
