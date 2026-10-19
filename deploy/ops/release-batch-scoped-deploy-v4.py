"""Restore six remaining services; preserve the already recovered QC container."""
import hashlib,importlib.util,json,os,pathlib,re,signal,stat,subprocess,sys,time
ROOT=pathlib.Path('/opt/rr-portal')
BASE='52c090589d6da542fee74ef17c8edd3b0dfe4fe6'
TARGET='85d2082c273d3df3e51b2e414855634c56c498dd'
EXPECTED_TREE='80c360271e705296a4c26ef12c17fb8c5fe4763d'
DEPLOY_PIN_FROZEN=True
BRANCH='refs/heads/ops/release-937-943-944-945-946-950-20261019'
BACKUP=ROOT/'deploy/backups/release-937-943-944-945-946-950-20261019-v2'
BACKUP_MANIFEST='22483bb8f1a2e799ad6bcd14f48c2b60c2913d74ad9a03207c39c8b6f761f93f'
BACKUP_RESULT='16dd085003188dbc56150bac9dfedcd3cd5ae9207732f1b96ed357c5a097458f'
OPS_LIBRARY='ff9138a1d5bfed1b10077112da6ebcda2d65240f583e2d0e12ce1325cfbaafd5'
DIRECTORY=ROOT/'deploy/backups/release-937-943-944-945-946-950-deploy-20261019-v4'
SERVICES=('indo-shipping','internal-quote','factory-review','factory-review-test','qc-report','qc-report-worker')
PROTECTED_PATHS=('apps/船务部','apps/工程部/3D打印协同平台','docker-compose.cloud.yml','deploy','nginx','scripts','frontend','.github/workflows/deploy.yml')
COMPOSE=['docker','compose','-p','rr-portal','-f',str(ROOT/'docker-compose.cloud.yml'),'--env-file',str(ROOT/'.env.cloud.production')]
OPS=None
STAGE='preflight';SERVICE=None;LOG_INDEX=0
ENV=None
DIRTY=None
BUILD_ROOTS=('apps/生产部/品质管理系统','apps/印尼小组/印尼走货明细','apps/业务部/内部报价系统','apps/PMC跟仓管/加工厂月度评审管理制度','apps/QA部/QC成品报告系统')
PRIOR=ROOT/'deploy/backups/release-937-943-944-945-946-950-deploy-20261019-v2'
PRIOR_MANIFEST='c82b715b9265d9307417285e736f53388e49efe4ac3ddba407d32e35da8ca185'
PRIOR_RESULT='664a41adf00c1e65aa2cfde91bbc337655d565aee01262c3321437904d7c0be8'
BAD_QC_ID='17b49cc6d19a82b5b455d165afec3c736af22a4a91451fd24604e87ef24c4acf'
BAD_QC_IMAGE='sha256:2e8b0f4f2abbf56e1715ae35a8e4af9839de3a7a26bb117a22ef8ea0a2e7f69b'
ENVIRONMENT_PROOF_SHA='9ba097453d46298d6e16e8a3ea5051f08dbe1e3cf39711ef4c8f75bc4f257480'
QC_CLEAR=ROOT/'deploy/backups/release-qc-only-flag-clear-20261019'
QC_RESULT_SHA='40ad89764df1895d28f87c8b61c8c4daabc97efae37941aaab9a74a7dedb240a'
RECOVERED_QC_ID='4bcd0a072a2250afc9b92547d2849c9414ca7185eef8c09db50e4fe89426b28c'
RECOVERED_QC_IMAGE='sha256:919dffaa4d9bc9df57f52bb27f118c6d4feba6da1c8fcdef1e7dc2a86c366b08'
QC_FROZEN=None
ENVIRONMENT_PROOF=None

def need(value):
 if not value:raise RuntimeError('SCOPED_RELEASE_REJECTED')
def encoded(v):return json.dumps(v,ensure_ascii=True,sort_keys=True,separators=(',',':')).encode()
def emit(ok):print(json.dumps({'stage':STAGE,'service':SERVICE,'success':ok}),flush=True)
def load_ops():
 path=pathlib.Path(__file__).with_name('release-data-ops-library.py')
 need(path.is_file() and not path.is_symlink() and hashlib.sha256(path.read_bytes()).hexdigest()==OPS_LIBRARY)
 spec=importlib.util.spec_from_file_location('scoped_release_readonly',path);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
 m.L=m.load_library(pathlib.Path(__file__).with_name('release-data-library.py'));m.BACKUP_MANIFEST_SHA256=BACKUP_MANIFEST
 return m

