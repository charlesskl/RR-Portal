"""Synthetic pure-helper checks; never imports or invokes the release entry point."""
import ast
import hashlib
import json
import os
import pathlib
import stat
import subprocess
import tempfile
import unittest

DRAFT = pathlib.Path(__file__).with_name('batch1056-1058-qc-release.py')
NODE = pathlib.Path('/Users/fovo/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node')
SOURCE = ast.parse(DRAFT.read_text())


def extracted_helpers(code_root):
    selected = {'need', 'enc', 'sha', 'code_bind_manifest', 'candidate_image_growth', 'remaining_capacity'}
    definitions = [node for node in SOURCE.body if isinstance(node, ast.FunctionDef) and node.name in selected]
    assert len(definitions) == len(selected)
    env = {'pathlib': pathlib, 'hashlib': hashlib, 'json': json, 'os': os, 'stat': stat,
           'CODE_ROOT': code_root, 'CODE': ('app.js', 'server/server.js'),
           'budget_contract': lambda: {'imageGrowthUpperBytes': 8}, 'STAGE': 'test'}
    exec(compile(ast.Module(body=definitions, type_ignores=[]), str(DRAFT) + ':helpers-only', 'exec'), env)
    return env


def literal(name):
    node = next(node for node in SOURCE.body if isinstance(node, ast.Assign) and
                any(isinstance(target, ast.Name) and target.id == name for target in node.targets))
    return ast.literal_eval(node.value)


class CodeBindGuardTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='synthetic-qc-code-guard-')
        self.addCleanup(self.temp.cleanup)
        self.root = pathlib.Path(self.temp.name).resolve()
        (self.root / 'server').mkdir()
        (self.root / 'app.js').write_text('/* synthetic frontend */')
        (self.root / 'server/server.js').write_text('/* synthetic backend */')
        self.env = extracted_helpers(self.root)

    def reject(self):
        with self.assertRaises((RuntimeError, FileNotFoundError)):
            self.env['code_bind_manifest']()

    def test_dangling_payload_symlink_is_rejected(self):
        (self.root / 'app.js').unlink()
        (self.root / 'app.js').symlink_to(self.root / 'missing-target')
        self.reject()

    def test_existing_payload_symlink_is_rejected(self):
        (self.root / '.private-file').write_text('synthetic private value')
        (self.root / 'app.js').unlink()
        (self.root / 'app.js').symlink_to(self.root / '.private-file')
        self.reject()

    def test_payload_directory_is_rejected(self):
        (self.root / 'app.js').unlink()
        (self.root / 'app.js').mkdir()
        self.reject()

    def test_payload_hardlink_is_rejected(self):
        os.link(self.root / 'app.js', self.root / '.private-hardlink')
        self.reject()

    def test_symlinked_payload_parent_is_rejected(self):
        (self.root / 'server/server.js').unlink()
        (self.root / 'server').rmdir()
        (self.root / 'other-directory').mkdir()
        (self.root / 'server').symlink_to(self.root / 'other-directory', target_is_directory=True)
        self.reject()

    def test_nonpayload_private_link_is_hashed_and_preserved_without_following(self):
        (self.root / '.private-link').symlink_to('synthetic-missing-target')
        (self.root / 'data').mkdir()
        (self.root / 'data/excluded-business-sample').write_text('synthetic data must not be scanned')
        first = self.env['code_bind_manifest']()
        second = self.env['code_bind_manifest']()
        self.assertEqual(first, second)
        key = hashlib.sha256(b'.private-link').hexdigest()
        entry = first['entries'][key]
        self.assertEqual(entry['type'], 'symlink')
        self.assertEqual(entry['targetSHA256'], hashlib.sha256(b'synthetic-missing-target').hexdigest())
        self.assertNotIn('publicPath', entry)
        self.assertNotIn('synthetic-missing-target', json.dumps(first))
        self.assertNotIn(hashlib.sha256(b'data/excluded-business-sample').hexdigest(), first['entries'])
        self.assertFalse(first['dataSubtreeTraversed'])


