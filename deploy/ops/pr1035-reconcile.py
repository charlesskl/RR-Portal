"""INERT finalize only: no stop/start/copy/build replay, original failure remains sealed."""
import calendar,datetime,email.utils,hashlib,importlib.util,io,json,os,pathlib,re,sys,tarfile,time
EXECUTE=False
BRANCH='refs/heads/ops/pr-1035-20261029-quote'
SOURCE_SHA='2ea1fa14e1a415dd9205761754616e6a2bf1496f46e5159d01059edd902a23c1'
PREPARED='fcf4485a301fbc244dbe8b717c56e2af00fd0002f634a62565fc120a9f648d9f'
PREPARED_RESULT='354e7c7db194d0ef3d436903a40eab36db1b8787086ecfbc0fc96c2cd8249f15'
FAILED='31b70cb6a5be4d176518d5f2e66c28bfecb736941232788e628244c51cfaf9fa'
FAILED_RESULT='d42ee606f5c40c63a2611b3c7107ff0717e32299d5c8e93f827185700a1447ca'
CANDIDATE='sha256:834b705bec9a0da37224b3d5d3b9caf646c9bcf7d86f5e25bf18e0baf0c26aa9'
OUT=pathlib.Path('/opt/rr-portal/deploy/backups/pr1035-quote-20261029/reconcile-1')
M=None;STAGE='entry'
def need(v,label):
 global STAGE
 STAGE=label
 if not v:raise RuntimeError(label)
def sha(b):return hashlib.sha256(b).hexdigest()
def enc(v):return json.dumps(v,sort_keys=True,separators=(',',':'),ensure_ascii=True,allow_nan=False).encode()
def nanos(text):
 x=re.fullmatch(r'(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?(?:Z|\+00:00)',text);need(x is not None,'exact-utc-iso-with-up-to-nine-fraction-digits');d=datetime.datetime.strptime(x[1],'%Y-%m-%dT%H:%M:%S');return calendar.timegm(d.timetuple())*10**9+int((x[2]or'').ljust(9,'0'))
def sealed(directory,digest,result_digest):
 need(directory.is_dir()and not directory.is_symlink()and M.file_hash(directory/'manifest.json')==digest,'fixed-phase-manifest-byte-seal');mf=json.loads((directory/'manifest.json').read_bytes());entries=list(directory.rglob('*'));need(all(not p.is_symlink()and(p.is_file()or p.is_dir())for p in entries),'regular-original-phase-evidence');files={p.relative_to(directory).as_posix()for p in entries if p.is_file()and p!=directory/'manifest.json'};need(files==set(mf)and all(M.L.safe_path(n)and M.file_hash(directory/n)==h for n,h in mf.items()),'complete-original-phase-all-file-seals');need(M.file_hash(directory/'result.private.json')==result_digest,'fixed-original-result-byte-seal');v=json.loads((directory/'result.private.json').read_bytes());need((v['base'],v['head'],v['target'],v['tree'],v['appTree'],v['hostBase'])==(M.BASE,M.HEAD,M.TARGET,M.TREE,M.APP_TREE,M.HOST_BASE),'original-source-and-host-pins');return v

def events(cid,since,until,started):
 raw=M.run(['docker','events','--since',since,'--until',until,'--filter','container='+cid,'--format','{{json .}}']);rows=[json.loads(line)for line in raw.splitlines()if line];life=[]
 for r in rows:
  need((r.get('Actor')or{}).get('ID',r.get('id'))==cid,'exact-container-event-filter');action=r.get('Action',r.get('status'));need(type(action)is str,'typed-docker-event-action')
  if action in('stop','die','start','kill','restart','oom','destroy','create','pause','unpause','update'):life.append((action,int(r['timeNano'])if'timeNano'in r else int(r['time'])*10**9))
 counts={a:sum(x==a for x,_ in life)for a in('stop','die','start','kill','restart','oom','destroy','create','pause','unpause','update')};need(counts['stop']==counts['die']==counts['start']==1 and counts['kill']<=2 and all(counts[a]==0 for a in('restart','oom','destroy','create','pause','unpause','update')),'observed-exact-one-original-stop-die-start-no-conflict');at={a:t for a,t in life if a in('stop','die','start')};need(all(t<=max(at['stop'],at['die'])for a,t in life if a=='kill')and max(at['stop'],at['die'])<at['start']and nanos(since)<=started<=at['start']<=nanos(until),'one-start-events-and-state-timeline');M.private(OUT/'one-start-events.private.json',enc({'rows':rows,'counts':counts}));return counts

def old_headers(directory,prepared):
 with tarfile.open(directory/'rollback-source.tar')as t:
  rows=t.getmembers();need(len(rows)==len(M.CODE)and{r.name for r in rows}==set(M.CODE)and all(r.isfile()for r in rows),'sealed-nine-original-regular-rollback-members');result={}
  for r in rows:
   body=t.extractfile(r).read();old=prepared['oldSource'][r.name];need(sha(body)==old['sha256']and(r.uid,r.gid,r.mode,len(body))==(old['uid'],old['gid'],old['mode'],old['bytes']),'rollback-member-exact-original-bytes-metadata');need(prepared['metadata'][r.name]['mtime']>r.mtime,'new-source-mtime-strictly-later-than-original')
   if r.name.startswith('frontend/'):result[r.name]={'ETag':None,'Last-Modified':email.utils.formatdate(r.mtime,usegmt=True)}
  return result

