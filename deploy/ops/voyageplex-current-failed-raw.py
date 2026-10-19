"""UNEXECUTED: exact seven sealed failures, bounded read-only raw PEEK capture.

Creates a new private evidence archive only. No parsing, retry, API calls,
mailbox flag changes, business writes, cursor changes or container changes.
"""
import collections
import hashlib
import json
import os
import pathlib
import re
import secrets
import signal
import subprocess
import sys
import time

ROOT=pathlib.Path('/opt/rr-portal')
OUTPUT=ROOT/'deploy/backups/voyageplex-current-failed-raw-20261019'
METADATA=ROOT/'deploy/backups/voyageplex-current-failed-metadata-20261019'
METADATA_COMMIT='f19d56457aad0be8a4ec4aecb2b3ceca520a0a2a'
METADATA_SCRIPT_SHA='b758319730106214988908ffb813e5283cfd053572a384e7f98571ad6d4e5e9f'
METADATA_RESULT_SHA='21327eb54ebf685c70ee3c11cd94cd82789624bb94452e1f3df0c79277b336ff'
METADATA_SEAL_SHA='c6d1aeb8f7945830084fed34e0669bfa72a5efc9a5677d28e5e4b94e11a36178'
PIN_FROZEN=True
DEADLINE=None
MAX_RAW=48*1024**2
MAX_OWNER=64*1024**2
MAX_TOTAL=192*1024**2

