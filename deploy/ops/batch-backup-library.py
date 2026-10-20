"""Fixed seven-service private backup. Draft only; all execution gates remain false.

No maintenance, deployment, SQL writes, API calls, login, fixture data or restore.
Every SQLite is an independent consistent online copy, not cross-DB atomic.
"""
import contextlib,datetime,hashlib,importlib.util,io,json,os,pathlib,re,shutil,signal,sqlite3,stat,subprocess,sys,tarfile,urllib.parse
ROOT=pathlib.Path('/opt/rr-portal');BASE='9a62c7059600c12d4781b94f69098e37a32d901d'
BRANCH='refs/heads/ops/batch-961-965-20261020';BACKUP_PIN=False
OUT=ROOT/'deploy/backups/batch-961-965-20261020-backup'
DEPENDENCIES={'release-data-ops-library.py':'ff9138a1d5bfed1b10077112da6ebcda2d65240f583e2d0e12ce1325cfbaafd5','release-data-library.py':'d63168fd3057f4f2aba2d93f9fab31d2d65c6dd0f3234877d71fcff1e04e62b9','internal-quote-readonly-library.py':'be4f901f3444154e5de06766a2d8a0801dba9b847a4ac25f34a84ccebe354e69','portable-pdb-library.py':'cf66f655a1e166491c4da67da0824f42ac8cdae3f844044cb5d8f7233ba105c5'}
FACTORY='apps/PMC跟仓管/加工厂月度评审管理制度';QC='apps/QA部/QC验货计划系统';PRINT='apps/工程部/3D打印协同平台';QUOTE='apps/业务部/内部报价系统';ZURU='apps/业务部/ZURU接单表入单系统'
APP_PREFIXES=(FACTORY,QC,PRINT,QUOTE,ZURU)
SERVICES={'factory-review','factory-review-test','qc-plan-api','qc-plan-web','printlink','internal-quote','zuru-order-system'}
# key: (owning service, bind-relative root or exact named volume, container path, RW).
STORAGE={'factory-review':('factory-review',FACTORY+'/pb_data','/pb/pb_data',True),'factory-review-test':('factory-review-test',FACTORY+'/pb_data_test','/pb/pb_data',True),'qc-plan-data':('qc-plan-api',QC+'/data','/data',True),'printlink-runtime':('printlink',None,'/app/runtime',True),'quote-legacy':('internal-quote',QUOTE+'/backend/data','/app/backend/legacy-data',False),'quote-uploads':('internal-quote',QUOTE+'/backend/uploads','/app/backend/uploads',True),'zuru-data':('zuru-order-system',ZURU+'/data','/app/data',True),'zuru-uploads':('zuru-order-system',ZURU+'/uploads','/app/uploads',True),'zuru-exports':('zuru-order-system',ZURU+'/exports','/app/exports',True)}
FIXED=('docker-compose.cloud.yml','nginx/nginx.cloud.conf','deploy/update-server.sh','deploy/service-maintenance.sh','.github/workflows/deploy.yml',FACTORY+'/Dockerfile',FACTORY+'/.dockerignore',QC+'/Dockerfile.api',QC+'/Dockerfile.web',QC+'/.dockerignore',PRINT+'/Dockerfile',PRINT+'/.dockerignore',QUOTE+'/Dockerfile',QUOTE+'/.dockerignore',ZURU+'/Dockerfile',ZURU+'/.dockerignore')
STAGE='entrypoint';COUNTER=0;OPS=None;READONLY=None;PDB=None
PG_SHELL='exec psql -X -q -At -v ON_ERROR_STOP=1 -U "${POSTGRES_USER:-rrportal}" -d "${POSTGRES_DB:-rrportal}"'

def need(value):
 if not value:raise RuntimeError('BATCH_961_965_BACKUP_REJECTED')
def enc(value):return json.dumps(value,ensure_ascii=True,sort_keys=True,separators=(',',':'),allow_nan=False).encode()
def sha(value):return hashlib.sha256(value).hexdigest()
def load(name):
 path=pathlib.Path(__file__).with_name(name);need(path.is_file()and not path.is_symlink()and sha(path.read_bytes())==DEPENDENCIES[name]);spec=importlib.util.spec_from_file_location('batch_'+name.replace('.','_'),path);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module

