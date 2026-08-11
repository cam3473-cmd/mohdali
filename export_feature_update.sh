mkdir -p app/services tests app/ui/members

cat > app/services/export_service.py << 'MOHDALI_EOF'
"""تصدير بيانات الأعضاء إلى ملف Excel.

يستخدم نفس عناوين الأعمدة التي تتعرف عليها أداة الاستيراد (import_service)،
بحيث يمكن تعديل الملف الناتج وإعادة استيراده لاحقًا دون أي تحويل إضافي.
"""
from __future__ import annotations

import datetime as dt

import openpyxl
from openpyxl.styles import Font
from sqlalchemy.orm import Session

from app.db.models import BoardPosition, FeeStatus, Member, MemberStatus, MembershipFee

EXPORT_HEADERS = [
    "م",
    "الاسم",
    "رقم عضوية",
    "تاريخ بدء العضوية",
    "نوع العضوية",
    "المنصب الحالي",
    "السداد",
    "قيمة الاشتراك",
    "فعال",
    "رقم السند",
    "السجل",
    "تاريخ الميلاد",
    "الجوال",
    "الجنس",
    "المؤهل",
    "المدينة",
    "العمل",
    "الحالة",
]

STATUS_LABELS_AR = {
    MemberStatus.ACTIVE: "نشط",
    MemberStatus.SUSPENDED: "موقوف",
    MemberStatus.WITHDRAWN: "منسحب",
    MemberStatus.REJECTED: "مرفوض",
    MemberStatus.PENDING: "طلب معلّق",
}


def export_members_to_excel(
    session: Session, members: list[Member], output_path: str, fee_year: int | None = None
) -> None:
    fee_year = fee_year or dt.date.today().year

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "الأعضاء"
    ws.sheet_view.rightToLeft = True
    ws.append(EXPORT_HEADERS)
    for cell in ws[1]:
        cell.font = Font(bold=True)

    for index, member in enumerate(members, start=1):
        position = (
            session.query(BoardPosition)
            .filter(BoardPosition.member_id == member.id, BoardPosition.end_date.is_(None))
            .first()
        )
        fee = (
            session.query(MembershipFee)
            .filter(MembershipFee.member_id == member.id, MembershipFee.fee_year == fee_year)
            .first()
        )
        fee_paid = fee is not None and fee.status in (FeeStatus.PAID, FeeStatus.WAIVED)

        ws.append(
            [
                index,
                member.full_name,
                member.membership_number or "",
                member.join_date.isoformat() if member.join_date else "",
                member.member_type,
                position.title if position else "",
                "منتظم" if fee_paid else "غير منتظم",
                fee.amount if fee else "",
                "نعم" if member.status == MemberStatus.ACTIVE else "لا",
                fee.receipt_number if fee else "",
                member.national_id_or_cr or "",
                member.birth_date.isoformat() if member.birth_date else "",
                member.phone or "",
                member.gender or "",
                member.qualification or "",
                member.city or "",
                member.occupation or "",
                STATUS_LABELS_AR.get(member.status, member.status.value),
            ]
        )

    for column_cells in ws.columns:
        length = max(len(str(cell.value)) if cell.value is not None else 0 for cell in column_cells)
        ws.column_dimensions[column_cells[0].column_letter].width = min(max(length + 2, 10), 40)

    wb.save(output_path)
MOHDALI_EOF

cat > tests/test_export_service.py << 'MOHDALI_EOF'
from datetime import date

import openpyxl

from app.services import board_service, export_service, import_service, membership_service


def test_export_members_to_excel_writes_expected_data(db_session, admin_user, tmp_path):
    member = membership_service.submit_membership_request(
        db_session,
        admin_user,
        full_name="عضو للتصدير",
        member_type="عادية",
        membership_number="9",
        national_id_or_cr="1046952857",
        join_date=date(2020, 1, 1),
        birth_date=date(1980, 5, 1),
        phone="500000000",
        gender="ذكر",
        qualification="جامعي",
        city="السليل",
        occupation="موظف",
    )
    membership_service.approve_membership(db_session, admin_user, member)
    membership_service.record_fee_payment(db_session, admin_user, member, fee_year=date.today().year, amount=300)
    board_service.assign_position(db_session, admin_user, member, title="أمين الصندوق")

    output_path = str(tmp_path / "export.xlsx")
    export_service.export_members_to_excel(db_session, [member], output_path)

    wb = openpyxl.load_workbook(output_path)
    ws = wb.active
    header = [cell.value for cell in ws[1]]
    assert header == export_service.EXPORT_HEADERS
    row = [cell.value for cell in ws[2]]
    data = dict(zip(header, row))
    assert data["الاسم"] == "عضو للتصدير"
    assert data["السجل"] == "1046952857"
    assert data["المنصب الحالي"] == "أمين الصندوق"
    assert data["السداد"] == "منتظم"
    assert data["فعال"] == "نعم"


def test_export_then_reimport_round_trip(db_session, admin_user, tmp_path):
    member = membership_service.submit_membership_request(
        db_session,
        admin_user,
        full_name="عضو الجولة الكاملة",
        member_type="عادية",
        membership_number="10",
        national_id_or_cr="1099999999",
        join_date=date(2019, 3, 15),
    )
    membership_service.approve_membership(db_session, admin_user, member)

    output_path = str(tmp_path / "roundtrip.xlsx")
    export_service.export_members_to_excel(db_session, [member], output_path)

    report = import_service.import_members_from_excel(db_session, admin_user, output_path)
    assert report.created == 0
    assert report.updated == 1
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
        for btn in (self.edit_btn, self.approve_btn, self.reject_btn, self.suspend_btn, self.withdraw_btn, self.fee_btn):
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

echo "تم تحديث الملفات الثلاثة بنجاح"
