# -*- coding: utf-8 -*-
"""接单表入单系统 — Flask主程序
PO Excel → 解析 → 生成新Excel下载
"""
import os
import re
import sys
import json
import time
import uuid
import logging
import logging.handlers
import threading
from datetime import datetime, timedelta

from flask import (Flask, render_template, request, jsonify,
                   send_file, Response, stream_with_context)
from werkzeug.middleware.proxy_fix import ProxyFix
from werkzeug.utils import secure_filename
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side

import po_parser


# LOCAL_MODE 控制：本地（桌面上 Win/Mac 直接跑）= 1，cloud 部署 = 0
# 影响 /api/browse 和 /api/check_path /api/config 的任意路径访问
# 打包成 exe（桌面单机用）时默认 1
LOCAL_MODE = os.environ.get(
    'LOCAL_MODE', '1' if getattr(sys, 'frozen', False) else '0') == '1'

# Flask debug：仅当显式设置时启用，避免 RCE 风险
FLASK_DEBUG = os.environ.get('FLASK_DEBUG', '0') == '1'


def _safe_filename(name):
    """清理文件名中的不安全字符，保留中文 (secure_filename 会去掉中文)"""
    if not name:
        return f'unnamed_{uuid.uuid4().hex[:8]}.xlsx'
    # 替换路径分隔符、控制字符、特殊空白
    name = name.replace('\\', '_').replace('/', '_').replace('\x00', '')
    name = name.replace('\xa0', ' ').replace('\r', '').replace('\n', '')
    # 去掉所有控制字符
    name = ''.join(c for c in name if ord(c) >= 32)
    # 去掉前导 . 防止 .. 类路径穿越（os.path.join 不会解 .. 但保险）
    name = name.lstrip('.').strip()
    if not name or name in ('.', '..'):
        return f'unnamed_{uuid.uuid4().hex[:8]}.xlsx'
    # 加 uuid 前缀避免文件名碰撞 + 防止任何残留路径技巧
    base = name[-100:]  # 限制长度
    return f'{uuid.uuid4().hex[:8]}_{base}'


if getattr(sys, 'frozen', False):
    # 打包成 exe 运行：模板/静态文件/映射表在 PyInstaller 临时目录（只读），
    # 可写数据（上传、导出、配置、日志）放 exe 旁边
    APP_DIR = sys._MEIPASS
    DATA_PATH = os.environ.get('DATA_PATH', os.path.dirname(sys.executable))
else:
    APP_DIR = os.path.dirname(os.path.abspath(__file__))
    # DATA_PATH: Docker部署时挂载卷，本地运行默认APP_DIR
    DATA_PATH = os.environ.get('DATA_PATH', APP_DIR)

app = Flask(__name__, template_folder=os.path.join(APP_DIR, 'templates'),
            static_folder=os.path.join(APP_DIR, 'static'))
# 运行在nginx反向代理后，修正客户端IP/协议/路径前缀等header
app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1, x_prefix=1)

app.config['UPLOAD_FOLDER'] = os.path.join(DATA_PATH, 'uploads')
app.config['EXPORT_FOLDER'] = os.path.join(DATA_PATH, 'exports')
app.config['DATA_FOLDER'] = os.path.join(DATA_PATH, 'data')
# 实际 PO 文件 ~MB 级别，限到 32MB 防止 OOM (mem_limit 512m)
app.config['MAX_CONTENT_LENGTH'] = 32 * 1024 * 1024
os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)
os.makedirs(app.config['EXPORT_FOLDER'], exist_ok=True)
os.makedirs(app.config['DATA_FOLDER'], exist_ok=True)

# 日志：rotating 防止无限增长
LOG_FILE = os.path.join(app.config['DATA_FOLDER'], 'ops.log')
_log_handler = logging.handlers.RotatingFileHandler(
    LOG_FILE, maxBytes=10 * 1024 * 1024, backupCount=3, encoding='utf-8')
_log_handler.setFormatter(logging.Formatter('%(asctime)s %(message)s'))
logging.getLogger().setLevel(logging.INFO)
logging.getLogger().addHandler(_log_handler)


# === 加载映射数据 ===
# 映射数据（country_map/item_map）从 data/ 读取，Docker环境下可通过卷挂载覆盖
def _load_json(name):
    p = os.path.join(APP_DIR, 'data', name)
    if os.path.exists(p):
        with open(p, 'r', encoding='utf-8') as f:
            return json.load(f)
    return {}


COUNTRY_MAP = _load_json('country_map.json')
# 美国目的国仅显示"美国"，不带洲后缀（仅美国如此，覆盖映射表中的 -北美洲 值）
COUNTRY_MAP.update({k: '美国' for k in
                    ('USA', 'United States', 'US', 'U.S.', 'U.S.A.',
                     'United States of America', 'America')})

# 货号映射：可写副本（DATA_FOLDER/item_map.json，"更新货号"功能的落盘位置）优先，
# 没有则用打包内置的（exe 内置数据只读，更新必须写 exe 旁边的 data/）
_item_map_lock = threading.Lock()


