"""شاشة تسجيل الدخول."""
from __future__ import annotations

from PySide6.QtCore import Qt
from PySide6.QtWidgets import QDialog, QFormLayout, QLabel, QLineEdit, QPushButton, QVBoxLayout

from app.auth.service import AccountInactive, AuthService, InvalidCredentials
from app.db.models import User
from app.ui.common import ChangePasswordDialog, show_error


class LoginDialog(QDialog):
    def __init__(self, auth: AuthService, parent=None):
        super().__init__(parent)
        self.auth = auth
        self.setWindowTitle("تسجيل الدخول — نظام عضوية الجمعية العمومية")
        self.setLayoutDirection(Qt.LayoutDirection.RightToLeft)
        self.setModal(True)
        self.setMinimumWidth(360)

        layout = QVBoxLayout(self)
        layout.addWidget(QLabel("<h2>جمعية البر الخيرية بمحافظة السليل</h2>"))

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

        self.authenticated_user: User | None = None

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

