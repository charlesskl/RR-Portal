"""
数据库初始化脚本

功能:
1. 创建所有表
2. 创建三个默认账号(admin / cg / yk,密码都是 123456)
3. 创建默认布标(8 个常用国家)
4. 插入示例数据(毛绒 + 戏服各几条)

使用:
    python init_db.py

注意:如果数据库已有用户数据,会跳过初始化,不重复插入。
"""
import database as db
from auth import hash_password


def seed_initial_data():
    """初始化基础数据"""
    with db.db_cursor() as cur:
        # 检查是否已初始化
        cur.execute('SELECT COUNT(*) FROM users')
        if cur.fetchone()[0] > 0:
            print('✓ 数据库已经初始化过,跳过')
            return

        print('  - 创建默认用户...')
        default_users = [
            ('admin', '123456', 'admin', '系统管理员'),
            ('cg', '123456', 'operator', '仓管员'),
            ('yk', '123456', 'viewer', '访客'),
        ]
        for username, password, role, display_name in default_users:
            cur.execute(
                'INSERT INTO users (username, password_hash, role, display_name) VALUES (?, ?, ?, ?)',
                (username, hash_password(password), role, display_name)
            )

        print('  - 创建默认布标...')
        default_flags = ['中国', '美国', '德国', '日本', '英国', '法国', '澳洲', '加拿大']
        for i, flag in enumerate(default_flags):
            cur.execute('INSERT INTO flags (name, sort_order) VALUES (?, ?)', (flag, i))

        print('  - 插入毛绒示例数据...')
        # (category, date, bill_no, sku, name, style, flag, qty)
        sample_plush_in = [
            ('plush', '2026-05-08', 'IN-001', 'HD-T001', '小熊毛绒 25cm 棕色', 'normal', '美国', 800),
            ('plush', '2026-05-08', 'IN-002', 'HD-T001', '小熊毛绒 25cm 棕色', 'normal', '德国', 500),
            ('plush', '2026-05-08', 'IN-003', 'HD-T001', '小熊毛绒 25cm 棕色', 'rare', '日本', 120),
            ('plush', '2026-05-09', 'IN-004', 'HD-T002', '小兔毛绒 30cm 白色', 'normal', '美国', 600),
            ('plush', '2026-05-09', 'IN-005', 'HD-T002', '小兔毛绒 30cm 白色', 'normal', '英国', 300),
            ('plush', '2026-05-10', 'IN-006', 'HD-T003', '恐龙毛绒 20cm 绿色', 'normal', '澳洲', 900),
            ('plush', '2026-05-11', 'IN-007', 'HD-T003', '恐龙毛绒 20cm 绿色', 'rare', '日本', 80),
        ]
        for row in sample_plush_in:
            cur.execute(
                '''INSERT INTO in_records
                   (category, date, bill_no, sku, name, style, flag, qty, created_by)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)''',
                row + ('system',)
            )

        print('  - 插入戏服示例数据...')
        # 戏服 style 是自由文本,flag 始终为空字符串(戏服没有布标这个字段)
        sample_costume_in = [
            ('costume', '2026-05-09', 'IN-101', 'CS-001', '小熊配套连衣裙', 'M码连衣裙', '', 200),
            ('costume', '2026-05-09', 'IN-102', 'CS-001', '小熊配套连衣裙', 'L码连衣裙', '', 150),
            ('costume', '2026-05-10', 'IN-103', 'CS-002', '小兔配套T恤', 'S码T恤', '', 300),
            ('costume', '2026-05-11', 'IN-104', 'CS-002', '小兔配套T恤', 'M码T恤', '', 250),
            ('costume', '2026-05-11', 'IN-105', 'CS-003', '恐龙主题外套', 'L码外套', '', 100),
        ]
        for row in sample_costume_in:
            cur.execute(
                '''INSERT INTO in_records
                   (category, date, bill_no, sku, name, style, flag, qty, created_by)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)''',
                row + ('system',)
            )

        print('  - 插入出库示例数据...')
        # (category, date, bill_no, po, picker, sku, name, style, flag, qty)
        # 戏服的 flag 始终为空字符串
        sample_out = [
            # 毛绒出库(有布标)
            ('plush', '2026-05-10', 'OUT-001', 'PO-2026-0418', '王师傅', 'HD-T001', '小熊毛绒 25cm 棕色', 'normal', '美国', 300),
            ('plush', '2026-05-11', 'OUT-002', 'PO-2026-0422', '李工', 'HD-T002', '小兔毛绒 30cm 白色', 'normal', '英国', 250),
            ('plush', '2026-05-12', 'OUT-003', 'PO-2026-0429', '王师傅', 'HD-T003', '恐龙毛绒 20cm 绿色', 'rare', '日本', 50),
            # 戏服出库(无布标)
            ('costume', '2026-05-11', 'OUT-101', 'PO-2026-0422', '李工', 'CS-001', '小熊配套连衣裙', 'M码连衣裙', '', 80),
            ('costume', '2026-05-12', 'OUT-102', 'PO-2026-0429', '王师傅', 'CS-002', '小兔配套T恤', 'M码T恤', '', 100),
        ]
        for row in sample_out:
            cur.execute(
                '''INSERT INTO out_records
                   (category, date, bill_no, po, picker, sku, name, style, flag, qty, created_by)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)''',
                row + ('system',)
            )


if __name__ == '__main__':
    print('=' * 50)
    print('华登库存系统 - 数据库初始化')
    print('=' * 50)
    print()

    print('[1/2] 创建表结构...')
    db.init_database()
    print('  ✓ 完成')

    print('[2/2] 插入初始数据...')
    seed_initial_data()
    print('  ✓ 完成')

    print()
    print('=' * 50)
    print('初始化完成!')
    print('=' * 50)
    print()
    print('默认账号(请尽快修改密码):')
    print('  admin / 123456 (主管 - 全部权限)')
    print('  cg / 123456    (仓管员 - 录入和查看)')
    print('  yk / 123456    (游客 - 只读)')
    print()
    print('已插入示例数据:')
    print('  毛绒仓: 7 条入库 + 3 条出库')
    print('  戏服仓: 5 条入库 + 2 条出库')
    print()
    print('现在可以运行 python app.py 启动服务了')
