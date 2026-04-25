from flask import Flask, request, redirect, url_for, jsonify, session, flash, render_template
import sqlite3
import os
import sys
from datetime import timedelta
from functools import wraps

# 兼容 PyInstaller exe 和普通 Python 运行
if getattr(sys, 'frozen', False):
    BASE_DIR = os.path.dirname(sys.executable)
    TEMPLATE_DIR = os.path.join(sys._MEIPASS, 'templates')
    STATIC_DIR = os.path.join(sys._MEIPASS, 'static')
else:
    BASE_DIR = os.path.dirname(os.path.abspath(__file__))
    TEMPLATE_DIR = os.path.join(BASE_DIR, 'templates')
    STATIC_DIR = os.path.join(BASE_DIR, 'static')

app = Flask(__name__, template_folder=TEMPLATE_DIR, static_folder=STATIC_DIR)

DATA_PATH = os.environ.get('DATA_PATH', BASE_DIR)
os.makedirs(DATA_PATH, exist_ok=True)
DATABASE = os.path.join(DATA_PATH, 'huadeng.db')

app.secret_key = os.environ.get('HUADENG_SECRET_KEY', 'dev-change-me-in-prod')
app.permanent_session_lifetime = timedelta(hours=8)


@app.route('/health')
def health():
    return {'status': 'ok'}


def get_db():
    db = sqlite3.connect(DATABASE)
    db.row_factory = sqlite3.Row
    return db


def init_db():
    """初始化所有新 schema 表。幂等。"""
    con = sqlite3.connect(DATABASE)
    cur = con.cursor()

    # flow_records 主流水表
    cur.execute("""
    CREATE TABLE IF NOT EXISTS flow_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        recorded_by TEXT NOT NULL,
        from_party  TEXT NOT NULL,
        to_party    TEXT NOT NULL,
        date        TEXT NOT NULL,
        order_no    TEXT,
        remark      TEXT,
        jx_qty REAL DEFAULT 0, gx_qty REAL DEFAULT 0, zx_qty REAL DEFAULT 0,
        jkb_qty REAL DEFAULT 0, mkb_qty REAL DEFAULT 0, xb_qty REAL DEFAULT 0,
        dz_qty REAL DEFAULT 0, wb_qty REAL DEFAULT 0, pk_qty REAL DEFAULT 0,
        xzx_qty REAL DEFAULT 0, dgb_qty REAL DEFAULT 0, xjp_qty REAL DEFAULT 0,
        dk_qty REAL DEFAULT 0,
        xs_qty REAL DEFAULT 0, gsb_qty REAL DEFAULT 0,
        djx_qty REAL DEFAULT 0, zb_qty REAL DEFAULT 0,
        reconciliation_id INTEGER,
        locked INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (reconciliation_id) REFERENCES reconciliations(id)
    )
    """)
    cur.execute("CREATE INDEX IF NOT EXISTS idx_flow_recorded_by ON flow_records(recorded_by, from_party, to_party)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_flow_pair_date ON flow_records(from_party, to_party, date)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_flow_reconc ON flow_records(reconciliation_id)")

    # reconciliations 核对批次
    cur.execute("""
    CREATE TABLE IF NOT EXISTS reconciliations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        initiator_party TEXT NOT NULL,
        approver_party  TEXT NOT NULL,
        pair_low  TEXT NOT NULL,
        pair_high TEXT NOT NULL,
        date_from TEXT NOT NULL,
        date_to   TEXT NOT NULL,
        status    TEXT NOT NULL,
        snapshot_json TEXT,
        notes     TEXT,
        created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        approved_at TIMESTAMP
    )
    """)
    cur.execute("CREATE INDEX IF NOT EXISTS idx_reconc_approver ON reconciliations(approver_party, status)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_reconc_pair ON reconciliations(pair_low, pair_high, status)")

    # investment_records 投资记录（按 pair）
    cur.execute("""
    CREATE TABLE IF NOT EXISTS investment_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        recorded_by TEXT NOT NULL,
        counterparty TEXT NOT NULL,
        year_month TEXT NOT NULL,
        mkb_qty REAL DEFAULT 0, jkb_qty REAL DEFAULT 0,
        jx_qty REAL DEFAULT 0, gx_qty REAL DEFAULT 0,
        remark TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
    """)

    # monthly_inventory 月份实存数
    cur.execute("""
    CREATE TABLE IF NOT EXISTS monthly_inventory (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        recorded_by TEXT NOT NULL,
        counterparty TEXT NOT NULL,
        year_month TEXT NOT NULL,
        mkb_qty REAL, jkb_qty REAL, jx_qty REAL, gx_qty REAL,
        UNIQUE (recorded_by, counterparty, year_month)
    )
    """)

    # default_prices 单价表
    cur.execute("""
    CREATE TABLE IF NOT EXISTS default_prices (
        item_key TEXT PRIMARY KEY,
        price    REAL DEFAULT 0
    )
    """)

    con.commit()
    con.close()


# ==================== Party 常量与认证 ====================

PARTIES = {
    'hd': {'name': '华登',     'counterparties': ['sy', 'xx']},
    'sy': {'name': '邵阳华登', 'counterparties': ['hd', 'xx']},
    'xx': {'name': '兴信',     'counterparties': ['hd', 'sy']},
}