def _load_item_map():
    writable = os.path.join(app.config['DATA_FOLDER'], 'item_map.json')
    if os.path.exists(writable):
        try:
            with open(writable, 'r', encoding='utf-8') as f:
                data = json.load(f)
            if isinstance(data, dict) and data:
                return data, False
        except (OSError, ValueError) as e:
            logging.error(f'读取可写货号映射失败，回退内置: {writable} - {e}')
    return _load_json('item_map.json'), True


ITEM_MAP, _ITEM_MAP_BUILTIN = _load_item_map()


def _item_map_meta():
    with _item_map_lock:
        count = len(ITEM_MAP)
    writable = os.path.join(app.config['DATA_FOLDER'], 'item_map.json')
    if os.path.exists(writable):
        ts = datetime.fromtimestamp(
            os.path.getmtime(writable)).strftime('%Y-%m-%d %H:%M')
        return {'count': count, 'builtin': False, 'updated': ts}
    return {'count': count, 'builtin': True, 'updated': ''}
# 黑名单货号（河源等独立排期，不入总排期接单表）
_ignore_data = _load_json('ignore_items.json')
IGNORE_ITEMS = set(_ignore_data.get('ignore_items', []) if isinstance(_ignore_data, dict) else [])


# === 取消PO名单（用户手动维护，存 DATA_FOLDER 可写目录）===
def _norm_po(po):
    """PO号归一化：去空白、大写（兼容 "PO- 4500224166" 这类带空格写法）"""
    return re.sub(r'\s+', '', str(po or '')).upper()


_cancel_pos_lock = threading.Lock()


def _cancel_pos_file():
    return os.path.join(app.config['DATA_FOLDER'], 'cancelled_pos.json')


def _load_cancelled_pos():
    p = _cancel_pos_file()
    if os.path.exists(p):
        try:
            with open(p, 'r', encoding='utf-8') as f:
                d = json.load(f)
            items = d.get('cancelled_pos', []) if isinstance(d, dict) else []
            return {_norm_po(x) for x in items if _norm_po(x)}
        except (OSError, ValueError) as e:
            logging.error(f'读取取消PO名单失败: {p} - {e}')
    return set()


def _save_cancelled_pos(pos):
    with open(_cancel_pos_file(), 'w', encoding='utf-8') as f:
        json.dump({'cancelled_pos': sorted(pos)}, f, ensure_ascii=False, indent=2)


CANCELLED_POS = _load_cancelled_pos()

# 任务管理：每个 process 请求一个 task_id，避免并发互相覆盖
_tasks = {}
_tasks_lock = threading.Lock()
_TASK_TTL_SECS = 600  # 10 分钟后清理已完成任务


def _new_task():
    task_id = uuid.uuid4().hex[:12]
    task = {
        'id': task_id,
        'created_at': time.time(),
        'current': 0, 'total': 0, 'msg': '排队中...',
        'done': False, 'result': None,
    }
    with _tasks_lock:
        # 清理过期任务
        now = time.time()
        stale = [tid for tid, t in _tasks.items()
                 if t['done'] and (now - t['created_at']) > _TASK_TTL_SECS]
        for tid in stale:
            _tasks.pop(tid, None)
        _tasks[task_id] = task
    return task


def _get_task(task_id):
    with _tasks_lock:
        return _tasks.get(task_id)


# 接单表路径配置（运行时产物，存在 DATA_FOLDER 下，Docker环境下卷挂载）
_CONFIG_FILE = os.path.join(app.config['DATA_FOLDER'], 'config.json')


def _load_config():
    if os.path.exists(_CONFIG_FILE):
        with open(_CONFIG_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)
    return {}


def _save_config(cfg):
    with open(_CONFIG_FILE, 'w', encoding='utf-8') as f:
        json.dump(cfg, f, ensure_ascii=False, indent=2)


# 接单表 PO 缓存：(mtime, size) → set[str]。openpyxl read_only 下 ws.cell(r,c) 是 O(N²)，
# 对 2500+ 行接单表相当于每次请求 30+ 分钟；改用 iter_rows 流式读 + mtime-key 缓存
_pos_cache_lock = threading.Lock()
_pos_cache = {'key': None, 'pos': set()}


def _read_existing_pos(filepath):
    """读取接单表B列所有PO号，返回set。mtime 没变则命中缓存。"""
    try:
        st = os.stat(filepath)
        key = (filepath, st.st_mtime, st.st_size)
    except OSError as e:
        logging.error(f'读取接单表 stat 失败: {filepath} - {e}')
        return set()

    with _pos_cache_lock:
        if _pos_cache['key'] == key:
            return _pos_cache['pos']

    pos = set()
    try:
        wb = openpyxl.load_workbook(filepath, data_only=True, read_only=True)
        ws = wb.active
        # iter_rows 流式读取：对 2500+ 行比 ws.cell(r,c) 快 ~200×
        for row in ws.iter_rows(min_row=3, min_col=2, max_col=2, values_only=True):
            v = row[0]
            if v:
                s = str(v).strip().replace('.0', '')
                if s:
                    pos.add(s)
        wb.close()
    except Exception as e:
        logging.error(f'读取接单表失败: {filepath} - {e}')
        return set()

    with _pos_cache_lock:
        _pos_cache['key'] = key
        _pos_cache['pos'] = pos
    return pos


