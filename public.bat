@echo off
REM Langclip - PUBLIC server (read-only content, per-visitor learning records)
REM Run this AND secure.bat. Tunnel THIS port (8001) for friends.
cd /d "%~dp0"
set APP_MODE=public
echo.
echo   public server : http://127.0.0.1:8001
echo   friends get their own empty learning record (cookie based)
echo.
python -m uvicorn main:app --host 127.0.0.1 --port 8001
