"""INERT one-shot exact-two regular build-cache maintenance. No image deletion.
Failed allocation diagnosis remains failed. Its mount ordering was not canonical;
this new helper compares complete sorted mount records to fresh profile4 instead.
No build/tag/lifecycle/volume/host checkout/business operation or automatic retry.
"""
import hashlib,importlib.util,json,os,pathlib,re,subprocess,sys,time
ROOT=pathlib.Path('/opt/rr-portal');OUT=ROOT/'deploy/backups/pr1048-selected-cache-cleanup-1';EXECUTE=False;BRANCH='refs/heads/codex/ops-pr-1046-1049-20261031';STAGE='entry';A=None
ALLOC_HELPER='pr1048-owned-allocation-diagnose.py';ALLOC_HELPER_SHA256='23dbbb93db30922dbc7ac922293a246bcb8340574b3850c6c5b508a86d5d6658'
PROFILE=ROOT/'deploy/backups/pr1046-1049-preflight-4/result.private.json';PROFILE_SHA256='4a55587a861e5d3acbc1c4f1382ae4ad820225363ec290e1c7b9816781fa5742';PROFILE_INNER='fca612ea5320281ceb37da546ddd7b0d34fe52fa81f3b426968bc3999ee4b45d'
DIAG=ROOT/'deploy/backups/pr1048-owned-allocation-diagnose-1';DIAG_MANIFEST='56e1a8de1c44a03fb6f882616ba0b8ed76318851a46001b3abf79b7f02d2f120';DIAG_RESULT='31723f9e9cf189c8d57766e50ec8d81e48db2c73b88a8b6f22729df00db9b817'
IDS=('8qzomgd3axoasvusjy9gn2iin','s6lzlgvw18svpmfa55xnoksu1');SELECTOR='id~=^('+'|'.join(IDS)+')$';FILTERS=['--filter',SELECTOR,'--filter','type=regular','--filter','mutable=false','--filter','shared=false','--filter','inuse=false'];COMMAND=['docker','buildx','--builder','default','prune','--force',*FILTERS]
PLAN_APPROVED=True;GOAL_AVAILABLE=1342177280;ORDINARY_FLOOR=1073741824;PHYSICAL_FLOOR=8589934592;DETAILS={}
def need(v,label):
 global STAGE
 STAGE=label
 if not v:raise RuntimeError(label)
def enc(v):return json.dumps(v,sort_keys=True,separators=(',',':'),ensure_ascii=True,allow_nan=False).encode()
def sha(v):return hashlib.sha256(v).hexdigest()
def read(p,limit=8*1024**2):
 need(p.is_file()and not p.is_symlink()and p.stat().st_size<=limit,'bounded-pinned-read');return p.read_bytes()
def private(n,v):
 fd=os.open(OUT/n,os.O_CREAT|os.O_EXCL|os.O_WRONLY|os.O_NOFOLLOW,0o600)
 with os.fdopen(fd,'wb')as f:f.write(enc(v));f.flush();os.fsync(f.fileno())
def command(a,timeout=90):
 p=subprocess.run(a,cwd=ROOT,capture_output=True,timeout=timeout);need(len(p.stdout)<=16*1024**2 and len(p.stderr)<=1024**2,'bounded-read-or-exact-cache-command');return p

def runtime():
 ids=command(['docker','ps','-aq','--no-trunc']);need(ids.returncode==0,'all-container-list-success');ids=ids.stdout.decode().split();need(len(ids)==46 and len(set(ids))==46 and all(re.fullmatch('[a-f0-9]{64}',i)for i in ids),'exact46-container-set');r=command(['docker','inspect',*ids]);need(r.returncode==0,'all-container-inspect-success');rows=json.loads(r.stdout);need(len(rows)==46 and{r['Id']for r in rows}==set(ids),'complete46-inspect')
 return {r['Id']:{'image':r['Image'],'configSHA256':sha(enc(r['Config'])),'hostConfigSHA256':sha(enc(r['HostConfig'])),'envSHA256':sha(enc(sorted(r['Config'].get('Env')or[]))),'mountsSHA256':sha(enc(sorted(r['Mounts'],key=enc))),'pid':r['State']['Pid'],'started':r['State']['StartedAt'],'restarts':r['RestartCount'],'running':r['State']['Running'],'oom':r['State']['OOMKilled'],'health':r['State'].get('Health',{}).get('Status')}for r in rows}

def cache(filtered=False):
 r=command(['docker','buildx','--builder','default','du',*(FILTERS if filtered else[]),'--format=json']);need(r.returncode==0,'actual-cache-query-and-filter-semantics-supported');return A.cache_rows(r.stdout)