def run(args,data=None,timeout=180):
 global COUNTER
 COUNTER+=1
 with(OUT/('%04d-stderr.private'%COUNTER)).open('xb')as errors:result=subprocess.run(args,input=data,stdout=subprocess.PIPE,stderr=errors,timeout=timeout,cwd=ROOT)
 need(result.returncode==0 and len(result.stdout)<=128*1024**2);return result.stdout

def envmap(values):
 need(type(values)is list and len(values)<=1000);result={}
 for item in values:
  need(type(item)is str and'='in item);key,value=item.split('=',1);need(re.fullmatch('[A-Za-z_][A-Za-z0-9_]*',key)and key not in result);result[key]=value
 return result

def serialized_environment(literal):
 need(type(literal)is dict and all(type(k)is str and type(v)is str for k,v in literal.items()));return{k:v.replace('$','$$')for k,v in literal.items()}

def literal_explicit_environment(actual,defaults,declared):
 need(type(actual)is dict and type(defaults)is dict and type(declared)is dict and set(declared)<=set(actual));literal={k:actual[k]for k in declared};need(declared==serialized_environment(literal));expected=dict(defaults);expected.update(literal);need(expected==actual);return literal

def source():
 need(run(['git','symbolic-ref','--quiet','HEAD']).decode().strip()=='refs/heads/main'and run(['git','rev-parse','HEAD']).decode().strip()==BASE)
 for prefix in APP_PREFIXES:run(['git','diff','--quiet','--no-ext-diff','--no-textconv','--ignore-submodules=none','--',prefix])
 result={}
 for name in FIXED:
  path=ROOT/name;need(path.is_file()and not path.is_symlink()and path.read_bytes()==run(['git','show',BASE+':'+name]));result[name]=OPS.L.file_hash(path)
 return result

def dirty_snapshot(save=False):
 run(['git','diff','--cached','--quiet','--no-ext-diff','--no-textconv','--ignore-submodules=none']);raw=run(['git','diff','--name-only','-z','--no-ext-diff','--no-textconv','--ignore-submodules=none']).decode();names=raw.strip('\0').split('\0')if raw else[];need(len(names)==len(set(names))==4);rows={}
 for index,name in enumerate(sorted(names)):
  need(OPS.L.safe_path(name)and name not in FIXED and not any(name==p or name.startswith(p+'/')for p in APP_PREFIXES));entry=run(['git','ls-tree','-z',BASE,'--',name]).split(b'\t',1);need(len(entry)==2 and entry[1]==name.encode()+b'\0'and re.fullmatch(b'100(?:644|755) blob [a-f0-9]{40}',entry[0]));path=ROOT/name
  for ancestor in(path,*path.parents):
   if ancestor==ROOT:break
   need(not ancestor.is_symlink())
  if not path.exists():rows[name]={'kind':'absent'};continue
  with os.fdopen(os.open(path,os.O_RDONLY|os.O_NOFOLLOW),'rb')as stream:
   before=os.fstat(stream.fileno());need(stat.S_ISREG(before.st_mode)and before.st_size<=8*1024**2);content=stream.read(8*1024**2+1);after=os.fstat(stream.fileno());key=lambda value:(value.st_dev,value.st_ino,value.st_mode,value.st_size,value.st_mtime_ns,value.st_ctime_ns);need(key(before)==key(after)==key(path.lstat())and len(content)==before.st_size)
  rows[name]={'kind':'regular','bytes':len(content),'mode':stat.S_IMODE(before.st_mode),'sha256':sha(content)}
  if save:OPS.L.private_write(OUT/('dirty-%02d.private'%index),content)
 need(sum(row.get('bytes',0)for row in rows.values())<=16*1024**2);return rows

def maintenance_inventory():
 path=ROOT/'deploy/maintenance';need(path.is_dir()and not path.is_symlink())
 for service in SERVICES:need(not(path/'services'/service).exists()and not(path/'services'/service).is_symlink())
 return OPS.L.non_database_inventory(path,[])

