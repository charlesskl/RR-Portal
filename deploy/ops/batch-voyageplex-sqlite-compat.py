"""PR966 exact startup comparison of sealed, closed VoyagePlex SQLite copies.
No live paths, network, subprocesses, mailbox calls, restore, or input writes.
The caller must seal the observed copy and its audit BEFORE calling this helper.
Only the declared catalogue migration/new tables and known eligible Xingxin
MailContacts.UpdatedAt refresh are compatible; every other typed value is strict.
Compatibility does not establish which actor caused a timestamp change.
"""
import contextlib, datetime, hashlib, pathlib, re, sqlite3
SOURCE_HEAD = '9ce9445f60c4f623da993b6bda8c212796332ca2'
LIB_SHA = 'd63168fd3057f4f2aba2d93f9fab31d2d65c6dd0f3234877d71fcff1e04e62b9'
MARKER = 'HuadengThreeTemplateCatalogV1'
NEW_EMPTY = {'InventoryWritebacks','InventoryFileClaims','TaskEditAudits'}
SENTINEL = 'EXPECTED_RUNTIME_TIMESTAMP'
MARKER_SQL = '''CREATE TABLE IF NOT EXISTS VoyagePlexSchemaChanges (
    Name TEXT PRIMARY KEY NOT NULL, AppliedAt TEXT NOT NULL);'''
INVENTORY_SQL = '''CREATE TABLE IF NOT EXISTS InventoryWritebacks (
    Id INTEGER PRIMARY KEY AUTOINCREMENT, Company TEXT NOT NULL, TaskId INTEGER NOT NULL,
    OperationId TEXT NOT NULL, State TEXT NOT NULL, SnapshotJson TEXT NOT NULL, ResultJson TEXT NOT NULL,
    ActorId INTEGER NOT NULL, ActorName TEXT NOT NULL, CreatedAt TEXT NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS IX_InventoryWritebacks_Company_TaskId ON InventoryWritebacks(Company, TaskId);
CREATE TABLE IF NOT EXISTS InventoryFileClaims (Filename TEXT PRIMARY KEY NOT NULL, OperationId TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS TaskEditAudits (
    Id INTEGER PRIMARY KEY AUTOINCREMENT, Company TEXT NOT NULL, TaskId INTEGER NOT NULL,
    OwnerId INTEGER NOT NULL, ActorId INTEGER NOT NULL, ActorName TEXT NOT NULL, Action TEXT NOT NULL, CreatedAt TEXT NOT NULL);'''
NORMALIZE_SQL = '''UPDATE ExportTemplates SET IsDefault=0 WHERE Company='Huadeng';
UPDATE ExportTemplates SET IsEnabled=0, IsDefault=0
WHERE Company='Huadeng' AND Id NOT IN (
    SELECT MIN(Id) FROM ExportTemplates WHERE Company='Huadeng' AND
        ((LayoutKey='Standard' AND WeightRule='DisplayInteger') OR
         (LayoutKey='SkyCastle' AND ShipmentMode='Container' AND WeightRule='Template'))
    GROUP BY ShipmentMode, Purpose, LayoutKey
);
UPDATE ExportTemplates SET IsEnabled=1, IsDefault=CASE WHEN LayoutKey='Standard' THEN 1 ELSE 0 END,
    Name=CASE WHEN LayoutKey='SkyCastle' THEN 'SKY分柜特殊表'
              WHEN ShipmentMode='Container' THEN '普通走柜表' ELSE '普通交仓表' END
WHERE Company='Huadeng' AND Id IN (
    SELECT MIN(Id) FROM ExportTemplates WHERE Company='Huadeng' AND
        ((LayoutKey='Standard' AND WeightRule='DisplayInteger') OR
         (LayoutKey='SkyCastle' AND ShipmentMode='Container' AND WeightRule='Template'))
    GROUP BY ShipmentMode, Purpose, LayoutKey
);'''


