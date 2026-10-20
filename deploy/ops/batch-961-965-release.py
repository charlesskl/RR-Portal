"""Fixed seven-service scoped deployment and strict read-only verification.
Draft: both gates and all target/archive/source facts must be frozen before use.
Strict verification deliberately has no startup-migration exemptions yet.
"""
import contextlib,copy,difflib,hashlib,html.parser,importlib.util,json,os,pathlib,re,signal,sqlite3,stat,subprocess,sys,time,urllib.error,urllib.parse,urllib.request
ROOT=pathlib.Path('/opt/rr-portal');BASE='9a62c7059600c12d4781b94f69098e37a32d901d';TARGET='4f1f64cac098caa6b202eb27cae9ab8fad9109dd';TREE='f062e722bb9a16d51856e494f41a58d3e3670dd2'
BRANCH='refs/heads/ops/batch-961-965-20261020';DEPLOY_PIN=True;VERIFY_PIN=False
CORE_SHA='4259dcbba7cbdc78809e286c3b20829644104e4a30b284bea84cc6b20f0c24b5';SOURCE_MANIFEST_SHA='c6a2c4b7ea1e5866ed351d1fcef54f2d27f44d099e50879a95bfd535a38e2ab6';EXPECTED_CHANGED_FILES=83
BACKUP=ROOT/'deploy/backups/batch-961-965-20261020-backup';BACKUP_MANIFEST='a18052ed05e4fea60d0073f71aa5a809f395739c89ce63eddf5dfc9ac0ef8924';BACKUP_RESULT='3928baa1a0e10249f22ef26e19d7a4a1be018aefa03b557bcb6c65cfc66aec3e'
DEPLOY=BACKUP.with_name('batch-961-965-20261020-deploy-05');VERIFY=BACKUP.with_name('batch-961-965-20261020-verify-05');DEPLOY_MANIFEST='';DEPLOY_RESULT=''
ORDER=('factory-review','factory-review-test','internal-quote','zuru-order-system','qc-plan-api','qc-plan-web','printlink')
AI_ADDITIONS={'FACTORY_REVIEW_AI_ENABLED':'false','FACTORY_REVIEW_AI_API_KEY':'','FACTORY_REVIEW_AI_MODEL':'','FACTORY_REVIEW_AI_BASE_URL':'https://api.openai.com/v1'}

