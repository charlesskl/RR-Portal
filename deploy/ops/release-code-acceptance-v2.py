"""Fixed seven-container source/assets/health acceptance; no business CRUD or login."""
import hashlib,importlib.util,io,ipaddress,json,os,pathlib,re,select,struct,subprocess,sys,tarfile,time,urllib.request,uuid
ROOT=pathlib.Path('/opt/rr-portal')
BRANCH='refs/heads/ops/release-937-943-944-945-946-950-20261019'
PIN_FROZEN=True
TARGET='85d2082c273d3df3e51b2e414855634c56c498dd'
BACKUP_MANIFEST='22483bb8f1a2e799ad6bcd14f48c2b60c2913d74ad9a03207c39c8b6f761f93f'
BACKUP_RESULT='16dd085003188dbc56150bac9dfedcd3cd5ae9207732f1b96ed357c5a097458f'
DEPENDENCY_COMMIT='96dccbf113a66590e4828ea7c5ec64b87932194e'
DEPENDENCY_SHA='ff9138a1d5bfed1b10077112da6ebcda2d65240f583e2d0e12ce1325cfbaafd5'
DEPENDENCY_PATH='deploy/ops/release-937-943-944-945-946-950.py'
QC='apps/生产部/品质管理系统/'
QUOTE='apps/业务部/内部报价系统/'
FACTORY='apps/PMC跟仓管/加工厂月度评审管理制度/'
REPORT='apps/QA部/QC成品报告系统/'
INDO='apps/印尼小组/印尼走货明细/'
TARGETS={'qc','indo-shipping','internal-quote','factory-review','factory-review-test','qc-report','qc-report-worker'}
MAX_FILE=16*1024**2
LAST_STAGE='INITIAL';LAST_LABEL=''


def stage(operation,service=''):
    global LAST_STAGE,LAST_LABEL
    LAST_STAGE=(service+':'if service else'')+operation;LAST_LABEL=''


def failed_stage():return LAST_STAGE+('/'+LAST_LABEL if LAST_LABEL else'')


def need(value,label):
    global LAST_LABEL
    if not value:LAST_LABEL=label;raise ValueError(label)


def sha(value):return hashlib.sha256(value).hexdigest()


def backup_metadata(lib,backup,base):
    need(lib.file_hash(backup/'manifest.json')==BACKUP_MANIFEST,'AUTHENTICATED_BACKUP_MANIFEST')
    manifest=json.loads((backup/'manifest.json').read_bytes())
    need(isinstance(manifest,dict)and all(re.fullmatch('[a-f0-9]{64}',manifest.get(name,'')or'')for name in ['baseline.private.json','first-result.json']),'TRUSTED_METADATA_MANIFEST_ENTRIES')
    pins={'manifest.json':BACKUP_MANIFEST,'first-result.json':manifest['first-result.json'],'baseline.private.json':manifest['baseline.private.json']}
    need(pins['first-result.json']==BACKUP_RESULT and all(lib.file_hash(backup/name)==value for name,value in pins.items()),'EXACT_ALREADY_VERIFIED_BACKUP_METADATA')
    baseline=json.loads((backup/'baseline.private.json').read_bytes());need(baseline['head']==base and json.loads((backup/'first-result.json').read_bytes())['success']is True,'SUCCESSFUL_ORIGINAL_BACKUP')
    return pins,baseline


def run(args,data=None,timeout=20,cap=32*1024**2,optional=False):
    need(data is None,'NO_COMMAND_INPUT_REQUIRED')
    p=subprocess.Popen(args,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,cwd=ROOT);out=bytearray();end=time.monotonic()+timeout
    try:
        while True:
            remaining=end-time.monotonic();need(remaining>0 and select.select([p.stdout],[],[],remaining)[0],'READ_COMMAND_DEADLINE')
            block=os.read(p.stdout.fileno(),65536)
            if not block:break
            need(len(out)+len(block)<=cap,'READ_COMMAND_OUTPUT_BOUND');out.extend(block)
        code=p.wait(timeout=max(.01,end-time.monotonic()))
        if optional and code:return None
        need(code==0,'READ_COMMAND_SUCCEEDED');return bytes(out)
    finally:
        if p.poll()is None:p.kill();p.wait(timeout=2)
        p.stdout.close()


