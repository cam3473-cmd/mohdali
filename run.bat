@echo off
chcp 65001 >nul
cd /d "%~dp0"

if not exist ".venv\Scripts\python.exe" (
    echo إنشاء البيئة الافتراضية لأول مرة، الرجاء الانتظار...
    python -m venv .venv
    .venv\Scripts\python.exe -m pip install --upgrade pip
    .venv\Scripts\python.exe -m pip install -r requirements.txt
)

.venv\Scripts\python.exe -m app.main
if errorlevel 1 (
    echo.
    echo حدث خطأ أثناء تشغيل البرنامج.
    pause
)
