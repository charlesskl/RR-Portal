"""PR996 indo-shipping-only backup. Draft: execution gate is false.

Only read-only PostgreSQL exported snapshot/dump and container inspections.
No HTTP, model calls, signals, maintenance changes or mail access.
Only indo_shipping PostgreSQL exported read-only snapshots and custom dumps.
Sequence values are independently bracketed, not an MVCC atomic guarantee.
"""
import contextlib,datetime,hashlib,importlib.util,io,json,os,pathlib,re,shutil,signal,stat,sys,tarfile,traceback

ROOT=pathlib.Path('/opt/rr-portal')
BASE='6742f820c0a43388e274b867a2825a42548b5cea'
BASE_TREE='ce652db9eb263e09d24a3f44ef0c48a5c1f7b79e'
BRANCH='refs/heads/ops/pr-996-20261023-03'
BACKUP_PIN=True
OUT=ROOT/'deploy/backups/pr-996-20261023-03-backup'
INDO='apps/印尼小组/印尼走货明细'
APPS=('apps/印尼小组/印尼走货明细',)
ORDER=('indo-shipping',)
SERVICES=set(ORDER)
STORAGE={}
EXPECTED_ROOTS={'indo-shipping':[]}
STARTUP_FILES=('db/postgres_schema.sql','src/IndoShipping.Api/Program.cs','src/IndoShipping.Api/Features/Bootstrap/ProductionSeeder.cs','src/IndoShipping.Api/Features/Bootstrap/DataMigrations.cs','src/IndoShipping.Infrastructure/Persistence/DatabaseCompatibility.cs','src/IndoShipping.Api/DeploymentSecrets.cs')
FIXED=('docker-compose.cloud.yml','nginx/nginx.cloud.conf','deploy/update-server.sh','deploy/service-maintenance.sh','.github/workflows/deploy.yml','.env.example',*(INDO+'/'+n for n in('Dockerfile','.dockerignore',*STARTUP_FILES)))
PG_SHELL='exec psql -X -q -At -v ON_ERROR_STOP=1 -U "${POSTGRES_USER:-rrportal}" -d "${POSTGRES_DB:-rrportal}"'
DEPS={'factory-review-backup-library.py': '79d76bb47312dd08c121ebe2797f54d958666f8b72d00721f67712b152fc4666', 'release-data-ops-library.py': 'ff9138a1d5bfed1b10077112da6ebcda2d65240f583e2d0e12ce1325cfbaafd5', 'release-data-library.py': 'd63168fd3057f4f2aba2d93f9fab31d2d65c6dd0f3234877d71fcff1e04e62b9', 'qc-source-library.py': '4745c90f126cf46106b0f170a3ebc6b24ccb64c0e963e427d13308d5cb5b54f5', 'portable-pdb-library.py': 'cf66f655a1e166491c4da67da0824f42ac8cdae3f844044cb5d8f7233ba105c5'}
PRIOR_INDO_TARGET='9b890cc016da403f929f8a7aaeddb878d3de24c5'
PRIOR_INDO_TREE='e322834bbbd43082854d8c564192c3ca1e097534'
PRIOR_INDO_IMAGE='sha256:037bae64802a4efa7bc3e33d50e412b88c76f0de674304fd184f051c4c09861d'
PRIOR_INDO_PREPARE=ROOT/'deploy/backups/batch-977-978-979-20261021-prepare'
PRIOR_INDO_PREPARE_MANIFEST='30f76a7b7832c31491c3353750658409fcad45ee4556ebaba8055f58dd7986d8'
PRIOR_INDO_PREPARE_RESULT='e46732d9424a132508521d618a76f793b798509b6d6b9339087e04885af2f79e'
PRIOR_INDO_VERIFY=ROOT/'deploy/backups/batch-977-978-979-20261021-verify-finalized-03'
PRIOR_INDO_VERIFY_MANIFEST='48ef2e5bccf8ccde954a3820db1c65aa87b1346f6972f3ef2c0e31d22d4c55ce'
PRIOR_INDO_VERIFY_RESULT='d801f200e0c0994f3e2656b6f3a5b5674962e83e74d580ad243831458838ea47'
F=None;Q=None;STAGE='entrypoint';RUNTIME_SERIAL=0

