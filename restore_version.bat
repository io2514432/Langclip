@echo off
REM Langclip - restore an earlier version snapshot.
REM Your learning records are kept unless you pass --data.
cd /d "%~dp0"
python version.py list
echo.
set /p VER=Folder name to restore (for example v4.1): 
if "%VER%"=="" goto :end
python version.py restore %VER%
echo.
echo Restart the server (start.bat / tunnel.bat) after restoring.
pause
:end
