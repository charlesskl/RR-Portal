import os

os.environ.setdefault("SECRET_KEY", "qc-test-secret")
os.environ.setdefault("ADMIN_PASSWORD", "Admin@12345")
os.environ.setdefault("QC_PASSWORD", "QC@12345")
import os
import re
import shutil
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from sqlalchemy import func, select

from app import PurchaseOrder, create_app


class PortalIntegrationTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        root = Path(self.temp.name)
        self.app = create_app({
            "TESTING": True,
            "SECRET_KEY": "portal-test-secret",
            "DATABASE_URL": f"sqlite:///{(root / 'portal.db').as_posix()}",
            "STORAGE_ROOT": str(root / "storage"),
            "PROXY_PREFIX": "/qc-report",
            "SESSION_COOKIE_PATH": "/qc-report/",
        })
        self.client = self.app.test_client()

    def tearDown(self):
        self.app.extensions["db_session"].remove()
        self.app.extensions["db_engine"].dispose()
        self.temp.cleanup()

    def test_trusted_proxy_prefix_is_included_in_redirects(self):
        response = self.client.get("/", headers={"X-Forwarded-Prefix": "/qc-report"})

        self.assertEqual(response.status_code, 302)
        self.assertIn("/qc-report/login", response.headers["Location"])

    def test_unexpected_proxy_prefix_is_ignored(self):
        response = self.client.get("/", headers={"X-Forwarded-Prefix": "/attacker"})

        self.assertEqual(response.status_code, 302)
        self.assertNotIn("/attacker", response.headers["Location"])
        self.assertIn("/login", response.headers["Location"])

    def test_session_cookie_is_scoped_to_portal_path(self):
        response = self.client.get("/login")

        self.assertIn("Path=/qc-report/", response.headers["Set-Cookie"])

    def test_inspection_upload_forms_keep_portal_prefix(self):
        headers = {"X-Forwarded-Prefix": "/qc-report"}
        self.app.config["SESSION_COOKIE_PATH"] = "/"
        self.client.get("/login", headers=headers)
        with self.client.session_transaction() as session_data:
            csrf_token = session_data["csrf_token"]
        self.client.post(
            "/login",
            data={"username": "qc", "password": "QC@12345", "csrf_token": csrf_token},
            headers=headers,
        )
        with self.client.session_transaction() as session_data:
            csrf_token = session_data["csrf_token"]
        database = self.app.extensions["db_session"]()
        po_id = database.scalar(select(PurchaseOrder.id).limit(1))
        database.close()
        response = self.client.post(
            "/reports/new",
            data={"po_id": po_id, "csrf_token": csrf_token},
            headers=headers,
        )
        report_id = re.search(r"/reports/(\d+)", response.headers["Location"]).group(1)

        page = self.client.get(f"/reports/{report_id}/inspection", headers=headers)

        self.assertEqual(page.status_code, 200)
        self.assertIn(f'action="/qc-report/reports/{report_id}/photo-slots/', page.get_data(as_text=True))

    def test_health_checks_database_and_storage(self):
        response = self.client.get("/health")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()["status"], "ok")

    def test_sqlite_uses_wal_foreign_keys_and_busy_timeout(self):
        with self.app.extensions["db_engine"].connect() as connection:
            journal_mode = connection.exec_driver_sql("PRAGMA journal_mode").scalar_one()
            foreign_keys = connection.exec_driver_sql("PRAGMA foreign_keys").scalar_one()
            busy_timeout = connection.exec_driver_sql("PRAGMA busy_timeout").scalar_one()

        self.assertEqual(journal_mode.lower(), "wal")
        self.assertEqual(foreign_keys, 1)
        self.assertGreaterEqual(busy_timeout, 30_000)

    def test_health_fails_when_storage_directory_is_unusable(self):
        storage = Path(self.app.config["STORAGE_ROOT"])
        shutil.rmtree(storage)
        storage.write_text("not a directory", encoding="utf-8")

        response = self.client.get("/health")

        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.get_json()["status"], "unhealthy")

    def test_health_fails_when_required_queue_is_not_configured(self):
        with patch.dict(os.environ, {"QUEUE_REQUIRED": "true"}, clear=False):
            os.environ.pop("REDIS_URL", None)
            response = self.client.get("/health")

        self.assertEqual(response.status_code, 503)
        self.assertFalse(response.get_json()["checks"]["queue"])

    def test_production_seed_does_not_create_sample_purchase_order(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            application = create_app({
                "TESTING": False,
                "SECRET_KEY": "production-seed-test",
                "DATABASE_URL": f"sqlite:///{(root / 'production.db').as_posix()}",
                "STORAGE_ROOT": str(root / "storage"),
                "SEED_SAMPLE_DATA": False,
            })
            database = application.extensions["db_session"]()
            purchase_order_count = database.scalar(select(func.count()).select_from(PurchaseOrder))
            database.close()
            application.extensions["db_session"].remove()
            application.extensions["db_engine"].dispose()

        self.assertEqual(purchase_order_count, 0)


if __name__ == "__main__":
    unittest.main()
