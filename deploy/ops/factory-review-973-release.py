"""PR973 two-service factory-review deployment and sealed read-only verification. Draft gates false."""
import contextlib,copy,datetime,html.parser,io,sqlite3,hashlib,importlib.util,json,os,pathlib,re,signal,stat,subprocess,sys,tarfile,time,traceback,urllib.request,urllib.error
ROOT=pathlib.Path('/opt/rr-portal');BASE='6fc1143c0b39470d814caac553beaaf3bc2912e0';TARGET='7ce02db904cdd769ecd35148d50be15ec4fce210';TREE='109dc79b3552ad24a477bc64c9a6a79af21221a5'
BRANCH='refs/heads/ops/factory-review-973-20261021';DEPLOY_PIN=True;VERIFY_PIN=False
BACKUP=ROOT/'deploy/backups/factory-review-973-20261021-backup';BACKUP_MANIFEST='ae39c5c0fcc005c587def098193b770afd922bc6f7a45972f03031665f1384c9';BACKUP_RESULT='f0226c0a16749974e9d5fa3c678d553892012384ec8237987ab2157d3498481e'
DEPLOY=BACKUP.with_name('factory-review-973-20261021-deploy');VERIFY=BACKUP.with_name('factory-review-973-20261021-verify');DEPLOY_MANIFEST='';DEPLOY_RESULT=''
CORE_SHA='587812a638756e0eb7e7bcf1cb5042a5f7531d1b3c0e3200be77f894627b9b39'
COMPARATOR_SHA='fa4e6f29f9918985f7675c81e833815cff3f39df513ae554faad0fe0a025ad35'
SOURCE_MANIFEST_SHA='f613e7c1e856de4e2c59b12dbc8cef23d50a2e9a25591ffb79d1c45273d811bb'
STAGE='preflight';CORE=None;OUT=None;ENV=None;DRAIN=None
COMPOSE=['docker','compose','-p','rr-portal','-f',str(ROOT/'docker-compose.cloud.yml'),'--env-file',str(ROOT/'.env.cloud.production')]

def need(v):
 if not v:raise RuntimeError('FACTORY_REVIEW_973_RELEASE_REJECTED')
def enc(v):return json.dumps(v,sort_keys=True,ensure_ascii=True,separators=(',',':'),allow_nan=False).encode()
def sha(v):return hashlib.sha256(v).hexdigest()
def core_load():
 p=pathlib.Path(__file__).with_name('factory-review-backup-library.py');need(p.is_file()and not p.is_symlink()and sha(p.read_bytes())==CORE_SHA);s=importlib.util.spec_from_file_location('fixed_factory_readonly_core',p);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m

def archive(path,msha,rsha):
 need(re.fullmatch('[a-f0-9]{64}',msha or'')and re.fullmatch('[a-f0-9]{64}',rsha or'')and path.is_dir()and not path.is_symlink()and stat.S_IMODE(path.stat().st_mode)==0o700)
 need(CORE.OPS.L.file_hash(path/'manifest.json')==msha and CORE.OPS.L.file_hash(path/'first-result.json')==rsha);manifest=json.loads((path/'manifest.json').read_bytes());entries=list(path.rglob('*'));need(len(entries)<=50000 and all(not p.is_symlink()and(p.is_dir()or p.is_file())and p.stat().st_mode&0o077==0 for p in entries));need(set(manifest)=={str(p.relative_to(path))for p in entries if p.is_file()and p!=path/'manifest.json'})
 need(all(CORE.OPS.L.safe_path(n)and re.fullmatch('[a-f0-9]{64}',h)and CORE.OPS.L.file_hash(path/n)==h for n,h in manifest.items()));receipt=json.loads((path/'first-result.json').read_bytes());need(receipt.get('success')is True)
 return receipt

def original():
 receipt=archive(BACKUP,BACKUP_MANIFEST,BACKUP_RESULT);need(receipt.get('backupComplete')is True and receipt.get('base')==BASE and receipt.get('portableSQLiteCount')==4 and receipt.get('actualHooksAndMigrationsMatchBase')is True and receipt.get('actualOCIApplicationTreesMatchBase')is True);baseline=json.loads((BACKUP/'baseline.private.json').read_bytes());need(baseline['head']==BASE and set(baseline['pocketbase'])==set(CORE.SERVICES));return baseline

def operation(args,timeout=180,checkout=False):
 CORE.COUNTER+=1
 with (OUT/('%03d-%s.private.log'%(CORE.COUNTER,STAGE))).open('xb')as log:p=subprocess.run(args,stdout=log,stderr=subprocess.STDOUT,timeout=timeout,cwd=ROOT,env=ENV,umask=0o022 if checkout else -1)
 need(p.returncode==0)

