"""Inert exact failed-deploy evidence reader; no lifecycle, DB or HTTP calls.

Only fixed D03/B02 sealed archives, two Docker reads and two firewall saves are used.
Tracebacks/environment/arguments remain private; all wire seals use nibble arrays.
"""
import hashlib,ipaddress,json,os,pathlib,re,shlex,stat,subprocess,sys,traceback
ROOT=pathlib.Path('/opt/rr-portal')
DEPLOY=ROOT/'deploy/backups/pr-1008-20261026-03-deploy'
BACKUP=ROOT/'deploy/backups/pr-1008-20261026-02-backup'
OUT=ROOT/'deploy/backups/pr-1008-20261026-03-deploy-failure-read'
BASE='37b6146354f692dfabc8b009f6c5b80ced091bdb'
BASE_TREE='2ae9b60d6aa627005d5937298fa84386b3572054'
TARGET='bb1fab660bdf4e04e828e4c4250279f717603ac5'
TREE='72baeafdefab7f2abf01be09f941f31ec8b623fa'
BRANCH='refs/heads/ops/pr-1008-20261026-02'
DEPLOY_MANIFEST='ad51e1bd5fae30749cc49cee61f238158dbf609d466165b04809cc297ff2a65e'
DEPLOY_RESULT='a3480b593bd25a7fa6ae40c5e98355a12253c857681bf4543fe12b6a2db91a00'
BACKUP_MANIFEST='2a53e7953a986050fc8c786cc5f4baa758926eb2821233436ec9182c169aec15'
BACKUP_RESULT='8863f1ccf2101e03075d9029aafca1bebbff638542080708ea9b162bdec8454b'
TARGET_IP='172.18.0.35'
TARGET_BRIDGE='br-f26476f65300'
PIN=True
OWN_TAG='rr-pr1008-p02-20261026'
KNOWN_CANDIDATE_IMAGE='sha256:7cc8e9f25c895fe97f302357058a9ceb07ecc7c5a204ab53958a8ecfa8666684'
EXPECTED_ORIGINAL_RESULT={'authenticatedBusinessWritesPerformed': False, 'backupLibraryFailedStage': 'entrypoint', 'base': '37b6146354f692dfabc8b009f6c5b80ced091bdb', 'businessWritesPerformed': False, 'databaseRestorePerformed': False, 'environmentConfigurationChanged': False, 'failedService': 'printlink', 'failedServiceRecoveryCompleted': False, 'failedServiceRetainsOnlyOwnIngressIsolation': False, 'failedStage': 'entrypoint', 'ingressIsolationMustNotBeAssumed': True, 'ingressIsolationState': 'unproven', 'lastKnownPublicIngressReopened': False, 'mode': 'deploy', 'modelCallsPerformed': False, 'otherServicesRequested': False, 'releaseStarted': False, 'safeExceptionType': 'RuntimeError', 'secretOrRowsPrinted': False, 'success': False, 'target': 'bb1fab660bdf4e04e828e4c4250279f717603ac5', 'tree': '72baeafdefab7f2abf01be09f941f31ec8b623fa'}
STATIC_LABELS=('PR1008_BACKUP_REJECTED', 'PR1008_RELEASE_REJECTED', 'actual-gate-proven-before-recovery', 'actual-source-and-assets-equal-prepared', 'actual-source-equals-immutable-prepared', 'all-45-original-runtime-contracts-identical', 'all-46-container-identities', 'all-46-runtime-inspects', 'all-and-only-bound-own-docker-rules-for-current-endpoint', 'all-child-environment-values-exact-pid1-plus-existing-secret-and-station-file', 'all-closed-portable-typed-sqlite-audits-reproduce', 'all-cloud-add-column-migrations-already-applied', 'all-docker-network-topologies-captured', 'all-existing-docker-copy-source-paths-preserved', 'all-files-mode-owners-stable-through-backup', 'all-fixed-configuration-and-mode-owners-preserved', 'all-network-configuration-exact', 'all-nginx-flags-unmodified', 'all-original-database-mode-owners-identical', 'all-original-diagnostic-file-seals', 'all-original-network-identities-only', 'all-other-startup-production-sync-lock-health-source-and-mode-identical', 'all-own-rules-and-chain-absent', 'all-phase-byte-seals', 'all-printlink-docker-copy-bytes-mode-match-base', 'all-printlink-docker-copy-roots', 'all-private-regular-phase-entries', 'all-records-have-identities-and-timestamps-no-startup-migration', 'all-required-input-and-forward-hooks-present', 'all-reviewed-git-file-hashes', 'all-target-maintenance-initially-clear', 'all-three-transitive-dependency-pins-before-import', 'all-transitive-frozen-dependencies', 'all-unchanged-cloud-startup-tables-exist', 'all-unchanged-production-startup-tables-exist', 'all-unrelated-ipv4-rules-byte-identical-and-in-order', 'all-unrelated-ipv6-rules-byte-identical-and-in-order', 'all45-other-container-unchanged', 'all46-original-runtime-before-switch', 'all46-stable-before-own-gate', 'all46-stable-before-recovery-open', 'all46-stable-through-held-loopback-public-checks', 'all46-stable-through-readonly-verify', 'anonymous-business-and-attachment-access-rejected', 'automatic-config-hostname', 'automatic-pid1-hostname', 'base-target-has-exact-dnat-and-accept', 'blank-draft-or-wrong-phase-branch-attempt-target', 'bounded-append-rule', 'bounded-full-printlink-source', 'bounded-ingress-capability-read', 'bounded-printlink-candidate-source', 'bounded-private-env', 'bounded-private-environment-file', 'bounded-public-static-response', 'bounded-readonly-public-request', 'bounded-regular-docker-daemon-config', 'bounded-unique-docker-networks', 'candidate-default-env-byte-list-unchanged', 'candidate-default-environment-covered-by-original-literal', 'candidate-ip-exclusive-in-bound-subnet', 'canonical-known-main-revision', 'canonical-persistent-roots-without-symlink-aliases', 'closed-data-audit-reproduced', 'complete-current-inspects', 'complete-firewall-table', 'complete-hostconfig-mounts', 'complete-original-pid1-environment', 'complete-original-production-printlink-baseline', 'complete-owned-original-destination', 'complete-pid1-environment', 'complete-printlink-candidate-source', 'complete-printlink-source', 'complete-production-two-sqlite-backup', 'complete-runtime-config-and-literal-env', 'complete-saved-rules', 'current-final-runtime-and-original45', 'database-family-map', 'dependency-pin', 'dirty-no-symlink-ancestors', 'dirty-original-regular-file', 'dirty-outside-printlink-app-and-fixed-configuration', 'dirty-regular-file', 'disjoint-canonical-persistent-roots', 'docker-user-is-first-forward-hook-before-established-accept', 'enough-private-backup-space', 'entire-compose-render-unchanged', 'entire-environment-exact-expected-bytes-mode-owner', 'entire-exact-publication-lease-present', 'entire-existing-cloud-startup-schema-seeding-cleanup-prefix-byte-identical', 'every-attachment-json-sync-baseline-secrets-and-file-byte-identical', 'every-business-telemetry-sync-authority-typed-row-schema-and-sequence-identical', 'every-candidate-copy-byte-and-mode-equals-reviewed-git', 'every-nontarget-endpoint-id-ip-name-mac-exact', 'every-original-file-and-directory-mode-owner-identical', 'every-original-nginx-maintenance-flag-unmodified', 'every-retained-main-and-companion-mode-owner-identical', 'exact-46-container-inventory', 'exact-base-tree', 'exact-bounded-lock-file-inventory', 'exact-candidate-platform-revision', 'exact-canonical-main', 'exact-chain-declaration', 'exact-compose-service-config-hash', 'exact-final-reviewed-printlink-frontend-server-doc-test-paths', 'exact-four-local-ipv4-original-destinations', 'exact-four-preexisting-dirty-files', 'exact-lock-directory', 'exact-lock-owner-file', 'exact-one-production-target-45-others', 'exact-only-reviewed-copy-files', 'exact-operational-lock-archive-bytes', 'exact-operational-lock-permissions', 'exact-operational-timestamp', 'exact-operational-timestamp-type', 'exact-phase-seals', 'exact-platform-lock-shape-pid-purpose', 'exact-prepared-source-and-services', 'exact-reviewed-printlink-frontend-diff', 'exact-reviewed-printlink-only-source-inventory', 'exact-reviewed-target-tree', 'exact-service-mount-count', 'exact-service-persistent-mount', 'exact-tracked-only-docker-copy-files', 'exact-two-printlink-database-inventories', 'exact-two-printlink-databases', 'exact-two-running-app-children', 'existing-authority-state-valid-and-preserved', 'existing-persistent-secret-shape', 'existing-persistent-secrets-no-regeneration', 'existing-production-snapshot-no-seed', 'existing-production-snapshot-shape', 'existing-production-users-and-mode-no-seed', 'existing-record-day-shape', 'existing-source-inventory-startup-config-no-seed', 'explicit-publication-only-profile', 'failed-closed-candidate-all-typed-rows-schema-sequence-files-mode-owners-exact', 'false-draft-or-wrong-invocation', 'fixed-printlink-capture-service-label', 'fixed-source-global-config-preserved', 'four-existing-dirty-files-identical', 'frozen-dependency-pin', 'frozen-ingress-profile', 'full-environment-bytes-mode-owner-unchanged', 'full-file-mode-owner-map', 'graceful-stop-removed-only-own-platform-lock', 'healthy-immutable-running-image', 'healthy-target-runtime', 'immutable-prepared-image-identities', 'immutable-printlink-original-image', 'inert-exact-backup-library', 'inert-factory-library', 'ingress-lease-present', 'known-firewall-table', 'known-network-protocol-sysctl', 'lease-install-started-not-released', 'literal-environment-map', 'lock-created-within-exact-candidate-start-window', 'lock-owner-equals-existing-node-database-owner', 'never-restart-without-fresh-closed-business-evidence', 'new-companion-matches-main-mode-owner', 'no-background-unsynced-job-writer', 'no-extra-or-modified-owned-rule', 'no-legacy-quality-stage-migration-candidates', 'no-other-network-created-or-removed', 'no-unattached-upload-gc-candidates-next-two-hours', 'no-unclassified-original-target-ip-firewall-rule', 'nonsecret-wire-sha256', 'observed-special-printlink-writer-reference-requires-specific-review', 'old-runtime-serving-with-no-ingress-write', 'one-complete-operational-lock-member', 'one-current-printlink', 'one-current-target-endpoint', 'one-explicit-compensation-attempt', 'one-ingress-lease-per-phase', 'one-of-each-own-rule-and-chain', 'one-of-each-owned-docker-rule', 'one-owned-failed-candidate', 'one-writer-exclusive-canonical-persistent-root', 'only-automatic-config-hostname', 'only-exact-image-revision-and-compose-labels', 'only-held-owned-failed-service-recovery', 'only-original-runtime-environment', 'only-owned-old-writer-stopped-with-original-contract', 'only-printlink-data-contract', 'only-printlink-public-target', 'only-printlink-source-proof', 'only-readiness-no-false-nginx-isolation', 'only-running-target-one-ipv4-endpoint', 'only-two-databases-and-typed-companion-metadata', 'only-two-existing-printlink-databases', 'original-43-peers-exact-reviewed-profile', 'original-immutable-image', 'original-target-is-exact-ipv4-only-network', 'overlay-exact-production-printlink', 'own-chain-only-ipv4', 'own-operation-service', 'own-rules-at-chain-head-in-exact-order', 'owned-original-destination-is-exact-host', 'owned-rules-have-exact-owned-chain', 'prepared-and-deployed-full-env-binding', 'prepared-original-runtime-and-full-env', 'printlink-public-health', 'printlink-public-static-exact-reviewed-candidate', 'private-original-diagnostic', 'private-original-diagnostic-entries', 'private-phase-directory-and-pins', 'production-printlink-closed-evidence-present', 'production-printlink-runtime-path-and-no-demo-mode', 'production-printlink-scoped-deploy-success', 'publication-adapter-never-creates-owned-chain', 'readable-network-protocol-sysctl', 'recovered-original-full-source', 'regular-environment-file', 'regular-existing-station-config', 'regular-metadata-kind', 'regular-metadata-path', 'regular-sealed-lock-archive', 'regular-tracked-printlink-files', 'rendered-full-literal-environment', 'retry03-never-prepare-build-or-rebackup', 'reviewed-canonical-file-bytes-mode', 'reviewed-ingress-lease-present', 'reviewed-regular-source-mode', 'reviewed-source-manifest-pin', 'reviewed-source-no-symlink-ancestors', 'safe-owned-path', 'safe-regular-candidate-copy-source', 'safe-regular-printlink-container-source', 'same-firewall-backends-as-backup', 'same-four-local-ipv4-addresses-for-public-dnat-gate', 'sealed-capture-audit-binding', 'sealed-cutover-exact-current-candidate-binding', 'sealed-diagnostic-binds-exact43-peer-and-bridge-profile', 'sealed-mode-owner-inventories', 'sealed-original-diagnostic', 'single-install-attempt', 'six-rules-all-existing-original-direction-connections-covered', 'stable-bounded-dirty-file', 'stable-captured-files-and-mode-owners', 'stable-environment-read', 'stable-sealed-lock-archive', 'successful-bound-prior-phase', 'successful-original-routing-diagnostic', 'target-network-attachment-matches-running-state', 'target-only-original-published-binding', 'terminated', 'typed-environment', 'typed-full-file-inventory', 'unchanged-all46-runtime-source-dirty-flags', 'unchanged-global-docker-dependencies-and-migrations', 'unchanged-other-image-labels', 'unique-environment', 'unique-file-paths', 'unique-target-service', 'unrecreated-original-labels')
SAFE_FRAMES={'batch-host-config-library.py', 'pr1008-02-backup-library.py', 'pr1008-03-publication-ingress-library.py', 'run.py', 'release-data-ops-library.py', 'factory-review-backup-library.py', 'pr1008-printlink-contract-library.py', 'pr1008-02-publication-ingress-library.py', 'pr1008-03-release.py', 'release-data-library.py'}
STAGE='entrypoint'
def need(v,label):
 global STAGE
 if not v:STAGE=label;raise RuntimeError('DEPLOY_FAILURE_READ_REJECTED')
