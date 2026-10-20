"""Batch960/966/967/968 private backup/common core. Frozen execution gates false.
No HTTP, mutations, authentication, restart, restore, configuration or maintenance.
SQLite copies individually consistent; PostgreSQL exported snapshot+dump coherent;
sequences independently bracketed, never claimed cross-store atomic.
"""
import contextlib,datetime,decimal,hashlib,importlib.util,io,json,os,pathlib,re,shutil,signal,sqlite3,stat,subprocess,sys,tarfile,traceback,urllib.parse
ROOT=pathlib.Path('/opt/rr-portal');BASE='4f1f64cac098caa6b202eb27cae9ab8fad9109dd'
BRANCH='refs/heads/ops/batch-960-966-967-968-20261020';BACKUP_PIN=True
OUT=ROOT/'deploy/backups/batch-960-966-967-968-20261020-backup-02'
DEPENDENCIES={'release-data-ops-library.py':'ff9138a1d5bfed1b10077112da6ebcda2d65240f583e2d0e12ce1325cfbaafd5','release-data-library.py':'d63168fd3057f4f2aba2d93f9fab31d2d65c6dd0f3234877d71fcff1e04e62b9','internal-quote-readonly-library.py':'be4f901f3444154e5de06766a2d8a0801dba9b847a4ac25f34a84ccebe354e69','portable-pdb-library.py':'cf66f655a1e166491c4da67da0824f42ac8cdae3f844044cb5d8f7233ba105c5'}
RR='apps/工程部/工程啤办单';QC='apps/生产部/品质管理系统';QUOTE='apps/业务部/内部报价系统';VOY='apps/船务部/VoyagePlex船务协同系统'
APP_PREFIXES=(RR,QC,QUOTE,VOY)
SERVICES={'rr-production','qc','internal-quote','voyageplex-api','voyageplex-web','voyageplex-parser'}
STORAGE={'rr-data':('rr-production',RR+'/data','/app/data',True),'qc':('qc',QC+'/data','/app/data',True),'voyageplex-data':('voyageplex-api',VOY+'/data-runtime','/app/data',True),'quote-legacy':('internal-quote',QUOTE+'/backend/data','/app/backend/legacy-data',False),'quote-uploads':('internal-quote',QUOTE+'/backend/uploads','/app/backend/uploads',True)}
FIXED=('docker-compose.cloud.yml','nginx/nginx.cloud.conf','deploy/update-server.sh','deploy/service-maintenance.sh','.github/workflows/deploy.yml',RR+'/Dockerfile.node',RR+'/.dockerignore',QC+'/Dockerfile',QC+'/.dockerignore',QUOTE+'/Dockerfile',QUOTE+'/.dockerignore',VOY+'/Dockerfile.api',VOY+'/Dockerfile.web',VOY+'/.dockerignore',VOY+'/docker-entrypoint-web.sh',VOY+'/services/email-parser/Dockerfile',VOY+'/services/email-parser/requirements.txt')
QC_COMPANIES={'dg-xingxin','dg-huadeng-a','dg-huadeng-b','dg-huajia','hy-huakang-a','hy-huakang-b','hy-huakang-c','hy-huakang-d','hy-huadeng','hy-huaxing','sy-huadeng','sy-xingxin','xs-huadeng'}
MAINTENANCE_ALIASES={'rr-production','qc','internal-quote','voyageplex'}
STAGE='entrypoint';COUNTER=0;OPS=None;READONLY=None;PDB=None
PG_SHELL='exec psql -X -q -At -v ON_ERROR_STOP=1 -U "${POSTGRES_USER:-rrportal}" -d "${POSTGRES_DB:-rrportal}"'


def need(value):
 if not value:raise RuntimeError('BATCH_960_968_BACKUP_REJECTED')

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
 for service in MAINTENANCE_ALIASES:need(not(path/'services'/service).exists()and not(path/'services'/service).is_symlink())
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

def git_files(prefix):
 names=run(['git','ls-tree','-r','--name-only','-z',BASE,'--',prefix]).decode().strip('\0').split('\0');need(names and all(OPS.L.safe_path(n)and n.startswith(prefix.rstrip('/')+'/')for n in names));return names

