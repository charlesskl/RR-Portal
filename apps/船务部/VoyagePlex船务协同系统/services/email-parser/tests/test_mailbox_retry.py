"""Only synthetic IMAP data; retry never searches or changes a mailbox cursor."""
import asyncio
import imaplib
import socket
import socketserver
import threading
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

from app.main import app, poll_mailbox
from app.mailbox import (BatchLiteralBudget, BoundedImap, MailboxUidValidityChanged,
                         MAX_MESSAGE_BYTES, OversizedLiteral, fetch_mailbox)


CREDENTIALS = {"address": "fixture@example.invalid", "auth_code": "synthetic-private-code",
               "host": "imap.163.com", "folder": "INBOX"}
REQUEST = {**CREDENTIALS, "company": "Huadeng", "after_uid": 999,
           "selected_uids": [12, 11], "expected_uid_validity": 123}
RAW = b"Subject: SYNTHETIC RETRY\r\nFrom: fixture@example.invalid\r\n\r\nSO: SYNTHETIC-1\r\n"


class RetryImap:
    def __init__(self, *_args, **_kwargs):
        self.sock = self
        self.commands = []
        self.validity = 123

    def settimeout(self, _seconds):
        pass

    def shutdown(self, *_args):
        pass

    def login(self, *_args):
        pass

    def select(self, folder, readonly=False):
        assert folder == "INBOX" and readonly
        return "OK", [b"2"]

    def response(self, _name):
        return "UIDVALIDITY", [str(self.validity).encode()]

    def uid(self, command, *args):
        self.commands.append((command, args))
        assert command == "FETCH", "retry must never SEARCH"
        uid = str(args[0]).encode()
        if args[1] == "(INTERNALDATE RFC822.SIZE)":
            return "OK", [b'1 (UID ' + uid + b' INTERNALDATE "19-Oct-2026 09:30:00 +0800" RFC822.SIZE ' + str(len(RAW)).encode() + b')']
        return "OK", [(b'1 (BODY[] {' + str(len(RAW)).encode() + b'}', RAW), b' UID ' + uid + b')']


