import io
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from reportlab.pdfgen.canvas import Canvas
from sqlalchemy import select

from ai_service import AIConfig, AIConfigurationError, AIService
from app import (
    AI_KEY_SETTING, AI_SETTING_KEYS, AuditLog, Setting,
    ai_runtime_config, create_app,
)


class AISettingsTest(unittest.TestCase):
    def setUp(self):
        self.environment = {
            "OPENAI_API_KEY": "synthetic-company-key",
            "OPENAI_BASE_URL": "https://dashscope.aliyuncs.com/compatible-mode/v1",
            "OPENAI_MODEL": "qwen3.8-max",
            "OPENAI_API_FORMAT": "bailian_chat",
            "OPENAI_TIMEOUT_SECONDS": "900",
            "OPENAI_MAX_OUTPUT_TOKENS": "64000",
            "AI_MOCK_MODE": "true",
            "AUTH_DISABLED": "false",
            "REDIS_URL": "",
            "QUEUE_REQUIRED": "false",
        }
        self.env_patch = patch.dict(os.environ, self.environment)
        self.env_patch.start()
        self.temp = tempfile.TemporaryDirectory()
        root = Path(self.temp.name)
        self.test_config = {
            "TESTING": True,
            "SECRET_KEY": "synthetic-ai-settings-secret",
            "DATABASE_URL": f"sqlite:///{root / 'settings.db'}",
            "STORAGE_ROOT": str(root / "storage"),
        }
        self.app = create_app(self.test_config)
        self.client = self.app.test_client()
        self.login("admin", "Admin@12345")

    def tearDown(self):
        self.app.extensions["db_session"].remove()
        self.app.extensions["db_engine"].dispose()
        self.temp.cleanup()
        self.env_patch.stop()

    def csrf(self):
        with self.client.session_transaction() as session:
            return session["csrf_token"]

    def login(self, username, password):
        self.client.get("/login")
        response = self.client.post("/login", data={
            "username": username, "password": password, "csrf_token": self.csrf(),
        })
        self.assertEqual(response.status_code, 302)

    def save(self, **values):
        return self.client.post("/admin", data={
            "action": "ai_settings", "csrf_token": self.csrf(), **values,
        }, follow_redirects=True)

    def stored(self):
        db = self.app.extensions["db_session"]()
        values = dict(db.execute(select(Setting.key, Setting.value).where(Setting.key.in_(AI_SETTING_KEYS))).all())
        db.close()
        return values

    def config(self, application=None):
        application = application or self.app
        db = application.extensions["db_session"]()
        try:
            return ai_runtime_config(db, application)
        finally:
            db.close()

    def assert_env_unchanged(self):
        for key, value in self.environment.items():
            self.assertEqual(os.environ[key], value, key)

    def test_unconfigured_settings_preserve_company_config_exactly(self):
        config = self.config()
        self.assertEqual(config, AIConfig.from_env())
        self.assertEqual(config.api_key, self.environment["OPENAI_API_KEY"])
        self.assertEqual(config.responses_url, "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions")
        html = self.client.get("/admin").get_data(as_text=True)
        self.assertIn('value="qwen3.8-max"', html)
        self.assertIn('value="bailian_chat" selected', html)
        self.assertIn('value="900"', html)
        self.assertIn('value="64000"', html)
        self.assertNotIn(self.environment["OPENAI_API_KEY"], html)
        self.assertEqual(self.stored(), {})

    def test_key_is_encrypted_never_rendered_or_audited_and_blank_keeps_it(self):
        secret = "synthetic-private-new-key"
        response = self.save(ai_openai_api_key=secret, ai_openai_model="test-model")
        self.assertEqual(response.status_code, 200)
        self.assertNotIn(secret, response.get_data(as_text=True))
        self.assertNotIn(secret, self.stored()[AI_KEY_SETTING])
        self.assertEqual(self.config().api_key, secret)
        before = self.stored()[AI_KEY_SETTING]
        self.save(ai_openai_api_key="", ai_openai_model="second-model")
        self.assertEqual(self.stored()[AI_KEY_SETTING], before)
        self.assertEqual(self.config().model, "second-model")
        public_settings = self.client.get("/api/settings").get_json()
        self.assertFalse(any(key.startswith("ai_openai_") for key in public_settings))
        db = self.app.extensions["db_session"]()
        for log in db.scalars(select(AuditLog)):
            self.assertNotIn(secret, log.detail)
        db.close()
        self.assert_env_unchanged()

    def test_invalid_submissions_are_atomic(self):
        self.save(ai_openai_model="known-good")
        before = self.stored()
        cases = [
            {"ai_openai_timeout_seconds": "901"},
            {"ai_openai_timeout_seconds": "NaN"},
            {"ai_openai_max_output_tokens": "-1"},
            {"ai_openai_max_output_tokens": "128001"},
            {"ai_openai_api_format": "unknown"},
            {"ai_openai_base_url": "http://insecure.example/v1"},
            {"ai_openai_base_url": "https://example.com:invalid/v1"},
            {"ai_openai_base_url": "https://invalid host.example/v1"},
            {"ai_openai_base_url": "https://["},
            {"ai_openai_base_url": "https://user:password@example.com/v1"},
            {"ai_openai_base_url": "https://example.com/v1?key=hidden"},
            {"ai_openai_model": "invalid\nmodel"},
            {"ai_openai_api_key": "contains whitespace"},
        ]
        for values in cases:
            with self.subTest(field=next(iter(values))):
                response = self.save(**values)
                self.assertEqual(response.status_code, 200)
                self.assertEqual(self.stored(), before)
        self.assert_env_unchanged()

    def test_switching_origin_needs_new_key_and_protocol_is_explicit(self):
        response = self.save(ai_openai_base_url="https://other.example/v1")
        self.assertIn("请重新填写密钥", response.get_data(as_text=True))
        self.assertEqual(self.stored(), {})
        self.save(
            ai_openai_base_url="https://other.example/v1",
            ai_openai_api_key="synthetic-other-key",
            ai_openai_api_format="responses",
        )
        config = self.config()
        self.assertEqual(config.api_key, "synthetic-other-key")
        self.assertEqual(config.responses_url, "https://other.example/v1/responses")
        self.save(ai_openai_base_url="https://third.example/v1")
        self.assertEqual(self.config(), config)
        self.assertEqual(self.config().api_key, config.api_key)
        self.assert_env_unchanged()

    def test_immutable_configs_are_isolated_across_apps_and_reset_restores_env(self):
        before = self.config()
        self.save(ai_openai_model="custom-model", ai_openai_api_key="synthetic-db-key")
        worker = create_app({**self.test_config, "SEED_DATABASE": False})
        try:
            worker_config = self.config(worker)
            self.assertEqual(worker_config.model, "custom-model")
            self.assertEqual(worker_config.api_key, "synthetic-db-key")
            self.client.post("/admin", data={"action": "ai_settings_reset", "csrf_token": self.csrf()})
            self.assertEqual(self.config(worker), before)
            self.assertEqual(self.config(worker).api_key, before.api_key)
            self.assertEqual(worker_config.model, "custom-model")
            self.assertEqual(worker_config.api_key, "synthetic-db-key")
        finally:
            worker.extensions["db_session"].remove()
            worker.extensions["db_engine"].dispose()
        self.assertEqual(self.stored(), {})
        self.assert_env_unchanged()

    def test_changed_secret_and_tampered_origin_fail_closed_without_key_leak(self):
        self.save(ai_openai_api_key="synthetic-encrypted-key")
        self.app.config["SECRET_KEY"] = "rotated-synthetic-secret"
        with self.assertRaises(AIConfigurationError) as error:
            self.config()
        self.assertNotIn("synthetic-encrypted-key", str(error.exception))
        self.app.config["SECRET_KEY"] = self.test_config["SECRET_KEY"]
        db = self.app.extensions["db_session"]()
        db.add(Setting(key="ai_openai_base_url", value="https://tampered.example/v1"))
        db.commit()
        db.close()
        with self.assertRaises(AIConfigurationError):
            self.config()

    def test_admin_csrf_and_template_form_boundaries(self):
        self.save(ai_openai_model="custom-model")
        self.client.post("/admin", data={
            "action": "settings", "csrf_token": self.csrf(), "company_name": "Synthetic Company",
            "report_title": "Synthetic Report", "required_photo_categories": "product",
        })
        self.assertEqual(self.config().model, "custom-model")
        self.save(ai_openai_timeout_seconds="600")
        self.assertEqual(self.client.get("/api/settings").get_json()["report_title"], "Synthetic Report")
        self.assertEqual(self.client.post("/admin", data={"action": "ai_settings_reset"}).status_code, 400)
        self.login("qc", "QC@12345")
        self.assertEqual(self.client.get("/admin").status_code, 403)
        response = self.client.post("/admin", data={"action": "ai_settings_reset", "csrf_token": self.csrf()})
        self.assertEqual(response.status_code, 403)
        self.assertEqual(self.config().model, "custom-model")

    def test_po_worker_receives_config_only_in_memory(self):
        self.save(ai_openai_model="custom-model", ai_openai_api_key="synthetic-db-key")
        stream = io.BytesIO()
        canvas = Canvas(stream)
        canvas.drawString(72, 720, "Synthetic PO")
        canvas.save()
        stream.seek(0)
        with patch("ai_service.AIService", wraps=AIService) as service:
            response = self.client.post(
                "/api/po-imports", data={"file": (stream, "synthetic.pdf")},
                headers={"X-CSRF-Token": self.csrf()}, content_type="multipart/form-data",
            )
        self.assertEqual(response.status_code, 202)
        config = service.call_args.args[0]
        self.assertEqual(config.model, "custom-model")
        self.assertEqual(config.api_key, "synthetic-db-key")
        body = self.client.get(f"/api/po-imports/{response.get_json()['id']}").get_data(as_text=True)
        self.assertNotIn("synthetic-db-key", body)
        self.assert_env_unchanged()


if __name__ == "__main__":
    unittest.main()
