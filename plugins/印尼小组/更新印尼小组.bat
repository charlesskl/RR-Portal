@echo off
chcp 65001 >nul
echo ========================================
echo   印尼小组 - 拉取最新代码并更新到云端
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

:: 从 GitHub clone 最新代码
echo [1/4] 从 GitHub 拉取最新代码...
set "TEMP_DIR=%TEMP%\Export-to-Indonesia"
if exist "%TEMP_DIR%" rmdir /S /Q "%TEMP_DIR%"
git clone --depth 1 https://github.com/charlesskl/Export-to-Indonesia "%TEMP_DIR%"
if errorlevel 1 (
    echo ❌ 代码拉取失败！
    pause
    exit /b 1
)

echo     复制文件...
copy /Y "%TEMP_DIR%\印尼出货明细资料核对系统.html" "%~dp0印尼出货明细资料核对系统.html" >nul
copy /Y "%TEMP_DIR%\Dockerfile" "%~dp0Dockerfile" >nul
xcopy /Y /E /I /Q "%TEMP_DIR%\nginx\*" "%~dp0nginx\" >nul 2>&1
xcopy /Y /E /I /Q "%TEMP_DIR%\scripts\*" "%~dp0scripts\" >nul 2>&1
rmdir /S /Q "%TEMP_DIR%" >nul 2>&1

:: 提交并推送到 GitHub，再更新云端
echo [2/4] 推送到 GitHub 并更新云端...
cd /d "%ROOT%"
git add -A
git diff --cached --quiet
if errorlevel 1 (
    git commit -m "chore: sync 印尼小组 from upstream"
    git push
)
echo [3/4] 更新云端服务器...
python "%ROOT%\deploy\remote-exec.py" "cd /opt/rr-portal && git pull && docker compose -f docker-compose.cloud.yml --env-file .env.cloud.production up -d --build indonesia-export && docker compose -f docker-compose.cloud.yml restart nginx"

:: 健康检查
echo [4/4] 等待服务启动...
timeout /t 15 /nobreak >nul
python "%ROOT%\deploy\remote-exec.py" "curl -sf http://localhost/nginx-health > /dev/null 2>&1 && echo '✅ 云端服务正常' || echo '⚠️ 请检查日志'"

echo.
echo ========================================
echo   ✅ 更新完成！印尼小组已部署到云端
echo ========================================
pause
