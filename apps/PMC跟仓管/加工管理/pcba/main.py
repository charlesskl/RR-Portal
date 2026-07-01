import os

from fastapi import FastAPI, HTTPException, Request, Depends
from fastapi.responses import FileResponse, StreamingResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.sessions import SessionMiddleware
from pydantic import BaseModel

from pcba import db
from pcba.auth import hash_password, verify_password
from pcba.summary import compute_summary
from pcba.db import LOCATIONS
from pcba.export import build_workbook

app = FastAPI(title="77794 PCBA 系统")
# 反向代理子路径前缀（如平台部署 = "/cpg"；本地独立运行 = ""）
BASE_PATH = os.environ.get("PCBA_BASE_PATH", "").rstrip("/")
app.add_middleware(
    SessionMiddleware,
    secret_key=os.environ.get("PCBA_SECRET", "pcba-local-secret-change-me"),
    # 独立 cookie 名 + 限定 path，避免与平台上其它 app 的 session cookie 撞车
    session_cookie=os.environ.get("PCBA_COOKIE_NAME", "session"),
    path=os.environ.get("PCBA_COOKIE_PATH", "/"),
    # 平台是 HTTP，不能用 Secure cookie（否则浏览器不回传）
    https_only=False,
)

STATIC_DIR = os.path.join(os.path.dirname(__file__), "static")


def _render_html(filename: str):
    """读取静态 HTML，注入 APP_BASE 前缀并改写 /static 引用，适配反代子路径。"""
    with open(os.path.join(STATIC_DIR, filename), encoding="utf-8") as f:
        html = f.read()
    inject = f'<script>window.APP_BASE="{BASE_PATH}";</script>'
    html = html.replace("<head>", "<head>\n" + inject, 1)
    # <link>/<script> 等标签里的 /static 绝对路径加前缀（JS fetch 走 APP_BASE，不在此处理）
    if BASE_PATH:
        html = html.replace('"/static/', f'"{BASE_PATH}/static/')
    return HTMLResponse(html)


@app.middleware("http")
async def _no_cache_static(request: Request, call_next):
    response = await call_next(request)
    if request.url.path.startswith("/static") or request.url.path == "/":
        response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
    return response


@app.on_event("startup")
def _startup():
    db.init_db()


@app.get("/api/health")
def health():
    return {"status": "ok"}


# ---------- 鉴权辅助 ----------
def current_user(request: Request):
    uid = request.session.get("uid")
    if not uid:
        raise HTTPException(status_code=401, detail="未登录")
    conn = db.get_conn()
    try:
        row = conn.execute(
            "SELECT id, username, role FROM users WHERE id=?", (uid,)
        ).fetchone()
    finally:
        conn.close()
    if not row:
        raise HTTPException(status_code=401, detail="未登录")
    return dict(row)


def require_admin(user=Depends(current_user)):
    if user["role"] != "admin":
        raise HTTPException(status_code=403, detail="需要管理员权限")
    return user


# ---------- 登录 ----------
class LoginIn(BaseModel):
    username: str
    password: str


@app.post("/api/login")
def login(body: LoginIn, request: Request):
    conn = db.get_conn()
    try:
        row = conn.execute(
            "SELECT id, username, role, password_hash FROM users WHERE username=?",
            (body.username,),
        ).fetchone()
    finally:
        conn.close()
    if not row or not verify_password(body.password, row["password_hash"]):
        raise HTTPException(status_code=401, detail="账号或密码错误")
    request.session["uid"] = row["id"]
    return {"username": row["username"], "role": row["role"]}


@app.post("/api/logout")
def logout(request: Request):
    request.session.clear()
    return {"ok": True}


@app.get("/api/me")
def me(user=Depends(current_user)):
    return user


# ---------- 用户管理（仅 admin） ----------
class UserIn(BaseModel):
    username: str
    password: str
    role: str = "operator"


@app.get("/api/users")
def list_users(_admin=Depends(require_admin)):
    conn = db.get_conn()
    try:
        rows = conn.execute(
            "SELECT id, username, role, created_at FROM users ORDER BY id"
        ).fetchall()
    finally:
        conn.close()
    return [dict(r) for r in rows]


