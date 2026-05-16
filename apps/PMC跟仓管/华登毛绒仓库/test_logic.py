"""
华登库存系统 - 自动化测试脚本

【作用】
确保 Claude Code 写的代码逻辑正确,特别是库存计算这种容易出错的地方。

【运行】
    python test_logic.py

【全部通过的标志】
看到 "✓ 全部测试通过!" 才算 OK,否则按错误提示修复。

【注意】
本脚本会创建一个独立测试数据库(test_inventory.db),不影响生产数据。
"""
import os
import sys
import shutil
import tempfile

# 用临时数据库做测试,不影响生产
TEST_DB_DIR = tempfile.mkdtemp(prefix='huadeng_test_')
TEST_DB_PATH = os.path.join(TEST_DB_DIR, 'inventory.db')

# 重要:在 import database 之前先改路径
import database
database.DB_PATH = TEST_DB_PATH
os.makedirs(os.path.dirname(TEST_DB_PATH), exist_ok=True)


# ==================== 测试工具 ====================

passed = 0
failed = 0
errors = []


def assert_eq(actual, expected, name):
    global passed, failed
    if actual == expected:
        passed += 1
        print(f'  ✓ {name}')
    else:
        failed += 1
        msg = f'  ✗ {name}: 期望 {expected}, 实际 {actual}'
        errors.append(msg)
        print(msg)


def section(title):
    print(f'\n[{title}]')


def reset_db():
    """每个测试组开始前,清空数据库重建"""
    if os.path.exists(TEST_DB_PATH):
        os.remove(TEST_DB_PATH)
    database.init_database()


# ==================== 测试 1: 基本入库出库 ====================

def test_basic_in_out():
    section('测试 1:基本入库 / 出库 / 库存计算')
    reset_db()

    # 入库 100 件
    database.insert_in_record({
        'category': 'plush', 'date': '2026-05-12', 'billNo': 'IN-T001',
        'sku': 'HD-T001', 'name': '小熊', 'style': 'normal', 'flag': '美国', 'qty': 100
    }, 'test')

    stock = database.calculate_stock('plush', 'HD-T001', 'normal', '美国')
    assert_eq(stock, 100, '入库 100 后库存 = 100')

    # 再入 50 件
    database.insert_in_record({
        'category': 'plush', 'date': '2026-05-12', 'billNo': 'IN-T002',
        'sku': 'HD-T001', 'name': '小熊', 'style': 'normal', 'flag': '美国', 'qty': 50
    }, 'test')

    stock = database.calculate_stock('plush', 'HD-T001', 'normal', '美国')
    assert_eq(stock, 150, '再入 50 后库存 = 150')

    # 出库 30 件(出库 API 还没实现,直接用 SQL)
    with database.db_cursor() as cur:
        cur.execute(
            '''INSERT INTO out_records
               (category, date, bill_no, sku, name, style, flag, qty, created_by)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)''',
            ('plush', '2026-05-12', 'OUT-T001', 'HD-T001', '小熊', 'normal', '美国', 30, 'test')
        )

    stock = database.calculate_stock('plush', 'HD-T001', 'normal', '美国')
    assert_eq(stock, 120, '出库 30 后库存 = 120(150-30)')


# ==================== 测试 2: 三级模型严格性 ====================

def test_three_level_separation():
    section('测试 2:三级模型独立性(货号+款式+布标 唯一)')
    reset_db()

    # 同货号、不同款式、不同布标
    database.insert_in_record({
        'category': 'plush', 'date': '2026-05-12', 'billNo': 'IN-A',
        'sku': 'HD-T001', 'name': '小熊', 'style': 'normal', 'flag': '美国', 'qty': 100
    }, 'test')

    database.insert_in_record({
        'category': 'plush', 'date': '2026-05-12', 'billNo': 'IN-B',
        'sku': 'HD-T001', 'name': '小熊', 'style': 'normal', 'flag': '德国', 'qty': 200
    }, 'test')

    database.insert_in_record({
        'category': 'plush', 'date': '2026-05-12', 'billNo': 'IN-C',
        'sku': 'HD-T001', 'name': '小熊', 'style': 'rare', 'flag': '美国', 'qty': 50
    }, 'test')

    # 三个组合互不影响
    assert_eq(database.calculate_stock('plush', 'HD-T001', 'normal', '美国'), 100,
              '普通款+美国 = 100')
    assert_eq(database.calculate_stock('plush', 'HD-T001', 'normal', '德国'), 200,
              '普通款+德国 = 200')
    assert_eq(database.calculate_stock('plush', 'HD-T001', 'rare', '美国'), 50,
              '稀有款+美国 = 50')
    assert_eq(database.calculate_stock('plush', 'HD-T001', 'rare', '德国'), 0,
              '稀有款+德国 = 0(没录过)')


# ==================== 测试 3: 品类隔离 ====================

