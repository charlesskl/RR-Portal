"""UNEXECUTED: original-six large-message body investigation, no business synchronization.

Uses the already-reviewed recovery helper by exact Git object and byte hash.
Only dedicated private evidence files are created. No mailbox flags, records,
cursors, accounts, settings, sessions or application containers are changed.
"""
import hashlib
import json
import os
import pathlib
import re
import secrets
import subprocess
import sys
import datetime as dt
import time

ROOT = pathlib.Path('/opt/rr-portal')
RUNTIME_PIN_FROZEN = True  # Root freezes main/container/image after the next deployment decision.
MAIN = '4ec24b7b6d25836ee4ee702b57324764a856b83f'
LIB_COMMIT = 'c94ea2e93f6ea81e24d409a188ff6fed31b35b07'
LIB_SHA256 = '59cec17eb70984e9b3b628c3c461f01cbf3358c1ffc46fe1c9a761a8c0d4b5ac'
RECOVER = ROOT / 'deploy/backups/voyageplex-mail-recovery-20261019-complete-v3-runs/recover-39198686144'
RECOVER_RESULT_SHA256 = 'aa88dc5797310138945fb7d6f911ec596ea09b7de72f5cfbefd875095c6fa6e9'
RECOVER_SEAL_SHA256 = 'c2b28a5452189e4246a70d9818933f0dfc14ff0cb7539b460f365faf44e8efb4'
EVIDENCE = ROOT / 'deploy/backups/voyageplex-original-large-body-probe-20261019'
ORIGINAL = ROOT/'deploy/backups/voyageplex-original-failed-audit-20261019'
PRIOR_FETCH = ROOT/'deploy/backups/voyageplex-remaining-failed-body-probe-20261019'
PRIOR_FETCH_RESULT_SHA = '14d5ea1604fbd780af6da33231ad6780cc53abb0b668bc61e806e8ccfc159fe7'
PRIOR_FETCH_SEAL_SHA = '0cf2cfa3e0af785aff22d367c8c0b57a87f16751b8ef770df79c35d8a325573b'
MAX_RAW_BYTES = 40*1024**2
MAX_CHILD_LITERAL_BYTES = 64*1024**2
MAX_ARCHIVE_BYTES = 6*MAX_RAW_BYTES
ORIGINAL_RESULT_SHA = '795823c64977b4e5a2f1982b9fca786bcccb44a4650a0b027edf7efadebef1bf'
ORIGINAL_SEAL_SHA = '934987cac44e39834a80ff54c1555ffeb9b87d9a89e91354f60c544f11998025'
PARSER_CID = 'c9592d4248fd29e01ebfeade1ef7acc8237c43334c2efedf05f8c32201abab5b'
PARSER_IMAGE = 'sha256:acf9b3648f89dda8b7cc04e09071f0e7ba9e3e2722901bcd0c63c7e0cb57a7ca'
PARSER_FILES = {'/app/app/main.py': 'b1e51021e95fab8931a6b3a4929def4ade59f5eb85c1fbe41ad5832d6a5731ac', '/app/app/mailbox.py': '4cf88d687f198b9cc50e57779279abc087c2dc3cbfdec5350046f79463142d28', '/app/app/mail_worker.py': '7acff1655025aab34fd904edb67b0e83008fad34a7ea3f09c2c63d676e6ad2d5'}
KINDS = {'metadata','message_size','body_read','parse_memory','parse_timeout','parse_result_size','parse_process','parse_cancelled'}
TOKENS = {'MemoryError','TimeoutError','ValueError','OSError','RuntimeError','ImportError','ModuleNotFoundError'}


