"""INERT one-shot, ID-constrained old build-cache maintenance candidate.
No image/volume/container/system prune, service lifecycle, checkout or DB command.
Requires actual CLI/version/help evidence and separately reviewed ID-filter semantics.
"""
import calendar,datetime,hashlib,importlib.util,json,os,pathlib,re,stat,subprocess,sys,time
ROOT=pathlib.Path('/opt/rr-portal');OUT=ROOT/'deploy/backups/pr1045-cache-maintenance-3'
BRANCH='refs/heads/codex/ops-pr-1045-20261031-quote';EXECUTE=True
HELPER='pr1045-cache-help-preflight.py';HELPER_SHA256='6a1916349121ca78f3600ecd0a56b951b4a7f043c2f8dc5bfca4a4a3ae200be6'
PROFILE_PATH='/opt/rr-portal/deploy/backups/pr1045-quote-preflight-2/result.private.json';PROFILE_FILE_SHA256='e68d2c58444ce06978385719bf3e4abea82930ba3ce4bbcaf51d8e13910b2249';PLAN={'approved': True, 'profileFileSHA256': 'e68d2c58444ce06978385719bf3e4abea82930ba3ce4bbcaf51d8e13910b2249', 'engineID': 'bc9f32e6-298a-45f8-92c7-b755d1b61818', 'clientVersion': '29.2.1', 'serverVersion': '29.2.1', 'builderName': 'default', 'pruneHelpSHA256': '98e664404f2a4be365a5f1c6615b2bbf62d9ede0235784f17d9bfac142cd7db1', 'reviewedRecordIDs': ['dffp2znok9t2q0bzpfrytguxk', 'nhge2ev4tp7n11trp6cxgt93d', 'pmxbytwvlxa8nzhvp9h8q17mu', 'pnz75pe7lyx9k77mis6q147s3', 'qjiyizc7qoyp3q33ymejou7en', 'qsllsiwz72jrsw12pkomte3m8'], 'idFilterSemanticsReviewed': True, 'idFilterPrimarySource': 'https://docs.docker.com/reference/cli/docker/buildx/prune/', 'reservedSpaceBytes': 12884901888, 'cacheScope': 'exact-six-cache-ids-immutable-private-unused-at-least-168h', 'automaticRetry': False, 'noExactDeletionDryRun': True};PLAN_SHA256='375c0d881c619431add9d8fe8576ab6446f18c05737a40566047d81f4e6af8e5'
MIN_ORDINARY=172023808;MIN_PHYSICAL=8627740672
ALLOWED_IDS=tuple(sorted(('nhge2ev4tp7n11trp6cxgt93d','pnz75pe7lyx9k77mis6q147s3','qsllsiwz72jrsw12pkomte3m8','dffp2znok9t2q0bzpfrytguxk','pmxbytwvlxa8nzhvp9h8q17mu','qjiyizc7qoyp3q33ymejou7en')))
ID_SELECTOR='id~=^('+'|'.join(ALLOWED_IDS)+')$'
STAGE='entry';H=None;C=None
FAILED_ARCHIVE=ROOT/'deploy/backups/pr1045-cache-maintenance-1'
FAILED_MANIFEST_SHA256='35753c35257825550ab13043443a2044732c871f33d6e245ad4aa3d433df804e'

def need(v,label):
 global STAGE
 STAGE=label
 if not v:raise RuntimeError(label)
def enc(v):return json.dumps(v,sort_keys=True,separators=(',',':'),ensure_ascii=True,allow_nan=False).encode()
def sha(b):return hashlib.sha256(b).hexdigest()
def pin(s):return type(s)is str and re.fullmatch('[a-f0-9]{64}',s)is not None

def private(name,value):
 raw=enc(value);need(len(raw)<=4*1024**2,'bounded-own-private-maintenance-evidence');fd=os.open(OUT/name,os.O_CREAT|os.O_EXCL|os.O_WRONLY|os.O_NOFOLLOW,0o600)
 with os.fdopen(fd,'wb')as f:f.write(raw);f.flush();os.fsync(f.fileno())

