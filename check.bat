@echo off
setlocal
title ListeningLearner - system check
cd /d "%~dp0"
rem Usage: check.bat        quick check
rem        check.bat full   also tests the AI model
set "VPY=%LOCALAPPDATA%\ListeningLearner\venv\Scripts\python.exe"
set "ARG="
if /i "%~1"=="full" set "ARG=--full"

if exist "%VPY%" (
  "%VPY%" check.py %ARG%
  pause
  exit /b
)

echo.
echo  The app's Python environment is not set up yet (start.bat does this on first run).
echo  Checking the Python installed on this computer:
echo.
py -3 --version 2>nul && goto found
python --version 2>nul && goto found
echo  [FAIL] Python not found. Install it from https://www.python.org/downloads/
echo         and tick "Add python.exe to PATH", or run:  winget install Python.Python.3.12
echo.
pause
exit /b 1

:found
echo.
echo  Python is installed. Now run start.bat to finish the setup (3.9 or newer is needed).
echo.
pause
