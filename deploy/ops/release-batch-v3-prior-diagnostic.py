"""Read only: classify the exact v3 prior-failure gate without changing it."""
import hashlib,importlib.util,json,os,pathlib,re,stat,subprocess,sys,time
ROOT=pathlib.Path('/opt/rr-portal');BRANCH='refs/heads/ops/release-937-943-944-945-946-950-20261019';PIN_FROZEN=True
SOURCE_SHA='40f501d28bcc0fdbbca630be41440b1d2a7f9b89eec2fd0b7a0ee7f81a0ecc01'
OUT=ROOT/'deploy/backups/release-937-943-944-945-946-950-v3-prior-diagnostic-20261019'
SAFE_STAGES={'wait-healthy','validate-prior-failure','validate-backup','before-build','build','switch'}
def need(x):
 if not x:raise RuntimeError('PRIOR_DIAGNOSTIC_REJECTED')
def enc(x):return json.dumps(x,sort_keys=True,ensure_ascii=True,separators=(',',':')).encode()
def run(args,data=None,timeout=30):
 need(data is None and time.monotonic()<END)
 p=subprocess.run(args,stdout=subprocess.PIPE,stderr=subprocess.PIPE,cwd=ROOT,timeout=min(timeout,max(.1,END-time.monotonic())))
 need(p.returncode==0 and len(p.stdout)+len(p.stderr)<=32*1024**2);return p.stdout
def attempt(function):
 try:function();return True
 except Exception:return False
def environment_names(before,after):
 def values(rows):
  need(type(rows)is list and len(rows)<=1000 and all(type(x)is str and '='in x for x in rows));items=[x.split('=',1)for x in rows]
  need(len({k for k,v in items})==len(items)and all(re.fullmatch('[A-Za-z_][A-Za-z0-9_]{0,127}',k)for k,v in items));return dict(items)
 a,b=values(before),values(after);return {'changed':sorted(k for k in a.keys()&b.keys()if a[k]!=b[k]),'added':sorted(b.keys()-a.keys()),'removed':sorted(a.keys()-b.keys())}
def healthcheck_difference(before,after):
 a,b=before or {},after or {};need(type(a)is dict and type(b)is dict);allowed={'Test','Interval','Timeout','StartPeriod','StartInterval','Retries','Disable'}
 return {'changedFieldNames':sorted(k for k in allowed if a.get(k)!=b.get(k)),'testSame':a.get('Test')==b.get('Test'),'unknownFieldCount':len((a.keys()|b.keys())-allowed),'numericFields':{k:{'before':a.get(k)if type(a.get(k))is int else None,'after':b.get(k)if type(b.get(k))is int else None}for k in ['Interval','Timeout','StartPeriod','StartInterval','Retries']}}
def inspect_prior(v):
 p=v.PRIOR;l=v.OPS.L;checks={};checks['privateDirectory']=p.is_dir()and not p.is_symlink()and stat.S_IMODE(p.stat().st_mode)==0o700
 checks['manifestPin']=l.file_hash(p/'manifest.json')==v.PRIOR_MANIFEST;checks['resultPin']=l.file_hash(p/'first-result.json')==v.PRIOR_RESULT
 entries=list(p.rglob('*'));checks['entryCountBound']=len(entries)<=2000
 checks['privateRegularEntries']=all(not n.is_symlink()and(n.is_file()or n.is_dir())and n.stat().st_mode&0o077==0 for n in entries)
 manifest=json.loads((p/'manifest.json').read_bytes());checks['completeFileSet']=set(manifest)=={str(n.relative_to(p))for n in entries if n.is_file()and n!=p/'manifest.json'}
 checks['totalBytesBound']=sum(n.stat().st_size for n in entries if n.is_file())<=128*1024**2
 checks['completeManifestBytes']=all(l.safe_path(n)and re.fullmatch('[a-f0-9]{64}',h)and l.file_hash(p/n)==h for n,h in manifest.items())
 receipt=json.loads((p/'first-result.json').read_bytes());checks.update(successIsFalse=receipt.get('success')is False,targetMatches=receipt.get('target')==v.TARGET,stageWaitHealthy=receipt.get('failedStage')=='wait-healthy',serviceQC=receipt.get('failedService')=='qc',servicesEmptyList=receipt.get('services')==[])
 shape={'failedStage':receipt.get('failedStage')if receipt.get('failedStage')in SAFE_STAGES else'other','failedService':receipt.get('failedService')if receipt.get('failedService')in v.SERVICES else'other','servicesIsList':type(receipt.get('services'))is list,'servicesCount':len(receipt['services'])if type(receipt.get('services'))is list else None}
 preserved=json.loads((p/'preserved-tracked-files.private.json').read_bytes());checks['fourPreservedRows']=type(preserved)is dict and len(preserved)==4;copies=[]
 for index,name in enumerate(sorted(preserved)):
  row=preserved[name];copies.append({'index':index,'regular':row.get('kind')=='regular','absent':row.get('kind')=='absent','copySHA256Matches':l.file_hash(p/('dirty-%02d.private'%index))==row.get('sha256')if row.get('kind')=='regular'else None})
 checks['currentFourPreservedMatch']=attempt(lambda:need(v.dirty_state(())==preserved));checks['originalPriorFunctionPasses']=attempt(v.prior_failure)
 return {'checks':checks,'receiptShape':shape,'preservedCopyChecks':copies},l.file_hash(p/'manifest.json')
