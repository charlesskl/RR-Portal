import os

os.environ.setdefault("SECRET_KEY", "qc-test-secret")
os.environ.setdefault("ADMIN_PASSWORD", "Admin@12345")
os.environ.setdefault("QC_PASSWORD", "QC@12345")
import base64
import io
import tempfile
import unittest
from pathlib import Path

from PIL import Image
from sqlalchemy import inspect, select

from app import (
    AQLRule,
    AuditLog,
    DefectCategory,
    Defect,
    Photo,
    PurchaseOrder,
    Report,
    ReportVersion,
    Setting,
    TestTemplate,
    User,
    create_app,
    file_sha256,
    refresh_result,
)


def image_bytes(color=(34, 102, 210), size=(640, 480)):
    image = Image.new("RGB", size, color)
    exif = Image.Exif()
    exif[274] = 6
    stream = io.BytesIO()
    image.save(stream, "JPEG", quality=90, exif=exif)
    stream.seek(0)
    return stream


def signature_data_url():
    image = Image.new("RGBA", (420, 140), (255, 255, 255, 0))
    for x in range(40, 360):
        y = 70 + int(20 * ((x % 80) / 80))
        for offset in range(-2, 3):
            image.putpixel((x, max(0, min(139, y + offset))), (23, 50, 77, 255))
    stream = io.BytesIO()
    image.save(stream, "PNG")
    return "data:image/png;base64," + base64.b64encode(stream.getvalue()).decode()


class QCSystemTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        root = Path(self.temp.name)
        self.app = create_app({
            "TESTING": True,
            "SECRET_KEY": "test-secret",
            "DATABASE_URL": f"sqlite:///{(root / 'test.db').as_posix()}",
            "STORAGE_ROOT": str(root / "storage"),
        })
        self.client = self.app.test_client()

    def tearDown(self):
        self.app.extensions["db_session"].remove()
        self.app.extensions["db_engine"].dispose()
        self.temp.cleanup()

    def csrf(self):
        with self.client.session_transaction() as sess:
            return sess["csrf_token"]

    def login(self, username="qc", password="QC@12345"):
        self.client.get("/login")
        response = self.client.post("/login", data={"username": username, "password": password, "csrf_token": self.csrf()})
        self.assertEqual(response.status_code, 302)

    def test_schema_and_seed_can_be_delegated_to_docker_init_services(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            app = create_app({
                "TESTING": True,
                "SECRET_KEY": "no-init",
                "DATABASE_URL": f"sqlite:///{(root / 'empty.db').as_posix()}",
                "STORAGE_ROOT": str(root / "storage"),
                "AUTO_CREATE_SCHEMA": False,
                "SEED_DATABASE": False,
            })
            self.assertEqual(inspect(app.extensions["db_engine"]).get_table_names(), [])
            app.extensions["db_session"].remove()
            app.extensions["db_engine"].dispose()

    def create_report(self):
        self.login()
        db = self.app.extensions["db_session"]()
        po = db.scalar(select(PurchaseOrder).where(PurchaseOrder.po_no == "PO-26032401"))
        po_id = po.id
        db.close()
        response = self.client.post("/reports/new", data={"po_id": po_id, "csrf_token": self.csrf()})
        self.assertEqual(response.status_code, 302)
        return int(response.headers["Location"].split("/")[2])

    def save_sample(self, report_id, defect_qty=1, defect_severity="minor", manual_hold=False, skip_test_names=None):
        db = self.app.extensions["db_session"]()
        report = db.get(Report, report_id)
        tests = list(db.scalars(select(__import__("app").TestResult).where(__import__("app").TestResult.report_id == report_id)).all())
        db.close()
        data = {
            "csrf_token": self.csrf(),
            "inspection_date": "2026-06-09",
            "inspection_status": "Final 1st",
            "inspection_level": "II",
            "completed_pct": "100",
            "inspected_qty": "125",
            "critical_aql": "0",
            "major_aql": "1.0",
            "minor_aql": "4.0",
            "master_carton_dimension": "44.50 x 28.00 x 29.00 cm",
            "master_carton_nw": "3.93",
            "master_carton_gw": "4.35",
            "outer_carton_barcode": "8431524502305/(01)18431524502302",
            "remarks": "",
            "defect_severity_1": defect_severity,
            "defect_quantity_1": str(defect_qty),
            "defect_description_1": "DIRTY MARK" if defect_qty else "",
            "hold_reason": "Waiting for customer confirmation" if manual_hold else "",
        }
        if manual_hold:
            data["manual_hold"] = "on"
        for test in tests:
            if test.name not in (skip_test_names or set()):
                data[f"test_result_{test.id}"] = "PASS"
        response = self.client.post(f"/reports/{report_id}/edit", data=data)
        self.assertEqual(response.status_code, 302)

    def upload_required_photos(self, report_id, count_each=1):
        for index, category in enumerate(("product", "packaging", "warehouse")):
            files = [(image_bytes((40 + index * 50, 100, 180)), f"{category}-{n}.jpg") for n in range(count_each)]
            response = self.client.post(
                f"/reports/{report_id}/photos",
                data={"csrf_token": self.csrf(), "category": category, "caption": category.title(), "photos": files},
                content_type="multipart/form-data",
            )
            self.assertEqual(response.status_code, 302)

    def sign(self, report_id):
        response = self.client.post(
            f"/reports/{report_id}/signature",
            data={"csrf_token": self.csrf(), "signature_mode": "draw", "signature_data": signature_data_url(), "save_to_profile": "on"},
        )
        self.assertEqual(response.status_code, 302)

    def test_login_and_role_permissions(self):
        self.login()
        home = self.client.get("/")
        self.assertEqual(home.status_code, 302)
        self.assertTrue(home.headers["Location"].endswith("/reports/new"))
        self.assertEqual(self.client.get("/admin").status_code, 403)
        db = self.app.extensions["db_session"]()
        qc_user = db.scalar(select(User).where(User.username == "qc"))
        self.assertNotEqual(qc_user.password_hash, "QC@12345")
        self.assertNotIn("QC@12345", qc_user.password_hash)
        db.close()
        self.client.post("/logout", data={"csrf_token": self.csrf()})
        self.login("admin", "Admin@12345")
        response = self.client.get("/admin")
        self.assertEqual(response.status_code, 200)
        self.assertIn("公司授权 AQL 表".encode(), response.data)

    def test_aql_pass_hold_reject_and_critical(self):
        report_id = self.create_report()
        self.save_sample(report_id)
        db = self.app.extensions["db_session"]()
        report = db.get(Report, report_id)
        self.assertEqual(report.result, "ON HOLD")
        self.assertIn("photo:", report.result_reason)
        db.close()

        self.upload_required_photos(report_id)
        db = self.app.extensions["db_session"]()
        report = db.get(Report, report_id)
        self.assertEqual(report.sample_size, 125)
        self.assertEqual(report.minor_count, 1)
        self.assertEqual(report.result, "PASS")
        db.close()

        self.save_sample(report_id, defect_qty=11)
        db = self.app.extensions["db_session"]()
        self.assertEqual(db.get(Report, report_id).result, "REJECT")
        db.close()

        self.save_sample(report_id, defect_qty=1, defect_severity="critical")
        db = self.app.extensions["db_session"]()
        self.assertEqual(db.get(Report, report_id).result, "REJECT")
        db.close()

        self.save_sample(report_id, defect_qty=1, defect_severity="minor", manual_hold=True)
        db = self.app.extensions["db_session"]()
        self.assertEqual(db.get(Report, report_id).result, "ON HOLD")
        db.close()

    def test_aql_api_and_csrf(self):
        self.login()
        payload = {"lot_quantity": 2004, "inspection_level": "II", "critical_aql": 0, "major_aql": 1.0, "minor_aql": 4.0}
        rejected = self.client.post("/api/aql/calculate", json=payload)
        self.assertEqual(rejected.status_code, 400)
        response = self.client.post("/api/aql/calculate", json=payload, headers={"X-CSRF-Token": self.csrf()})
        self.assertEqual(response.status_code, 200)
        body = response.get_json()
        self.assertEqual(body["sample_size"], 125)
        self.assertEqual(body["rules"]["major"]["accept"], 3)
        self.assertEqual(body["rules"]["minor"]["reject"], 11)

    def test_required_performance_result_causes_hold(self):
        db = self.app.extensions["db_session"]()
        db.add(TestTemplate(name="Mandatory Test", standard="PASS", required=True, active=True, sort_order=99))
        db.commit()
        db.close()
        report_id = self.create_report()
        self.save_sample(report_id, skip_test_names={"Mandatory Test"})
        self.upload_required_photos(report_id)
        db = self.app.extensions["db_session"]()
        report = db.get(Report, report_id)
        self.assertEqual(report.result, "ON HOLD")
        self.assertIn("test:Mandatory Test", report.result_reason)
        db.close()
        self.save_sample(report_id)
        db = self.app.extensions["db_session"]()
        self.assertEqual(db.get(Report, report_id).result, "PASS")
        db.close()

    def test_master_data_crud_apis(self):
        self.login("admin", "Admin@12345")
        headers = {"X-CSRF-Token": self.csrf()}
        customer = self.client.post("/api/customers", json={"name": "API Customer", "country": "CN"}, headers=headers)
        self.assertEqual(customer.status_code, 201)
        customer_id = customer.get_json()["id"]
        product = self.client.post("/api/products", json={"item_no": "API-001", "description": "API Product"}, headers=headers)
        self.assertEqual(product.status_code, 201)
        product_id = product.get_json()["id"]
        order = self.client.post("/api/orders", json={"po_no": "API-PO-001", "customer_id": customer_id, "product_id": product_id, "quantity": 120}, headers=headers)
        self.assertEqual(order.status_code, 201)
        order_id = order.get_json()["id"]
        updated = self.client.patch(f"/api/orders/{order_id}", json={"quantity": 240, "date_code": "API2601"}, headers=headers)
        self.assertEqual(updated.status_code, 200)
        self.assertEqual(updated.get_json()["quantity"], 240)
        settings = self.client.patch("/api/settings", json={"report_title": "QC REPORT"}, headers=headers)
        self.assertEqual(settings.status_code, 200)
        self.assertEqual(settings.get_json()["report_title"], "QC REPORT")
        template = self.client.post("/api/test-templates", json={"name": "API Test", "standard": "PASS", "required": True, "sort_order": 99}, headers=headers)
        self.assertEqual(template.status_code, 201)
        template_id = template.get_json()["id"]
        updated_template = self.client.patch(f"/api/test-templates/{template_id}", json={"active": False}, headers=headers)
        self.assertEqual(updated_template.status_code, 200)
        self.assertFalse(updated_template.get_json()["active"])
        self.assertEqual(self.client.delete(f"/api/test-templates/{template_id}", headers=headers).status_code, 204)
        category = self.client.post("/api/defect-categories", json={"name": "API SCRATCH", "default_severity": "major", "sort_order": 88}, headers=headers)
        self.assertEqual(category.status_code, 201)
        category_id = category.get_json()["id"]
        category_update = self.client.patch(f"/api/defect-categories/{category_id}", json={"default_severity": "minor"}, headers=headers)
        self.assertEqual(category_update.get_json()["default_severity"], "minor")
        self.assertEqual(self.client.delete(f"/api/defect-categories/{category_id}", headers=headers).status_code, 204)
        aql_rule = self.client.post("/api/aql-rules", json={"lot_min": 1, "lot_max": 10, "sample_size": 2, "severity": "minor", "aql": 1.5, "accept": 0, "reject": 1}, headers=headers)
        self.assertEqual(aql_rule.status_code, 201)
        aql_rule_id = aql_rule.get_json()["id"]
        aql_update = self.client.patch(f"/api/aql-rules/{aql_rule_id}", json={"active": False}, headers=headers)
        self.assertFalse(aql_update.get_json()["active"])
        self.assertEqual(self.client.delete(f"/api/aql-rules/{aql_rule_id}", headers=headers).status_code, 204)
        logo_response = self.client.post("/admin", data={
            "csrf_token": self.csrf(), "action": "settings", "company_name": "QC Factory", "report_title": "QC REPORT",
            "required_photo_categories": "product,packaging,warehouse", "logo": (image_bytes(), "logo.png"),
        }, content_type="multipart/form-data")
        self.assertEqual(logo_response.status_code, 302)
        db = self.app.extensions["db_session"]()
        self.assertTrue(Path(db.get(Setting, "logo_path").value).is_file())
        db.close()
        self.assertEqual(self.client.delete(f"/api/orders/{order_id}", headers=headers).status_code, 204)
        self.assertEqual(self.client.delete(f"/api/products/{product_id}", headers=headers).status_code, 204)
        self.assertEqual(self.client.delete(f"/api/customers/{customer_id}", headers=headers).status_code, 204)

    def test_photo_processing_signature_pdf_lock_and_revision(self):
        report_id = self.create_report()
        self.save_sample(report_id)
        self.upload_required_photos(report_id)
        self.sign(report_id)
        db = self.app.extensions["db_session"]()
        photo_id = db.scalar(select(Photo.id).where(Photo.report_id == report_id))
        db.close()
        reordered = self.client.patch(f"/api/photos/{photo_id}", json={"caption": "Front view", "sort_order": 9}, headers={"X-CSRF-Token": self.csrf()})
        self.assertEqual(reordered.status_code, 200)
        self.assertEqual(reordered.get_json()["sort_order"], 9)
        response = self.client.post(f"/reports/{report_id}/finalize", data={"csrf_token": self.csrf()})
        self.assertEqual(response.status_code, 302)

        db = self.app.extensions["db_session"]()
        report = db.get(Report, report_id)
        self.assertTrue(report.finalized)
        self.assertEqual(report.result, "PASS")
        versions = list(db.scalars(select(ReportVersion).where(ReportVersion.report_id == report_id)).all())
        self.assertEqual(len(versions), 4)
        self.assertEqual({(v.template, v.language) for v in versions}, {("legacy", "en"), ("legacy", "bilingual"), ("modern", "en"), ("modern", "bilingual")})
        for version in versions:
            path = Path(version.file_path)
            self.assertGreater(path.stat().st_size, 4000)
            self.assertEqual(version.checksum, file_sha256(path))
            self.assertTrue(path.read_bytes().startswith(b"%PDF"))
        audit_actions = set(db.scalars(select(AuditLog.action).where(AuditLog.entity_type == "report", AuditLog.entity_id == report_id)).all())
        self.assertTrue({"create", "upload_photo", "sign", "finalize"}.issubset(audit_actions))
        photo = db.scalar(select(Photo).where(Photo.report_id == report_id))
        with Image.open(photo.file_path) as processed:
            self.assertEqual(len(processed.getexif()), 0)
        old_checksums = {v.checksum for v in versions}
        db.close()

        pdf_version_id = versions[0].id
        self.client.post("/logout", data={"csrf_token": self.csrf()})
        self.assertEqual(self.client.get(f"/media/photos/{photo_id}").status_code, 302)
        self.assertEqual(self.client.get(f"/reports/{report_id}/pdf/{pdf_version_id}").status_code, 302)
        self.login()

        copied_response = self.client.post(f"/reports/{report_id}/copy", data={"csrf_token": self.csrf()})
        self.assertEqual(copied_response.status_code, 302)
        copied_id = int(copied_response.headers["Location"].split("/")[2])
        db = self.app.extensions["db_session"]()
        copied = db.get(Report, copied_id)
        self.assertFalse(copied.finalized)
        self.assertEqual(copied.parent_id, report_id)
        self.assertIn("-COPY", copied.report_no)
        self.assertEqual(len(list(db.scalars(select(Photo).where(Photo.report_id == copied_id)).all())), 3)
        db.close()

        immutable_photo = self.client.patch(f"/api/photos/{photo_id}", json={"caption": "Changed"}, headers={"X-CSRF-Token": self.csrf()})
        self.assertEqual(immutable_photo.status_code, 409)

        locked = self.client.post(f"/reports/{report_id}/edit", data={"csrf_token": self.csrf()})
        self.assertEqual(locked.status_code, 302)
        revision_response = self.client.post(f"/reports/{report_id}/revision", data={"csrf_token": self.csrf()})
        self.assertEqual(revision_response.status_code, 302)
        revision_id = int(revision_response.headers["Location"].split("/")[2])
        db = self.app.extensions["db_session"]()
        revision = db.get(Report, revision_id)
        self.assertEqual(revision.revision, 1)
        self.assertFalse(revision.finalized)
        self.assertIsNone(revision.signature_path)
        self.assertEqual(len(list(db.scalars(select(Photo).where(Photo.report_id == revision_id)).all())), 3)
        self.assertEqual({v.checksum for v in db.scalars(select(ReportVersion).where(ReportVersion.report_id == report_id))}, old_checksums)
        db.close()

    def test_required_signature_before_finalize(self):
        report_id = self.create_report()
        self.save_sample(report_id)
        self.upload_required_photos(report_id)
        preview = self.client.get(f"/reports/{report_id}/preview?template=legacy&language=en")
        self.assertEqual(preview.status_code, 200)
        self.assertTrue(preview.data.startswith(b"%PDF"))
        preview.close()
        db = self.app.extensions["db_session"]()
        self.assertFalse(db.get(Report, report_id).finalized)
        self.assertEqual(len(list(db.scalars(select(ReportVersion).where(ReportVersion.report_id == report_id)).all())), 0)
        db.close()
        response = self.client.post(f"/reports/{report_id}/finalize", data={"csrf_token": self.csrf()})
        self.assertEqual(response.status_code, 302)
        db = self.app.extensions["db_session"]()
        self.assertFalse(db.get(Report, report_id).finalized)
        db.close()


if __name__ == "__main__":
    unittest.main()
