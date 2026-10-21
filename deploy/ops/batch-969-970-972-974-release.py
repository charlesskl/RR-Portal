"""Four-service immutable preparation, scoped switching and sealed verification. All gates false."""
import ast,contextlib,copy,datetime,hashlib,importlib.util,json,os,pathlib,re,signal,sqlite3,stat,subprocess,sys,time,traceback,urllib.error,urllib.parse,urllib.request
ROOT=pathlib.Path('/opt/rr-portal');BASE='7ce02db904cdd769ecd35148d50be15ec4fce210';TARGET='dfcdf751cae42fdd1731729dd662fce041c28caf';TREE='d5a107e898fe35066416fa0431ccd92400467875'
BRANCH='refs/heads/ops/batch-969-970-972-974-20261021';PREPARE_PIN=True;DEPLOY_PIN=False;VERIFY_PIN=False
CORE_SHA='4745c90f126cf46106b0f170a3ebc6b24ccb64c0e963e427d13308d5cb5b54f5';SOURCE_MANIFEST_SHA='7efb90de8b783dee9241c6e239d6a72cd9946dccad5f509d86cac62ac2041799';EXPECTED_CHANGED_FILES=16
BACKUP=ROOT/'deploy/backups/batch-969-970-972-974-20261021-backup-02';BACKUP_MANIFEST='5b5e544aa5fa2849ca7e2dc5583c803b694a214b7d2d1b8c818fe349bcdfb8f5';BACKUP_RESULT='5e6316717fb94d3b324e9071cbfa6fcfeedd03e8d484dc348882f6cde7db9afd'
PREPARE=BACKUP.with_name('batch-969-970-972-974-20261021-prepare');PREPARE_MANIFEST='';PREPARE_RESULT=''
DEPLOY=BACKUP.with_name('batch-969-970-972-974-20261021-deploy');DEPLOY_MANIFEST='';DEPLOY_RESULT=''
VERIFY=BACKUP.with_name('batch-969-970-972-974-20261021-verify')
ORDER=('qc-report','toyqms','indo-shipping','internal-quote')
COMPOSE=['docker','compose','-p','rr-portal','-f',str(ROOT/'docker-compose.cloud.yml'),'--env-file',str(ROOT/'.env.cloud.production')]
STAGE='entrypoint';FAILED_CHECK=None;COUNTER=0;CORE=None;OUT=None;ENV=None;DRAIN=None

def need(value,label='invariant'):
 global FAILED_CHECK
 if not value:
  need_label=label if type(label)is str and re.fullmatch('[A-Za-z0-9_.-]{1,140}',label)else'invalid-check-name'
  FAILED_CHECK=need_label
  raise RuntimeError('BATCH_969_974_RELEASE_REJECTED')

def enc(value):return json.dumps(value,ensure_ascii=True,sort_keys=True,separators=(',',':'),allow_nan=False).encode()

def sha(value):return hashlib.sha256(value).hexdigest()

def pin(value,n=64):return type(value)is str and bool(re.fullmatch('[a-f0-9]{%d}'%n,value))

def read_json(path):return json.loads(CORE.stable_environment_bytes(path))

def private_capture(args,name,timeout=180,data=None):
 global COUNTER
 need(type(name)is str and re.fullmatch('[a-zA-Z0-9_.-]+',name),'capture-name')
 COUNTER+=1;path=OUT/('%04d-%s.stdout.private'%(COUNTER,name))
 with path.open('xb')as output,(OUT/('%04d-%s.stderr.private'%(COUNTER,name))).open('xb')as errors:
  result=subprocess.run(args,input=data,stdout=output,stderr=errors,timeout=timeout,cwd=ROOT,env=ENV)
  output.flush();os.fsync(output.fileno())
 need(result.returncode==0,'command-return-code');need(path.stat().st_size<=128*1024**2,'command-stdout-bound')
 return path.read_bytes()

def operation(args,name,timeout=180,checkout=False):
 global COUNTER
 COUNTER+=1;path=OUT/('%04d-%s.operation.private.log'%(COUNTER,name))
 with path.open('xb')as output:
  result=subprocess.run(args,stdout=output,stderr=subprocess.STDOUT,timeout=timeout,cwd=ROOT,env=ENV,umask=0o022 if checkout else -1)
 need(result.returncode==0,'operation-return-code');return path

def load_core():
 path=pathlib.Path(__file__).with_name('batch-backup-library.py')
 need(pin(CORE_SHA,64)and path.is_file()and not path.is_symlink()and sha(path.read_bytes())==CORE_SHA,'core-file-pin')
 spec=importlib.util.spec_from_file_location('reviewed_six_service_backup',path);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
 module.OUT=OUT;module.initialize();return module

def archive(path,manifest_hash,result_hash):
 need(pin(manifest_hash,64)and pin(result_hash,64),'archive-pins')
 need(path.is_dir()and not path.is_symlink()and stat.S_IMODE(path.stat().st_mode)==0o700,'archive-directory')
 need(CORE.OPS.L.file_hash(path/'manifest.json')==manifest_hash and CORE.OPS.L.file_hash(path/'first-result.json')==result_hash,'archive-receipt-seals')
 manifest=read_json(path/'manifest.json');entries=list(path.rglob('*'))
 need(len(entries)<=100000 and all(not p.is_symlink()and(p.is_file()or p.is_dir())and p.stat().st_mode&0o077==0 for p in entries),'archive-private-entries')
 need(set(manifest)=={str(p.relative_to(path))for p in entries if p.is_file()and p!=path/'manifest.json'},'archive-complete-manifest')
 need(all(CORE.OPS.L.safe_path(name)and pin(checksum,64)and CORE.OPS.L.file_hash(path/name)==checksum for name,checksum in manifest.items()),'archive-full-byte-seals')
 receipt=read_json(path/'first-result.json');need(receipt.get('success')is True,'archive-success-receipt');return receipt

def source_manifest():
 path=pathlib.Path(__file__).with_name('batch-969-970-972-974-reviewed-files.json')
 need(path.is_file()and not path.is_symlink()and sha(path.read_bytes())==SOURCE_MANIFEST_SHA,'reviewed-manifest-pin')
 files=json.loads(path.read_bytes())
 need(type(files)is dict and len(files)==EXPECTED_CHANGED_FILES and 0<len(files)<=500,'reviewed-file-count')
 need(all(CORE.OPS.L.safe_path(name)and pin(checksum,64)and any(name.startswith(prefix+'/')for prefix in CORE.APP_PREFIXES)for name,checksum in files.items()),'reviewed-file-scope')
 return files

