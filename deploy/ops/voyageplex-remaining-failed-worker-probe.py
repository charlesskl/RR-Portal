"""UNEXECUTED: all available sealed remaining samples; current 256 MiB worker, full parent and 32 MiB retained batch.

No production business/API/mailbox calls, credentials, database or live-container
changes. Only our labelled disposable containers and new private evidence files.
"""
import hashlib
import json
import os
import pathlib
import re
import subprocess
import threading
import time

ROOT = pathlib.Path('/opt/rr-portal')
MAIN = '4ec24b7b6d25836ee4ee702b57324764a856b83f'
IMAGE = 'sha256:acf9b3648f89dda8b7cc04e09071f0e7ba9e3e2722901bcd0c63c7e0cb57a7ca'
PARSER_CID = 'c9592d4248fd29e01ebfeade1ef7acc8237c43334c2efedf05f8c32201abab5b'
PROBE = ROOT/'deploy/backups/voyageplex-remaining-failed-body-probe-20261019'
RAW_PROBE_PIN_FROZEN = True
PROBE_RESULT_SHA = '14d5ea1604fbd780af6da33231ad6780cc53abb0b668bc61e806e8ccfc159fe7'  # Root freezes the exact forthcoming FETCH receipt after review.
PROBE_SEAL_SHA = '0cf2cfa3e0af785aff22d367c8c0b57a87f16751b8ef770df79c35d8a325573b'
OUTPUT = ROOT/'deploy/backups/voyageplex-remaining-failed-worker-probe-20261019'
RAW_INPUTS = OUTPUT/'raw-inputs'
FIXTURES = OUTPUT/'fixture'
LABEL = 'com.rr-portal.diagnostic=voyageplex-remaining-worker-20261019'
LIB_COMMIT = 'c94ea2e93f6ea81e24d409a188ff6fed31b35b07'
LIB_SHA = '59cec17eb70984e9b3b628c3c461f01cbf3358c1ffc46fe1c9a761a8c0d4b5ac'

