import json
import sys
import threading
import time
import unittest
import urllib.request
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parents[1]))

import uvicorn

from app.main import app, parse_email_entries, poll_mailbox

SLOW_SECONDS = 0.6
VALID_EML = b"Subject: shipment notice\r\nFrom: factory@example.com\r\n\r\nhello"
BASE_URL = "http://127.0.0.1:18099"


def slow_fetch_mailbox(after_uid=0):
    time.sleep(SLOW_SECONDS)
    return {"configured": True, "address": "shipping@example.com", "uid_validity": 123,
            "messages": [{"uid": 11, "received_at": "2026-09-17T16:30:00+00:00",
                          "raw": VALID_EML, "error": ""}]}


def slow_parse_email_entries(entries):
    time.sleep(SLOW_SECONDS)
    return {"items": [{"index": index, "filename": entry["filename"], "status": "parsed"}
                      for index, entry in enumerate(entries)]}


class PollMailboxHealthTests(unittest.TestCase):
    def test_health_stays_responsive_during_slow_mailbox_poll(self):
        """真实 uvicorn 服务下模拟慢 IMAP + 慢附件解析，/health 必须毫秒级响应。

        与生产拓扑一致（单 worker 单事件循环，docker 从进程外探测 /health）。
        修复前 fetch/parse 在事件循环里执行，此测试 /health 会被阻塞约
        2 * SLOW_SECONDS，复现生产健康检查超时。
        """
        with patch("app.main.fetch_mailbox", slow_fetch_mailbox), \
                patch("app.main.parse_email_entries", slow_parse_email_entries):
            server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=18099, log_level="error"))
            server_thread = threading.Thread(target=server.run, daemon=True)
            server_thread.start()
            for _ in range(100):
                if server.started:
                    break
                time.sleep(0.05)
            self.assertTrue(server.started)
            try:
                poll_body = {}

                def call_poll():
                    with urllib.request.urlopen(f"{BASE_URL}/v1/mailbox/poll?after_uid=0") as response:
                        poll_body["payload"] = json.loads(response.read())

                poll_thread = threading.Thread(target=call_poll, daemon=True)
                poll_thread.start()
                time.sleep(0.1)  # 确保 poll 已进入慢处理阶段
                started = time.monotonic()
                with urllib.request.urlopen(f"{BASE_URL}/health") as health:
                    self.assertEqual(health.status, 200)
                latency = time.monotonic() - started
                poll_thread.join(timeout=10)
            finally:
                server.should_exit = True
                server_thread.join(timeout=10)
        self.assertLess(latency, 0.4)
        payload = poll_body["payload"]
        self.assertTrue(payload["configured"])
        self.assertEqual(payload["items"][0]["mailbox_uid"], 11)


class PollMailboxTests(unittest.IsolatedAsyncioTestCase):
    async def test_failed_message_is_reported_without_aborting_poll(self):
        mailbox = {"configured": True, "address": "shipping@example.com", "uid_validity": 123,
                   "messages": [{"uid": 12, "received_at": "", "raw": None,
                                 "error": "邮件读取失败：读取邮件 12 失败"}]}
        with patch("app.main.fetch_mailbox", return_value=mailbox):
            result = await poll_mailbox(0)
        self.assertTrue(result["configured"])
        self.assertEqual(len(result["items"]), 1)
        item = result["items"][0]
        self.assertEqual(item["status"], "failed")
        self.assertEqual(item["mailbox_uid"], 12)
        self.assertIn("邮件读取失败", item["error"])


class ParseEmailEntriesTests(unittest.TestCase):
    def test_single_bad_message_does_not_abort_batch(self):
        entries = [
            {"filename": "mail-1.eml", "raw": b""},
            {"filename": "mail-2.eml", "raw": VALID_EML},
        ]
        result = parse_email_entries(entries)
        self.assertEqual(result["total"], 2)
        self.assertEqual(result["failed"], 1)
        self.assertEqual(result["parsed"], 1)
        self.assertEqual(result["items"][0]["status"], "failed")
        self.assertEqual(result["items"][1]["status"], "parsed")


if __name__ == "__main__":
    unittest.main()
