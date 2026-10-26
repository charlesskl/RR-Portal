"""Inert PR1013 read-only inventory. Two PB services; no HTTP, SQL writes or signals."""
import contextlib,datetime,hashlib,io,json,os,pathlib,re,sqlite3,stat,subprocess,sys,tarfile,urllib.parse
ROOT=pathlib.Path('/opt/rr-portal')
OUT=ROOT/'deploy/backups/pr-1013-20261026-inspect'
BASE='df60d6a6b1e7f76070cd866cbbc6a4ee50936122'
BRANCH='refs/heads/ops/pr-1013-20261026'
EXECUTE=True
APP='apps/PMC跟仓管/加工厂月度评审管理制度'
SERVICES={'factory-review-test':'pb_data_test','factory-review':'pb_data'}
STAGE='entry'
def need(v,label):
 global STAGE
 STAGE=label
 if not v:raise RuntimeError(label)
def enc(v):return json.dumps(v,sort_keys=True,separators=(',',':'),ensure_ascii=True,allow_nan=False).encode()
def sha(v):return hashlib.sha256(v).hexdigest()
def run(a,limit=8*1024**2):
 p=subprocess.run(a,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=60,cwd=ROOT)
 need(p.returncode==0 and len(p.stdout)<=limit,'bounded-read-command');return p.stdout
def private(name,v):
 need(re.fullmatch('[a-z0-9.-]+',name)is not None,'fixed-private-evidence-name')
 fd=os.open(OUT/name,os.O_CREAT|os.O_EXCL|os.O_WRONLY|os.O_NOFOLLOW,0o600)
 with os.fdopen(fd,'wb')as f:f.write(v if type(v)is bytes else enc(v));f.flush();os.fsync(f.fileno())
def environment(r):
 result={}
 for item in r['Config'].get('Env')or[]:
  k,sep,v=item.partition('=');need(sep and k and k not in result,'unique-configured-env');result[k]=v
 return result
def safe(n):
 p=pathlib.PurePosixPath(n)
 return bool(n)and str(p)==n and not p.is_absolute()and'..'not in p.parts and'\\'not in n and all(ord(c)>=32 for c in n)
def code_tree(cid,name):
 need(name in('pb_hooks','pb_public','pb_migrations'),'fixed-public-code-tree')
 blob=run(['docker','cp',cid+':/pb/'+name,'-'],512*1024**2);result={};seen=set();total=0
 with tarfile.open(fileobj=io.BytesIO(blob))as archive:
  for m in archive.getmembers():
   n=m.name.rstrip('/');need(safe(n)and n not in seen and(m.isfile()or m.isdir())and(n==name or n.startswith(name+'/')),'regular-bounded-code-archive');seen.add(n)
   if not m.isfile():continue
   total+=m.size;need(m.size<=128*1024**2 and total<=512*1024**2 and len(result)<15000,'bounded-public-code-inventory')
   raw=archive.extractfile(m).read();need(len(raw)==m.size,'complete-code-file');result[n[len(name)+1:]]={'sha256':sha(raw),'bytes':m.size,'mode':m.mode,'uid':m.uid,'gid':m.gid}
 need(result,'nonempty-public-code-tree');return result
def source_tree(name):
 prefix=APP+'/'+name+'/';rows=run(['git','ls-tree','-r','--name-only','-z',BASE,'--',APP+'/'+name]).decode().rstrip('\0').split('\0');result={}
 for n in rows:
  need(n.startswith(prefix)and safe(n),'fixed-base-code-path');result[n[len(prefix):]]=sha(run(['git','show',BASE+':'+n],128*1024**2))
 return result
def db_guard(path,e,expected):
 need(path.is_file()and not path.is_symlink()and path.stat().st_size>0,'existing-pb-database-no-seed')
 uri='file:'+urllib.parse.quote(str(path),safe='/')+'?mode=ro'
 with contextlib.closing(sqlite3.connect(uri,uri=True,timeout=15))as db:
  db.execute('PRAGMA query_only=ON');db.execute('BEGIN');need(db.execute('PRAGMA quick_check').fetchone()[0]=='ok','sqlite-quick-check')
  email=e.get('FACTORY_REVIEW_ADMIN_EMAIL','').strip();pw=e.get('FACTORY_REVIEW_ADMIN_PASSWORD','')
  admin=bool(email)and len(pw)>=12 and db.execute('SELECT count(*) FROM users WHERE email=?',(email,)).fetchone()[0]==1
  applied={r[0]for r in db.execute('SELECT file FROM _migrations')};missing=sorted(set(expected)-applied)
  schema=db.execute("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").fetchall()
  result={'integrity':'ok','existingAdminPreventsHealthSeedWrite':admin,'allApplicationMigrationsAlreadyApplied':not missing,'missingMigrationFiles':missing,'schemaSHA256':sha(enc(schema)),'readOnlyTransaction':True}
 need(admin and not missing,'existing-admin-and-applied-migrations');return result
def public_ai(e):
 model=e.get('FACTORY_REVIEW_AI_MODEL','');secrets={e.get(k)for k in('FACTORY_REVIEW_AI_API_KEY','FACTORY_REVIEW_ADMIN_PASSWORD','INTEGRATION_API_KEY','FACTORY_REVIEW_QMS_READ_TOKEN')}
 model=model if re.fullmatch('[A-Za-z0-9_./:-]{1,160}',model or'')and model not in secrets else 'configured-unreported'if model else''
 provider=e.get('FACTORY_REVIEW_AI_PROVIDER','');provider=provider if provider in('openai','qwen')else'configured-other'if provider else''
 return {'enabled':e.get('FACTORY_REVIEW_AI_ENABLED')=='true','provider':provider,'model':model,'apiKeyConfigured':bool(e.get('FACTORY_REVIEW_AI_API_KEY')),'baseURLConfigured':bool(e.get('FACTORY_REVIEW_AI_BASE_URL')),'configurationSHA256':sha(enc({k:v for k,v in e.items()if k.startswith('FACTORY_REVIEW_AI_')})),'secretValuesReturned':False}
