"""Six-service release: prepare immutable candidates, then switch scoped groups.
Draft only. Both execution gates, reviewed source pins and archive pins are blank.
No data restore, business API mutation, mailbox configuration or global hook.
"""
import contextlib,copy,hashlib,importlib.util,json,os,pathlib,re,signal,sqlite3,stat,subprocess,sys,time,traceback,urllib.error,urllib.request
ROOT=pathlib.Path('/opt/rr-portal')
BASE='4f1f64cac098caa6b202eb27cae9ab8fad9109dd';TARGET='b30a803e74641e0e18150597e0114f6cb99b2e9c';TREE='60936186cae64d44ee728ac80ec3033779e9a676'
BRANCH='refs/heads/ops/batch-960-966-967-968-20261020'
PREPARE_PIN=True;DEPLOY_PIN=False
CORE_SHA='a06bd4dd932df22b9127cda35a2dd7a8d69fafd879d6619ce3b50aa54252cd5d';SOURCE_MANIFEST_SHA='57d99fb9ff414dab029c955a8dceb6a277b5d4c263ad1148ee50a813ce2efbb1';EXPECTED_CHANGED_FILES=77
BACKUP=ROOT/'deploy/backups/batch-960-966-967-968-20261020-backup-05';BACKUP_MANIFEST='4533352f7d160d95c78dce83741b81cca8f363c7d253b27959595a579e977794';BACKUP_RESULT='bf36c36ffae529787564bccc74a7ef15140b3ff62cc46f09cf97008c51698ce0'
PREPARE=ROOT/'deploy/backups/batch-960-966-967-968-20261020-prepare';PREPARE_MANIFEST='';PREPARE_RESULT=''
DEPLOY=ROOT/'deploy/backups/batch-960-966-967-968-20261020-deploy'
ORDER=('rr-production','qc','internal-quote','voyageplex-parser','voyageplex-api','voyageplex-web')
GROUPS=(('rr-production',),('qc',),('internal-quote',),('voyageplex-parser','voyageplex-api','voyageplex-web'))
ALIASES={'rr-production':'rr-production','qc':'qc','internal-quote':'internal-quote','voyageplex-parser':'voyageplex','voyageplex-api':'voyageplex','voyageplex-web':'voyageplex'}
# Root may populate only exact public IMAGE DEFAULT differences, after inspecting
# the sealed preparation receipt. Never literal business values or version ranges.
VENDOR_ENV_CHANGES={}
PUBLIC_VENDOR_KEYS={'NODE_VERSION','YARN_VERSION','PYTHON_VERSION','PYTHON_SHA256','DOTNET_VERSION','ASPNET_VERSION'}
COMPOSE=['docker','compose','-p','rr-portal','-f',str(ROOT/'docker-compose.cloud.yml'),'--env-file',str(ROOT/'.env.cloud.production')]
STAGE='entrypoint';FAILED_CHECK=None;COUNTER=0;CORE=None;OUT=None;ENV=None


def need(value,label='invariant'):
 global FAILED_CHECK
 if not value:
  need_label=label if type(label)is str and re.fullmatch('[A-Za-z0-9_.-]{1,140}',label)else'invalid-check-name'
  FAILED_CHECK=need_label
  raise RuntimeError('BATCH_960_968_RELEASE_REJECTED')

def enc(value):return json.dumps(value,ensure_ascii=True,sort_keys=True,separators=(',',':'),allow_nan=False).encode()
def sha(value):return hashlib.sha256(value).hexdigest()
def pin(value,n):return type(value)is str and bool(re.fullmatch('[a-f0-9]{%d}'%n,value))

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

def original():
 receipt=archive(BACKUP,BACKUP_MANIFEST,BACKUP_RESULT)
 need(receipt.get('base')==BASE and all(receipt.get(key)is True for key in('backupComplete','allSixTargetServicesBound','allPersistentMountsCaptured','allOriginalFullTypedRowsAndSchemaCaptured','privateEnvironmentFileBackedUp','fourExistingTrackedChangesPreserved','allOtherContainersUnchanged','allMaintenanceFlagsUnchanged','startupSafetyPassed')),'complete-original-backup')
 before=read_json(BACKUP/'baseline.private.json')
 need(before['head']==BASE and set(before['runtime']['targets'])==set(ORDER)==CORE.SERVICES and set(before['storage'])==set(CORE.STORAGE),'backup-exact-scope')
 need(before['startupChecks']['allExistingStartupGuardsPassed']is True,'original-startup-guards')
 return before

