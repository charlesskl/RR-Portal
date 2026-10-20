"""Fixed one-service deployment and strict read-only verification. Gates remain false."""
import datetime,hashlib,importlib.util,json,os,pathlib,re,signal,stat,subprocess,sys,time,urllib.request,urllib.error
ROOT=pathlib.Path('/opt/rr-portal');BASE='32440d3f0891e52707ea89f8dfe72eabe9f62ad7';TARGET='9a62c7059600c12d4781b94f69098e37a32d901d';TREE='6785a711ceee51d75d37f9b03ed7f267bf734754'
BRANCH='refs/heads/ops/internal-quote-959-20261020';DEPLOY_PIN=False;VERIFY_PIN=True
BACKUP=ROOT/'deploy/backups/internal-quote-959-20261020-backup';BACKUP_MANIFEST='59e4b3e6d673ec18c74e5fb2fdd41a15f7b1f39b24a5933a934fc8d7956e3270';BACKUP_RESULT='68f8664bbcb86edf0de47f53622531a94c61db10cd07d733d87609eb71d37eef'
DEPLOY=BACKUP.with_name('internal-quote-959-20261020-deploy');VERIFY=BACKUP.with_name('internal-quote-959-20261020-verify-retry-1');DEPLOY_MANIFEST='7e785eb75516bba27cd4effac6984380073049d23fa4e337286264045cc8f281';DEPLOY_RESULT='a37dac23e67b4d9355b3ab3e1fe840e721b6f5e3f26cd20a14f1602dc1228789'
CORE_SHA='6da5f64ae83169823dfceb4f304e08c0c2e8065c2336cd4436ee03db1f237b77'
SOURCE_MANIFEST_SHA='395b9ecf8d2b452af3887e7df0f23d5c9478b99fd284a17dbefb1eacd9be7f5e';CACHE_URLS={'quote.html':{'workbench.js':'20261020-delivery'},'verification.html':{'styles.css':'20261020-delivery','excel-grid.css':'20261020-delivery','workbench.js':'20261020-delivery','verification-customers.js':'20261020-delivery','excel-formulas.js':'20261020-delivery','excel-valuation.js':'20261020-delivery','excel-grid.js':'20261020-delivery','verification-transfer.js':'20261020','verification.js':'20261020-delivery'}};EXPECTED_COSTING_JSON='{"version":"2026-07-31","title":"华登集团—清溪厂区2026年成本最新核价方式","materials":[{"name":"ABS","model":"750SW","price":6.5},{"name":"透明ABS","model":"TR558/920","price":10},{"name":"HIPS","model":"HI425","price":6},{"name":"GP","model":"MW-1","price":6.8},{"name":"1#PP","model":"JM350/K8009","price":5.8},{"name":"1#PP","model":"7032 E3","price":5.8},{"name":"透明PP","model":"5090T","price":6.5},{"name":"POM","model":"F3003/M9044","price":13.5},{"name":"POM","model":"PM820/DM220","price":18},{"name":"PVC","model":"普通透明","price":7.2},{"name":"PVC","model":"普通本白","price":6.2},{"name":"LDPE","model":"G812","price":6.5},{"name":"HDPE","model":"HMA016","price":6.9},{"name":"TPR","model":"本白橡胶料","price":13.8},{"name":"TPR","model":"透明橡胶料","price":16.1},{"name":"K料","model":"KR-03NW","price":12.5},{"name":"PC料","model":"2605","price":10.8}],"machines":[{"model":"4A-6A","normal":"80T","price":940},{"model":"7A-9A","normal":"60-80T","price":1050},{"model":"10A-12A","normal":"120T","price":1160},{"model":"14A-16A","normal":"150T","price":1490},{"model":"20A","normal":"200T","price":1920},{"model":"24A","normal":"260T","price":1920},{"model":"32A","normal":"320T","price":2220},{"model":"44A","normal":"490T","price":2500},{"model":"46A-49.9A","normal":"","price":2800},{"model":"60A","normal":"500T","price":3090},{"model":"80A","normal":"","price":3590},{"model":"81.3A","normal":"","price":3600},{"model":"105A","normal":"800T","price":4500}],"exchange":{"rmb_hkd":0.87,"hkd_usd":7.8},"assembly":{"base_rate_hkd":310,"wage_factor":1.2,"social_factor":1.27,"overhead_factor":1.13,"hunan_freight_pct":10},"painting":{"pad":0.04,"edge":0.08,"clamp":0.09},"tax":{"sewing_exclusion_pct":5,"electronic_exclusion_pct":5},"cartons":[{"label":"K=K","rate":3.3},{"label":"K=A","rate":3},{"label":"A=A","rate":2.75},{"label":"A=B","rate":2.6},{"label":"B=B","rate":2.5},{"label":"B3B单坑","rate":1.55},{"label":"A=A 加强芯","rate":2.9},{"label":"A=B 加强芯","rate":2.8},{"label":"B=B 加强芯","rate":2.6},{"label":"B3B 单坑加强芯","rate":1.65},{"label":"B150B","rate":3.45},{"label":"A535B","rate":3.1}],"default_carton_label":"A=A"}';EXPECTED_CHANGED_FILE_COUNT=82
STAGE='preflight';CORE=None;OUT=None;ENV=None
COMPOSE=['docker','compose','-p','rr-portal','-f',str(ROOT/'docker-compose.cloud.yml'),'--env-file',str(ROOT/'.env.cloud.production')]

