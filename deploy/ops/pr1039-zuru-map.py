"""Callable-only, seven-key item-map update. No import-time I/O or authority changes.
The service must be stopped and the caller must own the sole writer window. Full
SHA/inode checks reject observed races; no retry, rollback or state restoration.
"""
import copy
import hashlib
import json
import os
import pathlib
import re
import stat
import uuid

DELTA={'157145':({'cn_name':'牙齿怪兽','workshop':'兴信A','schedule_name':'牙齿怪兽'},{'cn_name':'牙齿怪兽','workshop':'A-华嘉','schedule_name':'牙齿怪兽'}),'15752':({'cn_name':'牙齿怪兽','workshop':'A-华嘉','schedule_name':'牙齿怪兽'},{'cn_name':'牙齿怪兽','workshop':'兴信A','schedule_name':'牙齿怪兽'}),'71184':(None,{'cn_name':'客版眼镜蛇','workshop':'兴信A','schedule_name':'恐龙系列'}),'77965':(None,{'cn_name':'3PK双色龙','workshop':'华登','schedule_name':'双色龙'}),'MEC494':(None,{'cn_name':'157131+157130+157128','workshop':'兴信A','schedule_name':'牙齿怪兽'}),'MSLD192':(None,{'cn_name':'77772','workshop':'兴信B','schedule_name':'迷你唱片球'}),'MSLD227':(None,{'cn_name':'牙齿怪兽','workshop':'兴信A','schedule_name':'牙齿怪兽'})}
LIMIT=8*1024**2

class MapRejected(RuntimeError):
    ambiguousMutation=False

class MapCommitUnconfirmed(MapRejected):
    """A replace was attempted; preserve evidence and reconcile, never replay."""
    ambiguousMutation=True

def _need(value,label):
    if not value:raise MapRejected(label)

def _enc(value):return json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=True,allow_nan=False).encode()
def _sha(body):return hashlib.sha256(body).hexdigest()
def _key(s):return(s.st_dev,s.st_ino,s.st_mode,s.st_uid,s.st_gid,s.st_size,s.st_mtime_ns,s.st_ctime_ns)
def _meta(s):return {'type':'REG','uid':s.st_uid,'gid':s.st_gid,'mode':stat.S_IMODE(s.st_mode),'bytes':s.st_size,'mtimeNs':s.st_mtime_ns}
def _pairs(rows):
    result={}
    for k,v in rows:
        _need(k not in result,'duplicate-json-key');result[k]=v
    return result

def _decode(body):
    try:
        value=json.loads(body,object_pairs_hook=_pairs,parse_constant=lambda _:(_ for _ in()).throw(MapRejected('nonfinite-json-number')))
        _need(type(value)is dict and value and all(type(k)is str for k in value),'nonempty-item-map-object');_enc(value);return value
    except(MapRejected,ValueError,TypeError,UnicodeError)as e:
        raise MapRejected('invalid-item-map-json')from e

def plan(live_dict,delta=DELTA):
    _need(type(live_dict)is dict and bool(live_dict) and all(type(k)is str for k in live_dict),'nonempty-item-map-object');_enc(live_dict)
    _need(type(delta)is dict and bool(delta),'nonempty-reviewed-delta');out=copy.deepcopy(live_dict);changed=added=already=0
    for k,pair in delta.items():
        _need(type(k)is str and type(pair)in(tuple,list) and len(pair)==2,'typed-reviewed-delta');old,new=pair
        _need(type(new)is dict and set(new)=={'cn_name','workshop','schedule_name'} and all(type(v)is str for v in new.values()),'three-reviewed-item-fields')
        if old is not None:
            _need(type(old)is dict and set(old)==set(new) and {n:old[n]for n in old if n!='workshop'}=={n:new[n]for n in new if n!='workshop'},'existing-only-workshop-delta')
            v=out.get(k);_need(type(v)is dict and v.get('workshop')in(old['workshop'],new['workshop']),'existing-workshop-conflict')
            if v['workshop']==new['workshop']:already+=1
            else:v['workshop']=new['workshop'];changed+=1
        elif k not in out:out[k]=copy.deepcopy(new);added+=1
        else:
            v=out[k];_need(type(v)is dict and all(v.get(n)==x for n,x in new.items()),'new-item-conflict');already+=1
    unaffected=lambda d:{k:v for k,v in d.items()if k not in delta}
    before=_sha(_enc(unaffected(live_dict)));after=_sha(_enc(unaffected(out)));_need(before==after,'unaffected-items-semantically-exact')
    return out,{'beforeCount':len(live_dict),'afterCount':len(out),'entriesBefore':len(live_dict),'entriesAfter':len(out),'existingWorkshopsChanged':changed,'newItemsAdded':added,'alreadyTarget':already,'unaffectedEntries':len(unaffected(out)),'unaffectedCanonicalSHA256':before,'allUnrelatedItemValuesPreserved':True}

def _path(value):
    p=pathlib.Path(value);_need(p.is_absolute()and '..'not in p.parts and bool(p.name),'absolute-fixed-map-path')
    for q in(p.parent,*p.parent.parents):
        s=q.lstat();_need(stat.S_ISDIR(s.st_mode)and not stat.S_ISLNK(s.st_mode),'regular-no-symlink-parent')
    return p