def compressed(data,offset):
    need(0<=offset<len(data),'COMPRESSED_INDEX_BOUND')
    x=data[offset]
    count=1 if x<128 else 2 if x<192 else 4 if x<224 else 0
    need(count and offset+count<=len(data),'COMPRESSED_INDEX_ENCODING')
    return int.from_bytes(data[offset:offset+count],'big')&((1<<(7 if count==1 else 14 if count==2 else 29))-1),offset+count


def pdb_documents(data):
    """Read only Portable PDB Document rows and exact SHA256 source blobs."""
    need(24<=len(data)<=MAX_FILE and data[:4]==b'BSJB','PORTABLE_PDB_HEADER')
    u32=lambda n:struct.unpack_from('<I',data,n)[0]
    version=u32(12);need(version<=256 and 16+version+4<=len(data),'PDB_VERSION_BOUND')
    pos=(16+version+3)&~3;count=struct.unpack_from('<H',data,pos+2)[0];pos+=4;streams={}
    need(count<=16,'PDB_STREAM_COUNT')
    for _ in range(count):
        need(pos+9<=len(data),'PDB_STREAM_HEADER')
        offset,size=struct.unpack_from('<II',data,pos);end=data.find(b'\0',pos+8,pos+40)
        need(end!=-1 and offset+size<=len(data),'PDB_STREAM_BOUNDS')
        name=data[pos+8:end].decode('ascii');need(name not in streams,'UNIQUE_PDB_STREAM')
        streams[name]=data[offset:offset+size];pos=(end+4)&~3
    need({'#Pdb','#~','#Blob','#GUID'}<=set(streams),'PDB_REQUIRED_STREAMS')
    identity=streams['#Pdb'][:20];table=streams['#~'];blobs=streams['#Blob'];guids=streams['#GUID']
    need(len(identity)==20 and len(table)>=24,'PDB_TABLE_HEADER')
    valid=struct.unpack_from('<Q',table,8)[0];need(not valid&((1<<48)-1),'PDB_DOCUMENT_FIRST_TABLE')
    tables=[i for i in range(64)if valid>>i&1];need(48 in tables and 24+4*len(tables)<=len(table),'PDB_DOCUMENT_TABLE')
    counts=struct.unpack_from('<'+'I'*len(tables),table,24);rows=counts[tables.index(48)]
    need(rows<=10000,'PDB_DOCUMENT_COUNT')
    blob_width=4 if table[6]&4 else 2;guid_width=4 if table[6]&2 else 2
    offset=24+4*len(tables);width=2*blob_width+2*guid_width;need(offset+rows*width<=len(table),'PDB_DOCUMENT_ROWS')
    def blob(index):
        size,start=compressed(blobs,index);need(size<=1024**2 and start+size<=len(blobs),'PDB_BLOB_BOUND')
        return blobs[start:start+size]
    documents={}
    for row in range(rows):
        pos=offset+row*width;values=[]
        for size in [blob_width,guid_width,blob_width,guid_width]:
            values.append(int.from_bytes(table[pos:pos+size],'little'));pos+=size
        name,algorithm,digest,_=values;need(0<algorithm<=len(guids)//16,'PDB_HASH_GUID')
        need(str(uuid.UUID(bytes_le=guids[(algorithm-1)*16:algorithm*16]))=='8829d00f-11b8-4213-878b-770e8597ac16','PDB_SHA256_REQUIRED')
        parts=blob(name);need(parts and parts[0]in(47,92),'PDB_PATH_SEPARATOR');pieces=[];index=1
        while index<len(parts):
            component,index=compressed(parts,index);pieces.append(blob(component).decode('utf-8'))
        path=chr(parts[0]).join(pieces).replace('\\','/');digest=blob(digest)
        need(path not in documents and len(digest)==32,'UNIQUE_SOURCE_SHA256')
        documents[path]=digest.hex()
    return identity,documents


def pdb_matches_assembly(dll,identity):
    need(len(dll)<=MAX_FILE and len(dll)>=64 and dll[:2]==b'MZ','ASSEMBLY_PE_HEADER')
    pe=struct.unpack_from('<I',dll,60)[0];need(pe+24<=len(dll)and dll[pe:pe+4]==b'PE\0\0','PE_HEADER_BOUND')
    sections=struct.unpack_from('<H',dll,pe+6)[0];optional=pe+24;size=struct.unpack_from('<H',dll,pe+20)[0]
    need(optional+size+40*sections<=len(dll)and 0<sections<=96,'PE_SECTION_BOUND')
    magic=struct.unpack_from('<H',dll,optional)[0];need(magic in(0x10b,0x20b),'PE_OPTIONAL_HEADER')
    directory=optional+(112 if magic==0x20b else 96)+48;need(directory+8<=optional+size,'PE_DEBUG_DIRECTORY')
    rva,length=struct.unpack_from('<II',dll,directory)
    def raw(address):
        for i in range(sections):
            vs,va,rs,rp=struct.unpack_from('<IIII',dll,optional+size+i*40+8)
            if va<=address<va+max(vs,rs):
                value=rp+address-va;need(value<len(dll),'PE_RVA_BOUND');return value
        raise ValueError('PE_DEBUG_RVA')
    pos=raw(rva);need(length<=28*100 and length%28==0 and pos+length<=len(dll),'PE_DEBUG_BOUND')
    for index in range(pos,pos+length,28):
        _,stamp,_,_,kind,size,_,pointer=struct.unpack_from('<IIHHIIII',dll,index)
        if kind!=2:continue
        need(pointer+size<=len(dll)and size>=24,'CODEVIEW_BOUND');entry=dll[pointer:pointer+size]
        if entry[:4]==b'RSDS'and entry[4:20]==identity[:16]and struct.unpack_from('<I',entry,20)[0]==1 and struct.pack('<I',stamp)==identity[16:]:return True
    return False


def container_file(cid,path,optional=False):
    data=run(['docker','cp',cid+':'+path,'-'],timeout=15,cap=MAX_FILE+65536,optional=optional)
    if data is None:return None
    with tarfile.open(fileobj=io.BytesIO(data))as archive:
        files=archive.getmembers();need(len(files)==1 and files[0].isreg()and files[0].size<=MAX_FILE,'ONE_REGULAR_CODE_FILE')
        raw=archive.extractfile(files[0]).read(MAX_FILE+1);need(len(raw)==files[0].size,'COMPLETE_CODE_FILE');return raw


def repository(path):return run(['git','show',TARGET+':'+path])


def tracked(prefix):return [p for p in run(['git','ls-tree','-rz','--name-only',TARGET,'--',prefix]).decode().split('\0')if p]


def exact_files(cid,prefix,files):
    hashes={}
    for relative in files:
        expected=repository(prefix+relative);actual=container_file(cid,'/app/'+relative)
        need(sha(expected)==sha(actual),'DEPLOYED_SOURCE_BYTES_MATCH_TARGET');hashes[relative]=sha(actual)
    return hashes


def inspect(cid):
    value=json.loads(run(['docker','inspect',cid]));need(len(value)==1 and value[0]['Id']==cid,'EXACT_CONTAINER_INSPECT');return value[0]


def address(cid,port):
    networks=inspect(cid)['NetworkSettings']['Networks'];ips=[v['IPAddress']for v in networks.values()if v.get('IPAddress')]
    need(len(ips)==1 and ipaddress.ip_address(ips[0]).is_private,'ONE_PRIVATE_SERVICE_ADDRESS')
    return 'http://'+ips[0]+':'+str(port)


def get(base,path,cap=MAX_FILE):
    need(path.startswith('/')and not path.startswith('//')and '..'not in path,'FIXED_GET_PATH')
    opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),NoRedirect())
    with opener.open(base+path,timeout=5)as response:
        raw=response.read(cap+1);need(response.status==200 and len(raw)<=cap,'BOUNDED_SERVICE_GET');return raw


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*_):return None


