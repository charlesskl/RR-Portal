"""Inert Quote readonly preflight: hashes only; no lifecycle, SQL writes or copies of business files."""
import hashlib,json,os,pathlib,re,stat,subprocess,sys
EXECUTE=False
TARGET='f22fbffa1789234fe1c78bf776f4dcb3fe867d0c'
BRANCH='refs/heads/ops/pr-1035-20261029-quote'
ROOT=pathlib.Path('/opt/rr-portal')
OUT=ROOT/'deploy/backups/pr1035-quote-preflight-1'
SHARED=('docker-compose.cloud.yml','frontend/index.cloud.html','nginx/nginx.cloud.conf','deploy/update-server.sh','deploy/service-maintenance.sh')
KNOWN_DIRTY=set(SHARED)|{'.env.cloud.production','.github/workflows/deploy.yml'}
ALIAS='rr-portal-internal-quote:latest'
APP='apps/业务部/内部报价系统'
ISO=r'[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:[.][0-9]{1,9})?(?:Z|[+-][0-9]{2}:[0-9]{2})'
RUNTIME_FORMAT='{"id":{{json .Id}},"image":{{json .Image}},"running":{{json .State.Running}},"health":{{if .State.Health}}{{json .State.Health.Status}}{{else}}"absent"{{end}},"restarts":{{json .RestartCount}},"pid":{{json .State.Pid}},"started":{{json .State.StartedAt}},"revision":{{with index .Config.Labels "org.opencontainers.image.revision"}}{{json .}}{{else}}null{{end}}}'
IMAGE_FORMAT='{"id":{{json .Id}},"revision":{{with index .Config.Labels "org.opencontainers.image.revision"}}{{json .}}{{else}}null{{end}},"frontendAppTree":{{with index .Config.Labels "io.rr-portal.frontend-app-tree"}}{{json .}}{{else}}null{{end}},"backendImage":{{with index .Config.Labels "io.rr-portal.backend-image"}}{{json .}}{{else}}null{{end}}}'
SERIAL=0
STAGE='entry'
def need(v,label):
 global STAGE
 STAGE=label
 if not v:raise RuntimeError(label)
def enc(v):return json.dumps(v,sort_keys=True,separators=(',',':'),ensure_ascii=True,allow_nan=False).encode()
def sha(v):return hashlib.sha256(v).hexdigest()
def pin(v,n=64):return type(v)is str and re.fullmatch('[a-f0-9]{%d}'%n,v)is not None
def command(args,limit=8*1024**2,data=None,timeout=90):
 global SERIAL
 SERIAL+=1;base=OUT/('%02d'%SERIAL);files=[base.with_suffix(s)for s in('.stdout.private','.stderr.private')];opened=[os.fdopen(os.open(p,os.O_CREAT|os.O_EXCL|os.O_WRONLY|os.O_NOFOLLOW,0o600),'wb')for p in files]
 try:
  try:p=subprocess.run(args,input=data,stdout=opened[0],stderr=opened[1],timeout=timeout)
  finally:
   for f in opened:f.flush();os.fsync(f.fileno())
 finally:
  for f in opened:f.close()
 need(p.returncode==0,'readonly-command-success');need(files[0].stat().st_size<=limit,'bounded-private-command-output');return files[0].read_bytes()
def git(*a):return command(['git','-C',str(ROOT),'-c','core.hooksPath=/dev/null',*a])
def shared_file(name):
 p=ROOT/name;need(not any(x.is_symlink()for x in(p,*p.parents)),'regular-real-fixed-shared-path');fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW)
 try:
  a=os.fstat(fd);need(stat.S_ISREG(a.st_mode)and 0<=a.st_size<=8*1024**2,'bounded-shared-regular-file');body=b''
  while True:
   b=os.read(fd,1024**2)
   if not b:break
   body+=b;need(len(body)<=8*1024**2,'bounded-shared-read')
  z=os.fstat(fd);key=lambda s:(s.st_dev,s.st_ino,s.st_uid,s.st_gid,s.st_mode,s.st_size,s.st_mtime_ns,s.st_ctime_ns);need(key(a)==key(z)==key(p.lstat())and len(body)==a.st_size,'stable-shared-file-snapshot');return {'sha256':sha(body),'bytes':len(body),'uid':a.st_uid,'gid':a.st_gid,'mode':stat.S_IMODE(a.st_mode)}
 finally:os.close(fd)
