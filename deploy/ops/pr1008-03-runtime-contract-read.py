"""INERT selected-metadata and current-runtime contract diagnosis only.
PIN False prevents execution. No driver import, business SQLite/tar read,
container lifecycle, firewall, HTTP, configuration or authenticated write.
"""
import copy,hashlib,json,os,pathlib,re,stat,subprocess,sys,traceback
ROOT=pathlib.Path('/opt/rr-portal')
BACKUP=ROOT/'deploy/backups/pr-1008-20261026-02-backup'
REOPEN=ROOT/'deploy/backups/pr-1008-20261026-03-reopen-original'
OUT=ROOT/'deploy/backups/pr-1008-20261026-03-runtime-contract-read'
BASE='37b6146354f692dfabc8b009f6c5b80ced091bdb'
TARGET='bb1fab660bdf4e04e828e4c4250279f717603ac5'
TREE='72baeafdefab7f2abf01be09f941f31ec8b623fa'
BRANCH='refs/heads/ops/pr-1008-20261026-02'
B_MANIFEST='2a53e7953a986050fc8c786cc5f4baa758926eb2821233436ec9182c169aec15'
B_RESULT='8863f1ccf2101e03075d9029aafca1bebbff638542080708ea9b162bdec8454b'
REOPEN_MANIFEST='2732f3808b22b491bf71185c1087e5193bdcc18569015e36695cd38c7f052def'
REOPEN_RESULT='45154e67d864adc4483927ea6189fb7bb56f6dbf40c0903cdb7c59a80b30c811'
ORIGINAL_IMAGE='sha256:5d48e2e4e4557988e56fb3e27d28c38eab98410244783e31d169466b0fb476f4'
PIN=False
DEPS={}
STAGE='entrypoint';SERIAL=0
def need(v, label):
    global STAGE
    if not v:
        STAGE = label
        raise RuntimeError('PUBLICATION_CLEANUP_REJECTED')

def pin(v):
    return type(v) is str and re.fullmatch('[a-f0-9]{64}', v) is not None

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

def selected(root, manifest, name):
    need(name in manifest, 'selected-evidence-present')
    value = regular(root / name)
    need(sha(value) == manifest[name], 'selected-evidence-byte-seal')
    return value

def seal_output(result):
    private('first-result.json', result)
    manifest = {str(p.relative_to(OUT)): filehash(p) for p in OUT.rglob('*') if p.is_file()}
    private('manifest.json', manifest)
    print(enc(dict(result, manifestSHA256Nibbles=nibbles(filehash(OUT / 'manifest.json')), resultSHA256Nibbles=nibbles(filehash(OUT / 'first-result.json')))).decode(), flush=True)

def exact(a,b):return type(a)is type(b)and enc(a)==enc(b)

def environment(values):
    need(type(values)is list and all(type(v)is str and '='in v for v in values),'typed-environment-entry-array');pairs=[v.split('=',1)for v in values];need(len({key for key,_ in pairs})==len(pairs),'no-duplicate-environment-keys');return dict(pairs)

def safe_key(value):return value if type(value)is str and re.fullmatch('[A-Za-z_][A-Za-z0-9_.:-]{0,127}',value)is not None else '<redacted-key>'

def difference_keys(a,b):
    keys=sorted(safe_key(key)for key in set(a)|set(b)if key not in a or key not in b or not exact(a[key],b[key]));return {'keys':keys[:128],'totalCount':len(keys),'truncated':len(keys)>128}