CHILD=r'''
import datetime as dt,hashlib,imaplib,json,os,pathlib,re,signal,ssl,sys,time
ROOT=pathlib.Path('/opt/rr-portal/deploy/backups/voyageplex-current-failed-raw-20261019')
MAX=48*1024**2;OWNER_MAX=64*1024**2;END=time.monotonic()+90
FIXED={2:'lisa666tan@163.com',3:'hyt9833@163.com',5:'13768947334@163.com'}
out={'stage':'input','connected':False,'items':[]}
class LimitError(Exception):pass
class Bounded(imaplib.IMAP4_SSL):
 def __init__(self,*args,**kwargs):
  self.literal_remaining=OWNER_MAX;self.line_remaining=1024*1024;self.allow_literal=False
  super().__init__(*args,**kwargs)
 def read(self,n):
  if not self.allow_literal or type(n)is not int or not 0<n<=MAX or n>self.literal_remaining:raise LimitError()
  self.literal_remaining-=n
  return super().read(n)
 def readline(self):
  limit=min(16384,self.line_remaining)
  if limit<=0:raise LimitError()
  value=self.file.readline(limit+1)
  if len(value)>limit:raise LimitError()
  self.line_remaining-=len(value);return value
def abort(*_):raise TimeoutError()
def arm(seconds):
 remaining=min(seconds,END-time.monotonic())
 if remaining<=0:raise TimeoutError()
 signal.setitimer(signal.ITIMER_REAL,remaining)
def flags_only(part):
 return re.fullmatch(rb'[1-9][0-9]* \((?:UID [1-9][0-9]{0,9} FLAGS \([^()\r\n{}"]*\)|FLAGS \([^()\r\n{}"]*\) UID [1-9][0-9]{0,9})\)',part)is not None
def metadata(parts,uid):
 if not isinstance(parts,list)or not 1<=len(parts)<=32:raise ValueError()
 found=[]
 for part in parts:
  if not isinstance(part,bytes)or len(part)>16384:raise ValueError()
  if flags_only(part):continue
  frame=re.fullmatch(rb'[1-9][0-9]* \((.*)\)',part)
  if frame is None:raise ValueError()
  tokens=re.findall(rb'UID [0-9]{1,10}|RFC822\.SIZE [0-9]{1,12}|INTERNALDATE "[^"\r\n]{1,40}"',frame[1])
  if len(tokens)!=3 or b' '.join(tokens)!=frame[1]:raise ValueError()
  fields={token.split(b' ',1)[0]:token.split(b' ',1)[1]for token in tokens}
  if set(fields)!={b'UID',b'RFC822.SIZE',b'INTERNALDATE'}or int(fields[b'UID'])!=uid:raise ValueError()
  found.append((int(fields[b'RFC822.SIZE']),dt.datetime.strptime(fields[b'INTERNALDATE'][1:-1].decode('ascii').strip(),'%d-%b-%Y %H:%M:%S %z')))
 if len(found)!=1:raise ValueError()
 return found[0]
def body(parts,uid,declared):
 if not isinstance(parts,list)or not 1<=len(parts)<=32:raise ValueError()
 groups=[];current=[]
 for part in parts:
  head=part[0]if isinstance(part,tuple)and len(part)==2 else part
  if not isinstance(head,bytes)or len(head)>16384:raise ValueError()
  if re.match(rb'[1-9][0-9]* \(',head)and current:groups.append(current);current=[]
  current.append(part)
 if current:groups.append(current)
 found=[]
 for group in groups:
  if len(group)==1 and isinstance(group[0],bytes)and flags_only(group[0]):continue
  if len(group)!=2 or not isinstance(group[0],tuple)or len(group[0])!=2 or not isinstance(group[1],bytes):raise ValueError()
  header,raw=group[0]
  opening=re.fullmatch(rb'[1-9][0-9]* \((?:UID ([1-9][0-9]{0,9}) )?BODY\[\] \{([0-9]{1,12})\}',header)
  closing=re.fullmatch(rb'(?: UID ([1-9][0-9]{0,9}))?\)',group[1])
  if opening is None or closing is None or not isinstance(raw,bytes):raise ValueError()
  ids=[int(x)for x in (opening[1],closing[1])if x is not None]
  if ids!=[uid]or not 0<len(raw)<=MAX or int(opening[2])!=len(raw)or declared-len(raw)not in (0,2):raise ValueError()
  found.append(raw)
 if len(found)!=1:raise ValueError()
 return found[0]
c=None
signal.signal(signal.SIGALRM,abort)
try:
 arm(20);p=json.load(sys.stdin);owner=p['owner'];items=p['items']
 if type(owner)is not int or FIXED.get(owner)!=p['address']or not isinstance(p['authCode'],str)or not 0<len(p['authCode'])<=1024:raise ValueError()
 if type(p['uidValidity'])is not int or not 1<=p['uidValidity']<=4294967295 or ROOT.resolve()!=ROOT or not ROOT.is_dir():raise ValueError()
 if not isinstance(items,list)or not 1<=len(items)<=3:raise ValueError()
 if any(not isinstance(x,dict)or type(x.get('uid'))is not int or not 1<=x['uid']<=4294967295 or type(x.get('slot'))is not int or not 0<=x['slot']<=6 or type(x.get('declaredSize'))is not int or not 0<x['declaredSize']<=MAX or not re.fullmatch('mail-[a-f0-9]{32}\\.eml',x.get('rawName',''))for x in items):raise ValueError()
 if len({x['uid']for x in items})!=len(items)or len({x['slot']for x in items})!=len(items)or len({x['rawName']for x in items})!=len(items)or sum(x['declaredSize']for x in items)>OWNER_MAX:raise ValueError()
 os.umask(0o077);out['stage']='connect';c=Bounded('imap.163.com',993,ssl_context=ssl.create_default_context(),timeout=8)
 out['stage']='login'
 if c.login(p['address'],p['authCode'])[0]!='OK':raise ValueError()
 out['stage']='client-id'
 if b'ID'not in c.capabilities and 'ID'not in c.capabilities:raise ValueError()
 imaplib.Commands.setdefault('ID',('AUTH',))
 if c._simple_command('ID','("name" "VoyagePlex" "version" "1.0" "vendor" "VoyagePlex")')[0]!='OK':raise ValueError()
 out['stage']='folder'
 if c.select('INBOX',readonly=True)[0]!='OK':raise ValueError()
 validity=c.response('UIDVALIDITY')[1]
 if len(validity)!=1 or not isinstance(validity[0],bytes)or not re.fullmatch(rb'[0-9]{1,10}',validity[0])or int(validity[0])!=p['uidValidity']:raise ValueError()
 out['connected']=True
 for item in items:
  uid=item['uid'];out['stage']='metadata';arm(15)
  status,parts=c.uid('FETCH',str(uid),'(UID RFC822.SIZE INTERNALDATE)')
  if status!='OK':raise ValueError()
  declared,instant=metadata(parts,uid)
  expected=dt.datetime.fromisoformat(re.sub(r'(\.\d{6})\d+',r'\1',item['receivedAt']).replace('Z','+00:00'))
  fraction=re.search(r'\.(\d+)',item['receivedAt']);zero=fraction is None or all(x=='0'for x in fraction[1])
  if declared!=item['declaredSize']or not 0<declared<=MAX or expected.tzinfo is None or not zero or instant!=expected or instant.astimezone(dt.timezone(dt.timedelta(hours=8))).date().isoformat()!=item['receivedDate']:raise ValueError()
  del parts;out['stage']='body-peek';arm(55);c.allow_literal=True
  try:status,parts=c.uid('FETCH',str(uid),'(UID BODY.PEEK[])')
  finally:c.allow_literal=False
  if status!='OK':raise ValueError()
  raw=body(parts,uid,declared);digest=hashlib.sha256(raw).hexdigest();out['stage']='private-save'
  with (ROOT/item['rawName']).open('xb')as target:target.write(raw);target.flush();os.fsync(target.fileno())
  (ROOT/item['rawName']).chmod(0o600)
  out['items'].append(dict(slot=item['slot'],declaredSize=declared,actualRawBytes=len(raw),sizeDifference=len(raw)-declared,rawSHA256=digest,completeLiteralAndFraming=True,metadataInstantAndDateMatch=True,privateCopySaved=True))
  del raw,parts
 out['stage']='complete'
except BaseException:pass
finally:
 if c is not None:
  try:c.sock.close()
  except Exception:pass
 signal.setitimer(signal.ITIMER_REAL,0);print(json.dumps(out,separators=(',',':')),flush=True)
'''


