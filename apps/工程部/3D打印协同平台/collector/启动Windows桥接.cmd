@echo off
chcp 65001 >nul
cd /d "%~dp0.."
set "COLLECTOR_CONFIG=%CD%\collector\bridge.local.json"
set "COLLECTOR_DATA_DIR=%CD%\runtime"
if not exist "%COLLECTOR_DATA_DIR%" mkdir "%COLLECTOR_DATA_DIR%"
node collector/check.mjs "%COLLECTOR_CONFIG%" --platform
if errorlevel 1 goto done
node collector/agent.mjs --bridge
:done
pause
