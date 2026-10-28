"""Run the workflow's actual optional secret guard with private local fixtures."""
import os
from pathlib import Path
import subprocess
import tempfile
import textwrap
import unittest

ROOT = Path(__file__).resolve().parents[2]
WORKFLOW = (ROOT / '.github/workflows/deploy.yml').read_text()
START = WORKFLOW.index('            sync_qc_plan_secret() {\n')
END = WORKFLOW.index('\n            sync_qc_plan_secret QC_PLAN_JWT_KEY', START)
FUNCTION = textwrap.dedent(WORKFLOW[START:END])
START = WORKFLOW.index('            if [ -n "${PAIJI_ERP_RECEIPT_RETURN_TOKEN:-}" ]; then')
END = WORKFLOW.index('\n', WORKFLOW.index('            sync_qc_plan_secret PAIJI_ERP_RECEIPT_RETURN_TOKEN', START))
GUARD = textwrap.dedent(WORKFLOW[START:END])
TOKEN = 'a1' * 32
OLD_TOKEN = 'b2' * 32
KEY = 'PAIJI_ERP_RECEIPT_RETURN_TOKEN'


class PaijiReturnSecretGuardTests(unittest.TestCase):
    def run_guard(self, value, initial):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp)
            env_file = path / '.env.cloud.production'
            env_file.write_text(initial)
            env_file.chmod(0o600)
            # Model only GNU sed -i used on the Linux deployment host.
            sed = path / 'sed'
            sed.write_text('''#!/usr/bin/env python3
import pathlib, re, sys
assert sys.argv[1] == '-i' and len(sys.argv) == 4
expression, filename = sys.argv[2:]
assert expression.startswith('s|^PAIJI_ERP_RECEIPT_RETURN_TOKEN=.*|PAIJI_ERP_RECEIPT_RETURN_TOKEN=') and expression.endswith('|')
replacement = expression.split('|')[2]
p=pathlib.Path(filename)
p.write_text(re.sub(r'^PAIJI_ERP_RECEIPT_RETURN_TOKEN=.*$', replacement, p.read_text(), flags=re.M))
''')
            sed.chmod(0o755)
            env = {**os.environ, KEY: value, 'PATH': str(path) + os.pathsep + os.environ.get('PATH', '')}
            result = subprocess.run(['bash', '-c', 'set -euo pipefail\n' + FUNCTION + '\n' + GUARD],
                                    cwd=path, env=env, capture_output=True, text=True)
            content = env_file.read_text()
            self.assertNotIn(TOKEN, result.stdout + result.stderr)
            self.assertNotIn(OLD_TOKEN, result.stdout + result.stderr)
            return result, content

    def test_empty_secret_preserves_all_existing_values(self):
        initial = f'OTHER=value\n{KEY}={OLD_TOKEN}\n'
        result, content = self.run_guard('', initial)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(content, initial)

    def test_new_secret_adds_only_its_own_key(self):
        result, content = self.run_guard(TOKEN, 'OTHER=value\n')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(content, f'OTHER=value\n{KEY}={TOKEN}\n')

    def test_changed_secret_preserves_unrelated_environment(self):
        result, content = self.run_guard(TOKEN, f'OTHER=value\n{KEY}={OLD_TOKEN}\nLAST=unchanged\n')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(content, f'OTHER=value\n{KEY}={TOKEN}\nLAST=unchanged\n')

    def test_same_secret_is_idempotent(self):
        initial = f'OTHER=value\n{KEY}={TOKEN}\n'
        result, content = self.run_guard(TOKEN, initial)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(content, initial)

    def test_invalid_or_multiline_values_fail_before_writing(self):
        initial = f'OTHER=value\n{KEY}={OLD_TOKEN}\n'
        for value in ['x', 'a' * 63, 'a' * 65, 'a' * 64 + '\nEXTRA=bad', 'x|' * 32]:
            with self.subTest(length=len(value)):
                result, content = self.run_guard(value, initial)
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(content, initial)

    def test_prepare_mode_backs_up_before_key_and_exits_before_seed(self):
        workflow = (ROOT / '.github/workflows/paiji-data-ops.yml').read_text()
        start = workflow.index('            if [ "$MODE" = "backup-only" ]')
        end = workflow.index('            if [ "$MODE" = "apply-outsource-seed" ]; then', start)
        block = workflow[start:end]
        self.assertLess(block.index('online_backup'), block.index('sed -i'))
        self.assertIn('exit 0', block)
        self.assertNotIn(' up ', block)
        self.assertNotIn('restart', block)


if __name__ == '__main__':
    unittest.main()
