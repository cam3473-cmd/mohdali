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
        self.password = QLineEdit()
        self.password.setEchoMode(QLineEdit.EchoMode.Password)
        self.role = QComboBox()
        for role, label in ROLE_LABELS.items():
            self.role.addItem(label, role)

        form.addRow("اسم المستخدم:*", self.username)
        form.addRow("الاسم الكامل:*", self.full_name)
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
            "password": self.password.text(),
            "role": self.role.currentData(),
        }
        self.accept()

