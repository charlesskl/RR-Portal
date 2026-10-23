"""PR999 indo-shipping-only backup. Draft: execution gate is false.

Only read-only PostgreSQL exported snapshot/dump and container inspections.
No HTTP, model calls, signals, maintenance changes or mail access.
Only indo_shipping PostgreSQL exported read-only snapshots and custom dumps.
Sequence values are independently bracketed, not an MVCC atomic guarantee.
"""
import contextlib,datetime,hashlib,importlib.util,io,json,os,pathlib,re,shutil,signal,stat,sys,tarfile,traceback,uuid,xml.etree.ElementTree as ET

ROOT=pathlib.Path('/opt/rr-portal')
BASE='dacf295b539ebd696c9bae38d9551e276e3d88ad'
BASE_TREE='1c718952aa72752af8eed4e08575bf3fd06a9e80'
BRANCH='refs/heads/ops/pr-999-20261023'
BACKUP_PIN=False
OUT=ROOT/'deploy/backups/pr-999-20261023-backup'
INDO='apps/印尼小组/印尼走货明细'
APPS=('apps/印尼小组/印尼走货明细',)
ORDER=('indo-shipping',)
SERVICES=set(ORDER)
STORAGE={}
EXPECTED_ROOTS={'indo-shipping':[]}
STARTUP_FILES=('src/IndoShipping.Api/Program.cs','src/IndoShipping.Api/Features/Bootstrap/ProductionSeeder.cs','src/IndoShipping.Infrastructure/Persistence/DatabaseCompatibility.cs','src/IndoShipping.Api/DeploymentSecrets.cs')
MIGRATION_FILES=('db/postgres_schema.sql','src/IndoShipping.Api/Features/Bootstrap/DataMigrations.cs')
CUSTOMER_MIGRATION_FILE='src/IndoShipping.Api/Features/Bootstrap/ScheduleCustomerSchema.cs'
FIXED=('docker-compose.cloud.yml','nginx/nginx.cloud.conf','deploy/update-server.sh','deploy/service-maintenance.sh','.github/workflows/deploy.yml','.env.example',*(INDO+'/'+n for n in('Dockerfile','.dockerignore',*STARTUP_FILES)))
PG_SHELL='exec psql -X -q -At -v ON_ERROR_STOP=1 -U "${POSTGRES_USER:-rrportal}" -d "${POSTGRES_DB:-rrportal}"'
DEPS={'factory-review-backup-library.py': '79d76bb47312dd08c121ebe2797f54d958666f8b72d00721f67712b152fc4666', 'release-data-ops-library.py': 'ff9138a1d5bfed1b10077112da6ebcda2d65240f583e2d0e12ce1325cfbaafd5', 'release-data-library.py': 'd63168fd3057f4f2aba2d93f9fab31d2d65c6dd0f3234877d71fcff1e04e62b9', 'qc-source-library.py': '4745c90f126cf46106b0f170a3ebc6b24ccb64c0e963e427d13308d5cb5b54f5', 'portable-pdb-library.py': 'cf66f655a1e166491c4da67da0824f42ac8cdae3f844044cb5d8f7233ba105c5'}
PRIOR_INDO_TARGET='2de4be7bdb0fa983dc86259701a3c4f3ddd14234'
PRIOR_INDO_TREE='d41d5f98f97ee0cd34b0a868fb7283f57841ee4e'
PRIOR_INDO_IMAGE='sha256:d707aee7bf0f5ba758441b1e8d6317c66d36ffe770ef11241982a6f49f94bcd2'
PRIOR_INDO_PREPARE=ROOT/'deploy/backups/pr-996-20261023-04-prepare-finalized-03'
PRIOR_INDO_PREPARE_MANIFEST='e71e9bb2afa4975cf1312eb3e47a60a32a913d86816a2d9d7d57b1e6bb7136b9'
PRIOR_INDO_PREPARE_RESULT='b996eddb5b15ac0de726eebb9b82aeb31556cee025ee56a4d5600fb4cd67342a'
PRIOR_INDO_VERIFY=ROOT/'deploy/backups/pr-996-20261023-04-resume'
PRIOR_INDO_VERIFY_MANIFEST='bd58b04c2220efb2dd8c71d0acca301897e264f53db947dc865d2c0b95871092'
PRIOR_INDO_VERIFY_RESULT='25c7654806d7682ebed8e6da5dd6ae2f9c826fb687bc25c1121d287b764ef9d9'
F=None;Q=None;STAGE='entrypoint';RUNTIME_SERIAL=0

