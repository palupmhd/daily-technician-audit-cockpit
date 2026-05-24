@echo off
cd /d %~dp0dist
python -m http.server 8787
pause
