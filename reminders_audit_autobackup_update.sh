mkdir -p app/services app/ui app/ui/settings tests

cat > app/services/audit.py << 'MOHDALI_EOF'
"""تسجيل العمليات الحساسة في سجل التدقيق."""
from __future__ import annotations

from sqlalchemy.orm import Session

from app.db.models import AuditLog, User


def log_action(
    session: Session,
    user: User | None,
    action: str,
    entity: str,
    entity_id: int | None = None,
    details: str | None = None,
) -> None:
    session.add(
        AuditLog(
            user_id=user.id if user else None,
            action=action,
            entity=entity,
            entity_id=entity_id,
            details=details,
        )
    )


def list_recent(session: Session, limit: int = 300, search: str | None = None) -> list[AuditLog]:
    query = session.query(AuditLog).order_by(AuditLog.timestamp.desc())
    if search:
        like = f"%{search}%"
        query = query.filter((AuditLog.action.ilike(like)) | (AuditLog.entity.ilike(like)) | (AuditLog.details.ilike(like)))
    return query.limit(limit).all()

MOHDALI_EOF

cat > app/services/backup_service.py << 'MOHDALI_EOF'
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
MOHDALI_EOF

cat > app/services/board_service.py << 'MOHDALI_EOF'
"""إدارة مناصب مجلس الإدارة (تعيين، إنهاء، سجل تاريخي)."""
from __future__ import annotations

from datetime import date

from sqlalchemy.orm import Session

from app.db.models import BoardPosition, Member, User
from app.services.audit import log_action


class BoardError(Exception):
    pass


def _position_rank(title: str) -> int:
    """ترتيب عرض المنصب: الرئيس أولًا، ثم نائب الرئيس، ثم أمين الصندوق، ثم أمين السر، ثم بقية الأعضاء."""
    t = title or ""
    if "نائب" in t:
        return 1
    if "رئيس" in t:
        return 0
    if "صندوق" in t or "مالي" in t:
        return 2
    if "سر" in t:
        return 3
    return 4


def assign_position(
    session: Session,
    actor: User,
    member: Member,
    title: str,
    start_date: date | None = None,
    notes: str | None = None,
) -> BoardPosition:
    position = BoardPosition(
        member_id=member.id, title=title, start_date=start_date or date.today(), notes=notes
    )
    session.add(position)
    session.flush()
    log_action(session, actor, "assign_board_position", "board_position", position.id, details=title)
    session.commit()
    return position


def end_position(session: Session, actor: User, position: BoardPosition, end_date: date | None = None) -> None:
    if position.end_date is not None:
        raise BoardError("تم إنهاء هذا المنصب مسبقًا")
    position.end_date = end_date or date.today()
    log_action(session, actor, "end_board_position", "board_position", position.id)
    session.commit()


def update_position(
    session: Session,
    actor: User,
    position: BoardPosition,
    member: Member,
    title: str,
    start_date: date | None = None,
    notes: str | None = None,
) -> None:
    position.member_id = member.id
    position.title = title
    position.start_date = start_date
    position.notes = notes
    log_action(session, actor, "update_board_position", "board_position", position.id, details=title)
    session.commit()


def delete_position(session: Session, actor: User, position: BoardPosition) -> None:
    position_id = position.id
    details = f"{position.title} — {position.member.full_name}"
    session.delete(position)
    log_action(session, actor, "delete_board_position", "board_position", position_id, details=details)
    session.commit()


def list_current_positions(session: Session) -> list[BoardPosition]:
    positions = (
        session.query(BoardPosition)
        .filter(BoardPosition.end_date.is_(None))
        .join(Member)
        .order_by(Member.full_name)
        .all()
    )
    return sorted(positions, key=lambda p: (_position_rank(p.title), p.member.full_name))


def list_position_history(session: Session, member: Member) -> list[BoardPosition]:
    return (
        session.query(BoardPosition)
        .filter(BoardPosition.member_id == member.id)
        .order_by(BoardPosition.start_date.desc().nulls_last())
        .all()
    )


def term_status_text(term_end_date: str, as_of: date | None = None) -> str | None:
    """يبني نص حالة دورة المجلس مع عداد الأيام المتبقية (أو المنقضية) حتى تاريخ نهاية الدورة."""
    if not term_end_date:
        return None
    try:
        end = date.fromisoformat(term_end_date)
    except ValueError:
        return None
    today = as_of or date.today()
    days = (end - today).days
    if days >= 0:
        return f"دورة المجلس الحالية سارية حتى تاريخ: {term_end_date} — متبقٍ {days} يوم"
    return f"انتهت دورة المجلس بتاريخ: {term_end_date} منذ {abs(days)} يوم — يلزم تجديد اعتماد المجلس"


