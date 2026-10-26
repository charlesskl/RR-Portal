"""Callable-only SprayPlan scoped compose/env proof helpers.

No commands, imports with side effects, filesystem access, HTTP or mutation.
Returned literal environments may contain secrets: caller must keep them in RAM
or a private0600 overlay outside every Docker build context and every log/Git file.
"""
import hashlib,json,pathlib,re

ROOT='/opt/rr-portal'
APP='apps/喷油部/喷油排期系统'
SERVICES={'sprayplan':('data','storage'),'sprayplan-test':('data-test','storage-test')}
PUBLIC_VERSION_KEYS={'DOTNET_VERSION','ASPNET_VERSION'}
def need(value,label):
    if not value:raise RuntimeError('SPRAYPLAN_COMPOSE_'+label)
def enc(value):return json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=True,allow_nan=False).encode()
def digest(value):return hashlib.sha256(enc(value)).hexdigest()
def environment(value):
    if type(value)is dict:
        need(all(type(k)is str and k and'='not in k and type(v)is str for k,v in value.items()),'literal-env-map')
        return dict(value)
    need(type(value)is list,'literal-env-list');result={}
    for item in value:
        need(type(item)is str,'literal-env-string');k,sep,v=item.partition('=')
        need(sep and k and k not in result,'unique-env-key');result[k]=v
    return result
def version(value):return type(value)is str and re.fullmatch(r'8\.0\.(0|[1-9][0-9]*)',value)is not None
def compose_literal(value):
    # Compose interpolation occurs before file merging; $$ preserves a raw $.
    if type(value)is str:return value.replace('$','$$')
    if type(value)is list:return [compose_literal(v)for v in value]
    if type(value)is dict:return {k:compose_literal(v)for k,v in value.items()}
    return value
def raw_literal(value):
    if type(value)is str:
        need('$'not in value.replace('$$',''),'only-escaped-compose-dollar')
        return value.replace('$$','$')
    if type(value)is list:return [raw_literal(v)for v in value]
    if type(value)is dict:return {k:raw_literal(v)for k,v in value.items()}
    return value
def image_contract(old_image,new_image,target):
    need(re.fullmatch('[a-f0-9]{40}',target or''),'reviewed-target')
    need(all(re.fullmatch('sha256:[a-f0-9]{64}',v.get('Id',''))for v in(old_image,new_image)),'immutable-image-identities')
    need(old_image['Os']==new_image['Os']and old_image['Architecture']==new_image['Architecture'],'same-runtime-platform')
    a,b=dict(old_image['Config']),dict(new_image['Config']);old_env,new_env=environment(a.pop('Env')),environment(b.pop('Env'))
    need(all(version(old_env.get(k))and version(new_env.get(k))for k in PUBLIC_VERSION_KEYS),'actual-dotnet8-image-metadata')
    need({k:v for k,v in old_env.items()if k not in PUBLIC_VERSION_KEYS}=={k:v for k,v in new_env.items()if k not in PUBLIC_VERSION_KEYS},'no-other-image-env-drift')
    old_labels,new_labels=a.pop('Labels',None)or{},b.pop('Labels',None)or{}
    # Legacy builder-parent image metadata is not a runtime instruction.
    a.pop('Image',None);b.pop('Image',None)
    need(a==b,'same-image-user-command-health-ports-volumes-and-other-config')
    need(new_labels in(old_labels,dict(old_labels,**{'org.opencontainers.image.revision':target})),'only-reviewed-revision-label-change')
    return {'old':old_env,'new':new_env}
def preserved_environment(current,old_image,new_image,target):
    proof=image_contract(old_image,new_image,target);actual=environment(current['Config']['Env'])
    need(current['Image']==old_image['Id'],'actual-old-container-image')
    need(all(actual.get(k)==proof['old'][k]for k in PUBLIC_VERSION_KEYS),'old-public-version-defaults-match-actual-image')
    result=dict(actual)
    for key in PUBLIC_VERSION_KEYS:result[key]=proof['new'][key]
    need({k:v for k,v in actual.items()if k not in PUBLIC_VERSION_KEYS}=={k:v for k,v in result.items()if k not in PUBLIC_VERSION_KEYS},'every-protected-env-key-preserved')
    return result
