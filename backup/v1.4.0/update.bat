@echo off
setlocal enabledelayedexpansion
title BOT NTO - Manual Updater
color 0E

echo ============================================
echo     BOT NTO - Manual Updater
echo ============================================
echo.

set "ROOT_DIR=%~dp0"
:: If running from installer/ subfolder, go up one level
if exist "%ROOT_DIR%SERVER" (
    set "ROOT_DIR=%ROOT_DIR%"
) else (
    set "ROOT_DIR=%ROOT_DIR%.."
)

set "ZIP_FILE=%ROOT_DIR%\data\updates\update-latest.zip"
set "SERVER_DIR=%ROOT_DIR%\SERVER"
set "TEMP_DIR=%ROOT_DIR%\data\updates\extracted"

:: Check ZIP exists
if not exist "%ZIP_FILE%" (
    echo [X] No update file found at: %ZIP_FILE%
    echo.
    echo     Place the update ZIP at: data\updates\update-latest.zip
    echo     Then run this script again.
    echo.
    pause
    exit /b 1
)

echo [1/7] Stopping server...
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":6969" ^| findstr "LISTENING"') do (
    taskkill /F /PID %%p >nul 2>&1
)
timeout /t 2 >nul
echo [OK] Server stopped.
echo.

echo [2/7] Backing up database...
if exist "%ROOT_DIR%\data\bot-nto.db" (
    for /f "tokens=2 delims==" %%a in ('wmic os get LocalDateTime /value ^| find "="') do set "DT=%%a"
    set "BACKUP_NAME=bot-nto.db.backup-!DT:~0,8!-!DT:~8,6!"
    copy "%ROOT_DIR%\data\bot-nto.db" "%ROOT_DIR%\data\!BACKUP_NAME!" >nul
    echo [OK] Database backed up: !BACKUP_NAME!
) else (
    echo [*] No database to backup.
)
echo.

echo [3/7] Extracting update...
if exist "%TEMP_DIR%" rmdir /s /q "%TEMP_DIR%"
powershell -ExecutionPolicy Bypass -Command "Expand-Archive -Path '%ZIP_FILE%' -DestinationPath '%TEMP_DIR%' -Force"
if %errorlevel% neq 0 (
    echo [X] Failed to extract ZIP. Update aborted.
    pause
    exit /b 1
)
echo [OK] Extracted.
echo.

echo [4/7] Copying updated files...
:: SERVER/src
if exist "%TEMP_DIR%\SERVER\src" (
    if exist "%SERVER_DIR%\src" rmdir /s /q "%SERVER_DIR%\src"
    xcopy "%TEMP_DIR%\SERVER\src" "%SERVER_DIR%\src\" /s /e /i /q /y >nul
    echo   [OK] SERVER/src
)
:: SERVER/prisma
if exist "%TEMP_DIR%\SERVER\prisma" (
    if exist "%SERVER_DIR%\prisma" rmdir /s /q "%SERVER_DIR%\prisma"
    xcopy "%TEMP_DIR%\SERVER\prisma" "%SERVER_DIR%\prisma\" /s /e /i /q /y >nul
    echo   [OK] SERVER/prisma
)
:: SERVER/package.json
if exist "%TEMP_DIR%\SERVER\package.json" (
    copy "%TEMP_DIR%\SERVER\package.json" "%SERVER_DIR%\package.json" /y >nul
    echo   [OK] SERVER/package.json
)
:: SERVER/tsconfig.json
if exist "%TEMP_DIR%\SERVER\tsconfig.json" (
    copy "%TEMP_DIR%\SERVER\tsconfig.json" "%SERVER_DIR%\tsconfig.json" /y >nul
    echo   [OK] SERVER/tsconfig.json
)
:: panel/
if exist "%TEMP_DIR%\panel" (
    if exist "%ROOT_DIR%\panel" rmdir /s /q "%ROOT_DIR%\panel"
    xcopy "%TEMP_DIR%\panel" "%ROOT_DIR%\panel\" /s /e /i /q /y >nul
    echo   [OK] panel/
)
:: root package.json
if exist "%TEMP_DIR%\package.json" (
    copy "%TEMP_DIR%\package.json" "%ROOT_DIR%\package.json" /y >nul
    echo   [OK] root package.json
)
echo.

echo [5/7] Installing dependencies...
set "PATH=%ProgramFiles%\nodejs;%PATH%"
cd /d "%SERVER_DIR%"
call npm install >nul 2>&1
echo [OK] npm install done.
echo.

echo [6/7] Setting up database...
call npx prisma generate >nul 2>&1
call npx prisma db push --skip-generate >nul 2>&1
echo [OK] Database updated.
echo.

echo [7/7] Cleaning up...
if exist "%TEMP_DIR%" rmdir /s /q "%TEMP_DIR%"
del "%ZIP_FILE%" >nul 2>&1
echo [OK] Cleanup done.
echo.

echo ============================================
echo       Update Complete!
echo ============================================
echo.

:: Ask to restart
choice /C YN /M "Start the server now?"
if %errorlevel% equ 1 (
    if exist "%ROOT_DIR%\start.vbs" (
        start "" wscript.exe "%ROOT_DIR%\start.vbs"
    ) else (
        start "" cmd /c "cd /d "%SERVER_DIR%" && npx tsx src/index.ts"
    )
    echo [OK] Server starting...
)

echo.
pause
