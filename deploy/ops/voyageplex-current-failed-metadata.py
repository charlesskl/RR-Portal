"""Exact seven sealed failed rows: read-only IMAP metadata, never a BODY fetch."""
import collections
import hashlib
import json
import os
import pathlib
import re
import signal
import subprocess
import sys
import time

ROOT=pathlib.Path('/opt/rr-portal')
OUTPUT=ROOT/'deploy/backups/voyageplex-current-failed-metadata-20261019'
PRIOR=ROOT/'deploy/backups/voyageplex-current-failed-audit-20261019'
PRIOR_RESULT='2c0bcee3568f33c17294e97d511234870666be0f641daad1f7ebac9b2ab6d261'
PRIOR_SEAL='90fad94c5a6411f845d94766eba574af8c7891664d7417651ae8d67d1d109812'
AUDIT_COMMIT='7706c8b191250ee4c23fcf089a70f329690b61d9'
AUDIT_SHA='4120978e31f5c7c3068c6d28ddcc2675ecce8e27dfaccb0ebcae9e858d889c8e'
PIN_FROZEN=True
DEADLINE=None
FLAGS=('identityMatching','receivedDateInRequestedRange','parserUIDMatchesRecord',
       'parserMetadataInstantMatchesRecord','unhandled','noDirectTaskReference',
       'noSecondaryTaskReference','batchHandlingMatches')
CHILD=r'''
import datetime as dt, imaplib, json, re, signal, ssl, sys
FIXED={2:'lisa666tan@163.com',3:'hyt9833@163.com',5:'13768947334@163.com'}
out={'stage':'input','connected':False,'items':[]}
class NoLiteral(imaplib.IMAP4_SSL):
 def __init__(self,*a,**kw):self.remaining=131072;super().__init__(*a,**kw)
 def read(self,n):raise ValueError('unexpected literal')
 def readline(self):
  limit=min(16384,self.remaining)
  if limit<=0:raise ValueError()
  value=self.file.readline(limit+1)
  if len(value)>limit:raise ValueError()
  self.remaining-=len(value);return value
def abort(*_):raise TimeoutError()
c=None
signal.signal(signal.SIGALRM,abort);signal.setitimer(signal.ITIMER_REAL,24)
try:
 p=json.load(sys.stdin);owner=p['owner'];items=p['items']
 if type(owner)is not int or FIXED.get(owner)!=p['address'] or not isinstance(p['authCode'],str) or not 0<len(p['authCode'])<=1024:raise ValueError()
 if not isinstance(items,list) or not 1<=len(items)<=5 or any(type(x.get('uid'))is not int or not 1<=x['uid']<=4294967295 or type(x.get('slot'))is not int for x in items) or len({x['uid']for x in items})!=len(items):raise ValueError()
 out['stage']='connect';c=NoLiteral('imap.163.com',993,ssl_context=ssl.create_default_context(),timeout=8)
 out['stage']='login'
 if c.login(p['address'],p['authCode'])[0]!='OK':raise ValueError()
 out['stage']='client-id'
 if b'ID'not in c.capabilities and 'ID'not in c.capabilities:raise ValueError()
 imaplib.Commands.setdefault('ID',('AUTH',))
 if c._simple_command('ID','("name" "VoyagePlex" "version" "1.0" "vendor" "VoyagePlex")')[0]!='OK':raise ValueError()
 out['stage']='folder'
 if c.select('INBOX',readonly=True)[0]!='OK':raise ValueError()
 validity=c.response('UIDVALIDITY')[1]
 if len(validity)!=1 or not isinstance(validity[0],bytes) or not re.fullmatch(rb'[0-9]{1,10}',validity[0]) or int(validity[0])!=p['uidValidity']:raise ValueError()
 out['connected']=True;out['stage']='metadata'
 status,parts=c.uid('FETCH',','.join(str(x['uid'])for x in items),'(UID RFC822.SIZE INTERNALDATE)')
 if status!='OK'or not isinstance(parts,list)or len(parts)>20:raise ValueError()
 found={};expected={x['uid']:x for x in items}
 for part in parts:
  if not isinstance(part,bytes)or len(part)>16384:raise ValueError()
  frame=re.fullmatch(rb'[1-9][0-9]* \((.*)\)',part)
  if frame is None:raise ValueError()
  tokens=re.findall(rb'UID [0-9]{1,10}|RFC822\.SIZE [0-9]{1,12}|INTERNALDATE "[^"\r\n]{1,40}"',frame[1])
  if len(tokens)!=3 or b' '.join(tokens)!=frame[1]:raise ValueError()
  fields={token.split(b' ',1)[0]:token.split(b' ',1)[1]for token in tokens}
  if set(fields)!={b'UID',b'RFC822.SIZE',b'INTERNALDATE'}:raise ValueError()
  uid=int(fields[b'UID'])
  if uid not in expected or uid in found:raise ValueError()
  item=expected[uid];size=int(fields[b'RFC822.SIZE'])
  if not 0<size<=10**12:raise ValueError()
  actual=dt.datetime.strptime(fields[b'INTERNALDATE'][1:-1].decode('ascii').strip(),'%d-%b-%Y %H:%M:%S %z')
  received=dt.datetime.fromisoformat(re.sub(r'(\.\d{6})\d+',r'\1',item['receivedAt']).replace('Z','+00:00'))
  if received.tzinfo is None:raise ValueError()
  fraction=re.search(r'\.(\d+)',item['receivedAt'])
  subsecond_zero=fraction is None or all(digit=='0'for digit in fraction[1])
  found[uid]={'slot':item['slot'],'declaredSize':size,'exactUIDMetadataExists':True,
              'metadataInstantMatches':actual==received and subsecond_zero,
              'receivedDateMatches':actual.astimezone(dt.timezone(dt.timedelta(hours=8))).date().isoformat()==item['receivedDate']}
 if set(found)!=set(expected):raise ValueError()
 out['items']=[found[x['uid']]for x in items];out['stage']='complete'
except Exception:pass
finally:
 if c is not None:
  try:c.sock.close()
  except Exception:pass
 signal.setitimer(signal.ITIMER_REAL,0)
 print(json.dumps(out,separators=(',',':')),flush=True)
'''