def load_environment_proof():
 path=pathlib.Path(__file__).with_name('release-environment-proof.py')
 need(path.is_file()and not path.is_symlink()and hashlib.sha256(path.read_bytes()).hexdigest()==ENVIRONMENT_PROOF_SHA)
 spec=importlib.util.spec_from_file_location('reviewed_exact_environment_map',path);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m

def command(args,data=None,timeout=180):
 global LOG_INDEX
 LOG_INDEX+=1;path=DIRECTORY/('%03d-%s-%s.log'%(LOG_INDEX,SERVICE or 'release',STAGE))
 with path.open('xb') as errors:
  p=subprocess.run(args,input=data,stdout=subprocess.PIPE,stderr=errors,timeout=timeout,cwd=ROOT,env=ENV)
 out=path.with_suffix('.stdout.private');OPS.L.private_write(out,p.stdout)
 need(p.returncode==0 and len(p.stdout)<=32*1024**2)
 return p.stdout

def operation(args,timeout):
 global LOG_INDEX
 LOG_INDEX+=1;path=DIRECTORY/('%03d-%s-%s.log'%(LOG_INDEX,SERVICE or 'release',STAGE))
 with path.open('xb') as output:
  p=subprocess.run(args,stdout=output,stderr=subprocess.STDOUT,timeout=timeout,cwd=ROOT,env=ENV)
 need(p.returncode==0)

def maintenance(function,service):
 need(service in SERVICES and function in {'maintenance_on','wait_service_ready','maintenance_off','require_maintenance_cleared'})
 operation(['bash','-c','set -euo pipefail; source "$1"; "$2" "$3"','scoped-maintenance',str(ROOT/'deploy/service-maintenance.sh'),function,service],340)

def flags():
 tree=ROOT/'deploy/maintenance';result={}
 need(tree.is_dir() and not tree.is_symlink())
 for p in tree.rglob('*'):
  need(not p.is_symlink() and (p.is_file() or p.is_dir()))
  if p.is_file():result[str(p.relative_to(tree))]=OPS.L.file_hash(p)
 need(len(result)<=1000)
 own={'services/'+('qc-report' if s=='qc-report-worker' else s) for s in SERVICES}
 return {p:h for p,h in result.items() if p not in own}

def dirty_paths():
 command(['git','diff','--cached','--quiet','--no-ext-diff','--no-textconv','--ignore-submodules=none'])
 raw=command(['git','diff','--name-only','--no-ext-diff','--no-textconv','--ignore-submodules=none','-z'])
 names=[n for n in raw.decode().split('\0')if n];need(len(names)==4 and len(set(names))==4)
 return sorted(names)

def dirty_state(changed,save=False):
 rows={};names=dirty_paths();need(not set(names)&set(changed))
 forbidden=BUILD_ROOTS+('apps/船务部','apps/工程部/3D打印协同平台')
 for index,name in enumerate(names):
  need(OPS.L.safe_path(name) and not any(name==p or name.startswith(p+'/')for p in forbidden))
  entry=command(['git','ls-tree','-z',BASE,'--',name]);parts=entry.split(b'\t',1)
  need(len(parts)==2 and parts[1]==name.encode()+b'\0' and re.fullmatch(b'100(?:644|755) blob [a-f0-9]{40}',parts[0])is not None)
  path=ROOT/name
  for ancestor in (path,*path.parents):
   if ancestor==ROOT:break
   need(not ancestor.is_symlink())
  if not path.exists():rows[name]={'kind':'absent'};continue
  with os.fdopen(os.open(path,os.O_RDONLY|os.O_NOFOLLOW),'rb')as stream:
   before=os.fstat(stream.fileno());need(stat.S_ISREG(before.st_mode) and before.st_size<=8*1024**2)
   content=stream.read(8*1024**2+1);after=os.fstat(stream.fileno());need((before.st_dev,before.st_ino,before.st_size,before.st_mtime_ns,before.st_ctime_ns,before.st_mode)==(after.st_dev,after.st_ino,after.st_size,after.st_mtime_ns,after.st_ctime_ns,after.st_mode))
  need(path.lstat()==after)
  need(len(content)==before.st_size);rows[name]={'kind':'regular','bytes':len(content),'mode':stat.S_IMODE(before.st_mode),'sha256':hashlib.sha256(content).hexdigest()}
  if save:OPS.L.private_write(DIRECTORY/('dirty-%02d.private'%index),content)
 need(sum(r.get('bytes',0)for r in rows.values())<=16*1024**2)
 return rows

