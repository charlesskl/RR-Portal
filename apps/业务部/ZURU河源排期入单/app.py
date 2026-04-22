# -*- coding: utf-8 -*-
"""河源排期入单系统 — 云端分析版
多文件独立排期，跨文件全局索引。
不依赖WPS COM，纯Linux可跑。
"""
import os
import sys
import json
import time
import logging
import tempfile
import threading
from datetime import datetime
from flask import Flask, render_template, request, jsonify, send_file
from werkzeug.utils import secure_filename
from werkzeug.middleware.proxy_fix import ProxyFix

from excel_po_parser import ExcelPOParser
from hy_schedule import analyze_orders, write_orders, build_global_index

APP_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(APP_DIR, 'data')
EXPORT_DIR = os.path.join(APP_DIR, 'exports')
UPLOAD_DIR = os.path.join(APP_DIR, 'uploads')

for d in (DATA_DIR, EXPORT_DIR, UPLOAD_DIR):
    os.makedirs(d, exist_ok=True)

app = Flask(__name__,
            template_folder=os.path.join(APP_DIR, 'templates'),
            static_folder=os.path.join(APP_DIR, 'static'))
app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1, x_prefix=1)
app.config['UPLOAD_FOLDER'] = UPLOAD_DIR
app.config['MAX_CONTENT_LENGTH'] = 512 * 1024 * 1024

LOG_FILE = os.path.join(DATA_DIR, 'ops.log')
logging.basicConfig(
    filename=LOG_FILE, level=logging.INFO,
    format='%(asctime)s %(message)s', encoding='utf-8'
)


# ========== 配置管理 ==========

def load_config():
    cfg_path = os.path.join(DATA_DIR, 'config.json')
    default = {
        'port': 5006,
        'default_schedule_dir': r'C:\Users\Administrator\Desktop\河源排期新 - 副本'
    }
    if os.path.exists(cfg_path):
        try:
            with open(cfg_path, 'r', encoding='utf-8') as f:
                default.update(json.load(f))
        except Exception:
            pass
    return default


CONFIG = load_config()
_custom_path = {'dir': ''}


def get_schedule_dir():
    return _custom_path['dir'] or CONFIG['default_schedule_dir']


# ========== 缓存待处理订单（等待用户选择repeated货号的目标） ==========
# key: session_id, value: {orders, ambiguous, analysis, timestamp}
_pending_sessions = {}
_sessions_lock = threading.Lock()


def _cleanup_pending():
    """清理超过1小时的pending会话（线程安全）"""
    now = datetime.now()
    with _sessions_lock:
        expired = [k for k, v in _pending_sessions.items()
                   if (now - v['timestamp']).total_seconds() > 3600]
        for k in expired:
            del _pending_sessions[k]


# ========== 路由 ==========

@app.route('/')
def index():
    return render_template('hy_master.html')


@app.route('/api/hy-info')
def hy_info():
    """获取当前路径状态"""
    d = get_schedule_dir()
    exists = os.path.isdir(d)
    file_count = 0
    if exists:
        try:
            file_count = len([f for f in os.listdir(d)
                              if f.endswith('.xlsx') and not f.startswith('~$')])
        except Exception:
            pass
    # 读映射表信息
    map_path = os.path.join(DATA_DIR, 'hy_item_map.json')
    item_count = 0
    if os.path.exists(map_path):
        try:
            with open(map_path, 'r', encoding='utf-8') as f:
                item_count = len(json.load(f))
        except Exception:
            pass
    return jsonify({
        'dir': d,
        'exists': exists,
        'file_count': file_count,
        'item_count': item_count,
    })


@app.route('/api/hy-set-dir', methods=['POST'])
def hy_set_dir():
    """切换排期目录"""
    new_dir = (request.json or {}).get('dir', '').strip()
    if not new_dir:
        _custom_path['dir'] = ''
        return jsonify({'ok': True, 'dir': CONFIG['default_schedule_dir'], 'msg': '已恢复默认路径'})
    if not os.path.isdir(new_dir):
        return jsonify({'ok': False, 'error': f'目录不存在: {new_dir}'}), 400
    _custom_path['dir'] = new_dir
    return jsonify({'ok': True, 'dir': new_dir, 'msg': f'已切换到: {new_dir}'})