def require(value):
    if not value or DEADLINE is not None and time.monotonic()>=DEADLINE:raise ValueError()

def bootstrap():
    require(PIN_FROZEN)
    result=subprocess.run(['git','-C',str(ROOT),'show',AUDIT_COMMIT+':deploy/ops/voyageplex-current-failed-audit.py'],stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,timeout=5)
    require(result.returncode==0 and len(result.stdout)<=65536 and hashlib.sha256(result.stdout).hexdigest()==AUDIT_SHA)
    source={'__name__':'fixed_current_failure_audit'};exec(compile(result.stdout,'reviewed-current-audit','exec'),source)
    source['DEADLINE']=DEADLINE
    return source,source['library']()

def prior(source,lib):
    require(source['digest'](PRIOR/'first-result.json')==PRIOR_RESULT and source['digest'](PRIOR/'seal.json')==PRIOR_SEAL)
    lib['verify_seal'](PRIOR)
    result=lib['read_json'](PRIOR/'first-result.json')
    require(result.get('completed')is True and result.get('runtimeMatchesExactPinsAndUnchanged')is True and result.get('selectedFailedCount')==7)
    path=PRIOR/'failed-items.private.json';require(path.stat().st_size<=65536 and not path.is_symlink())
    items=lib['read_json'](path)
    require(isinstance(items,list)and len(items)==7 and len({x.get('id')for x in items})==7 and collections.Counter(x.get('owner')for x in items)=={2:2,3:3,5:2})
    for item in items:
        require(all(item.get(f)is True for f in FLAGS)and type(item.get('uid'))is int and 1<=item['uid']<=4294967295 and type(item.get('uidValidity'))is int and 1<=item['uidValidity']<=4294967295)
        require(type(item.get('id'))is int and item['id']>0 and re.fullmatch('[a-f0-9]{64}',item.get('rowSHA256','')))
    return items

def live_unchanged(source,lib,items):
    with lib['connect']()as db:
        db.set_progress_handler(lambda:int(time.monotonic()>=DEADLINE),1000);db.execute('BEGIN')
        direct,secondary,known=source['task_references'](db);require(known)
        for item in items:
            size=db.execute('SELECT length(CAST(ResultJson AS BLOB)) FROM ImportEmailItems WHERE Id=?',(item['id'],)).fetchone()
            require(size is not None and 0<=(size[0]or 0)<=2097152)
            row=db.execute('SELECT * FROM ImportEmailItems WHERE Id=?',(item['id'],)).fetchone()
            require(row is not None and hashlib.sha256(lib['encoded']({k:lib['typed'](v)for k,v in dict(row).items()})).hexdigest()==item['rowSHA256'])
            require(row['Status']=='failed'and row['Company']=='Huadeng'and row['MailOwnerId']==item['owner']and item['id']not in direct and item['id']not in secondary)
            batch=db.execute('SELECT * FROM ImportBatches WHERE Id=?',(item['batchId'],)).fetchone()
            require(batch is not None and hashlib.sha256(lib['encoded']({k:lib['typed'](v)for k,v in dict(batch).items()})).hexdigest()==item['batchRowSHA256'])
        db.rollback()

