from flask import Flask, render_template, request, redirect, url_for, jsonify, send_file
import sqlite3
import os
import io
import sys
import xlsxwriter

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


@app.route('/health')
def health():
    return {'status': 'ok'}

# 13种包材
ITEMS = [
    ('jx', '胶箱'), ('gx', '钙箱'), ('zx', '纸箱'),
    ('jkb', '胶卡板'), ('mkb', '木卡板'), ('xb', '小板'),
    ('dz', '袋子'), ('wb', '围布'), ('pk', '平卡'),
    ('xzx', '小纸箱'), ('dgb', '大盖板'), ('xjp', '小胶盆'),
    ('dk', '刀卡'),
]

# 月份统计的4种包材
STAT_ITEMS = [('mkb', '木卡板'), ('jkb', '胶卡板'), ('jx', '胶箱'), ('gx', '钙塑箱')]

# 三角债数量统计的5种包材
TRIANGLE_ITEMS = [('mkb', '木卡板'), ('jkb', '胶卡板'), ('jx', '胶箱'), ('gx', '钙塑箱'), ('zx', '纸箱')]

# 6个channel，每个板块双向
CHANNELS = {
    1: {'name': '华登 → 邵阳华登', 'from': '华登', 'to': '邵阳华登'},
    2: {'name': '邵阳华登 → 华登', 'from': '邵阳华登', 'to': '华登'},
    3: {'name': '华登 → 兴信', 'from': '华登', 'to': '兴信'},
    4: {'name': '兴信 → 华登', 'from': '兴信', 'to': '华登'},
    5: {'name': '邵阳华登 → 兴信', 'from': '邵阳华登', 'to': '兴信'},
    6: {'name': '兴信 → 邵阳华登', 'from': '兴信', 'to': '邵阳华登'},
}

# 3个板块，每个包含2个channel
SECTIONS = {
    1: {'name': '华登和邵阳华登包材往来', 'channels': [1, 2],
        'a': '华登', 'b': '邵阳华登'},
    2: {'name': '兴信和华登包材往来', 'channels': [4, 3],
        'a': '兴信', 'b': '华登'},
    3: {'name': '邵阳华登和兴信包材往来', 'channels': [5, 6],
        'a': '邵阳华登', 'b': '兴信'},
}


def get_db():
    db = sqlite3.connect(DATABASE)
    db.row_factory = sqlite3.Row
    return db


def init_db():
    db = get_db()
    item_cols = []
    for key, _ in ITEMS:
        item_cols.append(f'{key}_qty REAL DEFAULT 0')
        item_cols.append(f'{key}_price REAL DEFAULT 0')
        item_cols.append(f'{key}_amount REAL DEFAULT 0')

    db.execute(f'''CREATE TABLE IF NOT EXISTS records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        channel INTEGER NOT NULL,
        date TEXT NOT NULL,
        order_no TEXT DEFAULT '',
        {", ".join(item_cols)},
        remarks TEXT DEFAULT '',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )''')

    db.execute('''CREATE TABLE IF NOT EXISTS default_prices (
        item_key TEXT PRIMARY KEY,
        price REAL DEFAULT 0
    )''')

    db.execute('''CREATE TABLE IF NOT EXISTS inventory_counts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        channel INTEGER NOT NULL,
        year_month TEXT NOT NULL,
        mkb_actual REAL DEFAULT 0,
        jkb_actual REAL DEFAULT 0,
        jx_actual REAL DEFAULT 0,
        gx_actual REAL DEFAULT 0,
        mkb_expected REAL DEFAULT NULL,
        jkb_expected REAL DEFAULT NULL,
        jx_expected REAL DEFAULT NULL,
        gx_expected REAL DEFAULT NULL,
        remarks TEXT DEFAULT '',
        UNIQUE(channel, year_month)
    )''')

    db.execute('''CREATE TABLE IF NOT EXISTS investment_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        channel INTEGER NOT NULL,
        year_month TEXT NOT NULL,
        mkb_qty REAL DEFAULT 0, mkb_price REAL DEFAULT 0, mkb_amount REAL DEFAULT 0,
        jkb_qty REAL DEFAULT 0, jkb_price REAL DEFAULT 0, jkb_amount REAL DEFAULT 0,
        jx_qty REAL DEFAULT 0,  jx_price REAL DEFAULT 0,  jx_amount REAL DEFAULT 0,
        gx_qty REAL DEFAULT 0,  gx_price REAL DEFAULT 0,  gx_amount REAL DEFAULT 0,
        UNIQUE(channel, year_month)
    )''')
    # 兼容旧 DB: 若 investment_records 表已存在但没有 UNIQUE 约束，这里补一个索引
    db.execute('CREATE UNIQUE INDEX IF NOT EXISTS idx_inv_ch_ym ON investment_records(channel, year_month)')

    for key, _ in ITEMS:
        db.execute('INSERT OR IGNORE INTO default_prices (item_key, price) VALUES (?, 10)', (key,))
    db.commit()
    db.close()


# ==================== 辅助函数 ====================

def _get_records(db, ch, date_from='', date_to=''):
    query = 'SELECT * FROM records WHERE channel = ?'
    params = [ch]
    if date_from:
        query += ' AND date >= ?'
        params.append(date_from)
    if date_to:
        query += ' AND date <= ?'
        params.append(date_to)
    query += ' ORDER BY date DESC, id DESC'
    return [dict(r) for r in db.execute(query, params).fetchall()]


def _calc_summary(records):
    summary = {}
    grand_total = 0
    for key, name in ITEMS:
        total_qty = sum(r[f'{key}_qty'] or 0 for r in records)
        total_amount = sum(r[f'{key}_amount'] or 0 for r in records)
        summary[key] = {'qty': total_qty, 'amount': total_amount}
        grand_total += total_amount
    return summary, grand_total


