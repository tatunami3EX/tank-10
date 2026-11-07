@echo off
chcp 65001 >nul
title TANK-10 Online Server
echo Starting TANK-10 Online Server...
set ELECTRON_RUN_AS_NODE=1
"C:\Users\tatun\AppData\Local\Programs\antigravity\Antigravity.exe" "%~dp0server\tunnel.js"
if %errorlevel% neq 0 pause
