"""Inert read-only inventory of one sealed failed prepare capture; no DB opens."""
import datetime, hashlib, json, os, pathlib, re, sys

ROOT = pathlib.Path('/opt/rr-portal')
BASE = '4b3d8f3e319e41dcc8720d759e1af0726a2b2381'
BRANCH = 'refs/heads/ops/batch-1015-1019-1022-20261028'
EXECUTE = True
PHASE = 'paiji-inventory'
FAILED = ROOT / 'deploy/backups/batch-1015-1019-1022-20261028-existing-v2/prepare'
OUT = ROOT / 'deploy/backups/batch-1015-1019-1022-20261028-paiji-inventory'
MANIFEST_SHA256 = '2d1cc0b00bed8f14f7f627e90596193b6f7060d30f69b5a8ae71d88d01f8c08e'
CAPTURE_RELATIVE = 'paiji-online-rehearsal/capture.private.json'
STAGE = 'entry'


def need(value, label):
    global STAGE
    if not value:
        STAGE = label
        raise RuntimeError('PAIJI_INVENTORY_REJECTED')


def enc(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=True, allow_nan=False).encode()


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def read_fixed(path, limit):
    for parent in (path, *path.parents):
        if parent == ROOT:
            break
        need(not parent.is_symlink(), 'no-fixed-evidence-symlinks')
    need(path.is_file() and path.stat().st_size <= limit, 'bounded-fixed-evidence')
    before = path.stat()
    raw = path.read_bytes()
    after = path.stat()
    need((before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns) ==
         (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns), 'stable-fixed-evidence')
    return raw


def summarize(capture):
    groups = capture['roots']
    need(set(groups) == {'/app/data', '/app/uploads'}, 'exact-known-logical-storage-groups')
    result = []
    for index, destination in enumerate(('/app/data', '/app/uploads')):
        values = groups[destination]['sqlite']
        need(type(values) is dict and len(values) <= 10000, 'bounded-captured-database-count')
        names = sorted(values)
        primary = destination == '/app/data' and 'paiji.db' in values
        others = [name for name in names if not (destination == '/app/data' and name == 'paiji.db')]
        value = {'index': index, 'primaryDataGroup': destination == '/app/data', 'sqliteCount': len(names),
                 'primaryPaijiPresent': primary, 'otherNamesCount': len(others), 'otherNamesSHA256': sha(enc(others))}
        if primary:
            metadata = values['paiji.db']
            need(re.fullmatch('[a-f0-9]{64}', metadata['schemaSha256']) is not None, 'primary-captured-schema-hash')
            tables = metadata['tables']
            need(type(tables) is dict and all(type(table['rows']) is int and table['rows'] >= 0 for table in tables.values()), 'primary-captured-row-metadata')
            value.update(primaryTableCount=len(tables), primaryRowsTotal=sum(table['rows'] for table in tables.values()),
                         primarySchemaSHA256=metadata['schemaSha256'], primaryTableMetadataSHA256=sha(enc(tables)))
        result.append(value)
    return {'storageByIndex': result, 'primaryPaijiPresent': result[0]['primaryPaijiPresent'],
            'extraDataDatabaseCount': result[0]['otherNamesCount'], 'noContainerSQLHTTPOrLiveFileMutations': True}


def inventory():
    raw = read_fixed(FAILED / 'manifest.json', 1024 ** 2)
    need(sha(raw) == MANIFEST_SHA256, 'exact-failed-second-prepare-manifest')
    manifest = json.loads(raw)
    capture = read_fixed(FAILED / CAPTURE_RELATIVE, 4 * 1024 ** 2)
    need(sha(capture) == manifest[CAPTURE_RELATIVE], 'exact-consumed-capture-file-seal')
    return dict(summarize(json.loads(capture)), captureSHA256=sha(capture))


def main():
    need(EXECUTE is True and sys.argv[1:] == [PHASE] and os.environ.get('RELEASE_BRANCH') == BRANCH
         and os.environ.get('RELEASE_MODE') == PHASE and os.environ.get('RELEASE_ATTEMPT') == '1', 'inert-fixed-first-inventory')
    os.umask(0o077)
    need(not OUT.exists() and not OUT.is_symlink(), 'one-new-inventory-directory')
    OUT.mkdir(mode=0o700)
    result = {'phase': PHASE, 'base': BASE, 'success': False}
    try:
        result.update(inventory())
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