def _time(value):
    if not isinstance(value, str):
        raise ValueError('timestamp type')
    text = value.strip().replace(' UTC', '+00:00').replace('Z', '+00:00')
    text = re.sub(r'\.(\d+)(?=[+-]|$)', lambda match:'.'+match.group(1)[:6].ljust(6,'0'), text)
    result = datetime.datetime.fromisoformat(text)
    return result.replace(tzinfo=datetime.timezone.utc) if result.tzinfo is None else result.astimezone(datetime.timezone.utc)


def _between(value, start, end):
    return isinstance(value, str) and start <= _time(value) <= end


def _stable(path):
    value = path.stat()
    return (value.st_dev,value.st_ino,value.st_mode,value.st_uid,value.st_gid,value.st_size,value.st_mtime_ns,value.st_ctime_ns)


def _rows(db, name):
    columns = [row[1] for row in db.execute('PRAGMA table_xinfo('+_quote(name)+')')]
    return [dict(zip(columns,row)) for row in db.execute('SELECT '+','.join(map(_quote,columns))+' FROM '+_quote(name))]


def _quote(value):
    return '"' + value.replace('"','""') + '"'


def _catalogue(memory):
    # Replay the exact fixed startup rule in memory, never the input copy.
    for company in ('Xingxin','Huadeng'):
        for mode in ('Container','Warehouse'):
            for purpose in ('Shipping','Warehouse'):
                name = ('华登' if company=='Huadeng' else '兴信') + ('柜' if mode=='Container' else '车（交仓）') + ('船务表' if purpose=='Shipping' else '仓务表')
                memory.execute('''INSERT INTO ExportTemplates
                    (Company,Name,ShipmentMode,Purpose,Version,Notes,WeightRule,LayoutKey,IsEnabled,IsDefault,UpdatedAt)
                    SELECT ?,?,?,?,'1.0','','Template','Standard',1,1,?
                    WHERE NOT EXISTS (SELECT 1 FROM ExportTemplates WHERE Company=? AND ShipmentMode=? AND Purpose=?)''',
                    (company,name,mode,purpose,SENTINEL,company,mode,purpose))
    memory.execute('''UPDATE ExportTemplates SET WeightRule='DisplayInteger',Version='2.0',
        Name='华登普通'||CASE WHEN ShipmentMode='Container' THEN '做柜' ELSE '交仓' END||CASE WHEN Purpose='Shipping' THEN '船务表' ELSE '仓务表' END,
        Notes='RR版式；件数×每箱重量，显示整数、保留底层小数；红字品牌。'
        WHERE Company='Huadeng' AND IsEnabled=1 AND IsDefault=1 AND LayoutKey='Standard' AND WeightRule='Template' AND Version='1.0' AND Notes=''
        AND Name IN ('华登柜船务表','华登柜仓务表','华登车（交仓）船务表','华登车（交仓）仓务表')''')
    memory.executescript(MARKER_SQL)
    if not memory.execute('SELECT 1 FROM VoyagePlexSchemaChanges WHERE Name=?',(MARKER,)).fetchone():
        for mode in ('Container','Warehouse'):
            for purpose in ('Shipping','Warehouse'):
                memory.execute('''INSERT INTO ExportTemplates
                    (Company,Name,ShipmentMode,Purpose,Version,Notes,WeightRule,LayoutKey,IsEnabled,IsDefault,UpdatedAt)
                    SELECT 'Huadeng','普通表',?,?,'2.0','RR版式；红字品牌。','DisplayInteger','Standard',1,0,?
                    WHERE NOT EXISTS (SELECT 1 FROM ExportTemplates WHERE Company='Huadeng' AND ShipmentMode=? AND Purpose=? AND LayoutKey='Standard' AND WeightRule='DisplayInteger')''',
                    (mode,purpose,SENTINEL,mode,purpose))
        for purpose in ('Shipping','Warehouse'):
            memory.execute('''INSERT INTO ExportTemplates
                (Company,Name,ShipmentMode,Purpose,Version,Notes,WeightRule,LayoutKey,IsEnabled,IsDefault,UpdatedAt)
                SELECT 'Huadeng','华登多柜特殊表','Container',?,'1.0','','Template','SkyCastle',1,0,?
                WHERE NOT EXISTS (SELECT 1 FROM ExportTemplates WHERE Company='Huadeng' AND LayoutKey='SkyCastle' AND ShipmentMode='Container' AND WeightRule='Template' AND Purpose=?)''',
                (purpose,SENTINEL,purpose))
        memory.executescript(NORMALIZE_SQL)
        memory.execute('INSERT INTO VoyagePlexSchemaChanges (Name,AppliedAt) VALUES (?,?)',(MARKER,SENTINEL))
    memory.executescript(INVENTORY_SQL)