def require(value):
    if not value or DEADLINE is not None and time.monotonic()>=DEADLINE:raise ValueError('EXACT_RAW_CAPTURE_SAFETY_BOUND')


def bootstrap():
    require(PIN_FROZEN and re.fullmatch('[a-f0-9]{40}',METADATA_COMMIT))
    result=subprocess.run(['git','-C',str(ROOT),'show',METADATA_COMMIT+':deploy/ops/voyageplex-current-failed-metadata.py'],stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,timeout=5)
    require(result.returncode==0 and len(result.stdout)<=65536 and hashlib.sha256(result.stdout).hexdigest()==METADATA_SCRIPT_SHA)
    helper={'__name__':'exact_reviewed_metadata_library'};exec(compile(result.stdout,'exact-metadata-helper','exec'),helper)
    helper['DEADLINE']=DEADLINE;source,lib=helper['bootstrap']()
    return helper,source,lib


def prior(helper,source,lib):
    items=helper['prior'](source,lib)
    require(source['digest'](METADATA/'first-result.json')==METADATA_RESULT_SHA and source['digest'](METADATA/'seal.json')==METADATA_SEAL_SHA)
    lib['verify_seal'](METADATA);result=lib['read_json'](METADATA/'first-result.json');saved=lib['read_json'](METADATA/'items.private.json')
    require(result.get('source')==source['MAIN'] and result.get('completed')is True and result.get('runtimeAndPriorEvidenceUnchanged')is True and
            result.get('BODYOrHeadersRequested')is False and result.get('authorizationCodesPrintedOrSaved')is False)
    require(saved==[{**item,'slot':slot}for slot,item in enumerate(items)] and len(saved)==7)
    observations=result.get('items');require(isinstance(observations,list)and len(observations)==7)
    by_slot={row.get('slot'):row for row in observations};require(set(by_slot)==set(range(7)))
    selected=[]
    for item in saved:
        row=by_slot[item['slot']]
        require(row.get('owner')==item['owner'] and row.get('failureKind')==item['failureKind'] and all(row.get(k)is True for k in ['exactUIDMetadataExists','metadataInstantMatches','receivedDateMatches']) and
                type(row.get('declaredSize'))is int and 0<row['declaredSize']<=MAX_RAW)
        selected.append({**item,'declaredSize':row['declaredSize']})
    require(collections.Counter(x['owner']for x in selected)=={2:2,3:3,5:2} and sum(x['declaredSize']for x in selected)<=MAX_TOTAL and
            all(sum(x['declaredSize']for x in selected if x['owner']==owner)<=MAX_OWNER for owner in (2,3,5)))
    return selected