def command(args,label,optional=False):
    global SERIAL
    allowed=args==['docker','ps','-aq','--no-trunc']or(args[:2]==['docker','inspect']and all(re.fullmatch('[a-f0-9]{64}',x)for x in args[2:]))or(len(args)==5 and args[:2]==['docker','exec']and re.fullmatch('[a-f0-9]{64}',args[2])is not None and args[3:]==['cat','/proc/1/environ'])
    need(allowed,'only-current-docker-inventory-inspect-and-pid1-read');SERIAL+=1;r=subprocess.run(args,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=30,cwd=ROOT);private('%03d-%s.stdout.private'%(SERIAL,label),r.stdout);private('%03d-%s.stderr.private'%(SERIAL,label),r.stderr);need(len(r.stdout)<=64*1024**2 and len(r.stderr)<=1024**2,'bounded-runtime-read-output')
    if optional:return r.returncode,r.stdout
    need(r.returncode==0,'required-runtime-read-succeeded');return r.stdout

def reviewed_host_config(a,b):
    if type(a)is not dict or type(b)is not dict:return False
    old,new=copy.deepcopy(a),copy.deepcopy(b)
    for key in ('Dns','DnsOptions','DnsSearch'):
        if key in old and key in new and(old[key]is None or type(old[key])is list and not old[key])and(new[key]is None or type(new[key])is list and not new[key]):old[key]=new[key]=None
    if 'OomKillDisable'in old and 'OomKillDisable'in new and(old['OomKillDisable']is None or old['OomKillDisable']is False)and(new['OomKillDisable']is None or new['OomKillDisable']is False):old['OomKillDisable']=new['OomKillDisable']=False
    return exact(old,new)

def runtime_row(r):
    return {'id':r['Id'],'image':r['Image'],'started':r['State'].get('StartedAt'),'running':r['State']['Running'],'oom':r['State']['OOMKilled'],'restarts':r['RestartCount'],'health':r['State'].get('Health',{}).get('Status'),'environmentMapSHA256':sha(enc(environment(r['Config']['Env']))),'mounts':sorted(r['Mounts'],key=enc),'configSHA256':sha(enc(dict(r['Config'],Env=sorted(r['Config']['Env'])))),'hostConfigSHA256':sha(enc(r['HostConfig']))}

def predicates(old,current,literal,expected_pid1,pid1):
    same=current['Id']==old['Id'];old_config,new_config=copy.deepcopy(old['Config']),copy.deepcopy(current['Config']);old_labels=old_config.pop('Labels')or{};new_labels=new_config.pop('Labels')or{}
    original_hostname=old_config.pop('Hostname')==old['Id'][:12];current_hostname=new_config.pop('Hostname')==current['Id'][:12];old_config.pop('Image');new_config.pop('Image');old_config.pop('Env');new_config.pop('Env')
    p={'sameOriginalContainerID':same,'originalImmutableImageDigest':current['Image']==old['Image']==ORIGINAL_IMAGE,'configImageUnchanged':current['Config']['Image']==old['Config']['Image'],'restartCountUnchanged':current['RestartCount']==old['RestartCount'],'runningTrue':current['State']['Running']is True,'oomKilledFalse':current['State']['OOMKilled']is False,'healthHealthy':current['State'].get('Health',{}).get('Status')=='healthy','hostConfigRawExact':exact(old['HostConfig'],current['HostConfig']),'hostConfigReviewedNormalizationExact':reviewed_host_config(old['HostConfig'],current['HostConfig']),'mountsSortedExact':exact(sorted(old['Mounts'],key=enc),sorted(current['Mounts'],key=enc)),'originalAutomaticHostnameValid':original_hostname,'currentAutomaticHostnameValid':current_hostname,'remainingRuntimeConfigExact':exact(old_config,new_config),'configuredEnvironmentCompleteExact':exact(environment(current['Config']['Env']),literal),'pid1EnvironmentReadAvailable':pid1 is not None,'sameOriginalLabels':exact(old_labels,new_labels)}
    p['healthyImmutableRunningImageConjunction']=all(p[k]for k in ('sameOriginalContainerID','originalImmutableImageDigest','configImageUnchanged','restartCountUnchanged','runningTrue','oomKilledFalse','healthHealthy'));p['completeHostConfigMountsConjunction']=p['hostConfigReviewedNormalizationExact']and p['mountsSortedExact'];p['automaticHostnameConjunction']=original_hostname and current_hostname;p['completeRuntimeConfigLiteralEnvConjunction']=p['remainingRuntimeConfigExact']and p['configuredEnvironmentCompleteExact'];p['pid1AutomaticHostnameValid']=pid1 is not None and pid1.get('HOSTNAME')==current['Id'][:12]
    actual=None if pid1 is None else {key:value for key,value in pid1.items()if key!='HOSTNAME'};p['completeOriginalPid1EnvironmentExact']=actual is not None and p['pid1AutomaticHostnameValid']and exact(actual,expected_pid1);p['fullContractAllowSameOriginalImage']=all(p[k]for k in ('healthyImmutableRunningImageConjunction','completeHostConfigMountsConjunction','automaticHostnameConjunction','completeRuntimeConfigLiteralEnvConjunction','completeOriginalPid1EnvironmentExact','sameOriginalLabels'))
    changes={'hostConfigKeys':difference_keys(old['HostConfig'],current['HostConfig']),'remainingRuntimeConfigKeys':difference_keys(old_config,new_config),'configuredEnvKeys':difference_keys(literal,environment(current['Config']['Env'])),'pid1EnvKeys':{'available':False}if actual is None else dict(difference_keys(expected_pid1,actual),available=True)}
    auto=[];whitelist={'SHLVL':{'0','1','2'},'PWD':{'/app'},'_':{'/usr/local/bin/node','/usr/bin/node','node','/usr/local/bin/docker-entrypoint.sh','/usr/bin/env'}}
    if actual is not None:
        for key,allowed in whitelist.items():
            if key in expected_pid1 and key in actual and expected_pid1[key]!=actual[key]and expected_pid1[key]in allowed and actual[key]in allowed:auto.append({'key':key,'originalSafeValue':expected_pid1[key],'currentSafeValue':actual[key]})
    return p,changes,auto,actual

