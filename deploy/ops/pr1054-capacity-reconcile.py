"""INERT read-only capacity/reclaim reconciliation. Never call a reclaim/lifecycle function."""
import datetime,hashlib,importlib.util,json,os,pathlib,stat,sys

EXECUTE=True
ROOT=pathlib.Path('/opt/rr-portal')
OUT=ROOT/'deploy/backups/pr1054-capacity-reconcile-1-20261102'
FAILED=ROOT/'deploy/backups/pr1054-reclaim1053-public-1-20261102'
PREFLIGHT=ROOT/'deploy/backups/pr1054-preflight-1-20261102'
BRANCH='refs/heads/codex/ops-pr1054-20261102'
FAILED_SHA='08e929a159f81356118d3c53a4582f927e73c608baca66db0d6e6210d72ed084'
FAILED_SEAL='207a39156280463ea06b154a2c12ada0d1fb36a3814f8a01151d681ff26bcfb1'
PREFLIGHT_SHA='6cddaecf34f94f89a0e1219dcbeb7dd45aaa67cbd64e8c72562bcd49acd5d47b'
D_SHA='ee2e6c388cc5f72a08c7a31824a5677f44089f39d592c7892a22c773c2cec171'
R_SHA='61e29ae99349f1b69b597bf2696c2e7c2d3fd70abf915e3b569e524f12fd43fa'
FLOOR=1024**3
FREE_FLOOR=8*1024**3
OLD_RESERVE=8*1024**2
DIAG_BUDGET=2*1024**2
D=None
R=None
STAGE='entry'

def enc(value):return json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=True,allow_nan=False).encode()
def sha(raw):return hashlib.sha256(raw).hexdigest()
def need(value,label):
 global STAGE
 STAGE=label
 if not value:raise RuntimeError(label)
def capacity():
 fs=os.statvfs('/var/lib/docker');now=datetime.datetime.now(datetime.timezone.utc).isoformat()
 return {'observedUtc':now,'blockSize':fs.f_bsize,'fragmentSize':fs.f_frsize,'blocks':fs.f_blocks,'blocksFree':fs.f_bfree,
         'blocksAvailable':fs.f_bavail,'total':fs.f_blocks*fs.f_frsize,'available':fs.f_bavail*fs.f_frsize,
         'free':fs.f_bfree*fs.f_frsize,'freeMinusAvailable':(fs.f_bfree-fs.f_bavail)*fs.f_frsize,
         'inodes':fs.f_files,'inodesFree':fs.f_ffree,'inodesAvailable':fs.f_favail}
def margins(current,previous,allocated):
 a=current['available'];f=current['free'];projected=a+allocated-DIAG_BUDGET
 return {'comparisonPreflightAvailable':previous['available'],'comparisonPreflightFree':previous['free'],
  'availableDeltaSincePreflight':a-previous['available'],'freeDeltaSincePreflight':f-previous['free'],
  'availableAboveOriginalFloor':a-FLOOR,'freeAboveOriginalFloor':f-FREE_FLOOR,
  'oldReclaimAvailableThreshold':FLOOR+OLD_RESERVE,'oldReclaimFreeThreshold':FREE_FLOOR+OLD_RESERVE,
  'availableAboveOldReclaimThreshold':a-FLOOR-OLD_RESERVE,'freeAboveOldReclaimThreshold':f-FREE_FLOOR-OLD_RESERVE,
  'oldGuardWouldPassAtThisObservation':a>=FLOOR+OLD_RESERVE and f>=FREE_FLOOR+OLD_RESERVE,
  'sourceAllocatedBytesEstimate':allocated,'afterSourceOnlyReclaimLessDiagnosticBudgetProjectedAvailable':projected,
  'projectedAboveOriginalFloor':projected-FLOOR,'projectedAboveOldReclaimThreshold':projected-FLOOR-OLD_RESERVE,
  'projectionIsNotAReservationOrGuaranteedSpace':True,
  'previousFailedGuardDidNotRecordItsCapacity':True,
  'causeLimit':'Current statvfs confirms current margins only; failed-attempt exact capacities were not recorded. No attribution to a particular writer.'}
