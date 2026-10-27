"""Inert targeted PR1020 Indo inventory. No DB writes, HTTP login or live signals.
Only private evidence files and owned never-started scratch containers are created.
"""
import xml.etree.ElementTree as ET
import datetime,hashlib,io,json,os,pathlib,re,stat,subprocess,sys,tarfile,urllib.request,urllib.error,urllib.parse,uuid
ROOT=pathlib.Path('/opt/rr-portal')
OUT=ROOT/'deploy/backups/pr-1020-20261027-inspect'
APP='apps/印尼小组/印尼走货明细'
BASE='b9f72141b44e7a692d2ccbab32d6846f8e9d3dcb'
OLD_FRONTEND='b9f72141b44e7a692d2ccbab32d6846f8e9d3dcb'
OLD_APP_TREE='f5ce3705a671dad40438e12b8b20525d689b4492'
LIVE_IMAGE='sha256:d8080518f8c97d9837af7cf44d74953edda402e0ebf7a2f6cbaf026eb410ba00'
STATIC_BASE_IMAGE='sha256:d8080518f8c97d9837af7cf44d74953edda402e0ebf7a2f6cbaf026eb410ba00'
COMPOSE_TAG='rr-portal-indo-shipping:latest'
BRANCH='refs/heads/ops/pr-1020-20261027-static'
EXECUTE=True
PUBLIC='http://127.0.0.1/indo-shipping/'
PHASE='inspect'
STAGE='entry';SERIAL=0
CODE_FILES=('IndoShipping.Api.dll','IndoShipping.Domain.dll','IndoShipping.Infrastructure.dll','IndoShipping.Api.deps.json','IndoShipping.Api.runtimeconfig.json','appsettings.json','db/postgres_schema.sql','seed/hs-dictionary.json')

def need(v, label):
    global STAGE
    STAGE = label
    if not v: raise RuntimeError(label)

def enc(v): return json.dumps(v, sort_keys=True, ensure_ascii=True, separators=(',', ':')).encode()

def sha(v): return hashlib.sha256(v).hexdigest()

def run(args, data=None, timeout=180):
    global STAGE, SERIAL
    STAGE = 'command-' + pathlib.Path(args[0]).name; SERIAL += 1
    p = subprocess.run(args, input=data, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout, cwd=ROOT)
    if OUT.is_dir():
        private(OUT / ('%s-%03d.stdout.private' % (PHASE, SERIAL)), p.stdout)
        private(OUT / ('%s-%03d.stderr.private' % (PHASE, SERIAL)), p.stderr)
    need(p.returncode == 0, 'command-' + pathlib.Path(args[0]).name)
    return p.stdout

def private(path, data):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'wb') as f: f.write(data); f.flush(); os.fsync(f.fileno())

def git(*args): return run(['git', '-C', str(ROOT), '-c', 'core.hooksPath=/dev/null', *args])

def safe_relative(name):
    p = pathlib.PurePosixPath(name)
    return type(name) is str and bool(name) and str(p) == name and not p.is_absolute() and '..' not in p.parts and '\\' not in name and all(ord(c) >= 32 for c in name)

def target_unchanged(before, after, cid):
    need(cid in before and cid in after and before[cid] == after[cid], 'same-target-runtime-without-restart')

def image_id(name, optional=False):
    p = subprocess.run(['docker', 'image', 'inspect', name], stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=30, cwd=ROOT)
    if optional and p.returncode != 0:
        need(b'No such image:' in p.stderr or b'No such object:' in p.stderr, 'only-known-absent-local-image')
        return None
    need(p.returncode == 0, 'local-image-inspect'); rows = json.loads(p.stdout)
    need(len(rows) == 1 and re.fullmatch('sha256:[a-f0-9]{64}', rows[0]['Id']), 'one-immutable-local-image')
    return rows[0]['Id']

def index_metadata(cid):
    value = run(['docker', 'exec', '--user', '0', cid, 'stat', '-c', '%f|%u|%g|%a|%Y|%s', '/app/wwwroot/index.html']).decode().strip()
    need(re.fullmatch('[a-f0-9]+[|][0-9]+[|][0-9]+[|][0-7]+[|][0-9]+[|][0-9]+', value), 'typed-index-metadata')
    kind, uid, gid, mode, mtime, size = value.split('|')
    need(stat.S_ISREG(int(kind, 16)) and int(mode, 8) == 0o644, 'regular-readable-index')
    return {'uid': int(uid), 'gid': int(gid), 'mode': int(mode, 8), 'mtime': int(mtime), 'size': int(size)}

