"""INERT bounded read-only Indo shipment-text diagnosis. No lifecycle/config/SQL writes."""
import datetime, hashlib, importlib.util, json, os, pathlib, re, stat, subprocess, sys

ROOT = pathlib.Path('/opt/rr-portal')
OUT = ROOT / 'deploy/backups/pr1053-preflight-1-20261102'
BRANCH = 'refs/heads/codex/ops-pr1053-20261102'
EXECUTE = True
STAGE = 'entry'
TARGET_SERVICE = 'indo-shipping'
EXPECTED_CID = '58a9bc0a94611e21a4d8987edd85857fa3f53521ca649bafa3a166890cf3eb2a'
EXPECTED_IMAGE = 'sha256:79c441c8c2df6d6df6fcc475e865535c3ed5c4e884e56bcb1a2a772c5163b0a9'
REFERENCE = ROOT / 'deploy/backups/pr1046-1049-preflight-4/result.private.json'
REFERENCE_SHA = '4a55587a861e5d3acbc1c4f1382ae4ad820225363ec290e1c7b9816781fa5742'
CODE = tuple(p+s for p in ('IndoShipping.Api', 'IndoShipping.Domain', 'IndoShipping.Infrastructure') for s in ('.dll', '.pdb')) + ('db/postgres_schema.sql', 'seed/hs-dictionary.json')
SHARED = ('docker-compose.cloud.yml', 'frontend/index.cloud.html', 'nginx/nginx.cloud.conf', 'deploy/update-server.sh', 'deploy/service-maintenance.sh', '.env.cloud.production')
FIELDS = ('qty_per_carton', 'pallet', 'po_no', 'contract_no', 'invoice_no', 'carton_group')

def enc(v): return json.dumps(v, sort_keys=True, separators=(',', ':'), ensure_ascii=True, allow_nan=False).encode()
def sha(v): return hashlib.sha256(v).hexdigest()
def need(v, label):
    global STAGE
    STAGE = label
    if not v: raise RuntimeError(label)

def command(args, data=None, timeout=35, limit=16*1024**2):
    r = subprocess.run(args, cwd=ROOT, input=data, capture_output=True, timeout=timeout)
    need(len(r.stdout) <= limit and len(r.stderr) <= limit, 'bounded-command-streams')
    need(r.returncode == 0, 'fixed-readonly-command-success')
    return r.stdout

def write_private(name, body):
    need(re.fullmatch(r'[a-z0-9.-]+', name) is not None, 'fixed-private-evidence-name')
    fd = os.open(OUT/name, os.O_CREAT|os.O_EXCL|os.O_WRONLY|os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'wb') as f: f.write(body); f.flush(); os.fsync(f.fileno())

def record(p, limit=64*1024**2):
    need(not p.is_symlink(), 'regular-selected-file')
    fd = os.open(p, os.O_RDONLY|os.O_NOFOLLOW)
    try:
        a = os.fstat(fd)
        need(stat.S_ISREG(a.st_mode) and 0 <= a.st_size <= limit, 'bounded-selected-file')
        h = hashlib.sha256(); n = 0
        while True:
            b = os.read(fd, 1024**2)
            if not b: break
            n += len(b); need(n <= limit, 'bounded-selected-file-stream'); h.update(b)
        z = os.fstat(fd)
        key = lambda s: (s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns, s.st_ctime_ns, s.st_uid, s.st_gid, s.st_mode)
        need(key(a) == key(z) == key(p.lstat()) and n == a.st_size, 'stable-selected-file')
        return {'bytes': n, 'sha256': h.hexdigest(), 'mode': stat.S_IMODE(a.st_mode), 'uid': a.st_uid, 'gid': a.st_gid}
    finally: os.close(fd)

def envmap(values):
    result = {}
    for value in values:
        key, sep, item = value.partition('=')
        need(sep and re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]*', key) and key not in result, 'unique-env-keys')
        result[key] = item
    return result

