"""Fixed read-only diagnosis of a sealed failed backup; no database opens."""
import hashlib,importlib.util,json,os,pathlib,re,sys
PROBE_PIN=False
BRANCH='refs/heads/ops/batch-960-966-967-968-20261020'
CORE_SHA='c71c9515eb03a200353e581da44f3c43827c5d5b1515e443cda535ee84c55e3d'
ROOT=pathlib.Path('/opt/rr-portal')
FAILED=ROOT/'deploy/backups/batch-960-966-967-968-20261020-backup'
MANIFEST='116609c0821c61aa0289a3cd5e38b6b212094d308ccfeeb46978eda6ec6bf389'
RESULT='06289beea79f7a718f140ba23d76e061b2a9f2fa73fe2ac36d054f68d63544ee'
def sha(b):return hashlib.sha256(b).hexdigest()
def main():
 assert PROBE_PIN and sys.argv[1:]==['probe'] and os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_ATTEMPT')=='1'
 f=pathlib.Path(__file__).with_name('batch-backup-library.py');assert f.is_file() and not f.is_symlink() and sha(f.read_bytes())==CORE_SHA
 spec=importlib.util.spec_from_file_location('frozen_backup',f);c=importlib.util.module_from_spec(spec);spec.loader.exec_module(c);c.initialize()
 assert sha((FAILED/'manifest.json').read_bytes())==MANIFEST and sha((FAILED/'first-result.json').read_bytes())==RESULT
 manifest=json.loads((FAILED/'manifest.json').read_bytes())
 def verify():
  entries=list(FAILED.rglob('*'));assert len(entries)<=100000 and all(not p.is_symlink() and (p.is_file() or p.is_dir()) for p in entries)
  assert set(manifest)=={str(p.relative_to(FAILED)) for p in entries if p.is_file() and p!=FAILED/'manifest.json'}
  assert all(c.OPS.L.safe_path(n) and c.OPS.L.file_hash(FAILED/n)==h for n,h in manifest.items())
 verify()
 raw=json.loads((FAILED/'target-inspect.private.json').read_bytes());roots,_=c.storage_roots(raw)
 result={'mode':'backup-probe','success':True,'noDatabaseOpened':True,'noBusinessRowsOrSecretsPrinted':True,'noServiceOrConfigurationChanged':True,'failedStage':json.loads((FAILED/'first-result.json').read_bytes())['failedStage'],'stores':{}}
 for key,root in roots.items():
  dest=FAILED/key
  row={'captureDirectoryPresent':dest.is_dir(),'fileArchivePresent':(dest/'files.tar').is_file(),'copiedSQLiteCount':sum(p.is_file() for p in (dest/'sqlite').rglob('*')) if (dest/'sqlite').is_dir() else 0}
  try:
   names=c.OPS.database_names(root);row['databaseHeaderInventoryPassed']=True;row['databaseHeaderCount']=len(names)
   if key=='qc':row['allThirteenCompanyDatabaseHeadersPresent']={company+'/qc.db' for company in c.QC_COMPANIES}<=set(names)
   if key=='voyageplex-data':
    history=[]
    for name in names:
     if name=='voyageplex.db':continue
     p=root/name;history.append({'nameSHA256':sha(name.encode()),'matchesExpectedHistoryPattern':bool(re.fullmatch(r'voyageplex\.db\.before-(company|daily-mail|personal-mail)-[0-9]{14}-[a-f0-9]{32}\.db',name)),'bytes':p.stat().st_size,'companions':{suffix:{'exists':p.with_name(p.name+suffix).exists(),'bytes':p.with_name(p.name+suffix).stat().st_size if p.with_name(p.name+suffix).exists() else 0} for suffix in ('-wal','-shm','-journal')}})
    row['historyBundleCount']=len(history);row['historyBundles']=history[:12]
  except Exception as e:
   row['databaseHeaderInventoryPassed']=False;row['exceptionType']=type(e).__name__
   message=str(e)
   if re.fullmatch('[A-Za-z0-9_.-]{1,120}',message):row['safeCheckLabel']=message
  result['stores'][key]=row
 assert sha((FAILED/'manifest.json').read_bytes())==MANIFEST and sha((FAILED/'first-result.json').read_bytes())==RESULT
 verify();encoded=json.dumps(result,sort_keys=True,separators=(',',':'));assert len(encoded.encode())<24000
 print(encoded,flush=True)
if __name__=='__main__':
 try:main()
 except BaseException:print('{"success":false,"safeFailure":"BACKUP_FIXED_PROBE_REJECTED"}',flush=True);sys.exit(1)