def _build_stats(db, ch):
    inv_rows = db.execute(
        'SELECT * FROM inventory_counts WHERE channel = ? ORDER BY year_month', (ch,)
    ).fetchall()
    inv_dict = {row['year_month']: dict(row) for row in inv_rows}

    invest_rows = db.execute('''
        SELECT substr(year_month, 1, 7) as ym,
            SUM(mkb_qty) as mkb_total,
            SUM(jkb_qty) as jkb_total,
            SUM(jx_qty) as jx_total,
            SUM(gx_qty) as gx_total
        FROM investment_records WHERE channel = ?
        GROUP BY substr(year_month, 1, 7)
        ORDER BY substr(year_month, 1, 7)
    ''', (ch,)).fetchall()
    mt_dict = {row['ym']: dict(row) for row in invest_rows}

    record_months = [
        r['ym'] for r in db.execute(
            "SELECT DISTINCT strftime('%Y-%m', date) as ym FROM records WHERE channel = ? ORDER BY ym",
            (ch,)
        ).fetchall()
    ]

    all_months = sorted(set(list(inv_dict.keys()) + list(mt_dict.keys()) + record_months))

    stats_data = []
    for ym in all_months:
        inv = inv_dict.get(ym, {})
        totals = mt_dict.get(ym, {})

        year, month = int(ym[:4]), int(ym[5:7])
        prev_ym = f'{year - 1}-12' if month == 1 else f'{year}-{month - 1:02d}'
        prev_inv = inv_dict.get(prev_ym, {})

        stat = {'year_month': ym, 'item_data': {}, 'remarks': inv.get('remarks', '')}
        for key, _ in STAT_ITEMS:
            prev_actual = prev_inv.get(f'{key}_actual', 0) or 0
            investment = totals.get(f'{key}_total', 0) or 0
            calc_expected = prev_actual + investment
            override_expected = inv.get(f'{key}_expected')
            expected = override_expected if override_expected is not None else calc_expected
            actual = inv.get(f'{key}_actual', 0) or 0
            loss = actual - expected
            loss_pct = round(loss / expected * 100, 1) if expected else 0
            stat['item_data'][key] = {
                'prev_actual': prev_actual,
                'investment': investment,
                'expected': expected,
                'expected_override': override_expected is not None,
                'actual': actual,
                'loss': loss,
                'loss_pct': loss_pct,
            }
        stats_data.append(stat)
    return stats_data


# ==================== 页面路由 ====================

@app.route('/')
def index():
    return render_template('index.html', sections=SECTIONS)


@app.route('/section/<int:sec>')
def section(sec):
    if sec not in SECTIONS:
        return redirect(url_for('index'))
    db = get_db()
    sec_info = SECTIONS[sec]
    date_from = request.args.get('date_from', '')
    date_to = request.args.get('date_to', '')
    active_tab = request.args.get('tab', str(sec_info['channels'][0]))

    prices = {row['item_key']: row['price']
              for row in db.execute('SELECT * FROM default_prices').fetchall()}

    # 为每个方向构建数据
    directions = []
    for ch in sec_info['channels']:
        records = _get_records(db, ch, date_from, date_to)
        summary, grand_total = _calc_summary(records)
        stats_data = _build_stats(db, ch)
        inv_recs = [dict(r) for r in db.execute(
            'SELECT * FROM investment_records WHERE channel = ? ORDER BY year_month DESC, id DESC', (ch,)
        ).fetchall()]
        directions.append({
            'ch': ch,
            'channel': CHANNELS[ch],
            'records': records,
            'summary': summary,
            'grand_total': grand_total,
            'stats_data': stats_data,
            'investment_records': inv_recs,
        })

    db.close()
    return render_template('section.html',
                           sec=sec, sec_info=sec_info,
                           directions=directions,
                           items=ITEMS, stat_items=STAT_ITEMS,
                           prices=prices,
                           date_from=date_from, date_to=date_to,
                           active_tab=active_tab)


# ==================== 记录增删改 ====================

@app.route('/channel/<int:ch>/add', methods=['POST'])
def add_record(ch):
    if ch not in CHANNELS:
        return redirect(url_for('index'))
    sec = _ch_to_sec(ch)
    db = get_db()
    cols = ['channel', 'date', 'order_no']
    vals = [ch, request.form.get('date', ''), request.form.get('order_no', '')]
    for key, _ in ITEMS:
        qty = float(request.form.get(f'{key}_qty', 0) or 0)
        price = float(request.form.get(f'{key}_price', 0) or 0)
        amount = round(qty * price, 2)
        cols.extend([f'{key}_qty', f'{key}_price', f'{key}_amount'])
        vals.extend([qty, price, amount])
    cols.append('remarks')
    vals.append(request.form.get('remarks', ''))
    placeholders = ', '.join(['?'] * len(vals))
    db.execute(f'INSERT INTO records ({", ".join(cols)}) VALUES ({placeholders})', vals)
    db.commit()
    db.close()
    return redirect(url_for('section', sec=sec, tab=ch))


@app.route('/channel/<int:ch>/edit/<int:record_id>', methods=['POST'])
def edit_record(ch, record_id):
    if ch not in CHANNELS:
        return redirect(url_for('index'))
    sec = _ch_to_sec(ch)
    db = get_db()
    sets = ['date = ?', 'order_no = ?']
    vals = [request.form.get('date', ''), request.form.get('order_no', '')]
    for key, _ in ITEMS:
        qty = float(request.form.get(f'{key}_qty', 0) or 0)
        price = float(request.form.get(f'{key}_price', 0) or 0)
        amount = round(qty * price, 2)
        sets.extend([f'{key}_qty = ?', f'{key}_price = ?', f'{key}_amount = ?'])
        vals.extend([qty, price, amount])
    sets.append('remarks = ?')
    vals.append(request.form.get('remarks', ''))
    vals.append(record_id)
    db.execute(f'UPDATE records SET {", ".join(sets)} WHERE id = ?', vals)
    db.commit()
    db.close()
    return redirect(url_for('section', sec=sec, tab=ch))


@app.route('/channel/<int:ch>/delete/<int:record_id>', methods=['POST'])
def delete_record(ch, record_id):
    if ch not in CHANNELS:
        return redirect(url_for('index'))
    sec = _ch_to_sec(ch)
    db = get_db()
    db.execute('DELETE FROM records WHERE id = ? AND channel = ?', (record_id, ch))
    db.commit()
    db.close()
    return redirect(url_for('section', sec=sec, tab=ch))


def _ch_to_sec(ch):
    for sec_id, sec_info in SECTIONS.items():
        if ch in sec_info['channels']:
            return sec_id
    return 1


# ==================== 盘点实存数 ====================

