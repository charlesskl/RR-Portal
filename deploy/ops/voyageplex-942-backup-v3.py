"""PR942 VoyagePlex backup v3, exact sealed existing parser credential preserved. Draft gates false."""
import contextlib,datetime,hashlib,importlib.util,json,os,pathlib,re,shutil,signal,stat,subprocess,sys
ROOT=pathlib.Path('/opt/rr-portal');APP=ROOT/'apps/船务部/VoyagePlex船务协同系统';BASE='f32c9f00760e048a0846045a6d638290074b48d6'
BRANCH='refs/heads/ops/voyageplex-942-20261019';BACKUP_PIN=True;DEPLOY_PIN=False;VERIFY_PIN=False;TARGET='';TARGET_TREE='';REVIEWED_FILES={}
OUT=ROOT/'deploy/backups/voyageplex-942-20261019-backup-v3'
DEPENDENCIES={'release-data-ops-library.py':'ff9138a1d5bfed1b10077112da6ebcda2d65240f583e2d0e12ce1325cfbaafd5','release-data-library.py':'d63168fd3057f4f2aba2d93f9fab31d2d65c6dd0f3234877d71fcff1e04e62b9'}
STAGE='preflight';COUNTER=0;OPS=None
APP_PREFIX='apps/船务部/VoyagePlex船务协同系统/'
SERVICES=('voyageplex-api','voyageplex-parser','voyageplex-web')
DATA=APP/'data-runtime'
FIXED=('docker-compose.cloud.yml','deploy/service-maintenance.sh',APP_PREFIX+'Dockerfile.api',APP_PREFIX+'Dockerfile.web',APP_PREFIX+'.dockerignore',APP_PREFIX+'services/email-parser/Dockerfile',APP_PREFIX+'services/email-parser/requirements.txt')

def need(v):
 if not v:raise RuntimeError('VOYAGEPLEX_942_BACKUP_REJECTED')
def enc(v):return json.dumps(v,ensure_ascii=True,sort_keys=True,separators=(',',':'),allow_nan=False).encode()
def sha(v):return hashlib.sha256(v).hexdigest()
def load(name):
 p=pathlib.Path(__file__).with_name(name);need(p.is_file()and not p.is_symlink()and sha(p.read_bytes())==DEPENDENCIES[name]);spec=importlib.util.spec_from_file_location(name.replace('.','_'),p);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m

def run(args,data=None,timeout=180):
 global COUNTER
 COUNTER+=1
 with (OUT/('%03d-stderr.private'%COUNTER)).open('xb')as errors:p=subprocess.run(args,input=data,stdout=subprocess.PIPE,stderr=errors,timeout=timeout,cwd=ROOT)
 need(p.returncode==0 and len(p.stdout)<=32*1024**2);return p.stdout

def envmap(value):
 need(type(value)is list and len(value)<=1000);result={}
 for v in value:need(type(v)is str and'='in v);key,val=v.split('=',1);need(re.fullmatch('[A-Za-z_][A-Za-z0-9_]*',key)and key not in result);result[key]=val
 return result

