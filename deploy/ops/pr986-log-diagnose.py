"""Inert, read-only diagnosis of the sealed PR986 auxiliary log mismatch.

No database writes/restores, config updates, container signals or deployments.
Only fixed counts, booleans, policy integers and UTC timestamps leave the server.
"""
import contextlib,copy,datetime,hashlib,importlib.util,io,json,os,pathlib,re,signal,sqlite3,stat,subprocess,sys,tarfile,time,traceback
PIN=True
ROOT=pathlib.Path('/opt/rr-portal');BASE='556798afb260020ca8f990c66290177ad0bf3e44';TARGET='97d563e93aca3d9e3c0bc512dd622d6a3002e710';TREE='ad906e8b24b81df8e7ade91d15c5e9ab4ab839ab';BRANCH='refs/heads/ops/pr-986-20261021'
OUT=ROOT/'deploy/backups/pr-986-20261021-log-diagnose'
LIBRARY_SHA='d63168fd3057f4f2aba2d93f9fab31d2d65c6dd0f3234877d71fcff1e04e62b9'
ARCHIVES={
 'backup':('pr-986-20261021-backup','5663afabd6a7a3c1923bfbd7fa3806429f94ac3042bff53e0b12fac0fa74cdd7','12271c965cd359d715caba26ea53e471d5e07f63e4d7605a339f720bb954a273'),
 'prepare':('pr-986-20261021-prepare','dddcfdaca6b1c0cef03c42ffadf50fd9dc71dc9f94f62a6ec09a84ca8c47b7a2','17a7197f4435db08a6ce54877974057e2ebbb2848dbe1cfa1f80c16de29162ca'),
 'deploy':('pr-986-20261021-deploy','5757e2fe6dcbcaa889c7a9a743cd2c98a07bf3646fd6680b6bb17912d20e5115','24b9cd70f51c1b65fd9fb58d21e6d484145c6b6c628be6c8c8fb42b1ee6c98b2')}
SERVICES=('factory-review-test','factory-review');L=None;STAGE='entrypoint';SERIAL=0

def need(value,label):
 global STAGE
 if not value:STAGE=label;raise RuntimeError('PR986_READONLY_DIAGNOSE_REJECTED')
def enc(v):return json.dumps(v,ensure_ascii=True,sort_keys=True,separators=(',',':'),allow_nan=False).encode()
def sha(v):return hashlib.sha256(v).hexdigest()
def read(p):
 need(p.is_file()and not p.is_symlink()and p.stat().st_size<=128*1024**2,'bounded-regular-json');return json.loads(p.read_bytes())
def load():
 p=pathlib.Path(__file__).with_name('release-data-library.py');need(p.is_file()and not p.is_symlink()and sha(p.read_bytes())==LIBRARY_SHA,'readonly-library-pin');s=importlib.util.spec_from_file_location('pr986_diag_readonly_library',p);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
def archive(mode):
 name,mhash,rhash=ARCHIVES[mode];p=ROOT/'deploy/backups'/name;need(p.is_dir()and not p.is_symlink()and stat.S_IMODE(p.stat().st_mode)==0o700,'private-original-directory');need(L.file_hash(p/'manifest.json')==mhash and L.file_hash(p/'first-result.json')==rhash,'original-receipt-seals');manifest=read(p/'manifest.json');entries=list(p.rglob('*'));need(type(manifest)is dict and len(entries)<=100000 and all(not a.is_symlink()and(a.is_dir()or a.is_file())and a.stat().st_mode&0o077==0 for a in entries),'private-original-entries');need(set(manifest)=={str(a.relative_to(p))for a in entries if a.is_file()and a!=p/'manifest.json'},'complete-original-inventory');need(all(L.safe_path(n)and re.fullmatch('[a-f0-9]{64}',h)and L.file_hash(p/n)==h for n,h in manifest.items()),'all-original-byte-seals');result=read(p/'first-result.json');need(result['mode']==mode and result['base']==BASE and result['success']is(mode!='deploy'),'original-mode-and-outcome')
 if mode!='backup':need(result['target']==TARGET and result['tree']==TREE,'original-reviewed-target')
 if mode=='deploy':need(result.get('failedStage')=='retained-logs-typed-identical-only-valid-additions-or-retention'and result.get('failedService')=='factory-review'and result.get('completedServices')==['factory-review-test']and result.get('failedServiceRolledBackWithoutRestoringData')is True,'exact-known-log-failure')
 return p,result
