"""C仓库 — SR3703 贴纸卷配比(独立版,无登录,本地直接打开)。

从公司框架剥离而来,去掉了统一登录/部门鉴权/只读锁:
- 不再依赖 unified 的 shared.auth
- 任何人本地打开即用,删除等操作放行(本地单人工具)
- 入口见 run.py:  python run.py
"""
import os
import re

from flask import Flask, render_template, redirect, jsonify, request, url_for, flash
from werkzeug.utils import secure_filename
from werkzeug.middleware.proxy_fix import ProxyFix

from parser import parse_tiejuanzhi

_HERE = os.path.dirname(os.path.abspath(__file__))
# 容器里用 bind-mount 的 /app/data;本地无该 env 时回退到源码旁的 data/
DATA_DIR = os.environ.get('DATA_PATH', os.path.join(_HERE, 'data'))

# 独立版固定的“当前用户”(模板里只用来显示名字),无鉴权含义
LOCAL_USER = {'username': '本地', 'display_name': '本地用户', 'role': 'admin'}


def _list_huohao():
    """列 data/ 下所有 xlsx 文件 → [{huohao, filename, size_kb}, ...]"""
    if not os.path.isdir(DATA_DIR):
        return []
    out = []
    for fn in sorted(os.listdir(DATA_DIR)):
        if not fn.lower().endswith(('.xlsx', '.xls')):
            continue
        full = os.path.join(DATA_DIR, fn)
        out.append({
            'huohao': os.path.splitext(fn)[0],
            'filename': fn,
            'size_kb': round(os.path.getsize(full) / 1024, 1),
        })
    return out


def _safe_huohao_from_xlsx(xlsx_path):
    """读 xlsx R0C0 当 货号(失败用文件名)。"""
    try:
        import pandas as pd
        df = pd.read_excel(xlsx_path, sheet_name=0, header=None, nrows=2)
        v = df.iat[0, 0] if df.shape[0] > 0 and df.shape[1] > 0 else None
        if v is None or (isinstance(v, float) and v != v):  # NaN
            return None
        s = re.sub(r'[^A-Za-z0-9_\-]', '', str(v).strip())
        return s if s else None
    except Exception:
        return None


def create_app(secret_key=None):
    app = Flask(__name__)
    app.secret_key = secret_key or os.environ.get('SECRET_KEY', 'c_store_local_dev')
    app.permanent_session_lifetime = 60 * 60 * 24 * 30  # 30 天
    app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'
    # nginx 子路径反代(/c-store)下让 url_for 生成正确链接:认 X-Forwarded-Prefix
    app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1, x_prefix=1)
    os.makedirs(DATA_DIR, exist_ok=True)

    @app.route('/health')
    def health():
        return jsonify({'status': 'ok'}), 200

    @app.route('/')
    def index():
        items = _list_huohao()
        # 选当前查看的货号:URL ?huohao=... 或第一个
        current = request.args.get('huohao', '').strip()
        if items and not any(it['huohao'] == current for it in items):
            current = items[0]['huohao'] if items else ''
        rows = {'fixed': [], 'random_groups': []}
        if current:
            xlsx = os.path.join(DATA_DIR, current + '.xlsx')
            if os.path.exists(xlsx):
                rows = parse_tiejuanzhi(xlsx)
        return render_template('index.html',
                               user=LOCAL_USER,
                               items=items,
                               current=current,
                               rows=rows)

    @app.route('/upload', methods=['POST'])
    def upload():
        f = request.files.get('file')
        if not f or not f.filename:
            flash('请选择文件', 'error')
            return redirect(url_for('index'))
        if not f.filename.lower().endswith(('.xlsx', '.xls')):
            flash('只支持 .xlsx/.xls 文件', 'error')
            return redirect(url_for('index'))
        # 先临时保存,读 R0 提货号,再重命名为 <货号>.xlsx
        tmp_name = secure_filename(f.filename)
        tmp_path = os.path.join(DATA_DIR, '__tmp__' + tmp_name)
        f.save(tmp_path)
        huohao = _safe_huohao_from_xlsx(tmp_path) or os.path.splitext(tmp_name)[0]
        final_path = os.path.join(DATA_DIR, huohao + '.xlsx')
        # 若同名已存在,覆盖
        if os.path.exists(final_path):
            os.remove(final_path)
        os.rename(tmp_path, final_path)
        flash(f'已导入 {huohao}', 'success')
        return redirect(url_for('index') + '?huohao=' + huohao)

    @app.route('/delete/<huohao>', methods=['POST'])
    def delete(huohao):
        huohao = re.sub(r'[^A-Za-z0-9_\-]', '', huohao)
        if not huohao:
            return jsonify({'error': '货号非法'}), 400
        path = os.path.join(DATA_DIR, huohao + '.xlsx')
        if os.path.exists(path):
            os.remove(path)
        return jsonify({'success': True})

    return app