def runtime():
 ids=run(['docker','ps','-aq','--no-trunc']).decode().split();need(0<len(ids)<=1000 and len(ids)==len(set(ids))and all(re.fullmatch('[a-f0-9]{64}',v)for v in ids));records=json.loads(run(['docker','inspect',*ids]));need(type(records)is list and len(records)==len(ids));targets={};others={};raw={};db=None
 for record in records:
  cid=record['Id'];need(cid in ids and cid not in raw);raw[cid]=record;labels=record.get('Config',{}).get('Labels')or{};service=labels.get('com.docker.compose.service')if labels.get('com.docker.compose.project')=='rr-portal'else None;environment=envmap(record['Config']['Env']);state=record['State']
  row={'id':cid,'image':record['Image'],'started':state.get('StartedAt'),'running':state['Running'],'oom':state['OOMKilled'],'restarts':record['RestartCount'],'health':state.get('Health',{}).get('Status'),'environmentMapSHA256':sha(enc(environment)),'mounts':sorted(record.get('Mounts',[]),key=enc),'memory':record['HostConfig'].get('Memory'),'swap':record['HostConfig'].get('MemorySwap'),'healthcheck':record['Config'].get('Healthcheck'),'command':record['Config'].get('Cmd'),'entrypoint':record['Config'].get('Entrypoint'),'user':record['Config'].get('User'),'workingDirectory':record['Config'].get('WorkingDir')}
  if service=='db':need(db is None and row['running']is True and row['health']=='healthy');db=cid
  if service not in SERVICES:others[cid]=row;continue
  need(service not in targets and row['running']is True and row['oom']is False and row['health']=='healthy')
  proc=run(['docker','exec',cid,'cat','/proc/1/environ']);need(proc.endswith(b'\0'));processenv=envmap([v.decode()for v in proc.split(b'\0')if v]);need(record['Config'].get('Hostname')==cid[:12]and processenv.pop('HOSTNAME',None)==cid[:12]);row['processEnvironmentWithoutAutomaticHostnameSHA256']=sha(enc(processenv));targets[service]=row
 need(set(targets)==SERVICES and db is not None);target_raw={name:raw[row['id']]for name,row in targets.items()};return {'targets':targets,'others':others,'databaseContainer':db},target_raw

def storage_roots(raw):
 roots={};mounts={}
 for key,(service,relative,destination,rw)in STORAGE.items():
  found=[m for m in raw[service].get('Mounts',[])if m.get('Destination')==destination];need(len(found)==1 and found[0].get('RW')is rw);mount=found[0];path=pathlib.Path(mount['Source']);need(path.is_absolute()and path.is_dir()and not path.is_symlink())
  if relative is None:need(key=='printlink-runtime'and mount.get('Type')=='volume'and mount.get('Name')=='rr-portal_printlink-data'and str(path)=='/var/lib/docker/volumes/rr-portal_printlink-data/_data')
  else:need(mount.get('Type')=='bind'and path==ROOT/relative)
  for ancestor in(path,*path.parents):need(not ancestor.is_symlink())
  roots[key]=path;mounts[key]=mount
 need(len(set(roots.values()))==len(roots))
 for service in SERVICES:need(len(raw[service].get('Mounts',[]))==sum(spec[0]==service for spec in STORAGE.values()))
 return roots,mounts

def storage_contract(raw,dbid):
 environment={service:envmap(record['Config']['Env'])for service,record in raw.items()};db=json.loads(run(['docker','inspect',dbid]));need(len(db)==1 and db[0]['Id']==dbid);db_env=envmap(db[0]['Config']['Env']);database=db_env.get('POSTGRES_DB')or'rrportal';user=db_env.get('POSTGRES_USER')or'rrportal';quote=environment['internal-quote'];url=urllib.parse.urlsplit(quote.get('DATABASE_URL',''));need(quote.get('DB_DRIVER')!='sqlite'and quote.get('DB_SCHEMA')=='internal_quote'and url.scheme in{'postgres','postgresql'}and url.hostname=='db'and(url.port or 5432)==5432 and urllib.parse.unquote(url.path)=='/'+database and urllib.parse.unquote(url.username or'')==user and urllib.parse.unquote(url.password or'')==db_env.get('POSTGRES_PASSWORD','')and not url.query and not url.fragment and quote.get('LEGACY_SQLITE_FILE')=='/app/backend/legacy-data/data.db');need(environment['qc-plan-api'].get('ConnectionStrings__Default')=='Data Source=/data/qc-inspection.db');need(environment['zuru-order-system'].get('DATA_PATH')=='/app'and environment['zuru-order-system'].get('LOCAL_MODE')=='0');need(environment['printlink'].get('PLATFORM_DATA_DIR')=='/app/runtime'and environment['printlink'].get('APP_MODE')=='production')
 for service in('factory-review','factory-review-test'):
  record=raw[service];need(record['Config'].get('Cmd')==['/pb/pocketbase','serve','--http=0.0.0.0:8090','--dir=/pb/pb_data','--publicDir=/pb/pb_public','--migrationsDir=/pb/pb_migrations','--hooksDir=/pb/pb_hooks'])
 return environment

