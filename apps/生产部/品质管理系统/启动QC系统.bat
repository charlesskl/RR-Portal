@echo off
chcp 65001 >nul
title 兴信 QMS 品质管理系统 - 后端服务器(Node+SQLite)
cd /d "%~dp0"
set PORT=8765
set NODE_NO_WARNINGS=1

echo ====================================================
echo   兴信 QMS 品质管理系统  (Node + SQLite 后端)
echo   数据库: %~dp0server\qc.db
echo   本机访问:   http://localhost:%PORT%/index.html
echo   局域网访问: http://192.168.3.55:%PORT%/index.html
echo   账号: jc  密码: qqwwee
echo   关闭本窗口即可停止服务
echo ====================================================
echo.

where node >nul 2>nul
if %errorlevel% NEQ 0 (
  echo [错误] 未检测到 Node.js，请先安装 Node 后再运行本脚本。
  pause
  goto :eof
)

echo [启动] 正在启动后端服务器 (端口 %PORT%) ...
start "" http://localhost:%PORT%/index.html
node "%~dp0server\server.js"

echo.
echo [已停止] 服务器进程已退出。
pause