def dirty_summary(raw):
 need(type(raw)is bytes and len(raw)<=1024**2 and(not raw or raw.endswith(b'\0')),'bounded-nul-dirty-path-inventory');names=raw.split(b'\0')[:-1]if raw else[];need(len(names)==len(set(names))<=10000 and all(names),'unique-dirty-path-inventory');known=sorted(n.decode('ascii')for n in names if n in{p.encode()for p in KNOWN_DIRTY});return {'trackedPathCount':len(names),'rawPathInventorySHA256':sha(raw),'knownPublicPaths':known,'unknownPathCount':len(names)-len(known)}
def safe_runtime(v):
 need(set(v)=={'id','image','running','health','restarts','pid','started','revision'}and pin(v['id'])and type(v['image'])is str and re.fullmatch('sha256:[a-f0-9]{64}',v['image'])and type(v['running'])is bool and v['health']in('healthy','unhealthy','starting','absent')and type(v['restarts'])is int and v['restarts']>=0 and type(v['pid'])is int and v['pid']>=0 and type(v['started'])is str and re.fullmatch(ISO,v['started'])and(v['revision']is None or pin(v['revision'],40)),'typed-minimal-public-runtime');return v
def safe_image(v):
 need(set(v)=={'id','revision','frontendAppTree','backendImage'}and type(v['id'])is str and re.fullmatch('sha256:[a-f0-9]{64}',v['id']),'typed-canonical-image-id');result={'id':v['id'],'publicLabels':{}}
 for name,width in(('revision',40),('frontendAppTree',40),('backendImage',64)):
  x=v[name];valid=pin(x,width)if width==40 else type(x)is str and re.fullmatch('sha256:[a-f0-9]{64}',x)is not None;result['publicLabels'][name]={'present':x is not None,'valid':valid,'value':x if valid else None}
 return result

QUOTE_SQL="BEGIN READ ONLY; SET LOCAL search_path=internal_quote,public;\nSELECT json_build_object(\n'users',(SELECT count(*) FROM users),'quotes',(SELECT count(*) FROM quotes),'departments',(SELECT count(*) FROM departments),\n'purgeRisk',(SELECT count(*) FROM quotes WHERE deleted_at < CURRENT_TIMESTAMP - INTERVAL '29 days'),\n'migrations',(SELECT count(*) FROM app_migrations WHERE key IN ('qingxi_material_prices_20260819','retire_heyuan_factory_20260819','configured_accounts_20260831_v1')),\n'missingSections',(SELECT count(*) FROM quotes q CROSS JOIN departments d WHERE NOT EXISTS(SELECT 1 FROM quote_sections s WHERE s.quote_id=q.id AND s.dept=d.code)),\n'missingManagers',(SELECT count(*) FROM factory_material_price_control c WHERE c.manager_user_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM factory_material_price_managers m WHERE m.factory_code=c.factory_code AND m.user_id=c.manager_user_id)),\n'missingUserFactories',(SELECT count(*) FROM users u WHERE NOT EXISTS(SELECT 1 FROM user_factories f WHERE f.user_id=u.id AND f.factory_code=u.factory_code)),\n'factoryMismatch',(SELECT count(*) FROM (VALUES ('qingxi','清溪',1,1),('heyuan','河源',2,0)) v(code,name_cn,sort_order,active) WHERE NOT EXISTS(SELECT 1 FROM factories f WHERE f.code=v.code AND f.name_cn=v.name_cn AND f.sort_order=v.sort_order AND f.active=v.active)),\n'departmentMismatch',(SELECT count(*) FROM (VALUES ('sales','业务',1),('engineering','工程/业务',2),('electronic','电子部',3),('molding','啤机部',4),('painting','喷油部',5),('slush','搪胶',6),('sewing','车缝',7),('assembly','装配部',8)) v(code,name_cn,sort_order) WHERE NOT EXISTS(SELECT 1 FROM departments d WHERE d.code=v.code AND d.name_cn=v.name_cn AND d.sort_order=v.sort_order)),\n'missingRefs',(SELECT count(*) FROM (VALUES ('material_prices'),('machine_prices')) v(key) WHERE NOT EXISTS(SELECT 1 FROM ref_tables r WHERE r.key=v.key)),\n'missingFactoryRefs',(SELECT count(*) FROM (VALUES ('qingxi'),('heyuan')) f(code) CROSS JOIN (VALUES ('material_prices'),('machine_prices'),('costing_basis')) v(key) WHERE NOT EXISTS(SELECT 1 FROM factory_ref_tables r WHERE r.factory_code=f.code AND r.key=v.key)));\nCOMMIT;\n"

