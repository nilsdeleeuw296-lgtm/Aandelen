@echo off
setlocal
cd /d "%~dp0"
echo Starting Portfolio Planner v6 on http://localhost:5174 ...
start "" http://localhost:5174
node server.js
pause