def main():
 global END
 os.umask(0o077);need(PIN_FROZEN and os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_ATTEMPT')=='1');END=time.monotonic()+100
 source=pathlib.Path(__file__).with_name('reviewed-recovery-v3.py');need(not source.is_symlink()and hashlib.sha256(source.read_bytes()).hexdigest()==SOURCE_SHA)
 spec=importlib.util.spec_from_file_location('prior_diagnostic_only',source);v=importlib.util.module_from_spec(spec);spec.loader.exec_module(v);v.OPS=v.load_ops();v.OPS.run=run;v.command=run
 OUT.mkdir(mode=0o700);result={'success':False,'readOnlyBusinessData':True,'oldEvidenceModified':False}
 try:
  result['prior'],manifest=inspect_prior(v);baseline=v.OPS.original_archive();current=v.OPS.runtime()
  diff=v.OPS.runtime_difference(baseline['runtime'],current);result['runtimeDifferences']={'services':diff['services'],'otherContainers':[{'fields':r['fields']}for r in diff['others']]};result['runtimeChecks']=v.OPS.runtime_checks(baseline['runtime'],current)
  row=current['services']['qc'];old=baseline['runtime']['services']['qc'];result['qcConfigurationEqualsBaseline']={k:row[k]==old[k]for k in ('environmentSHA256','mounts','memory','swap','healthcheck')}
  result['knownBadQCId']=row['id']==v.BAD_QC_ID;result['knownBadQCImage']=row['image']==v.BAD_QC_IMAGE;result['qcOOMFalse']=row['oom']is False
  result['sixOtherTargetsExactlyBaseline']={s:current['services'][s]==baseline['runtime']['services'][s]for s in v.SERVICES if s!='qc'}
  need(all(result['prior']['checks'][k]for k in ['manifestPin','resultPin','completeFileSet','completeManifestBytes','privateRegularEntries']))
  old_records=json.loads((v.PRIOR/'002-release-validate-backup.stdout.private').read_bytes());need(type(old_records)is list and len(old_records)<=1000)
  old_matches=[r for r in old_records if r.get('Id')==old['id']and(r.get('Config',{}).get('Labels')or{}).get('com.docker.compose.service')=='qc'];need(len(old_matches)==1)
  old_inspect=old_matches[0];new_inspect=json.loads(run(['docker','inspect',row['id']]))[0]
  need(new_inspect['Id']==row['id']and new_inspect['Image']==row['image']and v.OPS.digest(old_inspect['Config'].get('Env',[]))==old['environmentSHA256']and v.OPS.digest(new_inspect['Config'].get('Env',[]))==row['environmentSHA256'])
  result['qcEnvironmentVariableNames']=environment_names(old_inspect['Config'].get('Env',[]),new_inspect['Config'].get('Env',[]));result['qcHealthcheckDifference']=healthcheck_difference(old_inspect['Config'].get('Healthcheck'),new_inspect['Config'].get('Healthcheck'))
  result['originalRecoveryRuntimeFunctionPasses']=attempt(lambda:v.recovery_runtime(baseline['runtime'],current));result['headMatchesTarget']=run(['git','rev-parse','HEAD']).decode().strip()==v.TARGET
  result['runtimeStableDuringRead']=v.OPS.runtime()==current;need(v.OPS.L.file_hash(v.PRIOR/'manifest.json')==manifest);result['success']=True
 except BaseException:result['safeFailure']='FIXED_PRIOR_DIAGNOSTIC_FAILED'
 finally:v.OPS.L.private_write(OUT/'first-result.json',enc(result));v.OPS.L.seal(OUT);print(enc(result).decode(),flush=True)
 return 0 if result['success']else 1
if __name__=='__main__':
 try:sys.exit(main())
 except Exception:print('{"success":false,"safeFailure":"PRIOR_DIAGNOSTIC_PREFLIGHT_REJECTED"}',flush=True);sys.exit(1)
