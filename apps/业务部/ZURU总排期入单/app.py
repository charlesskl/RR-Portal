# -*- coding: utf-8 -*-
"""ZURU 总排期入单系统 — 云端分析版
功能：解析PO Excel + 与总排期匹配 → 输出修改单明细 + 生成新单Excel
不依赖Z盘路径/WPS COM，纯Linux可跑
"""
import os, sys, json, logging, re, shutil, struct, zipfile, uuid, threading
from contextlib import contextmanager
from datetime import datetime
from collections import defaultdict
from flask import Flask, render_template, request, jsonify, send_file
from werkzeug.utils import secure_filename
from werkzeug.middleware.proxy_fix import ProxyFix
from excel_po_parser import ExcelPOParser
from master_schedule import write_orders, lookup_schedule_info
from generate_yellow_summary import generate_summary, generate_summary_excel
from schedule_reconcile import reconcile_schedules, CACHE_FILE

APP_DIR = os.path.dirname(os.path.abspath(__file__))
app = Flask(__name__, template_folder=os.path.join(APP_DIR, 'templates'))
app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1, x_prefix=1)
app.config['UPLOAD_FOLDER'] = os.path.join(APP_DIR, 'uploads')
app.config['MASTER_FOLDER'] = os.path.join(APP_DIR, 'uploads', 'master')
app.config['EXPORT_FOLDER'] = os.path.join(APP_DIR, 'exports')
app.config['RECONCILE_FOLDER'] = os.path.join(APP_DIR, 'uploads', 'reconcile_schedules')
app.config['MAX_CONTENT_LENGTH'] = 512 * 1024 * 1024
for d in [app.config['UPLOAD_FOLDER'], app.config['MASTER_FOLDER'], app.config['EXPORT_FOLDER']]:
    os.makedirs(d, exist_ok=True)

LOG_FILE = os.path.join(APP_DIR, 'data', 'ops.log')
os.makedirs(os.path.dirname(LOG_FILE), exist_ok=True)
logging.basicConfig(filename=LOG_FILE, level=logging.INFO,
                    format='%(asctime)s %(message)s', encoding='utf-8')

# 上传的总排期副本路径（持久化到磁盘，多 worker 共享）
_MASTER_STATE_FILE = os.path.join(APP_DIR, 'data', 'master_state.json')
MAX_XLSX_ENTRIES = 20000
MAX_XLSX_COMPRESSED_BYTES = 64 * 1024 * 1024
MAX_XLSX_UNCOMPRESSED_BYTES = 128 * 1024 * 1024
MAX_XLSX_COMPRESSION_RATIO = 500
MAX_OUTER_ZIP_FILES = 200
MAX_OUTER_ZIP_COMPRESSED_BYTES = 128 * 1024 * 1024
MAX_OUTER_ZIP_UNCOMPRESSED_BYTES = 256 * 1024 * 1024
MAX_ZIP_CENTRAL_DIRECTORY_BYTES = 16 * 1024 * 1024
_RECONCILE_THREAD_LOCK = threading.Lock()


def _atomic_write_json(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp_path = f'{path}.{uuid.uuid4().hex}.tmp'
    try:
        with open(tmp_path, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp_path, path)
    finally:
        try:
            if os.path.exists(tmp_path):
                os.remove(tmp_path)
        except OSError:
            pass


@contextmanager
def _reconcile_guard():
    """Serialize directory swaps and scans across Gunicorn workers on Linux."""
    lock_path = os.path.join(APP_DIR, 'data', 'reconcile.lock')
    os.makedirs(os.path.dirname(lock_path), exist_ok=True)
    with _RECONCILE_THREAD_LOCK:
        with open(lock_path, 'a+b') as lock_file:
            try:
                import fcntl
                fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX)
            except ImportError:
                fcntl = None
            try:
                yield
            finally:
                if fcntl is not None:
                    fcntl.flock(lock_file.fileno(), fcntl.LOCK_UN)


