"""PR977/978/979 read-only baseline. Five SQLite stores, Indo PostgreSQL and all attachments.
All original environment and business data stay unchanged. Gate off.
"""
import contextlib,copy,hashlib,importlib.util,json,os,pathlib,re,shutil,signal,stat,sys,traceback
ROOT=pathlib.Path('/opt/rr-portal');BASE='b4c3763fe43e30c80c041c70e7a9f0750145d7b0';BRANCH='refs/heads/ops/batch-977-978-979-20261021';BACKUP_PIN=False
OUT=ROOT/'deploy/backups/batch-977-978-979-20261021-backup';QC='apps/QA部/QC成品报告系统';FACTORY='apps/PMC跟仓管/加工厂月度评审管理制度';INDO='apps/印尼小组/印尼走货明细'
SERVICES=('factory-review','factory-review-test','qc-report','qc-report-worker','indo-shipping');STORAGE={'factory-review':FACTORY+'/pb_data','factory-review-test':FACTORY+'/pb_data_test','qc-report-data':QC+'/data','qc-report-storage':QC+'/storage'}
IMAGES={'qc-report':'sha256:e442f0c577df8fbad4410ab655e3d4cc32f23b4fd63c88988815845dc3504452','qc-report-worker':'sha256:8a7abe630e49db8051be8ccc5be26a70a0b6d610410d16d701b9681841cca047'}
FIXED=('docker-compose.cloud.yml','nginx/nginx.cloud.conf','deploy/update-server.sh','deploy/service-maintenance.sh','.github/workflows/deploy.yml',*(p+'/'+n for p in (QC,FACTORY,INDO)for n in ('Dockerfile','.dockerignore')))
DEPS={'factory-review-backup-library.py':'79d76bb47312dd08c121ebe2797f54d958666f8b72d00721f67712b152fc4666','portable-pdb-library.py':'cf66f655a1e166491c4da67da0824f42ac8cdae3f844044cb5d8f7233ba105c5','qc-source-library.py':'4745c90f126cf46106b0f170a3ebc6b24ccb64c0e963e427d13308d5cb5b54f5','release-data-ops-library.py':'ff9138a1d5bfed1b10077112da6ebcda2d65240f583e2d0e12ce1325cfbaafd5','release-data-library.py':'d63168fd3057f4f2aba2d93f9fab31d2d65c6dd0f3234877d71fcff1e04e62b9'}
STAGE='entry';FAILED_CHECK=None;Q=None;OPS=None;F=None;SERIAL=0
def need(value,label):
 global FAILED_CHECK
 if not value:FAILED_CHECK=label;raise RuntimeError('BATCH_977_979_BASELINE_REJECTED')
def enc(value):return json.dumps(value,sort_keys=True,ensure_ascii=True,separators=(',',':'),allow_nan=False).encode()
def sha(value):return hashlib.sha256(value).hexdigest()
def load(name):
 p=pathlib.Path(__file__).with_name(name);need(p.is_file()and not p.is_symlink()and sha(p.read_bytes())==DEPS[name],'dependency-pin');s=importlib.util.spec_from_file_location(name.replace('.','_'),p);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
def private(name,value):OPS.L.private_write(OUT/name,value if type(value)is bytes else enc(value))
def initialize():
 global Q,OPS,F
 OPS=load('release-data-ops-library.py');OPS.L=OPS.load_library(pathlib.Path(__file__).with_name('release-data-library.py'));Q=load('qc-source-library.py');F=load('factory-review-backup-library.py');Q.PDB=load('portable-pdb-library.py');OPS.SCHEMAS=('indo_shipping',);OPS.NEW_COLUMNS={};OPS.ROOT=ROOT
 for m in (Q,F):m.OUT=OUT;m.BASE=BASE;m.OPS=OPS
 F.run=Q.run;Q.APP_PREFIXES=(QC,FACTORY,INDO);Q.FIXED=FIXED;OPS.run=Q.run

