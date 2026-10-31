"""INERT, separately reviewed phase4 default-builder GC candidate. No --all.
Raw response hashes are evidence only; full metadata guards normalize only proven order.
Full Config, RootFS order and all other opaque metadata remain exact.
No image/system/volume/container prune, service lifecycle, checkout or DB operation.
"""
import copy,hashlib,importlib.util,json,os,pathlib,re,subprocess,sys,time
ROOT=pathlib.Path('/opt/rr-portal');OUT=ROOT/'deploy/backups/pr1045-cache-maintenance-4'
BRANCH='refs/heads/codex/ops-pr-1045-20261031-quote';EXECUTE=True
INSPECT_HELPER='pr1045-image-response-inspect.py';INSPECT_HELPER_SHA256='782bb86556c4e9c7a63458ef69d31b570cd0c64e5b1e9494cb8727551db24646'
METADATA_HELPER='pr1045-cache-maintenance-r3.py';METADATA_HELPER_SHA256='74b4d1081bcbe519baa438e502a6baf7ddebb165e6cb6c45d93ac5764d19edd2'
PLAN={'approved': True, 'profile5SHA256': 'a23b017f933a3568ed26ca63556de642cecdbbb1379718dd370fa7dbe7729665', 'r3ManifestSHA256': '64f37c12a42116e129cbf9e5a9866ab421bab8a3fefc7a0ed883ea339c76eb86', 'command': ['docker', 'buildx', '--builder', 'default', 'prune', '--force', '--filter', 'until=24h', '--reserved-space=17179869184'], 'engineID': 'bc9f32e6-298a-45f8-92c7-b755d1b61818', 'builder': 'default', 'clientVersion': '29.2.1', 'serverVersion': '29.2.1', 'reservedSpaceBytes': 17179869184, 'unusedForHours': 24, 'singleAttempt': True, 'automaticRetry': False, 'rawOpaqueMetadataEqualityNotClaimed': True, 'contractHelperSHA256': '782bb86556c4e9c7a63458ef69d31b570cd0c64e5b1e9494cb8727551db24646', 'readOnlyInspectManifestSHA256': 'f32012e87fbb7967708c08790dff82e9a3b500e514903479b05df932d4fd5148'};PLAN_SHA256='0da7f56b0c03751c4530596e61d2ee3e58eb754467e301d859bf8eea619e07da';MIN_ORDINARY=172023808;MIN_PHYSICAL=8627740672
FIXED_COMMAND=('docker','buildx','--builder','default','prune','--force','--filter','until=24h','--reserved-space=17179869184')
I=None;M=None;STAGE='entry'
def need(value,label):
 global STAGE
 STAGE=label
 if not value:raise RuntimeError(label)
def enc(value):return json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=True,allow_nan=False).encode()
def sha(body):return hashlib.sha256(body).hexdigest()
def digest(value):return sha(enc(value))
def private(name,value):
 raw=enc(value);need(len(raw)<=4*1024**2,'bounded-private-phase4-metadata-evidence');fd=os.open(OUT/name,os.O_CREAT|os.O_EXCL|os.O_WRONLY|os.O_NOFOLLOW,0o600)
 with os.fdopen(fd,'wb')as f:f.write(raw);f.flush();os.fsync(f.fileno())
def load(name,expected):
 p=pathlib.Path(__file__).with_name(name);need(p.is_file()and not p.is_symlink()and sha(p.read_bytes())==expected,'fixed-reviewed-import-only-helper');s=importlib.util.spec_from_file_location('gc1045_'+name.replace('.','_'),p);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m

def plan_check(v):
 keys={'approved','profile5SHA256','r3ManifestSHA256','command','engineID','builder','clientVersion','serverVersion','reservedSpaceBytes','unusedForHours','singleAttempt','automaticRetry','rawOpaqueMetadataEqualityNotClaimed','contractHelperSHA256','readOnlyInspectManifestSHA256'}
 need(type(PLAN)is dict and set(PLAN)==keys and re.fullmatch('[a-f0-9]{64}',PLAN_SHA256 or'')is not None and digest(PLAN)==PLAN_SHA256 and PLAN['approved']is True,'explicit-reviewed-phase4-gc-plan')
 need(PLAN['profile5SHA256']==I.PROFILE5_SHA256 and PLAN['r3ManifestSHA256']==I.R3_MANIFEST_SHA256 and PLAN['command']==list(FIXED_COMMAND)and PLAN['engineID']=='bc9f32e6-298a-45f8-92c7-b755d1b61818'and PLAN['builder']=='default'and PLAN['clientVersion']==PLAN['serverVersion']=='29.2.1'and PLAN['reservedSpaceBytes']==17179869184 and PLAN['unusedForHours']==24 and PLAN['singleAttempt']is True and PLAN['automaticRetry']is False and PLAN['rawOpaqueMetadataEqualityNotClaimed']is True and PLAN['contractHelperSHA256']==INSPECT_HELPER_SHA256 and type(PLAN['readOnlyInspectManifestSHA256'])is str and re.fullmatch('[a-f0-9]{64}',PLAN['readOnlyInspectManifestSHA256'])is not None,'fixed-default-buildkit-old-unused-no-all-command-and-semantic-contract')
 r=v['capacityMetadata']['r3SealedMaintenanceEvidence'];need(r['failedResult']['success']is False and r['singleCommand']['knownExactSummary']['reportedTotalReclaimedBytes']==0 and r['singleCommand']['knownExactSummary']['onlyTotalLineNoRecordIDsListed']is True and r['runtime']['exactEqual']is True and r['volumes']['changedCount']==0 and r['backupMetadata']['exactEqual']is True,'original-r3-failure-kept-with-zero-summary-and-preservation-proof')

