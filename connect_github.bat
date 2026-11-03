@echo off
setlocal enabledelayedexpansion
REM Langclip - connect this folder to a GitHub repository and push.
REM Use this when PowerShell blocks .ps1 scripts (execution policy).
REM Before running: create an EMPTY private repo on github.com (no README).

cd /d "%~dp0"
echo.
echo == 1^) current state ==
if not exist ".git" (
  echo [error] not a git repository. run this from C:\dev\langclip
  pause
  exit /b 1
)
git log --oneline -1
echo.
git remote -v

echo.
echo == 2^) repository URL ==
echo example: https://github.com/yourname/langclip.git
set "URL="
set /p URL=URL: 
if "%URL%"=="" (
  echo [stop] no URL given
  pause
  exit /b 1
)

echo.
echo == 3^) setting origin ==
set "HAS=0"
for /f "tokens=1" %%r in ('git remote') do if /i "%%r"=="origin" set "HAS=1"
if "%HAS%"=="1" (
  git remote set-url origin "%URL%"
  echo origin replaced
) else (
  git remote add origin "%URL%"
  echo origin added
)
git remote -v

echo.
echo == 4^) branch name ==
git branch -M main

echo.
echo == 5^) push ==
echo a browser window may open. sign in to GitHub and approve.
git push -u origin main
if errorlevel 1 (
  echo.
  echo [failed] push was rejected. see the message above.
  echo   Authentication failed  ^-^> you closed the browser window. run again.
  echo   rejected / fetch first  ^-^> the repo already has commits ^(README^). delete it and make an empty one.
  echo   repository not found   ^-^> wrong URL or the repo does not exist.
  pause
  exit /b 1
)

echo.
echo == done ==
echo code now lives in two places: this PC and GitHub.
echo new computer:  git clone %URL% langclip  then  setup.bat  then  start.bat
echo.
pause
