"""نموذج تسجيل سداد اشتراك."""
from __future__ import annotations

from datetime import date

from PySide6.QtCore import QDate, Qt
from PySide6.QtWidgets import (
    QComboBox,
    QDateEdit,
    QDialog,
    QDialogButtonBox,
    QDoubleSpinBox,
    QFormLayout,
    QLineEdit,
    QSpinBox,
    QVBoxLayout,
)


class FeePaymentDialog(QDialog):
    def __init__(self, parent=None):
        super().__init__(parent)
        self.setWindowTitle("تسجيل سداد اشتراك")
        self.setLayoutDirection(Qt.LayoutDirection.RightToLeft)

        layout = QVBoxLayout(self)
        form = QFormLayout()

        self.fee_year = QSpinBox()
        self.fee_year.setRange(2000, 2100)
        self.fee_year.setValue(date.today().year)

        self.amount = QDoubleSpinBox()
        self.amount.setRange(0, 1_000_000)
        self.amount.setDecimals(2)

        self.paid_date = QDateEdit(calendarPopup=True)
        self.paid_date.setDisplayFormat("yyyy-MM-dd")
        today = date.today()
        self.paid_date.setDate(QDate(today.year, today.month, today.day))

        self.payment_method = QComboBox()
        self.payment_method.addItems(["نقدًا", "تحويل بنكي", "شبكة (مدى)", "أخرى"])

        self.receipt_number = QLineEdit()

        form.addRow("سنة الاشتراك:", self.fee_year)
        form.addRow("المبلغ:", self.amount)
        form.addRow("تاريخ السداد:", self.paid_date)
        form.addRow("طريقة الدفع:", self.payment_method)
        form.addRow("رقم السند:", self.receipt_number)
        layout.addLayout(form)

        buttons = QDialogButtonBox(QDialogButtonBox.StandardButton.Ok | QDialogButtonBox.StandardButton.Cancel)
        buttons.button(QDialogButtonBox.StandardButton.Ok).setText("حفظ")
        buttons.button(QDialogButtonBox.StandardButton.Cancel).setText("إلغاء")
        buttons.accepted.connect(self.accept)
        buttons.rejected.connect(self.reject)
        layout.addWidget(buttons)

        self.values: dict | None = None

    def accept(self) -> None:
        qd = self.paid_date.date()
        self.values = {
            "fee_year": self.fee_year.value(),
            "amount": self.amount.value(),
            "paid_date": date(qd.year(), qd.month(), qd.day()),
            "payment_method": self.payment_method.currentText(),
            "receipt_number": self.receipt_number.text().strip() or None,
        }
        super().accept()

