"""INERT bounded personal-account lookup. No password read, login, bootstrap or update."""
import base64,hashlib,json,os,pathlib,re,subprocess,sys
EXECUTE=True
PUBLIC_KEY='-----BEGIN PUBLIC KEY-----\nMIICIjANBgkqhkiG9w0BAQEFAAOCAg8AMIICCgKCAgEAw2E+TQnImP4iiJl5x84c\nM+3iaRr70QzBgwIlbbUn+SWQ1/GzaDBoV3RIDIYd1+jnbYCDCPtHIq/jjY0wo/hr\nRA/YYa6xHKZqIQ749JvRHRy2p4ALfRHi/b7u3oNdmJey2nmuThj6xgnTzBzrOc/X\nvOxTDliX/T7oBUk+J9d54ZR4wGlAQhfpDU5NwQuvSBBpPussOZ4Pi62GlATWMp0i\n7fVSzlNbha408oK2dbsdnoBf3KiZdT0vXDt3fjJvAAb0ZN4/StX257XRSn9iCb3u\n+OHcajgOIqmAdLEEV8TMVEi/Q/rXxs09ojW1wxpgwRi9xhhkLsC1BsVn1fOM6Reo\n6YdeO3lHI+JODq5CPcq/bp/xaFcqJD5Fb85fnMKJ0FHLgTw5ZDEch7+E13RZyNPM\nCe5bdcXli7Bg8sAoEslMTCptvh6783fJsNY6zwm4S+erV+APCz5+/Nc4ZvdkBT/s\n8FMqjBxN5U5g5VzGhYcQUHlRWF5qkNz7DtiaXXU7LUV+sxtTjLHOknkk5Jp/cOie\nUXz2VL+pq/ujKfRLS77iponYXrdQEY2eWQGvqJpgRP/MXzAvzQJdZtD2LCxH0Gdb\nOfv5e/yG2C3Qggc7Z4eFeaLbC0BRBrCHFbKqym8dJKsoOcjd/29UM7DvbMetjSTA\nph7sWRuLHy7ohSmRfLUlXx8CAwEAAQ==\n-----END PUBLIC KEY-----\n'
NAME_SHA='a4bea20289a9a67055fe383b30d6d4ad89079f439783d07a9650094010de6608'
BRANCH='refs/heads/codex/ops-pr1054-20261102'
QUERY=r'''import asyncio,json,sys
async def main():
 from sqlalchemy import text
 from app.database import engine
 engine.echo=False
 name=json.load(sys.stdin)['name']
 try:
  async with engine.connect() as c:
   t=await c.begin()
   try:
    await c.execute(text('SET TRANSACTION READ ONLY'))
    await c.execute(text("SET LOCAL statement_timeout='5s'"))
    if (await c.execute(text('SHOW transaction_read_only'))).scalar_one()!='on':raise RuntimeError('not_read_only')
    q=text('SELECT id,username,full_name,department,role,is_active,permissions FROM users WHERE btrim(full_name)=:name OR btrim(username)=:name ORDER BY id LIMIT 9')
    rows=(await c.execute(q,{'name':name})).mappings().all()
    out=[]
    for r in rows:
     p=r['permissions'] or [];d=(r['department'] or '').strip().lower()
     out.append({k:r[k]for k in('id','username','full_name','department','role','is_active')}|{'canEdit':d in('工程部','engineering')and'epms:edit'in p,'canApprove':r['role']=='admin'or'epms:approve'in p})
    print(json.dumps({'matches':out,'readOnlyTransaction':True,'passwordQueried':False},ensure_ascii=True,separators=(',',':')))
   finally:await t.rollback()
 finally:await engine.dispose()
try:asyncio.run(main())
except Exception as e:print(json.dumps({'errorType':type(e).__name__}));sys.exit(1)
'''
def enc(v):return json.dumps(v,sort_keys=True,separators=(',',':'),ensure_ascii=True,allow_nan=False).encode()
def sha(v):return hashlib.sha256(v).hexdigest()
def need(v):
 if not v:raise RuntimeError('bounded-readonly-account-check-failed')
