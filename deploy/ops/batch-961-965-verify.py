"""False-gated seven-service observations, followed by an I/O-free comparison.

No login, POST, external AI request, deployment, maintenance write or data repair.
HTTP probes finish before database snapshots; their UTC windows remain private.
"""
import contextlib, datetime, hashlib, html.parser, importlib.util, io, json, os
import pathlib, re, signal, sqlite3, stat, subprocess, sys, tarfile, time
import urllib.error, urllib.parse, urllib.request

ROOT = pathlib.Path('/opt/rr-portal')
BASE = '9a62c7059600c12d4781b94f69098e37a32d901d'
TARGET = '4f1f64cac098caa6b202eb27cae9ab8fad9109dd'; TREE = 'f062e722bb9a16d51856e494f41a58d3e3670dd2'; VERIFY_PIN = True
BRANCH = 'refs/heads/ops/batch-961-965-20261020'
CORE_SHA = '4259dcbba7cbdc78809e286c3b20829644104e4a30b284bea84cc6b20f0c24b5'
SOURCE_MANIFEST_SHA = 'c6a2c4b7ea1e5866ed351d1fcef54f2d27f44d099e50879a95bfd535a38e2ab6'; EXPECTED_CHANGED_FILES = 83
COMPARATOR_SHA = '24358a17941d5ed2aa2d983c6f39e2066a1cccf932db59b214e2f688428f84db'
BACKUP = ROOT / 'deploy/backups/batch-961-965-20261020-backup'
DEPLOY = BACKUP.with_name('batch-961-965-20261020-deploy-06')
OUT = BACKUP.with_name('batch-961-965-20261020-verify-07')
BACKUP_MANIFEST = 'a18052ed05e4fea60d0073f71aa5a809f395739c89ce63eddf5dfc9ac0ef8924'; BACKUP_RESULT = '3928baa1a0e10249f22ef26e19d7a4a1be018aefa03b557bcb6c65cfc66aec3e'; DEPLOY_MANIFEST = '04203afb18be0a93be77b9aa61a9891f7405d376bcf2784927bc121df35ea5ff'; DEPLOY_RESULT = '448c5d875d3418343bb186835e903ecce152bbed9a31c23966b1943284c1779f'
ORDER = ('factory-review','factory-review-test','internal-quote','zuru-order-system','qc-plan-api','qc-plan-web','printlink')
ZURU_OLD_COMMAND = ['gunicorn','--bind','0.0.0.0:5005','--workers','2','--threads','4','--timeout','300','app:app']
ZURU_NEW_COMMAND = ['gunicorn','--bind','0.0.0.0:5005','--workers','1','--threads','4','--timeout','300','app:app']
AI_ADDITIONS = {'FACTORY_REVIEW_AI_ENABLED':'false','FACTORY_REVIEW_AI_API_KEY':'','FACTORY_REVIEW_AI_MODEL':'','FACTORY_REVIEW_AI_BASE_URL':'https://api.openai.com/v1'}
QC_DIAGNOSIS = BACKUP.with_name('batch-961-965-20261020-candidate-diagnosis-05-01')
QC_DIAGNOSIS_MANIFEST = '8133b4d8f4142f305012655affd653bc54f24196604acdd319a2ddba2de00458'
QC_DIAGNOSIS_RESULT = '71ce887c833b695a83da2dae4341e67b96b23c2f9abd4a05977d2d7b10214986'
QC_IMAGE = 'sha256:124e9738867f2ad7d4261bd8bfc5134863a5f5db8e7938e71eceefd7df128e24'
QC_VENDOR_PATCH = {'ASPNET_VERSION':{'old':'8.0.31','candidate':'8.0.32'},'DOTNET_VERSION':{'old':'8.0.31','candidate':'8.0.32'}}
IMAGE_PREPARATION = BACKUP.with_name('batch-961-965-20261020-build-preparation-01')
IMAGE_PREPARATION_MANIFEST = '975e3f215eab46c96aa435d2d343fda0f4e13ea32f240acb5c9f5ca1bf2acd30'
IMAGE_PREPARATION_RESULT = 'fc1e6666102206b731aac259326eb1e2bd0c1d93645097a987c94e43785ec51d'
SEALED_IMAGES = {
    'factory-review':'sha256:fec30b798833324d9dda79141e25f2ebfb790e202ac383c8c92346cfcdb8a01f',
    'factory-review-test':'sha256:76665e7c49a25992580e34a633550e13878197dc51b05dbd9791061d45e77d00',
    'internal-quote':'sha256:b80be2a626e5ee9fbd64530fa1429d04f550cec41c4790f25aa952e4790bd3da',
    'zuru-order-system':'sha256:46140168b2a10082ea6ac102a472411eaabd34e5164857523ba1618e336412fa',
    'qc-plan-api':QC_IMAGE,
    'qc-plan-web':'sha256:0c92225af88f5997114bc7c41aca7fa4584ea27091d19b76ec08c70aea9d2217',
    'printlink':'sha256:5d48e2e4e4557988e56fb3e27d28c38eab98410244783e31d169466b0fb476f4',
}
MAPPING_MODE_PINS = {
    'apps/业务部/ZURU接单表入单系统/data/country_map.json': {'relative':'country_map.json','beforeSHA256':'2de5a5af98594e4d626b7b83565f906d50d776a9229871fbba572a8133b22174','beforeBytes':26315,'mode':0o666},
    'apps/业务部/ZURU接单表入单系统/data/item_map.json': {'relative':'item_map.json','beforeSHA256':'e251ba63423890f9dfedf8706299ba7c21270ad439519ae0620ef03137700d90','beforeBytes':60903,'mode':0o666},
}
CORE = None; COMPARATOR = None; STAGE = 'entrypoint'; COUNTER = 0; OBSERVED = {}; LAST_GET = 0.0

