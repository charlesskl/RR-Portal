@echo off
echo ============================================
echo  Quotation System - First Time Setup
echo ============================================
echo.
node -v >/dev/null 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js not found. Please install from:
    echo   https://nodejs.org/en/
    echo   Then re-run this script.
    pause
    exit /b 1
)
echo [OK] Node.js detected:
node -v
echo.
echo Installing dependencies, please wait...
npm install --omit=dev
if %errorlevel% neq 0 (
    echo [ERROR] Installation failed. Check your network and retry.
    pause
    exit /b 1
)
echo.
echo ============================================
echo  Done! Now run: Start System.bat
echo ============================================
pause