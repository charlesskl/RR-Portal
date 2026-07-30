@echo off
chcp 65001 >nul
title 3D Printer Management Server
cd /d "%~dp0"

:loop
echo [%date% %time%] Starting server...
node server.js
if %errorlevel% equ 0 goto :eof
echo [%date% %time%] Server stopped with code %errorlevel%. Restarting in 5 seconds...
timeout /t 5 /nobreak >nul
goto loop
