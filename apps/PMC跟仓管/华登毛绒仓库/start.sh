#!/bin/bash
cd "$(dirname "$0")"

echo "========================================"
echo "华登库存管理系统 (毛绒 + 戏服) 启动中..."
echo "========================================"
echo

if [ ! -f "data/inventory.db" ]; then
    echo "[首次启动] 正在初始化数据库..."
    python3 init_db.py
    echo
fi

echo "按 Ctrl+C 停止服务"
echo
python3 serve.py
