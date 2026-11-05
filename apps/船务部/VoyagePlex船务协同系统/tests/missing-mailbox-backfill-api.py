"""Real HTTP/SQLite missing-mail tests. Only generic fake UIDs and synthetic data."""
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import copy
import hashlib
import json
import os
import shutil
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
DOTNET = os.environ.get("DOTNET_EXECUTABLE") or shutil.which("dotnet")
if not DOTNET:
    raise RuntimeError("Install .NET 8 or set DOTNET_EXECUTABLE to run the isolated API tests")
DOTNET_PATH = str(Path(DOTNET).resolve().parent) + ":/usr/bin:/bin:/usr/sbin:/sbin"
ENDPOINT = "/api/imports/email/mailbox/backfill-missing"
ADDRESS = "owner@example.invalid"
AUTH = "synthetic-local-only"
HOST = "imap.example.invalid"
TODAY = datetime.now(timezone(timedelta(hours=8))).date()
def received(days=3, hour=3): return f"{TODAY-timedelta(days=days)}T{hour:02d}:20:30+00:00"
def digest(value): return hashlib.sha256(value.encode()).hexdigest()


def run():
    passed = []
    with tempfile.TemporaryDirectory(prefix="voyageplex-missing-mail-") as name:
        owned = Path(name); database = owned / "test.db"
        class Parser(BaseHTTPRequestHandler):
            calls = []; variant = "ok"; change = None; dates = {}; fingerprints = {}
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
                if self.path == "/v1/mailbox/poll":
                    return self.reply({"configured": True, "address": payload["address"], "uid_validity": 7, "items": []})
                assert self.path in ("/v1/mailbox/retry", "/v1/mailbox/retry-shared")
                if self.path.endswith("retry-shared"):
                    assert set(payload) == {"company", "selected_uids", "expected_uid_validity", "expected_address"}
                    address = payload["expected_address"]
                else:
                    assert payload["auth_code"] == AUTH and payload["host"] == HOST and payload["folder"] == "INBOX"
                    address = payload["address"]
                type(self).calls.append((self.path, copy.deepcopy(payload)))
                if type(self).change:
                    action = type(self).change; type(self).change = None; action()
                values = [type(self).item(uid) for uid in payload["selected_uids"]]
                if self.variant == "failed": values[-1]["status"] = "failed"
                if self.variant == "date": values[-1]["mailbox_received_at"] = received(3, 4)
                if self.variant == "wrong-uid": values[-1]["mailbox_uid"] += 10000
                if self.variant == "missing": values = values[:-1]
                if self.variant == "duplicate-uid": values.append(copy.deepcopy(values[0]))
                self.reply({"configured": True, "address": address, "uid_validity": 8 if self.variant == "validity" else 7, "items": values})
            @classmethod
            def item(cls, uid):
                return {"mailbox_uid": uid, "mailbox_received_at": cls.dates.get(uid, received()),
                    "filename": f"mail-{uid}.eml", "status": "parsed", "fingerprint": cls.fingerprints.get(uid, digest(str(uid))),
                    "business_fingerprint": digest("business-"+str(uid)), "message": {"subject": "Synthetic shipment",
                        "sender": "vendor@example.invalid", "body_text": f"Complete synthetic body {uid}"},
                    "fields": {"so_number": f"SYNTHETIC-{uid}"}, "items": [{"product_code": "FAKE", "quantity": 3}],
                    "attachments": [{"filename": "synthetic.xlsx", "sha256": digest("attachment"), "fields": {"kept": True}}],
                    "extension_marker": {"nested": ["preserved", uid]}}
            def reply(self, value):
                raw = json.dumps(value).encode(); self.send_response(200); self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(raw))); self.end_headers(); self.wfile.write(raw)

        parser = ThreadingHTTPServer(("127.0.0.1", 0), Parser)
        threading.Thread(target=parser.serve_forever, daemon=True).start()
        with socket.socket() as sock: sock.bind(("127.0.0.1", 0)); port = sock.getsockname()[1]
        base = f"http://127.0.0.1:{port}"
        class Client:
            def __init__(self, company="Xingxin", owner=None): self.company, self.owner, self.cookie = company, owner, ""
            def request(self, path, payload=None, expected=200, method=None):
                raw = None if payload is None else json.dumps(payload).encode()
                headers = {"Cookie": f"voyageplex_company={self.company}; {self.cookie}; voyageplex_mail_owner={self.owner or ''}"}
                if raw is not None: headers["Content-Type"] = "application/json"
                try: response = urllib.request.urlopen(urllib.request.Request(base+path, data=raw, headers=headers, method=method), timeout=20)
                except urllib.error.HTTPError as error: response = error
                for cookie in response.headers.get_all("Set-Cookie", []):
                    if cookie.startswith("voyageplex_session="): self.cookie = cookie.split(";", 1)[0]
                body = response.read(); value = json.loads(body) if body and "application/json" in response.headers.get("Content-Type", "") else None
                assert response.status == expected, (path, response.status, value)
                return value
        env = {"PATH": DOTNET_PATH, "HOME": str(owned), "DOTNET_CLI_TELEMETRY_OPTOUT": "1",
            "ASPNETCORE_ENVIRONMENT": "Production", "ASPNETCORE_URLS": base, "ConnectionStrings__Default": f"Data Source={database}",
            "EmailParser__BaseUrl": f"http://127.0.0.1:{parser.server_port}", "Logging__LogLevel__Default": "Error",
            "VOYAGEPLEX_HUADENG_MAILBOXES_JSON": json.dumps([
                {"username": "synthetic-owner", "address": ADDRESS, "authCode": AUTH, "host": HOST, "folder": "INBOX"},
                {"username": "synthetic-other", "address": "other@example.invalid", "authCode": AUTH, "host": HOST, "folder": "INBOX"}])}
        with (owned/"api.log").open("wb") as log:
            api = subprocess.Popen([DOTNET, str(DLL)], cwd=owned, env=env, stdout=log, stderr=log)
            try:
                admin = Client(); deadline = time.monotonic()+30
                while time.monotonic() < deadline:
                    assert api.poll() is None
                    try: admin.request("/api/health"); break
                    except (OSError, urllib.error.URLError): time.sleep(.1)
                else: raise AssertionError("owned API not ready")
                password = secrets.token_urlsafe(24)
                actor = admin.request("/api/auth/setup", {"username":"synthetic-admin","displayName":"Synthetic","password":password}, 201)
                admin.request("/api/auth/login", {"username":"synthetic-admin","password":password})
                users = {}
                for suffix in ("owner", "other"):
                    user = admin.request("/api/users", {"username":"synthetic-"+suffix,"displayName":suffix,"password":password,
                        "role":"shipping","companyAccess":"Huadeng","mailboxAddress":ADDRESS if suffix=="owner" else "other@example.invalid"}, 201)
                    users[suffix] = user["id"]
                    admin.request(f"/api/users/{user['id']}", {"displayName":suffix,"role":"shipping","companyAccess":"Huadeng",
                        "mailboxAddress":ADDRESS if suffix=="owner" else "other@example.invalid"},method="PUT")
                owner = users["owner"]; other = users["other"]
                admin.company = "Huadeng"; admin.owner = owner
                admin.request("/api/mail/settings", {"syncEnabled":False,"startDate":str(TODAY-timedelta(days=90)),"retentionDays":30}, method="PATCH")
                admin.request("/api/imports/email/mailbox/sync", {})
                def insert(c, table, supplied):
                    fields = {}
                    for _, key, kind, required, default, primary in c.execute(f"PRAGMA table_info({table})"):
                        if not primary and key not in supplied and required and default is None:
                            fields[key] = 0 if kind=="INTEGER" else "2026-01-01 00:00:00" if key.endswith("At") else ""
                    fields.update(supplied)
                    return c.execute(f"INSERT INTO {table} ({','.join(fields)}) VALUES ({','.join('?' for _ in fields)})",list(fields.values())).lastrowid
                with sqlite3.connect(database) as c:
                    c.execute("UPDATE MailSystemSettings SET SyncEnabled=0")
                    c.execute("UPDATE MailSyncStates SET LastUid=500 WHERE Id=?",(1000+owner,))
                    for sid in (1,2,1000+other):
                        c.execute("DELETE FROM MailSyncStates WHERE Id=?",(sid,))
                        insert(c,"MailSyncStates",{"Id":sid,"LastUid":500,"UidValidity":7,"Address":"shared@example.invalid","MailboxIdentity":"","ConfigurationKey":""})
                def row(table, target):
                    with sqlite3.connect(database) as c:
                        c.row_factory=sqlite3.Row
                        return dict(c.execute(f"SELECT * FROM {table} WHERE Id=?",(target,)).fetchone())
                def rows(table):
                    with sqlite3.connect(database) as c:return c.execute(f"SELECT * FROM {table} ORDER BY Id").fetchall()
                def snapshot(): return {table:rows(table) for table in ("ImportEmailItems","ImportBatches","MailContacts","MailReviewAudits","MailSyncStates","MailSystemSettings","ShipmentTasks")}
                def request(uids, state_id=None):
                    state=row("MailSyncStates",state_id or 1000+owner)
                    return {"expectedUidValidity":state["UidValidity"],"capturedLastUid":state["LastUid"],
                        "expectedAddressSHA256":digest(state["Address"]),"expectedMailboxIdentitySHA256":digest(state["MailboxIdentity"]),
                        "expectedConfigurationKeySHA256":digest(state["ConfigurationKey"]),
                        "messages":[{"uid":uid,"receivedAt":Parser.dates.get(uid,received())} for uid in uids],"reason":"Synthetic explicit missing-mail recovery"}
                def original_mail(uid, mailbox_owner, fp, status="pending", note="keep original"):
                    with sqlite3.connect(database) as c:
                        batch=insert(c,"ImportBatches",{"Company":"Huadeng","MailOwnerId":mailbox_owner,"Kind":"Email","Status":"PendingConfirmation","TotalCount":1,"ParsedCount":1})
                        return insert(c,"ImportEmailItems",{"Company":"Huadeng","MailOwnerId":mailbox_owner,"ImportBatchId":batch,
                            "MailboxKey":f"old-{mailbox_owner}-{uid}","Fingerprint":fp,"Status":status,"HandlingStatus":"Processed",
                            "HandlingOutcome":"NoTask","TaskIdsJson":"[]","WorkNote":note,"ClassificationSource":"Manual","ResultJson":"{}"})
                old_other=original_mail(81,other,digest("101"));old_own=original_mail(82,owner,digest("102"))
                old_rows={target:row("ImportEmailItems",target) for target in (old_other,old_own)}
                with sqlite3.connect(database) as c:
                    own_contact=insert(c,"MailContacts",{"Company":"Huadeng","MailOwnerId":owner,"Email":"vendor@example.invalid",
                        "DisplayName":"Existing vendor","ContactType":"Customer","DefaultCategory":"FollowUp","IsConfirmed":1,"MessageCount":2})
                    other_contact=insert(c,"MailContacts",{"Company":"Huadeng","MailOwnerId":other,"Email":"vendor@example.invalid","MessageCount":7})
                original_contact=row("MailContacts",own_contact);other_contact_before=row("MailContacts",other_contact)
                Parser.dates[104]=received(2)
                payload=request([104,102,101,103]);before=snapshot();calls=len(Parser.calls)
                Client("Huadeng",owner).request(ENDPOINT,payload,401)
                shipping=Client("Huadeng",owner);shipping.request("/api/auth/login",{"username":"synthetic-owner","password":password})
                shipping.request(ENDPOINT,payload,403)
                malformed=copy.deepcopy(payload);malformed["authCode"]="never forward"
                admin.request(ENDPOINT,malformed,400)
                for key,val in (("expectedUidValidity",True),("capturedLastUid",0),("expectedAddressSHA256","bad")):
                    changed=copy.deepcopy(payload);changed[key]=val;admin.request(ENDPOINT,changed,400)
                assert len(Parser.calls)==calls and before==snapshot()
                passed.append("admin-only and strict approved namespace/UID request; credential overrides rejected without parser or DB writes")

                result=admin.request(ENDPOINT,payload)
                assert result["requested"]==result["imported"]==4
                assert Parser.calls[-1][1]["selected_uids"]==[101,102,103,104]
                actual={item["uid"]:row("ImportEmailItems",item["itemId"])for item in result["items"]}
                for uid,item in actual.items():
                    assert item["Company"]=="Huadeng" and item["MailOwnerId"]==owner
                    assert json.loads(item["ResultJson"])==Parser.item(uid)
                    assert item["HandlingStatus"]=="Pending" and item["HandlingOutcome"]=="" and item["TaskIdsJson"]=="[]"
                    assert item["MailReceivedAt"]==Parser.dates.get(uid,received())
                assert actual[101]["Status"]=="pending" and actual[101]["DuplicateOfItemId"] is None
                assert actual[102]["Status"]=="duplicate" and actual[102]["DuplicateOfItemId"]==old_own
                assert all(row("ImportEmailItems",target)==old for target,old in old_rows.items())
                assert before["MailSyncStates"]==rows("MailSyncStates") and before["ShipmentTasks"]==rows("ShipmentTasks") and before["MailSystemSettings"]==rows("MailSystemSettings")
                with sqlite3.connect(database) as c:
                    batch_counts=c.execute("SELECT TotalCount,ParsedCount,FailedCount FROM ImportBatches WHERE Id IN (SELECT ImportBatchId FROM ImportEmailItems WHERE MailboxKey LIKE 'Huadeng:%') ORDER BY TotalCount").fetchall()
                    assert batch_counts==[(1,1,0),(3,3,0)]
                    assert c.execute("SELECT COUNT(*) FROM MailReviewAudits WHERE Action='BackfillMissing'").fetchone()[0]==4
                    assert c.execute("SELECT MessageCount FROM MailContacts WHERE Company='Huadeng' AND MailOwnerId=?",(owner,)).fetchone()[0]==6
                current_contact=row("MailContacts",own_contact)
                assert all(current_contact[key]==value for key,value in original_contact.items() if key not in {"MessageCount","UpdatedAt"})
                assert row("MailContacts",other_contact)==other_contact_before
                stable=snapshot();admin.request(ENDPOINT,payload,409);assert stable==snapshot()
                passed.append("four fake historical UIDs preserve complete content/dates/owner isolation, date batches/contact counts/audit; no tasks or cursor writes; replay rejected")

                for variant in ("failed","date","wrong-uid","missing","duplicate-uid","validity"):
                    Parser.variant=variant;before=snapshot();admin.request(ENDPOINT,request([201,202]),409);assert before==snapshot(),variant
                Parser.variant="ok"
                passed.append("any parse, received-time, UID-collection or UIDVALIDITY failure rolls back the entire selected batch")

                for change in (lambda p:p.update(expectedMailboxIdentitySHA256="0"*64),lambda p:p.update(expectedConfigurationKeySHA256="0"*64),lambda p:p.update(expectedUidValidity=8)):
                    p=request([203]);change(p);before=snapshot();calls=len(Parser.calls);admin.request(ENDPOINT,p,409);assert before==snapshot() and len(Parser.calls)==calls
                for date,expected in ((received(40),409),(str(TODAY)+"T01:00:00",400),(str(TODAY+timedelta(days=1))+"T01:00:00Z",409)):
                    p=request([203]);p["messages"][0]["receivedAt"]=date;before=snapshot();calls=len(Parser.calls);admin.request(ENDPOINT,p,expected);assert before==snapshot() and len(Parser.calls)==calls
                p=request([501]);before=snapshot();calls=len(Parser.calls);admin.request(ENDPOINT,p,400);assert before==snapshot() and len(Parser.calls)==calls
                with sqlite3.connect(database) as c:c.execute("UPDATE MailSystemSettings SET StartDate=? WHERE Id=?",(str(TODAY-timedelta(days=1)),1000+owner))
                before=snapshot();calls=len(Parser.calls);admin.request(ENDPOINT,request([203]),409);assert before==snapshot() and len(Parser.calls)==calls
                with sqlite3.connect(database) as c:c.execute("UPDATE MailSystemSettings SET StartDate=? WHERE Id=?",(str(TODAY-timedelta(days=90)),1000+owner))
                passed.append("namespace, approved cursor, explicit timezone and configured retention/date bounds checked before fetching")

                existing=original_mail(109,owner,digest("existing"),status="failed")
                state=row("MailSyncStates",1000+owner)
                with sqlite3.connect(database) as c:c.execute("UPDATE ImportEmailItems SET MailboxKey=? WHERE Id=?",(f"Huadeng:{owner}:{state['MailboxIdentity']}:{ADDRESS}:7:109",existing))
                before=snapshot();calls=len(Parser.calls);admin.request(ENDPOINT,request([109]),409);assert before==snapshot() and len(Parser.calls)==calls
                passed.append("backfill cannot overwrite existing failed or manually handled records; existing retry remains a separate action")

                p=request([204]);saved_state=row("MailSyncStates",1000+owner)
                def config_change():
                    with sqlite3.connect(database) as c:c.execute("UPDATE MailSyncStates SET ConfigurationKey='changed meanwhile' WHERE Id=?",(1000+owner,))
                Parser.change=config_change;before=snapshot();admin.request(ENDPOINT,p,409)
                assert rows("ImportEmailItems")==before["ImportEmailItems"] and rows("MailContacts")==before["MailContacts"]
                assert row("MailSyncStates",1000+owner)["ConfigurationKey"]=="changed meanwhile"
                # Restore only this test's saved configuration string, never production data.
                with sqlite3.connect(database) as c:
                    c.execute("UPDATE MailSyncStates SET ConfigurationKey=? WHERE Id=?",(saved_state["ConfigurationKey"],1000+owner))
                passed.append("configuration race after fetch rejects before new rows and preserves concurrent state")

                p=request([207,208]);before=snapshot();raced=[]
                def competing_insert():
                    target=original_mail(207,owner,digest("competing"),note="concurrent insertion wins")
                    with sqlite3.connect(database) as c:c.execute("UPDATE ImportEmailItems SET MailboxKey=? WHERE Id=?",(f"Huadeng:{owner}:{saved_state['MailboxIdentity']}:{ADDRESS}:7:207",target))
                    raced.append(target)
                Parser.change=competing_insert;admin.request(ENDPOINT,p,409)
                assert len(rows("ImportEmailItems"))==len(before["ImportEmailItems"])+1 and row("ImportEmailItems",raced[0])["WorkNote"]=="concurrent insertion wins"
                assert rows("MailContacts")==before["MailContacts"] and rows("MailReviewAudits")==before["MailReviewAudits"] and rows("MailSyncStates")==before["MailSyncStates"]
                passed.append("a concurrent exact-key insertion wins; none of the other selected mails or contact/audit rows are inserted")

                p=request([209]);before=snapshot()
                def rebind():
                    with sqlite3.connect(database) as c:c.execute("UPDATE Users SET MailboxAddress='changed@example.invalid' WHERE Id=?",(owner,))
                Parser.change=rebind;admin.request(ENDPOINT,p,409);assert before==snapshot()
                assert row("Users",owner)["MailboxAddress"]=="changed@example.invalid"
                with sqlite3.connect(database) as c:c.execute("UPDATE Users SET MailboxAddress=? WHERE Id=?",(ADDRESS,owner))
                actor_id=admin.request("/api/auth/me")["id"];p=request([210]);before=snapshot()
                def revoke():
                    with sqlite3.connect(database) as c:c.execute("UPDATE Users SET Role='shipping' WHERE Id=?",(actor_id,))
                Parser.change=revoke;admin.request(ENDPOINT,p,403);assert before==snapshot()
                with sqlite3.connect(database) as c:c.execute("UPDATE Users SET Role='admin' WHERE Id=?",(actor_id,))
                passed.append("mailbox rebind and administrator privilege revocation during parsing prevent all recovery writes")

                def progress():
                    with sqlite3.connect(database) as c:c.execute("UPDATE MailSyncStates SET LastUid=501,LastError='natural forward progress' WHERE Id=?",(1000+owner,))
                Parser.change=progress;p=request([205]);assert admin.request(ENDPOINT,p)["imported"]==1
                assert row("MailSyncStates",1000+owner)["LastUid"]==501 and row("MailSyncStates",1000+owner)["LastError"]=="natural forward progress"
                passed.append("natural forward progress is accepted without restoring the old cursor snapshot")

                before=snapshot()
                with sqlite3.connect(database) as c:c.execute("CREATE TRIGGER synthetic_fail_backfill_audit BEFORE INSERT ON MailReviewAudits WHEN NEW.Action='BackfillMissing' BEGIN SELECT RAISE(ABORT,'synthetic audit failure'); END")
                admin.request(ENDPOINT,request([206]),502)
                assert before==snapshot()
                with sqlite3.connect(database) as c:c.execute("DROP TRIGGER synthetic_fail_backfill_audit")
                passed.append("audit insertion failure atomically rolls back rows, batches and contact changes")

                admin.company="Xingxin";admin.owner=None
                # Prepare the independent shared fixture directly: the normal settings
                # endpoint intentionally rewinds when startDate changes, which this test is not exercising.
                with sqlite3.connect(database) as c:c.execute("UPDATE MailSystemSettings SET SyncEnabled=0,StartDate=?,RetentionDays=30 WHERE Id=1",(str(TODAY-timedelta(days=90)),))
                before_states=rows("MailSyncStates");p=request([301],1);shared=admin.request(ENDPOINT,p);assert shared["imported"]==1
                assert Parser.calls[-1][0]=="/v1/mailbox/retry-shared" and rows("MailSyncStates")==before_states
                shared_row=row("ImportEmailItems",shared["items"][0]["itemId"])
                assert shared_row["Company"]=="Xingxin" and shared_row["MailOwnerId"]==0 and shared_row["MailboxKey"]=="shared@example.invalid:7:301"
                passed.append("shared Xingxin owner-zero backfill uses credential-free selected-UID request and leaves every state untouched")
                for line in passed:print("PASS",line)
                print(json.dumps({"passed":len(passed),"failed":0,"skipped":0,"allDataOwnedTempSQLite":True}))
            finally:
                api.terminate();api.wait(timeout=15);parser.shutdown();parser.server_close()


if __name__=="__main__":run()
