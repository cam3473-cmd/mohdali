"""نموذج استيراد الأعضاء من ملف Excel."""
from __future__ import annotations

from datetime import date

from PySide6.QtCore import Qt
from PySide6.QtWidgets import (
    QComboBox,
    QDialog,
    QDialogButtonBox,
    QFileDialog,
    QFormLayout,
    QHBoxLayout,
    QLineEdit,
    QPushButton,
    QSpinBox,
    QVBoxLayout,
)

from app.services import import_service
from app.ui.common import show_error


class ImportDialog(QDialog):
    def __init__(self, parent=None):
        super().__init__(parent)
        self.setWindowTitle("استيراد الأعضاء من Excel")
        self.setLayoutDirection(Qt.LayoutDirection.RightToLeft)
        self.setMinimumWidth(420)

        layout = QVBoxLayout(self)
        form = QFormLayout()

        file_row = QHBoxLayout()
        self.file_path_input = QLineEdit()
        self.file_path_input.setReadOnly(True)
        browse_btn = QPushButton("اختيار ملف...")
        browse_btn.clicked.connect(self._on_browse)
        file_row.addWidget(self.file_path_input)
        file_row.addWidget(browse_btn)

        self.sheet_combo = QComboBox()

        self.fee_year = QSpinBox()
        self.fee_year.setRange(2000, 2100)
        self.fee_year.setValue(date.today().year)

        form.addRow("ملف Excel:*", file_row)
        form.addRow("الورقة (Sheet):", self.sheet_combo)
        form.addRow("سنة تسجيل الاشتراكات المستوردة:", self.fee_year)
        layout.addLayout(form)

        buttons = QDialogButtonBox(QDialogButtonBox.StandardButton.Ok | QDialogButtonBox.StandardButton.Cancel)
        buttons.button(QDialogButtonBox.StandardButton.Ok).setText("استيراد")
        buttons.button(QDialogButtonBox.StandardButton.Cancel).setText("إلغاء")
        buttons.accepted.connect(self._on_accept)
        buttons.rejected.connect(self.reject)
        layout.addWidget(buttons)

        self.values: dict | None = None

    def _on_browse(self) -> None:
        path, _ = QFileDialog.getOpenFileName(self, "اختيار ملف الأعضاء", "", "Excel (*.xlsx)")
        if not path:
            return
        self.file_path_input.setText(path)
        self.sheet_combo.clear()
        try:
            sheets = import_service.list_sheet_names(path)
            self.sheet_combo.addItems(sheets)
        except Exception as exc:  # noqa: BLE001
            show_error(self, f"تعذرت قراءة الملف: {exc}")

    def _on_accept(self) -> None:
        if not self.file_path_input.text():
            show_error(self, "الرجاء اختيار ملف Excel أولًا")
            return
        self.values = {
            "file_path": self.file_path_input.text(),
            "sheet_name": self.sheet_combo.currentText() or None,
            "fee_year": self.fee_year.value(),
        }
        self.accept()

