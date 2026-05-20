"""
数据库备份脚本
使用:python backup.py
建议设置为定时任务每天凌晨 2 点跑(Windows 任务计划 / Linux cron)
"""
import shutil
import os
import glob
from datetime import datetime, timedelta

BACKUP_DIR = 'backup'
KEEP_DAYS = 30
DB_PATH = 'data/inventory.db'


def backup():
    os.makedirs(BACKUP_DIR, exist_ok=True)

    if not os.path.exists(DB_PATH):
        print(f'✗ 数据库文件不存在: {DB_PATH}')
        return False

    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    dst = f'{BACKUP_DIR}/inventory_{timestamp}.db'
    shutil.copy2(DB_PATH, dst)
    size_kb = os.path.getsize(dst) / 1024
    print(f'✓ 备份完成: {dst} ({size_kb:.1f} KB)')

    # 删除 30 天前的备份
    cutoff = datetime.now() - timedelta(days=KEEP_DAYS)
    cleaned = 0
    for f in glob.glob(f'{BACKUP_DIR}/inventory_*.db'):
        if datetime.fromtimestamp(os.path.getmtime(f)) < cutoff:
            os.remove(f)
            cleaned += 1
    if cleaned:
        print(f'✓ 清理了 {cleaned} 个 {KEEP_DAYS} 天前的旧备份')

    return True


if __name__ == '__main__':
    backup()
