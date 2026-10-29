"""INERT ZURU read-only profile. No application import, lifecycle or business writes."""
import hashlib,importlib.util,json,os,pathlib,re,stat,subprocess,sys
ROOT=pathlib.Path('/opt/rr-portal');APP='apps/业务部/ZURU接单表入单系统';SERVICE='zuru-order-system';ALIAS='rr-portal-zuru-order-system:latest'
BRANCH='refs/heads/ops/pr-1039-20261029-zuru';OUT=ROOT/'deploy/backups/pr1039-zuru-preflight-1';BASE='91178c35b2013d32dc02808ece1d81924d567d0d';EXECUTE=True
DEPS={'pr1035-quote-preflight.py':'2b2739aa00cad03bfce8472b7416d725364b8d4ed354a5a7e9ca905a47aaffa5','pr1030-engineering-preflight.py':'3d06b2aef715f75740826ff75f91c1cb78e0927e030717795ef2733f0595a4d0'}
DELTA={'157145':({'cn_name':'牙齿怪兽','workshop':'兴信A','schedule_name':'牙齿怪兽'},{'cn_name':'牙齿怪兽','workshop':'A-华嘉','schedule_name':'牙齿怪兽'}),'15752':({'cn_name':'牙齿怪兽','workshop':'A-华嘉','schedule_name':'牙齿怪兽'},{'cn_name':'牙齿怪兽','workshop':'兴信A','schedule_name':'牙齿怪兽'}),'71184':(None,{'cn_name':'客版眼镜蛇','workshop':'兴信A','schedule_name':'恐龙系列'}),'77965':(None,{'cn_name':'3PK双色龙','workshop':'华登','schedule_name':'双色龙'}),'MEC494':(None,{'cn_name':'157131+157130+157128','workshop':'兴信A','schedule_name':'牙齿怪兽'}),'MSLD192':(None,{'cn_name':'77772','workshop':'兴信B','schedule_name':'迷你唱片球'}),'MSLD227':(None,{'cn_name':'牙齿怪兽','workshop':'兴信A','schedule_name':'牙齿怪兽'})}
STAGE='entry'
def need(v,label):
 global STAGE
 STAGE=label
 if not v:raise RuntimeError(label)
def enc(v):return json.dumps(v,sort_keys=True,separators=(',',':'),ensure_ascii=True,allow_nan=False).encode()
def sha(b):return hashlib.sha256(b).hexdigest()
def run(args,data=None,timeout=90):
 r=subprocess.run(args,input=data,capture_output=True,cwd=ROOT,timeout=timeout);need(r.returncode==0 and len(r.stdout)<=16*1024**2,'fixed-read-command-success-bounded');return r.stdout
def git(*args):return run(['git','-C',str(ROOT),'-c','core.hooksPath=/dev/null',*args])
def load(n):
 p=pathlib.Path(__file__).with_name(n);need(p.is_file()and not p.is_symlink()and sha(p.read_bytes())==DEPS[n],'pinned-readonly-dependency');spec=importlib.util.spec_from_file_location('readonly_'+n.replace('.','_'),p);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
