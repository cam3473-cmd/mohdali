"""شاشة مناصب مجلس الإدارة."""
from __future__ import annotations

from datetime import date

from PySide6.QtCore import QDate, Qt
from PySide6.QtWidgets import (
    QDateEdit,
    QDialog,
    QFileDialog,
    QHBoxLayout,
    QHeaderView,
    QLabel,
    QPushButton,
    QTableWidget,
    QTableWidgetItem,
    QVBoxLayout,
    QWidget,
)

from app.auth.service import has_permission
from app.db.models import BoardPosition, Member, MemberStatus
from app.services import board_service, bylaw_settings_service
from app.ui.app_context import AppContext
from app.ui.board.assign_position_dialog import AssignPositionDialog
from app.ui.common import confirm, show_error, show_info

_TERM_DATE_SETTING_KEY = "board_term_end_date"


class BoardView(QWidget):
    def __init__(self, ctx: AppContext, parent=None):
        super().__init__(parent)
        self.ctx = ctx
        self.setLayoutDirection(Qt.LayoutDirection.RightToLeft)
        self._can_manage = has_permission(ctx.current_user, "board.manage")

        layout = QVBoxLayout(self)

        term_row = QHBoxLayout()
        term_row.addWidget(QLabel("تاريخ نهاية دورة المجلس:"))
        self.term_date_edit = QDateEdit(calendarPopup=True)
        self.term_date_edit.setDisplayFormat("yyyy-MM-dd")
        term_row.addWidget(self.term_date_edit)
        save_term_btn = QPushButton("حفظ التاريخ")
        save_term_btn.setEnabled(self._can_manage)
        save_term_btn.clicked.connect(self._on_save_term_date)
        term_row.addWidget(save_term_btn)
        term_row.addStretch()
        layout.addLayout(term_row)

        self.term_label = QLabel()
        layout.addWidget(self.term_label)

        toolbar = QHBoxLayout()
        print_btn = QPushButton("طباعة")
        print_btn.clicked.connect(self._on_print)
        toolbar.addWidget(print_btn)
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

        actions = QHBoxLayout()
        edit_btn = QPushButton("تعديل")
        edit_btn.setEnabled(self._can_manage)
        edit_btn.clicked.connect(self._on_edit)
        actions.addWidget(edit_btn)
        end_btn = QPushButton("إنهاء المنصب المحدد")
        end_btn.setEnabled(self._can_manage)
        end_btn.clicked.connect(self._on_end_position)
        actions.addWidget(end_btn)
        delete_btn = QPushButton("حذف")
        delete_btn.setEnabled(self._can_manage)
        delete_btn.clicked.connect(self._on_delete)
        actions.addWidget(delete_btn)
        layout.addLayout(actions)

        self.refresh()

    def _term_end_date(self) -> str:
        return bylaw_settings_service.get_settings(self.ctx.session).board_term_end_date

    def _on_save_term_date(self) -> None:
        qd = self.term_date_edit.date()
        value = date(qd.year(), qd.month(), qd.day()).isoformat()
        bylaw_settings_service.update_setting(self.ctx.session, self.ctx.current_user, _TERM_DATE_SETTING_KEY, value)
        self.refresh()

    def refresh(self) -> None:
        term_end_date = self._term_end_date()
        if term_end_date:
            try:
                parsed = date.fromisoformat(term_end_date)
                self.term_date_edit.setDate(QDate(parsed.year, parsed.month, parsed.day))
            except ValueError:
                pass

        status_text = board_service.term_status_text(term_end_date)
        if status_text:
            is_overdue = date.fromisoformat(term_end_date) < date.today()
            color = "#b3261e" if is_overdue else "#1c5c33"
            self.term_label.setText(f"<b style='color:{color}'>{status_text}</b>")
        else:
            self.term_label.setText("<i>لم يُحدَّد تاريخ نهاية دورة المجلس الحالية بعد — اختر تاريخًا واضغط \"حفظ التاريخ\"</i>")

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

    def _active_members(self) -> list[Member]:
        return self.ctx.session.query(Member).filter(Member.status == MemberStatus.ACTIVE).order_by(Member.full_name).all()

    def _selected_position(self) -> BoardPosition | None:
        row = self.table.currentRow()
        if row < 0:
            return None
        position_id = self.table.item(row, 0).data(Qt.ItemDataRole.UserRole)
        return self.ctx.session.get(BoardPosition, position_id)

    def _on_assign(self) -> None:
        active_members = self._active_members()
        if not active_members:
            show_error(self, "لا يوجد أعضاء نشطون لتعيينهم في منصب")
            return
        dialog = AssignPositionDialog(self, active_members)
        if dialog.exec() == QDialog.DialogCode.Accepted and dialog.values:
            member = self.ctx.session.get(Member, dialog.values.pop("member_id"))
            board_service.assign_position(self.ctx.session, self.ctx.current_user, member, **dialog.values)
            self.refresh()

    def _on_edit(self) -> None:
        position = self._selected_position()
        if position is None:
            return
        active_members = self._active_members()
        if position.member not in active_members:
            active_members = [position.member, *active_members]
        dialog = AssignPositionDialog(self, active_members, position=position)
        if dialog.exec() == QDialog.DialogCode.Accepted and dialog.values:
            member = self.ctx.session.get(Member, dialog.values.pop("member_id"))
            board_service.update_position(self.ctx.session, self.ctx.current_user, position, member, **dialog.values)
            self.refresh()

    def _on_end_position(self) -> None:
        position = self._selected_position()
        if position is None:
            return
        if not confirm(self, f"هل تريد إنهاء منصب {position.title} للعضو {position.member.full_name}؟"):
            return
        try:
            board_service.end_position(self.ctx.session, self.ctx.current_user, position)
            self.refresh()
        except board_service.BoardError as exc:
            show_error(self, str(exc))

    def _on_delete(self) -> None:
        position = self._selected_position()
        if position is None:
            return
        if not confirm(self, f"هل تريد حذف منصب {position.title} للعضو {position.member.full_name} نهائيًا؟"):
            return
        board_service.delete_position(self.ctx.session, self.ctx.current_user, position)
        self.refresh()

    def _on_print(self) -> None:
        from app.reports.pdf_export import generate_board_report

        positions = board_service.list_current_positions(self.ctx.session)
        if not positions:
            show_error(self, "لا توجد مناصب حالية لطباعتها")
            return
        path, _ = QFileDialog.getSaveFileName(self, "طباعة مجلس الإدارة", "مجلس-الإدارة.pdf", "PDF (*.pdf)")
        if not path:
            return
        try:
            generate_board_report(positions, path, term_end_date=self._term_end_date() or None)
            show_info(self, f"تم حفظ التقرير في: {path}")
        except Exception as exc:  # noqa: BLE001
            show_error(self, f"تعذر إنشاء التقرير: {exc}")
