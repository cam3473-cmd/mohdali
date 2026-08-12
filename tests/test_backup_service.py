import os
import time

from app.services import backup_service, document_service


def test_create_and_restore_backup_round_trip(tmp_path, monkeypatch):
    monkeypatch.setenv("MOHDALI_DATA_DIR", str(tmp_path / "data"))
    db_path = tmp_path / "data" / "membership.db"
    db_path.parent.mkdir(parents=True, exist_ok=True)
    db_path.write_bytes(b"FAKE-DB-CONTENT")
    monkeypatch.setattr(backup_service, "get_db_path", lambda: db_path)

    docs_dir = document_service.documents_dir()
    (docs_dir / "sample.pdf").write_bytes(b"%PDF-1.4 fake")

    backup_path = tmp_path / "backup.zip"
    backup_service.create_backup(str(backup_path))
    assert backup_path.exists()

    db_path.write_bytes(b"CORRUPTED")
    (docs_dir / "sample.pdf").unlink()

    backup_service.restore_backup(str(backup_path))
    assert db_path.read_bytes() == b"FAKE-DB-CONTENT"
    assert (docs_dir / "sample.pdf").read_bytes() == b"%PDF-1.4 fake"


def test_run_auto_backup_if_due_skips_when_recent_backup_exists(tmp_path, monkeypatch):
    monkeypatch.setenv("MOHDALI_DATA_DIR", str(tmp_path / "data"))
    db_path = tmp_path / "data" / "membership.db"
    db_path.parent.mkdir(parents=True, exist_ok=True)
    db_path.write_bytes(b"DB")
    monkeypatch.setattr(backup_service, "get_db_path", lambda: db_path)

    backups_dir = tmp_path / "backups"
    backups_dir.mkdir()
    monkeypatch.setattr(backup_service, "ensure_default_backups_dir", lambda: backups_dir)

    backup_service.run_auto_backup_if_due()
    first_batch = list(backups_dir.glob(f"{backup_service.AUTO_BACKUP_PREFIX}*.zip"))
    assert len(first_batch) == 1

    backup_service.run_auto_backup_if_due()
    second_batch = list(backups_dir.glob(f"{backup_service.AUTO_BACKUP_PREFIX}*.zip"))
    assert len(second_batch) == 1  # لم يمرّ وقت كافٍ فلا نسخة جديدة


def test_run_auto_backup_if_due_prunes_old_backups(tmp_path, monkeypatch):
    monkeypatch.setenv("MOHDALI_DATA_DIR", str(tmp_path / "data"))
    db_path = tmp_path / "data" / "membership.db"
    db_path.parent.mkdir(parents=True, exist_ok=True)
    db_path.write_bytes(b"DB")
    monkeypatch.setattr(backup_service, "get_db_path", lambda: db_path)

    backups_dir = tmp_path / "backups"
    backups_dir.mkdir()
    monkeypatch.setattr(backup_service, "ensure_default_backups_dir", lambda: backups_dir)

    old_time = time.time() - 1000 * 3600  # قديمة جدًا حتى تتجاوز الحد الأدنى بين نسختين تلقائيتين
    for i in range(backup_service.AUTO_BACKUP_RETENTION + 2):
        fake = backups_dir / f"{backup_service.AUTO_BACKUP_PREFIX}fake-{i}.zip"
        fake.write_bytes(b"old")
        os.utime(fake, (old_time + i, old_time + i))

    backup_service.run_auto_backup_if_due()

    remaining = sorted(backups_dir.glob(f"{backup_service.AUTO_BACKUP_PREFIX}*.zip"))
    assert len(remaining) == backup_service.AUTO_BACKUP_RETENTION
