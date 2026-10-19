"""Exact existing-container memory relief. No restart, image or business-data writes."""
import datetime
import hashlib
import importlib.util
import json
import pathlib
import re
import sys
import time
import urllib.request

SOURCE=pathlib.Path(__file__).with_name('printlink-runtime-resources.py')
SOURCE_SHA='2cc8e166f792ad4e0be0ff6f355351fed8d42d0385e0d413ffc1eca8728b3f5f'
EXPECTED_CID='7fda512cf6166d2304a0293fc73ac5de5400442604d9f50c320dee81f8a8dd9e'
EXPECTED_HEAD='f853c7a2ec47f3cff11e456f874218d2324ad217'
OLD=512*1024*1024
NEW=768*1024*1024


def decision(before,available):
    if before['id']!=EXPECTED_CID or before['status']!='running':
        raise RuntimeError('EXACT_RUNNING_CONTAINER_REQUIRED')
    if available<2*1024*1024*1024:
        raise RuntimeError('TWO_GIB_HOST_AVAILABLE_REQUIRED')
    limits=(before['memoryLimit'],before['memorySwapLimit'])
    if limits==(NEW,NEW):return 'already-at-target-observe-only'
    if limits!=(OLD,OLD):raise RuntimeError('UNEXPECTED_RESOURCE_LIMITS')
    return 'increase-existing-container-limit'


def files(tree):
    names=set()
    for file in tree.rglob('*'):
        if file.is_symlink():raise RuntimeError('RUNTIME_SYMLINK_NOT_ALLOWED')
        if file.is_file():names.add(str(file.relative_to(tree)))
        elif not file.is_dir():raise RuntimeError('RUNTIME_SPECIAL_FILE_NOT_ALLOWED')
        if len(names)>100000:raise RuntimeError('RUNTIME_FILE_COUNT_BOUND')
    if not {'orders/printlink.sqlite','production.sqlite'}<=names:
        raise RuntimeError('BOTH_BUSINESS_DATABASES_REQUIRED')
    return names


def health():
    opener=urllib.request.build_opener(urllib.request.ProxyHandler({}))
    try:
        started=time.monotonic()
        with opener.open('http://127.0.0.1:3100/api/health',timeout=2)as response:
            return {'status':response.status,'elapsedMs':round((time.monotonic()-started)*1000,1)}
    except Exception:return {'failed':True}


def main():
    result={'completed':False,'capturedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),
            'operation':'bounded-runtime-memory-relief','dataConsistencyClaim':'No database snapshot or instantaneous consistency claimed.'}
    try:
        if hashlib.sha256(SOURCE.read_bytes()).hexdigest()!=SOURCE_SHA:
            raise RuntimeError('REVIEWED_RESOURCE_HELPER_PIN_REQUIRED')
        spec=importlib.util.spec_from_file_location('resources',SOURCE)
        m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
        m.DEADLINE=time.monotonic()+75
        if m.run(['git','rev-parse','HEAD']).decode().strip()!=EXPECTED_HEAD:
            raise RuntimeError('PRODUCTION_HEAD_CHANGED')
        result['head']=EXPECTED_HEAD;before=m.inspection();result['before']=before
        mem=m.read('/proc/meminfo').decode()
        available=int(re.search(r'^MemAvailable:\s+(\d+)\s+kB$',mem,re.M)[1])*1024
        result['hostAvailableBeforeBytes']=available
        result['decision']=decision(before,available)
        inspection=json.loads(m.run(['docker','inspect',m.CTR]))[0]
        mounts=[x for x in inspection['Mounts']if x['Destination']=='/app/runtime']
        if len(mounts)!=1:raise RuntimeError('EXACT_RUNTIME_VOLUME_REQUIRED')
        tree=pathlib.Path(mounts[0]['Source']);names_before=files(tree)
        rows,_=m.processes();result['processesBefore']=m.summarize_processes(rows,rows)
        if result['decision']=='increase-existing-container-limit':
            m.run(['docker','update','--memory','768m','--memory-swap','768m',EXPECTED_CID],timeout=15)
        observations=[];until=time.monotonic()+40
        while True:
            item=health();observations.append(item)
            if item.get('status')==200 or time.monotonic()>=until:break
            time.sleep(2)
        result['directHealthObservations']=observations
        time.sleep(2)
        result['after']=m.inspection()
        rows,_=m.processes();result['processesAfter']=m.summarize_processes(rows,rows)
        names_after=files(tree)
        result['runtimeFiles']={'beforeCount':len(names_before),'afterCount':len(names_after),
            'previousFilesStillPresent':names_before<=names_after,'missingPreviousFileCount':len(names_before-names_after),
            'bothBusinessDatabasesStillPresent':{'orders/printlink.sqlite','production.sqlite'}<=names_after}
        result['cgroupAfter']=m.cgroup_numeric(before['pid'])
        after=result['after']
        if (after['id']!=before['id'] or after['image']!=before['image'] or after['startedAt']!=before['startedAt']
                or after['restartCount']!=before['restartCount'] or after['memoryLimit']!=NEW or after['memorySwapLimit']!=NEW):
            raise RuntimeError('RESOURCE_ONLY_POSTCONDITIONS_FAILED')
        result['completed']=True
    except Exception as error:
        value=str(error);result['failureCode']=value if re.fullmatch('[A-Z_]{1,80}',value)else type(error).__name__
    print(json.dumps(result,ensure_ascii=False,sort_keys=True,separators=(',',':')))
    return 0 if result['completed']else 1


if __name__=='__main__':sys.exit(main())
