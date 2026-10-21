"""PR975/976 read-only baseline, literal environment and QC queue diagnostic. Gates off.
Only local private evidence files are written. No app import, Redis mutation, HTTP,
maintenance operation, container signal, checkout, migration or business write.
"""
import contextlib,copy,datetime,hashlib,importlib.util,json,os,pathlib,re,shutil,signal,stat,subprocess,sys,traceback
ROOT=pathlib.Path('/opt/rr-portal');BASE='dfcdf751cae42fdd1731729dd662fce041c28caf'
BRANCH='refs/heads/ops/batch-975-976-20261021';BACKUP_PIN=True
OUT=ROOT/'deploy/backups/batch-975-976-20261021-backup'
FACTORY='apps/PMC跟仓管/加工厂月度评审管理制度';QC='apps/QA部/QC成品报告系统'
SERVICES=('factory-review','factory-review-test','qc-report','qc-report-worker')
STORAGE={'factory-review':FACTORY+'/pb_data','factory-review-test':FACTORY+'/pb_data_test','qc-report-data':QC+'/data','qc-report-storage':QC+'/storage'}
FIXED=('docker-compose.cloud.yml','nginx/nginx.cloud.conf','deploy/update-server.sh','deploy/service-maintenance.sh','.github/workflows/deploy.yml',*(p+'/'+n for p in (FACTORY,QC)for n in ('Dockerfile','.dockerignore')))
DEPENDENCIES={'factory-review-backup-library.py':'79d76bb47312dd08c121ebe2797f54d958666f8b72d00721f67712b152fc4666','qc-report-backup-library.py':'4745c90f126cf46106b0f170a3ebc6b24ccb64c0e963e427d13308d5cb5b54f5','release-data-ops-library.py':'ff9138a1d5bfed1b10077112da6ebcda2d65240f583e2d0e12ce1325cfbaafd5','release-data-library.py':'d63168fd3057f4f2aba2d93f9fab31d2d65c6dd0f3234877d71fcff1e04e62b9'}
STAGE='entry';FAILED_CHECK=None;COUNTER=0;OPS=None;F=None;Q=None
NUMERIC_KEYS={'QC_REPORT_OPENAI_TIMEOUT_SECONDS':'OPENAI_TIMEOUT_SECONDS','QC_REPORT_OPENAI_MAX_OUTPUT_TOKENS':'OPENAI_MAX_OUTPUT_TOKENS','QC_REPORT_RQ_JOB_TIMEOUT_SECONDS':'RQ_JOB_TIMEOUT_SECONDS'}

def need(value,label):
 global FAILED_CHECK
 if not value:
  need_label=type(label)is str and bool(re.fullmatch('[a-z0-9-]{1,90}',label));FAILED_CHECK=label if need_label else 'invalid-check-label';raise RuntimeError('BATCH_975_976_READONLY_REJECTED')
def enc(v):return json.dumps(v,ensure_ascii=True,sort_keys=True,separators=(',',':'),allow_nan=False).encode()
def sha(v):return hashlib.sha256(v).hexdigest()
def load(name):
 p=pathlib.Path(__file__).with_name(name);need(p.is_file()and not p.is_symlink()and sha(p.read_bytes())==DEPENDENCIES[name],'dependency-fixed-bytes');s=importlib.util.spec_from_file_location(name.replace('.','_'),p);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
def private(name,value):OPS.L.private_write(OUT/name,value if type(value)is bytes else enc(value))
def run(args,data=None,timeout=180):
 global COUNTER
 COUNTER+=1
 with (OUT/('%04d-stderr.private'%COUNTER)).open('xb')as errors:p=subprocess.run(args,input=data,stdout=subprocess.PIPE,stderr=errors,timeout=timeout,cwd=ROOT)
 need(p.returncode==0,'subprocess-succeeded');need(len(p.stdout)<=128*1024**2,'bounded-command-output');return p.stdout
