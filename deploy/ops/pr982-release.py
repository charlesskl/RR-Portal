"""PR982 one-service immutable prepare / closed cutover / read-only verify.

Draft: all execution gates false. No database restore, sequence reset or business CRUD.
"""
import copy,hashlib,importlib.util,json,os,pathlib,re,signal,stat,subprocess,sys,time,traceback,urllib.error,urllib.parse,urllib.request

ROOT=pathlib.Path('/opt/rr-portal');BASE='67385924fc40958701843411b3731d2eeb90b2ad';TARGET='556798afb260020ca8f990c66290177ad0bf3e44';TREE='e190beed13d0318a2f3fa2e5b2eb5acf6c6f4308'
BRANCH='refs/heads/ops/pr-982-20261021';PREPARE_PIN=False;DEPLOY_PIN=False;VERIFY_PIN=True
CORE_SHA='4189c1e58f9cac7dfba76693c1a132ab78b93ade9027aa95eb45454b697413d9'
SOURCE_MANIFEST_SHA='52358df007164964c40e7d3938a1ff2e8e1362f068ae67652e564cbfe7c93484';EXPECTED_CHANGED_FILE_COUNT=9
BACKUP=ROOT/'deploy/backups/pr-982-20261021-backup';BACKUP_MANIFEST='32bfef9ff989cb8f0b8caed414ff27185f9e53c9dc3c1c3583d906b8747d93e7';BACKUP_RESULT='654029c040230009c247500ad1a756736ae5711bc5a4f022abfce9df409e7230'
PREPARE=BACKUP.with_name('pr-982-20261021-prepare');PREPARE_MANIFEST='8d46199dc99423bc5cfe33e8eae612315032c37d091fb29377d7c4867ec1719a';PREPARE_RESULT='fe9108e71e6a1168c296a2d35c2a911b39b8d3db5445dbbe04ebc8ab63896327'
DEPLOY=BACKUP.with_name('pr-982-20261021-deploy');DEPLOY_MANIFEST='ddf4a1a73d0ea2b14c68312fc2760619d5aac82ebf28b76661336c499a61e9b4';DEPLOY_RESULT='41d2b41fc12cb20eaec077c93cbb5f52d9b614d4fe4f3da69617fb963b548368'
VERIFY=BACKUP.with_name('pr-982-20261021-verify')
SERVICE='internal-quote';COMPOSE=['docker','compose','-p','rr-portal','-f',str(ROOT/'docker-compose.cloud.yml'),'--env-file',str(ROOT/'.env.cloud.production')]
STAGE='entrypoint';FAILED_CHECK=None;CORE=None;OUT=None;ENV=None;COUNTER=0;DRAIN=None

def need(value,label='invariant'):
 global FAILED_CHECK
 if not value:
  FAILED_CHECK=label if type(label)is str and re.fullmatch('[A-Za-z0-9_.-]{1,140}',label)else'invalid-check'
  raise RuntimeError('PR982_RELEASE_REJECTED')

def enc(v):return json.dumps(v,ensure_ascii=True,sort_keys=True,separators=(',',':'),allow_nan=False).encode()
def sha(v):return hashlib.sha256(v).hexdigest()
def pin(v,n=64):return type(v)is str and bool(re.fullmatch('[a-f0-9]{%d}'%n,v))
def read(p):return json.loads(CORE.stable_bytes(p,128*1024**2))
def private(name,value):CORE.OPS.L.private_write(OUT/name,value if type(value)is bytes else enc(value))

def load_core():
 p=pathlib.Path(__file__).with_name('pr982-backup-library.py');need(pin(CORE_SHA)and p.is_file()and not p.is_symlink()and sha(p.read_bytes())==CORE_SHA,'core-library-pin')
 s=importlib.util.spec_from_file_location('pr982_reviewed_core',p);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);need(m.BASE==BASE and m.BRANCH==BRANCH and m.BACKUP_PIN is False,'inert-one-service-core');m.OUT=OUT;m.initialize();return m

def run(args,data=None,timeout=180):return CORE.run(args,data,timeout)

def operation(args,label,timeout=180,checkout=False):
 global COUNTER
 need(type(label)is str and re.fullmatch('[a-z0-9_.-]+',label),'fixed-operation-label');COUNTER+=1
 with(OUT/('%04d-%s.operation.private.log'%(COUNTER,label))).open('xb')as output:
  p=subprocess.run(args,stdout=output,stderr=subprocess.STDOUT,timeout=timeout,cwd=ROOT,env=ENV,umask=0o022 if checkout else -1)
 need(p.returncode==0,'operation-return-code')