def _read_items_from_table(filepath):
    """从接单表「货号」sheet 读取货号映射。
    重复货号取第一行（与接单表 VLOOKUP 行为一致），重复记录进 dupes。
    Returns: (items: dict, dupes: list)"""
    wb = openpyxl.load_workbook(filepath, data_only=True, read_only=True)
    sheet = next((n for n in wb.sheetnames if str(n).strip() == '货号'), None)
    if not sheet:
        wb.close()
        raise ValueError('找不到「货号」工作表，请确认选择的是接单表文件')
    items, dupes = {}, []
    first_row = True
    for row in wb[sheet].iter_rows(values_only=True):
        code = row[0] if row else None
        if first_row:
            first_row = False
            # 跳过表头行（货号/中文名称/生产车间/排期名）
            if code is not None and str(code).strip() == '货号':
                continue
        if code is None or str(code).strip() == '':
            continue
        key = str(code).strip()
        if key.endswith('.0'):  # Excel 数字货号读出来可能带 .0
            key = key[:-2]
        entry = {
            'cn_name': str(row[1]).strip() if len(row) > 1 and row[1] else '',
            'workshop': str(row[2]).strip() if len(row) > 2 and row[2] else '',
            'schedule_name': str(row[3]).strip() if len(row) > 3 and row[3] else '',
        }
        if key in items:
            dupes.append(key)
            continue
        items[key] = entry
    wb.close()
    return items, dupes


def _list_dir(path):
    """列出目录内容，返回文件夹和xlsx文件"""
    items = []
    try:
        for name in sorted(os.listdir(path)):
            full = os.path.join(path, name)
            if os.path.isdir(full):
                items.append({'name': name, 'type': 'dir'})
            elif name.lower().endswith(('.xlsx', '.xls')):
                items.append({'name': name, 'type': 'file'})
    except PermissionError:
        pass
    return items


def _translate_country(en_name):
    """英文国家名 → 中文（含洲）"""
    if not en_name:
        return ''
    # PDF转Excel常产生双空格（如 "Hong  Kong"），先归一再查表
    key = re.sub(r'\s+', ' ', str(en_name).strip())
    cn = COUNTRY_MAP.get(key)
    if cn:
        return cn
    for k, v in COUNTRY_MAP.items():
        if k.lower() == key.lower():
            return v
    return key


def _norm_customer(s):
    """客户名归一化：空白归一 + 大写（与 data/customer_country.json 的键一致）"""
    return re.sub(r'\s+', ' ', str(s or '')).strip().upper()


# 客户名 → 目的国（英文）：PO缺Destination字段时按客户推断
CUSTOMER_COUNTRY = {
    _norm_customer(k): v
    for k, v in _load_json('customer_country.json').get('map', {}).items()
}


def _country_from_customer(customer):
    """按客户名推断目的国（精确匹配 → 前缀匹配，如
    DOLGENCORP, LLC ↔ DOLGENCORP, LLC - POPSHELF），匹配不到返回''"""
    key = _norm_customer(customer)
    if not key:
        return ''
    if key in CUSTOMER_COUNTRY:
        return CUSTOMER_COUNTRY[key]
    best = ''
    for k in CUSTOMER_COUNTRY:
        if len(k) >= 8 and (key.startswith(k) or k.startswith(key)):
            if len(k) > len(best):
                best = k
    return CUSTOMER_COUNTRY.get(best, '') if best else ''


# 行级客户PO后缀 → 国家英文名（多国家PO分行用，如 AG260316-HK → 香港）
_CUST_PO_SUFFIX_COUNTRY = {
    'HK': 'Hong Kong', 'TW': 'Taiwan', 'AU': 'Australia', 'NZ': 'New Zealand',
    'UK': 'United Kingdom', 'US': 'USA', 'DE': 'Germany', 'FR': 'France',
    'ES': 'Spain', 'JP': 'Japan', 'CA': 'Canada', 'IT': 'Italy', 'CN': 'China',
}


def _country_for_line(customer_po, dest_parts):
    """多国家PO按行级客户PO后缀（-HK/-TW等）确定该行国家，匹配不到返回None"""
    if not customer_po:
        return None
    m = re.search(r'[-\s]([A-Za-z]{2})\s*$', str(customer_po).strip())
    if not m:
        return None
    en = _CUST_PO_SUFFIX_COUNTRY.get(m.group(1).upper())
    if not en:
        return None
    # 后缀国家必须在PO的目的国列表里，避免把无关后缀误判为国家
    if dest_parts and not any(
            en.lower() == re.sub(r'\s+', ' ', p).strip().lower() for p in dest_parts):
        return None
    return _translate_country(en)


def _date_serial(dt):
    """datetime → Excel序列号"""
    if not dt or not hasattr(dt, 'year'):
        return None
    return (dt - datetime(1899, 12, 30)).days