def runtime():
    ids = command(['docker', 'ps', '-aq', '--no-trunc']).decode().split()
    need(len(ids) == len(set(ids)) == 46 and all(re.fullmatch('[a-f0-9]{64}', x) for x in ids), 'known-46-container-inventory')
    rows = json.loads(command(['docker', 'inspect', *ids]))
    need({r['Id'] for r in rows} == set(ids), 'complete-runtime-inspection')
    safe = {}
    for r in rows:
        s = r['State']
        safe[r['Id']] = {'image': r['Image'], 'configSHA256': sha(enc(r['Config'])), 'hostConfigSHA256': sha(enc(r['HostConfig'])),
            'envSHA256': sha(enc(sorted(r['Config'].get('Env') or []))), 'mountsSHA256': sha(enc(sorted(r['Mounts'], key=enc))),
            'pid': s['Pid'], 'started': s['StartedAt'], 'restarts': r['RestartCount'], 'running': s['Running'], 'oom': s['OOMKilled'], 'health': s.get('Health', {}).get('Status')}
    def one(service):
        found = [r for r in rows if (r['Config'].get('Labels') or {}).get('com.docker.compose.project') == 'rr-portal' and (r['Config'].get('Labels') or {}).get('com.docker.compose.service') == service]
        need(len(found) == 1, 'one-fixed-compose-service')
        r = found[0]
        need(r['State']['Running'] and not r['State']['OOMKilled'] and r['State'].get('Health', {}).get('Status') == 'healthy', 'fixed-service-running-healthy')
        return r
    return safe, one(TARGET_SERVICE), one('db')

def guard_connection(app, db):
    a = envmap(app['Config']['Env']); d = envmap(db['Config']['Env'])
    raw = command(['docker', 'exec', app['Id'], 'cat', '/proc/1/environ'], limit=1024**2)
    need(raw.endswith(b'\0'), 'complete-target-process-environment')
    p = envmap([x.decode() for x in raw.split(b'\0') if x])
    keys = ('DB_NAME', 'DB_USER', 'DB_PASSWORD', 'DB_SCHEMA', 'INDO_SHIPPING_JWT_KEY_B64')
    need(all(a.get(k) == p.get(k) for k in keys), 'actual-process-db-config-matches-configured')
    need(bool(p.get('DB_PASSWORD')) and bool(p.get('INDO_SHIPPING_JWT_KEY_B64')), 'actual-deploymentsecrets-override-path')
    need((p.get('DB_NAME') or 'rrportal') == (d.get('POSTGRES_DB') or 'rrportal') == 'rrportal' and (p.get('DB_USER') or 'rrportal') == (d.get('POSTGRES_USER') or 'rrportal') and p.get('DB_PASSWORD') == d.get('POSTGRES_PASSWORD') and (p.get('DB_SCHEMA') or 'indo_shipping') == 'indo_shipping', 'existing-target-db-identity')
    return {'schema': 'indo_shipping', 'database': 'rrportal', 'processDbConfigurationVerifiedInMemory': True, 'credentialsPersisted': False}

def reference_backend():
    need(REFERENCE.is_file() and not REFERENCE.is_symlink() and REFERENCE.stat().st_size < 4*1024**2, 'bounded-earlier-sealed-profile')
    reference_raw = REFERENCE.read_bytes(); need(sha(reference_raw) == REFERENCE_SHA, 'exact-pr1048-preflight-reference')
    old = json.loads(reference_raw)['targets']['indo-shipping']['backendFiles']
    need(type(old) is dict and set(old)==set(CODE), 'exact-reference-backend-profile-path')
    return old

def code_profile(app):
    need(app['Id'] == EXPECTED_CID and app['Image'] == EXPECTED_IMAGE and not app['Mounts'], 'exact-existing-unmounted-target')
    root = pathlib.Path('/proc')/str(app['State']['Pid'])/'root'/'app'
    need(root.is_dir() and not root.is_symlink(), 'target-app-root')
    current = {n: record(root/n, 32*1024**2) for n in CODE}
    old = reference_backend()
    need(set(old) == set(current) and all(current[n]['bytes'] == old[n]['bytes'] and current[n]['sha256'] == old[n]['sha256'] for n in current), 'same-proven-backend70590f-and-bootstrap-bytes')
    return current

