"""Scoped parser release and read-only natural-sync verification. Both gates default off."""
import collections,contextlib,copy,hashlib,importlib.util,io,json,os,pathlib,re,sqlite3,stat,subprocess,sys,tarfile,time,traceback
ROOT=pathlib.Path('/opt/rr-portal');BASE='b30a803e74641e0e18150597e0114f6cb99b2e9c';TARGET='6fc1143c0b39470d814caac553beaaf3bc2912e0';TREE='d8d061f9febf7608e7a07721f96b6b9ba5a88266'
BRANCH='refs/heads/ops/voyageplex-size-fix-20261020';RELEASE_PIN=False;VERIFY_PIN=False
RELEASE=ROOT/'deploy/backups/voyageplex-size-fix-20261020-release';RELEASE_MANIFEST='';RELEASE_RESULT=''
PREFIX='apps/船务部/VoyagePlex船务协同系统/services/email-parser';REVIEWED_FILES={PREFIX+'/app/mailbox.py':'c6246781845d4cd40439d7286c9f3afcfae0dcafc4b106de780bd715e3b201a9',PREFIX+'/tests/test_mailbox_protocol.py':'2b408538ed347a1ab40a223f7593fca5c47696efd8710d371afaba1fde211c8e',PREFIX+'/tests/test_mailbox_retry.py':'e270051a932b48b11346f64fe87f7b02410752cf553344041c3cad7bc226e12e'}
ALLOWED={PREFIX+'/app/mailbox.py',PREFIX+'/tests/test_mailbox_protocol.py',PREFIX+'/tests/test_mailbox_retry.py'};SERVICE='voyageplex-parser'
EXPECTED_IMAGES={'voyageplex-api':'sha256:a2384da1fe8f0a920de18ca6a22f292babb0b8f2cd6a58829d7ff90c8bb55987','voyageplex-parser':'sha256:fac9deb5e681966ab30e9192cd421ff144a82c5e1c64677adce87bcf01307d32','voyageplex-web':'sha256:f25b1e36eb9a73c60ecffd4f270c07d2a3596eca0c73afb2b9b9c232330235b4'}
LIB_SHA='2c5675ab534d1fcac5f28698e5418daf3ca0366b549c0c9b78fb58d95e95d4c0';CORE_SHA='a06bd4dd932df22b9127cda35a2dd7a8d69fafd879d6619ce3b50aa54252cd5d'
PLAN=(('xingxin',1,'Xingxin',0,1545369828),('huadeng-1',1002,'Huadeng',2,1320665681),('huadeng-2',1003,'Huadeng',3,1531270833),('huadeng-3',1005,'Huadeng',5,1739454422),('huadeng-4',1006,'Huadeng',6,None))
USER_FIELDS=('Id','Username','Role','CompanyAccess','IsActive','MailboxAddress','MailboxHost','MailboxFolder');STATE_FIELDS=('Id','Address','UidValidity','MailboxIdentity','ConfigurationKey')
COMPOSE=['docker','compose','-p','rr-portal','-f',str(ROOT/'docker-compose.cloud.yml'),'--env-file',str(ROOT/'.env.cloud.production')]
M=None;CORE=None;OUT=None;STAGE='preflight';COUNT=0
def need(value,label):
 if not value:raise RuntimeError(label if re.fullmatch('[a-z0-9-]{1,100}',label)else'invariant')
def enc(value):return json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=True,allow_nan=False).encode()
def sha(value):return hashlib.sha256(value).hexdigest()
def pin(value,n=64):return type(value)is str and re.fullmatch('[a-f0-9]{%d}'%n,value)is not None
def private(name,value):CORE.OPS.L.private_write(OUT/name,value if type(value)is bytes else enc(value))
def command(args,label,timeout=90,checkout=False):
 global COUNT
 COUNT+=1;path=OUT/('%04d-%s.private.log'%(COUNT,label))
 with path.open('xb')as stream:result=subprocess.run(args,stdout=stream,stderr=subprocess.STDOUT,cwd=ROOT,timeout=timeout,umask=0o022 if checkout else -1)
 need(result.returncode==0,'command-'+label);return path
