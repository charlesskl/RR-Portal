"""Inert read-only diagnosis of runtime representation; no lifecycle/SQL/HTTP."""
import datetime,hashlib,json,os,pathlib,subprocess,sys
ROOT=pathlib.Path('/opt/rr-portal')
OUT=ROOT/'deploy/backups/batch-1015-1019-1022-20261028-runtime-diagnose'
BASE='4b3d8f3e319e41dcc8720d759e1af0726a2b2381'
BRANCH='refs/heads/ops/batch-1015-1019-1022-20261028'
EXECUTE=True
PHASE='runtime-diagnose'
def enc(v):return json.dumps(v,sort_keys=True,separators=(',',':'),ensure_ascii=True,allow_nan=False).encode()
def sha(v):return hashlib.sha256(v).hexdigest()
def need(v,m):
 if not v:raise RuntimeError(m)
def run(a):return subprocess.check_output(a,cwd=ROOT,stderr=subprocess.PIPE,timeout=90)
def private(n,v):
 fd=os.open(OUT/n,os.O_CREAT|os.O_EXCL|os.O_WRONLY|os.O_NOFOLLOW,0o600)
 with os.fdopen(fd,'wb')as f:f.write(enc(v))
def snapshot():
 ids=run(['docker','ps','-aq','--no-trunc']).decode().split();need(len(ids)==46 and len(set(ids))==46,'original-container-count')
 values=json.loads(run(['docker','inspect',*ids]));need(len(values)==46,'full-runtime-inspect')
 return {r['Id']:{'image':r['Image'],'config':r['Config'],'hostConfig':r['HostConfig'],'mounts':r['Mounts'],'started':r['State']['StartedAt'],'restarts':r['RestartCount'],'running':r['State']['Running'],'oom':r['State']['OOMKilled'],'health':r['State'].get('Health',{}).get('Status')}for r in values}
def compare(a,b):
 result=[{'idPrefix':cid[:12],'changedFields':['presence'],'beforePresent':cid in a,'afterPresent':cid in b}for cid in sorted(set(a)^set(b))]
 for cid in sorted(set(a)&set(b)):
  old=a[cid]
  new=b[cid];fields=sorted(k for k in old if old[k]!=new[k])
  if not fields:continue
  labels=old['config'].get('Labels')or{};service=labels.get('com.docker.compose.service')
  need(service is None or service.replace('-','').isalnum(),'safe-service-label')
  mounts=sorted(old['mounts'],key=enc)==sorted(new['mounts'],key=enc)
  result.append({'idPrefix':cid[:12],'service':service,'changedFields':fields,'mountMultisetEqual':mounts,'onlyMountArrayOrder':fields==['mounts']and mounts})
 return result
def diagnose():
 need(run(['git','rev-parse','HEAD']).decode().strip()==BASE,'actual-host-base')
 reference_path=ROOT/'deploy/backups/batch-1015-1019-1022-20261028-inspect/runtime.private.json';need(reference_path.is_file()and not reference_path.is_symlink(),'regular-earlier-runtime-reference');reference_raw=reference_path.read_bytes();reference=json.loads(reference_raw)
 a=snapshot();b=snapshot();c=snapshot();private('current-a.private.json',a);private('current-b.private.json',b);private('current-c.private.json',c)
 maps={}
 for r in reference:
  maps[r['Id']]={'image':r['Image'],'config':r['Config'],'hostConfig':r['HostConfig'],'mounts':r['Mounts'],'started':r['State']['StartedAt'],'restarts':r['RestartCount'],'running':r['State']['Running'],'oom':r['State']['OOMKilled'],'health':r['State'].get('Health',{}).get('Status')}
 pairs=[compare(a,b),compare(b,c),compare(a,c)];keys={'image','config','hostConfig','started','restarts','running','oom','health'}
 stable=set(a)==set(b)==set(c)and all(all(a[cid][k]==b[cid][k]==c[cid][k]for k in keys)and sorted(a[cid]['mounts'],key=enc)==sorted(b[cid]['mounts'],key=enc)==sorted(c[cid]['mounts'],key=enc)for cid in a)
 targets={}
 for r in c.values():
  labels=r['config'].get('Labels')or{};name=labels.get('com.docker.compose.service')
  if labels.get('com.docker.compose.project')=='rr-portal'and name in{'internal-quote','paiji'}:need(name not in targets,'unique-target-label');targets[name]=r
 need(set(targets)=={'internal-quote','paiji'},'exact-two-current-targets')
 baseline=json.loads((ROOT/'deploy/backups/batch-1015-1019-1022-20261028-inspect/result.private.json').read_bytes());need(sha(enc(baseline))=='2d8b48851b11bd6df06a30c256eb758e8ad138eba195d249a104b331a9e2bdde','sealed-original-inventory-body');env=ROOT/'.env.cloud.production';old=baseline['hostFiles']['.env.cloud.production'];st=env.stat();current={'sha256':sha(env.read_bytes()),'uid':st.st_uid,'gid':st.st_gid,'mode':st.st_mode&0o777}
 return {'immediateReadDifferences':pairs,'allStableAfterOnlyMountArrayOrderNormalization':stable,'differencesFromEarlierInventoryNotAttributed':compare(maps,c),'earlierRuntimeReferenceFileSHA256':sha(reference_raw),'earlierReferenceCompleteSealWasNotProvided':True,'productionEnvMatchesSealedOriginal':current==old,'currentTargetsHealthy':all(r['running']and not r['oom']and r['health']=='healthy'for r in targets.values()),'readOnlyNoSignalsOrSQL':True}
def main():
 need(EXECUTE is True and sys.argv[1:]==[PHASE]and os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_MODE')==PHASE and os.environ.get('RELEASE_ATTEMPT')=='1','inert-first-diagnosis');os.umask(0o077);need(not OUT.exists()and not OUT.is_symlink(),'one-new-diagnosis');OUT.mkdir(mode=0o700);v={'phase':PHASE,'base':BASE,'success':False}
 try:v.update(diagnose());v['success']=True
 except Exception as e:v.update(errorType=type(e).__name__)
 v['utc']=datetime.datetime.now(datetime.timezone.utc).isoformat();private('result.private.json',v);v['resultSHA256']=sha(enc(v));print(json.dumps(v,sort_keys=True),flush=True);return 0 if v['success']else 1
if __name__=='__main__':sys.exit(main())