def files(folder):
    result = {}; total = 0
    for p in sorted(folder.rglob('*')):
        need(not p.is_symlink() and (p.is_dir() or p.is_file()), 'regular-static-files-only')
        if p.is_file():
            name = p.relative_to(folder).as_posix(); size = p.stat().st_size; total += size
            need(safe_relative(name) and size <= 64 * 1024**2 and total <= 256 * 1024**2, 'bounded-safe-static-files')
            result[name] = sha(p.read_bytes())
    need('index.html' in result and len(result) < 1000, 'bounded-static-manifest')
    return result

def copy_web(cid, name):
    dest = OUT / name; dest.mkdir(mode=0o700)
    run(['docker', 'cp', cid + ':/app/wwwroot/.', str(dest)])
    files(dest)
    return dest

def http(path='', headers=None):
    need(not path.startswith('/') and '..' not in pathlib.PurePosixPath(path).parts and '?' not in path and '#' not in path, 'fixed-relative-public-route')
    req = urllib.request.Request(PUBLIC + urllib.parse.quote(path, safe='/'), headers={'Cache-Control': 'no-cache', **(headers or {})})
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *args, **kwargs): return None
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    try:
        with opener.open(req, timeout=20) as r:
            body = r.read(64 * 1024**2 + 1); need(len(body) <= 64 * 1024**2, 'bounded-public-static-response')
            return r.status, dict(r.headers), body
    except urllib.error.HTTPError as e:
        try: return e.code, dict(e.headers), e.read(1024)
        finally: e.close()


def one(service,label):
    need(service in ('indo-shipping','db') and label in ('before','after'),'only-two-inventory-services')
    ids=run(['docker','ps','-aq','--no-trunc','--filter','label=com.docker.compose.project=rr-portal','--filter','label=com.docker.compose.service='+service]).decode().split()
    need(len(ids)==1 and re.fullmatch('[a-f0-9]{64}',ids[0]),'unique-full-'+service)
    rows=json.loads(run(['docker','inspect',ids[0]]));need(len(rows)==1 and rows[0]['Id']==ids[0],'same-inspected-'+service);r=rows[0]
    need(r['State']['Running'] and not r['State']['OOMKilled'] and r['State'].get('Health',{}).get('Status')=='healthy','healthy-'+service)
    private(OUT/(service+'-'+label+'-runtime.private.json'),enc(r));return r

def contract(r):
    return {'id':r['Id'],'image':r['Image'],'started':r['State']['StartedAt'],'restartCount':r['RestartCount'],'running':r['State']['Running'],'pid':r['State']['Pid'],'config':sha(enc(dict(r['Config'],Env=sorted(r['Config'].get('Env')or[])))),'hostConfig':sha(enc(r['HostConfig'])),'mounts':sha(enc(sorted(r['Mounts'],key=enc)))}

def code(cid,path):
    blob=run(['docker','cp',cid+':/app/'+path,'-'])
    with tarfile.open(fileobj=io.BytesIO(blob))as t:
        rows=t.getmembers();need(len(rows)==1 and rows[0].isfile()and rows[0].size<=64*1024**2,'one-code-file');raw=t.extractfile(rows[0]).read();need(len(raw)==rows[0].size,'complete-code-file');return sha(raw)

def code_proof(cid):return {n:code(cid,n)for n in CODE_FILES}

def scratch_create(image):
    token=uuid.uuid4().hex;cid=run(['docker','create','--network','none','--restart','no','--log-driver','none','--label','io.rr-portal.pr1020-inspect='+token,'--entrypoint','/bin/true',image]).decode().strip()
    need(re.fullmatch('[a-f0-9]{64}',cid),'own-full-scratch-id');return cid,token

def scratch_remove(cid,image,token):
    r=json.loads(run(['docker','inspect',cid]))[0]
    need(r['Id']==cid and r['Image']==image and(r['Config'].get('Labels')or{}).get('io.rr-portal.pr1020-inspect')==token and not r['State']['Running'] and r['State']['Pid']==0 and r['State']['StartedAt'].startswith('0001-') and not r['Mounts'] and r['HostConfig']['NetworkMode']=='none','only-own-neverstarted-scratch')
    run(['docker','rm',cid])


