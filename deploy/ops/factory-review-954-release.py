"""PR954 two-service factory-review deployment and sealed read-only verification. Draft gates false."""
import contextlib,datetime,html.parser,sqlite3,hashlib,importlib.util,json,os,pathlib,re,signal,stat,subprocess,sys,time,urllib.request,urllib.error
ROOT=pathlib.Path('/opt/rr-portal');BASE='593e7e35857a8f434362b7fb078a08870ac56299';TARGET='1f97b1b07aa501cfeeb043b99ad1156d73fbc6e0';TREE='b56dfd35f84f2ee36968a24558aa135b5b3110d7'
BRANCH='refs/heads/ops/factory-review-954-20261019';DEPLOY_PIN=False;VERIFY_PIN=True
BACKUP=ROOT/'deploy/backups/factory-review-954-20261019-backup';BACKUP_MANIFEST='c1c6a50568fd50c97c4dfc77b7bad9dd6f7a8bdb0153b64b3c517d06b04be376';BACKUP_RESULT='ea18efc7d1075d7afb56b87fd7769cc9b6e4ab71bf6fe8b70824b0ac66c2cf7b'
DEPLOY=BACKUP.with_name('factory-review-954-20261019-deploy');VERIFY=BACKUP.with_name('factory-review-954-20261019-verify');DEPLOY_MANIFEST='8311c89dbc2f224253850b2a66fd05ba369e153b92ac183041f11cd144f806a8';DEPLOY_RESULT='f8bb830ae691899bdf88e6152c8268d16d79c46e01dc3d5b26a395ca0ff50db5'
CORE_SHA='9cf0a547cb8563a00b66dc166a0d968b9f410c035897c7b52f08b857431c0232'
SOURCE_MANIFEST_SHA='7ccf0283c84443fa03bff6eb7937f9fa987316847f59467b534ad3114a4c41e9'
STAGE='preflight';CORE=None;OUT=None;ENV=None
COMPOSE=['docker','compose','-p','rr-portal','-f',str(ROOT/'docker-compose.cloud.yml'),'--env-file',str(ROOT/'.env.cloud.production')]

def need(v):
 if not v:raise RuntimeError('FACTORY_REVIEW_954_RELEASE_REJECTED')
def enc(v):return json.dumps(v,sort_keys=True,ensure_ascii=True,separators=(',',':'),allow_nan=False).encode()
def sha(v):return hashlib.sha256(v).hexdigest()
def core_load():
 p=pathlib.Path(__file__).with_name('factory-review-backup-library.py');need(p.is_file()and not p.is_symlink()and sha(p.read_bytes())==CORE_SHA);s=importlib.util.spec_from_file_location('fixed_factory_readonly_core',p);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m

def archive(path,msha,rsha):
 need(re.fullmatch('[a-f0-9]{64}',msha or'')and re.fullmatch('[a-f0-9]{64}',rsha or'')and path.is_dir()and not path.is_symlink()and stat.S_IMODE(path.stat().st_mode)==0o700)
 need(CORE.OPS.L.file_hash(path/'manifest.json')==msha and CORE.OPS.L.file_hash(path/'first-result.json')==rsha);manifest=json.loads((path/'manifest.json').read_bytes());entries=list(path.rglob('*'));need(len(entries)<=50000 and all(not p.is_symlink()and(p.is_dir()or p.is_file())and p.stat().st_mode&0o077==0 for p in entries));need(set(manifest)=={str(p.relative_to(path))for p in entries if p.is_file()and p!=path/'manifest.json'})
 need(all(CORE.OPS.L.safe_path(n)and re.fullmatch('[a-f0-9]{64}',h)and CORE.OPS.L.file_hash(path/n)==h for n,h in manifest.items()));receipt=json.loads((path/'first-result.json').read_bytes());need(receipt.get('success')is True)
 return receipt

def original():
 receipt=archive(BACKUP,BACKUP_MANIFEST,BACKUP_RESULT);need(receipt.get('backupComplete')is True and receipt.get('base')==BASE and receipt.get('portableSQLiteCount')==4 and receipt.get('actualHooksAndMigrationsMatchBase')is True and receipt.get('actualOCIApplicationTreesMatchBase')is True);baseline=json.loads((BACKUP/'baseline.private.json').read_bytes());need(baseline['head']==BASE and set(baseline['pocketbase'])==set(CORE.SERVICES));return baseline

def operation(args,timeout=180,checkout=False):
 CORE.COUNTER+=1
 with (OUT/('%03d-%s.private.log'%(CORE.COUNTER,STAGE))).open('xb')as log:p=subprocess.run(args,stdout=log,stderr=subprocess.STDOUT,timeout=timeout,cwd=ROOT,env=ENV,umask=0o022 if checkout else -1)
 need(p.returncode==0)