PARTY_ACCOUNTS = {
    'hd': {
        'username': os.environ.get('HUADENG_HD_USER', 'hd'),
        'password': os.environ.get('HUADENG_HD_PASSWORD', 'hd123456'),
    },
    'sy': {
        'username': os.environ.get('HUADENG_SY_USER', 'sy'),
        'password': os.environ.get('HUADENG_SY_PASSWORD', 'sy123456'),
    },
    'xx': {
        'username': os.environ.get('HUADENG_XX_USER', 'xx'),
        'password': os.environ.get('HUADENG_XX_PASSWORD', 'xx123456'),
    },
}

PARTY_BY_USERNAME = {acc['username']: p for p, acc in PARTY_ACCOUNTS.items()}
assert len(PARTY_BY_USERNAME) == 3, 'username 必须 3 个都唯一'

ITEMS = [
    ('jx', '胶箱'), ('gx', '钙塑箱'), ('zx', '纸箱'),
    ('jkb', '胶卡板'), ('mkb', '木卡板'), ('xb', '小板'),
    ('dz', '胶袋'), ('wb', '围布'), ('pk', '平卡'),
    ('xzx', '小纸箱'), ('dgb', '大盖板'), ('xjp', '小胶盆'),
    ('dk', '刀卡'),
    ('xs', '吸塑'), ('gsb', '钙塑板'),
    ('djx', '大胶箱'), ('zb', '纸板'),
]
STAT_ITEMS = [('mkb', '木卡板'), ('jkb', '胶卡板'), ('jx', '胶箱'), ('gx', '钙塑箱')]
TRIANGLE_ITEMS = [('mkb', '木卡板'), ('jkb', '胶卡板'), ('jx', '胶箱'), ('gx', '钙塑箱'), ('zx', '纸箱')]


def current_party():
    """Return the validated party from session, or None if absent / tampered."""
    p = session.get('party')
    return p if p in PARTIES else None


app.jinja_env.globals['current_party'] = current_party
app.jinja_env.globals['PARTIES'] = PARTIES
app.jinja_env.globals['ITEMS'] = ITEMS


def party_required(fn):
    """装饰器：要求当前 session 有 party，且 URL 里的 party 与之匹配。"""
    @wraps(fn)
    def wrapped(*args, **kwargs):
        url_party = kwargs.get('party')
        sess_party = session.get('party')
        if not sess_party:
            return redirect(url_for('party_login', party=url_party or 'hd'))
        if url_party and url_party != sess_party:
            flash('无权访问其他 party 页面')
            return redirect(url_for('index'))
        return fn(*args, **kwargs)
    return wrapped


@app.context_processor
def inject_pending_count():
    """顶部 nav badge：当前 party 作为 approver 的待处理核对数。"""
    party = session.get('party')
    if not party:
        return {'pending_approval_count': 0}
    try:
        con = sqlite3.connect(DATABASE)
        row = con.execute(
            "SELECT COUNT(*) FROM reconciliations WHERE approver_party=? AND status='pending_approval'",
            (party,)
        ).fetchone()
        con.close()
        return {'pending_approval_count': row[0] if row else 0}
    except Exception:
        app.logger.exception('inject_pending_count failed')
        return {'pending_approval_count': 0}


# ==================== 页面路由 ====================

@app.route('/')
def index():
    return ''  # filled in Task 6


@app.route('/party/<party>/login', methods=['GET', 'POST'])
def party_login(party):
    if party not in PARTIES:
        return redirect(url_for('index'))
    if request.method == 'POST':
        username = request.form.get('username', '').strip()
        password = request.form.get('password', '')
        # 1. username 必须存在
        user_party = PARTY_BY_USERNAME.get(username)
        if not user_party:
            flash('账号或密码错误')
            return redirect(url_for('party_login', party=party))
        # 2. 与 URL 里的 party 必须一致
        if user_party != party:
            flash('账号与登录入口不符')
            return redirect(url_for('party_login', party=party))
        # 3. 密码校验
        expected = PARTY_ACCOUNTS[party]['password']
        if password != expected:
            flash('账号或密码错误')
            return redirect(url_for('party_login', party=party))
        session.permanent = True
        session['party'] = party
        session.modified = True
        return redirect(url_for('party_page', party=party))
    return render_template('party_login.html', party=party)


@app.route('/party/<party>/logout')
def party_logout(party):
    session.pop('party', None)
    session.modified = True
    return redirect(url_for('index'))


@app.route('/party/<party>')
@party_required
def party_page(party):
    return f'TODO: party page for {party}'


# ==================== 默认单价 API ====================

@app.route('/api/prices', methods=['GET', 'POST'])
def api_prices():
    db = get_db()
    if request.method == 'POST':
        data = request.get_json()
        for key, price in data.items():
            db.execute('UPDATE default_prices SET price = ? WHERE item_key = ?', (float(price), key))
        db.commit()
        db.close()
        return jsonify({'status': 'ok'})
    prices = {row['item_key']: row['price']
              for row in db.execute('SELECT * FROM default_prices').fetchall()}
    db.close()
    return jsonify(prices)


init_db()

if __name__ == '__main__':
    import threading, webbrowser
    port = int(os.environ.get('PORT', 7000))
    if getattr(sys, 'frozen', False):
        threading.Timer(1.5, lambda: webbrowser.open(f'http://127.0.0.1:{port}')).start()
        app.run(debug=False, host='0.0.0.0', port=port)
    else:
        app.run(debug=True, host='0.0.0.0', port=port)
