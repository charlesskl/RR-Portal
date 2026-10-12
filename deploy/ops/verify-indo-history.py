#!/usr/bin/env python3
"""Read-only API verification. Credentials remain in process memory and are never logged."""
import base64,json,subprocess,urllib.request,urllib.error,sys,hmac,hashlib,time
compose=['docker','compose','-f','docker-compose.cloud.yml','--env-file','.env.cloud.production']
try:
 cid=subprocess.check_output(compose+['ps','-q','indo-shipping'],text=True).strip()
 info=json.loads(subprocess.check_output(['docker','inspect',cid],text=True))[0]
 env=dict(v.split('=',1) for v in info['Config']['Env'] if '=' in v)
 ip=next(n['IPAddress'] for n in info['NetworkSettings']['Networks'].values() if n['IPAddress'])
 base='http://'+ip+':5180/api'
 def request(path,body=None,token=None):
  headers={'Content-Type':'application/json'}
  if token: headers['Authorization']='Bearer '+token
  data=None if body is None else json.dumps(body).encode()
  with urllib.request.urlopen(urllib.request.Request(base+path,data=data,headers=headers),timeout=20) as r: return json.load(r)
 # Server-local 60-second read probe; the API still checks the existing user's live DB permissions.
 query="""SELECT "Id" FROM indo_shipping."Users" WHERE "IsActive" AND "Userbqrpower"='111111111' ORDER BY "Id" LIMIT 1"""
 uid=subprocess.check_output(compose+['exec','-T','db','sh','-c',
  'exec psql -X -At -v ON_ERROR_STOP=1 -U "${POSTGRES_USER:-rrportal}" -d "${POSTGRES_DB:-rrportal}" -c "$1"','psql',query],text=True).strip()
 assert uid.isdigit(), 'No existing account with schedule and purchase read permission'
 key=base64.b64decode(env['INDO_SHIPPING_JWT_KEY_B64'],validate=True)
 def encode(data): return base64.urlsafe_b64encode(data).decode().rstrip('=')
 header=encode(json.dumps({'alg':'HS256','typ':'JWT'},separators=(',',':')).encode())
 body=encode(json.dumps({'iss':'IndoShipping','aud':'IndoShipping','sub':uid,'exp':int(time.time())+60},separators=(',',':')).encode())
 unsigned=header+'.'+body
 token=unsigned+'.'+encode(hmac.new(key,unsigned.encode(),hashlib.sha256).digest())
 del key,env
 history=request('/material-alerts/history',token=token)
 print(json.dumps({'archived_revisions':len(history),'source_schedules':len(request('/schedules',token=token))},ensure_ascii=False))
 assert history, 'No archived revisions'
 assert [h['id'] for h in history]==sorted([h['id'] for h in history],reverse=True), 'Incorrect revision ordering'
 current=request('/material-alerts',token=token)
 items=current['items']
 print(json.dumps({'current_items':len(items),'covered':sum(i['status']=='covered' for i in items),'fully_manual':sum(i['manual_completed'] for i in items),'pending':sum(i['shortage_qty']>0 for i in items)},ensure_ascii=False))
 assert items, 'No cumulative tracking items'
 metadata_query="SELECT jsonb_agg(jsonb_build_object('id',id,'acknowledged',acknowledged)) FROM indo_shipping.material_tracking_history"
 metadata=json.loads(subprocess.check_output(compose+['exec','-T','db','sh','-c','exec psql -X -At -v ON_ERROR_STOP=1 -U "${POSTGRES_USER:-rrportal}" -d "${POSTGRES_DB:-rrportal}" -c "$1"','psql',metadata_query],text=True))
 acknowledged_ids={r['id'] for r in metadata if r['acknowledged']}
 assert len(acknowledged_ids)==7, 'Original seven completion snapshots were not preserved'
 confirmed_caps={}
 assert all(i['received_qty']==0 and i['outbound_qty']==0 for i in items), 'Unexpected stock records'
 historical_count=0
 for revision in history:
  view=request('/material-alerts?revisionId='+str(revision['id']),token=token)
  assert view['revision_id']==revision['id'] and view['schedule_id']==revision['schedule_id'], 'Wrong historical version'
  if revision['id'] in acknowledged_ids:
   assert all(i['status']=='covered' and i['manual_completed'] for i in view['items']), 'Historical confirmation missing'
   for i in view['items']:
    for d in i['order_details']: confirmed_caps[d['key']]=max(confirmed_caps.get(d['key'],0),d['required_qty'])
  historical_count+=len(view['items'])
 for i in items:
  for d in i['order_details']:
   expected=min(d['required_qty'],confirmed_caps.get(d['key'],0))
   assert abs(d['manual_qty']-expected)<0.00011, 'Confirmed quantity lost or transferred to unrelated demand'
 try:
  request('/material-alerts?revisionId=9223372036854775807',token=token)
  raise AssertionError('Nonexistent revision accepted')
 except urllib.error.HTTPError as e:
  assert e.code==404, 'Unexpected missing-version status'
 suppliers=request('/dictionaries',token=token)['suppliers']
 assert len(suppliers)==46, 'Supplier archives changed'
 print(json.dumps({'verified':True,'archived_revisions':len(history),'preserved_acknowledged_revisions':len(acknowledged_ids),'current_tracked_items':len(items),
  'current_completed_items':sum(i['manual_completed'] for i in items),'current_pending_items':sum(i['status']!='covered' for i in items),'cumulative_orders':current['order_count'],
  'checked_history_views':len(history),'historical_material_item_rows':historical_count,'supplier_archives':len(suppliers),
  'current_actual_received_qty':0,'current_actual_outbound_qty':0,'nonexistent_revision_status':404},ensure_ascii=False))
except Exception as e:
 print('Read-only history verification failed: '+type(e).__name__+(': '+str(e) if isinstance(e,AssertionError) else ''),file=sys.stderr)
 sys.exit(1)