def need(value):
    if not value: raise RuntimeError('BATCH_961_965_VERIFY_REJECTED')

def enc(value): return json.dumps(value,ensure_ascii=True,sort_keys=True,separators=(',',':'),allow_nan=False).encode()
def sha(value): return hashlib.sha256(value).hexdigest()
def utcnow(): return datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='microseconds').replace('+00:00','Z')

def timestamp(value):
    # Python 3.9 accepts only selected fractional widths. Normalize without
    # losing microseconds or accepting a missing timezone.
    need(type(value) is str and bool(re.fullmatch(r'\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}(?::?\d{2})?)',value)))
    normalized = re.sub(r'([+-]\d{2})$',r'\1:00',value.replace('Z','+00:00'))
    normalized = re.sub(r'([+-]\d{2})(\d{2})$',r'\1:\2',normalized)
    normalized = re.sub(r'(\.\d{1,6})(?=[+-]\d{2}:\d{2}$)',lambda match:match.group(1).ljust(7,'0'),normalized)
    parsed = datetime.datetime.fromisoformat(normalized)
    need(parsed.utcoffset() is not None)
    return parsed

def load_module(name, filename, checksum):
    path = pathlib.Path(__file__).with_name(filename)
    need(bool(re.fullmatch('[a-f0-9]{64}',checksum or '')) and path.is_file() and not path.is_symlink() and sha(path.read_bytes()) == checksum)
    spec = importlib.util.spec_from_file_location(name,path); module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    return module

def readonly_command(args):
    if type(args) is not list or not args or not all(type(value) is str for value in args): return False
    if args==['docker','ps','-aq','--no-trunc']: return True
    if args[:2]==['docker','inspect']: return len(args)>2 and all(re.fullmatch('[a-f0-9]{64}',value) for value in args[2:])
    if args[:3]==['docker','image','inspect']: return len(args)==4 and bool(re.fullmatch('sha256:[a-f0-9]{64}',args[3]))
    if args[:2]==['docker','exec'] and len(args)>3 and re.fullmatch('[a-f0-9]{64}',args[2]):
        rest=args[3:]
        if rest==['cat','/proc/1/environ']: return True
        if len(rest)>5 and rest[0:2]==['tar','-C'] and rest[2] in {'/app','/pb','/app/.next-build'} and rest[3:5]==['-cf','-']:
            return all(CORE.OPS.L.safe_path(name) and not name.startswith('-') for name in rest[5:])
        return False
    if args[0]=='git' and len(args)>1 and args[1] in {'rev-parse','symbolic-ref','diff','show','ls-tree'}:
        return not any(value.startswith(('--output=','--exec-path=','--config-env=')) for value in args[2:])
    return False

def run(args, data=None, timeout=180):
    """Every command's actual stdout is retained before callers inspect it."""
    global COUNTER
    COUNTER += 1
    need(readonly_command(args))
    output=OUT / ('%04d-stdout.private' % COUNTER)
    with (OUT / ('%04d-stderr.private' % COUNTER)).open('xb') as errors, output.open('xb') as stream:
        result = subprocess.run(args,input=data,stdout=stream,stderr=errors,timeout=timeout,cwd=ROOT)
        stream.flush(); os.fsync(stream.fileno())
    need(result.returncode == 0 and output.stat().st_size <= 128*1024**2)
    return output.read_bytes()

def archive(path, manifest_sha, result_sha):
    need(all(re.fullmatch('[a-f0-9]{64}',value or '') for value in (manifest_sha,result_sha)))
    need(path.is_dir() and not path.is_symlink() and stat.S_IMODE(path.stat().st_mode)==0o700)
    need(CORE.OPS.L.file_hash(path/'manifest.json')==manifest_sha and CORE.OPS.L.file_hash(path/'first-result.json')==result_sha)
    manifest=json.loads((path/'manifest.json').read_bytes()); entries=list(path.rglob('*'))
    need(len(entries)<=100000 and all(not p.is_symlink() and (p.is_file() or p.is_dir()) and p.stat().st_mode&0o077==0 for p in entries))
    need(set(manifest)=={str(p.relative_to(path)) for p in entries if p.is_file() and p!=path/'manifest.json'})
    need(all(CORE.OPS.L.safe_path(name) and re.fullmatch('[a-f0-9]{64}',checksum) and CORE.OPS.L.file_hash(path/name)==checksum for name,checksum in manifest.items()))
    result=json.loads((path/'first-result.json').read_bytes()); need(result.get('success') is True)
    return result

def originals():
    saved=archive(BACKUP,BACKUP_MANIFEST,BACKUP_RESULT)
    need(saved.get('base')==BASE and all(saved.get(name) is True for name in ('backupComplete','allSevenTargetServicesBound','allPersistentMountsCaptured','allOriginalFullTypedRowsAndSchemaCaptured','allRuntimeSourceProofsMatchBase','composeVersionAndLiteralRuntimeEnvironmentsProven','startupSafetyPassed')))
    before=json.loads((BACKUP/'baseline.private.json').read_bytes())
    deployed=archive(DEPLOY,DEPLOY_MANIFEST,DEPLOY_RESULT)
    need(before['head']==BASE and set(before['runtime']['targets'])==set(ORDER)==CORE.SERVICES and set(before['storage'])==set(CORE.STORAGE))
    need(deployed.get('base')==BASE and deployed.get('target')==TARGET and deployed.get('expectedTree')==TREE and deployed.get('allSevenTargetServicesUseSealedReviewedBuiltImages') is True and deployed.get('imageBuildsPerformedInThisRun') is False)
    preparation=archive(IMAGE_PREPARATION,IMAGE_PREPARATION_MANIFEST,IMAGE_PREPARATION_RESULT)
    need(preparation.get('mode')=='build-preparation-01' and preparation.get('observationsStableDuringPreparation') is True and preparation.get('maintenanceOrServiceSwitchesPerformed') is False and preparation.get('sourceEnvironmentOrModeWritesPerformed') is False and preparation.get('bothOriginalComposeBuildsCompleted') is True and preparation.get('allSevenCandidateGuardsRecordedWithoutServiceSwitch') is True)
    need(set(preparation['tags'])==set(ORDER) and {name:row['currentImageID'] for name,row in preparation['tags'].items()}==SEALED_IMAGES==deployed.get('reusedSealedImages'))
    return before,deployed

