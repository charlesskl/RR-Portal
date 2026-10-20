"""Classify only sealed phase04 Nginx inspect bytes; no live services or business calls."""
import collections,hashlib,json,os,pathlib,re,sys
PIN=False
BRANCH='refs/heads/ops/mail-readonly-20261020'
PRIOR=pathlib.Path('/opt/rr-portal/deploy/backups/voyageplex-mail-readonly-20261020-04')
OUT=pathlib.Path('/opt/rr-portal/deploy/backups/voyageplex-mail-readonly-20261020-05')
PRIOR_MANIFEST='3b4c423ed64faef24cfd351127ba3c4959b66723e955d5b5b85ca848423c863e'
PRIOR_RESULT='020c9d8798f9e0d02bf08336e54577ee02e83b5f993572f6815efa642b26ea94'
CID='6dcc97a4da0cad516f7bd44574ee8ff1c2455b0e8d5df67ab5f8b146f461d2ce'
def need(value):
 if not value:raise RuntimeError('SEALED_GATEWAY_CLASSIFICATION_REJECTED')
def enc(value):return json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=True,allow_nan=False).encode()
def digest(path):
 with path.open('rb')as stream:
  h=hashlib.sha256()
  for block in iter(lambda:stream.read(1024*1024),b''):h.update(block)
  return h.hexdigest()
def verify_prior():
 need(PRIOR.is_dir()and not PRIOR.is_symlink()and PRIOR.stat().st_mode&0o077==0);need(digest(PRIOR/'manifest.json')==PRIOR_MANIFEST and digest(PRIOR/'first-result.json')==PRIOR_RESULT);manifest=json.loads((PRIOR/'manifest.json').read_bytes());need(type(manifest)is dict);items=list(PRIOR.rglob('*'));need(len(items)<=100000 and all(not p.is_symlink()and(p.is_file()or p.is_dir())and p.stat().st_mode&0o077==0 for p in items));need(set(manifest)=={str(p.relative_to(PRIOR))for p in items if p.is_file()and p!=PRIOR/'manifest.json'});need(all(type(n)is str and re.fullmatch(r'[A-Za-z0-9_.-]+',n)and type(h)is str and re.fullmatch('[a-f0-9]{64}',h)and digest(PRIOR/n)==h for n,h in manifest.items()));return manifest
def sealed_inspect(manifest,label):
 names=[n for n in manifest if re.fullmatch(r'[0-9]{4}-nginx-'+label+r'-stdout\.private',n)];need(len(names)==1);blob=(PRIOR/names[0]).read_bytes();need(len(blob)<=16*1024**2 and hashlib.sha256(blob).hexdigest()==manifest[names[0]]);rows=json.loads(blob);need(type(rows)is list and len(rows)==1 and type(rows[0])is dict and rows[0].get('Id')==CID);return rows[0]
def classify(before,after):
 need(all(type(row.get('Id'))is str and type(row.get('Image'))is str and type(row.get('Config'))is dict and type(row.get('State'))is dict and type(row.get('Mounts'))is list and all(type(v)is dict for v in row['Mounts'])and type(row.get('RestartCount'))is int and type(row['State'].get('StartedAt'))is str for row in(before,after)));old,new=before['Mounts'],after['Mounts'];oldcounter=collections.Counter(enc(v)for v in old);newcounter=collections.Counter(enc(v)for v in new);unique=all(all(type(v.get('Destination'))is str for v in rows)and len({v['Destination']for v in rows})==len(rows)for rows in(old,new));oldmap={v['Destination']:v for v in old}if unique else{};newmap={v['Destination']:v for v in new}if unique else{}
 return {'exactEqualFields':{k:before[k]==after[k]for k in('Id','Image','Config','Mounts')},'startedAtChanged':before['State']['StartedAt']!=after['State']['StartedAt'],'restartCountChanged':before['RestartCount']!=after['RestartCount'],'mountsBeforeCount':len(old),'mountsAfterCount':len(new),'mountsOrderExactEqual':old==new,'mountsFullObjectMultisetEqual':oldcounter==newcounter,'mountObjectAddedCount':sum((newcounter-oldcounter).values()),'mountObjectRemovedCount':sum((oldcounter-newcounter).values()),'mountDestinationClassificationAvailable':unique,'mountDestinationAddedCount':len(newmap.keys()-oldmap.keys())if unique else None,'mountDestinationRemovedCount':len(oldmap.keys()-newmap.keys())if unique else None,'mountDestinationChangedCount':sum(oldmap[k]!=newmap[k]for k in oldmap.keys()&newmap.keys())if unique else None,'rawInspectOrMountValuesPrinted':False}
def private(name,blob):
 with(OUT/name).open('xb')as stream:stream.write(blob);stream.flush();os.fsync(stream.fileno())
def main():
 need(PIN and sys.argv[1:]==['classify']and os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_ATTEMPT')=='1');os.umask(0o077);OUT.mkdir(mode=0o700);result={'mode':'sealed-nginx-inspect-classification','observationPhase':5,'success':False,'liveRuntimeOrBusinessCallsPerformed':False,'priorFailedAcceptanceChanged':False}
 try:
  manifest=verify_prior();prior=json.loads((PRIOR/'first-result.json').read_bytes());need(prior.get('success')is False and prior.get('scope')=='nginx-only'and prior.get('observationPhase')==4 and prior.get('sameNginxContainerImageConfigMountsAndStart')is False);result['classification']=classify(sealed_inspect(manifest,'before'),sealed_inspect(manifest,'after'));need(verify_prior()==manifest);result.update(success=True,phase04FullSealVerifiedBeforeAndAfter=True,phase04ManifestSHA256=PRIOR_MANIFEST,phase04ResultSHA256=PRIOR_RESULT,phase04FilesPreserved=len(manifest))
 except Exception as error:result.update(safeFailure='SEALED_GATEWAY_CLASSIFICATION_INCOMPLETE',exceptionType=type(error).__name__ if type(error).__name__ in{'RuntimeError','OSError','ValueError','KeyError','TypeError'}else'Other')
 finally:
  private('first-result.json',enc(result));private('manifest.json',enc({'first-result.json':digest(OUT/'first-result.json')}));public=dict(result,manifestSHA256=digest(OUT/'manifest.json'),resultSHA256=digest(OUT/'first-result.json'));need(len(enc(public))<8192);print(enc(public).decode(),flush=True)
 return 0 if result['success']else 1
if __name__=='__main__':
 try:sys.exit(main())
 except Exception:print('{"success":false,"safeFailure":"SEALED_GATEWAY_CLASSIFICATION_PREFLIGHT_REJECTED"}',flush=True);sys.exit(1)
