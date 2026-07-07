import os
from datetime import date
from typing import Optional

from fastapi import FastAPI, HTTPException, Request, Depends
from fastapi.responses import HTMLResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.sessions import SessionMiddleware
from pydantic import BaseModel

from pcba import db
from pcba.auth import hash_password, verify_password
from pcba.summary import compute_material_totals, compute_public_summary, compute_summary
from pcba.db import DEPARTMENTS, LOCATIONS
from pcba.export import build_workbook

app = FastAPI(title="唱片机管理系统")
BASE_PATH = os.environ.get("PCBA_BASE_PATH", "").rstrip("/")
app.add_middleware(
    SessionMiddleware,
    secret_key=os.environ.get("PCBA_SECRET", "pcba-local-secret-change-me"),
    session_cookie=os.environ.get("PCBA_COOKIE_NAME", "session"),
    path=os.environ.get("PCBA_COOKIE_PATH", "/"),
    https_only=False,
)

STATIC_DIR = os.path.join(os.path.dirname(__file__), "static")


def _render_html(filename: str):
    with open(os.path.join(STATIC_DIR, filename), encoding="utf-8") as f:
        html = f.read()
    inject = f'<script>window.APP_BASE="{BASE_PATH}";</script>'
    html = html.replace("<head>", "<head>\n" + inject, 1)
    if BASE_PATH:
        html = html.replace('"/static/', f'"{BASE_PATH}/static/')
        html = html.replace('href="/"', f'href="{BASE_PATH}/"')
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
    department = request.session.get("department")
    if not uid or not department:
        raise HTTPException(status_code=401, detail="未登录")
    conn = db.get_conn()
    try:
        row = conn.execute(
            "SELECT id, username, role, department FROM users WHERE id=?", (uid,)
        ).fetchone()
    finally:
        conn.close()
    if not row:
        raise HTTPException(status_code=401, detail="未登录")
    if department not in DEPARTMENTS:
        raise HTTPException(status_code=401, detail="未登录")
    user = dict(row)
    if user["role"] == "admin":
        user["department"] = department
        return user
    db_department = user.get("department")
    if db_department not in DEPARTMENTS:
        raise HTTPException(status_code=403, detail="账号未分配有效部门")
    user["department"] = db_department
    if department != db_department:
        request.session["department"] = db_department
    return user


def require_admin(user=Depends(current_user)):
    if user["role"] != "admin":
        raise HTTPException(status_code=403, detail="需要管理员权限")
    return user


# ---------- 登录 ----------
class LoginIn(BaseModel):
    username: str
    password: str
    department: str


def _validate_department(department: Optional[str], required=True):
    if not department:
        if required:
            raise HTTPException(status_code=400, detail="请选择部门")
        return None
    if department not in DEPARTMENTS:
        raise HTTPException(status_code=400, detail="部门无效")
    return department


def _validate_date(value: Optional[str], field: str):
    if not value:
        return None
    try:
        date.fromisoformat(value)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"{field}格式必须为 YYYY-MM-DD")
    return value


def _date_filter(
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    doc_no: Optional[str] = None,
):
    start = _validate_date(date_from, "date_from")
    end = _validate_date(date_to, "date_to")
    if start and end and start > end:
        raise HTTPException(status_code=400, detail="开始日期不能晚于结束日期")
    filters = {"date_from": start, "date_to": end}
    doc_no = _clean_optional(doc_no)
    if doc_no:
        filters["doc_no"] = doc_no
    return filters


def _append_date_filter(sql: str, params: list, filters: dict):
    if filters.get("date_from"):
        sql += " AND r.rec_date >= ?"
        params.append(filters["date_from"])
    if filters.get("date_to"):
        sql += " AND r.rec_date <= ?"
        params.append(filters["date_to"])
    if filters.get("doc_no"):
        sql += " AND COALESCE(r.doc_no, '') LIKE ?"
        params.append(f"%{filters['doc_no']}%")
    return sql, params


def _clean_optional(value: Optional[str]):
    return value.strip() if value and value.strip() else None


@app.get("/api/departments")
def list_departments():
    return DEPARTMENTS


@app.post("/api/login")
def login(body: LoginIn, request: Request):
    department = _validate_department(body.department)
    conn = db.get_conn()
    try:
        row = conn.execute(
            "SELECT id, username, role, password_hash, department "
            "FROM users WHERE username=?",
            (body.username,),
        ).fetchone()
    finally:
        conn.close()
    if not row or not verify_password(body.password, row["password_hash"]):
        raise HTTPException(status_code=401, detail="账号或密码错误")
    if row["role"] != "admin" and row["department"] != department:
        raise HTTPException(status_code=403, detail="账号不属于所选部门")
    request.session["uid"] = row["id"]
    request.session["department"] = department
    return {"username": row["username"], "role": row["role"], "department": department}


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
    department: Optional[str] = None


