@echo off
echo ============================================
echo  Quotation System - Starting...
echo ============================================
echo.
if not exist node_modules (
    echo [ERROR] Please run Install.bat first.
    pause
    exit /b 1
)
echo Open browser and go to:
echo.
echo     http://localhost:3000
echo.
echo Close this window to stop the system.
echo ============================================
echo.
node server\server.js
pause