def runtime():
 ids=run(['docker','ps','-aq','--no-trunc']).decode().split();need(0<len(ids)<=1000 and len(ids)==len(set(ids))and all(re.fullmatch('[a-f0-9]{64}',v)for v in ids));records=json.loads(run(['docker','inspect',*ids]));need(type(records)is list and len(records)==len(ids));others={};targets={};raw={}
 for r in records:
  cid=r['Id'];need(cid in ids and cid not in raw);raw[cid]=r;labels=r.get('Config',{}).get('Labels')or{};service=labels.get('com.docker.compose.service');role=service if labels.get('com.docker.compose.project')=='rr-portal'else None
  row={'id':cid,'image':r['Image'],'started':r['State'].get('StartedAt'),'running':r['State']['Running'],'oom':r['State']['OOMKilled'],'restarts':r['RestartCount'],'health':r['State'].get('Health',{}).get('Status'),'environmentMapSHA256':sha(enc(envmap(r['Config']['Env']))),'mounts':sorted(r.get('Mounts',[]),key=enc),'memory':r['HostConfig'].get('Memory'),'swap':r['HostConfig'].get('MemorySwap'),'healthcheck':r['Config'].get('Healthcheck'),'command':r['Config'].get('Cmd'),'entrypoint':r['Config'].get('Entrypoint'),'user':r['Config'].get('User'),'workingDirectory':r['Config'].get('WorkingDir')}
  if role not in SERVICES:others[cid]=row;continue
  need(role not in targets and row['running']is True and row['oom']is False and row['health']=='healthy')
  if role in {'voyageplex-api','voyageplex-web'}:
   matches=[m for m in row['mounts']if m.get('Destination')=='/app/data'];need(len(matches)==1 and matches[0].get('Type')=='bind'and matches[0].get('Source')==str(DATA)and matches[0].get('RW')is True)
  else:need(not row['mounts'])
  if role=='voyageplex-api':need(envmap(r['Config']['Env']).get('ConnectionStrings__Default')=='Data Source=/app/data/voyageplex.db')
  proc=run(['docker','exec',cid,'cat','/proc/1/environ']);need(proc.endswith(b'\0'));pm=envmap([v.decode()for v in proc.split(b'\0')if v]);need(r['Config'].get('Hostname')==cid[:12]and pm.pop('HOSTNAME',None)==cid[:12]);row['processEnvironmentWithoutAutomaticHostnameSHA256']=sha(enc(pm));targets[role]=row
 need(set(targets)==set(SERVICES));return {'targets':targets,'others':others},{k:raw[v['id']]for k,v in targets.items()}

def dirty_snapshot(save=False):
 run(['git','diff','--cached','--quiet','--no-ext-diff','--no-textconv','--ignore-submodules=none']);names=run(['git','diff','--name-only','-z','--no-ext-diff','--no-textconv','--ignore-submodules=none']).decode().strip('\0').split('\0');need(len(names)==len(set(names))==4);rows={}
 for i,n in enumerate(sorted(names)):
  need(OPS.L.safe_path(n)and not any(n==p or n.startswith(p+'/')for p in (APP_PREFIX.rstrip('/'),'apps/船务部','apps/工程部/3D打印协同平台'))and n not in FIXED)
  raw=run(['git','ls-tree','-z',BASE,'--',n]);parts=raw.split(b'\t',1);need(len(parts)==2 and parts[1]==n.encode()+b'\0'and re.fullmatch(b'100(?:644|755) blob [a-f0-9]{40}',parts[0]))
  p=ROOT/n
  for a in (p,*p.parents):
   if a==ROOT:break
   need(not a.is_symlink())
  if not p.exists():rows[n]={'kind':'absent'};continue
  fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW)
  with os.fdopen(fd,'rb')as f:
   a=os.fstat(f.fileno());need(stat.S_ISREG(a.st_mode)and a.st_size<=8*1024**2);content=f.read(8*1024**2+1);b=os.fstat(f.fileno());fields=lambda s:(s.st_dev,s.st_ino,s.st_mode,s.st_size,s.st_mtime_ns,s.st_ctime_ns);need(fields(a)==fields(b)==fields(p.lstat())and len(content)==a.st_size)
  rows[n]={'kind':'regular','bytes':len(content),'mode':stat.S_IMODE(a.st_mode),'sha256':sha(content)}
  if save:OPS.L.private_write(OUT/('dirty-%02d.private'%i),content)
 need(sum(v.get('bytes',0)for v in rows.values())<=16*1024**2);return rows

def source():
 need(run(['git','symbolic-ref','--quiet','HEAD']).decode().strip()=='refs/heads/main'and run(['git','rev-parse','HEAD']).decode().strip()==BASE)
 run(['git','diff','--quiet','--no-ext-diff','--no-textconv','--ignore-submodules=none','--',APP_PREFIX])
 for name in FIXED:
  p=ROOT/name;need(p.is_file()and not p.is_symlink()and p.read_bytes()==run(['git','show',BASE+':'+name]))
 return {n:OPS.L.file_hash(ROOT/n)for n in FIXED}