def module(name,filename,digest):
 p=pathlib.Path(__file__).with_name(filename)
 need(p.is_file()and not p.is_symlink()and sha(p.read_bytes())==digest,'exact-reviewed-readonly-library-'+name)
 spec=importlib.util.spec_from_file_location(name,p);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
def load():
 global D,R
 D=module('capacity_preflight','pr1054-preflight.py',D_SHA);R=module('capacity_reclaim_proof','pr1054-reclaim1053-public.py',R_SHA)
 D.OUT=OUT;R.D=D
def sealed(path,digest):
 raw=R.read_json_body(path);need(sha(raw)==digest,'exact-original-result-raw-sha');v=json.loads(raw);c=dict(v);own=c.pop('resultSHA256',None)
 need(own==sha(enc(c)),'original-result-inner-seal');return v
def failed_status():
 need(FAILED.is_dir()and not any(p.is_symlink()for p in(FAILED,*FAILED.parents)),'real-original-failed-attempt-directory')
 names={p.name for p in FAILED.iterdir()};need(names=={'result.private.json','failure-disposition.private.json'},'only-two-expected-prerename-failure-evidence-files-no-plan-or-tombstone')
 result=sealed(FAILED/'result.private.json',FAILED_SHA)
 need(result['resultSHA256']==FAILED_SEAL and result['success']is False and result['phase']=='maintain'and result['stage']=='original-capacity-floors-plus-bounded-reclaim-evidence','exact-first-prerename-capacity-failure')
 disposition=json.loads(R.read_json_body(FAILED/'failure-disposition.private.json'))
 expected={'state':'not-started','renameAttempted':False,'renameObserved':False,'renameAcknowledged':False,'deletionAttempted':False,
  'fileUnlinksObserved':0,'fileUnlinksAcknowledged':0,'automaticRetryOrRollbackPerformed':False,'safeNextAction':'read-only-reconcile-no-mutation-retry'}
 need(result['disposition']==disposition==expected,'first-attempt-no-intent-no-rename-no-unlinks-exact')
 rows=R.tree(FAILED,True);need(all(r['mode']==0o600 for r in rows.values()if r['type']=='file'),'failed-evidence-still-private')
 return {'disposition':disposition,'resultRawSHA256':FAILED_SHA,'resultInnerSeal':FAILED_SEAL,'files':rows,'fullTreeSHA256':sha(enc(rows)),'unknownOrMutatingArtifacts':False}
def preflight_status():
 result=sealed(PREFLIGHT/'result.private.json',PREFLIGHT_SHA)
 need(result['success']is True and result['phase']=='diagnose'and result['readOnly']is True and result['source']['revision']==D.SOURCE,'same-successful-original-readonly-preflight')
 rows=R.tree(PREFLIGHT,True)
 return result,{'resultRawSHA256':PREFLIGHT_SHA,'resultInnerSeal':result['resultSHA256'],'files':rows,'fullTreeSHA256':sha(enc(rows)),'capacity':result['capacity']}
def source_status(plan):
 rows=R.tree(R.SOURCE,True);R.source_check(rows,plan['newStatic'])
 need(R.SOURCE.parent.stat().st_dev==pathlib.Path('/var/lib/docker').stat().st_dev,'source-on-current-budget-filesystem')
 siblings={p.name:{**D.record(p,1024**2),**R.stamp(p.lstat())}for p in R.SOURCE.parent.iterdir()if p.name!=R.SOURCE.name}
 need(set(siblings)=={'Dockerfile','new-schema.sql'},'original-public-context-siblings-only')
 return {'source':str(R.SOURCE),'exists':True,'files':60,'logicalBytes':R.PUBLIC_BYTES,'allocatedBytesEstimate':sum(r['allocatedBytes']for r in rows.values()),
  'allSixtyHashesOwnersModesSingleLinksExact':True,'fullTreeSHA256':sha(enc(rows)),'rows':rows,'siblings':siblings,
  'candidateIsOnlyCompletedRebuildablePublicCopy':True,'noOtherCleanupCandidatesInspectedOrAuthorized':True}