def need(v,label):
 global STAGE
 if not v:STAGE=label;raise RuntimeError('PR999_BACKUP_REJECTED')
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



KEYRING_DEST='/home/app/.aspnet'
KEYRING_MAX=2*1024*1024
KEYRING_OWNER=(1654,1654)
def ancestor_metadata(cid):
 result={}
 for p,owner in(('/home',(0,0)),('/home/app',KEYRING_OWNER)):
  raw=run(['docker','exec','--user','0',cid,'stat','-c','%f|%a|%u|%g|%s','--',p],timeout=20).decode().strip();need(re.fullmatch('[0-9a-f]+[|][0-7]+[|][0-9]+[|][0-9]+[|][0-9]+',raw)is not None,'bounded-ancestor-metadata');a,b,c,d,e=raw.split('|');bits=int(a,16);value={'mode':int(b,8),'uid':int(c),'gid':int(d)};need(stat.S_ISDIR(bits)and value==dict(mode=0o755,uid=owner[0],gid=owner[1]),'fixed-real-existing-home-ancestor-mode-owner');result[p]=value
 return{'metadata':result,'observedUTC':datetime.datetime.now(datetime.timezone.utc).isoformat(),'observationKind':'running-pre-stop-stat'}

def validate_keyring_tar(blob):
 need(type(blob)is bytes and 0<len(blob)<=KEYRING_MAX,'bounded-private-keyring-tar');entries={};total=0
 with tarfile.open(fileobj=io.BytesIO(blob),mode='r:')as archive:
  for member in archive:
   n=member.name.rstrip('/');need(F.OPS.L.safe_path(n)and n not in entries and not member.issym()and not member.islnk()and(member.isdir()or member.isfile()),'safe-unique-regular-keyring-tar-members');need((member.uid,member.gid)==KEYRING_OWNER,'original-keyring-owner');value={'mode':member.mode,'uid':member.uid,'gid':member.gid,'kind':'directory'if member.isdir()else'file','bytes':member.size}
   if member.isdir():need(n in{'.aspnet','.aspnet/DataProtection-Keys'}and member.mode==0o755 and member.size==0,'only-existing-keyring-directories')
   else:
    match=re.fullmatch(r'\.aspnet/DataProtection-Keys/key-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.xml',n);need(match is not None and member.mode==0o600 and 0<member.size<=65536,'only-bounded-private-data-protection-key-files');data=archive.extractfile(member).read();total+=len(data);need(len(data)==member.size and total<=1024*1024 and b'<!DOCTYPE'not in data.upper()and b'<!ENTITY'not in data.upper(),'complete-bounded-key-file-no-dtd-or-entity');document=ET.fromstring(data);need(document.tag=='key'and str(uuid.UUID(document.attrib.get('id','')))==match[1]and document.attrib.get('version')=='1','canonical-data-protection-key-identity');value['sha256']=sha(data)
   entries[n]=value
 need({'.aspnet','.aspnet/DataProtection-Keys'}<=set(entries)and 1<=sum(v['kind']=='file'for v in entries.values())<=16 and len(entries)<=18,'complete-existing-keyring-with-bounded-count');return entries

def current_target_record():
 ids=run(['docker','ps','-aq','--no-trunc']).decode().split();need(len(ids)==46,'all-original-container-count-for-keyring');records=json.loads(run(['docker','inspect',*ids]));matches=[r for r in records if(r['Config'].get('Labels')or{}).get('com.docker.compose.project')=='rr-portal'and(r['Config'].get('Labels')or{}).get('com.docker.compose.service')=='indo-shipping'];need(len(matches)==1 and matches[0]['Mounts']==[],'one-unmounted-indo-keyring-owner');return matches[0]

def capture_keyring(cid,path,ancestor_ref):
 need(type(ancestor_ref)is dict and ancestor_ref.get('observationKind')=='running-pre-stop-stat'and set(ancestor_ref.get('metadata',{}))=={'/home','/home/app'},'explicit-pre-stop-ancestor-reference');blob=run(['docker','cp','-a',cid+':'+KEYRING_DEST,'-'],timeout=45);F.OPS.L.private_write(path/'keyring.private.tar',blob);entries=validate_keyring_tar(blob);return{'tarSHA256':sha(blob),'entries':entries,'ancestors':ancestor_ref['metadata'],'ancestorObservationUTC':ancestor_ref['observedUTC'],'ancestorObservationKind':'running-pre-stop-stat-not-fresh-closed'}

