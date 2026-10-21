import io
import copy
import json
import socket
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch
from urllib import error

from ai_service import (
    AIConfig,
    AIResponseError,
    AIService,
    AITransportError,
    AIValidationError,
    PO_EXTRACTION_SCHEMA,
    _validate_photo_data,
    _mock_po_data,
)
from task_queue import enqueue
from rq.job import Job
from redis import Redis


class FakeResponse:
    def __init__(self, body: bytes, request_id: str = "req-test"):
        self.body = body
        self.headers = {"x-request-id": request_id}

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback):
        return False

    def read(self, _limit: int):
        return self.body


class AIServiceContractTest(unittest.TestCase):
    def live_po(self, data, suffix=".pdf"):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / ("synthetic" + suffix)
            path.write_bytes(b"%PDF-1.4\n% synthetic" if suffix == ".pdf" else b"PK\x03\x04synthetic")
            service = AIService(AIConfig(api_key="synthetic-test-only"))
            with patch.object(service, "_post_responses", return_value=({}, "synthetic-id")), patch("ai_service._extract_structured_json", return_value=copy.deepcopy(data)):
                return service.extract_po(path).data

    def test_incomplete_evidence_blanks_only_affected_fields_and_forces_review(self):
        for kind, suffix, source_field in [("page", ".pdf", "page"), ("spreadsheet", ".xlsx", "cell_range")]:
            with self.subTest(source_kind=kind):
                data = _mock_po_data(source_kind=kind)
                field = data["items"][0]["fields"]["item_number"]
                field["source"][source_field] = None
                preserved = copy.deepcopy(data["document_fields"]["po_number"])
                result = self.live_po(data, suffix)
                missing = result["items"][0]["fields"]["item_number"]
                self.assertEqual(missing["status"], "missing")
                self.assertIsNone(missing["raw_value"])
                self.assertIsNone(missing["normalized_value"])
                self.assertTrue(missing["needs_review"])
                self.assertTrue(all(value is None for value in missing["source"].values()))
                self.assertEqual(result["document_fields"]["po_number"], preserved)

    def test_malformed_model_shapes_remain_typed_validation_errors(self):
        for mutation in [lambda d: d.update(document_fields=[]), lambda d: d["items"][0].update(fields=[]), lambda d: d["items"][0]["fields"]["item_number"].update(confidence="high")]:
            data = _mock_po_data(source_kind="page")
            mutation(data)
            with self.assertRaises(AIValidationError):
                self.live_po(data)

    def test_ambiguous_and_low_confidence_fields_always_require_review(self):
        for status, confidence in [("ambiguous", 0.99), ("found", 0.5)]:
            data = _mock_po_data(source_kind="page")
            field = data["items"][0]["fields"]["item_number"]
            field.update(status=status, confidence=confidence, needs_review=False)
            self.assertTrue(self.live_po(data)["items"][0]["fields"]["item_number"]["needs_review"])
    def test_mock_pdf_and_spreadsheet_preserve_evidence_and_missing_values(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            pdf = root / "sample.pdf"
            xlsx = root / "sample.xlsx"
            pdf.write_bytes(b"%PDF-1.4\n% deterministic fixture")
            xlsx.write_bytes(b"PK\x03\x04deterministic fixture")
            service = AIService(AIConfig(mock_mode=True))

            pdf_result = service.extract_po(pdf)
            sheet_result = service.extract_po(xlsx)

        self.assertEqual(pdf_result.data["items"][0]["fields"]["item_number"]["normalized_value"], "5226155")
        self.assertEqual(pdf_result.data["items"][0]["fields"]["item_number"]["source"]["page"], 1)
        self.assertEqual(sheet_result.data["items"][0]["fields"]["item_number"]["source"]["sheet"], "PO")
        missing = pdf_result.data["document_fields"]["factory"]
        self.assertIsNone(missing["raw_value"])
        self.assertIsNone(missing["normalized_value"])
        self.assertEqual(missing["confidence"], 0)
        self.assertEqual(missing["status"], "missing")

    def test_request_contract_is_strict_non_stored_and_does_not_embed_api_key(self):
        secret = "sk-private-test-key"
        service = AIService(AIConfig(api_key=secret, model="vision-test"))
        payload = service._payload(
            system_prompt="system",
            user_content=[{"type": "input_text", "text": "extract"}],
            schema_name="qc_po_extraction",
            schema=PO_EXTRACTION_SCHEMA,
            prompt_version="prompt-v1",
            schema_version="schema-v1",
        )
        self.assertFalse(payload["store"])
        self.assertTrue(payload["text"]["format"]["strict"])
        self.assertEqual(payload["text"]["format"]["type"], "json_schema")
        self.assertNotIn(secret, json.dumps(payload))
        self.assertNotIn(secret, repr(service.config))

    def test_timeout_rate_limit_and_invalid_json_are_safe_typed_errors(self):
        secret = "sk-private-test-key"
        service = AIService(AIConfig(api_key=secret, timeout_seconds=10))
        payload = {"model": "test"}

        with patch("ai_service.request.urlopen", side_effect=socket.timeout("slow")):
            with self.assertRaises(AITransportError) as timeout_context:
                service._post_responses(payload)
        self.assertNotIn(secret, str(timeout_context.exception))

        rate_error = error.HTTPError(
            service.config.responses_url,
            429,
            "Too Many Requests",
            {"x-request-id": "req-rate-limit"},
            io.BytesIO(b"{}"),
        )
        with patch("ai_service.request.urlopen", side_effect=rate_error):
            with self.assertRaises(AITransportError) as rate_context:
                service._post_responses(payload)
        self.assertEqual(rate_context.exception.request_id, "req-rate-limit")
        self.assertIn("HTTP 429", str(rate_context.exception))
        self.assertNotIn(secret, str(rate_context.exception))

        with patch("ai_service.request.urlopen", return_value=FakeResponse(b"{invalid", "req-invalid")):
            with self.assertRaises(AIResponseError) as invalid_context:
                service._post_responses(payload)
        self.assertEqual(invalid_context.exception.request_id, "req-invalid")
        self.assertNotIn(secret, str(invalid_context.exception))

    def test_queue_uses_bounded_exponential_retries(self):
        queue = Mock()
        queue.enqueue.return_value = "job"
        with patch("task_queue.get_queue", return_value=queue), patch.dict(
            "os.environ", {"OPENAI_MAX_RETRIES": "3"}, clear=False
        ):
            result = enqueue("app.process_po_import_job", 9)
        self.assertEqual(result, "job")
        kwargs = queue.enqueue.call_args.kwargs
        self.assertEqual(kwargs["retry"].max, 3)
        self.assertEqual(kwargs["retry"].intervals, [10, 20, 40])
        self.assertEqual(kwargs["job_timeout"], 900)

    def test_cloud_job_budget_keeps_headroom_around_one_request(self):
        queue = Mock()
        with patch("task_queue.get_queue", return_value=queue), patch.dict(
            "os.environ",
            {"OPENAI_TIMEOUT_SECONDS": "900", "RQ_JOB_TIMEOUT_SECONDS": "1200", "OPENAI_MAX_RETRIES": "2"},
        ):
            config = AIConfig.from_env()
            enqueue("app.process_po_import_job", 9)
        options = queue.enqueue.call_args.kwargs
        self.assertEqual(config.timeout_seconds, 900)
        self.assertEqual(options["job_timeout"], 1200)
        self.assertGreater(options["job_timeout"], config.timeout_seconds)
        # RQ retries are separate attempts with the same per-job deadline.
        self.assertEqual(options["retry"].max, 2)

    def test_cloud_http_request_uses_extended_budget_and_closes_response(self):
        with patch.dict("os.environ", {"OPENAI_TIMEOUT_SECONDS": "900", "OPENAI_MAX_OUTPUT_TOKENS": "64000"}):
            config = AIConfig.from_env()
        service = AIService(config)
        response = Mock()
        response.headers = {"x-request-id": "req-budget"}
        response.read.return_value = b'{"id":"resp-budget"}'
        response.__enter__ = Mock(return_value=response)
        response.__exit__ = Mock(return_value=False)
        payload = service._payload(
            system_prompt="system", user_content=[], schema_name="qc_po_extraction",
            schema=PO_EXTRACTION_SCHEMA, prompt_version="test", schema_version="test",
        )
        with patch("ai_service.request.urlopen", return_value=response) as post:
            decoded, request_id = service._post_responses(payload)
        post.assert_called_once()
        request_object = post.call_args.args[0]
        self.assertEqual(json.loads(request_object.data)["max_output_tokens"], 64000)
        self.assertEqual(post.call_args.kwargs["timeout"], 900)
        self.assertEqual((decoded["id"], request_id), ("resp-budget", "req-budget"))
        response.read.assert_called_once_with(5 * 1024 * 1024 + 1)
        response.__exit__.assert_called_once_with(None, None, None)

    def test_recreating_worker_does_not_rewrite_existing_job_timeout(self):
        # This uses RQ's real persisted format without opening a Redis connection.
        connection = Redis(host="127.0.0.1", port=1)
        old_job = Job.create("app.process_po_import_job", args=[9], connection=connection, timeout=900, serializer="json")
        stored = {key.encode(): value.encode() if isinstance(value, str) else str(value).encode() if isinstance(value, (int, float)) else value for key, value in old_job.to_dict().items()}
        with patch.dict("os.environ", {"RQ_JOB_TIMEOUT_SECONDS": "1200"}):
            restored = Job(connection=connection, serializer="json")
            restored.restore(stored)
        self.assertEqual(restored.timeout, 900)
        self.assertEqual(restored.args, [9])

    def test_po_mismatch_cannot_be_silently_reported_as_no_visible_issue(self):
        data = {
            "observations": [
                {
                    "photo_id": "7",
                    "slot_key": "barcode",
                    "clarity": "clear",
                    "needs_retake": False,
                    "retake_reason": None,
                    "ocr_text": ["4895247404493"],
                    "barcodes": ["4895247404493"],
                    "date_codes": [],
                    "po_comparisons": [
                        {
                            "field": "barcode",
                            "observed_value": "4895247404493",
                            "expected_value": "4895247404492",
                            "status": "mismatch",
                            "reason": "Last digit differs from the PO",
                        }
                    ],
                    "visible_condition": "Barcode is readable",
                    "limitations": [],
                }
            ],
            "findings": [],
            "overall_status": "no_visible_issue",
            "warnings": [],
        }
        with self.assertRaises(AIValidationError):
            _validate_photo_data(data, expected_photo_ids=["7"])

        data["findings"] = [
            {
                "finding_key": "barcode-mismatch",
                "title": "Barcode mismatch",
                "report_description_en": "Product barcode does not match the PO.",
                "suggested_severity": "major",
                "confidence": 0.99,
                "evidence_photo_ids": ["7"],
                "reason": "Readable barcode differs from the expected PO value.",
                "deduplication_basis": "Single barcode comparison finding.",
                "requires_qc_count": True,
            }
        ]
        data["overall_status"] = "review_required"
        _validate_photo_data(data, expected_photo_ids=["7"])


if __name__ == "__main__":
    unittest.main()
