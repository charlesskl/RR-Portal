"""PR940 private backup and read-only verification. No deployment or business writes.

SQLite backup API copies include committed WAL data. Raw DB/WAL/SHM bytes are also
retained as evidence, but are not used as portable databases or compared as logical
business data. Every table and every durable non-SQLite file is compared exactly.
"""
import contextlib
import datetime
import hashlib
import json
import math
import os
import pathlib
import re
import sqlite3
import stat
import subprocess
import sys
import tarfile
import urllib.error
import urllib.request

ROOT = pathlib.Path('/opt/rr-portal')
APP_PREFIX = 'apps/工程部/3D打印协同平台/'
APP = ROOT / APP_PREFIX
BACKUPS = ROOT / 'deploy/backups'
PRE_DEPLOY_COMMIT = '1510ca5f5f7e8a6132075400e50a36710f1447c0'
PROTECTED_SERVICES = ['nginx', 'core', 'db', 'redis', 'internal-quote']
COMPOSE = ['docker', 'compose', '-f', 'docker-compose.cloud.yml', '--env-file', '.env.cloud.production']
TESTED_SOURCE = {'finalPinFrozen': False, 'reviewedHead': None, 'files': {}, 'applicationFiles': {}}
FAILED_CHECK = 'entrypoint'
MAX_FILES = 100000
MAX_BYTES = 32 * 1024**3
MAX_FILE_BYTES = 8 * 1024**3
GLOBAL_HEALTH = ['/nginx-health', '/health', '/hy-schedule/health', '/rr/health', '/zouhuo/health',
 '/jiangping/health', '/paiji/health', '/figure-mold-cost-system/health', '/automation-equipment/health',
 '/baojia/health', '/liwenjuan/health', '/huadeng-maorong/health', '/huadeng/health', '/peise/health',
 '/qc/api/health', '/production-plan/health', '/shipping/health', '/factory-review/health',
 '/indo-shipping/health', '/tomy-paiqi/health', '/zuru-order-system/health', '/zuru-master/health',
 '/voyageplex/api/health', '/erp/health', '/qc-plan/api/health']
PUBLIC_SAMPLE = {'/printlink-health':401, '/':401, '/nginx-health':200, '/rr/health':200, '/sprayplan/api/health':200,
 '/sprayplan-test/api/health':200, '/internal-quote/health':200, '/indo-shipping/health':200,
 '/tomy-paiqi/health':200, '/peise/health':200, '/voyageplex/api/health':200,
 '/internal-quote/api/auth/me':401, '/internal-quote/api/quotes':401, '/internal-quote/api/admin/users':401}
STATIC = {'/business-sync':'business-sync.html', '/business-sync.js':'business-sync.js',
 '/mobile-order.png':'mobile-order.png', '/mobile-order.html':'mobile-order.html', '/':'index.html',
 '/app.js':'app.js', '/style.css':'style.css', '/favicon.svg':'favicon.svg',
 '/manifest.webmanifest':'manifest.webmanifest', '/platform':'platform.html',
 '/platform.js':'platform.js', '/platform.css':'platform.css'}
CONFIG_PATHS = ['docker-compose.cloud.yml', 'nginx/nginx.cloud.conf',
 APP_PREFIX+'Dockerfile', APP_PREFIX+'.dockerignore', APP_PREFIX+'start.mjs',
 APP_PREFIX+'cloud/server.mjs', APP_PREFIX+'cloud/integration.mjs',
 APP_PREFIX+'production/server.js', APP_PREFIX+'production/source-inventory.cjs']


def require(value, label):
    global FAILED_CHECK
    FAILED_CHECK = label
    if not value:
        raise RuntimeError('PRINTLINK_940_OPS_FAILED')


def encoded(value):
    return json.dumps(value, ensure_ascii=True, sort_keys=True, separators=(',', ':')).encode()


def digest(value):
    return hashlib.sha256(encoded(value)).hexdigest()


def raw_hash(value):
    return hashlib.sha256(value).hexdigest()


def run(args, data=None, timeout=180):
    result = subprocess.run(args, input=data, stdout=subprocess.PIPE, stderr=subprocess.PIPE, cwd=ROOT, timeout=timeout)
    require(result.returncode == 0, 'privateCommandSucceeded')
    return result.stdout


def safe_relative(name):
    path = pathlib.PurePosixPath(name)
    return bool(name) and not path.is_absolute() and all(p not in {'', '.', '..'} for p in path.parts) and str(path) == name and not any(ord(c)<32 for c in name)


def private_write(file, content):
    require(not file.exists() and not file.is_symlink(), 'privateOutputDoesNotExist')
    fd = os.open(file, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'wb') as stream:
        stream.write(content)
        stream.flush()
        os.fsync(stream.fileno())


def stable_file(file):
    fd = os.open(file, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, 'rb') as stream:
        before = os.fstat(stream.fileno())
        require(stat.S_ISREG(before.st_mode) and before.st_size <= MAX_FILE_BYTES, 'regularBoundedFile')
        content = stream.read(before.st_size + 1)
        after = os.fstat(stream.fileno())
        require(len(content) == before.st_size and (before.st_dev,before.st_ino,before.st_size,before.st_mtime_ns) ==
                (after.st_dev,after.st_ino,after.st_size,after.st_mtime_ns), 'rawFileStableDuringRead')
    return content, before


def file_hash(file):
    fd = os.open(file, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd,'rb') as stream:
        before = os.fstat(stream.fileno()); hasher = hashlib.sha256()
        require(stat.S_ISREG(before.st_mode) and before.st_size <= MAX_FILE_BYTES, 'regularBoundedHashFile')
        for block in iter(lambda:stream.read(1024*1024),b''): hasher.update(block)
        after = os.fstat(stream.fileno())
        require((before.st_dev,before.st_ino,before.st_size,before.st_mtime_ns)==(after.st_dev,after.st_ino,after.st_size,after.st_mtime_ns), 'hashFileStableDuringRead')
    return hasher.hexdigest()


def sqlite_value(value):
    if value is None: return ['null']
    if isinstance(value, bytes): return ['blob', value.hex()]
    if isinstance(value, int): return ['integer', str(value)]
    if isinstance(value, float):
        require(math.isfinite(value), 'finiteSQLiteReal')
        return ['real', value.hex()]
    require(isinstance(value, str), 'sqliteScalarType')
    return ['text', value]


def quote_identifier(name):
    return '"' + name.replace('"', '""') + '"'


def sqlite_audit(connection):
    require(connection.execute('PRAGMA integrity_check').fetchall() == [('ok',)], 'sqliteIntegrityCheck')
    require(not connection.execute('PRAGMA foreign_key_check').fetchall(), 'sqliteForeignKeyCheck')
    schema = connection.execute("SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name").fetchall()
    tables = {}
    for row in schema:
        if row[0] != 'table': continue
        name = row[1]
        columns = connection.execute('PRAGMA table_xinfo(' + quote_identifier(name) + ')').fetchall()
        require(columns and all(len(column)==7 for column in columns), 'completeSQLiteExtendedColumnMetadata')
        selected = ','.join(quote_identifier(column[1]) for column in columns)
        rows = connection.execute('SELECT ' + selected + ' FROM ' + quote_identifier(name))
        hashes = sorted(digest([sqlite_value(v) for v in item]) for item in rows)
        tables[name] = {'rows':len(hashes), 'sha256':raw_hash(''.join(hashes).encode()), 'columnsSha256':digest(columns)}
    return {'schemaSha256':digest(schema), 'tables':tables}


def discover_databases(tree):
    found = []
    for file in sorted(tree.rglob('*')):
        require(not file.is_symlink(), 'noRuntimeSymlinks')
        if not file.is_file():
            require(file.is_dir(), 'runtimeRegularFilesAndDirectoriesOnly')
            continue
        with file.open('rb') as stream: header = stream.read(16)
        suffix_db = file.suffix.lower() in {'.sqlite', '.sqlite3', '.db'}
        if header == b'SQLite format 3\0': found.append(str(file.relative_to(tree)))
        else: require(not suffix_db, 'sqliteExtensionHasValidHeader')
    require({'orders/printlink.sqlite', 'production.sqlite'} <= set(found), 'bothActiveDatabasesPresent')
    return found


