@echo off
REM Langclip - ADMIN server with an explicit token (add/sync/delete require it).
cd /d "%~dp0"
call _py.bat
if not exist data mkdir data
if not exist data\admin_token.txt (
  "%PY%" -c "import secrets,pathlib;pathlib.Path('data/admin_token.txt').write_text(secrets.token_urlsafe(18))"
  echo [ok] created a new admin token
)
set /p TOK=<data\admin_token.txt
echo.
echo   admin token : %TOK%
echo   admin link  : http://127.0.0.1:8000/admin?token=%TOK%
echo   public      : read-only for everyone else
echo.
"%PY%" -m uvicorn main:app --host 127.0.0.1 --port 8000
