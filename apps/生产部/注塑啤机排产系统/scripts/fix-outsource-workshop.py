# 修正 9-1 外发数据导入的车间归属错误
# 问题：原 Excel《外发明细》B合计(757行)之后是华登段，但 C 列无"华登"标签，
#       旧导入脚本沿用"兴信B"；华登机台子表(1219行起)C 列是机台号(68-89)，被当成车间。
# 修正：B合计之后所有行 → 车间=华登；机台号挪到备注("机台:NN")。
# 用法：python3 fix-outsource-workshop.py [db路径]   (默认本地 paiji.db；加 --apply 才写库)
import openpyxl, sqlite3, sys

XLSX = '/Users/duanlei/Documents/Kimi/Workspaces/工程资料/2026年啤机外发模具表.2026-7-22最新更新.xlsx'
DB = sys.argv[1] if len(sys.argv) > 1 and sys.argv[1] != '--apply' else \
    '/Users/duanlei/Documents/Kimi/Workspaces/工程资料/注塑啤机排产系统/server/data/paiji.db'
APPLY = '--apply' in sys.argv
BATCH_CREATED_AT = '2026-09-01T14:03:54.530791'

def s(v):
    import datetime
    if v is None: return ''
    if isinstance(v, datetime.datetime): return v.strftime('%Y-%m-%d')
    return str(v).strip()

# ---------- 1. 按原脚本逻辑解析 Excel，额外记录行号/机台号 ----------
wb = openpyxl.load_workbook(XLSX, read_only=True, data_only=True)
ws = wb['外发明细']
parsed = []
last_workshop, last_item, machine = '', '', ''
for idx, row in enumerate(ws.iter_rows(min_row=3, max_col=20, values_only=True), start=3):
    seq, workshop, item_code, mold = row[1], s(row[2]), s(row[3]), s(row[4])
    seqs = s(seq)
    if '合计' in seqs or '合计' in mold:
        if seqs.startswith('B'):          # B合计之后 = 华登段
            last_workshop, machine = '华登', ''
        continue
    if workshop:
        if workshop.isdigit():
            machine = workshop            # 华登段 C 列是机台号
        else:
            last_workshop, machine = workshop, ''
    if item_code: last_item = item_code
    if not (mold or seqs or item_code):
        continue
    parsed.append(dict(excel_row=idx, workshop=last_workshop, machine=machine,
                       item_code=last_item, mold=mold, order_date=s(row[15])))
wb.close()
print(f'Excel 解析 {len(parsed)} 行；华登段 {sum(1 for p in parsed if p["workshop"]=="华登")} 行，'
      f'其中带机台号 {sum(1 for p in parsed if p["machine"])} 行')

# ---------- 2. 对齐数据库 9-1 批次（按 rowid = 插入顺序 = Excel 行序） ----------
con = sqlite3.connect(DB)
batch = con.execute(
    "SELECT rowid, id, workshop, item_code, mold, remark FROM outsource_orders "
    "WHERE created_at=? ORDER BY rowid", (BATCH_CREATED_AT,)).fetchall()
print(f'数据库 9-1 批次 {len(batch)} 行')
assert len(batch) == len(parsed), '批次行数与 Excel 解析行数不一致，中止！'

mismatch = 0
for p, (rid, oid, ws_old, ic, mold_db, remark) in zip(parsed, batch):
    if (p['item_code'] or '') != (ic or '') or (p['mold'] or '') != (mold_db or ''):
        mismatch += 1
        if mismatch <= 5:
            print(f'  对齐偏差 rowid={rid} Excel行{p["excel_row"]}: {p["item_code"]}/{p["mold"][:20]} vs {ic}/{(mold_db or "")[:20]}')
assert mismatch == 0, f'有 {mismatch} 行对不上，中止！'
print('逐行对齐校验通过 ✓')

# ---------- 3. 生成修正 ----------
fix = []  # (id, new_workshop, machine)
for p, (rid, oid, ws_old, ic, mold_db, remark) in zip(parsed, batch):
    if p['workshop'] == '华登' and ws_old != '华登':
        fix.append((oid, '华登', p['machine']))
print(f'需修正 {len(fix)} 行（车间→华登）')

# 模具映射同步：按原脚本"最新一单"逻辑重放，只改 workshop 字段
map_fix = {}
for p in parsed:
    code = p['mold'].split()[0] if p['mold'] else ''
    if not code: continue
    key = (p['order_date'] or '', p['excel_row'])
    if code not in map_fix or key >= map_fix[code][0]:
        map_fix[code] = (key, p['workshop'])
mrows = con.execute("SELECT mold_code, workshop FROM outsource_mold_mappings").fetchall()
mfix = [(ws_new, mc) for mc, ws_old in mrows
        if mc in map_fix and (ws_old or '') != map_fix[mc][1] for ws_new in [map_fix[mc][1]]]
print(f'模具映射需修正 {len(mfix)} 条')

if not APPLY:
    print('（演练模式，加 --apply 才真正写库）')
    con.close()
    sys.exit(0)

cur = con.cursor()
cur.execute('BEGIN')
for oid, ws_new, mach in fix:
    if mach:
        cur.execute(
            "UPDATE outsource_orders SET workshop=?, "
            "remark=TRIM(COALESCE(NULLIF(remark,''),'') || ?), updated_at=datetime('now') WHERE id=?",
            (ws_new, (' / ' if True else '') + f'机台:{mach}', oid))
        # 上面备注拼接：空备注时避免前导 " / "
        cur.execute("UPDATE outsource_orders SET remark=LTRIM(remark,' /') WHERE id=? AND remark LIKE ' /%'", (oid,))
    else:
        cur.execute("UPDATE outsource_orders SET workshop=?, updated_at=datetime('now') WHERE id=?",
                    (ws_new, oid))
for ws_new, mc in mfix:
    cur.execute("UPDATE outsource_mold_mappings SET workshop=?, updated_at=datetime('now') WHERE mold_code=?",
                (ws_new, mc))
con.commit()
print('修正完成：', con.execute("SELECT workshop,COUNT(*) FROM outsource_orders GROUP BY workshop ORDER BY 2 DESC").fetchall())
con.close()
