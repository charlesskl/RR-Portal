"""Fixed seven-service scoped deployment and strict read-only verification.
Draft: both gates and all target/archive/source facts must be frozen before use.
Strict verification deliberately has no startup-migration exemptions yet.
"""
import hashlib,html.parser,importlib.util,json,os,pathlib,re,signal,sqlite3,stat,subprocess,sys,time,urllib.error,urllib.parse,urllib.request
ROOT=pathlib.Path('/opt/rr-portal');BASE='9a62c7059600c12d4781b94f69098e37a32d901d';TARGET='4f1f64cac098caa6b202eb27cae9ab8fad9109dd';TREE='f062e722bb9a16d51856e494f41a58d3e3670dd2'
BRANCH='refs/heads/ops/batch-961-965-20261020';DEPLOY_PIN=True;VERIFY_PIN=False
CORE_SHA='4259dcbba7cbdc78809e286c3b20829644104e4a30b284bea84cc6b20f0c24b5';SOURCE_MANIFEST_SHA='c6a2c4b7ea1e5866ed351d1fcef54f2d27f44d099e50879a95bfd535a38e2ab6';EXPECTED_CHANGED_FILES=83
BACKUP=ROOT/'deploy/backups/batch-961-965-20261020-backup';BACKUP_MANIFEST='a18052ed05e4fea60d0073f71aa5a809f395739c89ce63eddf5dfc9ac0ef8924';BACKUP_RESULT='3928baa1a0e10249f22ef26e19d7a4a1be018aefa03b557bcb6c65cfc66aec3e'
DEPLOY=BACKUP.with_name('batch-961-965-20261020-deploy');VERIFY=BACKUP.with_name('batch-961-965-20261020-verify');DEPLOY_MANIFEST='';DEPLOY_RESULT=''
ORDER=('factory-review','factory-review-test','internal-quote','zuru-order-system','qc-plan-api','qc-plan-web','printlink')
AI_ADDITIONS={'FACTORY_REVIEW_AI_ENABLED':'false','FACTORY_REVIEW_AI_API_KEY':'','FACTORY_REVIEW_AI_MODEL':'','FACTORY_REVIEW_AI_BASE_URL':'https://api.openai.com/v1'}

EXPECTED_APPLICATION_TREES={'apps/PMC跟仓管/加工厂月度评审管理制度': '8c55491f1ce01be2f6090bdb02c2adf1656d4e18', 'apps/QA部/QC验货计划系统': '7585a3f6cef3f724cb8f6d03e548ddec42e1bc36', 'apps/工程部/3D打印协同平台': '6de1c27ba4508407fdf44fefce984e7a8ad59234', 'apps/业务部/内部报价系统': '7fc8118851a0baecb5b9c0d8eb4b94d1991782b5', 'apps/业务部/ZURU接单表入单系统': 'd4c36e517e8465daf1be5cd3b875b6e7f93cc57d'}
ZURU_COMMAND_BEFORE=['gunicorn','--bind','0.0.0.0:5005','--workers','2','--threads','4','--timeout','300','app:app']
ZURU_COMMAND_AFTER=['gunicorn','--bind','0.0.0.0:5005','--workers','1','--threads','4','--timeout','300','app:app']
MAPPING_PINS={'country_map.json': {'before': '2de5a5af98594e4d626b7b83565f906d50d776a9229871fbba572a8133b22174', 'after': 'c30a4583a6130ae8854308d7e251a2d45dbbeba4e01f11c565dc226a216f7c59', 'afterBytes': 26316}, 'item_map.json': {'before': 'e251ba63423890f9dfedf8706299ba7c21270ad439519ae0620ef03137700d90', 'after': 'c46d4e113144dc551e97d3e15b850602302b8efb8828dbf8258736097cef31f0', 'afterBytes': 63161}, 'customer_country.json': {'before': None, 'after': '85ca806b646163bace88eabc21eacc9157fac393a69fda4c007d27cb728c107a', 'afterBytes': 5354}}
STAGE='entrypoint';CORE=None;OUT=None;ENV=None
COMPOSE=['docker','compose','-p','rr-portal','-f',str(ROOT/'docker-compose.cloud.yml'),'--env-file',str(ROOT/'.env.cloud.production')]