def assets(cid,root,base,prefix,features):
    raw=run(['docker','exec',cid,'find',root,'-type','f']);paths=raw.decode().splitlines()
    need(0<len(paths)<=1000 and all(p.startswith(root+'/')and re.fullmatch(r'[A-Za-z0-9_./@-]+',p)for p in paths),'BOUNDED_STATIC_BUILD_FILES')
    combined=[];hashes={};total=0
    for path in sorted(paths):
        rel=path[len(root)+1:]
        if rel!='index.html'and not rel.startswith('assets/'):continue
        body=container_file(cid,path);total+=len(body);need(total<=64*1024**2,'TOTAL_STATIC_BUILD_BODY_BOUND');hashes[rel]=sha(body)
        need(get(base,'/'+rel)==body,'SERVED_STATIC_BYTES_MATCH_CONTAINER')
        if rel.endswith('.js'):combined.append(body.decode('utf-8'))
        if rel=='index.html':need(prefix.encode()in body,'CORRECT_FRONTEND_BASE_PATH')
    text='\n'.join(combined);text=re.sub(r'\\u([a-fA-F0-9]{4})',lambda m:chr(int(m[1],16)),text)
    need('index.html'in hashes and all(marker in text for marker in features),'INDEX_AND_NEW_FRONTEND_FEATURES_PRESENT')
    return hashes


