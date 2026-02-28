@echo off
chcp 65001 >nul
title 3D打印管理系统 - 多人协作服务器 (端口3001)
cd /d "%~dp0"

:: 加载 .env 文件中的打印机配置
for /f "usebackq tokens=1,* delims==" %%a in (".env") do (
    set "line=%%a"
    if not "!line:~0,1!"=="#" set "%%a=%%b"
)

:: 设置端口和数据路径
set PORT=3001
set DATA_PATH=%~dp0data\data.json

echo.
echo  正在启动 3D打印部门管理系统 (多人协作版)...
echo  端口: %PORT%
echo  数据: %DATA_PATH%
echo.

:: 关闭占用端口的旧进程
for /f "tokens=5" %%a in ('netstat -aon 2^>nul ^| findstr "0.0.0.0:3001" ^| findstr "LISTENING"') do (
    echo 关闭旧进程 %%a...
    taskkill /F /PID %%a >nul 2>&1
)

node "%~dp0server.js"
pause