SQL = r'''
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout='20s';
SET LOCAL lock_timeout='1s';
SET LOCAL search_path TO indo_shipping,pg_catalog;
SELECT jsonb_build_object(
  'serverVersionNum',current_setting('server_version_num')::int,
  'databaseMatches',current_database()='rrportal', 'schemaMatches',current_schema()='indo_shipping',
  'table', (SELECT jsonb_build_object('oid',c.oid::bigint,'kind',c.relkind,'partition',c.relispartition,'rowsEstimate',c.reltuples::bigint,'heapBytes',pg_relation_size(c.oid),'totalBytes',pg_total_relation_size(c.oid),'ownerHash',md5(c.relowner::text),'aclHash',md5(COALESCE(c.relacl::text,'')),'rowSecurity',c.relrowsecurity,'forceRowSecurity',c.relforcerowsecurity,'children',(SELECT count(*) FROM pg_inherits WHERE inhparent=c.oid),'parents',(SELECT count(*) FROM pg_inherits WHERE inhrelid=c.oid)) FROM pg_class c WHERE c.oid='indo_shipping.shipment_items'::regclass),
  'columns',(SELECT jsonb_agg(jsonb_build_object('name',a.attname,'number',a.attnum,'type',format_type(a.atttypid,a.atttypmod),'notNull',a.attnotnull,'identity',a.attidentity,'generated',a.attgenerated,'defaultHash',md5(COALESCE(pg_get_expr(d.adbin,d.adrelid),'')),'collationHash',md5(a.attcollation::text)) ORDER BY a.attnum) FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid='indo_shipping.shipment_items'::regclass AND a.attnum>0 AND NOT a.attisdropped),
  'indexes',(SELECT COALESCE(jsonb_agg(jsonb_build_object('name',c.relname,'definition',pg_get_indexdef(i.indexrelid),'method',am.amname,'unique',i.indisunique,'primary',i.indisprimary,'valid',i.indisvalid,'ready',i.indisready,'sizeBytes',pg_relation_size(i.indexrelid),'oid',i.indexrelid::bigint) ORDER BY c.relname),'[]'::jsonb) FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid JOIN pg_am am ON am.oid=c.relam WHERE i.indrelid='indo_shipping.shipment_items'::regclass),
  'constraints',(SELECT COALESCE(jsonb_agg(jsonb_build_object('name',c.conname,'type',c.contype,'definition',pg_get_constraintdef(c.oid),'validated',c.convalidated,'deferrable',c.condeferrable,'deferred',c.condeferred) ORDER BY c.conname),'[]'::jsonb) FROM pg_constraint c WHERE c.conrelid='indo_shipping.shipment_items'::regclass),
  'triggers',(SELECT COALESCE(jsonb_agg(jsonb_build_object('name',t.tgname,'internal',t.tgisinternal,'enabled',t.tgenabled,'functionBodyHash',md5(pg_get_functiondef(t.tgfoid))) ORDER BY t.tgname),'[]'::jsonb) FROM pg_trigger t WHERE t.tgrelid='indo_shipping.shipment_items'::regclass),
  'activeEventTriggerCount',(SELECT count(*) FROM pg_event_trigger WHERE evtenabled<>'D'),
  'viewDependencyCount',(SELECT count(*) FROM pg_depend d JOIN pg_rewrite r ON r.oid=d.objid WHERE d.refobjid='indo_shipping.shipment_items'::regclass),
  'aggregates',(SELECT jsonb_build_object('rowCount',count(*),'idMin',min(id),'idMax',max(id),'qtyPerCartonMaxChars',max(length(qty_per_carton)),'palletMaxChars',max(length(pallet)),'poNoMaxChars',max(length(po_no)),'contractNoMaxChars',max(length(contract_no)),'invoiceNoMaxChars',max(length(invoice_no)),'cartonGroupMaxChars',max(length(carton_group)),'sortedRowDigest',md5(COALESCE(string_agg(md5(to_jsonb(t)::text),'' ORDER BY id),''))) FROM shipment_items t),
  'sequences',(SELECT COALESCE(jsonb_agg(jsonb_build_object('name',sequencename,'start',start_value,'min',min_value,'max',max_value,'increment',increment_by,'cycle',cycle,'cache',cache_size,'last',last_value) ORDER BY sequencename),'[]'::jsonb) FROM pg_sequences WHERE schemaname='indo_shipping' AND sequencename IN (SELECT c.relname FROM pg_depend d JOIN pg_class c ON c.oid=d.objid WHERE d.refobjid='indo_shipping.shipment_items'::regclass AND c.relkind='S'))
);
COMMIT;
'''

