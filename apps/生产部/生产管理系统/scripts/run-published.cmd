@echo off
setlocal

set "ERP_URLS=http://localhost:5000;http://localhost:5173"

cd /d "%~dp0..\publish\erpapi"
if errorlevel 1 exit /b 1

ErpApi.exe --urls "%ERP_URLS%" >> "%~dp0..\erpapi.stdout.log" 2>> "%~dp0..\erpapi.stderr.log"
