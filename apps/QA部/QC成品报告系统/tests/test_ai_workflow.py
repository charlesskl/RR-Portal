import os

os.environ.setdefault("SECRET_KEY", "qc-test-secret")
os.environ.setdefault("ADMIN_PASSWORD", "Admin@12345")
os.environ.setdefault("QC_PASSWORD", "QC@12345")
import base64
import copy
import io
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from PIL import Image
from reportlab.pdfgen.canvas import Canvas
from sqlalchemy import select

from app import (
    AIAnalysisRun,
    AIFinding,
    Defect,
    ExtractedField,
    Photo,
    PhotoEvidence,
    POItem,
    QCDecision,
    Report,
    ReportPhotoSlot,
    ReportVersion,
    TestResult,
    create_app,
    file_sha256,
)
from ai_service import AIResult, AIService


def tiny_pdf():
    stream = io.BytesIO()
    canvas = Canvas(stream)
    canvas.drawString(72, 760, "PO-26032401 5226155 2,004 PCS")
    canvas.save()
    stream.seek(0)
    return stream


def image_stream(color=(55, 110, 170)):
    stream = io.BytesIO()
    image = Image.new("RGB", (520, 390), color)
    exif = Image.Exif()
    exif[274] = 6
    exif[34853] = {1: "N", 2: (22.0, 0.0, 0.0)}
    image.save(stream, "JPEG", quality=90, exif=exif)
    stream.seek(0)
    return stream


def signature_data_url():
    image = Image.new("RGBA", (420, 140), (255, 255, 255, 0))
    for x in range(35, 370):
        y = 72 + (x % 35) // 3
        image.putpixel((x, y), (20, 50, 80, 255))
    stream = io.BytesIO()
    image.save(stream, "PNG")
    return "data:image/png;base64," + base64.b64encode(stream.getvalue()).decode()


