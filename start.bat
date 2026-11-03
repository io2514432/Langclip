@echo off
REM Langclip - ADMIN server. Port 8000. You only.
cd /d "%~dp0"
call _py.bat
"%PY%" -c "import uvicorn" >nul 2>nul
if errorlevel 1 goto nodep
echo.
echo   python       : %PY%
echo   admin server : http://127.0.0.1:8000
echo   admin entry  : run admin_link.bat
echo.
"%PY%" -m uvicorn main:app --host 127.0.0.1 --port 8000
goto end

:nodep
echo.
echo   [error] uvicorn is missing for: %PY%
echo   Run setup.bat once. It creates .venv and installs requirements.txt
echo.
pause

:end