def common_memory_command(args,limit=8*1024**2,data=None,timeout=90):
 # Common helpers expect their original argument order; never persist raw inspect.
 r=subprocess.run(args,input=data,cwd=ROOT,capture_output=True,timeout=timeout,env=dict(os.environ,GIT_OPTIONAL_LOCKS='0',GIT_TERMINAL_PROMPT='0'));need(r.returncode==0 and len(r.stdout)<=limit,'bounded-common-command-in-memory');return r.stdout

def load():
 global H,C
 p=pathlib.Path(__file__).with_name(HELPER);need(p.is_file()and not p.is_symlink()and sha(p.read_bytes())==HELPER_SHA256,'pinned-inert-readonly-helper');s=importlib.util.spec_from_file_location('cache1045_readonly',p);H=importlib.util.module_from_spec(s);s.loader.exec_module(H);H.OUT=OUT;C=H.common();C.OUT=OUT;C.command=common_memory_command

def plan_check(profile):
 keys={'approved','profileFileSHA256','engineID','clientVersion','serverVersion','builderName','pruneHelpSHA256','reviewedRecordIDs','idFilterSemanticsReviewed','idFilterPrimarySource','reservedSpaceBytes','cacheScope','automaticRetry','noExactDeletionDryRun'}
 need(type(PLAN)is dict and set(PLAN)==keys and pin(PLAN_SHA256)and sha(enc(PLAN))==PLAN_SHA256 and PLAN['approved']is True and PLAN['profileFileSHA256']==PROFILE_FILE_SHA256,'explicit-separately-reviewed-maintenance-plan')
 info=profile['capacityMetadata']['cacheHelpAndEngineLinkage'];help=info['builderPruneHelp'];need(profile['success']is True and profile['readOnly']is True and info['duAndEngineDefaultBuilderLinkageObserved']is True and help['returncode']==0 and all(help['flags'][n]is True for n in('filter','force','all'))and help['flags']['keep-storage']is False and '--reserved-space' in help['text'] and 'docker buildx prune' in help['text'],'actual-help-and-default-docker-engine-evidence')
 need(PLAN['engineID']==info['engine']['ID']and PLAN['builderName']==info['selectedBuilder']['Name']and PLAN['clientVersion']==info['versions']['Client']['Version']and PLAN['serverVersion']==info['versions']['Server']['Version']and PLAN['pruneHelpSHA256']==help['stdoutSHA256'],'plan-binds-actual-engine-builder-cli-server-and-help')
 need(PLAN['idFilterSemanticsReviewed']is True and type(PLAN['idFilterPrimarySource'])is str and PLAN['idFilterPrimarySource']=='https://docs.docker.com/reference/cli/docker/buildx/prune/','id-regex-and-all-and-selectors-reviewed-in-official-buildx-primary-docs')
 need(PLAN['reservedSpaceBytes']==12884901888 and PLAN['cacheScope']=='exact-six-cache-ids-immutable-private-unused-at-least-168h'and PLAN['automaticRetry']is False and PLAN['noExactDeletionDryRun']is True,'fixed-conservative-scope-and-no-replay')
 ids=PLAN['reviewedRecordIDs'];need(type(ids)is list and 1<=len(ids)<=2000 and ids==list(ALLOWED_IDS)and all(type(i)is str and re.fullmatch('[a-z0-9]{12,128}',i)for i in ids),'explicit-unique-safe-cache-id-allowlist')
 observed={r['ID']:r for r in profile['capacityMetadata']['builderCacheMetadata']['records']if'ID'in r}
 old=re.compile(r'(?:[2-9]|[1-9][0-9]+) weeks? ago|[1-9][0-9]* months? ago|[1-9][0-9]* years? ago')
 need(set(ids)<=set(observed)and all(observed[i].get('Reclaimable')=='true'and observed[i].get('Mutable')=='false'and observed[i].get('Shared')=='false'and old.fullmatch(observed[i].get('Last used',''))for i in ids),'only-observed-old-immutable-private-reclaimable-records')
 need(PLAN['engineID']=='bc9f32e6-298a-45f8-92c7-b755d1b61818' and PLAN['builderName']=='default' and PLAN['clientVersion']==PLAN['serverVersion']=='29.2.1','exact-observed-29-2-1-default-engine');return ['docker','buildx','--builder','default','prune','--force','--filter',ID_SELECTOR,'--filter','until=168h','--filter','private=""','--filter','immutable=""','--filter','type=regular','--reserved-space=12884901888']