def safe_result(owner,items,value):
    require(isinstance(value,dict)and set(value)=={'stage','connected','items'}and value['stage']in {'input','connect','login','client-id','folder','metadata','complete'}and type(value['connected'])is bool and isinstance(value['items'],list))
    require(value['stage']=='complete'and value['connected']and len(value['items'])==len(items))
    expected={x['slot']:x for x in items};seen=set();result=[]
    for row in value['items']:
        require(isinstance(row,dict)and set(row)=={'slot','declaredSize','exactUIDMetadataExists','metadataInstantMatches','receivedDateMatches'})
        slot=row['slot'];require(type(slot)is int and slot in expected and slot not in seen);seen.add(slot)
        require(type(row['declaredSize'])is int and 0<row['declaredSize']<=10**12 and all(type(row[x])is bool and row[x]for x in ['exactUIDMetadataExists','metadataInstantMatches','receivedDateMatches']))
        result.append({'owner':owner,'failureKind':expected[slot]['failureKind'],**row})
    return result

def main():
    global DEADLINE
    DEADLINE=time.monotonic()+105
    require(os.environ.get('MAILDIAG_BRANCH')=='refs/heads/ops/voyageplex-maildiag-20261019'and os.environ.get('MAILDIAG_ATTEMPT')=='1'and re.fullmatch('[a-f0-9]{40}',os.environ.get('MAILDIAG_REF','')))
    source,lib=bootstrap();before=source['runtime'](lib);items=prior(source,lib)
    private,_=lib['runtime']();bindings=lib['settings_and_bindings']();entries,_=lib['configuration'](private['voyageplex-api'],bindings)
    for slot,item in enumerate(items):item['slot']=slot
    os.umask(0o077);OUTPUT.mkdir(mode=0o700)
    result={'completed':False,'source':source['MAIN'],'readOnly':True,'businessWrites':False,'mailboxFlagsChanged':False,
            'BODYOrHeadersRequested':False,'authorizationCodesPrintedOrSaved':False,'originalEvidenceWrites':False,
            'selectedFailedCount':7,'metadataDoesNotProveRawContentOrSearchCoverage':True,'items':[]}
    try:
        lib['write_new'](OUTPUT/'items.private.json',items)
        for owner in (2,3,5):
            require(time.monotonic()<DEADLINE-30);live_unchanged(source,lib,items)
            group=[x for x in items if x['owner']==owner];require(1<=len(group)<=5 and len({x['uidValidity']for x in group})==1)
            username,address=lib['OWNERS'][owner]
            payload={'owner':owner,'address':address,'authCode':entries[username]['authCode'],'uidValidity':group[0]['uidValidity'],
                     'items':[{k:x[k]for k in ('slot','uid','receivedAt','receivedDate')}for x in group]}
            value=json.loads(lib['command']([sys.executable,'-c',CHILD],seconds=27,cap=4096,stdin=lib['encoded'](payload)))
            result['items']+=safe_result(owner,group,value)
            lib['write_new'](OUTPUT/('owner-%d.json'%owner),{'items':[x for x in result['items']if x['owner']==owner]})
        live_unchanged(source,lib,items);result['completed']=len(result['items'])==7
    except Exception:result['safeFailure']='REDACTED_EXACT_METADATA_PROBE_FAILURE'
    finally:
        try:
            require(source['runtime'](lib)==before);prior(source,lib)
            result['runtimeAndPriorEvidenceUnchanged']=True
        except Exception:
            result['completed']=False;result['runtimeAndPriorEvidenceUnchanged']=False
        lib['write_new'](OUTPUT/'first-result.json',result);lib['seal'](OUTPUT);lib['emit'](result)
        lib['emit']({'kind':'receipt','resultSHA256':source['digest'](OUTPUT/'first-result.json'),'sealSHA256':source['digest'](OUTPUT/'seal.json')})
    return 0 if result['completed']else 1

if __name__=='__main__':
    def stop(*_):raise TimeoutError()
    signal.signal(signal.SIGALRM,stop);signal.signal(signal.SIGTERM,stop);signal.alarm(108)
    try:raise SystemExit(main())
    except Exception:
        print('{"failed":true,"reason":"REDACTED_METADATA_SETUP_OR_SEAL_FAILURE","businessWrites":false}',flush=True)
        raise SystemExit(1)
