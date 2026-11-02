"""INERT new explicit attempt after successful read-only reconciliation. One public copy only."""
import hashlib,importlib.util,json,os,pathlib,sys

EXECUTE=False
ROOT=pathlib.Path('/opt/rr-portal')
OUT=ROOT/'deploy/backups/pr1054-reclaim1053-public-2-20261102'
READONLY=ROOT/'deploy/backups/pr1054-capacity-reconcile-1-20261102'
BRANCH='refs/heads/codex/ops-pr1054-20261102'
READONLY_SHA='9993a9c43f553441a539703d213a3e0a9b87ea738df465c6ff048c6ebe8d304d'
SOURCE_TREE_SHA='bb2c0a778cf86ff08420fd37906549dce0cf5c36c2e76b3262358a7aade78917'
N_SHA='f3fff53e187f31094a6ada6b24c58ff4bfda16dc946251c12f7aa832c62bbbb9'
FLOOR=1024**3
FREE_FLOOR=8*1024**3
RELEASE_BUDGET=36*1024**2
PROOF_BUDGET=1024**2
N=None
D=None
R=None
STAGE='entry'

def enc(value):return json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=True,allow_nan=False).encode()
def sha(raw):return hashlib.sha256(raw).hexdigest()
def need(value,label):
 global STAGE
 STAGE=label
 if not value:raise RuntimeError(label)
def load():
 global N,D,R
 path=pathlib.Path(__file__).with_name('pr1054-capacity-reconcile.py')
 need(path.is_file()and not path.is_symlink()and sha(path.read_bytes())==N_SHA,'exact-reviewed-readonly-reconciliation-code')
 spec=importlib.util.spec_from_file_location('second_reclaim_readonly_proof',path);N=importlib.util.module_from_spec(spec);spec.loader.exec_module(N);N.load();D=N.D;R=N.R
 D.OUT=OUT;R.OUT=OUT
def preserved_readonly():
 raw=R.read_json_body(READONLY/'result.private.json');need(sha(raw)==READONLY_SHA,'exact-successful-readonly-reconciliation-result');v=json.loads(raw);c=dict(v);own=c.pop('resultSHA256',None)
 need(own==sha(enc(c))and v['success']is True and v['phase']=='diagnose'and v['readOnly']is True and v['reclaimOrRetryAttempted']is False,'successful-readonly-observation-no-reclaim')
 need(v['all46OriginalRuntimeUnchanged']and v['all465OriginalLiveStaticAndBackendUnchanged']and v['originalFailedEvidenceUnchanged']and v['originalPreflightEvidenceUnchanged']and v['originalSourceCopyIntact'],'all-previous-proofs-successful-and-source-intact')
 return v,R.tree(READONLY,True)
def old_proofs():
 values,plan=R.receipts();failed=N.failed_status();preflight,pref=N.preflight_status();return values,plan,failed,preflight,pref
def ordinary_projection(space,allocated):
 # This exception permits freeing this exact owned public copy while below the old floor.
 # It never reduces the floors that apply after reclaim or to the later release.
 need(type(allocated)is int and allocated>0,'positive-measured-allocated-source-copy-bytes')
 projected_available=space['available']+allocated-PROOF_BUDGET
 projected_free=space['free']+allocated-PROOF_BUDGET
 need(projected_available>=FLOOR+RELEASE_BUDGET and projected_free>=FREE_FLOOR+RELEASE_BUDGET,'specific-copy-reclaim-must-restore-original-floors-plus36mib-release-and-small-proof')
 return {'availableBefore':space['available'],'freeBefore':space['free'],'sourceAllocatedBytesEstimate':allocated,
  'additionalProofBudget':PROOF_BUDGET,'ordinaryAvailableFloor':FLOOR,'physicalFreeFloor':FREE_FLOOR,'laterReleaseBudget':RELEASE_BUDGET,
  'projectedAvailableAfterProof':projected_available,'projectedFreeAfterProof':projected_free,
  'projectionIsNotReservationOrGuaranteedReclaim':True,'laterReleaseFloorsUnchanged':True}
def final_floors(space):
 need(space['available']>=FLOOR+RELEASE_BUDGET and space['free']>=FREE_FLOOR+RELEASE_BUDGET,'actual-reclaimed-capacity-preserves-original-floors-plus36mib-later-release')