@app.post("/api/users")
def create_user(body: UserIn, _admin=Depends(require_admin)):
    if body.role not in ("admin", "operator"):
        raise HTTPException(status_code=400, detail="角色无效")
    if len(body.password) < 6:
        raise HTTPException(status_code=400, detail="密码至少 6 位")
    conn = db.get_conn()
    try:
        exists = conn.execute(
            "SELECT 1 FROM users WHERE username=?", (body.username,)
        ).fetchone()
        if exists:
            raise HTTPException(status_code=400, detail="账号已存在")
        conn.execute(
            "INSERT INTO users(username, password_hash, role) VALUES (?,?,?)",
            (body.username, hash_password(body.password), body.role),
        )
        conn.commit()
    finally:
        conn.close()
    return {"ok": True}


class PasswordIn(BaseModel):
    password: str


@app.put("/api/users/{user_id}/password")
def reset_password(user_id: int, body: PasswordIn, _admin=Depends(require_admin)):
    if len(body.password) < 6:
        raise HTTPException(status_code=400, detail="密码至少 6 位")
    conn = db.get_conn()
    try:
        conn.execute(
            "UPDATE users SET password_hash=? WHERE id=?",
            (hash_password(body.password), user_id),
        )
        conn.commit()
    finally:
        conn.close()
    return {"ok": True}


# ---------- 静态前端 ----------
@app.get("/")
def index():
    return _render_html("login.html")


# 显式路由（注入 APP_BASE），优先级高于下方 /static 静态挂载
@app.get("/static/app.html")
def app_page():
    return _render_html("app.html")


from typing import Optional

VALID_TYPES = ("inbound_raw", "issue", "finished")


@app.get("/api/locations")
def list_locations(_user=Depends(current_user)):
    conn = db.get_conn()
    try:
        rows = conn.execute(
            "SELECT id, name, sort FROM locations ORDER BY sort"
        ).fetchall()
    finally:
        conn.close()
    return [dict(r) for r in rows]


@app.get("/api/materials")
def list_materials(_user=Depends(current_user)):
    conn = db.get_conn()
    try:
        rows = conn.execute(
            "SELECT id, name FROM materials ORDER BY id"
        ).fetchall()
    finally:
        conn.close()
    return [dict(r) for r in rows]


class MaterialIn(BaseModel):
    name: str


@app.post("/api/materials")
def create_material(body: MaterialIn, _admin=Depends(require_admin)):
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="物料名称不能为空")
    conn = db.get_conn()
    try:
        exists = conn.execute(
            "SELECT 1 FROM materials WHERE name=?", (name,)
        ).fetchone()
        if exists:
            raise HTTPException(status_code=400, detail="物料名称已存在")
        conn.execute("INSERT INTO materials(name) VALUES (?)", (name,))
        conn.commit()
    finally:
        conn.close()
    return {"ok": True}


@app.delete("/api/materials/{material_id}")
def delete_material(material_id: int, _admin=Depends(require_admin)):
    conn = db.get_conn()
    try:
        conn.execute("DELETE FROM materials WHERE id=?", (material_id,))
        conn.commit()
    finally:
        conn.close()
    return {"ok": True}


class RecordIn(BaseModel):
    rec_type: str
    location_id: Optional[int] = None
    rec_date: Optional[str] = None
    doc_no: Optional[str] = None
    material: str = "77794-PCBA板"
    qty: int
    remark: Optional[str] = None


def _validate_record(body: RecordIn):
    if body.rec_type not in VALID_TYPES:
        raise HTTPException(status_code=400, detail="类型无效")
    if body.qty is None or body.qty < 0:
        raise HTTPException(status_code=400, detail="数量必须为非负整数")
    if body.rec_type in ("issue", "finished") and not body.location_id:
        raise HTTPException(status_code=400, detail="领料/成品入仓必须选择加工点")
    if body.rec_type == "inbound_raw":
        body.location_id = None


