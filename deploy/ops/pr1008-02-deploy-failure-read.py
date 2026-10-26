"""Inert exact failed-deploy evidence reader; no lifecycle, DB or HTTP calls.

Only fixed sealed archives plus two read-only Docker inspect commands are used.
Tracebacks/environment/arguments remain private; all wire seals use nibble arrays.
"""
import hashlib,ipaddress,json,os,pathlib,re,shlex,stat,subprocess,sys,traceback
ROOT=pathlib.Path('/opt/rr-portal')
DEPLOY=ROOT/'deploy/backups/pr-1008-20261026-02-deploy'
BACKUP=ROOT/'deploy/backups/pr-1008-20261026-02-backup'
OUT=ROOT/'deploy/backups/pr-1008-20261026-02-deploy-failure-read'
BASE='37b6146354f692dfabc8b009f6c5b80ced091bdb'
BASE_TREE='2ae9b60d6aa627005d5937298fa84386b3572054'
TARGET='bb1fab660bdf4e04e828e4c4250279f717603ac5'
TREE='72baeafdefab7f2abf01be09f941f31ec8b623fa'
BRANCH='refs/heads/ops/pr-1008-20261026-02'
DEPLOY_MANIFEST='e11323f5df77aa6ca6ea6a1ac3b75ec5fc22cf53e7dfd83e1b759fb8f6788809'
DEPLOY_RESULT='df1dd42d6a223aded0837dd758e394f3d73b7f94e716520d1f1e97cfa6c7c62e'
BACKUP_MANIFEST='2a53e7953a986050fc8c786cc5f4baa758926eb2821233436ec9182c169aec15'
BACKUP_RESULT='8863f1ccf2101e03075d9029aafca1bebbff638542080708ea9b162bdec8454b'
TARGET_IP='172.18.0.35'
TARGET_BRIDGE='br-f26476f65300'
PIN=True
STATIC_LABELS=('PR1008_BACKUP_REJECTED', 'PR1008_RELEASE_REJECTED', 'all-45-original-runtime-contracts-identical', 'all-and-only-bound-own-docker-rules-for-current-endpoint', 'all-network-configuration-exact', 'all-original-diagnostic-file-seals', 'all-original-network-identities-only', 'all-own-rules-and-chain-absent', 'all-required-input-and-forward-hooks-present', 'all-unrelated-ipv4-rules-byte-identical-and-in-order', 'all-unrelated-ipv6-rules-byte-identical-and-in-order', 'base-target-has-exact-dnat-and-accept', 'bounded-append-rule', 'candidate-ip-exclusive-in-bound-subnet', 'complete-current-inspects', 'complete-firewall-table', 'complete-owned-original-destination', 'complete-saved-rules', 'docker-user-is-first-forward-hook-before-established-accept', 'entire-exact-publication-lease-present', 'every-nontarget-endpoint-id-ip-name-mac-exact', 'exact-46-container-inventory', 'exact-chain-declaration', 'exact-four-local-ipv4-original-destinations', 'explicit-publication-only-profile', 'frozen-ingress-profile', 'known-firewall-table', 'lease-install-started-not-released', 'no-extra-or-modified-owned-rule', 'no-other-network-created-or-removed', 'no-unclassified-original-target-ip-firewall-rule', 'observed-special-printlink-writer-reference-requires-specific-review', 'one-current-printlink', 'one-current-target-endpoint', 'one-explicit-compensation-attempt', 'one-of-each-own-rule-and-chain', 'one-of-each-owned-docker-rule', 'only-running-target-one-ipv4-endpoint', 'original-43-peers-exact-reviewed-profile', 'original-target-is-exact-ipv4-only-network', 'own-chain-only-ipv4', 'own-rules-at-chain-head-in-exact-order', 'owned-original-destination-is-exact-host', 'owned-rules-have-exact-owned-chain', 'private-original-diagnostic', 'private-original-diagnostic-entries', 'publication-adapter-never-creates-owned-chain', 'same-firewall-backends-as-backup', 'same-four-local-ipv4-addresses-for-public-dnat-gate', 'sealed-diagnostic-binds-exact43-peer-and-bridge-profile', 'sealed-original-diagnostic', 'single-install-attempt', 'six-rules-all-existing-original-direction-connections-covered', 'successful-original-routing-diagnostic', 'target-network-attachment-matches-running-state', 'target-only-original-published-binding', 'typed-environment', 'unique-environment')
SAFE_FRAMES={'run.py','pr1008-02-publication-ingress-library.py','pr1008-02-backup-library.py','factory-review-backup-library.py','release-data-ops-library.py','release-data-library.py','batch-host-config-library.py'}
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
 for value in values:
  m=re.fullmatch(r'<([a-z-]+)-sha256:([a-f0-9]{64})>',value)
  result.append({'redactedKind':m[1],'SHA256Nibbles':nibbles(m[2])}if m else value)
 return result

