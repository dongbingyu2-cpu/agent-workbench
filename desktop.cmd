@echo off
rem Build the frontend bundle, then open the workbench as a desktop window.
cd /d "%~dp0"
if not exist "node_modules" (
  echo [workbench] installing dependencies...
  call npm install
  if errorlevel 1 exit /b 1
)
call npm run desktop
exit /b %errorlevel%