def need(v,label):
 global STAGE
 if not v:STAGE=label;raise RuntimeError('PR996_BACKUP_REJECTED')
def safe_stage(v):return v if type(v)is str and re.fullmatch('[A-Za-z0-9_.-]{1,160}',v)else'unavailable'
def enc(v):return json.dumps(v,ensure_ascii=True,sort_keys=True,separators=(',',':'),allow_nan=False).encode()
def sha(v):return hashlib.sha256(v).hexdigest()
def read(p):return json.loads(p.read_bytes())
def private(n,v):F.OPS.L.private_write(OUT/n,v if type(v)is bytes else enc(v))
def run(a,data=None,timeout=180):return F.run(a,data,timeout)
def load(name):
 p=pathlib.Path(__file__).with_name(name);need(p.is_file()and not p.is_symlink()and sha(p.read_bytes())==DEPS[name],'dependency-pin');s=importlib.util.spec_from_file_location(name.replace('.','_'),p);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
def initialize(out):
 global F,Q,OUT
 OUT=out
 for n,h in DEPS.items():
  p=pathlib.Path(__file__).with_name(n);need(p.is_file()and not p.is_symlink()and sha(p.read_bytes())==h,'all-five-transitive-dependency-pins-before-import')
 F=load('factory-review-backup-library.py');need(F.BACKUP_PIN is False and F.DEPLOY_PIN is False and F.VERIFY_PIN is False,'inert-factory-library');F.BASE=BASE;F.ROOT=ROOT;F.APP=ROOT/INDO;F.OUT=OUT;F.OPS=load('release-data-ops-library.py');F.OPS.L=load('release-data-library.py');F.OPS.L.databases=F.OPS.database_names;F.OPS.run=F.run;F.OPS.ROOT=ROOT;F.OPS.SCHEMAS=('indo_shipping',);F.OPS.NEW_COLUMNS={};Q=load('qc-source-library.py');need(Q.BACKUP_PIN is False,'inert-source-library');Q.ROOT=ROOT;Q.BASE=BASE;Q.OUT=OUT;Q.OPS=F.OPS;Q.PDB=load('portable-pdb-library.py')

def meta(p):
 need(p.exists()and not p.is_symlink(),'regular-metadata-path');s=p.lstat();need(stat.S_ISREG(s.st_mode)or stat.S_ISDIR(s.st_mode),'regular-metadata-kind');return{'mode':stat.S_IMODE(s.st_mode),'uid':s.st_uid,'gid':s.st_gid}



def process_environment(cid):
 blob=run(['docker','exec',cid,'cat','/proc/1/environ']);need(blob.endswith(b'\0'),'complete-pid1-environment');v=F.envmap([x.decode()for x in blob.split(b'\0')if x]);need(v.pop('HOSTNAME',None)==cid[:12],'automatic-pid1-hostname');return v
