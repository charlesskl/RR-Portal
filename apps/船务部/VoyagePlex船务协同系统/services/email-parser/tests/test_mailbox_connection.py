"""Real constructor/DNS/TLS cancellation boundaries, using local fixtures only."""
import datetime
import imaplib
import os
from pathlib import Path
import socket
import socketserver
import ssl
import subprocess
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID

from app.mailbox import BoundedImap, MailboxControl


class ConnectionBudgetTests(unittest.TestCase):
    def test_dns_timeout_and_cancel_kill_and_reap_without_inheriting_credentials(self):
        for cancel in (False, True):
            with self.subTest(cancel=cancel):
                control = MailboxControl()
                client = object.__new__(BoundedImap)
                client.host, client.port = "localhost", 993
                client.control, client.deadline = control, time.monotonic() + (5 if cancel else .15)
                client.sock = None
                control.client = client
                real_popen = subprocess.Popen
                children, errors = [], []
                started = threading.Event()

                def slow_resolver(args, **kwargs):
                    self.assertNotIn("VOYAGEPLEX_MAIL_AUTH_CODE", kwargs["env"])
                    self.assertNotIn("synthetic-private-code", repr(args))
                    changed = list(args)
                    changed[3] = "import time;time.sleep(60)"
                    process = real_popen(changed, **kwargs)
                    children.append(process)
                    started.set()
                    return process

                def resolve():
                    try:
                        client._resolve()
                    except Exception as error:
                        errors.append(type(error).__name__)

                with patch.dict(os.environ, {"VOYAGEPLEX_MAIL_AUTH_CODE": "synthetic-private-code"}), patch("app.mailbox.subprocess.Popen", slow_resolver):
                    start = time.monotonic()
                    thread = threading.Thread(target=resolve)
                    thread.start()
                    self.assertTrue(started.wait(1))
                    if cancel:
                        control.cancel()
                    thread.join(timeout=1)
                    self.assertFalse(thread.is_alive())
                    self.assertLess(time.monotonic() - start, 1)
                self.assertTrue(errors)
                self.assertEqual(len(children), 1)
                self.assertIsNotNone(children[0].poll())
                self.assertTrue(children[0].stdout.closed)
                with self.assertRaises(ProcessLookupError):
                    os.kill(children[0].pid, 0)

    def test_stalled_tls_handshake_obeys_remaining_budget_and_cancellation(self):
        for cancel in (False, True):
            with self.subTest(cancel=cancel):
                listener = socket.socket()
                listener.bind(("127.0.0.1", 0))
                listener.listen()
                accepted, stop = threading.Event(), threading.Event()

                def serve():
                    connection, _ = listener.accept()
                    accepted.set()
                    try:
                        connection.recv(4096)  # ClientHello; intentionally no ServerHello.
                        stop.wait(2)
                    finally:
                        connection.close()

                server = threading.Thread(target=serve, daemon=True)
                server.start()
                control, errors = MailboxControl(), []

                def connect():
                    try:
                        BoundedImap("localhost", listener.getsockname()[1], control=control,
                                    deadline=time.monotonic() + (5 if cancel else .3))
                    except Exception as error:
                        errors.append(type(error).__name__)

                try:
                    start = time.monotonic()
                    thread = threading.Thread(target=connect)
                    thread.start()
                    self.assertTrue(accepted.wait(1))
                    if cancel:
                        control.cancel()
                    thread.join(timeout=1)
                    self.assertFalse(thread.is_alive())
                    self.assertLess(time.monotonic() - start, 1)
                    self.assertTrue(errors)
                    self.assertTrue(control.client.sock._closed)
                finally:
                    control.cancel()
                    stop.set()
                    listener.close()
                    server.join(timeout=2)

    def test_tls_ca_hostname_and_encrypted_greeting_deadline(self):
        key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "localhost")])
        now = datetime.datetime.now(datetime.timezone.utc)
        cert = (x509.CertificateBuilder().subject_name(name).issuer_name(name)
                .public_key(key.public_key()).serial_number(x509.random_serial_number())
                .not_valid_before(now - datetime.timedelta(minutes=1))
                .not_valid_after(now + datetime.timedelta(days=1))
                .add_extension(x509.SubjectAlternativeName([x509.DNSName("localhost")]), critical=False)
                .sign(key, hashes.SHA256()))
        with tempfile.TemporaryDirectory() as temp:
            cert_path, key_path = Path(temp) / "fixture.crt", Path(temp) / "fixture.key"
            cert_path.write_bytes(cert.public_bytes(serialization.Encoding.PEM))
            key_path.write_bytes(key.private_bytes(serialization.Encoding.PEM,
                serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
            for scenario in ("untrusted", "wrong-host", "trusted", "encrypted-drip"):
                with self.subTest(scenario=scenario):
                    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
                    context.load_cert_chain(cert_path, key_path)

                    class Handler(socketserver.BaseRequestHandler):
                        def handle(self):
                            try:
                                with context.wrap_socket(self.request, server_side=True) as connection:
                                    welcome = b"* OK encrypted synthetic greeting\r\n"
                                    if scenario == "encrypted-drip":
                                        for byte in welcome:
                                            connection.sendall(bytes([byte]))
                                            time.sleep(.02)
                                    else:
                                        connection.sendall(welcome)
                                    incoming = connection.makefile("rb")
                                    try:
                                        while line := incoming.readline():
                                            tag, command, *_ = line.decode().strip().split(" ")
                                            if command == "CAPABILITY":
                                                connection.sendall(b"* CAPABILITY IMAP4rev1\r\n")
                                            connection.sendall(f"{tag} OK complete\r\n".encode())
                                    finally:
                                        incoming.close()
                            except OSError:
                                pass

                    class Server(socketserver.ThreadingTCPServer):
                        daemon_threads = True

                    server = Server(("127.0.0.1", 0), Handler)
                    serving = threading.Thread(target=server.serve_forever, kwargs={"poll_interval": .01}, daemon=True)
                    serving.start()
                    control = MailboxControl()
                    timer = threading.Timer(.3, control.expire_fetch)
                    trusted = None if scenario == "untrusted" else ssl.create_default_context(cafile=str(cert_path))
                    try:
                        start = time.monotonic()
                        if scenario == "encrypted-drip":
                            timer.start()
                            with self.assertRaises((OSError, ssl.SSLError, TimeoutError, imaplib.IMAP4.error)):
                                BoundedImap("localhost", server.server_address[1], ssl_context=trusted,
                                            control=control, deadline=start + .3)
                            self.assertLess(time.monotonic() - start, 1)
                        elif scenario in ("untrusted", "wrong-host"):
                            with self.assertRaises(ssl.SSLCertVerificationError):
                                BoundedImap("127.0.0.1" if scenario == "wrong-host" else "localhost", server.server_address[1],
                                            ssl_context=trusted, control=control, deadline=start + 2)
                        else:
                            client = BoundedImap("localhost", server.server_address[1], ssl_context=trusted,
                                                 control=control, deadline=start + 2)
                            self.assertTrue(client.ssl_context.check_hostname)
                            self.assertEqual(client.ssl_context.verify_mode, ssl.CERT_REQUIRED)
                            client.shutdown()
                    finally:
                        timer.cancel()
                        control.cancel()
                        server.shutdown()
                        server.server_close()
                        serving.join(timeout=2)
