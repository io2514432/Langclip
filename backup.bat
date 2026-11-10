@echo off
REM Langclip - data/ snapshot backup (zip into backups\)
cd /d "%~dp0"
call _py.bat
"%PY%" backup_data.py %*
echo.
pause
