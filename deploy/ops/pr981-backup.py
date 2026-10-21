"""PR981: private read-only backup and safe effective AI configuration inventory."""
import hashlib,importlib.util,json,os,pathlib,re,sys
PIN=True
BASE='9b890cc016da403f929f8a7aaeddb878d3de24c5'
BRANCH='refs/heads/ops/pr-981-20261021'
OUT=pathlib.Path('/opt/rr-portal/deploy/backups/pr-981-20261021-backup')
DEPS={'factory-review-backup-library.py':'79d76bb47312dd08c121ebe2797f54d958666f8b72d00721f67712b152fc4666'}
def load(name):
 p=pathlib.Path(__file__).with_name(name)
 assert p.is_file() and not p.is_symlink() and hashlib.sha256(p.read_bytes()).hexdigest()==DEPS[name]
 spec=importlib.util.spec_from_file_location('pr981_backup_library',p);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
def public_ai(env,prefix='FACTORY_REVIEW_AI_'):
 base=env.get(prefix+'BASE_URL','');model=env.get(prefix+'MODEL','');provider=env.get(prefix+'PROVIDER','openai')
 assert len(base)<250 and re.fullmatch(r'https://[A-Za-z0-9./:_-]+|',base) and re.fullmatch(r'[A-Za-z0-9:._/-]{0,120}',model) and re.fullmatch(r'[A-Za-z0-9_-]{0,40}',provider)
 return {'enabled':env.get(prefix+'ENABLED')=='true','keyPresent':bool(env.get(prefix+'API_KEY')),'provider':provider,'model':model,'baseUrl':base}
def main():
 assert PIN and sys.argv[1:]==['backup'] and os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_ATTEMPT')=='1'
 os.umask(0o077);OUT.mkdir(mode=0o700)
 f=load('factory-review-backup-library.py');f.BASE=BASE;f.OUT=OUT;f.OPS=f.load('release-data-ops-library.py');f.OPS.L=f.OPS.load_library(pathlib.Path(__file__).with_name('release-data-library.py'));f.OPS.run=f.run
 result={'mode':'backup','success':False,'base':BASE,'businessWritesPerformed':False,'configurationChangesPerformed':False,'providerCallsPerformed':False}
 try:
  f.backup(result)
  runtime,raw=f.runtime();assert runtime==json.loads((OUT/'baseline.private.json').read_bytes())['runtime'];configs={s:public_ai(f.envmap(v['Config']['Env'])) for s,v in raw.items()}
  qc=[r for r in json.loads(f.run(['docker','inspect',*f.run(['docker','ps','-aq','--no-trunc']).decode().split()])) if (r['Config'].get('Labels')or{}).get('com.docker.compose.project')=='rr-portal' and (r['Config'].get('Labels')or{}).get('com.docker.compose.service')=='qc-report']
  assert len(qc)==1
  q=f.envmap(qc[0]['Config']['Env']);company=public_ai(dict(FACTORY_REVIEW_AI_BASE_URL=q.get('OPENAI_BASE_URL',''),FACTORY_REVIEW_AI_MODEL=q.get('OPENAI_MODEL',''),FACTORY_REVIEW_AI_API_KEY=q.get('OPENAI_API_KEY',''),FACTORY_REVIEW_AI_PROVIDER='qwen',FACTORY_REVIEW_AI_ENABLED='true'))
  result.update(effectiveAI=configs,companyAI=company,totalContainers=len(runtime['others'])+2,success=True)
 except BaseException:
  result.update(success=False,failedStage=f.STAGE)
 finally:
  f.OPS.L.private_write(OUT/'first-result.json',f.enc(result));f.OPS.L.seal(OUT)
  print(f.enc(dict(result,manifestSHA256=f.OPS.L.file_hash(OUT/'manifest.json'),resultSHA256=f.OPS.L.file_hash(OUT/'first-result.json'))).decode(),flush=True)
 return 0 if result['success'] else 1
if __name__=='__main__':
 try:sys.exit(main())
 except SystemExit:raise
 except BaseException:print('{"mode":"backup","success":false,"safeFailure":"PR981_BACKUP_REJECTED"}',flush=True);sys.exit(1)