FIXTURE = r'''
import collections, contextlib, hashlib, json, os, pathlib, resource, sys, threading, time
os.umask(0o077)
sys.path.insert(0,'/app') # Script lives in /diag; production child environment omits PYTHONPATH.
KINDS={'metadata','message_size','body_read','parse_memory','parse_timeout','parse_result_size','parse_process','parse_cancelled'}
TYPES={'MemoryError','TimeoutError','ValueError','OSError','RuntimeError','ImportError','ModuleNotFoundError','KeyError','TypeError','BadZipFile','XMLSyntaxError','ParseError','FileNotFoundError','CalledProcessError'}
SUFFIXES={'.xlsx','.xlsm','.xls','.pdf','.docx','.png','.jpg','.jpeg','.zip','.eml'}
STATS=None
def peak():
 for path in ['/sys/fs/cgroup/memory.peak','/sys/fs/cgroup/memory/memory.max_usage_in_bytes']:
  try:
   value=pathlib.Path(path).read_text().strip()
   if value.isdigit():return int(value)
  except OSError:pass
 return None
def worker(budget,round_index,company,filename):
 global STATS
 STATS=pathlib.Path('/tmp/worker-observation-%d.json'%round_index)
 import app.mail_worker as module
 if module.WORKER_ADDRESS_SPACE!=256*1024*1024 or module.WORKER_SECONDS!=18 or module.MAX_RESULT_BYTES!=1024*1024:raise ValueError()
 original=module._parse
 def observed(raw,name,company):
  import app.main as main
  parse=main.parse_attachment;counts=collections.Counter();types=collections.Counter();suffixes=collections.Counter();reserve=bytearray(65536)
  def wrapped(path,original_name):
   counts['attempts']+=1;suffix=pathlib.Path(original_name).suffix.lower();suffixes[suffix if suffix in SUFFIXES else 'other']+=1
   try:return parse(path,original_name)
   except BaseException as error:
    counts['failed']+=1;kind=type(error).__name__;types[kind if kind in TYPES else 'Other']+=1;raise
  main.parse_attachment=wrapped
  try:return original(raw,name,company)
  finally:
   del reserve
   try:
    with STATS.open('x') as out:json.dump({'attempts':counts['attempts'],'failed':counts['failed'],'exceptionTypes':dict(types),'suffixes':dict(suffixes)},out,separators=(',',':'))
   except BaseException:pass
 module._parse=observed
 raw=sys.stdin.buffer.read(module.MAX_RAW_BYTES+1)
 result=module.failed(filename,'parse_memory') if len(raw)>module.MAX_RAW_BYTES else module.supervise(raw,filename,company)
 # This output is a private PIPE captured by production parse_isolated, never
 # inherited container stdout. Its raw result is never printed by the driver.
 print(json.dumps(result,ensure_ascii=True,separators=(',',':')),flush=True)
def rss():
 for line in pathlib.Path('/proc/self/status').read_text().splitlines():
  if line.startswith('VmRSS:'):return int(line.split()[1])
 return None
def processes():
 return sum(1 for p in pathlib.Path('/proc').iterdir() if p.name.isdigit() and int(p.name)!=os.getpid())
def driver():
 started=time.monotonic();payload=json.load(sys.stdin);name=payload['rawName'];digest=payload['rawSHA256']
 if payload.get('budget')!=256 or not __import__('re').fullmatch('mail-[a-f0-9]{32}\\.eml',name):raise ValueError()
 sample=pathlib.Path('/samples')/name
 if sample.is_symlink() or sample.stat().st_size>25*1024*1024:raise ValueError()
 raw=sample.read_bytes()
 if hashlib.sha256(raw).hexdigest()!=digest:raise ValueError()
 expected={'mail_worker.py':'7acff1655025aab34fd904edb67b0e83008fad34a7ea3f09c2c63d676e6ad2d5','main.py':'b1e51021e95fab8931a6b3a4929def4ade59f5eb85c1fbe41ad5832d6a5731ac'}
 if any(hashlib.sha256((pathlib.Path('/app/app')/key).read_bytes()).hexdigest()!=value for key,value in expected.items()):raise ValueError()
 with open(os.devnull,'w') as null,contextlib.redirect_stdout(null),contextlib.redirect_stderr(null):
  import app.main as production_main
  import app.mail_worker as module
  if production_main.parse_isolated is not module.parse_isolated or module.WORKER_ADDRESS_SPACE!=256*1024*1024 or module.WORKER_SECONDS!=18 or module.MAX_RESULT_BYTES!=1024*1024:raise ValueError()
  # Non-email synthetic bytes are resident throughout both real-mail parses.
  batch=bytearray(32*1024*1024)
  for offset in range(0,len(batch),4096):batch[offset]=1
  touched=sum(batch[offset] for offset in range(0,len(batch),4096))
  parent_loaded=rss();rounds=[]
  for round_index in [1,2]:
   before=rss();case_started=time.monotonic()
   module.WORKER_COMMAND=[sys.executable,'/diag/fixture.py','worker','256',str(round_index)]
   result=production_main.parse_isolated(raw,'diagnostic.eml','Huadeng',threading.Event(),time.monotonic()+30)
   observation={};stats=pathlib.Path('/tmp/worker-observation-%d.json'%round_index)
   try:
    if stats.stat().st_size<=16384:observation=json.loads(stats.read_text())
   except (OSError,ValueError):pass
   status=result.get('status');kind=result.get('failure_kind');attachments=result.get('attachments');items=result.get('items')
   rounds.append({'round':round_index,'status':status if status in {'parsed','failed'} else 'Other','failureKind':kind if isinstance(kind,str) and kind in KINDS else 'other',
    'allBusinessAttachmentsUnparseable':result.get('error')=='邮件中的业务附件均无法解析',
    'observationAvailable':bool(observation),'attachmentAttempts':int(observation.get('attempts',0)),'attachmentFailures':int(observation.get('failed',0)),
    'attachmentSuffixCounts':{key:int(value) for key,value in observation.get('suffixes',{}).items() if key in SUFFIXES|{'other'} and type(value) is int and value>=0},
    'safeExceptionTypes':{key:int(value) for key,value in observation.get('exceptionTypes',{}).items() if key in TYPES|{'Other'} and type(value) is int and value>=0},
    'attachmentsCount':len(attachments) if isinstance(attachments,list) else None,'itemsCount':len(items) if isinstance(items,list) else 0,
    'topLevelFieldCount':len(result),'messageFieldCount':len(result.get('message')) if isinstance(result.get('message'),dict) else 0,
    'parsedItemFieldCounts':dict(collections.Counter(len(item) for item in items if isinstance(item,dict))) if isinstance(items,list) else {},
    'wallSeconds':round(time.monotonic()-case_started,3),'parentRSSBeforeKiB':before,'parentRSSAfterKiB':rss(),
    'reapedChildrenMaxRSSKiB':resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss,'otherProcessesAfterCleanup':processes()})
   del result
  output={'fullProductionMainImported':True,'syntheticBatchBytes':len(batch),'syntheticPagesTouched':touched,
   'syntheticBatchRetainedThroughoutBothRounds':touched==8192 and sum(batch[offset] for offset in range(0,len(batch),4096))==8192,
   'actualRawBytesRetainedAdditionally':len(raw),'parentLoadedRSSKiB':parent_loaded,'rounds':rounds,
   'parentFinalRSSKiB':rss(),'maxParentRSSKiB':resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
   'cgroupPeakBytesInside':peak(),'workerAddressSpaceMiB':256,'productionTimeAndResultLimitsUnchanged':True,
   'wallSeconds':round(time.monotonic()-started,3)}
 print(json.dumps(output,separators=(',',':'),ensure_ascii=True),flush=True)
if __name__=='__main__':
 try:
  if sys.argv[1:2]==['worker']:
   budget=int(sys.argv[2]);round_index=int(sys.argv[3]);company,filename=sys.argv[4:]
   if budget!=256 or round_index not in {1,2} or company!='Huadeng' or filename!='diagnostic.eml':raise ValueError()
   worker(budget,round_index,company,filename)
  elif sys.argv[1:]==['driver']:driver()
  else:raise ValueError()
 except BaseException:
  print('{"status":"failed","failureKind":"diagnostic_fixture"}',flush=True)
  raise SystemExit(1)
'''