SOURCE_NODE=r"""const fs=require('fs'),path=require('path'),crypto=require('crypto');const list=JSON.parse(fs.readFileSync(0,'utf8'));if(!Array.isArray(list)||list.length>2000)throw Error('scope');let out={};for(const n of list){if(!/^(?:(?:backend|frontend)\/[A-Za-z0-9_./-]+|package(?:-lock)?\.json)$/.test(n)||n.split('/').some(x=>x==='..'||x===''))throw Error('path');if(/^backend\/(?:data|legacy-data|uploads)(?:\/|$)/.test(n)||/(?:^|\/)\.env(?:\.|$)/.test(n))throw Error('business-path');const p='/app/'+n;let parent=path.dirname(p);while(parent!=='/'){if(fs.lstatSync(parent).isSymbolicLink())throw Error('parent-link');parent=path.dirname(parent);}if(!fs.existsSync(p)){out[n]={absent:true};continue;}let a=fs.lstatSync(p);if(!a.isFile()||a.isSymbolicLink()||a.size>128*1024**2)throw Error('regular-source');const fd=fs.openSync(p,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);try{let sha=crypto.createHash('sha256'),blob=crypto.createHash('sha1').update('blob '+a.size+'\0'),buf=Buffer.alloc(1024**2),size=0,k;while((k=fs.readSync(fd,buf,0,buf.length,null))>0){size+=k;sha.update(buf.subarray(0,k));blob.update(buf.subarray(0,k));}let z=fs.fstatSync(fd);if(size!==a.size||z.ino!==a.ino||z.size!==a.size||z.mtimeMs!==a.mtimeMs||z.ctimeMs!==a.ctimeMs)throw Error('source-changed');out[n]={sha256:sha.digest('hex'),gitBlobSHA1:blob.digest('hex'),bytes:size,uid:a.uid,gid:a.gid,mode:a.mode&4095};}finally{fs.closeSync(fd);}}console.log(JSON.stringify(out));"""
def source_inventory(cid):
 entries=git('ls-tree','-r','-z',TARGET,'--',APP).split(b'\0');expected={}
 for entry in entries:
  if not entry:continue
  meta,name=entry.split(b'\t',1);mode,kind,blob=meta.decode().split();name=name.decode();need(name.startswith(APP+'/'),'fixed-app-source-prefix');relative=name[len(APP)+1:]
  if not (relative.startswith(('backend/','frontend/'))or relative in('package.json','package-lock.json')):continue
  if relative.startswith(('backend/data/','backend/legacy-data/','backend/uploads/'))or re.search(r'(^|/)\.env(?:\.|$)',relative):continue
  need(mode in('100644','100755')and kind=='blob'and pin(blob,40)and re.fullmatch(r'[A-Za-z0-9_./-]+',relative),'regular-public-tracked-production-source');expected[relative]=blob
 need(1<=len(expected)<=2000,'bounded-production-source-manifest');actual=json.loads(command(['docker','exec','--user','0','-i',cid,'node','-e',SOURCE_NODE],8*1024**2,enc(sorted(expected)),180));need(set(actual)==set(expected),'all-tracked-production-files-observed');details={'expectedGitBlobSHA1':expected,'actual':actual};fd=os.open(OUT/'source-hashes.private.json',os.O_CREAT|os.O_EXCL|os.O_WRONLY|os.O_NOFOLLOW,0o600)
 with os.fdopen(fd,'wb')as file:file.write(enc(details));file.flush();os.fsync(file.fileno())
 differences=[]
 for name,value in actual.items():
  need(value=={'absent':True}or(set(value)=={'sha256','gitBlobSHA1','bytes','uid','gid','mode'}and pin(value['sha256'])and pin(value['gitBlobSHA1'],40)and all(type(value[k])is int and value[k]>=0 for k in('bytes','uid','gid','mode'))),'typed-source-hash-only-record')
  if value.get('gitBlobSHA1')!=expected[name]:differences.append(name)
 return {'trackedProductionFiles':len(expected),'differentFiles':sorted(differences),'allTrackedFilesMatchMain':not differences,'untrackedFilesNotEnumerated':True,'allFileBodiesCopied':False}
