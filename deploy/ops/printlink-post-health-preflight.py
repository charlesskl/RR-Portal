"""Fast read-only post-deploy status; deliberately no SQLite audit or process signals."""
import hashlib,importlib.util,json,pathlib,re,sys,time


def load(name,file):
    spec=importlib.util.spec_from_file_location(name,file)
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module


def main():
    directory=pathlib.Path(__file__).parent
    v=load('verifier',directory/'printlink-post-health-verify.py')
    result={'readOnly':True,'preflightComplete':False,'isFinalDataPreservationProof':False}
    try:
        lib=v.library();v.require(lib['git_commit']()==v.MERGE_HEAD,'EXACT_POSTDEPLOY_HEAD')
        v.require(lib['file_hash'](v.BACKUP/'first-result.json')==v.BACKUP_RESULT_SHA
            and lib['file_hash'](v.BACKUP/'manifest.json')==v.BACKUP_MANIFEST_SHA,'EXACT_RETAINED_BACKUP_RECEIPT')
        resource=directory/'printlink-runtime-resources.py'
        v.require(hashlib.sha256(resource.read_bytes()).hexdigest()==v.RESOURCE_SHA,'REVIEWED_RESOURCE_PIN')
        m=load('resources',resource);m.DEADLINE=time.monotonic()+40
        old=json.loads((v.BACKUP/'container-before.private.json').read_bytes())
        inspection=lib['inspect']('rr-portal-printlink-1')
        result['head']=v.MERGE_HEAD;result['state']=m.inspection()
        result['newContainer']=inspection['Id']!=old['id'];result['newImage']=inspection['Image']!=old['image']
        result['sameRuntimeMount']=[x for x in inspection['Mounts']if x['Destination']=='/app/runtime']==old['mounts']
        result['sameEnvironment']=lib['digest'](sorted(inspection['Config']['Env']))==old['environmentSHA256']
        result['directHealthcheck']=inspection['Config']['Healthcheck']['Test']==['CMD','node','ops/healthcheck.mjs']
        result['otherContainersUnchanged']=lib['other_containers']()==json.loads((v.BACKUP/'other-containers.private.json').read_bytes())
        try:
            rows,_=m.processes();counts={'legacy':0,'direct':0};roles={}
            for row in rows:
                roles[row['role']]=roles.get(row['role'],0)+1
                try:kind=v.probe_kind(m.read('/proc/'+str(row['pid'])+'/cmdline'))
                except FileNotFoundError:continue
                if kind:counts[kind]+=1
            result['processRoles']=roles;result['probeCounts']=counts
        except Exception:result['processSnapshotUnavailable']=True
        data,truncated=m.command(['docker','logs','--timestamps','--since','15m','--tail','300',m.CTR],timeout=8,cap=1024*1024,merge_stderr=True)
        text=data.decode('utf8','replace')
        result['logEnums']={word:text.count(word)for word in ['数据目录正在使用或遗留锁未清理','子进程未及时停止','子服务退出','SIGKILL','生产业务内部服务已启动','PrintLink 生产']}
        result['logReadTruncated']=truncated
        try:result['directHTTPStatus']=v.get('http://127.0.0.1:3100/api/health',4096)[0]
        except Exception:result['directHTTPFailed']=True
        result['preflightComplete']=True
    except Exception as error:
        value=str(error);result['failureCode']=value if re.fullmatch('[A-Z_]{1,80}',value)else type(error).__name__
    print(json.dumps(result,ensure_ascii=False,sort_keys=True,separators=(',',':')))
    return 0 if result['preflightComplete']else 1


if __name__=='__main__':sys.exit(main())
