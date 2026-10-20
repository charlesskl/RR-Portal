"""Pure comparison of closed QC snapshots for the exact PR964 additive upgrade.
No live paths, HTTP, subprocesses, data restore or writes to either input database.
"""
import contextlib
import hashlib
import pathlib
import sqlite3

NEW_TABLE = 'InspectionImportBatches'
OLD_TABLES = ('InspectionAlerts', 'InspectionResultApprovals')
NEW_TABLE_SQL = """CREATE TABLE IF NOT EXISTS InspectionImportBatches (
    Id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT, Site TEXT NOT NULL, FileName TEXT NOT NULL,
    CreatedAt TEXT NOT NULL, Inserted INTEGER NOT NULL, Updated INTEGER NOT NULL,
    ResultChanged INTEGER NOT NULL, Unchanged INTEGER NOT NULL, PendingReviewCount INTEGER NOT NULL,
    ItemsJson TEXT NOT NULL, IssuesJson TEXT NOT NULL
)"""
NEW_INDEX_SQL = 'CREATE INDEX IF NOT EXISTS IX_InspectionImportBatches_Site_Id ON InspectionImportBatches (Site, Id)'


def _quote(name):
    return '"' + name.replace('"', '""') + '"'


def _columns(db, name):
    return db.execute('PRAGMA table_xinfo(' + _quote(name) + ')').fetchall()


def _selected(db, name, columns, lib):
    rows = db.execute('SELECT ' + ','.join(_quote(column[1]) for column in columns) + ' FROM ' + _quote(name))
    hashes = sorted(lib.digest([lib.cell(value) for value in row]) for row in rows)
    return {'rows':len(hashes), 'sha256':hashlib.sha256(''.join(hashes).encode()).hexdigest(),
            'columnsSha256':lib.digest(columns)}


def _stable(path):
    info = path.stat()
    return (info.st_dev, info.st_ino, info.st_mode, info.st_size, info.st_mtime_ns, info.st_ctime_ns)


