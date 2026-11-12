@echo off
rem Build official-site logo fingerprints from a Taiwan network (Windows).
rem Requires Node.js 22+ (https://nodejs.org/). Double-click this file, or run it from the project folder.
chcp 65001 >nul
cd /d "%~dp0.."
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Please install the LTS version from https://nodejs.org/ and run this file again.
  pause
  exit /b 1
)
echo [1/3] Installing Playwright...
call npm install --no-save playwright@1.63.0 || goto :fail
echo [2/3] Installing Chromium...
call npx playwright install chromium || goto :fail
echo [3/3] Building logo fingerprints (this takes 20-40 minutes)...
node tools\build-logo-hashes.mjs || goto :fail
echo.
echo Done. The result is in src\data\logo-hashes.js
pause
exit /b 0
:fail
echo.
echo Failed. Please copy the messages above and send them to the maintainer.
pause
exit /b 1