KEYRING_DEST='/home/app/.aspnet'
KEYRING_MAX=2*1024*1024
KEYRING_OWNER=(1654,1654)
STARTUP_FILES=('db/postgres_schema.sql','src/IndoShipping.Api/Program.cs','src/IndoShipping.Api/Features/Bootstrap/ProductionSeeder.cs','src/IndoShipping.Api/Features/Bootstrap/DataMigrations.cs','src/IndoShipping.Infrastructure/Persistence/DatabaseCompatibility.cs','src/IndoShipping.Api/DeploymentSecrets.cs','src/IndoShipping.Api/Features/Bootstrap/ScheduleCustomerSchema.cs')
def ancestor_metadata(cid):
 result={}
 for p,owner in(('/home',(0,0)),('/home/app',KEYRING_OWNER)):
  raw=run(['docker','exec','--user','0',cid,'stat','-c','%f|%a|%u|%g|%s','--',p],timeout=20).decode().strip();need(re.fullmatch('[0-9a-f]+[|][0-7]+[|][0-9]+[|][0-9]+[|][0-9]+',raw)is not None,'bounded-ancestor-metadata');a,b,c,d,e=raw.split('|');bits=int(a,16);value={'mode':int(b,8),'uid':int(c),'gid':int(d)};need(stat.S_ISDIR(bits)and value==dict(mode=0o755,uid=owner[0],gid=owner[1]),'fixed-real-existing-home-ancestor-mode-owner');result[p]=value
 return{'metadata':result,'observedUTC':datetime.datetime.now(datetime.timezone.utc).isoformat(),'observationKind':'running-pre-stop-stat'}

def validate_keyring_tar(blob):
 need(type(blob)is bytes and 0<len(blob)<=KEYRING_MAX,'bounded-private-keyring-tar');entries={};total=0
 with tarfile.open(fileobj=io.BytesIO(blob),mode='r:')as archive:
  for member in archive:
   n=member.name.rstrip('/');need(safe_relative(n)and n not in entries and not member.issym()and not member.islnk()and(member.isdir()or member.isfile()),'safe-unique-regular-keyring-tar-members');need((member.uid,member.gid)==KEYRING_OWNER,'original-keyring-owner');value={'mode':member.mode,'uid':member.uid,'gid':member.gid,'kind':'directory'if member.isdir()else'file','bytes':member.size}
   if member.isdir():need(n in{'.aspnet','.aspnet/DataProtection-Keys'}and member.mode==0o755 and member.size==0,'only-existing-keyring-directories')
   else:
    match=re.fullmatch(r'\.aspnet/DataProtection-Keys/key-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.xml',n);need(match is not None and member.mode==0o600 and 0<member.size<=65536,'only-bounded-private-data-protection-key-files');data=archive.extractfile(member).read();total+=len(data);need(len(data)==member.size and total<=1024*1024 and b'<!DOCTYPE'not in data.upper()and b'<!ENTITY'not in data.upper(),'complete-bounded-key-file-no-dtd-or-entity');document=ET.fromstring(data);need(document.tag=='key'and str(uuid.UUID(document.attrib.get('id','')))==match[1]and document.attrib.get('version')=='1','canonical-data-protection-key-identity');value['sha256']=sha(data)
   entries[n]=value
 need({'.aspnet','.aspnet/DataProtection-Keys'}<=set(entries)and 1<=sum(v['kind']=='file'for v in entries.values())<=16 and len(entries)<=18,'complete-existing-keyring-with-bounded-count');return entries

def envmap(r):
    result={}
    for x in r['Config'].get('Env')or[]:
        k,sep,value=x.partition('=');need(sep and k not in result,'unique-runtime-env');result[k]=value
    return result

