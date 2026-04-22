# -*- coding: utf-8 -*-
"""
ZURU出货助手 - Web版（远程部署）
Flask服务，所有文件通过上传/下载，无需共享盘
端口: 5003
"""

import os
import sys
import uuid
import json
import glob
import shutil
import logging
import threading
import queue
from datetime import datetime

from flask import (
    Flask, render_template, request, jsonify,
    send_file, Response, stream_with_context,
)
from werkzeug.utils import secure_filename

from shipment_processor import process

# ============================================================
# 配置
# ============================================================

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_PATH = os.environ.get('DATA_PATH', BASE_DIR)
UPLOAD_DIR = os.path.join(DATA_PATH, 'uploads')
OUTPUT_DIR = os.path.join(DATA_PATH, 'output')
os.makedirs(UPLOAD_DIR, exist_ok=True)
os.makedirs(OUTPUT_DIR, exist_ok=True)

app = Flask(__name__)
app.config['MAX_CONTENT_LENGTH'] = 500 * 1024 * 1024  # 500MB

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    datefmt='%H:%M:%S',
)
logger = logging.getLogger(__name__)

# ============================================================
# 任务管理
# ============================================================

_tasks = {}
_tasks_lock = threading.Lock()


def _new_task():
    task_id = uuid.uuid4().hex[:12]
    task = {
        'status': 'running',
        'logs': queue.Queue(),
        'result': None,
        'error': None,
        'output_files': [],
    }
    with _tasks_lock:
        _tasks[task_id] = task
    return task_id, task


def _get_task(task_id):
    with _tasks_lock:
        return _tasks.get(task_id)


# ============================================================
# 路由
# ============================================================

@app.route('/health')
def health():
    return jsonify({'status': 'ok'})


@app.route('/')
def index():
    return render_template('index.html')


@app.route('/start', methods=['POST'])
def start_process():
    """启动处理任务"""
    # 1. 接单表（上传）
    order_file = request.files.get('order_file')
    if not order_file or not order_file.filename:
        return jsonify({'ok': False, 'msg': '请上传接单表文件'}), 400

    # 清理上次临时文件
    for old in glob.glob(os.path.join(UPLOAD_DIR, '*')):
        try:
            if os.path.isfile(old):
                os.remove(old)
            elif os.path.isdir(old):
                shutil.rmtree(old, ignore_errors=True)
        except Exception:
            pass

    fname = secure_filename(order_file.filename) or 'order.xlsx'
    ts = datetime.now().strftime('%Y%m%d_%H%M%S')
    save_name = f"{ts}_{fname}"
    order_path = os.path.join(UPLOAD_DIR, save_name)
    order_file.save(order_path)

    # 2. 出货文件夹（上传）
    folder_files = request.files.getlist('folder_files')
    if not folder_files or not folder_files[0].filename:
        return jsonify({'ok': False, 'msg': '请上传出货资料文件夹'}), 400

    folder_dir = os.path.join(UPLOAD_DIR, f"{ts}_shipment_folder")
    os.makedirs(folder_dir, exist_ok=True)
    for f in folder_files:
        if not f.filename:
            continue
        fname_part = os.path.basename(f.filename)
        if not fname_part:
            continue
        f.save(os.path.join(folder_dir, fname_part))
    folder_path = folder_dir

    # 3. 金额表（上传，可选）
    amount_file = request.files.get('amount_file')
    amount_path = None
    if amount_file and amount_file.filename:
        amt_fname = secure_filename(amount_file.filename) or 'amount.xlsx'
        amount_path = os.path.join(UPLOAD_DIR, f"{ts}_{amt_fname}")
        amount_file.save(amount_path)

    # 4. 备注日期
    mark_date = request.form.get('mark_date', '').strip()

    # 创建任务
    task_id, task = _new_task()

    def _run():
        try:
            def log_cb(msg):
                task['logs'].put(msg)

            existing_files = set(os.listdir(os.path.dirname(order_path)))

            result, info = process(
                order_path,
                folder_path,
                mark_date=mark_date,
                log_callback=log_cb,
                amount_table_path=amount_path,
            )

            if result is None:
                task['status'] = 'error'
                task['error'] = str(info)
                task['logs'].put(f"\n处理失败: {info}")
            else:
                task['status'] = 'done'
                task['result'] = (result, info)

                files = []
                if result and os.path.isfile(result):
                    files.append({
                        'name': os.path.basename(result),
                        'path': result,
                        'type': '接单表（已更新）',
                    })
                if result:
                    cur_dir = os.path.dirname(result)
                    for f in os.listdir(cur_dir):
                        if '新增数据' in f and f.endswith('.xlsx'):
                            if f not in existing_files:
                                fpath = os.path.join(cur_dir, f)
                                if fpath != result:
                                    files.append({
                                        'name': f,
                                        'path': fpath,
                                        'type': '金额表新增数据',
                                    })
                error_report = info.get('error_report') if isinstance(info, dict) else None
                if error_report and os.path.isfile(error_report):
                    files.append({
                        'name': os.path.basename(error_report),
                        'path': error_report,
                        'type': '库存异常报告',
                    })

                task['output_files'] = files

                stats = info if isinstance(info, dict) else {}
                sub_skipped = stats.get('sub_skipped', 0)
                task['logs'].put(
                    f"\n{'='*50}\n"
                    f"处理完成！\n"
                    f"成功匹配: {stats.get('processed', 0)} 组\n"
                    f"子行跳过: {sub_skipped} 组（正常）\n"
                    f"未找到匹配: {stats.get('not_found', 0)} 组\n"
                    f"标记出货行: {stats.get('rows_marked', 0)} 行\n"
                    f"{'='*50}"
                )

        except Exception as e:
            task['status'] = 'error'
            task['error'] = str(e)
            task['logs'].put(f"\n处理异常: {e}")
        finally:
            task['logs'].put(None)

    t = threading.Thread(target=_run, daemon=True)
    t.start()

    return jsonify({'ok': True, 'task_id': task_id})