def checked_source(revision,before,files):
 CORE.BASE=revision;configuration=CORE.source();need(CORE.stable_file_metadata(ROOT/'.env.cloud.production')==before['environmentFileMetadata'],'environment-file-metadata-byte-identity')
 need(CORE.dirty_snapshot()==before['preexistingFourDirty'],'four-dirty-exactly-preserved')
 need(CORE.OPS.L.file_hash(ROOT/'.env.cloud.production')==before['environmentSHA256'],'private-environment-file-byte-identical')
 need(CORE.run(['git','rev-parse',TARGET+'^{tree}']).decode().strip()==TREE,'reviewed-target-tree')
 changed=CORE.run(['git','diff','--name-only','-z','--no-ext-diff','--no-textconv',BASE,TARGET]).decode().strip('\0').split('\0')
 need(set(changed)==set(files)and not set(changed)&set(before['preexistingFourDirty']),'exact-reviewed-source-diff')
 for name,checksum in configuration.items():need(checksum==(files[name]if revision==TARGET and name in files else before['configuration'][name]),'fixed-configuration-'+sha(name.encode())[:12])
 for name,checksum in files.items():
  need(sha(CORE.run(['git','show',TARGET+':'+name]))==checksum,'manifest-versus-target-blob')
  if revision==TARGET:
   entry=CORE.run(['git','ls-tree','-z',TARGET,'--',name]).split(b'\t',1);need(len(entry)==2 and entry[1]==name.encode()+b'\0'and re.fullmatch(b'100(?:644|755) blob [a-f0-9]{40}',entry[0]),'canonical-file-git-mode')
   path=ROOT/name
   for ancestor in(path,*path.parents):
    if ancestor==ROOT:break
    need(not ancestor.is_symlink(),'canonical-file-no-symlink')
   need(path.is_file()and stat.S_IMODE(path.stat().st_mode)==(0o755 if entry[0].startswith(b'100755')else 0o644)and CORE.OPS.L.file_hash(path)==checksum,'canonical-source-byte-and-mode')
 return configuration

def flags(exclude_alias=None):
 path=ROOT/'deploy/maintenance';need(path.is_dir()and not path.is_symlink(),'maintenance-root')
 return [row for row in CORE.OPS.L.non_database_inventory(path,[])if row['path']!='services/'+str(exclude_alias)]

def effective_candidate_config(candidate,declared,oldraw):
 config=candidate['Config'];old=oldraw['Config'];result={}
 for field,override in(('Cmd','command'),('Entrypoint','entrypoint'),('WorkingDir','working_dir'),('User','user')):
  value=declared.get(override);expected=old.get(field)
  if value is None:value=config.get(field)
  if field in{'Cmd','Entrypoint'}and declared.get(override)is None:value=config.get(field)
  same=value==expected
  # A non-null entrypoint suppresses the image CMD when command is null/absent.
  # This batch has null overrides; conservatively reject that more complex case.
  if field=='Cmd'and declared.get('command')is None and declared.get('entrypoint')is not None:same=False
  if field=='User'and override not in declared and value in(None,'')and expected in(None,''):same=True
  result[field+'MatchesPreservedRuntime']=same
 return result

def pid_environment(cid):
 content=CORE.run(['docker','exec',cid,'cat','/proc/1/environ']);need(content.endswith(b'\0'),'pid1-environment-format')
 environment=CORE.envmap([value.decode()for value in content.split(b'\0')if value]);need(environment.pop('HOSTNAME',None)==cid[:12],'automatic-hostname-exact')
 return environment

def original():
 receipt=archive(BACKUP,BACKUP_MANIFEST,BACKUP_RESULT)
 need(receipt.get('base')==BASE and all(receipt.get(k)is True for k in('backupComplete','allFourTargetServicesBound','allPersistentMountsCaptured','allOriginalFullTypedRowsAndSchemaCaptured','privateEnvironmentFileBackedUp','fourExistingTrackedChangesPreserved','allOtherContainersUnchanged','allMaintenanceFlagsUnchanged','startupSafetyPassed')),'complete-four-service-original')
 before=read_json(BACKUP/'baseline.private.json');need(before['head']==BASE and set(before['runtime']['targets'])==set(ORDER)==CORE.SERVICES and set(before['storage'])==set(CORE.STORAGE)and before['startupChecks']['allExistingStartupGuardsPassed']is True,'exact-original-scope');need(set(before['sourceProof'])==set(ORDER)and all(before['sourceProof'][s].get('reviewedSourceMatch')is True for s in ORDER),'all-original-runtime-sources-reviewed');return before

def runtime_stable(expected,before,files,alias=None):
 current,raw=CORE.runtime();need(current==expected,'runtime-exactly-unchanged');checked_source(TARGET,before,files);need(flags(alias)==[r for r in before['maintenanceInventory']if r['path']!='services/'+str(alias)],'unrelated-maintenance-unchanged');roots,mounts=CORE.storage_roots(raw);need(mounts==before['storageMounts'],'persistent-mount-bindings-unchanged');CORE.storage_contract(raw,current['databaseContainer']);return current,raw,roots

def compose_base():
 need(CORE.run(['docker','compose','version','--short']).decode().strip()=='5.1.0','compose-version');base=json.loads(private_capture([*COMPOSE,'config','--format','json'],'compose-base',90));need(base==read_json(BACKUP/'compose-render.private.json'),'base-compose-byte-semantics-unchanged');return base

