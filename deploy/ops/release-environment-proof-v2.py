"""Fixed-release Env evidence; narrowly proven Python image metadata only."""
import hashlib,json,os,pathlib,re,stat
PRIOR=pathlib.Path('/opt/rr-portal/deploy/backups/release-937-943-944-945-946-950-deploy-20261019-v2')
MANIFEST_SHA256='c82b715b9265d9307417285e736f53388e49efe4ac3ddba407d32e35da8ca185'
RESULT_SHA256='664a41adf00c1e65aa2cfde91bbc337655d565aee01262c3321437904d7c0be8'
TARGET='85d2082c273d3df3e51b2e414855634c56c498dd'
OLD_INSPECT='002-release-validate-backup.stdout.private'
SERVICES=('qc','indo-shipping','internal-quote','factory-review','factory-review-test','qc-report','qc-report-worker')
MAX_JSON=32*1024**2
ROOT=pathlib.Path('/opt/rr-portal')
BASE='52c090589d6da542fee74ef17c8edd3b0dfe4fe6'
# Only the two keys observed in the reviewed fixed-release drift evidence.
PYTHON_METADATA_KEYS=('PYTHON_SHA256','PYTHON_VERSION')
OLD_DEFAULT_ARCHIVE=ROOT/'deploy/backups/release-qc-report-original-image-evidence-20261019'
OLD_DEFAULT_MANIFEST_SHA256='618e8114647488251ed01c4984d51b59aad01aeedc1ac9c4a3c46c8744a7ef70'
OLD_DEFAULT_RESULT_SHA256='58373f01e969b3c41e39da5fccf5180f860b14970218f81655c03bb7ef41e964'
PYTHON_SERVICES={'qc-report','qc-report-worker'}

class EnvironmentEvidenceError(RuntimeError):
 def __init__(self):super().__init__('ENVIRONMENT_EVIDENCE_REJECTED')

def need(value):
 if not value:raise EnvironmentEvidenceError()
def encoded(value):return json.dumps(value,sort_keys=True,ensure_ascii=True,separators=(',',':'),allow_nan=False).encode()
def sha(raw):return hashlib.sha256(raw).hexdigest()
def unique_pairs(pairs):
 result={}
 for key,value in pairs:
  need(key not in result);result[key]=value
 return result
def decoded(raw):
 need(type(raw)is bytes and len(raw)<=MAX_JSON)
 return json.loads(raw,object_pairs_hook=unique_pairs)
def private_read(path,maximum):
 need(not path.is_symlink())
 fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
 with os.fdopen(fd,'rb')as stream:
  before=os.fstat(stream.fileno());need(stat.S_ISREG(before.st_mode)and before.st_mode&0o077==0 and before.st_size<=maximum)
  raw=stream.read(maximum+1);after=os.fstat(stream.fileno())
  fields=lambda s:(s.st_dev,s.st_ino,s.st_size,s.st_mtime_ns,s.st_ctime_ns,s.st_mode)
  need(len(raw)==before.st_size and fields(before)==fields(after)and fields(path.lstat())==fields(after));return raw

def old_inspections():
 need(PRIOR.is_dir()and not PRIOR.is_symlink()and stat.S_IMODE(PRIOR.stat().st_mode)==0o700)
 manifest_raw=private_read(PRIOR/'manifest.json',1024**2);need(sha(manifest_raw)==MANIFEST_SHA256)
 manifest=decoded(manifest_raw);need(type(manifest)is dict and manifest.get('first-result.json')==RESULT_SHA256)
 receipt_raw=private_read(PRIOR/'first-result.json',1024**2);need(sha(receipt_raw)==RESULT_SHA256)
 receipt=decoded(receipt_raw);need(receipt.get('success')is False and receipt.get('target')==TARGET and receipt.get('failedStage')=='wait-healthy'and receipt.get('failedService')=='qc')
 expected=manifest.get(OLD_INSPECT);need(type(expected)is str and re.fullmatch('[a-f0-9]{64}',expected)is not None)
 raw=private_read(PRIOR/OLD_INSPECT,MAX_JSON);need(sha(raw)==expected)
 # This authenticates the fixed input files, not every file in the old archive.
 # Callers retain their separate full-archive/data-preservation checks.
 return decoded(raw)