class MailboxRetryTests(unittest.TestCase):
    def test_selected_uids_are_exact_sorted_and_ignore_normal_cursor_and_start_date(self):
        fake = RetryImap()
        with patch("app.mailbox.BoundedImap", return_value=fake):
            result = fetch_mailbox(999, "unused-for-retry", "Huadeng", CREDENTIALS,
                                   selected_uids=[12, 11], expected_uid_validity=123)
        self.assertEqual([entry["uid"] for entry in result["messages"]], [11, 12])
        self.assertEqual(fake.commands, [("FETCH", (str(uid), fields)) for uid in (11, 12)
                          for fields in ("(INTERNALDATE RFC822.SIZE)", "(BODY.PEEK[])" )])

    def test_uid_validity_mismatch_or_missing_is_refused_before_any_fetch(self):
        for validity in (124, 0):
            with self.subTest(validity=validity):
                fake = RetryImap()
                fake.validity = validity
                with patch("app.mailbox.BoundedImap", return_value=fake):
                    with self.assertRaises(MailboxUidValidityChanged):
                        fetch_mailbox(credentials=CREDENTIALS, selected_uids=[11], expected_uid_validity=123)
                self.assertEqual(fake.commands, [])

    def test_literal_cap_distinguishes_terminal_size_from_remaining_batch_budget(self):
        client = object.__new__(BoundedImap)
        client.literal_limit = 10
        with self.assertRaises(OversizedLiteral):
            client.read(MAX_MESSAGE_BYTES + 1)
        with self.assertRaises(BatchLiteralBudget):
            client.read(11)
        with patch.object(imaplib.IMAP4, "read", side_effect=[b"123456", b"1234"]):
            self.assertEqual(client.read(6), b"123456")
            self.assertEqual(client.literal_limit, 4)
            self.assertEqual(client.read(4), b"1234")
            self.assertEqual(client.literal_limit, 0)
            with self.assertRaises(BatchLiteralBudget):
                client.read(1)

    def test_remaining_batch_budget_defers_uid_without_a_failed_item(self):
        fake = RetryImap()
        original = fake.uid

        def uid(command, *args):
            if args[1] == "(BODY.PEEK[])":
                raise BatchLiteralBudget()
            return original(command, *args)

        fake.uid = uid
        with patch("app.mailbox.BoundedImap", return_value=fake):
            result = fetch_mailbox(credentials=CREDENTIALS, selected_uids=[11], expected_uid_validity=123)
        self.assertEqual(result["messages"], [])
        self.assertIsNone(result["blocked_uid"])

    def test_body_errors_keep_real_date_retryable_while_absolute_oversize_is_terminal(self):
        for error in (RuntimeError(), OSError(), TimeoutError(), OversizedLiteral()):
            with self.subTest(error=type(error).__name__):
                fake = RetryImap()
                original = fake.uid

                def uid(command, *args):
                    if args[1] == "(BODY.PEEK[])":
                        raise error
                    return original(command, *args)

                fake.uid = uid
                with patch("app.mailbox.BoundedImap", return_value=fake):
                    result = fetch_mailbox(credentials=CREDENTIALS, selected_uids=[11, 12], expected_uid_validity=123)
                item = result["messages"][0]
                terminal = isinstance(error, OversizedLiteral)
                self.assertEqual(item["failure_kind"], "message_size" if terminal else "body_read")
                self.assertEqual(item["retryable"], not terminal)
                self.assertEqual(item["received_at"], "2026-10-19T01:30:00+00:00")
                self.assertEqual(result["blocked_uid"], None if terminal else 11)
                self.assertEqual([entry["uid"] for entry in result["messages"]], [11])

    def test_size_mismatch_is_pending_evidence_not_accepted_as_complete_raw(self):
        fake = RetryImap()
        original = fake.uid

        def uid(command, *args):
            status, parts = original(command, *args)
            if args[1] == "(BODY.PEEK[])":
                return status, [(b'1 (UID 11 BODY[] {1}', b"x"), b')']
            return status, parts

        fake.uid = uid
        with patch("app.mailbox.BoundedImap", return_value=fake):
            result = fetch_mailbox(credentials=CREDENTIALS, selected_uids=[11], expected_uid_validity=123)
        self.assertEqual(result["blocked_uid"], 11)
        self.assertTrue(result["messages"][0]["retryable"])
        self.assertIsNone(result["messages"][0]["raw"])

    def test_retry_validation_is_strict_and_does_not_echo_credentials(self):
        invalid = ([], [1] * 2, list(range(1, 7)), [0], [-1], [4294967296],
                   [True], [1.0], ["11"], None)
        with TestClient(app) as client, patch("app.main.fetch_mailbox") as fetch:
            for selected in invalid:
                with self.subTest(selected=selected):
                    response = client.post("/v1/mailbox/retry", json={**REQUEST, "selected_uids": selected})
                    self.assertEqual(response.status_code, 422)
                    self.assertNotIn(CREDENTIALS["auth_code"], response.text)
            for validity in (None, 0, -1, True, 123.0, "123", 4294967296):
                with self.subTest(validity=validity):
                    response = client.post("/v1/mailbox/retry", json={**REQUEST, "expected_uid_validity": validity})
                    self.assertEqual(response.status_code, 422)
                    self.assertNotIn(CREDENTIALS["auth_code"], response.text)
            missing = dict(REQUEST)
            missing.pop("expected_uid_validity")
            # FastAPI's standard missing-field validation includes the entire
            # body, so the endpoint's validation handler must redact secrets.
            response = client.post("/v1/mailbox/retry", json=missing)
            self.assertEqual(response.status_code, 422)
            self.assertNotIn(CREDENTIALS["auth_code"], response.text)
            fetch.assert_not_called()

    def test_retry_uid_validity_http_conflict_is_static_and_gate_is_released(self):
        fake = RetryImap()
        fake.validity = 124
        with TestClient(app) as client, patch("app.mailbox.BoundedImap", return_value=fake):
            response = client.post("/v1/mailbox/retry", json=REQUEST)
            self.assertEqual(response.status_code, 409)
            self.assertNotIn(CREDENTIALS["auth_code"], response.text)
            self.assertEqual(fake.commands, [])
            self.assertEqual(client.get("/health").status_code, 200)
            self.assertEqual(client.post("/v1/mailbox/retry", json=REQUEST).status_code, 409)

    def test_retry_real_wire_excludes_unsolicited_uids_and_recovers_transient_failure(self):
        commands, body_calls = [], []
        foreign = b"Subject: FOREIGN-SYNTHETIC\r\n\r\nWrong UID"

        class Handler(socketserver.StreamRequestHandler):
            def handle(self):
                self.wfile.write(b"* OK synthetic retry fixture\r\n")
                try:
                    while line := self.rfile.readline():
                        tag, command, *args = line.decode().strip().split(" ", 2)
                        commands.append((command, args))
                        if command == "CAPABILITY":
                            self.wfile.write(b"* CAPABILITY IMAP4rev1 ID\r\n")
                        elif command == "ID":
                            self.wfile.write(b"* ID NIL\r\n")
                        elif command == "EXAMINE":
                            self.wfile.write(b"* 3 EXISTS\r\n* OK [UIDVALIDITY 123] stable\r\n")
                        elif command == "UID":
                            self.assert_fetch(args[0])
                            uid = args[0].split()[1].encode()
                            self.wfile.write(b'* 7 FETCH (UID 777 FLAGS (\\Seen))\r\n')
                            self.wfile.write(b'* 1 FETCH (UID ' + uid + b' FLAGS (\\Seen))\r\n')
                            if "RFC822.SIZE" in args[0]:
                                self.wfile.write(b'* 7 FETCH (UID 777 INTERNALDATE "19-Oct-2026 08:00:00 +0800" RFC822.SIZE 1)\r\n')
                                self.wfile.write(b'* 1 FETCH (INTERNALDATE "19-Oct-2026 09:30:00 +0800" RFC822.SIZE ' + str(len(RAW)).encode() + b' UID ' + uid + b')\r\n')
                            else:
                                body_calls.append(int(uid))
                                if len(body_calls) == 1:
                                    self.wfile.write(f"{tag} NO synthetic transient\r\n".encode())
                                    continue
                                self.wfile.write(b'* 7 FETCH (UID 777 BODY[] {' + str(len(foreign)).encode() + b'}\r\n' + foreign + b')\r\n')
                                self.wfile.write(b'* 1 FETCH (BODY[] {' + str(len(RAW)).encode() + b'}\r\n' + RAW + b' UID ' + uid + b')\r\n')
                        self.wfile.write(f"{tag} OK complete\r\n".encode())
                except OSError:
                    pass

            def assert_fetch(self, argument):
                if not argument.startswith("FETCH "):
                    raise AssertionError("retry searched instead of exact FETCH")

        class Server(socketserver.ThreadingTCPServer):
            daemon_threads = True

        server = Server(("127.0.0.1", 0), Handler)
        serving = threading.Thread(target=server.serve_forever, kwargs={"poll_interval": .01}, daemon=True)
        serving.start()

        def transport(_client, timeout):
            return socket.create_connection(server.server_address, timeout)

        try:
            with TestClient(app) as client, patch.object(BoundedImap, "_create_socket", transport):
                first = client.post("/v1/mailbox/retry", json={**REQUEST, "selected_uids": [11]}).json()
                self.assertEqual(first["blocked_uid"], 11)
                self.assertEqual(first["items"][0]["failure_kind"], "body_read")
                self.assertTrue(first["items"][0]["retryable"])
                self.assertEqual(first["items"][0]["mailbox_received_at"], "2026-10-19T01:30:00+00:00")
                second = client.post("/v1/mailbox/retry", json=REQUEST).json()
                self.assertEqual(second["uid_validity"], 123)
                self.assertEqual(second["address"], CREDENTIALS["address"])
                self.assertIsNone(second["blocked_uid"])
                self.assertEqual([item["mailbox_uid"] for item in second["items"]], [11, 12])
                self.assertTrue(all(item["status"] == "parsed" for item in second["items"]))
                self.assertTrue(all(item["message"]["subject"] == "SYNTHETIC RETRY" for item in second["items"]))
                self.assertEqual(client.get("/health").status_code, 200)
            self.assertEqual(body_calls, [11, 11, 12])
            self.assertFalse(any(name in {"STORE", "SELECT", "EXPUNGE"} for name, args in commands))
            self.assertFalse(any(name == "UID" and args[0].startswith("SEARCH") for name, args in commands))
            self.assertTrue(any(name == "ID" for name, args in commands))
        finally:
            server.shutdown()
            server.server_close()
            serving.join(timeout=2)