def fixed_inputs():
 for name in ('docker-compose.cloud.yml','deploy/service-maintenance.sh'):
  path=ROOT/name;expected=command(['git','show',BASE+':'+name]);need(path.is_file() and not path.is_symlink() and path.stat().st_size==len(expected) and path.read_bytes()==expected)
 need(OPS.L.file_hash(ROOT/'.env.cloud.production')==BASELINE['envSHA256'])

def source_unchanged():
 need(command(['git','rev-parse','HEAD']).decode().strip()==TARGET)
 need(dirty_state(())==DIRTY);fixed_inputs()

def prior_failure():
 need(PRIOR.is_dir() and not PRIOR.is_symlink() and stat.S_IMODE(PRIOR.stat().st_mode)==0o700)
 need(OPS.L.file_hash(PRIOR/'manifest.json')==PRIOR_MANIFEST and OPS.L.file_hash(PRIOR/'first-result.json')==PRIOR_RESULT)
 entries=list(PRIOR.rglob('*'));need(len(entries)<=2000 and all(not p.is_symlink() and (p.is_file()or p.is_dir()) and p.stat().st_mode&0o077==0 for p in entries))
 manifest=json.loads((PRIOR/'manifest.json').read_bytes());need(set(manifest)=={str(p.relative_to(PRIOR))for p in entries if p.is_file()and p!=PRIOR/'manifest.json'})
 need(sum(p.stat().st_size for p in entries if p.is_file())<=128*1024**2 and all(OPS.L.safe_path(n)and re.fullmatch('[a-f0-9]{64}',h)and OPS.L.file_hash(PRIOR/n)==h for n,h in manifest.items()))
 receipt=json.loads((PRIOR/'first-result.json').read_bytes());need(receipt.get('success')is False and receipt.get('target')==TARGET and receipt.get('failedStage')=='wait-healthy' and receipt.get('failedService')=='qc' and receipt.get('services')==[])
 preserved=json.loads((PRIOR/'preserved-tracked-files.private.json').read_bytes());need(type(preserved)is dict and len(preserved)==4)
 for index,name in enumerate(sorted(preserved)):
  row=preserved[name]
  if row.get('kind')=='regular':need(OPS.L.file_hash(PRIOR/('dirty-%02d.private'%index))==row['sha256'])
 return preserved

def qc_clear_receipt():
 need(QC_CLEAR.is_dir()and not QC_CLEAR.is_symlink()and stat.S_IMODE(QC_CLEAR.stat().st_mode)==0o700)
 need({p.name for p in QC_CLEAR.iterdir()}=={'first-result.json','manifest.json'}and all(p.is_file()and not p.is_symlink()and p.stat().st_mode&0o077==0 for p in QC_CLEAR.iterdir()))
 need(OPS.L.file_hash(QC_CLEAR/'first-result.json')==QC_RESULT_SHA)
 need((QC_CLEAR/'manifest.json').read_bytes()==encoded({'first-result.json':QC_RESULT_SHA}))
 receipt=json.loads((QC_CLEAR/'first-result.json').read_bytes())
 need(all(receipt.get(k)is True for k in ('success','onlyQcFlagRemoved','environmentMapsExactlyBaseline','qcHealthy','maintenanceCleared','otherContainersUnchanged','envFileUnchanged','fourTrackedChangesPreserved')))
 need(receipt.get('businessCrudPerformed')is False and receipt.get('containersChanged')is False and re.fullmatch('[a-f0-9]{64}',receipt.get('newQcContainer',''))and re.fullmatch('sha256:[a-f0-9]{64}',receipt.get('newQcImage','')))
 need(receipt['newQcContainer']==RECOVERED_QC_ID and receipt['newQcImage']==RECOVERED_QC_IMAGE)
 return receipt