def need(v):
 if not v:raise RuntimeError('INTERNAL_QUOTE_FIXED_RELEASE_REJECTED')
def enc(v):return json.dumps(v,sort_keys=True,ensure_ascii=True,separators=(',',':'),allow_nan=False).encode()
def sha(v):return hashlib.sha256(v).hexdigest()
def core_load():
 p=pathlib.Path(__file__).with_name('internal-quote-backup-library.py');need(p.is_file()and not p.is_symlink()and sha(p.read_bytes())==CORE_SHA);s=importlib.util.spec_from_file_location('fixed_quote_readonly_core',p);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m

def archive(path,msha,rsha):
 need(re.fullmatch('[a-f0-9]{64}',msha or'')and re.fullmatch('[a-f0-9]{64}',rsha or'')and path.is_dir()and not path.is_symlink()and stat.S_IMODE(path.stat().st_mode)==0o700)
 need(CORE.OPS.L.file_hash(path/'manifest.json')==msha and CORE.OPS.L.file_hash(path/'first-result.json')==rsha);manifest=json.loads((path/'manifest.json').read_bytes());entries=list(path.rglob('*'));need(len(entries)<=50000 and all(not p.is_symlink()and(p.is_dir()or p.is_file())and p.stat().st_mode&0o077==0 for p in entries));need(set(manifest)=={str(p.relative_to(path))for p in entries if p.is_file()and p!=path/'manifest.json'})
 need(all(CORE.OPS.L.safe_path(n)and re.fullmatch('[a-f0-9]{64}',h)and CORE.OPS.L.file_hash(path/n)==h for n,h in manifest.items()));receipt=json.loads((path/'first-result.json').read_bytes());need(receipt.get('success')is True)
 return receipt

def original():
 r=archive(BACKUP,BACKUP_MANIFEST,BACKUP_RESULT);need(r.get('backupComplete')is True and r.get('startupSafetyPassed')is True and r.get('base')==BASE and r.get('legacyPortableSQLiteCount')==2 and r.get('targetMaintenanceInitiallyCleared')is True and r.get('composeRuntimeLiteralAndSerializedEnvironmentProven')is True);baseline=json.loads((BACKUP/'baseline.private.json').read_bytes());need(baseline['head']==BASE and baseline['startupSafetyPassed']is True and type(baseline['maintenanceInventory'])is list and baseline['composeEnvironmentProof']['composeVersion']=='5.1.0'and baseline['composeEnvironmentProof']['forwardSerializedLiteralEqualsComposeJSON']is True and baseline['composeEnvironmentProof']['literalExplicitAndImageDefaultsEqualRuntime']is True);return baseline

def operation(args,timeout=180,checkout=False):
 CORE.COUNTER+=1
 with (OUT/('%03d-%s.private.log'%(CORE.COUNTER,STAGE))).open('xb')as log:p=subprocess.run(args,stdout=log,stderr=subprocess.STDOUT,timeout=timeout,cwd=ROOT,env=ENV,umask=0o022 if checkout else -1)
 need(p.returncode==0)

