"""Private online PrintLink backup only; never stop, checkpoint, restore or edit business data."""
import hashlib,json,os,pathlib,re,signal,subprocess,sys,time
ROOT=pathlib.Path('/opt/rr-portal')
OUTPUT=ROOT/'deploy/backups/printlink-pre-health-20261019'
LIB_COMMIT='cdfe55cbd8b982749504a67b45d296936d1242a6'
LIB_SHA='47daa655212357c7ba9b22979bf6f5ee86f20afbff20b14bbd3442fbfc20c1e0'
HEAD='f853c7a2ec47f3cff11e456f874218d2324ad217'
CID='7fda512cf6166d2304a0293fc73ac5de5400442604d9f50c320dee81f8a8dd9e'
PIN_FROZEN=True


def require(value):
    if not value:raise ValueError('PRINTLINK_BACKUP_GUARD')


def library():
    require(PIN_FROZEN)
    raw=subprocess.run(['git','-C',str(ROOT),'show',LIB_COMMIT+':deploy/ops/printlink-940.py'],stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,timeout=10)
    require(raw.returncode==0 and len(raw.stdout)<128*1024 and hashlib.sha256(raw.stdout).hexdigest()==LIB_SHA)
    lib={'__name__':'reviewed_private_online_backup_library'};exec(compile(raw.stdout,'reviewed-backup-library','exec'),lib)
    return lib


def context(lib):
    i=lib['inspect']('rr-portal-printlink-1')
    require(i['Id']==CID and i['State']['Running'] and i['HostConfig']['Memory']==768*1024**2 and i['HostConfig']['MemorySwap']==768*1024**2)
    mounts=[m for m in i['Mounts'] if m['Destination']=='/app/runtime']
    require(len(mounts)==1 and mounts[0]['Type']=='volume' and mounts[0]['Name']=='rr-portal_printlink-data' and mounts[0]['RW']is True)
    volume=json.loads(lib['run'](['docker','volume','inspect','rr-portal_printlink-data'],timeout=10))
    require(len(volume)==1 and volume[0]['Mountpoint']==mounts[0]['Source'])
    tree=pathlib.Path(mounts[0]['Source']);require(tree.is_absolute()and tree.is_dir()and not tree.is_symlink())
    private={'inspect':i}
    stable={'id':i['Id'],'image':i['Image'],'startedAt':i['State']['StartedAt'],'restarts':i['RestartCount'],
            'mounts':mounts,'environmentSHA256':lib['digest'](sorted(i['Config']['Env'])),'memory':i['HostConfig']['Memory'],'swap':i['HostConfig']['MemorySwap']}
    return tree,stable,private


def main():
    require(os.environ.get('PRINTLINK_BACKUP_BRANCH')=='refs/heads/ops/printlink-health-backup-20261019' and os.environ.get('PRINTLINK_BACKUP_ATTEMPT')=='1' and re.fullmatch('[a-f0-9]{40}',os.environ.get('PRINTLINK_BACKUP_REF','')))
    lib=library();require(lib['git_commit']()==HEAD)
    os.umask(0o077);OUTPUT.mkdir(mode=0o700)
    result={'backupComplete':False,'businessWrites':False,'containersRestarted':False,'checkpointRequested':False,'restorePerformed':False,
            'sourceHead':HEAD,'crossDatabaseAtomicSnapshotClaimed':False,'rawArchiveIsNotPortableSQLiteBackup':True,'stage':'runtime-before'}
    try:
        tree,stable,private=context(lib);others=lib['other_containers']()
        lib['private_write'](OUTPUT/'runtime-before.private.json',lib['encoded'](private))
        lib['private_write'](OUTPUT/'container-before.private.json',lib['encoded'](stable))
        lib['private_write'](OUTPUT/'other-containers.private.json',lib['encoded'](others))
        lib['private_write'](OUTPUT/'env.before',lib['stable_file'](ROOT/'.env.cloud.production')[0])
        result['stage']='online-sqlite'
        audits=lib['sqlite_snapshots'](tree,OUTPUT/'sqlite-snapshots')
        lib['private_write'](OUTPUT/'sqlite-audits.private.json',lib['encoded'](audits))
        result['stage']='raw-volume-archive'
        raw=lib['tree_inventory'](tree,OUTPUT/'runtime-raw.tar');lib['verify_archive'](OUTPUT/'runtime-raw.tar',raw)
        lib['private_write'](OUTPUT/'raw-inventory.private.json',lib['encoded'](raw))
        result['stage']='final-guards'
        require(context(lib)[1]==stable and lib['other_containers']()==others and lib['git_commit']()==HEAD)
        require(lib['file_hash'](ROOT/'.env.cloud.production')==lib['file_hash'](OUTPUT/'env.before'))
        require(lib['sqlite_snapshots'](OUTPUT/'sqlite-snapshots')==audits)
        result.update({'backupComplete':True,'stage':'complete','sqliteSnapshotsIndividuallyWALConsistent':True,
            'portableSnapshotsVerified':True,'allActiveSQLiteBackedUp':len(audits),'rawEntries':len(raw),'rawArchiveVerified':True,
            'sourceAndContainerIdentityUnchanged':True,'otherContainersUnchanged':True,'environmentFileUnchanged':True,
            'snapshotWindowMayContainConcurrentBusinessActivity':True})
    except Exception:
        result['safeFailure']='PRINTLINK_ONLINE_BACKUP_INCOMPLETE'
        result['libraryGuard']=lib.get('FAILED_CHECK','unknown')
    finally:
        signal.alarm(0)
        lib['private_write'](OUTPUT/'first-result.json',lib['encoded'](result));lib['seal'](OUTPUT)
        print(json.dumps(result,sort_keys=True,separators=(',',':')),flush=True)
        print(json.dumps({'resultSHA256':lib['file_hash'](OUTPUT/'first-result.json'),'sealSHA256':lib['file_hash'](OUTPUT/'manifest.json')},sort_keys=True),flush=True)
    return 0 if result['backupComplete']else 1


if __name__=='__main__':
    def stop(*_):raise TimeoutError()
    signal.signal(signal.SIGALRM,stop);signal.signal(signal.SIGTERM,stop);signal.alarm(540)
    try:raise SystemExit(main())
    except Exception:
        print('{"backupComplete":false,"businessWrites":false,"safeFailure":"PRINTLINK_BACKUP_SETUP_OR_SEAL_FAILED"}',flush=True)
        raise SystemExit(1)
