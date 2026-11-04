@echo off
REM Langclip - PUBLIC server + HTTPS tunnel. No Cloudflare, no domain.
REM   tunnel.bat       pinggy.io over port 443 (default)
REM   tunnel.bat lhr   localhost.run over port 22
REM   tunnel.bat cf    Cloudflare quick tunnel
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
echo [3/3] tunnel via pinggy.io port 443
echo       copy the https address below. Ctrl+C closes it.
ssh -p 443 -o StrictHostKeyChecking=accept-new -o ServerAliveInterval=30 -o ExitOnForwardFailure=yes -R0:localhost:8001 a.pinggy.io
goto end

:lhr
echo [3/3] tunnel via localhost.run port 22
echo       if it hangs, port 22 is blocked. use tunnel.bat instead.
ssh -o StrictHostKeyChecking=accept-new -o ServerAliveInterval=30 -o ExitOnForwardFailure=yes -R 80:localhost:8001 nokey@localhost.run
goto end

:cf
echo [3/3] tunnel via Cloudflare
if exist "%ProgramFiles(x86)%\cloudflared\cloudflared.exe" goto runcf
cloudflared tunnel --url http://127.0.0.1:8001
goto end

:runcf
"%ProgramFiles(x86)%\cloudflared\cloudflared.exe" tunnel --url http://127.0.0.1:8001
goto end

:end
