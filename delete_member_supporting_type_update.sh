mkdir -p app/services app/ui/members tests

cat > app/services/membership_service.py << 'MOHDALI_EOF'
"""إدارة طلبات العضوية والأعضاء والاشتراكات."""
from __future__ import annotations

from datetime import date

from sqlalchemy.orm import Session

from app.db.models import AssemblyAttendance, FeeStatus, Member, MemberStatus, MembershipFee, User
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

cat > app/ui/members/members_view.py << 'MOHDALI_EOF'
"""شاشة إدارة الأعضاء."""
from __future__ import annotations

from PySide6.QtCore import Qt
from PySide6.QtWidgets import (
    QComboBox,
    QDialog,
    QFileDialog,
    QHBoxLayout,
    QHeaderView,
    QLineEdit,
    QPushButton,
    QTableWidget,
    QTableWidgetItem,
    QVBoxLayout,
    QWidget,
)

from app.auth.service import has_permission
from app.db.models import Member, MemberStatus
from app.services import export_service, import_service, membership_service
from app.ui.app_context import AppContext
from app.ui.common import confirm, show_error, show_info
from app.ui.members.fee_payment_dialog import FeePaymentDialog
from app.ui.members.import_dialog import ImportDialog
from app.ui.members.member_form_dialog import MemberFormDialog

STATUS_LABELS = {
    MemberStatus.ACTIVE: "نشط",
    MemberStatus.SUSPENDED: "موقوف",
    MemberStatus.WITHDRAWN: "منسحب",
    MemberStatus.REJECTED: "مرفوض",
    MemberStatus.PENDING: "طلب معلّق",
}
STATUS_FILTERS = ["الكل"] + list(STATUS_LABELS.values())
STANDARD_MEMBER_TYPES = ["مؤسس", "عامل", "منتسب", "شرف", "داعم"]


