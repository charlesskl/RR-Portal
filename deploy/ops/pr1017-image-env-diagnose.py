"""Inert one-shot read-only image-default diagnosis. Only private evidence OUT writes.
No builds, container signals, DB commands, config edits, log output or retries.
"""
import datetime,hashlib,json,os,pathlib,re,stat,subprocess,sys
ROOT=pathlib.Path('/opt/rr-portal')
OUT=ROOT/'deploy/backups/pr-1017-20261027-image-env-diagnose'
BRANCH='refs/heads/ops/pr-1017-20261027'
TARGET='b9f72141b44e7a692d2ccbab32d6846f8e9d3dcb'
TREE='3a57ff94c283d51a0d1c8fae614fc5340fb47ce0'
APP='apps/印尼小组/印尼走货明细'
APP_TREE='f5ce3705a671dad40438e12b8b20525d689b4492'
PHASE='diagnose'
EXECUTE=False
OLD_IMAGE='sha256:97d550653a347053a7f9dbd6ed38f9d3bbe05316871a19c4562dbc843a52f83f'
CANDIDATE_TAG='rr-portal-indo-shipping-pr1017:'+TARGET
INDO_CID='a16eeec4a409e780f65358d7603fcc09188ef3fd20fc43de5b6160975cf26ed2'
DB_CID='8254d29504edda8d8a83d759f14a8c924d6c6f146c65c580c73331abef1270f4'
BACKUP=ROOT/'deploy/backups/pr-1017-20261027-backup'
FAILED_PREPARE=ROOT/'deploy/backups/pr-1017-20261027-prepare'
BACKUP_MANIFEST='9cf202aba946d1c0e034e91f2e3d0afe4d513cb0c300edc5fce80e3287f30a1f'
BACKUP_RESULT='deef46a9a914176b81fcbad6bce4a9aa43f0af655c1d47d319f7e53e4fed153b'
FAILED_MANIFEST='5f5e26bfdc928b3e7d7b2ae1ce47cd3fb3445bb2714dabc14bf0193c9823405f'
FAILED_RESULT='0a40d0c2115a034da79c155828e26ea17d447b60a3e4e01c968b22cde6364a47'
PUBLIC_VERSION_KEYS={'DOTNET_VERSION','ASPNET_VERSION'}
DEFAULT_FIELDS=('Cmd','Entrypoint','User','WorkingDir','Healthcheck','ExposedPorts','Volumes','StopSignal','Shell','ArgsEscaped','StopTimeout')
STAGE='entry'
def need(v,label):
 global STAGE
 if not v:STAGE=label;raise RuntimeError(label)
