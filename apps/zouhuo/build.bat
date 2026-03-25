@echo off
chcp 65001 >nul
echo ========================================
echo  走货明细系统 - 一键打包
echo ========================================

:: 1. 编译前端
echo [1/3] 编译前端...
cd /d "%~dp0client"
call npm run build
if errorlevel 1 (echo 前端编译失败！ & pause & exit /b 1)

:: 2. 打包 exe
echo [2/3] 打包 exe...
cd /d "%~dp0server"
mkdir "..\dist" 2>nul
call npx pkg app.js --target node18-win-x64 --output ..\dist\走货明细.exe
if errorlevel 1 (echo 打包失败！ & pause & exit /b 1)

:: 3. 复制运行时文件到 dist
echo [3/3] 复制运行文件...
set DIST=%~dp0dist

xcopy /e /y /i "%~dp0client\dist" "%DIST%\client\dist\" >nul

if not exist "%DIST%\.env" (
  echo PORT=80> "%DIST%\.env"
  echo JWT_SECRET=zouhuo_secret_change_me>> "%DIST%\.env"
  echo CORS_ORIGIN=http://localhost>> "%DIST%\.env"
)

mkdir "%DIST%\data" 2>nul
mkdir "%DIST%\uploads" 2>nul

echo.
echo ========================================
echo  打包完成！输出目录: dist\
echo  运行方式: 双击 dist\走货明细.exe
echo ========================================
pause
