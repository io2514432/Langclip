@echo off
REM Langclip v4.5 hotfix - applies 10 UI/logic fixes, then commits.
cd /d "%~dp0"
where python >nul 2>nul
if errorlevel 1 goto nopy
python "%~dp0fix_v45.py"
echo.
echo Done. Now restart the server (start.bat) and press Ctrl+Shift+R in the browser.
pause
exit /b 0
:nopy
echo [error] python not found in PATH. Install from python.org with "Add to PATH".
pause
