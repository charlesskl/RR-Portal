"""Sealed PR955 log-boundary evidence only; never changes the failed verification."""
import contextlib,hashlib,importlib.util,json,os,pathlib,re,signal,stat,sys
ROOT=pathlib.Path('/opt/rr-portal/deploy/backups');PIN=True;BRANCH='refs/heads/ops/factory-review-955-20261019';OUT=ROOT/'factory-review-955-20261019-log-boundary'
BASE='1f97b1b07aa501cfeeb043b99ad1156d73fbc6e0';TARGET='f32c9f00760e048a0846045a6d638290074b48d6'
ARCHIVES=(('backup','factory-review-955-20261019-backup','4028ae76bda73cd2b02387a7302168db724731ff424bb701340ef9d9fecdeeaf','8cf079af084abbfca94894b9f863cc6f6d9e33985cd9e900d2922edb9c5a21b5',True),('deploy','factory-review-955-20261019-deploy','15d350bc6a707a7c6203fc38614e35cd315f3bbf717c6ed4b9d7d50b243a244a','9aab1e59542eab3f20cb4b24d54eeb2cf8a603e736971f2f9ca792636b7bba64',True),('verify','factory-review-955-20261019-verify','237c360fdea0080d8b4362c9c3a52dbb1ca2d860d47d182ac9420235fa1bb79f','7861e0ed7c16bef72e9f13e4c3b91734bcd9a1ad45b0861c7cff5e0616047229',False))
RELEASE_SHA='22622775935eab87831e84b5dbc8dd007b18c3ec12ef9ecd9b30f1c7614d2a3b';R=None;STAGE='preflight'

def need(value):
 if not value:raise RuntimeError('PR955_SEALED_LOG_BOUNDARY_REJECTED')
def enc(value):return json.dumps(value,sort_keys=True,ensure_ascii=True,separators=(',',':'),allow_nan=False).encode()
def sha(value):return hashlib.sha256(value).hexdigest()
def load():
 path=pathlib.Path(__file__).with_name('factory-review-release-library.py');need(path.is_file()and not path.is_symlink()and sha(path.read_bytes())==RELEASE_SHA);spec=importlib.util.spec_from_file_location('reviewed955release',path);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);m.CORE=m.core_load();m.CORE.OPS=m.CORE.load('release-data-ops-library.py');m.CORE.OPS.L=m.CORE.OPS.load_library(pathlib.Path(__file__).with_name('release-data-library.py'));return m

def archive(item):
 mode,name,msha,rsha,success=item;path=ROOT/name;lib=R.CORE.OPS.L;need(path.is_dir()and not path.is_symlink()and stat.S_IMODE(path.stat().st_mode)==0o700 and lib.file_hash(path/'manifest.json')==msha and lib.file_hash(path/'first-result.json')==rsha);manifest=json.loads((path/'manifest.json').read_bytes());entries=list(path.rglob('*'));need(len(entries)<=50000 and all(not p.is_symlink()and(p.is_file()or p.is_dir())and p.stat().st_mode&0o077==0 for p in entries));need(set(manifest)=={str(p.relative_to(path))for p in entries if p.is_file()and p!=path/'manifest.json'});need(all(lib.safe_path(n)and type(h)is str and re.fullmatch('[a-f0-9]{64}',h)and lib.file_hash(path/n)==h for n,h in manifest.items()));receipt=json.loads((path/'first-result.json').read_bytes());need(receipt.get('mode')==mode and receipt.get('success')is success);return path,manifest,receipt

def inspect_boundary(old_aux,new_aux,old_data,new_data,started,expected):
 lib=R.CORE.OPS.L;summary=R.logs_retention(old_aux,new_aux,old_data,new_data,started);need(summary==expected and summary['retainedTypedChanged']==0 and summary['missing']-summary['missingCompatibleWithConfiguredRetention']==1 and summary['configuredPolicyAvailableAndUnchanged']is True);policies=[R.log_policy(p,started)for p in (old_data,new_data)];need(policies[0]is not None and policies[0]==policies[1]);policy=policies[0];boundary=[]
 with contextlib.closing(lib.connect(old_aux,True))as db:
  db.execute('ATTACH DATABASE ? AS afterdb',(new_aux.as_uri()+'?mode=ro&immutable=1',));columns=db.execute('PRAGMA table_xinfo(_logs)').fetchall();names=[c[1]for c in columns];need({'id','created','level'}<=set(names));q=lib.quote
  projection=','.join('a.'+q(n)for n in ('created','level'))+','+','.join('typeof(a.'+q(n)+')'for n in names);query='SELECT '+projection+' FROM _logs a LEFT JOIN afterdb._logs b ON a.id=b.id AND typeof(a.id)=typeof(b.id) WHERE b.id IS NULL';count=0
  for row in db.execute(query):
   count+=1;created,level=R.timestamp(row[0]),row[1];bydate=created is not None and created<=policy['cutoff'];bylevel=type(level)is int and level<policy['minLevel']
   if bydate or bylevel:continue
   types=row[2:];need(all(value in {'null','integer','real','text','blob'}for value in types));delta=(created-policy['cutoff']).total_seconds()if created is not None else None
   boundary.append({'columnStorageTypes':dict(zip(names,types)),'createdTimestampValid':created is not None,'levelStoredAsInteger':type(level)is int,'createdMinusDockerStartedAtRetentionCutoffSeconds':round(delta,6)if delta is not None else None,'createdAtOrBeforeDockerCutoff':bydate,'belowConfiguredMinimumLevel':bylevel,'minimumLaterCleanupExecutionOffsetSeconds':round(max(0,delta),6)if delta is not None else None})
  need(count==summary['missing']and len(boundary)==1)
 return {'settingsPolicyIdentical':True,'originalStrictClassificationReproducedExactly':True,'retainedTypedExactRecomputed':True,'originalRetentionCounts':summary,'boundaryExceptions':boundary,'dockerTimestampNormalizedToMicrosecondsNotExactHookTime':True}

