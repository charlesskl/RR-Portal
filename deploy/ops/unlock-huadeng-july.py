#!/usr/bin/env python3
"""Scoped, backed-up unlock of Shaoyang's July 2026, without a service restart."""
import argparse,datetime,hashlib,json,os,pathlib,re,sqlite3
PARTY,FROM,TO='sy','2026-07-01','2026-07-31'

def selected(con):
 locks=[dict(r) for r in con.execute('SELECT * FROM period_locks WHERE party=? AND date_from<=? AND date_to>=? ORDER BY id',(PARTY,TO,FROM))]
 flows=[dict(r) for r in con.execute('SELECT * FROM flow_records WHERE recorded_by=? AND date BETWEEN ? AND ? ORDER BY id',(PARTY,FROM,TO))]
 fingerprint=hashlib.sha256(repr((locks,flows)).encode()).hexdigest()
 return locks,flows,fingerprint

def digest(con,table,normalize=False):
 hashes=[]
 for row in con.execute('SELECT * FROM "'+table.replace('"','""')+'"'):
  r=dict(row)
  if table=='period_locks' and r['party']==PARTY and r['date_from']<=TO and r['date_to']>=FROM:continue
  if normalize and table=='flow_records' and r['recorded_by']==PARTY and FROM<=r['date']<=TO:r['locked']=0
  hashes.append(hashlib.sha256(repr(r).encode()).hexdigest())
 return len(hashes),hashlib.sha256(''.join(sorted(hashes)).encode()).hexdigest()

def run(database,mode,expected='',backup_dir='',actor=''):
 path=pathlib.Path(database).resolve()
 con=sqlite3.connect('file:'+str(path)+'?mode='+('ro' if mode=='preview' else 'rw'),uri=True,timeout=30,isolation_level=None)
 con.row_factory=sqlite3.Row
 try:
  con.execute('BEGIN' if mode=='preview' else 'BEGIN IMMEDIATE')
  locks,flows,fingerprint=selected(con)
  summary={'party':PARTY,'date_from':FROM,'date_to':TO,'period_locks':len(locks),'flow_records':len(flows),
   'record_locks':sum(bool(r['locked']) for r in flows),'fingerprint':fingerprint}
  if mode=='preview':con.rollback();return summary
  if not re.fullmatch('[a-f0-9]{64}',expected) or fingerprint!=expected:raise RuntimeError('Scope changed since preview; no records modified')
  if not re.fullmatch('[A-Za-z0-9-]{1,39}',actor):raise RuntimeError('Invalid operator')
  if any(r['date_from']<FROM or r['date_to']>TO for r in locks):raise RuntimeError('Wider lock requires a separately reviewed split; no records modified')
  tables=[r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")]
  before={t:digest(con,t,True) for t in tables}
  directory=pathlib.Path(backup_dir);directory.mkdir(parents=True,exist_ok=True)
  os.umask(0o077)
  tag=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
  backup=directory/('huadeng-sy-july-unlock-'+tag+'.sqlite')
  with backup.open('xb'):pass
  with sqlite3.connect('file:'+str(path)+'?mode=ro',uri=True,timeout=30) as source,sqlite3.connect(backup) as target:
   source.backup(target)
   if target.execute('PRAGMA quick_check').fetchone()[0]!='ok':raise RuntimeError('Backup integrity check failed')
  con.execute('DELETE FROM period_locks WHERE party=? AND date_from>=? AND date_to<=?',(PARTY,FROM,TO))
  changed=con.execute('UPDATE flow_records SET locked=0 WHERE recorded_by=? AND date BETWEEN ? AND ? AND locked!=0',(PARTY,FROM,TO)).rowcount
  after={t:digest(con,t,True) for t in tables}
  if after!=before:raise RuntimeError('Protected rows or business fields changed; operation rolled back')
  remaining,remaining_flows,_=selected(con)
  if remaining or any(r['locked'] for r in remaining_flows):raise RuntimeError('Unlock verification failed; operation rolled back')
  audit={**summary,'unlocked_record_locks':changed,'backup_path':str(backup),'backup_sha256':hashlib.sha256(backup.read_bytes()).hexdigest(),
   'operator':'ops/'+actor,'protected_tables':{t:before[t][0] for t in tables},'committed':False}
  log=backup.with_suffix('.json');log.write_text(json.dumps(audit,ensure_ascii=False,indent=2))
  con.commit()
  audit['committed']=True;log.write_text(json.dumps(audit,ensure_ascii=False,indent=2))
  return audit
 except Exception:
  con.rollback();raise
 finally:con.close()

if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--database',required=True);p.add_argument('--mode',choices=['preview','unlock'],required=True)
 p.add_argument('--expected',default='');p.add_argument('--backup-dir',default='');p.add_argument('--actor',default='');a=p.parse_args()
 print(json.dumps(run(a.database,a.mode,a.expected,a.backup_dir,a.actor),ensure_ascii=False))
