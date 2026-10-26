"""Inert read-only SprayPlan baseline; no HTTP/login/SQL writes/live signals."""
import contextlib,datetime,hashlib,io,json,os,pathlib,re,sqlite3,stat,subprocess,sys,tarfile,uuid
ROOT=pathlib.Path('/opt/rr-portal')
OUT=ROOT/'deploy/backups/pr-1012-20261026-inspect'
BASE='6b36a35e0d1239a96da3d24ec660ac6fb678f8f0'
OLD='3a3704582279f3bbfe2356a313bfda2165f9da65'
BRANCH='refs/heads/ops/pr-1012-20261026'
APP='apps/喷油部/喷油排期系统'
EXECUTE=False
SERVICES={'sprayplan-test':('data-test','storage-test'),'sprayplan':('data','storage')}
def need(v,label):
    if not v:raise RuntimeError(label)
def enc(v):return json.dumps(v,sort_keys=True,separators=(',',':'),ensure_ascii=True).encode()
def sha(v):return hashlib.sha256(v).hexdigest()
def run(a):return subprocess.check_output(a,stderr=subprocess.PIPE,timeout=90,cwd=ROOT)
def private(name,data):
    fd=os.open(OUT/name,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
    with os.fdopen(fd,'wb')as f:f.write(data if type(data)is bytes else enc(data))
def meta(p):
    s=p.lstat();need(not p.is_symlink()and(stat.S_ISREG(s.st_mode)or stat.S_ISDIR(s.st_mode)),'regular-owned-path')
    return {'uid':s.st_uid,'gid':s.st_gid,'mode':stat.S_IMODE(s.st_mode),'bytes':s.st_size}
def env(r):
    result={}
    for v in r['Config'].get('Env')or[]:
        k,sep,value=v.partition('=');need(sep and k not in result,'unique-config-env');result[k]=value
    return result
def code(cid,path):
    blob=run(['docker','cp',cid+':'+path,'-'])
    with tarfile.open(fileobj=io.BytesIO(blob))as t:
        rows=t.getmembers();need(len(rows)==1 and rows[0].isfile()and rows[0].size<=1024**2,'one-small-code-file')
        raw=t.extractfile(rows[0]).read();need(len(raw)==rows[0].size,'complete-code-file');return raw
def old_image_config(image,service):
    folder=OUT/(service+'-scratch');folder.mkdir(mode=0o700);mounts={}
    for name,dest in [('data','/app/data'),('storage','/app/server/SprayPlan.Api/storage')]:
        p=folder/name;p.mkdir(mode=0o700);mounts[dest]=str(p)
    token=uuid.uuid4().hex;args=['docker','create','--network','none','--restart','no','--log-driver','none','--label','io.rr-portal.pr1012-inspect='+token,'--entrypoint','/bin/true']
    for dest,source in mounts.items():args+=['--mount','type=bind,src='+source+',dst='+dest]
    cid=run(args+[image]).decode().strip();need(re.fullmatch('[a-f0-9]{64}',cid),'full-own-scratch-id')
    try:return code(cid,'/app/server/SprayPlan.Api/appsettings.json')
    finally:
        row=json.loads(run(['docker','inspect',cid]))[0];s=row['State'];actual={m['Destination']:m for m in row['Mounts']}
        need(row['Id']==cid and row['Image']==image and(row['Config'].get('Labels')or{}).get('io.rr-portal.pr1012-inspect')==token and not s['Running']and s['Pid']==0 and s['StartedAt'].startswith('0001-')and row['HostConfig']['NetworkMode']=='none','only-own-neverstarted-scratch')
        need(set(actual)==set(mounts)and all(actual[d]['Type']=='bind'and actual[d]['Source']==p and actual[d]['RW']for d,p in mounts.items()),'only-owned-empty-scratch-binds')
        need(all(not list(pathlib.Path(p).iterdir())for p in mounts.values()),'scratch-bind-dirs-still-empty')
        run(['docker','rm',cid])
def sqlite_info(p):
    with p.open('rb')as f:need(f.read(16)==b'SQLite format 3\0','valid-existing-main-sqlite')
    with contextlib.closing(sqlite3.connect(p.as_uri()+'?mode=ro',uri=True,timeout=15))as db:
        db.execute('PRAGMA query_only=ON');db.execute('BEGIN');rows=db.execute("SELECT name,sql FROM sqlite_master WHERE type='table'ORDER BY name").fetchall();need('users'in{r[0]for r in rows},'existing-users-table')
        return {'tables':[r[0]for r in rows],'schemaSHA256':sha(enc(rows)),'integrity':db.execute('PRAGMA quick_check').fetchone()[0],'users':db.execute('SELECT count(*) FROM users').fetchone()[0]}
def directory_info(p):
    need(p.is_dir()and not p.is_symlink(),'existing-mounted-root');files=0;bytes_=0;sql=[]
    for f in p.rglob('*'):
        meta(f)
        if f.is_file():
            files+=1;bytes_+=f.stat().st_size
            with f.open('rb')as stream:
                if stream.read(16)==b'SQLite format 3\0':sql.append(f.relative_to(p).as_posix())
    return {'metadata':meta(p),'files':files,'bytes':bytes_,'sqliteHeaderFiles':sorted(sql)}
def main():
    need(EXECUTE is True and sys.argv[1:]==['inspect']and os.environ.get('RELEASE_MODE')=='inspect'and os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_ATTEMPT')=='1','inert-exact-first-inspect');os.umask(0o077)
    need(not OUT.exists()and not OUT.is_symlink(),'one-inspect');OUT.mkdir(mode=0o700)
    need(run(['git','rev-parse','HEAD']).decode().strip()==BASE,'current-canonical-main')
    old_tree=run(['git','rev-parse',OLD+':'+APP]).decode().strip();base_tree=run(['git','rev-parse',BASE+':'+APP]).decode().strip();need(old_tree==base_tree,'base-app-identical-to-accepted-930')
    result={}
    for service,(data_name,storage_name)in SERVICES.items():
        ids=run(['docker','ps','-aq','--no-trunc','--filter','label=com.docker.compose.project=rr-portal','--filter','label=com.docker.compose.service='+service]).decode().split();need(len(ids)==1,'unique-'+service);r=json.loads(run(['docker','inspect',ids[0]]))[0];need(r['State']['Running'],'running-'+service);private(service+'-runtime.private.json',r)
        actual={m['Destination']:m for m in r['Mounts']};expected={'/app/data':str(ROOT/APP/data_name),'/app/server/SprayPlan.Api/storage':str(ROOT/APP/storage_name)};need(set(actual)==set(expected)and all(actual[d]['Type']=='bind'and actual[d]['RW']and actual[d]['Source']==p for d,p in expected.items()),'exact-two-existing-binds')
        e=env(r);need(e.get('NEXT_PUBLIC_BASE_PATH')=='/'+service and e.get('DATA_PATH')=='/app/data'and e.get('DOTNET_API_URL')=='http://127.0.0.1:5080'and e.get('SPRAYPLAN_DB_PATH','/app/data/sprayplan.db')=='/app/data/sprayplan.db','unchanged-runtime-routing')
        data=ROOT/APP/data_name;storage=ROOT/APP/storage_name;db=data/'sprayplan.db';need(db.is_file()and not db.is_symlink()and db.stat().st_size>0,'existing-db-prevents-seed')
        secret=e.get('JWT_SECRET');secret_file=data/'jwt-secret';secret_meta=None;file_hash=None
        if secret_file.is_file():
            secret_meta=meta(secret_file);before=secret_file.stat();raw=secret_file.read_bytes();after=secret_file.stat();need((before.st_ino,before.st_size,before.st_mtime_ns)==(after.st_ino,after.st_size,after.st_mtime_ns),'stable-secret-file');file_hash=sha(raw)
            if not secret:secret=raw.rstrip(b'\n').decode()
        need(type(secret)is str and len(secret.encode())>=32,'existing-strong-jwt-secret')
        settings=code(r['Id'],'/app/server/SprayPlan.Api/appsettings.json');source=run(['git','show',BASE+':'+APP+'/server/SprayPlan.Api/appsettings.json']);image_settings=old_image_config(r['Image'],service)
        image=json.loads(run(['docker','image','inspect',r['Image']]))[0];private(service+'-image.private.json',image);image_env=env(image)
        result[service]={'id':r['Id'],'image':r['Image'],'health':r['State'].get('Health',{}).get('Status'),'started':r['State']['StartedAt'],'configSHA256':sha(enc(r['Config'])),'hostConfigSHA256':sha(enc(r['HostConfig'])),'configuredEnvSHA256':sha(enc(e)),'publicImageVersions':{k:image_env.get(k)for k in('DOTNET_VERSION','ASPNET_VERSION')},'data':directory_info(data),'storage':directory_info(storage),'mainDb':sqlite_info(db),'secret':{'configuredEnvUsed':bool(e.get('JWT_SECRET')),'fileExists':secret_file.is_file(),'fileMetadata':secret_meta,'fileSHA256':file_hash,'effectiveSHA256':sha(secret.encode()),'secretBytesPrinted':False},'appsettings':{'liveSHA256':sha(settings),'baseSHA256':sha(source),'oldImageSHA256':sha(image_settings),'liveMatchesBase':settings==source,'liveMatchesImage':settings==image_settings}}
    value={'phase':'inspect','success':True,'base':BASE,'accepted930AppTree':base_tree,'services':result,'sqlWritesOrHttpLoginOrLiveSignals':False,'utc':datetime.datetime.now(datetime.timezone.utc).isoformat()};private('result.private.json',value);value['resultSHA256']=sha(enc(value));print(json.dumps(value,sort_keys=True),flush=True)
if __name__=='__main__':main()