class UserUpdateIn(BaseModel):
    role: str = "operator"
    department: Optional[str] = None


@app.get("/api/users")
def list_users(_admin=Depends(require_admin)):
    conn = db.get_conn()
    try:
        rows = conn.execute(
            "SELECT id, username, role, department, created_at FROM users ORDER BY id"
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
    department = _validate_department(
        body.department, required=(body.role == "operator")
    )
    conn = db.get_conn()
    try:
        exists = conn.execute(
            "SELECT 1 FROM users WHERE username=?", (body.username,)
        ).fetchone()
        if exists:
            raise HTTPException(status_code=400, detail="账号已存在")
        conn.execute(
            "INSERT INTO users(username, password_hash, role, department) VALUES (?,?,?,?)",
            (body.username, hash_password(body.password), body.role, department),
        )
        conn.commit()
    finally:
        conn.close()
    return {"ok": True}


class PasswordIn(BaseModel):
    password: str


@app.put("/api/me/password")
def change_my_password(body: PasswordIn, user=Depends(current_user)):
    if len(body.password) < 6:
        raise HTTPException(status_code=400, detail="密码至少 6 位")
    conn = db.get_conn()
    try:
        conn.execute(
            "UPDATE users SET password_hash=? WHERE id=?",
            (hash_password(body.password), user["id"]),
        )
        conn.commit()
    finally:
        conn.close()
    return {"ok": True}


@app.put("/api/users/{user_id}")
def update_user(user_id: int, body: UserUpdateIn, _admin=Depends(require_admin)):
    if body.role not in ("admin", "operator"):
        raise HTTPException(status_code=400, detail="角色无效")
    department = _validate_department(
        body.department, required=(body.role == "operator")
    )
    if body.role == "admin":
        department = None
    conn = db.get_conn()
    try:
        row = conn.execute("SELECT id FROM users WHERE id=?", (user_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="用户不存在")
        conn.execute(
            "UPDATE users SET role=?, department=? WHERE id=?",
            (body.role, department, user_id),
        )
        conn.commit()
    finally:
        conn.close()
    return {"ok": True}


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


@app.get("/static/app.html")
def app_page():
    return _render_html("app.html")


@app.get("/static/public-summary.html")
def public_summary_page():
    return _render_html("public-summary.html")


VALID_TYPES = (
    "inbound_raw", "issue", "finished", "semi_finished",
    "semi_inbound", "semi_outbound",
)
SUPPLIER_DEPARTMENT = "兴信B来料仓"
ASSEMBLY_DEPARTMENT = "装配"
SEMI_FINISHED_DEPARTMENT = "半成品"
OUTSOURCE_DEPARTMENT = "外发"
HEYUAN_DEPARTMENT = "河源华兴"
SHAOYANG_DEPARTMENT = "邵阳"
XINSHAO_DEPARTMENT = "新邵"
PO_CUSTOMER_DEPARTMENTS = (SHAOYANG_DEPARTMENT, XINSHAO_DEPARTMENT)


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


class SupplierIn(BaseModel):
    name: str


@app.get("/api/suppliers")
def list_suppliers(_user=Depends(current_user)):
    conn = db.get_conn()
    try:
        rows = conn.execute(
            "SELECT id, name, created_at FROM suppliers ORDER BY id"
        ).fetchall()
    finally:
        conn.close()
    return [dict(r) for r in rows]


@app.post("/api/suppliers")
def create_supplier(body: SupplierIn, _admin=Depends(require_admin)):
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="供应商名称不能为空")
    conn = db.get_conn()
    try:
        exists = conn.execute(
            "SELECT 1 FROM suppliers WHERE name=?", (name,)
        ).fetchone()
        if exists:
            raise HTTPException(status_code=400, detail="供应商名称已存在")
        cur = conn.execute("INSERT INTO suppliers(name) VALUES (?)", (name,))
        conn.commit()
        new_id = cur.lastrowid
    finally:
        conn.close()
    return {"id": new_id, "name": name}


@app.put("/api/suppliers/{supplier_id}")
def update_supplier(supplier_id: int, body: SupplierIn, _admin=Depends(require_admin)):
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="供应商名称不能为空")
    conn = db.get_conn()
    try:
        row = conn.execute(
            "SELECT id FROM suppliers WHERE id=?", (supplier_id,)
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="供应商不存在")
        exists = conn.execute(
            "SELECT 1 FROM suppliers WHERE name=? AND id<>?",
            (name, supplier_id),
        ).fetchone()
        if exists:
            raise HTTPException(status_code=400, detail="供应商名称已存在")
        conn.execute(
            "UPDATE suppliers SET name=? WHERE id=?",
            (name, supplier_id),
        )
        conn.commit()
    finally:
        conn.close()
    return {"id": supplier_id, "name": name}