def sealed_r3(v):
 r=v['capacityMetadata']['r3SealedMaintenanceEvidence'];folder=ROOT/'deploy/backups/pr1045-cache-maintenance-3';manifest=folder/'manifest.json';need(folder.is_dir()and not any(p.is_symlink()for p in(folder,*folder.parents))and manifest.is_file()and not manifest.is_symlink()and sha(manifest.read_bytes())==I.R3_MANIFEST_SHA256,'original-failed-r3-manifest-kept-sealed');expected=json.loads(manifest.read_bytes());need(expected==r['manifestEntries'],'original-failed-r3-profile5-exact-evidence-manifest');paths=list(folder.iterdir());need(all(p.is_file()and not p.is_symlink()for p in paths)and {p.name for p in paths}==set(expected)|{'manifest.json'},'original-failed-r3-complete-files')
 for name,value in expected.items():need(type(name)is str and re.fullmatch('[A-Za-z0-9_.-]+',name)is not None and sha((folder/name).read_bytes())==value,'original-failed-r3-all-evidence-seals-unchanged')
 return {'manifestSHA256':I.R3_MANIFEST_SHA256,'allEvidenceSHA256Verified':True,'originalFailureNotReclassified':True}

def sealed_inspect(v):
 folder=ROOT/'deploy/backups/pr1045-image-response-inspect-1';path=folder/'manifest.json';need(folder.is_dir()and not any(p.is_symlink()for p in(folder,*folder.parents))and path.is_file()and not path.is_symlink()and sha(path.read_bytes())==PLAN['readOnlyInspectManifestSHA256'],'sealed-successful-readonly-inspect-manifest');manifest=json.loads(path.read_bytes());need(type(manifest)is dict and set(manifest)=={'result.private.json'},'complete-readonly-inspect-manifest');files=list(folder.iterdir());need(all(p.is_file()and not p.is_symlink()for p in files)and {p.name for p in files}==set(manifest)|{'manifest.json'},'complete-regular-readonly-inspect-file-set');result_path=folder/'result.private.json';need(result_path.stat().st_size<=4*1024**2 and sha(result_path.read_bytes())==manifest['result.private.json'],'readonly-inspect-result-sealed-bytes');result=json.loads(result_path.read_bytes());need(result.get('success')is True and result.get('phase')=='inspect'and result.get('readOnly')is True and result.get('pruneOrLifecyclePerformed')is False and result.get('profile5SHA256')==I.PROFILE5_SHA256 and result.get('all46RuntimeSourceConfigEnvHostDirtyExact')is True and result.get('beforeStateSHA256')==result.get('afterStateSHA256'),'actual-readonly-inspection-preservation-proof');details=result['details'];need(details.get('rawConfigEnvOrInspectBodiesPersisted')is False and type(details.get('reads'))is int and 1<=details['reads']<=8 and details.get('maximumReads')==8,'bounded-readonly-image-response-inspection');images=details['images'];targets={r['id']for r in v['capacityMetadata']['r3SealedMaintenanceEvidence']['images']['changed']};allowed={'/Identity/Pull/0/Repository','/Identity/Pull/1/Repository'};need(type(images)is list and len(images)==5 and {r['id']for r in images}==targets,'all-five-original-image-identities-inspected')
 for row in images:
  diff=row.get('sealedBeforeAfterDiff');need(row.get('sealedBeforeHashObserved')is True and row.get('sealedAfterHashObserved')is True and row.get('allObservedVersionContractsExact')is True and type(row.get('versionContractHashes'))is list and len(row['versionContractHashes'])==1 and type(diff)is dict and diff.get('complete')is True and diff.get('truncated')is False and diff.get('differences')and {r['path']for r in diff['differences']}<=allowed,'r3-before-after-exactly-matched-only-proven-identity-pull-order-paths')
 return {'manifestSHA256':PLAN['readOnlyInspectManifestSHA256'],'resultFileSHA256':manifest['result.private.json'],'allFiveSealedBeforeAfterHashesMatched':True,'observedDiffPaths':sorted(allowed),'originalExplicitVersionContractsExact':True,'all46StateExact':True}