class MembersView(QWidget):
    def __init__(self, ctx: AppContext, parent=None):
        super().__init__(parent)
        self.ctx = ctx
        self.setLayoutDirection(Qt.LayoutDirection.RightToLeft)

        self._can_manage = has_permission(ctx.current_user, "members.manage")

        layout = QVBoxLayout(self)

        toolbar = QHBoxLayout()
        self.search_input = QLineEdit()
        self.search_input.setPlaceholderText("بحث بالاسم...")
        self.search_input.textChanged.connect(self.refresh)
        self.status_filter = QComboBox()
        self.status_filter.addItems(STATUS_FILTERS)
        self.status_filter.currentIndexChanged.connect(self.refresh)
        add_btn = QPushButton("إضافة عضو")
        add_btn.setEnabled(self._can_manage)
        add_btn.clicked.connect(self._on_add)

        import_btn = QPushButton("استيراد من Excel")
        import_btn.setEnabled(self._can_manage)
        import_btn.clicked.connect(self._on_import)

        export_btn = QPushButton("تصدير إلى Excel")
        export_btn.clicked.connect(self._on_export)

        toolbar.addWidget(self.search_input)
        toolbar.addWidget(self.status_filter)
        toolbar.addStretch()
        toolbar.addWidget(export_btn)
        toolbar.addWidget(import_btn)
        toolbar.addWidget(add_btn)
        layout.addLayout(toolbar)

        self.table = QTableWidget(0, 6)
        self.table.setHorizontalHeaderLabels(["الاسم", "نوع العضوية", "الحالة", "تاريخ الانضمام", "الجوال", "مؤسس"])
        self.table.horizontalHeader().setSectionResizeMode(0, QHeaderView.ResizeMode.Stretch)
        self.table.setSelectionBehavior(QTableWidget.SelectionBehavior.SelectRows)
        self.table.setEditTriggers(QTableWidget.EditTrigger.NoEditTriggers)
        layout.addWidget(self.table)

        actions = QHBoxLayout()
        self.edit_btn = QPushButton("تعديل")
        self.approve_btn = QPushButton("قبول الطلب")
        self.reject_btn = QPushButton("رفض الطلب")
        self.suspend_btn = QPushButton("إيقاف العضوية")
        self.withdraw_btn = QPushButton("تسجيل انسحاب")
        self.fee_btn = QPushButton("تسجيل سداد اشتراك")
        self.delete_btn = QPushButton("حذف")
        for btn in (
            self.edit_btn,
            self.approve_btn,
            self.reject_btn,
            self.suspend_btn,
            self.withdraw_btn,
            self.fee_btn,
            self.delete_btn,
        ):
            btn.setEnabled(self._can_manage)
            actions.addWidget(btn)
        self.cards_btn = QPushButton("طباعة بطاقة العضوية")
        actions.addWidget(self.cards_btn)
        layout.addLayout(actions)

        self.edit_btn.clicked.connect(self._on_edit)
        self.approve_btn.clicked.connect(self._on_approve)
        self.reject_btn.clicked.connect(self._on_reject)
        self.suspend_btn.clicked.connect(self._on_suspend)
        self.withdraw_btn.clicked.connect(self._on_withdraw)
        self.fee_btn.clicked.connect(self._on_record_fee)
        self.delete_btn.clicked.connect(self._on_delete)
        self.cards_btn.clicked.connect(self._on_print_cards)

        self.refresh()

    def _selected_member(self) -> Member | None:
        row = self.table.currentRow()
        if row < 0:
            return None
        member_id = self.table.item(row, 0).data(Qt.ItemDataRole.UserRole)
        return self.ctx.session.get(Member, member_id)

    def _filtered_members(self) -> list[Member]:
        status_label = self.status_filter.currentText()
        status = None
        if status_label != "الكل":
            status = next(s for s, label in STATUS_LABELS.items() if label == status_label)
        return membership_service.list_members(self.ctx.session, status=status, search=self.search_input.text().strip() or None)

    def refresh(self) -> None:
        members = self._filtered_members()

        self.table.setRowCount(0)
        for member in members:
            row = self.table.rowCount()
            self.table.insertRow(row)
            name_item = QTableWidgetItem(member.full_name)
            name_item.setData(Qt.ItemDataRole.UserRole, member.id)
            self.table.setItem(row, 0, name_item)
            self.table.setItem(row, 1, QTableWidgetItem(member.member_type))
            self.table.setItem(row, 2, QTableWidgetItem(STATUS_LABELS.get(member.status, member.status.value)))
            self.table.setItem(row, 3, QTableWidgetItem(member.join_date.isoformat()))
            self.table.setItem(row, 4, QTableWidgetItem(member.phone or ""))
            self.table.setItem(row, 5, QTableWidgetItem("نعم" if member.is_founder else "لا"))

    def _existing_member_types(self) -> list[str]:
        types = {m.member_type for m in membership_service.list_members(self.ctx.session)}
        return sorted(types | set(STANDARD_MEMBER_TYPES))

    def _on_add(self) -> None:
        dialog = MemberFormDialog(self, member_types=self._existing_member_types())
        if dialog.exec() == QDialog.DialogCode.Accepted and dialog.values:
            membership_service.submit_membership_request(self.ctx.session, self.ctx.current_user, **dialog.values)
            self.refresh()

    def _on_edit(self) -> None:
        member = self._selected_member()
        if member is None:
            return
        dialog = MemberFormDialog(self, member=member, member_types=self._existing_member_types())
        if dialog.exec() == QDialog.DialogCode.Accepted and dialog.values:
            membership_service.update_member(self.ctx.session, self.ctx.current_user, member, **dialog.values)
            self.refresh()

    def _on_approve(self) -> None:
        member = self._selected_member()
        if member is None:
            return
        try:
            membership_service.approve_membership(self.ctx.session, self.ctx.current_user, member)
            self.refresh()
        except membership_service.MembershipError as exc:
            show_error(self, str(exc))

    def _on_reject(self) -> None:
        member = self._selected_member()
        if member is None:
            return
        if not confirm(self, f"هل تريد رفض طلب عضوية {member.full_name}؟"):
            return
        try:
            membership_service.reject_membership(self.ctx.session, self.ctx.current_user, member, reason="قرار إداري")
            self.refresh()
        except membership_service.MembershipError as exc:
            show_error(self, str(exc))

    def _on_suspend(self) -> None:
        member = self._selected_member()
        if member is None:
            return
        if not confirm(self, f"هل تريد إيقاف عضوية {member.full_name}؟"):
            return
        membership_service.suspend_membership(self.ctx.session, self.ctx.current_user, member, reason="قرار إداري")
        self.refresh()

    def _on_withdraw(self) -> None:
        member = self._selected_member()
        if member is None:
            return
        if not confirm(self, f"هل تريد تسجيل انسحاب {member.full_name}؟"):
            return
        membership_service.withdraw_membership(self.ctx.session, self.ctx.current_user, member)
        self.refresh()

    def _on_delete(self) -> None:
        member = self._selected_member()
        if member is None:
            return
        if not confirm(
            self,
            f"هل تريد حذف العضو \"{member.full_name}\" نهائيًا من النظام؟\n"
            "هذا الإجراء لا يمكن التراجع عنه. يُستخدم لتصحيح تكرار ناتج عن استيراد بيانات، وليس لعضو له سجل حضور فعلي.",
        ):
            return
        try:
            membership_service.delete_member(self.ctx.session, self.ctx.current_user, member)
            self.refresh()
        except membership_service.MembershipError as exc:
            show_error(self, str(exc))

    def _on_record_fee(self) -> None:
        member = self._selected_member()
        if member is None:
            return
        dialog = FeePaymentDialog(self)
        if dialog.exec() == QDialog.DialogCode.Accepted and dialog.values:
            membership_service.record_fee_payment(self.ctx.session, self.ctx.current_user, member, **dialog.values)
            show_info(self, "تم تسجيل السداد بنجاح")

    def _on_import(self) -> None:
        dialog = ImportDialog(self)
        if dialog.exec() != QDialog.DialogCode.Accepted or not dialog.values:
            return
        try:
            report = import_service.import_members_from_excel(self.ctx.session, self.ctx.current_user, **dialog.values)
        except Exception as exc:  # noqa: BLE001
            show_error(self, f"تعذر الاستيراد: {exc}")
            return

        message = f"تم الاستيراد: {report.created} عضو جديد، {report.updated} عضو محدَّث."
        if report.warnings:
            message += "\n\nتنبيهات:\n" + "\n".join(f"- {w}" for w in report.warnings)
        if report.skipped:
            message += "\n\nسطور تم تجاوزها:\n" + "\n".join(f"- {s}" for s in report.skipped)
        show_info(self, message, title="نتيجة الاستيراد")
        self.refresh()

    def _on_export(self) -> None:
        members = self._filtered_members()
        if not members:
            show_error(self, "لا يوجد أعضاء لتصديرهم وفق الفلتر الحالي")
            return
        path, _ = QFileDialog.getSaveFileName(self, "تصدير بيانات الأعضاء", "بيانات-الأعضاء.xlsx", "Excel (*.xlsx)")
        if not path:
            return
        try:
            export_service.export_members_to_excel(self.ctx.session, members, path)
            show_info(self, f"تم تصدير {len(members)} عضوًا إلى: {path}")
        except Exception as exc:  # noqa: BLE001
            show_error(self, f"تعذر تصدير البيانات: {exc}")

    def _on_print_cards(self) -> None:
        from app.reports.pdf_export import generate_membership_cards

        member = self._selected_member()
        if member is not None:
            members = [member]
            default_name = f"بطاقة-عضوية-{member.full_name}.pdf"
        else:
            members = membership_service.list_members(self.ctx.session, status=MemberStatus.ACTIVE)
            if not members:
                show_error(self, "لا يوجد أعضاء نشطون لطباعة بطاقاتهم")
                return
            default_name = "بطاقات-العضوية.pdf"

        path, _ = QFileDialog.getSaveFileName(self, "حفظ بطاقة/بطاقات العضوية", default_name, "PDF (*.pdf)")
        if not path:
            return
        try:
            generate_membership_cards(self.ctx.session, members, path)
            show_info(self, f"تم حفظ البطاقات في: {path}")
        except Exception as exc:  # noqa: BLE001
            show_error(self, f"تعذر توليد البطاقات: {exc}")