def source_manifest():
 p=pathlib.Path(__file__).with_name('factory-review-reviewed-files.json');need(p.is_file()and not p.is_symlink()and sha(p.read_bytes())==SOURCE_MANIFEST_SHA);v=json.loads(p.read_bytes());need(type(v)is dict and 0<len(v)<=30 and all(any(n.startswith(CORE.APP_PREFIX+part)for part in ('src/','tests/'))and CORE.OPS.L.safe_path(n)and re.fullmatch('[a-f0-9]{64}',h)for n,h in v.items()));return v

def checked_source(revision,baseline,files,canonical=False):
 CORE.BASE=revision;need(CORE.source()==baseline['configuration']and CORE.dirty_snapshot()==baseline['preexistingFourDirty']and CORE.OPS.L.file_hash(ROOT/'.env.cloud.production')==baseline['environmentSHA256'])
 need(CORE.run(['git','rev-parse',TARGET+'^{tree}']).decode().strip()==TREE);changed=CORE.run(['git','diff','--name-only','-z','--no-ext-diff','--no-textconv',BASE,TARGET]).decode().strip('\0').split('\0');need(set(changed)==set(files));need(not set(changed)&set(baseline['preexistingFourDirty']))
 for n,h in files.items():
  need(sha(CORE.run(['git','show',TARGET+':'+n]))==h)
  if canonical:
   path=ROOT/n;entry=CORE.run(['git','ls-tree','-z',TARGET,'--',n]).split(b'\t',1);need(len(entry)==2 and entry[1]==n.encode()+b'\0'and re.fullmatch(b'100(?:644|755) blob [a-f0-9]{40}',entry[0]));desired=0o755 if entry[0].startswith(b'100755')else 0o644
   for ancestor in(path,*path.parents):
    if ancestor==ROOT:break
    need(not ancestor.is_symlink())
   need(path.is_file()and stat.S_IMODE(path.stat().st_mode)==desired and CORE.OPS.L.file_hash(path)==h)


def config_same(a,b):
 return all(a[k]==b[k]for k in ('environmentMapSHA256','processEnvironmentWithoutAutomaticHostnameSHA256','mounts','memory','swap','healthcheck','command','entrypoint','user','workingDirectory'))
def flags(service=None):
 need(service is None or service in CORE.SERVICES);path=ROOT/'deploy/maintenance';need(path.is_dir()and not path.is_symlink());return[r for r in CORE.OPS.L.non_database_inventory(path,[])if r['path']!='services/'+str(service)]
def maintenance(fn,service):
 need(service in CORE.SERVICES and fn in {'maintenance_on','wait_service_ready','maintenance_off','require_maintenance_cleared'});operation(['bash','-c','set -euo pipefail; source "$1"; "$2" "$3"','factory-release',str(ROOT/'deploy/service-maintenance.sh'),fn,service],340)
def bootstrap_ready(raw):
 env=CORE.envmap(raw['Config']['Env']);email=env.get('FACTORY_REVIEW_ADMIN_EMAIL','').strip();need(email and len(env.get('FACTORY_REVIEW_ADMIN_PASSWORD',''))>=12)
 service=raw['Config']['Labels']['com.docker.compose.service'];need(service in CORE.SERVICES)
 with contextlib.closing(CORE.OPS.L.connect(CORE.APP/CORE.SERVICES[service]/'data.db'))as db:need(db.execute('SELECT count(*) FROM users WHERE email=?',(email,)).fetchone()==(1,))
def get(path):
 need(path.startswith('/')and not path.startswith('//'));request=urllib.request.Request('http://127.0.0.1'+path,headers={'Cache-Control':'no-cache'})
 try:
  with urllib.request.urlopen(request,timeout=15)as response:body=response.read(16*1024**2+1);need(len(body)<=16*1024**2);return response.status,body
 except urllib.error.HTTPError as error:return error.code,b''
def public_assets(service,proof):
 base='/'+service+'/';expected=proof['files'];status,body=get(base);need(status==200 and sha(body)==expected['pb_public/index.html']['sha256'])
 class Assets(html.parser.HTMLParser):
  def __init__(self):super().__init__();self.urls=set()
  def handle_starttag(self,tag,attrs):
   for key,value in attrs:
    if tag in {'script','link'}and key in {'src','href'}and value and value.startswith(base+'assets/'):self.urls.add(value)
 parser=Assets();parser.feed(body.decode());need(parser.urls)
 for name,row in expected.items():
  if name.startswith('pb_public/assets/'):
   url=base+name[len('pb_public/'):];need('?'not in url and'#'not in url);status,asset=get(url);need(status==200 and len(asset)==row['bytes']and sha(asset)==row['sha256'])
 need(all('pb_public/'+url[len(base):]in expected for url in parser.urls));return {'actualIndexAndAllAssetsMatchContainerBytes':True,'requestedBasePath':base}