def replay_keyring(value,path):
 p=path/'keyring.private.tar';need(p.is_file()and not p.is_symlink()and stat.S_IMODE(p.stat().st_mode)==0o600 and sha(p.read_bytes())==value['tarSHA256']and validate_keyring_tar(p.read_bytes())==value['entries'],'sealed-full-keyring-tar-bytes-mode-owner-and-shape');need(value['ancestorObservationKind']=='running-pre-stop-stat-not-fresh-closed'and value['ancestors']=={'/home':{'mode':0o755,'uid':0,'gid':0},'/home/app':{'mode':0o755,'uid':1654,'gid':1654}},'sealed-pre-stop-ancestor-metadata')

def writable_layer_guard(lines,keyring):
 need(type(lines)is list and len(lines)<=256,'bounded-original-writable-layer')
 for line in lines:
  match=re.fullmatch(r'([ACD]) (/[^\r\n]+)',line);need(match is not None,'canonical-diff-line');action,p=match[1],match[2]
  if p=='/tmp'or p.startswith('/tmp/'):continue
  if p in{'/home','/home/app'}:need(action=='C','only-existing-home-ancestor-metadata-changed');continue
  relative=p[len('/home/app/'):]if p.startswith('/home/app/')else''
  need(action in{'A','C'}and relative in keyring['entries'],'no-unbacked-files-outside-tmp-home-ancestors-and-complete-keyring')


def application_proof(service,row,revision=BASE):
 need(service=='indo-shipping'and revision==BASE,'only-indo-base-runtime-proof');prior=prior_indo_proof();need(row['image']==prior['image'],'actual-indo-image-equals-sealed-prior-candidate');proof=Q.service_source_proof(service,{'id':row['id']},revision=revision);need(proof['reviewedSourceMatch']is True and proof==prior['files'],'all-dotnet-pdb-copied-files-and-frontend-assets-equal-base-and-sealed-prior-proof');runtime_writes=run(['docker','diff',row['id']]).decode().splitlines();private('indo-original-writable-layer-paths.private.json',runtime_writes)
 keyring=read(OUT/'indo-shipping-baseline.private.json')['keyring'];writable_layer_guard(runtime_writes,keyring)
 need(run(['docker','exec',row['id'],'sh','-c','if [ -e /app/seed/business-data.json ]; then echo present; else echo absent; fi']).decode().strip()=='absent','business-seed-absent')
 return{'runningImageSourceRevision':PRIOR_INDO_TARGET,'runningSourceBase':revision,'applicationTree':run(['git','rev-parse',revision+':'+INDO]).decode().strip(),'reviewedSourceMatch':True,'files':proof}
def prior_archive(path,manifest_hash,result_hash,mode):
 L=F.OPS.L;need(path.is_dir()and not path.is_symlink()and stat.S_IMODE(path.stat().st_mode)==0o700,'private-prior-indo-phase');need(L.file_hash(path/'manifest.json')==manifest_hash and L.file_hash(path/'first-result.json')==result_hash,'exact-prior-indo-archive-seals');manifest=read(path/'manifest.json');entries=list(path.rglob('*'));need(type(manifest)is dict and len(entries)<=100000 and all(not x.is_symlink()and(x.is_file()or x.is_dir())and x.stat().st_mode&0o077==0 for x in entries),'private-prior-indo-entries');need(set(manifest)=={str(x.relative_to(path))for x in entries if x.is_file()and x!=path/'manifest.json'}and all(L.safe_path(n)and re.fullmatch('[a-f0-9]{64}',h or'')and L.file_hash(path/n)==h for n,h in manifest.items()),'all-prior-indo-private-file-seals');r=read(path/'first-result.json');need(r.get('success')is True and r.get('mode')==mode and r.get('target')==PRIOR_INDO_TARGET and r.get('tree')==PRIOR_INDO_TREE,'successful-prior-indo-exact-source-phase');return r