def capture(args,label,timeout=90):
 code,data=M.capture(args,label,timeout);need(code==0,'capture-'+label);return data
def load(name,checksum):
 path=pathlib.Path(__file__).with_name(name);need(pin(checksum)and path.is_file()and not path.is_symlink()and sha(path.read_bytes())==checksum,'library-pin');spec=importlib.util.spec_from_file_location('parserfix_'+name.replace('.','_'),path);value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value);return value
def initialize():
 global M,CORE
 M=load('mail-observation-library.py',LIB_SHA);CORE=load('batch-backup-library.py',CORE_SHA);CORE.OUT=OUT;CORE.initialize();CORE.BASE=BASE;M.CORE=CORE;M.OUT=OUT;old=M.capture
 M.capture=lambda args,label,timeout=60,data=None:old(args,label.replace('_','-'),timeout,data)
def inventory():
 ids=capture(['docker','ps','-aq','--no-trunc'],'container-ids').decode().split();need(0<len(ids)<=1000 and len(set(ids))==len(ids)and all(pin(v)for v in ids),'container-ids');records=json.loads(capture(['docker','inspect',*ids],'all-container-inspect'));need(len(records)==len(ids),'inspect-count');others={};targets={};seen=set()
 for row in records:
  need(row['Id']in ids and row['Id']not in seen,'inspect-identity');seen.add(row['Id']);labels=row['Config'].get('Labels')or{};service=labels.get('com.docker.compose.service')if labels.get('com.docker.compose.project')=='rr-portal'else None
  if service in EXPECTED_IMAGES:need(service not in targets,'unique-voyage-service');targets[service]=row
  if service!=SERVICE:others[row['Id']]={'Id':row['Id'],'Image':row['Image'],'Config':row['Config'],'HostConfig':row['HostConfig'],'Mounts':sorted(row.get('Mounts',[]),key=enc),'StartedAt':row['State']['StartedAt'],'Running':row['State']['Running'],'RestartCount':row['RestartCount'],'OOMKilled':row['State']['OOMKilled']}
 need(set(targets)==set(EXPECTED_IMAGES),'all-three-voyage-services');return targets,others
def process_environment(cid):
 blob=capture(['docker','exec',cid,'cat','/proc/1/environ'],'parser-process-environment');need(blob.endswith(b'\0'),'process-environment-format');values=CORE.envmap([v.decode()for v in blob.split(b'\0')if v]);need(values.pop('HOSTNAME',None)==cid[:12],'automatic-hostname');return values
def protected(state):
 return {'users':[{k:row[k]for k in USER_FIELDS}for row in state['users']],'settings':state['settings'],'namespaces':[{k:row[k]for k in STATE_FIELDS}for row in state['states']]}