MOHDALI_EOF

cat > tests/test_membership_service.py << 'MOHDALI_EOF'
from datetime import date

import pytest

from app.db.models import AssemblyType, MemberStatus
from app.services import assembly_service, membership_service


def test_submit_and_approve_membership(db_session, admin_user):
    member = membership_service.submit_membership_request(
        db_session, admin_user, full_name="أحمد علي", member_type="عامل", join_date=date.today()
    )
    assert member.status == MemberStatus.PENDING

    membership_service.approve_membership(db_session, admin_user, member)
    assert member.status == MemberStatus.ACTIVE


def test_cannot_approve_already_active_member(db_session, admin_user):
    member = membership_service.submit_membership_request(
        db_session, admin_user, full_name="سعيد محمد", member_type="عامل", join_date=date.today()
    )
    membership_service.approve_membership(db_session, admin_user, member)
    with pytest.raises(membership_service.MembershipError):
        membership_service.approve_membership(db_session, admin_user, member)


def test_reject_membership_records_reason(db_session, admin_user):
    member = membership_service.submit_membership_request(
        db_session, admin_user, full_name="خالد سالم", member_type="عامل", join_date=date.today()
    )
    membership_service.reject_membership(db_session, admin_user, member, reason="عدم استيفاء الشروط")
    assert member.status == MemberStatus.REJECTED
    assert "عدم استيفاء الشروط" in member.notes


