@echo off
REM Langclip - one time setup on a NEW computer.
cd /d "%~dp0"
echo [1/4] python
python --version
if errorlevel 1 goto nopy

echo [2/4] virtualenv
if exist ".venv\Scripts\python.exe" goto venvok
python -m venv .venv
if not exist ".venv\Scripts\python.exe" goto novenv
:venvok

echo [3/4] packages, this takes a few minutes
".venv\Scripts\python.exe" -m pip install --upgrade pip
".venv\Scripts\python.exe" -m pip install -r requirements.txt
if errorlevel 1 goto nopip

echo [4/4] verify
".venv\Scripts\python.exe" -c "import uvicorn, fastapi, librosa, soundfile; print('ok')"
if errorlevel 1 goto noimp
echo.
echo Done. Run start.bat for the admin server, or tunnel.bat for the public one.
pause
exit /b 0

:nopy
echo   [error] Python not found. install from python.org and tick "Add to PATH"
pause
exit /b 1

:novenv
echo   [error] could not create .venv
pause
exit /b 1

:nopip
echo   [error] pip install failed. scroll up for the reason.
pause
exit /b 1

:noimp
echo   [error] some packages are missing. run setup.bat again.
pause
exit /b 1
