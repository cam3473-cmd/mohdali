"""مسارات ملفات التطبيق (مجلد التشغيل، مجلد النسخ الاحتياطي)."""
from __future__ import annotations

import sys
from pathlib import Path


def app_base_dir() -> Path:
    """مجلد النظام: مجلد الملف التنفيذي عند التغليف بـ PyInstaller، أو مجلد العمل الحالي أثناء التطوير."""
    if getattr(sys, "frozen", False):
        return Path(sys.executable).parent
    return Path.cwd()


def default_backups_dir() -> Path:
    return app_base_dir() / "النسخ-الاحتياطية"


def ensure_default_backups_dir() -> Path:
    d = default_backups_dir()
    d.mkdir(parents=True, exist_ok=True)
    return d
