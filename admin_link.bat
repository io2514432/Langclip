@echo off
REM Langclip - print the admin link (creates the token file on first run).
cd /d "%~dp0"
call _py.bat
if not exist data mkdir data
if not exist data\admin_token.txt (
  "%PY%" -c "import secrets,pathlib;pathlib.Path('data/admin_token.txt').write_text(secrets.token_urlsafe(18))"
  echo [ok] created data\admin_token.txt
)
set /p TOK=<data\admin_token.txt
echo.
echo   admin link : http://127.0.0.1:8000/admin?token=%TOK%
echo   keep data\admin_token.txt secret. it is in .gitignore.
echo.
pause