def deploy(result,before,files):
 global STAGE
 STAGE='initial-runtime-and-source';current,raw=CORE.runtime();need(current==before['runtime']);old_flags=flags();
 for service in CORE.SERVICES:maintenance('require_maintenance_cleared',service)
 CORE.BASE=BASE;need(CORE.source()==before['configuration']and CORE.dirty_snapshot()==before['preexistingFourDirty'])
 STAGE='fetch-exact-main';CORE.run(['git','-c','core.hooksPath=/dev/null','fetch','origin','main']);need(CORE.run(['git','rev-parse','FETCH_HEAD']).decode().strip()==TARGET);CORE.run(['git','merge-base','--is-ancestor',BASE,TARGET]);checked_source(BASE,before,files)
 STAGE='fast-forward-with-readable-source';operation(['git','-c','core.hooksPath=/dev/null','-c','merge.autoStash=false','merge','--ff-only','--no-autostash',TARGET],180,checkout=True);checked_source(TARGET,before,files,True);expected=current;proofs={};public={}
 for service in CORE.SERVICES:
  STAGE=service+'-build';observed,inspects=CORE.runtime();need(observed==expected);tag=inspects[service]['Config']['Image'];need(tag.removesuffix(':latest')=='rr-portal-'+service);old=json.loads(CORE.run(['docker','image','inspect',tag]))[0];need(old['Id']==observed['targets'][service]['image']);operation([*COMPOSE,'build',service],1500);built=json.loads(CORE.run(['docker','image','inspect',tag]))[0];need(re.fullmatch('sha256:[a-f0-9]{64}',built['Id'])and built['Id']!=old['Id']and(built.get('Config',{}).get('Labels')or{}).get('org.opencontainers.image.revision')==TARGET);checked_source(TARGET,before,files,True)
  STAGE=service+'-pre-switch-bootstrap';need(CORE.runtime()[0]==expected);bootstrap_ready(inspects[service]);service_flags=flags(service);maintenance('maintenance_on',service);switched=time.monotonic();operation([*COMPOSE,'up','-d','--no-build','--no-deps',service],180);maintenance('wait_service_ready',service)
  STAGE=service+'-actual-runtime-and-assets';after,_=CORE.runtime();need(after['others']==expected['others']and all(after['targets'][s]==expected['targets'][s]for s in CORE.SERVICES if s!=service));row=after['targets'][service];need(config_same(before['runtime']['targets'][service],row)and row['id']!=expected['targets'][service]['id']and row['image']==built['Id']and row['restarts']==0);proofs[service]=CORE.runtime_files(service,row);time.sleep(max(0,10-(time.monotonic()-switched)));need(CORE.runtime()[0]==after and flags(service)==service_flags);checked_source(TARGET,before,files,True)
  STAGE=service+'-clear-only-own-maintenance';maintenance('maintenance_off',service);maintenance('require_maintenance_cleared',service);need(CORE.runtime()[0]==after and flags()==old_flags);STAGE=service+'-public-assets-after-own-flag-cleared'
  try:public[service]=public_assets(service,proofs[service])
  except BaseException:maintenance('maintenance_on',service);raise
  expected=after
 STAGE='final-preservation';original();checked_source(TARGET,before,files,True);need(CORE.runtime()[0]==expected and all(v['restarts']==0 for v in expected['targets'].values()));result.update(success=True,onlyFactoryReviewAndTestRebuilt=True,allNonFactoryContainersUnchanged=True,fourPreexistingChangesPreserved=True,canonicalGitSourceModesVerified=True,environmentAndProcessMapsPreserved=True,runtimeAfter=expected,publicAssets=public,sourceProof=proofs)

def timestamp(value):
 match=re.fullmatch(r'(\d{4}-\d\d-\d\d[ T]\d\d:\d\d:\d\d)(?:\.(\d{1,9}))?(Z|[+-]\d\d:\d\d)',value or'')
 if not match:return None
 try:return datetime.datetime.fromisoformat((match[1]+('.'+match[2][:6].ljust(6,'0')if match[2]else'')+match[3]).replace('Z','+00:00')).astimezone(datetime.timezone.utc)
 except ValueError:return None
