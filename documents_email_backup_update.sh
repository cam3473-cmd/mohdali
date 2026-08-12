mkdir -p app app/auth app/db app/services app/ui app/ui/documents app/ui/settings tests

cat > app/auth/service.py << 'MOHDALI_EOF'
"""خدمة المصادقة وإدارة المستخدمين والأدوار."""
from __future__ import annotations

from sqlalchemy.orm import Session

from app.auth.security import hash_password, verify_password
from app.db.models import User, UserRole
from app.services.audit import log_action


class AuthError(Exception):
    pass


class InvalidCredentials(AuthError):
    pass


class AccountInactive(AuthError):
    pass


class AuthService:
    """يدير جلسة تسجيل الدخول الحالية للتطبيق (مستخدم واحد نشط في كل نافذة تطبيق)."""

    def __init__(self, session: Session):
        self.session = session
        self.current_user: User | None = None

    def login(self, username: str, password: str) -> User:
        user = self.session.query(User).filter(User.username == username).first()
        if user is None or not verify_password(password, user.password_hash):
            raise InvalidCredentials("اسم المستخدم أو كلمة المرور غير صحيحة")
        if not user.active:
            raise AccountInactive("هذا الحساب موقوف")
        self.current_user = user
        log_action(self.session, user, "login", "user", user.id)
        self.session.commit()
        return user

    def logout(self) -> None:
        if self.current_user:
            log_action(self.session, self.current_user, "logout", "user", self.current_user.id)
            self.session.commit()
        self.current_user = None

    def change_password(self, user: User, new_password: str) -> None:
        user.password_hash = hash_password(new_password)
        user.force_password_change = False
        log_action(self.session, self.current_user, "change_password", "user", user.id)
        self.session.commit()

    def create_user(
        self, actor: User, username: str, password: str, full_name: str, role: UserRole, email: str | None = None
    ) -> User:
        if self.session.query(User).filter(User.username == username).first():
            raise AuthError("اسم المستخدم مستخدم بالفعل")
        user = User(
            username=username,
            password_hash=hash_password(password),
            full_name=full_name,
            email=email or None,
            role=role,
            active=True,
            force_password_change=True,
        )
        self.session.add(user)
        self.session.flush()
        log_action(self.session, actor, "create_user", "user", user.id, details=f"role={role.value}")
        self.session.commit()
        return user

    def set_active(self, actor: User, user: User, active: bool) -> None:
        user.active = active
        log_action(self.session, actor, "set_user_active", "user", user.id, details=str(active))
        self.session.commit()

    def set_email(self, actor: User, user: User, email: str | None) -> None:
        user.email = email or None
        log_action(self.session, actor, "set_user_email", "user", user.id)
        self.session.commit()

    def list_users(self) -> list[User]:
        return self.session.query(User).order_by(User.username).all()


# صلاحيات كل دور على وحدات النظام
ROLE_PERMISSIONS: dict[UserRole, set[str]] = {
    UserRole.ADMIN: {
        "members.manage",
        "assembly.manage",
        "settings.manage",
        "users.manage",
        "board.manage",
        "documents.manage",
        "view",
    },
    UserRole.MEMBERSHIP_OFFICER: {"members.manage", "board.manage", "view"},
    UserRole.ASSEMBLY_MANAGER: {"assembly.manage", "documents.manage", "view"},
    UserRole.VIEWER: {"view"},
}


def has_permission(user: User, permission: str) -> bool:
    return permission in ROLE_PERMISSIONS.get(user.role, set())

MOHDALI_EOF

cat > app/db/models.py << 'MOHDALI_EOF'
"""نماذج قاعدة البيانات (SQLAlchemy) لنظام عضوية الجمعية العمومية."""
from __future__ import annotations

import enum
from datetime import date, datetime

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    Enum,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


class UserRole(str, enum.Enum):
    ADMIN = "admin"                     # مدير النظام
    MEMBERSHIP_OFFICER = "membership_officer"  # موظف عضوية
    ASSEMBLY_MANAGER = "assembly_manager"      # مسؤول الجمعية العمومية
    VIEWER = "viewer"                   # عرض فقط


class MemberStatus(str, enum.Enum):
    ACTIVE = "active"           # نشط
    SUSPENDED = "suspended"     # موقوف
    WITHDRAWN = "withdrawn"     # منسحب
    REJECTED = "rejected"       # مرفوض
    PENDING = "pending"         # طلب قيد المراجعة


class FeeStatus(str, enum.Enum):
    PAID = "paid"
    UNPAID = "unpaid"
    WAIVED = "waived"           # معفى


class AssemblyType(str, enum.Enum):
    ORDINARY = "ordinary"           # عادية
    EXTRAORDINARY = "extraordinary"  # غير عادية


class AssemblyStatus(str, enum.Enum):
    DRAFT = "draft"
    INVITATIONS_SENT = "invitations_sent"
    IN_PROGRESS = "in_progress"
    CLOSED = "closed"
    CANCELLED = "cancelled"


class AssemblyRound(str, enum.Enum):
    FIRST = "first"
    SECOND = "second"


class AttendanceType(str, enum.Enum):
    IN_PERSON = "in_person"
    PROXY = "proxy"


class DecisionResult(str, enum.Enum):
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    username: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    full_name: Mapped[str] = mapped_column(String(255))
    email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    role: Mapped[UserRole] = mapped_column(Enum(UserRole), default=UserRole.VIEWER)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    force_password_change: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    audit_entries: Mapped[list["AuditLog"]] = relationship(back_populates="user")


class Member(Base):
    __tablename__ = "members"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    membership_number: Mapped[str | None] = mapped_column(String(32), unique=True, nullable=True)  # رقم العضوية
    member_type: Mapped[str] = mapped_column(String(64))  # قيمة قابلة للتهيئة من bylaw_settings
    full_name: Mapped[str] = mapped_column(String(255))
    national_id_or_cr: Mapped[str | None] = mapped_column(String(64), unique=True, nullable=True)
    gender: Mapped[str | None] = mapped_column(String(16), nullable=True)
    birth_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    phone: Mapped[str | None] = mapped_column(String(32), nullable=True)
    email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    address: Mapped[str | None] = mapped_column(Text, nullable=True)
    qualification: Mapped[str | None] = mapped_column(String(128), nullable=True)  # المؤهل العلمي
    city: Mapped[str | None] = mapped_column(String(128), nullable=True)
    occupation: Mapped[str | None] = mapped_column(String(128), nullable=True)  # العمل/المهنة
    join_date: Mapped[date] = mapped_column(Date)
    status: Mapped[MemberStatus] = mapped_column(Enum(MemberStatus), default=MemberStatus.PENDING)
    is_founder: Mapped[bool] = mapped_column(Boolean, default=False)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    fees: Mapped[list["MembershipFee"]] = relationship(back_populates="member", cascade="all, delete-orphan")
    attendances: Mapped[list["AssemblyAttendance"]] = relationship(
        foreign_keys="AssemblyAttendance.member_id", back_populates="member"
    )
    board_positions: Mapped[list["BoardPosition"]] = relationship(
        back_populates="member", cascade="all, delete-orphan"
    )


