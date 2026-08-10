@echo off
chcp 65001 >nul
cd /d "%~dp0"

if exist ".venv\Scripts\python.exe" goto RUN

echo Creating virtual environment for the first time, please wait...
python -m venv .venv
.venv\Scripts\python.exe -m pip install --upgrade pip
.venv\Scripts\python.exe -m pip install -r requirements.txt

:RUN
.venv\Scripts\python.exe -m app.main
if not errorlevel 1 goto END

echo.
echo An error occurred while running the program.
pause

:END