def runtime(require_healthy=True):
 global RUNTIME_SERIAL
 ids=run(['docker','ps','-aq','--no-trunc']).decode().split();need(len(ids)==len(set(ids))==46 and all(re.fullmatch('[a-f0-9]{64}',x)for x in ids),'all-46-container-identities');records=json.loads(run(['docker','inspect',*ids]));need(type(records)is list and len(records)==46 and{r['Id']for r in records}==set(ids),'all-46-runtime-inspects');targets={};others={};raw={}
 RUNTIME_SERIAL+=1;private('all-runtime-inspect-%03d.private.json'%RUNTIME_SERIAL,records)
 for r in records:
  cid=r['Id'];labels=r['Config'].get('Labels')or{};s=labels.get('com.docker.compose.service')if labels.get('com.docker.compose.project')=='rr-portal'else None
  row={'id':cid,'image':r['Image'],'started':r['State'].get('StartedAt'),'running':r['State']['Running'],'oom':r['State']['OOMKilled'],'restarts':r['RestartCount'],'health':r['State'].get('Health',{}).get('Status'),'environmentMapSHA256':sha(enc(F.envmap(r['Config']['Env']))),'mounts':sorted(r['Mounts'],key=enc),'configSHA256':sha(enc(dict(r['Config'],Env=sorted(r['Config']['Env'])))),'hostConfigSHA256':sha(enc(r['HostConfig']))}
  if s not in ORDER:others[cid]=row;continue
  need(s not in targets,'unique-target-service');need(not require_healthy or(row['running']is True and row['oom']is False and row['health']=='healthy'),'healthy-target-runtime');need(len(r['Mounts'])==len(EXPECTED_ROOTS[s]),'exact-service-mount-count')
  need(r['Config'].get('Hostname')==cid[:12],'automatic-config-hostname')
  if row['running']:row['processEnvironmentWithoutAutomaticHostnameSHA256']=sha(enc(process_environment(cid)))
  targets[s]=row;raw[s]=r
 need(set(targets)==set(ORDER)and len(others)==45,'exact-one-target-45-others')
 db=database_contract(raw,records);return{'targets':targets,'others':others,'databaseContainer':db},raw
def database_contract(raw,records):
 matches=[r for r in records if(r['Config'].get('Labels')or{}).get('com.docker.compose.project')=='rr-portal'and(r['Config'].get('Labels')or{}).get('com.docker.compose.service')=='db'];need(len(matches)==1,'one-existing-postgres-container');db=matches[0];need(db['State']['Running']is True and db['State']['OOMKilled']is False and db['State'].get('Health',{}).get('Status')=='healthy','healthy-existing-postgres');ae=F.envmap(raw['indo-shipping']['Config']['Env']);de=F.envmap(db['Config']['Env']);need(ae.get('DB_NAME')==(de.get('POSTGRES_DB')or'rrportal')and ae.get('DB_USER')==(de.get('POSTGRES_USER')or'rrportal')and ae.get('DB_PASSWORD')==de.get('POSTGRES_PASSWORD')and(not ae.get('DB_SCHEMA','').strip()or ae['DB_SCHEMA']=='indo_shipping'),'exact-indo-postgres-connection')
 if raw['indo-shipping']['State']['Running']:
  pe=process_environment(raw['indo-shipping']['Id']);need(all(pe.get(k)==ae.get(k)for k in('DB_NAME','DB_USER','DB_PASSWORD','DB_SCHEMA','INDO_SHIPPING_JWT_KEY_B64','INDO_SHIPPING_ADMIN_PASSWORD_B64')),'exact-pid1-database-and-key-configuration')
 need(bool(ae.get('INDO_SHIPPING_JWT_KEY_B64'))and bool(ae.get('INDO_SHIPPING_ADMIN_PASSWORD_B64')),'existing-persistent-jwt-and-admin-secrets');return db['Id']

def dirty_snapshot(save=False):
 run(['git','diff','--cached','--quiet','--no-ext-diff','--no-textconv','--ignore-submodules=none']);names=run(['git','diff','--name-only','-z','--no-ext-diff','--no-textconv','--ignore-submodules=none']).decode().strip('\0').split('\0');need(len(names)==len(set(names))==4,'exact-four-preexisting-dirty-files');rows={}
 for i,n in enumerate(sorted(names)):
  need(F.OPS.L.safe_path(n)and n not in FIXED and not any(n==a or n.startswith(a+'/')for a in APPS),'dirty-outside-indo-app-and-fixed-configuration');entry=run(['git','ls-tree','-z',BASE,'--',n]);need(re.fullmatch(b'100(?:644|755) blob [a-f0-9]{40}\t'+re.escape(n.encode())+b'\0',entry)is not None,'dirty-original-regular-file');p=ROOT/n
  for parent in(p,*p.parents):
   if parent==ROOT:break
   need(not parent.is_symlink(),'dirty-no-symlink-ancestors')
  if not p.exists():rows[n]={'kind':'absent'};continue
  need(p.is_file(),'dirty-regular-file');before=p.lstat();data=p.read_bytes();after=p.lstat();need((before.st_dev,before.st_ino,before.st_mode,before.st_uid,before.st_gid,before.st_size,before.st_mtime_ns,before.st_ctime_ns)==(after.st_dev,after.st_ino,after.st_mode,after.st_uid,after.st_gid,after.st_size,after.st_mtime_ns,after.st_ctime_ns)and len(data)<=8*1024**2,'stable-bounded-dirty-file');rows[n]=dict(meta(p),kind='regular',bytes=len(data),sha256=sha(data))
  if save:private('dirty-%02d.private'%i,data)
 return rows