def sqlite_snapshots(tree, output=None):
    names = discover_databases(tree)
    result = {}
    # Each connection is pinned before any copy starts. These are individually
    # consistent SQLite transactions, not a claimed cross-database atomic commit.
    with contextlib.ExitStack() as stack:
        connections = {}
        for name in names:
            db = stack.enter_context(contextlib.closing(sqlite3.connect((tree/name).as_uri()+'?mode=ro', uri=True, timeout=15)))
            db.execute('PRAGMA query_only=ON'); db.execute('BEGIN')
            db.execute('SELECT count(*) FROM sqlite_master').fetchone()
            connections[name] = db
        for name, db in connections.items():
            audit = sqlite_audit(db)
            if output:
                destination = output/name
                destination.parent.mkdir(mode=0o700,parents=True,exist_ok=True)
                require(not destination.exists(), 'newSnapshotDestination')
                with sqlite3.connect(destination) as copy:
                    db.backup(copy)
                    require(sqlite_audit(copy) == audit, 'sqliteBackupMatchesPinnedReadSnapshot')
                destination.chmod(0o600)
            result[name] = audit
    return result


def tree_inventory(tree, archive=None):
    require(tree.is_dir() and not tree.is_symlink(), 'runtimeTreeExists')
    rows, total = [], 0
    with contextlib.ExitStack() as stack:
        tar = stack.enter_context(tarfile.open(archive, 'x')) if archive else None
        for file in sorted(tree.rglob('*')):
            name = str(file.relative_to(tree))
            require(safe_relative(name) and not file.is_symlink(), 'safeRuntimeEntry')
            metadata = file.lstat()
            require(stat.S_ISREG(metadata.st_mode) or stat.S_ISDIR(metadata.st_mode), 'runtimeRegularEntry')
            row = {'path':name, 'type':'directory' if file.is_dir() else 'file', 'mode':stat.S_IMODE(metadata.st_mode)}
            if file.is_dir():
                if tar:
                    info = tarfile.TarInfo(name); info.type = tarfile.DIRTYPE; info.mode = row['mode']; tar.addfile(info)
            else:
                fd = os.open(file,os.O_RDONLY | os.O_NOFOLLOW)
                with os.fdopen(fd,'rb') as stream:
                    metadata = os.fstat(stream.fileno())
                    require(stat.S_ISREG(metadata.st_mode) and metadata.st_size <= MAX_FILE_BYTES, 'regularBoundedArchiveFile')
                    total += metadata.st_size
                    require(total <= MAX_BYTES, 'boundedRuntimeTotalBytes')
                    hasher = hashlib.sha256()
                    for block in iter(lambda:stream.read(1024*1024),b''): hasher.update(block)
                    row.update({'bytes':metadata.st_size,'sha256':hasher.hexdigest()})
                    if tar:
                        stream.seek(0)
                        info = tarfile.TarInfo(name); info.size = metadata.st_size; info.mode = row['mode']
                        info.uid, info.gid, info.mtime = metadata.st_uid, metadata.st_gid, int(metadata.st_mtime)
                        tar.addfile(info,stream)
                    after = os.fstat(stream.fileno())
                    require((metadata.st_dev,metadata.st_ino,metadata.st_size,metadata.st_mtime_ns)==(after.st_dev,after.st_ino,after.st_size,after.st_mtime_ns), 'archivedFileStableDuringRead')
            rows.append(row); require(len(rows) <= MAX_FILES, 'boundedRuntimeEntryCount')
    if archive: archive.chmod(0o600)
    return rows


def verify_archive(archive, expected):
    rows, total = [], 0
    with tarfile.open(archive,'r') as tar:
        for info in tar:
            require(safe_relative(info.name) and (info.isfile() or info.isdir()), 'safeArchiveMember')
            row = {'path':info.name, 'type':'directory' if info.isdir() else 'file', 'mode':info.mode}
            if info.isfile():
                total += info.size; require(total <= MAX_BYTES and info.size <= MAX_FILE_BYTES, 'boundedArchiveMember')
                stream = tar.extractfile(info)
                hasher = hashlib.sha256(); size = 0
                for block in iter(lambda:stream.read(1024*1024),b''): hasher.update(block); size += len(block)
                require(size == info.size, 'archiveMemberComplete')
                row.update({'bytes':size,'sha256':hasher.hexdigest()})
            rows.append(row)
            require(len(rows) <= MAX_FILES, 'boundedArchiveEntryCount')
    require(rows == expected, 'allArchiveBytesAndEntriesVerified')


def parse_timestamp(value):
    match = re.fullmatch(r'(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?Z',value) if isinstance(value,str) else None
    require(bool(match), 'utcLifecycleTimestamp')
    microseconds = int((match[2] or '').ljust(6,'0')[:6])
    return datetime.datetime.strptime(match[1],'%Y-%m-%dT%H:%M:%S').replace(microsecond=microseconds,tzinfo=datetime.timezone.utc)


def validate_platform_lock(tree, supervisor_pid, lifecycle_state, supervisor_started, now=None):
    lock = tree/'.platform-lock'
    require(lock.is_dir() and not lock.is_symlink() and stat.S_IMODE(lock.stat().st_mode)==0o700, 'exactPrivatePlatformLockDirectory')
    require({p.name for p in lock.iterdir()}=={'owner.json'}, 'onlyExactPlatformLockOwnerFile')
    owner_file = lock/'owner.json'
    content,metadata = stable_file(owner_file)
    require(stat.S_IMODE(metadata.st_mode)==0o600, 'privatePlatformLockOwnerFile')
    owner = json.loads(content)
    require(isinstance(owner,dict) and set(owner)=={'pid','purpose','created'}, 'exactPlatformLockOwnerShape')
    require(type(owner['pid']) is int and owner['pid']>0 and owner['pid']==supervisor_pid and owner['purpose']=='platform', 'lockOwnedByCurrentPlatformSupervisor')
    created = parse_timestamp(owner['created'])
    started = parse_timestamp(lifecycle_state['startedAt'])
    container_created = parse_timestamp(lifecycle_state['createdAt'])
    now = now or datetime.datetime.now(datetime.timezone.utc)
    require(container_created <= started <= now+datetime.timedelta(seconds=1), 'validContainerLifecycleWindow')
    require(started-datetime.timedelta(seconds=1) <= supervisor_started <= now+datetime.timedelta(seconds=1), 'supervisorStartedWithinContainerLifecycle')
    require(started-datetime.timedelta(seconds=1) <= created <= now+datetime.timedelta(seconds=1), 'platformLockCreatedWithinContainerLifecycle')
    require(-1 <= (created-supervisor_started).total_seconds() <= 30, 'platformLockCreationMatchesSupervisorStart')
    require(abs(metadata.st_mtime-created.timestamp()) <= 2, 'platformLockFileMtimeMatchesOwnerCreation')
    return {'validated':True,'ownerSha256':raw_hash(content),'supervisorPid':supervisor_pid,
            'purpose':'platform','created':owner['created'],'supervisorStartedAt':supervisor_started.isoformat()}


def durable_inventory(rows, databases, lock_proof):
    physical = set(databases) | {name+suffix for name in databases for suffix in ['-wal','-shm','-journal']}
    lock_rows = {row['path']:row for row in rows if row['path']=='.platform-lock' or row['path'].startswith('.platform-lock/')}
    require(set(lock_rows)=={'.platform-lock','.platform-lock/owner.json'} and lock_rows['.platform-lock']['type']=='directory'
            and lock_rows['.platform-lock/owner.json']['type']=='file', 'noUnknownFilesExcludedAsPlatformLock')
    require(lock_proof.get('validated') is True and lock_proof.get('purpose')=='platform'
            and lock_rows['.platform-lock/owner.json']['sha256']==lock_proof.get('ownerSha256'), 'archivedLockMatchesValidatedLiveSupervisorOwner')
    # Only these two validated ownership entries are lifecycle data. Every other
    # file, including similarly named entries, remains in the durable comparison.
    return [row for row in rows if row['path'] not in physical | set(lock_rows)]


def inspect(identifier):
    value = json.loads(run(['docker','inspect',identifier]))
    require(isinstance(value,list) and len(value)==1, 'uniqueDockerInspectResult')
    return value[0]


def cid(service):
    value = run(COMPOSE+['ps','-a','-q',service]).decode().strip()
    require(bool(re.fullmatch('[a-f0-9]{64}',value)), 'oneContainerPerService')
    return value