def diagnose(result):
 global STAGE
 STAGE='fixed-three-sealed-archives';captures=[archive(item)for item in ARCHIVES];backup,deploy,failed=[v[2]for v in captures];need(backup.get('base')==BASE and backup.get('backupComplete')is True and deploy.get('target')==failed.get('target')==TARGET and deploy.get('onlyFactoryReviewAndTestRebuilt')is True and failed.get('deploymentVerified')is True and failed.get('requiresBusinessRowInvestigation')is False and failed['checks']['factory-reviewLogsRetainedRowsAndConfiguredRetentionCompatible']is False);need(failed.get('strictAllSnapshotFieldsIdentical')is False)
 oldpath,newpath=captures[0][0],captures[2][0];runtime=deploy['runtimeAfter'];need(set(runtime['targets'])=={'factory-review','factory-review-test'});started=runtime['targets']['factory-review']['started'];STAGE='sealed-formal-log-boundary';details=inspect_boundary(oldpath/'factory-review/sqlite/auxiliary.db',newpath/'factory-review/sqlite/auxiliary.db',oldpath/'factory-review/sqlite/data.db',newpath/'factory-review/sqlite/data.db',started,failed['logRetentionClassification']['factory-review'])
 STAGE='original-seals-unchanged';need([archive(item)[2]for item in ARCHIVES]==[v[2]for v in captures]);result.update(diagnosticComplete=True,success=True,originalVerificationSuccess=False,originalStrictAllSnapshotFieldsIdentical=False,oldVerificationReclassifiedAsSuccess=False,oldArchivesPreservedByteForByte=True,actualCleanupInvocationTimeObserved=False,actorIdentified=False,thresholdExtended=False,businessDatabaseSemanticAuditRepeated=False,liveDatabaseOrContainersAccessed=False,httpRequestsPerformed=False,details=details,sourceMechanism={'officialVersion':'0.39.6','onSettingsReload':'https://github.com/pocketbase/pocketbase/blob/v0.39.6/core/base.go#L1510','periodicCleanup':'https://github.com/pocketbase/pocketbase/blob/v0.39.6/core/base.go#L1535','deleteSQL':'https://github.com/pocketbase/pocketbase/blob/v0.39.6/core/log_query.go#L58','reloadUsesCleanupExecutionNowNotDockerStartedAt':True,'actualInvocationTimeNotProvenByThisProbe':True})

def main():
 global R,STAGE
 need(len(sys.argv)==2 and sys.argv[1]=='log-boundary'and PIN and os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_ATTEMPT')=='1');os.umask(0o077);signal.signal(signal.SIGALRM,lambda *_:need(False));signal.signal(signal.SIGTERM,lambda *_:need(False));signal.alarm(150);OUT.mkdir(mode=0o700);R=load();result={'mode':'log-boundary','success':False,'diagnosticComplete':False,'target':TARGET,'businessOrConfigurationWritesPerformed':False,'oldArtifactsWritten':False,'secretOrLogValuesPrinted':False}
 try:diagnose(result)
 except BaseException:result['failedStage']=STAGE
 finally:
  R.CORE.OPS.L.private_write(OUT/'first-result.json',enc(result));R.CORE.OPS.L.seal(OUT);print(enc(dict(result,resultSHA256=R.CORE.OPS.L.file_hash(OUT/'first-result.json'),manifestSHA256=R.CORE.OPS.L.file_hash(OUT/'manifest.json'))).decode(),flush=True)
 return 0 if result['success']else 1
if __name__=='__main__':
 try:exit_code=main()
 except BaseException:print('{"success":false,"safeFailure":"PR955_LOG_BOUNDARY_PREFLIGHT_FAILED"}',flush=True);exit_code=1
 sys.exit(exit_code)