def cmd(args,body=None,limit=4*1024**2):
 r=subprocess.run(args,input=body,capture_output=True,timeout=30)
 need(r.returncode==0 and len(r.stdout)<=limit and len(r.stderr)<=1024**2);return r.stdout
def profile():
 ids=cmd(['docker','ps','-aq','--no-trunc']).decode().split();need(len(ids)==len(set(ids))==46)
 rows=json.loads(cmd(['docker','inspect',*ids],limit=16*1024**2));need({r['Id']for r in rows}==set(ids));core=[r for r in rows if(r['Config'].get('Labels')or{}).get('com.docker.compose.project')=='rr-portal'and(r['Config'].get('Labels')or{}).get('com.docker.compose.service')=='core'];need(len(core)==1 and core[0]['State']['Running']and core[0]['State'].get('Health',{}).get('Status')=='healthy')
 safe={r['Id']:{'image':r['Image'],'config':sha(enc(r['Config'])),'host':sha(enc(r['HostConfig'])),'mounts':sha(enc(r['Mounts'])),'pid':r['State']['Pid'],'started':r['State']['StartedAt'],'health':r['State'].get('Health',{}).get('Status'),'restarts':r['RestartCount']}for r in rows}
 return safe,core[0]['Id']
def encrypt(raw):
 p=pathlib.Path(__file__).with_name('account-lookup.public.pem');fd=os.open(p,os.O_CREAT|os.O_EXCL|os.O_WRONLY|os.O_NOFOLLOW,0o600)
 with os.fdopen(fd,'wb')as f:f.write(PUBLIC_KEY.encode());f.flush();os.fsync(f.fileno())
 chunks=[]
 try:
  for start in range(0,len(raw),400):
   b=cmd(['openssl','pkeyutl','-encrypt','-pubin','-inkey',str(p),'-pkeyopt','rsa_padding_mode:oaep','-pkeyopt','rsa_oaep_md:sha256'],raw[start:start+400],limit=1024);need(len(b)==512);chunks.append(base64.b64encode(b).decode())
 finally:p.unlink()
 return chunks
def wire(v):
 raw=enc(v);parts=[raw[i:i+900]for i in range(0,len(raw),900)];d=lambda h:[int(x,16)for x in h];n=lambda x:d(format(x,'x'))
 for i,p in enumerate(parts,1):print(json.dumps([0,n(i),n(len(parts)),n(len(raw)),d(sha(raw)),d(p.hex())],separators=(',',':')))
 print(json.dumps([1,n(len(parts)),n(len(raw)),d(sha(raw))],separators=(',',':')))
def main():
 need(EXECUTE is True and sys.argv[1:]==['diagnose']and os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_MODE')=='diagnose'and os.environ.get('RELEASE_ATTEMPT')=='1')
 name=os.environ.get('LOOKUP_NAME','');need(sha(name.encode())==NAME_SHA);v={'phase':'diagnose','success':False,'readOnly':True,'passwordQueried':False,'accountWrites':False,'configurationWrites':False,'lifecycleWrites':False}
 try:
  before,cid=profile();raw=cmd(['docker','exec','-i',cid,'python','-B','-c',QUERY],enc({'name':name}),limit=16384);data=json.loads(raw);need(data.get('readOnlyTransaction')is True and data.get('passwordQueried')is False and type(data.get('matches'))is list and len(data['matches'])<=9)
  fields={'id','username','full_name','department','role','is_active','canEdit','canApprove'};need(all(type(r)is dict and set(r)==fields for r in data['matches']));cipher=encrypt(enc(data));after,cid2=profile();need(cid==cid2 and before==after);v.update(success=True,encryptedAccountResult=cipher,encryption='RSA-4096-OAEP-SHA256',all46RuntimeUnchanged=True)
 except Exception as e:v['errorType']=type(e).__name__
 v['resultSHA256']=sha(enc(v));wire(v);return 0 if v['success']else 1
if __name__=='__main__':sys.exit(main())