def run(args,data=None,timeout=180):return Q.run(args,data,timeout)
def current(label,stopped=()):
 global SERIAL
 SERIAL+=1;prefix='%04d-%s'%(SERIAL,label);ids=run(['docker','ps','-aq','--no-trunc']).decode().split();need(0<len(ids)<=1000 and len(ids)==len(set(ids))and all(re.fullmatch('[a-f0-9]{64}',v)for v in ids),'container-id-inventory');records=json.loads(run(['docker','inspect',*ids]));private(prefix+'-raw-all.private.json',records);need(type(records)is list and len(records)==len(ids),'complete-raw-runtime');rows={};targets={};raw={}
 for r in records:
  cid=r['Id'];need(cid in ids and cid not in rows,'single-container');c=copy.deepcopy(r['Config']);c['Env']=sorted(c['Env']);s=r['State'];rows[cid]={'id':cid,'image':r['Image'],'started':s.get('StartedAt'),'running':s['Running'],'oom':s['OOMKilled'],'restarts':r['RestartCount'],'health':s.get('Health',{}).get('Status'),'configSHA256':sha(enc(c)),'hostConfigSHA256':sha(enc(r['HostConfig'])),'networkSettingsSHA256':sha(enc(r.get('NetworkSettings',{}))),'mounts':sorted(r.get('Mounts',[]),key=enc)};labels=c.get('Labels')or{};service=labels.get('com.docker.compose.service')if labels.get('com.docker.compose.project')=='rr-portal'else None
  if service in SERVICES:need(service not in targets,'single-qc-target');targets[service]=cid;raw[service]=r
 value={'all':rows,'targets':targets};private(prefix+'-canonical-before-assertions.private.json',value);need(set(targets)==set(SERVICES)and set(stopped)<=set(SERVICES),'both-only-qc-targets')
 for service,cid in targets.items():
  need(rows[cid]['oom']is False and(rows[cid]['running']is False if service in stopped else rows[cid]['running']is True and rows[cid]['health']=='healthy'),'target-expected-state')
  if service in stopped:rows[cid]['processEnvironmentSHA256']=None;continue
  blob=run(['docker','exec',cid,'cat','/proc/1/environ']);need(blob.endswith(b'\0'),'complete-live-pid1-environment');process=Q.envmap([v.decode()for v in blob.split(b'\0')if v]);need(process.pop('HOSTNAME',None)==cid[:12],'only-automatic-pid1-hostname');private(prefix+'-'+service+'-pid1.private.json',process);rows[cid]['processEnvironmentSHA256']=sha(enc(process))
 return value,raw
def roots(raw):
 need(sorted(raw['qc-report']['Mounts'],key=enc)==sorted(raw['qc-report-worker']['Mounts'],key=enc),'qc-shared-storage');result={};contracts={}
 for key,relative in STORAGE.items():
  service=key if key.startswith('factory-review')else 'qc-report';destination='/pb/pb_data'if service.startswith('factory-review')else '/app/'+('data'if key.endswith('-data')else 'storage');matches=[m for m in raw[service]['Mounts']if m.get('Destination')==destination];need(len(matches)==1,'one-fixed-mount');m=matches[0];path=ROOT/relative;need(m.get('Type')=='bind'and m.get('Source')==str(path)and m.get('RW')is True and path.is_dir()and all(not p.is_symlink()for p in(path,*path.parents)),'fixed-bind-storage');result[key]=path;contracts[key]=m
 need(all(len(raw[s]['Mounts'])==(1 if s.startswith('factory-review')else 2 if s.startswith('qc-report')else 0)for s in SERVICES),'only-declared-original-mounts');return result,contracts

def source():
 need(run(['git','symbolic-ref','--quiet','HEAD']).decode().strip()=='refs/heads/main'and run(['git','rev-parse','HEAD']).decode().strip()==BASE,'canonical-original-main');
 for prefix in (QC,FACTORY,INDO):run(['git','diff','--quiet','--no-ext-diff','--no-textconv','--ignore-submodules=none','--',prefix])
 result={}
 for name in FIXED:need((ROOT/name).is_file()and not(ROOT/name).is_symlink()and (ROOT/name).read_bytes()==run(['git','show',BASE+':'+name]),'canonical-fixed-source');result[name]=OPS.L.file_hash(ROOT/name)
 return result