def inspect():
 need(run(['git','rev-parse','HEAD']).decode().strip()==BASE,'actual-canonical-host-base')
 app_tree=run(['git','rev-parse',BASE+':'+APP]).decode().strip();base_hooks=source_tree('pb_hooks');base_migrations=source_tree('pb_migrations');result={}
 for service,data_name in SERVICES.items():
  ids=run(['docker','ps','-aq','--no-trunc','--filter','label=com.docker.compose.project=rr-portal','--filter','label=com.docker.compose.service='+service]).decode().split();need(len(ids)==1,'one-scoped-service')
  r=json.loads(run(['docker','inspect',ids[0]]))[0];need(r['Id']==ids[0]and r['State']['Running']and not r['State']['OOMKilled']and r['State'].get('Health',{}).get('Status')=='healthy','healthy-original-service')
  need(re.fullmatch('[a-f0-9]{64}',r['Id'])and re.fullmatch('sha256:[a-f0-9]{64}',r['Image']),'immutable-runtime-identities');mounts=r['Mounts'];data=ROOT/APP/data_name
  need(len(mounts)==1 and mounts[0]['Type']=='bind'and mounts[0]['Source']==str(data)and mounts[0]['Destination']=='/pb/pb_data'and mounts[0]['RW']is True and data.is_dir()and not data.is_symlink(),'same-existing-single-data-bind')
  private(service+'-runtime.private.json',r);e=environment(r);image=json.loads(run(['docker','image','inspect',r['Image']]))[0];need(image['Id']==r['Image'],'same-old-image');private(service+'-old-image.private.json',image)
  hooks=code_tree(r['Id'],'pb_hooks');public=code_tree(r['Id'],'pb_public');migrations=code_tree(r['Id'],'pb_migrations')
  for name,rows in(('hooks',hooks),('public',public),('migrations',migrations)):private(service+'-'+name+'-manifest.private.json',rows)
  hook_match={n:hooks.get(n,{}).get('sha256')==h for n,h in base_hooks.items()};migration_match={n:migrations.get(n,{}).get('sha256')==h for n,h in base_migrations.items()}
  expected_migrations={pathlib.PurePosixPath(n).name for n in base_migrations if n.endswith('.js')};need(expected_migrations,'nonempty-base-migrations');guard=db_guard(data/'data.db',e,expected_migrations)
  alias='rr-portal-'+service+':latest';aliases=run(['docker','image','ls','--quiet','--no-trunc','--filter','reference='+alias]).decode().split();need(len(aliases)<=1 and all(re.fullmatch('sha256:[a-f0-9]{64}',x)for x in aliases),'fixed-compose-alias-only')
  version=run(['docker','exec',r['Id'],'/pb/pocketbase','--version'],4096).decode().strip();need(re.fullmatch('[A-Za-z0-9 .+_-]{1,120}',version)is not None,'bounded-public-pb-version')
  result[service]={'id':r['Id'],'image':r['Image'],'health':'healthy','started':r['State']['StartedAt'],'restartCount':r['RestartCount'],'pocketbaseVersion':version,'configuredEnvSHA256':sha(enc(e)),'configSHA256':sha(enc(r['Config'])),'hostConfigSHA256':sha(enc(r['HostConfig'])),'mountsSHA256':sha(enc(mounts)),'companyAI':public_ai(e),'dataGuard':guard,'hookFileCount':len(hooks),'baseHookFileCount':len(base_hooks),'allBaseHookFilesMatch':set(hooks)==set(base_hooks)and all(hook_match.values()),'differingBaseHookPaths':[n for n,v in hook_match.items()if not v],'hooksManifestSHA256':sha(enc(hooks)),'allBaseMigrationFilesMatch':set(migrations)==set(base_migrations)and all(migration_match.values()),'differingBaseMigrationPaths':[n for n,v in migration_match.items()if not v],'migrationsManifestSHA256':sha(enc(migrations)),'frontend':{'fileCount':len(public),'bytes':sum(x['bytes']for x in public.values()),'manifestSHA256':sha(enc(public)),'indexSHA256':public.get('index.html',{}).get('sha256')},'composeAlias':{'name':alias,'image':aliases[0]if aliases else None},'maintenanceFlagExists':(ROOT/'deploy/maintenance/services'/service).exists()}
 return {'appTree':app_tree,'services':result,'sqlWritesHTTPLoginModelCallsOrServiceSignals':False}
def main():
 need(EXECUTE is True and sys.argv[1:]==['inspect']and os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_MODE')=='inspect'and os.environ.get('RELEASE_ATTEMPT')=='1','inert-exact-first-inspect')
 os.umask(0o077);need(not OUT.exists()and not OUT.is_symlink(),'one-inspect');OUT.mkdir(mode=0o700);value={'phase':'inspect','base':BASE,'success':False}
 try:value.update(inspect());value['success']=True
 except Exception as e:
  value.update(errorType=type(e).__name__,stage=STAGE)
  if isinstance(e,RuntimeError)and re.fullmatch('[a-z][a-z0-9-]{0,150}',str(e)):value['errorLabel']=str(e)
 value['utc']=datetime.datetime.now(datetime.timezone.utc).isoformat();value['resultSHA256']=sha(enc(value));print(enc(value).decode(),flush=True);return 0 if value['success']else 1
if __name__=='__main__':sys.exit(main())
