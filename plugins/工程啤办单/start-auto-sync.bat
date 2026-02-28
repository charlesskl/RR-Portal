@echo off
title RR Production System - Auto Sync
cd /d "%~dp0"
echo Starting auto-sync...
node auto-sync.js
pause
