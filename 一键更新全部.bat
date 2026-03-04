@echo off
chcp 65001 >nul
echo ========================================
echo   RR Portal - 一键更新全部插件到云端
echo ========================================
echo.

:: 检查环境变量
if "%CLOUD_HOST%"=="" (
    echo ❌ 请先设置环境变量：
    echo    set CLOUD_HOST=你的服务器IP
    echo    set CLOUD_PASS=你的服务器密码
    echo.
    pause
    exit /b 1
)
if "%CLOUD_PASS%"=="" (
    echo ❌ 请先设置环境变量：
    echo    set CLOUD_PASS=你的服务器密码
    echo.
    pause
    exit /b 1
)

set "ROOT=%~dp0"
cd /d "%ROOT%"

:: ──────────────────────────────────
:: Step 1: 更新工程啤办单 (从 GitHub)
:: ──────────────────────────────────
echo [1/5] 更新工程啤办单...
cd /d "%ROOT%plugins\工程啤办单"
if exist ".git" (
    git stash >nul 2>&1
    git pull origin main
    if errorlevel 1 (
        echo     ⚠️ 工程啤办单拉取失败，跳过
        git stash pop >nul 2>&1
    ) else (
        git stash pop >nul 2>&1
        echo     ✅ 工程啤办单已更新
    )
) else (
    echo     ⚠️ 工程啤办单没有 .git，跳过
)

:: ──────────────────────────────────
:: Step 2: 更新印尼小组 (从 GitHub clone)
:: ──────────────────────────────────
echo [2/5] 更新印尼小组...
set "INDO_TEMP=%TEMP%\Export-to-Indonesia"
if exist "%INDO_TEMP%" rmdir /S /Q "%INDO_TEMP%"
git clone --depth 1 https://github.com/charlesskl/Export-to-Indonesia "%INDO_TEMP%" >nul 2>&1
if errorlevel 1 (
    echo     ⚠️ 印尼小组拉取失败，跳过
) else (
    copy /Y "%INDO_TEMP%\印尼出货明细资料核对系统.html" "%ROOT%plugins\印尼小组\印尼出货明细资料核对系统.html" >nul
    copy /Y "%INDO_TEMP%\Dockerfile" "%ROOT%plugins\印尼小组\Dockerfile" >nul
    xcopy /Y /E /I /Q "%INDO_TEMP%\nginx\*" "%ROOT%plugins\印尼小组\nginx\" >nul 2>&1
    xcopy /Y /E /I /Q "%INDO_TEMP%\scripts\*" "%ROOT%plugins\印尼小组\scripts\" >nul 2>&1
    rmdir /S /Q "%INDO_TEMP%" >nul 2>&1
    echo     ✅ 印尼小组已更新
)

:: ──────────────────────────────────
:: Step 3: 提交并推送到 GitHub
:: ──────────────────────────────────
echo [3/5] 提交变更并推送到 GitHub...
cd /d "%ROOT%"
git add -A
git diff --cached --quiet
if errorlevel 1 (
    git commit -m "chore: sync plugins from upstream repos"
    git push
    if errorlevel 1 (
        echo     ❌ 推送到 GitHub 失败！
        pause
        exit /b 1
    )
    echo     ✅ 已推送到 GitHub
) else (
    echo     ℹ️ 没有变更需要推送
)

:: ──────────────────────────────────
:: Step 4: SSH 到云端执行更新
:: ──────────────────────────────────
echo [4/5] 正在更新云端服务器...
python "%ROOT%deploy\remote-exec.py" "cd /opt/rr-portal && git pull && docker compose -f docker-compose.cloud.yml --env-file .env.cloud.production up -d --build"
if errorlevel 1 (
    echo     ❌ 云端更新失败！
    pause
    exit /b 1
)

:: ──────────────────────────────────
:: Step 5: 健康检查
:: ──────────────────────────────────
echo [5/5] 等待服务启动 (20秒)...
timeout /t 20 /nobreak >nul
python "%ROOT%deploy\remote-exec.py" "curl -sf http://localhost/nginx-health > /dev/null 2>&1 && echo '✅ 服务正常运行' || echo '⚠️ nginx 未响应，请检查: docker compose -f docker-compose.cloud.yml logs'"

echo.
echo ========================================
echo   更新完成！
echo ========================================
pause
