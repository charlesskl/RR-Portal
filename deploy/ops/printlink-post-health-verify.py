"""Sealed read-only acceptance: public GETs, numeric processes and typed SQLite copies."""
import datetime
import hashlib
import importlib.util
import json
import os
import pathlib
import re
import signal
import stat
import subprocess
import sys
import tarfile
import time
import urllib.error
import urllib.request

ROOT=pathlib.Path('/opt/rr-portal')
APP='apps/工程部/3D打印协同平台/'
BACKUP=ROOT/'deploy/backups/printlink-pre-health-20261019'
OUTPUT=ROOT/'deploy/backups/printlink-post-health-20261019'
BACKUP_RESULT_SHA='9dc185e1b1990307917548ed9f41ac0e3e1166fbb834fa3486f7d15ebb2e1354'
BACKUP_MANIFEST_SHA='9dcc00592054d20977e5036a95d3d39ef7e45e6313eb0915d7dea4cc658afc43'
LIB_COMMIT='cdfe55cbd8b982749504a67b45d296936d1242a6'
LIB_SHA='47daa655212357c7ba9b22979bf6f5ee86f20afbff20b14bbd3442fbfc20c1e0'
RESOURCE_SHA='2cc8e166f792ad4e0be0ff6f355351fed8d42d0385e0d413ffc1eca8728b3f5f'
REVIEWED_HEAD='81744ae9904e39e7c30474ea49f06f5a187567e9'
MERGE_HEAD='52c090589d6da542fee74ef17c8edd3b0dfe4fe6'
FINAL_PIN_FROZEN=False


def require(value,label):
    if not value:raise RuntimeError(label)


def library():
    raw=subprocess.run(['git','-C',str(ROOT),'show',LIB_COMMIT+':deploy/ops/printlink-940.py'],
        stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,timeout=10)
    require(raw.returncode==0 and len(raw.stdout)<128*1024 and hashlib.sha256(raw.stdout).hexdigest()==LIB_SHA,'REVIEWED_LIBRARY_PIN')
    lib={'__name__':'reviewed_printlink_online_library'}
    exec(compile(raw.stdout,'reviewed-printlink-library','exec'),lib)
    return lib


def backup_verify(lib):
    require(BACKUP.is_dir()and not BACKUP.is_symlink()and stat.S_IMODE(BACKUP.stat().st_mode)==0o700,'PRIVATE_BACKUP_DIRECTORY')
    require(lib['file_hash'](BACKUP/'first-result.json')==BACKUP_RESULT_SHA
        and lib['file_hash'](BACKUP/'manifest.json')==BACKUP_MANIFEST_SHA,'EXACT_BACKUP_RECEIPT')
    result=json.loads((BACKUP/'first-result.json').read_bytes())
    require(result['backupComplete']is True and result['portableSnapshotsVerified']is True
        and result['rawArchiveVerified']is True,'COMPLETE_BACKUP_REQUIRED')
    manifest=json.loads((BACKUP/'manifest.json').read_bytes())
    actual={str(p.relative_to(BACKUP))for p in BACKUP.rglob('*')if p.is_file()and p.name!='manifest.json'}
    require(set(manifest)==actual,'COMPLETE_BACKUP_FILE_SET')
    for name,expected in manifest.items():
        file=BACKUP/name
        require(lib['safe_relative'](name)and re.fullmatch('[a-f0-9]{64}',expected)
            and file.is_file()and not file.is_symlink()and stat.S_IMODE(file.stat().st_mode)==0o600
            and lib['file_hash'](file)==expected,'ALL_BACKUP_BYTES_VERIFIED')
    audits=json.loads((BACKUP/'sqlite-audits.private.json').read_bytes())
    require(lib['sqlite_snapshots'](BACKUP/'sqlite-snapshots')==audits,'PORTABLE_BASELINE_TYPED_AUDIT')
    return audits


def table_deltas(before,after):
    result=[]
    for database in sorted(set(before)|set(after)):
        b=before.get(database,{});a=after.get(database,{})
        for table in sorted(set(b.get('tables',{}))|set(a.get('tables',{}))):
            old=b.get('tables',{}).get(table);new=a.get('tables',{}).get(table)
            if old!=new:result.append({'database':database,'table':table,'before':old,'after':new})
        if b.get('schemaSha256')!=a.get('schemaSha256'):
            result.append({'database':database,'schemaChanged':True})
    return result