def overlay(before,images,build=False):
 need(set(images)==set(ORDER),'four-overlay-images');base=compose_base();expected=copy.deepcopy(base);lines=['services:'];literal={}
 for service in ORDER:
  actual=read_json(BACKUP/(service+'-literal-configured-environment.private.json'));need(type(actual)is dict and all(type(k)is str and type(v)is str for k,v in actual.items()),'sealed-full-literal-environment');literal[service]=actual;image=images[service];need(image=='rr-portal-'+service+'-969-974:'+TARGET if build else pin(image.removeprefix('sha256:'))and image.startswith('sha256:'),'fixed-image-reference');serialized=CORE.serialized_environment(actual);lines.extend(['  '+service+':','    environment: !override '+json.dumps(serialized,ensure_ascii=True,separators=(',',':')),'    image: '+image,'    pull_policy: never']);expected['services'][service].update(environment=serialized,image=image,pull_policy='never')
  if build:
   label=dict(base['services'][service].get('build',{}).get('labels')or{});label['org.opencontainers.image.revision']=TARGET;lines.extend(['    build:','      labels: '+json.dumps(label,separators=(',',':'))]);expected['services'][service]['build']['labels']=label
 name='build-images-and-literal-env.private.yml'if build else'runtime-images-and-literal-env.private.yml';path=OUT/name;CORE.OPS.L.private_write(path,('\n'.join(lines)+'\n').encode());args=[*COMPOSE,'-f',str(path)];observed=json.loads(private_capture([*args,'config','--format','json'],'validated-compose',90));need(observed==expected,'only-four-image-env-build-label-overlay-fields');return args,observed,literal

def candidate_facts(service,image,raw,declared,literal):
 old=read_json(BACKUP/(service+'-image.private.json'));need(old['Id']==raw['Image']and pin(image['Id'].removeprefix('sha256:'))and image['Id'].startswith('sha256:'),'old-candidate-image-binding');need(image.get('Architecture')==old.get('Architecture')=='amd64'and image.get('Os')==old.get('Os')=='linux','candidate-platform');need((image['Config'].get('Labels')or{}).get('org.opencontainers.image.revision')==TARGET,'candidate-oci-revision');need(image['Config'].get('Healthcheck')==old['Config'].get('Healthcheck'),'candidate-healthcheck');expected_labels=dict(old['Config'].get('Labels')or{});expected_labels['org.opencontainers.image.revision']=TARGET;need((image['Config'].get('Labels')or{})==expected_labels,'candidate-only-revision-label-change');actual=CORE.envmap(raw['Config']['Env']);proposed=dict(CORE.envmap(image['Config'].get('Env')or[]),**literal);guards=effective_candidate_config(image,declared,raw);guards['EntireActualConfiguredEnvironmentPreserved']=actual==literal==proposed
 need(all(v is True for v in guards.values()),'candidate-all-config-env-guards-'+service);proof=CORE.candidate_source_proof(service,image['Id'],TARGET);need(proof.get('reviewedSourceMatch')is True,'candidate-source-'+service);return {'image':image['Id'],'configurationGuards':guards,'environmentSHA256':sha(enc(proposed)),'sourceProof':proof}

def checked_proof(service,proof,candidate):
 need(proof.get('reviewedSourceMatch')is True,'actual-reviewed-source-'+service)
 for key in('sourceFileSHA256','expectedSourceFileSHA256','compiledArtifactInventory','compiledArtifactInventorySHA256','projects','copiedRuntimeDataFilesMatchBase'):
  if key in candidate:need(proof.get(key)==candidate[key],'actual-candidate-source-or-artifact-'+service)
 return True

def configuration_preserved(before,after,args):
 need(before['HostConfig']==after['HostConfig']and sorted(before['Mounts'],key=enc)==sorted(after['Mounts'],key=enc),'complete-hostconfig-mounts');old=copy.deepcopy(before['Config']);new=copy.deepcopy(after['Config']);labels=old.pop('Labels')or{};fresh=new.pop('Labels')or{};need(old.pop('Hostname')==before['Id'][:12]and new.pop('Hostname')==after['Id'][:12],'automatic-hostname-only');old.pop('Image');need(new.pop('Image')==after['Image'],'literal-runtime-image-id');old['Env']=sorted(old['Env']);new['Env']=sorted(new['Env']);need(old==new,'complete-config-preserved');expected=copy.deepcopy(labels);expected['org.opencontainers.image.revision']=TARGET;expected['com.docker.compose.image']=after['Image'];expected['com.docker.compose.project.config_files']=','.join([str(ROOT/'docker-compose.cloud.yml'),str(DEPLOY/'runtime-images-and-literal-env.private.yml')]);service=fresh['com.docker.compose.service'];hashes=private_capture([*args,'config','--hash',service],'compose-config-hash').decode().split();need(len(hashes)==2 and hashes[0]==service and pin(hashes[1]),'compose-config-hash-shape');expected['com.docker.compose.config-hash']=hashes[1];need(fresh==expected,'only-fixed-compose-and-revision-labels')

def raw_inventory():
 ids=private_capture(['docker','ps','-aq','--no-trunc'],'all-container-ids').decode().split();need(0<len(ids)<=1000 and len(ids)==len(set(ids))and all(pin(v)for v in ids),'bounded-container-ids');rows=json.loads(private_capture(['docker','inspect',*ids],'all-container-inspects'));need(type(rows)is list and len(rows)==len(ids),'one-inspect-per-container');result={}
 for row in rows:
  cid=row['Id'];need(cid in ids and cid not in result,'unique-container');result[cid]={'Id':cid,'Image':row['Image'],'Config':dict(row['Config'],Env=sorted(row['Config']['Env'])),'HostConfig':row['HostConfig'],'Mounts':sorted(row['Mounts'],key=enc),'Running':row['State']['Running'],'OOMKilled':row['State']['OOMKilled'],'StartedAt':row['State']['StartedAt'],'RestartCount':row['RestartCount']}
 return result

def maintenance(fn,service):
 need(service in ORDER and fn in{'maintenance_on','maintenance_off','wait_service_ready','require_maintenance_cleared'},'scoped-maintenance-command');operation(['bash','-c','set -euo pipefail; source "$1"; "$2" "$3"','four-service-release',str(ROOT/'deploy/service-maintenance.sh'),fn,service],'maintenance-'+fn+'-'+service,340)

def health(service):
 need(service in ORDER,'fixed-health-service');path={'qc-report':'/qc-report/health','toyqms':'/toyqms/api/health','indo-shipping':'/indo-shipping/api/health','internal-quote':'/internal-quote/health'}[service];return static_get(path,1024**2)

def static_get(path,limit=16*1024**2):
 need(path.startswith('/')and not path.startswith('//')and'?'not in path and'#'not in path and'..'not in path.split('/'),'fixed-public-path')
 class NoRedirect(urllib.request.HTTPRedirectHandler):
  def redirect_request(self,*_):return None
 request=urllib.request.Request('http://127.0.0.1'+path,headers={'Host':'8.148.146.194','Cache-Control':'no-cache'});opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),NoRedirect())
 with opener.open(request,timeout=20)as response:raw=response.read(limit+1);need(response.status==200 and len(raw)<=limit,'public-read-only-200');return {'path':path,'status':200,'bytes':len(raw),'sha256':sha(raw)}

