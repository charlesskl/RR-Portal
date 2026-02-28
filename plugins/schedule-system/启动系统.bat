@echo off
chcp 65001 >nul
title 排期录入系统【测试版】- 端口5001
cd /d "%~dp0"
echo 正在关闭旧进程...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :5001 ^| findstr LISTENING') do taskkill /F /PID %%a >nul 2>&1
timeout /t 1 >nul
start "" http://localhost:5001
"C:\Users\Administrator\AppData\Local\Programs\Python\Python312\python.exe" app.py
pause