def probe_kind(cmdline):
    args=cmdline.rstrip(b'\0').split(b'\0')
    if not args or args[0].rsplit(b'/',1)[-1]!=b'node':return None
    if len(args)==2 and args[1]in[b'ops/healthcheck.mjs',b'/app/ops/healthcheck.mjs']:return 'direct'
    old=b"fetch('http://127.0.0.1:3100/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
    if len(args)==3 and args[1:]==[b'-e',old]:return 'legacy'
    return None


def cgroup_safe(value):
    try:
        events={line.split()[0]:int(line.split()[1])for line in value['memory.events'].splitlines()}
        return (int(value['memory.max'])==768*1024**2 and 0<int(value['memory.current'])<=768*1024**2
            and events['oom']==0 and events['oom_kill']==0 and events.get('oom_group_kill',0)==0)
    except (ValueError,KeyError,IndexError):return False


def telemetry(m):
    rows,_=m.processes();counts={'direct':0,'legacy':0};roles={}
    for row in rows:
        roles[row['role']]=roles.get(row['role'],0)+1
        try:kind=probe_kind(m.read('/proc/'+str(row['pid'])+'/cmdline'))
        except FileNotFoundError:continue
        if kind:counts[kind]+=1
    return {'state':m.inspection(),'probeCounts':counts,'processRoleCounts':roles,
            'cgroup':m.cgroup_numeric(m.inspection()['pid'])}


def get(url,cap=1024*1024):
    opener=urllib.request.build_opener(urllib.request.ProxyHandler({}))
    started=time.monotonic()
    try:r=opener.open(url,timeout=3)
    except urllib.error.HTTPError as error:r=error
    with r:
        content=r.read(cap+1);require(len(content)<=cap,'BOUNDED_HTTP_BODY')
        return r.status,content,round((time.monotonic()-started)*1000,2)


def durable_rows(lib,tree,databases):
    excluded=set(databases)|{name+suffix for name in databases for suffix in ['-wal','-shm','-journal']}
    excluded|={'.platform-lock','.platform-lock/owner.json'}
    rows=[];total=0
    for file in sorted(tree.rglob('*')):
        name=str(file.relative_to(tree))
        require(lib['safe_relative'](name)and not file.is_symlink(),'SAFE_RUNTIME_FILE')
        s=file.lstat();require(stat.S_ISREG(s.st_mode)or stat.S_ISDIR(s.st_mode),'REGULAR_RUNTIME_ENTRY')
        if name in excluded:continue
        row={'path':name,'type':'directory'if file.is_dir()else'file','mode':stat.S_IMODE(s.st_mode)}
        if file.is_file():
            total+=s.st_size;require(total<=lib['MAX_BYTES'],'BOUNDED_DURABLE_FILES')
            row.update({'bytes':s.st_size,'sha256':lib['file_hash'](file)})
        rows.append(row);require(len(rows)<=lib['MAX_FILES'],'BOUNDED_DURABLE_COUNT')
    return rows


def lock_valid(lib,tree,inspection):
    directory=tree/'.platform-lock';owner=directory/'owner.json'
    require(directory.is_dir()and not directory.is_symlink()and stat.S_IMODE(directory.stat().st_mode)==0o700
        and {p.name for p in directory.iterdir()}=={'owner.json'},'EXACT_PLATFORM_LOCK_ENTRIES')
    raw,metadata=lib['stable_file'](owner);data=json.loads(raw)
    require(set(data)=={'pid','purpose','created'}and data['pid']==1 and data['purpose']=='platform'
        and stat.S_IMODE(metadata.st_mode)==0o600,'EXACT_PLATFORM_LOCK_OWNER')
    created=lib['parse_timestamp'](data['created']);started=lib['parse_timestamp'](inspection['State']['StartedAt'])
    require(started-datetime.timedelta(seconds=1)<=created<=started+datetime.timedelta(seconds=30),'LOCK_MATCHES_CONTAINER_START')
    # The image directly executes the platform supervisor as container PID 1.
    require(inspection['Config']['Cmd']==['node','start.mjs','--cloud-only'],'DIRECT_PLATFORM_SUPERVISOR')
    return True


