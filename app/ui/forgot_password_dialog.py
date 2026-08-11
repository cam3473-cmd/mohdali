"""نافذة استعادة كلمة المرور عبر رمز تحقق يُرسل بالبريد الإلكتروني."""
from __future__ import annotations

from PySide6.QtCore import Qt
from PySide6.QtWidgets import QDialog, QFormLayout, QLabel, QLineEdit, QPushButton, QVBoxLayout

from app.services import password_reset_service
from app.ui.common import show_error, show_info


class ForgotPasswordDialog(QDialog):
    def __init__(self, session, parent=None):
        super().__init__(parent)
        self.session = session
        self.setWindowTitle("استعادة كلمة المرور")
        self.setLayoutDirection(Qt.LayoutDirection.RightToLeft)
        self.setMinimumWidth(380)

        layout = QVBoxLayout(self)
        layout.addWidget(QLabel("أدخل اسم المستخدم لإرسال رمز تحقق إلى بريده الإلكتروني المسجَّل."))

        form = QFormLayout()
        self.username_input = QLineEdit()
        form.addRow("اسم المستخدم:", self.username_input)
        layout.addLayout(form)

        self.send_code_btn = QPushButton("إرسال رمز التحقق")
        self.send_code_btn.clicked.connect(self._on_send_code)
        layout.addWidget(self.send_code_btn)

        self.step2_label = QLabel("أدخل رمز التحقق الذي وصلك بالبريد وكلمة المرور الجديدة.")
        self.step2_label.setVisible(False)
        layout.addWidget(self.step2_label)

        self.step2_form = QFormLayout()
        self.code_input = QLineEdit()
        self.new_password_input = QLineEdit()
        self.new_password_input.setEchoMode(QLineEdit.EchoMode.Password)
        self.confirm_password_input = QLineEdit()
        self.confirm_password_input.setEchoMode(QLineEdit.EchoMode.Password)
        self.step2_form.addRow("رمز التحقق:", self.code_input)
        self.step2_form.addRow("كلمة المرور الجديدة:", self.new_password_input)
        self.step2_form.addRow("تأكيد كلمة المرور:", self.confirm_password_input)
        layout.addLayout(self.step2_form)
        self._set_step2_visible(False)

        self.confirm_btn = QPushButton("تعيين كلمة المرور")
        self.confirm_btn.setVisible(False)
        self.confirm_btn.clicked.connect(self._on_confirm)
        layout.addWidget(self.confirm_btn)

    def _set_step2_visible(self, visible: bool) -> None:
        self.step2_label.setVisible(visible)
        for i in range(self.step2_form.rowCount()):
            self.step2_form.itemAt(i, QFormLayout.ItemRole.LabelRole).widget().setVisible(visible)
            self.step2_form.itemAt(i, QFormLayout.ItemRole.FieldRole).widget().setVisible(visible)

    def _on_send_code(self) -> None:
        username = self.username_input.text().strip()
        if not username:
            show_error(self, "الرجاء إدخال اسم المستخدم")
            return
        try:
            password_reset_service.request_reset(self.session, username)
        except password_reset_service.PasswordResetError as exc:
            show_error(self, str(exc))
            return
        show_info(self, "تم إرسال رمز التحقق إلى البريد الإلكتروني المسجَّل. صالح لمدة 15 دقيقة.")
        self.username_input.setEnabled(False)
        self.send_code_btn.setEnabled(False)
        self._set_step2_visible(True)
        self.confirm_btn.setVisible(True)

    def _on_confirm(self) -> None:
        code = self.code_input.text().strip()
        new_password = self.new_password_input.text()
        confirm_password = self.confirm_password_input.text()
        if len(new_password) < 6:
            show_error(self, "يجب ألا تقل كلمة المرور عن 6 أحرف")
            return
        if new_password != confirm_password:
            show_error(self, "كلمتا المرور غير متطابقتين")
            return
        try:
            password_reset_service.confirm_reset(self.session, self.username_input.text().strip(), code, new_password)
        except password_reset_service.PasswordResetError as exc:
            show_error(self, str(exc))
            return
        show_info(self, "تم تعيين كلمة المرور الجديدة بنجاح. يمكنك الآن تسجيل الدخول بها.")
        self.accept()
