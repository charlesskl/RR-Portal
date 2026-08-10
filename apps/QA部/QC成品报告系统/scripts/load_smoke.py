"""Small acceptance benchmark: 20 signed-in sessions and one 40-photo report."""

import io
import os
import re
import sys
import tempfile
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from http.cookiejar import CookieJar
from pathlib import Path

from PIL import Image
from sqlalchemy import func, select

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app import Photo, PurchaseOrder, Report, TestResult, create_app


BASE_URL = os.getenv("QC_BASE_URL", "http://127.0.0.1:8000").rstrip("/")


def signed_in_request(index: int):
    jar = CookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
    login_page = opener.open(BASE_URL + "/login", timeout=10).read().decode("utf-8")
    token = re.search(r'name="csrf_token" value="([^"]+)"', login_page).group(1)
    body = urllib.parse.urlencode({"username": "qc", "password": "QC@12345", "csrf_token": token}).encode()
    opener.open(urllib.request.Request(BASE_URL + "/login", data=body), timeout=10).read()
    response = opener.open(BASE_URL + "/api/reports", timeout=10)
    return response.status, len(response.read())


def csrf(client):
    with client.session_transaction() as sess:
        return sess["csrf_token"]


def jpg(seed: int):
    stream = io.BytesIO()
    Image.new("RGB", (480, 360), ((seed * 31) % 220, 90, 160)).save(stream, "JPEG", quality=82)
    stream.seek(0)
    return stream


def forty_photo_report():
    temp = tempfile.TemporaryDirectory()
    root = Path(temp.name)
    app = create_app({"TESTING": True, "SECRET_KEY": "load", "DATABASE_URL": f"sqlite:///{(root/'load.db').as_posix()}", "STORAGE_ROOT": str(root / "storage")})
    client = app.test_client()
    client.get("/login")
    client.post("/login", data={"csrf_token": csrf(client), "username": "qc", "password": "QC@12345"})
    db = app.extensions["db_session"]()
    po_id = db.scalar(select(PurchaseOrder.id).where(PurchaseOrder.po_no == "PO-26032401"))
    db.close()
    response = client.post("/reports/new", data={"csrf_token": csrf(client), "po_id": po_id})
    report_id = int(response.headers["Location"].split("/")[2])
    db = app.extensions["db_session"]()
    tests = list(db.scalars(select(TestResult).where(TestResult.report_id == report_id)).all())
    db.close()
    report_data = {
        "csrf_token": csrf(client), "inspection_date": "2026-06-09", "inspection_status": "Final 1st", "inspection_level": "II",
        "completed_pct": "100", "inspected_qty": "125", "critical_aql": "0", "major_aql": "1", "minor_aql": "4",
    }
    for test in tests:
        report_data[f"test_result_{test.id}"] = "PASS"
    client.post(f"/reports/{report_id}/edit", data=report_data)
    seed = 0
    for category, count in (("product", 14), ("packaging", 13), ("warehouse", 13)):
        files = []
        for _ in range(count):
            files.append((jpg(seed), f"{category}-{seed}.jpg"))
            seed += 1
        response = client.post(f"/reports/{report_id}/photos", data={"csrf_token": csrf(client), "category": category, "photos": files}, content_type="multipart/form-data")
        assert response.status_code == 302
    db = app.extensions["db_session"]()
    count = db.scalar(select(func.count()).select_from(Photo).where(Photo.report_id == report_id))
    report = db.get(Report, report_id)
    page_status = client.get(f"/reports/{report_id}/edit").status_code
    result = report.result
    db.close()
    app.extensions["db_session"].remove()
    app.extensions["db_engine"].dispose()
    temp.cleanup()
    assert count == 40 and page_status == 200 and result == "PASS"
    return count, result


def main():
    started = time.perf_counter()
    with ThreadPoolExecutor(max_workers=20) as pool:
        results = list(pool.map(signed_in_request, range(20)))
    concurrent_seconds = time.perf_counter() - started
    assert all(status == 200 and size > 20 for status, size in results)
    started = time.perf_counter()
    count, result = forty_photo_report()
    photo_seconds = time.perf_counter() - started
    print(f"[PASS] 20 concurrent authenticated sessions: {concurrent_seconds:.2f}s")
    print(f"[PASS] {count}-photo report rendered with result {result}: {photo_seconds:.2f}s")
    if concurrent_seconds > 15 or photo_seconds > 15:
        print("[WARN] Functional benchmark passed but exceeded the 15s smoke-test target")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