def _generate_excel(parsed_orders, custom_date=None):
    """用openpyxl生成接单表格式的新Excel

    Returns: {'ok': bool, 'filepath': str, 'filename': str, 'written': int,
              'warnings': [], 'details': [], 'revisions': []}
    """
    warnings = []
    details = []
    written = 0

    wb = openpyxl.Workbook()

    # === 排期sheet ===
    ws = wb.active
    ws.title = '排期'

    # 标题行（第1行）
    ws.merge_cells('A1:N1')
    title_cell = ws['A1']
    title_cell.value = '2026年ZURU接单金额表'
    title_cell.font = Font(name='宋体', size=18, bold=True)
    title_cell.alignment = Alignment(horizontal='center', vertical='center')
    ws.row_dimensions[1].height = 30

    # 表头（第2行）
    headers = ['接单日期', '合同', '简货号', '货号', '走货期', '数量',
               '单价USD', '金额USD', '金额HK', '发票号', '出货国家',
               '生产车间', '排期品名', '备注']
    header_fill = PatternFill(start_color='D9E2F3', end_color='D9E2F3', fill_type='solid')
    header_font = Font(name='宋体', size=11, bold=True)
    thin_border = Border(
        left=Side(style='thin'), right=Side(style='thin'),
        top=Side(style='thin'), bottom=Side(style='thin'))

    for ci, h in enumerate(headers, 1):
        cell = ws.cell(row=2, column=ci, value=h)
        cell.font = header_font
        cell.fill = header_fill
        cell.alignment = Alignment(horizontal='center', vertical='center')
        cell.border = thin_border

    # 列宽
    widths = [10, 14, 8, 16, 10, 10, 10, 12, 12, 10, 14, 10, 14, 20]
    for ci, w in enumerate(widths, 1):
        ws.column_dimensions[openpyxl.utils.get_column_letter(ci)].width = w

    # 数据行从第3行开始
    row_idx = 3
    data_font = Font(name='宋体', size=11)
    green_fill = PatternFill(start_color='C6EFCE', end_color='C6EFCE', fill_type='solid')
    date_fmt = 'm"月"d"日"'

    for order in parsed_orders:
        po = order['po_number']
        po_date_serial = _date_serial(custom_date or order['po_date'])
        # 目的国缺失（部分版式PO没有Destination字段）→ 按客户名推断；
        # 推断不出也要警告，不能无声留空
        destination = order['destination']
        if not destination:
            destination = _country_from_customer(order.get('customer', ''))
            if destination:
                warnings.append(
                    f'PO {po}: 目的国字段为空，已按客户"{order.get("customer", "")}"'
                    f'推断为{_translate_country(destination)}，请核对')
            else:
                warnings.append(
                    f'PO {po}: 未识别到目的国，出货国家已留空，请人工填写')
        # 多个国家（如 "Taiwan, Hong Kong"）：逐段翻译；行级再按客户PO后缀细分
        dest_parts = [p.strip() for p in destination.split(',') if p.strip()] \
            if destination else []
        multi_country = len(dest_parts) > 1
        if multi_country:
            country_cn = '、'.join(_translate_country(p) for p in dest_parts)
        else:
            country_cn = _translate_country(destination)
        multi_warned = False
        lines = order['lines']

        if not lines:
            warnings.append(f'PO {po}: 无数据行，跳过')
            continue

        if country_cn == destination and destination:
            warnings.append(f'PO {po}: 国家"{destination}"未找到中文翻译，原样写入')

        first_line = True
        skipped_items = []
        for ln in lines:
            simple_no = ln['simple_no']
            sku_full = ln['sku_spec'] or ln['sku'] or ''

            # 黑名单货号（河源等独立排期）→ 跳过
            if simple_no and simple_no in IGNORE_ITEMS:
                skipped_items.append(f'{simple_no}({sku_full})[黑名单]')
                continue

            # 货号不在映射表：纯数字→跳过，M开头→照写只警告
            if simple_no and simple_no not in ITEM_MAP:
                if simple_no[0].upper() != 'M':
                    skipped_items.append(f'{simple_no}({sku_full})')
                    continue

            # 单价=0且货号不含PRODUCT → 跳过
            if not ln['price'] and 'PRODUCT' not in sku_full.upper():
                continue

            r = row_idx

            # A 接单日期（首行写）
            if first_line and po_date_serial:
                ws.cell(r, 1, po_date_serial).number_format = date_fmt

            # B 合同（首行写）
            if first_line and po:
                ws.cell(r, 2, po)

            # C 简货号
            if simple_no:
                try:
                    ws.cell(r, 3, int(simple_no))
                except (ValueError, TypeError):
                    ws.cell(r, 3, simple_no)

            # D 货号：含SLB的卡板货号统一写 简货号+SLB；
            # STDPRODUCT 是套件子件拆分标记（如 9574-STDPRODUCT，实为
            # "9574-STD\nPRODUCT" 两段富文本），不是货号后缀，货号写本体；
            # 普通格式取第一个-前，但第二段是纯字母后缀（如 125160A-PLB-S007 的 PLB）需拼接保留
            raw_item = ln['sku_spec'] or ln['sku'] or ''
            if 'SLB' in raw_item and simple_no:
                ws.cell(r, 4, simple_no + 'SLB')
            else:
                _parts = raw_item.split('-')
                _suffix = _parts[1].upper() if len(_parts) > 1 else ''
                if _suffix.startswith('STDPRODUCT') or _suffix == 'PRODUCT':
                    ws.cell(r, 4, _parts[0])
                elif len(_parts) > 1 and _parts[1].isalpha():
                    ws.cell(r, 4, _parts[0] + _parts[1])
                else:
                    ws.cell(r, 4, _parts[0])

            # E 走货期
            delivery_serial = _date_serial(ln['delivery'])
            if delivery_serial:
                ws.cell(r, 5, delivery_serial).number_format = date_fmt

            # F 数量
            if ln['qty']:
                ws.cell(r, 6, ln['qty'])

            # G 单价USD（美国打六折）
            if ln['price']:
                ws.cell(r, 7, round(ln['price'], 4))

            # H 金额USD = F*G
            ws.cell(r, 8).value = f'=F{r}*G{r}'

            # I 金额HK = H*7.75
            ws.cell(r, 9).value = f'=H{r}*7.75'

            # K 出货国家（多国家PO优先按行级客户PO后缀细分到行，分不出则合并写入并警告）
            line_country = country_cn
            if multi_country:
                per_line = _country_for_line(ln.get('customer_po', ''), dest_parts)
                if per_line:
                    line_country = per_line
                elif not multi_warned:
                    warnings.append(
                        f'PO {po}: 多个国家"{order["destination"]}"未能按客户PO后缀区分到行，'
                        f'已合并写入（{country_cn}），请人工核对')
                    multi_warned = True
            if line_country:
                ws.cell(r, 11, line_country)

            # 全列引用 (A:C / A:D)：避免硬编码行数限制货号表增长
            ws.cell(r, 12).value = f'=VLOOKUP(C{r},货号!A:C,3,0)'
            ws.cell(r, 13).value = f'=VLOOKUP(C{r},货号!A:D,4,0)'

            # 统一格式：绿色填充标记新数据
            for c in range(1, 15):
                cell = ws.cell(r, c)
                cell.font = data_font
                cell.border = thin_border
                cell.fill = green_fill

            row_idx += 1
            written += 1
            first_line = False

        if skipped_items:
            warnings.append(
                f'PO {po}: 以下货号不在映射表，已跳过 → {", ".join(skipped_items)}')
        details.append(f'PO {po}: {len(lines)}行')

    # 冻结表头
    ws.freeze_panes = 'A3'

    # === 货号sheet（VLOOKUP依赖）===
    ws2 = wb.create_sheet('货号')
    ws2.cell(1, 1, '货号').font = Font(bold=True)
    ws2.cell(1, 2, '中文名称').font = Font(bold=True)
    ws2.cell(1, 3, '生产车间').font = Font(bold=True)
    ws2.cell(1, 4, '排期名').font = Font(bold=True)

    for ri, (k, v) in enumerate(ITEM_MAP.items(), 2):
        try:
            ws2.cell(ri, 1, int(k))
        except (ValueError, TypeError):
            ws2.cell(ri, 1, k)
        ws2.cell(ri, 2, v.get('cn_name', ''))
        ws2.cell(ri, 3, v.get('workshop', ''))
        ws2.cell(ri, 4, v.get('schedule_name', ''))

    ws2.column_dimensions['A'].width = 10
    ws2.column_dimensions['B'].width = 16
    ws2.column_dimensions['C'].width = 10
    ws2.column_dimensions['D'].width = 16

    # 保存
    ts = datetime.now().strftime('%Y%m%d_%H%M%S')
    filename = f'接单表数据_{ts}.xlsx'
    filepath = os.path.join(app.config['EXPORT_FOLDER'], filename)
    wb.save(filepath)
    wb.close()

    return {
        'ok': True, 'filepath': filepath, 'filename': filename,
        'written': written, 'warnings': warnings, 'details': details,
    }