def _preflight_zip(path, max_entries, max_compressed_bytes, label):
    """Read only the ZIP footer so oversized central directories are rejected early."""
    size = os.path.getsize(path)
    if size > max_compressed_bytes:
        raise ValueError(f'{label}压缩文件过大')
    with open(path, 'rb') as f:
        tail_start = max(0, size - (65535 + 22))
        f.seek(tail_start)
        tail = f.read()
    signature = b'PK\x05\x06'
    eocd = -1
    search_end = len(tail)
    while search_end > 0:
        candidate = tail.rfind(signature, 0, search_end)
        if candidate < 0:
            break
        if candidate + 22 <= len(tail):
            comment_length = struct.unpack_from('<H', tail, candidate + 20)[0]
            if candidate + 22 + comment_length == len(tail):
                eocd = candidate
                break
        search_end = candidate
    if eocd < 0:
        raise ValueError(f'{label}缺少有效的 ZIP 目录')
    disk_number, directory_disk = struct.unpack_from('<HH', tail, eocd + 4)
    disk_entries, total_entries = struct.unpack_from('<HH', tail, eocd + 8)
    if disk_number != 0 or directory_disk != 0 or disk_entries != total_entries:
        raise ValueError(f'{label}不支持分卷 ZIP')
    if total_entries == 0xFFFF:
        raise ValueError(f'{label}内部文件数量异常')
    if total_entries > max_entries:
        raise ValueError(f'{label}内部文件超过 {max_entries} 个')
    directory_size, directory_offset = struct.unpack_from('<II', tail, eocd + 12)
    if directory_size == 0xFFFFFFFF or directory_offset == 0xFFFFFFFF:
        raise ValueError(f'{label}不支持 ZIP64 目录')
    if directory_size > MAX_ZIP_CENTRAL_DIRECTORY_BYTES:
        raise ValueError(f'{label}中央目录超过 16MB')
    eocd_offset = tail_start + eocd
    if directory_offset + directory_size != eocd_offset:
        raise ValueError(f'{label}中央目录边界不正确')

    actual_entries = 0
    consumed = 0
    with open(path, 'rb') as f:
        f.seek(directory_offset)
        while consumed < directory_size:
            header = f.read(46)
            if len(header) != 46 or header[:4] != b'PK\x01\x02':
                raise ValueError(f'{label}中央目录结构不正确')
            name_length, extra_length, comment_length = struct.unpack_from('<HHH', header, 28)
            variable_size = name_length + extra_length + comment_length
            record_size = 46 + variable_size
            if consumed + record_size > directory_size:
                raise ValueError(f'{label}中央目录边界不正确')
            actual_entries += 1
            if actual_entries > max_entries:
                raise ValueError(f'{label}内部文件超过 {max_entries} 个')
            f.seek(variable_size, os.SEEK_CUR)
            consumed += record_size
    if consumed != directory_size or actual_entries != total_entries:
        raise ValueError(f'{label}中央目录条目数不一致')


def _validate_xlsx(path):
    """Validate OOXML structure and bound nested ZIP expansion before openpyxl."""
    _preflight_zip(path, MAX_XLSX_ENTRIES, MAX_XLSX_COMPRESSED_BYTES, '工作簿')
    if not zipfile.is_zipfile(path):
        raise ValueError('文件不是有效的 .xlsx 工作簿')
    try:
        with zipfile.ZipFile(path) as zf:
            entries = [info for info in zf.infolist() if not info.is_dir()]
            names = {info.filename.replace('\\', '/') for info in entries}
            if '[Content_Types].xml' not in names or 'xl/workbook.xml' not in names:
                raise ValueError('文件缺少 Excel 工作簿结构')
            if len(entries) > MAX_XLSX_ENTRIES:
                raise ValueError(f'工作簿内部文件超过 {MAX_XLSX_ENTRIES} 个')
            total_size = sum(info.file_size for info in entries)
            if total_size > MAX_XLSX_UNCOMPRESSED_BYTES:
                raise ValueError('工作簿解压后超过 128MB')
            for info in entries:
                if info.file_size <= 0:
                    continue
                if info.compress_size <= 0 or info.file_size / info.compress_size > MAX_XLSX_COMPRESSION_RATIO:
                    raise ValueError('工作簿压缩比异常，已拒绝处理')

        import openpyxl
        wb = openpyxl.load_workbook(path, read_only=True, data_only=False, keep_links=False)
        try:
            if not wb.sheetnames:
                raise ValueError('工作簿没有可读取的工作表')
        finally:
            wb.close()
    except ValueError:
        raise
    except Exception as e:
        raise ValueError(f'文件不是可读取的 .xlsx 工作簿: {e}') from e


def _get_master_path():
    """从磁盘读取最新的总排期文件路径，确保 gunicorn 多 worker 一致"""
    try:
        if os.path.exists(_MASTER_STATE_FILE):
            with open(_MASTER_STATE_FILE, 'r', encoding='utf-8') as f:
                return (json.load(f) or {}).get('path', '')
    except (json.JSONDecodeError, OSError):
        pass
    return ''