class ImageGrowthGuardTests(unittest.TestCase):
    def setUp(self):
        self.env = extracted_helpers(pathlib.Path('/unused-synthetic-path'))

    def test_exact_positive_increment_at_bound_is_accepted(self):
        self.assertEqual(self.env['candidate_image_growth']({'Size': 100}, {'Size': 108}),
                         {'baseBytes': 100, 'candidateBytes': 108, 'incrementBytes': 8, 'upperBytes': 8})

    def test_overgrowth_equal_or_smaller_image_is_rejected(self):
        for size in [109, 100, 99]:
            with self.subTest(size=size), self.assertRaises(RuntimeError):
                self.env['candidate_image_growth']({'Size': 100}, {'Size': size})

    def test_noninteger_or_nonpositive_sizes_are_rejected(self):
        for old, new in [(True, 108), (100, True), (100.0, 108), (100, 108.0), ('100', 108),
                         (100, '108'), (0, 108), (100, 0), (-1, 7), (None, 108)]:
            with self.subTest(old=old, new=new), self.assertRaises(RuntimeError):
                self.env['candidate_image_growth']({'Size': old}, {'Size': new})


class RemainingCapacityTests(unittest.TestCase):
    def setUp(self):
        self.env = extracted_helpers(pathlib.Path('/unused-synthetic-path'))
        self.mib = 1024 ** 2
        self.budget = {'ordinaryReserveBytes': 256 * self.mib,
                       'physicalReserveBytes': 8 * 1024 ** 3,
                       'imageGrowthUpperBytes': 8 * self.mib,
                       'overlayStageUpperBytes': 4 * self.mib,
                       'coldBackupUpperBytes': 16 * self.mib,
                       'evidenceUpperBytes': 16 * self.mib}

    def test_allocated_archive_is_not_reserved_twice(self):
        for allocated, ordinary in [(0, 300), (4, 296), (12, 288), (36, 264)]:
            with self.subTest(allocated=allocated):
                result = self.env['remaining_capacity'](self.budget, allocated * self.mib)
                self.assertEqual(result['ordinary'], ordinary * self.mib)
                self.assertEqual(result['physical'], 8 * 1024 ** 3 + (ordinary - 256) * self.mib)

    def test_invalid_allocation_or_exceeded_archive_bound_is_rejected(self):
        for used in [-1, True, 1.0, '1', None, 36 * self.mib + 1]:
            with self.subTest(used=used), self.assertRaises(RuntimeError):
                self.env['remaining_capacity'](self.budget, used)


class EmbeddedQuietProbeTests(unittest.TestCase):
    def test_actual_probe_counts_an_active_connection_and_ignores_terminal_or_other_ports(self):
        probe = literal('QUIET_PROBE')
        fixture = ('  sl  local_address rem_address st\n'
                   '   0: 0100007F:0D48 0100007F:A001 01\n'
                   '   1: 00000000:0D48 00000000:0000 0A\n'
                   '   2: 0100007F:0D48 0100007F:A002 06\n'
                   '   3: 0100007F:0D48 0100007F:A003 07\n'
                   '   4: 0100007F:0050 0100007F:A004 01\n')
        script = '''const vm=require('node:vm'),assert=require('node:assert/strict');
let result;const fixtures=JSON.parse(process.argv[1]);
vm.runInNewContext(fixtures.probe,{require(name){assert.equal(name,'fs');return{readFileSync(file,encoding){
assert.equal(encoding,'utf8');return file==='/proc/net/tcp'?fixtures.tcp:'sl local_address rem_address st\\n';}};},
console:{log(value){result=JSON.parse(value);}}});assert.equal(result.connections,1);'''
        result = subprocess.run([str(NODE), '-e', script, json.dumps({'probe': probe, 'tcp': fixture})],
                                capture_output=True, text=True, timeout=10)
        self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == '__main__':
    unittest.main()
