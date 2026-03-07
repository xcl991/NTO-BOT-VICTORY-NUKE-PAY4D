; ============================================
; BOT BO PANEL - Inno Setup Installer Script
; Requires: Inno Setup 6.x (https://jrsoftware.org/isdl.php)
; ============================================

#define MyAppName "BOT BO PANEL"
#define MyAppVersion "1.6.0"
#define MyAppPublisher "BOT BO PANEL"
#define MyAppURL "http://localhost:6969"
#define MyAppExeName "botbopanel.exe"

[Setup]
AppId={{C9A4F3B2-6D8E-4F0A-B2C3-4E5F6A7B8C9D}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}
DefaultDirName={sd}\{#MyAppName}
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
OutputDir=installer\output
OutputBaseFilename=BOTBOPANEL
SetupIconFile=installer\botbopanel.ico
UninstallDisplayIcon={app}\botbopanel.ico
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=admin
VersionInfoVersion=1.6.0
VersionInfoCompany=BOT BO PANEL
VersionInfoDescription=BOT BO PANEL Automation Dashboard Installer
VersionInfoProductName=BOT BO PANEL
MinVersion=10.0
SourceDir=..

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Messages]
WelcomeLabel1=Welcome to BOT BO PANEL Setup
WelcomeLabel2=This will install BOT BO PANEL Automation Dashboard on your computer.%n%nThe installer will:%n  - Install project files%n  - Install Node.js dependencies%n  - Setup the database%n  - Install Chromium browser%n  - Create desktop shortcut%n%nClick Next to continue.
FinishedHeadingLabel=BOT BO PANEL Installation Complete!
FinishedLabel=BOT BO PANEL has been successfully installed.%n%nDouble-click the desktop shortcut to start.%nThe panel will open at http://localhost:6969

[Types]
Name: "full"; Description: "Full installation"
Name: "compact"; Description: "Compact installation (skip Playwright)"
Name: "custom"; Description: "Custom installation"; Flags: iscustom

[Components]
Name: "main"; Description: "BOT BO PANEL Core Files"; Types: full compact custom; Flags: fixed
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
Source: "installer\botbopanel.exe"; DestDir: "{app}"; Flags: ignoreversion; Components: main
Source: "installer\start.vbs"; DestDir: "{app}"; Flags: ignoreversion; Components: main
Source: "installer\start.bat"; DestDir: "{app}"; Flags: ignoreversion; Components: main
Source: "installer\stop.bat"; DestDir: "{app}"; Flags: ignoreversion; Components: main

; === Icon ===
Source: "installer\botbopanel.ico"; DestDir: "{app}"; Flags: ignoreversion skipifsourcedoesntexist; Components: main

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
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\botbopanel.exe"; WorkingDir: "{app}"; IconFilename: "{app}\botbopanel.ico"; Comment: "BOT BO PANEL - Automation Dashboard"
Name: "{group}\{#MyAppName}"; Filename: "{app}\botbopanel.exe"; WorkingDir: "{app}"; IconFilename: "{app}\botbopanel.ico"
Name: "{group}\{#MyAppName} (Debug)"; Filename: "{app}\start.bat"; WorkingDir: "{app}"; IconFilename: "{app}\botbopanel.ico"
Name: "{group}\Stop {#MyAppName}"; Filename: "{app}\stop.bat"; WorkingDir: "{app}"
Name: "{group}\Uninstall {#MyAppName}"; Filename: "{uninstallexe}"

[Run]
Filename: "{app}\botbopanel.exe"; Description: "Launch BOT BO PANEL now"; Flags: postinstall nowait shellexec unchecked

[UninstallRun]
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

function IsNodeInstalled(): Boolean;
var
  ResultCode: Integer;
begin
  Result := Exec('cmd.exe', '/c node --version', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  Result := Result and (ResultCode = 0);
end;

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
        'Node.js is required to run BOT BO PANEL.' + #13#10 + #13#10 +
        'Please install Node.js from https://nodejs.org and run this installer again.',
        mbError, MB_OK);
      Result := False;
    end;
  end;
end;

procedure InstallNodeJs();
var
  ResultCode: Integer;
  NodeMsi: String;
begin
  NodeMsi := ExpandConstant('{tmp}\node-v22.14.0-x64.msi');

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

  Exec('msiexec.exe', '/i "' + NodeMsi + '" /qn /norestart', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);

  if ResultCode <> 0 then
  begin
    MsgBox(
      'Node.js installation may have failed (exit code: ' + IntToStr(ResultCode) + ').' + #13#10 + #13#10 +
      'If BOT BO PANEL does not work after setup, please install Node.js manually from https://nodejs.org',
      mbInformation, MB_OK);
  end;
end;

procedure WriteEnvFile(const FilePath: String);
var
  EnvContent: AnsiString;
begin
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
      'The installer will continue, but BOT BO PANEL may not work correctly.' + #13#10 +
      'You can fix this manually by opening CMD in the install folder and running the command.',
      mbError, MB_OK);
    Result := False;
  end
  else
    Result := True;
end;

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

procedure AddDefenderExclusion();
var
  ResultCode: Integer;
  AppPath: String;
begin
  AppPath := ExpandConstant('{app}');
  WizardForm.StatusLabel.Caption := 'Adding Windows Defender exclusion...';
  WizardForm.FilenameLabel.Caption := AppPath;

  Exec('powershell.exe',
    '-ExecutionPolicy Bypass -Command "& { try { Add-MpPreference -ExclusionPath ''' + AppPath + ''' -ErrorAction SilentlyContinue } catch {} }"',
    '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  InstallOK: Boolean;
begin
  if CurStep = ssInstall then
  begin
    if NodeInstallRequired then
      InstallNodeJs();
  end;

  if CurStep = ssPostInstall then
  begin
    AddDefenderExclusion();
    CreateEnvFiles();

    if not VerifyFilesExtracted() then
      Exit;

    WizardForm.StatusLabel.Caption := 'Setting up BOT BO PANEL...';

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

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  ResultCode: Integer;
begin
  if CurUninstallStep = usUninstall then
  begin
    // Remove Windows Defender exclusion
    Exec('powershell.exe',
      '-ExecutionPolicy Bypass -Command "& { try { Remove-MpPreference -ExclusionPath ''' + ExpandConstant('{app}') + ''' -ErrorAction SilentlyContinue } catch {} }"',
      '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
    if MsgBox(
      'Do you also want to delete all BOT BO PANEL data?' + #13#10 + #13#10 +
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