PRIOR=ROOT/'deploy/backups/voyageplex-942-20261019-backup'
DIAGNOSTIC=ROOT/'deploy/backups/voyageplex-942-20261019-inventory-diagnostic'
PRIOR_MANIFEST='aef2da0ea43012dcc021e5d386c30c32896c301b97a99ec61a342c9a0ae5cc02';PRIOR_RESULT='64f96f5681ce3834aad85faddd2dd7b442de5f1a4efb34e3db2bfa88f9989d8e'
DIAGNOSTIC_MANIFEST='e42d329dae69e868be9aefbc11abf47477454f73306a6382dde783aa7462e60a';DIAGNOSTIC_RESULT='808f1d036c9a6428ca734b2f082c2488c36440aa5ebc358efd867cad293f8beb'
HISTORY_NAMES=None

def prior_archive(path,msha,rsha):
 need(path.is_dir()and not path.is_symlink()and stat.S_IMODE(path.stat().st_mode)==0o700 and OPS.L.file_hash(path/'manifest.json')==msha and OPS.L.file_hash(path/'first-result.json')==rsha);manifest=json.loads((path/'manifest.json').read_bytes());entries=list(path.rglob('*'));need(len(entries)<=10000 and all(not p.is_symlink()and(p.is_file()or p.is_dir())and p.stat().st_mode&0o077==0 for p in entries));need(set(manifest)=={str(p.relative_to(path))for p in entries if p.is_file()and p!=path/'manifest.json'})
 for name,value in manifest.items():need(OPS.L.safe_path(name)and re.fullmatch('[a-f0-9]{64}',value)and OPS.L.file_hash(path/name)==value)
 return json.loads((path/'first-result.json').read_bytes())
def prior_evidence_v2():
 global HISTORY_NAMES
 first=prior_archive(PRIOR,PRIOR_MANIFEST,PRIOR_RESULT);need(first.get('success')is False and first.get('backupComplete')is False and first.get('base')==BASE and first.get('failedStage')=='sqlite-file-inventory')
 report=prior_archive(DIAGNOSTIC,DIAGNOSTIC_MANIFEST,DIAGNOSTIC_RESULT);need(report.get('success')is True and report.get('diagnosticCompleted')is True and report.get('originalFailurePreserved')is True and report.get('base')==BASE and report.get('rejectingEntryCount')==5 and report.get('rejectionReasonCounts')=={'known-history-companion-not-empty-regular':5}and report.get('historicalMetadataUnstableCount')==0)
 rows=json.loads((DIAGNOSTIC/'entry-classification.private.json').read_bytes());need(type(rows)is list and len(rows)<=100000);history={}
 for row in rows:
  if row.get('category')not in {'known-history-company','known-history-daily-mail','known-history-personal-mail'}:continue
  name=row.get('path');need(type(name)is str and re.fullmatch(r'voyageplex\.db\.before-(company|daily-mail|personal-mail)-[0-9]{14}-[a-f0-9]{32}\.db',name)and name not in history and row.get('sqliteHeader')is True and row.get('timestampValid')is True and row.get('reasons')==['known-history-companion-not-empty-regular']);history[name]=row
 need(len(history)==5 and sorted(row['category']for row in history.values())==['known-history-company','known-history-daily-mail','known-history-personal-mail','known-history-personal-mail','known-history-personal-mail']);HISTORY_NAMES=history;return {'firstFailureManifestSHA256':PRIOR_MANIFEST,'firstFailureResultSHA256':PRIOR_RESULT,'diagnosticManifestSHA256':DIAGNOSTIC_MANIFEST,'diagnosticResultSHA256':DIAGNOSTIC_RESULT,'bothOriginalArchivesPreserved':True}

SECOND_FAILURE=ROOT/'deploy/backups/voyageplex-942-20261019-backup-v2'
SECOND_MANIFEST='d80feb3735d4b1a88f2a1cdfb3c5497fafea76dd2447d6bf67e33e3779c82cf2';SECOND_RESULT='cdb05627c65f6e73993b4d5de8af2f398e49ce8a8fdbfc3eff4de4387b848a49'
SOURCE_DIAGNOSTIC=ROOT/'deploy/backups/voyageplex-942-20261019-source-diagnostic'
SOURCE_MANIFEST='140cd8a23a2968a11fb8ef79c75cf816096323d4fe02b69200448f963df04c39';SOURCE_RESULT='f711afce1e8dbad7e3684911883fc8619580fac08b66886a415bb6bb76658f06'
PARSER_PRESERVED_KEY='VOYAGEPLEX_MAIL_AUTH_CODE';SEALED_SOURCE_ENV=None;SEALED_SOURCE_RUNTIME=None;SEALED_PARSER_FILES=None

