"""INERT, single-run observation after a pre-stop busy abort. No replay or cleanup."""
import datetime,hashlib,importlib.util,json,os,pathlib,re,stat,sys,time,urllib.request,urllib.error
EXECUTE=False
RELEASE_FILE='pr1054-engineering-release.py'
RELEASE_SHA='e9347f1d7aaf0680e07d0747ecaf66709a29faf67d9107a04612a77732126694'
FAILED_SHA='17b0fc0e59b3ddcc29b5d72841c7437b69b1f64ff289db12594621de5ce4d861'
OUT=pathlib.Path('/opt/rr-portal/deploy/backups/pr1054-release-diagnose-1-20261102')
BRANCH='refs/heads/codex/ops-pr1054-20261102'
R=None
def enc(v):return json.dumps(v,sort_keys=True,separators=(',',':'),ensure_ascii=True,allow_nan=False).encode()
def sha(v):return hashlib.sha256(v).hexdigest()
def need(v,label):
 if not v:raise RuntimeError(label)
def load():
 global R
 path=pathlib.Path(__file__).with_name(RELEASE_FILE);need(path.is_file()and not path.is_symlink()and sha(path.read_bytes())==RELEASE_SHA,'exact-original-deploy-script-with-its-sealed-prepared-plan');spec=importlib.util.spec_from_file_location('pr1054_release_observation_library',path);R=importlib.util.module_from_spec(spec);spec.loader.exec_module(R);R.OUT=OUT;R.load()
def capture(fn):
 try:return {'success':True,'value':fn()}
 except Exception as error:return {'success':False,'errorType':type(error).__name__,'releaseStage':R.STAGE,'preflightStage':R.P.STAGE}
def evidence(name,limit=512*1024):
 path=R.ARCHIVE/'deploy'/name
 if not path.exists():need(not path.is_symlink(),'absent-evidence-not-alias');return None
 need(path.is_file()and not path.is_symlink()and path.stat().st_size<=limit,'bounded-selected-original-deploy-evidence');raw=path.read_bytes();value=json.loads(raw);return {'bytes':len(raw),'sha256':sha(raw),'value':value}
def failure_evidence():
 failed=evidence('result.private.json');need(failed is not None and failed['sha256']==FAILED_SHA,'exact-failed-no-stop-deploy-receipt');v=failed['value'];core=dict(v);seal=core.pop('resultSHA256',None);need(seal==sha(enc(core))and v['phase']=='deploy'and v['success']is False and v['target']==R.TARGET and v['sourceHead']==R.HEAD,'original-self-sealed-failure-not-a-replay');allowed={'stage','stopAttempted','startAttempted','retirementAttempted','canonicalTagAttempted','automaticRetryOrRollback','businessDataRestoreOrMigration'};need(set(v['operations'])==allowed and all(v['operations'][n]is False for n in allowed-{'stage'}),'original-failure-before-any-live-code-or-lifecycle-publication')
 result={'receiptSHA256':failed['sha256'],'stage':v['stage'],'operations':v['operations'],'startedUtc':v['startedUtc'],'finishedUtc':v['finishedUtc'],'gateMayRemainClosed':v['gateMayRemainClosed']}
 observations=evidence('drain-observations.private.json');keys={'elapsed','dataMetadataSHA256','targetConnections','targetDataWriteFDs','gatewayConnections','gatewayBufferedUploadWriteFDs'}
 if observations is not None:
  rows=observations['value'];need(type(rows)is list and 1<=len(rows)<=100 and all(type(row)is dict and set(row)==keys and all(type(row[k])is int and 0<=row[k]<100000 for k in keys-{'elapsed','dataMetadataSHA256'})and type(row['elapsed'])in(int,float)and 0<=row['elapsed']<=150 and re.fullmatch('[a-f0-9]{64}',row['dataMetadataSHA256'])for row in rows),'typed-bounded-original-drain-counts-only');result['drain']=observations
 names=('operation-gate-intent.private.json','operation-gate-ack.private.json','operation-gate-clear-intent.private.json','operation-gate-clear-ack.private.json','operation-stop-intent.private.json','operation-stop-ack.private.json','operation-overlay-intent.private.json','operation-start-intent.private.json','operation-retirement-intent.private.json','operation-canonical-intent.private.json','busy-abort.private.json','failure-observation.private.json');result['evidence']={}
 for name in names:
  item=evidence(name,128*1024)
  if item is not None:
   value=item['value']
   if name.startswith('operation-'):need(type(value)is dict and set(value)<=allowed,'only-original-typed-operation-states')
   elif name=='busy-abort.private.json':need(set(value)=={'stopAttempted','originalHealthyUnmodified','ownedGateCleared','automaticRetry'},'only-original-busy-abort-flags')
   else:need(set(value)=={'stage','exceptionType','operations','noAutomaticReplayOrRollback'}and set(value['operations'])<=allowed,'only-original-failure-stage-and-flags')
   result['evidence'][name]=item
 return result
