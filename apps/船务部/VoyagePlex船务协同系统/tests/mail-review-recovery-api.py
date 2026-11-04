"""Real HTTP/SQLite task-review recovery tests. Own temp DB, fresh environment,
fake loopback parser only; no inherited mailbox credentials or production files.
Run after building the API with an offline package source.
"""
from concurrent.futures import ThreadPoolExecutor
from http.cookies import SimpleCookie
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
PREFIX = "MR-" + secrets.token_hex(5)


def run():
    passed = []
    with tempfile.TemporaryDirectory(prefix="voyageplex-mail-review-") as name:
        owned = Path(name).resolve()
        db_path = owned / "review-test.db"
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            port = sock.getsockname()[1]
        base = f"http://127.0.0.1:{port}"

        class FakeParser(BaseHTTPRequestHandler):
            def log_message(self, *args): pass
            def do_GET(self): self.reply()
            def do_POST(self): self.reply()
            def reply(self):
                body = b'{"configured":false,"items":[]}'
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

        parser = ThreadingHTTPServer(("127.0.0.1", 0), FakeParser)
        threading.Thread(target=parser.serve_forever, daemon=True).start()

        class Client:
            def __init__(self, company="Huadeng", session=""):
                self.company, self.session = company, session
            def request(self, path, payload=None, expected=200, method=None):
                data = None if payload is None else json.dumps(payload).encode()
                headers = {"Cookie": f"voyageplex_company={self.company}; voyageplex_session={self.session}"}
                if data is not None: headers["Content-Type"] = "application/json"
                req = urllib.request.Request(base + path, data=data, method=method, headers=headers)
                try:
                    response = urllib.request.urlopen(req, timeout=20)
                except urllib.error.HTTPError as error:
                    response = error
                cookie = SimpleCookie()
                for value in response.headers.get_all("Set-Cookie", []): cookie.load(value)
                if "voyageplex_session" in cookie: self.session = cookie["voyageplex_session"].value
                raw = response.read()
                result = json.loads(raw) if raw and response.headers.get("content-type", "").startswith("application/json") else None
                assert response.code == expected, (path, response.code, result)
                return result
            def clone(self): return Client(self.company, self.session)

        admin = Client("Xingxin")
        # No .env/appsettings or user HOME configuration is read: content root and
        # working directory are our temp directory, and environment is allowlisted.
        env = {
            "PATH": "/Users/fovo/.dotnet:/usr/bin:/bin:/usr/sbin:/sbin",
            "HOME": str(owned), "DOTNET_CLI_TELEMETRY_OPTOUT": "1",
            "ASPNETCORE_ENVIRONMENT": "Production", "ASPNETCORE_URLS": base,
            "ConnectionStrings__Default": f"Data Source={db_path}",
            "EmailParser__BaseUrl": f"http://127.0.0.1:{parser.server_port}",
            "VOYAGEPLEX_HUADENG_MAILBOXES_JSON": "[]",
            "Logging__LogLevel__Default": "Error",
        }
        with open(owned / "api.private.log", "wb") as log:
            process = subprocess.Popen(["/Users/fovo/.dotnet/dotnet", str(DLL)], cwd=owned,
                                       env=env, stdout=log, stderr=log)
            try:
                deadline = time.monotonic() + 30
                while time.monotonic() < deadline:
                    assert process.poll() is None, "Owned test API exited before readiness"
                    try:
                        admin.request("/api/health")
                        break
                    except (OSError, urllib.error.URLError): time.sleep(.1)
                else: raise AssertionError("Owned test API readiness timeout")

                password = secrets.token_urlsafe(24)
                admin.request("/api/auth/setup", {"username": PREFIX.lower()+"admin", "displayName": PREFIX+" admin", "password": password}, expected=201)
                admin.request("/api/auth/login", {"username": PREFIX.lower()+"admin", "password": password})
                users = {}
                for suffix, role, company in [("owner", "shipping", "Huadeng"), ("other", "shipping", "Huadeng"),
                                               ("supervisor", "supervisor", "Huadeng"), ("warehouse", "warehouse", "Huadeng"),
                                               ("xingxin", "shipping", "Xingxin")]:
                    created = admin.request("/api/users", {"username": PREFIX.lower()+suffix, "displayName": PREFIX+suffix,
                        "password": password, "role": role, "companyAccess": company}, expected=201)
                    user = Client(company)
                    user.request("/api/auth/login", {"username": PREFIX.lower()+suffix, "password": password})
                    users[suffix] = (created["id"], user)
                owner_id, owner = users["owner"]
                other_id, other = users["other"]
                admin.company = "Huadeng"

                def insert(c, table, supplied):
                    fields = {}
                    for _, key, kind, required, default, primary in c.execute(f"PRAGMA table_info({table})"):
                        if primary or key in supplied: continue
                        if required and default is None:
                            fields[key] = 0 if kind == "INTEGER" else "2026-11-04 00:00:00" if key.endswith("At") else ""
                    if table == "ShipmentTasks":
                        fields.update(ItemsJson="[]", WarehouseGroupsJson="[]", SourceEmailsJson="[]", ExportDetailsJson="{}")
                    fields.update(supplied)
                    return c.execute(f"INSERT INTO {table} ({','.join(fields)}) VALUES ({','.join('?' for _ in fields)})", list(fields.values())).lastrowid
                with sqlite3.connect(db_path) as c:
                    c.execute("UPDATE MailSystemSettings SET SyncEnabled=0")
                    batch = insert(c, "ImportBatches", {"Company": "Huadeng", "MailOwnerId": owner_id, "Kind": "Email", "Status": "PendingConfirmation"})
                    for state_id in (1, 2, 1000+owner_id, 1000+other_id, 1000+users["supervisor"][0]):
                        c.execute("DELETE FROM MailSyncStates WHERE Id=?", (state_id,))
                        insert(c,"MailSyncStates",{"Id":state_id,"LastUid":123456+state_id,"UidValidity":7,
                            "Address":"synthetic@example.invalid","MailboxIdentity":PREFIX+str(state_id),"ConfigurationKey":"synthetic-key"})
                def mail(label, category="Change", so=None, mode="Container", company="Huadeng", actor=owner_id, handling="Processed", **extra):
                    so = so or PREFIX+label
                    parsed = {"message": {"subject": PREFIX+label, "sender": "synthetic@example.invalid"},
                        "so_numbers": [so], "fields": {"so_number": so, "ship_date": "2026-11-10"},
                        "items": [{"product_code": PREFIX+"-cargo", "quantity": 5}], "warehouse_groups": []}
                    with sqlite3.connect(db_path) as c:
                        return insert(c, "ImportEmailItems", dict(ImportBatchId=batch, Company=company, MailOwnerId=actor,
                            MailboxKey=PREFIX+secrets.token_hex(5), MailSubject=PREFIX+label, MailReceivedAt="2026-11-04T03:37:00Z",
                            MailReceivedDate="2026-11-04", WorkCategory=category, ShipmentMode=mode, Status="pending",
                            HandlingStatus=handling, HandlingOutcome="NoTask" if handling=="Processed" else "", TaskIdsJson="[]",
                            NeedsClassificationReview=0, ResultJson=json.dumps(parsed), **extra))
                def row(item):
                    with sqlite3.connect(db_path) as c:
                        c.row_factory = sqlite3.Row
                        return dict(c.execute("SELECT * FROM ImportEmailItems WHERE Id=?", (item,)).fetchone())
                def detail(item, client=owner): return client.request(f"/api/imports/email/mailbox/items/{item}")
                def restore(item, version=None, client=owner, expected=200):
                    return client.request(f"/api/mail/candidates/{item}/restore-review",
                        {"expectedReviewVersion": version or detail(item, client)["reviewVersion"], "reason": PREFIX+" user chose restore"}, expected=expected)
                def tasks():
                    with sqlite3.connect(db_path) as c: return c.execute("SELECT COUNT(*) FROM ShipmentTasks").fetchone()[0]
                def raw_states():
                    with sqlite3.connect(db_path) as c: return c.execute("SELECT * FROM MailSyncStates ORDER BY Id").fetchall()

                target = mail("target")
                before = row(target); cursors = raw_states(); no_tasks = tasks()
                version = detail(target)["reviewVersion"]
                restored = restore(target, version)
                after = row(target)
                assert restored["reviewVersion"] == detail(target)["reviewVersion"], "response token survives real SQLite round-trip"
                assert after["HandlingStatus"] == "Pending" and after["HandlingOutcome"] == ""
                assert {k:v for k,v in before.items() if k not in {"HandlingStatus","HandlingOutcome","ReviewedAt"}} == {
                    k:v for k,v in after.items() if k not in {"HandlingStatus","HandlingOutcome","ReviewedAt"}}
                assert tasks() == no_tasks and raw_states() == cursors
                with sqlite3.connect(db_path) as c:
                    audit = c.execute("SELECT ActorId,Action,BeforeVersion,OldHandlingStatus,OldHandlingOutcome,NewHandlingStatus,NewHandlingOutcome FROM MailReviewAudits WHERE ImportEmailItemId=?", (target,)).fetchall()
                    assert audit == [(owner_id, "RestoreReview", version, "Processed", "NoTask", "Pending", "")]
                    assert c.execute("SELECT AfterVersion FROM MailReviewAudits WHERE ImportEmailItemId=?",(target,)).fetchone()[0] == restored["reviewVersion"]
                restore(target, version, expected=409)
                passed.append("restore preserves full original document/classification/cursor, creates no task; exact durable audit and stale retry rejected")

                auth_item = mail("permissions")
                token = detail(auth_item)["reviewVersion"]
                restore(auth_item, token, client=other, expected=404)
                restore(auth_item, token, client=users["warehouse"][1], expected=403)
                users["xingxin"][1].company = "Huadeng"
                restore(auth_item, token, client=users["xingxin"][1], expected=403)
                Client().request(f"/api/mail/candidates/{auth_item}/restore-review", {"expectedReviewVersion": token, "reason":"test"}, expected=401)
                restore(auth_item, token, client=users["supervisor"][1])
                x_item = mail("cross-company", company="Xingxin")
                restore(x_item, "0"*64, client=admin, expected=404)
                passed.append("authentication, mailbox owner, supervisor, warehouse and cross-company isolation")

                stale = mail("stale")
                token = detail(stale)["reviewVersion"]
                with sqlite3.connect(db_path) as c: c.execute("UPDATE ImportEmailItems SET WorkNote='changed after preview' WHERE Id=?", (stale,))
                restore(stale, token, expected=409)
                hidden = mail("hidden-source")
                hidden_json = mail("hidden-json-source")
                ambiguous = mail("ambiguous")
                with sqlite3.connect(db_path) as c:
                    insert(c,"ShipmentTasks",{"Company":"Huadeng","Customer":PREFIX,"SourceImportItemId":hidden,"SourceGroupKey":"","ItemsJson":"[]","SourceEmailsJson":"[]"})
                    insert(c,"ShipmentTasks",{"Company":"Huadeng","Customer":PREFIX,"SourceEmailsJson":json.dumps([{"id":hidden_json}]),"ItemsJson":"[]"})
                    for _ in range(2): insert(c,"ShipmentTasks",{"Company":"Huadeng","Customer":PREFIX,"SoNumber":PREFIX+"ambiguous","SourceGroupKey":"","ItemsJson":"[]","SourceEmailsJson":"[]"})
                restore(hidden, expected=409); restore(hidden_json, expected=409)
                restore(ambiguous)
                owner.request(f"/api/mail/candidates/{ambiguous}/confirm", {}, expected=400)
                assert row(ambiguous)["HandlingStatus"] == "Pending" and row(ambiguous)["Status"] == "pending"
                passed.append("stale edited payload, hidden source links and ambiguous SO never choose first or create a task")

                duplicate = mail("processed-duplicate", Fingerprint=PREFIX+"duplicate")
                confirmed_duplicate = mail("confirmed-duplicate", Fingerprint=PREFIX+"duplicate", actor=other_id)
                with sqlite3.connect(db_path) as c:
                    existing_task=insert(c,"ShipmentTasks",{"Company":"Huadeng","Customer":PREFIX,"SoNumber":PREFIX+"duplicate"})
                    c.execute("UPDATE ImportEmailItems SET Status='confirmed',HandlingOutcome='Task',TaskIdsJson=? WHERE Id=?",
                        (json.dumps([existing_task]),confirmed_duplicate))
                restore(duplicate, expected=409)
                assert row(duplicate)["HandlingStatus"] == "Processed"
                passed.append("confirmed duplicate task linkage across mailboxes blocks misleading NoTask restore")

                missing = mail("missing")
                restore(missing)
                count = tasks(); doc = row(missing)
                owner.request(f"/api/mail/candidates/{missing}/confirm", {}, expected=400)
                assert row(missing) == doc and tasks() == count
                passed.append("Change with no real target rejects and transaction rolls back; never coerced to Shipment")

                for label, overrides in [
                    ("parse-failed", {"Status":"failed"}),
                    ("needs-classification", {"NeedsClassificationReview":1}),
                    ("not-task-category", {"WorkCategory":"FollowUp"}),
                    ("invalid-task-ids", {"TaskIdsJson":"[0]"}),
                ]:
                    guarded=mail("guard-"+label)
                    with sqlite3.connect(db_path) as c:
                        c.execute("UPDATE ImportEmailItems SET "+",".join(key+"=?" for key in overrides)+" WHERE Id=?", [*overrides.values(), guarded])
                    original=row(guarded)
                    guarded_detail=detail(guarded)
                    assert not guarded_detail["canRestoreReview"]
                    restore(guarded, guarded_detail["reviewVersion"], expected=409)
                    assert row(guarded)==original
                    with sqlite3.connect(db_path) as c:
                        assert c.execute("SELECT COUNT(*) FROM MailReviewAudits WHERE ImportEmailItemId=?",(guarded,)).fetchone()[0]==0
                passed.append("failed, unclassified, non-task and invalid linkage records remain unchanged and cannot be restored")

                concurrent = mail("concurrent")
                token = detail(concurrent)["reviewVersion"]
                def race(_):
                    client=owner.clone()
                    try:
                        restore(concurrent,token,client=client); return 200
                    except AssertionError as error:
                        assert error.args[0][1] == 409, error
                        return 409
                with ThreadPoolExecutor(max_workers=2) as pool: statuses=list(pool.map(race,range(2)))
                assert sorted(statuses)==[200,409]
                with sqlite3.connect(db_path) as c: assert c.execute("SELECT COUNT(*) FROM MailReviewAudits WHERE ImportEmailItemId=? AND Action='RestoreReview'",(concurrent,)).fetchone()[0]==1
                passed.append("two real concurrent restore requests serialize; one audit/one success")

                same_a = mail("concurrent-shipment-a",category="Shipment",so=PREFIX+"same-so",handling="Pending",Fingerprint=PREFIX+"same-content")
                same_b = mail("concurrent-shipment-b",category="Shipment",so=PREFIX+"same-so",handling="Pending",Fingerprint=PREFIX+"same-content")
                count=tasks()
                def confirm_race(item): return owner.clone().request(f"/api/mail/candidates/{item}/confirm",{})["taskIds"]
                with ThreadPoolExecutor(max_workers=2) as pool: linked=list(pool.map(confirm_race,[same_a,same_b]))
                assert len(linked[0])==1 and linked[0]==linked[1] and tasks()==count+1
                passed.append("concurrent identical mail confirmations create one task and link both records")

                rollback = mail("audit-rollback")
                doc=row(rollback)
                with sqlite3.connect(db_path) as c: c.execute("CREATE TRIGGER fail_synthetic_mail_audit BEFORE INSERT ON MailReviewAudits BEGIN SELECT RAISE(ABORT,'synthetic audit failure'); END")
                restore(rollback,expected=500)
                assert row(rollback)==doc
                with sqlite3.connect(db_path) as c: c.execute("DROP TRIGGER fail_synthetic_mail_audit")
                passed.append("failed audit insertion rolls back the actual mail status update")

                for mode in ("Container","Warehouse"):
                    item=mail("link-"+mode,so=PREFIX+mode)
                    with sqlite3.connect(db_path) as c:
                        task=insert(c,"ShipmentTasks",{"Company":"Huadeng","Customer":PREFIX,"SoNumber":PREFIX+mode,"SourceGroupKey":"",
                            "ResponsibleUserId":other_id,"ResponsibleUserName":PREFIX+"other","ItemsJson":"[]","SourceEmailsJson":"[]",
                            "ExportDetailsJson":json.dumps({"shipmentMode":mode})})
                    restore(item)
                    endpoint=f"/api/mail/candidates/{item}/confirm"
                    warning=owner.request(endpoint,{},expected=409)
                    assert warning["code"]=="OtherTaskOwner" and row(item)["HandlingStatus"]=="Pending"
                    owner.request(endpoint,{"ownerConfirmations":{str(task):other_id}})
                    final=detail(item)
                    assert final["handlingStatus"]=="Processed" and final["handlingOutcome"]=="Task" and json.loads(final["taskIdsJson"])==[task]
                    assert final["linkedTasks"]==[{"id":task,"shipmentMode":mode}]
                    with sqlite3.connect(db_path) as c:
                        source=json.loads(c.execute("SELECT SourceEmailsJson FROM ShipmentTasks WHERE Id=?",(task,)).fetchone()[0])
                        assert [s["id"]for s in source]==[item]
                        assert c.execute("SELECT COUNT(*) FROM TaskEditAudits WHERE TaskId=?",(task,)).fetchone()[0]==1
                    owner.request(endpoint,{},expected=409)
                    restore(item,final["reviewVersion"],expected=409)
                assert raw_states()==cursors
                passed.append("real Change confirmation retains owner warning/audit, links genuine task once and opens saved Container/Warehouse mode")

                for label, export, groups, expected_mode in [
                    ("legacy-empty", "{}", "[]", "Unknown"),
                    ("legacy-groups", '{"shipmentMode":"Unknown"}', '[{"warehouse":"synthetic"}]', "Warehouse"),
                    ("malformed-export-groups", "{", '[{"warehouse":"synthetic"}]', "Warehouse"),
                    ("explicit-container", '{"shipmentMode":"Container"}', '[{"warehouse":"synthetic"}]', "Container"),
                ]:
                    item=mail("mode-"+label)
                    with sqlite3.connect(db_path) as c:
                        task=insert(c,"ShipmentTasks",{"Company":"Huadeng","Customer":PREFIX,
                            "ExportDetailsJson":export,"WarehouseGroupsJson":groups})
                        c.execute("UPDATE ImportEmailItems SET TaskIdsJson=? WHERE Id=?",(json.dumps([task]),item))
                    assert detail(item)["linkedTasks"]==[{"id":task,"shipmentMode":expected_mode}]
                passed.append("actual saved mode: empty legacy remains Unknown, warehouse groups survive unknown/malformed export, explicit Container wins")

                for line in passed: print("PASS", line)
                print(json.dumps({"passed":len(passed),"failed":0,"skipped":0,"productionDataOrNetworkUsed":False,"allDataOwnedTempSQLite":True}))
            except BaseException:
                # This log contains only this test's synthetic requests/database.
                print((owned / "api.private.log").read_text()[-8000:])
                raise
            finally:
                process.terminate()
                process.wait(timeout=15)
                parser.shutdown(); parser.server_close()


if __name__ == "__main__": run()