def source_manifest():
 p=pathlib.Path(__file__).with_name('factory-review-reviewed-files.json');need(p.is_file()and not p.is_symlink()and sha(p.read_bytes())==SOURCE_MANIFEST_SHA);v=json.loads(p.read_bytes());need(type(v)is dict and 0<len(v)<=30 and all(any(n.startswith(CORE.APP_PREFIX+part)for part in ('src/','tests/','pb_hooks/','pb_migrations/','README.md'))and CORE.OPS.L.safe_path(n)and re.fullmatch('[a-f0-9]{64}',h)for n,h in v.items()));return v

def checked_source(revision,baseline,files,canonical=False):
 CORE.BASE=revision;need(CORE.source()==baseline['configuration']and CORE.dirty_snapshot()==baseline['preexistingFourDirty']and CORE.OPS.L.file_hash(ROOT/'.env.cloud.production')==baseline['environmentSHA256']and CORE.file_metadata(ROOT/'.env.cloud.production')==baseline['environmentFileMetadata'])
 need(CORE.run(['git','rev-parse',TARGET+'^{tree}']).decode().strip()==TREE);changed=CORE.run(['git','diff','--name-only','-z','--no-ext-diff','--no-textconv',BASE,TARGET]).decode().strip('\0').split('\0');need(set(changed)==set(files));need(not set(changed)&set(baseline['preexistingFourDirty']))
 for n,h in files.items():
  need(sha(CORE.run(['git','show',TARGET+':'+n]))==h)
  if canonical:
   path=ROOT/n;entry=CORE.run(['git','ls-tree','-z',TARGET,'--',n]).split(b'\t',1);need(len(entry)==2 and entry[1]==n.encode()+b'\0'and re.fullmatch(b'100(?:644|755) blob [a-f0-9]{40}',entry[0]));desired=0o755 if entry[0].startswith(b'100755')else 0o644
   for ancestor in(path,*path.parents):
    if ancestor==ROOT:break
    need(not ancestor.is_symlink())
   need(path.is_file()and stat.S_IMODE(path.stat().st_mode)==desired and CORE.OPS.L.file_hash(path)==h)


def config_same(a,b):
 return all(a[k]==b[k]for k in ('environmentMapSHA256','processEnvironmentWithoutAutomaticHostnameSHA256','mounts','memory','swap','healthcheck','command','entrypoint','user','workingDirectory','hostConfigSHA256'))
def captured(args,label,timeout=180):
 CORE.COUNTER+=1;path=OUT/('%04d-%s.stdout.private'%(CORE.COUNTER,label))
 with path.open('xb')as output,(OUT/('%04d-%s.stderr.private'%(CORE.COUNTER,label))).open('xb')as errors:p=subprocess.run(args,stdout=output,stderr=errors,timeout=timeout,cwd=ROOT,env=ENV)
 need(p.returncode==0 and path.stat().st_size<=64*1024**2);return path.read_bytes()
def private(name,value):CORE.OPS.L.private_write(OUT/name,value if type(value)is bytes else enc(value))
def compose_base():
 need(captured(['docker','compose','version','--short'],'compose-version').decode().strip()=='5.1.0');base=json.loads(captured([*COMPOSE,'config','--format','json'],'compose-base'));old=json.loads((BACKUP/'compose-render.private.json').read_bytes())
 for service in CORE.SERVICES:old['services'][service]['build']['args']['OCI_REVISION']=TARGET
 need(base==old);return base
def overlay(base,images,filename):
 need(set(images)==set(CORE.SERVICES));lines=['services:'];expected=copy.deepcopy(base)
 for service,image in images.items():
  actual=json.loads((BACKUP/(service+'-literal-configured-environment.private.json')).read_bytes());need(type(actual)is dict and all(type(k)is str and type(v)is str for k,v in actual.items()));literal={k:v.replace('$','$$')for k,v in actual.items()};need(re.fullmatch('sha256:[a-f0-9]{64}',image)or image=='rr-portal-'+service+'-973:'+TARGET)
  lines.extend(['  '+service+':','    environment: !override '+json.dumps(literal,ensure_ascii=True,separators=(',',':')),'    image: '+image,'    pull_policy: never']);expected['services'][service].update(environment=literal,image=image,pull_policy='never')
 path=OUT/filename;private(filename,('\n'.join(lines)+'\n').encode());args=[*COMPOSE,'-f',str(path)];observed=json.loads(captured([*args,'config','--format','json'],'compose-overlay'));need(observed==expected);return args,observed