def runtime():
 ids=R.run(['docker','ps','-aq','--no-trunc'],limit=16384).decode().split();need(len(ids)==len(set(ids))and 0<len(ids)<=80 and all(re.fullmatch('[a-f0-9]{64}',cid)for cid in ids),'bounded-runtime-identifiers');rows=json.loads(R.run(['docker','inspect',*ids],limit=16*1024**2));need({r['Id']for r in rows}==set(ids),'complete-current-container-observation');safe={}
 for r in rows:
  s=r['State'];safe[r['Id']]={'image':r['Image'],'configSHA256':sha(enc(r['Config'])),'hostConfigSHA256':sha(enc(r['HostConfig'])),'envSHA256':sha(enc(sorted(r['Config'].get('Env')or[]))),'mountsSHA256':sha(enc(sorted(r['Mounts'],key=enc))),'pid':s['Pid'],'started':s['StartedAt'],'restarts':r['RestartCount'],'running':s['Running'],'oom':s['OOMKilled'],'health':s.get('Health',{}).get('Status')}
 app=[r for r in rows if r['Id']==R.CID];nginx=[r for r in rows if(r['Config'].get('Labels')or{}).get('com.docker.compose.project')=='rr-portal'and(r['Config'].get('Labels')or{}).get('com.docker.compose.service')=='nginx'];need(len(app)==len(nginx)==1,'same-known-engineering-and-one-gateway-observed');return safe,app[0],nginx[0]
def http_statuses():
 class NoRedirect(urllib.request.HTTPRedirectHandler):
  def redirect_request(self,*args,**kwargs):return None
 opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),NoRedirect());result={}
 for path in('/','/gongcheng-ziliao/','/gongcheng-ziliao/health','/gongcheng-ziliao/api/clients','/indo-shipping/api/health','/qc/api/health','/internal-quote/health','/paiji/health','/sprayplan/api/health'):
  start=time.monotonic()
  try:
   try:r=opener.open(urllib.request.Request('http://127.0.0.1'+path,headers={'Connection':'close','Cache-Control':'no-cache'}),timeout=10)
   except urllib.error.HTTPError as error:r=error
   with r:body=r.read(2*1024**2+1);status=r.code
   need(len(body)<=2*1024**2,'bounded-http-body-never-persisted');result[path]={'status':status,'bytes':len(body),'sha256':sha(body),'elapsed':round(time.monotonic()-start,3)}
  except Exception as error:result[path]={'errorType':type(error).__name__,'elapsed':round(time.monotonic()-start,3)}
 return result
def main():
 need(EXECUTE is True and sys.argv[1:]==['diagnose']and os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_MODE')=='diagnose'and os.environ.get('RELEASE_ATTEMPT')=='1','inert-first-readonly-observation-no-replay');os.umask(0o077);need(OUT.parent.is_dir()and not any(p.is_symlink()for p in(OUT.parent,*OUT.parent.parents))and not OUT.exists()and not OUT.is_symlink(),'fresh-owned-diagnostic-evidence-only');OUT.mkdir(mode=0o700);load();result={'phase':'diagnose','success':False,'readOnly':True,'lifecycleWrites':False,'configurationWrites':False,'businessWrites':False,'automaticReplayOrRollback':False,'startedUtc':datetime.datetime.now(datetime.timezone.utc).isoformat()}
 try:
  result['originalFailure']=failure_evidence();plan=R.prepared();before,app,nginx=runtime();result['runtime']=before;result['all46EqualPrepared']=before==plan['before']['runtime'];result['portBoundary']=capture(lambda:R.no_public_service_port(app));result['host']=capture(R.P.host);result['auth']=capture(lambda:R.P.auth(nginx));result['canonical']=capture(lambda:R.image(R.CANONICAL)['Id']);result['candidate']=capture(lambda:R.image(plan['candidateTag'])['Id']);result['gate']=capture(lambda:R.gate_record(R.gate_path())if R.gate_path().exists()else None)
  def old_code():
   actual=R.current_profile(app,plan['oldSource']);return {'fileCount':len(actual),'manifestSHA256':sha(enc(actual)),'exactOriginalPreparedSource':actual==plan['oldSource']}
  def static_code():
   actual=R.P.static(app,False)['files'];return {'fileCount':len(actual),'manifestSHA256':sha(enc(actual)),'exactOriginalPreparedStatic':actual==plan['oldStatic']}
  result['source']=capture(old_code);result['static']=capture(static_code);result['privateConfigAndInstalledLock']=capture(lambda:R.config_profile(app)==plan['config']);result['dataMetadata']=capture(lambda:{'metadataSHA256':R.metadata_tree(R.document_root(app)),'contentReadOrNewBackupCreated':False,'warmObservationNotGlobalAtomicSnapshot':True});result['http']=http_statuses();result['targetReadOnlyHTTP']=capture(R.http);after,_,_=runtime();result['runtimeAfter']=after;result['runtimeUnchangedDuringObservation']=after==before;result['capacity']=R.P.capacity();result['success']=True
 except Exception as error:result.update(errorType=type(error).__name__,releaseStage=R.STAGE,preflightStage=R.P.STAGE)
 result['finishedUtc']=datetime.datetime.now(datetime.timezone.utc).isoformat();result['resultSHA256']=sha(enc(result));R.private('result.private.json',result);R.P.wire(result);return 0 if result['success']else 1
if __name__=='__main__':sys.exit(main())