def environment_evidence(baseline,current):
 proof=ENVIRONMENT_PROOF.prove(baseline,current,command);need(all(v['passed']is True for v in proof.values()));return proof

def recovery_runtime(baseline,current,qc):
 need(OPS.runtime_checks(baseline,current)['protectedAndUnrelatedContainersIdentical'])
 need(all(current['services'][s]==baseline['services'][s]for s in SERVICES))
 row=current['services']['qc'];old=baseline['services']['qc']
 need(row['id']==qc['newQcContainer']and row['image']==qc['newQcImage']and row['oom']is False and row['running']is True and row['health']=='healthy'and row['restarts']==0)
 need(all(row[k]==old[k]for k in ('mounts','memory','swap','healthcheck')))

def tree_entry(revision,name):
 raw=command(['git','ls-tree','-z',revision,'--',name])
 if not raw:return None
 parts=raw.split(b'\t',1);need(len(parts)==2 and parts[1]==name.encode()+b'\0')
 mode,kind,oid=parts[0].decode().split();return mode,kind,oid

def repair_source_modes(changed):
 plan=[];parents=set();need(len(changed)==57 and len(set(changed))==57)
 for name in sorted(changed):
  need(OPS.L.safe_path(name) and name not in DIRTY and not pathlib.PurePosixPath(name).name.startswith('.env') and not {'data','uploads','storage'}&{p.lower()for p in pathlib.PurePosixPath(name).parts})
  entry=tree_entry(TARGET,name);need(entry and entry[0]in {'100644','100755'}and entry[1]=='blob')
  path=ROOT/name
  for ancestor in (path,*path.parents):
   if ancestor==ROOT:break
   need(not ancestor.is_symlink())
  expected=command(['git','show',TARGET+':'+name]);before=path.stat();desired=0o755 if entry[0]=='100755'else 0o644
  need(stat.S_ISREG(before.st_mode) and before.st_size==len(expected) and stat.S_IMODE(before.st_mode)in {desired,desired&0o700})
  need(OPS.L.file_hash(path)==hashlib.sha256(expected).hexdigest());plan.append({'path':name,'directory':False,'before':stat.S_IMODE(before.st_mode),'after':desired,'sha256':hashlib.sha256(expected).hexdigest(),'dev':before.st_dev,'ino':before.st_ino})
  parents.update(str(p)for p in pathlib.PurePosixPath(name).parents if str(p)!='.')
 for name in sorted(parents,key=lambda n:(n.count('/'),n)):
  if tree_entry(BASE,name)is not None:continue
  entry=tree_entry(TARGET,name);need(entry and entry[0]=='040000'and entry[1]=='tree')
  need(not {'data','uploads','storage'}&{p.lower()for p in pathlib.PurePosixPath(name).parts})
  path=ROOT/name;need(path.is_dir()and not path.is_symlink()and stat.S_IMODE(path.stat().st_mode)in {0o700,0o755})
  before=path.stat();plan.append({'path':name,'directory':True,'before':stat.S_IMODE(before.st_mode),'after':0o755,'dev':before.st_dev,'ino':before.st_ino})
 OPS.L.private_write(DIRECTORY/'source-mode-plan.private.json',encoded(plan))
 try:
  for row in plan:
   path=ROOT/row['path'];fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
   try:
    before=os.fstat(fd);need((before.st_dev,before.st_ino)==(row['dev'],row['ino'])and stat.S_IMODE(before.st_mode)==row['before'])
    need(stat.S_ISDIR(before.st_mode)if row['directory']else stat.S_ISREG(before.st_mode)and OPS.L.file_hash(path)==row['sha256'])
    if row['before']!=row['after']:os.fchmod(fd,row['after'])
    need(stat.S_IMODE(os.fstat(fd).st_mode)==row['after'])
   finally:os.close(fd)
 finally:OPS.L.private_write(DIRECTORY/'source-mode-observed.private.json',encoded([dict(row,observed=stat.S_IMODE((ROOT/row['path']).lstat().st_mode))for row in plan]))
 need(all(row['directory']or OPS.L.file_hash(ROOT/row['path'])==row['sha256']for row in plan))