def source_manifest():
 p=pathlib.Path(__file__).with_name('internal-quote-reviewed-files.json');need(p.is_file()and not p.is_symlink()and sha(p.read_bytes())==SOURCE_MANIFEST_SHA);v=json.loads(p.read_bytes());need(type(v)is dict and 1<=len(v)<=200 and len(v)==EXPECTED_CHANGED_FILE_COUNT and all(n.startswith(CORE.APP_PREFIX)and CORE.OPS.L.safe_path(n)and re.fullmatch('[a-f0-9]{64}',h)for n,h in v.items()));return v

def checked_source(revision,baseline,files,canonical=False):
 global STAGE
 STAGE='checked-source-head-and-fixed-configuration';CORE.BASE=revision;need(CORE.source()==baseline['configuration'])
 STAGE='checked-source-four-preexisting-tracked-changes';need(CORE.dirty_snapshot()==baseline['preexistingFourDirty'])
 STAGE='checked-source-private-environment-hash';need(CORE.OPS.L.file_hash(ROOT/'.env.cloud.production')==baseline['environmentSHA256'])
 STAGE='checked-source-target-tree-and-reviewed-files';need(CORE.run(['git','rev-parse',TARGET+'^{tree}']).decode().strip()==TREE);changed=CORE.run(['git','diff','--name-only','-z','--no-ext-diff','--no-textconv',BASE,TARGET]).decode().strip('\0').split('\0');need(set(changed)==set(files));need(not set(changed)&set(baseline['preexistingFourDirty']))
 for n,h in files.items():
  STAGE='checked-source-reviewed-blob-and-canonical-mode';need(sha(CORE.run(['git','show',TARGET+':'+n]))==h)
  if canonical:
   path=ROOT/n;entry=CORE.run(['git','ls-tree','-z',TARGET,'--',n]).split(b'\t',1);need(len(entry)==2 and entry[1]==n.encode()+b'\0'and re.fullmatch(b'100(?:644|755) blob [a-f0-9]{40}',entry[0]));desired=0o755 if entry[0].startswith(b'100755')else 0o644
   for ancestor in(path,*path.parents):
    if ancestor==ROOT:break
    need(not ancestor.is_symlink())
   need(path.is_file()and stat.S_IMODE(path.stat().st_mode)==desired and CORE.OPS.L.file_hash(path)==h)


def sealed_literal_environment(before):
 raw=json.loads((BACKUP/'app-inspect.private.json').read_bytes());image=json.loads((BACKUP/'app-image.private.json').read_bytes());declared=json.loads((BACKUP/'compose-environment.private.json').read_bytes());literal=json.loads((BACKUP/'literal-compose-environment.private.json').read_bytes());need(raw['Id']==before['runtime']['app']['id']and raw['Image']==before['runtime']['app']['image']==image['Id']);actual=CORE.envmap(raw['Config']['Env']);proof=before['composeEnvironmentProof'];need(sha(enc(actual))==before['runtime']['app']['environmentMapSHA256']and sha(enc(declared))==proof['serializedExplicitEnvironmentSHA256']and sha(enc(literal))==proof['literalExplicitEnvironmentSHA256']);need(CORE.literal_explicit_environment(actual,CORE.envmap(image['Config'].get('Env')or[]),declared)==literal);return actual,literal

def compose_preflight(before,label):
 global STAGE
 need(label in {'prebuild','preswitch','verify'})
 STAGE='controlled-compose-version';need(CORE.run(['docker','compose','version','--short']).decode().strip()=='5.1.0')
 STAGE='sealed-literal-explicit-environment';actual,literal=sealed_literal_environment(before)
 STAGE='controlled-compose-configuration';CORE.COUNTER+=1
 with(OUT/('%03d-compose-config-stderr.private'%CORE.COUNTER)).open('xb')as errors:p=subprocess.run([*COMPOSE,'config','--format','json'],stdout=subprocess.PIPE,stderr=errors,timeout=90,cwd=ROOT,env=ENV)
 STAGE='controlled-compose-forward-serialized-environment';need(p.returncode==0 and len(p.stdout)<=32*1024**2);config=json.loads(p.stdout);need(type(config)is dict and type(config.get('services'))is dict and type(config['services'].get('internal-quote'))is dict);declared=config['services']['internal-quote'].get('environment',{});need(declared==CORE.serialized_environment(literal));CORE.OPS.L.private_write(OUT/(label+'-controlled-literal-compose-environment.private.json'),enc(literal));return {'exactComposeVersionAndLiteralEnvironmentPreserved':True,'forwardSerializedEnvironmentMatchesCurrentComposeConfiguration':True}