def source_manifest():
 path=pathlib.Path(__file__).with_name('batch-reviewed-files.json')
 need(path.is_file()and not path.is_symlink()and sha(path.read_bytes())==SOURCE_MANIFEST_SHA,'reviewed-manifest-pin')
 files=json.loads(path.read_bytes())
 need(type(files)is dict and len(files)==EXPECTED_CHANGED_FILES and 0<len(files)<=500,'reviewed-file-count')
 need(all(CORE.OPS.L.safe_path(name)and pin(checksum,64)and any(name.startswith(prefix+'/')for prefix in CORE.APP_PREFIXES)for name,checksum in files.items()),'reviewed-file-scope')
 return files

def checked_source(revision,before,files):
 CORE.BASE=revision;configuration=CORE.source()
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

def runtime_stable(expected,before,files,exclude_alias=None):
 current,raw=CORE.runtime();need(current==expected,'runtime-snapshot-unchanged')
 checked_source(TARGET,before,files);need(flags(exclude_alias)==[r for r in before['maintenanceInventory']if r['path']!='services/'+str(exclude_alias)],'unrelated-maintenance-unchanged')
 roots,mounts=CORE.storage_roots(raw);need(mounts==before['storageMounts'],'all-storage-mounts-unchanged');return current,raw,roots

def old_environments(service,raw,before):
 literal=read_json(BACKUP/(service+'-literal-compose-environment.private.json'));oldimage=read_json(BACKUP/(service+'-image.private.json'))
 need(oldimage['Id']==before['runtime']['targets'][service]['image'],'old-image-bound-to-backup')
 actual=CORE.envmap(raw[service]['Config']['Env']);defaults=CORE.envmap(oldimage['Config'].get('Env')or[])
 need(dict(defaults,**literal)==actual and sha(enc(actual))==before['runtime']['targets'][service]['environmentMapSHA256'],'actual-literal-image-default-partition')
 return actual,literal,oldimage

def compose_base(before):
 need(CORE.run(['docker','compose','version','--short']).decode().strip()=='5.1.0','compose-version')
 config=json.loads(private_capture([*COMPOSE,'config','--format','json'],'base-compose',90))
 need(type(config)is dict and type(config.get('services'))is dict,'compose-json-shape')
 for service in ORDER:
  need(config['services'][service].get('environment',{})==read_json(BACKUP/(service+'-compose-environment.private.json')),'base-compose-declared-environment-'+service)
 return config

def overlay_contents(literals,images=None):
 need(set(literals)==set(ORDER)and(images is None or set(images)==set(ORDER)),'overlay-exact-six-services')
 lines=['services:']
 for service in ORDER:
  literal=literals[service];need(type(literal)is dict and all(type(k)is str and type(v)is str for k,v in literal.items()),'overlay-literal-map')
  lines.extend(['  '+service+':','    environment: !override '+json.dumps(CORE.serialized_environment(literal),ensure_ascii=True,separators=(',',':'))])
  if images is not None:
   need(bool(re.fullmatch('sha256:[a-f0-9]{64}',images[service])),'overlay-immutable-image-id')
   lines.extend(['    image: '+images[service],'    pull_policy: never'])
 return ('\n'.join(lines)+'\n').encode()

def compose_overlay(before,raw,images=None):
 base=compose_base(before);literals={service:old_environments(service,raw,before)[1]for service in ORDER}
 path=OUT/('runtime-images-and-literal-environment.private.yml'if images else'build-literal-environment.private.yml')
 CORE.OPS.L.private_write(path,overlay_contents(literals,images));command=[*COMPOSE,'-f',str(path)]
 observed=json.loads(private_capture([*command,'config','--format','json'],'validated-compose',90));expected=copy.deepcopy(base)
 for service in ORDER:
  expected['services'][service]['environment']=CORE.serialized_environment(literals[service])
  if images is not None:expected['services'][service].update(image=images[service],pull_policy='never')
 need(observed==expected,'only-reviewed-six-compose-overlay-fields-change')
 return command,observed,literals

