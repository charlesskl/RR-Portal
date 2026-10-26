"""INERT recovery of the stopped original PrintLink container and own gate.
PIN False prevents execution. Reuses the exact reviewed R/B/D libraries for a
fresh closed copy, one original-container start, strict data/source checks and
read-only loopback verification before deleting only this deployment's six
rules. No candidate start/rebuild, DB restore, business/auth/model writes,
environment/source edit, other-service lifecycle action or signal exists.
"""
import copy,hashlib,importlib.util,ipaddress,json,os,pathlib,re,shlex,stat,subprocess,sys,traceback
ROOT=pathlib.Path('/opt/rr-portal')
D=ROOT/'deploy/backups/pr-1008-20261026-03-deploy'
BACKUP=ROOT/'deploy/backups/pr-1008-20261026-02-backup'
READER=ROOT/'deploy/backups/pr-1008-20261026-03-deploy-failure-read'
OUT=ROOT/'deploy/backups/pr-1008-20261026-03-publication-cleanup'
BASE='37b6146354f692dfabc8b009f6c5b80ced091bdb'
TARGET='bb1fab660bdf4e04e828e4c4250279f717603ac5'
TREE='72baeafdefab7f2abf01be09f941f31ec8b623fa'
BRANCH='refs/heads/ops/pr-1008-20261026-02'
D_MANIFEST='ad51e1bd5fae30749cc49cee61f238158dbf609d466165b04809cc297ff2a65e'
D_RESULT='a3480b593bd25a7fa6ae40c5e98355a12253c857681bf4543fe12b6a2db91a00'
B_MANIFEST='2a53e7953a986050fc8c786cc5f4baa758926eb2821233436ec9182c169aec15'
B_RESULT='8863f1ccf2101e03075d9029aafca1bebbff638542080708ea9b162bdec8454b'
READER_MANIFEST='ab8e17668325d777a0f45ab033bfece07a24ef6d18c78470228f1c3b11beb501'
READER_RESULT='8d23962ad0d8062a9a6823226107015f66501d073bb00e4844d68c8ef9adb682'
EXPECTED_TARGET_ID=None
EXPECTED_TARGET_IMAGE=None
EXPECTED_TARGET_CONTRACT_SHA=None
EXPECTED_TARGET_RUNNING=None
ORIGINAL_IMAGE='sha256:5d48e2e4e4557988e56fb3e27d28c38eab98410244783e31d169466b0fb476f4'
DEPS={'pr1008-02-publication-ingress-profile.json': 'c0c279e91c9b55a119e3755801964d3f586752999d3df6a260ac4697dd018e0e', 'pr1008-03-publication-ingress-library.py': '0848f4456abcc3d2fbee2bc4250b32029fdebc53965966c1ca6a9f0356d9d2cb', 'pr1008-02-backup-library.py': 'cb4cb071c3a6536fe5cf9a802ed092d7798147613501421c8ec5bd7ffaa79428', 'pr1008-printlink-contract-library.py': '97a14ebb6a93034cf6531880d8852151472ec49f7881a136648376b602a36882', 'batch-host-config-library.py': 'bd1842dc6847f3e0e5c0c38374c3604791f66d1c94dc651457607dc338f38ff1', 'factory-review-backup-library.py': '79d76bb47312dd08c121ebe2797f54d958666f8b72d00721f67712b152fc4666', 'release-data-ops-library.py': 'ff9138a1d5bfed1b10077112da6ebcda2d65240f583e2d0e12ce1325cfbaafd5', 'release-data-library.py': 'd63168fd3057f4f2aba2d93f9fab31d2d65c6dd0f3234877d71fcff1e04e62b9', 'pr1008-03-release-library.py': '8a136ece934d484ee34682689150a4ab3ec2bae30947a06ef2b473d1676a4380', 'pr1008-03-reviewed-files.json': 'c73c0f11264192d40a06e16185d356168098ac0c19da66cf15ee05292a5ba734'}
PIN=False
TAG='rr-pr1008-p02-20261026'
OWN_CHAIN='RRP1008_P02'
EXPECTED_COUNT=6
STAGE='entrypoint'
SERIAL=0
def need(v,label):
 global STAGE
 if not v:STAGE=label;raise RuntimeError('PUBLICATION_CLEANUP_REJECTED')