def postgres(db):
    args = ['docker', 'exec', '-i', db['Id'], 'sh', '-c', 'exec psql -X -qAt --set=ON_ERROR_STOP=1 --username="${POSTGRES_USER:-rrportal}" --dbname="${POSTGRES_DB:-rrportal}"']
    raw = command(args, SQL.encode(), timeout=30, limit=4*1024**2)
    lines = raw.splitlines(); need(len(lines) == 1, 'one-readonly-pg-result')
    value = json.loads(lines[0]); safe = safe_postgres(value)
    # Arbitrary catalog definitions, including possible predicates/literals, remain private.
    write_private('postgres-catalog.private.json', enc(value))
    safe['rawCatalogSHA256'] = sha(enc(value))
    safe['observation'] = 'One repeatable-read read-only transaction; not atomic with separate runtime/log/capacity observations. Digest is MD5 aggregate for comparison, not a cryptographic provenance proof.'
    return safe

def safe_postgres(value):
    keys = {'serverVersionNum','databaseMatches','schemaMatches','table','columns','indexes','constraints','triggers','activeEventTriggerCount','viewDependencyCount','aggregates','sequences'}
    need(type(value) is dict and set(value) == keys and value['databaseMatches'] is True and value['schemaMatches'] is True and type(value['serverVersionNum']) is int and 120000 <= value['serverVersionNum'] < 200000, 'typed-actual-postgres-database-and-schema')
    number = lambda x: type(x) is int and x >= 0
    digest = lambda x: type(x) is str and re.fullmatch('[a-f0-9]{32}',x) is not None
    name = lambda x: type(x) is str and re.fullmatch('[A-Za-z_][A-Za-z0-9_]{0,127}',x) is not None
    t=value['table']; tkeys={'oid','kind','partition','rowsEstimate','heapBytes','totalBytes','ownerHash','aclHash','rowSecurity','forceRowSecurity','children','parents'}
    need(type(t) is dict and set(t)==tkeys and t['kind']=='r' and t['partition'] is False and type(t['rowsEstimate']) is int and t['rowsEstimate']>=-1 and all(number(t[k]) for k in ('oid','heapBytes','totalBytes','children','parents')) and all(type(t[k]) is bool for k in ('rowSecurity','forceRowSecurity')) and all(digest(t[k]) for k in ('ownerHash','aclHash')), 'typed-ordinary-target-table')
    safe={k:value[k] for k in ('serverVersionNum','databaseMatches','schemaMatches','table','activeEventTriggerCount','viewDependencyCount')}
    need(number(safe['activeEventTriggerCount']) and number(safe['viewDependencyCount']), 'typed-dependency-counts')
    for k in ('columns','indexes','constraints','triggers','sequences'):
        need(type(value[k]) is list and len(value[k])<=200, 'bounded-catalog-list')
    safe['columns']=[]
    for c in value['columns']:
        need(type(c) is dict and set(c)=={'name','number','type','notNull','identity','generated','defaultHash','collationHash'} and name(c['name']) and number(c['number']) and c['number']>0 and type(c['type']) is str and len(c['type'])<100 and type(c['notNull']) is bool and c['identity'] in ('','a','d') and c['generated'] in ('','s','v') and digest(c['defaultHash']) and digest(c['collationHash']), 'typed-column-catalog')
        rawtype=c['type']; known=re.fullmatch(r'(?:integer|bigint|smallint|text|jsonb|date|boolean|character varying\(\d{1,5}\)|numeric\(\d{1,3},\d{1,3}\)|timestamp\(\d\) without time zone)',rawtype)
        safe['columns'].append({**{k:c[k] for k in ('name','number','notNull','identity','generated','defaultHash','collationHash')},'type':rawtype if known else 'unknown-type','typeSHA256':sha(rawtype.encode())})
    need(set(FIELDS)<={c['name'] for c in safe['columns']} and len({c['name'] for c in safe['columns']})==len(safe['columns']), 'all-six-target-fields-present-unique')
    expected_index={
        'IX_shipment_items_po_no': {'CREATE INDEX "IX_shipment_items_po_no" ON indo_shipping.shipment_items USING '+m+' (po_no)' for m in ('btree','hash')},
        'IX_shipment_items_shipment': {'CREATE INDEX "IX_shipment_items_shipment" ON indo_shipping.shipment_items USING btree (shipment_id)'},
        'IX_shipment_items_outbound': {'CREATE INDEX "IX_shipment_items_outbound" ON indo_shipping.shipment_items USING btree (outbound_id)'},
        'shipment_items_pkey': {'CREATE UNIQUE INDEX shipment_items_pkey ON indo_shipping.shipment_items USING btree (id)'},
    }
    safe['indexes']=[]
    for i in value['indexes']:
        need(type(i) is dict and set(i)=={'name','definition','method','unique','primary','valid','ready','sizeBytes','oid'} and type(i['name']) is str and len(i['name'])<256 and type(i['definition']) is str and len(i['definition'])<65536 and i['method'] in ('btree','hash','gin','gist','spgist','brin') and all(type(i[k]) is bool for k in ('unique','primary','valid','ready')) and number(i['sizeBytes']) and number(i['oid']), 'typed-index-catalog')
        known=i['name'] in expected_index and i['definition'] in expected_index[i['name']]
        safe['indexes'].append({**{k:i[k] for k in ('method','unique','primary','valid','ready','sizeBytes','oid')},'name':i['name'] if i['name'] in expected_index else 'unknown-index','nameSHA256':sha(i['name'].encode()),'knownDefinition':known,'definition':i['definition'] if known else None,'definitionSHA256':sha(i['definition'].encode())})
    safe['constraints']=[]
    known_constraints={'shipment_items_pkey','FK_shipment_items_shipment','FK_shipment_items_material','FK_shipment_items_outbound'}
    for c in value['constraints']:
        need(type(c) is dict and set(c)=={'name','type','definition','validated','deferrable','deferred'} and type(c['name']) is str and len(c['name'])<256 and c['type'] in ('p','u','f','c','x','n') and type(c['definition']) is str and len(c['definition'])<65536 and all(type(c[k]) is bool for k in ('validated','deferrable','deferred')), 'typed-constraint-catalog')
        safe['constraints'].append({**{k:c[k] for k in ('type','validated','deferrable','deferred')},'name':c['name'] if c['name'] in known_constraints else 'unknown-constraint','nameSHA256':sha(c['name'].encode()),'definitionSHA256':sha(c['definition'].encode())})
    safe['triggers']=[]
    for t in value['triggers']:
        need(type(t) is dict and set(t)=={'name','internal','enabled','functionBodyHash'} and type(t['name']) is str and len(t['name'])<256 and type(t['internal']) is bool and t['enabled'] in ('O','D','R','A') and digest(t['functionBodyHash']), 'typed-trigger-catalog')
        safe['triggers'].append({**{k:t[k] for k in ('internal','enabled','functionBodyHash')},'nameSHA256':sha(t['name'].encode())})
    a=value['aggregates']; maxkeys={'qtyPerCartonMaxChars','palletMaxChars','poNoMaxChars','contractNoMaxChars','invoiceNoMaxChars','cartonGroupMaxChars'}
    need(type(a) is dict and set(a)=={'rowCount','idMin','idMax','sortedRowDigest'}|maxkeys and number(a['rowCount']) and all(a[k] is None or number(a[k]) for k in {'idMin','idMax'}|maxkeys) and digest(a['sortedRowDigest']), 'typed-aggregate-only-no-business-values')
    safe['aggregates']=a;safe['sequences']=[]
    for s in value['sequences']:
        need(type(s) is dict and set(s)=={'name','start','min','max','increment','cycle','cache','last'} and type(s['name']) is str and len(s['name'])<256 and all(type(s[k]) is int for k in ('start','min','max','increment','cache')) and type(s['cycle']) is bool and (s['last'] is None or type(s['last']) is int), 'typed-sequence-catalog')
        safe['sequences'].append({**{k:s[k] for k in ('start','min','max','increment','cycle','cache','last')},'name':s['name'] if s['name']=='shipment_items_id_seq' else 'unknown-sequence','nameSHA256':sha(s['name'].encode())})
    return safe

