@echo off
REM Langclip - PUBLIC server (read-only content, per-visitor learning records)
REM Port 8001. tunnel.bat starts this file and then opens the tunnel.
cd /d "%~dp0"
call _py.bat
set APP_MODE=public

if not exist ".venv\Scripts\python.exe" (
  echo [warn] .venv not found. Run setup.bat once, or this will use system python.
)

"%PY%" -c "import uvicorn" >nul 2>nul
if errorlevel 1 (
  echo.
  echo [error] uvicorn is not installed for: %PY%
  echo         ^(%PYNOTE%^)
  echo.
  echo   Fix:  run setup.bat
  echo.
  pause
  exit /b 1
)

echo.
echo   python        : %PY%
echo   public server : http://127.0.0.1:8001
echo   friends get their own empty learning record ^(cookie based^)
echo.
"%PY%" -m uvicorn main:app --host 127.0.0.1 --port 8001