@app.route('/channel/<int:ch>/inventory', methods=['POST'])
def save_inventory(ch):
    if ch not in CHANNELS:
        return redirect(url_for('index'))
    sec = _ch_to_sec(ch)
    db = get_db()
    year_month = request.form.get('year_month', '')
    if year_month:
        db.execute('''INSERT INTO inventory_counts
            (channel, year_month, mkb_actual, jkb_actual, jx_actual, gx_actual, remarks)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(channel, year_month) DO UPDATE SET
                mkb_actual = excluded.mkb_actual,
                jkb_actual = excluded.jkb_actual,
                jx_actual = excluded.jx_actual,
                gx_actual = excluded.gx_actual,
                remarks = excluded.remarks
        ''', (
            ch, year_month,
            float(request.form.get('mkb_actual', 0) or 0),
            float(request.form.get('jkb_actual', 0) or 0),
            float(request.form.get('jx_actual', 0) or 0),
            float(request.form.get('gx_actual', 0) or 0),
            request.form.get('inv_remarks', ''),
        ))
        db.commit()
    db.close()
    return redirect(url_for('section', sec=sec, tab=ch))


# ==================== 投资记录 ====================

@app.route('/channel/<int:ch>/add-investment', methods=['POST'])
def add_investment_record(ch):
    if ch not in CHANNELS:
        return redirect(url_for('index'))
    sec = _ch_to_sec(ch)
    db = get_db()
    year_month = request.form.get('year_month', '')[:7]
    if year_month:
        cols = ['channel', 'year_month']
        vals = [ch, year_month]
        set_parts = []
        for key in ['mkb', 'jkb', 'jx', 'gx']:
            qty = float(request.form.get(f'{key}_qty', 0) or 0)
            price = float(request.form.get(f'{key}_price', 0) or 0)
            amount = round(qty * price, 2)
            cols += [f'{key}_qty', f'{key}_price', f'{key}_amount']
            vals += [qty, price, amount]
            # 同月再录入: qty/amount 累加，price 用加权平均重算
            set_parts += [
                f'{key}_qty = {key}_qty + excluded.{key}_qty',
                f'{key}_amount = {key}_amount + excluded.{key}_amount',
                f'{key}_price = CASE WHEN ({key}_qty + excluded.{key}_qty) > 0 '
                f'THEN ROUND(({key}_amount + excluded.{key}_amount) / ({key}_qty + excluded.{key}_qty), 4) '
                f'ELSE excluded.{key}_price END',
            ]
        placeholders = ', '.join(['?'] * len(vals))
        sql = (
            f'INSERT INTO investment_records ({", ".join(cols)}) VALUES ({placeholders}) '
            f'ON CONFLICT(channel, year_month) DO UPDATE SET {", ".join(set_parts)}'
        )
        db.execute(sql, vals)
        db.commit()
    db.close()
    return redirect(url_for('section', sec=sec, tab=ch))


@app.route('/channel/<int:ch>/delete-investment/<int:inv_id>', methods=['POST'])
def delete_investment_record(ch, inv_id):
    if ch not in CHANNELS:
        return redirect(url_for('index'))
    sec = _ch_to_sec(ch)
    db = get_db()
    db.execute('DELETE FROM investment_records WHERE id = ? AND channel = ?', (inv_id, ch))
    db.commit()
    db.close()
    return redirect(url_for('section', sec=sec, tab=ch))


@app.route('/channel/<int:ch>/month/<year_month>/delete', methods=['POST'])
def delete_month(ch, year_month):
    if ch not in CHANNELS:
        return redirect(url_for('index'))
    sec = _ch_to_sec(ch)
    db = get_db()
    db.execute('DELETE FROM inventory_counts WHERE channel = ? AND year_month = ?', (ch, year_month))
    db.execute('DELETE FROM investment_records WHERE channel = ? AND year_month = ?', (ch, year_month))
    db.commit()
    db.close()
    return redirect(url_for('section', sec=sec, tab=ch))


@app.route('/channel/<int:ch>/month/<year_month>/update', methods=['POST'])
def update_month(ch, year_month):
    if ch not in CHANNELS:
        return redirect(url_for('index'))
    sec = _ch_to_sec(ch)
    db = get_db()

    # 计算上月年月
    year, month = int(year_month[:4]), int(year_month[5:7])
    prev_ym = f'{year - 1}-12' if month == 1 else f'{year}-{month - 1:02d}'

    # 更新上月实存数
    db.execute('''INSERT INTO inventory_counts
        (channel, year_month, mkb_actual, jkb_actual, jx_actual, gx_actual, remarks)
        VALUES (?, ?, ?, ?, ?, ?, '')
        ON CONFLICT(channel, year_month) DO UPDATE SET
            mkb_actual = excluded.mkb_actual,
            jkb_actual = excluded.jkb_actual,
            jx_actual = excluded.jx_actual,
            gx_actual = excluded.gx_actual
    ''', (
        ch, prev_ym,
        float(request.form.get('mkb_prev_actual', 0) or 0),
        float(request.form.get('jkb_prev_actual', 0) or 0),
        float(request.form.get('jx_prev_actual', 0) or 0),
        float(request.form.get('gx_prev_actual', 0) or 0),
    ))

    # 更新本月实存数和应存数override
    def _none_or_float(val):
        return float(val) if val not in ('', None) else None

    mkb_exp = _none_or_float(request.form.get('mkb_expected', ''))
    jkb_exp = _none_or_float(request.form.get('jkb_expected', ''))
    jx_exp  = _none_or_float(request.form.get('jx_expected', ''))
    gx_exp  = _none_or_float(request.form.get('gx_expected', ''))

    db.execute('''INSERT INTO inventory_counts
        (channel, year_month, mkb_actual, jkb_actual, jx_actual, gx_actual,
         mkb_expected, jkb_expected, jx_expected, gx_expected, remarks)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(channel, year_month) DO UPDATE SET
            mkb_actual = excluded.mkb_actual,
            jkb_actual = excluded.jkb_actual,
            jx_actual  = excluded.jx_actual,
            gx_actual  = excluded.gx_actual,
            mkb_expected = excluded.mkb_expected,
            jkb_expected = excluded.jkb_expected,
            jx_expected  = excluded.jx_expected,
            gx_expected  = excluded.gx_expected,
            remarks = excluded.remarks
    ''', (
        ch, year_month,
        float(request.form.get('mkb_actual', 0) or 0),
        float(request.form.get('jkb_actual', 0) or 0),
        float(request.form.get('jx_actual', 0) or 0),
        float(request.form.get('gx_actual', 0) or 0),
        mkb_exp, jkb_exp, jx_exp, gx_exp,
        request.form.get('remarks', ''),
    ))

    # 更新投资（删除该月旧记录，重新插入）
    db.execute('DELETE FROM investment_records WHERE channel = ? AND year_month = ?', (ch, year_month))
    invest_vals = [ch, year_month]
    invest_cols = ['channel', 'year_month']
    for key in ['mkb', 'jkb', 'jx', 'gx']:
        qty = float(request.form.get(f'{key}_qty', 0) or 0)
        price = float(request.form.get(f'{key}_price', 0) or 0)
        amount = round(qty * price, 2)
        invest_cols += [f'{key}_qty', f'{key}_price', f'{key}_amount']
        invest_vals += [qty, price, amount]
    ph = ', '.join(['?'] * len(invest_vals))
    db.execute(f'INSERT INTO investment_records ({", ".join(invest_cols)}) VALUES ({ph})', invest_vals)
    db.commit()
    db.close()
    return redirect(url_for('section', sec=sec, tab=ch))


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