def full_image_contract(row):
 # Preserve every field and every nested array except these proven order cases.
 value=copy.deepcopy(row)
 for key in('RepoTags','RepoDigests'):
  if key not in value or value[key]is None:continue
  records=value[key];need(type(records)is list and all(type(x)is str for x in records)and len(records)==len(set(records)),'strict-unique-image-repository-set-elements');value[key]=sorted(records)
 if 'Identity'in value and value['Identity']is not None:
  identity=value['Identity'];need(type(identity)is dict,'strict-image-identity-object')
  if 'Pull'in identity and identity['Pull']is not None:
   records=identity['Pull'];need(type(records)is list and all(type(x)is dict for x in records),'strict-image-identity-pull-object-array');need(len(records)==len({digest(x)for x in records}),'unique-image-identity-pull-object-elements');identity['Pull']=sorted(records,key=enc)
 return value

def engine_contract():
 # This reviewed metadata-only helper's default-engine linkage is observed afresh.
 value=I.H.cache_help_linkage();need(value['duAndEngineDefaultBuilderLinkageObserved']is True and value['engine']['ID']==PLAN['engineID']and value['selectedBuilder']['Name']=='default'and value['selectedBuilder']['Driver']=='docker'and value['versions']['Client']['Version']==value['versions']['Server']['Version']=='29.2.1','same-actual-default-docker-engine-and-versions');help=value['builderPruneHelp'];need(help['returncode']==0 and '--reserved-space'in help['text']and 'docker buildx prune'in help['text'],'actual-reserved-space-buildx-command-capability');return {'engine':value['engine'],'versions':value['versions'],'selectedBuilder':value['selectedBuilder'],'contextName':value['contextName'],'endpointSHA256':value['contextEndpointQuery']['endpointSHA256'],'overrides':value['dockerOverrideEnvironmentHashes'],'pruneHelpSHA256':help['stdoutSHA256']}

def image_contracts():
 identifiers=sorted(set(I.command(['docker','image','ls','-aq','--no-trunc']).decode().split()));need(0<len(identifiers)<=5000 and all(re.fullmatch('sha256:[a-f0-9]{64}',i)for i in identifiers),'all-image-id-inventory');rows=json.loads(I.command(['docker','image','inspect',*identifiers],limit=64*1024**2));need({r['Id']for r in rows}==set(identifiers)and len(rows)==len(identifiers),'all-images-inspected-in-memory');return {'semantic':{r['Id']:{'fullNormalizedMetadataSHA256':digest(full_image_contract(r)),'explicitVersionContractSHA256':digest(I.version_contract(r))}for r in rows},'rawResponseEvidence':{r['Id']:digest(r)for r in rows}}

def cache_id_metadata():
 raw=I.command(['docker','buildx','--builder','default','du','--format=json']);rows=[json.loads(line)for line in raw.splitlines()if line.strip()];ids=[r.get('ID')for r in rows];need(len(ids)<=20000 and len(set(ids))==len(ids)and all(type(i)is str and re.fullmatch('[a-z0-9]{1,128}',i)for i in ids),'all-cache-id-metadata-only');return sorted(ids)

def snapshot(v):
 state=I.state(v);images=image_contracts();names=sorted(set(I.command(['docker','volume','ls','-q']).decode().split()));need(len(names)<=1000 and all(re.fullmatch('[A-Za-z0-9_.-]+',n)for n in names),'all-volume-metadata-names');rows=json.loads(I.command(['docker','volume','inspect',*names]))if names else[];need({r['Name']for r in rows}==set(names),'all-volume-metadata-observed');volumes={r['Name']:digest(r)for r in rows};backup=M.metadata_tree(ROOT/'deploy/backups');engine=engine_contract();space=os.statvfs(engine['engine']['DockerRootDir']);capacity={'available':space.f_bavail*space.f_frsize,'free':space.f_bfree*space.f_frsize};need(capacity['available']>=MIN_ORDINARY and capacity['free']>=MIN_PHYSICAL,'unchanged-reviewed-ordinary-and-physical-minimums');return {'semantic':{'all46RuntimeSourceEnvHost':state,'allImageVersionContracts':images['semantic'],'allVolumes':volumes,'backupMetadata':backup,'engineAndBuilder':engine},'rawImageResponseHashesEvidenceOnly':images['rawResponseEvidence'],'space':capacity}

