"""Read-only cloud inventory for six requested PRs. No HTTP or service signals."""
import datetime,hashlib,json,os,pathlib,re,stat,subprocess,sys
ROOT=pathlib.Path('/opt/rr-portal')
OUT=ROOT/'deploy/backups/batch-1003-1011-20261026-inspect'
BASE='74b0f2143197dd1a814a4a11b0f737c3f110454e'
BRANCH='refs/heads/ops/batch-1003-1011-20261026'
EXECUTE=False
APPS={'qc':'apps/生产部/品质管理系统','rr-production':'apps/工程部/工程啤办单','gongcheng-ziliao':'apps/工程部/工程资料管理系统','factory-review':'apps/PMC跟仓管/加工厂月度评审管理制度','factory-review-test':'apps/PMC跟仓管/加工厂月度评审管理制度'}
FILES={'qc':{'qc-backend.js':'/app/qc-backend.js','server/server.js':'/app/server/server.js','server/auth.js':'/app/server/auth.js'},'rr-production':{'public/engineering.html':'/app/public/engineering.html','public/slush.html':'/app/public/slush.html','server.js':'/app/server.js'},'gongcheng-ziliao':{'vite-plugin-docs-api.ts':'/app/vite-plugin-docs-api.ts','package-lock.json':'/app/package-lock.json','src/sections/DocEditor.tsx':'/app/src/sections/DocEditor.tsx'},'factory-review':{'pb_hooks/lib/analysis_ai.js':'/pb/pb_hooks/lib/analysis_ai.js','pb_hooks/analysis_ai.pb.js':'/pb/pb_hooks/analysis_ai.pb.js'},'factory-review-test':{'pb_hooks/lib/analysis_ai.js':'/pb/pb_hooks/lib/analysis_ai.js','pb_hooks/analysis_ai.pb.js':'/pb/pb_hooks/analysis_ai.pb.js'}}
def need(v,label):
 if not v:raise RuntimeError(label)
def enc(v):return json.dumps(v,sort_keys=True,separators=(',',':'),ensure_ascii=True).encode()
def sha(v):return hashlib.sha256(v).hexdigest()
def file_sha(p):
 h=hashlib.sha256()
 with p.open('rb')as f:
  for b in iter(lambda:f.read(1024**2),b''):h.update(b)
 return h.hexdigest()
def run(a):return subprocess.check_output(a,stderr=subprocess.PIPE,timeout=60,cwd=ROOT)
def private(name,data):
 fd=os.open(OUT/name,os.O_CREAT|os.O_EXCL|os.O_WRONLY|os.O_NOFOLLOW,0o600)
 with os.fdopen(fd,'wb')as f:f.write(data)
def main():
 need(EXECUTE is True and sys.argv[1:]==['inspect'] and os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_MODE')=='inspect' and os.environ.get('RELEASE_ATTEMPT')=='1','inert-fixed-first-inspect')
 os.umask(0o077);need(not OUT.exists(),'one-inspect');OUT.mkdir(mode=0o700)
 need(run(['git','rev-parse','HEAD']).decode().strip()==BASE,'actual-host-base')
 ids=run(['docker','ps','-aq','--no-trunc']).decode().split();records=json.loads(run(['docker','inspect',*ids]));private('runtime.private.json',enc(records));result={}
 for name,app in APPS.items():
  found=[r for r in records if(r['Config'].get('Labels')or{}).get('com.docker.compose.project')=='rr-portal'and(r['Config'].get('Labels')or{}).get('com.docker.compose.service')==name];need(len(found)==1,'unique-service-'+name);r=found[0];proof={}
  need(r['State']['Running'],'running-'+name)
  for relative,path in FILES[name].items():
   raw=run(['docker','exec',r['Id'],'cat',path]);expected=run(['git','show',BASE+':'+app+'/'+relative]);proof[relative]={'actualSHA256':sha(raw),'baseSHA256':sha(expected),'matchesBase':raw==expected}
  result[name]={'id':r['Id'],'image':r['Image'],'started':r['State']['StartedAt'],'health':r['State'].get('Health',{}).get('Status'),'restartCount':r['RestartCount'],'configSHA256':sha(enc(r['Config'])),'hostConfigSHA256':sha(enc(r['HostConfig'])),'mounts':r['Mounts'],'sourceProof':proof}
 docs=ROOT/APPS['gongcheng-ziliao']/'资料库存储';need(docs.is_dir()and not docs.is_symlink(),'real-docs-root');inventory=[];xls={};xlsx={}
 for p in docs.rglob('*'):
  need(not p.is_symlink(),'no-docs-symlink')
  if p.is_file()and p.suffix.lower()in('.xls','.xlsx'):
   n=p.relative_to(docs).as_posix();inventory.append({'path':n,'bytes':p.stat().st_size,'sha256':file_sha(p)});key=n[:-len(p.suffix)].casefold();(xls if p.suffix.lower()=='.xls'else xlsx).setdefault(key,[]).append(n)
 private('docs-spreadsheets.private.json',enc(inventory))
 value={'phase':'inspect','base':BASE,'success':True,'targets':result,'docs':{'xls':sum(map(len,xls.values())),'xlsx':sum(map(len,xlsx.values())),'pairedNames':len(set(xls)&set(xlsx)),'xlsWithoutXlsx':len(set(xls)-set(xlsx)),'caseFoldAmbiguities':sum(len(v)>1 for v in list(xls.values())+list(xlsx.values()))},'containerCount':len(records),'utc':datetime.datetime.now(datetime.timezone.utc).isoformat()}
 private('result.private.json',enc(value));value['resultSHA256']=sha(enc(value));print(json.dumps(value,sort_keys=True),flush=True)
if __name__=='__main__':main()
