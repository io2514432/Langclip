@echo off
REM Langclip - PUBLIC server + HTTPS tunnel. No Cloudflare, no domain.
REM   tunnel.bat       pinggy.io over port 443 (default)
REM   tunnel.bat lhr   localhost.run over port 22
REM   tunnel.bat cf    Cloudflare quick tunnel
REM
REM Pinggy asks for a password. Just press ENTER, the password is blank.
REM Run ssh-keygen once to stop the prompt for good.
REM Pinggy free closes the tunnel after 60 minutes; this file reconnects.
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
pause
exit /b 1

:ready
echo       server is up.
if /i "%~1"=="lhr" goto lhr
if /i "%~1"=="cf" goto cf
goto pinggy

:pinggy
echo.
echo [3/3] tunnel via pinggy.io on port 443
echo       when it asks for a password, just press ENTER.
echo       copy the https address it prints. Ctrl+C stops everything.
echo.
ssh -p 443 -o StrictHostKeyChecking=accept-new -o ServerAliveInterval=20 -o ExitOnForwardFailure=yes -R0:127.0.0.1:8001 a.pinggy.io
echo.
echo       tunnel closed. reconnecting in 5 seconds, Ctrl+C to stop.
timeout /t 5 >nul
goto pinggy

:lhr
echo.
echo [3/3] tunnel via localhost.run on port 22
echo       if it hangs, port 22 is blocked. run tunnel.bat instead.
echo.
ssh -o StrictHostKeyChecking=accept-new -o ServerAliveInterval=20 -o ExitOnForwardFailure=yes -R 80:127.0.0.1:8001 nokey@localhost.run
echo.
echo       tunnel closed. reconnecting in 5 seconds, Ctrl+C to stop.
timeout /t 5 >nul
goto lhr

:cf
echo [3/3] tunnel via Cloudflare
if exist "%ProgramFiles(x86)%\cloudflared\cloudflared.exe" goto runcf
cloudflared tunnel --url http://127.0.0.1:8001
goto end

:runcf
"%ProgramFiles(x86)%\cloudflared\cloudflared.exe" tunnel --url http://127.0.0.1:8001

:end