def need(value):
 if not value:raise RuntimeError('BATCH_961_965_RELEASE_REJECTED')
def enc(value):return json.dumps(value,ensure_ascii=True,sort_keys=True,separators=(',',':'),allow_nan=False).encode()
def sha(value):return hashlib.sha256(value).hexdigest()
def core_load():
 path=pathlib.Path(__file__).with_name('batch-backup-library.py');need(path.is_file()and not path.is_symlink()and sha(path.read_bytes())==CORE_SHA);spec=importlib.util.spec_from_file_location('fixed_batch_backup_core',path);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module

def archive(path,manifest_sha,result_sha):
 need(re.fullmatch('[a-f0-9]{64}',manifest_sha or'')and re.fullmatch('[a-f0-9]{64}',result_sha or'')and path.is_dir()and not path.is_symlink()and stat.S_IMODE(path.stat().st_mode)==0o700);need(CORE.OPS.L.file_hash(path/'manifest.json')==manifest_sha and CORE.OPS.L.file_hash(path/'first-result.json')==result_sha);manifest=json.loads((path/'manifest.json').read_bytes());entries=list(path.rglob('*'));need(len(entries)<=100000 and all(not p.is_symlink()and(p.is_file()or p.is_dir())and p.stat().st_mode&0o077==0 for p in entries));need(set(manifest)=={str(p.relative_to(path))for p in entries if p.is_file()and p!=path/'manifest.json'});need(all(CORE.OPS.L.safe_path(n)and re.fullmatch('[a-f0-9]{64}',h)and CORE.OPS.L.file_hash(path/n)==h for n,h in manifest.items()));receipt=json.loads((path/'first-result.json').read_bytes());need(receipt.get('success')is True);return receipt

def original():
 receipt=archive(BACKUP,BACKUP_MANIFEST,BACKUP_RESULT);need(receipt.get('base')==BASE and all(receipt.get(k)is True for k in('backupComplete','allSevenTargetServicesBound','allPersistentMountsCaptured','allOriginalFullTypedRowsAndSchemaCaptured','allRuntimeSourceProofsMatchBase','composeVersionAndLiteralRuntimeEnvironmentsProven','startupSafetyPassed')));baseline=json.loads((BACKUP/'baseline.private.json').read_bytes());need(baseline['head']==BASE and set(baseline['runtime']['targets'])==set(ORDER)==CORE.SERVICES and set(baseline['storage'])==set(CORE.STORAGE)and baseline['composeEnvironmentProof']['composeVersion']=='5.1.0');return baseline

def operation(args,timeout=180,checkout=False):
 CORE.COUNTER+=1
 with(OUT/('%04d-%s.private.log'%(CORE.COUNTER,STAGE))).open('xb')as log:result=subprocess.run(args,stdout=log,stderr=subprocess.STDOUT,timeout=timeout,cwd=ROOT,env=ENV,umask=0o022 if checkout else -1)
 need(result.returncode==0)

def source_manifest():
 path=pathlib.Path(__file__).with_name('batch-reviewed-files.json');need(path.is_file()and not path.is_symlink()and sha(path.read_bytes())==SOURCE_MANIFEST_SHA);files=json.loads(path.read_bytes());need(type(files)is dict and 0<len(files)<=500 and len(files)==EXPECTED_CHANGED_FILES and all(CORE.OPS.L.safe_path(n)and re.fullmatch('[a-f0-9]{64}',h)and(n in{'docker-compose.cloud.yml','.env.example'}or any(n.startswith(p+'/')for p in CORE.APP_PREFIXES))for n,h in files.items()));return files