def failed_stage_guard():
 # Verify the failed archive only; never add/overwrite files or replay its mode.
 need(FAILED_ARCHIVE==ROOT/'deploy/backups/pr1045-cache-maintenance-1'and pin(FAILED_MANIFEST_SHA256),'fixed-failed-maintenance-archive-pin')
 need(FAILED_ARCHIVE.is_dir()and not any(p.is_symlink()for p in(FAILED_ARCHIVE,*FAILED_ARCHIVE.parents)),'old-failed-maintenance-real-private-directory')
 manifest=FAILED_ARCHIVE/'manifest.json';need(manifest.is_file()and not manifest.is_symlink(),'old-failed-maintenance-regular-manifest');raw=manifest.read_bytes();need(sha(raw)==FAILED_MANIFEST_SHA256,'old-failed-maintenance-sealed-manifest-exact');value=json.loads(raw);need(type(value)is dict and {'before.private.json','result.private.json'}<=set(value),'old-failed-maintenance-required-evidence')
 for name in('intent.private.json','single-command.private.json'):
  p=FAILED_ARCHIVE/name;need(name not in value and not p.exists()and not p.is_symlink(),'old-failed-maintenance-no-intent-or-command-receipt')
 entries=list(FAILED_ARCHIVE.iterdir());need(all(p.is_file()and not p.is_symlink()for p in entries)and {p.name for p in entries}==set(value)|{'manifest.json'},'old-failed-maintenance-complete-file-set')
 for name,digest in value.items():
  need(type(name)is str and re.fullmatch(r'[A-Za-z0-9_.-]+',name)is not None and pin(digest),'old-failed-maintenance-safe-sealed-entry');p=FAILED_ARCHIVE/name;need(sha(p.read_bytes())==digest,'old-failed-maintenance-evidence-byte-seal')
 result=json.loads((FAILED_ARCHIVE/'result.private.json').read_bytes());need(result.get('success')is False and result.get('errorType')=='ValueError'and result.get('stage')=='actual-cache-last-used-time'and result.get('automaticRetry')is False,'old-failed-maintenance-time-parse-failure-only')
 prior=ROOT/'deploy/backups/pr1045-cache-maintenance-2';manifest2=prior/'manifest.json'
 need(prior.is_dir()and not any(p.is_symlink()for p in(prior,*prior.parents))and manifest2.is_file()and not manifest2.is_symlink(),'second-failed-maintenance-real-directory-and-manifest')
 raw2=manifest2.read_bytes();need(sha(raw2)=='0856435b50b1f0ba0c390c2ad7b02ead8af549657be3e1387e023357e4601bf0','second-failed-maintenance-fixed-seal');second=json.loads(raw2)
 need(set(second)=={'before.private.json','result.private.json'}and {p.name for p in prior.iterdir()}==set(second)|{'manifest.json'},'second-failed-maintenance-no-intent-or-command-and-exact-files')
 for name,digest in second.items():
  p=prior/name;need(p.is_file()and not p.is_symlink()and pin(digest)and sha(p.read_bytes())==digest,'second-failed-maintenance-evidence-exact')
 result2=json.loads((prior/'result.private.json').read_bytes());need(result2.get('success')is False and result2.get('errorType')=='RuntimeError'and result2.get('stage')=='all-six-records-have-current-engine-eligibility-metadata','second-failed-maintenance-readonly-filter-rejection')
 return {'archive':str(FAILED_ARCHIVE),'manifestSHA256':FAILED_MANIFEST_SHA256,'secondArchive':str(prior),'secondManifestSHA256':sha(raw2),'intentAbsentInBoth':True,'singleCommandReceiptAbsentInBoth':True,'oldFailedStagesNotReplayed':True,'allOldEvidenceSealsExact':True}

