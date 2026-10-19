"""Server mailbox changes and concurrent tests, using only local fake credentials."""
import http.cookiejar
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import secrets
import socket
import sqlite3
import subprocess
import tempfile
import threading
import time
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
DLL = ROOT / "server/VoyagePlex.Api/bin/Debug/net8.0/VoyagePlex.Api.dll"


def run():
    with tempfile.TemporaryDirectory(prefix="voyageplex-server-mail-tests-") as directory:
        db_path = Path(directory) / "test.db"
        test_started, test_release = threading.Event(), threading.Event()

        class ParserStub(BaseHTTPRequestHandler):
            calls = []
            tested_mailboxes = []
            pause_test = False
            fail_poll = False

            def log_message(self, *args):
                pass

            def do_GET(self):
                self.respond({"configured": False, "items": []})

            def do_POST(self):
                if self.headers.get("Transfer-Encoding", "").lower() == "chunked":
                    body = b""
                    while True:
                        size = int(self.rfile.readline().strip(), 16)
                        if not size:
                            self.rfile.readline()
                            break
                        body += self.rfile.read(size)
                        self.rfile.read(2)
                else:
                    body = self.rfile.read(int(self.headers["Content-Length"]))
                payload = json.loads(body)
                if self.path == "/v1/mailbox/test":
                    self.tested_mailboxes.append((payload["address"], payload["host"], payload["folder"]))
                    if self.pause_test:
                        test_started.set()
                        assert test_release.wait(15)
                    self.respond({"connected": payload["auth_code"] == "fixture-auth", "message": "本地测试"})
                    return
                if self.fail_poll:
                    self.respond({"error": "synthetic-private-parser-detail"}, status=503)
                    return
                folder = payload["folder"]
                self.calls.append((folder, payload["after_uid"]))
                uids = [11] if folder == "INBOX" else [5, 11]
                items = [{"mailbox_uid": uid, "mailbox_received_at": "2026-10-13T00:00:00Z",
                          "fingerprint": f"fixture-{folder}-{uid}", "status": "parsed",
                          "message": {"subject": folder, "sender": "fixture@example.com"}, "items": []}
                         for uid in uids if payload["after_uid"] < uid]
                self.respond({"configured": True, "address": payload["address"], "uid_validity": 7,
                              "items": items})

            def respond(self, payload, status=200):
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps(payload).encode())

        parser = ThreadingHTTPServer(("127.0.0.1", 0), ParserStub)
        threading.Thread(target=parser.serve_forever, daemon=True).start()
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            port = sock.getsockname()[1]
        base = f"http://127.0.0.1:{port}"
        jar = http.cookiejar.CookieJar()
        opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
        process = None
        failures = []

        def request(path, payload=None, method=None, expected=200):
            data = None if payload is None else json.dumps(payload).encode()
            req = urllib.request.Request(base + path, data=data, method=method,
                                         headers={"Content-Type": "application/json"} if data else {})
            try:
                response = opener.open(req, timeout=20)
            except urllib.error.HTTPError as error:
                response = error
            value = json.loads(response.read() or "null")
            assert response.code == expected, (path, response.code, value)
            return value

        def cookie(name, value):
            jar.set_cookie(http.cookiejar.Cookie(0, name, str(value), None, False, "127.0.0.1", False,
                                                 False, "/", True, False, None, True, None, None, {}))

        def start(folder="INBOX", auth="fixture-auth"):
            nonlocal process
            env = dict(os.environ, ConnectionStrings__Default=f"Data Source={db_path}",
                       ASPNETCORE_URLS=base, EmailParser__BaseUrl=f"http://127.0.0.1:{parser.server_port}",
                       DOTNET_CLI_TELEMETRY_OPTOUT="1")
            env["VOYAGEPLEX_HUADENG_MAILBOXES_JSON"] = json.dumps([
                {"username": "fixture-owner", "address": "owner@example.com", "authCode": auth,
                 "host": "imap.example.com", "folder": folder}])
            process = subprocess.Popen(["dotnet", str(DLL)], cwd=ROOT / "server/VoyagePlex.Api",
                                       env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            deadline = time.monotonic() + 30
            while time.monotonic() < deadline:
                assert process.poll() is None, "Local test API stopped"
                try:
                    request("/api/auth/setup-status")
                    return
                except (OSError, urllib.error.URLError):
                    time.sleep(0.1)
            raise AssertionError("Local test API startup timed out")

        def stop():
            nonlocal process
            if process:
                process.terminate()
                process.wait(timeout=15)
                process = None

        def check(condition, message):
            if not condition:
                failures.append(message)

        try:
            start()
            password = secrets.token_urlsafe(16)
            request("/api/auth/setup", {"username": "fixture-admin", "displayName": "管理员", "password": password}, expected=201)
            request("/api/auth/login", {"username": "fixture-admin", "password": password})
            owner_id = request("/api/users", {"username": "fixture-owner", "displayName": "船务员", "password": password,
                                              "role": "shipping", "companyAccess": "Huadeng"}, expected=201)["id"]

            def bind(address):
                return request(f"/api/users/{owner_id}", {"displayName": "船务员", "role": "shipping",
                                                         "companyAccess": "Huadeng", "mailboxAddress": address}, method="PUT")

            bind("owner@example.com")
            cookie("voyageplex_company", "Huadeng")
            cookie("voyageplex_mail_owner", owner_id)
            request("/api/mail/settings", {"syncEnabled": False}, method="PATCH")
            result = request(f"/api/users/{owner_id}/mailbox-test", {"mailboxAddress": "untrusted@example.com",
                              "mailboxAuthCode": "client-request", "mailboxHost": "localhost"})
            assert result["connected"] and ParserStub.tested_mailboxes[-1] == ("owner@example.com", "imap.example.com", "INBOX")
            assert "fixture-auth" not in json.dumps(result)
            assert request("/api/imports/email/mailbox/sync", {})["imported"] == 1
            stop()

            # Emulate the previous database: legacy key, saved host/folder and no new columns.
            with sqlite3.connect(db_path) as db:
                db.execute("UPDATE Users SET MailboxHost='imap.example.com', MailboxFolder='INBOX' WHERE Id=?", (owner_id,))
                db.execute("UPDATE ImportEmailItems SET MailboxKey=? WHERE Company='Huadeng' AND MailOwnerId=?",
                           (f"Huadeng:{owner_id}:owner@example.com:7:11", owner_id))
                db.execute("ALTER TABLE Users DROP COLUMN MailboxTestConfigurationKey")
                db.execute("ALTER TABLE MailSyncStates DROP COLUMN MailboxIdentity")
                db.execute("ALTER TABLE MailSyncStates DROP COLUMN ConfigurationKey")
            start()
            assert request("/api/imports/email/mailbox/sync", {})["imported"] == 0
            assert ParserStub.calls[-1] == ("INBOX", 11), "Same legacy mailbox must preserve UID cursor"
            with sqlite3.connect(db_path) as db:
                migrated_key = db.execute("SELECT MailboxKey FROM ImportEmailItems WHERE Company='Huadeng'").fetchone()[0]
                assert migrated_key != f"Huadeng:{owner_id}:owner@example.com:7:11"
                assert db.execute("SELECT COUNT(*) FROM ImportEmailItems WHERE Company='Huadeng'").fetchone()[0] == 1
            stop()
            start()
            assert request("/api/imports/email/mailbox/sync", {})["imported"] == 0
            with sqlite3.connect(db_path) as db:
                assert db.execute("SELECT MailboxKey FROM ImportEmailItems WHERE Company='Huadeng'").fetchone()[0] == migrated_key
            request(f"/api/users/{owner_id}/mailbox-test", {})
            stop()

            start(auth="rotated-fixture-auth")
            status = request("/api/mail/settings")
            check(status["connectionStatus"] == "PendingConnection",
                  "Rotated server credentials kept old connection status: " + status["connectionStatus"])
            assert request("/api/imports/email/mailbox/sync", {})["imported"] == 0
            assert ParserStub.calls[-1] == ("INBOX", 11), "Credential rotation must preserve UID cursor"
            with sqlite3.connect(db_path) as db:
                assert db.execute("SELECT MailboxKey FROM ImportEmailItems WHERE Company='Huadeng'").fetchone()[0] == migrated_key
                assert db.execute("SELECT COUNT(*) FROM ImportEmailItems WHERE Company='Huadeng'").fetchone()[0] == 1
            stop()
            start(folder="Archive")
            imported = request("/api/imports/email/mailbox/sync", {})["imported"]
            check(imported == 2, f"Changed folder imported {imported} messages; poll calls: {ParserStub.calls}")
            with sqlite3.connect(db_path) as db:
                assert db.execute("SELECT COUNT(*) FROM ImportEmailItems WHERE Company='Huadeng'").fetchone()[0] == 3
            assert request("/api/imports/email/mailbox/sync", {})["imported"] == 0
            stop()
            start()
            assert request("/api/imports/email/mailbox/sync", {})["imported"] == 0
            assert ParserStub.calls[-1] == ("INBOX", 0), "Returning to the original folder must use its identity and existing keys"
            with sqlite3.connect(db_path) as db:
                assert db.execute("SELECT COUNT(*) FROM ImportEmailItems WHERE Company='Huadeng'").fetchone()[0] == 3

            ParserStub.fail_poll = True
            with sqlite3.connect(db_path) as db:
                before_cursor = db.execute("SELECT LastUid FROM MailSyncStates WHERE Id=?", (1000 + owner_id,)).fetchone()[0]
            failure = request("/api/imports/email/mailbox/sync", {}, expected=502)
            assert failure == {"error": "邮箱同步失败，已保留同步断点，请稍后重试或联系管理员"}
            assert "synthetic-private-parser-detail" not in json.dumps(failure)
            request("/api/health")
            with sqlite3.connect(db_path) as db:
                assert db.execute("SELECT LastUid FROM MailSyncStates WHERE Id=?", (1000 + owner_id,)).fetchone()[0] == before_cursor
                assert db.execute("SELECT COUNT(*) FROM ImportEmailItems WHERE Company='Huadeng'").fetchone()[0] == 3
            ParserStub.fail_poll = False

            bind("reset@example.com")
            bind("owner@example.com")
            ParserStub.pause_test = True
            result = []
            thread = threading.Thread(target=lambda: result.append(request(f"/api/users/{owner_id}/mailbox-test", {}, expected=409)))
            thread.start()
            assert test_started.wait(10)
            bind("changed@example.com")
            test_release.set()
            thread.join(15)
            assert not thread.is_alive() and len(result) == 1
            with sqlite3.connect(db_path) as db:
                stored = db.execute("SELECT MailboxTestStatus FROM Users WHERE Id=?", (owner_id,)).fetchone()[0]
            check(stored == "Unknown", "Concurrent rebind stored stale mailbox test status: " + stored)
            assert not failures, "\n".join(failures)
            print("Server mailbox API: legacy migration, idempotence, rotation, folder identity, sanitized poll failures and concurrent binding tests passed.")
        finally:
            test_release.set()
            stop()
            parser.shutdown()
            parser.server_close()


if __name__ == "__main__":
    run()