def checked_source(revision,before,files,canonical=False):
 CORE.BASE=revision;configuration=CORE.source();need(CORE.dirty_snapshot()==before['preexistingFourDirty']and CORE.OPS.L.file_hash(ROOT/'.env.cloud.production')==before['environmentSHA256']);need(CORE.run(['git','rev-parse',TARGET+'^{tree}']).decode().strip()==TREE);changed=CORE.run(['git','diff','--name-only','-z','--no-ext-diff','--no-textconv',BASE,TARGET]).decode().strip('\0').split('\0');need(set(changed)==set(files)and not set(changed)&set(before['preexistingFourDirty']));
 for prefix,tree in EXPECTED_APPLICATION_TREES.items():need(CORE.run(['git','rev-parse',TARGET+':'+prefix]).decode().strip()==tree)
 for name,checksum in configuration.items():need(checksum==(files[name]if revision==TARGET and name in files else before['configuration'][name]))
 for name,checksum in files.items():
  need(sha(CORE.run(['git','show',TARGET+':'+name]))==checksum)
  if canonical:
   path=ROOT/name;entry=CORE.run(['git','ls-tree','-z',TARGET,'--',name]).split(b'\t',1);need(len(entry)==2 and entry[1]==name.encode()+b'\0'and re.fullmatch(b'100(?:644|755) blob [a-f0-9]{40}',entry[0]));mode=0o755 if entry[0].startswith(b'100755')else 0o644
   for ancestor in(path,*path.parents):
    if ancestor==ROOT:break
    need(not ancestor.is_symlink())
   need(path.is_file()and stat.S_IMODE(path.stat().st_mode)==mode and CORE.OPS.L.file_hash(path)==checksum)

def before_maps(service,before):
 raw=json.loads((BACKUP/'target-inspect.private.json').read_bytes())[service];need(raw['Id']==before['runtime']['targets'][service]['id']);actual=CORE.envmap(raw['Config']['Env']);literal=json.loads((BACKUP/(service+'-literal-compose-environment.private.json')).read_bytes());declared=json.loads((BACKUP/(service+'-compose-environment.private.json')).read_bytes());image=json.loads((BACKUP/(service+'-image.private.json')).read_bytes());need(image['Id']==raw['Image']and CORE.literal_explicit_environment(actual,CORE.envmap(image['Config'].get('Env')or[]),declared)==literal);return actual,literal

def expected_maps(service,before):
 actual,literal=before_maps(service,before)
 if service in{'factory-review','factory-review-test'}:
  need(not set(actual)&set(AI_ADDITIONS)and not set(literal)&set(AI_ADDITIONS));actual.update(AI_ADDITIONS);literal.update(AI_ADDITIONS)
 return actual,literal

def compose_preflight(before,new):
 need(CORE.run(['docker','compose','version','--short']).decode().strip()=='5.1.0');CORE.COUNTER+=1
 with(OUT/('%04d-compose-stderr.private'%CORE.COUNTER)).open('xb')as errors:result=subprocess.run([*COMPOSE,'config','--format','json'],stdout=subprocess.PIPE,stderr=errors,timeout=90,cwd=ROOT,env=ENV)
 need(result.returncode==0 and len(result.stdout)<=32*1024**2);config=json.loads(result.stdout)
 for service in ORDER:
  _,literal=(expected_maps if new else before_maps)(service,before);need(config['services'][service].get('environment',{})==CORE.serialized_environment(literal))
 return {'composeVersionAndForwardSerializedEnvironmentsMatchFrozenLiteralValues':True,'newFactoryAIEnvironmentExplicitlyDisabledAndKeyModelEmpty':bool(new)}

