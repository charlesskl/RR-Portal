"""Read-only process metadata comparison; no environment values or service changes."""
import pathlib,subprocess,json,os,sys,hashlib
PIN=True
assert PIN and sys.argv[1:]==['verify']and os.environ.get('RELEASE_BRANCH')=='refs/heads/ops/pr-981-20261021'and os.environ.get('RELEASE_ATTEMPT')=='1'
root=pathlib.Path('/opt/rr-portal/deploy/backups/pr-981-20261021-backup');manifest=json.loads((root/'manifest.json').read_bytes());assert hashlib.sha256((root/'manifest.json').read_bytes()).hexdigest()=='1f09e9e07ad438b8bcc61d2d48626af52da83e4e30b5c0a97e1857a89217e9cf';p=root/'factory-inspect.private.json';assert hashlib.sha256(p.read_bytes()).hexdigest()==manifest[p.name];old=json.loads(p.read_bytes());rows={}
for service in('factory-review-test','factory-review'):
 image=json.loads(subprocess.check_output(['docker','image','inspect','rr-portal-'+service+'-981:67385924fc40958701843411b3731d2eeb90b2ad'],timeout=30))[0];fields={}
 for k in('Cmd','Entrypoint','User','WorkingDir','Healthcheck'):
  a,b=old[service]['Config'].get(k),image['Config'].get(k);fields[k]={'equal':a==b,'oldType':type(a).__name__,'candidateType':type(b).__name__,'oldEmpty':a in(None,'',[]),'candidateEmpty':b in(None,'',[])}
 rows[service]={'fields':fields,'candidateRevision':image['Config'].get('Labels',{}).get('org.opencontainers.image.revision'),'image':image['Id']}
print(json.dumps({'mode':'verify','success':True,'processMetadataComparison':rows,'businessWritesPerformed':False,'containerChangesPerformed':False}),flush=True)