def stamp(value):
 if type(value)is not str or not re.fullmatch(r'\d{4}-\d\d-\d\d[ T]\d\d:\d\d:\d\d(?:\.\d{1,9})?(?:Z|[+-]\d\d:\d\d)',value):return None
 try:return datetime.datetime.fromisoformat(value.replace('Z','+00:00')).astimezone(datetime.timezone.utc)
 except ValueError:return None
def utc(value):return value.isoformat()if value is not None else None
def kind(value):return 'null'if value is None else'text'if type(value)is str else'integer'if type(value)is int else'real'if type(value)is float else'blob'if type(value)is bytes else'other'
def policy(path):
 with contextlib.closing(L.connect(path,True))as db:
  row=db.execute("SELECT CASE WHEN json_valid(value) THEN json_extract(value,'$.logs.maxDays') END,CASE WHEN json_valid(value) THEN json_extract(value,'$.logs.minLevel') END,CASE WHEN json_valid(value) THEN json_type(value,'$.logs.maxDays') END,CASE WHEN json_valid(value) THEN json_type(value,'$.logs.minLevel') END FROM _params WHERE id='settings'").fetchone()
 valid=row is not None and row[2:]==('integer','integer')and type(row[0])is int and 0<=row[0]<=36500 and type(row[1])is int and -100<=row[1]<=100
 return {'available':valid,'maxDays':row[0]if valid else None,'minLevel':row[1]if valid else None,'maxDaysType':kind(row[0])if row is not None else'missing','minLevelType':kind(row[1])if row is not None else'missing'}
def safe_audit(path):
 value=read(path);allowed={'oldRows','retainedTypedIdentical','retainedTypedChanged','missing','missingCompatibleWithConfiguredRetention','newRows','newRowsWithinRequestTime','configuredPolicyAvailableAndUnchanged','compatibleWithoutChangingRetainedRows'};need(type(value)is dict and set(value)==allowed and all(type(v)is bool or type(v)is int and 0<=v<=2**63-1 for v in value.values()),'fixed-archived-audit-shape');return value