@app.get("/api/records")
def list_records(_user=Depends(current_user), rec_type: Optional[str] = None):
    conn = db.get_conn()
    try:
        sql = (
            "SELECT r.*, l.name AS location_name, u.username AS created_by_name "
            "FROM records r "
            "LEFT JOIN locations l ON r.location_id = l.id "
            "LEFT JOIN users u ON r.created_by = u.id"
        )
        params = []
        if rec_type:
            sql += " WHERE r.rec_type = ?"
            params.append(rec_type)
        sql += " ORDER BY r.id DESC"
        rows = conn.execute(sql, params).fetchall()
    finally:
        conn.close()
    return [dict(r) for r in rows]


@app.post("/api/records")
def create_record(body: RecordIn, user=Depends(current_user)):
    _validate_record(body)
    conn = db.get_conn()
    try:
        cur = conn.execute(
            "INSERT INTO records(rec_type, location_id, rec_date, doc_no, "
            "material, qty, remark, created_by) VALUES (?,?,?,?,?,?,?,?)",
            (body.rec_type, body.location_id, body.rec_date, body.doc_no,
             body.material, body.qty, body.remark, user["id"]),
        )
        conn.commit()
        new_id = cur.lastrowid
    finally:
        conn.close()
    return {"id": new_id}


def _get_record_or_404(conn, record_id):
    row = conn.execute("SELECT * FROM records WHERE id=?", (record_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="记录不存在")
    return row


def _check_owner(row, user):
    if user["role"] != "admin" and row["created_by"] != user["id"]:
        raise HTTPException(status_code=403, detail="只能修改自己录入的记录")


@app.put("/api/records/{record_id}")
def update_record(record_id: int, body: RecordIn, user=Depends(current_user)):
    _validate_record(body)
    conn = db.get_conn()
    try:
        row = _get_record_or_404(conn, record_id)
        _check_owner(row, user)
        conn.execute(
            "UPDATE records SET rec_type=?, location_id=?, rec_date=?, doc_no=?, "
            "material=?, qty=?, remark=? WHERE id=?",
            (body.rec_type, body.location_id, body.rec_date, body.doc_no,
             body.material, body.qty, body.remark, record_id),
        )
        conn.commit()
    finally:
        conn.close()
    return {"ok": True}


@app.delete("/api/records/{record_id}")
def delete_record(record_id: int, user=Depends(current_user)):
    conn = db.get_conn()
    try:
        row = _get_record_or_404(conn, record_id)
        _check_owner(row, user)
        conn.execute("DELETE FROM records WHERE id=?", (record_id,))
        conn.commit()
    finally:
        conn.close()
    return {"ok": True}


def _all_records_for_summary(conn):
    rows = conn.execute(
        "SELECT r.rec_type AS rec_type, l.name AS location, r.qty AS qty "
        "FROM records r LEFT JOIN locations l ON r.location_id = l.id"
    ).fetchall()
    return [dict(r) for r in rows]


@app.get("/api/summary")
def summary(_user=Depends(current_user)):
    conn = db.get_conn()
    try:
        records = _all_records_for_summary(conn)
    finally:
        conn.close()
    return compute_summary(records, LOCATIONS)


@app.get("/api/export")
def export(_user=Depends(current_user)):
    conn = db.get_conn()
    try:
        summary_records = _all_records_for_summary(conn)
        detail_rows = conn.execute(
            "SELECT r.rec_type, l.name AS location_name, r.rec_date, r.doc_no, "
            "r.material, r.qty, r.remark FROM records r "
            "LEFT JOIN locations l ON r.location_id = l.id ORDER BY r.id"
        ).fetchall()
    finally:
        conn.close()
    summary = compute_summary(summary_records, LOCATIONS)
    detail_records = [dict(r) for r in detail_rows]
    buf = build_workbook(summary, detail_records, LOCATIONS)
    headers = {"Content-Disposition": "attachment; filename=77794_PCBA_summary.xlsx"}
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers=headers,
    )


app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
