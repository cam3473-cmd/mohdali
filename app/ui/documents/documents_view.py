"""شاشة حفظ المستندات الرسمية (خطاب تشكيل المجلس، شهادة الجمعية، خطابات اعتماد البرامج)."""
from __future__ import annotations

from PySide6.QtCore import QUrl, Qt
from PySide6.QtGui import QDesktopServices
from PySide6.QtWidgets import (
    QComboBox,
    QDialog,
    QHBoxLayout,
    QHeaderView,
    QPushButton,
    QTableWidget,
    QTableWidgetItem,
    QVBoxLayout,
    QWidget,
)

from app.auth.service import has_permission
from app.db.models import Document
from app.services import document_service
from app.ui.app_context import AppContext
from app.ui.common import confirm, show_error, show_info
from app.ui.documents.add_document_dialog import AddDocumentDialog

CATEGORY_FILTERS = ["الكل"] + document_service.DOCUMENT_CATEGORIES


class DocumentsView(QWidget):
    def __init__(self, ctx: AppContext, parent=None):
        super().__init__(parent)
        self.ctx = ctx
        self.setLayoutDirection(Qt.LayoutDirection.RightToLeft)
        self._can_manage = has_permission(ctx.current_user, "documents.manage")

        layout = QVBoxLayout(self)

        toolbar = QHBoxLayout()
        self.category_filter = QComboBox()
        self.category_filter.addItems(CATEGORY_FILTERS)
        self.category_filter.currentIndexChanged.connect(self.refresh)
        toolbar.addWidget(self.category_filter)
        toolbar.addStretch()
        add_btn = QPushButton("إضافة مستند")
        add_btn.setEnabled(self._can_manage)
        add_btn.clicked.connect(self._on_add)
        toolbar.addWidget(add_btn)
        layout.addLayout(toolbar)

        self.table = QTableWidget(0, 3)
        self.table.setHorizontalHeaderLabels(["العنوان", "التصنيف", "تاريخ الرفع"])
        self.table.horizontalHeader().setSectionResizeMode(0, QHeaderView.ResizeMode.Stretch)
        self.table.setSelectionBehavior(QTableWidget.SelectionBehavior.SelectRows)
        self.table.setEditTriggers(QTableWidget.EditTrigger.NoEditTriggers)
        layout.addWidget(self.table)

        actions = QHBoxLayout()
        open_btn = QPushButton("فتح")
        open_btn.clicked.connect(self._on_open)
        actions.addWidget(open_btn)
        delete_btn = QPushButton("حذف")
        delete_btn.setEnabled(self._can_manage)
        delete_btn.clicked.connect(self._on_delete)
        actions.addWidget(delete_btn)
        layout.addLayout(actions)

        self.refresh()

    def _selected_document(self) -> Document | None:
        row = self.table.currentRow()
        if row < 0:
            return None
        document_id = self.table.item(row, 0).data(Qt.ItemDataRole.UserRole)
        return self.ctx.session.get(Document, document_id)

    def refresh(self) -> None:
        category = self.category_filter.currentText()
        category = None if category == "الكل" else category
        documents = document_service.list_documents(self.ctx.session, category=category)
        self.table.setRowCount(0)
        for doc in documents:
            row = self.table.rowCount()
            self.table.insertRow(row)
            title_item = QTableWidgetItem(doc.title)
            title_item.setData(Qt.ItemDataRole.UserRole, doc.id)
            self.table.setItem(row, 0, title_item)
            self.table.setItem(row, 1, QTableWidgetItem(doc.category))
            self.table.setItem(row, 2, QTableWidgetItem(doc.uploaded_at.strftime("%Y-%m-%d %H:%M")))

    def _on_add(self) -> None:
        dialog = AddDocumentDialog(self)
        if dialog.exec() == QDialog.DialogCode.Accepted and dialog.values:
            try:
                document_service.add_document(self.ctx.session, self.ctx.current_user, **dialog.values)
                self.refresh()
            except Exception as exc:  # noqa: BLE001
                show_error(self, f"تعذرت إضافة المستند: {exc}")

    def _on_open(self) -> None:
        document = self._selected_document()
        if document is None:
            return
        path = document_service.document_path(document)
        if not path.exists():
            show_error(self, "ملف المستند غير موجود على القرص")
            return
        QDesktopServices.openUrl(QUrl.fromLocalFile(str(path)))

    def _on_delete(self) -> None:
        document = self._selected_document()
        if document is None:
            return
        if not confirm(self, f"هل تريد حذف المستند \"{document.title}\" نهائيًا؟"):
            return
        document_service.delete_document(self.ctx.session, self.ctx.current_user, document)
        self.refresh()
        show_info(self, "تم حذف المستند")
