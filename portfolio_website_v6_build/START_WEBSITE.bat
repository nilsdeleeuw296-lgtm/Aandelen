@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed or not on PATH.
  echo Install Node.js LTS and reopen this file.
  pause
  exit /b 1
)

echo Starting Portfolio Planner v6 on http://localhost:5174 ...
start "" /b node server.js
timeout /t 2 >nul
start "" http://localhost:5174
echo Server running. Keep this window open.
pause
