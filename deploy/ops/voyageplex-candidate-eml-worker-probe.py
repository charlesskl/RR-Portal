"""UNEXECUTED: sealed raw samples, candidate EML only, full parent in owned 512MiB/noSwap containers.

Production code, caps, mailboxes, databases, sessions and containers are untouched.
Only staged EML/fixture files are mounted into our labelled disposable containers.
"""
import hashlib
import json
import os
import pathlib
import re
import subprocess
import threading
import time

ROOT=pathlib.Path('/opt/rr-portal')
MAIN='4ec24b7b6d25836ee4ee702b57324764a856b83f'
IMAGE='sha256:acf9b3648f89dda8b7cc04e09071f0e7ba9e3e2722901bcd0c63c7e0cb57a7ca'
PARSER_CID='c9592d4248fd29e01ebfeade1ef7acc8237c43334c2efedf05f8c32201abab5b'
PROBE_PIN_FROZEN=True  # Root enables only after reviewing both raw receipts and candidate source.
OUTPUT=ROOT/'deploy/backups/voyageplex-candidate-eml-worker-probe-20261019'
RAW_INPUTS=OUTPUT/'raw-inputs'
FIXTURES=OUTPUT/'fixture'
LABEL='com.rr-portal.diagnostic=voyageplex-candidate-eml-worker-20261019'
LIB_COMMIT='c94ea2e93f6ea81e24d409a188ff6fed31b35b07'
LIB_SHA='59cec17eb70984e9b3b628c3c461f01cbf3358c1ffc46fe1c9a761a8c0d4b5ac'
CANDIDATE_EML_PATH='deploy/ops/voyageplex-candidate-eml.py'
CANDIDATE_EML_SHA='72a1d04812db00f8ba78a8ce5deb9ac49e60b89cadd81a8f8f44cf8eb94aca28'
CANDIDATE_ATTACHMENTS_PATH='deploy/ops/voyageplex-candidate-attachments.py'
CANDIDATE_ATTACHMENTS_SHA='419c94c5882f84960f16e8a643d747bb5697355eae2524084fbaf50dbca2b93d'
VARIANTS=('eml-only','eml-merge')
OLD_WORKER_SHA='7acff1655025aab34fd904edb67b0e83008fad34a7ea3f09c2c63d676e6ad2d5'
CANDIDATE_WORKER_SHA='b4c3059b4d98057fc0c06e01eaffda175ba135f3022ad2bebb884d9c0bfafd53'
APP='apps/船务部/VoyagePlex船务协同系统/services/email-parser/app/'
BASELINE=ROOT/'deploy/backups/voyageplex-remaining-failed-worker-probe-20261019'
BASELINE_RESULT_SHA='cc63489345b02332fe226c31d28998257edf59bd142c27c2bc9eeeef24893952'
BASELINE_SEAL_SHA='1bb687f4cdb38bd6c9fa3c8ebd41b6e37a14a58a027333cdfc5b382a96a1d8c2'
RAW_ARCHIVES=[
 (ROOT/'deploy/backups/voyageplex-original-large-body-probe-20261019',
  'd41155ea43634995fbdc942748d17dd3ee5b0d99f9c532c34e5f375489d26d7a','7d50b2eb9f1b3c434e5ec208f74d6ec57d267b08e48e007af6367713fac41f46','original-six-large'),
 (ROOT/'deploy/backups/voyageplex-remaining-failed-body-probe-20261019',
  '14d5ea1604fbd780af6da33231ad6780cc53abb0b668bc61e806e8ccfc159fe7','0cf2cfa3e0af785aff22d367c8c0b57a87f16751b8ef770df79c35d8a325573b','new-owner6')]