def pin(v):return type(v)is str and re.fullmatch('[a-f0-9]{64}',v)is not None
def enc(v):
    return json.dumps(v, ensure_ascii=True, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()

def sha(v):
    return hashlib.sha256(v).hexdigest()

def nibbles(v):
    need(type(v) is str and re.fullmatch('[a-f0-9]{64}', v) is not None, 'typed-sha256')
    return [int(c, 16) for c in v]

def safe_name(v):
    return type(v) is str and bool(v) and (str(pathlib.PurePosixPath(v)) == v) and (not pathlib.PurePosixPath(v).is_absolute()) and all((x not in {'', '.', '..'} for x in pathlib.PurePosixPath(v).parts)) and (not any((ord(c) < 32 or c == '\\' for c in v)))

def filehash(p):
    need(p.is_file() and (not p.is_symlink()), 'regular-sealed-file')
    fd = os.open(p, os.O_RDONLY | os.O_NOFOLLOW)
    h = hashlib.sha256()
    with os.fdopen(fd, 'rb') as stream:
        a = os.fstat(stream.fileno())
        need(stat.S_ISREG(a.st_mode) and a.st_size <= 32 * 1024 ** 3, 'bounded-sealed-file')
        for block in iter(lambda : stream.read(1024 ** 2), b''):
            h.update(block)
        z = os.fstat(stream.fileno())
        key = lambda s: (s.st_dev, s.st_ino, s.st_mode, s.st_uid, s.st_gid, s.st_size, s.st_mtime_ns, s.st_ctime_ns)
        need(key(a) == key(z) == key(p.lstat()), 'stable-sealed-file-hash')
    return h.hexdigest()

def regular(p, limit=32 * 1024 ** 2):
    need(p.is_file() and (not p.is_symlink()) and (p.stat().st_size <= limit), 'bounded-private-read')
    h = filehash(p)
    v = p.read_bytes()
    need(sha(v) == h == filehash(p), 'stable-complete-private-read')
    return v

def private(n, v):
    need(re.fullmatch('[a-z0-9_.-]+', n) is not None, 'fixed-output-name')
    fd = os.open(OUT / n, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 384)
    with os.fdopen(fd, 'wb') as stream:
        stream.write(v if type(v) is bytes else enc(v))
        stream.flush()
        os.fsync(stream.fileno())

def sealed(root, mf, rh, whole):
    need(root.is_dir() and (not root.is_symlink()) and (stat.S_IMODE(root.stat().st_mode) == 448), 'private-original-archive')
    mb = regular(root / 'manifest.json')
    rb = regular(root / 'first-result.json')
    need(sha(mb) == mf and sha(rb) == rh, 'exact-original-manifest-and-result-seals')
    m = json.loads(mb)
    need(type(m) is dict and all((safe_name(n) and type(h) is str and (re.fullmatch('[a-f0-9]{64}', h) is not None) for (n, h) in m.items())), 'safe-original-manifest')
    if whole:
        entries = list(root.rglob('*'))
        need(len(entries) <= 100000 and all((not p.is_symlink() and (p.is_file() or p.is_dir()) and (p.stat().st_mode & 63 == 0) for p in entries)), 'all-private-original-failed-archive-entries')
        need(set(m) == {str(p.relative_to(root)) for p in entries if p.is_file() and p != root / 'manifest.json'} and all((filehash(root / n) == h for (n, h) in m.items())), 'every-original-failed-deploy-file-seal')
    r = json.loads(rb)
    need(enc(r) == rb, 'canonical-original-result')
    return (m, r)

def exact(left, right):
    return type(left) is type(right) and json.dumps(left, sort_keys=True, separators=(',', ':'), allow_nan=False) == json.dumps(right, sort_keys=True, separators=(',', ':'), allow_nan=False)

def token(row):
    need(type(row) in (list, tuple) and len(row) == 2 and (type(row[0]) is str) and (type(row[1]) is str), 'typed-saved-rule-row')
    return tuple(shlex.split(row[1])) if row[1].startswith('-A ') else None

def canonical_owned(tokens):
    """Only the already reviewed exact-host conntrack /32 spelling is folded."""
    result = list(tokens)
    if '--ctorigdst' in result:
        index = result.index('--ctorigdst') + 1
        need(index < len(result), 'complete-owned-ctorigdst')
        network = ipaddress.ip_network(result[index], strict=False)
        need(network.version == 4 and network.prefixlen == 32, 'exact-owned-original-destination-host')
        result[index] = str(network.network_address)
    return tuple(result)

def own_partition(rows, expected, family):
    (found, foreign) = ([], [])
    allowed = {(table, tuple(tokens)) for (f, table, tokens) in expected if f == family}
    for row in rows:
        tokens = token(row)
        if tokens and (TAG in tokens or OWN_CHAIN in tokens):
            need(row[0] == 'filter' and (row[0], canonical_owned(tokens)) in allowed, 'only-exact-reviewed-own-rule')
            found.append((row[0], tokens))
        else:
            need(not row[1].startswith(':' + OWN_CHAIN + ' '), 'no-owned-chain-created')
            foreign.append(copy.deepcopy(row))
    normalized = [(table, canonical_owned(tokens)) for (table, tokens) in found]
    need(len(normalized) == len(set(normalized)), 'no-duplicate-own-rules')
    return (foreign, found)

def plan_cleanup(installed_rules, original_rows, current_rows):
    """Return inert deletion argv; no process, file, DB, network or signal I/O.

    installed_rules is the authenticated D03 reservation's exact six rules.
    original_rows/current_rows are authenticated parse_save()['rows'] mappings
    keyed by integer family 4 and 6. A separate controller must prove the
    reservation matches frozen profile/source and the original B02 rules.
    """
    need(type(installed_rules) is list and len(installed_rules) == EXPECTED_COUNT, 'exact-six-authenticated-install-rules')
    need(set(original_rows) == {4, 6} and set(current_rows) == {4, 6}, 'both-firewall-families')
    normalized = []
    for entry in installed_rules:
        need(type(entry) in (list, tuple) and len(entry) == 3, 'typed-install-rule')
        (family, table, tokens) = entry
        need(type(family) is int and family in (4, 6) and (table == 'filter') and (type(tokens) in (list, tuple)) and all((type(t) is str for t in tokens)), 'typed-fixed-family-filter-rule')
        need(tokens[:2] in (['-A', 'INPUT'], ['-A', 'DOCKER-USER'], ('-A', 'INPUT'), ('-A', 'DOCKER-USER')) and tokens.count(TAG) == 1 and (OWN_CHAIN not in tokens), 'only-six-tagged-input-or-docker-user-rules')
        normalized.append((family, table, tuple(tokens)))
    need(len(set(normalized)) == EXPECTED_COUNT and sum((f == 6 for (f, _, _) in normalized)) == 1, 'unique-five-ipv4-one-ipv6-install-rules')
    (commands, expected_after) = ([], {})
    for family in (4, 6):
        (baseline_foreign, baseline_own) = own_partition(original_rows[family], normalized, family)
        need(not baseline_own, 'owned-tag-absent-before-this-install')
        (current_foreign, current_own) = own_partition(current_rows[family], normalized, family)
        expected_after[family] = current_foreign
        for (_, tokens) in reversed(current_own):
            commands.append(['iptables' if family == 4 else 'ip6tables', '-w', '30', '-t', 'filter', '-D', *tokens[1:]])
    need(len(commands) <= EXPECTED_COUNT, 'bounded-only-observed-own-subset-deletion')
    return {'commands': commands, 'expectedAfterRows': expected_after, 'expectedRemovedCount': len(commands), 'requiresCurrent46And43PeersPrivateSnapshots': True, 'requiresActualTargetIdentityImageConfigRunningProof': True, 'unrelatedLifecycleEqualityToOldBackupRequired': False, 'containerOrSourceOrDataOrEnvironmentOperations': False}

def verify_after(plan, observed_rows):
    need(set(observed_rows) == {4, 6}, 'both-after-firewall-families')
    need(exact(plan['expectedAfterRows'], observed_rows), 'all-current-foreign-rules-byte-identical-in-order-and-only-own-subset-removed')
    return True

def parse_save(blob):
    text = blob.decode()
    table = None
    rows = []
    times = []
    counters = {}
    for line in text.splitlines():
        if not line:
            continue
        if line.startswith('# Generated by ') or line.startswith('# Completed on '):
            times.append(line)
            continue
        if line.startswith('*'):
            need(table is None and line[1:] in {'filter', 'nat', 'raw', 'mangle', 'security'}, 'known-firewall-table')
            table = line[1:]
            rows.append((table, line))
            continue
        need(table is not None, 'complete-firewall-table')
        if line == 'COMMIT':
            rows.append((table, line))
            table = None
            continue
        if line.startswith(':'):
            m = re.fullmatch(':([A-Za-z0-9_-]+) (ACCEPT|DROP|REJECT|-) \\[([0-9]+):([0-9]+)\\]', line)
            need(m is not None, 'exact-chain-declaration')
            rows.append((table, ':' + m[1] + ' ' + m[2] + ' [COUNTERS]'))
            counters[table + '/' + m[1]] = [int(m[3]), int(m[4])]
            continue
        need(line.startswith('-A ') and len(shlex.split(line)) <= 100, 'bounded-append-rule')
        rows.append((table, line))
    need(table is None and rows, 'complete-saved-rules')
    return {'rows': rows, 'generatedTimeLines': times, 'chainCounters': counters}

def expected_rules():
    tag=['-m','comment','--comment',TAG]
    values=[]
    for family in (4,6):
        values.append((family,'filter',tuple(['-A','INPUT','!','-i','lo','-p','tcp','-m','tcp','--dport','3100','-m','addrtype','--dst-type','LOCAL',*tag,'-j','REJECT','--reject-with','tcp-reset'])))
    for address in ('172.17.0.1','172.18.0.1','172.19.0.1','192.168.0.173'):
        values.append((4,'filter',tuple(['-A','DOCKER-USER','-p','tcp','-m','tcp','-m','conntrack','--ctorigdst',address,'--ctorigdstport','3100','--ctdir','ORIGINAL',*tag,'-j','REJECT','--reject-with','tcp-reset'])))
    return values

def selected(root,manifest,name):
    need(name in manifest,'selected-evidence-present');value=regular(root/name)
    need(sha(value)==manifest[name],'selected-evidence-byte-seal');return value

def read_command(args,label,limit=64*1024**2):
    global SERIAL
    allowed=(args==['docker','ps','-aq','--no-trunc'] or args[:2]==['docker','inspect'] or args==['docker','network','ls','--no-trunc','--format','{{json .}}'] or args[:3]==['docker','network','inspect'] or args in (['iptables-save'],['ip6tables-save']))
    need(allowed,'only-explicit-runtime-read-command');SERIAL+=1
    r=subprocess.run(args,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=45,cwd=ROOT)
    private('%03d-%s.stdout.private'%(SERIAL,label),r.stdout);private('%03d-%s.stderr.private'%(SERIAL,label),r.stderr)
    need(r.returncode==0 and len(r.stdout)<=limit,'bounded-runtime-read-success');return r.stdout

def configuration(raw):
    return {r['Id']:{'image':r['Image'],'Config':r['Config'],'HostConfig':r['HostConfig'],'Mounts':r['Mounts']}for r in raw}

def lifecycle(raw):
    return {r['Id']:{'running':r['State']['Running'],'started':r['State']['StartedAt'],'oom':r['State']['OOMKilled'],'restarts':r['RestartCount']}for r in raw}

def snapshot_runtime(label):
    ids=read_command(['docker','ps','-aq','--no-trunc'],label+'-ids').decode().split()
    need(len(ids)==len(set(ids))==46 and all(re.fullmatch('[a-f0-9]{64}',v)for v in ids),'current-46-real-container-identities')
    raw=json.loads(read_command(['docker','inspect',*ids],label+'-runtime'))
    need(type(raw)is list and len(raw)==46 and {r['Id']for r in raw}==set(ids),'complete-current46-inspects')
    target=[r for r in raw if (r['Config'].get('Labels')or{}).get('com.docker.compose.project')=='rr-portal'and(r['Config'].get('Labels')or{}).get('com.docker.compose.service')=='printlink']
    need(len(target)==1,'unique-current-printlink');t=target[0]
    need(t['Id']==EXPECTED_TARGET_ID and t['Image']==EXPECTED_TARGET_IMAGE and t['State']['Running']is EXPECTED_TARGET_RUNNING and sha(enc(configuration([t])[t['Id']]))==EXPECTED_TARGET_CONTRACT_SHA,'actual-diagnostic-target-contract-and-running-state')
    nets=[json.loads(line)for line in read_command(['docker','network','ls','--no-trunc','--format','{{json .}}'],label+'-network-ids').decode().splitlines()]
    need(len(nets)==5 and len({n['ID']for n in nets})==5 and all(re.fullmatch('[a-f0-9]{64}',n['ID'])for n in nets),'current-five-network-identities')
    networks=json.loads(read_command(['docker','network','inspect',*[n['ID']for n in nets]],label+'-networks'))
    need(len(networks)==5 and {n['Id']for n in networks}=={n['ID']for n in nets},'complete-current-five-networks')
    private(label+'-raw-runtime.private.json',raw);private(label+'-raw-networks.private.json',networks)
    return raw,sorted(networks,key=lambda n:n['Id'])

def snapshot_rules(label):
    return {family:parse_save(read_command([tool],label+'-ipv'+str(family)))['rows']for family,tool in ((4,'iptables-save'),(6,'ip6tables-save'))}

def check_delete(args,label):
    global SERIAL
    need(args[0]in{'iptables','ip6tables'}and args[1:6]==['-w','30','-t','filter','-D'],'only-exact-owned-filter-deletion')
    family=4 if args[0]=='iptables'else 6;tokens=('-A',*args[6:]);need(('filter',canonical_owned(tokens))in{(table,t)for f,table,t in expected_rules()if f==family},'deletion-is-one-of-exact-six-owned-rules')
    # A check failure or ambiguous timeout ends this one attempt. No retry,
    # flush, positional deletion, insertion or lifecycle fallback exists.
    for action in ('-C','-D'):
        command=[*args[:5],action,*args[6:]];SERIAL+=1
        with (OUT/('%03d-%s-%s.private.log'%(SERIAL,label,action[1:]))).open('xb')as log:
            r=subprocess.run(command,stdout=log,stderr=subprocess.STDOUT,timeout=45,cwd=ROOT)
        need(r.returncode==0,'one-exact-owned-rule-'+action[1:]+'-succeeded')

def seal_output(result):
    private('first-result.json',result)
    manifest={str(p.relative_to(OUT)):filehash(p)for p in OUT.rglob('*')if p.is_file()}
    private('manifest.json',manifest)
    print(enc(dict(result,manifestSHA256Nibbles=nibbles(filehash(OUT/'manifest.json')),resultSHA256Nibbles=nibbles(filehash(OUT/'first-result.json')))).decode(),flush=True)

def load_release():
    for name,digest in DEPS.items():
        path=pathlib.Path(__file__).with_name(name)
        need(pin(digest)and path.is_file()and not path.is_symlink()and sha(path.read_bytes())==digest,'all-exact-reviewed-recovery-dependencies')
    path=pathlib.Path(__file__).with_name('pr1008-03-release-library.py');spec=importlib.util.spec_from_file_location('inert_original_release',path);release=importlib.util.module_from_spec(spec);spec.loader.exec_module(release)
    need(release.PHASE==release.TARGET==release.TREE=='' and release.DEPS=={k:v for k,v in DEPS.items()if k not in {'pr1008-03-release-library.py','pr1008-03-reviewed-files.json'}},'inert-original-release-and-only-reviewed-dependencies')
    release.TARGET=TARGET;release.TREE=TREE;release.BACKUP_MANIFEST=B_MANIFEST;release.BACKUP_RESULT=B_RESULT;release.OUT=OUT;release.initialize();release.EXPECTED_ENV=regular(BACKUP/'environment.private')
    return release

def network_map(values):
    need(type(values)is list and len(values)==5 and len({v['Id']for v in values})==5,'five-unique-recorded-networks')
    return {v['Id']:v for v in values}

def network_state(reference,observed,target_id,require_target):
    before,after=network_map(reference),network_map(observed);need(set(before)==set(after),'all-five-original-network-identities-preserved');address=None;peers=0
    for identity in before:
        a,b=copy.deepcopy(before[identity]),copy.deepcopy(after[identity]);old=a.pop('Containers',{})or{};new=b.pop('Containers',{})or{};old.pop(target_id,None);own=new.pop(target_id,None)
        need(exact(a,b),'network-configuration-exact-for-authenticated-running-or-stopped-state');need(exact(old,new),'all-other-network-endpoints-byte-identical')
        if before[identity]['Name']=='rr-portal_platform-net':
            peers=len(old);need(peers==43,'all43-other-platform-endpoints-retained')
            if own is not None:
                need(require_target and not own.get('IPv6Address'),'one-restored-ipv4-only-original-target-endpoint');value=ipaddress.ip_interface(own['IPv4Address']);need(value.version==4 and value.network==ipaddress.ip_network('172.18.0.0/16'),'restored-target-ip-in-original-subnet');address=str(value.ip)
        else:need(own is None,'no-target-endpoint-in-other-networks')
    need((address is not None)is require_target,'only-authenticated-original-target-endpoint-presence');return address

def changed_network_fields(before,after):
    names={'IPAM','Status','Config','Options','Subnets','Subnet','Gateway','IPRange','AuxiliaryAddresses','IPsInUse','DynamicIPsAvailable','NumEndpoints','Containers','Name','Id','Driver','Scope','EnableIPv6','Internal','Attachable','Ingress','ConfigOnly','ConfigFrom','Labels','Created','Peers','Services'};out=[]
    def visit(a,b,path):
        if exact(a,b):return
        if type(a)is dict and type(b)is dict:
            for key in sorted(set(a)|set(b)):visit(a.get(key),b.get(key),path+[key if key in names else '<redacted-key>'])
        elif type(a)is list and type(b)is list:
            for index in range(max(len(a),len(b))):visit(a[index]if index<len(a)else None,b[index]if index<len(b)else None,path+[index])
        else:
            row={'path':path,'beforeType':type(a).__name__,'afterType':type(b).__name__}
            if type(a)is int and type(b)is int and 0<=a<=100000000 and 0<=b<=100000000:row.update(beforeCount=a,afterCount=b)
            out.append(row)
    left,right=network_map(before),network_map(after)
    for index,nid in enumerate(sorted(left)):
        a,b=copy.deepcopy(left[nid]),copy.deepcopy(right[nid]);a.pop('Containers',None);b.pop('Containers',None);visit(a,b,['network',index])
    return out

def held_rules(observed,expected_non_target,profile,own_docker_kinds,address,release):
    clean={};counts={}
    for family in (4,6):
        clean[family],found=own_partition(observed[family],expected_rules(),family);counts[family]=len(found)
    need(counts=={4:5,6:1},'all-six-exact-owned-publication-rules-still-installed')
    rest,matched=release.G.strip_docker(clean[4],profile,address,own_docker_kinds)
    need(exact(rest,expected_non_target[4])and exact(clean[6],expected_non_target[6]),'all-foreign-rules-preserved-through-only-old-container-start')
    return clean

def main():
    global EXPECTED_TARGET_ID,EXPECTED_TARGET_IMAGE,EXPECTED_TARGET_CONTRACT_SHA,EXPECTED_TARGET_RUNNING
    need(PIN is True and sys.argv[1:]==['cleanup-publication']and os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_ATTEMPT')=='1','inert-until-root-bound-one-attempt')
    need(all(pin(v)for v in (READER_MANIFEST,READER_RESULT)),'actual-reader-seals-required')
    os.umask(0o077);OUT.mkdir(mode=0o700)
    result={'mode':'publication-cleanup','base':BASE,'target':TARGET,'tree':TREE,'success':False,'removedRuleCount':0,'ownRulesAbsent':False,'originalContainerStartPerformed':False,'candidateContainerStarted':False,'businessWritesPerformed':False,'databaseRestorePerformed':False,'environmentConfigurationChanged':False,'sourceConfigurationChanged':False,'modelCallsPerformed':False,'authenticatedBusinessWritesPerformed':False,'secretOrRowsPrinted':False}
    try:
        dm,dr=sealed(D,D_MANIFEST,D_RESULT,True);bm,br=sealed(BACKUP,B_MANIFEST,B_RESULT,False);rm,rr=sealed(READER,READER_MANIFEST,READER_RESULT,True)
        need(dr.get('success')is False and dr.get('mode')=='deploy'and dr.get('target')==TARGET and br.get('success')is True and br.get('mode')=='backup'and br.get('target')==BASE and rr.get('success')is True and rr.get('mode')=='deploy-failure-read'and rr.get('target')==TARGET,'actual-failed-deploy-successful-reader-and-original-backup')
        safe=rr.get('currentPrintlink',{})
        need(all(safe.get(key)is True for key in ('sameOriginalContainerID','sameOriginalImage','sameConfig','sameEnvironment','sameMounts','sameHostConfig','published3100BindingUnchanged'))and safe.get('running')is False and safe.get('oomKilled')is False and safe.get('matchesPreparedCandidateImage')is False,'sealed-reader-proves-original-stopped-unchanged-printlink')
        reader_raw=json.loads(selected(READER,rm,'current-runtime-inspects.private.json'));targets=[row for row in reader_raw if(row['Config'].get('Labels')or{}).get('com.docker.compose.project')=='rr-portal'and(row['Config'].get('Labels')or{}).get('com.docker.compose.service')=='printlink']
        need(len(targets)==1,'one-sealed-reader-printlink');target=targets[0];original_target=json.loads(selected(BACKUP,bm,'target-inspect.private.json'))['printlink']
        need(target['Id']==original_target['Id']and target['Image']==original_target['Image']==ORIGINAL_IMAGE and target['State']['Running']is False and exact(configuration([target]),configuration([original_target])),'sealed-raw-reader-stopped-target-equals-original-image-and-contract')
        EXPECTED_TARGET_ID=target['Id'];EXPECTED_TARGET_IMAGE=target['Image'];EXPECTED_TARGET_CONTRACT_SHA=sha(enc(configuration([target])[target['Id']]));EXPECTED_TARGET_RUNNING=False
        reservation=json.loads(selected(D,dm,'ingress-install-reservation.private.json'))
        need(reservation.get('profileSHA256')=='c0c279e91c9b55a119e3755801964d3f586752999d3df6a260ac4697dd018e0e'and exact(reservation.get('exactRules'),json.loads(enc(expected_rules()))),'exact-failed-deployment-six-rule-install-reservation')
        original={family:parse_save(selected(BACKUP,bm,'ingress-'+name+'.stdout.private'))['rows']for family,name in ((4,'ipv4FilterAndNat'),(6,'ipv6FilterAndNat'))}
        original_networks=json.loads(selected(BACKUP,bm,'ingress-all-docker-networks.private.json'));last_names=sorted(n for n in dm if re.fullmatch('ingress-[0-9]{3}-all-networks.private.json',n));need(last_names,'sealed-stopped-network-capture-present');stopped_networks=json.loads(selected(D,dm,last_names[-1]));result['authenticatedStoppedNetworkDifferences']=changed_network_fields(original_networks,stopped_networks)
        info=json.loads(selected(BACKUP,bm,'ingress-dockerInfo.stdout.private'));version=info.get('ServerVersion');need(type(version)is str and re.fullmatch('[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}(?:[-+.][A-Za-z0-9.-]{1,32})?',version)is not None,'safe-authenticated-docker-version');result['authenticatedDockerServerVersion']=version
        release=load_release();baseline=release.baseline();release.configuration(baseline);release.compose_contract(baseline);before,net_before=snapshot_runtime('before');need(exact(configuration(before),configuration(reader_raw))and exact(lifecycle(before),lifecycle(reader_raw)),'current46-still-matches-sealed-stopped-diagnostic');network_state(stopped_networks,net_before,EXPECTED_TARGET_ID,False)
        observed=snapshot_rules('before');initial_plan=plan_cleanup(reservation['exactRules'],original,observed);need(initial_plan['expectedRemovedCount']==6,'exact-six-live-owned-rules-before-original-start')
        profile=json.loads(regular(pathlib.Path(__file__).with_name('pr1008-02-publication-ingress-profile.json')));_,docker_kinds=release.G.strip_docker(original[4],profile,profile['originalTargetIP']);non_target={4:release.G.strip_docker(initial_plan['expectedAfterRows'][4],profile,None,docker_kinds)[0],6:initial_plan['expectedAfterRows'][6]}
        before_runtime,oldraw=release.B.runtime(False);need(oldraw['printlink']['Id']==EXPECTED_TARGET_ID and oldraw['printlink']['State']['Running']is False,'only-original-current-writer-stopped')
        held_rules(observed,non_target,profile,docker_kinds,None,release);closed,closed_path=release.B.capture('printlink','emergency-closed-before');release.private('printlink-emergency-closed-raw.private.json',closed);release.replay_snapshot('printlink',closed,closed_path);need(release.B.runtime(False)[0]==before_runtime,'all46-stable-through-fresh-closed-evidence');held_rules(snapshot_rules('closed-before-start'),non_target,profile,docker_kinds,None,release)
        private('one-original-container-start-reservation.private.json',{'originalID':EXPECTED_TARGET_ID,'originalImage':ORIGINAL_IMAGE,'freshClosedDataCapturedAndReplayed':True})
        release.operation(['docker','start',EXPECTED_TARGET_ID],'emergency-start-only-original-printlink',80);result['originalContainerStartPerformed']=True;EXPECTED_TARGET_RUNNING=True
        release.maintenance('wait_service_ready','printlink');now,newraw=release.B.runtime();raw=newraw['printlink'];release.unchanged_except(before_runtime,now,'printlink');literal=release.envs();release.full_contract('printlink',original_target,raw,ORIGINAL_IMAGE,literal,release.COMPOSE,BASE,allow_same=True)
        need(release.proof('printlink',ORIGINAL_IMAGE,raw['Id'],BASE)==baseline['sourceProof']['printlink']['files'],'recovered-exact-original-source');result.update(originalContainerRecoveredHealthy=True,onlyOriginalPrintlinkContainerStarted=True,oldSourceVerified=True)
        after,net_after=snapshot_runtime('after-start');need(exact(configuration(before),configuration(after)),'current46-configuration-environment-mounts-preserved');result['current46ConfigurationPreserved']=True
        address=network_state(original_networks,net_after,EXPECTED_TARGET_ID,True);held_rules(snapshot_rules('after-start'),non_target,profile,docker_kinds,address,release);result['allOtherNetworkEndpointsPreserved']=True
        post,post_path=release.B.capture('printlink','emergency-after-recovery');release.private('printlink-emergency-after-raw.private.json',post);release.replay_snapshot('printlink',post,post_path);comparison=release.same_data('printlink',closed,post,closed_path,post_path,raw['State']['StartedAt']);private('fresh-closed-data-proof.private.json',comparison);result['freshClosedDataPreserved']=True
        release.configuration(baseline);release.compose_contract(baseline);release.cleared_flags(baseline);private('old-loopback-public.private.json',release.public('printlink',baseline['sourceProof']['printlink']['files']));result['readonlyLoopbackPublicChecksPerformed']=True;need(release.B.runtime()[0]==now,'all46-stable-through-old-loopback-checks')
        recovered=snapshot_rules('ready-to-reopen');held_rules(recovered,non_target,profile,docker_kinds,address,release);plan=plan_cleanup(reservation['exactRules'],original,recovered);private('exact-observed-cleanup-plan.private.json',plan);private('cleanup-one-attempt-reservation.private.json',{'readerManifestSHA256':READER_MANIFEST,'readerResultSHA256':READER_RESULT,'rules':plan['commands'],'oldContainerRecoveredAndStrictFreshClosedProofPassed':True})
        for index,args in enumerate(plan['commands']):
            current=snapshot_rules('predelete-%02d'%index);current_plan=plan_cleanup(reservation['exactRules'],original,current);need(exact(current_plan['expectedAfterRows'],plan['expectedAfterRows'])and args in current_plan['commands'],'only-current-exact-owned-subset-and-foreign-rules-stable');check_delete(args,'remove-%02d'%index);result['removedRuleCount']+=1
        final=snapshot_rules('after');verify_after(plan,final);result.update(ownRulesAbsent=True,foreignFirewallRowsPreserved=True,onlyExactOwnedPublicationRulesRemoved=True,success=True)
    except BaseException as error:
        result.update(safeFailureStage=STAGE,safeExceptionType=type(error).__name__);private('failure.private.txt',traceback.format_exc().encode())
    finally:seal_output(result)
    return 0 if result['success']else 1

if __name__=='__main__':
    try:sys.exit(main())
    except SystemExit:raise
    except BaseException:print(enc({'mode':'publication-cleanup','success':False,'safeFailure':'PUBLICATION_CLEANUP_PREFLIGHT_OR_OUTPUT_FAILURE','runtimeAndOwnRuleStateRequireReadOnlyVerification':True}).decode(),flush=True);sys.exit(1)
