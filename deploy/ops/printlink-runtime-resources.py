"""Read only bounded numeric/runtime diagnosis. Never print argv, env or raw logs."""
import datetime
import hashlib
import json
import os
import pathlib
import re
import selectors
import shutil
import subprocess
import sys
import time

ROOT = pathlib.Path('/opt/rr-portal')
EXPECTED_HEAD = 'f853c7a2ec47f3cff11e456f874218d2324ad217'
CTR = 'rr-portal-printlink-1'
DEADLINE = None
LOG_TOKENS = ('JavaScript heap out of memory', 'FATAL ERROR', 'ENOMEM',
    'ERR_WORKER_OUT_OF_MEMORY', 'database is locked', 'SQLITE_BUSY',
    'ERR_SQLITE_ERROR', 'ERR_HTTP_HEADERS_SENT', 'ECONNRESET', 'ETIMEDOUT',
    'PayloadTooLargeError', 'RangeError', 'Maximum call stack size exceeded',
    'SyntaxError', 'EADDRINUSE', '子服务退出', '子进程未及时停止',
    '生产业务内部服务已启动', 'PrintLink 生产', '独立整合版')


def read(path, cap=65536):
    with pathlib.Path(path).open('rb') as stream:
        data = stream.read(cap+1)
    if len(data)>cap:
        raise RuntimeError('BOUNDED_FILE_LIMIT')
    return data


def command(args, timeout=10, cap=131072, merge_stderr=False):
    """Terminate only this helper's own docker CLI if it exceeds output/time bounds."""
    left=min(timeout, DEADLINE-time.monotonic())
    if left<=0:
        raise RuntimeError('DIAGNOSIS_DEADLINE')
    proc=subprocess.Popen(args,stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT if merge_stderr else subprocess.DEVNULL,cwd=ROOT)
    chunks=[];size=0;truncated=False;end=time.monotonic()+left
    try:
        with selectors.DefaultSelector() as sel:
            sel.register(proc.stdout,selectors.EVENT_READ)
            while sel.get_map():
                remaining=end-time.monotonic()
                if remaining<=0:
                    raise RuntimeError('READ_ONLY_CLI_TIMEOUT')
                for key,_ in sel.select(remaining):
                    block=os.read(key.fd,min(16384,cap-size+1))
                    if not block:
                        sel.unregister(key.fileobj);continue
                    size+=len(block)
                    if size>cap:
                        truncated=True
                        chunks.append(block[:len(block)-(size-cap)])
                        return b''.join(chunks),True
                    chunks.append(block)
        if proc.wait(timeout=max(.1,end-time.monotonic()))!=0:
            raise RuntimeError('READ_ONLY_CLI_FAILED')
        return b''.join(chunks),truncated
    finally:
        if proc.poll() is None:
            proc.terminate()
            try:proc.wait(timeout=2)
            except subprocess.TimeoutExpired:
                proc.kill();proc.wait(timeout=2)
        proc.stdout.close()


def run(args,timeout=10,cap=131072):
    data,truncated=command(args,timeout,cap)
    if truncated:
        raise RuntimeError('BOUNDED_COMMAND_LIMIT')
    return data


def inspection():
    items=json.loads(run(['docker','inspect',CTR]))
    if len(items)!=1:raise RuntimeError('EXPECTED_ONE_CONTAINER')
    i=items[0];s=i['State'];h=s.get('Health')or{};c=i['HostConfig']
    return {'id':i['Id'],'image':i['Image'],'pid':s['Pid'],'status':s['Status'],
        'startedAt':s['StartedAt'],'finishedAt':s['FinishedAt'],'health':h.get('Status'),
        'restartCount':i['RestartCount'],'oomKilled':s['OOMKilled'],'exitCode':s['ExitCode'],
        'memoryLimit':c['Memory'],'memorySwapLimit':c['MemorySwap'],
        'healthInterval':(i['Config'].get('Healthcheck')or{}).get('Interval'),
        'healthTimeout':(i['Config'].get('Healthcheck')or{}).get('Timeout'),
        'healthChecks':[{'start':r['Start'],'end':r['End'],'exitCode':r['ExitCode']}
            for r in h.get('Log',[])[-5:]]}


