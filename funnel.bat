@echo off
REM Langclip - FIXED public URL via Tailscale Funnel.
REM Free, no domain, real HTTPS certificate, address never changes.
REM One time install:  winget install Tailscale.Tailscale
REM Then sign in to Tailscale once, and run this file.
cd /d "%~dp0"

echo [1/4] checking tailscale
set "TS=tailscale"
if exist "%ProgramFiles%\Tailscale\tailscale.exe" set "TS=%ProgramFiles%\Tailscale\tailscale.exe"
if "%TS%"=="tailscale" goto chk
goto start

:chk
where tailscale >nul 2>nul
if errorlevel 1 goto nots

:start
echo [2/4] starting PUBLIC server on 127.0.0.1:8001
start "Langclip public" /D "%~dp0" cmd /k public.bat

echo [3/4] waiting for the server
set /a N=0
:wait
timeout /t 1 >nul
curl -s -f -o nul http://127.0.0.1:8001/api/health
if not errorlevel 1 goto funnel
set /a N+=1
if %N% lss 40 goto wait
echo.
echo   [error] no answer on port 8001 after 40 seconds.
pause
exit /b 1

:funnel
echo       server is up.
echo [4/4] opening the funnel on port 443
echo       the first run opens a browser to approve Funnel. click Approve.
"%TS%" funnel --bg 8001
echo.
echo   your fixed address:
"%TS%" funnel status
echo.
echo   keep this window open. Ctrl+C stops the funnel.
pause
goto end

:nots
echo.
echo   [error] tailscale is not installed.
echo   install it with:  winget install Tailscale.Tailscale
echo   then open Tailscale and sign in, and run this file again.
echo.
pause

:end