def log_comparison(directory,service):
 before=read(directory/(service+'-closed-before.private.json'));after=read(directory/(service+'-after-start.private.json'));lower=stamp(before['observedUTC']);upper=stamp(after['observedUTC']);need(lower is not None and upper is not None and lower<=upper,'sealed-snapshot-observation-window');a=directory/(service+'-closed-before/sqlite');b=directory/(service+'-after-start/sqlite');pa,pb=policy(a/'data.db'),policy(b/'data.db');same=pa==pb and pa['available'];cutlo=lower-datetime.timedelta(days=pa['maxDays'])if same else None;cuthi=upper-datetime.timedelta(days=pa['maxDays'])if same else None
 result={'existingSealedAudit':safe_audit(directory/(service+'-log-audit.private.json')),'closedBeforeObservedUTC':utc(lower),'afterStartObservedUTC':utc(upper),'candidateStartedAtEvidenceAvailable':False,'candidateStartedAtNotSubstitutedFromRollbackOrSnapshot':True,'snapshotWindowIsSupplementalNotOriginalStartWindow':True,'dataDatabaseTypedSchemaAndRowsIdentical':before['sqlite']['data.db']==after['sqlite']['data.db'],'auxiliarySchemaIdentical':before['sqlite']['auxiliary.db']['schema']==after['sqlite']['auxiliary.db']['schema'],'auxiliaryNonLogTablesIdentical':{k:v for k,v in before['sqlite']['auxiliary.db']['tables'].items()if k!='_logs'}=={k:v for k,v in after['sqlite']['auxiliary.db']['tables'].items()if k!='_logs'},'filesAndMetadataIdentical':before['files']==after['files']and before['metadata']==after['metadata'],'policyBefore':pa,'policyAfter':pb,'policyAvailableAndUnchanged':same,'retainedTypedIdentical':0,'retainedTypedChanged':0,'retainedChangesByFixedField':{'created':0,'level':0,'message':0,'data':0,'other':0},'missing':0,'missingLevelEligible':0,'missingDefinitelyAgeEligible':0,'missingPossiblyAgeEligible':0,'missingDefinitelyNotAgeEligible':0,'missingInvalidCreated':0,'newRows':0,'newCreatedTypeCounts':{k:0 for k in('null','text','integer','real','blob','other')},'newInvalidCreated':0,'newBeforeClosedObservation':0,'newWithinSupplementalSnapshotWindow':0,'newAfterObservation':0,'newEarliestUTC':None,'newLatestUTC':None}
 deadline=time.monotonic()+90
 with contextlib.closing(L.connect(a/'auxiliary.db',True))as db:
  db.set_progress_handler(lambda:int(time.monotonic()>deadline),10000);db.execute('ATTACH DATABASE ? AS afterdb',((b/'auxiliary.db').as_uri()+'?mode=ro&immutable=1',));cols=db.execute('PRAGMA table_xinfo(_logs)').fetchall();result['logColumnSchemaIdentical']=cols==db.execute('PRAGMA afterdb.table_xinfo(_logs)').fetchall();need(result['logColumnSchemaIdentical']and cols and[c[1]for c in cols if c[5]]==['id'],'known-identical-log-schema');names=[c[1]for c in cols];need({'id','created','level'}<=set(names),'required-log-fields');q=L.quote;need(all(db.execute('SELECT count(*)=count(DISTINCT id) FROM '+prefix+'._logs').fetchone()==(1,)for prefix in('main','afterdb')),'unique-log-identities');need(all(db.execute('SELECT count(*) FROM '+prefix+'._logs').fetchone()[0]<=1000000 for prefix in('main','afterdb')),'bounded-log-row-count');n=len(names);idi=names.index('id');ci=names.index('created');li=names.index('level');query='SELECT '+','.join('a.'+q(x)for x in names)+','+','.join('b.'+q(x)for x in names)+' FROM _logs a LEFT JOIN afterdb._logs b ON a.id=b.id AND typeof(a.id)=typeof(b.id)'
  for row in db.execute(query):
   old,new=row[:n],row[n:]
   if new[idi]is not None:
    changes=[i for i in range(n)if L.cell(old[i])!=L.cell(new[i])];result['retainedTypedChanged'if changes else'retainedTypedIdentical']+=1
    for i in changes:result['retainedChangesByFixedField'][names[i]if names[i]in{'created','level','message','data'}else'other']+=1
    continue
   result['missing']+=1;created=stamp(old[ci]);result['missingInvalidCreated']+=int(created is None);result['missingLevelEligible']+=int(same and type(old[li])is int and old[li]<pa['minLevel'])
   if same and created is not None:result['missingDefinitelyAgeEligible'if created<=cutlo else'missingPossiblyAgeEligible'if created<=cuthi else'missingDefinitelyNotAgeEligible']+=1
  parsed=[]
  for(created,)in db.execute('SELECT b.created FROM afterdb._logs b LEFT JOIN _logs a ON a.id=b.id AND typeof(a.id)=typeof(b.id) WHERE a.id IS NULL'):
   result['newRows']+=1;result['newCreatedTypeCounts'][kind(created)]+=1;t=stamp(created)
   if t is None:result['newInvalidCreated']+=1;continue
   parsed.append(t);result['newBeforeClosedObservation'if t<lower else'newAfterObservation'if t>upper else'newWithinSupplementalSnapshotWindow']+=1
  if parsed:result['newEarliestUTC']=utc(min(parsed));result['newLatestUTC']=utc(max(parsed))
 audit=result['existingSealedAudit'];result['archivedAuditCountsReproduced']=all(result[k]==audit[k]for k in('retainedTypedIdentical','retainedTypedChanged','missing','newRows'));result['originalWindowOutsideRowCount']=audit['newRows']-audit['newRowsWithinRequestTime'];return result
