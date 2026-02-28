@echo off
chcp 65001 >nul
echo ========================================
echo   工程啤办单 - 拉取最新代码并重新部署
echo ========================================
echo.

:: 备份数据
echo [1/4] 备份数据...
copy /Y "%~dp0data\data.json" "%~dp0data\data.json.bak" >nul 2>&1

:: 拉取最新代码
echo [2/4] 从 GitHub 拉取最新代码...
cd /d "%~dp0"
git stash >nul 2>&1
git pull origin main
if errorlevel 1 (
    git stash pop >nul 2>&1
    echo.
    echo ❌ 代码拉取失败！请检查网络或 Git 配置
    pause
    exit /b 1
)
git stash pop >nul 2>&1

:: 恢复数据（防止 git pull 覆盖）
if exist "%~dp0data\data.json.bak" (
    copy /Y "%~dp0data\data.json.bak" "%~dp0data\data.json" >nul 2>&1
)

:: 重新构建 Docker 服务
echo [3/4] 重新构建 Docker 服务...
cd /d "%~dp0..\.."
docker compose up -d --build rr-production
if errorlevel 1 (
    echo.
    echo ❌ Docker 构建失败！
    pause
    exit /b 1
)

:: 等待服务启动
echo [4/4] 等待服务启动...
timeout /t 5 /nobreak >nul

echo.
echo ========================================
echo   ✅ 更新完成！工程啤办单已重新部署
echo ========================================
echo   访问地址: http://localhost/rr/
echo ========================================
pause
