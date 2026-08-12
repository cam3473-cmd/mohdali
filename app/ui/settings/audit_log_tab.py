"""سجل تدقيق مرئي: من قام بأي إجراء ومتى."""
from __future__ import annotations

from PySide6.QtCore import Qt
from PySide6.QtWidgets import (
    QHBoxLayout,
    QHeaderView,
    QLineEdit,
    QPushButton,
    QTableWidget,
    QTableWidgetItem,
    QVBoxLayout,
    QWidget,
)

from app.services import audit
from app.ui.app_context import AppContext


class AuditLogTab(QWidget):
    def __init__(self, ctx: AppContext, parent=None):
        super().__init__(parent)
        self.ctx = ctx
        self.setLayoutDirection(Qt.LayoutDirection.RightToLeft)

        layout = QVBoxLayout(self)

        toolbar = QHBoxLayout()
        self.search_input = QLineEdit()
        self.search_input.setPlaceholderText("بحث بالإجراء أو الكيان أو التفاصيل...")
        self.search_input.textChanged.connect(self.refresh)
        toolbar.addWidget(self.search_input)
        refresh_btn = QPushButton("تحديث")
        refresh_btn.clicked.connect(self.refresh)
        toolbar.addWidget(refresh_btn)
        layout.addLayout(toolbar)

        self.table = QTableWidget(0, 5)
        self.table.setHorizontalHeaderLabels(["التاريخ والوقت", "المستخدم", "الإجراء", "الكيان", "التفاصيل"])
        self.table.horizontalHeader().setSectionResizeMode(4, QHeaderView.ResizeMode.Stretch)
        self.table.setEditTriggers(QTableWidget.EditTrigger.NoEditTriggers)
        self.table.setSelectionBehavior(QTableWidget.SelectionBehavior.SelectRows)
        layout.addWidget(self.table)

        self.refresh()

    def refresh(self) -> None:
        entries = audit.list_recent(self.ctx.session, search=self.search_input.text().strip() or None)
        self.table.setRowCount(0)
        for entry in entries:
            row = self.table.rowCount()
            self.table.insertRow(row)
            self.table.setItem(row, 0, QTableWidgetItem(entry.timestamp.strftime("%Y-%m-%d %H:%M:%S")))
            self.table.setItem(row, 1, QTableWidgetItem(entry.user.username if entry.user else "—"))
            self.table.setItem(row, 2, QTableWidgetItem(entry.action))
            entity_label = f"{entry.entity}#{entry.entity_id}" if entry.entity_id else entry.entity
            self.table.setItem(row, 3, QTableWidgetItem(entity_label))
            self.table.setItem(row, 4, QTableWidgetItem(entry.details or ""))