def seal_check(path,checksum=None):
 need(path.is_dir()and not path.is_symlink()and stat.S_IMODE(path.stat().st_mode)==0o700,'private-evidence-directory');p=path/'manifest.json'
 need(checksum is None or pin(checksum)and CORE.OPS.L.file_hash(p)==checksum,'evidence-manifest-pin');manifest=read(p);entries=list(path.rglob('*'))
 need(type(manifest)is dict and len(entries)<=100000 and all(not v.is_symlink()and(v.is_file()or v.is_dir())and v.stat().st_mode&0o077==0 for v in entries),'private-evidence-entries')
 need(set(manifest)=={str(v.relative_to(path))for v in entries if v.is_file()and v!=p},'complete-evidence-inventory')
 need(all(CORE.OPS.L.safe_path(n)and pin(h)and CORE.OPS.L.file_hash(path/n)==h for n,h in manifest.items()),'all-evidence-bytes-sealed');return CORE.OPS.L.file_hash(p)

def archive(path,manifest,result):
 need(pin(manifest)and pin(result),'prior-receipt-pins');seal_check(path,manifest);need(CORE.OPS.L.file_hash(path/'first-result.json')==result,'prior-result-pin');r=read(path/'first-result.json');need(r.get('success')is True,'successful-prior-receipt');return r

def baseline():
 r=archive(BACKUP,BACKUP_MANIFEST,BACKUP_RESULT);need(r.get('base')==BASE and all(r.get(k)is True for k in('backupComplete','onlyInternalQuoteStorageCaptured','startupSafetyPassed','allOtherContainersUnchanged','allMaintenanceFlagsUnchanged','allOriginalTypedRowsAndSchemaCaptured','privateEnvironmentCaptured','sourceProven')),'fresh-one-service-original')
 b=read(BACKUP/'baseline.private.json');need(b['head']==BASE and b['startupChecks']['allPassed']is True and b['sourceProof']['target']==BASE,'baseline-scope-source');need(b['runtime']['app']['id']==read(BACKUP/'app-inspect.private.json')['Id'],'baseline-old-container-binding');return b

def source_manifest():
 p=pathlib.Path(__file__).with_name('pr982-reviewed-files.json');need(p.is_file()and not p.is_symlink()and sha(p.read_bytes())==SOURCE_MANIFEST_SHA,'reviewed-manifest-pin');files=json.loads(p.read_bytes())
 need(type(files)is dict and type(EXPECTED_CHANGED_FILE_COUNT)is int and 1<=EXPECTED_CHANGED_FILE_COUNT<=50 and len(files)==EXPECTED_CHANGED_FILE_COUNT,'exact-reviewed-file-count')
 need(all(CORE.OPS.L.safe_path(n)and n.startswith((CORE.APP_PREFIX+'frontend/',CORE.APP_PREFIX+'tests/'))and pin(h)for n,h in files.items()),'only-reviewed-frontend-and-tests')
 return files

def checked_source(revision,b,files):
 configuration=CORE.source(revision);need(configuration==b['configuration'],'all-fixed-source-identical');need(CORE.file_metadata(ROOT/'.env.cloud.production')==b['environmentFileMetadata']and CORE.stable_bytes(ROOT/'.env.cloud.production')==CORE.stable_bytes(BACKUP/'environment.private'),'private-env-byte-metadata-identity');need(CORE.dirty_snapshot()==b['preexistingFourDirty'],'four-dirty-exactly-preserved')
 need(run(['git','rev-parse',TARGET+'^{tree}']).decode().strip()==TREE,'exact-reviewed-target-tree');changed=run(['git','diff','--name-only','-z','--no-ext-diff','--no-textconv',BASE,TARGET]).decode().rstrip('\0').split('\0');need(set(changed)==set(files)and not set(files)&set(b['preexistingFourDirty']),'exact-merged-source-diff')
 # The entire unchanged backend is checked explicitly, including startup and authorization.
 need(run(['git','diff','--name-only',BASE,TARGET,'--',CORE.APP_PREFIX+'backend']).strip()==b'','no-backend-or-startup-change')
 for name,h in files.items():
  need(sha(run(['git','show',TARGET+':'+name]))==h,'target-blob-matches-review')
  if revision==TARGET:
   p=ROOT/name;entry=run(['git','ls-tree','-z',TARGET,'--',name]).split(b'\t',1);need(len(entry)==2 and entry[1]==name.encode()+b'\0'and re.fullmatch(b'100(?:644|755) blob [a-f0-9]{40}',entry[0]),'canonical-source-git-mode')
   for a in(p,*p.parents):
    if a==ROOT:break
    need(not a.is_symlink(),'source-path-no-symlink')
   need(p.is_file()and stat.S_IMODE(p.stat().st_mode)==(0o755 if entry[0].startswith(b'100755')else 0o644)and CORE.OPS.L.file_hash(p)==h,'canonical-source-file-bytes-mode')

