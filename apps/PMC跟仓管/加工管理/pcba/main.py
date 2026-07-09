import os
import io
from datetime import date, datetime
from typing import List, Optional

from fastapi import FastAPI, HTTPException, Request, Depends, File, UploadFile
from fastapi.responses import HTMLResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from openpyxl import Workbook, load_workbook
from openpyxl.utils.datetime import from_excel
from starlette.middleware.sessions import SessionMiddleware
from pydantic import BaseModel

from pcba import db
from pcba.auth import hash_password, verify_password
from pcba.summary import (
    compute_material_totals,
    compute_public_summary,
    compute_sticker_type_totals,
    compute_summary,
)
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
PROCESSING_BALANCE_DEPARTMENTS = (
    HEYUAN_DEPARTMENT,
    SHAOYANG_DEPARTMENT,
    XINSHAO_DEPARTMENT,
)
NFC_MATERIAL = "NFC贴纸"
PCBA_MATERIAL = "77794-PCBA板"
XLSX_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
RECORD_IMPORT_HEADERS = [
    "类型", "物料名称", "贴纸类型", "加工点", "供应商",
    "日期", "单据编号", "数量", "备注", "PO", "客名",
]


def _xlsx_response(wb: Workbook, filename: str):
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type=XLSX_MEDIA_TYPE,
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


def _cell_text(value):
    if value is None:
        return ""
    return str(value).replace("\r", "").replace("\n", "").strip()


def _load_upload_workbook(file: UploadFile):
    try:
        return load_workbook(file.file, data_only=True)
    except Exception:
        raise HTTPException(status_code=400, detail="Excel 文件无法读取")


def _worksheet_rows(ws):
    rows = list(ws.iter_rows(values_only=True))
    if not rows:
        return []
    headers = [_cell_text(value) for value in rows[0]]
    result = []
    for offset, values in enumerate(rows[1:], start=2):
        if not any(_cell_text(value) for value in values):
            continue
        row = {}
        for i, header in enumerate(headers):
            if header:
                row[header] = values[i] if i < len(values) else None
        result.append((offset, row))
    return result


def _sheet_rows(file: UploadFile):
    return _worksheet_rows(_load_upload_workbook(file).active)


def _first_value(row: dict, *headers):
    for header in headers:
        value = row.get(header)
        text = _cell_text(value)
        if text:
            return text
    return ""


def _int_value(value, row_no: int, field: str):
    if value is None or _cell_text(value) == "":
        raise HTTPException(status_code=400, detail=f"第{row_no}行：{field}不能为空")
    try:
        return int(value)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail=f"第{row_no}行：{field}必须是数字")


def _date_value(value, row_no: int):
    if value is None or _cell_text(value) == "":
        return None
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    text = _cell_text(value)
    try:
        date.fromisoformat(text)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"第{row_no}行：日期格式必须为 YYYY-MM-DD")
    return text


def _record_type_from_import(value, department):
    text = _cell_text(value)
    if text in VALID_TYPES:
        return text
    department_maps = {
        SUPPLIER_DEPARTMENT: {"入库": "inbound_raw", "来料入库": "inbound_raw", "出库": "issue", "领料": "issue"},
        SEMI_FINISHED_DEPARTMENT: {"入库": "semi_inbound", "半成品入库": "semi_inbound", "出库": "semi_outbound", "半成品出库": "semi_outbound"},
        ASSEMBLY_DEPARTMENT: {"领料": "issue", "成品入库": "finished", "半成品入库": "semi_finished"},
        OUTSOURCE_DEPARTMENT: {"领料": "issue", "成品入库": "finished", "半成品入库": "semi_finished"},
        HEYUAN_DEPARTMENT: {"领料": "issue", "成品入库": "finished"},
        SHAOYANG_DEPARTMENT: {"领料": "issue", "成品入库": "finished"},
        XINSHAO_DEPARTMENT: {"领料": "issue", "成品入库": "finished"},
    }
    rec_type = department_maps.get(department, {}).get(text)
    if rec_type:
        return rec_type
    fallback = {
        "来料入库": "inbound_raw",
        "领料": "issue",
        "出库": "issue",
        "成品入库": "finished",
        "半成品入库": "semi_finished",
    }.get(text)
    if fallback:
        return fallback
    raise HTTPException(status_code=400, detail=f"类型无效：{text or '空'}")


def _location_id_from_name(conn, name, row_no: int):
    name = _cell_text(name)
    if not name:
        return None
    row = conn.execute("SELECT id FROM locations WHERE name=?", (name,)).fetchone()
    if not row:
        raise HTTPException(status_code=400, detail=f"第{row_no}行：加工点不存在")
    return row["id"]


def _simple_workbook(headers, rows):
    wb = Workbook()
    ws = wb.active
    ws.append(headers)
    for row in rows:
        ws.append(row)
    return wb


def _read_name_import(file: UploadFile, *headers):
    names = []
    for row_no, row in _sheet_rows(file):
        name = _first_value(row, *headers)
        if not name:
            raise HTTPException(status_code=400, detail=f"第{row_no}行：名称不能为空")
        names.append(name)
    return names


def _insert_unique_names(conn, table, names):
    imported = 0
    skipped = 0
    for name in names:
        exists = conn.execute(f"SELECT 1 FROM {table} WHERE name=?", (name,)).fetchone()
        if exists:
            skipped += 1
            continue
        conn.execute(f"INSERT INTO {table}(name) VALUES (?)", (name,))
        imported += 1
    return {"imported": imported, "skipped": skipped}


def _legacy_excel_date(value):
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, (int, float)):
        try:
            return from_excel(value).date().isoformat()
        except Exception:
            return None
    text = _cell_text(value)
    if not text or text == "日期":
        return None
    for fmt in ("%Y-%m-%d", "%Y/%m/%d"):
        try:
            return datetime.strptime(text, fmt).date().isoformat()
        except ValueError:
            pass
    return None


def _find_legacy_item_header_row(ws):
    for row_no in range(1, ws.max_row + 1):
        if _cell_text(ws.cell(row_no, 1).value) == "物料名称":
            return row_no
    return None