def container_files(cid,directory,names):
 need(type(names)is list and 0<len(names)<=5000 and len(names)==len(set(names))and all(OPS.L.safe_path(n)for n in names));blob=run(['docker','exec',cid,'tar','-C',directory,'-cf','-',*names]);OPS.L.private_write(OUT/('runtime-source-'+cid[:12]+'-'+str(COUNTER)+'.private.tar'),blob);result={};total=0
 with tarfile.open(fileobj=io.BytesIO(blob),mode='r:')as archive:
  for member in archive:
   name=member.name.rstrip('/');need(OPS.L.safe_path(name)and(member.isfile()or member.isdir()))
   if member.isdir():continue
   need(name not in result and member.size<=32*1024**2);total+=member.size;need(total<=128*1024**2);content=archive.extractfile(member).read();need(len(content)==member.size);result[name]=content
 need(set(result)==set(names));return result

def stable_environment_bytes(path):
 need(path.is_file()and not path.is_symlink())
 with os.fdopen(os.open(path,os.O_RDONLY|os.O_NOFOLLOW),'rb')as stream:
  before=os.fstat(stream.fileno());need(stat.S_ISREG(before.st_mode)and before.st_size<=4*1024**2);content=stream.read(4*1024**2+1);after=os.fstat(stream.fileno());key=lambda value:(value.st_dev,value.st_ino,value.st_mode,value.st_size,value.st_mtime_ns,value.st_ctime_ns);need(key(before)==key(after)==key(path.lstat())and len(content)==before.st_size)
 return content

def storage_roots(raw):
 roots={};mounts={}
 for key,(service,relative,destination,rw)in STORAGE.items():
  found=[m for m in raw[service].get('Mounts',[])if m.get('Destination')==destination];need(len(found)==1);mount=found[0];path=pathlib.Path(mount['Source']);need(mount.get('RW')is rw and mount.get('Type')=='bind'and path==ROOT/relative and path.is_dir())
  for ancestor in(path,*path.parents):need(not ancestor.is_symlink())
  roots[key]=path;mounts[key]=mount
 need(len(set(roots.values()))==len(roots))
 for service in SERVICES:
  expected=[value for value in mounts.values()if value in raw[service].get('Mounts',[])]
  if service=='voyageplex-web':need(raw[service].get('Mounts',[])==raw['voyageplex-api'].get('Mounts',[]))
  else:need(len(raw[service].get('Mounts',[]))==sum(spec[0]==service for spec in STORAGE.values()))
 return roots,mounts

def storage_contract(raw,dbid):
 environment={service:envmap(record['Config']['Env'])for service,record in raw.items()};db=json.loads(run(['docker','inspect',dbid]));need(len(db)==1 and db[0]['Id']==dbid);db_env=envmap(db[0]['Config']['Env']);database=db_env.get('POSTGRES_DB')or'rrportal';user=db_env.get('POSTGRES_USER')or'rrportal';quote=environment['internal-quote'];url=urllib.parse.urlsplit(quote.get('DATABASE_URL',''))
 need(quote.get('DB_DRIVER')!='sqlite'and quote.get('DB_SCHEMA')=='internal_quote'and url.scheme in{'postgres','postgresql'}and url.hostname=='db'and(url.port or 5432)==5432 and urllib.parse.unquote(url.path)=='/'+database and urllib.parse.unquote(url.username or'')==user and urllib.parse.unquote(url.password or'')==db_env.get('POSTGRES_PASSWORD','')and not url.query and not url.fragment and quote.get('LEGACY_SQLITE_FILE')=='/app/backend/legacy-data/data.db')
 need(environment['qc'].get('DATA_PATH')=='/app/data'and environment['voyageplex-api'].get('ConnectionStrings__Default')=='Data Source=/app/data/voyageplex.db')
 need(raw['rr-production']['Config'].get('User')=='0:0'and environment['rr-production'].get('DATA_PATH')in{None,'/app/data'})
 return environment