def environments(raw):
 need(run(['docker','compose','version','--short']).decode().strip()=='5.1.0','compose-version');compose=json.loads(run(['docker','compose','-p','rr-portal','-f',str(ROOT/'docker-compose.cloud.yml'),'--env-file',str(ROOT/'.env.cloud.production'),'config','--format','json']));private('compose-render.private.json',compose);result={}
 for service,r in raw.items():
  actual=Q.envmap(r['Config']['Env']);blob=run(['docker','exec',r['Id'],'cat','/proc/1/environ']);need(blob.endswith(b'\0'),'complete-process-env');process=Q.envmap([v.decode()for v in blob.split(b'\0')if v]);need(process.pop('HOSTNAME',None)==r['Id'][:12],'automatic-process-hostname');images=json.loads(run(['docker','image','inspect',r['Image']]));need(len(images)==1 and images[0]['Id']==r['Image'],'immutable-original-image')
  for name,value in [('configured-image',images[0]),('literal-configured-environment',actual),('literal-process-environment',process),('declared-compose-environment',compose['services'][service]['environment'])]:private(service+'-'+name+'.private.json',value)
  if service.startswith('qc-report'):need(actual.get('DATABASE_URL')=='sqlite:////app/data/qc-report.db'and actual.get('STORAGE_ROOT')=='/app/storage'and actual.get('OPENAI_API_FORMAT')=='bailian_chat'and actual.get('OPENAI_MODEL')=='qwen3.8-max'and actual.get('OPENAI_BASE_URL')=='https://dashscope.aliyuncs.com/compatible-mode/v1','qc-existing-company-max-path')
  result[service]={'image':r['Image'],'ociRevision':(images[0]['Config'].get('Labels')or{}).get('org.opencontainers.image.revision'),'configuredSHA256':sha(enc(actual)),'processSHA256':sha(enc(process))}
 return result
def proofs(raw,environment):
 result={}
 for service,r in raw.items():
  if service.startswith('factory-review'):result[service]=F.runtime_files(service,{'id':r['Id'],'image':r['Image']});continue
  observed=environment[service]['ociRevision'];need(type(observed)is str and bool(re.fullmatch('[a-f0-9]{40}',observed)),'runtime-image-exact-source-label')
  prefix=INDO if service=='indo-shipping'else QC;need(run(['git','rev-parse',observed+':'+prefix])==run(['git','rev-parse',BASE+':'+prefix]),'runtime-full-app-tree-equals-base')
  if service=='indo-shipping':proof=Q.service_source_proof(service,{'id':r['Id']},revision=observed)
  else:
   need(r['Image']==IMAGES[service],'known-recovered-qc-image');files={'app.py','ai_service.py','bailian_adapter.py','pdf_service.py','task_queue.py','unified_pdf.py','worker.py','requirements.txt','alembic.ini'};dirs=('migrations/','templates/','static/','assets/');proof=Q.file_proof({'id':r['Id']},QC,[*sorted(files),'migrations','templates','static','assets'],lambda n:n in files or n.startswith(dirs),revision=BASE)
  need(proof['reviewedSourceMatch']is True,'full-runtime-source-base');result[service]=dict(proof,ociRevision=observed)
 return result