def _legacy_monthly_column(ws, header_row, expected_header):
    if not header_row:
        return None
    for col_no in range(1, ws.max_column + 1):
        if _cell_text(ws.cell(header_row, col_no).value) == expected_header:
            return col_no
    return None


def _legacy_opening_stock_columns(ws, header_row):
    if not header_row:
        return []
    columns = []
    for col_no in range(1, ws.max_column + 1):
        text = _cell_text(ws.cell(header_row, col_no).value)
        if "盘点截数" in text or "入库截数" in text:
            columns.append(col_no)
    return columns


def _legacy_detail_columns(ws):
    columns = []
    for col_no in range(1, ws.max_column + 1):
        rec_date = _legacy_excel_date(ws.cell(1, col_no).value)
        doc_no = _cell_text(ws.cell(2, col_no).value)
        if rec_date and doc_no:
            columns.append((col_no, rec_date, doc_no))
    return columns


def _is_legacy_semi_finished_workbook(wb):
    for ws in wb.worksheets:
        header_row = _find_legacy_item_header_row(ws)
        if not header_row:
            continue
        headers = {
            _cell_text(ws.cell(header_row, col_no).value)
            for col_no in range(1, ws.max_column + 1)
        }
        if "当月入仓总数" in headers or "当月出仓总数" in headers:
            return True
    return False


def _is_legacy_outsource_workbook(wb):
    sheet_names = set(wb.sheetnames)
    return "领料明细" in sheet_names and "半成品入仓明细" in sheet_names


def _is_legacy_heyuan_workbook(wb):
    return (
        "成品入仓明细" in wb.sheetnames
        and any("领料明细" in name for name in wb.sheetnames)
    )


def _is_legacy_supplier_workbook(wb):
    sheet_names = set(wb.sheetnames)
    if "入仓明细" in sheet_names:
        return True
    return {"总表", "入库明细", "出库明细"}.issubset(sheet_names)


def _legacy_record_type(sheet_name):
    if "入库" in sheet_name:
        return "semi_inbound", "monthly_inbound", "当月入仓总数"
    if "领料" in sheet_name or "出库" in sheet_name:
        return "semi_outbound", "monthly_outbound", "当月出仓总数"
    return None, None, None


def _legacy_int(value, row_no, field, allow_blank=True):
    if value is None or _cell_text(value) == "":
        return None if allow_blank else _int_value(value, row_no, field)
    try:
        return int(value)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail=f"第{row_no}行：{field}必须是数字")


def _parse_legacy_semi_finished_workbook(conn, wb, department):
    if department != SEMI_FINISHED_DEPARTMENT:
        raise HTTPException(status_code=400, detail="半成品台账只能在半成品部门导入")

    bodies = []
    monthly_totals = {}
    for ws in wb.worksheets:
        if ws.title == "总表":
            continue
        rec_type, monthly_key, monthly_header = _legacy_record_type(ws.title)
        if not rec_type:
            continue
        header_row = _find_legacy_item_header_row(ws)
        if not header_row:
            continue

        detail_columns = _legacy_detail_columns(ws)
        monthly_col = _legacy_monthly_column(ws, header_row, monthly_header)
        opening_stock_columns = _legacy_opening_stock_columns(ws, header_row)
        for row_no in range(header_row + 1, ws.max_row + 1):
            sticker_type = _cell_text(ws.cell(row_no, 1).value)
            if not sticker_type:
                continue
            if "#NFC" not in sticker_type:
                continue
            sticker_type = _normalize_sticker_type(conn, NFC_MATERIAL, sticker_type)
            key = (NFC_MATERIAL, sticker_type)

            if monthly_col:
                monthly_qty = _legacy_int(
                    ws.cell(row_no, monthly_col).value,
                    row_no,
                    monthly_header,
                )
                if monthly_qty is not None:
                    monthly = monthly_totals.setdefault(
                        key,
                        {
                            "material": NFC_MATERIAL,
                            "sticker_type": sticker_type,
                            "opening_stock": 0,
                            "monthly_inbound": 0,
                            "monthly_outbound": 0,
                        },
                    )
                    monthly[monthly_key] += monthly_qty

            opening_stock_candidate = 0
            has_opening_stock = False
            for opening_col in opening_stock_columns:
                opening_qty = _legacy_int(
                    ws.cell(row_no, opening_col).value,
                    row_no,
                    "上月库存数",
                )
                if opening_qty is not None:
                    has_opening_stock = True
                    opening_stock_candidate += opening_qty
            if has_opening_stock:
                monthly = monthly_totals.setdefault(
                    key,
                    {
                        "material": NFC_MATERIAL,
                        "sticker_type": sticker_type,
                        "opening_stock": 0,
                        "monthly_inbound": 0,
                        "monthly_outbound": 0,
                    },
                )
                monthly["opening_stock"] = max(
                    monthly["opening_stock"],
                    opening_stock_candidate,
                )

            for col_no, rec_date, doc_no in detail_columns:
                qty = _legacy_int(ws.cell(row_no, col_no).value, row_no, "数量")
                if qty is None or qty <= 0:
                    continue
                body = RecordIn(
                    rec_type=rec_type,
                    rec_date=rec_date,
                    doc_no=doc_no,
                    material=NFC_MATERIAL,
                    sticker_type=sticker_type,
                    qty=qty,
                    remark=f"{ws.title}导入",
                )
                _validate_record(body, department)
                bodies.append(body)

    if not bodies and not monthly_totals:
        raise HTTPException(status_code=400, detail="半成品台账没有可导入的数据")
    return bodies, list(monthly_totals.values())


def _legacy_header_map(ws):
    headers = {}
    for col_no in range(1, ws.max_column + 1):
        header = _cell_text(ws.cell(1, col_no).value)
        if header:
            headers[header] = col_no
    return headers


def _legacy_header_value(ws, headers, row_no, *names):
    for name in names:
        col_no = headers.get(name)
        if col_no:
            return ws.cell(row_no, col_no).value
    return None


def _normalize_pcba_material(value=None):
    text = _cell_text(value)
    if not text or "PCBA" in text or "PCB" in text or "主板" in text:
        return PCBA_MATERIAL
    return text


