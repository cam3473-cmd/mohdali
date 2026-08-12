mkdir -p app/db app/services app/ui tests

cat > app/db/session.py << 'MOHDALI_EOF'
"""إدارة الاتصال بقاعدة البيانات المحلية (SQLite) وتهيئتها."""
from __future__ import annotations

import os
from pathlib import Path

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import Session, sessionmaker

from app.db.models import Base, BylawSetting, SmtpSettings, User, UserRole
from app.auth.security import hash_password
from app.paths import app_base_dir

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
    "annual_membership_fee": (
        "300",
        "قيمة الاشتراك السنوي الثابت للعضو العادي (ريال) — تُستخدم لتقدير المستحقات المتأخرة تلقائيًا. "
        "الحالات الاستثنائية (كسداد عضو داعم لعدة سنوات مقدمًا بمبلغ مختلف) تُسجَّل بسجل سداد مستقل لكل سنة فلا تتأثر بهذا التقدير.",
    ),
}


def get_data_dir() -> Path:
    """يحدد مجلد بيانات التطبيق: بجانب البرنامج نفسه (وضع محمول) — بجانب ملف exe عند التشغيل
    كبرنامج مستقل، أو بجانب الكود عند التشغيل من مجلد المشروع مباشرة. بهذا يكفي نسخ مجلد
    البرنامج بالكامل (عبر فلاش مثلًا) لنقل النظام وكل بياناته ومستنداته دفعة واحدة."""
    env_override = os.environ.get("MOHDALI_DATA_DIR")
    base = Path(env_override) if env_override else app_base_dir()
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

cat > app/services/bylaw_settings_service.py << 'MOHDALI_EOF'
"""قراءة وتعديل إعدادات اللائحة الأساسية القابلة للتهيئة."""
from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy.orm import Session

from app.db.models import BylawSetting, User
from app.services.audit import log_action


@dataclass
class BylawSettings:
    min_membership_days: int
    founders_exempt_from_duration: bool
    require_paid_fees: bool
    voting_member_types: list[str]
    quorum_first_percent: float
    quorum_second_percent: float
    majority_normal_percent: float
    majority_special_percent: float
    max_proxies_per_holder: int
    board_term_end_date: str
    annual_membership_fee: float


def _to_bool(value: str) -> bool:
    return value.strip().lower() in {"true", "1", "yes"}


def get_settings(session: Session) -> BylawSettings:
    rows = {row.key: row.value for row in session.query(BylawSetting).all()}
    return BylawSettings(
        min_membership_days=int(rows.get("min_membership_days", "180")),
        founders_exempt_from_duration=_to_bool(rows.get("founders_exempt_from_duration", "true")),
        require_paid_fees=_to_bool(rows.get("require_paid_fees", "true")),
        voting_member_types=[
            t.strip() for t in rows.get("voting_member_types", "مؤسس,عامل").split(",") if t.strip()
        ],
        quorum_first_percent=float(rows.get("quorum_first_percent", "50")),
        quorum_second_percent=float(rows.get("quorum_second_percent", "25")),
        majority_normal_percent=float(rows.get("majority_normal_percent", "50")),
        majority_special_percent=float(rows.get("majority_special_percent", "66.67")),
        max_proxies_per_holder=int(rows.get("max_proxies_per_holder", "0")),
        board_term_end_date=rows.get("board_term_end_date", ""),
        annual_membership_fee=float(rows.get("annual_membership_fee", "300")),
    )


def update_setting(session: Session, actor: User, key: str, value: str) -> None:
    row = session.query(BylawSetting).filter(BylawSetting.key == key).first()
    if row is None:
        raise ValueError(f"إعداد غير معروف: {key}")
    old_value = row.value
    row.value = value
    log_action(session, actor, "update_bylaw_setting", "bylaw_settings", details=f"{key}: {old_value} -> {value}")
    session.commit()