def _set_master_path(path):
    try:
        _atomic_write_json(_MASTER_STATE_FILE, {'path': path})
    except OSError as e:
        logging.error(f'[总排期] 状态写入失败: {e}')


def _is_inside_dir(path, directory):
    try:
        return os.path.commonpath([os.path.abspath(path), os.path.abspath(directory)]) == os.path.abspath(directory)
    except ValueError:
        return False


def _safe_upload_name(filename, fallback='schedule.xlsx'):
    name = os.path.basename(str(filename or '').replace('\\', '/')).strip()
    name = re.sub(r'[<>:"/\\|?*\x00-\x1f]+', '_', name).strip(' ._')
    if not name:
        name = fallback
    base, ext = os.path.splitext(name)
    if not base:
        base = os.path.splitext(fallback)[0] or 'schedule'
    return (base[:150] + ext[:20]) if len(name) > 170 else name


def _unique_upload_path(directory, filename):
    os.makedirs(directory, exist_ok=True)
    safe_name = _safe_upload_name(filename)
    base, ext = os.path.splitext(safe_name)
    candidate = os.path.join(directory, safe_name)
    idx = 2
    while os.path.exists(candidate):
        candidate = os.path.join(directory, f'{base}_{idx}{ext}')
        idx += 1
    if not _is_inside_dir(candidate, directory):
        raise ValueError('非法文件名')
    return candidate


def _clear_reconcile_cache():
    try:
        if os.path.exists(CACHE_FILE):
            os.remove(CACHE_FILE)
    except OSError:
        pass


def _clear_uploaded_reconcile_files():
    directory = app.config['RECONCILE_FOLDER']
    os.makedirs(directory, exist_ok=True)
    if not _is_inside_dir(directory, app.config['UPLOAD_FOLDER']):
        raise RuntimeError('分排期上传目录异常，已停止清理')
    for name in os.listdir(directory):
        path = os.path.join(directory, name)
        if not _is_inside_dir(path, directory):
            continue
        if os.path.isdir(path):
            shutil.rmtree(path)
        else:
            os.remove(path)
    _clear_reconcile_cache()


def _activate_reconcile_staging(staging_dir):
    final_dir = app.config['RECONCILE_FOLDER']
    backup_dir = f'{final_dir}.backup.{uuid.uuid4().hex}'
    os.makedirs(os.path.dirname(final_dir), exist_ok=True)
    had_final = os.path.exists(final_dir)
    if had_final:
        os.replace(final_dir, backup_dir)
    try:
        os.replace(staging_dir, final_dir)
    except Exception:
        if had_final and os.path.exists(backup_dir) and not os.path.exists(final_dir):
            os.replace(backup_dir, final_dir)
        raise
    if os.path.exists(backup_dir):
        shutil.rmtree(backup_dir, ignore_errors=True)
    _clear_reconcile_cache()


def _list_uploaded_reconcile_files():
    directory = app.config['RECONCILE_FOLDER']
    if not os.path.isdir(directory):
        return []
    return [
        os.path.join(directory, name)
        for name in sorted(os.listdir(directory))
        if name.lower().endswith('.xlsx') and not name.startswith('~$')
    ]


def _extract_zip_schedules(storage, directory):
    os.makedirs(directory, exist_ok=True)
    saved = []
    tmp_path = os.path.join(directory, f'_upload_{uuid.uuid4().hex}.zip')
    storage.save(tmp_path)
    try:
        _preflight_zip(tmp_path, MAX_OUTER_ZIP_FILES, MAX_OUTER_ZIP_COMPRESSED_BYTES, '压缩包')
        with zipfile.ZipFile(tmp_path) as zf:
            entries = [info for info in zf.infolist()
                       if not info.is_dir() and info.filename.lower().endswith('.xlsx')]
            if len(entries) > MAX_OUTER_ZIP_FILES:
                raise ValueError(f'压缩包内分排期文件超过 {MAX_OUTER_ZIP_FILES} 个')
            if sum(info.file_size for info in entries) > MAX_OUTER_ZIP_UNCOMPRESSED_BYTES:
                raise ValueError('压缩包解压后超过 256MB')
            for info in entries:
                inner_name = os.path.basename(info.filename.replace('\\', '/'))
                if not inner_name or inner_name.startswith(('~$', '.')):
                    continue
                target = _unique_upload_path(directory, inner_name)
                with zf.open(info) as src, open(target, 'wb') as dst:
                    shutil.copyfileobj(src, dst)
                try:
                    _validate_xlsx(target)
                except ValueError as e:
                    os.remove(target)
                    raise ValueError(f'{inner_name}: {e}') from e
                saved.append(os.path.basename(target))
    finally:
        try:
            os.remove(tmp_path)
        except OSError:
            pass
    if not saved:
        raise ValueError('压缩包里没有 .xlsx 分排期文件')
    return saved


