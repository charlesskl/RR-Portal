"""INERT root-bindable schema-only prepare/deploy/verify draft. No app/container restart.

Requires the separately reviewed diagnose.py. All blank pins must be bound after
normal protected PR approval/merge. Root owns publication and execution.
"""
import hashlib, importlib.util, json, os, pathlib, re, select, subprocess, sys, time

EXECUTE=True
DIAGNOSE_SHA='0aeb31f9a4aea3f9d67eb8489687d7a035aa8f7fd8ea34ede9c6bd56dace9f25'
DIAGNOSE_FILE='pr1053-preflight.py'
BRANCH='refs/heads/codex/ops-pr1053-20261102'
OUT_ROOT=pathlib.Path('/opt/rr-portal/deploy/backups/pr1053-schema-1-20261102')
APP='apps/印尼小组/印尼走货明细'
SCHEMA_PATH=APP+'/db/postgres_schema.sql'
SOURCE_BASE='a585d4369b810105a4778f99e3766b791116aecd'
REVIEWED_HEAD='47dfe8800b60090476d1ea51b7d9c1b8ab66f0cf'
SOURCE_BRANCH='codex/shipment-multi-outbound-link-20261102'
TARGET=''
APP_TREE='61606ef0d93d366b71ce7b3a1ea0e9c136bd9610'
SOURCE_BLOB_SHA256='e37f93e8c00089a6126cd8ef821e35e68110a5ef047dc1495a91f08701ddb7ab'
FRAGMENT_SHA256='a0828933380d53b7c9e61f438bd6555b474e2aca5ccaabc635c0444ba0d48a60'
EXPECTED_PREPARE_RESULT_SHA256=''
EXPECTED_DEPLOY_RESULT_SHA256=''
BEGIN_MARKER='-- BEGIN shipment-detail-text-20261102'
END_MARKER='-- END shipment-detail-text-20261102'
FIELDS=('qty_per_carton','pallet','po_no','contract_no','invoice_no')
REVIEWED_PATHS=('db/postgres_schema.sql', 'src/IndoShipping.Infrastructure/Persistence/AppDbContext.cs', 'tests/IndoShipping.Api.Tests/ShipmentMultiOutboundStorageTests.cs', 'tests/IndoShipping.Api.Tests/ShipmentTextStorageTests.cs', 'web/src/api/client.ts', 'web/src/pages/ShipmentsPage.tsx', 'web/src/utils/shipmentConsolidation.ts', 'web/src/utils/shipmentConsolidationSave.test.ts', 'web/src/utils/shipmentDecimal.ts', 'web/src/utils/shipmentOutboundBatchLink.test.ts', 'web/src/utils/shipmentOutboundBatchLink.ts', 'web/src/utils/shipmentOutboundLinkFlow.test.ts')
D=None
STAGE='entry'
MAX_ROWS_BYTES=64*1024**2
MAX_TABLE_BYTES=64*1024**2
SPACE_BUDGET=320*1024**2

def need(v,label):
    global STAGE
    STAGE=label
    if not v:raise RuntimeError(label)
def enc(v):return json.dumps(v,sort_keys=True,separators=(',',':'),ensure_ascii=True,allow_nan=False).encode()
def sha(v):return hashlib.sha256(v).hexdigest()
def pin(v,n=64):return type(v)is str and re.fullmatch('[a-f0-9]{%d}'%n,v)is not None
def private(name,body):
    D.write_private(name,body if type(body)is bytes else enc(body))
    fd=os.open(D.OUT,os.O_RDONLY|os.O_DIRECTORY)
    try:os.fsync(fd)
    finally:os.close(fd)
DISPOSITION={'state':'not-started','commitAttempted':False,'commitAcknowledged':False,'safeNextAction':'read-only-evidence-reconcile-no-mutation-retry'}
def checkpoint(name,**values):
    DISPOSITION.update(values)
    private('transaction-'+name+'.private.json',DISPOSITION)

def load():
    global D
    p=pathlib.Path(__file__).with_name(DIAGNOSE_FILE);need(p.is_file()and not p.is_symlink()and sha(p.read_bytes())==DIAGNOSE_SHA,'exact-reviewed-diagnostic-dependency')
    spec=importlib.util.spec_from_file_location('indo_text_diagnostic',p);D=importlib.util.module_from_spec(spec);spec.loader.exec_module(D)