def candidate(service,image,raw,base):
 old=json.loads((BACKUP/(service+'-image.private.json')).read_bytes());need(old['Id']==raw['Image']and image.get('Architecture')==old.get('Architecture')=='amd64'and image.get('Os')==old.get('Os')=='linux'and re.fullmatch('sha256:[a-f0-9]{64}',image['Id'])and(image['Config'].get('Labels')or{}).get('org.opencontainers.image.revision')==TARGET)
 need(image['Config'].get('Healthcheck')==old['Config'].get('Healthcheck'));actual=CORE.envmap(raw['Config']['Env']);literal=json.loads((BACKUP/(service+'-literal-configured-environment.private.json')).read_bytes());defaults=CORE.envmap(image['Config'].get('Env')or[]);need(literal==actual and dict(defaults,**literal)==actual)
 for key,override in [('Cmd','command'),('Entrypoint','entrypoint'),('User','user'),('WorkingDir','working_dir')]:
  value=base['services'][service].get(override)
  if value is None:value=image['Config'].get(key)
  need(value==raw['Config'].get(key)or key=='User'and value in(None,'')and raw['Config'].get(key)in(None,''))
 blob=captured(['docker','run','--rm','--network','none','--read-only','--log-driver','none','--entrypoint','tar',image['Id'],'-C','/pb','-cf','-','pb_hooks','pb_migrations','pb_public'],'candidate-'+service,180);found={};total=0
 with tarfile.open(fileobj=io.BytesIO(blob),mode='r:')as tar:
  for member in tar:
   name=member.name.rstrip('/');need(CORE.OPS.L.safe_path(name)and name.split('/')[0]in {'pb_hooks','pb_migrations','pb_public'}and(member.isdir()or member.isfile()))
   if member.isdir():continue
   need(name not in found and member.size<=16*1024**2);total+=member.size;need(total<=32*1024**2);content=tar.extractfile(member).read();need(len(content)==member.size);found[name]={'bytes':member.size,'sha256':sha(content)}
 names=CORE.run(['git','ls-tree','-r','--name-only','-z',TARGET,'--',CORE.APP_PREFIX+'pb_hooks',CORE.APP_PREFIX+'pb_migrations']).decode().strip('\0').split('\0');wanted={name[len(CORE.APP_PREFIX):]:sha(CORE.run(['git','show',TARGET+':'+name]))for name in names};need({name:row['sha256']for name,row in found.items()if not name.startswith('pb_public/')}==wanted and 'pb_public/index.html'in found and any(n.startswith('pb_public/assets/')for n in found));private(service+'-candidate-image.private.json',image);private(service+'-candidate-files.private.json',found);return found

def raw_inventory():
 ids=captured(['docker','ps','-aq','--no-trunc'],'all-ids').decode().split();need(0<len(ids)<=1000 and len(ids)==len(set(ids))and all(re.fullmatch('[a-f0-9]{64}',v)for v in ids));records=json.loads(captured(['docker','inspect',*ids],'all-inspect'));need(type(records)is list and len(records)==len(ids));result={}
 for row in records:
  cid=row['Id'];need(cid in ids and cid not in result);result[cid]={'Id':cid,'Image':row['Image'],'Config':dict(row['Config'],Env=sorted(row['Config']['Env'])),'HostConfig':row['HostConfig'],'Mounts':sorted(row['Mounts'],key=enc),'Running':row['State']['Running'],'OOMKilled':row['State']['OOMKilled'],'StartedAt':row['State']['StartedAt'],'RestartCount':row['RestartCount']}
 return result

def configuration_preserved(before,after,composeargs):
 need(before['HostConfig']==after['HostConfig']and sorted(before['Mounts'],key=enc)==sorted(after['Mounts'],key=enc));a=copy.deepcopy(before['Config']);b=copy.deepcopy(after['Config']);oldlabels=a.pop('Labels')or{};labels=b.pop('Labels')or{};need(a.pop('Hostname')==before['Id'][:12]and b.pop('Hostname')==after['Id'][:12]);a.pop('Image');need(b.pop('Image')==after['Image']);a['Env']=sorted(a['Env']);b['Env']=sorted(b['Env']);need(a==b)
 expected=copy.deepcopy(oldlabels);expected['org.opencontainers.image.revision']=TARGET;expected['com.docker.compose.image']=after['Image'];expected['com.docker.compose.project.config_files']=','.join([str(ROOT/'docker-compose.cloud.yml'),str(OUT/'runtime-images-and-literal-env.private.yml')]);hashes=captured([*composeargs,'config','--hash',after['Config']['Labels']['com.docker.compose.service']],'config-hash').decode().split();need(len(hashes)==2 and re.fullmatch('[a-f0-9]{64}',hashes[1]));expected['com.docker.compose.config-hash']=hashes[1];need(labels==expected)
def flags(service=None):
 need(service is None or service in CORE.SERVICES);path=ROOT/'deploy/maintenance';need(path.is_dir()and not path.is_symlink());return[r for r in CORE.OPS.L.non_database_inventory(path,[])if r['path']!='services/'+str(service)]
def maintenance(fn,service):
 need(service in CORE.SERVICES and fn in {'maintenance_on','wait_service_ready','maintenance_off','require_maintenance_cleared'});operation(['bash','-c','set -euo pipefail; source "$1"; "$2" "$3"','factory-release',str(ROOT/'deploy/service-maintenance.sh'),fn,service],340)
