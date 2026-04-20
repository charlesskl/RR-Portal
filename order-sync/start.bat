@echo off
echo Starting Production Plan System on port 8080...
cd /d "C:\Users\Administrator\zouhuo-system\order-sync\server"
node --max-old-space-size=512 app.js