# === Flask 路由 ===

@app.route('/health')
def health():
    """Docker/nginx健康检查端点"""
    return jsonify({'status': 'ok'})


@app.route('/')
def index():
    return render_template('index.html', local_mode=LOCAL_MODE)


@app.route('/api/config', methods=['GET', 'POST'])
def config_api():
    """获取/保存配置（接单表路径）— 仅 LOCAL_MODE 下允许设置任意路径"""
    if request.method == 'GET':
        cfg = _load_config()
        cfg['items'] = _item_map_meta()
        return jsonify(cfg)
    if not LOCAL_MODE:
        return jsonify({'ok': False, 'error': '仅本机模式可设置接单表路径，请用上传'}), 403
    data = request.get_json(force=True)
    cfg = _load_config()
    if 'order_table_path' in data:
        new_path = str(data['order_table_path'] or '').strip()
        # 即使本机模式也仅允许已存在的文件
        if new_path and not os.path.isfile(new_path):
            return jsonify({'ok': False, 'error': '路径不存在'}), 400
        cfg['order_table_path'] = new_path
    _save_config(cfg)
    return jsonify({'ok': True})


@app.route('/api/browse', methods=['POST'])
def browse():
    """浏览服务器目录 — 仅本机模式开启"""
    if not LOCAL_MODE:
        return jsonify({'ok': False, 'error': '云端部署不支持浏览服务器目录，请用上传'}), 403
    data = request.get_json(force=True)
    path = data.get('path', '').strip()
    if not path:
        path = os.path.join(os.path.expanduser('~'), 'Desktop')
    if not os.path.isdir(path):
        return jsonify({'ok': False, 'error': '目录不存在'}), 400
    items = _list_dir(path)
    drives = []
    if os.name == 'nt':
        import string
        for d in string.ascii_uppercase:
            dp = f'{d}:\\'
            if os.path.isdir(dp):
                drives.append(dp)
    return jsonify({
        'ok': True,
        'current': os.path.abspath(path),
        'parent': os.path.dirname(os.path.abspath(path)),
        'items': items,
        'drives': drives,
    })


