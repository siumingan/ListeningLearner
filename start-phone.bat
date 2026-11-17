@echo off
rem Starts ListeningLearner so your phone can use it too (same Wi-Fi network).
rem The window shows the address to open on the phone. Phones need the access key in that address.
set "LLARGS=--lan"
call "%~dp0start.bat" %*