def effective_candidate_config(candidate,declared,oldraw):
 config=candidate['Config'];old=oldraw['Config'];result={}
 for field,override in(('Cmd','command'),('Entrypoint','entrypoint'),('WorkingDir','working_dir'),('User','user')):
  value=declared.get(override,config.get(field));expected=old.get(field)
  same=value==expected
  if field=='User'and override not in declared and value in(None,'')and expected in(None,''):same=True
  result[field+'MatchesPreservedRuntime']=same
 return result

def public_vendor_value(key,value):
 if type(value)is not str:return False
 return bool(re.fullmatch('[a-f0-9]{64}',value))if key=='PYTHON_SHA256'else bool(re.fullmatch(r'\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?',value))

def candidate_facts(service,candidate,raw,before,declared,literal):
 old,literal_bound,oldimage=old_environments(service,raw,before);need(literal==literal_bound,'candidate-sealed-literal-environment')
 need(bool(re.fullmatch('sha256:[a-f0-9]{64}',candidate.get('Id',''))),'candidate-image-id')
 defaults=CORE.envmap(candidate['Config'].get('Env')or[]);proposed=dict(defaults,**literal)
 changed=sorted(key for key in set(old)|set(proposed)if old.get(key)!=proposed.get(key))
 guards=effective_candidate_config(candidate,declared,raw[service]);guards['ArchitectureMatchesPreservedRuntime']=candidate.get('Architecture')==oldimage.get('Architecture')=='amd64';guards['OperatingSystemMatchesPreservedRuntime']=candidate.get('Os')==oldimage.get('Os')=='linux';guards['LiteralBusinessEnvironmentExactlyPreserved']=all(proposed.get(k)==v for k,v in literal.items())
 public_versions={key:{'old':old.get(key),'candidate':proposed.get(key)}for key in changed if key in PUBLIC_VENDOR_KEYS and public_vendor_value(key,old.get(key))and public_vendor_value(key,proposed.get(key))}
 return {'candidateImageID':candidate['Id'],'oldRunningImageID':raw[service]['Image'],'changedEnvironmentKeyNames':changed,'publicVendorMetadataChanges':public_versions,'configurationGuards':guards,'oldEnvironmentSHA256':sha(enc(old)),'proposedEnvironmentSHA256':sha(enc(proposed)),'literalEnvironmentSHA256':sha(enc(literal)),'noEnvironmentDifference':not changed}

def approved_environment(service,candidate,raw,before):
 old,literal,oldimage=old_environments(service,raw,before);defaults=CORE.envmap(candidate['Config'].get('Env')or[]);old_defaults=CORE.envmap(oldimage['Config'].get('Env')or[]);proposed=dict(defaults,**literal)
 policy=VENDOR_ENV_CHANGES.get(service,{})
 need(type(policy)is dict and set(policy)<=PUBLIC_VENDOR_KEYS and not set(policy)&set(literal),'vendor-policy-public-defaults-only')
 need({key for key in set(old)|set(proposed)if old.get(key)!=proposed.get(key)}==set(policy),'candidate-environment-drift-exactly-approved')
 for key,change in policy.items():
  need(type(change)is dict and set(change)=={'old','candidate'}and all(public_vendor_value(key,v)for v in change.values()),'vendor-policy-literal-version-pins')
  need(old.get(key)==old_defaults.get(key)==change['old']and proposed.get(key)==defaults.get(key)==change['candidate'],'vendor-policy-both-sealed-image-defaults')
 return proposed

def pid_environment(cid):
 content=CORE.run(['docker','exec',cid,'cat','/proc/1/environ']);need(content.endswith(b'\0'),'pid1-environment-format')
 environment=CORE.envmap([value.decode()for value in content.split(b'\0')if value]);need(environment.pop('HOSTNAME',None)==cid[:12],'automatic-hostname-exact')
 return environment

def isolated_web_artifacts(image):
 need(bool(re.fullmatch('sha256:[a-f0-9]{64}',image)),'isolated-artifact-image-id')
 output=private_capture(['docker','run','--rm','--network','none','--read-only','--log-driver','none','--entrypoint','node',image,'-e',CORE.WEB_ARTIFACT_CODE],'web-candidate-artifacts',180)
 artifacts=json.loads(output);need(type(artifacts)is dict and'BUILD_ID'in artifacts and 0<len(artifacts)<=10000 and all(CORE.OPS.L.safe_path(n)for n in artifacts),'web-candidate-artifact-manifest')
 CORE.OPS.L.private_write(OUT/'voyageplex-web-candidate-artifacts.private.json',enc(artifacts))
 return {'compiledArtifactCount':len(artifacts),'compiledArtifactInventorySHA256':sha(enc(artifacts)),'buildIdFileSHA256':artifacts['BUILD_ID']['sha256'],'typescriptSourceNotPresentInRuntimeImage':True,'isolatedReadOnlyNetworkDisabledNoBusinessEnvironmentProbe':True}