def _save_reconcile_upload(storage, directory):
    filename = storage.filename or ''
    ext = os.path.splitext(filename)[1].lower()
    if ext == '.xlsx':
        safe_name = _safe_upload_name(filename, f'schedule_{uuid.uuid4().hex[:8]}.xlsx')
        if safe_name.startswith('~$'):
            raise ValueError('临时文件不需要上传')
        target = _unique_upload_path(directory, safe_name)
        storage.save(target)
        try:
            _validate_xlsx(target)
        except ValueError:
            os.remove(target)
            raise
        return [os.path.basename(target)]
    if ext == '.zip':
        return _extract_zip_schedules(storage, directory)
    raise ValueError('仅支持 .xlsx 或 .zip')


@app.route('/')
def index():
    return render_template('master.html')


@app.route('/health')
def health():
    return jsonify({'status': 'ok', 'service': 'zuru-master-schedule'})


# ── 总排期文件上传 ──

@app.route('/api/master-schedule-upload-master', methods=['POST'])
def upload_master():
    """上传总排期xlsx副本，用于后续分析和汇总"""
    f = request.files.get('master_file')
    if not f or not f.filename:
        return jsonify({'error': '请选择总排期xlsx文件'}), 400
    ext = os.path.splitext(f.filename)[1].lower()
    if ext != '.xlsx':
        return jsonify({'error': '只支持 .xlsx 文件'}), 400
    # secure_filename 防路径穿越；为空时退回固定名
    safe_name = secure_filename(f.filename) or f'master{ext}'
    path = os.path.join(app.config['MASTER_FOLDER'], safe_name)
    tmp_path = f'{path}.{uuid.uuid4().hex}.tmp'
    try:
        f.save(tmp_path)
        if ext == '.xlsx':
            _validate_xlsx(tmp_path)
        os.replace(tmp_path, path)
    except ValueError as e:
        try:
            if os.path.exists(tmp_path):
                os.remove(tmp_path)
        except OSError:
            pass
        return jsonify({'error': f'文件校验失败: {e}'}), 400
    except Exception as e:
        try:
            if os.path.exists(tmp_path):
                os.remove(tmp_path)
        except OSError:
            pass
        return jsonify({'error': f'保存失败: {e}'}), 500
    _set_master_path(path)
    logging.info(f'[总排期] 上传副本: {safe_name}')
    return jsonify({'ok': True, 'path': path, 'filename': safe_name,
                    'msg': f'已上传总排期: {safe_name}'})


@app.route('/api/master-schedule-info')
def master_schedule_info():
    """总排期文件状态"""
    mp = _get_master_path()
    return jsonify({
        'exists': bool(mp) and os.path.exists(mp),
        'locked': False,
        'path': mp or '(未上传总排期文件)',
    })


@app.route('/api/master-schedule-upload-file', methods=['POST'])
def master_schedule_upload_file():
    """当前工作台使用的总排期上传接口。"""
    f = request.files.get('file')
    if not f or not f.filename:
        return jsonify({'error': '未选择文件'}), 400
    if not f.filename.lower().endswith('.xlsx'):
        return jsonify({'error': '请选择 .xlsx 格式的总排期文件'}), 400

    save_path = os.path.join(app.config['MASTER_FOLDER'], 'uploaded_master.xlsx')
    tmp_path = save_path + f'.{uuid.uuid4().hex}.tmp'
    try:
        os.makedirs(app.config['MASTER_FOLDER'], exist_ok=True)
        f.save(tmp_path)
        _validate_xlsx(tmp_path)
        os.replace(tmp_path, save_path)
        _set_master_path(save_path)
    except ValueError as e:
        try:
            if os.path.exists(tmp_path):
                os.remove(tmp_path)
        except OSError:
            pass
        return jsonify({'error': f'文件校验失败: {e}'}), 400
    except Exception as e:
        try:
            if os.path.exists(tmp_path):
                os.remove(tmp_path)
        except OSError:
            pass
        return jsonify({'error': f'保存失败: {e}'}), 500
    logging.info(f'[总排期] 工作台上传副本: {_safe_upload_name(f.filename)}')
    return jsonify({
        'ok': True,
        'path': save_path,
        'msg': f'已上传并切换到总排期文件: {f.filename}',
    })


