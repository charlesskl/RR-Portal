"""Bounded stdout of one existing sealed diagnostic receipt; no live requests or writes."""
import hashlib,importlib.util,json,os,pathlib,sys
PIN=True
BRANCH='refs/heads/ops/batch-961-965-20261020'
RELEASE_SHA='f4f1ae32881efbdd35aa9bb36096d28c65e8f624bed0cd37f9099dd0c613a545'
ARCHIVE=pathlib.Path('/opt/rr-portal/deploy/backups/batch-961-965-20261020-verify-observation-diagnosis-06-01')
def need(value):
 if not value:raise RuntimeError('SEALED_RECEIPT_READ_REJECTED')
def main():
 need(len(sys.argv)==2 and sys.argv[1]=='diagnose'and PIN and os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_ATTEMPT')=='1')
 path=pathlib.Path(__file__).with_name('batch-961-965-release.py');need(path.is_file()and not path.is_symlink()and hashlib.sha256(path.read_bytes()).hexdigest()==RELEASE_SHA);spec=importlib.util.spec_from_file_location('receipt_read_release06',path);R=importlib.util.module_from_spec(spec);spec.loader.exec_module(R);R.CORE=R.core_load();core=R.CORE;core.OPS=core.load('release-data-ops-library.py');core.OPS.L=core.OPS.load_library(pathlib.Path(__file__).with_name('release-data-library.py'))
 manifest=core.OPS.L.file_hash(ARCHIVE/'manifest.json');result=core.OPS.L.file_hash(ARCHIVE/'first-result.json');value=R.archive(ARCHIVE,manifest,result);need(value.get('mode')=='verify-observation-diagnosis-06'and value.get('executedHelperSHA256')=='4c29f18ac657159962d38e5813cd65166c16477fcb91e4bb2917b3b65e9d57a9'and value.get('observationsStableDuringDiagnosis')is True and all(value.get(key)is False for key in('businessSourceEnvironmentOrModeWritesPerformed','buildsRunsOrServiceSwitchesPerformed','newHTTPRegistryOrLoginRequestsPerformed','standardWorkflowChanged')))
 for name in('beforeReadOnlyObservations','afterReadOnlyObservations'):need(type(value.get(name))is dict and all(flag is True for flag in value[name].values()))
 keys=('retainedCompletedHTTPCount','lastRetainedCompletedRequestPath','publicContainerAssetInventoryCounts','httpChecksWereReturnedToObserver','closedCaptureFacts','nextUnretainedRequestOrPredicateCannotBeInferred','publicAssetResponseContentsPrinted','queryStringsCredentialsAndBusinessValuesPrinted');summary={key:value[key]for key in keys};rows=value['retainedCompletedHTTPRequests'];need(type(rows)is list and len(rows)<=1000);summary.update(mode='verify-observation-diagnosis-receipt',success=True,completeOriginalDiagnosticSuccess=True,manifestSHA256=manifest,resultSHA256=result,lastSixRetainedCompletedHTTPRequests=rows[-6:],closedDiagnosticBeforeAndAfterProtectedStateUnchanged=True,liveRequestsOrBusinessWritesPerformed=False)
 encoded=R.enc(summary);need(len(encoded)<=24000);print(encoded.decode(),flush=True);return 0
if __name__=='__main__':
 try:code=main()
 except BaseException:print('{"success":false,"safeFailure":"SEALED_RECEIPT_READ_PREFLIGHT_FAILED"}',flush=True);code=1
 sys.exit(code)
