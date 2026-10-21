"""One synthetic provider request after the completed release verification. Gate off.
No application import, business data input, queue/configuration write or retry.
Only the explicitly enabled synthetic request may incur vendor token usage.
"""
import hashlib,json,os,pathlib,re,subprocess,sys
ROOT=pathlib.Path('/opt/rr-portal');TARGET='25a76f71e556f77a8aadb031823b392832d2354a'
BRANCH='refs/heads/ops/batch-975-976-20261021';PROBE_PIN=True;EXPECTED_WORKER_IMAGE_ID='sha256:13be768463dc49fb063394df2c48bcd87b66509e858da362cf414b3c14a44b2b'
FRAGMENT_SHA='e81cdb9120f4b720264258729b72dc60486d4ea0f973c7a0c47052e2ed79b5bd'
LIMITS={'OPENAI_TIMEOUT_SECONDS':'900','OPENAI_MAX_OUTPUT_TOKENS':'64000','RQ_JOB_TIMEOUT_SECONDS':'1200'}
STAGE='entry'
def need(value):
 if not value:raise RuntimeError('FIXED_PROVIDER_PROBE_REJECTED')
def run(args,data=None,timeout=30):
 p=subprocess.run(args,input=data,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,timeout=timeout,cwd=ROOT);need(p.returncode==0 and len(p.stdout)<=8*1024**2);return p.stdout
def envmap(values):
 need(type(values)is list and len(values)<=1000);result={}
 for item in values:
  need(type(item)is str and '='in item);key,value=item.split('=',1);need(bool(re.fullmatch('[A-Za-z_][A-Za-z0-9_]*',key))and key not in result);result[key]=value
 return result
def safe_provider_result(value):
 need(type(value)is dict and type(value.get('httpSuccess'))is bool and type(value.get('ok'))is bool);result={'httpSuccess':value['httpSuccess'],'ok':value['ok']}
 if 'httpStatus'in value:need(type(value['httpStatus'])is int and 100<=value['httpStatus']<=599);result['httpStatus']=value['httpStatus']
 if 'usage'in value:
  need(type(value['usage'])is dict);result['usage']={k:v for k,v in value['usage'].items()if k in ('input_tokens','output_tokens','total_tokens')and type(v)is int and 0<=v<=10**9}
 if 'providerAcknowledgedMaxOutputTokens'in value:
  cap=value['providerAcknowledgedMaxOutputTokens'];need(type(cap)is int and 0<cap<=10**9);result['providerAcknowledgedMaxOutputTokens']=cap
 for key,allowed in [('errorType',('configuration','response_validation','transport','unexpected')),('providerErrorType',('invalid_request_error','authentication_error','permission_error','rate_limit_error','server_error','insufficient_quota')),('providerErrorParam',('max_output_tokens','model','text.format','text.format.schema','input'))]:
  if key in value:need(value[key]in allowed);result[key]=value[key]
 return result
FOOTER=b'''\nif __name__ == "__main__":
    import json
    try:
        result = provider_probe()
    except BaseException:
        result = {"httpSuccess": False, "ok": False, "errorType": "unexpected"}
    print(json.dumps(result, sort_keys=True, separators=(",", ":")), flush=True)
'''
def probe(result):
 global STAGE
 STAGE='fixed-target-and-worker-selection';need(run(['git','rev-parse','HEAD']).decode().strip()==TARGET);ids=run(['docker','ps','-aq','--no-trunc','--filter','label=com.docker.compose.project=rr-portal','--filter','label=com.docker.compose.service=qc-report-worker']).decode().split();need(len(ids)==1 and bool(re.fullmatch('[a-f0-9]{64}',ids[0])));records=json.loads(run(['docker','inspect',*ids]));need(type(records)is list and len(records)==1);row=records[0];labels=row.get('Config',{}).get('Labels')or{};need(row['Id']==ids[0]and row['Image']==EXPECTED_WORKER_IMAGE_ID and labels.get('com.docker.compose.project')=='rr-portal'and labels.get('com.docker.compose.service')=='qc-report-worker');need(row['State']['Running']is True and row['State']['OOMKilled']is False and row['State'].get('Health',{}).get('Status')=='healthy'and row['RestartCount']==0)
 STAGE='configured-and-process-three-numeric-limits';configured=envmap(row['Config']['Env']);blob=run(['docker','exec',ids[0],'cat','/proc/1/environ']);need(len(blob)<=1024**2 and blob.endswith(b'\0'));process=envmap([v.decode()for v in blob.split(b'\0')if v]);need(all(configured.get(k)==v and process.get(k)==v for k,v in LIMITS.items()));result.update(expectedImmutableWorkerImageVerified=True,configuredAndProcessThreeLimitsVerified=True)
 STAGE='exact-reviewed-synthetic-probe-fragment';path=pathlib.Path(__file__).with_name('provider-probe-fragment.py');need(path.is_file()and not path.is_symlink());fragment=path.read_bytes();need(len(fragment)<=16384 and hashlib.sha256(fragment).hexdigest()==FRAGMENT_SHA)
 STAGE='single-synthetic-provider-probe';result.update(syntheticProviderProbeAttempted=True,vendorUsageMayHaveOccurred=True);output=run(['docker','exec','-i',ids[0],'python','-B','-'],fragment+FOOTER,60);need(len(output)<=16384);safe=safe_provider_result(json.loads(output));result.update(safe);result['success']=safe['httpSuccess']and safe['ok']and safe.get('providerAcknowledgedMaxOutputTokens',64000)==64000;result['status']='accepted'if result['success']else 'failed'
def main():
 need(len(sys.argv)==2 and sys.argv[1]=='probe'and PROBE_PIN and bool(re.fullmatch('sha256:[a-f0-9]{64}',EXPECTED_WORKER_IMAGE_ID))and os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_ATTEMPT')=='1');result={'mode':'probe','target':TARGET,'success':False,'status':'failed','syntheticProviderProbeAttempted':False,'vendorUsageMayHaveOccurred':False,'businessWritesPerformed':False,'queueWritesPerformed':False,'configurationChanged':False,'mailboxStateChanged':False}
 try:probe(result)
 except BaseException:result['failedStage']=STAGE
 print(json.dumps(result,sort_keys=True,separators=(',',':')),flush=True);return 0 if result['success']else 1
if __name__=='__main__':
 try:code=main()
 except BaseException:print('{"mode":"probe","success":false,"safeFailure":"FIXED_PROVIDER_PROBE_PREFLIGHT_FAILED"}',flush=True);code=1
 sys.exit(code)
