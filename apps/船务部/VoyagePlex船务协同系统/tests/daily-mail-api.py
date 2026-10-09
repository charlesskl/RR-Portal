"""Daily mailbox API regression tests using an isolated SQLite database and local API."""
import http.cookiejar
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import threading
import json
import os
from pathlib import Path
import secrets
import socket
import sqlite3
import subprocess
import tempfile
import time
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
DLL = ROOT / "server/VoyagePlex.Api/bin/Debug/net8.0/VoyagePlex.Api.dll"


def run():
    with tempfile.TemporaryDirectory(prefix="voyageplex-mail-tests-") as directory:
        directory = Path(directory)
        db_path = directory / "test.db"
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            port = sock.getsockname()[1]
        base = f"http://127.0.0.1:{port}"
        class ParserStub(BaseHTTPRequestHandler):
            calls = []
            def log_message(self, *args): pass
            def do_GET(self): self.send_payload({"configured":False,"items":[]})
            def do_POST(self):
                if self.headers.get("Transfer-Encoding", "").lower()=="chunked":
                    body=b""
                    while True:
                        size=int(self.rfile.readline().strip(),16)
                        if not size: self.rfile.readline(); break
                        body+=self.rfile.read(size); self.rfile.read(2)
                else: body=self.rfile.read(int(self.headers["Content-Length"]))
                payload=json.loads(body)
                if self.path=="/v1/mailbox/test":
                    self.send_payload({"connected":payload["auth_code"]=="isolated-test-auth","message":"测试连接成功" if payload["auth_code"]=="isolated-test-auth" else "邮箱登录失败"});return
                self.calls.append((payload["address"],payload["after_uid"]))
                assert payload["auth_code"]=="isolated-test-auth"
                item={"mailbox_uid":11,"mailbox_received_at":"2026-10-13T00:00:00Z","fingerprint":"same-fingerprint","status":"parsed","message":{"subject":"同步测试","sender":"same@example.com","body_text":"安排装柜"},"items":[],"fields":{},"so_numbers":[]}
                self.send_payload({"configured":True,"address":payload["address"],"uid_validity":7,"items":[item] if payload["after_uid"]==0 else []})
            def send_payload(self,payload):
                self.send_response(200);self.send_header("Content-Type","application/json");self.end_headers();self.wfile.write(json.dumps(payload).encode())
        parser_stub=ThreadingHTTPServer(("127.0.0.1",0),ParserStub)
        threading.Thread(target=parser_stub.serve_forever,daemon=True).start()

        jar = http.cookiejar.CookieJar()
        opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
        process = None
        log = None

        def request(path, payload=None, expected=200, method=None):
            data = None if payload is None else json.dumps(payload).encode()
            req = urllib.request.Request(base + path, data=data, method=method,
                                         headers={"Content-Type": "application/json"} if data else {})
            try:
                response = opener.open(req, timeout=15)
            except urllib.error.HTTPError as error:
                response = error
            raw = response.read()
            value = json.loads(raw) if raw else None
            assert response.code == expected, (path, response.code, value)
            return value

        def start():
            nonlocal process, log
            log = open(directory / "api.log", "ab", buffering=0)
            env = dict(os.environ, ConnectionStrings__Default=f"Data Source={db_path}",
                       ASPNETCORE_URLS=base, EmailParser__BaseUrl=f"http://127.0.0.1:{parser_stub.server_port}",
                       DOTNET_CLI_TELEMETRY_OPTOUT="1")
            env["Logging__LogLevel__Microsoft.EntityFrameworkCore.Database.Command"] = "Information"
            process = subprocess.Popen(["dotnet", str(DLL)], cwd=ROOT / "server/VoyagePlex.Api",
                                       env=env, stdout=log, stderr=log)
            deadline = time.monotonic() + 40
            while time.monotonic() < deadline:
                if process.poll() is not None:
                    raise AssertionError("Test API failed to start: " + (directory / "api.log").read_text()[-3000:])
                try:
                    request("/api/auth/setup-status")
                    return
                except (OSError, urllib.error.URLError):
                    time.sleep(0.1)
            raise AssertionError("Test API startup timed out")

        def stop():
            nonlocal process, log
            if process is not None:
                process.terminate()
                process.wait(timeout=15)
                process = None
            if log is not None:
                log.close()
                log = None

        def insert(connection, table, values):
            # Supply all required scalar columns so this fixture also runs against schema additions.
            fields = {}
            for _, name, kind, required, default, primary in connection.execute(f"PRAGMA table_info({table})"):
                if primary or name in values:
                    continue
                if required and default is None:
                    fields[name] = 0 if kind == "INTEGER" else "2026-10-07 00:00:00" if name.endswith("At") else ""
            if "Company" in fields: fields["Company"]="Xingxin"
            if "CompanyAccess" in fields: fields["CompanyAccess"]="Xingxin"
            fields.update(values)
            columns = ','.join(fields)
            placeholders = ','.join('?' for _ in fields)
            return connection.execute(f"INSERT INTO {table} ({columns}) VALUES ({placeholders})", list(fields.values())).lastrowid

        def mail(connection, day, subject, category="Shipment", so="SO-1", mode="Container", status="pending"):
            parsed = {"message": {"subject": subject, "sender": "test@example.com", "body_text": "交仓通知" if mode == "Warehouse" else "安排装柜"},
                      "so_numbers": [so] if so else [], "fields": {"so_number": so, "container_type": "1*40HQ", "ship_date": "2026-10-15"},
                      "items": [{"product_code": "P-1", "spec": 12, "quantity": 10}], "warehouse_groups": []}
            return insert(connection, "ImportEmailItems", dict(ImportBatchId=batch_id, MailboxKey=secrets.token_hex(8),
                MailSubject=subject, MailSender="test@example.com", MailReceivedAt=day+"T01:00:00Z",
                MailReceivedDate=day, WorkCategory=category, ShipmentMode=mode, Status=status,
                HandlingStatus="Pending", HandlingOutcome="", TaskIdsJson="[]", NeedsClassificationReview=0,
                ClassificationSource="ParsedRule", ResultJson=json.dumps(parsed), FileName="test.eml"))

        try:
            start()
            password = secrets.token_urlsafe(20)
            request("/api/auth/setup", {"username": "mailtest", "displayName": "Mail test", "password": password}, expected=201)
            request("/api/auth/login", {"username": "mailtest", "password": password})
            with sqlite3.connect(db_path) as connection:
                connection.execute("UPDATE MailSystemSettings SET SyncEnabled=0")
                insert(connection, "ProductInfos", {"ProductCode": "P-1", "QuantityPerBox": 12, "ToyCategory": "电子"})
                batch_id = insert(connection, "ImportBatches", {"Kind": "Email", "Status": "PendingConfirmation"})
                old = mail(connection, "2026-10-07", "旧邮件")
                old_source = mail(connection, "2026-10-07", "已确认任务来源", so="SO-OLD", status="confirmed")
                old_task = insert(connection, "ShipmentTasks", dict(Customer="Test", SoNumber="SO-OLD", Status="PendingReview",
                    SourceImportItemId=old_source, SourceGroupKey="", SourceEmailsJson="[]", ItemsJson="[]", WarehouseGroupsJson="[]"))
                new = mail(connection, "2026-10-08", "新增装柜 SO-1")
                change = mail(connection, "2026-10-08", "变更 SO-1", category="Change")
                change_json = json.loads(connection.execute("SELECT ResultJson FROM ImportEmailItems WHERE Id=?", (change,)).fetchone()[0])
                change_json["fields"]["ship_date"] = "2026-10-16"
                connection.execute("UPDATE ImportEmailItems SET ResultJson=? WHERE Id=?", (json.dumps(change_json), change))
                ordinary = mail(connection, "2026-10-08", "仅供参考", category="Other", so="")
                duplicate = mail(connection, "2026-10-08", "重复装柜", status="duplicate")
                failed = mail(connection, "2026-10-08", "失败装柜", status="failed")
                unmatched = mail(connection, "2026-10-09", "变更 SO-MISSING", category="Change", so="SO-MISSING", mode="Warehouse")
                rollback_new = mail(connection, "2026-10-09", "新增 SO-ROLLBACK", so="SO-ROLLBACK")
                connection.execute("UPDATE MailSystemSettings SET DailyWorkflowVersion=0,StartDate='2026-08-01'")
                # Recreate the pre-company schema so startup migration is covered.
                for index in ("IX_MailContacts_Company_MailOwnerId_Email","IX_ImportEmailItems_Company_MailOwnerId_MailReceivedDate","IX_ImportEmailItems_Company_BusinessFingerprint","IX_MailContacts_Company_Email","IX_ShipmentTasks_Company_SoNumber","IX_ImportEmailItems_Company_MailReceivedDate"):
                    connection.execute(f"DROP INDEX IF EXISTS {index}")
                for table in ("ShipmentTasks","ImportBatches","ImportEmailItems","MailContacts"):
                    connection.execute(f"ALTER TABLE {table} DROP COLUMN Company")
                connection.execute("ALTER TABLE ShipmentTasks DROP COLUMN ExportDetailsJson")
                connection.execute("ALTER TABLE Users DROP COLUMN CompanyAccess")
            stop()
            start()
            days = request("/api/mail/dates")
            assert days["startDate"] == "2026-10-08"
            assert {day["date"] for day in days["days"]} == {"2026-10-08", "2026-10-09"}
            with sqlite3.connect(db_path) as connection:
                assert connection.execute("SELECT COUNT(*) FROM ImportEmailItems WHERE Id=?", (old,)).fetchone()[0] == 0
                assert connection.execute("SELECT COUNT(*) FROM ImportEmailItems WHERE Id=?", (old_source,)).fetchone()[0] == 1
                assert connection.execute("SELECT COUNT(*) FROM ShipmentTasks").fetchone()[0] == 1
            before = request(f"/api/shipments/{old_task}")
            assert before["sourceEmails"][0]["id"] == old_source
            assert request("/api/imports/email/mailbox/items?date=2026-10-07")["total"] == 0
            assert request("/api/imports/email/mailbox/items?date=2026-10-08")["total"] == 5
            assert request("/api/imports/email/mailbox/items?date=2026-10-09")["total"] == 2
            assert request("/api/imports/email/mailbox/items?date=2026-10-09&mode=Warehouse")["total"] == 1
            request("/api/imports/email/mailbox/items?date=invalid", expected=400)
            request("/api/mail/candidates/batch/confirm", {"ids": "invalid"}, expected=400)
            request("/api/mail/candidates/batch/confirm", {"ids": ["invalid"]}, expected=400)
            backups = list(directory.glob("*.before-daily-mail-*.db"))
            assert len(backups) == 1, "Historical cleanup must create a recoverable database backup"
            with sqlite3.connect(backups[0]) as backup:
                assert backup.execute("SELECT COUNT(*) FROM ImportEmailItems WHERE Id=?", (old,)).fetchone()[0] == 1
            request(f"/api/imports/email/mailbox/items/{new}", {"workCategory": "Other"}, expected=400, method="PATCH")
            for item in (duplicate, failed):
                request("/api/mail/candidates/batch/confirm", {"ids": [item]}, expected=400)
            request("/api/mail/candidates/batch/acknowledge", {"ids": [ordinary]})
            ordinary_detail = request(f"/api/imports/email/mailbox/items/{ordinary}")
            assert ordinary_detail["handlingStatus"] == "Processed" and ordinary_detail["handlingOutcome"] == "NoTask"
            with sqlite3.connect(db_path) as connection:
                assert connection.execute("SELECT COUNT(*) FROM ShipmentTasks").fetchone()[0] == 1
            request("/api/mail/candidates/batch/confirm", {"ids": [rollback_new, unmatched]}, expected=400)
            with sqlite3.connect(db_path) as connection:
                assert connection.execute("SELECT COUNT(*) FROM ShipmentTasks").fetchone()[0] == 1
                assert connection.execute("SELECT HandlingStatus FROM ImportEmailItems WHERE Id=?", (rollback_new,)).fetchone()[0] == "Pending"
            confirmed = request("/api/mail/candidates/batch/confirm", {"ids": [new]})
            task_id = confirmed["taskIds"][0]
            request("/api/mail/candidates/batch/confirm", {"ids": [new]}, expected=400)
            task = request(f"/api/shipments/{task_id}")
            assert task["items"][0]["category"] == "电子", "Product category was not filled on confirmation"
            task["items"][0]["category"] = "塑胶"
            request(f"/api/shipments/{task_id}", {"items": task["items"]}, method="PATCH")
            assert request(f"/api/shipments/{task_id}")["items"][0]["category"] == "塑胶", "Manual category did not persist"
            assert [source["id"] for source in task["sourceEmails"]] == [new], "Unconfirmed same-SO mail leaked into task"
            changed = request("/api/mail/candidates/batch/confirm", {"ids": [change]})
            assert changed["taskIds"] == [task_id]
            task = request(f"/api/shipments/{task_id}")
            assert {source["id"] for source in task["sourceEmails"]} == {new, change}
            assert task["plannedShipDate"] == "2026-10-16", "Confirmed changes must update actual task fields"
            with sqlite3.connect(db_path) as connection:
                grouped = mail(connection, "2026-10-09", "新增整柜 SO-GROUP", so="SO-GROUP")
                grouped_change = mail(connection, "2026-10-09", "变更整柜 SO-GROUP", category="Change", so="SO-GROUP")
                for item_id in (grouped, grouped_change):
                    payload = json.loads(connection.execute("SELECT ResultJson FROM ImportEmailItems WHERE Id=?", (item_id,)).fetchone()[0])
                    payload["shipment_groups"] = [{"group_key": "G1", "container_type": "1*40HQ"}, {"group_key": "G2", "container_type": "1*40HQ"}]
                    payload["items"] = [{"product_code": "P1", "container_assignment": "G1", "quantity": 10}, {"product_code": "P2", "container_assignment": "G2", "quantity": 20}]
                    if item_id == grouped_change:
                        payload["fields"]["ship_date"] = "2026-10-17"
                    connection.execute("UPDATE ImportEmailItems SET ResultJson=? WHERE Id=?", (json.dumps(payload), item_id))
            group_tasks = request("/api/mail/candidates/batch/confirm", {"ids": [grouped]})["taskIds"]
            assert len(group_tasks) == 2
            group_changes = request("/api/mail/candidates/batch/confirm", {"ids": [grouped_change]})["taskIds"]
            assert set(group_changes) == set(group_tasks), "Grouped change must update its exact container tasks"
            for group_task in group_tasks:
                assert request(f"/api/shipments/{group_task}")["plannedShipDate"] == "2026-10-17"
            with sqlite3.connect(db_path) as connection:
                # A corrupt unconfirmed mail with the same SO must not affect loading a task.
                connection.execute("UPDATE ImportEmailItems SET ResultJson='invalid' WHERE Id=?", (unmatched,))
            log_offset = (directory / "api.log").stat().st_size
            request(f"/api/shipments/{task_id}")
            query_log = (directory / "api.log").read_bytes()[log_offset:].decode()
            assert 'ImportEmailItems' not in query_log, "Task details must not query mail table"
            assert 'ShipmentTasks' in query_log, "SQL logging must be enabled for this assertion"
            def company(value):
                jar.set_cookie(http.cookiejar.Cookie(0, "voyageplex_company", value, None, False,
                    "127.0.0.1", False, False, "/", True, False, None, True, None, None, {}))

            company("Huadeng")
            assert request("/api/shipments") == [], "Huadeng leaked Xingxin tasks"
            request(f"/api/shipments/{task_id}", expected=404)
            request(f"/api/shipments/{task_id}", {"soNumber":"CROSS"}, method="PATCH", expected=404)
            request(f"/api/mail/candidates/{new}", {}, method="PATCH", expected=404)
            shared = request("/api/product-infos")
            assert any(row["productCode"]=="P-1" for row in shared["items"]), "Product library must be shared"
            huadeng_task=request("/api/shipments", {"customer":"Test","soNumber":"SO-1"}, expected=201)
            huadeng_id=huadeng_task["id"]
            assert huadeng_task["company"]=="Huadeng"
            with sqlite3.connect(db_path) as connection:
                huadeng_batch=insert(connection,"ImportBatches",{"Company":"Huadeng","Kind":"Email","Status":"PendingConfirmation"})
                huadeng_mail=mail(connection,"2026-10-10","华登 SO-1",so="SO-1")
                connection.execute("UPDATE ImportEmailItems SET Company='Huadeng',ImportBatchId=? WHERE Id=?",(huadeng_batch,huadeng_mail))
            assert {value["date"] for value in request("/api/mail/dates")["days"]}=={"2026-10-10"}
            assert request("/api/mail/candidates/batch/confirm",{"ids":[huadeng_mail]})["taskIds"]==[huadeng_id], "Same SO must only merge within its company"
            assert request(f"/api/shipments/{huadeng_id}")["items"][0]["category"]=="电子"
            details={"shipmentMode":"Warehouse","sequenceNumber":"510","warehouse":"盐港二号仓"}
            request(f"/api/shipments/{huadeng_id}", {"exportDetails":details}, method="PATCH")
            assert request(f"/api/shipments/{huadeng_id}")["exportDetails"]==details
            request("/api/mail/settings", {"syncEnabled":False,"retentionDays":90}, method="PATCH")
            company("Xingxin")
            assert request("/api/mail/settings")["retentionDays"]==180, "Company settings leaked"
            request(f"/api/shipments/{huadeng_id}", expected=404)
            for username in ("谭凤斌", "王五", "陈"):
                request("/api/users", {"username":username,"displayName":username,"role":"shipping","password":password}, expected=201)
            request("/api/users", {"username":"谭凤斌","displayName":"重复","role":"shipping","password":password}, expected=409)
            request("/api/users", {"username":"  ","displayName":"空账号","role":"shipping","password":password}, expected=400)
            request("/api/auth/login", {"username":"陈","password":password})
            assert request("/api/auth/me")["username"] == "陈", "Short Chinese account must log in"
            request("/api/auth/login", {"username":"mailtest","password":password})
            request("/api/users", {"username":"huadengtest","displayName":"华登测试","role":"shipping","companyAccess":"Huadeng","password":password}, expected=201)
            request("/api/auth/login", {"username":"huadengtest","password":password})
            request("/api/shipments", expected=403)
            company("Huadeng")
            assert request(f"/api/shipments/{huadeng_id}")["company"]=="Huadeng"
            request(f"/api/shipments/{task_id}", expected=404)
            owner_a = request("/api/auth/me")["id"]
            request("/api/auth/login", {"username":"mailtest","password":password})
            owner_b = request("/api/users", {"username":"华登乙","displayName":"华登乙","role":"shipping","companyAccess":"Huadeng","password":password}, expected=201)["id"]
            for owner_id, display_name, address in [(owner_a,"华登测试","a@example.com"),(owner_b,"华登乙","b@example.com")]:
                result = request(f"/api/users/{owner_id}", {"displayName":display_name,"role":"shipping","companyAccess":"Huadeng","isActive":True,"mailboxAddress":address,"mailboxHost":"imap.example.com","mailboxFolder":"INBOX","mailboxAuthCode":"isolated-test-auth"}, method="PUT")
                assert result["mailboxConfigured"] and "mailboxSecretProtected" not in result
            test_before_calls=len(ParserStub.calls)
            assert request(f"/api/users/{owner_a}/mailbox-test",{})["connected"], "Reuse encrypted saved authorization code"
            assert request(f"/api/users/{owner_a}/mailbox-test",{"mailboxAddress":"new@example.com","mailboxHost":"imap.example.com","mailboxFolder":"INBOX","mailboxAuthCode":"isolated-test-auth"})["connected"], "Unsaved form can be tested"
            request(f"/api/users/{owner_a}/mailbox-test",{"mailboxAddress":"new@example.com"},expected=400)
            assert len(ParserStub.calls)==test_before_calls, "Test connection must not poll or import mail"
            assert next(value for value in request("/api/users") if value["id"]==owner_a)["mailboxAddress"]=="a@example.com", "Testing must not save form edits"
            request(f"/api/users/{owner_b}", {"displayName":"华登乙","role":"shipping","companyAccess":"Huadeng","mailboxAddress":"a@example.com","mailboxHost":"imap.example.com","mailboxFolder":"INBOX","mailboxAuthCode":"isolated-test-auth"}, method="PUT", expected=409)
            with sqlite3.connect(db_path) as connection:
                encrypted = connection.execute("SELECT MailboxSecretProtected FROM Users WHERE Id=?",(owner_a,)).fetchone()[0]
                assert encrypted and "isolated-test-auth" not in encrypted
                own_mails=[]
                for owner_id,day,so in [(owner_a,"2026-10-11","PRIVATE-A"),(owner_b,"2026-10-12","PRIVATE-B")]:
                    batch_id=insert(connection,"ImportBatches",{"Company":"Huadeng","MailOwnerId":owner_id,"Kind":"Email","Status":"PendingConfirmation"})
                    mail_id=mail(connection,day,so,so=so)
                    connection.execute("UPDATE ImportEmailItems SET Company='Huadeng',MailOwnerId=?,ImportBatchId=? WHERE Id=?",(owner_id,batch_id,mail_id))
                    own_mails.append(mail_id)
                    insert(connection,"MailContacts",{"Company":"Huadeng","MailOwnerId":owner_id,"Email":"same@example.com"})
            request("/api/auth/login", {"username":"huadengtest","password":password})
            request(f"/api/users/{owner_b}/mailbox-test",{},expected=403)
            jar.set_cookie(http.cookiejar.Cookie(0,"voyageplex_mail_owner",str(owner_b),None,False,"127.0.0.1",False,False,"/",True,False,None,True,None,None,{}))
            assert {value["date"] for value in request("/api/mail/dates")["days"]}=={"2026-10-11"}, "Non-admin owner cookie must not override identity"
            request(f"/api/imports/email/mailbox/items/{own_mails[1]}",expected=404)
            request(f"/api/mail/candidates/{own_mails[1]}",{},method="PATCH",expected=404)
            request("/api/mail/candidates/batch/confirm",{"ids":[own_mails[1]]},expected=400)
            private_task=request("/api/mail/candidates/batch/confirm",{"ids":[own_mails[0]]})["taskIds"][0]
            request("/api/auth/login", {"username":"华登乙","password":password})
            assert {value["date"] for value in request("/api/mail/dates")["days"]}=={"2026-10-12"}
            shared_task=request(f"/api/shipments/{private_task}")
            assert shared_task["responsibleUserId"]==owner_a and shared_task["sourceMailboxAddress"]=="a@example.com"
            assert shared_task["sourceEmails"]==[] and shared_task["emailSubject"]=="", "Shared task must not expose private mail"
            request(f"/api/imports/email/mailbox/items/{own_mails[0]}",expected=404)
            assert shared_task["canEdit"] is True
            request(f"/api/shipments/{private_task}",{"port":"同事代为核对"},method="PATCH")
            request(f"/api/shipments/{private_task}/warehouse-locations/refresh",{},expected=403)
            with sqlite3.connect(db_path) as connection:
                copy_batch=insert(connection,"ImportBatches",{"Company":"Huadeng","MailOwnerId":owner_b,"Kind":"Email","Status":"PendingConfirmation"})
                copy_mail=mail(connection,"2026-10-12","同一通知副本",so="")
                change_mail=mail(connection,"2026-10-12","跨人员变更",category="Change",so="PRIVATE-A")
                connection.execute("UPDATE ImportEmailItems SET Company='Huadeng',MailOwnerId=?,ImportBatchId=? WHERE Id IN (?,?)",(owner_b,copy_batch,copy_mail,change_mail))
                connection.execute("UPDATE ImportEmailItems SET BusinessFingerprint='shared-notice' WHERE Id IN (?,?)",(own_mails[0],copy_mail))
                connection.execute("UPDATE ImportEmailItems SET Fingerprint='different-delivery-headers' WHERE Id=?",(copy_mail,))
            assert request(f"/api/imports/email/mailbox/items/{copy_mail}")["duplicateTaskIds"]==[private_task], "No-SO copy must show existing task before confirmation"
            assert request("/api/mail/candidates/batch/confirm",{"ids":[copy_mail]})["taskIds"]==[private_task]
            request("/api/mail/candidates/batch/confirm",{"ids":[change_mail]})
            assert len([task for task in request("/api/shipments") if task["soNumber"]=="PRIVATE-A"])==1
            request("/api/auth/login",{"username":"huadengtest","password":password})
            assert request(f"/api/shipments/{private_task}")["canEdit"] is True
            request(f"/api/shipments/{private_task}",{"port":"负责人已核对"},method="PATCH")


            request("/api/auth/login", {"username":"mailtest","password":password})
            assert {value["date"] for value in request("/api/mail/dates")["days"]}=={"2026-10-12"}, "Admin owner filter"
            request("/api/mail/settings",{"syncEnabled":False,"retentionDays":91},method="PATCH")
            jar.set_cookie(http.cookiejar.Cookie(0,"voyageplex_mail_owner",str(owner_a),None,False,"127.0.0.1",False,False,"/",True,False,None,True,None,None,{}))
            assert request("/api/mail/settings")["retentionDays"]==180, "Personal settings must be independent"
            assert request("/api/mail/settings")["address"]=="a@example.com"
            assert request("/api/mail/settings")["connectionStatus"]=="Connected", "Saved test result must persist"
            request(f"/api/users/{owner_a}",{"displayName":"华登测试","role":"shipping","companyAccess":"Huadeng","mailboxAddress":"a@example.com","mailboxHost":"imap.example.com","mailboxFolder":"INBOX","mailboxAuthCode":"isolated-test-auth"},method="PUT")
            assert request("/api/mail/settings")["connectionStatus"]=="PendingConnection", "Changed credentials must invalidate test evidence"
            request(f"/api/users/{owner_a}",{"displayName":"华登测试","role":"shipping","companyAccess":"Huadeng","mailboxAddress":"a@example.com","mailboxHost":"imap.example.com","mailboxFolder":"INBOX","mailboxAuthCode":"wrong-code"},method="PUT")
            assert request(f"/api/users/{owner_a}/mailbox-test",{})["connected"] is False
            assert request("/api/mail/settings")["connectionStatus"]=="SyncError", "Failed saved connection must show abnormal status"
            draft_test=request(f"/api/users/{owner_a}/mailbox-test",{"mailboxAddress":"a@example.com","mailboxHost":"imap.example.com","mailboxFolder":"INBOX","mailboxAuthCode":"isolated-test-auth"})
            request(f"/api/users/{owner_a}",{"displayName":"华登测试","role":"shipping","companyAccess":"Huadeng","mailboxAddress":"a@example.com","mailboxHost":"imap.example.com","mailboxFolder":"INBOX","mailboxAuthCode":"isolated-test-auth","mailboxTestToken":draft_test["testToken"]},method="PUT")
            status=request("/api/mail/settings")
            assert status["connectionStatus"]=="Connected" and status["testedAt"]

            assert {value["date"] for value in request("/api/mail/dates")["days"]}=={"2026-10-11"}
            for username in ("huadengtest","华登乙"):
                request("/api/auth/login",{"username":username,"password":password})
                assert request("/api/imports/email/mailbox/sync",{})["imported"]==1
                assert request("/api/imports/email/mailbox/sync",{})["imported"]==0
            assert ("a@example.com",11) in ParserStub.calls and ("b@example.com",11) in ParserStub.calls
            with sqlite3.connect(db_path) as connection:
                assert connection.execute("SELECT COUNT(*) FROM ImportEmailItems WHERE Company='Huadeng' AND Fingerprint='same-fingerprint' AND Status='pending'").fetchone()[0]==2, "Different inboxes must not mark each other's copies duplicate"
                assert connection.execute("SELECT LastUid FROM MailSyncStates WHERE Id=?",(1000+owner_a,)).fetchone()[0]==11
                assert connection.execute("SELECT LastUid FROM MailSyncStates WHERE Id=?",(1000+owner_b,)).fetchone()[0]==11
            request("/api/auth/login",{"username":"mailtest","password":password})
            stop(); start()
            assert request(f"/api/shipments/{private_task}")["responsibleUserId"]==owner_a
            request("/api/auth/login", {"username":"华登乙","password":password})
            request(f"/api/shipments/{private_task}",method="DELETE")
            request(f"/api/shipments/{private_task}",expected=404)
            request("/api/auth/login", {"username":"mailtest","password":password})
            supervisors={}
            warehouses={}
            for company in ["Huadeng","Xingxin"]:
                supervisors[company]=request("/api/users",{"username":"supervisor-"+company.lower(),"displayName":"主管","role":"supervisor","companyAccess":company,"password":password},expected=201)["id"]
                warehouses[company]=request("/api/users",{"username":"warehouse-"+company.lower(),"displayName":"仓库文员","role":"warehouse","companyAccess":company,"password":password},expected=201)["id"]
            request("/api/users",{"username":"invalid-both","displayName":"跨厂区","role":"shipping","companyAccess":"Both","password":password},expected=400)
            for company in ["Huadeng","Xingxin"]:
                jar.set_cookie(http.cookiejar.Cookie(0,"voyageplex_company",company,None,False,"127.0.0.1",False,False,"/",True,False,None,True,None,None,{}))
                request("/api/auth/login",{"username":"supervisor-"+company.lower(),"password":password})
                listed=request("/api/users")
                assert all(u["companyAccess"]==company and u["role"] in ["shipping","warehouse"] for u in listed)
                request("/api/mail/settings")
                request("/api/shipments")
                request("/api/product-infos")
                other="Xingxin" if company=="Huadeng" else "Huadeng"
                request(f"/api/users/{warehouses[other]}/reset-password",{"password":password},expected=403)
                request(f"/api/users/{supervisors[company]}",{"displayName":"越权","role":"admin","companyAccess":company},method="PUT",expected=403)
                for role,scope in [("admin",company),("supervisor",company),("shipping",other),("warehouse","Both")]:
                    request("/api/users",{"username":"forbidden","displayName":"越权","role":role,"companyAccess":scope,"password":password},expected=403)
                added=request("/api/users",{"username":"managed-"+company.lower(),"displayName":"本厂区船务","role":"shipping","companyAccess":company,"password":password},expected=201)
                request(f"/api/users/{added['id']}",{"displayName":"已更新","role":"shipping","companyAccess":company,"isActive":False},method="PUT")
                if company=="Huadeng":
                    assert owner_a in {a["id"] for a in request("/api/mail/accounts")["accounts"]}
                    request(f"/api/users/{owner_a}/mailbox-test",{})
                jar.set_cookie(http.cookiejar.Cookie(0,"voyageplex_company",other,None,False,"127.0.0.1",False,False,"/",True,False,None,True,None,None,{}))
                request("/api/shipments",expected=403)
                request("/api/users",expected=403)
                request("/api/auth/login",{"username":"warehouse-"+company.lower(),"password":password})
                request("/api/shipments",expected=403)
                jar.set_cookie(http.cookiejar.Cookie(0,"voyageplex_company",company,None,False,"127.0.0.1",False,False,"/",True,False,None,True,None,None,{}))
                request("/api/shipments")
                request("/api/mail/dates",expected=403)
                request("/api/users",expected=403)
            print("Role permissions: supervisors scoped to company, user grants protected, warehouse company isolation passed.")
            print("Personal mail: encrypted binding, duplicate binding rejection, owner isolation, cookie tamper rejection, shared tasks, private source redaction and independent settings passed.")
            print("Company isolation: same-SO tasks, shared products, independent settings, scoped IDs and user permissions passed.")
            print("Daily mail API: date isolation, cleanup, source preservation, automatic categories, no-task acknowledgement,")
            print("duplicate/failed rejection, batch rollback, grouped task updates, confirmed-only sources and zero task mail queries passed.")
        finally:
            stop()
            parser_stub.shutdown(); parser_stub.server_close()


if __name__ == "__main__":
    run()