EXPECTED_APPLICATION_TREES={'apps/PMC跟仓管/加工厂月度评审管理制度': '8c55491f1ce01be2f6090bdb02c2adf1656d4e18', 'apps/QA部/QC验货计划系统': '7585a3f6cef3f724cb8f6d03e548ddec42e1bc36', 'apps/工程部/3D打印协同平台': '6de1c27ba4508407fdf44fefce984e7a8ad59234', 'apps/业务部/内部报价系统': '7fc8118851a0baecb5b9c0d8eb4b94d1991782b5', 'apps/业务部/ZURU接单表入单系统': 'd4c36e517e8465daf1be5cd3b875b6e7f93cc57d'}
ZURU_COMMAND_BEFORE=['gunicorn','--bind','0.0.0.0:5005','--workers','2','--threads','4','--timeout','300','app:app']
ZURU_COMMAND_AFTER=['gunicorn','--bind','0.0.0.0:5005','--workers','1','--threads','4','--timeout','300','app:app']
MAPPING_PINS={'country_map.json': {'before': '2de5a5af98594e4d626b7b83565f906d50d776a9229871fbba572a8133b22174', 'after': 'c30a4583a6130ae8854308d7e251a2d45dbbeba4e01f11c565dc226a216f7c59', 'afterBytes': 26316}, 'item_map.json': {'before': 'e251ba63423890f9dfedf8706299ba7c21270ad439519ae0620ef03137700d90', 'after': 'c46d4e113144dc551e97d3e15b850602302b8efb8828dbf8258736097cef31f0', 'afterBytes': 63161}, 'customer_country.json': {'before': None, 'after': '85ca806b646163bace88eabc21eacc9157fac393a69fda4c007d27cb728c107a', 'afterBytes': 5354}}
ORIGINAL_FAILED=BACKUP.with_name('batch-961-965-20261020-deploy');DIAGNOSIS=BACKUP.with_name('batch-961-965-20261020-map-diagnosis-01')
FAILED_MANIFEST='d3f3f11636e58ee719bfda2e468f6b74b3258ed6b940afe3b919b14133ae3ea8';FAILED_RESULT='9a9bcbe5d5571b7d9893240f090115a125f0b0b9be7a0149d78a02fd6324603c'
DIAGNOSIS_MANIFEST='43af689118882628882116d56aea1032c4029f6997b9e7902d3d3f5d59cd1a13';DIAGNOSIS_RESULT='6b951cfe061aa5828148d6dda8f39bbbb98b23c1b042b9df752552ea079e2b20'
WRITABLE_MAPS={'country_map.json':{'beforeMode':0o666,'afterMode':0o666,'beforeBytes':26315},'item_map.json':{'beforeMode':0o666,'afterMode':0o666,'beforeBytes':60903}}
FAILED_SECOND=BACKUP.with_name('batch-961-965-20261020-deploy-02');BUILD_DIAGNOSIS=BACKUP.with_name('batch-961-965-20261020-build-diagnosis-01');USER_DIAGNOSIS_FAILED=BACKUP.with_name('batch-961-965-20261020-build-user-diagnosis-01');USER_DIAGNOSIS=BACKUP.with_name('batch-961-965-20261020-build-user-diagnosis-02')
FAILED_SECOND_MANIFEST='942c5af4a5cf3a56e2e1d5da809f6de3420f6234ca982a573e6c2a93ff2f95b8';FAILED_SECOND_RESULT='bf48bd1906df35af795558809340fdc9ebdfa9cc345cbbf0e0488045cef498b0'
BUILD_DIAGNOSIS_MANIFEST='f35be3a22d00bb41515b243735703b2d1709f497483a4b44f3e0289e96cbbb0b';BUILD_DIAGNOSIS_RESULT='e7ec9c7f6614ca86e8e49103154915d4e0731d69e6a3fcd846c4a125d6b8b910'
USER_FAILED_MANIFEST='d7c641a7e8c07242a1e1d26c9b01fbf6e0ae4976699559522c86d31cbb6fafb6';USER_FAILED_RESULT='68602e41196426c0726e0e8603d1ec126d880beda3d4779083a6d42e16edd801'
USER_DIAGNOSIS_MANIFEST='e87d63dc7933067f755bbb44b1cc6dd18dc8e34f270ec361cb158df71b6c92e6';USER_DIAGNOSIS_RESULT='8a24b3e7531ee172d247dca4c239e4757689e39d75dac295dfcb587bd8c4f324';USER_EXECUTED_HELPER='f07fccaeaed480c71c5691d215aa8c73edcafbecc487e1e18f1c6d864678cd7a'
REUSED_FACTORY_IMAGE='sha256:fec30b798833324d9dda79141e25f2ebfb790e202ac383c8c92346cfcdb8a01f'
FAILED_THIRD=BACKUP.with_name('batch-961-965-20261020-deploy-03');CANDIDATE_DIAGNOSIS=BACKUP.with_name('batch-961-965-20261020-candidate-diagnosis-03-01')
FAILED_THIRD_MANIFEST='6255d1978b12ac49b8ee92cd6b2afec1609428493af34c53c8ad6035fe9f0327';FAILED_THIRD_RESULT='ae7e007348436ab81b8f6be3e00383dd58377273472c719c01226b7018c71dc3'
CANDIDATE_DIAGNOSIS_MANIFEST='c9fdbc36e2bbb2b77a49be3346d3534deab999e378722397936eecd3bf7e0b93';CANDIDATE_DIAGNOSIS_RESULT='e2681a9ca81db3d0783f198d77d14850ba64f93c5832a9ee152460e4b5ead491'
REUSED_IMAGES={'factory-review':'sha256:fec30b798833324d9dda79141e25f2ebfb790e202ac383c8c92346cfcdb8a01f','factory-review-test':'sha256:76665e7c49a25992580e34a633550e13878197dc51b05dbd9791061d45e77d00','internal-quote':'sha256:b80be2a626e5ee9fbd64530fa1429d04f550cec41c4790f25aa952e4790bd3da'}
REJECTED_ZURU_IMAGE='sha256:b4d3baa9b72f3a6b976c4331410e17704f464ebee572e70fc9512f070f4b2220'
FAILED_FOURTH=BACKUP.with_name('batch-961-965-20261020-deploy-04');REGISTRY_DIAGNOSIS=BACKUP.with_name('batch-961-965-20261020-registry-diagnosis-04-01')
FAILED_FOURTH_MANIFEST='86224078873d37331447df5d1d2b99073a34429eb4979949403b2e43a7bf4790';FAILED_FOURTH_RESULT='f05beadfc42b37d54764c3d36db1febaf79ecdd2874b736ea0191f7e76f41ccf'
REGISTRY_DIAGNOSIS_MANIFEST='24a0167da1e5f69dcb47e181fdc959e6a89030811bf9c42c4f631aa06de25a14';REGISTRY_DIAGNOSIS_RESULT='c6b589d93e789ef03a0cb01e7cf615ed1fae9ab7789f8907c4e453b8d55fd270'
ZURU_GIT_RECIPE_SHA='0d85ba58982b4222611868395b886f0575f6c54c3a0242f1e42b9a82e87acd58';ZURU_VERSION_ONLY_RECIPE_SHA='18570817978023a8201db96ccf7bf25b2c7fcfdb2504b7b05130e9ec809865c6'
STAGE='entrypoint';CORE=None;OUT=None;ENV=None
COMPOSE=['docker','compose','-p','rr-portal','-f',str(ROOT/'docker-compose.cloud.yml'),'--env-file',str(ROOT/'.env.cloud.production')]

def need(value):
 if not value:raise RuntimeError('BATCH_961_965_RELEASE_REJECTED')
