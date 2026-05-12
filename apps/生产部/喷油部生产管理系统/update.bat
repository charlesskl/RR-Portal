@echo off
chcp 65001 >nul
cd /d %~dp0

echo [1/4] 杀掉正在跑的 node.exe ...
taskkill /F /IM node.exe >nul 2>&1

echo [2/4] 拉取最新代码 ...
git pull
if errorlevel 1 (echo git pull 失败 & pause & exit /b 1)

echo [3/4] 补装可能的新依赖 ...
cd server && call npm install --silent
cd ..\client && call npm install --silent
cd ..

echo [4/4] 启动服务 ...
start "penyou-server" cmd /k "cd server && npm start"
timeout /t 2 /nobreak >nul
start "penyou-client" cmd /k "cd client && npm run dev"

echo.
echo 访问: http://localhost:5173
echo 局域网:http://^<本机IP^>:5173
pause
