@echo off
REM Internal helper. Sets PY to the project virtualenv python if it exists.
REM No parenthesized blocks on purpose: cmd chokes on ")" inside if-blocks.
set "PY=python"
if not exist "%~dp0.venv\Scripts\python.exe" exit /b 0
set "PY=%~dp0.venv\Scripts\python.exe"
exit /b 0