def _outsource_date_value(value):
    rec_date = _legacy_excel_date(value)
    return rec_date


def _legacy_doc_no(value, date_value, fallback):
    doc_no = _cell_text(value)
    if doc_no:
        return doc_no
    return _cell_text(date_value) or fallback


def _legacy_location_from_sheet(sheet_name):
    if "河源" in sheet_name:
        return HEYUAN_DEPARTMENT
    if "邵阳" in sheet_name:
        return "邵阳华登"
    if "新邵" in sheet_name:
        return XINSHAO_DEPARTMENT
    if "利鸿" in sheet_name or "加工厂" in sheet_name:
        return "东莞加工厂利鸿"
    if "东莞" in sheet_name or "车间" in sheet_name:
        return "东莞车间"
    return "东莞车间"


def _add_record_body(bodies, body, department, validate_positive=True):
    if body.qty > 0 or validate_positive:
        _validate_record(body, department)
    bodies.append(body)


def _parse_legacy_outsource_workbook(wb, department):
    if department != OUTSOURCE_DEPARTMENT:
        raise HTTPException(status_code=400, detail="外发台账只能在外发部门导入")

    bodies = []
    issue_ws = wb["领料明细"] if "领料明细" in wb.sheetnames else None
    if issue_ws:
        headers = _legacy_header_map(issue_ws)
        for row_no in range(2, issue_ws.max_row + 1):
            material = _cell_text(_legacy_header_value(issue_ws, headers, row_no, "物料名称"))
            if not material or "小计" in material:
                continue
            qty = _legacy_int(
                _legacy_header_value(issue_ws, headers, row_no, "领料数"),
                row_no,
                "领料数",
            )
            if qty is None or qty == 0:
                continue
            date_value = _legacy_header_value(issue_ws, headers, row_no, "日期")
            doc_no = _cell_text(_legacy_header_value(issue_ws, headers, row_no, "领料编号"))
            if not doc_no:
                doc_no = _cell_text(date_value)
            body = RecordIn(
                rec_type="issue",
                rec_date=_outsource_date_value(date_value),
                doc_no=doc_no,
                material=_normalize_pcba_material(material),
                qty=qty,
                remark=_first_value(
                    {"备注": _legacy_header_value(issue_ws, headers, row_no, "备注")},
                    "备注",
                ) or "领料明细导入",
            )
            _validate_record(body, department)
            bodies.append(body)

    inbound_ws = wb["半成品入仓明细"] if "半成品入仓明细" in wb.sheetnames else None
    if inbound_ws:
        headers = _legacy_header_map(inbound_ws)
        for row_no in range(2, inbound_ws.max_row + 1):
            name = _cell_text(_legacy_header_value(inbound_ws, headers, row_no, "品名/规格"))
            if not name or "小计" in name:
                continue
            qty = _legacy_int(
                _legacy_header_value(inbound_ws, headers, row_no, "数量（pcs）", "数量"),
                row_no,
                "数量",
            )
            if qty is None or qty == 0:
                continue
            contract = _cell_text(_legacy_header_value(inbound_ws, headers, row_no, "合同号"))
            item_no = _cell_text(_legacy_header_value(inbound_ws, headers, row_no, "货号"))
            body = RecordIn(
                rec_type="semi_finished",
                rec_date=_outsource_date_value(
                    _legacy_header_value(inbound_ws, headers, row_no, "日期")
                ),
                doc_no=_cell_text(
                    _legacy_header_value(inbound_ws, headers, row_no, "送货单号")
                ),
                material=PCBA_MATERIAL,
                qty=qty,
                remark=" ".join(
                    part for part in [contract, item_no, name, "半成品入仓明细导入"] if part
                ),
            )
            _validate_record(body, department)
            bodies.append(body)

    if not bodies:
        raise HTTPException(status_code=400, detail="外发台账没有可导入的数据")
    return bodies


def _parse_legacy_heyuan_workbook(conn, wb, department):
    if department != HEYUAN_DEPARTMENT:
        raise HTTPException(status_code=400, detail="河源华兴台账只能在河源华兴部门导入")

    bodies = []
    location_id = _location_id_from_name(conn, HEYUAN_DEPARTMENT, 1)
    for ws in wb.worksheets:
        if "领料明细" not in ws.title:
            continue
        headers = _legacy_header_map(ws)
        for row_no in range(2, ws.max_row + 1):
            material = _cell_text(_legacy_header_value(ws, headers, row_no, "物料名称"))
            if not material or "小计" in material:
                continue
            material = _normalize_pcba_material(material)
            if material != PCBA_MATERIAL:
                continue
            qty = _legacy_int(
                _legacy_header_value(ws, headers, row_no, "领料数"),
                row_no,
                "领料数",
            )
            if qty is None or qty == 0:
                continue
            date_value = _legacy_header_value(ws, headers, row_no, "日期")
            doc_no = _cell_text(_legacy_header_value(ws, headers, row_no, "领料编号"))
            if not doc_no:
                doc_no = _cell_text(date_value)
            body = RecordIn(
                rec_type="issue",
                location_id=location_id,
                rec_date=_outsource_date_value(date_value),
                doc_no=doc_no,
                material=material,
                qty=qty,
                remark=_first_value(
                    {"备注": _legacy_header_value(ws, headers, row_no, "备注")},
                    "备注",
                ) or f"{ws.title}导入",
            )
            if qty > 0:
                _validate_record(body, department)
            bodies.append(body)

    if "成品入仓明细" in wb.sheetnames:
        ws = wb["成品入仓明细"]
        headers = _legacy_header_map(ws)
        for row_no in range(2, ws.max_row + 1):
            name = _cell_text(_legacy_header_value(ws, headers, row_no, "品名/规格"))
            if not name or "小计" in name:
                continue
            qty = _legacy_int(
                _legacy_header_value(ws, headers, row_no, "数量（pcs）", "数量"),
                row_no,
                "数量",
            )
            if qty is None or qty <= 0:
                continue
            contract = _cell_text(_legacy_header_value(ws, headers, row_no, "合同号"))
            item_no = _cell_text(_legacy_header_value(ws, headers, row_no, "货号"))
            body = RecordIn(
                rec_type="finished",
                location_id=location_id,
                rec_date=_outsource_date_value(
                    _legacy_header_value(ws, headers, row_no, "日期")
                ),
                doc_no=_cell_text(_legacy_header_value(ws, headers, row_no, "送货单号")),
                material=PCBA_MATERIAL,
                qty=qty,
                remark=" ".join(
                    part for part in [contract, item_no, name, "成品入仓明细导入"] if part
                ),
            )
            _validate_record(body, department)
            bodies.append(body)

    if not bodies:
        raise HTTPException(status_code=400, detail="河源华兴台账没有可导入的数据")
    return bodies