def list_settings(session: Session) -> list[BylawSetting]:
    return session.query(BylawSetting).order_by(BylawSetting.key).all()

MOHDALI_EOF

cat > app/services/membership_service.py << 'MOHDALI_EOF'
"""إدارة طلبات العضوية والأعضاء والاشتراكات."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date

from sqlalchemy.orm import Session

from app.db.models import AssemblyAttendance, FeeStatus, Member, MemberStatus, MembershipFee, User
from app.services.audit import log_action
from app.services.bylaw_settings_service import get_settings


class MembershipError(Exception):
    pass


def _check_unique_fields(
    session: Session,
    member_id: int | None,
    membership_number: str | None,
    national_id_or_cr: str | None,
) -> None:
    """يتحقق أن رقم العضوية والسجل المدني غير مستخدمين لعضو آخر، ويرفع رسالة عربية واضحة عند التعارض
    بدلًا من ترك خطأ قاعدة البيانات الخام يصل للواجهة ويُعطّل الجلسة."""
    if membership_number:
        query = session.query(Member).filter(Member.membership_number == membership_number)
        if member_id is not None:
            query = query.filter(Member.id != member_id)
        conflict = query.first()
        if conflict is not None:
            raise MembershipError(f"رقم العضوية \"{membership_number}\" مستخدم بالفعل للعضو: {conflict.full_name}")
    if national_id_or_cr:
        query = session.query(Member).filter(Member.national_id_or_cr == national_id_or_cr)
        if member_id is not None:
            query = query.filter(Member.id != member_id)
        conflict = query.first()
        if conflict is not None:
            raise MembershipError(f"رقم الهوية/السجل \"{national_id_or_cr}\" مستخدم بالفعل للعضو: {conflict.full_name}")


def submit_membership_request(
    session: Session,
    actor: User,
    *,
    full_name: str,
    member_type: str,
    membership_number: str | None = None,
    national_id_or_cr: str | None = None,
    gender: str | None = None,
    birth_date: date | None = None,
    phone: str | None = None,
    email: str | None = None,
    address: str | None = None,
    qualification: str | None = None,
    city: str | None = None,
    occupation: str | None = None,
    join_date: date | None = None,
    is_founder: bool = False,
    notes: str | None = None,
) -> Member:
    _check_unique_fields(session, None, membership_number, national_id_or_cr)
    member = Member(
        full_name=full_name,
        membership_number=membership_number,
        member_type=member_type,
        national_id_or_cr=national_id_or_cr,
        gender=gender,
        birth_date=birth_date,
        phone=phone,
        email=email,
        address=address,
        qualification=qualification,
        city=city,
        occupation=occupation,
        join_date=join_date or date.today(),
        is_founder=is_founder,
        status=MemberStatus.PENDING,
        notes=notes,
    )
    session.add(member)
    session.flush()
    log_action(session, actor, "submit_membership_request", "member", member.id)
    session.commit()
    return member


def approve_membership(session: Session, actor: User, member: Member) -> None:
    if member.status not in (MemberStatus.PENDING, MemberStatus.SUSPENDED):
        raise MembershipError("لا يمكن قبول عضو ليس في حالة طلب معلّق أو موقوف")
    member.status = MemberStatus.ACTIVE
    log_action(session, actor, "approve_membership", "member", member.id)
    session.commit()


def reject_membership(session: Session, actor: User, member: Member, reason: str) -> None:
    if member.status != MemberStatus.PENDING:
        raise MembershipError("لا يمكن رفض عضو ليس في حالة طلب معلّق")
    member.status = MemberStatus.REJECTED
    member.notes = ((member.notes or "") + f"\nسبب الرفض: {reason}").strip()
    log_action(session, actor, "reject_membership", "member", member.id, details=reason)
    session.commit()


def suspend_membership(session: Session, actor: User, member: Member, reason: str) -> None:
    member.status = MemberStatus.SUSPENDED
    member.notes = ((member.notes or "") + f"\nسبب الإيقاف: {reason}").strip()
    log_action(session, actor, "suspend_membership", "member", member.id, details=reason)
    session.commit()


def withdraw_membership(session: Session, actor: User, member: Member) -> None:
    member.status = MemberStatus.WITHDRAWN
    log_action(session, actor, "withdraw_membership", "member", member.id)
    session.commit()


def delete_member(session: Session, actor: User, member: Member) -> None:
    """حذف عضو نهائيًا (لتصحيح تكرار ناتج عن استيراد، مثلًا). يُرفض الحذف إن كان للعضو سجل حضور/توكيل
    في اجتماع سابق للجمعية العمومية — استخدم إيقاف العضوية أو تسجيل الانسحاب في هذه الحالة بدلًا من الحذف."""
    has_history = (
        session.query(AssemblyAttendance)
        .filter(
            (AssemblyAttendance.member_id == member.id) | (AssemblyAttendance.proxy_holder_member_id == member.id)
        )
        .first()
    )
    if has_history is not None:
        raise MembershipError(
            "لا يمكن حذف هذا العضو لوجود سجل حضور/توكيل مرتبط به في اجتماع سابق للجمعية العمومية. "
            "استخدم \"إيقاف العضوية\" أو \"تسجيل انسحاب\" بدلًا من الحذف."
        )
    member_id = member.id
    details = f"{member.full_name} ({member.membership_number or '—'})"
    session.delete(member)
    log_action(session, actor, "delete_member", "member", member_id, details=details)
    session.commit()


def update_member(session: Session, actor: User, member: Member, **fields) -> Member:
    for key in fields:
        if not hasattr(member, key):
            raise MembershipError(f"حقل غير معروف: {key}")
    _check_unique_fields(
        session,
        member.id,
        fields.get("membership_number", member.membership_number),
        fields.get("national_id_or_cr", member.national_id_or_cr),
    )
    for key, value in fields.items():
        setattr(member, key, value)
    log_action(session, actor, "update_member", "member", member.id)
    session.commit()
    return member


def record_fee_payment(
    session: Session,
    actor: User,
    member: Member,
    *,
    fee_year: int,
    amount: float,
    paid_date: date | None = None,
    payment_method: str | None = None,
    receipt_number: str | None = None,
) -> MembershipFee:
    fee = (
        session.query(MembershipFee)
        .filter(MembershipFee.member_id == member.id, MembershipFee.fee_year == fee_year)
        .first()
    )
    if fee is None:
        fee = MembershipFee(member_id=member.id, fee_year=fee_year)
        session.add(fee)
    fee.amount = amount
    fee.paid_date = paid_date or date.today()
    fee.payment_method = payment_method
    fee.receipt_number = receipt_number
    fee.status = FeeStatus.PAID
    session.flush()
    log_action(session, actor, "record_fee_payment", "membership_fee", fee.id, details=f"year={fee_year}")
    session.commit()
    return fee


def list_members(
    session: Session, status: MemberStatus | None = None, search: str | None = None
) -> list[Member]:
    query = session.query(Member)
    if status is not None:
        query = query.filter(Member.status == status)
    if search:
        like = f"%{search}%"
        query = query.filter(Member.full_name.ilike(like))
    return query.order_by(Member.full_name).all()


def list_unpaid_active_members(session: Session, fee_year: int | None = None) -> list[Member]:
    """الأعضاء النشطون الذين لم يُسجَّل لهم سداد اشتراك (مقبول أو معفى) عن السنة المحددة."""
    fee_year = fee_year or date.today().year
    paid_member_ids = session.query(MembershipFee.member_id).filter(
        MembershipFee.fee_year == fee_year, MembershipFee.status.in_([FeeStatus.PAID, FeeStatus.WAIVED])
    )
    return (
        session.query(Member)
        .filter(Member.status == MemberStatus.ACTIVE, ~Member.id.in_(paid_member_ids))
        .order_by(Member.full_name)
        .all()
    )


@dataclass
class MemberArrears:
    member: Member
    unpaid_years: list[int]
    estimated_amount: float

    @property
    def years_count(self) -> int:
        return len(self.unpaid_years)


def compute_member_arrears(session: Session, member: Member, as_of_year: int | None = None) -> MemberArrears:
    """يحسب السنوات التي لم يُسجَّل للعضو فيها سداد (مقبول أو معفى)، من سنة انضمامه حتى السنة الحالية.
    السنوات المدفوعة مسبقًا لعضو داعم (بمبالغ استثنائية) تُستبعد تلقائيًا طالما سُجِّل لها سند سداد
    مستقل لكل سنة، بصرف النظر عن قيمته — فالتقدير المالي أدناه تقريبي فقط ولا يعكس الحالات الخاصة."""
    as_of_year = as_of_year or date.today().year
    paid_years = {
        f.fee_year
        for f in session.query(MembershipFee).filter(
            MembershipFee.member_id == member.id, MembershipFee.status.in_([FeeStatus.PAID, FeeStatus.WAIVED])
        )
    }
    start_year = min(member.join_date.year, as_of_year)
    unpaid_years = [y for y in range(start_year, as_of_year + 1) if y not in paid_years]
    annual_fee = get_settings(session).annual_membership_fee
    return MemberArrears(member=member, unpaid_years=unpaid_years, estimated_amount=len(unpaid_years) * annual_fee)


def list_active_members_with_arrears(session: Session, as_of_year: int | None = None) -> list[MemberArrears]:
    """الأعضاء النشطون الذين عليهم اشتراكات متأخرة سنة واحدة أو أكثر، مرتبين من الأكثر تأخرًا."""
    members = session.query(Member).filter(Member.status == MemberStatus.ACTIVE).order_by(Member.full_name).all()
    arrears = [compute_member_arrears(session, m, as_of_year=as_of_year) for m in members]
    return sorted((a for a in arrears if a.years_count > 0), key=lambda a: -a.years_count)

MOHDALI_EOF

cat > app/ui/dashboard_view.py << 'MOHDALI_EOF'
"""لوحة رئيسية: ملخص سريع لحالة العضوية والاجتماعات."""
from __future__ import annotations

from datetime import date

from PySide6.QtCore import Qt
from PySide6.QtWidgets import QLabel, QMessageBox, QPushButton, QVBoxLayout, QWidget

from app.db.models import Assembly, AssemblyStatus, Member, MemberStatus
from app.services import membership_service
from app.services.eligibility_service import list_eligible_members
from app.ui.app_context import AppContext


class DashboardView(QWidget):
    def __init__(self, ctx: AppContext, parent=None):
        super().__init__(parent)
        self.ctx = ctx
        self.setLayoutDirection(Qt.LayoutDirection.RightToLeft)

        layout = QVBoxLayout(self)
        self.summary_label = QLabel()
        self.summary_label.setStyleSheet("font-size: 14pt;")
        layout.addWidget(self.summary_label)

        refresh_btn = QPushButton("تحديث")
        refresh_btn.clicked.connect(self.refresh)
        layout.addWidget(refresh_btn)

        self.unpaid_btn = QPushButton("عرض الأعضاء المتأخرين عن السداد")
        self.unpaid_btn.clicked.connect(self._on_show_unpaid)
        layout.addWidget(self.unpaid_btn)

        layout.addStretch()

        self.refresh()

    def refresh(self) -> None:
        session = self.ctx.session
        total_members = session.query(Member).count()
        active_members = session.query(Member).filter(Member.status == MemberStatus.ACTIVE).count()
        pending_requests = session.query(Member).filter(Member.status == MemberStatus.PENDING).count()
        eligible_count = len(list_eligible_members(session, as_of_date=date.today()))
        arrears_list = membership_service.list_active_members_with_arrears(session)
        arrears_count = len(arrears_list)
        arrears_total = sum(a.estimated_amount for a in arrears_list)
        upcoming = (
            session.query(Assembly)
            .filter(Assembly.meeting_date >= date.today(), Assembly.status != AssemblyStatus.CANCELLED)
            .order_by(Assembly.meeting_date)
            .all()
        )
        upcoming_lines = "".join(f"<li>{a.title} — {a.meeting_date.isoformat()}</li>" for a in upcoming) or "<li>لا توجد اجتماعات قادمة</li>"

        arrears_color = "#b3261e" if arrears_count else "#1e7d34"
        self.summary_label.setText(
            f"<h2>مرحبًا، {self.ctx.current_user.full_name}</h2>"
            f"<p>إجمالي الأعضاء: <b>{total_members}</b> — الأعضاء النشطون: <b>{active_members}</b> — "
            f"طلبات عضوية معلّقة: <b>{pending_requests}</b></p>"
            f"<p>الأعضاء المؤهلون لحضور/التصويت في الجمعية العمومية اليوم: <b>{eligible_count}</b></p>"
            f"<p>الأعضاء المتأخرون عن سداد الاشتراك (سنة واحدة أو أكثر): "
            f"<b style='color:{arrears_color}'>{arrears_count}</b>"
            + (f" — إجمالي المستحقات التقديرية: <b>{arrears_total:,.0f} ريال</b>" if arrears_count else "")
            + "</p>"
            f"<p>الاجتماعات القادمة:</p><ul>{upcoming_lines}</ul>"
        )

    def _on_show_unpaid(self) -> None:
        arrears_list = membership_service.list_active_members_with_arrears(self.ctx.session)
        if not arrears_list:
            QMessageBox.information(self, "المتأخرون عن السداد", "لا يوجد أعضاء متأخرون عن سداد الاشتراك.")
            return
        lines = [
            f"- {a.member.full_name}: متأخر {a.years_count} سنة ({', '.join(str(y) for y in a.unpaid_years)}) "
            f"— تقديريًا {a.estimated_amount:,.0f} ريال"
            for a in arrears_list
        ]
        total = sum(a.estimated_amount for a in arrears_list)
        message = (
            f"عدد الأعضاء المتأخرين: {len(arrears_list)} — إجمالي المستحقات التقديرية: {total:,.0f} ريال\n\n"
            + "\n".join(lines)
        )
        QMessageBox.information(self, "المتأخرون عن السداد", message)

MOHDALI_EOF

cat > tests/test_dashboard_reminders.py << 'MOHDALI_EOF'
from datetime import date

from app.services import audit, membership_service


def test_list_unpaid_active_members_excludes_paid_and_inactive(db_session, admin_user):
    paid = membership_service.submit_membership_request(
        db_session, admin_user, full_name="عضو سدد", member_type="عادية", join_date=date(2020, 1, 1)
    )
    membership_service.approve_membership(db_session, admin_user, paid)
    membership_service.record_fee_payment(db_session, admin_user, paid, fee_year=date.today().year, amount=300)

    unpaid = membership_service.submit_membership_request(
        db_session, admin_user, full_name="عضو لم يسدد", member_type="عادية", join_date=date(2020, 1, 1)
    )
    membership_service.approve_membership(db_session, admin_user, unpaid)

    pending = membership_service.submit_membership_request(
        db_session, admin_user, full_name="عضو معلق", member_type="عادية", join_date=date(2020, 1, 1)
    )

    result = membership_service.list_unpaid_active_members(db_session)
    names = {m.full_name for m in result}
    assert names == {"عضو لم يسدد"}


def test_compute_member_arrears_counts_years_since_join_when_never_paid(db_session, admin_user):
    member = membership_service.submit_membership_request(
        db_session, admin_user, full_name="لم يسدد أبدًا", member_type="عادية", join_date=date(2023, 6, 1)
    )
    membership_service.approve_membership(db_session, admin_user, member)

    arrears = membership_service.compute_member_arrears(db_session, member, as_of_year=2026)
    assert arrears.unpaid_years == [2023, 2024, 2025, 2026]
    assert arrears.years_count == 4
    assert arrears.estimated_amount == 4 * 300


def test_compute_member_arrears_counts_only_gap_years_since_last_payment(db_session, admin_user):
    member = membership_service.submit_membership_request(
        db_session, admin_user, full_name="سدد ثم توقف", member_type="عادية", join_date=date(2020, 1, 1)
    )
    membership_service.approve_membership(db_session, admin_user, member)
    membership_service.record_fee_payment(db_session, admin_user, member, fee_year=2023, amount=300)

    arrears = membership_service.compute_member_arrears(db_session, member, as_of_year=2026)
    assert arrears.unpaid_years == [2020, 2021, 2022, 2024, 2025, 2026]
    assert arrears.years_count == 6


def test_compute_member_arrears_zero_when_supporting_member_prepaid_future_years(db_session, admin_user):
    """حالة العضو الداعم الذي يدفع مبلغًا كبيرًا مقدمًا يغطي عدة سنوات — لا يظهر متأخرًا طالما سُجِّل سند لكل سنة."""
    member = membership_service.submit_membership_request(
        db_session, admin_user, full_name="عضو داعم", member_type="داعم", join_date=date(2023, 1, 1)
    )
    membership_service.approve_membership(db_session, admin_user, member)
    for year in (2023, 2024, 2025, 2026):
        membership_service.record_fee_payment(db_session, admin_user, member, fee_year=year, amount=25000)

    arrears = membership_service.compute_member_arrears(db_session, member, as_of_year=2026)
    assert arrears.unpaid_years == []
    assert arrears.estimated_amount == 0


def test_list_active_members_with_arrears_sorted_most_overdue_first(db_session, admin_user):
    old = membership_service.submit_membership_request(
        db_session, admin_user, full_name="متأخر قديم", member_type="عادية", join_date=date(2020, 1, 1)
    )
    membership_service.approve_membership(db_session, admin_user, old)
    recent = membership_service.submit_membership_request(
        db_session, admin_user, full_name="متأخر حديث", member_type="عادية", join_date=date(2025, 1, 1)
    )
    membership_service.approve_membership(db_session, admin_user, recent)
    paid_up = membership_service.submit_membership_request(
        db_session, admin_user, full_name="مسدد بالكامل", member_type="عادية", join_date=date(2026, 1, 1)
    )
    membership_service.approve_membership(db_session, admin_user, paid_up)
    membership_service.record_fee_payment(db_session, admin_user, paid_up, fee_year=2026, amount=300)

    result = membership_service.list_active_members_with_arrears(db_session, as_of_year=2026)
    names_in_order = [a.member.full_name for a in result]
    assert names_in_order == ["متأخر قديم", "متأخر حديث"]


def test_audit_log_records_and_lists_recent_actions(db_session, admin_user):
    membership_service.submit_membership_request(
        db_session, admin_user, full_name="عضو للتدقيق", member_type="عادية", join_date=date(2020, 1, 1)
    )
    entries = audit.list_recent(db_session)
    assert any(e.action == "submit_membership_request" for e in entries)


def test_audit_log_search_filters_by_action(db_session, admin_user):
    membership_service.submit_membership_request(
        db_session, admin_user, full_name="عضو آخر للتدقيق", member_type="عادية", join_date=date(2020, 1, 1)
    )
    matches = audit.list_recent(db_session, search="submit_membership")
    assert len(matches) >= 1
    no_matches = audit.list_recent(db_session, search="لا شيء بهذا الاسم")
    assert no_matches == []
MOHDALI_EOF

echo "تم تحديث الملفات بنجاح"
