#!/usr/bin/env python3
"""Read-only API verification. Credentials remain in process memory and are never logged."""
import base64,json,subprocess,urllib.request,urllib.error,sys
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
 password=base64.b64decode(env['INDO_SHIPPING_ADMIN_PASSWORD_B64'],validate=True).decode()
 token=request('/auth/login',{'username':'admin','password':password})['token']
 del password,env
 alerts=request('/material-alerts',token=token)
 items=alerts['items']
 assert items, 'No tracked materials'
 assert all(i.get('manual_completed') and i['status']=='covered' and i['workflow_status']=='已送完(手动)' and i['shortage_qty']==0 for i in items),'Incomplete tracking status'
 assert all(i['received_qty']==0 and i['outbound_qty']==0 for i in items),'Unexpected stock quantities'
 assert all(d['status']=='已送完(手动)' for i in items for d in i['order_details']),'Incomplete order details'
 placed=set(request('/schedules/placed-manual',token=token))
 schedules=request('/schedules',token=token)
 keys=set(); rows=0;unmarkable=0
 for s in schedules:
  raw=request('/schedules/'+str(s['id']),token=token)['raw_rows']
  entries=json.loads(raw) if isinstance(raw,str) else raw
  for r in entries or []:
   rows+=1
   if str(r.get('orderNo') or '').strip() and str(r.get('code') or '').strip(): keys.add(str(r['orderNo'])+'|'+str(r['code']))
   else: unmarkable+=1
 assert len(schedules)==7 and len(keys)==565 and keys<=placed,'Purchase status mismatch'
 print(json.dumps({'verified':True,'schedules':len(schedules),'schedule_rows':rows,'marked_order_product_keys':len(keys),'rows_without_order_or_code':unmarkable,'tracked_materials':len(items),'completed_materials':sum(i['status']=='covered' for i in items),'order_detail_rows':sum(len(i['order_details']) for i in items),'actual_received_qty':0,'actual_outbound_qty':0},ensure_ascii=False))
except Exception as e:
 print('Read-only completion verification failed: '+type(e).__name__,file=sys.stderr)
 sys.exit(1)