def source_proof(cid):
    files=tracked(INDO+'src')
    expected={p[len(INDO):]:sha(repository(p))for p in files if p.endswith('.cs')}
    changed=run(['git','diff','--name-only','-z','52c090589d6da542fee74ef17c8edd3b0dfe4fe6',TARGET,'--',INDO+'src']).decode().split('\0')
    required={p[len(INDO):]for p in changed if p.endswith('.cs')};found=set();proof={};available=True
    for assembly in ['IndoShipping.Api','IndoShipping.Infrastructure','IndoShipping.Domain']:
        dll=container_file(cid,'/app/'+assembly+'.dll');pdb=container_file(cid,'/app/'+assembly+'.pdb',True)
        row={'assemblySHA256':sha(dll),'portablePdbAvailable':pdb is not None,'sourceDocumentsMatched':0}
        if pdb is None:available=False;proof[assembly]=row;continue
        identity,documents=pdb_documents(pdb);need(pdb_matches_assembly(dll,identity),'PDB_LINKED_TO_ACTUAL_ASSEMBLY')
        row['portablePdbSHA256']=sha(pdb)
        for path,digest in documents.items():
            matches=[name for name in expected if path.endswith('/'+name)]
            if not matches:
                generated={assembly+'.GlobalUsings.g.cs',assembly+'.AssemblyInfo.cs',assembly+'.MvcApplicationPartsAssemblyInfo.cs','.NETCoreApp,Version=v8.0.AssemblyAttributes.cs'}
                need('/obj/Release/net8.0/'in path and pathlib.PurePosixPath(path).name in generated,'ONLY_KNOWN_SDK_GENERATED_PDB_DOCUMENTS')
                continue
            need(len(matches)==1 and expected[matches[0]]==digest,'COMPILED_SOURCE_DOCUMENT_MATCHES_TARGET');found.add(matches[0]);row['sourceDocumentsMatched']+=1
        proof[assembly]=row
    need(not available or required<=found,'ALL_CHANGED_RUNTIME_CS_DOCUMENTS_MATCH')
    return {'sourceProofComplete':available and required<=found,'missingPdbIsExplicitSourceEvidenceLimitation':not available,'changedSourceDocuments':len(required),'assemblies':proof}


PDF_SMOKE=r'''
import json,pathlib,tempfile
from unified_pdf import generate_unified_report_pdf,_bundled_logo
from pypdf import PdfReader
if not _bundled_logo():raise RuntimeError('SYNTHETIC_LOGO_CHECK')
with tempfile.TemporaryDirectory(prefix='release-synthetic-pdf-')as tmp:
 p={'report_no':'SYNTHETIC-ACCEPTANCE','revision':7,'result_reason':'SYNTHETIC-REASON',
    'remarks':'\n'.join('SYNTHETIC-NOTE-%03d'%i for i in range(100)),
    'photo_slots':[{'label':'Defect evidence','category':'defect','photos':[{'file_path':str(pathlib.Path(tmp)/'absent.png'),'sample_id':'SYNTHETIC-SAMPLE'}]}]}
 r=PdfReader(generate_unified_report_pdf(p,pathlib.Path(tmp)/'synthetic.pdf'));text='\n'.join(page.extract_text()for page in r.pages)
 if not all(s in text for s in ['SYNTHETIC-REASON','SYNTHETIC-NOTE-099','SYNTHETIC-SAMPLE']):raise RuntimeError('SYNTHETIC_MARKER_CHECK')
 if not all('SYNTHETIC-ACCEPTANCE | Rev.7'in page.extract_text()and('Page %d of %d'%(i,len(r.pages)))in page.extract_text()for i,page in enumerate(r.pages,1)):raise RuntimeError('SYNTHETIC_PAGE_IDENTITY_CHECK')
 print(json.dumps({'syntheticPdfGenerated':True,'pageCount':len(r.pages),'allRequiredMarkersPreserved':True}))
'''