@app.route('/api/master-schedule-download')
def master_schedule_download():
    """下载当前总排期文件（上传的副本）"""
    mp = _get_master_path()
    if not mp or not os.path.exists(mp):
        return jsonify({'error': '总排期文件不存在，请先上传'}), 404
    return send_file(mp, as_attachment=True, download_name=os.path.basename(mp))


@app.route('/api/master-schedule-set-path', methods=['POST'])
def master_schedule_set_path():
    """切换当前总排期路径（必须在 MASTER_FOLDER 内，防路径穿越）"""
    new_path = (request.json or {}).get('path', '').strip()
    if not new_path:
        _set_master_path('')
        return jsonify({'ok': True, 'path': '(未上传总排期文件)', 'msg': '已清除，请重新上传总排期'})
    # 防路径穿越：必须在 MASTER_FOLDER 内
    master_folder = os.path.abspath(app.config['MASTER_FOLDER'])
    abs_path = os.path.abspath(new_path)
    if not abs_path.startswith(master_folder + os.sep) and abs_path != master_folder:
        return jsonify({'error': '路径非法，必须在上传目录下'}), 403
    if not os.path.exists(abs_path):
        return jsonify({'error': f'路径不存在: {new_path}'}), 400
    _set_master_path(abs_path)
    return jsonify({'ok': True, 'path': abs_path, 'msg': f'已切换到: {os.path.basename(abs_path)}'})


# ── 黑名单 ──

_ignore_cache = {'mtime': 0, 'items': set()}


def _load_ignore_items():
    p = os.path.join(APP_DIR, 'data', 'ignore_items.json')
    if not os.path.exists(p):
        return set()
    try:
        mtime = os.path.getmtime(p)
        if _ignore_cache['mtime'] == mtime:
            return _ignore_cache['items']
        with open(p, 'r', encoding='utf-8') as f:
            data = json.load(f)
        items = set(str(x).strip().upper() for x in (data.get('ignore_items') or []) if x)
        _ignore_cache['mtime'] = mtime
        _ignore_cache['items'] = items
        return items
    except Exception as e:
        logging.warning(f'[黑名单] 加载失败: {e}')
        return set()


def _filter_ignored(orders):
    ignore_set = _load_ignore_items()
    if not ignore_set:
        return orders, []
    report = []
    new_orders = []
    for od in orders:
        kept_lines = []
        ignored_count = {}
        for ln in od.get('lines', []):
            sku = ln.get('sku_spec') or ln.get('sku', '')
            num_m = re.match(r'^(\d+)', str(sku).strip())
            prefix = num_m.group(1).upper() if num_m else ''
            if prefix and prefix in ignore_set:
                ignored_count[prefix] = ignored_count.get(prefix, 0) + 1
                continue
            kept_lines.append(ln)
        for item, cnt in ignored_count.items():
            report.append({'item': item, 'count': cnt, 'source': od.get('filename', '')})
            logging.info(f'[黑名单忽略] {od.get("filename","")}: 货号{item} x {cnt}行')
        if kept_lines:
            od['lines'] = kept_lines
            new_orders.append(od)
    return new_orders, report


# ── 去重 ──

@app.route('/api/ignore-items', methods=['GET'])
def get_ignore_items():
    p = os.path.join(APP_DIR, 'data', 'ignore_items.json')
    try:
        with open(p, 'r', encoding='utf-8') as f:
            data = json.load(f)
        return jsonify({'items': data.get('ignore_items', [])})
    except Exception as e:
        return jsonify({'items': [], 'error': str(e)})


@app.route('/api/ignore-items', methods=['POST'])
def update_ignore_items():
    if not request.is_json:
        return jsonify({'error': '请求必须使用 application/json'}), 415
    payload = request.get_json(silent=True) or {}
    items = payload.get('items', [])
    cleaned = sorted(
        set(str(x).strip() for x in items if str(x).strip()),
        key=lambda x: (0, int(x)) if x.isdigit() else (1, x),
    )
    p = os.path.join(APP_DIR, 'data', 'ignore_items.json')
    try:
        with open(p, 'r', encoding='utf-8') as f:
            data = json.load(f)
    except Exception:
        data = {}
    data['ignore_items'] = cleaned
    _atomic_write_json(p, data)
    _ignore_cache['mtime'] = 0
    _ignore_cache['items'] = set()
    return jsonify({'ok': True, 'items': cleaned, 'count': len(cleaned)})


