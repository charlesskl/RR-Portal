"""Synthetic process/HTTP tests; Linux execution adds real address-space limits."""
import asyncio
import json
import os
from pathlib import Path
import socket
import sys
import tempfile
import threading
import time
import unittest
import urllib.request
from unittest.mock import patch

import uvicorn

from app import mail_worker
from app.main import app, poll_mailbox
from app.mail_worker import failure_headers

VALID = b"Subject: synthetic shipment\r\nFrom: fixture@example.invalid\r\n\r\nSO: SYNTHETIC-1\r\n"


def controlled_command(pid_file):
    # Test-only child injection. Production always executes the fixed module.
    code = '''
import json,os,pathlib,subprocess,sys,time
from app import mail_worker as worker
worker.WORKER_SECONDS=.65
def parse(raw,filename,company):
    if raw==b"memory":
        value=bytearray(400*1024*1024)
    if raw in (b"spin",b"descendant"):
        if raw==b"descendant":
            child=subprocess.Popen([sys.executable,"-c","import time;time.sleep(60)"],start_new_session=True)
            pathlib.Path(PID_FILE).write_text(str(child.pid))
        while True: pass
    if raw==b"large-result":
        return {"filename":filename,"status":"parsed","data":"x"*(2*1024*1024)}
    return {"filename":filename,"status":"parsed"}
worker._parse=parse
company,filename=sys.argv[1:]
raw=sys.stdin.buffer.read(worker.MAX_RAW_BYTES+1)
print(json.dumps(worker.supervise(raw,filename,company)))
'''.replace("PID_FILE", repr(str(pid_file)))
    return [sys.executable, "-c", code]


class MailWorkerTests(unittest.TestCase):
    def test_failure_headers_are_bounded_identifiers_without_body(self):
        raw = b"From: fixture@example.invalid\r\nSubject: =?utf-8?b?5rWL6K+V?=\r\nMessage-ID: <synthetic>\r\n\r\nPRIVATE-SYNTHETIC-BODY"
        result = failure_headers(raw)
        self.assertEqual(result["message"]["subject"], "测试")
        self.assertEqual(result["message"]["sender"], "fixture@example.invalid")
        self.assertEqual(len(result["fingerprint"]), 64)
        self.assertNotIn("PRIVATE-SYNTHETIC-BODY", json.dumps(result))
        self.assertLessEqual(len(failure_headers(b"Subject: " + b"x" * 100000)["message"]["subject"]), 512)

    def run_entry(self, raw, cancelled=None, seconds=10):
        return mail_worker.parse_isolated(raw, "mail-11.eml", "Huadeng", cancelled or threading.Event(), time.monotonic() + seconds)

    def test_real_normal_mail_repeatedly_parses_in_disposable_processes(self):
        for _ in range(3):
            result = self.run_entry(VALID)
            self.assertEqual(result["status"], "parsed", result.get("failure_kind"))
            self.assertEqual(result["filename"], "mail-11.eml")

    def test_cpu_timeout_and_result_size_are_isolated_then_next_mail_succeeds(self):
        with tempfile.TemporaryDirectory() as temp, patch.object(mail_worker, "WORKER_COMMAND", controlled_command(Path(temp) / "pid")):
            start = time.monotonic()
            result = self.run_entry(b"spin")
            self.assertEqual(result["failure_kind"], "parse_timeout")
            self.assertLess(time.monotonic() - start, 4)
            self.assertEqual(self.run_entry(b"large-result")["failure_kind"], "parse_result_size")
            self.assertEqual(self.run_entry(b"normal")["status"], "parsed")

    @unittest.skipUnless(sys.platform == "linux", "Linux RLIMIT_AS and subreaper coverage")
    def test_memory_cap_and_detached_native_descendant_are_killed_and_reaped(self):
        with tempfile.TemporaryDirectory() as temp:
            marker = Path(temp) / "pid"
            with patch.object(mail_worker, "WORKER_COMMAND", controlled_command(marker)):
                self.assertEqual(self.run_entry(b"memory")["failure_kind"], "parse_memory")
                self.assertEqual(self.run_entry(b"descendant")["failure_kind"], "parse_timeout")
                pid = int(marker.read_text())
                with self.assertRaises(ProcessLookupError):
                    os.kill(pid, 0)
                self.assertEqual(self.run_entry(b"normal")["status"], "parsed")

    def test_cancellation_terminates_worker_and_cleans_private_temp(self):
        cancelled = threading.Event()
        real_temporary_directory = tempfile.TemporaryDirectory
        created = []

        def private_temp(*args, **kwargs):
            result = real_temporary_directory(*args, **kwargs)
            created.append(Path(result.name))
            return result

        with tempfile.TemporaryDirectory() as temp, patch.object(mail_worker, "WORKER_COMMAND", controlled_command(Path(temp) / "pid")), patch.object(mail_worker.tempfile, "TemporaryDirectory", side_effect=private_temp):
            timer = threading.Timer(.15, cancelled.set)
            timer.start()
            try:
                start = time.monotonic()
                result = self.run_entry(b"spin", cancelled)
            finally:
                timer.cancel()
            self.assertEqual(result["failure_kind"], "parse_cancelled")
            self.assertLess(time.monotonic() - start, 3)
            self.assertTrue(created)
            self.assertTrue(all(not directory.exists() for directory in created))

    def test_real_http_health_during_cpu_bound_worker_and_next_poll(self):
        sock = socket.socket()
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
        sock.close()
        server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="error"))
        thread = threading.Thread(target=server.run, daemon=True)
        thread.start()
        for _ in range(100):
            if server.started:
                break
            time.sleep(.02)
        self.assertTrue(server.started)
        received, failures = {}, []

        def fetch(*_):
            return {"configured": True, "address": "fixture@example.invalid", "uid_validity": 123,
                    "messages": [{"uid": 11, "received_at": "2026-10-19T01:00:00+00:00", "raw": b"spin", "error": ""}]}

        def request_poll():
            try:
                with urllib.request.urlopen(f"http://127.0.0.1:{port}/v1/mailbox/poll", timeout=10) as response:
                    received.update(json.load(response))
            except BaseException as error:
                failures.append(type(error).__name__)

        try:
            with tempfile.TemporaryDirectory() as temp, patch("app.main.fetch_mailbox", fetch), patch.object(mail_worker, "WORKER_COMMAND", controlled_command(Path(temp) / "pid")):
                poll = threading.Thread(target=request_poll)
                poll.start()
                latencies = []
                while poll.is_alive():
                    start = time.monotonic()
                    with urllib.request.urlopen(f"http://127.0.0.1:{port}/health", timeout=2) as response:
                        self.assertEqual(response.status, 200)
                    latencies.append(time.monotonic() - start)
                    time.sleep(.03)
                poll.join(timeout=1)
                self.assertFalse(failures)
                self.assertGreaterEqual(len(latencies), 3)
                self.assertLess(max(latencies), .5)
                self.assertEqual(received["items"][0]["failure_kind"], "parse_timeout")
            # Follow the failed poll with the actual production worker/parser.
            mailbox = fetch()
            mailbox["messages"][0]["raw"] = VALID
            with patch("app.main.fetch_mailbox", return_value=mailbox):
                received.clear()
                request_poll()
                self.assertFalse(failures)
                self.assertEqual(received["items"][0]["status"], "parsed")
        finally:
            server.should_exit = True
            thread.join(timeout=5)


