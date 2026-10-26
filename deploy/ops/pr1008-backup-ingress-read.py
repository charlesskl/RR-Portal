"""Inert, read-only sealed-B diagnostic. No Docker, DB, network or config writes.

Reads the exact failed/successful backup archive only. Full raw evidence stays
private; stdout contains routing facts, rule topology and changed field names.
"""
import hashlib,ipaddress,json,os,pathlib,re,shlex,stat,sys,traceback
ROOT=pathlib.Path('/opt/rr-portal')
BACKUP=ROOT/'deploy/backups/pr-1008-20261026-backup'
OUT=ROOT/'deploy/backups/pr-1008-20261026-backup-ingress-read'
BASE='37b6146354f692dfabc8b009f6c5b80ced091bdb'
TREE='2ae9b60d6aa627005d5937298fa84386b3572054'
BRANCH='refs/heads/ops/pr-1008-20261026'
BACKUP_MANIFEST='a759bd8ef765291d2ae6dc67750c7f1c34e0897f7fa8bf6eb0953bf924ca7cdb'
BACKUP_RESULT='de74ef0affba561e3b94c1984b0468db4953c5b88899943bc9e192d1b9693ab9'
DIAGNOSTIC_PIN=False

def need(v,label):
 if not v:raise RuntimeError(label)
def enc(v):return json.dumps(v,ensure_ascii=True,sort_keys=True,separators=(',',':'),allow_nan=False).encode()
def sha(v):return hashlib.sha256(v).hexdigest()
def regular(p,limit=32*1024**2):
 need(p.is_file()and not p.is_symlink()and p.stat().st_size<=limit,'bounded-regular-sealed-input');return p.read_bytes()
def hashfile(p):
 h=hashlib.sha256()
 with p.open('rb')as stream:
  for block in iter(lambda:stream.read(1024**2),b''):h.update(block)
 return h.hexdigest()