class RetryGateTests(unittest.IsolatedAsyncioTestCase):
    async def test_retry_and_poll_share_one_gate_and_pending_socket_cancellation(self):
        started, release = threading.Event(), threading.Event()
        calls = []

        def fetch(*args):
            calls.append(args)
            started.set()
            release.wait(5)
            return {"configured": False, "messages": []}

        with patch("app.main.fetch_mailbox", fetch):
            task = asyncio.create_task(poll_mailbox(credentials=CREDENTIALS, selected_uids=[11], expected_uid_validity=123))
            try:
                for _ in range(100):
                    if started.is_set():
                        break
                    await asyncio.sleep(.01)
                self.assertTrue(started.is_set())
                self.assertEqual((await poll_mailbox()).status_code, 429)
                self.assertEqual((await poll_mailbox(credentials=CREDENTIALS, selected_uids=[12], expected_uid_validity=123)).status_code, 429)
                task.cancel()
                await asyncio.sleep(.05)
                self.assertEqual((await poll_mailbox()).status_code, 429)
                self.assertEqual(len(calls), 1)
            finally:
                release.set()
                with self.assertRaises(asyncio.CancelledError):
                    await task
        with patch("app.main.fetch_mailbox", return_value={"configured": False, "messages": []}):
            self.assertFalse((await poll_mailbox())["configured"])

    async def test_known_date_transient_failure_is_still_a_barrier(self):
        mailbox = {"configured": True, "address": CREDENTIALS["address"], "uid_validity": 123,
                   "messages": [{"uid": 11, "received_at": "2026-10-19T01:30:00+00:00", "raw": None,
                                 "error": "synthetic body unavailable", "failure_kind": "body_read", "retryable": True},
                                {"uid": 12, "received_at": "2026-10-19T01:31:00+00:00", "raw": RAW, "error": ""}]}
        with patch("app.main.fetch_mailbox", return_value=mailbox):
            result = await poll_mailbox()
        self.assertEqual(result["blocked_uid"], 11)
        self.assertEqual([item["mailbox_uid"] for item in result["items"]], [11])