def reconcile():
 failed_dir=M.ARCHIVE/'deploy';prepared_dir=M.ARCHIVE/'prepare';failure=sealed(failed_dir,FAILED,FAILED_RESULT);prepared=sealed(prepared_dir,PREPARED,PREPARED_RESULT);need(failure['success']is False and failure['phase']=='deploy'and failure['errorType']=='ValueError'and failure['stage']=='one-same-cid-manual-start-only-runtime-delta'and failure['dependencyStage']=='readOnlyPGSnapshotClosed','exact-failed-after-successful-start-before-source-and-pg-comparison');need(prepared['success']is True and prepared['phase']=='prepare','exact-successful-prepare');p=prepared['details'];need(p['candidate']==CANDIDATE and M.image(CANDIDATE)['Id']==CANDIDATE,'existing-reviewed-candidate-no-rebuild');M.source_check();current=M.runtime();before=p['runtime'];need(set(current)==set(before)and all(current[c]==before[c]for c in before if c!=M.CID),'all-other-original-container-runtimes-exact');old,new=before[M.CID],current[M.CID];need(new==dict(old,started=new['started'],pid=new['pid'],restarts=0)and new['running']and new['health']=='healthy'and new['started']!=old['started']and new['pid']!=old['pid'],'same-single-start-runtime-contract');window=json.loads((failed_dir/'stop-start-window.private.json').read_bytes())['begin'];started=nanos(new['started']);need(nanos(window)<=started<=(failed_dir/'result.private.json').stat().st_mtime_ns,'started-within-original-operation-before-failed-result-newly-observed-mtime');now=datetime.datetime.now(datetime.timezone.utc).isoformat();event_proof=events(M.CID,window,now,started);protected=M.protection(current);need(protected==p['protected'],'all-original-env-host-auth-bind-metadata-exact');owned=tuple(json.loads((failed_dir/'gate.private.json').read_bytes()));gate=M.ROOT/'deploy/maintenance/services/internal-quote';need(M.gate_record(gate)==owned,'original-sealed-owned-gate-inode-and-metadata');ingress=M.entry(True);source,actual=M.source(M.CID,'reconciled-source',M.TARGET);need(source['differentFiles']==['package-lock.json']and actual==p['source']and M.tree_hash(M.CID)==p['newSignature'],'all-147-current-source-and-dependencies-equal-reviewed-candidate');M.stopped_check(M.CID,p['metadata']);cold=json.loads((failed_dir/'cold-before/capture.private.json').read_bytes());after=M.storage('reconciled-after-start',False);M.compare_storage(cold,after);headers=old_headers(prepared_dir,p);need(M.runtime()==current and M.protection(current)==protected and M.image(M.ALIAS)['Id']==M.BASE_IMAGE and M.gate_record(gate)==owned,'final-runtime-config-alias-and-original-gate-cas');M.run(['docker','tag',CANDIDATE,M.ALIAS]);need(M.image(M.ALIAS)['Id']==CANDIDATE and M.runtime()==current and M.gate_record(gate)==owned,'existing-candidate-promoted-once-and-gate-still-owned');gate.unlink();M.entry(False,ingress);M.public_files(headers);return {'sameContainer':M.CID,'liveImage':M.LIVE_IMAGE,'durableImage':CANDIDATE,'runtime':current,'protected':protected,'allBusinessAuthRowsSchemaAndFilesPreserved':True,'expectedQuoteSectionsSequenceConsumption':cold['startup']['expectedSingleStartupQuoteSectionSequenceIncrement'],'observedLifecycleEvents':event_proof,'noLifecycleOrCodeCopyReplay':True,'originalFailureAndPrepareEvidencePreserved':True,'oldLastModifiedValidatorsReconstructedFromSealedRollback':True,'oldETagValidatorNotClaimed':True,'failedResultMtimeIsNewObservationNotOriginalManifestField':True}

def main():
 global M
 need(EXECUTE is True and sys.argv[1:]==['reconcile']and os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_MODE')=='reconcile'and os.environ.get('RELEASE_ATTEMPT')=='1','explicit-one-shot-reconcile-only');os.umask(0o077);source=pathlib.Path(__file__).with_name('pr1035-original-release.py');need(source.is_file()and not source.is_symlink()and sha(source.read_bytes())==SOURCE_SHA,'exact-reviewed-original-inert-source');spec=importlib.util.spec_from_file_location('quote1035_original',source);M=importlib.util.module_from_spec(spec);spec.loader.exec_module(M);need(M.EXECUTE is False and OUT.parent==M.ARCHIVE and OUT.parent.is_dir()and not OUT.exists()and not OUT.is_symlink(),'fresh-reconcile-only-output');OUT.mkdir(mode=0o700);M.OUT=OUT;M.PHASE='reconcile';v={'mode':'reconcile','phase':'reconcile','base':M.BASE,'head':M.HEAD,'target':M.TARGET,'tree':M.TREE,'appTree':M.APP_TREE,'hostBase':M.HOST_BASE,'resultPath':str(OUT/'result.private.json'),'success':False,'automaticMutationRetry':False,'noLifecycleOrCodeCopyReplay':True}
 try:M.setup();v['details']=reconcile();v['success']=True
 except Exception as e:v.update(errorType=type(e).__name__,stage=STAGE,originalHelperStage=M.STAGE)
 M.private(OUT/'result.private.json',enc(v));files=list(OUT.rglob('*'));need(all(not p.is_symlink()and(p.is_dir()or p.is_file())for p in files),'new-regular-reconcile-evidence');mf={p.relative_to(OUT).as_posix():M.file_hash(p)for p in files if p.is_file()};M.private(OUT/'manifest.json',enc(mf));M.transport(dict(v,resultSHA256=sha(enc(v)),manifestSHA256=sha(enc(mf))));return 0 if v['success']else 1
if __name__=='__main__':sys.exit(main())
