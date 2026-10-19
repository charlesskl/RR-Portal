"""Bounded, read-only PrintLink portal/health diagnosis; no credentials or raw logs."""
import datetime
import hashlib
import json
import pathlib
import re
import subprocess
import sys
import time

ROOT = pathlib.Path('/opt/rr-portal')
EXPECTED_HEAD = 'f853c7a2ec47f3cff11e456f874218d2324ad217'
PREFIX = 'apps/工程部/3D打印协同平台/'
DEADLINE = None


def run(args, data=None, timeout=12, limit=65536):
    remaining = DEADLINE - time.monotonic()
    if remaining < 1:
        raise RuntimeError('DIAGNOSIS_DEADLINE')
    proc = subprocess.run(args, input=data, stdout=subprocess.PIPE,
                          stderr=subprocess.DEVNULL, cwd=ROOT,
                          timeout=min(timeout, remaining))
    if proc.returncode != 0 or len(proc.stdout) > limit:
        raise RuntimeError('READ_ONLY_COMMAND_FAILED')
    return proc.stdout


def inspect(service):
    data = json.loads(run(['docker', 'inspect', 'rr-portal-' + service + '-1']))
    if len(data) != 1:
        raise RuntimeError('EXPECTED_ONE_CONTAINER')
    item = data[0]
    state = item['State']
    health = state.get('Health') or {}
    return {'id': item['Id'], 'image': item['Image'], 'status': state['Status'],
            'startedAt': state['StartedAt'], 'finishedAt': state['FinishedAt'],
            'health': health.get('Status'), 'restartCount': item['RestartCount'],
            'oomKilled': state['OOMKilled'], 'exitCode': state['ExitCode'],
            'healthChecks': [{'start': row['Start'], 'end': row['End'],
                              'exitCode': row['ExitCode']}
                             for row in health.get('Log', [])[-5:]],
            'ports': {key: value for key, value in
                      (item.get('NetworkSettings', {}).get('Ports') or {}).items()
                      if key == '3100/tcp'}}


PRINTLINK_JS = r'''
const fs = require('node:fs');
const {DatabaseSync} = require('node:sqlite');
(async()=>{
 const result = {};
 for(const p of ['/api/health','/','/app.js']) {
  const started = Date.now();
  try { const r = await fetch('http://127.0.0.1:3100'+p,{signal:AbortSignal.timeout(4000)});
   const b = Buffer.from(await r.arrayBuffer());
   if(b.length>1024*1024) throw Error('bounded');
   result[p]={status:r.status,bytes:b.length,elapsedMs:Date.now()-started,
     sha256:require('node:crypto').createHash('sha256').update(b).digest('hex')};
  }catch {result[p]={failed:true,elapsedMs:Date.now()-started};}
 }
 const file='/app/runtime/stations.json';
 if(fs.existsSync(file)) {
  const s=fs.statSync(file);if(!s.isFile()||s.size>65536)throw Error('bounded');
  const data=JSON.parse(fs.readFileSync(file,'utf8'));
  if(!Array.isArray(data)||data.length>20)throw Error('bounded');
  result.stations=data.map(x=>({id:x.id,name:x.name,
    enabled:x.enabled===undefined?null:!!x.enabled,
    businessSync:x.businessSync===undefined?null:!!x.businessSync,
    machineCount:Array.isArray(x.machines)?x.machines.length:null}));
 }
 result.businessSyncStation=process.env.BUSINESS_SYNC_STATION||null;
 const db=new DatabaseSync('/app/runtime/orders/printlink.sqlite',{readOnly:true});
 try {db.exec('PRAGMA query_only=ON;BEGIN');
  result.collectors=db.prepare('SELECT id,last_seen,sequence FROM collector_stations ORDER BY id LIMIT 20').all();
  result.businessCounts={};
  for(const name of ['orders','production_jobs','users']) {
   result.businessCounts[name]=db.prepare('SELECT COUNT(*) AS n FROM '+name).get().n;
  }
  db.exec('ROLLBACK');
 }finally {db.close();}
 console.log(JSON.stringify(result));
})().catch(()=>{console.log(JSON.stringify({failed:true,code:'PRINTLINK_READ_ONLY_CHECK_FAILED'}));process.exitCode=1;});
'''

CORE_PY = '''
import asyncio,json
from sqlalchemy import text
from app.database import engine
async def main():
 try:
  async with engine.connect() as conn:
   async with conn.begin():
    await conn.execute(text('SET TRANSACTION READ ONLY'))
    rows=(await conn.execute(text("SELECT name,is_enabled,status,version,last_health_check FROM plugins WHERE name='printlink' OR display_name ILIKE '%3D%' ORDER BY name LIMIT 10"))).mappings().all()
    print(json.dumps({'plugins':[dict(r) for r in rows]},default=str,ensure_ascii=False))
 finally: await engine.dispose()
asyncio.run(main())
'''


def main():
    global DEADLINE
    DEADLINE = time.monotonic() + 55
    result = {'readOnly': True, 'capturedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
              'expectedHead': EXPECTED_HEAD, 'completed': False}
    try:
        head = run(['git', 'rev-parse', 'HEAD']).decode().strip()
        if head != EXPECTED_HEAD:
            raise RuntimeError('PRODUCTION_HEAD_CHANGED')
        result['head'] = head
        result['containersBefore'] = {s: inspect(s) for s in ['printlink', 'nginx', 'core']}
        result['maintenanceFlagPresent'] = (ROOT/'deploy/maintenance/services/printlink').is_file()
        html = (ROOT/'frontend/index.cloud.html').read_bytes()
        if len(html) > 1024*1024:
            raise RuntimeError('PORTAL_HTML_TOO_LARGE')
        result['portal'] = {'sha256': hashlib.sha256(html).hexdigest(),
            'matchesCommitted': html == run(['git', 'show', head+':frontend/index.cloud.html'],limit=1024*1024),
            'hasPrintlinkHealthCheck': b"url: '/printlink-health'" in html,
            'hasIndependent3100Link': b"location.hostname + ':3100/'" in html,
            'hasChineseDisabledLabel': '停用'.encode() in html}
        mounted = run(['docker', 'exec', 'rr-portal-nginx-1', 'cat', '/usr/share/nginx/html/index.html'],limit=1024*1024)
        result['portal']['mountedMatchesHost'] = mounted == html
        result['printlink'] = json.loads(run(['docker', 'exec', '-i', 'rr-portal-printlink-1', 'node', '-'], PRINTLINK_JS.encode(),timeout=17))
        result['coreRegistry'] = json.loads(run(['docker','exec','-i','rr-portal-core-1','python','-'], CORE_PY.encode(),timeout=12))
        result['containersAfter'] = {s: inspect(s) for s in ['printlink','nginx','core']}
        result['completed'] = True
    except Exception as error:
        safe = str(error)
        result['failureCode'] = safe if re.fullmatch('[A-Z_]{1,80}',safe) else type(error).__name__
    print(json.dumps(result, ensure_ascii=False, sort_keys=True, separators=(',',':')))
    return 0 if result['completed'] else 1


if __name__ == '__main__':
    sys.exit(main())
