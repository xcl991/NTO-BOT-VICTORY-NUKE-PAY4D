@echo off
setlocal enabledelayedexpansion
title BOT BO PANEL - Compile Installer
color 0E

echo ============================================
echo     BOT BO PANEL - Installer Compiler
echo ============================================
echo.

set "INSTALLER_DIR=%~dp0"
set "LOGO_PNG=%INSTALLER_DIR%BOT-BO-PANEL.png"
set "LOGO_JPG=%INSTALLER_DIR%ff7acb18-9206-459d-8837-91405bced6a0.jpg"
set "ICO_FILE=%INSTALLER_DIR%botbopanel.ico"
set "CS_FILE=%INSTALLER_DIR%botbopanel.cs"
set "EXE_FILE=%INSTALLER_DIR%botbopanel.exe"
set "ISS_FILE=%INSTALLER_DIR%setup-botbopanel.iss"
set "OUTPUT_DIR=%INSTALLER_DIR%output"

:: ============================================
:: Step 1: Check for Inno Setup
:: ============================================
echo [1/4] Checking for Inno Setup...

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
    pause
    exit /b 1
)

echo [OK] Found: %ISCC%
echo.

:: ============================================
:: Step 2: Create ICO from PNG (or JPG fallback)
:: ============================================
echo [2/4] Creating application icon...

if not exist "%ICO_FILE%" (
    set "IMG_SOURCE="
    if exist "%LOGO_PNG%" (
        set "IMG_SOURCE=%LOGO_PNG%"
        echo [*] Using BOT-BO-PANEL.png as source...
    ) else if exist "%LOGO_JPG%" (
        set "IMG_SOURCE=%LOGO_JPG%"
        echo [*] Using JPG fallback as source...
    )

    if defined IMG_SOURCE (
        powershell -ExecutionPolicy Bypass -Command ^
            "Add-Type -AssemblyName System.Drawing; ^
            $img = [System.Drawing.Image]::FromFile('!IMG_SOURCE!'); ^
            $bmp = New-Object System.Drawing.Bitmap($img, 256, 256); ^
            $icon = [System.Drawing.Icon]::FromHandle($bmp.GetHicon()); ^
            $fs = [System.IO.FileStream]::new('%ICO_FILE%', [System.IO.FileMode]::Create); ^
            $icon.Save($fs); ^
            $fs.Close(); ^
            $icon.Dispose(); ^
            $bmp.Dispose(); ^
            $img.Dispose(); ^
            Write-Host '[OK] botbopanel.ico created.'"

        if not exist "%ICO_FILE%" (
            echo [!] Icon creation failed. Installer will compile without custom icon.
        )
    ) else (
        echo [!] No logo image found. Using existing nto-bot.ico as fallback...
        if exist "%INSTALLER_DIR%nto-bot.ico" copy "%INSTALLER_DIR%nto-bot.ico" "%ICO_FILE%" >nul
    )
) else (
    echo [OK] botbopanel.ico already exists.
)
echo.

:: ============================================
:: Step 3: Compile C# launcher
:: ============================================
echo [3/4] Compiling launcher (botbopanel.exe)...

if not exist "%EXE_FILE%" (
    set "CSC="
    :: Try .NET Framework csc.exe locations
    for %%v in (v4.0.30319 v3.5 v2.0.50727) do (
        if exist "%SystemRoot%\Microsoft.NET\Framework64\%%v\csc.exe" (
            set "CSC=%SystemRoot%\Microsoft.NET\Framework64\%%v\csc.exe"
            goto :found_csc
        )
        if exist "%SystemRoot%\Microsoft.NET\Framework\%%v\csc.exe" (
            set "CSC=%SystemRoot%\Microsoft.NET\Framework\%%v\csc.exe"
            goto :found_csc
        )
    )
    :found_csc

    if defined CSC (
        "%CSC%" /target:winexe /out:"%EXE_FILE%" "%CS_FILE%" >nul 2>&1
        if exist "%EXE_FILE%" (
            echo [OK] botbopanel.exe compiled.
        ) else (
            echo [!] C# compilation failed. Copying ntobot.exe as fallback...
            if exist "%INSTALLER_DIR%ntobot.exe" copy "%INSTALLER_DIR%ntobot.exe" "%EXE_FILE%" >nul
        )
    ) else (
        echo [!] C# compiler not found. Copying ntobot.exe as fallback...
        if exist "%INSTALLER_DIR%ntobot.exe" copy "%INSTALLER_DIR%ntobot.exe" "%EXE_FILE%" >nul
    )
) else (
    echo [OK] botbopanel.exe already exists.
)
echo.

:: ============================================
:: Step 4: Compile installer
:: ============================================
echo [4/4] Compiling installer...
echo.

if not exist "%OUTPUT_DIR%" mkdir "%OUTPUT_DIR%"

"%ISCC%" "%ISS_FILE%"

if %errorlevel% equ 0 (
    echo.
    echo ============================================
    echo       Installer compiled successfully!
    echo ============================================
    echo.
    echo   Output: %OUTPUT_DIR%\BOTBOPANEL.exe
    echo.
    explorer "%OUTPUT_DIR%"
) else (
    echo.
    echo [X] Compilation failed. Check the errors above.
)

echo.
pause
