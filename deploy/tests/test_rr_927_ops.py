"""Offline safety checks only: no Docker, network, production files or credentials."""
import contextlib
import importlib.util
import io
import json
import os
import pathlib
import re
import shutil
import subprocess
import tempfile
import unittest
from unittest import mock

SPEC = importlib.util.spec_from_file_location('rr927', pathlib.Path(__file__).parents[1] / 'ops/rr-927.py')
ops = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(ops)


def fixture():
    data = {kind + suffix: [] for kind in ops.TYPES for suffix in ('_orders', '_items')}
    data.update({'material_requisitions': [], 'assembly_users': [], 'clients': ['A', 'B'],
                 'material_prices': [{'material': 'PP', 'unit_price': 2}],
                 'exchange_rate_rmb_to_hkd': 1.08, 'auth_pins': {'supervisors': {'S': 'private-pin-hash'}, 'manager': {'M': 'private-pin-hash'}},
                 'auth_pins_must_change': {'supervisors': {}, 'manager': {}}})
    return data


SOURCE = """const ALL_SUPERVISORS = ['S'];
const ALL_MANAGERS = ['M'];
const DEFAULT_CLIENTS = ['A','B'];
(function initPins() {})();
(function backfillSprayCompletedDate() {})();
(function initClients() {})();"""
NODE = os.environ.get('RR_927_TEST_NODE') or shutil.which('node')


def startup_effects(data, seed, source=SOURCE):
    payload = json.dumps({'original': data, 'seed': seed, 'source': source}).encode()
    value = subprocess.run([NODE, '-e', ops.STARTUP_AUDIT], input=payload, capture_output=True, check=True)
    return json.loads(value.stdout)


class SnapshotTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = pathlib.Path(self.temporary.name)
        self.source = self.root / 'source'
        self.source.mkdir()
        self.data = fixture()
        (self.source / 'data.json').write_text(json.dumps(self.data))
        (self.source / 'assembly-images' / '1').mkdir(parents=True)
        (self.source / 'assembly-images' / '1' / 'picture.png').write_bytes(b'private-image')

    def test_full_copy_preserves_json_pins_and_images_with_private_permissions(self):
        destination = self.root / 'snapshot'
        manifest, data = ops.consistent_copy(self.source, destination)
        self.assertEqual(ops.inventory(self.source), manifest)
        self.assertEqual(data, self.data)
        self.assertEqual((destination / 'data.json').stat().st_mode & 0o777, 0o600)
        self.assertEqual(destination.stat().st_mode & 0o777, 0o700)
        (self.source / 'assembly-images/1/picture.png').write_bytes(b'changed-image')
        self.assertNotEqual(ops.inventory(self.source), manifest)

    def test_symlink_data_cannot_be_copied(self):
        (self.source / 'linked').symlink_to(self.source / 'data.json')
        with mock.patch.object(ops.time, 'sleep'), self.assertRaises(RuntimeError):
            ops.consistent_copy(self.source, self.root / 'snapshot')
        self.assertFalse((self.root / 'snapshot').exists())

    def test_fifo_rejected_before_open_without_blocking(self):
        path = self.source / 'unexpected-fifo'
        os.mkfifo(path)
        with mock.patch.object(ops.os, 'open') as opened:
            with self.assertRaises(RuntimeError):
                ops.read_regular(path)
        opened.assert_not_called()

    def test_mutation_retries_at_most_three_times_and_never_accepts_unstable_copy(self):
        actual_inventory = ops.inventory
        calls = []
        def changing(directory):
            if directory == self.source:
                calls.append(True)
                (self.source / 'data.json').write_text(json.dumps({**self.data, 'revision': len(calls)}))
            return actual_inventory(directory)
        with mock.patch.object(ops, 'inventory', side_effect=changing), mock.patch.object(ops.time, 'sleep') as sleep:
            with self.assertRaises(RuntimeError):
                ops.consistent_copy(self.source, self.root / 'snapshot')
        self.assertEqual(len(calls), 6)
        self.assertEqual(sleep.call_count, 2)
        self.assertFalse((self.root / 'snapshot').exists())

    def test_json_logical_values_ignore_object_order_but_detect_real_value_changes(self):
        self.assertEqual(ops.logical({'a': [1, 2], 'b': True}), ops.logical({'b': True, 'a': [1, 2]}))
        self.assertNotEqual(ops.logical({'a': [1, 2]}), ops.logical({'a': [2, 1]}))

    def test_missing_or_unsafe_image_reference_is_not_silent(self):
        data = fixture()
        data['assembly_orders'] = [{'id': 1, 'images': ['picture.png']}]
        self.assertEqual(ops.image_references(data, ops.inventory(self.source)['files']), 0)
        data['assembly_items'] = [{'order_id': 1, 'image': 'missing.png'}]
        self.assertEqual(ops.image_references(data, ops.inventory(self.source)['files']), 1)
        data['assembly_orders'][0]['images'] = ['../../secret']
        with self.assertRaises(RuntimeError):
            ops.image_references(data, {})