def current_differences(baseline,records,target,pid1):
    row=runtime_row(target);old=baseline['runtime']['targets']['printlink'];uncompared=['childEnvironmentContractSHA256']
    if pid1 is not None:row['processEnvironmentWithoutAutomaticHostnameSHA256']=sha(enc(pid1))
    else:uncompared.append('processEnvironmentWithoutAutomaticHostnameSHA256')
    target_keys=[key for key in row if key not in old or not exact(old[key],row[key])];others={r['Id']:r for r in records if r['Id']!=target['Id']};changes=[]
    for identity,r in others.items():
        service=(r['Config'].get('Labels')or{}).get('com.docker.compose.service');service=service if type(service)is str and re.fullmatch('[a-z0-9_-]{1,80}',service)is not None else '<unidentified-service>'
        fields=['id','containerIdentityInventory']if identity not in baseline['runtime']['others']else difference_keys(baseline['runtime']['others'][identity],runtime_row(r))['keys']
        if fields:changes.append({'service':service,'fields':fields})
    return {'targetComparedFieldDifferences':sorted(target_keys),'targetFieldsNotReadAndNotClaimedVerified':uncompared,'otherContainerChangedServiceFields':changes[:45],'originalOtherIdentitiesMissingCount':len(set(baseline['runtime']['others'])-set(others)),'currentOtherCount':len(others),'rawCIDImageConfigEnvironmentAndHashValuesPrinted':False}