def enc(value):return json.dumps(value,ensure_ascii=True,sort_keys=True,separators=(',',':'),allow_nan=False).encode()
def sha(value):return hashlib.sha256(value).hexdigest()
def core_load():
 path=pathlib.Path(__file__).with_name('batch-backup-library.py');need(path.is_file()and not path.is_symlink()and sha(path.read_bytes())==CORE_SHA);spec=importlib.util.spec_from_file_location('fixed_batch_backup_core',path);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module

def archive(path,manifest_sha,result_sha,success=True):
 need(re.fullmatch('[a-f0-9]{64}',manifest_sha or'')and re.fullmatch('[a-f0-9]{64}',result_sha or'')and path.is_dir()and not path.is_symlink()and stat.S_IMODE(path.stat().st_mode)==0o700);need(CORE.OPS.L.file_hash(path/'manifest.json')==manifest_sha and CORE.OPS.L.file_hash(path/'first-result.json')==result_sha);manifest=json.loads((path/'manifest.json').read_bytes());entries=list(path.rglob('*'));need(len(entries)<=100000 and all(not p.is_symlink()and(p.is_file()or p.is_dir())and p.stat().st_mode&0o077==0 for p in entries));need(set(manifest)=={str(p.relative_to(path))for p in entries if p.is_file()and p!=path/'manifest.json'});need(all(CORE.OPS.L.safe_path(n)and re.fullmatch('[a-f0-9]{64}',h)and CORE.OPS.L.file_hash(path/n)==h for n,h in manifest.items()));receipt=json.loads((path/'first-result.json').read_bytes());need(receipt.get('success')is success);return receipt

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
   if name in{CORE.ZURU+'/data/'+n for n in WRITABLE_MAPS}:need(entry[0].startswith(b'100644'));mode=0o666
   for ancestor in(path,*path.parents):
    if ancestor==ROOT:break
    need(not ancestor.is_symlink())
   need(path.is_file()and stat.S_IMODE(path.stat().st_mode)==mode and CORE.OPS.L.file_hash(path)==checksum)

def recovery_evidence(before):
 failed=archive(ORIGINAL_FAILED,FAILED_MANIFEST,FAILED_RESULT,False);diagnosis=archive(DIAGNOSIS,DIAGNOSIS_MANIFEST,DIAGNOSIS_RESULT);need(failed.get('failedStage')=='exact-runtime-mapping-preflight'and failed.get('base')==BASE and failed.get('target')==TARGET and diagnosis.get('mode')=='map-diagnosis'and diagnosis.get('failedReleaseArchiveRetainedAndValid')is True and diagnosis.get('observationsStableDuringDiagnosis')is True)
 for key in('beforeReadOnlyObservations','afterReadOnlyObservations'):
  facts=diagnosis[key];need(facts.get('head')==BASE and all(facts.get(name)is True for name in('headStillBase','allTargetAndOtherRuntimeConfigurationUnchanged','environmentBytesUnchanged','preexistingFourDirtyExactlyUnchanged','allMaintenanceFlagsUnchanged')))
 rows={row['path']:row for row in before['storage']['zuru-data']['files']};need('customer_country.json'not in rows and diagnosis['baselineMaps']['customer_country.json']=={'inventory':None,'present':False}and diagnosis['currentMaps']['customer_country.json']=={'ancestorSymlink':False,'present':False,'symlink':False})
 for name,policy in WRITABLE_MAPS.items():
  row=rows[name];old=diagnosis['baselineMaps'][name];current=diagnosis['currentMaps'][name];need(old['inventory']==row and old['present']is True and row['mode']==policy['beforeMode']and row['sha256']==MAPPING_PINS[name]['before']and row['bytes']==policy['beforeBytes']and row['directory']is False and current['present']is True and current['regular']is True and current['symlink']is False and current['ancestorSymlink']is False and current['mode']==row['mode']and current['sha256']==row['sha256']and current['bytes']==row['bytes']and current['canonicalJSONSHA256']==old['canonicalJSONSHA256']and current['entries']==old['entries']and current['kind']==old['kind']=='object'and diagnosis['indexTags'][name]=='H')
 return {'failedReleaseAndReadOnlyDiagnosisArchivesValidated':True,'diagnosisProvesNoPriorSourceOrRuntimeMutation':True,'onlyTwoOriginalWritableMapModesBoundToSealed0666':True}