def prior_indo_proof():
 prior_archive(PRIOR_INDO_PREPARE,PRIOR_INDO_PREPARE_MANIFEST,PRIOR_INDO_PREPARE_RESULT,'prepare');verified=prior_archive(PRIOR_INDO_VERIFY,PRIOR_INDO_VERIFY_MANIFEST,PRIOR_INDO_VERIFY_RESULT,'resume');p=read(PRIOR_INDO_PREPARE/'prepared.private.json');e=read(PRIOR_INDO_VERIFY/'resume-evidence.private.json');final=read(PRIOR_INDO_VERIFY/'final-runtime.private.json');need(p['target']==PRIOR_INDO_TARGET and p['tree']==PRIOR_INDO_TREE and p['images']=={'indo-shipping':PRIOR_INDO_IMAGE} and verified.get('resumedExistingCandidate')is True and verified.get('allOther45ContainersUnchanged')is True and verified.get('fullTypedRowsSchemaAndOtherSequencesExact')is True and verified.get('dataProtectionKeyringPreservedBeforeStart')is True and verified.get('dataProtectionKeyringPostStartExact')is True and verified.get('allOwnMaintenanceCleared')is True and verified.get('keyMaterialPrintedOrSubmittedToGit')is False and e['resumedImage']==PRIOR_INDO_IMAGE and e['sourceProof']==p['proofs']['indo-shipping'] and final['targets']['indo-shipping']['image']==PRIOR_INDO_IMAGE,'sealed-successful-996-prepare-and-resumed-actual-indo-source');need(run(['git','rev-parse',BASE+':'+INDO])==run(['git','rev-parse',PRIOR_INDO_TARGET+':'+INDO]),'base-indo-subtree-identical-to-actual-running-source');return{'image':PRIOR_INDO_IMAGE,'files':p['proofs']['indo-shipping']}

def capture(service,label,ancestor_ref=None):
 need(service=='indo-shipping'and re.fullmatch('[A-Za-z0-9_.-]{1,100}',label or'')is not None,'fixed-capture-service-label');dest=OUT/(service+'-'+label);dest.mkdir(mode=0o700);target=current_target_record()
 if target['State']['Running']:ancestor_ref=ancestor_metadata(target['Id'])
 else:need(ancestor_ref is not None,'stopped-keyring-requires-explicit-pre-stop-ancestor-reference')
 value={'postgres':indo_pg_capture(current_database_id(),dest,True),'keyring':capture_keyring(target['Id'],dest,ancestor_ref),'observedUTC':datetime.datetime.now(datetime.timezone.utc).isoformat()};private(service+'-'+label+'.private.json',value);return value,dest

def startup_guard(service,value,dest):
 need(service=='indo-shipping','only-indo-startup-guard');pg=value['postgres'];checks=pg['startupChecks'];required={'adminAlreadyConfigured','legacyAccountsAlreadyMigrated','oneTimeMigrationsApplied','toolMigrationApplied','supplierProfilesAlreadyFilled','purchasePrecisionAlreadyApplied','purchaseMergeColumnsPresent','scheduleHistoryAlreadyCaptured'};need(set(checks)==required and all(v is True for v in checks.values()),'all-existing-startup-migrations-and-business-seeds-already-satisfied');need(pg['sequenceStateStableDuringCapture']is True and'users'not in pg['tables']and pg['tables']['Users']['rows']>=1 and{'images','purchase_orders','po_items','po_receipts','outbound','shipments','shipment_items'}<=set(pg['tables']),'complete-existing-tables-and-stable-sequences');need(all(type(v)is dict and type(v.get('rows'))is int and v['rows']>=0 and re.fullmatch('[a-f0-9]{64}',v.get('sha256',''))and re.fullmatch('[a-f0-9]{64}',v.get('originalColumnsSHA256',''))and(n=='schedules'or v['originalColumnsSHA256']==v['sha256'])for n,v in pg['tables'].items()),'complete-typed-row-digests');need(F.OPS.L.file_hash(dest/'indo_shipping.dump')==pg['dumpSHA256'],'sealed-consistent-postgres-dump');customer_preflight(pg['customerPreflight']);customer_column_guard(pg);return{'allExistingStartupGuardsPassed':True,'allOriginalBusinessColumnsRequireNoUnrelatedStartupChanges':True,'onlyKnownBootstrapAdminIdentitySequenceConsumptionExpected':True,'sequenceValuesCapturedSeparatelyNotClaimedMVCCAtomic':True}

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