@app.delete("/api/suppliers/{supplier_id}")
def delete_supplier(supplier_id: int, _admin=Depends(require_admin)):
    conn = db.get_conn()
    try:
        conn.execute("DELETE FROM suppliers WHERE id=?", (supplier_id,))
        conn.commit()
    finally:
        conn.close()
    return {"ok": True}


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
        cur = conn.execute("INSERT INTO materials(name) VALUES (?)", (name,))
        conn.commit()
        new_id = cur.lastrowid
    finally:
        conn.close()
    return {"id": new_id, "name": name}


@app.put("/api/materials/{material_id}")
def update_material(material_id: int, body: MaterialIn, _admin=Depends(require_admin)):
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="物料名称不能为空")
    conn = db.get_conn()
    try:
        row = conn.execute(
            "SELECT id FROM materials WHERE id=?", (material_id,)
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="物料不存在")
        exists = conn.execute(
            "SELECT 1 FROM materials WHERE name=? AND id<>?",
            (name, material_id),
        ).fetchone()
        if exists:
            raise HTTPException(status_code=400, detail="物料名称已存在")
        conn.execute(
            "UPDATE materials SET name=? WHERE id=?",
            (name, material_id),
        )
        conn.commit()
    finally:
        conn.close()
    return {"id": material_id, "name": name}


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
    material: str = "PCBA板"
    qty: int
    remark: Optional[str] = None
    supplier: Optional[str] = None
    po_no: Optional[str] = None
    customer_name: Optional[str] = None


def _validate_record(body: RecordIn, department: Optional[str] = None):
    if body.rec_type not in VALID_TYPES:
        raise HTTPException(status_code=400, detail="类型无效")
    if department == OUTSOURCE_DEPARTMENT and body.rec_type not in ("finished", "semi_finished"):
        raise HTTPException(status_code=400, detail="外发只能录入成品/半成品入库")
    if department == HEYUAN_DEPARTMENT and body.rec_type not in ("issue", "finished"):
        raise HTTPException(status_code=400, detail="河源华兴只能录入领料/成品入库")
    if department == SHAOYANG_DEPARTMENT and body.rec_type not in ("issue", "finished"):
        raise HTTPException(status_code=400, detail="邵阳只能录入领料/成品入库")
    if department == XINSHAO_DEPARTMENT and body.rec_type not in ("issue", "finished"):
        raise HTTPException(status_code=400, detail="新邵只能录入领料/成品入库")
    if department == SUPPLIER_DEPARTMENT and body.rec_type == "finished":
        raise HTTPException(status_code=400, detail="兴信B来料仓只能录入入库/出库")
    if body.rec_type == "semi_finished" and department not in (ASSEMBLY_DEPARTMENT, OUTSOURCE_DEPARTMENT):
        raise HTTPException(status_code=400, detail="半成品入库仅限装配/外发部门")
    if body.rec_type in ("semi_inbound", "semi_outbound") and department != SEMI_FINISHED_DEPARTMENT:
        raise HTTPException(status_code=400, detail="半成品仓出入库仅限半成品部门")
    if body.qty is None or body.qty < 0:
        raise HTTPException(status_code=400, detail="数量必须为非负整数")
    if (
        body.rec_type in ("issue", "finished", "semi_finished")
        and department != OUTSOURCE_DEPARTMENT
        and not body.location_id
    ):
        raise HTTPException(status_code=400, detail="领料/入库必须选择加工点")
    if body.rec_type in ("inbound_raw", "semi_inbound", "semi_outbound") or department == OUTSOURCE_DEPARTMENT:
        body.location_id = None


@app.get("/api/records")
def list_records(
    user=Depends(current_user),
    rec_type: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    doc_no: Optional[str] = None,
):
    filters = _date_filter(date_from, date_to, doc_no)
    conn = db.get_conn()
    try:
        sql = (
            "SELECT r.*, l.name AS location_name, u.username AS created_by_name "
            "FROM records r "
            "LEFT JOIN locations l ON r.location_id = l.id "
            "LEFT JOIN users u ON r.created_by = u.id "
            "WHERE r.department = ?"
        )
        params = [user["department"]]
        if rec_type:
            sql += " AND r.rec_type = ?"
            params.append(rec_type)
        sql, params = _append_date_filter(sql, params, filters)
        sql += " ORDER BY r.id DESC"
        rows = conn.execute(sql, params).fetchall()
    finally:
        conn.close()
    return [dict(r) for r in rows]


