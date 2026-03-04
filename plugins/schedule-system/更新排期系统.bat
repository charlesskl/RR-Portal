@echo off
chcp 65001 >nul
echo ========================================
echo   排期录入系统 - 拉取最新代码并重新部署
echo ========================================
echo.

:: 备份数据
echo [1/4] 备份数据...
if exist "%~dp0data\config.json" copy /Y "%~dp0data\config.json" "%~dp0data\config.json.bak" >nul 2>&1

:: 从 GitHub 拉取最新代码
echo [2/4] 从 GitHub 拉取最新代码...
set "TEMP_DIR=%TEMP%\schedule-system"
if exist "%TEMP_DIR%" rmdir /S /Q "%TEMP_DIR%"
git clone --depth 1 https://github.com/hanson678/schedule-system "%TEMP_DIR%"
if errorlevel 1 (
    echo.
    echo ❌ 代码拉取失败！请检查网络或 Git 配置
    pause
    exit /b 1
)

:: 复制更新的文件（保留本地 data 和 uploads 目录）
echo     复制 Python 文件...
copy /Y "%TEMP_DIR%\app.py" "%~dp0app.py" >nul
copy /Y "%TEMP_DIR%\email_handler.py" "%~dp0email_handler.py" >nul
copy /Y "%TEMP_DIR%\excel_handler.py" "%~dp0excel_handler.py" >nul
copy /Y "%TEMP_DIR%\excel_po_parser.py" "%~dp0excel_po_parser.py" >nul
copy /Y "%TEMP_DIR%\pdf_parser.py" "%~dp0pdf_parser.py" >nul
copy /Y "%TEMP_DIR%\requirements.txt" "%~dp0requirements.txt" >nul
echo     复制 Dockerfile...
copy /Y "%TEMP_DIR%\Dockerfile" "%~dp0Dockerfile" >nul
echo     复制 templates...
xcopy /Y /E /I /Q "%TEMP_DIR%\templates\*" "%~dp0templates\" >nul
echo     复制 static...
xcopy /Y /E /I /Q "%TEMP_DIR%\static\*" "%~dp0static\" >nul
echo     复制 nginx 配置...
xcopy /Y /E /I /Q "%TEMP_DIR%\nginx\*" "%~dp0nginx\" >nul
echo     复制 scripts...
xcopy /Y /E /I /Q "%TEMP_DIR%\scripts\*" "%~dp0scripts\" >nul

:: 清理临时目录
rmdir /S /Q "%TEMP_DIR%" >nul 2>&1

:: 恢复数据备份（防止覆盖）
if exist "%~dp0data\config.json.bak" (
    copy /Y "%~dp0data\config.json.bak" "%~dp0data\config.json" >nul 2>&1
)

:: 重新构建 Docker 服务
echo [3/4] 重新构建 Docker 服务...
cd /d "%~dp0..\.."
docker compose up -d --build schedule-system
if errorlevel 1 (
    echo.
    echo ❌ Docker 构建失败！
    pause
    exit /b 1
)

:: 刷新 nginx
echo [4/4] 刷新 nginx...
docker compose restart nginx

echo.
echo ========================================
echo   ✅ 更新完成！排期录入系统已重新部署
echo ========================================
echo   访问地址: http://localhost/schedule/
echo ========================================
pause
