"""Real API/SQLite tests; only fresh synthetic data and an owned fake parser."""
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
ADDRESS = "shared@example.invalid"
DATE = "2026-10-13T00:00:00Z"


def run():
    passed = []
    with tempfile.TemporaryDirectory(prefix="voyageplex-shared-retry-") as directory:
        owned = Path(directory)
        db_path = owned / "shared-test.db"

        class Parser(BaseHTTPRequestHandler):
            calls = []
            variant = "ok"
            change = None

            def log_message(self, *args): pass
            def do_GET(self): self.reply({"configured": False, "items": []})
            def do_POST(self):
                if self.headers.get("Transfer-Encoding", "").lower() == "chunked":
                    raw = b""
                    while True:
                        size = int(self.rfile.readline().strip(), 16)
                        if not size: self.rfile.readline(); break
                        raw += self.rfile.read(size); self.rfile.read(2)
                else: raw = self.rfile.read(int(self.headers["Content-Length"]))
                payload = json.loads(raw)
                assert self.path == "/v1/mailbox/retry-shared", self.path
                assert set(payload) == {"company", "selected_uids", "expected_uid_validity", "expected_address"}
                assert payload["company"] == "Xingxin" and payload["expected_address"] == ADDRESS
                assert payload["expected_uid_validity"] == 7
                self.calls.append(payload)
                if type(self).change:
                    change = type(self).change
                    type(self).change = None
                    change()
                if self.variant == "identity-conflict":
                    return self.reply({"error": "synthetic private detail"}, 409)
                items = [{"mailbox_uid": uid, "mailbox_received_at": DATE,
                          "filename": f"mail-{uid}.eml", "status": "parsed", "fingerprint": f"fp-{uid}",
                          "business_fingerprint": f"business-{uid}",
                          "message": {"subject": f"Recovered {uid}", "sender": "sender@example.invalid"},
                          "items": [], "fields": {}} for uid in payload["selected_uids"]]
                if self.variant == "date": items[0]["mailbox_received_at"] = "2026-10-14T00:00:00Z"
                if self.variant == "fingerprint": items[0]["fingerprint"] = "different"
                if self.variant == "wrong-uid": items[0]["mailbox_uid"] += 10000
                if self.variant == "failed": items[0] = {"mailbox_uid": items[0]["mailbox_uid"], "mailbox_received_at": DATE, "status": "failed"}
                self.reply({"configured": True, "address": "wrong@example.invalid" if self.variant == "address" else ADDRESS,
                            "uid_validity": 8 if self.variant == "validity" else 7, "items": items})
            def reply(self, value, status=200):
                body = json.dumps(value).encode()
                self.send_response(status); self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body))); self.end_headers(); self.wfile.write(body)

        parser = ThreadingHTTPServer(("127.0.0.1", 0), Parser)
        threading.Thread(target=parser.serve_forever, daemon=True).start()
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0)); port = sock.getsockname()[1]
        base = f"http://127.0.0.1:{port}"

        class Client:
            def __init__(self, company="Xingxin"): self.company, self.cookie = company, ""
            def request(self, path, payload=None, expected=200):
                data = None if payload is None else json.dumps(payload).encode()
                headers = {"Cookie": f"voyageplex_company={self.company}; {self.cookie}"}
                if data is not None: headers["Content-Type"] = "application/json"
                try: response = urllib.request.urlopen(urllib.request.Request(base + path, data=data, headers=headers), timeout=20)
                except urllib.error.HTTPError as error: response = error
                for cookie in response.headers.get_all("Set-Cookie", []):
                    if cookie.startswith("voyageplex_session="): self.cookie = cookie.split(";", 1)[0]
                raw = response.read(); value = json.loads(raw) if raw and "application/json" in response.headers.get("Content-Type", "") else None
                assert response.status == expected, (path, response.status, value)
                return value

        env = {"PATH": "/Users/fovo/.dotnet:/usr/bin:/bin", "HOME": str(owned),
               "DOTNET_CLI_TELEMETRY_OPTOUT": "1", "ASPNETCORE_ENVIRONMENT": "Production",
               "ASPNETCORE_URLS": base, "ConnectionStrings__Default": f"Data Source={db_path}",
               "EmailParser__BaseUrl": f"http://127.0.0.1:{parser.server_port}",
               "VOYAGEPLEX_HUADENG_MAILBOXES_JSON": "[]", "Logging__LogLevel__Default": "Error"}
        with (owned / "api.log").open("wb") as log:
            api = subprocess.Popen(["/Users/fovo/.dotnet/dotnet", str(DLL)], cwd=owned, env=env, stdout=log, stderr=log)
            try:
                admin = Client()
                deadline = time.monotonic() + 30
                while time.monotonic() < deadline:
                    assert api.poll() is None
                    try: admin.request("/api/health"); break
                    except (OSError, urllib.error.URLError): time.sleep(.1)
                else: raise AssertionError("owned API not ready")
                password = secrets.token_urlsafe(24)
                admin.request("/api/auth/setup", {"username": "synthetic-admin", "displayName": "Synthetic", "password": password}, 201)
                admin.request("/api/auth/login", {"username": "synthetic-admin", "password": password})
                admin.request("/api/users", {"username": "synthetic-shipping", "displayName": "Synthetic shipping", "password": password,
                                            "role": "shipping", "companyAccess": "Xingxin"}, 201)
                shipping = Client(); shipping.request("/api/auth/login", {"username": "synthetic-shipping", "password": password})

                def insert(c, table, supplied):
                    fields = {}
                    for _, key, kind, required, default, primary in c.execute(f"PRAGMA table_info({table})"):
                        if not primary and key not in supplied and required and default is None:
                            fields[key] = 0 if kind == "INTEGER" else "2026-11-04 00:00:00" if key.endswith("At") else ""
                    fields.update(supplied)
                    return c.execute(f"INSERT INTO {table} ({','.join(fields)}) VALUES ({','.join('?' for _ in fields)})", list(fields.values())).lastrowid
                with sqlite3.connect(db_path) as c:
                    c.execute("UPDATE MailSystemSettings SET SyncEnabled=0")
                    c.execute("DELETE FROM MailSyncStates")
                    for state_id in (1, 2, 1002, 1003, 1005, 1006):
                        insert(c, "MailSyncStates", {"Id": state_id, "Address": ADDRESS if state_id == 1 else "personal@example.invalid",
                            "UidValidity": 7, "LastUid": 999, "MailboxIdentity": "", "ConfigurationKey": "", "LastError": "unchanged marker"})
                    batch = insert(c, "ImportBatches", {"Company": "Xingxin", "MailOwnerId": 0, "Kind": "Email", "Status": "PendingConfirmation",
                        "ParserVersion": "original-version", "TotalCount": 0, "FailedCount": 0, "ParsedCount": 0})
                def seed(uid, **extra):
                    with sqlite3.connect(db_path) as c:
                        item = insert(c, "ImportEmailItems", dict(ImportBatchId=batch, Company="Xingxin", MailOwnerId=0,
                            MailboxKey=f"{ADDRESS}:7:{uid}", FileName="original.eml", Fingerprint=f"fp-{uid}",
                            MailSender="sender@example.invalid", MailSubject="Original", MailReceivedAt=DATE, MailReceivedDate="2026-10-13",
                            Status="failed", HandlingStatus="Pending", HandlingOutcome="", TaskIdsJson="[]", WorkCategory="Unclassified",
                            ResultJson='{"status":"failed","original":"keep-on-failure"}', ClassificationSource="Automatic", **extra))
                        c.execute("UPDATE ImportBatches SET FailedCount=FailedCount+1,TotalCount=TotalCount+1 WHERE Id=?", (batch,))
                        return item
                def rows(table):
                    with sqlite3.connect(db_path) as c: return c.execute(f"SELECT * FROM {table} ORDER BY Id").fetchall()
                def item_row(item):
                    with sqlite3.connect(db_path) as c:
                        c.row_factory = sqlite3.Row
                        return dict(c.execute("SELECT * FROM ImportEmailItems WHERE Id=?", (item,)).fetchone())
                endpoint = "/api/imports/email/mailbox/retry-failed"
                item = seed(11, BusinessFingerprint="business-11"); state_before = rows("MailSyncStates"); before = item_row(item)
                shipping.request(endpoint, {"itemIds": [item]}, 403)
                Client().request(endpoint, {"itemIds": [item]}, 401)
                admin.company = "Huadeng"; admin.request(endpoint, {"itemIds": [item]}, 400); admin.company = "Xingxin"
                for ids in ([], [item, item], [item] * 6, [True], ["1"], [0]): admin.request(endpoint, {"itemIds": ids}, 400)
                assert Parser.calls == []
                passed.append("admin-only strict 1-5 IDs; shared namespace cannot bypass Huadeng selected-owner requirement")

                recovered = admin.request(endpoint, {"itemIds": [item]})
                assert recovered == {"requested": 1, "recovered": 1, "stillFailed": 0, "recoveredItemIds": [item]}
                assert Parser.calls[-1] == {"company": "Xingxin", "selected_uids": [11], "expected_uid_validity": 7, "expected_address": ADDRESS}
                after = item_row(item)
                for key in ("Id", "Company", "MailOwnerId", "MailboxKey", "ImportBatchId", "MailReceivedAt", "MailReceivedDate", "Fingerprint", "BusinessFingerprint", "CreatedAt", "WorkNote", "ReviewedAt", "TaskIdsJson", "HandlingStatus", "HandlingOutcome"):
                    assert before[key] == after[key], key
                assert after["Status"] == "pending" and rows("MailSyncStates") == state_before and not rows("ShipmentTasks")
                with sqlite3.connect(db_path) as c: assert c.execute("SELECT FailedCount,ParsedCount,TotalCount,ParserVersion FROM ImportBatches WHERE Id=?", (batch,)).fetchone() == (0, 1, 1, "original-version")
                passed.append("successful shared retry preserves exact row namespace/date/fingerprint/version/notes/tasks and all six synchronization states")

                for variant, status in (("address", 502), ("validity", 409), ("date", 409), ("fingerprint", 409), ("business-fingerprint", 409), ("wrong-uid", 409), ("identity-conflict", 409), ("failed", 200)):
                    target = seed(20 + len(Parser.calls), **({"BusinessFingerprint": "different-original-business"} if variant == "business-fingerprint" else {})); Parser.variant = variant
                    snapshot = {name: rows(name) for name in ("ImportEmailItems", "ImportBatches", "MailSyncStates", "MailContacts", "ShipmentTasks")}
                    value = admin.request(endpoint, {"itemIds": [target]}, status)
                    if variant == "failed": assert value["recovered"] == 0
                    assert snapshot == {name: rows(name) for name in snapshot}, variant
                Parser.variant = "ok"
                passed.append("address/UIDVALIDITY/date/raw and business fingerprint/UID mismatches and repeated parse failures preserve every stored row and cursor")

                for index, guard in enumerate(("wrong-owner", "personal-key", "task-ids", "manual-note", "direct-task", "secondary-task", "other-company")):
                    target = seed(60 + index)
                    with sqlite3.connect(db_path) as c:
                        if guard == "wrong-owner": c.execute("UPDATE ImportEmailItems SET MailOwnerId=9 WHERE Id=?", (target,))
                        if guard == "personal-key": c.execute("UPDATE ImportEmailItems SET MailboxKey=? WHERE Id=?", (f"Huadeng:0:any:{ADDRESS}:7:{60+index}", target))
                        if guard == "task-ids": c.execute("UPDATE ImportEmailItems SET TaskIdsJson='[1]' WHERE Id=?", (target,))
                        if guard == "manual-note": c.execute("UPDATE ImportEmailItems SET WorkNote='manual note' WHERE Id=?", (target,))
                        if guard == "other-company": c.execute("UPDATE ImportEmailItems SET Company='Huadeng' WHERE Id=?", (target,))
                        if guard in ("direct-task", "secondary-task"):
                            insert(c, "ShipmentTasks", {"Company": "Xingxin", "SourceImportItemId": target if guard == "direct-task" else None,
                                "SourceEmailsJson": "[]" if guard == "direct-task" else json.dumps([{"id": target}]),
                                "ItemsJson": "[]", "WarehouseGroupsJson": "[]", "ExportDetailsJson": "{}"})
                    calls = len(Parser.calls)
                    snapshot = {name: rows(name) for name in ("ImportEmailItems", "ImportBatches", "MailSyncStates", "ShipmentTasks")}
                    admin.request(endpoint, {"itemIds": [target]}, 404 if guard == "other-company" else 409)
                    assert len(Parser.calls) == calls and snapshot == {name: rows(name) for name in snapshot}, guard
                passed.append("owner-zero, company, exact shared key, notes and both real task-source guards reject before parser contact")

                target = seed(40)
                def edit_note():
                    with sqlite3.connect(db_path) as c: c.execute("UPDATE ImportEmailItems SET WorkNote='user changed meanwhile' WHERE Id=?", (target,))
                Parser.change = edit_note
                admin.request(endpoint, {"itemIds": [target]}, 409)
                assert item_row(target)["WorkNote"] == "user changed meanwhile" and item_row(target)["Status"] == "failed"
                assert rows("MailSyncStates") == state_before
                passed.append("concurrent manual edit wins; retry never overwrites edited data")

                target = seed(41)
                def progress():
                    with sqlite3.connect(db_path) as c: c.execute("UPDATE MailSyncStates SET LastUid=1000,LastError='natural progress' WHERE Id=1")
                Parser.change = progress
                assert admin.request(endpoint, {"itemIds": [target]})["recovered"] == 1
                assert item_row(target)["BusinessFingerprint"] == "business-41", "an empty original business fingerprint may gain the parsed value"
                with sqlite3.connect(db_path) as c: assert c.execute("SELECT LastUid,LastError FROM MailSyncStates WHERE Id=1").fetchone() == (1000, "natural progress")
                passed.append("natural forward cursor progress survives unchanged; retry does not restore its old snapshot")

                for line in passed: print("PASS", line)
                print(json.dumps({"passed": len(passed), "failed": 0, "skipped": 0, "allDataOwnedTempSQLite": True}))
            finally:
                api.terminate(); api.wait(timeout=15)
                parser.shutdown(); parser.server_close()


if __name__ == "__main__": run()