def mail_evidence(db,baseline=None):
 state=M.selected_state(db);need({r['Id']for r in state['states']}=={r['Id']for r in state['settings']}=={p[1]for p in PLAN}and{r['Id']for r in state['users']}=={p[3]for p in PLAN if p[3]},'five-mailboxes-four-users');byid={r['Id']:r for r in state['states']};facts=[]
 for slot,stateid,company,owner,uid in PLAN:
  row=byid[stateid];need((stateid==1 and owner==0 and company=='Xingxin'or stateid==1000+owner and company=='Huadeng')and int(row['UidValidity'])>0 and bool(row['Address']),'known-mailbox-namespace');count=db.execute('SELECT COUNT(*) FROM ImportEmailItems WHERE Company=?'+(' AND MailOwnerId=?'if owner else'')+" AND MailboxKey<>''",(company,owner)if owner else(company,)).fetchone()[0];key=None;matches=[]
  if uid is not None:
   key=('%s:%s:%s'%(row['Address'],row['UidValidity'],uid))if not owner else'Huadeng:%s:%s:%s:%s:%s'%(owner,row['MailboxIdentity'],row['Address'],row['UidValidity'],uid);matches=list(db.execute('SELECT Company,MailOwnerId,Status,Error FROM ImportEmailItems WHERE MailboxKey=?',(key,)))
  own=len(matches)==1 and matches[0][0]==company and matches[0][1]==owner if uid is not None else None;parsed=bool(own and matches[0][2]in{'pending','duplicate','confirmed','duplicate_confirmed'}and not matches[0][3])if uid is not None else None;old=(baseline or{}).get(slot);item={'slot':slot,'stateId':stateid,'blockedUID':uid,'lastUid':row['LastUid'],'lastErrorPresent':bool(row['LastError']),'lastErrorCategory':M.error_category(row['LastError']),'lastSuccessAt':M.safe_date(row['LastSuccessAt']),'storedMailCount':count,'targetExactKeyRowCount':len(matches)if uid is not None else None,'targetBelongsToExpectedCompanyAndOwner':own,'targetDownloadedAndStored':own,'targetParsedSuccessfully':parsed,'targetHasParseError':bool(matches[0][3]or matches[0][2]=='failed')if len(matches)==1 else None,'targetStatus':matches[0][2]if len(matches)==1 and matches[0][2]in{'pending','failed','duplicate','confirmed','duplicate_confirmed','Pending'}else None,'cursorAtOrBeyondTarget':row['LastUid']>=uid if uid is not None else None}
  transport=bool(old and not row['LastError']and count>=old['storedMailCount']and row['LastUid']>=old['lastUid']and row['LastSuccessAt']and(not old['lastSuccessAt']or row['LastSuccessAt']>old['lastSuccessAt'])and(uid is None or own and row['LastUid']>=uid and(row['LastUid']>old['lastUid']or old['lastUid']>=uid)));item['naturalDownloadRecoveryObserved']=transport;item['naturalRecoveryObserved']=bool(transport and(uid is None or parsed));facts.append(item)
 return state,facts
def snapshot(label,raw,baseline=None):
 path=OUT/label;path.mkdir(mode=0o700);saved=(M.OUT,CORE.OUT);M.OUT=CORE.OUT=path
 try:
  config,entries=M.configuration(raw);facts,unused,state=M.database_snapshot(entries,M.environment(raw[SERVICE]));need(all(v['syncEnabled']and v['cursorNamespaceKnown']and v['runtimeCredentialsEligibleForConnection']and(v['company']=='Xingxin'or v['bindingMatchesRuntimeConfiguration']and v['personalConfigurationKeyMatchesRuntime'])for v in facts['mailboxes']),'all-five-current-bindings-and-sync-enabled')
  with contextlib.closing(CORE.OPS.L.connect(path/'voyageplex-consistent.private.sqlite',True))as db:state,proof=mail_evidence(db,baseline)
  return {'environmentSHA256':config['privateEnvironmentSHA256'],'protected':protected(state),'mailboxes':proof,'state':state}
 finally:M.OUT,CORE.OUT=saved
def guarded_source(revision,dirty):
 CORE.BASE=revision;need(capture(['git','symbolic-ref','--quiet','HEAD'],'main-branch').decode().strip()=='refs/heads/main'and capture(['git','rev-parse','HEAD'],'main-head').decode().strip()==revision,'exact-main-head');need(CORE.dirty_snapshot()==dirty,'preexisting-tracked-changes-preserved');need(capture(['git','rev-parse',TARGET+'^{tree}'],'target-tree').decode().strip()==TREE,'reviewed-target-tree');names=capture(['git','diff','--name-only','-z',BASE,TARGET],'reviewed-diff').decode().strip('\0').split('\0');need(set(names)==set(REVIEWED_FILES)==ALLOWED,'three-reviewed-parser-files')
 for name,checksum in REVIEWED_FILES.items():need(sha(capture(['git','show',TARGET+':'+name],'reviewed-git-blob'))==checksum,'reviewed-git-source-hash')
 need(capture(['git','diff','--name-only','--',PREFIX],'parser-working-tree').strip()==b'','clean-parser-working-tree')