def compose_environment(raw):
 need(run(['docker','compose','version','--short']).decode().strip()=='5.1.0');config=json.loads(run(['docker','compose','-p','rr-portal','-f',str(ROOT/'docker-compose.cloud.yml'),'--env-file',str(ROOT/'.env.cloud.production'),'config','--format','json'],timeout=90));need(type(config)is dict and type(config.get('services'))is dict);result={}
 for service in sorted(SERVICES):
  record=raw[service];images=json.loads(run(['docker','image','inspect',record['Image']]));need(len(images)==1 and images[0]['Id']==record['Image']);image=images[0];OPS.L.private_write(OUT/(service+'-image.private.json'),enc(image));declared=config['services'][service].get('environment',{});literal=literal_explicit_environment(envmap(record['Config']['Env']),envmap(image['Config'].get('Env')or[]),declared);OPS.L.private_write(OUT/(service+'-compose-environment.private.json'),enc(declared));OPS.L.private_write(OUT/(service+'-literal-compose-environment.private.json'),enc(literal));result[service]={'serializedExplicitEnvironmentSHA256':sha(enc(declared)),'literalExplicitEnvironmentSHA256':sha(enc(literal)),'forwardSerializedLiteralEqualsComposeJSON':True,'literalExplicitAndImageDefaultsEqualRuntime':True}
 return {'composeVersion':'5.1.0','services':result}

def git_files(prefix):
 names=run(['git','ls-tree','-r','--name-only','-z',BASE,'--',prefix]).decode().strip('\0').split('\0');need(names and all(OPS.L.safe_path(n)and n.startswith(prefix.rstrip('/')+'/')for n in names));return names

def container_files(cid,directory,names):
 need(type(names)is list and 0<len(names)<=5000 and len(names)==len(set(names))and all(OPS.L.safe_path(n)for n in names));blob=run(['docker','exec',cid,'tar','-C',directory,'-cf','-',*names]);result={};total=0
 with tarfile.open(fileobj=io.BytesIO(blob),mode='r:')as archive:
  for member in archive:
   name=member.name.rstrip('/');need(OPS.L.safe_path(name)and(member.isfile()or member.isdir()))
   if member.isdir():continue
   need(name not in result and member.size<=32*1024**2);total+=member.size;need(total<=128*1024**2);content=archive.extractfile(member).read();need(len(content)==member.size);result[name]=content
 need(set(result)==set(names));return result

def source_files(cid,prefix,predicate):
 paths=[name for name in git_files(prefix)if predicate(name[len(prefix)+1:])];need(paths);expected={name[len(prefix)+1:]:sha(run(['git','show',BASE+':'+name]))for name in paths};actual=container_files(cid,'/app',list(expected));need({name:sha(data)for name,data in actual.items()}==expected)
 return {'sourceFilesMatchBase':True,'sourceFileCount':len(expected),'sourceFileSHA256':expected}

def pocketbase_source(service,row):
 images=json.loads(run(['docker','image','inspect',row['image']]));need(len(images)==1 and images[0]['Id']==row['image']);revision=(images[0]['Config'].get('Labels')or{}).get('org.opencontainers.image.revision');need(type(revision)is str and re.fullmatch('[a-f0-9]{40}',revision));need(run(['git','rev-parse',revision+':'+FACTORY])==run(['git','rev-parse',BASE+':'+FACTORY]));paths=[name for name in git_files(FACTORY)if name.startswith(FACTORY+'/pb_hooks/')or name.startswith(FACTORY+'/pb_migrations/')];names=[n[len(FACTORY)+1:]for n in paths];actual=container_files(row['id'],'/pb',names);need(all(sha(actual[n[len(FACTORY)+1:]])==sha(run(['git','show',BASE+':'+n]))for n in paths));public=run(['docker','exec',row['id'],'tar','-C','/pb','-cf','-','pb_public']);files={};total=0
 with tarfile.open(fileobj=io.BytesIO(public),mode='r:')as archive:
  for member in archive:
   name=member.name.rstrip('/');need(OPS.L.safe_path(name)and name.startswith('pb_public')and(member.isfile()or member.isdir()))
   if member.isdir():continue
   total+=member.size;need(total<=32*1024**2 and member.size<=16*1024**2 and name not in files);content=archive.extractfile(member).read();need(len(content)==member.size);files[name]={'bytes':member.size,'sha256':sha(content)}
   if name=='pb_public/index.html':OPS.L.private_write(OUT/(service+'-index.private.html'),content)
 need('pb_public/index.html'in files and any(n.startswith('pb_public/assets/')for n in files));return {'ociRevision':revision,'applicationTree':run(['git','rev-parse',BASE+':'+FACTORY]).decode().strip(),'hooksAndMigrationsMatchBase':True,'sourceFileCount':len(paths),'publicFiles':files}

