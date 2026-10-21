"""Read-only scoped backup/common for PR969/970/972/974; all execution gates false.
No health/login/business HTTP, migration, maintenance changes or container signals.
Store snapshots individually consistent; no cross-store atomic claim.
"""
import contextlib,datetime,hashlib,importlib.util,io,json,os,pathlib,re,shutil,signal,sqlite3,stat,subprocess,sys,tarfile,traceback,urllib.parse
ROOT=pathlib.Path('/opt/rr-portal');BASE='7ce02db904cdd769ecd35148d50be15ec4fce210'
BRANCH='refs/heads/ops/batch-969-970-972-974-20261021';BACKUP_PIN=False
OUT=ROOT/'deploy/backups/batch-969-970-972-974-20261021-backup'
DEPENDENCIES={'release-data-ops-library.py':'ff9138a1d5bfed1b10077112da6ebcda2d65240f583e2d0e12ce1325cfbaafd5','release-data-library.py':'d63168fd3057f4f2aba2d93f9fab31d2d65c6dd0f3234877d71fcff1e04e62b9','internal-quote-readonly-library.py':'be4f901f3444154e5de06766a2d8a0801dba9b847a4ac25f34a84ccebe354e69','portable-pdb-library.py':'cf66f655a1e166491c4da67da0824f42ac8cdae3f844044cb5d8f7233ba105c5'}
QC='apps/QA部/QC成品报告系统';TOY='apps/QA部/玩具质量管理系统';INDO='apps/印尼小组/印尼走货明细';QUOTE='apps/业务部/内部报价系统'
APP_PREFIXES=(QC,TOY,INDO,QUOTE);SERVICES={'qc-report','toyqms','indo-shipping','internal-quote'}
STORAGE={'qc-report-data':('qc-report',QC+'/data','/app/data',True),'qc-report-storage':('qc-report',QC+'/storage','/app/storage',True),'toyqms':('toyqms',TOY+'/server-data','/app/data',True),'quote-legacy':('internal-quote',QUOTE+'/backend/data','/app/backend/legacy-data',False),'quote-uploads':('internal-quote',QUOTE+'/backend/uploads','/app/backend/uploads',True)}
FIXED=('docker-compose.cloud.yml','nginx/nginx.cloud.conf','deploy/update-server.sh','deploy/service-maintenance.sh','.github/workflows/deploy.yml',*(p+'/'+n for p in APP_PREFIXES for n in ('Dockerfile','.dockerignore')))
MAINTENANCE_ALIASES=SERVICES;STAGE='entrypoint';COUNTER=0;OPS=None;READONLY=None;PDB=None
PG_SHELL='exec psql -X -q -At -v ON_ERROR_STOP=1 -U "${POSTGRES_USER:-rrportal}" -d "${POSTGRES_DB:-rrportal}"'

def need(value,code=None):
 if not value:raise RuntimeError('BATCH_969_974_BACKUP_REJECTED')

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

def git_files(prefix,revision=None):
 names=run(['git','ls-tree','-r','--name-only','-z',revision or BASE,'--',prefix]).decode().strip('\0').split('\0');need(names and all(OPS.L.safe_path(n)and n.startswith(prefix.rstrip('/')+'/')for n in names));return names

def stable_environment_bytes(path):
 need(path.is_file()and not path.is_symlink())
 with os.fdopen(os.open(path,os.O_RDONLY|os.O_NOFOLLOW),'rb')as stream:
  before=os.fstat(stream.fileno());need(stat.S_ISREG(before.st_mode)and before.st_size<=4*1024**2);content=stream.read(4*1024**2+1);after=os.fstat(stream.fileno());key=lambda value:(value.st_dev,value.st_ino,value.st_mode,value.st_size,value.st_mtime_ns,value.st_ctime_ns);need(key(before)==key(after)==key(path.lstat())and len(content)==before.st_size)
 return content

def stable_file_metadata(path):
 need(path.is_file()and not path.is_symlink())
 before=path.lstat();need(stat.S_ISREG(before.st_mode));checksum=OPS.L.file_hash(path);after=path.lstat()
 key=lambda value:(value.st_dev,value.st_ino,value.st_mode,value.st_uid,value.st_gid,value.st_size,value.st_mtime_ns,value.st_ctime_ns)
 need(key(before)==key(after))
 return {'sha256':checksum,'mode':stat.S_IMODE(before.st_mode),'bytes':before.st_size,'uid':before.st_uid,'gid':before.st_gid}