def overlay(base,oldenv,image=None):
 value=CORE.serialized_environment(oldenv);text='services:\n  voyageplex-parser:\n    environment: !override '+json.dumps(value,separators=(',',':'))+'\n'
 if image:text+='    image: '+image+'\n    pull_policy: never\n'
 path=OUT/('parser-image.private.yml'if image and image.startswith('sha256:')else'parser-build.private.yml');CORE.OPS.L.private_write(path,text.encode());args=[*COMPOSE,'-f',str(path)];observed=json.loads(capture([*args,'config','--format','json'],'parser-compose-config'));expected=copy.deepcopy(base);expected['services'][SERVICE]['environment']=value
 if image:expected['services'][SERVICE].update(image=image,pull_policy='never')
 need(observed==expected,'compose-overlay-only-parser-image-and-literal-env');return args
def image_source(image):
 CORE.BASE=TARGET;names=[name[len(PREFIX)+1:]for name in CORE.git_files(PREFIX)if name[len(PREFIX)+1:]=='requirements.txt'or name[len(PREFIX)+1:].startswith('app/')];expected={name:sha(capture(['git','show',TARGET+':'+PREFIX+'/'+name],'parser-source-blob'))for name in names};blob=capture(['docker','run','--rm','--network','none','--read-only','--log-driver','none','--entrypoint','tar',image,'-C','/app','-cf','-',*names],'isolated-parser-source',120);actual={}
 with tarfile.open(fileobj=io.BytesIO(blob),mode='r:')as archive:
  for member in archive:need(member.isfile()and member.name in expected and member.name not in actual and member.size<=8*1024**2,'candidate-canonical-file');actual[member.name]=sha(archive.extractfile(member).read())
 need(actual==expected,'candidate-all-parser-source-hashes');private('candidate-source-manifest.private.json',actual);return {'allParserAppAndRequirementsMatchReviewedSource':True,'sourceFileCount':len(actual)}
def stable(baseline,parser_image=None):
 raw,others=inventory();need(others==baseline['others'],'all-nonparser-containers-unchanged');need(CORE.OPS.L.file_hash(ROOT/'.env.cloud.production')==baseline['environmentSHA256'],'production-env-file-unchanged');need(CORE.dirty_snapshot()==baseline['dirty'],'preexisting-tracked-changes-preserved');need(CORE.maintenance_inventory()==baseline['maintenance'],'all-maintenance-flags-unchanged')
 if parser_image:need(raw[SERVICE]['Image']==parser_image and raw[SERVICE]['State']['Running']and raw[SERVICE]['State'].get('Health',{}).get('Status')=='healthy'and not raw[SERVICE]['State']['OOMKilled']and raw[SERVICE]['RestartCount']==0,'expected-healthy-parser-image-no-restart')
 return raw
def wait_healthy(image):
 deadline=time.monotonic()+180
 while True:
  raw,_=inventory();row=raw[SERVICE];need(row['Image']==image and row['State']['Running']and not row['State']['OOMKilled'],'new-parser-running-no-oom')
  if row['State'].get('Health',{}).get('Status')=='healthy':return raw
  need(time.monotonic()<deadline,'parser-health-timeout');time.sleep(5)
def parser_configuration(before,after,oldprocess):
 need(M.environment(before)==M.environment(after),'actual-parser-environment-preserved');need(sorted(before['Mounts'],key=enc)==sorted(after['Mounts'],key=enc),'parser-mounts-preserved');need(before['HostConfig']==after['HostConfig'],'parser-host-configuration-preserved');need(all(before['Config'].get(k)==after['Config'].get(k)for k in('User','WorkingDir','Cmd','Entrypoint','Healthcheck')),'parser-user-command-health-preserved');need(process_environment(after['Id'])==oldprocess,'parser-process-environment-preserved')
