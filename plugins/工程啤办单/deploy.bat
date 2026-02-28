@echo off
chcp 65001 >nul
echo ========================================
echo   生产订单管理系统 - 自动更新部署
echo ========================================

:: 停止正在运行的 Node 进程
echo [1/4] 停止服务...
taskkill /F /IM node.exe 2>nul
timeout /t 2 /nobreak >nul

:: 从 GitHub 拉取最新代码
echo [2/4] 拉取最新代码...
git pull origin main
if errorlevel 1 (
    echo ❌ 代码拉取失败！请检查网络或 Git 配置
    pause
    exit /b 1
)

:: 安装依赖（如有新增）
echo [3/4] 检查依赖...
call npm install --production

:: 启动服务
echo [4/4] 启动服务...
start /B node server.js
timeout /t 2 /nobreak >nul

echo ========================================
echo   ✅ 更新完成！系统已重新启动
echo ========================================
pause