def preserve_parser_environment(raw,explicit,images):
 need(type(SEALED_SOURCE_ENV)is dict and set(raw)==set(explicit)==set(SERVICES));evidence=SEALED_SOURCE_ENV;need(set(evidence)=={'images','explicit','actualConfigEnvironment'})
 for service in SERVICES:
  value=explicit[service];need(type(value)is dict and all(type(k)is str and type(v)is str for k,v in value.items())and value==evidence['explicit'][service]);actual=envmap(raw[service]['Config']['Env']);need(actual==envmap(evidence['actualConfigEnvironment'][service]));imageid=raw[service]['Image'];need(imageid in images and imageid in evidence['images']and images[imageid]['Id']==evidence['images'][imageid]['Id']==imageid);defaults=envmap(images[imageid]['Config'].get('Env')or[]);need(defaults==envmap(evidence['images'][imageid]['Config'].get('Env')or[]));expected=dict(defaults);expected.update(value);need(set(expected)==set(actual));changed={key for key in expected if expected[key]!=actual[key]};need(changed==({PARSER_PRESERVED_KEY}if service=='voyageplex-parser'else set()))
  if service=='voyageplex-parser':need(type(actual.get(PARSER_PRESERVED_KEY))is str and len(actual[PARSER_PRESERVED_KEY])<=1024 and PARSER_PRESERVED_KEY in value)
 return {'onlySealedExistingParserCredentialDiffersFromEnvFile':True,'otherImageDefaultsAndAllExplicitValuesMatchSealedDiagnostic':True,'existingRuntimeCredentialUnchanged':True,'envFileNotModified':True}
def prior_evidence():
 global SEALED_SOURCE_ENV,SEALED_SOURCE_RUNTIME,SEALED_PARSER_FILES
 original=prior_evidence_v2();second=prior_archive(SECOND_FAILURE,SECOND_MANIFEST,SECOND_RESULT);need(second.get('success')is False and second.get('backupComplete')is False and second.get('base')==BASE and second.get('failedStage')=='actual-images-sources-and-processes');report=prior_archive(SOURCE_DIAGNOSTIC,SOURCE_MANIFEST,SOURCE_RESULT);need(report.get('success')is True and report.get('diagnosticCompleted')is True and report.get('base')==BASE and report.get('originalFailedArchivesUnchanged')is True and report.get('sourceEnvironmentAndFourDirtyUnchanged')is True and report.get('threeTargetsAndAllOtherContainersUnchanged')is True and report.get('apiDLLHashOutputValid')is True and report.get('webBuildIDReadableAndBounded')is True)
 parsed=report.get('parserSource',{});need(parsed.get('allFilesMatchBase')is True and parsed.get('fileCount')==24 and type(parsed.get('files'))is dict and len(parsed['files'])==24 and all(row.get('matchesBase')is True and row.get('readableRegularFile')is True and re.fullmatch('[a-f0-9]{64}',row.get('expectedSHA256',''))and row.get('expectedSHA256')==row.get('actualSHA256')for row in parsed['files'].values()));SEALED_PARSER_FILES={name:row['expectedSHA256']for name,row in parsed['files'].items()}
 SEALED_SOURCE_ENV=json.loads((SOURCE_DIAGNOSTIC/'current-environment-evidence.private.json').read_bytes());SEALED_SOURCE_RUNTIME=json.loads((SOURCE_DIAGNOSTIC/'initial-runtime.private.json').read_bytes());oldraw=json.loads((SECOND_FAILURE/'containers.private.json').read_bytes());need(type(oldraw)is dict and set(oldraw)==set(SERVICES));preserve_parser_environment(oldraw,SEALED_SOURCE_ENV['explicit'],SEALED_SOURCE_ENV['images'])
 for service in SERVICES:need(oldraw[service]['Id']==SEALED_SOURCE_RUNTIME['targets'][service]['id']and oldraw[service]['Image']==SEALED_SOURCE_RUNTIME['targets'][service]['image'])
 return dict(original,secondFailureManifestSHA256=SECOND_MANIFEST,secondFailureResultSHA256=SECOND_RESULT,sourceDiagnosticManifestSHA256=SOURCE_MANIFEST,sourceDiagnosticResultSHA256=SOURCE_RESULT,allFailedAndDiagnosticArchivesPreserved=True)