class MembershipFee(Base):
    __tablename__ = "membership_fees"
    __table_args__ = (UniqueConstraint("member_id", "fee_year", name="uq_member_fee_year"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    member_id: Mapped[int] = mapped_column(ForeignKey("members.id"))
    fee_year: Mapped[int] = mapped_column(Integer)
    amount: Mapped[float] = mapped_column(Numeric(10, 2), default=0)
    paid_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    payment_method: Mapped[str | None] = mapped_column(String(64), nullable=True)
    receipt_number: Mapped[str | None] = mapped_column(String(32), nullable=True)  # رقم السند
    status: Mapped[FeeStatus] = mapped_column(Enum(FeeStatus), default=FeeStatus.UNPAID)

    member: Mapped["Member"] = relationship(back_populates="fees")


class BoardPosition(Base):
    """سجل مناصب مجلس الإدارة (تاريخي): من شغل أي منصب ومتى."""

    __tablename__ = "board_positions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    member_id: Mapped[int] = mapped_column(ForeignKey("members.id"))
    title: Mapped[str] = mapped_column(String(128))  # رئيس مجلس الإدارة، نائب الرئيس، أمين الصندوق...
    start_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    end_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    member: Mapped["Member"] = relationship(back_populates="board_positions")

    @property
    def is_current(self) -> bool:
        return self.end_date is None


class BylawSetting(Base):
    """إعدادات اللائحة الأساسية القابلة للتهيئة (نصاب، أغلبية، مدة العضوية...)."""

    __tablename__ = "bylaw_settings"

    key: Mapped[str] = mapped_column(String(128), primary_key=True)
    value: Mapped[str] = mapped_column(Text)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)


class Assembly(Base):
    __tablename__ = "assemblies"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    title: Mapped[str] = mapped_column(String(255))
    type: Mapped[AssemblyType] = mapped_column(Enum(AssemblyType), default=AssemblyType.ORDINARY)
    meeting_date: Mapped[date] = mapped_column(Date)
    location: Mapped[str | None] = mapped_column(String(255), nullable=True)
    status: Mapped[AssemblyStatus] = mapped_column(Enum(AssemblyStatus), default=AssemblyStatus.DRAFT)
    round: Mapped[AssemblyRound] = mapped_column(Enum(AssemblyRound), default=AssemblyRound.FIRST)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    agenda_items: Mapped[list["AssemblyAgendaItem"]] = relationship(
        back_populates="assembly", cascade="all, delete-orphan", order_by="AssemblyAgendaItem.order"
    )
    attendances: Mapped[list["AssemblyAttendance"]] = relationship(
        foreign_keys="AssemblyAttendance.assembly_id", back_populates="assembly", cascade="all, delete-orphan"
    )
    decisions: Mapped[list["AssemblyDecision"]] = relationship(
        back_populates="assembly", cascade="all, delete-orphan"
    )


class AssemblyAgendaItem(Base):
    __tablename__ = "assembly_agenda_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    assembly_id: Mapped[int] = mapped_column(ForeignKey("assemblies.id"))
    order: Mapped[int] = mapped_column(Integer, default=0)
    title: Mapped[str] = mapped_column(String(255))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    assembly: Mapped["Assembly"] = relationship(back_populates="agenda_items")
    decisions: Mapped[list["AssemblyDecision"]] = relationship(back_populates="agenda_item")


class AssemblyAttendance(Base):
    __tablename__ = "assembly_attendance"
    __table_args__ = (UniqueConstraint("assembly_id", "member_id", name="uq_assembly_member_attendance"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    assembly_id: Mapped[int] = mapped_column(ForeignKey("assemblies.id"))
    member_id: Mapped[int] = mapped_column(ForeignKey("members.id"))
    attendance_type: Mapped[AttendanceType] = mapped_column(Enum(AttendanceType), default=AttendanceType.IN_PERSON)
    proxy_holder_member_id: Mapped[int | None] = mapped_column(ForeignKey("members.id"), nullable=True)
    checked_in_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    assembly: Mapped["Assembly"] = relationship(foreign_keys=[assembly_id], back_populates="attendances")
    member: Mapped["Member"] = relationship(foreign_keys=[member_id], back_populates="attendances")
    proxy_holder: Mapped["Member | None"] = relationship(foreign_keys=[proxy_holder_member_id])


class AssemblyDecision(Base):
    __tablename__ = "assembly_decisions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    assembly_id: Mapped[int] = mapped_column(ForeignKey("assemblies.id"))
    agenda_item_id: Mapped[int | None] = mapped_column(ForeignKey("assembly_agenda_items.id"), nullable=True)
    decision_text: Mapped[str] = mapped_column(Text)
    votes_for: Mapped[int] = mapped_column(Integer, default=0)
    votes_against: Mapped[int] = mapped_column(Integer, default=0)
    votes_abstain: Mapped[int] = mapped_column(Integer, default=0)
    requires_special_majority: Mapped[bool] = mapped_column(Boolean, default=False)
    result: Mapped[DecisionResult] = mapped_column(Enum(DecisionResult), default=DecisionResult.PENDING)

    assembly: Mapped["Assembly"] = relationship(back_populates="decisions")
    agenda_item: Mapped["AssemblyAgendaItem | None"] = relationship(back_populates="decisions")


class PasswordResetCode(Base):
    """رمز تحقق مؤقت لاستعادة كلمة المرور عبر البريد الإلكتروني."""

    __tablename__ = "password_reset_codes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    code: Mapped[str] = mapped_column(String(8))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    expires_at: Mapped[datetime] = mapped_column(DateTime)
    used: Mapped[bool] = mapped_column(Boolean, default=False)

    user: Mapped["User"] = relationship()


class SmtpSettings(Base):
    """إعدادات خادم البريد الصادر (SMTP) لإرسال رموز استعادة كلمة المرور. صف واحد فقط (id=1)."""

    __tablename__ = "smtp_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    host: Mapped[str | None] = mapped_column(String(255), nullable=True)
    port: Mapped[int] = mapped_column(Integer, default=587)
    username: Mapped[str | None] = mapped_column(String(255), nullable=True)
    password: Mapped[str | None] = mapped_column(String(255), nullable=True)
    use_tls: Mapped[bool] = mapped_column(Boolean, default=True)
    from_address: Mapped[str | None] = mapped_column(String(255), nullable=True)


class Document(Base):
    """مستندات رسمية محفوظة في النظام (خطاب تشكيل المجلس، شهادة الجمعية، خطابات اعتماد البرامج...)."""

    __tablename__ = "documents"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    category: Mapped[str] = mapped_column(String(64))
    title: Mapped[str] = mapped_column(String(255))
    file_name: Mapped[str] = mapped_column(String(255))  # اسم الملف الفعلي داخل مجلد المستندات
    uploaded_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    uploaded_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    uploaded_by: Mapped["User | None"] = relationship()


class AuditLog(Base):
    __tablename__ = "audit_log"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    action: Mapped[str] = mapped_column(String(128))
    entity: Mapped[str] = mapped_column(String(64))
    entity_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    timestamp: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    details: Mapped[str | None] = mapped_column(Text, nullable=True)

    user: Mapped["User | None"] = relationship(back_populates="audit_entries")

MOHDALI_EOF

cat > app/db/session.py << 'MOHDALI_EOF'
"""إدارة الاتصال بقاعدة البيانات المحلية (SQLite) وتهيئتها."""
from __future__ import annotations

import os
import sys
from pathlib import Path

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import Session, sessionmaker

from app.db.models import Base, BylawSetting, SmtpSettings, User, UserRole
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
    "board_term_end_date": (
        "",
        "تاريخ نهاية الدورة الحالية لمجلس الإدارة (وفق خطاب اعتماد المركز الوطني لتنمية القطاع غير الربحي)، بصيغة YYYY-MM-DD",
    ),
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
    _upgrade_schema(engine)

    with get_session_factory()() as session:
        _seed_bylaw_settings(session)
        _seed_default_admin(session)
        _seed_smtp_settings(session)
        session.commit()


def _upgrade_schema(engine) -> None:
    """يضيف أعمدة جديدة لجداول قديمة موجودة مسبقًا (create_all لا يعدّل جداول موجودة)."""
    inspector = inspect(engine)
    if "users" in inspector.get_table_names():
        existing_columns = {col["name"] for col in inspector.get_columns("users")}
        if "email" not in existing_columns:
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE users ADD COLUMN email VARCHAR(255)"))


def _seed_bylaw_settings(session: Session) -> None:
    existing_keys = {row.key for row in session.query(BylawSetting.key)}
    for key, (value, description) in DEFAULT_BYLAW_SETTINGS.items():
        if key not in existing_keys:
            session.add(BylawSetting(key=key, value=value, description=description))


def _seed_smtp_settings(session: Session) -> None:
    if session.get(SmtpSettings, 1) is None:
        session.add(SmtpSettings(id=1, port=587, use_tls=True))


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

MOHDALI_EOF

cat > app/paths.py << 'MOHDALI_EOF'
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
MOHDALI_EOF

cat > app/services/document_service.py << 'MOHDALI_EOF'
"""حفظ المستندات الرسمية للجمعية (خطاب تشكيل المجلس، شهادة الجمعية، خطابات اعتماد البرامج) بصيغة PDF."""
from __future__ import annotations

import shutil
import uuid
from pathlib import Path

from sqlalchemy.orm import Session

from app.db.models import Document, User
from app.db.session import get_data_dir
from app.services.audit import log_action

DOCUMENT_CATEGORIES = [
    "خطاب تشكيل مجلس الإدارة",
    "شهادة الجمعية",
    "خطاب اعتماد برنامج",
    "أخرى",
]


def documents_dir() -> Path:
    d = get_data_dir() / "documents"
    d.mkdir(parents=True, exist_ok=True)
    return d


def document_path(document: Document) -> Path:
    return documents_dir() / document.file_name


def add_document(
    session: Session, actor: User, category: str, title: str, source_file_path: str, notes: str | None = None
) -> Document:
    source = Path(source_file_path)
    if not source.exists():
        raise FileNotFoundError(f"الملف غير موجود: {source_file_path}")

    stored_name = f"{uuid.uuid4().hex}_{source.name}"
    shutil.copy(source, documents_dir() / stored_name)

    document = Document(
        category=category, title=title, file_name=stored_name, uploaded_by_id=actor.id if actor else None, notes=notes
    )
    session.add(document)
    session.flush()
    log_action(session, actor, "add_document", "document", document.id, details=f"{category}: {title}")
    session.commit()
    return document


def list_documents(session: Session, category: str | None = None) -> list[Document]:
    query = session.query(Document)
    if category:
        query = query.filter(Document.category == category)
    return query.order_by(Document.uploaded_at.desc()).all()


def delete_document(session: Session, actor: User, document: Document) -> None:
    document_id = document.id
    details = f"{document.category}: {document.title}"
    path = document_path(document)
    session.delete(document)
    log_action(session, actor, "delete_document", "document", document_id, details=details)
    session.commit()
    if path.exists():
        path.unlink()
MOHDALI_EOF

cat > app/services/password_reset_service.py << 'MOHDALI_EOF'
"""استعادة كلمة المرور عبر إرسال رمز تحقق مؤقت إلى البريد الإلكتروني المسجَّل للمستخدم."""
from __future__ import annotations

import random
import smtplib
from datetime import datetime, timedelta
from email.mime.text import MIMEText

from sqlalchemy.orm import Session

from app.auth.security import hash_password
from app.db.models import PasswordResetCode, User
from app.services import smtp_settings_service
from app.services.audit import log_action

CODE_LENGTH = 6
CODE_VALIDITY_MINUTES = 15


class PasswordResetError(Exception):
    pass


def _generate_code() -> str:
    return "".join(str(random.randint(0, 9)) for _ in range(CODE_LENGTH))


def _send_email(smtp_settings, to_address: str, subject: str, body: str) -> None:
    message = MIMEText(body, "plain", "utf-8")
    message["Subject"] = subject
    message["From"] = smtp_settings.from_address
    message["To"] = to_address

    with smtplib.SMTP(smtp_settings.host, smtp_settings.port, timeout=20) as smtp:
        if smtp_settings.use_tls:
            smtp.starttls()
        smtp.login(smtp_settings.username, smtp_settings.password)
        smtp.sendmail(smtp_settings.from_address, [to_address], message.as_string())


def request_reset(session: Session, username: str) -> None:
    """يولّد رمز تحقق ويرسله إلى بريد المستخدم المسجَّل. يرفع PasswordResetError برسالة واضحة عند أي عائق."""
    user = session.query(User).filter(User.username == username.strip()).first()
    if user is None:
        raise PasswordResetError("لا يوجد مستخدم بهذا الاسم")
    if not user.email:
        raise PasswordResetError("لا يوجد بريد إلكتروني مسجَّل لهذا المستخدم. يرجى مراجعة مدير النظام لإضافته.")

    smtp_settings = smtp_settings_service.get_settings(session)
    if not smtp_settings_service.is_configured(smtp_settings):
        raise PasswordResetError("إعدادات البريد الإلكتروني (SMTP) غير مكتملة. راجع الإعدادات ← البريد الإلكتروني.")

    code = _generate_code()
    now = datetime.utcnow()
    session.add(
        PasswordResetCode(user_id=user.id, code=code, created_at=now, expires_at=now + timedelta(minutes=CODE_VALIDITY_MINUTES))
    )
    session.commit()

    body = (
        f"رمز التحقق لاستعادة كلمة المرور في نظام عضوية الجمعية العمومية: {code}\n"
        f"صالح لمدة {CODE_VALIDITY_MINUTES} دقيقة فقط."
    )
    try:
        _send_email(smtp_settings, user.email, "رمز استعادة كلمة المرور", body)
    except Exception as exc:  # noqa: BLE001
        raise PasswordResetError(f"تعذر إرسال البريد الإلكتروني: {exc}") from exc


def confirm_reset(session: Session, username: str, code: str, new_password: str) -> None:
    user = session.query(User).filter(User.username == username.strip()).first()
    if user is None:
        raise PasswordResetError("لا يوجد مستخدم بهذا الاسم")

    reset_code = (
        session.query(PasswordResetCode)
        .filter(PasswordResetCode.user_id == user.id, PasswordResetCode.code == code.strip(), PasswordResetCode.used.is_(False))
        .order_by(PasswordResetCode.created_at.desc())
        .first()
    )
    if reset_code is None:
        raise PasswordResetError("رمز التحقق غير صحيح")
    if reset_code.expires_at < datetime.utcnow():
        raise PasswordResetError("انتهت صلاحية رمز التحقق. اطلب رمزًا جديدًا")

    user.password_hash = hash_password(new_password)
    user.force_password_change = False
    reset_code.used = True
    log_action(session, user, "reset_password_via_email", "user", user.id)
    session.commit()
MOHDALI_EOF

cat > app/services/smtp_settings_service.py << 'MOHDALI_EOF'
"""إعدادات خادم البريد الصادر (SMTP) المستخدم لإرسال رموز استعادة كلمة المرور."""
from __future__ import annotations

from sqlalchemy.orm import Session

from app.db.models import SmtpSettings


def get_settings(session: Session) -> SmtpSettings:
    settings = session.get(SmtpSettings, 1)
    if settings is None:
        settings = SmtpSettings(id=1, port=587, use_tls=True)
        session.add(settings)
        session.commit()
    return settings


def update_settings(
    session: Session,
    host: str | None,
    port: int,
    username: str | None,
    password: str | None,
    use_tls: bool,
    from_address: str | None,
) -> None:
    settings = get_settings(session)
    settings.host = host or None
    settings.port = port
    settings.username = username or None
    if password:  # لا نمسح كلمة المرور المحفوظة إن تُرك الحقل فارغًا عند التعديل
        settings.password = password
    settings.use_tls = use_tls
    settings.from_address = from_address or None
    session.commit()


def is_configured(settings: SmtpSettings) -> bool:
    return bool(settings.host and settings.username and settings.password and settings.from_address)
MOHDALI_EOF

cat > app/ui/documents/__init__.py << 'MOHDALI_EOF'

MOHDALI_EOF

cat > app/ui/documents/add_document_dialog.py << 'MOHDALI_EOF'
"""نموذج إضافة مستند PDF جديد."""
from __future__ import annotations

from PySide6.QtCore import Qt
from PySide6.QtWidgets import (
    QComboBox,
    QDialog,
    QDialogButtonBox,
    QFileDialog,
    QFormLayout,
    QHBoxLayout,
    QLineEdit,
    QPushButton,
    QVBoxLayout,
)

from app.services.document_service import DOCUMENT_CATEGORIES


class AddDocumentDialog(QDialog):
    def __init__(self, parent=None):
        super().__init__(parent)
        self.setWindowTitle("إضافة مستند")
        self.setLayoutDirection(Qt.LayoutDirection.RightToLeft)
        self.setMinimumWidth(420)

        layout = QVBoxLayout(self)
        form = QFormLayout()

        self.category = QComboBox()
        self.category.addItems(DOCUMENT_CATEGORIES)

        self.title = QLineEdit()

        file_row = QHBoxLayout()
        self.file_path = QLineEdit()
        self.file_path.setReadOnly(True)
        browse_btn = QPushButton("استعراض...")
        browse_btn.clicked.connect(self._on_browse)
        file_row.addWidget(self.file_path)
        file_row.addWidget(browse_btn)

        self.notes = QLineEdit()

        form.addRow("التصنيف:*", self.category)
        form.addRow("عنوان المستند:*", self.title)
        form.addRow("الملف (PDF):*", file_row)
        form.addRow("ملاحظات:", self.notes)
        layout.addLayout(form)

        buttons = QDialogButtonBox(QDialogButtonBox.StandardButton.Ok | QDialogButtonBox.StandardButton.Cancel)
        buttons.button(QDialogButtonBox.StandardButton.Ok).setText("إضافة")
        buttons.button(QDialogButtonBox.StandardButton.Cancel).setText("إلغاء")
        buttons.accepted.connect(self._on_accept)
        buttons.rejected.connect(self.reject)
        layout.addWidget(buttons)

        self.values: dict | None = None

    def _on_browse(self) -> None:
        path, _ = QFileDialog.getOpenFileName(self, "اختيار ملف PDF", "", "PDF (*.pdf)")
        if path:
            self.file_path.setText(path)
            if not self.title.text().strip():
                from pathlib import Path

                self.title.setText(Path(path).stem)

    def _on_accept(self) -> None:
        if not self.title.text().strip() or not self.file_path.text().strip():
            return
        self.values = {
            "category": self.category.currentText(),
            "title": self.title.text().strip(),
            "source_file_path": self.file_path.text().strip(),
            "notes": self.notes.text().strip() or None,
        }
        self.accept()
MOHDALI_EOF

cat > app/ui/documents/documents_view.py << 'MOHDALI_EOF'
"""شاشة حفظ المستندات الرسمية (خطاب تشكيل المجلس، شهادة الجمعية، خطابات اعتماد البرامج)."""
from __future__ import annotations

from PySide6.QtCore import QUrl, Qt
from PySide6.QtGui import QDesktopServices
from PySide6.QtWidgets import (
    QComboBox,
    QDialog,
    QHBoxLayout,
    QHeaderView,
    QPushButton,
    QTableWidget,
    QTableWidgetItem,
    QVBoxLayout,
    QWidget,
)

from app.auth.service import has_permission
from app.db.models import Document
from app.services import document_service
from app.ui.app_context import AppContext
from app.ui.common import confirm, show_error, show_info
from app.ui.documents.add_document_dialog import AddDocumentDialog

CATEGORY_FILTERS = ["الكل"] + document_service.DOCUMENT_CATEGORIES


class DocumentsView(QWidget):
    def __init__(self, ctx: AppContext, parent=None):
        super().__init__(parent)
        self.ctx = ctx
        self.setLayoutDirection(Qt.LayoutDirection.RightToLeft)
        self._can_manage = has_permission(ctx.current_user, "documents.manage")

        layout = QVBoxLayout(self)

        toolbar = QHBoxLayout()
        self.category_filter = QComboBox()
        self.category_filter.addItems(CATEGORY_FILTERS)
        self.category_filter.currentIndexChanged.connect(self.refresh)
        toolbar.addWidget(self.category_filter)
        toolbar.addStretch()
        add_btn = QPushButton("إضافة مستند")
        add_btn.setEnabled(self._can_manage)
        add_btn.clicked.connect(self._on_add)
        toolbar.addWidget(add_btn)
        layout.addLayout(toolbar)

        self.table = QTableWidget(0, 3)
        self.table.setHorizontalHeaderLabels(["العنوان", "التصنيف", "تاريخ الرفع"])
        self.table.horizontalHeader().setSectionResizeMode(0, QHeaderView.ResizeMode.Stretch)
        self.table.setSelectionBehavior(QTableWidget.SelectionBehavior.SelectRows)
        self.table.setEditTriggers(QTableWidget.EditTrigger.NoEditTriggers)
        layout.addWidget(self.table)

        actions = QHBoxLayout()
        open_btn = QPushButton("فتح")
        open_btn.clicked.connect(self._on_open)
        actions.addWidget(open_btn)
        delete_btn = QPushButton("حذف")
        delete_btn.setEnabled(self._can_manage)
        delete_btn.clicked.connect(self._on_delete)
        actions.addWidget(delete_btn)
        layout.addLayout(actions)

        self.refresh()

    def _selected_document(self) -> Document | None:
        row = self.table.currentRow()
        if row < 0:
            return None
        document_id = self.table.item(row, 0).data(Qt.ItemDataRole.UserRole)
        return self.ctx.session.get(Document, document_id)

    def refresh(self) -> None:
        category = self.category_filter.currentText()
        category = None if category == "الكل" else category
        documents = document_service.list_documents(self.ctx.session, category=category)
        self.table.setRowCount(0)
        for doc in documents:
            row = self.table.rowCount()
            self.table.insertRow(row)
            title_item = QTableWidgetItem(doc.title)
            title_item.setData(Qt.ItemDataRole.UserRole, doc.id)
            self.table.setItem(row, 0, title_item)
            self.table.setItem(row, 1, QTableWidgetItem(doc.category))
            self.table.setItem(row, 2, QTableWidgetItem(doc.uploaded_at.strftime("%Y-%m-%d %H:%M")))

    def _on_add(self) -> None:
        dialog = AddDocumentDialog(self)
        if dialog.exec() == QDialog.DialogCode.Accepted and dialog.values:
            try:
                document_service.add_document(self.ctx.session, self.ctx.current_user, **dialog.values)
                self.refresh()
            except Exception as exc:  # noqa: BLE001
                show_error(self, f"تعذرت إضافة المستند: {exc}")

    def _on_open(self) -> None:
        document = self._selected_document()
        if document is None:
            return
        path = document_service.document_path(document)
        if not path.exists():
            show_error(self, "ملف المستند غير موجود على القرص")
            return
        QDesktopServices.openUrl(QUrl.fromLocalFile(str(path)))

    def _on_delete(self) -> None:
        document = self._selected_document()
        if document is None:
            return
        if not confirm(self, f"هل تريد حذف المستند \"{document.title}\" نهائيًا؟"):
            return
        document_service.delete_document(self.ctx.session, self.ctx.current_user, document)
        self.refresh()
        show_info(self, "تم حذف المستند")
MOHDALI_EOF

cat > app/ui/forgot_password_dialog.py << 'MOHDALI_EOF'
"""نافذة استعادة كلمة المرور عبر رمز تحقق يُرسل بالبريد الإلكتروني."""
from __future__ import annotations

from PySide6.QtCore import Qt
from PySide6.QtWidgets import QDialog, QFormLayout, QLabel, QLineEdit, QPushButton, QVBoxLayout

from app.services import password_reset_service
from app.ui.common import show_error, show_info


class ForgotPasswordDialog(QDialog):
    def __init__(self, session, parent=None):
        super().__init__(parent)
        self.session = session
        self.setWindowTitle("استعادة كلمة المرور")
        self.setLayoutDirection(Qt.LayoutDirection.RightToLeft)
        self.setMinimumWidth(380)

        layout = QVBoxLayout(self)
        layout.addWidget(QLabel("أدخل اسم المستخدم لإرسال رمز تحقق إلى بريده الإلكتروني المسجَّل."))

        form = QFormLayout()
        self.username_input = QLineEdit()
        form.addRow("اسم المستخدم:", self.username_input)
        layout.addLayout(form)

        self.send_code_btn = QPushButton("إرسال رمز التحقق")
        self.send_code_btn.clicked.connect(self._on_send_code)
        layout.addWidget(self.send_code_btn)

        self.step2_label = QLabel("أدخل رمز التحقق الذي وصلك بالبريد وكلمة المرور الجديدة.")
        self.step2_label.setVisible(False)
        layout.addWidget(self.step2_label)

        self.step2_form = QFormLayout()
        self.code_input = QLineEdit()
        self.new_password_input = QLineEdit()
        self.new_password_input.setEchoMode(QLineEdit.EchoMode.Password)
        self.confirm_password_input = QLineEdit()
        self.confirm_password_input.setEchoMode(QLineEdit.EchoMode.Password)
        self.step2_form.addRow("رمز التحقق:", self.code_input)
        self.step2_form.addRow("كلمة المرور الجديدة:", self.new_password_input)
        self.step2_form.addRow("تأكيد كلمة المرور:", self.confirm_password_input)
        layout.addLayout(self.step2_form)
        self._set_step2_visible(False)

        self.confirm_btn = QPushButton("تعيين كلمة المرور")
        self.confirm_btn.setVisible(False)
        self.confirm_btn.clicked.connect(self._on_confirm)
        layout.addWidget(self.confirm_btn)

    def _set_step2_visible(self, visible: bool) -> None:
        self.step2_label.setVisible(visible)
        for i in range(self.step2_form.rowCount()):
            self.step2_form.itemAt(i, QFormLayout.ItemRole.LabelRole).widget().setVisible(visible)
            self.step2_form.itemAt(i, QFormLayout.ItemRole.FieldRole).widget().setVisible(visible)

    def _on_send_code(self) -> None:
        username = self.username_input.text().strip()
        if not username:
            show_error(self, "الرجاء إدخال اسم المستخدم")
            return
        try:
            password_reset_service.request_reset(self.session, username)
        except password_reset_service.PasswordResetError as exc:
            show_error(self, str(exc))
            return
        show_info(self, "تم إرسال رمز التحقق إلى البريد الإلكتروني المسجَّل. صالح لمدة 15 دقيقة.")
        self.username_input.setEnabled(False)
        self.send_code_btn.setEnabled(False)
        self._set_step2_visible(True)
        self.confirm_btn.setVisible(True)

    def _on_confirm(self) -> None:
        code = self.code_input.text().strip()
        new_password = self.new_password_input.text()
        confirm_password = self.confirm_password_input.text()
        if len(new_password) < 6:
            show_error(self, "يجب ألا تقل كلمة المرور عن 6 أحرف")
            return
        if new_password != confirm_password:
            show_error(self, "كلمتا المرور غير متطابقتين")
            return
        try:
            password_reset_service.confirm_reset(self.session, self.username_input.text().strip(), code, new_password)
        except password_reset_service.PasswordResetError as exc:
            show_error(self, str(exc))
            return
        show_info(self, "تم تعيين كلمة المرور الجديدة بنجاح. يمكنك الآن تسجيل الدخول بها.")
        self.accept()
MOHDALI_EOF

cat > app/ui/login_view.py << 'MOHDALI_EOF'
"""شاشة تسجيل الدخول."""
from __future__ import annotations

from PySide6.QtCore import Qt
from PySide6.QtWidgets import QDialog, QFormLayout, QLabel, QLineEdit, QPushButton, QVBoxLayout

from app.auth.service import AccountInactive, AuthService, InvalidCredentials
from app.db.models import User
from app.ui.common import ChangePasswordDialog, load_logo_pixmap, show_error
from app.ui.forgot_password_dialog import ForgotPasswordDialog


class LoginDialog(QDialog):
    def __init__(self, auth: AuthService, parent=None):
        super().__init__(parent)
        self.auth = auth
        self.setWindowTitle("تسجيل الدخول — نظام عضوية الجمعية العمومية")
        self.setLayoutDirection(Qt.LayoutDirection.RightToLeft)
        self.setModal(True)
        self.setMinimumWidth(360)

        layout = QVBoxLayout(self)

        logo_pixmap = load_logo_pixmap(max_height=90)
        if logo_pixmap is not None:
            logo_label = QLabel()
            logo_label.setPixmap(logo_pixmap)
            logo_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
            layout.addWidget(logo_label)

        title_label = QLabel("<h2>جمعية البر الخيرية بمحافظة السليل</h2>")
        title_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        layout.addWidget(title_label)

        form = QFormLayout()
        self.username_input = QLineEdit()
        self.password_input = QLineEdit()
        self.password_input.setEchoMode(QLineEdit.EchoMode.Password)
        form.addRow("اسم المستخدم:", self.username_input)
        form.addRow("كلمة المرور:", self.password_input)
        layout.addLayout(form)

        login_btn = QPushButton("دخول")
        login_btn.setDefault(True)
        login_btn.clicked.connect(self._on_login)
        layout.addWidget(login_btn)
        self.password_input.returnPressed.connect(self._on_login)

        forgot_btn = QPushButton("نسيت كلمة المرور؟")
        forgot_btn.setFlat(True)
        forgot_btn.clicked.connect(self._on_forgot_password)
        layout.addWidget(forgot_btn)

        self.authenticated_user: User | None = None

    def _on_forgot_password(self) -> None:
        dialog = ForgotPasswordDialog(self.auth.session, self)
        dialog.exec()

    def _on_login(self) -> None:
        username = self.username_input.text().strip()
        password = self.password_input.text()
        if not username or not password:
            show_error(self, "الرجاء إدخال اسم المستخدم وكلمة المرور")
            return
        try:
            user = self.auth.login(username, password)
        except InvalidCredentials as exc:
            show_error(self, str(exc))
            return
        except AccountInactive as exc:
            show_error(self, str(exc))
            return

        if user.force_password_change:
            dialog = ChangePasswordDialog(self, mandatory=True)
            if dialog.exec() == QDialog.DialogCode.Accepted and dialog.result_password:
                self.auth.change_password(user, dialog.result_password)
            else:
                show_error(self, "يجب تغيير كلمة المرور للمتابعة")
                return

        self.authenticated_user = user
        self.accept()

MOHDALI_EOF

cat > app/ui/main_window.py << 'MOHDALI_EOF'
"""النافذة الرئيسية للتطبيق."""
from __future__ import annotations

from PySide6.QtCore import Qt
from PySide6.QtGui import QGuiApplication, QIcon
from PySide6.QtWidgets import QHBoxLayout, QLabel, QMainWindow, QMessageBox, QTabWidget, QVBoxLayout, QWidget

from app.auth.service import has_permission
from app.ui.app_context import AppContext
from app.ui.assembly.assembly_list_view import AssemblyListView
from app.ui.board.board_view import BoardView
from app.ui.common import load_logo_pixmap
from app.ui.dashboard_view import DashboardView
from app.ui.documents.documents_view import DocumentsView
from app.ui.members.members_view import MembersView
from app.ui.settings.settings_view import SettingsView


class MainWindow(QMainWindow):
    def __init__(self, ctx: AppContext):
        super().__init__()
        self.ctx = ctx
        self.setLayoutDirection(Qt.LayoutDirection.RightToLeft)
        self.setWindowTitle("نظام عضوية الجمعية العمومية — جمعية البر الخيرية بمحافظة السليل")
        self._size_to_screen()

        logo_pixmap = load_logo_pixmap(max_height=40)
        if logo_pixmap is not None:
            self.setWindowIcon(QIcon(logo_pixmap))

        central = QWidget()
        central_layout = QVBoxLayout(central)
        central_layout.setContentsMargins(0, 0, 0, 0)

        if logo_pixmap is not None:
            header = QWidget()
            header_layout = QHBoxLayout(header)
            logo_label = QLabel()
            logo_label.setPixmap(logo_pixmap)
            title_label = QLabel("<h3>جمعية البر الخيرية بمحافظة السليل</h3>")
            header_layout.addWidget(logo_label)
            header_layout.addWidget(title_label)
            header_layout.addStretch()
            central_layout.addWidget(header)

        tabs = QTabWidget()
        tabs.addTab(DashboardView(ctx), "الرئيسية")
        tabs.addTab(MembersView(ctx), "الأعضاء")
        tabs.addTab(AssemblyListView(ctx), "الجمعية العمومية")
        tabs.addTab(BoardView(ctx), "مجلس الإدارة")
        tabs.addTab(DocumentsView(ctx), "الوثائق")
        if has_permission(ctx.current_user, "settings.manage") or has_permission(ctx.current_user, "users.manage"):
            tabs.addTab(SettingsView(ctx), "الإعدادات")
        central_layout.addWidget(tabs)

        self.setCentralWidget(central)

        self.statusBar().showMessage(f"المستخدم الحالي: {ctx.current_user.full_name}")
        logout_action = self.menuBar().addAction("تسجيل الخروج")
        logout_action.triggered.connect(self._on_logout)

    def _size_to_screen(self) -> None:
        """يضبط حجم النافذة وفق الشاشة المتاحة حتى لا يختفي الجزء السفلي على الشاشات الصغيرة."""
        screen = QGuiApplication.primaryScreen()
        if screen is None:
            self.resize(1000, 700)
            return
        available = screen.availableGeometry()
        width = min(1100, int(available.width() * 0.92))
        height = min(780, int(available.height() * 0.9))
        self.resize(width, height)
        self.move(available.center() - self.rect().center())

    def _on_logout(self) -> None:
        self.ctx.auth.logout()
        QMessageBox.information(self, "تسجيل الخروج", "تم تسجيل الخروج. الرجاء إعادة تشغيل التطبيق لتسجيل الدخول مجددًا.")
        self.close()

MOHDALI_EOF

cat > app/ui/settings/settings_view.py << 'MOHDALI_EOF'
"""شاشة الإعدادات: اللائحة الأساسية، المستخدمون، البريد الإلكتروني، النسخ الاحتياطي."""
from __future__ import annotations

import shutil
import zipfile
from datetime import datetime
from pathlib import Path

from PySide6.QtCore import Qt
from PySide6.QtWidgets import (
    QCheckBox,
    QDialog,
    QFileDialog,
    QFormLayout,
    QHBoxLayout,
    QHeaderView,
    QInputDialog,
    QLabel,
    QLineEdit,
    QPushButton,
    QSpinBox,
    QTableWidget,
    QTableWidgetItem,
    QTabWidget,
    QVBoxLayout,
    QWidget,
)

from app.auth.service import AuthService, has_permission
from app.db.models import User
from app.db.session import get_db_path
from app.paths import default_backups_dir, ensure_default_backups_dir
from app.services import bylaw_settings_service, document_service, smtp_settings_service
from app.ui.app_context import AppContext
from app.ui.common import confirm, show_error, show_info
from app.ui.settings.user_form_dialog import ROLE_LABELS, UserFormDialog


class SettingsView(QTabWidget):
    def __init__(self, ctx: AppContext, parent=None):
        super().__init__(parent)
        self.ctx = ctx
        self.setLayoutDirection(Qt.LayoutDirection.RightToLeft)

        self.addTab(BylawSettingsTab(ctx), "اللائحة الأساسية")
        if has_permission(ctx.current_user, "users.manage"):
            self.addTab(UsersTab(ctx), "المستخدمون")
            self.addTab(SmtpSettingsTab(ctx), "البريد الإلكتروني")
        self.addTab(BackupTab(ctx), "النسخ الاحتياطي")


class BylawSettingsTab(QWidget):
    def __init__(self, ctx: AppContext, parent=None):
        super().__init__(parent)
        self.ctx = ctx
        self._can_manage = has_permission(ctx.current_user, "settings.manage")

        layout = QVBoxLayout(self)
        layout.addWidget(
            QLabel(
                "<b>ملاحظة:</b> راجع هذه القيم وفق اللائحة الأساسية المعتمدة رسميًا للجمعية "
                "من المركز الوطني لتنمية القطاع غير الربحي قبل الاعتماد عليها."
            )
        )

        self.table = QTableWidget(0, 2)
        self.table.setHorizontalHeaderLabels(["الوصف", "القيمة"])
        self.table.horizontalHeader().setSectionResizeMode(0, QHeaderView.ResizeMode.Stretch)
        layout.addWidget(self.table)

        save_btn = QPushButton("حفظ التغييرات")
        save_btn.setEnabled(self._can_manage)
        save_btn.clicked.connect(self._on_save)
        layout.addWidget(save_btn)

        self._keys: list[str] = []
        self.refresh()

    def refresh(self) -> None:
        settings = bylaw_settings_service.list_settings(self.ctx.session)
        self._keys = [s.key for s in settings]
        self.table.setRowCount(0)
        for setting in settings:
            row = self.table.rowCount()
            self.table.insertRow(row)
            self.table.setItem(row, 0, QTableWidgetItem(setting.description or setting.key))
            value_item = QTableWidgetItem(setting.value)
            if not self._can_manage:
                value_item.setFlags(value_item.flags() & ~Qt.ItemFlag.ItemIsEditable)
            self.table.setItem(row, 1, value_item)

    def _on_save(self) -> None:
        for row, key in enumerate(self._keys):
            value = self.table.item(row, 1).text().strip()
            try:
                bylaw_settings_service.update_setting(self.ctx.session, self.ctx.current_user, key, value)
            except ValueError as exc:
                show_error(self, str(exc))
                return
        show_info(self, "تم حفظ الإعدادات بنجاح")
        self.refresh()


class UsersTab(QWidget):
    def __init__(self, ctx: AppContext, parent=None):
        super().__init__(parent)
        self.ctx = ctx

        layout = QVBoxLayout(self)
        toolbar = QHBoxLayout()
        toolbar.addStretch()
        add_btn = QPushButton("إضافة مستخدم")
        add_btn.clicked.connect(self._on_add)
        toolbar.addWidget(add_btn)
        layout.addLayout(toolbar)

        self.table = QTableWidget(0, 5)
        self.table.setHorizontalHeaderLabels(["اسم المستخدم", "الاسم الكامل", "البريد الإلكتروني", "الدور", "نشط"])
        self.table.horizontalHeader().setSectionResizeMode(1, QHeaderView.ResizeMode.Stretch)
        self.table.setEditTriggers(QTableWidget.EditTrigger.NoEditTriggers)
        self.table.setSelectionBehavior(QTableWidget.SelectionBehavior.SelectRows)
        layout.addWidget(self.table)

        actions = QHBoxLayout()
        toggle_btn = QPushButton("تفعيل/إيقاف المستخدم المحدد")
        toggle_btn.clicked.connect(self._on_toggle_active)
        actions.addWidget(toggle_btn)
        email_btn = QPushButton("تعديل البريد الإلكتروني")
        email_btn.clicked.connect(self._on_edit_email)
        actions.addWidget(email_btn)
        layout.addLayout(actions)

        self.refresh()

    def refresh(self) -> None:
        auth = AuthService(self.ctx.session)
        users = auth.list_users()
        self.table.setRowCount(0)
        for user in users:
            row = self.table.rowCount()
            self.table.insertRow(row)
            username_item = QTableWidgetItem(user.username)
            username_item.setData(Qt.ItemDataRole.UserRole, user.id)
            self.table.setItem(row, 0, username_item)
            self.table.setItem(row, 1, QTableWidgetItem(user.full_name))
            self.table.setItem(row, 2, QTableWidgetItem(user.email or "—"))
            self.table.setItem(row, 3, QTableWidgetItem(ROLE_LABELS.get(user.role, user.role.value)))
            self.table.setItem(row, 4, QTableWidgetItem("نعم" if user.active else "لا"))

    def _selected_user(self) -> User | None:
        row = self.table.currentRow()
        if row < 0:
            return None
        user_id = self.table.item(row, 0).data(Qt.ItemDataRole.UserRole)
        return self.ctx.session.get(User, user_id)

    def _on_add(self) -> None:
        dialog = UserFormDialog(self)
        if dialog.exec() == QDialog.DialogCode.Accepted and dialog.values:
            auth = AuthService(self.ctx.session)
            try:
                auth.create_user(self.ctx.current_user, **dialog.values)
                self.refresh()
            except Exception as exc:  # noqa: BLE001
                show_error(self, str(exc))

    def _on_toggle_active(self) -> None:
        user = self._selected_user()
        if user is None:
            return
        if user.id == self.ctx.current_user.id:
            show_error(self, "لا يمكنك إيقاف حسابك الحالي")
            return
        auth = AuthService(self.ctx.session)
        auth.set_active(self.ctx.current_user, user, not user.active)
        self.refresh()

    def _on_edit_email(self) -> None:
        user = self._selected_user()
        if user is None:
            return
        email, ok = QInputDialog.getText(self, "تعديل البريد الإلكتروني", f"البريد الإلكتروني لـ {user.username}:", text=user.email or "")
        if not ok:
            return
        auth = AuthService(self.ctx.session)
        auth.set_email(self.ctx.current_user, user, email.strip())
        self.refresh()


class SmtpSettingsTab(QWidget):
    def __init__(self, ctx: AppContext, parent=None):
        super().__init__(parent)
        self.ctx = ctx

        layout = QVBoxLayout(self)
        layout.addWidget(
            QLabel(
                "<b>ملاحظة:</b> تُستخدم هذه الإعدادات لإرسال رمز استعادة كلمة المرور عبر البريد. "
                "لحسابات Gmail يلزم استخدام «كلمة مرور تطبيق» (App Password) وليس كلمة المرور العادية."
            )
        )

        form = QFormLayout()
        self.host = QLineEdit()
        self.host.setPlaceholderText("مثال: smtp.gmail.com")
        self.port = QSpinBox()
        self.port.setRange(1, 65535)
        self.port.setValue(587)
        self.username = QLineEdit()
        self.username.setPlaceholderText("عنوان البريد المستخدم للإرسال")
        self.password = QLineEdit()
        self.password.setEchoMode(QLineEdit.EchoMode.Password)
        self.password.setPlaceholderText("اتركه فارغًا للإبقاء على القيمة الحالية")
        self.use_tls = QCheckBox("استخدام TLS")
        self.use_tls.setChecked(True)
        self.from_address = QLineEdit()
        self.from_address.setPlaceholderText("عنوان المرسِل الظاهر للمستلم")

        form.addRow("الخادم (Host):", self.host)
        form.addRow("المنفذ (Port):", self.port)
        form.addRow("اسم المستخدم:", self.username)
        form.addRow("كلمة المرور:", self.password)
        form.addRow("", self.use_tls)
        form.addRow("عنوان المرسِل:", self.from_address)
        layout.addLayout(form)

        save_btn = QPushButton("حفظ إعدادات البريد")
        save_btn.clicked.connect(self._on_save)
        layout.addWidget(save_btn)
        layout.addStretch()

        self.refresh()

    def refresh(self) -> None:
        settings = smtp_settings_service.get_settings(self.ctx.session)
        self.host.setText(settings.host or "")
        self.port.setValue(settings.port or 587)
        self.username.setText(settings.username or "")
        self.use_tls.setChecked(bool(settings.use_tls))
        self.from_address.setText(settings.from_address or "")

    def _on_save(self) -> None:
        smtp_settings_service.update_settings(
            self.ctx.session,
            host=self.host.text().strip(),
            port=self.port.value(),
            username=self.username.text().strip(),
            password=self.password.text(),
            use_tls=self.use_tls.isChecked(),
            from_address=self.from_address.text().strip(),
        )
        self.password.clear()
        show_info(self, "تم حفظ إعدادات البريد الإلكتروني")


class BackupTab(QWidget):
    def __init__(self, ctx: AppContext, parent=None):
        super().__init__(parent)
        self.ctx = ctx

        layout = QVBoxLayout(self)
        layout.addWidget(QLabel(f"مسار قاعدة البيانات الحالية:\n{get_db_path()}"))
        layout.addWidget(QLabel(f"مجلد النسخ الاحتياطية الافتراضي:\n{default_backups_dir()}"))

        export_btn = QPushButton("تصدير نسخة احتياطية (تشمل قاعدة البيانات والمستندات)")
        export_btn.clicked.connect(self._on_export)
        layout.addWidget(export_btn)

        import_btn = QPushButton("استعادة نسخة احتياطية")
        import_btn.clicked.connect(self._on_import)
        layout.addWidget(import_btn)

        layout.addStretch()

    def _on_export(self) -> None:
        default_name = f"نسخة-احتياطية-{datetime.now().strftime('%Y-%m-%d_%H%M')}.zip"
        default_path = str(ensure_default_backups_dir() / default_name)
        path, _ = QFileDialog.getSaveFileName(self, "حفظ نسخة احتياطية", default_path, "Zip (*.zip)")
        if not path:
            return
        self.ctx.session.commit()
        try:
            with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as zf:
                zf.write(get_db_path(), arcname="membership.db")
                documents_dir = document_service.documents_dir()
                for file_path in documents_dir.glob("*"):
                    if file_path.is_file():
                        zf.write(file_path, arcname=f"documents/{file_path.name}")
            show_info(self, f"تم حفظ النسخة الاحتياطية في: {path}")
        except Exception as exc:  # noqa: BLE001
            show_error(self, f"تعذر إنشاء النسخة الاحتياطية: {exc}")

    def _on_import(self) -> None:
        path, _ = QFileDialog.getOpenFileName(self, "اختيار نسخة احتياطية", str(default_backups_dir()), "نسخة احتياطية (*.zip *.db)")
        if not path:
            return
        if not confirm(self, "سيتم استبدال قاعدة البيانات الحالية بالكامل بهذه النسخة. تأكد من أخذ نسخة احتياطية حديثة أولًا. متابعة؟"):
            return
        try:
            if path.lower().endswith(".zip"):
                with zipfile.ZipFile(path, "r") as zf:
                    with zf.open("membership.db") as src, open(get_db_path(), "wb") as dst:
                        shutil.copyfileobj(src, dst)
                    documents_dir = document_service.documents_dir()
                    for name in zf.namelist():
                        if name.startswith("documents/") and not name.endswith("/"):
                            target = documents_dir / Path(name).name
                            with zf.open(name) as src, open(target, "wb") as dst:
                                shutil.copyfileobj(src, dst)
            else:
                shutil.copy(path, get_db_path())
            show_info(self, "تم استيراد النسخة الاحتياطية. الرجاء إعادة تشغيل التطبيق الآن لتحميل البيانات المستعادة.")
        except Exception as exc:  # noqa: BLE001
            show_error(self, f"تعذر استعادة النسخة الاحتياطية: {exc}")
MOHDALI_EOF

cat > app/ui/settings/user_form_dialog.py << 'MOHDALI_EOF'
"""نموذج إضافة مستخدم جديد."""
from __future__ import annotations

from PySide6.QtCore import Qt
from PySide6.QtWidgets import QComboBox, QDialog, QDialogButtonBox, QFormLayout, QLineEdit, QVBoxLayout

from app.db.models import UserRole

ROLE_LABELS = {
    UserRole.ADMIN: "مدير النظام",
    UserRole.MEMBERSHIP_OFFICER: "موظف عضوية",
    UserRole.ASSEMBLY_MANAGER: "مسؤول الجمعية العمومية",
    UserRole.VIEWER: "عرض فقط",
}


class UserFormDialog(QDialog):
    def __init__(self, parent=None):
        super().__init__(parent)
        self.setWindowTitle("إضافة مستخدم جديد")
        self.setLayoutDirection(Qt.LayoutDirection.RightToLeft)
        self.setMinimumWidth(380)

        layout = QVBoxLayout(self)
        form = QFormLayout()

        self.username = QLineEdit()
        self.full_name = QLineEdit()
        self.email = QLineEdit()
        self.email.setPlaceholderText("لاستعادة كلمة المرور عند نسيانها (اختياري)")
        self.password = QLineEdit()
        self.password.setEchoMode(QLineEdit.EchoMode.Password)
        self.role = QComboBox()
        for role, label in ROLE_LABELS.items():
            self.role.addItem(label, role)

        form.addRow("اسم المستخدم:*", self.username)
        form.addRow("الاسم الكامل:*", self.full_name)
        form.addRow("البريد الإلكتروني:", self.email)
        form.addRow("كلمة المرور المبدئية:*", self.password)
        form.addRow("الدور:", self.role)
        layout.addLayout(form)

        buttons = QDialogButtonBox(QDialogButtonBox.StandardButton.Ok | QDialogButtonBox.StandardButton.Cancel)
        buttons.button(QDialogButtonBox.StandardButton.Ok).setText("إضافة")
        buttons.button(QDialogButtonBox.StandardButton.Cancel).setText("إلغاء")
        buttons.accepted.connect(self._on_accept)
        buttons.rejected.connect(self.reject)
        layout.addWidget(buttons)

        self.values: dict | None = None

    def _on_accept(self) -> None:
        if not self.username.text().strip() or not self.full_name.text().strip() or len(self.password.text()) < 6:
            return
        self.values = {
            "username": self.username.text().strip(),
            "full_name": self.full_name.text().strip(),
            "email": self.email.text().strip() or None,
            "password": self.password.text(),
            "role": self.role.currentData(),
        }
        self.accept()

MOHDALI_EOF

cat > tests/test_document_service.py << 'MOHDALI_EOF'
from pathlib import Path

from app.services import document_service


def test_add_list_delete_document(db_session, admin_user, tmp_path, monkeypatch):
    monkeypatch.setenv("MOHDALI_DATA_DIR", str(tmp_path))

    source = tmp_path / "خطاب.pdf"
    source.write_bytes(b"%PDF-1.4 fake content")

    document = document_service.add_document(
        db_session, admin_user, category="شهادة الجمعية", title="شهادة تسجيل الجمعية", source_file_path=str(source)
    )

    stored_path = document_service.document_path(document)
    assert stored_path.exists()
    assert stored_path.read_bytes() == b"%PDF-1.4 fake content"

    documents = document_service.list_documents(db_session)
    assert len(documents) == 1
    assert documents[0].title == "شهادة تسجيل الجمعية"

    filtered = document_service.list_documents(db_session, category="خطاب اعتماد برنامج")
    assert filtered == []

    document_service.delete_document(db_session, admin_user, document)
    assert document_service.list_documents(db_session) == []
    assert not stored_path.exists()


def test_add_document_missing_source_raises(db_session, admin_user, tmp_path, monkeypatch):
    monkeypatch.setenv("MOHDALI_DATA_DIR", str(tmp_path))
    try:
        document_service.add_document(
            db_session, admin_user, category="أخرى", title="ملف مفقود", source_file_path=str(tmp_path / "missing.pdf")
        )
        assert False, "expected FileNotFoundError"
    except FileNotFoundError:
        pass
MOHDALI_EOF

cat > tests/test_password_reset_service.py << 'MOHDALI_EOF'
from datetime import datetime, timedelta

import pytest

from app.db.models import PasswordResetCode
from app.services import password_reset_service, smtp_settings_service


def _configure_smtp(db_session):
    smtp_settings_service.update_settings(
        db_session,
        host="smtp.example.com",
        port=587,
        username="assoc@example.com",
        password="app-password",
        use_tls=True,
        from_address="assoc@example.com",
    )


def test_request_reset_fails_without_registered_email(db_session, admin_user):
    _configure_smtp(db_session)
    with pytest.raises(password_reset_service.PasswordResetError, match="بريد إلكتروني"):
        password_reset_service.request_reset(db_session, admin_user.username)


def test_request_reset_fails_when_smtp_not_configured(db_session, admin_user):
    admin_user.email = "admin@example.com"
    db_session.commit()
    with pytest.raises(password_reset_service.PasswordResetError, match="SMTP"):
        password_reset_service.request_reset(db_session, admin_user.username)


def test_request_reset_fails_for_unknown_user(db_session):
    _configure_smtp(db_session)
    with pytest.raises(password_reset_service.PasswordResetError):
        password_reset_service.request_reset(db_session, "لا_يوجد_مستخدم")


def test_request_reset_sends_code_and_confirm_reset_changes_password(db_session, admin_user, monkeypatch):
    admin_user.email = "admin@example.com"
    db_session.commit()
    _configure_smtp(db_session)

    sent = {}

    def fake_send_email(smtp_settings, to_address, subject, body):
        sent["to"] = to_address
        sent["body"] = body

    monkeypatch.setattr(password_reset_service, "_send_email", fake_send_email)

    password_reset_service.request_reset(db_session, admin_user.username)
    assert sent["to"] == "admin@example.com"

    code = db_session.query(PasswordResetCode).filter(PasswordResetCode.user_id == admin_user.id).one()
    assert code.code in sent["body"]

    from app.auth.security import verify_password

    password_reset_service.confirm_reset(db_session, admin_user.username, code.code, "NewPass123")
    db_session.refresh(admin_user)
    assert verify_password("NewPass123", admin_user.password_hash)
    assert admin_user.force_password_change is False


def test_confirm_reset_rejects_wrong_code(db_session, admin_user):
    admin_user.email = "admin@example.com"
    db_session.add(
        PasswordResetCode(
            user_id=admin_user.id, code="111111", created_at=datetime.utcnow(), expires_at=datetime.utcnow() + timedelta(minutes=15)
        )
    )
    db_session.commit()
    with pytest.raises(password_reset_service.PasswordResetError, match="غير صحيح"):
        password_reset_service.confirm_reset(db_session, admin_user.username, "000000", "NewPass123")


def test_confirm_reset_rejects_expired_code(db_session, admin_user):
    admin_user.email = "admin@example.com"
    db_session.add(
        PasswordResetCode(
            user_id=admin_user.id, code="222222", created_at=datetime.utcnow() - timedelta(minutes=30), expires_at=datetime.utcnow() - timedelta(minutes=15)
        )
    )
    db_session.commit()
    with pytest.raises(password_reset_service.PasswordResetError, match="انتهت"):
        password_reset_service.confirm_reset(db_session, admin_user.username, "222222", "NewPass123")
MOHDALI_EOF

cat > tests/test_schema_upgrade.py << 'MOHDALI_EOF'
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
MOHDALI_EOF

cat > tests/test_smtp_settings_service.py << 'MOHDALI_EOF'
from app.services import smtp_settings_service


def test_get_settings_creates_default_row(db_session):
    settings = smtp_settings_service.get_settings(db_session)
    assert settings.id == 1
    assert settings.port == 587
    assert smtp_settings_service.is_configured(settings) is False


def test_update_settings_persists_values_and_keeps_password_when_blank(db_session):
    smtp_settings_service.update_settings(
        db_session,
        host="smtp.example.com",
        port=465,
        username="assoc@example.com",
        password="secret",
        use_tls=False,
        from_address="assoc@example.com",
    )
    settings = smtp_settings_service.get_settings(db_session)
    assert settings.host == "smtp.example.com"
    assert settings.port == 465
    assert settings.password == "secret"
    assert settings.use_tls is False
    assert smtp_settings_service.is_configured(settings) is True

    # تحديث لاحق دون كلمة مرور يجب ألا يمسح القيمة المحفوظة
    smtp_settings_service.update_settings(
        db_session,
        host="smtp.example.com",
        port=465,
        username="assoc@example.com",
        password="",
        use_tls=False,
        from_address="assoc@example.com",
    )
    settings = smtp_settings_service.get_settings(db_session)
    assert settings.password == "secret"
MOHDALI_EOF

cat > tests/test_ui_smoke.py << 'MOHDALI_EOF'
"""فحص دخان: التأكد من أن جميع شاشات الواجهة تُقلع دون أخطاء (بيئة offscreen)."""
from datetime import date

from app.auth.service import AuthService
from app.db.models import AssemblyType
from app.services import assembly_service, board_service, membership_service
from app.ui.app_context import AppContext
from app.ui.assembly.assembly_detail_view import AssemblyDetailView
from app.ui.assembly.assembly_list_view import AssemblyListView
from app.ui.board.board_view import BoardView
from app.ui.dashboard_view import DashboardView
from app.ui.documents.documents_view import DocumentsView
from app.ui.forgot_password_dialog import ForgotPasswordDialog
from app.ui.main_window import MainWindow
from app.ui.members.import_dialog import ImportDialog
from app.ui.members.members_view import MembersView
from app.ui.settings.settings_view import SettingsView


def _make_ctx(db_session, admin_user) -> AppContext:
    auth = AuthService(db_session)
    auth.current_user = admin_user
    return AppContext(session=db_session, auth=auth)


def _seed_sample_data(db_session, admin_user):
    join_date = date.today().replace(year=date.today().year - 1)
    member = membership_service.submit_membership_request(
        db_session, admin_user, full_name="عضو تجريبي", member_type="عامل", join_date=join_date
    )
    membership_service.approve_membership(db_session, admin_user, member)
    membership_service.record_fee_payment(db_session, admin_user, member, fee_year=date.today().year, amount=100)

    assembly = assembly_service.create_assembly(
        db_session, admin_user, title="اجتماع تجريبي", type=AssemblyType.ORDINARY, meeting_date=date.today()
    )
    assembly_service.add_agenda_item(db_session, admin_user, assembly, "بند تجريبي")
    return member, assembly


def test_dashboard_view_builds(qapp, db_session, admin_user):
    ctx = _make_ctx(db_session, admin_user)
    _seed_sample_data(db_session, admin_user)
    view = DashboardView(ctx)
    assert "عضو تجريبي" not in view.summary_label.text()  # الملخص لا يعرض الأسماء، فقط الأعداد
    assert "1" in view.summary_label.text()


def test_members_view_builds_and_lists_members(qapp, db_session, admin_user):
    ctx = _make_ctx(db_session, admin_user)
    _seed_sample_data(db_session, admin_user)
    view = MembersView(ctx)
    assert view.table.rowCount() == 1


def test_assembly_list_and_detail_views_build(qapp, db_session, admin_user):
    ctx = _make_ctx(db_session, admin_user)
    _member, assembly = _seed_sample_data(db_session, admin_user)
    list_view = AssemblyListView(ctx)
    assert list_view.table.rowCount() == 1

    detail_view = AssemblyDetailView(ctx, assembly.id)
    assert detail_view.agenda_list.count() == 1


def test_board_view_builds(qapp, db_session, admin_user):
    ctx = _make_ctx(db_session, admin_user)
    member, _assembly = _seed_sample_data(db_session, admin_user)
    board_service.assign_position(db_session, admin_user, member, title="رئيس مجلس الإدارة")
    view = BoardView(ctx)
    assert view.table.rowCount() == 1


def test_import_dialog_builds(qapp, db_session, admin_user):
    dialog = ImportDialog()
    assert dialog.sheet_combo.count() == 0


def test_settings_view_builds(qapp, db_session, admin_user):
    ctx = _make_ctx(db_session, admin_user)
    view = SettingsView(ctx)
    assert view.count() >= 2  # اللائحة الأساسية + المستخدمون + النسخ الاحتياطي


def test_main_window_builds_with_all_tabs(qapp, db_session, admin_user, tmp_path, monkeypatch):
    monkeypatch.setenv("MOHDALI_DATA_DIR", str(tmp_path))
    ctx = _make_ctx(db_session, admin_user)
    _seed_sample_data(db_session, admin_user)
    window = MainWindow(ctx)
    assert window.windowTitle()


def test_documents_view_builds(qapp, db_session, admin_user, tmp_path, monkeypatch):
    monkeypatch.setenv("MOHDALI_DATA_DIR", str(tmp_path))
    ctx = _make_ctx(db_session, admin_user)
    view = DocumentsView(ctx)
    assert view.table.rowCount() == 0


def test_forgot_password_dialog_builds(qapp, db_session):
    dialog = ForgotPasswordDialog(db_session)
    assert dialog.confirm_btn.isVisible() is False

MOHDALI_EOF

echo "تم تحديث جميع الملفات بنجاح"
