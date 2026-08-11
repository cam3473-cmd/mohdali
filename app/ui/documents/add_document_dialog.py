"""نموذج إضافة مستند PDF جديد."""
from __future__ import annotations

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
    QVBoxLayout,
)

from app.services.document_service import DOCUMENT_CATEGORIES


class AddDocumentDialog(QDialog):
    def __init__(self, parent=None):
        super().__init__(parent)
        self.setWindowTitle("إضافة مستند")
        self.setLayoutDirection(Qt.LayoutDirection.RightToLeft)
        self.setMinimumWidth(420)

        layout = QVBoxLayout(self)
        form = QFormLayout()

        self.category = QComboBox()
        self.category.addItems(DOCUMENT_CATEGORIES)

        self.title = QLineEdit()

        file_row = QHBoxLayout()
        self.file_path = QLineEdit()
        self.file_path.setReadOnly(True)
        browse_btn = QPushButton("استعراض...")
        browse_btn.clicked.connect(self._on_browse)
        file_row.addWidget(self.file_path)
        file_row.addWidget(browse_btn)

        self.notes = QLineEdit()

        form.addRow("التصنيف:*", self.category)
        form.addRow("عنوان المستند:*", self.title)
        form.addRow("الملف (PDF):*", file_row)
        form.addRow("ملاحظات:", self.notes)
        layout.addLayout(form)

        buttons = QDialogButtonBox(QDialogButtonBox.StandardButton.Ok | QDialogButtonBox.StandardButton.Cancel)
        buttons.button(QDialogButtonBox.StandardButton.Ok).setText("إضافة")
        buttons.button(QDialogButtonBox.StandardButton.Cancel).setText("إلغاء")
        buttons.accepted.connect(self._on_accept)
        buttons.rejected.connect(self.reject)
        layout.addWidget(buttons)

        self.values: dict | None = None

    def _on_browse(self) -> None:
        path, _ = QFileDialog.getOpenFileName(self, "اختيار ملف PDF", "", "PDF (*.pdf)")
        if path:
            self.file_path.setText(path)
            if not self.title.text().strip():
                from pathlib import Path

                self.title.setText(Path(path).stem)

    def _on_accept(self) -> None:
        if not self.title.text().strip() or not self.file_path.text().strip():
            return
        self.values = {
            "category": self.category.currentText(),
            "title": self.title.text().strip(),
            "source_file_path": self.file_path.text().strip(),
            "notes": self.notes.text().strip() or None,
        }
        self.accept()
