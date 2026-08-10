"""شاشة إدارة الأعضاء."""
from __future__ import annotations

from PySide6.QtCore import Qt
from PySide6.QtWidgets import (
    QComboBox,
    QDialog,
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
from app.services import import_service, membership_service
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

        toolbar.addWidget(self.search_input)
        toolbar.addWidget(self.status_filter)
        toolbar.addStretch()
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
        for btn in (self.edit_btn, self.approve_btn, self.reject_btn, self.suspend_btn, self.withdraw_btn, self.fee_btn):
            btn.setEnabled(self._can_manage)
            actions.addWidget(btn)
        layout.addLayout(actions)

        self.edit_btn.clicked.connect(self._on_edit)
        self.approve_btn.clicked.connect(self._on_approve)
        self.reject_btn.clicked.connect(self._on_reject)
        self.suspend_btn.clicked.connect(self._on_suspend)
        self.withdraw_btn.clicked.connect(self._on_withdraw)
        self.fee_btn.clicked.connect(self._on_record_fee)

        self.refresh()

    def _selected_member(self) -> Member | None:
        row = self.table.currentRow()
        if row < 0:
            return None
        member_id = self.table.item(row, 0).data(Qt.ItemDataRole.UserRole)
        return self.ctx.session.get(Member, member_id)

    def refresh(self) -> None:
        status_label = self.status_filter.currentText()
        status = None
        if status_label != "الكل":
            status = next(s for s, label in STATUS_LABELS.items() if label == status_label)
        members = membership_service.list_members(self.ctx.session, status=status, search=self.search_input.text().strip() or None)

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
        return sorted(types) or ["مؤسس", "عامل", "منتسب", "شرف"]

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

