from sqlalchemy import create_engine, inspect, text

from app.db.session import _upgrade_schema


def test_upgrade_schema_adds_email_column_to_legacy_users_table(tmp_path):
    db_path = tmp_path / "legacy.db"
    engine = create_engine(f"sqlite:///{db_path}")
    with engine.begin() as conn:
        conn.execute(
            text(
                "CREATE TABLE users ("
                "id INTEGER PRIMARY KEY, username VARCHAR(64), password_hash VARCHAR(255), "
                "full_name VARCHAR(255), role VARCHAR(32), active BOOLEAN, "
                "force_password_change BOOLEAN, created_at DATETIME)"
            )
        )
        conn.execute(
            text(
                "INSERT INTO users (id, username, password_hash, full_name, role, active, force_password_change) "
                "VALUES (1, 'admin', 'hash', 'مدير النظام', 'admin', 1, 0)"
            )
        )

    inspector = inspect(engine)
    assert "email" not in {col["name"] for col in inspector.get_columns("users")}

    _upgrade_schema(engine)

    inspector = inspect(engine)
    columns = {col["name"] for col in inspector.get_columns("users")}
    assert "email" in columns

    with engine.connect() as conn:
        row = conn.execute(text("SELECT username, email FROM users WHERE id=1")).first()
    assert row.username == "admin"
    assert row.email is None


def test_upgrade_schema_is_idempotent(tmp_path):
    db_path = tmp_path / "fresh.db"
    engine = create_engine(f"sqlite:///{db_path}")
    from app.db.models import Base

    Base.metadata.create_all(engine)
    _upgrade_schema(engine)
    _upgrade_schema(engine)  # يجب ألا يفشل عند التكرار

    inspector = inspect(engine)
    columns = {col["name"] for col in inspector.get_columns("users")}
    assert "email" in columns
