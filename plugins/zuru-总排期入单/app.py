# -*- coding: utf-8 -*-
"""ZURU 总排期入单系统 — 云端分析版
功能：解析PO Excel + 与总排期匹配 → 输出修改单明细 + 生成新单Excel
不依赖Z盘路径/WPS COM，纯Linux可跑
"""
import os, sys, json, logging, re
from datetime import datetime
from collections import defaultdict
from flask import Flask, render_template, request, jsonify, send_file
from excel_po_parser import ExcelPOParser
from master_schedule import write_orders, lookup_schedule_info
from generate_yellow_summary import generate_summary

APP_DIR = os.path.dirname(os.path.abspath(__file__))
app = Flask(__name__, template_folder=os.path.join(APP_DIR, 'templates'))
app.config['UPLOAD_FOLDER'] = os.path.join(APP_DIR, 'uploads')
app.config['MASTER_FOLDER'] = os.path.join(APP_DIR, 'uploads', 'master')
app.config['EXPORT_FOLDER'] = os.path.join(APP_DIR, 'exports')
app.config['MAX_CONTENT_LENGTH'] = 512 * 1024 * 1024
for d in [app.config['UPLOAD_FOLDER'], app.config['MASTER_FOLDER'], app.config['EXPORT_FOLDER']]:
    os.makedirs(d, exist_ok=True)

LOG_FILE = os.path.join(APP_DIR, 'data', 'ops.log')
os.makedirs(os.path.dirname(LOG_FILE), exist_ok=True)
logging.basicConfig(filename=LOG_FILE, level=logging.INFO,
                    format='%(asctime)s %(message)s', encoding='utf-8')

# 上传的总排期副本路径（运行时维护）
_master_file = {'path': ''}


def _get_master_path():
    return _master_file['path']


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
    if ext not in ('.xlsx', '.xls'):
        return jsonify({'error': '只支持xlsx/xls文件'}), 400
    # 保存到master目录（覆盖旧的）
    path = os.path.join(app.config['MASTER_FOLDER'], f.filename)
    f.save(path)
    _master_file['path'] = path
    logging.info(f'[总排期] 上传副本: {f.filename}')
    return jsonify({'ok': True, 'path': path, 'filename': f.filename,
                    'msg': f'已上传总排期: {f.filename}'})


@app.route('/api/master-schedule-info')
def master_schedule_info():
    """总排期文件状态"""
    mp = _get_master_path()
    return jsonify({
        'exists': bool(mp) and os.path.exists(mp),
        'locked': False,
        'path': mp or '(未上传总排期文件)',
    })


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
        path = os.path.join(app.config['UPLOAD_FOLDER'], f.filename)
        f.save(path)
        saved.append((f.filename, path))

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


if __name__ == '__main__':
    port = int(os.environ.get('APP_PORT', 5003))
    print('=' * 50)
    print('  ZURU 总排期入单系统（云端分析版）')
    print(f'  http://localhost:{port}')
    print('=' * 50)
    app.run(host='0.0.0.0', port=port, debug=True, use_reloader=False, threaded=True)
