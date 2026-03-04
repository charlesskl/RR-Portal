@echo off
chcp 65001 >nul
echo ========================================
echo   工程啤办单 - 拉取最新代码并更新到云端
echo ========================================
echo.

:: 检查环境变量
if "%CLOUD_HOST%"=="" (
    echo ❌ 请先设置环境变量：
    echo    set CLOUD_HOST=你的服务器IP
    echo    set CLOUD_PASS=你的服务器密码
    pause
    exit /b 1
)

set "ROOT=%~dp0..\.."

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
    echo ❌ 代码拉取失败！
    pause
    exit /b 1
)
git stash pop >nul 2>&1

:: 恢复数据（防止 git pull 覆盖）
if exist "%~dp0data\data.json.bak" (
    copy /Y "%~dp0data\data.json.bak" "%~dp0data\data.json" >nul 2>&1
)

:: 提交并推送到 GitHub，再更新云端
echo [3/4] 推送到 GitHub 并更新云端...
cd /d "%ROOT%"
git add -A
git diff --cached --quiet
if errorlevel 1 (
    git commit -m "chore: sync 工程啤办单 from upstream"
    git push
)
python "%ROOT%\deploy\remote-exec.py" "cd /opt/rr-portal && git pull && docker compose -f docker-compose.cloud.yml --env-file .env.cloud.production up -d --build rr-production && docker compose -f docker-compose.cloud.yml restart nginx"

:: 健康检查
echo [4/4] 等待服务启动...
timeout /t 15 /nobreak >nul
python "%ROOT%\deploy\remote-exec.py" "curl -sf http://localhost/nginx-health > /dev/null 2>&1 && echo '✅ 云端服务正常' || echo '⚠️ 请检查日志'"

echo.
echo ========================================
echo   ✅ 更新完成！工程啤办单已部署到云端
echo ========================================
pause
