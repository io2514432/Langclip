@echo off
REM Langclip - PUBLIC server. Port 8001. Friends use this one.
cd /d "%~dp0"
call _py.bat
set APP_MODE=public
"%PY%" -c "import uvicorn" >nul 2>nul
if errorlevel 1 goto nodep
echo.
echo   python        : %PY%
echo   public server : http://127.0.0.1:8001
echo   friends start with an empty learning record
echo.
"%PY%" -m uvicorn main:app --host 127.0.0.1 --port 8001
goto end

:nodep
echo.
echo   [error] uvicorn is missing for: %PY%
echo   Run setup.bat once.
echo.
pause

:end