def maintenance_inventory():
 path=ROOT/'deploy/maintenance';need(path.is_dir()and not path.is_symlink())
 for service in MAINTENANCE_ALIASES:need(not(path/'services'/service).exists()and not(path/'services'/service).is_symlink())
 return OPS.L.non_database_inventory(path,[])

def source():
 need(run(['git','symbolic-ref','--quiet','HEAD']).decode().strip()=='refs/heads/main'and run(['git','rev-parse','HEAD']).decode().strip()==BASE)
 for prefix in APP_PREFIXES:run(['git','diff','--quiet','--no-ext-diff','--no-textconv','--ignore-submodules=none','--',prefix])
 result={}
 for name in FIXED:
  path=ROOT/name;need(path.is_file()and not path.is_symlink()and path.read_bytes()==run(['git','show',BASE+':'+name]));result[name]=OPS.L.file_hash(path)
 return result

def dirty_snapshot(save=False):
 run(['git','diff','--cached','--quiet','--no-ext-diff','--no-textconv','--ignore-submodules=none'])
 raw=run(['git','diff','--name-only','-z','--no-ext-diff','--no-textconv','--ignore-submodules=none']).decode();names=raw.rstrip('\0').split('\0')if raw else[];need(len(names)==len(set(names))==4);rows={};overlap=[]
 for index,name in enumerate(sorted(names)):
  need(OPS.L.safe_path(name));entry=run(['git','ls-tree','-z',BASE,'--',name]).split(b'\t',1);need(len(entry)==2 and entry[1]==name.encode()+b'\0'and re.fullmatch(b'100(?:644|755) blob [a-f0-9]{40}',entry[0]));path=ROOT/name
  for ancestor in(path,*path.parents):
   if ancestor==ROOT:break
   need(not ancestor.is_symlink())
  if not path.exists():rows[name]={'kind':'absent'}
  else:
   rows[name]=dict(stable_file_metadata(path),kind='regular');need(rows[name]['bytes']<=8*1024**2)
   if save:
    data=stable_environment_bytes(path)if rows[name]['bytes']<=4*1024**2 else path.read_bytes();need(sha(data)==rows[name]['sha256']);OPS.L.private_write(OUT/('dirty-%02d.private'%index),data)
  if name in FIXED or any(name==p or name.startswith(p+'/')for p in APP_PREFIXES):overlap.append(name)
 need(sum(row.get('bytes',0)for row in rows.values())<=16*1024**2)
 if save:OPS.L.private_write(OUT/'dirty-inventory.private.json',enc({'files':rows,'targetOverlapPaths':overlap}))
 if overlap:
  global DIRTY_OVERLAP
  DIRTY_OVERLAP=overlap;need(False)
 return rows

def runtime():
 ids=run(['docker','ps','-aq','--no-trunc']).decode().split();need(0<len(ids)<=1000 and len(ids)==len(set(ids))and all(re.fullmatch('[a-f0-9]{64}',v)for v in ids));records=json.loads(run(['docker','inspect',*ids]));need(type(records)is list and len(records)==len(ids));targets={};others={};raw={};db=None;worker=None
 for record in records:
  cid=record['Id'];need(cid in ids and cid not in raw);raw[cid]=record;labels=record.get('Config',{}).get('Labels')or{};service=labels.get('com.docker.compose.service')if labels.get('com.docker.compose.project')=='rr-portal'else None;environment=envmap(record['Config']['Env']);state=record['State']
  row={'id':cid,'image':record['Image'],'started':state.get('StartedAt'),'running':state['Running'],'oom':state['OOMKilled'],'restarts':record['RestartCount'],'health':state.get('Health',{}).get('Status'),'environmentMapSHA256':sha(enc(environment)),'mounts':sorted(record.get('Mounts',[]),key=enc),'memory':record['HostConfig'].get('Memory'),'swap':record['HostConfig'].get('MemorySwap'),'healthcheck':record['Config'].get('Healthcheck'),'command':record['Config'].get('Cmd'),'entrypoint':record['Config'].get('Entrypoint'),'user':record['Config'].get('User'),'workingDirectory':record['Config'].get('WorkingDir'),'configSHA256':sha(enc(dict(record['Config'],Env=sorted(record['Config']['Env'])))),'hostConfigSHA256':sha(enc(record['HostConfig'])),'networkSettingsSHA256':sha(enc(record.get('NetworkSettings',{})))}
  if service=='db':need(db is None and row['running']is True and row['health']=='healthy');db=cid
  if service=='qc-report-worker':need(worker is None and row['running']is True and row['health']=='healthy'and row['oom']is False);worker=cid
  if service in SERVICES or service=='qc-report-worker':
   proc=run(['docker','exec',cid,'cat','/proc/1/environ']);need(proc.endswith(b'\0'));processenv=envmap([v.decode()for v in proc.split(b'\0')if v]);need(record['Config'].get('Hostname')==cid[:12]and processenv.pop('HOSTNAME',None)==cid[:12]);row['processEnvironmentWithoutAutomaticHostnameSHA256']=sha(enc(processenv))
  if service not in SERVICES:others[cid]=row;continue
  need(service not in targets and row['running']is True and row['oom']is False and row['health']=='healthy');targets[service]=row
 need(set(targets)==SERVICES and db is not None and worker is not None)
 need(sorted(raw[worker].get('Mounts',[]),key=enc)==targets['qc-report']['mounts'])
 return {'targets':targets,'others':others,'databaseContainer':db,'qcReportWorker':worker},{s:raw[v['id']]for s,v in targets.items()}