def restore_original_writable_map_modes(before,receipts=None):
 rows={row['path']:row for row in before['storage']['zuru-data']['files']};result={}if receipts is None else receipts;need(not result);opened={};key=lambda value:(value.st_dev,value.st_ino,value.st_mode,value.st_size,value.st_mtime_ns,value.st_ctime_ns,value.st_nlink)
 with contextlib.ExitStack()as stack:
  # Validate both original receipts and both open target descriptors before any
  # permission mutation. A second-file mismatch cannot alter the first file.
  for name,policy in WRITABLE_MAPS.items():
   original=rows[name];pin=MAPPING_PINS[name];need(original['mode']==policy['beforeMode']==policy['afterMode']==0o666 and original['sha256']==pin['before']and original['bytes']==policy['beforeBytes']);path=ROOT/CORE.ZURU/'data'/name
   for ancestor in(path,*path.parents):
    if ancestor==ROOT:break
    need(not ancestor.is_symlink())
   stream=stack.enter_context(os.fdopen(os.open(path,os.O_RDONLY|os.O_NOFOLLOW),'rb'));info=os.fstat(stream.fileno());need(stat.S_ISREG(info.st_mode)and info.st_nlink==1 and stat.S_IMODE(info.st_mode)in{0o644,0o666}and info.st_size==pin['afterBytes']);content=stream.read(pin['afterBytes']+1);need(len(content)==pin['afterBytes']and sha(content)==pin['after']and key(info)==key(os.fstat(stream.fileno()))==key(path.lstat()));opened[name]=(stream,path,info)
  for name,(stream,path,info)in opened.items():
   pin=MAPPING_PINS[name];stream.seek(0);need(sha(stream.read(pin['afterBytes']+1))==pin['after']and key(info)==key(os.fstat(stream.fileno()))==key(path.lstat()))
  for name,(stream,path,info)in opened.items():
   policy=WRITABLE_MAPS[name];pin=MAPPING_PINS[name];need(key(info)==key(os.fstat(stream.fileno()))==key(path.lstat()));changed=stat.S_IMODE(info.st_mode)!=policy['afterMode'];result[name]={'sealedBeforeMode':policy['beforeMode'],'modeAfterGitCheckout':stat.S_IMODE(info.st_mode),'requestedPreservedAfterMode':policy['afterMode'],'reviewedTargetBytesSHA256':pin['after'],'fdFchmodAttempted':changed,'originalModePreserved':False}
   if changed:os.fchmod(stream.fileno(),policy['afterMode'])
   final=os.fstat(stream.fileno());need(stat.S_IMODE(final.st_mode)==policy['afterMode']and(info.st_dev,info.st_ino,info.st_size,info.st_mtime_ns)==(final.st_dev,final.st_ino,final.st_size,final.st_mtime_ns)and key(final)==key(path.lstat()));stream.seek(0);need(sha(stream.read(pin['afterBytes']+1))==pin['after']and key(final)==key(os.fstat(stream.fileno()))==key(path.lstat()));result[name].update(preservedAfterMode=policy['afterMode'],originalModePreserved=True,fdFchmodPerformed=changed)
 return result


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
  else:need(name in WRITABLE_MAPS and row is not None and row.get('directory')is False and row.get('sha256')==pin['before']and row.get('mode')==WRITABLE_MAPS[name]['beforeMode']and row.get('bytes')==WRITABLE_MAPS[name]['beforeBytes'])
  need(sha(CORE.stable_environment_bytes(path))==(pin['after']if pin['before']is None else pin['before'])and stat.S_IMODE(path.lstat().st_mode)==row['mode'])
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

def recovery03_evidence(before):
 initial=recovery_evidence(before);failed=archive(FAILED_SECOND,FAILED_SECOND_MANIFEST,FAILED_SECOND_RESULT,False);build=archive(BUILD_DIAGNOSIS,BUILD_DIAGNOSIS_MANIFEST,BUILD_DIAGNOSIS_RESULT);failed_user=archive(USER_DIAGNOSIS_FAILED,USER_FAILED_MANIFEST,USER_FAILED_RESULT,False);user=archive(USER_DIAGNOSIS,USER_DIAGNOSIS_MANIFEST,USER_DIAGNOSIS_RESULT,False);need(failed.get('failedStage')=='factory-review-build-only-target-image'and failed.get('target')==TARGET and build.get('mode')=='build-diagnosis'and failed_user.get('mode')=='build-user-diagnosis'and failed_user.get('failedStage')=='candidate-image-guard-observations'and user.get('mode')=='build-user-diagnosis'and user.get('failedStage')=='old-image-user-classification'and user.get('executedHelperSHA256')==USER_EXECUTED_HELPER and user.get('loadedReleaseHelperSHA256')=='8b14210379e6fb4031e46933d8f69ac7da8d67cdc4aca7a2a53a48c109fad791')
 for receipt in(build,user):
  need(receipt.get('observationsStableDuringDiagnosis')is True)
  for key in('beforeReadOnlyObservations','afterReadOnlyObservations'):
   facts=receipt[key];need(set(facts)=={'head','all83SourceBytesAndModesIncludingTwoExact0666MapsMatchReviewedTarget','allMaintenanceFlagsUnchanged','allOtherContainersUnchanged','allSevenOldContainerIDsAndConfigurationsUnchanged','environmentBytesUnchanged','headMatchesReviewedTarget','preexistingFourDirtyExactlyUnchanged'}and facts.get('head')==TARGET and all(value is True for name,value in facts.items()if name!='head'))
  need(receipt['candidate']['candidateImageID']==REUSED_FACTORY_IMAGE and receipt['candidate']['oldRunningImageID']==before['runtime']['targets']['factory-review']['image']and receipt['candidate']['candidateOCIRevision']==TARGET)
 classes=user['candidate']['userConfigurationClasses'];need(classes=={'oldRunningContainer':'empty','candidateImage':'missing'}and user['candidate']['normalizedMissingNullEmptyUserMatchesOldContainer']is True and user['candidate']['oldImageInspectionExitCode']==1 and user['candidate']['oldImageReadFailureClass']=='FixedDockerImageReadFailed');oldimage=json.loads((BACKUP/'factory-review-image.private.json').read_bytes());need(oldimage['Id']==before['runtime']['targets']['factory-review']['image']and oldimage['Config'].get('User')in(None,''))
 guards=build['candidate']['guards'];need(user['candidate']['guards']==guards);need(set(guards)=={'candidateImageIDChangedFromOldRunningImage','candidateExplicitLiteralEnvironmentExactlyPreservesOldPlusDisabledAI','candidateCommandIdentical','candidateEntrypointIdentical','candidateUserIdentical','candidateWorkingDirectoryIdentical','candidateOCIRevisionMatchesTarget'}and guards['candidateUserIdentical']is False and all(value is True for name,value in guards.items()if name!='candidateUserIdentical'))
 return {'initialModeRecoverySealedEvidence':initial,'bothPriorFailedDeploymentReceiptsRetainedAndValid':True,'buildDiagnosisAndFailedIdentityDiagnosisWithRetainedPrimaryFactsValidated':True,'liveOldImageInspectionUnavailableExitOneRetained':True,'sealedOriginalFactoryImageUserMissingNullOrEmpty':True,'firstFailedIdentityDiagnosisRetainedWithoutCauseAttribution':True,'factoryBuildSucceededButCandidateUserSerializationGuardRejected':True,'onlyMissingNullEmptyDefaultUserSerializationDifferenceProven':True}

