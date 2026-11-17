@echo off
setlocal EnableExtensions
title ListeningLearner
cd /d "%~dp0"

rem Optional: start.bat 8766   (use a different port)
set "PORT=%~1"
if "%PORT%"=="" set "PORT=8765"

rem Python environment lives outside OneDrive so it is not synced to the cloud
set "LLHOME=%LOCALAPPDATA%\ListeningLearner"
set "VENV=%LLHOME%\venv"
set "VPY=%VENV%\Scripts\python.exe"

if exist "%VPY%" goto checkdeps

rem ---- find Python 3.9+ ----
set "PY="
py -3 -c "import sys; sys.exit(0 if sys.version_info >= (3, 9) else 1)" >nul 2>nul && set "PY=py -3"
if not defined PY (
  python -c "import sys; sys.exit(0 if sys.version_info >= (3, 9) else 1)" >nul 2>nul && set "PY=python"
)
if not defined PY goto nopython

echo.
echo  First start: setting up ListeningLearner. This takes a few minutes...
if not exist "%LLHOME%" mkdir "%LLHOME%"
%PY% -m venv "%VENV%"
if errorlevel 1 goto nopython

:checkdeps
if exist "%VENV%\ll-installed-v3.txt" goto run
echo.
echo  Installing the downloader (yt-dlp) and local AI transcription (faster-whisper)...
"%VPY%" -m pip install --disable-pip-version-check --upgrade pip >nul
"%VPY%" -m pip install --disable-pip-version-check -r requirements.txt
if errorlevel 1 (
  echo.
  echo  Installation failed. Check your internet connection and run start.bat again.
  pause
  exit /b 1
)
echo installed> "%VENV%\ll-installed-v3.txt"

:run
"%VPY%" server.py --port %PORT% %LLARGS%
if errorlevel 1 pause
exit /b

:nopython
echo.
echo  Python 3 was not found, so "Download and transcribe" is turned off.
echo  To turn it on, install Python from https://www.python.org/downloads/
echo  (tick "Add python.exe to PATH"), or run:  winget install Python.Python.3.12
echo  Then run start.bat again.
echo.
echo  Starting in basic mode (video files and YouTube still work)...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0server.ps1" -Port %PORT%
