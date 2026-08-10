@echo off
cd /d "%~dp0"
call .venv\Scripts\activate.bat
python -m app.main
if errorlevel 1 (
    echo.
    echo حدث خطأ أثناء تشغيل البرنامج.
    pause
)
