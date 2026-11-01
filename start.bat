@echo off
REM Langclip - ADMIN server (you only). Port 8000.
REM Reading data\admin_token.txt happens automatically, so no token needed here.
cd /d "%~dp0"
echo.
echo   admin server : http://127.0.0.1:8000
echo   admin entry  : run show-admin-link.bat  (or open /admin?token=...)
echo.
python -m uvicorn main:app --host 127.0.0.1 --port 8000