CHILD = r'''
import datetime, imaplib, json, os, pathlib, re, signal, ssl, sys, time
MAX=40*1024*1024;end=time.monotonic()+180
ROOT=pathlib.Path('/opt/rr-portal/deploy/backups/voyageplex-original-large-body-probe-20261019')
FIXED={2:'lisa666tan@163.com',3:'hyt9833@163.com',5:'13768947334@163.com'}
r={'declaredSize':None,'actualRawLen':None,'literalLenMatched':None,'sizeDifference':None,
   'rawFetchOK':False,'rawPrivateCopySaved':False,'metadataDateMatchesRecord':False,'exactUIDMetadataExists':False,'failureStage':'input'}
class LiteralLimitError(Exception):pass
class Bounded(imaplib.IMAP4_SSL):
 def __init__(self,*args,**kwargs):
  self.literal_remaining=64*1024*1024;self.line_remaining=1024*1024
  super().__init__(*args,**kwargs)
 def read(self,size):
  if type(size) is not int or not 0<=size<=MAX or size>self.literal_remaining:raise LiteralLimitError()
  self.literal_remaining-=size
  return super().read(size)
 def readline(self):
  limit=min(16384,self.line_remaining)
  if limit<=0:raise LiteralLimitError()
  raw=self.file.readline(limit+1)
  if len(raw)>limit:raise LiteralLimitError()
  self.line_remaining-=len(raw)
  return raw
def timeout(*_):raise TimeoutError()
def arm(seconds):
 remain=min(seconds,end-time.monotonic())
 if remain<=0:raise TimeoutError()
 signal.setitimer(signal.ITIMER_REAL,remain)
def group(parts,uid,body):
 groups=[];current=[]
 for part in parts:
  header=part[0] if isinstance(part,tuple) else part
  if not isinstance(header,bytes):continue
  if re.match(rb'^\d+ \(',header) and current:groups.append(current);current=[]
  current.append(part)
 if current:groups.append(current)
 matches=[]
 for value in groups:
  header=b' '.join(p[0] if isinstance(p,tuple) else p for p in value)
  if len(header)>16384:raise ValueError()
  if {int(v) for v in re.findall(rb'\bUID ([0-9]+)\b',header)}!={uid}:continue
  if body:
   if b'BODY[]' not in header or not any(isinstance(part,tuple) for part in value):continue
  elif not re.search(rb'\bINTERNALDATE "[^"\r\n]{1,40}"',header) or not re.search(rb'\bRFC822\.SIZE [0-9]+\b',header):continue
  matches.append(value)
 if len(matches)!=1:raise ValueError()
 return matches[0]
c=None
signal.signal(signal.SIGALRM,timeout)
try:
 arm(30);p=json.load(sys.stdin);owner=p['owner'];uid=p['uid'];address=p['address'];secret=p['authCode']
 if FIXED.get(owner)!=address or type(uid) is not int or not 0<uid<=4294967295 or not isinstance(secret,str) or not 0<len(secret)<=1024:raise ValueError()
 if not re.fullmatch('mail-[a-f0-9]{32}\\.eml',p['rawName']) or ROOT.resolve()!=ROOT or not ROOT.is_dir():raise ValueError()
 r['failureStage']='connect';c=Bounded('imap.163.com',993,ssl_context=ssl.create_default_context(),timeout=20)
 r['failureStage']='login'
 if c.login(address,secret)[0]!='OK':raise ValueError()
 r['failureStage']='client-id'
 if b'ID' not in c.capabilities and 'ID' not in c.capabilities:raise ValueError()
 imaplib.Commands.setdefault('ID',('AUTH',))
 if c._simple_command('ID','("name" "VoyagePlex" "version" "1.0" "vendor" "VoyagePlex")')[0]!='OK':raise ValueError()
 r['failureStage']='folder'
 if c.select('INBOX',readonly=True)[0]!='OK':raise ValueError()
 values=c.response('UIDVALIDITY')[1]
 if len(values)!=1 or not isinstance(values[0],bytes) or not re.fullmatch(rb'[0-9]{1,10}',values[0]) or int(values[0])!=p['uidValidity']:raise ValueError()
 r['failureStage']='metadata';arm(45);status,parts=c.uid('FETCH',str(uid),'(UID RFC822.SIZE INTERNALDATE)')
 if status!='OK' or not parts or len(parts)>20:raise ValueError()
 matched=group(parts,uid,False)
 if any(isinstance(part,tuple) for part in matched):raise ValueError()
 head=b' '.join(matched);size=re.search(rb'\bRFC822\.SIZE ([0-9]{1,12})\b',head);date=re.search(rb'\bINTERNALDATE "([^"\r\n]{1,40})"',head)
 if not size or not date:raise ValueError()
 actual=datetime.datetime.strptime(date[1].decode('ascii').strip(),'%d-%b-%Y %H:%M:%S %z');r['declaredSize']=int(size[1]);r['exactUIDMetadataExists']=True
 expected=datetime.datetime.fromisoformat(re.sub(r'(\.\d{6})\d+',r'\1',p['receivedAt']).replace('Z','+00:00'))
 r['metadataDateMatchesRecord']=actual==expected and actual.astimezone(datetime.timezone(datetime.timedelta(hours=8))).date().isoformat()==p['receivedDate']
 if not r['metadataDateMatchesRecord']:r['failureStage']='metadata-date';raise ValueError()
 if not 0<=r['declaredSize']<=MAX:r['failureStage']='declared-size-limit';raise LiteralLimitError()
 r['failureStage']='body-fetch';arm(90);status,parts=c.uid('FETCH',str(uid),'(UID BODY.PEEK[])')
 if status!='OK' or not parts or len(parts)>20:raise ValueError()
 r['failureStage']='body-response';matched=group(parts,uid,True);literals=[part for part in matched if isinstance(part,tuple)]
 if len(literals)!=1 or not isinstance(literals[0][1],bytes):raise ValueError()
 header,raw=literals[0];literal=re.search(rb'\bBODY\[\] \{([0-9]{1,12})\}$',header)
 if not literal or len(raw)>MAX:raise LiteralLimitError()
 r['actualRawLen']=len(raw);r['literalLenMatched']=len(raw)==int(literal[1]);r['sizeDifference']=len(raw)-r['declaredSize']
 closing=b' '.join(part[0] if isinstance(part,tuple) else part for part in matched)
 r['rawFetchOK']=r['literalLenMatched'] and bool(raw) and closing.rstrip().endswith(b')')
 if not r['rawFetchOK']:raise ValueError()
 r['failureStage']='private-save'
 with (ROOT/p['rawName']).open('xb') as out:out.write(raw);out.flush();os.fsync(out.fileno())
 (ROOT/p['rawName']).chmod(0o600);r['rawPrivateCopySaved']=True;r['failureStage']='complete'
except BaseException:
 pass # Never print exception text, protocol responses, credentials or body.
finally:
 if c is not None:
  try:c.sock.close()
  except Exception:pass
 signal.setitimer(signal.ITIMER_REAL,0);print(json.dumps(r,separators=(',',':')))
'''