def lifecycle(identifier):
    value = inspect(identifier); state = value['State']
    return {'containerId':value['Id'],'imageId':value['Image'],'startedAt':state['StartedAt'],
      'createdAt':value['Created'],'restartCount':value['RestartCount'],'running':state['Running'],
      'status':state['Status'],'oomKilled':state['OOMKilled'],
      'health':state.get('Health',{}).get('Status','none')}


def other_containers():
    ids = run(['docker','ps','-a','-q','--no-trunc','--filter','label=com.docker.compose.project=rr-portal']).decode().split()
    result = {}
    for identifier in ids:
        value = inspect(identifier)
        service = value['Config']['Labels'].get('com.docker.compose.service')
        if service == 'printlink': continue
        require(service and service not in result, 'oneProtectedContainerPerService')
        result[service] = lifecycle(identifier)
    require(set(PROTECTED_SERVICES) <= set(result), 'fiveProtectedServicesPresentExcludingPrintlink')
    return result


def healthy_lifecycle(value):
    return value['running'] is True and value['status']=='running' and value['oomKilled'] is False and value['health'] in {'none','healthy'}


def runtime_context():
    app = cid('printlink'); value = inspect(app)
    mounts = value['Mounts']
    selected = [m for m in mounts if m['Destination']=='/app/runtime']
    require(len(selected)==1 and selected[0]['Type']=='volume' and selected[0]['RW'] is True, 'actualWritableNamedRuntimeVolume')
    volume = selected[0]; name = volume.get('Name')
    require(name=='rr-portal_printlink-data', 'expectedPrintlinkVolumeName')
    actual = json.loads(run(['docker','volume','inspect',name]))
    require(len(actual)==1 and actual[0]['Mountpoint']==volume['Source'], 'actualVolumeMountpointMatches')
    tree = pathlib.Path(volume['Source'])
    require(tree.is_absolute() and tree.is_dir() and not tree.is_symlink(), 'actualRuntimeVolumeDirectory')
    # Capture all three actual process environments privately. No mutation,
    # temporary session, login, business endpoint, or signal is used.
    script = r'''const fs=require('node:fs');const found={parent:[],cloud:[],production:[]};
for(const id of fs.readdirSync('/proc').filter(n=>/^\d+$/.test(n))){try{const cmd=fs.readFileSync('/proc/'+id+'/cmdline','utf8').split('\0');const role=Object.entries({parent:'start.mjs',cloud:'cloud/server.mjs',production:'production/server.js'}).find(([,f])=>cmd.some(a=>a===f||a==='/app/'+f))?.[0];if(!role)continue;const status=fs.readFileSync('/proc/'+id+'/status','utf8');const env=fs.readFileSync('/proc/'+id+'/environ','utf8').split('\0').filter(Boolean);const stat=fs.readFileSync('/proc/'+id+'/stat','utf8');const startTicks=Number(stat.slice(stat.lastIndexOf(')')+2).trim().split(/\s+/)[19]);const bootTimeSeconds=Number(fs.readFileSync('/proc/stat','utf8').match(/^btime (\d+)$/m)?.[1]);found[role].push({pid:Number(id),parent:Number(status.match(/^PPid:\s+(\d+)/m)?.[1]),startTicks,bootTimeSeconds,env});}catch(e){if(e.code!=='ENOENT')process.exit(1);}}
process.stdout.write(JSON.stringify(found));'''
    processes = json.loads(run(['docker','exec',app,'node','-e',script]))
    require(set(processes)=={'parent','cloud','production'} and all(len(rows)==1 for rows in processes.values()), 'exactParentAndTwoServiceProcesses')
    parent = processes['parent'][0]
    require(all(processes[k][0]['parent']==parent['pid'] for k in ['cloud','production']), 'twoServicesBelongToActualParent')
    protected = {}
    for role,rows in processes.items():
        env = rows[0]['env']; require(all(isinstance(e,str) and '=' in e for e in env), 'processEnvironmentShape')
        mapped = dict(e.split('=',1) for e in env)
        require(len(mapped)==len(env) and mapped.get('HOSTNAME')==app[:12], 'automaticProcessHostname')
        mapped.pop('HOSTNAME')
        protected[role] = digest(mapped)
    all_env = value['Config']['Env']
    require(len(dict(item.split('=',1) for item in all_env))==len(all_env), 'uniqueConfigEnvironment')
    state = lifecycle(app)
    require(type(parent.get('startTicks')) is int and parent['startTicks']>0 and type(parent.get('bootTimeSeconds')) is int and parent['bootTimeSeconds']>0, 'actualSupervisorKernelStartTime')
    supervisor_started = datetime.datetime.fromtimestamp(parent['bootTimeSeconds']+parent['startTicks']/os.sysconf('SC_CLK_TCK'), datetime.timezone.utc)
    lock_proof = validate_platform_lock(tree,parent['pid'],state,supervisor_started)
    private = {'containerInspect':value,'processes':processes}
    summary = {'configEnvironmentSha256':digest(sorted(all_env)), 'processEnvironmentSha256':protected,
       'mounts':sorted([{'type':m['Type'],'source':m['Source'],'destination':m['Destination'],'rw':m['RW']} for m in mounts],key=lambda m:m['destination']),
       'lifecycle':state,'platformLock':lock_proof}
    require(healthy_lifecycle(summary['lifecycle']) and summary['lifecycle']['health']=='healthy', 'printlinkHealthyWithoutOOM')
    return app, tree, summary, private


def nginx_material():
    app = cid('nginx')
    configuration = run(['docker','exec',app,'nginx','-T'])
    names = re.findall(rb'^\s*auth_basic_user_file\s+([^;\s]+)\s*;',configuration,re.M)
    require(names, 'actualNginxAuthorizationFileDeclared')
    files = {'configuration':configuration}
    for index,name in enumerate(sorted(set(names))):
        path = name.decode()
        require(path.startswith('/etc/nginx/') and '..' not in pathlib.PurePosixPath(path).parts and '$' not in path, 'fixedNginxAuthorizationPath')
        files['authorization-'+str(index)] = run(['docker','exec',app,'cat',path])
    return files


def git_commit(ref='HEAD'):
    require(ref in {'HEAD','origin/main'}, 'fixedGitRef')
    value = run(['git','rev-parse',ref]).decode().strip()
    require(bool(re.fullmatch('[a-f0-9]{40}',value)), 'exactGitCommit')
    return value


def source_files(commit):
    names = run(['git','ls-tree','-r','--name-only','-z',commit,'--',APP_PREFIX]).decode().strip('\0').split('\0')
    require(names and all(name.startswith(APP_PREFIX) and safe_relative(name) for name in names), 'safeCompleteApplicationSourceInventory')
    return {name:raw_hash(run(['git','show',commit+':'+name])) for name in names}


def tested_source_guard(commit, deployed=False):
    pin = TESTED_SOURCE
    require(pin.get('finalPinFrozen') is True and bool(re.fullmatch('[a-f0-9]{40}',str(pin.get('reviewedHead')))), 'finalReviewedSourceMustBeFrozen')
    require(isinstance(pin.get('files'),dict) and pin['files'] and isinstance(pin.get('applicationFiles'),dict) and pin['applicationFiles'], 'nonemptyFinalTestedSourceManifest')
    for name,expected in {**pin['files'],**pin['applicationFiles']}.items():
        require(name.startswith(APP_PREFIX) and safe_relative(name) and re.fullmatch('[a-f0-9]{64}',expected), 'safePinnedApplicationPathAndDigest')
    reviewed = source_files(pin['reviewedHead'])
    require(reviewed==pin['applicationFiles'], 'reviewedCompleteApplicationMatchesPin')
    changed = run(['git','diff','--name-only','-z',PRE_DEPLOY_COMMIT,pin['reviewedHead']]).decode().strip('\0').split('\0')
    require(set(changed)==set(pin['files']) and all(reviewed.get(name)==expected for name,expected in pin['files'].items()), 'reviewedChangedInventoryExactlyPinned')
    if deployed:
        require(source_files(commit)==pin['applicationFiles'], 'deployedCompleteApplicationMatchesTestedPin')
        changed = run(['git','diff','--name-only','-z',PRE_DEPLOY_COMMIT,commit]).decode().strip('\0').split('\0')
        require(set(changed)==set(pin['files']), 'deployedChangedPathsExactlyPinned')
    actual = source_files(commit)
    for name,expected in actual.items():
        require(file_hash(ROOT/name)==expected, 'completeApplicationCheckoutMatchesGit')
    return actual