def bootstrap_ready(raw):
 env=CORE.envmap(raw['Config']['Env']);email=env.get('FACTORY_REVIEW_ADMIN_EMAIL','').strip();need(email and len(env.get('FACTORY_REVIEW_ADMIN_PASSWORD',''))>=12)
 service=raw['Config']['Labels']['com.docker.compose.service'];need(service in CORE.SERVICES)
 with contextlib.closing(CORE.OPS.L.connect(CORE.APP/CORE.SERVICES[service]/'data.db'))as db:need(db.execute('SELECT count(*) FROM users WHERE email=?',(email,)).fetchone()==(1,))
def get(path):
 need(path.startswith('/')and not path.startswith('//'));request=urllib.request.Request('http://127.0.0.1'+path,headers={'Cache-Control':'no-cache'})
 try:
  with urllib.request.urlopen(request,timeout=15)as response:body=response.read(16*1024**2+1);need(len(body)<=16*1024**2);return response.status,body
 except urllib.error.HTTPError as error:return error.code,b''
def public_assets(service,proof):
 base='/'+service+'/';expected=proof['files'];status,body=get(base);need(status==200 and sha(body)==expected['pb_public/index.html']['sha256'])
 class Assets(html.parser.HTMLParser):
  def __init__(self):super().__init__();self.urls=set()
  def handle_starttag(self,tag,attrs):
   for key,value in attrs:
    if tag in {'script','link'}and key in {'src','href'}and value and value.startswith(base+'assets/'):self.urls.add(value)
 parser=Assets();parser.feed(body.decode());need(parser.urls)
 for name,row in expected.items():
  if name.startswith('pb_public/assets/'):
   url=base+name[len('pb_public/'):];need('?'not in url and'#'not in url);status,asset=get(url);need(status==200 and len(asset)==row['bytes']and sha(asset)==row['sha256'])
 need(all('pb_public/'+url[len(base):]in expected for url in parser.urls));return {'actualIndexAndAllAssetsMatchContainerBytes':True,'requestedBasePath':base}

def capture_storage(service,folder):
 destination=OUT/folder;destination.mkdir(mode=0o700);saved=CORE.OUT;CORE.OUT=destination
 try:
  tree=CORE.APP/CORE.SERVICES[service];names=CORE.OPS.database_names(tree);need(set(names)=={'data.db','auxiliary.db'});companions=[tree/(n+suffix)for n in names for suffix in ('-wal','-journal')];quiet=all(not p.exists()or p.is_file()and not p.is_symlink()and p.stat().st_size==0 for p in companions)
  if quiet:
   target=destination/service;target.mkdir(mode=0o700);copies=target/'sqlite';copies.mkdir(mode=0o700);value={'sqlite':CORE.OPS.L.snapshots(tree,copies,immutable=True),'files':CORE.OPS.L.non_database_inventory(tree,names,target/'files.tar')};need(CORE.OPS.database_names(tree)==names and all(not p.exists()or p.is_file()and not p.is_symlink()and p.stat().st_size==0 for p in companions))
  else:value=CORE.OPS.sqlite_capture(service,tree,destination/service)
  need(set(value['sqlite'])=={'data.db','auxiliary.db'});value['databaseFileMetadata']={n:CORE.file_metadata(CORE.APP/CORE.SERVICES[service]/n)for n in ('data.db','auxiliary.db')};private_path=destination/'observed.private.json';CORE.OPS.L.private_write(private_path,enc(value));CORE.OPS.L.seal(destination);return value
 finally:CORE.OUT=saved