def config_same(service,old,new,raw,before):
 if not all(old[k]==new[k]for k in('mounts','memory','swap','healthcheck','entrypoint','user','workingDirectory')):return False
 if service=='zuru-order-system':
  if old['command']!=ZURU_COMMAND_BEFORE or new['command']!=ZURU_COMMAND_AFTER:return False
 elif old['command']!=new['command']:return False
 expected,_=expected_maps(service,before)
 if CORE.envmap(raw['Config']['Env'])!=expected:return False
 proc=CORE.run(['docker','exec',new['id'],'cat','/proc/1/environ']);need(proc.endswith(b'\0'));current=CORE.envmap([v.decode()for v in proc.split(b'\0')if v]);need(current.pop('HOSTNAME',None)==new['id'][:12])
 if service in{'factory-review','factory-review-test'}:
  for key,value in AI_ADDITIONS.items():
   if current.pop(key,None)!=value:return False
 return sha(enc(current))==old['processEnvironmentWithoutAutomaticHostnameSHA256']

def flags(except_service=None):
 path=ROOT/'deploy/maintenance';need(path.is_dir()and not path.is_symlink());return[row for row in CORE.OPS.L.non_database_inventory(path,[])if row['path']!='services/'+str({'qc-plan-api':'qc-plan','qc-plan-web':'qc-plan'}.get(except_service,except_service))]
def maintenance(function,service):
 need(service in ORDER and function in{'maintenance_on','wait_service_ready','maintenance_off','require_maintenance_cleared'});operation(['bash','-c','set -euo pipefail; source "$1"; "$2" "$3"','batch-release',str(ROOT/'deploy/service-maintenance.sh'),function,service],340)

def current_startup_guard(service,raw):
 if service in{'factory-review','factory-review-test'}:
  environment=CORE.envmap(raw['Config']['Env']);email=environment.get('FACTORY_REVIEW_ADMIN_EMAIL','').strip();need(email and len(environment.get('FACTORY_REVIEW_ADMIN_PASSWORD',''))>=12);relative=CORE.STORAGE[service][1];path=ROOT/relative/'data.db'
  with sqlite3.connect(path.as_uri()+'?mode=ro',uri=True)as db:need(db.execute('SELECT COUNT(*) FROM users WHERE lower(email)=lower(?)',(email,)).fetchone()[0]==1)
 if service=='internal-quote':
  runtime,_=CORE.runtime();sql='BEGIN READ ONLY; SET LOCAL statement_timeout=\'30s\'; '+CORE.READONLY.startup_checks_sql()+'; COMMIT;\n';checks=json.loads(CORE.run(['docker','exec','-i',runtime['databaseContainer'],'sh','-c',CORE.PG_SHELL],sql.encode(),45));need(all(ok for ok,_ in CORE.READONLY.startup_safety_checks(checks)))

def closed_preswitch_startup_guard(service,raw,result):
 current_startup_guard(service,raw)
 if service not in{'qc-plan-api','printlink'}:return
 directory=OUT/(service+'-preswitch-sqlite');directory.mkdir(mode=0o700);runtime,_=CORE.runtime();roots,_=CORE.storage_roots({name:json.loads(CORE.run(['docker','inspect',row['id']]))[0]for name,row in runtime['targets'].items()});key='qc-plan-data'if service=='qc-plan-api'else'printlink-runtime';audit=CORE.OPS.L.snapshots(roots[key],directory);CORE.required_sqlite_databases(key,{'sqlite':audit})
 facts=CORE.qc_startup_facts(directory/'qc-inspection.db')if service=='qc-plan-api'else CORE.printlink_startup_facts(directory/'orders/printlink.sqlite',directory/'production.sqlite');result.setdefault('immediateStartupGuardFacts',{})[service]=facts;need(facts['existingStartupLogicallyNoOp']is True)

def mapping_preflight(before):
 root=ROOT/CORE.ZURU/'data';old={row['path']:row for row in before['storage']['zuru-data']['files']};already=False
 for name,pin in MAPPING_PINS.items():
  path=root/name;row=old.get(name)
  if pin['before']is None:
   if row is None:need(not path.exists()and not path.is_symlink());continue
   need(row.get('directory')is False and row.get('sha256')==pin['after']and row.get('bytes')==pin['afterBytes']and row.get('mode')==0o644);already=True
  else:need(row is not None and row.get('directory')is False and row.get('sha256')==pin['before']and row.get('mode')==0o644)
  need(sha(CORE.stable_environment_bytes(path))==(pin['after']if pin['before']is None else pin['before']))
 return already