def environments(rows):
 need(type(rows)is list and len(rows)<=1000)
 result={};total=0
 for row in rows:
  need(type(row)is str and '='in row);key,value=row.split('=',1)
  need(re.fullmatch('[A-Za-z_][A-Za-z0-9_]{0,127}',key)is not None and key not in result)
  total+=len(row.encode('utf-8'));need(total<=4*1024**2);result[key]=value
 return result

def records(value):
 need(type(value)is list and 1<=len(value)<=1000);result={}
 for row in value:
  need(type(row)is dict);cid=row.get('Id');need(type(cid)is str and re.fullmatch('[a-f0-9]{64}',cid)is not None and cid not in result)
  result[cid]=row
 return result

def bound_environment(row,expected,service):
 need(type(expected)is dict and re.fullmatch('sha256:[a-f0-9]{64}',expected.get('image','')or'')is not None and re.fullmatch('[a-f0-9]{64}',expected.get('environmentSHA256','')or'')is not None and row.get('Id')==expected.get('id')and row.get('Image')==expected.get('image'))
 config=row.get('Config');need(type(config)is dict);labels=config.get('Labels');need(type(labels)is dict)
 need(labels.get('com.docker.compose.project')=='rr-portal'and labels.get('com.docker.compose.service')==service)
 rows=config.get('Env');mapping=environments(rows)
 need(sha(encoded(rows))==expected.get('environmentSHA256'))
 return rows,mapping

def compose_source():
 path=ROOT/'docker-compose.cloud.yml';need(not path.is_symlink())
 fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
 with os.fdopen(fd,'rb')as stream:
  before=os.fstat(stream.fileno());need(stat.S_ISREG(before.st_mode)and before.st_size<=1024**2)
  raw=stream.read(1024**2+1);after=os.fstat(stream.fileno())
  fields=lambda s:(s.st_dev,s.st_ino,s.st_size,s.st_mtime_ns,s.st_ctime_ns,s.st_mode)
  need(len(raw)==before.st_size and fields(before)==fields(after)and fields(path.lstat())==fields(after));return raw

def original_python_image_defaults(service,image_id):
 need(service in PYTHON_SERVICES and re.fullmatch('[a-f0-9]{64}',OLD_DEFAULT_MANIFEST_SHA256 or '')is not None and re.fullmatch('[a-f0-9]{64}',OLD_DEFAULT_RESULT_SHA256 or '')is not None)
 directory=OLD_DEFAULT_ARCHIVE;need(directory.is_dir()and not directory.is_symlink()and stat.S_IMODE(directory.stat().st_mode)==0o700)
 names={'old-web-image.private.json','old-worker-image.private.json','first-result.json','manifest.json'}
 need({p.name for p in directory.iterdir()}==names)
 manifest_raw=private_read(directory/'manifest.json',1024**2);need(sha(manifest_raw)==OLD_DEFAULT_MANIFEST_SHA256)
 manifest=decoded(manifest_raw);need(type(manifest)is dict and set(manifest)==names-{'manifest.json'}and manifest['first-result.json']==OLD_DEFAULT_RESULT_SHA256)
 content={}
 for name,expected in manifest.items():
  need(type(expected)is str and re.fullmatch('[a-f0-9]{64}',expected)is not None)
  raw=private_read(directory/name,MAX_JSON);need(sha(raw)==expected);content[name]=decoded(raw)
 receipt=content['first-result.json'];need(type(receipt)is dict and all(receipt.get(key)is True for key in ('completed','success','oldWebImageSourceVerified','oldWorkerBaselineContainerAndImageBound','sourceAndEnvironmentFrozen')))
 filename='old-web-image.private.json'if service=='qc-report'else'old-worker-image.private.json'
 row=content[filename];need(type(row)is dict and row.get('Id')==image_id and type(row.get('Config'))is dict)
 result=environments(row['Config'].get('Env'))
 need({p.name for p in directory.iterdir()}==names and sha(private_read(directory/'manifest.json',1024**2))==OLD_DEFAULT_MANIFEST_SHA256)
 return result