def database_container(runtime,raw):
 targets=runtime['targets'];ids=[cid for cid,row in runtime['all'].items()if cid not in targets.values()];records=json.loads(run(['docker','inspect',*ids]));matches=[r for r in records if(r['Config'].get('Labels')or{}).get('com.docker.compose.project')=='rr-portal'and(r['Config'].get('Labels')or{}).get('com.docker.compose.service')=='db'];need(len(matches)==1,'one-original-postgres-container');db=matches[0];need(db['State']['Running']is True and db['State'].get('Health',{}).get('Status')=='healthy'and db['State']['OOMKilled']is False,'postgres-original-healthy');env=Q.envmap(db['Config']['Env']);indo=Q.envmap(raw['indo-shipping']['Config']['Env']);need(indo.get('DB_NAME')==(env.get('POSTGRES_DB')or'rrportal')and indo.get('DB_USER')==(env.get('POSTGRES_USER')or'rrportal')and indo.get('DB_PASSWORD')==env.get('POSTGRES_PASSWORD'),'exact-indo-postgres-credentials-contract');blob=run(['docker','exec',raw['indo-shipping']['Id'],'cat','/proc/1/environ']);need(blob.endswith(b'\0'),'complete-indo-pid1-storage-env');process=Q.envmap([v.decode()for v in blob.split(b'\0')if v]);need(all(process.get(k)==indo.get(k)for k in ('DB_NAME','DB_USER','DB_PASSWORD','DB_SCHEMA'))and (not indo.get('DB_SCHEMA','').strip()or indo['DB_SCHEMA']=='indo_shipping'),'exact-indo-postgres-schema-contract');return db['Id']

def postgres_capture(dbid,path,with_dump):
 path.mkdir(mode=0o700);value=OPS.pg_capture(dbid,path,with_dump);private(str(path.relative_to(OUT))+'/captured.private.json',value);return value

QUEUE_SCRIPT="import datetime,json,os,re\nfrom redis import Redis\nfrom rq import Queue\nfrom rq.registry import StartedJobRegistry,ScheduledJobRegistry,DeferredJobRegistry,FailedJobRegistry,FinishedJobRegistry,CanceledJobRegistry\nr=Redis.from_url(os.environ['REDIS_URL'],socket_connect_timeout=3,socket_timeout=3)\nname=os.environ['RQ_QUEUE_NAME'];assert name=='qc-report-ai'\ndef text(v):\n if isinstance(v,bytes):v=v.decode()\n assert v is None or isinstance(v,str)and len(v)<=1024\n return v\ndef ids(values):\n assert len(values)<=10000\n return [text(v)for v in values]\nqueue=Queue(name,connection=r,serializer='json');assert r.llen(queue.key)<=10000\nworkers=[];worker_keys=r.smembers('rq:workers');assert len(worker_keys)<=100\nfor key in sorted(worker_keys):\n key=text(key);assert key.startswith('rq:worker:')\n fields=('state','current_job','queues','last_heartbeat','birth','death');values=r.hmget(key,fields)\n workers.append(dict(key=key,**dict(zip(fields,[text(v)for v in values]))))\nregistries={}\nfor cls in(StartedJobRegistry,ScheduledJobRegistry,DeferredJobRegistry,FailedJobRegistry,FinishedJobRegistry,CanceledJobRegistry):\n registry=cls(name=name,connection=r);count=r.zcard(registry.key);active_registry=cls in(StartedJobRegistry,ScheduledJobRegistry,DeferredJobRegistry)\n if active_registry:assert count<=10000\n registries[cls.__name__]={'key':registry.key,'count':count,'entries':[[text(v),score]for v,score in r.zrange(registry.key,0,-1,withscores=True)]if active_registry else []}\nqueued=ids(r.lrange(queue.key,0,-1));active=set(queued)\nfor name in('StartedJobRegistry','ScheduledJobRegistry','DeferredJobRegistry'):\n for value,_score in registries[name]['entries']:active.add(value.split(':',1)[0])\nfor worker in workers:\n if worker.get('current_job'):active.add(worker['current_job'])\nassert len(active)<=10000\ntimeout_counts={};status_counts={};missing=invalid=0\nfor job_id in sorted(active):\n assert re.fullmatch('[A-Za-z0-9_.-]{1,200}',job_id)\n timeout,status=r.hmget('rq:job:'+job_id,('timeout','status'));timeout=text(timeout);status=text(status)\n if timeout is None:missing+=1\n elif re.fullmatch('[0-9]{1,8}',timeout)and int(timeout)>0:timeout_counts[timeout]=timeout_counts.get(timeout,0)+1\n else:invalid+=1\n status=status if status in('created','queued','started','finished','failed','deferred','scheduled','stopped','canceled')else 'missing-or-unrecognized'\n status_counts[status]=status_counts.get(status,0)+1\nstate={'observedUTC':datetime.datetime.now(datetime.timezone.utc).isoformat(),'queueName':name,'queueKey':queue.key,'queued':queued,'registries':registries,'workers':workers,'activeJobTimeoutCounts':timeout_counts,'activeJobTimeoutMissing':missing,'activeJobTimeoutInvalid':invalid,'activeJobStatusCounts':status_counts}\nimport base64,math\nfailed_key=FailedJobRegistry(name=os.environ['RQ_QUEUE_NAME'],connection=r).key\nassert r.zcard(failed_key)<=1000\nentries=r.zrange(failed_key,0,-1,withscores=True);jobs={}\nfor identifier,score in entries:\n job_id=text(identifier);assert re.fullmatch('[A-Za-z0-9_.-]{1,200}',job_id)\n fields=r.hgetall('rq:job:'+job_id)\n jobs[job_id]={'score':score if math.isfinite(score)else 'infinite','hash':[[base64.b64encode(k).decode(),base64.b64encode(v).decode()]for k,v in sorted(fields.items())]}\nstate['queueName']=os.environ['RQ_QUEUE_NAME']\nstate['failedJobEvidence']={'registryKey':failed_key,'jobs':jobs}\nprint(json.dumps(state,sort_keys=True,separators=(',',':')))\n"
def queue(raw,label):
 value=json.loads(run(['docker','exec','-i',raw['qc-report-worker']['Id'],'python','-B','-'],QUEUE_SCRIPT.encode(),30));private(label+'-queue-and-failed-job-hashes.private.json',value);failed=value['failedJobEvidence'];need(all(bool(row['hash'])for row in failed['jobs'].values()),'all-failed-job-hashes-readable');summary={'queued':len(value['queued']),'busyWorkers':sum(w.get('state')=='busy'or bool(w.get('current_job'))for w in value['workers']),'registryCounts':{key:v['count']for key,v in value['registries'].items()},'failedJobs':len(failed['jobs']),'failedJobEvidenceSHA256':sha(enc(failed))};return summary,failed