def observe_natural_sync(baseline):
 old={v['slot']:v for v in baseline['mailboxes']};deadline=time.monotonic()+600;attempt=0;last=[]
 while True:
  with contextlib.closing(M.readonly_live())as db:state,last=mail_evidence(db,old)
  need(protected(state)==baseline['protected'],'mailbox-users-settings-and-namespaces-preserved');attempt+=1;private('natural-observation-%02d.private.json'%attempt,last)
  if all(v['naturalRecoveryObserved']for v in last):return last
  if time.monotonic()>=deadline:return last
  time.sleep(min(30,max(0,deadline-time.monotonic())))
def release(result):
 global STAGE
 STAGE='private-predeployment-evidence';raw,others=inventory();need(all(raw[s]['Image']==EXPECTED_IMAGES[s]and raw[s]['State']['Running']and raw[s]['State'].get('Health',{}).get('Status')=='healthy'for s in EXPECTED_IMAGES),'fixed-baseline-three-images');CORE.BASE=BASE;dirty=CORE.dirty_snapshot(save=True);pre=snapshot('before',raw);baseline=dict(pre,others=others,dirty=dirty,maintenance=CORE.maintenance_inventory(),parserBefore=raw[SERVICE],parserProcessEnvironment=process_environment(raw[SERVICE]['Id']));private('baseline.private.json',baseline)
 for s in EXPECTED_IMAGES:M.log_capture('before-'+s,raw[s]['Id'])
 base=json.loads(capture([*COMPOSE,'config','--format','json'],'base-compose'));need(base['services'][SERVICE].get('command')is None and base['services'][SERVICE].get('entrypoint')is None,'compose-null-command-inherits');oldenv=M.environment(raw[SERVICE]);tag='rr-portal-voyageplex-parser-size-fix:'+TARGET;buildargs=overlay(base,oldenv,tag);oldimage=json.loads(capture(['docker','image','inspect',raw[SERVICE]['Image']],'old-parser-image'))[0];private('old-parser-image.private.json',oldimage)
 STAGE='reviewed-source-fast-forward';need(capture(['git','rev-parse','HEAD'],'baseline-main').decode().strip()==BASE,'baseline-main-exact');command(['git','-c','core.hooksPath=/dev/null','fetch','--no-write-fetch-head','origin','main:refs/rr-portal-parser-size-fix'],'fetch-reviewed-main',180);need(capture(['git','rev-parse','refs/rr-portal-parser-size-fix'],'fetched-main').decode().strip()==TARGET,'fetched-main-exact');guarded_source(BASE,dirty);command(['git','-c','core.hooksPath=/dev/null','merge','--ff-only',TARGET],'fast-forward-reviewed-source',180,True);guarded_source(TARGET,dirty)
 STAGE='build-only-parser';stable(baseline);command([*buildargs,'build',SERVICE],'build-parser',1800);candidate=json.loads(capture(['docker','image','inspect',tag],'candidate-parser-image'))[0];private('candidate-parser-image.private.json',candidate);need(pin(candidate['Id'].removeprefix('sha256:'))and candidate.get('Architecture')==oldimage.get('Architecture')=='amd64'and candidate.get('Os')==oldimage.get('Os')=='linux','candidate-image-platform');need(CORE.envmap(candidate['Config'].get('Env')or[])==CORE.envmap(oldimage['Config'].get('Env')or[]),'candidate-image-default-environment-preserved');need(all(candidate['Config'].get(k)==oldimage['Config'].get(k)for k in('User','WorkingDir','Cmd','Entrypoint')),'candidate-image-command-user-preserved');result['candidateSource']=image_source(candidate['Id']);args=overlay(base,oldenv,candidate['Id']);stable(baseline)
 STAGE='recreate-only-parser';command([*args,'up','-d','--no-deps','--force-recreate','--no-build','--pull','never',SERVICE],'recreate-parser',180);result['parserContainerRecreated']=True;current=wait_healthy(candidate['Id']);parser_configuration(raw[SERVICE],current[SERVICE],baseline['parserProcessEnvironment']);CORE.BASE=TARGET;proof=CORE.service_source_proof(SERVICE,{'id':current[SERVICE]['Id']});private('running-parser-source.private.json',proof);need(proof['reviewedSourceMatch']is True,'running-all-parser-source-hashes');stable(baseline,candidate['Id']);result.update(parserImageID=candidate['Id'],parserHealthy=True,parserSourceMatchesReviewedTarget=True,actualParserEnvironmentPreserved=True,onlyParserContainerRecreated=True);private('deployed.private.json',{'image':candidate['Id'],'id':current[SERVICE]['Id'],'target':TARGET,'tree':TREE})
 STAGE='natural-background-sync-observation';observed=observe_natural_sync(baseline);post=snapshot('after',stable(baseline,candidate['Id']),{v['slot']:v for v in baseline['mailboxes']});need(post['protected']==baseline['protected'],'post-users-settings-namespace-preserved');private('post.private.json',post)
 for s,row in current.items():M.log_capture('after-'+s,row['Id'])
 final=stable(baseline,candidate['Id']);need(final[SERVICE]['Id']==current[SERVICE]['Id'],'same-released-parser-container');parser_configuration(raw[SERVICE],final[SERVICE],baseline['parserProcessEnvironment'])
 result.update(mailboxes=post['mailboxes'],recoveryPassed=all(v['naturalRecoveryObserved']for v in post['mailboxes']),backfillCompleteUnknown=True,naturalSyncRecovered=all(v['naturalRecoveryObserved']for v in post['mailboxes']),environmentFileUnchanged=True,allNonparserContainersUnchanged=True,mailboxUsersRolesSettingsNamespacesUnchanged=True,success=all(v['naturalRecoveryObserved']for v in post['mailboxes']))