def envmap(values):
 need(type(values)is list and len(values)<=1000,'bounded-config-environment');result={}
 for item in values:
  need(type(item)is str and '='in item,'environment-entry');key,value=item.split('=',1);need(bool(re.fullmatch('[A-Za-z_][A-Za-z0-9_]*',key))and key not in result,'unique-environment-key');result[key]=value
 return result
def initialize():
 global OPS,F,Q
 OPS=load('release-data-ops-library.py');OPS.L=load('release-data-library.py');OPS.L.databases=OPS.database_names;OPS.run=run
 F=load('factory-review-backup-library.py');Q=load('qc-report-backup-library.py')
 for module in (F,Q):module.OPS=OPS;module.run=run;module.OUT=OUT;module.BASE=BASE
 F.FIXED=FIXED
def runtime(label):
 ids=run(['docker','ps','-aq','--no-trunc']).decode().split();need(0<len(ids)<=1000 and len(ids)==len(set(ids))and all(re.fullmatch('[a-f0-9]{64}',cid)for cid in ids),'bounded-unique-container-ids');records=json.loads(run(['docker','inspect',*ids]));private(label+'-all-raw-inspects.private.json',records)
 need(type(records)is list and len(records)==len(ids),'complete-inspect-inventory');raw={};rows={};targets={}
 for record in records:
  cid=record['Id'];need(cid in ids and cid not in raw,'unique-inspected-container');raw[cid]=record;config=copy.deepcopy(record['Config']);config['Env']=sorted(config['Env']);state=record['State'];row={'id':cid,'image':record['Image'],'started':state.get('StartedAt'),'running':state['Running'],'oom':state['OOMKilled'],'restarts':record['RestartCount'],'health':state.get('Health',{}).get('Status'),'configSHA256':sha(enc(config)),'hostConfigSHA256':sha(enc(record['HostConfig'])),'networkSettingsSHA256':sha(enc(record.get('NetworkSettings',{}))),'mounts':sorted(record.get('Mounts',[]),key=enc)};rows[cid]=row
  labels=config.get('Labels')or{};service=labels.get('com.docker.compose.service')if labels.get('com.docker.compose.project')=='rr-portal'else None
  if service in SERVICES:need(service not in targets,'single-target-per-service');targets[service]=cid
 private(label+'-runtime-before-health-assertions.private.json',{'all':rows,'targets':targets})
 need(set(targets)==set(SERVICES),'all-four-targets-present')
 for service,cid in targets.items():need(rows[cid]['running']is True and rows[cid]['oom']is False and rows[cid]['health']=='healthy','targets-running-healthy-no-oom')
 return {'all':rows,'targets':targets},{service:raw[cid]for service,cid in targets.items()}
def metadata(path):
 need(path.is_file()and not path.is_symlink(),'regular-owned-file');s=path.stat();return {'mode':stat.S_IMODE(s.st_mode),'uid':s.st_uid,'gid':s.st_gid}
def source():
 F.source();run(['git','diff','--quiet','--no-ext-diff','--no-textconv','--ignore-submodules=none','--',QC]);return {name:OPS.L.file_hash(ROOT/name)for name in FIXED}
def storage_roots(raw):
 need(sorted(raw['qc-report']['Mounts'],key=enc)==sorted(raw['qc-report-worker']['Mounts'],key=enc),'qc-web-worker-identical-mounts');roots={};contracts={}
 for key,relative in STORAGE.items():
  service=key if key.startswith('factory-review')else 'qc-report';destination='/pb/pb_data'if service.startswith('factory-review')else '/app/'+('data'if key.endswith('-data')else 'storage');matches=[m for m in raw[service]['Mounts']if m.get('Destination')==destination];need(len(matches)==1,'one-persistent-mount-per-destination');m=matches[0];path=ROOT/relative;need(m.get('Type')=='bind'and m.get('Source')==str(path)and m.get('RW')is True and path.is_dir()and all(not p.is_symlink()for p in(path,*path.parents)),'persistent-mount-fixed-contract');roots[key]=path;contracts[key]=m
 for service in SERVICES:need(len(raw[service]['Mounts'])==(1 if service.startswith('factory-review')else 2),'no-unaccounted-target-mount')
 need(len(set(roots.values()))==4,'separate-persistent-roots');return roots,contracts
