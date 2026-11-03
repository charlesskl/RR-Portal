"""Synthetic producer/consumer contracts, AST extraction only: no main/import/network/Docker."""
import ast
import copy
import hashlib
import json
import pathlib
import re
import types
import unittest

HERE=pathlib.Path(__file__).parent
RELEASE=HERE/'batch1061-indo-static-release.py'
PREFLIGHT=HERE/'batch1061-indo-preflight.py'
RTREE=ast.parse(RELEASE.read_text())
PTREE=ast.parse(PREFLIGHT.read_text())
BASE='e6459c7e9d7483527f7b22abbe93753183075fb8'
CID='c'*64
LIVE='sha256:'+'d'*64
CANONICAL='sha256:'+'e'*64
HOST='f'*40
PROFILE='/opt/rr-portal/deploy/backups/batch1061-indo-preflight-1-20261103/result.private.json'

def extracted(tree,names,**values):
    env={'hashlib':hashlib,'json':json,'pathlib':pathlib,'re':re,'STAGE':'synthetic',**values}
    nodes=[n for n in tree.body if isinstance(n,ast.FunctionDef)and n.name in names]
    assert len(nodes)==len(names)
    exec(compile(ast.Module(body=nodes,type_ignores=[]),'synthetic-contract-helpers','exec'),env)
    return env

def initial_result(tree,**values):
    main=next(n for n in tree.body if isinstance(n,ast.FunctionDef)and n.name=='main')
    node=next(n for n in main.body if isinstance(n,ast.Assign)and any(isinstance(t,ast.Name)and t.id=='result'for t in n.targets))
    env=dict(values)
    exec(compile(ast.Module(body=[node],type_ignores=[]),'synthetic-result-only','exec'),env)
    return env['result']