def fresh_startup_guard(before,expected,files,alias):
 current,raw,roots=runtime_stable(expected,before,files);destination=OUT/('pre-switch-'+alias);destination.mkdir(mode=0o700);saved=CORE.OUT;CORE.OUT=destination
 try:
  CORE.OPS.L.private_write(destination/'target-inspect.private.json',enc(raw))
  for key,names in(('qc',[company+'/qc.db'for company in sorted(CORE.QC_COMPANIES)]),('voyageplex-data',['voyageplex.db'])):
   for name in names:
    source=roots[key]/name;need(source.is_file()and not source.is_symlink(),'startup-existing-database-only');target=destination/key/'sqlite'/name;target.parent.mkdir(mode=0o700,parents=True,exist_ok=True)
    with contextlib.closing(CORE.OPS.L.connect(source,False))as src,contextlib.closing(sqlite3.connect(str(target)))as dst:
     src.backup(dst);need(CORE.OPS.L.audit(src)==CORE.OPS.L.audit(dst),'fresh-portable-copy-matches-pinned-source')
    os.chmod(target,0o600)
  environment=CORE.storage_contract(raw,current['databaseContainer']);checks=CORE.startup_checks(roots,environment,current['databaseContainer']);CORE.OPS.L.private_write(destination/'startup-checks.private.json',enc(checks))
  need(checks.get('allExistingStartupGuardsPassed')is True,'fresh-existing-startup-guards')
 finally:CORE.OUT=saved
 runtime_stable(expected,before,files)
 return {'allExistingStartupGuardsPassed':True,'freshClosedDatabaseCopiesCaptured':True,'businessFilesOrRowsChangedByGuard':False,'privateGuardSHA256':CORE.OPS.L.file_hash(destination/'startup-checks.private.json')}

def maintenance(function,service):
 need(service in ORDER and function in{'maintenance_on','maintenance_off','wait_service_ready','require_maintenance_cleared'},'maintenance-fixed-command')
 operation(['bash','-c','set -euo pipefail; source "$1"; "$2" "$3"','scoped-six-service-release',str(ROOT/'deploy/service-maintenance.sh'),function,service],'maintenance-'+function+'-'+service,340)

def config_same(service,old,new,raw,proposed,old_process):
 keys=('mounts','memory','swap','healthcheck','command','entrypoint','user','workingDirectory')
 if not all(old[key]==new[key]for key in keys):return False
 if CORE.envmap(raw['Config']['Env'])!=proposed:return False
 expected=copy.deepcopy(old_process)
 for key,change in VENDOR_ENV_CHANGES.get(service,{}).items():
  if expected.get(key)!=change['old']:return False
  expected[key]=change['candidate']
 return pid_environment(new['id'])==expected

def service_proof(service,row,prepared):
 proof=CORE.service_source_proof(service,row)
 if service=='voyageplex-web':
  candidate=prepared['webArtifacts'];need(all(proof.get(key)==candidate.get(key)for key in('compiledArtifactCount','compiledArtifactInventorySHA256','buildIdFileSHA256')),'web-running-artifacts-match-isolated-candidate')
 else:need(proof.get('reviewedSourceMatch')is True,'running-source-matches-reviewed-target-'+service)
 return proof

def get(path):
 need(path in{'/rr/health','/qc/api/health','/internal-quote/health','/voyageplex/api/health'},'fixed-readonly-probe-path')
 class NoRedirect(urllib.request.HTTPRedirectHandler):
  def redirect_request(self,*_):return None
 opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),NoRedirect());request=urllib.request.Request('http://127.0.0.1'+path,method='GET',headers={'Host':'8.148.146.194'})
 with opener.open(request,timeout=20)as response:body=response.read(1024*1024+1);need(response.status==200 and len(body)<=1024*1024,'public-health-200')
 return {'path':path,'status':200,'bodySHA256':sha(body)}