@app.route('/api/check_path', methods=['POST'])
def check_path():
    """检查接单表路径 — 仅本机模式"""
    if not LOCAL_MODE:
        return jsonify({'ok': False, 'error': '云端部署请用上传'}), 403
    data = request.get_json(force=True)
    path = data.get('path', '').strip()
    if not path or not os.path.isfile(path):
        return jsonify({'ok': False, 'error': '文件不存在'}), 400
    pos = _read_existing_pos(path)
    return jsonify({'ok': True, 'count': len(pos)})


@app.route('/api/upload_table', methods=['POST'])
def upload_table():
    """上传接单表文件（云端默认入口）"""
    f = request.files.get('file')
    if not f or not f.filename:
        return jsonify({'ok': False, 'error': '未选择文件'}), 400
    ext = os.path.splitext(f.filename)[1].lower()
    if ext not in ('.xlsx', '.xls'):
        return jsonify({'ok': False, 'error': '仅支持Excel文件'}), 400
    save_path = os.path.join(app.config['DATA_FOLDER'], 'uploaded_order_table.xlsx')
    f.save(save_path)
    pos = _read_existing_pos(save_path)
    if not pos:
        return jsonify({'ok': False, 'error': '未能读取到PO数据，请确认是接单表文件'}), 400
    cfg = _load_config()
    cfg['order_table_path'] = save_path
    _save_config(cfg)
    return jsonify({'ok': True, 'count': len(pos), 'filename': f.filename})


@app.route('/api/update_items', methods=['POST'])
def update_items():
    """从接单表「货号」sheet 更新货号映射（只新增/变更，不删除）。

    两种来源：上传接单表文件（file 字段），或不带文件时用已设置的接单表路径。
    结果保存到 DATA_FOLDER/item_map.json（exe 旁可写目录），重启后仍生效。
    """
    f = request.files.get('file')
    tmp_path = None
    if f and f.filename:
        ext = os.path.splitext(f.filename)[1].lower()
        if ext not in ('.xlsx', '.xlsm'):
            return jsonify({'ok': False, 'error': '仅支持 .xlsx 格式接单表'}), 400
        tmp_path = os.path.join(app.config['UPLOAD_FOLDER'],
                                _safe_filename(f.filename))
        f.save(tmp_path)
        filepath = tmp_path
    else:
        cfg = _load_config()
        filepath = cfg.get('order_table_path', '')
        if not filepath or not os.path.isfile(filepath):
            return jsonify(
                {'ok': False, 'error': '请上传接单表文件，或先设置接单表路径'}), 400

    try:
        new_items, dupes = _read_items_from_table(filepath)
    except Exception as e:
        return jsonify({'ok': False,
                        'error': f'读取货号失败: {str(e)[:120]}'}), 400
    finally:
        if tmp_path:
            try:
                os.remove(tmp_path)
            except OSError:
                pass

    if not new_items:
        return jsonify({'ok': False,
                        'error': '「货号」表里没有读到货号数据'}), 400

    global ITEM_MAP
    with _item_map_lock:
        merged = dict(ITEM_MAP)
        added, changed = [], []
        for k, v in new_items.items():
            if k not in merged:
                merged[k] = v
                added.append(k)
            elif any(merged[k].get(fld, '') != v[fld]
                     for fld in ('cn_name', 'workshop', 'schedule_name')):
                merged[k] = v
                changed.append(k)
        save_to = os.path.join(app.config['DATA_FOLDER'], 'item_map.json')
        try:
            with open(save_to, 'w', encoding='utf-8') as fp:
                json.dump(merged, fp, ensure_ascii=False, indent=2)
        except OSError as e:
            return jsonify({'ok': False, 'error': f'保存失败: {e}'}), 500
        ITEM_MAP = merged

    logging.info(f'货号更新: 新增{len(added)} 变更{len(changed)} '
                 f'总数{len(merged)} 来源={filepath}')
    meta = _item_map_meta()
    return jsonify({'ok': True, 'added': sorted(added),
                    'changed': sorted(changed),
                    'dupes': sorted(set(dupes)), 'total': len(merged),
                    'builtin': meta['builtin'], 'updated': meta['updated']})