def private(name,value):
 fd=os.open(OUT/name,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
 with os.fdopen(fd,'wb')as f:f.write(enc(value));f.flush();os.fsync(f.fileno())
def runtime():
 ids=run(['docker','ps','-aq','--no-trunc']).decode().split();need(ids and len(ids)<1000 and len(ids)==len(set(ids))and all(re.fullmatch('[a-f0-9]{64}',n)for n in ids),'all-container-id-set');rows=json.loads(run(['docker','inspect',*ids]));need({r['Id']for r in rows}==set(ids),'complete-in-memory-inspect');out={}
 for r in rows:
  out[r['Id']]={'image':r['Image'],'configSHA256':sha(enc(r['Config'])),'hostConfigSHA256':sha(enc(r['HostConfig'])),'mountsSHA256':sha(enc(sorted(r['Mounts'],key=enc))),'pid':r['State']['Pid'],'started':r['State']['StartedAt'],'restarts':r['RestartCount'],'running':r['State']['Running'],'oom':r['State']['OOMKilled'],'health':r['State'].get('Health',{}).get('Status')}
 target=[r for r in rows if(r['Config'].get('Labels')or{}).get('com.docker.compose.project')=='rr-portal'and(r['Config'].get('Labels')or{}).get('com.docker.compose.service')==SERVICE];need(len(target)==1,'one-zuru-container');return out,target[0]
CODE=r'''import os,sys,json,hashlib,stat
out={'python':sys.version.split()[0],'files':{}}
for n in json.load(sys.stdin):
 if n.startswith('/')or'..'in n.split('/')or'\\'in n:raise RuntimeError('scope')
 p='/app/'+n
 if not os.path.exists(p):out['files'][n]={'absent':True};continue
 if os.path.islink(p):raise RuntimeError('alias')
 ancestor=os.path.dirname(p)
 while ancestor!='/':
  if os.path.islink(ancestor):raise RuntimeError('parent-alias')
  ancestor=os.path.dirname(ancestor)
 fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW)
 try:
  a=os.fstat(fd)
  if not stat.S_ISREG(a.st_mode)or a.st_size>64*1024**2:raise RuntimeError('regular')
  b=b''
  while True:
   v=os.read(fd,1024**2)
   if not v:break
   b+=v
  z=os.fstat(fd);q=os.lstat(p);K=lambda s:(s.st_dev,s.st_ino,s.st_mode,s.st_uid,s.st_gid,s.st_size,s.st_mtime_ns,s.st_ctime_ns)
  if K(a)!=K(z)or K(a)!=K(q)or len(b)!=a.st_size:raise RuntimeError('changed')
  out['files'][n]={'sha256':hashlib.sha256(b).hexdigest(),'bytes':len(b),'uid':a.st_uid,'gid':a.st_gid,'mode':stat.S_IMODE(a.st_mode),'mtimeNs':a.st_mtime_ns}
 finally:os.close(fd)
print(json.dumps(out,sort_keys=True))'''
def map_profile(path):
 fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
 try:
  a=os.fstat(fd);need(stat.S_ISREG(a.st_mode)and a.st_size<=8*1024**2,'regular-bounded-item-map');body=os.read(fd,8*1024**2+1);z=os.fstat(fd);q=path.lstat();key=lambda s:(s.st_dev,s.st_ino,s.st_mode,s.st_uid,s.st_gid,s.st_size,s.st_mtime_ns,s.st_ctime_ns);need(key(a)==key(z)==key(q)and len(body)==a.st_size,'stable-item-map')
 finally:os.close(fd)
 def pairs(rows):
  d={}
  for k,v in rows:need(k not in d,'unique-json-keys');d[k]=v
  return d
 value=json.loads(body,object_pairs_hook=pairs);need(type(value)is dict and bool(value),'nonempty-item-map-object');states={}
 for k,(old,new)in DELTA.items():
  found=k in value;v=value.get(k);project={f:v.get(f)for f in new}if type(v)is dict else None;state='already-new'if found and project==new else'expected-old'if found and old is not None and project==old else'new-key-absent'if not found and old is None else'conflict'
  states[k]={'state':state,'present':found,'valueSHA256':sha(enc(v))if found else None,'extraFieldCount':len(set(v)-set(new))if type(v)is dict else 0,'oldExpectedSHA256':sha(enc(old))if old is not None else None,'newExpectedSHA256':sha(enc(new))}
 return{'fileSHA256':sha(body),'bytes':len(body),'uid':a.st_uid,'gid':a.st_gid,'mode':stat.S_IMODE(a.st_mode),'mtimeNs':a.st_mtime_ns,'entries':len(value),'unaffectedEntries':len(set(value)-set(DELTA)),'unaffectedCanonicalSHA256':sha(enc({k:v for k,v in value.items()if k not in DELTA})),'sevenKeyStates':states,'conflictCount':sum(v['state']=='conflict'for v in states.values())}
def wire(value):
 raw=enc(value);need(len(raw)<=4*1024**2,'bounded-numeric-output');nib=lambda v:[int(c,16)for c in(format(v,'x')if type(v)is int else v)];parts=[raw[i:i+1024]for i in range(0,len(raw),1024)];digest=nib(sha(raw))
 for i,b in enumerate(parts):print(enc([0,nib(i+1),nib(len(parts)),nib(len(raw)),digest,nib(b.hex())]).decode(),flush=True)
 print(enc([1,nib(len(parts)),nib(len(raw)),digest]).decode(),flush=True)
def main():
 need(EXECUTE is True and sys.argv[1:]==['diagnose']and os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_MODE')=='diagnose'and os.environ.get('RELEASE_ATTEMPT')=='1','explicit-first-readonly-zuru-profile');os.umask(0o077);need(OUT.parent.is_dir()and not OUT.parent.is_symlink()and not OUT.exists()and not OUT.is_symlink(),'fresh-owned-output');OUT.mkdir(mode=0o700);v={'mode':'diagnose','readOnly':True,'success':False,'service':SERVICE,'lifecycleOrConfigOrBusinessWrites':False,'baselineMain':BASE}
 try:
  P=load('pr1035-quote-preflight.py');P.OUT=OUT;E=load('pr1030-engineering-preflight.py');before,r=runtime();v['runtime']=before[r['Id']];v['containerId']=r['Id'];v['allRuntime']=before;v['hostGitHead']=git('rev-parse','HEAD').decode().strip();need(re.fullmatch('[a-f0-9]{40}',v['hostGitHead']),'typed-host-head');shared={n:P.shared_file(n)for n in P.SHARED};v['shared']=shared;v['sharedMatchHostHead']=all(z['sha256']==sha(git('show',v['hostGitHead']+':'+n))for n,z in shared.items());v['environmentFile']=P.shared_file('.env.cloud.production');v['gatewayAuth']=P.gateway_auth();v['dirty']={'unstagedSHA256':sha(git('diff','--name-only','-z')),'stagedSHA256':sha(git('diff','--cached','--name-only','-z'))}
  alias=json.loads(run(['docker','image','inspect',ALIAS]));need(len(alias)==1 and re.fullmatch('sha256:[a-f0-9]{64}',alias[0]['Id']),'one-canonical-image');v['canonicalImage']=alias[0]['Id'];v['oneWorkerFourThreads']=r['Config'].get('Cmd')==['gunicorn','--bind','0.0.0.0:5005','--workers','1','--threads','4','--timeout','300','app:app'];environment=dict(n.split('=',1)for n in r['Config']['Env']if'='in n);v['expectedRuntimeFlags']=all(environment.get(k)==z for k,z in{'DATA_PATH':'/app','LOCAL_MODE':'0','FLASK_DEBUG':'0'}.items())
  expected={}
  for row in git('ls-tree','-r','-z',BASE,'--',APP).split(b'\0'):
   if not row:continue
   meta,full=row.split(b'\t',1);mode,kind,blob=meta.decode().split();n=full.decode()[len(APP)+1:]
   if n in('app.py','po_parser.py','requirements.txt')or n.startswith(('templates/','static/')):need(mode in('100644','100755')and kind=='blob','regular-baseline-production-source');expected[n]=sha(git('show',BASE+':'+APP+'/'+n))
  code=json.loads(run(['docker','exec','-i',r['Id'],'python','-c',CODE],enc(sorted(expected)),timeout=180));v['code']=code;v['baselineProductionFiles']=len(expected);v['differentBaselineFiles']=[n for n,h in expected.items()if code['files'][n].get('sha256')!=h]
  space=os.statvfs(json.loads(run(['docker','info','--format','{{json .DockerRootDir}}'])));v['space']={'available':space.f_bavail*space.f_frsize,'free':space.f_bfree*space.f_frsize};v['itemMap']=map_profile(ROOT/APP/'data/item_map.json');v['storage']={}
  for name in('data','uploads','exports'):
   mounts=[m for m in r['Mounts']if m['Destination']=='/app/'+name];need(len(mounts)==1 and mounts[0]['Type']=='bind'and pathlib.Path(mounts[0]['Source'])==ROOT/APP/name,'exact-three-storage-bind-roots');inventory,summary=E.full_inventory(ROOT/APP/name);private(name+'-inventory.private.json',inventory);v['storage'][name]=summary
  after,_=runtime();need(before==after and git('rev-parse','HEAD').decode().strip()==v['hostGitHead'],'all-original-runtime-and-host-head-unchanged');v['allOriginalRuntimeUnchanged']=True;v['success']=True
 except Exception as e:v.update(errorType=type(e).__name__,stage=STAGE)
 v['resultSHA256']=sha(enc(v));private('result.private.json',v);wire(v);return 0 if v['success']else 1
if __name__=='__main__':sys.exit(main())
