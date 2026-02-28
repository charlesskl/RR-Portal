@echo off
chcp 65001 >nul
echo ========================================
echo   3D打印 - 从 GitHub 拉取最新代码
echo ========================================
echo.

cd /d "%~dp0"

:: ──────────────────────────────────────
:: 请在下方设置 GitHub 仓库地址
:: 例如: set REPO_URL=https://github.com/wendyxiaowen/3D-
:: ──────────────────────────────────────
set REPO_URL=https://github.com/wendyxiaowen/3D-.git

if "%REPO_URL%"=="" (
    echo.
    echo ❌ 尚未设置 GitHub 仓库地址！
    echo.
    echo 请用记事本打开此文件，修改第 14 行：
    echo   set REPO_URL=https://github.com/wendyxiaowen/3D-
    echo.
    pause
    exit /b 1
)

:: 检查是否已初始化 Git
if not exist ".git" (
    echo 首次运行，正在克隆仓库...
    echo.
    git clone %REPO_URL% temp_clone
    if errorlevel 1 (
        echo.
        echo ❌ 克隆失败！请检查仓库地址和网络连接
        pause
        exit /b 1
    )
    :: 将克隆内容移到当前目录（保留此 bat 文件）
    xcopy /E /Y /I temp_clone\* .
    xcopy /E /Y /H temp_clone\.git .git\
    rd /S /Q temp_clone
    echo.
    echo ✅ 仓库克隆完成！
) else (
    echo 正在拉取最新代码...
    git pull origin main
    if errorlevel 1 (
        echo.
        echo ❌ 拉取失败！请检查网络连接
        pause
        exit /b 1
    )
    echo.
    echo ✅ 代码已更新到最新版本！
)

:: 重新构建 Docker 服务（如果有的话）
echo.
echo 正在重新构建 Docker 服务...
cd /d "%~dp0..\.."
docker compose up -d --build 2>nul
if errorlevel 1 (
    echo.
    echo ⚠️ Docker 重建跳过（可能尚未配置 Docker 服务）
)

echo.
echo ========================================
echo   ✅ 更新完成！
echo ========================================
pause