def prepare_identical_existing_customer_file(already):
 if not already:return
 # The reviewed source adds this one path. A matching preexisting untracked
 # runtime file is indexed as that exact target blob, without moving/editing it.
 name=CORE.ZURU+'/data/customer_country.json';need(sha(CORE.stable_environment_bytes(ROOT/name))==MAPPING_PINS['customer_country.json']['after']);blob=CORE.run(['git','rev-parse',TARGET+':'+name]).decode().strip();need(re.fullmatch('[a-f0-9]{40}',blob));CORE.run(['git','update-index','--add','--cacheinfo','100644,'+blob+','+name])


class NoRedirect(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,request,fp,code,message,headers,newurl):return None

def get(url):
 parsed=urllib.parse.urlsplit(url);need(parsed.scheme=='http'and parsed.hostname=='127.0.0.1'and(parsed.port or 80)in{80,3100}and parsed.username is None and parsed.password is None and not parsed.query and not parsed.fragment and parsed.path.startswith('/')and'\\'not in url);request=urllib.request.Request(url,headers={'Cache-Control':'no-cache'});opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),NoRedirect())
 try:
  with opener.open(request,timeout=15)as response:body=response.read(16*1024**2+1);need(len(body)<=16*1024**2);return response.status,body
 except urllib.error.HTTPError as error:return error.code,b''

def public_probe(service,proof):
 if service in{'factory-review','factory-review-test'}:
  base='http://127.0.0.1/'+service+'/';expected=proof['publicFiles'];status,body=get(base);need(status==200 and sha(body)==expected['pb_public/index.html']['sha256'])
  for name,row in expected.items():
   if name.startswith('pb_public/assets/'):
    status,body=get(base+name[len('pb_public/'):]);need(status==200 and len(body)==row['bytes']and sha(body)==row['sha256'])
  need(get(base+'api/factory-review/health')[0]==200 and get(base+'api/factory-review/analysis-ai/config')[0]==401);return {'indexAndAllAssetsMatchContainerBytes':True,'health200':True,'anonymousAnalysisConfig401':True}
 endpoints={'internal-quote':'http://127.0.0.1/internal-quote/health','zuru-order-system':'http://127.0.0.1/zuru-order-system/health','qc-plan-api':'http://127.0.0.1/qc-plan/api/health','qc-plan-web':'http://127.0.0.1/qc-plan','printlink':'http://127.0.0.1:3100/api/health'};need(get(endpoints[service])[0]==200)
 if service=='internal-quote':need(all(get('http://127.0.0.1/internal-quote'+p)[0]==401 for p in('/api/auth/me','/api/quotes','/api/admin/users')))
 return {'healthOrWebEntrypoint200':True}

def service_proof(service,current):
 row=current['targets'][service]
 if service in{'factory-review','factory-review-test'}:return CORE.pocketbase_source(service,row)
 if service=='qc-plan-api':return CORE.qc_api_source(row)
 predicates={'qc-plan-web':(CORE.QC,lambda n:n.startswith('app/')or n in{'package.json','pnpm-lock.yaml','pnpm-workspace.yaml','next.config.mjs','postcss.config.mjs','tailwind.config.ts','tsconfig.json','.eslintrc.json'}),'printlink':(CORE.PRINT,lambda n:n in{'package.json','start.mjs'}or(n.startswith(('cloud/','production/','ops/','shared/'))and not n.startswith('production/tests/'))),'internal-quote':(CORE.QUOTE,lambda n:(n.startswith('backend/')and not n.startswith(('backend/data/','backend/uploads/')))or n.startswith('frontend/')),'zuru-order-system':(CORE.ZURU,lambda n:n in{'app.py','po_parser.py','requirements.txt'}or n.startswith(('templates/','static/')))};prefix,predicate=predicates[service];return CORE.source_files(row['id'],prefix,predicate)

