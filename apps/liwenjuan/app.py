# app.py - 成品核对系统 Web 入口
import os
import uuid
from flask import Flask, render_template, request, jsonify, send_file, session

from core.checker import run_check, build_excel

app = Flask(__name__)
app.secret_key = os.environ.get('SECRET_KEY', 'hd-lwj-checker-2026')
app.config['MAX_CONTENT_LENGTH'] = 50 * 1024 * 1024  # 50 MB limit

# Apply BASE_PATH prefix for sub-path reverse proxy (nginx /liwenjuan/ → container)
class PrefixMiddleware:
    def __init__(self, wsgi_app, prefix=''):
        self.wsgi_app = wsgi_app
        self.prefix = prefix
    def __call__(self, environ, start_response):
        environ['SCRIPT_NAME'] = self.prefix
        return self.wsgi_app(environ, start_response)

base_path = os.environ.get('BASE_PATH', '')
if base_path:
    app.wsgi_app = PrefixMiddleware(app.wsgi_app, prefix=base_path)

UPLOAD_DIR = os.environ.get('UPLOAD_FOLDER', os.path.join(os.path.dirname(__file__), 'uploads'))
os.makedirs(UPLOAD_DIR, exist_ok=True)


@app.route('/health')
def health():
    return jsonify({'status': 'ok'})

def detect_comparison_type(filename):
    """根据文件名关键词判断对比文件类型"""
    name = filename.lower()
    if 'zu' in name:
        return 'zu'
    if '数量' in name or 'qty' in name:
        return 'qty'
    if '出货' in name or 'shipment' in name:
        return 'f262ck'
    if '26-1' in name or ('成品' in name and '26-2' not in name) or 'finished' in name:
        return 'f261'
    return None


@app.route('/')
def index():
    return render_template('index.html')


@app.route('/run', methods=['POST'])
def run():
    """接收基准文件 + 多个对比文件，自动识别类型，执行核对，返回 JSON 结果"""
    paths = {}

    # 基准文件
    main_file = request.files.get('main')
    if not main_file or not main_file.filename:
        return jsonify({'error': 'Missing base file'}), 400
    ext = os.path.splitext(main_file.filename)[1]
    main_path = os.path.join(UPLOAD_DIR, f'main_{uuid.uuid4().hex}{ext}')
    main_file.save(main_path)
    paths['main'] = main_path

    # 对比文件（多文件，自动识别）
    other_files = request.files.getlist('others')
    if not other_files or all(not f.filename for f in other_files):
        return jsonify({'error': 'Please select comparison files'}), 400

    for f in other_files:
        if not f.filename:
            continue
        ftype = detect_comparison_type(f.filename)
        if not ftype:
            return jsonify({'error': f'Cannot identify file: {f.filename} (filename must contain ZU / qty / shipment / 26-1 etc.)'}), 400
        if ftype in paths:
            return jsonify({'error': f'Duplicate file type detected: {f.filename}'}), 400
        ext = os.path.splitext(f.filename)[1]
        save_path = os.path.join(UPLOAD_DIR, f'{ftype}_{uuid.uuid4().hex}{ext}')
        f.save(save_path)
        paths[ftype] = save_path

    missing = {'f261', 'f262ck', 'zu', 'qty'} - set(paths.keys())
    if missing:
        labels = {'f261': '26-1 Finished Goods', 'f262ck': '26-2 Shipment Detail', 'zu': 'ZU Shipment Detail', 'qty': '26-2 Quantity'}
        missing_names = ', '.join(labels[k] for k in missing)
        return jsonify({'error': f'Missing comparison files: {missing_names}'}), 400

    try:
        result = run_check(
            paths['main'], paths['f261'],
            paths['f262ck'], paths['zu'], paths['qty']
        )
        excel_path = os.path.join(UPLOAD_DIR, f'result_{uuid.uuid4().hex}.xlsx')
        build_excel(result, excel_path)
        session['excel_path'] = excel_path
        return jsonify(result)
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    finally:
        for key in ['main', 'f261', 'f262ck', 'zu', 'qty']:
            p = paths.get(key)
            if p:
                try:
                    os.remove(p)
                except OSError:
                    pass


@app.route('/download')
def download():
    """下载最近一次核对生成的 Excel"""
    excel_path = session.get('excel_path')
    if not excel_path or not os.path.exists(excel_path):
        return 'No result file yet. Please run a check first.', 404
    response = send_file(excel_path, as_attachment=True, download_name='check_result.xlsx')
    try:
        os.remove(excel_path)
    except OSError:
        pass
    session.pop('excel_path', None)
    return response


if __name__ == '__main__':
    app.run(
        debug=os.environ.get('FLASK_DEBUG', '0') == '1',
        host='0.0.0.0',
        port=int(os.environ.get('PORT', 5004)),
    )
