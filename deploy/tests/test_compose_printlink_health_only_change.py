import importlib.util
import pathlib
import re
import unittest

ROOT=pathlib.Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('printlink_compose',ROOT/'deploy/compose-mailbox-only-change.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
BEFORE=(b'services:\n  printlink:\n    image: fixture-printlink\n'
        b'    environment:\n      ADMIN_PASSWORD: ${PRINTLINK_ADMIN_PASSWORD:?required}\n'
        +m.PRINTLINK_HEALTH_BLOCK_BEFORE+m.PRINTLINK_MEMORY_BEFORE+
        b'    volumes:\n      - same-data:/app/runtime\n'
        b'  voyageplex-api:\n    image: fixture-mail\n    mem_limit: 512m\n'
        b'networks:\n  platform-net:\n')
AFTER=BEFORE.replace(m.PRINTLINK_HEALTH_BLOCK_BEFORE,m.PRINTLINK_HEALTH_BLOCK_AFTER).replace(m.PRINTLINK_MEMORY_BEFORE,m.PRINTLINK_MEMORY_AFTER)


class PrintLinkComposeGuardTests(unittest.TestCase):
    def test_exact_pair_updates_only_printlink(self):
        self.assertTrue(m.is_printlink_health_only_change(BEFORE,AFTER))
        self.assertEqual(m.incremental_service(BEFORE,AFTER),'printlink')
        self.assertFalse(m.is_mailbox_only_addition(BEFORE,AFTER))

    def test_actual_compose_only_changes_this_reviewed_pair(self):
        after=(ROOT/'docker-compose.cloud.yml').read_bytes()
        block=re.search(rb'(?ms)^  printlink:\n.*?(?=^  [A-Za-z0-9_-]+:|^networks:)',after).group()
        self.assertEqual(block.count(m.PRINTLINK_HEALTH_BLOCK_AFTER),1)
        self.assertEqual(block.count(m.PRINTLINK_MEMORY_AFTER),1)
        original=block.replace(m.PRINTLINK_HEALTH_BLOCK_AFTER,m.PRINTLINK_HEALTH_BLOCK_BEFORE,1).replace(m.PRINTLINK_MEMORY_AFTER,m.PRINTLINK_MEMORY_BEFORE,1)
        before=after.replace(block,original,1)
        self.assertTrue(m.is_printlink_health_only_change(before,after))

    def test_partial_health_or_memory_changes_fall_back(self):
        for after in [BEFORE.replace(m.PRINTLINK_HEALTH_BLOCK_BEFORE,m.PRINTLINK_HEALTH_BLOCK_AFTER),
                      BEFORE.replace(m.PRINTLINK_MEMORY_BEFORE,m.PRINTLINK_MEMORY_AFTER),
                      AFTER.replace(b'    memswap_limit: 768m\n',b'    memswap_limit: 1g\n'),
                      AFTER.replace(b'      timeout: 5s\n',b'      timeout: 6s\n'),
                      AFTER.replace(b'ops/healthcheck.mjs',b'ops/different.mjs')]:
            with self.subTest(after=after):self.assertFalse(m.is_printlink_health_only_change(BEFORE,after))

    def test_any_other_service_secret_volume_or_network_change_falls_back(self):
        for before,after in [(b'fixture-mail',b'changed-mail'),(b'fixture-printlink',b'changed-printlink'),
            (b'${PRINTLINK_ADMIN_PASSWORD:?required}',b'literal-secret'),
            (b'same-data:/app/runtime',b'empty-data:/app/runtime'),(b'platform-net:',b'another-net:')]:
            with self.subTest(value=before):self.assertFalse(m.is_printlink_health_only_change(BEFORE,AFTER.replace(before,after)))

    def test_duplicate_or_quoted_service_and_duplicate_fields_fall_back(self):
        pairs=[(BEFORE+b'services:\n  printlink:\n',AFTER+b'services:\n  printlink:\n'),
            (BEFORE.replace(b'  printlink:\n',b'  "printlink":\n'),AFTER.replace(b'  printlink:\n',b'  "printlink":\n')),
            (BEFORE.replace(b'  printlink:\n',b'  printlink: &alias\n'),AFTER.replace(b'  printlink:\n',b'  printlink: &alias\n')),
            (BEFORE.replace(m.PRINTLINK_MEMORY_BEFORE,m.PRINTLINK_MEMORY_BEFORE+b'    mem_limit: 512m\n'),
             AFTER.replace(m.PRINTLINK_MEMORY_AFTER,m.PRINTLINK_MEMORY_AFTER+b'    mem_limit: 512m\n')),
            (BEFORE.replace(b'  voyageplex-api:\n',b'  printlink:\n'),AFTER.replace(b'  voyageplex-api:\n',b'  printlink:\n'))]
        for before,after in pairs:
            with self.subTest(before=before):self.assertFalse(m.is_printlink_health_only_change(before,after))

    def test_fake_health_test_inside_another_field_is_rejected(self):
        before=BEFORE.replace(m.PRINTLINK_HEALTH_BLOCK_BEFORE,
            b'    healthcheck:\n      test: ["CMD", "other"]\n    explanation: |\n'+m.PRINTLINK_HEALTH_BEFORE)
        after=before.replace(m.PRINTLINK_HEALTH_BEFORE,m.PRINTLINK_HEALTH_AFTER).replace(m.PRINTLINK_MEMORY_BEFORE,m.PRINTLINK_MEMORY_AFTER)
        self.assertFalse(m.is_printlink_health_only_change(before,after))

    def test_wrong_service_and_line_endings_are_rejected(self):
        self.assertFalse(m.is_printlink_health_only_change(BEFORE.replace(b'printlink:',b'another:'),AFTER.replace(b'printlink:',b'another:')))
        self.assertFalse(m.is_printlink_health_only_change(BEFORE,AFTER.replace(b'\n',b'\r\n')))


if __name__=='__main__':unittest.main()