@app.route('/logs/<task_id>')
def stream_logs(task_id):
    """SSE实时日志流"""
    task = _get_task(task_id)
    if not task:
        return jsonify({'ok': False, 'msg': '任务不存在'}), 404

    def generate():
        while True:
            try:
                msg = task['logs'].get(timeout=30)
            except queue.Empty:
                yield f"data: {json.dumps({'type': 'heartbeat'}, ensure_ascii=False)}\n\n"
                continue

            if msg is None:
                files_info = []
                for i, f in enumerate(task.get('output_files', [])):
                    files_info.append({
                        'index': i,
                        'name': f['name'],
                        'type': f['type'],
                    })
                payload = {
                    'type': 'done',
                    'status': task['status'],
                    'error': task.get('error'),
                    'files': files_info,
                }
                yield f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"
                break
            else:
                payload = {'type': 'log', 'msg': msg}
                yield f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"

    return Response(
        stream_with_context(generate()),
        mimetype='text/event-stream',
        headers={
            'Cache-Control': 'no-cache',
            'X-Accel-Buffering': 'no',
        },
    )


@app.route('/download/<task_id>/<int:file_index>')
def download_file(task_id, file_index):
    """下载输出文件"""
    task = _get_task(task_id)
    if not task:
        return jsonify({'ok': False, 'msg': '任务不存在'}), 404

    files = task.get('output_files', [])
    if file_index < 0 or file_index >= len(files):
        return jsonify({'ok': False, 'msg': '文件索引无效'}), 404

    finfo = files[file_index]
    fpath = finfo['path']
    if not os.path.isfile(fpath):
        return jsonify({'ok': False, 'msg': '文件不存在'}), 404

    return send_file(
        fpath,
        as_attachment=True,
        download_name=finfo['name'],
    )


# ============================================================
# 启动
# ============================================================

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5003))
    app.run(host='0.0.0.0', port=port, debug=False, threaded=True)
