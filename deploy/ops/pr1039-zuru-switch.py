"""One ZURU switch/readonly verification. Imported by an exact pinned phase runner only."""
import hashlib,importlib.util,io,json,os,pathlib,re,stat,tarfile,time,urllib.request,urllib.error
from decimal import Decimal
MAP_MODULE_SHA256='99e32975cfd9db1016acbcb2ae9d9f0ebe1368dc28c4ca17e7977265d1dc3fd6'
MAP_MODULE_NAME='pr1039-zuru-map.py'
ROUTES=('/', '/zuru-order-system/', '/zuru-order-system/health', '/gongcheng-ziliao/health', '/paiji/health', '/indo-shipping/api/health', '/internal-quote/health', '/sprayplan/api/health')

def ingress(M,gated=False):
    result={}
    for path in ROUTES:
        try:
            with urllib.request.urlopen('http://127.0.0.1'+path,timeout=10) as r:
                body=r.read(2*1024**2+1);status=r.status
        except urllib.error.HTTPError as r: body=r.read(2*1024**2+1);status=r.code
        M.need(len(body)<=2*1024**2,'bounded-readonly-gateway-probe')
        result[path]={'status':status,'bytes':len(body),'bodySHA256':M.sha(body)}
    expected={p:(401 if p in ROUTES[:2] else 200)for p in ROUTES}
    if gated: expected.update({'/zuru-order-system/':503,'/zuru-order-system/health':503})
    M.need(all(result[p]['status']==s for p,s in expected.items()),'only-target-maintenance-or-original-gateway-statuses')
    return result

QUIET=r'''import os,json
connections=writes=0
for filename in ('/proc/net/tcp','/proc/net/tcp6'):
 for row in open(filename).read().splitlines()[1:]:
  fields=row.split()
  if int(fields[1].split(':')[-1],16)==5005 and fields[3] not in ('0A','06','07'):connections+=1
for process in os.listdir('/proc'):
 if not process.isdigit():continue
 try:descriptors=os.listdir('/proc/'+process+'/fd')
 except FileNotFoundError:continue
 for descriptor in descriptors:
  try:
   fd='/proc/'+process+'/fd/'+descriptor;target=os.readlink(fd)
   if any(target==root or target.startswith(root+'/')for root in ('/app/data','/app/uploads','/app/exports')) and target!='/app/data/ops.log':
    for line in open('/proc/'+process+'/fdinfo/'+descriptor):
     if line.startswith('flags:') and int(line.split()[1],8)&3:writes+=1
  except (FileNotFoundError,ProcessLookupError):continue
print(json.dumps({'connections':connections,'businessWriteFDs':writes}))'''

def quiet(M):
    samples=[];consecutive=0
    for _ in range(25):
        row=json.loads(M.run(['docker','exec','-i',M.CID,'python','-B','-c',QUIET],timeout=15));samples.append(row)
        M.need(set(row)=={'connections','businessWriteFDs'}and all(type(n)is int and n>=0 for n in row.values()),'typed-quiet-sample')
        consecutive=consecutive+1 if not any(row.values())else 0
        if consecutive>=3:return samples
        time.sleep(2)
    M.need(False,'target-active-work-not-drained-no-stop')

INTERNAL=r'''import urllib.request,urllib.parse,json,hashlib
out={}
for key,path in [('health','/health'),('config','/api/config'),('translate','/api/translate?'+urllib.parse.urlencode({'name':'Korea, Republic of'})),('page','/')]:
 request=urllib.request.Request('http://127.0.0.1:5005'+path,headers={'X-Forwarded-Prefix':'/zuru-order-system'})
 with urllib.request.urlopen(request,timeout=10)as r:
  b=r.read(2*1024**2+1)
  if len(b)>2*1024**2:raise RuntimeError('bounded')
  row={'status':r.status,'bytes':len(b),'bodySHA256':hashlib.sha256(b).hexdigest()}
  if key=='config':
   v=json.loads(b);row['itemCount']=v['items']['count'];row['builtin']=v['items']['builtin']
  if key=='translate':
   v=json.loads(b);row['fullyTranslated']=v['fully_translated'];row['knownCountryCorrect']=v['output']=='南韩-亚洲'
  out[key]=row
print(json.dumps(out,sort_keys=True))'''

def internal(M,count):
    result=json.loads(M.run(['docker','exec','-i',M.CID,'python','-B','-c',INTERNAL],timeout=60))
    M.need(set(result)=={'health','config','translate','page'}and all(v['status']==200 for v in result.values()),'actual-live-health-config-translate-page-200')
    M.need(result['config']['itemCount']==count and result['config']['builtin'] is False and result['translate']['fullyTranslated']and result['translate']['knownCountryCorrect'],'actual-loaded-map-count-and-retained-country-logic')
    return result

