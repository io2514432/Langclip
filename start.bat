@echo off
REM Langclip - ADMIN server (you only). Port 8000.
cd /d "%~dp0"
call _py.bat

if not exist ".venv\Scripts\python.exe" (
  echo [warn] .venv not found. Run setup.bat once, or this will use system python.
)

"%PY%" -c "import uvicorn" >nul 2>nul
if errorlevel 1 (
  echo.
  echo [error] uvicorn is not installed for: %PY%
  echo         ^(%PYNOTE%^)
  echo.
  echo   Fix:  run setup.bat  ^(creates .venv and installs requirements.txt^)
  echo   Or :  "%PY%" -m pip install -r requirements.txt
  echo.
  pause
  exit /b 1
)

echo.
echo   python       : %PY%
echo   admin server : http://127.0.0.1:8000
echo   admin entry  : run admin_link.bat  ^(or open /admin?token=...^)
echo.
"%PY%" -m uvicorn main:app --host 127.0.0.1 --port 8000