def source_verify(lib,m,pins,cid):
    require(len(pins)==35,'COMPLETE_RUNTIME_SOURCE_SET')
    for relative,expected in pins.items():
        require(lib['safe_relative'](relative)and re.fullmatch('[a-f0-9]{64}',expected),'SAFE_SOURCE_PIN')
        require(lib['raw_hash'](lib['run'](['git','show',REVIEWED_HEAD+':'+APP+relative]))==expected
            and lib['raw_hash'](lib['run'](['git','show',MERGE_HEAD+':'+APP+relative]))==expected
            and lib['file_hash'](ROOT/APP/relative)==expected,'REVIEWED_MAIN_HOST_SOURCE_MATCH')
    out=m.run(['docker','exec',cid,'sha256sum','--']+['/app/'+relative for relative in sorted(pins)],cap=32768)
    actual={}
    for line in out.decode().splitlines():
        value,path=line.split(None,1);actual[path.removeprefix('/app/')]=value
    require(actual==pins,'ALL_RUNTIME_BYTES_MATCH_REVIEWED_SOURCE')


def main():
    result={'completed':False,'readOnly':True,'serviceRecoveryVerified':False,'strictPreservationVerified':False,
        'crossDatabaseAtomicSnapshotClaimed':False,'sourceHead':MERGE_HEAD,'reviewedHead':REVIEWED_HEAD,'stage':'setup'}
    lib=None;created=False
    try:
        require(FINAL_PIN_FROZEN and re.fullmatch('[a-f0-9]{40}',MERGE_HEAD),'FINAL_DEPLOYMENT_PIN_REQUIRED')
        lib=library();require(lib['git_commit']()==MERGE_HEAD,'EXACT_DEPLOYED_MAIN')
        baseline=backup_verify(lib)
        resource=pathlib.Path(__file__).with_name('printlink-runtime-resources.py')
        require(hashlib.sha256(resource.read_bytes()).hexdigest()==RESOURCE_SHA,'REVIEWED_TELEMETRY_PIN')
        spec=importlib.util.spec_from_file_location('resources',resource);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
        m.DEADLINE=time.monotonic()+300
        os.umask(0o077);OUTPUT.mkdir(mode=0o700);created=True
        old=json.loads((BACKUP/'container-before.private.json').read_bytes())
        others=json.loads((BACKUP/'other-containers.private.json').read_bytes())
        inspection=lib['inspect']('rr-portal-printlink-1');cid=inspection['Id']
        require(cid!=old['id']and inspection['Image']!=old['image'],'NEW_PRINTLINK_CONTAINER_AND_IMAGE')
        mounts=[v for v in inspection['Mounts']if v['Destination']=='/app/runtime']
        require(mounts==old['mounts'],'EXACT_EXISTING_RUNTIME_VOLUME')
        tree=pathlib.Path(mounts[0]['Source']);lock_valid(lib,tree,inspection)
        pins=json.loads(pathlib.Path(__file__).with_name('printlink-runtime-source-951-pins.json').read_bytes())
        result['stage']='source-and-runtime';source_verify(lib,m,pins,cid)
        require(inspection['Config']['Healthcheck']['Test']==['CMD','node','ops/healthcheck.mjs']
            and inspection['HostConfig']['Memory']==768*1024**2 and inspection['HostConfig']['MemorySwap']==768*1024**2,'DIRECT_HEALTH_AND_RESOURCE_LIMITS')
        result['sourceFilesVerified']=len(pins)
        environment_same=lib['digest'](sorted(inspection['Config']['Env']))==old['environmentSHA256']
        result['environmentPreserved']=environment_same
        result['otherContainersBeforeUnchanged']=lib['other_containers']()==others
        samples=[];start=time.monotonic()
        while True:
            status,body,elapsed=get('http://127.0.0.1:3100/api/health',4096)
            sample={'seconds':round(time.monotonic()-start,2),'status':status,'ok':status==200 and json.loads(body).get('ok')is True,
                    'elapsedMs':elapsed,'telemetry':telemetry(m)}
            samples.append(sample)
            if time.monotonic()-start>=60:break
            time.sleep(10)
        lib['private_write'](OUTPUT/'health-telemetry.private.json',lib['encoded'](samples))
        result['healthSamples']=[{'seconds':s['seconds'],'status':s['status'],'ok':s['ok'],'elapsedMs':s['elapsedMs'],
            'probeCounts':s['telemetry']['probeCounts'],'cgroup':s['telemetry']['cgroup']}for s in samples]
        result['memoryObservedMaxChargeBytes']=max(int(s['telemetry']['cgroup']['memory.current'])for s in samples)
        result['kernelPeakBytes']=max((int(s['telemetry']['cgroup']['memory.peak'])for s in samples
            if 'memory.peak'in s['telemetry']['cgroup']),default=None)
        static=[]
        for url,relative in [('/','cloud/public/index.html'),('/app.js','cloud/public/app.js')]:
            status,body,_=get('http://127.0.0.1:3100'+url)
            static.append({'path':url,'status':status,'matchesReviewedBytes':status==200 and lib['raw_hash'](body)==pins[relative]})
        result['staticPages']=static
        result['portalAuthenticationBoundary401']=get('http://127.0.0.1/printlink-health',4096)[0]==401
        result['stage']='typed-sqlite-and-files'
        audits=lib['sqlite_snapshots'](tree,OUTPUT/'sqlite-snapshots')
        lib['private_write'](OUTPUT/'sqlite-audits.private.json',lib['encoded'](audits))
        result['tableDeltas']=table_deltas(baseline,audits)
        require(lib['sqlite_snapshots'](OUTPUT/'sqlite-snapshots')==audits,'AFTER_PORTABLE_TYPED_COPY_VERIFIED')
        original=json.loads((BACKUP/'raw-inventory.private.json').read_bytes())
        excluded=set(baseline)|{name+s for name in baseline for s in ['-wal','-shm','-journal']}|{'.platform-lock','.platform-lock/owner.json'}
        before_durable=[r for r in original if r['path']not in excluded]
        after_durable=durable_rows(lib,tree,baseline)
        lib['private_write'](OUTPUT/'durable-after.private.json',lib['encoded'](after_durable))
        result['durableFilesPreserved']=before_durable==after_durable
        result['durableEntryCounts']={'before':len(before_durable),'after':len(after_durable)}
        result['otherContainersAfterUnchanged']=lib['other_containers']()==others
        result['environmentFilePreserved']=lib['file_hash'](ROOT/'.env.cloud.production')==lib['file_hash'](BACKUP/'env.before')
        end=m.inspection();first=samples[0]['telemetry']['state']
        stable=lambda s:s['id']==first['id']and s['image']==first['image']and s['startedAt']==first['startedAt']and s['restartCount']==first['restartCount']and s['health']=='healthy'and not s['oomKilled']
        result['serviceRecoveryVerified']=(all(s['ok']and stable(s['telemetry']['state'])and s['telemetry']['probeCounts']['legacy']==0
            and s['telemetry']['probeCounts']['direct']<=1 and cgroup_safe(s['telemetry']['cgroup'])for s in samples)and stable(end)
            and all(s['matchesReviewedBytes']for s in static)and result['portalAuthenticationBoundary401'])
        result['strictPreservationVerified']=(baseline==audits and result['durableFilesPreserved']and environment_same
            and result['environmentFilePreserved']and result['otherContainersBeforeUnchanged']and result['otherContainersAfterUnchanged'])
        require(lib['git_commit']()==MERGE_HEAD,'FINAL_MAIN_UNCHANGED');backup_verify(lib)
        result['completed']=True;result['stage']='complete'
    except Exception as error:
        result['strictPreservationVerified']=False
        value=str(error);result['failureCode']=value if re.fullmatch('[A-Z_]{1,80}',value)else type(error).__name__
    finally:
        signal.alarm(0)
        if lib and created:
            lib['private_write'](OUTPUT/'first-result.json',lib['encoded'](result));lib['seal'](OUTPUT)
            print(json.dumps({'resultSHA256':lib['file_hash'](OUTPUT/'first-result.json'),
                'sealSHA256':lib['file_hash'](OUTPUT/'manifest.json')},sort_keys=True),flush=True)
        print(json.dumps(result,ensure_ascii=False,sort_keys=True,separators=(',',':')),flush=True)
    return 0 if result['completed']and result['serviceRecoveryVerified']and result['strictPreservationVerified']else 1


if __name__=='__main__':
    def stop(*_):raise TimeoutError()
    signal.signal(signal.SIGALRM,stop);signal.signal(signal.SIGTERM,stop);signal.alarm(360)
    try:raise SystemExit(main())
    except Exception:
        print('{"completed":false,"readOnly":true,"failureCode":"PRINTLINK_ACCEPTANCE_SETUP_OR_SEAL_FAILED"}',flush=True)
        raise SystemExit(1)