@app.route('/api/dual-map', methods=['GET'])
def get_dual_map():
    p = os.path.join(APP_DIR, 'data', 'dual_schedule_map.json')
    try:
        with open(p, 'r', encoding='utf-8') as f:
            data = json.load(f)
        return jsonify({'items': {k: v for k, v in data.items() if not k.startswith('_')}})
    except Exception as e:
        return jsonify({'items': {}, 'error': str(e)})


@app.route('/api/dual-map', methods=['POST'])
def update_dual_map():
    if not request.is_json:
        return jsonify({'error': '请求必须使用 application/json'}), 415
    payload = request.get_json(silent=True) or {}
    items = payload.get('items', {})
    if not isinstance(items, dict):
        return jsonify({'error': '双排期映射格式不正确'}), 400
    if len(items) > 1000:
        return jsonify({'error': '双排期映射不能超过 1000 条'}), 400
    allowed_modes = {'append', 'slt_insert', 'mid_insert', 's_insert', 'none'}
    cleaned = {}
    for raw_key, raw_value in items.items():
        key = str(raw_key).strip()
        if not key.isdigit() or len(key) > 20:
            return jsonify({'error': f'货号前缀必须是纯数字: {key[:40]}'}), 400
        if not isinstance(raw_value, dict):
            return jsonify({'error': f'{key} 的映射格式不正确'}), 400
        targets = raw_value.get('targets')
        mode = str(raw_value.get('mode', '')).strip()
        if not isinstance(targets, list) or not targets or len(targets) > 20:
            return jsonify({'error': f'{key} 的目标系列必须为 1-20 个'}), 400
        target_values = [str(value).strip() for value in targets]
        if any(not value.isdigit() or len(value) > 20 for value in target_values):
            return jsonify({'error': f'{key} 的目标系列必须是纯数字'}), 400
        if mode not in allowed_modes:
            return jsonify({'error': f'{key} 的插入模式不正确'}), 400
        cleaned[key] = {'targets': target_values, 'mode': mode}
    p = os.path.join(APP_DIR, 'data', 'dual_schedule_map.json')
    try:
        with open(p, 'r', encoding='utf-8') as f:
            data = json.load(f)
    except Exception:
        data = {}
    merged = {k: v for k, v in data.items() if k.startswith('_')}
    merged.update(cleaned)
    _atomic_write_json(p, merged)
    return jsonify({'ok': True, 'count': len(cleaned)})


def _extract_revision(filename):
    name = os.path.splitext(filename)[0]
    name = re.sub(r'\(\d+\)\s*$', '', name).strip()
    patterns = [r'[Rr]ev\.?\s*(\d+)', r'[Rr]\.?\s*(\d+)', r'[Vv]\.?\s*(\d+)']
    best = 0
    for pat in patterns:
        for m in re.finditer(pat, name):
            v = int(m.group(1))
            if v > best:
                best = v
    return best


def _dedup_orders(orders):
    by_po = defaultdict(list)
    deduped = []
    for od in orders:
        header = od.get('header') or od
        po = str(header.get('po_number', '') or od.get('po_number', '')).strip()
        if po.endswith('.0'):
            po = po[:-2]
        fname = od.get('filename', '')
        rev = _extract_revision(fname)
        if not po:
            deduped.append(od)
            continue
        by_po[po].append((rev, fname, od))
    report = []
    for po, entries in by_po.items():
        if len(entries) <= 1:
            deduped.append(entries[0][2])
            continue
        entries.sort(key=lambda x: (x[0], x[1]), reverse=True)
        keep_rev, keep_fname, keep_od = entries[0]
        deduped.append(keep_od)
        removed_names = [e[1] for e in entries[1:]]
        report.append(f'PO {po}: 保留 {keep_fname}，去掉 {", ".join(removed_names)}')
    return deduped, report


# ── 核心：分析PO ──