def flags(own=False):
 value=CORE.maintenance_inventory(own_allowed=own);return[row for row in value if row['path']!='services/'+SERVICE]if own else value

def stable(expected,b,files,own=False):
 current,raw=CORE.runtime();need(current==expected,'runtime-exactly-stable');checked_source(TARGET,b,files);need(flags(own)==[v for v in b['maintenanceInventory']if not own or v['path']!='services/'+SERVICE],'other-maintenance-preserved');return current,raw

def compose_base():
 need(run(['docker','compose','version','--short']).decode().strip()=='5.1.0','compose-version');v=json.loads(run([*COMPOSE,'config','--format','json'],timeout=90));need(v==read(BACKUP/'compose-render.private.json'),'entire-base-compose-unchanged');return v

def overlay(image,name,build=False):
 need(pin(image.removeprefix('sha256:'))and image.startswith('sha256:')or build and image=='rr-portal-internal-quote-pr982:'+TARGET,'fixed-image-reference');base=compose_base();expected=copy.deepcopy(base);actual=read(BACKUP/'literal-configured-environment.private.json');need(type(actual)is dict and all(type(k)is str and type(v)is str for k,v in actual.items()),'full-literal-environment');serialized={k:v.replace('$','$$')for k,v in actual.items()};lines=['services:','  '+SERVICE+':','    image: '+image,'    pull_policy: never','    environment: !override '+json.dumps(serialized,ensure_ascii=True)];expected['services'][SERVICE].update(image=image,pull_policy='never',environment=serialized)
 if build:
  labels=dict(base['services'][SERVICE].get('build',{}).get('labels')or{});labels['org.opencontainers.image.revision']=TARGET;lines.extend(['    build:','      labels: '+json.dumps(labels,ensure_ascii=True)]);expected['services'][SERVICE]['build']['labels']=labels
 p=OUT/name;private(name,('\n'.join(lines)+'\n').encode());args=[*COMPOSE,'-f',str(p)];rendered=json.loads(run([*args,'config','--format','json'],timeout=90));need(rendered==expected,'only-one-service-image-literal-env-overlay');return args

def candidate(image):
 old=read(BACKUP/'app-image.private.json');raw=read(BACKUP/'app-inspect.private.json');v=json.loads(run(['docker','image','inspect',image]))[0];need(v['Id']==image and v['Architecture']==old['Architecture']=='amd64'and v['Os']==old['Os']=='linux','candidate-immutable-platform')
 need((v['Config'].get('Labels')or{})==dict(old['Config'].get('Labels')or{},**{'org.opencontainers.image.revision':TARGET}),'candidate-only-reviewed-oci-label');need(v['Config'].get('Healthcheck')==old['Config'].get('Healthcheck'),'candidate-image-healthcheck')
 declared=compose_base()['services'][SERVICE]
 for key,override in(('Cmd','command'),('Entrypoint','entrypoint'),('User','user'),('WorkingDir','working_dir')):
  value=declared.get(override)
  if value is None:value=v['Config'].get(key)
  same=value==raw['Config'].get(key)or key=='User'and value in(None,'')and raw['Config'].get(key)in(None,'')
  if key=='Cmd'and declared.get('command')is None and declared.get('entrypoint')is not None:same=False
  need(same,'candidate-process-'+key.lower())
 actual=read(BACKUP/'literal-configured-environment.private.json');need(dict(CORE.envmap(v['Config'].get('Env')or[]),**actual)==actual,'candidate-defaults-covered-by-old-environment');return CORE.source_proof(image,TARGET,True)

def prepared():
 r=archive(PREPARE,PREPARE_MANIFEST,PREPARE_RESULT);p=read(PREPARE/'prepared.private.json');need(r.get('target')==TARGET and r.get('tree')==TREE and r.get('candidateBuiltBeforeMaintenance')is True and p['target']==TARGET and p['tree']==TREE and p['sourceManifestSHA256']==SOURCE_MANIFEST_SHA,'prepared-target-source-binding');return p