def verified_release():
 need(pin(RELEASE_MANIFEST)and pin(RELEASE_RESULT),'release-seal-pins');need(RELEASE.is_dir()and not RELEASE.is_symlink()and RELEASE.stat().st_mode&0o077==0,'release-private-directory');need(CORE.OPS.L.file_hash(RELEASE/'manifest.json')==RELEASE_MANIFEST and CORE.OPS.L.file_hash(RELEASE/'first-result.json')==RELEASE_RESULT,'release-manifest-result-pins');manifest=json.loads((RELEASE/'manifest.json').read_bytes());files=list(RELEASE.rglob('*'));need(len(files)<=100000 and all(not p.is_symlink()and(p.is_file()or p.is_dir())and p.stat().st_mode&0o077==0 for p in files),'release-private-files');need(set(manifest)=={str(p.relative_to(RELEASE))for p in files if p.is_file()and p!=RELEASE/'manifest.json'},'release-complete-manifest');need(all(CORE.OPS.L.safe_path(n)and pin(h)and CORE.OPS.L.file_hash(RELEASE/n)==h for n,h in manifest.items()),'release-full-byte-seals');receipt=json.loads((RELEASE/'first-result.json').read_bytes());need(receipt.get('target')==TARGET and receipt.get('parserContainerRecreated')is True and receipt.get('parserHealthy')is True and receipt.get('parserSourceMatchesReviewedTarget')is True,'prior-parser-release-completed');return json.loads((RELEASE/'baseline.private.json').read_bytes()),json.loads((RELEASE/'deployed.private.json').read_bytes())