def cas(row):return {k:row[k]for k in('id','parents','reportedSizeDisplay','Reclaimable','Shared','Mutable','type','CreatedAt','descriptionSHA256','usageCount')}
def selected(rows,expected):
 found={r['id']:r for r in rows if r['id']in IDS};need(set(found)==set(IDS),'both-selected-cache-records-present');need(all(found[i]['currentlyPrivateImmutableReclaimableRegular']is True and cas(found[i])==cas(expected[i])for i in IDS),'both-selected-private-immutable-unused-regular-records-exact-cas');return found

def host(profile):
 r=command(['git','-C',str(ROOT),'-c','core.hooksPath=/dev/null','rev-parse','HEAD']);need(r.returncode==0 and r.stdout.decode().strip()==profile['hostGitHead'],'host-checkout-exact');shared={n:sha(read(ROOT/n,8*1024**2))for n in profile['shared']};env={str(p.relative_to(ROOT)):sha(read(p,8*1024**2))for p in ROOT.glob('.env*')if p.is_file()};need(shared=={n:r['sha256']for n,r in profile['shared'].items()}and env=={n:r['sha256']for n,r in profile['env'].items()},'shared-and-environment-files-exact');return {'shared':shared,'env':env,'head':profile['hostGitHead']}
def engine():
 r=command(['docker','info','--format','{{json .}}']);need(r.returncode==0,'current-docker-engine-info');v=json.loads(r.stdout);need(v['ID']=='bc9f32e6-298a-45f8-92c7-b755d1b61818'and v['ServerVersion']=='29.2.1'and v['Driver']=='overlayfs','same-pinned-local-engine-version-driver');r=command(['docker','buildx','inspect','default']);need(r.returncode==0,'current-default-builder');text=r.stdout.decode();names=re.findall(r'^Name:\s*(\S+)\s*$',text,re.M);drivers=re.findall(r'^Driver:\s*(\S+)\s*$',text,re.M);need(1<=len(names)<=2 and set(names)=={'default'}and drivers==['docker'],'default-docker-builder-only');root=pathlib.Path(v['DockerRootDir']);need(root.is_absolute()and not any(p.is_symlink()for p in(root,*root.parents)),'real-docker-root');return root

def snapshot(profile):
 root=engine();r=runtime();need(r==profile['allRuntime'],'all46-sorted-mount-and-complete-runtime-profile4-exact');images,_=A.images();failed=A.archive_allocation();need(failed['manifestSHA256']==A.SEAL,'original-failed-prepare-seal');vol=command(['docker','volume','ls','-q']);need(vol.returncode==0,'volume-names-readonly');names=sorted(vol.stdout.decode().split());need(len(names)<=1000 and all(re.fullmatch('[A-Za-z0-9_.-]+',n)for n in names),'typed-volume-names');volume={}
 if names:
  v=command(['docker','volume','inspect',*names]);need(v.returncode==0,'volume-metadata-readonly');volume={r['Name']:sha(enc(r))for r in json.loads(v.stdout)};need(set(volume)==set(names),'complete-volume-metadata')
 return {'runtime':r,'images':images,'failedArchive':failed,'host':host(profile),'volumes':volume},root

def space(root):
 s=os.statvfs(root);return {'available':s.f_bavail*s.f_frsize,'free':s.f_bfree*s.f_frsize}
def load_inputs():
 global A
 p=pathlib.Path(__file__).with_name(ALLOC_HELPER);need(re.fullmatch('[a-f0-9]{64}',ALLOC_HELPER_SHA256 or'')and sha(read(p))==ALLOC_HELPER_SHA256,'pinned-readonly-allocation-library');spec=importlib.util.spec_from_file_location('pinned_readonly_allocation',p);A=importlib.util.module_from_spec(spec);spec.loader.exec_module(A);need(A.EXECUTE is False,'allocation-entry-closed');raw=read(PROFILE);need(sha(raw)==PROFILE_SHA256,'exact-canonical-profile4');profile=json.loads(raw);inner=dict(profile);need(inner.pop('resultSHA256')==PROFILE_INNER==sha(enc(inner))and profile['success']is True and profile['readOnly']is True and profile['allRuntimeUnchanged']is True,'self-sealed-successful-profile4');need(sha(read(DIAG/'manifest.json'))==DIAG_MANIFEST,'original-failed-allocation-manifest-unchanged');mf=json.loads(read(DIAG/'manifest.json'));raw=read(DIAG/'result.private.json');need(sha(raw)==DIAG_RESULT==mf['result.private.json'],'original-allocation-result-sealed');diag=json.loads(raw);need(diag['success']is False and diag['stage']=='all46-runtime-and-all-images-preserved'and not diag['details']['imageDifferences'],'original-allocation-failure-kept-failed');expected={r['id']:r for r in diag['details']['cacheRecords']if r['id']in IDS};need(set(expected)==set(IDS),'root-selected-two-ids-exist-in-sealed-diagnosis');return profile,diag,expected