def persistent_inventory():
 need(type(HISTORY_NAMES)is dict and len(HISTORY_NAMES)==5 and DATA.is_dir()and not DATA.is_symlink());historical={};primary=False
 for path in sorted(DATA.rglob('*')):
  need(not path.is_symlink()and(path.is_file()or path.is_dir()))
  if path.is_dir():continue
  name=str(path.relative_to(DATA))
  with path.open('rb')as stream:head=stream.read(16)
  if name=='voyageplex.db':need(head==b'SQLite format 3\0');primary=True;continue
  match=re.fullmatch(r'voyageplex\.db\.before-(company|daily-mail|personal-mail)-([0-9]{14})-[a-f0-9]{32}\.db',name)
  if head==b'SQLite format 3\0':
   need(match is not None and name in HISTORY_NAMES);stamp=datetime.datetime.strptime(match[2],'%Y%m%d%H%M%S');need(stamp.strftime('%Y%m%d%H%M%S')==match[2]);original=HISTORY_NAMES[name];now=path.lstat();need([now.st_dev,now.st_ino,now.st_mode,now.st_size,now.st_mtime_ns,now.st_ctime_ns]==original['stat']);companions={}
   for suffix in('-wal','-shm','-journal'):
    p=path.with_name(path.name+suffix);need(not p.is_symlink()and(not p.exists()or p.is_file()));prior=original['companions'][suffix];need(p.exists()==prior['exists']and(not p.exists()or p.stat().st_size==prior['bytes']))
    companions[suffix]={'exists':p.exists()}
    if p.exists():companions[suffix].update(sha256=OPS.L.file_hash(p),mode=stat.S_IMODE(p.stat().st_mode),bytes=p.stat().st_size)
   historical[name]={'sha256':OPS.L.file_hash(path),'mode':stat.S_IMODE(now.st_mode),'bytes':now.st_size,'companions':companions,'onlineHistoricalSQLiteOpened':False}
  elif match:need(False)
 need(primary and set(historical)==set(HISTORY_NAMES));return historical

def mailbox_metadata(snapshot,raw):
 entries=json.loads(envmap(raw['voyageplex-api']['Config']['Env']).get('VOYAGEPLEX_HUADENG_MAILBOXES_JSON',''));need(type(entries)is list and len(entries)==4);bindings=[];seen_users=set();seen_addresses=set()
 with contextlib.closing(OPS.L.connect(snapshot,True))as db:
  for value in entries:
   need(type(value)is dict);entry={key.lower():v for key,v in value.items()};need(all(type(entry.get(k))is str and entry[k].strip()for k in ('username','address','authcode','host','folder'))and len(entry['authcode'])<=1024);username,address=entry['username'].strip(),entry['address'].strip().lower();need(username.casefold()not in seen_users and address not in seen_addresses);seen_users.add(username.casefold());seen_addresses.add(address)
   rows=db.execute('SELECT Id,Username,Role,CompanyAccess,IsActive,MailboxAddress,MailboxHost,MailboxFolder FROM Users WHERE Username=? COLLATE NOCASE',(username,)).fetchall();need(len(rows)==1 and rows[0][4]==1 and rows[0][5].strip().lower()==address and(rows[0][2]=='admin'or rows[0][3]in {'Huadeng','Both'}));bindings.append({'user':[OPS.L.cell(v)for v in rows[0]],'serverHost':entry['host'],'serverFolder':entry['folder'],'authCodePresent':True})
  metadata={}
  for name in ('MailSyncStates','MailSystemSettings'):
   columns=[row[1]for row in db.execute('PRAGMA table_xinfo('+OPS.L.quote(name)+')')];need(columns);metadata[name]={'columns':columns,'rows':[[OPS.L.cell(v)for v in row]for row in db.execute('SELECT '+','.join(map(OPS.L.quote,columns))+' FROM '+OPS.L.quote(name))]}
  statuses={name:[[OPS.L.cell(v)for v in row]for row in db.execute('SELECT Status,count(*) FROM '+OPS.L.quote(name)+' GROUP BY Status')]for name in ('ImportBatches','ImportEmailItems')}
 OPS.L.private_write(OUT/'mailbox-state.private.json',enc({'bindings':bindings,'mailState':metadata,'storedStatusCounts':statuses,'storedStatusDoesNotProveNoInFlightWork':True}));return {'configuredMailboxBindings':len(bindings),'cursorRows':len(metadata['MailSyncStates']['rows']),'settingsRows':len(metadata['MailSystemSettings']['rows'])}