def public_assets(service,proof):
 inventory=proof.get('compiledArtifactInventory')
 if not inventory:return {'compiledPublicArtifactsNotApplicable':True}
 prefix='out/'if service=='toyqms'else'wwwroot/';base='/'+service+'/';need(prefix+'index.html'in inventory,'compiled-index-captured');selected={name:row for name,row in inventory.items()if name==prefix+'index.html'or name.startswith(prefix+('_next/static/'if service=='toyqms'else'assets/'))};need(1<len(selected)<=10000,'bounded-public-compiled-assets')
 for name,row in selected.items():
  relative=name[len(prefix):];url=base if relative=='index.html'else base+urllib.parse.quote(relative,safe='/-._~');got=static_get(url);need(got['sha256']==row['sha256']and got['bytes']==row['bytes'],'public-bytes-match-running-immutable-image')
 return {'indexAndAllStaticCodeAssetBytesMatchCandidate':True,'assetCount':len(selected),'assetInventorySHA256':sha(enc(selected))}

def toy_stopped_storage(roots,directory,oldid,stopped):
 need(set(roots)=={'toyqms'}and oldid in stopped and stopped[oldid]['Running']is False and stopped[oldid]['OOMKilled']is False,'toy-only-stopped-writer-quiet-capture');tree=roots['toyqms'];need(raw_inventory()==stopped,'toy-quiet-runtime-before')
 for cid,row in stopped.items():
  if not row['Running']:continue
  for mount in row['Mounts']:
   if mount.get('RW'):
    path=pathlib.Path(mount['Source']);need(path!=tree and tree not in path.parents and path not in tree.parents,'no-other-running-configured-writer-to-toy-store')
 names=CORE.OPS.database_names(tree);need('toyqms.db'in names,'toy-database-existing');companions=[tree/(n+suffix)for n in names for suffix in('-wal','-journal')]
 def quiet():return all(not p.exists()and not p.is_symlink()or p.is_file()and not p.is_symlink()and p.stat().st_size==0 for p in companions)
 if quiet():
  target=directory/'toyqms';target.mkdir(mode=0o700);copies=target/'sqlite';copies.mkdir(mode=0o700);value={'sqlite':CORE.OPS.L.snapshots(tree,copies,immutable=True),'files':CORE.OPS.L.non_database_inventory(tree,names,target/'files.tar')};need(CORE.OPS.database_names(tree)==names and quiet(),'toy-quiet-companions-stable-before-after')
 else:value=CORE.OPS.sqlite_capture('toyqms',tree,directory/'toyqms')
 value['originalSQLiteMetadata']={n:CORE.file_metadata(tree/n)for n in value['sqlite']};need(raw_inventory()==stopped,'toy-quiet-runtime-after');return {'toyqms':value}

def release_storage(roots,stopped=None,oldid=None):
 value=toy_stopped_storage(roots,CORE.OUT,oldid,stopped)if oldid is not None else CORE.capture_storage(roots)
 for key,row in value.items():
  root=roots[key];row['persistentFileOwners']={}
  for item in row['files']:
   path=root/item['path'];need(not path.is_symlink()and(path.is_file()or path.is_dir()),'persistent-file-owner-regular-entry');metadata=path.stat();need(stat.S_IMODE(metadata.st_mode)==item['mode'],'persistent-file-mode-owner-binding');row['persistentFileOwners'][item['path']]={'uid':metadata.st_uid,'gid':metadata.st_gid}
  metadata=root.stat();row['persistentRootMetadata']={'uid':metadata.st_uid,'gid':metadata.st_gid,'mode':stat.S_IMODE(metadata.st_mode)}
 return value

def storage_snapshot(name,roots,dbid,postgres=False,oldid=None,stopped=None):
 directory=OUT/name;directory.mkdir(mode=0o700);saved=CORE.OUT;CORE.OUT=directory
 try:
  data=release_storage(roots,stopped,oldid);pg=CORE.postgres_capture(dbid,directory,True)if postgres else None;observed={'storage':data,'postgres':pg,'individuallyConsistentNotCrossStoreAtomic':True};CORE.OPS.L.private_write(directory/'observed.private.json',enc(observed));CORE.OPS.L.seal(directory)
 finally:CORE.OUT=saved
 observation_archive(directory);return observed

def observation_archive(directory):
 need(directory.is_dir()and not directory.is_symlink()and stat.S_IMODE(directory.stat().st_mode)==0o700,'private-observation-root');manifest=read_json(directory/'manifest.json');items=list(directory.rglob('*'));need(len(items)<=100000 and all(not p.is_symlink()and(p.is_file()or p.is_dir())and p.stat().st_mode&0o077==0 for p in items),'private-observation-files');need(set(manifest)=={str(p.relative_to(directory))for p in items if p.is_file()and p!=directory/'manifest.json'},'whole-observation-manifest');need(all(CORE.OPS.L.safe_path(n)and pin(h)and CORE.OPS.L.file_hash(directory/n)==h for n,h in manifest.items()),'observation-full-byte-seals');return CORE.OPS.L.file_hash(directory/'manifest.json')

def qc_migration_head():
 prefix=CORE.QC+'/migrations/versions';names=CORE.git_files(prefix,TARGET);revisions={}
 for name in names:
  need(name.endswith('.py'),'only-python-migration-source');tree=ast.parse(CORE.run(['git','show',TARGET+':'+name]));values={}
  for node in tree.body:
   key=node.target.id if isinstance(node,ast.AnnAssign)and isinstance(node.target,ast.Name)else node.targets[0].id if isinstance(node,ast.Assign)and len(node.targets)==1 and isinstance(node.targets[0],ast.Name)else None
   if key in{'revision','down_revision'}:need(key not in values,'unique-migration-constant');values[key]=ast.literal_eval(node.value)
  if name.endswith('/__init__.py')and not values:continue
  revision=values.get('revision');parent=values.get('down_revision');need(type(revision)is str and bool(re.fullmatch('[a-f0-9]{12}',revision))and revision not in revisions and(parent is None or type(parent)is str),'literal-linear-migration-identity');revisions[revision]=parent
 need(revisions and all(p is None or p in revisions for p in revisions.values()),'complete-migration-ancestry');heads=set(revisions)-{p for p in revisions.values()if p is not None};need(len(heads)==1 and sum(p is None for p in revisions.values())==1,'single-qc-migration-head');head=next(iter(heads));visited=set();cursor=head
 while cursor is not None:need(cursor not in visited,'acyclic-qc-migration-chain');visited.add(cursor);cursor=revisions[cursor]
 need(visited==set(revisions),'single-connected-qc-migration-chain');return head

