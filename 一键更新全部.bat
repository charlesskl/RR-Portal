@echo off
chcp 65001 >nul
echo ╔════════════════════════════════════════════╗
echo ║     RR Portal - 一键更新全部插件 + 云端同步     ║
echo ╚════════════════════════════════════════════╝
echo.

cd /d "%~dp0"

:: ─── 第一步: 更新各插件（从 GitHub 拉取最新代码）───
echo ══════════════════════════════════════════
echo   [1/5] 更新工程啤办单
echo ══════════════════════════════════════════

:: 备份数据
copy /Y "plugins\工程啤办单\data\data.json" "plugins\工程啤办单\data\data.json.bak" >nul 2>&1
copy /Y "plugins\工程啤办单\data\default-material-prices.json" "plugins\工程啤办单\data\default-material-prices.json.bak" >nul 2>&1

:: 拉取最新代码
set "TEMP_RR=%TEMP%\RR-production-system"
if exist "%TEMP_RR%" rmdir /S /Q "%TEMP_RR%"
git clone --depth 1 https://github.com/hufan4308-blip/RR-production-system "%TEMP_RR%"
if errorlevel 1 (
    echo     ⚠ 工程啤办单拉取失败，跳过
    goto :update_indonesia
)
:: 复制更新文件（保留 data 目录）
if exist "%TEMP_RR%\server.js" copy /Y "%TEMP_RR%\server.js" "plugins\工程啤办单\server.js" >nul
if exist "%TEMP_RR%\package.json" copy /Y "%TEMP_RR%\package.json" "plugins\工程啤办单\package.json" >nul
if exist "%TEMP_RR%\package-lock.json" copy /Y "%TEMP_RR%\package-lock.json" "plugins\工程啤办单\package-lock.json" >nul
if exist "%TEMP_RR%\public" xcopy /Y /E /I /Q "%TEMP_RR%\public\*" "plugins\工程啤办单\public\" >nul
rmdir /S /Q "%TEMP_RR%" >nul 2>&1

:: 恢复数据
copy /Y "plugins\工程啤办单\data\data.json.bak" "plugins\工程啤办单\data\data.json" >nul 2>&1
copy /Y "plugins\工程啤办单\data\default-material-prices.json.bak" "plugins\工程啤办单\data\default-material-prices.json" >nul 2>&1
echo     ✅ 工程啤办单更新完成

:update_indonesia
echo.
echo ══════════════════════════════════════════
echo   [2/5] 更新印尼小组
echo ══════════════════════════════════════════
set "TEMP_INDO=%TEMP%\Export-to-Indonesia"
if exist "%TEMP_INDO%" rmdir /S /Q "%TEMP_INDO%"
git clone --depth 1 https://github.com/charlesskl/Export-to-Indonesia "%TEMP_INDO%"
if errorlevel 1 (
    echo     ⚠ 印尼小组拉取失败，跳过
    goto :update_3d
)
if exist "%TEMP_INDO%\印尼出货明细资料核对系统.html" copy /Y "%TEMP_INDO%\印尼出货明细资料核对系统.html" "plugins\印尼小组\印尼出货明细资料核对系统.html" >nul
if exist "%TEMP_INDO%\Dockerfile" copy /Y "%TEMP_INDO%\Dockerfile" "plugins\印尼小组\Dockerfile" >nul
if exist "%TEMP_INDO%\nginx" xcopy /Y /E /I /Q "%TEMP_INDO%\nginx\*" "plugins\印尼小组\nginx\" >nul
if exist "%TEMP_INDO%\scripts" xcopy /Y /E /I /Q "%TEMP_INDO%\scripts\*" "plugins\印尼小组\scripts\" >nul
rmdir /S /Q "%TEMP_INDO%" >nul 2>&1
echo     ✅ 印尼小组更新完成

:update_3d
echo.
echo ══════════════════════════════════════════
echo   [3/5] 更新3D打印
echo ══════════════════════════════════════════
:: 备份数据
copy /Y "plugins\3D打印\data\data.json" "plugins\3D打印\data\data.json.bak" >nul 2>&1