def environments(raw):
 need(run(['docker','compose','version','--short']).decode().strip()=='5.1.0','reviewed-compose-version');rendered=json.loads(run(['docker','compose','-p','rr-portal','-f',str(ROOT/'docker-compose.cloud.yml'),'--env-file',str(ROOT/'.env.cloud.production'),'config','--format','json']));private('compose-render.private.json',rendered);proof={}
 for service in SERVICES:
  record=raw[service];actual=envmap(record['Config']['Env']);proc=run(['docker','exec',record['Id'],'cat','/proc/1/environ']);need(proc.endswith(b'\0'),'complete-process-environment');process=envmap([value.decode()for value in proc.split(b'\0')if value]);need(record['Config'].get('Hostname')==record['Id'][:12]and process.pop('HOSTNAME',None)==record['Id'][:12],'automatic-hostname-only');declared=rendered['services'][service].get('environment',{});need(type(declared)is dict and all(type(k)is str and type(v)is str for k,v in declared.items()),'declared-string-environment');images=json.loads(run(['docker','image','inspect',record['Image']]));need(type(images)is list and len(images)==1 and images[0]['Id']==record['Image'],'fixed-runtime-image');image=images[0]
  for name,value in [('configured-image',image),('literal-configured-environment',actual),('literal-process-environment',process),('declared-compose-environment',declared)]:private(service+'-'+name+'.private.json',value)
  proof[service]={'image':record['Image'],'ociRevision':(image['Config'].get('Labels')or{}).get('org.opencontainers.image.revision'),'configuredSHA256':sha(enc(actual)),'processWithoutHostnameSHA256':sha(enc(process)),'configuredProcessMismatchKeys':sorted(k for k in set(actual)|set(process)if actual.get(k)!=process.get(k)),'declaredActualMismatchKeys':sorted(k for k in declared if actual.get(k)not in {declared[k],declared[k].replace('$$','$')})}
  if service.startswith('qc-report'):
   proof[service]['nonsecretEffectiveLimits']={k:{kind:safe_numeric(values.get(k))for kind,values in [('actual',actual),('process',process),('declared',declared)]}for k in NUMERIC_KEYS.values()};need(actual.get('DATABASE_URL')=='sqlite:////app/data/qc-report.db'and actual.get('STORAGE_ROOT')=='/app/storage'and actual.get('QUEUE_REQUIRED')=='true','qc-storage-and-required-queue-contract')
  else:need(all(k in actual for k in ('FACTORY_REVIEW_AI_ENABLED','FACTORY_REVIEW_AI_API_KEY','FACTORY_REVIEW_AI_MODEL','FACTORY_REVIEW_AI_BASE_URL')),'factory-actual-ai-config-retained')
 return proof
def safe_numeric(value):return {'present':value is not None,'validPositiveInteger':type(value)is str and bool(re.fullmatch('[0-9]{1,8}',value))and int(value)>0,'value':value if type(value)is str and bool(re.fullmatch('[0-9]{1,8}',value))else None}
def explicit_numeric_environment(blob):
 result={key:{'present':False,'occurrences':0,'validPositiveInteger':None,'value':None}for key in NUMERIC_KEYS}
 for line in blob.decode().splitlines():
  match=re.fullmatch(r'\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*',line)
  if not match or match[1]not in result:continue
  value=match[2]
  if value.startswith(('"',"'"))and len(value)>=2 and value[-1]==value[0]:value=value[1:-1]
  else:value=re.sub(r'\s+#.*$','',value).rstrip()
  observed=safe_numeric(value);key=match[1];count=result[key]['occurrences']+1;result[key]=dict(observed,occurrences=count)
 return result
