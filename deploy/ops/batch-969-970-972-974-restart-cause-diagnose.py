"""Bounded read-only cause evidence for one already observed unrelated restart."""
import datetime,hashlib,importlib.util,json,os,pathlib,re,sys,traceback
ROOT=pathlib.Path('/opt/rr-portal');BRANCH='refs/heads/ops/batch-969-970-972-974-20261021';DIAG_PIN=True
RUNTIME_LIBRARY_SHA='760230a691c298a6c31e99fc69381a9cb96fe547b41555d104056aae8ac5a8ab';RELEASE_SHA='5776dcf97872c86e54aa4239cc2aba8160b40008c16fae545f4896a441e07287'
CID='e533624b4acea4cafb69a5014e21c1751596f115002176385d0f3b7420959d48';START='2026-10-21T02:00:50Z';END='2026-10-21T02:01:40Z'
OLD=ROOT/'deploy/backups/batch-969-970-972-974-20261021-runtime-diagnose-01';OLD_MANIFEST='86fa1eb0d1761456c6b895752c52c0c035135ad70b2871bed7199b70cff8e48f';OLD_RESULT='e94eb70ea583428ca34b62d26a62e9da9c9c2318203ac704b8c7ca60ac260a84'
OUT=ROOT/'deploy/backups/batch-969-970-972-974-20261021-runtime-diagnose-02';D=None;R=None;STAGE='entrypoint'

def need(value):
 if not value:raise RuntimeError('FIXED_RESTART_CAUSE_DIAG_REJECTED')

def load(name,filename,checksum):
 path=pathlib.Path(__file__).with_name(filename);need(path.is_file()and not path.is_symlink()and hashlib.sha256(path.read_bytes()).hexdigest()==checksum);spec=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m

def old_evidence():
 need(R.observation_archive(OLD)==OLD_MANIFEST and R.CORE.OPS.L.file_hash(OLD/'first-result.json')==OLD_RESULT);receipt=R.read_json(OLD/'first-result.json');need(receipt.get('success')is True and receipt.get('diagnosisCompleteOnly')is True and receipt.get('sourceEnvironmentFileDirtyFilesAndMaintenanceStrictlyUnchanged')is True)
 saved=R.read_json(OLD/'current-after-canonical-runtime.private.json');need(saved.get('available')is True);known=saved['runtime'];row=known['others'][CID];need(row['id']==CID and row['running']is True and row['health']=='healthy'and row['oom']is False and row['restarts']==1);return known

def capture(args,label,timeout=30):
 try:
  raw=R.private_capture(args,label,timeout);need(len(raw)<=4*1024**2);return raw
 except BaseException:
  R.CORE.OPS.L.private_write(OUT/(label+'-capture-error.private.txt'),traceback.format_exc().encode());return None

def events_summary(raw):
 if raw is None:return {'available':False}
 lines=raw.splitlines();need(len(lines)<=512);events=[];unknown=0
 allowed={'die','start','restart','oom','kill','stop','health_status: healthy','health_status: unhealthy','health_status: starting'}
 for line in lines:
  row=json.loads(line);actor=row.get('Actor',{});need(actor.get('ID',row.get('id'))==CID);action=row.get('Action',row.get('status'));timestamp=row.get('timeNano');need(type(timestamp)is int and timestamp>=0)
  if action not in allowed:unknown+=1;continue
  attrs=actor.get('Attributes')or{};code=attrs.get('exitCode');signal=attrs.get('signal');item={'action':action,'timeNano':timestamp}
  if type(code)is str and re.fullmatch('[0-9]{1,3}',code):item['exitCode']=int(code)
  if type(signal)is str and re.fullmatch('[0-9]{1,2}',signal):item['signalNumber']=int(signal)
  events.append(item)
 return {'available':True,'recordCount':len(lines),'recognizedEventCount':len(events),'recognizedEvents':events[:20],'recognizedEventsCompleteInPublic':len(events)<=20,'otherActionCount':unknown,'eventRetentionCompletenessUnknown':True,'callerIdentityNotProven':True}