def deployment(baseline,result):
 global STAGE,SERVICE,DIRTY,QC_FROZEN
 STAGE='validate-backup';need(OPS.L.file_hash(BACKUP/'first-result.json')==BACKUP_RESULT)
 STAGE='validate-prior-seal';preserved=prior_failure()
 STAGE='validate-qc-clear-receipt';qc=qc_clear_receipt()
 need(not (ROOT/'deploy/maintenance/services/qc').exists()and not (ROOT/'deploy/maintenance/services/qc').is_symlink())
 STAGE='validate-six-baseline-and-qc';before=OPS.runtime();recovery_runtime(baseline['runtime'],before,qc);QC_FROZEN=before['services']['qc']
 STAGE='validate-environment-maps';result['initialEnvironmentEvidence']=environment_evidence(baseline['runtime'],before)
 OPS.L.private_write(DIRECTORY/'qc-preserved-runtime.private.json',encoded(QC_FROZEN))
 STAGE='source-current-branch';need(command(['git','symbolic-ref','--quiet','HEAD']).decode().strip()=='refs/heads/main')
 STAGE='source-current-head'
 need(command(['git','rev-parse','HEAD']).decode().strip()==TARGET)
 STAGE='source-root-tree'
 command(['git','merge-base','--is-ancestor',BASE,TARGET])
 need(command(['git','rev-parse',TARGET+'^{tree}']).decode().strip()==EXPECTED_TREE)
 command(['git','diff','--quiet',BASE,TARGET,'--',*PROTECTED_PATHS])
 STAGE='source-fixed-inputs';fixed_inputs()
 changed=command(['git','diff','--name-only','--no-ext-diff','--no-textconv','-z',BASE,TARGET]).decode().split('\0');changed=[p for p in changed if p];need(len(changed)==57 and len(set(changed))==57)
 STAGE='source-dirty-snapshot';DIRTY=dirty_state(changed,True);need(DIRTY==preserved);OPS.L.private_write(DIRECTORY/'preserved-tracked-files.private.json',encoded(DIRTY))
 flag_dir=ROOT/'deploy/maintenance/services'
 need(flag_dir.is_dir() and not flag_dir.is_symlink() and stat.S_IMODE(flag_dir.stat().st_mode)&0o001)
 old_flags=flags()
 STAGE='repair-source-modes';repair_source_modes(changed);source_unchanged()
 result['services']=[]
 for SERVICE in SERVICES:
  STAGE='before-build';source_unchanged();current=OPS.runtime()
  need(current['services']['qc']==QC_FROZEN)
  need(current['services'][SERVICE]['id']==before['services'][SERVICE]['id'])
  raw=json.loads(command(['docker','inspect',current['services'][SERVICE]['id']]))[0]
  tag=raw['Config']['Image'];need(tag.removesuffix(':latest')=='rr-portal-'+SERVICE)
  image=json.loads(command(['docker','image','inspect',tag]))[0];need(image['Id']==current['services'][SERVICE]['image'])
  STAGE='build';emit(None)
  operation([*COMPOSE,'build',SERVICE],1800)
  built=json.loads(command(['docker','image','inspect',tag]))[0]
  need(re.fullmatch('sha256:[a-f0-9]{64}',built['Id']) is not None and built['Id']!=current['services'][SERVICE]['image'])
  if SERVICE in {'factory-review','factory-review-test'}:need(built['Config'].get('Labels',{}).get('org.opencontainers.image.revision')==TARGET)
  source_unchanged();STAGE='switch';maintenance('maintenance_on',SERVICE);switched=time.monotonic()
  operation([*COMPOSE,'up','-d','--no-build','--no-deps',SERVICE],180)
  STAGE='wait-healthy';maintenance('wait_service_ready',SERVICE)
  current=OPS.runtime();row=current['services'][SERVICE]
  need(current['services']['qc']==QC_FROZEN)
  need(row['image']==built['Id'] and row['id']!=before['services'][SERVICE]['id'] and row['running'] is True and row['health']=='healthy' and row['oom'] is False and row['restarts']==0)
  STAGE='verify-environment-maps';environment_evidence(baseline['runtime'],current)
  need(all(row[k]==baseline['runtime']['services'][SERVICE][k]for k in ('mounts','memory','swap','healthcheck')))
  time.sleep(max(0,10-(time.monotonic()-switched)))
  # The web and worker share one route flag; clear it after both replacements.
  if SERVICE!='qc-report':maintenance('maintenance_off',SERVICE);maintenance('require_maintenance_cleared',SERVICE)
  need(OPS.runtime_checks(before,current)['protectedAndUnrelatedContainersIdentical'])
  need(flags()==old_flags)
  result['services'].append({'service':SERVICE,'healthy':True,'image':row['image'],'containerId':row['id']});emit(True)
 STAGE='final-guards';source_unchanged()
 for SERVICE in SERVICES:maintenance('require_maintenance_cleared',SERVICE)
 SERVICE=None;after=OPS.runtime();need(after['services']['qc']==QC_FROZEN)
 need(all(after['services'][s]['restarts']==0 for s in (*SERVICES,'qc')))
 raw_checks=OPS.runtime_checks(baseline['runtime'],after);result['rawOrderedArrayRuntimeChecks']=raw_checks
 result['finalEnvironmentEvidence']=environment_evidence(baseline['runtime'],after)
 need(raw_checks['protectedAndUnrelatedContainersIdentical']and raw_checks['targetsHealthyWithoutOOM']and all(all(baseline['runtime']['services'][s][k]==after['services'][s][k]for k in ('mounts','memory','swap','healthcheck'))for s in (*SERVICES,'qc')))
 need(flags()==old_flags);OPS.original_archive();need(prior_failure()==preserved and qc_clear_receipt()==qc)
 result['runtimeBefore']=before;result['runtimeAfter']=after;result['allSevenHealthy']=True;result['onlySixContainersRebuilt']=True;result['qcContainerPreserved']=True;result['nonTargetContainersUnchanged']=True;result['fourPreexistingTrackedChangesPreserved']=True;result['exactEnvironmentMapsVerifiedWithoutChangingRawArrayEvidence']=True

