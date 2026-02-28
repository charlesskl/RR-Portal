@echo off
chcp 65001 >nul
title 3D打印管理系统 - 多人协作服务器
echo.
echo  正在启动 3D打印部门管理系统 (多人协作版)...
echo  数据保存在 data.json 文件中
echo.
node "%~dp0server.js"
pause
