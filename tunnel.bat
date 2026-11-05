@echo off
setlocal enabledelayedexpansion
REM Langclip - PUBLIC server + HTTPS tunnel
REM   tunnel.bat        pinggy.io      (port 443)
REM   tunnel.bat lhr    localhost.run  (port 22)
REM   tunnel.bat cf     cloudflare quick tunnel
REM
REM Pinggy asks "Password:" - it is BLANK, just press ENTER.
REM If nothing happens after ENTER the cause is almost always SSH auth:
REM   - an ssh key that needs a passphrase (pubkey auth disabled below)
REM   - a stale / corrupt host key entry (throwaway known_hosts below)
REM   - a tunnel already running and holding the remote port

cd /d "%~dp0"
set "MODE=%~1"
if "%MODE%"=="" set "MODE=pinggy"

set "SSH=C:\Windows\System32\OpenSSH\ssh.exe"
if not exist "%SSH%" set "SSH=ssh"
set "KH=%TEMP%\langclip_known_hosts"

echo [1/3] starting PUBLIC server on 127.0.0.1:8001
start "Langclip public" /D "%~dp0" cmd /k public.bat

echo [2/3] waiting for the server
set /a N=0
:wait
timeout /t 1 >nul
curl -s -f -o nul http://127.0.0.1:8001/api/health
if not errorlevel 1 goto ready
set /a N+=1
if !N! lss 45 goto wait
echo.
echo   [error] no answer on port 8001 after 45 seconds.
echo   Look at the "Langclip public" window - it usually shows the reason.
pause
exit /b 1

:ready
echo       server is up.
if /i "%MODE%"=="lhr" goto lhr
if /i "%MODE%"=="cf" goto cf
goto pinggy

:pinggy
echo.
echo [3/3] tunnel via pinggy.io on port 443
echo       at "Password:" just press ENTER (blank password)
echo.
"%SSH%" -p 443 -o StrictHostKeyChecking=no -o UserKnownHostsFile="%KH%" ^
 -o PubkeyAuthentication=no -o PreferredAuthentications=password ^
 -o NumberOfPasswordPrompts=1 -o ConnectTimeout=15 ^
 -o ServerAliveInterval=20 -o ExitOnForwardFailure=yes ^
 -R0:127.0.0.1:8001 a.pinggy.io
echo.
echo       ssh exited with code %ERRORLEVEL%   (255 = auth or network refused)
echo       reconnecting in 5 seconds, Ctrl+C to stop.
timeout /t 5 >nul
goto pinggy

:lhr
echo.
echo [3/3] tunnel via localhost.run on port 22
echo.
"%SSH%" -o StrictHostKeyChecking=no -o UserKnownHostsFile="%KH%" ^
 -o PubkeyAuthentication=no -o PreferredAuthentications=password ^
 -o NumberOfPasswordPrompts=1 -o ConnectTimeout=15 ^
 -o ServerAliveInterval=20 -o ExitOnForwardFailure=yes ^
 -R 80:127.0.0.1:8001 nokey@localhost.run
echo.
echo       ssh exited with code %ERRORLEVEL%
timeout /t 5 >nul
goto lhr

:cf
echo [3/3] tunnel via Cloudflare quick tunnel
if exist "%ProgramFiles(x86)%\cloudflared\cloudflared.exe" goto runcf
where cloudflared >nul 2>nul
if not errorlevel 1 goto runcf2
echo   [error] cloudflared is not installed.
echo   winget install --id Cloudflare.cloudflared
pause
exit /b 1
:runcf
"%ProgramFiles(x86)%\cloudflared\cloudflared.exe" tunnel --url http://127.0.0.1:8001
goto end
:runcf2
cloudflared tunnel --url http://127.0.0.1:8001

:end
pause
