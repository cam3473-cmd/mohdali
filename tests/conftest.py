import os

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.db.models import Base
from app.db.session import DEFAULT_BYLAW_SETTINGS, _seed_bylaw_settings, _seed_default_admin


@pytest.fixture()
def db_session():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    session = Session(bind=engine)
    _seed_bylaw_settings(session)
    _seed_default_admin(session)
    session.commit()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture()
def admin_user(db_session):
    from app.db.models import User, UserRole

    return db_session.query(User).filter(User.role == UserRole.ADMIN).first()


@pytest.fixture(scope="session")
def qapp():
    from PySide6.QtWidgets import QApplication

    app = QApplication.instance() or QApplication([])
    yield app