def qc_patch_facts(before,diagnosis,old_raw,old_image,candidate,literal):
    """Validate sealed facts; never infer a version range or drop metadata keys."""
    need(diagnosis.get('mode')=='candidate-diagnosis-05' and diagnosis.get('success') is True and diagnosis.get('observationsStableDuringDiagnosis') is True)
    phase_keys={'head','headMatchesReviewedTarget','allSevenOldContainerIDsAndConfigurationsUnchanged','allOtherContainersUnchanged','environmentBytesUnchanged','preexistingFourDirtyExactlyUnchanged','allMaintenanceFlagsUnchanged','all83SourceBytesAndModesIncludingTwoExact0666MapsMatchReviewedTarget'}
    for phase in ('beforeReadOnlyObservations','afterReadOnlyObservations'):
        facts=diagnosis[phase]; need(set(facts)==phase_keys and facts.get('head')==TARGET and all(value is True for key,value in facts.items() if key!='head'))
    row=diagnosis['tags']['qc-plan-api']; keys=set(QC_VENDOR_PATCH)
    need(row.get('currentImageID')==QC_IMAGE and row.get('oldRunningImageID')==old_raw['Image']==old_image['Id']==before['runtime']['targets']['qc-plan-api']['image'])
    need(row.get('currentImageIDBoundToSealedBuildEvidence') is True and row.get('candidateRawImageMetadataRetainedPrivately') is True and row.get('architectureClassification')=='amd64' and row.get('osClassification')=='linux' and row.get('hostReviewedSourceManifestSHA256')==SOURCE_MANIFEST_SHA)
    need(row.get('changedAllowedEnvironmentKeyNames')==sorted(keys) and row.get('totalChangedEnvironmentKeyCount')==2 and row.get('changedOtherEnvironmentKeyCount')==0 and row.get('publicRuntimeVersions')==QC_VENDOR_PATCH)
    guards=row['guards']; need(guards.get('candidateEnvironmentExactlyMatchesPreservedLiteralValues') is False and all(guards.get(key) is True for key in ('candidateCommandMatchesExactReviewedContract','candidateEntrypointExact','candidateWorkingDirectoryExact','candidateUserDefaultSerializationCompatible')))
    need(candidate['Id']==QC_IMAGE and candidate.get('Architecture')=='amd64' and candidate.get('Os')=='linux')
    old=CORE.envmap(old_raw['Config']['Env']); defaults=CORE.envmap(candidate['Config']['Env']); old_defaults=CORE.envmap(old_image['Config']['Env'])
    need(type(literal) is dict and all(type(key) is str and type(value) is str for key,value in literal.items()) and not keys&set(literal) and all(old.get(key)==value for key,value in literal.items()))
    proposed=dict(defaults,**literal)
    need({key for key in set(old)|set(proposed) if old.get(key)!=proposed.get(key)}==keys)
    for key,pin in QC_VENDOR_PATCH.items(): need(old.get(key)==old_defaults.get(key)==pin['old'] and defaults.get(key)==proposed.get(key)==pin['candidate'])
    need(sha(enc(old))==before['runtime']['targets']['qc-plan-api']['environmentMapSHA256'])
    return {'diagnosisManifestSHA256':QC_DIAGNOSIS_MANIFEST,'diagnosisResultSHA256':QC_DIAGNOSIS_RESULT,'candidateImageID':QC_IMAGE,'oldImageID':old_image['Id'],'publicMetadata':QC_VENDOR_PATCH,'oldEnvironmentSHA256':sha(enc(old)),'proposedEnvironmentSHA256':sha(enc(proposed)),'literalEnvironmentSHA256':sha(enc(literal)),'metadataAreVendorDefaultsWithoutLiteralOverrides':True,'allOtherLiteralAndInheritedEnvironmentValuesExact':True}

def qc_patch_evidence(before):
    diagnosis=archive(QC_DIAGNOSIS,QC_DIAGNOSIS_MANIFEST,QC_DIAGNOSIS_RESULT)
    read_json=lambda path:json.loads(CORE.stable_environment_bytes(path))
    return qc_patch_facts(before,diagnosis,read_json(BACKUP/'target-inspect.private.json')['qc-plan-api'],read_json(BACKUP/'qc-plan-api-image.private.json'),read_json(QC_DIAGNOSIS/'qc-plan-api-candidate-image.private.json'),read_json(BACKUP/'qc-plan-api-literal-compose-environment.private.json'))

def qc_patch_bound(before,observed):
    facts=observed.get('qcDotnetPatchEvidence',{}); old=observed['beforeEnvironment']['qc-plan-api']; new=observed['environment']['qc-plan-api']
    return facts.get('diagnosisManifestSHA256')==QC_DIAGNOSIS_MANIFEST and facts.get('diagnosisResultSHA256')==QC_DIAGNOSIS_RESULT and facts.get('candidateImageID')==QC_IMAGE==observed['runtime']['targets']['qc-plan-api'].get('image') and facts.get('oldImageID')==before['runtime']['targets']['qc-plan-api'].get('image') and facts.get('publicMetadata')==QC_VENDOR_PATCH and facts.get('oldEnvironmentSHA256')==sha(enc(old))==before['runtime']['targets']['qc-plan-api'].get('environmentMapSHA256') and facts.get('proposedEnvironmentSHA256')==sha(enc(new)) and facts.get('metadataAreVendorDefaultsWithoutLiteralOverrides') is True and facts.get('allOtherLiteralAndInheritedEnvironmentValuesExact') is True