def library():
    result=subprocess.run(['git','-C',str(ROOT),'show',LIB_COMMIT+':deploy/ops/voyageplex-mail-recovery.py'],
                          stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=10)
    if result.returncode or len(result.stdout)>262144 or hashlib.sha256(result.stdout).hexdigest()!=LIB_SHA:
        raise ValueError()
    lib={'__name__':'reviewed_recovery_library'};exec(compile(result.stdout,'reviewed-helper','exec'),lib);return lib


def guards(lib):
    lib['require'](RAW_PROBE_PIN_FROZEN and re.fullmatch('[a-f0-9]{64}',PROBE_RESULT_SHA) is not None and
                   re.fullmatch('[a-f0-9]{64}',PROBE_SEAL_SHA) is not None,'EXACT_RAW_PROBE_PINS_NOT_FROZEN')
    lib['require'](lib['command'](['git','-C',str(ROOT),'rev-parse','HEAD']).decode().strip()==MAIN,'FIXED_MAIN_REQUIRED')
    lib['verify_seal'](PROBE)
    lib['require'](lib['file_sha'](PROBE/'first-result.json')==PROBE_RESULT_SHA and
                   lib['file_sha'](PROBE/'seal.json')==PROBE_SEAL_SHA,'FIXED_SEALED_REMAINING_RAW_PROBE_REQUIRED')
    value=json.loads(lib['command'](['docker','inspect','--format','{"id":{{json .Id}},"image":{{json .Image}}}',PARSER_CID]))
    lib['require'](value=={'id':PARSER_CID,'image':IMAGE},'FIXED_CURRENT_PARSER_IMAGE_REQUIRED')


def samples(lib):
    manifest=lib['read_json'](PROBE/'seal.json');items=lib['read_json'](PROBE/'item-map.private.json')
    result=lib['read_json'](PROBE/'first-result.json');observations=result.get('items',[])
    lib['require'](result.get('source')==MAIN and result.get('completed') is True and
        result.get('priorResultsPreserved') is True and 0<len(items)<=11 and len(observations)==len(items),
        'BOUNDED_COMPLETED_RAW_PROBE_REQUIRED')
    chosen={};RAW_INPUTS.mkdir(mode=0o700)
    for item,observation in zip(items,observations):
        lib['require'](item.get('origin') in {'original-six','new-owner6'} and item.get('owner') in {2,3,5,6} and
            observation.get('owner')==item['owner'] and observation.get('origin')==item['origin'], 'RAW_SAMPLE_SCOPE_REQUIRED')
        if not observation.get('rawPrivateCopySaved'):continue
        name=item.get('rawName');digest=item.get('rawSHA256')
        lib['require'](isinstance(name,str) and re.fullmatch('mail-[a-f0-9]{32}\.eml',name) is not None and
            isinstance(digest,str) and re.fullmatch('[a-f0-9]{64}',digest) is not None,'SAFE_RAW_SAMPLE_REFERENCE')
        path=PROBE/name
        lib['require'](manifest.get(name)==digest and not path.is_symlink() and path.is_file() and
            path.stat().st_size==observation.get('actualRawLen')<=25*1024**2 and observation.get('rawFetchOK') is True and
            observation.get('literalLenMatched') is True and observation.get('metadataDateMatchesRecord') is True and
            lib['file_sha'](path)==digest,'SEALED_COMPLETE_RAW_SAMPLE_REQUIRED')
        if digest not in chosen:
            # The raw archive also holds a database snapshot/private metadata.
            # Stage only verified .eml bytes; never mount that archive into Docker.
            with path.open('rb') as source,(RAW_INPUTS/name).open('xb') as target:
                while True:
                    block=source.read(1024*1024)
                    if not block:break
                    target.write(block)
                target.flush();os.fsync(target.fileno())
            (RAW_INPUTS/name).chmod(0o600)
            lib['require'](lib['file_sha'](RAW_INPUTS/name)==digest,'STAGED_RAW_HASH_MATCH')
            chosen[digest]={'rawName':name,'rawSHA256':digest,'equivalentSourceSamples':0,'originCounts':{}}
        current=chosen[digest];current['equivalentSourceSamples']+=1
        current['originCounts'][item['origin']]=current['originCounts'].get(item['origin'],0)+1
    lib['require'](0<len(chosen)<=11,'AT_LEAST_ONE_SEALED_RAW_SAMPLE_REQUIRED')
    return list(chosen.values()),len(items)