def enc(v):return json.dumps(v,ensure_ascii=True,sort_keys=True,separators=(',',':'),allow_nan=False).encode()
def sha(v):return hashlib.sha256(v).hexdigest()
def nibbles(v):
 need(type(v)is str and re.fullmatch('[a-f0-9]{64}',v)is not None,'typed-sha256');return[int(c,16)for c in v]
def safe_name(v):return type(v)is str and bool(v)and str(pathlib.PurePosixPath(v))==v and not pathlib.PurePosixPath(v).is_absolute()and all(x not in{'','.','..'}for x in pathlib.PurePosixPath(v).parts)and not any(ord(c)<32 or c=='\\'for c in v)
def filehash(p):
 need(p.is_file()and not p.is_symlink(),'regular-sealed-file');fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW);h=hashlib.sha256()
 with os.fdopen(fd,'rb')as stream:
  a=os.fstat(stream.fileno());need(stat.S_ISREG(a.st_mode)and a.st_size<=32*1024**3,'bounded-sealed-file')
  for block in iter(lambda:stream.read(1024**2),b''):h.update(block)
  z=os.fstat(stream.fileno());key=lambda s:(s.st_dev,s.st_ino,s.st_mode,s.st_uid,s.st_gid,s.st_size,s.st_mtime_ns,s.st_ctime_ns);need(key(a)==key(z)==key(p.lstat()),'stable-sealed-file-hash')
 return h.hexdigest()