def main():
 need(EXECUTE is True and len(READONLY_SHA)==64 and all(c in'0123456789abcdef'for c in READONLY_SHA)and sys.argv[1:]==['maintain']and os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_MODE')=='maintain'and os.environ.get('RELEASE_ATTEMPT')=='1','inert-new-explicit-second-public-copy-attempt-only')
 need(OUT==ROOT/'deploy/backups/pr1054-reclaim1053-public-2-20261102'and READONLY==ROOT/'deploy/backups/pr1054-capacity-reconcile-1-20261102','fixed-second-attempt-and-successful-readonly-paths-only')
 os.umask(0o077);need(OUT.parent.is_dir()and not any(p.is_symlink()for p in(OUT.parent,*OUT.parent.parents))and not OUT.exists(),'fresh-second-attempt-private-archive-no-replay')
 OUT.mkdir(mode=0o700);load();parent=R.directory(OUT.parent)
 try:os.fsync(parent)
 finally:os.close(parent)
 result={'phase':'maintain','attempt':2,'success':False,'explicitNewAttemptAfterReadOnly':True,'automaticRetryPerformed':False,
  'businessDataWrites':False,'liveServiceWrites':False,'originalConfigurationWrites':False,'imageOrCacheCleanupPerformed':False}
 try:
  first=D.capacity();D.private('capacity-at-entry.private.json',first);need(first['available']>=PROOF_BUDGET and first['free']>=PROOF_BUDGET,'small-second-attempt-evidence-writable')
  observed,observation_tree=preserved_readonly();values,plan,failed,preflight,pref=old_proofs();source=N.source_status(plan)
  recorded=json.loads(R.read_json_body(READONLY/'source-copy-proof.private.json'))
  need(source==recorded and source['fullTreeSHA256']==observed['sourceSummary']['fullTreeSHA256']==SOURCE_TREE_SHA,'entire-sixty-file-source-cas-equals-successful-readonly-observation')
  saved_guard=json.loads(R.read_json_body(READONLY/'protected-after.private.json'));before=N.guarded(values,plan)
  need(before==saved_guard and before['runtime']==preflight['allRuntime'],'all-original-protection-still-exact-successful-reconciliation-and-preflight')
  public=D.command(['git','-c','core.hooksPath=/dev/null','show',R.BUNDLE_REF],limit=64*1024**2)
  need(len(public)==R.BUNDLE_BYTES and sha(public)==R.BUNDLE_SHA,'retained-reviewed-public-rebuild-bundle-exact');del public
  projection=ordinary_projection(D.capacity(),source['allocatedBytesEstimate'])
  D.private('new-explicit-attempt-plan.private.json',{'attempt':2,'oldFailedRun':'41408131973','readOnlyResultRawSHA256':READONLY_SHA,'source':source,'projection':projection,'publicRebuildRef':R.BUNDLE_REF,'publicRebuildSHA256':R.BUNDLE_SHA,'deletionScope':'only the exact sixty single-link public source files and their two own directories'})
  D.private('protected-before.private.json',before);D.private('original-failed-and-preflight.private.json',{'failed':failed,'preflight':pref})
  need((values,plan,failed,preflight,pref)==old_proofs()and(observed,observation_tree)==preserved_readonly()and source==N.source_status(plan)and before==N.guarded(values,plan),'all-proof-and-source-cas-still-exact-before-new-intent')
  last_projection=ordinary_projection(D.capacity(),source['allocatedBytesEstimate']);D.private('capacity-immediately-before-intent.private.json',last_projection)
  R.reclaim(R.SOURCE,source['rows'])
  need(not R.SOURCE.exists()and not R.SOURCE.is_symlink()and not(OUT/R.TOMB).exists(),'only-selected-public-copy-and-own-second-tombstone-removed')
  siblings={p.name:{**D.record(p,1024**2),**R.stamp(p.lstat())}for p in R.SOURCE.parent.iterdir()}
  need(siblings==source['siblings'],'all-other-original-public-context-files-unchanged')
  after=N.guarded(values,plan);need(before==after,'all465-live-static-backend46-runtime-host-auth-two-canonicals-exact-after-explicit-second-attempt')
  need((values,plan,failed,preflight,pref)==old_proofs()and(observed,observation_tree)==preserved_readonly(),'all1053-and1054-original-proof-archives-preserved-after-reclaim')
  D.private('protected-after.private.json',after);space=D.capacity();final_floors(space)
  R.checkpoint('40-complete',state='only-public-copy-reclaimed-original-floors-and36mib-release-budget-verified')
  result.update(success=True,filesRemoved=60,logicalBytesRemoved=R.PUBLIC_BYTES,sourceAllocatedBytesEstimate=source['allocatedBytesEstimate'],capacityBefore=first,capacityAfter=space,
   availableDeltaObserved=space['available']-first['available'],allProtectedStateExact=True,laterReleaseBudgetPreserved=RELEASE_BUDGET,readOnlyReceiptPreserved=True,publicRebuildArtifactRetained=True,disposition=dict(R.DISPOSITION))
 except Exception as error:
  result.update(errorType=type(error).__name__,stage=STAGE,proofLibraryStage=getattr(R,'STAGE',None),readOnlyLibraryStage=getattr(N,'STAGE',None),capacityAfterFailure=D.capacity(),disposition=dict(R.DISPOSITION))
  try:D.private('failure-disposition.private.json',R.DISPOSITION)
  except Exception:pass
 result['resultSHA256']=sha(enc(result));D.private('result.private.json',result);D.wire(result);return 0 if result['success']else 1
if __name__=='__main__':sys.exit(main())