def source(revision=BASE):
 need(run(['git','symbolic-ref','--quiet','HEAD']).decode().strip()=='refs/heads/main'and run(['git','rev-parse','HEAD']).decode().strip()==revision,'exact-canonical-main');run(['git','diff','--quiet','--no-ext-diff','--no-textconv','--ignore-submodules=none','--',*APPS]);result={}
 for n in FIXED:
  p=ROOT/n;need(p.is_file()and not p.is_symlink()and p.read_bytes()==run(['git','show',BASE+':'+n]),'fixed-source-global-config-preserved');result[n]={'sha256':F.OPS.L.file_hash(p),**meta(p)}
 return result


def application_proof(service,row,revision=BASE):
 need(service=='indo-shipping'and revision==BASE,'only-indo-base-runtime-proof');prior=prior_indo_proof();need(row['image']==prior['image'],'actual-indo-image-equals-sealed-prior-candidate');proof=Q.service_source_proof(service,{'id':row['id']},revision=revision);need(proof['reviewedSourceMatch']is True and proof==prior['files'],'all-dotnet-pdb-copied-files-and-frontend-assets-equal-base-and-sealed-prior-proof');runtime_writes=run(['docker','diff',row['id']]).decode().splitlines();private('indo-original-writable-layer-paths.private.json',runtime_writes)
 for line in runtime_writes:
  need(re.fullmatch('[ACD] /[^\\r\\n]+',line)is not None and(line[2:]=='/tmp'or line[2:].startswith('/tmp/')),'no-unbacked-application-files-or-persistent-key-directories-in-writable-layer')
 need(run(['docker','exec',row['id'],'sh','-c','if [ -e /app/seed/business-data.json ]; then echo present; else echo absent; fi']).decode().strip()=='absent','business-seed-absent')
 return{'runningImageSourceRevision':PRIOR_INDO_TARGET,'runningSourceBase':revision,'applicationTree':run(['git','rev-parse',revision+':'+INDO]).decode().strip(),'reviewedSourceMatch':True,'files':proof}
def prior_archive(path,manifest_hash,result_hash,mode):
 L=F.OPS.L;need(path.is_dir()and not path.is_symlink()and stat.S_IMODE(path.stat().st_mode)==0o700,'private-prior-indo-phase');need(L.file_hash(path/'manifest.json')==manifest_hash and L.file_hash(path/'first-result.json')==result_hash,'exact-prior-indo-archive-seals');manifest=read(path/'manifest.json');entries=list(path.rglob('*'));need(type(manifest)is dict and len(entries)<=100000 and all(not x.is_symlink()and(x.is_file()or x.is_dir())and x.stat().st_mode&0o077==0 for x in entries),'private-prior-indo-entries');need(set(manifest)=={str(x.relative_to(path))for x in entries if x.is_file()and x!=path/'manifest.json'}and all(L.safe_path(n)and re.fullmatch('[a-f0-9]{64}',h or'')and L.file_hash(path/n)==h for n,h in manifest.items()),'all-prior-indo-private-file-seals');r=read(path/'first-result.json');need(r.get('success')is True and r.get('mode')==mode and r.get('target')==PRIOR_INDO_TARGET and r.get('tree')==PRIOR_INDO_TREE,'successful-prior-indo-exact-source-phase');return r