def git(*args):return D.command(['git','-c','core.hooksPath=/dev/null',*args])
def source(mode):
    need(all(pin(v,40)for v in(SOURCE_BASE,REVIEWED_HEAD,APP_TREE))and pin(SOURCE_BLOB_SHA256)and pin(FRAGMENT_SHA256)and 0<len(REVIEWED_PATHS)<=16,'all-concrete-reviewed-source-pins')
    git('fetch','--no-write-fetch-head','origin','+refs/heads/main:refs/remotes/origin/main')
    if mode=='prepare':
        need(re.fullmatch(r'codex/[a-z0-9-]+',SOURCE_BRANCH)is not None,'fixed-reviewed-feature-branch')
        git('fetch','--no-write-fetch-head','origin','+refs/heads/'+SOURCE_BRANCH+':refs/remotes/origin/'+SOURCE_BRANCH)
        need(git('rev-parse','refs/remotes/origin/'+SOURCE_BRANCH).decode().strip()==REVIEWED_HEAD and git('rev-parse','refs/remotes/origin/main').decode().strip()==SOURCE_BASE,'exact-reviewed-feature-and-current-unmerged-main')
        selected=REVIEWED_HEAD
    else:
        need(pin(TARGET,40)and git('rev-parse','refs/remotes/origin/main').decode().strip()==TARGET,'actual-normally-merged-main-target')
        git('merge-base','--is-ancestor',REVIEWED_HEAD,TARGET);selected=TARGET
    need(git('rev-parse',selected+':'+APP).decode().strip()==APP_TREE==git('rev-parse',REVIEWED_HEAD+':'+APP).decode().strip(),'selected-source-and-reviewed-app-tree')
    paths=git('diff','--name-only','-z',SOURCE_BASE,selected,'--',APP).split(b'\0');paths={x.decode()for x in paths if x}
    need(paths=={APP+'/'+x for x in REVIEWED_PATHS},'exact-reviewed-app-paths')
    raw=git('show',selected+':'+SCHEMA_PATH);need(sha(raw)==SOURCE_BLOB_SHA256,'exact-reviewed-schema-source')
    text=raw.decode();need(text.count(BEGIN_MARKER)==text.count(END_MARKER)==1,'single-reviewed-migration-fragment')
    fragment=text.split(BEGIN_MARKER,1)[1].split(END_MARKER,1)[0].encode()
    need(sha(fragment)==FRAGMENT_SHA256,'exact-reviewed-marker-fragment')
    return fragment
def space():
    fs=os.statvfs('/var/lib/docker');available=fs.f_bavail*fs.f_frsize;free=fs.f_bfree*fs.f_frsize
    need(available>=1024**3+SPACE_BUDGET and free>=8*1024**3+SPACE_BUDGET,'ordinary-and-physical-reserve-plus-bounded-evidence-budget')
    return {'available':available,'free':free,'evidenceBudgetBytes':SPACE_BUDGET}
def web(app):
    root=pathlib.Path('/proc')/str(app['State']['Pid'])/'root'/'app/wwwroot';need(root.is_dir()and not root.is_symlink(),'existing-static-root')
    result={};total=0
    for p,dirs,names in os.walk(root,followlinks=False):
        for n in dirs:need(not(pathlib.Path(p)/n).is_symlink(),'no-static-directory-symlink')
        for n in sorted(names):
            path=pathlib.Path(p)/n;key=path.relative_to(root).as_posix();row=D.record(path);result[key]=row;total+=row['bytes'];need(len(result)<=1000 and total<=256*1024**2,'bounded-full-static-byte-inventory')
    need('index.html'in result and all(n in result for n in('template-customs.xlsx','template-customs-rri.xlsx','template-customs-rrm.xlsx')),'existing-index-and-all-three-templates')
    return {'files':result,'bytes':total,'sha256':sha(enc(result))}
def protection():
    runtime,app,db=D.runtime();connection=D.guard_connection(app,db);code=D.code_profile(app)
    return {'runtime':runtime,'host':D.host(),'code':code,'static':web(app),'connection':connection},app,db