CUSTOMER_PREFLIGHT_SELECT=r"""WITH classified AS (
 SELECT s.id,to_jsonb(s)->>'customer' AS existing_customer,jsonb_typeof(s.raw_rows) AS raw_type,
 ARRAY(SELECT DISTINCT CASE
 WHEN lower(trim(r->>'customer'))='tomy' THEN 'TOMY'
 WHEN trim(r->>'customer') ~* '^spin\s*(master)?$' THEN 'Spin Master'
 ELSE '__unsupported__' END
 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(s.raw_rows)='array' THEN s.raw_rows ELSE '[]'::jsonb END) r
 WHERE trim(COALESCE(r->>'customer',''))<>'') AS owners
 FROM indo_shipping.schedules s
), column_state AS (
 SELECT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='indo_shipping.schedules'::regclass AND attname='customer' AND NOT attisdropped) AS present
), mapped AS (
 SELECT c.*,CASE WHEN p.present THEN existing_customer WHEN cardinality(owners)=1 THEN owners[1] ELSE 'TOMY' END AS expected_customer
 FROM classified c CROSS JOIN column_state p
)
SELECT jsonb_build_object(
 'columnPresent',(SELECT present FROM column_state),
 'scheduleCount',count(*),
 'legacyTomyDefaultCount',count(*) FILTER(WHERE cardinality(owners)=0),
 'explicitTomyCount',count(*) FILTER(WHERE owners=ARRAY['TOMY']),
 'explicitSpinCount',count(*) FILTER(WHERE owners=ARRAY['Spin Master']),
 'ambiguousCount',count(*) FILTER(WHERE cardinality(owners)>1),
 'unsupportedCount',count(*) FILTER(WHERE '__unsupported__'=ANY(owners)),
 'nonArrayRawRowsCount',count(*) FILTER(WHERE raw_type IS NOT NULL AND raw_type<>'array'),
 'sqlNullRawRowsCount',count(*) FILTER(WHERE raw_type IS NULL),
 'expectedCustomerMapSHA256',encode(sha256(convert_to(COALESCE(string_agg(encode(sha256(convert_to(jsonb_build_object('id',id,'customer',expected_customer)::text,'UTF8')),'hex'),'' ORDER BY encode(sha256(convert_to(jsonb_build_object('id',id,'customer',expected_customer)::text,'UTF8')),'hex')),''),'UTF8')),'hex'),
 'actualCustomerMapSHA256',encode(sha256(convert_to(COALESCE(string_agg(encode(sha256(convert_to(jsonb_build_object('id',id,'customer',existing_customer)::text,'UTF8')),'hex'),'' ORDER BY encode(sha256(convert_to(jsonb_build_object('id',id,'customer',existing_customer)::text,'UTF8')),'hex')),''),'UTF8')),'hex'),
 'globalWeekLabelsUnique',NOT EXISTS(SELECT 1 FROM indo_shipping.schedules WHERE week_label IS NOT NULL GROUP BY week_label HAVING count(*)>1),
 'textCollation',(SELECT typcollation::text FROM pg_type WHERE oid='text'::regtype),
 'oldWeekConstraintNames',COALESCE((SELECT jsonb_agg(conname ORDER BY conname) FROM pg_constraint WHERE conrelid='indo_shipping.schedules'::regclass AND contype='u' AND conkey=ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid='indo_shipping.schedules'::regclass AND attname='week_label')]::smallint[]),'[]'),
 'oldWeekIndexNames',COALESCE((SELECT jsonb_agg(c.relname ORDER BY c.relname) FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid WHERE indrelid='indo_shipping.schedules'::regclass AND indisunique AND indnatts=1 AND indkey[0]=(SELECT attnum FROM pg_attribute WHERE attrelid='indo_shipping.schedules'::regclass AND attname='week_label')),'[]')
) FROM mapped"""

def customer_preflight(value):
 need(type(value)is dict and type(value.get('columnPresent'))is bool,'typed-schedule-customer-stage');names=('scheduleCount','legacyTomyDefaultCount','explicitTomyCount','explicitSpinCount','ambiguousCount','unsupportedCount','nonArrayRawRowsCount','sqlNullRawRowsCount');need(all(type(value.get(n))is int and value[n]>=0 for n in names)and all(re.fullmatch('[a-f0-9]{64}',value.get(n,''))for n in('expectedCustomerMapSHA256','actualCustomerMapSHA256')),'typed-customer-classification-and-complete-map-digests');need(value['columnPresent']or(value['ambiguousCount']==value['unsupportedCount']==0),'unambiguous-supported-explicit-customer-or-documented-legacy-tomy-only');return {n:value[n]for n in('columnPresent',*names,'expectedCustomerMapSHA256','actualCustomerMapSHA256')}

