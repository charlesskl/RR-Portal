"""Inert, one-service read-only evidence collector. No service or business writes."""
import datetime, hashlib, importlib.util, json, os, pathlib, re, stat, subprocess, sys
EXECUTE = True
BRANCH = 'refs/heads/ops/pr-1030-1033-20261029-engineering'
ROOT = pathlib.Path('/opt/rr-portal')
OUT = ROOT / 'deploy/backups/pr1030-engineering-preflight-1'
APP = 'apps/工程部/工程资料管理系统'
SERVICE = 'gongcheng-ziliao'
ALIAS = 'rr-portal-gongcheng-ziliao:latest'
SHARED = ('docker-compose.cloud.yml', 'frontend/index.cloud.html', 'nginx/nginx.cloud.conf', 'deploy/update-server.sh', 'deploy/service-maintenance.sh')
spec = importlib.util.spec_from_file_location('readonly_common', pathlib.Path(__file__).with_name('pr1035-quote-preflight.py'))
common = importlib.util.module_from_spec(spec); spec.loader.exec_module(common)
common.OUT = OUT
need, enc, sha, pin = common.need, common.enc, common.sha, common.pin

def private(name, value):
    fd = os.open(OUT / name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'wb') as f:
        f.write(enc(value)); f.flush(); os.fsync(f.fileno())

def inspect_memory(cid):
    # Config.Env and HostConfig may contain credentials; never send their plaintext to a log file.
    result = subprocess.run(['docker', 'inspect', cid], capture_output=True, timeout=30)
    need(result.returncode == 0 and len(result.stdout) <= 4 * 1024**2, 'bounded-runtime-inspect-in-memory')
    rows = json.loads(result.stdout); need(len(rows) == 1 and rows[0]['Id'] == cid, 'exact-runtime-inspect-in-memory')
    return rows[0]

def full_inventory(folder):
    """Names stay private. Observe all entries, including hidden metadata; never follow links."""
    need(folder.is_dir() and not any(p.is_symlink() for p in (folder, *folder.parents)), 'real-data-root')
    result = []; total = 0
    def walk(directory):
        nonlocal total
        for p in sorted(directory.iterdir()):
            before = p.lstat(); row = {'path': p.relative_to(folder).as_posix(), 'uid': before.st_uid, 'gid': before.st_gid, 'mode': stat.S_IMODE(before.st_mode), 'mtimeNs': before.st_mtime_ns}
            if stat.S_ISDIR(before.st_mode): row['type'] = 'dir'
            elif stat.S_ISREG(before.st_mode):
                total += before.st_size; need(total <= 32 * 1024**3 and before.st_size <= 2 * 1024**3, 'bounded-data-inventory')
                fd = os.open(p, os.O_RDONLY | os.O_NOFOLLOW)
                try:
                    h = hashlib.sha256(); size = 0
                    while True:
                        chunk = os.read(fd, 1024**2)
                        if not chunk: break
                        size += len(chunk); h.update(chunk)
                    after = os.fstat(fd)
                finally: os.close(fd)
                key = lambda s: (s.st_dev, s.st_ino, s.st_mode, s.st_uid, s.st_gid, s.st_size, s.st_mtime_ns, s.st_ctime_ns)
                need(key(before) == key(after) == key(p.lstat()) and size == before.st_size, 'stable-data-file')
                row.update(type='file', bytes=size, sha256=h.hexdigest())
            elif stat.S_ISLNK(before.st_mode): row.update(type='link', linkSHA256=sha(os.fsencode(os.readlink(p))))
            else: raise RuntimeError('unsupported-data-entry')
            result.append(row); need(len(result) <= 200000, 'bounded-data-entries')
            if row['type'] == 'dir': walk(p)
    root_stat = folder.stat(); walk(folder)
    root_meta = {'uid': root_stat.st_uid, 'gid': root_stat.st_gid, 'mode': stat.S_IMODE(root_stat.st_mode)}
    return {'root': root_meta, 'entries': result}, {'entries': len(result), 'files': sum(r['type'] == 'file' for r in result), 'bytes': total, 'links': sum(r['type'] == 'link' for r in result), 'sha256': sha(enc({'root': root_meta, 'entries': result}))}