def prepare(result,b,files):
 global STAGE
 STAGE='prepare-initial-runtime-source';before,raw=CORE.runtime();need(before==b['runtime']and flags()==b['maintenanceInventory'],'unchanged-before-prepare');head=run(['git','rev-parse','HEAD']).decode().strip();need(head in{BASE,TARGET},'only-reviewed-source-resume');need(CORE.source(head)==b['configuration'],'fixed-source-before-fetch')
 STAGE='prepare-fetch-reviewed-main';operation(['git','-c','core.hooksPath=/dev/null','fetch','--no-write-fetch-head','origin','main'],'fetch-exact-main');need(run(['git','rev-parse','origin/main']).decode().strip()==TARGET,'main-exactly-reviewed-target');run(['git','merge-base','--is-ancestor',BASE,TARGET]);checked_source(head,b,files)
 if head==BASE:
  STAGE='prepare-fast-forward';operation(['git','-c','core.hooksPath=/dev/null','-c','merge.autoStash=false','merge','--ff-only','--no-autostash',TARGET],'source-fast-forward',180,True)
 checked_source(TARGET,b,files);STAGE='prepare-one-image';args=overlay('rr-portal-internal-quote-pr982:'+TARGET,'build.private.yml',True);operation([*args,'build',SERVICE],'build-only-internal-quote',1800);image=json.loads(run(['docker','image','inspect','rr-portal-internal-quote-pr982:'+TARGET]))[0]['Id'];need(image!=raw['Image'],'new-candidate-image')
 STAGE='prepare-image-source-config';proof=candidate(image);need(CORE.startup(before['databaseContainer'])['allPassed'],'fresh-startup-safety');stable(before,b,files);private('prepared.private.json',{'image':image,'sourceProof':proof,'runtime':before,'target':TARGET,'tree':TREE,'sourceManifestSHA256':SOURCE_MANIFEST_SHA});result.update(success=True,candidateBuiltBeforeMaintenance=True,image=image,allExistingContainersUnchanged=True,allMaintenanceFlagsUnchanged=True)

def maintenance(fn):
 need(fn in{'maintenance_on','maintenance_off','require_maintenance_cleared','wait_service_ready'},'fixed-maintenance-function');operation(['bash','-c','set -euo pipefail; source "$1"; "$2" internal-quote','pr982',str(ROOT/'deploy/service-maintenance.sh'),fn],fn.replace('_','-'),330)

def quote_sequence_check(old,new):
 need(old['sequenceStateStableDuringCapture']is True and new['sequenceStateStableDuringCapture']is True,'independently-stable-sequence-captures');need(old['schema']==new['schema']and set(old['sequenceStates'])==set(new['sequenceStates']),'schema-and-sequence-inventory-identical');changed=[n for n in old['sequenceStates']if old['sequenceStates'][n]!=new['sequenceStates'][n]]
 if not changed:return {'changedSequenceCount':0,'unchanged':True,'sequenceValuesNotMVCCAtomic':True}
 need(changed==['quote_sections_id_seq'],'only-known-startup-identity');name=changed[0];a,b=old['sequenceStates'][name],new['sequenceStates'][name];definitions=[v for v in old['schema']['sequences']if v['name']==name];contract={'type':'integer','start':'1','increment':'1','min':'1','max':'2147483647','cache':'1','cycle':False,'ownedByTable':'quote_sections','ownedByColumn':'id','dependencyType':'i'}
 need(len(definitions)==1 and all(definitions[0].get(k)==v for k,v in contract.items()),'exact-existing-identity-definition')
 for v in(a,b):need(set(v)=={'lastValue','called'}and type(v['lastValue'])is str and re.fullmatch('[1-9][0-9]{0,9}',v['lastValue'])and 1<=int(v['lastValue'])<=2147483647 and v['called']is True,'existing-identity-range-called')
 counts=[old['tables'][n]['rows']for n in('quotes','departments')];need(all(type(v)is int and 0<=v<=2**63-1 for v in counts),'startup-candidate-row-count-types');expected=counts[0]*counts[1];delta=int(b['lastValue'])-int(a['lastValue']);need(delta==expected and delta>0,'exact-one-startup-conflict-identity-consumption')
 return {'changedSequenceCount':1,'sequence':'quote_sections_id_seq','delta':str(delta),'expectedStartupCandidates':str(expected),'compatibleWithUnchangedStartupConflictConsumption':True,'actualActorOrCauseProven':False,'sequenceValuesNotMVCCAtomic':True}