def catalog_guard(c,after=False):
    safe=D.safe_postgres(c)
    need(c['table']['kind']=='r'and not c['table']['partition']and c['table']['parents']==c['table']['children']==0 and not c['table']['rowSecurity']and not c['table']['forceRowSecurity']and c['table']['totalBytes']<=MAX_TABLE_BYTES,'small-ordinary-unpartitioned-unfiltered-target')
    need(c['activeEventTriggerCount']==c['viewDependencyCount']==0 and all(t['internal']for t in c['triggers']),'no-custom-trigger-event-trigger-or-view-dependency')
    need(len(c['indexes'])==4 and all(i['knownDefinition']and i['valid']and i['ready']for i in safe['indexes']),'exact-four-known-valid-indexes')
    cols={x['name']:x for x in c['columns']};need(all(cols[n]['type']==('text'if after else'character varying(64)')for n in FIELDS)and cols['carton_group']['type']=='character varying(64)','only-five-input-text-types-and-original-internal-group-limit')
    po=next(x for x in c['indexes']if x['name']=='IX_shipment_items_po_no');need(po['method']==('hash'if after else'btree')and not po['unique']and not po['primary'],'known-po-equality-index-method')
    return safe
def psql_args(db):return ['docker','exec','-i',db['Id'],'sh','-c','exec psql -X -qAt --set=ON_ERROR_STOP=1 --username="${POSTGRES_USER:-rrportal}" --dbname="${POSTGRES_DB:-rrportal}"']
def query_sql():
    # Reuse precisely the reviewed catalog SELECT; transaction control is supplied by caller.
    s=D.SQL;return s[s.index('SELECT jsonb_build_object('):s.rindex('COMMIT;')]
