@echo off
REM Langel - public mode launcher (Cloudflare Tunnel)
REM 1) set your admin token below   2) double-click this file
set ADMIN_TOKEN=change-me-please

echo [1/3] starting server on 127.0.0.1:8000 ...
start "Langel server" cmd /c python -m uvicorn main:app --host 127.0.0.1 --port 8000
timeout /t 4 >nul

echo [2/3] opening a public HTTPS tunnel ...
echo      copy the https://....trycloudflare.com address below
where cloudflared >nul 2>nul
if errorlevel 1 (
  echo cloudflared not found. install it first:
  echo    winget install --id Cloudflare.cloudflared
  pause
  exit /b 1
)
cloudflared tunnel --url http://localhost:8000