NODE = r"""const fs=require('fs'),path=require('path'),crypto=require('crypto'),dns=require('dns').promises;const H=v=>crypto.createHash('sha256').update(v).digest('hex');const names=JSON.parse(fs.readFileSync(0,'utf8'));const result={node:process.version,files:{}};for(const n of names){if(!/^[A-Za-z0-9_./-]+$/.test(n)||n.split('/').some(p=>!p||p==='..')||n.startsWith('node_modules/')||n.startsWith('dist/'))throw Error('source-scope');const p='/app/'+n;if(!fs.existsSync(p)){result.files[n]={absent:true};continue;}const s=fs.lstatSync(p);if(!s.isFile()||s.isSymbolicLink()||s.size>32*1024**2)throw Error('regular-source');const b=fs.readFileSync(p);result.files[n]={sha256:H(b),bytes:b.length,uid:s.uid,gid:s.gid,mode:s.mode&4095,gitBlobSHA1:crypto.createHash('sha1').update('blob '+b.length+'\0').update(b).digest('hex')};}for(const n of ['docs.config.json','node_modules/.package-lock.json']){const b=fs.readFileSync('/app/'+n);result[n]={sha256:H(b),bytes:b.length};}result.dependencies={};for(const n of ['vite','typescript','react','react-dom','xlsx','docx','exceljs','formidable']){try{result.dependencies[n]=require(n+'/package.json').version;}catch{result.dependencies[n]='absent';}}result.dist={};for(const n of ['index.html']){const b=fs.readFileSync('/app/dist/'+n);result.dist[n]={sha256:H(b),bytes:b.length};}async function request(url){const start=Date.now();try{const r=await fetch(url,{signal:AbortSignal.timeout(8000),redirect:'error',headers:{Authorization:'Bearer invalid.diagnostic.token'}});const b=Buffer.from(await r.arrayBuffer());if(b.length>2*1024**2)throw Error('bounded-response');return{status:r.status,bytes:b.length,bodySHA256:H(b),ms:Date.now()-start,...(url.endsWith('openapi.json')?{authSchemaPresent:!!JSON.parse(b.toString()).components?.schemas?.UserResponse,loginRoutePresent:!!JSON.parse(b.toString()).paths?.['/api/auth/login'],meRoutePresent:!!JSON.parse(b.toString()).paths?.['/api/auth/me']}:{} )};}catch(e){return{errorType:e.name,ms:Date.now()-start};}};(async()=>{try{result.coreDNS={addresses:await dns.lookup('core',{all:true})};}catch(e){result.coreDNS={errorType:e.code||e.name};}result.coreMe=await request('http://core:8000/api/auth/me');result.coreSchema=await request('http://core:8000/openapi.json');console.log(JSON.stringify(result));})().catch(()=>{process.exitCode=1;});"""