@app.post("/api/records")
def create_record(body: RecordIn, user=Depends(current_user)):
    _validate_record(body, user["department"])
    supplier = (body.supplier or "").strip() or None
    if user["department"] != SUPPLIER_DEPARTMENT:
        supplier = None
    po_no = (body.po_no or "").strip() or None
    customer_name = (body.customer_name or "").strip() or None
    if user["department"] not in PO_CUSTOMER_DEPARTMENTS or body.rec_type != "finished":
        po_no = None
        customer_name = None
    conn = db.get_conn()
    try:
        cur = conn.execute(
            "INSERT INTO records(rec_type, location_id, rec_date, doc_no, "
            "material, qty, remark, supplier, po_no, customer_name, department, created_by) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
            (body.rec_type, body.location_id, body.rec_date, body.doc_no,
             body.material, body.qty, body.remark, supplier, po_no, customer_name,
             user["department"], user["id"]),
        )
        conn.commit()
        new_id = cur.lastrowid
    finally:
        conn.close()
    return {"id": new_id}


def _get_record_or_404(conn, record_id, department):
    row = conn.execute(
        "SELECT * FROM records WHERE id=? AND department=?",
        (record_id, department),
    ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="记录不存在")
    return row


def _check_owner(row, user):
    if user["role"] != "admin" and row["created_by"] != user["id"]:
        raise HTTPException(status_code=403, detail="只能修改自己录入的记录")


@app.put("/api/records/{record_id}")
def update_record(record_id: int, body: RecordIn, user=Depends(current_user)):
    _validate_record(body, user["department"])
    supplier = (body.supplier or "").strip() or None
    if user["department"] != SUPPLIER_DEPARTMENT:
        supplier = None
    po_no = (body.po_no or "").strip() or None
    customer_name = (body.customer_name or "").strip() or None
    if user["department"] not in PO_CUSTOMER_DEPARTMENTS or body.rec_type != "finished":
        po_no = None
        customer_name = None
    conn = db.get_conn()
    try:
        row = _get_record_or_404(conn, record_id, user["department"])
        _check_owner(row, user)
        conn.execute(
            "UPDATE records SET rec_type=?, location_id=?, rec_date=?, doc_no=?, "
            "material=?, qty=?, remark=?, supplier=?, po_no=?, customer_name=? WHERE id=?",
            (body.rec_type, body.location_id, body.rec_date, body.doc_no,
             body.material, body.qty, body.remark, supplier, po_no, customer_name,
             record_id),
        )
        conn.commit()
    finally:
        conn.close()
    return {"ok": True}


@app.delete("/api/records/{record_id}")
def delete_record(record_id: int, user=Depends(current_user)):
    conn = db.get_conn()
    try:
        row = _get_record_or_404(conn, record_id, user["department"])
        _check_owner(row, user)
        conn.execute("DELETE FROM records WHERE id=?", (record_id,))
        conn.commit()
    finally:
        conn.close()
    return {"ok": True}


def _all_records_for_summary(conn, department, filters=None):
    sql = (
        "SELECT r.rec_type AS rec_type, l.name AS location, r.qty AS qty, "
        "r.material AS material, r.department AS department "
        "FROM records r LEFT JOIN locations l ON r.location_id = l.id "
        "WHERE r.department=?"
    )
    params = [department]
    sql, params = _append_date_filter(sql, params, filters or {})
    rows = conn.execute(sql, params).fetchall()
    return [dict(r) for r in rows]


def _public_records_for_summary(conn, filters=None, material=None, department=None):
    sql = (
        "SELECT r.rec_type AS rec_type, r.qty AS qty, "
        "r.material AS material, r.department AS department "
        "FROM records r WHERE 1=1"
    )
    params = []
    sql, params = _append_date_filter(sql, params, filters or {})
    if material:
        sql += " AND r.material = ?"
        params.append(material)
    if department:
        sql += " AND r.department = ?"
        params.append(department)
    sql += " ORDER BY r.department, r.material, r.id"
    rows = conn.execute(sql, params).fetchall()
    return [dict(r) for r in rows]


