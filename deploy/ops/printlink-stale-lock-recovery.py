"""Fixed, evidence-gated single-lock recovery. Disabled until independent review."""
import hashlib,json,os,pathlib,re,signal,stat,subprocess,sys,time
ROOT=pathlib.Path('/opt/rr-portal');BACKUP=ROOT/'deploy/backups/printlink-pre-health-20261019'
OUTPUT=ROOT/'deploy/backups/printlink-stale-lock-recovery-20261019'
PIN_FROZEN=True
HEAD='52c090589d6da542fee74ef17c8edd3b0dfe4fe6'
OLD='7fda512cf6166d2304a0293fc73ac5de5400442604d9f50c320dee81f8a8dd9e'
NEW='41e7255835dee76723a084f49fe95f9108dcb80ac3f19f2e38c3d46c23bdfe51'
IMAGE='sha256:6bcb222050c2c9b19f1a4d775f1dae9d9651d2708b936a656da36c4611408a30'
VOLUME='rr-portal_printlink-data';PROC=pathlib.Path('/proc');CGROUP=pathlib.Path('/sys/fs/cgroup')
RESULT_SHA='9dc185e1b1990307917548ed9f41ac0e3e1166fbb834fa3486f7d15ebb2e1354'
MANIFEST_SHA='9dcc00592054d20977e5036a95d3d39ef7e45e6313eb0915d7dea4cc658afc43'
DEADLINE=None

def require(value):
    if not value:raise ValueError('FIXED_LOCK_RECOVERY_GUARD')
def encoded(value):return json.dumps(value,sort_keys=True,separators=(',',':')).encode()
def digest(value):return hashlib.sha256(value).hexdigest()
def check_time():require(DEADLINE is None or time.monotonic()<DEADLINE)
def command(args,timeout=15):
    check_time();r=subprocess.run(args,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,timeout=timeout)
    require(r.returncode==0 and len(r.stdout)<=4*1024**2);return r.stdout
def read(path,cap=1024**2):
    fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
    with os.fdopen(fd,'rb') as stream:
        a=os.fstat(stream.fileno());require(stat.S_ISREG(a.st_mode) and a.st_size<=cap)
        raw=stream.read(cap+1);b=os.fstat(stream.fileno())
        require(len(raw)==a.st_size and stamp(a)==stamp(b));return raw
def stamp(s):return [s.st_dev,s.st_ino,s.st_size,s.st_mtime_ns,s.st_ctime_ns,s.st_mode]
def file_hash(path):
    fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW);h=hashlib.sha256()
    with os.fdopen(fd,'rb') as stream:
        a=os.fstat(stream.fileno());require(stat.S_ISREG(a.st_mode) and a.st_size<=4*1024**3)
        for block in iter(lambda:stream.read(1024**2),b''):check_time();h.update(block)
        require(stamp(a)==stamp(os.fstat(stream.fileno())))
    return h.hexdigest()
def write(path,raw):
    fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
    with os.fdopen(fd,'wb') as stream:stream.write(raw);stream.flush();os.fsync(stream.fileno())
def seal(path):
    write(path/'manifest.json',encoded({p.relative_to(path).as_posix():file_hash(p)
        for p in sorted(path.rglob('*')) if p.is_file() and p!=path/'manifest.json'}))
def verified_backup():
    require(stat.S_ISDIR(BACKUP.lstat().st_mode) and stat.S_IMODE(BACKUP.stat().st_mode)==0o700)
    require(file_hash(BACKUP/'manifest.json')==MANIFEST_SHA and file_hash(BACKUP/'first-result.json')==RESULT_SHA)
    manifest=json.loads(read(BACKUP/'manifest.json'));entries=list(BACKUP.rglob('*'))
    require(len(entries)<=1000 and all(not p.is_symlink() and (p.is_file() or p.is_dir()) and p.stat().st_mode&0o077==0 for p in entries))
    require(set(manifest)=={p.relative_to(BACKUP).as_posix() for p in entries if p.is_file() and p!=BACKUP/'manifest.json'})
    require(all(re.fullmatch('[a-f0-9]{64}',str(value)) and file_hash(BACKUP/name)==value for name,value in manifest.items()))
    result=json.loads(read(BACKUP/'first-result.json'))
    require(all(result.get(k) is True for k in ['backupComplete','sqliteSnapshotsIndividuallyWALConsistent','portableSnapshotsVerified','rawArchiveVerified','sourceAndContainerIdentityUnchanged']))
    rows=json.loads(read(BACKUP/'raw-inventory.private.json'));locks=[r for r in rows if r.get('path','').startswith('.platform-lock')]
    require(len(locks)==2);items={r['path']:r for r in locks}
    require(items['.platform-lock']=={'path':'.platform-lock','type':'directory','mode':0o700})
    owner=items['.platform-lock/owner.json'];require(owner['type']=='file' and owner['mode']==0o600 and 0<owner['bytes']<=8192 and re.fullmatch('[a-f0-9]{64}',owner['sha256']))
    return json.loads(read(BACKUP/'container-before.private.json')),owner
