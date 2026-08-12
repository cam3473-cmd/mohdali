"""نموذج إنشاء اجتماع جمعية عمومية جديد."""
from __future__ import annotations

from datetime import date

from PySide6.QtCore import QDate, Qt
from PySide6.QtWidgets import QComboBox, QDateEdit, QDialog, QDialogButtonBox, QFormLayout, QLineEdit, QTextEdit, QVBoxLayout

from app.db.models import AssemblyType

TYPE_LABELS = {AssemblyType.ORDINARY: "عادية", AssemblyType.EXTRAORDINARY: "غير عادية"}


class AssemblyFormDialog(QDialog):
    def __init__(self, parent=None):
        super().__init__(parent)
        self.setWindowTitle("إنشاء اجتماع جمعية عمومية")
        self.setLayoutDirection(Qt.LayoutDirection.RightToLeft)
        self.setMinimumWidth(400)

        layout = QVBoxLayout(self)
        form = QFormLayout()

        self.title_input = QLineEdit()
        self.type_input = QComboBox()
        for t, label in TYPE_LABELS.items():
            self.type_input.addItem(label, t)
        self.meeting_date = QDateEdit(calendarPopup=True)
        self.meeting_date.setDisplayFormat("yyyy-MM-dd")
        today = date.today()
        self.meeting_date.setDate(QDate(today.year, today.month, today.day))
        self.location = QLineEdit()
        self.notes = QTextEdit()
        self.notes.setFixedHeight(60)

        form.addRow("عنوان الاجتماع:*", self.title_input)
        form.addRow("النوع:", self.type_input)
        form.addRow("تاريخ الاجتماع:*", self.meeting_date)
        form.addRow("المكان:", self.location)
        form.addRow("ملاحظات:", self.notes)
        layout.addLayout(form)

        buttons = QDialogButtonBox(QDialogButtonBox.StandardButton.Ok | QDialogButtonBox.StandardButton.Cancel)
        buttons.button(QDialogButtonBox.StandardButton.Ok).setText("إنشاء")
        buttons.button(QDialogButtonBox.StandardButton.Cancel).setText("إلغاء")
        buttons.accepted.connect(self._on_accept)
        buttons.rejected.connect(self.reject)
        layout.addWidget(buttons)

        self.values: dict | None = None

    def _on_accept(self) -> None:
        if not self.title_input.text().strip():
            self.title_input.setFocus()
            return
        qd = self.meeting_date.date()
        self.values = {
            "title": self.title_input.text().strip(),
            "type": self.type_input.currentData(),
            "meeting_date": date(qd.year(), qd.month(), qd.day()),
            "location": self.location.text().strip() or None,
            "notes": self.notes.toPlainText().strip() or None,
        }
        self.accept()