def logs(app):
    args = ['docker', 'logs', '--timestamps', '--since', '2026-11-02T00:00:00Z', '--tail', '20000', app['Id']]
    r = subprocess.run(args, cwd=ROOT, capture_output=True, timeout=25)
    need(r.returncode == 0 and len(r.stdout)+len(r.stderr) <= 16*1024**2, 'bounded-target-logs')
    # Docker separates stdout/stderr; retain both privately and never echo raw text.
    write_private('target-stdout.private.log', r.stdout); write_private('target-stderr.private.log', r.stderr)
    result = []
    for stream in (r.stdout, r.stderr):
        for line in stream.decode(errors='replace').splitlines():
            m = re.search(r'^(\d{4}-\d\d-\d\dT[0-9:.]+Z).*?Npgsql\.PostgresException[^\n]*?22001:\s*value too long for type character varying\((\d+)\)', line)
            if m: result.append({'utc': m[1], 'exception': 'Npgsql.PostgresException', 'sqlState': '22001', 'varcharLimit': int(m[2]), 'message': 'value too long for type character varying', 'stackLocationConfirmedInEarlier41369867272': 'ShipmentsController.Update line208 (detail INSERT)'})
    return {'capturedSinceUtc': '2026-11-02T00:00:00Z', 'stdoutBytes': len(r.stdout), 'stderrBytes': len(r.stderr), 'stdoutSHA256': sha(r.stdout), 'stderrSHA256': sha(r.stderr), 'matchingFailures': result, 'specificColumnOrPayloadNotLoggedOrProven': True}

