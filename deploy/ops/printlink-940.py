"""PR940 private backup and read-only verification. No deployment or business writes.

SQLite backup API copies include committed WAL data. Raw DB/WAL/SHM bytes are also
retained as evidence, but are not used as portable databases or compared as logical
business data. Every table and every durable non-SQLite file is compared exactly.
"""
import base64
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
    required={'sqlite-snapshots/'+name for name in before['sqlite']}
    allowed={name+suffix for name in required for suffix in ['', '-wal', '-shm']}
    actual={name for name in files if name.startswith('sqlite-snapshots/')}
    require(required<=actual<=allowed, 'diagnosticExactOriginalSQLiteSnapshotFiles')
    verify_archive(directory/'runtime-raw.tar',before['rawInventory'])
    return directory,before,{'manifestSha256':file_hash(manifest_file),'files':manifest}


def diagnostic_snapshot_proof(directory,original):
    """Sealed zero WAL only; immutable main must contain the entire baseline."""
    result={}
    for name,audit in original.items():
        main=directory/'sqlite-snapshots'/name
        sizes={name+suffix:(main.parent/(main.name+suffix)).stat().st_size
               for suffix in ['', '-wal', '-shm'] if (main.parent/(main.name+suffix)).exists()}
        require(sizes.get(name+'-wal',0)==0, 'diagnosticSealedSnapshotsHaveNoNonemptyWAL')
        with contextlib.closing(sqlite3.connect(main.as_uri()+'?mode=ro&immutable=1',uri=True)) as connection:
            connection.execute('PRAGMA query_only=ON')
            require(sqlite_audit(connection)==audit, 'diagnosticImmutableMainMatchesCompleteOriginalTypedAudit')
        result[name]={'filesBytes':sizes,'immutableMainMatchesCompleteOriginalTypedAudit':True}
    return result


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
    snapshot_proof=diagnostic_snapshot_proof(directory,before['sqlite'])
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
      'originalSQLiteSnapshotProof':snapshot_proof,
      'exactTypedCellSemanticsMatchOriginalSQLiteAudit':True,'runtimeFilesVerified':runtime_files,
      'sourceCommit':target,'checks':checks,'databases':databases,'businessWritesPerformed':False,
      'businessHttpRequestsPerformed':False,'originalBackupFilesWritten':False,'conflictChoicesSubmitted':False,
      'stockOrProductIdsChangedByOperator':False,'automaticRestoreOrRecreatePerformed':False,
      'deploymentAuthorizedByThisResult':False}


