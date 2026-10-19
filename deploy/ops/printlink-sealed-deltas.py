"""Compare only two sealed immutable SQLite snapshots; never access live business DBs."""
import collections,decimal,hashlib,importlib.util,json,pathlib,sqlite3
VERIFY_SHA='57aa2c480698588026dfe73268e4e10b36009f1693a7e05cb525e11ada809a05'
POST_RESULT='e77b8809b0366cd6063b718bd6f29ccda866779977b10ec337007ad3a81efcf9'
POST_MANIFEST='8c9248802cfa519213aa9ca808a1bd72e21b73ecfa32cc8949eefda1ca6bd3fe'
DEVICE_KEYS=set('sourceMachine name gcodeFile jobName error remainingTime nozzleTemp nozzleTarget bedTemp bedTarget layerNum totalLayers currentHeight laserPowerMw state progress connected'.split())


def paths(a,b,p=()):
    if isinstance(a,dict)and isinstance(b,dict):return [r for k in sorted(set(a)|set(b))for r in ([list(p+(k,))]if k not in a or k not in b else paths(a[k],b[k],p+(k,)))]
    if isinstance(a,list)and isinstance(b,list)and len(a)==len(b):return [r for i,(x,y)in enumerate(zip(a,b))for r in paths(x,y,p+(str(i),))]
    if type(a)is type(b)and a==b:return []
    return [list(p)]


def compare(db0,db1,table,lib):
    q=lib['quote_identifier'];meta=db0.execute('PRAGMA table_xinfo('+q(table)+')').fetchall()
    if meta!=db1.execute('PRAGMA table_xinfo('+q(table)+')').fetchall():raise ValueError('SCHEMA_CHANGED')
    names=[r[1]for r in meta];keys=[r[1]for r in sorted(meta,key=lambda r:r[5])if r[5]]
    if not keys:raise ValueError('PRIMARY_KEY_REQUIRED')
    typed=lambda values:lib['encoded']([lib['sqlite_value'](v)for v in values])
    rows=lambda db:db.execute('SELECT '+','.join(map(q,names))+' FROM '+q(table))
    original={};before_count=0
    for row in rows(db0):
        d=dict(zip(names,row));key=typed(d[k]for k in keys)
        if key in original or len(key)>4096 or len(original)>=300000:raise ValueError('BOUNDED_UNIQUE_TYPED_KEYS')
        original[key]=hashlib.sha256(typed(row)).hexdigest();before_count+=1
    added=[];changes=[];fields=collections.Counter();times=[];after_count=0;seen=set()
    for row in rows(db1):
        d=dict(zip(names,row));key=typed(d[k]for k in keys);old=original.pop(key,None);after_count+=1
        if key in seen or len(seen)>=300000:raise ValueError('BOUNDED_UNIQUE_AFTER_KEYS')
        seen.add(key)
        if old is None:
            if len(added)>=1000:raise ValueError('BOUNDED_ADDITIONS')
            added.append(d)
            if isinstance(d.get('received'),str):times.append(d['received'])
        elif old!=hashlib.sha256(typed(row)).hexdigest():
            if len(changes)>=1000:raise ValueError('BOUNDED_CHANGED_ROWS')
            prior=db0.execute('SELECT '+','.join(map(q,names))+' FROM '+q(table)+' WHERE '+' AND '.join(q(k)+' IS ?'for k in keys),tuple(d[k]for k in keys)).fetchall()
            if len(prior)!=1:raise ValueError('EXACT_PRIOR_ROW_REQUIRED')
            b=dict(zip(names,prior[0]));changed=[k for k in names if lib['sqlite_value'](b[k])!=lib['sqlite_value'](d[k])]
            fields.update(changed);detail={'keySHA256':hashlib.sha256(key).hexdigest(),'fields':changed}
            for field in ['payload','value']:
                if field in changed and (field=='payload'or table=='business_sync_state'):
                    a=json.loads(b[field],parse_float=decimal.Decimal);z=json.loads(d[field],parse_float=decimal.Decimal)
                    detail[field+'Paths']=paths(a,z)
                    detail[field+'JSONEncodingOnlyChanged']=not detail[field+'Paths']
                    if field=='payload':detail['fixedDeviceFieldsOnly']=isinstance(a,dict)and isinstance(z,dict)and set(a)|set(z)<=DEVICE_KEYS
            for field in ['observed','last_seen']:
                if field in changed:detail[field+'Window']={'before':b[field],'after':d[field]}
            if 'sequence'in changed:detail['sequenceWindow']={'before':b['sequence'],'after':d['sequence']}
            changes.append(detail)
    return {'columns':names,'beforeRows':before_count,'afterRows':after_count,'removedRows':len(original),
        'changedOldRows':len(changes),'addedRows':len(added),'changedFieldCounts':dict(fields),
        'addedReceivedWindow':{'first':min(times),'last':max(times)}if times else None},added,changes


