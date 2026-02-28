@echo off
cd /d "%~dp0"

echo ============================================
echo   Production Order System - Starting...
echo ============================================
echo.

node -v >nul 2>&1
if errorlevel 1 (
  echo ERROR: Node.js not found. Please install Node.js first.
  pause
  exit /b 1
)

if not exist node_modules (
  echo Installing dependencies...
  npm install
  echo Done.
  echo.
)

for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| findstr "0.0.0.0:3000" ^| findstr "LISTENING"') do (
  echo Stopping old process %%a...
  taskkill /F /PID %%a >nul 2>&1
)

echo Starting server...
echo.
node server.js
echo.
echo Server stopped.
pause
