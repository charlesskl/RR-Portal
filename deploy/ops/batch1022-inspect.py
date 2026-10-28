"""Inert scoped inventory. No signals, HTTP, business SQL or configuration writes."""
import datetime,hashlib,json,os,pathlib,stat,subprocess,sys
ROOT=pathlib.Path('/opt/rr-portal')
OUT=ROOT/'deploy/backups/batch-1015-1019-1022-20261028-inspect'
BASE='4b3d8f3e319e41dcc8720d759e1af0726a2b2381'
BRANCH='refs/heads/ops/batch-1015-1019-1022-20261028'
EXECUTE=False
APPS={'internal-quote':'apps/业务部/内部报价系统','paiji':'apps/生产部/注塑啤机排产系统'}
FILES={'internal-quote':{'backend/services/parseHardwareSheet.js':'/app/backend/services/parseHardwareSheet.js','frontend/mixed-sku.js':'/app/frontend/mixed-sku.js','frontend/quote.html':'/app/frontend/quote.html','package.json':'/app/package.json'},'paiji':{'server/services/excelExporter.js':'/app/services/excelExporter.js','server/package-lock.json':'/app/package-lock.json'}}
STAGE='entry'
def need(v,label):
 global STAGE
 STAGE=label
 if not v:raise RuntimeError(label)
def enc(v):return json.dumps(v,sort_keys=True,separators=(',',':'),ensure_ascii=True,allow_nan=False).encode()
def sha(v):return hashlib.sha256(v).hexdigest()
def run(a):return subprocess.check_output(a,stderr=subprocess.PIPE,timeout=90,cwd=ROOT)
def private(name,data):
 fd=os.open(OUT/name,os.O_CREAT|os.O_EXCL|os.O_WRONLY|os.O_NOFOLLOW,0o600)
 with os.fdopen(fd,'wb')as f:f.write(data if type(data)is bytes else enc(data))
def inventory():
 need(run(['git','rev-parse','HEAD']).decode().strip()==BASE,'exact-host-base')
 ids=run(['docker','ps','-aq','--no-trunc']).decode().split();need(len(ids)==len(set(ids)),'unique-containers')
 records=json.loads(run(['docker','inspect',*ids]));private('runtime.private.json',records);result={}
 for name,app in APPS.items():
  found=[r for r in records if(r['Config'].get('Labels')or{}).get('com.docker.compose.project')=='rr-portal'and(r['Config'].get('Labels')or{}).get('com.docker.compose.service')==name];need(len(found)==1,'unique-service-'+name);r=found[0];proof={}
  need(r['State']['Running']and not r['State']['OOMKilled']and r['State'].get('Health',{}).get('Status')=='healthy','healthy-'+name)
  for relative,path in FILES[name].items():
   raw=run(['docker','exec',r['Id'],'cat',path]);expected=run(['git','show',BASE+':'+app+'/'+relative]);proof[relative]={'actualSHA256':sha(raw),'baseSHA256':sha(expected),'matchesBase':raw==expected}
  result[name]={'id':r['Id'],'image':r['Image'],'started':r['State']['StartedAt'],'health':r['State']['Health']['Status'],'restartCount':r['RestartCount'],'configSHA256':sha(enc(r['Config'])),'hostConfigSHA256':sha(enc(r['HostConfig'])),'mounts':r['Mounts'],'sourceProof':proof}
 need(not any((r['Config'].get('Labels')or{}).get('com.docker.compose.service')=='xingxin-invoice'for r in records),'new-service-not-already-installed')
 files={}
 names=['.env.cloud.production','docker-compose.cloud.yml','nginx/nginx.cloud.conf','frontend/index.cloud.html','deploy/service-maintenance.sh']
 for name in names:
  p=ROOT/name;need(p.is_file()and not p.is_symlink(),'regular-host-file');st=p.stat();files[name]={'sha256':sha(p.read_bytes()),'uid':st.st_uid,'gid':st.st_gid,'mode':stat.S_IMODE(st.st_mode)}
 private('host-files.private.json',files)
 private('dirty-paths.private.json',run(['git','diff','--name-only','-z']))
 return{'base':BASE,'targets':result,'hostFiles':files,'containerCount':len(records),'sqlWritesHttpLoginOrLiveSignals':False}
def main():
 need(EXECUTE is True and sys.argv[1:]==['inspect']and os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_MODE')=='inspect'and os.environ.get('RELEASE_ATTEMPT')=='1','inert-fixed-first-inspection')
 os.umask(0o077);need(not OUT.exists()and not OUT.is_symlink(),'one-inspect');OUT.mkdir(mode=0o700);v={'phase':'inspect','success':False}
 try:v.update(inventory());v['success']=True
 except Exception as e:v.update(errorType=type(e).__name__,stage=STAGE)
 v['utc']=datetime.datetime.now(datetime.timezone.utc).isoformat();private('result.private.json',v);v['resultSHA256']=sha(enc(v));v['sha256Wire']={k:[int(c,16)for c in x]for k,x in v.items()if type(x)is str and len(x)in(40,64)and all(c in'0123456789abcdef'for c in x)};print(json.dumps(v,sort_keys=True),flush=True);return 0 if v['success']else 1
if __name__=='__main__':sys.exit(main())