def guarded(values,plan):
 # No data_inventory, sources, dependencies, requests, new lock/session, or reclaim.
 return R.protection(values,plan)
def main():
 need(EXECUTE is True and sys.argv[1:]==['diagnose']and os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_MODE')=='diagnose'and os.environ.get('RELEASE_ATTEMPT')=='1','inert-new-readonly-capacity-reconciliation')
 first=capacity();need(first['available']>=DIAG_BUDGET and first['free']>=DIAG_BUDGET,'tiny-bounded-readonly-evidence-writable-no-original-floor-precondition')
 os.umask(0o077);need(OUT.parent.is_dir()and not any(p.is_symlink()for p in(OUT.parent,*OUT.parent.parents))and not OUT.exists(),'fresh-private-readonly-reconcile-archive');OUT.mkdir(mode=0o700);load()
 value={'phase':'diagnose','success':False,'readOnly':True,'businessDataWrites':False,'liveServiceWrites':False,'configurationWrites':False,
        'reclaimOrRetryAttempted':False,'lifecycleWrites':False,'capacityAtEntry':first,'priorFailedRun':'41408131973'}
 try:
  D.private('capacity-at-entry.private.json',first);values,plan=R.receipts();failed=failed_status();preflight,pref=preflight_status();source=source_status(plan)
  before=guarded(values,plan);need(before['runtime']==preflight['allRuntime'],'all46-runtime-still-equal-original1054-preflight')
  need(before['host']==preflight['host']and before['auth']==preflight['gatewayAuth']and before['engineeringCanonical']==preflight['canonical']and before['indoCanonical']==preflight['indoCanonical'],'same-original-host-auth-and-two-canonicals')
  D.private('source-copy-proof.private.json',source);D.private('old-failed-attempt.private.json',failed);D.private('original-preflight-status.private.json',pref)
  D.private('protected-before.private.json',before)
  after=guarded(values,plan);need(before==after,'all465-live-static-backend46-runtime-host-auth-two-canonicals-stable-readonly')
  need(failed==failed_status()and pref==preflight_status()[1]and source==source_status(plan)and(values,plan)==R.receipts(),'old-failure-source-copy-preflight-and1053-receipts-preserved')
  D.private('protected-after.private.json',after);last=capacity();comparison=margins(last,pref['capacity'],source['allocatedBytesEstimate'])
  value.update(success=True,capacityAfterReadOnly=last,thresholdAnalysis=comparison,all46OriginalRuntimeUnchanged=True,
    all465OriginalLiveStaticAndBackendUnchanged=True,originalFailedEvidenceUnchanged=True,originalPreflightEvidenceUnchanged=True,
    originalSourceCopyIntact=True,sourceSummary={n:source[n]for n in('source','files','logicalBytes','allocatedBytesEstimate','fullTreeSHA256','allSixtyHashesOwnersModesSingleLinksExact')},
    proposedMinimumNextStep='Root review of a new explicit source-only reclaim attempt with tiny bounded proof and no automatic retry. No lifecycle or business change.',
    automaticReclaimPermitted=False)
 except Exception as error:value.update(errorType=type(error).__name__,stage=STAGE,libraryStage=getattr(R,'STAGE',None),preflightLibraryStage=getattr(D,'STAGE',None),capacityAfterFailure=capacity())
 value['resultSHA256']=sha(enc(value));D.private('result.private.json',value);D.wire(value);return 0 if value['success']else 1
if __name__=='__main__':sys.exit(main())