def built_image_environment(image,before):
 need(re.fullmatch('sha256:[a-f0-9]{64}',image.get('Id',''))and image['Id']!=before['runtime']['app']['image']);actual,literal=sealed_literal_environment(before);controlled=json.loads((OUT/'prebuild-controlled-literal-compose-environment.private.json').read_bytes());need(controlled==literal);expected=CORE.envmap(image['Config'].get('Env')or[]);expected.update(literal);need(expected==actual);return True

def config_same(a,b):
 return all(a[k]==b[k]for k in ('environmentMapSHA256','processEnvironmentWithoutAutomaticHostnameSHA256','mounts','memory','swap','healthcheck','command','entrypoint','user','workingDirectory'))
def flags():
 p=ROOT/'deploy/maintenance';need(p.is_dir()and not p.is_symlink());v=CORE.OPS.L.non_database_inventory(p,[]);return[r for r in v if r['path']!='services/internal-quote']
def maintenance(fn):
 need(fn in {'maintenance_on','wait_service_ready','maintenance_off','require_maintenance_cleared'});operation(['bash','-c','set -euo pipefail; source "$1"; "$2" internal-quote','quote-release',str(ROOT/'deploy/service-maintenance.sh'),fn],340)

def public_assets(target):
 count=0
 for page,assets in CACHE_URLS.items():
  need(page in {'quote.html','verification.html'}and type(assets)is dict)
  html=CORE.run(['git','show',target+':'+CORE.APP_PREFIX+'frontend/'+page]);status,body=CORE.READONLY.get('http://127.0.0.1/internal-quote/'+page);need(status==200 and body==html)
  for n,version in assets.items():
   need(re.fullmatch('[A-Za-z0-9_.-]+\\.(?:css|js)',n)and re.fullmatch('[A-Za-z0-9_.-]+',version)and('./'+n+'?v='+version).encode()in html)
   expected=CORE.run(['git','show',target+':'+CORE.APP_PREFIX+'frontend/'+n]);status,body=CORE.READONLY.get('http://127.0.0.1/internal-quote/'+n+'?v='+version);need(status==200 and body==expected);count+=1
 need(CORE.READONLY.get('http://127.0.0.1/internal-quote/health')[0]==200)
 for path in ('/api/auth/me','/api/quotes','/api/admin/users','/api/verification-transfer'):need(CORE.READONLY.get('http://127.0.0.1/internal-quote'+path)[0]==401)
 return {'quoteAndVerificationHtmlAndActualCacheUrlsMatchTargetBytes':True,'publicCacheReferencesVerified':count,'publicHealthPassed':True,'unauthenticatedBoundaryPassed':True}

def full_table_metadata(v):
 need(type(v)is dict and set(v)<={'rows','sha256','originalColumnsSHA256','startupCostingBasisEvidence'}and {'rows','sha256','originalColumnsSHA256'}<=set(v))
 return{k:v[k]for k in ('rows','sha256','originalColumnsSHA256')}