def library():
    result = subprocess.run(['git','-C',str(ROOT),'show',LIB_COMMIT+':deploy/ops/voyageplex-mail-recovery.py'],
                            stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=10)
    if result.returncode or len(result.stdout)>262144 or hashlib.sha256(result.stdout).hexdigest()!=LIB_SHA256:
        raise ValueError()
    namespace = {'__name__':'reviewed_recovery_library'}
    exec(compile(result.stdout,'reviewed-recovery-helper','exec'),namespace)
    return namespace



def retained_guards(lib):
    lib['require'](RUNTIME_PIN_FROZEN,'EXPLICIT_LARGE_PROBE_RUNTIME_PINS_NOT_FROZEN')
    lib['require'](lib['command'](['git','-C',str(ROOT),'rev-parse','HEAD']).decode().strip()==MAIN,'FIXED_MAIN_REQUIRED')
    lib['selected_backup']()
    for directory,result_sha,seal_sha in [(RECOVER,RECOVER_RESULT_SHA256,RECOVER_SEAL_SHA256),
                                           (ORIGINAL,ORIGINAL_RESULT_SHA,ORIGINAL_SEAL_SHA),
                                           (PRIOR_FETCH,PRIOR_FETCH_RESULT_SHA,PRIOR_FETCH_SEAL_SHA)]:
        lib['verify_seal'](directory)
        lib['require'](lib['file_sha'](directory/'first-result.json')==result_sha and
            lib['file_sha'](directory/'seal.json')==seal_sha,'EXACT_PRIOR_DIAGNOSTIC_RECEIPT_REQUIRED')
    private,_=lib['runtime']();parser=private['voyageplex-parser']
    lib['require'](parser['Id']==PARSER_CID and parser['Image']==PARSER_IMAGE,'FIXED_CURRENT_PARSER_REQUIRED')
    for path,digest in PARSER_FILES.items():
        lib['require'](lib['command'](['docker','exec',PARSER_CID,'sha256sum',path],seconds=5).decode().split()[0]==digest,
                       'FIXED_CURRENT_PARSER_SOURCE_REQUIRED')
    return private


