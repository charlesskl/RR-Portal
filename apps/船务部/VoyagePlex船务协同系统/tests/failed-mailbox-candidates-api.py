"""Real HTTP/SQLite candidate browsing and failed-retry UI contract.
All mail, identities and credentials are synthetic; only loopback parser calls are allowed.
"""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import hashlib
import json
import os
import secrets
import shutil
import socket
import sqlite3
import subprocess
import tempfile
import threading
import time
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
DOTNET = os.environ.get("DOTNET_EXECUTABLE") or shutil.which("dotnet")
DLL = Path(os.environ.get("VOYAGEPLEX_TEST_DLL", str(ROOT / "server/VoyagePlex.Api/bin/Debug/net8.0/VoyagePlex.Api.dll")))
LIST = "/api/imports/email/mailbox/failed"
RETRY = "/api/imports/email/mailbox/retry-failed"
DATE = "2026-10-13T00:00:00Z"
ADDRESS = "shared@example.invalid"
HOST = "imap.example.invalid"


def run():
    assert DOTNET and DLL.exists()
    passed = []
    def check(label, condition):
        assert condition, label
        passed.append(label)
        print("PASS", label)
    with tempfile.TemporaryDirectory(prefix="voyageplex-candidates-") as temp:
        owned = Path(temp); database = owned / "synthetic.db"
        class Parser(BaseHTTPRequestHandler):
            calls = []; outcome = "parsed"; address = ADDRESS
            def log_message(self, *args): pass
            def reply(self, body):
                raw = json.dumps(body).encode(); self.send_response(200)
                self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(raw)))
                self.end_headers(); self.wfile.write(raw)
            def do_GET(self): self.reply({"configured": False, "items": []})
            def do_POST(self):
                if self.headers.get("Transfer-Encoding", "").lower() == "chunked":
                    raw = b""
                    while True:
                        count = int(self.rfile.readline().strip(), 16)
                        if not count: self.rfile.readline(); break
                        raw += self.rfile.read(count); self.rfile.read(2)
                else: raw = self.rfile.read(int(self.headers["Content-Length"]))
                value = json.loads(raw)
                if self.path == "/v1/mailbox/poll": return self.reply({"configured": False, "items": []})
                assert self.path in ("/v1/mailbox/retry-shared", "/v1/mailbox/retry")
                type(self).calls.append((self.path, value["selected_uids"]))
                self.reply({"configured": True, "address": type(self).address, "uid_validity": 7,
                    "items": [{"mailbox_uid": uid, "mailbox_received_at": DATE,
                               "status": "failed" if type(self).outcome == "failed" or uid == 111 else "parsed",
                               "error": "synthetic-private-parser-detail", "fingerprint": f"fp-{uid}",
                               "message": {"subject": "Synthetic recovered", "sender": "vendor@example.invalid"},
                               "items": [], "fields": {}} for uid in value["selected_uids"]]})
        parser = ThreadingHTTPServer(("127.0.0.1", 0), Parser)
        threading.Thread(target=parser.serve_forever, daemon=True).start()
        with socket.socket() as sock: sock.bind(("127.0.0.1", 0)); port = sock.getsockname()[1]
        base = f"http://127.0.0.1:{port}"; session = ""
        def request(path, payload=None, company="Xingxin", owner=None, expected=200, method=None):
            nonlocal session
            headers = {"Cookie": f"{session}; voyageplex_company={company}; voyageplex_mail_owner={owner or ''}"}
            raw = None if payload is None else json.dumps(payload).encode()
            if raw is not None: headers["Content-Type"] = "application/json"
            try: response = urllib.request.urlopen(urllib.request.Request(base+path, data=raw, headers=headers, method=method), timeout=20)
            except urllib.error.HTTPError as error: response = error
            for cookie in response.headers.get_all("Set-Cookie", []):
                if cookie.startswith("voyageplex_session="): session = cookie.split(";", 1)[0]
            body = response.read()
            assert response.code == expected, (path, response.code, body[:300])
            return json.loads(body) if body else None
        env = {"PATH": str(Path(DOTNET).resolve().parent)+":/usr/bin:/bin:/usr/sbin:/sbin", "HOME": str(owned),
               "DOTNET_CLI_TELEMETRY_OPTOUT": "1", "DOTNET_SYSTEM_NET_DISABLEIPV6": "1",
               "DOTNET_GCHeapHardLimit": "0x8000000", "ASPNETCORE_ENVIRONMENT": "Production", "ASPNETCORE_URLS": base,
               "ConnectionStrings__Default": f"Data Source={database}", "EmailParser__BaseUrl": f"http://127.0.0.1:{parser.server_port}",
               "Logging__LogLevel__Default": "Error", "VOYAGEPLEX_HUADENG_MAILBOXES_JSON": json.dumps([
                   {"username": f"synthetic-owner-{n}", "address": f"owner{n}@example.invalid", "authCode": "synthetic-only",
                    "host": HOST, "folder": "INBOX"} for n in (1, 2)])}
        with (owned/"api.log").open("wb") as log:
            api = subprocess.Popen([DOTNET, str(DLL)], cwd=owned, env=env, stdout=log, stderr=log)
            try:
                deadline = time.monotonic()+30
                while time.monotonic() < deadline:
                    assert api.poll() is None, (owned/"api.log").read_text()[-2000:]
                    try: request("/api/health"); break
                    except (OSError, urllib.error.URLError): time.sleep(.1)
                else: raise AssertionError("Owned API did not start")
                request(LIST, expected=401); check("anonymous candidate GET is denied", True)
                password = secrets.token_urlsafe(24)
                request("/api/auth/setup", {"username": "synthetic-admin", "displayName": "Synthetic admin", "password": password}, expected=201)
                request("/api/auth/login", {"username": "synthetic-admin", "password": password}); admin_session = session
                owners = []
                for n in (1, 2):
                    owner = request("/api/users", {"username": f"synthetic-owner-{n}", "displayName": f"Owner {n}",
                        "password": password, "role": "shipping", "companyAccess": "Huadeng"}, expected=201)["id"]
                    request(f"/api/users/{owner}", {"displayName": f"Owner {n}", "role": "shipping", "companyAccess": "Huadeng",
                        "mailboxAddress": f"owner{n}@example.invalid"}, method="PUT"); owners.append(owner)
                request("/api/users", {"username": "synthetic-supervisor", "displayName": "Supervisor", "password": password,
                    "role": "supervisor", "companyAccess": "Huadeng"}, expected=201)
                request("/api/users", {"username": "synthetic-shipping", "displayName": "Shipping", "password": password,
                    "role": "shipping", "companyAccess": "Xingxin"}, expected=201)
                def insert(db, table, supplied):
                    row = {key: (0 if kind == "INTEGER" else "2026-11-04 00:00:00" if key.endswith("At") else "")
                           for _, key, kind, required, default, primary in db.execute(f"PRAGMA table_info({table})")
                           if not primary and key not in supplied and required and default is None}
                    row.update(supplied)
                    return db.execute(f"INSERT INTO {table} ({','.join(row)}) VALUES ({','.join('?' for _ in row)})", list(row.values())).lastrowid
                def identity(address):
                    return hashlib.sha256(json.dumps({"address": address, "host": HOST, "folder": "INBOX"}, separators=(",", ":")).encode()).hexdigest().upper()
                mail_ids = {}; foreign_ids = []
                with sqlite3.connect(database) as db:
                    db.execute("UPDATE MailSystemSettings SET SyncEnabled=0")
                    db.execute("DELETE FROM MailSyncStates")
                    for owner, address in ((0, ADDRESS), (owners[0], "owner1@example.invalid"), (owners[1], "owner2@example.invalid")):
                        insert(db, "MailSyncStates", {"Id": 1000+owner if owner else 1, "Address": address, "UidValidity": 7,
                            "LastUid": 999, "MailboxIdentity": identity(address) if owner else "", "ConfigurationKey": "SENSITIVE-CONFIG",
                            "LastSuccessAt": "2026-10-13 00:00:00", "LastError": "SENSITIVE-ERROR"})
                        company = "Huadeng" if owner else "Xingxin"
                        for uid in range(101, 131) if not owner else range(301, 308):
                            batch = insert(db, "ImportBatches", {"Company": company, "MailOwnerId": owner, "Kind": "Email",
                                "Status": "PendingConfirmation", "FailedCount": 1, "TotalCount": 1})
                            key = f"Huadeng:{owner}:{identity(address)}:{address}:7:{uid}" if owner else f"{address}:7:{uid}"
                            item = insert(db, "ImportEmailItems", {"ImportBatchId": batch, "Company": company, "MailOwnerId": owner,
                                "MailboxKey": key, "MailReceivedAt": DATE, "MailReceivedDate": "2026-10-13", "Fingerprint": f"fp-{uid}",
                                "MailSubject": "Synthetic " + str(uid), "Status": "failed", "HandlingStatus": "Pending",
                                "HandlingOutcome": "", "TaskIdsJson": "[]", "ResultJson": '{"private":"'+"x"*1048576+'"}', "Error": "SENSITIVE-RAW-ERROR"})
                            mail_ids[owner, uid] = item
                            if owner: foreign_ids.append(item)
                    # Explicit owner guard must exclude malformed Xingxin owner rows as well as upload/parsed records.
                    b = insert(db, "ImportBatches", {"Company": "Xingxin", "MailOwnerId": owners[0], "Kind": "Email", "Status": "PendingConfirmation"})
                    insert(db, "ImportEmailItems", {"Company": "Xingxin", "MailOwnerId": owners[0], "ImportBatchId": b,
                        "MailboxKey": "non-shared", "Status": "failed"})
                    for key, value, uid in (("WorkNote", "manual note", 120), ("HandlingStatus", "Processed", 121),
                        ("ClassificationSource", "Manual", 122), ("TaskIdsJson", "[123]", 123),
                        ("MailboxKey", f"{ADDRESS}:8:124", 124), ("TaskIdsJson", "[", 125)):
                        db.execute(f"UPDATE ImportEmailItems SET {key}=? WHERE Id=?", (value, mail_ids[0, uid]))
                    db.execute("UPDATE ImportBatches SET Status='Confirmed' WHERE Id=(SELECT ImportBatchId FROM ImportEmailItems WHERE Id=?)", (mail_ids[0, 126],))
                    insert(db, "ShipmentTasks", {"Company": "Xingxin", "SourceImportItemId": mail_ids[0, 127], "SourceEmailsJson": "[]"})
                    db.execute("UPDATE ImportEmailItems SET MailSubject=?,Error=? WHERE Id=?", ("S"*1000000, "PRIVATE-ERROR"*10000, mail_ids[0, 130]))
                def snapshot():
                    with sqlite3.connect(database) as db:
                        return {name: hashlib.sha256(repr(db.execute(f"SELECT * FROM {name} ORDER BY Id").fetchall()).encode()).hexdigest()
                            for name in ("ImportEmailItems", "ImportBatches", "MailSyncStates", "MailContacts", "ShipmentTasks", "MailSystemSettings")}
                before = snapshot(); calls_before = len(Parser.calls)
                one = request(LIST); two = request(LIST+"?page=2"); three = request(LIST+"?page=3")
                check("stable 20-row pages enumerate all 30 shared failures once", one["total"] == two["total"] == 30 and
                    len(one["items"]) == 20 and len(two["items"]) == 10 and not three["items"] and
                    [r["id"] for r in one["items"]+two["items"]] == sorted([mail_ids[0, uid] for uid in range(101,131)], reverse=True))
                check("shared response scope and preliminary status are explicit", one["company"] == "Xingxin" and one["ownerId"] is None and
                    one["address"] == ADDRESS and one["preliminaryOnly"] and one["selectionLimit"] == 5 and one["status"]["identityReady"] and one["status"]["hasError"])
                raw = json.dumps(one)
                check("bounded metadata hides private payload, raw error and configuration", len(raw) < 20000 and len(one["items"][0]["mailSubject"]) == 240 and
                    not any(marker in raw for marker in ("SENSITIVE", "PRIVATE-ERROR", "private", "authCode", "configurationKey", "resultJson", "mailboxKey")))
                by_id = {r["id"]: r for r in one["items"]+two["items"]}
                check("manual, processed, linked, malformed and mismatched records are not selectable", all(not by_id[mail_ids[0, uid]]["canRetry"] for uid in range(120,128)))
                check("untouched valid record is only preliminarily selectable", by_id[mail_ids[0, 110]]["canRetry"] and
                    by_id[mail_ids[0, 110]]["mailboxUid"] == 110 and "提交时" in by_id[mail_ids[0,110]]["reason"])
                for n, owner in enumerate(owners, 1):
                    page = request(LIST+f"?ownerId={owners[1 if n == 1 else 0]}&company=Xingxin", company="Huadeng", owner=owner)
                    check(f"Huadeng owner {n} uses authenticated scope, not query overrides", page["ownerId"] == owner and page["company"] == "Huadeng" and
                        page["address"] == f"owner{n}@example.invalid" and len(page["items"]) == 7 and all(r["id"] in [mail_ids[owner, uid] for uid in range(301,308)] for r in page["items"]))
                request(LIST, company="Huadeng", expected=400)
                request(LIST, company="Huadeng", owner=999999, expected=400)
                request(LIST, company="invalid", expected=400)
                check("missing, invalid owner and invalid company fail closed", True)
                for page in ("0", "-1", "2147483647", "abc"):
                    request(LIST+"?page="+page, expected=400)
                check("invalid page values cannot overflow Skip", True)
                for username, company, owner in (("synthetic-shipping", "Xingxin", None), ("synthetic-owner-1", "Huadeng", owners[0]),
                    ("synthetic-supervisor", "Huadeng", owners[0])):
                    session = ""; request("/api/auth/login", {"username": username, "password": password})
                    request(LIST, company=company, owner=owner, expected=403)
                session = admin_session
                check("shipping users and supervisors cannot read candidates", True)
                check("all browsing preserves mail, settings, cursors and never calls parser", snapshot() == before and len(Parser.calls) == calls_before)
                with sqlite3.connect(database) as db: db.execute("DELETE FROM MailSystemSettings WHERE Id=?", (1000+owners[0],))
                before = snapshot(); request(LIST, company="Huadeng", owner=owners[0]); request(LIST, company="Huadeng", expected=400)
                check("candidate GET does not initialize missing personal or unselected settings", snapshot() == before)
                # ASP.NET matches these as the same GET endpoint; middleware must stay read-only too.
                for alias in (LIST + "/", LIST.upper(), LIST.upper() + "/"):
                    page = request(alias, company="Huadeng", owner=owners[0])
                    request(alias, company="Huadeng", expected=400)
                    check("equivalent candidate path stays read-only: " + alias, snapshot() == before and
                        page["ownerId"] == owners[0] and page["total"] == 7)
                with sqlite3.connect(database) as db:
                    db.execute("UPDATE Users SET MailboxAddress='unbound@example.invalid' WHERE Id=?", (owners[0],))
                unavailable = request(LIST, company="Huadeng", owner=owners[0])
                check("unconfigured binding disables candidates without exposing configuration errors", not unavailable["status"]["identityReady"] and
                    unavailable["address"] == "" and all(not row["canRetry"] for row in unavailable["items"]) and snapshot() == before)
                with sqlite3.connect(database) as db:
                    db.execute("UPDATE Users SET MailboxAddress='owner1@example.invalid' WHERE Id=?", (owners[0],))
                    db.execute("UPDATE MailSyncStates SET UidValidity=0 WHERE Id=1")
                invalid_before = snapshot(); unavailable = request(LIST)
                check("invalid shared sync identity stays unchanged and cannot be selected", not unavailable["status"]["identityReady"] and
                    all(not row["canRetry"] for row in unavailable["items"]) and snapshot() == invalid_before)
                with sqlite3.connect(database) as db: db.execute("UPDATE MailSyncStates SET UidValidity=7 WHERE Id=1")
                with sqlite3.connect(database) as db: db.execute("UPDATE Users SET Role='shipping' WHERE Username='synthetic-admin'")
                request(LIST, expected=403)
                with sqlite3.connect(database) as db: db.execute("UPDATE Users SET Role='admin' WHERE Username='synthetic-admin'")
                check("current role revocation is honored on next GET", True)
                for company, owner, item in (("Xingxin", None, mail_ids[owners[0],301]), ("Huadeng", owners[0], mail_ids[owners[1],301]),
                    ("Huadeng", owners[0], mail_ids[0,110])):
                    request(RETRY, {"itemIds": [item]}, company=company, owner=owner, expected=404)
                check("retry retains cross-company and cross-owner denial", len(Parser.calls) == calls_before)
                before = snapshot(); Parser.outcome = "failed"
                result = request(RETRY, {"itemIds": [mail_ids[0,110]]})
                check("unsuccessful retry returns recovered zero and preserves full records and cursor", result == {"requested":1,"recovered":0,"stillFailed":1,"recoveredItemIds":[]} and snapshot() == before)
                Parser.outcome = "parsed"
                result = request(RETRY, {"itemIds": [mail_ids[0,110],mail_ids[0,111]]})
                check("mixed parser result names only the actually recovered item", result == {"requested":2,"recovered":1,"stillFailed":1,"recoveredItemIds":[mail_ids[0,110]]})
                after = snapshot(); latest = request(LIST)
                check("successful retry leaves all mailbox cursors intact and decreases only failed total", after["MailSyncStates"] == before["MailSyncStates"] and latest["total"] == 29)
                Parser.address = "owner1@example.invalid"
                result = request(RETRY, {"itemIds": [mail_ids[owners[0],301]]}, company="Huadeng", owner=owners[0])
                check("personal mailbox retry stays in its owner and preserves independent cursors", result["recoveredItemIds"] == [mail_ids[owners[0],301]] and
                    snapshot()["MailSyncStates"] == before["MailSyncStates"] and request(LIST, company="Huadeng", owner=owners[1])["total"] == 7)
                print(json.dumps({"passed":len(passed),"failed":0,"skipped":0,"loopbackOnly":True,"ownedTemporarySQLite":True}))
            except Exception:
                print((owned/"api.log").read_text()[-4000:])
                raise
            finally:
                if api.poll() is None: api.terminate(); api.wait(timeout=15)
                parser.shutdown(); parser.server_close()

if __name__ == "__main__": run()
