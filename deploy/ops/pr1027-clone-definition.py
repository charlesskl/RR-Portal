"""Inert static JSON diagnostic for one failed PR1027 private-clone rehearsal.
Only fixed manifest/result and selected immutable capture JSON files are read.
Mutable private PGDATA is neither traversed nor described as sealed/static.
No rows, credentials, environment or log bodies output. Differing constraint definitions expose only SQL structure, with every SQL string literal hashed; escaped/unsupported definitions fail closed.
"""
import os,json,pathlib,re,stat,subprocess,sys,hashlib,collections
EXECUTE=False
BRANCH='refs/heads/ops/pr-1027-clone-diagnostic-20261028'
ROOT=pathlib.Path('/opt/rr-portal')
PREPARE=ROOT/'deploy/backups/pr1027-indo-20261028/prepare'
OUT=ROOT/'deploy/backups/pr1027-indo-20261028-clone-diagnostic-2'
TARGET='fd32ce653647474acf8c6c8e7aa84dfd11854bfc'
MANIFEST_SHA256='ebb2ba04a87983f47f81f418ca3767a01484407f64b273018625663d07e1dad8'
RESULT_SHA256='9c9868c71e528cf23a89077596480b72bcc40f9192661ad499936d76e79f1524'
SELECTED={'beforeRestore':'online-before/postgres/postgres.private.json','afterRestore':'clone-startup/restored-before/postgres.private.json','afterStartup':'clone-startup/after-start/postgres/postgres.private.json'}
TOP_KEYS=('tables','schema','postgresDetails','startupChecks','startupSourceSHA256')
COLUMN_FIELDS={'table','name','position','type','notNull','default','identity','generated','collation'}
DETAIL_FIELDS={'schema':{'name','owner','acl'},'objects':{'name','kind','owner','acl','rls','forceRls','persistence'},'constraintFlags':{'table','name','definition','type','validated','deferrable','deferred','local','inheritCount','noInherit'}}
def need(value,label):
 if not value:raise RuntimeError(label)
def enc(value):return json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=True,allow_nan=False).encode()
def sha(value):return hashlib.sha256(value).hexdigest()
def raw(path):
 need(not any(p.is_symlink()for p in(path,*path.parents)),'regular-evidence-no-symlink')
 fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
 try:
  a=os.fstat(fd);need(stat.S_ISREG(a.st_mode)and a.st_size<=32*1024**2,'bounded-regular-evidence');parts=[]
  while True:
   b=os.read(fd,1024**2)
   if not b:break
   parts.append(b);need(sum(map(len,parts))<=32*1024**2,'bounded-evidence-read')
  body=b''.join(parts);z=os.fstat(fd);key=lambda s:(s.st_dev,s.st_ino,s.st_mode,s.st_uid,s.st_gid,s.st_size,s.st_mtime_ns,s.st_ctime_ns)
  need(key(a)==key(z)==key(path.lstat())and len(body)==a.st_size,'stable-selected-evidence-read');return body
 finally:os.close(fd)
def read(path):return json.loads(raw(path))
def digest_pair(a,b):return {'same':a==b,'beforeSHA256':sha(enc(a)),'afterSHA256':sha(enc(b))}
def indexed(values,keys):
 need(type(values)is list and len(values)<=100000 and all(type(v)is dict and all(type(v.get(k))is str for k in keys)for v in values),'bounded-typed-catalog-list')
 result={tuple(v[k]for k in keys):v for v in values};need(len(result)==len(values),'unique-catalog-identities');return result

def differing_fields(a,b,allowed):
 counts=collections.Counter();unknown=0
 for key in set(a)|set(b):
  if a.get(key)!=b.get(key)or(key in a)!=(key in b):
   if key in allowed:counts[key]+=1
   else:unknown+=1
 return dict(counts),unknown

def columns(a,b):
 left,right=indexed(a,('table','name')),indexed(b,('table','name'));same=set(left)==set(right);counts=collections.Counter();unknown=0;changed=0
 for key in set(left)&set(right):
  fields,n=differing_fields(left[key],right[key],COLUMN_FIELDS);counts.update(fields);unknown+=n;changed+=bool(fields or n)
 def order(values):
  groups={}
  for row in values:
   need(type(row.get('position'))is int and row['position']>0,'typed-column-position')
   groups.setdefault(row['table'],[]).append((row['position'],row['name']))
  return {k:[name for _,name in sorted(v)]for k,v in groups.items()}
 actual=set(counts);return {'inventorySame':same,'beforeColumnCount':len(left),'afterColumnCount':len(right),'changedColumnCount':changed,'differingFieldCounts':dict(counts),'unknownFieldDifferenceCount':unknown,'onlyPositionDiff':same and actual=={'position'}and not unknown,'onlyCollationOidDiff':same and actual=={'collation'}and not unknown,'onlyPositionAndCollationDiff':same and bool(actual)and actual<={'position','collation'}and not unknown,'logicalColumnOrderSame':same and order(a)==order(b)}

