@echo off
title NTO BOT - Stop Server
color 0C

echo ============================================
echo          NTO BOT - Stop Server
echo ============================================
echo.

:: Find PID listening on port 6969
set "FOUND=0"
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":6969" ^| findstr "LISTENING"') do (
    set "PID=%%p"
    set "FOUND=1"
)

if "%FOUND%"=="0" (
    echo [*] No server running on port 6969.
    echo.
    pause
    exit /b 0
)

echo [*] Found server process PID: %PID%
echo [*] Killing process...

taskkill /F /PID %PID% >nul 2>&1
if %errorlevel% equ 0 (
    echo [OK] Server stopped.
) else (
    echo [!] Failed to kill process. Try running as administrator.
)

echo.
pause