def cache_records():
 # This buildx renders JSON times/sizes for people. DU verifies identities and
 # unused/private/type metadata. BuildKit boolean selectors compare empty values
 # with field presence, so private="" and immutable="" match only those states.
 # The mutating prune command enforces until=168h inside the engine itself.
 args=['docker','buildx','--builder','default','du','--format=json','--filter',ID_SELECTOR,'--filter','until=168h','--filter','private=""','--filter','immutable=""','--filter','type=regular']
 raw=H.command(args,90,4*1024**2);rows=[]
 for line in raw.splitlines():
  if not line.strip():continue
  value=json.loads(line);need(type(value)is dict and value.get('ID')in ALLOWED_IDS,'only-six-engine-qualified-cache-records')
  row={k:value.get(k)for k in('ID','CreatedAt','LastUsedAt','Reclaimable','Shared','Mutable','Size','UsageCount','Type')}
  need(row['Reclaimable']is True and row['Shared']is False and row['Mutable']is False and row['Type']=='regular','engine-qualified-unused-private-immutable-regular-cache')
  need(all(type(row[k])is str and 0<len(row[k])<=256 for k in('CreatedAt','LastUsedAt')),'bounded-cache-display-time-evidence')
  need((type(row['Size'])is str and len(row['Size'])<=64 and re.fullmatch(r'[0-9]+(?:[.][0-9]+)?(?:[kMGTPE]?B)?',row['Size'],re.I)is not None)or(type(row['Size'])is int and row['Size']>=0),'bounded-cache-display-size-evidence')
  rows.append(row)
 need(len(rows)==6 and {r['ID']for r in rows}==set(ALLOWED_IDS),'all-six-records-have-current-engine-eligibility-metadata')
 return sorted(rows,key=lambda r:r['ID'])

def metadata_tree(root):
 # Preserve original failed/full evidence without opening or rehashing bodies.
 need(root.is_dir()and not any(p.is_symlink()for p in(root,*root.parents)),'backup-root-real-directory');entries=[]
 def walk(p,relative):
  if p==OUT:return
  s=p.lstat();need(stat.S_ISREG(s.st_mode)or stat.S_ISDIR(s.st_mode)or stat.S_ISLNK(s.st_mode),'backup-entry-metadata-types');v={'pathSHA256':sha(os.fsencode(relative)),'mode':s.st_mode,'uid':s.st_uid,'gid':s.st_gid,'size':s.st_size,'blocks':s.st_blocks,'inode':s.st_ino,'mtimeNs':s.st_mtime_ns,'ctimeNs':s.st_ctime_ns};entries.append(v);need(len(entries)<=1000000,'bounded-backup-metadata-only')
  if stat.S_ISDIR(s.st_mode):
   for child in sorted(p.iterdir(),key=lambda q:os.fsencode(q.name)):walk(child,relative+'/'+child.name)
 walk(root,'');return {'entries':len(entries),'metadataSHA256':sha(enc(entries)),'fileBodiesReadOrRehashed':False,'linksFollowed':False}

def linkage_fingerprint(value):
 return {'engine':value['engine'],'versions':value['versions'],'contextName':value['contextName'],'contextEndpoint':{k:value['contextEndpointQuery'].get(k)for k in('endpointSHA256','localSocket')},'selectedBuilder':value['selectedBuilder'],'overrides':value['dockerOverrideEnvironmentHashes'],'linked':value['duAndEngineDefaultBuilderLinkageObserved'],'pruneHelp':{k:value['builderPruneHelp'].get(k)for k in('returncode','stdoutSHA256','flags','dryRunAdvertised')}}