def storage_roots(raw):
 roots={};mounts={}
 for key,(service,relative,destination,rw)in STORAGE.items():
  found=[m for m in raw[service].get('Mounts',[])if m.get('Destination')==destination];need(len(found)==1);m=found[0];p=pathlib.Path(m['Source']);need(m.get('Type')=='bind'and m.get('RW')is rw and p==ROOT/relative and p.is_dir()and all(not a.is_symlink()for a in(p,*p.parents)));roots[key]=p;mounts[key]=m
 need(len(set(roots.values()))==len(roots))
 for service in SERVICES:need(len(raw[service].get('Mounts',[]))==sum(spec[0]==service for spec in STORAGE.values()))
 return roots,mounts

def storage_contract(raw,dbid):
 environment={s:envmap(r['Config']['Env'])for s,r in raw.items()};db=json.loads(run(['docker','inspect',dbid]));need(len(db)==1 and db[0]['Id']==dbid);d=envmap(db[0]['Config']['Env']);database=d.get('POSTGRES_DB')or'rrportal';user=d.get('POSTGRES_USER')or'rrportal';q=environment['internal-quote'];u=urllib.parse.urlsplit(q.get('DATABASE_URL',''))
 need(q.get('DB_DRIVER')!='sqlite'and q.get('DB_SCHEMA')=='internal_quote'and u.scheme in{'postgres','postgresql'}and u.hostname=='db'and(u.port or 5432)==5432 and urllib.parse.unquote(u.path)=='/'+database and urllib.parse.unquote(u.username or'')==user and urllib.parse.unquote(u.password or'')==d.get('POSTGRES_PASSWORD','')and not u.query and not u.fragment and q.get('LEGACY_SQLITE_FILE')=='/app/backend/legacy-data/data.db')
 i=environment['indo-shipping'];need(i.get('DB_NAME')==database and i.get('DB_USER')==user and i.get('DB_PASSWORD')==d.get('POSTGRES_PASSWORD',''))
 c=environment['qc-report'];need(c.get('DATABASE_URL')=='sqlite:////app/data/qc-report.db'and c.get('STORAGE_ROOT')=='/app/storage'and c.get('PROXY_PREFIX')=='/qc-report'and c.get('SESSION_COOKIE_PATH')=='/qc-report/')
 need(environment['toyqms'].get('TOYQMS_DATA_DIR')=='/app/data'and environment['toyqms'].get('TOYQMS_STATIC_DIR')=='/app/out');return environment

