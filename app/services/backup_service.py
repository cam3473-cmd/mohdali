"""نسخ احتياطي لقاعدة البيانات والمستندات (يدوي وتلقائي دوري)."""
from __future__ import annotations

import shutil
import zipfile
from datetime import datetime
from pathlib import Path

from app.db.session import get_db_path
from app.paths import ensure_default_backups_dir
from app.services import document_service

AUTO_BACKUP_PREFIX = "تلقائي-"
AUTO_BACKUP_RETENTION = 10
AUTO_BACKUP_MIN_INTERVAL_HOURS = 20


def create_backup(output_path: str) -> None:
    with zipfile.ZipFile(output_path, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.write(get_db_path(), arcname="membership.db")
        documents_dir = document_service.documents_dir()
        for file_path in documents_dir.glob("*"):
            if file_path.is_file():
                zf.write(file_path, arcname=f"documents/{file_path.name}")


def restore_backup(source_path: str) -> None:
    if source_path.lower().endswith(".zip"):
        with zipfile.ZipFile(source_path, "r") as zf:
            with zf.open("membership.db") as src, open(get_db_path(), "wb") as dst:
                shutil.copyfileobj(src, dst)
            documents_dir = document_service.documents_dir()
            for name in zf.namelist():
                if name.startswith("documents/") and not name.endswith("/"):
                    target = documents_dir / Path(name).name
                    with zf.open(name) as src, open(target, "wb") as dst:
                        shutil.copyfileobj(src, dst)
    else:
        shutil.copy(source_path, get_db_path())


def run_auto_backup_if_due() -> None:
    """يأخذ نسخة احتياطية تلقائية إن مرّ وقت كافٍ منذ آخر نسخة تلقائية، ويحذف الأقدم متى تجاوز عددها الحد المسموح."""
    backups_dir = ensure_default_backups_dir()
    existing = sorted(backups_dir.glob(f"{AUTO_BACKUP_PREFIX}*.zip"))
    if existing:
        last = existing[-1]
        age_hours = (datetime.now().timestamp() - last.stat().st_mtime) / 3600
        if age_hours < AUTO_BACKUP_MIN_INTERVAL_HOURS:
            return

    name = f"{AUTO_BACKUP_PREFIX}{datetime.now().strftime('%Y-%m-%d_%H%M')}.zip"
    create_backup(str(backups_dir / name))

    existing = sorted(backups_dir.glob(f"{AUTO_BACKUP_PREFIX}*.zip"))
    for old in existing[: max(0, len(existing) - AUTO_BACKUP_RETENTION)]:
        old.unlink()