def prebuild_identity_evidence(before,raw):
 cid=before['runtime']['targets']['factory-review']['id'];need(re.fullmatch('[a-f0-9]{64}',cid));content=CORE.run(['docker','exec',cid,'cat','/proc/1/status']);CORE.OPS.L.private_write(OUT/'old-factory-proc1-status.private',content);status=content.decode('utf-8');facts={}
 for name in('Uid','Gid'):
  matches=re.findall(r'^'+name+r':\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*$',status,re.M);need(len(matches)==1);facts[name]=[int(value)for value in matches[0]]
 need(facts=={'Uid':[0,0,0,0],'Gid':[0,0,0,0]});classes={}
 for service in ORDER:
  image=json.loads((BACKUP/(service+'-image.private.json')).read_bytes());need(image['Id']==raw[service]['Image']);values=(raw[service]['Config'].get('User'),image['Config'].get('User'));need(all(value is None or type(value)is str for value in values));classes[service]={'oldContainerUserNotDeclared':values[0]in(None,''),'sealedOldImageUserNotDeclared':values[1]in(None,''),'nonemptyConfiguredUsersRemainExact':True}
 proof={'oldFactoryProcessNumericIdentity':facts,'oldFactoryProcessContainerID':cid,'allSevenOriginalImageUserDeclarationsBoundToSealedBackup':classes,'readBeforeAnyImageBuildOrMaintenance':True};CORE.OPS.L.private_write(OUT/'prebuild-identity-evidence.private.json',enc(proof));return proof

def candidate_config_compatible(service,candidate,raw,before):
 old=json.loads((BACKUP/(service+'-image.private.json')).read_bytes());need(old['Id']==raw['Image']);old_user=raw['Config'].get('User');new_user=candidate['Config'].get('User');image_user=old['Config'].get('User');need(all(value is None or type(value)is str for value in(old_user,new_user,image_user)));user_exact=new_user==old_user;default_only=all(value in(None,'')for value in(old_user,new_user,image_user));need(user_exact or default_only);expected_command=ZURU_COMMAND_AFTER if service=='zuru-order-system'else raw['Config'].get('Cmd');need(candidate['Config'].get('Cmd')==expected_command and all(candidate['Config'].get(key)==raw['Config'].get(key)for key in('Entrypoint','WorkingDir')))
 actual,literal=expected_maps(service,before);defaults=CORE.envmap(candidate['Config'].get('Env')or[]);need(dict(defaults,**literal)==actual)
 if service=='zuru-order-system':need(raw['Config'].get('Cmd')==ZURU_COMMAND_BEFORE)
 if service in{'factory-review','factory-review-test'}:need((candidate['Config'].get('Labels')or{}).get('org.opencontainers.image.revision')==TARGET)
 return {'candidateUserRawExact':user_exact,'missingNullEmptyDefaultSerializationOnly':not user_exact and default_only,'oldImageAndOldContainerAndNewCandidateDefaultsValidated':default_only,'nonemptyUserNamesUIDsAndGroupsNeverNormalized':True}

