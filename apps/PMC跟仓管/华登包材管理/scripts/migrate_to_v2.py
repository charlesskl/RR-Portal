"""手动 V1 → V2 迁移 CLI（独立运行，不需要起 Flask）。

用法: python scripts/migrate_to_v2.py <path/to/huadeng.db>

⚠️ 运行前停掉 Flask 服务，避免：
  1) shutil.copy2 拷不到 -wal/-shm 变更（如果是 WAL 模式）
  2) 并发写入导致 schema 不一致

实现：
- 实际迁移逻辑在 ../_migration.py（与 app.py init_db 共用，避免分叉）
- 此脚本仅做参数解析 + 调用入口

幂等：
- 已迁移 (records 已 drop) / 全新 DB → exit code 2 (ABORT)
- 第一次跑 v1 DB → 备份 + 迁移 + drop 旧表 → exit code 0
"""
import os
import sys

# 把上级目录加进 path，让 `from _migration import ...` 能解析到 app 目录的 _migration.py
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from _migration import needs_v1_to_v2_migration, run_v1_to_v2_migration  # noqa: E402


if __name__ == '__main__':
    if len(sys.argv) != 2:
        print('Usage: python scripts/migrate_to_v2.py <db_path>', file=sys.stderr)
        sys.exit(1)

    db_path = sys.argv[1]

    if not needs_v1_to_v2_migration(db_path):
        print(
            '[ABORT] already migrated or fresh DB — no v1 records table. '
            'Restore from backup if you need to re-run.',
            file=sys.stderr,
        )
        sys.exit(2)

    run_v1_to_v2_migration(db_path)
