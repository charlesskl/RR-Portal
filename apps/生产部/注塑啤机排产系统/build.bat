@echo off
chcp 65001 >nul
echo 构建前端...
cd /d %~dp0client
call npm run build
echo.
echo 构建完成！前端已打包到 client/dist
echo 直接运行 server/node app.js 即可访问 http://localhost:3000
pause
