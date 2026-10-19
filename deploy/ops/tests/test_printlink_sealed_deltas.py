import decimal,hashlib,importlib.util,json,pathlib,sqlite3,unittest

SOURCE=pathlib.Path(__file__).resolve().parents[1]/'printlink-sealed-deltas.py'
spec=importlib.util.spec_from_file_location('sealed_deltas',SOURCE)
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)


def sqlite_value(v):
    if v is None:return ['null']
    if isinstance(v,bytes):return ['blob',v.hex()]
    if isinstance(v,int):return ['integer',str(v)]
    if isinstance(v,float):return ['real',v.hex()]
    return ['text',v]


LIB={'quote_identifier':lambda s:'"'+s.replace('"','""')+'"',
     'encoded':lambda v:json.dumps(v,ensure_ascii=True,separators=(',',':')).encode(),'sqlite_value':sqlite_value}


class SealedDeltaTests(unittest.TestCase):
    def pair(self,schema,rows0,rows1):
        dbs=[sqlite3.connect(':memory:')for _ in range(2)]
        for db,rows in zip(dbs,[rows0,rows1]):
            db.execute(schema)
            for row in rows:db.execute('INSERT INTO t VALUES ('+','.join('?'for _ in row)+')',row)
            db.commit();self.addCleanup(db.close)
        return dbs

    def test_full_typed_originals_preserved_and_only_new_row_added(self):
        a,b=self.pair('CREATE TABLE t(id TEXT PRIMARY KEY,value TEXT)',[('a','protected'),('b','unchanged')],[('a','protected'),('b','unchanged'),('c','new')])
        r,new,changes=m.compare(a,b,'t',LIB)
        self.assertEqual((r['removedRows'],r['changedOldRows'],r['addedRows']),(0,0,1));self.assertEqual(new[0]['id'],'c');self.assertEqual(changes,[])

    def test_same_count_changed_password_field_is_detected_without_outputting_it(self):
        a,b=self.pair('CREATE TABLE t(id TEXT PRIMARY KEY,password TEXT)',[('a','old-secret-hash')],[('a','changed-secret-hash')])
        r,new,changes=m.compare(a,b,'t',LIB)
        self.assertEqual(r['changedOldRows'],1);self.assertEqual(r['changedFieldCounts'],{'password':1})
        self.assertNotIn('secret-hash',json.dumps([r,new,changes]))

    def test_blob_text_and_high_precision_real_changes_are_not_lost(self):
        a,b=self.pair('CREATE TABLE t(id TEXT PRIMARY KEY,value)',[('a',b'a'),('b',1.000000000000001)],[('a','a'),('b',1.000000000000002)])
        r,_,_=m.compare(a,b,'t',LIB);self.assertEqual(r['changedOldRows'],2)

    def test_deletion_and_modified_original_event_prevent_append_only_claim(self):
        a,b=self.pair('CREATE TABLE t(id TEXT PRIMARY KEY,received TEXT)',[('a','old'),('b','kept')],[('b','changed'),('c','new')])
        r,_,_=m.compare(a,b,'t',LIB);self.assertEqual((r['removedRows'],r['changedOldRows'],r['addedRows']),(1,1,1))

    def test_json_null_absence_boolean_number_and_decimal_precision_are_distinct(self):
        self.assertEqual(m.paths({}, {'x':None}),[['x']])
        self.assertEqual(m.paths({'x':True},{'x':1}),[['x']])
        self.assertEqual(m.paths({'x':decimal.Decimal('1.000000000000000001')},{'x':decimal.Decimal('1.000000000000000002')}),[['x']])

    def test_fixed_device_payload_fields_are_classified_without_raw_values(self):
        a,b=self.pair('CREATE TABLE t(station TEXT,machine TEXT,payload TEXT,observed TEXT,PRIMARY KEY(station,machine))',
            [('s','1','{"state":"IDLE","nozzleTemp":20}','2026-10-19T01:00:00Z')],
            [('s','1','{"state":"RUNNING","nozzleTemp":21}','2026-10-19T02:00:00Z')])
        r,_,details=m.compare(a,b,'t',LIB)
        self.assertTrue(details[0]['fixedDeviceFieldsOnly']);self.assertEqual(details[0]['payloadPaths'],[['nozzleTemp'],['state']])
        self.assertNotIn('RUNNING',json.dumps([r,details]))

    def test_changed_schema_rejected(self):
        a,b=self.pair('CREATE TABLE t(id TEXT PRIMARY KEY,value)',[],[]);b.execute('ALTER TABLE t ADD COLUMN extra')
        with self.assertRaisesRegex(ValueError,'SCHEMA_CHANGED'):m.compare(a,b,'t',LIB)

    def test_only_immutable_ro_snapshot_connections_and_no_live_operations(self):
        s=SOURCE.read_text();self.assertIn('?mode=ro&immutable=1',s)
        for text in ['docker','/app/runtime','wal_checkpoint','/api/login','requests.','UPDATE ','DELETE ']:self.assertNotIn(text,s)


if __name__=='__main__':unittest.main()