def _parse_legacy_supplier_pcba_workbook(conn, wb, department):
    bodies = []
    inbound_ws = wb["入仓明细"] if "入仓明细" in wb.sheetnames else None
    if inbound_ws:
        headers = _legacy_header_map(inbound_ws)
        for row_no in range(2, inbound_ws.max_row + 1):
            material = _cell_text(
                _legacy_header_value(inbound_ws, headers, row_no, "物料名称")
            )
            if not material or "小计" in material:
                continue
            qty = _legacy_int(
                _legacy_header_value(inbound_ws, headers, row_no, "入仓数", "入库数"),
                row_no,
                "入仓数",
            )
            if qty is None or qty == 0:
                continue
            date_value = _legacy_header_value(inbound_ws, headers, row_no, "日期")
            body = RecordIn(
                rec_type="inbound_raw",
                rec_date=_outsource_date_value(date_value),
                doc_no=_legacy_doc_no(
                    _legacy_header_value(inbound_ws, headers, row_no, "入仓单号", "入库单号"),
                    date_value,
                    f"{inbound_ws.title}-{row_no}",
                ),
                material=_normalize_pcba_material(material),
                qty=qty,
                remark=_first_value(
                    {"备注": _legacy_header_value(inbound_ws, headers, row_no, "备注")},
                    "备注",
                ) or f"{inbound_ws.title}导入",
            )
            _add_record_body(bodies, body, department, validate_positive=False)

    for ws in wb.worksheets:
        if "领料" not in ws.title:
            continue
        location_id = _location_id_from_name(
            conn, _legacy_location_from_sheet(ws.title), 1
        )
        headers = _legacy_header_map(ws)
        for row_no in range(2, ws.max_row + 1):
            material = _cell_text(_legacy_header_value(ws, headers, row_no, "物料名称"))
            if not material or "小计" in material:
                continue
            material = _normalize_pcba_material(material)
            if material != PCBA_MATERIAL:
                continue
            qty = _legacy_int(
                _legacy_header_value(ws, headers, row_no, "领料数"),
                row_no,
                "领料数",
            )
            if qty is None or qty == 0:
                continue
            date_value = _legacy_header_value(ws, headers, row_no, "日期")
            body = RecordIn(
                rec_type="issue",
                location_id=location_id,
                rec_date=_outsource_date_value(date_value),
                doc_no=_legacy_doc_no(
                    _legacy_header_value(ws, headers, row_no, "领料单号", "领料编号"),
                    date_value,
                    f"{ws.title}-{row_no}",
                ),
                material=material,
                qty=qty,
                remark=_first_value(
                    {"备注": _legacy_header_value(ws, headers, row_no, "备注")},
                    "备注",
                ) or f"{ws.title}导入",
            )
            _add_record_body(bodies, body, department, validate_positive=False)
    return bodies


def _nfc_total_row_values(ws, row_no):
    sticker_type = _cell_text(ws.cell(row_no, 1).value)
    if "#NFC" not in sticker_type:
        return None
    return {
        "sticker_type": sticker_type,
        "opening_inbound": _legacy_int(
            ws.cell(row_no, 3).value, row_no, "期初入仓"
        ) or 0,
        "dongguan_opening_outbound": _legacy_int(
            ws.cell(row_no, 13).value, row_no, "东莞期初出仓"
        ) or 0,
        "shaoyang_opening_outbound": _legacy_int(
            ws.cell(row_no, 14).value, row_no, "邵阳期初领料"
        ) or 0,
    }


def _parse_supplier_nfc_total_rows(conn, wb, department):
    bodies = []
    if "总表" not in wb.sheetnames:
        return bodies
    ws = wb["总表"]
    dongguan_id = _location_id_from_name(conn, "东莞车间", 1)
    shaoyang_id = _location_id_from_name(conn, "邵阳华登", 1)
    for row_no in range(3, ws.max_row + 1):
        values = _nfc_total_row_values(ws, row_no)
        if not values:
            continue
        sticker_type = _normalize_sticker_type(
            conn, NFC_MATERIAL, values["sticker_type"]
        )
        if values["opening_inbound"]:
            _add_record_body(
                bodies,
                RecordIn(
                    rec_type="inbound_raw",
                    material=NFC_MATERIAL,
                    sticker_type=sticker_type,
                    doc_no=f"{sticker_type}-期初入仓",
                    qty=values["opening_inbound"],
                    remark="总表期初入仓导入",
                ),
                department,
            )
        if values["dongguan_opening_outbound"]:
            _add_record_body(
                bodies,
                RecordIn(
                    rec_type="issue",
                    location_id=dongguan_id,
                    material=NFC_MATERIAL,
                    sticker_type=sticker_type,
                    doc_no=f"{sticker_type}-东莞期初出仓",
                    qty=values["dongguan_opening_outbound"],
                    remark="总表东莞期初出仓导入",
                ),
                department,
            )
        if values["shaoyang_opening_outbound"]:
            _add_record_body(
                bodies,
                RecordIn(
                    rec_type="issue",
                    location_id=shaoyang_id,
                    material=NFC_MATERIAL,
                    sticker_type=sticker_type,
                    doc_no=f"{sticker_type}-邵阳期初领料",
                    qty=values["shaoyang_opening_outbound"],
                    remark="总表邵阳期初领料导入",
                ),
                department,
            )
    return bodies