def compose_environment(raw):
 need(run(['docker','compose','version','--short']).decode().strip()=='5.1.0');config=json.loads(run(['docker','compose','-p','rr-portal','-f',str(ROOT/'docker-compose.cloud.yml'),'--env-file',str(ROOT/'.env.cloud.production'),'config','--format','json'],timeout=90));need(type(config)is dict and type(config.get('services'))is dict);OPS.L.private_write(OUT/'compose-render.private.json',enc(config));result={}
 for service in sorted(SERVICES):
  record=raw[service];images=json.loads(run(['docker','image','inspect',record['Image']]));need(len(images)==1 and images[0]['Id']==record['Image']);image=images[0];actual=envmap(record['Config']['Env']);defaults=envmap(image['Config'].get('Env')or[]);declared=config['services'][service].get('environment',{});need(type(declared)is dict and all(type(k)is str and type(v)is str for k,v in declared.items()))
  literal={k:v for k,v in actual.items()if k in declared or defaults.get(k)!=v};expected=dict(defaults);expected.update(literal);need(expected==actual);serialized=serialized_environment(literal);difference=sorted(k for k in set(serialized)|set(declared)if serialized.get(k)!=declared.get(k));need(len(difference)<=100)
  proc=run(['docker','exec',record['Id'],'cat','/proc/1/environ']);need(proc.endswith(b'\0'));pm=envmap([v.decode()for v in proc.split(b'\0')if v]);need(pm.pop('HOSTNAME',None)==record['Id'][:12])
  for suffix,data in [('image',image),('compose-environment',declared),('literal-compose-environment',literal),('literal-configured-environment',actual),('literal-process-environment',pm)]:OPS.L.private_write(OUT/(service+'-'+suffix+'.private.json'),enc(data))
  result[service]={'configuredEnvironmentKeys':sorted(actual),'serializedDeclaredDifferenceKeys':difference,'actualConfiguredSHA256':sha(enc(actual)),'actualProcessWithoutAutomaticHostnameSHA256':sha(enc(pm)),'literalExplicitAndImageDefaultsEqualRuntime':True,'forwardSerializedLiteralEqualsComposeJSON':serialized==declared}
 return {'composeVersion':'5.1.0','services':result}

def container_files(cid,directory,names,candidate=False):
 need(type(names)is list and 0<len(names)<=10000 and len(names)==len(set(names))and all(OPS.L.safe_path(n)for n in names));need(not candidate or re.fullmatch('sha256:[a-f0-9]{64}',cid));command=['docker','run','--rm','--network','none','--read-only','--log-driver','none','--user','0','--entrypoint','tar',cid]if candidate else['docker','exec','--user','0',cid,'tar'];blob=run([*command,'-C',directory,'-cf','-',*names]);OPS.L.private_write(OUT/('runtime-source-'+cid[:12]+'-'+str(COUNTER)+'.private.tar'),blob);result={};seen=set();total=0
 with tarfile.open(fileobj=io.BytesIO(blob),mode='r:')as archive:
  for member in archive:
   name=member.name.rstrip('/');need(OPS.L.safe_path(name)and name not in seen and(member.isfile()or member.isdir())and any(name==n or name.startswith(n+'/')for n in names));seen.add(name)
   if member.isdir():continue
   need(member.size<=32*1024**2);total+=member.size;need(total<=128*1024**2);content=archive.extractfile(member).read();need(len(content)==member.size);result[name]=content
 need(all(n in seen for n in names));return result

def file_proof(row,prefix,names,expected_filter=lambda n:True,compiled_prefix=None,revision=None,candidate=False):
 actual=container_files(row['id'],'/app',names,candidate);expected={n[len(prefix)+1:]:sha(run(['git','show',(revision or BASE)+':'+n]))for n in git_files(prefix,revision)if expected_filter(n[len(prefix)+1:])};source={n:sha(b)for n,b in actual.items()if not compiled_prefix or not n.startswith(compiled_prefix+'/')};different=sorted(n for n in set(expected)|set(source)if expected.get(n)!=source.get(n));result={'reviewedSourceMatch':not different,'sourceFileCount':len(expected),'differentPaths':different,'sourceFileSHA256':source,'expectedSourceFileSHA256':expected}
 if compiled_prefix:
  compiled={n:{'sha256':sha(b),'bytes':len(b)}for n,b in actual.items()if n.startswith(compiled_prefix+'/')};need(compiled_prefix+'/index.html'in compiled);result.update(compiledArtifactInventory=compiled,compiledArtifactInventorySHA256=sha(enc(compiled)),compiledSourceNotDirectlyPresentInRuntime=True)
 return result

