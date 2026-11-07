@echo off
chcp 65001 >nul
title TANK-10 Firewall Setup
echo ========================================================
echo   TANK-10: Windows Firewall Port 3000 Allow
echo ========================================================
echo.
echo Checking Administrator privileges...
net session >nul 2>&1
if %errorlevel% neq 0 (
  echo [!] Administrator privilege is required.
  echo Please RIGHT-CLICK this file and select:
  echo   "Run as administrator" (管理者として実行)
  echo.
  pause
  exit /b 1
)

netsh advfirewall firewall delete rule name="TANK-10 Game Server" >nul 2>&1
netsh advfirewall firewall add rule name="TANK-10 Game Server" dir=in action=allow protocol=TCP localport=3000

echo.
echo [OK] Port 3000 inbound rule added successfully!
echo You can now connect from mobile devices on the same Wi-Fi.
echo.
echo Local IP Addresses:
ipconfig | findstr /i "IPv4"
echo.
echo Access URL: http://^<YOUR-IP^>:3000
echo.
pause