def same_data(old,new):
 need(old['postgres']['tables']==new['postgres']['tables'],'all-business-full-typed-rows-identical');need(old['postgres']['schema']==new['postgres']['schema'],'all-business-schema-identical');need(all(old[k]==new[k]for k in('legacy','legacyRaw','uploads','owners')),'all-legacy-uploads-bytes-and-owners-identical');return quote_sequence_check(old['postgres'],new['postgres'])

def configuration(old,new,image,args,revision=True,original_id_allowed=False):
 need((new['Id']!=old['Id']or original_id_allowed)and new['Image']==image and new['RestartCount']==(old['RestartCount']if original_id_allowed and new['Id']==old['Id']else 0)and new['State']['Running']is True and new['State']['OOMKilled']is False and new['State'].get('Health',{}).get('Status')=='healthy','healthy-exact-image')
 need(new['Config'].get('Image')==(old['Config'].get('Image')if original_id_allowed and new['Id']==old['Id']else image),'literal-immutable-config-image-reference')
 need(CORE.H.same_host_config(old['HostConfig'],new['HostConfig'])and sorted(old.get('Mounts',[]),key=enc)==sorted(new.get('Mounts',[]),key=enc),'complete-hostconfig-mounts');a,c=copy.deepcopy(old['Config']),copy.deepcopy(new['Config']);left=a.pop('Labels')or{};right=c.pop('Labels')or{};need(a.pop('Hostname')==old['Id'][:12]and c.pop('Hostname')==new['Id'][:12],'automatic-hostname-only');a.pop('Image');c.pop('Image');a['Env']=sorted(a['Env']);c['Env']=sorted(c['Env']);need(a==c,'complete-runtime-config-identical');need(CORE.process_environment(new['Id'])==read(BACKUP/'literal-process-environment.private.json'),'full-pid1-environment-identical')
 if original_id_allowed and new['Id']==old['Id']:need(left==right,'original-container-labels-identical');return
 expected=copy.deepcopy(left);expected['com.docker.compose.image']=image;expected['com.docker.compose.project.config_files']=','.join([str(ROOT/'docker-compose.cloud.yml'),args[-1]]);values=run([*args,'config','--hash',SERVICE]).decode().split();need(len(values)==2 and values[0]==SERVICE and pin(values[1]),'exact-compose-service-hash');expected['com.docker.compose.config-hash']=values[1]
 if revision is not None:expected['org.opencontainers.image.revision']=TARGET if revision is True else revision
 need(right==expected,'only-fixed-compose-and-source-labels')

def get(path):
 need(type(path)is str and path.startswith('/internal-quote/')and'..'not in path and'\r'not in path and'\n'not in path,'fixed-public-path')
 class NoRedirect(urllib.request.HTTPRedirectHandler):
  def redirect_request(self,*_):return None
 opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),NoRedirect());request=urllib.request.Request('http://127.0.0.1'+path,headers={'Host':'8.148.146.194','Cache-Control':'no-cache'})
 try:
  with opener.open(request,timeout=20)as r:status,data=r.status,r.read(16*1024**2+1)
 except urllib.error.HTTPError as e:status,data=e.code,e.read(16*1024**2+1)
 need(len(data)<=16*1024**2,'bounded-public-response');return status,data

def public(revision):
 checked={}
 for page in('quote.html','verification.html'):
  expected=run(['git','show',revision+':'+CORE.APP_PREFIX+'frontend/'+page]);status,body=get('/internal-quote/'+page);need(status==200 and body==expected,'public-reviewed-html');refs=re.findall(rb'(?:src|href)=["\'](?:\./)?([A-Za-z0-9_.-]+\.(?:js|css)(?:\?[^"\']*)?)["\']',body);names=set()
  for raw in refs:
   reference=raw.decode();parsed=urllib.parse.urlsplit(reference);name=parsed.path;need(re.fullmatch('[A-Za-z0-9_.-]+\.(?:js|css)',name)and not parsed.netloc and not parsed.fragment,'safe-page-cache-reference');names.add(name);expected_asset=run(['git','show',revision+':'+CORE.APP_PREFIX+'frontend/'+name]);status,data=get('/internal-quote/'+reference);need(status==200 and data==expected_asset,'public-exact-versioned-asset-bytes');checked[reference]=sha(data)
  need({'styles.css','workbench.js'}<=names,'both-pages-reviewed-assets-exercised')
  if page=='quote.html':need('vq-extension.js'in names,'vq-integration-asset-exercised')
 status,_=get('/internal-quote/health');need(status==200,'public-health')
 for path in('api/auth/me','api/quotes','api/admin/users','api/verification-transfer'):
  status,_=get('/internal-quote/'+path);need(status==401,'anonymous-permission-boundary')
 return {'htmlCount':2,'assetCount':len(checked),'versionedAssetSHA256':checked,'health':200,'anonymousProtectedAPIStatus':401}