def main():
    source=pathlib.Path(__file__).with_name('printlink-post-health-verify.py')
    if hashlib.sha256(source.read_bytes()).hexdigest()!=VERIFY_SHA:raise ValueError('REVIEWED_VERIFIER_PIN')
    spec=importlib.util.spec_from_file_location('verified_acceptance',source);v=importlib.util.module_from_spec(spec);spec.loader.exec_module(v);lib=v.library()
    archives=[(v.BACKUP,v.BACKUP_RESULT_SHA,v.BACKUP_MANIFEST_SHA),(v.OUTPUT,POST_RESULT,POST_MANIFEST)]
    protected=[]
    for directory,result_sha,manifest_sha in archives:
        if lib['file_hash'](directory/'first-result.json')!=result_sha or lib['file_hash'](directory/'manifest.json')!=manifest_sha:raise ValueError('EXACT_SEALED_SNAPSHOT_RECEIPTS')
        manifest=json.loads((directory/'manifest.json').read_bytes())
        for relative in ['sqlite-audits.private.json','sqlite-snapshots/orders/printlink.sqlite','sqlite-snapshots/production.sqlite']:
            file=directory/relative
            if file.is_symlink()or lib['file_hash'](file)!=manifest[relative]:raise ValueError('SEALED_SNAPSHOT_BYTES_REQUIRED')
            protected.append((file,manifest[relative]))
        protected.extend([(directory/'first-result.json',result_sha),(directory/'manifest.json',manifest_sha)])
    audits=[json.loads((d/'sqlite-audits.private.json').read_bytes())for d,_,_ in archives]
    if json.loads((v.OUTPUT/'first-result.json').read_bytes())['strictPreservationVerified']is not False:raise ValueError('ORIGINAL_FALSE_RESULT_REQUIRED')
    output=v.ROOT/'deploy/backups/printlink-sealed-delta-20261019';output.mkdir(mode=0o700)
    result={'comparisonComplete':False,'onlyClosedSealedSnapshotsRead':True,'originalStrictResultRemainsFalse':True,'newUserActorEstablished':False};private={};dbs=[]
    try:
        for directory,_,_ in archives:
            pair={name:sqlite3.connect((directory/'sqlite-snapshots'/name).as_uri()+'?mode=ro&immutable=1',uri=True)for name in ['orders/printlink.sqlite','production.sqlite']}
            for db in pair.values():db.execute('PRAGMA query_only=ON')
            dbs.append(pair)
        summaries={}
        for table in ['users','collector_events','collector_devices','collector_stations','business_sync_state']:
            database='production.sqlite'if table=='business_sync_state'else'orders/printlink.sqlite'
            summary,added,changes=compare(dbs[0][database],dbs[1][database],table,lib);summaries[table]=summary;private[table]={'changes':changes}
            if table=='users':new_users=added
            if table=='collector_events':private[table]['addedEvents']=added
        result['tables']=summaries
        result['allOriginalUsersRetained']=summaries['users']['removedRows']==summaries['users']['changedOldRows']==0
        result['allOriginalCollectorEventsRetained']=summaries['collector_events']['removedRows']==summaries['collector_events']['changedOldRows']==0
        allowed={'orders/printlink.sqlite':{'users','collector_events','collector_devices','collector_stations'},'production.sqlite':{'business_sync_state'}}
        result['allOtherTablesFullyTypedUnchanged']=set(audits[0])==set(audits[1])==set(allowed)and all(audits[0][name]['schemaSha256']==audits[1][name]['schemaSha256']and {k:r for k,r in audits[0][name]['tables'].items()if k not in allowed[name]}=={k:r for k,r in audits[1][name]['tables'].items()if k not in allowed[name]}for name in allowed)
        result['accountEventsFullyTypedUnchanged']=audits[0]['orders/printlink.sqlite']['tables']['account_events']==audits[1]['orders/printlink.sqlite']['tables']['account_events']
        result['businessSnapshotFullyTypedUnchanged']=audits[0]['production.sqlite']['tables']['snapshot']==audits[1]['production.sqlite']['tables']['snapshot']
        result['fixedDeviceTelemetryFieldsOnly']=all(set(c['fields'])<={'payload','observed'}and c.get('fixedDeviceFieldsOnly',True)for c in private['collector_devices']['changes'])
        result['stationSequenceAndLastSeenOnly']=set(summaries['collector_stations']['changedFieldCounts'])<={'sequence','last_seen'}
        state_changes=private['business_sync_state']['changes'];state_paths=[p for c in state_changes for p in c.get('valuePaths',[])]
        result['syncMetadataChangedSchemaFieldCounts']=dict(collections.Counter(p[0]if p and p[0]in {'lastSuccess','receipt','clientId','station','activated','conflicts','choices','productRemaps'}else'OTHER_FIELD'for p in state_paths))
        result['onlyReceiptAndSuccessTimeChanged']=all(set(c['fields'])=={'value'}and not c.get('valueJSONEncodingOnlyChanged')for c in state_changes)and all(p and p[0]in {'lastSuccess','receipt'}for p in state_paths)
        snapshot=json.loads(dbs[0]['production.sqlite'].execute('SELECT value FROM snapshot WHERE id=1').fetchone()[0],parse_float=decimal.Decimal)
        def strings(value):
            if isinstance(value,str):yield value
            elif isinstance(value,dict):
                for child in value.values():yield from strings(child)
            elif isinstance(value,list):
                for child in value:yield from strings(child)
        private['newUsers']=[{'id':u['id'],'role':u['role'],'factory':u['factory'],'factory_scope':u.get('factory_scope'),
            'usernameSHA256':hashlib.sha256(u['username'].encode()).hexdigest(),'nameSHA256':hashlib.sha256(u['name'].encode()).hexdigest(),
            'usernameStringAlreadyInBusinessSnapshot':any(s==u['username']for s in strings(snapshot)),
            'nameStringAlreadyInBusinessSnapshot':any(s==u['name']for s in strings(snapshot))}for u in new_users]
        result['newUserStringMembershipCounts']={key:sum(u[key]for u in private['newUsers'])for key in ['usernameStringAlreadyInBusinessSnapshot','nameStringAlreadyInBusinessSnapshot']}
        result['startupEmptyUsersPredicateWasFalseBefore']=summaries['users']['beforeRows']>0
        if not all(lib['file_hash'](file)==sha for file,sha in protected):raise ValueError('RETAINED_SNAPSHOT_BYTES_CHANGED')
        result['comparisonComplete']=True
    finally:
        for pair in dbs:
            for db in pair.values():db.close()
        lib['private_write'](output/'details.private.json',lib['encoded'](private));lib['private_write'](output/'first-result.json',lib['encoded'](result));lib['seal'](output)
    print(json.dumps(result,ensure_ascii=False,sort_keys=True,separators=(',',':')))
    print(json.dumps({'resultSHA256':lib['file_hash'](output/'first-result.json'),'sealSHA256':lib['file_hash'](output/'manifest.json')},sort_keys=True))
    return 0 if result['comparisonComplete']and result['allOriginalUsersRetained']and result['allOriginalCollectorEventsRetained']and result['allOtherTablesFullyTypedUnchanged']else 1


if __name__=='__main__':
    try:raise SystemExit(main())
    except Exception:print('{"comparisonComplete":false,"safeFailure":"SEALED_SNAPSHOT_DELTA_CHECK_FAILED"}');raise SystemExit(1)