def term_alert_needed(term_end_date: str, threshold_days: int = 200, as_of: date | None = None) -> bool:
    """هل يجب تنبيه المستخدم؟ نعم إن اقترب انتهاء الدورة (أقل من threshold_days) أو انتهت بالفعل."""
    if not term_end_date:
        return False
    try:
        end = date.fromisoformat(term_end_date)
    except ValueError:
        return False
    days = (end - (as_of or date.today())).days
    return days <= threshold_days

MOHDALI_EOF

cat > app/services/membership_service.py << 'MOHDALI_EOF'
"""إدارة طلبات العضوية والأعضاء والاشتراكات."""
from __future__ import annotations

from datetime import date

from sqlalchemy.orm import Session

from app.db.models import FeeStatus, Member, MemberStatus, MembershipFee, User
from app.services.audit import log_action


class MembershipError(Exception):
    pass


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


def update_member(session: Session, actor: User, member: Member, **fields) -> Member:
    for key, value in fields.items():
        if not hasattr(member, key):
            raise MembershipError(f"حقل غير معروف: {key}")
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
        unpaid_count = len(membership_service.list_unpaid_active_members(session))
        upcoming = (
            session.query(Assembly)
            .filter(Assembly.meeting_date >= date.today(), Assembly.status != AssemblyStatus.CANCELLED)
            .order_by(Assembly.meeting_date)
            .all()
        )
        upcoming_lines = "".join(f"<li>{a.title} — {a.meeting_date.isoformat()}</li>" for a in upcoming) or "<li>لا توجد اجتماعات قادمة</li>"

        unpaid_color = "#b3261e" if unpaid_count else "#1e7d34"
        self.summary_label.setText(
            f"<h2>مرحبًا، {self.ctx.current_user.full_name}</h2>"
            f"<p>إجمالي الأعضاء: <b>{total_members}</b> — الأعضاء النشطون: <b>{active_members}</b> — "
            f"طلبات عضوية معلّقة: <b>{pending_requests}</b></p>"
            f"<p>الأعضاء المؤهلون لحضور/التصويت في الجمعية العمومية اليوم: <b>{eligible_count}</b></p>"
            f"<p>الأعضاء المتأخرون عن سداد اشتراك {date.today().year}: "
            f"<b style='color:{unpaid_color}'>{unpaid_count}</b></p>"
            f"<p>الاجتماعات القادمة:</p><ul>{upcoming_lines}</ul>"
        )

    def _on_show_unpaid(self) -> None:
        unpaid = membership_service.list_unpaid_active_members(self.ctx.session)
        if not unpaid:
            QMessageBox.information(self, "المتأخرون عن السداد", "لا يوجد أعضاء متأخرون عن سداد الاشتراك لهذا العام.")
            return
        names = "\n".join(f"- {m.full_name}" for m in unpaid)
        QMessageBox.information(self, "المتأخرون عن السداد", f"عدد الأعضاء المتأخرين: {len(unpaid)}\n\n{names}")

MOHDALI_EOF

cat > app/ui/main_window.py << 'MOHDALI_EOF'
"""النافذة الرئيسية للتطبيق."""
from __future__ import annotations

from PySide6.QtCore import Qt
from PySide6.QtGui import QGuiApplication, QIcon
from PySide6.QtWidgets import QHBoxLayout, QLabel, QMainWindow, QMessageBox, QTabWidget, QVBoxLayout, QWidget

from app.auth.service import has_permission
from app.services import backup_service, board_service, bylaw_settings_service
from app.ui.app_context import AppContext
from app.ui.assembly.assembly_list_view import AssemblyListView
from app.ui.board.board_view import BoardView
from app.ui.common import load_logo_pixmap
from app.ui.dashboard_view import DashboardView
from app.ui.documents.documents_view import DocumentsView
from app.ui.members.members_view import MembersView
from app.ui.settings.settings_view import SettingsView

