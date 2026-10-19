import importlib.util
import pathlib
import tempfile
import unittest

SOURCE=pathlib.Path(__file__).resolve().parents[1]/'printlink-runtime-memory-relief.py'
spec=importlib.util.spec_from_file_location('relief',SOURCE)
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)


class RuntimeReliefTests(unittest.TestCase):
    def fixture(self):
        return {'id':m.EXPECTED_CID,'status':'running','memoryLimit':m.OLD,'memorySwapLimit':m.OLD}

    def test_only_exact_current_limits_and_container_can_be_changed(self):
        self.assertEqual(m.decision(self.fixture(),3*1024**3),'increase-existing-container-limit')
        for field,value in [('id','wrong'),('status','exited'),('memoryLimit',1024),('memorySwapLimit',-1)]:
            with self.subTest(field=field),self.assertRaises(RuntimeError):m.decision({**self.fixture(),field:value},3*1024**3)
        with self.assertRaises(RuntimeError):m.decision(self.fixture(),1024**3)

    def test_already_at_target_only_observes(self):
        self.assertEqual(m.decision({**self.fixture(),'memoryLimit':m.NEW,'memorySwapLimit':m.NEW},3*1024**3),'already-at-target-observe-only')

    def test_complete_file_presence_guard_rejects_missing_db_and_symlink(self):
        with tempfile.TemporaryDirectory()as d:
            p=pathlib.Path(d);(p/'orders').mkdir();(p/'orders/printlink.sqlite').touch();(p/'production.sqlite').touch()
            self.assertEqual(m.files(p),{'orders/printlink.sqlite','production.sqlite'})
            (p/'symlink').symlink_to(p/'production.sqlite')
            with self.assertRaises(RuntimeError):m.files(p)
            (p/'symlink').unlink();(p/'production.sqlite').unlink()
            with self.assertRaises(RuntimeError):m.files(p)

    def test_only_mutation_is_the_fixed_resource_update(self):
        s=SOURCE.read_text()
        self.assertEqual(s.count("'docker','update'"),1)
        for value in ['docker restart','docker compose','write_text','write_bytes','unlink(','INSERT INTO','UPDATE ','DELETE ']:
            self.assertNotIn(value,s)


if __name__=='__main__':unittest.main()