def strict_environment_facts(before,observed):
    process=dict(observed['processEnvironment']['qc-plan-api']); process.pop('HOSTNAME',None)
    return {'qcPlanRawEnvironmentStrictlyIdentical':observed['environment']['qc-plan-api']==observed['beforeEnvironment']['qc-plan-api'],'qcPlanRawPID1EnvironmentStrictlyIdentical':sha(enc(process))==before['runtime']['targets']['qc-plan-api']['processEnvironmentWithoutAutomaticHostnameSHA256']}

def source_manifest():
    path=pathlib.Path(__file__).with_name('batch-reviewed-files.json')
    need(path.is_file() and not path.is_symlink() and sha(path.read_bytes())==SOURCE_MANIFEST_SHA)
    files=json.loads(path.read_bytes())
    need(type(files) is dict and len(files)==EXPECTED_CHANGED_FILES and 0<len(files)<=500)
    need(all(CORE.OPS.L.safe_path(name) and re.fullmatch('[a-f0-9]{64}',checksum) and (name in {'docker-compose.cloud.yml','.env.example'} or any(name.startswith(prefix+'/') for prefix in CORE.APP_PREFIXES)) for name,checksum in files.items()))
    return files

def canonical_source(before,files):
    mapping_rows=before['storage']['zuru-data']['files']
    need(not any(row['path']=='customer_country.json' for row in mapping_rows))
    for name,pin in MAPPING_MODE_PINS.items():
        original=[row for row in mapping_rows if row['path']==pin['relative']]
        need(name in files and len(original)==1 and original[0].get('directory') is False and original[0].get('mode')==pin['mode'] and original[0].get('sha256')==pin['beforeSHA256'] and original[0].get('bytes')==pin['beforeBytes'])
    CORE.BASE=TARGET
    config=CORE.source()
    need(run(['git','rev-parse',TARGET+'^{tree}']).decode().strip()==TREE)
    changed=run(['git','diff','--name-only','-z','--no-ext-diff','--no-textconv',BASE,TARGET]).decode().strip('\0').split('\0')
    need(set(changed)==set(files) and CORE.dirty_snapshot()==before['preexistingFourDirty'])
    need(CORE.OPS.L.file_hash(ROOT/'.env.cloud.production')==before['environmentSHA256'])
    for name,checksum in config.items(): need(checksum==(files[name] if name in files else before['configuration'][name]))
    for name,checksum in files.items():
        entry=run(['git','ls-tree','-z',TARGET,'--',name]).split(b'\t',1)
        need(len(entry)==2 and entry[1]==name.encode()+b'\0' and re.fullmatch(b'100(?:644|755) blob [a-f0-9]{40}',entry[0]))
        path=ROOT/name
        for ancestor in (path,*path.parents):
            if ancestor==ROOT: break
            need(not ancestor.is_symlink())
        mode=0o755 if entry[0].startswith(b'100755') else 0o644
        if name in MAPPING_MODE_PINS:
            need(mode==0o644); mode=MAPPING_MODE_PINS[name]['mode']
        need(path.is_file() and stat.S_IMODE(path.stat().st_mode)==mode and CORE.OPS.L.file_hash(path)==checksum)
    return config

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs): return None

def get(url):
    global LAST_GET
    parsed=urllib.parse.urlsplit(url)
    need(parsed.scheme=='http' and parsed.hostname=='127.0.0.1' and (parsed.port or 80) in {80,3100} and not parsed.username and not parsed.password and not parsed.fragment)
    need(parsed.path.startswith('/') and '..' not in urllib.parse.unquote(parsed.path).split('/'))
    # Stay below the existing shared Nginx 10 request/second API limiter.
    time.sleep(max(0.0,0.16-(time.monotonic()-LAST_GET))); LAST_GET=time.monotonic()
    started=utcnow(); status=0; body=b''
    request=urllib.request.Request(url,method='GET',headers={'Cache-Control':'no-cache','Accept-Encoding':'identity'})
    opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),NoRedirect())
    try:
        with opener.open(request,timeout=15) as response:
            status=response.status; body=response.read(16*1024**2+1)
    except urllib.error.HTTPError as error:
        status=error.code; body=error.read(16*1024**2+1)
    need(len(body)<=16*1024**2)
    name='http-%04d.private' % (len(OBSERVED.setdefault('http',[]))+1)
    CORE.OPS.L.private_write(OUT/name,body)
    row={'url':url,'status':status,'bytes':len(body),'sha256':sha(body),'startedUTC':started,'completedUTC':utcnow(),'bodyFile':name}
    OBSERVED['http'].append(row)
    return row

class StaticReferences(html.parser.HTMLParser):
    def __init__(self): super().__init__(); self.paths=[]
    def handle_starttag(self,tag,attrs):
        values=dict(attrs)
        if tag in {'script','link'}:
            value=values.get('src') if tag=='script' else values.get('href')
            if value: self.paths.append(value)