def classify_argv(data):
    argv=data.rstrip(b'\0').split(b'\0')
    def node(x):return x.rsplit(b'/',1)[-1]==b'node'
    if argv and node(argv[0]):
        if len(argv)==3 and argv[1]in[b'start.mjs',b'/app/start.mjs'] and argv[2]==b'--cloud-only':
            return 'platform-parent'
        if len(argv)==2:
            if argv[1]in[b'start.mjs',b'/app/start.mjs']:return 'platform-parent'
            if argv[1]in[b'cloud/server.mjs',b'/app/cloud/server.mjs']:return 'cloud-server'
            if argv[1]in[b'production/server.js',b'/app/production/server.js']:return 'production-server'
            if argv[1]==b'-':return 'possible-node-stdin-diagnostic-source-unprovable'
        if len(argv)==3 and argv[1]==b'-e' and argv[2]==b"fetch('http://127.0.0.1:3100/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))":
            return 'exact-configured-healthcheck-node'
        return 'other-node-argv-withheld'
    if len(argv)>=3 and argv[0].rsplit(b'/',1)[-1]in[b'sh',b'ash'] and argv[1]==b'-c':
        return 'shell-argv-withheld'
    return 'other-argv-withheld'


def process_stat(pid):
    base=pathlib.Path('/proc')/str(pid)
    raw=read(base/'stat').decode();parts=raw[raw.rfind(')')+2:].split()
    status=read(base/'status').decode()
    rss=re.search(r'^VmRSS:\s+(\d+)\s+kB$',status,re.M)
    swap=re.search(r'^VmSwap:\s+(\d+)\s+kB$',status,re.M)
    wchan=read(base/'wchan',128).decode().strip()
    return {'pid':pid,'ppid':int(parts[1]),'state':parts[0],
        'utimeTicks':int(parts[11]),'stimeTicks':int(parts[12]),
        'threads':int(parts[17]),'startTimeTicks':int(parts[19]),
        'rssKiB':int(rss[1])if rss else 0,'swapKiB':int(swap[1])if swap else 0,
        'wchan':wchan if re.fullmatch(r'[A-Za-z0-9_]{1,100}',wchan)else'withheld',
        'role':classify_argv(read(base/'cmdline'))}


def thread_stats(process_rows):
    result={}
    for row in process_rows:
        if row['role']not in ['platform-parent','cloud-server','production-server']:
            continue
        base=pathlib.Path('/proc')/str(row['pid'])/'task'
        tasks=list(base.iterdir())
        if len(tasks)>256:raise RuntimeError('THREAD_COUNT_BOUND')
        for task in tasks:
            if not task.name.isdigit():continue
            try:
                raw=read(task/'stat').decode();p=raw[raw.rfind(')')+2:].split()
                wchan=read(task/'wchan',128).decode().strip()
            except FileNotFoundError:continue
            result[int(task.name)]={'pid':row['pid'],'tid':int(task.name),'role':row['role'],
                'state':p[0],'cpuTicks':int(p[11])+int(p[12]),'startTimeTicks':int(p[19]),
                'wchan':wchan if re.fullmatch(r'[A-Za-z0-9_]{1,100}',wchan)else'withheld'}
    return result


def summarize_threads(before,after):
    items=[]
    for tid,row in after.items():
        old=before.get(tid)
        delta=row['cpuTicks']-old['cpuTicks']if old and old['startTimeTicks']==row['startTimeTicks']else None
        items.append({**row,'cpuTicksDuringSample':delta})
    return sorted(items,key=lambda r:(-(r['cpuTicksDuringSample']or 0),r['pid'],r['tid']))[:16]


def processes():
    lines=run(['docker','top',CTR,'-eo','pid'],cap=65536).decode().splitlines()
    pids=[int(row.strip())for row in lines[1:]if row.strip().isdigit()]
    if len(pids)>4096:raise RuntimeError('PROCESS_COUNT_BOUND')
    result=[];vanished=0
    for pid in pids:
        try:result.append(process_stat(pid))
        except FileNotFoundError:vanished+=1
    return result,vanished


def summarize_processes(before,after):
    old={r['pid']:r for r in before};groups={};details=[]
    for row in after:
        previous=old.get(row['pid']);cpu=None
        if previous and previous['startTimeTicks']==row['startTimeTicks']:
            cpu=row['utimeTicks']+row['stimeTicks']-previous['utimeTicks']-previous['stimeTicks']
        item=groups.setdefault(row['role'],{'count':0,'rssKiB':0,'swapKiB':0,'cpuTicksDuringSample':0,'states':{}})
        item['count']+=1;item['rssKiB']+=row['rssKiB'];item['swapKiB']+=row['swapKiB']
        item['cpuTicksDuringSample']+=cpu or 0
        item['states'][row['state']]=item['states'].get(row['state'],0)+1
        if row['role'] in ['platform-parent','cloud-server','production-server','possible-node-stdin-diagnostic-source-unprovable'] and len(details)<20:
            details.append({**row,'cpuTicksDuringSample':cpu})
    return {'groups':groups,'selectedProcesses':details,'clockTicksPerSecond':os.sysconf('SC_CLK_TCK'),
            'stdinDiagnosticIdentityProven':False,
            'note':'Node stdin argv alone cannot establish input script identity; no stdin pipe was consumed.'}


