@echo off
rem Rebuild the frontend bundle the desktop window serves. Run this after pulling
rem or changing source; the desktop shortcut itself launches electron.exe directly.
setlocal
cd /d "%~dp0"
call npm run desktop:build
if errorlevel 1 (
  echo [workbench] build failed.
  pause
  exit /b 1
)
echo [workbench] frontend built. Double-click the "Agent Workbench" shortcut to launch.
exit /b 0
