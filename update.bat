@echo off
title ListeningLearner - update
rem Websites change often; updating the downloader fixes most "download failed" errors.
set "VPY=%LOCALAPPDATA%\ListeningLearner\venv\Scripts\python.exe"
if not exist "%VPY%" (
  echo Run start.bat first.
  pause
  exit /b 1
)
"%VPY%" -m pip install --disable-pip-version-check --upgrade yt-dlp faster-whisper
echo.
echo Done. Start the app again with start.bat.
pause
