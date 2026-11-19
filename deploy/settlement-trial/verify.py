"""Check the published trial with two independent clients; never log passwords."""
import base64
import os
import sys
import time
from urllib.error import HTTPError, URLError
from urllib.request import HTTPRedirectHandler, Request, build_opener


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args):
        return None


client = build_opener(NoRedirect)
origin = sys.argv[1].rstrip("/")
if origin != "https://8.148.146.194" and not origin.startswith("http://127.0.0.1:"):
    raise ValueError("unexpected origin")
accounts = ("trial-a", "trial-b")


def check(path, expected, account=None):
    headers = {}
    if account:
        password = os.environ["SETTLEMENT_TRIAL_" + account[-1].upper() + "_PASSWORD"]
        basic = base64.b64encode(f"{account}:{password}".encode()).decode()
        headers["Authorization"] = "Basic " + basic
    request = Request(origin + "/settlements/" + path, headers=headers)
    try:
        response = client.open(request, timeout=6)
    except HTTPError as error:
        response = error
    with response:
        if response.status != expected:
            raise ValueError(f"{path}: expected {expected}, received {response.status}")
        return response.read().decode()


for attempt in range(24):
    try:
        check("trial-a/", 401)
        break
    except (OSError, URLError):
        if attempt == 23:
            raise
        time.sleep(5)

for account, other in (accounts, accounts[::-1]):
    for path in ("", "index.html", "months.js"):
        check(f"{account}/{path}", 401)
        check(f"{other}/{path}", 401, account)
    page = check(account + "/", 200, account)
    expected = ("试用甲公司", "¥621.00", "¥415.00") if account == "trial-a" else ("试用乙公司", "¥156.00", "¥0.00")
    opposite = "试用乙公司" if account == "trial-a" else "试用甲公司"
    if not all(label in page for label in (*expected, "2026-11", "2026-12")) or opposite in page:
        raise ValueError("statement content mismatch")
    print(account, "own statement and both months verified; guest and other account denied")