# ==================== 汇总报表 ====================

@app.route('/reports')
def reports():
    db = get_db()
    date_from = request.args.get('date_from', '')
    date_to = request.args.get('date_to', '')
    tri_date_from = request.args.get('tri_date_from', '')  # 三角债表单独开始日期
    tri_date_to = request.args.get('tri_date_to', '')      # 三角债表单独截止日期

    channel_summaries = {}
    for ch in CHANNELS:
        records = _get_records(db, ch, date_from, date_to)
        summary, total = _calc_summary(records)
        channel_summaries[ch] = {'summary': summary, 'total': total}

    # 三角债专用channel_summaries（使用独立日期范围）
    tri_channel_summaries = {}
    for ch in CHANNELS:
        records = _get_records(db, ch, tri_date_from, tri_date_to)
        summary, total = _calc_summary(records)
        tri_channel_summaries[ch] = {'summary': summary, 'total': total}

    # ── 三角债总结（基于tri_channel_summaries）────────────────
    TRI_KEYS = [k for k, _ in STAT_ITEMS]  # mkb jkb jx gx
    PAIRS = [
        {'a': '华登',     'b': '邵阳华登', 'ch_a': 1, 'ch_b': 2},
        {'a': '华登',     'b': '兴信',     'ch_a': 3, 'ch_b': 4},
        {'a': '邵阳华登', 'b': '兴信',     'ch_a': 5, 'ch_b': 6},
    ]
    tri_pair_summary = []
    for p in PAIRS:
        total_net = {}
        for k in TRI_KEYS:
            a_qty = tri_channel_summaries[p['ch_a']]['summary'][k]['qty']
            b_qty = tri_channel_summaries[p['ch_b']]['summary'][k]['qty']
            total_net[k] = a_qty - b_qty  # >0: B欠A; <0: A欠B
        tri_pair_summary.append({'a': p['a'], 'b': p['b'], 'total_net': total_net})

    # ── 三角债净欠量（按月 + 汇总）────────────────────────────

    def _monthly_qty(ch):
        q = 'SELECT strftime("%Y-%m", date) as ym, SUM(mkb_qty) as mkb, SUM(jkb_qty) as jkb, SUM(jx_qty) as jx, SUM(gx_qty) as gx FROM records WHERE channel=?'
        params = [ch]
        if date_from:
            q += ' AND date >= ?'; params.append(date_from)
        if date_to:
            q += ' AND date <= ?'; params.append(date_to)
        q += ' GROUP BY ym ORDER BY ym'
        return {r['ym']: dict(r) for r in db.execute(q, params).fetchall()}

    ch_monthly = {ch: _monthly_qty(ch) for ch in CHANNELS}

    # ── 三角债汇总表（6行净欠） ──────────────────────────────
    DISPLAY_PAIRS = [
        {'a': '邵阳华登', 'b': '兴信', 'ch_a': 5, 'ch_b': 6},
        {'a': '华登',     'b': '兴信', 'ch_a': 3, 'ch_b': 4},
        {'a': '邵阳华登', 'b': '华登', 'ch_a': 2, 'ch_b': 1},
    ]
    triangle_display = []
    idx = 1
    for dp in DISPLAY_PAIRS:
        net = {}
        for k in TRI_KEYS:
            a_qty = tri_channel_summaries[dp['ch_a']]['summary'][k]['qty']
            b_qty = tri_channel_summaries[dp['ch_b']]['summary'][k]['qty']
            net[k] = a_qty - b_qty   # >0: B欠A; <0: A欠B
        # A欠B行
        row_ab = {'idx': idx, 'label': f"{dp['a']}欠{dp['b']}"}
        for k in TRI_KEYS:
            row_ab[k] = int(-net[k]) if net[k] < 0 else None
        triangle_display.append(row_ab)
        idx += 1
        # B欠A行
        row_ba = {'idx': idx, 'label': f"{dp['b']}欠{dp['a']}"}
        for k in TRI_KEYS:
            row_ba[k] = int(net[k]) if net[k] > 0 else None
        triangle_display.append(row_ba)
        idx += 1

    pair_stats = []
    for p in PAIRS:
        ca, cb = p['ch_a'], p['ch_b']
        all_ym = sorted(set(ch_monthly[ca]) | set(ch_monthly[cb]))
        months = []
        total_net = {k: 0 for k in TRI_KEYS}
        total_a   = {k: 0 for k in TRI_KEYS}
        total_b   = {k: 0 for k in TRI_KEYS}
        for ym in all_ym:
            ad = ch_monthly[ca].get(ym, {})
            bd = ch_monthly[cb].get(ym, {})
            row = {'ym': ym, 'data': {}}
            for k in TRI_KEYS:
                a = ad.get(k, 0) or 0
                b = bd.get(k, 0) or 0
                net = a - b          # 正数：B欠A；负数：A欠B
                row['data'][k] = {'a': a, 'b': b, 'net': net}
                total_net[k] += net
                total_a[k]   += a
                total_b[k]   += b
            months.append(row)

        # 生成结论文字
        conclusions = []
        for k, name in STAT_ITEMS:
            n = total_net[k]
            if n > 0:
                conclusions.append(f'{p["b"]}欠{p["a"]} {name} {int(n)} 个')
            elif n < 0:
                conclusions.append(f'{p["a"]}欠{p["b"]} {name} {int(-n)} 个')
        pair_stats.append({
            'a': p['a'], 'b': p['b'],
            'months': months,
            'total_net': total_net,
            'total_a': total_a,
            'total_b': total_b,
            'conclusions': conclusions,
        })

    # ── 三角债数量统计（6方向）────────────────────────────────
    triangle_qty = []
    for idx, ch in enumerate([1, 2, 3, 4, 5, 6], 1):
        row = {'idx': idx, 'label': CHANNELS[ch]['from'] + ' → ' + CHANNELS[ch]['to']}
        s = channel_summaries[ch]['summary']
        for key, _ in TRIANGLE_ITEMS:
            row[key] = s[key]['qty']
        triangle_qty.append(row)

    # ── 三角债金额报表 ────────────────────────────────────────
    hd_sy_net = channel_summaries[1]['total'] - channel_summaries[2]['total']
    hd_xx_net = channel_summaries[3]['total'] - channel_summaries[4]['total']
    sy_xx_net = channel_summaries[5]['total'] - channel_summaries[6]['total']
    triangle = {
        'flows': [
            {'label': '华登 → 邵阳华登', 'amount': channel_summaries[1]['total']},
            {'label': '邵阳华登 → 华登',  'amount': channel_summaries[2]['total']},
            {'label': '华登 → 兴信',      'amount': channel_summaries[3]['total']},
            {'label': '兴信 → 华登',      'amount': channel_summaries[4]['total']},
            {'label': '邵阳华登 → 兴信',  'amount': channel_summaries[5]['total']},
            {'label': '兴信 → 邵阳华登',  'amount': channel_summaries[6]['total']},
        ],
        'pair_net': [
            {'a': '华登',     'b': '邵阳华登', 'net': round(hd_sy_net, 2)},
            {'a': '华登',     'b': '兴信',     'net': round(hd_xx_net, 2)},
            {'a': '邵阳华登', 'b': '兴信',     'net': round(sy_xx_net, 2)},
        ],
        'net': {
            '华登':     round(hd_sy_net + hd_xx_net, 2),
            '邵阳华登': round(sy_xx_net - hd_sy_net, 2),
            '兴信':     round(-(hd_xx_net + sy_xx_net), 2),
        }
    }

    # 判断三角债是否全部清零
    all_cleared = all(
        row[k] is None or row[k] == 0
        for row in triangle_display
        for k in TRI_KEYS
    )

    from datetime import date as _date
    today = _date.today().strftime('%Y/%m/%d')
    db.close()
    return render_template('reports.html',
                           sections=SECTIONS, channels=CHANNELS, items=ITEMS,
                           channel_summaries=channel_summaries,
                           stat_items=STAT_ITEMS,
                           pair_stats=pair_stats,
                           triangle_display=triangle_display,
                           all_cleared=all_cleared,
                           triangle_qty=triangle_qty,
                           triangle_items=TRIANGLE_ITEMS,
                           triangle=triangle,
                           today=today,
                           date_from=date_from, date_to=date_to,
                           tri_date_from=tri_date_from, tri_date_to=tri_date_to,
                           tri_pair_summary=tri_pair_summary)