BOARD_TERM_ALERT_THRESHOLD_DAYS = 200


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

        self._check_board_term_alert()

    def _check_board_term_alert(self) -> None:
        term_end_date = bylaw_settings_service.get_settings(self.ctx.session).board_term_end_date
        if not board_service.term_alert_needed(term_end_date, threshold_days=BOARD_TERM_ALERT_THRESHOLD_DAYS):
            return
        status_text = board_service.term_status_text(term_end_date)
        QMessageBox.warning(self, "تنبيه: دورة مجلس الإدارة", status_text)

    def closeEvent(self, event) -> None:  # noqa: N802 - اسم الدالة مفروض من Qt
        try:
            self.ctx.session.commit()
            backup_service.run_auto_backup_if_due()
        except Exception:  # noqa: BLE001 - يجب ألا يمنع فشل النسخ الاحتياطي إغلاق البرنامج
            pass
        super().closeEvent(event)

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

cat > app/ui/settings/audit_log_tab.py << 'MOHDALI_EOF'
"""سجل تدقيق مرئي: من قام بأي إجراء ومتى."""
from __future__ import annotations

from PySide6.QtCore import Qt
from PySide6.QtWidgets import (
    QHBoxLayout,
    QHeaderView,
    QLineEdit,
    QPushButton,
    QTableWidget,
    QTableWidgetItem,
    QVBoxLayout,
    QWidget,
)

from app.services import audit
from app.ui.app_context import AppContext


class AuditLogTab(QWidget):
    def __init__(self, ctx: AppContext, parent=None):
        super().__init__(parent)
        self.ctx = ctx
        self.setLayoutDirection(Qt.LayoutDirection.RightToLeft)

        layout = QVBoxLayout(self)

        toolbar = QHBoxLayout()
        self.search_input = QLineEdit()
        self.search_input.setPlaceholderText("بحث بالإجراء أو الكيان أو التفاصيل...")
        self.search_input.textChanged.connect(self.refresh)
        toolbar.addWidget(self.search_input)
        refresh_btn = QPushButton("تحديث")
        refresh_btn.clicked.connect(self.refresh)
        toolbar.addWidget(refresh_btn)
        layout.addLayout(toolbar)

        self.table = QTableWidget(0, 5)
        self.table.setHorizontalHeaderLabels(["التاريخ والوقت", "المستخدم", "الإجراء", "الكيان", "التفاصيل"])
        self.table.horizontalHeader().setSectionResizeMode(4, QHeaderView.ResizeMode.Stretch)
        self.table.setEditTriggers(QTableWidget.EditTrigger.NoEditTriggers)
        self.table.setSelectionBehavior(QTableWidget.SelectionBehavior.SelectRows)
        layout.addWidget(self.table)

        self.refresh()

    def refresh(self) -> None:
        entries = audit.list_recent(self.ctx.session, search=self.search_input.text().strip() or None)
        self.table.setRowCount(0)
        for entry in entries:
            row = self.table.rowCount()
            self.table.insertRow(row)
            self.table.setItem(row, 0, QTableWidgetItem(entry.timestamp.strftime("%Y-%m-%d %H:%M:%S")))
            self.table.setItem(row, 1, QTableWidgetItem(entry.user.username if entry.user else "—"))
            self.table.setItem(row, 2, QTableWidgetItem(entry.action))
            entity_label = f"{entry.entity}#{entry.entity_id}" if entry.entity_id else entry.entity
            self.table.setItem(row, 3, QTableWidgetItem(entity_label))
            self.table.setItem(row, 4, QTableWidgetItem(entry.details or ""))
MOHDALI_EOF

cat > app/ui/settings/settings_view.py << 'MOHDALI_EOF'
"""شاشة الإعدادات: اللائحة الأساسية، المستخدمون، البريد الإلكتروني، النسخ الاحتياطي."""
from __future__ import annotations

from datetime import datetime

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
from app.services import backup_service, bylaw_settings_service, smtp_settings_service
from app.ui.app_context import AppContext
from app.ui.common import confirm, show_error, show_info
from app.ui.settings.audit_log_tab import AuditLogTab
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
            self.addTab(AuditLogTab(ctx), "سجل التدقيق")
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
            backup_service.create_backup(path)
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
            backup_service.restore_backup(path)
            show_info(self, "تم استيراد النسخة الاحتياطية. الرجاء إعادة تشغيل التطبيق الآن لتحميل البيانات المستعادة.")
        except Exception as exc:  # noqa: BLE001
            show_error(self, f"تعذر استعادة النسخة الاحتياطية: {exc}")
MOHDALI_EOF

cat > tests/test_backup_service.py << 'MOHDALI_EOF'
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
MOHDALI_EOF

cat > tests/test_board_service.py << 'MOHDALI_EOF'
from datetime import date, timedelta

from app.services import board_service, membership_service


