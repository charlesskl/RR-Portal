"""Closed, read-only replay of one sealed synthetic candidate failure; no network/Docker."""
import ast,base64,copy,hashlib,io,json,os,pathlib,re,socket,stat,subprocess,sys,types,zlib
from unittest.mock import patch
ROOT=pathlib.Path('/opt/rr-portal');BRANCH='refs/heads/ops/qc-provider-429-20261021';PROBE_PIN=True
TARGET='b4c3763fe43e30c80c041c70e7a9f0750145d7b0';TREE='57085d6dcd242f154b4dbb199e54a71061abbd4d';IMAGE='sha256:b6c79a60b27494caa916ff2a1a1f3bea6f8d1d2c89b6e5fd7458b6dd52fdff42'
ARCHIVE=ROOT/'deploy/backups/qc-provider-429-20261021-candidate-check';MANIFEST='347d8c0624be7dd070c4e0399413d4da87ae74baf97e04bb5b42cd7290ac1feb';RESULT='91baa345fe3d61b191cd23e093d75d2d46baeb0fea18f26a648aec218080b18c';OUT=ROOT/'deploy/backups/qc-provider-429-20261021-candidate-audit-02';QC='apps/QA部/QC成品报告系统'
ERRORS={'AIConfigurationError','AIInputError','AITransportError','AIResponseError','AIValidationError','TimeoutError','functional_verification'}
PUBLIC_KEYS=set('Id Name Image Config HostConfig Mounts NetworkSettings RestartCount state health Running Paused Restarting Dead OOMKilled StartedAt Pid Env Labels Cmd Entrypoint User WorkingDir Hostname Domainname ExposedPorts Volumes StopSignal Healthcheck AttachStdin AttachStdout AttachStderr Tty OpenStdin StdinOnce ArgsEscaped OnBuild Shell Dns DnsOptions DnsSearch Binds ReadonlyRootfs Memory MemorySwap MemoryReservation NanoCpus CpuShares CpusetCpus NetworkMode PortBindings LogConfig Type Driver Opts Name Source Destination Mode RW Propagation SandboxID SandboxKey Networks Ports Gateway IPAddress IPPrefixLen GlobalIPv6Address GlobalIPv6PrefixLen MacAddress EndpointID NetworkID Aliases DNSNames DriverOpts IPAMConfig Links HairpinMode LinkLocalIPv6Address LinkLocalIPv6PrefixLen SecondaryIPAddresses SecondaryIPv6Addresses Bridge MaximumRetryCount RestartPolicy SecurityOpt CapAdd CapDrop PidsLimit CgroupnsMode ShmSize Ulimits IpcMode PidMode Privileged Runtime'.split())
def enc(v):return json.dumps(v,sort_keys=True,ensure_ascii=True,separators=(',',':'),allow_nan=False).encode()
def sha(v):return hashlib.sha256(v).hexdigest()
def need(v):
 if not v:raise RuntimeError('QC_FAILURE_PROBE_REJECTED')
def read(p,limit=16*1024*1024):need(p.is_file()and not p.is_symlink()and p.stat().st_size<=limit);return p.read_bytes()
def run(args):
 p=subprocess.run(args,cwd=ROOT,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,timeout=30);need(p.returncode==0 and len(p.stdout)<=1024**2);return p.stdout

def seal():
 need(ARCHIVE.is_dir()and not ARCHIVE.is_symlink()and stat.S_IMODE(ARCHIVE.stat().st_mode)==0o700);need(sha(read(ARCHIVE/'manifest.json'))==MANIFEST and sha(read(ARCHIVE/'first-result.json'))==RESULT);manifest=json.loads(read(ARCHIVE/'manifest.json'));paths=list(ARCHIVE.rglob('*'));need(len(paths)<=1000 and all(not p.is_symlink()and(p.is_dir()or p.is_file())and p.stat().st_mode&0o077==0 for p in paths));need(set(manifest)=={str(p.relative_to(ARCHIVE))for p in paths if p.is_file()and p.name!='manifest.json'})
 for name,digest in manifest.items():need(type(name)is str and not pathlib.PurePosixPath(name).is_absolute()and '..'not in pathlib.PurePosixPath(name).parts and re.fullmatch('[a-f0-9]{64}',digest)and sha(read(ARCHIVE/name))==digest)
 receipt=json.loads(read(ARCHIVE/'first-result.json'));need(receipt.get('success')is False and receipt.get('target')==TARGET and receipt.get('tree')==TREE and receipt.get('workerImageID')==IMAGE and receipt.get('candidateContainerRemoved')is True);return manifest

