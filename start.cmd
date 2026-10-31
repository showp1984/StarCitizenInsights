@echo off
rem Starts Star Citizen Insights with a visible console (useful for seeing errors). Close this window to stop it.
cd /d "%~dp0"
node src\server.js --open