QMS_SMOKE=r'''
const fs=require('fs'),vm=require('vm'),{DatabaseSync}=require('node:sqlite');
const s=fs.readFileSync('/app/server/server.js','utf8');const c=vm.runInNewContext(s.slice(s.indexOf('const RECORD_COLS'),s.indexOf('function replaceUsers'))+';({SCHEMA_SQL,upsertRecords,deleteRecords,nextRecordId})');
const d=new DatabaseSync(':memory:');d.exec(c.SCHEMA_SQL);c.upsertRecords(d,[{id:1,updatedAt:'2026-10-19T01:00:00Z',aqlLevel:'MAJ0.65,MIN2.5',status:'approved'}]);
if(d.prepare('SELECT aqlLevel FROM records WHERE id=1').get().aqlLevel!=='MAJ0.65,MIN2.5')throw Error();
c.upsertRecords(d,[{id:1,updatedAt:'2026-10-18T01:00:00Z',status:'pending'}]);if(d.prepare('SELECT status FROM records WHERE id=1').get().status!=='approved')throw Error();
c.deleteRecords(d,[1]);if(c.upsertRecords(d,[{id:1,updatedAt:'2099-01-01T00:00:00Z'}]).skippedTomb!==1)throw Error();
if(c.upsertRecords(d,[{id:c.nextRecordId(d),updatedAt:'2026-10-19T02:00:00Z'}]).accepted!==1)throw Error();d.close();
console.log(JSON.stringify({syntheticMemoryDatabaseOnly:true,aqlRoundTrip:true,staleApprovalProtected:true,tombstoneAndHighWaterPassed:true}));
'''


ENV_CLASSIFIER_SHA256='9ba097453d46298d6e16e8a3ea5051f08dbe1e3cf39711ef4c8f75bc4f257480'

def environment_proof(before,after):
 path=pathlib.Path(__file__).with_name('release-environment-proof.py')
 need(path.is_file() and not path.is_symlink() and re.fullmatch('[a-f0-9]{64}',ENV_CLASSIFIER_SHA256 or '') and hashlib.sha256(path.read_bytes()).hexdigest()==ENV_CLASSIFIER_SHA256,'reviewedEnvironmentOrderProofBytes')
 spec=importlib.util.spec_from_file_location('release_environment_reviewed',path);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
 proof=module.prove(before,after,run)
 need(type(proof) is dict and set(proof)==TARGETS,'completeTargetEnvironmentProof')
 for service,row in proof.items():
  need(type(row) is dict and set(row)=={'passed','classification','changedKeys','addedKeys','removedKeys','strictArraySHAEqual'} and type(row['passed']) is bool and row['classification'] in {'identical-array','identical-map-order-only','changed-or-unproven'} and type(row['strictArraySHAEqual']) is bool and all(type(row[k]) is list and len(row[k])<=1000 and all(type(v) is str and re.fullmatch('[A-Za-z_][A-Za-z0-9_]*',v) for v in row[k]) for k in ('changedKeys','addedKeys','removedKeys')) and (not row['passed'] or (row['classification'] in {'identical-array','identical-map-order-only'} and row['strictArraySHAEqual']==(row['classification']=='identical-array') and all(not row[k] for k in ('changedKeys','addedKeys','removedKeys')))) and row['strictArraySHAEqual']==(before['services'][service]['environmentSHA256']==after['services'][service]['environmentSHA256']),'safeEnvironmentProofShape')
 return proof