@app.route('/api/master-schedule-upload', methods=['POST'])
def master_schedule_upload():
    """上传PO文件，分析并生成新单Excel"""
    master_path = _get_master_path()
    if not master_path or not os.path.exists(master_path):
        return jsonify({'error': '请先上传总排期文件（点击上方"上传总排期"按钮）'}), 400

    saved = []
    for f in request.files.getlist('files'):
        if not f.filename:
            continue
        ext = os.path.splitext(f.filename)[1].lower()
        if ext not in ('.xlsx', '.xls'):
            continue
        safe_name = secure_filename(f.filename) or f'po_{datetime.now().strftime("%H%M%S%f")}{ext}'
        path = os.path.join(app.config['UPLOAD_FOLDER'], safe_name)
        f.save(path)
        saved.append((safe_name, path))

    if not saved:
        return jsonify({'error': '没有有效的Excel文件'}), 400

    orders = []
    errors = []
    for fname, path in saved:
        try:
            data = ExcelPOParser().parse(path)
            data['filename'] = fname
            orders.append(data)
        except Exception as e:
            errors.append(f'{fname}: {str(e)[:80]}')

    if not orders:
        return jsonify({'error': f'所有文件解析失败: {"; ".join(errors)}'}), 400

    orders, dedup_report = _dedup_orders(orders)
    orders, ignored_report = _filter_ignored(orders)
    if not orders:
        return jsonify({
            'ok': True, 'msg': '所有PO行都在黑名单中，已全部忽略',
            'dedup_report': dedup_report, 'ignored_report': ignored_report,
            'modified': 0, 'new_count': 0,
            'mod_details': [], 'new_details': [],
            'errors': errors, 'warnings': [],
        })

    # 数据异常检测：PDF转Excel可能丢数据，qty/outer=0 的行提示用户核对原始PO
    data_warnings = []
    for od in orders:
        fname = od.get('filename', '')
        for ln in od.get('lines', []):
            sku = ln.get('sku_spec') or ln.get('sku', '')
            qty = ln.get('qty', 0) or 0
            outer = ln.get('outer_qty', 0) or 0
            if qty <= 0:
                data_warnings.append(f'{fname}: {sku} 数量=0，可能是PDF转Excel时数据丢失，请核对原始PO')
            elif outer <= 0:
                data_warnings.append(f'{fname}: {sku} 外箱装箱数=0，可能是PDF转Excel时数据丢失，请核对原始PO')

    export_dir = app.config['EXPORT_FOLDER']
    try:
        result = write_orders(master_path, orders, export_dir=export_dir)
        if not result['ok']:
            return jsonify({'error': result['msg']}), 500
        resp = {
            'ok': True, 'msg': result['msg'],
            'modified': result.get('modified', 0),
            'new_count': result.get('new_count', 0),
            'mod_details': result.get('mod_details', []),
            'new_details': result.get('new_details', []),
            'errors': errors,
            'warnings': result.get('warnings', []),
            'dedup_report': dedup_report,
            'ignored_report': ignored_report,
        }
        if data_warnings:
            resp['data_warnings'] = data_warnings
        if result.get('export_file'):
            resp['export_file'] = result['export_file']
        try:
            all_items = []
            for o in orders:
                for ln in o.get('lines', []):
                    s = ln.get('sku_spec', '') or ln.get('sku', '')
                    if s: all_items.append(s)
            if all_items:
                resp['schedule_info'] = lookup_schedule_info(all_items)
        except Exception:
            pass
        return jsonify(resp)
    except Exception as e:
        return jsonify({'error': f'处理失败: {e}'}), 500


@app.route('/api/master-export-download/<filename>')
def master_export_download(filename):
    export_dir = app.config['EXPORT_FOLDER']
    filepath = os.path.join(export_dir, filename)
    if not os.path.abspath(filepath).startswith(os.path.abspath(export_dir)):
        return jsonify({'error': '非法路径'}), 403
    if not os.path.exists(filepath):
        return jsonify({'error': '文件不存在'}), 404
    return send_file(filepath, as_attachment=True, download_name=filename)


@app.route('/api/reconcile-schedule-files-info')
def reconcile_schedule_files_info():
    files = _list_uploaded_reconcile_files()
    return jsonify({
        'ok': True,
        'count': len(files),
        'files': [os.path.basename(path) for path in files],
    })