def full_fingerprints(lib,items):
    result={}
    with lib['connect']()as db:
        db.set_progress_handler(lambda:int(time.monotonic()>=DEADLINE),1000);db.execute('BEGIN')
        for item in items:
            row=db.execute('SELECT * FROM ImportEmailItems WHERE Id=?',(item['id'],)).fetchone()
            require(row is not None and hashlib.sha256(lib['encoded']({k:lib['typed'](v)for k,v in dict(row).items()})).hexdigest()==item['rowSHA256'])
            fingerprint=row['Fingerprint'];require(isinstance(fingerprint,str)and (fingerprint==''or re.fullmatch('[a-fA-F0-9]{64}',fingerprint)))
            result[item['slot']]=fingerprint
        db.rollback()
    return result


def safe_owner(source,group,value):
    require(isinstance(value,dict)and set(value)=={'stage','connected','items'}and type(value['connected'])is bool and value['stage']in {'input','connect','login','client-id','folder','metadata','body-peek','private-save','complete'}and isinstance(value['items'],list)and len(value['items'])<=len(group))
    expected={x['slot']:x for x in group};seen=set();safe=[]
    for row in value['items']:
        require(isinstance(row,dict)and set(row)=={'slot','declaredSize','actualRawBytes','sizeDifference','rawSHA256','completeLiteralAndFraming','metadataInstantAndDateMatch','privateCopySaved'})
        slot=row['slot'];require(type(slot)is int and slot in expected and slot not in seen);seen.add(slot);item=expected[slot]
        require(type(row['declaredSize'])is int and row['declaredSize']==item['declaredSize']and type(row['actualRawBytes'])is int and 0<row['actualRawBytes']<=MAX_RAW and
                type(row['sizeDifference'])is int and row['sizeDifference']==row['actualRawBytes']-row['declaredSize']and row['sizeDifference']in (0,-2)and
                isinstance(row['rawSHA256'],str)and re.fullmatch('[a-f0-9]{64}',row['rawSHA256'])and all(row.get(k)is True for k in ['completeLiteralAndFraming','metadataInstantAndDateMatch','privateCopySaved']))
        path=OUTPUT/item['rawName'];require(not path.is_symlink()and path.is_file()and path.stat().st_size==row['actualRawBytes']and path.stat().st_mode&0o777==0o600 and source['digest'](path)==row['rawSHA256'])
        fingerprint=item['sourceFingerprint'];match=fingerprint.lower()==row['rawSHA256']if fingerprint else None
        require(match is not False)
        item['rawSHA256']=row['rawSHA256']
        safe.append({'owner':item['owner'],'failureKind':item['failureKind'],**row,'sourceFingerprintMatchesRaw':match})
    return safe,value['stage']=='complete'and value['connected']and len(safe)==len(group)


