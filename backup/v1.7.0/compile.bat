@echo off
setlocal enabledelayedexpansion
title NTO BOT - Compile Installer
color 0E

echo ============================================
echo     NTO BOT - Installer Compiler
echo ============================================
echo.

set "INSTALLER_DIR=%~dp0"
set "LOGO_JPG=%INSTALLER_DIR%ff7acb18-9206-459d-8837-91405bced6a0.jpg"
set "ICO_FILE=%INSTALLER_DIR%nto-bot.ico"
set "ISS_FILE=%INSTALLER_DIR%setup.iss"
set "OUTPUT_DIR=%INSTALLER_DIR%output"

:: ============================================
:: Step 1: Check for Inno Setup
:: ============================================
echo [1/3] Checking for Inno Setup...

set "ISCC="
if exist "%ProgramFiles(x86)%\Inno Setup 6\ISCC.exe" (
    set "ISCC=%ProgramFiles(x86)%\Inno Setup 6\ISCC.exe"
) else if exist "%ProgramFiles%\Inno Setup 6\ISCC.exe" (
    set "ISCC=%ProgramFiles%\Inno Setup 6\ISCC.exe"
)

if "%ISCC%"=="" (
    echo [X] Inno Setup 6 not found!
    echo.
    echo     Please download and install Inno Setup 6 from:
    echo     https://jrsoftware.org/isdl.php
    echo.
    echo     After installing, run this script again.
    echo.
    pause
    exit /b 1
)

echo [OK] Found: %ISCC%
echo.

:: ============================================
:: Step 2: Convert JPG to ICO
:: ============================================
echo [2/3] Creating application icon...

if exist "%LOGO_JPG%" (
    if not exist "%ICO_FILE%" (
        powershell -ExecutionPolicy Bypass -Command ^
            "Add-Type -AssemblyName System.Drawing; ^
            $img = [System.Drawing.Image]::FromFile('%LOGO_JPG%'); ^
            $bmp = New-Object System.Drawing.Bitmap($img, 256, 256); ^
            $icon = [System.Drawing.Icon]::FromHandle($bmp.GetHicon()); ^
            $fs = [System.IO.FileStream]::new('%ICO_FILE%', [System.IO.FileMode]::Create); ^
            $icon.Save($fs); ^
            $fs.Close(); ^
            $icon.Dispose(); ^
            $bmp.Dispose(); ^
            $img.Dispose(); ^
            Write-Host '[OK] nto-bot.ico created.'"

        if not exist "%ICO_FILE%" (
            echo [!] Icon creation failed. Installer will compile without custom icon.
        )
    ) else (
        echo [OK] nto-bot.ico already exists.
    )
) else (
    echo [!] Logo file not found: %LOGO_JPG%
    echo [!] Installer will compile without custom icon.
)
echo.

:: ============================================
:: Step 3: Compile installer
:: ============================================
echo [3/3] Compiling installer...
echo.

if not exist "%OUTPUT_DIR%" mkdir "%OUTPUT_DIR%"

"%ISCC%" "%ISS_FILE%"

if %errorlevel% equ 0 (
    echo.
    echo ============================================
    echo       Installer compiled successfully!
    echo ============================================
    echo.
    echo   Output: %OUTPUT_DIR%\NTO-BOT-Setup.exe
    echo.

    :: Open output folder
    explorer "%OUTPUT_DIR%"
) else (
    echo.
    echo [X] Compilation failed. Check the errors above.
)

echo.
pause