@app.route('/api/reconcile-schedule-files', methods=['POST'])
def reconcile_schedule_files_upload():
    files = [f for f in request.files.getlist('files') if f and f.filename]
    if not files:
        return jsonify({'error': '请选择分排期文件（支持多个 .xlsx，或从金山下载的 .zip）'}), 400

    staging_dir = os.path.join(app.config['UPLOAD_FOLDER'], f'_reconcile_stage_{uuid.uuid4().hex}')
    os.makedirs(staging_dir, exist_ok=True)
    saved = []
    errors = []
    final_files = []
    try:
        for storage in files:
            try:
                saved.extend(_save_reconcile_upload(storage, staging_dir))
            except zipfile.BadZipFile:
                errors.append(f'{storage.filename}: 压缩包格式不正确')
            except Exception as e:
                errors.append(f'{storage.filename}: {e}')

        if errors:
            return jsonify({
                'error': '本批次包含无效文件，已保留原来的分排期文件',
                'errors': errors,
            }), 400
        if not saved:
            return jsonify({
                'error': '没有上传到有效的分排期 .xlsx 文件，已保留原来的分排期文件',
                'errors': errors,
            }), 400

        final_files = [name for name in saved if os.path.exists(os.path.join(staging_dir, name))]
        if not final_files:
            raise ValueError('暂存目录没有可用的分排期文件')
        with _reconcile_guard():
            _activate_reconcile_staging(staging_dir)
    except Exception as e:
        return jsonify({'error': f'分排期文件保存失败: {e}'}), 500
    finally:
        if _is_inside_dir(staging_dir, app.config['UPLOAD_FOLDER']) and os.path.exists(staging_dir):
            shutil.rmtree(staging_dir, ignore_errors=True)

    if not final_files:
        return jsonify({'error': '分排期文件保存失败，请重新上传'}), 500
    return jsonify({
        'ok': True,
        'count': len(final_files),
        'files': final_files,
        'errors': errors,
        'msg': f'已上传 {len(final_files)} 个分排期文件，可开始总分排期核对',
    })


@app.route('/api/reconcile-schedules', methods=['POST'])
def reconcile_schedules_api():
    try:
        with _reconcile_guard():
            master_path = _get_master_path()
            schedule_files = _list_uploaded_reconcile_files()
            if not master_path or not os.path.exists(master_path):
                return jsonify({'error': '请先上传总排期文件'}), 400
            if not schedule_files:
                return jsonify({
                    'error': '请先上传分排期文件，再进行总分排期核对（支持多个 .xlsx，或从金山下载的 .zip）。'
                }), 400
            result = reconcile_schedules(
                master_path,
                schedule_dir=app.config['RECONCILE_FOLDER'],
                export_dir=app.config['EXPORT_FOLDER'],
            )
        result['uploaded_schedule_count'] = len(schedule_files)
        result['summary'] = result.get('summary', [])[:120]
        result['missing'] = result.get('missing', [])[:80]
        result['extra'] = result.get('extra', [])[:80]
        result['mismatches'] = result.get('mismatches', [])[:80]
        result['skipped_sheets'] = result.get('skipped_sheets', [])[:50]
        return jsonify(result)
    except FileNotFoundError as e:
        return jsonify({'error': str(e)}), 404
    except PermissionError as e:
        return jsonify({'error': str(e)}), 500
    except Exception as e:
        logging.exception('[总分排期核对] 处理失败')
        return jsonify({'error': f'总分排期核对失败: {e}'}), 500


@app.route('/api/yellow-summary', methods=['POST'])
def yellow_summary():
    """扫描总排期有填充行汇总"""
    mp = _get_master_path()
    if not mp or not os.path.exists(mp):
        return jsonify({'error': '请先上传总排期文件'}), 400
    try:
        result = generate_summary(mp)
        return jsonify(result)
    except Exception as e:
        return jsonify({'error': f'生成汇总失败: {e}'}), 500


@app.route('/api/yellow-summary-download', methods=['POST'])
def yellow_summary_download():
    """生成有填充行汇总Excel并下载"""
    mp = _get_master_path()
    if not mp or not os.path.exists(mp):
        return jsonify({'error': '请先上传总排期文件'}), 400
    export_dir = app.config['EXPORT_FOLDER']
    try:
        fname = generate_summary_excel(mp, export_dir)
        if not fname:
            return jsonify({'error': '无整行填充行，无法生成'}), 400
        filepath = os.path.join(export_dir, fname)
        return send_file(filepath, as_attachment=True, download_name=fname)
    except Exception as e:
        return jsonify({'error': f'生成汇总Excel失败: {e}'}), 500


if __name__ == '__main__':
    port = int(os.environ.get('APP_PORT', 5003))
    print('=' * 50)
    print('  ZURU 总排期入单系统（云端分析版）')
    print(f'  http://localhost:{port}')
    print('=' * 50)
    app.run(host='0.0.0.0', port=port, debug=True, use_reloader=False, threaded=True)