set "TEMP_3D=%TEMP%\3D-"
if exist "%TEMP_3D%" rmdir /S /Q "%TEMP_3D%"
git clone --depth 1 https://github.com/wendyxiaowen/3D- "%TEMP_3D%"
if errorlevel 1 (
    echo     ⚠ 3D打印拉取失败，跳过
    goto :update_schedule
)
if exist "%TEMP_3D%\server.js" copy /Y "%TEMP_3D%\server.js" "plugins\3D打印\server.js" >nul
if exist "%TEMP_3D%\index.html" copy /Y "%TEMP_3D%\index.html" "plugins\3D打印\index.html" >nul
if exist "%TEMP_3D%\package.json" copy /Y "%TEMP_3D%\package.json" "plugins\3D打印\package.json" >nul
rmdir /S /Q "%TEMP_3D%" >nul 2>&1

:: 恢复数据
copy /Y "plugins\3D打印\data\data.json.bak" "plugins\3D打印\data\data.json" >nul 2>&1
echo     ✅ 3D打印更新完成

:update_schedule
echo.
echo ══════════════════════════════════════════
echo   [4/5] 更新排期系统
echo ══════════════════════════════════════════
:: 备份数据
copy /Y "plugins\schedule-system\data\config.json" "plugins\schedule-system\data\config.json.bak" >nul 2>&1

set "TEMP_SCH=%TEMP%\schedule-system"
if exist "%TEMP_SCH%" rmdir /S /Q "%TEMP_SCH%"
git clone --depth 1 https://github.com/hanson678/schedule-system "%TEMP_SCH%"
if errorlevel 1 (
    echo     ⚠ 排期系统拉取失败，跳过
    goto :rebuild
)
if exist "%TEMP_SCH%\*.py" copy /Y "%TEMP_SCH%\*.py" "plugins\schedule-system\" >nul
if exist "%TEMP_SCH%\Dockerfile" copy /Y "%TEMP_SCH%\Dockerfile" "plugins\schedule-system\Dockerfile" >nul
if exist "%TEMP_SCH%\requirements.txt" copy /Y "%TEMP_SCH%\requirements.txt" "plugins\schedule-system\requirements.txt" >nul
if exist "%TEMP_SCH%\templates" xcopy /Y /E /I /Q "%TEMP_SCH%\templates\*" "plugins\schedule-system\templates\" >nul
if exist "%TEMP_SCH%\static" xcopy /Y /E /I /Q "%TEMP_SCH%\static\*" "plugins\schedule-system\static\" >nul
rmdir /S /Q "%TEMP_SCH%" >nul 2>&1

:: 恢复数据
copy /Y "plugins\schedule-system\data\config.json.bak" "plugins\schedule-system\data\config.json" >nul 2>&1
echo     ✅ 排期系统更新完成

:rebuild
echo.
echo ══════════════════════════════════════════
echo   [5/5] 重建 Docker 容器 + 云端同步
echo ══════════════════════════════════════════

:: 重建本地容器
echo     重建本地 Docker 容器...
docker compose up -d --build
if errorlevel 1 (
    echo     ⚠ 本地 Docker 重建失败
) else (
    docker compose restart nginx
    echo     ✅ 本地容器已重建
)

:: 提交代码到 GitHub
echo.
echo     提交更新到 GitHub...
git add -A
git commit -m "chore: update plugins from upstream repos" >nul 2>&1
git push origin main
if errorlevel 1 (
    echo     ⚠ Git push 失败，跳过云端同步
    goto :done
)
echo     ✅ 已推送到 GitHub

:: 云端同步（需要设置环境变量）
if "%CLOUD_HOST%"=="" (
    echo.
    echo     ⚠ 未设置 CLOUD_HOST 环境变量，跳过云端同步
    echo     如需同步云端，请先运行:
    echo       set CLOUD_HOST=8.148.146.194
    echo       set CLOUD_PASS=你的密码
    echo     然后重新运行此脚本
    goto :done
)
if "%CLOUD_PASS%"=="" (
    echo.
    echo     ⚠ 未设置 CLOUD_PASS 环境变量，跳过云端同步
    goto :done
)

echo.
echo     同步到云端服务器...
py deploy/remote-exec.py "cd /opt/rr-portal && bash deploy/update-server.sh"
if errorlevel 1 (
    echo     ⚠ 云端同步失败
) else (
    echo     ✅ 云端已同步
)

:done
echo.
echo ╔════════════════════════════════════════════╗
echo ║           ✅ 一键更新完成！                    ║
echo ╠════════════════════════════════════════════╣
echo ║  本地访问: http://localhost/                    ║
echo ║  云端访问: http://8.148.146.194/                ║
echo ╚════════════════════════════════════════════╝
pause