def recovery04_evidence(before):
    previous=recovery03_evidence(before)
    failed=archive(FAILED_THIRD,FAILED_THIRD_MANIFEST,FAILED_THIRD_RESULT,False)
    diagnosis=archive(CANDIDATE_DIAGNOSIS,CANDIDATE_DIAGNOSIS_MANIFEST,CANDIDATE_DIAGNOSIS_RESULT)
    need(failed.get('failedStage')=='zuru-order-system-candidate-config-validation' and failed.get('target')==TARGET and diagnosis.get('mode')=='candidate-diagnosis-03' and diagnosis.get('executedHelperSHA256')=='88d2baa9ec9da67493cd0fa1c9f4ea1334cbc36c71de7dd254fe56b97fca1629' and diagnosis.get('observationsStableDuringDiagnosis')is True and set(diagnosis['tags'])==set(ORDER))
    for key in('beforeReadOnlyObservations','afterReadOnlyObservations'):
        facts=diagnosis[key];need(set(facts)=={'head','all83SourceBytesAndModesIncludingTwoExact0666MapsMatchReviewedTarget','allMaintenanceFlagsUnchanged','allOtherContainersUnchanged','allSevenOldContainerIDsAndConfigurationsUnchanged','environmentBytesUnchanged','headMatchesReviewedTarget','preexistingFourDirtyExactlyUnchanged'} and facts['head']==TARGET and all(value is True for name,value in facts.items()if name!='head'))
    expected=dict(REUSED_IMAGES,**{'zuru-order-system':REJECTED_ZURU_IMAGE})
    for service,row in diagnosis['tags'].items():
        old=before['runtime']['targets'][service]['image'];need(row['oldRunningImageID']==old)
        if service in expected:need(row['currentImageID']==expected[service] and row['currentImageIDBoundToSealedBuildEvidence']is True and row['tagStillOldRunningImage']is False)
        else:need(row['currentImageID']==old and row['tagStillOldRunningImage']is True)
    zuru=diagnosis['tags']['zuru-order-system'];need(zuru['changedAllowedEnvironmentKeyNames']==['PYTHON_SHA256','PYTHON_VERSION'] and zuru['changedOtherEnvironmentKeyCount']==0 and zuru['totalChangedEnvironmentKeyCount']==2 and zuru['publicRuntimeVersions']=={'PYTHON_VERSION':{'old':'3.12.13','candidate':'3.12.15'}} and zuru['guards']['candidateEnvironmentExactlyMatchesPreservedLiteralValues']is False and all(value is True for key,value in zuru['guards'].items()if key not in{'candidateEnvironmentExactlyMatchesPreservedLiteralValues','candidateUserRawExact'}))
    return {'previousRecoverySealedEvidence':previous,'thirdFailureAndSevenTagDiagnosisSealsValidated':True,'onlyKnownZuruPythonPatchDriftRejected':True,'threeReusableImageIDsAndOneRejectedZuruImageBoundToSealedBuilds':True}


def private_capture(args,name,timeout=180):
    need(re.fullmatch('[a-z0-9-]+',name))
    output=OUT/(name+'.private.json')
    with output.open('xb')as stream,(OUT/(name+'-stderr.private')).open('xb')as errors:
        completed=subprocess.run(args,stdout=stream,stderr=errors,timeout=timeout,cwd=ROOT,env=ENV)
    need(completed.returncode==0 and output.stat().st_size<=32*1024**2)
    return output.read_bytes()


def resolve_python_base(index):
    need(type(index)is dict and index.get('schemaVersion')==2 and index.get('mediaType')in{'application/vnd.oci.image.index.v1+json','application/vnd.docker.distribution.manifest.list.v2+json'} and type(index.get('manifests'))is list and 0<len(index['manifests'])<=64)
    choices=[row for row in index['manifests']if type(row)is dict and type(row.get('platform'))is dict and row['platform'].get('os')=='linux'and row['platform'].get('architecture')=='amd64'and row['platform'].get('variant')in(None,'')]
    need(len(choices)==1 and re.fullmatch('sha256:[a-f0-9]{64}',choices[0].get('digest',''))and choices[0].get('mediaType')in{'application/vnd.oci.image.manifest.v1+json','application/vnd.docker.distribution.manifest.v2+json'})
    return choices[0]['digest']


def exact_zuru_recipe(original):
    need(type(original)is bytes and sha(original)==ZURU_GIT_RECIPE_SHA and original.count(b'FROM python:3.12-slim\n')==1 and original.startswith(b'FROM python:3.12-slim\n'))
    actual=original.replace(b'FROM python:3.12-slim\n',b'FROM python:3.12.13-slim\n',1)
    need(sha(actual)==ZURU_VERSION_ONLY_RECIPE_SHA and actual.replace(b'FROM python:3.12.13-slim\n',b'FROM python:3.12-slim\n',1)==original)
    return actual