def main():
    need(PIN is True and sys.argv[1:]==['read-runtime-contract']and os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_ATTEMPT')=='1','inert-until-root-bound-single-read-attempt');os.umask(0o077);OUT.mkdir(mode=0o700)
    result={'mode':'runtime-contract-read','base':BASE,'target':TARGET,'tree':TREE,'success':False,'businessWritesPerformed':False,'databaseRestorePerformed':False,'environmentConfigurationChanged':False,'sourceConfigurationChanged':False,'modelCallsPerformed':False,'authenticatedBusinessWritesPerformed':False,'secretOrRowsPrinted':False,'containerStartStopRecreatePerformed':False,'firewallChangesPerformed':False}
    try:
        bm,br=sealed(BACKUP,B_MANIFEST,B_RESULT,False);rm,rr=sealed(REOPEN,REOPEN_MANIFEST,REOPEN_RESULT,False);need(br.get('success')is True and br.get('mode')=='backup'and br.get('target')==BASE and rr.get('success')is True and rr.get('mode')=='original-reopen'and rr.get('target')==TARGET and rr.get('ownRulesAbsent')is True and rr.get('onlyExactOwnedPublicationRulesRemoved')is True and type(rr.get('removedRuleCount'))is int and rr['removedRuleCount']==6,'authenticated-original-backup-and-successful-network-reopen')
        baseline=json.loads(selected(BACKUP,bm,'baseline.private.json'));old=json.loads(selected(BACKUP,bm,'target-inspect.private.json'))['printlink'];literal=json.loads(selected(BACKUP,bm,'printlink-literal-configured-environment.private.json'));expected_pid1=json.loads(selected(BACKUP,bm,'printlink-literal-process-environment.private.json'));need(old['Image']==ORIGINAL_IMAGE and old['Id']==baseline['runtime']['targets']['printlink']['id']and all(type(v)is dict and all(type(k)is str and type(x)is str for k,x in v.items())for v in (literal,expected_pid1)),'selected-original-target-and-literal-environment-metadata');need(sha(enc(expected_pid1))==baseline['runtime']['targets']['printlink']['processEnvironmentWithoutAutomaticHostnameSHA256'],'original-pid1-literal-equals-original-runtime-hash')
        ids=command(['docker','ps','-aq','--no-trunc'],'current-ids').decode().split();need(len(ids)==len(set(ids))==46 and all(re.fullmatch('[a-f0-9]{64}',v)for v in ids),'current46-container-identities');records=json.loads(command(['docker','inspect',*ids],'current-runtime'));need(type(records)is list and len(records)==46 and {r['Id']for r in records}==set(ids),'complete-current46-runtime');targets=[r for r in records if(r['Config'].get('Labels')or{}).get('com.docker.compose.project')=='rr-portal'and(r['Config'].get('Labels')or{}).get('com.docker.compose.service')=='printlink'];need(len(targets)==1,'unique-current-printlink');current=targets[0];need(current['Id']==old['Id']and current['Image']==ORIGINAL_IMAGE,'diagnose-only-same-original-container-image')
        status,blob=command(['docker','exec',current['Id'],'cat','/proc/1/environ'],'current-pid1',optional=True);pid1=None
        if status==0 and len(blob)<=1024**2 and blob.endswith(b'\0'):
            try:pid1=environment([part.decode('utf-8')for part in blob.split(b'\0')if part])
            except(UnicodeError,RuntimeError):pid1=None
        p,changes,auto,actual=predicates(old,current,literal,expected_pid1,pid1);result.update(predicates=p,differenceKeyNames=changes,predefinedSafeAutomaticEnvironmentValues=auto,normalizedRuntimeDifferences=current_differences(baseline,records,current,actual),restartCounts={'original':old['RestartCount'],'current':current['RestartCount']},runtimeContractDiagnosticReadOnly=True,selectedMetadataOnly=True,businessArchiveReadAvoided=True,noDockerLifecycleCommands=True,noFirewallCommands=True,success=True)
    except BaseException as error:result.update(safeFailureStage=STAGE,safeExceptionType=type(error).__name__);private('failure.private.txt',traceback.format_exc().encode())
    finally:seal_output(result)
    return 0 if result['success']else 1

if __name__=='__main__':
    try:sys.exit(main())
    except SystemExit:raise
    except BaseException:print(enc({'mode':'runtime-contract-read','success':False,'safeFailure':'RUNTIME_CONTRACT_READ_PREFLIGHT_OR_OUTPUT_FAILURE','noLifecycleOrConfigurationChangeAttempted':True}).decode(),flush=True);sys.exit(1)