def command(args):
 global SERIAL
 SERIAL+=1
 with(OUT/('%03d-readonly-command.stderr.private'%SERIAL)).open('xb')as error:p=subprocess.run(args,stdout=subprocess.PIPE,stderr=error,timeout=90,cwd=ROOT)
 need(p.returncode==0 and len(p.stdout)<=128*1024**2,'bounded-readonly-command');return p.stdout
def envmap(values):
 need(type(values)is list and all(type(v)is str and'='in v for v in values),'runtime-env-shape');result=dict(v.split('=',1)for v in values);need(len(result)==len(values),'unique-runtime-env');return result
def runtime_observation(backup,prepare):
 baseline=read(backup/'baseline.private.json');prepared=read(prepare/'prepared.private.json');ids=command(['docker','ps','-aq','--no-trunc']).decode().split();need(0<len(ids)<=1000 and len(ids)==len(set(ids))and all(re.fullmatch('[a-f0-9]{64}',x)for x in ids),'runtime-id-list');records=json.loads(command(['docker','inspect',*ids]));need(len(records)==len(ids),'runtime-inspect-list');others={};targets={}
 for r in records:
  cid=r['Id'];labels=r['Config'].get('Labels')or{};role=labels.get('com.docker.compose.service')if labels.get('com.docker.compose.project')=='rr-portal'else None;s=r['State'];row={'id':cid,'image':r['Image'],'started':s.get('StartedAt'),'running':s['Running'],'oom':s['OOMKilled'],'restarts':r['RestartCount'],'health':s.get('Health',{}).get('Status'),'environmentMapSHA256':sha(enc(envmap(r['Config']['Env']))),'mounts':sorted(r.get('Mounts',[]),key=enc),'memory':r['HostConfig'].get('Memory'),'swap':r['HostConfig'].get('MemorySwap'),'healthcheck':r['Config'].get('Healthcheck'),'command':r['Config'].get('Cmd'),'entrypoint':r['Config'].get('Entrypoint'),'user':r['Config'].get('User'),'workingDirectory':r['Config'].get('WorkingDir'),'configSHA256':sha(enc(dict(r['Config'],Env=sorted(r['Config']['Env'])))),'hostConfigSHA256':sha(enc(r['HostConfig']))}
  if role in SERVICES:need(role not in targets,'one-current-service');targets[role]=r
  else:need(cid not in others,'unique-current-others');others[cid]=row
 need(set(targets)==set(SERVICES),'two-current-factory-services');result={'allOther44ContainersUnchanged':others==baseline['runtime']['others'],'otherContainerCount':len(others),'maintenanceFlagsEqualBaseline':L.non_database_inventory(ROOT/'deploy/maintenance',[])==baseline['maintenanceInventory']};env=ROOT/'.env.cloud.production';st=env.stat();result['environmentBytesAndModeOwnerEqualBaseline']=not env.is_symlink()and L.file_hash(env)==baseline['environmentSHA256']and env.read_bytes()==(backup/'environment.private').read_bytes()and{'mode':stat.S_IMODE(st.st_mode),'uid':st.st_uid,'gid':st.st_gid}==baseline['environmentFileMetadata'];result['headEqualsTarget']=command(['git','rev-parse','HEAD']).decode().strip()==TARGET;result['treeEqualsTarget']=command(['git','rev-parse','HEAD^{tree}']).decode().strip()==TREE
 for service,r in targets.items():
  expected=prepared['proofs'][service]if service=='factory-review-test'else baseline['sourceProof'][service]['files'];blob=command(['docker','exec',r['Id'],'tar','-C','/pb','-cf','-','pb_hooks','pb_migrations','pb_public']);actual={};total=0
  with tarfile.open(fileobj=io.BytesIO(blob),mode='r:')as archive:
   for member in archive:
    name=member.name.rstrip('/');need(L.safe_path(name)and name.split('/')[0]in{'pb_hooks','pb_migrations','pb_public'}and(member.isfile()or member.isdir()),'safe-current-source-member')
    if member.isdir():continue
    total+=member.size;need(name not in actual and member.size<=16*1024**2 and total<=32*1024**2,'bounded-current-source-member');data=archive.extractfile(member).read();need(len(data)==member.size,'complete-current-source-file');actual[name]={'bytes':len(data),'sha256':sha(data)}
  proc=command(['docker','exec',r['Id'],'cat','/proc/1/environ']);need(proc.endswith(b'\0'),'pid1-env-format');pm=envmap([v.decode()for v in proc.split(b'\0')if v]);need(pm.pop('HOSTNAME',None)==r['Id'][:12],'automatic-current-hostname');result[service]={'healthy':r['State']['Running']is True and r['State']['OOMKilled']is False and r['State'].get('Health',{}).get('Status')=='healthy','expectedImage':r['Image']==(prepared['images'][service]if service=='factory-review-test'else baseline['runtime']['targets'][service]['image']),'expectedSourceFiles':actual==expected,'literalConfiguredEnvironmentPreserved':envmap(r['Config']['Env'])==read(backup/(service+'-literal-configured-environment.private.json')),'literalPID1EnvironmentPreserved':pm==read(backup/(service+'-literal-process-environment.private.json'))}
 return result
