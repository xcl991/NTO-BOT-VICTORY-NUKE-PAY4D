@echo off
title NTO BOT - Server
color 0B

echo ============================================
echo          NTO BOT - Server (Debug Mode)
echo ============================================
echo.

:: Auto-detect root path (works from installer/ subfolder or installed root)
if exist "%~dp0SERVER" (
    set "ROOT=%~dp0"
) else (
    set "ROOT=%~dp0.."
)
set "SERVER=%ROOT%\SERVER"

:: Check if already running
netstat -ano | findstr ":6969" | findstr "LISTENING" >nul 2>&1
if %errorlevel% equ 0 (
    echo [!] Server is already running on port 6969.
    echo [*] Opening browser...
    start http://localhost:6969
    echo.
    echo Press any key to exit (server keeps running)...
    pause >nul
    exit /b 0
)

echo [*] Starting server...
echo [*] Browser will open in 4 seconds...
echo [*] Press Ctrl+C to stop the server.
echo.

:: Open browser after delay (background)
start /b cmd /c "timeout /t 4 /nobreak >nul && start http://localhost:6969"

:: Start server (visible output)
cd /d "%SERVER%"
call npx tsx src/index.ts