ROWS_SQL="SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY id),'[]'::jsonb) FROM indo_shipping.shipment_items t;\n"
class Session:
    def __init__(self,db):
        self.db=db;self.buf=b'';self.committed=False;self.commit_attempted=False;self.backend_pid=None;self.backend_exit_verified=False;self.closed=False;self.cleanup_error=None
        # A per-session opaque tag also identifies a backend if the PID result is lost.
        self.application='rrportal-pr1053-'+os.urandom(12).hex();self.p=None
        try:
            self.p=subprocess.Popen(psql_args(db),cwd=D.ROOT,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
            self.send("SET idle_session_timeout='30s'; SET application_name='"+self.application+"'; SELECT pg_backend_pid();\n")
            raw=self.line(100);need(re.fullmatch(b'[1-9][0-9]{0,9}',raw)is not None,'own-psql-backend-pid');self.backend_pid=int(raw)
        except BaseException as original:
            # Constructors do not reach the caller's finally; close all owned handles here.
            try:self.close()
            except Exception as cleanup:
                self.cleanup_error=type(cleanup).__name__
                DISPOSITION.update(state='constructor-cleanup-failed-no-ddl-sent',constructorCleanupFailed=True,ownedChildExited=self.p is None or self.p.poll()is not None)
                raise RuntimeError('constructor-cleanup-failed-no-ddl-sent')from original
            DISPOSITION.update(constructorCleanupFailed=False,ownedBackendExited=self.backend_exit_verified,ownedChildExited=self.p is None or self.p.poll()is not None)
            raise
    def send(self,body):
        need(self.p is not None and self.p.poll()is None,'live-owned-readonly-or-single-ddl-session');self.p.stdin.write(body if type(body)is bytes else body.encode());self.p.stdin.flush()
    def line(self,limit=4*1024**2):
        end=time.monotonic()+25
        while b'\n'not in self.buf:
            remaining=end-time.monotonic();need(remaining>0,'bounded-psql-line-deadline')
            ready,_,_=select.select([self.p.stdout],[],[],remaining);need(bool(ready),'psql-result-before-timeout')
            chunk=os.read(self.p.stdout.fileno(),65536);need(bool(chunk),'psql-result-not-error-or-eof');self.buf+=chunk;need(len(self.buf)<=limit+65536,'bounded-psql-line')
        line,self.buf=self.buf.split(b'\n',1);need(len(line)<=limit,'bounded-complete-psql-line');return line
    def query(self,sql,limit=4*1024**2):self.send(sql);return self.line(limit)
    def close(self):
        if self.closed:return
        self.closed=True
        error=b''
        try:
            if self.p is not None:
                if self.p.poll()is None:
                    try:
                        if not self.committed and not self.commit_attempted:self.p.stdin.write(b'ROLLBACK;\n');self.p.stdin.flush()
                        self.p.stdin.close()
                    except (BrokenPipeError,OSError):pass
                    try:self.p.wait(timeout=3)
                    except subprocess.TimeoutExpired:
                        self.p.terminate()
                        try:self.p.wait(timeout=3)
                        except subprocess.TimeoutExpired:self.p.kill();self.p.wait(timeout=3)
                error=self.p.stderr.read(1024**2+1)
        finally:
            if self.p is not None:
                for stream in(self.p.stdin,self.p.stdout,self.p.stderr):
                    if stream is not None and not stream.closed:stream.close()
        need(len(error)<=1024**2,'bounded-private-psql-errors');private('psql-stderr.private.log',error)
        deadline=time.monotonic()+35
        # This is an observational query, never pg_terminate_backend or a second DDL.
        identity="application_name='"+self.application+"' AND datname=current_database()"
        if self.backend_pid is not None:identity+=" AND pid="+str(self.backend_pid)
        sql=("BEGIN READ ONLY; SET LOCAL statement_timeout='3s'; SELECT count(*) FROM pg_stat_activity WHERE "+identity+"; COMMIT;").encode()
        while True:
            active=D.command(psql_args(self.db),sql,timeout=5,limit=1024).strip();need(active in(b'0',b'1'),'typed-owned-session-exit-proof')
            if active==b'0':self.backend_exit_verified=True;break
            need(time.monotonic()<deadline,'own-session-exited-no-dangling-transaction-or-lock');time.sleep(.5)

def prepare(db):
    space();before,app,_=protection();catalog=D.postgres(db);raw=json.loads((D.OUT/'postgres-catalog.private.json').read_bytes());catalog_guard(raw)
    sizing_sql="BEGIN READ ONLY; SET LOCAL statement_timeout='20s'; SELECT jsonb_build_object('rowJsonBytes',(SELECT COALESCE(sum(octet_length(to_jsonb(t)::text)),0)+GREATEST(count(*)-1,0)*2+2 FROM indo_shipping.shipment_items t),'schemaTotalBytes',(SELECT COALESCE(sum(pg_total_relation_size(c.oid)),0) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='indo_shipping'AND c.relkind IN('r','m'))); COMMIT;"
    sizes=json.loads(D.command(psql_args(db),sizing_sql.encode(),timeout=25,limit=16384));need(set(sizes)=={'rowJsonBytes','schemaTotalBytes'}and all(type(x)is int and x>=0 for x in sizes.values())and sizes['rowJsonBytes']<=MAX_ROWS_BYTES and sizes['schemaTotalBytes']<=128*1024**2,'bounded-real-json-row-and-whole-schema-backup-estimates')
    private('sizing.private.json',sizes)
    dump=D.command(['docker','exec',db['Id'],'sh','-c','exec pg_dump --format=custom --schema=indo_shipping --username="${POSTGRES_USER:-rrportal}" --dbname="${POSTGRES_DB:-rrportal}"'],timeout=60,limit=128*1024**2)
    need(dump[:5]==b'PGDMP','real-consistent-schema-backup');private('indo-shipping-before.dump',dump)
    after,_,_=protection();need(before==after,'prepare-original-runtime-code-config-host-static-preserved')
    return {'catalog':catalog,'protection':before,'sizes':sizes,'backupSHA256':sha(dump),'backupBytes':len(dump),'backupIsSeparateConsistentPgDumpNotSameLaterDdlSnapshot':True}
def prior(mode,expected):
    p=OUT_ROOT/mode/'result.private.json';need(pin(expected)and p.is_file()and not p.is_symlink()and p.stat().st_size<4*1024**2,'sealed-earlier-success-result')
    raw=p.read_bytes();need(sha(raw)==expected,'earlier-result-body-sha256');v=json.loads(raw);need(v['success']is True and v['phase']==mode and v['sourceHead']==REVIEWED_HEAD and v['target']==(REVIEWED_HEAD if mode=='prepare'else TARGET),'successful-earlier-source-bound-phase');return v
def compare_catalog(before,after):
    catalog_guard(before);catalog_guard(after,True)
    old_po=next(i for i in before['indexes']if i['name']=='IX_shipment_items_po_no');new_po=next(i for i in after['indexes']if i['name']=='IX_shipment_items_po_no')
    need(after['table']['totalBytes']-before['table']['totalBytes']==new_po['sizeBytes']-old_po['sizeBytes'],'table-total-storage-delta-is-exactly-reviewed-po-index-size-delta')
    # CREATE INDEX may refresh reltuples from -1/an old estimate to its exact scan count.
    need(after['table']['rowsEstimate']in(before['table']['rowsEstimate'],after['aggregates']['rowCount']),'index-build-only-known-row-estimate-refresh')
    left=json.loads(json.dumps(before));right=json.loads(json.dumps(after))
    for c in left['columns']:
        if c['name']in FIELDS:c['type']='text'
    # Only this named nonunique index is intentionally rebuilt.
    for data in(left,right):
        for i in data['indexes']:
            if i['name']=='IX_shipment_items_po_no':
                i['method']='hash';i['definition']='known-po-equality-hash';i.pop('oid');i.pop('sizeBytes')
        data['table'].pop('totalBytes');data['table'].pop('rowsEstimate')
    need(left==right,'only-five-text-types-and-reviewed-po-index-change-in-same-snapshot')
def deploy(db,fragment):
    prepared=prior('prepare',EXPECTED_PREPARE_RESULT_SHA256);space();before,_,_=protection();need(before==prepared['details']['protection'],'current-runtime-code-config-host-static-equal-prepared')
    session=None;rows_before=b''
    checkpoint('00-opening',state='opening-owned-session')
    try:
        session=Session(db)
        checkpoint('01-open',state='open-not-committed',backendPID=session.backend_pid,application=session.application)
        session.send("BEGIN ISOLATION LEVEL REPEATABLE READ; SET LOCAL lock_timeout='1s'; SET LOCAL statement_timeout='20s'; SET LOCAL idle_in_transaction_session_timeout='30s'; SET LOCAL search_path TO indo_shipping,pg_catalog; LOCK TABLE indo_shipping.shipment_items IN ACCESS EXCLUSIVE MODE NOWAIT;\n")
        raw_before=session.query(query_sql());catalog_before=json.loads(raw_before);catalog_guard(catalog_before);private('locked-catalog-before.private.json',raw_before)
        old=json.loads((OUT_ROOT/'prepare'/'postgres-catalog.private.json').read_bytes())
        subset=lambda c:{k:c[k]for k in('columns','indexes','constraints','triggers','activeEventTriggerCount','viewDependencyCount')}
        need(subset(catalog_before)==subset(old),'locked-current-catalog-equals-reviewed-prepared-catalog')
        rows_before=session.query(ROWS_SQL,MAX_ROWS_BYTES);private('locked-rows-before.private.json',rows_before)
        session.send(fragment+b'\n')
        raw_after=session.query(query_sql());catalog_after=json.loads(raw_after);catalog_guard(catalog_after,True);private('locked-catalog-after.private.json',raw_after)
        rows_after=session.query(ROWS_SQL,MAX_ROWS_BYTES);private('locked-rows-after.private.json',rows_after)
        need(rows_before==rows_after,'all-locked-original-row-json-bytes-values-null-ids-exactly-preserved');compare_catalog(catalog_before,catalog_after)
        # Every comparison/evidence file AND directory entry is durable before COMMIT.
        checkpoint('10-commit-intent',state='commit-intent-durable-outcome-not-yet-known',rowBytes=len(rows_before),rowSHA256=sha(rows_before),beforeCatalogSHA256=sha(raw_before),afterCatalogSHA256=sha(raw_after),commitAttempted=True)
        session.commit_attempted=True
        session.send("COMMIT; SELECT 'committed-schema-only-release';\n")
        need(session.line()==b'committed-schema-only-release','explicit-commit-receipt');session.committed=True
        DISPOSITION.update(state='commit-acknowledged',commitAcknowledged=True)
        checkpoint('11-commit-ack',state='commit-acknowledged')
    except BaseException:
        if session is not None:
            DISPOSITION.update(commitAttempted=session.commit_attempted,commitAcknowledged=session.committed)
            DISPOSITION['state']='committed-postcheck-or-evidence-failed'if session.committed else'commit-outcome-uncertain-readonly-reconcile-required'if session.commit_attempted else'precommit-failed-rollback-required'
        else:DISPOSITION['state']='constructor-failed-cleanup-attempted-no-ddl-sent'
        raise
    finally:
        if session is not None:
            try:session.close();DISPOSITION['ownedBackendExited']=session.backend_exit_verified
            except Exception:
                DISPOSITION.update(cleanupFailed=True,state='committed-cleanup-failed'if session.committed else'commit-outcome-uncertain-cleanup-failed'if session.commit_attempted else'precommit-cleanup-failed')
                raise
        private('transaction-20-disposition.private.json',DISPOSITION)
    try:
        after,_,_=protection();need(before==after,'all-original-runtime-code-config-host-and-static-unchanged')
    except Exception:
        DISPOSITION['state']='committed-runtime-postcheck-failed';checkpoint('21-postcheck-failed');raise
    checkpoint('22-complete',state='committed-and-runtime-verified')
    return {'allOriginalTargetRowsExactWithinLockedTransaction':True,'rowBytes':len(rows_before),'rowSHA256':sha(rows_before),'sameTransactionCatalogCompared':True,'schemaOnlyCommit':True,'containerRestarts':False,'runtimeProtection':after,'crossTimeBusinessRowsCompared':False,'ownedBackendExitedNoDanglingLocks':session.backend_exit_verified,'disposition':dict(DISPOSITION)}

def reconcile(db):
    # Observation only: no source replay, transaction mutation, cursor reset or rollback.
    dep=OUT_ROOT/'deploy';need(dep.is_dir()and not dep.is_symlink(),'existing-failed-or-completed-deploy-evidence')
    journal={}
    for p in sorted(dep.glob('transaction-*.private.json')):
        need(p.is_file()and not p.is_symlink()and p.stat().st_size<65536,'bounded-private-transaction-journal');journal[p.name]=json.loads(p.read_bytes())
    catalog=D.postgres(db);raw=json.loads((D.OUT/'postgres-catalog.private.json').read_bytes())
    state='unrecognized-requires-manual-investigation'
    try:catalog_guard(raw,True);state='reviewed-text-hash-schema-observed'
    except Exception:
        try:catalog_guard(raw,False);state='original-varchar-btree-schema-observed'
        except Exception:pass
    return {'observedSchemaState':state,'catalog':catalog,'journal':journal,'mutationPerformed':False,'noAutomaticRetryOrRollback':True,'crossTimeRowEqualityClaim':False}

def verify(db):
    deployed=prior('deploy',EXPECTED_DEPLOY_RESULT_SHA256);before,_,_=protection();need(before==deployed['details']['runtimeProtection'],'runtime-code-config-static-still-equal-deploy-receipt')
    catalog=D.postgres(db);raw=json.loads((D.OUT/'postgres-catalog.private.json').read_bytes());catalog_guard(raw,True)
    after,_,_=protection();need(before==after,'verify-observation-runtime-stable')
    return {'catalog':catalog,'protectionUnchanged':True,'noCrossTimeBusinessRowEqualityClaim':True,'schemaOnlyNoBackendOrFrontendBinaryRevisionChange':True}
def main():
    need(EXECUTE is True and sys.argv[1:]in(['prepare'],['deploy'],['verify'],['reconcile'])and os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_MODE')==sys.argv[1]and os.environ.get('RELEASE_ATTEMPT')=='1','inert-explicit-first-phase')
    mode=sys.argv[1];load();os.umask(0o077);need(OUT_ROOT.parent.is_dir()and not any(p.is_symlink()for p in(OUT_ROOT.parent,*OUT_ROOT.parent.parents)),'private-release-parent')
    if mode=='prepare':need(not OUT_ROOT.exists(),'one-new-release-root');OUT_ROOT.mkdir(mode=0o700)
    need(OUT_ROOT.is_dir()and not OUT_ROOT.is_symlink(),'existing-owned-release-root');D.OUT=OUT_ROOT/mode;need(not D.OUT.exists(),'one-new-phase-evidence');D.OUT.mkdir(mode=0o700)
    v={'phase':mode,'target':REVIEWED_HEAD if mode=='prepare'else TARGET,'sourceHead':REVIEWED_HEAD,'success':False,'businessRowWrites':False,'configurationWrites':False,'lifecycleWrites':False}
    try:
        fragment=None if mode=='reconcile'else source(mode);_,_,db=protection();v['details']={'prepare':lambda:prepare(db),'deploy':lambda:deploy(db,fragment),'verify':lambda:verify(db),'reconcile':lambda:reconcile(db)}[mode]();v['success']=True
    except Exception as e:v.update(errorType=type(e).__name__,stage=STAGE,diagnosticStage=D.STAGE,disposition=dict(DISPOSITION))
    v['resultSHA256']=sha(enc(v));private('result.private.json',v);D.wire(v);return 0 if v['success'] else 1
if __name__=='__main__':sys.exit(main())
