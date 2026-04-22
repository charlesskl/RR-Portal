@echo off
REM 由 Windows 任务计划程序调用,每日 19:00 跑一次
REM 日志追加到 instance\backups\backup.log
D:\Python\python.exe "D:\project\peise\scripts\backup_db.py" >> "D:\project\peise\instance\backups\backup.log" 2>&1