def public_observations(current):
    """Fixed GET probes only; no cookies, token, login, generation or business API."""
    checks=[]
    def probe(url,status=200,checksum=None):
        row=get(url); checks.append({'url':url,'expectedStatus':status,'actualStatus':row['status'],'expectedSHA256':checksum,'actualSHA256':row['sha256']})
        return row
    OBSERVED['publicAssetContainerFiles']={}
    for service in ('factory-review','factory-review-test'):
        base='http://127.0.0.1/'+service+'/'
        public=tar_members(run(['docker','exec',current['targets'][service]['id'],'tar','-C','/pb','-cf','-','pb_public']))
        need('pb_public/index.html' in public and 0<len(public)<=300)
        OBSERVED['publicAssetContainerFiles'][service]=public
        probe(base,checksum=public['pb_public/index.html']['sha256'])
        for name,fact in public.items():
            if name.startswith('pb_public/assets/'): probe(base+urllib.parse.quote(name[len('pb_public/'):],safe='/'),checksum=fact['sha256'])
        probe(base+'api/factory-review/health'); probe(base+'api/factory-review/analysis-ai/config',401)
    for url in ('http://127.0.0.1/internal-quote/health','http://127.0.0.1/zuru-order-system/health','http://127.0.0.1/qc-plan/api/health','http://127.0.0.1/qc-plan','http://127.0.0.1:3100/api/health'):
        probe(url)
    qc_page=next(row for row in OBSERVED['http'] if row['url']=='http://127.0.0.1/qc-plan')
    parser=StaticReferences(); parser.feed((OUT/qc_page['bodyFile']).read_text('utf8'))
    refs=sorted(set(value for value in parser.paths if urllib.parse.urlsplit(value).path.startswith('/qc-plan/_next/static/') and not urllib.parse.urlsplit(value).netloc))
    need(0<len(refs)<=100 and all(not urllib.parse.urlsplit(ref).scheme and not urllib.parse.urlsplit(ref).fragment for ref in refs))
    ref_files={ref:urllib.parse.unquote(urllib.parse.urlsplit(ref).path[len('/qc-plan/_next/'):]) for ref in refs}
    names=sorted(set(ref_files.values()))
    actual=CORE.container_files(current['targets']['qc-plan-web']['id'],'/app/.next-build',names)
    OBSERVED['publicAssetContainerFiles']['qc-plan-web']={name:{'sha256':sha(body),'bytes':len(body)} for name,body in actual.items()}
    for ref,name in ref_files.items(): probe('http://127.0.0.1'+ref,checksum=sha(actual[name]))
    for path in ('/api/auth/me','/api/quotes','/api/admin/users'):
        probe('http://127.0.0.1/internal-quote'+path,401)
    probe('http://127.0.0.1/qc-plan/api/schedule-imports',401)
    probe('http://127.0.0.1:3100/api/platform/authority',401)
    probe('http://127.0.0.1:3100/api/production/data',401)
    # These fixed public files expose new UI code without accessing business data.
    source_public=[(CORE.QUOTE,'frontend/quote.html','http://127.0.0.1/internal-quote/quote.html'),(CORE.QUOTE,'frontend/verification.html','http://127.0.0.1/internal-quote/verification.html'),(CORE.QUOTE,'frontend/department-batch-import.js','http://127.0.0.1/internal-quote/department-batch-import.js?v=20261020'),(CORE.QUOTE,'frontend/verification-transfer.js','http://127.0.0.1/internal-quote/verification-transfer.js?v=20261020-stream'),(CORE.PRINT,'cloud/public/authority.html','http://127.0.0.1:3100/authority'),(CORE.PRINT,'cloud/public/authority.js','http://127.0.0.1:3100/authority.js')]
    for prefix,name,url in source_public:
        probe(url,checksum=sha(run(['git','show',TARGET+':'+prefix+'/'+name])))
    return checks

def tar_members(blob,prefix='pb_public'):
    found={}; total=0
    with tarfile.open(fileobj=io.BytesIO(blob),mode='r:') as archive:
        for member in archive:
            name=member.name.rstrip('/')
            need(CORE.OPS.L.safe_path(name) and (name==prefix or name.startswith(prefix+'/')) and (member.isfile() or member.isdir()))
            if member.isdir(): continue
            total+=member.size
            need(name not in found and member.size<=32*1024**2 and total<=128*1024**2)
            body=archive.extractfile(member).read(); need(len(body)==member.size)
            found[name]={'sha256':sha(body),'bytes':len(body)}
    return found

def expected_sources(prefix,predicate):
    names=[name for name in CORE.git_files(prefix) if predicate(name[len(prefix)+1:])]
    need(names)
    return {name[len(prefix)+1:]:sha(run(['git','show',TARGET+':'+name])) for name in names}