PARSER_HASH_CODE="import hashlib,json,pathlib,sys;names=json.loads(sys.stdin.read());print(json.dumps({name:hashlib.sha256((pathlib.Path('/app')/name).read_bytes()).hexdigest()for name in names},sort_keys=True))"
def actual_source(runtime,raw):
 images=json.loads(run(['docker','image','inspect',*[runtime['targets'][s]['image']for s in SERVICES]]));need(type(images)is list and len(images)==3);byid={v['Id']:v for v in images};need(set(byid)=={v['image']for v in runtime['targets'].values()});OPS.L.private_write(OUT/'images.private.json',enc(byid))
 config=json.loads(run(['docker','compose','-p','rr-portal','-f',str(ROOT/'docker-compose.cloud.yml'),'--env-file',str(ROOT/'.env.cloud.production'),'config','--format','json']));explicit={service:config['services'][service].get('environment',{})for service in SERVICES}
 environment=preserve_parser_environment(raw,explicit,byid)
 OPS.L.private_write(OUT/'compose-environment.private.json',enc(explicit))
 prefix=APP_PREFIX+'services/email-parser/';names=run(['git','ls-tree','-r','--name-only','-z',BASE,'--',prefix+'app']).decode().strip('\0').split('\0');need(names and all(n.startswith(prefix+'app/')and OPS.L.safe_path(n)for n in names));files={n[len(prefix):]:sha(run(['git','show',BASE+':'+n]))for n in names};actual=json.loads(run(['docker','exec','-i',runtime['targets']['voyageplex-parser']['id'],'python','-c',PARSER_HASH_CODE],enc(list(files))));need(actual==files==SEALED_PARSER_FILES and len(files)==24)
 dll=run(['docker','exec',runtime['targets']['voyageplex-api']['id'],'sha256sum','/app/VoyagePlex.Api.dll']).decode().strip();need(re.fullmatch('[a-f0-9]{64}  /app/VoyagePlex.Api.dll',dll));build=run(['docker','exec',runtime['targets']['voyageplex-web']['id'],'cat','/app/.next-build/BUILD_ID']);need(0<len(build)<=256)
 for service in SERVICES:OPS.L.private_write(OUT/(service+'-processes.private.txt'),run(['docker','top',runtime['targets'][service]['id'],'-eo','pid,ppid,comm']))
 return {'parserSourceFiles':actual,'parserSourceMatchesBase':True,'apiDLLSHA256':dll.split()[0],'webBuildIdSHA256':sha(build),'applicationTree':run(['git','rev-parse',BASE+':'+APP_PREFIX.rstrip('/')]).decode().strip(),'processInventoryIsOnlyAnInstantaneousObservation':True,'sealedExistingParserEnvironmentProof':environment}