class ContractTests(unittest.TestCase):
    def setUp(self):
        self.shared={'docker-compose.cloud.yml':{'sha256':'1'*64}}
        self.envrows={'.env.cloud.production':{'sha256':'2'*64,'bytes':17,'uid':0,'gid':0,'mode':0o600}}
        self.auth={'resolvedRegular':{'sha256':'3'*64,'bytes':23,'uid':0,'gid':0,'mode':0o600},'sourceType':'REG','sourcePathSHA256':'4'*64}
        self.dirty={'rawPathInventorySHA256':'5'*64,'trackedPathCount':0}
        self.runtime={CID:{'image':LIVE,'envSHA256':'6'*64}}
        self.target={'Id':CID,'Mounts':[],'State':{'Running':True,'Health':{'Status':'healthy'},'OOMKilled':False}}
        self.web={'inventorySHA256':'7'*64,'files':{'index.html':{'sha256':'8'*64}}}
        self.p=types.SimpleNamespace(runtime=lambda:(copy.deepcopy(self.runtime),copy.deepcopy(self.target)),shared=lambda:copy.deepcopy(self.shared),
            dirty=lambda raw:copy.deepcopy(self.dirty),web_inventory=lambda target:copy.deepcopy(self.web),backend_inventory=lambda target:{'files':{}},
            public_profile=lambda index:{'healthDatabaseReadOnlySelect1':True},image=lambda:{'id':CANONICAL})
        self.q=types.SimpleNamespace(gateway_auth=lambda:copy.deepcopy(self.auth))
        self.common={'BASE':BASE,'APP':'apps/印尼小组/印尼走货明细','SERVICE':'indo-shipping','HOST_BASE':HOST,'EXPECTED_LIVE_CID':CID,'LIVE_IMAGE':LIVE,'STATIC_BASE_IMAGE':CANONICAL,
            'EXPECTED_STATIC_INVENTORY_SHA256':self.web['inventorySHA256'],'EXPECTED_DIRTY_SHA256':self.dirty['rawPathInventorySHA256'],'EXPECTED_CONTAINER_COUNT':1,
            'PROFILE_PATH':PROFILE,'P':self.p,'Q':self.q,'environment_files':lambda:copy.deepcopy(self.envrows),
            'git':lambda *args:(HOST if args[0]=='rev-parse'else '').encode()}

    def producer(self):
        e=extracted(PTREE,{'need','enc','sha','pin','observe'},**self.common)
        # Both the initial flags and the complete observation shape come from the actual producer AST.
        value=initial_result(PTREE,BASE=BASE,SERVICE='indo-shipping')
        value.update(e['observe'](),success=True,allOriginalRuntimeUnchanged=True,allObservedContractsUnchanged=True)
        return value

    def consumer(self,value):
        e=extracted(RTREE,{'need','enc','sha','pin','read','profile'},**self.common)
        value=copy.deepcopy(value);value.pop('resultSHA256',None);value['resultSHA256']=e['sha'](e['enc'](value));body=e['enc'](value)
        fake=types.SimpleNamespace(is_file=lambda:True,is_symlink=lambda:False,read_bytes=lambda:body)
        e.update(pathlib=types.SimpleNamespace(Path=lambda name:fake),EXPECTED_PROFILE_SHA256=e['sha'](body),EXPECTED_PROFILE_INNER_SHA256=value['resultSHA256'])
        return e

    def test_actual_new_preflight_shape_and_hash_only_flags_are_accepted(self):
        value=self.producer();e=self.consumer(value);accepted=e['profile']()
        self.assertTrue(accepted['environmentFileRead']);self.assertTrue(accepted['environmentFileHashedOnly'])
        self.assertFalse(accepted['environmentFileBodiesCopied']);self.assertEqual(accepted['env'],self.envrows);self.assertEqual(accepted['gatewayAuth'],self.auth)

    def test_resealed_unsafe_or_ambiguous_profile_flags_are_rejected(self):
        changes={'environmentFileRead':False,'environmentFileHashedOnly':False,'environmentFileBodiesCopied':True,'rawDockerConfigOrEnvExported':True,
            'explicitSqlAccessPerformed':True,'plaintextCredentialsWritten':True,'healthReadOnlyProbe':False,'sourceHintOnly':False,'liveSourceMatchClaimed':True}
        for key,bad in changes.items():
            with self.subTest(key=key):
                value=self.producer();value[key]=bad;e=self.consumer(value)
                with self.assertRaises(RuntimeError):e['profile']()

    def test_hash_only_host_protection_matches_actual_producer_observation(self):
        e=extracted(RTREE,{'host_files'},**self.common)
        current=e['host_files']();profile=self.producer()
        self.assertEqual(set(current),{'shared','unstaged','staged','env','gatewayAuth'})
        self.assertEqual(current,{k:profile[k]for k in current})

    def test_each_phase_rejects_environment_or_gateway_drift_before_live_writes(self):
        baseline={k:self.producer()[k]for k in('shared','unstaged','staged','env','gatewayAuth')}
        prepared={'runtime':copy.deepcopy(self.runtime),'hostFiles':baseline,'maintenance':{},'composeTagBefore':CANONICAL,'durableTag':'synthetic-candidate','durableImage':CANONICAL,'actualImageGrowth':1}
        for phase in('prepare','deploy','verify'):
            for scope in('env','gatewayAuth'):
                with self.subTest(phase=phase,scope=scope):
                    current=copy.deepcopy(baseline);current[scope]={'changed-hash':'9'*64}
                    def unexpected(*a,**kw):raise AssertionError('no live write or later work should be reached')
                    e=extracted(RTREE,{'need',phase},**self.common)
                    e.update(profile=self.producer,local_build_contract=lambda:{},capacity_contract=lambda:{},inventory=lambda:(copy.deepcopy(self.target),copy.deepcopy(self.runtime)),
                        host_files=lambda:current,maintenance=lambda:{},ensure_build_space=lambda *a,**kw:None,load_prepared=lambda:prepared,
                        target_unchanged=lambda *a:None,image_id=lambda name:CANONICAL,run=unexpected,PREPARED_SHA256='a'*64,DEPLOY_SHA256='b'*64,
                        sealed=lambda *a:(pathlib.Path('/synthetic'),{}),read=lambda path:{'runtime':self.runtime,'retainedPublicRollbackStage':'/synthetic'},RECOVERY={},CAPACITY_PROGRESS={})
                    self.target['State']['Pid']=42
                    with self.assertRaises(RuntimeError)as raised:e[phase]()
                    self.assertIn('exact'if phase=='prepare'else 'pins'if phase=='deploy'else 'durable-image',str(raised.exception))

    def test_both_scripts_bind_the_same_actual_hash_only_auth_helper(self):
        depnode=next(n for n in PTREE.body if isinstance(n,ast.Assign)and any(isinstance(t,ast.Name)and t.id=='DEPS'for t in n.targets))
        deps=ast.literal_eval(depnode.value)
        pins={t.id:ast.literal_eval(n.value)for n in RTREE.body if isinstance(n,ast.Assign)for t in n.targets if isinstance(t,ast.Name)and t.id in('AUTH_COMMON_NAME','AUTH_COMMON_SHA256')}
        name=pins['AUTH_COMMON_NAME'];self.assertEqual(pins['AUTH_COMMON_SHA256'],deps[name]);self.assertEqual(hashlib.sha256((HERE/name).read_bytes()).hexdigest(),deps[name])

    def test_release_result_honestly_reports_protected_environment_reads(self):
        result=initial_result(RTREE,PHASE='prepare',SERVICE='indo-shipping',BASE='',HEAD='',TARGET='',TREE='',APP_TREE='',HOST_BASE='')
        self.assertTrue(result['environmentFileRead']);self.assertTrue(result['environmentFileHashedOnly']);self.assertFalse(result['environmentFileBodiesCopied'])
        self.assertTrue(result['healthReadOnlyProbe']);self.assertFalse(result['explicitSqlAccessPerformed']);self.assertFalse(result['rawDockerConfigOrEnvExported'])