def classified_runtime_checks(before,after,strict):
 proof=environment_proof(before,after);checks={k:v for k,v in strict.items() if k!='targetConfigurationUnchanged'}
 checks['targetMountsResourcesAndHealthcheckUnchanged']=all(all(before['services'][s][k]==after['services'][s][k] for k in ('mounts','memory','swap','healthcheck')) for s in TARGETS)
 checks['targetEnvironmentMapsIdentical']=all(row['passed'] for row in proof.values())
 return checks,proof

def main():
    stage('FROZEN_PINS')
    need(PIN_FROZEN and re.fullmatch('[a-f0-9]{40}',TARGET or '')and all(re.fullmatch('[a-f0-9]{64}',x or '')for x in [BACKUP_MANIFEST,BACKUP_RESULT]),'FROZEN_TARGET_AND_BACKUP_PINS')
    need(os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_ATTEMPT')=='1','FIRST_FIXED_OPS_BRANCH_RUN')
    stage('RUNTIME_READER')
    raw=run(['git','show',DEPENDENCY_COMMIT+':'+DEPENDENCY_PATH]);need(sha(raw)==DEPENDENCY_SHA,'REVIEWED_RUNTIME_READER_BYTES')
    m={'__name__':'reviewed_runtime_only','__file__':__file__};exec(compile(raw,'reviewed-runtime-reader','exec'),m);m['run']=run
    lib=m['load_library'](pathlib.Path(__file__).with_name('release-data-library.py'))
    stage('BACKUP_METADATA')
    backup=m['BACKUP'];pins,baseline=backup_metadata(lib,backup,m['BASE'])
    stage('INITIAL_RUNTIME_AND_SOURCE')
    initial=m['runtime']();need(run(['git','rev-parse','HEAD']).decode().strip()==TARGET,'FINAL_DEPLOYED_GIT_HEAD')
    run(['git','diff','--quiet',TARGET,'--',QC,QUOTE,FACTORY,REPORT,INDO])
    strict=m['runtime_checks'](baseline['runtime'],initial);checks,proof=classified_runtime_checks(baseline['runtime'],initial,strict);need(all(checks.values()),'HEALTHY_TARGETS_AND_PROTECTED_CONFIGURATION')
    need(lib.file_hash(ROOT/'.env.cloud.production')==baseline['envSHA256'],'ENVIRONMENT_FILE_UNCHANGED')
    stage('EXCLUSIVE_OUTPUT')
    output=backup.with_name(backup.name+'-code-acceptance-v2');output.mkdir(mode=0o700)
    result={'completed':False,'sourceProofComplete':False,'checks':checks,'strictRuntimeChecks':strict,'environmentOrderProof':proof,'target':TARGET,'failedStage':None,'businessCrudOrLoginPerformed':False,'allBusinessDataPreservationHandledSeparately':True,'services':{}}
    try:
        services=initial['services']
        for service,prefix,files in [('qc',QC,['app.js','qc-backend.js','server/server.js']),
             ('internal-quote',QUOTE,['backend/services/'+n for n in ['exportMixedTax.js','exportXlsx.js','mixedQuotation.js','quoteCostSummary.js','quoteSummary.js','verificationSummary.js']]+['frontend/'+n for n in ['mixed-quotation.js','quote.html','sewing-tax.js','verification.html','workbench.js']]),
             *[(name,REPORT,['app.py','ai_service.py','unified_pdf.py','worker.py','templates/new_report.html','assets/tigerhead_logo.png'])for name in ['qc-report','qc-report-worker']]]:
            stage('SOURCE_BYTES',service);result['services'][service]={'sourceSHA256':exact_files(services[service]['id'],prefix,files)}
        stage('SYNTHETIC_MEMORY_FUNCTIONS','qc')
        result['services']['qc']['syntheticFunctionChecks']=json.loads(run(['docker','exec',services['qc']['id'],'node','-e',QMS_SMOKE]))
        stage('SYNTHETIC_PDF','qc-report')
        result['services']['qc-report']['syntheticPdfCheck']=json.loads(run(['docker','exec',services['qc-report']['id'],'python','-c',PDF_SMOKE],timeout=30))
        for service,port,route,key in [('qc',3400,'/api/health','ok'),('internal-quote',3211,'/health','status'),('qc-report',3410,'/health','status'),('indo-shipping',5180,'/api/health','ok'),('factory-review',8090,'/api/health','code'),('factory-review-test',8090,'/api/health','code')]:
            stage('READONLY_HEALTH',service);base=address(services[service]['id'],port);health=json.loads(get(base,route,16384))
            need(health.get(key)==(200 if key=='code'else'ok'if key=='status'else True),'READONLY_HEALTH_OK')
            row=result['services'].setdefault(service,{});row['health200']=True
            if service=='indo-shipping':
                stage('COMPILED_SOURCE',service)
                row['compiledCode']=source_proof(services[service]['id'])
                stage('STATIC_ASSETS',service)
                row['staticAssetsSHA256']=assets(services[service]['id'],'/app/wwwroot',base,'/indo-shipping/',['合并采购单','确认合并'])
            if service.startswith('factory-review'):
                stage('BUILD_REVISION',service)
                revision=(inspect(services[service]['id'])['Config'].get('Labels')or{}).get('org.opencontainers.image.revision','')
                need(bool(re.fullmatch('[a-f0-9]{40}',revision)),'FACTORY_BUILD_REVISION')
                run(['git','merge-base','--is-ancestor',revision,TARGET]);need(run(['git','rev-parse',revision+':'+FACTORY.rstrip('/')])==run(['git','rev-parse',TARGET+':'+FACTORY.rstrip('/')]),'FACTORY_BUILD_SOURCE_TREE_MATCH')
                row['sourceSHA256']={}
                stage('HOOK_AND_MIGRATION_SOURCE',service)
                for path in [*tracked(FACTORY+'pb_hooks'),*tracked(FACTORY+'pb_migrations')]:
                    rel=path[len(FACTORY):];actual=container_file(services[service]['id'],'/pb/'+rel)
                    need(sha(actual)==sha(repository(path)),'FACTORY_RUNTIME_HOOK_AND_MIGRATION_SOURCE');row['sourceSHA256'][rel]=sha(actual)
                stage('STATIC_ASSETS',service);row['buildRevision']=revision;row['staticAssetsSHA256']=assets(services[service]['id'],'/pb/pb_public',base,'/'+service+'/',['多次巡查对比','导入 Excel','文件中同一工厂重复'])
        stage('FINAL_RUNTIME_AND_METADATA')
        final=m['runtime']();need(final==initial,'ALL_CONTAINER_IDENTITIES_AND_CONFIG_STABLE_DURING_ACCEPTANCE')
        need(all(lib.file_hash(backup/name)==value for name,value in pins.items()),'ORIGINAL_METADATA_REMAINS_UNCHANGED')
        need(lib.file_hash(ROOT/'.env.cloud.production')==baseline['envSHA256']and run(['git','rev-parse','HEAD']).decode().strip()==TARGET,'FINAL_SOURCE_AND_ENV_STABLE')
        result['sourceProofComplete']=result['services']['indo-shipping']['compiledCode']['sourceProofComplete'];result['completed']=True
    except BaseException:result['safeFailure']='CODE_ASSET_OR_RUNTIME_ACCEPTANCE_FAILED';result['failedStage']=failed_stage()
    finally:
        stage('SEAL_PRIVATE_RESULT')
        lib.private_write(output/'first-result.json',m['enc'](result));lib.seal(output)
        print(json.dumps({'completed':result['completed'],'sourceProofComplete':result['sourceProofComplete'],'target':TARGET,'failedStage':result['failedStage'],'checks':checks,'serviceEvidenceRecorded':sorted(result['services']),'resultSHA256':lib.file_hash(output/'first-result.json'),'manifestSHA256':lib.file_hash(output/'manifest.json')},sort_keys=True))
    return 0 if result['completed']else 1


if __name__=='__main__':
    try:sys.exit(main())
    except Exception:print(json.dumps({'completed':False,'safeFailure':'FIXED_RELEASE_CODE_ACCEPTANCE_REJECTED','failedStage':failed_stage()}));sys.exit(1)