def prior_indo_proof():
 prior_archive(PRIOR_INDO_PREPARE,PRIOR_INDO_PREPARE_MANIFEST,PRIOR_INDO_PREPARE_RESULT,'prepare');verified=prior_archive(PRIOR_INDO_VERIFY,PRIOR_INDO_VERIFY_MANIFEST,PRIOR_INDO_VERIFY_RESULT,'verify');p=read(PRIOR_INDO_PREPARE/'prepared.private.json');need(p['target']==PRIOR_INDO_TARGET and p['tree']==PRIOR_INDO_TREE and p['images']['indo-shipping']==PRIOR_INDO_IMAGE and verified.get('allFivePreparedImagesAndFullRuntimeContractsProven')is True and verified.get('indoCurrentFullPGDataAnd111SequenceExact')is True,'sealed-prepared-and-actual-deployed-indo-source');need(run(['git','rev-parse',BASE+':'+INDO])==run(['git','rev-parse',PRIOR_INDO_TARGET+':'+INDO]),'base-indo-subtree-identical-to-actual-running-source');return{'image':PRIOR_INDO_IMAGE,'files':p['sourceProof']['indo-shipping']}

def capture(service,label):
 need(service=='indo-shipping'and re.fullmatch('[A-Za-z0-9_.-]{1,100}',label or'')is not None,'fixed-capture-service-label');dest=OUT/(service+'-'+label);dest.mkdir(mode=0o700);value={'postgres':indo_pg_capture(current_database_id(),dest,True),'observedUTC':datetime.datetime.now(datetime.timezone.utc).isoformat()};private(service+'-'+label+'.private.json',value);return value,dest

def startup_guard(service,value,dest):
 need(service=='indo-shipping','only-indo-startup-guard');pg=value['postgres'];checks=pg['startupChecks'];required={'adminAlreadyConfigured','legacyAccountsAlreadyMigrated','oneTimeMigrationsApplied','toolMigrationApplied','supplierProfilesAlreadyFilled','purchasePrecisionAlreadyApplied','purchaseMergeColumnsPresent','scheduleHistoryAlreadyCaptured'};need(set(checks)==required and all(v is True for v in checks.values()),'all-existing-startup-migrations-and-business-seeds-already-satisfied');need(pg['sequenceStateStableDuringCapture']is True and'users'not in pg['tables']and pg['tables']['Users']['rows']>=1 and{'images','purchase_orders','po_items','po_receipts','outbound','shipments','shipment_items'}<=set(pg['tables']),'complete-existing-tables-and-stable-sequences');need(all(type(v)is dict and type(v.get('rows'))is int and v['rows']>=0 and re.fullmatch('[a-f0-9]{64}',v.get('sha256',''))and v.get('originalColumnsSHA256')==v['sha256']for v in pg['tables'].values()),'complete-typed-row-digests');need(F.OPS.L.file_hash(dest/'indo_shipping.dump')==pg['dumpSHA256'],'sealed-consistent-postgres-dump');return{'allExistingStartupGuardsPassed':True,'allBusinessRowsRequireNoStartupChanges':True,'onlyKnownBootstrapAdminIdentitySequenceConsumptionExpected':True,'sequenceValuesCapturedSeparatelyNotClaimedMVCCAtomic':True}

def current_database_id():
 records=json.loads(run(['docker','inspect',*run(['docker','ps','-aq','--no-trunc']).decode().split()]));matches=[r for r in records if(r['Config'].get('Labels')or{}).get('com.docker.compose.project')=='rr-portal'and(r['Config'].get('Labels')or{}).get('com.docker.compose.service')=='db'];need(len(matches)==1 and matches[0]['State']['Running']is True,'one-live-readonly-postgres-container');return matches[0]['Id']

