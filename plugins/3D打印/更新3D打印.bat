@echo off
chcp 65001 >nul
echo ========================================
echo   3D打印 - 拉取最新代码
echo ========================================
echo.

:: 备份数据
echo [1/3] 备份数据...
if exist "%~dp0data\data.json" copy /Y "%~dp0data\data.json" "%~dp0data\data.json.bak" >nul 2>&1

:: 从 GitHub 拉取最新代码
echo [2/3] 从 GitHub 拉取最新代码...
set "TEMP_DIR=%TEMP%\3D-"
if exist "%TEMP_DIR%" rmdir /S /Q "%TEMP_DIR%"
git clone --depth 1 https://github.com/wendyxiaowen/3D- "%TEMP_DIR%"
if errorlevel 1 (
    echo.
    echo ❌ 代码拉取失败！请检查网络或 Git 配置
    pause
    exit /b 1
)

:: 复制更新的文件（保留本地 data 目录和 .env）
echo     复制 server.js ...
copy /Y "%TEMP_DIR%\server.js" "%~dp0server.js" >nul
echo     复制 index.html ...
copy /Y "%TEMP_DIR%\index.html" "%~dp0index.html" >nul

:: 清理临时目录
rmdir /S /Q "%TEMP_DIR%" >nul 2>&1

:: 恢复数据备份（防止覆盖）
if exist "%~dp0data\data.json.bak" (
    copy /Y "%~dp0data\data.json.bak" "%~dp0data\data.json" >nul 2>&1
)

echo [3/3] 完成！
echo.
echo ========================================
echo   ✅ 更新完成！
echo ========================================
echo   注意: 3D打印在宿主机运行，请重启服务器:
echo   运行 启动服务器.bat
echo ========================================
pause