def service_source_proof(service,row,revision=None,candidate=False):
 revision=revision or BASE;need(re.fullmatch('[a-f0-9]{40}',revision))
 if service=='qc-report':
  files={'app.py','ai_service.py','pdf_service.py','task_queue.py','unified_pdf.py','worker.py','requirements.txt','alembic.ini'};dirs=('migrations/','templates/','static/','assets/');return file_proof(row,QC,[*sorted(files),'migrations','templates','static','assets'],lambda n:n in files or n.startswith(dirs),revision=revision,candidate=candidate)
 if service=='toyqms':
  chosen=lambda n:n.startswith('server/')and not any(x in pathlib.PurePosixPath(n).parts for x in('node_modules','test','tests','data','__pycache__'))
  names=[n[len(TOY)+1:]for n in git_files(TOY,revision)if chosen(n[len(TOY)+1:])];return file_proof(row,TOY,names+['out'],chosen,'out',revision,candidate)
 if service=='internal-quote':
  READONLY.ROOT=ROOT;READONLY.APP_ROOT=ROOT/QUOTE;READONLY.APP_PREFIX=QUOTE+'/';proof={}if candidate else READONLY.source_runtime_files(row['id'],revision);paths=[n[len(QUOTE)+1:]for n in git_files(QUOTE,revision)if(n.startswith(QUOTE+'/backend/')or n.startswith(QUOTE+'/frontend/'))and'/data/'not in n and'/uploads/'not in n];result=file_proof(row,QUOTE,paths,lambda n:(n.startswith('backend/')or n.startswith('frontend/'))and'/data/'not in n and'/uploads/'not in n,revision=revision,candidate=candidate);return dict(result,**proof)
 need(service=='indo-shipping');names=[p for project in('IndoShipping.Api','IndoShipping.Domain','IndoShipping.Infrastructure')for p in(project+'.dll',project+'.pdb')];actual=container_files(row['id'],'/app',names+['wwwroot','db/postgres_schema.sql','seed/hs-dictionary.json'],candidate);proof={}
 for project in('IndoShipping.Api','IndoShipping.Domain','IndoShipping.Infrastructure'):
  docs={n[len(INDO)+1:]:sha(run(['git','show',revision+':'+n]))for n in git_files(INDO+'/src/'+project,revision)if n.endswith('.cs')and'/obj/'not in n and'/bin/'not in n};proof[project]=PDB.prove(actual[project+'.dll'],actual[project+'.pdb'],docs)
 copied={n:sha(actual[n])==sha(run(['git','show',revision+':'+INDO+'/'+n]))for n in('db/postgres_schema.sql','seed/hs-dictionary.json')};assets={n:{'bytes':len(b),'sha256':sha(b)}for n,b in actual.items()if n.startswith('wwwroot/')};need('wwwroot/index.html'in assets);return {'reviewedSourceMatch':all(copied.values()),'projects':proof,'copiedRuntimeDataFilesMatchBase':copied,'compiledArtifactInventory':assets,'compiledArtifactInventorySHA256':sha(enc(assets)),'compiledSourceNotDirectlyPresentInRuntime':True}

def source_proof(runtime):
 global STAGE
 result={}
 for service,row in sorted(runtime['targets'].items()):STAGE='actual-runtime-source-'+service;result[service]=service_source_proof(service,row)
 return result

def candidate_source_proof(service,imageid,revision=None):
 return service_source_proof(service,{'id':imageid},revision,candidate=True)

def file_metadata(path):
 need(path.is_file()and not path.is_symlink());s=path.stat();return {'mode':stat.S_IMODE(s.st_mode),'uid':s.st_uid,'gid':s.st_gid}

def capture_storage(roots):
 global STAGE
 result={}
 for key,path in roots.items():
  STAGE='sqlite-and-files-'+key;result[key]=OPS.sqlite_capture(key,path,OUT/key);result[key]['originalSQLiteMetadata']={n:file_metadata(path/n)for n in result[key]['sqlite']}
  if key=='quote-legacy':need('data.db'in result[key]['sqlite']);result[key]['completeRawFileInventory']=OPS.L.non_database_inventory(path,[],OUT/'quote-legacy-raw.private.tar')
 need('qc-report-data'not in result or'qc-report.db'in result['qc-report-data']['sqlite']);need('toyqms'not in result or'toyqms.db'in result['toyqms']['sqlite']);return result

