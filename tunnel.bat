@echo off
REM Langclip - PUBLIC server + HTTPS tunnel for friends.
REM Starts public.bat in its own window, waits until port 8001 answers, then tunnels.
cd /d "%~dp0"

echo [1/3] starting PUBLIC server on 127.0.0.1:8001
start "Langclip public" /D "%~dp0" cmd /k public.bat

echo [2/3] waiting for the server
set /a N=0
:wait
timeout /t 1 >nul
curl -s -f -o nul http://127.0.0.1:8001/api/health
if not errorlevel 1 goto ready
set /a N+=1
if %N% lss 40 goto wait
echo.
echo   [error] no answer on port 8001 after 40 seconds.
echo   Look at the "Langclip public" window for the reason.
pause
exit /b 1

:ready
echo       server is up.

echo [3/3] opening the tunnel
echo       copy the https://...trycloudflare.com address below
where cloudflared >nul 2>nul
if errorlevel 1 goto nocf
cloudflared tunnel --url http://127.0.0.1:8001
goto end

:nocf
echo.
echo   cloudflared not found. install it first:
echo     winget install --id Cloudflare.cloudflared
echo   then open a NEW terminal window and run tunnel.bat again.
pause

:end