def inspect(cid):
    value=json.loads(command(['docker','inspect',cid]));require(isinstance(value,list) and len(value)==1);return value[0]
def all_containers():
    ids=command(['docker','ps','-aq','--no-trunc']).decode().split();require(len(ids)<=1000 and all(re.fullmatch('[a-f0-9]{64}',x) for x in ids))
    rows=[] if not ids else json.loads(command(['docker','inspect',*ids]))
    require(isinstance(rows,list) and len(rows)==len(ids) and {row['Id'] for row in rows}==set(ids));return rows
def old_absent_or_stopped(rows):
    old=[row for row in rows if row['Id']==OLD];require(len(old)<=1)
    require(not old or old[0]['State']['Running'] is False and old[0]['State']['Pid']==0 and old[0]['State']['Status'] in {'exited','dead','created'})
def configuration(value,old):
    require(value['Id']==NEW and value['Name']=='/rr-portal-printlink-1' and value['Image']==IMAGE and IMAGE!=old['image'])
    require(value['Config']['Healthcheck']['Test']==['CMD','node','ops/healthcheck.mjs'])
    require(value['HostConfig']['Memory']==value['HostConfig']['MemorySwap']==768*1024**2)
    mounts=[x for x in value['Mounts'] if x['Destination']=='/app/runtime']
    require(mounts==old['mounts'] and len(mounts)==1 and mounts[0]['Type']=='volume' and mounts[0]['Name']==VOLUME and mounts[0]['RW'] is True)
    require(digest(encoded(sorted(value['Config']['Env'])))==old['environmentSHA256'])
    volume=json.loads(command(['docker','volume','inspect',VOLUME]));require(len(volume)==1 and volume[0]['Mountpoint']==mounts[0]['Source'])
    tree=pathlib.Path(mounts[0]['Source']);require(tree.is_absolute() and stat.S_ISDIR(tree.lstat().st_mode))
    return tree,digest(encoded({k:value[k] for k in ['Id','Name','Image','Config','HostConfig','Mounts']}))
def lock_snapshot(tree,expected):
    lock=tree/'.platform-lock';a=lock.lstat();require(stat.S_ISDIR(a.st_mode) and stat.S_IMODE(a.st_mode)==0o700)
    require([p.name for p in lock.iterdir()]==['owner.json']);owner=lock/'owner.json';s=owner.lstat()
    require(stat.S_ISREG(s.st_mode) and stat.S_IMODE(s.st_mode)==0o600)
    raw=read(owner,8192);require(len(raw)==expected['bytes'] and digest(raw)==expected['sha256'])
    require(stamp(a)==stamp(lock.lstat()) and stamp(s)==stamp(owner.lstat()))
    return raw,(stamp(a),stamp(s))
def stopped_without_users():
    rows=all_containers();old_absent_or_stopped(rows);new=[row for row in rows if row['Id']==NEW]
    require(len(new)==1 and new[0]['State']['Running'] is False and new[0]['State']['Pid']==0 and new[0]['State']['Status']=='exited')
    for row in rows:
        if any(x.get('Type')=='volume' and x.get('Name')==VOLUME for x in row.get('Mounts',[])):
            require(row['State']['Running'] is False and row['State']['Pid']==0 and row['State']['Status'] in {'exited','dead','created'})
    for path in PROC.iterdir():
        if not path.name.isdigit():continue
        check_time()
        try:
            fd=os.open(path/'cgroup',os.O_RDONLY|os.O_NOFOLLOW)
            with os.fdopen(fd,'rb') as stream:
                require(stat.S_ISREG(os.fstat(stream.fileno()).st_mode));raw=stream.read(65537);require(len(raw)<=65536)
        except FileNotFoundError:continue
        require(OLD.encode() not in raw and NEW.encode() not in raw)
    require(stat.S_ISDIR(CGROUP.lstat().st_mode));seen=0
    def walk_error(error):raise error
    for directory,children,_ in os.walk(CGROUP,followlinks=False,onerror=walk_error):
        check_time();seen+=1;require(seen<=50000 and OLD not in directory and NEW not in directory)
        require(all(not (pathlib.Path(directory)/name).is_symlink() for name in children))
    return new[0]