def regular(p,limit=32*1024**2):
 need(p.is_file()and not p.is_symlink()and p.stat().st_size<=limit,'bounded-private-read');h=filehash(p);v=p.read_bytes();need(sha(v)==h==filehash(p),'stable-complete-private-read');return v
def private(n,v):
 need(re.fullmatch('[a-z0-9_.-]+',n)is not None,'fixed-output-name');fd=os.open(OUT/n,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
 with os.fdopen(fd,'wb')as stream:stream.write(v if type(v)is bytes else enc(v));stream.flush();os.fsync(stream.fileno())
def sealed(root,mf,rh,whole):
 need(root.is_dir()and not root.is_symlink()and stat.S_IMODE(root.stat().st_mode)==0o700,'private-original-archive');mb=regular(root/'manifest.json');rb=regular(root/'first-result.json');need(sha(mb)==mf and sha(rb)==rh,'exact-original-manifest-and-result-seals');m=json.loads(mb);need(type(m)is dict and all(safe_name(n)and type(h)is str and re.fullmatch('[a-f0-9]{64}',h)is not None for n,h in m.items()),'safe-original-manifest')
 if whole:
  entries=list(root.rglob('*'));need(len(entries)<=100000 and all(not p.is_symlink()and(p.is_file()or p.is_dir())and p.stat().st_mode&0o077==0 for p in entries),'all-private-original-failed-archive-entries');need(set(m)=={str(p.relative_to(root))for p in entries if p.is_file()and p!=root/'manifest.json'}and all(filehash(root/n)==h for n,h in m.items()),'every-original-failed-deploy-file-seal')
 r=json.loads(rb);need(enc(r)==rb,'canonical-original-result');return m,r

def failure_summary(text):
 lines=[line for line in text.splitlines()if line.strip()];match=re.fullmatch(r'([A-Za-z_][A-Za-z0-9_]*): ?(.*)',lines[-1])if lines else None;allowed={'RuntimeError','ValueError','TypeError','KeyError','FileNotFoundError','PermissionError','OSError','JSONDecodeError','AssertionError'};kind=match[1]if match and match[1]in allowed else'OtherException';message=match[2]if match else'';frames=[]
 for name,line,_ in re.findall(r'File "([^"\n]+)", line ([0-9]+), in ([A-Za-z_][A-Za-z0-9_]*)',text):
  file=pathlib.PurePosixPath(name).name
  if file in SAFE_FRAMES and 0<int(line)<=10000:frames.append({'file':file,'line':int(line)})
 return{'exceptionClass':kind,'staticLabel':message if message in STATIC_LABELS else'<non-whitelisted-message-omitted>','staticLabelWhitelisted':message in STATIC_LABELS,'reviewedSourceFrames':frames[-8:],'tracebackBodyEnvironmentAndArgumentsPrinted':False}

def safe_rule(line,known_interfaces=None):
 tokens=shlex.split(line);need(tokens[:1]==['-A']and len(tokens)<=100,'bounded-rule-tokens');known_interfaces=set(known_interfaces or{'lo','docker0'});chains={'INPUT','OUTPUT','FORWARD','PREROUTING','POSTROUTING','DOCKER','DOCKER-USER','DOCKER-FORWARD','DOCKER-BRIDGE','DOCKER-CT','DOCKER-INTERNAL','DOCKER-ISOLATION-STAGE-1','DOCKER-ISOLATION-STAGE-2'};actions=chains|{'ACCEPT','DROP','RETURN','DNAT','SNAT','MASQUERADE','REJECT','CT','LOG'};modules={'tcp','udp','icmp','icmp6','conntrack','state','addrtype','comment','multiport','limit'};hidden={'--comment','--string','--hex-string','--log-prefix','--u32'}
 def address(value):
  try:ipaddress.ip_network(value,strict=False);return True
  except ValueError:pass
  match=re.fullmatch(r'\[([0-9a-fA-F:]+)\]:([0-9]{1,5})',value)or re.fullmatch(r'([0-9.]+):([0-9]{1,5})',value)
  if match is None:return False
  try:ipaddress.ip_address(match[1]);return 0<int(match[2])<=65535
  except ValueError:return False
 def port(value):return bool(re.fullmatch('[0-9]{1,5}',value))and 0<int(value)<=65535
 def valid(option,value):
  if option=='-A':return value in chains
  if option in{'-j','--jump'}:return value in actions
  if option in{'-p','--protocol'}:return value in{'tcp','udp','icmp','icmpv6','all'}
  if option in{'-m','--match'}:return value in modules
  if option in{'-i','-o','--in-interface','--out-interface'}:return value in known_interfaces
  if option in{'-s','-d','--source','--destination','--ctorigdst','--ctorigsrc','--to-destination','--to-source'}:return address(value)
  if option in{'--dport','--sport','--destination-port','--source-port','--ctorigdstport','--ctorigsrcport'}:return port(value)
  if option=='--ctdir':return value in{'ORIGINAL','REPLY'}
  if option in{'--ctstate','--state'}:return bool(value)and all(v in{'INVALID','NEW','RELATED','ESTABLISHED','UNTRACKED','DNAT','SNAT'}for v in value.split(','))
  if option in{'--src-type','--dst-type'}:return value in{'LOCAL','UNICAST','BROADCAST','MULTICAST','BLACKHOLE','ANYCAST','UNREACHABLE','PROHIBIT','THROW'}
  if option=='--reject-with':return value in{'tcp-reset','icmp-port-unreachable','icmp6-port-unreachable','icmp-host-unreachable','icmp-net-unreachable','icmp-admin-prohibited'}
  return False
 options={'-A','-j','--jump','-p','--protocol','-m','--match','-i','-o','--in-interface','--out-interface','-s','-d','--source','--destination','--ctorigdst','--ctorigsrc','--to-destination','--to-source','--dport','--sport','--destination-port','--source-port','--ctorigdstport','--ctorigsrcport','--ctdir','--ctstate','--state','--src-type','--dst-type','--reject-with'}|hidden;out=[];i=0
 while i<len(tokens):
  token=tokens[i];need(len(token)<=4096,'bounded-private-rule-token')
  if token=='!':out.append(token);i+=1;continue
  if token in options:
   out.append(token);need(i+1<len(tokens),'complete-option-value');value=tokens[i+1];out.append(value if token not in hidden and valid(token,value)else'<value-sha256:'+sha(value.encode())+'>');i+=2;continue
  out.append('<option-sha256:'+sha(token.encode())+'>'if token.startswith('-')else'<value-sha256:'+sha(token.encode())+'>');i+=1
 return out

def public_tokens(line):
 values=safe_rule(line,{'lo','docker0',TARGET_BRIDGE});result=[]
 for i,value in enumerate(values):
  m=re.fullmatch(r'<([a-z-]+)-sha256:([a-f0-9]{64})>',value)
  if m and i>0 and values[i-1]=='--comment'and m[2]==sha(OWN_TAG.encode()):result.append(OWN_TAG)
  else:result.append({'redactedKind':m[1],'SHA256Nibbles':nibbles(m[2])}if m else value)
 return result


def rule_summary(blob):
 table=None;selected=[];forward=[];own=[];heads={};index=0
 for line in blob.decode().splitlines():
  if not line or line.startswith('#'):continue
  if line.startswith('*'):table=line[1:];need(table in{'raw','filter','nat','mangle','security'},'known-rule-table');continue
  if line=='COMMIT':table=None;continue
  if line.startswith(':'):continue
  need(table is not None and line.startswith('-A '),'complete-rule-save');values=shlex.split(line);need(len(values)>=3 and len(values)<=100,'bounded-rule');target=any(v in{TARGET_IP,TARGET_IP+'/32',TARGET_IP+':3100'}for v in values);tagged=OWN_TAG in values
  row={'table':table,'index':index,'tokens':public_tokens(line)}
  if table=='filter'and values[1]=='FORWARD':forward.append(values)
  if table=='filter'and values[1]in{'INPUT','FORWARD','DOCKER-USER'}:
   key=values[1];heads.setdefault(key,[])
   if len(heads[key])<8:heads[key].append(row)
  if tagged:own.append(row)
  if(table=='raw'and target)or(table=='filter'and values[1]in{'FORWARD','DOCKER-USER'})or(target and table in{'nat','filter'})or tagged:selected.append(row)
  index+=1
 need(table is None,'complete-rule-save-end');return{'selectedTargetAndForwardRules':selected,'ownTaggedRules':own,'ownTaggedRuleCount':len(own),'chainHeads':heads,'forwardRuleCount':len(forward),'forwardFirstJumpIsDockerUser':bool(forward and forward[0]==['-A','FORWARD','-j','DOCKER-USER']),'dockerUserForwardJumpIndex':next((i for i,t in enumerate(forward)if t==['-A','FORWARD','-j','DOCKER-USER']),None),'rawRuleBytesNotPrinted':True,'knownPublicOwnTagOnlyCommentPrinted':OWN_TAG}


def normalized(r):
 return{'id':r['Id'],'image':r['Image'],'started':r['State'].get('StartedAt'),'running':r['State']['Running'],'oom':r['State']['OOMKilled'],'restarts':r['RestartCount'],'health':r['State'].get('Health',{}).get('Status'),'environment':sorted(r['Config'].get('Env')or[]),'mounts':sorted(r.get('Mounts',[]),key=enc),'config':dict(r['Config'],Env=sorted(r['Config'].get('Env')or[])),'hostConfig':r['HostConfig']}
def compare_runtime(before,after):
 need(type(before)is list and type(after)is list and len(before)==len(after)==46,'two-complete46-inspects');old={r['Id']:r for r in before};new={r['Id']:r for r in after};need(len(old)==len(new)==46,'unique-runtime-identities');changes=[];target=None
 for ordinal,cid in enumerate(sorted(set(old)|set(new)),1):
  raw=old.get(cid)or new[cid];labels=raw['Config'].get('Labels')or{};s=labels.get('com.docker.compose.service')if labels.get('com.docker.compose.project')=='rr-portal'else None;name=s if type(s)is str and re.fullmatch('[a-z0-9_-]{1,100}',s)else'unlabelled-container-'+str(ordinal)
  if cid not in old or cid not in new:changes.append({'service':name,'changedFields':['identityInventory']});continue
  a,b=normalized(old[cid]),normalized(new[cid]);fields=[k for k in a if enc(a[k])!=enc(b[k])]
  if fields:
   row={'service':name,'changedFields':fields}
   if'health'in fields:row['health']={'before':a['health'],'after':b['health']}
   changes.append(row)
  if s=='printlink':need(target is None,'one-original-printlink');target={'originalIDStillPresent':True,'sameImage':a['image']==b['image'],'sameConfig':enc(a['config'])==enc(b['config']),'sameEnvironment':a['environment']==b['environment'],'sameMounts':enc(a['mounts'])==enc(b['mounts']),'sameHostConfig':enc(a['hostConfig'])==enc(b['hostConfig']),'sameLifecycle':all(enc(a[k])==enc(b[k])for k in('started','running','oom','restarts','health')),'health':b['health'],'allComparedFieldsUnchanged':not fields}
 need(target is not None,'original-target-identity-present');return{'originalAndCurrentContainerCount':46,'sameContainerIdentityInventory':set(old)==set(new),'changedServices':changes,'allComparedFieldsUnchanged':not changes,'targetPrintlink':target,'environmentValuesCIDImagesAndConfigValuesPrinted':False}
def run_readonly(args,label):
 need(args in[['docker','ps','-aq','--no-trunc'],['iptables-save'],['ip6tables-save']]or(args[:2]==['docker','inspect']and len(args)==48 and all(re.fullmatch('[a-f0-9]{64}',v)for v in args[2:])),'only-four-readonly-snapshot-commands');r=subprocess.run(args,stdout=subprocess.PIPE,stderr=subprocess.PIPE,cwd=ROOT,timeout=30);need(len(r.stdout)<=32*1024**2 and len(r.stderr)<=1024**2,'bounded-readonly-inspect');private(label+'-stderr.private',r.stderr);need(r.returncode==0,'readonly-inspect-succeeded');return r.stdout


def diagnose(result):
 manifest,r=sealed(DEPLOY,DEPLOY_MANIFEST,DEPLOY_RESULT,True);need(r==EXPECTED_ORIGINAL_RESULT,'exact-original-safe-failed03-deploy-source-and-recovery-fields');result.update(originalReceipt=r,originalDeploymentSuccess=False,originalDeployManifestSHA256Nibbles=nibbles(DEPLOY_MANIFEST),originalDeployResultSHA256Nibbles=nibbles(DEPLOY_RESULT));result['failure']=failure_summary(regular(DEPLOY/'failure.private.txt',1024**2).decode());recovery='printlink-recovery-failure.private.txt';result['recoveryFailure']=failure_summary(regular(DEPLOY/recovery,1024**2).decode())if recovery in manifest else{'available':False,'reason':'no-sealed-recovery-failure-file'}
 operations=sorted(n for n in manifest if re.fullmatch(r'[0-9]{3}-[a-z0-9_.-]+\.private\.log',n));result['RoperationLogNames']=operations;result['RoperationLogCount']=len(operations);result['noROperationAttemptLogRecorded']=not operations;result['ingressInstallReservationPresent']='ingress-install-reservation.private.json'in manifest;result['closedBeforeCapturePresent']='printlink-closed-before.private.json'in manifest;result['candidateStartedEvidencePresent']='printlink-candidate-started.private.json'in manifest
 result['currentFirewall']={}
 for label,tool in(('ipv4','iptables-save'),('ipv6','ip6tables-save')):
  current_rules=run_readonly([tool],'current-'+label+'-rules');private('current-'+label+'-rules.private',current_rules);result['currentFirewall'][label]=rule_summary(current_rules)
 bmf,br=sealed(BACKUP,BACKUP_MANIFEST,BACKUP_RESULT,False);need(br.get('success')is True and br.get('mode')=='backup'and br.get('base')==br.get('target')==BASE and br.get('tree')==BASE_TREE,'original-successful-backup-source');selected=('ingress-ipv4FilterAndNat.stdout.private','ingress-ipv6FilterAndNat.stdout.private','all-runtime-inspect-001.private.json');saved={}
 for n in selected:need(n in bmf and filehash(BACKUP/n)==bmf[n]and(BACKUP/n).stat().st_mode&0o077==0,'selected-backup-private-file-authenticated');saved[n]=regular(BACKUP/n)
 result['authenticatedBackupRules']={'ipv4':rule_summary(saved[selected[0]]),'ipv6':rule_summary(saved[selected[1]]),'onlySelectedFilesReadBeyondBackupSeals':True};ids=run_readonly(['docker','ps','-aq','--no-trunc'],'inspect-ids').decode().split();need(len(ids)==len(set(ids))==46 and all(re.fullmatch('[a-f0-9]{64}',v)for v in ids),'current46-ids');current=run_readonly(['docker','inspect',*ids],'inspect-current');private('current-runtime-inspects.private.json',current);before=json.loads(saved[selected[2]]);after=json.loads(current);need(type(after)is list and len(after)==46 and{row['Id']for row in after}==set(ids),'complete-current46-inspects')
 try:result['currentRuntimeComparedWithAuthenticatedBackup']=compare_runtime(before,after)
 except RuntimeError:result['currentRuntimeComparedWithAuthenticatedBackup']={'available':False,'reason':'identity-or-comparison-not-preserved','noUnchangedClaim':True}
 targets=[row for row in after if(row['Config'].get('Labels')or{}).get('com.docker.compose.project')=='rr-portal'and(row['Config'].get('Labels')or{}).get('com.docker.compose.service')=='printlink'];old=[row for row in before if(row['Config'].get('Labels')or{}).get('com.docker.compose.project')=='rr-portal'and(row['Config'].get('Labels')or{}).get('com.docker.compose.service')=='printlink'];need(len(targets)==len(old)==1,'unique-current-and-original-printlink');row=targets[0];health=row['State'].get('Health',{}).get('Status');need(type(row['State']['Running'])is bool and type(row['State']['OOMKilled'])is bool and health in{None,'healthy','unhealthy','starting'},'typed-current-printlink-summary');result['currentPrintlink']={'running':row['State']['Running'],'oomKilled':row['State']['OOMKilled'],'health':health,'sameOriginalContainerID':row['Id']==old[0]['Id'],'sameOriginalImage':row['Image']==old[0]['Image'],'matchesPreparedCandidateImage':row['Image']==KNOWN_CANDIDATE_IMAGE,'sameConfig':enc(normalized(row)['config'])==enc(normalized(old[0])['config']),'sameEnvironment':normalized(row)['environment']==normalized(old[0])['environment'],'sameMounts':enc(normalized(row)['mounts'])==enc(normalized(old[0])['mounts']),'sameHostConfig':enc(normalized(row)['hostConfig'])==enc(normalized(old[0])['hostConfig']),'sameLifecycle':all(enc(normalized(row)[k])==enc(normalized(old[0])[k])for k in('started','running','oom','restarts','health')),'published3100BindingUnchanged':row['HostConfig'].get('PortBindings')==old[0]['HostConfig'].get('PortBindings')}
 result['currentRoleInventory']=[]
 for ordinal,item in enumerate(after,1):
  labels=item['Config'].get('Labels')or{};name=labels.get('com.docker.compose.service')if labels.get('com.docker.compose.project')=='rr-portal'else None;status=item['State'].get('Health',{}).get('Status');need(type(item['State']['Running'])is bool and status in{None,'healthy','unhealthy','starting'},'typed-current46-role-metadata');result['currentRoleInventory'].append({'service':name if type(name)is str and re.fullmatch('[a-z0-9_-]{1,100}',name)else'unlabelled-container-'+str(ordinal),'running':item['State']['Running'],'health':status})
 result['currentRoleInventoryCount']=len(after)
 result.update(success=True,completeOriginalDeployPrivateSealsVerified=True,selectedBackupEvidenceAuthenticated=True,originalArchivesModified=False,DBHTTPRestoreConfigSignalsLifecycleOrModelCallsPerformed=False,readonlyDockerInspectCommandsPerformed=2,readonlyFirewallSnapshotCommandsPerformed=2,currentOwnRuleFactsNotAssumedLeaseProof=True)


def main():
 need(PIN is True and sys.argv[1:]==['read-deploy-failure']and os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_ATTEMPT')=='1','false-pin-or-wrong-invocation');os.umask(0o077);OUT.mkdir(mode=0o700);result={'mode':'deploy-failure-read','base':BASE,'target':TARGET,'tree':TREE,'success':False,'originalDeploymentSuccess':False,'diagnosticOnly':True}
 try:diagnose(result)
 except BaseException as error:result.update(success=False,safeFailureStage=STAGE,safeExceptionType=type(error).__name__);private('reader-failure.private.txt',traceback.format_exc().encode())
 finally:
  private('first-result.json',result);manifest={str(p.relative_to(OUT)):filehash(p)for p in OUT.rglob('*')if p.is_file()};private('manifest.json',manifest);print(enc(dict(result,manifestSHA256Nibbles=nibbles(filehash(OUT/'manifest.json')),resultSHA256Nibbles=nibbles(filehash(OUT/'first-result.json')))).decode(),flush=True)
 return 0 if result['success']else 1
if __name__=='__main__':
 try:sys.exit(main())
 except SystemExit:raise
 except BaseException:print('{"mode":"deploy-failure-read","success":false,"safeFailure":"INERT_OR_OUTPUT_FAILURE"}',flush=True);sys.exit(1)