@app.route('/api/cancelled_pos', methods=['GET', 'POST'])
def cancelled_pos_api():
    """取消PO名单：GET 查看；POST {add:[...], remove:[...]} 维护。
    名单里的PO在上传时会被识别为取消单直接跳过。"""
    global CANCELLED_POS
    if request.method == 'GET':
        with _cancel_pos_lock:
            return jsonify({'ok': True, 'cancelled_pos': sorted(CANCELLED_POS)})
    data = request.get_json(force=True)
    add = [_norm_po(x) for x in data.get('add') or []]
    remove = [_norm_po(x) for x in data.get('remove') or []]
    add = [x for x in add if x]
    remove = [x for x in remove if x]
    if not add and not remove:
        return jsonify({'ok': False, 'error': '没有要添加/移除的PO号'}), 400
    with _cancel_pos_lock:
        CANCELLED_POS |= set(add)
        CANCELLED_POS -= set(remove)
        try:
            _save_cancelled_pos(CANCELLED_POS)
        except OSError as e:
            return jsonify({'ok': False, 'error': f'保存失败: {e}'}), 500
        logging.info(f'取消PO名单更新: +{add} -{remove} 现有{len(CANCELLED_POS)}个')
        return jsonify({'ok': True, 'cancelled_pos': sorted(CANCELLED_POS),
                        'added': add, 'removed': remove})


@app.route('/api/classify', methods=['POST'])
def classify():
    """根据接单表比对，分类上传的PO文件为新单/修改单"""
    cfg = _load_config()
    table_path = cfg.get('order_table_path', '')
    if not table_path or not os.path.isfile(table_path):
        return jsonify({'error': '未设置接单表路径或文件不存在'}), 400

    existing_pos = _read_existing_pos(table_path)

    saved = []
    for f in request.files.getlist('files'):
        if not f.filename:
            continue
        ext = os.path.splitext(f.filename)[1].lower()
        if ext not in ('.xlsx', '.xls'):
            continue
        safe_name = _safe_filename(f.filename)
        path = os.path.join(app.config['UPLOAD_FOLDER'], safe_name)
        f.save(path)
        saved.append((f.filename, path))

    results = []
    for fname, path in saved:
        try:
            # 取消单直接标记，不参与新单/修改单分类
            if po_parser.is_cancelled(path, filename=fname):
                results.append({
                    'filename': fname, 'po': '',
                    'is_revision': False, 'cancelled': True,
                    'missing_items': []
                })
                continue
            data = po_parser.parse(path)
            po = data['po_number']
            # 取消PO名单（用户手动维护）：名单里的PO按取消单处理
            with _cancel_pos_lock:
                in_cancel_list = _norm_po(po) in CANCELLED_POS
            if in_cancel_list:
                results.append({
                    'filename': fname, 'po': po,
                    'is_revision': False, 'cancelled': True,
                    'missing_items': []
                })
                continue
            is_rev = po in existing_pos
            missing = []
            for ln in data['lines']:
                sn = ln['simple_no']
                if sn and sn not in ITEM_MAP:
                    sku = ln['sku_spec'] or ln['sku'] or ''
                    missing.append(f'{sn}({sku})')
            results.append({
                'filename': fname, 'po': po,
                'is_revision': is_rev, 'cancelled': False,
                'missing_items': missing
            })
        except Exception:
            results.append({
                'filename': fname, 'po': '',
                'is_revision': po_parser.is_revision(fname),
                'cancelled': False,
                'missing_items': []
            })
    po_files = {}
    for r in results:
        if r['po']:
            po_files.setdefault(r['po'], []).append(r['filename'])
    duplicate_pos = {po: fnames for po, fnames in po_files.items() if len(fnames) > 1}

    for _, path in saved:
        try:
            os.remove(path)
        except OSError:
            pass

    return jsonify({'ok': True, 'results': results, 'existing_count': len(existing_pos),
                    'duplicate_pos': duplicate_pos})