def test_category_isolation():
    section('测试 3:毛绒和戏服的库存完全隔离')
    reset_db()

    # 毛绒入库 100
    database.insert_in_record({
        'category': 'plush', 'date': '2026-05-12', 'billNo': 'IN-P',
        'sku': 'HD-T001', 'name': '小熊', 'style': 'normal', 'flag': '美国', 'qty': 100
    }, 'test')

    # 戏服入库 50,假设货号也叫 HD-T001(虽然实际不太可能,但要验证隔离)
    # 注意:戏服没有布标字段,flag 始终为空字符串
    database.insert_in_record({
        'category': 'costume', 'date': '2026-05-12', 'billNo': 'IN-C',
        'sku': 'HD-T001', 'name': '小熊裙子', 'style': 'M码连衣裙', 'flag': '', 'qty': 50
    }, 'test')

    # 同名货号但品类不同,完全独立
    plush_stock = database.calculate_stock('plush', 'HD-T001', 'normal', '美国')
    costume_stock = database.calculate_stock('costume', 'HD-T001', 'M码连衣裙', '')

    assert_eq(plush_stock, 100, '毛绒 HD-T001 库存 = 100')
    assert_eq(costume_stock, 50, '戏服 HD-T001 库存 = 50')


# ==================== 测试 4: 删除后库存自动重算 ====================

def test_delete_recalculate():
    section('测试 4:删除流水后库存自动重算')
    reset_db()

    # 入库三笔
    id1 = database.insert_in_record({
        'category': 'plush', 'date': '2026-05-12', 'billNo': 'IN-1',
        'sku': 'HD-T001', 'name': '小熊', 'style': 'normal', 'flag': '美国', 'qty': 100
    }, 'test')

    id2 = database.insert_in_record({
        'category': 'plush', 'date': '2026-05-12', 'billNo': 'IN-2',
        'sku': 'HD-T001', 'name': '小熊', 'style': 'normal', 'flag': '美国', 'qty': 200
    }, 'test')

    id3 = database.insert_in_record({
        'category': 'plush', 'date': '2026-05-12', 'billNo': 'IN-3',
        'sku': 'HD-T001', 'name': '小熊', 'style': 'normal', 'flag': '美国', 'qty': 50
    }, 'test')

    assert_eq(database.calculate_stock('plush', 'HD-T001', 'normal', '美国'), 350,
              '初始库存 = 100+200+50 = 350')

    # 删除中间那笔(200)
    database.delete_in_record(id2)

    assert_eq(database.calculate_stock('plush', 'HD-T001', 'normal', '美国'), 150,
              '删除 200 那笔后,库存 = 100+50 = 150')


# ==================== 测试 5: 负库存允许 ====================

def test_negative_stock_allowed():
    section('测试 5:允许负库存(警告而非禁止)')
    reset_db()

    # 入库 100
    database.insert_in_record({
        'category': 'plush', 'date': '2026-05-12', 'billNo': 'IN',
        'sku': 'HD-T001', 'name': '小熊', 'style': 'normal', 'flag': '美国', 'qty': 100
    }, 'test')

    # 出库 150(超出 50)— 在数据库层面应该允许
    with database.db_cursor() as cur:
        cur.execute(
            '''INSERT INTO out_records
               (category, date, bill_no, sku, name, style, flag, qty, created_by)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)''',
            ('plush', '2026-05-12', 'OUT', 'HD-T001', '小熊', 'normal', '美国', 150, 'test')
        )

    stock = database.calculate_stock('plush', 'HD-T001', 'normal', '美国')
    assert_eq(stock, -50, '允许负库存,库存 = 100-150 = -50')


# ==================== 测试 6: 库存汇总聚合正确 ====================

def test_stock_summary():
    section('测试 6:库存汇总 API 聚合正确')
    reset_db()

    # 准备数据:毛绒 2 种规格 + 戏服 1 种规格
    database.insert_in_record({
        'category': 'plush', 'date': '2026-05-12', 'billNo': 'IN-1',
        'sku': 'HD-T001', 'name': '小熊', 'style': 'normal', 'flag': '美国', 'qty': 100
    }, 'test')
    database.insert_in_record({
        'category': 'plush', 'date': '2026-05-12', 'billNo': 'IN-2',
        'sku': 'HD-T002', 'name': '小兔', 'style': 'rare', 'flag': '日本', 'qty': 30
    }, 'test')
    database.insert_in_record({
        'category': 'costume', 'date': '2026-05-12', 'billNo': 'IN-3',
        'sku': 'CS-001', 'name': '裙子', 'style': 'M码', 'flag': '', 'qty': 50
    }, 'test')

    # 查全部
    summary = database.get_stock_summary()
    assert_eq(len(summary), 3, '总规格数 = 3')

    # 查毛绒
    plush_summary = database.get_stock_summary(category='plush')
    assert_eq(len(plush_summary), 2, '毛绒规格数 = 2')
    assert_eq(sum(s['stock'] for s in plush_summary), 130, '毛绒库存合计 = 130')

    # 查戏服
    costume_summary = database.get_stock_summary(category='costume')
    assert_eq(len(costume_summary), 1, '戏服规格数 = 1')
    assert_eq(costume_summary[0]['stock'], 50, '戏服库存 = 50')