def prepare(result,before,files):
 global STAGE
 STAGE='prepare-original-source-runtime';need(CORE.runtime()[0]==before['runtime']and CORE.maintenance_inventory()==before['maintenanceInventory'],'prepare-unchanged-original-runtime-and-flags');CORE.BASE=BASE;need(CORE.source()==before['configuration'],'original-source-config-before-fetch');need(CORE.dirty_snapshot()==before['preexistingFourDirty']and CORE.OPS.L.file_hash(ROOT/'.env.cloud.production')==before['environmentSHA256'],'original-dirty-and-environment-before-fetch')
 STAGE='prepare-fetch-exact-main';operation(['git','-c','core.hooksPath=/dev/null','fetch','--no-write-fetch-head','origin','main:refs/rr-portal-batch/960-968-target'],'fetch-reviewed-main',180)
 need(CORE.run(['git','rev-parse','refs/rr-portal-batch/960-968-target']).decode().strip()==TARGET,'fetched-main-exact-reviewed-target');checked_source(BASE,before,files)
 STAGE='prepare-fast-forward-source-only';operation(['git','-c','core.hooksPath=/dev/null','merge','--ff-only',TARGET],'fast-forward-reviewed-source',180,True);checked_source(TARGET,before,files)
 current,raw,roots=runtime_stable(before['runtime'],before,files);command,declared,literals=compose_overlay(before,raw)
 old_process={service:pid_environment(current['targets'][service]['id'])for service in ORDER};CORE.OPS.L.private_write(OUT/'old-process-environments.private.json',enc(old_process));CORE.OPS.L.private_write(OUT/'old-target-inspect.private.json',enc(raw))
 candidates={};facts={};result['builds']={}
 for service in ORDER:
  STAGE='prepare-build-'+service;runtime_stable(current,before,files);tag=raw[service]['Config'].get('Image','');need(tag in{'rr-portal-'+service,'rr-portal-'+service+':latest'},'original-compose-target-image-tag')
  result['builds'][service]={'attempted':True,'completed':False};log=operation([*command,'build',service],'build-'+service,1800)
  image=json.loads(private_capture(['docker','image','inspect',tag],'candidate-'+service));need(type(image)is list and len(image)==1,'one-candidate-image');candidate=image[0]
  CORE.OPS.L.private_write(OUT/(service+'-candidate-image.private.json'),enc(candidate));candidates[service]=candidate
  facts[service]=candidate_facts(service,candidate,raw,before,declared['services'][service],literals[service]);result['builds'][service].update(completed=True,candidateImageID=candidate['Id'],buildLogSHA256=CORE.OPS.L.file_hash(log))
  runtime_stable(current,before,files)
 STAGE='prepare-isolated-web-build-artifact-inventory';web=isolated_web_artifacts(candidates['voyageplex-web']['Id']);runtime_stable(current,before,files)
 observed={'base':BASE,'target':TARGET,'tree':TREE,'sourceManifestSHA256':SOURCE_MANIFEST_SHA,'runtimeBefore':current,'candidateFacts':facts,'candidateImageIDs':{s:c['Id']for s,c in candidates.items()},'webArtifacts':web}
 CORE.OPS.L.private_write(OUT/'prepared.private.json',enc(observed))
 result.update(success=True,allSixBuildsCompletedBeforeAnyMaintenance=True,allOriginalRunningContainersUnchanged=True,allOtherContainersUnchanged=True,allMaintenanceFlagsUnchanged=True,environmentFileByteIdentical=True,candidateFacts=facts,candidateImageIDs=observed['candidateImageIDs'],webArtifacts=web,allCandidateNonEnvironmentGuardsPass=all(all(row['configurationGuards'].values())for row in facts.values()),allCandidateEnvironmentsStrictlyIdentical=all(row['noEnvironmentDifference']for row in facts.values()),maintenanceOrServiceSwitchesPerformed=False,sourceFastForwardOnly=True)