def deploy(result,before,files):
 global STAGE
 STAGE='initial-runtime-source-and-maintenance';current,raw=CORE.runtime();need(current==before['runtime']and CORE.maintenance_inventory()==before['maintenanceInventory']);CORE.BASE=BASE;need(CORE.source()==before['configuration']and CORE.dirty_snapshot()==before['preexistingFourDirty']and CORE.OPS.L.file_hash(ROOT/'.env.cloud.production')==before['environmentSHA256']);
 for service in ORDER:maintenance('require_maintenance_cleared',service)
 result.update(compose_preflight(before,False));STAGE='exact-runtime-mapping-preflight';customerAlreadyExact=mapping_preflight(before);STAGE='fetch-exact-main';CORE.run(['git','-c','core.hooksPath=/dev/null','fetch','origin','main']);need(CORE.run(['git','rev-parse','FETCH_HEAD']).decode().strip()==TARGET);CORE.run(['git','merge-base','--is-ancestor',BASE,TARGET]);checked_source(BASE,before,files);STAGE='fast-forward-reviewed-source';prepare_identical_existing_customer_file(customerAlreadyExact);operation(['git','-c','core.hooksPath=/dev/null','-c','merge.autoStash=false','merge','--ff-only','--no-autostash',TARGET],180,checkout=True);checked_source(TARGET,before,files,True);result.update(compose_preflight(before,True));built={}
 # All expensive builds finish before the first target enters maintenance.
 for service in ORDER:
  STAGE=service+'-build-only-target-image';need(CORE.runtime()[0]==current);tag=raw[service]['Config']['Image'];need(tag.removesuffix(':latest')=='rr-portal-'+service);old=json.loads(CORE.run(['docker','image','inspect',tag]));need(len(old)==1 and old[0]['Id']==current['targets'][service]['image']);operation([*COMPOSE,'build',service],1800);candidate=json.loads(CORE.run(['docker','image','inspect',tag]));need(len(candidate)==1 and re.fullmatch('sha256:[a-f0-9]{64}',candidate[0]['Id'])and candidate[0]['Id']!=old[0]['Id']);actual,literal=expected_maps(service,before);defaults=CORE.envmap(candidate[0]['Config'].get('Env')or[]);need(dict(defaults,**literal)==actual);expected_command=ZURU_COMMAND_AFTER if service=='zuru-order-system'else raw[service]['Config'].get('Cmd');need(candidate[0]['Config'].get('Cmd')==expected_command and all(candidate[0]['Config'].get(key)==raw[service]['Config'].get(key)for key in('Entrypoint','User','WorkingDir')))
  if service=='zuru-order-system':need(raw[service]['Config'].get('Cmd')==ZURU_COMMAND_BEFORE)
  if service in{'factory-review','factory-review-test'}:need((candidate[0]['Config'].get('Labels')or{}).get('org.opencontainers.image.revision')==TARGET)
  built[service]=candidate[0]['Id'];checked_source(TARGET,before,files,True)
 expected=current;proofs={};public={};allflags=flags()
 for service in ORDER:
  STAGE=service+'-pre-switch-guards';observed,inspects=CORE.runtime();need(observed==expected);maintenance('require_maintenance_cleared',service);closed_preswitch_startup_guard(service,inspects[service],result);result.update(compose_preflight(before,True));previousflags=flags(service);STAGE=service+'-scoped-switch';maintenance('maintenance_on',service);switched=time.monotonic();operation([*COMPOSE,'up','-d','--no-build','--no-deps',service],180);maintenance('wait_service_ready',service);STAGE=service+'-actual-runtime-source';after,inspects=CORE.runtime();need(after['others']==expected['others']and all(after['targets'][name]==expected['targets'][name]for name in ORDER if name!=service));row=after['targets'][service];need(row['id']!=expected['targets'][service]['id']and row['image']==built[service]and row['restarts']==0 and config_same(service,before['runtime']['targets'][service],row,inspects[service],before));proofs[service]=service_proof(service,after);time.sleep(max(0,10-(time.monotonic()-switched)));need(CORE.runtime()[0]==after and flags(service)==previousflags);checked_source(TARGET,before,files,True);STAGE=service+'-clear-own-maintenance';maintenance('maintenance_off',service);maintenance('require_maintenance_cleared',service);need(flags()==allflags)
  try:public[service]=public_probe(service,proofs[service])
  except BaseException:maintenance('maintenance_on',service);raise
  expected=after
 STAGE='final-source-config-runtime-seals';original();checked_source(TARGET,before,files,True);need(CORE.runtime()[0]==expected and CORE.maintenance_inventory()==before['maintenanceInventory']);result.update(success=True,onlySevenTargetServicesRebuilt=True,allOtherContainersUnchanged=True,privateEnvironmentFileUnchanged=True,allPriorConfigurationMapsPreserved=True,onlyDisabledEmptyFactoryAIKeysAdded=True,onlyExactReviewedZuruWorkerCommandAndMappingChanges=True,fourExistingTrackedChangesPreserved=True,scopedMaintenanceOnly=True,runtimeAfter=expected,sourceProof=proofs,publicProbes=public)