FIXTURE = r'''
"""Disposable fixture only: no real credentials or database paths."""
import collections, contextlib, hashlib, json, os, pathlib, re, resource, sys, threading, time, urllib.request
os.umask(0o077)
sys.path.insert(0,'/app')
KINDS={'metadata','message_size','body_read','parse_memory','parse_timeout','parse_result_size','parse_process','parse_cancelled'}
TYPES={'MemoryError','TimeoutError','ValueError','OSError','RuntimeError','ImportError','ModuleNotFoundError','KeyError','TypeError','BadZipFile','XMLSyntaxError','ParseError','FileNotFoundError','CalledProcessError','Other'}
SUFFIXES={'.xlsx','.xlsm','.xls','.pdf','.docx','.png','.jpg','.jpeg','.zip','.eml','other'}
STAGES={'import-main','mail-pipeline','mime','attachment','workbook-read-only','workbook-full','workbook-other','parse-complete'}
MODES={'read-only','full','other'}
EXPECTED={'mail_worker.py':'b4c3059b4d98057fc0c06e01eaffda175ba135f3022ad2bebb884d9c0bfafd53','main.py':'b1e51021e95fab8931a6b3a4929def4ade59f5eb85c1fbe41ad5832d6a5731ac','eml.py':'72a1d04812db00f8ba78a8ce5deb9ac49e60b89cadd81a8f8f44cf8eb94aca28'}

def rss():
 for line in pathlib.Path('/proc/self/status').read_text().splitlines():
  if line.startswith('VmRSS:'):return int(line.split()[1])
 return None

def peak():
 for path in ['/sys/fs/cgroup/memory.peak','/sys/fs/cgroup/memory/memory.max_usage_in_bytes']:
  try:
   value=pathlib.Path(path).read_text().strip()
   if value.isdigit():return int(value)
  except OSError:pass
 return None

def processes():
 return sum(1 for path in pathlib.Path('/proc').iterdir() if path.name.isdigit() and int(path.name)!=os.getpid())

def kind(error):
 value=type(error).__name__
 return value if value in TYPES else 'Other'

def worker(round_index,company,filename):
 import app.mail_worker as module
 if module.WORKER_ADDRESS_SPACE!=256*1024*1024 or module.MAX_RAW_BYTES!=40*1024*1024 or module.WORKER_SECONDS!=18 or module.MAX_RESULT_BYTES!=1024*1024:raise ValueError()
 original=module._parse
 def observed(raw,name,company):
  observation={'lastComponentStage':'import-main','componentRSSPeaksKiB':{},'attachmentAttempts':0,'attachmentFailures':0,
    'exceptionTypes':{},'suffixCounts':{},'workbookLoadModeCounts':{},'workbookExceptionTypeCounts':{},'topExceptionType':None}
  reserve=bytearray(65536)
  def stage(value):
   observation['lastComponentStage']=value
   current=rss()
   if current is not None:observation['componentRSSPeaksKiB'][value]=max(current,observation['componentRSSPeaksKiB'].get(value,0))
  def exception(error):
   token=kind(error);observation['exceptionTypes'][token]=observation['exceptionTypes'].get(token,0)+1
  try:
   stage('import-main');import app.main as main
   import openpyxl
   parse_mime=main.parse_eml;parse_attachment=main.parse_attachment;load=openpyxl.load_workbook
   def mime(*args,**kwargs):
    stage('mime')
    try:value=parse_mime(*args,**kwargs)
    except BaseException as error:exception(error);raise
    else:stage('mail-pipeline');return value
    finally:
     current=rss()
     if current is not None:observation['componentRSSPeaksKiB']['mime']=max(current,observation['componentRSSPeaksKiB'].get('mime',0))
   def attachment(path,name):
    stage('attachment');observation['attachmentAttempts']+=1
    suffix=pathlib.Path(name).suffix.lower();suffix=suffix if suffix in SUFFIXES else 'other'
    observation['suffixCounts'][suffix]=observation['suffixCounts'].get(suffix,0)+1
    try:value=parse_attachment(path,name)
    except BaseException as error:observation['attachmentFailures']+=1;exception(error);raise
    else:stage('mail-pipeline');return value
   def workbook(*args,**kwargs):
    readonly=kwargs.get('read_only',False);mode='read-only' if readonly is True else 'full' if readonly is False else 'other'
    prior=observation['lastComponentStage'];stage('workbook-'+mode)
    observation['workbookLoadModeCounts'][mode]=observation['workbookLoadModeCounts'].get(mode,0)+1
    try:value=load(*args,**kwargs)
    except BaseException as error:
     buckets=observation['workbookExceptionTypeCounts'].setdefault(mode,{})
     token=kind(error);buckets[token]=buckets.get(token,0)+1;exception(error);raise
    else:stage(prior);return value
   main.parse_eml=mime;main.parse_attachment=attachment;openpyxl.load_workbook=workbook
   stage('mail-pipeline');value=original(raw,name,company);stage('parse-complete');return value
  except BaseException as error:
   observation['topExceptionType']=kind(error);raise
  finally:
   del reserve
   observation['parseChildMaxRSSKiB']=resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
   try:
    with pathlib.Path('/tmp/worker-observation-%d.json'%round_index).open('x') as out:json.dump(observation,out,separators=(',',':'))
   except BaseException:pass
 module._parse=observed
 raw=sys.stdin.buffer.read(module.MAX_RAW_BYTES+1)
 value=module.failed(filename,'parse_memory') if len(raw)>module.MAX_RAW_BYTES else module.supervise(raw,filename,company)
 print(json.dumps(value,ensure_ascii=True,separators=(',',':')),flush=True)

def observation(round_index):
 path=pathlib.Path('/tmp/worker-observation-%d.json'%round_index)
 try:
  if path.stat().st_size>16384:raise ValueError()
  value=json.loads(path.read_text())
 except (OSError,ValueError):return {'observationAvailable':False}
 def counts(value,allowed):
  return {key:number for key,number in value.items() if key in allowed and type(number) is int and number>=0} if isinstance(value,dict) else {}
 return {'observationAvailable':True,'lastComponentStage':value.get('lastComponentStage') if value.get('lastComponentStage') in STAGES else 'other',
  'componentRSSPeaksKiB':counts(value.get('componentRSSPeaksKiB'),STAGES),
  'attachmentAttempts':max(0,int(value.get('attachmentAttempts',0))),'attachmentFailures':max(0,int(value.get('attachmentFailures',0))),
  'safeExceptionTypes':counts(value.get('exceptionTypes'),TYPES),'attachmentSuffixCounts':counts(value.get('suffixCounts'),SUFFIXES),
  'workbookLoadModeCounts':counts(value.get('workbookLoadModeCounts'),MODES),
  'workbookExceptionTypeCounts':{mode:counts(bucket,TYPES) for mode,bucket in value.get('workbookExceptionTypeCounts',{}).items() if mode in MODES},
  'topExceptionType':value.get('topExceptionType') if value.get('topExceptionType') in TYPES else None,
  'parseChildMaxRSSKiB':max(0,int(value.get('parseChildMaxRSSKiB',0)))}

def driver():
 started=time.monotonic();payload=json.load(sys.stdin);name=payload['rawName'];digest=payload['rawSHA256']
 if payload.get('budget')!=256 or not re.fullmatch('mail-[a-f0-9]{32}\\.eml',name) or not re.fullmatch('[a-f0-9]{64}',digest):raise ValueError()
 variant=payload.get('variant')
 if variant not in {'eml-only','eml-merge'}:raise ValueError()
 expected_attachments='cbe8a468e0f98252866a2eb0034bdfadbcf5906fa06152d2e3293227ff9428fe' if variant=='eml-only' else '419c94c5882f84960f16e8a643d747bb5697355eae2524084fbaf50dbca2b93d'
 expected={**EXPECTED,'attachments.py':expected_attachments}
 sample=pathlib.Path('/samples')/name
 if sample.is_symlink() or not 0<sample.stat().st_size<=40*1024*1024:raise ValueError()
 raw=sample.read_bytes()
 if hashlib.sha256(raw).hexdigest()!=digest:raise ValueError()
 if any(hashlib.sha256((pathlib.Path('/app/app')/key).read_bytes()).hexdigest()!=value for key,value in expected.items()):raise ValueError()
 with open(os.devnull,'w') as null,contextlib.redirect_stdout(null),contextlib.redirect_stderr(null):
  import app.main as production_main
  import app.mail_worker as module
  import uvicorn
  if production_main.parse_isolated is not module.parse_isolated or module.WORKER_ADDRESS_SPACE!=256*1024*1024 or module.MAX_RAW_BYTES!=40*1024*1024 or module.WORKER_SECONDS!=18 or module.MAX_RESULT_BYTES!=1024*1024:raise ValueError()
  batch=bytearray(48*1024*1024)
  for offset in range(0,len(batch),4096):batch[offset]=1
  touched=sum(batch[offset] for offset in range(0,len(batch),4096));parent_loaded=rss()
  config=uvicorn.Config(production_main.app,host='127.0.0.1',port=18894,loop='asyncio',lifespan='off',access_log=False,log_config=None,log_level='critical')
  server=uvicorn.Server(config);server_thread=threading.Thread(target=server.run,daemon=True)
  opener=urllib.request.build_opener(urllib.request.ProxyHandler({}));health_stop=threading.Event();health=[];rounds=[]
  def health_once():
   start=time.monotonic();passed=False
   try:
    with opener.open('http://127.0.0.1:18894/health',timeout=1) as response:
     passed=response.status==200 and json.loads(response.read(1024)).get('status')=='ok'
   except Exception:pass
   return (passed,round(time.monotonic()-start,4))
  def health_loop():
   while not health_stop.is_set():health.append(health_once());health_stop.wait(.2)
  health_thread=threading.Thread(target=health_loop,daemon=True)
  server_thread.start()
  try:
   ready=time.monotonic()+5
   while time.monotonic()<ready:
    if health_once()[0]:break
    time.sleep(.05)
   else:raise ValueError()
   health_thread.start()
   for round_index in [1,2]:
    before=rss();case_started=time.monotonic()
    module.WORKER_COMMAND=[sys.executable,'/diag/fixture.py','worker',str(round_index)]
    result=production_main.parse_isolated(raw,'diagnostic.eml','Huadeng',threading.Event(),time.monotonic()+30)
    status=result.get('status');failure=result.get('failure_kind');items=result.get('items');attachments=result.get('attachments')
    rounds.append({'round':round_index,'status':status if status in {'parsed','failed'} else 'other','failureKind':failure if failure in KINDS else 'other',
     'allBusinessAttachmentsUnparseable':result.get('error')=='邮件中的业务附件均无法解析',
     'attachmentsCount':len(attachments) if isinstance(attachments,list) else None,'itemsCount':len(items) if isinstance(items,list) else 0,
     'wallSeconds':round(time.monotonic()-case_started,3),'parentRSSBeforeKiB':before,'parentRSSAfterKiB':rss(),
     'reapedChildrenMaxRSSKiB':resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss,'otherProcessesAfterCleanup':processes(),**observation(round_index)})
    del result
   module.WORKER_COMMAND=[sys.executable,'/diag/fixture.py','worker','3']
   normal=production_main.parse_isolated(b'From: fixture@example.invalid\r\nSubject: Synthetic health fixture\r\n\r\nSynthetic normal message.','diagnostic.eml','Huadeng',threading.Event(),time.monotonic()+30)
   next_normal=normal.get('status')=='parsed';del normal
   final_health=health_once()[0]
  finally:
   health_stop.set()
   if health_thread.is_alive():health_thread.join(timeout=3)
   server.should_exit=True;server_thread.join(timeout=5)
  output={'variant':variant,'fullProductionMainImported':True,'syntheticBatchBytes':len(batch),'syntheticPagesTouched':touched,
   'syntheticBatchRetainedThroughoutBothRounds':touched==12288 and sum(batch[offset] for offset in range(0,len(batch),4096))==12288,
   'actualRawBytesRetainedAdditionally':len(raw),'parentLoadedRSSKiB':parent_loaded,'rounds':rounds,
   'parentFinalRSSKiB':rss(),'maxParentRSSKiB':resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,'cgroupPeakBytesInside':peak(),
   'workerAddressSpaceMiB':256,'productionTimeAndResultLimitsUnchanged':True,'nextNormalEmailParsed':next_normal,
   'nextHealthPassed':final_health,'healthSamples':len(health),'healthFailures':sum(not item[0] for item in health),
   'maxHealthLatencySeconds':max((item[1] for item in health),default=None),'otherProcessesAfterFinalCleanup':processes(),
   'ownHealthServerStopped':not server_thread.is_alive(),'wallSeconds':round(time.monotonic()-started,3)}
 print(json.dumps(output,separators=(',',':'),ensure_ascii=True),flush=True)

if __name__=='__main__':
 try:
  if sys.argv[1:2]==['worker']:
   round_index=int(sys.argv[2]);company,filename=sys.argv[3:]
   if round_index not in {1,2,3} or company!='Huadeng' or filename!='diagnostic.eml':raise ValueError()
   worker(round_index,company,filename)
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
    lib['require'](PROBE_PIN_FROZEN and re.fullmatch('[a-f0-9]{64}',CANDIDATE_EML_SHA) is not None,
                   'EXACT_CANDIDATE_RAW_AND_RUNTIME_GATES_NOT_FROZEN')
    lib['require'](lib['command'](['git','-C',str(ROOT),'rev-parse','HEAD']).decode().strip()==MAIN,'FIXED_4EC_BASELINE_REQUIRED')
    for directory,result_sha,seal_sha in [(BASELINE,BASELINE_RESULT_SHA,BASELINE_SEAL_SHA)]+[(path,result,seal) for path,result,seal,_ in RAW_ARCHIVES]:
        lib['require'](re.fullmatch('[a-f0-9]{64}',result_sha) is not None and re.fullmatch('[a-f0-9]{64}',seal_sha) is not None,'FROZEN_RECEIPT_HASHES_REQUIRED')
        lib['verify_seal'](directory)
        lib['require'](lib['file_sha'](directory/'first-result.json')==result_sha and lib['file_sha'](directory/'seal.json')==seal_sha,'EXACT_SEALED_BASELINE_AND_RAW_RECEIPTS_REQUIRED')
    value=json.loads(lib['command'](['docker','inspect','--format','{"id":{{json .Id}},"image":{{json .Image}}}',PARSER_CID]))
    lib['require'](value=={'id':PARSER_CID,'image':IMAGE},'FIXED_CURRENT_PARSER_IMAGE_REQUIRED')
    for path,digest in [('mail_worker.py',OLD_WORKER_SHA),('eml.py','dbecbddc59821892a3d3927a516daa6cb82d5e3d9ad454cbe9faa22d5c308c4a'),('main.py','b1e51021e95fab8931a6b3a4929def4ade59f5eb85c1fbe41ad5832d6a5731ac'),('attachments.py','cbe8a468e0f98252866a2eb0034bdfadbcf5906fa06152d2e3293227ff9428fe')]:
        lib['require'](lib['command'](['docker','exec',PARSER_CID,'sha256sum','/app/app/'+path],seconds=5,cap=256).decode().split()[0]==digest,'FIXED_PRODUCTION_PARSER_SOURCE_REQUIRED')


def git_source(lib,ref,path):
    lib['require'](re.fullmatch('[a-f0-9]{40}',ref) is not None,'FIXED_SOURCE_REF_REQUIRED')
    return lib['command'](['git','-C',str(ROOT),'show',ref+':'+path],seconds=10,cap=262144)


def make_fixtures(lib):
    eml=git_source(lib,os.environ.get('MAILDIAG_REF',''),CANDIDATE_EML_PATH)
    attachments=git_source(lib,os.environ.get('MAILDIAG_REF',''),CANDIDATE_ATTACHMENTS_PATH)
    lib['require'](hashlib.sha256(attachments).hexdigest()==CANDIDATE_ATTACHMENTS_SHA,'EXACT_CANDIDATE_MERGE_SOURCE')
    worker=git_source(lib,MAIN,APP+'mail_worker.py')
    lib['require'](hashlib.sha256(eml).hexdigest()==CANDIDATE_EML_SHA and hashlib.sha256(worker).hexdigest()==OLD_WORKER_SHA,'EXACT_CANDIDATE_AND_BASE_WORKER_SOURCES')
    before=b'MAX_RAW_BYTES = 25 * 1024 * 1024';after=b'MAX_RAW_BYTES = 40 * 1024 * 1024'
    lib['require'](worker.count(before)==1,'EXACT_ONE_RAW_CAP_LINE_REQUIRED')
    worker=worker.replace(before,after)
    lib['require'](hashlib.sha256(worker).hexdigest()==CANDIDATE_WORKER_SHA,'ONLY_RAW_CAP_OVERLAY_CHANGED')
    for name,raw in [('eml.py',eml),('mail_worker.py',worker),('attachments.py',attachments),('fixture.py',FIXTURE.encode())]:
        with (FIXTURES/name).open('xb') as out:out.write(raw);out.flush();os.fsync(out.fileno())
        (FIXTURES/name).chmod(0o600)
    lib['write_new'](OUTPUT/'candidate-sources.private.json',{'ref':os.environ['MAILDIAG_REF'],'emlSHA256':CANDIDATE_EML_SHA,
        'attachmentsSHA256':CANDIDATE_ATTACHMENTS_SHA,'oldWorkerSHA256':OLD_WORKER_SHA,'workerOverlaySHA256':CANDIDATE_WORKER_SHA,'onlyWorkerRawCapChanged':True})


def samples(lib):
    chosen={};source_count=0;RAW_INPUTS.mkdir(mode=0o700)
    for archive,_,_,origin in RAW_ARCHIVES:
        manifest=lib['read_json'](archive/'seal.json');items=lib['read_json'](archive/'item-map.private.json')
        result=lib['read_json'](archive/'first-result.json');observations=result.get('items',[])
        lib['require'](result.get('source')==MAIN and result.get('completed') is True and result.get('priorResultsPreserved') is True and
            isinstance(items,list) and len(items)<=11 and len(observations)==len(items),'BOUNDED_COMPLETED_RAW_ARCHIVE_REQUIRED')
        scope=[(item,observed) for item,observed in zip(items,observations) if item.get('origin')==origin]
        expected=[2,2,3,3,5,5] if origin=='original-six-large' else [6,6]
        lib['require'](sorted(item.get('owner') for item,_ in scope)==expected,'EXACT_EIGHT_ORIGINAL_AND_OWNER6_SOURCES_REQUIRED')
        for item,observation in scope:
            source_count+=1;name=item.get('rawName');digest=item.get('rawSHA256')
            lib['require'](observation.get('owner')==item['owner'] and observation.get('origin')==origin and
                isinstance(name,str) and re.fullmatch('mail-[a-f0-9]{32}\.eml',name) is not None and
                isinstance(digest,str) and re.fullmatch('[a-f0-9]{64}',digest) is not None,'EXACT_RAW_SAMPLE_REFERENCE')
            path=archive/name
            lib['require'](manifest.get(name)==digest and not path.is_symlink() and path.is_file() and
                path.stat().st_size==observation.get('actualRawLen')<=40*1024*1024 and observation.get('rawPrivateCopySaved') is True and
                observation.get('rawFetchOK') is True and observation.get('literalLenMatched') is True and
                observation.get('metadataDateMatchesRecord') is True and lib['file_sha'](path)==digest,'SEALED_COMPLETE_LITERAL_AND_SHA_REQUIRED')
            if digest not in chosen:
                with path.open('rb') as source,(RAW_INPUTS/name).open('xb') as target:
                    while True:
                        block=source.read(1024*1024)
                        if not block:break
                        target.write(block)
                    target.flush();os.fsync(target.fileno())
                (RAW_INPUTS/name).chmod(0o600)
                lib['require'](lib['file_sha'](RAW_INPUTS/name)==digest,'STAGED_RAW_HASH_MATCH')
                chosen[digest]={'rawName':name,'rawSHA256':digest,'equivalentSourceSamples':0,'originCounts':{}}
            selected=chosen[digest];selected['equivalentSourceSamples']+=1
            selected['originCounts'][origin]=selected['originCounts'].get(origin,0)+1
    lib['require'](source_count==8 and len(chosen)==4,'EXACT_FOUR_DISTINCT_SEALED_RAW_PAYLOADS_REQUIRED')
    return list(chosen.values()),source_count


def inspect_owned(lib,cid,name):
    template='{"id":{{json .Id}},"name":{{json .Name}},"image":{{json .Image}},"label":{{json (index .Config.Labels "com.rr-portal.diagnostic")}},"caseLabel":{{json (index .Config.Labels "com.rr-portal.case")}},"running":{{json .State.Running}},"oomKilled":{{json .State.OOMKilled}},"exitCode":{{.State.ExitCode}},"hostPid":{{.State.Pid}},"memory":{{.HostConfig.Memory}},"memorySwap":{{.HostConfig.MemorySwap}},"network":{{json .HostConfig.NetworkMode}}}'
    value=json.loads(lib['command'](['docker','inspect','--format',template,cid],seconds=4,cap=8192))
    lib['require'](value.get('id')==cid and value.get('name')=='/'+name and value.get('label')=='voyageplex-candidate-eml-worker-20261019' and
        value.get('caseLabel')==name.split('20261019-',1)[1] and value.get('image')==IMAGE and value.get('memory')==512*1024**2 and value.get('memorySwap')==512*1024**2 and value.get('network')=='none',
        'OWN_EXACT_512_NO_SWAP_DIAGNOSTIC_CONTAINER_ONLY')
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


def run_case(lib,sample,index,variant):
    lib['require'](variant in VARIANTS,'FIXED_CANDIDATE_VARIANT_REQUIRED')
    name='rr-voyageplex-emltrial-20261019-%s-s%d'%(variant,index);cid=None;started=time.monotonic();stop=threading.Event();monitor=None
    readings=[];result={'variant':variant,'sampleIndex':index,'workerAddressSpaceMiB':256,'sourceOriginCounts':sample['originCounts'],
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
        attachment_overlay=['--mount','type=bind,src='+str(FIXTURES/'attachments.py')+',dst=/app/app/attachments.py,readonly'] if variant=='eml-merge' else []
        cid=lib['command'](['docker','create','-i','--name',name,'--label',LABEL,'--label','com.rr-portal.case='+variant+'-s'+str(index),'--network','none',
             '--memory','512m','--memory-swap','512m','--pids-limit','128','--cpus','2',
             '--cap-drop','ALL','--security-opt','no-new-privileges',
             '--mount','type=bind,src='+str(RAW_INPUTS)+',dst=/samples,readonly',
             '--mount','type=bind,src='+str(FIXTURES)+',dst=/diag,readonly',
             '--mount','type=bind,src='+str(FIXTURES/'eml.py')+',dst=/app/app/eml.py,readonly',
             '--mount','type=bind,src='+str(FIXTURES/'mail_worker.py')+',dst=/app/app/mail_worker.py,readonly',
             *attachment_overlay,'--entrypoint','python',IMAGE,'/diag/fixture.py','driver'],seconds=10,cap=128).decode().strip()
        lib['require'](re.fullmatch('[a-f0-9]{64}',cid) is not None,'CREATED_DIAGNOSTIC_ID_REQUIRED')
        lib['write_new'](OUTPUT/('container-%s-%d.private.json'%(variant,index)),{'id':cid,'name':name,'image':IMAGE,'variant':variant})
        inspect_owned(lib,cid,name);monitor=threading.Thread(target=sample_memory,daemon=True);monitor.start()
        remaining=120-(time.monotonic()-started)-14;lib['require'](remaining>0,'CASE_DEADLINE')
        value=json.loads(lib['command'](['docker','start','-ai',cid],seconds=remaining,cap=16384,stdin=lib['encoded']({**sample,'budget':256,'variant':variant})))
        allowed={'variant','fullProductionMainImported','syntheticBatchBytes','syntheticPagesTouched','syntheticBatchRetainedThroughoutBothRounds',
                 'actualRawBytesRetainedAdditionally','parentLoadedRSSKiB','rounds','parentFinalRSSKiB','maxParentRSSKiB',
                 'cgroupPeakBytesInside','workerAddressSpaceMiB','productionTimeAndResultLimitsUnchanged','wallSeconds',
                 'nextNormalEmailParsed','nextHealthPassed','healthSamples','healthFailures','maxHealthLatencySeconds',
                 'otherProcessesAfterFinalCleanup','ownHealthServerStopped'}
        lib['require'](isinstance(value,dict) and set(value)==allowed and len(value['rounds'])==2,'SAFE_FULL_PARENT_SUMMARY_SHAPE')
        lib['require'](value['variant']==variant and value['workerAddressSpaceMiB']==256 and value['syntheticBatchBytes']==48*1024*1024 and
            value['productionTimeAndResultLimitsUnchanged'] is True,'EXACT_CANDIDATE_RESOURCE_SCENARIO_REQUIRED')
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
        try:
            list_owned=['docker','ps','-a','--no-trunc','--filter','label='+LABEL,'--filter','name=^/'+name+'$','--format','{{.ID}}']
            if not cid or re.fullmatch('[a-f0-9]{64}',cid) is None:
                possible=lib['command'](list_owned,seconds=4,cap=256).decode().split()
                lib['require'](len(possible)<=1 and all(re.fullmatch('[a-f0-9]{64}',value) for value in possible),'UNIQUE_OWN_CREATED_CONTAINER_REQUIRED')
                cid=possible[0] if possible else None
                if cid is None:result['cleanupVerified']=True
            if cid:
                state=inspect_owned(lib,cid,name);result['containerState']={key:state[key] for key in ['running','oomKilled','exitCode']}
                lib['command'](['docker','rm','-f',cid],seconds=6,cap=256)
                result['cleanupVerified']=lib['command'](list_owned,seconds=4,cap=256).strip()==b''
        except Exception:
            result['cleanupVerified']=False;result['safeFailure']='OWNED_DIAGNOSTIC_CLEANUP_NOT_CONFIRMED'
        result['caseWallSeconds']=round(time.monotonic()-started,3)
    return result



def main():
    if os.environ.get('MAILDIAG_BRANCH')!='refs/heads/ops/voyageplex-maildiag-20261019' or os.environ.get('MAILDIAG_ATTEMPT')!='1' or re.fullmatch('[a-f0-9]{40}',os.environ.get('MAILDIAG_REF','')) is None:raise ValueError()
    lib=library();guards(lib)
    os.umask(0o077);OUTPUT.mkdir(mode=0o700);FIXTURES.mkdir(mode=0o700)
    deadline=time.monotonic()+20*60
    result={'source':MAIN,'productionImageUnmodified':True,'productionLimitsUnchanged':True,'network':'none',
        'candidateEMLSHA256':CANDIDATE_EML_SHA,'candidateAttachmentsSHA256':CANDIDATE_ATTACHMENTS_SHA,'workerOnlyRawCapOverlaySHA256':CANDIDATE_WORKER_SHA,
        'workerAddressSpaceMiB':256,'memoryMiB':512,'swapDisabled':True,'retainedSyntheticBatchMiB':48,
        'rawDatabaseAndMetadataMountedIntoDocker':False,'priorResultsPreserved':False,'cases':[],'completed':False}
    try:
        make_fixtures(lib);selected,source_count=samples(lib)
        lib['write_new'](OUTPUT/'sample-map.private.json',selected)
        result.update({'originalSourceSamples':source_count,'uniqueRawSamples':len(selected)})
        for variant in VARIANTS:
            for index,sample in enumerate(selected,1):
                if time.monotonic()>deadline-130:break
                value=run_case(lib,sample,index,variant);result['cases'].append(value)
                lib['write_new'](OUTPUT/('case-%s-%d-256.json'%(variant,index)),value)
        result['completed']=len(result['cases'])==len(selected)*len(VARIANTS) and all(row['completed'] and row['cleanupVerified'] for row in result['cases'])
    except Exception:
        result['safeFailure']='CANDIDATE_DIAGNOSTIC_INCOMPLETE'
    finally:
        try:guards(lib);result['priorResultsPreserved']=True
        except Exception:result['completed']=False;result['safeFailure']='SOURCE_OR_PRIOR_SEALED_EVIDENCE_CHANGED'
        lib['write_new'](OUTPUT/'first-result.json',result);lib['seal'](OUTPUT);lib['emit'](result)
        lib['emit']({'kind':'receipt','resultPath':str(OUTPUT/'first-result.json'),'resultSHA256':lib['file_sha'](OUTPUT/'first-result.json'),
                     'sealSHA256':lib['file_sha'](OUTPUT/'seal.json')})


if __name__=='__main__':
    try:main()
    except Exception:
        print('{"failed":true,"reason":"REDACTED_CANDIDATE_EML_RESOURCE_PROBE_FAILURE","businessWrites":false}',flush=True)
        raise SystemExit(1)