def inspect_owned(lib,cid,name):
    template='{"id":{{json .Id}},"name":{{json .Name}},"label":{{json (index .Config.Labels "com.rr-portal.diagnostic")}},"running":{{json .State.Running}},"oomKilled":{{json .State.OOMKilled}},"exitCode":{{.State.ExitCode}},"hostPid":{{.State.Pid}}}'
    value=json.loads(lib['command'](['docker','inspect','--format',template,cid],seconds=4,cap=8192))
    lib['require'](value.get('id')==cid and value.get('name')=='/'+name and value.get('label')=='voyageplex-remaining-worker-20261019','OWN_DIAGNOSTIC_CONTAINER_ONLY')
    return value


def cgroup_sample(pid,cid):
    # Resolve only our exact created CID; never enumerate or print host paths.
    if type(pid) is not int or pid<=0:return None
    proc=pathlib.Path('/proc')/str(pid)/'cgroup'
    if proc.stat().st_size>16384:return None
    for line in proc.read_text()[:16384].splitlines():
        version,controllers,relative=line.split(':',2)
        if not re.fullmatch('/(?:system.slice/)?docker-'+cid+r'\.scope|/docker/'+cid,relative):continue
        v2=version=='0' and controllers==''
        if not v2 and 'memory' not in controllers.split(','):continue
        base=pathlib.Path('/sys/fs/cgroup')/('' if v2 else 'memory')/relative.lstrip('/')
        names={'current':'memory.current','peak':'memory.peak','limit':'memory.max'} if v2 else {'current':'memory.usage_in_bytes','peak':'memory.max_usage_in_bytes','limit':'memory.limit_in_bytes'}
        value={'version':2 if v2 else 1}
        for key,name in names.items():
            try:
                raw=(base/name).read_text().strip()
                if re.fullmatch('[0-9]{1,20}',raw):value[key]=int(raw)
            except OSError:pass
        if v2:
            try:
                for row in (base/'memory.events').read_text().splitlines():
                    key,number=row.split()
                    if key in {'low','high','max','oom','oom_kill','oom_group_kill'} and number.isdigit():value[key]=int(number)
            except OSError:pass
        return value
    return None


