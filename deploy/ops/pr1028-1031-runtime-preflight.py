"""Inert minimal read-only Quote/Spray runtime and canonical-alias preflight.
No environment/config body, log, business data, SQL or lifecycle access.
Only this preflight's new private EXCL evidence directory is written.
TARGET is observation metadata; root may bind it to then-current merged main.
"""
import os,json,pathlib,re,subprocess,sys,hashlib
EXECUTE=True
BRANCH='refs/heads/ops/pr-1027-clone-diagnostic-20261028'
ROOT=pathlib.Path('/opt/rr-portal')
OUT=ROOT/'deploy/backups/pr1028-1031-runtime-preflight-1'
TARGET='dc7d673dfe1d441e97550c6c7d42901b3e0322ff'
SERVICES=('internal-quote','sprayplan')
ALIASES={'internal-quote':'rr-portal-internal-quote:latest','sprayplan':'rr-portal-sprayplan:latest'}
FORMAT='{"id":{{json .Id}},"image":{{json .Image}},"started":{{json .State.StartedAt}},"restarts":{{json .RestartCount}},"running":{{json .State.Running}},"health":{{if .State.Health}}{{json .State.Health.Status}}{{else}}null{{end}},"revision":{{with index .Config.Labels "org.opencontainers.image.revision"}}{{json .}}{{else}}null{{end}}}'
def need(value,label):
 if not value:raise RuntimeError(label)

def enc(value):return json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=True,allow_nan=False).encode()

def sha(value):return hashlib.sha256(value).hexdigest()

def command(args):
 p=subprocess.run(args,cwd=ROOT,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=20)
 need(len(p.stdout)+len(p.stderr)<=1024**2,'bounded-readonly-command-output');return p

def safe_runtime(value):
 need(type(value)is dict and set(value)=={'id','image','started','restarts','running','health','revision'},'only-fixed-runtime-fields')
 need(type(value['id'])is str and re.fullmatch('[a-f0-9]{64}',value['id'])and type(value['image'])is str and re.fullmatch('sha256:[a-f0-9]{64}',value['image']),'typed-runtime-identities')
 need(type(value['started'])is str and re.fullmatch('[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:[.][0-9]{1,9})?(?:Z|[+-][0-9]{2}:[0-9]{2})',value['started']),'typed-runtime-start-time')
 need(type(value['restarts'])is int and 0<=value['restarts']<=1000000000 and type(value['running'])is bool,'typed-runtime-state')
 if value['revision']=='':value=dict(value,revision=None)
 need(value['health']in(None,'healthy','unhealthy','starting')and(value['revision']is None or type(value['revision'])is str and re.fullmatch('[a-f0-9]{40}',value['revision'])),'typed-health-and-public-revision')
 return dict(value,health=value['health']or'absent')

def image_identity(reference):
 p=command(['docker','image','inspect','--format','{{.Id}}',reference]);value=p.stdout.decode().strip()
 if p.returncode!=0:return {'present':False}
 need(re.fullmatch('sha256:[a-f0-9]{64}',value)is not None,'typed-image-id-only');return {'present':True,'id':value}

def current_runtime(service):
 need(service in SERVICES,'only-two-fixed-formal-services')
 p=command(['docker','ps','-aq','--no-trunc','--filter','label=com.docker.compose.project=rr-portal','--filter','label=com.docker.compose.service='+service])
 ids=p.stdout.decode().split();need(p.returncode==0 and len(ids)==1 and re.fullmatch('[a-f0-9]{64}',ids[0]),'one-fixed-current-formal-service')
 p=command(['docker','inspect','--format',FORMAT,ids[0]]);need(p.returncode==0,'safe-runtime-format-success');return safe_runtime(json.loads(p.stdout))

def main():
 need(EXECUTE is True and sys.argv[1:]==['diagnose']and os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_MODE')=='diagnose'and os.environ.get('RELEASE_ATTEMPT')=='1','inert-first-preflight')
 need(re.fullmatch('[a-f0-9]{40}',TARGET)is not None,'bound-observation-metadata-target')
 os.umask(0o077);need(OUT.parent.is_dir()and not OUT.parent.is_symlink()and not OUT.exists()and not OUT.is_symlink(),'fresh-own-private-preflight');OUT.mkdir(mode=0o700)
 result={'phase':'diagnose','target':TARGET,'success':False,'readOnly':True,'atomicAcrossObservations':False,'runtimeAndAliasOnly':True}
 try:
  result['services']={}
  for service in SERVICES:result['services'][service]={'runtime':current_runtime(service),'canonicalAlias':image_identity(ALIASES[service])}
  result['success']=True
 except Exception as e:result['errorType']=type(e).__name__
 result['resultSHA256']=sha(enc(result));result['sha256Wire']={'target':[int(c,16)for c in TARGET]}
 fd=os.open(OUT/'result.private.json',os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
 with os.fdopen(fd,'wb')as stream:stream.write(enc(result));stream.flush();os.fsync(stream.fileno())
 print(json.dumps(result,sort_keys=True),flush=True);return 0 if result['success']else 1
if __name__=='__main__':sys.exit(main())
