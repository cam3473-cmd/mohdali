"""شاشة تسجيل الدخول."""
from __future__ import annotations

from PySide6.QtCore import Qt
from PySide6.QtWidgets import QDialog, QFormLayout, QLabel, QLineEdit, QPushButton, QVBoxLayout

from app.auth.service import AccountInactive, AuthService, InvalidCredentials
from app.db.models import User
from app.ui.common import ChangePasswordDialog, load_logo_pixmap, show_error
from app.ui.forgot_password_dialog import ForgotPasswordDialog


class LoginDialog(QDialog):
    def __init__(self, auth: AuthService, parent=None):
        super().__init__(parent)
        self.auth = auth
        self.setWindowTitle("تسجيل الدخول — نظام عضوية الجمعية العمومية")
        self.setLayoutDirection(Qt.LayoutDirection.RightToLeft)
        self.setModal(True)
        self.setMinimumWidth(360)

        layout = QVBoxLayout(self)

        logo_pixmap = load_logo_pixmap(max_height=90)
        if logo_pixmap is not None:
            logo_label = QLabel()
            logo_label.setPixmap(logo_pixmap)
            logo_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
            layout.addWidget(logo_label)

        title_label = QLabel("<h2>جمعية البر الخيرية بمحافظة السليل</h2>")
        title_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        layout.addWidget(title_label)

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

        forgot_btn = QPushButton("نسيت كلمة المرور؟")
        forgot_btn.setFlat(True)
        forgot_btn.clicked.connect(self._on_forgot_password)
        layout.addWidget(forgot_btn)

        self.authenticated_user: User | None = None

    def _on_forgot_password(self) -> None:
        dialog = ForgotPasswordDialog(self.auth.session, self)
        dialog.exec()

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