def catalog_detail(a,b,keys,allowed):
 left,right=indexed(a,keys),indexed(b,keys);counts=collections.Counter();unknown=0;changed=0
 for key in set(left)&set(right):
  fields,n=differing_fields(left[key],right[key],allowed);counts.update(fields);unknown+=n;changed+=bool(fields or n)
 return dict(digest_pair(a,b),inventorySame=set(left)==set(right),beforeObjectCount=len(left),afterObjectCount=len(right),changedObjectCount=changed,differingFieldCounts=dict(counts),unknownFieldDifferenceCount=unknown)

def redacted_definition(value):
 need(type(value)is str and len(value)<=4096,'bounded-constraint-definition')
 result={'sha256':sha(value.encode())}
 if '$'in value or re.search(r"\b[Ee]'|\b[Uu]&",value):return dict(result,text='<escaped-definition-redacted>')
 pieces=[];i=0
 while i<len(value):
  c=value[i]
  if c not in("'",'"'):pieces.append(c);i+=1;continue
  j=i+1
  while j<len(value):
   if value[j]==c:
    if j+1<len(value)and value[j+1]==c:j+=2;continue
    break
   j+=1
  if j==len(value):return dict(result,text='<unparsed-definition-redacted>')
  label='literal'if c=="'"else'quoted-identifier'
  pieces.append('<'+label+'-sha256:'+sha(value[i:j+1].encode())+'>');i=j+1
 safe=''.join(pieces)
 if any(ord(c)<32 and c not in'\t\r\n'for c in safe):return dict(result,text='<unparsed-definition-redacted>')
 return dict(result,text=' '.join(safe.split()))

def constraint_definitions(a,b):
 left,right=indexed(a,('table','name')),indexed(b,('table','name'));result=[]
 for key in sorted(set(left)&set(right)):
  x,y=left[key].get('definition'),right[key].get('definition')
  if x!=y:
   need(len(result)<16,'bounded-differing-definition-count')
   result.append({'tableNameSHA256':sha(key[0].encode()),'constraintNameSHA256':sha(key[1].encode()),'beforeRedacted':redacted_definition(x),'afterRedacted':redacted_definition(y)})
 return result

def compare(a,b):
 need(type(a)is type(b)is dict and all(k in a and k in b for k in TOP_KEYS),'complete-selected-postgres-captures')
 table={};ta,tb=a['tables'],b['tables'];need(type(ta)is type(tb)is dict and len(set(ta)|set(tb))<=1000,'bounded-table-metadata')
 for name in sorted(set(ta)|set(tb)):
  need(type(name)is str,'typed-table-name');x,y=ta.get(name),tb.get(name);both=type(x)is type(y)is dict
  table[sha(name.encode())]={'presentBefore':x is not None,'presentAfter':y is not None,'rowCountSame':both and x.get('rows')==y.get('rows'),'rowHashSame':both and x.get('sha256')==y.get('sha256'),'allOriginalColumnsHashSame':both and x.get('originalColumnsSHA256')==y.get('originalColumnsSHA256')}
 sa,sb=a['schema'],b['schema'];schema={'columns':columns(sa['columns'],sb['columns'])}
 for key in('constraints','sequences','objects','indexes'):schema[key]=digest_pair(sa.get(key),sb.get(key))
 pa,pb=a['postgresDetails'],b['postgresDetails'];fields,unknown=differing_fields(pa.get('schema')or{},pb.get('schema')or{},DETAIL_FIELDS['schema'])
 details={'schema':dict(digest_pair(pa.get('schema'),pb.get('schema')),differingFieldCounts=fields,unknownFieldDifferenceCount=unknown)}
 details['objects']=catalog_detail(pa['objects'],pb['objects'],('name','kind'),DETAIL_FIELDS['objects'])
 details['constraintFlags']=catalog_detail(pa['constraintFlags'],pb['constraintFlags'],('table','name'),DETAIL_FIELDS['constraintFlags'])
 details['constraintDefinitionDifferences']=constraint_definitions(pa['constraintFlags'],pb['constraintFlags'])
 return {'differingTopKeys':[k for k in TOP_KEYS if a[k]!=b[k]],'topKeyEquality':{k:a[k]==b[k]for k in TOP_KEYS},'tablesByHashedName':table,'schema':schema,'postgresDetails':details,'sequenceStates':digest_pair(a.get('sequenceStates'),b.get('sequenceStates'))}