def python_metadata_evidence(service,changed,added,removed,a,b,old_row,new_row,run):
 if service not in PYTHON_SERVICES or not changed or added or removed or not set(changed)<=set(PYTHON_METADATA_KEYS):return {}
 old_defaults=original_python_image_defaults(service,old_row['Image'])
 image_ids=[new_row['Image']]
 values=decoded(run(['docker','image','inspect',*image_ids]));need(type(values)is list and len(values)==len(image_ids))
 images={}
 for row in values:
  need(type(row)is dict and row.get('Id')in image_ids and row['Id']not in images and type(row.get('Config'))is dict)
  images[row['Id']]=environments(row['Config'].get('Env'))
 need(set(images)==set(image_ids))
 source=compose_source();need(source==run(['git','show',BASE+':docker-compose.cloud.yml']))
 config=decoded(run(['docker','compose','-p','rr-portal','-f',str(ROOT/'docker-compose.cloud.yml'),'--env-file',str(ROOT/'.env.cloud.production'),'config','--format','json']))
 need(type(config)is dict and type(config.get('services'))is dict and type(config['services'].get(service))is dict)
 explicit=config['services'][service].get('environment',{});need(type(explicit)is dict and all(type(k)is str and re.fullmatch('[A-Za-z_][A-Za-z0-9_]{0,127}',k)is not None for k in explicit))
 new_defaults=images[new_row['Image']]
 return {key:{'oldRuntimeMatchesImageDefault':key in old_defaults and a[key]==old_defaults[key],'newRuntimeMatchesImageDefault':key in new_defaults and b[key]==new_defaults[key],'explicitComposeKeyPresent':key in explicit}for key in changed}

def prove(before_runtime,after_runtime,run):
 """Return only safe fields per fixed service; run accepts read-only argv.

 Both rows' original ordered-array digests and exact container/image identities
 must match authenticated Docker inspections. Every Env key and value must be
 identical as a map, except the frozen Python metadata keys for two services.
 Metadata requires both exact image defaults and no explicit Compose key.
 The original strict map/array facts are retained; no other values may differ.
 """
 try:
  old=records(old_inspections());before=before_runtime['services'];after=after_runtime['services']
  need(type(before)is dict and type(after)is dict and set(SERVICES)<=set(before)&set(after))
  ids=[after[s]['id']for s in SERVICES]
  need(len(set(ids))==len(SERVICES)and all(type(cid)is str and re.fullmatch('[a-f0-9]{64}',cid)is not None for cid in ids))
  current=records(decoded(run(['docker','inspect',*ids])))
  need(set(current)==set(ids));proof={}
  for service in SERVICES:
   old_row=old[before[service]['id']];new_row=current[after[service]['id']]
   old_rows,a=bound_environment(old_row,before[service],service);new_rows,b=bound_environment(new_row,after[service],service)
   changed=sorted(key for key in a.keys()&b.keys()if a[key]!=b[key]);added=sorted(b.keys()-a.keys());removed=sorted(a.keys()-b.keys())
   same=a==b;array_same=before[service]['environmentSHA256']==after[service]['environmentSHA256']
   evidence=python_metadata_evidence(service,changed,added,removed,a,b,old_row,new_row,run)
   metadata=bool(evidence)and set(evidence)==set(changed)and all(v['oldRuntimeMatchesImageDefault']and v['newRuntimeMatchesImageDefault']and not v['explicitComposeKeyPresent']for v in evidence.values())
   proof[service]={'passed':same or metadata,'classification':(('identical-array'if array_same else'identical-map-order-only')if same else'classified-python-image-metadata'if metadata else'changed-or-unproven'),'changedKeys':changed,'addedKeys':added,'removedKeys':removed,'strictArraySHAEqual':array_same,'strictMapEqual':same,'imageMetadataProof':evidence}
  return proof
 except EnvironmentEvidenceError:raise
 except Exception:raise EnvironmentEvidenceError()from None
