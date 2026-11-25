@echo off
rem Point the shortcuts straight at electron.exe so the app launches as a pure
rem GUI process. Launching through a .cmd/`npm` is what opened the console window.
setlocal
cd /d "%~dp0"

set "ELECTRON=%~dp0node_modules\electron\dist\electron.exe"
set "ICON=%~dp0electron\icon.ico"
set "FOLDER=%APPDATA%\Microsoft\Windows\Start Menu\Programs"
set "START_LNK=%FOLDER%\Agent Workbench.lnk"
set "DESKTOP_LNK=%USERPROFILE%\Desktop\Agent Workbench.lnk"

if not exist "%ELECTRON%" (
  echo [workbench] Electron is missing. Run "npm install" and provision the Electron binary first.
  pause
  exit /b 1
)
if not exist "%ICON%" (
  echo [workbench] Icon is missing. Run "node scripts\make-icon.cjs" first.
  pause
  exit /b 1
)

call :mklink "%START_LNK%"
call :mklink "%DESKTOP_LNK%"
echo [workbench] Shortcuts updated. Double-click "Agent Workbench" to launch (no console window).
echo [workbench] After changing source code, run "build-desktop.cmd" to rebuild the UI.
exit /b 0

:mklink
powershell -NoProfile -Command "$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut('%~1'); $s.TargetPath = '%ELECTRON%'; $s.Arguments = '.'; $s.WorkingDirectory = '%~dp0'; $s.IconLocation = '%ICON%,0'; $s.Save()"
exit /b 0