def compose_environment(raw):
 need(run(['docker','compose','version','--short']).decode().strip()=='5.1.0');config=json.loads(run(['docker','compose','-p','rr-portal','-f',str(ROOT/'docker-compose.cloud.yml'),'--env-file',str(ROOT/'.env.cloud.production'),'config','--format','json'],timeout=90));need(type(config)is dict and type(config.get('services'))is dict);result={}
 for service in sorted(SERVICES):
  record=raw[service];images=json.loads(run(['docker','image','inspect',record['Image']]));need(len(images)==1 and images[0]['Id']==record['Image']);image=images[0];actual=envmap(record['Config']['Env']);defaults=envmap(image['Config'].get('Env')or[]);declared=config['services'][service].get('environment',{});need(type(declared)is dict and set(declared)<=set(actual)and all(type(k)is str and type(v)is str for k,v in declared.items()))
  literal={k:v for k,v in actual.items()if k in declared or defaults.get(k)!=v};expected=dict(defaults);expected.update(literal);need(expected==actual)
  serialized=serialized_environment(literal);difference=sorted(k for k in set(serialized)|set(declared)if serialized.get(k)!=declared.get(k));need(len(difference)<=20)
  OPS.L.private_write(OUT/(service+'-image.private.json'),enc(image));OPS.L.private_write(OUT/(service+'-compose-environment.private.json'),enc(declared));OPS.L.private_write(OUT/(service+'-literal-compose-environment.private.json'),enc(literal))
  result[service]={'serializedExplicitEnvironmentSHA256':sha(enc(declared)),'literalExplicitEnvironmentSHA256':sha(enc(literal)),'forwardSerializedLiteralEqualsComposeJSON':serialized==declared,'literalExplicitAndImageDefaultsEqualRuntime':True,'serializedDeclaredDifferenceKeys':difference}
 return {'composeVersion':'5.1.0','services':result}

def simple_source_proof(row,prefix,predicate):
 paths=[name for name in git_files(prefix)if predicate(name[len(prefix)+1:])];need(paths);expected={name[len(prefix)+1:]:sha(run(['git','show',BASE+':'+name]))for name in paths};actual={name:sha(data)for name,data in container_files(row['id'],'/app',list(expected)).items()}
 return {'reviewedSourceMatch':actual==expected,'sourceFileCount':len(expected),'sourceFileSHA256':actual,'expectedSourceFileSHA256':expected,'differentPaths':[n for n in expected if actual.get(n)!=expected[n]]}

def api_pdb_source(row):
 names=[name for name in git_files(VOY+'/server/VoyagePlex.Api')if name.endswith('.cs')and'/obj/'not in name and'/bin/'not in name];expected={name[len(VOY)+1:]:sha(run(['git','show',BASE+':'+name]))for name in names};actual=container_files(row['id'],'/app',['VoyagePlex.Api.dll','VoyagePlex.Api.pdb']);identifier,documents=PDB.pdb_documents(actual['VoyagePlex.Api.pdb']);need(identifier==PDB.codeview_ids(actual['VoyagePlex.Api.dll']));matched={};different=[]
 for name,checksum in expected.items():
  matches=[(p,h)for p,h in documents.items()if p==name or p.endswith('/'+name)]
  if len(matches)!=1 or matches[0][1]!=checksum:different.append(name)
  if len(matches)==1:matched[matches[0][0]]=matches[0][1]
 generated={'VoyagePlex.Api.GlobalUsings.g.cs','VoyagePlex.Api.AssemblyInfo.cs','.NETCoreApp,Version=v8.0.AssemblyAttributes.cs','VoyagePlex.Api.MvcApplicationPartsAssemblyInfo.cs'}
 unknown=[p for p in set(documents)-set(matched)if not any(p.endswith('/server/VoyagePlex.Api/obj/Release/net8.0/'+n)for n in generated)]
 return {'reviewedSourceMatch':not different and not unknown,'codeViewMatchesPortablePdb':True,'sourceFileCount':len(expected),'sourceFileSHA256':matched,'expectedSourceFileSHA256':expected,'differentPaths':different,'unmatchedDocumentCount':len(unknown),'dllSHA256':sha(actual['VoyagePlex.Api.dll']),'pdbSHA256':sha(actual['VoyagePlex.Api.pdb'])}

