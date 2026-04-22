@echo off
chcp 65001 >nul
echo 启动 AI注塑啤机排产系统...
echo.
echo 后端: http://localhost:3000
echo 前端开发: http://localhost:3001
echo.

start "AI排机-后端" cmd /k "cd /d %~dp0server && node app.js"
timeout /t 2 >nul
start "AI排机-前端" cmd /k "cd /d %~dp0client && npm run dev"
timeout /t 3 >nul
start "" "http://localhost:3001"
