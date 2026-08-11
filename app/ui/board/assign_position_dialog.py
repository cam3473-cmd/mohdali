"""نموذج تعيين منصب في مجلس الإدارة."""
from __future__ import annotations

from datetime import date

from PySide6.QtCore import QDate, Qt
from PySide6.QtWidgets import QComboBox, QDateEdit, QDialog, QDialogButtonBox, QFormLayout, QVBoxLayout

from app.db.models import BoardPosition, Member

COMMON_TITLES = [
    "رئيس مجلس الإدارة",
    "نائب الرئيس",
    "أمين الصندوق (المشرف المالي)",
    "أمين السر",
    "عضو مجلس إدارة",
]


class AssignPositionDialog(QDialog):
    def __init__(self, parent, members: list[Member], position: BoardPosition | None = None):
        super().__init__(parent)
        self._editing = position is not None
        self.setWindowTitle("تعديل منصب" if self._editing else "تعيين منصب في مجلس الإدارة")
        self.setLayoutDirection(Qt.LayoutDirection.RightToLeft)
        self.setMinimumWidth(380)

        layout = QVBoxLayout(self)
        form = QFormLayout()

        self.member_combo = QComboBox()
        for m in members:
            self.member_combo.addItem(m.full_name, m.id)

        self.title_combo = QComboBox()
        self.title_combo.setEditable(True)
        self.title_combo.addItems(COMMON_TITLES)

        self.start_date = QDateEdit(calendarPopup=True)
        self.start_date.setDisplayFormat("yyyy-MM-dd")
        today = date.today()
        self.start_date.setDate(QDate(today.year, today.month, today.day))

        if position is not None:
            index = self.member_combo.findData(position.member_id)
            if index >= 0:
                self.member_combo.setCurrentIndex(index)
            self.title_combo.setCurrentText(position.title)
            if position.start_date:
                self.start_date.setDate(QDate(position.start_date.year, position.start_date.month, position.start_date.day))

        form.addRow("العضو:*", self.member_combo)
        form.addRow("المنصب:*", self.title_combo)
        form.addRow("تاريخ التعيين:", self.start_date)
        layout.addLayout(form)

        buttons = QDialogButtonBox(QDialogButtonBox.StandardButton.Ok | QDialogButtonBox.StandardButton.Cancel)
        buttons.button(QDialogButtonBox.StandardButton.Ok).setText("حفظ" if self._editing else "تعيين")
        buttons.button(QDialogButtonBox.StandardButton.Cancel).setText("إلغاء")
        buttons.accepted.connect(self._on_accept)
        buttons.rejected.connect(self.reject)
        layout.addWidget(buttons)

        self.values: dict | None = None

    def _on_accept(self) -> None:
        if self.member_combo.count() == 0 or not self.title_combo.currentText().strip():
            return
        qd = self.start_date.date()
        self.values = {
            "member_id": self.member_combo.currentData(),
            "title": self.title_combo.currentText().strip(),
            "start_date": date(qd.year(), qd.month(), qd.day()),
        }
        self.accept()
