@echo off
chcp 65001 >nul
cd /d %~dp0

echo [1/2] 启动后端...
start "penyou-server" cmd /k "cd server && npm start"

timeout /t 2 /nobreak >nul

echo [2/2] 启动前端...
start "penyou-client" cmd /k "cd client && npm run dev"

echo.
echo 访问: http://localhost:5173
echo 局域网访问: http://^<本机IP^>:5173
pause
