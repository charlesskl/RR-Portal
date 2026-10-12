import imaplib
import socketserver
import threading
import unittest
from unittest.mock import patch

from app.mailbox import fetch_mailbox, test_mailbox_connection


class MailboxProtocolTests(unittest.TestCase):
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
                        with patch("app.mailbox.imaplib.IMAP4_SSL", side_effect=connect):
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