def _parent(path):
    _path(path);fd=os.open(path.parent,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
    try:_need((os.fstat(fd).st_dev,os.fstat(fd).st_ino)==(path.parent.stat().st_dev,path.parent.stat().st_ino),'stable-parent-directory');return fd
    except BaseException:os.close(fd);raise

def _read_at(fd,name):
    f=os.open(name,os.O_RDONLY|os.O_NOFOLLOW,dir_fd=fd)
    try:
        a=os.fstat(f);_need(stat.S_ISREG(a.st_mode)and a.st_size<=LIMIT,'regular-bounded-map-file');body=bytearray()
        while len(body)<=LIMIT:
            chunk=os.read(f,min(1024**2,LIMIT+1-len(body)))
            if not chunk:break
            body.extend(chunk)
        z=os.fstat(f);q=os.stat(name,dir_fd=fd,follow_symlinks=False);_need(_key(a)==_key(z)==_key(q)and len(body)==a.st_size,'stable-full-map-read');return bytes(body),a
    finally:os.close(f)

def _write_at(fd,name,body,source,keep_time=False,cleanup_on_error=False):
    f=os.open(name,os.O_RDWR|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600,dir_fd=fd)
    created=os.fstat(f)
    try:
        offset=0
        while offset<len(body):
            n=os.write(f,body[offset:]);_need(n>0,'complete-map-evidence-write');offset+=n
        s=os.fstat(f)
        if(s.st_uid,s.st_gid)!=(source.st_uid,source.st_gid):os.fchown(f,source.st_uid,source.st_gid)
        os.fchmod(f,stat.S_IMODE(source.st_mode))
        if keep_time:os.utime(f,ns=(source.st_atime_ns,source.st_mtime_ns))
        os.fsync(f);s=os.fstat(f);_need((s.st_uid,s.st_gid,stat.S_IMODE(s.st_mode),s.st_size)==(source.st_uid,source.st_gid,stat.S_IMODE(source.st_mode),len(body)),'map-file-metadata-preserved');return s
    except BaseException:
        if cleanup_on_error:
            try:
                q=os.stat(name,dir_fd=fd,follow_symlinks=False)
                if(q.st_dev,q.st_ino)==(created.st_dev,created.st_ino):os.unlink(name,dir_fd=fd)
            except FileNotFoundError:pass
        raise
    finally:os.close(f)

def atomic_patch(path,expected_full_sha,archive_path):
    _need(type(expected_full_sha)is str and re.fullmatch('[a-f0-9]{64}',expected_full_sha)is not None,'fixed-before-map-sha')
    path=_path(path);backup=_path(archive_path);_need(path!=backup and path.parent not in backup.parents,'archive-outside-live-data-directory')
    parent=_parent(path);archive=None;temp=None;temp_stat=None;attempted=False
    try:
        body,before=_read_at(parent,path.name);_need(_sha(body)==expected_full_sha,'before-map-full-sha-cas');old=_decode(body);new,summary=plan(old)
        encoded=json.dumps(new,ensure_ascii=False,indent=2,allow_nan=False).encode();_need(len(encoded)<=LIMIT,'bounded-updated-item-map')
        archive=_parent(backup);saved=_write_at(archive,backup.name,body,before,True);os.fsync(archive);saved_body,saved_stat=_read_at(archive,backup.name)
        _need(saved_body==body and _meta(saved_stat)==_meta(before),'exact-original-map-backup-bytes-and-metadata')
        if new==old:
            current,s=_read_at(parent,path.name);_need(current==body and _key(s)==_key(before),'unchanged-map-idempotent-cas');return dict(summary,beforeSHA256=_sha(body),afterSHA256=_sha(body),backupSHA256=_sha(body),beforeMeta=_meta(before),afterMeta=_meta(s),replacementPerformed=False)
        temp='.pr1039-item-map-'+uuid.uuid4().hex+'.tmp';temp_stat=_write_at(parent,temp,encoded,before,cleanup_on_error=True);prepared,q=_read_at(parent,temp);_need(prepared==encoded and _key(q)==_key(temp_stat),'exact-new-map-temp-before-commit')
        _path(path);current,s=_read_at(parent,path.name);_need(current==body and _key(s)==_key(before),'immediate-full-sha-and-inode-map-cas')
        _need((path.parent.stat().st_dev,path.parent.stat().st_ino)==(os.fstat(parent).st_dev,os.fstat(parent).st_ino),'same-live-parent-before-commit')
        attempted=True;os.replace(temp,path.name,src_dir_fd=parent,dst_dir_fd=parent);temp=None;os.fsync(parent)
        committed,after=_read_at(parent,path.name);_need(committed==encoded and _decode(committed)==new and (after.st_uid,after.st_gid,stat.S_IMODE(after.st_mode))==(before.st_uid,before.st_gid,stat.S_IMODE(before.st_mode)),'committed-map-content-and-metadata-exact')
        return dict(summary,beforeSHA256=_sha(body),afterSHA256=_sha(committed),backupSHA256=_sha(saved_body),beforeMeta=_meta(before),afterMeta=_meta(after),replacementPerformed=True)
    except BaseException as e:
        if attempted:raise MapCommitUnconfirmed('map-commit-requires-readonly-reconciliation-no-replay')from e
        raise
    finally:
        if temp is not None and temp_stat is not None:
            try:
                s=os.stat(temp,dir_fd=parent,follow_symlinks=False)
                if(s.st_dev,s.st_ino)==(temp_stat.st_dev,temp_stat.st_ino):os.unlink(temp,dir_fd=parent)
            except FileNotFoundError:pass
        if archive is not None:os.close(archive)
        os.close(parent)