def log_policy(path,started):
 with contextlib.closing(CORE.OPS.L.connect(path,True))as db:
  row=db.execute("SELECT CASE WHEN json_valid(value) THEN json_extract(value,'$.logs.maxDays') END,CASE WHEN json_valid(value) THEN json_extract(value,'$.logs.minLevel') END,CASE WHEN json_valid(value) THEN json_type(value,'$.logs.maxDays') END,CASE WHEN json_valid(value) THEN json_type(value,'$.logs.minLevel') END FROM _params WHERE id='settings'").fetchone()
 start=timestamp(started)
 if row is None or row[2:]!=('integer','integer')or type(row[0])is not int or not 0<=row[0]<=36500 or type(row[1])is not int or not -100<=row[1]<=100 or start is None:return None
 return {'cutoff':start-datetime.timedelta(days=row[0]),'minLevel':row[1]}
def logs_retention(oldpath,newpath,olddata,newdata,started):
 policies=[log_policy(p,started)for p in (olddata,newdata)];policy=policies[0]if policies[0]is not None and policies[0]==policies[1]else None;counts={'oldRows':0,'retainedTypedIdentical':0,'retainedTypedChanged':0,'missing':0,'missingCompatibleWithConfiguredRetention':0,'newRows':0,'configuredPolicyAvailableAndUnchanged':policy is not None}
 with contextlib.closing(CORE.OPS.L.connect(oldpath,True))as db:
  db.execute('ATTACH DATABASE ? AS afterdb',(newpath.as_uri()+'?mode=ro&immutable=1',));columns=db.execute('PRAGMA table_xinfo(_logs)').fetchall();need(columns==db.execute('PRAGMA afterdb.table_xinfo(_logs)').fetchall()and columns and[c[1]for c in columns if c[5]]==['id']);names=[c[1]for c in columns];need({'id','created','level'}<=set(names));q=CORE.OPS.L.quote;need(all(db.execute('SELECT count(*)=count(DISTINCT id) FROM '+prefix+'._logs').fetchone()==(1,)for prefix in ('main','afterdb')));query='SELECT '+','.join('a.'+q(n)for n in names)+','+','.join('b.'+q(n)for n in names)+' FROM _logs a LEFT JOIN afterdb._logs b ON a.id=b.id AND typeof(a.id)=typeof(b.id)';n=len(names);idindex=names.index('id')
  for row in db.execute(query):
   counts['oldRows']+=1;a,b=row[:n],row[n:]
   if b[idindex]is not None:counts['retainedTypedIdentical'if[CORE.OPS.L.cell(x)for x in a]==[CORE.OPS.L.cell(x)for x in b]else'retainedTypedChanged']+=1;continue
   counts['missing']+=1;created=timestamp(a[names.index('created')]);level=a[names.index('level')];compatible=policy is not None and((created is not None and created<=policy['cutoff'])or(type(level)is int and level<policy['minLevel']));counts['missingCompatibleWithConfiguredRetention']+=int(compatible)
  counts['newRows']=db.execute('SELECT count(*) FROM afterdb._logs b LEFT JOIN _logs a ON a.id=b.id AND typeof(a.id)=typeof(b.id) WHERE a.id IS NULL').fetchone()[0]
 counts['compatibleWithoutChangingRetainedRows']=counts['retainedTypedChanged']==0 and counts['missing']==counts['missingCompatibleWithConfiguredRetention'];return counts

