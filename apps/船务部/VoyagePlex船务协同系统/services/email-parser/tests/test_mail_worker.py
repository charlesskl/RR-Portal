"""Synthetic process/HTTP tests; Linux execution adds real address-space limits."""
import asyncio
import hashlib
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
from email.message import EmailMessage
from io import BytesIO
from unittest.mock import patch

import uvicorn
import openpyxl

from app import mail_worker
from app.main import app, poll_mailbox
from app.mail_worker import failure_headers

VALID = b"Subject: synthetic shipment\r\nFrom: fixture@example.invalid\r\n\r\nSO: SYNTHETIC-1\r\n"


def pressure_command(marker):
    # Load the real application inside the real resource-limited worker, then
    # touch incremental allocations until RLIMIT_AS rejects further growth.
    code = '''
import json,pathlib,resource,sys
from app import mail_worker as worker
original=worker._parse
def parse(raw,filename,company):
    import app.main
    if len(raw)>1024*1024:
        held=[]
        try:
            while True:held.append(bytearray(1024*1024))
        except MemoryError:
            held.clear()
            pathlib.Path(MARKER).write_text(json.dumps({"workerPeakRSSKiB":resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
                                                       "addressSpaceLimitBytes":resource.getrlimit(resource.RLIMIT_AS)[0]}))
            raise
    return original(raw,filename,company)
worker._parse=parse
company,filename=sys.argv[1:]
raw=sys.stdin.buffer.read(worker.MAX_RAW_BYTES+1)
print(json.dumps(worker.supervise(raw,filename,company)))
'''.replace("MARKER", repr(str(marker)))
    return [sys.executable, "-c", code]


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
    @unittest.skipUnless(sys.platform == "linux", "Linux actual AS/cgroup large MIME coverage")
    def test_large_mime_attachment_keeps_bytes_under_actual_worker_limits(self):
        from app.mailbox import MAX_BATCH_BYTES

        prefix = (b"From: fixture@example.invalid\r\nSubject: SYNTHETIC LARGE MIME\r\n"
                  b"MIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary=LARGE\r\n\r\n"
                  b"--LARGE\r\nContent-Type: text/plain\r\n\r\nSynthetic fixture only.\r\n"
                  b"--LARGE\r\nContent-Type: application/octet-stream\r\n"
                  b"Content-Disposition: attachment; filename=synthetic.bin\r\n"
                  b"Content-Transfer-Encoding: base64\r\n\r\n")
        line = b"QUFB" * 19 + b"\r\n"  # 57 decoded A bytes per SMTP line.
        count = (35712788 - len(prefix) - 13) // len(line)
        raw = prefix + line * count + b"\r\n--LARGE--\r\n"
        self.assertGreater(len(raw), 34 * 1024**2)
        held = b"y" * (MAX_BATCH_BYTES - len(raw) - 1024)
        self.assertEqual(len(raw) + len(held), MAX_BATCH_BYTES - 1024)
        expected = hashlib.sha256()
        remaining = count * 57
        while remaining:
            size = min(remaining, 65536)
            expected.update(b"A" * size)
            remaining -= size
        result = self.run_entry(raw, seconds=25)
        self.assertEqual(result["status"], "parsed", result.get("failure_kind"))
        self.assertEqual(result["fingerprint"], hashlib.sha256(raw).hexdigest())
        self.assertEqual(len(result["attachments"]), 1)
        self.assertEqual(result["attachments"][0]["size"], count * 57)
        self.assertEqual(result["attachments"][0]["sha256"], expected.hexdigest())
        self.assertEqual(self.run_entry(VALID)["status"], "parsed")
        self.assertEqual(mail_worker.WORKER_ADDRESS_SPACE, 320 * 1024**2)
        self.assertEqual(mail_worker.WORKER_SECONDS, 18)
        self.assertEqual(mail_worker.MAX_RESULT_BYTES, 1024**2)
        del result, raw, held

    def test_email_and_attachment_memory_errors_reach_worker_instead_of_business_failure(self):
        from app.main import parse_email_entries
        with patch("app.main.parse_eml", side_effect=MemoryError()):
            with self.assertRaises(MemoryError):
                parse_email_entries([{"filename": "synthetic.eml", "raw": VALID}], "Huadeng")
        message = EmailMessage()
        message["From"] = "fixture@example.invalid"
        message["Subject"] = "SYNTHETIC MEMORY CLASSIFICATION"
        message.set_content("Synthetic fixture only.")
        message.add_attachment(b"synthetic", maintype="application", subtype="pdf", filename="synthetic.pdf")
        with patch("app.main.parse_attachment", side_effect=MemoryError()):
            with self.assertRaises(MemoryError):
                parse_email_entries([{"filename": "synthetic.eml", "raw": message.as_bytes()}], "Huadeng")

    @unittest.skipUnless(sys.platform == "linux", "Linux actual AS/cgroup memory pressure coverage")
    def test_full_parent_and_near_48m_batch_survive_320m_worker_limit(self):
        # app.main is already loaded in this parent, including all production
        # parser libraries. Retain an actual 40MiB + almost 8MiB batch while its
        # first raw body also enters the disposable supervisor/worker pipeline.
        from app.mailbox import MAX_BATCH_BYTES, MAX_MESSAGE_BYTES
        import resource

        def cgroup_number(path):
            try:
                value = Path(path).read_text().strip()
                return int(value) if value.isdigit() else None
            except OSError:
                return None

        def oom_kills():
            try:
                events = dict(line.split() for line in Path("/sys/fs/cgroup/memory.events").read_text().splitlines())
                return int(events["oom_kill"])
            except (OSError, KeyError, ValueError):
                return None

        before_oom = oom_kills()
        batch = [b"x" * MAX_MESSAGE_BYTES, b"y" * (MAX_BATCH_BYTES - MAX_MESSAGE_BYTES - 1024)]
        self.assertEqual(sum(map(len, batch)), MAX_BATCH_BYTES - 1024)
        sock = socket.socket()
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
        sock.close()
        server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="error"))
        server_thread = threading.Thread(target=server.run, daemon=True)
        server_thread.start()
        for _ in range(100):
            if server.started:
                break
            time.sleep(.02)
        self.assertTrue(server.started)
        observed, errors = {}, []
        try:
            with tempfile.TemporaryDirectory() as temp:
                marker = Path(temp) / "resource.json"
                with patch.object(mail_worker, "WORKER_COMMAND", pressure_command(marker)):
                    def pressure():
                        try:
                            observed.update(self.run_entry(batch[0], seconds=25))
                        except BaseException as error:
                            errors.append(type(error).__name__)

                    thread = threading.Thread(target=pressure)
                    thread.start()
                    latencies = []
                    while thread.is_alive():
                        started = time.monotonic()
                        with urllib.request.urlopen(f"http://127.0.0.1:{port}/health", timeout=2) as response:
                            self.assertEqual(response.status, 200)
                        latencies.append(time.monotonic() - started)
                        time.sleep(.02)
                    thread.join(timeout=1)
                    self.assertFalse(errors)
                    self.assertEqual(observed.get("failure_kind"), "parse_memory")
                    self.assertTrue(marker.is_file())
                    evidence = json.loads(marker.read_text())
                    self.assertEqual(evidence["addressSpaceLimitBytes"], 320 * 1024**2)
                    self.assertGreater(evidence["workerPeakRSSKiB"], 240 * 1024)
                    self.assertGreater(len(latencies), 1)
                    self.assertLess(max(latencies), 1)
                    self.assertEqual(self.run_entry(VALID)["status"], "parsed")
                evidence.update({"parentPeakRSSKiB": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
                                 "batchBytesRetained": sum(map(len, batch)),
                                 "cgroupMemoryMaxBytes": cgroup_number("/sys/fs/cgroup/memory.max"),
                                 "cgroupMemoryPeakBytes": cgroup_number("/sys/fs/cgroup/memory.peak"),
                                 "oomKillsBefore": before_oom, "oomKillsAfter": oom_kills(),
                                 "maxHealthSeconds": round(max(latencies), 4), "nextMailParsed": True})
                self.assertEqual(evidence["oomKillsAfter"], before_oom)
                if evidence["cgroupMemoryMaxBytes"] == 512 * 1024**2 and evidence["cgroupMemoryPeakBytes"] is not None:
                    self.assertLess(evidence["cgroupMemoryPeakBytes"], 512 * 1024**2)
                print("synthetic-full-parent-memory-evidence=" + json.dumps(evidence, sort_keys=True))
        finally:
            server.should_exit = True
            server_thread.join(timeout=5)
            batch.clear()

    def test_actual_worker_parses_excel_and_pdf_attachments_with_business_content(self):
        book = openpyxl.Workbook()
        sheet = book.active
        sheet.title = "Packing List"
        sheet.append(["ITEM NO", "DESCRIPTION", "QTY", "CTNS", "CBM"])
        sheet.append(["SYNTHETIC-A1", "SYNTHETIC TOY", 100, 10, 1.5])
        excel = BytesIO()
        book.save(excel)
        book.close()
        text = b"BT /F1 12 Tf 50 750 Td (PLACE OF DELIVERY: ELWOOD) Tj ET"
        objects = [b"<< /Type /Catalog /Pages 2 0 R >>",
                   b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
                   b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
                   b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
                   b"<< /Length " + str(len(text)).encode() + b" >>\nstream\n" + text + b"\nendstream"]
        pdf = bytearray(b"%PDF-1.4\n")
        offsets = [0]
        for index, obj in enumerate(objects, 1):
            offsets.append(len(pdf))
            pdf.extend(str(index).encode() + b" 0 obj\n" + obj + b"\nendobj\n")
        xref = len(pdf)
        pdf.extend(b"xref\n0 6\n0000000000 65535 f \n")
        for offset in offsets[1:]:
            pdf.extend(f"{offset:010d} 00000 n \n".encode())
        pdf.extend(b"trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n" + str(xref).encode() + b"\n%%EOF\n")
        for name, content, subtype in (("packing.xlsx", excel.getvalue(), "vnd.openxmlformats-officedocument.spreadsheetml.sheet"), ("booking.pdf", bytes(pdf), "pdf")):
            with self.subTest(attachment=name):
                message = EmailMessage()
                message["From"] = "fixture@example.invalid"
                message["Subject"] = "SYNTHETIC SHIPMENT"
                message.set_content("Please see the synthetic attachment.")
                message.add_attachment(content, maintype="application", subtype=subtype, filename=name)
                result = self.run_entry(message.as_bytes())
                self.assertEqual(result["status"], "parsed", result.get("failure_kind"))
                details = result["attachment_results"]
                self.assertEqual(len(details), 1)
                self.assertNotEqual(details[0].get("status"), "failed")
                if name.endswith("xlsx"):
                    self.assertEqual(details[0]["kind"], "packing_list")
                    self.assertEqual(result["items"][0]["product_code"], "SYNTHETIC-A1")
                    self.assertEqual(result["items"][0]["quantity"], 100)
                else:
                    self.assertEqual(details[0]["kind"], "booking_pdf")
                    self.assertEqual(details[0]["fields"]["delivery_address"], "ELWOOD")

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