WEB_ARTIFACT_CODE="""const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');let result={},count=0,total=0;function walk(base,rel=''){for(const name of fs.readdirSync(path.join(base,rel)).sort()){if(!rel&&name==='cache')continue;const n=path.join(rel,name),p=path.join(base,n),s=fs.lstatSync(p);if(s.isSymbolicLink())throw Error('symlink');if(s.isDirectory())walk(base,n);else{if(!s.isFile()||++count>10000||(total+=s.size)>512*1024*1024)throw Error('bound');result[n]={bytes:s.size,sha256:crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')};}}}walk('/app/.next-build');console.log(JSON.stringify(result));"""
def web_artifact_script():return WEB_ARTIFACT_CODE

def service_source_proof(service,row):
 if service=='rr-production':return simple_source_proof(row,RR,lambda n:n=='server.js'or n.startswith('public/')or n in{'package.json','package-lock.json'}or n.startswith('scripts/')or n=='monthly.js')
 if service=='qc':return simple_source_proof(row,QC,lambda n:n.startswith('server/')and not n.startswith(('server/data/','server/node_modules/'))or n in{'app.js','report_export.js','index.html','style.css'})
 if service=='internal-quote':return simple_source_proof(row,QUOTE,lambda n:(n.startswith('backend/')and not n.startswith(('backend/data/','backend/uploads/')))or n.startswith('frontend/'))
 if service=='voyageplex-parser':return simple_source_proof(row,VOY+'/services/email-parser',lambda n:n=='requirements.txt'or n.startswith('app/'))
 if service=='voyageplex-api':return api_pdb_source(row)
 need(service=='voyageplex-web');artifacts=json.loads(run(['docker','exec',row['id'],'node','-e',WEB_ARTIFACT_CODE]));need(type(artifacts)is dict and'BUILD_ID'in artifacts and len(artifacts)<=10000 and all(OPS.L.safe_path(n)for n in artifacts));compiled=run(['docker','exec',row['id'],'tar','-C','/app','--exclude=.next-build/cache','-cf','-','.next-build']);OPS.L.private_write(OUT/('runtime-web-compiled-'+str(COUNTER)+'.private.tar'),compiled);actual=container_files(row['id'],'/app',['next.config.mjs','package.json']);return {'reviewedSourceMatch':None,'typescriptSourceNotPresentInRuntimeImage':True,'compiledArtifactCount':len(artifacts),'compiledArtifactInventorySHA256':sha(enc(artifacts)),'buildIdFileSHA256':artifacts['BUILD_ID']['sha256'],'runtimeFiles':{n:sha(b)for n,b in actual.items()},'compiledArtifacts':artifacts}

def source_proof(runtime):return {service:service_source_proof(service,row)for service,row in runtime['targets'].items()}

# Exact five filename identities observed by the reviewed read-only probe.
# Source SQLite is never opened for historical bundles, including their SHM/WAL.
HISTORY_IDENTITIES={
 '719f0f6a4e23034af8e676cba421b706dc61618240cbf05d1d196ea6b5a51b46':268800000,
 '892d92465db87df7df32d4574d5e8412c5db4c32731b21ad4b86200ce75c2927':268484608,
 '3804771313fe486e62e0e876644284a1eb6cebf41ad81af445bf90cc484c5266':268800000,
 '5ede5e80ba1a2bce622dddfaef1c8b0133dbc5608d0451dff31b822db859e1e9':268800000,
 '86172cfa565a74eb844e0b94ec968511e8687bb2e99114d4f7993da3a723f124':268800000,
}

def stable_file_metadata(path):
 need(path.is_file()and not path.is_symlink())
 before=path.lstat();need(stat.S_ISREG(before.st_mode));checksum=OPS.L.file_hash(path);after=path.lstat()
 key=lambda value:(value.st_dev,value.st_ino,value.st_mode,value.st_uid,value.st_gid,value.st_size,value.st_mtime_ns,value.st_ctime_ns)
 need(key(before)==key(after))
 return {'sha256':checksum,'mode':stat.S_IMODE(before.st_mode),'bytes':before.st_size,'uid':before.st_uid,'gid':before.st_gid}

