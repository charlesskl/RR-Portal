"""INERT, at most eight metadata reads of the five changed image responses.
Raw image Config/Env stays in memory. No prune, build, lifecycle or data operation.
"""
import hashlib,importlib.util,json,os,pathlib,re,subprocess,sys
ROOT=pathlib.Path('/opt/rr-portal');OUT=ROOT/'deploy/backups/pr1045-image-response-inspect-1'
EXECUTE=False;BRANCH='refs/heads/codex/ops-pr-1045-20261031-quote';MAX_READS=8
HELPER='pr1045-cache-help-preflight.py';HELPER_SHA256='6a1916349121ca78f3600ecd0a56b951b4a7f043c2f8dc5bfca4a4a3ae200be6'
PROFILE5=ROOT/'deploy/backups/pr1045-quote-preflight-5/result.private.json';PROFILE5_SHA256='a23b017f933a3568ed26ca63556de642cecdbbb1379718dd370fa7dbe7729665'
R3_MANIFEST_SHA256='64f37c12a42116e129cbf9e5a9866ab421bab8a3fefc7a0ed883ea339c76eb86'
H=None;C=None;STAGE='entry'
def need(value,label):
 global STAGE
 STAGE=label
 if not value:raise RuntimeError(label)
def enc(value):return json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=True,allow_nan=False).encode()
def sha(body):return hashlib.sha256(body).hexdigest()
def digest(value):return sha(enc(value))
def command(args,limit=16*1024**2,data=None,timeout=90):
 r=subprocess.run(args,input=data,cwd=ROOT,capture_output=True,timeout=timeout,env=dict(os.environ,GIT_OPTIONAL_LOCKS='0',GIT_TERMINAL_PROMPT='0'));need(r.returncode==0 and len(r.stdout)<=limit,'bounded-fixed-readonly-command-in-memory');return r.stdout

def load():
 global H,C
 p=pathlib.Path(__file__).with_name(HELPER);need(p.is_file()and not p.is_symlink()and sha(p.read_bytes())==HELPER_SHA256,'pinned-reviewed-readonly-helper');s=importlib.util.spec_from_file_location('image1045_readonly',p);H=importlib.util.module_from_spec(s);s.loader.exec_module(H);H.OUT=OUT;C=H.common();C.OUT=OUT;C.command=command

def profile():
 need(PROFILE5.is_file()and not any(p.is_symlink()for p in(PROFILE5,*PROFILE5.parents))and sha(PROFILE5.read_bytes())==PROFILE5_SHA256,'sealed-successful-profile5-file');v=json.loads(PROFILE5.read_bytes());r=v['capacityMetadata']['r3SealedMaintenanceEvidence'];need(v['success']is True and v['readOnly']is True and r['manifestSHA256']==R3_MANIFEST_SHA256 and r['allManifestEntriesVerified']is True and r['runtime']['exactEqual']is True and all(r['afterMatchesOriginalProfile2'].values())and r['images']['sameKeySet']is True and r['images']['changedCount']==5 and r['singleCommand']['knownExactSummary']['sealedStdoutHashMatchesKnownTotalZeroLiteral']is True,'profile5-preserved-runtime-source-env-and-zero-summary-proof');return v

def state(v):
 runtime,_=H.runtime();need(runtime==v['allRuntime']and len(runtime)==46,'all46-runtime-profile5-exact');head=H.git('rev-parse','HEAD').decode().strip();dirty=C.dirty_summary(H.git('diff','--name-only','-z'));staged=C.dirty_summary(H.git('diff','--cached','--name-only','-z'));shared={n:C.shared_file(n)for n in C.SHARED};env={str(p.relative_to(ROOT)):C.shared_file(str(p))for p in ROOT.glob('.env*')if p.is_file()};auth=C.gateway_auth();code=json.loads(command(['docker','exec','--user','0',v['containerId'],'node','-e',H.CODE_PROBE],timeout=240));need(head==v['hostGitHead']and dirty==v['unstaged']and staged==v['staged']and shared==v['shared']and env==v['environmentFiles']and auth==v['gatewayAuth']and code==v['sourceAndDependencySignature'],'host-dirty-shared-env-auth-code-and-dependencies-profile5-exact');return {'runtimeSHA256':digest(runtime),'head':head,'dirtySHA256':digest(dirty),'stagedSHA256':digest(staged),'sharedSHA256':digest(shared),'environmentFilesSHA256':digest(env),'gatewayAuthSHA256':digest(auth),'quoteSourceAndDependenciesSHA256':digest(code)}

