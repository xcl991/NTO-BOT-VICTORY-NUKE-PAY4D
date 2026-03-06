' NTO BOT - Silent Launcher
' Starts the server in a hidden CMD window and opens the browser.

Dim objShell, objFSO, rootPath, serverPath

Set objShell = CreateObject("WScript.Shell")
Set objFSO = CreateObject("Scripting.FileSystemObject")

' Auto-detect root path (works from installer/ subfolder or installed root)
Dim scriptDir
scriptDir = objFSO.GetParentFolderName(WScript.ScriptFullName)

If objFSO.FolderExists(scriptDir & "\SERVER") Then
    ' Script is in root (installed version)
    rootPath = scriptDir
Else
    ' Script is in installer/ subfolder (dev version)
    rootPath = objFSO.GetAbsolutePathName(scriptDir & "\..")
End If
serverPath = rootPath & "\SERVER"

' Check if server is already running on port 6969
Dim checkCmd, exitCode
exitCode = objShell.Run("cmd /c netstat -ano | findstr "":6969"" | findstr ""LISTENING"" >nul 2>&1", 0, True)
If exitCode = 0 Then
    ' Server already running, just open browser
    objShell.Run "cmd /c start http://localhost:6969", 0, False
    Set objShell = Nothing
    Set objFSO = Nothing
    WScript.Quit
End If

' Start the server in a hidden CMD window
Dim startCmd
startCmd = "cmd /c cd /d """ & serverPath & """ && npx tsx src/index.ts"
objShell.Run startCmd, 0, False

' Wait for server to boot
WScript.Sleep 4000

' Open browser to the panel
objShell.Run "cmd /c start http://localhost:6969", 0, False

Set objShell = Nothing
Set objFSO = Nothing