def unique_service(name):
 ids=command(['docker','ps','-aq','--no-trunc','--filter','label=com.docker.compose.project=rr-portal','--filter','label=com.docker.compose.service='+name],4096).decode().split();need(len(ids)==1 and pin(ids[0]),'one-formal-'+name);return ids[0]
def env_hash(cid):
 # Only this capture stays in memory; no Env values are written to logs or files.
 p=subprocess.run(['docker','inspect','--format','{{json .Config.Env}}',cid],capture_output=True,timeout=30);need(p.returncode==0 and len(p.stdout)<=1024**2,'bounded-readonly-env-in-memory');values=json.loads(p.stdout);need(type(values)is list and all(type(x)is str for x in values),'typed-env-array');return {'sha256':sha(enc(sorted(values))),'entryCount':len(values)}
def gateway_auth():
 cid=unique_service('nginx');mounts=json.loads(command(['docker','inspect','--format','{{json .Mounts}}',cid]));selected=[m for m in mounts if m.get('Destination')=='/etc/nginx/.htpasswd'];need(len(selected)==1 and selected[0].get('Type')=='bind'and selected[0].get('RW')is False,'actual-one-readonly-gateway-auth-bind');path=pathlib.Path(selected[0]['Source']);a=path.lstat();target=path.resolve(strict=True);record=shared_file(str(target));need((a.st_dev,a.st_ino,a.st_mode,a.st_mtime_ns,a.st_ctime_ns)==tuple(getattr(path.lstat(),n)for n in('st_dev','st_ino','st_mode','st_mtime_ns','st_ctime_ns')),'stable-auth-link-metadata');return {'resolvedRegular':record,'sourceType':'LNK'if stat.S_ISLNK(a.st_mode)else'REG','sourceUid':a.st_uid,'sourceGid':a.st_gid,'sourceMode':stat.S_IMODE(a.st_mode),'sourcePathSHA256':sha(os.fsencode(str(path))),'linkTextSHA256':sha(os.fsencode(os.readlink(path)))if stat.S_ISLNK(a.st_mode)else None}