def main():
    need(EXECUTE is True and sys.argv[1:] == ['diagnose'] and os.environ.get('RELEASE_BRANCH') == BRANCH and os.environ.get('RELEASE_MODE') == 'diagnose' and os.environ.get('RELEASE_ATTEMPT') == '1', 'fixed-first-readonly-engineering-preflight')
    os.umask(0o077); need(OUT.parent.is_dir() and not OUT.exists() and not OUT.is_symlink(), 'fresh-private-evidence'); OUT.mkdir(mode=0o700)
    value = {'phase': 'diagnose', 'success': False, 'readOnly': True, 'lifecycleOrBusinessWrites': False}
    try:
        head = common.git('rev-parse', 'HEAD').decode().strip(); need(pin(head, 40), 'host-head'); value['hostGitHead'] = head
        value['shared'] = {n: common.shared_file(n) for n in SHARED}; value['environmentFile'] = common.shared_file('.env.cloud.production'); value['gatewayAuth'] = common.gateway_auth()
        value['unstaged'] = common.dirty_summary(common.git('diff', '--name-only', '-z')); value['staged'] = common.dirty_summary(common.git('diff', '--cached', '--name-only', '-z'))
        cid = common.unique_service(SERVICE); value['runtime'] = common.safe_runtime(json.loads(common.command(['docker', 'inspect', '--format', common.RUNTIME_FORMAT, cid], 8192))); value['containerEnv'] = common.env_hash(cid)
        inspect = inspect_memory(cid)
        value['configSHA256'] = sha(enc(inspect['Config'])); value['hostConfigSHA256'] = sha(enc(inspect['HostConfig'])); value['mountsSHA256'] = sha(enc(inspect['Mounts']))
        mounts = [m for m in inspect['Mounts'] if m['Destination'] == '/data']; need(len(mounts) == 1 and mounts[0]['Type'] == 'bind', 'one-bound-docs-root')
        data = pathlib.Path(mounts[0]['Source']); need(data == ROOT / APP / '资料库存储', 'expected-data-root')
        inventory, value['data'] = full_inventory(data); private('data-inventory.private.json', inventory)
        alias = json.loads(common.command(['docker', 'image', 'inspect', '--format', common.IMAGE_FORMAT, ALIAS], 8192)); value['canonicalAlias'] = common.safe_image(alias)
        entries = common.git('ls-tree', '-r', '-z', head, '--', APP).split(b'\0'); expected = {}
        for entry in entries:
            if not entry: continue
            meta, name = entry.split(b'\t', 1); mode, kind, blob = meta.decode().split(); name = name.decode(); relative = name[len(APP) + 1:]
            if not (relative.startswith('src/') or relative in ('package.json', 'package-lock.json', 'vite-plugin-docs-api.ts', 'vite.config.ts', 'tsconfig.json', 'tsconfig.app.json', 'tailwind.config.js', 'index.html')): continue
            need(mode in ('100644', '100755') and kind == 'blob' and pin(blob, 40) and re.fullmatch(r'[A-Za-z0-9_./-]+', relative), 'regular-public-app-source'); expected[relative] = blob
        observed = json.loads(common.command(['docker', 'exec', '-i', cid, 'node', '-e', NODE], 4 * 1024**2, enc(sorted(expected)), 180)); private('runtime-source.private.json', {'expected': expected, 'observed': observed})
        value['source'] = {'tracked': len(expected), 'different': sorted(n for n, blob in expected.items() if observed['files'][n].get('gitBlobSHA1') != blob)}
        value['node'] = observed['node']; value['dependencies'] = observed['dependencies']; value['configFile'] = observed['docs.config.json']; value['dependencyLock'] = observed['node_modules/.package-lock.json']; value['dist'] = observed['dist']; value['coreMe'] = observed['coreMe']; value['coreSchema'] = observed['coreSchema']; value['coreDNS'] = {'resolved': bool(observed['coreDNS'].get('addresses')), 'addressCount': len(observed['coreDNS'].get('addresses', []))}
        docker_root = pathlib.Path(json.loads(common.command(['docker', 'info', '--format', '{{json .DockerRootDir}}'], 4096))); space = os.statvfs(docker_root); value['space'] = {'available': space.f_bavail * space.f_frsize, 'free': space.f_bfree * space.f_frsize}
        value['runtimeAfter'] = common.safe_runtime(json.loads(common.command(['docker', 'inspect', '--format', common.RUNTIME_FORMAT, cid], 8192))); need(value['runtimeAfter'] == value['runtime'], 'runtime-stable'); need(common.git('rev-parse', 'HEAD').decode().strip() == head, 'host-head-stable')
        value['success'] = True
    except Exception as error: value.update(errorType=type(error).__name__, stage=common.STAGE)
    value['utc'] = datetime.datetime.now(datetime.timezone.utc).isoformat(); value['resultSHA256'] = sha(enc(value)); value['sha256Wire'] = {k: [int(c, 16) for c in x] for k, x in value.items() if pin(x, 40) or pin(x)}; private('result.private.json', value)
    print(json.dumps(value, sort_keys=True), flush=True); return 0 if value['success'] else 1
if __name__ == '__main__': sys.exit(main())