def _parse_supplier_nfc_detail_sheet(conn, ws, rec_type, department):
    bodies = []
    header_row = _find_legacy_item_header_row(ws)
    if not header_row:
        return bodies
    location_id = None
    if rec_type == "issue":
        location_id = _location_id_from_name(conn, "东莞车间", 1)
    for row_no in range(header_row + 1, ws.max_row + 1):
        sticker_type = _cell_text(ws.cell(row_no, 1).value)
        if "#NFC" not in sticker_type:
            continue
        sticker_type = _normalize_sticker_type(conn, NFC_MATERIAL, sticker_type)
        for col_no in range(3, ws.max_column + 1):
            qty = _legacy_int(ws.cell(row_no, col_no).value, row_no, "数量")
            if qty is None or qty == 0:
                continue
            date_value = ws.cell(1, col_no).value
            body = RecordIn(
                rec_type=rec_type,
                location_id=location_id,
                rec_date=_outsource_date_value(date_value),
                doc_no=_legacy_doc_no(
                    ws.cell(header_row, col_no).value,
                    date_value,
                    f"{ws.title}-{row_no}-{col_no}",
                ),
                material=NFC_MATERIAL,
                sticker_type=sticker_type,
                qty=qty,
                remark=f"{ws.title}导入",
            )
            _add_record_body(
                bodies, body, department, validate_positive=(qty > 0)
            )
    return bodies


def _parse_legacy_supplier_workbook(conn, wb, department):
    if department != SUPPLIER_DEPARTMENT:
        raise HTTPException(status_code=400, detail="来料仓台账只能在兴信B来料仓导入")

    bodies = []
    if "入仓明细" in wb.sheetnames:
        bodies.extend(_parse_legacy_supplier_pcba_workbook(conn, wb, department))
    if {"总表", "入库明细", "出库明细"}.issubset(set(wb.sheetnames)):
        bodies.extend(_parse_supplier_nfc_total_rows(conn, wb, department))
        bodies.extend(
            _parse_supplier_nfc_detail_sheet(
                conn, wb["入库明细"], "inbound_raw", department
            )
        )
        bodies.extend(
            _parse_supplier_nfc_detail_sheet(
                conn, wb["出库明细"], "issue", department
            )
        )
    if not bodies:
        raise HTTPException(status_code=400, detail="来料仓台账没有可导入的数据")
    return bodies


def _record_duplicate_exists(conn, body, user):
    return conn.execute(
        "SELECT id FROM records WHERE department=? AND rec_type=? "
        "AND COALESCE(rec_date, '')=? AND COALESCE(doc_no, '')=? "
        "AND material=? AND COALESCE(sticker_type, '')=? AND qty=? "
        "AND COALESCE(location_id, 0)=? AND COALESCE(remark, '')=?",
        (
            user["department"],
            body.rec_type,
            body.rec_date or "",
            body.doc_no or "",
            body.material,
            body.sticker_type or "",
            body.qty,
            body.location_id or 0,
            body.remark or "",
        ),
    ).fetchone() is not None


def _insert_record_body(conn, body, user, skip_duplicate=False):
    if skip_duplicate and _record_duplicate_exists(conn, body, user):
        return None
    supplier, po_no, customer_name = _record_extras(body, user["department"])
    sticker_type = _normalize_sticker_type(conn, body.material, body.sticker_type)
    cur = conn.execute(
        "INSERT INTO records(rec_type, location_id, rec_date, doc_no, "
        "material, sticker_type, qty, remark, supplier, po_no, customer_name, department, created_by) "
        "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (body.rec_type, body.location_id, body.rec_date, body.doc_no,
         body.material, sticker_type, body.qty, body.remark, supplier, po_no, customer_name,
         user["department"], user["id"]),
    )
    return cur.lastrowid


def _upsert_semi_finished_monthly_totals(conn, department, rows):
    for row in rows:
        conn.execute(
            "INSERT INTO semi_finished_monthly_totals("
            "department, material, sticker_type, opening_stock, monthly_inbound, monthly_outbound"
            ") VALUES (?,?,?,?,?,?) "
            "ON CONFLICT(department, material, sticker_type) DO UPDATE SET "
            "opening_stock=excluded.opening_stock, "
            "monthly_inbound=excluded.monthly_inbound, "
            "monthly_outbound=excluded.monthly_outbound, "
            "updated_at=datetime('now')",
            (
                department,
                row["material"],
                row["sticker_type"],
                int(row["opening_stock"] or 0),
                int(row["monthly_inbound"] or 0),
                int(row["monthly_outbound"] or 0),
            ),
        )


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


@app.get("/api/materials/export")
def export_materials(_user=Depends(current_user)):
    conn = db.get_conn()
    try:
        rows = conn.execute("SELECT name FROM materials ORDER BY id").fetchall()
    finally:
        conn.close()
    wb = _simple_workbook(["物料名称"], [[row["name"]] for row in rows])
    return _xlsx_response(wb, "materials.xlsx")


@app.post("/api/materials/import")
def import_materials(file: UploadFile = File(...), _user=Depends(current_user)):
    names = _read_name_import(file, "物料名称", "物料", "名称")
    conn = db.get_conn()
    try:
        result = _insert_unique_names(conn, "materials", names)
        conn.commit()
    finally:
        conn.close()
    return result


class MaterialIn(BaseModel):
    name: str


class SupplierIn(BaseModel):
    name: str


class StickerTypeIn(BaseModel):
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


@app.get("/api/suppliers/export")
def export_suppliers(_user=Depends(current_user)):
    conn = db.get_conn()
    try:
        rows = conn.execute("SELECT name FROM suppliers ORDER BY id").fetchall()
    finally:
        conn.close()
    wb = _simple_workbook(["供应商名称"], [[row["name"]] for row in rows])
    return _xlsx_response(wb, "suppliers.xlsx")


@app.post("/api/suppliers/import")
def import_suppliers(file: UploadFile = File(...), _user=Depends(current_user)):
    names = _read_name_import(file, "供应商名称", "供应商", "名称")
    conn = db.get_conn()
    try:
        result = _insert_unique_names(conn, "suppliers", names)
        conn.commit()
    finally:
        conn.close()
    return result