def sqlite_startup_checks(service,roots,immutable=False):
 need(service in ORDER and(not immutable or service=='toyqms'),'startup-service-scope')
 if service not in{'qc-report','toyqms'}:return {'notSQLiteSeedService':True}
 key,filename=('qc-report-data','qc-report.db')if service=='qc-report'else('toyqms','toyqms.db');path=roots[key]/filename;need(path.is_file()and all(not a.is_symlink()for a in(path,*path.parents)),'existing-seed-database-regular-file');checks={}
 # Live source is always WAL-aware, including when only the QC web process is stopped.
 with contextlib.closing(CORE.OPS.L.connect(path,immutable))as db:
  tables={r[0]for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
  required=('users','customers','products','purchase_orders','aql_rules','test_templates','photo_checklist_templates','defect_categories','settings','alembic_version')if service=='qc-report'else('users',)
  for table in required:checks[table+'.exists']=table in tables
  for table in('users','aql_rules','test_templates','photo_checklist_templates','defect_categories')if service=='qc-report'else('users',):checks[table+'.nonempty']=table in tables and db.execute('SELECT EXISTS(SELECT 1 FROM "'+table+'")').fetchone()[0]==1
  if service=='qc-report':
   for table,column,value in(('customers','name','Zanzoon'),('products','item_no','5226155'),('purchase_orders','po_no','PO-26032401')):checks[table+'.predefinedRowExists']=table in tables and db.execute('SELECT EXISTS(SELECT 1 FROM "'+table+'" WHERE "'+column+'"=?)',(value,)).fetchone()[0]==1
   for key in('ai_workflow_defaults_v1','ai_workflow_defaults_v2','company_name','report_title','required_photo_categories','logo_path'):checks['settings.'+key+'.exists']='settings'in tables and db.execute('SELECT EXISTS(SELECT 1 FROM settings WHERE key=?)',(key,)).fetchone()[0]==1
   head=qc_migration_head();checks['alembic.singleReviewedHead']='alembic_version'in tables and db.execute('SELECT version_num FROM alembic_version').fetchall()==[(head,)]
 return checks

def fresh_startup(service,expected,before,files):
 current,raw,roots=runtime_stable(expected,before,files);checks=CORE.quote_startup_checks(current['databaseContainer']);indo=CORE.indo_startup_guard(current['targets']['indo-shipping']['id'],current['databaseContainer']);seed=sqlite_startup_checks(service,roots);CORE.OPS.L.private_write(OUT/(service+'-fresh-startup.private.json'),enc({'quote':checks,'indo':indo,'sqliteSeedSafety':seed}));need(checks['allExistingStartupGuardsPassed']is True,'quote-existing-seed-safety');need(all(v is True for v in indo.values()),'indo-existing-startup-safety');need(all(v is True for v in seed.values()),'sqlite-existing-seed-and-migration-safety');return current,raw,roots

def prepare(result,before,files):
 global STAGE
 STAGE='prepare-original-source-runtime';CORE.BASE=BASE;need(CORE.runtime()[0]==before['runtime']and CORE.source()==before['configuration']and CORE.dirty_snapshot()==before['preexistingFourDirty']and CORE.maintenance_inventory()==before['maintenanceInventory'],'unchanged-before-build')
 STAGE='prepare-fetch-exact-main-before-target-check';operation(['git','-c','core.hooksPath=/dev/null','fetch','--no-write-fetch-head','origin','main:refs/rr-portal-batch/969-974-target'],'fetch-main',180);need(CORE.run(['git','rev-parse','refs/rr-portal-batch/969-974-target']).decode().strip()==TARGET,'fetched-main-exact-target');CORE.run(['git','merge-base','--is-ancestor',BASE,TARGET]);checked_source(BASE,before,files)
 STAGE='prepare-fast-forward-reviewed-source';operation(['git','-c','core.hooksPath=/dev/null','-c','merge.autoStash=false','merge','--ff-only','--no-autostash',TARGET],'fast-forward-main',180,True);checked_source(TARGET,before,files);expected,raw,roots=runtime_stable(before['runtime'],before,files);tags={s:'rr-portal-'+s+'-969-974:'+TARGET for s in ORDER};args,declared,literals=overlay(before,tags,True);candidates={};images={};result['builds']={}
 for service in ORDER:
  STAGE='prepare-build-'+service;runtime_stable(expected,before,files);result['builds'][service]={'attempted':True,'completed':False};log=operation([*args,'build',service],'build-'+service,1800);values=json.loads(private_capture(['docker','image','inspect',tags[service]],'candidate-'+service));need(type(values)is list and len(values)==1,'one-built-image');image=values[0];CORE.OPS.L.private_write(OUT/(service+'-candidate-image.private.json'),enc(image));candidates[service]=candidate_facts(service,image,raw[service],declared['services'][service],literals[service]);images[service]=image['Id'];result['builds'][service].update(completed=True,image=image['Id'],buildLogSHA256=CORE.OPS.L.file_hash(log));runtime_stable(expected,before,files)
 prepared={'base':BASE,'target':TARGET,'tree':TREE,'sourceManifestSHA256':SOURCE_MANIFEST_SHA,'runtimeBefore':expected,'candidateImageIDs':images,'candidates':candidates};CORE.OPS.L.private_write(OUT/'prepared.private.json',enc(prepared));result.update(success=True,allFourCandidatesBuiltAndProvenBeforeMaintenance=True,allRuntimeAndMaintenanceUnchanged=True,sourceFastForwardOnly=True,candidateImageIDs=images,maintenanceOrServiceSwitchesPerformed=False)

def prepared_evidence(before):
 receipt=archive(PREPARE,PREPARE_MANIFEST,PREPARE_RESULT);value=read_json(PREPARE/'prepared.private.json');need(receipt.get('mode')=='prepare'and receipt.get('allFourCandidatesBuiltAndProvenBeforeMaintenance')is True and receipt.get('maintenanceOrServiceSwitchesPerformed')is False,'prepared-before-maintenance');need(value['base']==BASE and value['target']==TARGET and value['tree']==TREE and value['sourceManifestSHA256']==SOURCE_MANIFEST_SHA and value['runtimeBefore']==before['runtime']and set(value['candidateImageIDs'])==set(value['candidates'])==set(ORDER),'sealed-prepared-release-binding')
 for service in ORDER:
  image=read_json(PREPARE/(service+'-candidate-image.private.json'));need(image['Id']==value['candidateImageIDs'][service]and value['candidates'][service]['image']==image['Id']and receipt['builds'][service]['completed']is True,'candidate-prepare-receipt-binding');live=json.loads(private_capture(['docker','image','inspect',image['Id']],'exact-prepared-image'));need(live==[image],'immutable-candidate-image-still-exact')
 return value

def deploy(result,before,files):
 global STAGE,DRAIN
 STAGE='deploy-sealed-preparation';prepared=prepared_evidence(before);expected,raw,roots=runtime_stable(before['runtime'],before,files);args,declared,literals=overlay(before,prepared['candidateImageIDs']);old_process={s:read_json(BACKUP/(s+'-literal-process-environment.private.json'))for s in ORDER};preswitch={};proofs={};public={}
 for service in ORDER:
  image=read_json(PREPARE/(service+'-candidate-image.private.json'));facts=candidate_facts(service,image,raw[service],declared['services'][service],literals[service]);need(facts==prepared['candidates'][service],'fresh-candidate-all-guards-match-seal')
 for service in ORDER:
  STAGE=service+'-fresh-startup-guards';current,live,roots=fresh_startup(service,expected,before,files);maintenance('require_maintenance_cleared',service);other_flags=flags(service);STAGE=service+'-scoped-maintenance-and-graceful-stop';result['maintenanceOrServiceSwitchesPerformed']=True;cid=expected['targets'][service]['id'];DRAIN={'service':service,'id':cid,'image':expected['targets'][service]['image'],'candidateAttempted':False,'expected':copy.deepcopy(expected),'before':before,'files':files,'raw':live[service]};maintenance('maintenance_on',service);need(flags(service)==other_flags,'only-own-maintenance-added');running=raw_inventory();need(running[cid]['Running']is True,'old-container-running');operation(['docker','stop','--time','30',cid],'graceful-stop-'+service,45);stopped=raw_inventory();wanted=copy.deepcopy(running);wanted[cid]['Running']=False;need(stopped==wanted,'only-selected-web-container-stopped-worker-untouched')
  STAGE=service+'-wal-aware-pre-switch-backup';selected={k:p for k,p in roots.items()if CORE.STORAGE[k][0]==service};preswitch[service]=storage_snapshot('pre-switch-'+service,selected,current['databaseContainer'],service in{'indo-shipping','internal-quote'},cid if service=='toyqms'else None,stopped if service=='toyqms'else None);need(raw_inventory()==stopped and flags(service)==other_flags,'runtime-stable-during-pre-switch-copy')
  seed=sqlite_startup_checks(service,{'toyqms':OUT/'pre-switch-toyqms/toyqms/sqlite'}if service=='toyqms'else roots,service=='toyqms');CORE.OPS.L.private_write(OUT/(service+'-immediate-pre-recreate-seed-safety.private.json'),enc(seed));need(all(v is True for v in seed.values()),'immediate-pre-recreate-sqlite-seed-safety')
  STAGE=service+'-fixed-image-recreate';DRAIN['candidateAttempted']=True;switched=time.monotonic();operation([*args,'up','-d','--force-recreate','--no-build','--pull','never','--no-deps',service],'recreate-'+service,180);maintenance('wait_service_ready',service);after,inspects=CORE.runtime();need(after['others']==expected['others']and after['databaseContainer']==expected['databaseContainer']and after['qcReportWorker']==expected['qcReportWorker']and all(after['targets'][s]==expected['targets'][s]for s in ORDER if s!=service),'all-other-containers-and-worker-preserved');row=after['targets'][service];need(row['id']!=cid and row['image']==prepared['candidateImageIDs'][service]and row['restarts']==0,'exact-new-running-candidate');configuration_preserved(raw[service],inspects[service],args);need(pid_environment(row['id'])==old_process[service],'pid1-literal-environment-preserved');proofs[service]=CORE.service_source_proof(service,row,TARGET);checked_proof(service,proofs[service],prepared['candidates'][service]['sourceProof']);time.sleep(max(0,10-(time.monotonic()-switched)));runtime_stable(after,before,files,service);STAGE=service+'-clear-only-own-maintenance';maintenance('maintenance_off',service);maintenance('require_maintenance_cleared',service);need(flags()==before['maintenanceInventory'],'all-flags-restored-after-service')
  STAGE=service+'-public-readonly-health-and-assets'
  try:public[service]={'health':health(service),'assets':public_assets(service,proofs[service])}
  except BaseException:maintenance('maintenance_on',service);raise
  expected=after;DRAIN=None
 STAGE='deploy-final-preservation';runtime_stable(expected,before,files);original();archive(PREPARE,PREPARE_MANIFEST,PREPARE_RESULT);CORE.OPS.L.private_write(OUT/'runtime-after.private.json',enc(expected));CORE.OPS.L.private_write(OUT/'pre-switch-storage.private.json',enc(preswitch));CORE.OPS.L.private_write(OUT/'source-proof.private.json',enc(proofs));result.update(success=True,allFourServicesUseSealedCandidateImages=True,allWorkersAndOtherServicesPreserved=True,allMaintenanceFlagsRestored=True,completeConfiguredAndPID1EnvironmentPreserved=True,closedOrWalConsistentPreSwitchBackupsRetained=True,qcWorkerContinuedRunningDatabaseCopiesNotCrossStoreAtomic=True,candidateImageIDs=prepared['candidateImageIDs'],publicReadOnlyProof=public)

def quote_sequence_check(old,new):
 changed=[n for n in sorted(set(old.get('sequenceStates',{}))|set(new.get('sequenceStates',{})))if old.get('sequenceStates',{}).get(n)!=new.get('sequenceStates',{}).get(n)];details={'changedSequences':changed,'actualActorOrCauseProven':False,'sequenceStatesNotMVCCAtomic':True}
 if not old.get('sequenceStateStableDuringCapture')or not new.get('sequenceStateStableDuringCapture'):return False,details
 if not changed:return True,details
 if changed!=['quote_sections_id_seq']:return False,details
 name=changed[0];a,b=old['sequenceStates'][name],new['sequenceStates'][name];definitions=[r for r in old['schema']['sequences']if r['name']==name];current=[r for r in new['schema']['sequences']if r['name']==name]
 if len(definitions)!=1 or definitions!=current:return False,details
 definition=definitions[0]
 if any(str(definition.get(k))!=v for k,v in{'increment':'1','cache':'1','ownedByTable':'quote_sections','ownedByColumn':'id'}.items())or definition.get('cycle')is not False or a.get('called')is not True or b.get('called')is not True:return False,details
 try:delta=int(b['lastValue'])-int(a['lastValue']);expected=old['tables']['quotes']['rows']*old['tables']['departments']['rows']
 except BaseException:return False,details
 details.update(delta=delta,expectedExistingStartupInsertSelectCandidates=expected,compatibleWithExistingStartupConflictConsumption=delta>=0 and delta==expected);return delta>=0 and delta==expected,details

def compare_storage(old,new):
 checks={'databaseInventory':set(old['sqlite'])==set(new['sqlite']),'allNonDatabaseFileBytesAndModes':old['files']==new['files'],'originalDatabaseModesAndOwners':old['originalSQLiteMetadata']==new['originalSQLiteMetadata']}
 for name in sorted(set(old['sqlite'])|set(new['sqlite'])):checks[name+'.allTypedRowsAndSchema']=old['sqlite'].get(name)==new['sqlite'].get(name)
 for field in('persistentFileOwners','persistentRootMetadata'):
  if field in old:checks[field]=old.get(field)==new.get(field)
 if'completeRawFileInventory'in old:checks['immutableLegacyDatabaseExactRawBytes']=old.get('completeRawFileInventory')==new.get('completeRawFileInventory')
 return checks

def closed_audits(directory,storage):
 for key,value in storage.items():
  need(key in CORE.STORAGE,'closed-storage-scope')
  for relative,expected in value['sqlite'].items():
   need(CORE.OPS.L.safe_path(relative),'closed-sqlite-relative-path');path=directory/key/'sqlite'/relative;need(path.is_file()and all(not a.is_symlink()for a in(path,*path.parents)),'closed-sqlite-regular-file')
   with contextlib.closing(CORE.OPS.L.connect(path,True))as db:need(CORE.OPS.L.audit(db)==expected,'closed-audits-match-sealed-portable-bytes')
 return True

def verify(result,before,files):
 global STAGE
 STAGE='verify-complete-deployment-seals';receipt=archive(DEPLOY,DEPLOY_MANIFEST,DEPLOY_RESULT);prepared=prepared_evidence(before);need(receipt.get('mode')=='deploy'and receipt.get('allFourServicesUseSealedCandidateImages')is True and receipt.get('allMaintenanceFlagsRestored')is True,'complete-deployment-receipt');expected=read_json(DEPLOY/'runtime-after.private.json');current,raw,roots=runtime_stable(expected,before,files);directory=OUT/'observation';directory.mkdir(mode=0o700);saved=CORE.OUT;CORE.OUT=directory
 try:
  STAGE='verify-capture-raw-before-comparison';storage=release_storage(roots);postgres=CORE.postgres_capture(current['databaseContainer'],directory,True);CORE.OPS.L.private_write(directory/'target-inspect.private.json',enc(raw));observed={'storage':storage,'postgres':postgres,'runtime':current};CORE.OPS.L.private_write(directory/'observed.private.json',enc(observed));CORE.OPS.L.seal(directory)
 finally:CORE.OUT=saved
 seal=observation_archive(directory);closed_audits(directory,storage);result.update(rawObservationSealedBeforeComparison=True,observationManifestSHA256=seal);STAGE='verify-source-after-raw-observation-seal';proof={s:CORE.service_source_proof(s,current['targets'][s],TARGET)for s in ORDER};CORE.OPS.L.private_write(OUT/'observed-source-proof.private.json',enc(proof));STAGE='verify-closed-data-comparison';preswitch=read_json(DEPLOY/'pre-switch-storage.private.json');checks={};pre_differences={};details={}
 for service in ORDER:
  observation_archive(DEPLOY/('pre-switch-'+service));need(read_json(DEPLOY/('pre-switch-'+service)/'observed.private.json')==preswitch[service],'sealed-pre-switch-value-binding');closed_audits(DEPLOY/('pre-switch-'+service),preswitch[service]['storage']);checked_proof(service,proof[service],prepared['candidates'][service]['sourceProof']);checks[service+'.candidateImage']=current['targets'][service]['image']==prepared['candidateImageIDs'][service];configuration_preserved(read_json(BACKUP/'target-inspect.private.json')[service],raw[service],[*COMPOSE,'-f',str(DEPLOY/'runtime-images-and-literal-env.private.yml')]);checks[service+'.pid1Environment']=pid_environment(current['targets'][service]['id'])==read_json(BACKUP/(service+'-literal-process-environment.private.json'));keys={k for k,spec in CORE.STORAGE.items()if spec[0]==service};need(set(preswitch[service]['storage'])==keys,'pre-switch-exact-service-storage-scope')
  for key in sorted(keys):
   pre_differences[key]=compare_storage(before['storage'][key],preswitch[service]['storage'][key]);checks.update({key+'.'+n:v for n,v in compare_storage(preswitch[service]['storage'][key],storage[key]).items()})
  if service in{'indo-shipping','internal-quote'}:
   schema='indo_shipping'if service=='indo-shipping'else'internal_quote';old=preswitch[service]['postgres'][schema];new=postgres[schema];pre_differences[schema]={'allTablesTypedExact':before['postgres'][schema]['tables']==old['tables'],'allSchemaExact':before['postgres'][schema]['schema']==old['schema'],'allSequencesExact':before['postgres'][schema]['sequenceStates']==old['sequenceStates']};checks[schema+'.allTablesTypedExact']=old['tables']==new['tables'];checks[schema+'.allSchemaExact']=old['schema']==new['schema']
   if schema=='internal_quote':checks[schema+'.onlyExactKnownStartupSequenceConsumption'],details['quoteSequence']=quote_sequence_check(old,new)
   else:checks[schema+'.allSequenceValuesExact']=old['sequenceStates']==new['sequenceStates']and old['sequenceStateStableDuringCapture']is True and new['sequenceStateStableDuringCapture']is True
  STAGE='verify-public-readonly-'+service;health(service);public_assets(service,proof[service])
 STAGE='verify-final-seals-runtime-source';need(observation_archive(directory)==seal,'observation-not-mutated-by-comparison');runtime_stable(current,before,files);original();archive(PREPARE,PREPARE_MANIFEST,PREPARE_RESULT);archive(DEPLOY,DEPLOY_MANIFEST,DEPLOY_RESULT);comparison={'checks':checks,'preBackupToPreSwitch':pre_differences,'details':details};CORE.OPS.L.private_write(OUT/'comparison.private.json',enc(comparison));passed=sum(v is True for v in checks.values());result.update(success=passed==len(checks),checks=checks,passedChecks=passed,totalChecks=len(checks),failedCheckNames=[n for n,v in checks.items()if v is not True],preBackupToPreSwitchDifferences=pre_differences,quoteSequenceComparison=details.get('quoteSequence'),unexpectedDifferencesNotAutomaticallyAttributedOrRestored=True,allWorkersAndOtherServicesPreserved=True)

def recover_before_candidate(result):
 if not DRAIN or DRAIN['candidateAttempted']:return
 service=DRAIN['service'];cid=DRAIN['id'];rows=raw_inventory();need(cid in rows and rows[cid]['OOMKilled']is False and rows[cid]['Image']==DRAIN['image'],'original-container-available-for-drain-recovery');old=DRAIN['raw'];now=rows[cid];need(now['Config']==dict(old['Config'],Env=sorted(old['Config']['Env']))and now['HostConfig']==old['HostConfig']and now['Mounts']==sorted(old['Mounts'],key=enc),'recovery-original-full-configuration')
 if now['Running']is False:operation(['docker','start',cid],'restart-original-before-candidate-only',45)
 maintenance('wait_service_ready',service);current,raw=CORE.runtime();expected=DRAIN['expected'];need(current['others']==expected['others']and current['databaseContainer']==expected['databaseContainer']and current['qcReportWorker']==expected['qcReportWorker']and all(current['targets'][s]==expected['targets'][s]for s in ORDER if s!=service),'recovery-all-other-containers');a=copy.deepcopy(expected['targets'][service]);b=copy.deepcopy(current['targets'][service]);a.pop('started');b.pop('started');need(a==b,'recovery-only-original-start-time-may-change');need(pid_environment(cid)==read_json(BACKUP/(service+'-literal-process-environment.private.json')),'recovery-pid1-literal-environment');checked_source(TARGET,DRAIN['before'],DRAIN['files']);need(flags(service)==[r for r in DRAIN['before']['maintenanceInventory']if r['path']!='services/'+service],'recovery-other-maintenance-preserved');maintenance('maintenance_off',service);maintenance('require_maintenance_cleared',service);need(flags()==DRAIN['before']['maintenanceInventory'],'recovery-original-maintenance-restored');result['oldContainerRestartedOnlyBeforeAnyCandidateAttempt']=True

def main():
 global CORE,OUT,ENV,STAGE
 need(len(sys.argv)==2 and sys.argv[1]in{'prepare','deploy','verify'},'fixed-three-phase-argument');mode=sys.argv[1];need({'prepare':PREPARE_PIN,'deploy':DEPLOY_PIN,'verify':VERIFY_PIN}[mode]and pin(TARGET,40)and pin(TREE,40)and pin(SOURCE_MANIFEST_SHA)and pin(CORE_SHA),'false-draft-or-missing-reviewed-pins');need(os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_ATTEMPT')=='1','fixed-ops-branch-first-attempt');os.umask(0o077);OUT={'prepare':PREPARE,'deploy':DEPLOY,'verify':VERIFY}[mode];OUT.mkdir(mode=0o700);ENV=dict(os.environ,AFTER_COMMIT=TARGET,COMPOSE_BAKE='false',COMPOSE_PARALLEL_LIMIT='1',COMPOSE_PROJECT_NAME='rr-portal',MAINT_FLAG_DIR=str(ROOT/'deploy/maintenance'),COMPOSE_FILE=str(ROOT/'docker-compose.cloud.yml'),ENV_FILE=str(ROOT/'.env.cloud.production'),MAINT_COMPOSE_SERVICES='\n'.join(ORDER),MAINT_HEALTH_TIMEOUT_SECONDS='300',MAINT_DNS_GRACE_SECONDS='10');CORE=load_core();signal.signal(signal.SIGTERM,lambda *_:need(False,'termination-signal'));result={'mode':mode,'base':BASE,'target':TARGET,'tree':TREE,'success':False,'businessAPIMutationsPerformed':False,'environmentFileModified':False,'credentialsOrMailboxStateChanged':False,'globalHooksOrGlobalMaintenanceRun':False,'automaticSchemaDataRollbackOrCounterResetPerformed':False,'maintenanceOrServiceSwitchesPerformed':False}
 try:before=original();files=source_manifest();{'prepare':prepare,'deploy':deploy,'verify':verify}[mode](result,before,files)
 except BaseException:
  result.update(failedStage=STAGE,failedCheck=FAILED_CHECK or'core-or-command-invariant');CORE.OPS.L.private_write(OUT/'failure-traceback.private.txt',traceback.format_exc().encode())
  if mode=='deploy':
   try:recover_before_candidate(result)
   except BaseException:result['preCandidateOriginalContainerRecoveryIncomplete']=True
 finally:CORE.OPS.L.private_write(OUT/'first-result.json',enc(result));CORE.OPS.L.seal(OUT);public=dict(result,manifestSHA256=CORE.OPS.L.file_hash(OUT/'manifest.json'),resultSHA256=CORE.OPS.L.file_hash(OUT/'first-result.json'));need(len(enc(public))<=48000,'bounded-public-receipt');print(enc(public).decode(),flush=True)
 return 0 if result['success']else 1
if __name__=='__main__':
 try:code=main()
 except BaseException:print('{"success":false,"safeFailure":"BATCH_969_974_RELEASE_PREFLIGHT_REJECTED"}',flush=True);code=1
 sys.exit(code)