def active(label):
 value={}
 with contextlib.closing(OPS.L.connect(ROOT/QC/'data/qc-report.db'))as db:
  for table in ('po_imports','ai_analysis_runs'):rows=db.execute('SELECT id,status,created_at,completed_at FROM '+table+" WHERE status IN ('queued','processing','retrying') ORDER BY id").fetchall();need(len(rows)<=10000,'bounded-active-job-rows');value[table]=[list(row)for row in rows]
 private(label+'-active-qc-jobs.private.json',value);return {key:len(rows)for key,rows in value.items()}
def quiet(queue_value,active_value):return queue_value['queued']==0 and queue_value['busyWorkers']==0 and all(queue_value['registryCounts'][name]==0 for name in ('StartedJobRegistry','ScheduledJobRegistry','DeferredJobRegistry'))and all(v==0 for v in active_value.values())
def capture_storage(directory,storage):
 result={}
 for key,path in storage.items():result[key]=OPS.sqlite_capture(key,path,directory/key);result[key]['databaseFileMetadata']={name:Q.file_metadata(path/name)for name in result[key]['sqlite']}
 need(set(result['qc-report-data']['sqlite'])=={'qc-report.db'}and not result['qc-report-storage']['sqlite']and all(set(result[s]['sqlite'])=={'data.db','auxiliary.db'}for s in ('factory-review','factory-review-test')),'exact-five-sqlite-databases');return result

