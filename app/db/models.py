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

