"""Fixed, read-only map guard diagnosis. No source/config/business writes or HTTP."""
import importlib.util,json,os,pathlib,re,stat,sys,tarfile
PIN=True
RELEASE_SHA='745116737634ab74083561c02b8aea9a1f1106276d06aecf9372cfce8110219a'
FAILED_MANIFEST='d3f3f11636e58ee719bfda2e468f6b74b3258ed6b940afe3b919b14133ae3ea8'
FAILED_RESULT='9a9bcbe5d5571b7d9893240f090115a125f0b0b9be7a0149d78a02fd6324603c'
BRANCH='refs/heads/ops/batch-961-965-20261020'
OUT=pathlib.Path('/opt/rr-portal/deploy/backups/batch-961-965-20261020-map-diagnosis-01')
R=None;STAGE='entrypoint'
def need(value):
 if not value:raise RuntimeError('MAP_DIAGNOSIS_REJECTED')
def load():
 path=pathlib.Path(__file__).with_name('batch-961-965-release.py');need(path.is_file()and not path.is_symlink());import hashlib;need(hashlib.sha256(path.read_bytes()).hexdigest()==RELEASE_SHA);spec=importlib.util.spec_from_file_location('fixed_release_diagnosis',path);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module

def archived_maps(before):
 rows={row['path']:row for row in before['storage']['zuru-data']['files']};path=R.BACKUP/'zuru-data/files.tar';result={};pinned=path.stat()
 with tarfile.open(path,'r:')as archive:
  for name in R.MAPPING_PINS:
   row=rows.get(name);item={'present':row is not None,'inventory':row};members=[entry for entry in archive.getmembers()if entry.name==name]
   if row is None:need(not members)
   else:
    need(row.get('directory')is False and len(members)==1 and members[0].isfile()and 0<members[0].size<=4*1024**2 and members[0].size==row['bytes']);content=archive.extractfile(members[0]).read();need(R.sha(content)==row['sha256']);value=json.loads(content);need(type(value)in{dict,list});item.update(canonicalJSONSHA256=R.sha(R.enc(value)),entries=len(value),kind='object'if type(value)is dict else'array')
   result[name]=item
 now=path.stat();need((pinned.st_dev,pinned.st_ino,pinned.st_size,pinned.st_mtime_ns,pinned.st_ctime_ns)==(now.st_dev,now.st_ino,now.st_size,now.st_mtime_ns,now.st_ctime_ns));return result

def live_maps():
 result={};root=R.ROOT/R.CORE.ZURU/'data'
 for name in R.MAPPING_PINS:
  path=root/name;exists=path.exists()or path.is_symlink();ancestorSymlink=any(parent.is_symlink()for parent in(path.parent,*path.parent.parents)if parent==R.ROOT or R.ROOT in parent.parents);row={'present':exists,'symlink':path.is_symlink(),'ancestorSymlink':ancestorSymlink}
  if exists:
   info=path.lstat();row.update(regular=stat.S_ISREG(info.st_mode),mode=stat.S_IMODE(info.st_mode),bytes=info.st_size)
   if row['regular']and not row['symlink']and not ancestorSymlink:
    content=R.CORE.stable_environment_bytes(path);row['sha256']=R.sha(content)
    try:value=json.loads(content);need(type(value)in{dict,list});row.update(canonicalJSONSHA256=R.sha(R.enc(value)),entries=len(value),kind='object'if type(value)is dict else'array')
    except(ValueError,RuntimeError):row['validMappingJSON']=False
  result[name]=row
 return result

