@echo off
chcp 65001 >nul
echo ========================================
echo   RR Portal - 启动所有服务
echo ========================================
echo.

cd /d "%~dp0"

echo 正在启动 Docker 服务...
docker compose up -d --build
if errorlevel 1 (
    echo.
    echo ❌ 启动失败！请确认 Docker Desktop 已运行
    pause
    exit /b 1
)

echo.
echo 等待服务就绪...
timeout /t 5 /nobreak >nul

echo.
echo ========================================
echo   ✅ 所有服务已启动！
echo ========================================
echo.
echo   Portal 主页:         http://localhost
echo   工程啤办单:           http://localhost/rr/
echo   Zuru MA 包装差价系统: http://localhost/zuru-ma/
echo.
echo ========================================
pause
