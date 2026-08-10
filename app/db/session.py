"""إدارة الاتصال بقاعدة البيانات المحلية (SQLite) وتهيئتها."""
from __future__ import annotations

import os
import sys
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.db.models import Base, BylawSetting, User, UserRole
from app.auth.security import hash_password

APP_DIR_NAME = "JamiyatAlBirrSulail"
DB_FILE_NAME = "membership.db"

DEFAULT_ADMIN_USERNAME = "admin"
DEFAULT_ADMIN_PASSWORD = "admin123"  # يجب تغييرها فور أول تسجيل دخول (force_password_change)

# قيم افتراضية لإعدادات اللائحة الأساسية — يجب على مجلس إدارة الجمعية مراجعتها
# وتعديلها من شاشة الإعدادات لتطابق اللائحة الأساسية المعتمدة فعليًا للجمعية.
DEFAULT_BYLAW_SETTINGS: dict[str, tuple[str, str]] = {
    "min_membership_days": ("180", "الحد الأدنى لمدة العضوية (بالأيام) لأهلية حضور/التصويت في الجمعية العمومية"),
    "founders_exempt_from_duration": ("true", "استثناء الأعضاء المؤسسين من شرط مدة العضوية"),
    "require_paid_fees": ("true", "اشتراط سداد الاشتراك السنوي لأهلية التصويت"),
    "voting_member_types": ("مؤسس,عامل", "أنواع العضوية التي تملك حق حضور/التصويت في الجمعية العمومية (مفصولة بفاصلة)"),
    "quorum_first_percent": ("50", "نسبة النصاب المطلوبة في الاجتماع الأول (%) — راجعها وفق اللائحة الأساسية"),
    "quorum_second_percent": ("25", "نسبة النصاب المطلوبة في الاجتماع الثاني (%) — راجعها وفق اللائحة الأساسية"),
    "majority_normal_percent": ("50", "نسبة الأغلبية العادية لاعتماد القرار (أكثر من هذه النسبة من الأصوات المصوّتة)"),
    "majority_special_percent": ("66.67", "نسبة الأغلبية الخاصة (كتعديل اللائحة الأساسية أو حل الجمعية)"),
    "max_proxies_per_holder": ("0", "الحد الأقصى لعدد التوكيلات التي يحملها العضو الواحد في الاجتماع (0 = بلا حد)"),
}


def get_data_dir() -> Path:
    """يحدد مجلد بيانات التطبيق المحلي حسب نظام التشغيل."""
    env_override = os.environ.get("MOHDALI_DATA_DIR")
    if env_override:
        base = Path(env_override)
    elif sys.platform == "win32":
        base = Path(os.environ.get("APPDATA", Path.home() / "AppData" / "Roaming")) / APP_DIR_NAME
    elif sys.platform == "darwin":
        base = Path.home() / "Library" / "Application Support" / APP_DIR_NAME
    else:
        base = Path.home() / ".local" / "share" / APP_DIR_NAME
    base.mkdir(parents=True, exist_ok=True)
    return base


def get_db_path() -> Path:
    return get_data_dir() / DB_FILE_NAME


_engine = None
_SessionLocal: sessionmaker | None = None


def get_engine(db_path: Path | None = None):
    global _engine
    if _engine is None:
        path = db_path or get_db_path()
        _engine = create_engine(f"sqlite:///{path}", connect_args={"check_same_thread": False})
    return _engine


def get_session_factory() -> sessionmaker:
    global _SessionLocal
    if _SessionLocal is None:
        _SessionLocal = sessionmaker(bind=get_engine(), expire_on_commit=False)
    return _SessionLocal


def get_session() -> Session:
    return get_session_factory()()


def init_db(db_path: Path | None = None) -> None:
    """ينشئ الجداول (إن لم تكن موجودة) ويبذر الإعدادات الافتراضية ومستخدم المدير الأولي."""
    engine = get_engine(db_path)
    Base.metadata.create_all(engine)

    with get_session_factory()() as session:
        _seed_bylaw_settings(session)
        _seed_default_admin(session)
        session.commit()


def _seed_bylaw_settings(session: Session) -> None:
    existing_keys = {row.key for row in session.query(BylawSetting.key)}
    for key, (value, description) in DEFAULT_BYLAW_SETTINGS.items():
        if key not in existing_keys:
            session.add(BylawSetting(key=key, value=value, description=description))


def _seed_default_admin(session: Session) -> None:
    has_admin = session.query(User).filter(User.role == UserRole.ADMIN).first()
    if has_admin is None:
        session.add(
            User(
                username=DEFAULT_ADMIN_USERNAME,
                password_hash=hash_password(DEFAULT_ADMIN_PASSWORD),
                full_name="مدير النظام",
                role=UserRole.ADMIN,
                active=True,
                force_password_change=True,
            )
        )