def recovery_other_inventory():
 # A failed compose recreation can delete the old target before creating any
 # replacement. Only this pre-recovery observation permits a missing target;
 # the original database and every other container are still required exactly.
 ids=run(['docker','ps','-aq','--no-trunc']).decode().split();need(0<len(ids)<=1000 and len(ids)==len(set(ids))and all(pin(v)for v in ids),'recovery-container-ids');records=json.loads(run(['docker','inspect',*ids]));need(type(records)is list and len(records)==len(ids),'recovery-container-inspects');others={};seen=set();targets=0;db=None
 for raw in records:
  cid=raw['Id'];need(cid in ids and cid not in seen,'recovery-unique-inspect');seen.add(cid);labels=raw['Config'].get('Labels')or{};role=labels.get('com.docker.compose.service')if labels.get('com.docker.compose.project')=='rr-portal'else None
  if role==SERVICE:targets+=1;continue
  state=raw['State'];config=copy.deepcopy(raw['Config']);config['Env']=sorted(config.get('Env')or[]);others[cid]={'id':cid,'image':raw['Image'],'started':state.get('StartedAt'),'running':state['Running'],'oom':state['OOMKilled'],'restarts':raw['RestartCount'],'health':state.get('Health',{}).get('Status'),'configSHA256':sha(enc(config)),'hostConfigSHA256':sha(enc(raw['HostConfig'])),'networkSettingsSHA256':sha(enc(raw.get('NetworkSettings',{}))),'mounts':sorted(raw.get('Mounts',[]),key=enc)}
  if role=='db':need(db is None and state['Running']is True and state.get('Health',{}).get('Status')=='healthy','recovery-existing-healthy-database');db=cid
 need(targets<=1 and db is not None,'recovery-only-optional-target');return others,db

def recover(result,b,files):
 global STAGE
 d=DRAIN;old=d['old'];oldid=old['Id'];STAGE='recover-maintenance';maintenance('maintenance_on')
 if d['attempted']:
  current=run([*d['args'],'ps','-a','-q',SERVICE]).decode().strip()
  if current:
   need(pin(current),'failed-candidate-id');v=json.loads(run(['docker','inspect',current]))[0];need(v['Config'].get('Labels',{}).get('com.docker.compose.service')==SERVICE,'failed-candidate-scope')
   if v['State']['Running']:operation(['docker','stop','--time','60',current],'stop-failed-candidate',80)
 else:
  current=oldid;v=json.loads(run(['docker','inspect',oldid]))[0];need(v['Image']==old['Image'],'original-container-before-recovery')
  if v['State']['Running']:operation(['docker','stop','--time','60',oldid],'stop-original-for-recovery-proof',80)
 STAGE='recover-preserve-current-data';failed=CORE.capture(OUT/'recovery-before-start',b['runtime']['databaseContainer'])
 if d['closed']is not None:private('failed-candidate-data-contract.private.json',same_data(d['closed'],failed))
 # With no closed capture yet, the original image is the only writer ever attempted.
 # Still capture current data before restarting it; never restore to the earlier backup.
 checked_source(TARGET,b,files);others,db=recovery_other_inventory();need(others==b['runtime']['others']and db==b['runtime']['databaseContainer'],'recovery-unrelated-containers-stable')
 STAGE='recover-immediate-startup-safety';need(CORE.startup(db)['allPassed'],'recovery-startup-would-change-data')
 STAGE='recover-exact-old-image'
 if d['attempted']:operation([*d['rollback'],'up','-d','--force-recreate','--no-build','--no-deps','--pull','never',SERVICE],'recreate-old-image',180)
 else:operation(['docker','start',oldid],'restart-original-container',80)
 maintenance('wait_service_ready');after,raw=CORE.runtime();configuration(old,raw,old['Image'],d['rollback'],revision=(old['Config'].get('Labels')or{}).get('org.opencontainers.image.revision'),original_id_allowed=True);need(after['others']==b['runtime']['others'],'recovered-all-other-containers');CORE.source_proof(raw['Id'],BASE);post=CORE.capture(OUT/'recovery-after-start',after['databaseContainer']);private('recovery-startup-data-contract.private.json',same_data(failed,post));checked_source(TARGET,b,files);need(flags(True)==b['maintenanceInventory'],'recovery-other-flags');operation(['sleep','11'],'recovery-dns-grace',20);maintenance('maintenance_off');maintenance('require_maintenance_cleared');need(flags()==b['maintenanceInventory'],'recovery-original-flags');result['oldImageRecoveredWithoutRestoringData']=True