def technical_log_summary(raw,journal=False):
 if raw is None:return {'available':False}
 counts={k:0 for k in('oom','panicOrFatal','signalOrShutdown','addressAlreadyInUse')};matches=0;count=0
 for line in raw.splitlines():
  count+=1;need(count<=1000)
  text=(json.loads(line).get('MESSAGE','')if journal else line.decode('utf-8','replace'))
  if type(text)is not str:continue
  need(len(text)<=256*1024);lower=text.lower()
  oom=any(k in lower for k in('out of memory','oom-kill','oom_reaper','killed process','memory cgroup out of memory'));counts['oom']+=int(oom);counts['panicOrFatal']+=int('panic:'in lower or'fatal'in lower);counts['signalOrShutdown']+=int(any(k in lower for k in('received signal','shutting down','shutdown','signal:')));counts['addressAlreadyInUse']+=int('address already in use'in lower);matches+=int(oom and(CID in lower or CID[:12]in lower))
 return {'available':True,'recordCount':count,'fixedTechnicalCategoryCounts':counts,'oomMessagesMentioningTargetId':matches,'absenceDoesNotProveNoHistoricalOOM':True,'boundedRetainedRecordsOnly':True}

def bounded_file(path,label,limit=8192):
 try:
  need(path.resolve()==path.absolute());fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
  with os.fdopen(fd,'rb')as file:raw=file.read(limit+1)
  need(len(raw)<=limit);R.CORE.OPS.L.private_write(OUT/(label+'.private.txt'),raw);return raw
 except BaseException:return None

def cgroup_and_host_memory():
 host=bounded_file(pathlib.Path('/proc/meminfo'),'host-meminfo');facts={}
 if host is not None:
  for key,value in re.findall(rb'^(MemTotal|MemAvailable|SwapTotal|SwapFree):\s+([0-9]+) kB$',host,re.M):facts[key.decode()+'Bytes']=int(value)*1024
 result={'hostMeminfo':facts,'currentCountersDoNotProveHistoricalCause':True,'cgroupCountersMayResetOnRestart':True};pid=capture(['docker','inspect','--format','{{.State.Pid}}',CID],'target-host-pid',20)
 if pid is None or not re.fullmatch(rb'[1-9][0-9]{0,9}\s*',pid):return result
 proc=bounded_file(pathlib.Path('/proc')/pid.decode().strip()/'cgroup','target-proc-cgroup')
 if proc is None:return result
 entries=[line.split(b'::',1)[1].decode()for line in proc.splitlines()if line.startswith(b'0::')];need(len(entries)<=1)
 if not entries:return result
 relative=pathlib.PurePosixPath(entries[0]);need(relative.is_absolute()and'..'not in relative.parts);proven=any(p in{CID,'docker-'+CID+'.scope'}for p in relative.parts);result['targetCgroupPathProven']=proven
 if not proven:return result
 folder=pathlib.Path('/sys/fs/cgroup').joinpath(*relative.parts[1:]);need(folder.resolve().is_relative_to(pathlib.Path('/sys/fs/cgroup')))
 for name in('memory.events','memory.events.local','memory.current','memory.max','memory.peak'):
  data=bounded_file(folder/name,'target-'+name.replace('.','-'))
  if data is None:result[name]={'available':False};continue
  if name.startswith('memory.events'):
   pairs=dict(line.split()for line in data.splitlines());result[name]={k.decode():int(v)for k,v in pairs.items()if k in{b'low',b'high',b'max',b'oom',b'oom_kill',b'oom_group_kill'}and re.fullmatch(rb'[0-9]+',v)}
  else:need(data.strip()==b'max'or re.fullmatch(rb'[0-9]+',data.strip()));result[name]=data.decode().strip()if data.strip()==b'max'else int(data.strip())
 return result

