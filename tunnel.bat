@echo off
REM Langclip - PUBLIC server + HTTPS tunnel for friends.
REM Friends open the https://....trycloudflare.com address printed at [2/2].
REM Their learning records are separate from yours (cookie based).
cd /d "%~dp0"
set APP_MODE=public

echo [1/2] starting PUBLIC server on 127.0.0.1:8001 ...
start "Langclip public" cmd /c python -m uvicorn main:app --host 127.0.0.1 --port 8001
timeout /t 4 >nul

echo [2/2] opening a public HTTPS tunnel to port 8001 ...
echo      copy the https://...trycloudflare.com address below and send it to friends
where cloudflared >nul 2>nul
if errorlevel 1 (
  echo cloudflared not found. install it first:
  echo    winget install --id Cloudflare.cloudflared
  pause
  exit /b 1
)
cloudflared tunnel --url http://127.0.0.1:8001