def recovery05_evidence(before):
    previous=recovery04_evidence(before);failed=archive(FAILED_FOURTH,FAILED_FOURTH_MANIFEST,FAILED_FOURTH_RESULT,False);diagnosis=archive(REGISTRY_DIAGNOSIS,REGISTRY_DIAGNOSIS_MANIFEST,REGISTRY_DIAGNOSIS_RESULT)
    need(failed.get('failedStage')=='zuru-resolve-python-3-12-13-manifest-descriptor'and failed.get('target')==TARGET and diagnosis.get('mode')=='registry-diagnosis-04'and diagnosis.get('executedHelperSHA256')=='e9c9007d196bbcc2ba332eab5519b4278a97b45cf400a04e040d1f1bcee4d3d9'and diagnosis.get('failedReleaseArchiveRetainedAndValid')is True and diagnosis.get('observationsStableDuringDiagnosis')is True and diagnosis.get('liveRegistryHTTPOrLoginRequestsPerformed')is False and diagnosis.get('buildsOrServiceSwitchesPerformed')is False)
    for key in('beforeReadOnlyObservations','afterReadOnlyObservations'):
        facts=diagnosis[key];need(facts.get('head')==TARGET and all(facts.get(name)is True for name in('all83SourceBytesAndModesIncludingTwoExact0666MapsMatchReviewedTarget','allMaintenanceFlagsUnchanged','allOtherContainersUnchanged','allSevenOldContainerIDsAndConfigurationsUnchanged','environmentBytesUnchanged','headMatchesReviewedTarget','preexistingFourDirtyExactlyUnchanged')))
    facts=diagnosis['sealedRegistryFacts'];need(facts.get('stdoutBytes')==0 and facts.get('stdoutSHA256')==sha(b'')and facts.get('stderrBytes')==164 and facts.get('stderrSHA256')=='350f9e280154810df10555f08a28ad27ccf2bd32b8b21753a82c322877ba4ad7'and facts.get('jsonParsed')is False and facts.get('reviewedDescriptorParserAccepted')is False and facts.get('returnCodeWasNotPersistedByOriginalCapture')is True and facts.get('rawLogValuesOrMessagesPrinted')is False)
    errors=facts['fixedErrorIndicators'];need(errors.get('networkOrDNSFailure')is True and all(errors.get(name)is False for name in('buildxPluginUnavailable','tagOrManifestNotFound','registryAuthenticationRejected','registryRateLimited','tlsVerificationFailure','unsupportedOrInvalidRegistryResponse')))
    return {'previousRecoverySealedEvidence':previous,'fourthFailureAndReadOnlyRegistryDiagnosisSealsValidated':True,'directRegistryNetworkFailureClassifiedWithoutClaimingOriginalExitCode':True,'noLiveRegistryPreResolutionRetryInRecovery05':True}


def build_log_base_evidence(content):
    need(type(content)is bytes)
    pattern=rb'(?:FROM |resolve )(?:docker\.io/library/)?python:3\.12\.13-slim@(sha256:[a-f0-9]{64})(?=[\s\x1b]|$)'
    digests=sorted(set(match.decode()for match in re.findall(pattern,content)))
    return {'status':'capturedFromBuildLog'if len(digests)==1 else'notCaptured','resolvedBaseDigest':digests[0]if len(digests)==1 else None,'matchingDistinctDigestCount':len(digests),'buildLogSHA256':sha(content),'preBuildManifestDigestPinned':False,'reportedDigestIsNotAnAdditionalAcceptanceGuard':True}


def optional_build_log_evidence(path):
    try:result=build_log_base_evidence(CORE.stable_environment_bytes(path));result['buildLogReadStatus']='read';return result
    except (OSError,RuntimeError):return {'status':'notCaptured','resolvedBaseDigest':None,'matchingDistinctDigestCount':None,'buildLogSHA256':None,'preBuildManifestDigestPinned':False,'reportedDigestIsNotAnAdditionalAcceptanceGuard':True,'buildLogReadStatus':'unavailable'}


def prepare_zuru_build_recipe(before,files):
    global STAGE
    STAGE='zuru-verify-compose-version-and-Git-recipe'
    need(CORE.run(['docker','compose','version','--short']).decode().strip()=='5.1.0')
    name=CORE.ZURU+'/Dockerfile';original=CORE.run(['git','show',TARGET+':'+name]);need(files[name]==ZURU_GIT_RECIPE_SHA and CORE.stable_environment_bytes(ROOT/name)==original)
    oldimage=json.loads((BACKUP/'zuru-order-system-image.private.json').read_bytes());need(oldimage['Id']==before['runtime']['targets']['zuru-order-system']['image']and oldimage.get('Architecture')=='amd64'and oldimage.get('Os')=='linux')
    actual,literal=before_maps('zuru-order-system',before);oldenv=CORE.envmap(oldimage['Config'].get('Env')or[]);need(actual['PYTHON_VERSION']==oldenv['PYTHON_VERSION']=='3.12.13'and actual['PYTHON_SHA256']==oldenv['PYTHON_SHA256']and not{'PYTHON_VERSION','PYTHON_SHA256'}&set(literal))
    STAGE='zuru-derive-exact-version-only-build-recipe';recipe=exact_zuru_recipe(original)
    CORE.OPS.L.private_write(OUT/'zuru-git-Dockerfile.private',original);CORE.OPS.L.private_write(OUT/'zuru-actual-Dockerfile.private',recipe)
    delta=''.join(difflib.unified_diff(original.decode().splitlines(True),recipe.decode().splitlines(True),fromfile='Git-Dockerfile',tofile='Actual-build-only-Dockerfile'))
    CORE.OPS.L.private_write(OUT/'zuru-exact-FROM-diff.private',delta.encode())
    STAGE='zuru-capture-original-full-compose-configuration'
    base=json.loads(private_capture([*COMPOSE,'config','--format','json'],'zuru-original-compose-config',90));build=base['services']['zuru-order-system']['build'];need(type(build)is dict and build.get('context')==str(ROOT/CORE.ZURU)and build.get('dockerfile')=='Dockerfile'and'dockerfile_inline'not in build)
    replacement=copy.deepcopy(build);del replacement['dockerfile'];replacement['dockerfile_inline']=recipe.decode()
    encoded=copy.deepcopy(replacement);encoded['dockerfile_inline']=encoded['dockerfile_inline'].replace('$','$$')
    STAGE='zuru-write-private-build-only-overlay'
    overlay=OUT/'zuru-build-only-compose.private.yml';CORE.OPS.L.private_write(overlay,('services:\n  zuru-order-system:\n    build: !override '+json.dumps(encoded,ensure_ascii=True,separators=(',',':'))+'\n').encode())
    STAGE='zuru-validate-exact-compose-build-only-difference'
    build_compose=[*COMPOSE,'-f',str(overlay)];observed=json.loads(private_capture([*build_compose,'config','--format','json'],'zuru-build-only-compose-config',90));expected=copy.deepcopy(base);expected['services']['zuru-order-system']['build']=replacement;need(observed==expected)
    proof={'gitRecipeSHA256':sha(original),'actualRecipeSHA256':sha(recipe),'actualRecipeEqualsGitRecipe':False,'onlyFirstFROMLineChanged':True,'oldPythonRuntimeVersionPreserved':'3.12.13','baseImageReference':'python:3.12.13-slim','preBuildManifestDigestPinned':False,'liveRegistryPreResolutionPerformed':False,'onlyZuruBuildDescriptionChangedInFullComposeJSON':True,'runtimeSwitchUsesOriginalBaseComposeOnly':True,'hostGitDockerfileComposeAndEnvironmentUnmodified':True}
    CORE.OPS.L.private_write(OUT/'zuru-build-recipe-proof.private.json',enc(proof))
    return build_compose,proof