def backup(result):
 global STAGE
 STAGE='sealed-first-failure-and-diagnostic';prior=prior_evidence();STAGE='source-and-four-dirty';config=source();dirty=dirty_snapshot(True);env=ROOT/'.env.cloud.production';need(env.is_file()and not env.is_symlink()and env.stat().st_size<=4*1024**2);envhash=OPS.L.file_hash(env);OPS.L.private_write(OUT/'environment.private',env.read_bytes())
 STAGE='three-current-containers';before,raw=runtime();need(before==SEALED_SOURCE_RUNTIME);OPS.L.private_write(OUT/'containers.private.json',enc(raw));STAGE='sqlite-file-inventory';historical=persistent_inventory();size=sum(p.stat().st_size for p in DATA.rglob('*')if p.is_file());need(shutil.disk_usage(OUT).free>2*size+1024**3)
 STAGE='primary-wal-consistent-snapshot';copies=OUT/'sqlite';copies.mkdir(mode=0o700);OPS.L.databases=lambda _:['voyageplex.db'];database=OPS.L.snapshots(DATA,copies);need(set(database)=={'voyageplex.db'});STAGE='all-other-runtime-files';files=OPS.L.non_database_inventory(DATA,['voyageplex.db'],OUT/'files.tar')
 STAGE='private-mailbox-and-cursor-metadata';summary=mailbox_metadata(copies/'voyageplex.db',raw);STAGE='actual-images-sources-and-processes';proof=actual_source(before,raw)
 STAGE='final-stability';need(prior_evidence()==prior);after,_=runtime();need(before==after and source()==config and dirty_snapshot()==dirty and OPS.L.file_hash(env)==envhash and persistent_inventory()==historical and OPS.L.non_database_inventory(DATA,['voyageplex.db'])==files)
 baseline={'head':BASE,'runtime':before,'configuration':config,'environmentSHA256':envhash,'preexistingFourDirty':dirty,'database':database,'files':files,'historicalSQLite':historical,'mailboxSummary':summary,'sourceProof':proof,'priorEvidence':prior};OPS.L.private_write(OUT/'baseline.private.json',enc(baseline));result.update(success=True,backupComplete=True,firstFailureAndDiagnosticArchivesPreserved=True,secondFailureAndSourceDiagnosticArchivesPreserved=True,onlyExistingParserRuntimeCredentialDiffersFromEnvFile=True,existingRuntimeCredentialsUnchanged=True,historicalRawDBAndAllCompanionsArchivedWithoutOnlineSQLiteOpen=True,portableHistoricalSQLiteClaim=False,portablePrimarySQLiteCount=1,historicalRawSQLiteBundleCount=len(historical),allRuntimeStorageFilesArchivedAndVerified=True,allNonVoyagePlexContainersUnchanged=True,threeTargetContainersStable=True,fourPreexistingChangesPreserved=True,privateEnvironmentAndImageDefaultsBackedUp=True,parserActualSourceMatchesBase=True,configuredMailboxBindings=summary['configuredMailboxBindings'],cursorRowsCapturedPrivately=summary['cursorRows'],ordinaryBackgroundSyncConfigurationNotChanged=True,manualSyncBackfillRetryOrMailboxTestPerformed=False,healthOrBusinessHTTPRequestsPerformed=False,restoreOrDatabaseWritesPerformed=False,noCrossStoreAtomicSnapshotClaim=True)

def main():
 global OPS
 need(len(sys.argv)==2 and sys.argv[1]=='backup'and BACKUP_PIN and os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_ATTEMPT')=='1');os.umask(0o077);OPS=load('release-data-ops-library.py');OPS.L=OPS.load_library(pathlib.Path(__file__).with_name('release-data-library.py'));OUT.mkdir(mode=0o700);OPS.run=run
 def stop(*_):need(False)
 signal.signal(signal.SIGTERM,stop);result={'mode':'backup','success':False,'backupComplete':False,'base':BASE,'targetPinFrozen':False,'businessWritesPerformed':False,'credentialsOrConfigurationChanged':False,'otherServicesRequested':False,'secretOrRowsPrinted':False}
 try:backup(result)
 except BaseException:result['failedStage']=STAGE
 finally:
  OPS.L.private_write(OUT/'first-result.json',enc(result));OPS.L.seal(OUT);print(enc(dict(result,manifestSHA256=OPS.L.file_hash(OUT/'manifest.json'),resultSHA256=OPS.L.file_hash(OUT/'first-result.json'))).decode(),flush=True)
 return 0 if result['success']else 1
if __name__=='__main__':
 try:exit_code=main()
 except BaseException:print('{"success":false,"safeFailure":"VOYAGEPLEX_942_BACKUP_PREFLIGHT_FAILED"}',flush=True);exit_code=1
 sys.exit(exit_code)
