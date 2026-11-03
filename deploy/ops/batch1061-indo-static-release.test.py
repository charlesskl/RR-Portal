"""Synthetic AST-extracted checks; never imports the release or uses Docker/network."""
import ast
import hashlib
import io
import json
import pathlib
import re
import tarfile
import tempfile
import unittest

DRAFT=pathlib.Path(__file__).with_name('batch1061-indo-static-release.py')
TREE=ast.parse(DRAFT.read_text())
TEMPLATES=('template-customs.xlsx','template-customs-rri.xlsx','template-customs-rrm.xlsx')

def helpers():
    names={'need','enc','sha','pin','safe_relative','static_plan','payload_members','candidate_growth',
           'capacity_contract','measured_payload_budget','static_records_preserved'}
    nodes=[node for node in TREE.body if isinstance(node,ast.FunctionDef)and node.name in names]
    assert len(nodes)==len(names)
    env={'pathlib':pathlib,'hashlib':hashlib,'json':json,'re':re,'tarfile':tarfile,'TEMPLATES':TEMPLATES,'STAGE':'test'}
    exec(compile(ast.Module(body=nodes,type_ignores=[]),str(DRAFT)+':helpers-only','exec'),env)
    return env

class StaticPlanTests(unittest.TestCase):
    def setUp(self):
        self.e=helpers();self.old={'index.html':'old-index','assets/old-abc123.js':'old-js',**{name:'same-template'for name in TEMPLATES}}
        self.new={'index.html':'new-index','assets/new-def456.js':'new-js',**{name:'same-template'for name in TEMPLATES}}
    def test_plan_adds_only_new_flat_assets_and_retains_old_graph(self):
        self.assertEqual(self.e['static_plan'](self.old,self.new),['assets/new-def456.js'])
        self.assertIn('assets/old-abc123.js',dict(self.old,**self.new))
    def test_existing_asset_overwrite_or_template_loss_is_rejected(self):
        cases=[{**self.new,'assets/old-abc123.js':'changed'},
               {k:v for k,v in self.new.items()if k!=TEMPLATES[0]},
               {**self.new,TEMPLATES[1]:'changed-template'},
               {**self.new,'favicon.svg':'new-root-resource'},
               {**self.new,'assets/sub/file.js':'nested'},
               {**self.new,'index.html':'old-index'}]
        for case in cases:
            with self.subTest(case=list(case)),self.assertRaises(RuntimeError):self.e['static_plan'](self.old,case)
    def test_relative_paths_reject_ambiguous_or_escaping_names(self):
        for value in ('','/absolute','../secret','assets/../../secret','assets//file.js','assets/./file.js','assets\\file.js','assets/line\n.js',None,42):
            self.assertFalse(self.e['safe_relative'](value),repr(value))
        self.assertTrue(self.e['safe_relative']('assets/new-Ab_123.js'))

class PayloadTests(unittest.TestCase):
    def setUp(self):
        self.e=helpers();self.temp=tempfile.TemporaryDirectory(prefix='synthetic1061-payload-');self.addCleanup(self.temp.cleanup)
        self.path=pathlib.Path(self.temp.name)/'payload.tar';self.bodies={'index.html':b'new synthetic index','assets/new-Ab123.js':b'new synthetic code'}
        self.expected={name:hashlib.sha256(body).hexdigest()for name,body in self.bodies.items()}
    def archive(self,entries):
        with tarfile.open(self.path,'w')as tar:
            for name,body,kind in entries:
                member=tarfile.TarInfo(name);member.type=kind;member.size=len(body)if kind==tarfile.REGTYPE else 0
                if kind in(tarfile.SYMTYPE,tarfile.LNKTYPE):member.linkname='/synthetic-private-target'
                tar.addfile(member,io.BytesIO(body)if member.isfile()else None)
    def valid_entries(self):return [(name,body,tarfile.REGTYPE)for name,body in self.bodies.items()]
    def test_exact_regular_payload_returns_only_reviewed_bodies(self):
        self.archive(self.valid_entries());self.assertEqual(self.e['payload_members'](self.path,self.expected,1024),self.bodies)
    def test_links_directories_duplicate_unsafe_extra_missing_and_bad_hash_are_rejected(self):
        entries=self.valid_entries()
        # Keep each adversarial archive concrete; no release extraction is performed.
        cases=[entries+[entries[0]],entries[:-1],entries+[('../secret',b'x',tarfile.REGTYPE)],entries+[('assets/extra-X123.js',b'x',tarfile.REGTYPE)],
               [('index.html',b'changed',tarfile.REGTYPE),entries[1]]]
        cases += [[('index.html',b'',kind),entries[1]]for kind in(tarfile.SYMTYPE,tarfile.LNKTYPE,tarfile.DIRTYPE)]
        for case in cases:
            with self.subTest(case=[item[0]for item in case]):
                self.archive(case)
                with self.assertRaises(RuntimeError):self.e['payload_members'](self.path,self.expected,1024)
    def test_actual_member_bytes_are_bounded(self):
        self.archive(self.valid_entries())
        with self.assertRaises(RuntimeError):self.e['payload_members'](self.path,self.expected,1)