def denied(*a,**k):raise RuntimeError('NETWORK_FORBIDDEN')
def modules(envelope):
 need(run(['git','rev-parse',TARGET+'^{tree}']).decode().strip()==TREE);sources={name:run(['git','show',TARGET+':'+QC+'/'+name])for name in('ai_service.py','bailian_adapter.py')};need({k:sha(v)for k,v in sources.items()}==envelope['moduleSHA256']);result={}
 for name,source in sources.items():
  label=name[:-3];module=types.ModuleType(label);module.__file__='sealed/'+name;sys.modules[label]=module;exec(compile(source,module.__file__,'exec'),module.__dict__);result[label]=module
 return result,sources

def message(exc,sources):
 text=str(exc);match=re.fullmatch(r'(Structured output (?:has invalid type|has invalid enum|is missing fields|has unexpected fields|has too few items|number is too small|number is too large)) at (\$(?:\.[a-z_]{1,80}|\[[0-9]{1,6}\])*)',text)
 if match:return {'message':match[1],'path':match[2]}
 literals={node.exc.args[0].value for source in sources.values()for node in ast.walk(ast.parse(source))if isinstance(node,ast.Raise)and isinstance(node.exc,ast.Call)and isinstance(node.exc.func,ast.Name)and node.exc.func.id in {'AIValidationError','AIResponseError','AdapterResponseError'}and node.exc.args and isinstance(node.exc.args[0],ast.Constant)and type(node.exc.args[0].value)is str and len(node.exc.args[0].value)<=250}
 return {'message':text if text in literals and '\n'not in text else 'Validation failed; raw error withheld','path':None}

def markers(pdf):
 found={'po':set(),'item':set()};need(len(pdf)<=65536)
 for match in re.finditer(rb'stream\r?\n(.*?)endstream',pdf,re.S):
  stream=match[1].strip()
  if stream.endswith(b'~>'):stream=base64.a85decode(stream,adobe=True)
  decoder=zlib.decompressobj();stream=decoder.decompress(stream,65537);need(len(stream)<=65536 and decoder.eof)
  for label,prefix in [('po',b'PO'),('item',b'SKU')]:found[label].update(v.decode()for v in re.findall(rb'\b'+prefix+rb'[A-F0-9]{12}\b',stream))
 need(all(len(v)==1 for v in found.values()));return {k:next(iter(v))for k,v in found.items()}

def replay(envelope,raw,pdf,loaded,sources):
 ai=loaded['ai_service'];adapter=loaded['bailian_adapter'];result={'savedBodyJSONParsed':False,'savedBodyTruncated':envelope.get('rawResponses',{}).get('po',{}).get('truncated')is True,'validationPassed':False};expected=markers(pdf);result['expectedNonceSHA256']={k:sha(v.encode())for k,v in expected.items()};value=None
 try:
  value=json.loads(raw);result['savedBodyJSONParsed']=True;choices=value.get('choices');choice=choices[0]if type(choices)is list and len(choices)==1 and type(choices[0])is dict else{};reason=choice.get('finish_reason');result['finishReason']=reason if reason in {'stop','length','content_filter','tool_calls','function_call'}else'unknown';detail=value.get('error',{});result['providerError']={k:v for k,v in detail.items()if k in ('code','type')and type(v)is str and v in(set(ai._PROVIDER_ERROR_CODES)|set(ai._PROVIDER_ERROR_TYPES))}if type(detail)is dict else{}
  response=adapter.normalize_response(value);data=ai._extract_structured_json(response,request_id='sealed-offline');result['structuredJSONParsed']=True
  fields=data.get('document_fields')if type(data)is dict else None;items=data.get('items')if type(data)is dict else None;item=items[0].get('fields')if type(items)is list and items and type(items[0])is dict else None
  def field(container,name):
   f=container.get(name)if type(container)is dict else None;return f.get('normalized_value')if type(f)is dict else None
  po=field(fields,'po_number');sku=field(item,'item_number');quantity=field(item,'ordered_quantity');result['normalizedFields']={'poNonceMatches':po==expected['po'],'itemNonceMatches':sku==expected['item'],'quantityMatches7':quantity=='7','itemCount':len(items)if type(items)is list else None,'poValueSHA256':sha(enc(po)),'itemValueSHA256':sha(enc(sku)),'quantityValueSHA256':sha(enc(quantity))}
  result['validationStage']='structural-schema';ai._check_schema(data,ai.PO_EXTRACTION_SCHEMA);result['validationStage']='review-and-evidence';ai._enforce_review_flags(data);ai._sanitize_field_evidence(data,source_kind='page');ai._validate_po_data(data,source_kind='page');result['validationPassed']=True
 except Exception as exc:
  result['exceptionType']=type(exc).__name__ if type(exc).__name__ in ERRORS|{'AdapterResponseError','JSONDecodeError'}else'validation_failure';result['validationError']=message(exc,sources)
 return result