def snapshot(profile):
 runtime,row=H.runtime();need(runtime==profile['allRuntime']and len(runtime)==46,'all-46-runtime-contracts-still-profile-exact')
 head=H.git('rev-parse','HEAD').decode().strip();need(head==profile['hostGitHead']=='f22fbffa1789234fe1c78bf776f4dcb3fe867d0c','host-head-no-checkout');dirty=C.dirty_summary(H.git('diff','--name-only','-z'));staged=C.dirty_summary(H.git('diff','--cached','--name-only','-z'));need(dirty==profile['unstaged']and staged==profile['staged']and dirty['trackedPathCount']==5,'unknown-dirty-path-inventory-only-exact')
 shared={n:C.shared_file(n)for n in C.SHARED};env={str(p.relative_to(ROOT)):C.shared_file(str(p))for p in ROOT.glob('.env*')if p.is_file()};auth=C.gateway_auth();need(shared==profile['shared']and env==profile['environmentFiles']and auth==profile['gatewayAuth'],'all-host-config-env-and-auth-hashes-exact')
 code=json.loads(H.command(['docker','exec','--user','0',row['Id'],'node','-e',H.CODE_PROBE],240,8*1024**2));need(code==profile['sourceAndDependencySignature'],'whole-quote-backend-frontend-dependencies-generated-lock-exact')
 ids=sorted(set(H.command(['docker','image','ls','-aq','--no-trunc']).decode().split()));need(1<=len(ids)<=5000 and all(re.fullmatch('sha256:[a-f0-9]{64}',i)for i in ids),'typed-all-image-ids');images=json.loads(H.command(['docker','image','inspect',*ids],90,64*1024**2));need({i['Id']for i in images}==set(ids),'all-old-rollback-and-canonical-images-observed');image_hash={i['Id']:sha(enc(i))for i in images}
 names=sorted(set(H.command(['docker','volume','ls','-q']).decode().split()));need(len(names)<=1000 and all(re.fullmatch('[A-Za-z0-9_.-]+',n)for n in names),'typed-all-volume-names');volumes=json.loads(H.command(['docker','volume','inspect',*names]))if names else[];need({v['Name']for v in volumes}==set(names),'all-volumes-observed');volume_hash={v['Name']:sha(enc(v))for v in volumes}
 linkage=H.cache_help_linkage();baseline=profile['capacityMetadata']['cacheHelpAndEngineLinkage'];need(linkage_fingerprint(linkage)==linkage_fingerprint(baseline),'actual-cli-help-engine-context-and-builder-still-exact')
 root=pathlib.Path(linkage['engine']['DockerRootDir']);fs=os.statvfs(root);need(fs.f_bavail*fs.f_frsize>=MIN_ORDINARY and fs.f_bfree*fs.f_frsize>=MIN_PHYSICAL,'existing-ordinary-physical-minimums-preserved')
 return {'runtime':runtime,'host':head,'dirty':dirty,'staged':staged,'shared':shared,'env':env,'gatewayAuth':auth,'quoteCodeAndDependencies':code,'allImages':image_hash,'allVolumes':volume_hash,'backupMetadata':metadata_tree(ROOT/'deploy/backups'),'engineAndBuilder':linkage_fingerprint(linkage)}

def space(profile):
 root=profile['capacityMetadata']['cacheHelpAndEngineLinkage']['engine']['DockerRootDir'];s=os.statvfs(root);return {'available':s.f_bavail*s.f_frsize,'free':s.f_bfree*s.f_frsize}