class BudgetTests(unittest.TestCase):
    def setUp(self):self.e=helpers()
    def budget(self,**changes):
        value={'approved':True,'profileSHA256':'a'*64,'ordinaryReserveBytes':256*1024**2,'physicalReserveBytes':8*1024**3,
               'archiveUpperBytes':2*1024**2,'imageGrowthUpperBytes':2*1024**2,'liveStageUpperBytes':2*1024**2,'evidenceUpperBytes':1024**2,'payloadUpperBytes':1024**2}
        value.update(changes);self.e.update(CAPACITY_BUDGET=value,EXPECTED_PROFILE_SHA256='a'*64,CAPACITY_BUDGET_SHA256=self.e['sha'](self.e['enc'](value)));return value
    def test_reserves_and_actual_payload_overhead_fit(self):
        budget=self.budget();self.assertEqual(self.e['capacity_contract'](),budget)
        plan=self.e['measured_payload_budget']({'index.html':b'index','assets/new-X123.js':b'asset'},100,budget)
        self.assertEqual(plan['payloadFiles'],2);self.assertGreater(plan['imageUpperEstimate'],10)
    def test_unapproved_mismatched_profile_or_lower_reserves_are_rejected(self):
        for changes in ({'approved':False},{'profileSHA256':'b'*64},{'ordinaryReserveBytes':256*1024**2-1},{'physicalReserveBytes':8*1024**3-1},{'payloadUpperBytes':True}):
            with self.subTest(changes=changes):
                self.budget(**changes)
                with self.assertRaises(RuntimeError):self.e['capacity_contract']()
    def test_underestimated_stage_or_image_is_rejected_before_build(self):
        budget=self.budget();budget['liveStageUpperBytes']=1
        with self.assertRaises(RuntimeError):self.e['measured_payload_budget']({'index.html':b'i'},100,budget)
        budget=self.budget();budget['imageGrowthUpperBytes']=1
        with self.assertRaises(RuntimeError):self.e['measured_payload_budget']({'index.html':b'i'},100,budget)
    def test_exact_image_growth_bound_and_integer_validation(self):
        self.assertEqual(self.e['candidate_growth']({'Size':100},{'Size':108},8),8)
        for a,b,upper in ((100,109,8),(100,100,8),(100,99,8),(100.0,108,8),(100,True,8),(100,108,0)):
            with self.subTest(a=a,b=b),self.assertRaises(RuntimeError):self.e['candidate_growth']({'Size':a},{'Size':b},upper)

class MetadataTests(unittest.TestCase):
    def setUp(self):
        self.e=helpers();self.row=lambda sha,mtime=1:{'sha256':sha,'uid':100,'gid':101,'mode':0o644,'bytes':10,'mtimeNS':mtime}
        self.old={'index.html':self.row('old-index'),'assets/old-X123.js':self.row('old')}
        self.new={'index.html':'new-index','assets/new-X123.js':'new'}
        self.after={**{k:dict(v)for k,v in self.old.items()},'index.html':self.row('new-index',2),'assets/new-X123.js':self.row('new',2)}
    def check(self):return self.e['static_records_preserved'](self.old,self.after,self.new,['assets/new-X123.js'],{'uid':100,'gid':101})
    def test_old_assets_and_metadata_are_retained(self):self.assertTrue(self.check())
    def test_old_metadata_drift_new_owner_or_extra_resource_is_rejected(self):
        for name,field,value in [('assets/old-X123.js','mtimeNS',9),('assets/new-X123.js','uid',0)]:
            prior=self.after[name][field];self.after[name][field]=value
            with self.assertRaises(RuntimeError):self.check()
            self.after[name][field]=prior
        self.after['assets/unreviewed-X123.js']=self.row('unreviewed')
        with self.assertRaises(RuntimeError):self.check()

class InertTests(unittest.TestCase):
    def test_execution_and_version_bindings_remain_unset(self):
        values={}
        for node in TREE.body:
            if isinstance(node,ast.Assign):
                for target in node.targets:
                    if isinstance(target,ast.Name):
                        try:values[target.id]=ast.literal_eval(node.value)
                        except(ValueError,TypeError):pass
        self.assertIs(values['EXECUTE'],False);self.assertEqual(values['PHASE'],'')
        for name in ('BASE','HOST_BASE','HEAD','TARGET','TREE','APP_TREE','SOURCE_APP_TREE','PREVIOUS_FRONTEND','PAYLOAD_SHA256','PROFILE_PATH','LIVE_IMAGE','STATIC_BASE_IMAGE','EXPECTED_LIVE_CID','PREPARED_SHA256','DEPLOY_SHA256'):
            self.assertEqual(values[name],'',name)
        node=next(n for n in TREE.body if isinstance(n,ast.Assign)and any(isinstance(t,ast.Name)and t.id=='CAPACITY_BUDGET'for t in n.targets))
        approved=next(v for k,v in zip(node.value.keys,node.value.values)if ast.literal_eval(k)=='approved')
        self.assertIs(ast.literal_eval(approved),False)

if __name__=='__main__':unittest.main()