@app.route('/api/hy-rescan', methods=['POST'])
def hy_rescan():
    """重建货号→文件映射表"""
    import subprocess
    d = get_schedule_dir()
    try:
        script = os.path.join(APP_DIR, 'scan_hy_items.py')
        result = subprocess.run(
            [sys.executable, script, d],
            capture_output=True, text=True, timeout=600, encoding='utf-8'
        )
        return jsonify({
            'ok': result.returncode == 0,
            'stdout': result.stdout,
            'stderr': result.stderr,
        })
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 500


@app.route('/api/hy-upload', methods=['POST'])
def hy_upload():
    """上传PO Excel，分析得到修改单/新单/重复货号"""
    _cleanup_pending()

    saved = []
    for f in request.files.getlist('files'):
        if not f.filename:
            continue
        ext = os.path.splitext(f.filename)[1].lower()
        if ext not in ('.xlsx', '.xls'):
            continue
        # 安全文件名防路径穿越
        safe_name = secure_filename(f.filename) or f'upload_{int(time.time())}{ext}'
        if not safe_name.endswith(ext):
            safe_name += ext
        path = os.path.join(UPLOAD_DIR, safe_name)
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
        return jsonify({'error': f'解析失败: {"; ".join(errors)}'}), 400

    # 分析
    d = get_schedule_dir()
    try:
        analysis = analyze_orders(d, orders)
    except Exception as e:
        logging.error(f'[河源] 分析失败: {e}')
        return jsonify({'error': f'分析失败: {e}'}), 500

    # 统一返回session_id，让前端选择"写入"或"导出Excel"
    session_id = datetime.now().strftime('%Y%m%d%H%M%S%f')
    with _sessions_lock:
        _pending_sessions[session_id] = {
            'orders': orders,
            'analysis': analysis,
            'timestamp': datetime.now(),
        }

    # ambiguous详细信息
    amb_for_ui = []
    for amb in analysis['ambiguous']:
        amb_for_ui.append({
            'key': f"{amb['order_idx']}_{amb['line_idx']}",
            'item': amb['item'],
            'po': amb['po'],
            'candidates': amb['candidates'],
        })

    return jsonify({
        'ok': True,
        'need_selection': True,
        'session_id': session_id,
        'ambiguous': amb_for_ui,
        'modifications_count': len(analysis['modifications']),
        'new_count': len(analysis['new_lines']),
        'unknown_count': len(analysis['unknown']),
        'errors': errors,
    })


@app.route('/api/hy-submit-selection', methods=['POST'])
def hy_submit_selection():
    """提交重复货号的选择结果，执行写入"""
    _cleanup_pending()
    data = request.json or {}
    session_id = data.get('session_id')
    selections = data.get('selections', {})  # {key: {'file':.., 'sheet':..}}

    with _sessions_lock:
        session = _pending_sessions.get(session_id)

    if not session:
        return jsonify({'error': '会话已过期，请重新上传'}), 400

    orders = session['orders']
    analysis = session['analysis']
    d = get_schedule_dir()

    # 校验selections：必须在原ambiguous的candidates列表内
    valid_map = {}
    for amb in analysis['ambiguous']:
        key = f"{amb['order_idx']}_{amb['line_idx']}"
        valid_map[key] = {(c['file'], c['sheet']) for c in amb['candidates']}

    for key, sel in selections.items():
        if key not in valid_map:
            return jsonify({'error': f'非法选择key: {key}'}), 400
        if not isinstance(sel, dict) or 'file' not in sel or 'sheet' not in sel:
            return jsonify({'error': f'选择数据格式错误: {key}'}), 400
        if (sel['file'], sel['sheet']) not in valid_map[key]:
            return jsonify({'error': f'选择的文件/Sheet不在候选范围内: {key}'}), 400

    try:
        result = write_orders(d, orders, ambiguous_selections=selections, export_dir=EXPORT_DIR)
    except PermissionError:
        return jsonify({'error': '排期文件被占用，请关闭后重试'}), 500
    except Exception as e:
        logging.error(f'[河源] 提交写入失败: {e}')
        return jsonify({'error': f'写入失败: {e}'}), 500
    finally:
        # 清理session
        with _sessions_lock:
            if session_id in _pending_sessions:
                del _pending_sessions[session_id]

    resp = {
        'ok': True, 'msg': result['msg'],
        'modified': result.get('modified', 0),
        'new_count': result.get('new_count', 0),
        'mod_details': result.get('mod_details', []),
        'new_details': result.get('new_details', []),
        'unknown': result.get('unknown', []),
    }
    if result.get('export_file'):
        resp['export_file'] = result['export_file']
    return jsonify(resp)