def costing_seed_preservation(old,new):
 # Full old tables are never called identical after seed additions. Preserve
 # old candidate rows byte for byte, compare every noncandidate typed row,
 # and accept only exact default seed rows for the missing fixed keys.
 need(type(EXPECTED_COSTING_JSON)is str and bool(EXPECTED_COSTING_JSON));json.loads(EXPECTED_COSTING_JSON)
 a,b=old['tables']['factory_ref_tables'],new['tables']['factory_ref_tables']
 x,y=a['startupCostingBasisEvidence'],b['startupCostingBasisEvidence'];required={'nonSeedRows','seedRows','transactionTimestamp'}
 need(type(x)is dict and type(y)is dict and set(x)==set(y)==required)
 for z in(x,y):need(type(z['seedRows'])is list and len(z['seedRows'])<=2 and type(z['nonSeedRows'])is dict and set(z['nonSeedRows'])=={'rows','sha256','originalColumnsSHA256'})
 def stamp(v):
  need(type(v)is str);normalized=re.sub(r'([+-][0-9]{2})$',r'\1:00',v.replace('Z','+00:00'));normalized=re.sub(r'(\.[0-9]{1,6})(?=[+-][0-9]{2}:[0-9]{2}$)',lambda match:match.group(1).ljust(7,'0'),normalized);parsed=datetime.datetime.fromisoformat(normalized);need(parsed.utcoffset()is not None);return parsed
 start,end=stamp(x['transactionTimestamp']),stamp(y['transactionTimestamp']);need(start<=end)
 def rows(z):
  result={}
  for row in z['seedRows']:
   need(type(row)is dict and set(row)=={'factory_code','key','data_json','updated_at','updated_by'}and row['factory_code']in {'qingxi','heyuan'}and row['key']=='costing_basis'and row['factory_code']not in result);result[row['factory_code']]=row
  return result
 previous,current=rows(x),rows(y);oldrows=all(current.get(k)==v for k,v in previous.items());added=set(current)-set(previous);expected=set(('qingxi','heyuan'))-set(previous)
 valid=added==expected and all(current[k]['data_json']==EXPECTED_COSTING_JSON and current[k]['updated_by']=='[factory-seed]'and start<=stamp(current[k]['updated_at'])<=end for k in added)
 no_other_changed=set(old['tables'])==set(new['tables'])and all(full_table_metadata(old['tables'][n])==full_table_metadata(new['tables'][n])for n in old['tables']if n!='factory_ref_tables')
 projection=x['nonSeedRows']==y['nonSeedRows'];count_matches=b['rows']==a['rows']+len(added)
 preserved=oldrows and projection and no_other_changed and count_matches
 return {'allOriginalFullTypedRowsPreserved':preserved,'onlyExpectedCostingBasisSeedsInserted':valid and count_matches,'expectedCostingBasisSeedRowsAdded':len(added),'existingCostingBasisRowsUnchanged':oldrows,'nonCostingBasisReferenceRowsIdentical':projection}

def deploy(result,before,files):
 global STAGE
 STAGE='initial-runtime';current,raw=CORE.runtime();need(current==before['runtime'])
 STAGE='initial-target-maintenance-cleared-and-all-flags';need(CORE.maintenance_inventory()==before['maintenanceInventory']);old_flags=flags();need(old_flags==before['maintenanceInventory']);maintenance('require_maintenance_cleared')
 STAGE='initial-source-and-fixed-configuration';CORE.BASE=BASE;need(CORE.source()==before['configuration'])
 STAGE='initial-four-preexisting-tracked-changes';need(CORE.dirty_snapshot()==before['preexistingFourDirty'])
 STAGE='initial-private-environment-hash';need(CORE.OPS.L.file_hash(ROOT/'.env.cloud.production')==before['environmentSHA256']);result.update(compose_preflight(before,'prebuild'))
 STAGE='fetch-exact-main';CORE.run(['git','-c','core.hooksPath=/dev/null','fetch','origin','main']);need(CORE.run(['git','rev-parse','FETCH_HEAD']).decode().strip()==TARGET);CORE.run(['git','merge-base','--is-ancestor',BASE,TARGET]);checked_source(BASE,before,files)
 STAGE='fast-forward-with-readable-source';operation(['git','-c','core.hooksPath=/dev/null','-c','merge.autoStash=false','merge','--ff-only','--no-autostash',TARGET],180,checkout=True);checked_source(TARGET,before,files,True)
 STAGE='build-only-internal-quote';need(CORE.runtime()[0]==current);tag=raw['Config']['Image'];need(tag.removesuffix(':latest')=='rr-portal-internal-quote');image=json.loads(CORE.run(['docker','image','inspect',tag]))[0];need(image['Id']==current['app']['image']);operation([*COMPOSE,'build','internal-quote'],600);built=json.loads(CORE.run(['docker','image','inspect',tag]))[0];need(re.fullmatch('sha256:[a-f0-9]{64}',built['Id'])and built['Id']!=image['Id']);checked_source(TARGET,before,files,True)
 STAGE='candidate-image-environment-before-maintenance-or-switch';need(built_image_environment(built,before));result.update(candidateImageEnvironmentMatchesBaselineBeforeSwitch=True)
 STAGE='all-maintenance-flags-before-switch';need(CORE.maintenance_inventory()==before['maintenanceInventory']);result.update(compose_preflight(before,'preswitch'))
 STAGE='startup-safety-immediately-before-switch';_,eligible,_=CORE.startup(current['databaseContainer']);need(eligible and CORE.runtime()[0]==current)
 STAGE='switch-only-internal-quote';maintenance('maintenance_on');switched=time.monotonic();operation([*COMPOSE,'up','-d','--no-build','--no-deps','internal-quote'],180);maintenance('wait_service_ready')
 STAGE='verify-new-runtime';after,_=CORE.runtime();need(after['others']==current['others']and config_same(current['app'],after['app'])and after['app']['id']!=current['app']['id']and after['app']['image']==built['Id']and after['app']['restarts']==0);CORE.READONLY.source_runtime_files(after['app']['id'],TARGET);time.sleep(max(0,10-(time.monotonic()-switched)));latest,_=CORE.runtime();need(latest==after and flags()==old_flags);checked_source(TARGET,before,files,True)
 STAGE='clear-only-internal-quote-maintenance';maintenance('maintenance_off');maintenance('require_maintenance_cleared');need(flags()==old_flags and CORE.runtime()[0]==after)
 STAGE='public-assets-and-authentication-boundary'
 try:result.update(public_assets(TARGET))
 except BaseException:maintenance('maintenance_on');raise
 STAGE='final-maintenance-inventory';need(CORE.maintenance_inventory()==before['maintenanceInventory'])
 STAGE='final-preservation';original();checked_source(TARGET,before,files,True);need(CORE.runtime()[0]==after);result.update(success=True,onlyInternalQuoteRebuilt=True,allNonQuoteContainersUnchanged=True,fourPreexistingChangesPreserved=True,canonicalGitSourceModesVerified=True,environmentAndProcessMapsPreserved=True,runtimeAfter=after)

