"""Inert read-only build diagnosis. Never prints log text, paths, env or labels."""
import datetime, hashlib, json, os, pathlib, re, stat, subprocess, sys

ROOT = pathlib.Path('/opt/rr-portal')
BASE = '4b3d8f3e319e41dcc8720d759e1af0726a2b2381'
BRANCH = 'refs/heads/ops/batch-1015-1019-1022-20261028'
EXECUTE = False
PHASE = 'diagnose-build'
FAILED = ROOT / 'deploy/backups/batch-1015-1019-1022-20261028-existing/prepare'
OUT = ROOT / 'deploy/backups/batch-1015-1019-1022-20261028-build-diagnose'
INSPECTION = ROOT / 'deploy/backups/batch-1015-1019-1022-20261028-inspect'
OLD_IMAGE = 'sha256:adf5b723ca5f8edae60a0a0f12a3828b8cd488a99eeee6405b61092805620294'
FAILED_MANIFEST = '853641272860863d96eb17d07260f8faced04417d8f6409df7f831e25c31c9d1'
STAGE = 'entry'


def need(value, label):
    global STAGE
    if not value:
        STAGE = label
        raise RuntimeError('BUILD_DIAGNOSIS_REJECTED')


def enc(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=True, allow_nan=False).encode()


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def bounded_file(path, limit):
    for parent in (path, *path.parents):
        if parent == ROOT:
            break
        need(not parent.is_symlink(), 'no-private-file-symlinks')
    need(path.is_file() and path.stat().st_size <= limit, 'bounded-private-file')
    before = path.stat()
    raw = path.read_bytes()
    after = path.stat()
    need((before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns) ==
         (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns), 'stable-private-file')
    return raw


def run(args):
    result = subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=45, cwd=ROOT)
    need(result.returncode == 0 and len(result.stdout) <= 4 * 1024 ** 2, 'bounded-readonly-command')
    return result.stdout


def classify(raw):
    # Closed vocabulary; neither matched lines nor exception strings are emitted.
    text = raw.decode('utf8', errors='replace').lower()
    digest = OLD_IMAGE.split(':', 1)[1]
    hub_id = 'docker.io/library/sha256:' + digest
    denial = any(value in text for value in ('pull access denied', 'insufficient_scope', 'authorization failed', 'repository does not exist'))
    codes = []
    if hub_id in text and denial:
        codes.append('IMAGE_ID_RESOLVED_AS_DOCKERHUB_REPOSITORY_AND_PULL_DENIED')
    elif ('pull access denied for sha256' in text or 'repository sha256 not found' in text) and digest in text:
        codes.append('LOCAL_IMAGE_ID_REFERENCE_PULL_DENIED')
    if 'no space left on device' in text:
        codes.append('BUILDER_STORAGE_EXHAUSTED')
    if 'cannot connect to the docker daemon' in text:
        codes.append('DOCKER_DAEMON_UNAVAILABLE')
    if 'permission denied' in text and ('docker.sock' in text or 'docker daemon socket' in text):
        codes.append('DOCKER_DAEMON_SOCKET_PERMISSION_DENIED')
    if 'invalid reference format' in text:
        codes.append('INVALID_IMAGE_REFERENCE_FORMAT')
    if ('failed to calculate checksum' in text or 'failed to compute cache key' in text) and any(
            token in text for token in ('"/code0": not found', '"/code1": not found', '"/code2": not found')):
        codes.append('REVIEWED_COPY_CONTEXT_FILE_MISSING')
    if not codes:
        codes.append('UNCLASSIFIED_REQUIRES_FURTHER_READONLY_EVIDENCE')
    return codes


def builder_driver(raw):
    values = set(re.findall(r'\busing (docker|docker-container|kubernetes|remote) driver\b', raw.decode('utf8', errors='replace')))
    return next(iter(values)) if len(values) == 1 else 'UNKNOWN'