def qc_api_source(row):
 names=[name for name in git_files(QC+'/server/QcInspection.Api')if name.endswith('.cs')and'/obj/'not in name and'/bin/'not in name];expected={name[len(QC)+1:]:sha(run(['git','show',BASE+':'+name]))for name in names};actual=container_files(row['id'],'/app',['QcInspection.Api.dll','QcInspection.Api.pdb']);identifier,documents=PDB.pdb_documents(actual['QcInspection.Api.pdb']);need(identifier==PDB.codeview_ids(actual['QcInspection.Api.dll']));matched=set()
 for name,checksum in expected.items():
  matches=[path for path,value in documents.items()if(path==name or path.endswith('/'+name))and value==checksum];need(len(matches)==1);matched.add(matches[0])
 generated={'QcInspection.Api.GlobalUsings.g.cs','QcInspection.Api.AssemblyInfo.cs','.NETCoreApp,Version=v8.0.AssemblyAttributes.cs','QcInspection.Api.MvcApplicationPartsAssemblyInfo.cs'}
 for path in set(documents)-matched:need(any(path.endswith('/server/QcInspection.Api/obj/Release/net8.0/'+name)for name in generated))
 return {'codeViewMatchesPortablePdb':True,'allNonGeneratedCSharpDocumentsMatchBase':True,'sourceDocumentCount':len(expected),'sourceDocumentSHA256':expected,'dllSHA256':sha(actual['QcInspection.Api.dll']),'pdbSHA256':sha(actual['QcInspection.Api.pdb'])}

def source_proof(runtime):
 rows=runtime['targets'];proof={service:pocketbase_source(service,rows[service])for service in('factory-review','factory-review-test')};proof['qc-plan-api']=qc_api_source(rows['qc-plan-api']);proof['qc-plan-web']=source_files(rows['qc-plan-web']['id'],QC,lambda n:n.startswith('app/')or n in{'package.json','pnpm-lock.yaml','pnpm-workspace.yaml','next.config.mjs','postcss.config.mjs','tailwind.config.ts','tsconfig.json','.eslintrc.json'});proof['printlink']=source_files(rows['printlink']['id'],PRINT,lambda n:n in{'package.json','start.mjs'}or(n.startswith(('cloud/','production/','ops/','shared/'))and not n.startswith('production/tests/')));proof['internal-quote']=source_files(rows['internal-quote']['id'],QUOTE,lambda n:(n.startswith('backend/')and not n.startswith(('backend/data/','backend/uploads/')))or n.startswith('frontend/'));proof['zuru-order-system']=source_files(rows['zuru-order-system']['id'],ZURU,lambda n:n in{'app.py','po_parser.py','requirements.txt'}or n.startswith(('templates/','static/')));need(set(proof)==SERVICES);return proof

def qc_startup_facts(path):
 with contextlib.closing(OPS.L.connect(path,True))as db:
  counts={
   'mappingRestorationFlagRows':db.execute("SELECT COUNT(*) FROM SchemaChanges WHERE Name='restore-workshop-mappings'").fetchone()[0],
   'emptyPlanIds':db.execute("SELECT COUNT(*) FROM InspectionRecords WHERE PlanId='' ").fetchone()[0],
   'pendingStatusRowsWhoseOldStartupWouldChange':db.execute("SELECT COUNT(*) FROM InspectionRecords WHERE WorkflowStatus='待验货' AND (InternalResult IN ('不用验','待复检','REJ','HOLD','PASS','AOD','LG','AOD+LG') OR ThirdPartyResult IN ('不用验','待复检','REJ','HOLD','PASS','AOD','LG','AOD+LG'))").fetchone()[0],
   'completedRowsWhoseOldStartupWouldReset':db.execute("SELECT COUNT(*) FROM InspectionRecords WHERE WorkflowStatus='已完成' AND TRIM(InternalResult) IN ('','Pending','需要验货','还需要验货','NA') AND TRIM(ThirdPartyResult) IN ('','Pending','需要验货','还需要验货','NA')").fetchone()[0],
   'completedImportBatchesWhoseOldStartupWouldRepair':db.execute("SELECT COUNT(*) FROM ScheduleImportBatches WHERE Status='已完成' AND ImportRange='' AND ConfirmedAt IS NOT NULL").fetchone()[0],
   'legacyAdminRoles':db.execute("SELECT COUNT(*) FROM Users WHERE Role='Admin'").fetchone()[0],
   'userCount':db.execute('SELECT COUNT(*) FROM Users').fetchone()[0]}
  counts['existingStartupLogicallyNoOp']=counts['mappingRestorationFlagRows']==1 and counts['userCount']>0 and all(value==0 for key,value in counts.items()if key not in{'mappingRestorationFlagRows','userCount'})
  return counts

