"""نموذج إضافة/تعديل عضو."""
from __future__ import annotations

from datetime import date

from PySide6.QtCore import QDate, Qt
from PySide6.QtGui import QGuiApplication
from PySide6.QtWidgets import (
    QCheckBox,
    QComboBox,
    QDateEdit,
    QDialog,
    QDialogButtonBox,
    QFormLayout,
    QLineEdit,
    QScrollArea,
    QTextEdit,
    QVBoxLayout,
    QWidget,
)

from app.db.models import Member

QUALIFICATIONS = ["تعليم عام", "الابتدائية", "المتوسطة", "الثانوية", "دبلوم متوسط", "جامعي", "دراسات عليا"]


class MemberFormDialog(QDialog):
    def __init__(self, parent=None, member: Member | None = None, member_types: list[str] | None = None):
        super().__init__(parent)
        self.member = member
        self.setWindowTitle("تعديل بيانات عضو" if member else "إضافة عضو جديد")
        self.setLayoutDirection(Qt.LayoutDirection.RightToLeft)
        self.setMinimumWidth(420)

        layout = QVBoxLayout(self)

        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        scroll.setFrameShape(QScrollArea.Shape.NoFrame)
        form_container = QWidget()
        form = QFormLayout(form_container)

        self.full_name = QLineEdit(member.full_name if member else "")
        self.membership_number = QLineEdit(member.membership_number or "" if member else "")
        self.member_type = QComboBox()
        self.member_type.setEditable(True)
        for t in member_types or ["مؤسس", "عامل", "منتسب", "شرف"]:
            self.member_type.addItem(t)
        if member:
            self.member_type.setCurrentText(member.member_type)

        self.national_id = QLineEdit(member.national_id_or_cr or "" if member else "")
        self.gender = QComboBox()
        self.gender.addItems(["ذكر", "أنثى"])
        if member and member.gender:
            self.gender.setCurrentText(member.gender)

        self.birth_date = QDateEdit(calendarPopup=True)
        self.birth_date.setDisplayFormat("yyyy-MM-dd")
        self.birth_date.setDate(
            QDate(member.birth_date.year, member.birth_date.month, member.birth_date.day)
            if member and member.birth_date
            else QDate(1980, 1, 1)
        )

        self.phone = QLineEdit(member.phone or "" if member else "")
        self.email = QLineEdit(member.email or "" if member else "")
        self.address = QLineEdit(member.address or "" if member else "")

        self.qualification = QComboBox()
        self.qualification.setEditable(True)
        self.qualification.addItems(QUALIFICATIONS)
        if member and member.qualification:
            self.qualification.setCurrentText(member.qualification)
        else:
            self.qualification.setCurrentText("")

        self.city = QLineEdit(member.city or "" if member else "")
        self.occupation = QLineEdit(member.occupation or "" if member else "")

        self.join_date = QDateEdit(calendarPopup=True)
        self.join_date.setDisplayFormat("yyyy-MM-dd")
        today = date.today()
        jd = member.join_date if member else today
        self.join_date.setDate(QDate(jd.year, jd.month, jd.day))

        self.is_founder = QCheckBox("عضو مؤسس")
        if member:
            self.is_founder.setChecked(member.is_founder)

        self.notes = QTextEdit(member.notes or "" if member else "")
        self.notes.setFixedHeight(70)

        form.addRow("الاسم الكامل:*", self.full_name)
        form.addRow("رقم العضوية:", self.membership_number)
        form.addRow("نوع العضوية:*", self.member_type)
        form.addRow("رقم الهوية/السجل:", self.national_id)
        form.addRow("الجنس:", self.gender)
        form.addRow("تاريخ الميلاد:", self.birth_date)
        form.addRow("الجوال:", self.phone)
        form.addRow("البريد الإلكتروني:", self.email)
        form.addRow("العنوان:", self.address)
        form.addRow("المؤهل العلمي:", self.qualification)
        form.addRow("المدينة:", self.city)
        form.addRow("العمل/المهنة:", self.occupation)
        form.addRow("تاريخ الانضمام:*", self.join_date)
        form.addRow("", self.is_founder)
        form.addRow("ملاحظات:", self.notes)

        scroll.setWidget(form_container)
        layout.addWidget(scroll)

        buttons = QDialogButtonBox(QDialogButtonBox.StandardButton.Ok | QDialogButtonBox.StandardButton.Cancel)
        buttons.button(QDialogButtonBox.StandardButton.Ok).setText("حفظ")
        buttons.button(QDialogButtonBox.StandardButton.Cancel).setText("إلغاء")
        buttons.accepted.connect(self._on_accept)
        buttons.rejected.connect(self.reject)
        layout.addWidget(buttons)

        self.values: dict | None = None
        self._size_to_screen()

    def _size_to_screen(self) -> None:
        """يحدّ ارتفاع نافذة الإضافة/التعديل بحجم الشاشة المتاحة، مع محتوى قابل للتمرير،
        حتى يبقى زرا الحفظ/الإلغاء ظاهرين دائمًا حتى على الشاشات الصغيرة."""
        screen = QGuiApplication.primaryScreen()
        if screen is None:
            self.resize(460, 640)
            return
        available = screen.availableGeometry()
        width = min(480, int(available.width() * 0.55))
        height = min(700, int(available.height() * 0.88))
        self.resize(width, height)

    def _on_accept(self) -> None:
        if not self.full_name.text().strip():
            self.full_name.setFocus()
            return
        qd_birth = self.birth_date.date()
        qd_join = self.join_date.date()
        self.values = {
            "full_name": self.full_name.text().strip(),
            "membership_number": self.membership_number.text().strip() or None,
            "member_type": self.member_type.currentText().strip(),
            "national_id_or_cr": self.national_id.text().strip() or None,
            "gender": self.gender.currentText(),
            "birth_date": date(qd_birth.year(), qd_birth.month(), qd_birth.day()),
            "phone": self.phone.text().strip() or None,
            "email": self.email.text().strip() or None,
            "address": self.address.text().strip() or None,
            "qualification": self.qualification.currentText().strip() or None,
            "city": self.city.text().strip() or None,
            "occupation": self.occupation.text().strip() or None,
            "join_date": date(qd_join.year(), qd_join.month(), qd_join.day()),
            "is_founder": self.is_founder.isChecked(),
            "notes": self.notes.toPlainText().strip() or None,
        }
        self.accept()

