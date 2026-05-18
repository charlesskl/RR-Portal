@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ========================================
echo 华登库存管理系统 (毛绒 + 戏服) 启动中...
echo ========================================
echo.

if not exist "data\inventory.db" (
    echo [首次启动] 正在初始化数据库...
    python init_db.py
    echo.
)

echo 按 Ctrl+C 停止服务
echo.
python serve.py

pause
