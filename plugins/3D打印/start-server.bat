@echo off
title 3D打印管理系统
cd /d "%~dp0"

:loop
echo [%date% %time%] 启动服务...
node server.js
echo [%date% %time%] 服务异常退出，5秒后重启...
timeout /t 5 /nobreak >nul
goto loop
