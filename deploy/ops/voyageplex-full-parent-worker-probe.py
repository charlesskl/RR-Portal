"""UNEXECUTED: full production parent plus 32 MiB retained synthetic batch, 256 MiB worker twice.

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
MAIN = '53f482f4b71fc0fd4c6696e9ec4b2058e6a342bc'
IMAGE = 'sha256:d7550280bafd7731943d81218d9db35faf68d96c6987af863bdc36327be19614'
PROBE = ROOT / 'deploy/backups/voyageplex-failed-body-probe-20261019'
PROBE_RESULT_SHA = 'de98df09f66406be772f091e834d85df4d920bd86fc3a732e714f1d5d6c39f59'
PROBE_SEAL_SHA = '2d82a226ea6801d933f0167a27aecfb689ff12419f8ded2975649c1497523116'
FIRST_WORKER = ROOT / 'deploy/backups/voyageplex-isolated-worker-probe-20261019'
FIRST_WORKER_RESULT_SHA = '664e2c0f75d046ace4f68de27cd758680c7f39a594a835c52ec52f1c52ce1e4d'
FIRST_WORKER_SEAL_SHA = '7012bd618fbec99fc62a7a007a8507f38ea8096e72b82980d3742af5cdbaa6fb'
OUTPUT = ROOT / 'deploy/backups/voyageplex-full-parent-worker-probe-20261019'
LABEL = 'com.rr-portal.diagnostic=voyageplex-full-parent-worker-20261019'
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
 module.WORKER_ADDRESS_SPACE=budget*1024*1024
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
 expected={'mail_worker.py':'ce2ffce53b81224a636d6bc15a1789b7744f0246043b8dc431b7f46a92383407','main.py':'37f22c5ac2fc3b22f4d93e5085b08d2046f91c5cbf2def0ea233ac2385429408'}
 if any(hashlib.sha256((pathlib.Path('/app/app')/key).read_bytes()).hexdigest()!=value for key,value in expected.items()):raise ValueError()
 with open(os.devnull,'w') as null,contextlib.redirect_stdout(null),contextlib.redirect_stderr(null):
  import app.main as production_main
  import app.mail_worker as module
  if production_main.parse_isolated is not module.parse_isolated or module.WORKER_SECONDS!=18 or module.MAX_RESULT_BYTES!=1024*1024:raise ValueError()
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
    lib['require'](lib['command'](['git','-C',str(ROOT),'rev-parse','HEAD']).decode().strip()==MAIN,'FIXED_MAIN_REQUIRED')
    lib['verify_seal'](PROBE)
    lib['require'](lib['file_sha'](PROBE/'first-result.json')==PROBE_RESULT_SHA and
                   lib['file_sha'](PROBE/'seal.json')==PROBE_SEAL_SHA,'FIXED_SEALED_RAW_PROBE_REQUIRED')
    lib['verify_seal'](FIRST_WORKER)
    lib['require'](lib['file_sha'](FIRST_WORKER/'first-result.json')==FIRST_WORKER_RESULT_SHA and
                   lib['file_sha'](FIRST_WORKER/'seal.json')==FIRST_WORKER_SEAL_SHA,'FIXED_FIRST_WORKER_RESULT_REQUIRED')
    live=lib['command'](['docker','inspect','--format','{{.Image}}','rr-portal-voyageplex-parser-1']).decode().strip()
    lib['require'](live==IMAGE,'FIXED_CURRENT_PARSER_IMAGE_REQUIRED')


def samples(lib):
    manifest=lib['read_json'](PROBE/'seal.json');items=lib['read_json'](PROBE/'item-map.private.json')
    chosen={}
    selected=[item for item in items if item.get('failureKind')=='other' and item.get('allBusinessAttachmentsUnparseable') is True]
    lib['require'](len(selected)==2,'EXACT_TWO_ATTACHMENT_FAILURE_SAMPLES_REQUIRED')
    for item in selected:
        name=item.get('rawName');lib['require'](isinstance(name,str) and re.fullmatch('mail-[a-f0-9]{32}\\.eml',name) is not None,'SAFE_RAW_NAME')
        path=PROBE/name;digest=manifest.get(name)
        lib['require'](not path.is_symlink() and path.is_file() and path.stat().st_size<=25*1024**2 and
                       isinstance(digest,str) and re.fullmatch('[a-f0-9]{64}',digest) is not None and lib['file_sha'](path)==digest,'SEALED_RAW_SHA_REQUIRED')
        if digest not in chosen:chosen[digest]={'rawName':name,'rawSHA256':digest,'equivalentSourceSamples':0}
        chosen[digest]['equivalentSourceSamples']+=1
    return list(chosen.values())


def inspect_owned(lib,cid,name):
    template='{"id":{{json .Id}},"name":{{json .Name}},"label":{{json (index .Config.Labels "com.rr-portal.diagnostic")}},"running":{{json .State.Running}},"oomKilled":{{json .State.OOMKilled}},"exitCode":{{.State.ExitCode}},"hostPid":{{.State.Pid}}}'
    value=json.loads(lib['command'](['docker','inspect','--format',template,cid],seconds=4,cap=8192))
    lib['require'](value.get('id')==cid and value.get('name')=='/'+name and value.get('label')=='voyageplex-full-parent-worker-20261019','OWN_DIAGNOSTIC_CONTAINER_ONLY')
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
    name='rr-voyageplex-full-parent-probe-20261019-s%d'%index;cid=None;started=time.monotonic();stop=threading.Event();monitor=None
    readings=[];result={'sampleIndex':index,'workerAddressSpaceMiB':256,'completed':False,'cleanupVerified':False}
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
             '--mount','type=bind,src='+str(PROBE)+',dst=/samples,readonly',
             '--mount','type=bind,src='+str(OUTPUT)+',dst=/diag,readonly',
             '--entrypoint','python',IMAGE,'/diag/fixture.py','driver'],seconds=10,cap=128).decode().strip()
        lib['require'](re.fullmatch('[a-f0-9]{64}',cid) is not None,'CREATED_DIAGNOSTIC_ID_REQUIRED')
        lib['write_new'](OUTPUT/('container-%d.private.json'%index),{'id':cid,'name':name,'image':IMAGE})
        inspect_owned(lib,cid,name);monitor=threading.Thread(target=sample_memory,daemon=True);monitor.start()
        remaining=120-(time.monotonic()-started)-14;lib['require'](remaining>0,'CASE_DEADLINE')
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
    lib=library();guards(lib);selected=samples(lib)
    os.umask(0o077);OUTPUT.mkdir(mode=0o700)
    with (OUTPUT/'fixture.py').open('x') as out:out.write(FIXTURE)
    (OUTPUT/'fixture.py').chmod(0o600);lib['write_new'](OUTPUT/'sample-map.private.json',selected)
    result={'source':MAIN,'productionImageUnmodified':True,'productionLimitsUnchanged':True,'network':'none',
            'originalSamples':2,'uniqueRawSamples':len(selected),'cases':[]}
    try:
        for index,sample in enumerate(selected,1):
            value=run_case(lib,sample,index);result['cases'].append(value)
            lib['write_new'](OUTPUT/('case-%d-256.json'%index),value)
    finally:
        lib['write_new'](OUTPUT/'first-result.json',result);lib['seal'](OUTPUT);guards(lib);lib['emit'](result)
        lib['emit']({'kind':'receipt','resultPath':str(OUTPUT/'first-result.json'),'resultSHA256':lib['file_sha'](OUTPUT/'first-result.json'),
                     'sealSHA256':lib['file_sha'](OUTPUT/'seal.json')})


if __name__=='__main__':
    try:main()
    except Exception:
        print('{"failed":true,"reason":"REDACTED_FULL_PARENT_WORKER_DIAGNOSIS_FAILURE","businessWrites":false}',flush=True)
        raise SystemExit(1)
