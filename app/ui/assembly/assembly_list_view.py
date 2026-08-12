"""شاشة قائمة اجتماعات الجمعية العمومية."""
from __future__ import annotations

from PySide6.QtCore import Qt
from PySide6.QtWidgets import (
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
from app.db.models import Assembly
from app.ui.app_context import AppContext
from app.ui.assembly.assembly_detail_view import STATUS_LABELS, AssemblyDetailView
from app.ui.assembly.assembly_form_dialog import TYPE_LABELS, AssemblyFormDialog
from app.services import assembly_service


class AssemblyListView(QWidget):
    def __init__(self, ctx: AppContext, parent=None):
        super().__init__(parent)
        self.ctx = ctx
        self.setLayoutDirection(Qt.LayoutDirection.RightToLeft)
        self._can_manage = has_permission(ctx.current_user, "assembly.manage")

        layout = QVBoxLayout(self)

        toolbar = QHBoxLayout()
        toolbar.addStretch()
        create_btn = QPushButton("إنشاء اجتماع جديد")
        create_btn.setEnabled(self._can_manage)
        create_btn.clicked.connect(self._on_create)
        toolbar.addWidget(create_btn)
        layout.addLayout(toolbar)

        self.table = QTableWidget(0, 4)
        self.table.setHorizontalHeaderLabels(["العنوان", "النوع", "التاريخ", "الحالة"])
        self.table.horizontalHeader().setSectionResizeMode(0, QHeaderView.ResizeMode.Stretch)
        self.table.setSelectionBehavior(QTableWidget.SelectionBehavior.SelectRows)
        self.table.setEditTriggers(QTableWidget.EditTrigger.NoEditTriggers)
        self.table.doubleClicked.connect(self._on_open_selected)
        layout.addWidget(self.table)

        open_btn = QPushButton("فتح تفاصيل الاجتماع")
        open_btn.clicked.connect(self._on_open_selected)
        layout.addWidget(open_btn)

        self.refresh()

    def refresh(self) -> None:
        assemblies = self.ctx.session.query(Assembly).order_by(Assembly.meeting_date.desc()).all()
        self.table.setRowCount(0)
        for assembly in assemblies:
            row = self.table.rowCount()
            self.table.insertRow(row)
            title_item = QTableWidgetItem(assembly.title)
            title_item.setData(Qt.ItemDataRole.UserRole, assembly.id)
            self.table.setItem(row, 0, title_item)
            self.table.setItem(row, 1, QTableWidgetItem(TYPE_LABELS.get(assembly.type, assembly.type.value)))
            self.table.setItem(row, 2, QTableWidgetItem(assembly.meeting_date.isoformat()))
            self.table.setItem(row, 3, QTableWidgetItem(STATUS_LABELS.get(assembly.status, assembly.status.value)))

    def _on_create(self) -> None:
        dialog = AssemblyFormDialog(self)
        if dialog.exec() == QDialog.DialogCode.Accepted and dialog.values:
            assembly_service.create_assembly(self.ctx.session, self.ctx.current_user, **dialog.values)
            self.refresh()

    def _on_open_selected(self) -> None:
        row = self.table.currentRow()
        if row < 0:
            return
        assembly_id = self.table.item(row, 0).data(Qt.ItemDataRole.UserRole)

        detail_dialog = QDialog(self)
        detail_dialog.setWindowTitle("تفاصيل الاجتماع")
        detail_dialog.setLayoutDirection(Qt.LayoutDirection.RightToLeft)
        detail_dialog.resize(700, 600)
        layout = QVBoxLayout(detail_dialog)
        layout.addWidget(AssemblyDetailView(self.ctx, assembly_id, detail_dialog))
        detail_dialog.exec()
        self.refresh()

