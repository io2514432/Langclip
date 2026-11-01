@echo off
REM Langclip - save the current state as a version snapshot.
REM Snapshots go to the "backups" folder. Restore with restore_version.bat
cd /d "%~dp0"
python version.py list
echo.
set /p MEMO=Note for this snapshot (press Enter to skip): 
python version.py save "" "%MEMO%"
echo.
pause