def deploy(result,before,files):
 global STAGE
 STAGE='initial-reviewed-source-old-runtime-and-maintenance';current,raw=CORE.runtime();need(current==before['runtime']and CORE.maintenance_inventory()==before['maintenanceInventory']);checked_source(TARGET,before,files,True)
 for service in ORDER:maintenance('require_maintenance_cleared',service)
 STAGE='sealed-recovery05-evidence';result.update(recovery05_evidence(before));STAGE='old-factory-process-and-seven-sealed-user-identities-before-build';result['prebuildIdentityEvidence']=prebuild_identity_evidence(before,raw);STAGE='fetch-exact-main-without-checkout';CORE.run(['git','-c','core.hooksPath=/dev/null','fetch','origin','main']);need(CORE.run(['git','rev-parse','FETCH_HEAD']).decode().strip()==TARGET);checked_source(TARGET,before,files,True);result.update(sourceAlreadyAtReviewedTargetNoCheckoutOrModeRepair=True);result.update(compose_preflight(before,True));STAGE='prepare-private-zuru-build-only-version-pinned-python-recipe';zuru_build_compose,recipe_proof=prepare_zuru_build_recipe(before,files);result['zuruBuildRecipeProof']=recipe_proof;built={};result['candidateConfigurationChecks']={};result['reusedSealedImages']={}
 # Reuse the three exact sealed good images. The four required builds
 # all finish before the first target enters maintenance.
 for service in ORDER:
  STAGE=service+'-pre-build-image-binding';need(CORE.runtime()[0]==current);tag=raw[service]['Config']['Image'];need(tag.removesuffix(':latest')=='rr-portal-'+service);old=json.loads(CORE.run(['docker','image','inspect',tag]));need(len(old)==1)
  if service in REUSED_IMAGES:
   need(old[0]['Id']==REUSED_IMAGES[service]);STAGE=service+'-reuse-sealed-built-image';candidate=old;checked_source(TARGET,before,files,True)
   if service in{'factory-review','factory-review-test'}:need((candidate[0]['Config'].get('Labels')or{}).get('org.opencontainers.image.revision')==TARGET)
   result['reusedSealedImages'][service]=REUSED_IMAGES[service]
  else:
   need(old[0]['Id']==(REJECTED_ZURU_IMAGE if service=='zuru-order-system'else current['targets'][service]['image']));STAGE=service+'-build-only-target-image';operation([*(zuru_build_compose if service=='zuru-order-system'else COMPOSE),'build',service],1800);build_log=OUT/('%04d-%s.private.log'%(CORE.COUNTER,STAGE));candidate=json.loads(CORE.run(['docker','image','inspect',tag]))
   if service=='zuru-order-system':
    need(len(candidate)==1 and candidate[0]['Id']!=REJECTED_ZURU_IMAGE and candidate[0].get('Architecture')=='amd64'and candidate[0].get('Os')=='linux');result['zuruBuildRecipeProof']['actualBaseResolutionEvidence']=optional_build_log_evidence(build_log)
  STAGE=service+'-candidate-config-validation';need(len(candidate)==1 and re.fullmatch('sha256:[a-f0-9]{64}',candidate[0]['Id'])and candidate[0]['Id']!=current['targets'][service]['image']);result['candidateConfigurationChecks'][service]=candidate_config_compatible(service,candidate[0],raw[service],before);built[service]=candidate[0]['Id'];checked_source(TARGET,before,files,True)
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