def _with_common_summary_fields(summary, records, filters):
    result = dict(summary)
    result["materials"] = compute_material_totals(records)
    result["filters"] = filters
    return result


def _compute_semi_finished_warehouse_summary(records):
    inbound = sum(int(r["qty"] or 0) for r in records if r["rec_type"] == "semi_inbound")
    outbound = sum(int(r["qty"] or 0) for r in records if r["rec_type"] == "semi_outbound")
    return {
        "locations": [
            {"location": name, "issue": 0, "finished": 0, "balance": 0}
            for name in LOCATIONS
        ],
        "subtotal": {"issue": 0, "finished": 0, "balance": 0},
        "raw": {"inbound": inbound, "outbound": outbound, "balance": inbound - outbound},
    }


def _compute_outsource_inbound_summary(records):
    finished = sum(int(r["qty"] or 0) for r in records if r["rec_type"] == "finished")
    semi_finished = sum(int(r["qty"] or 0) for r in records if r["rec_type"] == "semi_finished")
    inbound = finished + semi_finished
    return {
        "locations": [
            {"location": name, "issue": 0, "finished": 0, "balance": 0}
            for name in LOCATIONS
        ],
        "subtotal": {"issue": 0, "finished": 0, "balance": 0},
        "raw": {
            "finished_inbound": finished,
            "semi_finished_inbound": semi_finished,
            "inbound": inbound,
            "outbound": 0,
            "balance": inbound,
        },
    }


@app.get("/api/public-summary")
def public_summary(
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    material: Optional[str] = None,
    department: Optional[str] = None,
):
    filters = _date_filter(date_from, date_to)
    material = _clean_optional(material)
    department = _validate_department(_clean_optional(department), required=False)
    public_filters = {
        **filters,
        "material": material,
        "department": department,
    }
    conn = db.get_conn()
    try:
        records = _public_records_for_summary(
            conn,
            filters,
            material=material,
            department=department,
        )
    finally:
        conn.close()
    return compute_public_summary(records, DEPARTMENTS, public_filters)


@app.get("/api/summary")
def summary(
    user=Depends(current_user),
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    doc_no: Optional[str] = None,
):
    filters = _date_filter(date_from, date_to, doc_no)
    conn = db.get_conn()
    try:
        records = _all_records_for_summary(conn, user["department"], filters)
    finally:
        conn.close()
    if user["department"] == SEMI_FINISHED_DEPARTMENT:
        summary_data = _compute_semi_finished_warehouse_summary(records)
        return _with_common_summary_fields(summary_data, records, filters)
    if user["department"] == OUTSOURCE_DEPARTMENT:
        summary_data = _compute_outsource_inbound_summary(records)
        return _with_common_summary_fields(summary_data, records, filters)
    return _with_common_summary_fields(compute_summary(records, LOCATIONS), records, filters)


@app.get("/api/export")
def export(
    user=Depends(current_user),
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    doc_no: Optional[str] = None,
):
    filters = _date_filter(date_from, date_to, doc_no)
    conn = db.get_conn()
    try:
        summary_records = _all_records_for_summary(conn, user["department"], filters)
        sql = (
            "SELECT r.rec_type, l.name AS location_name, r.rec_date, r.doc_no, "
            "r.material, r.supplier, r.po_no, r.customer_name, r.qty, r.remark FROM records r "
            "LEFT JOIN locations l ON r.location_id = l.id "
            "WHERE r.department=?"
        )
        params = [user["department"]]
        sql, params = _append_date_filter(sql, params, filters)
        sql += " ORDER BY r.id"
        detail_rows = conn.execute(sql, params).fetchall()
    finally:
        conn.close()
    if user["department"] == SEMI_FINISHED_DEPARTMENT:
        summary = _compute_semi_finished_warehouse_summary(summary_records)
    elif user["department"] == OUTSOURCE_DEPARTMENT:
        summary = _compute_outsource_inbound_summary(summary_records)
    else:
        summary = compute_summary(summary_records, LOCATIONS)
    detail_records = [dict(r) for r in detail_rows]
    buf = build_workbook(
        summary,
        detail_records,
        LOCATIONS,
        include_supplier=(user["department"] == SUPPLIER_DEPARTMENT),
        warehouse_mode=(user["department"] == SEMI_FINISHED_DEPARTMENT),
        outsource_mode=(user["department"] == OUTSOURCE_DEPARTMENT),
        shaoyang_mode=(user["department"] in PO_CUSTOMER_DEPARTMENTS),
    )
    headers = {"Content-Disposition": "attachment; filename=record_player_summary.xlsx"}
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers=headers,
    )


app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