def verify(result,before,files):
 global STAGE
 STAGE='deployed-private-receipt';receipt=archive(DEPLOY,DEPLOY_MANIFEST,DEPLOY_RESULT);need(receipt.get('target')==TARGET and receipt.get('onlyInternalQuoteRebuilt')is True)
 STAGE='initial-live-runtime-matches-deployed-receipt';current,_=CORE.runtime();need(current==receipt['runtimeAfter']and current['others']==before['runtime']['others'])
 checked_source(TARGET,before,files,True)
 STAGE='target-maintenance-cleared-and-original-flags';maintenance('require_maintenance_cleared');need(CORE.maintenance_inventory()==before['maintenanceInventory']);result.update(compose_preflight(before,'verify'))
 STAGE='current-internal-quote-snapshot';pg=CORE.pg_with_seed_evidence(current['databaseContainer'],OUT,False)
 STAGE='current-legacy-sqlite-snapshots';legacy=CORE.OPS.sqlite_capture('quote-legacy',CORE.APP/'backend/data',OUT/'legacy')
 STAGE='current-upload-and-raw-legacy-inventory';uploads=CORE.OPS.L.non_database_inventory(CORE.APP/'backend/uploads',[]);rawlegacy=CORE.OPS.L.non_database_inventory(CORE.APP/'backend/data',[])
 STAGE='persist-observed-private-before-comparison';CORE.OPS.L.private_write(OUT/'observed.private.json',enc({'postgres':pg,'legacy':legacy,'uploads':uploads,'runtime':current}))
 STAGE='actual-runtime-source-proof';result.update(CORE.READONLY.source_runtime_files(current['app']['id'],TARGET))
 STAGE='actual-public-cache-url-proof';result.update(public_assets(TARGET));checked_source(TARGET,before,files,True)
 STAGE='runtime-stability-after-source-proof';need(CORE.runtime()[0]==current)
 STAGE='compare-original-full-typed-row-digests';old=before['postgres'];tables_changed=[n for n in sorted(set(old['tables'])|set(pg['tables']))if (full_table_metadata(old['tables'][n])!=full_table_metadata(pg['tables'][n]) if n in old['tables']and n in pg['tables']else True)]
 STAGE='compare-schema-sequences-files-and-runtime';checks={'originalFullTypedRowsIdentical':not tables_changed,'fullSchemaAndSequenceDefinitionsIdentical':old['schema']==pg['schema'],'sequenceStateIdenticalNonMVCC':old.get('sequenceStates')==pg.get('sequenceStates'),'legacyLogicalSQLiteAndFilesIdentical':legacy=={k:v for k,v in before['legacy'].items()if k!='completeRawFileInventory'},'legacyPhysicalBytesAndPermissionsIdentical':rawlegacy==before['legacy']['completeRawFileInventory'],'uploadBytesAndPermissionsIdentical':uploads==before['uploads'],'runtimeAndAllNonQuoteContainersUnchanged':current==receipt['runtimeAfter']and current['others']==before['runtime']['others'],'runtimeConfigurationMapsMatchOriginal':config_same(before['runtime']['app'],current['app'])}
 STAGE='compare-exact-costing-basis-seeds';seed_proof=costing_seed_preservation(old,pg);result.update(seed_proof);checks.update({k:seed_proof[k]for k in ('allOriginalFullTypedRowsPreserved','onlyExpectedCostingBasisSeedsInserted')})
 STAGE='revalidate-original-backup-seal';original()
 STAGE='revalidate-successful-deploy-seal';archive(DEPLOY,DEPLOY_MANIFEST,DEPLOY_RESULT)
 STAGE='final-original-maintenance-inventory';need(CORE.maintenance_inventory()==before['maintenanceInventory'])
 STAGE='retained-strict-comparison-result';result.update(deploymentVerified=True,checks=checks,changedTables=tables_changed,changedTableCounts={n:{'before':old['tables'].get(n,{}).get('rows'),'after':pg['tables'].get(n,{}).get('rows')}for n in tables_changed},originalBusinessIdPreservationProven=True if seed_proof['allOriginalFullTypedRowsPreserved']else None,requiresScopedRowInvestigation=not(seed_proof['allOriginalFullTypedRowsPreserved']and seed_proof['onlyExpectedCostingBasisSeedsInserted']),sequenceStatesNotMVCCAtomic=True,success=all(checks.values()))