def mounts(service,current,root=ROOT):
    need(service in SERVICES and type(root)is str and str(pathlib.PurePosixPath(root))==root and root.startswith('/'),'fixed-service-root')
    expected={dest:root+'/'+APP+'/'+name for name,dest in zip(SERVICES[service],('/app/data','/app/server/SprayPlan.Api/storage'))}
    rows=current['Mounts'];need(len(rows)==2 and{m['Destination']for m in rows}==set(expected),'exact-two-persistent-mounts')
    result=[]
    for row in sorted(rows,key=lambda m:m['Destination']):
        need(row['Type']=='bind'and row['Source']==expected[row['Destination']]and row['RW']is True,'same-existing-writable-bind')
        need(row.get('Mode','')in('','rw'),'known-existing-bind-mode')
        propagation=row.get('Propagation')or'rprivate'
        need(propagation in('rprivate','private'),'known-private-bind-propagation')
        result.append({'type':'bind','source':row['Source'],'target':row['Destination'],'read_only':False,'bind':{'create_host_path':False,'propagation':propagation}})
    return result
def literal_overlay(service,current,old_image,new_image,target,root=ROOT):
    """Generate an overlay for one immutable image; do not write or print it."""
    need(service in SERVICES,'known-service');labels=current['Config'].get('Labels')or{}
    need(labels.get('com.docker.compose.project')=='rr-portal'and labels.get('com.docker.compose.service')==service,'exact-current-compose-service')
    need(re.fullmatch('[a-f0-9]{64}',current.get('Id','')),'full-current-id')
    env=preserved_environment(current,old_image,new_image,target)
    need(env.get('NEXT_PUBLIC_BASE_PATH')=='/'+service and env.get('DATA_PATH')=='/app/data'and env.get('DOTNET_API_URL')=='http://127.0.0.1:5080','same-routing-and-database-root')
    need(env.get('SPRAYPLAN_DB_PATH','/app/data/sprayplan.db')=='/app/data/sprayplan.db','same-database-file')
    settings={'image':new_image['Id'],'environment':env,'volumes':mounts(service,current,root)}
    # Pin defaults too: a merged base file must not inject a previously absent
    # user/command/entrypoint/hostname. Null inherits the already-proved image.
    for source,dest in(('Entrypoint','entrypoint'),('Cmd','command'),('User','user')):
        value=current['Config'].get(source)
        settings[dest]=(''if value is None else value)if dest=='user'else value
    hostname=current['Config'].get('Hostname')
    settings['hostname']=hostname if hostname and hostname!=current['Id'][:12]else None
    return {'services':{service:compose_literal(settings)}}
def validate_rendered(service,rendered,overlay):
    """Check selected merged config before any service stop/recreate."""
    need(service in SERVICES and set(overlay['services'])=={service},'one-service-overlay')
    # `compose config` emits a reusable Compose model and escapes literal $
    # again. Decode its canonical values exactly once, as with source overlay.
    actual=raw_literal(rendered['services'][service]);expected=raw_literal(overlay['services'][service])
    need(actual['image']==expected['image'],'rendered-immutable-image')
    need(environment(actual['environment'])==expected['environment'],'rendered-literal-environment')
    rows=actual['volumes'];need(len(rows)==2,'rendered-exact-two-binds')
    by_target={x['target']:x for x in rows};need(len(by_target)==2,'rendered-unique-mount-targets')
    for item in expected['volumes']:
        got=by_target.get(item['target']);need(got is not None and got['type']=='bind'and got['source']==item['source']and got.get('read_only',False)is False,'rendered-same-bind')
        # Compose's canonical JSON omits the false boolean zero value. The
        # reviewed source must explicitly forbid creation; omission rendersfalse.
        need(item['bind'].get('create_host_path')is False and got.get('bind',{}).get('create_host_path',False)is False and got.get('bind',{}).get('propagation','rprivate')==item['bind']['propagation'],'rendered-never-create-missing-data-bind')
    for key in('entrypoint','command','user','hostname'):
        need(actual.get(key,''if key=='user'else None)==expected[key],'rendered-'+key)
    return {'oneServiceImagePinned':True,'allProtectedEnvironmentPreserved':True,'verifiedNewImageDotnet8Metadata':True,'bothExistingBindsPreservedWithoutCreatingDirectories':True,'literalValuesReturned':False}
