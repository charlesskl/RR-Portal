"""Independent full-main fake runtime regression, no Docker/network/production."""
import contextlib,copy,hashlib,importlib.util,io,json,pathlib,tempfile,types,unittest
from unittest.mock import patch
P=pathlib.Path(__file__).resolve().parents[1]/'printlink-post-health-verify.py'
spec=importlib.util.spec_from_file_location('post_review',P);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class PostIdentity(unittest.TestCase):
 def run_case(self,*,different_runtime=False,changed_database=False):
  with tempfile.TemporaryDirectory()as tmp:
   root=pathlib.Path(tmp);backup=root/'backup';backup.mkdir();output=root/'output';tree=root/'runtime';tree.mkdir()
   mounts=[dict(Destination='/app/runtime',Source=str(tree),Type='volume',RW=True,Name='rr-portal_printlink-data')]
   old=dict(id='OLD',image='OLDIMAGE',mounts=mounts,environmentSHA256='SAME')
   (backup/'container-before.private.json').write_text(json.dumps(old));(backup/'other-containers.private.json').write_text('{}');(backup/'raw-inventory.private.json').write_text('[]')
   inspection=dict(Id='NEW',Image='NEWIMAGE',Mounts=mounts,Config={'Env':[],'Healthcheck':{'Test':['CMD','node','ops/healthcheck.mjs']}},HostConfig={'Memory':768*1024**2,'MemorySwap':768*1024**2},State={'StartedAt':'2026-10-19T00:00:00Z'},RestartCount=0)
   state=dict(id='UNVERIFIED'if different_runtime else 'NEW',image='UNVERIFIEDIMAGE'if different_runtime else 'NEWIMAGE',startedAt='2026-10-19T00:00:01Z'if different_runtime else '2026-10-19T00:00:00Z',restartCount=0,health='healthy',status='running',oomKilled=False)
   before={'production.sqlite':{'schemaSha256':'a','tables':{'t':{'rows':1,'sha256':'b','columnsSha256':'c'}}}}
   after=copy.deepcopy(before)
   if changed_database:after['production.sqlite']['tables']['t']['sha256']='CHANGED'
   pins=json.loads(P.with_name('printlink-runtime-source-951-pins.json').read_bytes())
   lib=dict(git_commit=lambda:m.MERGE_HEAD,inspect=lambda name:copy.deepcopy(inspection),other_containers=lambda:{},digest=lambda value:'SAME',encoded=lambda v:json.dumps(v).encode(),private_write=lambda p,v:p.write_bytes(v),sqlite_snapshots=lambda *args:copy.deepcopy(after),file_hash=lambda p:'HASH',seal=lambda p:None,raw_hash=lambda body:pins['cloud/public/index.html'if body==b'INDEX'else'cloud/public/app.js'])
   resources=types.SimpleNamespace(DEADLINE=None,inspection=lambda:copy.deepcopy(state))
   class Loader:
    def exec_module(self,mod):mod.__dict__.update(vars(resources))
   spec=types.SimpleNamespace(loader=Loader());stdout=io.StringIO();clock=[0]
   def now():clock[0]+=31;return clock[0]
   def get(url,cap=1):return(401,b'{}',1)if'printlink-health'in url else(200,b'{"ok":true}'if'/api/health'in url else b'APPJS'if'/app.js'in url else b'INDEX',1)
   telemetry=dict(state=state,probeCounts={'direct':0,'legacy':0},processRoleCounts={},cgroup={'memory.max':str(768*1024**2),'memory.current':'1000','memory.events':'oom 0\noom_kill 0'})
   with patch.object(m,'ROOT',root),patch.object(m,'BACKUP',backup),patch.object(m,'OUTPUT',output),patch.object(m,'FINAL_PIN_FROZEN',True),patch.object(m,'library',return_value=lib),patch.object(m,'backup_verify',return_value=before),patch.object(m,'lock_valid',return_value=True),patch.object(m,'source_verify'),patch.object(m,'durable_rows',return_value=[]),patch.object(m,'get',side_effect=get),patch.object(m,'telemetry',return_value=telemetry),patch.object(m.importlib.util,'spec_from_file_location',return_value=spec),patch.object(m.importlib.util,'module_from_spec',return_value=types.ModuleType('fake_resources')),patch.object(m.time,'monotonic',side_effect=now),patch.object(m.time,'sleep'),patch.object(m.signal,'alarm'),contextlib.redirect_stdout(stdout):
    code=m.main()
   return code,json.loads((output/'first-result.json').read_bytes())
 def test_concurrent_fulltyped_change_never_preservation_green(self):
  code,result=self.run_case(changed_database=True);self.assertEqual(code,1);self.assertFalse(result['strictPreservationVerified']);self.assertTrue(result['tableDeltas']);self.assertTrue(result['serviceRecoveryVerified'])
 def test_runtime_used_for_health_must_match_source_checked_initial_identity(self):
  code,result=self.run_case(different_runtime=True);self.assertEqual(code,1);self.assertFalse(result['serviceRecoveryVerified']);self.assertFalse(result['strictPreservationVerified'])
if __name__=='__main__':unittest.main(verbosity=2)