@app.post("/api/suppliers")
def create_supplier(body: SupplierIn, _user=Depends(current_user)):
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
def update_supplier(supplier_id: int, body: SupplierIn, _user=Depends(current_user)):
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
def delete_supplier(supplier_id: int, _user=Depends(current_user)):
    conn = db.get_conn()
    try:
        conn.execute("DELETE FROM suppliers WHERE id=?", (supplier_id,))
        conn.commit()
    finally:
        conn.close()
    return {"ok": True}


@app.get("/api/sticker-types")
def list_sticker_types(_user=Depends(current_user)):
    conn = db.get_conn()
    try:
        rows = conn.execute(
            "SELECT id, name, sort FROM sticker_types ORDER BY sort, id"
        ).fetchall()
    finally:
        conn.close()
    return [dict(r) for r in rows]


@app.get("/api/sticker-types/export")
def export_sticker_types(_user=Depends(current_user)):
    conn = db.get_conn()
    try:
        rows = conn.execute(
            "SELECT sort, name FROM sticker_types ORDER BY sort, id"
        ).fetchall()
    finally:
        conn.close()
    wb = _simple_workbook(["排序", "贴纸类型"], [[row["sort"], row["name"]] for row in rows])
    return _xlsx_response(wb, "sticker_types.xlsx")


@app.post("/api/sticker-types/import")
def import_sticker_types(file: UploadFile = File(...), _user=Depends(current_user)):
    incoming = []
    seen_names = set()
    seen_sorts = set()
    for index, (row_no, row) in enumerate(_sheet_rows(file), start=1):
        name = _first_value(row, "贴纸类型", "贴纸名称", "名称")
        if not name:
            raise HTTPException(status_code=400, detail=f"第{row_no}行：贴纸类型不能为空")
        if name in seen_names:
            raise HTTPException(status_code=400, detail=f"第{row_no}行：贴纸类型重复")
        seen_names.add(name)
        sort_text = _first_value(row, "排序")
        try:
            sort = int(sort_text) if sort_text else index
        except ValueError:
            raise HTTPException(status_code=400, detail=f"第{row_no}行：排序必须是数字")
        if sort in seen_sorts:
            raise HTTPException(status_code=400, detail=f"第{row_no}行：排序重复")
        seen_sorts.add(sort)
        incoming.append((sort, name))

    imported = 0
    skipped = 0
    conn = db.get_conn()
    try:
        for sort, name in incoming:
            by_sort = conn.execute(
                "SELECT id, name FROM sticker_types WHERE sort=?", (sort,)
            ).fetchone()
            by_name = conn.execute(
                "SELECT id, name FROM sticker_types WHERE name=?", (name,)
            ).fetchone()
            if by_sort:
                old_name = by_sort["name"]
                if old_name == name:
                    skipped += 1
                    continue
                if by_name and by_name["id"] != by_sort["id"]:
                    raise HTTPException(status_code=400, detail=f"贴纸类型已存在：{name}")
                conn.execute(
                    "UPDATE sticker_types SET name=? WHERE id=?",
                    (name, by_sort["id"]),
                )
                conn.execute(
                    "UPDATE records SET sticker_type=? WHERE sticker_type=?",
                    (name, old_name),
                )
                imported += 1
            elif by_name:
                conn.execute(
                    "UPDATE sticker_types SET sort=? WHERE id=?",
                    (sort, by_name["id"]),
                )
                imported += 1
            else:
                conn.execute(
                    "INSERT INTO sticker_types(name, sort) VALUES (?, ?)",
                    (name, sort),
                )
                imported += 1
        conn.commit()
    finally:
        conn.close()
    return {"imported": imported, "skipped": skipped}


@app.post("/api/sticker-types")
def create_sticker_type(body: StickerTypeIn, _user=Depends(current_user)):
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="贴纸类型不能为空")
    conn = db.get_conn()
    try:
        exists = conn.execute(
            "SELECT 1 FROM sticker_types WHERE name=?", (name,)
        ).fetchone()
        if exists:
            raise HTTPException(status_code=400, detail="贴纸类型已存在")
        next_sort = conn.execute(
            "SELECT COALESCE(MAX(sort), 0) + 1 AS next_sort FROM sticker_types"
        ).fetchone()["next_sort"]
        cur = conn.execute(
            "INSERT INTO sticker_types(name, sort) VALUES (?, ?)",
            (name, next_sort),
        )
        conn.commit()
        new_id = cur.lastrowid
    finally:
        conn.close()
    return {"id": new_id, "name": name, "sort": next_sort}


@app.put("/api/sticker-types/{sticker_type_id}")
def update_sticker_type(
    sticker_type_id: int,
    body: StickerTypeIn,
    _user=Depends(current_user),
):
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="贴纸类型不能为空")
    conn = db.get_conn()
    try:
        row = conn.execute(
            "SELECT id, sort FROM sticker_types WHERE id=?", (sticker_type_id,)
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="贴纸类型不存在")
        exists = conn.execute(
            "SELECT 1 FROM sticker_types WHERE name=? AND id<>?",
            (name, sticker_type_id),
        ).fetchone()
        if exists:
            raise HTTPException(status_code=400, detail="贴纸类型已存在")
        conn.execute(
            "UPDATE sticker_types SET name=? WHERE id=?",
            (name, sticker_type_id),
        )
        conn.commit()
        sort = row["sort"]
    finally:
        conn.close()
    return {"id": sticker_type_id, "name": name, "sort": sort}


@app.delete("/api/sticker-types/{sticker_type_id}")
def delete_sticker_type(sticker_type_id: int, _user=Depends(current_user)):
    conn = db.get_conn()
    try:
        conn.execute("DELETE FROM sticker_types WHERE id=?", (sticker_type_id,))
        conn.commit()
    finally:
        conn.close()
    return {"ok": True}


@app.post("/api/materials")
def create_material(body: MaterialIn, _user=Depends(current_user)):
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
def update_material(material_id: int, body: MaterialIn, _user=Depends(current_user)):
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
def delete_material(material_id: int, _user=Depends(current_user)):
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
    material: str = PCBA_MATERIAL
    sticker_type: Optional[str] = None
    qty: int
    remark: Optional[str] = None
    supplier: Optional[str] = None
    po_no: Optional[str] = None
    customer_name: Optional[str] = None


