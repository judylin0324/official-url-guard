@echo off
rem Official URL Guard LINE bot: first-time setup (double-click to run)
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Please install the LTS version from https://nodejs.org/ and run this file again.
  pause
  exit /b 1
)
if not exist node_modules\wrangler call npm install --no-audit --no-fund
node tools\setup.mjs
pause
