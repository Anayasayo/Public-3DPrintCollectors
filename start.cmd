@echo off
rem 3DPrintCollectors launcher - rebuilds the web app if its code changed, starts the local server, opens the browser.
rem The server stops by itself about 30 seconds after the last app tab closes, so every launch starts fresh.
cd /d "%~dp0"

rem The launcher runs hidden, so say so out loud if Node.js is missing.
where node >nul 2>nul
if errorlevel 1 (
  start "" https://nodejs.org/en/download
  powershell -NoProfile -Command "Add-Type -AssemblyName PresentationFramework; [void][System.Windows.MessageBox]::Show('Node.js is not installed. Download the LTS installer from the page that just opened, run it, then start 3DPrintCollectors again.', '3DPrintCollectors')"
  exit /b 1
)

if not exist "node_modules\" call npm install

rem Rebuild when there is no build yet, or anything in web\src (or the web config) is newer than the last build.
powershell -NoProfile -Command "$b = Get-Item 'web\dist\index.html' -ErrorAction SilentlyContinue; if (-not $b) { exit 1 }; $n = Get-ChildItem 'web\src','web\index.html','web\vite.config.*','web\package.json' -Recurse -File -ErrorAction SilentlyContinue | Where-Object { $_.LastWriteTime -gt $b.LastWriteTime } | Select-Object -First 1; if ($n) { exit 1 } else { exit 0 }"
if errorlevel 1 call npm run build

powershell -NoProfile -Command "if (Get-NetTCPConnection -LocalPort 5178 -State Listen -ErrorAction SilentlyContinue) { exit 1 } else { exit 0 }"
if errorlevel 1 (
  echo 3DPrintCollectors is already running.
  start "" http://127.0.0.1:5178
  exit /b
)

start "" http://127.0.0.1:5178
set AUTO_SHUTDOWN=1
call npm run serve