def compare_qc(old_db, new_db, old_audit, new_audit, lib):
    """Return checks/details; any later business activity fails and needs classification.

    A preexisting PR964 table/column gets NO migration exception: the complete
    schema, sqlite_sequence and every typed value must remain strictly identical.
    """
    checks = {'closedInputAuditsMatchMetadata':False}
    details = {'scope':'qc-plan-data/qc-inspection.db', 'migration':'pr964-exact-additive',
               'oldBusinessValuesPrinted':False, 'inputDatabasesModified':False,
               'requiresScopedDifferenceClassification':True}
    try:
        paths = [pathlib.Path(old_db), pathlib.Path(new_db)]
        if not all(path.is_absolute() and path.is_file() and not path.is_symlink()
                   and not any(path.with_name(path.name + suffix).exists() for suffix in ('-wal','-shm','-journal'))
                   for path in paths):
            details['rejectedBoundary'] = 'closedRegularInputPaths'
            return {'passed':False, 'checks':checks, 'details':details}
        before_stats = [_stable(path) for path in paths]
        with contextlib.ExitStack() as stack:
            old, new = [stack.enter_context(contextlib.closing(lib.connect(path, True))) for path in paths]
            checks['closedInputAuditsMatchMetadata'] = lib.audit(old) == old_audit and lib.audit(new) == new_audit
            if not checks['closedInputAuditsMatchMetadata']:
                details['rejectedBoundary'] = 'metadataDoesNotDescribeClosedInputs'
                return {'passed':False, 'checks':checks, 'details':details}
            old_names = set(old_audit['tables'])
            if not set(OLD_TABLES).issubset(old_names) or 'sqlite_sequence' not in old_names:
                details['rejectedBoundary'] = 'expectedPopulatedOldQcSchema'
                return {'passed':False, 'checks':checks, 'details':details}
            existing = NEW_TABLE in old_names or any(any(column[1] == 'IsRead' for column in _columns(old, name)) for name in OLD_TABLES)
            if existing:
                details['comparisonMode'] = 'strict-existing-feature-schema'
                checks['completeSnapshotsStrictlyIdentical'] = old_audit == new_audit
            else:
                details['comparisonMode'] = 'exact-first-upgrade'
                checks['onlyDeclaredNewTable'] = set(new_audit['tables']) == old_names | {NEW_TABLE}
                expected_schema = [list(row) for row in old_audit['schema']]
                expected_new_table = None
                expected_columns = {}
                with sqlite3.connect(':memory:') as memory:
                    for table in OLD_TABLES:
                        rows = [row for row in old_audit['schema'] if row[:3] == ['table',table,table]]
                        if len(rows) != 1 or not isinstance(rows[0][3],str):
                            raise ValueError('unexpected table SQL')
                        memory.execute(rows[0][3])
                        memory.execute('ALTER TABLE ' + _quote(table) + ' ADD COLUMN IsRead INTEGER NOT NULL DEFAULT 0')
                        expected_columns[table] = _columns(memory,table)
                        sql = memory.execute('SELECT sql FROM sqlite_schema WHERE type=\'table\' AND name=?',(table,)).fetchone()[0]
                        expected_schema = [(['table',table,table,sql] if row[:3] == ['table',table,table] else row) for row in expected_schema]
                    memory.execute(NEW_TABLE_SQL)
                    memory.execute(NEW_INDEX_SQL)
                    memory.execute("ALTER TABLE InspectionImportBatches ADD COLUMN SeenRecordIdsJson TEXT NOT NULL DEFAULT '[]'")
                    expected_new_table = _selected(memory,NEW_TABLE,_columns(memory,NEW_TABLE),lib)
                    expected_schema.extend([list(row) for row in memory.execute('SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE tbl_name=?',(NEW_TABLE,))])
                    expected_columns[NEW_TABLE] = _columns(memory,NEW_TABLE)
                expected_schema.sort(key=lambda row:(row[0],row[1]))
                checks['exactDeclaredSchemaObjectsAndSql'] = expected_schema == new_audit['schema'] and lib.digest(expected_schema) == new_audit['schemaSha256']
                definitions = values = True
                original_tables = {}
                for table in sorted(old_names):
                    if table in OLD_TABLES:
                        definitions &= _columns(new,table) == expected_columns[table]
                        old_columns = _columns(old,table)
                        original_tables[table] = _selected(new,table,old_columns,lib) == old_audit['tables'][table]
                        values &= new.execute('SELECT COUNT(*) FROM '+_quote(table)+" WHERE typeof(IsRead)<>'integer' OR IsRead<>0").fetchone()[0] == 0
                    else:
                        original_tables[table] = new_audit['tables'].get(table) == old_audit['tables'][table]
                checks['oldColumnDefinitionsPlusOnlyIsReadIntegerNotNullDefaultZero'] = bool(definitions)
                checks['allNewIsReadValuesAreIntegerZero'] = bool(values)
                checks['allOriginalTablesColumnsAndTypedValuesPreserved'] = all(original_tables.values())
                checks['sqliteSequenceStrictlyIdentical'] = original_tables.get('sqlite_sequence') is True
                checks['exactNewImportBatchDefinitionAndEmpty'] = new_audit['tables'].get(NEW_TABLE) == expected_new_table and _columns(new,NEW_TABLE) == expected_columns[NEW_TABLE]
                details['changedOriginalTables'] = [table for table, passed in original_tables.items() if not passed]
                details['newImportBatchRows'] = new_audit['tables'].get(NEW_TABLE,{}).get('rows')
        checks['closedInputsStableDuringComparison'] = before_stats == [_stable(path) for path in paths]
    except Exception:
        checks['comparisonCompletedWithoutInvalidStructure'] = False
        details['rejectedBoundary'] = 'invalidOrChangedSnapshotStructure'
    passed = bool(checks) and all(value is True for value in checks.values())
    return {'passed':passed, 'checks':checks, 'details':dict(details, requiresScopedDifferenceClassification=not passed)}
