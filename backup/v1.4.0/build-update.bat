@echo off
setlocal enabledelayedexpansion
title BOT NTO - Build Update Package
color 0E

echo ============================================
echo     BOT NTO - Build Update Package
echo ============================================
echo.

set "ROOT_DIR=%~dp0"
set "ROOT_DIR=%ROOT_DIR:~0,-1%"

:: Read version from SERVER/package.json
for /f "tokens=2 delims=:, " %%a in ('findstr /C:"\"version\"" "%ROOT_DIR%\SERVER\package.json"') do (
    set "VERSION=%%~a"
    goto :got_version
)
:got_version

if "%VERSION%"=="" (
    echo [X] Could not read version from SERVER/package.json
    pause
    exit /b 1
)

echo Version: %VERSION%
echo.

set "BUILD_DIR=%ROOT_DIR%\data\updates\build-temp"
set "ZIP_NAME=update-%VERSION%.zip"
set "OUTPUT=%ROOT_DIR%\data\updates\%ZIP_NAME%"

:: Clean
if exist "%BUILD_DIR%" rmdir /s /q "%BUILD_DIR%"
mkdir "%BUILD_DIR%"

echo [1/4] Copying source files...

:: SERVER/src
xcopy "%ROOT_DIR%\SERVER\src" "%BUILD_DIR%\SERVER\src\" /s /e /i /q /y >nul
echo   [OK] SERVER/src

:: SERVER/prisma
xcopy "%ROOT_DIR%\SERVER\prisma" "%BUILD_DIR%\SERVER\prisma\" /s /e /i /q /y >nul
echo   [OK] SERVER/prisma

:: SERVER/package.json + tsconfig.json
copy "%ROOT_DIR%\SERVER\package.json" "%BUILD_DIR%\SERVER\package.json" /y >nul
copy "%ROOT_DIR%\SERVER\tsconfig.json" "%BUILD_DIR%\SERVER\tsconfig.json" /y >nul
if exist "%ROOT_DIR%\SERVER\package-lock.json" copy "%ROOT_DIR%\SERVER\package-lock.json" "%BUILD_DIR%\SERVER\package-lock.json" /y >nul
echo   [OK] SERVER config files

:: panel/
xcopy "%ROOT_DIR%\panel" "%BUILD_DIR%\panel\" /s /e /i /q /y >nul
echo   [OK] panel/

:: root package.json
copy "%ROOT_DIR%\package.json" "%BUILD_DIR%\package.json" /y >nul
echo   [OK] root package.json

:: Launcher scripts
for %%f in (start.bat start.vbs stop.bat) do (
    if exist "%ROOT_DIR%\installer\%%f" (
        if not exist "%BUILD_DIR%\installer" mkdir "%BUILD_DIR%\installer"
        copy "%ROOT_DIR%\installer\%%f" "%BUILD_DIR%\installer\%%f" /y >nul
    )
)
echo   [OK] launcher scripts
echo.

echo [2/4] Creating update metadata...
(
    echo {
    echo   "version": "%VERSION%",
    echo   "buildDate": "%DATE% %TIME%",
    echo   "requiresNpmInstall": true,
    echo   "requiresPrismaGenerate": true,
    echo   "requiresPrismaPush": true
    echo }
) > "%BUILD_DIR%\update-meta.json"
echo   [OK] update-meta.json
echo.

echo [3/4] Creating ZIP...
if exist "%OUTPUT%" del "%OUTPUT%"
powershell -ExecutionPolicy Bypass -Command "Compress-Archive -Path '%BUILD_DIR%\*' -DestinationPath '%OUTPUT%' -Force"
if %errorlevel% neq 0 (
    echo [X] Failed to create ZIP.
    pause
    exit /b 1
)
echo   [OK] %ZIP_NAME%
echo.

echo [4/4] Cleaning up...
rmdir /s /q "%BUILD_DIR%"

:: Show file size
for %%a in ("%OUTPUT%") do set "SIZE=%%~za"
set /a "SIZE_KB=%SIZE% / 1024"
echo.
echo ============================================
echo   Update package built successfully!
echo ============================================
echo.
echo   File: data\updates\%ZIP_NAME%
echo   Size: %SIZE_KB% KB
echo.
echo   To distribute:
echo     1. Upload %ZIP_NAME% to GitHub Releases or HTTP server
echo     2. Update versions.json with new version info
echo.

pause