def startup_checks_sql(tables):
 disabled='$2a$11$m559Cb68j1R4cHfTHJ5tV.z3oeYQyjPGL/mIlkhdltC70AnKNsLyi'
 legacy='''NOT EXISTS (SELECT 1 FROM indo_shipping.users old LEFT JOIN indo_shipping."Users" current ON current."Username"=old.username WHERE current."Id" IS NULL OR current."PasswordHash"='%s')'''%disabled if'users'in tables else'TRUE'
 query='''BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SET LOCAL statement_timeout='30s';
 SELECT jsonb_build_object(
 'adminAlreadyConfigured',EXISTS(SELECT 1 FROM indo_shipping."Users" WHERE "Username"='admin' AND "PasswordHash"<>'%s'),
 'legacyAccountsAlreadyMigrated',%s,
 'oneTimeMigrationsApplied',(SELECT COUNT(*)=3 FROM indo_shipping.settings WHERE key IN ('data_migration:2026-08-13-replace-hs-dictionary-v1','data_migration:2026-08-15-backfill-translations-v1','data_migration:2026-09-05-backfill-supplier-dictionary-v1')AND value='applied'),
 'toolMigrationApplied',EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='indo_shipping.tool_materials'::regclass AND conname='tool_materials_kind_v2_check'),
 'supplierProfilesAlreadyFilled',NOT EXISTS(SELECT 1 FROM indo_shipping.dict_supplier WHERE trim(COALESCE(customs_company,''))=''AND COALESCE(NULLIF(trim(full_name),''),trim(keyword))<>''),
 'purchasePrecisionAlreadyApplied',EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='indo_shipping'AND table_name='po_items'AND column_name='price'AND data_type='numeric'AND numeric_precision=22 AND numeric_scale=8),
 'purchaseMergeColumnsPresent',(SELECT count(*)=8 FROM information_schema.columns WHERE table_schema='indo_shipping'AND((table_name='purchase_orders'AND column_name IN('merged_into_id','merge_revision'))OR(table_name='po_items'AND column_name IN('source_po_no','source_order_date','source_delivery_date','delivery_date_override','has_delivery_date_override'))OR(table_name='po_receipts'AND column_name='spare_qty'))),
 'scheduleHistoryAlreadyCaptured',NOT EXISTS(SELECT 1 FROM indo_shipping.schedules s LEFT JOIN LATERAL(SELECT rows_hash,acknowledged FROM indo_shipping.material_tracking_history WHERE schedule_id=s.id ORDER BY id DESC LIMIT 1)h ON TRUE WHERE h.rows_hash IS NULL OR h.rows_hash<>md5(COALESCE(s.raw_rows::text,'[]'))OR(NOT h.acknowledged AND EXISTS(SELECT 1 FROM indo_shipping.settings completed WHERE completed.key='material_tracking_completed_schedules'AND completed.value::jsonb->>s.id::text=h.rows_hash)))); COMMIT;'''%(disabled,legacy)
 return query.split("SET LOCAL statement_timeout='30s';",1)[1].rsplit('; COMMIT;',1)[0].strip().removesuffix(';')

PG_DETAILS_SELECT="SELECT jsonb_build_object(\n'schema', (SELECT jsonb_build_object('name',nspname,'owner',nspowner::regrole::text,'acl',nspacl::text) FROM pg_namespace WHERE nspname='indo_shipping'),\n'objects',COALESCE((SELECT jsonb_agg(jsonb_build_object('name',c.relname,'kind',c.relkind,'owner',c.relowner::regrole::text,'acl',c.relacl::text,'rls',c.relrowsecurity,'forceRls',c.relforcerowsecurity,'persistence',c.relpersistence) ORDER BY c.relname,c.relkind) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='indo_shipping'),'[]'),\n'constraintFlags',COALESCE((SELECT jsonb_agg(jsonb_build_object('table',c.relname,'name',x.conname,'definition',pg_get_constraintdef(x.oid),'type',x.contype,'validated',x.convalidated,'deferrable',x.condeferrable,'deferred',x.condeferred,'local',x.conislocal,'inheritCount',x.coninhcount,'noInherit',x.connoinherit) ORDER BY c.relname,x.conname) FROM pg_constraint x JOIN pg_class c ON c.oid=x.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='indo_shipping'),'[]'))"