# ==================== 导出 Excel ====================

@app.route('/export/channel/<int:ch>')
def export_channel(ch):
    if ch not in CHANNELS:
        return redirect(url_for('index'))
    db = get_db()
    records = db.execute('SELECT * FROM records WHERE channel = ? ORDER BY date ASC', (ch,)).fetchall()

    from datetime import datetime as _dt

    output = io.BytesIO()
    wb = xlsxwriter.Workbook(output)
    ws = wb.add_worksheet('流水记录')

    total_cols = 2 + len(ITEMS) + 1  # 日期+收订单号+13包材+备注

    # 格式定义
    title_fmt  = wb.add_format({'bold': True, 'font_size': 14,
                                'bg_color': '#C4D79B', 'border': 0, 'valign': 'vcenter'})
    header_fmt = wb.add_format({'bold': True, 'align': 'center', 'valign': 'vcenter',
                                'bg_color': '#C4D79B', 'border': 1, 'font_size': 10})
    data_fmt   = wb.add_format({'align': 'center', 'valign': 'vcenter',
                                'bg_color': '#FFFFCC', 'border': 1})
    data_left  = wb.add_format({'align': 'left', 'valign': 'vcenter',
                                'bg_color': '#FFFFCC', 'border': 1})
    num_fmt    = wb.add_format({'align': 'center', 'valign': 'vcenter',
                                'bg_color': '#FFFFCC', 'border': 1, 'num_format': '0'})
    total_fmt  = wb.add_format({'bold': True, 'align': 'center', 'valign': 'vcenter',
                                'bg_color': '#FFFF00', 'border': 1, 'num_format': '0'})
    total_lbl  = wb.add_format({'bold': True, 'align': 'center', 'valign': 'vcenter',
                                'bg_color': '#FFFF00', 'border': 1})
    empty_fmt  = wb.add_format({'bg_color': '#FFFFCC', 'border': 1})

    # 列宽
    ws.set_column(0, 0, 8)   # 日期
    ws.set_column(1, 1, 10)  # 收订单号
    ws.set_column(2, 2 + len(ITEMS) - 1, 6)  # 包材
    ws.set_column(2 + len(ITEMS), 2 + len(ITEMS), 8)  # 备注
    ws.set_default_row(15)

    # 行0：标题
    title = f"{CHANNELS[ch]['from']}发{CHANNELS[ch]['to']}"
    ws.merge_range(0, 0, 0, total_cols - 1, title, title_fmt)
    ws.set_row(0, 22)

    # 行1：表头
    ws.write(1, 0, '日期', header_fmt)
    ws.write(1, 1, '收订单号', header_fmt)
    for ci, (_, name) in enumerate(ITEMS, 2):
        ws.write(1, ci, name, header_fmt)
    ws.write(1, 2 + len(ITEMS), '备注', header_fmt)
    ws.set_row(1, 18)

    # 数据行（从行2开始）
    for r, rec in enumerate(records, 2):
        # 日期格式：3月2日
        try:
            d = _dt.strptime(rec['date'], '%Y-%m-%d')
            date_str = f'{d.month}月{d.day}日'
        except Exception:
            date_str = rec['date'] or ''
        ws.write(r, 0, date_str, data_fmt)
        ws.write(r, 1, rec['order_no'] or '', data_fmt)
        for ci, (key, _) in enumerate(ITEMS, 2):
            v = rec[f'{key}_qty'] or 0
            ws.write(r, ci, int(v) if v else '', num_fmt)
        ws.write(r, 2 + len(ITEMS), rec['remarks'] or '', data_left)

    # 合计行
    total_row = 2 + len(records)
    ws.write(total_row, 0, '', total_lbl)
    ws.write(total_row, 1, '合计：', total_lbl)
    for ci, (key, _) in enumerate(ITEMS, 2):
        total = sum(int(rec[f'{key}_qty'] or 0) for rec in records)
        ws.write(total_row, ci, total, total_fmt)
    ws.write(total_row, 2 + len(ITEMS), '', total_lbl)
    ws.set_row(total_row, 18)

    wb.close()
    output.seek(0)
    db.close()
    filename = f"{CHANNELS[ch]['from']}到{CHANNELS[ch]['to']}_流水.xlsx"
    return send_file(output, as_attachment=True, download_name=filename,
                     mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')


@app.route('/export/reports')
def export_reports():
    db = get_db()
    output = io.BytesIO()
    wb = xlsxwriter.Workbook(output)
    bold = wb.add_format({'bold': True, 'bg_color': '#D9E1F2', 'border': 1})
    cell_fmt = wb.add_format({'border': 1})
    num_fmt = wb.add_format({'border': 1, 'num_format': '#,##0.00'})

    for ch, info in CHANNELS.items():
        ws = wb.add_worksheet(f"{info['from']}到{info['to']}")
        records = db.execute('SELECT * FROM records WHERE channel = ? ORDER BY date DESC', (ch,)).fetchall()
        headers = ['包材', '总数量', '总金额']
        for c, h in enumerate(headers):
            ws.write(0, c, h, bold)
        for r, (key, name) in enumerate(ITEMS, 1):
            total_qty = sum(rec[f'{key}_qty'] or 0 for rec in records)
            total_amount = sum(rec[f'{key}_amount'] or 0 for rec in records)
            ws.write(r, 0, name, cell_fmt)
            ws.write(r, 1, total_qty, num_fmt)
            ws.write(r, 2, total_amount, num_fmt)

    wb.close()
    output.seek(0)
    db.close()
    return send_file(output, as_attachment=True, download_name='汇总报表.xlsx',
                     mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')


@app.route('/export/triangle-qty')
def export_triangle_qty():
    db = get_db()
    output = io.BytesIO()
    wb = xlsxwriter.Workbook(output)
    bold = wb.add_format({'bold': True, 'bg_color': '#D9E1F2', 'border': 1})
    cell_fmt = wb.add_format({'border': 1})
    num_fmt = wb.add_format({'border': 1, 'num_format': '#,##0'})

    ws = wb.add_worksheet('三角债数量统计')
    headers = ['序号', '车间'] + [name for _, name in TRIANGLE_ITEMS]
    for c, h in enumerate(headers):
        ws.write(0, c, h, bold)

    for idx, ch in enumerate([1, 2, 3, 4, 5, 6], 1):
        records = db.execute('SELECT * FROM records WHERE channel = ?', (ch,)).fetchall()
        ws.write(idx, 0, idx, cell_fmt)
        ws.write(idx, 1, CHANNELS[ch]['from'] + ' → ' + CHANNELS[ch]['to'], cell_fmt)
        for ci, (key, _) in enumerate(TRIANGLE_ITEMS):
            total_qty = sum(r[f'{key}_qty'] or 0 for r in records)
            ws.write(idx, 2 + ci, total_qty, num_fmt)

    wb.close()
    output.seek(0)
    db.close()
    return send_file(output, as_attachment=True, download_name='三角债数量统计.xlsx',
                     mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')


@app.route('/export/triangle-display')
def export_triangle_display():
    tri_date_from = request.args.get('tri_date_from', '')
    tri_date_to   = request.args.get('tri_date_to', '')

    db = get_db()
    tri_cs = {}
    for ch in CHANNELS:
        records = _get_records(db, ch, tri_date_from, tri_date_to)
        summary, total = _calc_summary(records)
        tri_cs[ch] = {'summary': summary, 'total': total}
    db.close()

    TRI_KEYS = [k for k, _ in STAT_ITEMS]
    DISPLAY_PAIRS = [
        {'a': '邵阳华登', 'b': '兴信', 'ch_a': 5, 'ch_b': 6},
        {'a': '华登',     'b': '兴信', 'ch_a': 3, 'ch_b': 4},
        {'a': '邵阳华登', 'b': '华登', 'ch_a': 2, 'ch_b': 1},
    ]
    PAIRS = [
        {'a': '华登',     'b': '邵阳华登', 'ch_a': 1, 'ch_b': 2},
        {'a': '华登',     'b': '兴信',     'ch_a': 3, 'ch_b': 4},
        {'a': '邵阳华登', 'b': '兴信',     'ch_a': 5, 'ch_b': 6},
    ]

    # 6行净欠表
    triangle_display = []
    idx = 1
    for dp in DISPLAY_PAIRS:
        net = {}
        for k in TRI_KEYS:
            a_qty = tri_cs[dp['ch_a']]['summary'][k]['qty']
            b_qty = tri_cs[dp['ch_b']]['summary'][k]['qty']
            net[k] = a_qty - b_qty
        row_ab = {'idx': idx, 'label': f"{dp['a']}欠{dp['b']}"}
        for k in TRI_KEYS:
            row_ab[k] = int(-net[k]) if net[k] < 0 else None
        triangle_display.append(row_ab)
        idx += 1
        row_ba = {'idx': idx, 'label': f"{dp['b']}欠{dp['a']}"}
        for k in TRI_KEYS:
            row_ba[k] = int(net[k]) if net[k] > 0 else None
        triangle_display.append(row_ba)
        idx += 1

    # 债务往来总结
    tri_pair_summary = []
    for p in PAIRS:
        total_net = {}
        for k in TRI_KEYS:
            a_qty = tri_cs[p['ch_a']]['summary'][k]['qty']
            b_qty = tri_cs[p['ch_b']]['summary'][k]['qty']
            total_net[k] = a_qty - b_qty
        tri_pair_summary.append({'a': p['a'], 'b': p['b'], 'total_net': total_net})

    all_cleared = all(
        row[k] is None or row[k] == 0
        for row in triangle_display
        for k in TRI_KEYS
    )

    from datetime import date as _date
    cutoff = tri_date_to or _date.today().strftime('%Y/%m/%d')

    output = io.BytesIO()
    wb = xlsxwriter.Workbook(output)

    title_fmt  = wb.add_format({'bold': True, 'font_size': 14, 'align': 'center', 'valign': 'vcenter', 'bg_color': '#FFD966', 'border': 1})
    sub_fmt    = wb.add_format({'font_size': 10, 'align': 'center', 'bg_color': '#FFD966', 'border': 1})
    header_fmt = wb.add_format({'bold': True, 'align': 'center', 'valign': 'vcenter', 'border': 1, 'bg_color': '#F2F2F2'})
    cell_fmt   = wb.add_format({'align': 'center', 'valign': 'vcenter', 'border': 1})
    num_fmt    = wb.add_format({'align': 'center', 'valign': 'vcenter', 'border': 1, 'num_format': '#,##0'})
    red_fmt    = wb.add_format({'bold': True, 'align': 'center', 'font_color': '#CC0000', 'bg_color': '#FFE0E0', 'border': 1})
    green_fmt  = wb.add_format({'bold': True, 'align': 'center', 'font_color': '#1A7A1A', 'bg_color': '#E2FFE2', 'border': 1})
    sum_hdr    = wb.add_format({'bold': True, 'font_size': 11, 'border': 1, 'bg_color': '#D9E1F2'})
    ok_fmt     = wb.add_format({'align': 'center', 'font_color': '#1A7A1A', 'border': 1})
    debt_fmt   = wb.add_format({'font_color': '#CC0000', 'border': 1})

    ws = wb.add_worksheet('往来统计表')
    stat_names = [name for _, name in STAT_ITEMS]
    col_count  = 2 + len(STAT_ITEMS) + 1  # 序号+车间+4包材+备注

    ws.set_column(0, 0, 6)
    ws.set_column(1, 1, 18)
    ws.set_column(2, 2 + len(STAT_ITEMS) - 1, 12)
    ws.set_column(2 + len(STAT_ITEMS), 2 + len(STAT_ITEMS), 10)

    # 标题
    ws.merge_range(0, 0, 0, col_count - 1, '各车间包材相互往来数量统计表', title_fmt)
    ws.set_row(0, 28)
    ws.merge_range(1, 0, 1, col_count - 1, f'截止到 {cutoff}', sub_fmt)

    # 表头
    headers = ['序号', '车间'] + stat_names + ['备注']
    for c, h in enumerate(headers):
        ws.write(2, c, h, header_fmt)

    # 6行数据
    for r, row in enumerate(triangle_display, 3):
        ws.write(r, 0, row['idx'], cell_fmt)
        ws.write(r, 1, row['label'], cell_fmt)
        for ci, (k, _) in enumerate(STAT_ITEMS):
            v = row[k]
            ws.write(r, 2 + ci, v if v else '', num_fmt if v else cell_fmt)
        ws.write(r, 2 + len(STAT_ITEMS), '', cell_fmt)

    # 底部状态行
    status_row = 3 + len(triangle_display)
    status_text = '各车间往来三角债数据已相互清数' if all_cleared else '各车间往来三角债尚有未清数据，请核查上表'
    ws.merge_range(status_row, 0, status_row, col_count - 1, status_text, green_fmt if all_cleared else red_fmt)

    # 日期行
    date_row = status_row + 1
    ws.merge_range(date_row, 0, date_row, col_count - 1, cutoff, wb.add_format({'align': 'right', 'border': 1}))

    # 空行
    summary_start = date_row + 2

    # 债务往来总结标题
    ws.merge_range(summary_start, 0, summary_start, col_count - 1, '债务往来总结', sum_hdr)
    ws.set_row(summary_start, 20)

    r = summary_start + 1
    for p in tri_pair_summary:
        all_zero = all(p['total_net'][k] == 0 for k in TRI_KEYS)
        ws.merge_range(r, 0, r, 1, f"{p['a']} ↔ {p['b']}", wb.add_format({'bold': True, 'border': 1, 'bg_color': '#E8F0FE'}))
        if all_zero:
            ws.merge_range(r, 2, r, col_count - 1, '✓ 已结清', ok_fmt)
        else:
            debts = []
            for k, name in STAT_ITEMS:
                n = p['total_net'][k]
                if n > 0:
                    debts.append(f"{p['b']}欠{p['a']} {name} {int(n)} 个")
                elif n < 0:
                    debts.append(f"{p['a']}欠{p['b']} {name} {int(-n)} 个")
            ws.merge_range(r, 2, r, col_count - 1, '；'.join(debts), debt_fmt)
        r += 1

    wb.close()
    output.seek(0)
    return send_file(output, as_attachment=True, download_name='各车间往来统计表.xlsx',
                     mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')


@app.route('/export/triangle')
def export_triangle():
    db = get_db()
    totals = {}
    for ch in CHANNELS:
        records = db.execute('SELECT * FROM records WHERE channel = ?', (ch,)).fetchall()
        totals[ch] = sum(sum(r[f'{key}_amount'] or 0 for r in records) for key, _ in ITEMS)

    hd_sy = totals[1] - totals[2]
    hd_xx = totals[3] - totals[4]
    sy_xx = totals[5] - totals[6]

    output = io.BytesIO()
    wb = xlsxwriter.Workbook(output)
    bold = wb.add_format({'bold': True, 'bg_color': '#D9E1F2', 'border': 1})
    cell_fmt = wb.add_format({'border': 1})
    num_fmt = wb.add_format({'border': 1, 'num_format': '#,##0.00'})

    ws = wb.add_worksheet('三角债')
    ws.write(0, 0, '往来方向', bold)
    ws.write(0, 1, '发出金额', bold)
    ws.write(0, 2, '收到金额', bold)
    ws.write(0, 3, '净额', bold)

    pairs = [
        ('华登 ↔ 邵阳华登', totals[1], totals[2], hd_sy),
        ('华登 ↔ 兴信', totals[3], totals[4], hd_xx),
        ('邵阳华登 ↔ 兴信', totals[5], totals[6], sy_xx),
    ]
    for i, (label, sent, recv, net) in enumerate(pairs, 1):
        ws.write(i, 0, label, cell_fmt)
        ws.write(i, 1, sent, num_fmt)
        ws.write(i, 2, recv, num_fmt)
        ws.write(i, 3, net, num_fmt)

    ws.write(5, 0, '公司', bold)
    ws.write(5, 1, '净额（正=应收，负=应付）', bold)
    net_data = {
        '华登': round(hd_sy + hd_xx, 2),
        '邵阳华登': round(sy_xx - hd_sy, 2),
        '兴信': round(-(hd_xx + sy_xx), 2),
    }
    row = 6
    for company, amount in net_data.items():
        ws.write(row, 0, company, cell_fmt)
        ws.write(row, 1, amount, num_fmt)
        row += 1

    wb.close()
    output.seek(0)
    db.close()
    return send_file(output, as_attachment=True, download_name='三角债报表.xlsx',
                     mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')


@app.route('/export/monthly/<int:ch>')
def export_monthly(ch):
    if ch not in CHANNELS:
        return redirect(url_for('index'))

    selected = request.args.getlist('months')
    db = get_db()
    stats_data = _build_stats(db, ch)
    db.close()

    if selected:
        stats_data = [s for s in stats_data if s['year_month'] in selected]

    output = io.BytesIO()
    wb = xlsxwriter.Workbook(output)

    # 格式
    def fmt(**kw):
        base = {'border': 1, 'valign': 'vcenter', 'align': 'center', 'font_size': 10}
        base.update(kw)
        return wb.add_format(base)

    title_fmt   = fmt(bold=True, font_size=12, bg_color='#C4D79B', border=0, align='left')
    header_fmt  = fmt(bold=True, bg_color='#D9D9D9')
    month_fmt   = fmt(bold=True, bg_color='#F2F2F2', text_wrap=True)
    prev_fmt    = fmt(bg_color='#F2F2F2')
    invest_fmt  = fmt(bg_color='#DBEAFE', font_color='#1E40AF')
    expect_fmt  = fmt(bold=True, bg_color='#DBEAFE', font_color='#1E40AF')
    actual_fmt  = fmt(bold=True, bg_color='#DCFCE7', font_color='#166534')
    loss_red    = fmt(bg_color='#FEE2E2', font_color='#DC2626')
    loss_green  = fmt(bg_color='#D1FAE5', font_color='#065F46')
    pct_fmt     = fmt(bg_color='#F9FAFB', font_color='#9CA3AF', num_format='0.0"%"')
    num_prev    = fmt(bg_color='#F2F2F2', num_format='0')
    num_invest  = fmt(bg_color='#DBEAFE', font_color='#1E40AF', num_format='0')
    num_expect  = fmt(bold=True, bg_color='#DBEAFE', font_color='#1E40AF', num_format='0')
    num_actual  = fmt(bold=True, bg_color='#DCFCE7', font_color='#166534', num_format='0')
    num_lred    = fmt(bg_color='#FEE2E2', font_color='#DC2626', num_format='0')
    num_lgreen  = fmt(bg_color='#D1FAE5', font_color='#065F46', num_format='0')
    num_pct     = fmt(bg_color='#F9FAFB', font_color='#9CA3AF', num_format='0.0"%"')

    ws = wb.add_worksheet('月份统计')
    stat_keys = [k for k, _ in STAT_ITEMS]
    stat_names = [n for _, n in STAT_ITEMS]
    total_cols = 2 + len(STAT_ITEMS)

    ws.set_column(0, 0, 12)   # 月份
    ws.set_column(1, 1, 10)   # 项目
    ws.set_column(2, total_cols - 1, 9)  # 包材

    # 标题行
    ws.merge_range(0, 0, 0, total_cols - 1,
                   f"{CHANNELS[ch]['from']} → {CHANNELS[ch]['to']} 月份包材数量统计", title_fmt)
    ws.set_row(0, 20)

    # 表头
    ws.write(1, 0, '月份', header_fmt)
    ws.write(1, 1, '项目', header_fmt)
    for ci, name in enumerate(stat_names):
        ws.write(1, 2 + ci, name, header_fmt)
    ws.set_row(1, 16)

    row = 2
    for stat in stats_data:
        ym = stat['year_month']
        month = int(ym[5:7])
        prev_month = 12 if month == 1 else month - 1
        data = stat['item_data']

        rows_def = [
            (f'{prev_month}月实存', prev_fmt,   num_prev,   'prev_actual'),
            ('投资',                invest_fmt, num_invest, 'investment'),
            (f'{month}月应存',      expect_fmt, num_expect, 'expected'),
            (f'{month}月实存',      actual_fmt, num_actual, 'actual'),
            ('损耗',                None,       None,       'loss'),
            ('损耗占比',            pct_fmt,    num_pct,    'loss_pct'),
        ]

        # 合并月份列（6行）
        month_label = ym + (f'\n{stat["remarks"]}' if stat.get('remarks') else '')
        ws.merge_range(row, 0, row + 5, 0, month_label, month_fmt)

        for i, (label, lbl_fmt, val_fmt, field) in enumerate(rows_def):
            r = row + i
            ws.set_row(r, 15)

            # 损耗行颜色按正负
            if field == 'loss':
                loss_val = data[stat_keys[0]]['loss']
                lbl_fmt = loss_red if loss_val < 0 else loss_green
                val_fmt = num_lred if loss_val < 0 else num_lgreen

            ws.write(r, 1, label, lbl_fmt)
            for ci, key in enumerate(stat_keys):
                v = data[key][field]
                if field == 'loss_pct':
                    ws.write(r, 2 + ci, v, val_fmt)
                else:
                    ws.write(r, 2 + ci, int(v), val_fmt)

        row += 6

    wb.close()
    output.seek(0)
    filename = f"{CHANNELS[ch]['from']}到{CHANNELS[ch]['to']}_月份统计.xlsx"
    return send_file(output, as_attachment=True, download_name=filename,
                     mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')


init_db()

if __name__ == '__main__':
    import threading, webbrowser
    port = int(os.environ.get('PORT', 7000))
    if getattr(sys, 'frozen', False):
        threading.Timer(1.5, lambda: webbrowser.open(f'http://127.0.0.1:{port}')).start()
        app.run(debug=False, host='0.0.0.0', port=port)
    else:
        app.run(debug=True, host='0.0.0.0', port=port)