def shape(value):
 result={'rootType':type(value).__name__}
 if type(value)is list:result.update(arrayLength=len(value),elementTypes={name:sum(type(item).__name__==name for item in value)for name in sorted({type(item).__name__ for item in value})})
 return result

def shape_diagnostic(envelope,raw,pdf,loaded,sources):
 result={'diagnosticOnly':True,'productAdapterChanged':False,'unwrapApplied':False}
 try:
  value=json.loads(raw);content=value['choices'][0]['message']['content'];parsed=json.loads(content,parse_constant=denied);result['contentJSONShape']=shape(parsed);candidate=None
  if type(parsed)is list and len(parsed)==1 and type(parsed[0])is dict:candidate=parsed[0];result['unwrapKind']='exact-singleton-object-array'
  elif type(parsed)is str:
   try:
    inner=json.loads(parsed,parse_constant=denied);result['encodedStringJSONShape']=shape(inner)
    if type(inner)is dict:candidate=inner;result['unwrapKind']='exact-encoded-object-string'
   except Exception:result['encodedStringJSONParsed']=False
  if candidate is not None:
   changed=copy.deepcopy(value);changed['choices'][0]['message']['content']=json.dumps(candidate,ensure_ascii=True,separators=(',',':'));result['unwrapApplied']=True;result['unwrappedValidation']=replay(envelope,enc(changed),pdf,loaded,sources)
 except Exception:result['shapeParsed']=False
 return result

def segment(key):return key if key in PUBLIC_KEYS or key in {'com.docker.compose.service','com.docker.compose.project'}else'keySHA256_'+sha(str(key).encode())[:16]
def diffs(before,after,path='$',out=None):
 out=[]if out is None else out;need(len(out)<=2000)
 if type(before)is dict and type(after)is dict:
  for key in sorted(set(before)|set(after)):
   p=path+'.'+segment(key)
   if key not in before or key not in after:out.append({'path':p,'beforeSHA256':sha(enc(before.get(key))),'afterSHA256':sha(enc(after.get(key))),'presenceChanged':True})
   else:diffs(before[key],after[key],p,out)
 elif type(before)is list and type(after)is list:
  if len(before)!=len(after):out.append({'path':path+'.length','beforeSHA256':sha(enc(len(before))),'afterSHA256':sha(enc(len(after)))})
  for i,(a,b)in enumerate(zip(before,after)):diffs(a,b,path+'['+str(i)+']',out)
 elif before!=after or type(before)is not type(after):out.append({'path':path,'beforeSHA256':sha(enc(before)),'afterSHA256':sha(enc(after))})
 return out

