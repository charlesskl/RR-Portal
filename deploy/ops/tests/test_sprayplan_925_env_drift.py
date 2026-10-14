"""Offline environment reconstruction fixtures. No real Docker, SSH or business data."""
import ast
import contextlib
import copy
import importlib.util
import io
import json
import os
import pathlib
import subprocess
import tempfile
import textwrap
import unittest
from unittest.mock import patch

PATH = pathlib.Path(__file__).resolve().parents[1] / 'sprayplan-925-env-drift.py'
TEXT = PATH.read_text()
spec = importlib.util.spec_from_file_location('environment_drift_925', PATH)
ops = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ops)


class EnvironmentDriftTests(unittest.TestCase):
    def setUp(self):
        self.old_image = {'PATH': '/private/unchanged', 'DOTNET_VERSION': '8.0.20', 'ASPNET_VERSION': '8.0.20',
                          'NODE_ENV': 'production', 'ASPNETCORE_ENVIRONMENT': 'Production'}
        self.new_image = {**self.old_image, 'DOTNET_VERSION': '8.0.21', 'ASPNET_VERSION': '8.0.21'}
        self.config = {**self.new_image, 'NODE_ENV': 'production', 'NEXT_PUBLIC_BASE_PATH': '/sprayplan',
                       'DOTNET_API_URL': 'http://127.0.0.1:5080', 'DATA_PATH': '/app/data', 'TZ': 'Asia/Shanghai'}
        self.old_config = {**self.config, **self.old_image}
        self.current = {'containerId': 'b' * 64, 'imageId': 'sha256:' + 'd' * 64, 'environment': ops.env_rows(self.config),
                        'hostname': 'b' * 12, 'service': 'sprayplan', 'running': True, 'health': 'healthy'}
        common = {**self.config, 'HOSTNAME': 'b' * 12, 'JWT_SECRET': 'never-print-secret=授权码',
                  'Jwt__Secret': 'never-print-secret=授权码', 'Jwt__Issuer': 'sprayplan',
                  'SPRAYPLAN_DB_PATH': '/app/data/sprayplan.db', 'SPRAYPLAN_BASE_PATH': '/sprayplan', 'SHLVL': '1'}
        self.processes = {'api': {**common, 'PWD': '/app/server/SprayPlan.Api', 'OLDPWD': '/app', '_': '/usr/bin/dotnet'},
                          'web': {**common, 'PWD': '/app', '_': '/usr/local/bin/node'}}
        self.old = {'imageId': 'sha256:' + 'c' * 64, 'containerId': 'a' * 64, 'containerHostname': 'a' * 12,
                    'explicitHostnameConfigured': False, 'configEnvSha256': ops.env_hash(self.old_config), 'processEnvironments': {}}
        for kind, current in self.processes.items():
            prior = {**current, **self.old_image, 'HOSTNAME': 'a' * 12}
            self.old['processEnvironments'][kind] = {'hostname': 'a' * 12,
                'completeSha256': ops.env_hash(prior, process=True),
                'withoutHostnameSha256': ops.env_hash({k: v for k, v in prior.items() if k != 'HOSTNAME'}, process=True)}

    def diagnose(self):
        with patch.object(ops, 'container', return_value=(self.current, self.config)), \
             patch.object(ops, 'image', side_effect=lambda identifier, service, generation: self.old_image if generation == 'old' else self.new_image), \
             patch.object(ops, 'processes', return_value=self.processes):
            return ops.diagnose_service('sprayplan', self.old)

    def version_diagnose(self):
        with patch.object(ops, 'container', return_value=(self.current, self.config)), \
             patch.object(ops, 'image', return_value=self.new_image) as image, \
             patch.object(ops, 'processes', return_value=self.processes):
            result = ops.diagnose_version_service('sprayplan', self.old)
            self.assertEqual([(self.current['imageId'], 'sprayplan', 'new')], [call.args for call in image.call_args_list])
            return result

    def set_prior_versions(self, dotnet, aspnet):
        prior_config = {**self.config, 'DOTNET_VERSION': dotnet, 'ASPNET_VERSION': aspnet}
        self.old['configEnvSha256'] = ops.env_hash(prior_config)
        for kind, current in self.processes.items():
            prior = {**current, 'DOTNET_VERSION': dotnet, 'ASPNET_VERSION': aspnet, 'HOSTNAME': 'a' * 12}
            self.old['processEnvironments'][kind] = {'hostname': 'a' * 12,
                'completeSha256': ops.env_hash(prior, process=True),
                'withoutHostnameSha256': ops.env_hash({k: v for k, v in prior.items() if k != 'HOSTNAME'}, process=True)}

    def test_exact_reconstruction_reports_only_keys_and_proof(self):
        result = self.diagnose()
        self.assertEqual(['ASPNET_VERSION', 'DOTNET_VERSION'], result['imageInheritedChangedKeys'])
        self.assertTrue(result['oldContainerEnvironmentReconstructedExact'])
        self.assertTrue(result['oldApiEnvironmentReconstructedExact']); self.assertTrue(result['oldWebEnvironmentReconstructedExact'])
        self.assertTrue(result['allImageChangesAreDotnet8VersionMetadata'])
        text = json.dumps(result)
        for private in ['never-print', '授权码', '/private', '8.0.20', '8.0.21']:
            self.assertNotIn(private, text)

    def test_unaccounted_config_environment_jwt_path_and_new_key_fail(self):
        for key in ['JWT_SECRET', 'PATH', 'UNEXPECTED_SETTING']:
            with self.subTest(key=key):
                prior = copy.deepcopy(self.config)
                self.config[key] = 'never-print-drift'
                with self.assertRaises(RuntimeError):
                    self.diagnose()
                self.assertEqual('oldContainerEnvironmentReconstructedExact:sprayplan', ops.FAILED)
                self.config = prior

    def test_process_secret_path_pwd_and_issuer_drift_fail_without_dropping_keys(self):
        for kind in ['api', 'web']:
            for key in ['JWT_SECRET', 'Jwt__Secret', 'Jwt__Issuer', 'PATH', 'PWD', 'SHLVL']:
                with self.subTest(kind=kind, key=key):
                    prior = copy.deepcopy(self.processes)
                    self.processes[kind][key] = 'never-print-drift'
                    with self.assertRaises(RuntimeError):
                        self.diagnose()
                    self.assertEqual('oldProcessEnvironmentReconstructedExact:sprayplan:' + kind, ops.FAILED)
                    self.processes = prior

    def test_compose_override_never_inferred_from_equal_default(self):
        self.old_image['NODE_ENV'] = 'old-base-value'
        with self.assertRaises(RuntimeError):
            self.diagnose()
        self.assertEqual('changedKeysInheritedFromImage:sprayplan', ops.FAILED)

    def test_protected_image_keys_cannot_be_substituted_even_with_matching_candidate(self):
        for key in ops.PROTECTED:
            with self.subTest(key=key):
                old_image, new_image = copy.deepcopy(self.old_image), copy.deepcopy(self.new_image)
                self.old_image[key], self.new_image[key] = 'old-private-value', 'new-private-value'
                with self.assertRaises(RuntimeError):
                    self.diagnose()
                self.assertEqual('protectedImageEnvironmentUnchanged:sprayplan', ops.FAILED)
                self.old_image, self.new_image = old_image, new_image

    def test_added_and_removed_image_keys_require_full_hash_match(self):
        self.new_image['ADDED'] = 'never-print-new-image'
        self.config['ADDED'] = self.new_image['ADDED']
        self.old_image['REMOVED'] = 'never-print-old-image'
        self.old_config['REMOVED'] = self.old_image['REMOVED']
        self.old['configEnvSha256'] = ops.env_hash(self.old_config)
        for kind, environment in self.processes.items():
            environment['ADDED'] = self.new_image['ADDED']
            prior = {**environment, **self.old_image, 'HOSTNAME': 'a' * 12}
            prior.pop('ADDED')
            self.old['processEnvironments'][kind] = {'hostname': 'a' * 12,
                'completeSha256': ops.env_hash(prior, process=True),
                'withoutHostnameSha256': ops.env_hash({k: v for k, v in prior.items() if k != 'HOSTNAME'}, process=True)}
        result = self.diagnose()
        self.assertIn('ADDED', result['imageInheritedChangedKeys']); self.assertIn('REMOVED', result['imageInheritedChangedKeys'])
        self.assertFalse(result['allImageChangesAreDotnet8VersionMetadata'])

    def test_image_drift_not_inherited_by_process_is_rejected(self):
        self.processes['api']['DOTNET_VERSION'] = 'manual-value'
        with self.assertRaises(RuntimeError):
            self.diagnose()
        self.assertEqual('changedProcessKeysInheritedFromConfiguration:sprayplan', ops.FAILED)

    def test_duplicate_invalid_or_non_string_environment_entries_fail(self):
        for rows in [['A=1', 'A=2'], ['never-print-key!=secret'], ['=private'], [None], ['NO_EQUALS'], ['KEY=a\x00b']]:
            with self.subTest(rows=rows):
                with self.assertRaises(RuntimeError):
                    ops.env_map(rows)

    def test_wrong_old_process_hash_or_hostname_are_not_exempted(self):
        self.old['processEnvironments']['api']['completeSha256'] = '0' * 64
        with self.assertRaises(RuntimeError):
            self.diagnose()
        self.processes['api']['HOSTNAME'] = 'fake-automatic-host'
        with self.assertRaises(RuntimeError):
            self.diagnose()
        self.assertEqual('changedProcessKeysInheritedFromConfiguration:sprayplan', ops.FAILED)

    def test_unstable_observation_is_rejected(self):
        with patch.object(ops, 'container', side_effect=[(self.current, self.config), ({**self.current, 'containerId': 'e' * 64}, self.config)]), \
             patch.object(ops, 'image', side_effect=[self.old_image, self.new_image]), \
             patch.object(ops, 'processes', return_value=self.processes):
            with self.assertRaises(RuntimeError):
                ops.diagnose_service('sprayplan', self.old)
        self.assertEqual('environmentObservationWindowStable:sprayplan', ops.FAILED)

    def test_private_file_and_manifest_are_real_checks(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = pathlib.Path(temporary); backup = root / 'backup'; backup.mkdir(mode=0o700)
            value = {'sourceCommit': ops.BEFORE, 'deploymentLabel': 'PR925', 'onlineSqliteBackupApi': True,
                     'services': {s: {'runtime': self.old} for s in ops.SERVICES},
                     'configurationFiles': {p: 'f' * 64 for p in ops.CONFIG}}
            content = json.dumps(value).encode()
            (backup / 'baseline.json').write_bytes(content); (backup / 'baseline.json').chmod(0o600)
            (backup / 'env.before').write_bytes(b'private-production-configuration'); (backup / 'env.before').chmod(0o600)
            manifest = {'baseline.json': ops.sha(content), 'env.before': ops.sha((backup / 'env.before').read_bytes())}
            (backup / 'manifest.json').write_text(json.dumps(manifest)); (backup / 'manifest.json').chmod(0o600)
            with patch.object(ops, 'BACKUP', backup), patch.object(ops, 'assert_source'):
                self.assertEqual(value, ops.baseline()[0])
                (backup / 'baseline.json').chmod(0o644)
                with self.assertRaises(RuntimeError):
                    ops.baseline()
                (backup / 'baseline.json').chmod(0o600)
                (backup / 'baseline.json').write_bytes(content + b' ')
                with self.assertRaises(RuntimeError):
                    ops.baseline()

    def test_missing_image_command_error_or_timeout_never_outputs_secret_values(self):
        main = ast.Module(body=[ast.parse(TEXT).body[-1]], type_ignores=[])
        code = compile(main, 'safe-env-drift-main', 'exec')
        failures = [subprocess.TimeoutExpired(['private-argument'], 1, output=b'private-stdout', stderr=b'private-stderr'),
                    RuntimeError('private-authorization-code')]
        for error in failures:
            output = io.StringIO()
            with patch.dict(ops.os.environ, {'SPRAY_STATUS_TARGET': ops.TARGET}), \
                 patch.object(ops, 'diagnose', side_effect=error), \
                 patch.object(ops, '__name__', '__main__'), contextlib.redirect_stdout(output):
                with self.assertRaises(SystemExit):
                    exec(code, ops.__dict__)
            text = output.getvalue()
            self.assertNotIn('private-', text); self.assertNotIn('imageInheritedChangedKeys', text)
            self.assertFalse(json.loads(text)['allPriorEnvironmentHashesReconstructedExact'])
        failure = subprocess.CompletedProcess(['private-argument'], 1, b'private-stdout', b'private-stderr')
        with patch.object(ops.subprocess, 'run', return_value=failure):
            with self.assertRaises(RuntimeError):
                ops.command(['docker', 'image', 'inspect'], 'fixedLabel')
        self.assertEqual('fixedLabel', ops.FAILED)

    def test_json_process_hash_uses_utf8_unescaped_unicode_and_unique_ascii_keys(self):
        import hashlib
        value = {'A': '中文=🙂', 'B': 'line\nquote"'}
        expected = hashlib.sha256(json.dumps(ops.env_rows(value), ensure_ascii=False, separators=(',', ':')).encode()).hexdigest()
        self.assertEqual(expected, ops.env_hash(value, process=True))
        self.assertNotEqual(ops.env_hash(value), ops.env_hash(value, process=True))

    def test_version_fingerprint_exactly_matches_config_and_all_four_process_hashes(self):
        result = self.version_diagnose()
        self.assertEqual(['ASPNET_VERSION', 'DOTNET_VERSION'], result['changedPublicVersionKeys'])
        self.assertEqual(10000, result['candidateCombinationsChecked'])
        self.assertTrue(result['uniqueFullConfigFingerprintMatch'])
        self.assertTrue(result['oldApiCompleteAndWithoutHostnameFingerprintsMatched'])
        self.assertTrue(result['oldWebCompleteAndWithoutHostnameFingerprintsMatched'])
        self.assertFalse(result['legacyImageRead']); self.assertFalse(result['priorImageInheritanceVerified'])
        self.assertFalse(result['priorRuntimeBinaryVersionVerified'])
        for private in ['never-print', '授权码', '/private', '8.0.20', '8.0.21']:
            self.assertNotIn(private, json.dumps(result))

    def test_version_fingerprint_reports_one_changed_key_without_claiming_two(self):
        self.set_prior_versions('8.0.20', '8.0.21')
        self.assertEqual(['DOTNET_VERSION'], self.version_diagnose()['changedPublicVersionKeys'])

    def test_version_fingerprint_does_not_expand_candidate_range(self):
        self.set_prior_versions('8.0.100', '8.0.20')
        with self.assertRaises(RuntimeError):
            self.version_diagnose()
        self.assertEqual('uniqueCompleteConfigVersionFingerprintMatch:sprayplan', ops.FAILED)

    def test_version_fingerprint_unaccounted_config_drift_has_zero_candidates(self):
        self.config['PATH'] = '/new-private-path'
        with self.assertRaises(RuntimeError):
            self.version_diagnose()
        self.assertEqual('uniqueCompleteConfigVersionFingerprintMatch:sprayplan', ops.FAILED)

    def test_version_fingerprint_colliding_candidate_hashes_fail_closed(self):
        with patch.object(ops, 'env_hash', return_value=self.old['configEnvSha256']) as digest:
            with self.assertRaises(RuntimeError):
                ops.version_candidate(self.config, self.old['configEnvSha256'], 'sprayplan')
        self.assertEqual(10000, digest.call_count)
        self.assertEqual('uniqueCompleteConfigVersionFingerprintMatch:sprayplan', ops.FAILED)

    def test_version_fingerprint_secret_process_drift_is_not_reconstructed(self):
        self.processes['web']['JWT_SECRET'] = 'private-unaccounted-authorization-code'
        with self.assertRaises(RuntimeError):
            self.version_diagnose()
        self.assertEqual('oldProcessVersionFingerprintExact:sprayplan:web', ops.FAILED)

    def test_version_fingerprint_requires_image_config_and_process_version_agreement(self):
        for scope in ['image', 'process']:
            with self.subTest(scope=scope):
                old_image, old_processes = copy.deepcopy(self.new_image), copy.deepcopy(self.processes)
                if scope == 'image':
                    self.new_image['DOTNET_VERSION'] = '8.0.22'
                else:
                    self.processes['api']['ASPNET_VERSION'] = '8.0.22'
                with self.assertRaises(RuntimeError):
                    self.version_diagnose()
                self.new_image, self.processes = old_image, old_processes

    def test_version_fingerprint_failure_output_does_not_include_candidates_or_values(self):
        code = compile(ast.Module(body=[ast.parse(TEXT).body[-1]], type_ignores=[]), 'fingerprint-safe-main', 'exec')
        output = io.StringIO()
        with patch.dict(ops.os.environ, {'SPRAY_STATUS_TARGET': ops.TARGET, 'SPRAY_ENV_DIAG_METHOD': 'version-fingerprint'}), \
             patch.object(ops, 'diagnose_version_fingerprint', side_effect=RuntimeError('private-value=8.0.20')), \
             patch.object(ops, '__name__', '__main__'), contextlib.redirect_stdout(output):
            with self.assertRaises(SystemExit):
                exec(code, ops.__dict__)
        body = output.getvalue()
        self.assertNotIn('private-value', body); self.assertNotIn('8.0.20', body)
        self.assertNotIn('changedPublicVersionKeys', body)
        self.assertEqual('environment-version-fingerprint-925', json.loads(body)['mode'])

    def test_diagnostic_has_no_writes_or_mutating_docker_commands(self):
        for node in ast.walk(ast.parse(TEXT)):
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute):
                self.assertNotIn(node.func.attr, ['write_text', 'write_bytes', 'mkdir', 'unlink', 'chmod', 'remove', 'system', 'kill'])
                if node.func.attr == 'run':
                    self.assertFalse(any(k.arg == 'shell' and getattr(k.value, 'value', None) for k in node.keywords))
        for command in ['git fetch', 'git show', 'git checkout', 'docker restart', 'docker compose', 'buildx', 'sqlite3', 'SELECT ', 'docker run']:
            self.assertNotIn(command, TEXT)

    def test_workflow_embeds_exact_reviewed_helper_only_for_explicit_env_mode(self):
        workflow = PATH.parents[2] / '.github/workflows/sprayplan-runtime-inspect.yml'
        body = workflow.read_text().split('      - name: Diagnose exact previous environment hashes', 1)[1]
        embedded = textwrap.dedent(body.split("            python3 - <<'PY'\n", 1)[1].split('            PY\n', 1)[0])
        self.assertEqual(TEXT, embedded)
        self.assertIn("inputs.observation_mode == 'env-drift' || inputs.observation_mode == 'env-fingerprint'", body)
        self.assertIn('envs: SPRAY_STATUS_TARGET,SPRAY_ENV_DIAG_METHOD', body)
        self.assertIn('default: live-status', workflow.read_text())
        self.assertIn('group: sprayplan-deployment-status-925', workflow.read_text())
        self.assertIn('appleboy/ssh-action@0ff4204d59e8e51228ff73bce53f80d53301dee2', body)
        self.assertIn('fingerprint: ${{ env.CLOUD_HOST_FINGERPRINT }}', body)


if __name__ == '__main__':
    unittest.main()
