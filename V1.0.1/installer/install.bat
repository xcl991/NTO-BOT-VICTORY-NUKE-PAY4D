@echo off
setlocal enabledelayedexpansion
title NTO BOT - Installer
color 0A

echo ============================================
echo          NTO BOT - One-Click Installer
echo ============================================
echo.

:: ============================================
:: Check admin privileges
:: ============================================
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo [!] This installer requires Administrator privileges.
    echo [!] Right-click install.bat and select "Run as administrator"
    echo.
    pause
    exit /b 1
)

:: ============================================
:: Set paths
:: ============================================
set "ROOT=%~dp0.."
set "SERVER=%ROOT%\SERVER"
set "DATA=%ROOT%\data"
set "INSTALLER=%~dp0"

echo [*] Project root: %ROOT%
echo.

:: ============================================
:: Step 1: Check / Install Node.js
:: ============================================
echo [1/7] Checking Node.js...

where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [!] Node.js not found. Downloading Node.js 22 LTS...

    set "NODE_MSI=%TEMP%\node-v22-lts.msi"
    powershell -Command "& { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri 'https://nodejs.org/dist/v22.14.0/node-v22.14.0-x64.msi' -OutFile '%TEMP%\node-v22-lts.msi' }"

    if not exist "%TEMP%\node-v22-lts.msi" (
        echo [X] Failed to download Node.js. Please install manually from https://nodejs.org
        pause
        exit /b 1
    )

    echo [*] Installing Node.js 22 LTS silently...
    msiexec /i "%TEMP%\node-v22-lts.msi" /qn /norestart

    if %errorlevel% neq 0 (
        echo [X] Node.js installation failed. Please install manually from https://nodejs.org
        pause
        exit /b 1
    )

    :: Refresh PATH so node/npm are available
    set "PATH=%ProgramFiles%\nodejs;%PATH%"

    echo [OK] Node.js installed successfully.
) else (
    for /f "tokens=*" %%v in ('node --version') do echo [OK] Node.js %%v found.
)
echo.

:: ============================================
:: Step 2: Install npm dependencies
:: ============================================
echo [2/7] Installing npm dependencies...
cd /d "%SERVER%"
call npm install
if %errorlevel% neq 0 (
    echo [X] npm install failed.
    pause
    exit /b 1
)
echo [OK] Dependencies installed.
echo.

:: ============================================
:: Step 3: Prisma generate + db push
:: ============================================
echo [3/7] Setting up database (Prisma)...
cd /d "%SERVER%"
call npx prisma generate
if %errorlevel% neq 0 (
    echo [X] Prisma generate failed.
    pause
    exit /b 1
)
call npx prisma db push --skip-generate
if %errorlevel% neq 0 (
    echo [X] Prisma db push failed.
    pause
    exit /b 1
)
echo [OK] Database ready.
echo.

:: ============================================
:: Step 4: Install Playwright Chromium
:: ============================================
echo [4/7] Installing Playwright Chromium browser...
cd /d "%SERVER%"
call npx playwright install chromium
if %errorlevel% neq 0 (
    echo [!] Playwright Chromium install failed. Bot automation may not work.
    echo [!] You can retry later with: cd SERVER ^&^& npx playwright install chromium
)
echo [OK] Playwright Chromium installed.
echo.

:: ============================================
:: Step 5: Create .env files if missing
:: ============================================
echo [5/7] Checking .env configuration...

if not exist "%SERVER%\.env" (
    echo PORT=6969> "%SERVER%\.env"
    echo NODE_ENV=development>> "%SERVER%\.env"
    echo LOG_LEVEL=info>> "%SERVER%\.env"
    echo DATABASE_URL=file:../../data/bot-nto.db>> "%SERVER%\.env"
    echo ENCRYPTION_KEY=change-this-to-a-random-32-byte-key>> "%SERVER%\.env"
    echo [OK] Created SERVER\.env with defaults.
) else (
    echo [OK] SERVER\.env already exists.
)

if not exist "%ROOT%\.env" (
    copy "%SERVER%\.env" "%ROOT%\.env" >nul
    echo [OK] Created root .env (copy of SERVER\.env)
) else (
    echo [OK] Root .env already exists.
)
echo.

:: ============================================
:: Step 6: Create data directories
:: ============================================
echo [6/7] Creating data directories...

if not exist "%DATA%" mkdir "%DATA%"
if not exist "%DATA%\logs" mkdir "%DATA%\logs"
if not exist "%DATA%\exports" mkdir "%DATA%\exports"
if not exist "%DATA%\downloads" mkdir "%DATA%\downloads"
if not exist "%DATA%\screenshots" mkdir "%DATA%\screenshots"
if not exist "%DATA%\captcha-debug" mkdir "%DATA%\captcha-debug"
if not exist "%ROOT%\profiles" mkdir "%ROOT%\profiles"

echo [OK] Data directories ready.
echo.

:: ============================================
:: Step 7: Create desktop shortcut with icon
:: ============================================
echo [7/7] Creating desktop shortcut...

set "LOGO_JPG=%INSTALLER%ff7acb18-9206-459d-8837-91405bced6a0.jpg"
set "ICO_FILE=%INSTALLER%nto-bot.ico"
set "VBS_FILE=%INSTALLER%start.vbs"

:: Convert JPG to ICO using PowerShell
if exist "%LOGO_JPG%" (
    if not exist "%ICO_FILE%" (
        echo [*] Converting logo to .ico...
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
            Write-Host '[OK] Icon created.'"
    ) else (
        echo [OK] Icon already exists.
    )
) else (
    echo [!] Logo file not found, shortcut will use default icon.
)

:: Create desktop shortcut via PowerShell
set "DESKTOP=%USERPROFILE%\Desktop"
powershell -ExecutionPolicy Bypass -Command ^
    "$ws = New-Object -ComObject WScript.Shell; ^
    $sc = $ws.CreateShortcut('%DESKTOP%\NTO BOT.lnk'); ^
    $sc.TargetPath = '%VBS_FILE%'; ^
    $sc.WorkingDirectory = '%ROOT%'; ^
    $sc.Description = 'NTO BOT - Automation Dashboard'; ^
    if (Test-Path '%ICO_FILE%') { $sc.IconLocation = '%ICO_FILE%' }; ^
    $sc.Save(); ^
    Write-Host '[OK] Desktop shortcut created.'"

echo.
echo ============================================
echo          Installation Complete!
echo ============================================
echo.
echo  You can now:
echo    1. Double-click "NTO BOT" on your Desktop
echo    2. Or run start.bat for debug mode
echo    3. Or run stop.bat to kill the server
echo.
echo  The panel will open at http://localhost:6969
echo.
pause
