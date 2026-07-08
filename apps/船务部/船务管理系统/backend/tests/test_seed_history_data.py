import sqlite3
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from apps.accounts.history_seed import seed_history_database


def _create_db(path, rows=0):
    con = sqlite3.connect(path)
    con.execute("create table shipments_shipment (id integer primary key)")
    con.execute("create table emails_emailrecord (id integer primary key)")
    con.execute("create table master_data_productmapping (id integer primary key)")
    if rows:
        con.executemany(
            "insert into shipments_shipment (id) values (?)",
            [(i + 1,) for i in range(rows)],
        )
    con.commit()
    con.close()


class SeedHistoryDatabaseTest(unittest.TestCase):
    def test_imports_when_business_tables_are_empty(self):
        with TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            db_path = tmp_path / "shipping.db"
            seed_db = tmp_path / "history.sqlite3"
            marker = tmp_path / ".history_seeded"
            media_root = tmp_path / "media"

            _create_db(db_path, rows=0)
            _create_db(seed_db, rows=2)

            result = seed_history_database(
                seed_db=seed_db,
                db_path=db_path,
                marker_path=marker,
                media_root=media_root,
            )

            self.assertEqual(result, "imported")
            self.assertTrue(marker.exists())
            self.assertTrue((tmp_path / "shipping.db.pre-history-seed").exists())
            con = sqlite3.connect(db_path)
            self.assertEqual(
                con.execute("select count(*) from shipments_shipment").fetchone()[0],
                2,
            )
            con.close()

    def test_skips_when_business_tables_have_rows(self):
        with TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            db_path = tmp_path / "shipping.db"
            seed_db = tmp_path / "history.sqlite3"
            marker = tmp_path / ".history_seeded"

            _create_db(db_path, rows=1)
            _create_db(seed_db, rows=2)

            result = seed_history_database(
                seed_db=seed_db,
                db_path=db_path,
                marker_path=marker,
                media_root=tmp_path / "media",
            )

            self.assertEqual(result, "non_empty")
            self.assertFalse(marker.exists())
            con = sqlite3.connect(db_path)
            self.assertEqual(
                con.execute("select count(*) from shipments_shipment").fetchone()[0],
                1,
            )
            con.close()
