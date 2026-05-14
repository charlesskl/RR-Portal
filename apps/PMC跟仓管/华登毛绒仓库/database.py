"""
数据库模块
负责 SQLite 连接、初始化和增删改查操作

【关键设计】
- 出入库共用一套表,通过 category 字段区分品类:
    - 'plush'   = 毛绒(主要业务)
    - 'costume' = 戏服
- 毛绒的"款式"和戏服的"类型"都存在 style 列里:
    - 毛绒只有 'normal' / 'rare' 两个值
    - 戏服是自由文本(如 "M码连衣裙"、"L码上衣")

【库存计算公式】
库存数量不单独存储,每次查询时实时计算:
    库存 = SUM(入库数量) - SUM(出库数量)
    WHERE category=? AND sku=? AND style=? AND flag=?

四个维度组合才唯一确定一个库存单元。
"""
import sqlite3
import os
from contextlib import contextmanager

# 数据库文件路径(放在 data/ 目录下)
DB_PATH = os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    'data',
    'inventory.db'
)


def get_db():
    """获取数据库连接,行结果会自动转成字典格式"""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute('PRAGMA foreign_keys = ON')
    return conn


@contextmanager
def db_cursor():
    """
    上下文管理器,自动提交事务和关闭连接
    用法:
        with db_cursor() as cur:
            cur.execute('SELECT * FROM users')
    """
    conn = get_db()
    try:
        cursor = conn.cursor()
        yield cursor
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_database():
    """初始化数据库表结构(幂等,可以重复运行)"""
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)

    with db_cursor() as cur:
        # 用户表
        cur.execute('''
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                role TEXT NOT NULL CHECK(role IN ('admin', 'operator', 'viewer')),
                display_name TEXT,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        ''')

        # 布标表
        cur.execute('''
            CREATE TABLE IF NOT EXISTS flags (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT UNIQUE NOT NULL,
                sort_order INTEGER DEFAULT 0
            )
        ''')

        # 入库流水表
        # category: 'plush'(毛绒) | 'costume'(戏服)
        # style:
        #   - 毛绒: 'normal' | 'rare'
        #   - 戏服: 自由文本(如 'M码连衣裙')
        # flag:
        #   - 毛绒: 必填(按国家命名的布标)
        #   - 戏服: 始终为空字符串''(戏服没有布标这个字段)
        cur.execute('''
            CREATE TABLE IF NOT EXISTS in_records (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                category TEXT NOT NULL DEFAULT 'plush' CHECK(category IN ('plush', 'costume')),
                date TEXT NOT NULL,
                bill_no TEXT NOT NULL,
                sku TEXT NOT NULL,
                name TEXT,
                style TEXT NOT NULL,
                flag TEXT NOT NULL DEFAULT '',
                qty INTEGER NOT NULL CHECK(qty > 0),
                created_by TEXT,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        ''')

        # 出库流水表
        cur.execute('''
            CREATE TABLE IF NOT EXISTS out_records (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                category TEXT NOT NULL DEFAULT 'plush' CHECK(category IN ('plush', 'costume')),
                date TEXT NOT NULL,
                bill_no TEXT NOT NULL,
                po TEXT,
                picker TEXT,
                sku TEXT NOT NULL,
                name TEXT,
                style TEXT NOT NULL,
                flag TEXT NOT NULL DEFAULT '',
                qty INTEGER NOT NULL CHECK(qty > 0),
                created_by TEXT,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        ''')

        # 索引(加快按品类 / 货号 / 日期查询)
        cur.execute('CREATE INDEX IF NOT EXISTS idx_in_category ON in_records(category)')
        cur.execute('CREATE INDEX IF NOT EXISTS idx_in_sku ON in_records(sku)')
        cur.execute('CREATE INDEX IF NOT EXISTS idx_in_date ON in_records(date)')
        cur.execute('CREATE INDEX IF NOT EXISTS idx_out_category ON out_records(category)')
        cur.execute('CREATE INDEX IF NOT EXISTS idx_out_sku ON out_records(sku)')
        cur.execute('CREATE INDEX IF NOT EXISTS idx_out_date ON out_records(date)')
        cur.execute('CREATE INDEX IF NOT EXISTS idx_out_po ON out_records(po)')

        # 排期表(整库替换式,每次上传清空重建)
        cur.execute('''
            CREATE TABLE IF NOT EXISTS po_schedules (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                series TEXT NOT NULL,
                po_no TEXT NOT NULL,
                item_code TEXT NOT NULL,
                customer_sku TEXT,
                qty INTEGER NOT NULL,
                customer TEXT,
                country TEXT,
                name_cn TEXT,
                plan_ship_date TEXT,
                uploaded_by TEXT,
                uploaded_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        # 旧库迁移(必须在建索引前做)
        for col, ddl in (
            ('customer_sku', 'ALTER TABLE po_schedules ADD COLUMN customer_sku TEXT'),
            ('variant_letter', 'ALTER TABLE po_schedules ADD COLUMN variant_letter TEXT'),
            ('image_url', 'ALTER TABLE po_schedules ADD COLUMN image_url TEXT'),
            ('letters_json', 'ALTER TABLE po_schedules ADD COLUMN letters_json TEXT'),
            ('flag_type', 'ALTER TABLE po_schedules ADD COLUMN flag_type TEXT'),
            ('flag', 'ALTER TABLE po_schedules ADD COLUMN flag TEXT'),
            ('ratio_normal_text', 'ALTER TABLE po_schedules ADD COLUMN ratio_normal_text TEXT'),
            ('ratio_rare_text', 'ALTER TABLE po_schedules ADD COLUMN ratio_rare_text TEXT'),
        ):
            try:
                cur.execute(ddl)
            except sqlite3.OperationalError:
                pass  # 已存在
        cur.execute('CREATE INDEX IF NOT EXISTS idx_po_schedules_po ON po_schedules(po_no)')
        cur.execute('CREATE INDEX IF NOT EXISTS idx_po_schedules_item ON po_schedules(item_code)')
        cur.execute('CREATE INDEX IF NOT EXISTS idx_po_schedules_csku ON po_schedules(customer_sku)')

        # 字母绑定:(sku, letter) → material_name
        cur.execute('''
            CREATE TABLE IF NOT EXISTS letter_bindings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                sku TEXT NOT NULL,
                letter TEXT NOT NULL,
                material_name TEXT NOT NULL,
                created_by TEXT,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(sku, letter)
            )
        ''')
        cur.execute('CREATE INDEX IF NOT EXISTS idx_lb_sku_letter ON letter_bindings(sku, letter)')

        # 布标映射:(排期布标, 国家) → 入库实际布标
        cur.execute('''
            CREATE TABLE IF NOT EXISTS flag_mappings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                flag_type TEXT NOT NULL,
                country TEXT NOT NULL,
                inventory_flag TEXT NOT NULL,
                created_by TEXT,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(flag_type, country)
            )
        ''')
        cur.execute('CREATE INDEX IF NOT EXISTS idx_fm_type_country ON flag_mappings(flag_type, country)')


# ==================== 入库记录操作 ====================

def query_all_in_records(category=None):
    """
    查询入库记录,按日期倒序
    :param category: 可选,'plush' 或 'costume',传 None 表示查询全部
    """
    with db_cursor() as cur:
        if category:
            cur.execute(
                'SELECT * FROM in_records WHERE category = ? ORDER BY date DESC, id DESC',
                (category,)
            )
        else:
            cur.execute('SELECT * FROM in_records ORDER BY date DESC, id DESC')
        return [dict(row) for row in cur.fetchall()]


def insert_in_record(data, username):
    """
    新增入库记录
    :param data: dict,必须包含 category, date, billNo, sku, style, flag, qty
                 可选 name
    :param username: 创建人
    :return: 新记录的 id
    """
    with db_cursor() as cur:
        cur.execute(
            '''INSERT INTO in_records
               (category, date, bill_no, sku, name, style, flag, qty, created_by)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)''',
            (data.get('category', 'plush'), data['date'], data['billNo'],
             data['sku'], data.get('name', ''),
             data['style'], data['flag'], data['qty'], username)
        )
        return cur.lastrowid


def delete_in_record(record_id):
    """删除入库记录"""
    with db_cursor() as cur:
        cur.execute('DELETE FROM in_records WHERE id = ?', (record_id,))


def delete_in_records_batch(ids):
    """批量删除入库记录(单事务),返回删除条数"""
    if not ids:
        return 0
    with db_cursor() as cur:
        placeholders = ','.join('?' * len(ids))
        cur.execute(f'DELETE FROM in_records WHERE id IN ({placeholders})', list(ids))
        return cur.rowcount


def update_in_record(record_id, data):
    """更新入库记录,返回受影响的行数"""
    with db_cursor() as cur:
        cur.execute(
            '''UPDATE in_records
               SET category=?, date=?, bill_no=?, sku=?, name=?, style=?, flag=?, qty=?
               WHERE id=?''',
            (data.get('category', 'plush'), data['date'], data['billNo'],
             data['sku'], data.get('name', ''),
             data['style'], data['flag'], data['qty'], record_id)
        )
        return cur.rowcount


# ==================== 出库记录操作 ====================

def query_all_out_records(category=None):
    """
    查询出库记录,按日期倒序
    :param category: 可选,'plush' 或 'costume',传 None 表示查询全部
    """
    with db_cursor() as cur:
        if category:
            cur.execute(
                'SELECT * FROM out_records WHERE category = ? ORDER BY date DESC, id DESC',
                (category,)
            )
        else:
            cur.execute('SELECT * FROM out_records ORDER BY date DESC, id DESC')
        return [dict(row) for row in cur.fetchall()]


def insert_out_record(data, username):
    """
    新增出库记录
    :param data: dict,必须包含 category, date, billNo, sku, style, flag, qty
                 可选 name, po, picker
    :param username: 创建人
    :return: 新记录的 id
    """
    with db_cursor() as cur:
        cur.execute(
            '''INSERT INTO out_records
               (category, date, bill_no, po, picker, sku, name, style, flag, qty, created_by)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)''',
            (data.get('category', 'plush'), data['date'], data['billNo'],
             data.get('po', ''), data.get('picker', ''),
             data['sku'], data.get('name', ''),
             data['style'], data['flag'], data['qty'], username)
        )
        return cur.lastrowid


def insert_out_records_batch(records, username):
    """
    批量新增出库记录(单事务,任一条失败全部回滚)
    :param records: list[dict],每条同 insert_out_record 的 data
    :param username: 创建人
    :return: list[int] 新记录 id
    """
    ids = []
    with db_cursor() as cur:
        for data in records:
            cur.execute(
                '''INSERT INTO out_records
                   (category, date, bill_no, po, picker, sku, name, style, flag, qty, created_by)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)''',
                (data.get('category', 'plush'), data['date'], data['billNo'],
                 data.get('po', ''), data.get('picker', ''),
                 data['sku'], data.get('name', ''),
                 data['style'], data['flag'], data['qty'], username)
            )
            ids.append(cur.lastrowid)
    return ids


def delete_out_record(record_id):
    """删除出库记录"""
    with db_cursor() as cur:
        cur.execute('DELETE FROM out_records WHERE id = ?', (record_id,))


def delete_out_records_batch(ids):
    """批量删除出库记录(单事务),返回删除条数"""
    if not ids:
        return 0
    with db_cursor() as cur:
        placeholders = ','.join('?' * len(ids))
        cur.execute(f'DELETE FROM out_records WHERE id IN ({placeholders})', list(ids))
        return cur.rowcount


def update_out_record(record_id, data):
    """更新出库记录,返回受影响的行数"""
    with db_cursor() as cur:
        cur.execute(
            '''UPDATE out_records
               SET category=?, date=?, bill_no=?, po=?, picker=?,
                   sku=?, name=?, style=?, flag=?, qty=?
               WHERE id=?''',
            (data.get('category', 'plush'), data['date'], data['billNo'],
             data.get('po', ''), data.get('picker', ''),
             data['sku'], data.get('name', ''),
             data['style'], data['flag'], data['qty'], record_id)
        )
        return cur.rowcount


# ==================== 库存计算(核心,Claude Code 必须严格按公式实现) ====================

def calculate_stock(category, sku, style, flag):
    """
    计算指定规格的当前库存

    公式: 库存 = SUM(入库数量) - SUM(出库数量)
    维度: category + sku + style + flag 四者组合唯一定位一个库存单元

    :return: int 库存数量(可能为负数,代表超额出库)
    """
    with db_cursor() as cur:
        cur.execute(
            '''SELECT COALESCE(SUM(qty), 0) AS total FROM in_records
               WHERE category=? AND sku=? AND style=? AND flag=?''',
            (category, sku, style, flag)
        )
        in_total = cur.fetchone()['total']

        cur.execute(
            '''SELECT COALESCE(SUM(qty), 0) AS total FROM out_records
               WHERE category=? AND sku=? AND style=? AND flag=?''',
            (category, sku, style, flag)
        )
        out_total = cur.fetchone()['total']

        return in_total - out_total


def get_stock_summary(category=None):
    """
    获取库存汇总,按 (category, sku, style, flag) 分组

    实现思路:用 UNION ALL 把入库和出库流水合并成统一格式,然后 GROUP BY 聚合
    入库行 qty 计入 in_qty,出库行 qty 计入 out_qty,最后 SUM 求和

    :param category: 可选,筛选品类
    :return: list[dict],每条字段:
             category, sku, name, style, flag, in_total, out_total, stock
    """
    if category:
        sql = '''
            SELECT category, sku, MAX(name) AS name, style, flag,
                   SUM(in_qty) AS in_total,
                   SUM(out_qty) AS out_total,
                   SUM(in_qty) - SUM(out_qty) AS stock
            FROM (
                SELECT category, sku, name, style, flag, qty AS in_qty, 0 AS out_qty
                FROM in_records WHERE category = ?
                UNION ALL
                SELECT category, sku, name, style, flag, 0 AS in_qty, qty AS out_qty
                FROM out_records WHERE category = ?
            )
            GROUP BY category, sku, style, flag
            ORDER BY sku, style, flag
        '''
        params = (category, category)
    else:
        sql = '''
            SELECT category, sku, MAX(name) AS name, style, flag,
                   SUM(in_qty) AS in_total,
                   SUM(out_qty) AS out_total,
                   SUM(in_qty) - SUM(out_qty) AS stock
            FROM (
                SELECT category, sku, name, style, flag, qty AS in_qty, 0 AS out_qty
                FROM in_records
                UNION ALL
                SELECT category, sku, name, style, flag, 0 AS in_qty, qty AS out_qty
                FROM out_records
            )
            GROUP BY category, sku, style, flag
            ORDER BY category, sku, style, flag
        '''
        params = ()

    with db_cursor() as cur:
        cur.execute(sql, params)
        return [dict(row) for row in cur.fetchall()]


# ==================== 布标操作 ====================

def query_all_flags():
    """返回布标名称数组(按 sort_order, id 排序)"""
    with db_cursor() as cur:
        cur.execute('SELECT name FROM flags ORDER BY sort_order, id')
        return [row['name'] for row in cur.fetchall()]


def add_flag(name):
    """
    新增布标,sort_order 自动取当前最大值 + 1
    name 已在 schema 上设 UNIQUE,重复插入会抛 sqlite3.IntegrityError
    """
    with db_cursor() as cur:
        cur.execute('SELECT COALESCE(MAX(sort_order), 0) AS m FROM flags')
        next_order = cur.fetchone()['m'] + 1
        cur.execute(
            'INSERT INTO flags (name, sort_order) VALUES (?, ?)',
            (name, next_order)
        )
        return cur.lastrowid


def delete_flag(name):
    """按名称删除布标,返回受影响的行数"""
    with db_cursor() as cur:
        cur.execute('DELETE FROM flags WHERE name = ?', (name,))
        return cur.rowcount


# ==================== 用户操作 ====================

def get_user_by_username(username):
    """按用户名查询用户(登录用)"""
    with db_cursor() as cur:
        cur.execute('SELECT * FROM users WHERE username = ?', (username,))
        row = cur.fetchone()
        return dict(row) if row else None


def query_all_users():
    """查询所有用户(不含 password_hash),按 id 升序"""
    with db_cursor() as cur:
        cur.execute(
            '''SELECT id, username, role, display_name, created_at
               FROM users ORDER BY id'''
        )
        return [dict(row) for row in cur.fetchall()]


def get_user_by_id(user_id):
    """按 ID 查询用户(含 password_hash,内部校验用)"""
    with db_cursor() as cur:
        cur.execute('SELECT * FROM users WHERE id = ?', (user_id,))
        row = cur.fetchone()
        return dict(row) if row else None


def insert_user(username, password_hash, role, display_name):
    """
    新增用户
    username 已在 schema 上设 UNIQUE,重复插入会抛 sqlite3.IntegrityError
    """
    with db_cursor() as cur:
        cur.execute(
            '''INSERT INTO users (username, password_hash, role, display_name)
               VALUES (?, ?, ?, ?)''',
            (username, password_hash, role, display_name)
        )
        return cur.lastrowid


def delete_user(user_id):
    """删除用户,返回受影响的行数"""
    with db_cursor() as cur:
        cur.execute('DELETE FROM users WHERE id = ?', (user_id,))
        return cur.rowcount


def update_user_password(user_id, new_password_hash):
    """更新密码,返回受影响的行数"""
    with db_cursor() as cur:
        cur.execute(
            'UPDATE users SET password_hash = ? WHERE id = ?',
            (new_password_hash, user_id)
        )
        return cur.rowcount


# ==================== 排期表操作 ====================

def replace_po_schedules(rows, username):
    """整库替换:清空 po_schedules 后批量插入 rows(list[dict])"""
    with db_cursor() as cur:
        cur.execute('DELETE FROM po_schedules')
        cur.execute('DELETE FROM sqlite_sequence WHERE name="po_schedules"')
        cur.executemany(
            '''INSERT INTO po_schedules
               (series, po_no, item_code, customer_sku, variant_letter, qty,
                customer, country, flag_type, flag, ratio_normal_text, ratio_rare_text,
                name_cn, plan_ship_date, image_url, letters_json, uploaded_by)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)''',
            [(r['series'], r['po_no'], r['item_code'], r.get('customer_sku', ''),
              r.get('variant_letter', ''), r['qty'],
              r.get('customer', ''), r.get('country', ''),
              r.get('flag_type', ''), r.get('flag', ''),
              r.get('ratio_normal_text', ''), r.get('ratio_rare_text', ''),
              r.get('name_cn', ''), r.get('plan_ship_date', ''),
              r.get('image_url', ''), r.get('letters_json', ''), username)
             for r in rows]
        )


def query_po_schedules_by_po(po_no):
    """按 PO 号精确查询(去前后空白后小写不敏感)"""
    with db_cursor() as cur:
        cur.execute(
            '''SELECT * FROM po_schedules
               WHERE TRIM(LOWER(po_no)) = TRIM(LOWER(?))
               ORDER BY item_code, id''',
            (po_no,)
        )
        return [dict(row) for row in cur.fetchall()]


def query_po_schedules_by_item(item_code):
    """按 ITEM#(货号)查询所有涉及的 PO 行"""
    with db_cursor() as cur:
        cur.execute(
            '''SELECT * FROM po_schedules
               WHERE TRIM(LOWER(item_code)) = TRIM(LOWER(?))
               ORDER BY po_no, id''',
            (item_code,)
        )
        return [dict(row) for row in cur.fetchall()]


def query_po_schedules_by_customer_sku(customer_sku):
    """按客户 SKU(F 列)查询所有涉及的 PO 行"""
    with db_cursor() as cur:
        cur.execute(
            '''SELECT * FROM po_schedules
               WHERE TRIM(LOWER(customer_sku)) = TRIM(LOWER(?))
               ORDER BY po_no, id''',
            (customer_sku,)
        )
        return [dict(row) for row in cur.fetchall()]


def get_schedule_info():
    """返回当前排期表数据状态:总行数 / 涉及 PO 数 / 涉及 ITEM 数 / 最后上传时间和人"""
    with db_cursor() as cur:
        cur.execute('SELECT COUNT(*) AS c FROM po_schedules')
        count = cur.fetchone()['c']
        if count == 0:
            return {'count': 0, 'po_count': 0, 'item_count': 0,
                    'last_uploaded_at': '', 'last_uploaded_by': ''}
        cur.execute('SELECT COUNT(DISTINCT po_no) AS c FROM po_schedules')
        po_count = cur.fetchone()['c']
        cur.execute('SELECT COUNT(DISTINCT item_code) AS c FROM po_schedules')
        item_count = cur.fetchone()['c']
        cur.execute('SELECT uploaded_at, uploaded_by FROM po_schedules ORDER BY id DESC LIMIT 1')
        last = cur.fetchone()
        return {
            'count': count, 'po_count': po_count, 'item_count': item_count,
            'last_uploaded_at': last['uploaded_at'] or '',
            'last_uploaded_by': last['uploaded_by'] or '',
        }


def get_sku_total_stock(sku):
    """按货号汇总当前总库存(所有 style+flag 之和),用于排期对比"""
    with db_cursor() as cur:
        cur.execute(
            'SELECT COALESCE(SUM(qty), 0) AS total FROM in_records WHERE sku=?',
            (sku,)
        )
        in_total = cur.fetchone()['total']
        cur.execute(
            'SELECT COALESCE(SUM(qty), 0) AS total FROM out_records WHERE sku=?',
            (sku,)
        )
        out_total = cur.fetchone()['total']
        return in_total - out_total


def get_stock_by_sku_name(sku, material_name):
    """按 sku + 物料名汇总库存(用于字母绑定后的精确对比)"""
    with db_cursor() as cur:
        cur.execute(
            'SELECT COALESCE(SUM(qty), 0) AS t FROM in_records WHERE sku=? AND name=?',
            (sku, material_name)
        )
        in_total = cur.fetchone()['t']
        cur.execute(
            'SELECT COALESCE(SUM(qty), 0) AS t FROM out_records WHERE sku=? AND name=?',
            (sku, material_name)
        )
        out_total = cur.fetchone()['t']
        return in_total - out_total


def get_stock_by_full_dim(sku, material_name, style, flag):
    """按 sku + 物料名 + style(normal/rare) + flag(布标-国家) 四维精确查库存"""
    with db_cursor() as cur:
        cur.execute(
            'SELECT COALESCE(SUM(qty), 0) AS t FROM in_records WHERE sku=? AND name=? AND style=? AND flag=?',
            (sku, material_name, style, flag)
        )
        in_total = cur.fetchone()['t']
        cur.execute(
            'SELECT COALESCE(SUM(qty), 0) AS t FROM out_records WHERE sku=? AND name=? AND style=? AND flag=?',
            (sku, material_name, style, flag)
        )
        out_total = cur.fetchone()['t']
        return in_total - out_total


def get_material_names_for_sku(sku):
    """该 sku 下入库 / 出库记录里出现过的所有非空物料名(去重)"""
    with db_cursor() as cur:
        cur.execute('''
            SELECT DISTINCT name FROM (
                SELECT name FROM in_records WHERE sku=? AND name != ''
                UNION
                SELECT name FROM out_records WHERE sku=? AND name != ''
            ) ORDER BY name
        ''', (sku, sku))
        return [row['name'] for row in cur.fetchall()]


# ==================== 字母绑定 ====================

def query_all_letter_bindings():
    """列出所有 (sku, letter, material_name) 绑定"""
    with db_cursor() as cur:
        cur.execute('SELECT * FROM letter_bindings ORDER BY sku, letter')
        return [dict(r) for r in cur.fetchall()]


def get_letter_binding(sku, letter):
    """按 (sku, letter) 取 material_name"""
    with db_cursor() as cur:
        cur.execute('SELECT * FROM letter_bindings WHERE sku=? AND letter=?', (sku, letter))
        row = cur.fetchone()
        return dict(row) if row else None


def upsert_letter_binding(sku, letter, material_name, username):
    """新增或更新 (sku, letter) → material_name"""
    with db_cursor() as cur:
        cur.execute('''
            INSERT INTO letter_bindings (sku, letter, material_name, created_by)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(sku, letter) DO UPDATE SET material_name=excluded.material_name
        ''', (sku, letter, material_name, username))
        return cur.lastrowid


def delete_letter_binding(binding_id):
    """删除绑定"""
    with db_cursor() as cur:
        cur.execute('DELETE FROM letter_bindings WHERE id=?', (binding_id,))
        return cur.rowcount


# ==================== 布标映射 ====================

def query_all_flag_mappings():
    """列出所有 (排期布标类型, 国家) → 入库布标 映射"""
    with db_cursor() as cur:
        cur.execute('SELECT * FROM flag_mappings ORDER BY flag_type, country')
        return [dict(r) for r in cur.fetchall()]


def get_flag_mapping(flag_type, country):
    """按 (flag_type, country) 取映射"""
    with db_cursor() as cur:
        cur.execute(
            'SELECT * FROM flag_mappings WHERE flag_type=? AND country=?',
            (flag_type, country)
        )
        row = cur.fetchone()
        return dict(row) if row else None


def upsert_flag_mapping(flag_type, country, inventory_flag, username):
    with db_cursor() as cur:
        cur.execute('''
            INSERT INTO flag_mappings (flag_type, country, inventory_flag, created_by)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(flag_type, country) DO UPDATE SET inventory_flag=excluded.inventory_flag
        ''', (flag_type, country, inventory_flag, username))
        return cur.lastrowid


def delete_flag_mapping(mapping_id):
    with db_cursor() as cur:
        cur.execute('DELETE FROM flag_mappings WHERE id=?', (mapping_id,))
        return cur.rowcount


def get_schedule_flag_country_pairs():
    """从已上传排期里抽出所有 (flag_type, country) 唯一对(非空),用于"待映射"提示"""
    with db_cursor() as cur:
        cur.execute('''
            SELECT DISTINCT flag_type, country
            FROM po_schedules
            WHERE flag_type IS NOT NULL AND flag_type != ''
              AND country IS NOT NULL AND country != ''
            ORDER BY flag_type, country
        ''')
        return [dict(r) for r in cur.fetchall()]


def get_schedule_sku_letter_pairs():
    """
    从已上传排期里抽出所有 (sku=item_code, letter) 唯一对
    数据来源:variant_letter(单款行) + letters_json(拼盘行)
    """
    import json as _json
    pairs = set()
    with db_cursor() as cur:
        cur.execute('SELECT item_code, variant_letter, letters_json FROM po_schedules')
        for row in cur.fetchall():
            ic = row['item_code']
            vl = row['variant_letter']
            if vl:
                pairs.add((ic, vl))
            try:
                letters = _json.loads(row['letters_json'] or '[]')
            except (TypeError, ValueError):
                letters = []
            for l in letters:
                letter = l.get('letter')
                if letter:
                    pairs.add((ic, letter))
    return [{'sku': s, 'letter': l} for s, l in sorted(pairs)]