def printlink_startup_facts(cloud_path,production_path):
 cutoff=(datetime.datetime.now(datetime.timezone.utc)-datetime.timedelta(hours=24)).isoformat(timespec='milliseconds').replace('+00:00','Z');facts={'expiredUploadCutoffUTC':cutoff}
 with contextlib.closing(OPS.L.connect(cloud_path,True))as db:
  facts['userCount']=db.execute('SELECT COUNT(*) FROM users').fetchone()[0];row=db.execute("SELECT value FROM metadata WHERE key='mode'").fetchone();facts['existingModeIsProduction']=row==('production',);facts['expiredUnattachedUploadCandidates']=db.execute('SELECT COUNT(*) FROM files WHERE order_id IS NULL AND created < ?',(cutoff,)).fetchone()[0];facts['unsyncedJobCandidates']=db.execute('SELECT COUNT(*) FROM production_jobs WHERE synced=0').fetchone()[0];facts['legacyQualityStageMigrationCandidates']=db.execute("SELECT COUNT(*) FROM production_jobs j JOIN orders o ON o.id=j.order_id WHERE j.status='待质检' AND o.status IN ('打印中','待交付')").fetchone()[0]
 with contextlib.closing(OPS.L.connect(production_path,True))as db:
  row=db.execute('SELECT value FROM snapshot WHERE id=1').fetchone();facts['snapshotRowExists']=row is not None;missing=0;valid=False
  if row is not None:
   try:
    value=json.loads(row[0]);valid=type(value)is dict and type(value.get('records',{}))is dict
    if valid:
     for day in value.get('records',{}).values():
      if type(day)is not dict or type(day.get('items',[]))is not list:valid=False;break
      for item in day.get('items',[]):
       if type(item)is not dict:valid=False;break
       missing+=int(not item.get('_id')or not item.get('_updatedAt'))
   except BaseException:valid=False
  facts['snapshotShapeValid']=valid;facts['recordItemsMissingExistingIdentityOrTimestamp']=missing;facts['sourceInventoryConfigRowExists']=db.execute('SELECT COUNT(*) FROM source_inventory_config WHERE id=1').fetchone()[0]==1;table=db.execute("SELECT COUNT(*) FROM sqlite_schema WHERE type='table' AND name='authority_state'").fetchone()[0];facts['authorityStateTableAlreadyExists']=bool(table);enabled=False;statevalid=True
  if table:
   row=db.execute('SELECT value FROM authority_state WHERE id=1').fetchone()
   if row is not None:
    try:state=json.loads(row[0]);statevalid=type(state)is dict;enabled=not(statevalid and('enabled'not in state or state['enabled']is False))
    except BaseException:statevalid=False;enabled=True
  facts['authorityDisabled']=not enabled and statevalid
 facts['existingStartupLogicallyNoOp']=facts['userCount']>0 and facts['existingModeIsProduction']and facts['snapshotRowExists']and facts['snapshotShapeValid']and facts['sourceInventoryConfigRowExists']and facts['authorityDisabled']and all(facts[key]==0 for key in('expiredUnattachedUploadCandidates','unsyncedJobCandidates','legacyQualityStageMigrationCandidates','recordItemsMissingExistingIdentityOrTimestamp'))
 return facts

def mapping_facts(path):
 result={}
 for name in('country_map.json','ignore_items.json','item_map.json'):
  file=path/name;need(file.is_file()and not file.is_symlink()and file.stat().st_size<=8*1024**2);content=file.read_bytes();value=json.loads(content);need(type(value)in{dict,list});baseline=run(['git','show',BASE+':'+ZURU+'/data/'+name]);result[name]={'sha256':sha(content),'entries':len(value),'kind':'object'if type(value)is dict else'array','bytesEqualBaseTrackedFile':content==baseline,'canonicalJSONSHA256':sha(enc(value))}
 return result