def actual_runtime_files(app, expected):
    paths = {name[len(APP_PREFIX):]:sha for name,sha in expected.items()
             if name[len(APP_PREFIX):] in {'start.mjs','package.json'} or
             (name[len(APP_PREFIX):].startswith(('cloud/','production/','shared/','ops/')) and '/tests/' not in name)}
    require(paths, 'runtimeFilesNotEmpty')
    script = "const fs=require('node:fs'),c=require('node:crypto');const out={};for(const p of JSON.parse(fs.readFileSync(0,'utf8'))){const f='/app/'+p,s=fs.lstatSync(f);if(!s.isFile()||s.isSymbolicLink())process.exit(1);out[p]=c.createHash('sha256').update(fs.readFileSync(f)).digest('hex');}process.stdout.write(JSON.stringify(out));"
    actual = json.loads(run(['docker','exec','-i',app,'node','-e',script],encoded(list(paths))))
    require(actual==paths, 'everyActualRuntimeFileMatchesTestedSource')
    return len(paths)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs): return None


HTTP = urllib.request.build_opener(urllib.request.ProxyHandler({}),NoRedirect())


def get(url):
    require(url.startswith(('http://127.0.0.1/', 'http://127.0.0.1:3100/')), 'fixedLocalReadOnlyHttpTarget')
    try:
        with HTTP.open(url,timeout=15) as response:
            body = response.read(64*1024**2+1)
            require(len(body)<=64*1024**2, 'boundedHttpBody')
            return response.status, body
    except urllib.error.HTTPError as error:
        return error.code, b''


PRODUCTION_READINESS_SCRIPT = r'''const fs=require('node:fs'),crypto=require('node:crypto');
const proc='/proc';
const endpoint='http://127.0.0.1:3102/bridge/business-sync';
const empty={authorizedStatus:null,unauthenticatedStatus:null,statusShapeValid:false,activeMatchesProcessEnvironment:false,conflictsCount:0,conflictSignaturesSha256:crypto.createHash('sha256').update('[]').digest('hex'),boundedStatusProbeSucceeded:false};
async function main(){
 const matches=[];
 for(const id of fs.readdirSync(proc).filter(n=>/^\d+$/.test(n))){try{const args=fs.readFileSync(proc+'/'+id+'/cmdline','utf8').split('\0');if(args.some(a=>a==='production/server.js'||a==='/app/production/server.js'))matches.push(id);}catch(e){if(e.code!=='ENOENT')throw e;}}
 if(matches.length!==1)throw Error();
 const entries=fs.readFileSync(proc+'/'+matches[0]+'/environ','utf8').split('\0').filter(Boolean);
 const env=Object.fromEntries(entries.map(e=>[e.slice(0,e.indexOf('=')),e.slice(e.indexOf('=')+1)]));
 if(Object.keys(env).length!==entries.length||typeof env.INTERNAL_TOKEN!=='string'||env.INTERNAL_TOKEN.length<32||String(env.PRODUCTION_PORT||'3102')!=='3102')throw Error();
 // Authorized by root for this exact read-only action. The status branch only
 // reads business_sync_state and returns before choices, transactions or writes.
 const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json','X-Internal-Token':env.INTERNAL_TOKEN},body:'{"action":"status"}',signal:AbortSignal.timeout(10000)});
 const out={...empty,authorizedStatus:response.status};
 let chunks=[],size=0;
 for await(const chunk of response.body){size+=chunk.byteLength;if(size>8*1024*1024)throw Error();chunks.push(Buffer.from(chunk));}
 const status=JSON.parse(Buffer.concat(chunks).toString('utf8'));
 const valid=response.status===200&&status&&typeof status==='object'&&!Array.isArray(status)&&Array.isArray(status.conflicts)&&(status.active===null||typeof status.active==='string')&&status.conflicts.every(c=>c&&typeof c==='object'&&typeof c.signature==='string'&&/^[a-f0-9]{64}$/.test(c.signature));
 out.statusShapeValid=!!valid;
 out.activeMatchesProcessEnvironment=!!valid&&status.active===(env.BUSINESS_SYNC_STATION||null);
 if(valid){out.conflictsCount=status.conflicts.length;out.conflictSignaturesSha256=crypto.createHash('sha256').update(JSON.stringify(status.conflicts.map(c=>c.signature).sort())).digest('hex');}
 const denied=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:'{"action":"status"}',signal:AbortSignal.timeout(10000)});
 out.unauthenticatedStatus=denied.status;await denied.body?.cancel();
 out.boundedStatusProbeSucceeded=true;
 process.stdout.write(JSON.stringify(out));
}
main().catch(()=>process.stdout.write(JSON.stringify(empty)));'''


def production_readiness(app):
    value = json.loads(run(['docker','exec',app,'node','-e',PRODUCTION_READINESS_SCRIPT]))
    expected = {'authorizedStatus','unauthenticatedStatus','statusShapeValid','activeMatchesProcessEnvironment',
                'conflictsCount','conflictSignaturesSha256','boundedStatusProbeSucceeded'}
    require(isinstance(value,dict) and set(value)==expected, 'fixedProductionReadOnlyProbeSummary')
    require(all(type(value[key]) is bool for key in ['statusShapeValid','activeMatchesProcessEnvironment','boundedStatusProbeSucceeded'])
            and type(value['conflictsCount']) is int and value['conflictsCount']>=0
            and bool(re.fullmatch('[a-f0-9]{64}',value['conflictSignaturesSha256'])), 'safeProductionReadOnlyProbeTypes')
    value['passed'] = value['authorizedStatus']==200 and value['unauthenticatedStatus']==401 and value['statusShapeValid'] and value['activeMatchesProcessEnvironment'] and value['boundedStatusProbeSucceeded']
    return value


def read_only_probes():
    global_rows = [{'path':path,'status':get('http://127.0.0.1'+path)[0]} for path in GLOBAL_HEALTH]
    public_rows = [{'path':path,'expected':expected,'status':get('http://127.0.0.1'+path)[0]} for path,expected in PUBLIC_SAMPLE.items()]
    cloud = get('http://127.0.0.1:3100/api/health')
    nginx_printlink_auth = get('http://127.0.0.1/printlink-health')[0]==401
    auth = {path:get('http://127.0.0.1:3100'+path)[0] for path in ['/api/me','/api/users','/api/orders','/api/platform/business-sync']}
    static = []
    for url,name in STATIC.items():
        expected = (APP/'cloud/public'/name).read_bytes()
        status,content = get('http://127.0.0.1:3100'+url)
        static.append({'path':url,'sha256':raw_hash(content),'matchesSource':status==200 and content==expected})
    return {'globalHealth':global_rows,'publicSamples':public_rows,
      'cloudHealth':cloud[0]==200 and json.loads(cloud[1]).get('ok') is True,
      'nginxPrintlinkAuthenticationBoundary':nginx_printlink_auth,
      'anonymousAppBoundary':auth,'cloudStaticAssets':static,
      'passed':all(row['status']==200 for row in global_rows) and all(row['status']==row['expected'] for row in public_rows)
       and cloud[0]==200 and json.loads(cloud[1]).get('ok') is True and all(v==401 for v in auth.values())
       and all(row['matchesSource'] for row in static) and nginx_printlink_auth}


def startup_source_facts():
    source = (APP/'production/server.js').read_text()
    repair_definitions = len(re.findall(r'function\s+repairCorruptedData\s*\(',source))
    repair_mentions = len(re.findall(r'\brepairCorruptedData\s*\(',source))
    require(repair_definitions==repair_mentions==1, 'reviewedRepairFunctionHasNoInvocation')
    require(len(re.findall(r'\bensureItemIds\s*\(',source))==2 and
            bool(re.search(r"server\.listen\(PORT, '127\.0\.0\.1', \(\) => \{ ensureItemIds\(\);",source)),
            'reviewedListenCallbackContainsIdentityMigration')
    return {'repairCorruptedDataDefinedButNotInvoked':True,'ensureItemIdsInvokedInListenCallback':True}


