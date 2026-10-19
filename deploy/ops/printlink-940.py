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


def main(argv):
    global TESTED_SOURCE
    require(len(argv)==5, 'exactFiveArguments')
    mode,before,target,path,pin = argv
    require(mode in {'backup','verify'} and before==PRE_DEPLOY_COMMIT and bool(re.fullmatch('[a-f0-9]{40}',target)), 'exactModeAndCommitArguments')
    TESTED_SOURCE = json.loads(pathlib.Path(pin).read_bytes())
    require(TESTED_SOURCE.get('finalPinFrozen') is True, 'finalSourcePinEmptyFailClosed')
    require((mode=='backup' and target==before and not path) or (mode=='verify' and target!=before and bool(re.fullmatch('/opt/rr-portal/deploy/backups/printlink-pre-940-[0-9]{8}T[0-9]{12}Z',path))), 'exactModeSpecificArguments')
    os.umask(0o077)
    result = backup(target) if mode=='backup' else verify(target,path)
    print(json.dumps(result,ensure_ascii=True))
    return 0 if result['strictVerificationPassed'] else 1


if __name__=='__main__':
    try: sys.exit(main(sys.argv[1:]))
    except Exception as error:
        print(json.dumps({'failed':True,'safeError':'PRINTLINK_940_OPS_FAILED','failedCheck':FAILED_CHECK,
          'errorType':type(error).__name__ if type(error).__name__ in {'RuntimeError','ValueError','KeyError','TypeError','FileNotFoundError','OperationalError'} else 'Other',
          'businessWritesPerformed':False,'automaticRecoveryPerformed':False}))
        sys.exit(1)