def main():
 global OPS,ENV,BASELINE,STAGE,SERVICE,ENVIRONMENT_PROOF
 os.umask(0o077)
 need(DEPLOY_PIN_FROZEN and re.fullmatch('[a-f0-9]{40}',TARGET or '') is not None and all(re.fullmatch('[a-f0-9]{64}',h)for h in (PRIOR_MANIFEST,PRIOR_RESULT,QC_RESULT_SHA)))
 need(os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_ATTEMPT')=='1')
 OPS=load_ops();ENVIRONMENT_PROOF=load_environment_proof();DIRECTORY.mkdir(mode=0o700)
 ENV=dict(os.environ,COMPOSE_BAKE='false',COMPOSE_PARALLEL_LIMIT='1',COMPOSE_PROJECT_NAME='rr-portal',AFTER_COMMIT=TARGET,
  MAINT_FLAG_DIR=str(ROOT/'deploy/maintenance'),COMPOSE_FILE=str(ROOT/'docker-compose.cloud.yml'),ENV_FILE=str(ROOT/'.env.cloud.production'),
  MAINT_COMPOSE_SERVICES='\n'.join(SERVICES),MAINT_HEALTH_TIMEOUT_SECONDS='300',MAINT_DNS_GRACE_SECONDS='10')
 OPS.run=command
 result={'success':False,'globalHooksRun':False,'globalMaintenanceChanged':False,'envFileModified':False,'automaticRollback':False,'businessCrudPerformed':False,'target':TARGET,'expectedTree':EXPECTED_TREE}
 def stop(*_):need(False)
 signal.signal(signal.SIGTERM,stop)
 try:
  BASELINE=OPS.original_archive();deployment(BASELINE,result);result['success']=True
 except BaseException:
  result['failedStage']=STAGE;result['failedService']=SERVICE
 finally:
  OPS.L.private_write(DIRECTORY/'first-result.json',encoded(result));OPS.L.seal(DIRECTORY);emit(result['success'])
 return 0 if result['success'] else 1
if __name__=='__main__':
 try:sys.exit(main())
 except Exception:print('{"stage":"preflight","service":null,"success":false}',flush=True);sys.exit(1)