class RetryBarrierTests(unittest.IsolatedAsyncioTestCase):
    async def test_concurrent_poll_is_busy_and_cancelled_fetch_holds_gate_until_exit(self):
        started, release = threading.Event(), threading.Event()
        calls = []

        def fetch(*_):
            calls.append(1)
            started.set()
            release.wait(5)
            return {"configured": False, "messages": []}

        with patch("app.main.fetch_mailbox", fetch):
            first = asyncio.create_task(poll_mailbox())
            try:
                for _ in range(100):
                    if started.is_set():
                        break
                    await asyncio.sleep(.01)
                self.assertTrue(started.is_set())
                self.assertEqual((await poll_mailbox()).status_code, 429)
                first.cancel()
                await asyncio.sleep(.1)
                self.assertEqual((await poll_mailbox()).status_code, 429)
                self.assertEqual(len(calls), 1)
            finally:
                release.set()
                with self.assertRaises(asyncio.CancelledError):
                    await first
        with patch("app.main.fetch_mailbox", return_value={"configured": False, "messages": []}):
            self.assertFalse((await poll_mailbox())["configured"])

    async def test_poll_cancellation_waits_for_disposable_worker_then_next_poll_succeeds(self):
        def mailbox(raw):
            return {"configured": True, "address": "fixture@example.invalid", "uid_validity": 1,
                    "messages": [{"uid": 11, "received_at": "2026-10-19T01:00:00Z", "raw": raw, "error": ""}]}

        with tempfile.TemporaryDirectory() as temp, patch.object(mail_worker, "WORKER_COMMAND", controlled_command(Path(temp) / "pid")), patch("app.main.fetch_mailbox", return_value=mailbox(b"spin")):
            task = asyncio.create_task(poll_mailbox())
            await asyncio.sleep(.2)
            start = time.monotonic()
            task.cancel()
            with self.assertRaises(asyncio.CancelledError):
                await task
            self.assertLess(time.monotonic() - start, 3)
        with patch("app.main.fetch_mailbox", return_value=mailbox(VALID)):
            result = await poll_mailbox()
        self.assertEqual(result["items"][0]["status"], "parsed")

    async def test_unknown_date_cannot_return_a_later_uid(self):
        mailbox = {"configured": True, "address": "fixture@example.invalid", "uid_validity": 1,
                   "messages": [{"uid": 11, "received_at": "", "raw": None, "error": "metadata unavailable", "retryable": True},
                                {"uid": 12, "received_at": "2026-10-19T01:00:00Z", "raw": VALID, "error": ""}]}
        with patch("app.main.fetch_mailbox", return_value=mailbox):
            result = await poll_mailbox()
        self.assertEqual(result["blocked_uid"], 11)
        self.assertEqual([item["mailbox_uid"] for item in result["items"]], [11])
        self.assertTrue(result["items"][0]["retryable"])