def prepared_evidence(before,files):
 receipt=archive(PREPARE,PREPARE_MANIFEST,PREPARE_RESULT);prepared=read_json(PREPARE/'prepared.private.json')
 need(receipt.get('mode')=='prepare'and receipt.get('allSixBuildsCompletedBeforeAnyMaintenance')is True and receipt.get('maintenanceOrServiceSwitchesPerformed')is False,'sealed-preparation-before-maintenance')
 need(prepared['base']==BASE and prepared['target']==TARGET and prepared['tree']==TREE and prepared['sourceManifestSHA256']==SOURCE_MANIFEST_SHA and prepared['runtimeBefore']==before['runtime'],'prepared-exact-reviewed-release')
 need(set(prepared['candidateImageIDs'])==set(ORDER)and set(prepared['candidateFacts'])==set(ORDER),'prepared-six-candidates')
 need(set(VENDOR_ENV_CHANGES)<=set(ORDER),'vendor-policy-six-services-only')
 candidates={}
 for service in ORDER:
  candidate=read_json(PREPARE/(service+'-candidate-image.private.json'));need(candidate['Id']==prepared['candidateImageIDs'][service]and receipt['builds'][service].get('completed')is True and receipt['builds'][service].get('candidateImageID')==candidate['Id'],'candidate-bound-to-own-build-receipt')
  live=json.loads(CORE.run(['docker','image','inspect',candidate['Id']]));need(len(live)==1 and live[0]==candidate,'candidate-immutable-metadata-still-exact');candidates[service]=candidate
 need(receipt.get('allCandidateNonEnvironmentGuardsPass')is True,'prepared-all-non-environment-config-guards')
 return prepared,candidates

def deploy(result,before,files):
 global STAGE
 STAGE='deploy-preparation-seal';prepared,candidates=prepared_evidence(before,files);expected,raw,roots=runtime_stable(before['runtime'],before,files)
 STAGE='deploy-private-exact-literal-and-image-overlay';command,declared,literals=compose_overlay(before,raw,prepared['candidateImageIDs']);old_process=read_json(PREPARE/'old-process-environments.private.json');proposed={}
 for service in ORDER:
  facts=candidate_facts(service,candidates[service],raw,before,declared['services'][service],literals[service]);need(facts==prepared['candidateFacts'][service],'candidate-effective-metadata-equals-sealed-preparation');need(all(facts['configurationGuards'].values()),'candidate-non-environment-configuration-'+service)
  proposed[service]=approved_environment(service,candidates[service],raw,before);need(sha(enc(old_process[service]))==before['runtime']['targets'][service]['processEnvironmentWithoutAutomaticHostnameSHA256'],'old-process-environment-bound-to-original-backup')
 result['freshStartupGuards']={};proofs={};public=[]
 for group in GROUPS:
  alias=ALIASES[group[0]];need(all(ALIASES[service]==alias for service in group),'group-shared-alias')
  STAGE='deploy-pre-switch-'+alias;runtime_stable(expected,before,files);result['freshStartupGuards'][alias]=fresh_startup_guard(before,expected,files,alias)
  for service in group:maintenance('require_maintenance_cleared',service)
  maintenance('maintenance_on',group[0]);result['maintenanceOrServiceSwitchesPerformed']=True;switched=time.monotonic();STAGE='deploy-switch-'+alias
  operation([*command,'up','-d','--no-build','--pull','never','--no-deps',*group],'switch-'+alias,300)
  for service in group:maintenance('wait_service_ready',service)
  STAGE='deploy-actual-runtime-'+alias;after,inspects=CORE.runtime();need(after['others']==before['runtime']['others'],'unrelated-containers-preserved')
  need(all(after['targets'][service]==expected['targets'][service]for service in ORDER if service not in group),'not-yet-switched-targets-unchanged')
  for service in group:
   row=after['targets'][service];need(row['id']!=expected['targets'][service]['id']and row['image']==prepared['candidateImageIDs'][service]and row['restarts']==0,'exact-new-running-candidate-'+service)
   need(config_same(service,before['runtime']['targets'][service],row,inspects[service],proposed[service],old_process[service]),'actual-config-and-process-env-preserved-'+service);proofs[service]=service_proof(service,row,prepared)
  time.sleep(max(0,10-(time.monotonic()-switched)));runtime_stable(after,before,files,alias);STAGE='deploy-clear-own-maintenance-'+alias;maintenance('maintenance_off',group[0])
  for service in group:maintenance('require_maintenance_cleared',service)
  need(flags()==before['maintenanceInventory'],'all-maintenance-flags-restored-after-group')
  try:public.append(get({'rr-production':'/rr/health','qc':'/qc/api/health','internal-quote':'/internal-quote/health','voyageplex':'/voyageplex/api/health'}[alias]))
  except BaseException:maintenance('maintenance_on',group[0]);raise
  expected=after
 STAGE='deploy-final-source-environment-runtime';runtime_stable(expected,before,files);original();archive(PREPARE,PREPARE_MANIFEST,PREPARE_RESULT)
 CORE.OPS.L.private_write(OUT/'runtime-after.private.json',enc(expected));CORE.OPS.L.private_write(OUT/'source-proof.private.json',enc(proofs));CORE.OPS.L.private_write(OUT/'runtime-environment-expected.private.json',enc(proposed))
 result.update(success=True,allSixServicesUseExactSealedCandidateImages=True,allOtherContainersUnchanged=True,allNotSwitchedTargetsPreservedUntilOwnSwitch=True,allPriorLiteralBusinessEnvironmentValuesPreserved=True,onlyExactReviewedPublicImageDefaultDeltasApplied=True,publicVendorMetadataChanges=VENDOR_ENV_CHANGES,environmentFileByteIdentical=True,fourExistingTrackedChangesPreserved=True,allMaintenanceFlagsRestored=True,onlyScopedMaintenanceUsed=True,allFourPublicHealthProbesPassed=True,publicProbes=public,candidateImageIDs=prepared['candidateImageIDs'],sourceProofSummary={service:{key:value for key,value in proof.items()if key in{'reviewedSourceMatch','typescriptSourceNotPresentInRuntimeImage','compiledArtifactCount','compiledArtifactInventorySHA256','buildIdFileSHA256','codeViewMatchesPortablePdb','sourceFileCount'}}for service,proof in proofs.items()},imageBuildsPerformedInThisRun=False)