def code_check(M,revision,patch_files=None):
    observed=M.source_code(M.CID)
    M.need(set(observed)==set(M.PRODUCTION),'all-four-production-files-present')
    for name in M.PRODUCTION:
        M.need(observed[name]['sha256']==M.sha(M.git('show',revision+':'+M.APP+'/'+name)),'runtime-source-'+name.replace('/','-'))
    if patch_files:
        for name,want in patch_files.items():
            got=observed[name]
            M.need(all(got[k]==want[k]for k in ('sha256','bytes','uid','gid','mode','mtimeNs')),'sealed-code-metadata-'+name)
    return observed

def capture(M,label):
    records={};summaries={}
    for name in ('data','uploads','exports'):
        folder=M.ROOT/M.APP/name;before=folder.lstat();inventory,summary=M.E.full_inventory(folder);after=folder.lstat()
        key=lambda s:(s.st_dev,s.st_ino,s.st_mode,s.st_uid,s.st_gid,s.st_mtime_ns,s.st_ctime_ns)
        M.need(key(before)==key(after),'stable-storage-root-'+name)
        inventory['root']['mtimeNs']=after.st_mtime_ns
        M.need(summary['links']==0,'no-storage-links-'+name)
        records[name]=inventory;summaries[name]={**summary,'sha256':M.sha(M.enc(inventory))}
    M.private(M.OUT/(label+'.private.json'),M.enc(records));return records,summaries

def cold_difference(M,before,after,map_result):
    for name in ('uploads','exports'):M.need(before[name]==after[name],'all-'+name+'-bytes-and-metadata-preserved')
    old,new=before['data'],after['data']
    M.need({k:v for k,v in old['root'].items()if k!='mtimeNs'}=={k:v for k,v in new['root'].items()if k!='mtimeNs'},'data-root-ownership-and-mode-preserved')
    rows=lambda inv:{r['path']:r for r in inv['entries']}
    a,b=rows(old),rows(new);M.need(set(a)==set(b)and 'item_map.json'in a,'same-all-business-data-entries')
    M.need(all(a[n]==b[n]for n in a if n!='item_map.json'),'all-nonmap-data-bytes-and-metadata-preserved')
    row=b['item_map.json'];M.need(row['sha256']==map_result['afterSHA256']and all(row[k]==a['item_map.json'][k]for k in('uid','gid','mode','type'))and all(row[k]==map_result['afterMeta'][k]for k in('bytes','mtimeNs')),'only-intended-item-map-file-changed-with-original-permissions')
    return True

def map_module(M):
    path=pathlib.Path(__file__).with_name(MAP_MODULE_NAME)
    M.need(M.pin(MAP_MODULE_SHA256)and path.is_file()and not path.is_symlink()and M.sha(path.read_bytes())==MAP_MODULE_SHA256,'pinned-map-implementation')
    spec=importlib.util.spec_from_file_location('zuru_map',path);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module

def checked_patch(M,phase_dir,details):
    raw,_=M.read_file(phase_dir/'patch.tar');M.need(len(raw)<2*1024**2,'bounded-two-file-patch')
    with tarfile.open(fileobj=io.BytesIO(raw))as archive:
        members=archive.getmembers();M.need({m.name for m in members}==set(M.PATCH)and len(members)==len(M.PATCH),'exact-two-file-code-overlay')
        for member in members:
            row=details['patchFiles'][member.name]
            M.need(member.isfile()and member.uid==row['uid']and member.gid==row['gid']and stat.S_IMODE(member.mode)==row['mode']and member.size==row['bytes'],'sealed-overlay-header')
            stamp=Decimal(member.pax_headers.get('mtime',str(member.mtime)))
            M.need(stamp.is_finite()and stamp*10**9==row['mtimeNs'],'sealed-overlay-precise-time-authority')
            data=archive.extractfile(member).read();M.need(M.sha(data)==row['sha256']==M.sha(M.git('show',M.TARGET+':'+M.APP+'/'+member.name)),'sealed-overlay-byte-authority')
    return raw