def verify(result,before,files):
 global STAGE
 STAGE='deployed-private-receipt';receipt=archive(DEPLOY,DEPLOY_MANIFEST,DEPLOY_RESULT);need(receipt.get('target')==TARGET and receipt.get('onlyFactoryReviewAndTestRebuilt')is True);current,_=CORE.runtime();need(current==receipt['runtimeAfter']and current['others']==before['runtime']['others']);checked_source(TARGET,before,files,True);old_flags=flags();snapshots={};checks={};retention={};strict={};proofs={}
 for service,relative in CORE.SERVICES.items():
  STAGE=service+'-closed-current-snapshot';maintenance('require_maintenance_cleared',service);snapshots[service]=CORE.OPS.sqlite_capture(service,CORE.APP/relative,OUT/service);need(set(snapshots[service]['sqlite'])=={'data.db','auxiliary.db'});old=before['pocketbase'][service];new=snapshots[service];strict[service]=old==new;checks[service+'BusinessDataAllTypedAndSchemaIdentical']=old['sqlite']['data.db']==new['sqlite']['data.db'];checks[service+'StorageBytesAndPermissionsIdentical']=old['files']==new['files'];a,b=old['sqlite']['auxiliary.db'],new['sqlite']['auxiliary.db'];checks[service+'AuxiliarySchemaAndNonLogTablesIdentical']=a['schema']==b['schema']and{k:v for k,v in a['tables'].items()if k!='_logs'}=={k:v for k,v in b['tables'].items()if k!='_logs'}
  STAGE=service+'-sealed-logs-classification';retention[service]=logs_retention(BACKUP/service/'sqlite/auxiliary.db',OUT/service/'sqlite/auxiliary.db',BACKUP/service/'sqlite/data.db',OUT/service/'sqlite/data.db',current['targets'][service]['started']);checks[service+'LogsRetainedRowsAndConfiguredRetentionCompatible']=retention[service]['compatibleWithoutChangingRetainedRows'];proofs[service]=CORE.runtime_files(service,current['targets'][service]);public_assets(service,proofs[service]);checks[service+'ConfigurationMapsPreserved']=config_same(before['runtime']['targets'][service],current['targets'][service])
 STAGE='final-byte-and-runtime-proof';checked_source(TARGET,before,files,True);need(CORE.runtime()[0]==current and flags()==old_flags);original();archive(DEPLOY,DEPLOY_MANIFEST,DEPLOY_RESULT);CORE.OPS.L.private_write(OUT/'observed.private.json',enc({'pocketbase':snapshots,'runtime':current,'sourceProof':proofs}));result.update(deploymentVerified=True,checks=checks,strictAllSnapshotFieldsIdentical=all(strict.values()),strictSnapshotsByService=strict,logRetentionClassification=retention,logRetentionCompatibilityDoesNotIdentifyActor=True,requiresBusinessRowInvestigation=any(not v for k,v in checks.items()if k.endswith('BusinessDataAllTypedAndSchemaIdentical')),success=all(checks.values()))

def main():
 global CORE,OUT,ENV,STAGE
 need(len(sys.argv)==2 and sys.argv[1]in {'deploy','verify'});mode=sys.argv[1];need((DEPLOY_PIN if mode=='deploy'else VERIFY_PIN)and re.fullmatch('[a-f0-9]{40}',TARGET or'')and re.fullmatch('[a-f0-9]{40}',TREE or'')and re.fullmatch('[a-f0-9]{64}',SOURCE_MANIFEST_SHA or'')and os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_ATTEMPT')=='1')
 os.umask(0o077);OUT=DEPLOY if mode=='deploy'else VERIFY;OUT.mkdir(mode=0o700);CORE=core_load();CORE.OUT=OUT;CORE.OPS=CORE.load('release-data-ops-library.py');CORE.OPS.L=CORE.OPS.load_library(pathlib.Path(__file__).with_name('release-data-library.py'));CORE.OPS.run=CORE.run
 ENV=dict(os.environ,AFTER_COMMIT=TARGET,COMPOSE_BAKE='false',COMPOSE_PARALLEL_LIMIT='1',COMPOSE_PROJECT_NAME='rr-portal',MAINT_FLAG_DIR=str(ROOT/'deploy/maintenance'),COMPOSE_FILE=str(ROOT/'docker-compose.cloud.yml'),ENV_FILE=str(ROOT/'.env.cloud.production'),MAINT_COMPOSE_SERVICES='factory-review\nfactory-review-test',MAINT_HEALTH_TIMEOUT_SECONDS='300',MAINT_DNS_GRACE_SECONDS='10')
 def stop(*_):need(False)
 signal.signal(signal.SIGTERM,stop);result={'mode':mode,'success':False,'target':TARGET,'expectedTree':TREE,'businessWritesPerformed':False,'credentialsChanged':False,'envFileModified':False,'globalHooksRun':False,'globalMaintenanceChanged':False,'automaticRollback':False}
 try:
  before=original();files=source_manifest();(deploy if mode=='deploy'else verify)(result,before,files)
 except BaseException:result['failedStage']=STAGE
 finally:
  CORE.OPS.L.private_write(OUT/'first-result.json',enc(result));CORE.OPS.L.seal(OUT);public={k:v for k,v in result.items()if k not in {'runtimeAfter','sourceProof'}};print(enc(dict(public,resultSHA256=CORE.OPS.L.file_hash(OUT/'first-result.json'),manifestSHA256=CORE.OPS.L.file_hash(OUT/'manifest.json'))).decode(),flush=True)
 return 0 if result['success']else 1
if __name__=='__main__':
 try:exit_code=main()
 except BaseException:print('{"success":false,"safeFailure":"FACTORY_REVIEW_954_RELEASE_PREFLIGHT_FAILED"}',flush=True);exit_code=1
 sys.exit(exit_code)