def main():
    global DEADLINE
    require(PIN_FROZEN and os.environ.get('PRINTLINK_LOCK_BRANCH')=='refs/heads/ops/printlink-stale-lock-recovery-20261019' and os.environ.get('PRINTLINK_LOCK_ATTEMPT')=='1' and re.fullmatch('[a-f0-9]{40}',os.environ.get('PRINTLINK_LOCK_REF','')))
    DEADLINE=time.monotonic()+120;os.umask(0o077);OUTPUT.mkdir(mode=0o700)
    result={'sequenceCompleted':False,'ownerUnlinked':False,'lockRemoved':False,'startRequested':False,'businessDatabaseWrites':False,'maintenanceFlagsChanged':False,'healthVerified':False,'isFinalDataPreservationProof':False,'stage':'backup'}
    try:
        old,owner=verified_backup();require(command(['git','-C',str(ROOT),'rev-parse','HEAD']).decode().strip()==HEAD)
        result['stage']='identity';old_absent_or_stopped(all_containers());tree,fingerprint=configuration(inspect(NEW),old);raw,initial=lock_snapshot(tree,owner)
        result['stage']='stop-new';command(['docker','stop','--time','10',NEW],timeout=25);result['newContainerStopped']=True
        result['stage']='prove-no-users';require(configuration(stopped_without_users(),old)[1]==fingerprint);require(lock_snapshot(tree,owner)==(raw,initial))
        result['oldContainerAndBothCgroupsHaveNoUsers']=True;result['noRunningContainerUsesRuntimeVolume']=True
        saved=OUTPUT/'before-removal';saved.mkdir(mode=0o700);write(saved/'owner.json.private',raw)
        write(saved/'proof.private.json',encoded({'oldCID':OLD,'newCID':NEW,'image':IMAGE,'head':HEAD,'configurationSHA256':fingerprint,'lockStamps':initial,'ownerSHA256':digest(raw)}));seal(saved)
        require(file_hash(saved/'owner.json.private')==owner['sha256'])
        result['stage']='unlink-exact-owner';require(configuration(stopped_without_users(),old)[1]==fingerprint);require(lock_snapshot(tree,owner)==(raw,initial))
        (tree/'.platform-lock/owner.json').unlink();result['ownerUnlinked']=True
        (tree/'.platform-lock').rmdir();result['lockRemoved']=True
        result['stage']='start-same';require(configuration(inspect(NEW),old)[1]==fingerprint)
        command(['docker','start',NEW],timeout=20);result['startRequested']=True
        require(configuration(inspect(NEW),old)[1]==fingerprint);result['sameContainerConfigurationPreserved']=True
        result.update(sequenceCompleted=True,stage='complete')
    except Exception:result['safeFailure']='FIXED_LOCK_RECOVERY_REFUSED_OR_INCOMPLETE'
    finally:
        signal.alarm(0);DEADLINE=None
        write(OUTPUT/'first-result.json',encoded(result));seal(OUTPUT)
        print(json.dumps(result,sort_keys=True,separators=(',',':')),flush=True)
        print(json.dumps({'resultSHA256':file_hash(OUTPUT/'first-result.json'),'sealSHA256':file_hash(OUTPUT/'manifest.json')},sort_keys=True),flush=True)
    return 0 if result['sequenceCompleted'] else 1
if __name__=='__main__':
    def stop(*_):raise TimeoutError()
    signal.signal(signal.SIGTERM,stop);signal.signal(signal.SIGALRM,stop);signal.alarm(125)
    try:sys.exit(main())
    except Exception:print('{"sequenceCompleted":false,"safeFailure":"FIXED_LOCK_RECOVERY_SETUP_OR_SEAL_FAILED"}');sys.exit(1)