def startup_counts():
 cid=unique_service('db');raw=command(['docker','exec','-i',cid,'sh','-c','exec psql -X -q -At -v ON_ERROR_STOP=1 -U "${POSTGRES_USER:-rrportal}" -d "${POSTGRES_DB:-rrportal}"'],65536,QUOTE_SQL.encode());value=json.loads(raw);need(type(value)is dict and all(type(n)is int and n>=0 for n in value.values()),'typed-readonly-startup-counts');need(set(value)=={'users','quotes','departments','purgeRisk','migrations','missingSections','missingManagers','missingUserFactories','factoryMismatch','departmentMismatch','missingRefs','missingFactoryRefs'},'fixed-startup-count-keys');eligible=value['users']>0 and value['migrations']==3 and value['departments']>=8 and all(v==0 for k,v in value.items()if k not in{'users','migrations','quotes','departments'});return {'counts':value,'startupGuardEligible':eligible,'expectedSingleStartupQuoteSectionSequenceIncrement':value['quotes']*value['departments'],'snapshotTaken':False}
def main():
 need(EXECUTE is True and sys.argv[1:]==['diagnose']and os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_MODE')=='diagnose'and os.environ.get('RELEASE_ATTEMPT')=='1'and pin(TARGET,40),'inert-first-readonly-quote-preflight');os.umask(0o077);need(OUT.parent.is_dir()and not OUT.parent.is_symlink()and not OUT.exists()and not OUT.is_symlink(),'fresh-own-private-evidence');OUT.mkdir(mode=0o700);v={'phase':'diagnose','target':TARGET,'success':False,'readOnly':True,'lifecycleOrConfigWrites':False,'databaseWrites':False,'plaintextCredentialsWritten':False,'businessFilesCopied':False}
 try:
  head=git('rev-parse','HEAD').decode().strip();tree=git('rev-parse','HEAD^{tree}').decode().strip();need(pin(head,40)and pin(tree,40),'typed-host-source');v.update(hostGitHead=head,hostGitTree=tree,sharedFiles={})
  for name in SHARED:
   live=shared_file(name);v['sharedFiles'][name]={**live,'matchesObservedGitHead':live['sha256']==sha(git('show',head+':'+name))}
  v['unstaged']=dirty_summary(git('diff','--name-only','-z'));v['staged']=dirty_summary(git('diff','--cached','--name-only','-z'));v['environmentFile']=shared_file('.env.cloud.production');v['gatewayAuth']=gateway_auth();cid=unique_service('internal-quote');v['runtime']=safe_runtime(json.loads(command(['docker','inspect','--format',RUNTIME_FORMAT,cid],8192)));need(v['runtime']['id']==cid,'same-quote-cid');v['containerEnv']=env_hash(cid);v['canonicalAlias']=safe_image(json.loads(command(['docker','image','inspect','--format',IMAGE_FORMAT,ALIAS],8192)));root=json.loads(command(['docker','info','--format','{{json .DockerRootDir}}'],4096));need(type(root)is str and pathlib.Path(root).is_absolute(),'absolute-docker-root');space=os.statvfs(root);v['space']={'available':space.f_bavail*space.f_frsize,'free':space.f_bfree*space.f_frsize};v['source']=source_inventory(cid);v['startup']=startup_counts();need(git('rev-parse','HEAD').decode().strip()==head,'host-head-stable-through-preflight');v['runtimeAfter']=safe_runtime(json.loads(command(['docker','inspect','--format',RUNTIME_FORMAT,cid],8192)));v['runtimeUnchanged']=v['runtime']==v['runtimeAfter'];v['success']=True
 except Exception as e:v.update(errorType=type(e).__name__,stage=STAGE)
 v['resultSHA256']=sha(enc(v));v['sha256Wire']={k:[int(c,16)for c in x]for k,x in v.items()if pin(x,40)or pin(x)};fd=os.open(OUT/'result.private.json',os.O_CREAT|os.O_EXCL|os.O_WRONLY|os.O_NOFOLLOW,0o600)
 with os.fdopen(fd,'wb')as f:f.write(enc(v));f.flush();os.fsync(f.fileno())
 print(json.dumps(v,sort_keys=True),flush=True);return 0 if v['success']else 1
if __name__=='__main__':sys.exit(main())