def run_case(lib,sample,index):
    name='rr-voyageplex-remaining-probe-20261019-s%d'%index;cid=None;started=time.monotonic();stop=threading.Event();monitor=None
    readings=[];result={'sampleIndex':index,'workerAddressSpaceMiB':256,'sourceOriginCounts':sample['originCounts'],
            'equivalentSourceSamples':sample['equivalentSourceSamples'],'completed':False,'cleanupVerified':False}
    def sample_memory():
        while not stop.is_set():
            try:
                state=inspect_owned(lib,cid,name)
                reading=cgroup_sample(state.get('hostPid'),cid) if state.get('running') else None
                if reading is not None:readings.append(reading)
            except Exception:pass
            stop.wait(.1)
    try:
        cid=lib['command'](['docker','create','-i','--name',name,'--label',LABEL,'--network','none',
             '--memory','512m','--memory-swap','512m','--pids-limit','128','--cpus','2',
             '--cap-drop','ALL','--security-opt','no-new-privileges',
             '--mount','type=bind,src='+str(RAW_INPUTS)+',dst=/samples,readonly',
             '--mount','type=bind,src='+str(FIXTURES)+',dst=/diag,readonly',
             '--entrypoint','python',IMAGE,'/diag/fixture.py','driver'],seconds=10,cap=128).decode().strip()
        lib['require'](re.fullmatch('[a-f0-9]{64}',cid) is not None,'CREATED_DIAGNOSTIC_ID_REQUIRED')
        lib['write_new'](OUTPUT/('container-%d.private.json'%index),{'id':cid,'name':name,'image':IMAGE})
        inspect_owned(lib,cid,name);monitor=threading.Thread(target=sample_memory,daemon=True);monitor.start()
        remaining=75-(time.monotonic()-started)-14;lib['require'](remaining>0,'CASE_DEADLINE')
        value=json.loads(lib['command'](['docker','start','-ai',cid],seconds=remaining,cap=16384,stdin=lib['encoded']({**sample,'budget':256})))
        allowed={'fullProductionMainImported','syntheticBatchBytes','syntheticPagesTouched','syntheticBatchRetainedThroughoutBothRounds',
                 'actualRawBytesRetainedAdditionally','parentLoadedRSSKiB','rounds','parentFinalRSSKiB','maxParentRSSKiB',
                 'cgroupPeakBytesInside','workerAddressSpaceMiB','productionTimeAndResultLimitsUnchanged','wallSeconds'}
        lib['require'](isinstance(value,dict) and set(value)==allowed and len(value['rounds'])==2,'SAFE_FULL_PARENT_SUMMARY_SHAPE')
        result.update({'summary':value,'completed':True})
    except Exception:
        result['safeFailure']='FULL_PARENT_ISOLATED_CASE_DID_NOT_COMPLETE'
    finally:
        stop.set()
        if monitor:monitor.join(timeout=5)
        result['hostCgroupMemory']={'samples':len(readings),'version':readings[-1]['version'] if readings else None,
            'maxSampledCurrentBytes':max((r.get('current',0) for r in readings),default=None),
            'kernelPeakBytes':max((r['peak'] for r in readings if 'peak' in r),default=None),
            'limitBytes':readings[-1].get('limit') if readings else None,
            'oomEvents':max((r.get('oom',0) for r in readings),default=None),'oomKillEvents':max((r.get('oom_kill',0) for r in readings),default=None)}
        if cid and re.fullmatch('[a-f0-9]{64}',cid):
            state=inspect_owned(lib,cid,name);result['containerState']={key:state[key] for key in ['running','oomKilled','exitCode']}
            lib['command'](['docker','rm','-f',cid],seconds=4,cap=256);result['cleanupVerified']=True
        result['caseWallSeconds']=round(time.monotonic()-started,3)
    return result


def main():
    if os.environ.get('MAILDIAG_BRANCH')!='refs/heads/ops/voyageplex-maildiag-20261019' or os.environ.get('MAILDIAG_ATTEMPT')!='1':raise ValueError()
    lib=library();guards(lib)
    os.umask(0o077);OUTPUT.mkdir(mode=0o700);FIXTURES.mkdir(mode=0o700)
    selected,original_count=samples(lib);deadline=time.monotonic()+15*60
    with (FIXTURES/'fixture.py').open('x') as out:out.write(FIXTURE)
    (FIXTURES/'fixture.py').chmod(0o600);lib['write_new'](OUTPUT/'sample-map.private.json',selected)
    result={'source':MAIN,'productionImageUnmodified':True,'productionLimitsUnchanged':True,'network':'none',
            'originalSelectedSources':original_count,'availableRawSources':sum(s['equivalentSourceSamples'] for s in selected),
            'allSelectedSourcesHadSealedRaw':sum(s['equivalentSourceSamples'] for s in selected)==original_count,
            'uniqueRawSamples':len(selected),'rawDatabaseAndMetadataMountedIntoDocker':False,'cases':[]}
    try:
        for index,sample in enumerate(selected,1):
            if time.monotonic()>deadline-80:break
            value=run_case(lib,sample,index);result['cases'].append(value)
            lib['write_new'](OUTPUT/('case-%d-256.json'%index),value)
    finally:
        result['allAvailableSamplesDiagnosed']=len(result['cases'])==len(selected) and all(c['completed'] for c in result['cases'])
        result['allSelectedSourcesDiagnosed']=result['allSelectedSourcesHadSealedRaw'] and result['allAvailableSamplesDiagnosed']
        lib['write_new'](OUTPUT/'first-result.json',result);lib['seal'](OUTPUT);guards(lib);lib['emit'](result)
        lib['emit']({'kind':'receipt','resultPath':str(OUTPUT/'first-result.json'),'resultSHA256':lib['file_sha'](OUTPUT/'first-result.json'),
                     'sealSHA256':lib['file_sha'](OUTPUT/'seal.json')})


if __name__=='__main__':
    try:main()
    except Exception:
        print('{"failed":true,"reason":"REDACTED_FULL_PARENT_WORKER_DIAGNOSIS_FAILURE","businessWrites":false}',flush=True)
        raise SystemExit(1)