def startup_checks(roots,environment,dbid):
 sql='BEGIN READ ONLY; SET LOCAL statement_timeout=\'30s\'; '+READONLY.startup_checks_sql()+'; COMMIT;\n';value=json.loads(run(['docker','exec','-i',dbid,'sh','-c',PG_SHELL],sql.encode(),45));checks=READONLY.startup_safety_checks(value);result={'quoteExistingStartupLogicallyNoOp':all(ok for ok,_ in checks),'quoteChecks':value,'pocketbaseConfiguredAdminsExist':True}
 for service in('factory-review','factory-review-test'):
  email=environment[service].get('FACTORY_REVIEW_ADMIN_EMAIL','').strip();password=environment[service].get('FACTORY_REVIEW_ADMIN_PASSWORD','');path=OUT/service/'sqlite/data.db'
  with contextlib.closing(OPS.L.connect(path,True))as db:exists=db.execute('SELECT COUNT(*) FROM users WHERE lower(email)=lower(?)',(email,)).fetchone()[0]==1
  result['pocketbaseConfiguredAdminsExist']&=bool(email and len(password)>=12 and exists)
 result['qcPlan']=qc_startup_facts(OUT/'qc-plan-data/sqlite/qc-inspection.db');result['printlink']=printlink_startup_facts(OUT/'printlink-runtime/sqlite/orders/printlink.sqlite',OUT/'printlink-runtime/sqlite/production.sqlite');result['zuruMappingFacts']=mapping_facts(roots['zuru-data']);result['allExistingStartupGuardsPassed']=result['quoteExistingStartupLogicallyNoOp']and result['pocketbaseConfiguredAdminsExist']and result['qcPlan']['existingStartupLogicallyNoOp']and result['printlink']['existingStartupLogicallyNoOp'];return result

def stable_environment_bytes(path):
 need(path.is_file()and not path.is_symlink())
 with os.fdopen(os.open(path,os.O_RDONLY|os.O_NOFOLLOW),'rb')as stream:
  before=os.fstat(stream.fileno());need(stat.S_ISREG(before.st_mode)and before.st_size<=4*1024**2);content=stream.read(4*1024**2+1);after=os.fstat(stream.fileno());key=lambda value:(value.st_dev,value.st_ino,value.st_mode,value.st_size,value.st_mtime_ns,value.st_ctime_ns);need(key(before)==key(after)==key(path.lstat())and len(content)==before.st_size)
 return content

def required_sqlite_databases(key,captured):
 required={'factory-review':{'data.db','auxiliary.db'},'factory-review-test':{'data.db','auxiliary.db'},'qc-plan-data':{'qc-inspection.db'},'printlink-runtime':{'production.sqlite','orders/printlink.sqlite'},'quote-legacy':{'data.db'}}
 need(key in STORAGE and type(captured)is dict and type(captured.get('sqlite'))is dict and required.get(key,set())<=set(captured['sqlite']))

