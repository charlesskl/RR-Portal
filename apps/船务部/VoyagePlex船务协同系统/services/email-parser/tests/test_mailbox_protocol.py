import imaplib
import socketserver
import socket
import threading
import time
import unittest
from unittest.mock import patch

from app.mailbox import BoundedImap, MailboxControl, fetch_mailbox, test_mailbox_connection


class MailboxProtocolTests(unittest.TestCase):
    def test_constructor_greeting_and_capability_drip_and_caller_cancel(self):
        for scenario in ("greeting", "capability", "cancel"):
            with self.subTest(scenario=scenario):
                accepted, finished = threading.Event(), threading.Event()

                class Handler(socketserver.StreamRequestHandler):
                    def handle(self):
                        accepted.set()
                        try:
                            welcome = b"* OK synthetic slow constructor greeting\r\n"
                            if scenario in ("greeting", "cancel"):
                                for byte in welcome:
                                    self.wfile.write(bytes([byte]))
                                    self.wfile.flush()
                                    time.sleep(.02)
                            else:
                                self.wfile.write(welcome)
                            while line := self.rfile.readline():
                                tag, command, *_ = line.decode().split(" ")
                                if command == "CAPABILITY\r\n" or command == "CAPABILITY":
                                    for byte in b"* CAPABILITY IMAP4rev1 ID\r\n":
                                        self.wfile.write(bytes([byte]))
                                        self.wfile.flush()
                                        time.sleep(.02)
                                self.wfile.write(f"{tag} OK complete\r\n".encode())
                        except OSError:
                            pass
                        finally:
                            finished.set()

                class Server(socketserver.ThreadingTCPServer):
                    daemon_threads = True

                server = Server(("127.0.0.1", 0), Handler)
                serving = threading.Thread(target=server.serve_forever, kwargs={"poll_interval": .01}, daemon=True)
                serving.start()
                control = MailboxControl()
                errors = []

                def transport(_client, timeout):
                    return socket.create_connection(("127.0.0.1", server.server_address[1]), timeout)

                def read():
                    try:
                        fetch_mailbox(credentials={"address": "fixture@example.invalid", "auth_code": "synthetic", "host": "imap.163.com", "folder": "INBOX"}, control=control)
                    except Exception as error:
                        errors.append(type(error).__name__)

                try:
                    with patch.object(BoundedImap, "_create_socket", transport), patch("app.mailbox.FETCH_BUDGET_SECONDS", 5 if scenario == "cancel" else .12):
                        start = time.monotonic()
                        thread = threading.Thread(target=read)
                        thread.start()
                        self.assertTrue(accepted.wait(1))
                        if scenario == "cancel":
                            time.sleep(.03)
                            control.cancel()
                        thread.join(timeout=1)
                        self.assertFalse(thread.is_alive())
                        self.assertLess(time.monotonic() - start, 1)
                        self.assertTrue(errors)
                        self.assertTrue(finished.wait(1))
                finally:
                    control.cancel()
                    server.shutdown()
                    server.server_close()
                    serving.join(timeout=2)

    def test_real_wire_trailing_uid_unsolicited_fetch_and_continuous_drip_deadline(self):
        raw = b"Subject: synthetic wire\r\nFrom: fixture@example.invalid\r\n\r\n" + b"x" * 100
        for scenario in ("uid-before", "uid-after", "size-plus-two", "size-plus-one",
                         "size-plus-three", "size-minus-two", "truncated",
                         "ambiguous", "multiple-literals", "drip"):
            with self.subTest(scenario=scenario):
                class Handler(socketserver.StreamRequestHandler):
                    def handle(self):
                        self.wfile.write(b"* OK synthetic wire\r\n")
                        try:
                            while line := self.rfile.readline():
                                tag, command, *args = line.decode().strip().split(" ", 2)
                                if command == "CAPABILITY":
                                    self.wfile.write(b"* CAPABILITY IMAP4rev1 ID\r\n")
                                elif command == "ID":
                                    self.wfile.write(b"* ID NIL\r\n")
                                elif command == "EXAMINE":
                                    self.wfile.write(b"* 2 EXISTS\r\n* OK [UIDVALIDITY 123] stable\r\n")
                                elif command == "UID":
                                    if args[0].startswith("SEARCH"):
                                        self.wfile.write(b"* SEARCH 11 12\r\n")
                                    elif "RFC822.SIZE" in args[0]:
                                        uid = args[0].split()[1].encode()
                                        self.wfile.write(b'* 1 FETCH (UID ' + uid + b' FLAGS (\\Seen))\r\n')
                                        delta = {"size-plus-two": 2, "size-plus-one": 1,
                                                 "size-plus-three": 3, "size-minus-two": -2}.get(scenario, 0)
                                        self.wfile.write(b'* 1 FETCH (INTERNALDATE "19-Oct-2026 09:30:00 +0800" RFC822.SIZE ' + str(len(raw) + delta).encode() + b' UID ' + uid + b')\r\n')
                                    else:
                                        uid = args[0].split()[1].encode()
                                        # A different unsolicited FETCH must not donate its UID/body.
                                        self.wfile.write(b"* 7 FETCH (UID 777 FLAGS (\\Seen))\r\n")
                                        self.wfile.write(b'* 1 FETCH (UID ' + uid + b' FLAGS (\\Seen))\r\n')
                                        if scenario == "ambiguous":
                                            self.wfile.write(b'* 1 FETCH (UID ' + uid + b' BODY[] {' + str(len(raw)).encode() + b'}\r\n' + raw + b')\r\n')
                                        prefix = b'UID ' + uid + b' ' if scenario == "uid-before" else b''
                                        self.wfile.write(b'* 1 FETCH (' + prefix + b'BODY[] {' + str(len(raw)).encode() + b'}\r\n')
                                        if scenario == "truncated":
                                            self.wfile.write(raw[:len(raw) // 2])
                                            self.wfile.flush()
                                            return  # EOF before the promised literal is complete.
                                        elif scenario == "drip":
                                            for byte in raw:
                                                self.wfile.write(bytes([byte]))
                                                self.wfile.flush()
                                                time.sleep(.02)  # Never idle for the socket timeout.
                                        else:
                                            self.wfile.write(raw)
                                        if scenario == "multiple-literals":
                                            self.wfile.write(b' BODY[] {' + str(len(raw)).encode() + b'}\r\n' + raw)
                                        suffix = b' UID ' + uid if scenario != "uid-before" else b''
                                        self.wfile.write(suffix + b')\r\n')
                                self.wfile.write(f"{tag} OK complete\r\n".encode())
                        except (OSError, ValueError):
                            pass

                server = socketserver.TCPServer(("127.0.0.1", 0), Handler)
                thread = threading.Thread(target=server.serve_forever, kwargs={"poll_interval": .01}, daemon=True)
                thread.start()

                def transport(_client, timeout):
                    return socket.create_connection(("127.0.0.1", server.server_address[1]), timeout)

                try:
                    with patch.object(BoundedImap, "_create_socket", transport), patch("app.mailbox.FETCH_BUDGET_SECONDS", .8 if scenario == "drip" else 5):
                        start = time.monotonic()
                        result = fetch_mailbox(10, credentials={"address": "fixture@example.invalid", "auth_code": "synthetic", "host": "imap.163.com", "folder": "INBOX"})
                        elapsed = time.monotonic() - start
                    if scenario not in ("uid-before", "uid-after", "size-plus-two"):
                        if scenario == "drip":
                            self.assertLess(elapsed, 2)
                        self.assertEqual(len(result["messages"]), 1)
                        self.assertIsNone(result["messages"][0]["raw"])
                        self.assertEqual(result["messages"][0]["received_at"], "2026-10-19T01:30:00+00:00")
                        self.assertTrue(result["messages"][0]["retryable"])
                        self.assertEqual(result["blocked_uid"], 11)
                    else:
                        self.assertEqual([entry["raw"] for entry in result["messages"]], [raw, raw])
                        self.assertEqual([entry["uid"] for entry in result["messages"]], [11, 12])
                finally:
                    server.shutdown()
                    server.server_close()
                    thread.join(timeout=2)

    def test_real_imaplib_identity_and_readonly_access(self):
        """Exercise the real IMAP command encoder/parser against an isolated local server."""
        for operation in (test_mailbox_connection, fetch_mailbox):
            for scenario in ("identity", "unsupported", "identity-rejected", "unsafe-folder"):
                with self.subTest(operation=operation.__name__, scenario=scenario):
                    commands = []

                    class Handler(socketserver.StreamRequestHandler):
                        def handle(self):
                            self.wfile.write(b"* OK local protocol test\r\n")
                            while line := self.rfile.readline():
                                tag, command, *arguments = line.decode("ascii").strip().split(" ", 2)
                                commands.append((command, arguments))
                                status = "OK"
                                if command == "CAPABILITY":
                                    extension = "" if scenario == "unsupported" else " ID"
                                    self.wfile.write(f"* CAPABILITY IMAP4rev1{extension}\r\n".encode())
                                elif command == "ID":
                                    if scenario == "identity-rejected":
                                        status = "NO"
                                    else:
                                        self.wfile.write(b"* ID NIL\r\n")
                                elif command == "EXAMINE":
                                    if scenario == "unsafe-folder":
                                        self.wfile.write(f"{tag} NO Unsafe Login\r\n".encode())
                                        continue
                                    self.wfile.write(b"* 0 EXISTS\r\n* OK [UIDVALIDITY 123] stable\r\n")
                                elif command == "UID" and arguments[0].startswith("SEARCH "):
                                    self.wfile.write(b"* SEARCH\r\n")
                                elif command == "LOGOUT":
                                    self.wfile.write(b"* BYE test complete\r\n")
                                elif command != "LOGIN":
                                    status = "BAD"
                                self.wfile.write(f"{tag} {status} {command} completed\r\n".encode())
                                if command == "LOGOUT":
                                    return

                    server = socketserver.TCPServer(("127.0.0.1", 0), Handler)
                    worker = threading.Thread(target=server.serve_forever,
                                              kwargs={"poll_interval": 0.01}, daemon=True)
                    worker.start()
                    credentials = {"address": "shipping@example.com", "auth_code": "test-code",
                                   "host": "imap.163.com", "folder": "INBOX"}
                    # Only replace the test transport; the production IMAP commands stay real.
                    def connect(*args, **kwargs):
                        return imaplib.IMAP4("127.0.0.1", server.server_address[1], timeout=2)
                    try:
                        with patch("app.mailbox.imaplib.IMAP4_SSL", side_effect=connect), patch("app.mailbox.BoundedImap", side_effect=connect):
                            if scenario in ("identity-rejected", "unsafe-folder") and operation == fetch_mailbox:
                                error = imaplib.IMAP4.error if scenario == "identity-rejected" else RuntimeError
                                with self.assertRaises(error):
                                    operation(credentials=credentials)
                            else:
                                result = (operation(credentials=credentials) if operation == fetch_mailbox
                                          else operation(credentials))
                                if operation == fetch_mailbox:
                                    self.assertEqual(result["messages"], [])
                                    self.assertEqual(result["uid_validity"], 123)
                                else:
                                    self.assertEqual(result["connected"], scenario in ("identity", "unsupported"))
                                    if scenario == "identity-rejected":
                                        self.assertIn("身份声明", result["message"])
                                    if scenario == "unsafe-folder":
                                        self.assertIn("安全限制", result["message"])
                    finally:
                        server.shutdown()
                        server.server_close()
                        worker.join(timeout=2)
                    names = [command for command, _ in commands]
                    if operation == test_mailbox_connection:
                        self.assertEqual(names[-1], "LOGOUT")
                    self.assertNotIn("SELECT", names)
                    self.assertNotIn("STORE", names)
                    if scenario == "unsupported":
                        self.assertNotIn("ID", names)
                    else:
                        self.assertLess(names.index("LOGIN"), names.index("ID"))
                        payload = next(args[0] for command, args in commands if command == "ID")
                        self.assertEqual(payload, '("name" "VoyagePlex" "version" "1.0" "vendor" "VoyagePlex")')
                    if scenario == "identity-rejected":
                        self.assertNotIn("EXAMINE", names)
                    elif scenario != "unsupported":
                        self.assertLess(names.index("ID"), names.index("EXAMINE"))
                    if operation == test_mailbox_connection:
                        self.assertNotIn("UID", names)