class GuardTests(unittest.TestCase):
    @unittest.skipUnless(NODE, 'Node is needed for exact production JavaScript semantics')
    def test_no_pending_startup_changes_and_each_real_migration_detected(self):
        data = fixture()
        seed = data['material_prices']
        self.assertFalse(any(startup_effects(data, seed).values()))
        data['auth_pins']['manager'].clear()
        data['spray_orders'] = [{'id': 1, 'status': '已完成'}]
        data['spray_items'] = [{'order_id': 1, 'progress_at': '2026-10-15T00:00:00Z'}]
        del data['exchange_rate_rmb_to_hkd']
        del data['assembly_users']
        effects = startup_effects(data, [{'material': 'NEW'}])
        self.assertEqual(effects['missingPins'], 1)
        self.assertEqual(effects['sprayCompletionBackfills'], 1)
        self.assertEqual(effects['seedMaterialsToAdd'], 1)
        self.assertEqual(effects['missingExchangeRate'], 1)
        self.assertEqual(effects['missingCollections'], 1)

    @unittest.skipUnless(NODE, 'Node is needed for exact production JavaScript semantics')
    def test_invalid_historical_timestamps_do_not_falsely_block_deployment(self):
        data = fixture()
        data['spray_orders'] = [{'id': 1, 'status': '已完成'}]
        data['spray_items'] = [{'order_id': 1, 'progress_at': 'invalid-timestamp'}]
        self.assertFalse(any(startup_effects(data, data['material_prices']).values()))

    @unittest.skipUnless(NODE, 'Node is needed for exact production JavaScript semantics')
    def test_client_guard_matches_real_init_clients_iife_including_no_change_rewrite(self):
        server = (pathlib.Path(__file__).parents[2] / ops.APP / 'server.js').read_text()
        initializers = re.findall(r'^\(function\s+(\w+)\(', server, re.MULTILINE)
        self.assertEqual(initializers, ['initPins', 'backfillSprayCompletedDate', 'initClients'])
        real_iife = re.search(r'^\(function initClients\(\) \{.*?^\}\)\(\);', server,
                              re.MULTILINE | re.DOTALL).group()
        program = r"""
const input = JSON.parse(require('fs').readFileSync(0,'utf8'));
const data = input.data; let writes = 0;
require('vm').runInNewContext(input.iife,{loadData:()=>data,DEFAULT_CLIENTS:input.defaults,saveData:()=>writes++});
console.log(JSON.stringify({writes,clients:data.clients}));
"""
        cases = [(None, ['A', 'B']), ([], ['A', 'B']), (['A'], ['A', 'B']),
                 (['A', 'B'], ['A', 'B']), (['A'], ['A', 'A'])]
        for clients, defaults in cases:
            with self.subTest(clientCount=None if clients is None else len(clients), defaultCount=len(defaults)):
                data = fixture()
                if clients is None:
                    del data['clients']
                else:
                    data['clients'] = clients
                source = SOURCE.replace("['A','B']", json.dumps(defaults))
                effects = startup_effects(data, data['material_prices'], source)
                value = subprocess.run([NODE, '-e', program], input=json.dumps({
                    'data': data, 'defaults': defaults, 'iife': real_iife}).encode(), capture_output=True, check=True)
                actual = json.loads(value.stdout)
                self.assertEqual(effects['pendingClientInitialization'] + effects['pendingClientRewrite'], actual['writes'])
                if clients == ['A'] and defaults == ['A', 'A']:
                    self.assertEqual(actual['clients'], clients)
                    self.assertEqual(effects['otherLogicalStartupChanges'], 0)
                    self.assertEqual(effects['pendingClientRewrite'], 1)

    @unittest.skipUnless(NODE, 'Node is needed for exact production JavaScript semantics')
    def test_unknown_named_startup_initializer_requires_review(self):
        with self.assertRaises(subprocess.CalledProcessError):
            startup_effects(fixture(), fixture()['material_prices'], SOURCE + '\n(function unexpectedMigration() {})();')

    @unittest.skipUnless(NODE, 'Node is needed for exact production JavaScript semantics')
    def test_http_audit_checks_authoritative_items_instead_of_stale_nested_shadow(self):
        data = fixture()
        data['assembly_orders'] = [{'id': 1, 'status': '待报价', 'items': [{'id': 999, 'price': 999}]}]
        data['assembly_items'] = [{'id': 10, 'order_id': 1, 'sort_order': 0, 'price': 5}]
        actual = {'id': 1, 'status': '待报价', 'items': data['assembly_items']}
        prefix = r"""
const rrFs = require('fs');
const rrInput = JSON.parse(rrFs.readFileSync(0,'utf8'));
rrFs.readFileSync = () => JSON.stringify(rrInput.disk);
global.fetch = async url => {
 if (url.endsWith('.html')) return {status:200,headers:new Map([['cache-control','no-store']]),arrayBuffer:async()=>Buffer.from('待报价')};
 if (url.endsWith('/stats')) return {status:200,json:async()=>({injection:{total:0},slush:{total:0},spray:{total:0},assembly:{total:1}})};
 return {status:200,json:async()=>url.endsWith('/assembly')?[rrInput.actual]:[]};
};
"""
        def audit(actual):
            payload = json.dumps({'disk': data, 'actual': actual}).encode()
            value = subprocess.run([NODE, '-e', prefix + ops.HTTP_AUDIT], input=payload, capture_output=True, check=True)
            return json.loads(value.stdout)['api']['assembly']['fullOrdersAndItemsMatch']
        self.assertTrue(audit(actual))
        changed = {**actual, 'items': [{**data['assembly_items'][0], 'price': 6}]}
        self.assertFalse(audit(changed))

    def test_base_image_env_metadata_changes_allowed_but_pin_salt_change_detected(self):
        value = {'Id': 'a' * 64, 'Image': 'sha256:old', 'RestartCount': 0,
                 'State': {'Running': True, 'Health': {'Status': 'healthy'}, 'StartedAt': 'fixed', 'OOMKilled': False},
                 'Mounts': [{'Type': 'bind', 'RW': True, 'Destination': '/app/data', 'Source': str(ops.ROOT / ops.APP / 'data')}],
                 'Config': {'Env': ['PORT=3000', 'BASE_PATH=/rr', 'NODE_VERSION=20.0', 'PIN_SALT=private-salt']}}
        with mock.patch.object(ops, 'inspect', return_value=value):
            baseline = ops.runtime()
            value['Config']['Env'][2] = 'NODE_VERSION=20.1'
            self.assertEqual(ops.runtime()['applicationConfigSha256'], baseline['applicationConfigSha256'])
            value['Config']['Env'][3] = 'PIN_SALT=changed-private-salt'
            self.assertNotEqual(ops.runtime()['applicationConfigSha256'], baseline['applicationConfigSha256'])

    def test_fixed_service_and_exact_sha_arguments_fail_before_commands(self):
        with mock.patch.object(ops, 'run') as run:
            with self.assertRaises(RuntimeError):
                ops.cid('other-service')
            with self.assertRaises(RuntimeError):
                ops.main(['backup', ops.BEFORE, 'main', ''])
            with self.assertRaises(RuntimeError):
                ops.main(['verify', ops.BEFORE, 'a' * 40, '/tmp/untrusted'])
            run.assert_not_called()

    def test_command_output_is_captured_without_logging_private_values(self):
        process = mock.Mock(returncode=0, stdout=b'private-business-rows', stderr=b'private-secret')
        output = io.StringIO()
        with mock.patch.object(ops.subprocess, 'run', return_value=process), contextlib.redirect_stdout(output):
            self.assertEqual(ops.run(['docker', 'inspect', 'fixed']), b'private-business-rows')
        self.assertEqual(output.getvalue(), '')


if __name__ == '__main__':
    unittest.main()