def _sender(value):
    value = value or ''
    match = re.search(r'[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}',value,re.I|re.ASCII)
    return (match.group(0) if match else value.strip()).lower()


def compare_voyageplex(old_db, new_db, old_audit, new_audit, lib, window_start, window_end):
    """Return safe booleans/counts. Audit arguments bind both previously sealed copies.

    Both time bounds are UTC ISO timestamps enclosing actual API container startup.
    Any unclassified business activity fails; do not restore data or infer an actor.
    """
    checks = {'closedInputAuditsMatchMetadata':False}
    details = {'sourceHead':SOURCE_HEAD,'scope':'voyageplex-data/voyageplex.db',
               'inputDatabasesModified':False,'oldBusinessValuesPrinted':False,
               'timestampCauseOrActorProven':False}
    try:
        paths = [pathlib.Path(old_db),pathlib.Path(new_db)]
        if paths[0] == paths[1] or not all(path.is_absolute() and path.is_file() and not path.is_symlink()
                and not any(path.with_name(path.name+suffix).exists() for suffix in ('-wal','-shm','-journal')) for path in paths):
            raise ValueError('closedRegularInputPaths')
        start,end = _time(window_start),_time(window_end)
        if end < start:
            raise ValueError('invalidStartupWindow')
        checks['pinnedTypedAuditLibrary'] = hashlib.sha256(pathlib.Path(lib.__file__).read_bytes()).hexdigest()==LIB_SHA
        if not checks['pinnedTypedAuditLibrary']:
            raise ValueError('auditLibraryPin')
        before_stats = [_stable(path) for path in paths]
        with contextlib.ExitStack() as stack:
            old,new = [stack.enter_context(contextlib.closing(lib.connect(path,True))) for path in paths]
            checks['closedInputAuditsMatchMetadata'] = lib.audit(old)==old_audit and lib.audit(new)==new_audit
            if not checks['closedInputAuditsMatchMetadata']:
                raise ValueError('metadataDoesNotDescribeClosedInputs')
            old_names = set(old_audit['tables'])
            if not {'ExportTemplates','ShipmentTasks','Users','MailContacts','MailSyncStates','MailSystemSettings','ImportEmailItems'}.issubset(old_names):
                raise ValueError('expectedExistingVoyagePlexSchema')
            details['allOldTablesStrictlyIdentical'] = all(new_audit['tables'].get(name)==value for name,value in old_audit['tables'].items())
            details['oldTableNamesWithStrictDifferences'] = [name for name,value in old_audit['tables'].items() if new_audit['tables'].get(name)!=value]
            expected = stack.enter_context(contextlib.closing(sqlite3.connect(':memory:')))
            old.backup(expected)
            _catalogue(expected)
            # Bind only timestamps of rows the exact catalogue rule inserted.
            timestamp_ok = True
            old_catalogue_ids = {row['Id'] for row in _rows(old,'ExportTemplates')}
            inserted = [row for row in _rows(expected,'ExportTemplates') if row['Id'] not in old_catalogue_ids]
            observed_catalogue = {row['Id']:row for row in _rows(new,'ExportTemplates')}
            for row in inserted:
                current = observed_catalogue.get(row['Id'],{})
                value = current.get('UpdatedAt')
                if not _between(value,start,end):
                    timestamp_ok = False
                else:
                    expected.execute('UPDATE ExportTemplates SET UpdatedAt=? WHERE Id=?',(value,row['Id']))
            marker = expected.execute('SELECT AppliedAt FROM VoyagePlexSchemaChanges WHERE Name=?',(MARKER,)).fetchone()
            marker_existed = 'VoyagePlexSchemaChanges' in old_names and old.execute('SELECT 1 FROM VoyagePlexSchemaChanges WHERE Name=?',(MARKER,)).fetchone() is not None
            if marker and not marker_existed:
                observed_marker = new.execute('SELECT AppliedAt FROM VoyagePlexSchemaChanges WHERE Name=?',(MARKER,)).fetchone()
                if not observed_marker or not _between(observed_marker[0],start,end):
                    timestamp_ok = False
                else:
                    expected.execute('UPDATE VoyagePlexSchemaChanges SET AppliedAt=? WHERE Name=?',(observed_marker[0],MARKER))
            checks['onlyExpectedInsertedTimestampsWithinApiStartupWindow'] = timestamp_ok
            details['expectedInsertedCatalogueRows'] = len(inserted)
            # Unchanged existing main startup refreshes these Xingxin contact times.
            # Match only previously existing eligible contacts; counts/type/identity,
            # Huadeng contacts, mail rows, settings and every cursor remain strict.
            setting = old.execute('SELECT StartDate FROM MailSystemSettings WHERE Id=1').fetchone()
            if setting is None:
                raise ValueError('existingXingxinStartDate')
            senders = {_sender(row[0]) for row in old.execute("SELECT MailSender FROM ImportEmailItems WHERE Company='Xingxin' AND MailboxKey<>'' AND MailReceivedDate>=?",(setting[0],))}
            senders.discard('')
            contacts = {row['Id']:row for row in _rows(new,'MailContacts')}
            timestamp_rows = 0
            for row in _rows(old,'MailContacts'):
                if row.get('Company')!='Xingxin' or str(row.get('Email') or '').lower() not in senders:
                    continue
                observed = contacts.get(row['Id'])
                if observed and observed.get('UpdatedAt')!=row.get('UpdatedAt') and _between(observed.get('UpdatedAt'),start,end):
                    expected.execute('UPDATE MailContacts SET UpdatedAt=? WHERE Id=?',(observed['UpdatedAt'],row['Id']))
                    timestamp_rows += 1
            details['eligibleXingxinContactTimestampChanges'] = timestamp_rows
            checks['eligibleContactTimestampChangesCompatibleOnlyNotActorProven'] = True
            expected.commit()
            expected_audit = lib.audit(expected)
            checks['exactDeclaredSchemaObjectsAndSql'] = new_audit['schema']==expected_audit['schema'] and new_audit['schemaSha256']==expected_audit['schemaSha256']
            checks['exactFullTypedRowsAfterOnlyDeclaredStartupChanges'] = new_audit['tables']==expected_audit['tables']
            checks['newWritebackTablesInitiallyEmptyOrPreexistingStrictlyPreserved'] = all(
                (new_audit['tables'].get(name)==old_audit['tables'][name] if name in old_names else new_audit['tables'].get(name,{}).get('rows')==0)
                for name in NEW_EMPTY)
            unrelated = old_names-{'ExportTemplates','MailContacts','sqlite_sequence'}
            checks['allOtherOriginalBusinessTablesStrictlyIdentical'] = all(old_audit['tables'][name]==new_audit['tables'].get(name) for name in unrelated)
            checks['sqliteSequenceExactExpectedCatalogueInsertConsumption'] = new_audit['tables'].get('sqlite_sequence')==expected_audit['tables'].get('sqlite_sequence')
        checks['closedInputsStableDuringComparison'] = before_stats==[_stable(path) for path in paths]
    except Exception:
        checks['comparisonCompletedWithoutInvalidStructure'] = False
        details['rejectedBoundary'] = 'invalidMissingOrChangedClosedSnapshotStructure'
    passed = bool(checks) and all(value is True for value in checks.values())
    return {'passed':passed,'checks':checks,'details':dict(details,requiresScopedDifferenceClassification=not passed)}