def wire(value):
 raw=enc(value);need(len(raw)<=4*1024**2,'bounded-hash-only-maintenance-receipt');nib=lambda v:[int(x,16)for x in(format(v,'x')if type(v)is int else v)];parts=[raw[i:i+1024]for i in range(0,len(raw),1024)];digest=nib(sha(raw))
 for i,b in enumerate(parts):print(enc([0,nib(i+1),nib(len(parts)),nib(len(raw)),digest,nib(b.hex())]).decode(),flush=True)
 print(enc([1,nib(len(parts)),nib(len(raw)),digest]).decode(),flush=True)

def main():
 need(EXECUTE is True and sys.argv[1:]==['maintain']and os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_MODE')=='maintain'and os.environ.get('RELEASE_ATTEMPT')=='1','explicit-first-maintenance-only')
 need(PROFILE_PATH=='/opt/rr-portal/deploy/backups/pr1045-quote-preflight-2/result.private.json'and pin(PROFILE_FILE_SHA256),'fresh-second-profile-binding-required');p=pathlib.Path(PROFILE_PATH);need(p.is_file()and not p.is_symlink()and sha(p.read_bytes())==PROFILE_FILE_SHA256,'actual-successful-help-profile-file-sealed');profile=json.loads(p.read_bytes());command=plan_check(profile);failed_guard=failed_stage_guard()
 os.umask(0o077);need(OUT.parent.is_dir()and not any(p.is_symlink()for p in(OUT.parent,*OUT.parent.parents))and not OUT.exists()and not OUT.is_symlink(),'fresh-own-private-maintenance-evidence');OUT.mkdir(mode=0o700);result={'phase':'maintain','success':False,'automaticRetry':False,'imageVolumeContainerOrSystemPrunePerformed':False,'lifecycleOrBusinessDbOperationPerformed':False,'unknownDirtyBodiesRead':False,'sourceCheckoutPerformed':False,'previousFailedStage':failed_guard}
 try:
  load();before=snapshot(profile);private('before.private.json',before);cache=cache_records();private('selected-cache-before.private.json',cache);initial=space(profile);need(cache_records()==cache,'cache-eligibility-still-exact-immediately-before-single-prune');private('intent.private.json',{'command':command,'planSHA256':PLAN_SHA256,'singleAttempt':True,'noAutomaticRetry':True,'beginNs':time.time_ns()});r=subprocess.run(command,cwd=ROOT,capture_output=True,timeout=300);need(len(r.stdout)<=2*1024**2 and len(r.stderr)<=1024**2,'bounded-single-prune-output');receipt={'returncode':r.returncode,'stdoutSHA256':sha(r.stdout),'stderrSHA256':sha(r.stderr),'stdoutBytes':len(r.stdout),'stderrBytes':len(r.stderr)};private('single-command.private.json',receipt);after=snapshot(profile);private('after.private.json',after);need(before==after,'all-runtime-images-volumes-config-env-source-dirty-and-backup-metadata-exact');need(r.returncode==0,'single-cache-maintenance-command-success-no-retry');result.update(success=True,command=command,planSHA256=PLAN_SHA256,profileFileSHA256=PROFILE_FILE_SHA256,spaceBefore=initial,spaceAfter=space(profile),all46RuntimeAndEveryImageVolumeConfigEnvSourceBackupPreserved=True,beforeSnapshotSHA256=sha(enc(before)),afterSnapshotSHA256=sha(enc(after)),selectedCacheMetadataSHA256=sha(enc(cache)),singleCommandReceiptSHA256=sha(enc(receipt)),businessDataRowsCompared=False,reclaimedBytesNotAssumed=True)
 except Exception as error:result.update(errorType=type(error).__name__,stage=STAGE)
 result['resultSHA256']=sha(enc(result));private('result.private.json',result);files=list(OUT.iterdir());need(all(p.is_file()and not p.is_symlink()for p in files),'all-own-maintenance-evidence-regular');manifest={p.name:sha(p.read_bytes())for p in files};private('manifest.json',manifest);wire({'result':result,'manifestSHA256':sha(enc(manifest))});return 0 if result['success']else 1
if __name__=='__main__':sys.exit(main())
