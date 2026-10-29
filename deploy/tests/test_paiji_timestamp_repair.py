"""Run the real SQLite one-off repair contract without network or live data."""
import os
from pathlib import Path
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[2]

class PaijiTimestampRepairTests(unittest.TestCase):
    def test_real_sqlite_contract(self):
        env = dict(os.environ)
        env.setdefault('NODE_PATH', str(ROOT / 'apps/生产部/注塑啤机排产系统/server/node_modules'))
        result = subprocess.run(['node', '--test', str(ROOT / 'deploy/tests/paiji-timestamp-repair.test.cjs')], cwd=ROOT, env=env, text=True, capture_output=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

if __name__ == '__main__':
    unittest.main()