def host():
    head = command(['git', '-c', 'core.hooksPath=/dev/null', 'rev-parse', 'HEAD']).decode().strip(); need(re.fullmatch('[a-f0-9]{40}', head), 'typed-host-head')
    raw = command(['git', '-c', 'core.hooksPath=/dev/null', 'diff', '--name-only', '-z'], limit=1024**2)
    cached = command(['git', '-c', 'core.hooksPath=/dev/null', 'diff', '--cached', '--name-only', '-z'], limit=1024**2)
    return {'head': head, 'dirtyCount': len([x for x in raw.split(b'\0') if x]), 'dirtyInventorySHA256': sha(raw), 'stagedCount': len([x for x in cached.split(b'\0') if x]), 'stagedInventorySHA256': sha(cached), 'selectedFiles': {n: record(ROOT/n, 8*1024**2) for n in SHARED}}

def wire(v):
    raw = enc(v); need(len(raw) <= 2*1024**2, 'bounded-safe-numeric-result')
    nib = lambda x: [int(c, 16) for c in (format(x, 'x') if type(x) is int else x)]
    parts = [raw[i:i+1024] for i in range(0,len(raw),1024)]; digest = nib(sha(raw))
    for i,b in enumerate(parts): print(enc([0,nib(i+1),nib(len(parts)),nib(len(raw)),digest,nib(b.hex())]).decode(), flush=True)
    print(enc([1,nib(len(parts)),nib(len(raw)),digest]).decode(), flush=True)