def indo_pg_capture(db,dest,with_dump=True):
 need(with_dump is True,'consistent-dump-required-for-every-indo-snapshot');original=F.OPS.pg_table_sql
 def query(schema,tables):
  need(schema=='indo_shipping'and not {'__startupChecks','__postgresDetails'}&set(tables),'only-indo-schema-without-reserved-evidence-key-collision');sql=original(schema,tables).strip().removesuffix(';');checks=startup_checks_sql(tables);return "SELECT captured.value || jsonb_build_object('__startupChecks',("+checks+"),'__postgresDetails',("+PG_DETAILS_SELECT+")) FROM ("+sql+") captured(value);\n"
 F.OPS.pg_table_sql=query
 try:value=F.OPS.pg_capture(db,dest,True)['indo_shipping']
 finally:F.OPS.pg_table_sql=original
 value['startupChecks']=value['tables'].pop('__startupChecks');value['postgresDetails']=value['tables'].pop('__postgresDetails');value['dumpSHA256']=F.OPS.L.file_hash(dest/'indo_shipping.dump');value['startupSourceSHA256']={n:sha(run(['git','show',BASE+':'+INDO+'/'+n]))for n in STARTUP_FILES};F.OPS.L.private_write(dest/'postgres.private.json',enc(value));return value

def replay_snapshot(service,value,path):
 need(service=='indo-shipping'and read(path/'postgres.private.json')==value['postgres'],'sealed-postgres-evidence')
 with(path/'indo_shipping.dump').open('rb')as dump:need(dump.read(5)==b'PGDMP','postgres-custom-format-dump')
 startup_guard(service,value,path)

def source_proof(service,row,revision=BASE):return application_proof(service,row,revision)


def flags():return F.OPS.L.non_database_inventory(ROOT/'deploy/maintenance',[])
def environment_stable(b):
 p=ROOT/'.env.cloud.production';need(p.is_file()and not p.is_symlink()and p.read_bytes()==(b['archive']/'environment.private').read_bytes()and meta(p)==b['environmentFileMetadata'],'full-environment-bytes-mode-owner-unchanged')