def deploy(result,b,files):
 global STAGE,DRAIN
 STAGE='deploy-sealed-candidate';p=prepared();before,old=stable(b['runtime'],b,files);need(p['runtime']==before and candidate(p['image'])==p['sourceProof'],'same-sealed-candidate');args=overlay(p['image'],'runtime.private.yml');rollback=overlay(old['Image'],'rollback.private.yml');need(CORE.startup(before['databaseContainer'])['allPassed'],'immediate-pre-maintenance-startup-safe');DRAIN={'old':old,'args':args,'rollback':rollback,'closed':None,'attempted':False};initial_failure=None
 try:
  STAGE='deploy-maintenance-drain-stop';maintenance('maintenance_on');operation(['sleep','60'],'drain-existing-requests',70);stable(before,b,files,True);operation(['docker','stop','--time','60',old['Id']],'stop-only-old-quote-writer',80);stopped,raw=CORE.runtime(False);need(raw['Id']==old['Id']and raw['State']['Running']is False and stopped['others']==before['others'],'only-old-quote-stopped')
  STAGE='deploy-closed-cutover-snapshot';closed=CORE.capture(OUT/'closed-before',before['databaseContainer']);DRAIN['closed']=closed;need(CORE.startup(before['databaseContainer'])['allPassed'],'closed-startup-safety');need(CORE.runtime(False)[0]==stopped,'stable-closed-snapshot');checked_source(TARGET,b,files);need(flags(True)==b['maintenanceInventory'],'only-own-closed-maintenance')
  STAGE='deploy-one-immutable-candidate';DRAIN['attempted']=True;operation([*args,'up','-d','--force-recreate','--no-build','--no-deps','--pull','never',SERVICE],'recreate-only-internal-quote',180);maintenance('wait_service_ready');after,raw=CORE.runtime();configuration(old,raw,p['image'],args);need(after['others']==before['others'],'all-other-containers-unchanged');need(CORE.source_proof(raw['Id'],TARGET)==p['sourceProof'],'running-source-equals-candidate')
  STAGE='deploy-closed-data-contract';observed=CORE.capture(OUT/'closed-after-start',after['databaseContainer']);contract=same_data(closed,observed);private('closed-data-contract.private.json',contract);stable(after,b,files,True);need(CORE.startup(after['databaseContainer'])['allPassed'],'post-startup-safety')
  STAGE='deploy-clear-only-owned-maintenance';operation(['sleep','11'],'dns-grace',20);maintenance('maintenance_off');maintenance('require_maintenance_cleared');result['public']=public(TARGET);need(flags()==b['maintenanceInventory'],'all-flags-restored');stable(after,b,files);private('runtime-after.private.json',after);private('data-contract.private.json',{'closedBeforeManifest':seal_check(OUT/'closed-before'),'closedAfterManifest':seal_check(OUT/'closed-after-start'),'contract':contract});result.update(success=True,image=p['image'],onlyInternalQuoteRecreated=True,allOtherContainersUnchanged=True,otherContainerCount=len(after['others']),completeEnvironmentConfigHostAndMountsPreserved=True,closedBusinessRowsAndSchemaPreserved=True,allLegacyAndUploadsPreserved=True,allMaintenanceFlagsRestored=True);DRAIN=None
 except BaseException:
  initial_failure=(STAGE,FAILED_CHECK);result['originalFailedStage']=STAGE;result['originalFailedCheck']=FAILED_CHECK
  try:recover(result,b,files)
  except BaseException:result['scopedMaintenanceRetainedForInvestigation']=True;result['recoveryFailedStage']=STAGE;result['recoveryFailedCheck']=FAILED_CHECK
  finally:STAGE=initial_failure[0]
  raise