def context_lifecycle_delta(before,current):
    fields={'containerId','imageId','startedAt','createdAt','restartCount','running','status','oomKilled','health'}
    for values in [before,current]:
        require(isinstance(values,dict), 'contextLifecycleServiceMapping')
        for service,value in values.items():
            require(isinstance(service,str) and bool(re.fullmatch('[A-Za-z0-9][A-Za-z0-9_.-]{0,127}',service))
                    and isinstance(value,dict) and set(value)==fields, 'contextOnlySafeServiceAndLifecycleFields')
            require(isinstance(value['containerId'],str) and bool(re.fullmatch('[a-f0-9]{64}',value['containerId']))
                    and isinstance(value['imageId'],str) and bool(re.fullmatch('sha256:[a-f0-9]{64}',value['imageId'])), 'contextSafeContainerAndImageIds')
            for name in ['startedAt','createdAt']:
                require(isinstance(value[name],str) and bool(re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z',value[name])),
                        'contextSafeLifecycleTimestamp')
                parse_timestamp(value[name])
            require(type(value['restartCount']) is int and value['restartCount']>=0
                    and type(value['running']) is bool and type(value['oomKilled']) is bool
                    and value['status'] in {'created','restarting','running','removing','paused','exited','dead'}
                    and value['health'] in {'none','starting','healthy','unhealthy'}, 'contextSafeLifecycleScalars')
    differences={}
    for service in sorted(set(before)|set(current)):
        changes={name:{'before':before.get(service,{}).get(name),'current':current.get(service,{}).get(name)}
                 for name in sorted(fields) if before.get(service,{}).get(name)!=current.get(service,{}).get(name)}
        if changes:differences[service]=changes
    return {'beforeServices':len(before),'currentServices':len(current),
      'addedServices':sorted(set(current)-set(before)),'removedServices':sorted(set(before)-set(current)),
      'changedServices':sorted(differences),'lifecycleDifferences':differences}


def context(target,path):
    require(git_commit()==git_commit('origin/main')==PRE_DEPLOY_COMMIT==target, 'contextExactPreDeployMain')
    tested_source_guard(target)
    directory,before,seal_before=diagnostic_private_backup(path)
    others=other_containers()
    delta=context_lifecycle_delta(before['otherContainers'],others)
    _,original_again,seal_after=diagnostic_private_backup(path)
    after=other_containers();context_lifecycle_delta(others,after)
    checks={'originalPrivateSealAndFilesUnchanged':seal_before==seal_after,
      'originalStrictFalseUnchanged':original_again['strictVerificationPassed'] is False,
      'originalOtherContainersBaselineUnchanged':original_again['otherContainers']==before['otherContainers'],
      'sourceStillExactPreDeployMain':git_commit()==git_commit('origin/main')==target,
      'allOtherContainersStableDuringContext':others==after}
    return {'mode':'context','contextComplete':all(checks.values()),'sourceCommit':target,
      'originalBackup':str(directory),'originalStrictVerificationPassed':False,'originalStrictResultPreserved':True,
      'currentMatchesOriginalOtherContainers':others==before['otherContainers'],'checks':checks,
      'otherContainerLifecycleDelta':delta,'finishedAtUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),
      'businessWritesPerformed':False,'businessHttpRequestsPerformed':False,'originalBackupFilesWritten':False,
      'automaticRestoreOrRecreatePerformed':False,'deploymentAuthorizedByThisResult':False}


# DRAFT ONLY: insert before main() in the reviewed PR940 ops helper.
# This adds no business writes and does not alter backup/selected_backup/verify.
ACTIVE_RESULT_NAME = 'printlink-verify-active-940-first-20261019T011955726437Z'
ACTIVE_TABLES = {'collector_events', 'collector_stations', 'collector_devices'}
ACTIVE_STATES = {'RUNNING', 'FINISH', 'FAILED', 'PAUSE', 'IDLE', 'UNKNOWN'}
ACTIVE_STRINGS = {'sourceMachine':32, 'name':256, 'gcodeFile':256, 'jobName':256, 'error':256}
ACTIVE_NUMBERS = {'remainingTime', 'nozzleTemp', 'nozzleTarget', 'bedTemp', 'bedTarget',
                  'layerNum', 'totalLayers', 'currentHeight', 'laserPowerMw'}


def active_timestamp(value):
    # Conservative acceptance contract: collector-generated canonical UTC ms.
    # The HTTP route accepts more date formats; those require separate review.
    require(isinstance(value,str) and bool(re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z',value)),
            'activeCanonicalUTCMillisecondTimestamp')
    parsed=parse_timestamp(value)
    require(parsed.isoformat(timespec='milliseconds').replace('+00:00','Z')==value, 'activeValidCalendarTimestamp')
    return parsed


def active_payload(value):
    require(isinstance(value,str), 'activeDevicePayloadIsText')
    def pairs(items):
        result={}
        for key,item in items:
            require(key not in result, 'activeNoDuplicateJSONKeys')
            result[key]=item
        return result
    def bad_constant(_):
        require(False, 'activeNoNonfiniteJSONConstants')
    payload=json.loads(value,object_pairs_hook=pairs,parse_constant=bad_constant)
    required={'state','progress','connected'}
    require(type(payload) is dict and required<=set(payload)<=required|set(ACTIVE_STRINGS)|ACTIVE_NUMBERS,
            'activeExactDeviceDisplayPayloadFields')
    require(payload['state'] in ACTIVE_STATES and type(payload['connected']) is bool,
            'activeDeviceStateAndConnectedTypes')
    for key,number in payload.items():
        if key in ACTIVE_STRINGS:
            require(isinstance(number,str) and len(number.encode('utf-16-le','surrogatepass'))//2<=ACTIVE_STRINGS[key],
                    'activeDeviceStringWithinJavaScriptUTF16Limit')
        elif key in ACTIVE_NUMBERS or key=='progress':
            require(type(number) in {int,float} and math.isfinite(number) and 0<=number<=(100 if key=='progress' else 10000000),
                    'activeFiniteBoundedDeviceNumber')
    return True


def active_telemetry(connection,reference):
    require(reference in {'baseline','probe'}, 'activeFixedReferenceAlias')
    contract={'collector_stations':['id','last_seen','sequence'], 'collector_devices':['station','machine','payload','observed'],
              'collector_events':['id','station','received']}
    for table,columns in contract.items():
        for schema in [reference,'main']:
            metadata=connection.execute('PRAGMA '+schema+'.table_xinfo('+quote_identifier(table)+')').fetchall()
            require([row[1] for row in metadata]==columns, 'activeExactTelemetryColumnContract')
    def rows(schema,table,columns):
        return connection.execute('SELECT '+','.join(quote_identifier(c) for c in columns)+' FROM '+schema+'.'+quote_identifier(table))
    def text(value,limit=None):
        return isinstance(value,str) and bool(value) and (limit is None or len(value.encode('utf-16-le','surrogatepass'))//2<=limit)
    stations={}
    for schema in [reference,'main']:
        values={}
        for identifier,last_seen,sequence in rows(schema,'collector_stations',['id','last_seen','sequence']):
            require(text(identifier) and type(sequence) is int and 0<=sequence<=9007199254740991, 'activeStationKeyAndSafeSequence')
            require(identifier not in values, 'activeUniqueStationKey')
            values[identifier]=(last_seen,active_timestamp(last_seen),sequence)
        stations[schema]=values
    require(set(stations[reference])==set(stations['main']), 'activeStationPrimaryKeySetUnchanged')
    changed_stations=set()
    for identifier,(stamp,parsed,sequence) in stations['main'].items():
        old_stamp,old_parsed,old_sequence=stations[reference][identifier]
        require(stamp>=old_stamp and parsed>=old_parsed and sequence>=old_sequence, 'activeStationTimeAndSequenceNondecreasing')
        if (stamp,sequence)!=(old_stamp,old_sequence):changed_stations.add(identifier)
    devices={}
    for schema in [reference,'main']:
        values={}
        for station,machine,payload,observed in rows(schema,'collector_devices',['station','machine','payload','observed']):
            require(text(station) and station in stations[schema] and text(machine) and bool(re.fullmatch(r'[0-9]+',machine)),
                    'activeExistingStationAndNumericMachineKey')
            require((station,machine) not in values, 'activeUniqueDeviceKey')
            active_payload(payload)
            values[(station,machine)]=(payload,observed,active_timestamp(observed))
        devices[schema]=values
    require(set(devices[reference])==set(devices['main']), 'activeDevicePrimaryKeySetUnchanged')
    changed_devices={}
    for key,(payload,observed,parsed) in devices['main'].items():
        old_payload,old_observed,old_parsed=devices[reference][key]
        require(observed>=old_observed and parsed>=old_parsed, 'activeDeviceObservedNondecreasing')
        if payload!=old_payload or observed!=old_observed:
            require(observed>old_observed and parsed>old_parsed, 'activeChangedDeviceRequiresStrictlyNewerObservation')
            changed_devices[key]=parsed
    # Index lookup by native PK, then exact typed equality on every original cell.
    missing=connection.execute('SELECT COUNT(*) FROM '+reference+'.collector_events b WHERE NOT EXISTS '
        '(SELECT 1 FROM main.collector_events c WHERE c.id=b.id AND _ops_cell_equal(c.id,b.id)=1 '
        'AND _ops_cell_equal(c.station,b.station)=1 AND _ops_cell_equal(c.received,b.received)=1)').fetchone()[0]
    require(missing==0, 'activeEveryOldCollectorEventExactlyPreserved')
    added=0;newest_event={}
    query='SELECT c.id,c.station,c.received FROM main.collector_events c WHERE NOT EXISTS '
    query+='(SELECT 1 FROM '+reference+'.collector_events b WHERE b.id=c.id AND _ops_cell_equal(b.id,c.id)=1)'
    for identifier,station,received in connection.execute(query):
        require(text(identifier,80) and text(station) and station in stations['main'], 'activeNewEventHasExistingStationAndBoundedID')
        stamp=active_timestamp(received)
        require(stations[reference][station][1]<=stamp<=stations['main'][station][1], 'activeNewEventWithinStationHeartbeatWindow')
        newest_event[station]=max(newest_event.get(station,stamp),stamp)
        added+=1
    require(changed_stations<=set(newest_event), 'activeChangedStationHasNewEvent')
    require(all(station in newest_event and observed<=newest_event[station]+datetime.timedelta(seconds=60)
                for (station,_),observed in changed_devices.items()), 'activeChangedDeviceHasNewStationEventWithinFutureLimit')
    return {'passed':True,'appendedEvents':added,'everyOldEventExactlyPreserved':True,
            'stationAndDevicePrimaryKeySetsUnchanged':True,'timestampsAndSequencesNondecreasing':True,
            'devicePayloadsMatchExactDisplayContract':True}


def active_read_snapshot(tree,directory,original,output,probe=None,probe_audit=None):
    names=discover_databases(tree)
    require(set(names)==set(original), 'activeExactDatabaseInventory')
    audits={};deltas={};gates={};pairwise={}
    with contextlib.ExitStack() as stack:
        connections=diagnostic_connections(tree,directory,names,stack)
        for name,connection in connections.items():
            # Audit, exact original delta, telemetry validation and copied evidence
            # all observe this same pinned main transaction, including valid WAL.
            audit=sqlite_audit(connection);delta=diagnostic_database_delta(connection,name,original[name])
            audits[name]=audit;deltas[name]=delta
            # Preserve the first read and its exact safe diff before any semantic
            # gate can reject it. A rejected attempt must not need a fresh sample.
            destination=output/'sqlite-snapshots'/name
            destination.parent.mkdir(mode=0o700,parents=True,exist_ok=True)
            require(not destination.exists(), 'activeNewEvidenceSnapshotOnly')
            with contextlib.closing(sqlite3.connect(destination)) as copy:
                connection.backup(copy)
                require(sqlite_audit(copy)==audit, 'activeEvidenceCopyMatchesSamePinnedFullTypedAudit')
            destination.chmod(0o600)
            private_write(destination.with_name(destination.name+'.audit-delta.json'),encoded({'audit':audit,'typedDelta':delta}))
            cloud=name=='orders/printlink.sqlite'
            allowed=ACTIVE_TABLES if cloud else set()
            require(audit['schemaSha256']==original[name]['schemaSha256'] and set(audit['tables'])==set(original[name]['tables'])
                    and all(value['columnsSha256']==original[name]['tables'][table]['columnsSha256'] for table,value in audit['tables'].items()),
                    'activeAllSchemasAndColumnsExactlyUnchanged')
            require(not cloud or ACTIVE_TABLES<=set(audit['tables']), 'activeAllThreeTelemetryTablesPresent')
            require(all(value==original[name]['tables'][table] for table,value in audit['tables'].items() if table not in allowed),
                    'activeEveryNonTelemetryTableAndTypedFullRowExactlyUnchanged')
            gates[name]=active_telemetry(connection,'baseline') if cloud else {'passed':True,'allTablesExactlyUnchanged':True}
            if probe:
                if cloud:
                    current=probe/'sqlite-snapshots'/name
                    connection.execute('ATTACH DATABASE ? AS probe',(current.as_uri()+'?mode=ro&immutable=1',))
                    pairwise[name]=active_telemetry(connection,'probe')
                else:
                    require(audit==probe_audit[name], 'activeProductionStableDuringProbe')
                    pairwise[name]={'passed':True,'allTablesExactlyUnchanged':True}
    diagnostic_snapshot_proof(output,audits)
    return audits,deltas,gates,pairwise


def verify_active(target,path):
    require(path==DIAGNOSTIC_BACKUP_PATH, 'activeExactRetainedOriginalBackupOnly')
    directory=pathlib.Path(path)
    os.umask(0o077)
    require(BACKUPS.is_dir() and not BACKUPS.is_symlink(), 'activePrivateResultRootIsRealDirectory')
    result_directory=BACKUPS/ACTIVE_RESULT_NAME
    # Deterministic, exclusive first attempt. Errors and partial artifacts block a
    # second invocation; never replace the original seal or a failed first result.
    result_directory.mkdir(mode=0o700)
    private_write(result_directory/'attempt.json',encoded({'mode':'verify-active','target':target,'originalBackup':str(directory)}))
    print(json.dumps({'activeVerificationStarted':str(result_directory),'businessWritesPerformed':False}),flush=True)
    try:
        directory,before,original_seal=diagnostic_private_backup(path)
        original_proof=diagnostic_snapshot_proof(directory,before['sqlite'])
        require(git_commit()==git_commit('origin/main')==target and target!=PRE_DEPLOY_COMMIT, 'verifyActiveAtExactDeployedMain')
        expected=tested_source_guard(target,True)
        app,tree,runtime,private=runtime_context()
        private_write(result_directory/'runtime.private.json',encoded(private))
        current_sqlite,current_delta,current_gate,_=active_read_snapshot(tree,directory,before['sqlite'],result_directory/'current')
        current_raw=tree_inventory(tree);others=other_containers()
        nginx={k:raw_hash(v) for k,v in nginx_material().items()}
        runtime_count=actual_runtime_files(app,expected)
        probes=read_only_probes();production_ready=production_readiness(app)
        final_sqlite,final_delta,final_gate,pairwise=active_read_snapshot(tree,directory,before['sqlite'],result_directory/'final',result_directory/'current',current_sqlite)
        final_raw=tree_inventory(tree)
        checks={'everyTableAndFullRowUnchanged':current_sqlite==before['sqlite'],
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
        _,original_again,seal_after=diagnostic_private_backup(path)
        active_checks={key:value for key,value in checks.items() if key not in {'everyTableAndFullRowUnchanged','logicalSQLiteStableDuringProbe'}}
        active_checks.update({'originalSealAndStrictFalseUnchanged':seal_after==original_seal and original_again==before,
          'currentOnlyPermittedTelemetryChanges':all(v['passed'] for v in current_gate.values()),
          'finalOnlyPermittedTelemetryChanges':all(v['passed'] for v in final_gate.values()),
          'probeOnlyPermittedTelemetryChanges':all(v['passed'] for v in pairwise.values())})
        data_keys={'everyDurableFileByteUnchanged','durableFilesStableDuringProbe','originalSealAndStrictFalseUnchanged',
                   'currentOnlyPermittedTelemetryChanges','finalOnlyPermittedTelemetryChanges','probeOnlyPermittedTelemetryChanges'}
        lifecycle_delta={name:{'before':before['otherContainers'].get(name),'after':others.get(name)}
            for name in sorted(set(before['otherContainers'])|set(others)) if before['otherContainers'].get(name)!=others.get(name)}
        result={'mode':'verify-active','deployment':'PR940','sourceCommit':target,'backup':str(directory),'resultDirectory':str(result_directory),
          'baselineNonQuiescent':True,'originalStrictVerificationPassed':False,'strictVerificationPassed':False,
          'observedStrictChecksPassed':all(checks.values()),'checks':checks,'activeChecks':active_checks,
          'activeVerificationPassed':all(active_checks.values()),'beforeSQLite':before['sqlite'],'currentSQLite':current_sqlite,'finalSQLite':final_sqlite,
          'targetDataPreservationPassed':all(active_checks[key] for key in data_keys),'otherContainerLifecycleDelta':lifecycle_delta,
          'currentTypedDelta':current_delta,'finalTypedDelta':final_delta,'currentTelemetry':current_gate,'finalTelemetry':final_gate,'probeTelemetry':pairwise,
          'originalSQLiteSnapshotProof':original_proof,'printlinkBefore':before['runtime']['lifecycle'],'printlinkAfter':runtime['lifecycle'],
          'otherContainersBefore':before['otherContainers'],'otherContainersAfter':others,'runtimeFilesVerified':runtime_count,
          'probes':probes,'productionReadiness':production_ready,'crossDatabaseAtomicSnapshotClaimed':False,
          'originalBackupFilesWritten':False,'originalFailureAttributed':False,'businessWritesPerformed':False,
          'conflictChoicesSubmitted':False,'stockOrProductIdsChangedByOperator':False,'automaticRestoreOrRecreatePerformed':False}
        private_write(result_directory/'first-result.json',encoded(result))
        return result
    except Exception as error:
        private_write(result_directory/'first-result.json',encoded({'mode':'verify-active','failed':True,'failedCheck':FAILED_CHECK,
          'errorType':type(error).__name__,'strictVerificationPassed':False,'activeVerificationPassed':False,
          'targetDataPreservationPassed':False,
          'baselineNonQuiescent':True,'originalBackupFilesWritten':False,'businessWritesPerformed':False}))
        raise


RESULT_MAX_BYTES = 4*1024**2
RESULT_KEYS = {'activeChecks','activeVerificationPassed','automaticRestoreOrRecreatePerformed','backup',
 'baselineNonQuiescent','beforeSQLite','businessWritesPerformed','checks','conflictChoicesSubmitted',
 'crossDatabaseAtomicSnapshotClaimed','currentSQLite','currentTelemetry','currentTypedDelta','deployment',
 'finalSQLite','finalTelemetry','finalTypedDelta','mode','observedStrictChecksPassed','originalBackupFilesWritten',
 'originalFailureAttributed','originalSQLiteSnapshotProof','originalStrictVerificationPassed','otherContainerLifecycleDelta',
 'otherContainersAfter','otherContainersBefore','printlinkAfter','printlinkBefore','probeTelemetry','probes',
 'productionReadiness','resultDirectory','runtimeFilesVerified','sourceCommit','stockOrProductIdsChangedByOperator',
 'strictVerificationPassed','targetDataPreservationPassed'}
RESULT_ERROR_KEYS = {'mode','failed','failedCheck','errorType','strictVerificationPassed','activeVerificationPassed',
 'targetDataPreservationPassed','baselineNonQuiescent','originalBackupFilesWritten','businessWritesPerformed'}


def result_private_bytes(file):
    original=pathlib.Path(DIAGNOSTIC_BACKUP_PATH)
    first=BACKUPS/ACTIVE_RESULT_NAME/'first-result.json'
    require(file in {original/'manifest.json',original/'baseline.json',first}, 'resultOnlyThreeFixedPrivateFiles')
    require(BACKUPS.is_dir() and not BACKUPS.is_symlink() and file.parent.is_dir() and not file.parent.is_symlink()
            and stat.S_IMODE(file.parent.stat().st_mode)==0o700, 'resultExactPrivateDirectory')
    require(file.exists(), 'resultFirstOrOriginalFileMissingDoNotRerunVerification')
    metadata=file.lstat()
    require(not file.is_symlink() and stat.S_ISREG(metadata.st_mode) and stat.S_IMODE(metadata.st_mode)==0o600,
            'resultPrivateRegularFileNoSymlink')
    require(metadata.st_size<=RESULT_MAX_BYTES, 'resultFileAtMostFourMiBBeforeRead')
    fd=os.open(file,os.O_RDONLY|os.O_NOFOLLOW)
    with os.fdopen(fd,'rb') as stream:
        opened=os.fstat(stream.fileno())
        require(stat.S_ISREG(opened.st_mode) and stat.S_IMODE(opened.st_mode)==0o600
                and opened.st_size<=RESULT_MAX_BYTES, 'resultFileAtMostFourMiBAfterOpenBeforeRead')
        content=stream.read(RESULT_MAX_BYTES+1)
        after=os.fstat(stream.fileno())
        require((opened.st_dev,opened.st_ino,opened.st_size,opened.st_mtime_ns,opened.st_mode)==
                (after.st_dev,after.st_ino,after.st_size,after.st_mtime_ns,after.st_mode)
                and len(content)==opened.st_size, 'resultFileStableDuringBoundedRead')
    require((metadata.st_dev,metadata.st_ino,metadata.st_size,metadata.st_mtime_ns,metadata.st_mode)==
            (opened.st_dev,opened.st_ino,opened.st_size,opened.st_mtime_ns,opened.st_mode)
            and stat.S_IMODE(opened.st_mode)==0o600 and len(content)<=RESULT_MAX_BYTES,
            'resultExactStablePrivateFileRead')
    return content


def result_json(content):
    def pairs(items):
        value={}
        for key,item in items:
            require(key not in value, 'resultNoDuplicateJSONKeys')
            value[key]=item
        return value
    def bad_constant(_):require(False, 'resultNoNonfiniteJSONConstants')
    value=json.loads(content,object_pairs_hook=pairs,parse_constant=bad_constant)
    require(type(value) is dict, 'resultJSONObjectOnly')
    return value


def result_original_seal():
    original=pathlib.Path(DIAGNOSTIC_BACKUP_PATH)
    manifest_bytes=result_private_bytes(original/'manifest.json');baseline_bytes=result_private_bytes(original/'baseline.json')
    manifest=result_json(manifest_bytes);baseline=result_json(baseline_bytes)
    require(manifest.get('baseline.json')==raw_hash(baseline_bytes), 'resultOriginalBaselineMatchesManifest')
    require(baseline.get('deployment')=='PR940' and baseline.get('sourceCommit')==PRE_DEPLOY_COMMIT
            and baseline.get('strictVerificationPassed') is False, 'resultOriginalStrictFalsePreserved')
    return {'manifestSha256':raw_hash(manifest_bytes),'baselineSha256':raw_hash(baseline_bytes)}


def read_result(target,path):
    require(target=='1c295d6418a64a1610b9075acd4da2a38d875328' and path==DIAGNOSTIC_BACKUP_PATH,
            'resultExactTargetAndOriginalBackup')
    require(git_commit()==git_commit('origin/main')==target, 'resultExactDeployedMain')
    tested_source_guard(target,True)
    before=result_original_seal()
    file=BACKUPS/ACTIVE_RESULT_NAME/'first-result.json';content=result_private_bytes(file);value=result_json(content)
    error=value.get('failed') is True
    require(set(value)==(RESULT_ERROR_KEYS if error else RESULT_KEYS), 'resultOnlyReviewedTopLevelKeySet')
    require(value['mode']=='verify-active' and value['strictVerificationPassed'] is False
            and value['baselineNonQuiescent'] is True and value['originalBackupFilesWritten'] is False
            and value['businessWritesPerformed'] is False
            and all(type(value[key]) is bool for key in ['activeVerificationPassed','targetDataPreservationPassed']),
            'resultOriginalVerificationStatusTypesAndReadOnlyFacts')
    if error:
        require(value['activeVerificationPassed'] is False and value['targetDataPreservationPassed'] is False
                and isinstance(value['failedCheck'],str) and bool(re.fullmatch('[A-Za-z][A-Za-z0-9]{0,127}',value['failedCheck']))
                and isinstance(value['errorType'],str) and bool(re.fullmatch('[A-Za-z_][A-Za-z0-9_]{0,63}',value['errorType'])),
                'resultSafeRecordedFailureOnly')
    else:
        require(value['deployment']=='PR940' and value['sourceCommit']==target and value['backup']==path
                and value['resultDirectory']==str(file.parent) and value['originalStrictVerificationPassed'] is False
                and all(value[key] is False for key in ['conflictChoicesSubmitted','stockOrProductIdsChangedByOperator',
                  'automaticRestoreOrRecreatePerformed']), 'resultExactRecordedDeploymentAndPaths')
    after=result_original_seal()
    require(after==before, 'originalManifestAndBaselineUnchanged')
    require(git_commit()==git_commit('origin/main')==target, 'resultSourceStable')
    full_sha=raw_hash(content);payload=base64.b64encode(content).decode('ascii')
    chunks=[payload[index:index+5000] for index in range(0,len(payload),5000)]
    envelopes=[encoded({'mode':'result-part','part':index+1,'total':len(chunks),'fullSha256':full_sha,
      'encoding':'base64-original-result-bytes','data':chunk}) for index,chunk in enumerate(chunks)]
    require(all(len(envelope)<=6000 for envelope in envelopes), 'resultEveryTransportLineAtMost6000Bytes')
    for envelope in envelopes:print(envelope.decode('ascii'),flush=True)
    return {'mode':'result','resultReceiptComplete':True,'originalResultPath':str(file),'originalResultBytes':len(content),
      'originalResultSha256':full_sha,'encodedBase64Sha256':raw_hash(payload.encode('ascii')),'totalParts':len(chunks),
      'originalManifestAndBaselineUnchanged':True,'originalManifestAndBaselineSha256':before,
      'sourceStable':True,'originalStrictVerificationPassed':False,'recordedResultIsError':error,
      'recordedActiveVerificationPassed':value['activeVerificationPassed'],
      'recordedTargetDataPreservationPassed':value['targetDataPreservationPassed'],
      'businessWritesPerformed':False,'originalBackupFilesWritten':False,'firstResultFilesWritten':False,
      'verificationRerun':False}


def main(argv):
    global TESTED_SOURCE
    require(len(argv)==5, 'exactFiveArguments')
    mode,before,target,path,pin = argv
    require(mode in {'backup','verify','diagnose','context','verify-active','result'} and before==PRE_DEPLOY_COMMIT and bool(re.fullmatch('[a-f0-9]{40}',target)), 'exactModeAndCommitArguments')
    TESTED_SOURCE = json.loads(pathlib.Path(pin).read_bytes())
    require(TESTED_SOURCE.get('finalPinFrozen') is True, 'finalSourcePinEmptyFailClosed')
    require((mode=='backup' and target==before and not path) or
            (mode=='verify' and target!=before and bool(re.fullmatch('/opt/rr-portal/deploy/backups/printlink-pre-940-[0-9]{8}T[0-9]{12}Z',path))) or
            (mode in {'diagnose','context'} and target==before and path==DIAGNOSTIC_BACKUP_PATH) or
            (mode in {'verify-active','result'} and target=='1c295d6418a64a1610b9075acd4da2a38d875328' and target!=before and path==DIAGNOSTIC_BACKUP_PATH), 'exactModeSpecificArguments')
    if mode in {'diagnose','context','verify-active','result'}:require(file_hash(pathlib.Path(pin))==DIAGNOSTIC_PIN_SHA256, 'diagnosticExactReviewedFrozenPinBytes')
    os.umask(0o077)
    result = backup(target) if mode=='backup' else diagnose(target,path) if mode=='diagnose' else context(target,path) if mode=='context' else verify_active(target,path) if mode=='verify-active' else read_result(target,path) if mode=='result' else verify(target,path)
    print(json.dumps(result,ensure_ascii=True))
    return 0 if (result['diagnosticComplete'] if mode=='diagnose' else result['contextComplete'] if mode=='context' else result['activeVerificationPassed'] if mode=='verify-active' else result['resultReceiptComplete'] if mode=='result' else result['strictVerificationPassed']) else 1


if __name__=='__main__':
    try: sys.exit(main(sys.argv[1:]))
    except Exception as error:
        print(json.dumps({'failed':True,'safeError':'PRINTLINK_940_OPS_FAILED','failedCheck':FAILED_CHECK,
          'errorType':type(error).__name__ if type(error).__name__ in {'RuntimeError','ValueError','KeyError','TypeError','FileNotFoundError','OperationalError'} else 'Other',
          'businessWritesPerformed':False,'automaticRecoveryPerformed':False}))
        sys.exit(1)