def maintain():
 profile,diag,expected=load_inputs();before,root=snapshot(profile);need(before['failedArchive']==diag['details']['failedArchiveAllocation']and sha(enc(before['images']))==diag['details']['allImagesSHA256'],'all-failed-evidence-and-every-image-exact-to-allocation-diagnosis');initial=space(root);need(initial['free']>=PHYSICAL_FLOOR and initial['available']>=8*1024**2,'safe-small-recovery-evidence-space');DETAILS['spaceBefore']=initial;rows=cache();selected(rows,expected);filtered=cache(True);need({r['id']for r in filtered}==set(IDS),'actual-engine-filter-query-selects-only-two-fixed-records');selected(filtered,expected);need(snapshot(profile)[0]==before,'immediate-pre-command-protected-state-cas');selected(cache(True),expected);private('intent.private.json',{'command':COMMAND,'selected':{i:cas(expected[i])for i in IDS},'beginNs':time.time_ns(),'singleAttempt':True,'automaticRetry':False});r=command(COMMAND,timeout=300);DETAILS['cleanupCommandCompleted']=True;DETAILS['cleanupCommandSucceeded']=r.returncode==0;DETAILS['commandReceipt']={'returncode':r.returncode,'stdoutSHA256':sha(r.stdout),'stderrSHA256':sha(r.stderr),'stdoutBytes':len(r.stdout),'stderrBytes':len(r.stderr)};after,_=snapshot(profile);DETAILS['protectedStatePreserved']=after==before;need(after==before,'all46-every-image-volume-host-and-failed-artifact-preserved');after_rows=cache();old_ids={r['id']for r in rows};new_ids={r['id']for r in after_rows};DETAILS['removedCacheIDs']=sorted(old_ids-new_ids);DETAILS['addedCacheIDs']=sorted(new_ids-old_ids);need(new_ids-set(IDS)==old_ids-set(IDS),'every-unselected-cache-id-preserved');last=space(root);DETAILS.update(spaceAfter=last,actualOrdinaryAvailableGain=last['available']-initial['available'],actualPhysicalFreeGain=last['free']-initial['free'],adoptionBeforeMinimumAvailable=GOAL_AVAILABLE,adoptionCapacityGoalMet=last['available']>=GOAL_AVAILABLE and last['free']>=PHYSICAL_FLOOR+256*1024**2,reserveFloorMet=last['available']>=ORDINARY_FLOOR and last['free']>=PHYSICAL_FLOOR,reportedCacheSizeNotClaimedPhysicalGain=True);need(r.returncode==0,'single-selected-prune-command-success-no-retry');need(DETAILS['reserveFloorMet'],'one-gib-ordinary-eight-gib-physical-restored');DETAILS['allUnselectedCachesImagesAndFailedArchivesPreserved']=True

def wire(v):
 raw=enc(v);need(len(raw)<=4*1024**2,'bounded-hash-and-typed-cleanup-receipt');nib=lambda x:[int(c,16)for c in(format(x,'x')if type(x)is int else x)];parts=[raw[i:i+1024]for i in range(0,len(raw),1024)];digest=nib(sha(raw))
 for i,b in enumerate(parts):print(enc([0,nib(i+1),nib(len(parts)),nib(len(raw)),digest,nib(b.hex())]).decode(),flush=True)
 print(enc([1,nib(len(parts)),nib(len(raw)),digest]).decode(),flush=True)
def main():
 need(EXECUTE is True and PLAN_APPROVED is True and BRANCH and sys.argv[1:]==['maintain']and os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_MODE')=='maintain'and os.environ.get('RELEASE_ATTEMPT')=='1','explicit-one-shot-reviewed-two-cache-only');os.umask(0o077);need(OUT.parent.is_dir()and not any(p.is_symlink()for p in(OUT.parent,*OUT.parent.parents))and not OUT.exists(),'fresh-private-cache-cleanup-archive');OUT.mkdir(mode=0o700);v={'success':False,'phase':'maintain','mode':'maintain','exactTwoCacheIDs':IDS,'imageOrContainerOrVolumeRemoval':False,'buildOrTagOrLifecycle':False,'businessOperations':False,'automaticRetry':False,'originalFailuresReclassified':False,'details':DETAILS}
 try:maintain();v['success']=True
 except Exception as e:v.update(errorType=type(e).__name__,stage=STAGE,dependencyStage=None if A is None else A.STAGE)
 v['resultSHA256']=sha(enc(v));private('result.private.json',v);private('manifest.json',{'result.private.json':sha(read(OUT/'result.private.json')),**({'intent.private.json':sha(read(OUT/'intent.private.json'))}if(OUT/'intent.private.json').exists()else{})});wire({'result':v,'manifestSHA256':sha(read(OUT/'manifest.json'))});return 0 if v['success']else 1
if __name__=='__main__':sys.exit(main())