def failed_archive():
 path=R.DEPLOY;L=R.CORE.OPS.L;need(path.is_dir()and not path.is_symlink()and stat.S_IMODE(path.stat().st_mode)==0o700 and L.file_hash(path/'manifest.json')==FAILED_MANIFEST and L.file_hash(path/'first-result.json')==FAILED_RESULT);manifest=json.loads((path/'manifest.json').read_bytes());entries=list(path.rglob('*'));need(len(entries)<=100000 and all(not p.is_symlink()and(p.is_file()or p.is_dir())and p.stat().st_mode&0o077==0 for p in entries));need(set(manifest)=={str(p.relative_to(path))for p in entries if p.is_file()and p!=path/'manifest.json'});need(all(L.safe_path(n)and re.fullmatch('[a-f0-9]{64}',h)and L.file_hash(path/n)==h for n,h in manifest.items()));receipt=json.loads((path/'first-result.json').read_bytes());need(receipt.get('success')is False and receipt.get('failedStage')=='exact-runtime-mapping-preflight'and receipt.get('target')==R.TARGET);return True

def unchanged(before):
 core=R.CORE;runtime,_=core.runtime();head=core.run(['git','rev-parse','HEAD']).decode().strip();need(re.fullmatch('[a-f0-9]{40}',head));dirty=False
 try:dirty=core.dirty_snapshot()==before['preexistingFourDirty']
 except BaseException:pass
 flags=core.maintenance_inventory();return {'head':head,'headStillBase':head==R.BASE,'allTargetAndOtherRuntimeConfigurationUnchanged':runtime==before['runtime'],'environmentBytesUnchanged':R.sha(core.stable_environment_bytes(R.ROOT/'.env.cloud.production'))==before['environmentSHA256'],'preexistingFourDirtyExactlyUnchanged':dirty,'allMaintenanceFlagsUnchanged':flags==before['maintenanceInventory']}

def main():
 global R,STAGE
 need(len(sys.argv)==2 and sys.argv[1]=='diagnose'and PIN and os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_ATTEMPT')=='1');os.umask(0o077);OUT.mkdir(mode=0o700);R=load();R.OUT=OUT;R.CORE=R.core_load();core=R.CORE;core.OUT=OUT;core.OPS=core.load('release-data-ops-library.py');core.OPS.L=core.OPS.load_library(pathlib.Path(__file__).with_name('release-data-library.py'));result={'mode':'map-diagnosis','success':False,'businessOrSourceWritesPerformed':False,'fileModesChanged':False,'containersOrServicesSignalled':False,'maintenanceOrStandardWorkflowChanged':False,'liveHTTPOrLoginRequestsPerformed':False,'mappingValuesOrSecretsPrinted':False}
 try:
  STAGE='validate-sealed-backup';before=R.original();STAGE='validate-sealed-failed-release';result['failedReleaseArchiveRetainedAndValid']=failed_archive();STAGE='before-unchanged-observations';result['beforeReadOnlyObservations']=unchanged(before);STAGE='three-mapping-metadata-only';result['baselineMaps']=archived_maps(before);result['currentMaps']=live_maps();STAGE='readonly-index-tags';prefix=core.ZURU+'/data/';paths=[prefix+name for name in R.MAPPING_PINS];output=core.run(['git','ls-files','-t','-v','-z','--',*paths]);tags={}
  for row in output.decode().strip('\0').split('\0')if output else[]:
   need(len(row)>=3 and row[1]==' 'and row[2:]in paths and row[2:]not in tags);tags[row[2:]]=row[0]
  result['indexTags']={name:tags.get(prefix+name)for name in R.MAPPING_PINS};STAGE='after-unchanged-observations';result['afterReadOnlyObservations']=unchanged(before);result['observationsStableDuringDiagnosis']=result['beforeReadOnlyObservations']==result['afterReadOnlyObservations'];result['success']=True
 except BaseException:result['failedStage']=STAGE
 finally:core.OPS.L.private_write(OUT/'first-result.json',R.enc(result));core.OPS.L.seal(OUT);print(R.enc(dict(result,manifestSHA256=core.OPS.L.file_hash(OUT/'manifest.json'),resultSHA256=core.OPS.L.file_hash(OUT/'first-result.json'))).decode(),flush=True)
 return 0 if result['success']else 1
if __name__=='__main__':
 try:code=main()
 except BaseException:print('{"success":false,"safeFailure":"MAP_DIAGNOSIS_PREFLIGHT_FAILED"}',flush=True);code=1
 sys.exit(code)
