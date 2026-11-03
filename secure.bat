@echo off
REM Langclip - ADMIN server that prints the token link first.
cd /d "%~dp0"
call _py.bat
if not exist data mkdir data
if exist data\admin_token.txt goto have
"%PY%" -c "import secrets,pathlib;pathlib.Path('data/admin_token.txt').write_text(secrets.token_urlsafe(18))"
echo   created data\admin_token.txt
:have
set /p TOK=<data\admin_token.txt
echo.
echo   admin link : http://127.0.0.1:8000/admin?token=%TOK%
echo.
"%PY%" -m uvicorn main:app --host 127.0.0.1 --port 8000