def verify(result,before,files):
 global STAGE
 STAGE='deployed-sealed-receipt';receipt=archive(DEPLOY,DEPLOY_MANIFEST,DEPLOY_RESULT);need(receipt.get('target')==TARGET and receipt.get('onlySevenTargetServicesRebuilt')is True);current,raw=CORE.runtime();need(current==receipt['runtimeAfter']and current['others']==before['runtime']['others']);checked_source(TARGET,before,files,True);need(CORE.maintenance_inventory()==before['maintenanceInventory']);result.update(compose_preflight(before,True));roots,mounts=CORE.storage_roots(raw);need(mounts==before['storageMounts']);captured={};checks={};proofs={}
 for key,path in roots.items():
  STAGE=key+'-closed-readonly-snapshot';captured[key]=CORE.OPS.sqlite_capture(key,path,OUT/key);old=before['storage'][key];checks[key+'AllFullTypedRowsAndSchemaStrictlyIdentical']=old['sqlite']==captured[key]['sqlite'];checks[key+'FileBytesAndPermissionsStrictlyIdentical']=old['files']==captured[key]['files']
  if key=='quote-legacy':checks[key+'RawSQLiteBytesAndPermissionsStrictlyIdentical']=CORE.OPS.L.non_database_inventory(path,[])==old['completeRawFileInventory']
 STAGE='quote-exported-readonly-snapshot';postgres=CORE.OPS.pg_capture(current['databaseContainer'],OUT,False)['internal_quote'];old=before['postgres'];checks.update(quoteAllFullTypedRowsStrictlyIdentical=old['tables']==postgres['tables'],quoteFullSchemaAndSequenceDefinitionsStrictlyIdentical=old['schema']==postgres['schema'],quoteSequenceStateStrictlyIdenticalNonMVCC=old['sequenceStates']==postgres['sequenceStates'])
 for service in ORDER:
  STAGE=service+'-actual-source-and-public-boundaries';proofs[service]=service_proof(service,current);public_probe(service,proofs[service]);checks[service+'ConfigurationMapsPreserved']=config_same(service,before['runtime']['targets'][service],current['targets'][service],raw[service],before)
 STAGE='final-runtime-flags-env-seals';checked_source(TARGET,before,files,True);need(CORE.runtime()[0]==current and CORE.maintenance_inventory()==before['maintenanceInventory']);original();archive(DEPLOY,DEPLOY_MANIFEST,DEPLOY_RESULT);CORE.OPS.L.private_write(OUT/'observed.private.json',enc({'storage':captured,'postgres':postgres,'runtime':current,'sourceProof':proofs}));result.update(deploymentVerified=True,strictNoExemptionChecks=checks,strictAllSnapshotsIdentical=all(checks.values()),startupMigrationExceptionsApplied=False,requiresScopedDifferenceClassification=not all(checks.values()),success=all(checks.values()))