def auth_database_contract(runtime,db):
    ae=envmap(runtime);de=envmap(db);blob=run(['docker','exec',runtime['Id'],'cat','/proc/1/environ']);need(blob.endswith(b'\0'),'complete-pid1-env');pe={}
    for x in blob.split(b'\0'):
        if not x:continue
        k,sep,value=x.decode().partition('=');need(sep and k not in pe,'unique-pid1-env');pe[k]=value
    need(pe.pop('HOSTNAME',None)==runtime['Id'][:12],'original-automatic-hostname')
    need(ae.get('DB_NAME')==(de.get('POSTGRES_DB')or'rrportal')and ae.get('DB_USER')==(de.get('POSTGRES_USER')or'rrportal')and ae.get('DB_PASSWORD')==de.get('POSTGRES_PASSWORD')and(not ae.get('DB_SCHEMA','').strip()or ae['DB_SCHEMA']=='indo_shipping'),'same-existing-postgres-contract')
    names=('DB_NAME','DB_USER','DB_PASSWORD','DB_SCHEMA','INDO_SHIPPING_JWT_KEY_B64','INDO_SHIPPING_ADMIN_PASSWORD_B64');need(all(pe.get(k)==ae.get(k)for k in names),'same-pid1-db-and-auth-configuration')
    need(bool(ae.get('INDO_SHIPPING_JWT_KEY_B64'))and bool(ae.get('INDO_SHIPPING_ADMIN_PASSWORD_B64')),'existing-persistent-auth-secrets')
    return {'databaseAndConfiguredPid1Match':True,'configuredEnvSHA256':sha(enc(ae)),'pid1WithoutAutomaticHostnameSHA256':sha(enc(pe)),'jwtConfigured':True,'adminPasswordConfigured':True,'secretBytesPrinted':False}

def keyring_inventory(cid):
    ancestor=ancestor_metadata(cid);blob=run(['docker','cp','-a',cid+':'+KEYRING_DEST,'-'],timeout=45);entries=validate_keyring_tar(blob)
    return {'entries':entries,'tarSHA256':sha(blob),'fileCount':sum(v['kind']=='file'for v in entries.values()),'ancestors':ancestor['metadata'],'observationKind':'running-read-only-not-cold','secretBytesPrinted':False}

