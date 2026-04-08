@echo off
chcp 65001 >nul
echo ============================================
echo     报价系统启动中...
echo ============================================
echo.

:: 检查 node_modules
if not exist "node_modules" (
    echo [提示] 首次使用请先运行"安装依赖.bat"
    pause
    exit /b 1
)

echo 系统启动成功后，请用浏览器打开：
echo.
echo     http://localhost:3000
echo.
echo 关闭此窗口即可停止系统
echo ============================================
echo.
node server\server.js
pause