def main():
 global L
 need(PIN and sys.argv[1:]==['diagnose']and os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_ATTEMPT')=='1','false-draft-or-wrong-invocation');os.umask(0o077);L=load();OUT.mkdir(mode=0o700);signal.signal(signal.SIGTERM,lambda *_:need(False,'terminated'));result={'mode':'diagnose','base':BASE,'target':TARGET,'tree':TREE,'success':False,'databaseWritesOrRestorePerformed':False,'configurationChanged':False,'containerSignalsOrDeploymentPerformed':False,'originalArchivesModified':False,'rawLogsOrSecretsPrinted':False}
 try:
  paths={mode:archive(mode)[0]for mode in ARCHIVES};result['logComparisons']={s:log_comparison(paths['deploy'],s)for s in SERVICES};result['currentRuntime']=runtime_observation(paths['backup'],paths['prepare']);need(all(archive(mode)[0]==p for mode,p in paths.items()),'original-seals-revalidated');result.update(success=True,allOriginalArchiveBytesRevalidated=True,archivedSQLiteReadOnlyImmutable=True)
 except BaseException as error:result.update(failedStage=STAGE,safeExceptionType=type(error).__name__);L.private_write(OUT/'failure.private.txt',traceback.format_exc().encode())
 finally:
  L.private_write(OUT/'first-result.json',enc(result));L.seal(OUT);print(enc(dict(result,manifestSHA256=L.file_hash(OUT/'manifest.json'),resultSHA256=L.file_hash(OUT/'first-result.json'))).decode(),flush=True)
 return 0 if result['success']else 1
if __name__=='__main__':
 try:sys.exit(main())
 except SystemExit:raise
 except BaseException:print('{"success":false,"safeFailure":"PR986_DIAGNOSE_PREFLIGHT_REJECTED"}',flush=True);sys.exit(1)