def private(name,value):
 need(re.fullmatch('[a-z0-9_.-]+',name)is not None,'fixed-private-output-name');data=value if type(value)is bytes else enc(value);fd=os.open(OUT/name,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
 with os.fdopen(fd,'wb')as stream:stream.write(data);stream.flush();os.fsync(stream.fileno())
def read(name):return json.loads(regular(BACKUP/name))
def sealed():
 need(re.fullmatch('[a-f0-9]{64}',BACKUP_MANIFEST)is not None and re.fullmatch('[a-f0-9]{64}',BACKUP_RESULT)is not None,'exact-two-backup-seals');need(BACKUP.is_dir()and not BACKUP.is_symlink()and stat.S_IMODE(BACKUP.stat().st_mode)==0o700,'private-sealed-backup-directory');need(sha(regular(BACKUP/'manifest.json'))==BACKUP_MANIFEST and sha(regular(BACKUP/'first-result.json'))==BACKUP_RESULT,'exact-original-backup-seals');m=read('manifest.json');entries=list(BACKUP.rglob('*'));need(type(m)is dict and len(entries)<=100000 and all(not p.is_symlink()and(p.is_file()or p.is_dir())and p.stat().st_mode&0o077==0 for p in entries),'private-regular-entire-backup');actual={str(p.relative_to(BACKUP))for p in entries if p.is_file()and p!=BACKUP/'manifest.json'};need(set(m)==actual and all(type(n)is str and str(pathlib.PurePosixPath(n))==n and not pathlib.PurePosixPath(n).is_absolute()and'..'not in pathlib.PurePosixPath(n).parts and type(h)is str and re.fullmatch('[a-f0-9]{64}',h)is not None and hashfile(BACKUP/n)==h for n,h in m.items()),'every-original-private-backup-file-seal');r=read('first-result.json');need(r.get('mode')=='backup'and r.get('base')==r.get('target')==BASE and r.get('tree')==TREE and type(r.get('success'))is bool,'original-success-or-failure-backup-bound');return r

def service(r):
 l=r['Config'].get('Labels')or{};s=l.get('com.docker.compose.service')if l.get('com.docker.compose.project')=='rr-portal'else None;return s if type(s)is str and re.fullmatch('[a-z0-9_-]{1,100}',s)else'container-'+sha(r['Id'].encode())[:12]
def normalized(r):
 return{'id':r['Id'],'image':r['Image'],'started':r['State'].get('StartedAt'),'running':r['State']['Running'],'oom':r['State']['OOMKilled'],'restarts':r['RestartCount'],'health':r['State'].get('Health',{}).get('Status'),'environmentMapSHA256':sha(enc(sorted(r['Config'].get('Env')or[]))),'mountsSHA256':sha(enc(sorted(r.get('Mounts',[]),key=enc))),'configSHA256':sha(enc(dict(r['Config'],Env=sorted(r['Config'].get('Env')or[])))),'hostConfigSHA256':sha(enc(r['HostConfig']))}
def runtime_changes(before,after):
 need(type(before)is list and type(after)is list and len(before)==len(after)==46,'both-complete-original-46-inspects');a={service(r):normalized(r)for r in before};b={service(r):normalized(r)for r in after};need(len(a)==len(b)==46,'unique-service-identities');out=[]
 for s in sorted(set(a)|set(b)):
  if s not in a or s not in b:out.append({'service':s,'changedFields':['identityInventory'],'beforePresent':s in a,'afterPresent':s in b});continue
  fields=[k for k in a[s]if a[s][k]!=b[s][k]]
  if fields:
   row={'service':s,'changedFields':fields}
   if'health'in fields:row['health']={'before':a[s]['health'],'after':b[s]['health']}
   for k in('running','oom'):
    if k in fields:row[k]={'before':a[s][k],'after':b[s][k]}
   out.append(row)
 return{'changedServices':out,'bothInspectContainerCount':46,'allComparedInspectFieldsIdentical':not out,'processEnvironmentEvidenceNotReconstructedFromInspect':True}

def ip(value):
 return type(value)is str and re.fullmatch('[0-9a-fA-F:.]+(?:/[0-9]{1,3})?',value)is not None

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

def rules_summary(name,target_ips,known_interfaces=None):
 p=BACKUP/name
 if not p.exists():return{'available':False}
 text=regular(p).decode();table=None;chains={};selected=[];count=0
 for line in text.splitlines():
  if not line or line.startswith('#'):continue
  if line.startswith('*'):table=line[1:];need(table in{'filter','nat','mangle','raw','security'},'known-firewall-table');chains[table]={};continue
  if line=='COMMIT':table=None;continue
  need(table is not None,'complete-firewall-save')
  if line.startswith(':'):
   m=re.fullmatch(':([A-Za-z0-9_-]+) (ACCEPT|DROP|REJECT|-) \\[[0-9]+:[0-9]+\\]',line);need(m is not None,'chain-declaration');name=m[1];known={'INPUT','OUTPUT','FORWARD','PREROUTING','POSTROUTING','DOCKER','DOCKER-USER','DOCKER-FORWARD','DOCKER-BRIDGE','DOCKER-CT','DOCKER-INTERNAL','DOCKER-ISOLATION-STAGE-1','DOCKER-ISOLATION-STAGE-2'};chains[table][name if name in known else'<chain-sha256:'+sha(name.encode())+'>']=m[2];continue
  rawtokens=shlex.split(line);tokens=safe_rule(line,known_interfaces);count+=1;port='3100'in rawtokens;target=any(v==address or v==address+'/32'or v==address+'/128'or v==address+':3100'or v=='['+address+']:3100'for address in target_ips for v in rawtokens)
  if rawtokens[1]in{'DOCKER-USER','DOCKER-FORWARD','DOCKER-BRIDGE','DOCKER-CT'}or(port and table=='nat')or(target and table in{'nat','filter'}):selected.append({'table':table,'tokens':tokens})
 return{'available':True,'sha256':sha(text.encode()),'tablesAndChainPolicies':chains,'ruleCount':count,'selectedRoutingRules':selected}

def listener_summary(text):
 result=[]
 for line in text.splitlines():
  parts=line.split()
  if len(parts)<5 or parts[0]!='LISTEN'or parts[3].rsplit(':',1)[-1]!='3100':continue
  endpoint=parts[3];need(re.fullmatch(r'[0-9a-fA-F:.\[\]*]+:3100',endpoint)is not None,'literal-3100-listener-endpoint');names=re.findall(r'\("([A-Za-z0-9_.-]{1,80})",pid=([0-9]+),fd=[0-9]+\)',line);result.append({'localEndpoint':endpoint,'ipv6':endpoint.startswith('['),'processes':[{'name':name,'pid':int(pid)}for name,pid in names]})
 return result

def diagnose(result):
 original=sealed();result['originalBackupSuccess']=original['success'];result['originalFailedStage']=original.get('failedStage');a=read('all-runtime-inspect-001.private.json');b=read('all-runtime-inspect-002.private.json');result['runtimeInspectComparison']=runtime_changes(a,b);targets=[r for r in a if service(r)=='printlink'];need(len(targets)==1,'one-original-printlink');target=targets[0];net=target['NetworkSettings']['Networks'];target_ips=[n[k]for n in net.values()for k in('IPAddress','GlobalIPv6Address')if n.get(k)];need(all(ip(v)for v in target_ips),'literal-target-addresses');networks=read('ingress-all-docker-networks.private.json');needed={n['NetworkID']for n in net.values()};networkrows=[]
 for n in networks:
  if n['Id']not in needed:continue
  endpoints=[]
  for cid,e in(n.get('Containers')or{}).items():
   match=[r for r in a if r['Id']==cid];need(len(match)==1,'network-endpoint-bound-original-inspect');endpoints.append({'service':service(match[0]),'ipv4Address':e.get('IPv4Address'),'ipv6Address':e.get('IPv6Address'),'target':cid==target['Id']})
  networkrows.append({'name':n['Name'],'id':n['Id'],'driver':n['Driver'],'internal':n['Internal'],'enableIPv6':n['EnableIPv6'],'ipamDriver':(n.get('IPAM')or{}).get('Driver'),'ipamConfig':[{k:v for k,v in row.items()if k in{'Subnet','IPRange','Gateway'}}for row in(n.get('IPAM')or{}).get('Config')or[]],'bridgeName':(n.get('Options')or{}).get('com.docker.network.bridge.name')or('br-'+n['Id'][:12]if n['Driver']=='bridge'else None),'endpoints':endpoints})
 need(len(networkrows)==len(needed),'all-target-network-topologies');result['targetTopology']={'networkCount':len(net),'targetAddresses':target_ips,'publishedBindings':target['HostConfig'].get('PortBindings'),'networkMode':target['HostConfig'].get('NetworkMode'),'networks':networkrows};bindings=[];references=[]
 for r in a:
  s=service(r)
  for port,items in(r['HostConfig'].get('PortBindings')or{}).items():
   for item in items or[]:
    if item.get('HostPort')=='3100':bindings.append({'service':s,'containerPort':port,'hostIP':item.get('HostIp'),'hostPort':3100})
  if s=='printlink':continue
  for entry in r['Config'].get('Env')or[]:
   key,_,value=entry.partition('=');has_name='printlink'in value.lower();has_ip=any(address in value for address in target_ips)
   if has_name or has_ip:references.append({'service':s,'environmentKey':key if re.fullmatch('[A-Za-z_][A-Za-z0-9_]*',key)else'<key-sha256:'+sha(key.encode())+'>','valueSHA256':sha(value.encode()),'containsTargetServiceName':has_name,'containsCurrentTargetIP':has_ip,'writerNotProvenByReference':True})
 result['publishedHost3100Owners']=bindings;result['otherContainerEnvironmentReferences']=references;known_interfaces={'lo','docker0'}|{n['bridgeName']for n in networkrows if n.get('bridgeName')};result['firewall']={'ipv4':rules_summary('ingress-ipv4FilterAndNat.stdout.private',target_ips,known_interfaces),'ipv6':rules_summary('ingress-ipv6FilterAndNat.stdout.private',target_ips,known_interfaces)};result['capabilities']=read('ingress-capabilities.private.json');result['capabilities'].pop('publishedPortBindings',None)
 for label in('addresses','ipv4Routes','ipv6Routes'):
  p=BACKUP/('ingress-'+label+'.stdout.private');data=json.loads(regular(p))if p.exists()and p.stat().st_size else None
  if label=='addresses'and data is not None:data=[{'interface':row['ifname'],'flags':row.get('flags',[]),'addresses':[{k:v for k,v in address.items()if k in{'family','local','prefixlen','scope'}}for address in row.get('addr_info',[])]}for row in data]
  result[label]=data
 # Only a 3100 listening endpoint line; no command arguments or environment.
 p=BACKUP/'ingress-listeners.stdout.private';result['port3100Listeners']=listener_summary(regular(p).decode())if p.exists()else[]
 p=BACKUP/'ingress-docker-daemon.private.json'
 if p.exists():config=json.loads(regular(p));result['daemonRoutingSettings']={k:config[k]for k in('iptables','ip6tables','ipv6','userland-proxy','ip','ip6','fixed-cidr','fixed-cidr-v6')if k in config}
 result.update(success=True,onlySealedOriginalBackupRead=True,liveRuntimeOrNetworkReadsPerformed=False,configurationOrFirewallChanged=False,businessRecordsQueriedOrPrinted=False,rawBackupFileBytesHashedForSeals=True,secretsOrEnvironmentValuesPrinted=False,actualWriterCoverageProven=False)

def main():
 need(DIAGNOSTIC_PIN is True and sys.argv[1:]==['read-backup-ingress']and os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_ATTEMPT')=='1','inert-or-wrong-diagnostic-invocation');os.umask(0o077);OUT.mkdir(mode=0o700);result={'mode':'backup-ingress-read','base':BASE,'target':BASE,'tree':TREE,'success':False,'businessWritesPerformed':False,'runtimeNetworkOrFirewallCommandsPerformed':False}
 try:diagnose(result)
 except BaseException as error:result.update(success=False,safeFailureType=type(error).__name__);private('failure.private.txt',traceback.format_exc().encode())
 finally:
  private('first-result.json',result);manifest={str(p.relative_to(OUT)):hashfile(p)for p in OUT.rglob('*')if p.is_file()};private('manifest.json',manifest);print(enc(dict(result,manifestSHA256=hashfile(OUT/'manifest.json'),resultSHA256=hashfile(OUT/'first-result.json'))).decode(),flush=True)
 return 0 if result['success']else 1
if __name__=='__main__':
 try:sys.exit(main())
 except SystemExit:raise
 except BaseException:print('{"mode":"backup-ingress-read","success":false,"safeFailure":"INERT_DIAGNOSTIC_REJECTED"}',flush=True);sys.exit(1)