def safe_command_summary(stdout):
 # Persist a bounded total display only; arbitrary descriptions/output stay in memory.
 lines=stdout.decode('utf-8','replace').splitlines();totals=[]
 for line in lines:
  m=re.fullmatch(r'Total:\s+([0-9]+(?:\.[0-9]+)? ?[kKMGTPE]?[iI]?[bB])',line.strip())
  if m:totals.append(m[1])
 return {'reportedTotalDisplays':totals,'noHostPhysicalReclaimAmountInferred':True}

def main():
 global I,M
 need(EXECUTE is True and sys.argv[1:]==['maintain']and os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_MODE')=='maintain'and os.environ.get('RELEASE_ATTEMPT')=='1','explicit-new-phase4-single-gc-only');I=load(INSPECT_HELPER,INSPECT_HELPER_SHA256);I.OUT=OUT;v=I.profile();plan_check(v);r3=sealed_r3(v);inspection=sealed_inspect(v);M=load(METADATA_HELPER,METADATA_HELPER_SHA256);M.ROOT=ROOT;M.OUT=OUT;old_failure=M.failed_stage_guard();os.umask(0o077);need(OUT.parent.is_dir()and not any(p.is_symlink()for p in(OUT.parent,*OUT.parent.parents))and not OUT.exists()and not OUT.is_symlink(),'fresh-private-phase4-never-replay-r3');OUT.mkdir(mode=0o700);result={'phase':'maintain','generation':4,'success':False,'planSHA256':PLAN_SHA256,'profile5SHA256':I.PROFILE5_SHA256,'originalR3':r3,'originalFirstFailure':old_failure,'readOnlyImageResponseInspection':inspection,'automaticRetry':False,'imageSystemVolumeContainerPrunePerformed':False,'serviceLifecycleOrBusinessDataOperationPerformed':False,'rawImageConfigOrEnvPersisted':False,'rawOpaqueImageMetadataEqualityNotClaimed':True}
 try:
  I.load();before=snapshot(v);private('before.private.json',before);cache_before=cache_id_metadata();private('cache-ids-before.private.json',cache_before);sealed_r3(v);private('intent.private.json',{'command':list(FIXED_COMMAND),'planSHA256':PLAN_SHA256,'beginNs':time.time_ns(),'singleAttempt':True,'automaticRetry':False});r=subprocess.run(FIXED_COMMAND,cwd=ROOT,capture_output=True,timeout=600);need(len(r.stdout)<=4*1024**2 and len(r.stderr)<=1024**2,'bounded-single-default-gc-command-output');receipt={'returncode':r.returncode,'stdoutSHA256':sha(r.stdout),'stderrSHA256':sha(r.stderr),'stdoutBytes':len(r.stdout),'stderrBytes':len(r.stderr),'safeSummary':safe_command_summary(r.stdout)};private('single-command.private.json',receipt);after=snapshot(v);private('after.private.json',after);cache_after=cache_id_metadata();private('cache-ids-after.private.json',cache_after);need(before['semantic']==after['semantic'],'all46-source-env-host-volumes-backups-and-all-image-version-contracts-exact');sealed_r3(v);need(r.returncode==0,'single-default-gc-success-no-automatic-retry');result.update(success=True,beforeSemanticSHA256=digest(before['semantic']),afterSemanticSHA256=digest(after['semantic']),allImageIDsAndTagDigestSetsAndVersionContractsExact=True,allOtherImageMetadataExactAfterOnlyRepositorySetsAndIdentityPullOrderNormalization=True,rawImageResponseHashesExact=before['rawImageResponseHashesEvidenceOnly']==after['rawImageResponseHashesEvidenceOnly'],removedObservedCacheIDs=sorted(set(cache_before)-set(cache_after)),addedObservedCacheIDs=sorted(set(cache_after)-set(cache_before)),spaceBefore=before['space'],spaceAfter=after['space'],safeCommandSummary=receipt['safeSummary'])
 except Exception as error:result.update(errorType=type(error).__name__,stage=STAGE,inspectHelperStage=None if I is None else I.STAGE)
 result['resultSHA256']=digest(result);private('result.private.json',result);files=list(OUT.iterdir());need(all(p.is_file()and not p.is_symlink()for p in files),'regular-new-phase4-evidence');manifest={p.name:sha(p.read_bytes())for p in files};private('manifest.json',manifest);I.H.wire({'result':result,'manifestSHA256':digest(manifest)})if I.H is not None else None;return 0 if result['success']else 1
if __name__=='__main__':sys.exit(main())
