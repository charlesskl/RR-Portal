import contextlib
import copy
import importlib.util
import io
import json
import pathlib
import tempfile
import unittest
from unittest.mock import patch

SOURCE=pathlib.Path(__file__).resolve().parents[1]/'printlink-post-health-verify.py'
spec=importlib.util.spec_from_file_location('post_health',SOURCE)
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)


class PostHealthTests(unittest.TestCase):
    def test_false_pin_stops_before_any_library_or_runtime_read(self):
        out=io.StringIO()
        with patch.object(m,'FINAL_PIN_FROZEN',False),patch.object(m,'library')as lib,contextlib.redirect_stdout(out):
            self.assertEqual(m.main(),1)
        lib.assert_not_called()
        result=json.loads(out.getvalue())
        self.assertEqual(result['failureCode'],'FINAL_DEPLOYMENT_PIN_REQUIRED')
        self.assertFalse(result['strictPreservationVerified'])

    def test_process_kind_excludes_wrappers_and_matches_only_exact_fixed_argv(self):
        old=b"fetch('http://127.0.0.1:3100/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
        self.assertEqual(m.probe_kind(b'node\0-e\0'+old+b'\0'),'legacy')
        self.assertEqual(m.probe_kind(b'/usr/local/bin/node\0ops/healthcheck.mjs\0'),'direct')
        self.assertEqual(m.probe_kind(b'node\0/app/ops/healthcheck.mjs\0'),'direct')
        self.assertIsNone(m.probe_kind(b'/sbin/docker-init\0--\0node\0ops/healthcheck.mjs\0'))
        self.assertIsNone(m.probe_kind(b'node\0-e\0console.log("ops/healthcheck.mjs")\0'))

    def test_same_row_count_with_changed_full_hash_is_a_real_delta(self):
        row={'rows':10,'sha256':'a'*64,'columnsSha256':'b'*64}
        before={'production.sqlite':{'schemaSha256':'s','tables':{'snapshot':row}}}
        after={'production.sqlite':{'schemaSha256':'s','tables':{'snapshot':{**row,'sha256':'c'*64}}}}
        delta=m.table_deltas(before,after)
        self.assertEqual(len(delta),1)
        self.assertEqual(delta[0]['before']['rows'],delta[0]['after']['rows'])
        self.assertNotEqual(delta[0]['before']['sha256'],delta[0]['after']['sha256'])

    def test_removed_table_and_changed_schema_are_not_hidden(self):
        before={'db':{'schemaSha256':'a','tables':{'users':{'rows':4,'sha256':'b'}}}}
        after={'db':{'schemaSha256':'c','tables':{}}}
        self.assertEqual(len(m.table_deltas(before,after)),2)

    def test_cgroup_rejects_oom_missing_counters_wrong_limits_and_charge(self):
        valid={'memory.max':str(768*1024**2),'memory.current':str(200*1024**2),
               'memory.events':'low 0\nhigh 0\nmax 0\noom 0\noom_kill 0'}
        self.assertTrue(m.cgroup_safe(valid))
        for bad in [{'memory.max':'max'},{'memory.current':str(800*1024**2)},
                    {'memory.events':'oom 0'}, {'memory.events':'oom 1\noom_kill 0'}]:
            self.assertFalse(m.cgroup_safe({**valid,**bad}))

    def runtime_fixture(self):
        return {'Id':'a'*64,'Image':'sha256:a','RestartCount':0,
            'State':{'StartedAt':'2026-10-19T06:00:00Z'},'Mounts':[{'Name':'same-volume'}],
            'Config':{'Env':['FIXTURE=same'],'Healthcheck':{'Test':['CMD','node','ops/healthcheck.mjs']}},
            'HostConfig':{'Memory':768*1024**2,'MemorySwap':768*1024**2}}

    def test_replacement_before_first_sample_cannot_become_the_new_trusted_baseline(self):
        verified=self.runtime_fixture()
        sample={'id':verified['Id'],'image':verified['Image'],'startedAt':verified['State']['StartedAt'],
            'restartCount':0,'health':'healthy','status':'running','oomKilled':False}
        self.assertTrue(m.verified_lifecycle(sample,verified))
        for key,value in [('id','b'*64),('image','sha256:b'),('startedAt','later'),('restartCount',1)]:
            with self.subTest(key=key):self.assertFalse(m.verified_lifecycle({**sample,key:value},verified))

    def test_final_inspection_rechecks_every_bound_configuration_field(self):
        verified=self.runtime_fixture()
        self.assertTrue(m.final_runtime_matches(copy.deepcopy(verified),verified))
        for path,value in [(('Id',),'other'),(('Image',),'other'),(('RestartCount',),1),
            (('State','StartedAt'),'later'),(('Mounts',),[{'Name':'empty-volume'}]),
            (('Config','Env'),['FIXTURE=changed']),
            (('Config','Healthcheck'),{'Test':['CMD-SHELL','old']}),
            (('HostConfig','Memory'),512*1024**2),(('HostConfig','MemorySwap'),-1)]:
            changed=copy.deepcopy(verified);target=changed
            for key in path[:-1]:target=target[key]
            target[path[-1]]=value
            with self.subTest(path=path):self.assertFalse(m.final_runtime_matches(changed,verified))

    def test_no_print_login_restart_checkpoint_or_business_sql(self):
        source=SOURCE.read_text()
        for value in ['docker restart','docker update','docker compose','wal_checkpoint','/api/login',
                      'INSERT INTO','UPDATE ','DELETE ','/api/platform/jobs']:
            self.assertNotIn(value,source)


if __name__=='__main__':unittest.main()