def image_metadata():
    values = json.loads(run(['docker', 'image', 'inspect', OLD_IMAGE]))
    need(len(values) == 1 and values[0]['Id'] == OLD_IMAGE, 'exact-original-local-image-exists')
    value = values[0]
    tags = value.get('RepoTags') or []
    digests = value.get('RepoDigests') or []
    # Only this known service's unqualified local repository tags may be public.
    public_tags = [tag for tag in tags if re.fullmatch(r'rr-portal-internal-quote:[A-Za-z0-9_.-]{1,128}', tag)]
    return {'id': OLD_IMAGE, 'localImageExists': True, 'publicLocalServiceTags': public_tags,
            'allRepoTagsSHA256': sha(enc(tags)), 'repoDigestCount': len(digests), 'repoDigestsSHA256': sha(enc(digests)),
            'configLabelsSHA256': sha(enc(value.get('Config', {}).get('Labels') or {})),
            'rootLayerCount': len(value.get('RootFS', {}).get('Layers') or [])}


def dirty_metadata():
    raw = run(['git', 'diff', '--name-only', '-z'])
    original = bounded_file(INSPECTION / 'dirty-paths.private.json', 65536)
    need(raw == original, 'same-original-dirty-path-list')
    names = [name for name in raw.decode('utf8').split('\0') if name]
    need(len(names) == 4 and len(set(names)) == 4, 'exact-four-original-dirty-files')
    result = []
    for index, name in enumerate(names):
        relative = pathlib.PurePosixPath(name)
        need(not relative.is_absolute() and '..' not in relative.parts, 'fixed-relative-original-dirty-file')
        path = ROOT / name
        regular = path.is_file() and not path.is_symlink()
        value = {'index': index, 'regular': regular}
        if regular:
            st = path.stat()
            value.update(size=st.st_size, uid=st.st_uid, gid=st.st_gid, mode=stat.S_IMODE(st.st_mode), within8MiB=st.st_size <= 8 * 1024 ** 2)
            if value['within8MiB']:
                value['sha256'] = sha(bounded_file(path, 8 * 1024 ** 2))
        result.append(value)
    return {'sameOriginalPaths': True, 'count': len(result), 'filesByIndexOnly': result,
            'allRegularAndWithin8MiB': all(value['regular'] and value.get('within8MiB') for value in result)}


def diagnose():
    need(run(['git', 'rev-parse', 'HEAD']).decode().strip() == BASE, 'unchanged-canonical-source-base')
    manifest_raw = bounded_file(FAILED / 'manifest.json', 1024 ** 2)
    need(sha(manifest_raw) == FAILED_MANIFEST, 'exact-failed-first-prepare-manifest')
    values = json.loads(manifest_raw)
    raw = bounded_file(FAILED / 'internal-quote-build.private.log', 2 * 1024 ** 2)
    need(values['internal-quote-build.private.log'] == sha(raw), 'original-failed-build-log-seal')
    return {'buildLogBytes': len(raw), 'buildLogSHA256': sha(raw), 'knownErrorCodes': classify(raw), 'originalLogBuilderDriver': builder_driver(raw),
            'originalImage': image_metadata(), 'originalDirtyFiles': dirty_metadata(),
            'buildTagSQLSignalsConfigurationWritesOrHTTP': False, 'rawLogEnvironmentAndLabelValuesEmitted': False}


def main():
    need(EXECUTE is True and sys.argv[1:] == [PHASE] and os.environ.get('RELEASE_BRANCH') == BRANCH
         and os.environ.get('RELEASE_MODE') == PHASE and os.environ.get('RELEASE_ATTEMPT') == '1', 'inert-fixed-first-diagnosis')
    os.umask(0o077)
    need(not OUT.exists() and not OUT.is_symlink(), 'one-diagnostic-reservation')
    OUT.mkdir(mode=0o700)
    result = {'phase': PHASE, 'base': BASE, 'success': False}
    try:
        result.update(diagnose())
        result['success'] = True
    except Exception as error:
        result.update(errorType=type(error).__name__, stage=STAGE)
    result['utc'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    fd = os.open(OUT / 'result.private.json', os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'wb') as stream:
        stream.write(enc(result))
    result['resultSHA256'] = sha(enc(result))
    print(json.dumps(result, sort_keys=True), flush=True)
    return 0 if result['success'] else 1


if __name__ == '__main__':
    sys.exit(main())
