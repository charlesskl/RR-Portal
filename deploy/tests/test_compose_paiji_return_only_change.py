"""Only the new Paiji integration secret reference permits a Paiji-only rollout."""
import importlib.util
from pathlib import Path
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('paiji_compose_guard', ROOT / 'deploy/compose-mailbox-only-change.py')
guard = importlib.util.module_from_spec(spec)
spec.loader.exec_module(guard)
BEFORE = (b'services:\n  other:\n    image: fixture\n  paiji:\n    environment:\n'
          b'      - PORT=3000\n      - DATA_PATH=/app/data\n    volumes:\n      - fixture:/app/data\n')
AFTER = BEFORE.replace(b'      - PORT=3000\n', b'      - PORT=3000\n' + guard.PAIJI_RETURN_LINE)


class PaijiComposeOnlyTests(unittest.TestCase):
    def test_exact_reference_selects_only_paiji(self):
        self.assertEqual(guard.incremental_service(BEFORE, AFTER), 'paiji')

    def test_actual_compose_is_supported(self):
        # Ops ships before the feature's Compose line. Exercise both the checked
        # out file and committed blob; neither requires deploying the feature.
        blobs = [(ROOT / 'docker-compose.cloud.yml').read_bytes(),
                 subprocess.check_output(['git', 'show', 'HEAD:docker-compose.cloud.yml'], cwd=ROOT)]
        for blob in blobs:
            before = blob.replace(guard.PAIJI_RETURN_LINE, b'', 1)
            block = guard._plain_service_block(before, b'paiji')
            self.assertIsNotNone(block)
            changed = block[2].replace(b'    environment:\n', b'    environment:\n' + guard.PAIJI_RETURN_LINE, 1)
            after = before[:block[0]] + changed + before[block[1]:]
            self.assertEqual(guard.incremental_service(before, after), 'paiji')

    def test_noop_reverse_literal_secret_and_extra_change_fail_closed(self):
        for before, after in [(BEFORE, BEFORE), (AFTER, AFTER), (AFTER, BEFORE),
                              (BEFORE, AFTER.replace(b'${PAIJI_ERP_RECEIPT_RETURN_TOKEN:-}', b'fixture-secret')),
                              (BEFORE, AFTER.replace(b'image: fixture', b'image: changed')),
                              (BEFORE, AFTER + b'# unrelated\n'),
                              (BEFORE, AFTER.replace(b'\n', b'\r\n'))]:
            with self.subTest(after=after):
                self.assertIsNone(guard.incremental_service(before, after))

    def test_wrong_section_service_and_duplicate_environment_are_rejected(self):
        for before in [BEFORE.replace(b'  paiji:', b'  other-paiji:'),
                       BEFORE.replace(b'    environment:', b'    command:'),
                       BEFORE.replace(b'  paiji:', b'  "paiji":'),
                       BEFORE.replace(b'    volumes:', b'    environment:\n      - EXTRA=x\n    volumes:'),
                       BEFORE.replace(b'      - DATA_PATH=/app/data', b'      - PORT=other'),
                       BEFORE.replace(b'      - PORT=3000', b'      - NOTE="unterminated')]:
            after = before.replace(b'      - PORT=3000\n', b'      - PORT=3000\n' + guard.PAIJI_RETURN_LINE)
            self.assertIsNone(guard.incremental_service(before, after))

    def test_existing_key_and_duplicate_addition_are_rejected(self):
        self.assertIsNone(guard.incremental_service(BEFORE, AFTER.replace(guard.PAIJI_RETURN_LINE, guard.PAIJI_RETURN_LINE * 2)))
        before = BEFORE.replace(b'      - PORT=3000', b'      - ERP_RECEIPT_RETURN_TOKEN=fixture\n      - PORT=3000')
        after = before.replace(b'      - PORT=3000\n', b'      - PORT=3000\n' + guard.PAIJI_RETURN_LINE)
        self.assertIsNone(guard.incremental_service(before, after))


if __name__ == '__main__':
    unittest.main()
