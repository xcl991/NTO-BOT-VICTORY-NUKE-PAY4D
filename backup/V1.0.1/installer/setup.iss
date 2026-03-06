; ============================================
; NTO BOT - Inno Setup Installer Script
; Requires: Inno Setup 6.x (https://jrsoftware.org/isdl.php)
; Compile: Open in Inno Setup → Build → Compile
;          Or run: compile.bat
; ============================================

#define MyAppName "NTO BOT"
#define MyAppVersion "1.0.1"
#define MyAppPublisher "NTO BOT"
#define MyAppURL "http://localhost:6969"
#define MyAppExeName "start.vbs"

[Setup]
AppId={{B8F3E2A1-5C7D-4E9F-A1B2-3D4E5F6A7B8C}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}
DefaultDirName={sd}\{#MyAppName}
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
OutputDir=installer\output
OutputBaseFilename=NTO-BOT-Setup
SetupIconFile=installer\nto-bot.ico
UninstallDisplayIcon={app}\nto-bot.ico
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=admin
VersionInfoVersion=1.0.1
VersionInfoCompany=NTO BOT
VersionInfoDescription=NTO BOT Automation Dashboard Installer
VersionInfoProductName=NTO BOT
MinVersion=10.0
SourceDir=..

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Messages]
WelcomeLabel1=Welcome to NTO BOT Setup
WelcomeLabel2=This will install NTO BOT Automation Dashboard on your computer.%n%nThe installer will:%n  - Install project files%n  - Install Node.js dependencies%n  - Setup the database%n  - Install Chromium browser%n  - Create desktop shortcut%n%nClick Next to continue.
FinishedHeadingLabel=NTO BOT Installation Complete!
FinishedLabel=NTO BOT has been successfully installed.%n%nDouble-click the desktop shortcut to start.%nThe panel will open at http://localhost:6969

[Types]
Name: "full"; Description: "Full installation"
Name: "compact"; Description: "Compact installation (skip Playwright)"
Name: "custom"; Description: "Custom installation"; Flags: iscustom

[Components]
Name: "main"; Description: "NTO BOT Core Files"; Types: full compact custom; Flags: fixed
Name: "playwright"; Description: "Chromium Browser (required for automation)"; Types: full

[Files]
; === Server source code (no node_modules) ===
Source: "SERVER\src\*"; DestDir: "{app}\SERVER\src"; Flags: recursesubdirs ignoreversion createallsubdirs; Components: main
Source: "SERVER\prisma\*"; DestDir: "{app}\SERVER\prisma"; Flags: recursesubdirs ignoreversion; Components: main
Source: "SERVER\package.json"; DestDir: "{app}\SERVER"; Flags: ignoreversion; Components: main
Source: "SERVER\package-lock.json"; DestDir: "{app}\SERVER"; Flags: ignoreversion skipifsourcedoesntexist; Components: main
Source: "SERVER\tsconfig.json"; DestDir: "{app}\SERVER"; Flags: ignoreversion; Components: main
Source: "SERVER\eng.traineddata"; DestDir: "{app}\SERVER"; Flags: ignoreversion skipifsourcedoesntexist; Components: main

; === Panel frontend ===
Source: "panel\*"; DestDir: "{app}\panel"; Flags: recursesubdirs ignoreversion createallsubdirs; Components: main

; === Launcher ===
Source: "installer\ntobot.exe"; DestDir: "{app}"; Flags: ignoreversion; Components: main
Source: "installer\start.vbs"; DestDir: "{app}"; Flags: ignoreversion; Components: main
Source: "installer\start.bat"; DestDir: "{app}"; Flags: ignoreversion; Components: main
Source: "installer\stop.bat"; DestDir: "{app}"; Flags: ignoreversion; Components: main

; === Icon ===
Source: "installer\nto-bot.ico"; DestDir: "{app}"; Flags: ignoreversion skipifsourcedoesntexist; Components: main

; === Root package.json (for monorepo scripts) ===
Source: "package.json"; DestDir: "{app}"; Flags: ignoreversion skipifsourcedoesntexist; Components: main

[Dirs]
Name: "{app}\data"
Name: "{app}\data\logs"
Name: "{app}\data\exports"
Name: "{app}\data\downloads"
Name: "{app}\data\screenshots"
Name: "{app}\data\captcha-debug"
Name: "{app}\profiles"

[Icons]
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\ntobot.exe"; WorkingDir: "{app}"; IconFilename: "{app}\nto-bot.ico"; Comment: "NTO BOT - Automation Dashboard"
Name: "{group}\{#MyAppName}"; Filename: "{app}\ntobot.exe"; WorkingDir: "{app}"; IconFilename: "{app}\nto-bot.ico"
Name: "{group}\{#MyAppName} (Debug)"; Filename: "{app}\start.bat"; WorkingDir: "{app}"; IconFilename: "{app}\nto-bot.ico"
Name: "{group}\Stop {#MyAppName}"; Filename: "{app}\stop.bat"; WorkingDir: "{app}"
Name: "{group}\Uninstall {#MyAppName}"; Filename: "{uninstallexe}"
Name: "{userstartup}\{#MyAppName}"; Filename: "{app}\ntobot.exe"; WorkingDir: "{app}"; IconFilename: "{app}\nto-bot.ico"; Comment: "Auto-start NTO BOT on Windows login"

[Run]
; Launch after install (checkbox on final page)
Filename: "{app}\ntobot.exe"; Description: "Launch NTO BOT now"; Flags: postinstall nowait shellexec unchecked

[UninstallRun]
; Kill server before uninstalling
Filename: "{cmd}"; Parameters: "/c for /f ""tokens=5"" %p in ('netstat -ano ^| findstr "":6969"" ^| findstr ""LISTENING""') do taskkill /F /PID %p"; Flags: runhidden waituntilterminated

[UninstallDelete]
Type: filesandordirs; Name: "{app}\SERVER\node_modules"
Type: filesandordirs; Name: "{app}\profiles"
Type: dirifempty; Name: "{app}\data\logs"
Type: dirifempty; Name: "{app}\data\exports"
Type: dirifempty; Name: "{app}\data\downloads"
Type: dirifempty; Name: "{app}\data\screenshots"
Type: dirifempty; Name: "{app}\data\captcha-debug"
Type: dirifempty; Name: "{app}\data"
Type: dirifempty; Name: "{app}"

[Code]
var
  NodeInstallRequired: Boolean;
  DownloadPage: TDownloadWizardPage;

// ============================================
// Check if Node.js is installed
// ============================================
function IsNodeInstalled(): Boolean;
var
  ResultCode: Integer;
begin
  Result := Exec('cmd.exe', '/c node --version', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  Result := Result and (ResultCode = 0);
end;

// ============================================
// Initial check: is Node.js available?
// ============================================
function InitializeSetup(): Boolean;
begin
  Result := True;
  NodeInstallRequired := False;

  if not IsNodeInstalled() then
  begin
    if MsgBox(
      'Node.js is required but was not found on this system.' + #13#10 + #13#10 +
      'Would you like to download and install Node.js 22 LTS automatically?' + #13#10 +
      '(~30 MB download)',
      mbConfirmation, MB_YESNO) = IDYES then
    begin
      NodeInstallRequired := True;
    end
    else
    begin
      MsgBox(
        'Node.js is required to run NTO BOT.' + #13#10 + #13#10 +
        'Please install Node.js from https://nodejs.org and run this installer again.',
        mbError, MB_OK);
      Result := False;
    end;
  end;
end;

// ============================================
// Download and install Node.js if needed
// ============================================
procedure InstallNodeJs();
var
  ResultCode: Integer;
  NodeMsi: String;
begin
  NodeMsi := ExpandConstant('{tmp}\node-v22.14.0-x64.msi');

  // Download Node.js using PowerShell
  Exec('powershell.exe',
    '-ExecutionPolicy Bypass -Command "& { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri ''https://nodejs.org/dist/v22.14.0/node-v22.14.0-x64.msi'' -OutFile ''' + NodeMsi + ''' }"',
    '', SW_HIDE, ewWaitUntilTerminated, ResultCode);

  if not FileExists(NodeMsi) then
  begin
    MsgBox(
      'Failed to download Node.js.' + #13#10 + #13#10 +
      'Please check your internet connection and try again, or install Node.js manually from https://nodejs.org',
      mbError, MB_OK);
    Exit;
  end;

  // Install Node.js silently
  Exec('msiexec.exe', '/i "' + NodeMsi + '" /qn /norestart', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);

  if ResultCode <> 0 then
  begin
    MsgBox(
      'Node.js installation may have failed (exit code: ' + IntToStr(ResultCode) + ').' + #13#10 + #13#10 +
      'If NTO BOT does not work after setup, please install Node.js manually from https://nodejs.org',
      mbInformation, MB_OK);
  end;
end;

// ============================================
// Create .env files
// ============================================
procedure WriteEnvFile(const FilePath: String);
var
  EnvContent: AnsiString;
begin
  // Write as ANSI to avoid UTF-8 BOM that TStringList adds
  EnvContent :=
    'PORT=6969' + #13#10 +
    'NODE_ENV=development' + #13#10 +
    'LOG_LEVEL=info' + #13#10 +
    'DATABASE_URL=file:../../data/bot-nto.db' + #13#10 +
    'ENCRYPTION_KEY=change-this-to-a-random-32-byte-key' + #13#10;
  SaveStringToFile(FilePath, EnvContent, False);
end;

procedure CreateEnvFiles();
var
  EnvPath: String;
begin
  EnvPath := ExpandConstant('{app}\SERVER\.env');
  if not FileExists(EnvPath) then
    WriteEnvFile(EnvPath);

  EnvPath := ExpandConstant('{app}\.env');
  if not FileExists(EnvPath) then
    WriteEnvFile(EnvPath);
end;

// ============================================
// Run a command with error checking
// ============================================
function RunPostInstallCmd(const Desc, Cmd: String): Boolean;
var
  ResultCode: Integer;
  AppPath: String;
  FullCmd: String;
begin
  AppPath := ExpandConstant('{app}');
  FullCmd := '/c set "PATH=%ProgramFiles%\nodejs;%PATH%" && cd /d "' + AppPath + '\SERVER" && ' + Cmd;

  WizardForm.StatusLabel.Caption := Desc;
  WizardForm.FilenameLabel.Caption := Cmd;

  Result := Exec('cmd.exe', FullCmd, AppPath + '\SERVER', SW_HIDE, ewWaitUntilTerminated, ResultCode);

  if (not Result) or (ResultCode <> 0) then
  begin
    MsgBox(
      'Step failed: ' + Desc + #13#10 + #13#10 +
      'Command: ' + Cmd + #13#10 +
      'Exit code: ' + IntToStr(ResultCode) + #13#10 + #13#10 +
      'The installer will continue, but NTO BOT may not work correctly.' + #13#10 +
      'You can fix this manually by opening CMD in the install folder and running the command.',
      mbError, MB_OK);
    Result := False;
  end
  else
    Result := True;
end;

// ============================================
// Verify critical files exist after extraction
// ============================================
function VerifyFilesExtracted(): Boolean;
var
  AppPath: String;
begin
  AppPath := ExpandConstant('{app}');
  Result := True;

  if not FileExists(AppPath + '\SERVER\package.json') then
  begin
    MsgBox(
      'Critical file missing: SERVER\package.json' + #13#10 + #13#10 +
      'Files were not extracted correctly. The installation cannot continue.' + #13#10 +
      'Please try running the installer again, or check if antivirus is blocking the installation.',
      mbCriticalError, MB_OK);
    Result := False;
  end;

  if not FileExists(AppPath + '\SERVER\prisma\schema.prisma') then
  begin
    MsgBox(
      'Critical file missing: SERVER\prisma\schema.prisma' + #13#10 + #13#10 +
      'Files were not extracted correctly. The installation cannot continue.',
      mbCriticalError, MB_OK);
    Result := False;
  end;
end;

// ============================================
// Hook into install steps
// ============================================
procedure CurStepChanged(CurStep: TSetupStep);
var
  InstallOK: Boolean;
begin
  if CurStep = ssInstall then
  begin
    // Install Node.js before copying files if needed
    if NodeInstallRequired then
      InstallNodeJs();
  end;

  if CurStep = ssPostInstall then
  begin
    // Create .env configuration files
    CreateEnvFiles();

    // Verify files were actually extracted
    if not VerifyFilesExtracted() then
      Exit;

    // Run post-install commands with error checking
    WizardForm.StatusLabel.Caption := 'Setting up NTO BOT...';

    InstallOK := RunPostInstallCmd(
      'Installing Node.js dependencies (this may take a few minutes)...',
      'npm install');

    if InstallOK then
      RunPostInstallCmd(
        'Generating database client...',
        'npx prisma generate');

    if InstallOK then
      RunPostInstallCmd(
        'Setting up SQLite database...',
        'npx prisma db push --skip-generate');

    if WizardIsComponentSelected('playwright') then
      RunPostInstallCmd(
        'Installing Chromium browser for automation...',
        'npx playwright install chromium');

    WizardForm.StatusLabel.Caption := 'Installation complete.';
    WizardForm.FilenameLabel.Caption := '';
  end;
end;

// ============================================
// Uninstall: ask about data deletion
// ============================================
procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if CurUninstallStep = usUninstall then
  begin
    if MsgBox(
      'Do you also want to delete all NTO BOT data?' + #13#10 + #13#10 +
      'This includes:' + #13#10 +
      '  - Database (accounts, results, settings)' + #13#10 +
      '  - Browser profiles (saved logins)' + #13#10 +
      '  - Exported files and screenshots' + #13#10 + #13#10 +
      'Click Yes to delete everything, No to keep data.',
      mbConfirmation, MB_YESNO) = IDYES then
    begin
      DelTree(ExpandConstant('{app}\data'), True, True, True);
      DelTree(ExpandConstant('{app}\profiles'), True, True, True);
    end;
  end;
end;