def main():
 global CORE,OUT,ENV,STAGE
 need(len(sys.argv)==2 and sys.argv[1]in {'deploy','verify'});mode=sys.argv[1];need((DEPLOY_PIN if mode=='deploy'else VERIFY_PIN)and re.fullmatch('[a-f0-9]{40}',TARGET or'')and re.fullmatch('[a-f0-9]{64}',SOURCE_MANIFEST_SHA or'')and os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_ATTEMPT')=='1')
 os.umask(0o077);OUT=DEPLOY if mode=='deploy'else VERIFY;OUT.mkdir(mode=0o700);CORE=core_load();CORE.OUT=OUT;CORE.OPS=CORE.load('release-data-ops-library.py');CORE.OPS.L=CORE.OPS.load_library(pathlib.Path(__file__).with_name('release-data-library.py'));CORE.OPS.SCHEMAS=('internal_quote',);CORE.READONLY=CORE.load('internal-quote-readonly-library.py');CORE.OPS.run=CORE.run;CORE.READONLY.run=CORE.run
 ENV=dict(os.environ,COMPOSE_BAKE='false',COMPOSE_PARALLEL_LIMIT='1',COMPOSE_PROJECT_NAME='rr-portal',MAINT_FLAG_DIR=str(ROOT/'deploy/maintenance'),COMPOSE_FILE=str(ROOT/'docker-compose.cloud.yml'),ENV_FILE=str(ROOT/'.env.cloud.production'),MAINT_COMPOSE_SERVICES='internal-quote',MAINT_HEALTH_TIMEOUT_SECONDS='300',MAINT_DNS_GRACE_SECONDS='10')
 def stop(*_):need(False)
 signal.signal(signal.SIGTERM,stop);result={'mode':mode,'success':False,'target':TARGET,'expectedTree':TREE,'businessWritesPerformed':False,'credentialsChanged':False,'envFileModified':False,'globalHooksRun':False,'globalMaintenanceChanged':False,'automaticRollback':False}
 try:
  before=original();files=source_manifest();(deploy if mode=='deploy'else verify)(result,before,files)
 except BaseException:result['failedStage']=STAGE
 finally:
  CORE.OPS.L.private_write(OUT/'first-result.json',enc(result));CORE.OPS.L.seal(OUT);public={k:v for k,v in result.items()if k!='runtimeAfter'};print(enc(dict(public,resultSHA256=CORE.OPS.L.file_hash(OUT/'first-result.json'),manifestSHA256=CORE.OPS.L.file_hash(OUT/'manifest.json'))).decode(),flush=True)
 return 0 if result['success']else 1
if __name__=='__main__':
 try:exit_code=main()
 except BaseException:print('{"success":false,"safeFailure":"INTERNAL_QUOTE_RELEASE_PREFLIGHT_FAILED"}',flush=True);exit_code=1
 sys.exit(exit_code)