def row_sha(lib,row):
    return lib['sha'](lib['encoded']({k:lib['typed'](v) for k,v in dict(row).items()}))


def original_map(lib):
    items=lib['read_json'](ORIGINAL/'original-six.private.json')
    lib['require'](len(items)==6 and len({r['id'] for r in items})==6 and
        sorted(r['owner'] for r in items)==[2,2,3,3,5,5],'EXACT_ORIGINAL_SIX_MAP_REQUIRED')
    with lib['connect'](lib['BACKUP']/'baseline.sqlite3') as db:
        for item in items:
            row=db.execute('SELECT * FROM ImportEmailItems WHERE Id=?',(item['id'],)).fetchone()
            batch=db.execute('SELECT * FROM ImportBatches WHERE Id=?',(item['batchId'],)).fetchone()
            lib['require'](row is not None and batch is not None and row['Status']=='failed' and row['Company']=='Huadeng' and
                row['MailOwnerId']==item['owner'] and row_sha(lib,row)==item['beforeSHA256']==item['currentSHA256'] and
                row_sha(lib,batch)==item['beforeBatchSHA256']==item['currentBatchSHA256'],
                'ORIGINAL_MAP_MATCHES_FULL_BASELINE')
    return items


def selection(lib,path,bindings):
    items=[];excluded={};originals=original_map(lib)
    def exclude(reason):excluded[reason]=excluded.get(reason,0)+1
    with lib['connect'](path) as db:
        db.execute('BEGIN')
        db.execute('ATTACH DATABASE ? AS baseline',((lib['BACKUP']/'baseline.sqlite3').as_uri()+'?mode=ro&immutable=1',))
        planned=[(r['id'],'original-six-large',r) for r in originals]
        secondary=set();unknown=False
        for task in db.execute("SELECT SourceEmailsJson FROM ShipmentTasks WHERE Company='Huadeng'"):
            raw=task['SourceEmailsJson']
            try:
                refs=json.loads(raw) if isinstance(raw,str) and len(raw.encode())<=2097152 else None
                if not isinstance(refs,list) or any(not isinstance(r,dict) or type(r.get('id')) is not int or r['id']<=0 for r in refs):unknown=True;continue
                secondary.update(r['id'] for r in refs)
            except (ValueError,TypeError):unknown=True
        for item_id,origin,original in planned:
            row=db.execute('SELECT * FROM ImportEmailItems WHERE Id=?',(item_id,)).fetchone()
            if row is None or row['Status']!='failed':exclude('missing-or-no-longer-failed');continue
            owner=row['MailOwnerId']
            if row['Company']!='Huadeng' or owner not in lib['OWNERS']:exclude('wrong-owner');continue
            if original is not None and row_sha(lib,row)!=original['beforeSHA256']:exclude('original-row-changed');continue
            if row['HandlingStatus']!='Pending' or row['HandlingOutcome']!='' or row['WorkNote']!='' or row['ReviewedAt'] is not None or str(row['ClassificationSource']).casefold()=='manual':exclude('human-handled');continue
            try:empty=json.loads(row['TaskIdsJson'])==[]
            except (ValueError,TypeError):empty=False
            if unknown or item_id in secondary or not empty or db.execute('SELECT COUNT(*) FROM ShipmentTasks WHERE SourceImportItemId=?',(item_id,)).fetchone()[0]:exclude('task-reference-or-unknown');continue
            batch=db.execute('SELECT Kind,Status,Company,MailOwnerId FROM ImportBatches WHERE Id=?',(row['ImportBatchId'],)).fetchone()
            if batch is None or tuple(batch)!=('Email','PendingConfirmation','Huadeng',owner):exclude('batch-ineligible');continue
            state=bindings[owner]['state'];address=lib['OWNERS'][owner][1]
            prefix='Huadeng:%d:%s:%s:%d:'%(owner,state['MailboxIdentity'],address,state['UidValidity'])
            suffix=row['MailboxKey'][len(prefix):] if row['MailboxKey'].startswith(prefix) else ''
            if not re.fullmatch('[1-9][0-9]{0,9}',suffix) or not 0<int(suffix)<=min(4294967295,state['LastUid']) or not 0<state['UidValidity']<=4294967295:exclude('identity-mismatch');continue
            try:
                instant=dt.datetime.fromisoformat(re.sub(r'(\.\d{6})\d+',r'\1',row['MailReceivedAt']).replace('Z','+00:00'))
                valid=instant.tzinfo is not None and instant.astimezone(dt.timezone(dt.timedelta(hours=8))).date().isoformat()==row['MailReceivedDate']>=bindings[owner]['setting']['StartDate']
            except (ValueError,TypeError):valid=False
            if not valid:exclude('received-date-mismatch');continue
            if original is not None and int(suffix)!=original['uid']:exclude('original-uid-mismatch');continue
            try:parsed=json.loads(row['ResultJson']) if len(row['ResultJson'])<=2097152 else {}
            except (ValueError,TypeError):parsed={}
            kind=parsed.get('failure_kind') if isinstance(parsed,dict) else None
            items.append({'id':item_id,'owner':owner,'origin':origin,'uid':int(suffix),'uidValidity':state['UidValidity'],
                'receivedAt':row['MailReceivedAt'],'receivedDate':row['MailReceivedDate'],'rowSHA256':row_sha(lib,row),
                'sourceFingerprint':row['Fingerprint'],'failureKind':kind if isinstance(kind,str) and kind in KINDS else 'other',
                'rawName':'mail-'+secrets.token_hex(16)+'.eml'})
        db.rollback()
    return items,excluded,0