def backup(result):
 global STAGE
 STAGE='source-and-protected-config';configuration=source();STAGE='four-existing-local-changes';dirty=dirty_snapshot(True);STAGE='maintenance-flags';maintenance=maintenance_inventory();STAGE='private-environment';env=ROOT/'.env.cloud.production';envbytes=stable_environment_bytes(env);envhash=sha(envbytes);OPS.L.private_write(OUT/'environment.private',envbytes);need(OPS.L.file_hash(OUT/'environment.private')==envhash);STAGE='all-runtime-and-storage';before,raw=runtime();OPS.L.private_write(OUT/'target-inspect.private.json',enc(raw));roots,mounts=storage_roots(raw);environment=storage_contract(raw,before['databaseContainer']);STAGE='exact-compose-environments';compose=compose_environment(raw)
 total=sum(path.stat().st_size for root in roots.values()for path in root.rglob('*')if path.is_file());pgbytes=int(run(['docker','exec','-i',before['databaseContainer'],'sh','-c',PG_SHELL],b"BEGIN READ ONLY; SELECT COALESCE(sum(pg_total_relation_size(c.oid)),0) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='internal_quote'; COMMIT;\n",45));need(pgbytes>=0 and shutil.disk_usage(OUT).free>3*(total+pgbytes)+2*1024**3);captured={}
 for key,path in roots.items():
  STAGE=key+'-all-sqlite-and-file-bytes';captured[key]=OPS.sqlite_capture(key,path,OUT/key);required_sqlite_databases(key,captured[key])
  # Immutable old SQLite databases are also preserved as exact original bytes.
  if key=='quote-legacy':captured[key]['completeRawFileInventory']=OPS.L.non_database_inventory(path,[],OUT/'quote-legacy-raw.tar')
 STAGE='startup-safety';startup=startup_checks(roots,environment,before['databaseContainer']);STAGE='quote-exported-snapshot-and-dump';postgres=OPS.pg_capture(before['databaseContainer'],OUT,True)['internal_quote'];STAGE='all-actual-runtime-source-proofs';proof=source_proof(before)
 STAGE='final-storage-file-stability'
 for key,path in roots.items():
  need(OPS.L.non_database_inventory(path,list(captured[key]['sqlite']))==captured[key]['files'])
  if key=='quote-legacy':need(OPS.L.non_database_inventory(path,[])==captured[key]['completeRawFileInventory'])
 STAGE='final-source-runtime-config-stability';after,afterraw=runtime();need(before==after  and source()==configuration and dirty_snapshot()==dirty and OPS.L.file_hash(env)==envhash and maintenance_inventory()==maintenance)
 baseline={'head':BASE,'runtime':before,'configuration':configuration,'environmentSHA256':envhash,'preexistingFourDirty':dirty,'maintenanceInventory':maintenance,'composeEnvironmentProof':compose,'storageMounts':mounts,'storage':captured,'postgres':postgres,'sourceProof':proof,'startupChecks':startup};OPS.L.private_write(OUT/'baseline.private.json',enc(baseline));result.update(backupComplete=True,allSevenTargetServicesBound=True,allPersistentMountsCaptured=True,portableSQLiteCount=sum(len(value['sqlite'])for value in captured.values()),allOriginalFullTypedRowsAndSchemaCaptured=True,allImagesAttachmentsPermissionsAndPrivateConfigFilesArchived=True,allRuntimeSourceProofsMatchBase=True,composeVersionAndLiteralRuntimeEnvironmentsProven=True,privateEnvironmentFileBackedUp=True,fourExistingTrackedChangesPreserved=True,allOtherContainersUnchanged=True,allMaintenanceFlagsUnchanged=True,startupSafetyPassed=startup['allExistingStartupGuardsPassed'],startupGuardSummary={key:value for key,value in startup.items()if key not in{'quoteChecks','zuruMappingFacts'}},databaseSnapshotsIndividuallyConsistentNotCrossDatabaseAtomic=True,quoteExportedSnapshotAndDumpConsistent=True,quoteSequenceStatesIndependentlyBracketedNonMVCC=True,success=True)

def main():
 global OPS,READONLY,PDB
 need(len(sys.argv)==2 and sys.argv[1]=='backup'and BACKUP_PIN and os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_ATTEMPT')=='1');os.umask(0o077);OPS=load('release-data-ops-library.py');OPS.L=OPS.load_library(pathlib.Path(__file__).with_name('release-data-library.py'));READONLY=load('internal-quote-readonly-library.py');PDB=load('portable-pdb-library.py');OPS.SCHEMAS=('internal_quote',);OPS.NEW_COLUMNS={};OUT.mkdir(mode=0o700);OPS.run=run;READONLY.run=run
 def stop(*_):need(False)
 signal.signal(signal.SIGTERM,stop);result={'mode':'backup','base':BASE,'success':False,'backupComplete':False,'businessWritesPerformed':False,'credentialsOrConfigurationChanged':False,'containerOrServiceSignalsPerformed':False,'liveHTTPOrAuthenticationRequestsPerformed':False,'secretOrBusinessRowsPrinted':False,'automaticRollbackOrRestorePerformed':False}
 try:backup(result)
 except BaseException:result['failedStage']=STAGE
 finally:OPS.L.private_write(OUT/'first-result.json',enc(result));OPS.L.seal(OUT);print(enc(dict(result,manifestSHA256=OPS.L.file_hash(OUT/'manifest.json'),resultSHA256=OPS.L.file_hash(OUT/'first-result.json'))).decode(),flush=True)
 return 0 if result['success']else 1
if __name__=='__main__':
 try:code=main()
 except BaseException:print('{"success":false,"safeFailure":"BATCH_961_965_BACKUP_PREFLIGHT_FAILED"}',flush=True);code=1
 sys.exit(code)
