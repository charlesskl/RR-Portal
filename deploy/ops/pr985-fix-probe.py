"""Two fixed synthetic checks of reviewed PR985 in disposable containers only.
No merge, checkout, production configuration update or business container signals.
"""
import pathlib,importlib.util,os,json,hashlib,sys,signal
PIN=True
LIB_SHA='9ef765feed81c42d33a35017081935fc688ef42a1a8ab5096e2a167a791ed4c1'
OUT=pathlib.Path('/opt/rr-portal/deploy/backups/pr-985-20261021-reviewed-prompt-probe')
PREPARE_MANIFEST='08da1118751fd62d4c72c2136d9810b6c2ef2b2428bc038d0f2227557f76ede3'
PREPARE_RESULT='a4c647ada6d3e241819fc1e5237fa85b41f0ec7bc24f9ac4c53963160427a2b4'
HEAD='e51be877ff1f40d9053e1801fe8c2934dead0010'
def main():
 assert PIN and sys.argv[1:]==['verify']and os.environ.get('RELEASE_BRANCH')=='refs/heads/ops/pr-981-20261021'and os.environ.get('RELEASE_ATTEMPT')=='1'
 p=pathlib.Path(__file__).with_name('pr981-release-library.py');assert p.is_file()and not p.is_symlink()and hashlib.sha256(p.read_bytes()).hexdigest()==LIB_SHA
 spec=importlib.util.spec_from_file_location('pr985_reviewed_probe_lib',p);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);assert m.PHASE==''and m.TARGET==''and m.TREE==''
 os.umask(0o077);OUT.mkdir(mode=0o700);m.OUT=OUT;m.TARGET='67385924fc40958701843411b3731d2eeb90b2ad';m.TREE='f0a724fb72b06e9cea3dc5aa1baa8bed629f127d';m.F=m.load('factory-review-backup-library.py');m.F.BASE=m.BASE;m.F.OUT=OUT;m.F.OPS=m.F.load('release-data-ops-library.py');m.F.OPS.L=m.F.OPS.load_library(pathlib.Path(__file__).with_name('release-data-library.py'));m.F.OPS.run=m.F.run
 def terminated(*_):m.need(False,'terminated')
 signal.signal(signal.SIGTERM,terminated)
 result={'mode':'verify','success':False,'reviewedFixHead':HEAD,'productionChangesPerformed':False,'businessWritesPerformed':False,'databaseRestorePerformed':False,'maximumFixedSyntheticCalls':2}
 b=None;runtime=None
 try:
  b=m.baseline();m.sealed(m.PREPARE,PREPARE_MANIFEST,PREPARE_RESULT);prepared=m.read(m.PREPARE/'prepared.private.json');m.need(prepared['target']==m.TARGET and prepared['tree']==m.TREE,'sealed-original-candidate');runtime,raw=m.F.runtime();m.need(runtime==b['runtime']and m.flags()==b['maintenanceInventory'],'original-runtime-before-fixed-probe');m.source(b,m.TARGET);m.need((m.ROOT/'.env.cloud.production').read_bytes()==(m.BACKUP/'environment.private').read_bytes()and m.F.file_metadata(m.ROOT/'.env.cloud.production')==b['environmentFileMetadata'],'production-env-untouched');literal=m.read(m.PREPARE/'intended-environments.private.json');m.need(literal==m.intended(),'existing-company-config-stable');candidate=pathlib.Path(__file__).with_name('pr985-analysis-ai.js');m.need(candidate.is_file()and not candidate.is_symlink()and m.sha(candidate.read_bytes())=='d1ea85714e5d21b23de3ae2476c4cb8cea041686d6a518d238fc1bf3f2f0031f','exact-independently-reviewed-fix')
  for sequence in(1,2):m.model_probe(prepared['images']['factory-review'],literal,raw['factory-review'],result,candidate,sequence)
  result.update(success=True,twoIndependentSyntheticChecksPassed=True)
 except BaseException:result.update(success=False,failedStage=m.STAGE)
 finally:
  if runtime is not None:
   try:
    after,_=m.F.runtime();m.need(after==runtime and m.flags()==b['maintenanceInventory'],'all-containers-and-flags-unmodified');m.source(b,m.TARGET);m.need((m.ROOT/'.env.cloud.production').read_bytes()==(m.BACKUP/'environment.private').read_bytes()and m.F.file_metadata(m.ROOT/'.env.cloud.production')==b['environmentFileMetadata'],'environment-still-original');result.update(all46ContainersUnchanged=True,productionConfigurationChanged=False,readOnlyPostconditionsPassed=True)
   except BaseException:result.update(success=False,readOnlyPostconditionsPassed=False,postconditionFailureStage=m.STAGE)
  m.F.OPS.L.private_write(OUT/'first-result.json',m.enc(result));m.F.OPS.L.seal(OUT);print(m.enc(dict(result,manifestSHA256=m.F.OPS.L.file_hash(OUT/'manifest.json'),resultSHA256=m.F.OPS.L.file_hash(OUT/'first-result.json'))).decode(),flush=True)
 return 0 if result['success']else 1
if __name__=='__main__':
 try:sys.exit(main())
 except SystemExit:raise
 except BaseException:print('{"mode":"verify","success":false,"safeFailure":"PR985_FIXED_PROMPT_PROBE_REJECTED"}',flush=True);sys.exit(1)
