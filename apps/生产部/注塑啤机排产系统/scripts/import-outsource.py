# 把《2026年啤机外发模具表》导入本地 paiji.db 的外发模块四张表
# 用法：python3 import-outsource.py
import openpyxl, sqlite3, secrets, string, datetime, sys

XLSX = '/Users/duanlei/Documents/Kimi/Workspaces/工程资料/2026年啤机外发模具表.2026-7-22最新更新.xlsx'
DB = '/Users/duanlei/Documents/Kimi/Workspaces/工程资料/注塑啤机排产系统/server/data/paiji.db'
HKD_RATE = 0.88

def nanoid(n=10):
    return ''.join(secrets.choice(string.ascii_letters + string.digits) for _ in range(n))

def s(v):
    if v is None: return ''
    if isinstance(v, datetime.datetime): return v.strftime('%Y-%m-%d')
    return str(v).strip()

def num(v):
    if v in (None, ''): return None
    try: return float(v)
    except (TypeError, ValueError): return None

def r2(v):
    return round(v, 2) if isinstance(v, float) else v

wb = openpyxl.load_workbook(XLSX, read_only=True, data_only=True)
now = datetime.datetime.now().isoformat()

# ---------- 1. 外发明细 → outsource_orders ----------
# 注意：该表 A 列为空列，实际表头从 B 列开始（B=序号, C=车间, D=货号, E=模具, ...）
orders = []
ws = wb['外发明细']
last_workshop, last_item, machine = '', '', ''
for row in ws.iter_rows(min_row=3, max_col=20, values_only=True):
    seq, workshop, item_code, mold = row[1], s(row[2]), s(row[3]), s(row[4])
    seqs = s(seq)
    if '合计' in seqs or '合计' in mold:  # 跳过汇总行；B合计之后是华登段（C列无标签）
        if seqs.startswith('B'):
            last_workshop, machine = '华登', ''
        continue
    if workshop:
        if workshop.isdigit():       # 华登段 C 列是机台号，不是车间
            machine = workshop
        else:
            last_workshop, machine = workshop, ''
    if item_code: last_item = item_code
    if not (mold or seqs or item_code):  # 整行空
        continue
    remark = s(row[18])
    if machine:
        remark = (remark + ' / ' if remark else '') + f'机台:{machine}'
    rmb = num(row[11])
    usd = num(row[12])
    if (usd is None or usd == 0) and rmb:
        usd = rmb / HKD_RATE
    orders.append(dict(
        id=nanoid(), seq=num(seq), workshop=last_workshop, item_code=last_item, mold=mold,
        order_qty_pcs=num(row[5]), order_qty_shots=num(row[6]), target_qty=None,
        quoted_capacity=num(row[7]), actual_capacity=num(row[8]),
        quote_price_usd=num(row[10]), supplier_price_rmb=rmb, supplier_price_usd=r2(usd) if usd else None,
        supplier=s(row[13]), pmc_follow=s(row[14]),
        order_date=s(row[15]), production_start=s(row[16]), estimated_delivery=s(row[17]),
        remark=remark, status='open', net_outsource_output=None,
        source_bill_no=None, source_customer=None, source_production_no=None,
        source_mold_code=(mold.split()[0] if mold else None),
        created_at=now, updated_at=now,
    ))
print('外发明细 →', len(orders), '条订单')

# ---------- 2. 外发加工厂明细 → outsource_suppliers ----------
suppliers = []
ws = wb['外发加工厂明细']
for row in ws.iter_rows(min_row=3, max_col=10, values_only=True):
    name = s(row[1])
    if not name or '合计' in name: continue
    remark_parts = [p for p in [f"开机员工:{s(row[5])}" if s(row[5]) else '', s(row[9])] if p]
    suppliers.append(dict(
        id=nanoid(), seq=num(row[0]), name=name,
        total_machines=num(row[2]), machines_for_xx=None, xx_ratio=None,
        actual_running=num(row[3]), running_rate=num(row[4]),
        contact=s(row[6]), address=s(row[7]), mold_count=num(row[8]),
        remark=' / '.join(remark_parts),
    ))