def rule_summary(blob):
 table=None;selected=[];forward=[];index=0
 for line in blob.decode().splitlines():
  if not line or line.startswith('#'):continue
  if line.startswith('*'):table=line[1:];need(table in{'raw','filter','nat','mangle','security'},'known-rule-table');continue
  if line=='COMMIT':table=None;continue
  if line.startswith(':'):continue
  need(table is not None and line.startswith('-A '),'complete-rule-save');values=shlex.split(line);need(len(values)>=3 and len(values)<=100,'bounded-rule');target=any(v in{TARGET_IP,TARGET_IP+'/32',TARGET_IP+':3100'}for v in values)
  if table=='filter'and values[1]=='FORWARD':forward.append(values)
  if(table=='raw'and target)or(table=='filter'and values[1]in{'FORWARD','DOCKER-USER'})or(target and table in{'nat','filter'}):selected.append({'table':table,'index':index,'tokens':public_tokens(line)})
  index+=1
 need(table is None,'complete-rule-save-end');return{'selectedTargetAndForwardRules':selected,'forwardRuleCount':len(forward),'forwardFirstJumpIsDockerUser':bool(forward and forward[0]==['-A','FORWARD','-j','DOCKER-USER']),'dockerUserForwardJumpIndex':next((i for i,t in enumerate(forward)if t==['-A','FORWARD','-j','DOCKER-USER']),None),'rawRuleBytesNotPrinted':True}

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
 need(args==['docker','ps','-aq','--no-trunc']or(args[:2]==['docker','inspect']and len(args)==48 and all(re.fullmatch('[a-f0-9]{64}',v)for v in args[2:])),'only-two-readonly-docker-commands');r=subprocess.run(args,stdout=subprocess.PIPE,stderr=subprocess.PIPE,cwd=ROOT,timeout=40);need(len(r.stdout)<=32*1024**2 and len(r.stderr)<=1024**2,'bounded-readonly-inspect');private(label+'-stderr.private',r.stderr);need(r.returncode==0,'readonly-inspect-succeeded');return r.stdout

def diagnose(result):
 manifest,r=sealed(DEPLOY,DEPLOY_MANIFEST,DEPLOY_RESULT,True);allowed={'authenticatedBusinessWritesPerformed','backupLibraryFailedStage','base','businessWritesPerformed','databaseRestorePerformed','environmentConfigurationChanged','failedStage','mode','modelCallsPerformed','otherServicesRequested','safeExceptionType','secretOrRowsPrinted','success','target','tree'};need(set(r)==allowed and r['mode']=='deploy'and r['success']is False and r['base']==BASE and r['target']==TARGET and r['tree']==TREE,'exact-original-safe-failed-deploy-source');result.update(originalReceipt=r,originalDeploymentSuccess=False,originalDeployManifestSHA256Nibbles=nibbles(DEPLOY_MANIFEST),originalDeployResultSHA256Nibbles=nibbles(DEPLOY_RESULT));result['failure']=failure_summary(regular(DEPLOY/'failure.private.txt',1024**2).decode());operations=[n for n in manifest if re.fullmatch('[0-9]{3}-[a-z0-9_.-]+\\.private\\.log',n)];result['RoperationLogCount']=len(operations);result['noROperationAttemptLogRecorded']=not operations;result['ingressInstallReservationPresent']='ingress-install-reservation.private.json'in manifest;result['closedBeforeCapturePresent']='printlink-closed-before.private.json'in manifest;result['candidateStartedEvidencePresent']='printlink-candidate-started.private.json'in manifest
 bmf,br=sealed(BACKUP,BACKUP_MANIFEST,BACKUP_RESULT,False);need(br.get('success')is True and br.get('mode')=='backup'and br.get('base')==br.get('target')==BASE and br.get('tree')==BASE_TREE,'original-successful-backup-source');selected=('ingress-ipv4FilterAndNat.stdout.private','ingress-ipv6FilterAndNat.stdout.private','all-runtime-inspect-001.private.json');saved={}
 for n in selected:need(n in bmf and filehash(BACKUP/n)==bmf[n]and(BACKUP/n).stat().st_mode&0o077==0,'selected-backup-private-file-authenticated');saved[n]=regular(BACKUP/n)
 result['authenticatedBackupRules']={'ipv4':rule_summary(saved[selected[0]]),'ipv6':rule_summary(saved[selected[1]]),'onlySelectedFilesReadBeyondBackupSeals':True};ids=run_readonly(['docker','ps','-aq','--no-trunc'],'inspect-ids').decode().split();need(len(ids)==len(set(ids))==46 and all(re.fullmatch('[a-f0-9]{64}',v)for v in ids),'current46-ids');current=run_readonly(['docker','inspect',*ids],'inspect-current');private('current-runtime-inspects.private.json',current);result['currentRuntimeComparedWithAuthenticatedBackup']=compare_runtime(json.loads(saved[selected[2]]),json.loads(current));result.update(success=True,completeOriginalDeployPrivateSealsVerified=True,selectedBackupEvidenceAuthenticated=True,originalArchivesModified=False,DBHTTPRestoreConfigSignalsLifecycleOrModelCallsPerformed=False,readonlyDockerInspectCommandsPerformed=2)

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