def runtime_sources(raw,environment_proof):
 result={}
 for service in SERVICES:
  row={'id':raw[service]['Id'],'image':raw[service]['Image']};revision=environment_proof[service]['ociRevision'];need(type(revision)is str and bool(re.fullmatch('[a-f0-9]{40}',revision)),'runtime-image-has-pinned-source-revision')
  if service.startswith('factory-review'):result[service]=F.runtime_files(service,row)
  else:
   need(run(['git','rev-parse',revision+':'+QC]).decode().strip()==run(['git','rev-parse',BASE+':'+QC]).decode().strip()or service=='qc-report-worker','qc-web-app-tree-matches-base');proof=Q.service_source_proof('qc-report',row,revision=revision);need(proof['reviewedSourceMatch']is True,'actual-qc-image-source-matches-own-oci-revision');result[service]=dict(proof,ociRevision=revision,applicationTree=run(['git','rev-parse',revision+':'+QC]).decode().strip(),workerMayHaveOlderVerifiedApplicationTree=service=='qc-report-worker'and revision!=BASE)
 return result
QUEUE_SCRIPT=r'''import datetime,json,os,re
from redis import Redis
from rq import Queue
from rq.registry import StartedJobRegistry,ScheduledJobRegistry,DeferredJobRegistry,FailedJobRegistry,FinishedJobRegistry,CanceledJobRegistry
r=Redis.from_url(os.environ['REDIS_URL'],socket_connect_timeout=3,socket_timeout=3)
name=os.environ['RQ_QUEUE_NAME'];assert name=='qc-report-ai'
def text(v):
 if isinstance(v,bytes):v=v.decode()
 assert v is None or isinstance(v,str)and len(v)<=1024
 return v
def ids(values):
 assert len(values)<=10000
 return [text(v)for v in values]
queue=Queue(name,connection=r,serializer='json');assert r.llen(queue.key)<=10000
workers=[];worker_keys=r.smembers('rq:workers');assert len(worker_keys)<=100
for key in sorted(worker_keys):
 key=text(key);assert key.startswith('rq:worker:')
 fields=('state','current_job','queues','last_heartbeat','birth','death');values=r.hmget(key,fields)
 workers.append(dict(key=key,**dict(zip(fields,[text(v)for v in values]))))
registries={}
for cls in(StartedJobRegistry,ScheduledJobRegistry,DeferredJobRegistry,FailedJobRegistry,FinishedJobRegistry,CanceledJobRegistry):
 registry=cls(name=name,connection=r);count=r.zcard(registry.key);active_registry=cls in(StartedJobRegistry,ScheduledJobRegistry,DeferredJobRegistry)
 if active_registry:assert count<=10000
 registries[cls.__name__]={'key':registry.key,'count':count,'entries':[[text(v),score]for v,score in r.zrange(registry.key,0,-1,withscores=True)]if active_registry else []}
queued=ids(r.lrange(queue.key,0,-1));active=set(queued)
for name in('StartedJobRegistry','ScheduledJobRegistry','DeferredJobRegistry'):
 for value,_score in registries[name]['entries']:active.add(value.split(':',1)[0])
for worker in workers:
 if worker.get('current_job'):active.add(worker['current_job'])
assert len(active)<=10000
timeout_counts={};status_counts={};missing=invalid=0
for job_id in sorted(active):
 assert re.fullmatch('[A-Za-z0-9_.-]{1,200}',job_id)
 timeout,status=r.hmget('rq:job:'+job_id,('timeout','status'));timeout=text(timeout);status=text(status)
 if timeout is None:missing+=1
 elif re.fullmatch('[0-9]{1,8}',timeout)and int(timeout)>0:timeout_counts[timeout]=timeout_counts.get(timeout,0)+1
 else:invalid+=1
 status=status if status in('created','queued','started','finished','failed','deferred','scheduled','stopped','canceled')else 'missing-or-unrecognized'
 status_counts[status]=status_counts.get(status,0)+1
print(json.dumps({'observedUTC':datetime.datetime.now(datetime.timezone.utc).isoformat(),'queueName':name,'queueKey':queue.key,'queued':queued,'registries':registries,'workers':workers,'activeJobTimeoutCounts':timeout_counts,'activeJobTimeoutMissing':missing,'activeJobTimeoutInvalid':invalid,'activeJobStatusCounts':status_counts},sort_keys=True,separators=(',',':')))
'''
def queue_observation(raw,label):
 value=json.loads(run(['docker','exec','-i',raw['qc-report-worker']['Id'],'python','-B','-'],QUEUE_SCRIPT.encode(),30));private(label+'-queue.private.json',value);counts={key:row['count']for key,row in value['registries'].items()};return {'queued':len(value['queued']),'registryCounts':counts,'workerCount':len(value['workers']),'busyWorkers':sum(w.get('state')=='busy'or bool(w.get('current_job'))for w in value['workers']),'observedUTC':value['observedUTC'],'redisMutationsPerformed':False,'activeJobTimeoutCounts':value['activeJobTimeoutCounts'],'activeJobTimeoutMissing':value['activeJobTimeoutMissing'],'activeJobTimeoutInvalid':value['activeJobTimeoutInvalid'],'activeJobStatusCounts':value['activeJobStatusCounts']}