def container_diff(before,after):
 result=[]
 for cid in sorted(set(before)|set(after)):
  a=before.get(cid,{});b=after.get(cid,{});row=b or a;labels=(row.get('Config')or{}).get('Labels')or{};service=labels.get('com.docker.compose.service');service=service if type(service)is str and re.fullmatch('[a-zA-Z0-9_.-]{1,80}',service)else'unknown';delta=diffs(a,b)
  if delta:
   result.append({'service':service,'containerIDSHA256':sha(cid.encode()),'changes':delta,'presenceChanged':(cid in before)!=(cid in after),'restartCountChanged':a.get('RestartCount')!=b.get('RestartCount'),'startedAtChanged':a.get('state',{}).get('StartedAt')!=b.get('state',{}).get('StartedAt'),'pidChanged':a.get('state',{}).get('Pid')!=b.get('state',{}).get('Pid'),'healthChanged':a.get('health')!=b.get('health'),'runningChanged':a.get('state',{}).get('Running')!=b.get('state',{}).get('Running'),'networkMetadataChanged':a.get('NetworkSettings')!=b.get('NetworkSettings'),'configChanged':a.get('Config')!=b.get('Config'),'hostConfigChanged':a.get('HostConfig')!=b.get('HostConfig')})
 def semantic(rows):
  result=copy.deepcopy(rows)
  for row in result.values():
   if type(row.get('Mounts'))is list:row['Mounts']=sorted(row['Mounts'],key=enc)
  return result
 normalizedEqual=semantic(before)==semantic(after)
 return {'beforeCount':len(before),'afterCount':len(after),'changedContainers':result,'allOriginalContainersUnchanged':before==after,'allOriginalContainersSemanticallyUnchangedAfterMountSort':normalizedEqual,'mountOrderOnlyDifference':before!=after and normalizedEqual}

def probe():
 need(PROBE_PIN and os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_ATTEMPT')=='1');original=seal();envelope=json.loads(read(ARCHIVE/'candidate-functional-envelope.private.json',512*1024));raw=read(ARCHIVE/'candidate-po-response.private.bin',65536);pdf=read(ARCHIVE/'candidate-synthetic.pdf',65536);need(base64.b64decode(envelope['rawResponses']['po']['bodyB64'],validate=True)==raw and base64.b64decode(envelope['fixtures']['synthetic.pdf'],validate=True)==pdf)
 result={'mode':'candidate-audit-02','target':TARGET,'tree':TREE,'workerImageID':IMAGE,'providerRequestsPerformed':0,'dockerMutationsPerformed':0,'businessWritesPerformed':False,'queueWritesPerformed':False,'sealedArchiveVerified':True,'safeErrorType':envelope.get('safeErrorType')if envelope.get('safeErrorType')in ERRORS else'unknown','httpStatus':{p:v for p,v in envelope.get('httpStatuses',{}).items()if p in('po','photos')and(type(v)is int and 100<=v<=599 or v is None)}}
 saved={k:sys.modules.get(k)for k in('ai_service','bailian_adapter')}
 try:
  with patch('socket.create_connection',denied),patch('socket.socket.connect',denied),patch('urllib.request.urlopen',denied),patch('urllib.request.OpenerDirector.open',denied):loaded,sources=modules(envelope);result['offlineValidation']=replay(envelope,raw,pdf,loaded,sources);result['responseShapeDiagnostic']=shape_diagnostic(envelope,raw,pdf,loaded,sources)
 finally:
  for key,module in saved.items():
   if module is None:sys.modules.pop(key,None)
   else:sys.modules[key]=module
 result['containerComparison']=container_diff(json.loads(read(ARCHIVE/'all-original-containers-before.private.json')),json.loads(read(ARCHIVE/'all-original-containers-after.private.json')));need(seal()==original);result['sealedArchiveUnchanged']=True;result['success']=True;return result

def private(name,value):
 fd=os.open(OUT/name,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
 with os.fdopen(fd,'wb')as f:f.write(enc(value));f.flush();os.fsync(f.fileno())
 return sha(enc(value))
def main():
 need(len(sys.argv)==2 and sys.argv[1]=='candidate-audit-02'and PROBE_PIN);os.umask(0o077);OUT.mkdir(mode=0o700)
 try:result=probe()
 except Exception:result={'mode':'candidate-audit-02','success':False,'safeFailure':'QC_FAILURE_PROBE_REJECTED'}
 digest=private('first-result.json',result);msha=private('manifest.json',{'first-result.json':digest});print(enc(dict(result,resultSHA256=digest,manifestSHA256=msha)).decode(),flush=True);return 0 if result['success']else 1
if __name__=='__main__':
 try:code=main()
 except Exception:print('{"mode":"candidate-audit-02","success":false,"safeFailure":"QC_FAILURE_PROBE_GATE_REJECTED"}',flush=True);code=1
 sys.exit(code)