def source_observations(current):
    """Raw command outputs are private before any document is interpreted."""
    result={}
    for service in ORDER:
        row=current['targets'][service]; cid=row['id']
        if service in {'factory-review','factory-review-test'}:
            expected=expected_sources(CORE.FACTORY,lambda name:name.startswith(('pb_hooks/','pb_migrations/')))
            actual=CORE.container_files(cid,'/pb',list(expected))
            images=json.loads(run(['docker','image','inspect',row['image']]))
            need(len(images)==1 and images[0]['Id']==row['image'])
            public=tar_members(run(['docker','exec',cid,'tar','-C','/pb','-cf','-','pb_public']))
            result[service]={'expected':expected,'actual':{name:sha(body) for name,body in actual.items()},'ociRevision':(images[0]['Config'].get('Labels') or {}).get('org.opencontainers.image.revision'),'publicFiles':public}
        elif service=='qc-plan-api':
            expected=expected_sources(CORE.QC,lambda name:name.startswith('server/QcInspection.Api/') and name.endswith('.cs') and '/obj/' not in name and '/bin/' not in name)
            actual=CORE.container_files(cid,'/app',['QcInspection.Api.dll','QcInspection.Api.pdb'])
            identifier,documents=CORE.PDB.pdb_documents(actual['QcInspection.Api.pdb'])
            result[service]={'expected':expected,'codeViewID':CORE.PDB.codeview_ids(actual['QcInspection.Api.dll']).hex(),'portablePdbID':identifier.hex(),'documents':documents,'dllSHA256':sha(actual['QcInspection.Api.dll']),'pdbSHA256':sha(actual['QcInspection.Api.pdb'])}
        else:
            predicates={'qc-plan-web':(CORE.QC,lambda n:n.startswith('app/') or n in {'package.json','pnpm-lock.yaml','pnpm-workspace.yaml','next.config.mjs','postcss.config.mjs','tailwind.config.ts','tsconfig.json','.eslintrc.json'}),'printlink':(CORE.PRINT,lambda n:n in {'package.json','start.mjs'} or (n.startswith(('cloud/','production/','ops/','shared/')) and not n.startswith('production/tests/'))),'internal-quote':(CORE.QUOTE,lambda n:(n.startswith('backend/') and not n.startswith(('backend/data/','backend/uploads/'))) or n.startswith('frontend/')),'zuru-order-system':(CORE.ZURU,lambda n:n in {'app.py','po_parser.py','requirements.txt'} or n.startswith(('templates/','static/')))}
            prefix,predicate=predicates[service]; expected=expected_sources(prefix,predicate); actual=CORE.container_files(cid,'/app',list(expected))
            result[service]={'expected':expected,'actual':{name:sha(body) for name,body in actual.items()}}
    return result

def readonly_mode_facts(directory):
    """Only closed private SQLite copies are opened here, never live databases."""
    facts={'factoryAI':{},'printlink':{}}
    for service in ('factory-review','factory-review-test'):
        with contextlib.closing(CORE.OPS.L.connect(directory/service/'sqlite/data.db',True)) as db:
            names={row[0] for row in db.execute("SELECT name FROM sqlite_schema WHERE type='table'")}
            facts['factoryAI'][service]={'usageTablePresent':'analysis_ai_usage' in names,'followupsTablePresent':'analysis_followups' in names,'usageRows':db.execute('SELECT COUNT(*) FROM analysis_ai_usage').fetchone()[0] if 'analysis_ai_usage' in names else None}
    with contextlib.closing(CORE.OPS.L.connect(directory/'printlink-runtime/sqlite/production.sqlite',True)) as db:
        names={row[0] for row in db.execute("SELECT name FROM sqlite_schema WHERE type='table'")}
        tables={name:db.execute('SELECT COUNT(*) FROM '+CORE.OPS.L.quote(name)).fetchone()[0] if name in names else None for name in ('authority_state','authority_commands','authority_backups')}
        state=None
        if 'authority_state' in names:
            row=db.execute('SELECT value FROM authority_state WHERE id=1').fetchone()
            if row is not None:
                try: state=json.loads(row[0])
                except ValueError: state='invalid-json'
        disabled=state is None or type(state) is dict and ('enabled' not in state or state['enabled'] is False)
        facts['printlink'].update(authorityTables=tables,authorityDisabled=disabled)
    with contextlib.closing(CORE.OPS.L.connect(directory/'printlink-runtime/sqlite/orders/printlink.sqlite',True)) as db:
        columns=[list(row) for row in db.execute('PRAGMA table_info(production_jobs)')]
        facts['printlink']['authorityRevisionColumn']=[row for row in columns if row[1]=='authority_revision']
        facts['printlink']['invalidRevisionRows']=db.execute("SELECT COUNT(*) FROM production_jobs WHERE typeof(authority_revision)<>'integer' OR authority_revision<0").fetchone()[0] if facts['printlink']['authorityRevisionColumn'] else None
    with contextlib.closing(CORE.OPS.L.connect(directory/'qc-plan-data/sqlite/qc-inspection.db',True)) as db:
        names={row[0] for row in db.execute("SELECT name FROM sqlite_schema WHERE type='table'")}
        facts['qcPlan']={'inspectionImportBatchesTablePresent':'InspectionImportBatches' in names,'seenRecordIdsColumn':[list(row) for row in db.execute('PRAGMA table_info(InspectionImportBatches)') if row[1]=='SeenRecordIdsJson']}
    return facts

def compare_source(proofs):
    checks={}
    for service in ORDER:
        proof=proofs[service]
        if service=='qc-plan-api':
            matched=set(); valid=proof['codeViewID']==proof['portablePdbID']
            for name,checksum in proof['expected'].items():
                found=[path for path,value in proof['documents'].items() if (path==name or path.endswith('/'+name)) and value==checksum]
                valid &= len(found)==1; matched.update(found)
            generated={'QcInspection.Api.GlobalUsings.g.cs','QcInspection.Api.AssemblyInfo.cs','.NETCoreApp,Version=v8.0.AssemblyAttributes.cs','QcInspection.Api.MvcApplicationPartsAssemblyInfo.cs'}
            valid &= all(any(path.endswith('/server/QcInspection.Api/obj/Release/net8.0/'+name) for name in generated) for path in set(proof['documents'])-matched)
        else:
            valid=proof['actual']==proof['expected']
            if service in {'factory-review','factory-review-test'}:
                valid &= proof['ociRevision']==TARGET and 'pb_public/index.html' in proof['publicFiles'] and any(name.startswith('pb_public/assets/') for name in proof['publicFiles'])
        checks[service+'ActualRuntimeSourceMatchesReviewedTarget']=bool(valid)
    return checks

