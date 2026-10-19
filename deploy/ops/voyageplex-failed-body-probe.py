"""UNEXECUTED: fixed five-failure investigation, no business synchronization.

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

ROOT = pathlib.Path('/opt/rr-portal')
MAIN = '53f482f4b71fc0fd4c6696e9ec4b2058e6a342bc'
LIB_COMMIT = 'c94ea2e93f6ea81e24d409a188ff6fed31b35b07'
LIB_SHA256 = '59cec17eb70984e9b3b628c3c461f01cbf3358c1ffc46fe1c9a761a8c0d4b5ac'
RECOVER = ROOT / 'deploy/backups/voyageplex-mail-recovery-20261019-complete-v3-runs/recover-39198686144'
RECOVER_RESULT_SHA256 = 'aa88dc5797310138945fb7d6f911ec596ea09b7de72f5cfbefd875095c6fa6e9'
RECOVER_SEAL_SHA256 = 'c2b28a5452189e4246a70d9818933f0dfc14ff0cb7539b460f365faf44e8efb4'
EVIDENCE = ROOT / 'deploy/backups/voyageplex-failed-body-probe-20261019'
KINDS = {'metadata','message_size','body_read','parse_memory','parse_timeout','parse_result_size','parse_process','parse_cancelled'}
TOKENS = {'MemoryError','TimeoutError','ValueError','OSError','RuntimeError','ImportError','ModuleNotFoundError'}


CHILD = r'''
import datetime, imaplib, json, os, pathlib, re, signal, ssl, sys, time
MAX=25*1024*1024;end=time.monotonic()+120
ROOT=pathlib.Path('/opt/rr-portal/deploy/backups/voyageplex-failed-body-probe-20261019')
FIXED={2:'lisa666tan@163.com',3:'hyt9833@163.com',5:'13768947334@163.com',6:'13471221956@163.com'}
r={'declaredSize':None,'actualRawLen':None,'literalLenMatched':None,'sizeDifference':None,
   'rawFetchOK':False,'rawPrivateCopySaved':False,'failureStage':'input'}
class LiteralLimitError(Exception):pass
class Bounded(imaplib.IMAP4_SSL):
 def read(self,size):
  if type(size) is not int or not 0<=size<=MAX:raise LiteralLimitError()
  return super().read(size)
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
 datetime.datetime.strptime(date[1].decode('ascii').strip(),'%d-%b-%Y %H:%M:%S %z');r['declaredSize']=int(size[1])
 if not 0<=r['declaredSize']<=MAX:r['failureStage']='declared-size-limit';raise LiteralLimitError()
 r['failureStage']='body-fetch';arm(45);status,parts=c.uid('FETCH',str(uid),'(UID BODY.PEEK[])')
 if status!='OK' or not parts or len(parts)>20:raise ValueError()
 r['failureStage']='body-response';matched=group(parts,uid,True);literals=[part for part in matched if isinstance(part,tuple)]
 if len(literals)!=1 or not isinstance(literals[0][1],bytes):raise ValueError()
 header,raw=literals[0];literal=re.search(rb'\{([0-9]{1,12})\}$',header)
 if not literal or len(raw)>MAX:raise LiteralLimitError()
 r['actualRawLen']=len(raw);r['literalLenMatched']=len(raw)==int(literal[1]);r['sizeDifference']=len(raw)-r['declaredSize']
 r['rawFetchOK']=r['literalLenMatched'] and bool(raw)
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
    lib['require'](lib['command'](['git','-C',str(ROOT),'rev-parse','HEAD']).decode().strip()==MAIN,'FIXED_MAIN_REQUIRED')
    lib['selected_backup']()
    lib['verify_seal'](RECOVER)
    lib['require'](lib['file_sha'](RECOVER/'first-result.json')==RECOVER_RESULT_SHA256 and
                   lib['file_sha'](RECOVER/'seal.json')==RECOVER_SEAL_SHA256,'EXACT_FIRST_RECOVERY_REQUIRED')


def failed_items(lib, bindings):
    result=[]
    with lib['connect'](RECOVER/'current.sqlite3') as db:
        db.execute('ATTACH DATABASE ? AS baseline',((lib['BACKUP']/'baseline.sqlite3').as_uri()+'?mode=ro&immutable=1',))
        rows=db.execute("""SELECT i.Id,i.MailOwnerId,i.MailboxKey,
          CASE WHEN length(CAST(i.ResultJson AS BLOB))<=2097152 THEN i.ResultJson ELSE NULL END,
          CASE WHEN length(CAST(i.Error AS BLOB))<=4096 THEN i.Error ELSE '' END
          FROM ImportEmailItems i LEFT JOIN baseline.ImportEmailItems b ON b.Id=i.Id
          WHERE b.Id IS NULL AND i.Company='Huadeng' AND i.MailOwnerId IN (2,3,5,6) AND i.Status='failed' AND i.MailboxKey<>'' ORDER BY i.Id LIMIT 11""").fetchall()
        lib['require'](0<len(rows)<=10,'FIXED_FAILED_ITEM_BOUND')
    with lib['connect']() as live:
        live.execute('BEGIN')
        for row in rows:
            item_id,owner,key,raw,error=row;state=bindings[owner]['state'];address=lib['OWNERS'][owner][1]
            prefix='Huadeng:%d:%s:%s:%d:'%(owner,state['MailboxIdentity'],address,state['UidValidity'])
            lib['require'](key.startswith(prefix) and re.fullmatch('[0-9]{1,10}',key[len(prefix):]) is not None,'EXACT_FAILED_MAILBOX_IDENTITY')
            uid=int(key[len(prefix):]);lib['require'](0<uid<=4294967295,'EXACT_FAILED_UID_BOUND')
            current=live.execute('SELECT Company,MailOwnerId,MailboxKey,Status FROM ImportEmailItems WHERE Id=?',(item_id,)).fetchone()
            lib['require'](current is not None and list(current)==['Huadeng',owner,key,'failed'],'FAILED_RECORD_UNCHANGED')
            try:value=json.loads(raw) if isinstance(raw,str) else {}
            except (ValueError,TypeError):value={}
            kind=value.get('failure_kind') if isinstance(value,dict) else None
            nested=value.get('error') if isinstance(value,dict) and isinstance(value.get('error'),str) else ''
            text=(error or '')+' '+nested[:4096]
            result.append({'id':item_id,'owner':owner,'uid':uid,'uidValidity':state['UidValidity'],
                           'failureKind':kind if isinstance(kind,str) and kind in KINDS else 'other',
                           'allBusinessAttachmentsUnparseable':error=='邮件中的业务附件均无法解析' or nested=='邮件中的业务附件均无法解析',
                           'knownExceptionTokens':sorted(token for token in TOKENS if re.search(r'(?<![A-Za-z0-9_])'+token+r'(?![A-Za-z0-9_])',text)),
                           'rawName':'mail-'+secrets.token_hex(16)+'.eml'})
        live.rollback()
    return result


def main():
    if os.environ.get('MAILDIAG_BRANCH')!='refs/heads/ops/voyageplex-maildiag-20261019' or os.environ.get('MAILDIAG_ATTEMPT')!='1':
        raise ValueError()
    lib=library();retained_guards(lib)
    private,_=lib['runtime']();bindings=lib['settings_and_bindings']();entries,_=lib['configuration'](private['voyageplex-api'],bindings)
    items=failed_items(lib,bindings)
    os.umask(0o077);EVIDENCE.mkdir(mode=0o700) # Exclusive fixed directory, never overwrite a prior probe.
    result={'source':MAIN,'probeOnly':True,'businessSyncOrDatabaseWrites':False,'priorResultsPreserved':True,'items':[]}
    try:
        lib['write_new'](EVIDENCE/'item-map.private.json',items)
        for item in items:
            owner=item['owner'];username,address=lib['OWNERS'][owner]
            payload={key:item[key] for key in ['owner','uid','uidValidity','rawName']}
            payload.update({'address':address,'authCode':entries[username]['authCode']})
            value=json.loads(lib['command']([sys.executable,'-c',CHILD],seconds=130,cap=16384,stdin=lib['encoded'](payload)))
            expected={'declaredSize','actualRawLen','literalLenMatched','sizeDifference','rawFetchOK','rawPrivateCopySaved','failureStage'}
            lib['require'](isinstance(value,dict) and set(value)==expected,'SAFE_BODY_PROBE_RESULT_SHAPE')
            lib['require'](value['failureStage'] in {'input','connect','login','client-id','folder','metadata','declared-size-limit','body-fetch','body-response','private-save','complete'},'SAFE_BODY_PROBE_STAGE')
            for field in ['declaredSize','actualRawLen','sizeDifference']:
                lib['require'](value[field] is None or type(value[field]) is int,'SAFE_BODY_PROBE_NUMBERS')
            for field in ['rawFetchOK','rawPrivateCopySaved']:
                lib['require'](type(value[field]) is bool,'SAFE_BODY_PROBE_BOOLEANS')
            lib['require'](value['literalLenMatched'] is None or type(value['literalLenMatched']) is bool,'SAFE_LITERAL_RESULT')
            safe={'owner':owner,'failureKind':item['failureKind'],'allBusinessAttachmentsUnparseable':item['allBusinessAttachmentsUnparseable'],
                  'knownExceptionTokens':item['knownExceptionTokens'],**value}
            result['items'].append(safe);lib['write_new'](EVIDENCE/('probe-%02d.json'%len(result['items'])),safe)
    finally:
        lib['write_new'](EVIDENCE/'first-result.json',result);lib['seal'](EVIDENCE);retained_guards(lib)
        lib['emit'](result)
        lib['emit']({'kind':'receipt','resultPath':str(EVIDENCE/'first-result.json'),
                     'resultSHA256':lib['file_sha'](EVIDENCE/'first-result.json'),'sealSHA256':lib['file_sha'](EVIDENCE/'seal.json')})


if __name__=='__main__':
    try:main()
    except Exception:
        print('{"failed":true,"reason":"REDACTED_FIXED_BODY_PROBE_FAILURE","businessSyncTriggered":false}',flush=True)
        raise SystemExit(1)