def startup_checks(tree):
    with sqlite3.connect((tree/'orders/printlink.sqlite').as_uri()+'?mode=ro',uri=True) as cloud:
        tables = {r[0] for r in cloud.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        required = {'users','sessions','orders','files','metadata','production_jobs','collector_events','collector_devices','collector_stations','account_events','feedback'}
        require(required<=tables, 'cloudStartupSchemaAlreadyPresent')
        columns = {r[1] for r in cloud.execute('PRAGMA table_info(production_jobs)')}
        user_columns = {r[1] for r in cloud.execute('PRAGMA table_info(users)')}
        result = {'jobColumnsReady':{'sync_error','item_id'}<=columns,'factoryScopeReady':'factory_scope' in user_columns,
         'hasExistingUsers':cloud.execute('SELECT count(*) FROM users').fetchone()[0]>0,
         'productionMode':cloud.execute("SELECT value FROM metadata WHERE key='mode'").fetchone()==('production',),
         'expiredUnattachedFiles':cloud.execute("SELECT count(*) FROM files WHERE order_id IS NULL AND created < ?",((datetime.datetime.now(datetime.timezone.utc)-datetime.timedelta(days=1)).isoformat().replace('+00:00','Z'),)).fetchone()[0],
         'startupStageMigrationRows':cloud.execute("SELECT count(*) FROM production_jobs j JOIN orders o ON o.id=j.order_id WHERE j.status='待质检' AND o.status IN ('打印中','待交付')").fetchone()[0],
         'pendingJobSyncRows':cloud.execute('SELECT count(*) FROM production_jobs WHERE synced=0').fetchone()[0]}
    with sqlite3.connect((tree/'production.sqlite').as_uri()+'?mode=ro',uri=True) as production:
        tables = {r[0] for r in production.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        require({'snapshot','source_inventory_config','source_inventory_ledger','data_images','business_sync_state','business_sync_backups'}<=tables, 'productionStartupSchemaAlreadyPresent')
        data = json.loads(production.execute('SELECT value FROM snapshot WHERE id=1').fetchone()[0])
        result['sourceInventoryCutoverReady'] = production.execute('SELECT count(*) FROM source_inventory_config WHERE id=1').fetchone()[0]==1
        result['recordsMissingItemIdentity'] = sum(not item.get('_id') or not item.get('_updatedAt') for day in data.get('records',{}).values() for item in day.get('items',[]))
    result['sourceCallSiteFacts'] = startup_source_facts()
    result.update({'checkedScope':'existing schema, seeds, expired uploads, startup stage migration, pending job sync, and ensureItemIds predicates',
      'repairCorruptedDataInvokedAtStartup':False,'startupPhysicalWritesRuledOut':False,
      'allConcurrentBusinessWritesRuledOut':False,'limits':'CREATE IF NOT EXISTS, PRAGMA and INSERT OR IGNORE statements still execute; active bridge traffic can write during or after preflight. Strict post-deploy hashes decide preservation.'})
    result['passed'] = all(result[key] is True for key in ['jobColumnsReady','factoryScopeReady','hasExistingUsers','productionMode','sourceInventoryCutoverReady']) and all(result[key]==0 for key in ['expiredUnattachedFiles','startupStageMigrationRows','pendingJobSyncRows','recordsMissingItemIdentity'])
    return result


def configuration():
    return {name:file_hash(ROOT/name) for name in CONFIG_PATHS}


def create_private_directory():
    os.umask(0o077)
    BACKUPS.mkdir(parents=True,exist_ok=True)
    require(not BACKUPS.is_symlink(), 'privateBackupRoot')
    target = BACKUPS/('printlink-pre-940-'+datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ'))
    target.mkdir(mode=0o700)
    return target


def seal(directory):
    manifest = {str(p.relative_to(directory)):file_hash(p) for p in sorted(directory.rglob('*')) if p.is_file() and p.name!='manifest.json'}
    private_write(directory/'manifest.json',encoded(manifest))


def selected_backup(path):
    directory = pathlib.Path(path)
    require(directory.parent==BACKUPS and bool(re.fullmatch('printlink-pre-940-[0-9]{8}T[0-9]{12}Z',directory.name)), 'exactBackupPath')
    require(directory.is_dir() and not directory.is_symlink() and directory.stat().st_mode & 0o077 == 0, 'privateBackupDirectory')
    require(not (directory/'verify-first-result.json').exists(), 'firstVerificationAlreadyRetainedDoNotRerun')
    require(all(not file.is_symlink() for file in directory.rglob('*')), 'noPrivateBackupSymlinks')
    manifest_file = directory/'manifest.json'
    require(manifest_file.is_file() and not manifest_file.is_symlink() and manifest_file.stat().st_mode & 0o077 == 0, 'privateManifestRegularFile')
    manifest = json.loads(manifest_file.read_bytes())
    actual = {str(p.relative_to(directory)) for p in directory.rglob('*') if p.is_file() and p.name!='manifest.json'}
    require(set(manifest)==actual and {'baseline.json','runtime-raw.tar','env.before','nginx.configuration','runtime.private.json'}<=actual, 'completePrivateManifestInventory')
    for name,expected in manifest.items():
        require(safe_relative(name) and bool(re.fullmatch('[a-f0-9]{64}',expected)), 'safeManifestEntry')
        file = directory/name
        require(file.is_file() and not file.is_symlink() and file.stat().st_mode & 0o077 == 0 and file_hash(file)==expected, 'allPrivateArtifactsIntact')
    before = json.loads((directory/'baseline.json').read_bytes())
    require(before['sourceCommit']==PRE_DEPLOY_COMMIT and before['deployment']=='PR940' and before['strictVerificationPassed'] is True, 'validStrictBeforeBaseline')
    verify_archive(directory/'runtime-raw.tar',before['rawInventory'])
    snapshots = sqlite_snapshots(directory/'sqlite-snapshots')
    require(snapshots==before['sqlite'], 'retainedSQLiteSnapshotsMatchFullBaseline')
    return directory,before


def backup(target):
    require(git_commit()==git_commit('origin/main')==PRE_DEPLOY_COMMIT==target, 'backupAtExactPreDeployMain')
    expected = tested_source_guard(target)
    directory = create_private_directory()
    # Announce only safe path before work, so any partial failure remains locatable.
    print(json.dumps({'backupStarted':str(directory),'businessWritesPerformed':False}),flush=True)
    app,tree,runtime,private = runtime_context()
    others = other_containers(); nginx = nginx_material(); config = configuration()
    private_write(directory/'env.before',stable_file(ROOT/'.env.cloud.production')[0])
    private_write(directory/'runtime.private.json',encoded(private))
    for name,content in nginx.items(): private_write(directory/('nginx.'+name),content)
    sqlite = sqlite_snapshots(tree,directory/'sqlite-snapshots')
    raw = tree_inventory(tree,directory/'runtime-raw.tar'); verify_archive(directory/'runtime-raw.tar',raw)
    startup = startup_checks(directory/'sqlite-snapshots')
    runtime_count = actual_runtime_files(app,expected)
    probes = read_only_probes()
    production_ready = production_readiness(app)
    after_sqlite = sqlite_snapshots(tree)
    after_raw = tree_inventory(tree)
    checks = {'allLogicalSQLiteDataStable':sqlite==after_sqlite,
      'allDurableFileBytesStable':durable_inventory(raw,sqlite,runtime['platformLock'])==durable_inventory(after_raw,after_sqlite,runtime['platformLock']),
      'runtimeStable':runtime_context()[2]==runtime,'otherContainersStable':other_containers()==others,
      'protectedServicesHealthy':all(healthy_lifecycle(others[name]) for name in PROTECTED_SERVICES),
      'actualNginxAuthStable':nginx_material()==nginx,
      'privateEnvironmentStable':file_hash(ROOT/'.env.cloud.production')==file_hash(directory/'env.before'),
      'configurationStable':configuration()==config,'checkedStartupPrerequisitesSatisfied':startup['passed'],
      'productionReadOnlyStatusReady':production_ready['passed'],'readOnlyHealthAndAssetsPassed':probes['passed'],'sourceStable':git_commit()==git_commit('origin/main')==target}
    result = {'deployment':'PR940','sourceCommit':target,'sqlite':sqlite,'rawInventory':raw,
      'durableInventory':durable_inventory(raw,sqlite,runtime['platformLock']),'runtime':runtime,'otherContainers':others,
      'nginx':{k:raw_hash(v) for k,v in nginx.items()},'configuration':config,'startupChecks':startup,
      'probes':probes,'productionReadiness':production_ready,'runtimeFilesVerified':runtime_count,'checks':checks,'strictVerificationPassed':all(checks.values()),
      'sqliteSnapshotsIndividuallyWALConsistent':True,'crossDatabaseAtomicSnapshotClaimed':False,
      'businessWritesPerformed':False,'credentialsChanged':False,'containerRecreated':False}
    private_write(directory/'baseline.json',encoded(result)); seal(directory)
    return {'backup':str(directory),'strictVerificationPassed':result['strictVerificationPassed'],
      'privateArchivesVerified':True,'allActiveSQLiteBackedUp':len(sqlite),'checks':checks,
      'startupChecks':startup,'businessWritesPerformed':False,'containerRecreated':False,
      'tableDigests':sqlite,'rawEntries':len(raw),'runtimeFilesVerified':runtime_count,
      'probes':probes,'productionReadiness':production_ready,'otherContainers':others,'printlinkBefore':runtime['lifecycle']}


def verify(target,path):
    directory,before = selected_backup(path)
    require(git_commit()==git_commit('origin/main')==target and target!=PRE_DEPLOY_COMMIT, 'verifyAtExactDeployedMain')
    expected = tested_source_guard(target,True)
    app,tree,runtime,private = runtime_context()
    current_sqlite = sqlite_snapshots(tree)
    current_raw = tree_inventory(tree)
    others = other_containers()
    nginx = {k:raw_hash(v) for k,v in nginx_material().items()}
    runtime_count = actual_runtime_files(app,expected)
    probes = read_only_probes()
    production_ready = production_readiness(app)
    final_sqlite = sqlite_snapshots(tree)
    final_raw = tree_inventory(tree)
    checks = {'everyTableAndFullRowUnchanged':current_sqlite==before['sqlite'],
      'everyDurableFileByteUnchanged':durable_inventory(current_raw,current_sqlite,runtime['platformLock'])==before['durableInventory'],
      'logicalSQLiteStableDuringProbe':current_sqlite==final_sqlite,
      'durableFilesStableDuringProbe':durable_inventory(current_raw,current_sqlite,runtime['platformLock'])==durable_inventory(final_raw,final_sqlite,runtime['platformLock']),
      'completeConfigEnvironmentUnchanged':runtime['configEnvironmentSha256']==before['runtime']['configEnvironmentSha256'],
      'allThreeProcessEnvironmentsUnchanged':runtime['processEnvironmentSha256']==before['runtime']['processEnvironmentSha256'],
      'persistentMountsUnchanged':runtime['mounts']==before['runtime']['mounts'],
      'privateEnvironmentFileUnchanged':file_hash(ROOT/'.env.cloud.production')==file_hash(directory/'env.before'),
      'allOtherContainersUnchanged':others==before['otherContainers'],
      'fiveProtectedServicesHealthy':all(healthy_lifecycle(others[name]) for name in PROTECTED_SERVICES),
      'actualNginxAndAuthorizationUnchanged':nginx==before['nginx'],
      'applicationStartupAndDeploymentConfigurationUnchanged':configuration()==before['configuration'],
      'targetPrintlinkRecreated':runtime['lifecycle']['containerId']!=before['runtime']['lifecycle']['containerId'],
      'targetPrintlinkImageChanged':runtime['lifecycle']['imageId']!=before['runtime']['lifecycle']['imageId'],
      'targetPrintlinkRuntimeStableDuringProbe':runtime_context()[2]==runtime,
      'otherContainerLifecycleStableDuringProbe':other_containers()==others,
      'productionReadOnlyStatusReady':production_ready['passed'],'readOnlyHealthAndAssetsPassed':probes['passed'],
      'sourceStable':git_commit()==git_commit('origin/main')==target}
    changed = [name for name in sorted(set(before['sqlite'])|set(current_sqlite)) if before['sqlite'].get(name)!=current_sqlite.get(name)]
    result = {'deployment':'PR940','backup':str(directory),'sourceCommit':target,'checks':checks,
      'strictVerificationPassed':all(checks.values()),'changedDatabases':changed,
      'beforeSQLite':before['sqlite'],'afterSQLite':current_sqlite,'beforeDurableInventorySha256':digest(before['durableInventory']),
      'afterDurableInventorySha256':digest(durable_inventory(current_raw,current_sqlite,runtime['platformLock'])),
      'printlinkBefore':before['runtime']['lifecycle'],'printlinkAfter':runtime['lifecycle'],
      'protectedServices':PROTECTED_SERVICES,'otherContainersBefore':before['otherContainers'],'otherContainersAfter':others,
      'runtimeFilesVerified':runtime_count,'probes':probes,'productionReadiness':production_ready,'businessWritesPerformed':False,
      'conflictChoicesSubmitted':False,'stockOrProductIdsChangedByOperator':False,
      'automaticRestoreOrRecreatePerformed':False}
    # Keep the first result even if active bridge traffic changed rows. No rerun,
    # exemption, restore, pause, stock correction, or conflict choice is offered.
    private_write(directory/'verify-first-result.json',encoded(result))
    private_write(directory/'verify-first-runtime.private.json',encoded(private))
    return result


# This mode reads the retained first failure; it never changes verification gates.
DIAGNOSTIC_BACKUP_PATH = '/opt/rr-portal/deploy/backups/printlink-pre-940-20261019T011955726437Z'
DIAGNOSTIC_PIN_SHA256 = '51532c38e04af1565dde7f7d00d6457043338b00c5a16acc872c8940246af610'
DIAGNOSTIC_TIME_COLUMNS = {
 'orders/printlink.sqlite':{
  'collector_events':{'received':'iso'},'collector_devices':{'observed':'iso'},
  'collector_stations':{'last_seen':'iso'},'account_events':{'created':'iso'},
  'events':{'created':'iso'},'orders':{'created':'iso','updated':'iso'},
  'files':{'created':'iso'},'feedback':{'created':'iso','updated':'iso'},
  'production_jobs':{'created':'iso'}},
 'production.sqlite':{'business_sync_backups':{'created':'iso'},'import_backups':{'created':'iso'},
  'source_inventory_ledger':{'chargedAt':'iso'},'source_inventory_config':{'since':'epoch_ms'}}}


def diagnostic_private_backup(path):
    """Validate the original seal, without relaxing selected_backup()."""
    directory = pathlib.Path(path)
    require(str(directory)==DIAGNOSTIC_BACKUP_PATH and directory.parent==BACKUPS,
            'diagnosticReadsOnlyExactRetainedFirstBackup')
    require(directory.is_dir() and not directory.is_symlink() and directory.stat().st_mode & 0o077==0,
            'diagnosticPrivateOriginalDirectory')
    entries = list(directory.rglob('*'))
    require(all(not entry.is_symlink() and (entry.is_file() or entry.is_dir()) and entry.stat().st_mode & 0o077==0
                for entry in entries), 'diagnosticPrivateOriginalEntries')
    manifest_file = directory/'manifest.json'
    manifest = json.loads(manifest_file.read_bytes())
    files = {str(entry.relative_to(directory)) for entry in entries if entry.is_file() and entry!=manifest_file}
    require(set(manifest)==files and {'baseline.json','runtime-raw.tar','runtime.private.json','env.before','nginx.configuration'}<=files,
            'diagnosticCompleteOriginalSealedInventory')
    for name,expected in manifest.items():
        require(safe_relative(name) and isinstance(expected,str) and bool(re.fullmatch('[a-f0-9]{64}',expected)), 'diagnosticSafeSealedEntry')
        require(file_hash(directory/name)==expected, 'diagnosticOriginalSealedBytesIntact')
    before = json.loads((directory/'baseline.json').read_bytes())
    require(before.get('deployment')=='PR940' and before.get('sourceCommit')==PRE_DEPLOY_COMMIT
            and before.get('strictVerificationPassed') is False,
            'diagnosticOriginalStrictFalsePreserved')
    require(before['checks'].get('allLogicalSQLiteDataStable') is False
            and all(value is True for key,value in before['checks'].items() if key!='allLogicalSQLiteDataStable'),
            'diagnosticOriginalFailureScopeUnchanged')
    require(set(before['sqlite'])=={'orders/printlink.sqlite','production.sqlite'}, 'diagnosticBothOriginalSQLiteSnapshots')
    require({name for name in files if name.startswith('sqlite-snapshots/')}=={'sqlite-snapshots/'+name for name in before['sqlite']},
            'diagnosticExactOriginalSQLiteSnapshotFiles')
    verify_archive(directory/'runtime-raw.tar',before['rawInventory'])
    return directory,before,{'manifestSha256':file_hash(manifest_file),'files':manifest}


def diagnostic_cell_equal(left,right):
    # Same Python SQLite scalar representation as sqlite_audit: integer vs real,
    # BLOB vs text, Unicode bytes, full IEEE float precision and signed zero.
    return int(sqlite_value(left)==sqlite_value(right))


def diagnostic_time(value,kind):
    try:
        if kind=='iso': stamp=parse_timestamp(value)
        elif kind=='epoch_ms' and type(value) in {int,float} and math.isfinite(value):
            stamp=datetime.datetime.fromtimestamp(value/1000,datetime.timezone.utc)
        else:return None
        if not 2000<=stamp.year<=2100:return None
        return stamp.isoformat(timespec='microseconds').replace('+00:00','Z')
    except (RuntimeError,ValueError,OverflowError,OSError):return None


def diagnostic_metadata_label(name):
    require(isinstance(name,str) and 0<len(name)<=128 and not any(ord(char)<32 for char in name), 'diagnosticSafeSchemaLabel')
    return name


def diagnostic_schema(connection,schema):
    require(schema in {'main','baseline'}, 'diagnosticFixedSchemaAlias')
    rows=connection.execute('SELECT type,name,tbl_name,sql FROM '+schema+'.sqlite_master ORDER BY type,name').fetchall()
    require(connection.execute('PRAGMA '+schema+'.integrity_check').fetchall()==[('ok',)], 'diagnosticSQLiteIntegrity')
    require(not connection.execute('PRAGMA '+schema+'.foreign_key_check').fetchall(), 'diagnosticSQLiteForeignKeys')
    tables={}
    for kind,name,table,sql in rows:
        diagnostic_metadata_label(name);diagnostic_metadata_label(table)
        if kind!='table':continue
        columns=connection.execute('PRAGMA '+schema+'.table_xinfo('+quote_identifier(name)+')').fetchall()
        require(columns and all(len(column)==7 for column in columns), 'diagnosticAllExtendedColumnsPresent')
        for column in columns:diagnostic_metadata_label(column[1])
        require(all(column[6]!=1 for column in columns), 'diagnosticNonPersistentVirtualHiddenColumnsNotComparable')
        count=connection.execute('SELECT COUNT(*) FROM '+schema+'.'+quote_identifier(name)).fetchone()[0]
        tables[name]={'columns':columns,'rows':count}
    return rows,tables


def diagnostic_schema_delta(before,current):
    old={(row[0],row[1]):row for row in before};new={(row[0],row[1]):row for row in current}
    labels=lambda keys:[{'type':kind,'name':name} for kind,name in sorted(keys)]
    return {'matches':before==current,'beforeSha256':digest(before),'currentSha256':digest(current),
       'addedObjects':labels(set(new)-set(old)),'deletedObjects':labels(set(old)-set(new)),
       'modifiedObjects':labels(key for key in set(old)&set(new) if old[key]!=new[key])}


def diagnostic_time_ranges(connection,database,table,columns,from_sql,condition,alias):
    result={}
    for name,kind in DIAGNOSTIC_TIME_COLUMNS.get(database,{}).get(table,{}).items():
        if name not in columns:continue
        value='_ops_safe_time('+alias+'.'+quote_identifier(name)+',?)'
        sql='SELECT COUNT(*),COUNT('+value+'),MIN('+value+'),MAX('+value+') '+from_sql+' WHERE '+condition
        total,valid,minimum,maximum=connection.execute(sql,(kind,kind,kind)).fetchone()
        result[name]={'rowsInScope':total,'validTimeValues':valid,'minimumUtc':minimum,'maximumUtc':maximum}
    return result


def diagnostic_table_delta(connection,database,table,before,current):
    columns=before['columns'];names=[column[1] for column in columns]
    require(columns==current['columns'], 'diagnosticSameExtendedColumnSchemaForRowPairing')
    pk=[column[1] for column in sorted(columns,key=lambda column:column[5]) if column[5]>0]
    old_table='baseline.'+quote_identifier(table);new_table='main.'+quote_identifier(table)
    nulls=' OR '.join(quote_identifier(name)+' IS NULL' for name in pk)
    keyed=bool(pk) and all(connection.execute('SELECT COUNT(*) FROM '+source+' WHERE '+nulls).fetchone()[0]==0
                          for source in [old_table,new_table])
    if not keyed:
        fields=','.join(quote_identifier(name) for name in names)
        fingerprint='_ops_row_fingerprint('+fields+')'
        old='SELECT '+fingerprint+' AS h,COUNT(*) AS n FROM '+old_table+' GROUP BY '+fingerprint+' COLLATE BINARY'
        new='SELECT '+fingerprint+' AS h,COUNT(*) AS n FROM '+new_table+' GROUP BY '+fingerprint+' COLLATE BINARY'
        sql='WITH old_rows AS ('+old+'),new_rows AS ('+new+'),deltas AS (SELECT h,SUM(n) AS d FROM (SELECT h,-n AS n FROM old_rows UNION ALL SELECT h,n FROM new_rows) GROUP BY h COLLATE BINARY) SELECT COALESCE(SUM(CASE WHEN d>0 THEN d ELSE 0 END),0),COALESCE(SUM(CASE WHEN d<0 THEN -d ELSE 0 END),0) FROM deltas'
        added,deleted=connection.execute(sql).fetchone()
        return {'beforeRows':before['rows'],'currentRows':current['rows'],'pairing':'typed-full-row-multiset-no-nonnull-primary-key',
           'added':added,'deleted':deleted,'modified':None,'changedColumnCounts':{name:None for name in names},
           'rowsUnchanged':added==deleted==0,'completeFullRowMultisetCompared':True,
           'modifiedCountIndeterminateWithoutStableKey':True,'timeRanges':{}}
    # Native PK predicates retain the real PK index and its collation. The UDF
    # then enforces exact typed values without SQLite coercion or NOCASE folding.
    native=' AND '.join('c.'+quote_identifier(name)+' IS b.'+quote_identifier(name) for name in pk)
    exact=' AND '.join('_ops_cell_equal(c.'+quote_identifier(name)+',b.'+quote_identifier(name)+')=1' for name in pk)
    join=native+' AND '+exact
    equal=['_ops_cell_equal(c.'+quote_identifier(name)+',b.'+quote_identifier(name)+')' for name in names]
    different='NOT ('+' AND '.join(equal)+')'
    from_sql='FROM '+new_table+' AS c JOIN '+old_table+' AS b ON '+join
    projections=['COUNT(*)','COALESCE(SUM('+different+'),0)']+['COALESCE(SUM(1-'+item+'),0)' for item in equal]
    row=connection.execute('SELECT '+','.join(projections)+' '+from_sql).fetchone()
    matched,modified,*changes=row;added=current['rows']-matched;deleted=before['rows']-matched
    require(all(type(value) is int and value>=0 for value in [matched,modified,added,deleted,*changes])
            and modified<=matched and all(value<=modified for value in changes), 'diagnosticKeyedCounterInvariants')
    ranges={}
    if added:
        ranges['addedCurrent']=diagnostic_time_ranges(connection,database,table,names,'FROM '+new_table+' AS c',
            'NOT EXISTS (SELECT 1 FROM '+old_table+' AS b WHERE '+join+')','c')
    if deleted:
        ranges['deletedBefore']=diagnostic_time_ranges(connection,database,table,names,'FROM '+old_table+' AS b',
            'NOT EXISTS (SELECT 1 FROM '+new_table+' AS c WHERE '+join+')','b')
    if modified:
        ranges['modifiedBefore']=diagnostic_time_ranges(connection,database,table,names,from_sql,different,'b')
        ranges['modifiedCurrent']=diagnostic_time_ranges(connection,database,table,names,from_sql,different,'c')
    return {'beforeRows':before['rows'],'currentRows':current['rows'],'pairing':'declared-nonnull-primary-key-plus-exact-typed-equality',
       'added':added,'deleted':deleted,'modified':modified,'changedColumnCounts':dict(zip(names,changes)),
       'rowsUnchanged':added==deleted==modified==0,'completeFullRowMultisetCompared':True,
       'modifiedCountIndeterminateWithoutStableKey':False,'timeRanges':ranges}


def diagnostic_database_delta(connection,database,original):
    old_schema,old_tables=diagnostic_schema(connection,'baseline');new_schema,new_tables=diagnostic_schema(connection,'main')
    require(digest(old_schema)==original['schemaSha256'] and set(old_tables)==set(original['tables']), 'diagnosticSealedPrivateSchemaMatchesOriginalAudit')
    require(all(metadata['rows']==original['tables'][name]['rows'] and digest(metadata['columns'])==original['tables'][name]['columnsSha256']
                for name,metadata in old_tables.items()), 'diagnosticSealedPrivateCountsAndColumnsMatchOriginalAudit')
    schema=diagnostic_schema_delta(old_schema,new_schema)
    if not schema['matches'] or any(old_tables.get(name,{}).get('columns')!=new_tables.get(name,{}).get('columns') for name in set(old_tables)|set(new_tables)):
        return {'schema':schema,'comparisonComplete':False,'tableRowMatchingSkippedBecauseSchemaChanged':True,
          'beforeTableCounts':{name:value['rows'] for name,value in old_tables.items()},
          'currentTableCounts':{name:value['rows'] for name,value in new_tables.items()},'tables':{}}
    tables={name:diagnostic_table_delta(connection,database,name,old_tables[name],new_tables[name]) for name in old_tables}
    return {'schema':schema,'comparisonComplete':True,'tables':tables,
            'changedTables':[name for name,value in tables.items() if not value['rowsUnchanged']]}


def diagnostic_connections(tree,directory,names,stack):
    result={}
    for name in names:
        live=tree/name;private=directory/'sqlite-snapshots'/name
        connection=stack.enter_context(contextlib.closing(sqlite3.connect(live.as_uri()+'?mode=ro',uri=True,timeout=15)))
        connection.execute('PRAGMA query_only=ON');connection.execute('PRAGMA temp_store=MEMORY')
        connection.execute('ATTACH DATABASE ? AS baseline',(private.as_uri()+'?mode=ro&immutable=1',))
        require(connection.execute('PRAGMA query_only').fetchone()==(1,), 'diagnosticConnectionReadOnly')
        connection.create_function('_ops_cell_equal',2,diagnostic_cell_equal,deterministic=True)
        connection.create_function('_ops_row_fingerprint',-1,lambda *values:digest([sqlite_value(value) for value in values]),deterministic=True)
        connection.create_function('_ops_safe_time',2,diagnostic_time,deterministic=True)
        connection.execute('BEGIN');connection.execute('SELECT COUNT(*) FROM main.sqlite_master').fetchone()
        connection.execute('SELECT COUNT(*) FROM baseline.sqlite_master').fetchone()
        result[name]=connection
    return result


def diagnose(target,path):
    require(git_commit()==git_commit('origin/main')==PRE_DEPLOY_COMMIT==target, 'diagnosticExactPreDeployMain')
    expected=tested_source_guard(target)
    directory,before,seal_before=diagnostic_private_backup(path)
    app,tree,runtime,private=runtime_context();others=other_containers()
    names=discover_databases(tree);require(set(names)==set(before['sqlite']), 'diagnosticLiveDatabaseInventoryUnchanged')
    snapshot_started=datetime.datetime.now(datetime.timezone.utc).isoformat()
    with contextlib.ExitStack() as stack:
        connections=diagnostic_connections(tree,directory,names,stack)
        databases={name:diagnostic_database_delta(connections[name],name,before['sqlite'][name]) for name in names}
    runtime_files=actual_runtime_files(app,expected)
    _,original_again,seal_after=diagnostic_private_backup(path)
    checks={'originalPrivateSealAndFilesUnchanged':seal_after==seal_before,
      'originalStrictFalseUnchanged':original_again['strictVerificationPassed'] is False,
      'sourceStillExactPreDeployMain':git_commit()==git_commit('origin/main')==target,
      'runtimeUnchangedFromFirstBackup':runtime==before['runtime'],
      'runtimeStableDuringDiagnosis':runtime_context()[2]==runtime,
      'allOtherContainersUnchangedFromFirstBackup':others==before['otherContainers'],
      'allOtherContainersStableDuringDiagnosis':other_containers()==others,
      'actualNginxAuthUnchanged':{key:raw_hash(value) for key,value in nginx_material().items()}==before['nginx'],
      'privateEnvironmentUnchanged':file_hash(ROOT/'.env.cloud.production')==file_hash(directory/'env.before'),
      'applicationStartupAndDeploymentConfigurationUnchanged':configuration()==before['configuration']}
    return {'mode':'diagnose','diagnosticComplete':all(checks.values()) and all(value['comparisonComplete'] for value in databases.values()),
      'originalBackup':str(directory),'originalStrictVerificationPassed':False,'originalStrictResultPreserved':True,
      'comparisonWindow':'retained first backup snapshots to this diagnostic read snapshot',
      'originalBackupWindowAfterSnapshotNotRetained':True,'originalWindowChangedTablesNotReconstructed':True,
      'originalFailureAttributed':False,'individuallyConsistentCurrentSQLiteSnapshots':True,'crossDatabaseAtomicSnapshotClaimed':False,
      'snapshotReadStartedAtUtc':snapshot_started,'diagnosticFinishedAtUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),
      'privateSealVerified':True,'originalPrivateSnapshotsByteSealAndIntegrityVerified':True,
      'exactTypedCellSemanticsMatchOriginalSQLiteAudit':True,'runtimeFilesVerified':runtime_files,
      'sourceCommit':target,'checks':checks,'databases':databases,'businessWritesPerformed':False,
      'businessHttpRequestsPerformed':False,'originalBackupFilesWritten':False,'conflictChoicesSubmitted':False,
      'stockOrProductIdsChangedByOperator':False,'automaticRestoreOrRecreatePerformed':False,
      'deploymentAuthorizedByThisResult':False}


def main(argv):
    global TESTED_SOURCE
    require(len(argv)==5, 'exactFiveArguments')
    mode,before,target,path,pin = argv
    require(mode in {'backup','verify','diagnose'} and before==PRE_DEPLOY_COMMIT and bool(re.fullmatch('[a-f0-9]{40}',target)), 'exactModeAndCommitArguments')
    TESTED_SOURCE = json.loads(pathlib.Path(pin).read_bytes())
    require(TESTED_SOURCE.get('finalPinFrozen') is True, 'finalSourcePinEmptyFailClosed')
    require((mode=='backup' and target==before and not path) or
            (mode=='verify' and target!=before and bool(re.fullmatch('/opt/rr-portal/deploy/backups/printlink-pre-940-[0-9]{8}T[0-9]{12}Z',path))) or
            (mode=='diagnose' and target==before and path==DIAGNOSTIC_BACKUP_PATH), 'exactModeSpecificArguments')
    if mode=='diagnose':require(file_hash(pathlib.Path(pin))==DIAGNOSTIC_PIN_SHA256, 'diagnosticExactReviewedFrozenPinBytes')
    os.umask(0o077)
    result = backup(target) if mode=='backup' else diagnose(target,path) if mode=='diagnose' else verify(target,path)
    print(json.dumps(result,ensure_ascii=True))
    return 0 if (result['diagnosticComplete'] if mode=='diagnose' else result['strictVerificationPassed']) else 1


if __name__=='__main__':
    try: sys.exit(main(sys.argv[1:]))
    except Exception as error:
        print(json.dumps({'failed':True,'safeError':'PRINTLINK_940_OPS_FAILED','failedCheck':FAILED_CHECK,
          'errorType':type(error).__name__ if type(error).__name__ in {'RuntimeError','ValueError','KeyError','TypeError','FileNotFoundError','OperationalError'} else 'Other',
          'businessWritesPerformed':False,'automaticRecoveryPerformed':False}))
        sys.exit(1)