def voyage_inventory(root):
 names=OPS.database_names(root);need('voyageplex.db'in names);historical={};identities=set()
 for name in names:
  if name=='voyageplex.db':continue
  match=re.fullmatch(r'voyageplex\.db\.before-(company|daily-mail|personal-mail)-([0-9]{14})-[a-f0-9]{32}\.db',name);identity=sha(name.encode());need(match is not None and identity in HISTORY_IDENTITIES)
  stamp=datetime.datetime.strptime(match[2],'%Y%m%d%H%M%S');need(stamp.strftime('%Y%m%d%H%M%S')==match[2]);path=root/name;metadata=stable_file_metadata(path);need(metadata['bytes']==HISTORY_IDENTITIES[identity]);companions={}
  for suffix in('-wal','-shm','-journal'):
   companion=path.with_name(path.name+suffix);need(not companion.is_symlink());exists=companion.exists();companions[suffix]={'exists':exists}
   # Exact observed source bundle shape: retain 32KiB SHM and empty WAL as raw
   # bytes; never checkpoint, truncate, unlink, chmod, or open source SQLite.
   need(exists==(suffix in{'-wal','-shm'}))
   if exists:
    detail=stable_file_metadata(companion);need(detail['bytes']==(32768 if suffix=='-shm'else 0));companions[suffix].update(detail)
  historical[name]=dict(metadata,companions=companions,onlineHistoricalSQLiteOpened=False);identities.add(identity)
 need(identities==set(HISTORY_IDENTITIES));return historical

def capture_storage(roots):
 global STAGE
 captured={};original_databases=OPS.L.databases
 try:
  for key,path in roots.items():
   STAGE='capture-'+key+'-sqlite-and-file-bytes'
   if key=='voyageplex-data':
    historical=voyage_inventory(path);OPS.L.databases=lambda root:['voyageplex.db']if root==path else OPS.database_names(root)
    dest=OUT/key;dest.mkdir(mode=0o700);copies=dest/'sqlite';copies.mkdir(mode=0o700)
    captured[key]={'sqlite':OPS.L.snapshots(path,copies),'files':OPS.L.non_database_inventory(path,['voyageplex.db'],dest/'files.tar')}
   else:
    OPS.L.databases=OPS.database_names;captured[key]=OPS.sqlite_capture(key,path,OUT/key)
   captured[key]['originalSQLiteMetadata']={name:{'mode':stat.S_IMODE((path/name).stat().st_mode),'uid':(path/name).stat().st_uid,'gid':(path/name).stat().st_gid}for name in captured[key]['sqlite']}
   if key=='qc':need({company+'/qc.db'for company in QC_COMPANIES}<=set(captured[key]['sqlite']))
   if key=='voyageplex-data':need(set(captured[key]['sqlite'])=={'voyageplex.db'}and voyage_inventory(path)==historical);captured[key]['historicalSQLite']=historical
   if key=='quote-legacy':need('data.db'in captured[key]['sqlite']);captured[key]['completeRawFileInventory']=OPS.L.non_database_inventory(path,[],OUT/'quote-legacy-raw.tar')
 finally:OPS.L.databases=original_databases
 return captured

def engineering_plan(data):
 need(type(data)is dict and all(k not in data or type(data[k])is list for k in('assembly_orders','assembly_items')));next=json.loads(json.dumps(data,ensure_ascii=False,allow_nan=False));receipt={'renamed':0,'unquoted':0,'preservedAmbiguous':0}
 def missing(value):return value is None or type(value)is str and not value.strip()
 for order in next.get('assembly_orders',[]):
  need(type(order)is dict)
  if order.get('status')=='待报价':order['status']='未报价';receipt['renamed']+=1
  elif order.get('status')=='待审核':
   items=[v for v in next.get('assembly_items',[])if type(v)is dict and type(v.get('order_id'))is type(order.get('id'))and v.get('order_id')==order.get('id')]
   if items and all(missing(v.get('price'))and missing(v.get('completion_time'))for v in items):order['status']='未报价';receipt['unquoted']+=1
   elif not items or any(missing(v.get('price'))for v in items):receipt['preservedAmbiguous']+=1
 return next,receipt