def safe_fetch_result(lib,item,value):
    expected={'declaredSize','actualRawLen','literalLenMatched','sizeDifference','rawFetchOK','rawPrivateCopySaved',
              'metadataDateMatchesRecord','exactUIDMetadataExists','failureStage'}
    lib['require'](isinstance(value,dict) and set(value)==expected,'SAFE_BODY_PROBE_RESULT_SHAPE')
    lib['require'](value['failureStage'] in {'input','connect','login','client-id','folder','metadata','metadata-date','declared-size-limit','body-fetch','body-response','private-save','complete'},'SAFE_BODY_PROBE_STAGE')
    for field in ['declaredSize','actualRawLen','sizeDifference']:
        lib['require'](value[field] is None or type(value[field]) is int,'SAFE_BODY_PROBE_NUMBERS')
    for field in ['rawFetchOK','rawPrivateCopySaved','metadataDateMatchesRecord','exactUIDMetadataExists']:
        lib['require'](type(value[field]) is bool,'SAFE_BODY_PROBE_BOOLEANS')
    lib['require'](value['literalLenMatched'] is None or type(value['literalLenMatched']) is bool,'SAFE_LITERAL_RESULT')
    fingerprint_match=None
    if value['rawPrivateCopySaved']:
        path=EVIDENCE/item['rawName']
        lib['require'](not path.is_symlink() and path.is_file() and path.stat().st_size==value['actualRawLen']<=MAX_RAW_BYTES and
            value['rawFetchOK'] and value['literalLenMatched'] and value['metadataDateMatchesRecord'],'SAVED_LITERAL_VERIFIED')
        item['rawSHA256']=lib['file_sha'](path)
        if item['sourceFingerprint']:fingerprint_match=item['sourceFingerprint'].lower()==item['rawSHA256']
    return {'owner':item['owner'],'origin':item['origin'],'failureKind':item['failureKind'],**value,
            'sourceFingerprintPresent':bool(item['sourceFingerprint']),'sourceFingerprintMatchesRaw':fingerprint_match}



