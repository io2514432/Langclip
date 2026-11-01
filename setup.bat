@echo off
REM Langclip - one time setup on a NEW computer.
REM Creates .venv and installs dependencies. Run this once per machine.
cd /d "%~dp0"
echo [1/3] Python check
python --version || (echo Python not found. install from python.org and tick "Add to PATH" & pause & exit /b 1)

echo [2/3] creating virtual environment (.venv)
if not exist ".venv\Scripts\python.exe" python -m venv .venv

echo [3/3] installing dependencies
call ".venv\Scripts\activate.bat"
python -m pip install --upgrade pip >nul
pip install -r requirements.txt
echo.
echo Done. Run start.bat (admin server) or tunnel.bat (public server).
pause