def startup_checks(roots,environment,dbid):
 raw=(roots['rr-data']/'data.json').read_bytes();need(len(raw)<=128*1024**2);data=json.loads(raw);OPS.L.private_write(OUT/'engineering-data.private.json',raw);expected,migration=engineering_plan(data);OPS.L.private_write(OUT/'engineering-migrated-expected.private.json',enc(expected))
 native=run(['docker','exec','-i',json.loads((OUT/'target-inspect.private.json').read_bytes())['rr-production']['Id'],'node','-e',"let s='';process.stdin.setEncoding('utf8');process.stdin.on('data',v=>s+=v);process.stdin.on('end',()=>process.stdout.write(JSON.stringify(JSON.parse(s))));"],raw)
 precise=lambda value:json.loads(value,parse_float=decimal.Decimal,parse_int=decimal.Decimal);number_safe=precise(native)==precise(raw)
 pins=data.get('auth_pins',{});supervisors={'段新辉','唐海林','蒙海欢','万志勇','章发东','刘际维','甘勇辉','王玉国'};missingpins=sum(not pins.get('supervisors',{}).get(n)for n in supervisors)+sum(not pins.get('manager',{}).get(n)for n in{'易东存'})
 spray=0
 for order in data.get('spray_orders',[]):
  if order.get('status')!='已完成'or order.get('completed_date'):continue
  for item in data.get('spray_items',[]):
   if item.get('order_id')!=order.get('id'):continue
   if item.get('progress_at')or any(type(v)is dict and v.get('done_at')for v in(item.get('process_status')or{}).values()):spray+=1;break
 qc={}
 for company in sorted(QC_COMPANIES):
  with contextlib.closing(OPS.L.connect(OUT/'qc/sqlite'/company/'qc.db',True))as db:
   tables={r[0]for r in db.execute("SELECT name FROM sqlite_schema WHERE type='table'")};needed={'records','users','defect_library','partners','record_tombstones'};has_tables=needed<=tables;cols={table:{r[1]for r in db.execute('PRAGMA table_info('+OPS.L.quote(table)+')')}for table in needed&tables};has_columns={'name','dept','perms'}<=cols.get('users',set())and{'processType','status','reviewBy','reviewAt','rejectReason','rejectBy','rejectAt','aqlLevel'}<=cols.get('records',set());counts={table:db.execute('SELECT COUNT(*) FROM '+OPS.L.quote(table)).fetchone()[0]for table in needed&tables};qc[company]={'schemaAlreadyComplete':has_tables and has_columns,'users':counts.get('users',0),'defects':counts.get('defect_library',0),'records':counts.get('records',0)}
 with contextlib.closing(OPS.L.connect(OUT/'voyageplex-data/sqlite/voyageplex.db',True))as db:
  tables={r[0]for r in db.execute("SELECT name FROM sqlite_schema WHERE type='table'")};voy={'usersPresent':db.execute('SELECT COUNT(*) FROM Users').fetchone()[0]>0,'existingTables':sorted(tables),'mailContactsWillBeTouchedByExistingStartup':db.execute("SELECT COUNT(DISTINCT MailSender) FROM ImportEmailItems WHERE MailboxKey<>'' AND MailReceivedDate>=(SELECT StartDate FROM MailSystemSettings WHERE Id=1) AND MailSender<>''").fetchone()[0]};OPS.L.private_write(OUT/'voyageplex-schema.private.json',enc(OPS.L.audit(db)))
 web_seed=roots['voyageplex-data']/'inspection-mappings.json';voy['webExistingInspectionMappingsSeedNonempty']=web_seed.is_file()and web_seed.stat().st_size>0
 sql='BEGIN READ ONLY; SET LOCAL statement_timeout=\'30s\'; '+READONLY.startup_checks_sql()+'; COMMIT;\n';quote=json.loads(run(['docker','exec','-i',dbid,'sh','-c',PG_SHELL],sql.encode(),45));quote_checks=READONLY.startup_safety_checks(quote)
 safe=number_safe and missingpins==0 and spray==0 and all(v['schemaAlreadyComplete']and v['users']>0 and v['defects']>0 and(company!='dg-xingxin'or v['records']>0)for company,v in qc.items())and voy['usersPresent']and voy['webExistingInspectionMappingsSeedNonempty']and all(ok for ok,_ in quote_checks)
 return {'allExistingStartupGuardsPassed':safe,'engineering':{'migration':migration,'nativeJSONRoundtripPreservesAllNumericValues':number_safe,'missingExistingPins':missingpins,'historicalSprayDateBackfillCandidates':spray},'qc':qc,'voyageplex':voy,'quoteExistingStartupLogicallyNoOp':all(ok for ok,_ in quote_checks),'quoteChecks':quote}

