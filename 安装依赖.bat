@echo off
chcp 65001 >nul
echo ============================================
echo     报价系统 - 首次安装
echo ============================================
echo.

:: 检查 Node.js
node -v >nul 2>&1
if %errorlevel% neq 0 (
    echo [错误] 未检测到 Node.js，请先安装 Node.js：
    echo   下载地址：https://nodejs.org/zh-cn/
    echo   安装完成后重新运行此脚本
    pause
    exit /b 1
)

echo [OK] Node.js 已安装：
node -v
echo.
echo 正在安装依赖，请稍候...
npm install --omit=dev
if %errorlevel% neq 0 (
    echo [错误] 依赖安装失败，请检查网络连接后重试
    pause
    exit /b 1
)

echo.
echo ============================================
echo     安装完成！请运行"启动系统.bat"
echo ============================================
pause