PG_DETAILS_SELECT="SELECT jsonb_build_object(\n'schema', (SELECT jsonb_build_object('name',nspname,'owner',nspowner::regrole::text,'acl',nspacl::text) FROM pg_namespace WHERE nspname='indo_shipping'),\n'objects',COALESCE((SELECT jsonb_agg(jsonb_build_object('name',c.relname,'kind',c.relkind,'owner',c.relowner::regrole::text,'acl',c.relacl::text,'rls',c.relrowsecurity,'forceRls',c.relforcerowsecurity,'persistence',c.relpersistence) ORDER BY c.relname,c.relkind) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='indo_shipping'),'[]'),\n'constraintFlags',COALESCE((SELECT jsonb_agg(jsonb_build_object('table',c.relname,'name',x.conname,'definition',pg_get_constraintdef(x.oid),'type',x.contype,'validated',x.convalidated,'deferrable',x.condeferrable,'deferred',x.condeferred,'local',x.conislocal,'inheritCount',x.coninhcount,'noInherit',x.connoinherit) ORDER BY c.relname,x.conname) FROM pg_constraint x JOIN pg_class c ON c.oid=x.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='indo_shipping'),'[]'))"

def customer_column_guard(pg):
 rows=[r for r in pg['schema']['columns']if r['table']=='schedules'and r['name']=='customer'];present=pg['customerPreflight']['columnPresent'];need((not present and rows==[])or(present and len(rows)==1 and all(rows[0].get(k)==v for k,v in{'type':'text','notNull':True,'default':"'TOMY'::text",'identity':'','generated':'','collation':pg['customerPreflight']['textCollation']}.items())),'customer-column-presence-and-exact-reviewed-existing-contract')

def indo_pg_capture(db,dest,with_dump=True):
 need(with_dump is True and F.OPS.NEW_COLUMNS=={},'consistent-dump-and-no-global-new-column-stage-mutation');original=F.OPS.pg_table_sql
 def query(schema,tables):
  need(schema=='indo_shipping'and not {'__startupChecks','__postgresDetails','__customerPreflight'}&set(tables),'only-indo-schema-without-reserved-evidence-key-collision')
  try:
   F.OPS.NEW_COLUMNS={'schedules':{'customer':('text',True,"'TOMY'::text")}};sql=original(schema,tables).strip().removesuffix(';')
  finally:F.OPS.NEW_COLUMNS={}
  checks=startup_checks_sql(tables);return "SELECT captured.value || jsonb_build_object('__startupChecks',("+checks+"),'__postgresDetails',("+PG_DETAILS_SELECT+"),'__customerPreflight',("+CUSTOMER_PREFLIGHT_SELECT+")) FROM ("+sql+") captured(value);\n"
 F.OPS.pg_table_sql=query
 try:value=F.OPS.pg_capture(db,dest,True)['indo_shipping']
 finally:F.OPS.pg_table_sql=original;F.OPS.NEW_COLUMNS={}
 value['startupChecks']=value['tables'].pop('__startupChecks');value['postgresDetails']=value['tables'].pop('__postgresDetails');value['customerPreflight']=value['tables'].pop('__customerPreflight');value['dumpSHA256']=F.OPS.L.file_hash(dest/'indo_shipping.dump');value['startupSourceSHA256']={n:sha(run(['git','show',BASE+':'+INDO+'/'+n]))for n in STARTUP_FILES};F.OPS.L.private_write(dest/'postgres.private.json',enc(value));return value