def log_summary(data,truncated):
    text=data.decode('utf8','replace')
    timestamps=re.findall(r'(?m)^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z) ',text)
    child_exits=[]
    for role,code,signal in re.findall(r'子服务退出：(cloud/server\.mjs|production/server\.js) exitCode=(null|-?\d+) signal=(null|SIG[A-Z]+)',text):
        child_exits.append({'role':role,'exitCode':code,'signal':signal})
    return {'boundedBytesRead':len(data),'truncated':truncated,
        'firstTimestamp':timestamps[0]if timestamps else None,'lastTimestamp':timestamps[-1]if timestamps else None,
        'tokens':{token:text.count(token)for token in LOG_TOKENS},'childExits':child_exits[-20:]}


def cgroup_numeric(pid):
    text=read('/proc/'+str(pid)+'/cgroup').decode()
    path=next((line.split('::',1)[1]for line in text.splitlines()if line.startswith('0::')),None)
    if path is None:return {'unifiedCgroupAvailable':False}
    if '..'in pathlib.PurePosixPath(path).parts:raise RuntimeError('INVALID_CGROUP_PATH')
    base=pathlib.Path('/sys/fs/cgroup')/path.lstrip('/')
    result={'unifiedCgroupAvailable':True}
    for name in ['memory.current','memory.max','memory.peak','memory.events','pids.current','pids.max','cpu.stat']:
        try:content=read(base/name,4096).decode().strip()
        except FileNotFoundError:continue
        if not re.fullmatch(r'[a-z0-9_ \n]+',content):raise RuntimeError('INVALID_CGROUP_NUMERIC_DATA')
        result[name]=content
    return result


def main():
    global DEADLINE
    DEADLINE=time.monotonic()+55
    result={'readOnly':True,'completed':False,'capturedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()}
    try:
        if run(['git','rev-parse','HEAD']).decode().strip()!=EXPECTED_HEAD:
            raise RuntimeError('PRODUCTION_HEAD_CHANGED')
        result['head']=EXPECTED_HEAD;result['before']=inspection()
        numeric=json.loads(run(['docker','stats','--no-stream','--format','{{json .}}',CTR],timeout=8))
        result['stats']={k:numeric[k]for k in ['CPUPerc','MemUsage','MemPerc','PIDs','BlockIO']if k in numeric}
        before,vanished1=processes();threads_before=thread_stats(before)
        sample_start=time.monotonic();time.sleep(1)
        after,vanished2=processes();threads_after=thread_stats(after)
        result['sampleSeconds']=time.monotonic()-sample_start
        result['processes']=summarize_processes(before,after)
        result['processes']['vanishedDuringRead']=vanished1+vanished2
        result['busyOrRepresentativeThreads']=summarize_threads(threads_before,threads_after)
        result['cgroup']=cgroup_numeric(result['before']['pid'])
        mem=read('/proc/meminfo').decode()
        result['hostMemKiB']={k:int(v)for k,v in re.findall(r'^(MemTotal|MemFree|MemAvailable|SwapTotal|SwapFree):\s+(\d+)\s+kB$',mem,re.M)}
        result['disk']={}
        for name in ['/opt/rr-portal','/var/lib/docker']:
            d=shutil.disk_usage(name);result['disk'][name]={'total':d.total,'used':d.used,'free':d.free}
        mounts=json.loads(run(['docker','inspect',CTR]))[0]['Mounts']
        runtime=[pathlib.Path(m['Source'])for m in mounts if m['Destination']=='/app/runtime']
        if len(runtime)!=1:raise RuntimeError('EXPECTED_ONE_RUNTIME_MOUNT')
        result['sqliteFiles']={}
        for relative in ['orders/printlink.sqlite','production.sqlite']:
            for suffix in ['', '-wal','-shm']:
                file=runtime[0]/(relative+suffix)
                try:s=file.stat();result['sqliteFiles'][relative+suffix]={'size':s.st_size,'mtimeNs':s.st_mtime_ns}
                except FileNotFoundError:result['sqliteFiles'][relative+suffix]={'exists':False}
        data,truncated=command(['docker','logs','--timestamps','--since','90m','--tail','300',CTR],timeout=10,cap=1024*1024,merge_stderr=True)
        result['logSummary']=log_summary(data,truncated)
        result['after']=inspection();result['completed']=True
    except Exception as error:
        value=str(error);result['failureCode']=value if re.fullmatch('[A-Z_]{1,80}',value)else type(error).__name__
    print(json.dumps(result,ensure_ascii=False,sort_keys=True,separators=(',',':')))
    return 0 if result['completed']else 1


if __name__=='__main__':sys.exit(main())