def cause_evidence():
 events=capture(['docker','events','--since',START,'--until',END,'--filter','container='+CID,'--format','{{json .}}'],'target-window-events',30)
 journal=capture(['journalctl','--kernel','--since','2026-10-21 02:00:50 UTC','--until','2026-10-21 02:01:40 UTC','--no-pager','--output=json','-n','200'],'kernel-window-journal',30)
 logs=capture(['docker','logs','--since',START,'--until',END,'--timestamps','--tail','120',CID],'target-window-logs',30);log_stderr=OUT/('%04d-target-window-logs.stderr.private'%R.COUNTER)
 if logs is not None and log_stderr.is_file():need(log_stderr.stat().st_size<=4*1024**2);logs+=log_stderr.read_bytes();need(len(logs)<=4*1024**2)
 raw_stats=capture(['docker','stats','--no-stream','--no-trunc','--format','{{json .}}',CID],'target-current-stats',20);stats={}
 if raw_stats is not None:
  row=json.loads(raw_stats);need(row.get('ID')==CID or row.get('Container')==CID)
  for key in('CPUPerc','MemPerc','MemUsage','PIDs'):
   value=row.get(key);need(type(value)is str and re.fullmatch('[0-9.,% /KMGTPEiB]{1,128}',value));stats[key]=value
 return {'targetId':CID,'service':'factory-review','windowUTC':{'start':START,'end':END},'dockerEvents':events_summary(events),'kernelJournal':technical_log_summary(journal,True),'targetLogs':technical_log_summary(logs),'currentDockerStats':stats,'currentHostAndCgroupMemory':cgroup_and_host_memory(),'historicalCauseOrActorNotAutomaticallyAttributed':True}

def main():
 global D,R,STAGE
 need(DIAG_PIN and sys.argv[1:]==['diagnose']and os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_ATTEMPT')=='1');D=load('reviewed_runtime_diagnostic','batch-runtime-diagnostic-library.py',RUNTIME_LIBRARY_SHA);R=load('reviewed_runtime_release','batch-release-library.py',RELEASE_SHA);need(D.RELEASE_SHA==RELEASE_SHA and R.TARGET==D.TARGET and R.TREE==D.TREE)
 os.umask(0o077);OUT.mkdir(mode=0o700);R.OUT=OUT;R.ENV=dict(os.environ);R.CORE=R.load_core();D.R=R;D.OUT=OUT;result={'mode':'diagnose','success':False,'containerOrServiceSignalsPerformed':False,'liveHTTPOrBusinessAPICallsPerformed':False,'sourceEnvironmentDataOrMaintenanceModified':False}
 try:
  STAGE='old-runtime-diagnostic-complete-seal';known=old_evidence();before=R.original();files=R.source_manifest();D.observe(result);current,raw=R.CORE.runtime();R.CORE.OPS.L.private_write(OUT/'cause-runtime-before.private.json',R.enc({'runtime':current,'rawTargetInspects':raw}));need(current==known)
  STAGE='fixed-container-events-kernel-logs-and-current-resources';result['restartCauseEvidence']=cause_evidence()
  STAGE='final-runtime-source-and-all-evidence-seals';after,raw=R.CORE.runtime();R.CORE.OPS.L.private_write(OUT/'cause-runtime-after.private.json',R.enc({'runtime':after,'rawTargetInspects':raw}));need(after==current);D.source_guard(before,files);need(R.original()==before and old_evidence()==known);R.failed_prepare_evidence();D.failed_deploy();R.archive(R.PREPARE,R.PREPARE_MANIFEST,R.PREPARE_RESULT);result.update(success=True,currentObservedRuntimeStrictlyUnchangedDuringCauseCapture=True,oldRuntimeDiagnosticFullSealPreserved=True)
 except BaseException:result.update(success=False,failedStage=STAGE,safeFailure='FIXED_RESTART_CAUSE_DIAG_REJECTED');R.CORE.OPS.L.private_write(OUT/'failure-traceback.private.txt',traceback.format_exc().encode())
 finally:
  R.CORE.OPS.L.private_write(OUT/'first-result.json',R.enc(result));R.CORE.OPS.L.seal(OUT);public=dict(result,manifestSHA256=R.CORE.OPS.L.file_hash(OUT/'manifest.json'),resultSHA256=R.CORE.OPS.L.file_hash(OUT/'first-result.json'));need(len(R.enc(public))<=24000);print(R.enc(public).decode(),flush=True)
 return 0 if result['success']else 1

if __name__=='__main__':
 try:code=main()
 except BaseException:print('{"success":false,"safeFailure":"FIXED_RESTART_CAUSE_DIAG_PREFLIGHT_REJECTED"}',flush=True);code=1
 sys.exit(code)
