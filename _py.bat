@echo off
REM Internal helper. Picks the project virtualenv if it exists, else system python.
REM Used by start.bat / public.bat / tunnel.bat so "python" is never ambiguous.
set "PY=python"
set "PYNOTE=system python"
if exist "%~dp0.venv\Scripts\python.exe" (
  set "PY=%~dp0.venv\Scripts\python.exe"
  set "PYNOTE=project venv (.venv)"
)
exit /b 0
