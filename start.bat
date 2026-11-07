@echo off
title TANK-10 Server
echo ========================================================
echo   Starting TANK-10 Game Server...
echo ========================================================
set ELECTRON_RUN_AS_NODE=1
"C:\Users\tatun\AppData\Local\Programs\antigravity\Antigravity.exe" "%~dp0server\server.js"
pause