print('外发加工厂明细 →', len(suppliers), '家供应商')

# ---------- 3. PC料 → outsource_pc_orders ----------
pc_orders = []
ws = wb['PC料']
for row in ws.iter_rows(min_row=3, max_col=6, values_only=True):
    factory, mold = s(row[1]), s(row[3])
    if not (factory or mold): continue
    if '合计' in factory: continue
    pc_orders.append(dict(
        id=nanoid(), seq=num(row[0]), factory=factory,
        item_code=s(row[2]), mold=mold, mold_sets=s(row[4]), remark=s(row[5]),
    ))
print('PC料 →', len(pc_orders), '条')

# ---------- 4. 由订单重建 mold_mappings（模具号 → 最新供应商） ----------
mappings = {}
for o in orders:
    code = o['source_mold_code']
    if not code: continue
    key = (o['order_date'] or '', o['created_at'])
    if code not in mappings or key >= mappings[code][0]:
        mold_name = o['mold'].replace(code, '', 1).strip()
        mappings[code] = (key, dict(
            mold_code=code, supplier=o['supplier'] or None,
            target_qty=None, workshop=o['workshop'] or None,
            mold_name=mold_name or None, updated_at=now,
        ))
print('模具映射 →', len(mappings), '条')

# ---------- 写库（整表替换） ----------
con = sqlite3.connect(DB)
try:
    cur = con.cursor()
    cur.execute('BEGIN')
    cur.execute('DELETE FROM outsource_orders')
    cur.execute('DELETE FROM outsource_suppliers')
    cur.execute('DELETE FROM outsource_pc_orders')
    cur.execute('DELETE FROM outsource_mold_mappings')
    cur.executemany('''INSERT INTO outsource_orders
        (id,seq,workshop,item_code,mold,order_qty_pcs,order_qty_shots,target_qty,quoted_capacity,
         actual_capacity,quote_price_usd,supplier_price_rmb,supplier_price_usd,supplier,pmc_follow,
         order_date,production_start,estimated_delivery,remark,status,net_outsource_output,
         source_bill_no,source_customer,source_production_no,source_mold_code,created_at,updated_at)
        VALUES (:id,:seq,:workshop,:item_code,:mold,:order_qty_pcs,:order_qty_shots,:target_qty,:quoted_capacity,
         :actual_capacity,:quote_price_usd,:supplier_price_rmb,:supplier_price_usd,:supplier,:pmc_follow,
         :order_date,:production_start,:estimated_delivery,:remark,:status,:net_outsource_output,
         :source_bill_no,:source_customer,:source_production_no,:source_mold_code,:created_at,:updated_at)''', orders)
    cur.executemany('''INSERT INTO outsource_suppliers
        (id,seq,name,total_machines,machines_for_xx,xx_ratio,actual_running,running_rate,contact,address,mold_count,remark)
        VALUES (:id,:seq,:name,:total_machines,:machines_for_xx,:xx_ratio,:actual_running,:running_rate,:contact,:address,:mold_count,:remark)''', suppliers)
    cur.executemany('''INSERT INTO outsource_pc_orders (id,seq,factory,item_code,mold,mold_sets,remark)
        VALUES (:id,:seq,:factory,:item_code,:mold,:mold_sets,:remark)''', pc_orders)
    cur.executemany('''INSERT INTO outsource_mold_mappings (mold_code,supplier,target_qty,workshop,mold_name,updated_at)
        VALUES (:mold_code,:supplier,:target_qty,:workshop,:mold_name,:updated_at)''', [v for _, v in mappings.values()])
    con.commit()
except Exception:
    con.rollback(); raise

for t in ['outsource_orders', 'outsource_suppliers', 'outsource_pc_orders', 'outsource_mold_mappings']:
    print(t, '=', con.execute(f'SELECT COUNT(*) FROM {t}').fetchone()[0])
print('抽样:', con.execute("SELECT workshop, item_code, mold, supplier FROM outsource_orders LIMIT 3").fetchall())
con.close()
wb.close()
print('导入完成')