def active_database_rows(database,label):
 value={}
 with contextlib.closing(OPS.L.connect(database))as db:
  for table in ('po_imports','ai_analysis_runs'):
   need(db.execute("SELECT count(*) FROM sqlite_master WHERE type='table' AND name=?",(table,)).fetchone()==(1,),'qc-active-job-table-present');rows=db.execute('SELECT id,status,created_at,completed_at FROM '+table+" WHERE status IN ('queued','processing','retrying') ORDER BY id").fetchall();need(len(rows)<=10000,'bounded-active-qc-job-rows');value[table]=[list(row)for row in rows]
 private(label+'-active-qc-jobs.private.json',value);return {table:{status:sum(row[1]==status for row in rows)for status in ('queued','processing','retrying')}for table,rows in value.items()}
def backup(result):
 global STAGE
 STAGE='capture-original-runtime-before-assertions';before,raw=runtime('before');result['observedServerMainHead']=run(['git','rev-parse','HEAD']).decode().strip();STAGE='source-dirty-env-flags';configuration=source();dirty=F.dirty_snapshot(True);need(not any(name==QC or name.startswith(QC+'/')for name in dirty),'dirty-does-not-overlap-qc');env=ROOT/'.env.cloud.production';environment=Q.stable_environment_bytes(env);envmeta=Q.stable_file_metadata(env);private('environment.private',environment);result['explicitServerNumericKeys']=explicit_numeric_environment(environment);flags=OPS.L.non_database_inventory(ROOT/'deploy/maintenance',[]);private('original-maintenance.private.json',flags)
 STAGE='literal-config-and-runtime-environment';environment_proof=environments(raw);private('environment-proof.private.json',environment_proof);result['nonsecretQCEffectiveLimits']={s:environment_proof[s]['nonsecretEffectiveLimits']for s in ('qc-report','qc-report-worker')}
 STAGE='storage-and-queue-before';roots,contracts=storage_roots(raw);private('mount-contracts.private.json',contracts);need(shutil.disk_usage(OUT).free>2*sum(p.stat().st_size for root in roots.values()for p in root.rglob('*')if p.is_file())+1024**3,'sufficient-backup-disk');queue_before=queue_observation(raw,'before');active_before=active_database_rows(roots['qc-report-data']/'qc-report.db','before');result.update(queueBefore=queue_before,activeDatabaseJobsBefore=active_before);storage={}
 for key,root in roots.items():
  STAGE=key+'-wal-aware-portable-backup';storage[key]=OPS.sqlite_capture(key,root,OUT/key);storage[key]['databaseFileMetadata']={name:metadata(root/name)for name in storage[key]['sqlite']}
 need(set(storage['factory-review']['sqlite'])==set(storage['factory-review-test']['sqlite'])=={'data.db','auxiliary.db'}and set(storage['qc-report-data']['sqlite'])=={'qc-report.db'}and not storage['qc-report-storage']['sqlite'],'exact-five-sqlite-databases')
 STAGE='runtime-source-own-pinned-revisions';proof=runtime_sources(raw,environment_proof);private('runtime-source-proof.private.json',proof)
 STAGE='queue-after-and-runtime-stability';queue_after=queue_observation(raw,'after');active_after=active_database_rows(roots['qc-report-data']/'qc-report.db','after');after,_=runtime('after');need(before==after,'runtime-identity-config-all-containers-unchanged');need(source()==configuration and F.dirty_snapshot()==dirty and Q.stable_file_metadata(env)==envmeta and Q.stable_environment_bytes(env)==environment and OPS.L.non_database_inventory(ROOT/'deploy/maintenance',[])==flags,'source-env-four-dirty-and-flags-unchanged')
 for key,root in roots.items():need(OPS.L.non_database_inventory(root,list(storage[key]['sqlite']))==storage[key]['files']and {name:metadata(root/name)for name in storage[key]['sqlite']}==storage[key]['databaseFileMetadata'],'storage-files-and-owner-mode-stable')
 private('baseline.private.json',{'head':BASE,'runtime':before,'configuration':configuration,'environmentSHA256':sha(environment),'environmentFileMetadata':envmeta,'preexistingFourDirty':dirty,'maintenanceInventory':flags,'composeEnvironmentProof':environment_proof,'sourceProof':proof,'storage':storage,'mountContracts':contracts,'queueBefore':queue_before,'queueAfter':queue_after,'activeDatabaseJobsBefore':active_before,'activeDatabaseJobsAfter':active_after})
 result.update(success=True,backupComplete=True,portableSQLiteCount=5,allNonTargetContainersUnchanged=True,allTargetContainersUnchanged=True,environmentAndProcessEvidenceSavedPrivately=True,sourceProofOwnImmutableOCIRevisions=True,allStorageFilesAndOwnerModesPreserved=True,queueBefore=queue_before,queueAfter=queue_after,activeDatabaseJobsBefore=active_before,activeDatabaseJobsAfter=active_after,nonsecretQCEffectiveLimits={s:environment_proof[s]['nonsecretEffectiveLimits']for s in ('qc-report','qc-report-worker')},databaseSnapshotsIndividuallyConsistentNotCrossStoreAtomic=True)