class AIAssistedWorkflowTest(unittest.TestCase):
    def setUp(self):
        self.previous_mock = os.environ.get("AI_MOCK_MODE")
        self.previous_fixture = os.environ.get("AI_MOCK_FIXTURE")
        os.environ["AI_MOCK_MODE"] = "true"
        os.environ["AI_MOCK_FIXTURE"] = "long_loose_thread"
        self.temp = tempfile.TemporaryDirectory()
        root = Path(self.temp.name)
        self.app = create_app({
            "TESTING": True,
            "SECRET_KEY": "ai-test-secret",
            "DATABASE_URL": f"sqlite:///{(root / 'ai.db').as_posix()}",
            "STORAGE_ROOT": str(root / "storage"),
        })
        self.client = self.app.test_client()
        self.client.get("/login")
        self.client.post("/login", data={"username": "qc", "password": "QC@12345", "csrf_token": self.csrf()})

    def tearDown(self):
        self.app.extensions["db_session"].remove()
        self.app.extensions["db_engine"].dispose()
        self.temp.cleanup()
        if self.previous_mock is None:
            os.environ.pop("AI_MOCK_MODE", None)
        else:
            os.environ["AI_MOCK_MODE"] = self.previous_mock
        if self.previous_fixture is None:
            os.environ.pop("AI_MOCK_FIXTURE", None)
        else:
            os.environ["AI_MOCK_FIXTURE"] = self.previous_fixture

    def csrf(self):
        with self.client.session_transaction() as session:
            return session["csrf_token"]

    def create_ai_report(self):
        created = self.client.post(
            "/api/po-imports",
            data={"file": (tiny_pdf(), "PO-26032401.pdf")},
            headers={"X-CSRF-Token": self.csrf()},
            content_type="multipart/form-data",
        )
        self.assertEqual(created.status_code, 202, created.data)
        import_id = created.get_json()["id"]
        extracted = self.client.get(f"/api/po-imports/{import_id}").get_json()
        self.assertEqual(extracted["status"], "needs_review")
        self.assertEqual(len(extracted["items"]), 1)
        item = extracted["items"][0]
        self.assertEqual(item["fields"]["item_no"]["normalized_value"], "5226155")
        self.assertEqual(item["fields"]["po_quantity"]["normalized_value"], "2004")
        self.assertTrue(item["fields"]["po_no"]["source_ref"])
        updates = {key: {"normalized_value": value["normalized_value"], "confirmed": True} for key, value in item["fields"].items()}
        reviewed = self.client.patch(
            f"/api/po-imports/{import_id}/items/{item['id']}/fields",
            json={"fields": updates},
            headers={"X-CSRF-Token": self.csrf()},
        )
        self.assertEqual(reviewed.status_code, 200)
        report_response = self.client.post(
            "/api/reports",
            json={"po_item_id": item["id"]},
            headers={"X-CSRF-Token": self.csrf()},
        )
        self.assertEqual(report_response.status_code, 201, report_response.data)
        return report_response.get_json()["id"]

    def upload_required_slots(self, report_id):
        db = self.app.extensions["db_session"]()
        slots = list(db.scalars(select(ReportPhotoSlot).where(ReportPhotoSlot.report_id == report_id, ReportPhotoSlot.required.is_(True))).all())
        db.close()
        self.assertGreaterEqual(len(slots), 6)
        for index, slot in enumerate(slots):
            response = self.client.post(
                f"/api/reports/{report_id}/photo-slots/{slot.id}/photos",
                data={"photos": (image_stream((45 + index * 5, 110, 170)), f"slot-{slot.id}.jpg"), "upload_source": "camera" if index % 2 else "gallery"},
                headers={"X-CSRF-Token": self.csrf()},
                content_type="multipart/form-data",
            )
            self.assertEqual(response.status_code, 201, response.data)

    def fill_tests(self, report_id, failed_name=None, omit_name=None, na_name=None):
        db = self.app.extensions["db_session"]()
        tests = list(db.scalars(select(TestResult).where(TestResult.report_id == report_id)).all())
        db.close()
        data = {
            "csrf_token": self.csrf(),
            "inspection_date": "2026-07-15",
            "inspected_qty": "125",
            "inspection_level": "II",
            "critical_aql": "0",
            "major_aql": "1.0",
            "minor_aql": "4.0",
            "remarks": "Working current manually measured by QC.",
        }
        for test in tests:
            data[f"test_standard_{test.id}"] = test.standard
            if test.name != omit_name:
                data[f"test_result_{test.id}"] = "FAIL" if test.name == failed_name else "N/A" if test.name == na_name else "PASS"
        response = self.client.post(f"/reports/{report_id}/inspection", data=data)
        self.assertEqual(response.status_code, 302)

    def test_complete_ai_qc_flow_and_unified_immutable_pdf(self):
        report_id = self.create_ai_report()
        self.upload_required_slots(report_id)
        self.fill_tests(report_id)

        workspace_html = self.client.get(f"/reports/{report_id}/inspection").get_data(as_text=True)
        test_form_start = workspace_html.index('<form id="inspection-data"')
        test_form_end = workspace_html.index("</form>", test_form_start)
        self.assertIn('name="csrf_token"', workspace_html[test_form_start:test_form_end])
        self.assertIn(f'action="/reports/{report_id}/finalize"', workspace_html)
        self.assertNotIn(f'action="/api/reports/{report_id}/finalize"', workspace_html)

        started = self.client.post(f"/api/reports/{report_id}/analysis-runs", headers={"X-CSRF-Token": self.csrf()})
        self.assertEqual(started.status_code, 202, started.data)
        run_id = started.get_json()["analysis_run_id"]
        run = self.client.get(f"/api/analysis-runs/{run_id}").get_json()
        self.assertEqual(run["status"], "completed")
        self.assertEqual(len(run["findings"]), 1)
        self.assertEqual(run["findings"][0]["name"], "Long loose thread")
        finding_id = run["findings"][0]["id"]
        accepted = self.client.patch(
            f"/api/findings/{finding_id}",
            json={"action": "accept", "affected_quantity": 2, "sample_ids": "#03,#17"},
            headers={"X-CSRF-Token": self.csrf()},
        )
        self.assertEqual(accepted.status_code, 200, accepted.data)
        self.assertEqual(accepted.get_json()["report_result"], "PASS")

        db = self.app.extensions["db_session"]()
        report = db.get(Report, report_id)
        self.assertEqual((report.critical_count, report.major_count, report.minor_count), (0, 0, 2))
        self.assertEqual(report.sample_size, 125)
        finding = db.get(AIFinding, finding_id)
        self.assertEqual(finding.status, "accepted")
        defect = db.get(Defect, finding.confirmed_defect_id)
        self.assertEqual((defect.description, defect.severity, defect.quantity), ("Long loose thread", "minor", 2))
        evidence = db.scalar(select(PhotoEvidence))
        self.assertNotEqual(evidence.original_checksum, "")
        self.assertEqual(evidence.processed_checksum, file_sha256(Path(evidence.processed_path)))
        with Image.open(evidence.processed_path) as image:
            self.assertEqual(len(image.getexif()), 0)
        db.close()

        signed = self.client.post(
            f"/reports/{report_id}/signature",
            data={"csrf_token": self.csrf(), "signature_mode": "draw", "signature_data": signature_data_url()},
        )
        self.assertEqual(signed.status_code, 302)
        finalized = self.client.post(f"/api/reports/{report_id}/finalize", headers={"X-CSRF-Token": self.csrf()})
        self.assertEqual(finalized.status_code, 201, finalized.data)
        self.assertTrue(finalized.get_json()["finalized"])
        db = self.app.extensions["db_session"]()
        report = db.get(Report, report_id)
        versions = list(db.scalars(select(ReportVersion).where(ReportVersion.report_id == report_id)).all())
        self.assertTrue(report.finalized)
        self.assertIsNotNone(report.signed_by_id)
        self.assertEqual([(item.template, item.language) for item in versions], [("unified", "en")])
        self.assertEqual(versions[0].signed_by_id, report.signed_by_id)
        self.assertEqual(versions[0].data_checksum, report.signed_data_checksum)
        pdf_path = Path(versions[0].file_path)
        self.assertTrue(pdf_path.read_bytes().startswith(b"%PDF"))
        self.assertGreater(pdf_path.stat().st_size, 5000)
        old_checksum = versions[0].checksum
        original_pdf = pdf_path.read_bytes()
        db.close()

        pdf_path.write_bytes(b"tampered PDF")
        integrity_failure = self.client.get(f"/reports/{report_id}/pdf/{versions[0].id}")
        self.assertEqual(integrity_failure.status_code, 409)
        pdf_path.write_bytes(original_pdf)

        rejected_mutation = self.client.patch(f"/api/findings/{finding_id}", json={"action": "reject"}, headers={"X-CSRF-Token": self.csrf()})
        self.assertEqual(rejected_mutation.status_code, 409)
        revision = self.client.post(f"/reports/{report_id}/revision", data={"csrf_token": self.csrf()})
        self.assertEqual(revision.status_code, 302)
        revision_id = int(revision.headers["Location"].split("/")[2])
        db = self.app.extensions["db_session"]()
        revised = db.get(Report, revision_id)
        self.assertEqual(revised.revision, 1)
        self.assertEqual(revised.result, "ON HOLD")
        self.assertIn("AI analysis", revised.result_reason)
        self.assertEqual(list(db.scalars(select(Defect).where(Defect.report_id == revision_id)).all()), [])
        self.assertEqual(len(list(db.scalars(select(Defect).where(Defect.report_id == report_id)).all())), 1)
        self.assertEqual(db.get(ReportVersion, versions[0].id).checksum, old_checksum)
        db.close()

        rerun = self.client.post(f"/api/reports/{revision_id}/analysis-runs", headers={"X-CSRF-Token": self.csrf()})
        self.assertEqual(rerun.status_code, 202, rerun.data)
        rerun_data = self.client.get(f"/api/analysis-runs/{rerun.get_json()['analysis_run_id']}").get_json()
        accepted_again = self.client.patch(
            f"/api/findings/{rerun_data['findings'][0]['id']}",
            json={"action": "accept", "affected_quantity": 2, "sample_ids": "#03,#17"},
            headers={"X-CSRF-Token": self.csrf()},
        )
        self.assertEqual(accepted_again.status_code, 200, accepted_again.data)
        db = self.app.extensions["db_session"]()
        self.assertEqual(db.get(Report, revision_id).minor_count, 2)
        self.assertEqual(len(list(db.scalars(select(Defect).where(Defect.report_id == revision_id)).all())), 1)
        db.close()

    def test_required_test_missing_and_fail_decisions(self):
        report_id = self.create_ai_report()
        self.upload_required_slots(report_id)
        db = self.app.extensions["db_session"]()
        first_test = db.scalar(select(TestResult).where(TestResult.report_id == report_id).order_by(TestResult.id))
        test_name = first_test.name
        db.close()
        self.fill_tests(report_id, omit_name=test_name)
        db = self.app.extensions["db_session"]()
        report = db.get(Report, report_id)
        self.assertEqual(report.result, "ON HOLD")
        self.assertIn("test:" + test_name, report.result_reason)
        db.close()
        self.fill_tests(report_id, na_name=test_name)
        db = self.app.extensions["db_session"]()
        report = db.get(Report, report_id)
        self.assertEqual(report.result, "ON HOLD")
        self.assertIn("test:" + test_name, report.result_reason)
        db.close()
        self.fill_tests(report_id, failed_name=test_name)
        db = self.app.extensions["db_session"]()
        report = db.get(Report, report_id)
        self.assertEqual(report.result, "REJECT")
        self.assertIn("Required performance test failed", report.result_reason)
        db.close()

    def test_multi_item_po_split_and_missing_values_are_not_invented(self):
        source_path = Path(self.temp.name) / "multi-item-source.pdf"
        source_path.write_bytes(tiny_pdf().getvalue())
        base_result = AIService().extract_po(source_path)
        data = copy.deepcopy(base_result.data)
        second = copy.deepcopy(data["items"][0])
        second["item_key"] = "5226156"
        second["fields"]["item_number"]["raw_value"] = "5226156"
        second["fields"]["item_number"]["normalized_value"] = "5226156"
        second["fields"]["item_number"]["source"]["excerpt"] = "5226156"
        second["fields"]["description"]["raw_value"] = "Second line item"
        second["fields"]["description"]["normalized_value"] = "Second line item"
        second["fields"]["description"]["source"]["excerpt"] = "Second line item"
        second["fields"]["ordered_quantity"]["raw_value"] = "480 PCS"
        second["fields"]["ordered_quantity"]["normalized_value"] = "480"
        second["fields"]["ordered_quantity"]["source"]["excerpt"] = "480 PCS"
        second["fields"]["barcode"] = copy.deepcopy(second["fields"]["age_grade"])
        data["items"].append(second)

        with patch.object(AIService, "extract_po", return_value=AIResult(data=data, metadata=base_result.metadata)):
            response = self.client.post(
                "/api/po-imports",
                data={"file": (tiny_pdf(), "multi-item.pdf")},
                headers={"X-CSRF-Token": self.csrf()},
                content_type="multipart/form-data",
            )
        self.assertEqual(response.status_code, 202, response.data)
        extracted = self.client.get(f"/api/po-imports/{response.get_json()['id']}").get_json()
        self.assertEqual(len(extracted["items"]), 2)
        self.assertEqual(extracted["items"][0]["fields"]["item_no"]["normalized_value"], "5226155")
        self.assertEqual(extracted["items"][1]["fields"]["item_no"]["normalized_value"], "5226156")
        self.assertEqual(extracted["items"][1]["fields"]["po_quantity"]["normalized_value"], "480")
        self.assertEqual(extracted["items"][1]["fields"]["barcode"]["normalized_value"], "")
        self.assertEqual(extracted["items"][1]["fields"]["barcode"]["confidence"], 0)
        self.assertEqual(extracted["items"][1]["fields"]["barcode"]["source_ref"], {})

    def test_blurred_photo_analysis_requests_retake_and_stays_on_hold(self):
        report_id = self.create_ai_report()
        self.upload_required_slots(report_id)
        self.fill_tests(report_id)
        os.environ["AI_MOCK_FIXTURE"] = "retake"

        started = self.client.post(f"/api/reports/{report_id}/analysis-runs", headers={"X-CSRF-Token": self.csrf()})
        self.assertEqual(started.status_code, 202, started.data)
        run = self.client.get(f"/api/analysis-runs/{started.get_json()['analysis_run_id']}").get_json()
        self.assertEqual(run["status"], "completed")
        self.assertEqual(run["findings"], [])
        self.assertTrue(run["observations"])
        self.assertTrue(all(item["requires_retake"] for item in run["observations"]))

        db = self.app.extensions["db_session"]()
        report = db.get(Report, report_id)
        self.assertEqual(report.result, "ON HOLD")
        self.assertIn("photos require retake", report.result_reason)
        db.close()

    def test_qc_can_edit_then_reject_ai_finding_with_audit_history(self):
        report_id = self.create_ai_report()
        self.upload_required_slots(report_id)
        self.fill_tests(report_id)
        started = self.client.post(f"/api/reports/{report_id}/analysis-runs", headers={"X-CSRF-Token": self.csrf()})
        run = self.client.get(f"/api/analysis-runs/{started.get_json()['analysis_run_id']}").get_json()
        finding_id = run["findings"][0]["id"]

        edited = self.client.patch(
            f"/api/findings/{finding_id}",
            json={"action": "edit", "description_en": "Loose thread at left seam", "severity": "major", "affected_quantity": 2, "sample_ids": "#03,#17"},
            headers={"X-CSRF-Token": self.csrf()},
        )
        self.assertEqual(edited.status_code, 200, edited.data)
        self.assertEqual(edited.get_json()["status"], "edited")
        self.assertEqual(edited.get_json()["report_result"], "PASS")

        rejected = self.client.patch(
            f"/api/findings/{finding_id}",
            json={"action": "reject"},
            headers={"X-CSRF-Token": self.csrf()},
        )
        self.assertEqual(rejected.status_code, 200, rejected.data)
        self.assertEqual(rejected.get_json()["status"], "rejected")
        self.assertEqual(rejected.get_json()["report_result"], "PASS")

        db = self.app.extensions["db_session"]()
        finding = db.get(AIFinding, finding_id)
        self.assertIsNone(finding.confirmed_defect_id)
        self.assertEqual(list(db.scalars(select(Defect).where(Defect.report_id == report_id)).all()), [])
        decisions = list(db.scalars(select(QCDecision).where(QCDecision.finding_id == finding_id).order_by(QCDecision.id)).all())
        self.assertEqual([item.action for item in decisions], ["edit", "reject"])
        self.assertIn("Loose thread at left seam", decisions[0].after_json)
        self.assertIn('"status": "edited"', decisions[1].before_json)
        db.close()

    def test_evidence_change_invalidates_ai_defects_and_signature_without_double_counting(self):
        report_id = self.create_ai_report()
        self.upload_required_slots(report_id)
        self.fill_tests(report_id)
        started = self.client.post(f"/api/reports/{report_id}/analysis-runs", headers={"X-CSRF-Token": self.csrf()})
        run = self.client.get(f"/api/analysis-runs/{started.get_json()['analysis_run_id']}").get_json()
        finding_id = run["findings"][0]["id"]
        accepted = self.client.patch(
            f"/api/findings/{finding_id}",
            json={"action": "accept", "affected_quantity": 2, "sample_ids": "#03,#17"},
            headers={"X-CSRF-Token": self.csrf()},
        )
        self.assertEqual(accepted.get_json()["report_result"], "PASS")
        signed = self.client.post(
            f"/reports/{report_id}/signature",
            data={"csrf_token": self.csrf(), "signature_mode": "draw", "signature_data": signature_data_url()},
        )
        self.assertEqual(signed.status_code, 302)

        db = self.app.extensions["db_session"]()
        report = db.get(Report, report_id)
        self.assertTrue(report.signature_path)
        slot = db.scalar(select(ReportPhotoSlot).where(ReportPhotoSlot.report_id == report_id).order_by(ReportPhotoSlot.id))
        queued = AIAnalysisRun(report_id=report_id, status="queued", created_by=report.inspector_id, input_manifest="[]", input_manifest_checksum="queued-test")
        db.add(queued)
        db.commit()
        db.close()
        blocked = self.client.post(f"/api/reports/{report_id}/finalize", headers={"X-CSRF-Token": self.csrf()})
        self.assertEqual(blocked.status_code, 409)
        db = self.app.extensions["db_session"]()
        db.get(AIAnalysisRun, queued.id).status = "cancelled"
        db.commit()
        db.close()

        changed = self.client.post(
            f"/api/reports/{report_id}/photo-slots/{slot.id}/photos",
            data={"photos": (image_stream((180, 90, 80)), "replacement-angle.jpg"), "upload_source": "gallery"},
            headers={"X-CSRF-Token": self.csrf()},
            content_type="multipart/form-data",
        )
        self.assertEqual(changed.status_code, 201, changed.data)
        db = self.app.extensions["db_session"]()
        report = db.get(Report, report_id)
        old_run = db.get(AIAnalysisRun, run["id"])
        self.assertIsNone(report.signature_path)
        self.assertEqual((report.critical_count, report.major_count, report.minor_count), (0, 0, 0))
        self.assertEqual(report.result, "ON HOLD")
        self.assertEqual(old_run.status, "stale")
        db.close()

        restarted = self.client.post(f"/api/reports/{report_id}/analysis-runs", headers={"X-CSRF-Token": self.csrf()})
        rerun = self.client.get(f"/api/analysis-runs/{restarted.get_json()['analysis_run_id']}").get_json()
        accepted_again = self.client.patch(
            f"/api/findings/{rerun['findings'][0]['id']}",
            json={"action": "accept", "affected_quantity": 2, "sample_ids": "#03,#17"},
            headers={"X-CSRF-Token": self.csrf()},
        )
        self.assertEqual(accepted_again.get_json()["report_result"], "PASS")
        db = self.app.extensions["db_session"]()
        report = db.get(Report, report_id)
        self.assertEqual((report.critical_count, report.major_count, report.minor_count), (0, 0, 2))
        self.assertEqual(len(list(db.scalars(select(Defect).where(Defect.report_id == report_id)).all())), 1)
        db.close()


if __name__ == "__main__":
    unittest.main()
