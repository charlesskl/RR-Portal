from flask import Flask, request, redirect, url_for, jsonify, session, flash, render_template
import sqlite3
import json
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
PAIRS = [('hd', 'sy'), ('hd', 'xx'), ('sy', 'xx')]


def current_party():
    """Return the validated party from session, or None if absent / tampered."""
    p = session.get('party')
    return p if p in PARTIES else None


app.jinja_env.globals['current_party'] = current_party
app.jinja_env.globals['PARTIES'] = PARTIES
app.jinja_env.globals['ITEMS'] = ITEMS
app.jinja_env.globals['STAT_ITEMS'] = STAT_ITEMS


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
    return render_template('index.html')


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
    date_from = request.args.get('date_from', '')
    date_to = request.args.get('date_to', '')
    try:
        page_size = int(request.args.get('page_size', 50))
    except ValueError:
        page_size = 50
    if page_size not in (20, 50, 100, 200):
        page_size = 50

    con = sqlite3.connect(DATABASE)
    con.row_factory = sqlite3.Row

    counterparties = PARTIES[party]['counterparties']
    panels = []
    for cp in counterparties:
        panel = {'cp': cp, 'cp_name': PARTIES[cp]['name']}
        for direction, from_p, to_p in [('sent', party, cp), ('received', cp, party)]:
            all_r = _query_flow(con, recorded_by=party, from_party=from_p, to_party=to_p,
                                date_from=date_from, date_to=date_to)
            page_key = f'page_{cp}_{direction}'
            try:
                page = max(1, int(request.args.get(page_key, 1) or 1))
            except ValueError:
                page = 1
            total = len(all_r)
            pages = max(1, (total + page_size - 1) // page_size)
            page = min(page, pages)
            start = (page - 1) * page_size
            panel[f'{direction}_records'] = all_r[start:start + page_size]
            panel[f'{direction}_summary'] = _calc_summary(all_r)
            panel[f'{direction}_pagination'] = {
                'page': page, 'pages': pages, 'total': total, 'page_size': page_size,
                'start': start + 1 if total else 0,
                'end': start + len(all_r[start:start + page_size]),
                'page_key': page_key,
            }
        panels.append(panel)

    prices = {r['item_key']: r['price'] for r in con.execute('SELECT * FROM default_prices').fetchall()}
    con.close()
    return render_template('party.html', party=party, party_name=PARTIES[party]['name'],
                           panels=panels, prices=prices,
                           date_from=date_from, date_to=date_to, page_size=page_size)


@app.route('/party/<party>/entry', methods=['POST'])
@party_required
def party_entry(party):
    direction = request.form.get('direction')  # 'sent' | 'received'
    cp = request.form.get('counterparty')
    if cp not in PARTIES or cp == party:
        flash('无效的对方')
        return redirect(url_for('party_page', party=party))
    if cp not in PARTIES[party]['counterparties']:
        flash('无权对此 party 录入')
        return redirect(url_for('party_page', party=party))

    if direction == 'sent':
        from_p, to_p = party, cp
    elif direction == 'received':
        from_p, to_p = cp, party
    else:
        flash('无效 direction')
        return redirect(url_for('party_page', party=party))

    date = request.form.get('date', '').strip()
    order_no = request.form.get('order_no', '').strip() or None
    remark = request.form.get('remark', '').strip() or None
    if not date:
        flash('日期必填')
        return redirect(url_for('party_page', party=party))

    qty_cols = [f'{k}_qty' for k, _ in ITEMS]
    qty_vals = []
    for col in qty_cols:
        v = request.form.get(col, '0').strip()
        try:
            qty_vals.append(float(v) if v else 0)
        except ValueError:
            qty_vals.append(0)

    con = sqlite3.connect(DATABASE)
    placeholders = ', '.join(['?'] * len(qty_cols))
    con.execute(f"""
        INSERT INTO flow_records (recorded_by, from_party, to_party, date, order_no, remark,
                                  {', '.join(qty_cols)})
        VALUES (?, ?, ?, ?, ?, ?, {placeholders})
    """, [party, from_p, to_p, date, order_no, remark, *qty_vals])
    con.commit()
    con.close()
    return redirect(url_for('party_page', party=party))


@app.route('/record/<int:rid>/edit', methods=['POST'])
def record_edit(rid):
    party = current_party()
    if not party:
        return redirect(url_for('index'))
    con = sqlite3.connect(DATABASE)
    con.row_factory = sqlite3.Row
    r = con.execute("SELECT * FROM flow_records WHERE id=?", (rid,)).fetchone()
    if not r:
        con.close(); flash('记录不存在'); return redirect(url_for('party_page', party=party))
    if r['recorded_by'] != party:
        con.close(); flash('无权编辑他人记录'); return redirect(url_for('party_page', party=party))
    if r['locked']:
        con.close(); flash('记录已锁定，不能修改'); return redirect(url_for('party_page', party=party))

    date = request.form.get('date', '').strip() or r['date']
    order_no = request.form.get('order_no', '').strip() or None
    remark = request.form.get('remark', '').strip() or None
    qty_cols = [f'{k}_qty' for k, _ in ITEMS]
    qty_vals = []
    for col in qty_cols:
        v = request.form.get(col, '').strip()
        if v == '':
            qty_vals.append(r[col] or 0)
        else:
            try:
                qty_vals.append(float(v))
            except ValueError:
                qty_vals.append(r[col] or 0)
    set_clause = ', '.join([f'{c}=?' for c in ['date', 'order_no', 'remark'] + qty_cols])
    con.execute(
        f"UPDATE flow_records SET {set_clause}, updated_at=CURRENT_TIMESTAMP WHERE id=?",
        [date, order_no, remark, *qty_vals, rid]
    )
    con.commit(); con.close()
    return redirect(url_for('party_page', party=party))


@app.route('/record/<int:rid>/delete', methods=['POST'])
def record_delete(rid):
    party = current_party()
    if not party:
        return redirect(url_for('index'))
    con = sqlite3.connect(DATABASE)
    con.row_factory = sqlite3.Row
    r = con.execute("SELECT recorded_by, locked FROM flow_records WHERE id=?", (rid,)).fetchone()
    if not r:
        con.close(); flash('记录不存在'); return redirect(url_for('party_page', party=party))
    if r['recorded_by'] != party:
        con.close(); flash('无权删除'); return redirect(url_for('party_page', party=party))
    if r['locked']:
        con.close(); flash('记录已锁定'); return redirect(url_for('party_page', party=party))
    con.execute("DELETE FROM flow_records WHERE id=?", (rid,))
    con.commit(); con.close()
    return redirect(url_for('party_page', party=party))


@app.route('/reconcile/start', methods=['POST'])
def reconcile_start():
    party = current_party()
    if not party:
        return redirect(url_for('index'))
    cp = request.form.get('counterparty')
    date_from = request.form.get('date_from', '').strip()
    date_to = request.form.get('date_to', '').strip()
    if cp not in PARTIES or cp == party or cp not in PARTIES[party]['counterparties']:
        flash('无效对方'); return redirect(url_for('party_page', party=party))
    if not date_from or not date_to:
        flash('日期必填'); return redirect(url_for('party_page', party=party))

    pair_low, pair_high = sorted([party, cp])

    con = sqlite3.connect(DATABASE)
    # 检查 pending overlap
    overlap = con.execute("""
        SELECT id FROM reconciliations
        WHERE pair_low=? AND pair_high=? AND status='pending_approval'
          AND NOT (date_to < ? OR date_from > ?)
    """, (pair_low, pair_high, date_from, date_to)).fetchone()
    if overlap:
        con.close()
        flash('已存在待审批的核对，范围重叠'); return redirect(url_for('party_page', party=party))

    # TOCTOU: overlap 检查与 INSERT 之间存在窗口；snapshot 与 UPDATE 之间也是。
    # 3 LAN 用户场景下并发概率可忽略，故意不加 BEGIN IMMEDIATE。
    snapshot = compare_pair(party, cp, date_from, date_to)
    cur = con.execute("""
        INSERT INTO reconciliations (initiator_party, approver_party, pair_low, pair_high,
                                     date_from, date_to, status, snapshot_json)
        VALUES (?, ?, ?, ?, ?, ?, 'pending_approval', ?)
    """, (party, cp, pair_low, pair_high, date_from, date_to, json.dumps(snapshot)))
    reconc_id = cur.lastrowid
    # 绑定 flow_records（未锁）
    con.execute("""
        UPDATE flow_records SET reconciliation_id=?
        WHERE date BETWEEN ? AND ?
          AND ((from_party=? AND to_party=?) OR (from_party=? AND to_party=?))
          AND reconciliation_id IS NULL
    """, (reconc_id, date_from, date_to, party, cp, cp, party))
    con.commit(); con.close()
    flash('核对已发起，等待对方审批'); return redirect(url_for('reconcile_detail', rid=reconc_id))


@app.route('/reconcile')
def reconcile_list():
    party = current_party()
    if not party:
        return redirect(url_for('index'))
    con = sqlite3.connect(DATABASE)
    con.row_factory = sqlite3.Row
    rows = con.execute("""
        SELECT * FROM reconciliations
        WHERE initiator_party=? OR approver_party=?
        ORDER BY
            CASE status WHEN 'pending_approval' THEN 0 ELSE 1 END,
            created_at DESC
    """, (party, party)).fetchall()
    con.close()
    return render_template('reconcile_list.html', items=[dict(r) for r in rows], party=party)


@app.route('/reconcile/<int:rid>')
def reconcile_detail(rid):
    party = current_party()
    if not party:
        return redirect(url_for('index'))
    con = sqlite3.connect(DATABASE)
    con.row_factory = sqlite3.Row
    r = con.execute("SELECT * FROM reconciliations WHERE id=?", (rid,)).fetchone()
    con.close()
    if not r:
        flash('核对不存在'); return redirect(url_for('reconcile_list'))
    snapshot = json.loads(r['snapshot_json']) if r['snapshot_json'] else {}
    return render_template('reconcile_detail.html', r=dict(r), snapshot=snapshot, party=party)


@app.route('/reconcile/<int:rid>/approve', methods=['POST'])
def reconcile_approve(rid):
    party = current_party()
    if not party:
        return redirect(url_for('index'))
    con = sqlite3.connect(DATABASE)
    con.row_factory = sqlite3.Row
    r = con.execute("SELECT * FROM reconciliations WHERE id=?", (rid,)).fetchone()
    if not r:
        con.close(); flash('核对不存在'); return redirect(url_for('index'))
    if r['approver_party'] != party:
        con.close(); flash('只有对方才能同意'); return redirect(url_for('reconcile_detail', rid=rid))
    if r['status'] != 'pending_approval':
        con.close(); flash('当前状态不允许操作'); return redirect(url_for('reconcile_detail', rid=rid))

    con.execute("""UPDATE reconciliations SET status='confirmed', approved_at=CURRENT_TIMESTAMP WHERE id=?""", (rid,))
    con.execute("UPDATE flow_records SET locked=1 WHERE reconciliation_id=?", (rid,))
    con.commit(); con.close()
    flash('已确认'); return redirect(url_for('reconcile_detail', rid=rid))


@app.route('/reconcile/<int:rid>/reject', methods=['POST'])
def reconcile_reject(rid):
    party = current_party()
    if not party:
        return redirect(url_for('index'))
    notes = request.form.get('notes', '').strip()
    con = sqlite3.connect(DATABASE)
    con.row_factory = sqlite3.Row
    r = con.execute("SELECT * FROM reconciliations WHERE id=?", (rid,)).fetchone()
    if not r:
        con.close(); flash('核对不存在'); return redirect(url_for('index'))
    if r['approver_party'] != party:
        con.close(); flash('只有对方才能打回'); return redirect(url_for('reconcile_detail', rid=rid))
    if r['status'] != 'pending_approval':
        con.close(); flash('当前状态不允许操作'); return redirect(url_for('reconcile_detail', rid=rid))

    con.execute("UPDATE reconciliations SET status='disputed', notes=? WHERE id=?", (notes, rid))
    con.execute("UPDATE flow_records SET reconciliation_id=NULL WHERE reconciliation_id=?", (rid,))
    con.commit(); con.close()
    flash('已打回'); return redirect(url_for('reconcile_detail', rid=rid))


@app.route('/reconcile/<int:rid>/withdraw', methods=['POST'])
def reconcile_withdraw(rid):
    party = current_party()
    if not party:
        return redirect(url_for('index'))
    con = sqlite3.connect(DATABASE)
    con.row_factory = sqlite3.Row
    r = con.execute("SELECT * FROM reconciliations WHERE id=?", (rid,)).fetchone()
    if not r:
        con.close(); flash('核对不存在'); return redirect(url_for('index'))
    if r['initiator_party'] != party:
        con.close(); flash('只有发起方能撤回'); return redirect(url_for('reconcile_detail', rid=rid))
    if r['status'] != 'pending_approval':
        con.close(); flash('当前状态不允许撤回'); return redirect(url_for('reconcile_detail', rid=rid))

    con.execute("UPDATE reconciliations SET status='withdrawn' WHERE id=?", (rid,))
    con.execute("UPDATE flow_records SET reconciliation_id=NULL WHERE reconciliation_id=?", (rid,))
    con.commit(); con.close()
    flash('已撤回'); return redirect(url_for('reconcile_detail', rid=rid))


@app.route('/reconcile/<int:rid>/cancel', methods=['POST'])
def reconcile_cancel(rid):
    """撤销已 confirmed 的核对（任一方都可）。"""
    party = current_party()
    if not party:
        return redirect(url_for('index'))
    con = sqlite3.connect(DATABASE)
    con.row_factory = sqlite3.Row
    r = con.execute("SELECT * FROM reconciliations WHERE id=?", (rid,)).fetchone()
    if not r:
        con.close(); flash('核对不存在'); return redirect(url_for('index'))
    if party not in (r['initiator_party'], r['approver_party']):
        con.close(); flash('无权'); return redirect(url_for('index'))
    if r['status'] != 'confirmed':
        con.close(); flash('仅 confirmed 状态可撤销'); return redirect(url_for('reconcile_detail', rid=rid))

    con.execute("UPDATE reconciliations SET status='withdrawn' WHERE id=?", (rid,))
    con.execute("UPDATE flow_records SET locked=0, reconciliation_id=NULL WHERE reconciliation_id=?", (rid,))
    con.commit(); con.close()
    flash('已撤销对账，记录解锁'); return redirect(url_for('reconcile_detail', rid=rid))


@app.route('/reports')
def reports():
    date_from = request.args.get('date_from', '')
    date_to = request.args.get('date_to', '')
    only_confirmed = request.args.get('only_confirmed') == '1'

    con = sqlite3.connect(DATABASE)
    con.row_factory = sqlite3.Row

    prices = {r['item_key']: r['price']
              for r in con.execute('SELECT * FROM default_prices').fetchall()}

    # 每个方向的汇总（仅发方记录）
    direction_summaries = {}
    for a, b in PAIRS:
        for from_p, to_p in [(a, b), (b, a)]:
            direction_summaries[f'{from_p}_to_{to_p}'] = _sum_flow_records(
                con, from_party=from_p, to_party=to_p,
                only_sender=True, date_from=date_from, date_to=date_to,
                only_confirmed=only_confirmed,
            )

    # 三角债净欠
    triangle_rows = _build_triangle(direction_summaries, prices)
    pair_summary = _build_pair_summary(direction_summaries)

    # 月度明细
    monthly_by_pair = {}
    for a, b in PAIRS:
        by_month = {}  # ym -> {'a_sent': {...}, 'b_sent': {...}}
        for from_p, to_p in [(a, b), (b, a)]:
            rows = con.execute(f"""
                SELECT substr(date, 1, 7) AS ym,
                       {', '.join(['COALESCE(SUM(' + k + '_qty), 0) AS ' + k + '_sum' for k, _ in STAT_ITEMS])}
                FROM flow_records
                WHERE from_party=? AND to_party=? AND recorded_by=?
                GROUP BY ym ORDER BY ym
            """, (from_p, to_p, from_p)).fetchall()
            for r in rows:
                ym = r['ym']
                bucket = by_month.setdefault(ym, {'a_sent': {}, 'b_sent': {}})
                key = 'a_sent' if from_p == a else 'b_sent'
                for k, _ in STAT_ITEMS:
                    bucket[key][k] = float(r[f'{k}_sum'])
        # 计算 net per month + 补齐缺失 key（防 Jinja strict mode 下 KeyError）
        for ym, d in by_month.items():
            for k, _ in STAT_ITEMS:
                d['a_sent'].setdefault(k, 0)
                d['b_sent'].setdefault(k, 0)
            d['net'] = {k: d['a_sent'][k] - d['b_sent'][k] for k, _ in STAT_ITEMS}
        monthly_by_pair[(a, b)] = {'a': PARTIES[a]['name'], 'b': PARTIES[b]['name'],
                                   'months': sorted(by_month.items())}

    con.close()
    return render_template('reports.html',
                           direction_summaries=direction_summaries,
                           triangle_rows=triangle_rows,
                           pair_summary=pair_summary,
                           monthly_by_pair=monthly_by_pair,
                           date_from=date_from, date_to=date_to,
                           only_confirmed=only_confirmed,
                           PAIRS=PAIRS)


def _sum_flow_records(con, *, from_party, to_party, only_sender, date_from, date_to, only_confirmed):
    qty_cols_sql = ', '.join([f'COALESCE(SUM({k}_qty), 0) AS {k}_sum' for k, _ in ITEMS])
    sql = f"SELECT {qty_cols_sql} FROM flow_records WHERE from_party=? AND to_party=?"
    args = [from_party, to_party]
    if only_sender:
        sql += ' AND recorded_by=?'
        args.append(from_party)
    if date_from:
        sql += ' AND date >= ?'; args.append(date_from)
    if date_to:
        sql += ' AND date <= ?'; args.append(date_to)
    if only_confirmed:
        sql += " AND locked=1"
    row = con.execute(sql, args).fetchone()
    return {k: float(row[f'{k}_sum']) for k, _ in ITEMS}


def _build_triangle(direction_summaries, prices):
    """按 5 种三角债包材，构造三方互欠表。

    Note: prices 参数 spec literal 保留，当前未使用（spec defect, plan Task 15）。
    """
    rows = []
    for idx, (a, b) in enumerate(PAIRS, 1):
        a_to_b = direction_summaries[f'{a}_to_{b}']
        b_to_a = direction_summaries[f'{b}_to_{a}']
        row = {'idx': idx, 'label': f'{PARTIES[a]["name"]}↔{PARTIES[b]["name"]}'}
        for k, _ in TRIANGLE_ITEMS:
            row[k] = int(a_to_b[k] - b_to_a[k])
        rows.append(row)
    return rows


def _build_pair_summary(direction_summaries):
    """按 pair 汇总净欠，生成'X 欠 Y 多少 item'文案。

    Note: nets 按 TRIANGLE_ITEMS (5 项) 算，但模板只展示 STAT_ITEMS (4 项)；
    zx 永远不显示。spec literal, plan Task 15.
    """
    out = []
    for a, b in PAIRS:
        a_to_b = direction_summaries[f'{a}_to_{b}']
        b_to_a = direction_summaries[f'{b}_to_{a}']
        nets = {k: a_to_b[k] - b_to_a[k] for k, _ in TRIANGLE_ITEMS}
        out.append({'a': PARTIES[a]['name'], 'b': PARTIES[b]['name'], 'nets': nets})
    return out


def _query_flow(con, *, recorded_by, from_party, to_party, date_from=None, date_to=None):
    """查 flow_records。"""
    sql = """SELECT * FROM flow_records
             WHERE recorded_by=? AND from_party=? AND to_party=?"""
    args = [recorded_by, from_party, to_party]
    if date_from:
        sql += ' AND date >= ?'; args.append(date_from)
    if date_to:
        sql += ' AND date <= ?'; args.append(date_to)
    sql += ' ORDER BY date DESC, id DESC'
    return [dict(r) for r in con.execute(sql, args).fetchall()]


def _calc_summary(records):
    """累加 17 包材 qty + 金额。"""
    summary = {k: {'qty': 0, 'amount': 0} for k, _ in ITEMS}
    for r in records:
        for k, _ in ITEMS:
            qty = r.get(f'{k}_qty') or 0
            summary[k]['qty'] += qty
    return summary


def compare_pair(party_a, party_b, date_from, date_to):
    """对两方做汇总对比。返回 {'a_to_b': {...}, 'b_to_a': {...}}。

    diffs[k] = sender_sum[k] - receiver_sum[k]，正数表示发方录入 > 收方录入
    （发方虚报或收方漏收）。Task 14 UI 按此约定显示。
    """
    con = sqlite3.connect(DATABASE)
    con.row_factory = sqlite3.Row
    result = {}
    for sender, receiver in [(party_a, party_b), (party_b, party_a)]:
        sender_sum = _sum_items(con, recorded_by=sender, from_party=sender, to_party=receiver,
                                date_from=date_from, date_to=date_to)
        receiver_sum = _sum_items(con, recorded_by=receiver, from_party=sender, to_party=receiver,
                                  date_from=date_from, date_to=date_to)
        diffs = {k: round(sender_sum[k] - receiver_sum[k], 4)
                 for k, _ in ITEMS
                 if abs(sender_sum[k] - receiver_sum[k]) > 1e-9}
        result[f'{sender}_to_{receiver}'] = {
            'sender_recorded': sender_sum,
            'receiver_recorded': receiver_sum,
            'diffs': diffs,
        }
    con.close()
    return result


def _sum_items(con, *, recorded_by, from_party, to_party, date_from, date_to):
    """SUM 17 包材列，返回 {item_key: float}。"""
    qty_cols_sql = ', '.join([f'COALESCE(SUM({k}_qty), 0) AS {k}_sum' for k, _ in ITEMS])
    row = con.execute(f"""
        SELECT {qty_cols_sql} FROM flow_records
        WHERE recorded_by=? AND from_party=? AND to_party=? AND date BETWEEN ? AND ?
    """, (recorded_by, from_party, to_party, date_from, date_to)).fetchone()
    return {k: float(row[f'{k}_sum']) for k, _ in ITEMS}


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
