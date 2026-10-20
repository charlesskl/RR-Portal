"""Read bounded boolean/count summaries from a fixed sealed failed verification."""
import hashlib,importlib.util,json,os,pathlib,re,sys,urllib.parse
PIN=True
BRANCH='refs/heads/ops/batch-961-965-20261020';RELEASE_SHA='f4f1ae32881efbdd35aa9bb36096d28c65e8f624bed0cd37f9099dd0c613a545'
ARCHIVE=pathlib.Path('/opt/rr-portal/deploy/backups/batch-961-965-20261020-verify-07');MANIFEST='014aba15d6e51888151805e7cfa2e35092ab297b33be70969a374dac5d3ec0d4';RESULT='8bb2dc492379c2c6df54d9b2b3893a4b1e0242c9e8d89a86aff04562c3919e91'
def need(value):
 if not value:raise RuntimeError('SEALED_ACCEPTANCE_RECEIPT_READ_REJECTED')
def checkmap(value):
 need(type(value)is dict and len(value)<=256 and all(type(k)is str and re.fullmatch('[A-Za-z0-9_/-]{1,200}',k)and type(v)is bool for k,v in value.items()));return value
def safe_numbers(value):
 need(type(value)is dict);return {k:v for k,v in value.items()if type(k)is str and re.fullmatch('[A-Za-z0-9_]{1,100}',k)and type(v)in(int,float,bool)}
def summary(result,data,observed):
 checks=checkmap(result['checks']);comparison=checkmap(data['checks']);details=data['details'];databases={}
 for label,value in details['closedDatabaseCompatibility'].items():
  need(type(label)is str and re.fullmatch('[A-Za-z0-9_. /-]{1,240}',label)and'..'not in label.split('/'));databases[label]={'passed':value.get('passed')is True,'checks':checkmap(value['checks']),'numericAndBooleanDetailsOnly':safe_numbers(value.get('details',{}))}
 sequence=details['quoteSequenceCompatibility'];seq=safe_numbers(sequence)
 if 'changedSequences'in sequence:
  changed=sequence['changedSequences'];need(type(changed)is list);seq['changedSequenceCount']=len(changed);seq['changedSequenceClassification']='none'if not changed else'exactQuoteSectionsOnly'if changed==['quote_sections_id_seq']else'otherRetainedPrivately'
 for key in('beforeLastValue','afterLastValue'):
  if key in sequence:need(type(sequence[key])is str and re.fullmatch('[0-9]{1,20}',sequence[key]));seq[key]=int(sequence[key])
 http=[]
 for row in observed['httpChecks']:
  if row['actualStatus']==row['expectedStatus']and(row['expectedSHA256']is None or row['actualSHA256']==row['expectedSHA256']):continue
  p=urllib.parse.urlsplit(row['url']);need(p.scheme=='http'and p.hostname=='127.0.0.1'and p.port in(None,80,3100)and not p.username and not p.password and p.path.startswith('/')and len(p.path)<=2048 and'..'not in urllib.parse.unquote(p.path).split('/'));need(type(row['expectedStatus'])is int and type(row['actualStatus'])is int and all(v is None or type(v)is str and re.fullmatch('[a-f0-9]{64}',v)for v in(row['expectedSHA256'],row['actualSHA256'])))
  http.append({'path':p.path,'port':p.port or 80,'expectedStatus':row['expectedStatus'],'actualStatus':row['actualStatus'],'expectedSHA256':row['expectedSHA256'],'actualSHA256':row['actualSHA256']})
 need(len(http)<=20)
 return {'verificationSuccessRetained':False,'failedCheckNames':[k for k,v in checks.items()if not v],'allAcceptanceChecks':checks,'comparatorChecks':comparison,'closedDatabaseCompatibility':databases,'quoteSequenceCompatibility':seq,'failedPublicHTTPChecksOnly':http,'businessRowsBodiesAndEnvironmentValuesPrinted':False}

def main():
 need(len(sys.argv)==2 and sys.argv[1]=='diagnose'and PIN and os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_ATTEMPT')=='1');path=pathlib.Path(__file__).with_name('batch-961-965-release.py');need(path.is_file()and not path.is_symlink()and hashlib.sha256(path.read_bytes()).hexdigest()==RELEASE_SHA);spec=importlib.util.spec_from_file_location('acceptance_reader_release06',path);R=importlib.util.module_from_spec(spec);spec.loader.exec_module(R);R.CORE=R.core_load();core=R.CORE;core.OPS=core.load('release-data-ops-library.py');core.OPS.L=core.OPS.load_library(pathlib.Path(__file__).with_name('release-data-library.py'));value=R.archive(ARCHIVE,MANIFEST,RESULT,False);need(value.get('mode')=='verify'and value.get('target')==R.TARGET and value.get('allSevenServiceObservationsComplete')is True and value.get('observationsRetainedBeforeComparison')is True and value.get('businessWritesPerformed')is False)
 data=json.loads(core.stable_environment_bytes(ARCHIVE/'data-comparison.private.json'));observed=json.loads(core.stable_environment_bytes(ARCHIVE/'observed.private.json'));out=summary(value,data,observed);out.update(mode='verify-07-acceptance-receipt',success=True,manifestSHA256=MANIFEST,resultSHA256=RESULT,liveRequestsOrBusinessWritesPerformed=False);encoded=R.enc(out);need(len(encoded)<=24000);print(encoded.decode(),flush=True);return 0
if __name__=='__main__':
 try:code=main()
 except BaseException:print('{"success":false,"safeFailure":"SEALED_ACCEPTANCE_RECEIPT_READ_PREFLIGHT_FAILED"}',flush=True);code=1
 sys.exit(code)
