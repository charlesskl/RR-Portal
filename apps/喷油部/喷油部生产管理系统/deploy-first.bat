@echo off
chcp 65001 >nul
setlocal

REM === 首次部署脚本 (Windows 服务器) ===
REM 前提:
REM   1. 已装 Git for Windows (https://git-scm.com/download/win)
REM   2. 已装 Node.js 20+ (https://nodejs.org/en/download)  <- 20 LTS 或 22 都行
REM   3. 以管理员身份运行本脚本 (为了开防火墙)

set REPO_URL=<在这里填你的 git 仓库 URL>
set TARGET=C:\penyou-system

echo [1/5] 克隆代码到 %TARGET% ...
if exist "%TARGET%" (
  echo   目录已存在,跳过 clone
) else (
  git clone %REPO_URL% "%TARGET%"
  if errorlevel 1 (echo 克隆失败 & pause & exit /b 1)
)

echo [2/5] 安装后端依赖 ...
cd /d "%TARGET%\server"
call npm install
if errorlevel 1 (echo 后端 npm install 失败 & pause & exit /b 1)

echo [3/5] 安装前端依赖 ...
cd /d "%TARGET%\client"
call npm install
if errorlevel 1 (echo 前端 npm install 失败 & pause & exit /b 1)

echo [4/5] 放行防火墙端口 3100 / 5173 ...
netsh advfirewall firewall add rule name="penyou-server 3100" dir=in action=allow protocol=TCP localport=3100 >nul
netsh advfirewall firewall add rule name="penyou-client 5173" dir=in action=allow protocol=TCP localport=5173 >nul

echo [5/5] 完成。下一步:
echo   - 双击 %TARGET%\start.bat 启动
echo   - 查本机 IP: ipconfig
echo   - 局域网其它电脑访问 http://^<本机IP^>:5173
echo.
pause