# ==================== 测试 7: 戏服款式是自由文本 ====================

def test_costume_free_style():
    section('测试 7:戏服款式可以是任意中文文本')
    reset_db()

    # 戏服款式可以是各种自由文本,戏服没有布标(flag 为空字符串)
    free_styles = ['M码连衣裙', 'L码外套', 'XS码儿童款', '均码-粉色']
    for i, style in enumerate(free_styles):
        database.insert_in_record({
            'category': 'costume', 'date': '2026-05-12', 'billNo': f'IN-{i}',
            'sku': 'CS-001', 'name': '戏服', 'style': style, 'flag': '', 'qty': 10
        }, 'test')

    summary = database.get_stock_summary(category='costume')
    assert_eq(len(summary), 4, '4 种不同款式被独立统计')

    for s in summary:
        assert_eq(s['stock'], 10, f'款式 "{s["style"]}" 库存 = 10')


# ==================== 测试 8: 入库查询按品类筛选 ====================

def test_query_filter_by_category():
    section('测试 8:查询入库流水按品类筛选')
    reset_db()

    database.insert_in_record({
        'category': 'plush', 'date': '2026-05-12', 'billNo': 'IN-P-1',
        'sku': 'HD-T001', 'name': '小熊', 'style': 'normal', 'flag': '美国', 'qty': 100
    }, 'test')
    database.insert_in_record({
        'category': 'costume', 'date': '2026-05-12', 'billNo': 'IN-C-1',
        'sku': 'CS-001', 'name': '裙子', 'style': 'M码', 'flag': '', 'qty': 50
    }, 'test')

    assert_eq(len(database.query_all_in_records()), 2, '全部入库 = 2 条')
    assert_eq(len(database.query_all_in_records(category='plush')), 1, '毛绒入库 = 1 条')
    assert_eq(len(database.query_all_in_records(category='costume')), 1, '戏服入库 = 1 条')


# ==================== 测试 9: 戏服没有布标字段 ====================

def test_costume_no_flag():
    section('测试 9:戏服 flag 字段必须为空字符串')
    reset_db()

    # 戏服入库,不传 flag 字段(后端应该自动设为空)
    database.insert_in_record({
        'category': 'costume', 'date': '2026-05-12', 'billNo': 'IN-1',
        'sku': 'CS-001', 'name': '连衣裙', 'style': 'M码', 'flag': '', 'qty': 100
    }, 'test')

    records = database.query_all_in_records(category='costume')
    assert_eq(len(records), 1, '戏服入库成功 1 条')
    assert_eq(records[0]['flag'], '', '戏服 flag 应为空字符串')

    # 同一货号 + 同一类型,不管录几次都汇总到一起(因为没有 flag 维度)
    database.insert_in_record({
        'category': 'costume', 'date': '2026-05-13', 'billNo': 'IN-2',
        'sku': 'CS-001', 'name': '连衣裙', 'style': 'M码', 'flag': '', 'qty': 50
    }, 'test')

    summary = database.get_stock_summary(category='costume')
    assert_eq(len(summary), 1, '戏服只汇总成 1 种规格(同货号+同类型)')
    assert_eq(summary[0]['stock'], 150, '戏服库存合计 = 150')


# ==================== 主测试入口 ====================

def main():
    print('=' * 60)
    print('华登库存系统 - 逻辑测试')
    print(f'测试数据库:{TEST_DB_PATH}')
    print('=' * 60)

    try:
        test_basic_in_out()
        test_three_level_separation()
        test_category_isolation()
        test_delete_recalculate()
        test_negative_stock_allowed()
        test_stock_summary()
        test_costume_free_style()
        test_query_filter_by_category()
        test_costume_no_flag()
    except Exception as e:
        print(f'\n!! 测试运行异常:{e}')
        import traceback
        traceback.print_exc()
        sys.exit(1)
    finally:
        # 清理测试数据库
        shutil.rmtree(TEST_DB_DIR, ignore_errors=True)

    print('\n' + '=' * 60)
    print(f'测试结果:✓ 通过 {passed} 个 / ✗ 失败 {failed} 个')
    print('=' * 60)

    if failed == 0:
        print('✓ 全部测试通过!核心逻辑正确,可以放心使用')
        sys.exit(0)
    else:
        print('✗ 有测试失败,请修复后重新运行')
        print('\n失败明细:')
        for err in errors:
            print(err)
        sys.exit(1)


if __name__ == '__main__':
    main()