def main():
    global DEADLINE
    DEADLINE=time.monotonic()+345
    require(os.environ.get('MAILDIAG_BRANCH')=='refs/heads/ops/voyageplex-maildiag-20261019'and os.environ.get('MAILDIAG_ATTEMPT')=='1'and re.fullmatch('[a-f0-9]{40}',os.environ.get('MAILDIAG_REF','')))
    helper,source,lib=bootstrap();before=source['runtime'](lib);items=prior(helper,source,lib)
    private,_=lib['runtime']();bindings=lib['settings_and_bindings']();entries,_=lib['configuration'](private['voyageplex-api'],bindings)
    helper['live_unchanged'](source,lib,items);fingerprints=full_fingerprints(lib,items)
    for item in items:item.update(rawName='mail-'+secrets.token_hex(16)+'.eml',sourceFingerprint=fingerprints[item['slot']])
    os.umask(0o077);OUTPUT.mkdir(mode=0o700)
    result={'completed':False,'source':source['MAIN'],'readOnly':True,'businessWrites':False,'APIOrSyncCalls':False,'mailboxFlagsChanged':False,
            'authorizationCodesPrintedOrSaved':False,'oldEvidenceWrites':False,'selectedFailedCount':7,'singleMessageLimitBytes':MAX_RAW,
            'perOwnerLiteralLimitBytes':MAX_OWNER,'archiveRawLimitBytes':MAX_TOTAL,'exactUIDFetchDoesNotProveSearchCoverage':True,'owners':[],'items':[]}
    try:
        lib['write_new'](OUTPUT/'items.private.json',items);all_owners=True
        for owner in (2,3,5):
            require(time.monotonic()<DEADLINE-110);helper['live_unchanged'](source,lib,items)
            group=[x for x in items if x['owner']==owner];username,address=lib['OWNERS'][owner]
            require(len({x['uidValidity']for x in group})==1)
            payload={'owner':owner,'address':address,'authCode':entries[username]['authCode'],'uidValidity':group[0]['uidValidity'],
                     'items':[{key:x[key]for key in ['slot','uid','receivedAt','receivedDate','declaredSize','rawName']}for x in group]}
            value=json.loads(lib['command']([sys.executable,'-c',CHILD],seconds=95,cap=8192,stdin=lib['encoded'](payload)))
            safe,complete=safe_owner(source,group,value);all_owners=bool(all_owners and complete);result['items']+=safe
            result['owners'].append({'owner':owner,'stage':value['stage'],'complete':complete,'capturedItems':len(safe)})
            require(sum(path.stat().st_size for path in OUTPUT.glob('mail-*.eml'))<=MAX_TOTAL)
            lib['write_new'](OUTPUT/('owner-%d.json'%owner),{'stage':value['stage'],'complete':complete,'items':safe})
        helper['live_unchanged'](source,lib,items)
        result['completed']=all_owners and len(result['items'])==7
        result['completeRawPayloads']=len(result['items']);result['distinctCompleteRawPayloads']=len({r['rawSHA256']for r in result['items']})
        lib['write_new'](OUTPUT/'item-map.private.json',items)
    except Exception:result['safeFailure']='REDACTED_EXACT_RAW_CAPTURE_FAILURE'
    finally:
        try:
            require(source['runtime'](lib)==before);prior(helper,source,lib);helper['live_unchanged'](source,lib,items)
            result['runtimeAndPriorEvidenceAndRowsUnchanged']=True
        except Exception:result['completed']=False;result['runtimeAndPriorEvidenceAndRowsUnchanged']=False
        lib['write_new'](OUTPUT/'first-result.json',result);lib['seal'](OUTPUT);lib['emit'](result)
        lib['emit']({'kind':'receipt','resultSHA256':source['digest'](OUTPUT/'first-result.json'),'sealSHA256':source['digest'](OUTPUT/'seal.json')})
    return 0 if result['completed']else 1


if __name__=='__main__':
    def stop(*_):raise TimeoutError()
    signal.signal(signal.SIGALRM,stop);signal.signal(signal.SIGTERM,stop);signal.alarm(355)
    try:raise SystemExit(main())
    except Exception:
        print('{"failed":true,"reason":"REDACTED_RAW_CAPTURE_SETUP_OR_SEAL_FAILURE","businessWrites":false}',flush=True)
        raise SystemExit(1)