def test_record_fee_payment_updates_status(db_session, admin_user):
    member = membership_service.submit_membership_request(
        db_session, admin_user, full_name="منى فهد", member_type="عامل", join_date=date.today()
    )
    membership_service.approve_membership(db_session, admin_user, member)
    fee = membership_service.record_fee_payment(
        db_session, admin_user, member, fee_year=date.today().year, amount=150
    )
    assert fee.status.value == "paid"
    assert fee.amount == 150


def test_delete_member_removes_duplicate_without_history(db_session, admin_user):
    member = membership_service.submit_membership_request(
        db_session, admin_user, full_name="نسخة مكررة", member_type="عامل", join_date=date.today()
    )
    membership_service.approve_membership(db_session, admin_user, member)
    membership_service.record_fee_payment(db_session, admin_user, member, fee_year=date.today().year, amount=100)
    member_id = member.id

    membership_service.delete_member(db_session, admin_user, member)

    assert db_session.get(type(member), member_id) is None


def test_delete_member_blocked_when_has_assembly_attendance(db_session, admin_user):
    join_date = date.today().replace(year=date.today().year - 1)
    member = membership_service.submit_membership_request(
        db_session, admin_user, full_name="عضو له سجل حضور", member_type="عامل", join_date=join_date
    )
    membership_service.approve_membership(db_session, admin_user, member)
    membership_service.record_fee_payment(db_session, admin_user, member, fee_year=date.today().year, amount=100)

    assembly = assembly_service.create_assembly(
        db_session, admin_user, title="اجتماع اختبار الحذف", type=AssemblyType.ORDINARY, meeting_date=date.today()
    )
    assembly_service.open_assembly(db_session, admin_user, assembly)
    assembly_service.check_in_member(db_session, admin_user, assembly, member)

    with pytest.raises(membership_service.MembershipError, match="سجل حضور"):
        membership_service.delete_member(db_session, admin_user, member)

MOHDALI_EOF

echo "تم تحديث الملفات بنجاح"