def verify(result,b,files):
 global STAGE
 STAGE='verify-sealed-deployment';r=archive(DEPLOY,DEPLOY_MANIFEST,DEPLOY_RESULT);p=prepared();need(r.get('target')==TARGET and r.get('onlyInternalQuoteRecreated')is True and r.get('closedBusinessRowsAndSchemaPreserved')is True,'completed-scoped-deployment');current,raw=stable(read(DEPLOY/'runtime-after.private.json'),b,files);need(current['others']==b['runtime']['others'],'all-other-containers-still-original');compose_base();args=[*COMPOSE,'-f',str(DEPLOY/'runtime.private.yml')];configuration(read(BACKUP/'app-inspect.private.json'),raw,p['image'],args);need(CORE.source_proof(raw['Id'],TARGET)==p['sourceProof'],'final-source-proof')
 STAGE='verify-sealed-closed-data-contract';seal_check(DEPLOY/'closed-before');seal_check(DEPLOY/'closed-after-start');closed=read(DEPLOY/'closed-before/observed.private.json');observed=read(DEPLOY/'closed-after-start/observed.private.json');need(same_data(closed,observed)==read(DEPLOY/'closed-data-contract.private.json'),'sealed-closed-data-contract-reproduced')
 STAGE='verify-live-readonly-observation';live=CORE.capture(OUT/'live-observation',current['databaseContainer']);private('live-observation-difference.private.json',{'businessTablesIdenticalToClosedAcceptance':live['postgres']['tables']==observed['postgres']['tables'],'schemaIdenticalToClosedAcceptance':live['postgres']['schema']==observed['postgres']['schema'],'uploadsIdenticalToClosedAcceptance':live['uploads']==observed['uploads'],'liveObservationAfterReopeningMayIncludeUserOperations':True});result['public']=public(TARGET);stable(current,b,files);archive(BACKUP,BACKUP_MANIFEST,BACKUP_RESULT);archive(PREPARE,PREPARE_MANIFEST,PREPARE_RESULT);archive(DEPLOY,DEPLOY_MANIFEST,DEPLOY_RESULT);result.update(success=True,image=p['image'],onlyInternalQuoteDeploymentVerified=True,allOtherContainersUnchanged=True,otherContainerCount=len(current['others']),originalClosedBusinessDataAcceptanceReproduced=True,environmentAndPermissionsPreserved=True,liveObservationCapturedWithoutAttributingOrOverwritingDifferences=True)

def main():
 global CORE,OUT,ENV
 need(sys.argv[1:]and sys.argv[1:]in[['prepare'],['deploy'],['verify']],'fixed-phase-argument');phase=sys.argv[1];need({'prepare':PREPARE_PIN,'deploy':DEPLOY_PIN,'verify':VERIFY_PIN}[phase]and pin(TARGET,40)and pin(TREE,40)and pin(CORE_SHA)and pin(SOURCE_MANIFEST_SHA),'false-draft-or-missing-review-pins');need(os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_ATTEMPT')=='1','fixed-branch-first-attempt');os.umask(0o077);OUT={'prepare':PREPARE,'deploy':DEPLOY,'verify':VERIFY}[phase];OUT.mkdir(mode=0o700);CORE=load_core();ENV=dict(os.environ,COMPOSE_PROJECT_NAME='rr-portal',COMPOSE_BAKE='false',COMPOSE_PARALLEL_LIMIT='1',COMPOSE_FILE=str(ROOT/'docker-compose.cloud.yml'),ENV_FILE=str(ROOT/'.env.cloud.production'),MAINT_FLAG_DIR=str(ROOT/'deploy/maintenance'),MAINT_COMPOSE_SERVICES=SERVICE,MAINT_HEALTH_TIMEOUT_SECONDS='300',MAINT_DNS_GRACE_SECONDS='10');signal.signal(signal.SIGTERM,lambda *_:need(False,'terminated'));result={'mode':phase,'base':BASE,'target':TARGET,'tree':TREE,'success':False,'businessAPIMutationsPerformed':False,'environmentFileModified':False,'credentialsOrMailboxStateChanged':False,'globalMaintenanceOrOtherServiceDeploymentRequested':False,'databaseRestoreOrSequenceResetPerformed':False}
 try:
  b=baseline();files=source_manifest();{'prepare':prepare,'deploy':deploy,'verify':verify}[phase](result,b,files)
 except BaseException as error:
  result.update(success=False,failedStage=STAGE,failedCheck=FAILED_CHECK,safeExceptionType=type(error).__name__);private('failure.private.txt',traceback.format_exc().encode())
 finally:
  private('first-result.json',result);CORE.OPS.L.seal(OUT);print(enc(dict(result,manifestSHA256=CORE.OPS.L.file_hash(OUT/'manifest.json'),resultSHA256=CORE.OPS.L.file_hash(OUT/'first-result.json'))).decode(),flush=True)
 return 0 if result['success']else 1

if __name__=='__main__':
 try:sys.exit(main())
 except SystemExit:raise
 except BaseException:print('{"success":false,"safeFailure":"PR982_RELEASE_PREFLIGHT_REJECTED"}',flush=True);sys.exit(1)