BACKEND_REVISION='70590f6d0dc1c691cfcc7c6b85c67e4a3574e571'
APP='apps/印尼小组/印尼走货明细'
CANONICAL='rr-portal-indo-shipping:latest'
EXPECTED_CANONICAL='sha256:60d7deef2fe58c1c6ca66977b43392c570f11e31cc7f6d38f12fad2f2d201cee'
PDB_FILE='portable-pdb-library.py'
PDB_SHA='cf66f655a1e166491c4da67da0824f42ac8cdae3f844044cb5d8f7233ba105c5'

def source_proof(app):
    p=pathlib.Path(__file__).with_name(PDB_FILE)
    need(p.is_file()and not p.is_symlink()and sha(p.read_bytes())==PDB_SHA,'exact-reviewed-pdb-reader')
    spec=importlib.util.spec_from_file_location('pr1053_pdb',p);mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
    root=pathlib.Path('/proc')/str(app['State']['Pid'])/'root/app';projects={}
    for project in ('IndoShipping.Api','IndoShipping.Domain','IndoShipping.Infrastructure'):
        prefix=APP+'/src/'+project
        paths=[x.decode()for x in command(['git','-c','core.hooksPath=/dev/null','ls-tree','-r','--name-only','-z',BACKEND_REVISION,'--',prefix]).split(b'\0')if x]
        docs={p[len(APP)+1:]:sha(command(['git','-c','core.hooksPath=/dev/null','show',BACKEND_REVISION+':'+p]))for p in paths if p.endswith('.cs')and '/bin/'not in p and '/obj/'not in p}
        need(docs,'nonempty-original-project-source')
        bodies={suffix:(root/(project+suffix)).read_bytes()for suffix in('.dll','.pdb')}
        projects[project]=mod.prove(bodies['.dll'],bodies['.pdb'],docs)
    return {'backendSource':BACKEND_REVISION,'projects':projects}

def static_profile(app,persist=True):
    root=pathlib.Path('/proc')/str(app['State']['Pid'])/'root/app/wwwroot';need(root.is_dir()and not root.is_symlink(),'real-static-root')
    files={};total=0
    for parent,dirs,names in os.walk(root,followlinks=False):
        need(all(not(pathlib.Path(parent)/n).is_symlink()for n in dirs),'static-no-symlink-directories')
        for n in sorted(names):
            path=pathlib.Path(parent)/n;key=path.relative_to(root).as_posix();row=record(path);files[key]=row;total+=row['bytes'];need(len(files)<=1200 and total<=256*1024**2,'bounded-all-old-static-files')
    need(all(n in files for n in('index.html','template-customs.xlsx','template-customs-rri.xlsx','template-customs-rrm.xlsx')),'all-three-original-templates')
    if persist:write_private('static-files.private.json',enc(files))
    return {'files':files,'bytes':total,'fileCount':len(files),'manifestSHA256':sha(enc(files))}

def canonical_profile():
    values=json.loads(command(['docker','image','inspect',CANONICAL],limit=4*1024**2));need(type(values)is list and len(values)==1,'one-canonical-image');v=values[0]
    need(v['Id']==EXPECTED_CANONICAL,'last-accepted-canonical-image')
    # Configuration can include secrets; hash it in memory and never persist values.
    return {'id':v['Id'],'configSHA256':sha(enc(v['Config'])),'rootFSSHA256':sha(enc(v['RootFS'])),'created':v['Created'],'bytes':v['Size']}