def prior_original_selection(lib, items):
    previous=lib['read_json'](PRIOR_FETCH/'item-map.private.json')
    lib['require'](isinstance(previous,list) and len(previous)<=11,'BOUNDED_PRIOR_FETCH_MAP')
    previous=[row for row in previous if row.get('origin')=='original-six']
    lib['require'](len(previous)==6 and len({row['id'] for row in previous})==6 and
        sorted(row['owner'] for row in previous)==[2,2,3,3,5,5],'EXACT_SIX_PREVIOUS_FETCH_ITEMS_REQUIRED')
    by_id={row['id']:row for row in previous}
    fields=['id','owner','uid','uidValidity','receivedAt','receivedDate','rowSHA256','sourceFingerprint']
    lib['require'](len(items)==6 and len({row['id'] for row in items})==6 and
        all(row['id'] in by_id and all(row[key]==by_id[row['id']][key] for key in fields) for row in items),
        'FROZEN_ORIGINAL_SIX_FETCH_IDENTITY_AND_ROWS_REQUIRED')
    prior=lib['read_json'](PRIOR_FETCH/'first-result.json')
    proof=[row for row in prior.get('items',[]) if row.get('origin')=='original-six']
    lib['require'](prior.get('completed') is True and len(proof)==6 and
        sorted(row.get('owner') for row in proof)==[2,2,3,3,5,5] and
        all(row.get('exactUIDMetadataExists') is True and row.get('metadataDateMatchesRecord') is True and
            row.get('rawPrivateCopySaved') is False and row.get('rawFetchOK') is False and
            row.get('failureStage')=='declared-size-limit' and
            type(row.get('declaredSize')) is int and 25*1024**2<row['declaredSize']<=MAX_RAW_BYTES for row in proof),
        'PRIOR_EXACT_ORIGINAL_SIX_LARGE_METADATA_PROOF_REQUIRED')


def assert_live_selection_unchanged(lib, items):
    current,excluded,new=selection(lib,lib['DB'],lib['settings_and_bindings']())
    lib['require'](not excluded and new==0,'ORIGINAL_SIX_LIVE_SCOPE_OR_HANDLING_CHANGED')
    prior_original_selection(lib,current)
    expected={row['id']:row for row in items}
    lib['require'](set(expected)=={row['id'] for row in current} and
        all(row['rowSHA256']==expected[row['id']]['rowSHA256'] for row in current),
        'ORIGINAL_SIX_LIVE_FULL_TYPED_ROWS_UNCHANGED')


def equivalence(items, safe):
    complete=[row for row in items if isinstance(row.get('rawSHA256'),str)]
    groups={owner:sorted(row['rawSHA256'] for row in complete if row['owner']==owner) for owner in [2,3,5]}
    all_six=len(complete)==6 and all(len(value)==2 for value in groups.values())
    return {'completeRawPayloads':len(complete),'distinctCompleteRawPayloads':len({row['rawSHA256'] for row in complete}),
            'allSixRawEquivalenceCompared':all_six,
            'threeOwnersRawMultisetsIdentical':all_six and groups[2]==groups[3]==groups[5],
            'equivalenceUsesEachIndependentlyFetchedSHA256':True,
            'allPresentSourceFingerprintsMatchRaw':all(row['sourceFingerprintMatchesRaw'] is not False for row in safe)}