def indo_startup_guard(cid,dbid):
 cmd=['docker','exec','-i',dbid,'sh','-c','exec psql -X -q -At -v ON_ERROR_STOP=1 -U "${POSTGRES_USER:-rrportal}" -d "${POSTGRES_DB:-rrportal}"']
 tables=json.loads(run(cmd,b"BEGIN READ ONLY; SELECT COALESCE(json_agg(table_name ORDER BY table_name),'[]') FROM information_schema.tables WHERE table_schema='indo_shipping' AND table_type='BASE TABLE'; COMMIT;\n"));required={'Users','settings','schedules','material_tracking_history','purchase_orders','po_items','po_receipts','outbound','shipments','shipment_items','images','materials','dict_supplier','dict_translation','tool_materials','__rr_seed_history'};need(required<=set(tables))
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
 checks=json.loads(run(cmd,query.encode(),45));need(type(checks)is dict and all(type(v)is bool for v in checks.values()))
 # Build never copies business-data.json; refuse any runtime override or preexisting unexpected payload.
 raw=run(['docker','exec',cid,'sh','-c','if [ -e /app/seed/business-data.json ]; then echo present; else echo absent; fi']).decode().strip();need(raw=='absent');checks['businessSeedAbsent']=True
 return checks


def quote_startup_checks(dbid):
 sql="BEGIN READ ONLY; SET LOCAL statement_timeout='30s'; "+READONLY.startup_checks_sql()+"; COMMIT;\n";facts=json.loads(run(['docker','exec','-i',dbid,'sh','-c',PG_SHELL],sql.encode(),45));checks=READONLY.startup_safety_checks(facts);extra=int(run(['docker','exec','-i',dbid,'sh','-c',PG_SHELL],b"BEGIN READ ONLY; SELECT COUNT(*) FROM(VALUES('qingxi'),('heyuan'))f(code) WHERE NOT EXISTS(SELECT 1 FROM internal_quote.factory_ref_tables r WHERE r.factory_code=f.code AND r.key='costing_basis'); COMMIT;\n",45));need(extra>=0);checks.append((extra==0,'startupWouldChange:missingFactoryCostingBasis'));return {'allExistingStartupGuardsPassed':all(ok for ok,_ in checks),'checks':{label:ok for ok,label in checks},'facts':dict(facts,missingFactoryCostingBasis=extra)}

def postgres_capture(dbid,directory,with_dump):
 need(OPS.SCHEMAS==('indo_shipping','internal_quote')and OPS.NEW_COLUMNS=={});return OPS.pg_capture(dbid,directory,with_dump)

def postgres_identical(before,after):
 return set(before)==set(after)=={'indo_shipping','internal_quote'}and all(before[s]['tables']==after[s]['tables']and before[s]['schema']==after[s]['schema']and before[s]['sequenceStates']==after[s]['sequenceStates']and before[s]['sequenceStateStableDuringCapture']is True and after[s]['sequenceStateStableDuringCapture']is True for s in before)

