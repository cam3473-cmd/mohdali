"""شاشة مناصب مجلس الإدارة."""
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
from app.db.models import BoardPosition, Member, MemberStatus
from app.services import board_service
from app.ui.app_context import AppContext
from app.ui.board.assign_position_dialog import AssignPositionDialog
from app.ui.common import confirm, show_error


class BoardView(QWidget):
    def __init__(self, ctx: AppContext, parent=None):
        super().__init__(parent)
        self.ctx = ctx
        self.setLayoutDirection(Qt.LayoutDirection.RightToLeft)
        self._can_manage = has_permission(ctx.current_user, "board.manage")

        layout = QVBoxLayout(self)

        toolbar = QHBoxLayout()
        toolbar.addStretch()
        assign_btn = QPushButton("تعيين منصب جديد")
        assign_btn.setEnabled(self._can_manage)
        assign_btn.clicked.connect(self._on_assign)
        toolbar.addWidget(assign_btn)
        layout.addLayout(toolbar)

        self.table = QTableWidget(0, 3)
        self.table.setHorizontalHeaderLabels(["العضو", "المنصب", "تاريخ التعيين"])
        self.table.horizontalHeader().setSectionResizeMode(0, QHeaderView.ResizeMode.Stretch)
        self.table.setSelectionBehavior(QTableWidget.SelectionBehavior.SelectRows)
        self.table.setEditTriggers(QTableWidget.EditTrigger.NoEditTriggers)
        layout.addWidget(self.table)

        end_btn = QPushButton("إنهاء المنصب المحدد")
        end_btn.setEnabled(self._can_manage)
        end_btn.clicked.connect(self._on_end_position)
        layout.addWidget(end_btn)

        self.refresh()

    def refresh(self) -> None:
        positions = board_service.list_current_positions(self.ctx.session)
        self.table.setRowCount(0)
        for pos in positions:
            row = self.table.rowCount()
            self.table.insertRow(row)
            title_item = QTableWidgetItem(pos.member.full_name)
            title_item.setData(Qt.ItemDataRole.UserRole, pos.id)
            self.table.setItem(row, 0, title_item)
            self.table.setItem(row, 1, QTableWidgetItem(pos.title))
            self.table.setItem(row, 2, QTableWidgetItem(pos.start_date.isoformat() if pos.start_date else "—"))

    def _on_assign(self) -> None:
        active_members = (
            self.ctx.session.query(Member).filter(Member.status == MemberStatus.ACTIVE).order_by(Member.full_name).all()
        )
        if not active_members:
            show_error(self, "لا يوجد أعضاء نشطون لتعيينهم في منصب")
            return
        dialog = AssignPositionDialog(self, active_members)
        if dialog.exec() == QDialog.DialogCode.Accepted and dialog.values:
            member = self.ctx.session.get(Member, dialog.values.pop("member_id"))
            board_service.assign_position(self.ctx.session, self.ctx.current_user, member, **dialog.values)
            self.refresh()

    def _on_end_position(self) -> None:
        row = self.table.currentRow()
        if row < 0:
            return
        position_id = self.table.item(row, 0).data(Qt.ItemDataRole.UserRole)
        position = self.ctx.session.get(BoardPosition, position_id)
        if not confirm(self, f"هل تريد إنهاء منصب {position.title} للعضو {position.member.full_name}؟"):
            return
        try:
            board_service.end_position(self.ctx.session, self.ctx.current_user, position)
            self.refresh()
        except board_service.BoardError as exc:
            show_error(self, str(exc))