FAILED_BACKUP=ROOT/'deploy/backups/batch-960-966-967-968-20261020-backup'
FAILED_MANIFEST='116609c0821c61aa0289a3cd5e38b6b212094d308ccfeeb46978eda6ec6bf389'
FAILED_RESULT='06289beea79f7a718f140ba23d76e061b2a9f2fa73fe2ac36d054f68d63544ee'

def failed_backup_evidence():
 path=FAILED_BACKUP;need(path.is_dir()and not path.is_symlink()and stat.S_IMODE(path.stat().st_mode)==0o700)
 need(OPS.L.file_hash(path/'manifest.json')==FAILED_MANIFEST and OPS.L.file_hash(path/'first-result.json')==FAILED_RESULT)
 manifest=json.loads((path/'manifest.json').read_bytes());entries=list(path.rglob('*'));need(len(entries)<=100000 and all(not p.is_symlink()and(p.is_file()or p.is_dir())and p.stat().st_mode&0o077==0 for p in entries));need(set(manifest)=={str(p.relative_to(path))for p in entries if p.is_file()and p!=path/'manifest.json'})
 need(all(OPS.L.safe_path(n)and re.fullmatch('[a-f0-9]{64}',h)and OPS.L.file_hash(path/n)==h for n,h in manifest.items()))
 receipt=json.loads((path/'first-result.json').read_bytes());need(receipt.get('success')is False and receipt.get('base')==BASE and receipt.get('failedStage')=='all-consistent-sqlite-and-files')
 return {'failedArchiveRetainedAndAllByteSealsVerified':True,'failedManifestSHA256':FAILED_MANIFEST,'failedResultSHA256':FAILED_RESULT,'reviewedReadOnlyProbeRun':39381115209,'historyPolicyLimitedToFiveObservedRawBundles':True}

