#!/usr/bin/env python3
"""Exercise the shipping QC proxy against a local QC protocol stub."""

import http.server
import json
import os
import secrets
import socket
import subprocess
import tempfile
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
API_DLL = ROOT / "server/VoyagePlex.Api/bin/Debug/net8.0/VoyagePlex.Api.dll"
KEY = secrets.token_urlsafe(40)


def free_port():
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        return listener.getsockname()[1]


def request(url, data=None, cookie=None):
    headers = {"Content-Type": "application/json"}
    if cookie:
        headers["Cookie"] = cookie
    payload = json.dumps(data).encode() if data is not None else None
    query = urllib.request.Request(url, data=payload, headers=headers)
    try:
        response = urllib.request.urlopen(query, timeout=10)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        body = response.read()
        return response.status, response.headers, json.loads(body) if body and "json" in response.headers.get("Content-Type", "") else body


def wait_for(url):
    for _ in range(100):
        try:
            if request(url)[0] == 200:
                return
        except (OSError, TimeoutError):
            pass
        time.sleep(0.2)
    raise RuntimeError(f"服务未启动：{url}")


class QcHandler(http.server.BaseHTTPRequestHandler):
    calls = []

    def do_POST(self):
        assert self.headers.get("Authorization") == f"Bearer {KEY}"
        assert self.path.endswith("/api/integrations/shipping/results/batch")
        body = self.rfile.read(int(self.headers["Content-Length"]))
        items = json.loads(body)["items"]
        self.calls.append(items)
        results = []
        for index, item in enumerate(items):
            matched = item["contractNumber"] == "4500186208" and item["itemNumber"] == "77711-S005-NA-PKC"
            results.append({"itemIndex": index, "total": 1 if matched else 0, "latest": {"site": "兴信", "internalResult": "PASS", "workflowStatus": "已完成"} if matched else None})
        data = {"results": results}
        payload = json.dumps(data).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, *_args):
        pass


def main():
    base_path = os.environ.get("QC_SMOKE_BASE_PATH", "")
    api_port, web_port = free_port(), free_port()
    qc = http.server.ThreadingHTTPServer(("127.0.0.1", 0), QcHandler)
    threading.Thread(target=qc.serve_forever, daemon=True).start()
    processes = []
    try:
        with tempfile.TemporaryDirectory(prefix="voyageplex-qc-smoke-") as directory:
            log = open(Path(directory) / "services.log", "w")
            try:
                api_env = {**os.environ, "ASPNETCORE_URLS": f"http://127.0.0.1:{api_port}", "ConnectionStrings__Default": f"Data Source={directory}/ship.db"}
                processes.append(subprocess.Popen(["dotnet", str(API_DLL)], cwd=ROOT / "server/VoyagePlex.Api", env=api_env, stdout=log, stderr=subprocess.STDOUT))
                wait_for(f"http://127.0.0.1:{api_port}/api/health")
                web_env = {**os.environ, "NEXT_DIST_DIR": ".next-build", "NEXT_PUBLIC_BASE_PATH": base_path, "VOYAGEPLEX_API_BASE_URL": f"http://127.0.0.1:{api_port}", "QC_SYSTEM_API_URL": f"http://127.0.0.1:{qc.server_port}/api/integrations/shipping/results", "QC_SYSTEM_API_TOKEN": KEY}
                processes.append(subprocess.Popen(["npm", "run", "start", "--", "--port", str(web_port), "--hostname", "127.0.0.1"], cwd=ROOT, env=web_env, stdout=log, stderr=subprocess.STDOUT))
                base = f"http://127.0.0.1:{web_port}{base_path}"
                wait_for(base)
                item = {"contractNumber": "4500186208", "customerPo": "269326", "itemNumber": "77711-S005-NA-PKC"}
                assert request(base + "/api/qc/results", {"items": [item]})[0] == 401
                assert request(base + "/api/auth/setup", {"username": "testadmin", "displayName": "测试管理员", "password": "TestPassword123!"})[0] == 201
                status, headers, _ = request(base + "/api/auth/login", {"username": "testadmin", "password": "TestPassword123!"})
                assert status == 200
                cookie = headers.get("Set-Cookie").split(";", 1)[0]
                status, _, result = request(base + "/api/qc/results", {"items": [item, item, {"contractNumber": "NO-MATCH", "customerPo": "", "itemNumber": "X"}]}, cookie)
                assert status == 200, result
                assert result["results"][0]["latest"]["internalResult"] == "PASS"
                assert result["results"][1]["latest"] == result["results"][0]["latest"]
                assert result["results"][2]["total"] == 0
                assert len(QcHandler.calls) == 1 and len(QcHandler.calls[0]) == 2  # one batch, duplicate removed
                print("船务与 QC 接口对接测试通过")
            finally:
                for process in reversed(processes):
                    process.terminate()
                for process in reversed(processes):
                    try:
                        process.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        process.kill()
                log.close()
    finally:
        qc.shutdown()
        qc.server_close()


if __name__ == "__main__":
    main()
