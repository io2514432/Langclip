@echo off
REM Langclip - one time setup on a NEW computer.
REM Creates .venv and installs dependencies, then verifies the install.
cd /d "%~dp0"
echo [1/4] Python check
python --version
if errorlevel 1 (
  echo [error] Python not found. install from python.org and tick "Add to PATH"
  pause
  exit /b 1
)

echo [2/4] creating virtual environment (.venv)
if not exist ".venv\Scripts\python.exe" python -m venv .venv
if not exist ".venv\Scripts\python.exe" (
  echo [error] could not create .venv
  pause
  exit /b 1
)

echo [3/4] installing dependencies (this takes a few minutes)
".venv\Scripts\python.exe" -m pip install --upgrade pip
".venv\Scripts\python.exe" -m pip install -r requirements.txt
if errorlevel 1 (
  echo [error] pip install failed. scroll up for the reason.
  pause
  exit /b 1
)

echo [4/4] verifying
".venv\Scripts\python.exe" -c "import uvicorn, fastapi, librosa, soundfile; print('ok')"
if errorlevel 1 (
  echo [error] some packages are missing. re-run this file.
  pause
  exit /b 1
)
echo.
echo Done. Now run start.bat (admin, port 8000) or tunnel.bat (public + HTTPS).
pause