def readonly_dump(cid):
    p=OUT/'indo_shipping.dump';fd=os.open(p,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
    with os.fdopen(fd,'wb')as f:
        r=subprocess.run(['docker','exec',cid,'sh','-c','exec pg_dump -Fc --no-owner --no-acl --schema=indo_shipping -U "${POSTGRES_USER:-rrportal}" -d "${POSTGRES_DB:-rrportal}"'],stdout=f,stderr=subprocess.PIPE,timeout=180,cwd=ROOT);f.flush();os.fsync(f.fileno())
    private(OUT/'pg-dump.stderr.private',r.stderr);need(r.returncode==0 and 0<p.stat().st_size<=512*1024**2,'bounded-successful-readonly-indo-pg-dump');h=hashlib.sha256()
    with p.open('rb')as f:
        need(f.read(5)==b'PGDMP','valid-private-postgres-custom-dump');f.seek(0)
        while True:
            chunk=f.read(1024*1024)
            if not chunk:break
            h.update(chunk)
    return {'bytes':p.stat().st_size,'sha256':h.hexdigest(),'readOnlyCustomDump':True,'businessDataPrinted':False}

def main():
    need(EXECUTE is True and sys.argv[1:]==['inspect'] and os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_ATTEMPT')=='1' and os.environ.get('RELEASE_MODE')=='inspect','inert-fixed-first-inspect');os.umask(0o077)
    need(not OUT.exists()and not OUT.is_symlink(),'fresh-inspect');OUT.mkdir(mode=0o700)
    need(git('symbolic-ref','--short','HEAD').decode().strip()=='main'and git('rev-parse','HEAD').decode().strip()==BASE,'canonical-latest-main')
    need(git('rev-parse',BASE+':'+APP).decode().strip()==OLD_APP_TREE==git('rev-parse',OLD_FRONTEND+':'+APP).decode().strip(),'accepted-pr1017-app-tree')
    runtime=one('indo-shipping','before');db=one('db','before');before=contract(runtime);auth=auth_database_contract(runtime,db);keys=keyring_inventory(runtime['Id'])
    startup={n:sha(git('show',BASE+':'+APP+'/'+n))for n in STARTUP_FILES}
    writes=run(['docker','diff',runtime['Id']]).decode().splitlines();need(len(writes)<=1000 and all(re.fullmatch(r'[ACD] /[^\r\n]+',x)for x in writes),'bounded-current-writable-layer-paths');private(OUT/'writable-layer-paths.private.json',enc(writes))
    need(runtime['Image']==LIVE_IMAGE and not runtime['Mounts'],'accepted-live-image-no-mounts')
    images={}
    for name,image in [('live',LIVE_IMAGE),('staticBase',STATIC_BASE_IMAGE)]:
        r=json.loads(run(['docker','image','inspect',image]))[0];need(r['Id']==image and not r['Config'].get('Volumes'),'known-image-without-volumes');private(OUT/(name+'-image.private.json'),enc(r));images[name]=r
    labels=images['staticBase']['Config'].get('Labels')or{}
    need(LIVE_IMAGE==STATIC_BASE_IMAGE and labels.get('org.opencontainers.image.revision')==OLD_FRONTEND,'accepted-1017-full-image-provenance')
    need(image_id(COMPOSE_TAG)==STATIC_BASE_IMAGE,'current-future-recreation-image')
    base=images['live'];derived=images['staticBase'];need(base['Architecture']==derived['Architecture']and base['Os']==derived['Os']and derived['RootFS']['Layers'][:len(base['RootFS']['Layers'])]==base['RootFS']['Layers'],'same-accepted-full-image-platform-and-layers')
    live_files=files(copy_web(runtime['Id'],'live-wwwroot'));live_code=code_proof(runtime['Id']);proof={}
    for name,image in [('live',LIVE_IMAGE),('staticBase',STATIC_BASE_IMAGE)]:
        cid,token=scratch_create(image)
        try:
            proof[name]={'backend':code_proof(cid)}
            if name=='staticBase':proof[name]['wwwroot']=files(copy_web(cid,'static-base-wwwroot'))
        finally:scratch_remove(cid,image,token)
    need(live_code==proof['live']['backend']==proof['staticBase']['backend'],'unchanged-live-and-static-base-backend-code')
    need(live_files==proof['staticBase']['wwwroot'],'live-wwwroot-matches-accepted-static-base')
    private(OUT/'wwwroot-manifest.private.json',enc(live_files));status,headers,body=http();need(status==200 and sha(body)==live_files['index.html'],'served-current-index-exact')
    status_health,_,_=http('api/health');status_auth,_,_=http('api/purchase');need(status_health==200 and status_auth==401,'health-and-anonymous-auth-preserved')
    dump=readonly_dump(db['Id']);environment_file=ROOT/'.env.cloud.production';need(environment_file.is_file()and not environment_file.is_symlink(),'regular-environment-file');es=environment_file.stat();environment_info={'sha256':sha(environment_file.read_bytes()),'mode':stat.S_IMODE(es.st_mode),'uid':es.st_uid,'gid':es.st_gid}
    after=one('indo-shipping','after');need(contract(after)==before,'target-unchanged-during-inspect')
    result={'phase':'inspect','success':True,'base':BASE,'canonicalVersion':BASE,'oldFrontendVersion':OLD_FRONTEND,'oldAppTree':OLD_APP_TREE,'liveRuntime':before,'database':{'id':db['Id'],'image':db['Image'],'health':db['State']['Health']['Status'],'started':db['State']['StartedAt'],'configSHA256':sha(enc(db['Config']))},'liveBackendImage':LIVE_IMAGE,'staticBaseImage':STATIC_BASE_IMAGE,'indexSHA256':live_files['index.html'],'indexMetadata':index_metadata(runtime['Id']),'staticManifestSHA256':sha(enc(live_files)),'staticFileCount':len(live_files),'backendCode':live_code,'postgresReadOnlyDump':dump,'environmentFile':environment_info,'authDatabaseContract':auth,'dataProtectionKeyring':keys,'startupSourceSHA256':startup,'writableLayerPathCount':len(writes),'writableLayerPathsSHA256':sha(enc(writes)),'backendHashesLiveAndBothImagesExact':True,'public':{'index':200,'health':status_health,'anonymousPurchase':status_auth},'dbWritesOrLoginOrLiveSignals':False,'utc':datetime.datetime.now(datetime.timezone.utc).isoformat()}
    private(OUT/'result.private.json',enc(result));result['resultSHA256']=sha(enc(result));result['sha256Wire']={k:[int(c,16)for c in(v.split(':',1)[1]if v.startswith('sha256:')else v)]for k,v in result.items()if type(v)is str and re.fullmatch('(?:sha256:)?[a-f0-9]{64}|[a-f0-9]{40}',v)};print(json.dumps(result,sort_keys=True),flush=True)
if __name__=='__main__':main()