def gateway_auth():
    ids=command(['docker','ps','-aq','--no-trunc','--filter','label=com.docker.compose.project=rr-portal','--filter','label=com.docker.compose.service=nginx'],limit=4096).decode().split();need(len(ids)==1,'one-nginx')
    mounts=json.loads(command(['docker','inspect','--format','{{json .Mounts}}',ids[0]],limit=1024**2));selected=[m for m in mounts if m.get('Destination')=='/etc/nginx/.htpasswd'];need(len(selected)==1 and selected[0].get('Type')=='bind'and selected[0].get('RW')is False,'readonly-auth-bind')
    p=pathlib.Path(selected[0]['Source']);a=p.lstat();target=p.resolve(strict=True);meta=record(target);b=p.lstat();need((a.st_dev,a.st_ino,a.st_mode,a.st_mtime_ns,a.st_ctime_ns)==(b.st_dev,b.st_ino,b.st_mode,b.st_mtime_ns,b.st_ctime_ns),'stable-auth-binding')
    return {'file':meta,'sourceType':'LNK'if stat.S_ISLNK(a.st_mode)else'REG','sourcePathSHA256':sha(os.fsencode(str(p))),'linkTextSHA256':sha(os.fsencode(os.readlink(p)))if stat.S_ISLNK(a.st_mode)else None}

def capacity():
    fs=os.statvfs('/var/lib/docker');mem={}
    for line in pathlib.Path('/proc/meminfo').read_text().splitlines():
        k,_,v=line.partition(':')
        if k in('MemAvailable','MemTotal'):mem[k]=int(v.strip().split()[0])*1024
    need(set(mem)=={'MemAvailable','MemTotal'},'typed-memory')
    return {'available':fs.f_bavail*fs.f_frsize,'free':fs.f_bfree*fs.f_frsize,**mem}

def main():
    need(EXECUTE is True and sys.argv[1:] == ['diagnose'] and os.environ.get('RELEASE_BRANCH') == BRANCH and os.environ.get('RELEASE_MODE') == 'diagnose' and os.environ.get('RELEASE_ATTEMPT') == '1', 'explicit-inert-first-diagnosis')
    os.umask(0o077); need(OUT.parent.is_dir() and not any(p.is_symlink() for p in (OUT.parent,*OUT.parent.parents)) and not OUT.exists(), 'fresh-own-private-evidence-directory'); OUT.mkdir(mode=0o700)
    v = {'phase':'diagnose','success':False,'readOnly':True,'businessWrites':False,'configurationWrites':False,'lifecycleWrites':False,'credentialsPersisted':False,'startedUtc':datetime.datetime.now(datetime.timezone.utc).isoformat()}
    try:
        before,app,db = runtime(); h = host(); code = code_profile(app)
        v.update(allRuntime=before, host=h, backendFiles=code, backendSourceProof=source_proof(app), static=static_profile(app), canonical=canonical_profile(), gatewayAuth=gateway_auth(), targetConnection=guard_connection(app,db), postgres=postgres(db), logs=logs(app))
        stats = json.loads(command(['docker','stats','--no-stream','--format','{{json .}}',app['Id']],timeout=15,limit=16384))
        v['targetResources'] = {k:stats.get(k) for k in ('CPUPerc','MemUsage','MemPerc','PIDs')}
        v['space']=capacity()
        after,app2,db2 = runtime()
        need(before == after and h == host() and code == code_profile(app2) and db['Id'] == db2['Id'] and v['static']==static_profile(app2,False) and v['canonical']==canonical_profile() and v['gatewayAuth']==gateway_auth(), 'runtime-code-config-host-static-image-auth-unchanged-by-observation')
        v['success'] = True
    except Exception as e: v.update(errorType=type(e).__name__,stage=STAGE)
    v['finishedUtc']=datetime.datetime.now(datetime.timezone.utc).isoformat(); v['resultSHA256']=sha(enc(v)); write_private('result.private.json',enc(v)); wire(v)
    return 0 if v['success'] else 1

if __name__ == '__main__': sys.exit(main())
