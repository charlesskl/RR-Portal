"""Pure PrintLink cutover comparison; no imports of applications or runtime I/O."""
import datetime,re
DATABASES={'orders/printlink.sqlite','production.sqlite'}
LOCK={'.platform-lock','.platform-lock/owner.json'}
def need(v,label):
 if not v:raise ValueError(label)
def strict_equal(a,b):
 if type(a)is not type(b):return False
 if type(a)is dict:return all(type(k)is str for k in a)and all(type(k)is str for k in b)and set(a)==set(b)and all(strict_equal(a[k],b[k])for k in a)
 if type(a)in{list,tuple}:return len(a)==len(b)and all(strict_equal(x,y)for x,y in zip(a,b))
 return type(a)in{str,int,float,bool,type(None)}and a==b
def stamp(value):
 need(type(value)is str,'exact-operational-timestamp-type');m=re.fullmatch(r'(\d{4}-\d\d-\d\d[T ]\d\d:\d\d:\d\d)(?:\.(\d{1,9}))?(Z|[+-]\d\d:\d\d)',value);need(m is not None,'exact-operational-timestamp');delta=datetime.datetime.fromisoformat(m[1]+m[3].replace('Z','+00:00')).astimezone(datetime.timezone.utc)-datetime.datetime(1970,1,1,tzinfo=datetime.timezone.utc);return(delta.days*86400+delta.seconds)*10**9+int((m[2]or'0').ljust(9,'0'))

def strict_metadata(value):return type(value)is dict and set(value)=={'mode','uid','gid'}and all(type(value[k])is int and value[k]>=0 for k in value)and value['mode']<=0o7777
def database_family(before,after):
 need(type(before)is dict and type(after)is dict,'database-family-map');allowed=DATABASES|{n+x for n in DATABASES for x in('-wal','-shm','-journal')}
 for m in(before,after):need(DATABASES<=set(m)<=allowed and all(strict_metadata(v)for v in m.values()),'only-two-databases-and-typed-companion-metadata')
 for n in set(before)&set(after):need(strict_equal(before[n],after[n]),'every-retained-main-and-companion-mode-owner-identical')
 for n in set(after)-set(before):
  main=next((m for m in DATABASES if n in{m+x for x in('-wal','-shm','-journal')}),None);need(main is not None and strict_equal(after[n],after[main]),'new-companion-matches-main-mode-owner')
 return{'retainedModeOwnersIdentical':True,'createdCompanions':sorted(set(after)-set(before)),'removedCompanions':sorted(set(before)-set(after)),'transientPresenceClaimedIdentical':False}
def validate_lock(value,owner,started,observed,present):
 inventory=value['files'];need(type(inventory)is list and all(type(r)is dict and type(r.get('path'))is str for r in inventory),'typed-full-file-inventory');rows={r['path']:r for r in inventory};need(len(rows)==len(inventory),'unique-file-paths');metadata=value['fileOwnership'];need(type(metadata)is dict and all(strict_metadata(v)for v in metadata.values()),'full-file-mode-owner-map');paths={n for n in rows if n=='.platform-lock'or n.startswith('.platform-lock/')};owned={n for n in metadata if n=='.platform-lock'or n.startswith('.platform-lock/')}
 if not present:need(not paths and not owned and owner is None,'graceful-stop-removed-only-own-platform-lock');return
 need(paths==owned==LOCK and type(owner)is dict and set(owner)=={'pid','purpose','created'}and type(owner['pid'])is int and owner['pid']==1 and owner['purpose']=='platform','exact-platform-lock-shape-pid-purpose');need(rows['.platform-lock']['directory']is True and strict_equal(rows['.platform-lock'],{'path':'.platform-lock','directory':True,'mode':0o700}),'exact-lock-directory');file=rows['.platform-lock/owner.json'];need(set(file)=={'path','directory','mode','bytes','sha256'}and file['directory']is False and type(file['mode'])is int and file['mode']==0o600 and type(file['bytes'])is int and 0<file['bytes']<=2048 and type(file['sha256'])is str and re.fullmatch('[a-f0-9]{64}',file['sha256']),'exact-lock-owner-file');a,b,c=stamp(started),stamp(owner['created']),stamp(observed);need(a<=b<=a+30*10**9and b<=c,'lock-created-within-exact-candidate-start-window');db=value['metadata']['production.sqlite'];need(all(metadata[n]['uid']==db['uid']and metadata[n]['gid']==db['gid']for n in LOCK),'lock-owner-equals-existing-node-database-owner');need(metadata['.platform-lock']['mode']==0o700 and metadata['.platform-lock/owner.json']['mode']==0o600,'exact-operational-lock-permissions')
def same_closed_data(before,after,owner,started):
 need(type(before)is dict and type(after)is dict and set(before['sqlite'])==set(after['sqlite'])==DATABASES,'exact-two-printlink-database-inventories');validate_lock(before,None,None,None,False);validate_lock(after,owner,started,after['observedUTC'],True);need(strict_equal(before['sqlite'],after['sqlite']),'every-business-telemetry-sync-authority-typed-row-schema-and-sequence-identical');need(strict_equal(before['metadata'],after['metadata']),'all-original-database-mode-owners-identical');need(strict_equal(before['files'],[r for r in after['files']if r['path']not in LOCK]),'every-attachment-json-sync-baseline-secrets-and-file-byte-identical');need(strict_equal(before['fileOwnership'],{n:v for n,v in after['fileOwnership'].items()if n not in LOCK}),'every-original-file-and-directory-mode-owner-identical');family=database_family(before['databaseFamilyMetadata'],after['databaseFamilyMetadata']);return{'allTypedRowsSchemaAndSequenceIdentical':True,'allRawBusinessFilesAndModeOwnersIdentical':True,'allTelemetryTypedRowsIdentical':True,'operationalLockOnlyCreatedByExactStartup':True,'databaseFamilyModeOwnerEvidence':family}