class BuildSourceContractTests(unittest.TestCase):
    MERGED_MAIN='bc94908439ed3414b013d72f00f128a6459cf0aa'
    REVIEWED_PR='84bcd989ce13d1e8255d4ed27321f1fa5d4ab324'
    APP_TREE='848f96985403eef1a38102a4f6a0613eb6901552'

    def consumer(self,source_head=None,app_tree=None):
        # These are the actual distinct #1061 merge and reviewed PR commits. The
        # local-build contract must bind the former while source_check keeps the latter.
        e=extracted(RTREE,{'need','enc','sha','pin','read','local_build_contract'},
            HEAD=self.REVIEWED_PR,TARGET=self.MERGED_MAIN,APP_TREE=self.APP_TREE,__file__='/synthetic/operator.py',
            LOCAL_BUILD_PROVENANCE_NAME='batch1061-indo-build-provenance.json')
        manifest={'index.html':'1'*64}
        value={'sourceHead':source_head or self.MERGED_MAIN,'appTree':app_tree or self.APP_TREE,
            'newManifestSHA256':e['sha'](e['enc'](manifest)),'VITE_BASE_PATH':'/indo-shipping/','sourceExtraction':'git-archive',
            'freshExtraction':True,'freshNpmCi':True,'npmCiExitCode':0,'buildExitCode':0,
            'nodeModulesRootSymlink':False,'nodeModulesExternalSymlinks':0}
        body=e['enc'](value)
        fake=types.SimpleNamespace(is_file=lambda:True,is_symlink=lambda:False,read_bytes=lambda:body,
            stat=lambda:types.SimpleNamespace(st_size=len(body)))
        fake.with_name=lambda name:fake
        e.update(pathlib=types.SimpleNamespace(Path=lambda name:fake),EXPECTED_NEW_MANIFEST=manifest,
            EXPECTED_NEW_MANIFEST_SHA256=value['newManifestSHA256'],EXPECTED_LOCAL_BUILD_PROVENANCE_SHA256=e['sha'](body))
        return e

    def test_actual_merged_main_build_is_accepted_with_distinct_reviewed_pr_head(self):
        e=self.consumer();self.assertNotEqual(e['HEAD'],e['TARGET'])
        self.assertEqual(e['local_build_contract']()['sourceHead'],self.MERGED_MAIN)

    def test_resealed_build_from_pr_head_or_other_commit_is_rejected(self):
        for source in(self.REVIEWED_PR,'9'*40):
            with self.subTest(source=source):
                e=self.consumer(source_head=source)
                with self.assertRaises(RuntimeError):e['local_build_contract']()

    def test_resealed_merge_build_with_different_app_tree_is_rejected(self):
        e=self.consumer(app_tree='8'*40)
        with self.assertRaises(RuntimeError):e['local_build_contract']()

if __name__=='__main__':unittest.main()
