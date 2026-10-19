"""One fixed release, seven serial services. Draft: no global deployment hooks."""
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
DIRECTORY=ROOT/'deploy/backups/release-937-943-944-945-946-950-deploy-20261019'
SERVICES=('qc','indo-shipping','internal-quote','factory-review','factory-review-test','qc-report','qc-report-worker')
PROTECTED_PATHS=('apps/船务部','apps/工程部/3D打印协同平台','docker-compose.cloud.yml','deploy','nginx','scripts','frontend','.github/workflows/deploy.yml')
COMPOSE=['docker','compose','-p','rr-portal','-f',str(ROOT/'docker-compose.cloud.yml'),'--env-file',str(ROOT/'.env.cloud.production')]
OPS=None
STAGE='preflight';SERVICE=None;LOG_INDEX=0
ENV=None

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

def source_unchanged():
 need(command(['git','rev-parse','HEAD']).decode().strip()==TARGET)
 command(['git','diff','--quiet']);command(['git','diff','--cached','--quiet'])
 need(OPS.L.file_hash(ROOT/'.env.cloud.production')==BASELINE['envSHA256'])

def deployment(baseline,result):
 global STAGE,SERVICE
 STAGE='validate-backup';need(OPS.L.file_hash(BACKUP/'first-result.json')==BACKUP_RESULT)
 before=OPS.runtime();need(before==baseline['runtime'])
 STAGE='validate-source';need(command(['git','symbolic-ref','--quiet','HEAD']).decode().strip()=='refs/heads/main')
 need(command(['git','rev-parse','HEAD']).decode().strip()==BASE)
 command(['git','diff','--quiet']);command(['git','diff','--cached','--quiet'])
 command(['git','-c','core.hooksPath=/dev/null','fetch','origin','main'],timeout=60)
 need(command(['git','rev-parse','FETCH_HEAD']).decode().strip()==TARGET)
 command(['git','merge-base','--is-ancestor',BASE,TARGET])
 need(command(['git','rev-parse',TARGET+'^{tree}']).decode().strip()==EXPECTED_TREE)
 command(['git','diff','--quiet',BASE,TARGET,'--',*PROTECTED_PATHS])
 need(OPS.L.file_hash(ROOT/'.env.cloud.production')==baseline['envSHA256'])
 expected=command(['git','show',BASE+':deploy/service-maintenance.sh'])
 need((ROOT/'deploy/service-maintenance.sh').read_bytes()==expected)
 flag_dir=ROOT/'deploy/maintenance/services'
 need(flag_dir.is_dir() and not flag_dir.is_symlink() and stat.S_IMODE(flag_dir.stat().st_mode)&0o001)
 old_flags=flags()
 STAGE='fast-forward-main';operation(['git','-c','core.hooksPath=/dev/null','merge','--ff-only',TARGET],60);source_unchanged()
 result['services']=[]
 for SERVICE in SERVICES:
  STAGE='before-build';source_unchanged();current=OPS.runtime()
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
  need(row['image']==built['Id'] and row['id']!=before['services'][SERVICE]['id'] and row['running'] is True and row['health']=='healthy' and row['oom'] is False and row['restarts']==0)
  time.sleep(max(0,10-(time.monotonic()-switched)))
  # The web and worker share one route flag; clear it after both replacements.
  if SERVICE!='qc-report':maintenance('maintenance_off',SERVICE);maintenance('require_maintenance_cleared',SERVICE)
  need(OPS.runtime_checks(before,current)['protectedAndUnrelatedContainersIdentical'])
  need(flags()==old_flags)
  result['services'].append({'service':SERVICE,'healthy':True,'image':row['image'],'containerId':row['id']});emit(True)
 STAGE='final-guards';source_unchanged()
 for SERVICE in SERVICES:maintenance('require_maintenance_cleared',SERVICE)
 SERVICE=None;after=OPS.runtime();need(all(OPS.runtime_checks(before,after).values()))
 need(flags()==old_flags);OPS.original_archive()
 result['runtimeBefore']=before;result['runtimeAfter']=after;result['allSevenHealthy']=True;result['nonTargetContainersUnchanged']=True

def main():
 global OPS,ENV,BASELINE,STAGE,SERVICE
 os.umask(0o077)
 need(DEPLOY_PIN_FROZEN and re.fullmatch('[a-f0-9]{40}',TARGET or '') is not None)
 need(os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_ATTEMPT')=='1')
 OPS=load_ops();DIRECTORY.mkdir(mode=0o700)
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