def main():
 need(len(sys.argv)==2 and sys.argv[1]=='backup'and BACKUP_PIN and os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_ATTEMPT')=='1','fixed-false-by-default-entrypoint');os.umask(0o077);initialize();OUT.mkdir(mode=0o700);signal.signal(signal.SIGTERM,lambda *_:need(False,'terminated-readonly-diagnostic'));result={'mode':'backup','base':BASE,'success':False,'backupComplete':False,'businessWritesPerformed':False,'credentialsOrConfigurationChanged':False,'containerSignalsSent':False,'maintenanceChanged':False,'redisMutationsPerformed':False,'healthOrBusinessHTTPRequestsPerformed':False,'secretOrRowsPrinted':False,'observedAtUTC':datetime.datetime.now(datetime.timezone.utc).isoformat()}
 try:backup(result)
 except BaseException:
  private('failure-trace.private.txt',traceback.format_exc().encode());result.update(failedStage=STAGE,failedCheck=FAILED_CHECK or 'imported-library-or-system-error')
 finally:private('first-result.json',result);OPS.L.seal(OUT);print(enc(dict(result,manifestSHA256=OPS.L.file_hash(OUT/'manifest.json'),resultSHA256=OPS.L.file_hash(OUT/'first-result.json'))).decode(),flush=True)
 return 0 if result['success']else 1
if __name__=='__main__':
 try:code=main()
 except BaseException:print('{"success":false,"safeFailure":"BATCH_975_976_READONLY_PREFLIGHT_FAILED"}',flush=True);code=1
 sys.exit(code)