def main():
 global CORE,OUT,ENV,STAGE
 need(len(sys.argv)==2 and sys.argv[1]in{'prepare','deploy'},'fixed-phase-argument');mode=sys.argv[1]
 need((PREPARE_PIN if mode=='prepare'else DEPLOY_PIN)and pin(TARGET,40)and pin(TREE,40)and pin(SOURCE_MANIFEST_SHA,64)and pin(CORE_SHA,64),'activation-and-reviewed-source-pins')
 need(os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_ATTEMPT')=='1','exact-ops-branch-first-attempt')
 os.umask(0o077);OUT=PREPARE if mode=='prepare'else DEPLOY;OUT.mkdir(mode=0o700)
 ENV=dict(os.environ,AFTER_COMMIT=TARGET,COMPOSE_BAKE='false',COMPOSE_PARALLEL_LIMIT='1',COMPOSE_PROJECT_NAME='rr-portal',MAINT_FLAG_DIR=str(ROOT/'deploy/maintenance'),COMPOSE_FILE=str(ROOT/'docker-compose.cloud.yml'),ENV_FILE=str(ROOT/'.env.cloud.production'),MAINT_COMPOSE_SERVICES='\n'.join(ORDER),MAINT_HEALTH_TIMEOUT_SECONDS='300',MAINT_DNS_GRACE_SECONDS='10')
 CORE=load_core()
 def stop(*_):need(False,'termination-signal')
 signal.signal(signal.SIGTERM,stop)
 result={'mode':mode,'base':BASE,'target':TARGET,'expectedTree':TREE,'success':False,'businessAPIMutationsPerformed':False,'environmentFileModified':False,'credentialsChanged':False,'globalHooksRun':False,'globalMaintenanceChanged':False,'mailboxConfigurationOrSyncFeatureFlagsChanged':False,'automaticRollbackOrDataRestorePerformed':False,'maintenanceOrServiceSwitchesPerformed':False}
 try:before=original();files=source_manifest();(prepare if mode=='prepare'else deploy)(result,before,files)
 except BaseException:
  result.update(failedStage=STAGE,failedCheck=FAILED_CHECK or'core-or-command-invariant');CORE.OPS.L.private_write(OUT/'failure-traceback.private.txt',traceback.format_exc().encode())
 finally:
  CORE.OPS.L.private_write(OUT/'first-result.json',enc(result));CORE.OPS.L.seal(OUT);safe=dict(result,manifestSHA256=CORE.OPS.L.file_hash(OUT/'manifest.json'),resultSHA256=CORE.OPS.L.file_hash(OUT/'first-result.json'));need(len(enc(safe))<=24000,'safe-receipt-size');print(enc(safe).decode(),flush=True)
 return 0 if result['success']else 1
if __name__=='__main__':
 try:code=main()
 except BaseException:print('{"success":false,"safeFailure":"BATCH_960_968_RELEASE_PREFLIGHT_FAILED"}',flush=True);code=1
 sys.exit(code)
