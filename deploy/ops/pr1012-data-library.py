"""Inert data capture/compare tools. Caller owns service gates and stop/start.

No commands, HTTP, signals, restores, migrations or import-time work. Captures are
individually consistent per SQLite DB; they are not cross-DB atomic. Only a caller
verified closed interval at both ends permits deployment attribution. Capture data
and storage separately with explicit labels; neither cross-root nor cross-DB
atomicity is claimed.
"""
import contextlib, hashlib, importlib.util, json, os, pathlib, sqlite3, stat

BASE_LIBRARY_SHA256 = 'd63168fd3057f4f2aba2d93f9fab31d2d65c6dd0f3234877d71fcff1e04e62b9'
SERVICES = {'sprayplan', 'sprayplan-test'}
ROOT_LABELS = {'data', 'storage'}
AUTH_TABLES = {'users', 'Users', 'roles', 'permissions', 'settings', '_superusers', '_collections', '_params', '_migrations', '_externalAuths', '_authOrigins', '_mfas', '_otps', '_sessions', 'User', 'Factory', 'Role', '_prisma_migrations'}

def need(value, label):
    if not value: raise RuntimeError(label)

def enc(value): return json.dumps(value, ensure_ascii=True, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()
def digest(value): return hashlib.sha256(enc(value)).hexdigest()

def load_base(path):
    p = pathlib.Path(path); need(p.is_file() and not p.is_symlink() and hashlib.sha256(p.read_bytes()).hexdigest() == BASE_LIBRARY_SHA256, 'fixed-reviewed-sqlite-library')
    spec = importlib.util.spec_from_file_location('pr1012_pinned_sqlite', p)
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    return module

def meta(path):
    s = path.lstat(); need(not path.is_symlink() and (stat.S_ISREG(s.st_mode) or stat.S_ISDIR(s.st_mode)), 'regular-data-metadata')
    return {'mode': stat.S_IMODE(s.st_mode), 'uid': s.st_uid, 'gid': s.st_gid}

def discover(tree, L):
    names = []
    for p in sorted(tree.rglob('*')):
        meta(p)
        if not p.is_file(): continue
        with p.open('rb') as f: header = f.read(16)
        if header == b'SQLite format 3\0': names.append(p.relative_to(tree).as_posix())
        else: need(p.suffix.lower() not in {'.db', '.sqlite', '.sqlite3'}, 'sqlite-extension-requires-valid-header')
    need(all(L.safe_path(n) for n in names), 'safe-database-relative-paths')
    return names

def sqlite_audit(connection, L):
    audit = L.audit(connection)  # Full schema and every persistent column, including password/token/permission fields.
    audit['pragmas'] = {n: connection.execute('PRAGMA ' + n).fetchone()[0] for n in ('user_version', 'application_id', 'encoding')}
    audit['sequences'] = [list(row) for row in connection.execute('SELECT name,seq FROM sqlite_sequence ORDER BY name')] if 'sqlite_sequence' in audit['tables'] else []
    return audit

def non_database_metadata(tree, names, L):
    physical = set(names) | {n + suffix for n in names for suffix in ('-wal', '-shm', '-journal')}
    result = {}
    for p in sorted(tree.rglob('*')):
        name = p.relative_to(tree).as_posix(); need(L.safe_path(name), 'safe-non-database-metadata-path')
        value = meta(p)
        if name not in physical: result[name] = value
        need(len(result) <= L.MAX_FILES, 'bounded-non-database-metadata')
    return result

def capture(service, tree, destination, closed, L, *, root_label):
    """Write new private portable DB copies + other-files.tar + owner sidecars.

    closed=True means the caller verified business-write ingress is blocked;
    the process may be running. It is not an independently checked gate/stop.
    No immutable=1 on live/source DBs: remaining WAL must be included in backup.
    Archive directory uid/gid is recorded in files; restore is deliberately absent.
    """
    tree, destination = pathlib.Path(tree), pathlib.Path(destination)
    need(service in SERVICES and type(closed) is bool and tree.is_absolute() and tree.is_dir() and not tree.is_symlink(), 'fixed-service-real-data-root')
    need(root_label in ROOT_LABELS, 'explicit-data-or-storage-root-label')
    need(destination.is_absolute() and destination != tree and tree not in destination.parents and not destination.exists() and not destination.is_symlink(), 'new-private-capture-outside-data')
    destination.mkdir(mode=0o700); rootmeta = meta(tree); names = discover(tree, L); dbmeta = {n: meta(tree / n) for n in names}; audits = {}
    with contextlib.ExitStack() as stack:
        connections = {n: stack.enter_context(contextlib.closing(L.connect(tree / n, False))) for n in names}
        for name, connection in connections.items():
            value = sqlite_audit(connection, L); p = destination / 'sqlite' / name; p.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
            fd = os.open(p, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600); os.close(fd)
            with contextlib.closing(sqlite3.connect(p)) as copy:
                connection.backup(copy); need(sqlite_audit(copy, L) == value, 'portable-copy-equals-pinned-read-snapshot')
            with contextlib.closing(L.connect(p, True)) as copy: need(sqlite_audit(copy, L) == value, 'closed-portable-copy-has-complete-wal-state')
            audits[name] = value
    # The reused archive verifier checks path/mode/type/bytes/hash. Directory
    # ownership is explicit in this sidecar (the old tar helper defaults dirs to0).
    before_files_meta = non_database_metadata(tree, names, L)
    files = L.non_database_inventory(tree, names, destination / 'other-files.tar')
    after_files_meta = non_database_metadata(tree, names, L)
    need(before_files_meta == after_files_meta and set(before_files_meta) == {item['path'] for item in files}, 'non-database-owner-mode-set-stable-around-archive')
    for item in files:
        stable_meta = before_files_meta[item['path']]
        need(item['mode'] == stable_meta['mode'], 'archived-mode-matches-fixed-owner-sidecar')
        item.update(stable_meta)
    current_names = discover(tree, L); need(current_names == names and {n: meta(tree / n) for n in names} == dbmeta, 'stable-database-set-and-ownership')
    need(meta(tree) == rootmeta, 'stable-data-root-ownership')
    value = {'service': service, 'rootLabel': root_label, 'sourceRoot': str(tree), 'closedIntervalClaimedByCaller': closed, 'crossDatabaseAtomic': False, 'crossRootAtomic': False, 'rootMetadata': rootmeta, 'databaseMetadata': dbmeta, 'sqlite': audits, 'files': files,
             'authSystem': {n: {t: v for t, v in a['tables'].items() if t in AUTH_TABLES} for n, a in audits.items()},
             'sqliteSnapshotSHA256': {n: L.file_hash(destination / 'sqlite' / n) for n in names}, 'otherFilesArchiveSHA256': L.file_hash(destination / 'other-files.tar')}
    L.private_write(destination / 'capture.private.json', enc(value)); return value

def compare(before, after, log_tables=None):
    """All persistent cells/schema/sequences/files/owners are exact. No log policy.

    A caller must capture and compare data and storage independently; matching
    root label and physical source path prevent a cross-root equality claim.
    """
    need(before['service'] == after['service'] and before['service'] in SERVICES, 'same-data-service')
    need(before['rootLabel'] == after['rootLabel'] and before['rootLabel'] in ROOT_LABELS and before['sourceRoot'] == after['sourceRoot'], 'same-labeled-physical-root')
    need(log_tables is None or type(log_tables) is dict and not log_tables, 'no-log-or-table-exemptions')
    exact = before['sqlite'] == after['sqlite']; deltas = []
    for db in sorted(set(before['sqlite']) | set(after['sqlite'])):
        old, new = before['sqlite'].get(db), after['sqlite'].get(db)
        if old is None or new is None:
            deltas.append({'db': db, 'kind': 'database-set'}); continue
        if old['schemaSha256'] != new['schemaSha256'] or old['pragmas'] != new['pragmas']:
            deltas.append({'db': db, 'kind': 'schema-or-pragmas'})
        if old['sequences'] != new['sequences']:
            deltas.append({'db': db, 'kind': 'sequences'})
        for table in sorted(set(old['tables']) | set(new['tables'])):
            a, b = old['tables'].get(table), new['tables'].get(table)
            if a != b: deltas.append({'db': db, 'table': table, 'logOnly': False, 'before': a, 'after': b})
    files_equal = before['files'] == after['files']
    owners_equal = before['rootMetadata'] == after['rootMetadata'] and before['databaseMetadata'] == after['databaseMetadata']
    auth_equal = before['authSystem'] == after['authSystem']
    return {'sqliteAllTablesExact': exact, 'businessAndAuthExact': exact and auth_equal, 'authSystemExact': auth_equal,
            'otherFilesExact': files_equal, 'directoryAndDatabaseOwnersExact': owners_equal,
            'preserved': exact and auth_equal and files_equal and owners_equal, 'sqliteDeltas': deltas, 'explicitLogPolicy': {},
            'deploymentAttributionPermitted': before['closedIntervalClaimedByCaller'] is True and after['closedIntervalClaimedByCaller'] is True,
            'crossDatabaseAtomic': False, 'crossRootAtomic': False}
