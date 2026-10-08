"""Daily mailbox API regression tests using an isolated SQLite database and local API."""
import http.cookiejar
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
        opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
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
            value = json.loads(response.read())
            assert response.code == expected, (path, response.code, value)
            return value

        def start():
            nonlocal process, log
            log = open(directory / "api.log", "ab", buffering=0)
            env = dict(os.environ, ConnectionStrings__Default=f"Data Source={db_path}",
                       ASPNETCORE_URLS=base, EmailParser__BaseUrl="http://127.0.0.1:9",
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
            print("Daily mail API: date isolation, cleanup, source preservation, automatic categories, no-task acknowledgement,")
            print("duplicate/failed rejection, batch rollback, grouped task updates, confirmed-only sources and zero task mail queries passed.")
        finally:
            stop()


if __name__ == "__main__":
    run()