def _validate_record(body: RecordIn, department: Optional[str] = None):
    if body.rec_type not in VALID_TYPES:
        raise HTTPException(status_code=400, detail="类型无效")
    if department == OUTSOURCE_DEPARTMENT and body.rec_type not in ("issue", "finished", "semi_finished"):
        raise HTTPException(status_code=400, detail="外发只能录入领料/成品/半成品入库")
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


class StickerRecordItemIn(BaseModel):
    sticker_type: str
    qty: int


class RecordBatchIn(BaseModel):
    rec_type: str
    location_id: Optional[int] = None
    rec_date: Optional[str] = None
    doc_no: Optional[str] = None
    material: str = NFC_MATERIAL
    remark: Optional[str] = None
    supplier: Optional[str] = None
    po_no: Optional[str] = None
    customer_name: Optional[str] = None
    items: List[StickerRecordItemIn]


def _record_extras(body, department):
    supplier = (body.supplier or "").strip() or None
    if department != SUPPLIER_DEPARTMENT:
        supplier = None
    po_no = (body.po_no or "").strip() or None
    customer_name = (body.customer_name or "").strip() or None
    if department not in PO_CUSTOMER_DEPARTMENTS or body.rec_type != "finished":
        po_no = None
        customer_name = None
    return supplier, po_no, customer_name


def _normalize_sticker_type(conn, material, sticker_type):
    if material != NFC_MATERIAL:
        return None
    sticker_type = _clean_optional(sticker_type)
    if not sticker_type:
        return None
    row = conn.execute(
        "SELECT name FROM sticker_types WHERE name=?", (sticker_type,)
    ).fetchone()
    if not row:
        raise HTTPException(status_code=400, detail="贴纸类型无效")
    return row["name"]


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
    conn = db.get_conn()
    try:
        supplier, po_no, customer_name = _record_extras(body, user["department"])
        sticker_type = _normalize_sticker_type(conn, body.material, body.sticker_type)
        cur = conn.execute(
            "INSERT INTO records(rec_type, location_id, rec_date, doc_no, "
            "material, sticker_type, qty, remark, supplier, po_no, customer_name, department, created_by) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (body.rec_type, body.location_id, body.rec_date, body.doc_no,
             body.material, sticker_type, body.qty, body.remark, supplier, po_no, customer_name,
             user["department"], user["id"]),
        )
        conn.commit()
        new_id = cur.lastrowid
    finally:
        conn.close()
    return {"id": new_id}


@app.post("/api/records/batch")
def create_records_batch(body: RecordBatchIn, user=Depends(current_user)):
    if body.material != NFC_MATERIAL:
        raise HTTPException(status_code=400, detail="批量录入仅支持 NFC贴纸")
    if not body.items:
        raise HTTPException(status_code=400, detail="请选择至少一种贴纸")
    common = RecordIn(
        rec_type=body.rec_type,
        location_id=body.location_id,
        rec_date=body.rec_date,
        doc_no=body.doc_no,
        material=body.material,
        qty=sum(int(item.qty or 0) for item in body.items),
        remark=body.remark,
        supplier=body.supplier,
        po_no=body.po_no,
        customer_name=body.customer_name,
    )
    _validate_record(common, user["department"])
    conn = db.get_conn()
    try:
        supplier, po_no, customer_name = _record_extras(common, user["department"])
        seen = set()
        valid_items = []
        for item in body.items:
            if item.qty is None or item.qty <= 0:
                raise HTTPException(status_code=400, detail="贴纸数量必须大于 0")
            sticker_type = _normalize_sticker_type(conn, NFC_MATERIAL, item.sticker_type)
            if not sticker_type:
                raise HTTPException(status_code=400, detail="贴纸类型不能为空")
            if sticker_type in seen:
                raise HTTPException(status_code=400, detail="贴纸类型不能重复")
            seen.add(sticker_type)
            valid_items.append((sticker_type, item.qty))
        ids = []
        for sticker_type, qty in valid_items:
            cur = conn.execute(
                "INSERT INTO records(rec_type, location_id, rec_date, doc_no, "
                "material, sticker_type, qty, remark, supplier, po_no, customer_name, department, created_by) "
                "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (common.rec_type, common.location_id, common.rec_date, common.doc_no,
                 NFC_MATERIAL, sticker_type, qty, common.remark, supplier, po_no, customer_name,
                 user["department"], user["id"]),
            )
            ids.append(cur.lastrowid)
        conn.commit()
    finally:
        conn.close()
    return {"ids": ids}


@app.get("/api/records/import-template")
def record_import_template(_user=Depends(current_user)):
    wb = Workbook()
    ws = wb.active
    ws.title = "流水导入模板"
    ws.append(RECORD_IMPORT_HEADERS)
    ws.append([
        "入库", "NFC贴纸", "1#NFC贴纸", "", "供应商A",
        "2026-07-08", "示例单号001", 100, "示例行，可删除", "", "",
    ])
    return _xlsx_response(wb, "records_import_template.xlsx")


def _record_body_from_import_row(conn, row_no, row, department):
    rec_type = _record_type_from_import(_first_value(row, "类型"), department)
    material = _first_value(row, "物料名称", "物料") or PCBA_MATERIAL
    sticker_type = _first_value(row, "贴纸类型", "贴纸名称")
    if material == NFC_MATERIAL and not sticker_type:
        raise HTTPException(status_code=400, detail=f"第{row_no}行：NFC贴纸必须填写贴纸类型")
    body = RecordIn(
        rec_type=rec_type,
        location_id=_location_id_from_name(
            conn,
            _first_value(row, "加工点", "地点"),
            row_no,
        ),
        rec_date=_date_value(row.get("日期"), row_no),
        doc_no=_first_value(row, "单据编号", "单号"),
        material=material,
        sticker_type=sticker_type,
        qty=_int_value(row.get("数量"), row_no, "数量"),
        remark=_first_value(row, "备注"),
        supplier=_first_value(row, "供应商"),
        po_no=_first_value(row, "PO"),
        customer_name=_first_value(row, "客名", "客户名"),
    )
    _validate_record(body, department)
    return body