def _make_member(db_session, admin_user, name: str) -> object:
    member = membership_service.submit_membership_request(
        db_session, admin_user, full_name=name, member_type="عادية", join_date=date(2015, 1, 1)
    )
    membership_service.approve_membership(db_session, admin_user, member)
    return member


def test_list_current_positions_orders_chairman_first_then_vice_then_rest(db_session, admin_user):
    member_c = _make_member(db_session, admin_user, "عضو ج")
    member_a = _make_member(db_session, admin_user, "عضو أ")
    member_vice = _make_member(db_session, admin_user, "نائب الرئيس")
    member_chair = _make_member(db_session, admin_user, "الرئيس")
    member_treasurer = _make_member(db_session, admin_user, "أمين الصندوق")

    board_service.assign_position(db_session, admin_user, member_c, title="عضو مجلس إدارة")
    board_service.assign_position(db_session, admin_user, member_a, title="عضو مجلس إدارة")
    board_service.assign_position(db_session, admin_user, member_treasurer, title="أمين الصندوق (المشرف المالي)")
    board_service.assign_position(db_session, admin_user, member_vice, title="نائب رئيس مجلس الإدارة")
    board_service.assign_position(db_session, admin_user, member_chair, title="رئيس مجلس الإدارة")

    positions = board_service.list_current_positions(db_session)
    titles_in_order = [p.title for p in positions]

    assert titles_in_order[0] == "رئيس مجلس الإدارة"
    assert titles_in_order[1] == "نائب رئيس مجلس الإدارة"
    assert titles_in_order[2] == "أمين الصندوق (المشرف المالي)"
    # بقية الأعضاء بعد الرتب الأساسية، مرتبة أبجديًا بالاسم
    assert titles_in_order[3:] == ["عضو مجلس إدارة", "عضو مجلس إدارة"]


def test_update_and_delete_position(db_session, admin_user):
    member = _make_member(db_session, admin_user, "عضو للتعديل")
    other_member = _make_member(db_session, admin_user, "عضو آخر")
    position = board_service.assign_position(db_session, admin_user, member, title="عضو مجلس إدارة")

    board_service.update_position(
        db_session, admin_user, position, other_member, title="أمين السر", start_date=date(2024, 1, 1)
    )
    assert position.member_id == other_member.id
    assert position.title == "أمين السر"

    position_id = position.id
    board_service.delete_position(db_session, admin_user, position)
    remaining = board_service.list_current_positions(db_session)
    assert position_id not in [p.id for p in remaining]


def test_term_status_text_counts_remaining_days():
    today = date(2026, 1, 1)
    future = today + timedelta(days=45)
    text = board_service.term_status_text(future.isoformat(), as_of=today)
    assert "متبقٍ 45 يوم" in text
    assert future.isoformat() in text


def test_term_status_text_flags_overdue_term():
    today = date(2026, 1, 1)
    past = today - timedelta(days=10)
    text = board_service.term_status_text(past.isoformat(), as_of=today)
    assert "انتهت دورة المجلس" in text
    assert "منذ 10 يوم" in text


def test_term_status_text_returns_none_when_unset():
    assert board_service.term_status_text("") is None


def test_term_alert_needed_true_when_within_threshold():
    today = date(2026, 1, 1)
    soon = today + timedelta(days=150)
    assert board_service.term_alert_needed(soon.isoformat(), threshold_days=200, as_of=today) is True


def test_term_alert_needed_false_when_far_away():
    today = date(2026, 1, 1)
    far = today + timedelta(days=300)
    assert board_service.term_alert_needed(far.isoformat(), threshold_days=200, as_of=today) is False


def test_term_alert_needed_true_when_overdue():
    today = date(2026, 1, 1)
    past = today - timedelta(days=5)
    assert board_service.term_alert_needed(past.isoformat(), threshold_days=200, as_of=today) is True


def test_term_alert_needed_false_when_unset():
    assert board_service.term_alert_needed("", threshold_days=200) is False
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
    # اللائحة الأساسية + المستخدمون + البريد الإلكتروني + سجل التدقيق + النسخ الاحتياطي
    assert view.count() >= 5


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


def test_audit_log_tab_builds_and_lists_entries(qapp, db_session, admin_user):
    ctx = _make_ctx(db_session, admin_user)
    _seed_sample_data(db_session, admin_user)
    from app.ui.settings.audit_log_tab import AuditLogTab

    view = AuditLogTab(ctx)
    assert view.table.rowCount() > 0

MOHDALI_EOF

echo "تم تحديث جميع الملفات بنجاح"