def command(args):
 p=subprocess.run(args,cwd=ROOT,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=20)
 need(len(p.stdout)+len(p.stderr)<=1024**2,'bounded-docker-readonly-output');return p

def main():
 need(EXECUTE is True and sys.argv[1:]==['diagnose']and os.environ.get('RELEASE_MODE')=='diagnose'and os.environ.get('RELEASE_ATTEMPT')=='1'and os.environ.get('RELEASE_BRANCH')==BRANCH,'inert-first-observation')
 os.umask(0o077);need(OUT.parent.is_dir()and not OUT.parent.is_symlink()and not OUT.exists()and not OUT.is_symlink(),'fresh-own-private-diagnostic');OUT.mkdir(mode=0o700)
 result={'phase':'diagnose','target':TARGET,'success':False,'readOnly':True,'selectedStaticJSONOnly':True,'wholeMutableArchiveSealClaimed':False}
 try:
  manifest_raw=raw(PREPARE/'manifest.json');failure_raw=raw(PREPARE/'result.private.json');need(sha(manifest_raw)==MANIFEST_SHA256 and sha(failure_raw)==RESULT_SHA256,'fixed-original-manifest-and-result-byte-seals')
  manifest=json.loads(manifest_raw);failure=json.loads(failure_raw)
  need(type(manifest)is dict and failure.get('success')is False and failure.get('phase')=='prepare'and failure.get('target')==TARGET and failure.get('stage')=='all-full-rows-ids-schema-owner-acl-rls-and-startup-source-identical','fixed-failed-clone-comparison')
  values={};present={}
  for label,name in SELECTED.items():
   path=PREPARE/name;present[label]=path.exists()
   if not present[label]:continue
   body=raw(path);need(name in manifest and sha(body)==manifest[name],'selected-static-json-byte-sealed');values[label]=json.loads(body)
  result['captureFilesPresent']=present;result['comparisons']={}
  for first,last,label in(('beforeRestore','afterRestore','beforeRestoreToAfterRestore'),('afterRestore','afterStartup','afterRestoreToAfterStartup'),('beforeRestore','afterStartup','beforeRestoreToAfterStartup')):
   if first in values and last in values:result['comparisons'][label]=compare(values[first],values[last])
  for label,tag in(('builtImage','rr-portal-indo-shipping:pr1027-built-'),('candidateImage','rr-portal-indo-shipping:pr1027-')):
   p=command(['docker','image','inspect','--format','{{.Id}}',tag+TARGET[:12]]);value=p.stdout.decode().strip();result[label+'Present']=p.returncode==0
   if p.returncode==0:need(re.fullmatch('sha256:[a-f0-9]{64}',value)is not None,'typed-image-id-only');result[label+'ID']=value
  p=command(['docker','ps','-aq','--no-trunc','--filter','label=io.rr-portal.pr1027-clone']);ids=p.stdout.decode().split();need(p.returncode==0 and all(re.fullmatch('[a-f0-9]{64}',x)for x in ids),'typed-readonly-clone-count');result['privateCloneContainerCount']=len(ids)
  result['success']=True
 except Exception as e:result['errorType']=type(e).__name__
 result['resultSHA256']=sha(enc(result));result['sha256Wire']={k:[int(c,16)for c in(v.split(':',1)[1]if v.startswith('sha256:')else v)]for k,v in result.items()if type(v)is str and re.fullmatch('(?:sha256:)?[a-f0-9]{64}|[a-f0-9]{40}',v)}
 fd=os.open(OUT/'result.private.json',os.O_CREAT|os.O_EXCL|os.O_WRONLY|os.O_NOFOLLOW,0o600)
 with os.fdopen(fd,'wb')as stream:stream.write(enc(result));stream.flush();os.fsync(stream.fileno())
 print(json.dumps(result,sort_keys=True),flush=True);return 0 if result['success']else 1
if __name__=='__main__':sys.exit(main())