def backup(result):
 global STAGE
 STAGE='raw-original-runtime';before,raw=current('before');STAGE='canonical-source-and-env';configuration=source();dirty=Q.dirty_snapshot(True);environment=Q.stable_environment_bytes(ROOT/'.env.cloud.production');envmeta=Q.stable_file_metadata(ROOT/'.env.cloud.production');private('environment.private',environment);flags=OPS.L.non_database_inventory(ROOT/'deploy/maintenance',[]);private('original-maintenance.private.json',flags)
 STAGE='actual-environment-and-source-proof';envproof=environments(raw);sourceproof=proofs(raw,envproof);private('source-proof.private.json',sourceproof);storage,mounts=roots(raw);need(shutil.disk_usage(OUT).free>2*sum(p.stat().st_size for root in storage.values()for p in root.rglob('*')if p.is_file())+1024**3,'backup-disk-space');STAGE='queue-empty-and-four-old-failed-preserved';qb,fb=queue(raw,'before');ab=active('before');need(quiet(qb,ab)and qb['failedJobs']>=4,'qc-no-active-work-and-original-failed-present');STAGE='portable-qc-database-and-attachments';saved=capture_storage(OUT,storage);STAGE='indo-pg-repeatable-read-portable-backup';dbid=database_container(before,raw);postgres=postgres_capture(dbid,OUT/'postgres',True);startup=Q.indo_startup_guard(raw['indo-shipping']['Id'],dbid);need(all(startup.values()),'no-unrelated-indo-startup-migrations');private('indo-startup-guard.private.json',startup)
 STAGE='final-readonly-stability';qa,fa=queue(raw,'after');aa=active('after');after,_=current('after');need(quiet(qa,aa)and fb==fa,'queue-empty-and-all-failed-job-content-identical');need(after==before and source()==configuration and Q.dirty_snapshot()==dirty and Q.stable_environment_bytes(ROOT/'.env.cloud.production')==environment and Q.stable_file_metadata(ROOT/'.env.cloud.production')==envmeta and OPS.L.non_database_inventory(ROOT/'deploy/maintenance',[])==flags,'runtime-all-others-env-dirty-and-flags-identical')
 for key,path in storage.items():need(OPS.L.non_database_inventory(path,list(saved[key]['sqlite']))==saved[key]['files']and{name:Q.file_metadata(path/name)for name in saved[key]['sqlite']}==saved[key]['databaseFileMetadata'],'all-qc-files-and-database-owner-mode-stable')
 private('baseline.private.json',{'head':BASE,'runtime':before,'configuration':configuration,'preexistingFourDirty':dirty,'environmentSHA256':sha(environment),'environmentFileMetadata':envmeta,'maintenanceInventory':flags,'sourceProof':sourceproof,'environmentProof':envproof,'storage':saved,'storageMounts':mounts,'postgres':postgres,'databaseContainer':dbid,'indoStartupGuard':startup,'queueBefore':qb,'queueAfter':qa,'failedJobEvidence':fb});result.update(success=True,backupComplete=True,portableSQLiteCount=5,postgresSchemaCount=1,allScopedFilesBackedUp=True,allNonTargetContainersAndConfigurationPreserved=True,privateEnvironmentBackedUp=True,queueBefore=qb,queueAfter=qa,oldFailedJobsPreservedExactly=True,individuallyConsistentNoCrossStoreAtomicClaim=True)
def main():
 need(len(sys.argv)==2 and sys.argv[1]=='backup'and BACKUP_PIN and os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_ATTEMPT')=='1','false-gate-or-wrong-phase');os.umask(0o077);OUT.mkdir(mode=0o700);initialize();signal.signal(signal.SIGTERM,lambda *_:need(False,'terminated'));result={'mode':'backup','base':BASE,'success':False,'businessWritesPerformed':False,'queueWritesPerformed':False,'configurationChanged':False,'containerSignalsSent':False,'globalMaintenanceChanged':False}
 try:backup(result)
 except BaseException:result.update(failedStage=STAGE,failedCheck=FAILED_CHECK or 'reviewed-library-or-system-error');private('failure-trace.private.txt',traceback.format_exc().encode())
 private('first-result.json',result);OPS.L.seal(OUT);print(enc(dict(result,manifestSHA256=OPS.L.file_hash(OUT/'manifest.json'),resultSHA256=OPS.L.file_hash(OUT/'first-result.json'))).decode(),flush=True);return 0 if result['success']else 1
if __name__=='__main__':
 try:code=main()
 except BaseException:print('{"mode":"backup","success":false,"safeFailure":"BATCH_977_979_BACKUP_PREFLIGHT_FAILED"}',flush=True);code=1
 sys.exit(code)