def main():
 global CORE,OUT,ENV
 need(len(sys.argv)==2 and sys.argv[1]in{'deploy','verify'});mode=sys.argv[1];need((DEPLOY_PIN if mode=='deploy'else VERIFY_PIN)and re.fullmatch('[a-f0-9]{40}',TARGET or'')and re.fullmatch('[a-f0-9]{40}',TREE or'')and re.fullmatch('[a-f0-9]{64}',SOURCE_MANIFEST_SHA or'')and os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_ATTEMPT')=='1');os.umask(0o077);OUT=DEPLOY if mode=='deploy'else VERIFY;OUT.mkdir(mode=0o700);CORE=core_load();CORE.OUT=OUT;CORE.OPS=CORE.load('release-data-ops-library.py');CORE.OPS.L=CORE.OPS.load_library(pathlib.Path(__file__).with_name('release-data-library.py'));CORE.READONLY=CORE.load('internal-quote-readonly-library.py');CORE.PDB=CORE.load('portable-pdb-library.py');CORE.OPS.SCHEMAS=('internal_quote',);CORE.OPS.NEW_COLUMNS={};CORE.OPS.run=CORE.run;CORE.READONLY.run=CORE.run
 ENV=dict(os.environ,AFTER_COMMIT=TARGET,COMPOSE_BAKE='false',COMPOSE_PARALLEL_LIMIT='1',COMPOSE_PROJECT_NAME='rr-portal',MAINT_FLAG_DIR=str(ROOT/'deploy/maintenance'),COMPOSE_FILE=str(ROOT/'docker-compose.cloud.yml'),ENV_FILE=str(ROOT/'.env.cloud.production'),MAINT_COMPOSE_SERVICES='\n'.join(ORDER),MAINT_HEALTH_TIMEOUT_SECONDS='300',MAINT_DNS_GRACE_SECONDS='10')
 for prefix in('FACTORY_REVIEW_AI_','FACTORY_REVIEW_TEST_AI_'):
  for suffix,value in{'ENABLED':'false','API_KEY':'','MODEL':'','BASE_URL':'https://api.openai.com/v1'}.items():ENV[prefix+suffix]=value
 def stop(*_):need(False)
 signal.signal(signal.SIGTERM,stop);result={'mode':mode,'success':False,'base':BASE,'target':TARGET,'expectedTree':TREE,'businessWritesPerformed':False,'credentialsChanged':False,'environmentFileModified':False,'globalHooksRun':False,'globalMaintenanceChanged':False,'externalAICallsOrPaidRequestsPerformed':False,'printlinkAuthorityEnabled':False,'automaticRollbackOrDataRestorePerformed':False}
 try:before=original();files=source_manifest();(deploy if mode=='deploy'else verify)(result,before,files)
 except BaseException:result['failedStage']=STAGE
 finally:CORE.OPS.L.private_write(OUT/'first-result.json',enc(result));CORE.OPS.L.seal(OUT);public={k:v for k,v in result.items()if k not in{'runtimeAfter','sourceProof'}};print(enc(dict(public,manifestSHA256=CORE.OPS.L.file_hash(OUT/'manifest.json'),resultSHA256=CORE.OPS.L.file_hash(OUT/'first-result.json'))).decode(),flush=True)
 return 0 if result['success']else 1
if __name__=='__main__':
 try:code=main()
 except BaseException:print('{"success":false,"safeFailure":"BATCH_961_965_RELEASE_PREFLIGHT_FAILED"}',flush=True);code=1
 sys.exit(code)