def pure_checks(before,deployed,observed,data_comparison=None):
    """No filesystem, network, subprocess, SQLite, imports or mutations."""
    checks={'runtimeMatchesSealedDeployment':observed['runtime']==deployed['runtimeAfter'],'allOtherContainersUnchanged':observed['runtime']['others']==before['runtime']['others'],'runtimeStableDuringObservation':observed['runtimeFinal']==observed['runtime'],'persistentMountsUnchanged':observed['mounts']==before['storageMounts'],'maintenanceFlagsUnchanged':observed['maintenance']==before['maintenanceInventory'],'privateEnvironmentBytesUnchanged':observed['environmentSHA256']==before['environmentSHA256']}
    checks.update(compare_source(observed['sourceProof']))
    checks['allSevenRuntimeImagesMatchExactSealedReviewedCandidates']=deployed.get('reusedSealedImages')==SEALED_IMAGES and {name:observed['runtime']['targets'][name].get('image') for name in ORDER}==SEALED_IMAGES
    checks['factoryPublicAssetsMatchFinalContainerBytes']=all(observed['publicAssetContainerFiles'][name]==observed['sourceProof'][name]['publicFiles'] for name in ('factory-review','factory-review-test'))
    checks['allGETObservationUTCWindowsValid']=bool(observed.get('http')) and all(timestamp(row['startedUTC'])<=timestamp(row['completedUTC']) for row in observed['http'])
    checks['allGETHealthAndAnonymousBoundariesPassed']=all(row['actualStatus']==row['expectedStatus'] and (row['expectedSHA256'] is None or row['actualSHA256']==row['expectedSHA256']) for row in observed['httpChecks'])
    checks['qcPlanExactVendorPatchBoundToSealedDiagnosis']=qc_patch_bound(before,observed)
    for service in ORDER:
        old=before['runtime']['targets'][service]; new=observed['runtime']['targets'][service]
        expected=dict(observed['beforeEnvironment'][service])
        if service in {'factory-review','factory-review-test'}: expected.update(AI_ADDITIONS)
        process=dict(observed['processEnvironment'][service]); hostname=process.pop('HOSTNAME',None)
        if service in {'factory-review','factory-review-test'}:
            ai_off=all(process.pop(key,None)==value for key,value in AI_ADDITIONS.items())
            checks[service+'AIExplicitlyOffWithoutKeyOrModel']=ai_off
        metadata_exact=True
        if service=='qc-plan-api':
            metadata_exact=all(expected.get(key)==pin['old'] and process.get(key)==pin['candidate'] for key,pin in QC_VENDOR_PATCH.items())
            expected.update({key:pin['candidate'] for key,pin in QC_VENDOR_PATCH.items()})
            if metadata_exact:
                for key,pin in QC_VENDOR_PATCH.items(): process[key]=pin['old']
            checks['qcPlanPID1ExactNewVendorPairReplacedWithKnownOldPairForHash']=metadata_exact
        command_ok=(old['command']==ZURU_OLD_COMMAND and new['command']==ZURU_NEW_COMMAND) if service=='zuru-order-system' else old['command']==new['command']
        label=service+('BusinessEnvironmentAndRuntimeConfigurationPreservedWithExactVendorPatch' if service=='qc-plan-api' else 'EnvironmentAndRuntimeConfigurationPreserved')
        checks[label]=metadata_exact and observed['environment'][service]==expected and hostname==new['id'][:12] and sha(enc(process))==old['processEnvironmentWithoutAutomaticHostnameSHA256'] and command_ok and all(old[key]==new[key] for key in ('mounts','memory','swap','healthcheck','entrypoint','user','workingDirectory'))
    modes=observed['modes']; p=modes['printlink']; columns=p['authorityRevisionColumn']
    checks['printlinkAuthorityRemainsOffWithNoCommands']=p['authorityDisabled'] is True and all(value==0 for value in p['authorityTables'].values()) and set(p['authorityTables'])=={'authority_state','authority_commands','authority_backups'}
    checks['printlinkTaskRevisionSchemaInstalled']=len(columns)==1 and columns[0][2:]==['INTEGER',1,'0',0] and p['invalidRevisionRows']==0
    checks['factoryAIUsageAndFollowupSchemasInstalledWithoutSending']=set(modes['factoryAI'])=={'factory-review','factory-review-test'} and all(value['usageTablePresent'] and value['followupsTablePresent'] and value['usageRows']==0 for value in modes['factoryAI'].values())
    qc_columns=modes['qcPlan']['seenRecordIdsColumn']
    checks['qcImportBatchSchemaInstalled']=modes['qcPlan']['inspectionImportBatchesTablePresent'] is True and len(qc_columns)==1 and qc_columns[0][2:]==['TEXT',1,"'[]'",0]
    data_checks=(COMPARATOR.compare(before,observed) if data_comparison is None else data_comparison)['checks']; need(type(data_checks) is dict and not set(checks)&set(data_checks) and all(type(value) is bool for value in data_checks.values()))
    checks.update(data_checks)
    return checks

