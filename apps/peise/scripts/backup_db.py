"""每日 DB 备份:用 SQLite backup API 拷贝 instance/peise.db 到 instance/backups/。

用 Online Backup API 而不是 shutil.copy,避免 Flask 正在写时拷到一个半成品的文件。
不删旧备份,保留全部历史;磁盘占用自己监控。
"""
from __future__ import annotations

import sqlite3
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "instance" / "peise.db"
DST_DIR = ROOT / "instance" / "backups"


def main() -> int:
    if not SRC.exists():
        print(f"[backup] source missing: {SRC}", file=sys.stderr)
        return 1
    DST_DIR.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M")
    dst = DST_DIR / f"peise-{stamp}.db"
    # 同一分钟多次执行不覆盖
    i = 2
    while dst.exists():
        dst = DST_DIR / f"peise-{stamp}-{i}.db"
        i += 1
    src_conn = sqlite3.connect(f"file:{SRC}?mode=ro", uri=True)
    dst_conn = sqlite3.connect(str(dst))
    try:
        with dst_conn:
            src_conn.backup(dst_conn)
    finally:
        src_conn.close()
        dst_conn.close()
    size = dst.stat().st_size
    print(f"[backup] ok -> {dst}  ({size:,} bytes)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