@app.route('/api/process', methods=['POST'])
def process():
    """上传PO文件 → 解析 → 生成Excel（每请求一个 task_id）"""
    saved = []
    for f in request.files.getlist('files'):
        if not f.filename:
            continue
        ext = os.path.splitext(f.filename)[1].lower()
        if ext not in ('.xlsx', '.xls'):
            continue
        safe_name = _safe_filename(f.filename)
        path = os.path.join(app.config['UPLOAD_FOLDER'], safe_name)
        f.save(path)
        saved.append((f.filename, path))

    if not saved:
        return jsonify({'error': '没有有效的Excel文件'}), 400

    cfg = _load_config()
    table_path = cfg.get('order_table_path', '')
    existing_pos = set()
    if table_path and os.path.isfile(table_path):
        existing_pos = _read_existing_pos(table_path)

    task = _new_task()
    task['total'] = len(saved)
    task['msg'] = '开始解析...'

    new_orders = []
    rev_orders = []
    cancelled_orders = []
    parse_errors = []

    for i, (fname, path) in enumerate(saved):
        with _tasks_lock:
            task['current'] = i
            task['msg'] = f'解析 {fname}...'

        try:
            # 取消单（文件名含"取消"或内嵌"订单取消"覆盖章）直接跳过，不入单
            if po_parser.is_cancelled(path, filename=fname):
                cancelled_orders.append(fname)
                continue
            data = po_parser.parse(path)
            data['filename'] = fname
            po = data['po_number']

            # 取消PO名单（用户手动维护）：名单里的PO直接跳过
            with _cancel_pos_lock:
                in_cancel_list = _norm_po(po) in CANCELLED_POS
            if in_cancel_list:
                cancelled_orders.append(fname)
                continue

            if existing_pos:
                is_rev = po in existing_pos
            else:
                is_rev = po_parser.is_revision(fname)

            if is_rev:
                rev_orders.append(fname)
            else:
                new_orders.append(data)
        except Exception as e:
            parse_errors.append(f'{fname}: {str(e)[:100]}')

    with _tasks_lock:
        task['msg'] = '正在生成Excel...'
        task['current'] = task['total']

    result = {'ok': True, 'written': 0, 'warnings': [], 'details': [],
              'filename': '', 'revisions': rev_orders, 'parse_errors': parse_errors,
              'cancelled': cancelled_orders,
              'task_id': task['id']}

    custom_date_str = request.form.get('order_date', '')
    custom_date = None
    if custom_date_str:
        try:
            custom_date = datetime.strptime(custom_date_str, '%Y-%m-%d')
        except ValueError:
            pass

    if new_orders:
        gen = _generate_excel(new_orders, custom_date=custom_date)
        result['ok'] = gen['ok']
        result['written'] = gen['written']
        result['warnings'] = gen['warnings']
        result['details'] = gen['details']
        result['filename'] = gen.get('filename', '')

    # 取消单提示排在警告最前，确保用户能看到
    if cancelled_orders:
        cancel_warns = [f'{n}: 识别为取消单（取消标记/取消名单），已跳过未入单'
                        for n in cancelled_orders]
        result['warnings'] = cancel_warns + result['warnings']

    with _tasks_lock:
        task['done'] = True
        task['result'] = result
        task['msg'] = '完成'

    for _, path in saved:
        try:
            os.remove(path)
        except OSError:
            pass

    return jsonify(result)


@app.route('/api/progress')
def progress():
    """SSE进度推送 — 必须带 task_id，避免 thread leak"""
    task_id = request.args.get('task_id', '').strip()

    def gen():
        if not task_id:
            yield 'data: {"error":"missing task_id","done":true}\n\n'
            return
        last_msg = ''
        deadline = time.time() + 600  # 最长 10 分钟
        while time.time() < deadline:
            t = _get_task(task_id)
            if not t:
                yield 'data: {"error":"task not found","done":true}\n\n'
                return
            with _tasks_lock:
                snapshot = {
                    'current': t['current'],
                    'total': t['total'],
                    'msg': t['msg'],
                    'done': t['done'],
                }
            msg = json.dumps(snapshot, ensure_ascii=False)
            if msg != last_msg:
                yield f'data: {msg}\n\n'
                last_msg = msg
            if snapshot['done']:
                return
            time.sleep(0.3)
        yield 'data: {"error":"timeout","done":true}\n\n'

    return Response(stream_with_context(gen()), mimetype='text/event-stream')


@app.route('/api/download/<filename>')
def download(filename):
    """下载生成的Excel"""
    # 拒绝任何包含路径分隔符或 .. 的文件名
    if '/' in filename or '\\' in filename or '..' in filename:
        return jsonify({'error': '非法文件名'}), 403
    filepath = os.path.join(app.config['EXPORT_FOLDER'], filename)
    abs_export = os.path.abspath(app.config['EXPORT_FOLDER'])
    if not os.path.abspath(filepath).startswith(abs_export + os.sep):
        return jsonify({'error': '非法路径'}), 403
    if not os.path.exists(filepath):
        return jsonify({'error': '文件不存在'}), 404
    return send_file(filepath, as_attachment=True, download_name=filename)


def _open_browser(url):
    """优先用谷歌浏览器打开（Windows 上按注册表/安装路径找 Chrome），
    找不到再用系统默认浏览器"""
    import webbrowser
    if os.name == 'nt':
        try:
            webbrowser.get('chrome').open(url)
            return
        except Exception:
            pass
        for env in ('PROGRAMFILES', 'PROGRAMFILES(X86)', 'LOCALAPPDATA'):
            base = os.environ.get(env)
            if not base:
                continue
            exe = os.path.join(base, 'Google', 'Chrome', 'Application', 'chrome.exe')
            if os.path.isfile(exe):
                try:
                    webbrowser.register('chrome_path', None,
                                        webbrowser.BackgroundBrowser(exe))
                    webbrowser.get('chrome_path').open(url)
                    return
                except Exception:
                    pass
    webbrowser.open(url)


if __name__ == '__main__':
    # Windows 控制台默认编码可能是 cp437/cp936，打印中文前先改为 utf-8 防崩溃
    try:
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
        sys.stderr.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass
    port = 5005
    print('=' * 50)
    print('  ZURU 接单表入单系统')
    print(f'  http://localhost:{port}')
    print('=' * 50)
    if getattr(sys, 'frozen', False):
        # 打包成 exe 运行时自动打开浏览器（优先谷歌）
        threading.Timer(1.5, lambda: _open_browser(f'http://127.0.0.1:{port}')).start()
    app.run(host='0.0.0.0', port=port, debug=FLASK_DEBUG, use_reloader=False, threaded=True)
