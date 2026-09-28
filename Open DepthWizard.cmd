@echo off
setlocal
title DepthWizard Terrain
cd /d "%~dp0"

where node.exe >nul 2>&1
if errorlevel 1 (
  echo Node.js is required to open DepthWizard.
  echo Install Node.js, then double-click this file again.
  pause
  exit /b 1
)

if not exist "node_modules\vite\bin\vite.js" (
  echo Installing project dependencies. This first setup needs internet access.
  call npm.cmd install
  if errorlevel 1 (
    echo Setup failed. Check the error above, then try again.
    pause
    exit /b 1
  )
)

echo Starting DepthWizard and opening your browser...
echo Keep this window open while using the viewer. You can minimize it.
echo Closing this window stops the local viewer.
echo Next time, double-click Open DepthWizard.cmd again.
echo.
call npm.cmd run dev -- --port 5174 --open
if errorlevel 1 (
  echo The viewer could not start. See the error above.
  pause
  exit /b 1
)
endlocal
