@echo off
chcp 65001 >nul
echo 正在更新新产品开发进度表系统...
cd /d "%~dp0"
cd ..\..
docker compose build dev-progress
docker compose up -d dev-progress
docker compose restart nginx
echo 更新完成！
pause
