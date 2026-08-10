"""عناصر واجهة مشتركة."""
from __future__ import annotations

from pathlib import Path

from PySide6.QtCore import Qt
from PySide6.QtGui import QPixmap
from PySide6.QtWidgets import QDialog, QFormLayout, QLineEdit, QMessageBox, QPushButton, QVBoxLayout

IMAGES_DIR = Path(__file__).resolve().parent.parent / "resources" / "images"


def load_logo_pixmap(max_height: int = 80) -> QPixmap | None:
    """يحمّل شعار الجمعية إن وُجد ملفه في app/resources/images/logo.(png|jpg|jpeg)."""
    for name in ("logo.png", "logo.jpg", "logo.jpeg"):
        path = IMAGES_DIR / name
        if path.exists():
            pixmap = QPixmap(str(path))
            if not pixmap.isNull():
                return pixmap.scaledToHeight(max_height, Qt.TransformationMode.SmoothTransformation)
    return None


def show_error(parent, message: str, title: str = "خطأ") -> None:
    QMessageBox.critical(parent, title, message)


def show_info(parent, message: str, title: str = "تنبيه") -> None:
    QMessageBox.information(parent, title, message)


def confirm(parent, message: str, title: str = "تأكيد") -> bool:
    return QMessageBox.question(parent, title, message) == QMessageBox.StandardButton.Yes


class ChangePasswordDialog(QDialog):
    def __init__(self, parent=None, mandatory: bool = False):
        super().__init__(parent)
        self.setWindowTitle("تغيير كلمة المرور")
        self.setModal(True)

        layout = QVBoxLayout(self)
        form = QFormLayout()

        self.new_password = QLineEdit()
        self.new_password.setEchoMode(QLineEdit.EchoMode.Password)
        self.confirm_password = QLineEdit()
        self.confirm_password.setEchoMode(QLineEdit.EchoMode.Password)

        form.addRow("كلمة المرور الجديدة:", self.new_password)
        form.addRow("تأكيد كلمة المرور:", self.confirm_password)
        layout.addLayout(form)

        if mandatory:
            layout.addWidget(QPushButton("تغيير", clicked=self._on_submit))
        else:
            save_btn = QPushButton("حفظ")
            cancel_btn = QPushButton("إلغاء")
            save_btn.clicked.connect(self._on_submit)
            cancel_btn.clicked.connect(self.reject)
            layout.addWidget(save_btn)
            layout.addWidget(cancel_btn)

        self.result_password: str | None = None

    def _on_submit(self) -> None:
        pw1 = self.new_password.text()
        pw2 = self.confirm_password.text()
        if len(pw1) < 6:
            show_error(self, "يجب ألا تقل كلمة المرور عن 6 أحرف")
            return
        if pw1 != pw2:
            show_error(self, "كلمتا المرور غير متطابقتين")
            return
        self.result_password = pw1
        self.accept()