def observe(before,deployed,files):
    global STAGE,OBSERVED
    STAGE='canonical-source-and-initial-runtime'; canonical_source(before,files)
    STAGE='sealed-exact-qc-vendor-patch-facts'; OBSERVED['qcDotnetPatchEvidence']=qc_patch_evidence(before)
    current,raw=CORE.runtime(); OBSERVED.update(runtime=current)
    need(current==deployed['runtimeAfter'] and CORE.maintenance_inventory()==before['maintenanceInventory'])
    roots,mounts=CORE.storage_roots(raw); OBSERVED['mounts']=mounts
    OBSERVED['environment']={name:CORE.envmap(raw[name]['Config']['Env']) for name in ORDER}
    OBSERVED['beforeEnvironment']={name:CORE.envmap(json.loads((BACKUP/'target-inspect.private.json').read_bytes())[name]['Config']['Env']) for name in ORDER}
    OBSERVED['processEnvironment']={}
    for name in ORDER:
        value=run(['docker','exec',current['targets'][name]['id'],'cat','/proc/1/environ']); need(value.endswith(b'\0'))
        OBSERVED['processEnvironment'][name]=CORE.envmap([part.decode() for part in value.split(b'\0') if part])
    STAGE='fixed-get-only-public-observations'; OBSERVED['httpChecks']=public_observations(current)
    STAGE='all-persistent-sqlite-and-file-observations'; storage={}
    for key,path in roots.items():
        storage[key]=CORE.OPS.sqlite_capture(key,path,OUT/key); CORE.required_sqlite_databases(key,storage[key])
        if key=='quote-legacy': storage[key]['completeRawFileInventory']=CORE.OPS.L.non_database_inventory(path,[],OUT/'quote-legacy-raw.tar')
    OBSERVED['storage']=storage
    STAGE='repeatable-read-postgres-and-independent-sequences'; OBSERVED['postgres']=CORE.OPS.pg_capture(current['databaseContainer'],OUT,False)['internal_quote']
    STAGE='actual-container-code-pdb-and-source-observations'; OBSERVED['sourceProof']=source_observations(current)
    STAGE='closed-private-snapshot-feature-mode-observations'; OBSERVED['modes']=readonly_mode_facts(OUT)
    STAGE='final-runtime-environment-and-maintenance'; canonical_source(before,files); OBSERVED['runtimeFinal']=CORE.runtime()[0]; OBSERVED['maintenance']=CORE.maintenance_inventory(); OBSERVED['environmentSHA256']=sha(CORE.stable_environment_bytes(ROOT/'.env.cloud.production'))
    originals()
    STAGE='persist-observations-before-pure-comparison'; CORE.OPS.L.private_write(OUT/'observed.private.json',enc(OBSERVED))

def main():
    global CORE,COMPARATOR,STAGE
    need(len(sys.argv)==2 and sys.argv[1]=='verify' and VERIFY_PIN and os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_ATTEMPT')=='1')
    need(all(re.fullmatch('[a-f0-9]{40}',value or '') for value in (TARGET,TREE)) and bool(re.fullmatch('[a-f0-9]{64}',SOURCE_MANIFEST_SHA or '')))
    os.umask(0o077); OUT.mkdir(mode=0o700)
    CORE=load_module('batch_verify_core','batch-backup-library.py',CORE_SHA); CORE.OUT=OUT
    CORE.OPS=CORE.load('release-data-ops-library.py'); CORE.OPS.L=CORE.OPS.load_library(pathlib.Path(__file__).with_name('release-data-library.py')); CORE.READONLY=CORE.load('internal-quote-readonly-library.py'); CORE.PDB=CORE.load('portable-pdb-library.py')
    CORE.run=run; CORE.OPS.run=run; CORE.READONLY.run=run; CORE.OPS.SCHEMAS=('internal_quote',); CORE.OPS.NEW_COLUMNS={}
    COMPARATOR=load_module('batch_verify_pure','batch-961-965-data-compare.py',COMPARATOR_SHA)
    signal.signal(signal.SIGTERM,lambda *_:need(False))
    result={'mode':'verify','base':BASE,'target':TARGET,'expectedTree':TREE,'success':False,'businessWritesPerformed':False,'applicationLoginOrCredentialSubmissionPerformed':False,'httpMethodsUsed':['GET'],'wrappedCLIReadOnlyAllowlistEnforced':True,'externalAIOrPaidRequestsPerformed':False,'printlinkAuthorityEnabledByAgent':False,'maintenanceOrConfigurationWritesPerformed':False,'automaticRollbackOrRestorePerformed':False}
    try:
        before,deployed=originals(); files=source_manifest(); observe(before,deployed,files)
        STAGE='derive-only-from-sealed-closed-copies'; evidence=COMPARATOR.derive_closed_sqlite_evidence(before,OBSERVED,BACKUP,OUT); CORE.OPS.L.private_write(OUT/'closed-evidence.private.json',enc(evidence)); OBSERVED['closedSqliteEvidence']=evidence
        STAGE='pure-comparison-of-retained-facts'; data_comparison=COMPARATOR.compare(before,OBSERVED); checks=pure_checks(before,deployed,OBSERVED,data_comparison); need(all(type(value) is bool for value in checks.values()))
        STAGE='retain-unmodified-strict-and-allowed-migration-results'; CORE.OPS.L.private_write(OUT/'data-comparison.private.json',enc(data_comparison))
        result.update(checks=checks,strictSnapshotChecks=data_comparison.get('strictChecks'),strictEnvironmentChecks=strict_environment_facts(before,OBSERVED),declaredQCPlanVendorMetadataChange={'image':QC_IMAGE,'metadata':QC_VENDOR_PATCH},observationsRetainedBeforeComparison=True,allSevenServiceObservationsComplete=True,success=all(checks.values()))
    except BaseException: result['failedStage']=STAGE
    finally:
        if not (OUT/'observed.private.json').exists(): CORE.OPS.L.private_write(OUT/'partial-observations.private.json',enc(OBSERVED))
        CORE.OPS.L.private_write(OUT/'first-result.json',enc(result)); CORE.OPS.L.seal(OUT)
        public={key:value for key,value in result.items() if key!='checks'}
        public.update(checksPassed=sum(value is True for value in result.get('checks',{}).values()),checksFailed=sum(value is not True for value in result.get('checks',{}).values()),manifestSHA256=CORE.OPS.L.file_hash(OUT/'manifest.json'),resultSHA256=CORE.OPS.L.file_hash(OUT/'first-result.json'))
        print(enc(public).decode(),flush=True)
    return 0 if result['success'] else 1

if __name__=='__main__':
    try: code=main()
    except BaseException: print('{"success":false,"safeFailure":"BATCH_961_965_VERIFY_PREFLIGHT_FAILED"}',flush=True); code=1
    sys.exit(code)