def deploy(M):
    receipt,phase_dir=M.sealed('prepare',M.PREPARED_SHA256);details=receipt['details']
    M.need(receipt['success']and details['deploymentEligible'] is True,'successful-eligible-offline-preparation')
    before,raw=M.runtime();protected=M.protection(before)
    M.need(before==details['runtime']and protected==details['protected'],'prepared-runtime-and-protection-cas')
    M.need(M.image(M.ALIAS)['Id']==M.BASE_IMAGE and M.image(details['candidate'])['Id']==details['candidate'],'original-alias-and-immutable-candidate')
    old_source=code_check(M,M.SOURCE_BASE);M.need(old_source==details['oldSource'],'prepared-all-code-bytes-and-metadata-cas')
    patch=checked_patch(M,phase_dir,details);map_api=map_module(M)
    M.need(os.statvfs(M.ROOT).f_bavail*os.statvfs(M.ROOT).f_frsize>=M.MIN_AVAILABLE,'space-before-live-writes')
    original_public=ingress(M);gate=M.ROOT/'deploy/maintenance/services'/M.SERVICE
    M.need(gate.parent.is_dir()and not any(p.is_symlink()for p in(gate.parent,*gate.parent.parents))and not gate.exists()and not gate.is_symlink(),'fresh-service-only-maintenance-gate')
    fd=os.open(gate,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o644);os.fchmod(fd,0o644);os.close(fd)
    owned=M.gate_record(gate)
    try:
        M.private(M.OUT/'gate.private.json',M.enc(owned))
        ingress(M,True);quiet_samples=quiet(M)
        current_table=M.configured_table()
        M.need(current_table['valid'] is True,'current-configured-table-valid-before-stop')
        M.need(M.runtime()[0]==before and M.protection(before)==protected,'runtime-and-host-stable-before-stop')
        started=time.time_ns();M.private(M.OUT/'start-window.private.json',M.enc({'beginNs':started}))
    except Exception:
        # No lifecycle/code/map write has occurred; remove only our own gate.
        if M.gate_record(gate)==owned:
            gate.unlink();ingress(M)
        raise
    M.run(['docker','stop','--time','30',M.CID],timeout=90)
    M.need(M.memory(['docker','inspect',M.CID])[0]['State']['Running'] is False,'same-container-stopped-once')
    cold,old_summary=capture(M,'cold-before')
    old_rows={r['path']:r for r in cold['data']['entries']};M.need('item_map.json'in old_rows,'cold-existing-map')
    map_result=map_api.atomic_patch(M.ROOT/M.APP/'data/item_map.json',old_rows['item_map.json']['sha256'],M.OUT/'old-item-map.private.json')
    M.need(map_result['beforeSHA256']==old_rows['item_map.json']['sha256'],'cold-map-exact-cas')
    M.run(['docker','cp','--archive','-',M.CID+':/app'],patch,timeout=90)
    code_check(M,M.TARGET,details['patchFiles'])
    patched,patched_summary=capture(M,'cold-patched');cold_difference(M,cold,patched,map_result)
    M.run(['docker','start',M.CID],timeout=90);M.health()
    after,_=M.runtime();M.need(set(after)==set(before)and all(after[c]==before[c]for c in before if c!=M.CID),'all-other-existing-containers-unchanged')
    a,b=before[M.CID],after[M.CID]
    M.need(b==dict(a,pid=b['pid'],started=b['started'],restarts=0)and b['pid']!=a['pid']and b['started']!=a['started']and b['running']and b['health']=='healthy','one-same-container-manual-start')
    M.need(started<=M.utc_ns(b['started'])<=time.time_ns(),'actual-manual-start-in-window')
    running,running_summary=capture(M,'cold-after-start');M.need(running==patched,'all-storage-exact-through-single-start')
    new_source=code_check(M,M.TARGET,details['patchFiles'])
    M.need(all(new_source[n]==old_source[n]for n in M.PRODUCTION if n not in M.PATCH),'untouched-template-and-requirements-metadata-exact')
    inside=internal(M,map_result['afterCount'])
    M.need(M.protection(after)==protected and M.runtime()[0]==after and M.image(M.ALIAS)['Id']==M.BASE_IMAGE and M.gate_record(gate)==owned,'host-runtime-alias-owned-gate-final-cas')
    M.run(['docker','tag',details['candidate'],M.ALIAS]);M.need(M.image(M.ALIAS)['Id']==details['candidate']and M.gate_record(gate)==owned,'durable-alias-promoted-once')
    gate.unlink();public=ingress(M)
    return {'candidate':details['candidate'],'runtime':after,'protected':protected,'newSource':new_source,'internal':inside,'public':public,'originalPublic':original_public,'configuredTable':current_table,'map':map_result,'storageBefore':old_summary,'storageAfter':running_summary,'onlyIntendedItemMapDelta':True,'allStorageExactThroughStart':True,'allOtherContainersUnchanged':True,'sameStopCopyStartOnce':True,'serviceMarkerCleared':True,'quietSamples':quiet_samples,'productionBusinessWriteTests':False}

def verify(M):
    receipt,_=M.sealed('deploy',M.DEPLOY_SHA256);details=receipt['details'];current,_=M.runtime()
    M.need(receipt['success']and current==details['runtime']and M.protection(current)==details['protected'],'deployed-runtime-host-auth-and-config-still-exact')
    M.need(M.image(M.ALIAS)['Id']==details['candidate']and not(M.ROOT/'deploy/maintenance/services'/M.SERVICE).exists(),'durable-alias-current-and-marker-absent')
    prepared,_=M.sealed('prepare',M.PREPARED_SHA256);source=code_check(M,M.TARGET,prepared['details']['patchFiles'])
    body,_=M.read_file(M.ROOT/M.APP/'data/item_map.json');mapping=json.loads(body);M.need(type(mapping)is dict and bool(mapping),'current-nonempty-item-map')
    inside=internal(M,len(mapping));public=ingress(M)
    return {'candidate':details['candidate'],'runtime':current,'newSource':source,'internal':inside,'public':public,'allOtherContainersUnchanged':True,'serviceMarkerCleared':True,'businessFilesNotComparedAcrossUserWriteWindow':True,'productionBusinessWriteTests':False}