@app.route('/api/hy-export-only', methods=['POST'])
def hy_export_only():
    """仅生成分类Excel，不写入排期。ambiguous货号放入所有匹配sheet。
    支持两种调用方式：
    1. 有session_id → 复用已解析的pending session
    2. 无session_id → 从上传阶段直接调用（orders已解析）
    """
    from hy_schedule import analyze_orders, _extract_header, _prepare_line_data, \
        _item_upper, _generate_new_excel

    data = request.json or {}
    session_id = data.get('session_id')

    if session_id:
        with _sessions_lock:
            session = _pending_sessions.get(session_id)
        if not session:
            return jsonify({'error': '会话已过期，请重新上传'}), 400
        orders = session['orders']
    else:
        return jsonify({'error': '缺少session_id'}), 400

    d = get_schedule_dir()
    try:
        analysis = analyze_orders(d, orders)
    except Exception as e:
        return jsonify({'error': f'分析失败: {e}'}), 500

    # 核心区别：ambiguous的货号放入**所有**匹配sheet，而非要求选一个
    for amb in analysis['ambiguous']:
        for cand in amb['candidates']:
            analysis['new_lines'].append({
                'order_idx': amb['order_idx'],
                'line_idx': amb['line_idx'],
                'item': amb['item'], 'po': amb['po'],
                'file': cand['file'], 'sheet': cand['sheet'],
            })

    # 复用write_orders的新单Excel生成逻辑（不做COM修改写入）
    import re
    cn_names = dict(analysis.get('cn_names', {}))
    try:
        cn_map_path = os.path.join(DATA_DIR, 'item_cn_name_map.json')
        if os.path.exists(cn_map_path):
            with open(cn_map_path, 'r', encoding='utf-8') as f:
                raw = json.load(f)
            for k, v in raw.items():
                if not k.startswith('_') and k.upper() not in cn_names:
                    cn_names[k.upper()] = v.get('cn_name', '') if isinstance(v, dict) else str(v)
    except Exception:
        pass

    new_rows = []
    # 新单 + ambiguous（已合并到new_lines）
    for nl in analysis['new_lines']:
        oi, li = nl['order_idx'], nl['line_idx']
        order = orders[oi]
        hdr = _extract_header(order)
        ln_data = _prepare_line_data(order, order['lines'][li], hdr['ship_dt'], hdr['full_note'],
                                     wb_name=nl['file'])
        item_base = re.match(r'(\d+[A-Za-z]*\d*)', _item_upper(nl['item']))
        cn_name = cn_names.get(item_base.group(1).upper(), '') if item_base else ''
        _has_outer = bool(ln_data['outer_qty'])
        _has_price = bool(ln_data['price'])
        new_rows.append({
            'target_file': nl['file'], 'target_sheet': nl['sheet'],
            'po_date': hdr['po_date_dt'], 'customer': hdr['customer'], 'dest': hdr['dest'],
            'po': hdr['po'], 'cpo': ln_data['customer_po'], 'sku_line': ln_data['f_sku'],
            'item': ln_data['sku_spec'], 'cn_name': cn_name,
            'qty': ln_data['qty'], 'inner': ln_data['inner_pcs'],
            'outer': ln_data['outer_qty'],
            'total_box': '__FORMULA_TOTAL_BOX__' if _has_outer else '',
            'ship_date': ln_data['line_ship_dt'], 'insp_date': ln_data['insp_dt'],
            'remark': hdr['full_note'],
            'from_person': hdr['from_person'].split('/')[0].strip() if hdr['from_person'] else '',
            'price': round(ln_data['price'], 4) if _has_price else '',
            'amount': '__FORMULA_AMOUNT__' if _has_price else '',
        })

    # 修改单放入独立的"修改单"sheet（不混在新单sheet中）
    for m in analysis['modifications']:
        oi, li = m['order_idx'], m['line_idx']
        order = orders[oi]
        hdr = _extract_header(order)
        ln_data = _prepare_line_data(order, order['lines'][li], hdr['ship_dt'], hdr['full_note'],
                                     wb_name=m['file'])
        item_base = re.match(r'(\d+[A-Za-z]*\d*)', _item_upper(m['item']))
        cn_name = cn_names.get(item_base.group(1).upper(), '') if item_base else ''
        _has_outer = bool(ln_data['outer_qty'])
        _has_price = bool(ln_data['price'])
        new_rows.append({
            'target_file': '修改单', 'target_sheet': '',
            'po_date': hdr['po_date_dt'], 'customer': hdr['customer'], 'dest': hdr['dest'],
            'po': hdr['po'], 'cpo': ln_data['customer_po'], 'sku_line': ln_data['f_sku'],
            'item': ln_data['sku_spec'], 'cn_name': cn_name,
            'qty': ln_data['qty'], 'inner': ln_data['inner_pcs'],
            'outer': ln_data['outer_qty'],
            'total_box': '__FORMULA_TOTAL_BOX__' if _has_outer else '',
            'ship_date': ln_data['line_ship_dt'], 'insp_date': ln_data['insp_dt'],
            'remark': f"[修改] 目标:{m['file']}/{m['sheet']} R{m['row']}",
            'from_person': hdr['from_person'].split('/')[0].strip() if hdr['from_person'] else '',
            'price': round(ln_data['price'], 4) if _has_price else '',
            'amount': '__FORMULA_AMOUNT__' if _has_price else '',
        })

    # unknown
    for uk in analysis['unknown']:
        oi, li = uk['order_idx'], uk['line_idx']
        order = orders[oi]
        hdr = _extract_header(order)
        ln_data = _prepare_line_data(order, order['lines'][li], hdr['ship_dt'], hdr['full_note'],
                                     wb_name='')
        item_base = re.match(r'(\d+[A-Za-z]*\d*)', _item_upper(uk['item']))
        cn_name = cn_names.get(item_base.group(1).upper(), '') if item_base else ''
        _has_outer = bool(ln_data['outer_qty'])
        _has_price = bool(ln_data['price'])
        new_rows.append({
            'target_file': '未识别货号', 'target_sheet': '',
            'po_date': hdr['po_date_dt'], 'customer': hdr['customer'], 'dest': hdr['dest'],
            'po': hdr['po'], 'cpo': ln_data['customer_po'], 'sku_line': ln_data['f_sku'],
            'item': ln_data['sku_spec'], 'cn_name': cn_name,
            'qty': ln_data['qty'], 'inner': ln_data['inner_pcs'],
            'outer': ln_data['outer_qty'],
            'total_box': '__FORMULA_TOTAL_BOX__' if _has_outer else '',
            'ship_date': ln_data['line_ship_dt'], 'insp_date': ln_data['insp_dt'],
            'remark': hdr['full_note'],
            'from_person': hdr['from_person'].split('/')[0].strip() if hdr['from_person'] else '',
            'price': round(ln_data['price'], 4) if _has_price else '',
            'amount': '__FORMULA_AMOUNT__' if _has_price else '',
        })

    if not new_rows:
        return jsonify({'error': '没有可导出的数据'}), 400

    export_file = _generate_new_excel(new_rows, EXPORT_DIR, schedule_dir=d)
    if not export_file:
        return jsonify({'error': '生成Excel失败'}), 500

    # 清理session
    if session_id:
        with _sessions_lock:
            _pending_sessions.pop(session_id, None)

    logging.info(f'[河源] 仅导出分类Excel: {len(new_rows)}行, 文件={export_file}')
    return jsonify({
        'ok': True,
        'msg': f'已生成分类Excel（{len(new_rows)}行，不写入排期）',
        'export_file': export_file,
        'new_count': len(analysis['new_lines']) - sum(len(a['candidates']) for a in analysis['ambiguous']),
        'mod_count': len(analysis['modifications']),
        'unknown_count': len(analysis['unknown']),
        'ambiguous_count': len(analysis['ambiguous']),
    })


@app.route('/api/hy-export-download/<filename>')
def hy_export_download(filename):
    filepath = os.path.join(EXPORT_DIR, filename)
    if not os.path.abspath(filepath).startswith(os.path.abspath(EXPORT_DIR)):
        return jsonify({'error': '非法路径'}), 403
    if not os.path.exists(filepath):
        return jsonify({'error': '文件不存在'}), 404
    return send_file(filepath, as_attachment=True, download_name=filename)


if __name__ == '__main__':
    port = int(os.environ.get('PORT', CONFIG.get('port', 5006)))
    print('=' * 50)
    print('  ZURU 河源排期入单系统')
    print(f'  http://localhost:{port}')
    print('=' * 50)
    app.run(host='0.0.0.0', port=port, debug=False, use_reloader=False, threaded=True)