def main():
    if os.environ.get('MAILDIAG_BRANCH')!='refs/heads/ops/voyageplex-maildiag-20261019' or os.environ.get('MAILDIAG_ATTEMPT')!='1':raise ValueError()
    lib=library();private=retained_guards(lib)
    os.umask(0o077);EVIDENCE.mkdir(mode=0o700);deadline=time.monotonic()+18*60
    result={'source':MAIN,'schemaFamily':'original-six-large','probeOnly':True,'businessSyncOrDatabaseWrites':False,
            'priorResultsPreserved':False,'currentCandidateSearchPerformed':False,
            'exactUIDFetchDoesNotProveSearchCoverage':True,'items':[],'completed':False,
            'singleMessageLimitBytes':MAX_RAW_BYTES,'perChildCumulativeLiteralLimitBytes':MAX_CHILD_LITERAL_BYTES,
            'allChildrenArchiveLimitBytes':MAX_ARCHIVE_BYTES,'productionLimitsChanged':False}
    try:
        lib['write_new'](EVIDENCE/'sqlite-snapshot.private.json',lib['online_backup'](EVIDENCE/'current.sqlite3'))
        bindings=lib['settings_and_bindings'](EVIDENCE/'current.sqlite3');entries,_=lib['configuration'](private['voyageplex-api'],bindings)
        items,excluded,new_count=selection(lib,EVIDENCE/'current.sqlite3',bindings)
        lib['require'](not excluded and new_count==0 and len(items)==6,'EXACT_ALL_SIX_UNCHANGED_ORIGINALS_ONLY')
        prior_original_selection(lib,items)
        lib['write_new'](EVIDENCE/'selected-items.private.json',items)
        result.update({'selectedCount':len(items),'newOwner6Included':False,'originalSixConsidered':6,'excluded':excluded})
        for item in items:
            if time.monotonic()>deadline-200:break
            assert_live_selection_unchanged(lib,items)
            owner=item['owner'];username,address=lib['OWNERS'][owner]
            payload={k:item[k] for k in ['owner','uid','uidValidity','rawName','receivedAt','receivedDate']}
            payload.update({'address':address,'authCode':entries[username]['authCode']})
            value=json.loads(lib['command']([sys.executable,'-c',CHILD],seconds=190,cap=16384,stdin=lib['encoded'](payload)))
            safe=safe_fetch_result(lib,item,value);result['items'].append(safe)
            lib['require'](sum((EVIDENCE/row['rawName']).stat().st_size for row in items if (EVIDENCE/row['rawName']).is_file())<=MAX_ARCHIVE_BYTES,
                           'FIXED_SIX_ARCHIVE_BUDGET_REQUIRED')
            lib['write_new'](EVIDENCE/('probe-%02d.json'%len(result['items'])),safe)
        lib['write_new'](EVIDENCE/'item-map.private.json',items)
        result['completed']=len(result['items'])==6
        result['allSelectedRawFetched']=result['completed'] and all(row['rawPrivateCopySaved'] for row in result['items'])
        result['rawEquivalence']=equivalence(items,result['items'])
    finally:
        try:
            retained_guards(lib);result['priorResultsPreserved']=True
        except Exception:
            result['completed']=False;result['safeFailure']='SOURCE_OR_PRIOR_SEALED_EVIDENCE_CHANGED'
        lib['write_new'](EVIDENCE/'first-result.json',result);lib['seal'](EVIDENCE)
        lib['emit'](result)
        lib['emit']({'kind':'receipt','resultPath':str(EVIDENCE/'first-result.json'),
            'resultSHA256':lib['file_sha'](EVIDENCE/'first-result.json'),'sealSHA256':lib['file_sha'](EVIDENCE/'seal.json')})


if __name__=='__main__':
    try:main()
    except Exception:
        print('{"failed":true,"reason":"REDACTED_ORIGINAL_LARGE_BODY_PROBE_FAILURE","businessSyncTriggered":false}',flush=True)
        raise SystemExit(1)