def deep_diff(a,b,limit=2000):
 out=[];truncated=False
 def add(path,x,y,present_a=True,present_b=True):
  nonlocal truncated
  if len(out)>=limit:truncated=True;return
  out.append({'path':path or'/','beforePresent':present_a,'afterPresent':present_b,'beforeSHA256':digest(x)if present_a else None,'afterSHA256':digest(y)if present_b else None,'beforeType':type(x).__name__ if present_a else None,'afterType':type(y).__name__ if present_b else None})
 def walk(x,y,path):
  if type(x)is not type(y):add(path,x,y);return
  if type(x)is dict:
   for key in sorted(set(x)|set(y)):
    p=path+'/'+str(key).replace('~','~0').replace('/','~1')
    if key not in x or key not in y:add(p,x.get(key),y.get(key),key in x,key in y)
    else:walk(x[key],y[key],p)
  elif type(x)is list:
   if len(x)!=len(y):add(path+'/#length',len(x),len(y))
   for i in range(min(len(x),len(y))):walk(x[i],y[i],path+'/'+str(i))
  elif x!=y:add(path,x,y)
 walk(a,b,'');return {'differences':out,'truncated':truncated,'complete':not truncated}

def version_contract(row):
 fields=('Id','Architecture','Author','Comment','Config','Created','DockerVersion','Os','OsVersion','Parent','RootFS','Variant','Size','VirtualSize')
 v={key:{'present':key in row,'value':row.get(key)}for key in fields}
 for key in('RepoTags','RepoDigests'):
  values=row.get(key);values=[]if values is None else values;need(type(values)is list and all(type(x)is str for x in values),'typed-repository-tag-digest-sets');v[key]=sorted(set(values))
 return v

def inspect_samples(changed):
 need(type(changed)is list and len(changed)==5 and len({r['id']for r in changed})==5,'exact-five-sealed-changed-images');targets={r['id']:(r['beforeSHA256'],r['afterSHA256'])for r in changed};need(all(re.fullmatch('sha256:[a-f0-9]{64}',i)for i in targets),'typed-fixed-changed-image-ids');variants={i:{}for i in targets};observations=[]
 for index in range(MAX_READS):
  rows=json.loads(command(['docker','image','inspect',*sorted(targets)]));need(type(rows)is list and len(rows)==5 and {r.get('Id')for r in rows}==set(targets),'complete-five-image-in-memory-response');sample={}
  for row in rows:
   identifier=row['Id'];raw_sha=digest(row);variants[identifier].setdefault(raw_sha,row);sample[identifier]={'rawResponseSHA256':raw_sha,'versionContractSHA256':digest(version_contract(row))}
  observations.append(sample)
  if all(all(h in variants[i]for h in target)for i,target in targets.items()):break
 result=[]
 for identifier,target in sorted(targets.items()):
  values=variants[identifier];hashes=list(values);comparisons=[{'beforeRawSHA256':hashes[0],'afterRawSHA256':h,'keyDiff':deep_diff(values[hashes[0]],values[h])}for h in hashes[1:]];both=all(h in values for h in target)
  result.append({'id':identifier,'distinctRawResponseHashes':hashes,'sealedBeforeHashObserved':target[0]in values,'sealedAfterHashObserved':target[1]in values,'sealedBeforeAfterDiff':deep_diff(values[target[0]],values[target[1]])if both else None,'sampledVariantDiffs':comparisons,'versionContractHashes':sorted({digest(version_contract(row))for row in values.values()}),'allObservedVersionContractsExact':len({digest(version_contract(row))for row in values.values()})==1})
 return {'reads':len(observations),'maximumReads':MAX_READS,'observations':observations,'images':result,'rawConfigEnvOrInspectBodiesPersisted':False,'opaqueMetadataEqualityNotClaimed':True}

def private(name,value):
 fd=os.open(OUT/name,os.O_CREAT|os.O_EXCL|os.O_WRONLY|os.O_NOFOLLOW,0o600)
 with os.fdopen(fd,'wb')as f:f.write(enc(value));f.flush();os.fsync(f.fileno())
def main():
 need(EXECUTE is True and sys.argv[1:]==['inspect']and os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_MODE')=='inspect'and os.environ.get('RELEASE_ATTEMPT')=='1','explicit-first-readonly-image-response-inspection');v=profile();os.umask(0o077);need(OUT.parent.is_dir()and not any(p.is_symlink()for p in(OUT.parent,*OUT.parent.parents))and not OUT.exists()and not OUT.is_symlink(),'fresh-own-private-inspection-evidence');OUT.mkdir(mode=0o700);result={'phase':'inspect','success':False,'readOnly':True,'pruneOrLifecyclePerformed':False,'businessRowsOrUploadsRead':False,'profile5SHA256':PROFILE5_SHA256}
 try:
  load();before=state(v);result['details']=inspect_samples(v['capacityMetadata']['r3SealedMaintenanceEvidence']['images']['changed']);after=state(v);need(before==after,'all-runtime-source-config-env-host-dirty-unchanged');result.update(success=True,beforeStateSHA256=digest(before),afterStateSHA256=digest(after),all46RuntimeSourceConfigEnvHostDirtyExact=True)
 except Exception as error:result.update(errorType=type(error).__name__,stage=STAGE)
 result['resultSHA256']=digest(result);private('result.private.json',result);manifest={'result.private.json':sha((OUT/'result.private.json').read_bytes())};private('manifest.json',manifest);H.wire({'result':result,'manifestSHA256':digest(manifest)})if H is not None else None;return 0 if result['success']else 1
if __name__=='__main__':sys.exit(main())