def backup(result):
 need(run(['git','rev-parse','HEAD^{tree}']).decode().strip()==BASE_TREE,'exact-base-tree');configuration=source();dirty=dirty_snapshot(True);env=ROOT/'.env.cloud.production';need(env.is_file()and not env.is_symlink()and env.stat().st_size<=4*1024**2,'bounded-private-env');private('environment.private',env.read_bytes());envmeta=meta(env);maintenance=flags();need(not any(r['path']in{'services/'+s for s in ORDER}for r in maintenance),'all-target-maintenance-initially-clear');before,raw=runtime();private('target-inspect.private.json',raw);render=json.loads(run(['docker','compose','-p','rr-portal','-f',str(ROOT/'docker-compose.cloud.yml'),'--env-file',str(env),'config','--format','json']));private('compose-render.private.json',render);captured={};proof={};startup={}
 dbsize=int(run(['docker','exec','-i',before['databaseContainer'],'sh','-c',PG_SHELL],b"BEGIN READ ONLY; SELECT COALESCE(sum(pg_total_relation_size(c.oid)),0) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='indo_shipping'; COMMIT;\n",45));need(dbsize>=0 and shutil.disk_usage(OUT).free>2*(dbsize+sum(p.stat().st_size for roots in EXPECTED_ROOTS.values()for source,_ in roots for p in(ROOT/source).rglob('*')if p.is_file()))+1024**3,'enough-private-backup-space')
 for s in ORDER:
  actual=F.envmap(raw[s]['Config']['Env']);process=process_environment(raw[s]['Id']);image=json.loads(run(['docker','image','inspect',raw[s]['Image']]))[0];need(image['Id']==raw[s]['Image'],'original-immutable-image')
  need((image['Config'].get('Labels')or{}).get('org.opencontainers.image.revision')==PRIOR_INDO_TARGET and image['Id']==PRIOR_INDO_IMAGE,'actual-indo-image-metadata-equals-sealed-source-revision');private(s+'-image.private.json',image)
  private(s+'-literal-configured-environment.private.json',actual);private(s+'-literal-process-environment.private.json',process);private(s+'-declared-compose-environment.private.json',render['services'][s].get('environment',{}));captured[s],dest=capture(s,'baseline');startup[s]=startup_guard(s,captured[s],dest);proof[s]=application_proof(s,before['targets'][s],BASE)
 after,_=runtime();need(after==before and source()==configuration and dirty_snapshot()==dirty and flags()==maintenance,'unchanged-runtime-source-dirty-flags');b={'head':BASE,'tree':BASE_TREE,'runtime':before,'configuration':configuration,'preexistingFourDirty':dirty,'maintenanceInventory':maintenance,'environmentFileMetadata':envmeta,'environmentSHA256':sha((OUT/'environment.private').read_bytes()),'storage':captured,'sourceProof':proof,'startup':startup};environment_stable(dict(b,archive=OUT))
 private('baseline.private.json',b);result.update(success=True,backupComplete=True,targetContainerCount=1,otherContainerCount=45,portableSQLiteCount=0,postgresSchemaCount=1,consistentExportedIndoShippingPostgresSnapshotAndDump=True,postgresSequenceStatesIndependentlyBracketedNotMVCC=True,indoRuntimeSourceMatchesBaseAndSealedPrior=True,allPersistentDataFilesAndOwnershipArchived=True,allOriginalTypedRowsAndSchemaCaptured=True,databaseSnapshotsIndividuallyConsistentNotCrossDatabaseAtomic=True,all46ContainersUnchanged=True,environmentFileUnchanged=True,fourExistingDirtyFilesPreserved=True)

def main():
 need(BACKUP_PIN is True and sys.argv[1:]==['backup']and os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_ATTEMPT')=='1','false-draft-or-wrong-invocation');os.umask(0o077);OUT.mkdir(mode=0o700);initialize(OUT);signal.signal(signal.SIGTERM,lambda *_:need(False,'terminated'));result={'mode':'backup','base':BASE,'target':BASE,'tree':BASE_TREE,'success':False,'backupComplete':False,'businessWritesPerformed':False,'credentialsOrConfigurationChanged':False,'containerSignalsPerformed':False,'healthOrBusinessHTTPRequestsPerformed':False,'modelCallsPerformed':False,'otherServicesRequested':False,'secretOrRowsPrinted':False}
 try:backup(result)
 except BaseException as error:result.update(success=False,failedStage=safe_stage(STAGE),factoryLibraryFailedStage=safe_stage(getattr(F,'STAGE',None)),dataOpsFailedStage=safe_stage(getattr(F.OPS,'STAGE',None)),sqliteLibraryFailedStage=safe_stage(getattr(F.OPS.L,'FAILED',None)),sourceLibraryFailedStage=safe_stage(getattr(Q,'STAGE',None)),safeExceptionType=type(error).__name__);private('failure.private.txt',traceback.format_exc().encode())
 finally:private('first-result.json',result);F.OPS.L.seal(OUT);print(enc(dict(result,manifestSHA256=F.OPS.L.file_hash(OUT/'manifest.json'),resultSHA256=F.OPS.L.file_hash(OUT/'first-result.json'))).decode(),flush=True)
 return 0 if result['success']else 1
if __name__=='__main__':
 try:sys.exit(main())
 except SystemExit:raise
 except BaseException:print('{"mode":"backup","success":false,"safeFailure":"PR996_BACKUP_PREFLIGHT_REJECTED"}',flush=True);sys.exit(1)