def deploy(result,before,files):
 global STAGE,DRAIN
 STAGE='initial-runtime-and-source';current,raw=CORE.runtime();need(current==before['runtime']and flags()==before['maintenanceInventory']);old_flags=flags()
 for service in CORE.SERVICES:maintenance('require_maintenance_cleared',service);bootstrap_ready(raw[service])
 checked_source(BASE,before,files);STAGE='fetch-exact-main';captured(['git','-c','core.hooksPath=/dev/null','fetch','--no-write-fetch-head','origin','main:refs/rr-portal-factory-973-main'],'fetch-main');need(CORE.run(['git','rev-parse','refs/rr-portal-factory-973-main']).decode().strip()==TARGET);CORE.run(['git','merge-base','--is-ancestor',BASE,TARGET]);checked_source(BASE,before,files)
 STAGE='fast-forward-reviewed-source';operation(['git','-c','core.hooksPath=/dev/null','-c','merge.autoStash=false','merge','--ff-only','--no-autostash',TARGET],180,checkout=True);checked_source(TARGET,before,files,True);base=compose_base();tags={s:'rr-portal-'+s+'-973:'+TARGET for s in CORE.SERVICES};args,rendered=overlay(base,tags,'build-images-and-literal-env.private.yml');candidates={};proofs={};public={};preswitch={}
 for service in ('factory-review-test','factory-review'):
  STAGE=service+'-build-before-any-maintenance';need(CORE.runtime()[0]==current and flags()==old_flags);operation([*args,'build',service],1500);image=json.loads(captured(['docker','image','inspect',tags[service]],'candidate-image'))[0];candidates[service]={'image':image['Id'],'files':candidate(service,image,raw[service],base)};checked_source(TARGET,before,files,True);need(CORE.runtime()[0]==current and flags()==old_flags)
 args,rendered=overlay(base,{s:v['image']for s,v in candidates.items()},'runtime-images-and-literal-env.private.yml');private('all-candidates-before-maintenance.private.json',candidates);prepared=OUT/'prepared';prepared.mkdir(mode=0o700)
 for name in ('all-candidates-before-maintenance.private.json','runtime-images-and-literal-env.private.yml'):CORE.OPS.L.private_write(prepared/name,(OUT/name).read_bytes())
 CORE.OPS.L.seal(prepared);result['bothCandidatesBuiltAndSealedBeforeAnyMaintenance']=True;expected=current
 for service in ('factory-review-test','factory-review'):
  STAGE=service+'-only-own-maintenance-and-graceful-drain';need(CORE.runtime()[0]==expected);bootstrap_ready(raw[service]);service_flags=flags(service);maintenance('maintenance_on',service);need(flags(service)==service_flags);running=raw_inventory();cid=expected['targets'][service]['id'];need(cid in running and running[cid]['Running']is True);DRAIN={'service':service,'id':cid,'expected':copy.deepcopy(expected),'oldFlags':old_flags,'candidateSwitchAttempted':False};operation(['docker','stop','--time','30',cid],45);stopped=raw_inventory();want=copy.deepcopy(running);want[cid]['Running']=False;need(stopped==want and stopped[cid]['OOMKilled']is False)
  STAGE=service+'-closed-pre-switch-backup';preswitch[service]=capture_storage(service,'pre-switch-'+service);need(raw_inventory()==stopped and flags(service)==service_flags);private(service+'-pre-switch-raw.private.json',stopped);checked_source(TARGET,before,files,True)
  STAGE=service+'-recreate-fixed-candidate';DRAIN['candidateSwitchAttempted']=True;switched=time.monotonic();operation([*args,'up','-d','--force-recreate','--no-build','--no-deps','--pull','never',service],180);maintenance('wait_service_ready',service);after,inspects=CORE.runtime();need(after['others']==expected['others']and all(after['targets'][s]==expected['targets'][s]for s in CORE.SERVICES if s!=service));row=after['targets'][service];need(config_same(before['runtime']['targets'][service],row)and row['id']!=cid and row['image']==candidates[service]['image']and row['restarts']==0);configuration_preserved(raw[service],inspects[service],args);proofs[service]=CORE.runtime_files(service,row);need(proofs[service]['files']==candidates[service]['files']);private(service+'-startup-observed.private.json',{'started':row['started'],'observedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()});time.sleep(max(0,10-(time.monotonic()-switched)));need(CORE.runtime()[0]==after and flags(service)==service_flags);checked_source(TARGET,before,files,True)
  STAGE=service+'-clear-only-own-maintenance';maintenance('maintenance_off',service);maintenance('require_maintenance_cleared',service);need(CORE.runtime()[0]==after and flags()==old_flags);STAGE=service+'-public-assets'
  try:public[service]=public_assets(service,proofs[service])
  except BaseException:maintenance('maintenance_on',service);raise
  expected=after;DRAIN=None
 STAGE='final-preservation';original();checked_source(TARGET,before,files,True);need(CORE.runtime()[0]==expected and flags()==old_flags and all(v['restarts']==0 for v in expected['targets'].values()));private('pre-switch-storage.private.json',preswitch);result.update(success=True,onlyFactoryReviewAndTestRebuilt=True,allNonFactoryContainersUnchanged=True,fourPreexistingChangesPreserved=True,canonicalGitSourceModesVerified=True,environmentAndProcessMapsPreserved=True,fullTargetConfigurationPreserved=True,allCandidatesPreparedBeforeFlags=True,closedPreSwitchBackupsRetained=True,automaticSchemaDowngradeOrDataRestorePerformed=False,runtimeAfter=expected,publicAssets=public,sourceProof=proofs)

def timestamp(value):
 match=re.fullmatch(r'(\d{4}-\d\d-\d\d[ T]\d\d:\d\d:\d\d)(?:\.(\d{1,9}))?(Z|[+-]\d\d:\d\d)',value or'')
 if not match:return None
 try:return datetime.datetime.fromisoformat((match[1]+('.'+match[2][:6].ljust(6,'0')if match[2]else'')+match[3]).replace('Z','+00:00')).astimezone(datetime.timezone.utc)
 except ValueError:return None
def log_policy(path,started):
 with contextlib.closing(CORE.OPS.L.connect(path,True))as db:
  row=db.execute("SELECT CASE WHEN json_valid(value) THEN json_extract(value,'$.logs.maxDays') END,CASE WHEN json_valid(value) THEN json_extract(value,'$.logs.minLevel') END,CASE WHEN json_valid(value) THEN json_type(value,'$.logs.maxDays') END,CASE WHEN json_valid(value) THEN json_type(value,'$.logs.minLevel') END FROM _params WHERE id='settings'").fetchone()
 start=timestamp(started)
 if row is None or row[2:]!=('integer','integer')or type(row[0])is not int or not 0<=row[0]<=36500 or type(row[1])is not int or not -100<=row[1]<=100 or start is None:return None
 return {'cutoff':start-datetime.timedelta(days=row[0]),'minLevel':row[1]}
def logs_retention(oldpath,newpath,olddata,newdata,started):
 policies=[log_policy(p,started)for p in (olddata,newdata)];policy=policies[0]if policies[0]is not None and policies[0]==policies[1]else None;counts={'oldRows':0,'retainedTypedIdentical':0,'retainedTypedChanged':0,'missing':0,'missingCompatibleWithConfiguredRetention':0,'newRows':0,'configuredPolicyAvailableAndUnchanged':policy is not None}
 with contextlib.closing(CORE.OPS.L.connect(oldpath,True))as db:
  db.execute('ATTACH DATABASE ? AS afterdb',(newpath.as_uri()+'?mode=ro&immutable=1',));columns=db.execute('PRAGMA table_xinfo(_logs)').fetchall();need(columns==db.execute('PRAGMA afterdb.table_xinfo(_logs)').fetchall()and columns and[c[1]for c in columns if c[5]]==['id']);names=[c[1]for c in columns];need({'id','created','level'}<=set(names));q=CORE.OPS.L.quote;need(all(db.execute('SELECT count(*)=count(DISTINCT id) FROM '+prefix+'._logs').fetchone()==(1,)for prefix in ('main','afterdb')));query='SELECT '+','.join('a.'+q(n)for n in names)+','+','.join('b.'+q(n)for n in names)+' FROM _logs a LEFT JOIN afterdb._logs b ON a.id=b.id AND typeof(a.id)=typeof(b.id)';n=len(names);idindex=names.index('id')
  for row in db.execute(query):
   counts['oldRows']+=1;a,b=row[:n],row[n:]
   if b[idindex]is not None:counts['retainedTypedIdentical'if[CORE.OPS.L.cell(x)for x in a]==[CORE.OPS.L.cell(x)for x in b]else'retainedTypedChanged']+=1;continue
   counts['missing']+=1;created=timestamp(a[names.index('created')]);level=a[names.index('level')];compatible=policy is not None and((created is not None and created<=policy['cutoff'])or(type(level)is int and level<policy['minLevel']));counts['missingCompatibleWithConfiguredRetention']+=int(compatible)
  counts['newRows']=db.execute('SELECT count(*) FROM afterdb._logs b LEFT JOIN _logs a ON a.id=b.id AND typeof(a.id)=typeof(b.id) WHERE a.id IS NULL').fetchone()[0]
 counts['compatibleWithoutChangingRetainedRows']=counts['retainedTypedChanged']==0 and counts['missing']==counts['missingCompatibleWithConfiguredRetention'];return counts

def delta_summary(old,new):
 facts={}
 for database in ('data.db','auxiliary.db'):
  a,b=old['sqlite'][database],new['sqlite'][database];facts[database]={'strictSchemaAndTypedRowsIdentical':a==b,'changedTables':{name:{'beforeRows':a['tables'].get(name,{}).get('rows'),'afterRows':b['tables'].get(name,{}).get('rows'),'strictTypedIdentical':a['tables'].get(name)==b['tables'].get(name)}for name in sorted(set(a['tables'])|set(b['tables']))if a['tables'].get(name)!=b['tables'].get(name)},'schemaIdentical':a['schema']==b['schema']}
 facts['storageBytesAndPermissionsIdentical']=old['files']==new['files'];facts['databaseFileModesAndOwnersIdentical']=old['databaseFileMetadata']==new['databaseFileMetadata'];facts['differenceDoesNotIdentifyActor']=True;return facts

def observation_archive(path):
 need(path.is_dir()and not path.is_symlink()and stat.S_IMODE(path.stat().st_mode)==0o700);manifest=json.loads((path/'manifest.json').read_bytes());entries=list(path.rglob('*'));need(len(entries)<=100000 and all(not p.is_symlink()and(p.is_file()or p.is_dir())and p.stat().st_mode&0o077==0 for p in entries));need(set(manifest)=={str(p.relative_to(path))for p in entries if p.is_file()and p!=path/'manifest.json'}and all(CORE.OPS.L.safe_path(n)and re.fullmatch('[a-f0-9]{64}',h)and CORE.OPS.L.file_hash(path/n)==h for n,h in manifest.items()));return sha((path/'manifest.json').read_bytes())

def verify(result,before,files):
 global STAGE
 STAGE='deployed-private-receipt';receipt=archive(DEPLOY,DEPLOY_MANIFEST,DEPLOY_RESULT);need(receipt.get('target')==TARGET and receipt.get('onlyFactoryReviewAndTestRebuilt')is True and receipt.get('bothCandidatesBuiltAndSealedBeforeAnyMaintenance')is True and receipt.get('closedPreSwitchBackupsRetained')is True);current,_=CORE.runtime();need(current==receipt['runtimeAfter']and current['others']==before['runtime']['others']);checked_source(TARGET,before,files,True);old_flags=flags();need(old_flags==before['maintenanceInventory']);snapshots={};proofs={};checks={};retention={};models={};prior_differences={};original_models={};captured_at={};observation=OUT/'observation';observation.mkdir(mode=0o700);saved=CORE.OUT
 STAGE='capture-full-raw-observation-before-comparison';CORE.OUT=observation
 try:
  for service,relative in CORE.SERVICES.items():
   maintenance('require_maintenance_cleared',service);snapshots[service]=CORE.OPS.sqlite_capture(service,CORE.APP/relative,observation/service);need(set(snapshots[service]['sqlite'])=={'data.db','auxiliary.db'});snapshots[service]['databaseFileMetadata']={n:CORE.file_metadata(CORE.APP/relative/n)for n in ('data.db','auxiliary.db')};captured_at[service]=datetime.datetime.now(datetime.timezone.utc).isoformat()
  CORE.OPS.L.private_write(observation/'observed.private.json',enc({'pocketbase':snapshots,'runtime':current,'capturedAt':captured_at}));CORE.OPS.L.seal(observation)
 finally:CORE.OUT=saved
 result['rawObservationSealedBeforeAnyDataComparison']=True;result['rawObservationManifestSHA256']=observation_archive(observation)
 STAGE='load-exact-readonly-migration-comparator';path=pathlib.Path(__file__).with_name('factory-review-migration-compare-library.py');need(path.is_file()and not path.is_symlink()and sha(path.read_bytes())==COMPARATOR_SHA);spec=importlib.util.spec_from_file_location('factory973_exact_readonly_migration',path);comparator=importlib.util.module_from_spec(spec);spec.loader.exec_module(comparator)
 for service in CORE.SERVICES:
  STAGE=service+'-source-proof-after-raw-observation-sealed';proofs[service]=CORE.runtime_files(service,current['targets'][service]);STAGE=service+'-exact-additive-migration-comparison';folder=DEPLOY/('pre-switch-'+service);observation_archive(folder);old=json.loads((folder/'observed.private.json').read_bytes());new=snapshots[service];prior_differences[service]=delta_summary(before['pocketbase'][service],old);started=current['targets'][service]['started'];models[service]=comparator.compare(folder/service/'sqlite/data.db',observation/service/'sqlite/data.db',started,captured_at[service],CORE.OPS.L);original_models[service]=comparator.compare(BACKUP/service/'sqlite/data.db',observation/service/'sqlite/data.db',started,captured_at[service],CORE.OPS.L)
  checks[service+'OnlyExpectedMigrationFromClosedPreSwitchSnapshot']=models[service]['allExpectedMigrationChecksPassed'];checks[service+'StorageBytesAndPermissionsPreservedFromPreSwitch']=old['files']==new['files'];checks[service+'DatabaseFileModesAndOwnersPreserved']=old['databaseFileMetadata']==new['databaseFileMetadata']==before['pocketbase'][service]['databaseFileMetadata'];a,b=old['sqlite']['auxiliary.db'],new['sqlite']['auxiliary.db'];checks[service+'AuxiliarySchemaAndNonLogTablesIdentical']=a['schema']==b['schema']and{k:v for k,v in a['tables'].items()if k!='_logs'}=={k:v for k,v in b['tables'].items()if k!='_logs'}
  retention[service]=logs_retention(folder/service/'sqlite/auxiliary.db',observation/service/'sqlite/auxiliary.db',folder/service/'sqlite/data.db',observation/service/'sqlite/data.db',started);checks[service+'LogsRetainedRowsAndConfiguredRetentionCompatible']=retention[service]['compatibleWithoutChangingRetainedRows'];checks[service+'ConfigurationMapsPreserved']=config_same(before['runtime']['targets'][service],current['targets'][service]);checks[service+'RunningSourceMatchesSealedCandidate']=proofs[service]['files']==json.loads((DEPLOY/(service+'-candidate-files.private.json')).read_bytes());public_assets(service,proofs[service])
 STAGE='final-byte-and-runtime-proof';need(observation_archive(observation)==result['rawObservationManifestSHA256']);checked_source(TARGET,before,files,True);need(CORE.runtime()[0]==current and flags()==old_flags);original();archive(DEPLOY,DEPLOY_MANIFEST,DEPLOY_RESULT);result.update(deploymentVerified=True,checks=checks,exactMigrationFromPreSwitch=models,originalBackupMigrationComparison=original_models,originalBackupToPreSwitch=prior_differences,preSwitchBusinessDifferencesRequireReadOnlyAttribution=any(not v['data.db']['strictSchemaAndTypedRowsIdentical']for v in prior_differences.values()),logRetentionClassification=retention,logRetentionCompatibilityDoesNotIdentifyActor=True,requiresPostSwitchBusinessRowInvestigation=any(not v['checks']['AllTypedTablesMatchExactlyModeledMigration']for v in models.values()),allOtherContainersPreserved=True,allMaintenanceFlagsRestored=True,success=all(checks.values()))

def recover_only_before_candidate_start(result):
 if DRAIN is None or DRAIN['candidateSwitchAttempted']:return
 service=DRAIN['service'];cid=DRAIN['id'];expected=DRAIN['expected'];result['oldContainerRecoveryAttemptedBeforeAnyCandidateStart']=True;present=raw_inventory();old=present.get(cid);need(old is not None and old['Image']==expected['targets'][service]['image']and old['OOMKilled']is False)
 if old['Running']is False:operation(['docker','start',cid],45)
 maintenance('wait_service_ready',service);after,raw=CORE.runtime();need(after['others']==expected['others']and all(after['targets'][s]==expected['targets'][s]for s in CORE.SERVICES if s!=service));a,b=expected['targets'][service],after['targets'][service];need(a['id']==b['id']and a['image']==b['image']and config_same(a,b)and a['restarts']==b['restarts']);need(flags(service)==[r for r in DRAIN['oldFlags']if r['path']!='services/'+service]);maintenance('maintenance_off',service);maintenance('require_maintenance_cleared',service);need(flags()==DRAIN['oldFlags']);result['sameOldContainerRestoredWithoutCandidateStartupOrSchemaDowngrade']=True

def main():
 global CORE,OUT,ENV,STAGE
 need(len(sys.argv)==2 and sys.argv[1]in {'deploy','verify'});mode=sys.argv[1];need((DEPLOY_PIN if mode=='deploy'else VERIFY_PIN)and re.fullmatch('[a-f0-9]{40}',TARGET or'')and re.fullmatch('[a-f0-9]{40}',TREE or'')and re.fullmatch('[a-f0-9]{64}',SOURCE_MANIFEST_SHA or'')and os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_ATTEMPT')=='1')
 os.umask(0o077);OUT=DEPLOY if mode=='deploy'else VERIFY;OUT.mkdir(mode=0o700);CORE=core_load();CORE.OUT=OUT;CORE.OPS=CORE.load('release-data-ops-library.py');CORE.OPS.L=CORE.OPS.load_library(pathlib.Path(__file__).with_name('release-data-library.py'));CORE.OPS.run=CORE.run
 ENV=dict(os.environ,AFTER_COMMIT=TARGET,COMPOSE_BAKE='false',COMPOSE_PARALLEL_LIMIT='1',COMPOSE_PROJECT_NAME='rr-portal',MAINT_FLAG_DIR=str(ROOT/'deploy/maintenance'),COMPOSE_FILE=str(ROOT/'docker-compose.cloud.yml'),ENV_FILE=str(ROOT/'.env.cloud.production'),MAINT_COMPOSE_SERVICES='factory-review\nfactory-review-test',MAINT_HEALTH_TIMEOUT_SECONDS='300',MAINT_DNS_GRACE_SECONDS='10')
 def stop(*_):need(False)
 signal.signal(signal.SIGTERM,stop);result={'mode':mode,'success':False,'target':TARGET,'expectedTree':TREE,'businessWritesPerformed':False,'credentialsChanged':False,'envFileModified':False,'globalHooksRun':False,'globalMaintenanceChanged':False,'automaticRollback':False}
 try:
  before=original();files=source_manifest();(deploy if mode=='deploy'else verify)(result,before,files)
 except BaseException:
  result['failedStage']=STAGE;private('failure-traceback.private.txt',traceback.format_exc().encode())
  if mode=='deploy':
   try:recover_only_before_candidate_start(result)
   except BaseException:result['oldContainerRecoveryFailedMaintenanceRetained']=True;private('recovery-failure-traceback.private.txt',traceback.format_exc().encode())
 finally:
  CORE.OPS.L.private_write(OUT/'first-result.json',enc(result));CORE.OPS.L.seal(OUT);public={k:v for k,v in result.items()if k not in {'runtimeAfter','sourceProof'}};need(len(enc(public))<24000);print(enc(dict(public,resultSHA256=CORE.OPS.L.file_hash(OUT/'first-result.json'),manifestSHA256=CORE.OPS.L.file_hash(OUT/'manifest.json'))).decode(),flush=True)
 return 0 if result['success']else 1
if __name__=='__main__':
 try:exit_code=main()
 except BaseException:print('{"success":false,"safeFailure":"FACTORY_REVIEW_973_RELEASE_PREFLIGHT_FAILED"}',flush=True);exit_code=1
 sys.exit(exit_code)