def enc(v):return json.dumps(v,sort_keys=True,separators=(',',':'),ensure_ascii=True,allow_nan=False).encode()
def sha(v):return hashlib.sha256(v).hexdigest()
def private(name,data):
 fd=os.open(OUT/name,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
 with os.fdopen(fd,'wb')as f:f.write(data if type(data)is bytes else enc(data));f.flush();os.fsync(f.fileno())
def read(p,limit=8*1024**2):
 need(p.is_file()and not p.is_symlink(),'regular-readonly-evidence');before=p.stat();need(before.st_size<=limit,'bounded-readonly-evidence')
 with os.fdopen(os.open(p,os.O_RDONLY|os.O_NOFOLLOW),'rb')as f:raw=f.read(limit+1);after=os.fstat(f.fileno())
 need(len(raw)<=limit and(before.st_ino,before.st_size,before.st_mtime_ns)==(after.st_ino,after.st_size,after.st_mtime_ns),'stable-readonly-evidence');return raw
def archive(path,manifest_sha,result_sha,mode,success):
 need(path.is_dir()and not path.is_symlink()and stat.S_IMODE(path.stat().st_mode)==0o700,'known-private-archive')
 manifest=read(path/'manifest.json');result=read(path/'first-result.json',131072);need(sha(manifest)==manifest_sha and sha(result)==result_sha,'actual-consumed-archive-seals');m=json.loads(manifest);r=json.loads(result);need(r.get('mode')==mode and r.get('success')is success,'expected-archive-outcome');return m,r

def used(path,name,manifest,limit=8*1024**2):
 need(type(name)is str and str(pathlib.PurePosixPath(name))==name and not pathlib.PurePosixPath(name).is_absolute()and'..'not in pathlib.PurePosixPath(name).parts,'fixed-archive-member');raw=read(path/name,limit);need(sha(raw)==manifest.get(name),'sealed-used-archive-member');return raw

def run(args):
 p=subprocess.run(args,stdout=subprocess.PIPE,stderr=subprocess.PIPE,cwd=ROOT,timeout=30)
 need(p.returncode==0 and len(p.stdout)<=2*1024**2,'bounded-readonly-command');return p.stdout

def one(service,cid):
 ids=run(['docker','ps','-aq','--no-trunc','--filter','label=com.docker.compose.project=rr-portal','--filter','label=com.docker.compose.service='+service]).decode().split();need(ids==[cid],'same-existing-service-id');rows=json.loads(run(['docker','inspect',cid]));need(len(rows)==1 and rows[0]['Id']==cid,'exact-runtime-read');r=rows[0];need(r['State']['Running']and not r['State']['OOMKilled']and r['State'].get('Health',{}).get('Status')=='healthy','existing-service-healthy');return r

def environment(values):
 need(type(values)is list,'env-list');result={}
 for item in values:
  need(type(item)is str,'env-string');k,sep,v=item.partition('=');need(sep and re.fullmatch('[A-Za-z_][A-Za-z0-9_]{0,127}',k)and k not in result,'unique-safe-env-key');result[k]=v
 return result

def differences(old,new):
 keys=sorted(k for k in set(old)|set(new)if old.get(k)!=new.get(k)or(k in old)!=(k in new));result=[]
 for k in keys:
  need(type(k)is str and re.fullmatch('[A-Za-z0-9_.:/-]{1,200}',k),'safe-difference-key');result.append({'key':k,'oldExists':k in old,'newExists':k in new,'oldSHA256':sha(enc(old[k]))if k in old else None,'newSHA256':sha(enc(new[k]))if k in new else None})
 return result

def env_difference(old_values,new_values):
 old=environment(old_values);new=environment(new_values);rows=differences(old,new)
 for row in rows:
  k=row['key']
  if k in PUBLIC_VERSION_KEYS and type(old.get(k))is str and type(new.get(k))is str and re.fullmatch(r'8\.0\.(0|[1-9][0-9]*)',old[k])and re.fullmatch(r'8\.0\.(0|[1-9][0-9]*)',new[k]):row.update(oldPublicVersion=old[k],newPublicVersion=new[k])
 return {'changed':rows,'changedKeys':[x['key']for x in rows],'listExactEqual':old_values==new_values,'mapExactEqual':old==new,'keyOrderEqual':list(old)==list(new),'oldEnvSHA256':sha(enc(old_values)),'newEnvSHA256':sha(enc(new_values)),'onlyStrictPublicVersionChanges':bool(rows)and all(x['key']in PUBLIC_VERSION_KEYS and'oldPublicVersion'in x for x in rows)}

def diagnose():
 fm,fr=archive(FAILED_PREPARE,FAILED_MANIFEST,FAILED_RESULT,'prepare',False);need(fr.get('target')==TARGET and fr.get('tree')==TREE and fr.get('failedStage')=='candidate-default-env-byte-list-unchanged','exact-failed-prepare-evidence')
 bm,br=archive(BACKUP,BACKUP_MANIFEST,BACKUP_RESULT,'backup',True);baseline=json.loads(used(BACKUP,'baseline.private.json',bm));old_runtime=json.loads(used(BACKUP,'target-inspect.private.json',bm))['indo-shipping'];old_record=json.loads(used(BACKUP,'indo-shipping-image.private.json',bm));literal=json.loads(used(BACKUP,'indo-shipping-literal-configured-environment.private.json',bm))
 need(run(['git','rev-parse','HEAD']).decode().strip()==TARGET and run(['git','rev-parse','HEAD^{tree}']).decode().strip()==TREE and run(['git','rev-parse','HEAD:'+APP]).decode().strip()==APP_TREE,'current-canonical-reviewed-source')
 raw_env=read(ROOT/'.env.cloud.production');need(raw_env==used(BACKUP,'environment.private',bm),'entire-environment-file-unchanged');st=(ROOT/'.env.cloud.production').stat();need({'mode':stat.S_IMODE(st.st_mode),'uid':st.st_uid,'gid':st.st_gid}==baseline['environmentFileMetadata'],'environment-file-mode-owner-unchanged')
 for name,expected in baseline['configuration'].items():
  p=ROOT/name;need(type(name)is str and not pathlib.PurePosixPath(name).is_absolute()and'..'not in pathlib.PurePosixPath(name).parts,'known-host-config-path');raw=read(p);st=p.stat();need(sha(raw)==expected['sha256']and{'mode':stat.S_IMODE(st.st_mode),'uid':st.st_uid,'gid':st.st_gid}=={k:expected[k]for k in('mode','uid','gid')},'fixed-source-and-global-config-preserved')
 live=one('indo-shipping',INDO_CID);db=one('db',DB_CID)
 need(live['Id']==old_runtime['Id']and live['Image']==old_runtime['Image']==OLD_IMAGE and all(live[k]==old_runtime[k]for k in('Config','HostConfig','Mounts','RestartCount'))and all(live['State'][k]==old_runtime['State'][k]for k in('StartedAt','Pid')),'exact-original-live-runtime-contract')
 dbo=baseline['runtime']['others'][DB_CID];need(db['Image']==dbo['image']and db['State']['StartedAt']==dbo['started']and db['RestartCount']==dbo['restarts']and sha(enc(dict(db['Config'],Env=sorted(db['Config'].get('Env')or[]))))==dbo['configSHA256']and sha(enc(db['HostConfig']))==dbo['hostConfigSHA256'],'existing-database-runtime-contract')
 old=json.loads(run(['docker','image','inspect',OLD_IMAGE]))[0];new=json.loads(run(['docker','image','inspect',CANDIDATE_TAG]))[0];need(old['Id']==OLD_IMAGE and old['Config']==old_record['Config']and re.fullmatch('sha256:[a-f0-9]{64}',new['Id'])and(new['Config'].get('Labels')or{}).get('org.opencontainers.image.revision')==TARGET,'exact-original-and-built-candidate-images')
 private('old-image.private.json',old);private('candidate-image.private.json',new)
 delta=env_difference(old['Config'].get('Env')or[],new['Config'].get('Env')or[]);config=differences({k:v for k,v in old['Config'].items()if k not in('Env','Labels')},{k:v for k,v in new['Config'].items()if k not in('Env','Labels')});labels=differences(old['Config'].get('Labels')or{},new['Config'].get('Labels')or{})
 new_env=environment(new['Config'].get('Env')or[]);need(environment(old_runtime['Config'].get('Env')or[])==literal,'original-literal-runtime-environment')
 again=one('indo-shipping',INDO_CID);need(again['Config']==live['Config']and again['HostConfig']==live['HostConfig']and again['Image']==live['Image']and again['State']['StartedAt']==live['State']['StartedAt']and again['State']['Pid']==live['State']['Pid']and again['RestartCount']==live['RestartCount'],'unchanged-runtime-during-readonly-diagnosis')
 return {'liveBackendImage':OLD_IMAGE,'image':new['Id'],'candidateTag':CANDIDATE_TAG,'environment':delta,'otherConfigDifferences':config,'labelDifferences':labels,'checkedImageDefaultFieldsEqual':all(old['Config'].get(k)==new['Config'].get(k)for k in DEFAULT_FIELDS),'candidateDefaultsCoveredByOriginalLiteral':dict(new_env,**literal)==literal,'platformEqual':old['Architecture']==new['Architecture']and old['Os']==new['Os'],'liveCID':INDO_CID,'databaseCID':DB_CID,'bothExistingServicesHealthy':True,'originalLiveRuntimeUnchanged':True,'databaseRuntimeUnchanged':True,'wholeEnvironmentFileAndFixedSourceConfigUnchanged':True,'environmentFileSHA256':sha(raw_env),'failedPrepareManifestSHA256':FAILED_MANIFEST,'failedPrepareResultSHA256':FAILED_RESULT,'backupManifestSHA256':BACKUP_MANIFEST,'backupResultSHA256':BACKUP_RESULT,'candidateSourceRevisionLabelMatchesTarget':True,'noBuildSignalsDatabaseCommandsConfigChangesOrRetries':True}

def main():
 need(EXECUTE is True and sys.argv[1:]==[PHASE]and os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_ATTEMPT')=='1'and os.environ.get('RELEASE_MODE')==PHASE,'inert-exact-first-image-env-diagnosis');os.umask(0o077);need(not OUT.exists()and not OUT.is_symlink(),'one-new-diagnosis-output');OUT.mkdir(mode=0o700);result={'phase':PHASE,'target':TARGET,'success':False}
 try:result.update(diagnose());result['success']=True
 except Exception as e:result.update(errorType=type(e).__name__,stage=STAGE)
 result['utc']=datetime.datetime.now(datetime.timezone.utc).isoformat();private('result.private.json',result);result['resultSHA256']=sha(enc(result));result['sha256Wire']={k:[int(c,16)for c in(v.split(':',1)[1]if v.startswith('sha256:')else v)]for k,v in result.items()if type(v)is str and re.fullmatch('(?:sha256:)?[a-f0-9]{64}|[a-f0-9]{40}',v)};print(json.dumps(result,sort_keys=True),flush=True);return 0 if result['success']else 1
if __name__=='__main__':sys.exit(main())
