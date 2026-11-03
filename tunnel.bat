@echo off
REM Langclip - PUBLIC server + HTTPS tunnel for friends.
REM This starts public.bat (port 8001) in its own window, waits until it answers,
REM then opens the tunnel. No fixed timeout guessing.
cd /d "%~dp0"

echo [1/3] starting PUBLIC server on 127.0.0.1:8001 ...
start "Langclip public" /D "%~dp0" cmd /k public.bat

echo [2/3] waiting for the server to answer ...
set /a N=0
:wait
timeout /t 1 >nul
curl -s -f -o nul http://127.0.0.1:8001/api/health
if not errorlevel 1 goto ready
set /a N+=1
if %N% lss 40 goto wait
echo.
echo [error] no answer on port 8001 after 40s.
echo         Check the "Langclip public" window for the error message.
pause
exit /b 1
:ready
echo       server is up.

echo [3/3] opening a public HTTPS tunnel to port 8001 ...
echo       copy the https://...trycloudflare.com address below and send it to friends
where cloudflared >nul 2>nul
if errorlevel 1 (
  echo cloudflared not found. install it first:
  echo    winget install --id Cloudflare.cloudflared
  pause
  exit /b 1
)
cloudflared tunnel --url http://127.0.0.1:8001