def replay_snapshot(service,value,path):
 need(service=='indo-shipping'and read(path/'postgres.private.json')==value['postgres'],'sealed-postgres-evidence')
 with(path/'indo_shipping.dump').open('rb')as dump:need(dump.read(5)==b'PGDMP','postgres-custom-format-dump')
 replay_keyring(value['keyring'],path)
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
  private(s+'-literal-configured-environment.private.json',actual);private(s+'-literal-process-environment.private.json',process);private(s+'-declared-compose-environment.private.json',render['services'][s].get('environment',{}));captured[s],dest=capture(s,'baseline');result['scheduleCustomerPreflight']={k:v for k,v in captured[s]['postgres']['customerPreflight'].items()if k not in{'oldWeekConstraintNames','oldWeekIndexNames','textCollation'}};startup[s]=startup_guard(s,captured[s],dest);proof[s]=application_proof(s,before['targets'][s],BASE)
 after,_=runtime();need(after==before and source()==configuration and dirty_snapshot()==dirty and flags()==maintenance,'unchanged-runtime-source-dirty-flags');b={'head':BASE,'tree':BASE_TREE,'runtime':before,'configuration':configuration,'migrationConfiguration':{INDO+'/'+n:dict(sha256=sha(run(['git','show',BASE+':'+INDO+'/'+n])),**meta(ROOT/INDO/n))for n in MIGRATION_FILES},'preexistingFourDirty':dirty,'maintenanceInventory':maintenance,'environmentFileMetadata':envmeta,'environmentSHA256':sha((OUT/'environment.private').read_bytes()),'storage':captured,'sourceProof':proof,'startup':startup};environment_stable(dict(b,archive=OUT))
 for service in ORDER:replay_keyring(captured[service]['keyring'],OUT/(service+'-baseline'))
 private('baseline.private.json',b);result.update(persistentDataProtectionKeyringCaptured=True,keyringBackupPrivateAndReplayVerified=True,dataProtectionKeyringFileCount=sum(v['kind']=='file'for v in captured['indo-shipping']['keyring']['entries'].values()),ancestorMetadataReference='observed-live-not-closed-atomic',keyMaterialPrintedOrSubmittedToGit=False,success=True,backupComplete=True,targetContainerCount=1,otherContainerCount=45,portableSQLiteCount=0,postgresSchemaCount=1,consistentExportedIndoShippingPostgresSnapshotAndDump=True,postgresSequenceStatesIndependentlyBracketedNotMVCC=True,indoRuntimeSourceMatchesBaseAndSealedPrior=True,allPersistentDataFilesAndOwnershipArchived=True,allOriginalTypedRowsAndSchemaCaptured=True,databaseSnapshotsIndividuallyConsistentNotCrossDatabaseAtomic=True,all46ContainersUnchanged=True,environmentFileUnchanged=True,fourExistingDirtyFilesPreserved=True)

def main():
 need(re.fullmatch('[a-f0-9]{40}',BASE)is not None and re.fullmatch('[a-f0-9]{40}',BASE_TREE)is not None and BACKUP_PIN is True and sys.argv[1:]==['backup']and os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_ATTEMPT')=='1','false-draft-or-wrong-invocation');os.umask(0o077);OUT.mkdir(mode=0o700);initialize(OUT);signal.signal(signal.SIGTERM,lambda *_:need(False,'terminated'));result={'mode':'backup','base':BASE,'target':BASE,'tree':BASE_TREE,'success':False,'backupComplete':False,'businessWritesPerformed':False,'credentialsOrConfigurationChanged':False,'containerSignalsPerformed':False,'healthOrBusinessHTTPRequestsPerformed':False,'modelCallsPerformed':False,'otherServicesRequested':False,'secretOrRowsPrinted':False}
 try:backup(result)
 except BaseException as error:result.update(success=False,failedStage=safe_stage(STAGE),factoryLibraryFailedStage=safe_stage(getattr(F,'STAGE',None)),dataOpsFailedStage=safe_stage(getattr(F.OPS,'STAGE',None)),sqliteLibraryFailedStage=safe_stage(getattr(F.OPS.L,'FAILED',None)),sourceLibraryFailedStage=safe_stage(getattr(Q,'STAGE',None)),safeExceptionType=type(error).__name__);private('failure.private.txt',traceback.format_exc().encode())
 finally:private('first-result.json',result);F.OPS.L.seal(OUT);print(enc(dict(result,manifestSHA256=F.OPS.L.file_hash(OUT/'manifest.json'),resultSHA256=F.OPS.L.file_hash(OUT/'first-result.json'))).decode(),flush=True)
 return 0 if result['success']else 1
if __name__=='__main__':
 try:sys.exit(main())
 except SystemExit:raise
 except BaseException:print('{"mode":"backup","success":false,"safeFailure":"PR999_BACKUP_PREFLIGHT_REJECTED"}',flush=True);sys.exit(1)