def backup(result):
 global STAGE
 STAGE='prior-failed-archive-seals';prior=failed_backup_evidence();result['priorFailureEvidence']=prior
 STAGE='source-config';configuration=source();STAGE='four-dirty';dirty=dirty_snapshot(True);STAGE='maintenance';maintenance=maintenance_inventory();STAGE='environment';env=ROOT/'.env.cloud.production';envbytes=stable_environment_bytes(env);envhash=sha(envbytes);OPS.L.private_write(OUT/'environment.private',envbytes)
 STAGE='runtime-mounts';before,raw=runtime();OPS.L.private_write(OUT/'target-inspect.private.json',enc(raw));roots,mounts=storage_roots(raw);environment=storage_contract(raw,before['databaseContainer']);STAGE='literal-environment-proof';compose=compose_environment(raw)
 total=sum(p.stat().st_size for root in roots.values()for p in root.rglob('*')if p.is_file());need(shutil.disk_usage(OUT).free>3*total+3*1024**3)
 STAGE='all-consistent-sqlite-and-files';captured=capture_storage(roots);STAGE='startup-guards-and-migration-plan';startup=startup_checks(roots,environment,before['databaseContainer']);STAGE='consistent-postgres-snapshot-and-dump';postgres=OPS.pg_capture(before['databaseContainer'],OUT,True)['internal_quote'];STAGE='actual-runtime-source';proof=source_proof(before)
 STAGE='final-file-stability'
 for key,path in roots.items():
  need(OPS.L.non_database_inventory(path,list(captured[key]['sqlite']))==captured[key]['files'])
  if key=='quote-legacy':need(OPS.L.non_database_inventory(path,[])==captured[key]['completeRawFileInventory'])
 STAGE='source-runtime-config-stability';after,_=runtime();need(before==after and source()==configuration and dirty_snapshot()==dirty and OPS.L.file_hash(env)==envhash and maintenance_inventory()==maintenance)
 need(failed_backup_evidence()==prior)
 baseline={'head':BASE,'runtime':before,'configuration':configuration,'environmentSHA256':envhash,'preexistingFourDirty':dirty,'maintenanceInventory':maintenance,'composeEnvironmentProof':compose,'storageMounts':mounts,'storage':captured,'postgres':postgres,'sourceProof':proof,'startupChecks':startup};OPS.L.private_write(OUT/'baseline.private.json',enc(baseline))
 result.update(success=True,backupComplete=True,allSixTargetServicesBound=True,allPersistentMountsCaptured=True,portableSQLiteCount=sum(len(v['sqlite'])for v in captured.values()),qcCompanyDatabaseCount=len(QC_COMPANIES),allOriginalFullTypedRowsAndSchemaCaptured=True,privateEnvironmentFileBackedUp=True,fourExistingTrackedChangesPreserved=True,allOtherContainersUnchanged=True,allMaintenanceFlagsUnchanged=True,startupSafetyPassed=startup['allExistingStartupGuardsPassed'],engineeringMigration=startup['engineering'],voyageExistingMailContactStartupTouchGroups=startup['voyageplex']['mailContactsWillBeTouchedByExistingStartup'],sourceComparison={s:{'reviewedSourceMatch':p['reviewedSourceMatch'],'differentSourcePaths':p.get('differentPaths',[])[:12],'differentSourcePathCount':len(p.get('differentPaths',[])),'runtimeOnlyCompiledWebEvidence':s=='voyageplex-web'}for s,p in proof.items()},environmentLiteralSerializedDifferenceCounts={s:len(p['serializedDeclaredDifferenceKeys'])for s,p in compose['services'].items()},databaseSnapshotsIndividuallyConsistentNotCrossDatabaseAtomic=True,quoteExportedSnapshotAndDumpConsistent=True,quoteSequenceStatesIndependentlyBracketedNonMVCC=True)

def initialize():
 global OPS,READONLY,PDB
 OPS=load('release-data-ops-library.py');OPS.L=OPS.load_library(pathlib.Path(__file__).with_name('release-data-library.py'));READONLY=load('internal-quote-readonly-library.py');PDB=load('portable-pdb-library.py');OPS.SCHEMAS=('internal_quote',);OPS.NEW_COLUMNS={};OPS.run=run;READONLY.run=run

def main():
 need(len(sys.argv)==2 and sys.argv[1]=='backup'and BACKUP_PIN and os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_ATTEMPT')=='1');os.umask(0o077);initialize();OUT.mkdir(mode=0o700)
 def stop(*_):need(False)
 signal.signal(signal.SIGTERM,stop);result={'mode':'backup','base':BASE,'success':False,'backupComplete':False,'businessWritesPerformed':False,'credentialsOrConfigurationChanged':False,'containerOrServiceSignalsPerformed':False,'liveHTTPOrAuthenticationRequestsPerformed':False,'secretOrBusinessRowsPrinted':False,'automaticRollbackOrRestorePerformed':False}
 try:backup(result)
 except BaseException:
  result['failedStage']=STAGE
  OPS.L.private_write(OUT/'failure-traceback.private.txt',traceback.format_exc().encode())
 finally:
  OPS.L.private_write(OUT/'first-result.json',enc(result));OPS.L.seal(OUT);safe=dict(result,manifestSHA256=OPS.L.file_hash(OUT/'manifest.json'),resultSHA256=OPS.L.file_hash(OUT/'first-result.json'));need(len(enc(safe))<24000);print(enc(safe).decode(),flush=True)
 return 0 if result['success']else 1
if __name__=='__main__':
 try:code=main()
 except BaseException:print('{"success":false,"safeFailure":"BATCH_960_968_BACKUP_PREFLIGHT_FAILED"}',flush=True);code=1
 sys.exit(code)