@app.post("/api/records/import")
def import_records(file: UploadFile = File(...), user=Depends(current_user)):
    wb = _load_upload_workbook(file)
    conn = db.get_conn()
    try:
        legacy_semi_finished_import = _is_legacy_semi_finished_workbook(wb)
        legacy_outsource_import = _is_legacy_outsource_workbook(wb)
        legacy_heyuan_import = _is_legacy_heyuan_workbook(wb)
        legacy_supplier_import = _is_legacy_supplier_workbook(wb)
        legacy_import = (
            legacy_semi_finished_import
            or legacy_outsource_import
            or legacy_heyuan_import
            or legacy_supplier_import
        )
        if legacy_semi_finished_import:
            bodies, monthly_totals = _parse_legacy_semi_finished_workbook(
                conn, wb, user["department"]
            )
        elif legacy_outsource_import:
            bodies = _parse_legacy_outsource_workbook(wb, user["department"])
            monthly_totals = []
        elif legacy_heyuan_import:
            bodies = _parse_legacy_heyuan_workbook(conn, wb, user["department"])
            monthly_totals = []
        elif legacy_supplier_import:
            bodies = _parse_legacy_supplier_workbook(conn, wb, user["department"])
            monthly_totals = []
        else:
            rows = _worksheet_rows(wb.active)
            if not rows:
                raise HTTPException(status_code=400, detail="Excel 没有可导入的数据")
            bodies = [
                _record_body_from_import_row(conn, row_no, row, user["department"])
                for row_no, row in rows
            ]
            monthly_totals = []
        ids = []
        skipped = 0
        for body in bodies:
            record_id = _insert_record_body(
                conn,
                body,
                user,
                skip_duplicate=legacy_import,
            )
            if record_id is None:
                skipped += 1
            else:
                ids.append(record_id)
        if monthly_totals:
            _upsert_semi_finished_monthly_totals(
                conn, user["department"], monthly_totals
            )
        conn.commit()
    finally:
        conn.close()
    return {
        "created": len(ids),
        "ids": ids,
        "monthly_totals": len(monthly_totals),
        "skipped": skipped,
    }


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
    conn = db.get_conn()
    try:
        supplier, po_no, customer_name = _record_extras(body, user["department"])
        sticker_type = _normalize_sticker_type(conn, body.material, body.sticker_type)
        row = _get_record_or_404(conn, record_id, user["department"])
        _check_owner(row, user)
        conn.execute(
            "UPDATE records SET rec_type=?, location_id=?, rec_date=?, doc_no=?, "
            "material=?, sticker_type=?, qty=?, remark=?, supplier=?, po_no=?, customer_name=? WHERE id=?",
            (body.rec_type, body.location_id, body.rec_date, body.doc_no,
             body.material, sticker_type, body.qty, body.remark, supplier, po_no, customer_name,
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
        "r.material AS material, r.sticker_type AS sticker_type, r.department AS department "
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
        "r.material AS material, r.sticker_type AS sticker_type, r.department AS department "
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


def _public_semi_finished_monthly_totals(conn, material=None, department=None):
    if department and department != SEMI_FINISHED_DEPARTMENT:
        return []
    sql = (
        "SELECT department, material, sticker_type, opening_stock, "
        "monthly_inbound, monthly_outbound, "
        "(opening_stock + monthly_inbound - monthly_outbound) AS monthly_balance "
        "FROM semi_finished_monthly_totals WHERE department=?"
    )
    params = [SEMI_FINISHED_DEPARTMENT]
    if material:
        sql += " AND material=?"
        params.append(material)
    sql += " ORDER BY sticker_type"
    return [dict(r) for r in conn.execute(sql, params).fetchall()]


def _with_common_summary_fields(summary, records, filters, reverse_departments=()):
    reverse_departments = set(reverse_departments or ())
    result = dict(summary)
    result["materials"] = compute_material_totals(records, reverse_departments)
    result["sticker_types"] = compute_sticker_type_totals(
        records, reverse_departments
    )
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
    issue = sum(int(r["qty"] or 0) for r in records if r["rec_type"] == "issue")
    finished = sum(int(r["qty"] or 0) for r in records if r["rec_type"] == "finished")
    semi_finished = sum(int(r["qty"] or 0) for r in records if r["rec_type"] == "semi_finished")
    inbound = finished + semi_finished
    balance = issue - inbound if issue else inbound
    return {
        "locations": [
            {"location": name, "issue": 0, "finished": 0, "balance": 0}
            for name in LOCATIONS
        ],
        "subtotal": {"issue": 0, "finished": 0, "balance": 0},
        "raw": {
            "issue": issue,
            "finished_inbound": finished,
            "semi_finished_inbound": semi_finished,
            "inbound": inbound,
            "outbound": issue,
            "balance": balance,
        },
    }


def _compute_processing_department_summary(records):
    summary = compute_summary(records, LOCATIONS)
    summary["raw"] = {
        "inbound": summary["subtotal"]["finished"],
        "outbound": summary["subtotal"]["issue"],
        "balance": summary["subtotal"]["balance"],
    }
    return summary


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
        semi_finished_monthly_totals = _public_semi_finished_monthly_totals(
            conn,
            material=material,
            department=department,
        )
    finally:
        conn.close()
    result = compute_public_summary(
        records,
        DEPARTMENTS,
        public_filters,
        reverse_departments={
            OUTSOURCE_DEPARTMENT,
            *PROCESSING_BALANCE_DEPARTMENTS,
        },
    )
    result["semi_finished_monthly_totals"] = semi_finished_monthly_totals
    return result


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
        return _with_common_summary_fields(
            summary_data, records, filters, {OUTSOURCE_DEPARTMENT}
        )
    if user["department"] in PROCESSING_BALANCE_DEPARTMENTS:
        summary_data = _compute_processing_department_summary(records)
        return _with_common_summary_fields(
            summary_data, records, filters, {user["department"]}
        )
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
            "r.material, r.sticker_type, r.supplier, r.po_no, r.customer_name, r.qty, r.remark FROM records r "
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
    elif user["department"] in PROCESSING_BALANCE_DEPARTMENTS:
        summary = _compute_processing_department_summary(summary_records)
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