def verify(result):
 global STAGE
 STAGE='sealed-release-evidence';baseline,deployed=verified_release();need(deployed['target']==TARGET and deployed['tree']==TREE,'deployed-reviewed-source');CORE.BASE=TARGET;guarded_source(TARGET,baseline['dirty']);raw=stable(baseline,deployed['image']);need(raw[SERVICE]['Id']==deployed['id'],'same-released-parser-container');parser_configuration(baseline['parserBefore'],raw[SERVICE],baseline['parserProcessEnvironment']);STAGE='readonly-natural-sync-observation';observe_natural_sync(baseline);post=snapshot('verify',stable(baseline,deployed['image']),{v['slot']:v for v in baseline['mailboxes']});need(post['protected']==baseline['protected'],'verify-users-settings-namespace-preserved');need(verified_release()[1]==deployed,'original-release-evidence-retained');result.update(mailboxes=post['mailboxes'],parserImageID=deployed['image'],parserHealthy=True,allNonparserContainersUnchanged=True,actualParserEnvironmentPreserved=True,environmentFileUnchanged=True,mailboxUsersRolesSettingsNamespacesUnchanged=True,recoveryPassed=all(v['naturalRecoveryObserved']for v in post['mailboxes']),backfillCompleteUnknown=True,naturalSyncRecovered=all(v['naturalRecoveryObserved']for v in post['mailboxes']),success=all(v['naturalRecoveryObserved']for v in post['mailboxes']))
def main():
 global OUT,STAGE
 need(len(sys.argv)==2 and sys.argv[1]in{'release','verify'},'mode');mode=sys.argv[1];need((RELEASE_PIN if mode=='release'else VERIFY_PIN)and os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_ATTEMPT')=='1','execution-gates');need(pin(TARGET,40)and pin(TREE,40)and TARGET!=BASE and set(REVIEWED_FILES)==ALLOWED and all(pin(v)for v in REVIEWED_FILES.values()),'reviewed-source-pins');runid=os.environ.get('RELEASE_RUN_ID','');need(re.fullmatch('[0-9]{1,20}',runid)is not None,'run-id');OUT=RELEASE if mode=='release'else ROOT/('deploy/backups/voyageplex-size-fix-20261020-verify-'+runid);os.umask(0o077);OUT.mkdir(mode=0o700);initialize();result={'mode':mode,'base':BASE,'target':TARGET,'tree':TREE,'success':False,'recoveryPassed':False,'backfillCompleteUnknown':True,'maximumMessagesPerNaturalPoll':5,'parserContainerRecreated':False,'manualMailboxSyncTestResetSkipOrRetryPerformed':False,'globalOrServiceMaintenanceChanged':False,'apiOrWebRecreated':False,'businessDataMailboxConfigurationOrProductionEnvFileWritesPerformed':False,'mailboxCursorsManuallyModified':False,'automaticRollbackPerformed':False,'concurrentBusinessWritesObservedWithoutActorAttribution':True,'rawSecretsOrMailContentPrinted':False}
 try:(release if mode=='release'else verify)(result)
 except BaseException as error:result.update(failedStage=STAGE,safeFailure=str(error)if type(error)is RuntimeError and re.fullmatch('[a-z0-9-]{1,100}',str(error))else'parser-release-or-observation-incomplete',exceptionType=type(error).__name__ if type(error).__name__ in{'RuntimeError','OSError','ValueError','KeyError','TimeoutError','TimeoutExpired'}else'Other');private('failure-traceback.private.txt',traceback.format_exc().encode())
 finally:private('first-result.json',result);CORE.OPS.L.seal(OUT);public=dict(result,manifestSHA256=CORE.OPS.L.file_hash(OUT/'manifest.json'),resultSHA256=CORE.OPS.L.file_hash(OUT/'first-result.json'));need(len(enc(public))<24000,'public-receipt-bound');print(enc(public).decode(),flush=True)
 return 0 if result['success']else 1
if __name__=='__main__':
 try:sys.exit(main())
 except Exception:print('{"success":false,"safeFailure":"PARSER_SIZE_FIX_PREFLIGHT_REJECTED"}',flush=True);sys.exit(1)