def backup(result):
 global STAGE
 STAGE='four-dirty-preservation';dirty=dirty_snapshot(True);STAGE='source-config';configuration=source();STAGE='maintenance';maintenance=maintenance_inventory();STAGE='environment';env=ROOT/'.env.cloud.production';envbytes=stable_environment_bytes(env);envmeta=stable_file_metadata(env);OPS.L.private_write(OUT/'environment.private',envbytes)
 STAGE='runtime-mounts';before,raw=runtime();OPS.L.private_write(OUT/'target-inspect.private.json',enc(raw));roots,mounts=storage_roots(raw);environment=storage_contract(raw,before['databaseContainer']);STAGE='literal-environment-proof';compose=compose_environment(raw);proof=source_proof(before)
 total=sum(p.stat().st_size for root in roots.values()for p in root.rglob('*')if p.is_file());need(shutil.disk_usage(OUT).free>3*total+2*1024**3);captured=capture_storage(roots);STAGE='quote-startup-guards';startup=quote_startup_checks(before['databaseContainer']);startup['indoChecks']=indo_startup_guard(before['targets']['indo-shipping']['id'],before['databaseContainer']);startup['allExistingStartupGuardsPassed']=startup['allExistingStartupGuardsPassed']and all(startup['indoChecks'].values());STAGE='consistent-postgres-two-schemas';postgres=postgres_capture(before['databaseContainer'],OUT,True)
 STAGE='final-file-stability'
 for key,path in roots.items():
  need(OPS.L.non_database_inventory(path,list(captured[key]['sqlite']))==captured[key]['files'])
  for name,metadata in captured[key]['originalSQLiteMetadata'].items():need(file_metadata(path/name)=={k:metadata[k]for k in('mode','uid','gid')})
  if key=='quote-legacy':need(OPS.L.non_database_inventory(path,[])==captured[key]['completeRawFileInventory'])
 STAGE='source-runtime-config-stability';after,_=runtime();need(before==after and source()==configuration and dirty_snapshot()==dirty and stable_file_metadata(env)==envmeta and maintenance_inventory()==maintenance)
 baseline={'head':BASE,'runtime':before,'configuration':configuration,'environmentSHA256':sha(envbytes),'environmentFileMetadata':envmeta,'preexistingFourDirty':dirty,'maintenanceInventory':maintenance,'composeEnvironmentProof':compose,'storageMounts':mounts,'storage':captured,'postgres':postgres,'sourceProof':proof,'startupChecks':startup};OPS.L.private_write(OUT/'baseline.private.json',enc(baseline))
 result.update(success=True,backupComplete=True,allFourTargetServicesBound=True,qcReportWorkerUnchangedAndSharesBothMounts=True,allPersistentMountsCaptured=True,portableSQLiteCount=sum(len(v['sqlite'])for v in captured.values()),postgresSchemasCaptured=sorted(postgres),allOriginalFullTypedRowsAndSchemaCaptured=True,privateEnvironmentFileBackedUp=True,fourExistingTrackedChangesPreserved=True,allOtherContainersUnchanged=True,allMaintenanceFlagsUnchanged=True,startupSafetyPassed=startup['allExistingStartupGuardsPassed'],sourceComparison={s:{'reviewedSourceMatch':p['reviewedSourceMatch'],'differentPaths':p.get('differentPaths',[])[:20],'differentPathCount':len(p.get('differentPaths',[])),'compiledAssetsCaptured':bool(p.get('compiledArtifactInventory'))}for s,p in proof.items()},environmentLiteralSerializedDifferenceCounts={s:len(p['serializedDeclaredDifferenceKeys'])for s,p in compose['services'].items()},databaseSnapshotsIndividuallyConsistentNotCrossDatabaseAtomic=True,postgresExportedSnapshotAndDumpConsistent=True,postgresSequenceStatesIndependentlyBracketedNonMVCC=True)

def initialize():
 global OPS,READONLY,PDB
 OPS=load('release-data-ops-library.py');OPS.L=OPS.load_library(pathlib.Path(__file__).with_name('release-data-library.py'));READONLY=load('internal-quote-readonly-library.py');PDB=load('portable-pdb-library.py');OPS.SCHEMAS=('indo_shipping','internal_quote');OPS.NEW_COLUMNS={};OPS.ROOT=ROOT;OPS.run=run;READONLY.run=run

def main():
 need(len(sys.argv)==2 and sys.argv[1]=='backup'and BACKUP_PIN and os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_ATTEMPT')=='1');os.umask(0o077);initialize();OUT.mkdir(mode=0o700)
 def stop(*_):need(False)
 signal.signal(signal.SIGTERM,stop);result={'mode':'backup','base':BASE,'success':False,'backupComplete':False,'businessWritesPerformed':False,'credentialsOrConfigurationChanged':False,'containerOrServiceSignalsPerformed':False,'liveHTTPOrAuthenticationRequestsPerformed':False,'secretOrBusinessRowsPrinted':False,'automaticRollbackOrRestorePerformed':False}
 try:backup(result)
 except BaseException as error:
  result.update(failedStage=STAGE,safeExceptionType=type(error).__name__,safeTracebackFrames=[{'file':pathlib.Path(f.filename).name,'function':f.name,'line':f.lineno}for f in traceback.extract_tb(error.__traceback__)[-10:]],dirtyTargetOverlapPaths=globals().get('DIRTY_OVERLAP',[]));OPS.L.private_write(OUT/'failure-traceback.private.txt',traceback.format_exc().encode())
 finally:
  OPS.L.private_write(OUT/'first-result.json',enc(result));OPS.L.seal(OUT);safe=dict(result,manifestSHA256=OPS.L.file_hash(OUT/'manifest.json'),resultSHA256=OPS.L.file_hash(OUT/'first-result.json'));need(len(enc(safe))<24000);print(enc(safe).decode(),flush=True)
 return 0 if result['success']else 1

if __name__=='__main__':
 try:code=main()
 except BaseException:print('{"success":false,"safeFailure":"BATCH_969_974_BACKUP_PREFLIGHT_FAILED"}',flush=True);code=1
 sys.exit(code)
