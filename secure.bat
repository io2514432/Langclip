@echo off
REM Langclip - secure launcher (admin token required for add/sync/delete)
cd /d "%~dp0"
if not exist data mkdir data
if not exist data\admin_token.txt (
  python -c "import secrets,pathlib;pathlib.Path('data/admin_token.txt').write_text(secrets.token_urlsafe(18))"
  echo [ok] created a new admin token
)
set /p TOK=<data\admin_token.txt
echo.
echo   admin token : %TOK%
echo   admin link  : http://127.0.0.1:8000/admin?token=%TOK%
echo   public      : read-only for everyone else
echo.
python -m uvicorn main:app --host 127.0.0.1 --port 8000
